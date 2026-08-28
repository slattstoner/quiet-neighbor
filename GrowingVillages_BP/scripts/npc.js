import { world, system } from "@minecraft/server";
import { coloredName, COLORS, VILLAGER_TYPE, ADULT_SPAWN_OPTIONS } from "./util.js";

const HOME_X = "home_x";
const HOME_Y = "home_y";
const HOME_Z = "home_z";
const HOME_R = "home_r";
const OVER_RANGE_STRIKES = "village:overCount";
// Consecutive out-of-range tether checks (40 ticks apart) tolerated before
// a non-elder villager is pulled back. See startTetherLoop for why.
const STRIKES_BEFORE_RECALL = 3;

// Vanilla villager profession events give the NPC the matching vanilla outfit
// and workstation behaviour. Event names are guarded because Bedrock builds
// can differ; natural workstation claiming remains the fallback.
const PROFESSION_EVENTS = {
  "Фермер": "minecraft:become_farmer",
  "Кузнец": "minecraft:become_toolsmith",
  "Картограф": "minecraft:become_cartographer",
  "Шахтёр": "minecraft:become_mason"
};

const CRAFTSMAN_ROLE_IDS = Object.freeze({
  "Фермер": "farmer",
  "Кузнец": "blacksmith",
  "Картограф": "cartographer",
  "Шахтёр": "miner"
});

function applyVanillaProfession(entity, professionName) {
  const eventName = PROFESSION_EVENTS[professionName];
  if (!eventName || typeof entity.triggerEvent !== "function") return;
  try { entity.triggerEvent(eventName); } catch (e) { /* workstation fallback */ }
}

/**
 * Villagers get their profession the same way vanilla ones do: by
 * claiming a nearby, unclaimed job-site block. Every craftsman house
 * places the right block (composter, blast_furnace, cartography_table,
 * smithing_table...) right next to where the NPC spawns and is tethered,
 * so claiming happens within the villager's own AI a few seconds after
 * spawning - no need to guess a "spawn_<profession>" event name, which
 * turned out not to exist for every profession on this version (the
 * weaponsmith one doesn't) and would only be one more thing to keep in
 * sync with future renames.
 */

/**
 * Binds an entity to a home point. A background loop keeps it within
 * `radius` blocks, which is how the elder stays inside the town hall and
 * craftsmen stay in their shops instead of wandering into the sea.
 */
export function setHome(entity, location, radius) {
  entity.setDynamicProperty(HOME_X, location.x);
  entity.setDynamicProperty(HOME_Y, location.y);
  entity.setDynamicProperty(HOME_Z, location.z);
  entity.setDynamicProperty(HOME_R, radius);
  entity.addTag("village_tethered");
}

export function getHome(entity) {
  const x = entity.getDynamicProperty(HOME_X);
  if (x === undefined) return null;
  return {
    location: {
      x,
      y: entity.getDynamicProperty(HOME_Y),
      z: entity.getDynamicProperty(HOME_Z)
    },
    radius: entity.getDynamicProperty(HOME_R) || 4
  };
}

