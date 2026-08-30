import { compassFor, facingBlock, gabledRoof, makePlacer, paletteMats, placeBed, placeDoor, stairs } from "./builder.js";
import { prepareSite, sampleGroundLevel, withLoadedArea } from "./terrain.js";
import { slotById } from "./quarters.js";

/**
 * Builders for the district plots in quarters.js.
 *
 * These are archetypes, not one function per building. A plot says what kind
 * of thing stands on it (cottage / workshop / yard / civic / commons) and this
 * module knows how to build that kind anywhere, from the plot's own bounds.
 * Eighteen bespoke builders with eighteen sets of hardcoded coordinates is
 * exactly the shape of code that produced the overlapping farmer outbuildings
 * (HANDOVER.md, "Грабли" #6); deriving everything from one rectangle makes
 * "it fits on its plot" arithmetic rather than vigilance.
 *
 * Materials always go through paletteMats() so a district follows the village
 * biome instead of staying stubbornly oak - the other half of that same
 * lesson (#7).
 */

const HOUSE_MATS = {
  foundation: "minecraft:cobblestone",
  wall: "minecraft:oak_planks",
  corner: "minecraft:oak_log",
  floor: "minecraft:oak_planks",
  roofStairs: "minecraft:oak_stairs",
  gable: "minecraft:oak_planks"
};

const CIVIC_MATS = {
  foundation: "minecraft:stone_bricks",
  wall: "minecraft:stone_bricks",
  corner: "minecraft:stripped_oak_log",
  floor: "minecraft:polished_andesite",
  roofStairs: "minecraft:stone_brick_stairs",
  gable: "minecraft:stone_bricks"
};

/**
 * A placer that refuses to write outside the plot.
 *
 * Same guard city_buildings_11_15.js uses. It matters more here: these
 * buildings sit in the gaps between everything else, so a stray block is not a
 * cosmetic slip - it lands in a neighbour's plot or in the roadway. Throwing
 * turns that into a build failure the runtime records and reports, instead of
 * silent damage the player finds later.
 */
function boundedPlacer(dimension, origin, facing, bounds, slotId) {
  const raw = makePlacer(dimension, origin, facing);
  const check = (f1, f2, s1, s2, what) => {
    const fMin = Math.min(f1, f2), fMax = Math.max(f1, f2);
    const sMin = Math.min(s1, s2), sMax = Math.max(s1, s2);
    if (fMin < bounds.fMin || fMax > bounds.fMax || sMin < bounds.sMin || sMax > bounds.sMax) {
      throw new Error(`${slotId}: ${what} leaves its plot (f ${fMin}..${fMax}, s ${sMin}..${sMax})`);
    }
  };
  return {
    facing: raw.facing,
    block(f, s, up, typeId, states) { check(f, f, s, s, typeId); raw.block(f, s, up, typeId, states); },
    blockMulti(f, s, up, typeId, candidates) { check(f, f, s, s, typeId); raw.blockMulti(f, s, up, typeId, candidates); },
    box(f1, s1, u1, f2, s2, u2, typeId, states) { check(f1, f2, s1, s2, typeId); raw.box(f1, s1, u1, f2, s2, u2, typeId, states); }
  };
}

/**
 * A rectangle of the requested size, centred in the plot.
 *
 * `margin` is the room the caller needs *outside* the rectangle - a gabled
 * roof overhangs by one block on all four sides (see builder.js#gabledRoof),
 * and a yard fence needs its own ring - so the shape is grown from the centre
 * only as far as the plot can hold it with that margin intact.
 */
function centredRect(bounds, width, depth, margin = 1) {
  const availableF = bounds.fMax - bounds.fMin + 1 - margin * 2;
  const availableS = bounds.sMax - bounds.sMin + 1 - margin * 2;
  const w = Math.min(width, availableF);
  const d = Math.min(depth, availableS);
  const centreF = Math.floor((bounds.fMin + bounds.fMax) / 2);
  const centreS = Math.floor((bounds.sMin + bounds.sMax) / 2);
  const f1 = centreF - Math.floor((w - 1) / 2);
  const s1 = centreS - Math.floor((d - 1) / 2);
  return { f1, f2: f1 + w - 1, s1, s2: s1 + d - 1, centreF, centreS };
}

/**
 * Which wall the door goes in, and which way it faces.
 *
 * Always a side wall, never a gable end: the ridge of gabledRoof() runs along
 * the forward axis, so the side walls are the low ones a door belongs in. The
 * door then faces whichever road arm is nearer, so a district reads as facing
 * the town rather than turning its back on it.
 */
function doorFacing(rect, facing) {
  const compass = compassFor(facing);
  const towardTown = rect.centreS >= 0;
  return {
    s: towardTown ? rect.s1 : rect.s2,
    cardinal: towardTown ? compass.minusSide : compass.plusSide,
    inward: towardTown ? compass.plusSide : compass.minusSide
  };
}

