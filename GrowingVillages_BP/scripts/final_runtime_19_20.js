import { ItemStack } from "@minecraft/server";
import {
  extensionLevelReadyKey,
  extensionProgressionForLevel,
  planBuildCommit,
  readExtensionProgression
} from "./progression_16_20.js";
import { buildPlannedVillageBuilding, getPlannedBuildState } from "./planned_build_transaction.js";
import { LAYOUT_VERSION_V2, getLayoutVersion, getVillageState, refreshSign } from "./village.js";

/**
 * Stage 11 coordinator for L19-L20 only. Kept isolated from Stage 10's
 * extension_runtime_16_18.js on purpose - the two coordinators share only
 * the pure planner and the physical dispatcher, never each other.
 *
 * L19-20 have no special arc; progressKind is "town_hall_deposit_then_build".
 * Phase A deposits the four canonical items into the existing town hall
 * chest and writes the one planner-owned key that Stage 9/10 deliberately
 * left unset: village:v2:extension:level:<level>:ready. Phase B commits the
 * build and consumes nothing, so a failed physical build can never cost the
 * player resources or a level - identical guarantee to Stage 10.
 */

export const FINAL_RUNTIME_LEVELS = Object.freeze([19, 20]);
const ACTIVE_LEVELS = new Set(FINAL_RUNTIME_LEVELS);
export const EXTENSION_CHAPTER_KEY = "village:v2:extension:chapter";
export const VILLAGE_LEVEL_KEY = "village:level";

function frozen(value) {
  return Object.freeze(value);
}

function neutral(reason, extra = {}) {
  return frozen({ ok: false, status: "neutral", reason, ...extra });
}

function safeWarning(options, message) {
  const warn = options?.warn || console.warn;
  try { warn(`[final-19-20] ${message}`); } catch (error) { /* warnings never alter transaction semantics */ }
}

function usableElder(elder) {
  return !!elder && typeof elder.getDynamicProperty === "function" && typeof elder.setDynamicProperty === "function";
}

/** Preflight only: it reads state and never writes anything. */
function guard(elder) {
  if (!usableElder(elder)) return { ok: false, error: "extension_invalid_elder" };
  let layout;
  try {
    layout = getLayoutVersion(elder);
  } catch (error) {
    return { ok: false, error: "extension_layout_unreadable" };
  }
  if (layout !== LAYOUT_VERSION_V2) return { ok: false, error: "extension_layout_unsupported", layout };

  let snapshot;
  try {
    snapshot = readExtensionProgression({ get: (key) => elder.getDynamicProperty(key) });
  } catch (error) {
    return { ok: false, error: "extension_state_unreadable" };
  }
  if (!snapshot?.valid) return { ok: false, error: "extension_state_invalid" };
  return { ok: true, snapshot, layout };
}

/** First activated final level that this village has not committed yet. */
function activeLevel(snapshot) {
  for (const level of FINAL_RUNTIME_LEVELS) {
    if (snapshot.levelCommitted[level] !== true) return level;
  }
  return null;
}

function priorCommitted(snapshot, plan) {
  return plan.priorLevel === 15 ? snapshot.baseLevel === 15 : snapshot.levelCommitted[plan.priorLevel] === true;
}

function applyStatePatch(elder, statePatch) {
  const entries = Object.entries(statePatch || {});
  const previous = [];
  try {
    for (const [key, value] of entries) {
      previous.push([key, elder.getDynamicProperty(key)]);
      elder.setDynamicProperty(key, value);
    }
    return { ok: true, written: entries.length };
  } catch (error) {
    for (const [key, value] of previous.reverse()) {
      try { elder.setDynamicProperty(key, value); } catch (rollbackError) { /* best-effort rollback */ }
    }
    return { ok: false, error };
  }
}

function chestContainer(elder, state) {
  try {
    const block = elder.dimension.getBlock(state.chest);
    const inv = block?.getComponent("minecraft:inventory");
    return inv ? inv.container : null;
  } catch (error) {
    return null;
  }
}

function chestTotals(container) {
  const totals = {};
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack) totals[stack.typeId] = (totals[stack.typeId] || 0) + stack.amount;
  }
  return totals;
}

function snapshotContainer(container) {
  return Array.from({ length: container.size }, (_, slot) => {
    const stack = container.getItem(slot);
    return stack ? { typeId: stack.typeId, amount: stack.amount } : undefined;
  });
}

