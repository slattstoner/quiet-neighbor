import { setBlock, setBlockMulti, fillBox, toWorld, CARDINAL_NAMES, FACING_DIRECTION, oppositeCardinal } from "./util.js";
import { paletteById } from "./palettes.js";

/**
 * Local coordinate system used by every building function:
 *   forward = distance down the main street from the town hall
 *   side    = perpendicular offset (negative = left plot, positive = right)
 *   up      = height above the street surface
 */
function makePlacer(dimension, origin, facing) {
  return {
    facing,
    dimension,
    origin,
    block(forward, side, up, typeId, states) {
      const p = toWorld(origin, facing, forward, side, up);
      setBlock(dimension, p.x, p.y, p.z, typeId, states);
    },
    /** Places a block trying multiple block-state schemes (version safety). */
    blockMulti(forward, side, up, typeId, candidates) {
      const p = toWorld(origin, facing, forward, side, up);
      setBlockMulti(dimension, p.x, p.y, p.z, typeId, candidates);
    },
    box(f1, s1, u1, f2, s2, u2, typeId, states) {
      const a = toWorld(origin, facing, f1, s1, u1);
      const b = toWorld(origin, facing, f2, s2, u2);
      fillBox(dimension, a.x, a.y, a.z, b.x, b.y, b.z, typeId, states);
    }
  };
}

// Which compass direction "increasing side" points to, per village facing (0=+X,1=-X,2=+Z,3=-Z)
const PLUS_SIDE_COMPASS = ["south", "north", "east", "west"];
const MINUS_SIDE_COMPASS = ["north", "south", "west", "east"];
// Which compass direction "increasing forward" points to
const PLUS_FORWARD_COMPASS = ["east", "west", "south", "north"];
const MINUS_FORWARD_COMPASS = ["west", "east", "north", "south"];

function dirIndex(cardinal) {
  return CARDINAL_NAMES.indexOf(cardinal);
}

/**
 * Places a stair block sloping toward `cardinal`, trying each known
 * block-state scheme so it survives Mojang's state renames.
 */
function stairs(placer, f, s, up, typeId, cardinal, upsideDown) {
  const idx = dirIndex(cardinal);
  placer.blockMulti(f, s, up, typeId, [
    { "minecraft:cardinal_direction": cardinal, "minecraft:vertical_half": upsideDown ? "top" : "bottom" },
    { weirdo_direction: WEIRDO[cardinal], upside_down_bit: !!upsideDown },
    { weirdo_direction: WEIRDO[cardinal] },
    { direction: idx }
  ]);
}
// Bedrock's legacy stair values are easy to invert: 0=W, 1=E, 2=N, 3=S.
// The former table was mirrored on both axes, so stairs could face into a
// roof rather than produce an outward-facing visual slope.
const WEIRDO = { west: 0, east: 1, north: 2, south: 3 };

/**
 * Places a full two-block door. Doors are two separate blocks in Bedrock -
 * placing only the lower half (as the previous version did) produces the
 * broken, frameless door seen in testing. The upper half also needs its
 * own upper_block_bit state.
 */
function placeDoor(placer, f, s, up, typeId, cardinal) {
  const idx = dirIndex(cardinal);
  // Lower half
  placer.blockMulti(f, s, up, typeId, [
    { "minecraft:cardinal_direction": cardinal, upper_block_bit: false, open_bit: false, door_hinge_bit: false },
    { direction: idx, upper_block_bit: false, open_bit: false, door_hinge_bit: false },
    { "minecraft:cardinal_direction": cardinal },
    { direction: idx }
  ]);
  // Upper half
  placer.blockMulti(f, s, up + 1, typeId, [
    { "minecraft:cardinal_direction": cardinal, upper_block_bit: true, open_bit: false, door_hinge_bit: false },
    { direction: idx, upper_block_bit: true, open_bit: false, door_hinge_bit: false },
    { upper_block_bit: true }
  ]);
}

/** Places a container/appliance facing a compass direction (chest, furnace, barrel...). */
function facingBlock(placer, f, s, up, typeId, cardinal) {
  placer.blockMulti(f, s, up, typeId, [
    { "minecraft:cardinal_direction": cardinal },
    { facing_direction: FACING_DIRECTION[cardinal] },
    { direction: dirIndex(cardinal) }
  ]);
}

/** Places a bed (two blocks) with the head toward `cardinal`. */
function placeBed(placer, f, s, up, cardinal) {
  const idx = dirIndex(cardinal);
  const delta = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[cardinal];
  // In local space we only know forward/side, so translate the compass delta
  const plusF = PLUS_FORWARD_COMPASS[placer.facing];
  const fAxis = (plusF === "east" || plusF === "west") ? 0 : 1;
  const fSign = (plusF === "east" || plusF === "south") ? 1 : -1;
  const sPlus = PLUS_SIDE_COMPASS[placer.facing];
  const sSign = (sPlus === "east" || sPlus === "south") ? 1 : -1;

  const dF = (fAxis === 0 ? delta[0] : delta[1]) * fSign;
  const dS = (fAxis === 0 ? delta[1] : delta[0]) * sSign;

  placer.blockMulti(f, s, up, "minecraft:bed", [
    { "minecraft:cardinal_direction": cardinal, head_piece_bit: false, occupied_bit: false },
    { direction: idx, head_piece_bit: false, occupied_bit: false }
  ]);
  placer.blockMulti(f + dF, s + dS, up, "minecraft:bed", [
    { "minecraft:cardinal_direction": cardinal, head_piece_bit: true, occupied_bit: false },
    { direction: idx, head_piece_bit: true, occupied_bit: false }
  ]);
}

