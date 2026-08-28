import { __test__ } from "@minecraft/server";
import { readFileSync } from "node:fs";
import { buildFinalCityBuilding, FINAL_CITY_BUILDINGS, FINAL_CITY_BUILDING_IDS, finalCityBuildingForId } from "./scripts/final_city_19_20.js";
import { SPECIAL_BUILDINGS } from "./scripts/special_buildings_16_18.js";
import {
  FINAL_RADIUS,
  GATE_SPECS,
  LEGACY_L1_10_ENVELOPES,
  LEGACY_SPECIAL_RESERVATION,
  ROAD_AXES,
  SPATIAL_PLAN,
  minimumTowerClearance,
  minimumWallClearance,
  rectanglesOverlap,
  touchesRoadAxis
} from "./scripts/spatial_plan.js";
import { gateOpeningCells, towerFootprintsForStage, wallCellsForStage } from "./scripts/defences_roads.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
let checks = 0;
function assert(condition, message) {
  checks++;
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

const WEIRDO = { west: 0, east: 1, north: 2, south: 3 };
const PLUS_SIDE = ["south", "north", "east", "west"];
const MINUS_SIDE = ["north", "south", "west", "east"];

function localFromWorld(origin, facing, world) {
  if (facing === 0) return { f: world.x - origin.x, s: world.z - origin.z, up: world.y - origin.y };
  if (facing === 1) return { f: origin.x - world.x, s: origin.z - world.z, up: world.y - origin.y };
  if (facing === 2) return { f: world.z - origin.z, s: world.x - origin.x, up: world.y - origin.y };
  return { f: origin.z - world.z, s: origin.x - world.x, up: world.y - origin.y };
}

function typeAt(dim, origin, facing, f, s, up = 0) {
  return dim.getBlock(toWorld(origin, facing, f, s, up)).typeId;
}

function recordAt(origin, facing, f, s, up = 0) {
  const p = toWorld(origin, facing, f, s, up);
  return __test__.blockStore.get(`${p.x},${p.y},${p.z}`) || null;
}

function beforeKeys() { return new Set(__test__.blockStore.keys()); }
function newRecords(before) {
  const result = [];
  for (const [key, record] of __test__.blockStore.entries()) {
    if (!before.has(key)) {
      const [x, y, z] = key.split(",").map(Number);
      result.push({ x, y, z, record });
    }
  }
  return result;
}

function inside(bounds, f, s) { return f >= bounds.fMin && f <= bounds.fMax && s >= bounds.sMin && s <= bounds.sMax; }
function allowed(spec, f, s) { return inside(spec.footprint, f, s) || inside(spec.connector.bounds, f, s); }
function intervalHit(bounds, cell) { return inside(bounds, cell.f, cell.s); }
function connectorWidth(spec) { return spec.connector.axis === "forward" ? spec.connector.bounds.fMax - spec.connector.bounds.fMin + 1 : spec.connector.bounds.sMax - spec.connector.bounds.sMin + 1; }
function adjacentAir(dim, origin, facing, slot) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([df, ds]) => typeAt(dim, origin, facing, slot.f + df, slot.s + ds, slot.up) === "minecraft:air");
}
function signature(origin, facing, records) {
  return records.map((placed) => {
    const local = localFromWorld(origin, facing, placed);
    const states = { ...(placed.record.states || {}) };
    for (const key of ["weirdo_direction", "minecraft:cardinal_direction", "direction", "facing_direction"]) delete states[key];
    return `${local.f},${local.s},${local.up}:${placed.record.typeId}:${JSON.stringify(states)}`;
  }).sort();
}
function cardinalMatches(record, expected) {
  const states = record?.states || {};
  const direction = { south: 0, west: 1, north: 2, east: 3 }[expected];
  return states.weirdo_direction === WEIRDO[expected] || states["minecraft:cardinal_direction"] === expected || states.direction === direction;
}
function passable(typeId) { return typeId === "minecraft:air" || typeId === "minecraft:ladder"; }
function pathExists(dim, origin, facing, bounds, start, target) {
  const queue = [{ ...start }];
  const seen = new Set([`${start.f},${start.s}`]);
  while (queue.length) {
    const current = queue.shift();
    if (current.f === target.f && current.s === target.s) return true;
    for (const [df, ds] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { f: current.f + df, s: current.s + ds };
      const key = `${next.f},${next.s}`;
      if (!seen.has(key) && inside(bounds, next.f, next.s) && passable(typeAt(dim, origin, facing, next.f, next.s, 0))) {
        seen.add(key); queue.push(next);
      }
    }
  }
  return false;
}

