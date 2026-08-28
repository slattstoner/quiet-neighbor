import { __test__, system } from "@minecraft/server";
import { perimeterFor, TIER_CASTLE, buildFortifications } from "./scripts/walls.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }

// Regression test for: "at the corners the wall isn't built, and part of
// the towers come out as halves". Root cause: withLoadedArea's
// /tickingarea add (village.js) streams distant chunks in over several
// ticks rather than loading them synchronously, and the corners are the
// farthest, most chunk-loading-vulnerable cells on the whole perimeter.
// setBlock() swallows LocationInUnloadedChunkError on purpose, so a corner
// whose chunk hadn't caught up yet used to just silently never build, with
// nothing to catch. buildFortifications now verifies each corner and
// self-heals it via a delayed retry, the same way guard/golem spawns
// nearby already recover from this exact race.
console.log("\n=== wall + tower self-heal when a corner's chunk isn't loaded yet ===");
{
  const dim = __test__.makeDimension();
  const origin = { x: 0, y: 70, z: 0 };
  const facing = 0;
  const maxForward = 42;
  const rect = perimeterFor(maxForward);

  function typeAt(f, s, up) {
    const p = toWorld(origin, facing, f, s, up);
    try { return dim.getBlock(p).typeId; } catch (e) { return "minecraft:air"; }
  }
  function cornerWallGapCount(corner) {
    let gaps = 0;
    for (let i = 0; i <= 4; i++) {
      const f = corner.f + (corner.f === rect.fMin ? i : -i);
      if (typeAt(f, corner.s, 1) === "minecraft:air") gaps++;
    }
    return gaps;
  }

  // Simulate the fMin/sMin corner's chunk not having streamed in yet at
  // the moment buildFortifications runs.
  const cornerWorld = toWorld(origin, facing, rect.fMin, rect.sMin, 0);
  dim._markUnloaded({ x1: cornerWorld.x - 8, x2: cornerWorld.x + 8, z1: cornerWorld.z - 8, z2: cornerWorld.z + 8 });

  system._deferTimeouts = true;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(String(msg));

  const fort = buildFortifications(dim, origin, facing, maxForward, TIER_CASTLE);

  console.warn = originalWarn;

  assert(fort.towers.length === 4, `all four towers still reported even with a corner not yet loaded (${fort.towers.length})`);
  assert(cornerWallGapCount({ f: rect.fMin, s: rect.sMin }) === 5,
    "sanity check: the unloaded corner really did fail to build on the first pass");

  // Chunk finishes streaming in a couple of seconds later, exactly like a
  // real /tickingarea eventually delivers - and the scheduled retry fires.
  dim._clearUnloaded();
  system.flushTimeouts();

  assert(cornerWallGapCount({ f: rect.fMin, s: rect.sMin }) === 0,
    "wall at the corner is fully rebuilt once the chunk loads and the retry runs");
  assert(typeAt(-50, -48, 1) === "minecraft:spruce_door", "the corner tower's door was rebuilt too");
  assert(typeAt(-52, -52, 13) === "minecraft:stone_brick_stairs", "the corner tower's roof was rebuilt too");

  // The other three corners were never unloaded and must be untouched by
  // any of this - the repair must not have masked a real problem there.
  for (const corner of [{ f: rect.fMin, s: rect.sMax }, { f: rect.fMax, s: rect.sMin }, { f: rect.fMax, s: rect.sMax }]) {
    assert(cornerWallGapCount(corner) === 0, `unaffected corner (${corner.f},${corner.s}) built cleanly on the first pass`);
  }

  system._deferTimeouts = false;
}

console.log(failures === 0 ? "\nALL WALL CORNER REPAIR TESTS PASSED" : `\n${failures} WALL CORNER REPAIR TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
