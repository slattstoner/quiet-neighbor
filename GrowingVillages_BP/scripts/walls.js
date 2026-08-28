import { system } from "@minecraft/server";
import { setBlock, toWorld } from "./util.js";
import { makePlacer, stairs, facingBlock, placeDoor, paveRoad, CAMPFIRE_PLAZA, ROAD_HALF_WIDTH } from "./builder.js";
import { prepareFortifiedArea, supportWallFoundation, holdLoadedArea, prepareCorridorJob } from "./terrain.js";

/**
 * Fortifications are rebuilt in place as the village advances, so each
 * tier first clears the previous ring rather than growing through it.
 *
 * Tier 1 - PALISADE: a stockade of oak logs with an uneven, sharpened
 *          silhouette and a plank fighting-walk behind it.
 * Tier 2 - COBBLESTONE WALL: a proper defensive wall with a walkway on
 *          top and a cobblestone-wall parapet.
 * Tier 3 - CASTLE WALL: stone brick curtain wall with merlons
 *          (alternating crenellations), arrow slits and full towers.
 */

export const TIER_PALISADE = 1;
export const TIER_COBBLE = 2;
export const TIER_CASTLE = 3;

const TIER_SPEC = {
  [TIER_PALISADE]: { height: 4, walkUp: 2, wallBlock: "minecraft:oak_log", towerBlock: "minecraft:oak_log", towerPost: "minecraft:oak_log", towerInfill: "minecraft:oak_planks" },
  [TIER_COBBLE]: { height: 5, walkUp: 4, wallBlock: "minecraft:cobblestone", towerBlock: "minecraft:cobblestone", towerPost: "minecraft:spruce_log", towerInfill: "minecraft:cobblestone" },
  [TIER_CASTLE]: { height: 7, walkUp: 6, wallBlock: "minecraft:stone_bricks", towerBlock: "minecraft:stone_bricks", towerPost: "minecraft:cobblestone", towerInfill: "minecraft:stone_bricks" }
};

/**
 * Returns the perimeter rectangle (in local village coordinates) that
 * should enclose a village of the given street length.
 */
export function perimeterFor(maxForward) {
  // The largest current plot reaches forward +6 from its plot origin and the
  // farmer's fence reaches side 14. The added space leaves at least fifteen
  // clear blocks from every final building or attached work area to a wall.
  // A square footprint leaves a full modernization reserve in every
  // quadrant. The side is based on the larger forward extent so later
  // cross-road buildings cannot be squeezed against the wall.
  const radius = Math.max(30, maxForward + 10);
  return { fMin: -radius, fMax: radius, sMin: -radius, sMax: radius };
}

/** Every position on the perimeter ring, with the outward direction for each. */
function ringPositions(rect) {
  const out = [];
  for (let f = rect.fMin; f <= rect.fMax; f++) {
    out.push({ f, s: rect.sMin, edge: "sMin" });
    out.push({ f, s: rect.sMax, edge: "sMax" });
  }
  for (let s = rect.sMin + 1; s <= rect.sMax - 1; s++) {
    out.push({ f: rect.fMin, s, edge: "fMin" });
    out.push({ f: rect.fMax, s, edge: "fMax" });
  }
  return out;
}

/** Corner coordinates, where the watchtowers go. */
function corners(rect) {
  return [
    { f: rect.fMin, s: rect.sMin },
    { f: rect.fMin, s: rect.sMax },
    { f: rect.fMax, s: rect.sMin },
    { f: rect.fMax, s: rect.sMax }
  ];
}

/** True if this ring position is inside a gateway opening. */
function isGateway(pos, rect, gateForward) {
  // The village has a single through-road, so the wall only opens where
  // that road exits - the two ends (fMax/fMin), not the side edges.
  return (pos.edge === "fMax" || pos.edge === "fMin") && Math.abs(pos.s) <= 2;
}

// How many ring positions (or footprint columns) one job slice handles before
// handing the tick back. Sized to the same order as terrain.js's interior
// sweep: a few hundred block calls, well under the watchdog's 100ms spike
// threshold even on a phone.
const SLICE = 8;

