import { __test__, world, system } from "@minecraft/server";
import { restockFarm, penWorldBounds, countInPen, startLivestockLoop, RESTOCK_PER_PASS } from "./scripts/livestock.js";
import { FARM_PENS, penYardBounds, applyCraftsmanUpgrade } from "./scripts/upgrades.js";
import { foundVillage } from "./scripts/village.js";
import { DAILY_CAP, MINER_TABLE } from "./scripts/production.js";
import { toWorld } from "./scripts/util.js";

/**
 * The farmer's pens have to stay populated.
 *
 * They are built once, when their quest tier is finished, and the animals put
 * in them then were never replaced. The farmer's chain promises a coop, a cow
 * barn and a pig pen in so many words - and delivers them - and then one wolf
 * or one zombie leaves a pen standing empty for the rest of that world's life.
 * A finished farm slowly becoming a set of empty fences is worse than never
 * having built them.
 *
 * The two rules that matter as much as the restocking itself:
 *
 *  - livestock is scenery, never income. The mod's standing rule is that the
 *    village never out-earns the player's own farming and mining, so a pen
 *    full of cows must not feed production in any way.
 *  - the loop never removes an animal. A pen holding more than its cap,
 *    because the player stocked it or because vanilla breeding happened, is
 *    left alone; topping up is the only action available.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

const dim = __test__.makeDimension();

/** A farmer standing on a plot, with `tier` of his quest chain finished. */
function farmAt(origin, tier, plotForward = 12, side = -1) {
  const player = __test__.makePlayer(`Farm${origin.x}`, { x: origin.x, y: origin.y, z: origin.z });
  const elder = foundVillage(player, origin, 0);
  const farmer = dim.spawnEntity("minecraft:villager_v2", { x: origin.x + plotForward, y: origin.y, z: origin.z + side });
  farmer.addTag("village_crafter");
  farmer.addTag("village_npc");
  for (const tag of elder.getTags().filter((t) => t.startsWith("village:"))) farmer.addTag(tag);
  farmer.setDynamicProperty("village:roleId", "farmer");
  farmer.setDynamicProperty("village:plotForward", plotForward);
  farmer.setDynamicProperty("village:plotSide", side);
  farmer.setDynamicProperty("village:upgradeTier", tier);
  return { player, elder, farmer, plotForward, side };
}

function penFor(label) {
  return FARM_PENS.find((pen) => pen.label === label);
}

function headCount(origin, farm, pen) {
  const box = penWorldBounds(origin, 0, farm.plotForward, farm.side, pen.index);
  return countInPen(dim, box, pen.species);
}

/** Removes every animal of a species from a pen, as a wolf or a zombie would. */
function wipePen(origin, farm, pen) {
  const box = penWorldBounds(origin, 0, farm.plotForward, farm.side, pen.index);
  for (const entity of dim.getEntities({ location: box.centre, maxDistance: 40, type: pen.species })) {
    __test__.entities.splice(__test__.entities.indexOf(entity), 1);
  }
}

// ---------- 1. геометрия загона ----------
console.log("\n=== a pen's world box is the same ground the builders fenced ===");
{
  const origin = { x: 810000, y: 70, z: 0 };
  for (const pen of FARM_PENS) {
    const local = penYardBounds(14, -10, pen.index);
    const box = penWorldBounds(origin, 0, 14, -10, pen.index);
    const expectMin = toWorld(origin, 0, local.fMin, local.sMin, 0);
    const expectMax = toWorld(origin, 0, local.fMax, local.sMax, 0);
    assert(box.minX === Math.min(expectMin.x, expectMax.x) && box.maxX === Math.max(expectMin.x, expectMax.x),
      `${pen.label}: x span comes from the same transform the builder used (${box.minX}..${box.maxX})`);
    assert(box.centre.x > box.minX && box.centre.x < box.maxX + 1,
      `${pen.label}: the restock point is inside the fence`);
  }
  // Three pens, three separate patches of ground.
  const boxes = FARM_PENS.map((pen) => penWorldBounds(origin, 0, 14, -10, pen.index));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const overlap = boxes[i].minX <= boxes[j].maxX && boxes[i].maxX >= boxes[j].minX &&
                      boxes[i].minZ <= boxes[j].maxZ && boxes[i].maxZ >= boxes[j].minZ;
      assert(!overlap, `${FARM_PENS[i].label} and ${FARM_PENS[j].label} are different pens`);
    }
  }
}

