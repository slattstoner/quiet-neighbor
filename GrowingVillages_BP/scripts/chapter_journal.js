import { getVillageChapterState, RUNTIME_CHAPTER_MAX_LEVEL } from "./chapter_state.js";
import { availableArcIdsForLevel, chapterForLevel } from "./quest_contract_v2.js";
import { MAX_BETA_LEVEL } from "./levels.js";
import { PROP_LEVEL } from "./village_state.js";

export const JOURNAL_KEYS = Object.freeze({
  button: "growing_villages.ui.elder.chronicle.button",
  title: "growing_villages.ui.elder.chronicle.title",
  currentLevel: "growing_villages.ui.elder.chronicle.current_level",
  chapterHeader: "growing_villages.ui.elder.chronicle.chapter_header",
  statusHeader: "growing_villages.ui.elder.chronicle.status_header",
  statusOpen: "growing_villages.ui.elder.chronicle.status.open",
  statusComplete: "growing_villages.ui.elder.chronicle.status.complete",
  statusUnknown: "growing_villages.ui.elder.chronicle.status.unknown",
  nextGrowth: "growing_villages.ui.elder.chronicle.next_growth",
  nextGrowthHint: "growing_villages.ui.elder.chronicle.next_growth_hint",
  betaCap: "growing_villages.ui.elder.chronicle.beta_cap",
  arcsHeader: "growing_villages.ui.elder.chronicle.arcs_header",
  noArcs: "growing_villages.ui.elder.chronicle.no_arcs",
  back: "growing_villages.ui.elder.chronicle.back",
  safeError: "growing_villages.ui.elder.chronicle.safe_error"
});

function freezeArray(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

function normalizedLocale(locale) {
  return locale === "ru_RU" ? "ru_RU" : "en_US";
}

function chapterKeys(chapterId) {
  return Object.freeze({
    title: `growing_villages.chapter.${chapterId}.title`,
    intro: `growing_villages.chapter.${chapterId}.intro`
  });
}

function arcKeys(arcId) {
  return Object.freeze({
    title: `growing_villages.arc.${arcId}.title`
  });
}

function safeModel(locale, errorKey, details = {}) {
  return Object.freeze({
    locale: normalizedLocale(locale),
    level: null,
    chapterId: null,
    chapterState: "unknown",
    nextChapterId: null,
    nextIsRuntime: false,
    availableArcIds: Object.freeze([]),
    availableArcs: Object.freeze([]),
    isTerminal: true,
    isFallback: true,
    errorKey,
    keys: JOURNAL_KEYS,
    chapterKeys: null,
    nextChapterKeys: null,
    ...details
  });
}

function readLegacyLevel(elder) {
  if (!elder || typeof elder.getDynamicProperty !== "function") return null;
  try {
    const level = elder.getDynamicProperty(PROP_LEVEL);
    return Number.isInteger(level) ? level : null;
  } catch (error) {
    return null;
  }
}

/**
 * Builds display data only. This function deliberately never calls ensure/migration
 * helpers and never writes properties, inventories, levels, quest state or rewards.
 */
export function buildChapterJournalModel(elder, locale) {
  const safeLocale = normalizedLocale(locale);
  const level = readLegacyLevel(elder);
  if (!Number.isInteger(level) || level < 1 || level > MAX_BETA_LEVEL || level > RUNTIME_CHAPTER_MAX_LEVEL) {
    return safeModel(safeLocale, JOURNAL_KEYS.safeError);
  }

  const expectedChapter = chapterForLevel(level);
  if (!expectedChapter) return safeModel(safeLocale, JOURNAL_KEYS.safeError, { level });

  const stateSnapshot = getVillageChapterState(elder);
  const stateMatchesLevel = stateSnapshot.ok && stateSnapshot.chapterId === expectedChapter.id;
  const chapterState = stateMatchesLevel ? stateSnapshot.state : "unknown";
  const isFallback = !stateMatchesLevel;
  const nextChapter = level < MAX_BETA_LEVEL ? chapterForLevel(level + 1) : null;
  const availableArcIds = availableArcIdsForLevel(level);
  const availableArcs = freezeArray(availableArcIds.map((id) => ({ id, keys: arcKeys(id) })));

  return Object.freeze({
    locale: safeLocale,
    level,
    chapterId: expectedChapter.id,
    chapterState,
    nextChapterId: nextChapter?.id || null,
    nextIsRuntime: !!nextChapter && nextChapter.level <= MAX_BETA_LEVEL,
    availableArcIds,
    availableArcs,
    isTerminal: level === MAX_BETA_LEVEL,
    isFallback,
    errorKey: isFallback ? JOURNAL_KEYS.safeError : null,
    keys: JOURNAL_KEYS,
    chapterKeys: chapterKeys(expectedChapter.id),
    nextChapterKeys: nextChapter ? chapterKeys(nextChapter.id) : null
  });
}