/** Clears the whole fortification volume so a new tier can replace the old one. */
export function* clearRingJob(dimension, origin, facing, rect, maxHeight) {
  const placer = makePlacer(dimension, origin, facing);
  const positions = ringPositions(rect);
  const height = maxHeight || 12;
  let done = 0;
  for (const pos of positions) {
    for (let d = -2; d <= 2; d++) {
      // clear a band either side of the ring line so towers and walkways go too
      const f = pos.edge === "sMin" || pos.edge === "sMax" ? pos.f : pos.f + d;
      const s = pos.edge === "sMin" || pos.edge === "sMax" ? pos.s + d : pos.s;
      for (let up = 0; up <= height; up++) {
        placer.block(f, s, up, "minecraft:air");
      }
    }
    if (++done % SLICE === 0) yield;
  }
}

/** Synchronous clearRing, kept for callers that are not driving a job. */
export function clearRing(dimension, origin, facing, rect, maxHeight) {
  for (const _ of clearRingJob(dimension, origin, facing, rect, maxHeight)) { /* drain */ }
}

/** Outward compass direction for a ring edge, used to orient stairs/ladders. */
function outwardCardinal(placer, edge) {
  const PLUS_SIDE = ["south", "north", "east", "west"][placer.facing];
  const MINUS_SIDE = ["north", "south", "west", "east"][placer.facing];
  const PLUS_FWD = ["east", "west", "south", "north"][placer.facing];
  const MINUS_FWD = ["west", "east", "north", "south"][placer.facing];
  if (edge === "sMax") return PLUS_SIDE;
  if (edge === "sMin") return MINUS_SIDE;
  if (edge === "fMax") return PLUS_FWD;
  return MINUS_FWD;
}

/**
 * TIER 1 - Log palisade. Uneven post heights give the sharpened-stake
 * silhouette of a real stockade rather than a flat-topped fence, and a
 * plank fighting-walk runs along the inside so guards can stand on it.
 */
function* palisadeJob(dimension, origin, facing, rect, gateForward) {
  const placer = makePlacer(dimension, origin, facing);
  const spec = TIER_SPEC[TIER_PALISADE];
  const positions = ringPositions(rect);
  let done = 0;

  for (const pos of positions) {
    if (isGateway(pos, rect, gateForward)) continue;
    // Alternating 4/3-high posts, with a short spike on the tall ones
    const tall = ((pos.f + pos.s) % 2 === 0);
    const postTop = tall ? spec.height : spec.height - 1;
    placer.box(pos.f, pos.s, -1, pos.f, pos.s, postTop, spec.wallBlock);
    if (tall) {
      // Fence on top reads as a sharpened tip from a distance
      placer.block(pos.f, pos.s, postTop + 1, "minecraft:oak_fence");
    }
    if (++done % SLICE === 0) yield;
  }

  // Inner fighting-walk: planks one block in from the palisade, with a rail
  for (const pos of positions) {
    if (isGateway(pos, rect, gateForward)) continue;
    const inF = pos.edge === "fMin" ? pos.f + 1 : pos.edge === "fMax" ? pos.f - 1 : pos.f;
    const inS = pos.edge === "sMin" ? pos.s + 1 : pos.edge === "sMax" ? pos.s - 1 : pos.s;
    placer.block(inF, inS, spec.walkUp, "minecraft:oak_planks");
    // support post underneath every few blocks
    if ((pos.f + pos.s) % 4 === 0) {
      placer.box(inF, inS, 0, inF, inS, spec.walkUp - 1, "minecraft:oak_fence");
    }
    const railF = pos.edge === "fMin" ? inF + 1 : pos.edge === "fMax" ? inF - 1 : inF;
    const railS = pos.edge === "sMin" ? inS + 1 : pos.edge === "sMax" ? inS - 1 : inS;
    placer.block(railF, railS, spec.walkUp, "minecraft:oak_planks");
    placer.block(railF, railS, spec.walkUp + 1, "minecraft:oak_fence");
    if (++done % SLICE === 0) yield;
  }

  buildGateway(placer, rect, TIER_PALISADE);
  return TIER_PALISADE;
}

