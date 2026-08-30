import { ItemStack, EnchantmentTypes } from "@minecraft/server";
import { resolveCraftsmanRole } from "./craftsman_quests.js";

/**
 * The watchman's arc: "Стрела, что не долетела".
 *
 * Unlike a craftsman chain, this one is a courier run - each step is handed
 * in to a *different* NPC, so the player physically walks the village from
 * the tower to the forge, the cartographer, the farmer, the mine and back.
 * That is also why progress lives on the elder rather than on the NPC being
 * talked to: the arc belongs to the village, and every guard and craftsman
 * in it has to agree on which step is currently open. A per-NPC counter (the
 * craftsman model) would let the same step be handed in at each of the four
 * corner towers.
 *
 * Data first, runtime below. Nothing here builds or moves blocks.
 */

const SENTINEL_ROLE_ID = "sentinel";
const SENTINEL_TAG = "village_guard";
// Level 6 is when the miner's house is raised, which is the first level at
// which all four craftsmen this arc routes through actually exist.
const ARC_MIN_LEVEL = 6;
const STEP_PROPERTY = "village:sentinel:step";
const ARC_SLUG = "signal_fire";
const LOCALIZATION_PREFIX = "growing_villages";

function arcKeys() {
  const base = `${LOCALIZATION_PREFIX}.sentinel.arc.${ARC_SLUG}`;
  return Object.freeze({
    title: `${base}.title`,
    intro: `${base}.intro`,
    locked: `${base}.locked`,
    complete: `${base}.complete`
  });
}

function stepKeys(number) {
  const base = `${LOCALIZATION_PREFIX}.sentinel.arc.${ARC_SLUG}.step_${String(number).padStart(2, "0")}`;
  return Object.freeze({
    title: `${base}.title`,
    intro: `${base}.intro`,
    complete: `${base}.complete`
  });
}

export function sentinelRoleLocalizationKey(roleId) {
  return `${LOCALIZATION_PREFIX}.sentinel.role.${roleId}`;
}

function step(number, giverRoleId, nextGiverRoleId, requirements, rewards = []) {
  return Object.freeze({
    id: `arc.sentinel.${ARC_SLUG}.step_${String(number).padStart(2, "0")}`,
    number,
    giverRoleId,
    // Who the player is sent to afterwards. null on the final step - there is
    // nowhere left to run. Used only to render the "go and see X" hint.
    nextGiverRoleId,
    requirements: Object.freeze(requirements.map((entry) => Object.freeze({ ...entry }))),
    rewards: Object.freeze(rewards.map((entry) => Object.freeze({ stackable: true, ...entry }))),
    localization: stepKeys(number)
  });
}

/**
 * Rewards that are more than an item id: a named keepsake the player is meant
 * to recognise in the hotbar. `craft` names the builder below; a crafted item
 * carries a name tag and lore, which makes it unstackable, so it always needs
 * a genuinely empty slot rather than an existing stack to merge into.
 */
const CRAFTED_REWARD_BUILDERS = Object.freeze({
  // A *filled* map cannot be handed out from script: ItemStack lost its data
  // value in 1.19.17, and Bedrock's /give never supported picking a map id
  // either, so a scripted filled_map would arrive blank and useless. An empty
  // map the player unrolls where they stand is the working equivalent, and it
  // reads the same in fiction - the watchman's own sheet, not yet drawn.
  sentinel_map(itemId, amount) {
    const stack = new ItemStack(itemId, amount);
    stack.nameTag = "§bКарта дозорного";
    stack.setLore(["§7Всё, что видно с башни.", "§7Разверни там, откуда начнёшь."]);
    return stack;
  },
  signal_bow(itemId, amount) {
    const stack = new ItemStack(itemId, amount);
    stack.nameTag = "§bСигнальный лук дозорного";
    stack.setLore(["§7Двадцать зим ждал ответа.", "§7Стрела ушла за гребень - и вернулся огонь."]);
    // Deliberately modest: a signal bow, not a raid weapon. Flame is the
    // story (it lights the answering fire), Power I and Unbreaking II only
    // make it worth keeping. Anything an enchanting table beats easily.
    applyEnchantments(stack, [
      { id: "minecraft:flame", level: 1 },
      { id: "minecraft:power", level: 1 },
      { id: "minecraft:unbreaking", level: 2 }
    ]);
    return stack;
  }
});

