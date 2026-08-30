import { __test__, ItemStack, EnchantmentTypes } from "@minecraft/server";
import { readFileSync, readdirSync } from "node:fs";

const SCRIPTS = `${import.meta.dirname}/scripts`;
import { QUESTS } from "./scripts/quests.js";
import { tryCompleteCraftsmanTurnIn } from "./scripts/craftsman_quests.js";
import { snapshotContainer, restoreContainer, removeExact } from "./scripts/inventory.js";

/**
 * Regression suite for the turn-in rollback path.
 *
 * craftsman_quests.js, extension_runtime_16_18.js and final_runtime_19_20.js
 * each carried their own copy of snapshotContainer/restoreContainer that
 * stored only { typeId, amount } and restored with new ItemStack(typeId,
 * amount). sentinel_quests.js had already been fixed to clone(), and the fix
 * was never carried back to the other three.
 *
 * The consequence was not subtle: restoreContainer rewrites EVERY slot, so
 * any failed turn-in rebuilt the player's whole inventory as fresh vanilla
 * stacks - enchantments, custom names and lore silently gone from gear that
 * had nothing to do with the quest. Every assertion below fails against that
 * old implementation and passes against the shared one in inventory.js.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

function enchantedPickaxe() {
  const stack = new ItemStack("minecraft:iron_pickaxe", 1);
  stack.nameTag = "§bСтарая кирка деда§r";
  stack.setLore(["Досталась от прежнего старосты"]);
  stack.getComponent("minecraft:enchantable").addEnchantment({
    type: EnchantmentTypes.get("minecraft:efficiency"),
    level: 3
  });
  return stack;
}

function describeStack(stack) {
  const ench = stack?.getComponent?.("minecraft:enchantable")?.getEnchantments?.() || [];
  return {
    typeId: stack?.typeId,
    amount: stack?.amount,
    nameTag: stack?.nameTag,
    lore: stack?.getLore?.() || [],
    enchantments: ench.map((entry) => `${entry.type.id}:${entry.level}`)
  };
}

// ---------- 1. snapshot/restore preserves everything, not just typeId+amount ----------
console.log("\n=== snapshot round-trip preserves item data ===");
{
  const player = __test__.makePlayer("rollback-unit", { x: 0, y: 70, z: 0 });
  const container = player.getComponent("minecraft:inventory").container;
  container.setItem(0, enchantedPickaxe());

  const before = describeStack(container.getItem(0));
  const snapshot = snapshotContainer(container);
  container.setItem(0, new ItemStack("minecraft:dirt", 5));      // clobber it
  restoreContainer(container, snapshot);
  const after = describeStack(container.getItem(0));

  assert(after.typeId === before.typeId && after.amount === before.amount,
    "restore brings back the same item type and amount");
  assert(after.nameTag === before.nameTag,
    `restore preserves the custom name (${JSON.stringify(after.nameTag)})`);
  assert(JSON.stringify(after.lore) === JSON.stringify(before.lore),
    `restore preserves lore (${JSON.stringify(after.lore)})`);
  assert(JSON.stringify(after.enchantments) === JSON.stringify(before.enchantments),
    `restore preserves enchantments (${JSON.stringify(after.enchantments)})`);
}

// ---------- 2. the snapshot must not alias live stacks ----------
// removeExact mutates stack.amount in place before writing it back, so a
// snapshot holding the stack itself would be corrupted by the very partial
// removal it exists to undo.
console.log("\n=== snapshot does not alias the live stack ===");
{
  const player = __test__.makePlayer("rollback-alias", { x: 0, y: 70, z: 0 });
  const container = player.getComponent("minecraft:inventory").container;
  container.setItem(0, new ItemStack("minecraft:wheat", 20));

  const snapshot = snapshotContainer(container);
  removeExact(container, "minecraft:wheat", 8);          // partial take, mutates in place
  assert(container.getItem(0).amount === 12, "removeExact took the requested amount");
  assert(snapshot[0].amount === 20,
    `snapshot still holds the pre-removal amount (got ${snapshot[0].amount}, expected 20)`);

  restoreContainer(container, snapshot);
  assert(container.getItem(0).amount === 20, "rollback restores the full pre-transaction amount");
}

// ---------- 3. end-to-end: a failed craftsman turn-in leaves gear untouched ----------
console.log("\n=== failed turn-in rolls back without destroying gear ===");
{
  const dim = __test__.makeDimension();
  const elder = dim.spawnEntity("minecraft:villager_v2", { x: 0, y: 70, z: 0 });
  elder.addTag("village:rollback"); elder.addTag("village_elder");
  elder.setDynamicProperty("village:level", 10);
  const npc = dim.spawnEntity("minecraft:villager_v2", { x: 2, y: 70, z: 0 });
  npc.addTag("village:rollback"); npc.addTag("village_crafter");
  npc.setDynamicProperty("village:roleId", "farmer");
  // The final step is the one that also hands out a reward, so the commit
  // makes two container writes: the payment, then the reward. That second
  // write is where this test injects the failure.
  const finalStepIndex = QUESTS["Фермер"].chain.length - 1;
  npc.setDynamicProperty("quest_step", finalStepIndex);
  const player = __test__.makePlayer("rollback-e2e", { x: 1, y: 70, z: 0 });
  player.dimension = dim;
  const container = player.getComponent("minecraft:inventory").container;

  const step = QUESTS["Фермер"].chain[finalStepIndex];
  // Deliberately more than required, so the payment slot is decremented
  // rather than emptied and the reward has to land in a different slot.
  container.setItem(0, new ItemStack(step.requiredItem, step.requiredAmount + 4));
  container.setItem(9, enchantedPickaxe());                 // unrelated gear
  const gearBefore = describeStack(container.getItem(9));

  // Force the transaction to blow up *after* the payment has been taken, so
  // the rollback path is the one under test. The throw fires exactly once;
  // the rollback's own writes must go through normally.
  const realSetItem = container.setItem;
  let writes = 0;
  container.setItem = function (slot, stack) {
    if (++writes === 2) throw new Error("simulated engine failure mid-transaction");
    return realSetItem.call(this, slot, stack);
  };
  let result;
  try {
    result = tryCompleteCraftsmanTurnIn(npc, elder, player);
  } finally {
    container.setItem = realSetItem;
  }

  assert(writes >= 2, `the injected failure actually fired (${writes} container writes)`);
  assert(result && result.ok === false,
    `a mid-transaction failure reports a failed turn-in (got ${JSON.stringify(result?.reason ?? result?.ok)})`);
  assert(Number(npc.getDynamicProperty("quest_step")) === finalStepIndex,
    "the quest step is rolled back to where it started");
  assert(container.getItem(0)?.amount === step.requiredAmount + 4,
    `the payment is refunded in full (got ${container.getItem(0)?.amount}, expected ${step.requiredAmount + 4})`);

  const gearAfter = describeStack(container.getItem(9));
  assert(gearAfter.typeId === gearBefore.typeId, "unrelated gear is still in its slot after rollback");
  assert(gearAfter.nameTag === gearBefore.nameTag,
    `rollback did not strip the gear's custom name (got ${JSON.stringify(gearAfter.nameTag)})`);
  assert(JSON.stringify(gearAfter.lore) === JSON.stringify(gearBefore.lore),
    `rollback did not strip the gear's lore (got ${JSON.stringify(gearAfter.lore)})`);
  assert(JSON.stringify(gearAfter.enchantments) === JSON.stringify(gearBefore.enchantments),
    `rollback did not strip the gear's enchantments (got ${JSON.stringify(gearAfter.enchantments)})`);
}

// ---------- 4. no module may grow its own copy again ----------
// The bug existed because four modules each owned a private copy and only one
// of them got fixed. Sharing the helpers is the actual fix; this guards it.
console.log("\n=== transaction helpers stay shared ===");
{
  const SHARED = ["snapshotContainer", "restoreContainer", "removeExact", "countItems", "inventoryContainer"];
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".js") && f !== "inventory.js");
  let offenders = 0;
  for (const file of files) {
    const text = readFileSync(`${SCRIPTS}/${file}`, "utf8");
    for (const name of SHARED) {
      if (new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\s*\\(`, "m").test(text)) {
        offenders++;
        console.error(`  ${file}: defines its own ${name}() - import it from inventory.js instead`);
      }
    }
  }
  assert(offenders === 0, `transaction helpers are defined only in inventory.js (${offenders} local copies found)`);

  const inv = readFileSync(`${SCRIPTS}/inventory.js`, "utf8");
  assert(/stack\.clone\(\)/.test(inv),
    "inventory.js snapshots by cloning, not by rebuilding from typeId+amount");
}

console.log(failures === 0 ? "\nALL ROLLBACK TESTS PASSED" : `\n${failures} ROLLBACK TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
