import { ItemStack } from "@minecraft/server";
import { makePlacer } from "./builder.js";
import { prepareSite, sampleGroundLevel, withLoadedArea } from "./terrain.js";
import { FINAL_RADIUS } from "./spatial_plan.js";
import { toWorld } from "./util.js";

/**
 * Satellite sites raised outside the village by the survey charter.
 *
 * These deliberately sit past FINAL_RADIUS, not past the village's *current*
 * wall. Anchoring them to the wall as it stands would look right at the time
 * and then be swallowed whole when the wall grows - a village that reaches
 * level 15 pushes its curtain out to R94, and an outpost placed just beyond an
 * R44 palisade would end up sitting inside the town square. Twelve blocks past
 * the furthest the wall can ever reach is a promise the geometry can keep.
 *
 * They are on the diagonals for the same reason: both road arms run out to the
 * gates on the axes, so a diagonal site is guaranteed to miss them without
 * needing to know anything about roads.
 */

const OUTPOST_RING = FINAL_RADIUS + 12;

/** Half-width of the ground an outpost claims, used for site prep and spacing. */
export const OUTPOST_HALF = 8;

export const OUTPOST_SLOTS = Object.freeze([
  Object.freeze({ id: "north_east", f: OUTPOST_RING, s: -OUTPOST_RING }),
  Object.freeze({ id: "south_east", f: OUTPOST_RING, s: OUTPOST_RING }),
  Object.freeze({ id: "south_west", f: -OUTPOST_RING, s: OUTPOST_RING }),
  Object.freeze({ id: "north_west", f: -OUTPOST_RING, s: -OUTPOST_RING })
]);

/**
 * Loot is deliberately unexciting. The mod's standing rule is that the village
 * must never out-earn the player's own mining and farming (see production.js's
 * caps and the note in HANDOVER.md), and a chest full of diamonds at the end of
 * a two-minute walk would break that harder than any production change.
 * Everything here is a saved errand, not a windfall.
 */
const LOOT = Object.freeze({
  abandoned_mine: [
    { id: "minecraft:iron_ingot", amount: 3 },
    { id: "minecraft:coal", amount: 8 },
    { id: "minecraft:rail", amount: 6 },
    { id: "minecraft:torch", amount: 12 },
    { id: "minecraft:bread", amount: 3 }
  ],
  watchtower_ruin: [
    { id: "minecraft:iron_ingot", amount: 2 },
    { id: "minecraft:arrow", amount: 12 },
    { id: "minecraft:bone", amount: 4 },
    { id: "minecraft:paper", amount: 4 },
    { id: "minecraft:lantern", amount: 1 }
  ],
  forest_camp: [
    { id: "minecraft:bread", amount: 4 },
    { id: "minecraft:string", amount: 6 },
    { id: "minecraft:oak_sapling", amount: 6 },
    { id: "minecraft:leather", amount: 3 },
    { id: "minecraft:torch", amount: 8 }
  ],
  quarry: [
    { id: "minecraft:cobblestone", amount: 32 },
    { id: "minecraft:stone_bricks", amount: 12 },
    { id: "minecraft:coal", amount: 6 },
    { id: "minecraft:iron_ingot", amount: 2 },
    { id: "minecraft:torch", amount: 8 }
  ]
});

function fillChest(dimension, origin, facing, f, s, up, kind) {
  const at = toWorld(origin, facing, f, s, up);
  try {
    const block = dimension.getBlock(at);
    const container = block?.getComponent("minecraft:inventory")?.container;
    if (!container) return false;
    let slot = 0;
    for (const entry of LOOT[kind] || []) {
      container.setItem(slot++, new ItemStack(entry.id, entry.amount));
    }
    return true;
  } catch (error) {
    console.warn(`[village] outpost loot failed for ${kind}: ${error}`);
    return false;
  }
}

