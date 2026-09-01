import { __test__, ItemStack } from "@minecraft/server";
import { turnInContract, CONTRACTS } from "./scripts/contracts.js";
import { turnInSpecialQuest, SPECIAL_QUESTS } from "./scripts/special_content.js";
import { giveProduct, ALCHEMIST_PRODUCTS } from "./scripts/specials.js";
import { turnInQuest, QUESTS } from "./scripts/quests.js";

/**
 * A turn-in must never take the player's goods and then fail to pay.
 *
 * Container.addItem does not throw when there is no room - it returns the
 * ItemStack it could not place (see the Container docs, "Returns: ItemStack |
 * undefined"). Four reward paths ignored that return value entirely:
 *
 *   contracts.js       turnInContract       - the daily errand, repeated forever
 *   special_content.js turnInSpecialQuest   - the old-timer's three chains
 *   specials.js        giveProduct          - the alchemist's shop
 *   quests.js          turnInQuest          - the legacy craftsman path
 *
 * On a full inventory every one of them removed the requirement (or charged
 * the emeralds), called addItem, dropped the returned overflow on the floor of
 * the JS engine, and reported success. The player paid and got nothing.
 *
 * craftsman_quests.js and sentinel_quests.js never had this bug: they reserve
 * the destination slot before touching anything and return "inventory_full"
 * instead. This suite holds the other four to the same standard.
 *
 * Note this suite could not have caught the bug before the mock was fixed in
 * the same change: the old mock's addItem returned undefined whether or not the
 * item landed, so "paid and got nothing" and "paid and got paid" were literally
 * the same observable state.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

/** A player whose inventory has exactly the given stacks and no free slot. */
function playerWithFullInventory(stacks) {
  const player = __test__.makePlayer("tester", { x: 0, y: 70, z: 0 });
  const container = player.getComponent("minecraft:inventory").container;
  for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined);

  let slot = 0;
  for (const stack of stacks) container.setItem(slot++, stack);
  // Pack every remaining slot with a full stack of something irrelevant that
  // no reward in this suite is made of, so there is genuinely nowhere to put
  // a reward and nothing for it to merge into.
  while (slot < container.size) container.setItem(slot++, new ItemStack("minecraft:cobbled_deepslate", 64));
  return { player, container };
}

function countOf(container, typeId) {
  let total = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === typeId) total += stack.amount;
  }
  return total;
}

function fakeElder() {
  const props = new Map();
  return {
    setDynamicProperty(key, value) { props.set(key, value); },
    getDynamicProperty(key) { return props.get(key); },
    _props: props
  };
}

// ---------- 1. the daily contract ----------
console.log("\n=== contracts.js: daily contract on a full inventory ===");
{
  // "paper" needs 24 paper and pays 2 emeralds. A stack of 64 paper leaves the
  // slot occupied after the 24 come out, so there is still nowhere for the
  // emeralds to go - the exact shape that loses a reward.
  const contract = CONTRACTS.find((entry) => entry.id === "paper");
  const elder = fakeElder();
  elder.setDynamicProperty("village:level", 4);
  const { player, container } = playerWithFullInventory([new ItemStack(contract.itemId, 64)]);

  // Day 4 with the level-4 pool selects the paper contract; assert rather than
  // assume, so a future pool change fails loudly here instead of silently
  // testing a different contract.
  const day = CONTRACTS.filter((e) => e.minLevel <= 4).findIndex((e) => e.id === "paper");
  const before = countOf(container, contract.itemId);
  const result = turnInContract(player, elder, day);
  const after = countOf(container, contract.itemId);
  const paid = countOf(container, contract.rewardItem);

  if (result.ok) {
    assert(paid >= contract.rewardAmount,
      `a contract reported ok must actually deliver its reward (got ${paid} x ${contract.rewardItem})`);
  } else {
    assert(after === before,
      `a contract that cannot pay must not take the goods either (had ${before}, left ${after})`);
    assert(result.reason === "inventory_full",
      `a contract refused for lack of room says so (reason: ${result.reason})`);
  }
  assert(!(result.ok && paid === 0), "contract never reports success while paying nothing");
}

