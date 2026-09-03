import { DAILY_CAP, STORAGE_CAP } from "./scripts/production.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ItemStack, __test__ } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { openElderMenu, openExtensionMenu } from "./scripts/ui.js";
import { LEVELS } from "./scripts/levels.js";
import { SPECIAL_ARCS } from "./scripts/quest_contract_v2.js";
import {
  extensionArcReadyKey,
  extensionArcStepKey,
  extensionLevelCommittedKey,
  extensionLevelReadyKey
} from "./scripts/progression_16_20.js";
import { plannedBuildStateKey } from "./scripts/planned_build_transaction.js";
import { foundVillage, getVillageState } from "./scripts/village.js";
import {
  EXTENSION_CHAPTER_KEY,
  EXTENSION_RUNTIME_LEVELS,
  extensionMenuAvailable,
  getExtensionStatus,
  tryAdvanceSpecialArcStep,
  tryCommitExtensionBuild
} from "./scripts/extension_runtime_16_18.js";

let failures = 0;
let checks = 0;
function assert(condition, message) {
  checks++;
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}
function source(relativePath) { return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"); }

const ARC_BY_LEVEL = new Map([
  [16, { arcId: "special.roots_of_the_road", buildingId: "memorial_grove", chapterId: "chapter.16.roots_of_the_road" }],
  [17, { arcId: "special.oath_of_care", buildingId: "village_infirmary", chapterId: "chapter.17.oath_of_care" }],
  [18, { arcId: "special.tools_for_all", buildingId: "civic_workshop", chapterId: "chapter.18.tools_for_all" }]
]);
const FINAL_BUILDING_IDS = ["founders_hall", "village_beacon"];

let siteX = 200000;
function makeVillage(level = 15) {
  siteX += 4000;
  const origin = { x: siteX, y: 70, z: 200000 };
  const player = __test__.makePlayer(`Ext${siteX}`, origin);
  const elder = foundVillage(player, origin, 0);
  elder.setDynamicProperty("village:level", level);
  return { player, elder, origin };
}

function clearPlayer(player) {
  const container = player.getComponent("minecraft:inventory").container;
  for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined);
  return container;
}

function givePlayer(player, requirements) {
  const container = clearPlayer(player);
  let slot = 0;
  for (const requirement of requirements) container.setItem(slot++, new ItemStack(requirement.itemId, requirement.amount));
  return container;
}

function inventoryTotals(container) {
  const totals = {};
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack) totals[stack.typeId] = (totals[stack.typeId] || 0) + stack.amount;
  }
  return totals;
}

function arcSteps(level) {
  return SPECIAL_ARCS.find((arc) => arc.arcId === ARC_BY_LEVEL.get(level).arcId).steps;
}

/** Drives one whole arc for `level` and stops before the build commit. */
function completeArc(player, elder, level) {
  for (const step of arcSteps(level)) {
    givePlayer(player, step.requirements);
    const result = tryAdvanceSpecialArcStep(elder, player, step.id, { warn() {} });
    if (!result.ok) throw new Error(`arc step failed at L${level}: ${result.reason}`);
  }
}

function stateFingerprint(elder, level) {
  const canon = ARC_BY_LEVEL.get(level);
  return JSON.stringify({
    level: elder.getDynamicProperty("village:level"),
    step: elder.getDynamicProperty(extensionArcStepKey(canon.arcId)),
    ready: elder.getDynamicProperty(extensionArcReadyKey(canon.arcId)),
    committed: elder.getDynamicProperty(extensionLevelCommittedKey(level)),
    build: elder.getDynamicProperty(plannedBuildStateKey(canon.buildingId)),
    chapter: elder.getDynamicProperty(EXTENSION_CHAPTER_KEY)
  });
}

console.log("\n=== activation scope ===");
assert(JSON.stringify(EXTENSION_RUNTIME_LEVELS) === JSON.stringify([16, 17, 18]),
  "coordinator activates exactly L16, L17 and L18");
assert(!Object.hasOwn(LEVELS, 16) && !Object.hasOwn(LEVELS, 17) && !Object.hasOwn(LEVELS, 18),
  "town hall deposit table still has no L16-18 rows, so the chest path stays inert");

