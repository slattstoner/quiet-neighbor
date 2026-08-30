import { __test__, ItemStack } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { QUESTS } from "./scripts/quests.js";
import { SENTINEL_ARC } from "./scripts/sentinel_quests.js";
import { openCraftsmanMenu, openSentinelMenu } from "./scripts/ui.js";

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}
function count(container, itemId) {
  let total = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === itemId) total += stack.amount;
  }
  return total;
}

let seq = 0;
function scenario({ level = 6, sentinelStep = 0, craftsmanStep = 0, roleId = "blacksmith" } = {}) {
  const dim = __test__.makeDimension();
  const tag = `village:sentinel_ui_${++seq}`;
  const elder = dim.spawnEntity("minecraft:villager_v2", { x: 0, y: 70, z: 0 });
  elder.addTag(tag); elder.addTag("village_elder");
  elder.setDynamicProperty("village:level", level);
  elder.setDynamicProperty("village:sentinel:step", sentinelStep);
  const guard = dim.spawnEntity("minecraft:villager_v2", { x: 2, y: 70, z: 0 });
  guard.addTag(tag); guard.addTag("village_guard");
  guard.setDynamicProperty("village:roleId", "sentinel");
  const npc = dim.spawnEntity("minecraft:villager_v2", { x: 4, y: 70, z: 0 });
  npc.addTag(tag); npc.addTag("village_crafter");
  npc.setDynamicProperty("village:roleId", roleId);
  npc.setDynamicProperty("quest_step", craftsmanStep);
  const player = __test__.makePlayer(`sentinel-ui-${seq}`, { x: 1, y: 70, z: 0 });
  player.dimension = dim;
  return { elder, guard, npc, player, container: player.getComponent("minecraft:inventory").container };
}

function stock(container, requirements) {
  for (const requirement of requirements) container.addItem(new ItemStack(requirement.itemId, requirement.amount));
}

