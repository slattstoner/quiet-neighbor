import { setBlock, setBlockMulti, toWorld } from "./util.js";
import { prepareSite } from "./terrain.js";

const PLUS_SIDE_COMPASS = ["south", "north", "east", "west"];
const MINUS_SIDE_COMPASS = ["north", "south", "west", "east"];

function elderState(elder) {
  return {
    origin: {
      x: elder.getDynamicProperty("village:originX"),
      y: elder.getDynamicProperty("village:originY"),
      z: elder.getDynamicProperty("village:originZ")
    },
    facing: elder.getDynamicProperty("village:facing")
  };
}

function localBlock(dimension, origin, facing, f, s, up, typeId, states) {
  const p = toWorld(origin, facing, f, s, up);
  setBlock(dimension, p.x, p.y, p.z, typeId, states);
}

function localBox(dimension, origin, facing, f1, s1, u1, f2, s2, u2, typeId, states) {
  for (let f = Math.min(f1, f2); f <= Math.max(f1, f2); f++) {
    for (let s = Math.min(s1, s2); s <= Math.max(s1, s2); s++) {
      for (let up = Math.min(u1, u2); up <= Math.max(u1, u2); up++) {
        localBlock(dimension, origin, facing, f, s, up, typeId, states);
      }
    }
  }
}

const WEIRDO = { west: 0, east: 1, north: 2, south: 3 };
function localStair(dimension, origin, facing, f, s, up, typeId, cardinal) {
  const p = toWorld(origin, facing, f, s, up);
  setBlockMulti(dimension, p.x, p.y, p.z, typeId, [
    { "minecraft:cardinal_direction": cardinal, "minecraft:vertical_half": "bottom" },
    { weirdo_direction: WEIRDO[cardinal], upside_down_bit: false },
    { weirdo_direction: WEIRDO[cardinal] }
  ]);
}

function outerRange(side, near, far) {
  return side >= 0 ? [near, far] : [-far, -near];
}

function prepareUpgradeSite(dimension, origin, facing, f1, f2, s1, s2) {
  prepareSite(dimension, origin, facing, f1, f2, Math.min(s1, s2), Math.max(s1, s2), {
    padding: 1,
    clearHeight: 10,
    fillDepth: 6,
    surfaceBlock: "minecraft:grass_block"
  });
}

/**
 * Builds a small 7×5 workshop shed. Buildings use the same framed, steep
 * roof vocabulary as the village houses, but remain low enough to read as
 * a practical extension rather than a second oversized house.
 */
function buildShed(dimension, origin, facing, f1, f2, s1, s2, materials, doorAt) {
  const sMin = Math.min(s1, s2), sMax = Math.max(s1, s2);
  const height = 4;
  localBox(dimension, origin, facing, f1, sMin, -1, f2, sMax, -1, materials.foundation);
  for (let up = 0; up < height; up++) {
    localBox(dimension, origin, facing, f1, sMin, up, f2, sMin, up, materials.wall);
    localBox(dimension, origin, facing, f1, sMax, up, f2, sMax, up, materials.wall);
    localBox(dimension, origin, facing, f1, sMin, up, f1, sMax, up, materials.wall);
    localBox(dimension, origin, facing, f2, sMin, up, f2, sMax, up, materials.wall);
  }
  for (const f of [f1, f2]) {
    for (const s of [sMin, sMax]) localBox(dimension, origin, facing, f, s, 0, f, s, height - 1, materials.corner);
  }
  localBox(dimension, origin, facing, f1 + 1, sMin + 1, 0, f2 - 1, sMax - 1, height - 1, "minecraft:air");

  if (doorAt) {
    localBlock(dimension, origin, facing, doorAt.f, doorAt.s, 0, "minecraft:air");
    localBlock(dimension, origin, facing, doorAt.f, doorAt.s, 1, "minecraft:air");
    localBlock(dimension, origin, facing, doorAt.f, doorAt.s, 0, "minecraft:fence_gate");
  }

  const baseUp = height;
  const ridgeDist = Math.floor((sMax - sMin) / 2);
  for (let s = sMin; s <= sMax; s++) {
    const dist = Math.min(s - sMin, sMax - s);
    const roofUp = baseUp + dist;
    if (dist === ridgeDist) {
      localBox(dimension, origin, facing, f1, s, roofUp, f2, s, roofUp, materials.roofSolid);
    } else {
      const towardEave = (s - sMin) <= (sMax - s)
        ? MINUS_SIDE_COMPASS[facing] : PLUS_SIDE_COMPASS[facing];
      for (let f = f1; f <= f2; f++) {
        localStair(dimension, origin, facing, f, s, roofUp, materials.roofStairs, towardEave);
      }
    }
  }
  return { f1, f2, sMin, sMax };
}

