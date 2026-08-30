import { ItemStack, world, system } from "@minecraft/server";
import { buildSpecialBuilding, spawnSpecialResident, ALCHEMIST_PRODUCTS, giveProduct } from "./specials.js";
import { toWorld } from "./util.js";
import { PROP_ID, readFacing, readLevel, readOrigin, readProperty } from "./village_state.js";

export const SPECIAL_QUESTS = {
  ranger: {
    title: "Тропа через заросли",
    building: "ranger",
    chain: [
      { question: "Старожила просит 8 саженцев, 16 костной муки и 8 фонарей для восстановления лесной тропы.", item: "minecraft:oak_sapling", amount: 8, reward: "minecraft:bone_meal", rewardAmount: 8 },
      { question: "Принеси 16 брёвен и 8 компостеров: лесничему нужен питомник.", item: "minecraft:oak_log", amount: 16, reward: "minecraft:lantern", rewardAmount: 4 },
      { question: "Принеси карту и 4 изумруда, чтобы отметить безопасную дорогу.", item: "minecraft:empty_map", amount: 1, reward: "minecraft:iron_axe", rewardAmount: 1 }
    ],
    complete: "Лесная тропа снова открыта. Теперь деревня будет помнить, откуда приходит древесина."
  },
  healer: {
    title: "Клятва под старым колоколом",
    building: "healer",
    chain: [
      { question: "Нужны 8 бутылок, 4 красных гриба и 2 блока сена для первого лазарета.", item: "minecraft:glass_bottle", amount: 8, reward: "minecraft:bread", rewardAmount: 6 },
      { question: "Принеси 6 золотых слитков: лекарю нужны инструменты, а не пустые обещания.", item: "minecraft:gold_ingot", amount: 6, reward: "minecraft:potion", rewardAmount: 1 },
      { question: "Принеси зелье лечения и 4 изумруда, чтобы вернуть лекаря в деревню.", item: "minecraft:potion", amount: 1, reward: "minecraft:golden_apple", rewardAmount: 1 }
    ],
    complete: "Лазарет снова принимает больных. Не трать здоровье зря — теперь его есть кому сохранить."
  },
  engineer: {
    title: "Механизм, остановивший ворота",
    building: "engineer",
    chain: [
      { question: "Принеси 24 красного камня и 8 железных слитков для восстановления старого механизма.", item: "minecraft:redstone", amount: 24, reward: "minecraft:lever", rewardAmount: 4 },
      { question: "Нужны 4 поршня и 2 компаса: инженер должен заново найти ось ворот.", item: "minecraft:piston", amount: 4, reward: "minecraft:repeater", rewardAmount: 2 },
      { question: "Принеси 2 наблюдателя и 8 изумрудов. После этого мастерская заработает.", item: "minecraft:observer", amount: 2, reward: "minecraft:redstone_lamp", rewardAmount: 2 }
    ],
    complete: "Старый механизм снова щёлкнул. Ворота больше не будут зависеть от одной ржавой петли."
  }
};

function count(container, typeId) {
  let total = 0;
  for (let i = 0; i < container.size; i++) {
    const stack = container.getItem(i);
    if (stack?.typeId === typeId) total += stack.amount;
  }
  return total;
}

function remove(container, typeId, amount) {
  let remaining = amount;
  for (let i = 0; i < container.size && remaining > 0; i++) {
    const stack = container.getItem(i);
    if (!stack || stack.typeId !== typeId) continue;
    const take = Math.min(remaining, stack.amount);
    remaining -= take;
    if (take >= stack.amount) container.setItem(i, undefined);
    else { stack.amount -= take; container.setItem(i, stack); }
  }
}

function elderState(elder) {
  return {
    elder,
    origin: readOrigin(elder),
    facing: readFacing(elder),
    id: readProperty(elder, PROP_ID)
  };
}

function spawnIfNeeded(elder, key, shape) {
  if (elder.getDynamicProperty(`village:specialSpawned:${key}`)) return;
  const p = toWorld(elderState(elder).origin, elderState(elder).facing, shape.centerF, shape.centerS, 0);
  try {
    spawnSpecialResident(key, elder.dimension, { x: p.x + 0.5, y: p.y, z: p.z + 0.5 }, elderState(elder).id);
    elder.setDynamicProperty(`village:specialSpawned:${key}`, true);
  } catch (e) {
    console.warn(`[village] special resident ${key} failed: ${e}`);
  }
}

function ensureSpecialBuildings(elder) {
  const level = readLevel(elder);
  const built = [];
  const state = elderState(elder);
  if (level >= 6 && !elder.getDynamicProperty("village:specialBuilt:alchemist")) {
    const result = buildSpecialBuilding("alchemist", elder.dimension, state);
    if (result.ok) { spawnIfNeeded(elder, "alchemist", result.shape); built.push("Домик алхимика"); }
  }
  if (level >= 8 && !elder.getDynamicProperty("village:specialBuilt:oldtimer")) {
    const result = buildSpecialBuilding("oldtimer", elder.dimension, state);
    if (result.ok) { spawnIfNeeded(elder, "oldtimer", result.shape); built.push("Домик старожилы"); }
  }
  return built;
}

function getSpecialQuest(key) { return SPECIAL_QUESTS[key] || null; }

export function getSpecialQuestStep(oldtimer, key) {
  return oldtimer?.getDynamicProperty(`village:specialQuest:${key}`) || 0;
}

export function turnInSpecialQuest(player, oldtimer, key) {
  const quest = getSpecialQuest(key);
  if (!quest) return { ok: false, reason: "unknown_quest" };
  const step = getSpecialQuestStep(oldtimer, key);
  if (step >= quest.chain.length) return { ok: false, reason: "complete", quest };
  const current = quest.chain[step];
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return { ok: false, reason: "no_inventory" };
  const have = count(container, current.item);
  if (have < current.amount) return { ok: false, reason: "not_enough", have, need: current.amount, item: current.item, current, quest };
  remove(container, current.item, current.amount);
  if (current.reward) container.addItem(new ItemStack(current.reward, current.rewardAmount));
  const next = step + 1;
  oldtimer.setDynamicProperty(`village:specialQuest:${key}`, next);
  let build = null;
  if (next >= quest.chain.length) {
    build = buildSpecialBuilding(quest.building, oldtimer.dimension, elderState(oldtimer));
    if (build.ok && build.shape) spawnIfNeeded(oldtimer, quest.building, build.shape);
  }
  return { ok: true, quest, current, step: next, complete: next >= quest.chain.length, build };
}

export function alchemistProducts() { return ALCHEMIST_PRODUCTS; }

export function buyAlchemistProduct(player, productIndex) {
  const product = ALCHEMIST_PRODUCTS[productIndex];
  return giveProduct(player, product);
}

export function startSpecialContentLoop() {
  system.runInterval(() => {
    let elders;
    try { elders = world.getDimension("overworld").getEntities({ tags: ["village_elder"] }); }
    catch (e) { return; }
    for (const elder of elders) {
      try { ensureSpecialBuildings(elder); } catch (e) { console.warn(`[village] special content loop: ${e}`); }
    }
  }, 100);
}

export { SPECIAL_BUILDINGS } from "./specials.js";