function restoreContainer(container, snapshot) {
  for (let slot = 0; slot < container.size; slot++) {
    const stack = snapshot[slot];
    container.setItem(slot, stack ? new ItemStack(stack.typeId, stack.amount) : undefined);
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

function missingRequirement(totals, requirements) {
  for (const requirement of requirements) {
    const have = totals[requirement.itemId] || 0;
    if (have < requirement.amount) return frozen({ itemId: requirement.itemId, need: requirement.amount, have });
  }
  return null;
}

function inactive(reason, extra = {}) {
  return frozen({
    ok: false, status: "inactive", reason,
    level: null, buildingId: null, chapterId: null, requirements: Object.freeze([]),
    ...extra
  });
}

/**
 * Read-only projection used by the elder UI and by every write path as its
 * first preflight. It never writes state, inventory, chest, level or chapter.
 */
export function getFinalCityStatus(elder) {
  const gate = guard(elder);
  if (!gate.ok) return inactive(gate.error, { layout: gate.layout });

  const snapshot = gate.snapshot;
  const level = activeLevel(snapshot);
  if (level === null) {
    return frozen({
      ok: true, status: "complete", reason: null,
      level: null, buildingId: null, chapterId: null, requirements: Object.freeze([])
    });
  }
  if (!ACTIVE_LEVELS.has(level)) return inactive("extension_level_not_active", { level });

  const plan = extensionProgressionForLevel(level);
  if (!plan) return inactive("extension_level_unknown", { level });
  if (!priorCommitted(snapshot, plan)) return inactive("extension_prior_level_not_committed", { level });

  const shared = { level, buildingId: plan.buildingId, chapterId: plan.chapterId, requirements: plan.requirements };
  const ready = snapshot.levelReady[level] === true;

  if (ready) {
    const commitPlan = planBuildCommit(snapshot, level);
    if (!commitPlan.ok) return inactive(commitPlan.error, { level });
    return frozen({ ok: true, status: "ready_to_build", reason: null, ...shared, request: commitPlan.request });
  }

  return frozen({ ok: true, status: "deposit_pending", reason: null, ...shared });
}

/** True only when the elder menu should offer the final-city entry at all. */
export function finalCityMenuAvailable(elder) {
  const status = getFinalCityStatus(elder);
  return status.ok && (status.status === "deposit_pending" || status.status === "ready_to_build");
}

/**
 * Phase A. Consumes the town hall chest deposit and writes only the
 * levelReady flag. It never builds and never changes the village level.
 */
export function tryDepositFinalCityRequirements(elder, options = undefined) {
  const view = getFinalCityStatus(elder);
  if (!view.ok) return neutral(view.reason || "extension_unavailable", { view });
  if (view.status !== "deposit_pending") return neutral("extension_level_already_ready", { view });

  const state = getVillageState(elder);
  const container = chestContainer(elder, state);
  if (!container) return neutral("extension_no_chest", { view });

  const totals = chestTotals(container);
  const missing = missingRequirement(totals, view.requirements);
  if (missing) return neutral("extension_not_enough", { view, missing });

  const before = snapshotContainer(container);
  try {
    for (const requirement of view.requirements) {
      if (!removeExact(container, requirement.itemId, requirement.amount)) throw new Error("chest_changed");
    }
  } catch (error) {
    try { restoreContainer(container, before); } catch (restoreError) { safeWarning(options, "chest rollback failed"); }
    return neutral("extension_chest_changed", { view });
  }

  try {
    elder.setDynamicProperty(extensionLevelReadyKey(view.level), true);
  } catch (error) {
    try { restoreContainer(container, before); } catch (restoreError) { safeWarning(options, "chest rollback failed"); }
    safeWarning(options, `ready flag write failed: L${view.level}`);
    return neutral("extension_state_write_failed", { view });
  }

  return frozen({ ok: true, status: "deposited", level: view.level, buildingId: view.buildingId });
}

/**
 * Phase B. Consumes no resources. It runs the shared dispatcher and commits
 * chapter, arc-free progression and village level only after a confirmed
 * physical build. Mirrors Stage 10's tryCommitExtensionBuild exactly.
 */
export function tryCommitFinalCityBuild(elder, options = undefined) {
  const gate = guard(elder);
  if (!gate.ok) return neutral(gate.error);

  const level = activeLevel(gate.snapshot);
  if (level === null) return neutral("extension_all_committed");
  if (!ACTIVE_LEVELS.has(level)) return neutral("extension_level_not_active", { level });

  const plan = planBuildCommit(gate.snapshot, level);
  if (!plan.ok) return neutral(plan.error, { level });

  const request = plan.request;
  const buildingId = request.buildingId;
  const chapterId = extensionProgressionForLevel(level)?.chapterId || null;

  const buildState = getPlannedBuildState(elder, buildingId);
  if (typeof buildState === "object") {
    safeWarning(options, `refusing commit on corrupt build state: ${buildingId}`);
    return neutral("extension_build_state_corrupt", { level, buildingId });
  }

  let dispatch = null;
  let repaired = false;
  if (buildState === 2) {
    repaired = true;
  } else {
    const dispatcher = options?.dispatch || buildPlannedVillageBuilding;
    dispatch = dispatcher(elder, request, options);
    if (!dispatch?.done) {
      return neutral(dispatch?.error || "extension_build_failed", {
        level, buildingId, recoverable: dispatch?.recoverable === true
      });
    }
  }

  const applied = applyStatePatch(elder, plan.statePatch);
  if (!applied.ok) {
    safeWarning(options, `commit state write failed: ${buildingId}`);
    return neutral("extension_commit_failed", { level, buildingId, recoverable: true });
  }

  let levelWritten = true;
  try {
    elder.setDynamicProperty(VILLAGE_LEVEL_KEY, level);
  } catch (error) {
    levelWritten = false;
    safeWarning(options, `village level write failed at L${level}`);
  }

  let chapterWritten = false;
  try {
    if (chapterId) {
      elder.setDynamicProperty(EXTENSION_CHAPTER_KEY, chapterId);
      chapterWritten = true;
    }
  } catch (error) {
    safeWarning(options, `extension chapter write failed at L${level}`);
  }

  try {
    (options?.refreshSign || refreshSign)(elder);
  } catch (error) {
    safeWarning(options, "sign refresh failed");
  }

  return frozen({
    ok: true,
    status: "built",
    level,
    buildingId,
    chapterId: chapterWritten ? chapterId : null,
    repaired,
    levelWritten,
    request,
    shape: dispatch?.shape || null,
    connector: dispatch?.connector || null
  });
}
