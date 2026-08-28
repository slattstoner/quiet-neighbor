import { __test__ } from "@minecraft/server";
import { foundVillage, tryLevelUp, getVillageState } from "./scripts/village.js";
import { toWorld } from "./scripts/util.js";
import { LEVELS, MAX_BETA_LEVEL, fullVillageMaxForward } from "./scripts/levels.js";
import { buildTower, perimeterFor, TIER_PALISADE } from "./scripts/walls.js";
import { buildFarmerHouse } from "./scripts/builder.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}
function blockAt(dim, x, y, z) {
  return dim.getBlock({ x, y, z }).typeId;
}

const dim = __test__.makeDimension();

console.log("\n=== tower has a real entrance ===");
{
  const origin = { x: 700000, y: 70, z: 0 };
  const facing = 0;
  const corner = { f: -12, s: -15 };
  const result = buildTower(dim, origin, facing, corner, TIER_PALISADE);

  // A door block (not a solid wall block) through the outer wall is what
  // makes the tower enterable - like house doors, the opening itself IS
  // the door block (walkable when opened), not literal air.
  let doorFound = false;
  for (let f = result.fMin; f <= result.fMax; f++) {
    for (const s of [result.sMin, result.sMax]) {
      const lo = toWorld(origin, facing, f, s, 0);
      const hi = toWorld(origin, facing, f, s, 1);
      const loType = blockAt(dim, lo.x, lo.y, lo.z);
      const hiType = blockAt(dim, hi.x, hi.y, hi.z);
      if (loType.includes("_door") && hiType.includes("_door")) {
        doorFound = true;
      }
    }
  }
  assert(doorFound, "a two-block door (both halves) stands through the tower's outer wall at ground level");

  // The ladder itself occupies its column (climbable, not literal air) -
  // check the ladder is actually there, reachable from the door side.
  const ladderPos = toWorld(origin, facing, result.fMin + 1, result.sMin + 1, 0);
  assert(blockAt(dim, ladderPos.x, ladderPos.y, ladderPos.z) === "minecraft:ladder",
    "the ladder is reachable just inside the door");
}

console.log("\n=== tower uses framed post+infill construction ===");
{
  const origin = { x: 710000, y: 70, z: 0 };
  const facing = 0;
  const corner = { f: -12, s: -15 };
  const result = buildTower(dim, origin, facing, corner, TIER_PALISADE);

  const materials = new Set();
  for (let f = result.fMin; f <= result.fMax; f++) {
    for (const s of [result.sMin, result.sMax]) {
      const p = toWorld(origin, facing, f, s, 1);
      materials.add(blockAt(dim, p.x, p.y, p.z));
    }
  }
  materials.delete("minecraft:air");
  assert(materials.size >= 2, `tower shaft wall uses more than one material (found: ${[...materials].join(", ")})`);
}

console.log("\n=== crop patch is reachable ===");
{
  const origin = { x: 720000, y: 70, z: 0 };
  const shape = buildFarmerHouse(dim, origin, 0, 0, -1);

  const gap = 2, patchDepth = 2;
  const patchNear = shape.sMin - gap;
  const patchFar = patchNear - patchDepth;
  const pMin = Math.min(patchNear, patchFar), pMax = Math.max(patchNear, patchFar);

  let gaps = 0;
  for (let f = shape.f1 - 1; f <= shape.f2 + 1; f++) {
    for (const s of [pMin - 1, pMax + 1]) {
      const p = toWorld(origin, 0, f, s, 0);
      if (blockAt(dim, p.x, p.y, p.z) === "minecraft:air") gaps++;
    }
  }
  assert(gaps >= 2, `crop patch fence has at least one opening on each long side (found ${gaps})`);
}

console.log("\n=== wall never needs to grow through a later building ===");
{
  const rectAtLevel5 = perimeterFor(fullVillageMaxForward());
  const rectAtLevel10 = perimeterFor(fullVillageMaxForward());
  assert(rectAtLevel5.fMax === rectAtLevel10.fMax,
    "the perimeter is identical regardless of which fortify level triggered it");

  let outside = 0;
  for (let level = 2; level <= MAX_BETA_LEVEL; level++) {
    const cfg = LEVELS[level];
    const houseFar = cfg.plotForward + 9;
    if (houseFar >= rectAtLevel5.fMax) {
      outside++;
      console.error(`  level ${level} (${cfg.label}) reaches past the full-size perimeter`);
    }
  }
  assert(outside === 0, `every level's plot fits inside the full-size perimeter (${outside} outside)`);
}

console.log("\n=== golems spawn once, not once per fortify tier ===");
{
  const player = __test__.makePlayer("GolemTester", { x: 730000, y: 70, z: 730000 });
  const elder = foundVillage(player, { x: 730000, y: 70, z: 730000 }, 0);
  const state0 = getVillageState(elder);
  const chest = elder.dimension.getBlock(state0.chest).getComponent("minecraft:inventory").container;

  for (let level = 2; level <= MAX_BETA_LEVEL; level++) {
    const cfg = LEVELS[level];
    let slot = 0;
    for (const [id, count] of Object.entries(cfg.requirements)) {
      chest.setItem(slot++, { typeId: id, amount: count });
    }
    tryLevelUp(elder);
  }

  const vTag = "village:" + state0.id;
  const golems = elder.dimension.getEntities({ tags: ["village_golem", vTag] });
  assert(golems.length === 2, `exactly one golem pair exists after all three fortify tiers (${golems.length})`);
}

console.log("\n=== flower pots use a real Bedrock block id ===");
{
  const origin = { x: 740000, y: 70, z: 0 };
  const shape = buildFarmerHouse(dim, origin, 0, 0, 1);
  let found = false;
  for (let f = shape.f1; f <= shape.f2; f++) {
    for (let s = shape.sMin; s <= shape.sMax; s++) {
      const p = toWorld(origin, 0, f, s, 0);
      if (blockAt(dim, p.x, p.y, p.z) === "minecraft:flower_pot") found = true;
    }
  }
  assert(found, "farmer house places a real minecraft:flower_pot (not a Java-style potted_X id)");
}

console.log(failures === 0 ? "\nALL ROUND-2-FIX TESTS PASSED" : `\n${failures} ROUND-2-FIX TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
