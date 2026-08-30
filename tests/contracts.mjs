// Stage 5: repeatable contracts.
//
// Every other quest in the mod is once per village - the four craftsman
// chains, the watchman's arc, the specialists' errands. Finish them and the
// village has nothing left to ask for. A contract is the opposite: one
// standing errand, rotating daily, always available.
//
// The thing most worth guarding here is the reward. The mod's standing rule is
// that the village must never out-earn the player's own mining and farming,
// and a daily errand is exactly where that quietly stops being true.

import { __test__, ItemStack, world } from "@minecraft/server";
import {
  CONTRACTS, contractForDay, contractsAvailableAt, contractView, turnInContract,
  standingOf, contractsCompleted, contractDoneToday, standingDiscountFor,
  MAX_DISCOUNT_FRACTION, DISCOUNT_PER_STANDING
} from "./scripts/contracts.js";
import { LEVELS } from "./scripts/levels.js";
import { foundVillage, effectiveRequirementsText, getVillageState } from "./scripts/village.js";
import { PROP_LEVEL } from "./scripts/village_state.js";

let checks = 0, failures = 0;
function assert(condition, label) {
  checks++;
  if (condition) console.log(`ok: ${label}`);
  else { failures++; console.error(`FAIL: ${label}`); }
}

// ---------------------------------------------------------------- 1
console.log("=== the pool is sane and stays inside the economy rules ===");
{
  const ids = new Set();
  for (const contract of CONTRACTS) {
    assert(!ids.has(contract.id), `${contract.id}: unique`);
    ids.add(contract.id);
    assert(contract.itemId.startsWith("minecraft:"), `${contract.id}: asks for a vanilla item`);
    assert(contract.amount > 0 && contract.amount <= 64, `${contract.id}: asks for a sane amount (${contract.amount})`);
    assert(Number.isInteger(contract.minLevel) && contract.minLevel >= 2, `${contract.id}: has a level gate`);
    // Nothing here may hand out what the player is supposed to go and find.
    assert(!/diamond|netherite|enchanted|golden_apple/.test(contract.rewardItem),
      `${contract.id}: its reward does not undercut the player's own mining (${contract.rewardItem})`);
    assert(contract.rewardAmount > 0 && contract.rewardAmount <= 16, `${contract.id}: reward is modest (${contract.rewardAmount})`);
  }
  assert(CONTRACTS.length >= 6, `there are enough to rotate through (${CONTRACTS.length})`);
}

// ---------------------------------------------------------------- 2
console.log("\n=== rotation is by day, not by chance ===");
{
  // Same day, same village, same errand - so two players are never told
  // different things, and no rotation state has to be stored anywhere.
  for (const day of [0, 1, 7, 100, 1234]) {
    const first = contractForDay(10, day);
    const second = contractForDay(10, day);
    assert(first === second, `day ${day}: the same contract every time it is asked for`);
  }
  const overWeek = new Set();
  for (let day = 0; day < 14; day++) overWeek.add(contractForDay(10, day)?.id);
  assert(overWeek.size >= 5, `a fortnight offers real variety (${overWeek.size} different contracts)`);
  assert(contractForDay(1, 0) === null, "a level-1 village is not asked for anything");
  for (const level of [2, 4, 8, 15]) {
    const pool = contractsAvailableAt(level);
    assert(pool.length > 0 && pool.every((c) => c.minLevel <= level), `L${level}: only offers what it has earned (${pool.length})`);
  }
  assert(contractsAvailableAt(15).length >= contractsAvailableAt(4).length, "the pool grows with the village");
}

