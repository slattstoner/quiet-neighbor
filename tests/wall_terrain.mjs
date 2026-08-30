/**
 * The wall is laid ON the ground, not through it.
 *
 * Every check here is against the three things the fixed-platform wall got
 * wrong on any ground that was not already flat:
 *   - it was buried to its parapet wherever the ground rose,
 *   - it hung over an open hole wherever the ground fell away,
 *   - and the corner towers stayed at the platform height the wall had left,
 *     so they read as separate structures standing off the wall.
 */
import { __test__ } from "@minecraft/server";
import {
  buildDefenceStage,
  buildDefenceStageJob,
  clearStageRingJob,
  planDefenceStage,
  towerFootprintsForStage,
  wallCellsForStage,
  wallWalkFor,
  TOWER_PATROL_EDGE
} from "./scripts/defences_roads.js";
import { smoothProfile } from "./scripts/terrain.js";
import { assignPatrol, patrolRoute, stepPatrol } from "./scripts/patrol.js";
import { spawnTowerGuard } from "./scripts/npc.js";
import { toWorld } from "./scripts/util.js";

let failures = 0, checks = 0;
function assert(condition, message) {
  checks++;
  if (!condition) { failures++; console.error("FAIL:", message); } else console.log("ok:", message);
}

const dim = __test__.makeDimension();
const RADIUS = 44;          // the level-5 palisade stage
const STAGE = 5;
const WALL_HEIGHT = 4;      // TIER_STYLE.palisade.height

/** Lays natural ground whose surface height comes from `surfaceUp(f, s)`. */
function layTerrain(origin, facing, reach, surfaceUp) {
  for (let f = -reach; f <= reach; f++) {
    for (let s = -reach; s <= reach; s++) {
      const top = surfaceUp(f, s);
      for (let up = top - 1; up >= top - 3; up--) {
        const p = toWorld(origin, facing, f, s, up);
        dim.getBlock(p).setType(up === top - 1 ? "minecraft:grass_block" : "minecraft:dirt");
      }
    }
  }
}

function typeAt(origin, facing, f, s, up) {
  return dim.getBlock(toWorld(origin, facing, f, s, up)).typeId;
}

/** The lowest and highest non-air block of one column, within a window. */
function columnSpan(origin, facing, f, s, from, to) {
  let low = null, high = null;
  for (let up = from; up <= to; up++) {
    if (typeAt(origin, facing, f, s, up) !== "minecraft:air") {
      if (low === null) low = up;
      high = up;
    }
  }
  return { low, high };
}

// ---------------------------------------------------------------- 1
console.log("=== smoothProfile only ever raises, and never by more than a step ===");
{
  const raw = [0, 0, -7, -7, -7, 0, 0, 5, 0, 0, 0, 0];
  const smoothed = smoothProfile(raw, 1, true);
  assert(smoothed.every((value, i) => value >= raw[i]),
    "smoothing never drags a cell below the ground it stands on");
  let worstStep = 0;
  for (let i = 0; i < smoothed.length; i++) {
    const next = smoothed[(i + 1) % smoothed.length];
    worstStep = Math.max(worstStep, Math.abs(next - smoothed[i]));
  }
  assert(worstStep <= 1, `the run climbs at most a block at a time, wrap included (worst step ${worstStep})`);
  const flat = smoothProfile([3, 3, 3, 3], 1, true);
  assert(flat.every((value) => value === 3), "level ground is left exactly as it is");
  // A peak has to reach round the wrap point, which one pass each way cannot do.
  const wrapped = smoothProfile([6, 0, 0, 0, 0, 0], 1, true);
  assert(wrapped[5] === 5 && wrapped[1] === 5, `a peak lifts both of its neighbours across the wrap (${wrapped.join(",")})`);
}

