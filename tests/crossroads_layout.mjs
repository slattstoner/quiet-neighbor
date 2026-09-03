// Stage 1: the crossroads layout.
//
// The bug this exists to stop coming back: the village used to grow OUTWARD
// THROUGH ITS OWN WALL. The wall was a fixed R48 square sized off
// fullVillageMaxForward(), while city_buildings_11_15.js,
// special_buildings_16_18.js and final_city_19_20.js all took their
// coordinates from spatial_plan.js - which is drawn for R94. Eight of the
// twenty planned buildings (levels 12-18) therefore landed outside the wall,
// while the ground inside it stayed empty.
//
// Every check below fails on the pre-crossroads code.

import { __test__, system } from "@minecraft/server";
import {
  SPATIAL_PLAN, PERIMETER_SCHEDULE, ROAD_AXES, FINAL_RADIUS,
  boundsFor, rectanglesOverlap, touchesRoadAxis, scheduleForLevel
} from "./scripts/spatial_plan.js";
import { QUARTERS, ALL_SLOTS, BUILDABLE_INNER_RADIUS, slotsUnlockedAt } from "./scripts/quarters.js";
import { V2_FOUNDING, plotPlacementFor, villageRadiusFor, defenceStageForLevel, LAYOUT_V2 } from "./scripts/levels.js";
import { planDefenceStage, buildDefenceStageJob, towerFootprintsForStage } from "./scripts/defences_roads.js";
import { specialPlacement } from "./scripts/specials.js";
import { loadedAreaCountFor } from "./scripts/terrain.js";
import { foundVillage, getVillageState } from "./scripts/village.js";

let checks = 0, failures = 0;
function assert(condition, label) {
  checks++;
  if (condition) console.log(`ok: ${label}`);
  else { failures++; console.error(`FAIL: ${label}`); }
}

const overlap = (a, b) => a.fMin <= b.fMax && a.fMax >= b.fMin && a.sMin <= b.sMax && a.sMax >= b.sMin;
const insideRadius = (r, radius) => r.fMin >= -radius && r.fMax <= radius && r.sMin >= -radius && r.sMax <= radius;

// ---------------------------------------------------------------- 1
console.log("=== every planned building ends up inside the wall it is built behind ===");
// The wall at a level is whatever PERIMETER_SCHEDULE has raised by then; the
// inner face is one block in from the ring line.
for (const entry of SPATIAL_PLAN) {
  const stage = scheduleForLevel(Math.max(entry.level, PERIMETER_SCHEDULE[0].level));
  const innerFace = stage.radius - 1;
  assert(insideRadius(entry.bounds, innerFace),
    `L${entry.level} ${entry.buildingId}: inside the R${stage.radius} wall (f ${entry.bounds.fMin}..${entry.bounds.fMax}, s ${entry.bounds.sMin}..${entry.bounds.sMax})`);
}
// And the levels that used to fall outside, stated explicitly so the failure
// names the actual regression rather than a radius arithmetic slip.
//
// 12-15, not 12-19: SPATIAL_PLAN is the L1-15 authority now. L16-20 bounds
// live beside their builders, and extension_allocations.mjs holds them to a
// stricter version of this same check - at least 20 blocks of clearance from
// the curtain rather than merely inside it.
for (const level of [12, 13, 14, 15]) {
  const entry = SPATIAL_PLAN.find((item) => item.level === level);
  assert(insideRadius(entry.bounds, FINAL_RADIUS - 1),
    `L${level} ${entry.buildingId}: no longer stranded outside the curtain wall`);
}

// ---------------------------------------------------------------- 2
console.log("\n=== the crossroads roadway is nobody's building plot ===");
for (const entry of SPATIAL_PLAN) {
  assert(!touchesRoadAxis(entry.bounds), `${entry.buildingId}: clear of both road arms`);
}

// ---------------------------------------------------------------- 3
console.log("\n=== level-1 buildings are off the side road ===");
// The legacy town hall sat at f -1..9, straight across the crossroads' side
// road (f -1..1, s -94..94), so the road would have cut it in half.
const houseBox = (placement, width, depth) => ({
  fMin: placement.plotForward - 1,
  fMax: placement.plotForward + width,
  sMin: placement.side - Math.floor(depth / 2) - 1,
  sMax: placement.side + Math.floor(depth / 2) + 1
});
const foundingBoxes = [
  ["town hall", houseBox(V2_FOUNDING.townHall, 9, 9), "town_hall"],
  ["starter house", houseBox(V2_FOUNDING.starterHouse, 7, 7), "starter_house"],
  ["campfire plaza", { fMin: V2_FOUNDING.campfire.plotForward - 3, fMax: V2_FOUNDING.campfire.plotForward + 3, sMin: V2_FOUNDING.campfire.side - 3, sMax: V2_FOUNDING.campfire.side + 3 }, "campfire"]
];
for (const [label, box, buildingId] of foundingBoxes) {
  assert(!touchesRoadAxis(box), `${label}: clear of both road arms`);
  const planned = boundsFor(buildingId).bounds;
  assert(box.fMin >= planned.fMin && box.fMax <= planned.fMax && box.sMin >= planned.sMin && box.sMax <= planned.sMax,
    `${label}: sits inside its own spatial_plan envelope`);
}

