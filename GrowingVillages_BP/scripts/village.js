import { buildTownHall, buildCampfire, buildPlainHouse, interiorCenter } from "./builder.js";
import { toWorld, setBlock, randomId, coloredName, COLORS, VILLAGER_TYPE, ADULT_SPAWN_OPTIONS } from "./util.js";
import { ItemStack } from "@minecraft/server";
import { LEVELS, MAX_BETA_LEVEL, runLevelBuild, fullVillageMaxForward, isCityLevel, maxLevelForLayoutVersion, builtPlotFootprints } from "./levels.js";
import { buildFortifications, perimeterFor } from "./walls.js";
import { generateVillageName, updateGateSign } from "./signboard.js";
import { prepareSite, sampleGroundLevel, withLoadedArea, withRetry } from "./terrain.js";
import { paletteAt, paletteById } from "./palettes.js";
import { spawnCraftsman, spawnResident, spawnGateGolem, spawnTowerGuard, setHome } from "./npc.js";
import { ensureVillageChapterState, setVillageChapterForLevel } from "./chapter_state.js";
import { buildCityConnector } from "./city_connectors.js";
import {
  DEFAULT_PALETTE_ID,
  PROP_CHEST_X, PROP_CHEST_Y, PROP_CHEST_Z,
  PROP_FACING, PROP_ID, PROP_LAYOUT_VERSION, PROP_LEVEL,
  PROP_ORIGIN_X, PROP_ORIGIN_Y, PROP_ORIGIN_Z,
  PROP_PALETTE, PROP_TIER
} from "./village_state.js";

const CITY_BUILD_PREFIX = "village:v2:build:";

export const LAYOUT_VERSION_V2 = 2;
export const LEGACY_LAYOUT_MAX_ERROR = "legacy_layout_max";

function buildStateKey(buildingId) {
  return CITY_BUILD_PREFIX + buildingId;
}

function setInitialLayoutVersion(elder) {
  const current = elder.getDynamicProperty(PROP_LAYOUT_VERSION);
  if (current !== undefined) {
    console.warn("[village] refusing to overwrite existing layoutVersion: " + current);
    return false;
  }
  elder.setDynamicProperty(PROP_LAYOUT_VERSION, LAYOUT_VERSION_V2);
  return true;
}

function layoutPolicy(elder) {
  let value;
  try {
    value = elder.getDynamicProperty(PROP_LAYOUT_VERSION);
  } catch (error) {
    console.warn("[village] could not read layoutVersion: " + error);
    return { kind: "invalid", value: undefined };
  }
  if (value === LAYOUT_VERSION_V2) return { kind: "v2", value };
  if (value === undefined) return { kind: "legacy", value };
  console.warn("[village] invalid layoutVersion; treating as legacy: " + value);
  return { kind: "invalid", value };
}

export function getLayoutVersion(elder) {
  const policy = layoutPolicy(elder);
  return policy.kind === "v2" ? LAYOUT_VERSION_V2 : 1;
}

export function getCityBuildState(elder, buildingId) {
  const value = elder.getDynamicProperty(buildStateKey(buildingId));
  return value === 1 || value === 2 ? value : 0;
}

function setCityBuildState(elder, buildingId, state) {
  elder.setDynamicProperty(buildStateKey(buildingId), state);
}

function isCityLayoutAllowed(elder, nextLevel) {
  if (!isCityLevel(nextLevel)) return { ok: true };
  const policy = layoutPolicy(elder);
  if (policy.kind === "v2") return { ok: true };
  return {
    ok: false,
    error: policy.kind === "invalid" ? "invalid_layout_version" : LEGACY_LAYOUT_MAX_ERROR,
    layout: policy.kind,
    value: policy.value
  };
}

/** Level at which the gate and its iron golem guards appear. */
export const GATE_LEVEL = 4;

/**
 * Founds a level-1 village. The site is levelled first so the buildings
 * sit on flat ground instead of floating over dips or sinking into
 * hillsides, which is how vanilla village plots behave.
 */