console.log("\n=== preconditions and safe refusals ===");
{
  const { elder } = makeVillage(15);
  const status = getExtensionStatus(elder);
  assert(status.ok && status.status === "arc_step" && status.level === 16,
    "a versioned L15 village opens the L16 special chapter at step 1");
  assert(extensionMenuAvailable(elder) === true, "elder menu entry is offered for a ready v2 village");
  assert(status.buildingId === "memorial_grove" && status.chapterId === "chapter.16.roots_of_the_road",
    "canonical L16 building and chapter identity are used");
}
{
  const { elder } = makeVillage(15);
  elder.setDynamicProperty("village:layoutVersion", undefined);
  const status = getExtensionStatus(elder);
  assert(!status.ok && status.reason === "extension_layout_unsupported",
    "legacy keyless village is refused before any planner decision");
  assert(extensionMenuAvailable(elder) === false, "legacy village never sees the special-chapter entry");
  const commit = tryCommitExtensionBuild(elder, { warn() {} });
  assert(!commit.ok && commit.reason === "extension_layout_unsupported", "legacy village cannot commit a build");
}
{
  const { elder } = makeVillage(15);
  elder.setDynamicProperty("village:layoutVersion", "mystery-layout");
  const status = getExtensionStatus(elder);
  assert(!status.ok && status.reason === "extension_layout_unsupported",
    "corrupt layoutVersion is refused exactly like legacy");
}
{
  const { player, elder } = makeVillage(12);
  const status = getExtensionStatus(elder);
  assert(!status.ok && status.reason === "extension_prior_level_not_committed",
    "an L12 village is below the L16 gate and stays inactive");
  assert(extensionMenuAvailable(elder) === false, "L1-15 villages outside the predicate see no entry");
  const before = stateFingerprint(elder, 16);
  givePlayer(player, arcSteps(16)[0].requirements);
  const advance = tryAdvanceSpecialArcStep(elder, player, arcSteps(16)[0].id, { warn() {} });
  assert(!advance.ok && stateFingerprint(elder, 16) === before,
    "a refused L12 turn-in mutates no extension state");
}
{
  const { elder } = makeVillage(15);
  elder.setDynamicProperty(extensionArcStepKey("special.roots_of_the_road"), 9);
  const status = getExtensionStatus(elder);
  assert(!status.ok && status.reason === "extension_state_invalid",
    "an out-of-range arc step is reported as invalid state, never repaired by guesswork");
}

