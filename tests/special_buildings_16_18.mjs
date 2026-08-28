import { __test__ } from "@minecraft/server";
import { readFileSync } from "node:fs";
import { buildSpecialBuilding, SPECIAL_BUILDING_IDS, SPECIAL_BUILDINGS, specialBuildingForId } from "./scripts/special_buildings_16_18.js";
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

function recordAt(origin, facing, f, s, up = 0) {
  const p = toWorld(origin, facing, f, s, up);
  return __test__.blockStore.get(`${p.x},${p.y},${p.z}`) || null;
}

function typeAt(dim, origin, facing, f, s, up = 0) {
  return dim.getBlock(toWorld(origin, facing, f, s, up)).typeId;
}

function beforeKeys() {
  return new Set(__test__.blockStore.keys());
}

function newRecords(before) {
  const rows = [];
  for (const [key, record] of __test__.blockStore.entries()) {
    if (!before.has(key)) {
      const [x, y, z] = key.split(",").map(Number);
      rows.push({ x, y, z, record });
    }
  }
  return rows;
}

function inside(bounds, f, s) {
  return f >= bounds.fMin && f <= bounds.fMax && s >= bounds.sMin && s <= bounds.sMax;
}

function allowedTerrain(spec, f, s) {
  return inside(spec.footprint, f, s) || inside(spec.approach.bounds, f, s);
}

function width(bounds, axis) {
  return axis === "forward" ? bounds.fMax - bounds.fMin + 1 : bounds.sMax - bounds.sMin + 1;
}

function signature(origin, facing, records) {
  return records.map((placed) => {
    const local = localFromWorld(origin, facing, placed);
    // Door/stair/workstation cardinal states must rotate with the village.
    // Geometry proof compares the reverse-transformed local structure while
    // dedicated assertions separately verify outward roof and valid door state.
    const states = { ...(placed.record.states || {}) };
    for (const key of ["weirdo_direction", "minecraft:cardinal_direction", "direction", "facing_direction"]) delete states[key];
    return `${local.f},${local.s},${local.up}:${placed.record.typeId}:${JSON.stringify(states)}`;
  }).sort();
}

function adjacentAir(dim, origin, facing, slot) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([df, ds]) => typeAt(dim, origin, facing, slot.f + df, slot.s + ds, slot.up) === "minecraft:air");
}

function intervalHit(bounds, cell) {
  return cell.f >= bounds.fMin && cell.f <= bounds.fMax && cell.s >= bounds.sMin && cell.s <= bounds.sMax;
}

console.log("\n=== special metadata and spatial contract ===");
const expected = [
  ["memorial_grove", 16, "special.roots_of_the_road"],
  ["village_infirmary", 17, "special.oath_of_care"],
  ["civic_workshop", 18, "special.tools_for_all"]
];
assert(JSON.stringify(SPECIAL_BUILDING_IDS) === JSON.stringify(expected.map((row) => row[0])), "exactly three stable special building IDs are exported in canonical order");
assert(SPECIAL_BUILDINGS.length === 3, "SPECIAL_BUILDINGS has exactly three entries");
for (const [id, level, arc] of expected) {
  const spec = specialBuildingForId(id);
  assert(spec?.futureLevel === level && spec.questArcId === arc && spec.kind === "special_story", `${id}: stable future level, arc ID and special_story kind`);
  assert(spec && Object.isFrozen(spec) && Object.isFrozen(spec.bounds), `${id}: immutable canonical metadata`);
  assert(spec && !touchesRoadAxis(spec.bounds), `${id}: footprint stays outside both central road bands`);
  assert(spec && spec.bounds.fMin >= -FINAL_RADIUS && spec.bounds.fMax <= FINAL_RADIUS && spec.bounds.sMin >= -FINAL_RADIUS && spec.bounds.sMax <= FINAL_RADIUS, `${id}: footprint stays inside R94`);
  assert(spec && minimumWallClearance(spec.bounds) >= 20 && minimumTowerClearance(spec.bounds) >= 20, `${id}: meets 20-block wall/tower clearance`);
  assert(spec && width(spec.approach.bounds, spec.approach.axis) === 2, `${id}: exactly two-block pedestrian connector`);
  assert(spec && !touchesRoadAxis(spec.approach.bounds), `${id}: connector stops beside rather than paving central road band`);
  assert(spec && spec.interiorZones.length >= 2, `${id}: declares at least two readable interior zones`);
}
for (let i = 0; i < SPECIAL_BUILDINGS.length; i++) {
  for (let j = i + 1; j < SPECIAL_BUILDINGS.length; j++) {
    assert(!rectanglesOverlap(SPECIAL_BUILDINGS[i].bounds, SPECIAL_BUILDINGS[j].bounds), `${SPECIAL_BUILDINGS[i].id}/${SPECIAL_BUILDINGS[j].id}: no special footprint overlap`);
  }
}
const existingEnvelopes = [
  ...SPATIAL_PLAN.flatMap((entry) => [entry.bounds, ...entry.reserveEnvelopes.map((reserve) => reserve.bounds)]),
  ...LEGACY_L1_10_ENVELOPES.map((entry) => entry.bounds),
  LEGACY_SPECIAL_RESERVATION.bounds
];
for (const spec of SPECIAL_BUILDINGS) {
  assert(!existingEnvelopes.some((bounds) => rectanglesOverlap(bounds, spec.bounds)), `${spec.id}: no collision with core/reserve/legacy allocation`);
  assert(!existingEnvelopes.some((bounds) => rectanglesOverlap(bounds, spec.approach.bounds)), `${spec.id}: connector avoids core/reserve/legacy allocation`);
}
const wallCells = wallCellsForStage(15);
const gateCells = gateOpeningCells(15).flatMap((gate) => gate.cells);
const towerCells = towerFootprintsForStage(15).flatMap((tower) => {
  const cells = [];
  for (let f = tower.bounds.fMin; f <= tower.bounds.fMax; f++) for (let s = tower.bounds.sMin; s <= tower.bounds.sMax; s++) cells.push({ f, s });
  return cells;
});
for (const spec of SPECIAL_BUILDINGS) {
  assert(!wallCells.some((cell) => intervalHit(spec.bounds, cell)) && !gateCells.some((cell) => intervalHit(spec.bounds, cell)) && !towerCells.some((cell) => intervalHit(spec.bounds, cell)), `${spec.id}: avoids curtain, gate and tower cells`);
}
assert(GATE_SPECS.length === 4 && ROAD_AXES.forward.width === 3 && ROAD_AXES.side.width === 3, "special proof reads unchanged canonical gate and road contract");

