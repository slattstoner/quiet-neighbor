import { setBlock, setBlockMulti, toWorld } from "./util.js";
import { prepareSite } from "./terrain.js";
import { paletteMats, farmerPatchOuterEdge } from "./builder.js";
import { writeSign } from "./signboard.js";
import { readFacing, readOrigin, readPaletteId } from "./village_state.js";
import { resolveCraftsmanRole } from "./craftsman_quests.js";

const PLUS_SIDE_COMPASS = ["south", "north", "east", "west"];
const MINUS_SIDE_COMPASS = ["north", "south", "west", "east"];

function elderState(elder) {
  return { origin: readOrigin(elder), facing: readFacing(elder) };
}

function paletteOf(elder) {
  return readPaletteId(elder);
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
function localStair(dimension, origin, facing, f, s, up, typeId, cardinal, upsideDown = false) {
  const p = toWorld(origin, facing, f, s, up);
  setBlockMulti(dimension, p.x, p.y, p.z, typeId, [
    { "minecraft:cardinal_direction": cardinal, "minecraft:vertical_half": upsideDown ? "top" : "bottom" },
    { weirdo_direction: WEIRDO[cardinal], upside_down_bit: upsideDown },
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

/** A simple placard: a fence post topped with a labelled sign. */
function placeYardSign(dimension, origin, facing, f, s, text) {
  const postP = toWorld(origin, facing, f, s, 0);
  setBlock(dimension, postP.x, postP.y, postP.z, "minecraft:oak_fence");
  const signP = toWorld(origin, facing, f, s, 1);
  const cardinal = ["south", "north", "east", "west"][facing];
  setBlockMulti(dimension, signP.x, signP.y, signP.z, "minecraft:standing_sign", [
    { ground_sign_direction: 8, wood_type: "oak" },
    { ground_sign_direction: 8 },
    { "minecraft:cardinal_direction": cardinal },
    {}
  ]);
  writeSign(dimension, signP, [text]);
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

/**
 * An open-fronted run-in shelter: a solid back wall and roof, held up by
 * corner posts on all four corners, with the front left completely open so
 * livestock can walk in and out freely. Used for the cow/pig yards, where
 * the ask is "a fence with an awning on the edge", not a fully enclosed
 * building like the chicken coop.
 */
function buildLeanTo(dimension, origin, facing, f1, f2, sBack, sFront, materials) {
  const height = 3;
  const sMin = Math.min(sBack, sFront), sMax = Math.max(sBack, sFront);
  localBox(dimension, origin, facing, f1, sMin, -1, f2, sMax, -1, materials.foundation);
  for (let up = 0; up < height; up++) {
    localBox(dimension, origin, facing, f1, sBack, up, f2, sBack, up, materials.wall);
  }
  for (const s of [sMin, sMax]) {
    localBox(dimension, origin, facing, f1, s, 0, f1, s, height - 1, materials.corner);
    localBox(dimension, origin, facing, f2, s, 0, f2, s, height - 1, materials.corner);
  }
  localBox(dimension, origin, facing, f1, sMin, height, f2, sMax, height, materials.roofSolid);
  const frontCardinal = sFront > sBack ? PLUS_SIDE_COMPASS[facing] : MINUS_SIDE_COMPASS[facing];
  for (let f = f1; f <= f2; f++) {
    localStair(dimension, origin, facing, f, sFront, height - 1, materials.roofStairs, frontCardinal, true);
  }
  return { f1, f2, sBack, sFront, height };
}

/** Fences a rectangle on all four sides, with a single gate on the wall at `gateS`. */
function fenceYard(dimension, origin, facing, f1, f2, sMin, sMax, fenceType, gateS, gateF = Math.round((f1 + f2) / 2)) {
  for (let f = f1; f <= f2; f++) {
    localBlock(dimension, origin, facing, f, sMin, 0, fenceType);
    localBlock(dimension, origin, facing, f, sMax, 0, fenceType);
  }
  for (let s = sMin; s <= sMax; s++) {
    localBlock(dimension, origin, facing, f1, s, 0, fenceType);
    localBlock(dimension, origin, facing, f2, s, 0, fenceType);
  }
  localBlock(dimension, origin, facing, gateF, gateS, 0, "minecraft:fence_gate");
}

/**
 * Fences three sides of a rectangle, deliberately leaving the wall at
 * `sMin` unbuilt - that side belongs to an adjoining shed's own wall (see
 * buildFarmerCoop), so fencing it again here would just double it up.
 */
function fenceYardOpenNear(dimension, origin, facing, f1, f2, sMin, sMax, fenceType, gateS) {
  for (let f = f1; f <= f2; f++) {
    localBlock(dimension, origin, facing, f, sMax, 0, fenceType);
  }
  for (let s = sMin; s <= sMax; s++) {
    localBlock(dimension, origin, facing, f1, s, 0, fenceType);
    localBlock(dimension, origin, facing, f2, s, 0, fenceType);
  }
  const gateF = Math.round((f1 + f2) / 2);
  localBlock(dimension, origin, facing, gateF, gateS, 0, "minecraft:fence_gate");
}

function spawnAnimals(dimension, origin, facing, animal, spots) {
  for (const [f, s] of spots) {
    try {
      const p = toWorld(origin, facing, f, s, 0);
      dimension.spawnEntity(`minecraft:${animal}`, { x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
    } catch (e) { /* livestock is decorative if the location is unloaded */ }
  }
}

function penMaterials(paletteId) {
  return paletteMats({
    foundation: "minecraft:cobblestone",
    wall: "minecraft:oak_planks",
    corner: "minecraft:oak_log",
    roofSolid: "minecraft:oak_planks",
    roofStairs: "minecraft:oak_stairs"
  }, paletteId);
}

// ---------------------------------------------------------------------
// Farmer backyard geometry
//
// Every farmer quest tier used to compute its own footprint independently
// (a fixed |side| band shared by every animal pen, a forward offset picked
// by hand per tier), and the numbers didn't actually agree with each
// other or with the house: tier 1's field's forward range fully overlapped
// the house itself, and tier 5's "barnyard" forward range overlapped both
// the tier-2 coop and the entire tier-3 cow barn, so finishing a later
// quest silently bulldozed part of an earlier building.
//
// Below, every tier's footprint is derived from the previous one (the
// house's own footprint, then the starter crop patch built with it, then
// each quest tier in turn) via a running "outer edge" - so a later tier
// can only ever start beyond where an earlier one ends, with a fixed grass
// buffer between them. That makes the non-overlap a property of the
// arithmetic instead of something that has to be hand-verified per tier.
// ---------------------------------------------------------------------

const YARD_GAP = 2;               // grass buffer between adjacent yard features
const FIELD_CROP_DEPTH = 4;       // crop rows in the tier-1 field
const FIELD_FORWARD_MARGIN = 2;   // how much wider than the house the big field reads, per end
const PEN_SHELTER_DEPTH = 3;      // covered/enclosed part of a pen, nearer the road
const PEN_YARD_DEPTH = 5;         // open run/pasture part of a pen, further out
const PEN_BAY_WIDTH = 7;          // forward-axis width reserved per pen (5-wide footprint + 2-wide gap)

function dirSign(side) { return side >= 0 ? 1 : -1; }

/** `depth` columns starting `gap` past `base`, continuing further from the road. */
function bandBeyond(side, base, gap, depth) {
  const s = dirSign(side);
  const near = base + s * gap;
  const far = near + s * (depth - 1);
  return { near, far, sMin: Math.min(near, far), sMax: Math.max(near, far) };
}

/** Tier-1 field band, including its own fence line at `near`/`far`. */
function fieldBand(side) {
  return bandBeyond(side, farmerPatchOuterEdge(side), YARD_GAP, FIELD_CROP_DEPTH + 2);
}

/** The single side-axis band shared by all four animal-pen bays (tiers 2-5). */
function penRowBand(side) {
  return bandBeyond(side, fieldBand(side).far, YARD_GAP, PEN_SHELTER_DEPTH + PEN_YARD_DEPTH);
}

/** Splits the pen row into its covered "shelter" half and open "yard" half. */
function penSubBands(side) {
  const row = penRowBand(side);
  const s = dirSign(side);
  const shelterFar = row.near + s * (PEN_SHELTER_DEPTH - 1);
  const yardNear = shelterFar + s;
  return {
    shelter: { near: row.near, far: shelterFar, sMin: Math.min(row.near, shelterFar), sMax: Math.max(row.near, shelterFar) },
    yard: { near: yardNear, far: row.far, sMin: Math.min(yardNear, row.far), sMax: Math.max(yardNear, row.far) }
  };
}

/** Forward-axis slot for pen bay `index` (0=coop, 1=cow, 2=pig, 3=barnyard). */
function penBay(plotForward, index) {
  const f1 = plotForward - FIELD_FORWARD_MARGIN + index * PEN_BAY_WIDTH;
  return { f1, f2: f1 + 4 };
}

/**
 * The three animal pens, and how many head each is meant to hold.
 *
 * The counts are the ones the pens are built with, so "stocked" means the
 * same thing whether a pen was just finished or has been standing for a
 * hundred days. Deliberately small: livestock here is scenery, not
 * production - nothing in production.js looks at an animal, and these
 * numbers must never become a reason for it to.
 */
export const FARM_PENS = Object.freeze([
  Object.freeze({ tier: 2, index: 0, species: "minecraft:chicken", cap: 3, label: "coop" }),
  Object.freeze({ tier: 3, index: 1, species: "minecraft:cow", cap: 2, label: "cow_barn" }),
  Object.freeze({ tier: 4, index: 2, species: "minecraft:pig", cap: 2, label: "pig_pen" })
]);

/**
 * The open yard of one pen, in local coordinates - the part an animal can
 * actually stand in, excluding the roofed shelter band.
 *
 * Exported because the pens are built once, at the moment their quest tier is
 * finished, and the animals put in them then are never replaced: a wolf, a
 * zombie or a long fall used to leave a pen empty for the rest of the world's
 * life. livestock.js needs to know where a pen is to see whether it is still
 * populated, and deriving that from the same penBay/penSubBands the builders
 * use is the only way the two cannot drift apart.
 */
export function penYardBounds(plotForward, side, index) {
  const bay = penBay(plotForward, index);
  const { yard } = penSubBands(side);
  return Object.freeze({
    fMin: Math.min(bay.f1, bay.f2), fMax: Math.max(bay.f1, bay.f2),
    sMin: yard.sMin, sMax: yard.sMax
  });
}

/**
 * The full rectangle (in local coordinates) every farmer quest-upgrade
 * building can land in. Exported so levels.js can protect it from the
 * fortification wall's interior terrain sweep - without this, the sweep
 * (which treats any exposed log as a wild tree trunk) would eventually
 * strip the oak-log corner posts off any pen/lean-to sitting past the
 * generic per-level plot footprint used for every other profession.
 */
export function farmerYardFootprint(plotForward, side) {
  const row = penRowBand(side);
  const lastBay = penBay(plotForward, 3);
  return {
    fMin: plotForward - FIELD_FORWARD_MARGIN - 2,
    fMax: lastBay.f2 + 2,
    sMin: row.sMin,
    sMax: row.sMax
  };
}

/**
 * Tier 1 - "Большое поле". A proper second field, moved well clear of both
 * the house and the starter crop patch built with it, and planted with
 * carrots rather than duplicating the starter patch's wheat: carrots are
 * what the very next step (the chicken coop) asks the player to bring, so
 * the field already reads as feeding into that step.
 */
function buildExpandedField(dimension, origin, facing, plotForward, side, paletteId) {
  const band = fieldBand(side);
  const f1 = plotForward - FIELD_FORWARD_MARGIN, f2 = plotForward + 6 + FIELD_FORWARD_MARGIN;
  prepareUpgradeSite(dimension, origin, facing, f1 - 1, f2 + 1, band.sMin, band.sMax);

  const cMin = band.sMin + 1, cMax = band.sMax - 1;
  localBox(dimension, origin, facing, f1, cMin, -1, f2, cMax, -1, "minecraft:farmland", { moisturized_amount: 7 });
  const waterS = Math.round((cMin + cMax) / 2);
  localBox(dimension, origin, facing, f1, waterS, -1, f2, waterS, -1, "minecraft:water");
  for (let f = f1; f <= f2; f++) {
    for (let s = cMin; s <= cMax; s++) {
      if (s !== waterS) localBlock(dimension, origin, facing, f, s, 0, "minecraft:carrots", { growth: 7 });
    }
  }
  localBlock(dimension, origin, facing, f1 - 1, waterS, -1, "minecraft:cobblestone");
  localBlock(dimension, origin, facing, f2 + 1, waterS, -1, "minecraft:cobblestone");

  fenceYard(dimension, origin, facing, f1 - 1, f2 + 1, band.sMin, band.sMax, "minecraft:oak_fence", band.near);
  placeYardSign(dimension, origin, facing, Math.round((f1 + f2) / 2), band.near - dirSign(side), "Большое поле");
}

/**
 * Tier 2 - "Курятник". A small enclosed coop (nesting hay, one player-sized
 * door) with an attached fenced run: a single ground-level gap in the
 * shared wall lets chickens wander outside, while the run's own outer
 * fence (chickens can't clear a fence or work a gate) keeps them from
 * getting any further than that.
 */
function buildChickenCoop(dimension, origin, facing, plotForward, side, paletteId) {
  const bay = penBay(plotForward, 0);
  const { shelter, yard } = penSubBands(side);
  const mats = penMaterials(paletteId);
  const midF = Math.round((bay.f1 + bay.f2) / 2);

  prepareUpgradeSite(dimension, origin, facing, bay.f1, bay.f2, shelter.sMin, yard.sMax);
  buildShed(dimension, origin, facing, bay.f1, bay.f2, shelter.sMin, shelter.sMax, mats, { f: midF, s: shelter.near });
  // Chicken-sized pass-through between the coop and its run: open at ground
  // level only, too short for the player to use as a second door.
  localBlock(dimension, origin, facing, midF, shelter.far, 0, "minecraft:air");
  fenceYardOpenNear(dimension, origin, facing, bay.f1, bay.f2, yard.sMin, yard.sMax, "minecraft:oak_fence", yard.far);
  localBlock(dimension, origin, facing, bay.f1 + 1, shelter.near, 1, "minecraft:hay_block");
  localBlock(dimension, origin, facing, Math.round((yard.sMin + yard.sMax) / 2), yard.near, 0, "minecraft:hay_block");
  placeYardSign(dimension, origin, facing, midF, shelter.near - dirSign(side), "Курятник");
  spawnAnimals(dimension, origin, facing, "chicken", [
    [bay.f1 + 1, yard.near], [bay.f2 - 1, yard.far], [midF, Math.round((yard.sMin + yard.sMax) / 2)]
  ]);
}

/**
 * Tier 3 - "Коровник", redesigned per the requested layout: not a fully
 * enclosed shed, just a fenced pasture with a run-in lean-to at the near
 * edge, hay bales for decoration, cows, and a gate.
 */
function buildCowBarn(dimension, origin, facing, plotForward, side, paletteId) {
  const bay = penBay(plotForward, 1);
  const { shelter, yard } = penSubBands(side);
  const mats = penMaterials(paletteId);
  const sMin = Math.min(shelter.sMin, yard.sMin), sMax = Math.max(shelter.sMax, yard.sMax);

  prepareUpgradeSite(dimension, origin, facing, bay.f1, bay.f2, sMin, sMax);
  fenceYard(dimension, origin, facing, bay.f1, bay.f2, sMin, sMax, "minecraft:oak_fence", shelter.near, bay.f1);
  buildLeanTo(dimension, origin, facing, bay.f1 + 1, bay.f2 - 1, shelter.near, shelter.far, mats);
  localBlock(dimension, origin, facing, bay.f1 + 1, yard.near, 0, "minecraft:hay_block");
  localBlock(dimension, origin, facing, bay.f2 - 1, yard.far, 0, "minecraft:hay_block");
  placeYardSign(dimension, origin, facing, bay.f1, shelter.near - dirSign(side), "Коровник");
  spawnAnimals(dimension, origin, facing, "cow", [[bay.f1 + 1, yard.far], [bay.f2 - 1, yard.near]]);
}

/**
 * Tier 4 - "Свинарник". Same open-pasture-plus-lean-to language as the cow
 * barn, with a mud wallow in place of hay bales.
 */
function buildPigPen(dimension, origin, facing, plotForward, side, paletteId) {
  const bay = penBay(plotForward, 2);
  const { shelter, yard } = penSubBands(side);
  const mats = penMaterials(paletteId);
  const sMin = Math.min(shelter.sMin, yard.sMin), sMax = Math.max(shelter.sMax, yard.sMax);

  prepareUpgradeSite(dimension, origin, facing, bay.f1, bay.f2, sMin, sMax);
  fenceYard(dimension, origin, facing, bay.f1, bay.f2, sMin, sMax, "minecraft:oak_fence", shelter.near, bay.f1);
  buildLeanTo(dimension, origin, facing, bay.f1 + 1, bay.f2 - 1, shelter.near, shelter.far, mats);
  localBox(dimension, origin, facing, bay.f1 + 1, yard.near, -1, bay.f2 - 1, yard.far, -1, "minecraft:mud");
  placeYardSign(dimension, origin, facing, bay.f1, shelter.near - dirSign(side), "Свинарник");
  spawnAnimals(dimension, origin, facing, "pig", [[bay.f1 + 1, yard.near], [bay.f2 - 1, yard.far]]);
}

/**
 * Tier 5 - "Амбарный двор". The final upgrade is a covered storage/work
 * yard (per the quest's own lore: an awning, barrels, hay, a work area) -
 * deliberately without animals of its own, since the farm's cows/pigs/
 * chickens already live in their own tiers and re-spawning cows here (as
 * the previous version did) both duplicated them and sat this footprint
 * directly on top of the cow barn's.
 */
function buildFarmerBarn(dimension, origin, facing, plotForward, side, paletteId) {
  const bay = penBay(plotForward, 3);
  const { shelter, yard } = penSubBands(side);
  const mats = penMaterials(paletteId);
  const sMin = Math.min(shelter.sMin, yard.sMin), sMax = Math.max(shelter.sMax, yard.sMax);

  prepareUpgradeSite(dimension, origin, facing, bay.f1, bay.f2, sMin, sMax);
  buildLeanTo(dimension, origin, facing, bay.f1, bay.f2, shelter.near, shelter.far, mats);
  localBlock(dimension, origin, facing, bay.f1, Math.round((shelter.near + shelter.far) / 2), 0, "minecraft:barrel");
  localBlock(dimension, origin, facing, bay.f2, Math.round((shelter.near + shelter.far) / 2), 0, "minecraft:barrel");
  localBlock(dimension, origin, facing, Math.round((bay.f1 + bay.f2) / 2), shelter.far, 0, "minecraft:hay_block");
  const workF = Math.round((bay.f1 + bay.f2) / 2);
  localBlock(dimension, origin, facing, workF, yard.near, 0, "minecraft:oak_fence");
  localBlock(dimension, origin, facing, workF, yard.near, 1, "minecraft:wooden_pressure_plate");
  localBlock(dimension, origin, facing, workF, yard.far, 0, "minecraft:composter");
  placeYardSign(dimension, origin, facing, bay.f1, shelter.near - dirSign(side), "Амбарный двор");
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
  // By role id, not by the villager's display name. This used to read
  // `npc.nameTag` and compare it against "Фермер" / "Кузнец" and so on -
  // the same defect production.js had, and with the same consequence:
  // renaming a craftsman, to another language or just another word, silently
  // broke his quest upgrades with no error anywhere. resolveCraftsmanRole
  // prefers the stable `village:roleId` npc.js writes at spawn and only falls
  // back to the name for villagers from worlds saved before it existed.
  const roleId = resolveCraftsmanRole(npc);
  try {
    if (roleId === "farmer") {
      const paletteId = paletteOf(elder);
      if (upgrade.tier === 1) buildExpandedField(npc.dimension, origin, facing, plotForward, side, paletteId);
      else if (upgrade.tier === 2) buildChickenCoop(npc.dimension, origin, facing, plotForward, side, paletteId);
      else if (upgrade.tier === 3) buildCowBarn(npc.dimension, origin, facing, plotForward, side, paletteId);
      else if (upgrade.tier === 4) buildPigPen(npc.dimension, origin, facing, plotForward, side, paletteId);
      else buildFarmerBarn(npc.dimension, origin, facing, plotForward, side, paletteId);
    } else if (roleId === "blacksmith") {
      buildBlacksmithYard(npc.dimension, origin, facing, plotForward, side, upgrade.tier);
    } else if (roleId === "cartographer") {
      buildCartographerArchive(npc.dimension, origin, facing, plotForward, side, upgrade.tier);
    } else if (roleId === "miner") {
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