export function foundVillage(player, rawOrigin, facing, requestedPaletteId) {
  const dimension = player.dimension;
  const id = randomId();
  const palette = requestedPaletteId ? paletteById(requestedPaletteId) : paletteAt(dimension, rawOrigin);

  // Probe the terrain across the whole level-1 footprint and settle the
  // village onto the median ground height. Side range covers the town
  // hall (side 9, sMin..sMax = 5..13) and the starter house (side -9,
  // sMin..sMax = -12..-6), each with a block of margin.
  const sample = sampleGroundLevel(dimension, rawOrigin, facing, -10, 14, -13, 14);
  const origin = { x: rawOrigin.x, y: sample.y + 1, z: rawOrigin.z };

  prepareSite(dimension, origin, facing, -10, 14, -13, 14, {
    padding: 1,
    clearHeight: 14,
    fillDepth: 6,
    surfaceBlock: `minecraft:${palette.surface}`,
    surfaceType: sample.surfaceType
  });

  // Founding still happens right where the player used the bell, so this
  // small a footprint is normally already loaded - but guaranteeing it
  // costs nothing and keeps founding consistent with every later build.
  withLoadedArea(dimension, origin, facing, { fMin: -11, fMax: 15, sMin: -14, sMax: 15 }, () => {
    buildTownHall(dimension, origin, facing);
    buildCampfire(dimension, origin, facing, -6, -6);
    buildPlainHouse(dimension, origin, facing, 0, -9, palette.id);
  });

  // Progress chest inside the town hall (walls sit at side 5 and 13)
  const chestPos = toWorld(origin, facing, 2, 7, 0);
  setBlock(dimension, chestPos.x, chestPos.y, chestPos.z, "minecraft:chest");

  // Elder, kept firmly inside the hall. Always spawned already-adult (see
  // ADULT_SPAWN_OPTIONS) - a baby elder can't open the menu, since interaction
  // works differently for babies, and nothing here ever checked for or
  // fixed that, so it silently spawned however Bedrock's own randomizer
  // decided.
  const elderPos = toWorld(origin, facing, 4, 9, 0);
  const elder = dimension.spawnEntity(VILLAGER_TYPE, { x: elderPos.x + 0.5, y: elderPos.y, z: elderPos.z + 0.5 }, ADULT_SPAWN_OPTIONS);
  elder.nameTag = coloredName("Староста", COLORS.elder);
  elder.addTag("village_elder");
  elder.addTag("village_npc");
  elder.addTag("village:" + id);
  // The town hall has its own bed and belongs only to the elder. The radius
  // includes that bed and the council table, but not any neighbouring house.
  // The elder is a stationary council NPC, not a roaming villager. Keep the
  // tether inside the hall and use a zero tolerance for this tag.
  setHome(elder, { x: elderPos.x + 0.5, y: elderPos.y, z: elderPos.z + 0.5 }, 2);

  const villageName = generateVillageName();
  elder.setDynamicProperty(PROP_ID, id);
  elder.setDynamicProperty("village:name", villageName);
  elder.setDynamicProperty(PROP_PALETTE, palette.id);
  elder.setDynamicProperty(PROP_LEVEL, 1);
  elder.setDynamicProperty(PROP_ORIGIN_X, origin.x);
  elder.setDynamicProperty(PROP_ORIGIN_Y, origin.y);
  elder.setDynamicProperty(PROP_ORIGIN_Z, origin.z);
  elder.setDynamicProperty(PROP_FACING, facing);
  elder.setDynamicProperty(PROP_CHEST_X, chestPos.x);
  elder.setDynamicProperty(PROP_CHEST_Y, chestPos.y);
  elder.setDynamicProperty(PROP_CHEST_Z, chestPos.z);
  // Version is written once at the same successful foundation point as core
  // elder state. Existing elders have no key and therefore remain legacy v1.
  setInitialLayoutVersion(elder);

  // Chapter state is additive. A state failure must never invalidate foundation.
  try {
    ensureVillageChapterState(elder);
  } catch (e) {
    console.warn("[village] initial chapter state failed: " + e);
  }

  // Starter resident in the first house
  const residentPos = toWorld(origin, facing, 3, -8, 0);
  spawnResident(dimension, { x: residentPos.x + 0.5, y: residentPos.y, z: residentPos.z + 0.5 }, id, 5);

  // Notice board by the road, showing the village's name from day one
  try {
    refreshSign(elder);
  } catch (e) {
    console.warn("[village] initial sign failed: " + e);
  }

  return elder;
}

/**
 * Creates a village at a requested level for testing and comparison.
 * It deliberately feeds the normal progression pipeline rather than
 * duplicating level-build side effects, so NPCs, terrain, fortifications,
 * golems and the gate sign stay identical to ordinary progression.
 */