export const SENTINEL_ARC = Object.freeze({
  arcId: `arc.sentinel.${ARC_SLUG}`,
  roleId: SENTINEL_ROLE_ID,
  minLevel: ARC_MIN_LEVEL,
  repeatPolicy: "once_per_village",
  localization: arcKeys(),
  steps: Object.freeze([
    step(1, "sentinel", "blacksmith",
      [{ itemId: "minecraft:torch", amount: 16 }, { itemId: "minecraft:coal", amount: 8 }]),
    step(2, "blacksmith", "cartographer",
      [{ itemId: "minecraft:iron_ingot", amount: 8 }, { itemId: "minecraft:flint", amount: 8 }],
      [{ itemId: "minecraft:arrow", amount: 8 }]),
    step(3, "cartographer", "farmer",
      [{ itemId: "minecraft:paper", amount: 12 }, { itemId: "minecraft:compass", amount: 1 }]),
    step(4, "farmer", "miner",
      [{ itemId: "minecraft:feather", amount: 16 }, { itemId: "minecraft:string", amount: 4 }],
      [{ itemId: "minecraft:bread", amount: 4 }]),
    step(5, "miner", "sentinel",
      [{ itemId: "minecraft:cobblestone", amount: 24 }, { itemId: "minecraft:torch", amount: 8 }]),
    step(6, "sentinel", null,
      [{ itemId: "minecraft:bow", amount: 1 }, { itemId: "minecraft:string", amount: 3 }],
      [
        { itemId: "minecraft:empty_map", amount: 1, craft: "sentinel_map", stackable: false },
        { itemId: "minecraft:bow", amount: 1, craft: "signal_bow", stackable: false }
      ])
  ])
});

// ---------------------------------------------------------------- runtime

function neutral(reason, extra = {}) {
  return Object.freeze({ ok: false, status: "neutral", reason, ...extra });
}

function readProperty(entity, key) {
  try {
    return entity?.getDynamicProperty?.(key);
  } catch (error) {
    return undefined;
  }
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

/** "sentinel" for a tower guard, the craftsman role for a craftsman, else null. */
export function resolveSentinelArcRole(npc) {
  try {
    if (npc?.hasTag?.(SENTINEL_TAG)) return SENTINEL_ROLE_ID;
  } catch (error) {
    /* entity went invalid mid-check - fall through to the craftsman lookup */
  }
  return resolveCraftsmanRole(npc);
}

function applyEnchantments(stack, enchantments) {
  let enchantable;
  try {
    enchantable = stack.getComponent("minecraft:enchantable");
  } catch (error) {
    enchantable = undefined;
  }
  if (!enchantable) return;
  for (const { id, level } of enchantments) {
    try {
      // EnchantmentTypes.get returns undefined for an id this engine build
      // doesn't know, where the EnchantmentType constructor would throw. A
      // renamed enchantment should cost the bow its shine, never the whole
      // turn-in the player just paid for.
      const type = EnchantmentTypes.get(id);
      if (type) enchantable.addEnchantment({ type, level });
    } catch (error) {
      /* incompatible or out-of-bounds on this build - skip this one */
    }
  }
}

function inventoryContainer(player) {
  try {
    return player?.getComponent?.("minecraft:inventory")?.container || null;
  } catch (error) {
    return null;
  }
}

function countItems(container, typeId) {
  let total = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === typeId) total += stack.amount;
  }
  return total;
}

function snapshotContainer(container) {
  return Array.from({ length: container.size }, (_, slot) => {
    const stack = container.getItem(slot);
    return stack ? stack.clone() : undefined;
  });
}