// ---------------------------------------------------------------- 2
console.log("\n=== on a hillside the wall follows the ground instead of cutting through it ===");
{
  const origin = { x: 100000, y: 70, z: 100000 };
  const facing = 0;
  // A steady slope across the whole village: ten blocks of fall, corner to corner.
  const surfaceUp = (f) => Math.max(-5, Math.min(5, Math.round(f / 10)));
  layTerrain(origin, facing, RADIUS + 8, surfaceUp);
  buildDefenceStage(dim, origin, facing, STAGE);

  const cells = wallCellsForStage(STAGE);
  const bases = new Map();
  for (const cell of cells) {
    const span = columnSpan(origin, facing, cell.f, cell.s, -20, 20);
    bases.set(`${cell.f},${cell.s}`, span);
  }

  const tops = [...bases.values()].map((span) => span.high).filter((value) => value !== null);
  assert(new Set(tops).size > 4,
    `the wall top follows the relief rather than sitting at one height (${new Set(tops).size} distinct heights)`);

  // Buried is the failure this replaces: the wall used to be laid at the
  // village platform whatever the ground did, so on the high side of a slope
  // its parapet was level with, or under, the hillside beside it.
  let buried = 0, floating = 0;
  for (const cell of cells) {
    const span = bases.get(`${cell.f},${cell.s}`);
    if (span.high === null) continue;
    const ground = surfaceUp(cell.f, cell.s);
    if (span.high < ground + WALL_HEIGHT - 2) buried++;
    // Nothing may be left hanging: the column has to be solid from its
    // highest block right down to the natural surface.
    for (let up = ground; up < span.high; up++) {
      if (typeAt(origin, facing, cell.f, cell.s, up) === "minecraft:air") { floating++; break; }
    }
  }
  assert(buried === 0, `no stretch of wall is sunk into the hillside (${buried} of ${cells.length} cells buried)`);
  assert(floating === 0, `no stretch of wall hangs over a gap (${floating} of ${cells.length} cells undercut)`);
}

// ---------------------------------------------------------------- 3
console.log("\n=== a wall crossing a gully is underpinned, not left over a hole ===");
{
  const origin = { x: 200000, y: 70, z: 200000 };
  const facing = 0;
  // A ravine seven blocks deep cutting across one wall.
  const surfaceUp = (f) => (f >= -20 && f <= -10 ? -7 : 0);
  layTerrain(origin, facing, RADIUS + 8, surfaceUp);
  buildDefenceStage(dim, origin, facing, STAGE);

  let holes = 0, checked = 0;
  for (let f = -22; f <= -8; f++) {
    const ground = surfaceUp(f);
    const span = columnSpan(origin, facing, f, -RADIUS, -20, 20);
    if (span.high === null) { holes++; continue; }
    checked++;
    for (let up = ground; up <= span.high; up++) {
      if (typeAt(origin, facing, f, -RADIUS, up) === "minecraft:air") { holes++; break; }
    }
  }
  assert(checked === 15 && holes === 0,
    `every column over the ravine is solid from the wall down to the ground (${holes} holes in ${checked} columns)`);

  // ...and the wall really did drop into the ravine rather than bridging it
  // at the old platform height.
  const middle = columnSpan(origin, facing, -15, -RADIUS, -20, 20);
  assert(middle.high !== null && middle.high < 0,
    `the wall follows the ravine down instead of flying over it (top at ${middle.high})`);
}

// ---------------------------------------------------------------- 4
console.log("\n=== the corner towers stand in the corners, on the ground ===");
{
  const origin = { x: 300000, y: 70, z: 300000 };
  const facing = 0;
  const surfaceUp = (f, s) => Math.max(-6, Math.min(6, Math.round((f + s) / 14)));
  layTerrain(origin, facing, RADIUS + 8, surfaceUp);
  buildDefenceStage(dim, origin, facing, STAGE);

  for (const tower of towerFootprintsForStage(STAGE)) {
    const b = tower.bounds;
    assert(Math.abs(b.fMin) <= RADIUS && Math.abs(b.fMax) <= RADIUS &&
           Math.abs(b.sMin) <= RADIUS && Math.abs(b.sMax) <= RADIUS,
      `${tower.id}: the whole footprint is inside the wall, not carried out past it`);
    // Its two outer faces ARE the two curtain lines that meet in this corner.
    const outerF = tower.corner.f < 0 ? b.fMin : b.fMax;
    const outerS = tower.corner.s < 0 ? b.sMin : b.sMax;
    assert(Math.abs(outerF) === RADIUS && Math.abs(outerS) === RADIUS,
      `${tower.id}: sits flush in the corner of the ring (outer faces at ${outerF}, ${outerS})`);

    // On the ground, not on the platform the wall used to be pinned to. The
    // tower's own corner column ends in its crenellation, five above its base
    // (palisade towerHeight 5), so the top of that column names the height the
    // tower was raised from.
    const towerTop = columnSpan(origin, facing, tower.corner.f, tower.corner.s, -20, 24).high;
    assert(towerTop !== null, `${tower.id}: the tower is actually there`);
    const towerBase = towerTop - 5;
    const ground = surfaceUp(tower.corner.f, tower.corner.s);
    assert(Math.abs(towerBase - ground) <= 2,
      `${tower.id}: raised from the ground its corner stands on, not from the platform (base ${towerBase}, ground ${ground})`);

    // ...and the wall running out of it starts from the same staircase. The
    // walkway cell five along ends in its plank walk, two above its own base.
    const step = { f: tower.corner.f < 0 ? 1 : -1, s: tower.corner.s < 0 ? 1 : -1 };
    const near = tower.corner.f === b.fMin || tower.corner.f === b.fMax
      ? { f: tower.corner.f, s: tower.corner.s + step.s * 5 }
      : { f: tower.corner.f + step.f * 5, s: tower.corner.s };
    const inner = { f: Math.abs(near.f) === RADIUS ? near.f - step.f : near.f, s: Math.abs(near.s) === RADIUS ? near.s - step.s : near.s };
    const walkTop = columnSpan(origin, facing, inner.f, inner.s, -20, 24).high;
    assert(walkTop !== null && Math.abs((walkTop - 2) - towerBase) <= 5,
      `${tower.id}: the wall leaves it as a staircase, not a cliff (wall base ${walkTop === null ? "?" : walkTop - 2}, tower base ${towerBase})`);
  }
}

