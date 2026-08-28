import {
  buildFarmerHouse,
  buildBlacksmithHouse,
  buildCartographerHouse,
  buildMinerHouse,
  buildPlainHouse,
  extendPath,
  ROAD_HALF_WIDTH
} from "./builder.js";
import { TIER_PALISADE, TIER_COBBLE, TIER_CASTLE } from "./walls.js";
import { buildCityBuilding } from "./city_buildings_11_15.js";
import { specialFootprintsUpTo } from "./specials.js";
import { farmerYardFootprint } from "./upgrades.js";

/**
 * Level 1 (town hall + campfire + first house) is built at founding and
 * isn't listed here. Everything else is data-driven off this table: the
 * elder's requirements screen, the terrain levelling bounds, NPC spawning
 * and the fortification upgrades all read from it, so adding a level is a
 * matter of appending an entry and writing one build function.
 *
 * `fortify` upgrades the village's defences to a new tier at that level:
 * a log palisade first, then a cobblestone curtain wall, and finally a
 * stone-brick castle wall with battlements.
 */
export const LEVELS = {
  2: {
    label: "Дом фермера",
    requirements: { "minecraft:wheat": 16, "minecraft:oak_planks": 24 },
    plotForward: 12,
    side: -10,
    pathFrom: 0,
    pathTo: 12,
    build: buildFarmerHouse,
    npc: { professionName: "Фермер", worker: true }
  },
  3: {
    label: "Кузница",
    requirements: { "minecraft:iron_ingot": 10, "minecraft:cobblestone": 32, "minecraft:coal": 10 },
    plotForward: 12,
    side: 10,
    pathFrom: 0,
    pathTo: 12,
    build: buildBlacksmithHouse,
    npc: { professionName: "Кузнец" }
  },
  4: {
    label: "Дом картографа",
    requirements: { "minecraft:paper": 12, "minecraft:oak_planks": 20 },
    plotForward: -12,
    side: -10,
    // This plot sits behind the town hall (negative forward), not further
    // down the L2/L3 street - the path has to grow the other way to reach
    // it. See extendPath()'s doc comment for why westward paving starts at
    // -10 rather than 0.
    pathFrom: 0,
    pathTo: -12,
    build: buildCartographerHouse,
    npc: { professionName: "Картограф" }
  },
  5: {
    label: "Частокол вокруг деревни",
    requirements: { "minecraft:oak_log": 48, "minecraft:oak_planks": 32 },
    plotForward: -12,
    side: 10,
    pathFrom: 0,
    pathTo: -12,
    build: buildPlainHouse,
    npc: null,
    fortify: TIER_PALISADE,
    guards: true
  },
  6: {
    label: "Дом шахтёра",
    requirements: { "minecraft:cobblestone": 64, "minecraft:iron_ingot": 8, "minecraft:torch": 16 },
    plotForward: -26,
    side: 10,
    pathFrom: -12,
    pathTo: -26,
    build: buildMinerHouse,
    npc: { professionName: "Шахтёр", worker: true }
  },
  7: {
    label: "Ещё один жилой дом",
    requirements: { "minecraft:oak_planks": 32, "minecraft:cobblestone": 24, "minecraft:glass_pane": 6 },
    plotForward: -26,
    side: -10,
    pathFrom: -12,
    pathTo: -26,
    build: buildPlainHouse,
    npc: null
  },
  8: {
    label: "Каменная стена",
    requirements: { "minecraft:cobblestone": 128, "minecraft:stone_bricks": 32, "minecraft:torch": 16 },
    plotForward: 26,
    side: -10,
    // Back on the east side - the street there was only ever paved to 12
    // (by L2/L3), so this has to bridge from there, not from 32.
    pathFrom: 12,
    pathTo: 26,
    build: buildPlainHouse,
    npc: null,
    fortify: TIER_COBBLE,
    guards: true
  },
  9: {
    label: "Дом ремесленников",
    requirements: { "minecraft:oak_planks": 40, "minecraft:iron_ingot": 12, "minecraft:glass_pane": 8 },
    plotForward: 26,
    side: 10,
    pathFrom: 12,
    pathTo: 26,
    build: buildPlainHouse,
    npc: null
  },
  10: {
    label: "Замковая стена",
    requirements: {
      "minecraft:stone_bricks": 160,
      "minecraft:iron_ingot": 16,
      "minecraft:lantern": 8
    },
    plotForward: 38,
    side: -10,
    pathFrom: 26,
    pathTo: 38,
    build: buildPlainHouse,
    npc: null,
    fortify: TIER_CASTLE,
    guards: true
  },
  // L11–15 are real only for layoutVersion=2. Their canonical bounds and
  // interiors stay owned by city_buildings_11_15.js / spatial_plan.js.
  11: {
    label: "Рыночная площадь",
    requirements: { "minecraft:cobblestone": 192, "minecraft:oak_planks": 64, "minecraft:lantern": 12 },
    cityBuildingId: "market_square",
    npc: null
  },
  12: {
    label: "Амбарный двор",
    requirements: { "minecraft:wheat": 96, "minecraft:oak_log": 64, "minecraft:barrel": 8 },
    cityBuildingId: "granary_yard",
    npc: null
  },
  13: {
    label: "Постоялый двор",
    requirements: { "minecraft:oak_planks": 96, "minecraft:glass_pane": 24, "minecraft:iron_ingot": 20 },
    cityBuildingId: "travellers_inn",
    npc: null
  },
  14: {
    label: "Казармы стражи",
    requirements: { "minecraft:stone_bricks": 224, "minecraft:iron_ingot": 24, "minecraft:lantern": 16 },
    cityBuildingId: "guard_barracks",
    npc: null
  },
  15: {
    label: "Деревенский архив",
    requirements: { "minecraft:paper": 48, "minecraft:bookshelf": 16, "minecraft:dark_oak_planks": 64 },
    cityBuildingId: "village_archive",
    npc: null
  }
};

