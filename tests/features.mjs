import { __test__, system, world, ItemStack } from "@minecraft/server";
import { foundVillage, tryLevelUp, getVillageState } from "./scripts/village.js";
import { toWorld } from "./scripts/util.js";
import { LEVELS, MAX_BETA_LEVEL, maxForwardForLevel } from "./scripts/levels.js";
import { perimeterFor, TIER_PALISADE, TIER_COBBLE, TIER_CASTLE, buildFortifications } from "./scripts/walls.js";
import { startProductionLoop, DAILY_CAP, STORAGE_CAP } from "./scripts/production.js";
import { QUESTS, getQuestFor, turnInQuest } from "./scripts/quests.js";
import { getHome } from "./scripts/npc.js";
import { PALETTES, paletteById } from "./scripts/palettes.js";
import { candidateForCell } from "./scripts/worldgen.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}
function blockAt(dim, x, y, z) {
  return dim.getBlock({ x, y, z }).typeId;
}

const dim = __test__.makeDimension();

// ---------- 0. BIOME PALETTES + EXPLORATION CANDIDATES ----------
console.log("\n=== biome palettes + exploration candidates ===");
{
  const required = ["plains", "meadow", "taiga", "savanna", "desert"];
  assert(required.every((id) => PALETTES[id]), `five vanilla-style palettes exist (${required.join(", ")})`);
  assert(paletteById("unknown").id === "plains", "unknown palette safely falls back to plains");
  const a = candidateForCell(12, -4), b = candidateForCell(12, -4);
  assert(a.x === b.x && a.z === b.z && a.roll === b.roll, "exploration candidate is deterministic per world cell");
  assert(a.x >= 12 * 512 + 96 && a.x < 12 * 512 + 416, "candidate stays inside its intended generation cell");
}


// ---------- 1. FORTIFICATION TIERS ----------
console.log("\n=== fortification tiers ===");
{
  const origin = { x: 60000, y: 70, z: 60000 };
  const facing = 0;
  const maxForward = 42;

  const tiers = [
    { tier: TIER_PALISADE, name: "палисад", expect: "minecraft:oak_log" },
    { tier: TIER_COBBLE, name: "булыжник", expect: "minecraft:cobblestone" },
    { tier: TIER_CASTLE, name: "замковая", expect: "minecraft:stone_bricks" }
  ];

  let prev = null;
  for (const t of tiers) {
    const fort = buildFortifications(dim, origin, facing, maxForward, t.tier);
    const rect = fort.rect;

    // The wall material should now be the new tier's material
    let matches = 0, total = 0;
    for (let f = rect.fMin + 6; f <= rect.fMax - 6; f += 3) {
      for (const s of [rect.sMin, rect.sMax]) {
        total++;
        const p = toWorld(origin, facing, f, s, 1);
        if (blockAt(dim, p.x, p.y, p.z) === t.expect) matches++;
      }
    }
    assert(matches / total > 0.8, `${t.name}: wall is built from ${t.expect} (${matches}/${total})`);

    // Upgrading must replace the previous tier, not leave it standing
    if (prev) {
      let leftovers = 0;
      for (let f = rect.fMin + 6; f <= rect.fMax - 6; f += 3) {
        for (const s of [rect.sMin, rect.sMax]) {
          const p = toWorld(origin, facing, f, s, 1);
          if (blockAt(dim, p.x, p.y, p.z) === prev) leftovers++;
        }
      }
      assert(leftovers === 0, `${t.name}: previous tier fully replaced (${leftovers} old blocks left)`);
    }
    prev = t.expect;

    // Four towers
    assert(fort.towers.length === 4, `${t.name}: four corner towers built (${fort.towers.length})`);

    // Gateway must be walkable
    let blocked = 0;
    for (let s = -2; s <= 2; s++) {
      for (let up = 0; up <= 2; up++) {
        const p = toWorld(origin, facing, rect.fMax, s, up);
        if (blockAt(dim, p.x, p.y, p.z) !== "minecraft:air") blocked++;
      }
    }
    assert(blocked === 0, `${t.name}: main gateway is passable (${blocked} blocked cells)`);
  }
}