/** TIER 2 - Cobblestone curtain wall with a walkway and a wall-block parapet. */
function* cobbleWallJob(dimension, origin, facing, rect, gateForward) {
  const placer = makePlacer(dimension, origin, facing);
  const spec = TIER_SPEC[TIER_COBBLE];
  const positions = ringPositions(rect);
  let done = 0;

  for (const pos of positions) {
    if (isGateway(pos, rect, gateForward)) continue;
    placer.box(pos.f, pos.s, -1, pos.f, pos.s, spec.height - 1, spec.wallBlock);
    // Parapet along the outer face
    placer.block(pos.f, pos.s, spec.height, "minecraft:cobblestone_wall");
    // Walkway one block in
    const inF = pos.edge === "fMin" ? pos.f + 1 : pos.edge === "fMax" ? pos.f - 1 : pos.f;
    const inS = pos.edge === "sMin" ? pos.s + 1 : pos.edge === "sMax" ? pos.s - 1 : pos.s;
    placer.box(inF, inS, -1, inF, inS, spec.walkUp - 1, spec.wallBlock);
    placer.block(inF, inS, spec.walkUp, "minecraft:stone_brick_slab");
    // torch every so often along the walk
    if ((pos.f + pos.s) % 7 === 0) {
      placer.block(inF, inS, spec.walkUp + 1, "minecraft:torch");
    }
    if (++done % SLICE === 0) yield;
  }

  buildGateway(placer, rect, TIER_COBBLE);
  return TIER_COBBLE;
}

/**
 * TIER 3 - Castle curtain wall: stone brick, taller, with proper merlons
 * (alternating raised crenellations) and arrow slits at chest height.
 */
function* castleWallJob(dimension, origin, facing, rect, gateForward) {
  const placer = makePlacer(dimension, origin, facing);
  const spec = TIER_SPEC[TIER_CASTLE];
  const positions = ringPositions(rect);
  let done = 0;

  for (const pos of positions) {
    if (isGateway(pos, rect, gateForward)) continue;
    placer.box(pos.f, pos.s, -1, pos.f, pos.s, spec.height - 1, spec.wallBlock);

    // Merlons: raise every other block so the top reads as battlements
    const merlon = ((pos.f + pos.s) % 2 === 0);
    if (merlon) {
      placer.block(pos.f, pos.s, spec.height, spec.wallBlock);
      placer.block(pos.f, pos.s, spec.height + 1, "minecraft:stone_brick_slab");
    }
    // Arrow slit in the embrasures
    if (!merlon && (pos.f + pos.s) % 6 === 0) {
      placer.block(pos.f, pos.s, spec.height - 2, "minecraft:air");
    }

    // Walkway behind the battlements
    const inF = pos.edge === "fMin" ? pos.f + 1 : pos.edge === "fMax" ? pos.f - 1 : pos.f;
    const inS = pos.edge === "sMin" ? pos.s + 1 : pos.edge === "sMax" ? pos.s - 1 : pos.s;
    placer.box(inF, inS, -1, inF, inS, spec.walkUp - 1, spec.wallBlock);
    placer.block(inF, inS, spec.walkUp, "minecraft:stone_bricks");
    // Inner rail so guards don't walk off the back
    const railF = pos.edge === "fMin" ? inF + 1 : pos.edge === "fMax" ? inF - 1 : inF;
    const railS = pos.edge === "sMin" ? inS + 1 : pos.edge === "sMax" ? inS - 1 : inS;
    placer.block(railF, railS, spec.walkUp, "minecraft:stone_bricks");
    placer.block(railF, railS, spec.walkUp + 1, "minecraft:stone_brick_wall");
    if ((pos.f + pos.s) % 9 === 0) {
      placer.block(railF, railS, spec.walkUp + 2, "minecraft:lantern", { hanging: false });
    }
    if (++done % SLICE === 0) yield;
  }

  buildGateway(placer, rect, TIER_CASTLE);
  return TIER_CASTLE;
}

