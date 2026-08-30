import { world, system } from "@minecraft/server";
import { TOWER_PATROL_EDGE, wallWalkFor } from "./defences_roads.js";
import { toWorld } from "./util.js";
import { setHome } from "./npc.js";

/**
 * Watchmen walk their wall instead of standing in a tower for eternity.
 *
 * Bedrock's Script API has no pathfinding: Entity exposes teleport,
 * tryTeleport, applyImpulse, applyKnockback, lookAt and setRotation, and
 * nothing that asks a mob to walk somewhere
 * (learn.microsoft.com/minecraft/creator/scriptapi/minecraft/server/entity).
 * Every "patrolling NPC" addon for Bedrock therefore moves its mobs by
 * repeated short teleports, and so does this.
 *
 * That would normally mean writing a pathfinder to decide where the next step
 * can go. Here it does not, and that is the whole reason patrols are on the
 * wall rather than through the streets: a wall-walk is a straight line with
 * nothing on it. The next waypoint is always one block along, and the module
 * that builds the walk reports where its line is (wallWalkFor). The walk now
 * rides the ground rather than holding one height, so the only thing left to
 * work out per step is how high this column's rampart came out - one probe
 * (walkSurfaceY), no search, no obstacle handling, no falling off.
 *
 * Cost is deliberately near zero when nobody is watching: a village whose
 * guards nobody can see does not step at all.
 */

const PROP_EDGE = "village:patrol:edge";
const PROP_RADIUS = "village:patrol:radius";
const PROP_STAND = "village:patrol:standUp";
const PROP_INDEX = "village:patrol:index";
const PROP_DIR = "village:patrol:dir";
const PROP_ORIGIN_X = "village:patrol:ox";
const PROP_ORIGIN_Y = "village:patrol:oy";
const PROP_ORIGIN_Z = "village:patrol:oz";
const PROP_FACING = "village:patrol:facing";

// One block per pass. Eight ticks a block is a shade under three blocks a
// second - an unhurried walking pace, and slow enough that the steps read as
// walking rather than blinking.
const STEP_INTERVAL_TICKS = 8;

// Nobody within this many blocks means nobody can see the patrol, so it does
// not run. The guard simply stands where it stopped.
const WATCH_DISTANCE = 64;

// How far short of a gate opening a patrol turns back. The opening itself is
// five cells wide (|offset| <= 2) and has no walk across it - stopping clear
// of it is what keeps the route on solid blocks without any gap handling.
const GATE_CLEARANCE = 4;

// How far above and below a waypoint's nominal height the real rampart may
// be. The wall is laid on the ground now rather than on one flat platform
// (defences_roads.js#stageProfileJob), so wallWalkFor's standUp is the height
// the walk has on the level and the ground decides the rest; the profile is
// capped at PROFILE_LIMIT either way, and this covers it with room to spare.
const WALK_SEARCH = 18;

/**
 * The waypoints for one tower's route, in local village coordinates.
 *
 * A route runs from just inside the tower's own corner along one wall to the
 * gate in the middle of that wall, and back. Each of the four towers takes a
 * different wall, so every side of the village has a sentinel on it.
 */
export function patrolRoute(edge, radius, standUp) {
  const line = radius - 1;
  const from = line - GATE_CLEARANCE;
  const to = GATE_CLEARANCE;
  const points = [];
  const alongForwardEdge = edge === "fMax" || edge === "fMin";
  const fixed = edge === "fMax" || edge === "sMax" ? line : -line;
  // The corner a tower stands in decides which half of the wall it walks, so
  // the route stays on its own side of the gate.
  const sign = edge === "fMax" || edge === "sMin" ? -1 : 1;
  for (let step = from; step >= to; step--) {
    const along = step * sign;
    points.push(alongForwardEdge ? { f: fixed, s: along, up: standUp } : { f: along, s: fixed, up: standUp });
  }
  return points;
}

/**
 * Marks a freshly spawned tower guard as a patrolling sentinel.
 *
 * Everything the patrol needs is written onto the guard itself - the village
 * origin included - so a step never has to look the elder up. Finding the
 * elder is an entity query, and doing one per guard several times a second is
 * the kind of cost that only shows up on somebody's phone.
 */
export function assignPatrol(guard, towerId, stageOrLevel, origin, facing) {
  const edge = TOWER_PATROL_EDGE[towerId];
  if (!edge) return false;
  const walk = wallWalkFor(stageOrLevel);
  try {
    guard.setDynamicProperty(PROP_EDGE, edge);
    guard.setDynamicProperty(PROP_RADIUS, walk.radius);
    guard.setDynamicProperty(PROP_STAND, walk.standUp);
    guard.setDynamicProperty(PROP_INDEX, 0);
    guard.setDynamicProperty(PROP_DIR, 1);
    guard.setDynamicProperty(PROP_ORIGIN_X, origin.x);
    guard.setDynamicProperty(PROP_ORIGIN_Y, origin.y);
    guard.setDynamicProperty(PROP_ORIGIN_Z, origin.z);
    guard.setDynamicProperty(PROP_FACING, facing);
    return true;
  } catch (error) {
    console.warn("[village] could not assign a patrol: " + error);
    return false;
  }
}

