import { __test__, system } from "@minecraft/server";
import { buildMinerHouse, extendPath } from "./scripts/builder.js";
import { buildFortifications, TIER_PALISADE, TIER_COBBLE } from "./scripts/walls.js";
import { toWorld } from "./scripts/util.js";
import { builtPlotFootprints } from "./scripts/levels.js";
import { buildSpecialBuilding } from "./scripts/specials.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }
function blockAt(dim, origin, facing, f, s, up = 0) { return dim.getBlock(toWorld(origin, facing, f, s, up)).typeId; }

const dim = __test__.makeDimension();

// ---------- 1. "minecraft:cobblestone_stairs" is not a real block id ----------
console.log("\n=== miner's house roof uses a real stairs block id ===");
{
  const origin = { x: -900000, y: 70, z: 0 };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => { warnings.push(String(msg)); };
  let shape;
  try {
    shape = buildMinerHouse(dim, origin, 0, 0, -10, "plains");
  } finally {
    console.warn = originalWarn;
  }
  const stairWarnings = warnings.filter((w) => w.includes("could not place base block"));
  assert(stairWarnings.length === 0, `no "could not place base block" warnings building the miner's house (got ${stairWarnings.length}: ${stairWarnings[0] || ""})`);
  // Roof ridge should be a real, solid, non-air block - it was air before
  // (setType threw on the invalid id, so the roof cell was left however
  // prepareSite/houseShell's own air-clear had left it).
  const ridgeUp = shape.height; // gabledRoof's ridge sits at wallTopUp+1 == height
  const ridgeType = blockAt(dim, origin, 0, shape.f1 + 1, shape.midS, ridgeUp);
  assert(ridgeType !== "minecraft:air", `miner's house roof ridge is solid (${ridgeType})`);
}

// ---------- 2. lamp-post lattice respects arbitrary protected plots, not just the town hall ----------
console.log("\n=== crossroads lattice skips a caller-supplied protected plot ===");
{
  const origin = { x: -900500, y: 70, z: 0 };
  // With toForward=23 the lattice (step 5 from -23) lands posts at
  // ...,-3,2,7,12,17,22 along s=2. f=12 and f=17 sit inside a farmer-style
  // plot at plotForward=12 (band f 12..18, s 2..14); f=22 does not.
  const protectedRects = [{ fMin: 12, fMax: 18, sMin: 2, sMax: 14 }];
  extendPath(dim, origin, 0, 0, 23, protectedRects);
  const inside = blockAt(dim, origin, 0, 12, 2, 1);
  assert(inside !== "minecraft:oak_fence", `lattice post skipped inside the supplied protected rect (got ${inside})`);

  // A position on the same grid but outside the protected rect still gets
  // its usual post, so the exclusion isn't just "nothing gets built".
  const outside = blockAt(dim, origin, 0, 22, 2, 1);
  assert(outside === "minecraft:oak_fence", `lattice still posts outside the protected rect (got ${outside})`);
}

// ---------- 3. re-fortifying at a later tier must not repaint an earlier plot's floor as grass ----------
console.log("\n=== repeat fortification sweep leaves earlier plots alone ===");
{
  const origin = { x: -901000, y: 70, z: 0 };
  const facing = 0;
  // Simulate a level-3 blacksmith floor tile already standing at
  // plotForward=12, side=10 (inside builtPlotFootprints(3)'s band).
  const floorSpot = toWorld(origin, facing, 15, 8, -1);
  dim.getBlock(floorSpot).setType("minecraft:stone");

  const footprints = builtPlotFootprints(3);
  buildFortifications(dim, origin, facing, 24, TIER_PALISADE, footprints);
  system.flushDeferred?.();
  assert(dim.getBlock(floorSpot).typeId === "minecraft:stone",
    `first fortify tier leaves the protected floor tile alone (${dim.getBlock(floorSpot).typeId})`);

  // Re-fortify at the next tier - same interior, same protected footprints.
  // This is exactly the L5 -> L8 -> L10 sequence in the real game.
  buildFortifications(dim, origin, facing, 24, TIER_COBBLE, footprints);
  assert(dim.getBlock(floorSpot).typeId === "minecraft:stone",
    `second fortify tier still leaves the protected floor tile alone (${dim.getBlock(floorSpot).typeId})`);
}

console.log("\n=== without protection, the same sweep WOULD have painted over it (sanity check on the mechanism) ===");
{
  const origin = { x: -901500, y: 70, z: 0 };
  const facing = 0;
  const floorSpot = toWorld(origin, facing, 15, 8, -1);
  dim.getBlock(floorSpot).setType("minecraft:stone");
  buildFortifications(dim, origin, facing, 24, TIER_PALISADE); // no protectedRects
  assert(dim.getBlock(floorSpot).typeId === "minecraft:grass_block",
    `sanity check: an unprotected "stone" floor tile is reclassified as terrain (${dim.getBlock(floorSpot).typeId}) - proves the protection above is actually doing something`);
}

// ---------- 4. special buildings level their own ground instead of floating ----------
console.log("\n=== alchemist shed gets a levelled platform instead of floating ===");
{
  const origin = { x: -902000, y: 70, z: 0 };
  const facing = 0;
  // Dig a pit under the alchemist's footprint before it's built, the way a
  // natural dip in the terrain would look.
  for (let f = 46; f <= 54; f++) {
    for (let s = 3; s <= 13; s++) {
      const p = toWorld(origin, facing, f, s, -1);
      dim.getBlock(p).setType("minecraft:air");
    }
  }
  const state = { elder: null, origin, facing, id: "t" };
  const result = buildSpecialBuilding("alchemist", dim, state);
  assert(result.ok, `alchemist build reports ok (${result.reason || ""})`);
  const underFloor = blockAt(dim, origin, facing, 50, 8, -1);
  assert(underFloor !== "minecraft:air", `ground beneath the alchemist shed is no longer a hole (${underFloor})`);
}

console.log(failures === 0 ? "\nALL BUGFIX ROUND 2 TESTS PASSED" : `\n${failures} BUGFIX ROUND 2 TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
