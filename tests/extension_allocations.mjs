import { SPECIAL_BUILDINGS } from "./scripts/special_buildings_16_18.js";
import { FINAL_CITY_BUILDINGS } from "./scripts/final_city_19_20.js";
import {
  SPATIAL_PLAN, LEGACY_L1_10_ENVELOPES, LEGACY_SPECIAL_RESERVATION,
  FINAL_RADIUS, rectanglesOverlap, touchesRoadAxis,
  minimumWallClearance, minimumTowerClearance
} from "./scripts/spatial_plan.js";

/**
 * One no-overlap proof covering every allocation in the town at once.
 *
 * SPATIAL_PLAN used to carry five L16-20 reservations, and both L16-20
 * validators checked their buildings against them. That looked like coverage
 * and was not: the reserved ids (ranger_lodge, mercy_infirmary,
 * engineer_workshop, commons_infrastructure, grand_council_hall) were not the
 * ids the runtime builds (memorial_grove, village_infirmary, civic_workshop,
 * founders_hall, village_beacon), and the rectangles were somewhere else
 * entirely - so the check only forced the real buildings to route around dead
 * ground while never comparing them to each other.
 *
 * The gap it left is the one this suite closes: `special_buildings_16_18.js`
 * validates against its own peers, `final_city_19_20.js` against its own, and
 * nothing ever compared an L16-18 building with an L19-20 one. Nothing in
 * either module's runtime can see the other without an import cycle, and this
 * is a static authoring invariant anyway, so it belongs in a test.
 *
 * Every rectangle any of these buildings claims takes part: the building
 * itself, and the connector or approach path that joins it to the road.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

/** Every rectangle an L16-20 building claims, labelled by what it is. */
function extensionAllocations() {
  const out = [];
  for (const spec of SPECIAL_BUILDINGS) {
    out.push({ id: spec.id, level: spec.futureLevel, kind: "building", bounds: spec.bounds });
    out.push({ id: spec.id, level: spec.futureLevel, kind: "approach", bounds: spec.approach.bounds });
  }
  for (const spec of FINAL_CITY_BUILDINGS) {
    out.push({ id: spec.id, level: spec.futureLevel, kind: "building", bounds: spec.bounds });
    out.push({ id: spec.id, level: spec.futureLevel, kind: "connector", bounds: spec.connector.bounds });
  }
  return out;
}

const extensions = extensionAllocations();

console.log("\n=== all five L16-20 buildings are accounted for ===");
{
  const ids = [...new Set(extensions.map((item) => item.id))].sort();
  const expected = ["civic_workshop", "founders_hall", "memorial_grove", "village_beacon", "village_infirmary"];
  assert(JSON.stringify(ids) === JSON.stringify(expected),
    `exactly the buildings the runtime builds (${ids.join(", ")})`);
  const levels = [...new Set(extensions.map((item) => item.level))].sort((a, b) => a - b);
  assert(JSON.stringify(levels) === JSON.stringify([16, 17, 18, 19, 20]),
    `one per level 16 through 20 (${levels.join(", ")})`);
}

console.log("\n=== no L16-20 allocation overlaps another, across both modules ===");
for (let i = 0; i < extensions.length; i++) {
  for (let j = i + 1; j < extensions.length; j++) {
    const a = extensions[i], b = extensions[j];
    // A building and its own approach are allowed to touch - that is what an
    // approach is for. Everything else must be disjoint.
    if (a.id === b.id) continue;
    assert(!rectanglesOverlap(a.bounds, b.bounds),
      `L${a.level} ${a.id}/${a.kind} does not overlap L${b.level} ${b.id}/${b.kind}`);
  }
}

console.log("\n=== and none of them overlaps an L1-15 plot or a legacy envelope ===");
{
  const existing = [
    ...SPATIAL_PLAN.flatMap((entry) => [
      { id: entry.buildingId, kind: `L${entry.level} plot`, bounds: entry.bounds },
      ...entry.reserveEnvelopes.map((reserve) => ({ id: entry.buildingId, kind: reserve.id, bounds: reserve.bounds }))
    ]),
    ...LEGACY_L1_10_ENVELOPES.map((entry) => ({ id: entry.id, kind: "legacy", bounds: entry.bounds })),
    { id: LEGACY_SPECIAL_RESERVATION.id, kind: "legacy strip", bounds: LEGACY_SPECIAL_RESERVATION.bounds }
  ];
  let clashes = 0;
  for (const ext of extensions) {
    for (const old of existing) {
      if (rectanglesOverlap(ext.bounds, old.bounds)) {
        clashes++;
        console.error(`  L${ext.level} ${ext.id}/${ext.kind} overlaps ${old.id}/${old.kind}`);
      }
    }
  }
  assert(clashes === 0,
    `no L16-20 allocation lands on already-claimed ground (${extensions.length} x ${existing.length} pairs checked)`);
}

console.log("\n=== every L16-20 building still clears the wall, the towers and the roads ===");
for (const ext of extensions) {
  if (ext.kind !== "building") continue;   // approaches deliberately reach the road
  assert(minimumWallClearance(ext.bounds) >= 20,
    `${ext.id}: at least 20 from the R${FINAL_RADIUS} curtain (${minimumWallClearance(ext.bounds)})`);
  assert(minimumTowerClearance(ext.bounds) >= 20,
    `${ext.id}: at least 20 from the nearest corner tower (${minimumTowerClearance(ext.bounds)})`);
  assert(!touchesRoadAxis(ext.bounds),
    `${ext.id}: stays out of both three-block road bands`);
}

// ---------- the check itself has to be able to fail ----------
// Without this, a bug that emptied extensionAllocations() would make every
// assertion above pass vacuously.
console.log("\n=== the proof is not vacuous ===");
{
  assert(extensions.length === 10,
    `ten rectangles are under test - five buildings and five paths (${extensions.length})`);
  const planted = { id: "probe", level: 99, kind: "building", bounds: { ...SPECIAL_BUILDINGS[0].bounds } };
  assert(rectanglesOverlap(planted.bounds, SPECIAL_BUILDINGS[0].bounds),
    "a rectangle deliberately copied onto another is detected as overlapping");
}

console.log(failures === 0 ? "\nALL EXTENSION ALLOCATION CHECKS PASSED" : `\n${failures} EXTENSION ALLOCATION CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
