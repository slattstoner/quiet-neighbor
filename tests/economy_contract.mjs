import { __test__, system, world } from "@minecraft/server";
import {
  DAILY_CAP,
  STORAGE_CAP,
  MINER_TABLE,
  ROLE_FARMER,
  ROLE_MINER,
  startProductionLoop,
  workerDailyCap,
  workerStorageCap
} from "./scripts/production.js";

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error("FAIL:", message);
  } else {
    console.log("ok:", message);
  }
}

function workerAtTier(tier) {
  return {
    getDynamicProperty(key) {
      return key === "village:upgradeTier" ? tier : undefined;
    }
  };
}

console.log("\n=== absolute production caps ===");
assert(DAILY_CAP[ROLE_FARMER] === 12, "farmer daily constant is 12");
assert(STORAGE_CAP[ROLE_FARMER] === 64, "farmer storage constant is 64");
assert(DAILY_CAP[ROLE_MINER] === 6, "miner daily constant is 6");
assert(STORAGE_CAP[ROLE_MINER] === 32, "miner storage constant is 32");

for (let tier = 0; tier <= 5; tier++) {
  const worker = workerAtTier(tier);
  assert(workerDailyCap(worker, ROLE_FARMER) === 12, `farmer tier ${tier} keeps daily cap 12`);
  assert(workerStorageCap(worker, ROLE_FARMER) === 64, `farmer tier ${tier} keeps storage cap 64`);
  assert(workerDailyCap(worker, ROLE_MINER) === 6, `miner tier ${tier} keeps daily cap 6`);
  assert(workerStorageCap(worker, ROLE_MINER) === 32, `miner tier ${tier} keeps storage cap 32`);
}
assert(workerDailyCap(workerAtTier(99), "unknown_role") === 0, "unknown role has no daily production cap");
assert(workerStorageCap(workerAtTier(-1), "unknown_role") === 0, "unknown role has no storage production cap");

console.log("\n=== miner pool ===");
const allowedMinerPool = new Set([
  "minecraft:iron_ingot",
  "minecraft:gold_ingot",
  "minecraft:redstone",
  "minecraft:lapis_lazuli"
]);
const forbiddenMinerPool = new Set([
  "minecraft:diamond",
  "minecraft:emerald",
  "minecraft:netherite_ingot",
  "minecraft:netherite_scrap",
  "minecraft:ancient_debris",
  "minecraft:enchanted_book"
]);
assert(MINER_TABLE.length === 4, "miner table has exactly the approved four entries");
assert(MINER_TABLE.every((entry) => allowedMinerPool.has(entry.typeId)), "miner table contains only approved ordinary resources");
assert(MINER_TABLE.every((entry) => !forbiddenMinerPool.has(entry.typeId)), "miner table contains no forbidden high-value resource");
assert(MINER_TABLE.every((entry) => Number.isInteger(entry.weight) && entry.weight > 0 && Number.isInteger(entry.max) && entry.max >= 1),
  "every miner entry has positive integer weight and output bound");

console.log("\n=== hard cap under repeated production ticks ===");
{
  const dim = __test__.makeDimension();
  const miner = dim.spawnEntity("minecraft:villager_v2", { x: 910000, y: 70, z: 910000 });
  miner.nameTag = "§bШахтёр§r";
  miner.addTag("village_worker");
  miner.setDynamicProperty("village:upgradeTier", 5);

  const chest = dim.getBlock({ x: 910001, y: 70, z: 910000 });
  chest.setPermutation({ typeId: "minecraft:chest", states: {} });
  const storage = chest.getComponent("minecraft:inventory").container;

  world._absoluteTime += 24000;
  startProductionLoop();
  const tick = system._intervals[system._intervals.length - 1];
  for (let i = 0; i < 1000; i++) tick();

  let total = 0;
  const producedTypes = new Set();
  for (let i = 0; i < storage.size; i++) {
    const stack = storage.getItem(i);
    if (stack) {
      total += stack.amount;
      producedTypes.add(stack.typeId);
    }
  }
  assert(total <= 6, `tier-5 miner never exceeds daily cap after 1000 ticks (${total} <= 6)`);
  assert(total <= 32, `tier-5 miner never exceeds storage cap after 1000 ticks (${total} <= 32)`);
  assert([...producedTypes].every((typeId) => allowedMinerPool.has(typeId)), "repeated miner production stays within approved pool");
}

console.log("\n=== full storage stops production ===");
{
  const dim = __test__.makeDimension();
  const miner = dim.spawnEntity("minecraft:villager_v2", { x: 920000, y: 70, z: 920000 });
  miner.nameTag = "§bШахтёр§r";
  miner.addTag("village_worker");
  miner.setDynamicProperty("village:upgradeTier", 5);

  const chest = dim.getBlock({ x: 920001, y: 70, z: 920000 });
  chest.setPermutation({ typeId: "minecraft:chest", states: {} });
  const storage = chest.getComponent("minecraft:inventory").container;
  storage.setItem(0, { typeId: "minecraft:cobblestone", amount: 32 });

  world._absoluteTime += 24000;
  startProductionLoop();
  const tick = system._intervals[system._intervals.length - 1];
  for (let i = 0; i < 100; i++) tick();

  let total = 0;
  for (let i = 0; i < storage.size; i++) total += storage.getItem(i)?.amount || 0;
  assert(total === 32, `tier-5 miner leaves a full 32-item storage unchanged (${total})`);
}

console.log(failures === 0 ? "\nALL ECONOMY CONTRACT TESTS PASSED" : `\n${failures} ECONOMY CONTRACT TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
