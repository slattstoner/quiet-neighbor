import { __test__, system, world } from "@minecraft/server";
import { foundVillage, chestSatisfiesRequirements, tryLevelUp, buildGate, GATE_LEVEL, getVillageState } from "./scripts/village.js";
import { toWorld } from "./scripts/util.js";
import { LEVELS, MAX_BETA_LEVEL } from "./scripts/levels.js";
import { buildPlainHouse, buildFarmerHouse, buildBlacksmithHouse, buildCartographerHouse, buildTownHall } from "./scripts/builder.js";
import { startTetherLoop, getHome } from "./scripts/npc.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}
function blockAt(dim, x, y, z) {
  return dim.getBlock({ x, y, z }).typeId;
}
function stateAt(dim, x, y, z) {
  const k = `${x},${y},${z}`;
  const rec = __test__.blockStore.get(k);
  return rec ? rec.states : null;
}

const dim = __test__.makeDimension();

// ---------- 1. DOORS: both halves present, correct modern state ----------
console.log("\n=== doors ===");
const doorCases = [
  { name: "plain house facing +X, left plot", fn: () => buildPlainHouse(dim, { x: 0, y: 70, z: 0 }, 0, 0, -1), origin: { x: 0, y: 70, z: 0 }, facing: 0 },
  { name: "farmer facing +Z, right plot", fn: () => buildFarmerHouse(dim, { x: 500, y: 70, z: 0 }, 2, 0, 1), origin: { x: 500, y: 70, z: 0 }, facing: 2 },
  { name: "blacksmith facing -X, right plot", fn: () => buildBlacksmithHouse(dim, { x: 900, y: 70, z: 0 }, 1, 0, 1), origin: { x: 900, y: 70, z: 0 }, facing: 1 },
  { name: "cartographer facing -Z, left plot", fn: () => buildCartographerHouse(dim, { x: 1300, y: 70, z: 0 }, 3, 0, -1), origin: { x: 1300, y: 70, z: 0 }, facing: 3 }
];

for (const c of doorCases) {
  const shape = c.fn();
  const lower = toWorld(c.origin, c.facing, shape.doorForward, shape.s1, 0);
  const upper = toWorld(c.origin, c.facing, shape.doorForward, shape.s1, 1);
  const lowerType = blockAt(dim, lower.x, lower.y, lower.z);
  const upperType = blockAt(dim, upper.x, upper.y, upper.z);
  assert(lowerType.includes("_door"), `${c.name}: lower door half placed (${lowerType})`);
  assert(upperType.includes("_door"), `${c.name}: UPPER door half placed (${upperType})`);
  const upState = stateAt(dim, upper.x, upper.y, upper.z);
  assert(upState && upState.upper_block_bit === true, `${c.name}: upper half has upper_block_bit`);
  const loState = stateAt(dim, lower.x, lower.y, lower.z);
  assert(loState && typeof loState["minecraft:cardinal_direction"] === "string",
    `${c.name}: door uses modern cardinal_direction state (${JSON.stringify(loState)})`);
}

// ---------- 2. ROOF: no daylight gaps ----------
console.log("\n=== roof watertightness ===");
function roofLeaks(origin, facing, shape, wallTopUp, label) {
  // Cast a ray straight up from every interior floor tile; if it ever
  // reaches open sky without hitting a solid roof block, the roof leaks.
  let leaks = 0;
  for (let f = shape.f1 + 1; f <= shape.f2 - 1; f++) {
    for (let s = shape.sMin + 1; s <= shape.sMax - 1; s++) {
      let covered = false;
      for (let up = 1; up <= wallTopUp + 8; up++) {
        const p = toWorld(origin, facing, f, s, up);
        const t = blockAt(dim, p.x, p.y, p.z);
        if (t !== "minecraft:air" && !t.includes("lantern") && !t.includes("pane")) { covered = true; break; }
      }
      if (!covered) {
        leaks++;
        if (leaks <= 3) console.error(`  [${label}] sky visible from interior tile f=${f} s=${s}`);
      }
    }
  }
  return leaks;
}
for (const c of doorCases) {
  const shape = c.fn();
  const leaks = roofLeaks(c.origin, c.facing, shape, shape.height - 1, c.name);
  assert(leaks === 0, `${c.name}: roof is watertight from inside (${leaks} leaking tiles)`);
}

