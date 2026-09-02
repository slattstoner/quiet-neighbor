/**
 * Every village in the world, in one list the whole mod can read.
 *
 * Until now a village existed only as dynamic properties on its elder, which
 * means the only way to learn anything about one was to have that elder
 * loaded. Nothing could answer "what villages are in this world" at all - so
 * nothing could put a village on the compass, route a road to a neighbour,
 * send a caravan, or tell two settlements they are near each other.
 *
 * The registry is that answer: a world-scoped index, written when a village is
 * founded and when it levels up, readable from anywhere with no entity
 * loaded and no import cycle. The elder stays the authority on its own
 * village's detailed state (level requirements, quest steps, contract
 * standing); the registry holds only what a stranger needs to know about a
 * village it has never visited.
 *
 * This module imports nothing but @minecraft/server, so anything may depend
 * on it.
 *
 * STORAGE SHAPE. One string dynamic property per chunk of records, not one
 * blob: string properties cap at 32,767 bytes, and a single growing blob would
 * hit that ceiling on a long-lived world with no warning and no recovery.
 * Records are packed as tab-separated fields, newline-separated rows, because
 * a village record is five short scalars and JSON would roughly triple the
 * cost per row for no benefit.
 *
 *   village:registry:count   -> number of pages
 *   village:registry:0..N    -> one page of rows
 *
 * A page is closed at PAGE_BUDGET bytes, comfortably under the cap, so a page
 * can always take one more row than expected without truncating.
 */

import { world } from "@minecraft/server";

const PROP_COUNT = "village:registry:count";
const PROP_PAGE = "village:registry:";

/**
 * Bytes per page. The engine's limit is 32,767; stopping at 24,000 leaves room
 * for a long row to finish rather than being cut in half at the boundary.
 */
export const PAGE_BUDGET = 24000;

/** Hard ceiling on remembered villages, so an explored world cannot grow without bound. */
export const MAX_VILLAGES = 512;

const FIELD = "\t";
const ROW = "\n";