/** Four walls, corner posts, a hollow interior and a floor. */
function shell(placer, rect, mats, height) {
  const { f1, f2, s1, s2 } = rect;
  placer.box(f1, s1, -1, f2, s2, -1, mats.foundation);
  for (let up = 0; up <= height - 1; up++) {
    const material = up === 0 ? mats.foundation : up === height - 1 ? mats.corner : mats.wall;
    placer.box(f1, s1, up, f2, s1, up, material);
    placer.box(f1, s2, up, f2, s2, up, material);
    placer.box(f1, s1, up, f1, s2, up, material);
    placer.box(f2, s1, up, f2, s2, up, material);
  }
  for (const f of [f1, f2]) for (const s of [s1, s2]) placer.box(f, s, 0, f, s, height - 1, mats.corner);
  placer.box(f1 + 1, s1 + 1, 0, f2 - 1, s2 - 1, height - 2, "minecraft:air");
  placer.box(f1 + 1, s1 + 1, -1, f2 - 1, s2 - 1, -1, mats.floor);
}

/** Windows in both side walls, kept off the door column. */
function windows(placer, rect, doorF) {
  const { f1, f2, s1, s2 } = rect;
  for (let f = f1 + 1; f <= f2 - 1; f += 2) {
    if (f === doorF) continue;
    placer.block(f, s1, 2, "minecraft:glass_pane");
    placer.block(f, s2, 2, "minecraft:glass_pane");
  }
}

function lightInside(placer, rect, height) {
  placer.block(rect.f1 + 1, rect.s1 + 1, height - 2, "minecraft:lantern", { hanging: true });
  placer.block(rect.f2 - 1, rect.s2 - 1, height - 2, "minecraft:lantern", { hanging: true });
}

/**
 * A house: cottage and workshop are the same building, and differ only in what
 * stands in it. A workshop's job-site block is the whole point - a villager
 * claims it a few seconds after spawning and takes up that profession through
 * vanilla AI, which is also what gives it real vanilla trades.
 */
function buildHouse(placer, bounds, mats, spec, facing) {
  const height = 5;
  const rect = centredRect(bounds, 9, 9, 1);
  const door = doorFacing(rect, facing);
  const doorF = Math.floor((rect.f1 + rect.f2) / 2);

  shell(placer, rect, mats, height);
  placer.block(doorF, door.s, 0, "minecraft:air");
  placer.block(doorF, door.s, 1, "minecraft:air");
  placeDoor(placer, doorF, door.s, 0, "minecraft:wooden_door", door.cardinal);
  windows(placer, rect, doorF);
  gabledRoof(placer, rect.f1, rect.f2, rect.s1, rect.s2, height - 1, mats.roofStairs, mats.gable);

  const backS = door.s === rect.s1 ? rect.s2 - 1 : rect.s1 + 1;
  const frontS = door.s === rect.s1 ? rect.s1 + 1 : rect.s2 - 1;
  placeBed(placer, rect.f1 + 1, backS, 0, door.cardinal);
  facingBlock(placer, rect.f2 - 1, backS, 0, "minecraft:chest", door.cardinal);
  if (spec.jobSite) facingBlock(placer, rect.f1 + 1, frontS, 0, spec.jobSite, door.inward);
  placer.block(rect.f2 - 1, frontS, 0, "minecraft:crafting_table");
  lightInside(placer, rect, height);
  return { rect, door: { f: doorF, s: door.s }, height };
}

/** A public building: taller, stone, no bed - nobody lives in it. */
function buildCivic(placer, bounds, mats, spec, facing) {
  const height = 6;
  const rect = centredRect(bounds, 9, 9, 1);
  const door = doorFacing(rect, facing);
  const doorF = Math.floor((rect.f1 + rect.f2) / 2);

  shell(placer, rect, mats, height);
  placer.block(doorF, door.s, 0, "minecraft:air");
  placer.block(doorF, door.s, 1, "minecraft:air");
  placeDoor(placer, doorF, door.s, 0, "minecraft:dark_oak_door", door.cardinal);
  windows(placer, rect, doorF);
  gabledRoof(placer, rect.f1, rect.f2, rect.s1, rect.s2, height - 1, mats.roofStairs, mats.gable);

  const backS = door.s === rect.s1 ? rect.s2 - 1 : rect.s1 + 1;
  for (const f of [rect.f1 + 1, rect.f2 - 1]) {
    placer.block(f, backS, 0, "minecraft:bookshelf");
    placer.block(f, backS, 1, "minecraft:bookshelf");
  }
  // The runner is laid before the fittings, not after: it runs from the door
  // straight to the back wall, which is exactly the column the job-site block
  // stands in, and laying it last quietly replaced the lectern with carpet -
  // leaving a building whose villager could never claim a profession.
  placer.box(doorF, rect.s1 + 1, 0, doorF, rect.s2 - 1, 0, "minecraft:red_carpet");
  if (spec.jobSite) facingBlock(placer, doorF, backS, 0, spec.jobSite, door.cardinal);
  lightInside(placer, rect, height);
  return { rect, door: { f: doorF, s: door.s }, height };
}