/**
 * Pitched (gabled) roof with the ridge running along the forward axis.
 * The roof is built as a genuinely solid wedge - every column is filled
 * solid from the wall top up to one block below its surface height using
 * the exact same per-column height formula as the gable-end infill below,
 * so there is no separate "is this column covered" question left over.
 * A single layer of stairs caps that solid wedge to bevel the steps into
 * a smooth-looking slope instead of an exposed staircase silhouette.
 */
function gabledRoof(placer, f1, f2, s1, s2, wallTopUp, roofStairsBlock, gableBlock) {
  const sMin = Math.min(s1, s2), sMax = Math.max(s1, s2);
  const width = sMax - sMin + 1;
  const baseUp = wallTopUp + 1;
  const plusCardinal = PLUS_SIDE_COMPASS[placer.facing];
  const minusCardinal = MINUS_SIDE_COMPASS[placer.facing];
  const ridgeDist = Math.floor((width - 1) / 2);

  for (let s = sMin; s <= sMax; s++) {
    const distFromEdge = Math.min(s - sMin, sMax - s);
    const surfaceUp = baseUp + distFromEdge;
    // Solid core: everything strictly below the visible surface.
    if (surfaceUp - 1 >= baseUp) {
      placer.box(f1, s, baseUp, f2, s, surfaceUp - 1, gableBlock);
    }
    if (distFromEdge === ridgeDist) {
      // Ridge line (or the two centre columns on an even-width roof): flat cap
      placer.box(f1, s, surfaceUp, f2, s, surfaceUp, gableBlock);
    } else {
      // Bedrock renders a stair's visible low/front edge in the declared
      // cardinal direction. A roof therefore needs that direction to point
      // away from the ridge, toward the nearest eave. The previous rule used
      // the inverse and produced inward-facing, concave roof slopes.
      const towardEave = (s - sMin) <= (sMax - s) ? minusCardinal : plusCardinal;
      for (let f = f1; f <= f2; f++) {
        stairs(placer, f, s, surfaceUp, roofStairsBlock, towardEave, false);
      }
    }
  }

  // Overhanging eave: one block out from each long wall, upside-down
  // stairs for a proper lip instead of a flat overhang.
  for (let f = f1 - 1; f <= f2 + 1; f++) {
    stairs(placer, f, sMin - 1, baseUp - 1, roofStairsBlock, minusCardinal, true);
    stairs(placer, f, sMax + 1, baseUp - 1, roofStairsBlock, plusCardinal, true);
  }
  // Extend the solid wedge's end columns out over the eave so the overhang
  // has something solid connecting it to the wedge, not a floating stair.
  placer.box(f1, sMin, baseUp - 1, f2, sMin, baseUp - 1, gableBlock);
  placer.box(f1, sMax, baseUp - 1, f2, sMax, baseUp - 1, gableBlock);

  // Solid triangular gable ends
  for (let s = sMin; s <= sMax; s++) {
    const distFromEdge = Math.min(s - sMin, sMax - s);
    const topUp = baseUp + distFromEdge;
    placer.box(f1, s, wallTopUp + 1, f1, s, topUp, gableBlock);
    placer.box(f2, s, wallTopUp + 1, f2, s, topUp, gableBlock);
  }
}

/**
 * The plot's near/far edges along the side axis, using the exact rule
 * houseShell plants a house with (legacy |side|<=1 near-road positions at
 * ±6, explicit values such as ±10 elsewhere). Exported so code that has to
 * start something new just past a house - a quest-upgrade outbuilding, say -
 * can find the house's true footprint instead of re-deriving these same
 * numbers independently and drifting out of sync with it (that drift is
 * exactly what let a farmer quest upgrade overlap the house itself).
 */
function plotSideBounds(side, depth = 7) {
  const plotCenter = Math.abs(side) <= 1 ? (side >= 0 ? 6 : -6) : side;
  const half = Math.floor(depth / 2);
  const near = plotCenter >= 0 ? plotCenter - half : plotCenter + half;
  const far = near + (plotCenter >= 0 ? depth - 1 : -(depth - 1));
  return { near, far, sMin: Math.min(near, far), sMax: Math.max(near, far) };
}

/**
 * House shell in vanilla village style: stone foundation course, log corner
 * posts, plank infill walls, a horizontal beam course under the eaves,
 * glass windows with sills, and a pitched roof.
 */
