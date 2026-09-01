/**
 * Shared container helpers for every quest turn-in transaction.
 *
 * These five functions used to be copy-pasted into craftsman_quests.js,
 * sentinel_quests.js, extension_runtime_16_18.js and final_runtime_19_20.js.
 * That is how the rollback bug below survived: sentinel_quests.js was fixed
 * in place and the other three copies never heard about it. They are shared
 * from here now so a fix to the transaction path can only be made once.
 *
 * This module deliberately imports nothing - not even @minecraft/server - so
 * any module can use it without creating an import cycle.
 */

/** The player's inventory container, or null if it can't be read. */
export function inventoryContainer(player) {
  try {
    return player?.getComponent?.("minecraft:inventory")?.container || null;
  } catch (error) {
    return null;
  }
}

/** Total count of `typeId` across every slot. */
export function countItems(container, typeId) {
  let total = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === typeId) total += stack.amount;
  }
  return total;
}

/**
 * Snapshots a container for rollback, cloning every stack.
 *
 * The clone matters twice over:
 *
 * 1. It preserves everything that is NOT typeId+amount - enchantments,
 *    durability, custom name, lore, item dynamic properties. Three of the
 *    four old copies snapshotted `{ typeId, amount }` and restored with
 *    `new ItemStack(typeId, amount)`, so any failed turn-in rebuilt the
 *    player's ENTIRE inventory as fresh vanilla stacks: an enchanted,
 *    named, half-worn pickaxe came back plain, undamaged and unnamed.
 *    Rollback is supposed to be invisible, and that one silently destroyed
 *    the player's gear on every transaction_failed path.
 *
 * 2. It breaks aliasing. removeExact() mutates `stack.amount` in place
 *    before writing the stack back, so a snapshot holding live references
 *    would be corrupted by the very partial removal it exists to undo.
 *    Never "optimise" this into storing the stack itself.
 */
export function snapshotContainer(container) {
  return Array.from({ length: container.size }, (_, slot) => {
    const stack = container.getItem(slot);
    if (!stack) return undefined;
    // Real ItemStack always has clone(); the guard is only so a rollback
    // can never itself throw and mask the original failure.
    return typeof stack.clone === "function" ? stack.clone() : { typeId: stack.typeId, amount: stack.amount };
  });
}

/** Restores a snapshot taken by snapshotContainer, stack for stack. */
export function restoreContainer(container, snapshot) {
  for (let slot = 0; slot < container.size; slot++) {
    container.setItem(slot, snapshot[slot]);
  }
}

/**
 * Removes exactly `amount` of `typeId`, or reports failure without having
 * removed a usable amount. Callers treat `false` as a failed transaction and
 * roll the container back from a snapshot.
 */
export function removeExact(container, typeId, amount) {
  let remaining = amount;
  for (let slot = 0; slot < container.size && remaining > 0; slot++) {
    const stack = container.getItem(slot);
    if (!stack || stack.typeId !== typeId) continue;
    const taken = Math.min(remaining, stack.amount);
    remaining -= taken;
    if (taken === stack.amount) container.setItem(slot, undefined);
    else {
      stack.amount -= taken;
      container.setItem(slot, stack);
    }
  }
  return remaining === 0;
}

/**
 * The slot a reward would land in, or -1 when there is nowhere to put it.
 *
 * Prefers topping up a partial stack of the same item, then the first empty
 * slot - the same order the engine's own Container.addItem uses.
 *
 * `claimed` lets a caller reserve several rewards in one pass without two of
 * them planning to use the same empty slot.
 */
export function rewardSlot(container, reward, claimed) {
  if (!reward?.itemId || !Number.isInteger(reward.amount) || reward.amount < 1) return -1;
  if (reward.stackable !== false) {
    for (let slot = 0; slot < container.size; slot++) {
      if (claimed?.has(slot)) continue;
      const stack = container.getItem(slot);
      if (stack?.typeId === reward.itemId && stack.amount + reward.amount <= 64) return slot;
    }
  }
  for (let slot = 0; slot < container.size; slot++) {
    if (claimed?.has(slot) || container.getItem(slot)) continue;
    return slot;
  }
  return -1;
}

/** True when every reward in the list has somewhere to go, all at once. */
export function canPlaceRewards(container, rewards) {
  const claimed = new Set();
  for (const reward of rewards) {
    const slot = rewardSlot(container, reward, claimed);
    if (slot < 0) return false;
    claimed.add(slot);
  }
  return true;
}

/**
 * Writes a reward into the container, returning false if it did not fit.
 *
 * Deliberately NOT Container.addItem: addItem does not throw when the
 * container is full, it returns the ItemStack it could not place. A caller
 * that ignores that return value silently destroys the reward - which is
 * exactly what the daily contract, the alchemist's shop, the old-timer's
 * chains and the legacy craftsman path all used to do, taking the player's
 * goods and paying nothing. Placing into a slot we reserved first makes
 * "there was no room" a value the caller has to handle instead of an
 * invisible loss.
 *
 * `makeStack` is for rewards that are more than a type and a count (an
 * enchanted bow, a named map); it is called only when a fresh stack is needed.
 */
export function placeReward(container, reward, makeStack) {
  const slot = rewardSlot(container, reward);
  if (slot < 0) return false;
  const existing = container.getItem(slot);
  if (existing) {
    existing.amount += reward.amount;
    container.setItem(slot, existing);
    return true;
  }
  const stack = makeStack ? makeStack(reward) : null;
  if (!stack) return false;
  container.setItem(slot, stack);
  return true;
}