// ---------- 3. STAIRS actually used on roofs ----------
console.log("\n=== roof uses real stairs ===");
{
  const origin = { x: 2000, y: 70, z: 0 };
  const shape = buildPlainHouse(dim, origin, 0, 0, -1);
  let stairCount = 0;
  for (let f = shape.f1 - 1; f <= shape.f2 + 1; f++) {
    for (let s = shape.sMin - 1; s <= shape.sMax + 1; s++) {
      for (let up = shape.height - 1; up <= shape.height + 5; up++) {
        const p = toWorld(origin, 0, f, s, up);
        if (blockAt(dim, p.x, p.y, p.z).includes("_stairs")) stairCount++;
      }
    }
  }
  assert(stairCount > 10, `roof contains real stair blocks (${stairCount} found)`);
}

// ---------- 4. TERRAIN: village levels an uneven site ----------
console.log("\n=== terrain leveling ===");
{
  // Build a lumpy landscape first
  const base = { x: 5000, y: 64, z: 5000 };
  for (let dx = -20; dx <= 30; dx++) {
    for (let dz = -20; dz <= 20; dz++) {
      const h = 64 + Math.floor(3 * Math.sin(dx / 3) + 2 * Math.cos(dz / 2));
      for (let y = 50; y <= h; y++) {
        dim.getBlock({ x: base.x + dx, y, z: base.z + dz }).setPermutation({ typeId: "minecraft:stone", states: {} });
      }
    }
  }
  const player = __test__.makePlayer("TerrainTester", { x: base.x, y: 70, z: base.z });
  const elder = foundVillage(player, { x: base.x, y: 70, z: base.z }, 0);
  const state = getVillageState(elder);

  // Every tile of the street should now sit at exactly one height
  const streetHeights = new Set();
  for (let f = 0; f <= 10; f++) {
    for (let s = -1; s <= 1; s++) {
      const p = toWorld(state.origin, state.facing, f, s, -1);
      const t = blockAt(dim, p.x, p.y, p.z);
      if (t !== "minecraft:air") streetHeights.add(p.y);
    }
  }
  assert(streetHeights.size === 1, `street surface is a single flat level (found ${streetHeights.size} heights)`);

  // And there should be no leftover terrain poking through the road
  let obstructions = 0;
  for (let f = 0; f <= 10; f++) {
    for (let s = -1; s <= 1; s++) {
      const p = toWorld(state.origin, state.facing, f, s, 1);
      const t = blockAt(dim, p.x, p.y, p.z);
      if (t === "minecraft:stone") obstructions++;
    }
  }
  assert(obstructions === 0, `no raw terrain left blocking the street (${obstructions})`);
}

// ---------- 5. NPC TETHERING ----------
console.log("\n=== npc tethering ===");
{
  const player = __test__.makePlayer("TetherTester", { x: 8000, y: 70, z: 8000 });
  const elder = foundVillage(player, { x: 8000, y: 70, z: 8000 }, 0);
  const home = getHome(elder);
  assert(!!home, "elder has a home point recorded");
  assert(elder.hasTag("village_tethered"), "elder is tagged as tethered");

  startTetherLoop();
  const tick = system._intervals[system._intervals.length - 1];

  // Drag the elder far away, then run one tether tick
  elder.location = { x: 8100, y: 70, z: 8100 };
  tick();
  const d = Math.hypot(elder.location.x - home.location.x, elder.location.z - home.location.z);
  assert(d <= home.radius + 0.001, `elder is pulled back home when it strays (distance now ${d.toFixed(2)})`);

  // A villager standing at home should NOT be teleported
  const before = elder._teleports;
  tick();
  assert(elder._teleports === before, "elder is left alone while it stays home");
}

// ---------- 6. GATE + IRON GOLEMS ----------
console.log("\n=== gate golems ===");
{
  const player = __test__.makePlayer("GateTester", { x: 12000, y: 70, z: 12000 });
  const elder = foundVillage(player, { x: 12000, y: 70, z: 12000 }, 0);
  const state = getVillageState(elder);
  const golems = buildGate(elder.dimension, state.origin, state.facing, state.id, 20);
  assert(golems.length === 2, `gate spawns a pair of guards (${golems.length})`);
  assert(golems.every((g) => g.typeId === "minecraft:iron_golem"), "guards are iron golems, not villagers");
  assert(golems.every((g) => getHome(g)?.radius === 10), "golems patrol within a 10-block radius of the gate");

  // Passage under the arch must be walkable
  let blocked = 0;
  for (let s = -2; s <= 2; s++) {
    for (let up = 0; up <= 2; up++) {
      const p = toWorld(state.origin, state.facing, 20, s, up);
      if (blockAt(elder.dimension, p.x, p.y, p.z) !== "minecraft:air") blocked++;
    }
  }
  assert(blocked === 0, `gateway passage is clear to walk through (${blocked} blocked cells)`);
}