/** Gatehouse: flanking piers, an arch over the road, and a clear passage. */
function buildGateway(placer, rect, tier) {
  const spec = TIER_SPEC[tier];
  const block = spec.wallBlock;
  const accent = tier === TIER_PALISADE ? "minecraft:oak_log" : "minecraft:stone_bricks";

  for (const edge of ["fMax", "fMin"]) {
    const alongF = edge === "sMax" || edge === "sMin";
    const fixed = edge === "fMax" ? rect.fMax : edge === "fMin" ? rect.fMin : edge === "sMax" ? rect.sMax : rect.sMin;
    const at = (offset) => alongF ? { f: offset, s: fixed } : { f: fixed, s: offset };
    // Piers either side of a five-block opening.
    for (const offset of [-3, 3]) {
      const p = at(offset);
      placer.box(p.f, p.s, -1, p.f, p.s, spec.height + 1, accent);
      placer.block(p.f, p.s, spec.height + 2, "minecraft:lantern", { hanging: false });
    }
    // Arch over the gap.
    for (let offset = -2; offset <= 2; offset++) {
      const p = at(offset);
      placer.block(p.f, p.s, spec.height, accent);
      placer.block(p.f, p.s, spec.height + 1, block);
    }
    // Clear the passage itself, full width, and floor it.
    //
    // The floor is the fix for the trench that used to sit in every
    // gateway. The main ring loop skips gateway positions wholesale, and
    // that loop is what lays each ring column down to up=-1 and calls
    // supportWallFoundation() beneath it - so the five columns of the
    // opening got neither. On any ground that was not already exactly at
    // the village platform height, the result was a gap in the ground at
    // the gate with the wall's own foundation standing proud either side
    // of it: a trench you dropped into on the way out of the village.
    for (let offset = -2; offset <= 2; offset++) {
      const p = at(offset);
      for (let up = 0; up <= spec.height - 1; up++) placer.block(p.f, p.s, up, "minecraft:air");
      placer.block(p.f, p.s, -1, "minecraft:gravel");
      supportWallFoundation(placer.dimension, placer.origin, placer.facing, p.f, p.s, "minecraft:dirt");
    }
    if (tier !== TIER_PALISADE) {
      for (const offset of [-3, 3]) {
        const p = at(offset);
        placer.block(p.f, p.s, spec.height - 1, "minecraft:lantern", { hanging: false });
      }
    }
  }
}

/**
 * The tower's footprint and key levels, derived from the corner alone. Pure
 * arithmetic with no world access, so it stays valid even when the actual
 * block placement failed against an unloaded chunk - which is what lets
 * ensureTower() verify and retry a build, and lets the caller station a
 * guard at a position it can trust.
 */
export function towerGeometry(corner, tier) {
  const spec = TIER_SPEC[tier];
  const height = spec.height + 4;
  // Pull the tower footprint inward so it sits on the corner, not outside it
  const fDir = corner.f < 0 ? 1 : -1;
  const sDir = corner.s < 0 ? 1 : -1;
  const f1 = corner.f, f2 = corner.f + fDir * 4;
  const s1 = corner.s, s2 = corner.s + sDir * 4;
  const fMin = Math.min(f1, f2), fMax = Math.max(f1, f2);
  const sMin = Math.min(s1, s2), sMax = Math.max(s1, s2);
  const shaftTop = height - 2;
  const roomUp = height - 1;
  return {
    fMin, fMax, sMin, sMax, fDir, sDir, height, shaftTop, roomUp,
    midF: Math.round((fMin + fMax) / 2),
    midS: Math.round((sMin + sMax) / 2),
    roofBase: roomUp + 3,
    top: height + 4
  };
}

/**
 * A corner watchtower with a real guard post on top: an enclosed room with
 * window slits, a pitched roof, a ladder up the inside, a brazier and a
 * bed, so the guard stationed there has somewhere to actually be.
 * Returns the world position a guard should stand at.
 */
