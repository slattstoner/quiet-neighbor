import { __test__ } from "@minecraft/server";
import { buildCityBuilding, CITY_BUILDING_IDS } from "./scripts/city_buildings_11_15.js";
import { boundsFor, touchesRoadAxis } from "./scripts/spatial_plan.js";
import { toWorld } from "./scripts/util.js";

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

const WEIRDO = { west: 0, east: 1, north: 2, south: 3 };
const PLUS_SIDE = ["south", "north", "east", "west"];
const MINUS_SIDE = ["north", "south", "west", "east"];

function worldAt(origin, facing, f, s, up = 0) {
  return toWorld(origin, facing, f, s, up);
}

function typeAt(dim, origin, facing, f, s, up = 0) {
  const p = worldAt(origin, facing, f, s, up);
  return dim.getBlock(p).typeId;
}

function recordAt(origin, facing, f, s, up = 0) {
  const p = worldAt(origin, facing, f, s, up);
  return __test__.blockStore.get(`${p.x},${p.y},${p.z}`) || null;
}

function localFromWorld(origin, facing, world) {
  if (facing === 0) return { f: world.x - origin.x, s: world.z - origin.z, up: world.y - origin.y };
  if (facing === 1) return { f: origin.x - world.x, s: origin.z - world.z, up: world.y - origin.y };
  if (facing === 2) return { f: world.z - origin.z, s: world.x - origin.x, up: world.y - origin.y };
  return { f: origin.z - world.z, s: origin.x - world.x, up: world.y - origin.y };
}

function inside(bounds, f, s) {
  return f >= bounds.fMin && f <= bounds.fMax && s >= bounds.sMin && s <= bounds.sMax;
}

function keysBefore() {
  return new Set(__test__.blockStore.keys());
}

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

function checkRoof(dim, origin, facing, metadata, label) {
  for (const spec of metadata.roofSpecs) {
    const middleF = Math.round((spec.fMin + spec.fMax) / 2);
    const baseUp = spec.wallTop + 1;
    for (const [s, expected] of [[spec.sMin, MINUS_SIDE[facing]], [spec.sMax, PLUS_SIDE[facing]]]) {
      const block = recordAt(origin, facing, middleF, s, baseUp);
      assert(block?.typeId?.includes("_stairs"), `${label}: roof edge at ${middleF},${s} is a stair`);
      assert(block?.states?.weirdo_direction === WEIRDO[expected], `${label}: roof edge at ${middleF},${s} faces outward (${expected})`);
    }
  }
}

function checkEntryPath(dim, origin, facing, metadata, label) {
  const path = metadata.entryPath;
  const width = Math.min(path.fMax - path.fMin + 1, path.sMax - path.sMin + 1);
  assert(width >= 2, `${label}: internal entry path is at least two blocks wide (${width})`);
  for (let f = path.fMin; f <= path.fMax; f++) {
    for (let s = path.sMin; s <= path.sMax; s++) {
      assert(typeAt(dim, origin, facing, f, s, -1) === "minecraft:gravel", `${label}: entry path has gravel at ${f},${s}`);
    }
  }
  const approach = metadata.approach;
  const approachWidth = approach.axis === "forward"
    ? approach.bounds.fMax - approach.bounds.fMin + 1
    : approach.bounds.sMax - approach.bounds.sMin + 1;
  assert(approachWidth >= 2, `${label}: reserved approach to road axis is at least two blocks wide (${approachWidth})`);
  const sampleF = approach.axis === "forward" ? approach.bounds.fMin : (approach.side === "fMin" ? approach.bounds.fMin : approach.bounds.fMax);
  const sampleS = approach.axis === "forward" ? (approach.side === "sMin" ? approach.bounds.sMin : approach.bounds.sMax) : approach.bounds.sMin;
  assert(typeAt(dim, origin, facing, sampleF, sampleS, 0) === "minecraft:air", `${label}: external approach remains free for future road integration`);
}

function hasAdjacentAir(dim, origin, facing, slot) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([df, ds]) =>
    typeAt(dim, origin, facing, slot.f + df, slot.s + ds, slot.up) === "minecraft:air");
}

