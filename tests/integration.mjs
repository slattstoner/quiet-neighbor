import { __test__ } from "@minecraft/server";
import { foundVillage, chestSatisfiesRequirements, tryLevelUp, getVillageState } from "./scripts/village.js";
import { toWorld } from "./scripts/util.js";
import { LEVELS, MAX_BETA_LEVEL } from "./scripts/levels.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}
function blockAt(dim, x, y, z) {
  return dim.getBlock({ x, y, z }).typeId;
}

/**
 * Checks a building's four walls for air gaps. The two-block doorway is
 * the only sanctioned opening; anything else means a later build step
 * (a road, a neighbouring house, terrain levelling) carved into it.
 */
function checkWalls(dim, origin, facing, shape, label) {
  let holes = 0;
  for (let up = 0; up <= shape.height - 1; up++) {
    for (let f = shape.f1; f <= shape.f2; f++) {
      for (const s of [shape.sMin, shape.sMax]) {
        if (f === shape.doorForward && s === shape.s1 && up <= 1) continue;
        const p = toWorld(origin, facing, f, s, up);
        if (blockAt(dim, p.x, p.y, p.z) === "minecraft:air") {
          holes++;
          if (holes <= 5) console.error(`  [${label}] hole at local(f=${f},s=${s},up=${up})`);
        }
      }
    }
  }
  return holes;
}

const player = __test__.makePlayer("Integr", { x: 1000, y: 70, z: 1000 });
const elder = foundVillage(player, { x: 1000, y: 70, z: 1000 }, 0);
const state = getVillageState(elder);
const origin = state.origin;
const facing = state.facing;
assert(elder.getDynamicProperty("village:chestX") !== undefined, "village founded with a chest coordinate stored");

const chestBlock = elder.dimension.getBlock(state.chest);
const builtShapes = [];

for (let level = 2; level <= MAX_BETA_LEVEL; level++) {
  const cfg = LEVELS[level];
  const container = chestBlock.getComponent("minecraft:inventory").container;
  let slot = 0;
  for (const [id, count] of Object.entries(cfg.requirements)) {
    container.setItem(slot++, { typeId: id, amount: count });
  }
  const check = chestSatisfiesRequirements(elder);
  assert(check.done, `level ${level}: chest satisfied before building`);

  const result = tryLevelUp(elder);
  assert(result.done, `level ${level}: built successfully`);
  // This legacy structural regression owns L2–10 house-shape assertions.
  // L11–15 expose city metadata rather than house-shape fields and are
  // exhaustively validated by city_progression_11_15.mjs.
  if (result.shape && level <= 10) builtShapes.push({ label: `level${level} ${cfg.label}`, shape: result.shape });
}

// Every building erected earlier must still be intact after all the
// later levels (and their terrain levelling) have run.
let totalHoles = 0;
for (const b of builtShapes) {
  totalHoles += checkWalls(elder.dimension, origin, facing, b.shape, b.label);
}
assert(totalHoles === 0, `no building's walls were damaged by later construction (found ${totalHoles} holes total)`);

// Footprints must not overlap each other
function overlaps(a, b) {
  const fOverlap = a.f1 <= b.f2 && b.f1 <= a.f2;
  const sOverlap = a.sMin <= b.sMax && b.sMin <= a.sMax;
  return fOverlap && sOverlap;
}
let overlapCount = 0;
for (let i = 0; i < builtShapes.length; i++) {
  for (let j = i + 1; j < builtShapes.length; j++) {
    if (overlaps(builtShapes[i].shape, builtShapes[j].shape)) {
      overlapCount++;
      console.error(`  OVERLAP: ${builtShapes[i].label} <-> ${builtShapes[j].label}`);
    }
  }
}
assert(overlapCount === 0, `no two building plots overlap (found ${overlapCount})`);

// Each craftsman house must contain its profession's job-site block
const jobSites = ["minecraft:composter", "minecraft:blast_furnace", "minecraft:cartography_table"];
let foundJobSites = 0;
for (const b of builtShapes) {
  for (let f = b.shape.f1 + 1; f <= b.shape.f2 - 1; f++) {
    for (let s = b.shape.sMin + 1; s <= b.shape.sMax - 1; s++) {
      const p = toWorld(origin, facing, f, s, 0);
      if (jobSites.includes(blockAt(elder.dimension, p.x, p.y, p.z))) foundJobSites++;
    }
  }
}
assert(foundJobSites >= 3, `craftsman houses contain their job-site blocks (${foundJobSites})`);

// The street is a crossroads, not a single through-road: two three-wide arms
// crossing at the town hall, each running out to a gate in the wall. Both
// centrelines are cobblestone and their verges gravel (paveCrossroadsArms in
// builder.js lays the near stretches as the village grows, the defence stage
// lays the rest out to the gates - deliberately the same two materials, so
// the join does not show).
//
// This runs at level 10, so the castle wall stands at R78 and both arms
// should be continuous the whole way to it. Nothing may be paved *through* a
// building either, which is what the plot-overlap check above would miss: a
// road arm cutting a house in half leaves both footprints intact.
const ROAD_SURFACES = new Set(["minecraft:cobblestone", "minecraft:gravel"]);
let missingRoad = 0;
for (let position = -78; position <= 78; position++) {
  for (let offset = -1; offset <= 1; offset++) {
    for (const [f, s] of [[position, offset], [offset, position]]) {
      const p = toWorld(origin, facing, f, s, -1);
      if (!ROAD_SURFACES.has(blockAt(elder.dimension, p.x, p.y, p.z))) missingRoad++;
    }
  }
}
assert(missingRoad === 0, `both crossroads arms are paved continuously out to the wall (${missingRoad} gap(s))`);

// The arms must stay clear overhead too - a house standing in the roadway
// would show up here rather than in the footprint checks above.
let blockedRoad = 0;
for (let position = -78; position <= 78; position++) {
  for (const [f, s] of [[position, 0], [0, position]]) {
    for (let up = 0; up <= 2; up++) {
      const p = toWorld(origin, facing, f, s, up);
      if (blockAt(elder.dimension, p.x, p.y, p.z) !== "minecraft:air") blockedRoad++;
    }
  }
}
assert(blockedRoad === 0, `nothing stands in either roadway (${blockedRoad} blocked cell(s))`);

console.log(failures === 0 ? "\nALL INTEGRATION TESTS PASSED" : `\n${failures} INTEGRATION TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
