import { world, system, LocationWaypoint, WaypointTexture } from "@minecraft/server";
import { allVillages, villagesNear } from "./village_registry.js";
import { OUTPOST_SLOTS } from "./outposts.js";
import { builtKey } from "./outpost_runtime.js";
import { toWorld } from "./util.js";
import { isUsableFacing, isUsableOrigin, readFacing, readOrigin } from "./village_state.js";

/**
 * Villages and surveyed sites on the locator bar.
 *
 * The compass strip at the top of the screen. Until now the only way to find
 * your way back to a village was to remember the coordinates, and the only way
 * to find a surveyed outpost was to walk the direction the charter pointed and
 * hope. For a mod whose whole shape is "leave the village, come back to it",
 * that was the missing half.
 *
 * This is also the first thing that *reads* the village registry. O2 built the
 * index in 0.11.0 and nothing consulted it - founding wrote a record and no
 * code ever looked. The registry's point is knowing where every village is
 * without loading a single elder, and that is exactly what a compass bar
 * needs, so the two fit together with no new state at all.
 *
 * ── What the engine imposes ───────────────────────────────────────────────
 *
 * `Player.locatorBar` arrived in @minecraft/server 2.8.0 (hence the 1.26.40
 * target in the manifest). Three rules from the documentation shape this file:
 *
 *  - a pack may only see, modify or remove waypoints it added itself. So we
 *    never call removeAllWaypoints: it would be within our rights but it is
 *    the kind of call that becomes wrong the moment a second pack exists.
 *    Everything we add is tracked and only ours is ever removed.
 *  - `maxCount` is a hard ceiling and addWaypoint throws on overflow. The
 *    docs never say what the number is, so nothing here assumes one - the
 *    budget is read from the bar every pass.
 *  - invalid waypoints are dropped by the engine on the next tick, so a
 *    waypoint we still think we own may already be gone. Every call is
 *    guarded and the tracking is reconciled against the bar, not trusted.
 */

const REFRESH_TICKS = 20 * 10;   // ten seconds: responsive on foot, cheap
const RANGE = 512;               // half a kilometre of remembered villages
const HIDE_WITHIN = 48;          // the village you are standing in needs no marker
const OUR_BUDGET = 8;            // our own politeness cap, under maxCount

/** A settlement: the square reads as "a place", not "a thing to collect". */
const VILLAGE_COLOR = Object.freeze({ red: 0.95, green: 0.78, blue: 0.35 });
/** A surveyed site: a star, so it is distinguishable with no label to read. */
const OUTPOST_COLOR = Object.freeze({ red: 0.55, green: 0.80, blue: 0.95 });

function selector(texture) {
  return { textureBoundsList: [{ lowerBound: 0, texture }] };
}

/** Ours, per player, keyed by a stable string so a rebuild is a diff. */
const owned = new Map();   // player id -> Map<key, LocationWaypoint>

