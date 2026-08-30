import {
  buildFarmerHouse,
  buildBlacksmithHouse,
  buildCartographerHouse,
  buildMinerHouse,
  buildPlainHouse,
  extendPath,
  paveCrossroadsArms,
  placeRoadLamps,
  ROAD_HALF_WIDTH
} from "./builder.js";
import { TIER_PALISADE, TIER_COBBLE, TIER_CASTLE } from "./walls.js";
import { buildCityBuilding } from "./city_buildings_11_15.js";
import { specialFootprintsUpTo } from "./specials.js";
import { farmerYardFootprint } from "./upgrades.js";
import { boundsFor, FINAL_RADIUS, PERIMETER_SCHEDULE, ROAD_AXES, SPATIAL_PLAN, scheduleForLevel } from "./spatial_plan.js";

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
    npc: null,
    // The last perimeter stage in PERIMETER_SCHEDULE: the castle wall is not
    // replaced by a fourth tier here, it is pushed out from R78 to R94 so the
    // L12-L18 plots (granary yard, inn, barracks, archive, and the three
    // isolated L16-18 buildings, all of them out at +/-66) end up inside the
    // wall instead of outside it. Crossroads layout only - a legacy village
    // never reaches this level.
    defenceStage: 15,
    guards: true
  }
};

export const LAYOUT_V2 = 2;

/** Half-width of a crossroads road arm: three blocks wide, so side -1..1. */
export const CROSSROADS_ROAD_HALF_WIDTH = Math.floor(ROAD_AXES.forward.width / 2);

/** Outermost radius the crossroads wall ever reaches (PERIMETER_SCHEDULE's last stage). */
const FINAL_VILLAGE_RADIUS = FINAL_RADIUS;

/** Radius of the first wall stage, used as a stand-in before any wall exists. */
const PERIMETER_SCHEDULE_FIRST_RADIUS = PERIMETER_SCHEDULE[0].radius;

/**
 * level -> canonical buildingId, straight off SPATIAL_PLAN. Deriving it keeps
 * spatial_plan.js the only place a level's plot identity is written down.
 */
const PLANNED_BUILDING_BY_LEVEL = Object.freeze(SPATIAL_PLAN.reduce((map, entry) => {
  // Level 1 has three entries; the numbered levels have exactly one each and
  // those are the only ones this map is asked about.
  if (entry.level > 1 && !map[entry.level]) map[entry.level] = entry.buildingId;
  return map;
}, {}));

/**
 * Plot anchors for the crossroads layout, one per numbered level.
 *
 * The legacy layout strings every house along a single forward street, which
 * is why the ground either side of it is empty: two of the four quadrants
 * inside the wall are never used at all. These anchors put the same houses on
 * the plots `spatial_plan.js` already reserves for them, spread over all four
 * quadrants of the crossroads.
 *
 * Each value is the pair houseShell() takes: `plotForward` is the near edge
 * along the street axis (the house runs plotForward..plotForward+6, +/-1 more
 * for the roof overhang) and `side` is the plot centre across it (the house
 * runs side-3..side+3, again +/-1 for the overhang). Both roads are three
 * blocks wide - the forward road owns side -1..1 and the side road owns
 * forward -1..1 - so every anchor here keeps its building's outermost block,
 * eaves included, at least two away from both centrelines.
 *
 * Do not hand-check these against the diagram in the plan: the test asserts
 * each built footprint really does sit inside its own `SPATIAL_PLAN` envelope
 * and really does clear both road bands, which is the only version of that
 * check that cannot rot.
 */
const V2_PLOTS = Object.freeze({
  2: Object.freeze({ plotForward: 14, side: -10 }),   // farmer_homestead
  3: Object.freeze({ plotForward: 14, side: 10 }),    // blacksmith_forge
  4: Object.freeze({ plotForward: -13, side: -10 }),  // cartographer_house
  5: Object.freeze({ plotForward: -14, side: 27 }),   // palisade ward house
  6: Object.freeze({ plotForward: -26, side: 12 }),   // miner_house
  7: Object.freeze({ plotForward: -26, side: -10 }),  // resident_house
  8: Object.freeze({ plotForward: 25, side: -10 }),   // cobble ward house
  9: Object.freeze({ plotForward: 26, side: 10 }),    // artisan_house
  // 36, not 37: at 37 the house's roof overhang would reach forward 44,
  // which is exactly where the R44 palisade still stands when this level
  // builds. The level raises R78 and clears R44 a moment later, but the house
  // goes up first, so the two would occupy the same blocks. Keeping the plot
  // one back makes the collision impossible rather than order-dependent.
  10: Object.freeze({ plotForward: 36, side: -10 })   // castle ward house
});

