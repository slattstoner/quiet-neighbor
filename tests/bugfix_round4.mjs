import { __test__ } from "@minecraft/server";
import { toWorld } from "./scripts/util.js";
import { probeGround, prepareSite } from "./scripts/terrain.js";
import { buildFortifications, perimeterFor, TIER_PALISADE, TIER_COBBLE } from "./scripts/walls.js";
import { buildSpecialBuilding, specialBuildingSpec, SPECIAL_BUILDINGS } from "./scripts/specials.js";
import { builtPlotFootprints, fullVillageMaxForward, maxForwardForLevel, MAX_BETA_LEVEL } from "./scripts/levels.js";

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok:", msg); }

const dim = __test__.makeDimension();
const at = (o, f, s, up) => dim.getBlock(toWorld(o, 0, f, s, up)).typeId;
const put = (o, f, s, up, id) => dim.getBlock(toWorld(o, 0, f, s, up)).setType(id);

// ---------- 1. "Подстилка из листьев" is ground cover, not a leaves block ----------
// minecraft:leaf_litter arrived with the Spring to Life drop (Bedrock
// 1.21.70+). Its id contains neither "_leaves" nor "leaves", so
// isTreeLeaves()/isTreePart() never matched it, and it was missing from
// NOT_GROUND as well. Two separate symptoms followed: the terrain sweep
// left it carpeting the finished village, and probeGround() counted it as
// solid ground and sat the whole platform a block too high on a forest
// floor.
console.log("\n=== leaf litter counts as foliage, not as ground ===");
{
  const o = { x: 810000, y: 70, z: 0 };
  put(o, 0, 0, -1, "minecraft:grass_block");
  put(o, 0, 0, 0, "minecraft:leaf_litter");
  const world = toWorld(o, 0, 0, 0, 0);
  const ground = probeGround(dim, world.x, world.z, o.y + 8, o.y - 8);
  assert(ground && ground.typeId === "minecraft:grass_block",
    `probeGround looks through leaf litter to the real surface (got ${ground && ground.typeId})`);
  assert(ground && ground.y === toWorld(o, 0, 0, 0, -1).y,
    "leaf litter does not push the sampled ground level up by a block");
}

console.log("\n=== the terrain sweep actually removes leaf litter ===");
{
  const o = { x: 811000, y: 70, z: 0 };
  // Carpet the whole future interior the way a forest floor is carpeted.
  for (let f = -20; f <= 20; f++) {
    for (let s = -20; s <= 20; s++) put(o, f, s, 0, "minecraft:leaf_litter");
  }
  buildFortifications(dim, o, 0, 12, TIER_PALISADE);
  let left = 0;
  for (let f = -18; f <= 18; f++) {
    for (let s = -18; s <= 18; s++) if (at(o, f, s, 0) === "minecraft:leaf_litter") left++;
  }
  assert(left === 0, `no leaf litter survives inside the finished wall (${left} left)`);
}

console.log("\n=== prepareSite clears leaf litter off a build plot ===");
{
  const o = { x: 812000, y: 70, z: 0 };
  for (let f = 0; f <= 6; f++) for (let s = 0; s <= 6; s++) put(o, f, s, 0, "minecraft:leaf_litter");
  prepareSite(dim, o, 0, 0, 6, 0, 6, { padding: 1, clearHeight: 8, fillDepth: 4 });
  let left = 0;
  for (let f = 0; f <= 6; f++) for (let s = 0; s <= 6; s++) if (at(o, f, s, 0) === "minecraft:leaf_litter") left++;
  assert(left === 0, `no leaf litter survives on a prepared plot (${left} left)`);
}

// ---------- 2. the gateway used to be a trench ----------
// buildGateway cleared the passage from up=0 upward but never laid a floor
// at up=-1, and the main ring loop - the one that does lay each column down
// to -1 and calls supportWallFoundation under it - skips gateway positions
// wholesale. So the five columns of each opening got neither, and on any
// ground not already exactly at platform height the gate was a pit with
// the wall's foundation standing proud either side of it.
console.log("\n=== every gateway has a floor, not a trench ===");
{
  const o = { x: 813000, y: 70, z: 0 };
  const rect = perimeterFor(12);
  // Dig the ground out from under both gate openings first.
  for (const gf of [rect.fMin, rect.fMax]) {
    for (let s = -2; s <= 2; s++) for (let d = 1; d <= 4; d++) put(o, gf, s, -d, "minecraft:air");
  }
  buildFortifications(dim, o, 0, 12, TIER_PALISADE);

  let holes = 0, blocked = 0;
  for (const gf of [rect.fMin, rect.fMax]) {
    for (let s = -2; s <= 2; s++) {
      if (at(o, gf, s, -1) === "minecraft:air") holes++;
      if (at(o, gf, s, 0) !== "minecraft:air" || at(o, gf, s, 1) !== "minecraft:air") blocked++;
    }
  }
  assert(holes === 0, `both gateways are floored across their full width (${holes} open cell(s))`);
  assert(blocked === 0, `both gateways are still walkable through (${blocked} obstructed cell(s))`);
}

