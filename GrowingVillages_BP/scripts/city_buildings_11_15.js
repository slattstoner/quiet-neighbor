import { boundsFor, SPATIAL_PLAN, touchesRoadAxis } from "./spatial_plan.js";
import { prepareSite } from "./terrain.js";
import { makePlacer, placeDoor, facingBlock, placeBed, stairs } from "./builder.js";

/**
 * Detached builders for the approved L11–15 city content.
 *
 * They are deliberately not imported by levels.js, village.js or main.js.
 * A later coordinator-approved integration task may connect them to progress
 * for newly founded villages only. Bounds always come from spatial_plan.js;
 * this file has no second coordinate source for core plots.
 */

export const CITY_BUILDING_IDS = Object.freeze([
  "market_square",
  "granary_yard",
  "travellers_inn",
  "guard_barracks",
  "village_archive"
]);

const PLUS_SIDE_COMPASS = ["south", "north", "east", "west"];
const MINUS_SIDE_COMPASS = ["north", "south", "west", "east"];
const PLUS_FORWARD_COMPASS = ["east", "west", "south", "north"];
const MINUS_FORWARD_COMPASS = ["west", "east", "north", "south"];

function entryFor(buildingId) {
  const entry = SPATIAL_PLAN.find((item) => item.buildingId === buildingId);
  if (!entry || !CITY_BUILDING_IDS.includes(buildingId)) throw new Error(`unsupported city building: ${buildingId}`);
  const planBounds = boundsFor(buildingId);
  if (!planBounds || touchesRoadAxis(planBounds.bounds)) throw new Error(`invalid approved city bounds: ${buildingId}`);
  return { entry, bounds: planBounds.bounds };
}

function inBounds(bounds, f, s) {
  return f >= bounds.fMin && f <= bounds.fMax && s >= bounds.sMin && s <= bounds.sMax;
}

function assertRectInside(bounds, f1, f2, s1, s2, label) {
  const minF = Math.min(f1, f2), maxF = Math.max(f1, f2);
  const minS = Math.min(s1, s2), maxS = Math.max(s1, s2);
  if (!inBounds(bounds, minF, minS) || !inBounds(bounds, maxF, maxS)) {
    throw new Error(`${label} leaves approved core bounds`);
  }
}

function boundedPlacer(dimension, origin, facing, bounds) {
  const raw = makePlacer(dimension, origin, facing);
  return {
    ...raw,
    block(f, s, up, typeId, states) {
      assertRectInside(bounds, f, f, s, s, `block ${typeId}`);
      raw.block(f, s, up, typeId, states);
    },
    blockMulti(f, s, up, typeId, candidates) {
      assertRectInside(bounds, f, f, s, s, `oriented block ${typeId}`);
      raw.blockMulti(f, s, up, typeId, candidates);
    },
    box(f1, s1, u1, f2, s2, u2, typeId, states) {
      assertRectInside(bounds, f1, f2, s1, s2, `box ${typeId}`);
      raw.box(f1, s1, u1, f2, s2, u2, typeId, states);
    }
  };
}

function gabledRoof(placer, f1, f2, s1, s2, wallTopUp, roofBlock, coreBlock) {
  const sMin = Math.min(s1, s2), sMax = Math.max(s1, s2);
  const baseUp = wallTopUp + 1;
  const ridgeDist = Math.floor((sMax - sMin) / 2);
  const minus = MINUS_SIDE_COMPASS[placer.facing];
  const plus = PLUS_SIDE_COMPASS[placer.facing];
  for (let s = sMin; s <= sMax; s++) {
    const distance = Math.min(s - sMin, sMax - s);
    const surfaceUp = baseUp + distance;
    if (surfaceUp - 1 >= baseUp) placer.box(f1, s, baseUp, f2, s, surfaceUp - 1, coreBlock);
    if (distance === ridgeDist) {
      placer.box(f1, s, surfaceUp, f2, s, surfaceUp, coreBlock);
    } else {
      const towardEave = (s - sMin) <= (sMax - s) ? minus : plus;
      for (let f = f1; f <= f2; f++) stairs(placer, f, s, surfaceUp, roofBlock, towardEave, false);
    }
  }
}

function light(placer, f, s, up) {
  placer.block(f, s, up, "minecraft:lantern", { hanging: true });
}