// ---------- 2. восполнение ----------
console.log("\n=== an emptied pen is restocked, one head at a time ===");
{
  const origin = { x: 811000, y: 70, z: 0 };
  const farm = farmAt(origin, 4);   // coop, cow barn and pig pen all finished
  const coop = penFor("coop");

  // Build the pens for real, so the animals the builders put there are present
  // and the starting count is the honest one.
  for (const tier of [1, 2, 3, 4]) {
    farm.farmer.setDynamicProperty("village:upgradeTier", tier - 1);
    applyCraftsmanUpgrade(farm.farmer, farm.elder, { tier, label: `tier ${tier}` });
  }
  const stocked = headCount(origin, farm, coop);
  assert(stocked === coop.cap, `the coop starts at its cap (${stocked} of ${coop.cap})`);

  const full = restockFarm(dim, farm.farmer, farm.elder);
  assert(full.ok && full.added.length === 0,
    `a full farm is left alone (${full.added.length} added)`);

  wipePen(origin, farm, coop);
  assert(headCount(origin, farm, coop) === 0, "a wolf empties the coop");

  const first = restockFarm(dim, farm.farmer, farm.elder);
  assert(first.ok && first.added.length === RESTOCK_PER_PASS,
    `one pass adds exactly ${RESTOCK_PER_PASS} head (${first.added.length})`);
  assert(first.added[0].species === coop.species,
    `and it is the species that pen is for (${first.added[0].species})`);
  assert(headCount(origin, farm, coop) === 1, "so the coop holds one bird again");

  let passes = 1;
  while (headCount(origin, farm, coop) < coop.cap && passes < 20) {
    restockFarm(dim, farm.farmer, farm.elder);
    passes++;
  }
  assert(headCount(origin, farm, coop) === coop.cap,
    `a few more passes bring it back to its cap (${passes} passes)`);

  const afterFull = restockFarm(dim, farm.farmer, farm.elder);
  assert(afterFull.added.length === 0, "and it stops there rather than overfilling");
}

console.log("\n=== the loop never removes an animal ===");
{
  const origin = { x: 812000, y: 70, z: 0 };
  const farm = farmAt(origin, 3);
  for (const tier of [1, 2, 3]) {
    farm.farmer.setDynamicProperty("village:upgradeTier", tier - 1);
    applyCraftsmanUpgrade(farm.farmer, farm.elder, { tier, label: `tier ${tier}` });
  }
  const cows = penFor("cow_barn");
  const box = penWorldBounds(origin, 0, farm.plotForward, farm.side, cows.index);

  // The player brings his own herd, well past the cap.
  for (let i = 0; i < 8; i++) dim.spawnEntity(cows.species, box.centre);
  const before = headCount(origin, farm, cows);
  assert(before > cows.cap, `the pen is over its cap (${before} > ${cows.cap})`);

  const result = restockFarm(dim, farm.farmer, farm.elder);
  assert(result.added.every((entry) => entry.pen !== "cow_barn"),
    "the over-full pen is not topped up further");
  assert(headCount(origin, farm, cows) === before,
    `and nothing was culled (${headCount(origin, farm, cows)} still there)`);
}

