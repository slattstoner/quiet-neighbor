import { world, system, ItemStack } from "@minecraft/server";
import { probeGround } from "./terrain.js";

/**
 * PRODUCTION BALANCE
 *
 * The point of these NPCs is flavour and a slow trickle, never a
 * replacement for the player going out and doing the work themselves.
 * So production is deliberately hobbled in three separate ways:
 *
 *  1. Low rate      - one action per production tick (every ~1 in-game hour)
 *  2. Hard day cap  - each worker stops once it hits its daily quota
 *  3. Storage cap   - a worker stops entirely once its chest is holding
 *                     a stockpile, so an unattended village doesn't
 *                     accumulate infinite loot while the player is away
 *
 * Numbers are intentionally stingy: a miner produces a handful of ingots
 * per full day, which is far less than even a short mining trip yields.
 */
const PRODUCTION_INTERVAL_TICKS = 20 * 60; // once a minute of real time
const DAY_LENGTH_TICKS = 24000;

const MINER_TABLE = [
  { typeId: "minecraft:iron_ingot", weight: 55, max: 2 },
  { typeId: "minecraft:gold_ingot", weight: 22, max: 1 },
  { typeId: "minecraft:redstone", weight: 20, max: 3 },
  { typeId: "minecraft:lapis_lazuli", weight: 3, max: 2 }
];

/**
 * Roles are identified by a stable id, never by the villager's display name.
 *
 * These caps used to be keyed by the Russian name tag ("Фермер"), and the
 * production loop picked a worker's job by string-comparing `nameTag` against
 * it. That made the entire production system depend on the exact spelling of
 * a piece of user-facing text: renaming a villager - to another language, or
 * just to another Russian word - silently stopped the farmer and the miner
 * working, with no error anywhere.
 *
 * npc.js already writes `village:roleId` at spawn for exactly this purpose.
 */
export const ROLE_FARMER = "farmer";
export const ROLE_MINER = "miner";

const DAILY_CAP = {
  [ROLE_FARMER]: 12,   // wheat
  [ROLE_MINER]: 6      // total smelted items
};

const STORAGE_CAP = {
  [ROLE_FARMER]: 64,
  [ROLE_MINER]: 32
};

/**
 * Display names of the two working roles, as they were written before
 * `village:roleId` existed. Kept only to recognise workers in worlds saved
 * before that property was introduced - never to decide anything new.
 */
const LEGACY_NAME_TO_ROLE = Object.freeze({
  "Фермер": ROLE_FARMER,
  "Шахтёр": ROLE_MINER
});

function plainName(entity) {
  return (entity.nameTag || "").replace(/§./g, "");
}

/** A worker's stable role id, falling back to its name tag for old saves. */
export function roleOf(worker) {
  let stored;
  try {
    stored = worker?.getDynamicProperty?.("village:roleId");
  } catch (error) {
    stored = undefined;
  }
  if (typeof stored === "string" && DAILY_CAP[stored] !== undefined) return stored;
  return LEGACY_NAME_TO_ROLE[plainName(worker)] || null;
}

/** Resets a worker's daily counter when a new in-game day starts. */
function checkDayRollover(entity) {
  const today = Math.floor(world.getAbsoluteTime() / DAY_LENGTH_TICKS);
  const stored = entity.getDynamicProperty("prod_day");
  if (stored !== today) {
    entity.setDynamicProperty("prod_day", today);
    entity.setDynamicProperty("prod_count", 0);
  }
}

function producedToday(entity) {
  return entity.getDynamicProperty("prod_count") || 0;
}

function addProduced(entity, n) {
  entity.setDynamicProperty("prod_count", producedToday(entity) + n);
}

// Visual tiers may retain future convenience such as a wider storage search radius,
// but they must never raise automatic output, daily caps, storage caps, chance,
// weights or miner entry maxima. Minecraft exploration and player gathering remain
// the main source.
function upgradeTier(worker) {
  return Math.min(2, worker.getDynamicProperty("village:upgradeTier") || 0);
}

// Absolute economy contract: these values do not scale with quest upgrades.
function workerDailyCap(_worker, role) {
  return DAILY_CAP[role] || 0;
}

function workerStorageCap(_worker, role) {
  return STORAGE_CAP[role] || 0;
}

/** Finds the nearest storage block (chest/barrel) around a worker. */
function findStorage(entity, radius) {
  const dimension = entity.dimension;
  const base = entity.location;
  const r = radius || 6;
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dy = -2; dy <= 2; dy++) {
        try {
          const block = dimension.getBlock({
            x: Math.floor(base.x) + dx,
            y: Math.floor(base.y) + dy,
            z: Math.floor(base.z) + dz
          });
          if (!block) continue;
          if (block.typeId !== "minecraft:chest" && block.typeId !== "minecraft:barrel") continue;
          const inv = block.getComponent("minecraft:inventory");
          if (inv?.container) return inv.container;
        } catch (e) {
          /* unloaded */
        }
      }
    }
  }
  return null;
}

function countInContainer(container, typeId) {
  let total = 0;
  for (let i = 0; i < container.size; i++) {
    const stack = container.getItem(i);
    if (stack && (!typeId || stack.typeId === typeId)) total += stack.amount;
  }
  return total;
}