function houseShell(placer, f1, side, width, depth, height, mats, doorBlock) {
  // The road occupies -2..2 and the lamp posts sit at +/-3, so |side|
  // needs to clear that before a wall can start.
  const f2 = f1 + width - 1;
  const { near: s1, far: s2, sMin, sMax } = plotSideBounds(side, depth);
  const midS = Math.round((s1 + s2) / 2);

  // Foundation course at ground level and a solid floor slab below
  placer.box(f1, sMin, -1, f2, sMax, -1, mats.foundation);
  placer.box(f1, sMin, 0, f2, sMin, 0, mats.foundation);
  placer.box(f1, sMax, 0, f2, sMax, 0, mats.foundation);
  placer.box(f1, sMin, 0, f1, sMax, 0, mats.foundation);
  placer.box(f2, sMin, 0, f2, sMax, 0, mats.foundation);

  // Plank walls
  for (let up = 1; up <= height - 1; up++) {
    placer.box(f1, sMin, up, f2, sMin, up, mats.wall);
    placer.box(f1, sMax, up, f2, sMax, up, mats.wall);
    placer.box(f1, sMin, up, f1, sMax, up, mats.wall);
    placer.box(f2, sMin, up, f2, sMax, up, mats.wall);
  }
  // Beam course just under the eaves - the horizontal band vanilla houses have
  placer.box(f1, sMin, height - 1, f2, sMin, height - 1, mats.corner);
  placer.box(f1, sMax, height - 1, f2, sMax, height - 1, mats.corner);
  placer.box(f1, sMin, height - 1, f1, sMax, height - 1, mats.corner);
  placer.box(f2, sMin, height - 1, f2, sMax, height - 1, mats.corner);
  // Corner posts, full height
  for (const f of [f1, f2]) {
    for (const s of [sMin, sMax]) {
      placer.box(f, s, 0, f, s, height - 1, mats.corner);
    }
  }

  // Hollow interior + interior floor
  placer.box(f1 + 1, sMin + 1, 0, f2 - 1, sMax - 1, height - 2, "minecraft:air");
  placer.box(f1 + 1, sMin + 1, -1, f2 - 1, sMax - 1, -1, mats.floor);

  // Door centred on the street-facing wall. Explicitly clear both cells
  // after the structural passes and install both door halves type-first via
  // placeDoor, so a failed state permutation cannot leave a missing doorway.
  const doorForward = f1 + Math.floor(width / 2);
  const streetCardinal = side >= 0 ? MINUS_SIDE_COMPASS[placer.facing] : PLUS_SIDE_COMPASS[placer.facing];
  placer.block(doorForward, s1, 0, "minecraft:air");
  placer.block(doorForward, s1, 1, "minecraft:air");
  placeDoor(placer, doorForward, s1, 0, doorBlock, streetCardinal);
  // Doorstep slab outside the door
  const stepS = side >= 0 ? s1 - 1 : s1 + 1;
  placer.block(doorForward, stepS, -1, mats.foundation);

  // Windows with sills, symmetric on both long walls
  const q1 = Math.round(f1 + (width - 1) * 0.28);
  const q3 = Math.round(f1 + (width - 1) * 0.72);
  for (const f of [q1, q3]) {
    if (f === doorForward) continue;
    placer.block(f, sMin, 1, "minecraft:glass_pane");
    placer.block(f, sMin, 2, "minecraft:glass_pane");
    placer.block(f, sMax, 1, "minecraft:glass_pane");
    placer.block(f, sMax, 2, "minecraft:glass_pane");
  }
  placer.block(f1, midS, 1, "minecraft:glass_pane");
  placer.block(f2, midS, 1, "minecraft:glass_pane");

  // Lantern post beside the door, on the street side of the house
  const postS = side >= 0 ? s1 - 1 : s1 + 1;
  const postF = doorForward + 2 <= f2 ? doorForward + 2 : doorForward - 2;
  placer.block(postF, postS, 0, "minecraft:oak_fence");
  placer.block(postF, postS, 1, "minecraft:oak_fence");
  placer.block(postF, postS, 2, "minecraft:lantern", { hanging: false });

  gabledRoof(placer, f1, f2, sMin, sMax, height - 1, mats.roofStairs, mats.gable);

  return { f1, f2, s1, s2, sMin, sMax, height, doorForward, midS, side, streetCardinal };
}

/** Interior lighting so mobs can't spawn indoors and rooms actually read as lived-in. */
function lightInterior(placer, shape) {
  const innerF1 = shape.f1 + 1, innerF2 = shape.f2 - 1;
  const innerSMin = shape.sMin + 1, innerSMax = shape.sMax - 1;
  placer.block(innerF1, innerSMin, shape.height - 2, "minecraft:lantern", { hanging: true });
  placer.block(innerF2, innerSMax, shape.height - 2, "minecraft:lantern", { hanging: true });
}

export function buildTownHall(dimension, origin, facing) {
  const placer = makePlacer(dimension, origin, facing);
  const mats = {
    foundation: "minecraft:stone_bricks",
    wall: "minecraft:dark_oak_planks",
    corner: "minecraft:stripped_dark_oak_log",
    floor: "minecraft:polished_andesite",
    roofStairs: "minecraft:stone_brick_stairs",
    gable: "minecraft:stone_bricks"
  };
  const shape = houseShell(placer, 0, 9, 9, 9, 6, mats, "minecraft:dark_oak_door");
  const inward = oppositeCardinal(shape.streetCardinal);

  // Bell cupola on the ridge
  placer.block(4, shape.midS, 6, "minecraft:dark_oak_fence");
  placer.block(4, shape.midS, 7, "minecraft:dark_oak_fence");
  placer.blockMulti(4, shape.midS, 8, "minecraft:bell", [
    { "minecraft:cardinal_direction": shape.streetCardinal, attachment: "hanging", toggle_bit: false },
    { direction: dirIndex(shape.streetCardinal), attachment: "hanging", toggle_bit: false },
    { attachment: "hanging" }
  ]);

  // Council table down the middle, lectern, bookshelves, banners
  const farF = shape.f2 - 1;
  placer.box(3, shape.midS - 1, 0, 6, shape.midS + 1, 0, "minecraft:red_carpet");
  for (const s of [shape.midS - 1, shape.midS + 1]) {
    placer.block(2, s, 0, "minecraft:oak_fence");
    placer.block(2, s, 1, "minecraft:wooden_pressure_plate");
  }
  facingBlock(placer, farF, shape.midS, 0, "minecraft:lectern", shape.streetCardinal);
  for (const s of [shape.midS - 3, shape.midS - 2, shape.midS + 2, shape.midS + 3]) {
    placer.block(shape.f1 + 1, s, 0, "minecraft:bookshelf");
    placer.block(shape.f1 + 1, s, 1, "minecraft:bookshelf");
  }
  // Banners flat against the inner face of the long walls
  for (const f of [3, 6]) {
    placer.blockMulti(f, shape.sMin + 1, 2, "minecraft:wall_banner", [
      { facing_direction: FACING_DIRECTION[inward] },
      { "minecraft:cardinal_direction": inward }
    ]);
  }
  // The elder is the only resident of the town hall. Place the bed after the
  // library fixtures so it remains a valid vanilla sleep target at night.
  placeBed(placer, shape.f1 + 1, shape.sMax - 1, 0, shape.streetCardinal);
  lightInterior(placer, shape);
  return shape;
}

