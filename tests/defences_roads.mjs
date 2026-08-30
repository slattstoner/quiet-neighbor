import fs from "node:fs";
import { __test__ } from "@minecraft/server";
import {
  DEFENCE_STAGES,
  activeAllocationBoundsForStage,
  buildDefenceStage,
  gateOpeningCells,
  roadCellsForRadius,
  towerFootprintsForStage,
  wallCellsForStage
} from "./scripts/defences_roads.js";
import { GATE_SPECS, PERIMETER_SCHEDULE, SPATIAL_PLAN, scheduleForLevel } from "./scripts/spatial_plan.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
let checks = 0;
function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error("FAIL:", message);
  } else console.log("ok:", message);
}

function typeAt(dim, origin, facing, f, s, up = 0) {
  return dim.getBlock(toWorld(origin, facing, f, s, up)).typeId;
}

function localFromWorld(origin, facing, position) {
  if (facing === 0) return { f: position.x - origin.x, s: position.z - origin.z, up: position.y - origin.y };
  if (facing === 1) return { f: origin.x - position.x, s: origin.z - position.z, up: position.y - origin.y };
  if (facing === 2) return { f: position.z - origin.z, s: position.x - origin.x, up: position.y - origin.y };
  return { f: origin.z - position.z, s: origin.x - position.x, up: position.y - origin.y };
}

function allRecordsSince(before) {
  const records = [];
  for (const [key, record] of __test__.blockStore.entries()) {
    if (!before.has(key)) {
      const [x, y, z] = key.split(",").map(Number);
      records.push({ x, y, z, record });
    }
  }
  return records;
}

function contains(bounds, f, s) {
  return f >= bounds.fMin && f <= bounds.fMax && s >= bounds.sMin && s <= bounds.sMax;
}

function defenceZone(stage, f, s) {
  const onRoad = (Math.abs(s) <= 1 && Math.abs(f) <= stage.radius) || (Math.abs(f) <= 1 && Math.abs(s) <= stage.radius);
  // Curtain material and defensive walk detail occupy the ring and one
  // immediate inward step; both remain a narrow perimeter strip.
  const onCurtain = Math.abs(f) === stage.radius || Math.abs(s) === stage.radius ||
    Math.abs(f) === stage.radius - 1 || Math.abs(s) === stage.radius - 1;
  const inTower = towerFootprintsForStage(stage).some((tower) => contains(tower.bounds, f, s));
  return onRoad || onCurtain || inTower;
}

function localSignature(records, origin, facing) {
  return records.map((record) => {
    const local = localFromWorld(origin, facing, record);
    return `${local.f},${local.s},${local.up}:${record.record.typeId}`;
  }).sort();
}

console.log("\n=== pure defence-road specification ===");
const expectedSchedule = [
  { level: 5, tier: "palisade", radius: 44 },
  { level: 8, tier: "cobble", radius: 62 },
  { level: 10, tier: "castle", radius: 78 },
  { level: 15, tier: "castle_expand", radius: 94 }
];
assert(JSON.stringify(PERIMETER_SCHEDULE) === JSON.stringify(expectedSchedule), "spatial schedule is exactly R44/R62/R78/R94");
assert(DEFENCE_STAGES.length === 4, "defence module exposes exactly four scheduled stages");
assert(DEFENCE_STAGES[3].tier === "castle_expand" && DEFENCE_STAGES[3].paletteFamily === "castle", "L15 is castle expansion, not a fourth material tier");
assert(scheduleForLevel(15)?.radius === 94 && scheduleForLevel(15)?.tier === "castle_expand", "scheduleForLevel preserves the approved L15 expansion semantics");

for (const stage of DEFENCE_STAGES) {
  const walls = wallCellsForStage(stage);
  const gates = gateOpeningCells(stage);
  const towers = towerFootprintsForStage(stage);
  const roads = roadCellsForRadius(stage.radius);
  assert(gates.length === 4 && towers.length === 4, `R${stage.radius}: has four canonical gates and four corner towers`);
  assert(new Set(gates.map((gate) => gate.edge)).size === 4, `R${stage.radius}: gate specs cover all four edges`);
  assert(walls.every((cell) => Math.abs(cell.f) === stage.radius || Math.abs(cell.s) === stage.radius), `R${stage.radius}: wall cells lie on the perimeter only`);
  assert(roads.length === 12 * stage.radius - 3, `R${stage.radius}: road union has expected 3-wide cross count (${roads.length})`);
  for (const gate of gates) {
    const source = GATE_SPECS.find((item) => item.id === gate.id);
    assert(gate.width === 5 && gate.cells.length === 5, `R${stage.radius}/${gate.id}: opening width is exactly five`);
    assert(gate.roadAxis === source.roadAxis, `R${stage.radius}/${gate.id}: remains aligned to ${source.roadAxis} axis`);
    assert(gate.cells.every((cell) => cell.f === (gate.edge === "fMax" ? stage.radius : gate.edge === "fMin" ? -stage.radius : cell.f) && cell.s === (gate.edge === "sMax" ? stage.radius : gate.edge === "sMin" ? -stage.radius : cell.s)), `R${stage.radius}/${gate.id}: opening lies on its canonical wall side`);
  }
  const active = activeAllocationBoundsForStage(stage);
  for (const allocation of active) {
    const touchingCurtain = walls.some((wall) => contains(allocation.bounds, wall.f, wall.s));
    assert(!touchingCurtain, `R${stage.radius}: active ${allocation.buildingId} stays clear of wall cells`);
  }
}

