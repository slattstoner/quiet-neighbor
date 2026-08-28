import { __test__, ItemStack } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { QUESTS } from "./scripts/quests.js";
import { openCraftsmanMenu } from "./scripts/ui.js";

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

function scenario() {
  const dim = __test__.makeDimension();
  const elder = dim.spawnEntity("minecraft:villager_v2", { x: 0, y: 70, z: 0 });
  elder.addTag("village:ui"); elder.addTag("village_elder"); elder.setDynamicProperty("village:level", 2);
  const npc = dim.spawnEntity("minecraft:villager_v2", { x: 2, y: 70, z: 0 });
  npc.addTag("village:ui"); npc.addTag("village_crafter"); npc.setDynamicProperty("village:roleId", "farmer"); npc.setDynamicProperty("quest_step", 0);
  const player = __test__.makePlayer("ui-player", { x: 1, y: 70, z: 0 }); player.dimension = dim;
  return { elder, npc, player, container: player.getComponent("minecraft:inventory").container };
}

const originalActionShow = ActionFormData.prototype.show;
const originalMessageShow = MessageFormData.prototype.show;
try {
  console.log("\n=== cancel is read-only ===");
  const canceled = scenario();
  const beforeLevel = canceled.elder.getDynamicProperty("village:level");
  const beforeStep = canceled.npc.getDynamicProperty("quest_step");
  ActionFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
  await openCraftsmanMenu(canceled.player, canceled.npc);
  assert(canceled.elder.getDynamicProperty("village:level") === beforeLevel && canceled.npc.getDynamicProperty("quest_step") === beforeStep,
    "canceled craft quest form changes no village or quest state");

  console.log("\n=== stale reply is revalidated ===");
  const stale = scenario();
  const required = QUESTS["Фермер"].chain[0];
  stale.container.setItem(0, new ItemStack(required.requiredItem, required.requiredAmount));
  const staleBefore = count(stale.container, required.requiredItem);
  let staleShows = 0;
  ActionFormData.prototype.show = async () => {
    staleShows++;
    if (staleShows === 1) {
      stale.npc.setDynamicProperty("quest_step", 1);
      return { canceled: false, selection: 0 };
    }
    return { canceled: true, selection: 0 };
  };
  MessageFormData.prototype.show = async () => ({ canceled: true, selection: 0 });
  await openCraftsmanMenu(stale.player, stale.npc);
  assert(count(stale.container, required.requiredItem) === staleBefore && stale.npc.getDynamicProperty("quest_step") === 1,
    "stale UI reply does not consume items or overwrite newer legacy state");

  console.log("\n=== confirmed submission stays single-commit ===");
  const confirmed = scenario();
  confirmed.container.setItem(0, new ItemStack(required.requiredItem, required.requiredAmount));
  let confirmedShows = 0;
  ActionFormData.prototype.show = async () => ({ canceled: false, selection: 0 });
  MessageFormData.prototype.show = async () => { confirmedShows++; return { canceled: true, selection: 0 }; };
  await openCraftsmanMenu(confirmed.player, confirmed.npc);
  assert(confirmed.npc.getDynamicProperty("quest_step") === 1 && count(confirmed.container, required.requiredItem) === 0,
    "confirmed UI submission commits the exact active legacy step once");
  assert(confirmedShows === 1, "successful submission shows one localised completion message");

  console.log("\n=== invalid NPC is neutral ===");
  await openCraftsmanMenu(confirmed.player, null);
  assert(confirmed.npc.getDynamicProperty("quest_step") === 1, "invalid NPC open does not disturb existing quest state");
} finally {
  ActionFormData.prototype.show = originalActionShow;
  MessageFormData.prototype.show = originalMessageShow;
}

console.log(failures === 0 ? "\nALL CRAFTSMAN QUEST UI TESTS PASSED" : `\n${failures} CRAFTSMAN QUEST UI TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
