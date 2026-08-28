import { __test__, system, world } from "@minecraft/server";
import { foundVillage, tryLevelUp, getVillageState, refreshSign } from "./scripts/village.js";
import { toWorld } from "./scripts/util.js";
import { LEVELS, MAX_BETA_LEVEL } from "./scripts/levels.js";
import { repairGolem, startTetherLoop, spawnGateGolem, getHome } from "./scripts/npc.js";
import { generateVillageName } from "./scripts/signboard.js";
import { buildPlainHouse, buildFarmerHouse, buildBlacksmithHouse, buildCartographerHouse, buildMinerHouse } from "./scripts/builder.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}
function blockAt(dim, x, y, z) {
  return dim.getBlock({ x, y, z }).typeId;
}

const dim = __test__.makeDimension();

// ---------- 1. GOLEM REPAIR ----------
console.log("\n=== golem repair ===");
{
  const player = __test__.makePlayer("Smith", { x: 200000, y: 70, z: 200000 });
  const golem = spawnGateGolem(dim, { x: 200001, y: 70, z: 200000 }, "testvillage", 10);

  // Wound it
  golem._health.current = 40;

  // No ingot in hand -> refuses, and doesn't heal
  let res = repairGolem(player, golem);
  assert(res.ok === false && res.reason === "no_ingot", "repair refused without an iron ingot");
  assert(golem._health.current === 40, "golem is not healed when the player has no ingot");

  // Give ingots
  const inv = player.getComponent("minecraft:inventory").container;
  inv.setItem(0, { typeId: "minecraft:iron_ingot", amount: 3 });

  res = repairGolem(player, golem);
  assert(res.ok === true, "repair succeeds with an ingot in the inventory");
  assert(golem._health.current === 65, `golem healed by 25 (now ${golem._health.current})`);
  assert(inv.getItem(0).amount === 2, `exactly one ingot was consumed (${inv.getItem(0).amount} left)`);

  // Heal to full, then verify it won't waste ingots
  repairGolem(player, golem);
  repairGolem(player, golem);
  assert(golem._health.current === 100, `golem reaches full health (${golem._health.current})`);
  inv.setItem(0, { typeId: "minecraft:iron_ingot", amount: 5 });
  res = repairGolem(player, golem);
  assert(res.ok === false && res.reason === "already_full", "repair refuses on an undamaged golem");
  assert(inv.getItem(0).amount === 5, "no ingot is wasted on a healthy golem");

  // Never overheals past max
  golem._health.current = 95;
  repairGolem(player, golem);
  assert(golem._health.current === 100, `healing is clamped to max health (${golem._health.current})`);
}

// ---------- 2. GATE SIGNBOARD ----------
console.log("\n=== gate signboard ===");
{
  const names = new Set();
  for (let i = 0; i < 50; i++) names.add(generateVillageName());
  assert(names.size > 5, `village names vary (${names.size} distinct out of 50 rolls)`);

  const player = __test__.makePlayer("SignTester", { x: 210000, y: 70, z: 210000 });
  const elder = foundVillage(player, { x: 210000, y: 70, z: 210000 }, 0);
  const name = elder.getDynamicProperty("village:name");
  assert(typeof name === "string" && name.length > 0, `village was given a name ("${name}")`);

  const signPos = refreshSign(elder);
  const signBlock = blockAt(elder.dimension, signPos.x, signPos.y, signPos.z);
  assert(signBlock.includes("sign"), `a sign block stands by the gate (${signBlock})`);

  const text = __test__.signStore.get(`${signPos.x},${signPos.y},${signPos.z}`);
  assert(!!text, "sign has text written on it");
  assert(text.includes(name), `sign shows the village name (${JSON.stringify(text)})`);
  assert(text.includes("Уровень 1"), "sign shows the current level");

  // After levelling, the board must update
  const state0 = getVillageState(elder);
  const chest = elder.dimension.getBlock(state0.chest).getComponent("minecraft:inventory").container;
  for (let level = 2; level <= 5; level++) {
    const cfg = LEVELS[level];
    let slot = 0;
    for (const [id, count] of Object.entries(cfg.requirements)) {
      chest.setItem(slot++, { typeId: id, amount: count });
    }
    tryLevelUp(elder);
  }
  const pos2 = refreshSign(elder);
  const text2 = __test__.signStore.get(`${pos2.x},${pos2.y},${pos2.z}`);
  assert(text2.includes("Уровень 5"), `sign updates as the village grows (${JSON.stringify(text2)})`);
  assert(text2.includes("Частокол"), "sign reports the fortification tier");
}

