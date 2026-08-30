/**
 * The elder entity's dynamic-property keys, and the readers for them.
 *
 * village.js owns writing this state, but five other modules
 * (upgrades.js, special_content.js, planned_build_transaction.js,
 * fortification_repair.js, worldgen.js) need to read it and cannot import
 * village.js: village.js -> levels.js -> upgrades.js is a real import chain,
 * so upgrades.js importing village.js back would close a cycle. They each
 * hand-rolled their own copy of the same getDynamicProperty("village:originX")
 * literals instead, which meant renaming any key silently broke the readers
 * that were never updated.
 *
 * This module imports nothing, so anything may depend on it. Key strings
 * live here and nowhere else; add a constant rather than a literal.
 *
 * Ownership: village.js writes every key below except PALETTE, which
 * worldgen.js also writes when it founds an exploration village.
 */

export const PROP_ID = "village:id";
export const PROP_LEVEL = "village:level";
export const PROP_ORIGIN_X = "village:originX";
export const PROP_ORIGIN_Y = "village:originY";
export const PROP_ORIGIN_Z = "village:originZ";
export const PROP_FACING = "village:facing";
export const PROP_PALETTE = "village:palette";
export const PROP_CHEST_X = "village:chestX";
export const PROP_CHEST_Y = "village:chestY";
export const PROP_CHEST_Z = "village:chestZ";
export const PROP_LAYOUT_VERSION = "village:layoutVersion";
export const PROP_TIER = "village:tier";

export const DEFAULT_PALETTE_ID = "plains";

/** getDynamicProperty that never throws, for callers reading a foreign entity. */
export function readProperty(entity, key) {
  try {
    return entity?.getDynamicProperty?.(key);
  } catch (error) {
    return undefined;
  }
}

/** The village's local-coordinate origin. Components may be undefined. */
export function readOrigin(elder) {
  return {
    x: readProperty(elder, PROP_ORIGIN_X),
    y: readProperty(elder, PROP_ORIGIN_Y),
    z: readProperty(elder, PROP_ORIGIN_Z)
  };
}

/** True when every origin component is a usable number. */
export function isUsableOrigin(origin) {
  return !!origin && [origin.x, origin.y, origin.z].every(Number.isFinite);
}

/** The stored facing (0=+X, 1=-X, 2=+Z, 3=-Z), or undefined if unset. */
export function readFacing(elder) {
  return readProperty(elder, PROP_FACING);
}

/** True for a facing value the coordinate transform can actually use. */
export function isUsableFacing(facing) {
  return Number.isInteger(facing) && facing >= 0 && facing <= 3;
}

/** The village's biome palette id, falling back to plains. */
export function readPaletteId(elder) {
  return readProperty(elder, PROP_PALETTE) || DEFAULT_PALETTE_ID;
}

/** The village's level, defaulting to 1 for a village that never stored one. */
export function readLevel(elder) {
  return readProperty(elder, PROP_LEVEL) || 1;
}

/**
 * Origin + facing together, or null when either is unusable. Callers that
 * are about to place blocks want this: there is no safe way to transform a
 * local coordinate without both.
 */
export function readPlacementContext(elder) {
  const origin = readOrigin(elder);
  const facing = readFacing(elder);
  if (!isUsableOrigin(origin) || !isUsableFacing(facing)) return null;
  return { origin, facing };
}
