import { ItemStack } from "@minecraft/server";
import { toWorld, setBlock, setBlockMulti, VILLAGER_TYPE, ADULT_SPAWN_OPTIONS } from "./util.js";
import { prepareSite, sampleGroundLevel, withLoadedArea } from "./terrain.js";

const SPECIAL_BUILDINGS = {
  alchemist: { label: "Домик алхимика", forward: 50, side: 8, profession: "Алхимик", tag: "village_alchemist" },
  oldtimer: { label: "Домик старожилы", forward: 48, side: -12, profession: "Старожила", tag: "village_oldtimer" },
  ranger: { label: "Дом хранителя леса", forward: 60, side: 8, profession: "Лесничий", tag: "village_ranger" },
  healer: { label: "Лазарет милосердия", forward: 60, side: -8, profession: "Лекарь", tag: "village_healer" },
  engineer: { label: "Дом мастера механизмов", forward: 55, side: 8, profession: "Инженер", tag: "village_engineer" }
};

const PLUS_SIDE = ["south", "north", "east", "west"];
const MINUS_SIDE = ["north", "south", "west", "east"];

const COLORS = {
  alchemist: "§d",
  oldtimer: "§6",
  ranger: "§2",
  healer: "§c",
  engineer: "§b"
};

function cleanName(text) {
  return (text || "").replace(/§./g, "");
}

function local(dimension, origin, facing, f, s, up, typeId, states) {
  const p = toWorld(origin, facing, f, s, up);
  return setBlock(dimension, p.x, p.y, p.z, typeId, states);
}

function localMulti(dimension, origin, facing, f, s, up, typeId, candidates) {
  const p = toWorld(origin, facing, f, s, up);
  return setBlockMulti(dimension, p.x, p.y, p.z, typeId, candidates);
}

function box(dimension, origin, facing, f1, s1, u1, f2, s2, u2, typeId, states) {
  for (let f = Math.min(f1, f2); f <= Math.max(f1, f2); f++) {
    for (let s = Math.min(s1, s2); s <= Math.max(s1, s2); s++) {
      for (let up = Math.min(u1, u2); up <= Math.max(u1, u2); up++) {
        local(dimension, origin, facing, f, s, up, typeId, states);
      }
    }
  }
}

function shed(dimension, origin, facing, centerF, centerS, materials, furniture) {
  const f1 = centerF - 2, f2 = centerF + 2;
  const s1 = centerS - 2, s2 = centerS + 2;
  box(dimension, origin, facing, f1, s1, -1, f2, s2, -1, materials.foundation);
  box(dimension, origin, facing, f1, s1, 0, f2, s2, 0, materials.foundation);
  for (let up = 1; up <= 4; up++) {
    box(dimension, origin, facing, f1, s1, up, f2, s1, up, materials.wall);
    box(dimension, origin, facing, f1, s2, up, f2, s2, up, materials.wall);
    box(dimension, origin, facing, f1, s1, up, f1, s2, up, materials.wall);
    box(dimension, origin, facing, f2, s1, up, f2, s2, up, materials.wall);
  }
  for (const f of [f1, f2]) for (const s of [s1, s2]) {
    box(dimension, origin, facing, f, s, 0, f, s, 4, materials.corner);
  }
  box(dimension, origin, facing, f1 + 1, s1 + 1, 0, f2 - 1, s2 - 1, 3, "minecraft:air");

  // Door faces toward the road (toward decreasing side for the positive plot).
  const doorS = centerS >= 0 ? s1 : s2;
  const doorCardinal = centerS >= 0 ? MINUS_SIDE[facing] : PLUS_SIDE[facing];
  local(dimension, origin, facing, centerF, doorS, 0, "minecraft:air");
  local(dimension, origin, facing, centerF, doorS, 1, "minecraft:air");
  localMulti(dimension, origin, facing, centerF, doorS, 0, "minecraft:wooden_door", [
    { "minecraft:cardinal_direction": doorCardinal, upper_block_bit: false, open_bit: false, door_hinge_bit: false },
    { direction: ["south", "west", "north", "east"].indexOf(doorCardinal), upper_block_bit: false, open_bit: false, door_hinge_bit: false }
  ]);
  localMulti(dimension, origin, facing, centerF, doorS, 1, "minecraft:wooden_door", [
    { "minecraft:cardinal_direction": doorCardinal, upper_block_bit: true, open_bit: false, door_hinge_bit: false },
    { upper_block_bit: true }
  ]);
  local(dimension, origin, facing, centerF, centerS >= 0 ? doorS - 1 : doorS + 1, -1, materials.foundation);

  // Low pitched roof: a solid cap plus stepped eaves. Keeping the roof simple here
  // makes special buildings independent from the active roof-fix branch.
  box(dimension, origin, facing, f1, s1, 5, f2, s2, 5, materials.roof);
  box(dimension, origin, facing, f1 - 1, s1 - 1, 5, f2 + 1, s2 + 1, 5, materials.roof);
  box(dimension, origin, facing, f1 + 1, s1 + 1, 6, f2 - 1, s2 - 1, 6, materials.roof);

  for (const item of furniture || []) local(dimension, origin, facing, item.f, item.s, item.up || 0, item.typeId, item.states);
  return { f1, f2, s1, s2, door: { f: centerF, s: doorS, up: 0 }, centerF, centerS };
}