/** Where the registry lives. Injectable so the planner can be tested without a world. */
function defaultStore() {
  return {
    get(key) {
      try { return world.getDynamicProperty(key); } catch (error) { return undefined; }
    },
    set(key, value) {
      try { world.setDynamicProperty(key, value); return true; } catch (error) {
        console.warn("[village] registry write failed: " + error);
        return false;
      }
    }
  };
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One village, as the registry remembers it.
 *
 * `id` is the same short id the elder carries in `village:id`, so a record and
 * an elder can always be matched up. Coordinates are the village origin - the
 * crossroads centre - rounded to whole blocks.
 */
function record(id, x, z, level, palette) {
  if (typeof id !== "string" || id.length === 0 || id.includes(FIELD) || id.includes(ROW)) return null;
  const ix = num(x), iz = num(z), lvl = num(level);
  if (ix === null || iz === null) return null;
  const safePalette = typeof palette === "string" && !palette.includes(FIELD) && !palette.includes(ROW)
    ? palette : "plains";
  return Object.freeze({
    id,
    x: Math.round(ix),
    z: Math.round(iz),
    level: Number.isInteger(lvl) && lvl >= 1 ? lvl : 1,
    palette: safePalette
  });
}

function encode(entry) {
  return [entry.id, entry.x, entry.z, entry.level, entry.palette].join(FIELD);
}

function decode(line) {
  if (!line) return null;
  const [id, x, z, level, palette] = line.split(FIELD);
  return record(id, x, z, level, palette);
}

/** Every remembered village, oldest first. Never throws. */
export function allVillages(store = defaultStore()) {
  const pages = num(store.get(PROP_COUNT)) || 0;
  const out = [];
  for (let page = 0; page < pages; page++) {
    const raw = store.get(PROP_PAGE + page);
    if (typeof raw !== "string" || raw.length === 0) continue;
    for (const line of raw.split(ROW)) {
      const entry = decode(line);
      if (entry) out.push(entry);
    }
  }
  return out;
}

/** Writes the whole list back, paged so no single property can overflow. */
function writeAll(entries, store) {
  const pages = [];
  let current = "";
  for (const entry of entries) {
    const line = encode(entry);
    // A row that would push this page past the budget starts the next one, so
    // a row is never split across two properties.
    if (current.length > 0 && current.length + ROW.length + line.length > PAGE_BUDGET) {
      pages.push(current);
      current = line;
    } else {
      current = current.length === 0 ? line : current + ROW + line;
    }
  }
  if (current.length > 0) pages.push(current);

  const previous = num(store.get(PROP_COUNT)) || 0;
  for (let page = 0; page < pages.length; page++) store.set(PROP_PAGE + page, pages[page]);
  // Clear pages the list has shrunk past, or a later read would resurrect
  // villages that were removed.
  for (let page = pages.length; page < previous; page++) store.set(PROP_PAGE + page, "");
  store.set(PROP_COUNT, pages.length);
  return pages.length;
}

/**
 * Adds a village, or updates the one that already has this id.
 *
 * Idempotent on purpose: founding writes a record, and every level-up writes
 * the same record again with a new level. Re-registering must never produce a
 * second entry for one village.
 */
export function registerVillage(village, store = defaultStore()) {
  const entry = record(village?.id, village?.x, village?.z, village?.level, village?.palette);
  if (!entry) return { ok: false, reason: "invalid_record" };

  const entries = allVillages(store);
  const at = entries.findIndex((item) => item.id === entry.id);
  if (at >= 0) {
    entries[at] = entry;
  } else {
    if (entries.length >= MAX_VILLAGES) return { ok: false, reason: "registry_full", count: entries.length };
    entries.push(entry);
  }
  writeAll(entries, store);
  return { ok: true, entry, count: entries.length, updated: at >= 0 };
}

/** Updates only the fields given, leaving the rest of the record alone. */
export function updateVillage(id, patch, store = defaultStore()) {
  const entries = allVillages(store);
  const at = entries.findIndex((item) => item.id === id);
  if (at < 0) return { ok: false, reason: "unknown_village" };
  const merged = record(
    id,
    patch?.x ?? entries[at].x,
    patch?.z ?? entries[at].z,
    patch?.level ?? entries[at].level,
    patch?.palette ?? entries[at].palette
  );
  if (!merged) return { ok: false, reason: "invalid_record" };
  entries[at] = merged;
  writeAll(entries, store);
  return { ok: true, entry: merged };
}

/** Drops a village from the index. The elder's own state is untouched. */
export function forgetVillage(id, store = defaultStore()) {
  const entries = allVillages(store);
  const kept = entries.filter((item) => item.id !== id);
  if (kept.length === entries.length) return { ok: false, reason: "unknown_village" };
  writeAll(kept, store);
  return { ok: true, count: kept.length };
}

/** Horizontal distance only: a village is a place on the map, not a height. */
function flatDistance(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Villages within `maxDistance` of a point, nearest first.
 *
 * Pure over the list, so the caller can pass its own array in tests and the
 * sorting is provable without a world.
 */
export function villagesNear(location, maxDistance, entries) {
  const list = entries || allVillages();
  const from = { x: num(location?.x), z: num(location?.z) };
  if (from.x === null || from.z === null) return [];
  const limit = num(maxDistance);
  return list
    .map((entry) => ({ ...entry, distance: flatDistance(entry, from) }))
    .filter((entry) => limit === null || entry.distance <= limit)
    .sort((a, b) => a.distance - b.distance);
}

/** The closest village to a point, or null. */
export function nearestVillage(location, maxDistance, entries) {
  return villagesNear(location, maxDistance, entries)[0] || null;
}

/**
 * The nearest OTHER village to one that is already registered - what a road,
 * a caravan or a diplomatic relation needs.
 */
export function nearestNeighbour(id, maxDistance, entries) {
  const list = entries || allVillages();
  const self = list.find((entry) => entry.id === id);
  if (!self) return null;
  return villagesNear(self, maxDistance, list.filter((entry) => entry.id !== id))[0] || null;
}

/** Bytes the registry currently occupies, for a sanity check against the cap. */
export function registryByteCount(store = defaultStore()) {
  const pages = num(store.get(PROP_COUNT)) || 0;
  let total = 0;
  for (let page = 0; page < pages; page++) {
    const raw = store.get(PROP_PAGE + page);
    if (typeof raw === "string") total += raw.length;
  }
  return total;
}

export const __registryKeys = Object.freeze({ PROP_COUNT, PROP_PAGE });