export function buildTower(dimension, origin, facing, corner, tier) {
  const placer = makePlacer(dimension, origin, facing);
  const spec = TIER_SPEC[tier];
  const body = spec.towerBlock;
  const post = spec.towerPost;
  const infill = spec.towerInfill;
  const roofStairs = tier === TIER_PALISADE ? "minecraft:oak_stairs" : "minecraft:stone_brick_stairs";
  const roofSolid = tier === TIER_PALISADE ? "minecraft:oak_planks" : "minecraft:stone_bricks";
  const height = spec.height + 4;

  const geom = towerGeometry(corner, tier);
  const { fMin, fMax, sMin, sMax, sDir, midF, midS } = geom;

  // clearRing() only sweeps two blocks either side of the ring line, but the
  // tower reaches four blocks inward, so its two innermost rows kept whatever
  // hillside stood there and the tower came out half-buried. Clear the whole
  // footprint (and the previous tier's tower with it) before raising it.
  placer.box(fMin, sMin, 0, fMax, sMax, geom.top, "minecraft:air");
  // Carry every footprint column down to real ground. The ring line gets this
  // from supportWallFoundation(), but the four inward rows the tower stands on
  // got nothing, so on a slope or at a shoreline the tower sat on a one-block
  // slab over open air - the "half a tower" look.
  const foundationBlock = tier === TIER_PALISADE ? "minecraft:oak_log" : "minecraft:cobblestone";
  for (let f = fMin; f <= fMax; f++) {
    for (let s = sMin; s <= sMax; s++) {
      supportWallFoundation(dimension, origin, facing, f, s, foundationBlock);
    }
  }

  // Foundation and hollow interior
  placer.box(fMin, sMin, -1, fMax, sMax, -1, body);
  placer.box(fMin + 1, sMin + 1, 0, fMax - 1, sMax - 1, height - 1, "minecraft:air");

  // Shaft walls: corner posts full height, panel infill between them, and
  // a couple of window slits - the same framed look the houses use,
  // instead of one solid block of material.
  const shaftTop = geom.shaftTop;
  for (const [f, s] of [[fMin, sMin], [fMin, sMax], [fMax, sMin], [fMax, sMax]]) {
    placer.box(f, s, 0, f, s, shaftTop, post);
  }
  for (let up = 0; up <= shaftTop; up++) {
    placer.box(fMin + 1, sMin, up, fMax - 1, sMin, up, infill);
    placer.box(fMin + 1, sMax, up, fMax - 1, sMax, up, infill);
    placer.box(fMin, sMin + 1, up, fMin, sMax - 1, up, infill);
    placer.box(fMax, sMin + 1, up, fMax, sMax - 1, up, infill);
  }
  // Window slits partway up each wall, above head height
  const winUp = Math.min(3, shaftTop - 1);
  placer.block(midF, sMin, winUp, "minecraft:glass_pane");
  placer.block(midF, sMax, winUp, "minecraft:glass_pane");
  placer.block(fMin, midS, winUp, "minecraft:glass_pane");
  placer.block(fMax, midS, winUp, "minecraft:glass_pane");

  // Ground-level door on the wall facing the village interior, leading
  // straight to the ladder - the tower was hollow with a ladder inside but
  // no way to actually walk in and reach it.
  const doorS = sDir === 1 ? sMax : sMin;
  const doorCardinal = sDir === 1 ? outwardCardinal(placer, "sMax") : outwardCardinal(placer, "sMin");
  placer.block(midF, doorS, 0, "minecraft:air");
  placer.block(midF, doorS, 1, "minecraft:air");
  placeDoor(placer, midF, doorS, 0, tier === TIER_PALISADE ? "minecraft:wooden_door" : "minecraft:spruce_door", doorCardinal);

  // Ladder up the inside
  const ladF = fMin + 1, ladS = sMin + 1;
  for (let up = 0; up <= height - 2; up++) {
    placer.block(ladF, ladS, up, "minecraft:ladder", { facing_direction: 3 });
  }

  // Guard room floor at the top of the shaft
  const roomUp = geom.roomUp;
  placer.box(fMin + 1, sMin + 1, roomUp - 1, fMax - 1, sMax - 1, roomUp - 1, roofSolid);
  placer.block(ladF, ladS, roomUp - 1, "minecraft:air");

  // Room walls with window slits on all four sides
  for (let up = roomUp; up <= roomUp + 2; up++) {
    placer.box(fMin, sMin, up, fMax, sMin, up, body);
    placer.box(fMin, sMax, up, fMax, sMax, up, body);
    placer.box(fMin, sMin, up, fMin, sMax, up, body);
    placer.box(fMax, sMin, up, fMax, sMax, up, body);
  }
  placer.box(fMin + 1, sMin + 1, roomUp, fMax - 1, sMax - 1, roomUp + 2, "minecraft:air");
  for (const [wf, ws] of [[fMin, midS], [fMax, midS], [midF, sMin], [midF, sMax]]) {
    placer.block(wf, ws, roomUp + 1, "minecraft:air");
  }

  // Pyramid roof from stairs on all four sides
  const roofBase = geom.roofBase;
  const outN = ["north", "south", "west", "east"];
  for (let i = 0; i < 2; i++) {
    const a = fMin + i, b = fMax - i, c = sMin + i, d = sMax - i;
    const up = roofBase + i;
    for (let f = a; f <= b; f++) {
      stairs(placer, f, c, up, roofStairs, outwardCardinal(placer, "sMin"), false);
      stairs(placer, f, d, up, roofStairs, outwardCardinal(placer, "sMax"), false);
    }
    for (let s = c + 1; s <= d - 1; s++) {
      stairs(placer, a, s, up, roofStairs, outwardCardinal(placer, "fMin"), false);
      stairs(placer, b, s, up, roofStairs, outwardCardinal(placer, "fMax"), false);
    }
    // solid core beneath so no daylight leaks through the pyramid
    placer.box(a + 1, c + 1, up, b - 1, d - 1, up, roofSolid);
  }
  placer.block(midF, midS, roofBase + 2, roofSolid);

  // Guard post furnishings
  placer.block(midF, midS, roomUp, "minecraft:campfire", { extinguished: false });
  placer.block(fMax - 1, sMax - 1, roomUp, "minecraft:barrel");
  placer.block(fMin + 1, sMax - 1, roomUp, "minecraft:lantern", { hanging: false });

  // Banner on the outward face of the tower
  placer.block(midF, sMin, roomUp + 2, "minecraft:air");

  return towerResult(origin, facing, geom);
}

