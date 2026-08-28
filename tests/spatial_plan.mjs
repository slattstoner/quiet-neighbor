import fs from "node:fs";
import {
  FINAL_RADIUS,
  WALL_INNER_FACE,
  TOWER_INNER_FACE,
  PERIMETER_SCHEDULE,
  ROAD_AXES,
  GATE_SPECS,
  SPATIAL_PLAN,
  CANONICAL_BUILDING_IDS,
  LEGACY_SPECIAL_RESERVATION,
  LEGACY_L1_10_ENVELOPES,
  perimeterForRadius,
  boundsFor,
  allocationEnvelopesFor,
  scheduleForLevel,
  rectanglesOverlap,
  touchesRoadAxis,
  crossroadCells,
  minimumWallClearance,
  minimumTowerClearance
} from "./scripts/spatial_plan.js";

let failures = 0;
let checks = 0;
function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error("FAIL:", message);
  } else {
    console.log("ok:", message);
  }
}

function allAllocations() {
  return SPATIAL_PLAN.flatMap((entry) => allocationEnvelopesFor(entry.buildingId)
    .map((allocation) => ({ ...allocation, level: entry.level })));
}

console.log("\n=== spatial plan exports and completeness ===");
assert(FINAL_RADIUS === 94, "FINAL_RADIUS is the approved R94 allocation boundary");
assert(WALL_INNER_FACE === 93, "WALL_INNER_FACE is the approved inner curtain coordinate");
assert(TOWER_INNER_FACE === 90, "TOWER_INNER_FACE is the approved inner tower coordinate");
assert(SPATIAL_PLAN.length === 22, `all canonical 1–20 building IDs are present exactly once (${SPATIAL_PLAN.length})`);
assert(new Set(CANONICAL_BUILDING_IDS).size === SPATIAL_PLAN.length, "canonical building IDs are unique");
assert(CANONICAL_BUILDING_IDS.includes("town_hall") && CANONICAL_BUILDING_IDS.includes("campfire") && CANONICAL_BUILDING_IDS.includes("starter_house"), "all separate L1 building IDs exist");
assert(CANONICAL_BUILDING_IDS.includes("grand_council_hall"), "L20 grand_council_hall exists");
assert(boundsFor("farmer_homestead")?.reserveEnvelopes.length === 1, "farmer retains a future quest reserve");
assert(boundsFor("blacksmith_forge")?.reserveEnvelopes.length === 1, "blacksmith retains a future quest reserve");
assert(boundsFor("cartographer_house")?.reserveEnvelopes.length === 1, "cartographer retains a future quest reserve");
assert(boundsFor("miner_house")?.reserveEnvelopes.length === 1, "miner retains a future quest reserve");
assert(boundsFor("missing_building") === null, "unknown building IDs return null");

for (const entry of SPATIAL_PLAN) {
  const all = allocationEnvelopesFor(entry.buildingId);
  assert(all.length >= 1, `${entry.buildingId}: has at least one allocation envelope`);
  for (const allocation of all) {
    const b = allocation.bounds;
    assert(Number.isInteger(b.fMin) && Number.isInteger(b.fMax) && Number.isInteger(b.sMin) && Number.isInteger(b.sMax) && b.fMin <= b.fMax && b.sMin <= b.sMax,
      `${entry.buildingId}/${allocation.kind}: bounds are valid integers`);
  }
}

console.log("\n=== allocation overlap and road safety ===");
const allocations = allAllocations();
for (let i = 0; i < allocations.length; i++) {
  for (let j = i + 1; j < allocations.length; j++) {
    const a = allocations[i], b = allocations[j];
    if (a.id === b.id) continue; // core/reserve are an explicitly documented same-building relation
    assert(!rectanglesOverlap(a.bounds, b.bounds), `${a.id}/${a.kind} does not overlap ${b.id}/${b.kind}`);
  }
}
for (const allocation of allocations) {
  assert(!touchesRoadAxis(allocation.bounds), `${allocation.id}/${allocation.kind} stays outside both 3-block road bands`);
}

const cells = crossroadCells();
const cellKeys = new Set(cells.map((cell) => `${cell.f},${cell.s}`));
assert(cells.length === 1125, `crossroad cell union has the expected 1125 cells (${cells.length})`);
for (let f = -FINAL_RADIUS; f <= FINAL_RADIUS; f++) {
  for (let s = -1; s <= 1; s++) assert(cellKeys.has(`${f},${s}`), `forward road is continuous at ${f},${s}`);
}
for (let s = -FINAL_RADIUS; s <= FINAL_RADIUS; s++) {
  for (let f = -1; f <= 1; f++) assert(cellKeys.has(`${f},${s}`), `side road is continuous at ${f},${s}`);
}
assert(ROAD_AXES.forward.width === 3 && ROAD_AXES.side.width === 3, "both canonical road arms are three blocks wide");

