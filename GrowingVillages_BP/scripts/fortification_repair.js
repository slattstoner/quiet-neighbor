import { world, system } from "@minecraft/server";
import { repairTowers } from "./walls.js";
import { fullVillageMaxForward } from "./levels.js";

/**
 * Keeps every fortified village's corner watchtowers standing.
 *
 * The fortification build only ever runs on a level-up, so a village that
 * lost its towers to an older version (or to any future interruption) would
 * stay broken forever - reinstalling the pack changes nothing for a level
 * already behind the player. This loop closes that gap: whenever a player is
 * inside a fortified village, any corner that is loaded and not standing gets
 * rebuilt, as a job so it can never hang a tick.
 */
const CHECK_INTERVAL_TICKS = 200; // every 10 seconds
const NEAR_VILLAGE = 140;         // the wall corners sit ~68 blocks out

export function startFortificationRepairLoop() {
  system.runInterval(() => {
    let players;
    try {
      players = world.getPlayers();
    } catch (e) {
      return;
    }
    if (!players || players.length === 0) return;

    for (const player of players) {
      let elders;
      try {
        elders = player.dimension.getEntities({
          location: player.location,
          maxDistance: NEAR_VILLAGE,
          tags: ["village_elder"]
        });
      } catch (e) {
        continue;
      }
      for (const elder of elders) {
        const tier = Number(elder.getDynamicProperty("village:tier") || 0);
        if (!tier) continue;
        const origin = {
          x: elder.getDynamicProperty("village:originX"),
          y: elder.getDynamicProperty("village:originY"),
          z: elder.getDynamicProperty("village:originZ")
        };
        if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) continue;
        const facing = Number(elder.getDynamicProperty("village:facing") || 0);
        try {
          const rebuilt = repairTowers(player.dimension, origin, facing, fullVillageMaxForward(), tier);
          if (rebuilt > 0) {
            console.warn(`[village] rebuilding ${rebuilt} missing corner tower(s)`);
          }
        } catch (e) {
          console.warn("[village] tower repair check failed: " + e);
        }
      }
    }
  }, CHECK_INTERVAL_TICKS);
}
