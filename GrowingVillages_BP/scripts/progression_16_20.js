// Pure L16–20 progression contract. This module imports only declarative
// quest data and returns immutable transition decisions without external actions.
import { LEVEL_CHAPTERS, SPECIAL_ARCS } from "./quest_contract_v2.js";

export const EXTENSION_LEVELS = Object.freeze([16, 17, 18, 19, 20]);
export const EXTENSION_BUILDING_IDS = Object.freeze([
  "memorial_grove", "village_infirmary", "civic_workshop", "founders_hall", "village_beacon"
]);
export const EXTENSION_STATE_PREFIX = "village:v2:extension";

const SPECIAL_LEVELS = new Set([16, 17, 18]);
const FINAL_LEVELS = new Set([19, 20]);
const FORBIDDEN_ITEMS = new Set([
  "minecraft:diamond", "minecraft:emerald", "minecraft:netherite_ingot", "minecraft:netherite_scrap",
  "minecraft:enchanted_golden_apple", "minecraft:diamond_axe", "minecraft:diamond_pickaxe",
  "minecraft:diamond_horse_armor", "minecraft:enchanted_book", "minecraft:potion"
]);
const CANON = Object.freeze([
  Object.freeze({ level: 16, chapterId: "chapter.16.roots_of_the_road", buildingId: "memorial_grove", progressKind: "special_arc_complete_then_build", arcId: "special.roots_of_the_road", priorLevel: 15 }),
  Object.freeze({ level: 17, chapterId: "chapter.17.oath_of_care", buildingId: "village_infirmary", progressKind: "special_arc_complete_then_build", arcId: "special.oath_of_care", priorLevel: 16 }),
  Object.freeze({ level: 18, chapterId: "chapter.18.tools_for_all", buildingId: "civic_workshop", progressKind: "special_arc_complete_then_build", arcId: "special.tools_for_all", priorLevel: 17 }),
  Object.freeze({ level: 19, chapterId: "chapter.19.founders_assembly", buildingId: "founders_hall", progressKind: "town_hall_deposit_then_build", arcId: null, priorLevel: 18 }),
  Object.freeze({ level: 20, chapterId: "chapter.20.light_of_the_village", buildingId: "village_beacon", progressKind: "town_hall_deposit_then_build", arcId: null, priorLevel: 19 })
]);

function freezeArray(values) { return Object.freeze([...values]); }
function freezeMap(values) { return Object.freeze({ ...values }); }
function freezePlan(value) { return Object.freeze(value); }
function extensionForLevel(level) { return CANON.find((entry) => entry.level === level) || null; }
function arcForId(arcId) { return SPECIAL_ARCS.find((arc) => arc.arcId === arcId) || null; }
function stateKey(kind, value) { return `${EXTENSION_STATE_PREFIX}:${kind}:${value}`; }

export function extensionArcStepKey(arcId) { return stateKey(`arc:${arcId}`, "step"); }
export function extensionArcReadyKey(arcId) { return stateKey(`arc:${arcId}`, "ready"); }
export function extensionLevelReadyKey(level) { return stateKey(`level:${level}`, "ready"); }
export function extensionLevelCommittedKey(level) { return stateKey(`level:${level}`, "committed"); }

function cloneRequirements(requirements) {
  return freezeArray((requirements || []).map((entry) => freezePlan({ itemId: entry.itemId, amount: entry.amount })));
}

export function extensionProgressionForLevel(level) {
  const canon = extensionForLevel(level);
  const chapter = LEVEL_CHAPTERS.find((entry) => entry.level === level);
  if (!canon || !chapter) return null;
  const arc = canon.arcId ? arcForId(canon.arcId) : null;
  return freezePlan({
    level: canon.level,
    chapterId: canon.chapterId,
    buildingId: canon.buildingId,
    progressKind: canon.progressKind,
    priorLevel: canon.priorLevel,
    arcId: canon.arcId,
    requirements: cloneRequirements(chapter.requirements),
    deferredRewardPolicy: arc?.deferredRewardPolicy || "lore_and_build_only",
    oneTimePolicy: arc?.oneTimePolicy || "once_per_village",
    runtimeStatus: chapter.runtimeStatus
  });
}

