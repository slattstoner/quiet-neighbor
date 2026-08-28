import { chapterForLevel } from "./quest_contract_v2.js";

// This is intentionally a small state adapter. It has no world/UI/builder imports
// and no module-scope side effects, so it is safe to load with the core pipeline.
export const QUEST_STATE_SCHEMA_VERSION = 2;
export const RUNTIME_CHAPTER_MAX_LEVEL = 10;

const PROP_LEVEL = "village:level";
const PROP_SCHEMA = "village:schema";
const PROP_CHAPTER = "village:v2:chapter";
const PROP_CHAPTER_PREFIX = "village:v2:chapter:";
const KNOWN_QUEST_STATES = new Set(["open", "complete"]);

function neutral(reason, extra = {}) {
  return { ok: false, status: "neutral", reason, chapterId: null, state: null, ...extra };
}

function supportsProperties(elder) {
  return !!elder && typeof elder.getDynamicProperty === "function" &&
    typeof elder.setDynamicProperty === "function";
}

function readLevel(elder) {
  try {
    const level = elder.getDynamicProperty(PROP_LEVEL);
    return Number.isInteger(level) ? level : null;
  } catch (error) {
    return null;
  }
}

function isKnownChapterId(chapterId) {
  if (typeof chapterId !== "string") return false;
  return chapterForLevel(1) !== null && Array.from({ length: 20 }, (_, index) => index + 1)
    .some((level) => chapterForLevel(level)?.id === chapterId);
}

export function isKnownQuestState(value) {
  return KNOWN_QUEST_STATES.has(value);
}

/** Pure lookup for data-contract consumers; it can describe future chapters 1–20. */
export function chapterForVillageLevel(level) {
  return chapterForLevel(level)?.id || null;
}

/** Returns only a diagnostic snapshot; it never mutates elder state. */
export function getVillageChapterState(elder) {
  if (!elder || typeof elder.getDynamicProperty !== "function") return neutral("invalid_elder");
  try {
    const schema = elder.getDynamicProperty(PROP_SCHEMA);
    const chapterId = elder.getDynamicProperty(PROP_CHAPTER);
    if (schema !== QUEST_STATE_SCHEMA_VERSION) return neutral("unknown_schema", { schema });
    if (!isKnownChapterId(chapterId)) return neutral("unknown_chapter", { schema, chapterId });
    const state = elder.getDynamicProperty(PROP_CHAPTER_PREFIX + chapterId);
    if (!isKnownQuestState(state)) return neutral("unknown_state", { schema, chapterId, state });
    return { ok: true, status: "known", schema, chapterId, state };
  } catch (error) {
    return neutral("property_read_failed");
  }
}

/**
 * Sets the active runtime chapter for an existing supported level. Future contract
 * chapters remain data-only until actual progression supports their levels.
 */
export function setVillageChapterForLevel(elder, level) {
  if (!supportsProperties(elder)) return neutral("invalid_elder");
  if (!Number.isInteger(level) || level < 1 || level > RUNTIME_CHAPTER_MAX_LEVEL) {
    return neutral("unsupported_runtime_level", { level });
  }

  const chapterId = chapterForVillageLevel(level);
  if (!chapterId) return neutral("unknown_level", { level });

  try {
    const previousId = elder.getDynamicProperty(PROP_CHAPTER);
    const previousState = isKnownChapterId(previousId)
      ? elder.getDynamicProperty(PROP_CHAPTER_PREFIX + previousId)
      : null;

    elder.setDynamicProperty(PROP_SCHEMA, QUEST_STATE_SCHEMA_VERSION);
    if (previousId && previousId !== chapterId && isKnownQuestState(previousState)) {
      elder.setDynamicProperty(PROP_CHAPTER_PREFIX + previousId, "complete");
    }
    elder.setDynamicProperty(PROP_CHAPTER, chapterId);
    elder.setDynamicProperty(PROP_CHAPTER_PREFIX + chapterId, "open");
    return { ok: true, status: "known", schema: QUEST_STATE_SCHEMA_VERSION, chapterId, state: "open" };
  } catch (error) {
    return neutral("property_write_failed", { level, chapterId });
  }
}

/**
 * Lazy-safe init for villages created before this module existed. It only writes
 * v2 chapter keys and schema; legacy quest, discount and special properties stay put.
 */
export function ensureVillageChapterState(elder) {
  if (!supportsProperties(elder)) return neutral("invalid_elder");

  const existing = getVillageChapterState(elder);
  if (existing.ok) return existing;

  const level = readLevel(elder);
  if (!Number.isInteger(level)) return neutral("missing_legacy_level");
  return setVillageChapterForLevel(elder, level);
}
