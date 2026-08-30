import { ItemStack } from "@minecraft/server";
import { toWorld, setBlock, setBlockMulti, VILLAGER_TYPE, ADULT_SPAWN_OPTIONS } from "./util.js";
import { prepareSite, sampleGroundLevel, withLoadedArea } from "./terrain.js";

/**
 * Special buildings sit on their own plots INSIDE the village, in the
 * outer quadrants behind the street's house row.
 *
 * They used to be strung out along the street at forward 48-60, which put
 * every one of them past the wall ring (radius 48) - the old-timer's house
 * ended up embedded in the palisade itself, out on the village edge rather
 * than among the other houses. The numbered levels claim forward -28..47 in
 * a band of |side| <= 14 either side of the road (see plotFootprint), so
 * the free ground inside the wall is the |side| 18..47 quadrants; each shed
 * gets a plot there, one per quadrant plus one beside the town hall, all
 * comfortably clear of the house row, the road corridor and the wall.
 *
 * `unlockLevel` is the village level at which the building can first
 * appear. builtPlotFootprints() uses it to start protecting the plot from
 * the fortification interior sweep at the right moment - late enough that
 * the ground still gets flattened with the rest of the village first, early
 * enough that no later wall tier can bulldoze a shed already standing on it
 * (the sheds' log corner posts read as tree trunks to that sweep).
 */
const SPECIAL_BUILDINGS = {
  alchemist: { label: "Домик алхимика", forward: 14, side: 24, profession: "Алхимик", tag: "village_alchemist", unlockLevel: 6 },
  oldtimer: { label: "Домик старожилы", forward: 0, side: -24, profession: "Старожила", tag: "village_oldtimer", unlockLevel: 8 },
  ranger: { label: "Дом хранителя леса", forward: -14, side: 24, profession: "Лесничий", tag: "village_ranger", unlockLevel: 8 },
  healer: { label: "Лазарет милосердия", forward: -14, side: -24, profession: "Лекарь", tag: "village_healer", unlockLevel: 8 },
  engineer: { label: "Дом мастера механизмов", forward: 14, side: -24, profession: "Инженер", tag: "village_engineer", unlockLevel: 8 }
};

/**
 * Crossroads plots for the same five sheds.
 *
 * Their legacy plots assume one street and two empty quadrants: on the
 * crossroads the old-timer's shed (forward 0) would straddle the side road,
 * the ranger's would land inside the level-5 ward plot and the engineer's
 * inside the farmer's yard. These plots put each shed in genuinely free
 * ground in its own corner of the crossroads, still well inside the R44
 * palisade that stands when the first of them unlocks.
 */
const V2_SPECIAL_PLOTS = Object.freeze({
  alchemist: Object.freeze({ forward: 6, side: 22 }),
  oldtimer: Object.freeze({ forward: -6, side: -22 }),
  ranger: Object.freeze({ forward: -30, side: 26 }),
  healer: Object.freeze({ forward: 6, side: 34 }),
  engineer: Object.freeze({ forward: -6, side: -34 })
});

const LAYOUT_V2 = 2;

/** Where a shed stands, for the village's layout version. */
export function specialPlacement(key, layoutVersion) {
  const spec = SPECIAL_BUILDINGS[key];
  if (!spec) return null;
  const v2 = layoutVersion === LAYOUT_V2 ? V2_SPECIAL_PLOTS[key] : null;
  return { forward: v2 ? v2.forward : spec.forward, side: v2 ? v2.side : spec.side };
}

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

/**
 * Turns the five interior fittings into absolute local coordinates for a
 * shed centred anywhere. The shed's hollow interior is only 3x3 (see
 * shed()'s air box), so the first four sit in its interior corners and the
 * fifth against the wall opposite the door - which is the side away from
 * the street, i.e. the sign of `centerS`.
 *
 * Previously every builder spelled its furniture out in absolute
 * coordinates tied to one hard-coded plot, so a fitting could not follow
 * the building when the plot moved; two of them (the healer's and every
 * shed's fifth item) were also written at +/-2 from the centre, which is
 * the wall line rather than the interior, and so punched a hole in the
 * shed's own wall instead of furnishing it.
 */
function furnish(centerF, centerS, fittings) {
  const away = centerS >= 0 ? 1 : -1;
  const spots = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, away]];
  return fittings.map((fitting, i) => ({
    f: centerF + spots[i][0],
    s: centerS + spots[i][1],
    typeId: fitting.typeId,
    states: fitting.states
  }));
}

function shedAt(key, dimension, origin, facing, materials, fittings, layoutVersion) {
  const at = specialPlacement(key, layoutVersion);
  const shape = shed(dimension, origin, facing, at.forward, at.side,
    materials, furnish(at.forward, at.side, fittings));
  return { ...shape, building: key };
}

function buildAlchemist(dimension, origin, facing, layoutVersion) {
  return shedAt("alchemist", dimension, origin, facing,
    { foundation: "minecraft:stone_bricks", wall: "minecraft:purple_terracotta", corner: "minecraft:dark_oak_log", roof: "minecraft:dark_oak_planks" },
    [
      { typeId: "minecraft:brewing_stand" },
      { typeId: "minecraft:cauldron" },
      { typeId: "minecraft:barrel" },
      { typeId: "minecraft:chest" },
      { typeId: "minecraft:flower_pot" }
    ], layoutVersion);
}