console.log("\n=== final city metadata and spatial contract ===");
const expected = [["founders_hall", 19], ["village_beacon", 20]];
assert(JSON.stringify(FINAL_CITY_BUILDING_IDS) === JSON.stringify(expected.map(([id]) => id)), "exactly two final stable IDs are exported in canonical order");
assert(FINAL_CITY_BUILDINGS.length === 2, "FINAL_CITY_BUILDINGS contains exactly two records");
const existing = [
  ...SPATIAL_PLAN.flatMap((entry) => [entry.bounds, ...entry.reserveEnvelopes.map((reserve) => reserve.bounds)]),
  ...LEGACY_L1_10_ENVELOPES.map((entry) => entry.bounds),
  LEGACY_SPECIAL_RESERVATION.bounds,
  ...SPECIAL_BUILDINGS.map((spec) => spec.bounds)
];
for (const [id, futureLevel] of expected) {
  const spec = finalCityBuildingForId(id);
  assert(spec?.futureLevel === futureLevel && spec.kind === "final_city", `${id}: stable level and final_city kind`);
  assert(spec && Object.isFrozen(spec) && Object.isFrozen(spec.bounds) && Object.isFrozen(spec.connector), `${id}: immutable record and geometry`);
  assert(spec && spec.noService.enabled === true, `${id}: explicit no-service declaration`);
  assert(spec && spec.bounds.fMin >= -FINAL_RADIUS && spec.bounds.fMax <= FINAL_RADIUS && spec.bounds.sMin >= -FINAL_RADIUS && spec.bounds.sMax <= FINAL_RADIUS, `${id}: stays inside R94`);
  assert(spec && !touchesRoadAxis(spec.bounds) && !touchesRoadAxis(spec.connector.bounds), `${id}: footprint and connector stay outside active central road bands`);
  assert(spec && connectorWidth(spec) === 2, `${id}: connector is exactly two blocks wide`);
  assert(spec && minimumWallClearance(spec.bounds) >= 20 && minimumTowerClearance(spec.bounds) >= 20, `${id}: meets 20-block wall/tower clearance`);
  assert(spec && spec.interiorZones.length >= 3 && spec.roofContract.requiresEaves, `${id}: declares required zones and roof contract`);
  assert(spec && !existing.some((bounds) => rectanglesOverlap(bounds, spec.bounds) || rectanglesOverlap(bounds, spec.connector.bounds)), `${id}: no overlap with L1–18 core/reserve/legacy allocations`);
}
assert(!rectanglesOverlap(FINAL_CITY_BUILDINGS[0].bounds, FINAL_CITY_BUILDINGS[1].bounds), "final footprints do not overlap each other");
assert(!rectanglesOverlap(FINAL_CITY_BUILDINGS[0].connector.bounds, FINAL_CITY_BUILDINGS[1].bounds) && !rectanglesOverlap(FINAL_CITY_BUILDINGS[1].connector.bounds, FINAL_CITY_BUILDINGS[0].bounds), "final connectors do not overlap the other final footprint");
const wallCells = wallCellsForStage(15);
const gateCells = gateOpeningCells(15).flatMap((gate) => gate.cells);
const towerCells = towerFootprintsForStage(15).flatMap((tower) => {
  const cells = [];
  for (let f = tower.bounds.fMin; f <= tower.bounds.fMax; f++) for (let s = tower.bounds.sMin; s <= tower.bounds.sMax; s++) cells.push({ f, s });
  return cells;
});
for (const spec of FINAL_CITY_BUILDINGS) {
  assert(!wallCells.some((cell) => intervalHit(spec.bounds, cell)) && !gateCells.some((cell) => intervalHit(spec.bounds, cell)) && !towerCells.some((cell) => intervalHit(spec.bounds, cell)), `${spec.id}: avoids curtain, gates and towers`);
  const road = ROAD_AXES[spec.connector.axis];
  const joinsEdge = spec.connector.axis === "forward"
    ? spec.connector.bounds.sMin <= road.bounds.sMax + 1 && spec.connector.bounds.sMax >= road.bounds.sMin - 1
    : spec.connector.bounds.fMin <= road.bounds.fMax + 1 && spec.connector.bounds.fMax >= road.bounds.fMin - 1;
  assert(joinsEdge, `${spec.id}: connector reaches valid road edge without building a global road`);
}
assert(GATE_SPECS.length === 4 && ROAD_AXES.forward.width === 3 && ROAD_AXES.side.width === 3, "final test reads unchanged road and gate contract");

