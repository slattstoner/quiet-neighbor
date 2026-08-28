import { system } from "@minecraft/server";
import { setBlock, toWorld } from "./util.js";

/**
 * Blocks that shouldn't count as "the ground" when probing for surface
 * height - foliage, snow layers, water and so on sit on top of the real
 * surface and would otherwise skew the level upward.
 */
const NOT_GROUND = new Set([
  "minecraft:air",
  "minecraft:water", "minecraft:flowing_water",
  "minecraft:lava", "minecraft:flowing_lava",
  "minecraft:snow_layer", "minecraft:snow",
  "minecraft:tallgrass", "minecraft:short_grass", "minecraft:grass",
  "minecraft:double_plant", "minecraft:fern", "minecraft:large_fern",
  "minecraft:yellow_flower", "minecraft:red_flower",
  "minecraft:oak_leaves", "minecraft:birch_leaves", "minecraft:spruce_leaves",
  "minecraft:jungle_leaves", "minecraft:acacia_leaves", "minecraft:dark_oak_leaves",
  "minecraft:leaves", "minecraft:leaves2",
  "minecraft:oak_log", "minecraft:birch_log", "minecraft:spruce_log", "minecraft:log", "minecraft:log2",
  // Bedrock's sugar cane block is "reeds"; "sugar_cane" is the item id only,
  // so it never matched a real block.typeId here. Both kept: harmless if unused.
  "minecraft:deadbush", "minecraft:vine", "minecraft:reeds", "minecraft:sugar_cane",
  "minecraft:brown_mushroom", "minecraft:red_mushroom",
  "minecraft:pink_petals", "minecraft:bush", "minecraft:firefly_bush"
]);

/** Natural blocks that may be safely removed while preparing a village. */
const TERRAIN_BLOCKS = new Set([
  "minecraft:grass_block", "minecraft:dirt", "minecraft:coarse_dirt",
  // Bedrock names rooted dirt "dirt_with_roots" and plain terracotta
  // "hardened_clay"; the Java-style names below never matched anything.
  "minecraft:dirt_with_roots", "minecraft:rooted_dirt",
  "minecraft:podzol", "minecraft:mycelium", "minecraft:mud",
  "minecraft:stone", "minecraft:granite", "minecraft:diorite", "minecraft:andesite",
  "minecraft:tuff", "minecraft:deepslate", "minecraft:cobbled_deepslate",
  "minecraft:sand", "minecraft:red_sand", "minecraft:sandstone", "minecraft:red_sandstone",
  "minecraft:gravel", "minecraft:clay",
  "minecraft:hardened_clay", "minecraft:terracotta", "minecraft:snow_block",
  "minecraft:ice", "minecraft:packed_ice", "minecraft:blue_ice"
]);

function isVoidOrFoliage(typeId) {
  return !typeId || NOT_GROUND.has(typeId);
}

/** True if the local (f, s) column falls inside any of the given rectangles. */
function insideAnyRect(f, s, rects) {
  if (!rects || rects.length === 0) return false;
  for (const r of rects) {
    if (f >= r.fMin && f <= r.fMax && s >= r.sMin && s <= r.sMax) return true;
  }
  return false;
}

// Logs are ignored while probing ground, but they are also the structural
// frame of every house. Never treat them as disposable terrain inside a
// village perimeter.
function isClearableNature(typeId) {
  return isVoidOrFoliage(typeId) && !String(typeId || "").includes("log");
}

export function isNaturalTerrain(typeId) {
  return TERRAIN_BLOCKS.has(typeId);
}

/** Blocks safe to build a foundation out of, based on what the surface already is. */
function fillMaterialFor(surfaceType) {
  if (!surfaceType) return "minecraft:dirt";
  if (surfaceType.includes("sand")) return "minecraft:sandstone";
  if (surfaceType.includes("stone") || surfaceType.includes("granite") ||
      surfaceType.includes("andesite") || surfaceType.includes("diorite")) return "minecraft:stone";
  return "minecraft:dirt";
}