// Existing UI/chapter modules still use this legacy-safe static cap until the
// parallel economy/UI change set merges. Village runtime uses the layout-aware
// helper below, so new layout v2 villages can really progress to L15 now.
export const MAX_BETA_LEVEL = 10;
export const MAX_LAYOUT_V2_LEVEL = 15;

export function maxLevelForLayoutVersion(layoutVersion) {
  return layoutVersion === 2 ? MAX_LAYOUT_V2_LEVEL : MAX_BETA_LEVEL;
}

/** The furthest point down the street the village has built out to. */
export function maxForwardForLevel(level) {
  let max = 12;
  for (let l = 2; l <= level; l++) {
    if (Number.isInteger(LEVELS[l]?.plotForward)) max = Math.max(max, LEVELS[l].plotForward);
  }
  return max;
}

/**
 * The full, final extent of the village at its maximum beta level. The
 * perimeter fence is sized to this from the very first fortification tier
 * (not grown level-by-level), so a later building can never end up outside
 * an already-built wall ring and get bulldozed by that wall's own
 * site-clearing pass - which is exactly what was happening to the miner's
 * house before this fix.
 */
export function fullVillageMaxForward() {
  // Deliberately NOT widened to cover the special buildings. An earlier
  // attempt at the "old-timer's house is out in the wall" report grew the
  // perimeter to reach them instead of moving them, which took the wall
  // ring from radius 48 to 70 - nearly doubling the enclosed area the
  // interior sweep has to flatten, pushing the gates ~20 blocks further
  // from the last paved road, and needing a 2x2 grid of ticking areas
  // where one used to do (Bedrock allows only a handful per world). The
  // specials are placed on their own plots inside this footprint instead;
  // see SPECIAL_BUILDINGS in specials.js.
  return maxForwardForLevel(MAX_BETA_LEVEL);
}

export function requirementsText(level) {
  const cfg = LEVELS[level];
  if (!cfg) return "На этом уровне бета-версия мода заканчивается. Дальнейшие уровни выйдут в следующих обновлениях.";
  const lines = Object.entries(cfg.requirements).map(([id, count]) => {
    const shortName = id.replace("minecraft:", "");
    return `- ${shortName}: ${count}`;
  });
  return `Чтобы построить "${cfg.label}" (уровень ${level}), принесите в сундук ратуши:\n${lines.join("\n")}`;
}

export function runLevelBuild(dimension, origin, facing, level, paletteId) {
  const cfg = LEVELS[level];
  if (!cfg) return null;
  if (cfg.cityBuildingId) return buildCityBuilding(cfg.cityBuildingId, dimension, origin, facing);
  // Protect every plot built up to and including this level (this level's
  // own footprint is included so the lattice can't collide with the house
  // about to go up right after it) from the lamp-post lattice.
  extendPath(dimension, origin, facing, cfg.pathFrom, cfg.pathTo, builtPlotFootprints(level));
  return cfg.build(dimension, origin, facing, cfg.plotForward, cfg.side, paletteId);
}