// ---------------------------------------------------------------- 4
console.log("\n=== numbered plots land on the ground the plan reserved for them ===");
for (let level = 2; level <= 10; level++) {
  const placement = plotPlacementFor(level, LAYOUT_V2);
  const entry = SPATIAL_PLAN.find((item) => item.level === level);
  const box = houseBox(placement, 7, 7);
  assert(!touchesRoadAxis(box), `L${level} ${entry.buildingId}: house clears both road arms`);
  assert(box.fMin >= entry.bounds.fMin && box.fMax <= entry.bounds.fMax &&
         box.sMin >= entry.bounds.sMin && box.sMax <= entry.bounds.sMax,
    `L${level} ${entry.buildingId}: house sits inside its reserved envelope`);
  const stage = scheduleForLevel(Math.max(level, PERIMETER_SCHEDULE[0].level));
  assert(insideRadius(box, stage.radius - 1), `L${level} ${entry.buildingId}: house inside the R${stage.radius} wall`);
}
// The level-10 house must not reach the R44 ring: it is built before that ring
// comes down, so an overlap there would be a house and a palisade in the same
// blocks, and which won depends on build order.
const l10 = houseBox(plotPlacementFor(10, LAYOUT_V2), 7, 7);
assert(l10.fMax < PERIMETER_SCHEDULE[0].radius && l10.sMax < PERIMETER_SCHEDULE[0].radius,
  `L10 house stays clear of the R${PERIMETER_SCHEDULE[0].radius} ring it is built inside of (fMax ${l10.fMax})`);

// ---------------------------------------------------------------- 5
console.log("\n=== the special sheds moved with everything else ===");
const shedBox = (key) => {
  const at = specialPlacement(key, LAYOUT_V2);
  return { fMin: at.forward - 3, fMax: at.forward + 3, sMin: at.side - 3, sMax: at.side + 3 };
};
const shedKeys = ["alchemist", "oldtimer", "ranger", "healer", "engineer"];
let shedCollisions = 0;
for (const key of shedKeys) {
  const box = shedBox(key);
  assert(!touchesRoadAxis(box), `${key} shed: clear of both road arms`);
  assert(insideRadius(box, PERIMETER_SCHEDULE[0].radius - 1), `${key} shed: inside the R44 palisade that stands when it unlocks`);
  for (const entry of SPATIAL_PLAN) {
    if (overlap(box, entry.bounds)) { shedCollisions++; assert(false, `${key} shed overlaps ${entry.buildingId}`); }
  }
  for (let level = 2; level <= 10; level++) {
    if (overlap(box, houseBox(plotPlacementFor(level, LAYOUT_V2), 7, 7))) {
      shedCollisions++; assert(false, `${key} shed overlaps the level-${level} house`);
    }
  }
}
// This was `assert(true, ...)`, which printed "ok" even on the run where the
// loop above had just failed - a summary line that could contradict the
// failures directly over it.
assert(shedCollisions === 0,
  `special sheds overlap no planned plot and no numbered house (${shedCollisions} collisions)`);