export function foundVillageAtLevel(player, rawOrigin, facing, targetLevel = 1, requestedPaletteId) {
  const requested = Number(targetLevel);
  const targetMax = maxLevelForLayoutVersion(LAYOUT_VERSION_V2);
  if (!Number.isInteger(requested) || requested < 1 || requested > targetMax) {
    throw new Error(`target level must be an integer from 1 to ${targetMax}`);
  }

  const elder = foundVillage(player, rawOrigin, facing, requestedPaletteId);
  if (requested === 1) return elder;

  const state = getVillageState(elder);
  const container = getChestContainer(elder, state);
  if (!container) throw new Error("level test bell could not access the town hall chest");

  for (let level = 2; level <= requested; level++) {
    for (const [id, amount] of Object.entries(LEVELS[level].requirements)) {
      let remaining = amount;
      while (remaining > 0) {
        const stackAmount = Math.min(64, remaining);
        container.addItem(new ItemStack(id, stackAmount));
        remaining -= stackAmount;
      }
    }
    const result = tryLevelUp(elder);
    if (!result?.done || result.leveledUpTo !== level) {
      throw new Error(`level test bell failed while building level ${level}`);
    }
  }
  return elder;
}

/** Re-posts the gate notice board with the village's current standing. */
export function refreshSign(elder) {
  const state = getVillageState(elder);
  const rect = perimeterFor(fullVillageMaxForward());
  return updateGateSign(elder.dimension, state.origin, state.facing, rect.fMax, {
    name: elder.getDynamicProperty("village:name") || "Деревня",
    level: state.level,
    tier: elder.getDynamicProperty(PROP_TIER) || 0,
    maxLevel: maxLevelForLayoutVersion(state.layoutVersion)
  });
}

export function getVillageState(elder) {
  return {
    id: elder.getDynamicProperty(PROP_ID),
    level: elder.getDynamicProperty(PROP_LEVEL) || 1,
    origin: {
      x: elder.getDynamicProperty(PROP_ORIGIN_X),
      y: elder.getDynamicProperty(PROP_ORIGIN_Y),
      z: elder.getDynamicProperty(PROP_ORIGIN_Z)
    },
    facing: elder.getDynamicProperty(PROP_FACING),
    palette: elder.getDynamicProperty(PROP_PALETTE) || DEFAULT_PALETTE_ID,
    layoutVersion: getLayoutVersion(elder),
    chest: {
      x: elder.getDynamicProperty(PROP_CHEST_X),
      y: elder.getDynamicProperty(PROP_CHEST_Y),
      z: elder.getDynamicProperty(PROP_CHEST_Z)
    }
  };
}

/** Applies any quest discounts the village has earned to the raw level requirements. */
function getEffectiveRequirements(elder, level) {
  const cfg = LEVELS[level];
  if (!cfg) return null;
  const result = {};
  for (const [id, count] of Object.entries(cfg.requirements)) {
    const key = `village:discount:${level}:${id}`;
    const discount = elder.getDynamicProperty(key) || 0;
    result[id] = Math.max(1, count - discount);
  }
  return result;
}

function getChestContainer(elder, state) {
  try {
    const dimension = elder.dimension;
    const block = dimension.getBlock(state.chest);
    const inv = block?.getComponent("minecraft:inventory");
    return inv ? inv.container : null;
  } catch (e) {
    return null;
  }
}

export function chestSatisfiesRequirements(elder) {
  const state = getVillageState(elder);
  const nextLevel = state.level + 1;
  const cfg = LEVELS[nextLevel];
  if (!cfg) return { done: true, finished: true };

  const layout = isCityLayoutAllowed(elder, nextLevel);
  if (!layout.ok) return { done: false, error: layout.error, layout: layout.layout, layoutValue: layout.value };

  const container = getChestContainer(elder, state);
  if (!container) return { done: false, error: "no_chest" };

  const have = {};
  for (let i = 0; i < container.size; i++) {
    const stack = container.getItem(i);
    if (!stack) continue;
    have[stack.typeId] = (have[stack.typeId] || 0) + stack.amount;
  }

  const effective = getEffectiveRequirements(elder, state.level + 1);
  for (const [id, count] of Object.entries(effective)) {
    if ((have[id] || 0) < count) return { done: false, have, effective };
  }
  return { done: true, have, container, effective };
}

