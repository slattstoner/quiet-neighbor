import { __test__ } from "@minecraft/server";
import { buildPlainHouse, buildFarmerHouse, buildBlacksmithHouse, buildCartographerHouse, buildMinerHouse, buildTownHall } from "./scripts/builder.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}
function blockAt(dim, x, y, z) {
  return dim.getBlock({ x, y, z }).typeId;
}

const CARDINAL_DELTA = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 }
};

const FACING_TYPES = [
  "minecraft:chest", "minecraft:furnace", "minecraft:blast_furnace",
  "minecraft:barrel", "minecraft:cartography_table", "minecraft:smithing_table", "minecraft:lectern"
];

/**
 * Scans every appliance block with a cardinal_direction state inside a
 * house's world footprint and checks that the direction it opens toward
 * is open room air, not the solid wall it's standing against. This is
 * exactly the bug pattern found in testing: several back-wall appliances
 * were oriented "inward" (into the wall) instead of toward the room.
 */
function scanAppliances(dim, origin, facing, shape, label) {
  let checked = 0;
  let backwards = 0;
  const corners = [
    toWorld(origin, facing, shape.f1, shape.sMin, 0),
    toWorld(origin, facing, shape.f2, shape.sMax, 0)
  ];
  const minX = Math.min(corners[0].x, corners[1].x), maxX = Math.max(corners[0].x, corners[1].x);
  const minZ = Math.min(corners[0].z, corners[1].z), maxZ = Math.max(corners[0].z, corners[1].z);

  for (const [key, rec] of __test__.blockStore.entries()) {
    if (!FACING_TYPES.includes(rec.typeId)) continue;
    const cardinal = rec.states && rec.states["minecraft:cardinal_direction"];
    if (!cardinal) continue;
    const [x, y, z] = key.split(",").map(Number);
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;

    const delta = CARDINAL_DELTA[cardinal];
    if (!delta) continue;
    checked++;
    const frontType = blockAt(dim, x + delta.dx, y, z + delta.dz);
    if (frontType !== "minecraft:air") {
      backwards++;
      const backType = blockAt(dim, x - delta.dx, y, z - delta.dz);
      console.error(`  [${label}] ${rec.typeId} at (${x},${y},${z}) facing ${cardinal}: front=${frontType} (blocked), back=${backType}`);
    }
  }
  return { checked, backwards };
}

const dim = __test__.makeDimension();
let totalChecked = 0;

const cases = [
  { name: "town hall", origin: { x: 500000, y: 70, z: 0 }, facing: 0, build: (d, o, f) => buildTownHall(d, o, f) },
  { name: "plain house, right plot, facing +X", origin: { x: 501000, y: 70, z: 0 }, facing: 0, build: (d, o, f) => buildPlainHouse(d, o, f, 0, 1) },
  { name: "plain house, left plot, facing +X", origin: { x: 502000, y: 70, z: 0 }, facing: 0, build: (d, o, f) => buildPlainHouse(d, o, f, 0, -1) },
  { name: "farmer, right plot, facing +Z", origin: { x: 503000, y: 70, z: 0 }, facing: 2, build: (d, o, f) => buildFarmerHouse(d, o, f, 0, 1) },
  { name: "farmer, left plot, facing +Z", origin: { x: 503500, y: 70, z: 0 }, facing: 2, build: (d, o, f) => buildFarmerHouse(d, o, f, 0, -1) },
  { name: "blacksmith, right plot, facing -X", origin: { x: 504000, y: 70, z: 0 }, facing: 1, build: (d, o, f) => buildBlacksmithHouse(d, o, f, 0, 1) },
  { name: "blacksmith, left plot, facing -X", origin: { x: 504500, y: 70, z: 0 }, facing: 1, build: (d, o, f) => buildBlacksmithHouse(d, o, f, 0, -1) },
  { name: "cartographer, right plot, facing -Z", origin: { x: 505000, y: 70, z: 0 }, facing: 3, build: (d, o, f) => buildCartographerHouse(d, o, f, 0, 1) },
  { name: "cartographer, left plot, facing -Z", origin: { x: 505500, y: 70, z: 0 }, facing: 3, build: (d, o, f) => buildCartographerHouse(d, o, f, 0, -1) },
  { name: "miner, right plot, facing +X", origin: { x: 506000, y: 70, z: 0 }, facing: 0, build: (d, o, f) => buildMinerHouse(d, o, f, 0, 1) },
  { name: "miner, left plot, facing +X", origin: { x: 506500, y: 70, z: 0 }, facing: 0, build: (d, o, f) => buildMinerHouse(d, o, f, 0, -1) }
];

for (const c of cases) {
  const shape = c.build(dim, c.origin, c.facing);
  const result = scanAppliances(dim, c.origin, c.facing, shape, c.name);
  totalChecked += result.checked;
  assert(result.checked > 0, `${c.name}: at least one facing-appliance was found to check`);
  assert(result.backwards === 0, `${c.name}: all ${result.checked} appliances open into the room, not the wall`);
}

assert(totalChecked >= 10, `enough appliances were actually scanned to mean something (${totalChecked})`);

console.log(failures === 0 ? "\nALL ORIENTATION TESTS PASSED" : `\n${failures} ORIENTATION TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