console.log("\n=== a pen that has not been built yet is not stocked ===");
{
  const origin = { x: 813000, y: 70, z: 0 };
  // Tier 2 means the coop exists but the cow barn and pig pen do not.
  const farm = farmAt(origin, 2);
  const result = restockFarm(dim, farm.farmer, farm.elder, { perPass: 9 });
  const touched = new Set(result.inspected.map((entry) => entry.pen));
  assert(touched.has("coop"), "the finished coop is inspected");
  assert(!touched.has("cow_barn") && !touched.has("pig_pen"),
    `unfinished pens are not (${[...touched].join(", ") || "none"})`);

  const early = farmAt({ x: 814000, y: 70, z: 0 }, 1);
  const none = restockFarm(dim, early.farmer, early.elder);
  assert(!none.ok && none.reason === "no_pens_yet",
    `a farmer with only a field has no pens to stock (${none.reason})`);
}

console.log("\n=== a farm with no plot or no village is refused, not guessed at ===");
{
  const origin = { x: 815000, y: 70, z: 0 };
  const farm = farmAt(origin, 4);
  farm.farmer.setDynamicProperty("village:plotForward", undefined);
  const noPlot = restockFarm(dim, farm.farmer, farm.elder);
  assert(!noPlot.ok && noPlot.reason === "missing_plot", `a farmer with no plot is refused (${noPlot.reason})`);

  // A fresh farmer, so this really exercises the bad-village branch rather
  // than tripping over the plot that was just cleared above.
  const intact = farmAt({ x: 815500, y: 70, z: 0 }, 4);
  const stranger = { getDynamicProperty: () => undefined };
  const noVillage = restockFarm(dim, intact.farmer, stranger);
  assert(!noVillage.ok && noVillage.reason === "bad_village",
    `an elder with no origin is refused for the right reason (${noVillage.reason})`);
}

// ---------- 3. экономика ----------
console.log("\n=== livestock is scenery, never income ===");
{
  // The standing rule: the village never out-earns the player's own farming
  // and mining. Nothing in the production contract may mention an animal.
  const producible = new Set(MINER_TABLE.map((entry) => entry.typeId));
  for (const pen of FARM_PENS) {
    assert(!producible.has(pen.species), `${pen.species} is not something a worker produces`);
  }
  const animalProducts = ["minecraft:egg", "minecraft:beef", "minecraft:porkchop",
    "minecraft:leather", "minecraft:feather", "minecraft:milk_bucket"];
  for (const product of animalProducts) {
    assert(!producible.has(product), `${product} is not in the miner's table either`);
  }
  // And the caps stay small enough that a pen is a picture, not a farm.
  const totalHead = FARM_PENS.reduce((sum, pen) => sum + pen.cap, 0);
  assert(totalHead <= 10, `all three pens together hold at most a handful (${totalHead})`);
  assert(DAILY_CAP.farmer === 12,
    `and the farmer's own daily cap is untouched by any of this (${DAILY_CAP.farmer})`);
}

// ---------- 4. цикл ----------
console.log("\n=== the background loop finds farms near a player ===");
{
  const origin = { x: 816000, y: 70, z: 0 };
  const farm = farmAt(origin, 2);
  for (const tier of [1, 2]) {
    farm.farmer.setDynamicProperty("village:upgradeTier", tier - 1);
    applyCraftsmanUpgrade(farm.farmer, farm.elder, { tier, label: `tier ${tier}` });
  }
  const coop = penFor("coop");
  wipePen(origin, farm, coop);
  assert(headCount(origin, farm, coop) === 0, "the coop starts empty");

  world._players.length = 0;
  world._players.push(farm.player);
  startLivestockLoop();
  const tick = system._intervals[system._intervals.length - 1];
  assert(typeof tick === "function", "the loop registered an interval");

  tick();
  assert(headCount(origin, farm, coop) === 1,
    `one pass of the loop restocked the pen (${headCount(origin, farm, coop)})`);

  // With no player nearby, nothing happens - the same reason patrol.js waits
  // for someone to be within range.
  world._players.length = 0;
  const quiet = headCount(origin, farm, coop);
  tick();
  assert(headCount(origin, farm, coop) === quiet,
    `with nobody around the pen is left alone (${headCount(origin, farm, coop)})`);
  world._players.push(farm.player);
}

console.log(failures === 0 ? "\nALL LIVESTOCK CHECKS PASSED" : `\n${failures} LIVESTOCK CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
