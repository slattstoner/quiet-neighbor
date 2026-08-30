import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ItemStack, __test__ } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { LEVEL_CHAPTERS, SPECIAL_ARCS } from "./scripts/quest_contract_v2.js";
import { extensionLevelCommittedKey, extensionLevelReadyKey } from "./scripts/progression_16_20.js";
import { plannedBuildStateKey } from "./scripts/planned_build_transaction.js";
import { foundVillage, getVillageState } from "./scripts/village.js";
import { tryAdvanceSpecialArcStep, tryCommitExtensionBuild, EXTENSION_CHAPTER_KEY } from "./scripts/extension_runtime_16_18.js";
import {
  FINAL_RUNTIME_LEVELS,
  finalCityMenuAvailable,
  getFinalCityStatus,
  tryCommitFinalCityBuild,
  tryDepositFinalCityRequirements
} from "./scripts/final_runtime_19_20.js";
import { openElderMenu, openFinalCityMenu } from "./scripts/ui.js";

let failures = 0;
let checks = 0;
function assert(condition, message) {
  checks++;
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}
function source(relativePath) { return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"); }

const CANON = new Map([
  [19, { buildingId: "founders_hall", chapterId: "chapter.19.founders_assembly" }],
  [20, { buildingId: "village_beacon", chapterId: "chapter.20.light_of_the_village" }]
]);

let siteX = 400000;
function makeVillage(level = 15) {
  siteX += 4000;
  const origin = { x: siteX, y: 70, z: 400000 };
  const player = __test__.makePlayer(`Final${siteX}`, origin);
  const elder = foundVillage(player, origin, 0);
  elder.setDynamicProperty("village:level", level);
  return { player, elder, origin };
}

function chestContainer(elder) {
  const state = getVillageState(elder);
  const block = elder.dimension.getBlock(state.chest);
  return block.getComponent("minecraft:inventory").container;
}

function clearChest(elder) {
  const container = chestContainer(elder);
  for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined);
  return container;
}

function fillChest(elder, requirements) {
  const container = clearChest(elder);
  let slot = 0;
  for (const requirement of requirements) container.setItem(slot++, new ItemStack(requirement.itemId, requirement.amount));
  return container;
}

function chestTotals(container) {
  const totals = {};
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack) totals[stack.typeId] = (totals[stack.typeId] || 0) + stack.amount;
  }
  return totals;
}

function requirementsFor(level) {
  return LEVEL_CHAPTERS.find((chapter) => chapter.level === level).requirements;
}

/** Advances a fresh L15 elder through the L16-18 coordinator up to committed L18. */
function advanceThroughL18(player, elder) {
  for (const arc of SPECIAL_ARCS) {
    for (const step of arc.steps) {
      const chestOrPlayer = player.getComponent("minecraft:inventory").container;
      for (let slot = 0; slot < chestOrPlayer.size; slot++) chestOrPlayer.setItem(slot, undefined);
      let slot = 0;
      for (const requirement of step.requirements) chestOrPlayer.setItem(slot++, new ItemStack(requirement.itemId, requirement.amount));
      const advance = tryAdvanceSpecialArcStep(elder, player, step.id, { warn() {} });
      if (!advance.ok) throw new Error(`setup: L16-18 arc step failed: ${advance.reason}`);
    }
    const commit = tryCommitExtensionBuild(elder, { warn() {} });
    if (!commit.ok) throw new Error(`setup: L16-18 commit failed: ${commit.reason}`);
  }
}

function stateFingerprint(elder, level) {
  const canon = CANON.get(level);
  return JSON.stringify({
    villageLevel: elder.getDynamicProperty("village:level"),
    ready: elder.getDynamicProperty(extensionLevelReadyKey(level)),
    committed: elder.getDynamicProperty(extensionLevelCommittedKey(level)),
    build: elder.getDynamicProperty(plannedBuildStateKey(canon.buildingId)),
    chapter: elder.getDynamicProperty(EXTENSION_CHAPTER_KEY)
  });
}

console.log("\n=== activation scope ===");
assert(JSON.stringify(FINAL_RUNTIME_LEVELS) === JSON.stringify([19, 20]), "coordinator activates exactly L19 and L20");