console.log("\n=== real final-city builders: all facings ===");
const dim = __test__.makeDimension();
const entitiesBefore = __test__.entities.length;
const markers = Object.freeze({
  founders_hall: { f: -28, s: -12, up: 0 }, // adjacent resident allocation
  village_beacon: { f: 66, s: 22, up: 0 } // blacksmith reserve allocation
});
for (let index = 0; index < FINAL_CITY_BUILDINGS.length; index++) {
  const spec = FINAL_CITY_BUILDINGS[index];
  let baselineSignature = null;
  for (let facing = 0; facing < 4; facing++) {
    const label = `${spec.id}, facing ${facing}`;
    const origin = { x: 500000 + index * 70000 + facing * 10000, y: 70, z: 600000 + index * 70000 + facing * 10000 };
    const edgeMarker = toWorld(origin, facing, spec.bounds.fMax + 1, spec.bounds.sMax + 1, 0);
    const neighbourMarker = toWorld(origin, facing, markers[spec.id].f, markers[spec.id].s, markers[spec.id].up);
    dim.getBlock(edgeMarker).setType("minecraft:gold_block");
    dim.getBlock(neighbourMarker).setType("minecraft:diamond_block");
    const before = beforeKeys();
    const metadata = buildFinalCityBuilding(dim, origin, facing, spec.id);
    const records = newRecords(before);

    assert(metadata.id === spec.id && metadata.futureLevel === spec.futureLevel, `${label}: returns matching canonical metadata`);
    assert(records.length > 0, `${label}: creates real mock-world blocks`);
    const outside = records.filter((placed) => { const local = localFromWorld(origin, facing, placed); return !allowed(spec, local.f, local.s); });
    assert(outside.length === 0, `${label}: every changed cell stays inside exact footprint or connector (${outside.length} outside)`);
    assert(dim.getBlock(edgeMarker).typeId === "minecraft:gold_block", `${label}: preserves immediate exterior marker`);
    assert(dim.getBlock(neighbourMarker).typeId === "minecraft:diamond_block", `${label}: preserves nearest existing allocation marker`);

    const lower = recordAt(origin, facing, metadata.entry.f, metadata.entry.s, 0);
    const upper = recordAt(origin, facing, metadata.entry.f, metadata.entry.s, 1);
    assert(lower?.typeId === "minecraft:wooden_door" && lower.states.upper_block_bit === false, `${label}: lower door half is valid`);
    assert(upper?.typeId === "minecraft:wooden_door" && upper.states.upper_block_bit === true, `${label}: upper door half is valid`);
    assert(cardinalMatches(lower, metadata.entry.cardinal), `${label}: entry cardinal direction transforms correctly`);
    assert(typeAt(dim, origin, facing, metadata.entryPath.fMin, metadata.entryPath.sMin, -1) === "minecraft:gravel", `${label}: entry path is paved`);

    for (const focal of metadata.focalBlocks) {
      assert(typeAt(dim, origin, facing, focal.f, focal.s, focal.up) === focal.typeId, `${label}: focal ${focal.typeId} is real`);
      if (focal.up === 0) assert(adjacentAir(dim, origin, facing, focal), `${label}: ground focal ${focal.typeId} has adjacent air`);
    }
    for (const slot of metadata.storage) {
      assert(typeAt(dim, origin, facing, slot.f, slot.s, slot.up) === slot.typeId, `${label}: storage ${slot.typeId} exists`);
      assert(adjacentAir(dim, origin, facing, slot), `${label}: storage ${slot.typeId} has adjacent air`);
    }
    for (const slot of metadata.lights) assert(typeAt(dim, origin, facing, slot.f, slot.s, slot.up) === slot.typeId, `${label}: declared ${slot.typeId} exists`);

    if (spec.id === "founders_hall") {
      const room = metadata.rooms[0];
      const roofBase = room.height;
      const midF = Math.round((room.fMin + room.fMax) / 2);
      for (const [s, direction] of [[room.sMin, MINUS_SIDE[facing]], [room.sMax, PLUS_SIDE[facing]]]) {
        const stair = recordAt(origin, facing, midF, s, roofBase);
        assert(stair?.typeId?.includes("_stairs") && stair.states?.weirdo_direction === WEIRDO[direction], `${label}: hall roof eave faces outward (${direction})`);
      }
      assert(typeAt(dim, origin, facing, midF, room.sMin - 1, roofBase - 1).includes("stairs"), `${label}: hall roof has physical overhang`);
      assert(metadata.roofSpecs[0].ridgeUp > roofBase, `${label}: hall roof has raised ridge`);
      const start = metadata.navigation.anchors[0];
      for (const zone of metadata.interiorZones) assert(pathExists(dim, origin, facing, room, start, zone.anchor), `${label}: entry route reaches ${zone.id}`);
      assert(metadata.navigation.independentRoutes >= 2 && adjacentAir(dim, origin, facing, start), `${label}: hall declares two independent navigable routes from entry`);
    } else {
      const { platform } = metadata;
      assert(platform && platform.railingUp === platform.up + 1, `${label}: beacon returns railed viewing platform metadata`);
      assert(typeAt(dim, origin, facing, spec.layout.ladder.f, spec.layout.ladder.s, 4) === "minecraft:ladder", `${label}: beacon has continuous vertical ladder core`);
      assert(typeAt(dim, origin, facing, platform.fMin, platform.sMin, platform.railingUp) === "minecraft:dark_oak_fence", `${label}: platform perimeter is fenced`);
      assert(typeAt(dim, origin, facing, platform.fMax, platform.sMax, platform.railingUp) === "minecraft:dark_oak_fence", `${label}: opposite platform perimeter is fenced`);
      assert(typeAt(dim, origin, facing, platform.crown.f, platform.crown.s, platform.crown.upMax) === "minecraft:soul_lantern", `${label}: crown signal is decorative soul lantern, not beacon service`);
      assert(!records.some((placed) => placed.record.typeId === "minecraft:beacon"), `${label}: builder places no real minecraft:beacon block`);
    }

    const currentSignature = signature(origin, facing, records);
    if (!baselineSignature) baselineSignature = currentSignature;
    else assert(JSON.stringify(currentSignature) === JSON.stringify(baselineSignature), `${label}: reverse-transformed local signature matches facing 0`);
  }
}
assert(__test__.entities.length === entitiesBefore, "final builders create no entities");

