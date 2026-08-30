import { world, system } from "@minecraft/server";
import { readLevel } from "./village_state.js";

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

/**
 * Lines for anyone the table above does not name. The districts brought in a
 * dozen new trades, and a villager with a name and nothing to say reads as
 * scenery - which is the opposite of the point of building the districts.
 */
const DISTRICT_LINES = [
  "Работы теперь хватает на всех.",
  "Раньше тут был пустырь, а гляди-ка.",
  "Заходи, если что понадобится.",
  "Слышал, за стеной опять кого-то видели ночью.",
  "Деревня растёт. Не поспеваю."
];

/** What anyone might say, depending on the hour. */
const PHASE_LINES = {
  dawn: [
    "Рано ты сегодня.",
    "Туман с полей ещё не сошёл.",
    "Печи только разжигают."
  ],
  day: [
    "Погода держится - и на том спасибо.",
    "На перекрёстке нынче людно.",
    "Работы по горло, но это ведь хорошо?"
  ],
  dusk: [
    "Скоро к колоколу - все собираются на площади.",
    "Пора закрывать ставни.",
    "Ворота вот-вот запрут на ночь."
  ],
  night: [
    "Ночью лучше не ходить за стену.",
    "Дозорные на стене, слышишь шаги?",
    "Не спится. Всё кажется, что кто-то бродит."
  ]
};

/**
 * The elder speaks for the settlement, so what he says depends on how far it
 * has actually come. Ordered from the largest village down: the first entry
 * whose threshold is met wins.
 */
const ELDER_MILESTONE_LINES = [
  { minLevel: 15, lines: [
    "Стена обошла кварталы кругом. Я такого и не загадывал.",
    "Четверо ворот, а когда-то был один костёр.",
    "Архив дописан. Пусть теперь помнят без меня."
  ] },
  { minLevel: 10, lines: [
    "Замковая стена стоит. Спится спокойнее.",
    "Улицы разошлись крестом - деревня стала городком.",
    "Кварталы застраиваются сами собой, только успевай."
  ] },
  { minLevel: 5, lines: [
    "Частокол есть - уже не голое поле.",
    "Дозорные на местах. Пусть ходят, им полезно.",
    "Ещё бы камня на стену - и заживём."
  ] },
  { minLevel: 1, lines: [
    "Не забывай заглядывать в сундук ратуши - деревне всегда пригодится помощь.",
    "Помню времена, когда тут стоял всего один костёр.",
    "Начинаем с малого. Как все начинали."
  ] }
];

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
 * Roughly where in the day the world is. Falls back to daytime if the engine
 * cannot say - a wrong-sounding line is a far smaller problem than a thrown
 * error inside a background interval, which would take the whole loop down
 * silently.
 */
export function timePhase() {
  let time;
  try { time = world.getTimeOfDay(); } catch (e) { return "day"; }
  if (!Number.isFinite(time)) return "day";
  if (time < 2000 || time >= 23000) return "dawn";
  if (time < 11000) return "day";
  if (time < 13500) return "dusk";
  return "night";
}

/**
 * What the village has to say about itself right now.
 *
 * Three pools feed it: what this villager does, what time it is, and - for the
 * elder, who is the one NPC who speaks for the settlement - how far the
 * village has come. A single flat pool per name was fine when there were seven
 * named roles; the districts brought in ten more trades, and the same two
 * lines from everyone at every hour is what makes a village read as a diorama.
 */
export function pickAmbientLine(name, phase, level, isElder) {
  const pools = [];
  const roleLines = AMBIENT_LINES[name];
  if (roleLines) pools.push(roleLines);
  const phaseLines = PHASE_LINES[phase];
  if (phaseLines) pools.push(phaseLines);
  if (isElder) {
    const milestone = ELDER_MILESTONE_LINES.find((entry) => level >= entry.minLevel);
    if (milestone) pools.push(milestone.lines);
  }
  if (!roleLines && !isElder) pools.push(DISTRICT_LINES);
  if (pools.length === 0) return null;
  const pool = pools[Math.floor(Math.random() * pools.length)];
  return pool[Math.floor(Math.random() * pool.length)] || null;
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
    const phase = timePhase();
    for (const player of world.getPlayers()) {
      if (Math.random() > CHANCE) continue;
      const nearby = player.dimension.getEntities({
        location: player.location,
        maxDistance: 20,
        tags: []
      }).filter((e) => e.typeId === "minecraft:villager_v2" && e.nameTag);

      if (nearby.length === 0) continue;
      const speaker = nearby[Math.floor(Math.random() * nearby.length)];
      if (!speaker.hasTag("village_npc")) continue;
      const isElder = speaker.hasTag("village_elder");
      const level = isElder ? (readLevel(speaker) || 1) : 1;
      const line = pickAmbientLine(plainName(speaker), phase, level, isElder);
      if (!line) continue;
      player.sendMessage(`${speaker.nameTag}: §r${line}`);
    }
  }, CHECK_INTERVAL_TICKS);
}