function buildAlchemist(dimension, origin, facing) {
  const shape = shed(dimension, origin, facing, 50, 8,
    { foundation: "minecraft:stone_bricks", wall: "minecraft:purple_terracotta", corner: "minecraft:dark_oak_log", roof: "minecraft:dark_oak_planks" },
    [
      { f: 49, s: 7, typeId: "minecraft:brewing_stand" },
      { f: 51, s: 7, typeId: "minecraft:cauldron" },
      { f: 49, s: 9, typeId: "minecraft:barrel" },
      { f: 51, s: 9, typeId: "minecraft:chest" },
      { f: 50, s: 10, typeId: "minecraft:flower_pot" }
    ]);
  return { ...shape, building: "alchemist" };
}

function buildOldtimer(dimension, origin, facing) {
  const shape = shed(dimension, origin, facing, 48, -12,
    { foundation: "minecraft:stone_bricks", wall: "minecraft:spruce_planks", corner: "minecraft:spruce_log", roof: "minecraft:spruce_planks" },
    [
      { f: 47, s: -11, typeId: "minecraft:lectern" },
      { f: 49, s: -11, typeId: "minecraft:bookshelf" },
      { f: 47, s: -13, typeId: "minecraft:chest" },
      { f: 49, s: -13, typeId: "minecraft:bell", states: { attachment: "standing", "minecraft:cardinal_direction": "south" } },
      { f: 48, s: -14, typeId: "minecraft:cartography_table" }
    ]);
  return { ...shape, building: "oldtimer" };
}

function buildRanger(dimension, origin, facing) {
  const shape = shed(dimension, origin, facing, 60, 8,
    { foundation: "minecraft:cobblestone", wall: "minecraft:oak_planks", corner: "minecraft:spruce_log", roof: "minecraft:oak_planks" },
    [
      { f: 59, s: 7, typeId: "minecraft:composter" },
      { f: 61, s: 7, typeId: "minecraft:barrel" },
      { f: 59, s: 9, typeId: "minecraft:chest" },
      { f: 61, s: 9, typeId: "minecraft:oak_fence" },
      { f: 60, s: 10, typeId: "minecraft:campfire", states: { extinguished: false } }
    ]);
  for (let f = 58; f <= 62; f++) local(dimension, origin, facing, f, 11, 0, "minecraft:oak_sapling");
  return { ...shape, building: "ranger" };
}

function buildHealer(dimension, origin, facing) {
  const shape = shed(dimension, origin, facing, 60, -8,
    { foundation: "minecraft:quartz_block", wall: "minecraft:white_wool", corner: "minecraft:birch_log", roof: "minecraft:red_wool" },
    [
      { f: 58, s: -7, typeId: "minecraft:brewing_stand" },
      { f: 62, s: -7, typeId: "minecraft:cauldron" },
      { f: 58, s: -9, typeId: "minecraft:chest" },
      { f: 62, s: -9, typeId: "minecraft:bed" },
      { f: 60, s: -10, typeId: "minecraft:flower_pot" }
    ]);
  return { ...shape, building: "healer" };
}

function buildEngineer(dimension, origin, facing) {
  const shape = shed(dimension, origin, facing, 55, 8,
    { foundation: "minecraft:stone_bricks", wall: "minecraft:brick_block", corner: "minecraft:iron_block", roof: "minecraft:copper_block" },
    [
      { f: 54, s: 7, typeId: "minecraft:redstone_lamp" },
      { f: 56, s: 7, typeId: "minecraft:crafting_table" },
      { f: 54, s: 9, typeId: "minecraft:barrel" },
      { f: 56, s: 9, typeId: "minecraft:lever" },
      { f: 55, s: 10, typeId: "minecraft:observer" }
    ]);
  return { ...shape, building: "engineer" };
}

const BUILDERS = { alchemist: buildAlchemist, oldtimer: buildOldtimer, ranger: buildRanger, healer: buildHealer, engineer: buildEngineer };

export function specialBuildingSpec(key) { return SPECIAL_BUILDINGS[key] || null; }

