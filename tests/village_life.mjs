// Stages 3 and 4: the village behaves like somewhere people live.
//
// Two things this covers. Watchmen used to stand in a tower on a three-block
// tether for the rest of the world's existence; they now walk their stretch of
// wall. And the only bell was eight blocks up inside the town hall's closed
// cupola - a meeting-area point of interest nobody could gather at - so the
// square now has one at ground level from the day the village is founded.

import { __test__, world } from "@minecraft/server";
import { patrolRoute, stepPatrol, assignPatrol } from "./scripts/patrol.js";
import { wallWalkFor, TOWER_PATROL_EDGE, planDefenceStage, buildDefenceStage } from "./scripts/defences_roads.js";
import { pickAmbientLine, timePhase } from "./scripts/dialogue.js";
import { foundVillage, getVillageState } from "./scripts/village.js";
import { spawnTowerGuard } from "./scripts/npc.js";
import { toWorld } from "./scripts/util.js";
import { PERIMETER_SCHEDULE } from "./scripts/spatial_plan.js";

let checks = 0, failures = 0;
function assert(condition, label) {
  checks++;
  if (condition) console.log(`ok: ${label}`);
  else { failures++; console.error(`FAIL: ${label}`); }
}
const blockAt = (dimension, x, y, z) => {
  try { return dimension.getBlock({ x, y, z })?.typeId; } catch (e) { return undefined; }
};

// ---------------------------------------------------------------- 1
console.log("=== a patrol route is a straight line on solid wall ===");
for (const stage of PERIMETER_SCHEDULE) {
  const walk = wallWalkFor(stage.level);
  assert(walk.radius === stage.radius, `L${stage.level}: the walk follows the R${stage.radius} wall`);
  for (const [towerId, edge] of Object.entries(TOWER_PATROL_EDGE)) {
    const route = patrolRoute(edge, walk.radius, walk.standUp);
    assert(route.length > 4, `L${stage.level}/${towerId}: the route is worth walking (${route.length} waypoints)`);
    // Each step is exactly one block from the last: that is what makes this a
    // walk rather than a series of jumps, and what removes any need to search
    // for a path between waypoints.
    let contiguous = true, onLine = true, clearsGate = true, sameHeight = true;
    const fixedAxis = edge === "fMax" || edge === "fMin" ? "f" : "s";
    for (const [i, point] of route.entries()) {
      if (point.up !== walk.standUp) sameHeight = false;
      if (Math.abs(point[fixedAxis]) !== walk.line) onLine = false;
      const along = fixedAxis === "f" ? point.s : point.f;
      // The five-cell gate opening has no walk across it; the route must stop
      // clear of it rather than step into the hole.
      if (Math.abs(along) <= 2) clearsGate = false;
      if (i > 0) {
        const previous = route[i - 1];
        if (Math.abs(point.f - previous.f) + Math.abs(point.s - previous.s) !== 1) contiguous = false;
      }
    }
    assert(contiguous, `L${stage.level}/${towerId}: every step is one block from the last`);
    assert(onLine, `L${stage.level}/${towerId}: the route stays on the wall-walk line (${walk.line})`);
    assert(sameHeight, `L${stage.level}/${towerId}: the route stays at one height (${walk.standUp})`);
    assert(clearsGate, `L${stage.level}/${towerId}: the route stops clear of the gate opening`);
  }
}
{
  const edges = new Set(Object.values(TOWER_PATROL_EDGE));
  assert(edges.size === 4, `all four walls get a sentinel, not two of them twice (${[...edges].join(", ")})`);
}

// ---------------------------------------------------------------- 2
console.log("\n=== the wall-walk a route uses is actually built ===");
// The palisade used to lay its plank walk on every third cell, so a watchman
// sent along it would have walked into thin air two steps out of three.
for (const stage of PERIMETER_SCHEDULE) {
  const dimension = __test__.makeDimension();
  const origin = { x: 800000 + stage.radius * 8, y: 70, z: 800000 };
  buildDefenceStage(dimension, origin, 0, stage.level);
  const walk = wallWalkFor(stage.level);
  const route = patrolRoute(TOWER_PATROL_EDGE.north_east, walk.radius, walk.standUp);
  let unsupported = 0, obstructed = 0;
  for (const point of route) {
    const under = toWorld(origin, 0, point.f, point.s, point.up - 1);
    const at = toWorld(origin, 0, point.f, point.s, point.up);
    const below = blockAt(dimension, under.x, under.y, under.z);
    const here = blockAt(dimension, at.x, at.y, at.z);
    if (!below || below === "minecraft:air") unsupported++;
    if (here && here !== "minecraft:air") obstructed++;
  }
  assert(unsupported === 0, `${stage.tier}/R${stage.radius}: the whole route has solid ground under it (${unsupported} gaps)`);
  assert(obstructed === 0, `${stage.tier}/R${stage.radius}: nothing stands in the walkway (${obstructed} blocked)`);
}