// ---------- 3. the street has to reach the gates ----------
// The numbered levels only ever pave as far as the plot they add (furthest
// is forward 38) while the gates sit on the perimeter at +/-48, so the last
// stretch to each gate was never road - and never levelled either, since
// the road corridor is excluded from the interior sweep. The fortification
// now owns that corridor end to end.
console.log("\n=== the paved street runs gate to gate ===");
{
  const o = { x: 814000, y: 70, z: 0 };
  const rect = perimeterFor(fullVillageMaxForward());
  buildFortifications(dim, o, 0, fullVillageMaxForward(), TIER_PALISADE, builtPlotFootprints(10));

  let gaps = 0;
  for (let f = rect.fMin; f <= rect.fMax; f++) {
    // The founding campfire's plaza deliberately straddles the street.
    if (f >= -9 && f <= -3) continue;
    for (let s = -2; s <= 2; s++) if (at(o, f, s, -1) !== "minecraft:gravel") gaps++;
  }
  assert(gaps === 0, `the street is paved without a break from gate to gate (${gaps} unpaved cell(s))`);
}

// ---------- 4. a hill inside the ring has to come down ----------
// prepareFortifiedArea sized its clear height off ring samples alone, so a
// village ringed by flat ground scored steep=false and cleared just 12
// blocks up - leaving anything taller standing untouched in the middle of
// the finished village.
console.log("\n=== a tall hill inside the wall is levelled, not left standing ===");
{
  const o = { x: 815000, y: 70, z: 0 };
  for (let f = 6; f <= 12; f++) {
    for (let s = 6; s <= 12; s++) for (let up = 0; up <= 18; up++) put(o, f, s, up, "minecraft:stone");
  }
  buildFortifications(dim, o, 0, 12, TIER_PALISADE);
  let left = 0;
  for (let f = 6; f <= 12; f++) {
    for (let s = 6; s <= 12; s++) for (let up = 0; up <= 18; up++) if (at(o, f, s, up) === "minecraft:stone") left++;
  }
  assert(left === 0, `the whole hill is cleared, not just its first 12 blocks (${left} left)`);
}

// ---------- 5. special buildings live inside the village now ----------
console.log("\n=== special buildings stand inside the wall and survive later tiers ===");
{
  const rect = perimeterFor(fullVillageMaxForward());
  // "Inside the ring" alone is too weak a bar: the previous attempt at this
  // report simply grew the ring until the sheds fell inside it, which left
  // them exactly where they were - strung out past the last house, out on
  // the edge of a village that had merely got bigger around them. What was
  // actually asked for is that they stand among the other houses, so the
  // bar is that no shed reaches further down the street than the furthest
  // numbered house plot does.
  const houseReach = maxForwardForLevel(MAX_BETA_LEVEL) + 9;
  for (const [key, spec] of Object.entries(SPECIAL_BUILDINGS)) {
    const inside = spec.forward - 6 >= rect.fMin && spec.forward + 6 <= rect.fMax &&
                   spec.side - 6 >= rect.sMin && spec.side + 6 <= rect.sMax;
    assert(inside, `${key}: plot (f ${spec.forward}, s ${spec.side}) sits inside the wall ring`);
    assert(Math.abs(spec.forward) + 6 <= houseReach,
      `${key}: sits among the houses rather than out past them (reaches ${Math.abs(spec.forward) + 6}, houses reach ${houseReach})`);
  }

  // Moving them inside the wall put them in reach of the interior sweep,
  // and their log corner posts read as tree trunks to it - so the plot has
  // to be protected from the tier that follows the building going up.
  const o = { x: 816000, y: 70, z: 0 };
  const spec = specialBuildingSpec("oldtimer");
  buildSpecialBuilding("oldtimer", dim, { elder: null, origin: o, facing: 0, id: "t" });
  const corner = () => at(o, spec.forward - 2, spec.side - 2, 1);
  assert(corner() === "minecraft:spruce_log", `the old-timer's shed has its log frame up (${corner()})`);
  buildFortifications(dim, o, 0, fullVillageMaxForward(), TIER_COBBLE, builtPlotFootprints(10));
  assert(corner() === "minecraft:spruce_log",
    `a later wall tier leaves the standing shed alone (${corner()})`);

  // Control: the same sweep with footprints from before the building could
  // exist really does eat it, which proves the protection above is load
  // bearing rather than incidental.
  const o2 = { x: 817000, y: 70, z: 0 };
  buildSpecialBuilding("oldtimer", dim, { elder: null, origin: o2, facing: 0, id: "t2" });
  buildFortifications(dim, o2, 0, fullVillageMaxForward(), TIER_COBBLE, builtPlotFootprints(7));
  assert(at(o2, spec.forward - 2, spec.side - 2, 1) !== "minecraft:spruce_log",
    "sanity check: an unprotected shed frame really is swept away, so the protection matters");
}

console.log(failures === 0 ? "\nALL BUGFIX ROUND 4 TESTS PASSED" : `\n${failures} BUGFIX ROUND 4 TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