// ---------- 2. WALL ENCLOSES THE VILLAGE ----------
console.log("\n=== wall actually encloses the village ===");
{
  const rect = perimeterFor(maxForwardForLevel(MAX_BETA_LEVEL));
  // every plot must sit strictly inside the perimeter
  let outside = 0;
  for (let level = 2; level <= MAX_BETA_LEVEL; level++) {
    const cfg = LEVELS[level];
    const houseFar = cfg.plotForward + 8;
    const sideFar = cfg.side >= 0 ? 10 : -10;
    if (houseFar >= rect.fMax || Math.abs(sideFar) >= Math.abs(rect.sMax)) {
      outside++;
      console.error(`  level ${level} (${cfg.label}) extends past the wall`);
    }
  }
  assert(outside === 0, `every plot fits inside the perimeter (${outside} outside)`);
}

// ---------- 3. TOWER GUARDS ARE STATIONED AND TETHERED ----------
console.log("\n=== tower guards ===");
{
  const player = __test__.makePlayer("WallTester", { x: 70000, y: 70, z: 70000 });
  const elder = foundVillage(player, { x: 70000, y: 70, z: 70000 }, 0);
  const state0 = getVillageState(elder);
  const chestBlock = elder.dimension.getBlock(state0.chest);

  for (let level = 2; level <= 5; level++) {
    const cfg = LEVELS[level];
    const container = chestBlock.getComponent("minecraft:inventory").container;
    let slot = 0;
    for (const [id, count] of Object.entries(cfg.requirements)) {
      container.setItem(slot++, { typeId: id, amount: count });
    }
    const res = tryLevelUp(elder);
    assert(res.done, `level ${level} built (${cfg.label})`);
    if (level === 5) {
      assert(res.fortified === TIER_PALISADE, "level 5 raised the palisade");
      assert(res.towers === 4, `level 5 built 4 watchtowers (${res.towers})`);
    }
  }

  const vTagG = "village:" + state0.id;
  const guards = elder.dimension.getEntities({ tags: ["village_guard", vTagG] });
  assert(guards.length === 4, `a watchman is posted in each tower (${guards.length})`);
  assert(guards.every((g) => getHome(g)), "every watchman is tethered to his post");

  const golems = elder.dimension.getEntities({ tags: ["village_golem", vTagG] });
  assert(golems.length >= 2, `iron golems guard the gate (${golems.length})`);
}