/**
 * Probes downward to find the highest solid ground block in a column.
 * Returns { y, typeId } or null if nothing solid was found.
 */
export function probeGround(dimension, x, z, startY, minY) {
  for (let y = startY; y >= minY; y--) {
    try {
      const block = dimension.getBlock({ x, y, z });
      if (!block) continue;
      const id = block.typeId;
      if (!NOT_GROUND.has(id)) {
        return { y, typeId: id };
      }
    } catch (e) {
      /* unloaded - keep scanning */
    }
  }
  return null;
}

/**
 * Samples the terrain across a footprint and returns the height the
 * village platform should sit at. Uses the median rather than the mean so
 * a single cliff or pond in the footprint doesn't drag the whole village
 * up or down.
 */
export function sampleGroundLevel(dimension, origin, facing, fMin, fMax, sMin, sMax) {
  const heights = [];
  const step = 2;
  let surfaceType = null;
  for (let f = fMin; f <= fMax; f += step) {
    for (let s = sMin; s <= sMax; s += step) {
      const p = toWorld(origin, facing, f, s, 0);
      const ground = probeGround(dimension, p.x, p.z, origin.y + 24, origin.y - 24);
      if (ground) {
        heights.push(ground.y);
        if (!surfaceType) surfaceType = ground.typeId;
      }
    }
  }
  if (heights.length === 0) return { y: origin.y - 1, surfaceType: "minecraft:grass_block" };
  heights.sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  return { y: median, surfaceType: surfaceType || "minecraft:grass_block" };
}

/**
 * Carves a flat build platform: clears everything above the target level
 * within the footprint, and backfills any gaps below it, so a building
 * placed here never floats over a dip or buries itself in a hillside.
 *
 * `padding` widens the cleared area beyond the building itself so there's
 * a bit of flat ground around the walls, the way vanilla village plots do.
 */
export function prepareSite(dimension, origin, facing, fMin, fMax, sMin, sMax, options) {
  const opts = options || {};
  const padding = opts.padding === undefined ? 1 : opts.padding;
  const clearHeight = opts.clearHeight === undefined ? 12 : opts.clearHeight;
  const fillDepth = opts.fillDepth === undefined ? 5 : opts.fillDepth;
  const surfaceBlock = opts.surfaceBlock || "minecraft:grass_block";
  const fillBlock = opts.fillBlock || fillMaterialFor(opts.surfaceType);

  const f1 = fMin - padding, f2 = fMax + padding;
  const s1 = sMin - padding, s2 = sMax + padding;

  for (let f = f1; f <= f2; f++) {
    for (let s = s1; s <= s2; s++) {
      // Clear the air column above the platform
      for (let up = 0; up < clearHeight; up++) {
        const p = toWorld(origin, facing, f, s, up);
        setBlock(dimension, p.x, p.y, p.z, "minecraft:air");
      }
      // Lay the surface course, then backfill any hollow ground beneath it
      const surface = toWorld(origin, facing, f, s, -1);
      setBlock(dimension, surface.x, surface.y, surface.z, surfaceBlock);
      for (let down = 2; down <= fillDepth + 1; down++) {
        const p = toWorld(origin, facing, f, s, -down);
        let existing = null;
        try {
          const block = dimension.getBlock({ x: p.x, y: p.y, z: p.z });
          existing = block ? block.typeId : null;
        } catch (e) {
          continue;
        }
        // Only fill genuine voids (air/water/foliage); leave real stone alone
        if (existing !== null && NOT_GROUND.has(existing)) {
          setBlock(dimension, p.x, p.y, p.z, fillBlock);
        }
      }
    }
  }
}