/** The three level-1 buildings, on the same crossroads plots. */
export const V2_FOUNDING = Object.freeze({
  townHall: Object.freeze({ plotForward: 3, side: 7 }),
  starterHouse: Object.freeze({ plotForward: 3, side: -6 }),
  campfire: Object.freeze({ plotForward: -6, side: 5 })
});

/** Anchor a level's house is built from, for the village's layout version. */
export function plotPlacementFor(level, layoutVersion) {
  const cfg = LEVELS[level];
  if (!cfg || cfg.cityBuildingId) return null;
  if (layoutVersion === LAYOUT_V2 && V2_PLOTS[level]) return { ...V2_PLOTS[level] };
  if (!Number.isInteger(cfg.plotForward)) return null;
  return { plotForward: cfg.plotForward, side: cfg.side };
}

/** The defence stage this level raises, or null if it raises none. */
export function defenceStageForLevel(level) {
  const cfg = LEVELS[level];
  if (!cfg) return null;
  if (Number.isInteger(cfg.defenceStage)) return cfg.defenceStage;
  return cfg.fortify ? level : null;
}

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

export function runLevelBuild(dimension, origin, facing, level, paletteId, layoutVersion) {
  const cfg = LEVELS[level];
  if (!cfg) return null;
  if (cfg.cityBuildingId) return buildCityBuilding(cfg.cityBuildingId, dimension, origin, facing);
  const placement = plotPlacementFor(level, layoutVersion);
  if (!placement) return null;
  // Protect every plot built up to and including this level (this level's
  // own footprint is included so the lattice can't collide with the house
  // about to go up right after it) from the lamp-post lattice.
  const protectedRects = builtPlotFootprints(level, layoutVersion);
  if (layoutVersion === LAYOUT_V2) {
    // The defence stage paves both arms all the way to the gates, but the
    // first wall is level 5 - so up to then the level-up lays the street
    // itself, out as far as it has actually built.
    layCrossroadsTo(dimension, origin, facing, level, protectedRects);
  } else {
    extendPath(dimension, origin, facing, cfg.pathFrom, cfg.pathTo, protectedRects);
  }
  return cfg.build(dimension, origin, facing, placement.plotForward, placement.side, paletteId);
}

/**
 * How far out along each crossroads arm the village has actually built. The
 * lamp lattice follows this rather than the wall radius, so a level-1 village
 * is not ringed by ninety blocks of lit but empty road.
 */
function crossroadsLitReach(level) {
  let reach = 12;
  for (let l = 2; l <= level; l++) {
    const placement = V2_PLOTS[l];
    if (!placement) continue;
    reach = Math.max(reach, Math.abs(placement.plotForward) + 8, Math.abs(placement.side) + 5);
  }
  return reach;
}