export function buildSpecialBuilding(key, dimension, state) {
  const builder = BUILDERS[key];
  const spec = SPECIAL_BUILDINGS[key];
  if (!builder || !spec || !dimension || !state) return { ok: false, reason: "unknown_building" };
  if (state.elder?.getDynamicProperty(`village:specialBuilt:${key}`)) return { ok: true, alreadyBuilt: true };
  try {
    // These sheds sit far down the street (forward 48-60) - past the core
    // platform prepareSite() levelled at founding, and past the wall
    // perimeter for some of them. shed() only ever draws its own fixed 5x5
    // footprint; it never levelled the ground under itself first, so it
    // built at the village's flat reference height regardless of what the
    // real terrain there looked like - floating over a dip, or half-buried
    // in a rise. Level the same way every other building on the street
    // already does before handing off to the builder.
    const footprint = { fMin: spec.forward - 6, fMax: spec.forward + 6, sMin: spec.side - 6, sMax: spec.side + 6 };
    withLoadedArea(dimension, state.origin, state.facing, footprint, () => {
      const sample = sampleGroundLevel(dimension, state.origin, state.facing,
        footprint.fMin, footprint.fMax, footprint.sMin, footprint.sMax);
      prepareSite(dimension, state.origin, state.facing,
        spec.forward - 4, spec.forward + 4, spec.side - 5, spec.side + 5, {
          padding: 0,
          clearHeight: 9,
          fillDepth: 6,
          surfaceBlock: "minecraft:grass_block",
          surfaceType: sample.surfaceType
        });
    });
    const shape = builder(dimension, state.origin, state.facing);
    if (state.elder) state.elder.setDynamicProperty(`village:specialBuilt:${key}`, true);
    return { ok: true, key, shape, label: SPECIAL_BUILDINGS[key].label };
  } catch (error) {
    console.warn(`[village] special building ${key} failed: ${error}`);
    return { ok: false, reason: "build_failed" };
  }
}

export function spawnSpecialResident(key, dimension, location, villageId) {
  const spec = specialBuildingSpec(key);
  if (!spec || !dimension) return null;
  const npc = dimension.spawnEntity(VILLAGER_TYPE, location, ADULT_SPAWN_OPTIONS);
  npc.nameTag = `${COLORS[key] || "§f"}${spec.profession}§r`;
  npc.addTag(`village:${villageId}`);
  npc.addTag("village_npc");
  npc.addTag("village_specialist");
  npc.addTag(spec.tag);
  npc.setDynamicProperty("village:specialKey", key);
  return npc;
}

export const ALCHEMIST_PRODUCTS = [
  { id: "minecraft:potion", amount: 1, cost: 4, label: "Зелье лечения", ingredient: "minecraft:glass_bottle" },
  { id: "minecraft:potion", amount: 1, cost: 6, label: "Зелье ночного зрения", ingredient: "minecraft:glass_bottle" },
  { id: "minecraft:glass_bottle", amount: 3, cost: 1, label: "Три стеклянные бутылки" },
  { id: "minecraft:fermented_spider_eye", amount: 1, cost: 3, label: "Ферментированный паучий глаз" },
  { id: "minecraft:glowstone_dust", amount: 2, cost: 3, label: "Светокаменная пыль" }
];

export function giveProduct(player, product) {
  const inventory = player?.getComponent("minecraft:inventory")?.container;
  if (!inventory || !product) return { ok: false, reason: "no_inventory" };
  let emeralds = 0;
  for (let i = 0; i < inventory.size; i++) {
    const stack = inventory.getItem(i);
    if (stack?.typeId === "minecraft:emerald") emeralds += stack.amount;
  }
  if (emeralds < product.cost) return { ok: false, reason: "not_enough_emeralds", need: product.cost };
  if (product.ingredient) {
    let hasIngredient = false;
    for (let i = 0; i < inventory.size; i++) {
      if (inventory.getItem(i)?.typeId === product.ingredient) { hasIngredient = true; break; }
    }
    if (!hasIngredient) return { ok: false, reason: "missing_ingredient", ingredient: product.ingredient };
  }
  let remaining = product.cost;
  for (let i = 0; i < inventory.size && remaining > 0; i++) {
    const stack = inventory.getItem(i);
    if (!stack || stack.typeId !== "minecraft:emerald") continue;
    const take = Math.min(remaining, stack.amount);
    remaining -= take;
    if (take >= stack.amount) inventory.setItem(i, undefined);
    else { stack.amount -= take; inventory.setItem(i, stack); }
  }
  if (product.ingredient) {
    for (let i = 0; i < inventory.size; i++) {
      const stack = inventory.getItem(i);
      if (!stack || stack.typeId !== product.ingredient) continue;
      if (stack.amount <= 1) inventory.setItem(i, undefined);
      else { stack.amount -= 1; inventory.setItem(i, stack); }
      break;
    }
  }
  inventory.addItem(new ItemStack(product.id, product.amount));
  return { ok: true, product };
}

export { SPECIAL_BUILDINGS };
