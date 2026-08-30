import { __test__, ItemStack } from "@minecraft/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QUESTS } from "./scripts/quests.js";
import { SPECIAL_QUESTS } from "./scripts/special_content.js";
import {
  SENTINEL_ARC,
  getSentinelArcStep,
  getSentinelArcView,
  resolveSentinelArcRole,
  sentinelRoleLocalizationKey,
  sentinelStepAwaits,
  tryCompleteSentinelTurnIn,
  validateSentinelTurnIn
} from "./scripts/sentinel_quests.js";

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

let villageSeq = 0;
/**
 * One village with an elder, a tower guard and all four craftsmen, all sharing
 * a village tag unique to this fixture - the mock's dimension is a singleton,
 * so two fixtures using the same tag would find each other's elder.
 */
function makeVillage(level, step) {
  const dim = __test__.makeDimension();
  const villageTag = `village:sentinel_test_${++villageSeq}`;
  const elder = dim.spawnEntity("minecraft:villager_v2", { x: 0, y: 70, z: 0 });
  elder.addTag(villageTag); elder.addTag("village_elder");
  elder.setDynamicProperty("village:level", level);
  if (step !== undefined) elder.setDynamicProperty("village:sentinel:step", step);

  const guard = dim.spawnEntity("minecraft:villager_v2", { x: 2, y: 70, z: 0 });
  guard.addTag(villageTag); guard.addTag("village_guard"); guard.addTag("village_npc");
  guard.setDynamicProperty("village:roleId", "sentinel");

  const craftsmen = {};
  let offset = 4;
  for (const roleId of ["blacksmith", "cartographer", "farmer", "miner"]) {
    const npc = dim.spawnEntity("minecraft:villager_v2", { x: offset++, y: 70, z: 0 });
    npc.addTag(villageTag); npc.addTag("village_crafter");
    npc.setDynamicProperty("village:roleId", roleId);
    npc.setDynamicProperty("quest_step", 0);
    craftsmen[roleId] = npc;
  }

  const player = __test__.makePlayer(`sentinel-${villageSeq}`, { x: 1, y: 70, z: 0 });
  player.dimension = dim;
  const container = player.getComponent("minecraft:inventory").container;
  return { dim, villageTag, elder, guard, craftsmen, player, container, npcFor(roleId) { return roleId === "sentinel" ? guard : craftsmen[roleId]; } };
}

function clear(container) {
  for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined);
}
function count(container, itemId) {
  let total = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === itemId) total += stack.amount;
  }
  return total;
}
function findStack(container, itemId) {
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === itemId) return stack;
  }
  return undefined;
}
function stockRequirements(container, step) {
  for (const requirement of step.requirements) container.addItem(new ItemStack(requirement.itemId, requirement.amount));
}
function packFullInventory(container) {
  for (let slot = 0; slot < container.size; slot++) {
    if (!container.getItem(slot)) container.setItem(slot, new ItemStack("minecraft:cobblestone", 64));
  }
}

// ---------------------------------------------------------------- arc shape
console.log("\n=== courier arc shape and balance ===");
const EXPECTED_GIVERS = ["sentinel", "blacksmith", "cartographer", "farmer", "miner", "sentinel"];
const FORBIDDEN = new Set([
  "minecraft:diamond", "minecraft:emerald", "minecraft:netherite_ingot", "minecraft:netherite_scrap",
  "minecraft:enchanted_golden_apple", "minecraft:diamond_sword", "minecraft:diamond_pickaxe",
  "minecraft:enchanted_book", "minecraft:potion", "minecraft:golden_apple"
]);

assert(SENTINEL_ARC.steps.length === 6, `the arc has six courier steps (${SENTINEL_ARC.steps.length})`);
assert(SENTINEL_ARC.minLevel === 6, "the arc unlocks at level 6, once the miner exists");
assert(SENTINEL_ARC.steps.map((step) => step.giverRoleId).join(",") === EXPECTED_GIVERS.join(","),
  "each step is handed in to a different NPC, ending back at the watchman");