console.log("\n=== preconditions and safe refusals ===");
{
  const { player, elder } = makeVillage(15);
  const status = getFinalCityStatus(elder);
  assert(!status.ok && status.reason === "extension_prior_level_not_committed",
    "an L15 village (L16-18 not yet done) cannot open L19 final-city progression");
  assert(finalCityMenuAvailable(elder) === false, "elder menu offers no great-works entry before L18 is committed");
}
{
  const { player, elder } = makeVillage(15);
  elder.setDynamicProperty("village:layoutVersion", undefined);
  const status = getFinalCityStatus(elder);
  assert(!status.ok && status.reason === "extension_layout_unsupported", "legacy village is refused before any planner decision");
}
{
  const { player, elder } = makeVillage(15);
  advanceThroughL18(player, elder);
  const status = getFinalCityStatus(elder);
  assert(status.ok && status.status === "deposit_pending" && status.level === 19,
    "an L18-committed village opens L19 deposit");
  assert(finalCityMenuAvailable(elder) === true, "elder menu offers the great-works entry once L18 is committed");
  assert(status.buildingId === "founders_hall" && status.chapterId === "chapter.19.founders_assembly",
    "canonical L19 building and chapter identity are used");
  assert(JSON.stringify(status.requirements) === JSON.stringify(requirementsFor(19)),
    "L19 deposit requirements match the canonical chapter contract exactly");
}

console.log("\n=== deposit phase ===");
{
  const { player, elder } = makeVillage(15);
  advanceThroughL18(player, elder);
  const requirements = requirementsFor(19);
  const container = fillChest(elder, requirements.map((r) => ({ itemId: r.itemId, amount: r.amount - 1 })));
  const before = chestTotals(container);
  const result = tryDepositFinalCityRequirements(elder, { warn() {} });
  assert(!result.ok && result.reason === "extension_not_enough", "an underfilled chest is refused");
  assert(JSON.stringify(chestTotals(container)) === JSON.stringify(before), "an underfilled deposit consumes nothing");
  assert(elder.getDynamicProperty(extensionLevelReadyKey(19)) === undefined, "an underfilled deposit writes no ready flag");
}
{
  const { player, elder } = makeVillage(15);
  advanceThroughL18(player, elder);
  const requirements = requirementsFor(19);
  const container = fillChest(elder, requirements);
  const result = tryDepositFinalCityRequirements(elder, { warn() {} });
  assert(result.ok && result.level === 19, "an exact deposit is accepted");
  assert(Object.keys(chestTotals(container)).length === 0, "an exact deposit consumes precisely the declared items");
  assert(elder.getDynamicProperty(extensionLevelReadyKey(19)) === true, "deposit writes the canonical L19 ready flag");
  assert(elder.getDynamicProperty("village:level") === 18, "deposit alone never changes the village level");
  assert(elder.getDynamicProperty(extensionLevelCommittedKey(19)) === undefined, "deposit alone never commits the level");

  const repeat = tryDepositFinalCityRequirements(elder, { warn() {} });
  assert(!repeat.ok && repeat.reason === "extension_level_already_ready", "a second deposit is refused idempotently");
}
{
  const { player, elder } = makeVillage(15);
  advanceThroughL18(player, elder);
  const requirements = requirementsFor(19);
  const container = fillChest(elder, [...requirements, { itemId: "minecraft:torch", amount: 4 }]);
  const before = chestTotals(container);
  const original = elder.setDynamicProperty.bind(elder);
  elder.setDynamicProperty = (key, value) => {
    if (key === extensionLevelReadyKey(19)) throw new Error("simulated ready-flag write failure");
    return original(key, value);
  };
  const result = tryDepositFinalCityRequirements(elder, { warn() {} });
  elder.setDynamicProperty = original;
  assert(!result.ok && result.reason === "extension_state_write_failed", "a failed ready-flag write is reported");
  assert(JSON.stringify(chestTotals(container)) === JSON.stringify(before),
    "a failed ready-flag write restores the chest exactly, including the untouched extra item");
}

