import { __test__, system } from "@minecraft/server";
import { buildFortifications, perimeterFor, TIER_PALISADE } from "./scripts/walls.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }

const dim = __test__.makeDimension();

console.log("\n=== a wall corner still unloaded on the first pass gets patched by a retry, not left as a gap ===");
{
  const origin = { x: 700000, y: 70, z: 0 };
  const facing = 0;
  const maxForward = 20;
  const rect = perimeterFor(maxForward);
  const cornerWorld = toWorld(origin, facing, rect.fMin, rect.sMin, 0);

  // Simulate the far corner's chunk not having streamed in yet, the same
  // race withLoadedArea's own comment documents for NPC/guard spawns.
  dim._markUnloaded({ x1: cornerWorld.x - 2, x2: cornerWorld.x + 2, z1: cornerWorld.z - 2, z2: cornerWorld.z + 2 });
  system._deferTimeouts = true;

  const fort = buildFortifications(dim, origin, facing, maxForward, TIER_PALISADE);
  assert(!!fort && fort.rect.fMin === rect.fMin, "buildFortifications still returns normally with the corner unloaded");

  // The chunk finishes loading and the retry fires. (The corner can't be
  // read back before this point - it's still marked unloaded, and the
  // mock correctly throws for that, same as the real engine would.)
  dim._clearUnloaded();
  const fired = system.flushTimeouts();
  assert(fired > 0, `a retry was actually scheduled for the unloaded corner (${fired} queued)`);

  assert(dim.getBlock(cornerWorld).typeId === "minecraft:oak_log",
    `corner is patched with the palisade's wall block once the retry runs (got ${dim.getBlock(cornerWorld).typeId})`);

  system._deferTimeouts = false;
}

console.log("\n=== a tower's own corner post gets the same retry treatment ===");
{
  const origin = { x: 700500, y: 70, z: 0 };
  const facing = 0;
  const maxForward = 20;
  const rect = perimeterFor(maxForward);
  // The tower sits pulled in 4 blocks from the true corner; its own corner
  // post lands exactly on the true rect corner (see buildTower's footprint
  // math), so marking the same area unloaded exercises both verify passes.
  const towerCornerWorld = toWorld(origin, facing, rect.fMin, rect.sMin, 0);
  dim._markUnloaded({ x1: towerCornerWorld.x - 2, x2: towerCornerWorld.x + 2, z1: towerCornerWorld.z - 2, z2: towerCornerWorld.z + 2 });
  system._deferTimeouts = true;

  buildFortifications(dim, origin, facing, maxForward, TIER_PALISADE);

  dim._clearUnloaded();
  const fired = system.flushTimeouts();
  assert(fired > 0, `a retry was scheduled for the tower's unloaded corner post (${fired} queued)`);
  assert(dim.getBlock(towerCornerWorld).typeId === "minecraft:oak_log",
    `tower corner post is patched once the retry runs (got ${dim.getBlock(towerCornerWorld).typeId})`);

  system._deferTimeouts = false;
}

console.log(failures === 0 ? "\nALL WALLS RELIABILITY TESTS PASSED" : `\n${failures} WALLS RELIABILITY TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