export function buildCampfire(dimension, origin, facing, plotForward) {
  const placer = makePlacer(dimension, origin, facing);
  const f = plotForward === undefined ? -6 : plotForward;
  placer.box(f - 3, -3, -1, f + 3, 3, -1, "minecraft:cobblestone");
  placer.box(f - 1, -1, -1, f + 1, 1, -1, "minecraft:gravel");
  placer.block(f, 0, 0, "minecraft:campfire", { extinguished: false });
  // Log stools around the fire
  for (const [df, ds] of [[-2, -2], [2, 2], [-2, 2], [2, -2]]) {
    placer.block(f + df, ds, 0, "minecraft:oak_log");
  }
  // A couple of flower pots for life
  placer.block(f - 3, 0, 0, "minecraft:oak_fence");
  placer.block(f + 3, 0, 0, "minecraft:oak_fence");
}

/**
 * Re-materializes a building's material set for the village's palette
 * (itself chosen from the founding biome - see palettes.js). `mats` only
 * needs the keys a given caller actually uses - a shed's material set has
 * no `floor`/`gable`, a house's has no `roofSolid` - so every key is
 * swapped defensively rather than assumed present, which is what lets this
 * same function serve both houses (builder.js) and quest-upgrade
 * outbuildings (upgrades.js) instead of each keeping its own copy.
 */
export function paletteMats(mats, paletteId) {
  const p = paletteById(paletteId);
  if (p.id === "plains") return mats;
  const wood = `minecraft:${p.wood}`;
  const swapPlanks = (v) => (v && v.includes("_planks") ? `${wood}_planks` : v);
  return {
    ...mats,
    foundation: mats.foundation && mats.foundation.includes("cobblestone") ? `minecraft:${p.stone}` : mats.foundation,
    wall: swapPlanks(mats.wall),
    corner: mats.corner && mats.corner.includes("_log") ? `${wood}_log` : mats.corner,
    floor: swapPlanks(mats.floor),
    roofStairs: mats.roofStairs && mats.roofStairs.includes("_stairs") ? `minecraft:${p.roof}` : mats.roofStairs,
    roofSolid: swapPlanks(mats.roofSolid),
    gable: swapPlanks(mats.gable)
  };
}

/**
 * Bedrock has spruce_door, birch_door, acacia_door... but the OAK door is
 * "wooden_door", not "oak_door" - the one wood that breaks the pattern. The
 * meadow palette is oak, so `minecraft:${p.wood}_door` produced a
 * non-existent id there and those houses were built with no door at all.
 */
const DOOR_BY_WOOD = { oak: "minecraft:wooden_door" };

function paletteDoor(defaultDoor, paletteId) {
  const p = paletteById(paletteId);
  if (p.id === "plains") return "minecraft:wooden_door";
  return DOOR_BY_WOOD[p.wood] || `minecraft:${p.wood}_door`;
}

const PLAIN_MATS = {
  foundation: "minecraft:cobblestone",
  wall: "minecraft:oak_planks",
  corner: "minecraft:oak_log",
  floor: "minecraft:oak_planks",
  roofStairs: "minecraft:oak_stairs",
  gable: "minecraft:oak_planks"
};

export function buildPlainHouse(dimension, origin, facing, plotForward, side, paletteId) {
  const placer = makePlacer(dimension, origin, facing);
  const shape = houseShell(placer, plotForward, side, 7, 7, 5, paletteMats(PLAIN_MATS, paletteId), paletteDoor("minecraft:wooden_door", paletteId));
  const inward = oppositeCardinal(shape.streetCardinal);
  const backS = shape.side >= 0 ? shape.sMax - 1 : shape.sMin + 1;
  const frontS = shape.side >= 0 ? shape.sMin + 1 : shape.sMax - 1;

  placeBed(placer, shape.f1 + 1, backS, 0, shape.streetCardinal);
  facingBlock(placer, shape.f2 - 1, backS, 0, "minecraft:chest", shape.streetCardinal);
  facingBlock(placer, shape.f2 - 1, frontS, 0, "minecraft:crafting_table", inward);
  // Small dining nook: a table made of a fence post and pressure plate,
  // flanked by stair "chairs" - the standard vanilla furniture trick.
  const tableF = shape.f1 + 3;
  placer.block(tableF, shape.midS, 0, "minecraft:oak_fence");
  placer.block(tableF, shape.midS, 1, "minecraft:wooden_pressure_plate");
  stairs(placer, tableF - 1, shape.midS, 0, "minecraft:oak_stairs", PLUS_FORWARD_COMPASS[facing], false);
  stairs(placer, tableF + 1, shape.midS, 0, "minecraft:oak_stairs", MINUS_FORWARD_COMPASS[facing], false);
  // hearth in the corner, plus a flower and a wall lamp
  placer.block(shape.f1 + 1, frontS, 0, "minecraft:flower_pot");
  placer.block(shape.f2 - 2, frontS, 0, "minecraft:cauldron");
  placer.box(shape.f1 + 2, shape.midS + (shape.side >= 0 ? 1 : -1), 0,
             shape.f2 - 2, shape.midS + (shape.side >= 0 ? 1 : -1), 0, "minecraft:light_gray_carpet");
  lightInterior(placer, shape);
  return shape;
}