const originalActionShow = ActionFormData.prototype.show;
const originalMessageShow = MessageFormData.prototype.show;
try {
  console.log("\n=== the watchman's own tap ===");
  {
    const watch = scenario();
    stock(watch.container, SENTINEL_ARC.steps[0].requirements);
    let actionShows = 0;
    ActionFormData.prototype.show = async () => { actionShows++; return { canceled: false, selection: 0 }; };
    MessageFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    await openSentinelMenu(watch.player, watch.guard);
    assert(actionShows === 1 && watch.elder.getDynamicProperty("village:sentinel:step") === 1,
      "tapping the watchman on his own step commits it exactly once");
    assert(count(watch.container, "minecraft:torch") === 0, "the step's items were taken");
  }

  console.log("\n=== cancel stays read-only ===");
  {
    const canceled = scenario();
    stock(canceled.container, SENTINEL_ARC.steps[0].requirements);
    ActionFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    MessageFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    await openSentinelMenu(canceled.player, canceled.guard);
    assert(canceled.elder.getDynamicProperty("village:sentinel:step") === 0 &&
      count(canceled.container, "minecraft:torch") === 16,
      "closing the watchman's form changes nothing");
  }

  console.log("\n=== the watchman while the run is elsewhere ===");
  {
    // Step 2 waits at the blacksmith; the watchman must report that without
    // ever offering a turn-in form of his own.
    const away = scenario({ sentinelStep: 1 });
    stock(away.container, SENTINEL_ARC.steps[1].requirements);
    let actionShows = 0;
    ActionFormData.prototype.show = async () => { actionShows++; return { canceled: false, selection: 0 }; };
    MessageFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    await openSentinelMenu(away.player, away.guard);
    assert(actionShows === 0 && away.elder.getDynamicProperty("village:sentinel:step") === 1,
      "the watchman only points at the craftsman holding the open step");
    assert(count(away.container, "minecraft:iron_ingot") === 8, "nothing is taken at the wrong NPC");
  }

  console.log("\n=== craftsman hub routing ===");
  {
    // Blacksmith holds courier step 2 and his own step 1 at the same time.
    const hub = scenario({ sentinelStep: 1, craftsmanStep: 0 });
    const ownStep = QUESTS["Кузнец"].chain[0];
    stock(hub.container, SENTINEL_ARC.steps[1].requirements);
    hub.container.addItem(new ItemStack(ownStep.requiredItem, ownStep.requiredAmount));
    let buttonCounts = [];
    ActionFormData.prototype.show = async function () {
      buttonCounts.push(this._buttons);
      return { canceled: false, selection: 0 };
    };
    MessageFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    await openCraftsmanMenu(hub.player, hub.npc);
    assert(buttonCounts[0] === 3, `the hub offers courier, own errand and cancel (${buttonCounts[0]} buttons)`);
    assert(hub.elder.getDynamicProperty("village:sentinel:step") === 2 && hub.npc.getDynamicProperty("quest_step") === 0,
      "hub button 0 runs the courier step and leaves the craftsman's own chain alone");
    assert(count(hub.container, ownStep.requiredItem) === ownStep.requiredAmount,
      "the craftsman's own requirement was not consumed by the courier step");
  }

  {
    const hub = scenario({ sentinelStep: 1, craftsmanStep: 0 });
    const ownStep = QUESTS["Кузнец"].chain[0];
    stock(hub.container, SENTINEL_ARC.steps[1].requirements);
    hub.container.addItem(new ItemStack(ownStep.requiredItem, ownStep.requiredAmount));
    // First form is the hub (button 1 = the craftsman's own errand); the
    // second is his own quest form, where button 0 is the turn-in.
    let shows = 0;
    ActionFormData.prototype.show = async () => ({ canceled: false, selection: shows++ === 0 ? 1 : 0 });
    MessageFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    await openCraftsmanMenu(hub.player, hub.npc);
    assert(shows === 2, `the own-errand button opens the craftsman's own form (${shows} forms shown)`);
    assert(hub.npc.getDynamicProperty("quest_step") === 1 && hub.elder.getDynamicProperty("village:sentinel:step") === 1,
      "hub button 1 runs the craftsman's own step and leaves the courier run alone");
    assert(count(hub.container, "minecraft:flint") === 8, "the courier requirement was not consumed by the own step");
  }

  {
    // Own chain already finished: the hub drops to one quest button, and the
    // courier step must still sit at index 0 rather than shifting.
    const soloCourier = scenario({ sentinelStep: 1, craftsmanStep: 5 });
    stock(soloCourier.container, SENTINEL_ARC.steps[1].requirements);
    let buttons = 0;
    ActionFormData.prototype.show = async function () { buttons = this._buttons; return { canceled: false, selection: 0 }; };
    MessageFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    await openCraftsmanMenu(soloCourier.player, soloCourier.npc);
    assert(buttons === 2, `a finished craftsman chain leaves courier and cancel only (${buttons} buttons)`);
    assert(soloCourier.elder.getDynamicProperty("village:sentinel:step") === 2,
      "the courier step still commits from the first button");
  }

  console.log("\n=== craftsman with no courier step is untouched ===");
  {
    const plain = scenario({ sentinelStep: 0, craftsmanStep: 0 });
    const ownStep = QUESTS["Кузнец"].chain[0];
    plain.container.addItem(new ItemStack(ownStep.requiredItem, ownStep.requiredAmount));
    let buttons = 0;
    ActionFormData.prototype.show = async function () { buttons = this._buttons; return { canceled: false, selection: 0 }; };
    MessageFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
    await openCraftsmanMenu(plain.player, plain.npc);
    assert(buttons === 2 && plain.npc.getDynamicProperty("quest_step") === 1,
      "with the courier run waiting elsewhere the craftsman menu is exactly what it always was");
    assert(plain.elder.getDynamicProperty("village:sentinel:step") === 0, "and it never advances the courier run");
  }
} finally {
  ActionFormData.prototype.show = originalActionShow;
  MessageFormData.prototype.show = originalMessageShow;
}

console.log(failures === 0 ? "\nALL SENTINEL UI TESTS PASSED" : `\n${failures} SENTINEL UI TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
