import {
  LEVEL_CHAPTERS,
  SPECIAL_ARCS,
  ARC_AVAILABILITY,
  chapterForLevel,
  availableArcIdsForLevel,
  finalReadyArcIdsForLevel,
  validateQuestContract
} from "./scripts/quest_contract_v2.js";

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error("FAIL:", message);
  } else {
    console.log("ok:", message);
  }
}

function sameArray(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

console.log("\n=== chapter lookup boundaries ===");
for (let level = 1; level <= 20; level++) {
  const chapter = chapterForLevel(level);
  assert(chapter?.level === level, `level ${level} resolves to its chapter`);
}
for (const invalid of [0, -1, 1.5, 20.5, 21, "1", null, undefined, NaN]) {
  assert(chapterForLevel(invalid) === null, `invalid chapter level ${String(invalid)} resolves to null`);
}
assert(LEVEL_CHAPTERS.slice(0, 15).every((chapter, index) =>
  chapter.level === index + 1 && chapter.id === `chapter.${String(index + 1).padStart(2, "0")}.${chapter.id.split(".").slice(2).join(".")}` &&
  chapter.giverRoleId && chapter.objective?.type && chapter.repeatPolicy &&
  Object.values(chapter.localization).every((key) => key.startsWith("growing_villages.")) &&
  chapter.onComplete?.description === "future_state_marker_only"
), "chapters 1-15 have stable IDs, data shape, localisation and marker-only completion");

console.log("\n=== availability metadata ===");
const craftsman = ["arc.farmer", "arc.blacksmith", "arc.cartographer", "arc.miner"];
const special = ["special.roots_of_the_road", "special.oath_of_care", "special.tools_for_all"];
assert(sameArray(availableArcIdsForLevel(1), []), "level 1 opens no quest metadata");
assert(sameArray(availableArcIdsForLevel(2), [craftsman[0]]), "level 2 opens farmer metadata");
assert(sameArray(availableArcIdsForLevel(3), craftsman.slice(0, 2)), "level 3 adds blacksmith metadata");
assert(sameArray(availableArcIdsForLevel(4), craftsman.slice(0, 3)), "level 4 adds cartographer metadata");
assert(sameArray(availableArcIdsForLevel(5), craftsman.slice(0, 3)), "level 5 opens no extra craftsman metadata");
assert(sameArray(availableArcIdsForLevel(6), craftsman), "level 6 adds miner metadata");
assert(sameArray(availableArcIdsForLevel(7), craftsman), "level 7 preserves available craftsman metadata");
assert(sameArray(availableArcIdsForLevel(8), craftsman),
  "level 8 does not expose planned special arcs through current availability metadata");
assert(sameArray(availableArcIdsForLevel(15), craftsman), "level 15 still exposes only legacy craftsman metadata");
assert(sameArray(finalReadyArcIdsForLevel(8), []), "level 8 does not mark special finals ready");
assert(sameArray(finalReadyArcIdsForLevel(15), []), "level 15 does not mark planned special finals ready");
assert(sameArray(finalReadyArcIdsForLevel(20), []), "future contract levels do not activate specials before a runtime integration stage");
assert(SPECIAL_ARCS.every((arc) => special.includes(arc.arcId) && arc.runtimeStatus === "planned"), "planned special records stay canonical but unavailable to current runtime helpers");
for (const invalid of [0, -1, 1.5, "8", null, undefined]) {
  assert(sameArray(availableArcIdsForLevel(invalid), []), `invalid availability level ${String(invalid)} returns no arcs`);
  assert(sameArray(finalReadyArcIdsForLevel(invalid), []), `invalid final-ready level ${String(invalid)} returns no arcs`);
}
assert(ARC_AVAILABILITY.length === 4, "availability data contains only four current legacy role arcs");
assert(SPECIAL_ARCS.every((arc) => !Object.hasOwn(arc.onComplete, "buildNow") && !Object.hasOwn(arc.onComplete, "builder")),
  "special metadata does not expose a direct builder instruction");

console.log("\n=== contract validation ===");
const validation = validateQuestContract();
assert(validation.ok && validation.errors.length === 0, "extended quest contract validates without errors");
const damagedAvailability = ARC_AVAILABILITY.map((entry) => ({ ...entry }));
damagedAvailability[0] = { ...damagedAvailability[0], arcId: damagedAvailability[1].arcId };
const damaged = validateQuestContract({ arcAvailability: damagedAvailability });
assert(!damaged.ok && damaged.errors.some((error) => error.startsWith("arc_availability:duplicate_or_missing:")),
  "validator diagnoses duplicate availability metadata");

console.log(failures === 0 ? "\nALL QUEST AVAILABILITY TESTS PASSED" : `\n${failures} QUEST AVAILABILITY TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
