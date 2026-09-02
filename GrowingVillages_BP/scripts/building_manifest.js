/**
 * Buildings described as data instead of written as code.
 *
 * Today a building is a function: sixty of them, averaging forty-eight lines
 * of hand-written block placement, plus a hundred and eighty hardcoded
 * coordinates. That is the ceiling on how much town this mod can ever contain
 * - MineColonies ships upwards of ten thousand schematics, and no amount of
 * writing `placer.box(...)` gets anywhere near that.
 *
 * A record here replaces one of those functions. The geometry moves into a
 * `.mcstructure` file authored in-game with a structure block; what stays in
 * code is the small amount that geometry cannot express: where the building
 * sits relative to its plot, which of its blocks are palette placeholders,
 * and where the points of interest are that the rest of the mod needs to know
 * about (the bed a villager claims, the workstation that gives it a
 * profession, the chest a worker stores into).
 *
 * This module imports nothing - not even @minecraft/server - so it can be
 * validated in full without a world. `structure_build.js` is the half that
 * touches the game.
 *
 * ── Coordinates ───────────────────────────────────────────────────────────
 *
 * Everything is in the mod's own local frame: `f` runs along the street, `s`
 * across it, `up` is height, and `toWorld(origin, facing, f, s, up)` turns
 * that into world space. A record's `footprint` is relative to its PLOT
 * ANCHOR, the same `(plotForward, side)` pair the existing builders take - so
 * a record is placement-independent and one building can stand on any plot.
 *
 * ── Palette placeholders ──────────────────────────────────────────────────
 *
 * A `.mcstructure` freezes actual block ids, but this mod picks materials from
 * the village's biome palette (oak in plains, spruce in taiga, sandstone in
 * desert). Rather than authoring one structure per palette - five files per
 * building, and five files to re-author on every change - a structure is built
 * once out of PLACEHOLDER blocks, and the placer swaps them for the palette's
 * real materials after placement. `PLACEHOLDER_BLOCKS` is that mapping, and it
 * is deliberately made of blocks that would never appear in a village for real,
 * so a swap can never eat a block that was meant to stay.
 */

/** Placeholder block -> which palette material replaces it after placement. */
export const PLACEHOLDER_BLOCKS = Object.freeze({
  // Chosen because none of them occurs anywhere in a built village, so the
  // swap pass can key off the block id alone with no risk of a false match.
  // Verified against the ids the existing builders actually place.
  "minecraft:purple_terracotta": "wall",
  "minecraft:red_wool": "foundation",
  "minecraft:white_wool": "roof",
  "minecraft:copper_block": "timber",
  "minecraft:quartz_block": "accent"
});

/** The material roles a palette has to be able to answer for. */
export const MATERIAL_ROLES = Object.freeze(["wall", "foundation", "roof", "timber", "accent"]);

/** Point-of-interest kinds the rest of the mod knows how to use. */
export const POI_KINDS = Object.freeze([
  "bed",          // a villager claims it and comes home to it
  "workstation",  // a villager claims it and takes its profession
  "storage",      // a worker's chest or barrel
  "light",        // a lantern or torch the build wants lit
  "npc"           // where this building's resident should spawn
]);

function isInt(value) {
  return Number.isInteger(value);
}

function rect(bounds, label) {
  if (!bounds || !["fMin", "fMax", "sMin", "sMax", "upMin", "upMax"].every((key) => isInt(bounds[key]))) {
    throw new Error(`${label}: footprint needs integer fMin/fMax/sMin/sMax/upMin/upMax`);
  }
  if (bounds.fMin > bounds.fMax || bounds.sMin > bounds.sMax || bounds.upMin > bounds.upMax) {
    throw new Error(`${label}: footprint bounds are inverted`);
  }
  return Object.freeze({
    fMin: bounds.fMin, fMax: bounds.fMax,
    sMin: bounds.sMin, sMax: bounds.sMax,
    upMin: bounds.upMin, upMax: bounds.upMax
  });
}

function point(at, label, index) {
  if (!at || !["f", "s", "up"].every((key) => isInt(at[key]))) {
    throw new Error(`${label}: poi ${index} needs integer f/s/up`);
  }
  return Object.freeze({ f: at.f, s: at.s, up: at.up });
}

/** The size a `.mcstructure` must be for a footprint, in structure axes. */
export function structureSizeFor(footprint) {
  return Object.freeze({
    x: footprint.fMax - footprint.fMin + 1,
    y: footprint.upMax - footprint.upMin + 1,
    z: footprint.sMax - footprint.sMin + 1
  });
}

