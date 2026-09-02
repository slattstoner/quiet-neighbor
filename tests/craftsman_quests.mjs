import { __test__, ItemStack } from "@minecraft/server";
import { QUESTS } from "./scripts/quests.js";
import { CRAFTSMAN_ARCS, validateQuestContract } from "./scripts/quest_contract_v2.js";
import { getCraftsmanQuestView, resolveCraftsmanRole, tryCompleteCraftsmanTurnIn, validateCraftsmanTurnIn } from "./scripts/craftsman_quests.js";
import { DAILY_CAP, STORAGE_CAP, MINER_TABLE, ROLE_FARMER, ROLE_MINER } from "./scripts/production.js";

let failures = 0;
function assert(condition, message) { if (!condition) { failures++; console.error("FAIL:", message); } else console.log("ok:", message); }
function count(container, itemId) { let total = 0; for (let slot = 0; slot < container.size; slot++) { const stack = container.getItem(slot); if (stack?.typeId === itemId) total += stack.amount; } return total; }
function clear(container) { for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined); }
function makeVillage(roleId, level, step = 0) {
  const dim = __test__.makeDimension();
  const elder = dim.spawnEntity("minecraft:villager_v2", { x: 0, y: 70, z: 0 });
  elder.addTag("village:stage51"); elder.addTag("village_elder"); elder.setDynamicProperty("village:level", level);
  const npc = dim.spawnEntity("minecraft:villager_v2", { x: 2, y: 70, z: 0 });
  npc.addTag("village:stage51"); npc.addTag("village_crafter"); npc.setDynamicProperty("village:roleId", roleId); npc.setDynamicProperty("quest_step", step);
  const player = __test__.makePlayer(`stage51-${roleId}`, { x: 1, y: 70, z: 0 }); player.dimension = dim;
  return { elder, npc, player, container: player.getComponent("minecraft:inventory").container };
}

const expectedRoles = new Map([["farmer", 2], ["blacksmith", 3], ["cartographer", 4], ["miner", 6]]);
const forbidden = new Set([
  "minecraft:diamond", "minecraft:netherite_ingot", "minecraft:netherite_scrap", "minecraft:emerald",
  "minecraft:enchanted_golden_apple", "minecraft:diamond_sword", "minecraft:diamond_pickaxe", "minecraft:diamond_axe",
  "minecraft:diamond_horse_armor", "minecraft:enchanted_book", "minecraft:potion"
]);
const finalRewardByRole = new Map([
  ["farmer", "minecraft:lantern"], ["blacksmith", "minecraft:shield"],
  ["cartographer", "minecraft:book_and_quill"], ["miner", "minecraft:torch"]
]);

console.log("\n=== contract coverage, gates and balance audit ===");
assert(validateQuestContract().ok, "extended quest contract validates");
assert(CRAFTSMAN_ARCS.length === 4, "contract has exactly four craftsman arcs");
for (const arc of CRAFTSMAN_ARCS) {
  const quest = QUESTS[arc.legacyRole];
  assert(expectedRoles.get(arc.roleId) === arc.minLevel && arc.steps.length === 5 && quest.chain.length === 5,
    `${arc.roleId} has its approved gate and exactly five stable active steps`);
  assert(new Set(arc.steps.map((step) => step.id)).size === 5, `${arc.roleId} step IDs are unique`);
  let rewardCount = 0;
  for (let index = 0; index < quest.chain.length; index++) {
    const step = quest.chain[index];
    assert(step.requiredItem?.startsWith("minecraft:") && Number.isInteger(step.requiredAmount) && step.requiredAmount >= 1 && step.requiredAmount <= 32,
      `${arc.roleId} step ${index + 1} has a bounded vanilla inventory requirement`);
    assert(!forbidden.has(step.requiredItem), `${arc.roleId} step ${index + 1} avoids forbidden high-tier payment`);
    if (step.rewardItem) {
      rewardCount++;
      assert(index === 4 && step.rewardItem === finalRewardByRole.get(arc.roleId) && step.rewardAmount > 0,
        `${arc.roleId} has only its approved moderate final vanilla reward`);
      assert(!forbidden.has(step.rewardItem), `${arc.roleId} final reward avoids forbidden high-tier items`);
    } else {
      assert(step.rewardAmount === 0, `${arc.roleId} step ${index + 1} has no hidden mid-arc resource reward`);
    }
  }
  assert(rewardCount === 1, `${arc.roleId} has exactly one final reward and no mid-arc faucet`);
  const locked = makeVillage(arc.roleId, arc.minLevel - 1);
  const view = getCraftsmanQuestView(locked.npc, locked.elder, locked.player);
  assert(view.ok && view.status === "locked" && !tryCompleteCraftsmanTurnIn(locked.npc, locked.elder, locked.player).ok,
    `${arc.roleId} cannot turn in before its approved unlock`);
}