console.log("\n=== isolation and no-service source guards ===");
const finalSource = readFileSync(new URL("./scripts/final_city_19_20.js", import.meta.url), "utf8");
for (const forbidden of ["./levels.js", "./village.js", "./main.js", "./quests.js", "./quest_contract_v2.js", "./craftsman_quests.js", "./npc.js", "./chapter_state.js", "./chapter_journal.js", "./production.js", "./walls.js", "./defences_roads.js", "./city_connectors.js", "./special_buildings_16_18.js", "world.", "spawnEntity", "addItem", "setDynamicProperty", "prepareFortifiedArea", "buildDefencesAndRoads", "minecraft:beacon"]) {
  assert(!finalSource.includes(forbidden), `final module does not contain forbidden token ${forbidden}`);
}
for (const owner of ["levels.js", "village.js", "main.js"]) {
  const source = readFileSync(new URL(`./scripts/${owner}`, import.meta.url), "utf8");
  assert(!source.includes("final_city_19_20.js"), `${owner}: no final-city runtime import`);
}
const levelsSource = readFileSync(new URL("./scripts/levels.js", import.meta.url), "utf8");
assert(!/\b16\s*:|\b17\s*:|\b18\s*:|\b19\s*:|\b20\s*:/.test(levelsSource), "actual LEVELS runtime still has no L16–20 records");

console.log(failures === 0
  ? `\nALL FINAL CITY 19–20 TESTS PASSED (${checks} checks)`
  : `\n${failures} FINAL CITY 19–20 TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