function buildExpandedField(dimension, origin, facing, plotForward, side) {
  const [sNear, sFar] = outerRange(side, 11, 14);
  const sMin = Math.min(sNear, sFar), sMax = Math.max(sNear, sFar);
  const f1 = plotForward - 2, f2 = plotForward + 6;
  prepareUpgradeSite(dimension, origin, facing, f1 - 1, f2 + 1, sMin - 1, sMax + 1);
  localBox(dimension, origin, facing, f1, sMin, -1, f2, sMax, -1, "minecraft:farmland", { moisturized_amount: 7 });
  const waterS = Math.round((sMin + sMax) / 2);
  localBox(dimension, origin, facing, f1, waterS, -1, f2, waterS, -1, "minecraft:water");
  for (let f = f1; f <= f2; f++) {
    for (let s = sMin; s <= sMax; s++) {
      if (s !== waterS) localBlock(dimension, origin, facing, f, s, 0, "minecraft:wheat", { growth: 3 });
    }
  }
  for (let f = f1 - 1; f <= f2 + 1; f++) {
    localBlock(dimension, origin, facing, f, sMin - 1, 0, "minecraft:oak_fence");
    localBlock(dimension, origin, facing, f, sMax + 1, 0, "minecraft:oak_fence");
  }
  for (let s = sMin - 1; s <= sMax + 1; s++) {
    localBlock(dimension, origin, facing, f1 - 1, s, 0, "minecraft:oak_fence");
    localBlock(dimension, origin, facing, f2 + 1, s, 0, "minecraft:oak_fence");
  }
  localBlock(dimension, origin, facing, Math.round((f1 + f2) / 2), sMin - 1, 0, "minecraft:fence_gate");
}

