import { world, system } from "@minecraft/server";
import { toWorld } from "./util.js";
import { FARM_PENS, penYardBounds } from "./upgrades.js";
import { findVillageElder } from "./npc.js";
import { resolveCraftsmanRole } from "./craftsman_quests.js";
import { isUsableFacing, isUsableOrigin, readFacing, readOrigin, readProperty } from "./village_state.js";

/**
 * Keeps the farmer's pens populated.
 *
 * The pens are built once, at the moment their quest tier is finished, and the
 * animals put in them then were never replaced. So the farmer's chain promises
 * a coop, a cow barn and a pig pen - in so many words, in its own quest text -
 * and delivers them, and then one wolf, one zombie or one bad fall leaves a pen
 * standing empty for the rest of that world's life. A finished farm slowly
 * becomes a set of empty fences, which is worse than never having built them.
 *
 * This is the smallest thing that fixes it: every so often, look at each
 * finished pen, and if it holds fewer animals than it was built with, add one.
 *
 * ── What this deliberately is not ─────────────────────────────────────────
 *
 * It is not a source of income. The mod's standing rule is that the village
 * never out-earns the player's own farming and mining, and livestock here is
 * scenery: nothing in production.js looks at an animal, and these caps exist
 * so that stays true no matter how long a world runs.
 *
 * It never removes anything. A pen holding more than its cap - because the
 * player put animals there, or because vanilla breeding happened - is left
 * exactly alone. Topping up is the only action available to this loop.
 *
 * One head per pass, and a pass is a minute apart, so a wiped-out pen refills
 * over a few minutes rather than popping back instantly.
 */

const CHECK_INTERVAL_TICKS = 20 * 60;   // once a minute of real time
const NEAR_PLAYER = 96;                  // only bother with pens someone could see
export const RESTOCK_PER_PASS = 1;

/** The world box a pen's yard occupies, from the local rect the builders used. */
export function penWorldBounds(origin, facing, plotForward, side, index) {
  const local = penYardBounds(plotForward, side, index);
  const corners = [
    toWorld(origin, facing, local.fMin, local.sMin, 0),
    toWorld(origin, facing, local.fMin, local.sMax, 0),
    toWorld(origin, facing, local.fMax, local.sMin, 0),
    toWorld(origin, facing, local.fMax, local.sMax, 0)
  ];
  const xs = corners.map((corner) => corner.x);
  const zs = corners.map((corner) => corner.z);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
    y: origin.y,
    centre: {
      x: (Math.min(...xs) + Math.max(...xs)) / 2 + 0.5,
      y: origin.y,
      z: (Math.min(...zs) + Math.max(...zs)) / 2 + 0.5
    }
  };
}

function inside(box, location) {
  return location.x >= box.minX && location.x <= box.maxX + 1 &&
         location.z >= box.minZ && location.z <= box.maxZ + 1 &&
         Math.abs(location.y - box.y) <= 4;
}

/**
 * How many head of `species` are standing in this pen.
 *
 * Counts anything of the right species inside the fence, not only animals this
 * loop put there: a pen the player stocked himself is a stocked pen, and
 * topping it up again would be the loop fighting the player.
 */
export function countInPen(dimension, box, species) {
  let entities;
  try {
    // The query is a sphere, so the precise box test below is what actually
    // decides - the radius only keeps the query cheap.
    const radius = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) + 6;
    entities = dimension.getEntities({ location: box.centre, maxDistance: radius, type: species });
  } catch (error) {
    return null;   // unloaded, or no entity query here; treat as "cannot tell"
  }
  return entities.filter((entity) => {
    try {
      return entity.isValid !== false && inside(box, entity.location);
    } catch (error) {
      return false;
    }
  }).length;
}

/**
 * Brings one farmer's pens back up to strength, at most one head per call.
 *
 * Returns what it did, so the loop and the tests see the same answer.
 */
export function restockFarm(dimension, farmer, elder, options) {
  const tier = Number(readProperty(farmer, "village:upgradeTier") || 0);
  if (tier < FARM_PENS[0].tier) return { ok: false, reason: "no_pens_yet", tier };

  const plotForward = readProperty(farmer, "village:plotForward");
  const side = readProperty(farmer, "village:plotSide");
  if (!Number.isFinite(plotForward) || !Number.isFinite(side)) return { ok: false, reason: "missing_plot" };

  const origin = readOrigin(elder);
  const facing = readFacing(elder);
  if (!isUsableOrigin(origin) || !isUsableFacing(facing)) return { ok: false, reason: "bad_village" };

  const budget = options?.perPass ?? RESTOCK_PER_PASS;
  const added = [];
  const inspected = [];

  for (const pen of FARM_PENS) {
    if (added.length >= budget) break;
    if (tier < pen.tier) continue;   // that pen has not been built yet

    const box = penWorldBounds(origin, facing, plotForward, side, pen.index);
    const present = countInPen(dimension, box, pen.species);
    if (present === null) continue;  // could not tell; try again next pass
    inspected.push({ pen: pen.label, species: pen.species, present, cap: pen.cap });
    if (present >= pen.cap) continue;

    try {
      dimension.spawnEntity(pen.species, box.centre);
      added.push({ pen: pen.label, species: pen.species, from: present, cap: pen.cap });
    } catch (error) {
      // Unloaded chunk, most likely. Nothing to recover: the next pass will
      // find the same gap and try again.
    }
  }

  return { ok: true, tier, added, inspected };
}

/**
 * Background loop. Only looks at farms a player is standing near, for the same
 * reason patrol.js does: a pen nobody can see does not need restocking, and
 * the animals would only be despawned again by the engine.
 */
export function startLivestockLoop() {
  system.runInterval(() => {
    let players;
    try {
      players = world.getPlayers();
    } catch (error) {
      return;
    }
    if (!players || players.length === 0) return;

    const seen = new Set();
    for (const player of players) {
      let farmers;
      try {
        farmers = player.dimension.getEntities({
          location: player.location,
          maxDistance: NEAR_PLAYER,
          tags: ["village_crafter"]
        });
      } catch (error) {
        continue;
      }
      for (const farmer of farmers) {
        try {
          if (farmer.isValid === false) continue;
          if (resolveCraftsmanRole(farmer) !== "farmer") continue;
          // Two players standing near one farm must not double its restock rate.
          const id = farmer.id ?? `${farmer.location.x},${farmer.location.z}`;
          if (seen.has(id)) continue;
          seen.add(id);

          const elder = findVillageElder(farmer);
          if (!elder) continue;
          restockFarm(player.dimension, farmer, elder);
        } catch (error) {
          console.warn("[village] livestock restock failed: " + error);
        }
      }
    }
  }, CHECK_INTERVAL_TICKS);
}