/** Requirement removal is the final commit step after a city build/connector succeeds. */
function consumeRequirements(container, effective) {
  for (const [id, count] of Object.entries(effective)) {
    let remaining = count;
    for (let i = 0; i < container.size && remaining > 0; i++) {
      const stack = container.getItem(i);
      if (!stack || stack.typeId !== id) continue;
      const take = Math.min(remaining, stack.amount);
      remaining -= take;
      if (take >= stack.amount) container.setItem(i, undefined);
      else {
        stack.amount -= take;
        container.setItem(i, stack);
      }
    }
    if (remaining !== 0) throw new Error(`requirement commit drifted for ${id}`);
  }
}

/**
 * Builds the gate: a stone archway across the street with a pair of iron
 * golems posted either side. The golems keep their vanilla combat AI, so
 * they genuinely fight hostile mobs, but are tethered to a patrol radius
 * around the gate.
 */
export function buildGate(dimension, origin, facing, villageId, forwardAt) {
  for (const s of [-3, 3]) {
    for (let up = 0; up <= 3; up++) {
      const p = toWorld(origin, facing, forwardAt, s, up);
      setBlock(dimension, p.x, p.y, p.z, "minecraft:cobblestone");
    }
    const lampPos = toWorld(origin, facing, forwardAt, s, 4);
    setBlock(dimension, lampPos.x, lampPos.y, lampPos.z, "minecraft:lantern", { hanging: false });
  }
  // Arch across the top, leaving a walkable gap beneath
  for (let s = -3; s <= 3; s++) {
    const p = toWorld(origin, facing, forwardAt, s, 4);
    if (s === -3 || s === 3) continue;
    setBlock(dimension, p.x, p.y, p.z, "minecraft:cobblestone");
  }
  // Keep the passage itself clear
  for (let s = -2; s <= 2; s++) {
    for (let up = 0; up <= 3; up++) {
      const p = toWorld(origin, facing, forwardAt, s, up);
      setBlock(dimension, p.x, p.y, p.z, "minecraft:air");
    }
  }

  const golems = [];
  for (const s of [-4, 4]) {
    const g = toWorld(origin, facing, forwardAt, s, 0);
    try {
      golems.push(spawnGateGolem(dimension, { x: g.x + 0.5, y: g.y, z: g.z + 0.5 }, villageId, 10));
    } catch (e) {
      console.warn("[village] could not spawn gate golem: " + e);
    }
  }
  return golems;
}

function tryCityLevelUp(elder, state, nextLevel, cfg, check, options) {
  const buildingId = cfg.cityBuildingId;
  const buildState = getCityBuildState(elder, buildingId);
  if (buildState === 2) {
    // A completed flag combined with an unadvanced level is corrupted state;
    // never guess or construct a duplicate building.
    return { done: false, error: "city_build_state_mismatch", buildingId };
  }
  if (buildState === 1) {
    // A prior synchronous build interruption is recoverable. Clear the queue
    // without charging resources; the player may explicitly retry afterwards.
    try {
      setCityBuildState(elder, buildingId, 0);
      return { done: false, error: "city_build_recovered", buildingId, recovered: true };
    } catch (error) {
      return { done: false, error: "city_build_recovery_failed", buildingId };
    }
  }

  try {
    setCityBuildState(elder, buildingId, 1);
  } catch (error) {
    return { done: false, error: "city_build_queue_failed", buildingId };
  }

  let shape;
  let connector;
  try {
    const build = options?.runLevelBuild || runLevelBuild;
    const connect = options?.buildCityConnector || buildCityConnector;
    shape = build(elder.dimension, state.origin, state.facing, nextLevel, state.palette);
    if (!shape || shape.buildingId !== buildingId) throw new Error("city builder returned wrong metadata");
    connector = connect(elder.dimension, state.origin, state.facing, shape);
  } catch (error) {
    console.warn("[village] city build pipeline failed: " + error);
    try { setCityBuildState(elder, buildingId, 0); } catch (resetError) {
      console.warn("[village] city build recovery reset failed: " + resetError);
    }
    return { done: false, error: "city_build_failed", buildingId, recoverable: true };
  }

  // The checks and removal happen in the same single-threaded level action;
  // resource commit is deliberately after builder and narrow connector success.
  try {
    consumeRequirements(check.container, check.effective);
  } catch (error) {
    console.warn("[village] city requirement commit failed: " + error);
    return { done: false, error: "city_commit_failed", buildingId };
  }

  elder.setDynamicProperty(PROP_LEVEL, nextLevel);
  try { setCityBuildState(elder, buildingId, 2); } catch (error) {
    // The level is already committed; never retry a completed physical build.
    console.warn("[village] city completion marker write failed: " + error);
  }

  let chapterId = null;
  try {
    const chapterState = setVillageChapterForLevel(elder, nextLevel);
    chapterId = chapterState.ok ? chapterState.chapterId : null;
  } catch (error) {
    console.warn("[village] chapter state update failed: " + error);
  }
  try { refreshSign(elder); } catch (error) {
    console.warn("[village] sign refresh failed: " + error);
  }
  return { done: true, leveledUpTo: nextLevel, label: cfg.label, shape, connector, chapterId, cityBuildingId: buildingId };
}