function distance(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * What this player should be able to see, nearest first.
 *
 * Villages come from the registry, which needs nothing loaded. Outposts need
 * their elder, because only the elder knows which slots were surveyed and
 * which way the village faces - so an unloaded village simply contributes no
 * outposts rather than guessing at them.
 */
export function desiredWaypoints(player, entries) {
  const at = player.location;
  const dimension = player.dimension;
  const wanted = [];

  for (const village of villagesNear(at, RANGE, entries)) {
    const here = { x: village.x, y: at.y, z: village.z };
    const away = distance(at, here);
    if (away < HIDE_WITHIN) continue;
    wanted.push({
      key: `village:${village.id}`,
      location: { dimension, x: village.x, y: at.y, z: village.z },
      texture: WaypointTexture.Square,
      color: VILLAGE_COLOR,
      away
    });
  }

  let elders = [];
  try {
    elders = dimension.getEntities({ location: at, maxDistance: RANGE, tags: ["village_elder"] });
  } catch (error) {
    elders = [];
  }
  for (const elder of elders) {
    let origin, facing;
    try {
      if (elder.isValid === false) continue;
      origin = readOrigin(elder);
      facing = readFacing(elder);
    } catch (error) {
      continue;
    }
    if (!isUsableOrigin(origin) || !isUsableFacing(facing)) continue;

    for (const slot of OUTPOST_SLOTS) {
      let built;
      try {
        built = elder.getDynamicProperty(builtKey(slot.id));
      } catch (error) {
        continue;
      }
      if (!built) continue;
      const spot = toWorld(origin, facing, slot.f, slot.s, 0);
      const here = { x: spot.x, y: at.y, z: spot.z };
      const away = distance(at, here);
      if (away > RANGE) continue;
      wanted.push({
        key: `outpost:${origin.x},${origin.z}:${slot.id}`,
        location: { dimension, x: spot.x, y: at.y, z: spot.z },
        texture: WaypointTexture.SmallStar,
        color: OUTPOST_COLOR,
        away
      });
    }
  }

  // Nearest first, so when the budget bites it is the far ones that drop.
  wanted.sort((a, b) => a.away - b.away);
  return wanted;
}

/**
 * Brings one player's bar in line with what they should see.
 *
 * Returns what it did, so the loop and the tests read the same answer.
 */
export function refreshBar(player, entries) {
  const bar = player?.locatorBar;
  // An engine older than 2.8.0 has no locator bar. Nothing else depends on
  // this running, so it is not worth an exception in a background loop.
  if (!bar) return { ok: false, reason: "no_locator_bar" };

  const id = player.id ?? player.name ?? "player";
  if (!owned.has(id)) owned.set(id, new Map());
  const mine = owned.get(id);

  // The engine drops invalid waypoints on its own, so anything we think we own
  // that the bar no longer has is stale bookkeeping, not something to remove.
  let present;
  try {
    present = new Set(bar.getAllWaypoints());
  } catch (error) {
    return { ok: false, reason: "bar_unreadable" };
  }
  for (const [key, waypoint] of [...mine]) {
    if (!present.has(waypoint)) mine.delete(key);
  }

  let budget;
  try {
    budget = Math.min(OUR_BUDGET, bar.maxCount ?? OUR_BUDGET);
  } catch (error) {
    budget = OUR_BUDGET;
  }
  // Room others have taken is not ours to reclaim.
  const theirs = Math.max(0, present.size - mine.size);
  const room = Math.max(0, budget - theirs);

  const wanted = desiredWaypoints(player, entries).slice(0, room);
  const wantedKeys = new Set(wanted.map((entry) => entry.key));

  const removed = [];
  for (const [key, waypoint] of [...mine]) {
    if (wantedKeys.has(key)) continue;
    try {
      bar.removeWaypoint(waypoint);
      removed.push(key);
    } catch (error) {
      // Already gone: the engine removed it, or it was never really there.
    }
    mine.delete(key);
  }

  const added = [];
  for (const entry of wanted) {
    if (mine.has(entry.key)) continue;
    const waypoint = new LocationWaypoint(entry.location, selector(entry.texture), entry.color);
    try {
      bar.addWaypoint(waypoint);
    } catch (error) {
      // Full, or the engine rejected it. Stop adding rather than hammering a
      // bar that has no room; the next pass will try again.
      break;
    }
    mine.set(entry.key, waypoint);
    added.push(entry.key);
  }

  return { ok: true, added, removed, shown: mine.size, room };
}

/** Drops bookkeeping for players who are no longer here. */
function forgetAbsent(players) {
  const here = new Set(players.map((player) => player.id ?? player.name ?? "player"));
  for (const id of [...owned.keys()]) if (!here.has(id)) owned.delete(id);
}

export function startWaypointLoop() {
  system.runInterval(() => {
    let players;
    try {
      players = world.getPlayers();
    } catch (error) {
      return;
    }
    if (!players || players.length === 0) return;
    forgetAbsent(players);

    // One registry read for the whole pass. villagesNear would read it itself,
    // but that would be once per player, and the point of the index is that
    // locating every village costs one property read - not one entity load.
    let entries;
    try {
      entries = allVillages();
    } catch (error) {
      entries = [];
    }

    for (const player of players) {
      try {
        refreshBar(player, entries);
      } catch (error) {
        console.warn("[village] locator bar refresh failed: " + error);
      }
    }
  }, REFRESH_TICKS);
}

export const __waypointTest__ = Object.freeze({
  owned,
  RANGE,
  HIDE_WITHIN,
  OUR_BUDGET,
  VILLAGE_COLOR,
  OUTPOST_COLOR
});