/** An abandoned mine: a boarded pit-head over a shaft down to a small stope. */
function buildAbandonedMine(placer, centre) {
  const { f, s } = centre;
  placer.box(f - 5, s - 5, -1, f + 5, s + 5, -1, "minecraft:gravel");
  placer.box(f - 3, s - 3, -1, f + 3, s + 3, -1, "minecraft:cobblestone");
  placer.box(f - 5, s - 5, 0, f + 5, s + 5, 5, "minecraft:air");

  // Headframe: four leaning posts and a plank cap, half of it fallen in.
  for (const df of [-3, 3]) for (const ds of [-3, 3]) placer.box(f + df, s + ds, 0, f + df, s + ds, 4, "minecraft:oak_log");
  placer.box(f - 3, s - 3, 5, f + 3, s + 3, 5, "minecraft:oak_planks");
  placer.box(f + 1, s + 1, 5, f + 3, s + 3, 5, "minecraft:air");
  placer.box(f - 3, s - 3, 4, f - 3, s + 3, 4, "minecraft:oak_fence");

  // The shaft, with a ladder and a lit landing so it is not a black hole.
  placer.box(f, s, -1, f, s, -11, "minecraft:air");
  for (let d = 1; d <= 11; d++) placer.block(f, s, -d, "minecraft:ladder", { facing_direction: 3 });
  placer.box(f - 3, s - 3, -12, f + 3, s + 3, -12, "minecraft:cobblestone");
  placer.box(f - 3, s - 3, -11, f + 3, s + 3, -9, "minecraft:air");
  placer.box(f - 3, s - 3, -11, f + 3, s - 3, -9, "minecraft:stone");
  placer.box(f - 3, s + 3, -11, f + 3, s + 3, -9, "minecraft:stone");
  placer.box(f - 3, s - 3, -11, f - 3, s + 3, -9, "minecraft:stone");
  placer.box(f + 3, s - 3, -11, f + 3, s + 3, -9, "minecraft:stone");
  // A worked-out seam in the wall, and the rails they left behind.
  placer.block(f - 3, s - 1, -11, "minecraft:coal_ore");
  placer.block(f - 3, s + 1, -11, "minecraft:iron_ore");
  placer.block(f + 3, s, -11, "minecraft:coal_ore");
  for (let ds = -2; ds <= 2; ds++) placer.block(f + 2, s + ds, -11, "minecraft:rail");
  placer.block(f - 2, s - 2, -10, "minecraft:torch");
  placer.block(f + 2, s + 2, -10, "minecraft:torch");
  placer.block(f - 2, s + 2, -11, "minecraft:chest");
  return { chest: { f: f - 2, s: s + 2, up: -11 }, centre };
}

/** A watchtower that fell over: three storeys of stone with the top gone. */
function buildWatchtowerRuin(placer, centre) {
  const { f, s } = centre;
  placer.box(f - 5, s - 5, -1, f + 5, s + 5, -1, "minecraft:coarse_dirt");
  placer.box(f - 5, s - 5, 0, f + 5, s + 5, 9, "minecraft:air");
  placer.box(f - 3, s - 3, -1, f + 3, s + 3, -1, "minecraft:cobblestone");

  placer.box(f - 2, s - 2, 0, f + 2, s + 2, 7, "minecraft:stone_bricks");
  placer.box(f - 1, s - 1, 0, f + 1, s + 1, 6, "minecraft:air");
  // The collapse: the upper courses are gone on two sides, and what came down
  // is lying on the ground beside it.
  placer.box(f - 2, s - 2, 5, f + 2, s + 2, 7, "minecraft:air");
  placer.box(f - 2, s - 2, 5, f - 2, s + 2, 6, "minecraft:stone_bricks");
  placer.box(f - 2, s - 2, 5, f + 2, s - 2, 5, "minecraft:stone_bricks");
  placer.block(f - 2, s - 2, 6, "minecraft:cobblestone");
  for (const [df, ds] of [[4, 1], [4, 2], [3, 4], [-4, 3], [1, -4]]) {
    placer.block(f + df, s + ds, 0, "minecraft:mossy_cobblestone");
  }
  placer.box(f - 1, s - 1, 0, f - 1, s - 1, 4, "minecraft:ladder");
  placer.block(f + 2, s, 0, "minecraft:air");
  placer.block(f + 2, s, 1, "minecraft:air");
  placer.block(f + 1, s + 1, 0, "minecraft:chest");
  placer.block(f, s, 0, "minecraft:campfire", { extinguished: true });
  placer.block(f - 1, s + 1, 4, "minecraft:torch");
  return { chest: { f: f + 1, s: s + 1, up: 0 }, centre };
}

/** A forest camp: two wool tents round a fire, long since left. */
function buildForestCamp(placer, centre) {
  const { f, s } = centre;
  placer.box(f - 5, s - 5, -1, f + 5, s + 5, -1, "minecraft:podzol");
  placer.box(f - 5, s - 5, 0, f + 5, s + 5, 4, "minecraft:air");
  placer.box(f - 1, s - 1, -1, f + 1, s + 1, -1, "minecraft:cobblestone");
  placer.block(f, s, 0, "minecraft:campfire", { extinguished: false });
  for (const [df, ds] of [[-2, -2], [2, 2], [-2, 2], [2, -2]]) placer.block(f + df, s + ds, 0, "minecraft:oak_log");

  for (const side of [-4, 4]) {
    // A ridge pole with the canvas falling away either side of it - a tent
    // rather than a box. Wool has no stair form, so the pitch is made by
    // stepping whole blocks down, not by placing stairs.
    placer.box(f - 2, s + side, 2, f + 2, s + side, 2, "minecraft:oak_fence");
    placer.box(f - 2, s + side, 1, f + 2, s + side, 1, "minecraft:white_wool");
    for (const offset of [-1, 1]) {
      placer.box(f - 2, s + side + offset, 0, f + 2, s + side + offset, 1, "minecraft:white_wool");
    }
    // The doorway at the near end, so the tent can be walked into.
    placer.block(f, s + side - 1, 0, "minecraft:air");
    placer.block(f, s + side, 0, "minecraft:air");
  }
  placer.block(f + 3, s, 0, "minecraft:chest");
  placer.block(f - 3, s, 0, "minecraft:crafting_table");
  placer.block(f, s + 2, 0, "minecraft:barrel");
  return { chest: { f: f + 3, s, up: 0 }, centre };
}