function room(placer, spec) {
  const { f1, f2, s1, s2, height, foundation, wall, corner, floor, roof, door } = spec;
  const fMin = Math.min(f1, f2), fMax = Math.max(f1, f2);
  const sMin = Math.min(s1, s2), sMax = Math.max(s1, s2);
  placer.box(fMin, sMin, -1, fMax, sMax, -1, foundation);
  placer.box(fMin, sMin, 0, fMax, sMax, 0, wall);
  for (let up = 1; up < height; up++) {
    placer.box(fMin, sMin, up, fMax, sMin, up, wall);
    placer.box(fMin, sMax, up, fMax, sMax, up, wall);
    placer.box(fMin, sMin, up, fMin, sMax, up, wall);
    placer.box(fMax, sMin, up, fMax, sMax, up, wall);
  }
  for (const f of [fMin, fMax]) for (const s of [sMin, sMax]) placer.box(f, s, 0, f, s, height - 1, corner);
  placer.box(fMin + 1, sMin + 1, 0, fMax - 1, sMax - 1, height - 1, "minecraft:air");
  placer.box(fMin + 1, sMin + 1, -1, fMax - 1, sMax - 1, -1, floor);
  placer.block(door.f, door.s, 0, "minecraft:air");
  placer.block(door.f, door.s, 1, "minecraft:air");
  placeDoor(placer, door.f, door.s, 0, "minecraft:wooden_door", door.cardinal);
  gabledRoof(placer, fMin, fMax, sMin, sMax, height - 1, roof, wall);
  return { fMin, fMax, sMin, sMax, height, door: { f: door.f, s: door.s, up: 0, cardinal: door.cardinal } };
}

function canopy(placer, f1, f2, s1, s2, materials) {
  const fMin = Math.min(f1, f2), fMax = Math.max(f1, f2);
  const sMin = Math.min(s1, s2), sMax = Math.max(s1, s2);
  placer.box(fMin, sMin, -1, fMax, sMax, -1, materials.floor);
  for (const f of [fMin, fMax]) for (const s of [sMin, sMax]) placer.box(f, s, 0, f, s, 2, materials.post);
  gabledRoof(placer, fMin, fMax, sMin, sMax, 2, materials.roof, materials.roofCore);
  return { fMin, fMax, sMin, sMax };
}

function approachFor(bounds, roadLink, entry) {
  const width = Math.max(2, roadLink.width || 2);
  if (roadLink.axis === "forward") {
    const f1 = Math.max(bounds.fMin, Math.min(entry.f - 1, bounds.fMax - width + 1));
    const f2 = f1 + width - 1;
    if (bounds.sMin > 1) return { axis: "forward", width, bounds: { fMin: f1, fMax: f2, sMin: 2, sMax: bounds.sMin - 1 }, side: "sMin" };
    return { axis: "forward", width, bounds: { fMin: f1, fMax: f2, sMin: bounds.sMax + 1, sMax: -2 }, side: "sMax" };
  }
  const s1 = Math.max(bounds.sMin, Math.min(entry.s - 1, bounds.sMax - width + 1));
  const s2 = s1 + width - 1;
  if (bounds.fMin > 1) return { axis: "side", width, bounds: { fMin: 2, fMax: bounds.fMin - 1, sMin: s1, sMax: s2 }, side: "fMin" };
  return { axis: "side", width, bounds: { fMin: bounds.fMax + 1, fMax: -2, sMin: s1, sMax: s2 }, side: "fMax" };
}

function paveEntry(placer, f1, f2, s1, s2) {
  placer.box(f1, s1, -1, f2, s2, -1, "minecraft:gravel");
  return { fMin: Math.min(f1, f2), fMax: Math.max(f1, f2), sMin: Math.min(s1, s2), sMax: Math.max(s1, s2), width: Math.min(Math.abs(f2 - f1) + 1, Math.abs(s2 - s1) + 1) };
}

function commonMetadata(entry, bounds, shape, slots) {
  return {
    buildingId: entry.buildingId,
    level: entry.level,
    bounds: { ...bounds },
    roadLink: { ...entry.roadLink },
    approach: approachFor(bounds, entry.roadLink, shape.entry),
    entry: shape.entry,
    entryPath: shape.entryPath,
    npcAnchor: slots.npcAnchor,
    beds: slots.beds || [],
    storage: slots.storage || [],
    workstations: slots.workstations || [],
    lights: slots.lights || [],
    rooms: shape.rooms || [],
    roofSpecs: shape.roofSpecs || []
  };
}

