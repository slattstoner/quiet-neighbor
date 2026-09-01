import { __test__, ItemStack } from "@minecraft/server";
import { CONTRACTS, contractForDay, turnInContract } from "./scripts/contracts.js";
import { SURVEY_CHARTER_ID, CHARTER_MIN_LEVEL, useSurveyCharter, surveyedSlots } from "./scripts/outpost_runtime.js";
import { foundVillage } from "./scripts/village.js";
import { PROP_LEVEL } from "./scripts/village_state.js";

/**
 * Two guards against a transaction committing something other than what the
 * player agreed to.
 *
 * 1. A form can stay open across an in-game sunrise. The contract screen read
 *    the day when it opened and the commit read it again when the player
 *    pressed the button, with nothing tying the two together - so a rollover
 *    mid-menu meant confirming "bring 32 wheat" and having 64 cobblestone
 *    taken instead. Every other turn-in in the mod pins the step it displayed
 *    (craftsman_quests' expectedStepId, sentinel_quests' too); the contract
 *    was the one that did not.
 *
 * 2. The survey charter built the outpost, wrote the "surveyed" marker, and
 *    only then looked for a charter to spend. A player with no charter got the
 *    site anyway, the slot permanently spent, and a "you have no charter"
 *    message on top - the site standing, unpaid for, and unrepeatable.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

function fakeElder(level) {
  const props = new Map([[PROP_LEVEL, level]]);
  return {
    setDynamicProperty(key, value) { props.set(key, value); },
    getDynamicProperty(key) { return props.get(key); }
  };
}

function countOf(container, typeId) {
  let total = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === typeId) total += stack.amount;
  }
  return total;
}

// ---------- 1. the contract the player saw is the contract that commits ----------
console.log("\n=== a day rollover mid-menu cannot swap the contract ===");
{
  const level = 10;
  // Two adjacent days whose contracts genuinely differ, so "the day moved on"
  // is a real change rather than a coincidence of the rotation.
  let today = 0;
  while (contractForDay(level, today).id === contractForDay(level, today + 1).id) today++;
  const shown = contractForDay(level, today);
  const tomorrow = contractForDay(level, today + 1);
  assert(shown.id !== tomorrow.id, `day ${today} and ${today + 1} ask for different things (${shown.id} vs ${tomorrow.id})`);

  const elder = fakeElder(level);
  const player = __test__.makePlayer("nightowl", { x: 0, y: 70, z: 0 });
  const container = player.getComponent("minecraft:inventory").container;
  for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined);
  // Carrying enough for BOTH contracts, so nothing is refused merely for lack
  // of items - the guard has to be what stops it.
  container.setItem(0, new ItemStack(shown.itemId, 64));
  container.setItem(1, new ItemStack(tomorrow.itemId, 64));

  const heldTomorrow = countOf(container, tomorrow.itemId);
  const result = turnInContract(player, elder, today + 1, shown.id);

  assert(!result.ok, `the commit is refused when the day moved on (ok: ${result.ok})`);
  assert(result.reason === "stale_contract", `and says why (reason: ${result.reason})`);
  assert(countOf(container, tomorrow.itemId) === heldTomorrow,
    "and tomorrow's goods were not taken for a contract the player never saw");

  // Without expectedContractId the behaviour is unchanged, so nothing that
  // already calls turnInContract with three arguments starts refusing.
  const unguarded = turnInContract(player, elder, today + 1);
  assert(unguarded.ok, `an unguarded call still commits normally (reason: ${unguarded.reason})`);
  assert(unguarded.contract.id === tomorrow.id, "committing the day it was actually run on");
}

console.log("\n=== the same contract on the same day still commits ===");
{
  const elder = fakeElder(10);
  const shown = contractForDay(10, 3);
  const player = __test__.makePlayer("earlybird", { x: 0, y: 70, z: 0 });
  const container = player.getComponent("minecraft:inventory").container;
  for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined);
  container.setItem(0, new ItemStack(shown.itemId, 64));

  const result = turnInContract(player, elder, 3, shown.id);
  assert(result.ok, `a matching contract id is not treated as stale (reason: ${result.reason})`);
  assert(countOf(container, shown.rewardItem) === shown.rewardAmount, "and the reward is paid");
}

// ---------- 2. the charter is checked before anything is built ----------
console.log("\n=== a survey with no charter builds nothing and spends nothing ===");
{
  const player = __test__.makePlayer("Surveyor", { x: 940000, y: 70, z: 940000 });
  const elder = foundVillage(player, { x: 940000, y: 70, z: 940000 }, 0);
  elder.setDynamicProperty(PROP_LEVEL, CHARTER_MIN_LEVEL);

  const container = player.getComponent("minecraft:inventory").container;
  for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined);

  const before = surveyedSlots(elder).length;
  const result = useSurveyCharter(player, elder);
  const after = surveyedSlots(elder).length;

  assert(!result.ok, `the survey is refused (ok: ${result.ok})`);
  assert(result.reason === "no_charter", `for the right reason (reason: ${result.reason})`);
  assert(after === before,
    `and no site is marked as surveyed (${before} -> ${after}) - the slot would otherwise be spent forever`);

  // With a charter in hand it works, and the charter is what pays for it.
  container.setItem(0, new ItemStack(SURVEY_CHARTER_ID, 1));
  const paid = useSurveyCharter(player, elder);
  assert(paid.ok, `a survey with a charter goes ahead (reason: ${paid.reason})`);
  assert(surveyedSlots(elder).length === before + 1, "and marks exactly one site");
  assert(countOf(container, SURVEY_CHARTER_ID) === 0, "and the charter is spent");
}

console.log(failures === 0 ? "\nALL TURN-IN GUARD CHECKS PASSED" : `\n${failures} TURN-IN GUARD CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
