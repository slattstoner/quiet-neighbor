import {
  buildFarmerHouse,
  buildBlacksmithHouse,
  buildCartographerHouse,
  buildMinerHouse,
  buildPlainHouse,
  extendPath
} from "./builder.js";
import { TIER_PALISADE, TIER_COBBLE, TIER_CASTLE } from "./walls.js";
import { buildCityBuilding } from "./city_buildings_11_15.js";

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
    pathFrom: 12,
    pathTo: 22,
    build: buildCartographerHouse,
    npc: { professionName: "Картограф" }
  },
  5: {
    label: "Частокол вокруг деревни",
    requirements: { "minecraft:oak_log": 48, "minecraft:oak_planks": 32 },
    plotForward: -12,
    side: 10,
    pathFrom: 12,
    pathTo: 22,
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
    pathFrom: 22,
    pathTo: 32,
    build: buildMinerHouse,
    npc: { professionName: "Шахтёр", worker: true }
  },
  7: {
    label: "Ещё один жилой дом",
    requirements: { "minecraft:oak_planks": 32, "minecraft:cobblestone": 24, "minecraft:glass_pane": 6 },
    plotForward: -26,
    side: -10,
    pathFrom: 22,
    pathTo: 32,
    build: buildPlainHouse,
    npc: null
  },
  8: {
    label: "Каменная стена",
    requirements: { "minecraft:cobblestone": 128, "minecraft:stone_bricks": 32, "minecraft:torch": 16 },
    plotForward: 26,
    side: -10,
    pathFrom: 32,
    pathTo: 42,
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
    pathFrom: 32,
    pathTo: 42,
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
    pathFrom: 42,
    pathTo: 52,
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
// (buildTownHall/buildPlainHouse(...,0,-1,...)/buildCampfire) occupy this
// area; see builder.js's houseShell math for forward 0..8, side 2..10
// (town hall) and forward 0..6, side -9..-3 (first house). Padded out to a
// simple box so it stays correct even if those interiors are retouched.
const DOWNTOWN_FOOTPRINT = { fMin: -8, fMax: 10, sMin: -11, sMax: 12 };

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
  return {
    fMin: cfg.plotForward - 2,
    fMax: cfg.plotForward + 9,
    sMin: Math.min(plotSideNear, plotSideFar),
    sMax: Math.max(plotSideNear, plotSideFar)
  };
}

/**
 * Every plot footprint built up to and including `uptoLevel`, plus the
 * town hall/first house/campfire area. Used to keep the fortification
 * interior-terrain sweep from ever touching ground a house already stands
 * on (see terrain.js's interiorFlattenJob).
 */
export function builtPlotFootprints(uptoLevel) {
  const rects = [DOWNTOWN_FOOTPRINT];
  for (let level = 2; level <= uptoLevel; level++) {
    const rect = plotFootprint(level);
    if (rect) rects.push(rect);
  }
  return rects;
}
