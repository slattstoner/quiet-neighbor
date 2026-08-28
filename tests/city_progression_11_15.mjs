import fs from "node:fs";
import { __test__ } from "@minecraft/server";
import { LEVELS, MAX_LAYOUT_V2_LEVEL } from "./scripts/levels.js";
import { ROAD_AXES, SPATIAL_PLAN } from "./scripts/spatial_plan.js";
import {
  LEGACY_LAYOUT_MAX_ERROR,
  LAYOUT_VERSION_V2,
  chestSatisfiesRequirements,
  foundVillage,
  getCityBuildState,
  getLayoutVersion,
  getVillageState,
  tryLevelUp
} from "./scripts/village.js";

let failures = 0;
let checks = 0;
function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error("FAIL:", message);
  } else console.log("ok:", message);
}

function clearContainer(container) {
  for (let i = 0; i < container.size; i++) container.setItem(i, undefined);
}

function fillForLevel(elder, level) {
  const state = getVillageState(elder);
  const block = elder.dimension.getBlock(state.chest);
  const container = block.getComponent("minecraft:inventory").container;
  clearContainer(container);
  let slot = 0;
  for (const [id, amount] of Object.entries(LEVELS[level].requirements)) container.setItem(slot++, { typeId: id, amount });
  return container;
}

function itemCount(container) {
  let total = 0;
  for (let i = 0; i < container.size; i++) total += container.getItem(i)?.amount || 0;
  return total;
}

function rectOverlap(a, b) {
  return a.fMin <= b.fMax && a.fMax >= b.fMin && a.sMin <= b.sMax && a.sMax >= b.sMin;
}

function roadOverlap(bounds) {
  return rectOverlap(bounds, ROAD_AXES.forward.bounds) || rectOverlap(bounds, ROAD_AXES.side.bounds);
}

console.log("\n=== layout version semantics ===");
const v2Player = __test__.makePlayer("V2Town", { x: 110000, y: 70, z: 110000 });
const v2Elder = foundVillage(v2Player, { x: 110000, y: 70, z: 110000 }, 0);
assert(v2Elder.getDynamicProperty("village:layoutVersion") === LAYOUT_VERSION_V2, "newly founded village receives layoutVersion=2");
assert(getLayoutVersion(v2Elder) === 2, "new village reads as v2");
assert(getLayoutVersion(v2Elder) === 2, "layoutVersion stays stable on repeated read");

const legacyPlayer = __test__.makePlayer("LegacyTown", { x: 130000, y: 70, z: 110000 });
const legacyElder = foundVillage(legacyPlayer, { x: 130000, y: 70, z: 110000 }, 1);
legacyElder.setDynamicProperty("village:layoutVersion", undefined);
assert(getLayoutVersion(legacyElder) === 1, "elder without layout key is safely treated as legacy v1");
legacyElder.setDynamicProperty("village:level", 10);
const legacyContainer = fillForLevel(legacyElder, 11);
const legacyBefore = itemCount(legacyContainer);
const legacyCheck = chestSatisfiesRequirements(legacyElder);
const legacyResult = tryLevelUp(legacyElder);
assert(!legacyCheck.done && legacyCheck.error === LEGACY_LAYOUT_MAX_ERROR, "legacy L10 receives neutral legacy_layout_max preflight");
assert(!legacyResult.done && legacyResult.error === LEGACY_LAYOUT_MAX_ERROR, "legacy L11 is blocked without city runtime path");
assert(itemCount(legacyContainer) === legacyBefore, "legacy L11 block never removes town hall items");
assert(getVillageState(legacyElder).level === 10, "legacy level remains L10 after blocked city attempt");

const invalidPlayer = __test__.makePlayer("InvalidTown", { x: 150000, y: 70, z: 110000 });
const invalidElder = foundVillage(invalidPlayer, { x: 150000, y: 70, z: 110000 }, 2);
invalidElder.setDynamicProperty("village:layoutVersion", "mystery-layout");
invalidElder.setDynamicProperty("village:level", 10);
fillForLevel(invalidElder, 11);
const invalidResult = tryLevelUp(invalidElder);
assert(!invalidResult.done && invalidResult.error === "invalid_layout_version", "unknown layoutVersion takes safe legacy fallback");
assert(getVillageState(invalidElder).level === 10, "invalid layout cannot construct a city building");

