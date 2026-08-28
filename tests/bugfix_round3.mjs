import { __test__, system, world } from "@minecraft/server";
import { foundVillage, tryLevelUp, getVillageState } from "./scripts/village.js";
import { toWorld } from "./scripts/util.js";
import { LEVELS } from "./scripts/levels.js";
import { withRetry } from "./scripts/terrain.js";
import { spawnTowerGuard, spawnCraftsman, startTetherLoop, getHome } from "./scripts/npc.js";
import { VILLAGER_TYPE, ADULT_SPAWN_OPTIONS } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }

const dim = __test__.makeDimension();

// ---------- 1. entity spawns retry through a chunk that isn't loaded yet ----------
// This is the exact failure from the user's screenshot: "[village] tower
// guard spawn failed: LocationInUnloadedChunkError ... which is not in a
// chunk currently loaded and ticking" - happening even with the round-2
// /tickingarea fix in place, because /tickingarea add doesn't load chunks
// synchronously; they stream in over the following ticks.
console.log("\n=== withRetry recovers from a chunk that loads a moment later ===");
{
  const loc = { x: -950000, y: 70, z: 0 };
  dim._markUnloaded({ x1: loc.x - 5, x2: loc.x + 5, z1: loc.z - 5, z2: loc.z + 5 });

  system._deferTimeouts = true;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));

  let guard;
  try {
    guard = withRetry(() => spawnTowerGuard(dim, loc, "t1", 3));
  } finally {
    console.warn = originalWarn;
  }
  assert(guard === undefined, "first attempt against an unloaded chunk fails as before (no crash, no entity)");
  assert(warnings.length === 0, "no premature 'gave up' warning - retries are still pending");

  // Simulate the chunk finishing its load (what the /tickingarea
  // registered moments earlier eventually achieves) and time passing.
  dim._clearUnloaded();
  system.flushTimeouts();

  const spawned = dim.getEntities({ tags: ["village_guard", "village:t1"] });
  assert(spawned.length === 1, `retry succeeded once the chunk was actually loaded (found ${spawned.length})`);
  system._deferTimeouts = false;
}

console.log("\n=== withRetry gives up gracefully if the chunk never loads ===");
{
  const loc = { x: -951000, y: 70, z: 0 };
  dim._markUnloaded({ x1: loc.x - 5, x2: loc.x + 5, z1: loc.z - 5, z2: loc.z + 5 });
  system._deferTimeouts = true;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  withRetry(() => spawnTowerGuard(dim, loc, "t2", 3), [1, 1]);
  system.flushTimeouts();
  system.flushTimeouts();
  console.warn = originalWarn;
  assert(warnings.some(w => w.includes("gave up after retries")), "gives up with a log line instead of retrying forever");
  dim._clearUnloaded();
  system._deferTimeouts = false;
}

// ---------- 2. custom villagers always spawn adult ----------
console.log("\n=== elder and craftsmen always spawn as adults ===");
{
  const player = __test__.makePlayer("AdultTester", { x: -952000, y: 70, z: 0 });
  const elder = foundVillage(player, { x: -952000, y: 70, z: 0 }, 0);
  assert(elder.typeId === "minecraft:villager_v2",
    `elder's typeId is the plain identifier (${elder.typeId})`);
  assert(elder._spawnEvent === "minecraft:ageable_grow_up",
    "elder was spawned with the adult spawnEvent option (not folded into the identifier string)");

  const state0 = getVillageState(elder);
  const chest = elder.dimension.getBlock(state0.chest).getComponent("minecraft:inventory").container;
  const cfg = LEVELS[2];
  let slot = 0;
  for (const [id, count] of Object.entries(cfg.requirements)) chest.setItem(slot++, { typeId: id, amount: count });
  tryLevelUp(elder);
  const farmer = elder.dimension.getEntities({ tags: ["village_crafter", "village:" + state0.id] })[0];
  assert(!!farmer && farmer.typeId === "minecraft:villager_v2",
    "craftsman also spawns with the plain identifier");
}

// Regression guard for the exact Round 3 mistake: folding the spawn event
// into the identifier string ("type<event>") is deprecated on engine
// 1.21.80+ and throws InvalidArgumentError on every single call - which,
// caught by main.js's generic handler, showed up in-game as a misleading
// "surface too uneven" message on every village founded with Round 3
// installed. VILLAGER_TYPE/ADULT_SPAWN_OPTIONS must always be passed
// separately, never combined into one string.
console.log("\n=== the deprecated <event>-in-identifier spawn syntax is never used again ===");
{
  let threw = false;
  try {
    dim.spawnEntity(`${VILLAGER_TYPE}<${ADULT_SPAWN_OPTIONS.spawnEvent}>`, { x: -954000, y: 70, z: 0 });
  } catch (e) {
    threw = true;
  }
  assert(threw, "sanity check: the mock (matching the real 1.21.80+ engine) rejects a folded-in spawn event");

  let ok = false;
  try {
    const e = dim.spawnEntity(VILLAGER_TYPE, { x: -954100, y: 70, z: 0 }, ADULT_SPAWN_OPTIONS);
    ok = !!e;
  } catch (e) {
    ok = false;
  }
  assert(ok, "spawning with VILLAGER_TYPE + ADULT_SPAWN_OPTIONS as separate arguments succeeds");
}

// ---------- 3. tether debounce doesn't recall on a brief excursion, and resets on return ----------
console.log("\n=== tether grace period resets when a villager comes back on its own ===");
{
  const player = __test__.makePlayer("DebounceTester", { x: -953000, y: 70, z: 0 });
  const elder = foundVillage(player, { x: -953000, y: 70, z: 0 }, 0);
  const state0 = getVillageState(elder);
  const chest = elder.dimension.getBlock(state0.chest).getComponent("minecraft:inventory").container;
  const cfg = LEVELS[2];
  let slot = 0;
  for (const [id, count] of Object.entries(cfg.requirements)) chest.setItem(slot++, { typeId: id, amount: count });
  tryLevelUp(elder);
  const farmer = elder.dimension.getEntities({ tags: ["village_crafter", "village:" + state0.id] })[0];
  const home = getHome(farmer);

  startTetherLoop();
  const tick = system._intervals[system._intervals.length - 1];

  const outside = { x: home.location.x + home.radius + 5, y: home.location.y, z: home.location.z };
  const before = farmer._teleports || 0;
  farmer.location = outside;
  tick(); // strike 1
  farmer.location = { ...home.location }; // wanders back on its own before the recall threshold
  tick(); // back in range - resets the strike counter, not just pauses it
  assert((farmer._teleports || 0) === before, "villager that returns on its own before the threshold is never recalled");

  farmer.location = outside;
  tick(); tick(); // only 2 strikes - counter was reset, so this alone must not be enough
  assert((farmer._teleports || 0) === before, "the reset actually took effect (not just carried over strikes)");
  tick(); // 3rd consecutive strike
  assert((farmer._teleports || 0) > before, "sustained absence after a reset still eventually recalls it");
}

console.log(failures === 0 ? "\nALL BUGFIX ROUND 3 TESTS PASSED" : `\n${failures} BUGFIX ROUND 3 TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
