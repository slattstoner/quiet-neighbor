import { __test__ } from "@minecraft/server";
import { extendPath } from "./scripts/builder.js";
import { buildFortifications, perimeterFor, TIER_PALISADE } from "./scripts/walls.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }
function blockAt(dim, origin, f, s, up = 0) { return dim.getBlock(toWorld(origin, 0, f, s, up)).typeId; }

const dim = __test__.makeDimension();
const origin = { x: 900000, y: 70, z: 0 };
console.log("\n=== square crossroads ===");
extendPath(dim, origin, 0, 0, 24);
let forwardRoad = 0, crossRoad = 0;
for (let f = 0; f <= 24; f++) if (blockAt(dim, origin, f, 0, -1) === "minecraft:cobblestone") forwardRoad++;
for (let s = -24; s <= 24; s++) if (blockAt(dim, origin, 0, s, -1) === "minecraft:cobblestone") crossRoad++;
assert(forwardRoad === 25, `forward arm is continuous (${forwardRoad}/25)`);
assert(crossRoad === 49, `cross arm is continuous (${crossRoad}/49)`);
assert(blockAt(dim, origin, 0, 0, 0) === "minecraft:air", "central intersection remains walkable");

console.log("\n=== square expanded wall ===");
const result = buildFortifications(dim, origin, 0, 24, TIER_PALISADE);
const rect = result.rect;
assert(rect.fMin === -34 && rect.fMax === 34 && rect.sMin === -34 && rect.sMax === 34, "perimeter is a larger square");
for (const [edge, f, s] of [["north", 0, rect.sMin], ["south", 0, rect.sMax], ["west", rect.fMin, 0], ["east", rect.fMax, 0]]) {
  assert(blockAt(dim, origin, f, s, 0) === "minecraft:air", `${edge} gate has a clear ground passage`);
  assert(blockAt(dim, origin, f, s, 1) === "minecraft:air", `${edge} gate has clear headroom`);
}
assert(blockAt(dim, origin, rect.fMin, rect.sMin, 0) === "minecraft:oak_log", "north-west corner keeps the original palisade style");

console.log(failures === 0 ? "\nALL CROSSROADS TESTS PASSED" : `\n${failures} CROSSROADS TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