console.log("\n=== isolated real construction across four facings ===");
const dim = __test__.makeDimension();
const expectedWallBlock = { palisade: "minecraft:oak_log", cobble: "minecraft:cobblestone", castle: "minecraft:stone_bricks", castle_expand: "minecraft:stone_bricks" };
const facingSignatures = new Map();

for (let facing = 0; facing < 4; facing++) {
  for (let index = 0; index < DEFENCE_STAGES.length; index++) {
    const stage = DEFENCE_STAGES[index];
    const label = `L${stage.level}/R${stage.radius}, facing ${facing}`;
    const origin = { x: 700000 + facing * 30000 + index * 500, y: 70, z: 800000 + facing * 30000 };
    // This is a cell in the existing market envelope, well inside every stage and outside every road/wall strip.
    const markerLocal = { f: -42, s: 20, up: 0 };
    const markerWorld = toWorld(origin, facing, markerLocal.f, markerLocal.s, markerLocal.up);
    dim.getBlock(markerWorld).setType("minecraft:gold_block");
    const before = new Set(__test__.blockStore.keys());
    const metadata = buildDefenceStage(dim, origin, facing, stage.level);
    const records = allRecordsSince(before);

    assert(metadata.stage === stage.level && metadata.radius === stage.radius && metadata.tier === stage.tier, `${label}: immutable metadata returns approved stage`);
    assert(metadata.gates.length === 4 && metadata.towers.length === 4 && metadata.roadArms.length === 2, `${label}: returns all gate, tower and road metadata`);
    assert(metadata.terrainBounds.length < (2 * stage.radius + 1) ** 2, `${label}: terrain preparation is narrow (${metadata.terrainBounds.length} cells, not full square)`);
    assert(dim.getBlock(markerWorld).typeId === "minecraft:gold_block", `${label}: preserves marker beside a city allocation`);

    const outside = records.filter((record) => {
      const local = localFromWorld(origin, facing, record);
      return !defenceZone(stage, local.f, local.s);
    });
    assert(outside.length === 0, `${label}: all ${records.length} changed blocks remain in narrow wall/tower/gate/road strips (${outside.length} outside)`);

    const allocationConflicts = records.filter((record) => {
      const local = localFromWorld(origin, facing, record);
      return activeAllocationBoundsForStage(stage).some((entry) => contains(entry.bounds, local.f, local.s));
    });
    assert(allocationConflicts.length === 0, `${label}: does not place defence blocks in any active canonical building envelope`);

    const wall = wallCellsForStage(stage)[0];
    assert(typeAt(dim, origin, facing, wall.f, wall.s, 0) === expectedWallBlock[stage.tier], `${label}: curtain uses correct ${stage.tier} wall palette`);
    if (stage.tier === "palisade") {
      assert(!records.some((record) => record.record.typeId === "minecraft:stone_bricks"), `${label}: palisade does not use castle palette`);
    } else {
      assert(records.some((record) => record.record.typeId === "minecraft:stone_bricks"), `${label}: stone generation includes stone-brick defensive detail`);
    }

    for (const gate of metadata.gates) {
      for (const cell of gate.cells) {
        for (let up = 0; up <= 3; up++) {
          assert(typeAt(dim, origin, facing, cell.f, cell.s, up) === "minecraft:air", `${label}/${gate.id}: 5-wide opening remains clear at ${cell.f},${cell.s},${up}`);
        }
      }
    }

    let roadContinuous = true;
    for (let f = -stage.radius; f <= stage.radius; f++) {
      for (let s = -1; s <= 1; s++) if (typeAt(dim, origin, facing, f, s, -1) === "minecraft:air") roadContinuous = false;
    }
    for (let s = -stage.radius; s <= stage.radius; s++) {
      for (let f = -1; f <= 1; f++) if (typeAt(dim, origin, facing, f, s, -1) === "minecraft:air") roadContinuous = false;
    }
    assert(roadContinuous, `${label}: both three-wide road axes are continuous to every gate`);

    const signature = localSignature(records, origin, facing);
    if (!facingSignatures.has(stage.radius)) facingSignatures.set(stage.radius, signature);
    else assert(JSON.stringify(signature) === JSON.stringify(facingSignatures.get(stage.radius)), `${label}: rotated construction is locally equivalent to facing 0`);
  }
}

console.log("\n=== runtime isolation and narrow-policy source guards ===");
const defenceSource = fs.readFileSync(new URL("./scripts/defences_roads.js", import.meta.url), "utf8");
assert(!defenceSource.includes("prepareFortifiedArea") && !defenceSource.includes("prepareSite("), "defence module does not use full-square terrain helpers");
// village.js is the one runtime module that drives the defence stages: it is
// what makes the crossroads real. Everything else still keeps its distance -
// main.js has no business building walls, and levels.js must not, because
// defences_roads.js imports builder.js and levels.js is imported *by*
// builder.js's callers, so a dependency the other way round would close a
// cycle.
const villageRuntime = fs.readFileSync(new URL("../GrowingVillages_BP/scripts/village.js", import.meta.url), "utf8");
assert(villageRuntime.includes('from "./defences_roads.js"'), "village.js: runtime drives the defence module");
for (const rel of ["../GrowingVillages_BP/scripts/main.js", "../GrowingVillages_BP/scripts/levels.js"]) {
  const source = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
  assert(!source.includes("defences_roads"), `${rel.split("/").pop()}: does not import the defence module`);
}

console.log(failures === 0
  ? `\nALL DEFENCES/ROADS TESTS PASSED (${checks} checks)`
  : `\n${failures} DEFENCES/ROADS TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