/** The caller-facing description of a tower: guard stand plus its footprint. */
function towerResult(origin, facing, geom) {
  const stand = toWorld(origin, facing, geom.midF, geom.midS + geom.sDir, geom.roomUp);
  return {
    standAt: { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 },
    fMin: geom.fMin, fMax: geom.fMax, sMin: geom.sMin, sMax: geom.sMax, roomUp: geom.roomUp
  };
}

/**
 * Structural blocks that must exist for a tower to count as finished: one
 * post per opposite corner of the shaft, one infill panel on each of the two
 * faces that never carry the door, a guard-room corner and the roof apex.
 * Together they span the whole footprint and the full height, so any missing
 * chunk shows up here whichever way a chunk boundary cut the tower.
 */
function towerProbes(geom, tier) {
  const spec = TIER_SPEC[tier];
  const roofSolid = tier === TIER_PALISADE ? "minecraft:oak_planks" : "minecraft:stone_bricks";
  return [
    { f: geom.fMin, s: geom.sMin, up: geom.shaftTop, typeId: spec.towerPost },
    { f: geom.fMax, s: geom.sMax, up: geom.shaftTop, typeId: spec.towerPost },
    { f: geom.midF - 1, s: geom.sMin, up: 1, typeId: spec.towerInfill },
    { f: geom.fMin, s: geom.midS, up: 1, typeId: spec.towerInfill },
    { f: geom.fMax, s: geom.sMax, up: geom.roomUp + 2, typeId: spec.towerBlock },
    { f: geom.midF, s: geom.midS, up: geom.roofBase + 2, typeId: roofSolid }
  ];
}

/** True only if the tower actually landed in the world, all the way up. */
function towerIsComplete(dimension, origin, facing, geom, tier) {
  for (const probe of towerProbes(geom, tier)) {
    const p = toWorld(origin, facing, probe.f, probe.s, probe.up);
    let typeId = null;
    try {
      typeId = dimension.getBlock(p)?.typeId;
    } catch (e) {
      return false; // chunk still not loaded - nothing was written here
    }
    if (typeId !== probe.typeId) return false;
  }
  return true;
}

// Spread out far enough to cover a /tickingarea that has only just been
// registered (chunks stream in over the following ticks) and still finish
// well inside the window withLoadedArea now holds that area open for.
const TOWER_RETRY_TICKS = [20, 60, 140, 240, 340];

