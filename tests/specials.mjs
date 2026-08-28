import { __test__ } from "@minecraft/server";
import { foundVillage, getVillageState } from "./scripts/village.js";
import { buildSpecialBuilding, specialBuildingSpec, spawnSpecialResident, ALCHEMIST_PRODUCTS, giveProduct } from "./scripts/specials.js";
import { SPECIAL_QUESTS, getSpecialQuestStep, turnInSpecialQuest } from "./scripts/special_content.js";

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

const player = __test__.makePlayer("SpecialTester", { x: 0, y: 70, z: 0 });
const elder = foundVillage(player, { x: 0, y: 70, z: 0 }, 0);
const state = { ...getVillageState(elder), elder };

for (const key of ["alchemist", "oldtimer", "ranger", "healer", "engineer"]) {
  const spec = specialBuildingSpec(key);
  assert(!!spec, `${key}: has a building specification`);
  const result = buildSpecialBuilding(key, elder.dimension, state);
  assert(result.ok && result.shape, `${key}: builds a shape`);
  assert(elder.getDynamicProperty(`village:specialBuilt:${key}`) === true, `${key}: records one-time build flag`);
  const npc = spawnSpecialResident(key, elder.dimension, { x: 0.5, y: 70, z: 0.5 }, state.id);
  assert(!!npc && npc.hasTag(spec.tag), `${key}: spawns a tagged resident`);
}

for (const key of ["ranger", "healer", "engineer"]) {
  const quest = SPECIAL_QUESTS[key];
  assert(quest.chain.length === 3, `${key}: has a three-step special quest`);
  assert(quest.building === key, `${key}: quest points to its own building`);
}

const oldtimer = elder.dimension.spawnEntity("minecraft:villager_v2", { x: 1, y: 70, z: 1 });
const inventory = player.getComponent("minecraft:inventory").container;
inventory.setItem(0, { typeId: "minecraft:oak_sapling", amount: 8 });
const step = turnInSpecialQuest(player, oldtimer, "ranger");
assert(step.ok && !step.complete, "ranger: first quest step turns in" );
assert(getSpecialQuestStep(oldtimer, "ranger") === 1, "ranger: progress persists on oldtimer" );

const alchemistResult = giveProduct(player, ALCHEMIST_PRODUCTS[2]);
assert(alchemistResult.ok === false, "alchemist: purchase fails without emeralds" );

console.log(failures === 0 ? "ALL SPECIAL TESTS PASSED" : `${failures} SPECIAL TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