assert(new Set(SENTINEL_ARC.steps.map((step) => step.id)).size === 6, "step ids are unique");
assert(SENTINEL_ARC.steps.every((step, index) =>
  index === SENTINEL_ARC.steps.length - 1
    ? step.nextGiverRoleId === null
    : step.nextGiverRoleId === EXPECTED_GIVERS[index + 1]),
  "every step points at the NPC the player is sent to next");

for (const step of SENTINEL_ARC.steps) {
  assert(step.requirements.length > 0 && step.requirements.every((entry) =>
    entry.itemId.startsWith("minecraft:") && Number.isInteger(entry.amount) && entry.amount >= 1 && entry.amount <= 24),
    `step ${step.number} asks for bounded vanilla items`);
  assert(step.requirements.every((entry) => !FORBIDDEN.has(entry.itemId)),
    `step ${step.number} never charges high-tier loot`);
  assert(step.rewards.every((entry) => !FORBIDDEN.has(entry.itemId)),
    `step ${step.number} never pays out high-tier loot`);
  // Every requirement and reward id must be constructible - a typo'd id would
  // otherwise just be a requirement no inventory can ever satisfy.
  for (const entry of [...step.requirements, ...step.rewards]) {
    let built = null;
    try { built = new ItemStack(entry.itemId, entry.amount); } catch (error) { built = null; }
    assert(!!built, `step ${step.number}: ${entry.itemId} is a real Bedrock item id`);
  }
}

const finalStep = SENTINEL_ARC.steps[5];
assert(finalStep.rewards.length === 2 &&
  finalStep.rewards.some((entry) => entry.itemId === "minecraft:empty_map" && entry.stackable === false) &&
  finalStep.rewards.some((entry) => entry.itemId === "minecraft:bow" && entry.stackable === false),
  "the last step is the only one paying out the watchman's map and bow");
assert(SENTINEL_ARC.steps.slice(0, 5).every((step) =>
  step.rewards.every((entry) => entry.itemId !== "minecraft:empty_map" && entry.itemId !== "minecraft:bow")),
  "no mid-arc step leaks the final keepsakes");

// -------------------------------------------------- non-existent item id fix
console.log("\n=== quest requirements use real Bedrock item ids ===");
for (const [role, quest] of Object.entries(QUESTS)) {
  for (const [index, step] of quest.chain.entries()) {
    let ok = true;
    try { new ItemStack(step.requiredItem, step.requiredAmount); } catch (error) { ok = false; }
    assert(ok, `${role} step ${index + 1} requires a constructible item (${step.requiredItem})`);
  }
}
for (const [key, quest] of Object.entries(SPECIAL_QUESTS)) {
  for (const [index, step] of quest.chain.entries()) {
    let ok = true;
    try { new ItemStack(step.item, step.amount); } catch (error) { ok = false; }
    assert(ok, `special quest ${key} step ${index + 1} requires a constructible item (${step.item})`);
  }
}

// ------------------------------------------------------------------- gating
console.log("\n=== level gate and role resolution ===");
{
  const locked = makeVillage(5);
  const view = getSentinelArcView(locked.guard, locked.elder);
  assert(view.ok && view.status === "locked", "below level 6 the watchman's arc reports locked");
  stockRequirements(locked.container, SENTINEL_ARC.steps[0]);
  const blocked = tryCompleteSentinelTurnIn(locked.guard, locked.elder, locked.player);
  assert(!blocked.ok && blocked.reason === "locked", "a locked arc refuses a turn-in even with the items in hand");
  assert(count(locked.container, "minecraft:torch") === 16, "a refused turn-in consumes nothing");

  assert(resolveSentinelArcRole(locked.guard) === "sentinel", "a tower guard resolves to the sentinel role");
  assert(resolveSentinelArcRole(locked.craftsmen.miner) === "miner", "a craftsman still resolves to his own role");
}