function buildAnimalPen(dimension, origin, facing, plotForward, side, animal, label) {
  const [sNear, sFar] = outerRange(side, 11, 14);
  const sMin = Math.min(sNear, sFar), sMax = Math.max(sNear, sFar);
  const f1 = plotForward, f2 = plotForward + 4;
  prepareUpgradeSite(dimension, origin, facing, f1, f2, sMin, sMax);
  const pen = buildShed(dimension, origin, facing, f1, f2, sMin, sMax, {
    foundation: "minecraft:cobblestone",
    wall: "minecraft:oak_planks",
    corner: "minecraft:oak_log",
    roofSolid: "minecraft:oak_planks",
    roofStairs: "minecraft:oak_stairs"
  }, { f: Math.round((f1 + f2) / 2), s: side >= 0 ? sMin : sMax });
  localBlock(dimension, origin, facing, f1 + 1, sMin + 1, 0, "minecraft:hay_block");
  localBlock(dimension, origin, facing, f2 - 1, sMax - 1, 0, "minecraft:cauldron");
  localBlock(dimension, origin, facing, f1 + 2, sMin + 1, 1, "minecraft:oak_fence");
  for (const [f, s] of [[f1 + 1, sMin + 2], [f2 - 1, sMax - 2]]) {
    try {
      const p = toWorld(origin, facing, f, s, 0);
      dimension.spawnEntity(`minecraft:${animal}`, { x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
    } catch (e) { /* livestock is decorative if the location is unloaded */ }
  }
  return { ...pen, label };
}

function buildChickenCoop(dimension, origin, facing, plotForward, side) {
  return buildAnimalPen(dimension, origin, facing, plotForward + 5, side, "chicken", "Курятник");
}

function buildCowBarn(dimension, origin, facing, plotForward, side) {
  return buildAnimalPen(dimension, origin, facing, plotForward + 10, side, "cow", "Коровник");
}

function buildPigPen(dimension, origin, facing, plotForward, side) {
  const result = buildAnimalPen(dimension, origin, facing, plotForward + 17, side, "pig", "Свинарник");
  const [sNear, sFar] = outerRange(side, 11, 14);
  const sMin = Math.min(sNear, sFar), sMax = Math.max(sNear, sFar);
  localBlock(dimension, origin, facing, plotForward + 19, Math.round((sMin + sMax) / 2), -1, "minecraft:mud");
  return result;
}

function buildFarmerBarn(dimension, origin, facing, plotForward, side) {
  const [sNear, sFar] = outerRange(side, 11, 14);
  const sMin = Math.min(sNear, sFar), sMax = Math.max(sNear, sFar);
  const f1 = plotForward + 8, f2 = plotForward + 14;
  prepareUpgradeSite(dimension, origin, facing, f1, f2, sMin, sMax);
  const barn = buildShed(dimension, origin, facing, f1, f2, sMin, sMax, {
    foundation: "minecraft:cobblestone",
    wall: "minecraft:oak_planks",
    corner: "minecraft:oak_log",
    roofSolid: "minecraft:oak_planks",
    roofStairs: "minecraft:oak_stairs"
  }, { f: Math.round((f1 + f2) / 2), s: side >= 0 ? sMin : sMax });
  localBlock(dimension, origin, facing, f1 + 1, sMin + 1, 0, "minecraft:barrel");
  localBlock(dimension, origin, facing, f2 - 1, sMax - 1, 0, "minecraft:hay_block");
  localBlock(dimension, origin, facing, Math.round((f1 + f2) / 2), Math.round((sMin + sMax) / 2), 0, "minecraft:cauldron");
  for (const [f, s] of [[f1 + 2, sMin + 2], [f2 - 2, sMax - 2]]) {
    try {
      const p = toWorld(origin, facing, f, s, 0);
      dimension.spawnEntity("minecraft:cow", { x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
    } catch (e) { /* livestock is decorative if the location is unloaded */ }
  }
  return barn;
}

function buildBlacksmithYard(dimension, origin, facing, plotForward, side, tier) {
  const [sNear, sFar] = outerRange(side, 11, 14);
  const sMin = Math.min(sNear, sFar), sMax = Math.max(sNear, sFar);
  const f1 = tier === 1 ? plotForward - 1 : plotForward + (tier - 2) * 7;
  const f2 = f1 + 5;
  prepareUpgradeSite(dimension, origin, facing, f1, f2, sMin, sMax);
  if (tier === 1) {
    localBox(dimension, origin, facing, f1, sMin, -1, f2, sMax, -1, "minecraft:cobblestone");
    localBlock(dimension, origin, facing, f1 + 1, sMin + 1, 0, "minecraft:blast_furnace");
    localBlock(dimension, origin, facing, f1 + 3, sMin + 1, 0, "minecraft:anvil");
    localBlock(dimension, origin, facing, f2 - 1, sMax - 1, 0, "minecraft:grindstone");
    localBox(dimension, origin, facing, f2, sMax, 0, f2, sMax, 5, "minecraft:cobblestone");
    localBlock(dimension, origin, facing, f2, sMax, 6, "minecraft:campfire", { extinguished: false });
  } else {
    buildShed(dimension, origin, facing, f1, f2, sMin, sMax, {
      foundation: "minecraft:cobblestone",
      wall: "minecraft:stone_bricks",
      corner: "minecraft:spruce_log",
      roofSolid: "minecraft:stone_bricks",
      roofStairs: "minecraft:stone_brick_stairs"
    }, { f: Math.round((f1 + f2) / 2), s: side >= 0 ? sMin : sMax });
    localBlock(dimension, origin, facing, f1 + 1, sMin + 1, 0, "minecraft:barrel");
    localBlock(dimension, origin, facing, f2 - 1, sMax - 1, 0, "minecraft:chest");
  }
}

function buildCartographerArchive(dimension, origin, facing, plotForward, side, tier) {
  const [sNear, sFar] = outerRange(side, 11, 14);
  const sMin = Math.min(sNear, sFar), sMax = Math.max(sNear, sFar);
  const f1 = plotForward + (tier - 1) * 7, f2 = f1 + 6;
  prepareUpgradeSite(dimension, origin, facing, f1, f2, sMin, sMax);
  if (tier === 1) {
    localBox(dimension, origin, facing, f1, sMin, -1, f2, sMax, -1, "minecraft:gravel");
    localBlock(dimension, origin, facing, f1 + 2, Math.round((sMin + sMax) / 2), 0, "minecraft:lectern");
    localBlock(dimension, origin, facing, f1 + 4, Math.round((sMin + sMax) / 2), 0, "minecraft:cartography_table");
    localBlock(dimension, origin, facing, f1 + 3, sMax, 1, "minecraft:lantern", { hanging: false });
  } else {
    buildShed(dimension, origin, facing, f1, f2, sMin, sMax, {
      foundation: "minecraft:cobblestone",
      wall: "minecraft:birch_planks",
      corner: "minecraft:birch_log",
      roofSolid: "minecraft:birch_planks",
      roofStairs: "minecraft:birch_stairs"
    }, { f: Math.round((f1 + f2) / 2), s: side >= 0 ? sMin : sMax });
    for (let f = f1 + 1; f <= f2 - 1; f++) localBlock(dimension, origin, facing, f, sMax - 1, 0, "minecraft:bookshelf");
    localBlock(dimension, origin, facing, f1 + 1, sMin + 1, 0, "minecraft:barrel");
  }
}

function buildMinerYard(dimension, origin, facing, plotForward, side, tier) {
  const [sNear, sFar] = outerRange(side, 11, 14);
  const sMin = Math.min(sNear, sFar), sMax = Math.max(sNear, sFar);
  const f1 = plotForward + (tier - 1) * 7, f2 = f1 + 6;
  prepareUpgradeSite(dimension, origin, facing, f1, f2, sMin, sMax);
  if (tier === 1) {
    localBox(dimension, origin, facing, f1, sMin, -1, f2, sMax, -1, "minecraft:gravel");
    localBlock(dimension, origin, facing, f1 + 1, sMin + 1, 0, "minecraft:barrel");
    localBlock(dimension, origin, facing, f1 + 3, sMin + 1, 0, "minecraft:iron_ore");
    localBlock(dimension, origin, facing, f1 + 5, sMax - 1, 0, "minecraft:coal_ore");
    localBlock(dimension, origin, facing, f2 - 1, sMax - 1, 0, "minecraft:blast_furnace");
  } else {
    buildShed(dimension, origin, facing, f1, f2, sMin, sMax, {
      foundation: "minecraft:cobblestone",
      wall: "minecraft:stone_bricks",
      corner: "minecraft:spruce_log",
      roofSolid: "minecraft:cobblestone",
      // "minecraft:cobblestone_stairs" isn't a real Bedrock block id - see
      // the matching fix/comment on MINER_MATS in builder.js.
      roofStairs: "minecraft:stone_stairs"
    }, { f: Math.round((f1 + f2) / 2), s: side >= 0 ? sMin : sMax });
    localBlock(dimension, origin, facing, f1 + 1, sMin + 1, 0, "minecraft:chest");
    localBlock(dimension, origin, facing, f2 - 1, sMax - 1, 0, "minecraft:barrel");
  }
}

/**
 * Applies a one-time physical upgrade after a matching quest step. The NPC
 * stores its own plot coordinates, which keeps the system local to its village
 * and avoids selecting a similarly named villager in another settlement.
 */
export function applyCraftsmanUpgrade(npc, elder, upgrade) {
  if (!npc || !elder || !upgrade) return { ok: false, reason: "missing_context" };
  const current = npc.getDynamicProperty("village:upgradeTier") || 0;
  if (current >= upgrade.tier) return { ok: true, alreadyApplied: true, tier: current };

  const plotForward = npc.getDynamicProperty("village:plotForward");
  const side = npc.getDynamicProperty("village:plotSide");
  if (plotForward === undefined || side === undefined) return { ok: false, reason: "missing_plot" };

  const { origin, facing } = elderState(elder);
  const profession = (npc.nameTag || "").replace(/§./g, "");
  try {
    if (profession === "Фермер") {
      if (upgrade.tier === 1) buildExpandedField(npc.dimension, origin, facing, plotForward, side);
      else if (upgrade.tier === 2) buildChickenCoop(npc.dimension, origin, facing, plotForward, side);
      else if (upgrade.tier === 3) buildCowBarn(npc.dimension, origin, facing, plotForward, side);
      else if (upgrade.tier === 4) buildPigPen(npc.dimension, origin, facing, plotForward, side);
      else buildFarmerBarn(npc.dimension, origin, facing, plotForward, side);
    } else if (profession === "Кузнец") {
      buildBlacksmithYard(npc.dimension, origin, facing, plotForward, side, upgrade.tier);
    } else if (profession === "Картограф") {
      buildCartographerArchive(npc.dimension, origin, facing, plotForward, side, upgrade.tier);
    } else if (profession === "Шахтёр") {
      buildMinerYard(npc.dimension, origin, facing, plotForward, side, upgrade.tier);
    } else {
      return { ok: false, reason: "unknown_profession" };
    }
    npc.setDynamicProperty("village:upgradeTier", upgrade.tier);
    return { ok: true, tier: upgrade.tier, label: upgrade.label };
  } catch (e) {
    console.warn("[village] craftsman upgrade failed: " + e);
    return { ok: false, reason: "build_failed" };
  }
}

export function workerUpgradeTier(worker) {
  return worker?.getDynamicProperty("village:upgradeTier") || 0;
}
