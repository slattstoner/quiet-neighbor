import { __test__, BlockPermutation } from "@minecraft/server";
import { buildTownHall, buildFarmerHouse, buildBlacksmithHouse, buildCartographerHouse, buildPlainHouse } from "./scripts/builder.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

function blockAt(dim, x, y, z) {
  return dim.getBlock({ x, y, z }).typeId;
}

/**
 * Walks the wall perimeter of a house at every height level and checks for
 * "holes" - wall positions that ended up as air (other than the doorway,
 * which is intentional) because something (like the interior hollow-out
 * step) carved into them by mistake.
 */
function checkWallIntegrity(dim, origin, facing, f1, f2, s1, s2, height, doorForward, doorS) {
  let holes = 0;
  const sMin = Math.min(s1, s2), sMax = Math.max(s1, s2);
  for (let up = 0; up <= height - 1; up++) {
    for (let f = f1; f <= f2; f++) {
      for (const s of [sMin, sMax]) {
        const isDoorGap = (f === doorForward && s === doorS && (up === 0 || up === 1));
        if (isDoorGap) continue;
        const p = toWorld(origin, facing, f, s, up);
        const type = blockAt(dim, p.x, p.y, p.z);
        if (type === "minecraft:air") {
          holes++;
          console.error(`  hole at local(f=${f}, s=${s}, up=${up}) -> world(${p.x},${p.y},${p.z})`);
        }
      }
    }
    for (let s = sMin; s <= sMax; s++) {
      for (const f of [f1, f2]) {
        const p = toWorld(origin, facing, f, s, up);
        const type = blockAt(dim, p.x, p.y, p.z);
        // window positions are intentionally glass, not a "hole", so only
        // flag genuine air here
        if (type === "minecraft:air") {
          holes++;
          console.error(`  hole at local(f=${f}, s=${s}, up=${up}) -> world(${p.x},${p.y},${p.z})`);
        }
      }
    }
  }
  return holes;
}

const FURNITURE_OK = new Set([
  "minecraft:air",
  "minecraft:red_carpet", "minecraft:black_carpet", "minecraft:light_gray_carpet",
  "minecraft:light_blue_carpet", "minecraft:moss_carpet",
  "minecraft:red_bed", "minecraft:bed", "minecraft:chest", "minecraft:barrel",
  "minecraft:crafting_table", "minecraft:anvil", "minecraft:furnace", "minecraft:blast_furnace",
  "minecraft:bookshelf", "minecraft:hay_block", "minecraft:flower_pot", "minecraft:potted_poppy",
  "minecraft:potted_dandelion", "minecraft:potted_cornflower", "minecraft:item_frame",
  "minecraft:frame", "minecraft:oak_fence", "minecraft:oak_pressure_plate",
  "minecraft:lectern", "minecraft:composter", "minecraft:smithing_table",
  "minecraft:cartography_table", "minecraft:wall_banner",
  // furniture added in the interior-detailing pass
  "minecraft:oak_stairs", "minecraft:birch_stairs", "minecraft:spruce_stairs",
  "minecraft:cauldron", "minecraft:grindstone", "minecraft:coal_block",
  "minecraft:stonecutter", "minecraft:iron_block", "minecraft:brown_carpet",
  "minecraft:moss_carpet", "minecraft:cobblestone_slab", "minecraft:gravel",
  "minecraft:lantern", "minecraft:torch"
]);

function checkInteriorWalkable(dim, origin, facing, f1, f2, s1, s2, height) {
  const sMin = Math.min(s1, s2) + 1;
  const sMax = Math.max(s1, s2) - 1;
  let blocked = 0;
  for (let f = f1 + 1; f <= f2 - 1; f++) {
    for (let s = sMin; s <= sMax; s++) {
      const p = toWorld(origin, facing, f, s, 0);
      const type = blockAt(dim, p.x, p.y, p.z);
      // Only flag it if something structural (walls/roof material) leaked
      // into the room - intentional furniture/decor is fine and expected.
      if (!FURNITURE_OK.has(type)) {
        blocked++;
        console.error(`  interior blocked at local(f=${f}, s=${s}, up=0) -> ${type}`);
      }
    }
  }
  return blocked;
}

const dim = __test__.makeDimension();