// ---------- 2. the alchemist's shop ----------
console.log("\n=== specials.js: buying from the alchemist on a full inventory ===");
{
  const product = ALCHEMIST_PRODUCTS.find((entry) => entry.id === "minecraft:glowstone_dust");
  const { player, container } = playerWithFullInventory([new ItemStack("minecraft:emerald", 64)]);

  const emeraldsBefore = countOf(container, "minecraft:emerald");
  const result = giveProduct(player, product);
  const emeraldsAfter = countOf(container, "minecraft:emerald");
  const received = countOf(container, product.id);

  if (result.ok) {
    assert(received >= product.amount,
      `a purchase reported ok must actually hand the goods over (got ${received} x ${product.id})`);
  } else {
    assert(emeraldsAfter === emeraldsBefore,
      `a refused purchase must not charge (had ${emeraldsBefore} emeralds, left ${emeraldsAfter})`);
  }
  assert(!(result.ok && received === 0), "alchemist never charges emeralds and hands over nothing");
}

// ---------- 3. the old-timer's quest chain ----------
console.log("\n=== special_content.js: specialist turn-in on a full inventory ===");
{
  const questKey = Object.keys(SPECIAL_QUESTS)[0];
  const step = SPECIAL_QUESTS[questKey].chain[0];
  const oldtimer = fakeElder();
  const { player, container } = playerWithFullInventory([new ItemStack(step.item, 64)]);

  const before = countOf(container, step.item);
  const result = turnInSpecialQuest(player, oldtimer, questKey);
  const after = countOf(container, step.item);
  const paid = countOf(container, step.reward);

  if (result.ok) {
    assert(paid >= step.rewardAmount,
      `a specialist step reported ok must deliver its reward (got ${paid} x ${step.reward})`);
  } else {
    assert(after === before,
      `a specialist step that cannot pay must not take the goods (had ${before}, left ${after})`);
  }
  assert(!(result.ok && paid === 0), "specialist quest never reports success while paying nothing");
}

// ---------- 4. the legacy craftsman path ----------
console.log("\n=== quests.js: legacy craftsman turn-in on a full inventory ===");
{
  // The farmer's fifth step is the only legacy step that pays an item.
  const profession = "Фермер";
  const chain = QUESTS[profession].chain;
  const finalStep = chain.length - 1;
  const step = chain[finalStep];
  const npc = fakeElder();
  npc.setDynamicProperty("quest_step", finalStep);
  const { player, container } = playerWithFullInventory([new ItemStack(step.requiredItem, 64)]);

  const before = countOf(container, step.requiredItem);
  const result = turnInQuest(player, profession, fakeElder(), npc);
  const after = countOf(container, step.requiredItem);
  const paid = countOf(container, step.rewardItem);

  if (result.ok) {
    assert(paid >= step.rewardAmount,
      `a legacy step reported ok must deliver its reward (got ${paid} x ${step.rewardItem})`);
  } else {
    assert(after === before,
      `a legacy step that cannot pay must not take the goods (had ${before}, left ${after})`);
  }
  assert(!(result.ok && paid === 0), "legacy quest never reports success while paying nothing");
}

// ---------- 5. the happy path still works ----------
// Without this, "always refuse" would pass every assertion above.
console.log("\n=== rewards are still delivered when there is room ===");
{
  const contract = CONTRACTS.find((entry) => entry.id === "paper");
  const elder = fakeElder();
  elder.setDynamicProperty("village:level", 4);
  const player = __test__.makePlayer("roomy", { x: 0, y: 70, z: 0 });
  const container = player.getComponent("minecraft:inventory").container;
  for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined);
  container.setItem(0, new ItemStack(contract.itemId, 64));

  const day = CONTRACTS.filter((e) => e.minLevel <= 4).findIndex((e) => e.id === "paper");
  const result = turnInContract(player, elder, day);
  assert(result.ok, `a contract with room to pay succeeds (reason: ${result.reason})`);
  assert(countOf(container, contract.rewardItem) === contract.rewardAmount,
    `and the reward really lands (${countOf(container, contract.rewardItem)} x ${contract.rewardItem})`);
  assert(countOf(container, contract.itemId) === 64 - contract.amount,
    "and exactly the required amount was taken");
}

console.log(failures === 0 ? "\nALL REWARD DELIVERY CHECKS PASSED" : `\n${failures} REWARD DELIVERY CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
