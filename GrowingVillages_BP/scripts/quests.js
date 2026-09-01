import { ItemStack } from "@minecraft/server";
import { placeReward, restoreContainer, snapshotContainer } from "./inventory.js";

/**
 * Quest progress belongs to a craftsman, not one player.  The stable legacy
 * quest_step index remains authoritative; this table only rebalances the
 * active requirement/reward at that same index for incomplete arcs.
 */
export const QUESTS = {
  "Фермер": {
    title: "Земля, которая помнит",
    chain: [
      { question: "Эта земля давно не родила. Принеси 12 пшеницы — поднимем первое большое поле и проверим, принимает ли она деревню после Долгой Зимы.", requiredItem: "minecraft:wheat", requiredAmount: 12, rewardItem: null, rewardAmount: 0, thanksLine: "Взошло. Значит, земля нас не прогнала.", upgrade: { tier: 1, label: "Большое поле" } },
      { question: "Первый урожай привлёк кур. Принеси 16 морковок — сделаем кормушки и курятник для яиц и перьев.", requiredItem: "minecraft:carrot", requiredAmount: 16, rewardItem: null, rewardAmount: 0, thanksLine: "Слышишь кудахтанье? Теперь у нас есть яйца и перья.", upgrade: { tier: 2, label: "Курятник" } },
      { question: "Одного зерна мало для зимы. Принеси 16 блоков сена — расширим хозяйство и подготовим сухое место для коров.", requiredItem: "minecraft:hay_block", requiredAmount: 16, rewardItem: null, rewardAmount: 0, thanksLine: "Грядки полны, а стойла готовы. Молоко переживёт любую метель.", upgrade: { tier: 3, label: "Коровник" } },
      { question: "Двору нужен запас пищи. Принеси 24 хлеба — подготовим загон и общий стол для работников.", requiredItem: "minecraft:bread", requiredAmount: 24, rewardItem: null, rewardAmount: 0, thanksLine: "Свиньи в загоне, поле цело, а двор больше не боится дождя.", upgrade: { tier: 4, label: "Свинарник" } },
      { question: "Все животные требуют общего места хранения. Принеси 24 тыквы — закончим амбарный двор и поставим хозяйство на ноги.", requiredItem: "minecraft:pumpkin", requiredAmount: 24, rewardItem: "minecraft:lantern", rewardAmount: 4, thanksLine: "Куры кудахчут, коровы мычат, свиньи не топчут грядки. Деревня умеет себя прокормить.", upgrade: { tier: 5, label: "Амбарный двор" } }
    ],
    discountLevel: 3, discountItem: "minecraft:iron_ingot", discountAmount: 3,
    allDoneLine: "Поля дышат, скотина сыта, а амбар полон. Спасибо тебе, чужак."
  },
  "Кузнец": {
    title: "Наковальня, которая молчала",
    chain: [
      { question: "Горн потух в ту зиму. Принеси 16 булыжника — вернём ему огонь и сложим безопасный очаг.", requiredItem: "minecraft:cobblestone", requiredAmount: 16, rewardItem: null, rewardAmount: 0, thanksLine: "Загудел. Теперь огонь не погаснет от первого дождя.", upgrade: { tier: 1, label: "Угольный навес" } },
      { question: "Инструменты нужны строителям и фермеру. Принеси 16 угля — откроем кузнечный двор для тяжёлой работы.", requiredItem: "minecraft:coal", requiredAmount: 16, rewardItem: null, rewardAmount: 0, thanksLine: "Двор готов. Здесь деревня будет чинить то, что помогает ей расти.", upgrade: { tier: 2, label: "Кузнечный двор" } },
      { question: "Стены растут, и дозорным нужен порядок. Принеси 8 железных слитков — соберём оружейный стеллаж и место для закалки.", requiredItem: "minecraft:iron_ingot", requiredAmount: 8, rewardItem: null, rewardAmount: 0, thanksLine: "Теперь у стражи есть место для снаряжения, а у кузнеца — порядок в работе.", upgrade: { tier: 3, label: "Оружейный стеллаж" } },
      { question: "Дождь губит меха и ржавит заготовки. Принеси 12 каменных кирпичей — поставим крышу и защиту над горном.", requiredItem: "minecraft:stone_bricks", requiredAmount: 12, rewardItem: null, rewardAmount: 0, thanksLine: "Меха ходят ровно, а дождь больше не вмешивается в работу.", upgrade: { tier: 4, label: "Крытый горн" } },
      { question: "Последнее — клеймо для стражи и закрытый склад. Принеси 12 железных слитков: они выдержат труд и отметят оружие деревни.", requiredItem: "minecraft:iron_ingot", requiredAmount: 12, rewardItem: "minecraft:shield", rewardAmount: 1, thanksLine: "Клеймо готово. Никто не забудет, что эта деревня выстояла не одна.", upgrade: { tier: 5, label: "Оружейный склад" } }
    ],
    discountLevel: 4, discountItem: "minecraft:paper", discountAmount: 4,
    allDoneLine: "Молот стучит от рассвета. Теперь у деревни есть чем встретить ночь."
  },
  "Картограф": {
    title: "Дороги, которых больше нет",
    chain: [
      { question: "У меня остались обрывки старых карт, но чертить не на чем. Принеси 12 листов бумаги — повесим сушильную стойку и начнём восстановление.", requiredItem: "minecraft:paper", requiredAmount: 12, rewardItem: null, rewardAmount: 0, thanksLine: "Бумага сухая. Три дороги снова проступили из тумана.", upgrade: { tier: 1, label: "Сушильная стойка" } },
      { question: "Доске у дороги нужна защита. Принеси 16 стеклянных панелей — каждый сможет увидеть новый маршрут.", requiredItem: "minecraft:glass_pane", requiredAmount: 16, rewardItem: null, rewardAmount: 0, thanksLine: "Теперь путник не свернёт в болото и не потеряет дорогу к шахте.", upgrade: { tier: 2, label: "Картографический пост" } },
      { question: "Комнате маршрутов нужны записи. Принеси 24 листа бумаги — сохраним найденные дороги.", requiredItem: "minecraft:paper", requiredAmount: 24, rewardItem: null, rewardAmount: 0, thanksLine: "Дороги не исчезли — их просто некому было прочесть.", upgrade: { tier: 3, label: "Комната маршрутов" } },
      { question: "Для дальнего пути нужен ориентир. Принеси 1 компас — сравним маршрут со старыми журналами под защищённым навесом.", requiredItem: "minecraft:compass", requiredAmount: 1, rewardItem: null, rewardAmount: 0, thanksLine: "Это не знак беды. Это путь домой для тех, кто умеет читать карту.", upgrade: { tier: 4, label: "Морской навес" } },
      { question: "Архив нужен всей деревне. Принеси 1 пустую карту — внесём последний безопасный путь в общий журнал.", requiredItem: "minecraft:empty_map", requiredAmount: 1, rewardItem: "minecraft:book_and_quill", rewardAmount: 1, thanksLine: "Теперь у нас есть не только дороги, но и память о них.", upgrade: { tier: 5, label: "Архив карт" } }
    ],
    discountLevel: 6, discountItem: "minecraft:cobblestone", discountAmount: 16,
    allDoneLine: "Все дороги на карте. Осталось найти того, кто рискнёт спуститься в холм."
  },
  "Шахтёр": {
    title: "То, что закрыли изнутри",
    chain: [
      { question: "Картограф показал старую карту. Принеси 24 булыжника — обезопасим вход и поставим запас крепи перед первым спуском.", requiredItem: "minecraft:cobblestone", requiredAmount: 24, rewardItem: null, rewardAmount: 0, thanksLine: "Вход укреплён, крепь рядом. Теперь шахта не проглотит ещё одного человека.", upgrade: { tier: 1, label: "Крепёжный запас" } },
      { question: "За кладкой старая выработка. Принеси 16 угля — откроем рудный двор, чтобы руда не лежала под дождём.", requiredItem: "minecraft:coal", requiredAmount: 16, rewardItem: null, rewardAmount: 0, thanksLine: "Руда вышла на свет. Теперь её можно считать, а не терять в темноте.", upgrade: { tier: 2, label: "Рудный двор" } },
      { question: "Жила открыта, но разные руды нельзя смешивать. Принеси 8 красной пыли — устроим пометки и сортировочный навес у входа.", requiredItem: "minecraft:redstone", requiredAmount: 8, rewardItem: null, rewardAmount: 0, thanksLine: "Камень отдельно, руда отдельно. Шахта начинает работать с умом.", upgrade: { tier: 3, label: "Сортировочный навес" } },
      { question: "Рельсы в старой штольне сгнили. Принеси 16 рельсов — доведём погрузочную линию до двора и сбережём спины шахтёров.", requiredItem: "minecraft:rail", requiredAmount: 16, rewardItem: null, rewardAmount: 0, thanksLine: "Теперь руда доезжает до склада, а не остаётся в темноте.", upgrade: { tier: 4, label: "Рельсовая погрузка" } },
      { question: "Последняя крепь требует хороших скоб. Принеси 10 железных слитков — укрепим склад камнем и запрем опасный старый штрек.", requiredItem: "minecraft:iron_ingot", requiredAmount: 10, rewardItem: "minecraft:torch", rewardAmount: 16, thanksLine: "Шахта работает. Понемногу, без жадности — жадность нас однажды уже подвела.", upgrade: { tier: 5, label: "Укреплённый склад" } }
    ],
    discountLevel: 8, discountItem: "minecraft:cobblestone", discountAmount: 24,
    allDoneLine: "Шахта работает. Понемногу, без жадности — жадность нас однажды уже подвела."
  }
};

