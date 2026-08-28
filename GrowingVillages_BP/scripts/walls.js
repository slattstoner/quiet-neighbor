import { setBlock, toWorld } from "./util.js";
import { makePlacer, stairs, facingBlock, placeDoor } from "./builder.js";
import { prepareFortifiedArea, supportWallFoundation } from "./terrain.js";

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
  // Every side of the square has a five-block gate aligned with one arm of
  // the crossroads. This keeps travel possible from all four quadrants.
  if ((pos.edge === "fMax" || pos.edge === "fMin") && Math.abs(pos.s) <= 2) return true;
  if ((pos.edge === "sMax" || pos.edge === "sMin") && Math.abs(pos.f) <= 2) return true;
  return false;
}

/** Clears the whole fortification volume so a new tier can replace the old one. */
export function clearRing(dimension, origin, facing, rect, maxHeight) {
  const placer = makePlacer(dimension, origin, facing);
  const positions = ringPositions(rect);
  const height = maxHeight || 12;
  for (const pos of positions) {
    for (let d = -2; d <= 2; d++) {
      // clear a band either side of the ring line so towers and walkways go too
      const f = pos.edge === "sMin" || pos.edge === "sMax" ? pos.f : pos.f + d;
      const s = pos.edge === "sMin" || pos.edge === "sMax" ? pos.s + d : pos.s;
      for (let up = 0; up <= height; up++) {
        placer.block(f, s, up, "minecraft:air");
      }
    }
  }
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
function buildPalisade(dimension, origin, facing, rect, gateForward) {
  const placer = makePlacer(dimension, origin, facing);
  const spec = TIER_SPEC[TIER_PALISADE];
  const positions = ringPositions(rect);

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
  }

  buildGateway(placer, rect, TIER_PALISADE);
  return TIER_PALISADE;
}

/** TIER 2 - Cobblestone curtain wall with a walkway and a wall-block parapet. */
function buildCobbleWall(dimension, origin, facing, rect, gateForward) {
  const placer = makePlacer(dimension, origin, facing);
  const spec = TIER_SPEC[TIER_COBBLE];
  const positions = ringPositions(rect);

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
  }

  buildGateway(placer, rect, TIER_COBBLE);
  return TIER_COBBLE;
}

/**
 * TIER 3 - Castle curtain wall: stone brick, taller, with proper merlons
 * (alternating raised crenellations) and arrow slits at chest height.
 */
function buildCastleWall(dimension, origin, facing, rect, gateForward) {
  const placer = makePlacer(dimension, origin, facing);
  const spec = TIER_SPEC[TIER_CASTLE];
  const positions = ringPositions(rect);

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
  }

  buildGateway(placer, rect, TIER_CASTLE);
  return TIER_CASTLE;
}

/** Gatehouse: flanking piers, an arch over the road, and a clear passage. */
function buildGateway(placer, rect, tier) {
  const spec = TIER_SPEC[tier];
  const block = spec.wallBlock;
  const accent = tier === TIER_PALISADE ? "minecraft:oak_log" : "minecraft:stone_bricks";

  for (const edge of ["fMax", "fMin", "sMax", "sMin"]) {
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
    // Clear the passage itself, full width.
    for (let offset = -2; offset <= 2; offset++) {
      const p = at(offset);
      for (let up = 0; up <= spec.height - 1; up++) placer.block(p.f, p.s, up, "minecraft:air");
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

  const f0 = corner.f, s0 = corner.s;
  // Pull the tower footprint inward so it sits on the corner, not outside it
  const fDir = f0 < 0 ? 1 : -1;
  const sDir = s0 < 0 ? 1 : -1;
  const f1 = f0, f2 = f0 + fDir * 4;
  const s1 = s0, s2 = s0 + sDir * 4;
  const fMin = Math.min(f1, f2), fMax = Math.max(f1, f2);
  const sMin = Math.min(s1, s2), sMax = Math.max(s1, s2);
  const midF = Math.round((fMin + fMax) / 2), midS = Math.round((sMin + sMax) / 2);

  // Foundation and hollow interior
  placer.box(fMin, sMin, -1, fMax, sMax, -1, body);
  placer.box(fMin + 1, sMin + 1, 0, fMax - 1, sMax - 1, height - 1, "minecraft:air");

  // Shaft walls: corner posts full height, panel infill between them, and
  // a couple of window slits - the same framed look the houses use,
  // instead of one solid block of material.
  const shaftTop = height - 2;
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
  const roomUp = height - 1;
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
  const roofBase = roomUp + 3;
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

  const stand = toWorld(origin, facing, midF, midS + (sDir), roomUp);
  return { standAt: { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 }, fMin, fMax, sMin, sMax, roomUp };
}

/**
 * Builds (or upgrades to) a fortification tier: clears whatever ring was
 * there before, raises the new wall and puts four watchtowers on the
 * corners. Returns the tower guard positions so the caller can station
 * villagers on them.
 */
export function buildFortifications(dimension, origin, facing, maxForward, tier, protectedRects) {
  const rect = perimeterFor(maxForward);
  // First make the enclosed public space safe and level. This removes only
  // natural terrain inside the new boundary, so progression never erases a
  // house built at an earlier level. protectedRects additionally excludes
  // every plot already built on, so re-running this at a later tier can
  // never repaint an existing house's floor with grass again.
  const terrain = prepareFortifiedArea(dimension, origin, facing, rect, protectedRects);
  // clearRing's height only needs to cover this tier's own wall + tower
  // roofline (buildTower uses spec.height + 4), not a flat constant sized
  // for the tallest possible tier - that flat 16/30 cleared 2-4x more
  // vertical space than a tier-1 palisade (height 4) ever needs, adding
  // pure waste on top of the interior sweep at exactly the level (L5) that
  // triggered the watchdog hang.
  const spec = TIER_SPEC[tier];
  const clearRingHeight = spec.height + (terrain.steep ? 14 : 8);
  clearRing(dimension, origin, facing, rect, clearRingHeight);

  // A visible wall must rest on ground even at the edge of a gentle slope.
  // On steep terrain the cleared village plane gives all supports the same
  // height, avoiding a jagged "staircase" perimeter.
  const foundationBlock = tier === TIER_PALISADE ? "minecraft:oak_log" : "minecraft:cobblestone";
  for (const pos of ringPositions(rect)) {
    if (!isGateway(pos, rect)) {
      supportWallFoundation(dimension, origin, facing, pos.f, pos.s, foundationBlock);
    }
  }

  if (tier === TIER_PALISADE) buildPalisade(dimension, origin, facing, rect);
  else if (tier === TIER_COBBLE) buildCobbleWall(dimension, origin, facing, rect);
  else buildCastleWall(dimension, origin, facing, rect);

  const towers = [];
  for (const corner of corners(rect)) {
    try {
      towers.push(buildTower(dimension, origin, facing, corner, tier));
    } catch (e) {
      console.warn("[village] tower build failed: " + e);
    }
  }
  return { rect, towers, tier, terrain };
}
