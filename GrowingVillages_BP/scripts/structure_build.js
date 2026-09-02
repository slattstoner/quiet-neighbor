import { world, system } from "@minecraft/server";
import { toWorld, setBlock } from "./util.js";
import { paletteById } from "./palettes.js";
import { buildingRecord, PLACEHOLDER_BLOCKS, requiredStructureIds } from "./building_manifest.js";

/**
 * Places a building from a `.mcstructure` file instead of building it block by
 * block, and hands back to the procedural builder when no file exists.
 *
 * Three things this buys, in the order they matter:
 *
 * 1. A building stops being code. Sixty hand-written builders averaging
 *    forty-eight lines each is the reason this mod cannot hold much more town
 *    than it already does.
 *
 * 2. Unloaded chunks stop being a silent failure. `setBlock` in an unloaded
 *    chunk does nothing at all - that is why `holdLoadedArea`, `withRetry` and
 *    a whole ticking-area budget exist, and why far wall corners used to lose
 *    their towers. `StructureManager.place` is documented to queue placement
 *    for loading instead: "Structures placed in unloaded chunks will be queued
 *    for loading."
 *
 * 3. One engine call replaces several hundred, which is a straight win against
 *    the watchdog.
 *
 * ── The two things to confirm on a real device ────────────────────────────
 *
 * Everything here is derived rather than guessed, and both derivations are
 * pinned by tests so a correction is a one-line edit rather than a hunt. But
 * neither can be proved outside the game, so both are called out:
 *
 *   A. PLACEMENT CORNER. `place()` takes one location, and this assumes it is
 *      the structure's minimum corner (the convention a structure block uses).
 *      If a device shows it centred or anchored elsewhere, `worldAnchorFor`
 *      is the only place that changes.
 *
 *   B. ROTATION. See FACING_ROTATION below for the derivation and for the
 *      handedness caveat, which is a real property of this mod's coordinate
 *      transform rather than an engine question.
 */

/**
 * Village facing -> the rotation that turns a structure authored for facing 0.
 *
 * Derivation. `toWorld` maps local (f, s) to a world XZ offset like this:
 *
 *   facing 0 -> ( f,  s)      facing 2 -> ( s,  f)
 *   facing 1 -> (-f, -s)      facing 3 -> (-s, -f)
 *
 * A structure authored for facing 0 has its f axis along world +X and its s
 * axis along world +Z. Minecraft rotates clockwise seen from above, where east
 * is +X and south is +Z, so Rotate90 sends (dx, dz) to (-dz, dx): east becomes
 * south, which is clockwise on a map. Picking the rotation that points f the
 * right way gives:
 *
 *   facing 0: f -> +X   None
 *   facing 1: f -> -X   Rotate180
 *   facing 2: f -> +Z   Rotate90
 *   facing 3: f -> -Z   Rotate270
 *
 * HANDEDNESS. Facings 0 and 1 are rotations of each other; facings 2 and 3 are
 * NOT - `(f,s) -> (s,f)` is a reflection, not a rotation. That is a property of
 * `toWorld` itself, not of the engine, and it is baked into every existing
 * builder. The consequence is that on facings 2 and 3 a placed structure comes
 * out mirrored across the street axis compared to the same building drawn
 * procedurally. For a house that is cosmetic - a mirrored house is still a
 * house, and the engine mirrors its doors and stairs correctly - and the
 * footprint is right either way because it is computed from the transformed
 * corners rather than assumed. Anything where handedness genuinely matters
 * (a sign facing one specific way) belongs in a POI, not in the structure.
 */
export const FACING_ROTATION = Object.freeze({
  0: "None",
  1: "Rotate180",
  2: "Rotate90",
  3: "Rotate270"
});

/** True when the engine build exposes structure placement at all. */
export function structuresSupported() {
  try {
    return typeof world?.structureManager?.place === "function";
  } catch (error) {
    return false;
  }
}

/**
 * Structure ids the pack actually contains.
 *
 * `getPackStructureIds` is the only way to tell a missing file from a typo
 * before placement, and placement of a missing structure throws
 * InvalidStructureError rather than doing nothing - so this is checked first
 * and the answer cached, since the set cannot change while the world runs.
 */
let packIds = null;
export function packStructureIds() {
  if (packIds) return packIds;
  try {
    packIds = new Set(world.structureManager.getPackStructureIds());
  } catch (error) {
    packIds = new Set();
  }
  return packIds;
}

/** Forgets the cached pack listing. Tests use this; the game has no need. */
export function resetStructureCache() {
  packIds = null;
}

