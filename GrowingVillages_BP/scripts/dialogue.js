import { world, system } from "@minecraft/server";

const AMBIENT_LINES = {
  "Староста": [
    "Хорошая нынче погода для строительства.",
    "Не забывай заглядывать в сундук ратуши - деревне всегда пригодится помощь.",
    "Помню времена, когда тут стоял всего один костёр."
  ],
  "Фермер": [
    "Урожай в этом году неплохой.",
    "Скоро надо будет пересеять грядки."
  ],
  "Кузнец": [
    "Наковальня сегодня в ударе.",
    "Хорошее железо - половина дела."
  ],
  "Картограф": [
    "На старых картах ещё много белых пятен.",
    "Бумага снова кончается быстрее, чем я успеваю чертить."
  ],
  "Шахтёр": [
    "Порода сегодня идёт мягко - значит, где-то рядом пустота.",
    "Крепь держит. Пока держит."
  ],
  "Дозорный": [
    "Ночью за гребнем что-то светилось. Или мне уже двадцать зим кажется.",
    "Стою. Смотрю. Больше от меня и не требуется.",
    "Тот, кто первым увидит беду, ещё успеет закрыть ворота."
  ],
  "Житель": [
    "Тут неплохо живётся, спасибо.",
    "Давно у нас не было гостей."
  ]
};

/** Sends a message that looks like it came from the given entity, to every player near it. */
export function announceToNearbyPlayers(entity, message, radius) {
  try {
    const nearby = entity.dimension.getEntities({
      location: entity.location,
      maxDistance: radius || 24,
      type: "minecraft:player"
    });
    for (const p of nearby) p.sendMessage(message);
  } catch (e) {
    /* entity may no longer be valid - ignore */
  }
}

function plainName(entity) {
  return (entity.nameTag || "").replace(/§./g, "");
}

/**
 * Once every real-world-ish interval, has a small chance of picking one
 * nearby named villager and having them say something purely atmospheric.
 * Kept deliberately rare and quiet, as requested - not a chat spam system.
 */
export function startAmbientDialogue() {
  const CHECK_INTERVAL_TICKS = 20 * 60 * 5; // every 5 minutes
  const CHANCE = 0.15; // 15% chance per check, per player

  system.runInterval(() => {
    for (const player of world.getPlayers()) {
      if (Math.random() > CHANCE) continue;
      const nearby = player.dimension.getEntities({
        location: player.location,
        maxDistance: 20,
        tags: []
      }).filter((e) => e.typeId === "minecraft:villager_v2" && e.nameTag);

      if (nearby.length === 0) continue;
      const speaker = nearby[Math.floor(Math.random() * nearby.length)];
      const name = plainName(speaker);
      const lines = AMBIENT_LINES[name];
      if (!lines) continue;
      const line = lines[Math.floor(Math.random() * lines.length)];
      player.sendMessage(`${speaker.nameTag}: §r${line}`);
    }
  }, CHECK_INTERVAL_TICKS);
}