export function buildRequestForLevel(level, paletteId = undefined) {
  const entry = extensionProgressionForLevel(level);
  if (!entry) return null;
  return freezePlan({ buildingId: entry.buildingId, level: entry.level, paletteId });
}

function readValue(reader, key) {
  if (!reader || typeof reader !== "object") return undefined;
  if (typeof reader.get === "function") return reader.get(key);
  return reader[key];
}
function validBoolean(value) { return value === true || value === false || value === undefined; }
function validStep(value) { return Number.isInteger(value) && value >= 0 && value <= 3; }
function normalizeBaseLevel(value) { return Number.isInteger(value) && value >= 0 && value <= 20 ? value : null; }

export function readExtensionProgression(reader) {
  let valid = true;
  const rawBaseLevel = readValue(reader, "village:level") ?? readValue(reader, "baseLevel");
  const baseLevel = normalizeBaseLevel(rawBaseLevel);
  if (baseLevel === null) valid = false;
  const arcSteps = {};
  const arcReady = {};
  const levelReady = {};
  const levelCommitted = {};
  for (const entry of CANON) {
    if (entry.arcId) {
      const step = readValue(reader, extensionArcStepKey(entry.arcId));
      const ready = readValue(reader, extensionArcReadyKey(entry.arcId));
      if (!validStep(step ?? 0) || !validBoolean(ready)) valid = false;
      arcSteps[entry.arcId] = step ?? 0;
      arcReady[entry.arcId] = ready === true;
    }
    const ready = readValue(reader, extensionLevelReadyKey(entry.level));
    const committed = readValue(reader, extensionLevelCommittedKey(entry.level));
    if (!validBoolean(ready) || !validBoolean(committed)) valid = false;
    levelReady[entry.level] = ready === true;
    levelCommitted[entry.level] = committed === true;
  }
  return freezePlan({
    valid,
    baseLevel,
    arcSteps: freezeMap(arcSteps),
    arcReady: freezeMap(arcReady),
    levelReady: freezeMap(levelReady),
    levelCommitted: freezeMap(levelCommitted)
  });
}

function normaliseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || snapshot.valid !== true || !Number.isInteger(snapshot.baseLevel)) return null;
  const arcSteps = snapshot.arcSteps || {};
  const arcReady = snapshot.arcReady || {};
  const levelReady = snapshot.levelReady || {};
  const levelCommitted = snapshot.levelCommitted || {};
  for (const entry of CANON) {
    if (entry.arcId && (!validStep(arcSteps[entry.arcId] ?? 0) || typeof arcReady[entry.arcId] !== "boolean")) return null;
    if (typeof levelReady[entry.level] !== "boolean" || typeof levelCommitted[entry.level] !== "boolean") return null;
  }
  return freezePlan({ valid: true, baseLevel: snapshot.baseLevel, arcSteps: freezeMap(arcSteps), arcReady: freezeMap(arcReady), levelReady: freezeMap(levelReady), levelCommitted: freezeMap(levelCommitted) });
}

function withState(snapshot, changes) {
  return freezePlan({
    valid: true,
    baseLevel: changes.baseLevel ?? snapshot.baseLevel,
    arcSteps: freezeMap({ ...snapshot.arcSteps, ...(changes.arcSteps || {}) }),
    arcReady: freezeMap({ ...snapshot.arcReady, ...(changes.arcReady || {}) }),
    levelReady: freezeMap({ ...snapshot.levelReady, ...(changes.levelReady || {}) }),
    levelCommitted: freezeMap({ ...snapshot.levelCommitted, ...(changes.levelCommitted || {}) })
  });
}
function reject(error) { return freezePlan({ ok: false, error, statePatch: freezeMap({}) }); }
function priorSatisfied(snapshot, entry) {
  return entry.priorLevel === 15 ? snapshot.baseLevel === 15 : snapshot.levelCommitted[entry.priorLevel] === true;
}

