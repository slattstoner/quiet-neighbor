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

const DAILY_CAP = {
  "Фермер": 12,   // wheat
  "Шахтёр": 6     // total smelted items
};

const STORAGE_CAP = {
  "Фермер": 64,
  "Шахтёр": 32
};

function plainName(entity) {
  return (entity.nameTag || "").replace(/§./g, "");
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
  if (countInContainer(container, "minecraft:wheat") >= workerStorageCap(farmer, "Фермер")) return;
  if (producedToday(farmer) >= workerDailyCap(farmer, "Фермер")) return;
  if (!hasSpace(container)) return;

  const R = 12;
  const actionsRemaining = 1;
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
        container.addItem(new ItemStack("minecraft:wheat", 1));
        if (Math.random() < 0.25) {
          container.addItem(new ItemStack("minecraft:wheat_seeds", 1));
        }
        addProduced(farmer, 1);
        actionsRemaining--;
        if (actionsRemaining <= 0 || producedToday(farmer) >= workerDailyCap(farmer, "Фермер")) return;
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
  if (producedToday(miner) >= workerDailyCap(miner, "Шахтёр")) return;
  if (countInContainer(container) >= workerStorageCap(miner, "Шахтёр")) return;
  if (!hasSpace(container)) return;

  // Only actually produce on some cycles, so output feels like slow work
  if (Math.random() > 0.5) return;

  const entry = pickWeighted(MINER_TABLE);
  const amount = Math.min(
    workerDailyCap(miner, "Шахтёр") - producedToday(miner),
    1 + Math.floor(Math.random() * entry.max)
  );
  if (amount <= 0) return;
  container.addItem(new ItemStack(entry.typeId, amount));
  addProduced(miner, amount);
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
        const role = plainName(worker);
        if (role === "Фермер") runFarmer(worker);
        else if (role === "Шахтёр") runMiner(worker);
      } catch (e) {
        /* keep other workers running */
      }
    }
  }, PRODUCTION_INTERVAL_TICKS);
}

export { DAILY_CAP, STORAGE_CAP, MINER_TABLE, workerDailyCap, workerStorageCap };