/**
 * A job-site block under each market stall.
 *
 * The stalls were pure scenery: six canopies with nothing under them. In
 * Bedrock a villager's day is built out of points of interest - it claims a
 * job site, works it in the daytime and gathers at the bell in the evening
 * (behavior.mingle) - so a market with no job sites is a market nobody has
 * any reason to stand in. Six blocks turn it into somewhere the village
 * actually goes.
 *
 * Every id here is one this pack already places elsewhere, which is the point:
 * `minecraft:stonecutter` and `minecraft:oak_door` both shipped once as
 * plausible-looking ids that do not exist, and util.js swallows the throw, so
 * a wrong id here would be six invisible stalls and no error anywhere.
 *
 * Deliberately NOT here: beds. A villager claims a bed as its *home*, and the
 * market square is a public plaza - beds belong in the houses, which is where
 * the house builders already put them. Six beds in the middle of the market
 * would make the square a dormitory and quietly move the whole village's
 * sleeping quarters into it.
 *
 * What a test can check is that the blocks are placed, that they sit under the
 * canopies and inside the square's own plot, and that the metadata agrees with
 * what was built. Whether vanilla's AI then does the thing it is documented to
 * do needs a device, and is called out as such in HANDOVER.md.
 */
const STALL_TRADES = Object.freeze([
  "minecraft:smoker",              // butcher
  "minecraft:loom",                // shepherd
  "minecraft:cartography_table",   // cartographer
  "minecraft:fletching_table",     // fletcher
  "minecraft:cauldron",            // leatherworker
  "minecraft:grindstone"           // weaponsmith
]);

/** The centre of a canopy, where its job-site block goes. */
function stallCentre(stall) {
  return { f: Math.min(stall.fMin, stall.fMax) + 1, s: Math.min(stall.sMin, stall.sMax) + 1, up: 0 };
}

function buildMarketSquare(placer, entry, bounds) {
  placer.box(bounds.fMin, bounds.sMin, -1, bounds.fMax, bounds.sMax, -1, "minecraft:gravel");
  const materials = { floor: "minecraft:oak_planks", post: "minecraft:oak_log", roof: "minecraft:oak_stairs", roofCore: "minecraft:oak_planks" };
  const stalls = [];
  for (const s of [7, 17]) for (const f of [-41, -37, -33]) stalls.push(canopy(placer, f, f + 2, s, s + 2, materials));
  // A canopy is a 3x3 floor with four corner posts, so its centre is free and
  // already under a roof - which is exactly where a stallholder would stand.
  const stallWorkstations = stalls.map((stall, index) => {
    const at = stallCentre(stall);
    const typeId = STALL_TRADES[index % STALL_TRADES.length];
    placer.block(at.f, at.s, at.up, typeId);
    return { ...at, typeId };
  });
  // A stone water feature remains in the open middle, with benches around it.
  placer.box(-37, 11, -1, -35, 15, -1, "minecraft:stone_bricks");
  placer.box(-36, 12, -1, -36, 14, -1, "minecraft:water");
  placer.block(-36, 13, 0, "minecraft:water");
  for (const [f, s] of [[-39, 12], [-33, 12], [-39, 14], [-33, 14]]) stairs(placer, f, s, 0, "minecraft:oak_stairs", PLUS_FORWARD_COMPASS[placer.facing], false);
  // A compact steward kiosk supplies the required real entrance and storage.
  const kiosk = room(placer, {
    f1: -34, f2: -31, s1: 11, s2: 16, height: 4,
    foundation: "minecraft:cobblestone", wall: "minecraft:oak_planks", corner: "minecraft:oak_log",
    floor: "minecraft:oak_planks", roof: "minecraft:oak_stairs",
    door: { f: -32, s: 11, cardinal: MINUS_SIDE_COMPASS[placer.facing] }
  });
  const entryPath = paveEntry(placer, -33, -32, 6, 11);
  facingBlock(placer, -32, 14, 0, "minecraft:barrel", MINUS_FORWARD_COMPASS[placer.facing]);
  facingBlock(placer, -32, 12, 0, "minecraft:composter", MINUS_FORWARD_COMPASS[placer.facing]);
  light(placer, -32, 15, 2);
  for (const [f, s] of [[-41, 7], [-37, 17], [-33, 7], [-31, 19]]) light(placer, f, s, 3);
  return commonMetadata(entry, bounds, {
    entry: kiosk.door,
    entryPath,
    rooms: [kiosk, ...stalls],
    roofSpecs: [...stalls.map((stall) => ({ ...stall, wallTop: 2 })), { ...kiosk, wallTop: 3 }]
  }, {
    npcAnchor: { f: -32, s: 13, up: 0 }, beds: [], storage: [{ f: -32, s: 14, up: 0, typeId: "minecraft:barrel" }],
    // The kiosk's composter plus one per stall, so the recorded POI list is
    // what was actually built rather than a subset of it.
    workstations: [{ f: -32, s: 12, up: 0, typeId: "minecraft:composter" }, ...stallWorkstations],
    lights: [{ f: -32, s: 15, up: 2 }, { f: -41, s: 7, up: 3 }, { f: -37, s: 17, up: 3 }, { f: -33, s: 7, up: 3 }, { f: -31, s: 19, up: 3 }]
  });
}

