import { __test__, world } from "@minecraft/server";
import { readFileSync } from "node:fs";
import {
  BOARD_KEYS, boardLines, boardOffset, updateSquareBoard, writeSignRaw
} from "./scripts/signboard.js";
import { foundVillage, refreshSign, getVillageState } from "./scripts/village.js";
import { contractView, contractForDay } from "./scripts/contracts.js";
import { V2_FOUNDING } from "./scripts/levels.js";
import { SPATIAL_PLAN } from "./scripts/spatial_plan.js";
import { toWorld } from "./scripts/util.js";

/**
 * The notice board on the village square.
 *
 * The gate sign says which village this is and how well defended. It says
 * nothing about what the village actually wants from you, which is the part a
 * player needs daily - so the contract of the day lived only inside the elder's
 * menu, three taps deep, and a player who did not know to look never found it.
 *
 * The board stands at the bell, which is where vanilla's own behavior.mingle
 * gathers villagers in the evening: the one spot on the map a player already
 * has a reason to walk to.
 *
 * Two things this suite is strict about.
 *
 * Its text goes through `.lang` keys, not literals. Signs are one of the few
 * places where that costs nothing - BlockSignComponent.setText takes a
 * RawMessage - so there is no excuse, and the 0.11.0 ratchet would object
 * anyway. The one exception is the contract's own title, which is existing
 * data this only reads.
 *
 * And it must not land on top of the square it decorates. The plaza is a 7x7
 * pad with a campfire, four log stools and the bell assembly already on it,
 * all reserved by one SPATIAL_PLAN entry.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

const HERE = import.meta.dirname;
const dim = __test__.makeDimension();

// ---------- 1. где стоит доска ----------
console.log("\n=== the board stands opposite the bell, inside the plaza's own plot ===");
{
  const plaza = V2_FOUNDING.campfire;
  const at = boardOffset(plaza.plotForward, plaza.side);

  // buildCampfire hangs the bell along the c-3 edge and lays the pad from
  // c-3 to c+3, so the far edge is the only side with nothing on it.
  assert(at.s === plaza.side + 3, `the board is on the far edge of the pad (s=${at.s})`);
  assert(at.f === plaza.plotForward, `and on the square's centre line (f=${at.f})`);

  const reservation = SPATIAL_PLAN.find((entry) => entry.buildingId === "campfire");
  assert(!!reservation, "the plaza has a SPATIAL_PLAN reservation");
  const box = reservation.bounds;
  assert(at.f >= box.fMin && at.f <= box.fMax && at.s >= box.sMin && at.s <= box.sMax,
    `the board is inside that reservation (f ${box.fMin}..${box.fMax}, s ${box.sMin}..${box.sMax})`);

  // Nothing buildCampfire already put down may share the spot.
  const f = plaza.plotForward, c = plaza.side;
  const taken = [
    { f, s: c, what: "the campfire" },
    { f: f - 2, s: c - 2, what: "a log stool" }, { f: f + 2, s: c + 2, what: "a log stool" },
    { f: f - 2, s: c + 2, what: "a log stool" }, { f: f + 2, s: c - 2, what: "a log stool" },
    { f: f - 3, s: c, what: "a fence" }, { f: f + 3, s: c, what: "a fence" },
    { f, s: c - 3, what: "the bell" },
    { f: f - 1, s: c - 3, what: "a bell post" }, { f: f + 1, s: c - 3, what: "a bell post" }
  ];
  for (const spot of taken) {
    assert(!(spot.f === at.f && spot.s === at.s), `the board does not sit on ${spot.what}`);
  }
}

// ---------- 2. что на ней написано ----------
console.log("\n=== every line is a translation key, not a sentence ===");
{
  const contract = contractForDay(4, 0);
  const lines = boardLines({ available: true, contract, standing: 3, completed: 12, level: 4 });

  const translated = lines.filter((part) => part.translate).map((part) => part.translate);
  const literals = lines.filter((part) => typeof part.text === "string" && part.text !== "\n");

  assert(translated.length >= 3, `at least three translated lines (${translated.length})`);
  assert(translated.includes(BOARD_KEYS.awaiting), "the contract's status is a key");
  assert(translated.includes(BOARD_KEYS.standing) && translated.includes(BOARD_KEYS.completed),
    "and so are the merit counts");

  // The only bare text allowed is the contract's own title, which is data the
  // board reads rather than wording it invents.
  assert(literals.length === 1 && literals[0].text === contract.title,
    `the only literal is the contract's own title ("${literals[0]?.text}")`);
  for (const part of literals) {
    assert(part.text === contract.title,
      `no sentence of the board's own invention ("${part.text}")`);
  }

  // Four lines, newline-separated: a sign holds exactly four.
  const breaks = lines.filter((part) => part.text === "\n").length;
  assert(breaks === 3, `four lines, three breaks (${breaks})`);
  assert(lines.length - breaks <= 4, `and never more than four (${lines.length - breaks})`);

  // The numbers are substituted, not baked into the key.
  const standing = lines.find((part) => part.translate === BOARD_KEYS.standing);
  assert(Array.isArray(standing.with) && standing.with[0] === "3",
    `the merit count is a substitution (${JSON.stringify(standing.with)})`);
}

console.log("\n=== the board says something sensible in every state ===");
{
  const contract = contractForDay(4, 0);

  const done = boardLines({ available: false, contract, standing: 1, completed: 1 });
  assert(done.some((part) => part.translate === BOARD_KEYS.done),
    "a contract handed in today reads as done");
  assert(!done.some((part) => part.translate === BOARD_KEYS.awaiting),
    "and not also as awaiting");

  // Level 1 has no contracts at all - the board must not go blank or show a
  // half-line, because that is what a brand new village looks like.
  const early = boardLines({ available: false, contract: null, standing: 0, completed: 0 });
  assert(early.some((part) => part.translate === BOARD_KEYS.noContract),
    "a village too young for contracts says so");
  assert(early.filter((part) => part.text === "\n").length >= 1, "and still fills more than one line");

  // Missing state must not produce "undefined" on a sign in someone's world.
  for (const view of [undefined, null, {}]) {
    const lines = boardLines(view);
    const rendered = JSON.stringify(lines);
    assert(!/undefined|NaN|null/.test(rendered), `${JSON.stringify(view)} renders no undefined (${rendered.slice(0, 60)})`);
  }
}

console.log("\n=== the keys exist in both languages ===");
{
  for (const language of ["ru_RU", "en_US"]) {
    const text = readFileSync(`${HERE}/../GrowingVillages_RP/texts/${language}.lang`, "utf8");
    const defined = new Set(text.split("\n")
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
      .map((line) => line.split("=")[0].trim()));
    for (const key of Object.values(BOARD_KEYS)) {
      assert(defined.has(key), `${language}: ${key} is defined`);
    }
  }

  // The two keys that take a count must actually have a placeholder, or the
  // number is silently dropped and the sign reads "Merits:".
  const ru = readFileSync(`${HERE}/../GrowingVillages_RP/texts/ru_RU.lang`, "utf8");
  for (const key of [BOARD_KEYS.standing, BOARD_KEYS.completed]) {
    const line = ru.split("\n").find((entry) => entry.startsWith(key + "=")) || "";
    assert(line.includes("%s"), `${key} has a %s for its count ("${line.split("=")[1]}")`);
  }
}

// ---------- 3. блоки на месте ----------
console.log("\n=== placing the board puts a post, a sign and a light where it says ===");
{
  const origin = { x: 930000, y: 70, z: 0 };
  const plaza = V2_FOUNDING.campfire;
  const view = contractView({ getDynamicProperty: () => undefined }, 0);

  const signPos = updateSquareBoard(dim, origin, 0, plaza.plotForward, plaza.side, view);
  const at = boardOffset(plaza.plotForward, plaza.side);

  const expectedSign = toWorld(origin, 0, at.f, at.s, 1);
  assert(signPos.x === expectedSign.x && signPos.z === expectedSign.z,
    `the sign is where the offset says (${signPos.x},${signPos.z})`);

  const post = toWorld(origin, 0, at.f, at.s, 0);
  const lamp = toWorld(origin, 0, at.f, at.s, 2);
  assert(dim.getBlock(post).permutation.typeId === "minecraft:oak_fence",
    `a post holds it up (${dim.getBlock(post).permutation.typeId})`);
  assert(dim.getBlock(signPos).permutation.typeId === "minecraft:standing_sign",
    `the sign itself is a standing sign (${dim.getBlock(signPos).permutation.typeId})`);
  assert(dim.getBlock(lamp).permutation.typeId === "minecraft:lantern",
    `and a lantern makes it readable at night (${dim.getBlock(lamp).permutation.typeId})`);

  // Written as raw text, so getText must be empty and getRawText must not -
  // that is the real API's split, and getting it backwards is a blank sign.
  const sign = dim.getBlock(signPos).getComponent("minecraft:sign");
  assert(sign.getText() === undefined, "the text was not written as a plain string");
  const raw = sign.getRawText();
  assert(!!raw && Array.isArray(raw.rawtext), "it was written as raw text");
  assert(raw.rawtext.some((part) => part.translate), "and carries translation keys");

  // A sign throws past 512 characters, so the board must never approach it.
  const size = JSON.stringify({ rawtext: boardLines(view) }).length;
  assert(size < 512, `the whole board is well under the 512-character limit (${size})`);
}

console.log("\n=== an overlong board is refused rather than silently truncated ===");
{
  const origin = { x: 931000, y: 70, z: 0 };
  const signPos = updateSquareBoard(dim, origin, 0, -6, 5, contractView({ getDynamicProperty: () => undefined }, 0));
  // writeSignRaw swallows the engine's throw, as every placement path here
  // does - the sign stays blank rather than aborting the build around it.
  const wrote = writeSignRaw(dim, signPos, [{ text: "x".repeat(600) }]);
  assert(wrote === false, "a 600-character sign is refused, not written");
  const raw = dim.getBlock(signPos).getComponent("minecraft:sign").getRawText();
  assert(raw.rawtext.some((part) => part.translate),
    "and the board it failed to overwrite still reads correctly");
}

// ---------- 4. сквозная проверка ----------
console.log("\n=== founding a village raises the board, and refreshSign keeps it current ===");
{
  const origin = { x: 932000, y: 70, z: 0 };
  const player = __test__.makePlayer("Reader", { ...origin });
  const elder = foundVillage(player, origin, 0);
  const state = getVillageState(elder);

  const at = boardOffset(V2_FOUNDING.campfire.plotForward, V2_FOUNDING.campfire.side);
  const signPos = toWorld(state.origin, state.facing, at.f, at.s, 1);
  const placed = dim.getBlock(signPos)?.permutation?.typeId
    || player.dimension.getBlock(signPos)?.permutation?.typeId;
  assert(placed === "minecraft:standing_sign", `founding raised the board (${placed})`);

  const sign = player.dimension.getBlock(signPos).getComponent("minecraft:sign");
  const before = JSON.stringify(sign.getRawText());
  assert(/growing_villages\.board\./.test(before), "and wrote the board's keys onto it");

  // A new village is level 1, which is below every contract's minLevel, so the
  // board should be saying exactly that.
  assert(before.includes(BOARD_KEYS.noContract),
    "a level-1 village's board says there are no contracts yet");

  // Move the world on a day and refresh: the board follows the elder's state
  // rather than being written once at founding.
  world.setDay(3);
  refreshSign(elder);
  const after = JSON.stringify(sign.getRawText());
  assert(/growing_villages\.board\./.test(after), "a refresh rewrites the board");
  assert(refreshSign(elder) !== undefined, "and refreshSign still returns the gate sign it always did");
}

console.log("\n=== a board that cannot be raised does not take the gate sign down with it ===");
{
  // The gate sign is what every level-up depends on; the board is decoration.
  // A village founded before the board existed has no post on its plaza, and
  // the two must not share a failure.
  const origin = { x: 933000, y: 70, z: 0 };
  const player = __test__.makePlayer("Legacy", { ...origin });
  const elder = foundVillage(player, origin, 0);

  const plaza = V2_FOUNDING.campfire;
  const at = boardOffset(plaza.plotForward, plaza.side);
  const boardArea = toWorld(origin, 0, at.f, at.s, 0);
  player.dimension._markUnloaded({
    x1: boardArea.x - 1, x2: boardArea.x + 1, z1: boardArea.z - 1, z2: boardArea.z + 1
  });

  let threw = null;
  try { refreshSign(elder); } catch (error) { threw = error; }
  assert(threw === null, `refreshSign survives an unplaceable board (${threw?.message || "no throw"})`);
  player.dimension._clearUnloaded();
}

console.log(failures === 0 ? "\nALL SQUARE BOARD CHECKS PASSED" : `\n${failures} SQUARE BOARD CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