/** Whether this building can be placed from a structure right now. */
export function structureAvailable(id, injected) {
  const record = injected || buildingRecord(id);
  if (!record || !structuresSupported()) return false;
  return packStructureIds().has(record.structure);
}

/**
 * Every structure a manifest record names but the pack does not contain.
 *
 * Reported once at start-up rather than discovered as a building that quietly
 * did not appear - the failure mode this whole module exists to remove.
 */
export function missingStructures() {
  if (!structuresSupported()) return [];
  const present = packStructureIds();
  return requiredStructureIds().filter((structure) => !present.has(structure));
}

/**
 * The local rect a record occupies once it stands on a plot.
 *
 * The record's footprint is relative to its plot anchor, so a building can be
 * put on any plot without re-authoring it.
 */
export function localFootprint(record, plotForward, side) {
  const f = record.footprint;
  return Object.freeze({
    fMin: f.fMin + plotForward, fMax: f.fMax + plotForward,
    sMin: f.sMin + side, sMax: f.sMax + side,
    upMin: f.upMin, upMax: f.upMax
  });
}

/**
 * The world-space minimum corner to place a structure at.
 *
 * Computed from the transformed corners rather than from the facing directly:
 * whichever way the local axes end up pointing, the minimum corner of the
 * world box is the minimum corner, so the footprint lands on the intended
 * ground on all four facings.
 */
export function worldAnchorFor(origin, facing, rectangle) {
  const corners = [
    toWorld(origin, facing, rectangle.fMin, rectangle.sMin, rectangle.upMin),
    toWorld(origin, facing, rectangle.fMin, rectangle.sMax, rectangle.upMin),
    toWorld(origin, facing, rectangle.fMax, rectangle.sMin, rectangle.upMin),
    toWorld(origin, facing, rectangle.fMax, rectangle.sMax, rectangle.upMin)
  ];
  return {
    x: Math.min(...corners.map((corner) => corner.x)),
    y: origin.y + rectangle.upMin,
    z: Math.min(...corners.map((corner) => corner.z))
  };
}

/**
 * Replaces the structure's placeholder blocks with the village's real
 * materials.
 *
 * Runs as a generator so a caller can spread it over ticks: a 7x7x7 building
 * is only a few hundred reads, but a granary yard is thousands, and this is
 * the one part of structure placement that is still per-block.
 */
export function* swapPlaceholdersJob(dimension, origin, facing, rectangle, paletteId) {
  const palette = paletteById(paletteId);
  // The palette speaks in material names; the manifest speaks in roles. Both
  // sides are small and explicit, so the mapping is written out rather than
  // inferred - a missing role leaves the placeholder alone rather than
  // replacing it with undefined.
  const byRole = {
    wall: `minecraft:${palette.wood}_planks`,
    foundation: `minecraft:${palette.stone}`,
    roof: `minecraft:${palette.roof}`,
    timber: `minecraft:${palette.wood}_log`,
    accent: `minecraft:${palette.stone}`
  };

  let swapped = 0;
  let scanned = 0;
  for (let f = rectangle.fMin; f <= rectangle.fMax; f++) {
    for (let s = rectangle.sMin; s <= rectangle.sMax; s++) {
      for (let up = rectangle.upMin; up <= rectangle.upMax; up++) {
        const at = toWorld(origin, facing, f, s, up);
        let typeId = null;
        try {
          typeId = dimension.getBlock({ x: at.x, y: at.y, z: at.z })?.typeId;
        } catch (error) {
          continue;   // unloaded edge; the structure queued its own loading
        }
        const role = PLACEHOLDER_BLOCKS[typeId];
        if (!role) continue;
        const material = byRole[role];
        if (!material) continue;
        if (setBlock(dimension, at.x, at.y, at.z, material)) swapped++;
        scanned++;
        if (scanned % 64 === 0) yield;
      }
    }
  }
  return swapped;
}

/**
 * Where each point of interest ended up, in world coordinates.
 *
 * This is what the rest of the mod needs from a placed building - which block
 * is the bed, which is the workstation, where the resident spawns - and it is
 * derived from the record rather than re-found by scanning the building.
 */
export function resolvePoi(record, origin, facing, plotForward, side) {
  return record.poi.map((entry) => {
    const at = toWorld(origin, facing, entry.at.f + plotForward, entry.at.s + side, entry.at.up);
    return Object.freeze({ kind: entry.kind, world: Object.freeze({ ...at }), local: entry.at });
  });
}

/**
 * A `shape` object of the same form the procedural builders return, so
 * downstream code (interiorCenter, NPC placement, plot protection) does not
 * have to know which path built the building.
 */