function buildGranaryYard(placer, entry, bounds) {
  const granary = room(placer, {
    f1: 11, f2: 23, s1: 52, s2: 62, height: 6,
    foundation: "minecraft:cobblestone", wall: "minecraft:oak_planks", corner: "minecraft:oak_log",
    floor: "minecraft:oak_planks", roof: "minecraft:spruce_stairs",
    door: { f: 11, s: 57, cardinal: MINUS_FORWARD_COMPASS[placer.facing] }
  });
  for (const s of [54, 57, 60]) facingBlock(placer, 21, s, 0, "minecraft:barrel", MINUS_FORWARD_COMPASS[placer.facing]);
  facingBlock(placer, 20, 54, 0, "minecraft:chest", MINUS_FORWARD_COMPASS[placer.facing]);
  facingBlock(placer, 14, 54, 0, "minecraft:composter", PLUS_SIDE_COMPASS[placer.facing]);
  placeBed(placer, 14, 60, 0, PLUS_SIDE_COMPASS[placer.facing]);
  light(placer, 13, 53, 4); light(placer, 21, 61, 4);
  // A visual loading court; it has no production logic or inventory transfer.
  placer.box(25, 52, -1, 34, 62, -1, "minecraft:gravel");
  placer.box(26, 54, 0, 30, 54, 0, "minecraft:oak_planks");
  placer.box(26, 55, 0, 26, 55, 1, "minecraft:oak_fence");
  placer.box(30, 55, 0, 30, 55, 1, "minecraft:oak_fence");
  placer.block(28, 55, 0, "minecraft:barrel");
  placer.block(31, 60, 0, "minecraft:hay_block");
  placer.block(32, 60, 0, "minecraft:hay_block");
  light(placer, 34, 52, 2);
  const entryPath = paveEntry(placer, 8, 12, 56, 57);
  return commonMetadata(entry, bounds, { entry: granary.door, entryPath, rooms: [granary], roofSpecs: [{ ...granary, wallTop: 5 }] }, {
    npcAnchor: { f: 15, s: 57, up: 0 }, beds: [{ f: 14, s: 60, up: 0 }],
    storage: [{ f: 21, s: 54, up: 0, typeId: "minecraft:barrel" }, { f: 20, s: 54, up: 0, typeId: "minecraft:chest" }],
    workstations: [{ f: 14, s: 54, up: 0, typeId: "minecraft:composter" }],
    lights: [{ f: 13, s: 53, up: 4 }, { f: 21, s: 61, up: 4 }, { f: 34, s: 52, up: 2 }]
  });
}

