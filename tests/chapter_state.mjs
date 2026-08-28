import { __test__ } from "@minecraft/server";
import { foundVillage, getVillageState, tryLevelUp } from "./scripts/village.js";
import { LEVELS } from "./scripts/levels.js";
import {
  QUEST_STATE_SCHEMA_VERSION,
  ensureVillageChapterState,
  setVillageChapterForLevel,
  getVillageChapterState,
  chapterForVillageLevel,
  isKnownQuestState
} from "./scripts/chapter_state.js";

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

console.log("\n=== new village chapter state ===");
const dim = __test__.makeDimension();
const player = __test__.makePlayer("ChapterStateTester", { x: 130000, y: 70, z: 130000 });
player.dimension = dim;
const elder = foundVillage(player, { x: 130000, y: 70, z: 130000 }, 0);
const created = getVillageChapterState(elder);
assert(elder.getDynamicProperty("village:schema") === QUEST_STATE_SCHEMA_VERSION, "new elder stores schema version 2");
assert(created.ok && created.chapterId === "chapter.01.foundation" && created.state === "open",
  "new village opens chapter.01.foundation");
assert(elder.getDynamicProperty("village:v2:chapter:chapter.01.foundation") === "open",
  "new village persists the active chapter flag");
assert(ensureVillageChapterState(elder).chapterId === "chapter.01.foundation",
  "repeat initialization is idempotent for a new village");

console.log("\n=== level 1 through 10 transitions ===");
for (let level = 2; level <= 10; level++) {
  const previousId = chapterForVillageLevel(level - 1);
  const nextId = chapterForVillageLevel(level);
  fillRequirements(elder, level);
  const result = tryLevelUp(elder);
  const current = getVillageChapterState(elder);
  assert(result.done && result.leveledUpTo === level, `level ${level} builds through the normal pipeline`);
  assert(result.chapterId === nextId, `level ${level} result reports ${nextId}`);
  assert(elder.getDynamicProperty(`village:v2:chapter:${previousId}`) === "complete",
    `level ${level} marks ${previousId} complete`);
  assert(current.ok && current.chapterId === nextId && current.state === "open",
    `level ${level} opens ${nextId}`);
}

console.log("\n=== failed and legacy-terminal transitions ===");
// This chapter-owner regression remains scoped to the unchanged L1–10
// chapter adapter. A keyless elder is legacy, so L10 is blocked safely rather
// than silently entering architecture-owned city progression.
elder.setDynamicProperty("village:layoutVersion", undefined);
const finalChapter = getVillageChapterState(elder);
const terminal = tryLevelUp(elder);
assert(!terminal.done && terminal.error === "legacy_layout_max", "legacy level 10 remains safely capped without chapter activation");
assert(JSON.stringify(getVillageChapterState(elder)) === JSON.stringify(finalChapter),
  "legacy-terminal level-up attempt leaves chapter state unchanged");

const emptyPlayer = __test__.makePlayer("EmptyChestTester", { x: 140000, y: 70, z: 140000 });
emptyPlayer.dimension = dim;
const emptyElder = foundVillage(emptyPlayer, { x: 140000, y: 70, z: 140000 }, 1);
const beforeEmpty = getVillageChapterState(emptyElder);
const failed = tryLevelUp(emptyElder);
assert(!failed.done && getVillageState(emptyElder).level === 1, "empty chest does not raise village level");
assert(JSON.stringify(getVillageChapterState(emptyElder)) === JSON.stringify(beforeEmpty),
  "empty chest does not change active chapter");

console.log("\n=== lazy legacy and neutral safety ===");
const legacy = dim.spawnEntity("minecraft:villager_v2", { x: 150000, y: 70, z: 150000 });
legacy.setDynamicProperty("village:level", 6);
legacy.setDynamicProperty("quest_step", 3);
legacy.setDynamicProperty("village:discount:8:minecraft:cobblestone", 24);
legacy.setDynamicProperty("village:specialQuest:ranger", 1);
legacy.setDynamicProperty("village:specialBuilt:ranger", false);
const legacyResult = ensureVillageChapterState(legacy);
assert(legacyResult.ok && legacyResult.chapterId === "chapter.06.safe_mine" && legacyResult.state === "open",
  "legacy elder lazily derives chapter.06.safe_mine from village:level");
assert(legacy.getDynamicProperty("quest_step") === 3, "lazy init preserves legacy quest_step");
assert(legacy.getDynamicProperty("village:discount:8:minecraft:cobblestone") === 24, "lazy init preserves legacy discounts");
assert(legacy.getDynamicProperty("village:specialQuest:ranger") === 1, "lazy init preserves legacy special quest progress");
assert(legacy.getDynamicProperty("village:specialBuilt:ranger") === false, "lazy init preserves legacy special build flag");
assert(ensureVillageChapterState(legacy).chapterId === "chapter.06.safe_mine", "legacy lazy init is idempotent");

const partial = dim.spawnEntity("minecraft:villager_v2", { x: 150100, y: 70, z: 150000 });
partial.setDynamicProperty("village:level", 4);
partial.setDynamicProperty("village:schema", QUEST_STATE_SCHEMA_VERSION);
partial.setDynamicProperty("village:v2:chapter", "chapter.04.routes");
partial.setDynamicProperty("village:v2:chapter:chapter.04.routes", "damaged");
assert(ensureVillageChapterState(partial).ok, "partially migrated elder repairs only v2 chapter state");
assert(getVillageChapterState(partial).state === "open", "partially migrated elder gets a safe open active chapter");

const noLevel = dim.spawnEntity("minecraft:villager_v2", { x: 150200, y: 70, z: 150000 });
assert(!ensureVillageChapterState(noLevel).ok, "elder without village:level returns a neutral result");
assert(!setVillageChapterForLevel(null, 1).ok, "invalid elder returns neutral result without throwing");
assert(!setVillageChapterForLevel(legacy, 11).ok, "runtime refuses future level 11 state installation");
const failedWrites = new Map([
  ["village:level", 1],
  ["village:schema", QUEST_STATE_SCHEMA_VERSION],
  ["village:v2:chapter", "chapter.01.foundation"],
  ["village:v2:chapter:chapter.01.foundation", "open"]
]);
const writeFailureElder = {
  getDynamicProperty(key) { return failedWrites.get(key); },
  setDynamicProperty() { throw new Error("simulated state write failure"); }
};
const beforeWriteFailure = getVillageChapterState(writeFailureElder);
const writeFailure = setVillageChapterForLevel(writeFailureElder, 2);
assert(!writeFailure.ok, "state write error returns a neutral result");
assert(JSON.stringify(getVillageChapterState(writeFailureElder)) === JSON.stringify(beforeWriteFailure),
  "state write error leaves prior active chapter unchanged");
assert(writeFailureElder.getDynamicProperty("village:level") === 1, "state write error leaves legacy level unchanged");
assert(getVillageChapterState({}).status === "neutral", "missing property API returns neutral diagnostic");
assert(isKnownQuestState("open") && isKnownQuestState("complete") && !isKnownQuestState("ready_to_build"),
  "only open and complete are recognized runtime chapter states");

console.log(failures === 0 ? "\nALL CHAPTER STATE TESTS PASSED" : `\n${failures} CHAPTER STATE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