// ---------- 7. PROFESSIONS + full progression still works ----------
console.log("\n=== progression + professions ===");
{
  const player = __test__.makePlayer("ProgTester", { x: 16000, y: 70, z: 16000 });
  const elder = foundVillage(player, { x: 16000, y: 70, z: 16000 }, 0);
  const state0 = getVillageState(elder);
  const chestBlock = elder.dimension.getBlock(state0.chest);

  for (let level = 2; level <= MAX_BETA_LEVEL; level++) {
    const cfg = LEVELS[level];
    const container = chestBlock.getComponent("minecraft:inventory").container;
    let slot = 0;
    for (const [id, count] of Object.entries(cfg.requirements)) {
      container.setItem(slot++, { typeId: id, amount: count });
    }
    const res = tryLevelUp(elder);
    assert(res.done && res.leveledUpTo === level, `level ${level} built (${cfg.label})`);
  }

  const crafters = elder.dimension.getEntities({ tags: ["village_crafter"] });
  assert(crafters.length >= 3, `craftsmen were spawned (${crafters.length})`);

  const JOB_SITES = ["minecraft:composter", "minecraft:blast_furnace", "minecraft:cartography_table", "minecraft:smithing_table"];
  function hasNearbyJobSite(entity) {
    const base = entity.location;
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          const t = elder.dimension.getBlock({
            x: Math.floor(base.x) + dx,
            y: Math.floor(base.y) + dy,
            z: Math.floor(base.z) + dz
          }).typeId;
          if (JOB_SITES.includes(t)) return true;
        }
      }
    }
    return false;
  }
  const withJobSite = crafters.filter(hasNearbyJobSite);
  assert(withJobSite.length === crafters.length,
    `every craftsman has a claimable job-site block within reach, so vanilla AI can assign his profession (${withJobSite.length}/${crafters.length})`);
  assert(crafters.every((c) => getHome(c)), "every craftsman is tethered to his shop");
}

// ---------- N. TOWN HALL WALL SURVIVES L2/L3 ROAD-STRIP LEVELLING ----------
// Originally reported live: on iPhone, levelling up to L2 sliced a
// horizontal band out of the town hall's street-facing wall, because the
// road-strip terrain pass reached the wall. The town hall was later moved
// further from the road (side=9, clear of the road+lamp-post band) as part
// of switching to a single straight street, which resolves this with real
// margin instead of a narrow band-width workaround - this test now guards
// that margin stays real as the geometry evolves.
{
  console.log("\n=== town hall wall survives L2/L3 levelling (reported live bug) ===");
  const player = __test__.makePlayer("WallTester", { x: 20000, y: 70, z: 20000 });
  const origin = { x: 20000, y: 70, z: 20000 };
  const elder = foundVillage(player, origin, 0);
  const state = getVillageState(elder);

  // Town hall geometry from buildTownHall's houseShell(0, 9, 9, 9, 6, ...):
  // f1=0, f2=8, sMin=5, sMax=13, height=6. Sample the near wall (sMin=5),
  // avoiding the door bay (doorForward=4) and its lantern post.
  const nearWallSamples = [
    { f: 0, up: 3, expect: "minecraft:stripped_dark_oak_log", label: "sMin corner post" },
    { f: 8, up: 3, expect: "minecraft:stripped_dark_oak_log", label: "sMax-side corner post at f2" },
    { f: 2, up: 3, expect: "minecraft:dark_oak_planks", label: "near-wall plank" },
    { f: 6, up: 3, expect: "minecraft:dark_oak_planks", label: "near-wall plank" },
    { f: 2, up: 0, expect: "minecraft:stone_bricks", label: "near-wall foundation trim" }
  ];
  const farWallSample = { f: 0, s: 13, up: 3, expect: "minecraft:stripped_dark_oak_log", label: "far wall (sMax) corner post at f1" };

  for (const sample of nearWallSamples) {
    const p = toWorld(state.origin, state.facing, sample.f, 5, sample.up);
    assert(blockAt(elder.dimension, p.x, p.y, p.z) === sample.expect,
      `before any level-up: town hall ${sample.label} at f=${sample.f} is intact`);
  }
  {
    const p = toWorld(state.origin, state.facing, farWallSample.f, farWallSample.s, farWallSample.up);
    assert(blockAt(elder.dimension, p.x, p.y, p.z) === farWallSample.expect,
      `before any level-up: town hall ${farWallSample.label} is intact`);
  }

  for (let level = 2; level <= 10; level++) {
    const cfg = LEVELS[level];
    const chestBlock = elder.dimension.getBlock(state.chest);
    const container = chestBlock.getComponent("minecraft:inventory").container;
    let slot = 0;
    for (const [id, count] of Object.entries(cfg.requirements)) container.setItem(slot++, { typeId: id, amount: count });
    const result = tryLevelUp(elder);
    assert(result.done && result.leveledUpTo === level, `level ${level} built (${cfg.label})`);

    for (const sample of nearWallSamples) {
      const p = toWorld(state.origin, state.facing, sample.f, 5, sample.up);
      const actual = blockAt(elder.dimension, p.x, p.y, p.z);
      assert(actual === sample.expect,
        `after levelling to L${level}: town hall ${sample.label} at f=${sample.f} is still ${sample.expect} (got ${actual})`);
    }
    {
      const p = toWorld(state.origin, state.facing, farWallSample.f, farWallSample.s, farWallSample.up);
      const actual = blockAt(elder.dimension, p.x, p.y, p.z);
      assert(actual === farWallSample.expect,
        `after levelling to L${level}: town hall ${farWallSample.label} is still ${farWallSample.expect} (got ${actual})`);
    }
  }
}

