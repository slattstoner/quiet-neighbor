import { ItemStack } from "@minecraft/server";
import { countItems, inventoryContainer, placeReward, removeExact, restoreContainer, snapshotContainer } from "./inventory.js";
import { LEVELS } from "./levels.js";
import { PROP_LEVEL, readLevel, readProperty } from "./village_state.js";

/**
 * Repeatable village contracts.
 *
 * Every other quest in the mod is once per village: the four craftsman chains,
 * the watchman's arc, the specialists' errands. Finish them and the village
 * has nothing left to ask for, which is most of what made it feel thin once
 * the building stopped. A contract is the opposite - one standing errand, a
 * different one each day, always available and never finished.
 *
 * Rewards stay inside the mod's standing rule that the village must never
 * out-earn the player's own mining and farming (production.js's caps exist for
 * the same reason). The real payoff is not the items: completing contracts
 * earns standing, and standing is spent as a discount on the next level's
 * requirements through the same `village:discount:<level>:<item>` keys the
 * craftsman chains already write. So the reward for helping the village is
 * that the village needs less from you - which is the thing the player is
 * actually working on.
 */

const PROP_DAY = "village:contract:day";
const PROP_DONE = "village:contract:done";
const PROP_STANDING = "village:contract:standing";

/** Standing earned per contract, and what a point of it is worth as a discount. */
export const STANDING_PER_CONTRACT = 1;
export const DISCOUNT_PER_STANDING = 2;
/** Never discount a requirement into nothing - the level still has to be earned. */
export const MAX_DISCOUNT_FRACTION = 0.25;

/**
 * The pool. `minLevel` keeps a contract from being asked for before the
 * village plausibly needs it, and gives the list somewhere to grow as the
 * village does.
 */
export const CONTRACTS = Object.freeze([
  Object.freeze({ id: "grain", minLevel: 2, title: "Хлебный подряд", ask: "Амбар пустеет быстрее, чем полнится. Принеси 32 пшеницы.", itemId: "minecraft:wheat", amount: 32, rewardItem: "minecraft:bread", rewardAmount: 6 }),
  Object.freeze({ id: "timber", minLevel: 2, title: "Лесной подряд", ask: "Плотникам нечем чинить крыши. Принеси 32 бревна.", itemId: "minecraft:oak_log", amount: 32, rewardItem: "minecraft:lantern", rewardAmount: 2 }),
  Object.freeze({ id: "stone", minLevel: 3, title: "Каменный подряд", ask: "Мостовая расползлась после дождей. Принеси 64 булыжника.", itemId: "minecraft:cobblestone", amount: 64, rewardItem: "minecraft:iron_ingot", rewardAmount: 2 }),
  Object.freeze({ id: "coal", minLevel: 3, title: "Угольный подряд", ask: "Горн стынет к утру. Принеси 24 угля.", itemId: "minecraft:coal", amount: 24, rewardItem: "minecraft:torch", rewardAmount: 16 }),
  Object.freeze({ id: "paper", minLevel: 4, title: "Бумажный подряд", ask: "Картографу не на чем чертить. Принеси 24 листа бумаги.", itemId: "minecraft:paper", amount: 24, rewardItem: "minecraft:emerald", rewardAmount: 2 }),
  Object.freeze({ id: "wool", minLevel: 6, title: "Шерстяной подряд", ask: "Ткацкой нужна шерсть, а зима не ждёт. Принеси 24 белой шерсти.", itemId: "minecraft:white_wool", amount: 24, rewardItem: "minecraft:emerald", rewardAmount: 2 }),
  Object.freeze({ id: "iron", minLevel: 8, title: "Железный подряд", ask: "Страже нужны петли, скобы и наконечники. Принеси 12 железных слитков.", itemId: "minecraft:iron_ingot", amount: 12, rewardItem: "minecraft:emerald", rewardAmount: 3 }),
  Object.freeze({ id: "glass", minLevel: 9, title: "Стекольный подряд", ask: "В новых домах до сих пор ставни вместо окон. Принеси 24 стеклянные панели.", itemId: "minecraft:glass_pane", amount: 24, rewardItem: "minecraft:emerald", rewardAmount: 2 }),
  Object.freeze({ id: "bricks", minLevel: 10, title: "Кирпичный подряд", ask: "Стену надо латать быстрее, чем она сыплется. Принеси 64 каменных кирпича.", itemId: "minecraft:stone_bricks", amount: 64, rewardItem: "minecraft:iron_ingot", rewardAmount: 4 })
]);

export function contractsAvailableAt(level) {
  if (!Number.isInteger(level)) return [];
  return CONTRACTS.filter((entry) => level >= entry.minLevel);
}

/**
 * Which contract is standing today.
 *
 * Picked from the world day rather than at random, so the same village asks
 * every player the same thing on the same day, and asks something different
 * tomorrow without needing to store a rotation.
 */