function shapeFor(record, rectangle, poi) {
  return Object.freeze({
    buildingId: record.id,
    source: "structure",
    structure: record.structure,
    f1: rectangle.fMin, f2: rectangle.fMax,
    s1: rectangle.sMin, s2: rectangle.sMax,
    sMin: rectangle.sMin, sMax: rectangle.sMax,
    midS: Math.round((rectangle.sMin + rectangle.sMax) / 2),
    upMin: rectangle.upMin, upMax: rectangle.upMax,
    poi: Object.freeze(poi)
  });
}

/**
 * Places one building.
 *
 * Returns a shape on success, or null when this building has no structure and
 * the caller should fall back to its procedural builder. Never throws: a build
 * that cannot happen has to leave the level-up able to continue, exactly as
 * the procedural path does.
 *
 * `options.swap` can be set false to skip the placeholder pass, and
 * `options.runJob` false to drain it inline (which is what the test emulator
 * and any engine without a job scheduler need). `options.record` supplies the
 * manifest record directly - the same injection idiom tryLevelUp uses for its
 * builder, and the only way to exercise this function's placement path while
 * the manifest is still empty.
 */
export function placeBuilding(dimension, origin, facing, buildingId, plotForward, side, paletteId, options) {
  const record = options?.record || buildingRecord(buildingId);
  if (!record) return null;
  if (!structureAvailable(buildingId, record)) {
    // Said out loud once, because a manifest record without its file is an
    // authoring mistake and the symptom otherwise is just a missing building.
    console.warn(`[village] no structure for ${buildingId} (${record.structure}); using the procedural builder`);
    return null;
  }

  const rectangle = localFootprint(record, plotForward, side);
  const anchor = worldAnchorFor(origin, facing, rectangle);

  try {
    world.structureManager.place(record.structure, dimension, anchor, {
      rotation: FACING_ROTATION[facing] ?? "None",
      includeEntities: false,
      waterlogged: false
    });
  } catch (error) {
    console.warn(`[village] structure placement failed for ${buildingId}: ${error}`);
    return null;
  }

  if (record.swapPlaceholders && options?.swap !== false) {
    const job = swapPlaceholdersJob(dimension, origin, facing, rectangle, paletteId);
    if (options?.runJob === false) {
      for (const _ of job) { /* drain inline */ }
    } else {
      try {
        system.runJob(job);
      } catch (error) {
        for (const _ of job) { /* no scheduler here - drain inline instead */ }
      }
    }
  }

  return shapeFor(record, rectangle, resolvePoi(record, origin, facing, plotForward, side));
}

/**
 * Captures a building that is already standing into a named structure.
 *
 * This is the authoring shortcut that makes the manifest worth having: rather
 * than rebuilding sixty houses by hand in a creative world, the procedural
 * builder that already draws one can draw it, and this saves the result. The
 * structure lands in the world (`StructureSaveMode.World`), which is where a
 * structure block can then export it to a `.mcstructure` file for the pack.
 *
 * Dev-time only. Nothing in the shipped runtime calls it.
 */
export function captureBuilding(dimension, origin, facing, rectangle, structureId) {
  if (!structuresSupported()) return { ok: false, reason: "unsupported" };
  const corners = [
    toWorld(origin, facing, rectangle.fMin, rectangle.sMin, rectangle.upMin),
    toWorld(origin, facing, rectangle.fMax, rectangle.sMax, rectangle.upMax)
  ];
  const from = {
    x: Math.min(corners[0].x, corners[1].x),
    y: origin.y + rectangle.upMin,
    z: Math.min(corners[0].z, corners[1].z)
  };
  const to = {
    x: Math.max(corners[0].x, corners[1].x),
    y: origin.y + rectangle.upMax,
    z: Math.max(corners[0].z, corners[1].z)
  };
  try {
    world.structureManager.createFromWorld(structureId, dimension, from, to, {
      includeEntities: false,
      saveMode: "World"
    });
    return { ok: true, structureId, from, to };
  } catch (error) {
    console.warn(`[village] could not capture ${structureId}: ${error}`);
    return { ok: false, reason: "capture_failed", error: String(error) };
  }
}

/**
 * Reports any manifest record whose structure file is missing, once, at
 * start-up. Called from main.js's deferred start-up block.
 */
export function reportMissingStructures() {
  const missing = missingStructures();
  if (missing.length === 0) return missing;
  console.warn(`[village] ${missing.length} manifest structure(s) missing from the pack: ${missing.join(", ")}`);
  return missing;
}