// ---------- 4. FARMER PRODUCTION ----------
console.log("\n=== farmer production ===");
{
  const player = __test__.makePlayer("FarmTester", { x: 80000, y: 70, z: 80000 });
  const elder = foundVillage(player, { x: 80000, y: 70, z: 80000 }, 0);
  const state0 = getVillageState(elder);
  const chestBlock = elder.dimension.getBlock(state0.chest);
  const cfg = LEVELS[2];
  const container = chestBlock.getComponent("minecraft:inventory").container;
  let slot = 0;
  for (const [id, count] of Object.entries(cfg.requirements)) {
    container.setItem(slot++, { typeId: id, amount: count });
  }
  tryLevelUp(elder);

  // Scope to this village - the mock world is shared across test sections
  const vTag = "village:" + state0.id;
  const farmers = elder.dimension.getEntities({ tags: ["village_worker", vTag] });
  assert(farmers.length === 1, `farmer is registered as a worker (${farmers.length})`);
  const farmer = farmers[0];

  startProductionLoop();
  const prodTick = system._intervals[system._intervals.length - 1];

  // Find the farmer's barrel to watch
  let barrel = null;
  const base = farmer.location;
  for (let dx = -8; dx <= 8 && !barrel; dx++) {
    for (let dz = -8; dz <= 8 && !barrel; dz++) {
      for (let dy = -2; dy <= 2 && !barrel; dy++) {
        const b = elder.dimension.getBlock({ x: Math.floor(base.x) + dx, y: Math.floor(base.y) + dy, z: Math.floor(base.z) + dz });
        if (b && (b.typeId === "minecraft:barrel" || b.typeId === "minecraft:chest")) {
          barrel = b.getComponent("minecraft:inventory").container;
        }
      }
    }
  }
  assert(!!barrel, "farmer has storage in reach");

  function wheatInBarrel() {
    let n = 0;
    for (let i = 0; i < barrel.size; i++) {
      const st = barrel.getItem(i);
      if (st && st.typeId === "minecraft:wheat") n += st.amount;
    }
    return n;
  }

  const before = wheatInBarrel();
  for (let i = 0; i < 5; i++) prodTick();
  const after = wheatInBarrel();
  assert(after > before, `farmer harvests his field into storage (${before} -> ${after})`);

  // Daily cap must hold
  for (let i = 0; i < 200; i++) prodTick();
  const capped = wheatInBarrel();
  assert(capped - before <= DAILY_CAP["Фермер"],
    `farmer respects the daily cap (${capped - before} <= ${DAILY_CAP["Фермер"]})`);

  // A new in-game day should let him work again
  world._absoluteTime += 24000;
  const beforeDay2 = wheatInBarrel();
  for (let i = 0; i < 5; i++) prodTick();
  assert(wheatInBarrel() > beforeDay2, "farmer resumes work on the next in-game day");
}

// ---------- 5. MINER BALANCE ----------
console.log("\n=== miner balance ===");
{
  const dim2 = __test__.makeDimension();
  const miner = dim2.spawnEntity("minecraft:villager_v2", { x: 90000, y: 70, z: 90000 });
  miner.nameTag = "§bШахтёр§r";
  miner.addTag("village_worker");
  // give him a chest
  const chest = dim2.getBlock({ x: 90001, y: 70, z: 90000 });
  chest.setPermutation({ typeId: "minecraft:chest", states: {} });
  const container = chest.getComponent("minecraft:inventory").container;

  startProductionLoop();
  const tick = system._intervals[system._intervals.length - 1];

  world._absoluteTime += 24000;
  for (let i = 0; i < 500; i++) tick();

  let total = 0;
  const kinds = new Set();
  for (let i = 0; i < container.size; i++) {
    const st = container.getItem(i);
    if (st) { total += st.amount; kinds.add(st.typeId); }
  }
  assert(total > 0, `miner produces something over a day (${total})`);
  assert(total <= DAILY_CAP["Шахтёр"] + 3,
    `miner output stays within the daily cap, so player mining still matters (${total})`);
  assert([...kinds].every((k) => ["minecraft:iron_ingot", "minecraft:gold_ingot", "minecraft:redstone", "minecraft:lapis_lazuli"].includes(k)),
    `miner only yields smelted/refined goods (${[...kinds].join(", ")})`);
  assert(!kinds.has("minecraft:diamond"), "miner never produces diamonds");
}