// ---------- 3. TETHER IS CONSTANT DAY AND NIGHT (bed-seeking AI can work) ----------
console.log("\n=== tether radius no longer fights vanilla sleep AI ===");
{
  const player = __test__.makePlayer("NightTester", { x: 220000, y: 70, z: 220000 });
  const elder = foundVillage(player, { x: 220000, y: 70, z: 220000 }, 0);
  const state0 = getVillageState(elder);
  const chest = elder.dimension.getBlock(state0.chest).getComponent("minecraft:inventory").container;
  for (let level = 2; level <= 5; level++) {
    const cfg = LEVELS[level];
    let slot = 0;
    for (const [id, count] of Object.entries(cfg.requirements)) {
      chest.setItem(slot++, { typeId: id, amount: count });
    }
    tryLevelUp(elder);
  }

  startTetherLoop();
  const tick = system._intervals[system._intervals.length - 1];
  const vTag = "village:" + state0.id;

  const farmer = elder.dimension.getEntities({ tags: ["village_crafter", vTag] })[0];
  const guard = elder.dimension.getEntities({ tags: ["village_guard", vTag] })[0];
  const golem = elder.dimension.getEntities({ tags: ["village_golem", vTag] })[0];
  assert(!!farmer && !!guard && !!golem, "found a craftsman, a watchman and a golem to test");

  // A villager standing at a point WELL within its radius (like walking
  // from the job site to the bed a few blocks away) must never be yanked,
  // day or night - this is exactly the bug that was reported: the bed
  // sits a few blocks from the spawn point, and a tight night radius
  // pulled the villager back before it ever reached the bed.
  const fHome = getHome(farmer);
  assert(fHome.radius >= 6, `craftsman radius comfortably covers job site and bed (${fHome.radius})`);

  for (const timeOfDay of [6000, 18000, 13500, 22000]) {
    world._timeOfDay = timeOfDay;
    farmer.location = { x: fHome.location.x + 3, y: fHome.location.y, z: fHome.location.z };
    const before = farmer._teleports || 0;
    tick();
    assert((farmer._teleports || 0) === before,
      `craftsman within radius (mid-transit to bed) is not yanked at time ${timeOfDay}`);
  }

  // The tether still works at all when a villager genuinely strays past
  // its radius - this isn't "tether disabled", just "no longer tightened
  // specifically at night". It takes STRIKES_BEFORE_RECALL consecutive
  // over-range checks now (a short grace period so natural AI gets a
  // chance to return on its own first - see npc.js's startTetherLoop for
  // why), so a single stray tick is no longer enough by itself.
  world._timeOfDay = 18000;
  farmer.location = { x: fHome.location.x + fHome.radius + 5, y: fHome.location.y, z: fHome.location.z };
  const before2 = farmer._teleports || 0;
  tick();
  assert((farmer._teleports || 0) === before2, "a single stray tick alone does not yet trigger recall (grace period)");
  tick(); tick();
  assert((farmer._teleports || 0) > before2, "but staying out of range for several consecutive checks still gets it pulled back");

  // Guards and golems hold their posts regardless
  const gHome = getHome(guard);
  guard.location = { x: gHome.location.x + 2.5, y: gHome.location.y, z: gHome.location.z };
  const guardTp = guard._teleports || 0;
  tick();
  assert((guard._teleports || 0) === guardTp, "the watchman keeps his post at night");

  const golHome = getHome(golem);
  golem.location = { x: golHome.location.x + 6, y: golHome.location.y, z: golHome.location.z };
  const golTp = golem._teleports || 0;
  tick();
  assert((golem._teleports || 0) === golTp, "the iron golem still patrols at night");

  world._timeOfDay = 6000;
}