const cases = [
  { name: "town hall", fn: () => buildTownHall(dim, { x: 0, y: 70, z: 0 }, 0), origin: { x: 0, y: 70, z: 0 }, facing: 0 },
  { name: "farmer house (left)", fn: () => buildFarmerHouse(dim, { x: 100, y: 70, z: 0 }, 0, 12, -1), origin: { x: 100, y: 70, z: 0 }, facing: 0 },
  { name: "blacksmith house (right)", fn: () => buildBlacksmithHouse(dim, { x: 200, y: 70, z: 0 }, 0, 12, 1), origin: { x: 200, y: 70, z: 0 }, facing: 0 },
  { name: "cartographer house, facing +Z", fn: () => buildCartographerHouse(dim, { x: 300, y: 70, z: 0 }, 2, 22, -1), origin: { x: 300, y: 70, z: 0 }, facing: 2 },
  { name: "plain house, facing -X", fn: () => buildPlainHouse(dim, { x: 400, y: 70, z: 0 }, 1, 0, -1), origin: { x: 400, y: 70, z: 0 }, facing: 1 },
];

for (const c of cases) {
  console.log(`\n--- ${c.name} ---`);
  const shape = c.fn();
  const doorForward = shape.f1 + Math.floor((shape.f2 - shape.f1 + 1) / 2);
  const holes = checkWallIntegrity(dim, c.origin, c.facing, shape.f1, shape.f2, shape.s1, shape.s2, shape.height, doorForward, shape.s1);
  assert(holes === 0, `${c.name}: walls have no unintended holes (found ${holes})`);
  const blocked = checkInteriorWalkable(dim, c.origin, c.facing, shape.f1, shape.f2, shape.s1, shape.s2, shape.height);
  assert(blocked === 0, `${c.name}: interior floor is fully walkable (found ${blocked} blocked tiles)`);
}


// Production-layout compatibility: every real plot must have a physical door.
const productionCases = [
  { f: 12, s: -10 }, { f: 12, s: 10 }, { f: -12, s: -10 },
  { f: -26, s: 10 }, { f: 26, s: -10 }, { f: 26, s: 10 },
  { f: 38, s: -10 }
];
for (const c of productionCases) {
  const plotOrigin = { x: 5000 + c.f * 20, y: 70, z: c.s * 20 };
  const shape = buildPlainHouse(dim, plotOrigin, 0, c.f, c.s);
  const doorPos = toWorld(plotOrigin, 0, shape.doorForward, shape.s1, 0);
  const door = dim.getBlock(doorPos);
  assert(door.typeId !== "minecraft:air", `production plot ${c.f}/${c.s} has a door block`);
  assert(door.typeId !== "minecraft:unknown", `production plot ${c.f}/${c.s} has no unknown block`);
}

console.log(failures === 0 ? "\nALL GEOMETRY TESTS PASSED" : `\n${failures} GEOMETRY TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

function checkWallMaterialIntact(dim, origin, facing, shape, expectedMaterials, label) {
  let wrong = 0;
  const sMin = shape.sMin, sMax = shape.sMax;
  for (let up = 0; up <= shape.height - 1; up++) {
    for (let f = shape.f1; f <= shape.f2; f++) {
      for (const s of [sMin, sMax]) {
        if (f === shape.doorForward && s === shape.s1 && up <= 1) continue; // doorway
        const p = toWorld(origin, facing, f, s, up);
        const type = blockAt(dim, p.x, p.y, p.z);
        if (type !== "minecraft:air" && !expectedMaterials.includes(type)) {
          wrong++;
          console.error(`  [${label}] wall row has unexpected material at local(f=${f},s=${s},up=${up}): ${type}`);
        }
      }
    }
  }
  return wrong;
}

{
  const origin = { x: 900000, y: 70, z: 0 };
  const shape = buildFarmerHouse(dim, origin, 0, 0, 1);
  const farmerWallMats = [
    "minecraft:oak_planks", "minecraft:oak_log", "minecraft:cobblestone",
    "minecraft:oak_stairs", "minecraft:wooden_door"
  ];
  const wrong = checkWallMaterialIntact(dim, origin, 0, shape, farmerWallMats, "farmer house");
  assert(wrong === 0, `farmer house: crop-patch fence does not overwrite the back wall (${wrong} contaminated wall blocks)`);
}
