import { setBlock, toWorld, setBlockMulti } from "./util.js";

/**
 * Village names are generated once at founding and stored on the elder,
 * so the same village keeps its name for the life of the world. Names are
 * built from two plain, vaguely rural halves rather than fantasy syllable
 * soup, to stay in keeping with Minecraft's understated tone.
 */
const NAME_FIRST = [
  "Тихий", "Старый", "Дальний", "Верхний", "Нижний", "Светлый",
  "Каменный", "Зелёный", "Ясный", "Дубовый", "Холодный", "Медный"
];
const NAME_SECOND = [
  "Брод", "Холм", "Родник", "Овраг", "Луг", "Камень",
  "Двор", "Перевал", "Ручей", "Косогор", "Пригорок", "Затон"
];

export function generateVillageName() {
  const a = NAME_FIRST[Math.floor(Math.random() * NAME_FIRST.length)];
  const b = NAME_SECOND[Math.floor(Math.random() * NAME_SECOND.length)];
  return `${a} ${b}`;
}

const TIER_LABEL = {
  0: "Без укреплений",
  1: "Частокол",
  2: "Каменная стена",
  3: "Замковая стена"
};

/**
 * Writes the four lines of the gate signboard. Sign text is set through
 * the sign block component; if that isn't available the sign is still
 * placed, just blank, rather than aborting the build.
 */
function writeSign(dimension, pos, lines) {
  try {
    const block = dimension.getBlock(pos);
    const sign = block?.getComponent("minecraft:sign");
    if (sign) {
      sign.setText(lines.join("\n"));
      return true;
    }
  } catch (e) {
    console.warn("[village] could not write sign text: " + e);
  }
  return false;
}

/**
 * Places (or refreshes) the notice board beside the main gate: village
 * name, current level and the state of its defences.
 */
export function updateGateSign(dimension, origin, facing, forwardAt, info) {
  // Post beside the gateway, just inside the wall
  const postF = forwardAt - 1;
  const postS = 4;

  const base = toWorld(origin, facing, postF, postS, 0);
  setBlock(dimension, base.x, base.y, base.z, "minecraft:oak_fence");
  const signPos = toWorld(origin, facing, postF, postS, 1);

  const cardinal = ["south", "north", "east", "west"][facing];
  setBlockMulti(dimension, signPos.x, signPos.y, signPos.z, "minecraft:standing_sign", [
    { ground_sign_direction: 8, wood_type: "oak" },
    { ground_sign_direction: 8 },
    { "minecraft:cardinal_direction": cardinal },
    {}
  ]);

  const lines = [
    info.name || "Деревня",
    `Уровень ${info.level}`,
    TIER_LABEL[info.tier || 0],
    info.level >= info.maxLevel ? "Процветает" : "Строится"
  ];
  writeSign(dimension, signPos, lines);

  // A small lantern over the board so it's readable at night
  const lampPos = toWorld(origin, facing, postF, postS, 2);
  setBlock(dimension, lampPos.x, lampPos.y, lampPos.z, "minecraft:lantern", { hanging: false });

  return signPos;
}

export { TIER_LABEL };