function buildTravellersInn(placer, entry, bounds) {
  const inn = room(placer, {
    f1: 44, f2: 58, s1: -37, s2: -25, height: 5,
    foundation: "minecraft:cobblestone", wall: "minecraft:dark_oak_planks", corner: "minecraft:stripped_dark_oak_log",
    floor: "minecraft:oak_planks", roof: "minecraft:dark_oak_stairs",
    door: { f: 51, s: -25, cardinal: PLUS_SIDE_COMPASS[placer.facing] }
  });
  for (const [f, s] of [[46, -34], [46, -30], [51, -34], [51, -30]]) placeBed(placer, f, s, 0, MINUS_SIDE_COMPASS[placer.facing]);
  facingBlock(placer, 56, -34, 0, "minecraft:furnace", MINUS_SIDE_COMPASS[placer.facing]);
  facingBlock(placer, 56, -31, 0, "minecraft:barrel", MINUS_SIDE_COMPASS[placer.facing]);
  facingBlock(placer, 55, -28, 0, "minecraft:chest", MINUS_SIDE_COMPASS[placer.facing]);
  for (const [f, s] of [[46, -36], [56, -36], [46, -26], [56, -26]]) light(placer, f, s, 3);
  // Stable remains a low fenced court and uses no NPC spawn or trade logic.
  placer.box(60, -38, -1, 64, -28, -1, "minecraft:gravel");
  for (let f = 60; f <= 64; f++) { placer.block(f, -38, 0, "minecraft:oak_fence"); placer.block(f, -28, 0, "minecraft:oak_fence"); }
  for (let s = -38; s <= -28; s++) { placer.block(60, s, 0, "minecraft:oak_fence"); placer.block(64, s, 0, "minecraft:oak_fence"); }
  placer.block(62, -28, 0, "minecraft:air");
  placer.block(61, -34, 0, "minecraft:hay_block");
  placer.block(63, -34, 0, "minecraft:water");
  canopy(placer, 60, 64, -38, -35, { floor: "minecraft:oak_planks", post: "minecraft:spruce_log", roof: "minecraft:spruce_stairs", roofCore: "minecraft:spruce_planks" });
  light(placer, 62, -37, 3);
  const entryPath = paveEntry(placer, 50, 51, -25, -18);
  return commonMetadata(entry, bounds, { entry: inn.door, entryPath, rooms: [inn], roofSpecs: [{ ...inn, wallTop: 4 }, { fMin: 60, fMax: 64, sMin: -38, sMax: -35, wallTop: 2 }] }, {
    npcAnchor: { f: 52, s: -29, up: 0 }, beds: [{ f: 46, s: -34, up: 0 }, { f: 46, s: -30, up: 0 }, { f: 51, s: -34, up: 0 }, { f: 51, s: -30, up: 0 }],
    storage: [{ f: 56, s: -31, up: 0, typeId: "minecraft:barrel" }, { f: 55, s: -28, up: 0, typeId: "minecraft:chest" }],
    workstations: [{ f: 56, s: -34, up: 0, typeId: "minecraft:furnace" }],
    lights: [{ f: 46, s: -36, up: 3 }, { f: 56, s: -36, up: 3 }, { f: 46, s: -26, up: 3 }, { f: 56, s: -26, up: 3 }, { f: 62, s: -37, up: 3 }]
  });
}

function buildGuardBarracks(placer, entry, bounds) {
  const barracks = room(placer, {
    f1: -63, f2: -49, s1: -37, s2: -26, height: 5,
    foundation: "minecraft:cobblestone", wall: "minecraft:stone_bricks", corner: "minecraft:spruce_log",
    floor: "minecraft:polished_andesite", roof: "minecraft:stone_brick_stairs",
    door: { f: -56, s: -26, cardinal: PLUS_SIDE_COMPASS[placer.facing] }
  });
  for (const [f, s] of [[-61, -34], [-61, -30], [-55, -34], [-55, -30]]) placeBed(placer, f, s, 0, MINUS_SIDE_COMPASS[placer.facing]);
  facingBlock(placer, -51, -34, 0, "minecraft:barrel", MINUS_SIDE_COMPASS[placer.facing]);
  facingBlock(placer, -51, -30, 0, "minecraft:chest", MINUS_SIDE_COMPASS[placer.facing]);
  facingBlock(placer, -52, -28, 0, "minecraft:grindstone", MINUS_SIDE_COMPASS[placer.facing]);
  facingBlock(placer, -53, -28, 0, "minecraft:smithing_table", MINUS_SIDE_COMPASS[placer.facing]);
  for (const [f, s] of [[-61, -36], [-51, -36], [-61, -27], [-51, -27]]) light(placer, f, s, 3);
  // Training yard is intentionally decorative: target posts, watchfire and no reward dispenser.
  placer.box(-63, -24, -1, -49, -20, -1, "minecraft:gravel");
  for (const f of [-61, -56, -51]) {
    placer.block(f, -22, 0, "minecraft:oak_fence");
    placer.block(f, -22, 1, "minecraft:hay_block");
  }
  placer.block(-56, -21, 0, "minecraft:campfire", { extinguished: false });
  light(placer, -63, -20, 2);
  const entryPath = paveEntry(placer, -57, -56, -26, -18);
  return commonMetadata(entry, bounds, { entry: barracks.door, entryPath, rooms: [barracks], roofSpecs: [{ ...barracks, wallTop: 4 }] }, {
    npcAnchor: { f: -56, s: -29, up: 0 }, beds: [{ f: -61, s: -34, up: 0 }, { f: -61, s: -30, up: 0 }, { f: -55, s: -34, up: 0 }, { f: -55, s: -30, up: 0 }],
    storage: [{ f: -51, s: -34, up: 0, typeId: "minecraft:barrel" }, { f: -51, s: -30, up: 0, typeId: "minecraft:chest" }],
    workstations: [{ f: -52, s: -28, up: 0, typeId: "minecraft:grindstone" }, { f: -53, s: -28, up: 0, typeId: "minecraft:smithing_table" }],
    lights: [{ f: -61, s: -36, up: 3 }, { f: -51, s: -36, up: 3 }, { f: -61, s: -27, up: 3 }, { f: -51, s: -27, up: 3 }, { f: -63, s: -20, up: 2 }]
  });
}