// ---------- N+1. FORTIFICATION HANG FIX: interior sweep is a real chunked job ----------
// Reported live: founding a village at L7 via the test bell triggered a
// Bedrock Watchdog hang inside buildFortifications (L5's palisade tier).
// Root cause: prepareFortifiedArea's interior terrain-flattening pass swept
// up to ~9000 columns synchronously in one script call. It's now split off
// into a generator run through system.runJob so the engine can spread it
// across ticks. This test intercepts system.runJob itself (instead of
// letting the mock auto-drain it) to prove the work is genuinely chunked:
// a single partial pump of the generator must leave most of the interior
// untouched, and only look "the same as before" once fully drained.
{
  console.log("\n=== fortification hang fix: interior sweep is chunked, not synchronous ===");
  const player = __test__.makePlayer("HangTester", { x: 24000, y: 70, z: 24000 });
  const origin = { x: 24000, y: 70, z: 24000 };
  const elder = foundVillage(player, origin, 0);
  const state = getVillageState(elder);

  function fillChestFor(level) {
    const chestBlock = elder.dimension.getBlock(state.chest);
    const container = chestBlock.getComponent("minecraft:inventory").container;
    let slot = 0;
    for (const [id, count] of Object.entries(LEVELS[level].requirements)) container.setItem(slot++, { typeId: id, amount: count });
  }

  // Reach L4 normally (not fortification levels, no need to intercept).
  for (const level of [2, 3, 4]) {
    fillChestFor(level);
    const r = tryLevelUp(elder);
    assert(r?.done && r.leveledUpTo === level, `setup: level ${level} built on the way to L5`);
  }

  // Drop a block of natural terrain well inside the future perimeter so the
  // interior sweep has something concrete to clear and we can observe it.
  const probe = toWorld(origin, 0, 20, 20, 0);
  elder.dimension.getBlock(probe).setType("minecraft:oak_leaves");

  const capturedJobs = [];
  const originalRunJob = system.runJob;
  system.runJob = (generator) => { capturedJobs.push(generator); return 0; };

  fillChestFor(5);
  const leveled = tryLevelUp(elder);
  system.runJob = originalRunJob;

  assert(leveled?.done && leveled.leveledUpTo === 5, "L5 (first fortification tier) still completes and reports done");
  assert(capturedJobs.length >= 1, `buildFortifications hands the interior sweep to system.runJob (${capturedJobs.length} job(s) captured)`);

  const stillLeaves = elder.dimension.getBlock(probe).typeId === "minecraft:oak_leaves";
  assert(stillLeaves, "before the captured job is pumped at all: interior terrain is untouched (proves the sweep did not run synchronously inside tryLevelUp)");

  // capturedJobs[0] is the interior sweep (prepareFortifiedArea schedules it
  // first); the fortification build itself is a job too, and is captured
  // after it. Both must yield rather than run to completion in one pump.
  const job = capturedJobs[0];
  let steps = 0;
  const stepLimit = 5;
  let stepResult = job.next();
  while (!stepResult.done && steps < stepLimit) { stepResult = job.next(); steps++; }
  assert(!stepResult.done, `job yields control periodically instead of running to completion in one pump (stopped after ${steps} steps)`);

  while (!stepResult.done) stepResult = job.next();
  for (const other of capturedJobs.slice(1)) {
    let s = other.next();
    while (!s.done) s = other.next();
  }
  const clearedAfterFullDrain = elder.dimension.getBlock(probe).typeId !== "minecraft:oak_leaves";
  assert(clearedAfterFullDrain, "once the job is fully drained, the interior terrain is cleared exactly as a synchronous pass would have left it");
}

console.log(failures === 0 ? "\nALL FIX TESTS PASSED" : `\n${failures} FIX TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);