// ---------------------------------------------------------------- 6
console.log("\n=== quarters: free ground that really is free ===");
const towerBoxes = towerFootprintsForStage(15).map((tower) => tower.bounds);
for (const entry of ALL_SLOTS) {
  assert(insideRadius(entry.bounds, BUILDABLE_INNER_RADIUS), `${entry.id}: inside the buildable radius`);
  assert(!touchesRoadAxis(entry.bounds), `${entry.id}: clear of both road arms`);
  for (const planned of SPATIAL_PLAN) {
    for (const envelope of [planned.bounds, ...planned.reserveEnvelopes.map((r) => r.bounds)]) {
      if (overlap(entry.bounds, envelope)) assert(false, `${entry.id} overlaps ${planned.buildingId}`);
    }
  }
  for (const key of shedKeys) if (overlap(entry.bounds, shedBox(key))) assert(false, `${entry.id} overlaps the ${key} shed`);
  for (const tower of towerBoxes) if (overlap(entry.bounds, tower)) assert(false, `${entry.id} overlaps a corner tower`);
  const stage = scheduleForLevel(entry.unlockLevel);
  assert(stage && insideRadius(entry.bounds, stage.radius - 1), `${entry.id}: enclosed by the wall at its own unlock level`);
}
for (let i = 0; i < ALL_SLOTS.length; i++) {
  for (let j = i + 1; j < ALL_SLOTS.length; j++) {
    if (overlap(ALL_SLOTS[i].bounds, ALL_SLOTS[j].bounds)) assert(false, `${ALL_SLOTS[i].id} overlaps ${ALL_SLOTS[j].id}`);
  }
}
assert(QUARTERS.length >= 8 && ALL_SLOTS.length >= 14, `there is room for the next wave of buildings (${ALL_SLOTS.length} plots in ${QUARTERS.length} districts)`);
assert(slotsUnlockedAt(5).length === 0, "no district is offered before the wall encloses it");

// ---------------------------------------------------------------- 7
console.log("\n=== the R94 stage is built as a job, not in one tick ===");
// Sized off walls.js's own ring job. One slice of a few hundred native block
// calls is well inside the watchdog's spike threshold; the whole R94 stage in
// one synchronous pass is tens of thousands and kills the script runtime.
const SLICE_BUDGET = 900;
{
  const dimension = __test__.makeDimension();
  let calls = 0;
  const counting = new Proxy(dimension, {
    get(target, prop) {
      const value = target[prop];
      if (prop !== "getBlock" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
      return (...args) => { calls++; return value.apply(target, args); };
    }
  });
  const origin = { x: 400000, y: 70, z: 400000 };
  const job = buildDefenceStageJob(counting, origin, 0, 15);
  let worstSlice = 0, slices = 0, total = 0;
  for (let step = job.next(); !step.done; step = job.next()) {
    worstSlice = Math.max(worstSlice, calls);
    total += calls;
    calls = 0;
    slices++;
  }
  total += calls;
  assert(slices > 100, `the R94 stage yields many times instead of running straight through (${slices} slices)`);
  assert(worstSlice <= SLICE_BUDGET, `no slice exceeds ${SLICE_BUDGET} block calls (worst was ${worstSlice})`);
  assert(total > 20000, `the stage really is the heavy build this protects against (${total} block calls in total)`);
}

// ---------------------------------------------------------------- 8
console.log("\n=== ticking areas: R94 needs a grid, and it fits the engine's budget ===");
// Bedrock allows ten ticking areas per dimension, each at most 100 chunks.
// R94 is 189 blocks across - about 13 chunks - so one area cannot cover it.
{
  const r94 = { fMin: -94, fMax: 94, sMin: -94, sMax: 94 };
  const count = loadedAreaCountFor(r94);
  assert(count >= 4, `R94 is split into a grid rather than one oversized area (${count} areas)`);
  assert(count <= 10, `the R94 grid fits inside the engine's ten-area budget (${count} areas)`);
  assert(loadedAreaCountFor({ fMin: -20, fMax: 20, sMin: -20, sMax: 20 }) === 1, "a small plot still takes a single area");
}

// ---------------------------------------------------------------- 9
console.log("\n=== a founded village is on the crossroads and knows its own wall ===");
{
  const player = __test__.makePlayer("CrossroadsTester", { x: 500000, y: 70, z: 500000 });
  const elder = foundVillage(player, { x: 500000, y: 70, z: 500000 }, 0);
  const state = getVillageState(elder);
  assert(state.layoutVersion === LAYOUT_V2, "a newly founded village uses the crossroads layout");
  const chestBlock = elder.dimension.getBlock(state.chest);
  assert(!!chestBlock?.getComponent("minecraft:inventory"), "the progress chest followed the town hall to its new plot");
  for (const [level, radius] of [[5, 44], [8, 62], [10, 78], [15, 94]]) {
    assert(villageRadiusFor(level, LAYOUT_V2) === radius, `L${level}: the wall is at R${radius}`);
  }
  assert(villageRadiusFor(10, 1) === 48, "a legacy village still reports its own R48 wall");
  for (const [level, expected] of [[5, 5], [8, 8], [10, 10], [15, 15], [7, null], [11, null]]) {
    assert(defenceStageForLevel(level) === expected, `L${level}: ${expected ? `raises defence stage ${expected}` : "raises no wall"}`);
  }
}

console.log(failures === 0
  ? `\nALL CROSSROADS LAYOUT TESTS PASSED (${checks} checks)`
  : `\n${failures} CROSSROADS LAYOUT TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