function buildVillageArchive(placer, entry, bounds) {
  const archive = room(placer, {
    f1: -16, f2: -7, s1: 50, s2: 60, height: 6,
    foundation: "minecraft:stone_bricks", wall: "minecraft:birch_planks", corner: "minecraft:dark_oak_log",
    floor: "minecraft:oak_planks", roof: "minecraft:dark_oak_stairs",
    door: { f: -7, s: 55, cardinal: PLUS_FORWARD_COMPASS[placer.facing] }
  });
  for (let s = 52; s <= 58; s += 2) placer.block(-14, s, 0, "minecraft:bookshelf");
  facingBlock(placer, -10, 52, 0, "minecraft:lectern", PLUS_SIDE_COMPASS[placer.facing]);
  facingBlock(placer, -10, 58, 0, "minecraft:cartography_table", MINUS_SIDE_COMPASS[placer.facing]);
  facingBlock(placer, -8, 58, 0, "minecraft:chest", MINUS_FORWARD_COMPASS[placer.facing]);
  placeBed(placer, -14, 58, 0, PLUS_SIDE_COMPASS[placer.facing]);
  light(placer, -15, 51, 4); light(placer, -8, 59, 4);
  // Quiet outer reading court remains inside the core allocation.
  placer.box(-18, 50, -1, -17, 60, -1, "minecraft:gravel");
  for (const s of [52, 56, 60]) stairs(placer, -18, s, 0, "minecraft:oak_stairs", PLUS_FORWARD_COMPASS[placer.facing], false);
  placer.block(-17, 55, 0, "minecraft:flower_pot");
  light(placer, -18, 50, 2);
  const entryPath = paveEntry(placer, -7, -4, 54, 55);
  return commonMetadata(entry, bounds, { entry: archive.door, entryPath, rooms: [archive], roofSpecs: [{ ...archive, wallTop: 5 }] }, {
    npcAnchor: { f: -11, s: 55, up: 0 }, beds: [{ f: -14, s: 58, up: 0 }],
    storage: [{ f: -8, s: 58, up: 0, typeId: "minecraft:chest" }],
    workstations: [{ f: -10, s: 52, up: 0, typeId: "minecraft:lectern" }, { f: -10, s: 58, up: 0, typeId: "minecraft:cartography_table" }],
    lights: [{ f: -15, s: 51, up: 4 }, { f: -8, s: 59, up: 4 }, { f: -18, s: 50, up: 2 }]
  });
}

const BUILDERS = Object.freeze({
  market_square: buildMarketSquare,
  granary_yard: buildGranaryYard,
  travellers_inn: buildTravellersInn,
  guard_barracks: buildGuardBarracks,
  village_archive: buildVillageArchive
});

/**
 * Builds one isolated L11–15 city object. No NPC is spawned, no village state
 * is written and no level is changed. The returned metadata reserves stable
 * NPC/storage/workstation slots for a later integration stage.
 */
export function buildCityBuilding(buildingId, dimension, origin, facing) {
  const { entry, bounds } = entryFor(buildingId);
  const builder = BUILDERS[buildingId];
  // Local, bounded plot preparation only. No full-square terrain pass and no
  // padding that could touch neighbouring allocations or future wall space.
  prepareSite(dimension, origin, facing, bounds.fMin, bounds.fMax, bounds.sMin, bounds.sMax, {
    padding: 0,
    clearHeight: 12,
    fillDepth: 5,
    surfaceBlock: "minecraft:grass_block"
  });
  const placer = boundedPlacer(dimension, origin, facing, bounds);
  const metadata = builder(placer, entry, bounds);
  return Object.freeze(metadata);
}