/**
 * Builds a corner tower and checks it is really there, retrying on a backoff
 * if it is not.
 *
 * The corner towers sit ~68 blocks diagonally from the town hall - further
 * out than anything else a village builds, and past the default simulation
 * distance - so their chunks are routinely still loading while the level-up
 * runs. setBlock()/fillBox() swallow the resulting LocationInUnloadedChunkError
 * by design, so the whole tower, or whatever part of it fell on the far side
 * of a chunk boundary, used to vanish without a trace: the "only four posts,
 * or half a tower" that showed up at every tier. Placement is idempotent, so
 * a retry simply finishes the job once the chunk is there.
 */
export function ensureTower(dimension, origin, facing, corner, tier, delaysTicks) {
  const geom = towerGeometry(corner, tier);
  const attempt = (remaining) => {
    try {
      buildTower(dimension, origin, facing, corner, tier);
    } catch (e) {
      console.warn("[village] tower build failed: " + e);
    }
    if (towerIsComplete(dimension, origin, facing, geom, tier)) return;
    if (remaining.length === 0) {
      console.warn(`[village] corner tower at f=${corner.f} s=${corner.s} still incomplete after retries`);
      return;
    }
    const [next, ...rest] = remaining;
    system.runTimeout(() => attempt(rest), next);
  };
  attempt(delaysTicks || TOWER_RETRY_TICKS);
  // Geometry is pure arithmetic, so the guard post is known even while the
  // blocks are still being retried; spawnTowerGuard has its own retry.
  return towerResult(origin, facing, geom);
}

/**
 * The whole fortification build, as a job the engine can spread over ticks.
 *
 * This used to be one unbroken synchronous pass, and that was the real reason
 * the corner towers kept coming out as bare posts or half a tower: a single
 * tier costs 41,000-72,000 native block calls, and Bedrock's script watchdog
 * TERMINATES the runtime when one tick hangs for more than 3000 ms. On a
 * phone that threshold is reached partway through the build - and since the
 * towers are the last thing raised, they are exactly what gets cut off. The
 * wall (built earlier in the same tick) survives, which is precisely the
 * "стена есть, башен нет" the bug reports show.
 *
 * As a job, no slice does more than a few hundred block calls, so the build
 * always runs to the end no matter how slow the device.
 */
export function* fortificationJob(dimension, origin, facing, rect, tier, terrain) {
  const spec = TIER_SPEC[tier];
  // clearRing's height only needs to cover this tier's own wall + tower
  // roofline (buildTower uses spec.height + 4), not a flat constant sized
  // for the tallest possible tier.
  yield* clearRingJob(dimension, origin, facing, rect, spec.height + (terrain.steep ? 14 : 8));

  // A visible wall must rest on ground even at the edge of a gentle slope.
  const foundationBlock = tier === TIER_PALISADE ? "minecraft:oak_log" : "minecraft:cobblestone";
  let done = 0;
  for (const pos of ringPositions(rect)) {
    if (!isGateway(pos, rect)) {
      supportWallFoundation(dimension, origin, facing, pos.f, pos.s, foundationBlock);
    }
    if (++done % SLICE === 0) yield;
  }

  if (tier === TIER_PALISADE) yield* palisadeJob(dimension, origin, facing, rect);
  else if (tier === TIER_COBBLE) yield* cobbleWallJob(dimension, origin, facing, rect);
  else yield* castleWallJob(dimension, origin, facing, rect);

  for (const corner of corners(rect)) {
    yield;
    try {
      ensureTower(dimension, origin, facing, corner, tier);
    } catch (e) {
      console.warn("[village] tower build failed: " + e);
    }
  }
}

/**
 * Builds (or upgrades to) a fortification tier: clears whatever ring was
 * there before, raises the new wall and puts four watchtowers on the
 * corners. Returns the tower guard positions so the caller can station
 * villagers on them.
 *
 * The blocks land over the following ticks (see fortificationJob); the
 * returned geometry is pure arithmetic and is correct immediately.
 */