/** A quarry: a stepped cut into the ground with the tools still in it. */
function buildQuarry(placer, centre) {
  const { f, s } = centre;
  placer.box(f - 6, s - 6, -1, f + 6, s + 6, -1, "minecraft:stone");
  placer.box(f - 6, s - 6, 0, f + 6, s + 6, 4, "minecraft:air");
  // Three cut steps down. Each terrace is one block narrower and one deeper,
  // so the shape comes out of the arithmetic rather than being drawn by hand.
  for (let step = 0; step < 3; step++) {
    const half = 4 - step;
    const depth = -2 - step * 2;
    placer.box(f - half, s - half, depth, f + half, s + half, depth, "minecraft:stone");
    placer.box(f - half, s - half, depth + 1, f + half, s + half, -1, "minecraft:air");
  }
  placer.box(f - 2, s - 2, -6, f + 2, s + 2, -6, "minecraft:andesite");
  for (const [df, ds] of [[-3, 0], [3, 1], [0, -3]]) placer.block(f + df, s + ds, -5, "minecraft:cobblestone");
  placer.block(f - 1, s - 1, -5, "minecraft:chest");
  placer.block(f + 1, s + 1, -5, "minecraft:torch");
  placer.block(f, s + 5, 0, "minecraft:crafting_table");
  return { chest: { f: f - 1, s: s - 1, up: -5 }, centre };
}

export const OUTPOST_KINDS = Object.freeze({
  abandoned_mine: { label: "Заброшенная шахта", build: buildAbandonedMine, clearHeight: 8, fillDepth: 3 },
  watchtower_ruin: { label: "Руины дозорной башни", build: buildWatchtowerRuin, clearHeight: 12, fillDepth: 4 },
  forest_camp: { label: "Лесной лагерь", build: buildForestCamp, clearHeight: 8, fillDepth: 4 },
  quarry: { label: "Старый карьер", build: buildQuarry, clearHeight: 8, fillDepth: 2 }
});

export const OUTPOST_ORDER = Object.freeze(["abandoned_mine", "watchtower_ruin", "forest_camp", "quarry"]);

/**
 * Builds one outpost on one slot. Returns a result rather than throwing:
 * outposts are optional content and a failure must not cost the player the
 * charter or break the village.
 */
export function buildOutpost(kind, slotId, dimension, state) {
  const spec = OUTPOST_KINDS[kind];
  const slot = OUTPOST_SLOTS.find((entry) => entry.id === slotId);
  if (!spec || !slot) return { ok: false, reason: "unknown_outpost" };
  if (!dimension || !state?.origin) return { ok: false, reason: "no_state" };

  const bounds = {
    fMin: slot.f - OUTPOST_HALF, fMax: slot.f + OUTPOST_HALF,
    sMin: slot.s - OUTPOST_HALF, sMax: slot.s + OUTPOST_HALF
  };
  try {
    let shape = null;
    withLoadedArea(dimension, state.origin, state.facing, bounds, () => {
      const sample = sampleGroundLevel(dimension, state.origin, state.facing,
        bounds.fMin, bounds.fMax, bounds.sMin, bounds.sMax);
      prepareSite(dimension, state.origin, state.facing,
        bounds.fMin, bounds.fMax, bounds.sMin, bounds.sMax, {
          padding: 0,
          clearHeight: spec.clearHeight,
          fillDepth: spec.fillDepth,
          surfaceBlock: "minecraft:grass_block",
          surfaceType: sample.surfaceType
        });
      const placer = makePlacer(dimension, state.origin, state.facing);
      shape = spec.build(placer, { f: slot.f, s: slot.s });
    });
    const looted = shape ? fillChest(dimension, state.origin, state.facing, shape.chest.f, shape.chest.s, shape.chest.up, kind) : false;
    return { ok: true, kind, slotId, label: spec.label, shape, looted, bounds };
  } catch (error) {
    console.warn(`[village] outpost ${kind} failed: ${error}`);
    return { ok: false, reason: "build_failed", kind, slotId, error: String(error) };
  }
}
