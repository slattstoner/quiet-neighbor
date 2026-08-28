import { __test__ } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { foundVillage, getVillageState, tryLevelUp } from "./scripts/village.js";
import { LEVELS } from "./scripts/levels.js";
import { buildChapterJournalModel, JOURNAL_KEYS } from "./scripts/chapter_journal.js";
import { openVillageJournal } from "./scripts/ui.js";

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error("FAIL:", message);
  } else {
    console.log("ok:", message);
  }
}

function fillRequirements(elder, level) {
  const state = getVillageState(elder);
  const container = elder.dimension.getBlock(state.chest).getComponent("minecraft:inventory").container;
  let slot = 0;
  for (const [itemId, amount] of Object.entries(LEVELS[level].requirements)) {
    container.setItem(slot++, { typeId: itemId, amount });
  }
}

function dynamicSnapshot(entity, keys) {
  return Object.fromEntries(keys.map((key) => [key, entity.getDynamicProperty(key)]));
}

console.log("\n=== new village model ===");
const dim = __test__.makeDimension();
const player = __test__.makePlayer("JournalTester", { x: 170000, y: 70, z: 170000 });
player.dimension = dim;
const elder = foundVillage(player, { x: 170000, y: 70, z: 170000 }, 0);
let model = buildChapterJournalModel(elder, "ru_RU");
assert(Object.isFrozen(model), "journal model is immutable");
assert(model.level === 1 && model.chapterId === "chapter.01.foundation" && model.chapterState === "open",
  "new village journal shows level 1 open foundation chapter");
assert(model.nextChapterId === "chapter.02.field" && model.nextIsRuntime, "new village journal names the next runtime chapter");
assert(model.availableArcIds.length === 0, "new village journal has no unavailable arc metadata");
assert(model.locale === "ru_RU" && model.keys === JOURNAL_KEYS, "model keeps locale and stable localisation references");

console.log("\n=== level model transitions and arc gates ===");
const expectedChapterIds = [
  "chapter.01.foundation", "chapter.02.field", "chapter.03.forge", "chapter.04.routes", "chapter.05.watch",
  "chapter.06.safe_mine", "chapter.07.neighbours", "chapter.08.remembered_places", "chapter.09.craft_circle", "chapter.10.safe_roads"
];
const legacyArcs = ["arc.farmer", "arc.blacksmith", "arc.cartographer", "arc.miner"];
const plannedSpecialIds = ["special.roots_of_the_road", "special.oath_of_care", "special.tools_for_all"];
const retiredSpecialIds = ["special.ranger.trail", "special.healer.oath", "special.engineer.axis"];
const expectedArcs = new Map([
  [2, ["arc.farmer"]],
  [3, ["arc.farmer", "arc.blacksmith"]],
  [4, ["arc.farmer", "arc.blacksmith", "arc.cartographer"]],
  [5, ["arc.farmer", "arc.blacksmith", "arc.cartographer"]],
  [6, legacyArcs],
  [7, legacyArcs],
  [8, legacyArcs],
  [9, legacyArcs],
  [10, legacyArcs]
]);
for (let level = 2; level <= 10; level++) {
  fillRequirements(elder, level);
  const result = tryLevelUp(elder);
  model = buildChapterJournalModel(elder, "en_US");
  assert(result.done && model.level === level, `journal follows successful level ${level}`);
  assert(model.chapterId === expectedChapterIds[level - 1] && model.chapterId === result.chapterId && model.chapterState === "open",
    `level ${level} journal has the exact active open chapter ID`);
  assert(JSON.stringify(model.availableArcIds) === JSON.stringify(expectedArcs.get(level)),
    `level ${level} journal reports only available arc metadata`);
  if (level >= 8) {
    assert(!model.availableArcIds.some((arcId) => plannedSpecialIds.includes(arcId)),
      `level ${level} journal excludes all planned special arc IDs`);
    assert(!model.availableArcIds.some((arcId) => retiredSpecialIds.includes(arcId)),
      `level ${level} journal excludes all retired special arc IDs`);
    assert(JSON.stringify(model.availableArcIds) === JSON.stringify(legacyArcs),
      `level ${level} journal keeps exactly four ordered legacy arcs`);
  }
  assert(model.nextChapterId === (level < 10 ? expectedChapterIds[level] : null),
    `level ${level} journal exposes only the exact next normal-runtime chapter`);
}
assert(model.isTerminal && model.nextChapterId === null && !model.nextIsRuntime,
  "level 10 journal is terminal and never presents level 11 as a runtime step");