console.log("\n=== special-arc steps 1-3 ===");
{
  const { player, elder } = makeVillage(15);
  const steps = arcSteps(16);
  for (const [index, step] of steps.entries()) {
    const container = givePlayer(player, step.requirements);
    const view = getExtensionStatus(elder);
    assert(view.ok && view.status === "arc_step" && view.nextStep === index + 1 && view.stepId === step.id,
      `L16 step ${index + 1} is offered in order`);
    const result = tryAdvanceSpecialArcStep(elder, player, step.id, { warn() {} });
    assert(result.ok && result.step === index + 1, `L16 step ${index + 1} commits`);
    assert(elder.getDynamicProperty(extensionArcStepKey("special.roots_of_the_road")) === index + 1,
      `L16 step ${index + 1} writes the canonical arc step key`);
    assert(Object.keys(inventoryTotals(container)).length === 0,
      `L16 step ${index + 1} consumes exactly the declared requirements`);
    assert(elder.getDynamicProperty("village:level") === 15,
      `L16 step ${index + 1} does not change the village level`);
    assert(elder.getDynamicProperty(plannedBuildStateKey("memorial_grove")) === undefined,
      `L16 step ${index + 1} never touches the physical build state`);
  }
  assert(elder.getDynamicProperty(extensionArcReadyKey("special.roots_of_the_road")) === true,
    "L16 arc becomes ready only after the third step");
  const ready = getExtensionStatus(elder);
  assert(ready.ok && ready.status === "ready_to_build", "a completed arc switches the menu to the build action");
}
{
  const { player, elder } = makeVillage(15);
  const steps = arcSteps(16);
  givePlayer(player, steps[1].requirements);
  const outOfOrder = tryAdvanceSpecialArcStep(elder, player, steps[1].id, { warn() {} });
  assert(!outOfOrder.ok, "step 2 cannot be turned in before step 1");
  assert(elder.getDynamicProperty(extensionArcStepKey("special.roots_of_the_road")) === undefined,
    "an out-of-order turn-in writes no arc step");
}
{
  const { player, elder } = makeVillage(15);
  const step = arcSteps(16)[0];
  givePlayer(player, step.requirements);
  assert(tryAdvanceSpecialArcStep(elder, player, step.id, { warn() {} }).ok, "first L16 step accepted once");
  const container = givePlayer(player, step.requirements);
  const repeat = tryAdvanceSpecialArcStep(elder, player, step.id, { warn() {} });
  assert(!repeat.ok && repeat.reason === "extension_stale_state",
    "a stale form ID from an already-completed step is refused");
  assert(inventoryTotals(container)[step.requirements[0].itemId] === step.requirements[0].amount,
    "a stale-state refusal consumes no player items");
}
{
  const { player, elder } = makeVillage(15);
  const step = arcSteps(16)[0];
  const container = givePlayer(player, step.requirements.map((r) => ({ itemId: r.itemId, amount: r.amount - 1 })));
  const before = inventoryTotals(container);
  const result = tryAdvanceSpecialArcStep(elder, player, step.id, { warn() {} });
  assert(!result.ok && result.reason === "extension_not_enough", "an underfilled inventory is refused");
  assert(JSON.stringify(inventoryTotals(container)) === JSON.stringify(before),
    "an underfilled turn-in leaves the player inventory untouched");
  assert(elder.getDynamicProperty(extensionArcStepKey("special.roots_of_the_road")) === undefined,
    "an underfilled turn-in writes no arc state");
}
{
  const { player, elder } = makeVillage(15);
  const step = arcSteps(16)[0];
  const container = givePlayer(player, step.requirements);
  const before = inventoryTotals(container);
  let writes = 0;
  const original = elder.setDynamicProperty.bind(elder);
  elder.setDynamicProperty = (key, value) => {
    if (key.startsWith("village:v2:extension:")) { writes++; throw new Error("simulated property failure"); }
    return original(key, value);
  };
  const result = tryAdvanceSpecialArcStep(elder, player, step.id, { warn() {} });
  elder.setDynamicProperty = original;
  assert(!result.ok && result.reason === "extension_state_write_failed" && writes > 0,
    "a failed arc state write is reported instead of silently swallowed");
  assert(JSON.stringify(inventoryTotals(container)) === JSON.stringify(before),
    "a failed arc state write rolls the player inventory back exactly");
}

console.log("\n=== build commit, exact request and failure isolation ===");
{
  const { player, elder } = makeVillage(15);
  completeArc(player, elder, 16);
  const requests = [];
  const before = stateFingerprint(elder, 16);
  const result = tryCommitExtensionBuild(elder, {
    warn() {},
    dispatch(targetElder, request) {
      requests.push(request);
      return { done: false, recoverable: true, error: "planned_build_failed" };
    }
  });
  assert(requests.length === 1 && JSON.stringify(requests[0]) === JSON.stringify({ buildingId: "memorial_grove", level: 16 }) &&
    Object.hasOwn(requests[0], "paletteId") && requests[0].paletteId === undefined,
    "the dispatcher receives exactly { buildingId, level, paletteId: undefined }");
  assert(!result.ok && result.reason === "planned_build_failed" && result.recoverable === true,
    "a builder failure is reported as recoverable");
  assert(stateFingerprint(elder, 16) === before,
    "a failed build changes no level, chapter, arc or build state");
}
{
  const { player, elder } = makeVillage(15);
  completeArc(player, elder, 16);
  const container = clearPlayer(player);
  container.setItem(0, new ItemStack("minecraft:oak_planks", 64));
  const result = tryCommitExtensionBuild(elder, {
    warn() {},
    dispatch() { return { done: false, recoverable: true, error: "connector_failed" }; }
  });
  assert(!result.ok, "a connector failure blocks the commit");
  assert(inventoryTotals(container)["minecraft:oak_planks"] === 64,
    "the build phase consumes no player resources on failure");
}
{
  const { player, elder } = makeVillage(15);
  completeArc(player, elder, 16);
  elder.setDynamicProperty(plannedBuildStateKey("memorial_grove"), 1);
  let dispatched = 0;
  const result = tryCommitExtensionBuild(elder, { warn() {}, dispatch: undefined });
  dispatched += result.ok ? 1 : 0;
  assert(!result.ok && result.reason === "queued_build_recovered",
    "a stale queued build state is recovered instead of committed");
  assert(elder.getDynamicProperty(plannedBuildStateKey("memorial_grove")) === 0,
    "stale queue recovery resets the physical build marker to 0");
  assert(elder.getDynamicProperty(extensionLevelCommittedKey(16)) === undefined && dispatched === 0,
    "stale queue recovery commits no level");
  const retry = tryCommitExtensionBuild(elder, { warn() {} });
  assert(retry.ok && retry.level === 16 && retry.repaired === false,
    "the explicit retry after recovery builds normally");
}
{
  const { player, elder } = makeVillage(15);
  completeArc(player, elder, 16);
  elder.setDynamicProperty(plannedBuildStateKey("memorial_grove"), 73);
  const before = elder.getDynamicProperty("village:level");
  const result = tryCommitExtensionBuild(elder, { warn() {} });
  assert(!result.ok && result.reason === "extension_build_state_corrupt",
    "a corrupt physical build marker refuses the commit");
  assert(elder.getDynamicProperty(plannedBuildStateKey("memorial_grove")) === 73 &&
    elder.getDynamicProperty("village:level") === before,
    "a corrupt marker is neither overwritten nor levelled past");
}