const FARMER_MATS = {
  foundation: "minecraft:cobblestone",
  wall: "minecraft:oak_planks",
  corner: "minecraft:oak_log",
  floor: "minecraft:oak_planks",
  roofStairs: "minecraft:oak_stairs",
  gable: "minecraft:oak_planks"
};

// Geometry of the starter crop patch built alongside the farmer's house
// (below). Exported as `farmerPatchOuterEdge` so the quest-upgrade
// buildings in upgrades.js can start their own footprints beyond the
// patch's fence without re-deriving (and risking drifting out of sync
// with) these same two numbers.
const FARMER_PATCH_GAP = 2;
const FARMER_PATCH_DEPTH = 2;

/** The outermost column already occupied by the farmer's starter crop patch (fence included). */
export function farmerPatchOuterEdge(side) {
  const { far } = plotSideBounds(side, 7);
  const sign = side >= 0 ? 1 : -1;
  // +1 for the patch's own fence ring just past its crop rows.
  return far + sign * (FARMER_PATCH_GAP + FARMER_PATCH_DEPTH + 1);
}

export function buildFarmerHouse(dimension, origin, facing, plotForward, side, paletteId) {
  const placer = makePlacer(dimension, origin, facing);
  const shape = houseShell(placer, plotForward, side, 7, 7, 5, paletteMats(FARMER_MATS, paletteId), paletteDoor("minecraft:wooden_door", paletteId));
  const inward = oppositeCardinal(shape.streetCardinal);
  const backS = shape.side >= 0 ? shape.sMax - 1 : shape.sMin + 1;
  const frontS = shape.side >= 0 ? shape.sMin + 1 : shape.sMax - 1;

  placeBed(placer, shape.f1 + 1, backS, 0, shape.streetCardinal);
  facingBlock(placer, shape.f2 - 1, backS, 0, "minecraft:barrel", shape.streetCardinal);
  placer.block(shape.f2 - 1, backS, 1, "minecraft:hay_block");
  facingBlock(placer, shape.f2 - 1, frontS, 0, "minecraft:composter", inward);
  placer.block(shape.f1 + 1, frontS, 0, "minecraft:flower_pot");
  // Pantry: hay bale, a cauldron for water, herbs strung from a beam, and
  // a rough table by the window. Kept off the window columns (f1+2/f2-2)
  // so nothing blocks the view through the glass from outside.
  placer.block(shape.f2 - 2, frontS, 0, "minecraft:cauldron");
  placer.block(shape.f1 + 1, backS, 1, "minecraft:hay_block");
  const tF = shape.f1 + 3;
  placer.block(tF, shape.midS, 0, "minecraft:oak_fence");
  placer.block(tF, shape.midS, 1, "minecraft:wooden_pressure_plate");
  stairs(placer, tF - 1, shape.midS, 0, "minecraft:oak_stairs", PLUS_FORWARD_COMPASS[facing], false);
  placer.box(shape.f1 + 2, shape.midS + (shape.side >= 0 ? 1 : -1), 0,
             shape.f2 - 2, shape.midS + (shape.side >= 0 ? 1 : -1), 0, "minecraft:moss_carpet");
  lightInterior(placer, shape);

  // Fenced crop patch placed cleanly OUTSIDE the house footprint. Kept
  // deliberately close (gap=1) and shallow (depth=3): the previous
  // gap=2/depth=4 pushed the fence ring to |side|=16, one block past both
  // the terrain-levelling pass and the future perimeter wall at |side|=15,
  // which is exactly why a fence post ended up floating over unlevelled
  // ground with nothing under it.
  const gap = FARMER_PATCH_GAP;
  const patchDepth = FARMER_PATCH_DEPTH;
  const patchNear = shape.side >= 0 ? shape.sMax + gap : shape.sMin - gap;
  const patchFar = shape.side >= 0 ? patchNear + patchDepth : patchNear - patchDepth;
  const pMin = Math.min(patchNear, patchFar), pMax = Math.max(patchNear, patchFar);
  placer.box(shape.f1, pMin, -1, shape.f2, pMax, -1, "minecraft:farmland", { moisturized_amount: 7 });
  placer.box(shape.f1, pMin, 0, shape.f2, pMax, 0, "minecraft:wheat", { growth: 7 });
  // A contained one-block irrigation channel down the middle row, with
  // cobblestone end caps stopping it flowing out lengthwise. The channel
  // row itself already overwrites the middle row's farmland (that's the
  // point - it's the water source), but with patchDepth=2 the middle row
  // sits directly between the two crop rows (pMin/pMax), so cobblestone
  // banks along the s-axis are NOT needed to contain it: farmland is solid
  // and blocks flow on its own. Placing them anyway (as an earlier version
  // did) landed exactly on the pMin/pMax crop rows, replacing their
  // farmland with cobblestone and popping every wheat block planted above
  // it the instant the village spawned.
  const midPatch = Math.round((pMin + pMax) / 2);
  placer.box(shape.f1, midPatch, -1, shape.f2, midPatch, -1, "minecraft:water");
  placer.box(shape.f1, midPatch, 0, shape.f2, midPatch, 0, "minecraft:air");
  placer.block(shape.f1 - 1, midPatch, -1, "minecraft:cobblestone");
  placer.block(shape.f2 + 1, midPatch, -1, "minecraft:cobblestone");
  // Fence ring around the patch, with a gap in the middle of each long
  // side so the crops are actually reachable - the previous version sealed
  // the patch completely, locking both the player and the farmer out.
  const gateF = Math.round((shape.f1 + shape.f2) / 2);
  for (let f = shape.f1 - 1; f <= shape.f2 + 1; f++) {
    if (f === gateF) continue;
    placer.block(f, pMin - 1, 0, "minecraft:oak_fence");
    placer.block(f, pMax + 1, 0, "minecraft:oak_fence");
  }
  for (let s = pMin - 1; s <= pMax + 1; s++) {
    placer.block(shape.f1 - 1, s, 0, "minecraft:oak_fence");
    placer.block(shape.f2 + 1, s, 0, "minecraft:oak_fence");
  }
  return shape;
}