console.log("\n=== build commit, exact request and failure isolation ===");
{
  const { player, elder } = makeVillage(15);
  advanceThroughL18(player, elder);
  const before = tryCommitFinalCityBuild(elder, { warn() {} });
  assert(!before.ok && before.reason === "extension_town_hall_requirements_not_ready",
    "the build action refuses before the deposit is ready");

  fillChest(elder, requirementsFor(19));
  tryDepositFinalCityRequirements(elder, { warn() {} });

  const requests = [];
  const fingerprint = stateFingerprint(elder, 19);
  const failed = tryCommitFinalCityBuild(elder, {
    warn() {},
    dispatch(targetElder, request) { requests.push(request); return { done: false, recoverable: true, error: "planned_build_failed" }; }
  });
  assert(requests.length === 1 &&
    JSON.stringify(requests[0]) === JSON.stringify({ buildingId: "founders_hall", level: 19 }) &&
    Object.hasOwn(requests[0], "paletteId") && requests[0].paletteId === undefined,
    "the dispatcher receives exactly { buildingId, level, paletteId: undefined } for founders_hall");
  assert(!failed.ok && failed.reason === "planned_build_failed" && failed.recoverable === true,
    "a builder failure is reported as recoverable");
  assert(stateFingerprint(elder, 19) === fingerprint, "a failed build changes no level, chapter or committed flag");

  const success = tryCommitFinalCityBuild(elder, {
    warn() {},
    buildFinal(dimension, origin, facing, buildingId) {
      return { id: buildingId, connector: { axis: "forward", width: 2, bounds: { fMin: -38, fMax: -37, sMin: -3, sMax: -2 } } };
    }
  });
  assert(success.ok && success.level === 19 && success.buildingId === "founders_hall", "L19 commits after a confirmed build");
  assert(elder.getDynamicProperty("village:level") === 19, "village level advances only after the confirmed build");
  assert(elder.getDynamicProperty(extensionLevelCommittedKey(19)) === true, "canonical committed flag is set for L19");
  assert(elder.getDynamicProperty(EXTENSION_CHAPTER_KEY) === "chapter.19.founders_assembly", "extension chapter records L19");
  assert(elder.getDynamicProperty(plannedBuildStateKey("founders_hall")) === 2, "physical marker reaches state 2");
}
{
  const { player, elder } = makeVillage(15);
  advanceThroughL18(player, elder);
  fillChest(elder, requirementsFor(19));
  tryDepositFinalCityRequirements(elder, { warn() {} });
  elder.setDynamicProperty(plannedBuildStateKey("founders_hall"), 1);
  const stale = tryCommitFinalCityBuild(elder, { warn() {} });
  assert(!stale.ok && stale.reason === "queued_build_recovered", "a stale queued build is recovered, not committed");
  assert(elder.getDynamicProperty(plannedBuildStateKey("founders_hall")) === 0, "recovery resets the physical marker to 0");
  const retry = tryCommitFinalCityBuild(elder, { warn() {} });
  assert(retry.ok && retry.level === 19 && retry.repaired === false, "the explicit retry after recovery builds normally");
}
{
  const { player, elder } = makeVillage(15);
  advanceThroughL18(player, elder);
  fillChest(elder, requirementsFor(19));
  tryDepositFinalCityRequirements(elder, { warn() {} });
  elder.setDynamicProperty(plannedBuildStateKey("founders_hall"), 2);
  let builds = 0;
  const repaired = tryCommitFinalCityBuild(elder, { warn() {}, buildFinal() { builds++; return null; } });
  assert(repaired.ok && repaired.repaired === true && builds === 0,
    "an interrupted commit is repaired without constructing a second building");
  assert(elder.getDynamicProperty("village:level") === 19, "the repair path finishes the level commit");
}
{
  const { player, elder } = makeVillage(15);
  advanceThroughL18(player, elder);
  fillChest(elder, requirementsFor(19));
  tryDepositFinalCityRequirements(elder, { warn() {} });
  elder.setDynamicProperty(plannedBuildStateKey("founders_hall"), 73);
  const result = tryCommitFinalCityBuild(elder, { warn() {} });
  assert(!result.ok && result.reason === "extension_build_state_corrupt", "a corrupt physical build marker refuses the commit");
  assert(elder.getDynamicProperty("village:level") === 18, "a corrupt marker never levels the village past L18");
}

console.log("\n=== full L19-L20 sequence, idempotency and beyond-L20 isolation ===");
{
  const { player, elder } = makeVillage(15);
  advanceThroughL18(player, elder);
  for (const level of [19, 20]) {
    const canon = CANON.get(level);
    fillChest(elder, requirementsFor(level));
    const deposit = tryDepositFinalCityRequirements(elder, { warn() {} });
    assert(deposit.ok, `L${level} deposit accepted`);
    const build = tryCommitFinalCityBuild(elder, { warn() {} });
    assert(build.ok && build.level === level && build.buildingId === canon.buildingId, `L${level} commits with its canonical building`);
    assert(elder.getDynamicProperty(EXTENSION_CHAPTER_KEY) === canon.chapterId, `L${level} records chapter ${canon.chapterId}`);
  }
  assert(getVillageState(elder).level === 20, "the village reaches level 20 through the coordinator");
  const done = getFinalCityStatus(elder);
  assert(done.ok && done.status === "complete" && done.level === null, "after L20 the coordinator reports completion");
  assert(finalCityMenuAvailable(elder) === false, "no elder entry is offered once L20 is committed");
  const beyond = tryCommitFinalCityBuild(elder, { warn() {} });
  assert(!beyond.ok && beyond.reason === "extension_all_committed", "no build is offered above L20");
  const beyondDeposit = tryDepositFinalCityRequirements(elder, { warn() {} });
  assert(!beyondDeposit.ok, "no deposit is offered above L20");
}

