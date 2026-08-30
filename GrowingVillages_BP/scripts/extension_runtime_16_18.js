import { ItemStack } from "@minecraft/server";
import { SPECIAL_ARCS } from "./quest_contract_v2.js";
import {
  extensionProgressionForLevel,
  planBuildCommit,
  planSpecialArcAdvance,
  readExtensionProgression
} from "./progression_16_20.js";
import { buildPlannedVillageBuilding, getPlannedBuildState } from "./planned_build_transaction.js";
import { LAYOUT_VERSION_V2, getLayoutVersion, refreshSign } from "./village.js";
import { countItems, inventoryContainer, removeExact, restoreContainer, snapshotContainer } from "./inventory.js";
import { PROP_LEVEL } from "./village_state.js";

/**
 * Stage 10 coordinator for L16–L18 only.
 *
 * This is the single module allowed to see both Stage 9 halves: the pure
 * planner (`progression_16_20.js`) decides, the shared physical dispatcher
 * (`planned_build_transaction.js`) builds. Business rules live here and
 * nowhere else - not in the builders and not in the pure planner.
 *
 * Deliberate two-phase split:
 *   Phase A - special-arc steps 1..3 consume player items and advance arc state.
 *   Phase B - the build commit consumes nothing, so a failed physical build can
 *             never cost the player resources or hand out a level.
 *
 * L19 and L20 remain planned data; the allow-list below is the activation gate.
 */

export const EXTENSION_RUNTIME_LEVELS = Object.freeze([16, 17, 18]);
export const EXTENSION_CHAPTER_KEY = "village:v2:extension:chapter";
const ACTIVE_LEVELS = new Set(EXTENSION_RUNTIME_LEVELS);
const ARC_STEP_COUNT = 3;

function frozen(value) {
  return Object.freeze(value);
}

function neutral(reason, extra = {}) {
  return frozen({ ok: false, status: "neutral", reason, ...extra });
}

function safeWarning(options, message) {
  const warn = options?.warn || console.warn;
  try { warn(`[extension-16-18] ${message}`); } catch (error) { /* warnings never alter transaction semantics */ }
}