const BLACKSMITH_MATS = {
  foundation: "minecraft:cobblestone",
  wall: "minecraft:cobblestone",
  corner: "minecraft:spruce_log",
  floor: "minecraft:stone",
  roofStairs: "minecraft:stone_brick_stairs",
  gable: "minecraft:cobblestone"
};

export function buildBlacksmithHouse(dimension, origin, facing, plotForward, side, paletteId) {
  const placer = makePlacer(dimension, origin, facing);
  const shape = houseShell(placer, plotForward, side, 7, 7, 5, paletteMats(BLACKSMITH_MATS, paletteId), paletteDoor("minecraft:spruce_door", paletteId));
  const inward = oppositeCardinal(shape.streetCardinal);
  const backS = shape.side >= 0 ? shape.sMax - 1 : shape.sMin + 1;
  const frontS = shape.side >= 0 ? shape.sMin + 1 : shape.sMax - 1;

  placeBed(placer, shape.f1 + 1, backS, 0, shape.streetCardinal);
  facingBlock(placer, shape.f2 - 1, backS, 0, "minecraft:blast_furnace", shape.streetCardinal);
  facingBlock(placer, shape.f2 - 2, backS, 0, "minecraft:furnace", shape.streetCardinal);
  facingBlock(placer, shape.f2 - 1, frontS, 0, "minecraft:chest", inward);
  placer.blockMulti(shape.f2 - 2, frontS, 0, "minecraft:anvil", [
    { "minecraft:cardinal_direction": inward, damage: "undamaged" },
    { direction: dirIndex(inward), damage: "undamaged" },
    { damage: "undamaged" }
  ]);
  placer.block(shape.f1 + 1, frontS, 0, "minecraft:smithing_table");
  // Quench barrel by the anvil, coal heaped in the corner, and a rack of
  // finished work on the wall.
  placer.block(shape.f1 + 2, frontS, 0, "minecraft:cauldron", { fill_level: 6 });
  placer.block(shape.f1 + 2, backS, 0, "minecraft:coal_block");
  placer.block(shape.f1 + 2, frontS, 1, "minecraft:lantern", { hanging: true });
  placer.block(shape.f1 + 3, backS, 0, "minecraft:grindstone");
  placer.box(shape.f1 + 2, shape.midS, 0, shape.f2 - 3, shape.midS, 0, "minecraft:black_carpet");
  lightInterior(placer, shape);

  // Outdoor forge lean-to: a small cobble chimney on the back wall
  const chimS = shape.side >= 0 ? shape.sMax + 1 : shape.sMin - 1;
  placer.box(shape.f2 - 1, chimS, 0, shape.f2 - 1, chimS, shape.height + 2, "minecraft:cobblestone");
  placer.block(shape.f2 - 1, chimS, shape.height + 3, "minecraft:campfire", { extinguished: false });
  return shape;
}

const CARTOGRAPHER_MATS = {
  foundation: "minecraft:cobblestone",
  wall: "minecraft:birch_planks",
  corner: "minecraft:birch_log",
  floor: "minecraft:birch_planks",
  roofStairs: "minecraft:birch_stairs",
  gable: "minecraft:birch_planks"
};

export function buildCartographerHouse(dimension, origin, facing, plotForward, side, paletteId) {
  const placer = makePlacer(dimension, origin, facing);
  const shape = houseShell(placer, plotForward, side, 7, 7, 5, paletteMats(CARTOGRAPHER_MATS, paletteId), paletteDoor("minecraft:birch_door", paletteId));
  const inward = oppositeCardinal(shape.streetCardinal);
  const backS = shape.side >= 0 ? shape.sMax - 1 : shape.sMin + 1;
  const frontS = shape.side >= 0 ? shape.sMin + 1 : shape.sMax - 1;

  placeBed(placer, shape.f1 + 1, backS, 0, shape.streetCardinal);
  facingBlock(placer, shape.f2 - 1, backS, 0, "minecraft:cartography_table", shape.streetCardinal);
  facingBlock(placer, shape.f2 - 1, frontS, 0, "minecraft:chest", inward);
  placer.block(shape.f2 - 2, backS, 0, "minecraft:bookshelf");
  placer.block(shape.f1 + 1, frontS, 0, "minecraft:flower_pot");
  // Framed maps on the inner wall
  for (const f of [shape.f1 + 2, shape.f1 + 3]) {
    placer.blockMulti(f, frontS, 2, "minecraft:frame", [
      { facing_direction: FACING_DIRECTION[inward] },
      { "minecraft:cardinal_direction": inward }
    ]);
  }
  placer.box(shape.f1 + 2, shape.midS, 0, shape.f2 - 2, shape.midS, 0, "minecraft:light_blue_carpet");
  lightInterior(placer, shape);
  return shape;
}