console.log("\n=== elder UI surface ===");
{
  const originalButton = ActionFormData.prototype.button;
  const originalActionShow = ActionFormData.prototype.show;
  const originalMessageShow = MessageFormData.prototype.show;
  let rendered = [];
  ActionFormData.prototype.button = function (label) { rendered.push(label); return originalButton.call(this, label); };
  MessageFormData.prototype.show = async () => ({ canceled: false, selection: 0 });
  const labelOf = (entry) => (entry && typeof entry === "object" ? entry.translate : entry);

  try {
    const ready = makeVillage(15);
    advanceThroughL18(ready.player, ready.elder);
    ActionFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    rendered = [];
    await openElderMenu(ready.player, ready.elder);
    const FINAL_BUTTON = "growing_villages.ui.elder.final.button";
    // Found by label rather than by index: the elder menu gains buttons as the
    // mod grows, and this test is about which button appears, not where.
    const finalIndex = rendered.findIndex((entry) => labelOf(entry) === FINAL_BUTTON);
    assert(finalIndex >= 0, "an L18-committed village gains the great-works button");
    assert(!rendered.some((entry) => labelOf(entry) === "growing_villages.ui.elder.special.button"),
      "the L16-18 button never appears once that stage is fully committed");

    let call = 0;
    ActionFormData.prototype.show = async () => (++call === 1 ? { canceled: false, selection: finalIndex } : { canceled: false, selection: 0 });
    fillChest(ready.elder, requirementsFor(19));
    await openElderMenu(ready.player, ready.elder);
    assert(ready.elder.getDynamicProperty(extensionLevelReadyKey(19)) === true, "confirming the deposit form writes the ready flag");
    assert(ready.elder.getDynamicProperty("village:level") === 18, "the deposit step through the UI never changes the village level");

    const mid = makeVillage(15);
    ActionFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    rendered = [];
    await openElderMenu(mid.player, mid.elder);
    assert(!rendered.some((entry) => labelOf(entry) === "growing_villages.ui.elder.final.button"),
      "a village mid L16-18 never sees the great-works button");
  } finally {
    ActionFormData.prototype.button = originalButton;
    ActionFormData.prototype.show = originalActionShow;
    MessageFormData.prototype.show = originalMessageShow;
  }
}

console.log("\n=== module ownership boundaries ===");
{
  const coordinator = source("../GrowingVillages_BP/scripts/final_runtime_19_20.js");
  assert(coordinator.includes("./progression_16_20.js") && coordinator.includes("./planned_build_transaction.js"),
    "the L19-20 coordinator joins the same planner and dispatcher as Stage 10");
  assert(!/from ["']\.\/extension_runtime_16_18\.js["']/.test(coordinator),
    "the two Stage 10/11 coordinators do not import each other");
  assert(!/memorial_grove|village_infirmary|civic_workshop|special_buildings_16_18/.test(coordinator),
    "the L19-20 coordinator contains no L16-18 building or module reference");
  assert(!/buildSpecialBuilding|buildFinalCityBuilding|prepareSite|setBlock|spawnEntity/.test(coordinator),
    "the coordinator never builds or places blocks itself");
  const extensionCoordinator = source("../GrowingVillages_BP/scripts/extension_runtime_16_18.js");
  assert(!extensionCoordinator.includes("final_runtime_19_20"), "Stage 10's coordinator is unmodified by Stage 11");
  for (const owner of ["levels.js", "village.js", "main.js", "chapter_state.js", "chapter_journal.js",
    "craftsman_quests.js", "production.js", "npc.js", "quest_contract_v2.js", "planned_build_transaction.js", "progression_16_20.js"]) {
    assert(!source(`../GrowingVillages_BP/scripts/${owner}`).includes("final_runtime_19_20"),
      `${owner}: unchanged owner does not import the L19-20 coordinator`);
  }
  const ui = source("../GrowingVillages_BP/scripts/ui.js");
  assert(ui.includes("final_runtime_19_20.js"), "ui.js reaches L19-20 only through its coordinator");
  const production = source("../GrowingVillages_BP/scripts/production.js");
  assert(production.includes("12") && production.includes("6"), "production caps module is untouched by this stage");
}

console.log(failures === 0
  ? `\nALL FINAL CITY RUNTIME 19-20 TESTS PASSED (${checks} checks)`
  : `\n${failures} FINAL CITY RUNTIME 19-20 TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
