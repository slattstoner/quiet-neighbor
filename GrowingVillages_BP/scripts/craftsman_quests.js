import { ItemStack } from "@minecraft/server";
import { QUESTS } from "./quests.js";
import { craftsmanArcForRole } from "./quest_contract_v2.js";
import { countItems, inventoryContainer, removeExact, restoreContainer, snapshotContainer } from "./inventory.js";
import { PROP_LEVEL, readProperty } from "./village_state.js";

const ROLE_ID_PROPERTY = "village:roleId";
const LEGACY_ROLE_BY_ID = Object.freeze({
  farmer: "Фермер",
  blacksmith: "Кузнец",
  cartographer: "Картограф",
  miner: "Шахтёр"
});

function neutral(reason, extra = {}) {
  return Object.freeze({ ok: false, status: "neutral", reason, ...extra });
}

function strippedName(nameTag) {
  return typeof nameTag === "string" ? nameTag.replace(/§./g, "") : "";
}

function villageTag(entity) {
  try {
    return entity?.getTags?.().find((tag) => tag.startsWith("village:")) || null;
  } catch (error) {
    return null;
  }
}

function sameVillage(npc, elder) {
  const npcVillage = villageTag(npc);
  const elderVillage = villageTag(elder);
  return !!npcVillage && npcVillage === elderVillage;
}

function rewardSlot(container, reward) {
  if (!reward?.itemId || !Number.isInteger(reward.amount) || reward.amount < 1) return -1;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === reward.itemId && stack.amount + reward.amount <= 64) return slot;
  }
  for (let slot = 0; slot < container.size; slot++) {
    if (!container.getItem(slot)) return slot;
  }
  return -1;
}

function placeReward(container, reward) {
  const slot = rewardSlot(container, reward);
  if (slot < 0) return false;
  const stack = container.getItem(slot);
  if (stack) {
    stack.amount += reward.amount;
    container.setItem(slot, stack);
  } else {
    container.setItem(slot, new ItemStack(reward.itemId, reward.amount));
  }
  return true;
}

function questStep(npc, arc, legacyQuest) {
  const step = readProperty(npc, "quest_step");
  const normalized = step === undefined ? 0 : step;
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > legacyQuest.chain.length) return null;
  if (normalized >= legacyQuest.chain.length) return { finished: true, step: normalized };
  return {
    finished: false,
    step: normalized,
    stepData: legacyQuest.chain[normalized],
    contractStep: arc.steps[normalized]
  };
}

export function craftsmanItemLocalizationKey(itemId) {
  const id = typeof itemId === "string" ? itemId.replace("minecraft:", "") : "unknown";
  return `growing_villages.item.${id}`;
}

export function resolveCraftsmanRole(npc) {
  const stableRole = readProperty(npc, ROLE_ID_PROPERTY);
  if (typeof stableRole === "string" && LEGACY_ROLE_BY_ID[stableRole]) return stableRole;
  const legacyName = strippedName(npc?.nameTag);
  return Object.entries(LEGACY_ROLE_BY_ID).find(([, name]) => name === legacyName)?.[0] || null;
}

/** Returns a read-only typed projection of the active legacy-compatible quest step. */
export function getCraftsmanQuestView(npc, elder, player) {
  const roleId = resolveCraftsmanRole(npc);
  if (!roleId) return neutral("unknown_role");
  const arc = craftsmanArcForRole(roleId);
  const legacyQuest = QUESTS[LEGACY_ROLE_BY_ID[roleId]];
  if (!arc || !legacyQuest) return neutral("missing_legacy_arc", { roleId });
  if (!sameVillage(npc, elder)) return neutral("different_village", { roleId });

  const level = readProperty(elder, PROP_LEVEL);
  if (!Number.isInteger(level)) return neutral("invalid_level", { roleId });
  if (level < arc.minLevel) {
    return Object.freeze({ ok: true, status: "locked", roleId, arc, level, minLevel: arc.minLevel });
  }

  const active = questStep(npc, arc, legacyQuest);
  if (!active) return neutral("invalid_legacy_step", { roleId, level });
  if (active.finished) {
    return Object.freeze({ ok: true, status: "complete", roleId, arc, level, step: active.step });
  }

  const requirement = Object.freeze({ itemId: active.stepData.requiredItem, amount: active.stepData.requiredAmount });
  const reward = active.stepData.rewardItem && active.stepData.rewardAmount > 0
    ? Object.freeze({ itemId: active.stepData.rewardItem, amount: active.stepData.rewardAmount }) : null;
  return Object.freeze({
    ok: true,
    status: "active",
    roleId,
    arc,
    level,
    step: active.step,
    stepId: active.contractStep.id,
    requirement,
    reward,
    upgrade: active.stepData.upgrade || null,
    isFinalStep: active.step === legacyQuest.chain.length - 1
  });
}

/** Revalidates all preconditions without writing state or changing inventory. */
export function validateCraftsmanTurnIn(npc, elder, player, expectedStepId) {
  const view = getCraftsmanQuestView(npc, elder, player);
  if (!view.ok) return view;
  if (view.status !== "active") return neutral(view.status === "locked" ? "locked" : "no_active_quest", { view });
  if (expectedStepId && view.stepId !== expectedStepId) return neutral("stale_state", { view });

  const container = inventoryContainer(player);
  if (!container) return neutral("no_inventory", { view });
  const have = countItems(container, view.requirement.itemId);
  if (have < view.requirement.amount) {
    return neutral("not_enough", { view, have, need: view.requirement.amount });
  }
  if (view.reward && rewardSlot(container, view.reward) < 0) return neutral("inventory_full", { view });
  return Object.freeze({ ok: true, status: "ready", view, container });
}

/**
 * Commits a legacy-compatible turn-in only after a fresh validation. It uses the
 * existing quest_step and discount keys; no migration state or background loop exists.
 */
export function tryCompleteCraftsmanTurnIn(npc, elder, player, expectedStepId) {
  const validation = validateCraftsmanTurnIn(npc, elder, player, expectedStepId);
  if (!validation.ok) return validation;

  const { view, container } = validation;
  const legacyQuest = QUESTS[LEGACY_ROLE_BY_ID[view.roleId]];
  const beforeInventory = snapshotContainer(container);
  const beforeStep = readProperty(npc, "quest_step");
  const discountKey = `village:discount:${legacyQuest.discountLevel}:${legacyQuest.discountItem}`;
  const beforeDiscount = readProperty(elder, discountKey);

  try {
    if (!removeExact(container, view.requirement.itemId, view.requirement.amount)) throw new Error("inventory_changed");
    if (view.reward && !placeReward(container, view.reward)) throw new Error("reward_space_changed");

    const nextStep = view.step + 1;
    npc.setDynamicProperty("quest_step", nextStep);
    if (nextStep >= legacyQuest.chain.length) {
      const existingDiscount = Number.isInteger(beforeDiscount) ? beforeDiscount : 0;
      elder.setDynamicProperty(discountKey, existingDiscount + legacyQuest.discountAmount);
    }

    return Object.freeze({
      ok: true,
      status: "complete",
      view,
      nextStep,
      chainComplete: nextStep >= legacyQuest.chain.length,
      upgrade: view.upgrade
    });
  } catch (error) {
    try { restoreContainer(container, beforeInventory); } catch (restoreError) { /* best-effort rollback */ }
    try { npc.setDynamicProperty("quest_step", beforeStep); } catch (restoreError) { /* best-effort rollback */ }
    try { elder.setDynamicProperty(discountKey, beforeDiscount); } catch (restoreError) { /* best-effort rollback */ }
    return neutral("transaction_failed", { view });
  }
}