console.log("\n=== v2 progression L1 through L15 ===");
for (let level = 2; level <= MAX_LAYOUT_V2_LEVEL; level++) {
  const container = fillForLevel(v2Elder, level);
  const before = itemCount(container);
  const result = tryLevelUp(v2Elder);
  assert(result.done && result.leveledUpTo === level, `v2 progresses successfully through L${level}`);
  if (level <= 10) continue;

  const cfg = LEVELS[level];
  assert(result.cityBuildingId === cfg.cityBuildingId && result.shape?.buildingId === cfg.cityBuildingId, `L${level} calls exactly its canonical ${cfg.cityBuildingId} builder`);
  assert(getCityBuildState(v2Elder, cfg.cityBuildingId) === 2, `L${level} commits build state 2 only after success`);
  assert(result.connector?.width >= 2 && !roadOverlap(result.connector.bounds), `L${level} connector is a narrow two-block-plus approach outside central road bands`);
  assert(itemCount(container) < before, `L${level} requirements are committed after city pipeline success`);
  const plan = SPATIAL_PLAN.find((entry) => entry.buildingId === cfg.cityBuildingId);
  assert(JSON.stringify(result.shape.bounds) === JSON.stringify(plan.bounds), `L${level} city building retains its approved SPATIAL_PLAN bounds`);
}
assert(getVillageState(v2Elder).level === 15, "new v2 village reaches L15");

console.log("\n=== idempotency and recoverable failure ===");
const blockCountAfterL15 = __test__.blockStore.size;
const afterTerminal = tryLevelUp(v2Elder);
assert(afterTerminal.done && afterTerminal.finished, "terminal L15 has no additional level build");
assert(__test__.blockStore.size === blockCountAfterL15, "repeat action at terminal L15 creates no duplicate city blocks or connectors");

const stateMismatchPlayer = __test__.makePlayer("StateMismatch", { x: 170000, y: 70, z: 110000 });
const stateMismatchElder = foundVillage(stateMismatchPlayer, { x: 170000, y: 70, z: 110000 }, 3);
stateMismatchElder.setDynamicProperty("village:level", 10);
fillForLevel(stateMismatchElder, 11);
stateMismatchElder.setDynamicProperty("village:v2:build:market_square", 2);
const mismatchResult = tryLevelUp(stateMismatchElder);
assert(!mismatchResult.done && mismatchResult.error === "city_build_state_mismatch", "completed marker without level advance never re-runs builder");

const failurePlayer = __test__.makePlayer("Rollback", { x: 190000, y: 70, z: 110000 });
const failureElder = foundVillage(failurePlayer, { x: 190000, y: 70, z: 110000 }, 0);
failureElder.setDynamicProperty("village:level", 10);
const failureContainer = fillForLevel(failureElder, 11);
const failureBefore = itemCount(failureContainer);
const failureResult = tryLevelUp(failureElder, { runLevelBuild() { throw new Error("injected city builder error"); } });
assert(!failureResult.done && failureResult.error === "city_build_failed" && failureResult.recoverable, "builder error returns recoverable city failure");
assert(getVillageState(failureElder).level === 10 && itemCount(failureContainer) === failureBefore, "failed city pipeline leaves level and town hall requirements unchanged");
assert(getCityBuildState(failureElder, "market_square") === 0, "failed city pipeline clears temporary build state for retry");
failureElder.setDynamicProperty("village:v2:build:market_square", 1);
const recoveryResult = tryLevelUp(failureElder);
assert(!recoveryResult.done && recoveryResult.error === "city_build_recovered" && getCityBuildState(failureElder, "market_square") === 0, "stale queued state recovers to retryable zero without a duplicate build");

console.log("\n=== chapter hook and runtime ownership boundaries ===");
const villageSource = fs.readFileSync(new URL("./scripts/village.js", import.meta.url), "utf8");
const connectorSource = fs.readFileSync(new URL("./scripts/city_connectors.js", import.meta.url), "utf8");
assert(villageSource.includes("setVillageChapterForLevel(elder, nextLevel)"), "successful city path preserves the existing chapter update hook with the real level");
assert(!villageSource.includes("buildDefenceStage") && !connectorSource.includes("buildDefenceStage"), "city runtime does not activate isolated defence stages");
assert(!connectorSource.includes("prepareFortifiedArea") && !connectorSource.includes("189"), "connector never requests full-square terrain preparation");

console.log(failures === 0
  ? `\nALL CITY PROGRESSION 11–15 TESTS PASSED (${checks} checks)`
  : `\n${failures} CITY PROGRESSION 11–15 TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