export function buildFortifications(dimension, origin, facing, maxForward, tier, protectedRects) {
  const rect = perimeterFor(maxForward);
  // First make the enclosed public space safe and level. This removes only
  // natural terrain inside the new boundary, so progression never erases a
  // house built at an earlier level. protectedRects additionally excludes
  // every plot already built on, so re-running this at a later tier can
  // never repaint an existing house's floor with grass again.
  const terrain = prepareFortifiedArea(dimension, origin, facing, rect, protectedRects);

  // Keep the whole perimeter loaded for the duration of the job, then a
  // while longer so the tower retries and the guard spawns still land.
  const release = holdLoadedArea(dimension, origin, facing, rect);
  const job = fortificationJob(dimension, origin, facing, rect, tier, terrain);
  system.runJob(drainThenRelease(chainJobs(job, gateRoadJob(dimension, origin, facing, rect)), release));

  return {
    rect, tier, terrain,
    towers: corners(rect).map((corner) => towerResult(origin, facing, towerGeometry(corner, tier)))
  };
}

/** Runs several jobs back to back as one job. */
function* chainJobs(...jobs) {
  for (const job of jobs) yield* job;
}

/**
 * Levels and paves the street from gate to gate.
 *
 * The numbered levels only ever pave as far as the plot they are adding
 * (the furthest is forward 38), while the gates sit on the perimeter at
 * +/-48 - so the last ten blocks up to each gate were never road at all,
 * and the ground there was never levelled either, because the road
 * corridor is deliberately excluded from the interior terrain sweep (that
 * sweep cannot tell placed road gravel from natural gravel and used to
 * repaint the finished street as grass). Nothing owned that stretch. This
 * does: it is the fortification's job to connect its own gates to the
 * town, and it re-runs harmlessly at every later tier.
 */
function* gateRoadJob(dimension, origin, facing, rect) {
  const inPlaza = (f) => f >= CAMPFIRE_PLAZA.fMin && f <= CAMPFIRE_PLAZA.fMax;
  yield* prepareCorridorJob(dimension, origin, facing,
    rect.fMin + 1, rect.fMax - 1, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, {
      clearHeight: 8,
      fillDepth: 5,
      surfaceBlock: "minecraft:gravel",
      skipF: inPlaza
    });
  yield;
  paveRoad(dimension, origin, facing, rect.fMin + 1, rect.fMax - 1);
}

/** Runs a build job to the end, then releases the ticking area it needed. */
function* drainThenRelease(job, release) {
  try {
    yield* job;
  } finally {
    release(400);
  }
}

/**
 * Rebuilds any corner tower that is not standing, for a village that already
 * has a fortification tier.
 *
 * A build-time fix cannot help a village whose towers were already lost - the
 * fortification build only ever runs on a level-up, and that level is behind
 * the player forever. So the towers are also checked while the player is in
 * the village and quietly rebuilt when one is missing, which repairs worlds
 * broken by the older versions as well as any tower a future hiccup eats.
 *
 * Only corners whose chunks are actually loaded are touched: writing into an
 * unloaded chunk fails silently, and "missing" is indistinguishable from
 * "not loaded" from the outside, so an unloaded corner is left for a later
 * pass rather than being pointlessly rebuilt into the void.
 */
export function repairTowers(dimension, origin, facing, maxForward, tier) {
  const rect = perimeterFor(maxForward);
  const broken = [];
  for (const corner of corners(rect)) {
    const geom = towerGeometry(corner, tier);
    const probe = toWorld(origin, facing, geom.midF, geom.midS, geom.roomUp);
    if (!chunkIsLoaded(dimension, probe)) continue;
    if (!towerIsComplete(dimension, origin, facing, geom, tier)) broken.push(corner);
  }
  if (broken.length === 0) return 0;
  system.runJob(repairJob(dimension, origin, facing, broken, tier));
  return broken.length;
}

function* repairJob(dimension, origin, facing, brokenCorners, tier) {
  for (const corner of brokenCorners) {
    yield;
    try {
      buildTower(dimension, origin, facing, corner, tier);
    } catch (e) {
      console.warn("[village] tower repair failed: " + e);
    }
  }
}

/**
 * dimension.isChunkLoaded is the engine's own answer to "will a write here
 * land?" - far more reliable than inferring it from a thrown error, and it
 * costs nothing. Older engines predate it, so fall back to probing.
 */
function chunkIsLoaded(dimension, location) {
  if (typeof dimension.isChunkLoaded === "function") {
    try {
      return dimension.isChunkLoaded(location);
    } catch (e) {
      return false;
    }
  }
  try {
    return !!dimension.getBlock(location);
  } catch (e) {
    return false;
  }
}