console.log("\n=== successful commit, idempotency and repair ===");
{
  const { player, elder } = makeVillage(15);
  completeArc(player, elder, 16);
  let builds = 0;
  const result = tryCommitExtensionBuild(elder, {
    warn() {},
    buildSpecial(dimension, origin, facing, buildingId) {
      builds++;
      return { id: buildingId, approach: { axis: "side", width: 2, bounds: { fMin: -23, fMax: -22, sMin: -66, sMax: -65 } } };
    }
  });
  assert(result.ok && result.level === 16 && result.buildingId === "memorial_grove", "L16 commits after a confirmed build");
  assert(builds === 1, "exactly one physical build is issued");
  assert(elder.getDynamicProperty("village:level") === 16, "the village level is written only after the build");
  assert(elder.getDynamicProperty(extensionLevelCommittedKey(16)) === true, "the canonical committed flag is set");
  assert(elder.getDynamicProperty(EXTENSION_CHAPTER_KEY) === "chapter.16.roots_of_the_road",
    "the extension chapter key records the canonical chapter");
  assert(elder.getDynamicProperty(plannedBuildStateKey("memorial_grove")) === 2, "the physical marker reaches state 2");
  assert(elder.getDynamicProperty("village:v2:chapter") === "chapter.01.foundation",
    "the legacy L1-10 chapter owner is left exactly as it was");

  const marker = elder.getDynamicProperty(plannedBuildStateKey("memorial_grove"));
  const repeat = tryCommitExtensionBuild(elder, {
    warn() {},
    buildSpecial() { builds++; return null; }
  });
  // A committed L16 is skipped by the active-level scan, so a second press lands
  // on the next uncommitted level and is refused there for its own missing arc.
  assert(!repeat.ok && repeat.reason === "extension_special_arc_not_ready" && repeat.level === 17,
    "pressing build again after success is refused idempotently");
  assert(builds === 1, "a repeated press never issues a duplicate physical build");
  assert(elder.getDynamicProperty(plannedBuildStateKey("memorial_grove")) === marker &&
    elder.getDynamicProperty("village:level") === 16,
    "a repeated press leaves the committed L16 build marker and level untouched");

  const next = getExtensionStatus(elder);
  assert(next.ok && next.status === "arc_step" && next.level === 17 && next.buildingId === "village_infirmary",
    "the L17 chapter opens only after L16 is committed");
}
{
  const { player, elder } = makeVillage(15);
  completeArc(player, elder, 16);
  // Simulate an interrupted commit: the building exists but the flag never landed.
  elder.setDynamicProperty(plannedBuildStateKey("memorial_grove"), 2);
  let builds = 0;
  const result = tryCommitExtensionBuild(elder, { warn() {}, buildSpecial() { builds++; return null; } });
  assert(result.ok && result.repaired === true && builds === 0,
    "an interrupted commit is repaired without constructing a second building");
  assert(elder.getDynamicProperty(extensionLevelCommittedKey(16)) === true &&
    elder.getDynamicProperty("village:level") === 16,
    "the repair path finishes the level and chapter commit");
}
{
  const { player, elder } = makeVillage(15);
  completeArc(player, elder, 16);
  const original = elder.setDynamicProperty.bind(elder);
  elder.setDynamicProperty = (key, value) => {
    if (key === extensionLevelCommittedKey(16)) throw new Error("simulated commit failure");
    return original(key, value);
  };
  const result = tryCommitExtensionBuild(elder, { warn() {} });
  elder.setDynamicProperty = original;
  assert(!result.ok && result.reason === "extension_commit_failed" && result.recoverable === true,
    "a commit write failure after a successful build is reported as recoverable");
  assert(elder.getDynamicProperty("village:level") === 15,
    "a failed commit never advances the village level");
  const repaired = tryCommitExtensionBuild(elder, { warn() {} });
  assert(repaired.ok && repaired.repaired === true && elder.getDynamicProperty("village:level") === 16,
    "the next attempt repairs the interrupted commit exactly once");
}