// ---------------------------------------------------------------- 5
console.log("\n=== the rampart stays walkable, and the watch walks it ===");
{
  const origin = { x: 400000, y: 70, z: 400000 };
  const facing = 0;
  // north_east patrols the fMax wall, so the ground has to change along `s`
  // for this to be a test of anything.
  const surfaceUp = (f, s) => Math.max(-6, Math.min(6, Math.round(s / 7)));
  layTerrain(origin, facing, RADIUS + 8, surfaceUp);
  buildDefenceStage(dim, origin, facing, STAGE);

  const walk = wallWalkFor(STAGE);
  const route = patrolRoute(TOWER_PATROL_EDGE.north_east, walk.radius, walk.standUp);

  // The route is a straight line one block at a time; what changes with the
  // ground is how high each step is, and it may never change by more than one.
  const surfaces = route.map((point) => columnSpan(origin, facing, point.f, point.s, -20, 20).high);
  assert(surfaces.every((value) => value !== null), "every waypoint has a rampart under it");
  let worstStep = 0;
  for (let i = 1; i < surfaces.length; i++) worstStep = Math.max(worstStep, Math.abs(surfaces[i] - surfaces[i - 1]));
  assert(worstStep <= 1, `the walk climbs at most a block per step (worst was ${worstStep})`);
  assert(new Set(surfaces).size > 3,
    `and it really does climb - the ground under this wall is not flat (${new Set(surfaces).size} heights)`);

  const plan = planDefenceStage(STAGE);
  const tower = plan.towers.find((entry) => entry.id === "north_east");
  const start = toWorld(origin, facing, tower.standAt.f, tower.standAt.s, tower.standAt.up);
  const guard = spawnTowerGuard(dim, { x: start.x + 0.5, y: start.y, z: start.z + 0.5 }, "terrain-test", 3);
  assignPatrol(guard, tower.id, STAGE, origin, facing);

  let offWall = 0, steps = 0;
  for (let i = 0; i < route.length; i++) {
    const step = stepPatrol(guard);
    if (!step || !step.moved) continue;
    steps++;
    const below = dim.getBlock({ x: Math.floor(step.at.x), y: step.at.y - 1, z: Math.floor(step.at.z) }).typeId;
    const here = dim.getBlock({ x: Math.floor(step.at.x), y: step.at.y, z: Math.floor(step.at.z) }).typeId;
    if (below === "minecraft:air" || here !== "minecraft:air") offWall++;
  }
  assert(steps > 4, `the watchman actually walks its wall (${steps} steps)`);
  assert(offWall === 0,
    `it stands on the rampart at every step instead of in mid-air or inside the wall (${offWall} of ${steps} bad)`);
}