assert(model.keys.betaCap === "growing_villages.ui.elder.chronicle.beta_cap", "terminal model references beta-cap localisation key");

console.log("\n=== legacy and damaged fallback safety ===");
const legacyValues = new Map([
  ["village:level", 4],
  ["quest_step", 2],
  ["village:discount:6:minecraft:cobblestone", 16],
  ["village:specialQuest:ranger", 1],
  ["village:specialBuilt:ranger", false]
]);
const legacy = {
  getDynamicProperty(key) { return legacyValues.get(key); },
  setDynamicProperty() { throw new Error("journal must not write"); },
  isValid: true
};
const legacyBefore = [...legacyValues.entries()];
const legacyModel = buildChapterJournalModel(legacy, "ru_RU");
assert(legacyModel.level === 4 && legacyModel.chapterId === "chapter.04.routes" && legacyModel.chapterState === "unknown" && legacyModel.isFallback,
  "legacy elder renders a non-mutating chapter fallback from legacy level");
assert(JSON.stringify([...legacyValues.entries()]) === JSON.stringify(legacyBefore), "legacy journal fallback does not modify any property");

const damagedValues = new Map([
  ["village:level", 6], ["village:schema", 2], ["village:v2:chapter", "chapter.06.safe_mine"],
  ["village:v2:chapter:chapter.06.safe_mine", "damaged"]
]);
const damaged = { getDynamicProperty(key) { return damagedValues.get(key); }, isValid: true };
const damagedBefore = [...damagedValues.entries()];
const damagedModel = buildChapterJournalModel(damaged);
assert(damagedModel.level === 6 && damagedModel.chapterState === "unknown" && damagedModel.isFallback,
  "damaged chapter state receives a safe localised fallback model");
assert(JSON.stringify([...damagedValues.entries()]) === JSON.stringify(damagedBefore), "damaged journal read does not repair or write properties");

const invalid = buildChapterJournalModel(null);
assert(invalid.isFallback && invalid.errorKey === JOURNAL_KEYS.safeError && invalid.level === null,
  "invalid elder returns a safe error model without throwing");
const invalidLevelValues = new Map([["village:level", 11]]);
const invalidLevel = { getDynamicProperty(key) { return invalidLevelValues.get(key); }, isValid: true };
assert(buildChapterJournalModel(invalidLevel).isFallback, "future runtime level returns a safe model rather than activating level 11");

console.log("\n=== UI cancellation and back safety ===");
const keys = ["village:level", "village:schema", "village:v2:chapter", "village:v2:chapter:chapter.10.safe_roads"];
const beforeCancel = dynamicSnapshot(elder, keys);
const originalShow = ActionFormData.prototype.show;
try {
  ActionFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
  await openVillageJournal(player, elder);
  assert(JSON.stringify(dynamicSnapshot(elder, keys)) === JSON.stringify(beforeCancel), "canceled journal form changes no chapter or level state");

  let shows = 0;
  ActionFormData.prototype.show = async () => {
    shows++;
    return shows === 1 ? { canceled: false, selection: 0 } : { canceled: true, selection: 0 };
  };
  await openVillageJournal(player, elder);
  assert(shows === 2, "back navigation returns to the elder menu exactly once");
  assert(JSON.stringify(dynamicSnapshot(elder, keys)) === JSON.stringify(beforeCancel), "back navigation changes no chapter or level state");
} finally {
  ActionFormData.prototype.show = originalShow;
}

console.log(failures === 0 ? "\nALL CHAPTER JOURNAL TESTS PASSED" : `\n${failures} CHAPTER JOURNAL TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