function checkSlots(dim, origin, facing, metadata, label) {
  const anchorType = typeAt(dim, origin, facing, metadata.npcAnchor.f, metadata.npcAnchor.s, metadata.npcAnchor.up);
  assert(anchorType === "minecraft:air", `${label}: future npcAnchor is accessible air`);
  assert(metadata.storage.length >= 1, `${label}: exposes at least one future storage slot`);
  assert(metadata.workstations.length >= 1, `${label}: exposes at least one workstation slot`);
  assert(metadata.lights.length >= 1, `${label}: exposes night-light slots`);
  for (const slot of metadata.beds) {
    assert(typeAt(dim, origin, facing, slot.f, slot.s, slot.up) === "minecraft:bed", `${label}: bed slot is a real bed`);
    assert(hasAdjacentAir(dim, origin, facing, slot), `${label}: bed slot has adjacent walkable interior air`);
  }
  for (const slot of metadata.storage) {
    assert(typeAt(dim, origin, facing, slot.f, slot.s, slot.up) === slot.typeId, `${label}: storage slot is ${slot.typeId}`);
    assert(hasAdjacentAir(dim, origin, facing, slot), `${label}: storage slot has adjacent walkable interior air`);
  }
  for (const slot of metadata.workstations) {
    assert(typeAt(dim, origin, facing, slot.f, slot.s, slot.up) === slot.typeId, `${label}: workstation slot is ${slot.typeId}`);
    assert(hasAdjacentAir(dim, origin, facing, slot), `${label}: workstation slot has adjacent walkable interior air`);
  }
  for (const slot of metadata.lights) assert(typeAt(dim, origin, facing, slot.f, slot.s, slot.up) === "minecraft:lantern", `${label}: light slot is a lantern`);
}

const dim = __test__.makeDimension();
const entitiesBefore = __test__.entities.length;
console.log("\n=== city builders 11–15: all four orientations ===");

for (let facing = 0; facing < 4; facing++) {
  for (let index = 0; index < CITY_BUILDING_IDS.length; index++) {
    const buildingId = CITY_BUILDING_IDS[index];
    const label = `${buildingId}, facing ${facing}`;
    const origin = { x: 100000 + facing * 20000 + index * 500, y: 70, z: 200000 + facing * 20000 };
    const plan = boundsFor(buildingId);
    const markerLocal = { f: plan.bounds.fMax + 1, s: plan.bounds.sMax + 1, up: 0 };
    const markerWorld = worldAt(origin, facing, markerLocal.f, markerLocal.s, markerLocal.up);
    dim.getBlock(markerWorld).setType("minecraft:gold_block");
    const before = keysBefore();
    const metadata = buildCityBuilding(buildingId, dim, origin, facing);
    const records = newRecords(before);

    assert(metadata.buildingId === buildingId, `${label}: returns matching buildingId`);
    assert(JSON.stringify(metadata.bounds) === JSON.stringify(plan.bounds), `${label}: returns approved core bounds`);
    assert(!touchesRoadAxis(metadata.bounds), `${label}: core bounds stay out of canonical road bands`);
    assert(metadata.roadLink.width >= 2, `${label}: metadata preserves a two-block road link`);
    assert(metadata.rooms.length >= 1 && metadata.roofSpecs.length >= 1, `${label}: returns rooms and roof specs`);
    assert(records.length > 0, `${label}: creates real blocks in the mock world`);
    const outside = records.filter((placed) => {
      const local = localFromWorld(origin, facing, placed);
      return !inside(plan.bounds, local.f, local.s);
    });
    assert(outside.length === 0, `${label}: all ${records.length} placed blocks stay inside approved core bounds (${outside.length} outside)`);
    assert(dim.getBlock(markerWorld).typeId === "minecraft:gold_block", `${label}: local terrain preparation preserves neighbouring marker block`);

    const lower = recordAt(origin, facing, metadata.entry.f, metadata.entry.s, 0);
    const upper = recordAt(origin, facing, metadata.entry.f, metadata.entry.s, 1);
    assert(lower?.typeId === "minecraft:wooden_door" && lower.states.upper_block_bit === false, `${label}: entry lower half is a real wooden door`);
    assert(upper?.typeId === "minecraft:wooden_door" && upper.states.upper_block_bit === true, `${label}: entry upper half is a real wooden door`);
    checkEntryPath(dim, origin, facing, metadata, label);
    checkSlots(dim, origin, facing, metadata, label);
    checkRoof(dim, origin, facing, metadata, label);

    if (buildingId !== "market_square") assert(metadata.beds.length >= 1, `${label}: inhabited building includes future bed slots`);
    if (buildingId === "market_square") assert(metadata.beds.length === 0, `${label}: market correctly has no residential bed slot`);
  }
}