const MINER_MATS = {
  foundation: "minecraft:cobblestone",
  wall: "minecraft:stone_bricks",
  corner: "minecraft:spruce_log",
  floor: "minecraft:cobblestone",
  // Bedrock has no "minecraft:cobblestone_stairs" block id - the stairs
  // with the cobblestone texture are "minecraft:stone_stairs" (a legacy
  // naming quirk carried over from Pocket Edition). The old id here made
  // block.setType() throw for every roof-stair placement on the miner's
  // house, which is why its roof came out full of holes.
  roofStairs: "minecraft:stone_stairs",
  gable: "minecraft:cobblestone"
};

/**
 * Miner's workshop: smelting bank along the back wall, storage, and a
 * proper roofed mine head beside the house - aligned to the same plot
 * grid as the building so it reads as part of the village rather than a
 * hole punched in the ground next to it.
 */
export function buildMinerHouse(dimension, origin, facing, plotForward, side, paletteId) {
  const placer = makePlacer(dimension, origin, facing);
  const shape = houseShell(placer, plotForward, side, 7, 7, 5, paletteMats(MINER_MATS, paletteId), paletteDoor("minecraft:spruce_door", paletteId));
  const inward = oppositeCardinal(shape.streetCardinal);
  const backS = shape.side >= 0 ? shape.sMax - 1 : shape.sMin + 1;
  const frontS = shape.side >= 0 ? shape.sMin + 1 : shape.sMax - 1;

  // --- interior: a working smelting bank, not just scattered blocks ---
  placeBed(placer, shape.f1 + 1, backS, 0, shape.streetCardinal);
  facingBlock(placer, shape.f2 - 1, backS, 0, "minecraft:furnace", shape.streetCardinal);
  facingBlock(placer, shape.f2 - 2, backS, 0, "minecraft:blast_furnace", shape.streetCardinal);
  facingBlock(placer, shape.f2 - 1, frontS, 0, "minecraft:chest", inward);
  // Smithing table, not a stonecutter: this is the actual toolsmith job
  // site (the profession this NPC gets). A stonecutter here would instead
  // be a claimable mason job site and could steal the profession.
  facingBlock(placer, shape.f1 + 1, frontS, 0, "minecraft:smithing_table", inward);
  // ore samples on a shelf above the bench
  placer.block(shape.f2 - 2, frontS, 0, "minecraft:oak_fence");
  placer.block(shape.f2 - 2, frontS, 1, "minecraft:iron_block");
  // hanging tools and a lamp over the anvil corner
  placer.block(shape.f1 + 2, backS, 1, "minecraft:lantern", { hanging: true });
  placer.box(shape.f1 + 2, shape.midS, 0, shape.f2 - 2, shape.midS, 0, "minecraft:brown_carpet");
  lightInterior(placer, shape);

  // --- mine head: a covered pithead building on the same plot ---
  // Sits directly behind the house, squared to it, with its own little
  // roof, fenced collar and a ladder shaft going down. Kept deliberately
  // narrow so its apron and eaves stay clear of the perimeter wall line
  // that later levels raise at |side| = 15.
  const dir = shape.side >= 0 ? 1 : -1;
  const headSNear = (shape.side >= 0 ? shape.sMax : shape.sMin) + dir * 2;
  const headSFar = headSNear + dir * 2;
  const hsMin = Math.min(headSNear, headSFar), hsMax = Math.max(headSNear, headSFar);
  const hfMin = shape.f1 + 1, hfMax = shape.f1 + 5;

  // stone apron
  placer.box(hfMin - 1, hsMin - 1, -1, hfMax + 1, hsMax + 1, -1, "minecraft:cobblestone");
  placer.box(hfMin, hsMin, -1, hfMax, hsMax, -1, "minecraft:stone_bricks");

  // four corner posts and a plank canopy over the shaft
  for (const f of [hfMin, hfMax]) {
    for (const s of [hsMin, hsMax]) {
      placer.box(f, s, 0, f, s, 3, "minecraft:spruce_log");
    }
  }
  placer.box(hfMin, hsMin, 4, hfMax, hsMax, 4, "minecraft:spruce_planks");
  for (let f = hfMin; f <= hfMax; f++) {
    stairs(placer, f, hsMin - 1, 4, "minecraft:spruce_stairs",
      MINUS_SIDE_COMPASS[facing], false);
    stairs(placer, f, hsMax + 1, 4, "minecraft:spruce_stairs",
      PLUS_SIDE_COMPASS[facing], false);
  }

  // the shaft itself, centred under the canopy
  const shaftF = Math.round((hfMin + hfMax) / 2);
  const shaftS = Math.round((hsMin + hsMax) / 2);
  placer.box(shaftF, shaftS, -1, shaftF, shaftS, -8, "minecraft:air");
  for (let d = 1; d <= 8; d++) {
    placer.block(shaftF, shaftS, -d, "minecraft:ladder", { facing_direction: 3 });
  }
  // lit landing at the bottom so it isn't a black pit
  placer.box(shaftF - 1, shaftS - 1, -9, shaftF + 1, shaftS + 1, -9, "minecraft:cobblestone");
  placer.box(shaftF - 1, shaftS - 1, -8, shaftF + 1, shaftS + 1, -8, "minecraft:air");
  placer.block(shaftF - 1, shaftS - 1, -8, "minecraft:torch");

  // fenced collar around the mouth, with a gap to step in
  for (const [df, ds] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
    if (df === 0 && ds === -dir) continue; // entry gap facing the house
    placer.block(shaftF + df, shaftS + ds, 0, "minecraft:oak_fence");
  }
  // winch frame over the mouth
  placer.block(shaftF, shaftS - 1, 1, "minecraft:oak_fence");
  placer.block(shaftF, shaftS + 1, 1, "minecraft:oak_fence");
  placer.block(shaftF, shaftS, 2, "minecraft:oak_fence");
  placer.block(shaftF - 1, shaftS, 3, "minecraft:lantern", { hanging: true });

  // spoil heap and a couple of crates to sell the "working mine" look
  placer.block(hfMax, hsMax, 0, "minecraft:barrel");
  placer.block(hfMax - 1, hsMax, 0, "minecraft:gravel");
  placer.block(hfMin, hsMin, 0, "minecraft:cobblestone_slab");
  return shape;
}