function arcForId(arcId) {
  return SPECIAL_ARCS.find((arc) => arc.arcId === arcId) || null;
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

/** First activated level that this village has not committed yet. */
function activeLevel(snapshot) {
  for (const level of EXTENSION_RUNTIME_LEVELS) {
    if (snapshot.levelCommitted[level] !== true) return level;
  }
  return null;
}

/** Writes a planner state patch with per-key rollback on partial failure. */
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

function missingRequirement(container, requirements) {
  for (const requirement of requirements) {
    const have = countItems(container, requirement.itemId);
    if (have < requirement.amount) return frozen({ itemId: requirement.itemId, need: requirement.amount, have });
  }
  return null;
}

function inactive(reason, extra = {}) {
  return frozen({
    ok: false, status: "inactive", reason,
    level: null, arcId: null, buildingId: null, chapterId: null,
    step: 0, nextStep: null, stepId: null, requirements: Object.freeze([]),
    ...extra
  });
}

/**
 * Read-only projection used by the elder UI and by every write path as its
 * first preflight. It never writes state, inventory, level or chapter.
 */
export function getExtensionStatus(elder) {
  const gate = guard(elder);
  if (!gate.ok) return inactive(gate.error, { layout: gate.layout });

  const snapshot = gate.snapshot;
  const level = activeLevel(snapshot);
  if (level === null) {
    return frozen({
      ok: true, status: "complete", reason: null, level: null,
      arcId: null, buildingId: null, chapterId: null,
      step: ARC_STEP_COUNT, nextStep: null, stepId: null, requirements: Object.freeze([])
    });
  }
  if (!ACTIVE_LEVELS.has(level)) return inactive("extension_level_not_active", { level });

  const plan = extensionProgressionForLevel(level);
  const arc = plan ? arcForId(plan.arcId) : null;
  if (!plan || !arc || arc.steps.length !== ARC_STEP_COUNT) return inactive("extension_arc_unknown", { level });

  const shared = {
    level,
    arcId: plan.arcId,
    buildingId: plan.buildingId,
    chapterId: plan.chapterId,
    arc,
    titleKey: arc.titleKey,
    summaryKey: arc.summaryKey
  };

  const step = snapshot.arcSteps[plan.arcId] ?? 0;
  const ready = snapshot.arcReady[plan.arcId] === true;

  if (ready || step >= ARC_STEP_COUNT) {
    const commitPlan = planBuildCommit(snapshot, level);
    if (!commitPlan.ok) return inactive(commitPlan.error, { level, arcId: plan.arcId });
    return frozen({
      ok: true, status: "ready_to_build", reason: null,
      ...shared, step: ARC_STEP_COUNT, nextStep: null, stepId: null,
      requirements: Object.freeze([]), request: commitPlan.request,
      buildKey: arc.buildKey, completionKey: arc.completionKey
    });
  }

  const advance = planSpecialArcAdvance(snapshot, plan.arcId, step + 1);
  if (!advance.ok) return inactive(advance.error, { level, arcId: plan.arcId, step });

  const contractStep = arc.steps[step];
  return frozen({
    ok: true, status: "arc_step", reason: null,
    ...shared,
    step,
    nextStep: step + 1,
    stepId: contractStep.id,
    stepCount: ARC_STEP_COUNT,
    requirements: contractStep.requirements,
    stepKeys: contractStep.localization
  });
}

/** True only when the elder menu should offer the special-chapter entry at all. */
export function extensionMenuAvailable(elder) {
  const status = getExtensionStatus(elder);
  return status.ok && (status.status === "arc_step" || status.status === "ready_to_build");
}

/**
 * Phase A. Consumes the player's step items and advances arc state only.
 * It never builds, never changes the village level and never opens a chapter.
 */
export function tryAdvanceSpecialArcStep(elder, player, expectedStepId, options = undefined) {
  const view = getExtensionStatus(elder);
  if (!view.ok) return neutral(view.reason || "extension_unavailable", { view });
  if (view.status !== "arc_step") return neutral("extension_no_active_step", { view });
  if (expectedStepId !== undefined && expectedStepId !== null && expectedStepId !== view.stepId) {
    return neutral("extension_stale_state", { view });
  }

  const container = inventoryContainer(player);
  if (!container) return neutral("extension_no_inventory", { view });
  const missing = missingRequirement(container, view.requirements);
  if (missing) return neutral("extension_not_enough", { view, missing });

  // Re-plan against freshly read state; the form may have been open for a while.
  const gate = guard(elder);
  if (!gate.ok) return neutral(gate.error, { view });
  const plan = planSpecialArcAdvance(gate.snapshot, view.arcId, view.nextStep);
  if (!plan.ok) return neutral(plan.error, { view });

  const before = snapshotContainer(container);
  try {
    for (const requirement of view.requirements) {
      if (!removeExact(container, requirement.itemId, requirement.amount)) throw new Error("inventory_changed");
    }
  } catch (error) {
    try { restoreContainer(container, before); } catch (restoreError) { safeWarning(options, "inventory rollback failed"); }
    return neutral("extension_inventory_changed", { view });
  }

  const applied = applyStatePatch(elder, plan.statePatch);
  if (!applied.ok) {
    try { restoreContainer(container, before); } catch (restoreError) { safeWarning(options, "inventory rollback failed"); }
    safeWarning(options, `arc state write failed: ${view.arcId}`);
    return neutral("extension_state_write_failed", { view });
  }

  return frozen({
    ok: true,
    status: "advanced",
    level: view.level,
    arcId: view.arcId,
    stepId: view.stepId,
    step: view.nextStep,
    arcComplete: plan.readyForBuild === true,
    readyForBuild: plan.readyForBuild === true,
    request: plan.request || null
  });
}

/**
 * Phase B. Consumes no resources. It runs the shared dispatcher and commits
 * chapter, arc and village level only after a confirmed physical build.
 */
export function tryCommitExtensionBuild(elder, options = undefined) {
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
    // The physical building already exists but the progression commit did not
    // land. Finish the commit instead of ever constructing a second copy.
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

  // Commit order is deliberate: the committed flag is written before the level.
  // The reverse order could leave baseLevel advanced with the flag unset, which
  // `priorSatisfied()` would reject permanently.
  const applied = applyStatePatch(elder, plan.statePatch);
  if (!applied.ok) {
    safeWarning(options, `commit state write failed: ${buildingId}`);
    return neutral("extension_commit_failed", { level, buildingId, recoverable: true });
  }

  let levelWritten = true;
  try {
    elder.setDynamicProperty(PROP_LEVEL, level);
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