function hasSpace(container) {
  for (let i = 0; i < container.size; i++) {
    if (!container.getItem(i)) return true;
  }
  return false;
}

/**
 * Farmer: walks his own field, harvests any fully grown wheat, replants
 * it, and puts the crop in his barrel. Only one plant per cycle, so the
 * field visibly cycles rather than emptying at once.
 */
function runFarmer(farmer) {
  const dimension = farmer.dimension;
  const base = farmer.location;
  const tier = upgradeTier(farmer);
  // The visual barn may be farther from the house; a wider search only changes
  // where capped wheat is stored, never how much wheat can be produced.
  const container = findStorage(farmer, 8 + tier * 5);
  if (!container) return;
  if (countInContainer(container, "minecraft:wheat") >= workerStorageCap(farmer, ROLE_FARMER)) return;
  if (producedToday(farmer) >= workerDailyCap(farmer, ROLE_FARMER)) return;
  if (!hasSpace(container)) return;

  const R = 12;
  let actionsRemaining = 1;
  for (let dx = -R; dx <= R; dx++) {
    for (let dz = -R; dz <= R; dz++) {
      for (let dy = -2; dy <= 2; dy++) {
        let block;
        try {
          block = dimension.getBlock({
            x: Math.floor(base.x) + dx,
            y: Math.floor(base.y) + dy,
            z: Math.floor(base.z) + dz
          });
        } catch (e) {
          continue;
        }
        if (!block || block.typeId !== "minecraft:wheat") continue;
        let growth = 0;
        try {
          growth = block.permutation.getState("growth");
        } catch (e) {
          continue;
        }
        if (growth !== 7) continue;

        // Harvest: reset the crop and bank the yield
        try {
          block.setPermutation(block.permutation.withState("growth", 0));
        } catch (e) {
          continue;
        }
        // addItem returns whatever would not fit rather than throwing, and the
        // barrel can fill up between the hasSpace() check above and here (the
        // seed roll below needs a slot of its own when nothing is stackable).
        // Only count what actually landed, and put the crop back if none of it
        // did, so the day's quota is never spent on wheat that vanished.
        const leftover = container.addItem(new ItemStack("minecraft:wheat", 1));
        if (leftover) {
          try { block.setPermutation(block.permutation.withState("growth", 7)); } catch (e) { /* leave it reset */ }
          return;
        }
        if (Math.random() < 0.25) {
          container.addItem(new ItemStack("minecraft:wheat_seeds", 1));
        }
        addProduced(farmer, 1);
        // One harvest per production tick, so the field visibly cycles instead
        // of emptying at once. This counter was declared `const` and then
        // decremented, which throws "Assignment to constant variable" in strict
        // mode (every ES module is strict) - swallowed by the loop's catch, so
        // it never surfaced, but it made the line below unreachable.
        actionsRemaining--;
        if (actionsRemaining <= 0 || producedToday(farmer) >= workerDailyCap(farmer, ROLE_FARMER)) return;
      }
    }
  }
}

function pickWeighted(table) {
  const total = table.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * total;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return table[0];
}

/**
 * Miner: represents working the seam under the village. Yields a small
 * amount of already-smelted material into his chest, hard-capped per day.
 */
function runMiner(miner) {
  const tier = upgradeTier(miner);
  // This mirrors the farmer's convenience-only radius: it cannot raise output.
  const container = findStorage(miner, 8 + tier * 3);
  if (!container) return;
  if (producedToday(miner) >= workerDailyCap(miner, ROLE_MINER)) return;
  if (countInContainer(container) >= workerStorageCap(miner, ROLE_MINER)) return;
  if (!hasSpace(container)) return;

  // Only actually produce on some cycles, so output feels like slow work
  if (Math.random() > 0.5) return;

  const entry = pickWeighted(MINER_TABLE);
  const amount = Math.min(
    workerDailyCap(miner, ROLE_MINER) - producedToday(miner),
    1 + Math.floor(Math.random() * entry.max)
  );
  if (amount <= 0) return;
  // Same rule as the farmer's: only the part that actually landed counts
  // against the day's quota. addItem hands back the overflow rather than
  // throwing, so ignoring it spent the quota on ingots nobody ever received.
  const leftover = container.addItem(new ItemStack(entry.typeId, amount));
  const stored = amount - (leftover?.amount || 0);
  if (stored > 0) addProduced(miner, stored);
}

/** Background loop driving all worker production. */
export function startProductionLoop() {
  system.runInterval(() => {
    let workers;
    try {
      workers = world.getDimension("overworld").getEntities({ tags: ["village_worker"] });
    } catch (e) {
      return;
    }
    for (const worker of workers) {
      try {
        if (!worker.isValid) continue;
        checkDayRollover(worker);
        const role = roleOf(worker);
        if (role === ROLE_FARMER) runFarmer(worker);
        else if (role === ROLE_MINER) runMiner(worker);
      } catch (e) {
        // Keep the other workers running, but say something: this catch used
        // to be silent, and it hid a "Assignment to constant variable" thrown
        // on every single farmer harvest for as long as that bug existed.
        // Every other background loop in the mod logs here for the same reason.
        console.warn("[village] worker production failed: " + e);
      }
    }
  }, PRODUCTION_INTERVAL_TICKS);
}

export { DAILY_CAP, STORAGE_CAP, MINER_TABLE, workerDailyCap, workerStorageCap };
