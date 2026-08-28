import { __test__ } from "@minecraft/server";
import { prepareSite, prepareFortifiedArea } from "./scripts/terrain.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }

const dim = __test__.makeDimension();

console.log("\n=== prepareSite clears a tall tree and buried ore above clearHeight ===");
{
  const origin = { x: 500000, y: 70, z: 0 };
  const facing = 0;
  const f = 0, s = 0;

  // A ~30-block trunk with a small canopy on top, and an ore vein at
  // height 20 - all above the default clearHeight (12), so the old
  // single unconditional pass would never have reached any of it.
  for (let up = 0; up < 30; up++) {
    const p = toWorld(origin, facing, f, s, up);
    dim.getBlock(p).setType("minecraft:oak_log");
  }
  for (let up = 30; up < 33; up++) {
    const p = toWorld(origin, facing, f, s, up);
    dim.getBlock(p).setType("minecraft:oak_leaves");
  }
  const orePos = toWorld(origin, facing, f, s, 20);
  dim.getBlock(orePos).setType("minecraft:iron_ore");

  prepareSite(dim, origin, facing, f, f, s, s, { padding: 0, clearHeight: 12, fillDepth: 2 });

  let stillThere = 0;
  for (let up = 0; up < 33; up++) {
    const p = toWorld(origin, facing, f, s, up);
    if (dim.getBlock(p).typeId !== "minecraft:air") stillThere++;
  }
  assert(stillThere === 0, `prepareSite clears the whole tree/ore column above clearHeight (${stillThere} blocks remain)`);
}

console.log("\n=== interior sweep clears an unprotected wild tree and ore, but leaves a protected house corner alone ===");
{
  const origin = { x: 500500, y: 70, z: 0 };
  const facing = 0;
  const rect = { fMin: -10, fMax: 10, sMin: -10, sMax: 10 };

  // Wild acacia trunk, outside any protected rect.
  const wildF = 5, wildS = 5;
  for (let up = 0; up <= 6; up++) {
    const p = toWorld(origin, facing, wildF, wildS, up);
    dim.getBlock(p).setType("minecraft:acacia_log");
  }
  // Ore, also outside any protected rect.
  const orePos = toWorld(origin, facing, -5, -5, 3);
  dim.getBlock(orePos).setType("minecraft:diamond_ore");
  // A "house corner" log, inside a protected rect - must survive.
  const protRect = { fMin: 0, fMax: 2, sMin: 0, sMax: 2 };
  const protPos = toWorld(origin, facing, 1, 1, 3);
  dim.getBlock(protPos).setType("minecraft:oak_log");

  prepareFortifiedArea(dim, origin, facing, rect, [protRect]);

  const wildCheck = toWorld(origin, facing, wildF, wildS, 3);
  assert(dim.getBlock(wildCheck).typeId === "minecraft:air",
    "wild tree trunk outside protectedRects is cleared by the interior sweep");
  assert(dim.getBlock(orePos).typeId === "minecraft:air",
    "ore outside protectedRects is cleared by the interior sweep");
  assert(dim.getBlock(protPos).typeId === "minecraft:oak_log",
    "a house corner log inside protectedRects survives the interior sweep");
}

console.log(failures === 0 ? "\nALL TERRAIN CLEARING TESTS PASSED" : `\n${failures} TERRAIN CLEARING TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