export function getQuestFor(professionName) { return QUESTS[professionName] || null; }
function getQuestStep(npc) { return npc?.getDynamicProperty("quest_step") || 0; }
function countInInventory(container, typeId) { let total = 0; for (let i = 0; i < container.size; i++) { const stack = container.getItem(i); if (stack && stack.typeId === typeId) total += stack.amount; } return total; }
function removeFromInventory(container, typeId, amount) { let remaining = amount; for (let i = 0; i < container.size && remaining > 0; i++) { const stack = container.getItem(i); if (!stack || stack.typeId !== typeId) continue; const take = Math.min(remaining, stack.amount); remaining -= take; if (take >= stack.amount) container.setItem(i, undefined); else { stack.amount -= take; container.setItem(i, stack); } } }

// Kept for legacy callers; the Stage 5 adapter performs the stricter UI transaction.
export function turnInQuest(player, professionName, elder, npc) {
  const quest = getQuestFor(professionName); if (!quest) return { ok: false, reason: "no_quest" };
  const step = getQuestStep(npc); if (step >= quest.chain.length) return { ok: false, reason: "chain_complete", quest };
  const current = quest.chain[step]; const inventory = player.getComponent("minecraft:inventory"); const container = inventory?.container;
  if (!container) return { ok: false, reason: "no_inventory" };
  const have = countInInventory(container, current.requiredItem); if (have < current.requiredAmount) return { ok: false, reason: "not_enough", need: current.requiredAmount, have, item: current.requiredItem, current };
  const reward = current.rewardItem && current.rewardAmount > 0
    ? { itemId: current.rewardItem, amount: current.rewardAmount }
    : null;
  // All-or-nothing, like every other turn-in: container.addItem hands back the
  // stack it could not place rather than throwing, so paying the reward with
  // it and discarding the result took the player's goods and gave nothing
  // whenever their inventory was full.
  const snapshot = snapshotContainer(container);
  removeFromInventory(container, current.requiredItem, current.requiredAmount);
  if (reward && !placeReward(container, reward, (spec) => new ItemStack(spec.itemId, spec.amount))) {
    restoreContainer(container, snapshot);
    return { ok: false, reason: "inventory_full", quest, current };
  }
  const nextStep = step + 1; if (npc) npc.setDynamicProperty("quest_step", nextStep);
  const chainComplete = nextStep >= quest.chain.length;
  if (chainComplete && elder) { const key = `village:discount:${quest.discountLevel}:${quest.discountItem}`; elder.setDynamicProperty(key, (elder.getDynamicProperty(key) || 0) + quest.discountAmount); }
  return { ok: true, quest, current, chainComplete, step: nextStep, upgrade: current.upgrade || null };
}