// ---------- 4. INTERIORS ARE FURNISHED AND DISTINCT ----------
console.log("\n=== interiors ===");
{
  const houses = [
    { name: "жилой дом", fn: (o) => buildPlainHouse(dim, o, 0, 0, -1), origin: { x: 230000, y: 70, z: 0 } },
    { name: "дом фермера", fn: (o) => buildFarmerHouse(dim, o, 0, 0, -1), origin: { x: 231000, y: 70, z: 0 } },
    { name: "кузница", fn: (o) => buildBlacksmithHouse(dim, o, 0, 0, 1), origin: { x: 232000, y: 70, z: 0 } },
    { name: "дом картографа", fn: (o) => buildCartographerHouse(dim, o, 0, 0, -1), origin: { x: 233000, y: 70, z: 0 } },
    { name: "дом шахтёра", fn: (o) => buildMinerHouse(dim, o, 0, 0, 1), origin: { x: 234000, y: 70, z: 0 } }
  ];

  const signatures = {};
  for (const h of houses) {
    const shape = h.fn(h.origin);
    const contents = new Set();
    let furnitureCount = 0;
    for (let f = shape.f1 + 1; f <= shape.f2 - 1; f++) {
      for (let s = shape.sMin + 1; s <= shape.sMax - 1; s++) {
        for (let up = 0; up <= shape.height - 2; up++) {
          const p = toWorld(h.origin, 0, f, s, up);
          const t = blockAt(dim, p.x, p.y, p.z);
          if (t === "minecraft:air") continue;
          contents.add(t);
          furnitureCount++;
        }
      }
    }
    signatures[h.name] = contents;
    assert(furnitureCount >= 8, `${h.name}: interior is properly furnished (${furnitureCount} pieces)`);
    // must have somewhere to sleep and somewhere to store things
    const hasBed = [...contents].some((t) => t.includes("bed"));
    const hasStore = [...contents].some((t) => t.includes("chest") || t.includes("barrel"));
    assert(hasBed, `${h.name}: has a bed`);
    assert(hasStore, `${h.name}: has storage`);
    const hasLight = [...contents].some((t) => t.includes("lantern") || t.includes("torch") || t.includes("campfire"));
    assert(hasLight, `${h.name}: is lit inside (no mob spawns)`);
  }

  // Each profession's room should look different from a plain house
  const plain = signatures["жилой дом"];
  for (const name of ["дом фермера", "кузница", "дом картографа", "дом шахтёра"]) {
    const unique = [...signatures[name]].filter((t) => !plain.has(t));
    assert(unique.length >= 2, `${name}: reads distinctly from a plain house (${unique.length} unique fittings)`);
  }
}

// ---------- 5. MINE HEAD SITS ON THE PLOT, NOT IN THE STREET ----------
console.log("\n=== miner's mine head placement ===");
{
  const origin = { x: 240000, y: 70, z: 0 };
  const shape = buildMinerHouse(dim, origin, 0, 12, -1);

  // The street runs at side -1..1 - nothing from the mine may intrude there
  let intrusions = 0;
  for (let f = shape.f1 - 2; f <= shape.f2 + 6; f++) {
    for (let s = -1; s <= 1; s++) {
      for (let up = 0; up <= 4; up++) {
        const p = toWorld(origin, 0, f, s, up);
        if (blockAt(dim, p.x, p.y, p.z) !== "minecraft:air") intrusions++;
      }
    }
  }
  assert(intrusions === 0, `mine head never spills into the street (${intrusions} blocks in the road)`);

  // The shaft must actually be a shaft: open, ladder-lined, with a floor
  let ladders = 0;
  for (let d = 1; d <= 8; d++) {
    for (let f = shape.f1; f <= shape.f2 + 6; f++) {
      for (let s = -14; s <= 14; s++) {
        const p = toWorld(origin, 0, f, s, -d);
        if (blockAt(dim, p.x, p.y, p.z) === "minecraft:ladder") ladders++;
      }
    }
  }
  assert(ladders >= 6, `the shaft is climbable (${ladders} ladder rungs)`);

  // And it must stay inside the perimeter wall (|side| < 15)
  let outOfBounds = 0;
  for (let f = shape.f1 - 2; f <= shape.f2 + 6; f++) {
    for (const s of [-15, 15]) {
      for (let up = 0; up <= 4; up++) {
        const p = toWorld(origin, 0, f, s, up);
        if (blockAt(dim, p.x, p.y, p.z) !== "minecraft:air") outOfBounds++;
      }
    }
  }
  assert(outOfBounds === 0, `mine head stays inside the future wall line (${outOfBounds})`);
}

console.log(failures === 0 ? "\nALL POLISH TESTS PASSED" : `\n${failures} POLISH TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