console.log("\n=== real builders: four facings, doors, roofs and terrain bounds ===");
const dim = __test__.makeDimension();
const entitiesBefore = __test__.entities.length;
const neighbourMarkers = Object.freeze({
  memorial_grove: { f: -42, s: -58, up: 0 }, // commons allocation
  village_infirmary: { f: -19, s: 62, up: 0 }, // archive allocation
  civic_workshop: { f: 66, s: 66, up: 0 } // future infirmary allocation
});
for (let index = 0; index < SPECIAL_BUILDINGS.length; index++) {
  const spec = SPECIAL_BUILDINGS[index];
  let referenceSignature = null;
  for (let facing = 0; facing < 4; facing++) {
    const label = `${spec.id}, facing ${facing}`;
    const origin = { x: 300000 + index * 50000 + facing * 9000, y: 70, z: 400000 + index * 50000 + facing * 9000 };
    const markerLocal = { f: spec.bounds.fMax + 1, s: spec.bounds.sMax + 1, up: 0 };
    const markerWorld = toWorld(origin, facing, markerLocal.f, markerLocal.s, markerLocal.up);
    const neighbourWorld = toWorld(origin, facing, neighbourMarkers[spec.id].f, neighbourMarkers[spec.id].s, neighbourMarkers[spec.id].up);
    dim.getBlock(markerWorld).setType("minecraft:gold_block");
    dim.getBlock(neighbourWorld).setType("minecraft:diamond_block");
    const before = beforeKeys();
    const metadata = buildSpecialBuilding(dim, origin, facing, spec.id);
    const records = newRecords(before);

    assert(metadata.id === spec.id && metadata.futureLevel === spec.futureLevel, `${label}: build returns canonical metadata`);
    assert(records.length > 0, `${label}: creates real mock-world blocks`);
    const outside = records.filter((placed) => {
      const local = localFromWorld(origin, facing, placed);
      return !allowedTerrain(spec, local.f, local.s);
    });
    assert(outside.length === 0, `${label}: every changed cell stays in exact footprint or connector (${outside.length} outside)`);
    assert(dim.getBlock(markerWorld).typeId === "minecraft:gold_block", `${label}: preserves immediate exterior marker`);
    assert(dim.getBlock(neighbourWorld).typeId === "minecraft:diamond_block", `${label}: preserves marker inside nearest planned city allocation`);

    const lower = recordAt(origin, facing, metadata.entry.f, metadata.entry.s, 0);
    const upper = recordAt(origin, facing, metadata.entry.f, metadata.entry.s, 1);
    assert(lower?.typeId === "minecraft:wooden_door" && lower.states.upper_block_bit === false, `${label}: lower door half has Bedrock upper_block_bit=false`);
    assert(upper?.typeId === "minecraft:wooden_door" && upper.states.upper_block_bit === true, `${label}: upper door half has Bedrock upper_block_bit=true`);
    assert(typeAt(dim, origin, facing, metadata.entryPath.fMin, metadata.entryPath.sMin, -1) === "minecraft:gravel", `${label}: entry path is paved`);
    assert(width(metadata.entryPath, metadata.roadLink.axis) >= 2 || Math.min(metadata.entryPath.fMax - metadata.entryPath.fMin + 1, metadata.entryPath.sMax - metadata.entryPath.sMin + 1) >= 2, `${label}: entry path is at least two blocks wide`);

    const room = metadata.rooms[0];
    const roofBase = room.height;
    const midF = Math.round((room.fMin + room.fMax) / 2);
    for (const [s, expected] of [[room.sMin, MINUS_SIDE[facing]], [room.sMax, PLUS_SIDE[facing]]]) {
      const edge = recordAt(origin, facing, midF, s, roofBase);
      assert(edge?.typeId?.includes("_stairs"), `${label}: roof edge at ${midF},${s} is a stair`);
      assert(edge?.states?.weirdo_direction === WEIRDO[expected], `${label}: roof stair faces outward (${expected})`);
    }
    assert(typeAt(dim, origin, facing, midF, room.sMin - 1, roofBase - 1).includes("stairs"), `${label}: roof has eave overhang`);
    assert(metadata.roofSpecs.length >= 1 && metadata.roofSpecs[0].ridgeUp > roofBase, `${label}: roof has non-flat ridge above eaves`);

    for (const focal of metadata.focalBlocks) assert(typeAt(dim, origin, facing, focal.f, focal.s, focal.up) === focal.typeId, `${label}: focal ${focal.typeId} is real`);
    for (const slot of metadata.beds) {
      assert(typeAt(dim, origin, facing, slot.f, slot.s, slot.up) === "minecraft:bed", `${label}: bed exists`);
      assert(adjacentAir(dim, origin, facing, slot), `${label}: bed has adjacent walkable air`);
    }
    for (const slot of metadata.storage) {
      assert(typeAt(dim, origin, facing, slot.f, slot.s, slot.up) === slot.typeId, `${label}: storage ${slot.typeId} exists`);
      assert(adjacentAir(dim, origin, facing, slot), `${label}: storage has adjacent walkable air`);
    }
    for (const slot of metadata.workstations) {
      assert(typeAt(dim, origin, facing, slot.f, slot.s, slot.up) === slot.typeId, `${label}: decorative workstation ${slot.typeId} exists`);
      assert(adjacentAir(dim, origin, facing, slot), `${label}: workstation has adjacent walkable air`);
    }
    for (const light of metadata.lights) assert(typeAt(dim, origin, facing, light.f, light.s, light.up) === "minecraft:lantern", `${label}: declared lantern exists`);

    const currentSignature = signature(origin, facing, records);
    if (!referenceSignature) referenceSignature = currentSignature;
    else assert(JSON.stringify(currentSignature) === JSON.stringify(referenceSignature), `${label}: reverse-transformed local block signature matches facing 0`);
  }
}
assert(__test__.entities.length === entitiesBefore, "special builders create no NPCs or entities");