function buildOldtimer(dimension, origin, facing, layoutVersion) {
  return shedAt("oldtimer", dimension, origin, facing,
    { foundation: "minecraft:stone_bricks", wall: "minecraft:spruce_planks", corner: "minecraft:spruce_log", roof: "minecraft:spruce_planks" },
    [
      { typeId: "minecraft:lectern" },
      { typeId: "minecraft:bookshelf" },
      { typeId: "minecraft:chest" },
      { typeId: "minecraft:bell", states: { attachment: "standing", "minecraft:cardinal_direction": "south" } },
      { typeId: "minecraft:cartography_table" }
    ], layoutVersion);
}

function buildRanger(dimension, origin, facing, layoutVersion) {
  const shape = shedAt("ranger", dimension, origin, facing,
    { foundation: "minecraft:cobblestone", wall: "minecraft:oak_planks", corner: "minecraft:spruce_log", roof: "minecraft:oak_planks" },
    [
      { typeId: "minecraft:composter" },
      { typeId: "minecraft:barrel" },
      { typeId: "minecraft:chest" },
      { typeId: "minecraft:oak_fence" },
      { typeId: "minecraft:campfire", states: { extinguished: false } }
    ], layoutVersion);
  // A row of saplings just outside the shed, on the side away from the road.
  const nurseryS = shape.centerS + (shape.centerS >= 0 ? 3 : -3);
  for (let df = -2; df <= 2; df++) {
    local(dimension, origin, facing, shape.centerF + df, nurseryS, 0, "minecraft:oak_sapling");
  }
  return shape;
}

function buildHealer(dimension, origin, facing, layoutVersion) {
  return shedAt("healer", dimension, origin, facing,
    { foundation: "minecraft:quartz_block", wall: "minecraft:white_wool", corner: "minecraft:birch_log", roof: "minecraft:red_wool" },
    [
      { typeId: "minecraft:brewing_stand" },
      { typeId: "minecraft:cauldron" },
      { typeId: "minecraft:chest" },
      { typeId: "minecraft:bed" },
      { typeId: "minecraft:flower_pot" }
    ], layoutVersion);
}

function buildEngineer(dimension, origin, facing, layoutVersion) {
  return shedAt("engineer", dimension, origin, facing,
    { foundation: "minecraft:stone_bricks", wall: "minecraft:brick_block", corner: "minecraft:iron_block", roof: "minecraft:copper_block" },
    [
      { typeId: "minecraft:redstone_lamp" },
      { typeId: "minecraft:crafting_table" },
      { typeId: "minecraft:barrel" },
      { typeId: "minecraft:lever" },
      { typeId: "minecraft:observer" }
    ], layoutVersion);
}

const BUILDERS = { alchemist: buildAlchemist, oldtimer: buildOldtimer, ranger: buildRanger, healer: buildHealer, engineer: buildEngineer };

/**
 * The plot each special building claims, in the same local f/s coordinates
 * levels.js uses for house plots. Matches the footprint
 * buildSpecialBuilding() levels before building (spec.forward/side +/- 6).
 */
function specialFootprint(key, layoutVersion) {
  const spec = SPECIAL_BUILDINGS[key];
  const at = specialPlacement(key, layoutVersion);
  if (!spec || !at) return null;
  return {
    fMin: at.forward - 6, fMax: at.forward + 6,
    sMin: at.side - 6, sMax: at.side + 6,
    unlockLevel: spec.unlockLevel
  };
}

/** Every special plot unlocked at or below `uptoLevel`. */
export function specialFootprintsUpTo(uptoLevel, layoutVersion) {
  return Object.keys(SPECIAL_BUILDINGS)
    .map((key) => specialFootprint(key, layoutVersion))
    .filter((rect) => rect && uptoLevel >= rect.unlockLevel);
}

export function specialBuildingSpec(key) { return SPECIAL_BUILDINGS[key] || null; }

export function buildSpecialBuilding(key, dimension, state) {
  const builder = BUILDERS[key];
  const spec = SPECIAL_BUILDINGS[key];
  if (!builder || !spec || !dimension || !state) return { ok: false, reason: "unknown_building" };
  const layoutVersion = state.layoutVersion;
  const at = specialPlacement(key, layoutVersion);
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
    const footprint = { fMin: at.forward - 6, fMax: at.forward + 6, sMin: at.side - 6, sMax: at.side + 6 };
    withLoadedArea(dimension, state.origin, state.facing, footprint, () => {
      const sample = sampleGroundLevel(dimension, state.origin, state.facing,
        footprint.fMin, footprint.fMax, footprint.sMin, footprint.sMax);
      prepareSite(dimension, state.origin, state.facing,
        at.forward - 4, at.forward + 4, at.side - 5, at.side + 5, {
          padding: 0,
          clearHeight: 9,
          fillDepth: 6,
          surfaceBlock: "minecraft:grass_block",
          surfaceType: sample.surfaceType
        });
    });
    const shape = builder(dimension, state.origin, state.facing, layoutVersion);
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