// ------------------------------------------------------- wrong-NPC handling
console.log("\n=== the open step belongs to exactly one NPC ===");
{
  const village = makeVillage(6);
  const atSmith = getSentinelArcView(village.craftsmen.blacksmith, village.elder);
  assert(atSmith.ok && atSmith.status === "elsewhere" && atSmith.waitingRoleId === "sentinel",
    "step 1 shows up at the blacksmith as waiting at the watchman");
  assert(sentinelStepAwaits(village.craftsmen.blacksmith, village.elder) === null,
    "a craftsman who does not own the open step offers no courier button");
  stockRequirements(village.container, SENTINEL_ARC.steps[0]);
  const wrong = tryCompleteSentinelTurnIn(village.craftsmen.blacksmith, village.elder, village.player);
  assert(!wrong.ok && wrong.reason === "wrong_giver", "handing step 1 to the blacksmith is refused");
  assert(getSentinelArcStep(village.elder) === 0 && count(village.container, "minecraft:torch") === 16,
    "the refused hand-in left both the arc and the inventory untouched");

  const stale = tryCompleteSentinelTurnIn(village.guard, village.elder, village.player, "arc.sentinel.signal_fire.step_04");
  assert(!stale.ok && stale.reason === "stale_state", "a step id from a stale menu is refused");
  assert(getSentinelArcStep(village.elder) === 0, "the stale hand-in did not advance the arc");
}

// ------------------------------------------------------ village scoping
console.log("\n=== arc progress is village-wide, not per NPC ===");
{
  const village = makeVillage(6);
  const secondGuard = village.dim.spawnEntity("minecraft:villager_v2", { x: 3, y: 70, z: 0 });
  secondGuard.addTag(village.villageTag); secondGuard.addTag("village_guard");
  secondGuard.setDynamicProperty("village:roleId", "sentinel");

  clear(village.container);
  stockRequirements(village.container, SENTINEL_ARC.steps[0]);
  assert(tryCompleteSentinelTurnIn(village.guard, village.elder, village.player).ok, "step 1 hands in at the first tower");
  const atSecond = getSentinelArcView(secondGuard, village.elder);
  assert(atSecond.ok && atSecond.status === "elsewhere" && atSecond.waitingRoleId === "blacksmith",
    "the guard in another tower sees the same advanced step, not a fresh one");

  const other = makeVillage(6);
  const crossView = getSentinelArcView(other.guard, village.elder);
  assert(!crossView.ok && crossView.reason === "different_village",
    "a guard from another village is never served by this village's elder");
}

// --------------------------------------------------------- inventory safety
console.log("\n=== rewards are all-or-nothing ===");
{
  // The two named keepsakes cannot merge into an existing stack, so they need
  // two genuinely empty slots. Handing over one bow frees exactly one slot;
  // the sinew comes out of a full stack that stays put, so the second slot
  // never appears - which is the case that has to be refused before anything
  // is taken, rather than half-committed.
  const village = makeVillage(6, 5);
  clear(village.container);
  village.container.setItem(0, new ItemStack("minecraft:bow", 1));
  village.container.setItem(1, new ItemStack("minecraft:string", 64));
  packFullInventory(village.container);
  const tooFull = tryCompleteSentinelTurnIn(village.guard, village.elder, village.player);
  assert(!tooFull.ok && tooFull.reason === "inventory_full",
    "the final step refuses to run when the two keepsakes have nowhere to go");
  assert(getSentinelArcStep(village.elder) === 5 &&
    count(village.container, "minecraft:string") === 64 && count(village.container, "minecraft:bow") === 1,
    "the refused final step consumed neither the bow nor the sinew");

  // Free one more slot and the very same hand-in goes through, which is what
  // proves the refusal above was about space and not about the step itself.
  village.container.setItem(village.container.size - 1, undefined);
  const roomy = tryCompleteSentinelTurnIn(village.guard, village.elder, village.player);
  assert(roomy.ok && roomy.arcComplete, "with one more free slot the same final step completes");
  assert(!!findStack(village.container, "minecraft:empty_map") &&
    findStack(village.container, "minecraft:bow").nameTag === "§bСигнальный лук дозорного",
    "both keepsakes landed in their own slots");
}