// ---------------------------------------------------------------- 3
console.log("\n=== a watchman actually walks, and turns round at the end ===");
{
  const player = __test__.makePlayer("PatrolTester", { x: 700000, y: 70, z: 700000 });
  const origin = { x: 700000, y: 70, z: 700000 };
  const elder = foundVillage(player, origin, 0);
  const state = getVillageState(elder);
  const stageLevel = PERIMETER_SCHEDULE[0].level;
  const plan = planDefenceStage(stageLevel);
  const tower = plan.towers.find((t) => t.id === "north_east");

  const at = toWorld(origin, 0, tower.standAt.f, tower.standAt.s, tower.standAt.up);
  const guard = spawnTowerGuard(elder.dimension, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 }, state.id, 3);
  assert(guard.hasTag("village_tethered"), "a fresh guard is tethered to its post");
  assert(assignPatrol(guard, tower.id, stageLevel, origin, 0), "the guard is given a route");

  const walk = wallWalkFor(stageLevel);
  const route = patrolRoute(TOWER_PATROL_EDGE.north_east, walk.radius, walk.standUp);
  const seen = [];
  let reversals = 0, previousDirection = 1;
  for (let i = 0; i < route.length * 2 + 4; i++) {
    const step = stepPatrol(guard);
    if (!step) break;
    if (step.moved) seen.push(step.index);
    if (step.direction !== previousDirection) { reversals++; previousDirection = step.direction; }
  }
  assert(seen.length > route.length, `the guard keeps walking rather than stopping (${seen.length} steps)`);
  assert(new Set(seen).size > route.length / 2, `it covers most of its wall (${new Set(seen).size} of ${route.length} waypoints)`);
  assert(reversals >= 1, `it turns round at the end instead of walking off (${reversals} turns)`);
  assert(!guard.hasTag("village_tethered"),
    "a guard on patrol drops its tether - otherwise the tether loop would teleport it back to its tower mid-route");
  const finalRoute = patrolRoute(TOWER_PATROL_EDGE.north_east, walk.radius, walk.standUp);
  const expected = toWorld(origin, 0, finalRoute[seen[seen.length - 1]].f, finalRoute[seen[seen.length - 1]].s, walk.standUp);
  assert(Math.abs(guard.location.x - (expected.x + 0.5)) < 0.01 && Math.abs(guard.location.z - (expected.z + 0.5)) < 0.01,
    "the guard really is standing where its route says it is");

  // A guard with no route assigned must be left completely alone: that is what
  // keeps legacy villages, whose walls have entirely different geometry, from
  // having their watchmen teleported onto a wall-walk that isn't there.
  const plain = spawnTowerGuard(elder.dimension, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 }, state.id, 3);
  assert(stepPatrol(plain) === null, "a guard with no route never moves");
  assert(plain.hasTag("village_tethered"), "…and keeps its tether");
}

// ---------------------------------------------------------------- 4
console.log("\n=== the square has a bell to gather at ===");
{
  const player = __test__.makePlayer("BellTester", { x: 730000, y: 70, z: 730000 });
  const origin = { x: 730000, y: 70, z: 730000 };
  const elder = foundVillage(player, origin, 0);
  const state = getVillageState(elder);

  let bells = 0, groundBells = 0;
  for (let f = -14; f <= 14; f++) {
    for (let s = -14; s <= 14; s++) {
      for (let up = 0; up <= 9; up++) {
        const p = toWorld(state.origin, state.facing, f, s, up);
        if (blockAt(elder.dimension, p.x, p.y, p.z) === "minecraft:bell") {
          bells++;
          // A bell a villager can actually reach and gather at, rather than
          // one sealed in the hall's roof.
          if (up <= 3) groundBells++;
        }
      }
    }
  }
  assert(bells >= 2, `the village has both its bells (${bells})`);
  assert(groundBells >= 1, `one of them stands on the square where villagers can gather (${groundBells})`);
}

// ---------------------------------------------------------------- 5
console.log("\n=== people say different things at different hours ===");
{
  const phases = ["dawn", "day", "dusk", "night"];
  for (const phase of phases) {
    const lines = new Set();
    for (let i = 0; i < 200; i++) lines.add(pickAmbientLine("Кузнец", phase, 1, false));
    assert(lines.size >= 3, `${phase}: the blacksmith has more than one thing to say (${lines.size})`);
    assert(![...lines].includes(null), `${phase}: never comes back empty-handed`);
  }
  // Distinct hours must actually produce distinct lines, or the phase is decor.
  const dayLines = new Set();
  const nightLines = new Set();
  for (let i = 0; i < 300; i++) {
    dayLines.add(pickAmbientLine("Житель", "day", 1, false));
    nightLines.add(pickAmbientLine("Житель", "night", 1, false));
  }
  assert([...nightLines].some((line) => !dayLines.has(line)), "night has lines the daytime never produces");

  // The elder speaks for the settlement, so a big village and a small one must
  // not sound identical.
  const small = new Set(), large = new Set();
  for (let i = 0; i < 400; i++) {
    small.add(pickAmbientLine("Староста", "day", 1, true));
    large.add(pickAmbientLine("Староста", "day", 15, true));
  }
  assert([...large].some((line) => !small.has(line)), "a level-15 elder has things to say a level-1 elder does not");

  // A district trade nobody wrote lines for still speaks rather than standing
  // there as furniture.
  const trade = new Set();
  for (let i = 0; i < 200; i++) trade.add(pickAmbientLine("Кожевник", "day", 1, false));
  assert(trade.size >= 3 && ![...trade].includes(null), `a district trade has its own small repertoire (${trade.size})`);

  for (const [time, expected] of [[0, "dawn"], [6000, "day"], [12000, "dusk"], [18000, "night"], [23500, "dawn"]]) {
    world.setTimeOfDay(time);
    assert(timePhase() === expected, `tick ${time} reads as ${expected}`);
  }
}

console.log(failures === 0
  ? `\nALL VILLAGE LIFE TESTS PASSED (${checks} checks)`
  : `\n${failures} VILLAGE LIFE TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