function distanceSq(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Spawns a villager with a coloured name tag and a home tether. Its
 * profession is picked up naturally once it claims the job-site block
 * already sitting in its house (see the note above).
 */
export function spawnCraftsman(dimension, location, professionName, villageId, radius) {
  const npc = dimension.spawnEntity(VILLAGER_TYPE, location, ADULT_SPAWN_OPTIONS);
  npc.nameTag = coloredName(professionName, COLORS.crafter);
  npc.addTag("village:" + villageId);
  npc.addTag("village_crafter");
  npc.addTag("village_npc");
  const roleId = CRAFTSMAN_ROLE_IDS[professionName];
  if (roleId) npc.setDynamicProperty("village:roleId", roleId);
  applyVanillaProfession(npc, professionName);
  // Eight blocks comfortably covers the bed and workstation in every 7×7
  // house with room to step out the door without an immediate snap-back.
  // Workers with an outdoor work area receive a larger radius from
  // village.js.
  setHome(npc, location, radius === undefined ? 8 : radius);
  return npc;
}

export function spawnResident(dimension, location, villageId, radius) {
  const npc = dimension.spawnEntity(VILLAGER_TYPE, location, ADULT_SPAWN_OPTIONS);
  npc.nameTag = coloredName("Житель", COLORS.villager);
  npc.addTag("village:" + villageId);
  npc.addTag("village_npc");
  setHome(npc, location, radius === undefined ? 8 : radius);
  return npc;
}

/**
 * A watchman stationed inside a tower's guard post. Tethered tightly so
 * he stays on his post rather than climbing down and wandering off.
 */
export function spawnTowerGuard(dimension, location, villageId, radius) {
  const guard = dimension.spawnEntity(VILLAGER_TYPE, location, ADULT_SPAWN_OPTIONS);
  guard.nameTag = coloredName("Дозорный", COLORS.guard);
  guard.addTag("village:" + villageId);
  guard.addTag("village_guard");
  guard.addTag("village_npc");
  setHome(guard, location, radius === undefined ? 3 : radius);
  return guard;
}

/**
 * Iron golems posted at the gate. They keep vanilla combat behaviour (so
 * they actually defend the village) but are tethered to a patrol radius so
 * they don't chase a zombie to the horizon and never come back.
 */
export function spawnGateGolem(dimension, location, villageId, radius) {
  const golem = dimension.spawnEntity("minecraft:iron_golem", location);
  golem.nameTag = coloredName("Страж деревни", COLORS.guard);
  golem.addTag("village:" + villageId);
  golem.addTag("village_golem");
  golem.addTag("village_npc");
  setHome(golem, location, radius === undefined ? 10 : radius);
  return golem;
}

/**
 * Background tether loop. Runs a few times a second rather than every
 * tick, and only acts when an entity has actually strayed, so it stays
 * cheap even with several villages loaded.
 *
 * The radius stays constant day and night. An earlier version tightened
 * it at night to send villagers "home", but home was the entity's
 * spawn/job-site point, not its bed - since a bed already sits a few
 * blocks away in the same house, that squeeze yanked the villager back
 * before vanilla's own sleep AI could walk it to the bed, which is what
 * showed up as it rattling the door and teleporting in place. The normal
 * radius already comfortably covers both the job site and the bed within
 * one house, so vanilla can just get on with it.
 *
 * The elder additionally gets a standing Resistance V + Fire Resistance
 * refresh here: he's meant to be the one fixed, unkillable council NPC
 * the whole village is anchored to, never a villager that can wander out
 * the door and get cut down by a raid or a stray creeper. Resistance
 * amplifier 4 blocks all non-instant damage sources (nothing left in
 * vanilla short of the void or /kill can hurt him), refreshed well before
 * a ~1-second-per-loop miss could ever let the effect lapse.
 */
export function startTetherLoop() {
  system.runInterval(() => {
    for (const dimension of [world.getDimension("overworld")]) {
      let tethered;
      try {
        tethered = dimension.getEntities({ tags: ["village_tethered"] });
      } catch (e) {
        continue;
      }
      for (const entity of tethered) {
        try {
          if (!entity.isValid) continue;
          const home = getHome(entity);
          if (!home) continue;

          const isElder = entity.hasTag("village_elder");
          if (isElder) {
            try {
              entity.addEffect("resistance", 220, { amplifier: 4, showParticles: false });
              entity.addEffect("fire_resistance", 220, { amplifier: 0, showParticles: false });
            } catch (e) {
              /* addEffect unavailable on this build - tether alone still holds him */
            }
          }

          // Villagers are occasionally a few blocks farther away while the
          // vanilla AI is opening a door or selecting a bed. The buffer stops
          // a visible back-and-forth teleport while still returning genuine
          // wanderers to their own building.
          const tolerance = isElder ? 0
            : entity.hasTag("village_crafter") ? 4 : entity.hasTag("village_npc") ? 2 : 0;
          const allowed = home.radius + tolerance;
          const d2 = distanceSq(entity.location, home.location);
          const outOfRange = d2 > allowed * allowed;

          if (isElder) {
            // The elder must never actually leave the hall - no grace
            // period, snap back the instant he crosses the boundary.
            if (outOfRange) entity.teleport(home.location, { dimension: entity.dimension });
            continue;
          }

          if (!outOfRange) {
            if (entity.getDynamicProperty(OVER_RANGE_STRIKES)) entity.setDynamicProperty(OVER_RANGE_STRIKES, 0);
            continue;
          }

          // Everyone else gets a grace period before being pulled back.
          // Vanilla wander/socialize goals routinely step a villager just
          // past its tether radius and then bring it back on their own a
          // few seconds later; recalling it on the very first check it's
          // over the line fought that natural return every single pass of
          // this loop - the teleport interrupts the AI mid-goal without
          // ever satisfying it, so the villager just re-picks the same kind
          // of destination on the next tick and immediately heads back out
          // the door, which is what read as an endless "leave, get yanked
          // back, leave again" loop. Requiring STRIKES_BEFORE_RECALL
          // consecutive over-range checks (roughly that many x2 seconds)
          // before intervening gives the natural return a real chance to
          // happen first, and only recalls a villager that's genuinely
          // wandered off rather than one mid-stroll.
          const strikes = (entity.getDynamicProperty(OVER_RANGE_STRIKES) || 0) + 1;
          if (strikes < STRIKES_BEFORE_RECALL) {
            entity.setDynamicProperty(OVER_RANGE_STRIKES, strikes);
            continue;
          }
          entity.setDynamicProperty(OVER_RANGE_STRIKES, 0);
          entity.teleport(home.location, { dimension: entity.dimension });
        } catch (e) {
          /* entity despawned mid-loop */
        }
      }
    }
  }, 40);
}

/**
 * Repairs a damaged iron golem in exchange for an iron ingot. Returns a
 * result describing what happened so the caller can give feedback.
 */
export function repairGolem(player, golem) {
  const health = golem.getComponent("minecraft:health");
  if (!health) return { ok: false, reason: "no_health" };

  const current = health.currentValue;
  const max = health.effectiveMax;
  if (current >= max) return { ok: false, reason: "already_full", current, max };

  const inventory = player.getComponent("minecraft:inventory");
  const container = inventory?.container;
  if (!container) return { ok: false, reason: "no_inventory" };

  // Find and consume one iron ingot
  let consumed = false;
  for (let i = 0; i < container.size; i++) {
    const stack = container.getItem(i);
    if (!stack || stack.typeId !== "minecraft:iron_ingot") continue;
    if (stack.amount <= 1) {
      container.setItem(i, undefined);
    } else {
      stack.amount -= 1;
      container.setItem(i, stack);
    }
    consumed = true;
    break;
  }
  if (!consumed) return { ok: false, reason: "no_ingot" };

  const healed = Math.min(25, max - current);
  health.setCurrentValue(current + healed);
  return { ok: true, healed, current: current + healed, max };
}