export function isCityLevel(level) {
  return !!LEVELS[level]?.cityBuildingId;
}

// The town hall, first house and campfire built at foundation time
// (buildTownHall/buildPlainHouse(...,0,-9,...)/buildCampfire) occupy this
// area; see builder.js's houseShell math for forward 0..8, side 5..13
// (town hall) and forward 0..6, side -12..-6 (first house). Padded out to a
// simple box so it stays correct even if those interiors are retouched.
const DOWNTOWN_FOOTPRINT = { fMin: -8, fMax: 10, sMin: -13, sMax: 14 };

/**
 * Plot footprint for a single built level, in the same local f/s
 * coordinates village.js already uses to re-level a plot (tryLevelUp's
 * "Pass 2"). Reusing that exact rectangle means anything this function
 * marks protected is provably the same ground the level's own house
 * building already claimed - never more, never less.
 */
function plotFootprint(level) {
  const cfg = LEVELS[level];
  if (!cfg || cfg.cityBuildingId || !Number.isInteger(cfg.plotForward)) return null;
  const plotSideNear = cfg.side >= 0 ? 2 : -2;
  const plotSideFar = cfg.side >= 0 ? 14 : -14;
  const rect = {
    fMin: cfg.plotForward - 2,
    fMax: cfg.plotForward + 9,
    sMin: Math.min(plotSideNear, plotSideFar),
    sMax: Math.max(plotSideNear, plotSideFar)
  };
  // The farmer's quest-tier outbuildings (upgrades.js) run well past this
  // generic plot rectangle - a chain of animal pens with their own oak-log
  // corners, laid out behind the field and starter crop patch. Without this,
  // the fortification wall's interior sweep (which strips any exposed log,
  // treating it as a wild tree trunk) would eventually tear those corner
  // posts off the moment a later wall tier re-swept the interior.
  if (cfg.npc?.professionName === "Фермер") {
    const yard = farmerYardFootprint(cfg.plotForward, cfg.side);
    rect.fMin = Math.min(rect.fMin, yard.fMin);
    rect.fMax = Math.max(rect.fMax, yard.fMax);
    rect.sMin = Math.min(rect.sMin, yard.sMin);
    rect.sMax = Math.max(rect.sMax, yard.sMax);
  }
  return rect;
}

/**
 * The paved main street's own corridor, sized to the village's full final
 * extent in both directions (like the wall itself - see
 * fullVillageMaxForward()'s doc comment). Without this, the fortification
 * interior sweep (terrain.js's interiorFlattenJob) reclassifies the road's
 * gravel as unbuilt natural terrain the moment it falls outside
 * DOWNTOWN_FOOTPRINT and repaves it as grass on every later fortify tier -
 * which is why the street used to end abruptly a few blocks past the town
 * hall once the village had a wall, instead of reaching every plot it
 * actually connects.
 */
function roadCorridor() {
  const reach = fullVillageMaxForward() + 10;
  return { fMin: -reach, fMax: reach, sMin: -ROAD_HALF_WIDTH, sMax: ROAD_HALF_WIDTH };
}

/**
 * Every plot footprint built up to and including `uptoLevel`, plus the
 * town hall/first house/campfire area and the street itself. Used to keep
 * the fortification interior-terrain sweep from ever touching ground a
 * house (or the road) already occupies (see terrain.js's
 * interiorFlattenJob).
 */
export function builtPlotFootprints(uptoLevel) {
  const rects = [DOWNTOWN_FOOTPRINT, roadCorridor()];
  for (let level = 2; level <= uptoLevel; level++) {
    const rect = plotFootprint(level);
    if (rect) rects.push(rect);
  }
  // Special buildings now stand inside the wall alongside the houses, so
  // the interior sweep can reach them - and their log corner posts read as
  // tree trunks to it, so an unprotected shed would lose its whole frame to
  // the next wall tier. Each plot joins the list only once its building can
  // exist (see SPECIAL_BUILDINGS' unlockLevel), so earlier tiers still
  // flatten that ground with the rest of the village.
  rects.push(...specialFootprintsUpTo(uptoLevel));
  return rects;
}