function layCrossroadsTo(dimension, origin, facing, level, protectedRects) {
  const reach = crossroadsLitReach(level);
  paveCrossroadsArms(dimension, origin, facing, reach, CROSSROADS_ROAD_HALF_WIDTH);
  // The crossroads roads are three blocks wide (side -1..1), so the posts
  // stand at +/-2 - one block closer than the legacy five-wide street's.
  const options = { halfWidth: CROSSROADS_ROAD_HALF_WIDTH + 1 };
  for (const axis of ["forward", "side"]) {
    placeRoadLamps(dimension, origin, facing, axis, 0, reach, protectedRects, options);
    placeRoadLamps(dimension, origin, facing, axis, 0, -reach, protectedRects, options);
  }
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
function plotFootprint(level, layoutVersion) {
  const cfg = LEVELS[level];
  if (!cfg || cfg.cityBuildingId) return null;
  if (layoutVersion === LAYOUT_V2) {
    // On the crossroads the reserved envelope in spatial_plan.js is already
    // the authority on what ground a level owns, and it is deliberately more
    // generous than the house itself. Reusing it means the protection
    // rectangle can never drift away from the plot it is meant to protect -
    // there is only one number for both.
    const buildingId = PLANNED_BUILDING_BY_LEVEL[level];
    const planned = buildingId ? boundsFor(buildingId) : null;
    if (planned) {
      const rect = { ...planned.bounds };
      if (cfg.npc?.professionName === "Фермер") {
        const placement = plotPlacementFor(level, layoutVersion);
        const yard = farmerYardFootprint(placement.plotForward, placement.side);
        rect.fMin = Math.min(rect.fMin, yard.fMin);
        rect.fMax = Math.max(rect.fMax, yard.fMax);
        rect.sMin = Math.min(rect.sMin, yard.sMin);
        rect.sMax = Math.max(rect.sMax, yard.sMax);
      }
      return rect;
    }
  }
  if (!Number.isInteger(cfg.plotForward)) return null;
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
 * The three canonical level-1 envelopes on the crossroads. Unlike the legacy
 * DOWNTOWN_FOOTPRINT - one padded box covering hall, campfire and starter
 * house together, which only worked because all three sat in a huddle beside
 * one street - these are three separate plots in two different quadrants, so
 * a single bounding box round them would swallow the crossroads itself.
 */
const V2_DOWNTOWN_FOOTPRINTS = Object.freeze(
  ["town_hall", "campfire", "starter_house"]
    .map((buildingId) => boundsFor(buildingId)?.bounds)
    .filter(Boolean)
    .map((bounds) => Object.freeze(bounds))
);

/** Both crossroads arms, as protection rectangles for the lamp lattice. */
function crossroadsCorridors() {
  const half = CROSSROADS_ROAD_HALF_WIDTH;
  const reach = FINAL_VILLAGE_RADIUS;
  return [
    { fMin: -reach, fMax: reach, sMin: -half, sMax: half },
    { fMin: -half, fMax: half, sMin: -reach, sMax: reach }
  ];
}

/**
 * The wall radius a village of this level actually has. On the crossroads it
 * comes from PERIMETER_SCHEDULE (R44 -> R62 -> R78 -> R94); on the legacy
 * layout it is the single R48 square walls.js has always built. Anything that
 * needs to know where the wall is - the gate notice board, the area a build
 * has to keep loaded - must ask this rather than assume one of the two.
 */
export function villageRadiusFor(level, layoutVersion) {
  if (layoutVersion === LAYOUT_V2) {
    const stage = scheduleForLevel(level);
    return stage ? stage.radius : PERIMETER_SCHEDULE_FIRST_RADIUS;
  }
  return Math.max(30, fullVillageMaxForward() + 10);
}

/**
 * The ground one level's build owns, and therefore the ground its level-up
 * should flatten before building on it. Same rectangle builtPlotFootprints()
 * protects, so the ground that gets levelled and the ground that is defended
 * from later sweeps can never be two different rectangles.
 */
export function plotSiteBoundsFor(level, layoutVersion) {
  return plotFootprint(level, layoutVersion);
}

/**
 * Every plot footprint built up to and including `uptoLevel`, plus the
 * town hall/first house/campfire area and the street itself. Used to keep
 * the fortification interior-terrain sweep from ever touching ground a
 * house (or the road) already occupies (see terrain.js's
 * interiorFlattenJob).
 */
export function builtPlotFootprints(uptoLevel, layoutVersion) {
  const rects = layoutVersion === LAYOUT_V2
    ? [...V2_DOWNTOWN_FOOTPRINTS, ...crossroadsCorridors()]
    : [DOWNTOWN_FOOTPRINT, roadCorridor()];
  for (let level = 2; level <= uptoLevel; level++) {
    const rect = plotFootprint(level, layoutVersion);
    if (rect) rects.push(rect);
  }
  // Special buildings now stand inside the wall alongside the houses, so
  // the interior sweep can reach them - and their log corner posts read as
  // tree trunks to it, so an unprotected shed would lose its whole frame to
  // the next wall tier. Each plot joins the list only once its building can
  // exist (see SPECIAL_BUILDINGS' unlockLevel), so earlier tiers still
  // flatten that ground with the rest of the village.
  rects.push(...specialFootprintsUpTo(uptoLevel, layoutVersion));
  return rects;
}