/**
 * Clears natural terrain inside a new defensive ring while preserving the
 * buildings, roads, fields and player-made blocks already in the village.
 * A height spread over five blocks signals a steep hillside and therefore
 * uses a higher cleanup volume, so the perimeter cannot climb a hill and
 * leave a visible break.
 *
 * `protectedRects` are plot footprints (in the same local f/s coordinates)
 * that must never be touched by the interior sweep. The wall perimeter is
 * always sized to the village's final extent from the very first
 * fortification tier (see fullVillageMaxForward()), so this same interior
 * gets swept again at every later tier (L5, L8, L10) - and without this
 * exclusion list, that repeat sweep reclassifies already-built floors as
 * "natural terrain" whenever their material happens to also be a raw
 * terrain block (a stone floor, a sandstone wall, a gravel yard...) and
 * pastes grass_block over them. That is the "blacksmith house floor turned
 * to grass" bug.
 */
export function prepareFortifiedArea(dimension, origin, facing, rect, protectedRects) {
  const heights = [];
  const sampleStep = 4;
  const sample = (forward, side) => {
    const p = toWorld(origin, facing, forward, side, 0);
    const ground = probeGround(dimension, p.x, p.z, origin.y + 32, origin.y - 32);
    if (ground) heights.push(ground.y);
  };
  for (let f = rect.fMin; f <= rect.fMax; f += sampleStep) {
    sample(f, rect.sMin);
    sample(f, rect.sMax);
  }
  for (let s = rect.sMin; s <= rect.sMax; s += sampleStep) {
    sample(rect.fMin, s);
    sample(rect.fMax, s);
  }

  const minY = heights.length ? Math.min(...heights) : origin.y - 1;
  const maxY = heights.length ? Math.max(...heights) : origin.y - 1;
  const steep = maxY - minY > 5;
  const clearHeight = steep ? 28 : 12;
  const fillDepth = steep ? 12 : 6;

  // The interior terrain-flattening pass is the dominant cost here: a
  // full-size perimeter (radius 48, sized to the village's final extent
  // from the very first fortification tier) sweeps up to ~9000 columns,
  // each with up to ~40 native block calls - confirmed live to trigger a
  // Bedrock watchdog hang at L5 on-device. None of that work is needed
  // before the wall itself: the ring, gate and towers get their own ground
  // support from supportWallFoundation() per ring position, independent of
  // this interior sweep. So it runs as a background job spread across
  // ticks via system.runJob rather than one unbroken synchronous loop - the
  // wall finishes immediately as before, and the enclosed ground finishes
  // flattening a moment later.
  system.runJob(interiorFlattenJob(dimension, origin, facing, rect, clearHeight, fillDepth, protectedRects));

  return { steep, minY, maxY, clearHeight };
}

/** The actual interior sweep, chunked so it never holds up a single tick for long. */
function* interiorFlattenJob(dimension, origin, facing, rect, clearHeight, fillDepth, protectedRects) {
  let ops = 0;
  const YIELD_EVERY = 40;
  for (let f = rect.fMin + 1; f <= rect.fMax - 1; f++) {
    for (let s = rect.sMin + 1; s <= rect.sMax - 1; s++) {
      if (insideAnyRect(f, s, protectedRects)) continue;
      for (let up = 0; up <= clearHeight; up++) {
        const p = toWorld(origin, facing, f, s, up);
        let typeId = null;
        try { typeId = dimension.getBlock({ x: p.x, y: p.y, z: p.z })?.typeId; } catch (e) { continue; }
        if (isNaturalTerrain(typeId) || isClearableNature(typeId)) {
          setBlock(dimension, p.x, p.y, p.z, "minecraft:air");
        }
      }

      const surface = toWorld(origin, facing, f, s, -1);
      let surfaceType = null;
      try { surfaceType = dimension.getBlock(surface)?.typeId; } catch (e) { surfaceType = null; }
      if (isNaturalTerrain(surfaceType) || isClearableNature(surfaceType)) {
        setBlock(dimension, surface.x, surface.y, surface.z, "minecraft:grass_block");
      }

      for (let down = 2; down <= fillDepth + 1; down++) {
        const p = toWorld(origin, facing, f, s, -down);
        let typeId = null;
        try { typeId = dimension.getBlock({ x: p.x, y: p.y, z: p.z })?.typeId; } catch (e) { continue; }
        if (isVoidOrFoliage(typeId)) setBlock(dimension, p.x, p.y, p.z, "minecraft:dirt");
      }

      ops++;
      if (ops % YIELD_EVERY === 0) yield;
    }
  }
}