console.log("\n=== full L16-L18 sequence and L19/L20 isolation ===");
{
  const { player, elder } = makeVillage(15);
  for (const level of [16, 17, 18]) {
    const canon = ARC_BY_LEVEL.get(level);
    completeArc(player, elder, level);
    const result = tryCommitExtensionBuild(elder, { warn() {} });
    assert(result.ok && result.level === level && result.buildingId === canon.buildingId,
      `L${level} commits with its canonical building`);
    assert(elder.getDynamicProperty(EXTENSION_CHAPTER_KEY) === canon.chapterId,
      `L${level} records chapter ${canon.chapterId}`);
  }
  assert(getVillageState(elder).level === 18, "the village reaches level 18 through the coordinator");
  const done = getExtensionStatus(elder);
  assert(done.ok && done.status === "complete" && done.level === null,
    "after L18 the coordinator reports completion rather than opening L19");
  assert(extensionMenuAvailable(elder) === false, "no elder entry is offered once L18 is committed");
  const beyond = tryCommitExtensionBuild(elder, { warn() {} });
  assert(!beyond.ok && beyond.reason === "extension_all_committed", "no build is offered above L18");
  for (const buildingId of FINAL_BUILDING_IDS) {
    assert(elder.getDynamicProperty(plannedBuildStateKey(buildingId)) === undefined,
      `${buildingId}: L19/L20 physical state is never written`);
  }
  for (const level of [19, 20]) {
    assert(elder.getDynamicProperty(extensionLevelCommittedKey(level)) === undefined &&
      elder.getDynamicProperty(extensionLevelReadyKey(level)) === undefined,
      `L${level}: neither ready nor committed progression state is written`);
  }
}