/** What stands in an open working yard, per plot. */
const YARD_PROPS = Object.freeze({
  "trade_slope.stable": [
    { at: [-2, -2], typeId: "minecraft:hay_block" }, { at: [-2, 0], typeId: "minecraft:hay_block" },
    { at: [2, -2], typeId: "minecraft:barrel" }, { at: [2, 2], typeId: "minecraft:chest" },
    { at: [0, 2], typeId: "minecraft:cauldron" }
  ],
  "upper_meadow.apiary": [
    { at: [-2, -2], typeId: "minecraft:beehive" }, { at: [0, -2], typeId: "minecraft:beehive" },
    { at: [2, -2], typeId: "minecraft:beehive" }, { at: [-2, 2], typeId: "minecraft:composter" },
    { at: [2, 2], typeId: "minecraft:oak_leaves" }
  ],
  "craft_row.woodyard": [
    { at: [-2, -2], typeId: "minecraft:oak_log" }, { at: [-2, 0], typeId: "minecraft:oak_log" },
    { at: [-2, 2], typeId: "minecraft:oak_log" }, { at: [2, -2], typeId: "minecraft:chest" },
    { at: [2, 2], typeId: "minecraft:crafting_table" }
  ],
  "north_gate_yards.granary_annex": [
    { at: [-2, -2], typeId: "minecraft:hay_block" }, { at: [-2, 2], typeId: "minecraft:hay_block" },
    { at: [0, 0], typeId: "minecraft:barrel" }, { at: [2, -2], typeId: "minecraft:barrel" },
    { at: [2, 2], typeId: "minecraft:composter" }
  ]
});

/** An open working yard: a fenced apron with a lean-to along one edge. */
function buildYard(placer, bounds, mats, spec, facing) {
  const rect = centredRect(bounds, 11, 11, 1);
  const { f1, f2, s1, s2 } = rect;
  const compass = compassFor(facing);

  placer.box(f1, s1, -1, f2, s2, -1, "minecraft:coarse_dirt");
  placer.box(f1 + 1, s1 + 1, -1, f2 - 1, s2 - 1, -1, "minecraft:gravel");
  placer.box(f1, s1, 0, f2, s2, 2, "minecraft:air");

  // Fence ring with a gap facing the town.
  const gateS = rect.centreS >= 0 ? s1 : s2;
  const gateF = Math.floor((f1 + f2) / 2);
  for (let f = f1; f <= f2; f++) {
    for (const s of [s1, s2]) {
      if (s === gateS && Math.abs(f - gateF) <= 1) continue;
      placer.block(f, s, 0, "minecraft:oak_fence");
    }
  }
  for (let s = s1 + 1; s <= s2 - 1; s++) for (const f of [f1, f2]) placer.block(f, s, 0, "minecraft:oak_fence");

  // Lean-to against the back edge, so the yard has a roofed corner.
  const backS = gateS === s1 ? s2 : s1;
  const shelterS = backS + (gateS === s1 ? -1 : 1);
  for (const f of [f1 + 1, f2 - 1]) placer.box(f, shelterS, 0, f, shelterS, 2, mats.corner);
  placer.box(f1 + 1, shelterS, 3, f2 - 1, shelterS, 3, mats.gable);
  for (let f = f1 + 1; f <= f2 - 1; f++) {
    stairs(placer, f, shelterS + (gateS === s1 ? 1 : -1), 3, mats.roofStairs,
      gateS === s1 ? compass.minusSide : compass.plusSide, false);
  }
  placer.block(Math.floor((f1 + f2) / 2), shelterS, 3, "minecraft:lantern", { hanging: true });

  for (const prop of YARD_PROPS[spec.id] || []) {
    placer.block(rect.centreF + prop.at[0], rect.centreS + prop.at[1], 0, prop.typeId);
  }
  return { rect, door: { f: gateF, s: gateS }, height: 3 };
}

