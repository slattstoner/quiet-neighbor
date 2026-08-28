import { __test__, system } from "@minecraft/server";
import { buildFortifications, ensureTower, towerGeometry, perimeterFor,
         TIER_PALISADE, TIER_COBBLE, TIER_CASTLE } from "./scripts/walls.js";
import { withLoadedArea } from "./scripts/terrain.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }

const dim = __test__.makeDimension();
const facing = 0;

/** Lays a flat grass plain around a village origin so builds have real ground. */
function layGround(origin, radius) {
  for (let x = origin.x - radius; x <= origin.x + radius; x++) {
    for (let z = origin.z - radius; z <= origin.z + radius; z++) {
      dim.getBlock({ x, y: origin.y - 1, z }).setType("minecraft:grass_block");
      for (let y = origin.y - 8; y < origin.y - 1; y++) dim.getBlock({ x, y, z }).setType("minecraft:dirt");
    }
  }
}

const TIER_MATERIALS = {
  [TIER_PALISADE]: { post: "minecraft:oak_log", infill: "minecraft:oak_planks", body: "minecraft:oak_log", roof: "minecraft:oak_planks" },
  [TIER_COBBLE]: { post: "minecraft:spruce_log", infill: "minecraft:cobblestone", body: "minecraft:cobblestone", roof: "minecraft:stone_bricks" },
  [TIER_CASTLE]: { post: "minecraft:cobblestone", infill: "minecraft:stone_bricks", body: "minecraft:stone_bricks", roof: "minecraft:stone_bricks" }
};

/** The blocks that must exist for a tower to actually be a tower. */
function missingTowerParts(origin, corner, tier) {
  const g = towerGeometry(corner, tier);
  const m = TIER_MATERIALS[tier];
  const want = [
    ["shaft post (min corner)", g.fMin, g.sMin, g.shaftTop, m.post],
    ["shaft post (max corner)", g.fMax, g.sMax, g.shaftTop, m.post],
    ["shaft post (mixed corner)", g.fMin, g.sMax, g.shaftTop, m.post],
    ["wall panel between the posts", g.midF - 1, g.sMin, 1, m.infill],
    ["wall panel on the forward face", g.fMin, g.midS, 1, m.infill],
    ["wall panel high on the shaft", g.midF + 1, g.sMax, g.shaftTop - 1, m.infill],
    ["guard room wall", g.fMax, g.sMax, g.roomUp + 2, m.body],
    ["roof apex", g.midF, g.midS, g.roofBase + 2, m.roof]
  ];
  const missing = [];
  for (const [label, f, s, up, typeId] of want) {
    const p = toWorld(origin, facing, f, s, up);
    let found = null;
    try { found = dim.getBlock(p)?.typeId; } catch (e) { found = "unloaded chunk"; }
    if (found !== typeId) missing.push(`${label} (expected ${typeId}, found ${found})`);
  }
  return missing;
}

// ---------- 1. every corner gets a whole tower, at every tier ----------
console.log("\n=== all four corners get a complete tower at every tier ===");
for (const tier of [TIER_PALISADE, TIER_COBBLE, TIER_CASTLE]) {
  const origin = { x: -970000 + tier * 500, y: 70, z: 0 };
  layGround(origin, 60);
  const fort = buildFortifications(dim, origin, facing, 38, tier, []);
  assert(fort.towers.length === 4, `tier ${tier}: four towers reported`);
  const rect = fort.rect;
  const cornerList = [
    { f: rect.fMin, s: rect.sMin }, { f: rect.fMin, s: rect.sMax },
    { f: rect.fMax, s: rect.sMin }, { f: rect.fMax, s: rect.sMax }
  ];
  for (const corner of cornerList) {
    const missing = missingTowerParts(origin, corner, tier);
    assert(missing.length === 0,
      `tier ${tier}: tower at f=${corner.f} s=${corner.s} is complete${missing.length ? " - missing " + missing.join("; ") : ""}`);
  }
}