console.log("\n=== gate specification ===");
assert(GATE_SPECS.length === 4, "exactly four gate specs exist");
assert(new Set(GATE_SPECS.map((gate) => gate.edge)).size === 4, "one gate is assigned to each perimeter side");
for (const gate of GATE_SPECS) {
  const spanWidth = gate.span.max - gate.span.min + 1;
  const expectedFixed = gate.edge.endsWith("Max") ? FINAL_RADIUS : -FINAL_RADIUS;
  const axisBounds = ROAD_AXES[gate.roadAxis].bounds;
  const crossAxis = gate.roadAxis === "forward" ? "side" : "forward";
  const axisMin = crossAxis === "side" ? axisBounds.sMin : axisBounds.fMin;
  const axisMax = crossAxis === "side" ? axisBounds.sMax : axisBounds.fMax;
  assert(gate.width === 5 && spanWidth === 5, `${gate.id}: is exactly five blocks wide`);
  assert(gate.fixed.value === expectedFixed, `${gate.id}: lies on its correct R94 wall side`);
  assert(gate.span.min <= axisMin && gate.span.max >= axisMax, `${gate.id}: opening contains the aligned three-block road axis`);
}

console.log("\n=== wall schedule and clearance ===");
const expectedSchedule = [
  { level: 5, tier: "palisade", radius: 44 },
  { level: 8, tier: "cobble", radius: 62 },
  { level: 10, tier: "castle", radius: 78 },
  { level: 15, tier: "castle_expand", radius: 94 }
];
assert(JSON.stringify(PERIMETER_SCHEDULE) === JSON.stringify(expectedSchedule), "schedule is exactly L5/R44, L8/R62, L10/R78, L15/R94");
assert(scheduleForLevel(4) === null, "no wall schedule applies before L5");
assert(scheduleForLevel(5)?.tier === "palisade", "L5 selects palisade");
assert(scheduleForLevel(9)?.tier === "cobble", "L9 retains cobble stage");
assert(scheduleForLevel(10)?.tier === "castle" && scheduleForLevel(10)?.radius === 78, "L10 selects the castle stage at R78");
assert(scheduleForLevel(15)?.tier === "castle_expand" && scheduleForLevel(15)?.radius === 94, "L15 expands the existing castle material to R94");
assert(scheduleForLevel(20)?.tier === "castle_expand", "L20 retains the final castle expansion stage");
assert(perimeterForRadius(94).fMin === -94 && perimeterForRadius(94).sMax === 94, "perimeterForRadius returns an R94 square");

const wallClearances = allocations.map((item) => minimumWallClearance(item.bounds));
const towerClearances = allocations.map((item) => minimumTowerClearance(item.bounds));
for (let index = 0; index < allocations.length; index++) {
  const item = allocations[index];
  assert(wallClearances[index] >= 20, `${item.id}/${item.kind}: wall clearance is at least 20 (${wallClearances[index]})`);
  assert(towerClearances[index] >= 20, `${item.id}/${item.kind}: exact tower clearance is at least 20 (${towerClearances[index]})`);
}
assert(Math.min(...wallClearances) === 27, `minimum curtain-wall clearance is the accepted 27 (${Math.min(...wallClearances)})`);
assert(Math.min(...towerClearances) === 24, `minimum exact tower clearance is the accepted 24 (${Math.min(...towerClearances)})`);

console.log("\n=== legacy safety and module purity ===");
const futureAllocations = allocations.filter((item) => item.level >= 11);
for (const legacy of [...LEGACY_L1_10_ENVELOPES, LEGACY_SPECIAL_RESERVATION]) {
  for (const future of futureAllocations) {
    assert(!rectanglesOverlap(legacy.bounds, future.bounds), `${future.id}/${future.kind} avoids ${legacy.id}`);
  }
}
const source = fs.readFileSync(new URL("./scripts/spatial_plan.js", import.meta.url), "utf8");
assert(!source.includes("@minecraft/server"), "spatial_plan.js does not import @minecraft/server");
assert(!/\bworld\s*\./.test(source), "spatial_plan.js has no world access at module load or runtime");

console.log(failures === 0
  ? `\nALL SPATIAL PLAN TESTS PASSED (${checks} checks)`
  : `\n${failures} SPATIAL PLAN TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