/** An unwalled public fitting: the well, and the covered gathering spot. */
function buildCommons(placer, bounds, mats, spec, facing) {
  const rect = centredRect(bounds, 9, 9, 1);
  const { centreF, centreS } = rect;
  const compass = compassFor(facing);

  placer.box(rect.f1, rect.s1, -1, rect.f2, rect.s2, -1, "minecraft:cobblestone");
  placer.box(rect.f1 + 1, rect.s1 + 1, -1, rect.f2 - 1, rect.s2 - 1, -1, "minecraft:gravel");
  placer.box(rect.f1, rect.s1, 0, rect.f2, rect.s2, 4, "minecraft:air");

  const isWell = spec.id.endsWith(".well");
  if (isWell) {
    placer.box(centreF - 1, centreS - 1, -1, centreF + 1, centreS + 1, -1, "minecraft:cobblestone");
    placer.box(centreF - 1, centreS - 1, 0, centreF + 1, centreS + 1, 0, "minecraft:cobblestone_wall");
    placer.block(centreF, centreS, -1, "minecraft:water");
    placer.block(centreF, centreS, 0, "minecraft:air");
  } else {
    placer.box(centreF - 1, centreS - 1, -1, centreF + 1, centreS + 1, -1, "minecraft:cobblestone");
    placer.block(centreF, centreS, 0, "minecraft:campfire", { extinguished: false });
    for (const [df, ds] of [[-2, -2], [2, 2], [-2, 2], [2, -2]]) {
      placer.block(centreF + df, centreS + ds, 0, "minecraft:oak_log");
    }
  }

  // Four posts and a plank canopy - the same silhouette the miner's pit-head
  // uses, so the two read as the same village's carpentry.
  for (const df of [-2, 2]) for (const ds of [-2, 2]) placer.box(centreF + df, centreS + ds, 1, centreF + df, centreS + ds, 3, mats.corner);
  placer.box(centreF - 2, centreS - 2, 4, centreF + 2, centreS + 2, 4, mats.gable);
  for (let f = centreF - 2; f <= centreF + 2; f++) {
    stairs(placer, f, centreS - 3, 4, mats.roofStairs, compass.minusSide, false);
    stairs(placer, f, centreS + 3, 4, mats.roofStairs, compass.plusSide, false);
  }
  placer.block(centreF, centreS, 3, "minecraft:lantern", { hanging: true });
  return { rect, door: { f: centreF, s: centreS }, height: 4 };
}

const ARCHETYPES = Object.freeze({
  cottage: { build: buildHouse, mats: HOUSE_MATS },
  workshop: { build: buildHouse, mats: HOUSE_MATS },
  civic: { build: buildCivic, mats: CIVIC_MATS },
  yard: { build: buildYard, mats: HOUSE_MATS },
  commons: { build: buildCommons, mats: HOUSE_MATS }
});

/**
 * Builds one district plot. `state` carries the village origin, facing and
 * palette (village.js#getVillageState's shape).
 *
 * Returns a result rather than throwing: a district building is optional
 * content and a failure on one plot must never stop the village or the next
 * plot from working.
 */
export function buildQuarterSlot(slotId, dimension, state) {
  const spec = slotById(slotId);
  if (!spec) return { ok: false, reason: "unknown_slot", slotId };
  const archetype = ARCHETYPES[spec.kind];
  if (!archetype) return { ok: false, reason: "unknown_kind", slotId };
  if (!dimension || !state?.origin) return { ok: false, reason: "no_state", slotId };

  const bounds = spec.bounds;
  try {
    let shape = null;
    // A plot out at forward 81 is far past what is loaded around whoever
    // triggered the build, and setBlock swallows unloaded-chunk errors - so
    // without this the building would half-exist with no error anywhere.
    withLoadedArea(dimension, state.origin, state.facing, bounds, () => {
      const sample = sampleGroundLevel(dimension, state.origin, state.facing,
        bounds.fMin, bounds.fMax, bounds.sMin, bounds.sMax);
      prepareSite(dimension, state.origin, state.facing,
        bounds.fMin, bounds.fMax, bounds.sMin, bounds.sMax, {
          padding: 0,
          clearHeight: 10,
          fillDepth: 6,
          surfaceBlock: "minecraft:grass_block",
          surfaceType: sample.surfaceType
        });
      const placer = boundedPlacer(dimension, state.origin, state.facing, bounds, slotId);
      const mats = paletteMats(archetype.mats, state.palette);
      shape = archetype.build(placer, bounds, mats, spec, state.facing);
    });
    return { ok: true, slotId, kind: spec.kind, label: spec.label, shape, spec };
  } catch (error) {
    console.warn(`[village] quarter building ${slotId} failed: ${error}`);
    return { ok: false, reason: "build_failed", slotId, error: String(error) };
  }
}

/** Where this plot's villager should be spawned, in local village coordinates. */
export function residentAnchorFor(shape) {
  return {
    f: Math.floor((shape.rect.f1 + shape.rect.f2) / 2),
    s: Math.floor((shape.rect.s1 + shape.rect.s2) / 2)
  };
}
