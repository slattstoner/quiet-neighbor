import { __test__ } from "@minecraft/server";
import { extendPath } from "./scripts/builder.js";
import { buildFortifications, perimeterFor, TIER_PALISADE } from "./scripts/walls.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }
function blockAt(dim, origin, f, s, up = 0) { return dim.getBlock(toWorld(origin, 0, f, s, up)).typeId; }

const dim = __test__.makeDimension();
const origin = { x: 900000, y: 70, z: 0 };
console.log("\n=== single straight road ===");
extendPath(dim, origin, 0, 0, 24);
let gravelRoad = 0;
for (let f = 0; f <= 24; f++) if (blockAt(dim, origin, f, 0, -1) === "minecraft:gravel") gravelRoad++;
assert(gravelRoad === 25, `forward road is a continuous gravel band (${gravelRoad}/25)`);
assert(blockAt(dim, origin, 12, 0, -1) === "minecraft:gravel", "no cobblestone centerline - the road is plain gravel");
assert(blockAt(dim, origin, 0, 0, 0) === "minecraft:air", "the road itself remains walkable");

// No perpendicular road: off the road's own width (side beyond +/-2), the
// ground should never have been touched by extendPath at all.
let strayRoad = 0;
for (let s = -24; s <= 24; s++) {
  if (Math.abs(s) <= 2) continue;
  if (blockAt(dim, origin, 0, s, -1) === "minecraft:gravel" || blockAt(dim, origin, 0, s, -1) === "minecraft:cobblestone") strayRoad++;
}
assert(strayRoad === 0, `no perpendicular road exists off the single street (${strayRoad} stray road cells)`);

console.log("\n=== square wall with gates only at the road's two ends ===");
const result = buildFortifications(dim, origin, 0, 24, TIER_PALISADE);
const rect = result.rect;
assert(rect.fMin === -34 && rect.fMax === 34 && rect.sMin === -34 && rect.sMax === 34, "perimeter is a larger square");

for (const [edge, f, s] of [["west (road start)", rect.fMin, 0], ["east (road end)", rect.fMax, 0]]) {
  assert(blockAt(dim, origin, f, s, 0) === "minecraft:air", `${edge} gate has a clear ground passage`);
  assert(blockAt(dim, origin, f, s, 1) === "minecraft:air", `${edge} gate has clear headroom`);
}

// The north/south edges (perpendicular to the road) must be solid - no
// gate opening there anymore, since the village has only one street.
assert(blockAt(dim, origin, 0, rect.sMin, 0) !== "minecraft:air", "south edge has no gate - wall is solid at its center");
assert(blockAt(dim, origin, 0, rect.sMax, 0) !== "minecraft:air", "north edge has no gate - wall is solid at its center");

assert(blockAt(dim, origin, rect.fMin, rect.sMin, 0) === "minecraft:oak_log", "north-west corner keeps the original palisade style");

console.log(failures === 0 ? "\nALL SINGLE-ROAD TESTS PASSED" : `\n${failures} SINGLE-ROAD TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