/**
 * Bedrock refuses to save a structure larger than 64 blocks on the horizontal
 * axes (384 vertically). A record that asks for more can never have a file, so
 * it is rejected here rather than failing silently at placement time.
 */
export const MAX_STRUCTURE_SPAN = Object.freeze({ x: 64, y: 384, z: 64 });

/**
 * Validates and freezes one building record. Throws rather than returning a
 * flag: a malformed record is an authoring mistake, and the whole point of
 * moving buildings into data is that the data is checkable up front.
 */
export function defineBuilding(spec) {
  const id = spec?.id;
  if (typeof id !== "string" || id.length === 0) throw new Error("building record needs an id");
  if (typeof spec.structure !== "string" || !spec.structure.includes(":")) {
    throw new Error(`${id}: structure must be a namespaced identifier, e.g. "gv:buildings/cottage"`);
  }

  const footprint = rect(spec.footprint, id);
  const size = structureSizeFor(footprint);
  for (const axis of ["x", "y", "z"]) {
    if (size[axis] > MAX_STRUCTURE_SPAN[axis]) {
      throw new Error(`${id}: footprint is ${size[axis]} on ${axis}, over Bedrock's ${MAX_STRUCTURE_SPAN[axis]} limit`);
    }
  }

  const poi = (spec.poi || []).map((entry, index) => {
    if (!POI_KINDS.includes(entry?.kind)) {
      throw new Error(`${id}: poi ${index} has unknown kind "${entry?.kind}" (expected one of ${POI_KINDS.join(", ")})`);
    }
    const at = point(entry.at, id, index);
    // A point of interest outside the building would be placed into whatever
    // happens to be there - most likely nothing at all.
    if (at.f < footprint.fMin || at.f > footprint.fMax ||
        at.s < footprint.sMin || at.s > footprint.sMax ||
        at.up < footprint.upMin || at.up > footprint.upMax) {
      throw new Error(`${id}: poi ${index} (${at.f},${at.s},${at.up}) lies outside the footprint`);
    }
    return Object.freeze({ kind: entry.kind, at, note: entry.note || "" });
  });

  // Exactly one npc point at most: two would mean two residents in one house,
  // and the level pipeline spawns one.
  const npcPoints = poi.filter((entry) => entry.kind === "npc");
  if (npcPoints.length > 1) throw new Error(`${id}: ${npcPoints.length} npc points, expected at most one`);

  return Object.freeze({
    id,
    structure: spec.structure,
    footprint,
    size,
    poi: Object.freeze(poi),
    /** false for a building whose structure is authored per palette already. */
    swapPlaceholders: spec.swapPlaceholders !== false,
    /** Which procedural builder to fall back to while no structure file exists. */
    fallback: typeof spec.fallback === "string" ? spec.fallback : null,
    note: spec.note || ""
  });
}

/**
 * The manifest itself.
 *
 * Deliberately empty. Every entry needs a `.mcstructure` file authored in-game
 * with a structure block, and shipping a record whose file does not exist would
 * mean a building that silently fails to appear. The runtime is written so an
 * empty manifest changes nothing: `buildingRecord()` returns null, and
 * `structure_build.js` hands straight back to the procedural builder that
 * builds that house today.
 *
 * Adding a building is then two steps and no new code:
 *
 *   1. build it in-game, select it with a structure block, Export to
 *      `GrowingVillages_BP/structures/gv/buildings/<name>.mcstructure`;
 *   2. append a record here.
 *
 * The shape of a record, for when the first one lands:
 *
 *   defineBuilding({
 *     id: "resident_cottage",
 *     structure: "gv:buildings/resident_cottage",
 *     fallback: "buildPlainHouse",
 *     footprint: { fMin: 0, fMax: 6, sMin: -3, sMax: 3, upMin: -1, upMax: 5 },
 *     poi: [
 *       { kind: "bed",      at: { f: 1, s: 2, up: 0 } },
 *       { kind: "storage",  at: { f: 5, s: 2, up: 0 } },
 *       { kind: "npc",      at: { f: 3, s: 0, up: 0 } }
 *     ],
 *     note: "The starter house, and every plain resident house after it."
 *   })
 */
export const BUILDING_MANIFEST = Object.freeze([]);

const BY_ID = Object.freeze(
  BUILDING_MANIFEST.reduce((map, entry) => { map[entry.id] = entry; return map; }, {}));

/** One building record, or null when nothing is declared for that id. */
export function buildingRecord(id) {
  return BY_ID[id] || null;
}

/** Every structure identifier the manifest expects the pack to contain. */
export function requiredStructureIds() {
  return BUILDING_MANIFEST.map((entry) => entry.structure);
}
