import { __test__ } from "@minecraft/server";
import { foundVillage } from "./scripts/village.js";
import { applyCraftsmanUpgrade, farmerYardFootprint } from "./scripts/upgrades.js";
import { fullVillageMaxForward } from "./scripts/levels.js";
import { buildFarmerHouse } from "./scripts/builder.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }
function blockAt(dim, origin, f, s, up = 0) { const p = toWorld(origin, 0, f, s, up); return dim.getBlock(p).typeId; }

function spawnFarmer(dim, origin, plotForward = 12, plotSide = -1) {
  const farmer = dim.spawnEntity("minecraft:villager_v2", { x: origin.x + plotForward, y: origin.y, z: origin.z + plotSide });
  farmer.nameTag = "§bФермер§r";
  farmer.setDynamicProperty("village:plotForward", plotForward);
  farmer.setDynamicProperty("village:plotSide", plotSide);
  return farmer;
}

const dim = __test__.makeDimension();
const player = __test__.makePlayer("UpgradeTester", { x: 800000, y: 70, z: 0 });
const origin = { x: 800000, y: 70, z: 0 };
const elder = foundVillage(player, origin, 0);
const plotForward = 12, plotSide = -1;
buildFarmerHouse(dim, origin, 0, plotForward, plotSide, elder.getDynamicProperty("village:palette"));
const farmer = spawnFarmer(dim, origin, plotForward, plotSide);

// The house's own footprint (facing=0, side=-1 -> legacy near-road plot,
// centre -6, half-depth 3: sMin=-9, sMax=-3) and its far corner post,
// which the old tier-1 field overlapped and replaced with farmland.
const houseCornerF = plotForward, houseCornerS = -9;
const houseCornerBefore = blockAt(dim, origin, houseCornerF, houseCornerS, 0);

console.log("\n=== farmer quest visual progression ===");
const upgrades = [
  { tier: 1, label: "Большое поле", expected: "minecraft:carrots" },
  { tier: 2, label: "Курятник", expected: "minecraft:hay_block" },
  { tier: 3, label: "Коровник", expected: "minecraft:hay_block" },
  { tier: 4, label: "Свинарник", expected: "minecraft:mud" },
  { tier: 5, label: "Амбарный двор", expected: "minecraft:barrel" }
];

// Snapshot the chicken coop's corner post right after tier 2, before tier 3
// (the cow barn, immediately behind it) is built - this is the exact
// regression from the bug report: finishing the 3rd quest tore down part
// of the 2nd tier's chicken coop because the two footprints overlapped.
let coopCornerAfterTier2 = null;

for (const upgrade of upgrades) {
  const result = applyCraftsmanUpgrade(farmer, elder, upgrade);
  assert(result.ok && result.tier === upgrade.tier, `tier ${upgrade.tier} applies: ${upgrade.label}`);
  assert(farmer.getDynamicProperty("village:upgradeTier") === upgrade.tier, `tier ${upgrade.tier} persists on farmer`);
  if (upgrade.tier === 2) coopCornerAfterTier2 = blockAt(dim, origin, 10, -25, 0);
}

assert(houseCornerBefore !== "minecraft:air", "sanity: house corner exists before any upgrade");
assert(blockAt(dim, origin, houseCornerF, houseCornerS, 0) === houseCornerBefore,
  "tier-1 field no longer overlaps and replaces the farmer's house");

assert(coopCornerAfterTier2 && coopCornerAfterTier2 !== "minecraft:air", "chicken coop corner post exists after tier 2");
assert(blockAt(dim, origin, 10, -25, 0) === coopCornerAfterTier2,
  "tier-3 cow barn no longer overlaps and demolishes part of the tier-2 chicken coop");

const animals = dim.getEntities({});
assert(animals.filter((e) => e.typeId === "minecraft:chicken").length >= 2, "chicken coop spawns chickens");
assert(animals.filter((e) => e.typeId === "minecraft:cow").length >= 2, "cow barn spawns cows");
assert(animals.filter((e) => e.typeId === "minecraft:pig").length >= 2, "pig pen spawns pigs");
assert(blockAt(dim, origin, 26, -28, -1) === "minecraft:mud", "pig pen has a mud feature");

// The farmer's whole backyard (field + all four pen bays) must stay well
// inside the village's eventual wall ring - the wall is sized to the
// village's full final extent from its very first fortification tier (see
// fullVillageMaxForward()'s own doc comment), so this is the real
// constraint, not an arbitrary |side| guess.
const yard = farmerYardFootprint(plotForward, plotSide);
const wallRadius = fullVillageMaxForward() + 10;
assert(Math.abs(yard.sMax) < wallRadius && Math.abs(yard.fMax) < wallRadius,
  "farmer's backyard stays inside the future wall line");
assert(blockAt(dim, origin, 26, yard.sMax, 0) !== "minecraft:air",
  "farmer upgrade footprint matches the exported yard geometry");

const duplicate = applyCraftsmanUpgrade(farmer, elder, { tier: 5, label: "Амбарный двор" });
assert(duplicate.ok && duplicate.alreadyApplied === true, "completed upgrade is not rebuilt twice");

console.log("\n=== farmer quest upgrades respect the village's biome palette ===");
const desertOrigin = { x: 800200, y: 70, z: 0 };
const desertPlayer = __test__.makePlayer("DesertUpgradeTester", { x: 800200, y: 70, z: 0 });
const desertElder = foundVillage(desertPlayer, desertOrigin, 0, "desert");
const desertFarmer = spawnFarmer(dim, desertOrigin);
applyCraftsmanUpgrade(desertFarmer, desertElder, { tier: 1, label: "Большое поле" });
applyCraftsmanUpgrade(desertFarmer, desertElder, { tier: 2, label: "Курятник" });
assert(blockAt(dim, desertOrigin, 10, -25, 0) === "minecraft:acacia_log",
  "desert-biome village builds the chicken coop out of the desert palette, not hardcoded oak");

console.log(failures === 0 ? "\nALL QUEST UPGRADE TESTS PASSED" : `\n${failures} QUEST UPGRADE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