// ---------------------------------------------------------------- 6
console.log("\n=== the next stage's demolition finds the wall the ground put there ===");
{
  const origin = { x: 500000, y: 70, z: 500000 };
  const facing = 0;
  const surfaceUp = (f, s) => Math.max(-6, Math.min(6, Math.round((f - s) / 12)));
  layTerrain(origin, facing, RADIUS + 8, surfaceUp);
  buildDefenceStage(dim, origin, facing, STAGE);

  const before = wallCellsForStage(STAGE).filter((cell) =>
    columnSpan(origin, facing, cell.f, cell.s, surfaceUp(cell.f, cell.s), 24).high !== null).length;
  assert(before > 100, `there is a wall standing to take down (${before} cells)`);

  for (const _ of clearStageRingJob(dim, origin, facing, STAGE, [])) { /* drain */ }

  let leftStanding = 0;
  for (const cell of wallCellsForStage(STAGE)) {
    const ground = surfaceUp(cell.f, cell.s);
    // Anything above the natural surface is wall the demolition should have
    // taken; the foundation buried below it is allowed to stay.
    for (let up = ground; up <= 24; up++) {
      if (typeAt(origin, facing, cell.f, cell.s, up) !== "minecraft:air") { leftStanding++; break; }
    }
  }
  assert(leftStanding === 0, `nothing of the old wall is left above ground (${leftStanding} cells still standing)`);
}

// ---------------------------------------------------------------- 6b
console.log("\n=== a gate cut into a hillside still meets its own road ===");
{
  const origin = { x: 550000, y: 70, z: 550000 };
  const facing = 0;
  // High ground all round the ring, so every gate is in a cutting.
  const surfaceUp = () => 8;
  layTerrain(origin, facing, RADIUS + 8, surfaceUp);
  buildDefenceStage(dim, origin, facing, STAGE);

  const plan = planDefenceStage(STAGE);
  let blockedPassage = 0, floatingFloor = 0;
  for (const gate of plan.gates) {
    for (const cell of gate.cells) {
      // The road is a levelled causeway from one side of the village to the
      // other, so its gate stays at the road's height whatever the hill does.
      for (let up = 0; up <= 3; up++) {
        if (typeAt(origin, facing, cell.f, cell.s, up) !== "minecraft:air") blockedPassage++;
      }
      if (typeAt(origin, facing, cell.f, cell.s, -1) === "minecraft:air") floatingFloor++;
    }
  }
  assert(blockedPassage === 0, `every gate passage is walkable at road level (${blockedPassage} blocked cells)`);
  assert(floatingFloor === 0, `every gate has a floor under it (${floatingFloor} open cells)`);

  let roadHoles = 0;
  for (let f = -RADIUS; f <= RADIUS; f++) {
    if (typeAt(origin, facing, f, 0, -1) === "minecraft:air") roadHoles++;
  }
  assert(roadHoles === 0, `the road runs unbroken from gate to gate (${roadHoles} gaps)`);
}

// ---------------------------------------------------------------- 7
console.log("\n=== reading the ground, and filling under it, still fits in a tick ===");
// Bedrock's watchdog terminates the script runtime when one tick hangs. Both
// jobs got heavier here - one probes the ground under every cell of the ring,
// the other now peels a foundation off as well - so both are measured, and
// the demolition is measured for the first time: it used to clear a five-wide
// band top to bottom thirty cells at a time, some 2,000 native calls in a
// single slice.
const SLICE_BUDGET = 900;
{
  const origin = { x: 600000, y: 70, z: 600000 };
  const facing = 0;
  // Ground that really does move, so the footings have columns to fill.
  const surfaceUp = (f, s) => Math.max(-8, Math.min(8, Math.round(Math.sin(f / 9) * 5 + Math.cos(s / 11) * 4)));
  layTerrain(origin, facing, RADIUS + 8, surfaceUp);

  for (const [label, make] of [
    ["the stage build", (dimension) => buildDefenceStageJob(dimension, origin, facing, STAGE)],
    ["the stage demolition", (dimension) => clearStageRingJob(dimension, origin, facing, STAGE, [])]
  ]) {
    let calls = 0;
    const counting = new Proxy(dim, {
      get(target, prop) {
        const value = target[prop];
        if (prop !== "getBlock" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
        return (...args) => { calls++; return value.apply(target, args); };
      }
    });
    const job = make(counting);
    let worst = 0, slices = 0;
    for (let step = job.next(); !step.done; step = job.next()) {
      worst = Math.max(worst, calls);
      calls = 0;
      slices++;
    }
    assert(slices > 100, `${label} hands the tick back often (${slices} slices)`);
    assert(worst <= SLICE_BUDGET, `${label}: no slice exceeds ${SLICE_BUDGET} block calls (worst was ${worst})`);
  }
}

console.log(failures === 0
  ? `\nALL WALL TERRAIN TESTS PASSED (${checks} checks)`
  : `\n${failures} WALL TERRAIN TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
