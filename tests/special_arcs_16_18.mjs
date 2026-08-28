import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LEVELS } from "./scripts/levels.js";
import { LEVEL_CHAPTERS, SPECIAL_ARCS, ARC_AVAILABILITY, availableArcIdsForLevel, finalReadyArcIdsForLevel, validateQuestContract } from "./scripts/quest_contract_v2.js";
import { SPECIAL_BUILDINGS } from "./scripts/special_buildings_16_18.js";

let failures = 0;
function assert(condition, message) { if (!condition) { failures++; console.error("FAIL:", message); } else console.log("ok:", message); }
function source(relativePath) { return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"); }
function languageMap(relativePath) {
  const entries = new Map();
  for (const raw of source(relativePath).split(/\r?\n/)) {
    const line = raw.trim(); const separator = line.indexOf("=");
    if (separator > 0) entries.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return entries;
}

const expected = new Map([
  ["special.roots_of_the_road", { level: 16, buildingId: "memorial_grove" }],
  ["special.oath_of_care", { level: 17, buildingId: "village_infirmary" }],
  ["special.tools_for_all", { level: 18, buildingId: "civic_workshop" }]
]);
const forbidden = new Set([
  "minecraft:diamond", "minecraft:emerald", "minecraft:netherite_ingot", "minecraft:netherite_scrap",
  "minecraft:enchanted_golden_apple", "minecraft:diamond_axe", "minecraft:diamond_pickaxe",
  "minecraft:diamond_horse_armor", "minecraft:enchanted_book", "minecraft:potion"
]);
const oldTokens = ["ranger_lodge", "mercy_infirmary", "engineer_workshop", "special.ranger.trail", "special.healer.oath", "special.engineer.axis", "reward.special.ranger.final.iron_axe", "reward.special.healer.final.golden_apple", "reward.special.engineer.final.redstone_lamps"];
const contractSource = source("../GrowingVillages_BP/scripts/quest_contract_v2.js");
const ru = languageMap("../GrowingVillages_RP/texts/ru_RU.lang");
const en = languageMap("../GrowingVillages_RP/texts/en_US.lang");

console.log("\n=== canonical mapping and architecture alignment ===");
assert(SPECIAL_ARCS.length === 3, "exactly three canonical special arc records exist");
assert(new Set(SPECIAL_ARCS.map((arc) => arc.arcId)).size === 3, "canonical special arc IDs are unique");
for (const arc of SPECIAL_ARCS) {
  const approved = expected.get(arc.arcId);
  const architecture = SPECIAL_BUILDINGS.find((building) => building.id === arc.buildingId);
  const chapter = LEVEL_CHAPTERS.find((entry) => entry.level === arc.level);
  assert(!!approved && arc.level === approved.level && arc.minLevel === approved.level && arc.buildingId === approved.buildingId, `${arc.arcId}: exact approved level/building mapping`);
  assert(architecture?.futureLevel === arc.level && architecture.questArcId === arc.arcId, `${arc.arcId}: architecture metadata has matching futureLevel and questArcId`);
  assert(chapter?.questArcId === arc.arcId && chapter.buildingId === arc.buildingId && chapter.runtimeStatus === "planned", `${arc.arcId}: planned chapter metadata is aligned`);
  assert(arc.buildTrigger === "special_arc_complete_then_build" && arc.oneTimePolicy === "once_per_village", `${arc.arcId}: coherent one-time future build trigger`);
}
assert(!/\bbounds\b|\bfootprint\b|\bentryPath\b|\broadLink\b/.test(contractSource), "quest contract contains no architecture coordinates or geometry data");

console.log("\n=== three-step content and balance ===");
for (const arc of SPECIAL_ARCS) {
  assert(arc.steps.length === 3, `${arc.arcId}: exactly three ordered steps`);
  assert(arc.deferredRewardPolicy === "lore_and_build_only", `${arc.arcId}: uses default deferred lore/build policy`);
  for (const [index, step] of arc.steps.entries()) {
    assert(step.number === index + 1 && step.id.endsWith(`step_${String(index + 1).padStart(2, "0")}`), `${arc.arcId}: step ${index + 1} has a stable ordered ID`);
    assert(step.objective?.type === "inventory_turn_in" && step.requirements.length > 0, `${arc.arcId}: step ${index + 1} uses testable inventory objectives`);
    assert(step.requirements.every((requirement) => requirement.itemId.startsWith("minecraft:") && Number.isInteger(requirement.amount) && requirement.amount > 0 && !forbidden.has(requirement.itemId)), `${arc.arcId}: step ${index + 1} avoids forbidden high-tier requirements`);
    assert(Object.values(step.localization).every((key) => key.startsWith("growing_villages.special.")), `${arc.arcId}: step ${index + 1} owns special lore keys`);
  }
}
assert(SPECIAL_ARCS.filter((arc) => arc.deferredRewardPolicy === "rare_utility_cosmetic").length <= 1, "rare utility policy is declared at most once");
assert(SPECIAL_ARCS.every((arc) => !Object.hasOwn(arc, "reward") && !Object.hasOwn(arc, "inventory") && !Object.hasOwn(arc, "currency")), "special data declares no current reward payload, resource faucet or currency");

console.log("\n=== localisation and old-contract removal ===");
const requiredKeys = new Set();
for (const arc of SPECIAL_ARCS) {
  for (const key of [arc.titleKey, arc.summaryKey, arc.completionKey, arc.buildKey, arc.deferredPolicyKey]) requiredKeys.add(key);
  for (const step of arc.steps) for (const key of Object.values(step.localization)) requiredKeys.add(key);
}
assert([...requiredKeys].every((key) => ru.has(key) && en.has(key) && ru.get(key).trim() && en.get(key).trim()), "all special lore keys have non-empty RU and EN text");
assert(![...requiredKeys].some((key) => /^growing_villages\./.test(ru.get(key)) || /^growing_villages\./.test(en.get(key))), "special localisations contain no literal-key leaks");
assert(!oldTokens.some((token) => contractSource.includes(token)), "old L16-18 IDs and obsolete reward references are removed from contract source");
assert(!oldTokens.some((token) => source("../GrowingVillages_RP/texts/ru_RU.lang").includes(token) || source("../GrowingVillages_RP/texts/en_US.lang").includes(token)), "old L16-18 references are removed from localisation files");

console.log("\n=== runtime isolation ===");
assert(!Object.hasOwn(LEVELS, 16) && !Object.hasOwn(LEVELS, 17) && !Object.hasOwn(LEVELS, 18), "current LEVELS runtime has no L16-18 rows");
assert(ARC_AVAILABILITY.length === 4 && !ARC_AVAILABILITY.some((entry) => expected.has(entry.arcId)), "planned specials are not current availability metadata");
assert(JSON.stringify(availableArcIdsForLevel(15)) === JSON.stringify(["arc.farmer", "arc.blacksmith", "arc.cartographer", "arc.miner"]), "L15 active availability remains legacy-only");
assert(JSON.stringify(finalReadyArcIdsForLevel(20)) === JSON.stringify([]), "no planned special final becomes active through current helper");
for (const file of ["main.js", "village.js", "levels.js", "ui.js", "chapter_state.js", "chapter_journal.js"]) {
  const text = source(`../GrowingVillages_BP/scripts/${file}`);
  assert(!text.includes("special_arcs_16_18") && ![...expected.keys()].some((arcId) => text.includes(arcId)), `${file}: has no reference to planned special-arc data`);
}
assert(!/setDynamicProperty|world\.|system\.|addItem|removeItem|buildSpecialBuilding/.test(contractSource), "contract source performs no runtime mutation, inventory action or builder call");
assert(validateQuestContract().ok, "canonical special contract validates");

console.log(failures === 0 ? "\nALL SPECIAL ARCS 16-18 TESTS PASSED" : `\n${failures} SPECIAL ARCS 16-18 TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
