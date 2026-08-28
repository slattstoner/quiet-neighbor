import { __test__ } from "@minecraft/server";
import { foundVillage, getVillageState, chestSatisfiesRequirements, tryLevelUp, effectiveRequirementsText, findNearestElder } from "./scripts/village.js";
import { facingFromDirection, toWorld } from "./scripts/util.js";
import { turnInQuest, getQuestFor } from "./scripts/quests.js";
import { LEVELS, MAX_BETA_LEVEL } from "./scripts/levels.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

function addCurrentQuestRequirement(container, npc, professionName) {
  const quest = getQuestFor(professionName);
  const step = Number(npc.getDynamicProperty("quest_step") || 0);
  const current = quest?.chain?.[step];
  if (!current) throw new Error(`missing current quest fixture for ${professionName} step ${step}`);
  container.setItem(0, { typeId: current.requiredItem, amount: current.requiredAmount });
  return current;
}

// --- Test 1: coordinate transform round-trips for all 4 facings ---
for (let facing = 0; facing < 4; facing++) {
  const origin = { x: 100, y: 64, z: 100 };
  const p1 = toWorld(origin, facing, 5, -2, 1);
  const p2 = toWorld(origin, facing, 5, 2, 1);
  assert(p1.y === 65, `toWorld: y offset applies (facing ${facing})`);
  assert(JSON.stringify(p1) !== JSON.stringify(p2), `toWorld: left/right differ (facing ${facing})`);
}

// --- Test 2: facingFromDirection picks a sane cardinal ---
assert(facingFromDirection({ x: 1, y: 0, z: 0 }) === 0, "facingFromDirection +X");
assert(facingFromDirection({ x: -1, y: 0, z: 0 }) === 1, "facingFromDirection -X");
assert(facingFromDirection({ x: 0, y: 0, z: 1 }) === 2, "facingFromDirection +Z");
assert(facingFromDirection({ x: 0, y: 0, z: -1 }) === 3, "facingFromDirection -Z");

// --- Test 3: found a village and walk it through every beta level ---
const player = __test__.makePlayer("Tester", { x: 0, y: 70, z: 0 });
const origin = { x: 0, y: 70, z: 0 };
const facing = 0;

let elder;
try {
  elder = foundVillage(player, origin, facing);
  assert(!!elder, "foundVillage returns an elder entity");
} catch (e) {
  assert(false, "foundVillage did not throw: " + e.stack);
  process.exit(1);
}

let state = getVillageState(elder);
assert(state.level === 1, "village starts at level 1");

// Town hall chest should exist and be a real container
const chestBlock = elder.dimension.getBlock(state.chest);
assert(chestBlock.typeId === "minecraft:chest", "town hall chest block was placed");

function depositRequirements(level) {
  const cfg = LEVELS[level];
  const container = chestBlock.getComponent("minecraft:inventory").container;
  let slot = 0;
  for (const [id, count] of Object.entries(cfg.requirements)) {
    container.setItem(slot++, { typeId: id, amount: count });
  }
}

for (let level = 2; level <= MAX_BETA_LEVEL; level++) {
  const before = chestSatisfiesRequirements(elder);
  assert(before.done === false, `level ${level}: empty chest correctly reports not-done`);

  depositRequirements(level);
  const check = chestSatisfiesRequirements(elder);
  assert(check.done === true, `level ${level}: full chest reports done`);

  const result = tryLevelUp(elder);
  assert(result.done && result.leveledUpTo === level, `level ${level}: tryLevelUp advanced the village`);

  state = getVillageState(elder);
  assert(state.level === level, `level ${level}: elder dynamic property updated`);

  // chest should now be empty of the consumed items
  const container = chestBlock.getComponent("minecraft:inventory").container;
  const leftovers = container._raw.filter(Boolean);
  assert(leftovers.length === 0, `level ${level}: chest was fully consumed`);
}

// The legacy regression builds through its static L10 cap. A newly founded
// v2 village may continue only through the separately tested, resource-gated
// city path; it must not auto-build or crash at this boundary.
const past = chestSatisfiesRequirements(elder);
assert(!past.done && !past.finished, "v2 level 10 exposes a controlled L11 requirement path without auto-build");
console.log(effectiveRequirementsText(elder));

