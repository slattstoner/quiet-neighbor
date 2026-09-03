import { OUTPOST_KINDS, OUTPOST_ORDER, OUTPOST_SLOTS, buildOutpost } from "./outposts.js";
import { toWorld } from "./util.js";
import {
  DEFAULT_PALETTE_ID, PROP_ID,
  isUsableFacing, isUsableOrigin, readFacing, readLevel, readOrigin, readPaletteId, readProperty
} from "./village_state.js";

export const SURVEY_CHARTER_ID = "village:survey_charter";

/**
 * The charter is the cartographer's work, so it only means anything once the
 * village has one. Before that there is nobody to have drawn it.
 */
export const CHARTER_MIN_LEVEL = 4;

/** How far from a village the charter still counts as "near" it. */
export const CHARTER_RANGE = 160;

const BUILT_PREFIX = "village:outpost:";

// Exported because waypoints.js needs the same key: the mod's rule is that a
// dynamic-property key string lives in one place, never duplicated.
export function builtKey(slotId) { return BUILT_PREFIX + slotId; }

function outpostState(elder) {
  const origin = readOrigin(elder);
  const facing = readFacing(elder);
  if (!isUsableOrigin(origin) || !isUsableFacing(facing)) return null;
  return {
    elder,
    origin,
    facing,
    palette: readPaletteId(elder) || DEFAULT_PALETTE_ID,
    id: readProperty(elder, PROP_ID),
    level: readLevel(elder)
  };
}

/** Which sites this village has already had surveyed. */
export function surveyedSlots(elder) {
  return OUTPOST_SLOTS.filter((slot) => !!elder.getDynamicProperty(builtKey(slot.id)));
}

/**
 * The next site to raise: the first free slot, paired with the kind that goes
 * with it. Slot and kind advance together, so a village ends up with one of
 * each rather than four abandoned mines.
 */
export function nextSurvey(elder) {
  const done = surveyedSlots(elder).length;
  if (done >= OUTPOST_SLOTS.length) return null;
  return { slot: OUTPOST_SLOTS[done], kind: OUTPOST_ORDER[done] };
}

function charterSlot(player) {
  const container = player?.getComponent?.("minecraft:inventory")?.container;
  if (!container) return null;
  for (let i = 0; i < container.size; i++) {
    if (container.getItem(i)?.typeId === SURVEY_CHARTER_ID) return { container, slot: i };
  }
  return null;
}

function consumeCharterAt(held) {
  if (!held) return false;
  const stack = held.container.getItem(held.slot);
  if (stack?.typeId !== SURVEY_CHARTER_ID) return false;
  if (stack.amount <= 1) held.container.setItem(held.slot, undefined);
  else { stack.amount -= 1; held.container.setItem(held.slot, stack); }
  return true;
}

/** Rough compass bearing from the village to a local f/s offset, for the message. */
function bearingText(origin, facing, f, s) {
  const at = toWorld(origin, facing, f, s, 0);
  const dx = at.x - origin.x;
  const dz = at.z - origin.z;
  const northSouth = dz < 0 ? "к северу" : "к югу";
  const eastWest = dx < 0 ? "западу" : "востоку";
  return `${northSouth} и ${eastWest}`;
}

/**
 * Uses one survey charter near `elder`'s village.
 *
 * The charter is consumed only after the site is actually standing. A build
 * that fails on an unloaded chunk or impossible ground gives the player their
 * charter back rather than eating it, which matters because it costs a
 * compass.
 */
export function useSurveyCharter(player, elder) {
  const state = outpostState(elder);
  if (!state) return { ok: false, reason: "bad_village" };
  if (state.level < CHARTER_MIN_LEVEL) return { ok: false, reason: "too_early", needLevel: CHARTER_MIN_LEVEL, level: state.level };

  const next = nextSurvey(elder);
  if (!next) return { ok: false, reason: "all_surveyed" };

  // Locate the charter before building rather than after. The old order built
  // the site, wrote the "surveyed" marker, and only then went looking for the
  // charter - so a player without one got the outpost anyway, the slot spent,
  // and a "you have no charter" message on top of it. Checking first means a
  // missing charter costs nothing and changes nothing.
  const held = charterSlot(player);
  if (!held) return { ok: false, reason: "no_charter" };

  const result = buildOutpost(next.kind, next.slot.id, player.dimension, state);
  if (!result.ok) return result;

  // Charter first, marker second: the marker is what makes the survey
  // permanent, so it must never be written for a survey that was not paid for.
  if (!consumeCharterAt(held)) return { ok: false, reason: "no_charter" };
  try {
    elder.setDynamicProperty(builtKey(next.slot.id), true);
  } catch (error) {
    console.warn("[village] outpost marker write failed: " + error);
  }

  const at = toWorld(state.origin, state.facing, next.slot.f, next.slot.s, 0);
  return {
    ...result,
    bearing: bearingText(state.origin, state.facing, next.slot.f, next.slot.s),
    world: { x: at.x, z: at.z },
    remaining: OUTPOST_SLOTS.length - surveyedSlots(elder).length
  };
}

/** The chat line a charter use produces, success or otherwise. */
export function charterMessage(result) {
  if (!result) return "§cГрамота ничего не показала.";
  if (result.ok) {
    const where = `§7${result.bearing} отсюда, около §f${result.world.x}, ${result.world.z}§7.`;
    const left = result.remaining > 0
      ? ` §7Осталось мест на карте: §f${result.remaining}§7.`
      : " §7Карта размечена полностью.";
    return `§eГрамота: §r${OUTPOST_KINDS[result.kind]?.label || "Находка"} нанесена на карту. ${where}${left}`;
  }
  switch (result.reason) {
    case "no_village": return "§cРядом нет деревни. Грамоту надо разворачивать при старосте.";
    case "too_early": return `§cДеревня ещё мала — нужен картограф (уровень ${result.needLevel}, сейчас ${result.level}).`;
    case "all_surveyed": return "§7Все четыре места вокруг деревни уже размечены.";
    case "no_charter": return "§cГрамоты нет в руках.";
    default: return "§cЗдесь ничего не удалось разметить. Попробуй у другой деревни.";
  }
}