export function planSpecialArcAdvance(snapshot, arcId, step) {
  const state = normaliseSnapshot(snapshot);
  const entry = CANON.find((candidate) => candidate.arcId === arcId);
  const arc = arcForId(arcId);
  if (!state) return reject("extension_state_invalid");
  if (!entry || !arc) return reject("extension_arc_unknown");
  if (!priorSatisfied(state, entry)) return reject("extension_prior_level_not_committed");
  if (state.levelCommitted[entry.level]) return reject("extension_level_already_committed");
  if (!Number.isInteger(step) || step < 1 || step > 3) return reject("extension_step_invalid");
  const current = state.arcSteps[arcId];
  if (state.arcReady[arcId] || current >= 3) return reject("extension_arc_already_ready");
  if (step !== current + 1) return reject("extension_step_out_of_order");
  const finalStep = step === arc.steps.length;
  const nextState = withState(state, { arcSteps: { [arcId]: step }, arcReady: { [arcId]: finalStep } });
  return freezePlan({
    ok: true,
    action: "advance_special_arc_step",
    arcId,
    step,
    readyForBuild: finalStep,
    request: finalStep ? buildRequestForLevel(entry.level) : null,
    statePatch: freezeMap({ [extensionArcStepKey(arcId)]: step, ...(finalStep ? { [extensionArcReadyKey(arcId)]: true } : {}) }),
    nextState
  });
}

export function planBuildCommit(snapshot, level) {
  const state = normaliseSnapshot(snapshot);
  const entry = extensionForLevel(level);
  if (!state) return reject("extension_state_invalid");
  if (!entry) return reject("extension_level_unknown");
  if (state.levelCommitted[level]) return reject("extension_level_already_committed");
  if (!priorSatisfied(state, entry)) return reject("extension_prior_level_not_committed");
  if (SPECIAL_LEVELS.has(level) && (state.arcSteps[entry.arcId] !== 3 || state.arcReady[entry.arcId] !== true)) return reject("extension_special_arc_not_ready");
  if (FINAL_LEVELS.has(level) && state.levelReady[level] !== true) return reject("extension_town_hall_requirements_not_ready");
  const request = buildRequestForLevel(level);
  const nextState = withState(state, { levelCommitted: { [level]: true }, baseLevel: level });
  return freezePlan({
    ok: true,
    action: "commit_planned_build",
    level,
    request,
    statePatch: freezeMap({ [extensionLevelCommittedKey(level)]: true }),
    nextState
  });
}

export function validateExtensionContract(contract = {}) {
  const chapters = contract.levelChapters || LEVEL_CHAPTERS;
  const arcs = contract.specialArcs || SPECIAL_ARCS;
  const errors = [];
  const expected = CANON;
  const forbiddenChapterIds = new Set(["chapter.19.common_good", "chapter.20.council"]);
  const forbiddenBuildings = new Set(["commons_infrastructure", "grand_council_hall"]);
  if (expected.length !== 5 || new Set(expected.map((entry) => entry.level)).size !== 5) errors.push("extension_canon_invalid");
  for (const entry of expected) {
    const chapter = chapters.find((candidate) => candidate.level === entry.level);
    if (!chapter || chapter.id !== entry.chapterId || chapter.buildingId !== entry.buildingId || chapter.progressKind !== entry.progressKind || chapter.buildTrigger !== entry.progressKind || chapter.runtimeStatus !== "planned") errors.push(`extension_mapping_invalid:${entry.level}`);
    if (entry.level >= 19) {
      if (!chapter?.requirements || chapter.requirements.length !== 4 || chapter.reward?.kind !== "none" || chapter.reward?.repeatPolicy !== "none") errors.push(`extension_final_requirements_invalid:${entry.level}`);
      for (const requirement of chapter?.requirements || []) if (!requirement.itemId?.startsWith("minecraft:") || !Number.isInteger(requirement.amount) || requirement.amount < 1 || FORBIDDEN_ITEMS.has(requirement.itemId)) errors.push(`extension_forbidden_requirement:${entry.level}`);
    }
    if (forbiddenChapterIds.has(chapter?.id) || forbiddenBuildings.has(chapter?.buildingId)) errors.push(`extension_old_id_present:${entry.level}`);
  }
  for (const arcEntry of expected.filter((entry) => entry.arcId)) {
    const arc = arcs.find((candidate) => candidate.arcId === arcEntry.arcId);
    if (!arc || arc.level !== arcEntry.level || arc.buildingId !== arcEntry.buildingId || arc.steps.length !== 3 || arc.deferredRewardPolicy !== "lore_and_build_only" || arc.oneTimePolicy !== "once_per_village") errors.push(`extension_arc_invalid:${arcEntry.level}`);
  }
  return freezePlan({ ok: errors.length === 0, errors: freezeArray(errors) });
}
