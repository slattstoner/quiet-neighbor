import { __test__ } from "@minecraft/server";
import { PALETTES } from "./scripts/palettes.js";
import {
  buildPlainHouse, buildFarmerHouse, buildBlacksmithHouse,
  buildCartographerHouse, buildMinerHouse, buildTownHall, buildCampfire, paveRoad
} from "./scripts/builder.js";
import { buildDefenceStage, DEFENCE_STAGES } from "./scripts/defences_roads.js";

/**
 * Guards the whole class of "silently wrong block identifier" bug, for the
 * ids the source-scanning lint cannot possibly see.
 *
 * lint.mjs greps the scripts for bad ids written as string literals. That
 * catches "minecraft:stone_slab", but it is structurally blind to an id that
 * only exists after a palette is resolved at runtime:
 *
 *     `minecraft:${p.wood}_door`     -> minecraft:oak_door   (does not exist)
 *     `minecraft:${p.stone}`         -> minecraft:terracotta (does not exist)
 *
 * Both shipped. Neither was visible to lint, and no functional test failed,
 * because util.js's setBlock swallows placement errors by design - so the
 * only symptom in-game was a meadow house with no door and a savanna house
 * with no foundation.
 *
 * The mock now records every id anything tries to place. This suite drives
 * each builder once per palette and once per defence tier, then asserts that
 * nothing attempted an id the engine would reject. A future palette entry
 * with a Java-style block name fails here immediately.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

function badIdsAttempted() {
  return [...__test__.attemptedBlockIds]
    .filter((id) => __test__.isKnownBadBlockId(id))
    .map((id) => `${id} (use ${__test__.suggestionForBlockId(id)})`);
}

// ---------- every palette, through every house builder ----------
console.log("\n=== block ids resolved from each biome palette ===");
for (const palette of Object.values(PALETTES)) {
  __test__.resetAttemptedBlockIds();
  const dim = __test__.makeDimension();
  const origin = { x: 0, y: 70, z: 0 };
  const facing = 0;

  buildTownHall(dim, origin, facing);
  buildCampfire(dim, origin, facing, -6);
  paveRoad(dim, origin, facing, -20, 40);
  buildPlainHouse(dim, origin, facing, 12, -1, palette.id);
  buildFarmerHouse(dim, origin, facing, 24, -1, palette.id);
  buildBlacksmithHouse(dim, origin, facing, 36, 1, palette.id);
  buildCartographerHouse(dim, origin, facing, 48, -1, palette.id);
  buildMinerHouse(dim, origin, facing, 60, 1, palette.id);

  const bad = badIdsAttempted();
  assert(bad.length === 0,
    `palette "${palette.id}" (${palette.label}) places only real block ids${bad.length ? ": " + bad.join(", ") : ""}`);
}

// ---------- every defence tier ----------
console.log("\n=== block ids used by each fortification tier ===");
for (const stage of DEFENCE_STAGES) {
  __test__.resetAttemptedBlockIds();
  const dim = __test__.makeDimension();
  try {
    buildDefenceStage(dim, { x: 0, y: 70, z: 0 }, 0, stage.level ?? stage);
  } catch (error) {
    // A build that cannot run at all is a different test's problem; this
    // suite only cares about which ids it reached for on the way.
  }
  const bad = badIdsAttempted();
  assert(bad.length === 0,
    `defence tier "${stage.tier}" places only real block ids${bad.length ? ": " + bad.join(", ") : ""}`);
}

// ---------- the recorder itself has to work ----------
// If the mock ever stopped recording, every assertion above would pass
// vacuously and this suite would be worthless.
console.log("\n=== the recorder actually observes placements ===");
{
  __test__.resetAttemptedBlockIds();
  const dim = __test__.makeDimension();
  buildTownHall(dim, { x: 500, y: 70, z: 500 }, 0);
  assert(__test__.attemptedBlockIds.size > 5,
    `building records the ids it places (${__test__.attemptedBlockIds.size} distinct ids seen)`);

  __test__.resetAttemptedBlockIds();
  const block = dim.getBlock({ x: 500, y: 71, z: 500 });
  try { block.setType("minecraft:terracotta"); } catch (error) { /* expected: not a real id */ }
  assert(badIdsAttempted().length === 1,
    "a deliberately bad id is detected by the same check the palettes go through");
}

console.log(failures === 0 ? "\nALL PALETTE BLOCK-ID CHECKS PASSED" : `\n${failures} PALETTE BLOCK-ID CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