function restoreContainer(container, snapshot) {
  for (let slot = 0; slot < container.size; slot++) {
    container.setItem(slot, snapshot[slot]);
  }
}

function removeExact(container, typeId, amount) {
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
 * Picks a destination slot per reward up front, so a step that hands out two
 * items either finds room for both or takes nothing at all. A crafted reward
 * carries a name tag and therefore never merges into an existing stack.
 */
function planRewardSlots(container, rewards) {
  const claimed = new Set();
  const plan = [];
  for (const reward of rewards) {
    if (!reward.itemId || !Number.isInteger(reward.amount) || reward.amount < 1) return null;
    let target = -1;
    if (reward.stackable) {
      for (let slot = 0; slot < container.size; slot++) {
        if (claimed.has(slot)) continue;
        const stack = container.getItem(slot);
        if (stack?.typeId === reward.itemId && stack.amount + reward.amount <= 64) { target = slot; break; }
      }
    }
    if (target < 0) {
      for (let slot = 0; slot < container.size; slot++) {
        if (claimed.has(slot) || container.getItem(slot)) continue;
        target = slot;
        break;
      }
    }
    if (target < 0) return null;
    claimed.add(target);
    plan.push({ reward, slot: target });
  }
  return plan;
}

function placeRewards(container, plan) {
  for (const { reward, slot } of plan) {
    const existing = container.getItem(slot);
    if (existing && existing.typeId === reward.itemId) {
      existing.amount += reward.amount;
      container.setItem(slot, existing);
      continue;
    }
    if (existing) return false;
    const builder = reward.craft ? CRAFTED_REWARD_BUILDERS[reward.craft] : null;
    container.setItem(slot, builder ? builder(reward.itemId, reward.amount) : new ItemStack(reward.itemId, reward.amount));
  }
  return true;
}

export function getSentinelArcStep(elder) {
  const raw = readProperty(elder, STEP_PROPERTY);
  const value = raw === undefined ? 0 : raw;
  if (!Number.isInteger(value) || value < 0 || value > SENTINEL_ARC.steps.length) return null;
  return value;
}

/**
 * Read-only projection of the arc as seen from one NPC. `status` is what the
 * menu renders:
 *   locked    - village level is below the arc gate
 *   active    - this NPC owns the currently open step
 *   elsewhere - the arc is running, but the open step belongs to another NPC
 *   complete  - the arc is finished for this village
 */
export function getSentinelArcView(npc, elder) {
  const roleId = resolveSentinelArcRole(npc);
  if (!roleId) return neutral("unknown_role");
  if (!elder) return neutral("no_elder", { roleId });
  if (!sameVillage(npc, elder)) return neutral("different_village", { roleId });

  const level = readProperty(elder, "village:level");
  if (!Number.isInteger(level)) return neutral("invalid_level", { roleId });
  if (level < SENTINEL_ARC.minLevel) {
    return Object.freeze({ ok: true, status: "locked", roleId, arc: SENTINEL_ARC, level, minLevel: SENTINEL_ARC.minLevel });
  }

  const stepIndex = getSentinelArcStep(elder);
  if (stepIndex === null) return neutral("invalid_state", { roleId, level });
  if (stepIndex >= SENTINEL_ARC.steps.length) {
    return Object.freeze({ ok: true, status: "complete", roleId, arc: SENTINEL_ARC, level, step: stepIndex });
  }

  const stepData = SENTINEL_ARC.steps[stepIndex];
  const shared = {
    ok: true,
    roleId,
    arc: SENTINEL_ARC,
    level,
    step: stepIndex,
    stepId: stepData.id,
    stepData,
    stepCount: SENTINEL_ARC.steps.length
  };
  if (stepData.giverRoleId !== roleId) {
    return Object.freeze({ ...shared, status: "elsewhere", waitingRoleId: stepData.giverRoleId });
  }
  return Object.freeze({ ...shared, status: "active", requirements: stepData.requirements, rewards: stepData.rewards });
}

/** True when this NPC is the one the currently open step is waiting on. */
export function sentinelStepAwaits(npc, elder) {
  const view = getSentinelArcView(npc, elder);
  return view.ok && view.status === "active" ? view : null;
}

/** Revalidates every precondition without writing state or touching inventory. */
export function validateSentinelTurnIn(npc, elder, player, expectedStepId) {
  const view = getSentinelArcView(npc, elder);
  if (!view.ok) return view;
  if (view.status === "locked") return neutral("locked", { view });
  if (view.status === "complete") return neutral("arc_complete", { view });
  if (view.status === "elsewhere") return neutral("wrong_giver", { view });
  if (expectedStepId && view.stepId !== expectedStepId) return neutral("stale_state", { view });

  const container = inventoryContainer(player);
  if (!container) return neutral("no_inventory", { view });
  for (const requirement of view.requirements) {
    const have = countItems(container, requirement.itemId);
    if (have < requirement.amount) {
      return neutral("not_enough", { view, have, need: requirement.amount, itemId: requirement.itemId });
    }
  }
  // Requirements are consumed before rewards land, so the slots they free up
  // are legitimately available - plan against the post-consumption inventory.
  if (view.rewards.length > 0 && !planRewardSlots(projectedContainer(container, view.requirements), view.rewards)) {
    return neutral("inventory_full", { view });
  }
  return Object.freeze({ ok: true, status: "ready", view, container });
}

/**
 * A throwaway container facade holding what the player's inventory will look
 * like once this step's requirements are taken, used only to answer "will the
 * rewards fit?" without mutating anything.
 */
function projectedContainer(container, requirements) {
  const slots = Array.from({ length: container.size }, (_, slot) => {
    const stack = container.getItem(slot);
    return stack ? { typeId: stack.typeId, amount: stack.amount } : undefined;
  });
  for (const requirement of requirements) {
    let remaining = requirement.amount;
    for (let slot = 0; slot < slots.length && remaining > 0; slot++) {
      const stack = slots[slot];
      if (!stack || stack.typeId !== requirement.itemId) continue;
      const taken = Math.min(remaining, stack.amount);
      remaining -= taken;
      if (taken === stack.amount) slots[slot] = undefined;
      else stack.amount -= taken;
    }
  }
  return { size: container.size, getItem: (slot) => slots[slot] };
}

/**
 * Commits one courier step after a fresh validation. Inventory and the arc
 * counter are restored together if anything throws part-way, so a failed
 * hand-in can never cost the player the items without advancing the story.
 */
export function tryCompleteSentinelTurnIn(npc, elder, player, expectedStepId) {
  const validation = validateSentinelTurnIn(npc, elder, player, expectedStepId);
  if (!validation.ok) return validation;

  const { view, container } = validation;
  const beforeInventory = snapshotContainer(container);
  const beforeStep = readProperty(elder, STEP_PROPERTY);

  try {
    for (const requirement of view.requirements) {
      if (!removeExact(container, requirement.itemId, requirement.amount)) throw new Error("inventory_changed");
    }
    if (view.rewards.length > 0) {
      const plan = planRewardSlots(container, view.rewards);
      if (!plan || !placeRewards(container, plan)) throw new Error("reward_space_changed");
    }

    const nextStep = view.step + 1;
    elder.setDynamicProperty(STEP_PROPERTY, nextStep);
    return Object.freeze({
      ok: true,
      status: "committed",
      view,
      nextStep,
      arcComplete: nextStep >= SENTINEL_ARC.steps.length,
      nextGiverRoleId: view.stepData.nextGiverRoleId
    });
  } catch (error) {
    try { restoreContainer(container, beforeInventory); } catch (restoreError) { /* best-effort rollback */ }
    try { elder.setDynamicProperty(STEP_PROPERTY, beforeStep); } catch (restoreError) { /* best-effort rollback */ }
    return neutral("transaction_failed", { view });
  }
}
