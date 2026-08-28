import { __test__ } from "@minecraft/server";
import { buildFarmerHouse, buildBlacksmithHouse, buildCartographerHouse, buildPlainHouse, buildTownHall } from "./scripts/builder.js";
import { toWorld } from "./scripts/util.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}
function blockAt(dim, x, y, z) {
  return dim.getBlock({ x, y, z }).typeId;
}

const dim = __test__.makeDimension();

function checkRoofCoverage(dim, origin, facing, shape, wallTopUp, label) {
  const sMin = Math.min(shape.s1, shape.s2), sMax = Math.max(shape.s1, shape.s2);
  const baseUp = wallTopUp + 1;
  let gaps = 0;
  for (let f = shape.f1; f <= shape.f2; f++) {
    for (let s = sMin; s <= sMax; s++) {
      const distFromEdge = Math.min(s - sMin, sMax - s);
      const up = baseUp + distFromEdge;
      const p = toWorld(origin, facing, f, s, up);
      const type = blockAt(dim, p.x, p.y, p.z);
      if (type === "minecraft:air") {
        gaps++;
        console.error(`  [${label}] roof gap at local(f=${f},s=${s},up=${up}) world(${p.x},${p.y},${p.z})`);
      }
    }
  }
  return gaps;
}

const cases = [
  { name: "town hall", origin: { x: 0, y: 70, z: 0 }, facing: 0, wallTop: 5, fn: () => buildTownHall(dim, { x: 0, y: 70, z: 0 }, 0) },
  { name: "farmer house", origin: { x: 100, y: 70, z: 0 }, facing: 0, wallTop: 4, fn: () => buildFarmerHouse(dim, { x: 100, y: 70, z: 0 }, 0, 12, -1) },
  { name: "blacksmith house", origin: { x: 200, y: 70, z: 0 }, facing: 1, wallTop: 4, fn: () => buildBlacksmithHouse(dim, { x: 200, y: 70, z: 0 }, 1, 12, 1) },
  { name: "cartographer house", origin: { x: 300, y: 70, z: 0 }, facing: 2, wallTop: 4, fn: () => buildCartographerHouse(dim, { x: 300, y: 70, z: 0 }, 2, 22, -1) },
  { name: "plain house", origin: { x: 400, y: 70, z: 0 }, facing: 3, wallTop: 4, fn: () => buildPlainHouse(dim, { x: 400, y: 70, z: 0 }, 3, 0, -1) }
];

for (const c of cases) {
  const shape = c.fn();
  const gaps = checkRoofCoverage(dim, c.origin, c.facing, shape, c.wallTop, c.name);
  assert(gaps === 0, `${c.name}: roof has full coverage, no gaps (found ${gaps})`);
}

function checkRoofCoreSolid(dim, origin, facing, shape, wallTopUp, label) {
  const sMin = Math.min(shape.s1, shape.s2), sMax = Math.max(shape.s1, shape.s2);
  const baseUp = wallTopUp + 1;
  let gaps = 0;
  for (let f = shape.f1; f <= shape.f2; f++) {
    for (let s = sMin; s <= sMax; s++) {
      const distFromEdge = Math.min(s - sMin, sMax - s);
      const surfaceUp = baseUp + distFromEdge;
      for (let up = baseUp; up < surfaceUp; up++) {
        const p = toWorld(origin, facing, f, s, up);
        if (blockAt(dim, p.x, p.y, p.z) === "minecraft:air") {
          gaps++;
          if (gaps <= 3) console.error(`  [${label}] hollow roof core at local(f=${f},s=${s},up=${up})`);
        }
      }
    }
  }
  return gaps;
}

for (const c of cases) {
  const shape = c.fn();
  const gaps = checkRoofCoreSolid(dim, c.origin, c.facing, shape, c.wallTop, c.name);
  assert(gaps === 0, `${c.name}: roof volume is a genuinely solid wedge, no hollow pockets (found ${gaps})`);
}



// Directional check: exterior roof stairs must face away from the ridge.
// The test mock records the legacy Bedrock weirdo_direction state selected
// by resolveFirst; these values are 0=W, 1=E, 2=N, 3=S.
const WEIRDO = { west: 0, east: 1, north: 2, south: 3 };
const PLUS_SIDE = ["south", "north", "east", "west"];
const MINUS_SIDE = ["north", "south", "west", "east"];
function stateAt(dim, x, y, z) {
  return __test__.blockStore.get(`${x},${y},${z}`)?.states || null;
}
for (const c of cases) {
  const shape = c.fn();
  const sMin = Math.min(shape.s1, shape.s2), sMax = Math.max(shape.s1, shape.s2);
  const baseUp = c.wallTop + 1;
  const f = Math.round((shape.f1 + shape.f2) / 2);
  for (const [s, expected] of [[sMin, MINUS_SIDE[c.facing]], [sMax, PLUS_SIDE[c.facing]]]) {
    const p = toWorld(c.origin, c.facing, f, s, baseUp);
    const state = stateAt(dim, p.x, p.y, p.z);
    assert(state && state.weirdo_direction === WEIRDO[expected],
      `${c.name}: roof slope at side ${s} faces outward (${expected})`);
  }
}
console.log("ok: roof slopes face outward from the ridge in all four orientations");

console.log(failures === 0 ? "\nALL ROOF TESTS PASSED" : `\n${failures} ROOF TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