// --- Test 4: quest chains reward the player, track progress on the NPC, and discount only fires once the chain finishes ---
const player2 = __test__.makePlayer("Quester", { x: 5, y: 70, z: 5 });
const container2 = player2.getComponent("minecraft:inventory").container;

// find a fresh elder + a stand-in craftsman NPC for isolated chain testing
const elder2 = foundVillage(player2, { x: 5, y: 70, z: 5 }, 2);
const farmerNpc = elder2.dimension.spawnEntity("minecraft:villager_v2", { x: 5, y: 70, z: 5 });
farmerNpc.nameTag = "§bФермер§r";
const discountKey = `village:discount:3:minecraft:iron_ingot`;

// Step 1: not enough items yet
const tooFew = turnInQuest(player2, "Фермер", elder2, farmerNpc);
assert(tooFew.ok === false && tooFew.reason === "not_enough", "quest step 1: fails cleanly with no items");

// Step 1: give exactly the current balanced requirement, turn in
addCurrentQuestRequirement(container2, farmerNpc, "Фермер");
const step1 = turnInQuest(player2, "Фермер", elder2, farmerNpc);
assert(step1.ok === true && step1.chainComplete === false, "quest step 1: succeeds, chain not yet complete");
assert(elder2.getDynamicProperty(discountKey) === undefined, "quest step 1: no discount granted mid-chain");

// Step 2: current balanced requirement
addCurrentQuestRequirement(container2, farmerNpc, "Фермер");
const step2 = turnInQuest(player2, "Фермер", elder2, farmerNpc);
assert(step2.ok === true && step2.chainComplete === false, "quest step 2: succeeds, chain still not complete");

// Step 3: the current requirement unlocks the third upgrade, but final discount waits for step 5.
addCurrentQuestRequirement(container2, farmerNpc, "Фермер");
const step3 = turnInQuest(player2, "Фермер", elder2, farmerNpc);
assert(step3.ok === true && step3.chainComplete === false && step3.upgrade?.tier === 3,
  "quest step 3: unlocks the third craftsman upgrade");
assert(elder2.getDynamicProperty(discountKey) === undefined, "quest step 3: final discount is not granted early");

addCurrentQuestRequirement(container2, farmerNpc, "Фермер");
const step4 = turnInQuest(player2, "Фермер", elder2, farmerNpc);
assert(step4.ok === true && step4.chainComplete === false, "quest step 4: succeeds, chain continues");

const finalFixture = addCurrentQuestRequirement(container2, farmerNpc, "Фермер");
const step5 = turnInQuest(player2, "Фермер", elder2, farmerNpc);
assert(step5.ok === true && step5.chainComplete === true && step5.upgrade?.tier === 5,
  "quest step 5: completes the chain and unlocks the final upgrade");
const finalReward = container2.getItem(0);
assert(finalReward?.typeId === finalFixture.rewardItem && finalReward?.amount === finalFixture.rewardAmount,
  "quest step 5: grants exactly the configured moderate final reward");
assert(elder2.getDynamicProperty(discountKey) === 3, "quest chain completion recorded the correct discount amount");

// Re-visiting after the chain is done should report chain_complete, not restart it
const afterDone = turnInQuest(player2, "Фермер", elder2, farmerNpc);
assert(afterDone.ok === false && afterDone.reason === "chain_complete", "quest chain does not restart after completion");

const notEnough = turnInQuest(player2, "Кузнец", elder2, farmerNpc);
assert(notEnough.ok === false, "a different profession's quest fails cleanly against the wrong NPC state");

// --- Test 5: findNearestElder respects distance ---
const near = findNearestElder(elder.dimension, { x: 0, y: 70, z: 0 }, 15);
assert(!!near, "findNearestElder finds the elder within range");
const tooFar = findNearestElder(elder.dimension, { x: 5000, y: 70, z: 5000 }, 3);
assert(!tooFar, "findNearestElder returns null outside range");

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
