import { __test__ } from "@minecraft/server";
import { foundVillage } from "./scripts/village.js";
import { applyCraftsmanUpgrade } from "./scripts/upgrades.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }
function blockAt(dim, origin, f, s, up = 0) { const p = toWorld(origin, 0, f, s, up); return dim.getBlock(p).typeId; }

const dim = __test__.makeDimension();
const player = __test__.makePlayer("UpgradeTester", { x: 800000, y: 70, z: 0 });
const origin = { x: 800000, y: 70, z: 0 };
const elder = foundVillage(player, origin, 0);
const farmer = dim.spawnEntity("minecraft:villager_v2", { x: origin.x + 12, y: origin.y, z: origin.z - 12 });
farmer.nameTag = "§bФермер§r";
farmer.setDynamicProperty("village:plotForward", 12);
farmer.setDynamicProperty("village:plotSide", -1);

console.log("\n=== farmer quest visual progression ===");
const upgrades = [
  { tier: 1, label: "Большое поле", expected: "minecraft:wheat" },
  { tier: 2, label: "Курятник", expected: "minecraft:hay_block" },
  { tier: 3, label: "Коровник", expected: "minecraft:hay_block" },
  { tier: 4, label: "Свинарник", expected: "minecraft:mud" },
  { tier: 5, label: "Амбарный двор", expected: "minecraft:barrel" }
];
for (const upgrade of upgrades) {
  const result = applyCraftsmanUpgrade(farmer, elder, upgrade);
  assert(result.ok && result.tier === upgrade.tier, `tier ${upgrade.tier} applies: ${upgrade.label}`);
  assert(farmer.getDynamicProperty("village:upgradeTier") === upgrade.tier, `tier ${upgrade.tier} persists on farmer`);
}

const animals = dim.getEntities({});
assert(animals.filter((e) => e.typeId === "minecraft:chicken").length >= 2, "chicken coop spawns chickens");
assert(animals.filter((e) => e.typeId === "minecraft:cow").length >= 2, "cow barn spawns cows");
assert(animals.filter((e) => e.typeId === "minecraft:pig").length >= 2, "pig pen spawns pigs");
assert(blockAt(dim, origin, 31, -12, -1) === "minecraft:mud", "pig pen has a mud feature");
assert(blockAt(dim, origin, 12, -15, 0) !== "minecraft:air", "farmer upgrade stays within the future wall line");

const duplicate = applyCraftsmanUpgrade(farmer, elder, { tier: 5, label: "Амбарный двор" });
assert(duplicate.ok && duplicate.alreadyApplied === true, "completed upgrade is not rebuilt twice");

console.log(failures === 0 ? "\nALL QUEST UPGRADE TESTS PASSED" : `\n${failures} QUEST UPGRADE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