let loadedAreaCounter = 0;

/**
 * setBlock()/setType() (see util.js) deliberately swallow errors from
 * unloaded chunks so one bad coordinate never aborts a whole build - but
 * that also means an unloaded chunk fails completely silently. A village's
 * wall ring and corner towers sit up to ~48 blocks from the town hall, and
 * special buildings sit at 48-60: well outside the area that's reliably
 * loaded around whoever triggered the build. That is the most likely cause
 * of "wall corners never finished" and "leftover terrain never cleared" -
 * not a code bug in the builder itself, just chunks that were never there
 * to write into.
 *
 * This wraps a build step in a temporary ticking area covering its full
 * footprint (in world space) so every block call in that step lands
 * regardless of player position, then removes the ticking area again.
 * Best-effort: if /tickingarea can't be run (missing permission, older
 * engine, or the unit-test mock, which has no runCommand at all) the build
 * still runs exactly as before, just without the guarantee.
 *
 * The area is released `holdTicks` ticks AFTER fn() returns, not in the same
 * tick. /tickingarea add does not load chunks synchronously - they stream in
 * over the following ticks - so registering and removing the area inside one
 * synchronous build gave the engine no window at all to load anything, and
 * every deferred step that depends on it (buildFortifications' corner-tower
 * retries, withRetry's guard/golem spawns, both scheduled tens of ticks out)
 * ran against chunks that had already been let go again. That is why the
 * far corners - the only part of a village that sits ~68 blocks out, past
 * the default simulation distance - silently lost their towers.
 */
export function withLoadedArea(dimension, origin, facing, rect, fn, holdTicks = 400) {
  const release = holdLoadedArea(dimension, origin, facing, rect);
  try {
    return fn();
  } finally {
    release(holdTicks);
  }
}

/**
 * Registers a ticking area over `rect` and hands back a release function.
 * Call `release(holdTicks)` when the work is finished; the area then lives on
 * for that many more ticks. Use this (rather than withLoadedArea) for work
 * that outlives the call that started it - a system.runJob build, say.
 *
 * Bedrock caps a single ticking area at 100 chunks, so an oversized rect is
 * split into a grid of areas rather than being rejected wholesale by the
 * engine - a silent rejection is exactly the failure mode this is here to
 * prevent.
 */
export function holdLoadedArea(dimension, origin, facing, rect) {
  const names = [];
  if (typeof dimension.runCommand !== "function") return () => {};

  const corners = [
    toWorld(origin, facing, rect.fMin, rect.sMin, 0),
    toWorld(origin, facing, rect.fMin, rect.sMax, 0),
    toWorld(origin, facing, rect.fMax, rect.sMin, 0),
    toWorld(origin, facing, rect.fMax, rect.sMax, 0)
  ];
  const x1 = Math.min(...corners.map(c => c.x)) - 2;
  const x2 = Math.max(...corners.map(c => c.x)) + 2;
  const z1 = Math.min(...corners.map(c => c.z)) - 2;
  const z2 = Math.max(...corners.map(c => c.z)) + 2;
  const y1 = origin.y - 32, y2 = origin.y + 32;

  // 9 chunks a side is 81 chunks - inside Bedrock's 100-chunk-per-area cap
  // with room to spare for the padding rounding either way.
  const SPAN = 9 * 16;
  for (let x = x1; x <= x2; x += SPAN) {
    for (let z = z1; z <= z2; z += SPAN) {
      const name = `gv_${loadedAreaCounter++}`;
      try {
        dimension.runCommand(
          `tickingarea add ${x} ${y1} ${z} ${Math.min(x + SPAN - 1, x2)} ${y2} ${Math.min(z + SPAN - 1, z2)} ${name}`);
        names.push(name);
      } catch (e) {
        // The engine also caps the world at 10 ticking areas; once that is
        // hit the rest of the grid simply is not covered. Nothing else to
        // do about it here, and it must not abort the build.
        console.warn("[village] could not add ticking area: " + e);
      }
    }
  }

  let released = false;
  return (holdTicks = 0) => {
    if (released) return;
    released = true;
    for (const name of names) releaseLoadedArea(dimension, name, holdTicks);
  };
}