// ---------- 6. QUEST STORY INTEGRITY ----------
console.log("\n=== quest arcs ===");
{
  const FORBIDDEN_HIGH_TIER = new Set([
    "minecraft:diamond",
    "minecraft:emerald",
    "minecraft:netherite_scrap",
    "minecraft:enchanted_golden_apple",
    "minecraft:diamond_axe",
    "minecraft:diamond_pickaxe",
    "minecraft:diamond_horse_armor",
    "minecraft:heart_of_the_sea",
    "minecraft:potion"
  ]);
  const isVanillaItemId = (itemId) => typeof itemId === "string" && /^minecraft:[a-z0-9_]+$/.test(itemId);
  const professions = Object.keys(QUESTS);
  assert(professions.length === 4, `four quest arcs exist (${professions.length})`);
  for (const prof of professions) {
    const q = QUESTS[prof];
    assert(typeof q.title === "string" && q.title.length > 0, `${prof}: arc has a title ("${q.title}")`);
    assert(q.chain.length === 5, `${prof}: arc has 5 steps`);
    for (const [i, step] of q.chain.entries()) {
      const ordinal = i + 1;
      assert(step.question && step.question.length > 30, `${prof} step ${ordinal}: has a written prompt`);
      assert(isVanillaItemId(step.requiredItem) && step.requiredAmount > 0, `${prof} step ${ordinal}: has a valid vanilla objective`);
      assert(!FORBIDDEN_HIGH_TIER.has(step.requiredItem), `${prof} step ${ordinal}: requirement avoids forbidden high-tier items`);
      assert(step.upgrade?.tier === ordinal, `${prof} step ${ordinal}: has the ordered physical upgrade tier`);
      if (i < 4) {
        assert(step.rewardItem === null && step.rewardAmount === 0, `${prof} step ${ordinal}: is intentionally visual-only with no item reward`);
      } else {
        assert(isVanillaItemId(step.rewardItem) && step.rewardAmount > 0, `${prof} final step: has one configured moderate vanilla utility reward`);
        assert(!FORBIDDEN_HIGH_TIER.has(step.rewardItem), `${prof} final step: reward avoids forbidden high-tier items`);
      }
    }
    assert(q.chain.filter((step) => step.rewardItem !== null || step.rewardAmount !== 0).length === 1,
      `${prof}: has exactly one configured item reward at the final step`);
    const upgrades = q.chain.filter((step) => step.upgrade);
    assert(upgrades.length === 5 && upgrades.every((step, index) => step.upgrade.tier === index + 1),
      `${prof}: has five ordered physical upgrades (tiers 1-5)`);
    assert(LEVELS[q.discountLevel], `${prof}: discount targets a real level (${q.discountLevel})`);
    assert(q.discountLevel in LEVELS && (q.discountItem in LEVELS[q.discountLevel].requirements),
      `${prof}: discount item ${q.discountItem} is actually required at level ${q.discountLevel}`);
  }
}

// ---------- 7. FULL RUN TO MAX LEVEL ----------
console.log("\n=== full progression to level 10 ===");
{
  const player = __test__.makePlayer("FullRun", { x: 100000, y: 70, z: 100000 });
  const elder = foundVillage(player, { x: 100000, y: 70, z: 100000 }, 2);
  const state0 = getVillageState(elder);
  const chestBlock = elder.dimension.getBlock(state0.chest);
  let built = 0;
  const forts = [];

  for (let level = 2; level <= MAX_BETA_LEVEL; level++) {
    const cfg = LEVELS[level];
    const container = chestBlock.getComponent("minecraft:inventory").container;
    let slot = 0;
    for (const [id, count] of Object.entries(cfg.requirements)) {
      container.setItem(slot++, { typeId: id, amount: count });
    }
    const res = tryLevelUp(elder);
    if (res.done && res.leveledUpTo === level) built++;
    if (res.fortified) forts.push(res.fortified);
  }
  assert(built === MAX_BETA_LEVEL - 1, `all ${MAX_BETA_LEVEL - 1} levels build cleanly (${built})`);
  assert(JSON.stringify(forts) === JSON.stringify([TIER_PALISADE, TIER_COBBLE, TIER_CASTLE]),
    `fortifications upgrade palisade -> cobble -> castle (got ${forts.join(",")})`);

  const vTag2 = "village:" + state0.id;
  const workers = elder.dimension.getEntities({ tags: ["village_worker", vTag2] });
  assert(workers.length === 2, `farmer and miner are both working (${workers.length})`);
}

console.log(failures === 0 ? "\nALL FEATURE TESTS PASSED" : `\n${failures} FEATURE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
