import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EXTENSION_LEVELS, EXTENSION_BUILDING_IDS, EXTENSION_STATE_PREFIX,
  extensionProgressionForLevel, buildRequestForLevel, readExtensionProgression,
  planSpecialArcAdvance, planBuildCommit, validateExtensionContract
} from "./scripts/progression_16_20.js";
import { LEVEL_CHAPTERS, SPECIAL_ARCS } from "./scripts/quest_contract_v2.js";
import { LEVELS } from "./scripts/levels.js";

let failures = 0;
function assert(condition, message) { if (!condition) { failures++; console.error("FAIL:", message); } else console.log("ok:", message); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function source(relativePath) { return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"); }
function reader(values) { return { get(key) { return values[key]; } }; }
function readySnapshot(state, level) {
  return Object.freeze({ ...state, levelReady: Object.freeze({ ...state.levelReady, [level]: true }) });
}

const expected = Object.freeze([
  Object.freeze({ level: 16, chapterId: "chapter.16.roots_of_the_road", buildingId: "memorial_grove", progressKind: "special_arc_complete_then_build", arcId: "special.roots_of_the_road" }),
  Object.freeze({ level: 17, chapterId: "chapter.17.oath_of_care", buildingId: "village_infirmary", progressKind: "special_arc_complete_then_build", arcId: "special.oath_of_care" }),
  Object.freeze({ level: 18, chapterId: "chapter.18.tools_for_all", buildingId: "civic_workshop", progressKind: "special_arc_complete_then_build", arcId: "special.tools_for_all" }),
  Object.freeze({ level: 19, chapterId: "chapter.19.founders_assembly", buildingId: "founders_hall", progressKind: "town_hall_deposit_then_build", arcId: null }),
  Object.freeze({ level: 20, chapterId: "chapter.20.light_of_the_village", buildingId: "village_beacon", progressKind: "town_hall_deposit_then_build", arcId: null })
]);
const requirements = new Map([
  [19, [["minecraft:stone_bricks", 256], ["minecraft:dark_oak_planks", 128], ["minecraft:bookshelf", 24], ["minecraft:lantern", 16]]],
  [20, [["minecraft:stone_bricks", 320], ["minecraft:dark_oak_log", 96], ["minecraft:soul_lantern", 16], ["minecraft:glass_pane", 24]]]
]);
const forbidden = new Set(["minecraft:diamond", "minecraft:emerald", "minecraft:netherite_ingot", "minecraft:netherite_scrap", "minecraft:enchanted_golden_apple", "minecraft:diamond_axe", "minecraft:diamond_pickaxe", "minecraft:diamond_horse_armor", "minecraft:enchanted_book", "minecraft:potion"]);

console.log("\n=== canonical L16-L20 mapping ===");
assert(same(EXTENSION_LEVELS, [16, 17, 18, 19, 20]), "extension levels are exactly 16 through 20");
assert(same(EXTENSION_BUILDING_IDS, expected.map((entry) => entry.buildingId)), "extension building IDs use exact shared architecture order");
assert(EXTENSION_STATE_PREFIX === "village:v2:extension", "extension state prefix is stable and namespaced");
for (const entry of expected) {
  const plan = extensionProgressionForLevel(entry.level);
  const chapter = LEVEL_CHAPTERS.find((candidate) => candidate.level === entry.level);
  assert(Object.isFrozen(plan) && plan?.chapterId === entry.chapterId && plan.buildingId === entry.buildingId && plan.progressKind === entry.progressKind && plan.arcId === entry.arcId, `level ${entry.level}: immutable canonical progression plan matches contract`);
  assert(same(buildRequestForLevel(entry.level), { buildingId: entry.buildingId, level: entry.level, paletteId: undefined }), `level ${entry.level}: exact shared build request has no palette override`);
  assert(Object.isFrozen(buildRequestForLevel(entry.level)), `level ${entry.level}: build request is frozen`);
  assert(chapter?.id === entry.chapterId && chapter.buildingId === entry.buildingId && chapter.progressKind === entry.progressKind, `level ${entry.level}: chapter owner contract matches progression`);
}
assert(extensionProgressionForLevel(15) === null && buildRequestForLevel(21) === null, "out-of-range extension requests resolve to null");
assert(!LEVELS[16] && !LEVELS[17] && !LEVELS[18] && !LEVELS[19] && !LEVELS[20], "current runtime LEVELS remains unchanged at L1-L15");
assert(![...LEVEL_CHAPTERS.slice(15)].some((entry) => /common_good|council|commons_infrastructure|grand_council_hall/.test(`${entry.id}:${entry.buildingId}`)), "active L16-L20 contract contains no retired final-city IDs");

console.log("\n=== requirements and deferred policies ===");
for (const level of [19, 20]) {
  const plan = extensionProgressionForLevel(level);
  assert(same(plan.requirements.map((entry) => [entry.itemId, entry.amount]), requirements.get(level)), `L${level}: has exact canonical town-hall requirements`);
  assert(plan.requirements.every((entry) => entry.itemId.startsWith("minecraft:") && Number.isInteger(entry.amount) && entry.amount > 0 && !forbidden.has(entry.itemId)), `L${level}: requirements are positive vanilla items outside forbidden high-tier set`);
  assert(plan.deferredRewardPolicy === "lore_and_build_only" && plan.oneTimePolicy === "once_per_village", `L${level}: has lore/build-only one-time reward policy`);
}
for (const arc of SPECIAL_ARCS) assert(arc.steps.length === 3 && arc.deferredRewardPolicy === "lore_and_build_only", `${arc.arcId}: preserves three declarative steps and lore/build-only policy`);
assert(validateExtensionContract().ok, "extension contract validates canonical mapping and requirements");

console.log("\n=== reader and illegal transition safety ===");
const raw = { "village:level": 15 };
const initial = readExtensionProgression(reader(raw));
assert(initial.valid && initial.baseLevel === 15, "plain reader yields a valid L15 extension snapshot");
const beforeIllegal = JSON.stringify(initial);
assert(planSpecialArcAdvance(initial, "special.oath_of_care", 1).error === "extension_prior_level_not_committed", "L15 cannot skip directly to special level 17");
assert(planSpecialArcAdvance(initial, "special.roots_of_the_road", 2).error === "extension_step_out_of_order", "special step 2 is rejected before step 1");
assert(planBuildCommit(initial, 16).error === "extension_special_arc_not_ready", "special build is rejected before final arc step");
assert(planBuildCommit(initial, 20).error === "extension_prior_level_not_committed", "L20 is rejected while L19 is not committed");
assert(planBuildCommit(initial, 99).error === "extension_level_unknown", "noncanonical build level is rejected");
assert(JSON.stringify(initial) === beforeIllegal, "all rejected transition plans leave input snapshot unchanged");
const corrupt = readExtensionProgression(reader({ "village:level": 15, "village:v2:extension:arc:special.roots_of_the_road:step": 9 }));
assert(!corrupt.valid && planSpecialArcAdvance(corrupt, "special.roots_of_the_road", 1).error === "extension_state_invalid", "corrupt state is rejected without a mutation plan");

console.log("\n=== valid abstract L15 through L20 sequence ===");
let state = initial;
for (const entry of expected.slice(0, 3)) {
  for (const step of [1, 2, 3]) {
    const result = planSpecialArcAdvance(state, entry.arcId, step);
    assert(result.ok && result.step === step && Object.isFrozen(result), `L${entry.level}: special step ${step} returns immutable plan`);
    if (step === 3) assert(same(result.request, { buildingId: entry.buildingId, level: entry.level, paletteId: undefined }), `L${entry.level}: final special step yields only canonical ready build request`);
    state = result.nextState;
  }
  const commit = planBuildCommit(state, entry.level);
  assert(commit.ok && same(commit.request, { buildingId: entry.buildingId, level: entry.level, paletteId: undefined }), `L${entry.level}: ready arc commits only a canonical build plan`);
  assert(planBuildCommit(commit.nextState, entry.level).error === "extension_level_already_committed", `L${entry.level}: duplicate commit is rejected`);
  state = commit.nextState;
}
for (const entry of expected.slice(3)) {
  assert(planBuildCommit(state, entry.level).error === "extension_town_hall_requirements_not_ready", `L${entry.level}: commit waits for abstract town-hall readiness`);
  state = readySnapshot(state, entry.level);
  const commit = planBuildCommit(state, entry.level);
  assert(commit.ok && same(commit.request, { buildingId: entry.buildingId, level: entry.level, paletteId: undefined }), `L${entry.level}: ready town-hall plan returns canonical request`);
  state = commit.nextState;
}
assert(state.baseLevel === 20 && state.levelCommitted[20], "valid pure sequence reaches committed abstract L20 state");

console.log("\n=== pure-module isolation ===");
const pureSource = source("../GrowingVillages_BP/scripts/progression_16_20.js");
assert(!/world\.|system\.|ItemStack|getComponent|addItem|removeItem|setDynamicProperty|spawnEntity|buildPlannedVillageBuilding|final_city_19_20/.test(pureSource), "pure progression module contains no prohibited runtime calls or architecture import");
for (const runtimeFile of ["main.js", "village.js", "levels.js", "ui.js", "chapter_state.js", "chapter_journal.js"]) {
  assert(!source(`../GrowingVillages_BP/scripts/${runtimeFile}`).includes("progression_16_20"), `${runtimeFile}: does not import planned progression module`);
}

console.log(failures === 0 ? "\nALL PROGRESSION 16-20 TESTS PASSED" : `\n${failures} PROGRESSION 16-20 TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