export function tryLevelUp(elder, options) {
  const check = chestSatisfiesRequirements(elder);
  if (!check.done || check.finished) return check;

  const state = getVillageState(elder);
  const nextLevel = state.level + 1;
  const cfg = LEVELS[nextLevel];
  const container = check.container;

  if (isCityLevel(nextLevel)) return tryCityLevelUp(elder, state, nextLevel, cfg, check, options);

  // Preserve the established L1–10 transaction ordering and geometry.
  consumeRequirements(container, check.effective);

  const dimension = elder.dimension;

  // Every block/entity call from here down can land anywhere from the
  // street to the far wall corners (up to fullVillageMaxForward()+~10, or
  // cfg.pathTo if that reaches further out) - well past what's reliably
  // chunk-loaded around whoever triggered the level-up. Wrap the whole
  // build in one loaded area rather than guessing which sub-step needs it.
  const loadRadius = Math.max(perimeterFor(fullVillageMaxForward()).fMax, cfg.pathTo || 0) + 10;
  const loadRect = { fMin: -loadRadius, fMax: loadRadius, sMin: -loadRadius, sMax: loadRadius };

  let shape = null;
  let chapterId = null;
  let fort = null;

  withLoadedArea(dimension, state.origin, state.facing, loadRect, () => {
    // Level the ground before building. This is done in two tightly scoped
    // passes rather than one broad sweep: a broad sweep would re-level ground
    // that earlier levels already built on and demolish those houses.
    //
    // Pass 1 - the road strip only. The street itself is side -2..2; the
    // lamp posts at side ±3 are placed directly by extendPath() regardless
    // of what terrain-prep does here, so this pass does not need to reach
    // them. This stays well clear of the town hall's near wall (sMin=5)
    // and the starter house's near wall (sMax=-6), so it cannot wipe a
    // band out of either wall on an L2/L3 level-up the way a wider pass
    // used to when the road sat closer to those buildings.
    prepareSite(dimension, state.origin, state.facing,
      cfg.pathFrom, cfg.pathTo, -2, 2, {
        padding: 0,
        clearHeight: 8,
        fillDepth: 5,
        surfaceBlock: "minecraft:grass_block"
      });

    // Pass 2 - this plot only, on this plot's side of the street.
    const plotSideNear = cfg.side >= 0 ? 2 : -2;
    const plotSideFar = cfg.side >= 0 ? 14 : -14;
    prepareSite(dimension, state.origin, state.facing,
      cfg.plotForward - 2, cfg.plotForward + 9,
      Math.min(plotSideNear, plotSideFar), Math.max(plotSideNear, plotSideFar), {
        padding: 0,
        clearHeight: 12,
        fillDepth: 6,
        surfaceBlock: "minecraft:grass_block"
      });

    shape = runLevelBuild(dimension, state.origin, state.facing, nextLevel, state.palette);
    elder.setDynamicProperty(PROP_LEVEL, nextLevel);
    // State is committed only after the regular level value is written. It is
    // deliberately fail-safe: level construction remains authoritative.
    try {
      const chapterState = setVillageChapterForLevel(elder, nextLevel);
      chapterId = chapterState.ok ? chapterState.chapterId : null;
    } catch (e) {
      console.warn("[village] chapter state update failed: " + e);
    }

    if (cfg.npc && shape) {
      const c = interiorCenter(shape);
      const npcPos = toWorld(state.origin, state.facing, c.f, c.s, 0);
      // Each NPC is bound to its own building. The farmer's radius also
      // includes the field and the miner's includes the pit-head; other
      // craftsmen remain within their house/workshop and can sleep there.
      const homeRadius = cfg.npc.professionName === "Фермер" ? 12 : 8;
      // The whole spawn-and-tag sequence is one retried unit (not just the
      // spawn call): a plot at forward 40+ can be far enough from wherever
      // the level-up was triggered that its chunk isn't loaded yet even
      // moments after withLoadedArea registered the ticking area for it,
      // so this can legitimately need a second try a few seconds later.
      withRetry(() => {
        const npc = spawnCraftsman(dimension,
          { x: npcPos.x + 0.5, y: npcPos.y, z: npcPos.z + 0.5 },
          cfg.npc.professionName, state.id, homeRadius);
        // The plot reference makes a quest upgrade deterministic even when
        // several villages and professions are loaded in the same world.
        npc.setDynamicProperty("village:plotForward", cfg.plotForward);
        npc.setDynamicProperty("village:plotSide", cfg.side);
        // Workers (farmer, miner) run the production loop; pure traders don't
        if (cfg.npc.worker) npc.addTag("village_worker");
        return npc;
      });
    } else if (shape) {
      const c = interiorCenter(shape);
      const rp = toWorld(state.origin, state.facing, c.f, c.s, 0);
      withRetry(() => spawnResident(dimension, { x: rp.x + 0.5, y: rp.y, z: rp.z + 0.5 }, state.id, 5));
    }

    // Fortification upgrade: replaces whatever wall tier was there before,
    // raises the new one and staffs the towers.
    if (cfg.fortify) {
      try {
        fort = buildFortifications(dimension, state.origin, state.facing,
          fullVillageMaxForward(), cfg.fortify, builtPlotFootprints(nextLevel));
        elder.setDynamicProperty(PROP_TIER, cfg.fortify);

        // Station a guard in each tower's guard post. The wall ring can sit
        // 40-60 blocks from wherever the level-up was triggered - the
        // /tickingarea just registered in withLoadedArea doesn't finish
        // loading those chunks instantly (it streams in over the following
        // ticks), so the very first attempt right after registering it can
        // still legitimately hit LocationInUnloadedChunkError. withRetry
        // gives it several more tries, spaced out over the next ~10 seconds,
        // by which point the area has had time to actually load.
        for (const tower of fort.towers) {
          withRetry(() => spawnTowerGuard(dimension, tower.standAt, state.id, 3));
        }
        // Iron golems patrol the main gateway - spawned once, the first time
        // the village gets guards, at the two spots buildGateway explicitly
        // clears and levels (the passage edges just inside the piers). Later
        // tier upgrades leave existing golems in place rather than adding
        // more on top of them.
        if (cfg.guards && !elder.getDynamicProperty("village:golemsSpawned")) {
          const golemF = fort.rect.fMax - 1;
          for (const ds of [-2, 2]) {
            const g = toWorld(state.origin, state.facing, golemF, ds, 0);
            withRetry(() => spawnGateGolem(dimension, { x: g.x + 0.5, y: g.y, z: g.z + 0.5 }, state.id, 12));
          }
          elder.setDynamicProperty("village:golemsSpawned", true);
        }
      } catch (e) {
        console.warn("[village] fortification failed: " + e);
      }
    }
  });

  try {
    refreshSign(elder);
  } catch (e) {
    console.warn("[village] sign refresh failed: " + e);
  }

  return {
    done: true,
    leveledUpTo: nextLevel,
    label: cfg.label,
    shape,
    chapterId,
    fortified: cfg.fortify || null,
    towers: fort ? fort.towers.length : 0
  };
}

export function effectiveRequirementsText(elder) {
  const state = getVillageState(elder);
  const maxLevel = maxLevelForLayoutVersion(state.layoutVersion);
  const nextLevel = state.level + 1;
  const cfg = LEVELS[nextLevel];
  if (!cfg || nextLevel > maxLevel) return `Деревня достигла максимума этой бета-версии (уровень ${state.level} из ${maxLevel}). Следующие уровни появятся в будущих обновлениях мода.`;
  const effective = getEffectiveRequirements(elder, nextLevel);
  const lines = Object.entries(effective).map(([id, count]) => `- ${id.replace("minecraft:", "")}: ${count}`);
  return `Уровень деревни: ${state.level}\nСледующая постройка: "${cfg.label}"\nПринесите в сундук ратуши:\n${lines.join("\n")}`;
}

export function findNearestElder(dimension, location, maxDistance) {
  const entities = dimension.getEntities({
    location,
    maxDistance: maxDistance || 6,
    tags: ["village_elder"]
  });
  return entities.length > 0 ? entities[0] : null;
}