// Bedrock allows only a handful of ticking areas per dimension, and holding
// each one open for a while means several builds can overlap. Keep the held
// set small by retiring the oldest as soon as a new one needs the room -
// the oldest is also the one whose deferred work has had the longest to run.
const heldAreas = [];
const MAX_HELD_AREAS = 4;

/** Drops a temporary ticking area, keeping it alive for `holdTicks` first. */
function releaseLoadedArea(dimension, name, holdTicks) {
  let released = false;
  const remove = () => {
    if (released) return;
    released = true;
    const at = heldAreas.findIndex((held) => held.name === name);
    if (at >= 0) heldAreas.splice(at, 1);
    try { dimension.runCommand(`tickingarea remove ${name}`); } catch (e) {
      console.warn("[village] could not remove ticking area: " + e);
    }
  };
  if (holdTicks > 0) {
    try {
      system.runTimeout(remove, holdTicks);
      heldAreas.push({ name, remove });
      while (heldAreas.length > MAX_HELD_AREAS) heldAreas.shift().remove();
      return;
    } catch (e) {
      /* no scheduler available - fall through and release immediately */
    }
  }
  remove();
}

/**
 * Runs `fn()` immediately; if it throws (in practice, almost always
 * LocationInUnloadedChunkError - see withLoadedArea's comment above), retries
 * it after each delay in `delaysTicks` in turn, giving a /tickingarea that
 * was just registered time to actually finish loading. Silently gives up
 * after the last delay, exactly like the original single silent-failure
 * behaviour - just with several real chances to succeed first instead of
 * one immediate one.
 *
 * Only meant for steps that are safe to attempt more than once - an entity
 * spawn guarded by "did this already happen" bookkeeping (as village.js's
 * tower guards and gate golems are, one spawn per tower/side, called at
 * most once per level-up), not a bare unguarded spawn that would duplicate
 * on retry.
 */
export function withRetry(fn, delaysTicks = [40, 100, 200]) {
  try {
    return fn();
  } catch (e) {
    if (delaysTicks.length === 0) {
      console.warn("[village] gave up after retries: " + e);
      return undefined;
    }
    const [nextDelay, ...rest] = delaysTicks;
    system.runTimeout(() => withRetry(fn, rest), nextDelay);
    return undefined;
  }
}

/** Extends a perimeter block down to solid ground to prevent floating walls. */
export function supportWallFoundation(dimension, origin, facing, forward, side, foundationBlock) {
  const at = toWorld(origin, facing, forward, side, 0);
  const ground = probeGround(dimension, at.x, at.z, origin.y + 8, origin.y - 24);
  const startY = ground ? ground.y + 1 : origin.y - 12;
  for (let y = startY; y <= origin.y - 1; y++) {
    const p = { x: at.x, y, z: at.z };
    let typeId = null;
    try { typeId = dimension.getBlock(p)?.typeId; } catch (e) { continue; }
    if (isVoidOrFoliage(typeId) || isNaturalTerrain(typeId)) {
      setBlock(dimension, p.x, p.y, p.z, foundationBlock || "minecraft:dirt");
    }
  }
}