// The road is a single straight gravel strip along the forward axis,
// 5 wide (side -2..2), with no centerline accent - plain gravel per the
// vanilla-village-plot look this mod is going for. Exported so levels.js
// can size a matching protected rect for the fortification interior sweep
// (see builtPlotFootprints()) - without it, the sweep reclassifies the
// road's own gravel as unbuilt natural terrain and paves it back to grass.
export const ROAD_HALF_WIDTH = 2;

/**
 * The founding campfire's plaza straddles the street: buildCampfire lays a
 * 7x7 cobblestone pad centred on forward -6 with the fire itself, its log
 * stools and its fence posts standing on the road centreline. The road
 * skips those columns rather than paving through them - paving would
 * re-clear the air above the pad and delete the fire and stools, and the
 * pad already reads as paved ground where the street runs into it.
 */
export const CAMPFIRE_PLAZA = { fMin: -9, fMax: -3 };

/** Builds one straight gravel road segment along the forward axis. */
function roadSegment(placer, f1, f2) {
  const from = Math.min(f1, f2), to = Math.max(f1, f2);
  for (let f = from; f <= to; f++) {
    if (f >= CAMPFIRE_PLAZA.fMin && f <= CAMPFIRE_PLAZA.fMax) continue;
    placer.box(f, -ROAD_HALF_WIDTH, -1, f, ROAD_HALF_WIDTH, -1, "minecraft:gravel");
    placer.box(f, -ROAD_HALF_WIDTH, 0, f, ROAD_HALF_WIDTH, 3, "minecraft:air");
  }
}

/**
 * Paves the street between two forward marks. Exported so the
 * fortification build can run the road out to its gates (see walls.js) -
 * the numbered levels only ever pave as far as the plot they are adding,
 * which left the last stretch to each gate unpaved.
 */
export function paveRoad(dimension, origin, facing, fromForward, toForward) {
  roadSegment(makePlacer(dimension, origin, facing), fromForward, toForward);
}

/**
 * Extends the village's single main street. `toForward` is the current
 * street length in whichever direction it's growing; each level-up grows
 * it further from the town hall - forward (positive) for plots on that
 * side, backward (negative) for plots behind the town hall.
 *
 * Paving always runs from the town hall's own door (forward 0) out to
 * `toForward`, not just across the newly added stretch. Paving only the
 * new stretch meant any column the previous level had missed stayed bare
 * grass forever; re-running the whole side each time is idempotent and
 * guarantees one unbroken street. `fromForward` is therefore only a hint
 * about which way the street is growing. The campfire plaza is skipped by
 * roadSegment itself (see CAMPFIRE_PLAZA).
 *
 * `protectedRects` (local f/s rectangles, e.g. from levels.js's
 * builtPlotFootprints()) are skipped by the lamp-post lattice below. The
 * lattice is redrawn on every call across the *entire* start..toForward
 * span, not just the newly extended segment, so without this it would
 * silently plant a fence post and a lantern inside whichever house's wall
 * happened to land on the fixed 5-block grid.
 */
export function extendPath(dimension, origin, facing, fromForward, toForward, protectedRects) {
  const placer = makePlacer(dimension, origin, facing);
  const east = toForward >= 0;
  roadSegment(placer, 0, toForward);
  // The lamp-post lattice below is laid on a fixed 5-block grid with no
  // idea what's been built where. Skip any post whose column falls inside
  // any already-built (or about-to-be-built) plot - always at least the
  // town hall/campfire/starter house area, which is close enough to the
  // street to collide on most level configurations, plus every plot the
  // caller knows about.
  const rects = protectedRects && protectedRects.length ? protectedRects : [{ fMin: -8, fMax: 10, sMin: -13, sMax: 14 }];
  const inProtectedRect = (f, s) => rects.some(r => f >= r.fMin && f <= r.fMax && s >= r.sMin && s <= r.sMax);
  const postS = ROAD_HALF_WIDTH + 1;
  const step = east ? 5 : -5;
  for (let f = 0; east ? f <= toForward : f >= toForward; f += step) {
    // The campfire plaza is its own lit space; a lamp post landing on its
    // pad would crowd the fire and its stools.
    if (f >= CAMPFIRE_PLAZA.fMin && f <= CAMPFIRE_PLAZA.fMax) continue;
    for (const s of [-postS, postS]) {
      if (inProtectedRect(f, s)) continue;
      placer.block(f, s, -1, "minecraft:cobblestone");
      placer.block(f, s, 0, "minecraft:oak_fence");
      placer.block(f, s, 1, "minecraft:oak_fence");
      placer.block(f, s, 2, "minecraft:lantern", { hanging: false });
    }
  }
}

/** Interior floor centre of a house shape - used for job-site blocks and NPC spawns. */
export function interiorCenter(shape) {
  return {
    f: Math.round((shape.f1 + shape.f2) / 2),
    s: Math.round((shape.s1 + shape.s2) / 2)
  };
}

export { makePlacer, placeDoor, facingBlock, placeBed, stairs };