assert(__test__.entities.length === entitiesBefore, "city builders spawn no NPCs or entities before integration");

// ---------------------------------------------------------------- market POI
console.log("\n=== the market stalls are somewhere the village can actually work ===");
{
  /**
   * Feature 10: a villager's day in Bedrock is assembled out of points of
   * interest - it claims a job site, works it in daylight, and gathers at the
   * bell in the evening. The six market canopies were pure scenery with
   * nothing underneath, so the market was somewhere nobody had any reason to
   * stand. A job-site block under each turns it into a destination.
   *
   * What is checked here is what a test can honestly check: the blocks exist,
   * they are real ids, they sit under the canopies and inside the square's own
   * reservation, and the recorded POI list matches what was built. Whether
   * vanilla's AI then walks there is a device question, and HANDOVER.md says so.
   */
  const origin = { x: 970000, y: 70, z: 0 };
  const built = buildCityBuilding("market_square", dim, origin, 0);

  const stalls = built.workstations.filter((slot) => slot.typeId !== "minecraft:composter");
  assert(stalls.length === 6, `one job site per stall (${stalls.length})`);
  assert(new Set(stalls.map((slot) => slot.typeId)).size === 6,
    "six different trades, so the stalls are not six of the same thing");

  // Every id must be one the engine knows. These are all ids this pack already
  // places elsewhere - the point being that `minecraft:stonecutter` and
  // `minecraft:oak_door` both shipped once looking just as plausible, and
  // util.js swallows the throw, so a wrong id here is an invisible stall.
  const REAL_JOB_SITES = new Set([
    "minecraft:smoker", "minecraft:loom", "minecraft:cartography_table",
    "minecraft:fletching_table", "minecraft:cauldron", "minecraft:grindstone",
    "minecraft:composter", "minecraft:barrel", "minecraft:blast_furnace",
    "minecraft:smithing_table", "minecraft:stonecutter_block", "minecraft:lectern",
    "minecraft:brewing_stand"
  ]);
  for (const slot of stalls) {
    assert(REAL_JOB_SITES.has(slot.typeId), `${slot.typeId} is a real vanilla job-site block`);
  }

  // Inside the square's own plot, or the market would be reserving ground it
  // does not own - the failure mode SPATIAL_PLAN exists to prevent.
  for (const slot of stalls) {
    assert(slot.f >= built.bounds.fMin && slot.f <= built.bounds.fMax &&
           slot.s >= built.bounds.sMin && slot.s <= built.bounds.sMax,
      `the ${slot.typeId} stands inside the square (f=${slot.f}, s=${slot.s})`);
  }

  // Under a canopy, not out in the open: a canopy is a 3x3 with corner posts,
  // so a job site on a corner would be inside a post.
  const canopyCorners = [];
  for (const s of [7, 17]) for (const f of [-41, -37, -33]) {
    for (const cf of [f, f + 2]) for (const cs of [s, s + 2]) canopyCorners.push({ f: cf, s: cs });
  }
  for (const slot of stalls) {
    assert(!canopyCorners.some((corner) => corner.f === slot.f && corner.s === slot.s),
      `the ${slot.typeId} is not inside a roof post (f=${slot.f}, s=${slot.s})`);
  }

  // And the declared list has to match the blocks that were really placed,
  // or the metadata is a promise the build did not keep.
  for (const slot of stalls) {
    const at = toWorld(origin, 0, slot.f, slot.s, slot.up);
    const placed = dim.getBlock(at)?.permutation?.typeId;
    assert(placed === slot.typeId,
      `${slot.typeId} was really placed where the metadata says (found ${placed})`);
  }

  // No beds. A villager claims a bed as its home, and this is a public plaza -
  // beds belong in the houses, where the house builders already put them.
  assert(built.beds.length === 0, `the market square is not a dormitory (${built.beds.length} beds)`);
}

console.log(failures === 0
  ? `\nALL CITY 11–15 TESTS PASSED (${checks} checks)`
  : `\n${failures} CITY 11–15 TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