// ---------------------------------------------------------------- 3
console.log("\n=== handing one in ===");
{
  const player = __test__.makePlayer("ContractTester", { x: 960000, y: 70, z: 960000 });
  const elder = foundVillage(player, { x: 960000, y: 70, z: 960000 }, 0);
  elder.setDynamicProperty(PROP_LEVEL, 10);
  const container = player.getComponent("minecraft:inventory").container;
  const day = 3;

  const view = contractView(elder, day);
  assert(view.available && !!view.contract, "there is a contract on the board");
  const contract = view.contract;

  const short = turnInContract(player, elder, day);
  assert(!short.ok && short.reason === "not_enough", "an empty-handed turn-in is refused");
  assert(standingOf(elder) === 0, "…and earns nothing");

  container.setItem(0, new ItemStack(contract.itemId, contract.amount));
  const done = turnInContract(player, elder, day);
  assert(done.ok, `the contract is accepted (${contract.id})`);
  assert(standingOf(elder) === 1 && contractsCompleted(elder) === 1, "standing and the tally both move");
  assert(contractDoneToday(elder, day), "today's contract is marked closed");

  let held = 0, reward = 0;
  for (let i = 0; i < container.size; i++) {
    const stack = container.getItem(i);
    if (stack?.typeId === contract.itemId) held += stack.amount;
    if (stack?.typeId === contract.rewardItem) reward += stack.amount;
  }
  assert(held === 0, "the goods were actually taken");
  assert(reward >= contract.rewardAmount, `the reward was actually paid (${reward})`);

  container.setItem(0, new ItemStack(contract.itemId, contract.amount));
  const again = turnInContract(player, elder, day);
  assert(!again.ok && again.reason === "done_today", "the same day cannot be farmed twice");
  let stillHeld = 0;
  for (let i = 0; i < container.size; i++) if (container.getItem(i)?.typeId === contract.itemId) stillHeld += container.getItem(i).amount;
  assert(stillHeld === contract.amount, "…and a refused turn-in takes nothing");

  const tomorrow = contractView(elder, day + 1);
  assert(tomorrow.available, "tomorrow there is a new one");
}

// ---------------------------------------------------------------- 4
console.log("\n=== standing shortens the grind without deleting it ===");
{
  const player = __test__.makePlayer("StandingTester", { x: 990000, y: 70, z: 990000 });
  const elder = foundVillage(player, { x: 990000, y: 70, z: 990000 }, 0);
  elder.setDynamicProperty(PROP_LEVEL, 4);
  const container = player.getComponent("minecraft:inventory").container;

  const before = effectiveRequirementsText(elder);
  assert(standingDiscountFor(elder, 5) && Object.keys(standingDiscountFor(elder, 5)).length === 0,
    "no standing means no discount");

  for (let day = 0; day < 30; day++) {
    const view = contractView(elder, day);
    if (!view.available) continue;
    container.setItem(0, new ItemStack(view.contract.itemId, view.contract.amount));
    turnInContract(player, elder, day);
  }
  assert(standingOf(elder) >= 20, `thirty days of contracts build real standing (${standingOf(elder)})`);

  // The cap is the point: standing should shorten the grind, never remove it.
  const discounts = standingDiscountFor(elder, 5);
  assert(Object.keys(discounts).length > 0, "standing now discounts the next level");
  for (const [itemId, value] of Object.entries(discounts)) {
    const full = LEVELS[5].requirements[itemId];
    assert(value <= Math.floor(full * MAX_DISCOUNT_FRACTION),
      `${itemId}: discounted by at most a quarter (${value} of ${full})`);
  }

  const after = effectiveRequirementsText(elder);
  assert(after !== before, "the elder's requirements screen actually reflects it");
  // Even with enormous standing, nothing may fall to zero.
  elder.setDynamicProperty("village:contract:standing", 9999);
  for (const [itemId, value] of Object.entries(standingDiscountFor(elder, 5))) {
    const full = LEVELS[5].requirements[itemId];
    assert(full - value >= 1, `${itemId}: a level can never be discounted into nothing (${full - value} left)`);
  }
}

// ---------------------------------------------------------------- 5
console.log("\n=== the world day the rotation reads is real API ===");
{
  world.setDay(42);
  assert(world.getDay() === 42, "world.getDay round-trips");
  assert(contractForDay(10, world.getDay()) === contractForDay(10, 42), "the rotation reads it the same way the menu does");
}

console.log(failures === 0
  ? `\nALL CONTRACT TESTS PASSED (${checks} checks)`
  : `\n${failures} CONTRACT TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
