import {
  QUEST_SCHEMA_VERSION,
  CANONICAL_BUILDING_IDS,
  LEVEL_CHAPTERS,
  SPECIAL_ARCS,
  LEGACY_MIGRATION_MAP,
  chapterForLevel,
  buildingForLevel,
  validateQuestContract
} from "./scripts/quest_contract_v2.js";

let failures = 0;
function assert(condition, message) { if (!condition) { failures++; console.error("FAIL:", message); } else console.log("ok:", message); }
const keyPattern = /^growing_villages\.[a-z0-9_.-]+$/;
const canonical = new Set(CANONICAL_BUILDING_IDS);
const expectedSpecials = new Map([
  ["special.roots_of_the_road", [16, "memorial_grove"]],
  ["special.oath_of_care", [17, "village_infirmary"]],
  ["special.tools_for_all", [18, "civic_workshop"]]
]);

console.log("\n=== schema and level chapters ===");
assert(QUEST_SCHEMA_VERSION === 3, "quest schema version is 3 after canonical special-arc replacement");
assert(CANONICAL_BUILDING_IDS.length === 22 && canonical.size === CANONICAL_BUILDING_IDS.length, "all 22 canonical building IDs are declared uniquely");
assert(LEVEL_CHAPTERS.length === 20, "exactly 20 level chapters exist");
assert(JSON.stringify(LEVEL_CHAPTERS.map((entry) => entry.level)) === JSON.stringify(Array.from({ length: 20 }, (_, index) => index + 1)), "level chapters cover 1 through 20 without gaps");
assert(new Set(LEVEL_CHAPTERS.map((entry) => entry.id)).size === 20, "chapter IDs are unique");
assert(LEVEL_CHAPTERS.every((entry) => canonical.has(entry.buildingId) && entry.giverRoleId && entry.objective?.type && entry.repeatPolicy), "every chapter has canonical building and basic data shape");
assert(LEVEL_CHAPTERS.every((entry) => Object.values(entry.localization).every((key) => keyPattern.test(key))), "every chapter localisation key is namespaced");
assert(LEVEL_CHAPTERS.every((entry) => entry.onComplete?.description === "future_state_marker_only"), "chapter completion data contains marker descriptions only");
assert(buildingForLevel(16) === "memorial_grove" && buildingForLevel(17) === "village_infirmary" && buildingForLevel(18) === "civic_workshop", "levels 16-18 resolve only canonical architecture building IDs");
for (const [arcId, [level, buildingId]] of expectedSpecials) {
  const entry = chapterForLevel(level);
  assert(entry?.questArcId === arcId && entry.buildingId === buildingId && entry.minLevel === level, `${arcId}: level chapter has exact canonical mapping`);
  assert(entry.runtimeStatus === "planned" && entry.buildTrigger === "special_arc_complete_then_build", `${arcId}: level chapter remains planned data without active runtime trigger`);
}
assert(chapterForLevel(21) === null && buildingForLevel(0) === null, "out-of-range levels resolve to null");

console.log("\n=== canonical special arcs ===");
assert(SPECIAL_ARCS.length === 3, "exactly three special arcs exist");
assert(new Set(SPECIAL_ARCS.map((arc) => arc.arcId)).size === 3, "special arc IDs are unique");
for (const arc of SPECIAL_ARCS) {
  const expected = expectedSpecials.get(arc.arcId);
  assert(!!expected && arc.level === expected[0] && arc.minLevel === expected[0] && arc.buildingId === expected[1], `${arc.arcId}: has exact approved level and building ID`);
  assert(arc.steps.length === 3 && arc.buildTrigger === "special_arc_complete_then_build" && arc.runtimeStatus === "planned", `${arc.arcId}: is a three-step planned special arc`);
  assert(arc.oneTimePolicy === "once_per_village" && arc.deferredRewardPolicy === "lore_and_build_only", `${arc.arcId}: declares deferred one-time lore/build policy`);
  assert([arc.titleKey, arc.summaryKey, arc.completionKey, arc.buildKey, arc.deferredPolicyKey].every((key) => keyPattern.test(key)), `${arc.arcId}: has complete named localisation keys`);
  for (const [index, step] of arc.steps.entries()) {
    assert(step.number === index + 1 && step.id === `${arc.arcId.slice("special.".length)}.step_${String(index + 1).padStart(2, "0")}`, `${arc.arcId}: step ${index + 1} has stable ordered ID`);
    assert(step.objective?.type === "inventory_turn_in" && step.requirements.length > 0 && step.requirements.every((item) => item.itemId.startsWith("minecraft:") && Number.isInteger(item.amount) && item.amount > 0), `${arc.arcId}: step ${index + 1} has concrete vanilla inventory requirements`);
    assert(Object.values(step.localization).every((key) => keyPattern.test(key)), `${arc.arcId}: step ${index + 1} has namespaced lore keys`);
  }
}

console.log("\n=== no special migration aliases ===");
assert(Object.hasOwn(LEGACY_MIGRATION_MAP, "quest_step") && Object.hasOwn(LEGACY_MIGRATION_MAP, "discounts"), "long-lived L1-10 migration documentation remains");
assert(!Object.hasOwn(LEGACY_MIGRATION_MAP, "specialQuest") && !Object.hasOwn(LEGACY_MIGRATION_MAP, "specialBuiltAliases"), "planned L16-18 arcs define no aliases or migration paths");

console.log("\n=== validator ===");
const validation = validateQuestContract();
assert(validation.ok && validation.errors.length === 0, "current canonical quest contract validates with zero errors");
const damaged = SPECIAL_ARCS.map((arc) => ({ ...arc }));
damaged[0] = { ...damaged[0], buildingId: "invalid_building" };
const damagedValidation = validateQuestContract({ specialArcs: damaged });
assert(!damagedValidation.ok && damagedValidation.errors.some((error) => error === "special_arcs:canonical_mismatch:special.roots_of_the_road"), "validator diagnoses a damaged canonical special mapping");

console.log(failures === 0 ? "\nALL QUEST CONTRACT V2 TESTS PASSED" : `\n${failures} QUEST CONTRACT V2 TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