console.log("\n=== isolation and no-economy source guards ===");
const specialSource = readFileSync(new URL("./scripts/special_buildings_16_18.js", import.meta.url), "utf8");
for (const forbidden of ["./quests.js", "./quest_contract_v2.js", "./craftsman_quests.js", "./npc.js", "./ui.js", "./production.js", "prepareFortifiedArea", "spawnEntity", "addItem", "setDynamicProperty"]) {
  assert(!specialSource.includes(forbidden), `special module does not use forbidden runtime/economy token ${forbidden}`);
}
for (const owner of ["levels.js", "village.js", "main.js"]) {
  const source = readFileSync(new URL(`./scripts/${owner}`, import.meta.url), "utf8");
  assert(!source.includes("special_buildings_16_18.js"), `${owner}: no special builder runtime import`);
}
const levelsSource = readFileSync(new URL("./scripts/levels.js", import.meta.url), "utf8");
assert(!/\b16\s*:|\b17\s*:|\b18\s*:|\b19\s*:|\b20\s*:/.test(levelsSource), "actual LEVELS runtime still contains no L16–20 records");

console.log(failures === 0
  ? `\nALL SPECIAL BUILDINGS 16–18 TESTS PASSED (${checks} checks)`
  : `\n${failures} SPECIAL BUILDINGS 16–18 TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