function patrolStateOf(guard) {
  const edge = guard.getDynamicProperty(PROP_EDGE);
  const radius = guard.getDynamicProperty(PROP_RADIUS);
  const standUp = guard.getDynamicProperty(PROP_STAND);
  if (typeof edge !== "string" || !Number.isInteger(radius) || !Number.isInteger(standUp)) return null;
  const x = guard.getDynamicProperty(PROP_ORIGIN_X);
  const y = guard.getDynamicProperty(PROP_ORIGIN_Y);
  const z = guard.getDynamicProperty(PROP_ORIGIN_Z);
  const facing = guard.getDynamicProperty(PROP_FACING);
  if (![x, y, z, facing].every(Number.isFinite)) return null;
  return {
    edge,
    radius,
    standUp,
    origin: { x, y, z },
    facing,
    index: guard.getDynamicProperty(PROP_INDEX) || 0,
    direction: guard.getDynamicProperty(PROP_DIR) === -1 ? -1 : 1
  };
}

/**
 * Advances one guard by a single waypoint. Exported so a test can drive a
 * patrol without a tick loop.
 */
export function stepPatrol(guard) {
  const state = patrolStateOf(guard);
  if (!state) return null;
  const route = patrolRoute(state.edge, state.radius, state.standUp);
  if (route.length < 2) return null;

  let index = state.index + state.direction;
  let direction = state.direction;
  if (index >= route.length) { index = route.length - 2; direction = -1; }
  else if (index < 0) { index = 1; direction = 1; }

  const point = route[index];
  const at = toWorld(state.origin, state.facing, point.f, point.s, point.up);
  const surfaceY = walkSurfaceY(guard.dimension, at);
  const destination = { x: at.x + 0.5, y: surfaceY === null ? at.y : surfaceY, z: at.z + 0.5 };

  // The tether would treat a walking guard as one that has wandered off and
  // teleport it back to its tower mid-route, so a guard on patrol is not
  // tethered. Its home is re-anchored wherever it stops, so the tether can
  // pick it up again from there.
  guard.removeTag("village_tethered");

  let moved = false;
  try {
    moved = guard.tryTeleport(destination, { dimension: guard.dimension, facingLocation: destination });
  } catch (error) {
    return null;
  }
  if (!moved) {
    // Something is standing in the way, or the chunk is not there. Turn round
    // rather than pushing at it - the route is a loop, so going back is always
    // a legal move and there is nothing to get stuck on.
    direction = -direction;
    guard.setDynamicProperty(PROP_DIR, direction);
    return { moved: false, index: state.index, direction };
  }

  guard.setDynamicProperty(PROP_INDEX, index);
  guard.setDynamicProperty(PROP_DIR, direction);
  return { moved: true, index, direction, local: point, at: destination };
}

/**
 * The height a watchman actually stands at in one column of its route: the
 * topmost air block with something solid under it, found by searching down
 * from well above the nominal walk.
 *
 * A route is still a straight line one block at a time, but it is no longer a
 * line at one constant height - a wall that rides the relief climbs with it.
 * Rather than teach the patrol the wall's ground profile, it asks the wall
 * where its own top is, one column at a time. Returns null when the answer
 * cannot be read (an unloaded chunk), and the caller falls back to the nominal
 * height, which is what the walk has on level ground.
 */
function walkSurfaceY(dimension, at) {
  if (!dimension) return null;
  for (let y = at.y + WALK_SEARCH; y >= at.y - WALK_SEARCH; y--) {
    let here, below;
    try {
      here = dimension.getBlock({ x: at.x, y, z: at.z })?.typeId;
      below = dimension.getBlock({ x: at.x, y: y - 1, z: at.z })?.typeId;
    } catch (error) {
      return null;
    }
    if ((!here || here === "minecraft:air") && below && below !== "minecraft:air") return y;
  }
  return null;
}

/** Re-anchors a guard where it is and hands it back to the tether. */
function standDown(guard) {
  if (guard.hasTag("village_tethered")) return;
  try {
    setHome(guard, guard.location, 4);
  } catch (error) {
    /* the guard is mid-despawn; the next spawn re-anchors it anyway */
  }
}

export function startPatrolLoop() {
  system.runInterval(() => {
    let guards;
    let players;
    try {
      const dimension = world.getDimension("overworld");
      guards = dimension.getEntities({ tags: ["village_guard"] });
      players = world.getPlayers();
    } catch (error) {
      return;
    }
    if (!guards.length) return;

    for (const guard of guards) {
      try {
        if (!guard.isValid) continue;
        const here = guard.location;
        const watched = players.some((player) => {
          if (player.dimension?.id !== guard.dimension?.id) return false;
          const dx = player.location.x - here.x, dy = player.location.y - here.y, dz = player.location.z - here.z;
          return dx * dx + dy * dy + dz * dz <= WATCH_DISTANCE * WATCH_DISTANCE;
        });
        if (!watched) { standDown(guard); continue; }
        stepPatrol(guard);
      } catch (error) {
        /* guard despawned mid-pass */
      }
    }
  }, STEP_INTERVAL_TICKS);
}