// ---------- 2. a corner whose chunk is still streaming in is retried ----------
// The corner towers sit ~68 blocks diagonally from the town hall, past the
// default simulation distance, so their chunks are routinely still loading
// when the level-up runs. setBlock swallows LocationInUnloadedChunkError, so
// before the fix the tower silently never existed and nothing ever went back
// for it - the reported "only four posts, or half a tower" at every level.
console.log("\n=== a tower whose chunk is cold at build time is rebuilt on retry ===");
{
  const origin = { x: -960000, y: 70, z: 0 };
  layGround(origin, 60);
  const rect = perimeterFor(38);
  const corner = { f: rect.fMax, s: rect.sMax };
  const cold = toWorld(origin, facing, corner.f - 4, corner.s - 4, 0);
  dim._markUnloaded({ x1: cold.x - 1, x2: cold.x + 40, z1: cold.z - 1, z2: cold.z + 40 });

  system._deferTimeouts = true;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  const tower = ensureTower(dim, origin, facing, corner, TIER_COBBLE);
  console.warn = originalWarn;

  assert(missingTowerParts(origin, corner, TIER_COBBLE).length > 0,
    "nothing lands while the chunk is cold (the original silent failure)");
  assert(tower && tower.standAt && Number.isFinite(tower.standAt.x),
    "the guard post is still reported, so spawnTowerGuard can retry onto it");
  assert(!warnings.some(w => w.includes("still incomplete after retries")),
    "no premature give-up warning - a retry is pending");

  dim._clearUnloaded();
  system.flushTimeouts();
  const missing = missingTowerParts(origin, corner, TIER_COBBLE);
  assert(missing.length === 0,
    `the retry finished the tower once the chunk loaded${missing.length ? " - still missing " + missing.join("; ") : ""}`);
  system._deferTimeouts = false;
}

// ---------- 3. a chunk boundary cutting the footprint leaves no half-tower ----------
console.log("\n=== a tower half-written across a chunk boundary is completed ===");
{
  const origin = { x: -958000, y: 70, z: 0 };
  layGround(origin, 60);
  const rect = perimeterFor(38);
  const corner = { f: rect.fMax, s: rect.sMax };
  const g = towerGeometry(corner, TIER_PALISADE);
  // Cold region covering only the outer half of the 5x5 footprint.
  const a = toWorld(origin, facing, g.fMin + 2, g.sMin, 0);
  const b = toWorld(origin, facing, g.fMax + 2, g.sMax + 2, 0);
  dim._markUnloaded({ x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), z1: Math.min(a.z, b.z), z2: Math.max(a.z, b.z) });

  system._deferTimeouts = true;
  const originalWarn = console.warn;
  console.warn = () => {};
  ensureTower(dim, origin, facing, corner, TIER_PALISADE);
  console.warn = originalWarn;
  assert(missingTowerParts(origin, corner, TIER_PALISADE).length > 0,
    "half the footprint is missing while that chunk is cold");

  dim._clearUnloaded();
  system.flushTimeouts();
  const missing = missingTowerParts(origin, corner, TIER_PALISADE);
  assert(missing.length === 0,
    `the retry filled in the missing half${missing.length ? " - still missing " + missing.join("; ") : ""}`);
  system._deferTimeouts = false;
}

// ---------- 4. the footprint reaches real ground instead of floating ----------
console.log("\n=== the tower footprint is carried down to solid ground ===");
{
  const origin = { x: -956000, y: 70, z: 0 };
  layGround(origin, 60);
  const rect = perimeterFor(38);
  const corner = { f: rect.fMax, s: rect.sMax };
  const g = towerGeometry(corner, TIER_COBBLE);
  // Scoop a hollow out from under the middle of the footprint, the way a
  // shoreline or a hillside edge does in a real world.
  for (let f = g.fMin; f <= g.fMax; f++) {
    for (let s = g.sMin; s <= g.sMax; s++) {
      for (let down = 1; down <= 5; down++) {
        const p = toWorld(origin, facing, f, s, -down);
        dim.getBlock(p).setType("minecraft:air");
      }
    }
  }
  ensureTower(dim, origin, facing, corner, TIER_COBBLE);
  let floating = 0;
  for (let f = g.fMin; f <= g.fMax; f++) {
    for (let s = g.sMin; s <= g.sMax; s++) {
      for (let down = 1; down <= 5; down++) {
        const p = toWorld(origin, facing, f, s, -down);
        if (dim.getBlock(p).typeId === "minecraft:air") floating++;
      }
    }
  }
  assert(floating === 0, `no open air left under the tower (${floating} unsupported cells)`);
}

// ---------- 5. the ticking area outlives the synchronous build ----------
// /tickingarea add does not load chunks in the same tick; removing the area
// inside the same synchronous build gave the engine no window to load
// anything, which is what made every deferred retry pointless.
console.log("\n=== the temporary ticking area is held open past the build ===");
{
  const origin = { x: -954000, y: 70, z: 0 };
  const before = dim._commands.length;
  system._deferTimeouts = true;
  withLoadedArea(dim, origin, facing, { fMin: -48, fMax: 48, sMin: -48, sMax: 48 }, () => {});
  const during = dim._commands.slice(before);
  assert(during.some(c => c.startsWith("tickingarea add")), "a ticking area is registered for the build");
  assert(!during.some(c => c.startsWith("tickingarea remove")),
    "it is NOT removed in the same tick the build ran in");
  system.flushTimeouts();
  const after = dim._commands.slice(before);
  assert(after.some(c => c.startsWith("tickingarea remove")), "it is released once the hold expires");
  system._deferTimeouts = false;
}

console.log(failures === 0 ? "\nALL CORNER TOWER TESTS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