export function contractForDay(level, day) {
  const pool = contractsAvailableAt(level);
  if (pool.length === 0) return null;
  const index = Math.abs(Math.floor(day)) % pool.length;
  return pool[index];
}

export function standingOf(elder) {
  const value = readProperty(elder, PROP_STANDING);
  return Number.isInteger(value) ? value : 0;
}

export function contractsCompleted(elder) {
  const value = readProperty(elder, PROP_DONE);
  return Number.isInteger(value) ? value : 0;
}

/** True once today's contract has already been handed in. */
export function contractDoneToday(elder, day) {
  return readProperty(elder, PROP_DAY) === Math.floor(day);
}

/**
 * What the village's standing takes off the next level's requirements.
 *
 * Capped at a quarter, per item: standing should shorten the grind, not delete
 * it. A level nobody had to work for is not a level.
 */
export function standingDiscountFor(elder, level) {
  const cfg = LEVELS[level];
  if (!cfg) return {};
  const points = standingOf(elder);
  const discounts = {};
  for (const [itemId, count] of Object.entries(cfg.requirements)) {
    const cap = Math.floor(count * MAX_DISCOUNT_FRACTION);
    const value = Math.min(points * DISCOUNT_PER_STANDING, cap);
    if (value > 0) discounts[itemId] = value;
  }
  return discounts;
}

/** What the elder's contract screen should say right now. */
export function contractView(elder, day) {
  const level = readLevel(elder) || 1;
  const contract = contractForDay(level, day);
  if (!contract) {
    return { available: false, reason: "too_early", level, standing: standingOf(elder), completed: contractsCompleted(elder) };
  }
  return {
    available: !contractDoneToday(elder, day),
    reason: contractDoneToday(elder, day) ? "done_today" : null,
    contract,
    level,
    standing: standingOf(elder),
    completed: contractsCompleted(elder)
  };
}

/**
 * Hands in today's contract.
 *
 * The inventory is snapshotted and restored if anything downstream fails, the
 * same all-or-nothing shape craftsman_quests.js uses: a turn-in that took the
 * goods and then failed to pay would be the worst possible bug in a system the
 * player is meant to repeat every day.
 */
export function turnInContract(player, elder, day, expectedContractId) {
  const view = contractView(elder, day);
  if (!view.contract) return { ok: false, reason: "too_early" };
  // The contract screen is a form, and a form can sit open across a sunrise.
  // Without this the player would confirm "bring 32 wheat" and the commit,
  // re-deriving the contract from the day it actually runs on, would take 64
  // cobblestone instead - or report "not enough" for an item they were never
  // asked for. Every other turn-in in the mod already guards its displayed
  // step this way (craftsman_quests' expectedStepId, sentinel_quests' too).
  if (expectedContractId && view.contract.id !== expectedContractId) {
    return { ok: false, reason: "stale_contract", contract: view.contract };
  }
  if (!view.available) return { ok: false, reason: "done_today", contract: view.contract };

  const container = inventoryContainer(player);
  if (!container) return { ok: false, reason: "no_inventory" };

  const contract = view.contract;
  const have = countItems(container, contract.itemId);
  if (have < contract.amount) {
    return { ok: false, reason: "not_enough", have, need: contract.amount, contract };
  }

  const reward = contract.rewardItem && contract.rewardAmount > 0
    ? { itemId: contract.rewardItem, amount: contract.rewardAmount }
    : null;

  const snapshot = snapshotContainer(container);
  try {
    if (!removeExact(container, contract.itemId, contract.amount)) throw new Error("inventory_changed");
    // Placed rather than addItem()ed: addItem returns the overflow it could
    // not fit instead of throwing, so ignoring it destroyed the reward on a
    // full inventory while still taking the goods. The room is checked after
    // the requirement comes out, since removing it usually frees the slot.
    if (reward && !placeReward(container, reward, (spec) => new ItemStack(spec.itemId, spec.amount))) {
      throw new Error("inventory_full");
    }
    elder.setDynamicProperty(PROP_DAY, Math.floor(day));
    elder.setDynamicProperty(PROP_DONE, contractsCompleted(elder) + 1);
    elder.setDynamicProperty(PROP_STANDING, standingOf(elder) + STANDING_PER_CONTRACT);
  } catch (error) {
    restoreContainer(container, snapshot);
    const reason = error?.message === "inventory_full" ? "inventory_full"
      : error?.message === "inventory_changed" ? "not_enough"
        : "turn_in_failed";
    if (reason === "turn_in_failed") console.warn("[village] contract turn-in failed: " + error);
    return { ok: false, reason, contract };
  }

  return {
    ok: true,
    contract,
    standing: standingOf(elder),
    completed: contractsCompleted(elder),
    nextLevelDiscount: standingDiscountFor(elder, (readProperty(elder, PROP_LEVEL) || 1) + 1)
  };
}
