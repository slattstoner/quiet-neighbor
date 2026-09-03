import { setBlock, toWorld, setBlockMulti, oppositeCardinal } from "./util.js";

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
 * Writes a sign's text through the sign block component; if that isn't
 * available the sign is still placed, just blank, rather than aborting
 * the build. Exported for reuse by any other placard-style sign (e.g. the
 * small field/pen labels in upgrades.js), so there is one tested path for
 * writing sign text rather than several copies of the same try/catch.
 */
export function writeSign(dimension, pos, lines) {
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
 * Writes a sign from a RawText, so its lines can be `.lang` keys.
 *
 * `BlockSignComponent.setText` takes `RawMessage | string`, and the docs show
 * a `{ translate, with }` sign directly - so a sign is one of the few places
 * where translated text costs nothing extra. writeSign above stays for the
 * older string-built placards; new text goes through here, which is what the
 * ratchet in tests/lang_ratchet.mjs asks for.
 *
 * The engine throws past 512 characters, so this is deliberately used only
 * for four short lines.
 */
export function writeSignRaw(dimension, pos, rawtext) {
  try {
    const block = dimension.getBlock(pos);
    const sign = block?.getComponent("minecraft:sign");
    if (sign) {
      sign.setText({ rawtext });
      return true;
    }
  } catch (e) {
    console.warn("[village] could not write sign rawtext: " + e);
  }
  return false;
}

export const BOARD_KEYS = Object.freeze({
  noContract: "growing_villages.board.no_contract",
  awaiting: "growing_villages.board.awaiting",
  done: "growing_villages.board.done",
  standing: "growing_villages.board.standing",
  completed: "growing_villages.board.completed"
});

/** Where the notice board stands, in the plaza's local frame. */
export function boardOffset(plotForward, side) {
  const f = plotForward === undefined ? -6 : plotForward;
  const c = side === undefined ? 0 : side;
  // The bell hangs on the c-3 edge of the 7x7 pad (see buildCampfire); the
  // board goes on the opposite edge, so the two face each other across the
  // fire instead of crowding the same side.
  return { f, s: c + 3 };
}

/**
 * The four lines of the square's notice board.
 *
 * Pure, so the wording is testable without placing a block. The contract's
 * own title is existing data rather than new hardcoded text; everything this
 * function adds is a `.lang` key.
 */
export function boardLines(view) {
  const lines = [];
  if (!view || !view.contract) {
    lines.push({ translate: BOARD_KEYS.noContract });
  } else {
    lines.push({ text: view.contract.title });
    lines.push({ translate: view.available ? BOARD_KEYS.awaiting : BOARD_KEYS.done });
  }
  lines.push({ translate: BOARD_KEYS.standing, with: [String(view?.standing ?? 0)] });
  lines.push({ translate: BOARD_KEYS.completed, with: [String(view?.completed ?? 0)] });

  // A sign holds four lines. Interleave the newlines rather than relying on
  // the client to break them.
  const out = [];
  for (const [index, line] of lines.slice(0, 4).entries()) {
    if (index > 0) out.push({ text: "\n" });
    out.push(line);
  }
  return out;
}

/**
 * Places (or refreshes) the notice board on the village square.
 *
 * What it shows is deliberately what the gate sign does not: the gate says
 * which village this is and how well defended, and this says what the village
 * wants today and how much you have done for it. Standing at the bell, which
 * is where vanilla's own behavior.mingle gathers villagers in the evening, it
 * is the one place a player already has a reason to walk to.
 */
export function updateSquareBoard(dimension, origin, facing, plotForward, side, view) {
  const at = boardOffset(plotForward, side);

  const base = toWorld(origin, facing, at.f, at.s, 0);
  setBlock(dimension, base.x, base.y, base.z, "minecraft:oak_fence");

  const signPos = toWorld(origin, facing, at.f, at.s, 1);
  // Read from inside the square, so the opposite way round from the gate
  // board. Which cardinal that is on facings 2 and 3 is one of the two things
  // still worth confirming on a device - getting it wrong costs the player a
  // walk around the post, nothing more.
  const outward = ["south", "north", "east", "west"][facing];
  const cardinal = oppositeCardinal(outward) || outward;
  setBlockMulti(dimension, signPos.x, signPos.y, signPos.z, "minecraft:standing_sign", [
    { ground_sign_direction: 0, wood_type: "oak" },
    { ground_sign_direction: 0 },
    { "minecraft:cardinal_direction": cardinal },
    {}
  ]);

  writeSignRaw(dimension, signPos, boardLines(view));

  const lampPos = toWorld(origin, facing, at.f, at.s, 2);
  setBlock(dimension, lampPos.x, lampPos.y, lampPos.z, "minecraft:lantern", { hanging: false });

  return signPos;
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
