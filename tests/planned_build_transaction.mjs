import { __test__ } from "@minecraft/server";
import { readFileSync } from "node:fs";
import {
  BUILD_STATE_PREFIX,
  PLANNED_BUILDING_IDS,
  buildPlannedVillageBuilding,
  getPlannedBuildState,
  plannedBuildStateKey
} from "./scripts/planned_build_transaction.js";
import { SPECIAL_BUILDINGS, buildSpecialBuilding } from "./scripts/special_buildings_16_18.js";
import { FINAL_CITY_BUILDINGS, buildFinalCityBuilding } from "./scripts/final_city_19_20.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
let checks = 0;
function assert(condition, message) {
  checks++;
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

const EXPECTED = Object.freeze([
  ["memorial_grove", 16, "special"],
  ["village_infirmary", 17, "special"],
  ["civic_workshop", 18, "special"],
  ["founders_hall", 19, "final"],
  ["village_beacon", 20, "final"]
]);
const SPECS = Object.freeze(new Map([
  ...SPECIAL_BUILDINGS.map((spec) => [spec.id, spec]),
  ...FINAL_CITY_BUILDINGS.map((spec) => [spec.id, spec])
]));

function makeElder(dimension, origin, facing) {
  const props = new Map([
    ["village:originX", origin.x],
    ["village:originY", origin.y],
    ["village:originZ", origin.z],
    ["village:facing", facing],
    ["village:palette", "plains"],
    ["village:level", 15],
    ["village:chapter", "chapter.15.three_returns"],
    ["village:arc", "unchanged"]
  ]);
  const writes = [];
  return {
    dimension,
    props,
    writes,
    getDynamicProperty(key) { return props.get(key); },
    setDynamicProperty(key, value) { writes.push([key, value]); props.set(key, value); }
  };
}

function connectorOf(shape) {
  const raw = shape.connector || shape.approach;
  return raw ? { axis: raw.axis, width: raw.width, bounds: { ...raw.bounds } } : null;
}

function beforeKeys() { return new Set(__test__.blockStore.keys()); }
function newRecords(before) {
  const records = [];
  for (const [key, record] of __test__.blockStore.entries()) {
    if (!before.has(key)) {
      const [x, y, z] = key.split(",").map(Number);
      records.push({ x, y, z, record });
    }
  }
  return records;
}
function localFromWorld(origin, facing, world) {
  if (facing === 0) return { f: world.x - origin.x, s: world.z - origin.z, up: world.y - origin.y };
  if (facing === 1) return { f: origin.x - world.x, s: origin.z - world.z, up: world.y - origin.y };
  if (facing === 2) return { f: world.z - origin.z, s: world.x - origin.x, up: world.y - origin.y };
  return { f: origin.z - world.z, s: origin.x - world.x, up: world.y - origin.y };
}
function inside(bounds, f, s) { return f >= bounds.fMin && f <= bounds.fMax && s >= bounds.sMin && s <= bounds.sMax; }
function shapeAllows(shape, f, s) {
  return inside(shape.terrainBounds.footprint, f, s) || inside(shape.terrainBounds.connector, f, s);
}

console.log("\n=== stable contract and preflight ===");
assert(BUILD_STATE_PREFIX === "village:v2:build:", "state prefix is the only approved shared prefix");
assert(JSON.stringify(PLANNED_BUILDING_IDS) === JSON.stringify(EXPECTED.map(([id]) => id)), "stable planned IDs exactly match five canonical buildings");
for (const [id, level] of EXPECTED) {
  assert(plannedBuildStateKey(id) === `${BUILD_STATE_PREFIX}${id}`, `${id}: state key uses exact prefix`);
  const elder = makeElder(__test__.makeDimension(), { x: 1000, y: 70, z: 1000 }, 0);
  const beforeWrites = elder.writes.length;
  const invalidId = buildPlannedVillageBuilding(elder, { buildingId: "not_canonical", level });
  const invalidLevel = buildPlannedVillageBuilding(elder, { buildingId: id, level: level - 1 });
  assert(invalidId.error === "invalid_planned_building" && invalidLevel.error === "invalid_planned_level", `${id}: invalid ID/level pair rejects before mutation`);
  assert(elder.writes.length === beforeWrites, `${id}: invalid request writes no state`);
}
assert(getPlannedBuildState(makeElder(__test__.makeDimension(), { x: 0, y: 70, z: 0 }, 0), "memorial_grove") === 0, "unset state reads as zero");

console.log("\n=== real canonical delegation, terrain scope and idempotency ===");
const dim = __test__.makeDimension();
let scenario = 0;
for (const [id, level, family] of EXPECTED) {
  const spec = SPECS.get(id);
  for (let facing = 0; facing < 4; facing++) {
    const label = `${id}, facing ${facing}`;
    const origin = { x: 800000 + scenario * 9000, y: 70, z: 900000 + scenario * 9000 };
    scenario++;
    const elder = makeElder(dim, origin, facing);
    const edge = toWorld(origin, facing, spec.footprint.fMax + 1, spec.footprint.sMax + 1, 0);
    dim.getBlock(edge).setType("minecraft:gold_block");
    const before = beforeKeys();
    let specialCalls = 0, finalCalls = 0, connectorCalls = 0;
    const result = buildPlannedVillageBuilding(elder, Object.freeze({ buildingId: id, level, paletteId: "plains" }), {
      buildSpecial(...args) { specialCalls++; return buildSpecialBuilding(...args); },
      buildFinal(...args) { finalCalls++; return buildFinalCityBuilding(...args); },
      connect(shape) { connectorCalls++; return connectorOf(shape); },
      warn() {}
    });
    const records = newRecords(before);

    assert(result.done && result.buildingId === id && result.level === level, `${label}: successful transaction returns canonical build result`);
    assert(Object.isFrozen(result) && Object.isFrozen(result.shape) && Object.isFrozen(result.connector), `${label}: success metadata is frozen`);
    assert(result.shape.buildingId === id && result.shape.bounds && result.connector.width >= 2, `${label}: matching shape and narrow connector are returned`);
    assert(specialCalls === (family === "special" ? 1 : 0) && finalCalls === (family === "final" ? 1 : 0), `${label}: delegates only to correct canonical owner`);
    assert(connectorCalls === 1, `${label}: validates exactly one narrow connector`);
    assert(getPlannedBuildState(elder, id) === 2, `${label}: state commits 0→1→2 only after success`);
    assert(JSON.stringify(elder.writes.map(([key, value]) => [key, value])) === JSON.stringify([[plannedBuildStateKey(id), 1], [plannedBuildStateKey(id), 2]]), `${label}: writes only queued then completed marker`);
    assert(records.length > 0 && records.every((placed) => shapeAllows(result.shape, localFromWorld(origin, facing, placed).f, localFromWorld(origin, facing, placed).s)), `${label}: every changed cell stays inside canonical footprint/connector`);
    assert(dim.getBlock(edge).typeId === "minecraft:gold_block", `${label}: immediate terrain marker survives narrow build`);
    assert(elder.getDynamicProperty("village:level") === 15 && elder.getDynamicProperty("village:chapter") === "chapter.15.three_returns" && elder.getDynamicProperty("village:arc") === "unchanged", `${label}: no level/chapter/arc state changed`);

    const countAfterFirst = __test__.blockStore.size;
    const retry = buildPlannedVillageBuilding(elder, { buildingId: id, level }, {
      buildSpecial() { specialCalls++; throw new Error("must not run"); },
      buildFinal() { finalCalls++; throw new Error("must not run"); },
      connect() { connectorCalls++; throw new Error("must not run"); },
      warn() {}
    });
    assert(!retry.done && retry.alreadyBuilt && retry.error === "already_built", `${label}: second call is deterministic already_built`);
    assert(__test__.blockStore.size === countAfterFirst && specialCalls === (family === "special" ? 1 : 0) && finalCalls === (family === "final" ? 1 : 0) && connectorCalls === 1, `${label}: completed retry changes zero blocks and calls no owner/connector`);
  }
}

console.log("\n=== recovery, failure and no-side-effect semantics ===");
for (const [id, level, family] of EXPECTED) {
  const elder = makeElder(__test__.makeDimension(), { x: 1200000 + level * 1000, y: 70, z: 1200000 + level * 1000 }, 0);
  const beforeProps = new Map(elder.props);
  let wrongBuilderCalls = 0;
  const failed = buildPlannedVillageBuilding(elder, { buildingId: id, level }, {
    buildSpecial() { wrongBuilderCalls++; throw new Error("injected builder failure"); },
    buildFinal() { wrongBuilderCalls++; throw new Error("injected builder failure"); },
    connect() { throw new Error("must not connect"); },
    warn() {}
  });
  assert(!failed.done && failed.recoverable && failed.error === "planned_build_failed" && getPlannedBuildState(elder, id) === 0, `${id}: throwing canonical builder resets queued 1→0 for retry`);
  assert(wrongBuilderCalls === 1 && elder.getDynamicProperty("village:level") === beforeProps.get("village:level") && elder.getDynamicProperty("village:chapter") === beforeProps.get("village:chapter") && elder.getDynamicProperty("village:arc") === beforeProps.get("village:arc"), `${id}: builder failure touches no level/chapter/arc data`);

  const wrongShape = buildPlannedVillageBuilding(elder, { buildingId: id, level }, {
    buildSpecial() { return { buildingId: "wrong_shape" }; },
    buildFinal() { return { buildingId: "wrong_shape" }; },
    connect() { throw new Error("must not connect wrong shape"); },
    warn() {}
  });
  assert(wrongShape.error === "canonical_shape_mismatch" && getPlannedBuildState(elder, id) === 0, `${id}: wrong canonical metadata resets state without commit`);

  const connectorFailure = buildPlannedVillageBuilding(elder, { buildingId: id, level }, {
    buildSpecial() { return { buildingId: id, bounds: {}, footprint: {}, approach: { axis: "side", width: 2, bounds: {} } }; },
    buildFinal() { return { buildingId: id, bounds: {}, footprint: {}, connector: { axis: "side", width: 2, bounds: {} } }; },
    connect() { throw new Error("injected connector failure"); },
    warn() {}
  });
  assert(connectorFailure.error === "planned_build_failed" && getPlannedBuildState(elder, id) === 0, `${id}: connector failure resets queued state and permits retry`);

  elder.setDynamicProperty(plannedBuildStateKey(id), 1);
  const queued = buildPlannedVillageBuilding(elder, { buildingId: id, level }, { warn() {} });
  assert(queued.error === "queued_build_recovered" && getPlannedBuildState(elder, id) === 0, `${id}: stale queued state recovers to zero without construction`);

  elder.setDynamicProperty(plannedBuildStateKey(id), 73);
  const corrupt = buildPlannedVillageBuilding(elder, { buildingId: id, level }, { warn() {} });
  assert(corrupt.error === "build_state_corrupt" && getPlannedBuildState(elder, id).corrupt === true && elder.getDynamicProperty(plannedBuildStateKey(id)) === 73, `${id}: corrupt state returns safe error without construction or overwrite`);
}

console.log("\n=== strict isolation and owner boundaries ===");
const source = readFileSync(new URL("./scripts/planned_build_transaction.js", import.meta.url), "utf8");
for (const forbidden of ["./levels.js", "./village.js", "./main.js", "./quests.js", "./quest_contract_v2.js", "./chapter_state.js", "./chapter_journal.js", "./craftsman_quests.js", "./npc.js", "./production.js", "./walls.js", "./defences_roads.js", "./city_connectors.js", "world.", "spawnEntity", "addItem", "removeItem", "prepareFortifiedArea", "buildDefencesAndRoads", "minecraft:beacon", "village:level", "village:chapter", "village:arc"]) {
  assert(!source.includes(forbidden), `adapter contains no forbidden token ${forbidden}`);
}
for (const owner of ["levels.js", "village.js", "main.js", "quests.js", "quest_contract_v2.js", "chapter_state.js", "chapter_journal.js", "craftsman_quests.js", "npc.js", "production.js", "ui.js"]) {
  const ownerSource = readFileSync(new URL(`./scripts/${owner}`, import.meta.url), "utf8");
  assert(!ownerSource.includes("planned_build_transaction.js"), `${owner}: no adapter runtime import`);
}

console.log(failures === 0
  ? `\nALL PLANNED BUILD TRANSACTION TESTS PASSED (${checks} checks)`
  : `\n${failures} PLANNED BUILD TRANSACTION TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