// ------------------------------------------------------------- happy path
console.log("\n=== full courier run, watchman to watchman ===");
{
  const village = makeVillage(6);
  clear(village.container);
  const lang = new Map();
  for (const line of readFileSync(fileURLToPath(new URL("../GrowingVillages_RP/texts/ru_RU.lang", import.meta.url)), "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("growing_villages.")) continue;
    lang.set(trimmed.slice(0, trimmed.indexOf("=")), trimmed.slice(trimmed.indexOf("=") + 1));
  }

  for (const [index, step] of SENTINEL_ARC.steps.entries()) {
    const npc = village.npcFor(step.giverRoleId);
    const view = getSentinelArcView(npc, village.elder);
    assert(view.ok && view.status === "active" && view.stepId === step.id,
      `step ${step.number} is active at the ${step.giverRoleId}`);
    assert([view.arc.localization.title, view.arc.localization.intro, step.localization.title,
      step.localization.intro, step.localization.complete].every((key) => lang.has(key)),
      `step ${step.number} has its localised text`);

    const short = validateSentinelTurnIn(npc, village.elder, village.player, step.id);
    assert(!short.ok && short.reason === "not_enough", `step ${step.number} refuses an empty-handed player`);

    stockRequirements(village.container, step);
    const result = tryCompleteSentinelTurnIn(npc, village.elder, village.player, step.id);
    assert(result.ok, `step ${step.number} hands in cleanly`);
    assert(getSentinelArcStep(village.elder) === index + 1, `step ${step.number} advanced the village-wide counter`);
    assert(result.nextGiverRoleId === step.nextGiverRoleId, `step ${step.number} names the next NPC to visit`);
    for (const requirement of step.requirements) {
      const leftover = count(village.container, requirement.itemId);
      const expected = requirement.itemId === "minecraft:bow" ? 1 : 0;
      assert(leftover === expected, `step ${step.number} consumed exactly its ${requirement.itemId}`);
    }
    for (const reward of step.rewards) {
      if (reward.craft) continue;
      assert(count(village.container, reward.itemId) >= reward.amount, `step ${step.number} paid out ${reward.itemId}`);
    }
    if (!result.arcComplete) clear(village.container);
  }

  assert(SENTINEL_ARC.steps.every((step) => lang.has(sentinelRoleLocalizationKey(step.giverRoleId))),
    "every giver role has a localised name for the go-see hint");

  const map = findStack(village.container, "minecraft:empty_map");
  assert(!!map && map.nameTag === "§bКарта дозорного" && map.getLore().length > 0,
    "the watchman's map arrives named, with lore");
  const bow = findStack(village.container, "minecraft:bow");
  assert(!!bow && bow.nameTag === "§bСигнальный лук дозорного", "the signal bow arrives named");
  const enchantments = bow?.getComponent("minecraft:enchantable")?.getEnchantments() || [];
  const byId = new Map(enchantments.map((entry) => [entry.type.id, entry.level]));
  assert(byId.get("minecraft:flame") === 1 && byId.get("minecraft:power") === 1 && byId.get("minecraft:unbreaking") === 2,
    `the signal bow carries exactly Flame I, Power I and Unbreaking II (${[...byId].map(([id, level]) => `${id}=${level}`).join(", ")})`);
  assert(!byId.has("minecraft:infinity") && (byId.get("minecraft:power") || 0) <= 1,
    "the signal bow stays below what an enchanting table already gives");

  const done = getSentinelArcView(village.guard, village.elder);
  assert(done.ok && done.status === "complete", "the arc reports complete once the answer comes back");
  const replay = tryCompleteSentinelTurnIn(village.guard, village.elder, village.player);
  assert(!replay.ok && replay.reason === "arc_complete", "a finished arc cannot be run a second time");
}

console.log(failures === 0 ? "\nALL SENTINEL QUEST TESTS PASSED" : `\n${failures} SENTINEL QUEST TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
