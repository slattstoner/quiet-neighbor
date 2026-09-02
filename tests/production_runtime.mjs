import { __test__, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { startProductionLoop } from "./scripts/production.js";

/**
 * Drives the worker production loop end to end, which the economy suite
 * deliberately does not: economy_contract.mjs asserts the *numbers*
 * (caps, tables, tiers) by calling the pure helpers, so it never executes
 * runFarmer or runMiner at all.
 *
 * That gap hid a real defect for as long as it existed. runFarmer declared
 *
 *     const actionsRemaining = 1;
 *     ...
 *     actionsRemaining--;
 *
 * and every ES module is strict mode, so that decrement threw
 * "TypeError: Assignment to constant variable." on every single harvest. The
 * production loop's catch swallowed it without a word, so the only symptom was
 * a line of harvest logic that could never run.
 *
 * These checks fail on that code and pass once the counter is a `let`, and
 * they also pin the two rules the loop must not break: one harvest per tick,
 * and a day's quota that only counts what actually reached the barrel.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

/** Captures console.warn so a swallowed-then-logged throw is observable. */
function captureWarnings(run) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try { run(); } finally { console.warn = original; }
  return lines;
}

const dim = __test__.makeDimension();

/**
 * A wheat field of `count` fully grown plants, with a barrel beside it.
 *
 * `naming` decides how the farmer is identified: "roleId" is how npc.js
 * actually spawns one today, "legacyName" is a villager from a world saved
 * before that property existed, and "both" is the overlap.
 */
function makeFarm(origin, count, naming = "both") {
  const barrel = dim.getBlock({ x: origin.x + 1, y: origin.y, z: origin.z });
  barrel.setType("minecraft:barrel");
  for (let i = 0; i < count; i++) {
    dim.getBlock({ x: origin.x + 3 + i, y: origin.y, z: origin.z })
      .setPermutation(BlockPermutation.resolve("minecraft:wheat", { growth: 7 }));
  }
  const farmer = dim.spawnEntity("minecraft:villager_v2", { x: origin.x, y: origin.y, z: origin.z });
  if (naming === "legacyName" || naming === "both") farmer.nameTag = "§bФермер§r";
  if (naming === "roleId" || naming === "both") farmer.setDynamicProperty("village:roleId", "farmer");
  farmer.addTag("village_worker");
  return { farmer, container: barrel.getComponent("minecraft:inventory").container };
}

function countOf(container, typeId) {
  let total = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === typeId) total += stack.amount;
  }
  return total;
}

// One registration; each tick is one call of the registered interval callback.
startProductionLoop();
const tick = system._intervals[system._intervals.length - 1];
assert(typeof tick === "function", "the production loop registered an interval");

console.log("\n=== the farmer harvests without throwing ===");
const farm = makeFarm({ x: 200, y: 70, z: 200 }, 6);
const warnings = captureWarnings(() => tick());

assert(warnings.length === 0,
  `a production pass raises nothing${warnings.length ? ": " + warnings.join(" | ") : ""}`);
assert(!warnings.some((line) => /Assignment to constant variable/.test(line)),
  "no strict-mode assignment error escapes the harvest path");

console.log("\n=== one harvest per production tick ===");
const afterOne = countOf(farm.container, "minecraft:wheat");
assert(afterOne === 1, `exactly one wheat is banked per tick (got ${afterOne})`);
assert(farm.farmer.getDynamicProperty("prod_count") === 1,
  `and the day's quota advanced by exactly one (got ${farm.farmer.getDynamicProperty("prod_count")})`);

captureWarnings(() => tick());
const afterTwo = countOf(farm.container, "minecraft:wheat");
assert(afterTwo === 2, `a second tick banks a second wheat (got ${afterTwo})`);

console.log("\n=== a full barrel never spends the day's quota ===");
{
  const full = makeFarm({ x: 400, y: 70, z: 400 }, 4);
  // Pack every slot with something wheat cannot merge into, so the harvest
  // genuinely has nowhere to go.
  for (let slot = 0; slot < full.container.size; slot++) {
    full.container.setItem(slot, new ItemStack("minecraft:cobbled_deepslate", 64));
  }

  const before = full.farmer.getDynamicProperty("prod_count") || 0;
  const noise = captureWarnings(() => tick());
  const after = full.farmer.getDynamicProperty("prod_count") || 0;

  assert(noise.length === 0, `a full-barrel pass raises nothing${noise.length ? ": " + noise.join(" | ") : ""}`);
  assert(after === before,
    `a harvest with nowhere to go does not count against the quota (${before} -> ${after})`);
  assert(countOf(full.container, "minecraft:wheat") === 0,
    "and no wheat was conjured into a container that had no room");
}

// ---------- роль читается из village:roleId, а не из имени ----------
console.log("\n=== a worker is identified by its role id, not its display name ===");
{
  // How npc.js actually spawns a farmer today: a coloured name tag *and*
  // village:roleId. The name tag is user-facing text, so nothing may depend on
  // its exact spelling - this farmer has no recognisable name at all.
  const renamed = makeFarm({ x: 600, y: 70, z: 600 }, 3, "roleId");
  renamed.farmer.nameTag = "§bМарта-пряха§r";
  captureWarnings(() => tick());
  assert(countOf(renamed.container, "minecraft:wheat") === 1,
    `a farmer whose name was changed keeps working (${countOf(renamed.container, "minecraft:wheat")} wheat)`);

  // And a villager from a world saved before village:roleId existed is still
  // recognised, so the change cannot strand an existing save.
  const legacy = makeFarm({ x: 800, y: 70, z: 800 }, 3, "legacyName");
  assert(legacy.farmer.getDynamicProperty("village:roleId") === undefined,
    "the legacy farmer really has no role id");
  captureWarnings(() => tick());
  assert(countOf(legacy.container, "minecraft:wheat") === 1,
    `a pre-roleId farmer is still recognised by name (${countOf(legacy.container, "minecraft:wheat")} wheat)`);

  // A villager with neither is not a worker and must be left alone.
  const stranger = makeFarm({ x: 1000, y: 70, z: 1000 }, 3, "none");
  captureWarnings(() => tick());
  assert(countOf(stranger.container, "minecraft:wheat") === 0,
    "a tagged villager with no role at all produces nothing");
}

console.log(failures === 0 ? "\nALL PRODUCTION RUNTIME CHECKS PASSED" : `\n${failures} PRODUCTION RUNTIME CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