console.log("\n=== exact one-time balanced progression ===");
for (const arc of CRAFTSMAN_ARCS) {
  const { elder, npc, player, container } = makeVillage(arc.roleId, arc.minLevel);
  const quest = QUESTS[arc.legacyRole];
  for (let step = 0; step < 5; step++) {
    clear(container);
    const current = quest.chain[step];
    container.setItem(0, new ItemStack(current.requiredItem, current.requiredAmount));
    const view = getCraftsmanQuestView(npc, elder, player);
    assert(view.ok && view.status === "active" && view.step === step && view.stepId === arc.steps[step].id,
      `${arc.roleId} exposes balanced stable step ${step + 1}`);
    assert((current.rewardItem ? view.reward?.itemId : view.reward) === (current.rewardItem || null),
      `${arc.roleId} view reports the configured reward policy for step ${step + 1}`);
    const result = tryCompleteCraftsmanTurnIn(npc, elder, player, view.stepId);
    assert(result.ok && result.nextStep === step + 1 && count(container, current.requiredItem) === 0,
      `${arc.roleId} completes balanced step ${step + 1} exactly once`);
    if (current.rewardItem) assert(count(container, current.rewardItem) === current.rewardAmount, `${arc.roleId} grants its one final utility reward`);
    const duplicate = tryCompleteCraftsmanTurnIn(npc, elder, player, view.stepId);
    assert(!duplicate.ok && duplicate.reason === (step === 4 ? "no_active_quest" : "stale_state"),
      `${arc.roleId} rejects duplicate submission at step ${step + 1}`);
  }
  const discountKey = `village:discount:${quest.discountLevel}:${quest.discountItem}`;
  assert(npc.getDynamicProperty("quest_step") === 5 && elder.getDynamicProperty(discountKey) === quest.discountAmount,
    `${arc.roleId} applies its existing final discount once`);
  const completeResult = tryCompleteCraftsmanTurnIn(npc, elder, player);
  assert(!completeResult.ok && elder.getDynamicProperty(discountKey) === quest.discountAmount,
    `${arc.roleId} completed legacy state does not regrant new reward or discount`);
}

console.log("\n=== legacy partial, inventory and invalid-state safety ===");
const partial = makeVillage("farmer", 2, 2);
const partialStep = QUESTS["Фермер"].chain[2];
partial.container.setItem(0, new ItemStack(partialStep.requiredItem, partialStep.requiredAmount));
const partialView = getCraftsmanQuestView(partial.npc, partial.elder, partial.player);
assert(partialView.ok && partialView.step === 2 && partialView.stepId === "arc.farmer.step_03", "legacy partial NPC retains the same stable step index");
assert(tryCompleteCraftsmanTurnIn(partial.npc, partial.elder, partial.player, partialView.stepId).ok && partial.npc.getDynamicProperty("quest_step") === 3,
  "legacy partial NPC completes the new balanced data at the same index once");

const full = makeVillage("farmer", 2, 4);
const finalFarmer = QUESTS["Фермер"].chain[4];
for (let slot = 0; slot < full.container.size; slot++) full.container.setItem(slot, new ItemStack("minecraft:cobblestone", 64));
full.container.setItem(0, new ItemStack(finalFarmer.requiredItem, finalFarmer.requiredAmount));
const fullBefore = count(full.container, finalFarmer.requiredItem);
assert(validateCraftsmanTurnIn(full.npc, full.elder, full.player).reason === "inventory_full", "full reward inventory is detected before final turn-in");
assert(!tryCompleteCraftsmanTurnIn(full.npc, full.elder, full.player).ok && count(full.container, finalFarmer.requiredItem) === fullBefore && full.npc.getDynamicProperty("quest_step") === 4,
  "full reward inventory leaves final items and legacy step unchanged");

const short = makeVillage("farmer", 2);
assert(tryCompleteCraftsmanTurnIn(short.npc, short.elder, short.player).reason === "not_enough" && short.npc.getDynamicProperty("quest_step") === 0,
  "missing inventory does not mutate legacy step");
const unknown = makeVillage("farmer", 2);
unknown.npc.setDynamicProperty("village:roleId", "not_a_role");
assert(resolveCraftsmanRole(unknown.npc) === null && !getCraftsmanQuestView(unknown.npc, unknown.elder, unknown.player).ok,
  "unknown stable role is a neutral diagnostic and does not guess a quest");

console.log("\n=== economy invariants ===");
assert(DAILY_CAP[ROLE_FARMER] === 12 && STORAGE_CAP[ROLE_FARMER] === 64, "farmer automatic caps remain 12/day and 64 storage");
assert(DAILY_CAP[ROLE_MINER] === 6 && STORAGE_CAP[ROLE_MINER] === 32, "miner automatic caps remain 6/day and 32 storage");
assert(!MINER_TABLE.some((entry) => entry.typeId === "minecraft:diamond" || entry.typeId === "minecraft:netherite_scrap"), "miner production pool remains free of diamonds and netherite");

console.log(failures === 0 ? "\nALL CRAFTSMAN QUEST TESTS PASSED" : `\n${failures} CRAFTSMAN QUEST TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