console.log("\n=== module ownership boundaries ===");
{
  const coordinator = source("../GrowingVillages_BP/scripts/extension_runtime_16_18.js");
  assert(coordinator.includes("./progression_16_20.js") && coordinator.includes("./planned_build_transaction.js"),
    "the coordinator is the single module that joins planner and dispatcher");
  assert(!/founders_hall|village_beacon|final_city_19_20/.test(coordinator),
    "the coordinator contains no L19/L20 building, level or module reference");
  assert(!/buildSpecialBuilding|buildFinalCityBuilding|prepareSite|setBlock|spawnEntity/.test(coordinator),
    "the coordinator never builds or places blocks itself");
  for (const owner of ["levels.js", "village.js", "main.js", "chapter_state.js", "chapter_journal.js",
    "craftsman_quests.js", "production.js", "npc.js", "quest_contract_v2.js"]) {
    assert(!source(`../GrowingVillages_BP/scripts/${owner}`).includes("extension_runtime_16_18"),
      `${owner}: unchanged owner does not import the coordinator`);
  }
  const ui = source("../GrowingVillages_BP/scripts/ui.js");
  assert(ui.includes("extension_runtime_16_18.js"), "ui.js reaches L16-18 only through the coordinator");
  assert(!ui.includes("planned_build_transaction") && !ui.includes("progression_16_20"),
    "ui.js still imports neither the dispatcher nor the pure planner");
  const planner = source("../GrowingVillages_BP/scripts/progression_16_20.js");
  const dispatcher = source("../GrowingVillages_BP/scripts/planned_build_transaction.js");
  assert(!planner.includes("extension_runtime_16_18") && !dispatcher.includes("extension_runtime_16_18"),
    "the Stage 9 halves stay unaware of the coordinator");
  // This used to be `production.includes("12") && production.includes("6")`,
  // which passes for any file containing those two digits anywhere and so
  // asserted nothing at all. The caps themselves are what must not move: the
  // standing rule is that the village never out-earns the player's own farming
  // and mining, and a stage that quietly raised a cap would break it.
  assert(DAILY_CAP.farmer === 12 && DAILY_CAP.miner === 6,
    `the daily caps are untouched by this stage (farmer ${DAILY_CAP.farmer}, miner ${DAILY_CAP.miner})`);
  assert(STORAGE_CAP.farmer === 64 && STORAGE_CAP.miner === 32,
    `and so are the storage caps (farmer ${STORAGE_CAP.farmer}, miner ${STORAGE_CAP.miner})`);
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
    const SPECIAL_BUTTON = "growing_villages.ui.elder.special.button";
    ActionFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    const below = makeVillage(10);
    rendered = [];
    await openElderMenu(below.player, below.elder);
    // The baseline is measured rather than written down: the elder menu grows
    // as the mod does (the contracts button was the most recent addition), and
    // a hardcoded count would fail every time for reasons that have nothing to
    // do with what this test is about.
    const baselineButtons = rendered.length;
    assert(!rendered.some((entry) => labelOf(entry) === SPECIAL_BUTTON),
      "an L10 village sees no special-chapter button");

    const ready = makeVillage(15);
    rendered = [];
    await openElderMenu(ready.player, ready.elder);
    assert(rendered.length === baselineButtons + 1, `a ready L15 village gains exactly one extra elder button (${rendered.length} vs ${baselineButtons})`);
    assert(rendered.filter((entry) => labelOf(entry) === SPECIAL_BUTTON).length === 1,
      "…and that button is the special-chapter one");
    assert(!rendered.some((entry) => /founders|beacon|19|20/.test(String(labelOf(entry)))),
      "the elder menu exposes no premature L19/L20 entry");

    // Selecting by label, not by a hardcoded index, for the same reason.
    const specialIndex = rendered.findIndex((entry) => labelOf(entry) === SPECIAL_BUTTON);
    let call = 0;
    ActionFormData.prototype.show = async () => (++call === 1 ? { canceled: false, selection: specialIndex } : { canceled: false, selection: 1 });
    rendered = [];
    await openElderMenu(ready.player, ready.elder);
    assert(rendered.some((entry) => labelOf(entry) === "growing_villages.ui.elder.special.turn_in"),
      "selecting the special-chapter button opens the arc turn-in form");
    assert(ready.elder.getDynamicProperty(extensionArcStepKey("special.roots_of_the_road")) === undefined,
      "cancelling the special-chapter form changes no arc state");

    const step = arcSteps(16)[0];
    const container = givePlayer(ready.player, step.requirements);
    ActionFormData.prototype.show = async () => ({ canceled: false, selection: 0 });
    await openExtensionMenu(ready.player, ready.elder);
    assert(ready.elder.getDynamicProperty(extensionArcStepKey("special.roots_of_the_road")) === 1,
      "confirming the form advances exactly one arc step");
    assert(Object.keys(inventoryTotals(container)).length === 0,
      "confirming the form consumes exactly the declared step requirements");
    assert(ready.elder.getDynamicProperty("village:level") === 15,
      "an arc step through the UI never changes the village level");

    const legacy = makeVillage(15);
    legacy.elder.setDynamicProperty("village:layoutVersion", undefined);
    rendered = [];
    await openElderMenu(legacy.player, legacy.elder);
    assert(rendered.length === baselineButtons && !rendered.some((entry) => labelOf(entry) === SPECIAL_BUTTON),
      "a legacy village never gains the special-chapter button");
  } finally {
    ActionFormData.prototype.button = originalButton;
    ActionFormData.prototype.show = originalActionShow;
    MessageFormData.prototype.show = originalMessageShow;
  }
}

console.log(failures === 0
  ? `\nALL EXTENSION RUNTIME 16-18 TESTS PASSED (${checks} checks)`
  : `\n${failures} EXTENSION RUNTIME 16-18 TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
