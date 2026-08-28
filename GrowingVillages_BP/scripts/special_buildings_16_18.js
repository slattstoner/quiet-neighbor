import {
  FINAL_RADIUS,
  ROAD_AXES,
  SPATIAL_PLAN,
  LEGACY_L1_10_ENVELOPES,
  LEGACY_SPECIAL_RESERVATION,
  rectanglesOverlap,
  minimumTowerClearance,
  minimumWallClearance,
  touchesRoadAxis
} from "./spatial_plan.js";
import { prepareSite } from "./terrain.js";
import { makePlacer, placeBed, placeDoor, facingBlock, stairs } from "./builder.js";

/**
 * Detached story-building foundation for future L16–18 quest arcs.
 *
 * This module has no progression, quest, UI, NPC, production or world-global
 * import. It deliberately owns the only local coordinates for these future
 * objects. A later coordinator-approved merge must reconcile quest-owner IDs
 * before any runtime entry point imports this module.
 */

const PLUS_SIDE = ["south", "north", "east", "west"];
const MINUS_SIDE = ["north", "south", "west", "east"];
const PLUS_FORWARD = ["east", "west", "south", "north"];
const MINUS_FORWARD = ["west", "east", "north", "south"];

function rect(fMin, fMax, sMin, sMax) {
  if (![fMin, fMax, sMin, sMax].every(Number.isInteger) || fMin > fMax || sMin > sMax) {
    throw new Error(`invalid special bounds: ${fMin}..${fMax}/${sMin}..${sMax}`);
  }
  return Object.freeze({ fMin, fMax, sMin, sMax });
}

function cloneRect(bounds) {
  return { fMin: bounds.fMin, fMax: bounds.fMax, sMin: bounds.sMin, sMax: bounds.sMax };
}

function frozenPoint(point) {
  return Object.freeze({ ...point });
}

function building(spec) {
  return Object.freeze({
    ...spec,
    bounds: rect(spec.bounds.fMin, spec.bounds.fMax, spec.bounds.sMin, spec.bounds.sMax),
    footprint: rect(spec.footprint.fMin, spec.footprint.fMax, spec.footprint.sMin, spec.footprint.sMax),
    entry: Object.freeze({ ...spec.entry }),
    entryPath: rect(spec.entryPath.fMin, spec.entryPath.fMax, spec.entryPath.sMin, spec.entryPath.sMax),
    roadLink: Object.freeze({ ...spec.roadLink }),
    approach: Object.freeze({ ...spec.approach, bounds: rect(spec.approach.bounds.fMin, spec.approach.bounds.fMax, spec.approach.bounds.sMin, spec.approach.bounds.sMax) }),
    requiredClearance: Object.freeze({ ...spec.requiredClearance }),
    palette: Object.freeze({ ...spec.palette }),
    layout: Object.freeze({ ...spec.layout }),
    interiorZones: Object.freeze(spec.interiorZones.map((zone) => Object.freeze({ ...zone, bounds: rect(zone.bounds.fMin, zone.bounds.fMax, zone.bounds.sMin, zone.bounds.sMax) }))),
    focalBlocks: Object.freeze(spec.focalBlocks.map(frozenPoint)),
    beds: Object.freeze((spec.beds || []).map(frozenPoint)),
    storage: Object.freeze((spec.storage || []).map(frozenPoint)),
    workstations: Object.freeze((spec.workstations || []).map(frozenPoint)),
    lights: Object.freeze(spec.lights.map(frozenPoint)),
    kind: "special_story"
  });
}

/**
 * Single canonical data source for future special story buildings. Bounds,
 * entry geometry, connector geometry and decorative layout coordinates live
 * here; builder functions only consume this data.
 */
export const SPECIAL_BUILDINGS = Object.freeze([
  building({
    id: "memorial_grove",
    futureLevel: 16,
    questArcId: "special.roots_of_the_road",
    bounds: rect(-38, -22, -72, -58),
    footprint: rect(-38, -22, -72, -58),
    entry: { f: -24, s: -65, up: 0, cardinal: "east" },
    entryPath: rect(-23, -22, -66, -65),
    roadLink: { type: "pedestrian_path", axis: "side", width: 2 },
    approach: { axis: "side", width: 2, bounds: rect(-21, -2, -66, -65), side: "fMax" },
    palette: { foundation: "minecraft:stone_bricks", wall: "minecraft:oak_planks", timber: "minecraft:oak_log", roof: "minecraft:dark_oak_stairs", accent: "minecraft:mossy_cobblestone" },
    requiredClearance: { wall: 20, tower: 20, perimeter: 20 },
    layout: {
      room: { fMin: -31, fMax: -24, sMin: -68, sMax: -62, height: 5, door: { f: -24, s: -65, cardinal: "east" } },
      quietFire: { f: -28, s: -65 },
      benches: [{ f: -30, s: -66 }, { f: -26, s: -66 }, { f: -28, s: -63 }],
      signs: [{ f: -36, s: -69 }, { f: -34, s: -60 }],
      trees: [{ f: -36, s: -66 }, { f: -34, s: -70 }, { f: -34, s: -60 }],
      lights: [{ f: -30, s: -67, up: 3 }, { f: -25, s: -63, up: 3 }, { f: -36, s: -66, up: 3 }]
    },
    interiorZones: [
      { id: "memory_pavilion", bounds: rect(-30, -25, -67, -63), purpose: "seating_and_quiet_fire" },
      { id: "grove_walk", bounds: rect(-38, -32, -71, -59), purpose: "memorial_trees_and_markers" }
    ],
    focalBlocks: [{ f: -28, s: -65, up: 0, typeId: "minecraft:campfire" }, { f: -36, s: -69, up: 0, typeId: "minecraft:standing_sign" }],
    lights: [{ f: -30, s: -67, up: 3, typeId: "minecraft:lantern" }, { f: -25, s: -63, up: 3, typeId: "minecraft:lantern" }, { f: -36, s: -66, up: 3, typeId: "minecraft:lantern" }]
  }),
  building({
    id: "village_infirmary",
    futureLevel: 17,
    questArcId: "special.oath_of_care",
    bounds: rect(-38, -22, 58, 72),
    footprint: rect(-38, -22, 58, 72),
    entry: { f: -25, s: 64, up: 0, cardinal: "east" },
    entryPath: rect(-24, -22, 63, 64),
    roadLink: { type: "pedestrian_path", axis: "side", width: 2 },
    approach: { axis: "side", width: 2, bounds: rect(-21, -2, 63, 64), side: "fMax" },
    palette: { foundation: "minecraft:stone_bricks", wall: "minecraft:birch_planks", timber: "minecraft:birch_log", roof: "minecraft:spruce_stairs", accent: "minecraft:calcite" },
    requiredClearance: { wall: 20, tower: 20, perimeter: 20 },
    layout: {
      room: { fMin: -36, fMax: -25, sMin: 60, sMax: 69, height: 5, door: { f: -25, s: 64, cardinal: "east" } },
      screens: [{ f: -31, s: 61 }, { f: -31, s: 66 }],
      utility: { f: -27, s: 62 },
      lights: [{ f: -35, s: 61, up: 3 }, { f: -26, s: 68, up: 3 }, { f: -28, s: 63, up: 3 }]
    },
    interiorZones: [
      { id: "ward_a", bounds: rect(-35, -32, 61, 68), purpose: "beds_and_privacy_screen" },
      { id: "care_utility_nook", bounds: rect(-30, -26, 61, 68), purpose: "decorative_brewing_and_storage" }
    ],
    focalBlocks: [{ f: -27, s: 62, up: 0, typeId: "minecraft:brewing_stand" }, { f: -27, s: 63, up: 0, typeId: "minecraft:cauldron" }],
    beds: [{ f: -34, s: 67, up: 0, typeId: "minecraft:bed" }, { f: -34, s: 63, up: 0, typeId: "minecraft:bed" }],
    storage: [{ f: -27, s: 66, up: 0, typeId: "minecraft:barrel" }],
    workstations: [{ f: -27, s: 62, up: 0, typeId: "minecraft:brewing_stand" }],
    lights: [{ f: -35, s: 61, up: 3, typeId: "minecraft:lantern" }, { f: -26, s: 68, up: 3, typeId: "minecraft:lantern" }, { f: -28, s: 63, up: 3, typeId: "minecraft:lantern" }]
  }),
  building({
    id: "civic_workshop",
    futureLevel: 18,
    questArcId: "special.tools_for_all",
    bounds: rect(68, 72, 56, 70),
    footprint: rect(68, 72, 56, 70),
    entry: { f: 69, s: 68, up: 0, cardinal: "west" },
    entryPath: rect(68, 69, 68, 69),
    roadLink: { type: "pedestrian_path", axis: "side", width: 2 },
    approach: { axis: "side", width: 2, bounds: rect(2, 67, 68, 69), side: "fMin" },
    palette: { foundation: "minecraft:cobblestone", wall: "minecraft:spruce_planks", timber: "minecraft:stripped_spruce_log", roof: "minecraft:spruce_stairs", accent: "minecraft:stone_bricks" },
    requiredClearance: { wall: 20, tower: 20, perimeter: 20 },
    layout: {
      room: { fMin: 69, fMax: 71, sMin: 60, sMax: 69, height: 5, door: { f: 69, s: 68, cardinal: "west" } },
      canopy: { fMin: 68, fMax: 72, sMin: 56, sMax: 58 },
      assembly: { f: 70, s: 61 },
      storage: { f: 70, s: 68 },
      lights: [{ f: 69, s: 61, up: 3 }, { f: 71, s: 68, up: 3 }, { f: 68, s: 57, up: 2 }]
    },
    interiorZones: [
      { id: "assembly_bay", bounds: rect(69, 71, 60, 65), purpose: "decorative_workstations" },
      { id: "storage_and_canopy", bounds: rect(68, 72, 56, 69), purpose: "storage_and_loading_shelter" }
    ],
    focalBlocks: [{ f: 70, s: 61, up: 0, typeId: "minecraft:crafting_table" }, { f: 70, s: 63, up: 0, typeId: "minecraft:stonecutter_block" }, { f: 70, s: 65, up: 0, typeId: "minecraft:smithing_table" }],
    storage: [{ f: 70, s: 66, up: 0, typeId: "minecraft:chest" }, { f: 70, s: 68, up: 0, typeId: "minecraft:barrel" }],
    workstations: [{ f: 70, s: 61, up: 0, typeId: "minecraft:crafting_table" }, { f: 70, s: 63, up: 0, typeId: "minecraft:stonecutter_block" }, { f: 70, s: 65, up: 0, typeId: "minecraft:smithing_table" }],
    lights: [{ f: 69, s: 61, up: 3, typeId: "minecraft:lantern" }, { f: 71, s: 68, up: 3, typeId: "minecraft:lantern" }, { f: 68, s: 57, up: 2, typeId: "minecraft:lantern" }]
  })
]);

export const SPECIAL_BUILDING_IDS = Object.freeze(SPECIAL_BUILDINGS.map((spec) => spec.id));

export function specialBuildingForId(id) {
  return SPECIAL_BUILDINGS.find((spec) => spec.id === id) || null;
}

function inside(bounds, f, s) {
  return f >= bounds.fMin && f <= bounds.fMax && s >= bounds.sMin && s <= bounds.sMax;
}

function assertInside(bounds, f1, f2, s1, s2, label) {
  const minF = Math.min(f1, f2), maxF = Math.max(f1, f2);
  const minS = Math.min(s1, s2), maxS = Math.max(s1, s2);
  if (!inside(bounds, minF, minS) || !inside(bounds, maxF, maxS)) throw new Error(`${label} leaves approved special footprint`);
}

function boundedPlacer(dimension, origin, facing, bounds) {
  const raw = makePlacer(dimension, origin, facing);
  return {
    ...raw,
    block(f, s, up, typeId, states) {
      assertInside(bounds, f, f, s, s, `block ${typeId}`);
      raw.block(f, s, up, typeId, states);
    },
    blockMulti(f, s, up, typeId, candidates) {
      assertInside(bounds, f, f, s, s, `oriented block ${typeId}`);
      raw.blockMulti(f, s, up, typeId, candidates);
    },
    box(f1, s1, u1, f2, s2, u2, typeId, states) {
      assertInside(bounds, f1, f2, s1, s2, `box ${typeId}`);
      raw.box(f1, s1, u1, f2, s2, u2, typeId, states);
    }
  };
}

function roomShell(placer, room, palette) {
  const { fMin, fMax, sMin, sMax, height, door } = room;
  placer.box(fMin, sMin, -1, fMax, sMax, -1, palette.foundation);
  placer.box(fMin, sMin, 0, fMax, sMax, 0, palette.wall);
  for (let up = 1; up < height; up++) {
    placer.box(fMin, sMin, up, fMax, sMin, up, palette.wall);
    placer.box(fMin, sMax, up, fMax, sMax, up, palette.wall);
    placer.box(fMin, sMin, up, fMin, sMax, up, palette.wall);
    placer.box(fMax, sMin, up, fMax, sMax, up, palette.wall);
  }
  for (const f of [fMin, fMax]) for (const s of [sMin, sMax]) placer.box(f, s, 0, f, s, height - 1, palette.timber);
  placer.box(fMin + 1, sMin + 1, 0, fMax - 1, sMax - 1, height - 1, "minecraft:air");
  placer.box(fMin + 1, sMin + 1, -1, fMax - 1, sMax - 1, -1, palette.wall);
  placer.block(door.f, door.s, 0, "minecraft:air");
  placer.block(door.f, door.s, 1, "minecraft:air");
  placeDoor(placer, door.f, door.s, 0, "minecraft:wooden_door", door.cardinal);
}

function roofWithEaves(placer, room, palette) {
  const { fMin, fMax, sMin, sMax, height } = room;
  const baseUp = height;
  const ridgeDistance = Math.floor((sMax - sMin) / 2);
  for (let s = sMin; s <= sMax; s++) {
    const distance = Math.min(s - sMin, sMax - s);
    const surfaceUp = baseUp + distance;
    if (surfaceUp - 1 >= baseUp) placer.box(fMin, s, baseUp, fMax, s, surfaceUp - 1, palette.wall);
    if (distance === ridgeDistance) placer.box(fMin, s, surfaceUp, fMax, s, surfaceUp, palette.timber);
    else {
      const cardinal = (s - sMin) <= (sMax - s) ? MINUS_SIDE[placer.facing] : PLUS_SIDE[placer.facing];
      for (let f = fMin; f <= fMax; f++) stairs(placer, f, s, surfaceUp, palette.roof, cardinal, false);
    }
  }
  for (let f = fMin - 1; f <= fMax + 1; f++) {
    stairs(placer, f, sMin - 1, baseUp - 1, palette.roof, MINUS_SIDE[placer.facing], true);
    stairs(placer, f, sMax + 1, baseUp - 1, palette.roof, PLUS_SIDE[placer.facing], true);
  }
  return { fMin: fMin - 1, fMax: fMax + 1, sMin: sMin - 1, sMax: sMax + 1, wallTop: height - 1, ridgeUp: baseUp + ridgeDistance };
}

function pave(placer, bounds) {
  placer.box(bounds.fMin, bounds.sMin, -1, bounds.fMax, bounds.sMax, -1, "minecraft:gravel");
}

function light(placer, point) {
  placer.block(point.f, point.s, point.up, "minecraft:lantern", { hanging: true });
}

function placeTree(placer, point) {
  placer.box(point.f, point.s, 0, point.f, point.s, 2, "minecraft:oak_log");
  placer.box(point.f - 1, point.s - 1, 3, point.f + 1, point.s + 1, 4, "minecraft:oak_leaves");
  placer.block(point.f, point.s, 5, "minecraft:oak_leaves");
}

function buildMemorial(placer, spec) {
  const { room, quietFire, benches, signs, trees, lights } = spec.layout;
  roomShell(placer, room, spec.palette);
  const roof = roofWithEaves(placer, room, spec.palette);
  pave(placer, spec.entryPath);
  for (const bench of benches) stairs(placer, bench.f, bench.s, 0, "minecraft:oak_stairs", PLUS_FORWARD[placer.facing], false);
  for (const sign of signs) placer.block(sign.f, sign.s, 0, "minecraft:standing_sign");
  for (const tree of trees) placeTree(placer, tree);
  placer.block(quietFire.f, quietFire.s, 0, "minecraft:campfire", { extinguished: false });
  for (const point of lights) light(placer, point);
  return { rooms: [room], roofSpecs: [roof] };
}

function buildInfirmary(placer, spec) {
  const { room, screens, utility, lights } = spec.layout;
  roomShell(placer, room, spec.palette);
  const roof = roofWithEaves(placer, room, spec.palette);
  pave(placer, spec.entryPath);
  for (const screen of screens) placer.box(screen.f, screen.s, 0, screen.f, screen.s + 1, 1, "minecraft:oak_fence");
  for (const bed of spec.beds) placeBed(placer, bed.f, bed.s, bed.up, PLUS_SIDE[placer.facing]);
  facingBlock(placer, utility.f, utility.s, 0, "minecraft:brewing_stand", MINUS_FORWARD[placer.facing]);
  placer.block(utility.f, utility.s + 1, 0, "minecraft:cauldron");
  for (const slot of spec.storage) facingBlock(placer, slot.f, slot.s, slot.up, slot.typeId, MINUS_SIDE[placer.facing]);
  for (const point of lights) light(placer, point);
  return { rooms: [room], roofSpecs: [roof] };
}

function buildWorkshop(placer, spec) {
  const { room, canopy, assembly, storage, lights } = spec.layout;
  roomShell(placer, room, spec.palette);
  const roof = roofWithEaves(placer, room, spec.palette);
  pave(placer, spec.entryPath);
  placer.box(canopy.fMin, canopy.sMin, -1, canopy.fMax, canopy.sMax, -1, "minecraft:gravel");
  for (const f of [canopy.fMin, canopy.fMax]) for (const s of [canopy.sMin, canopy.sMax]) placer.box(f, s, 0, f, s, 2, "minecraft:spruce_log");
  for (let f = canopy.fMin; f <= canopy.fMax; f++) stairs(placer, f, canopy.sMin, 3, "minecraft:spruce_stairs", MINUS_SIDE[placer.facing], false);
  for (const slot of spec.workstations) facingBlock(placer, slot.f, slot.s, slot.up, slot.typeId, PLUS_SIDE[placer.facing]);
  for (const slot of spec.storage) facingBlock(placer, slot.f, slot.s, slot.up, slot.typeId, MINUS_SIDE[placer.facing]);
  placer.block(assembly.f, assembly.s - 2, 0, "minecraft:anvil");
  placer.block(canopy.fMin + 1, canopy.sMax, 0, "minecraft:oak_fence");
  for (const point of lights) light(placer, point);
  return { rooms: [room, canopy], roofSpecs: [roof, { ...canopy, wallTop: 2, ridgeUp: 3 }] };
}

const BUILDERS = Object.freeze({
  memorial_grove: buildMemorial,
  village_infirmary: buildInfirmary,
  civic_workshop: buildWorkshop
});

function validateSpecialSpec(spec) {
  if (!spec || !BUILDERS[spec.id]) throw new Error(`unsupported special building: ${spec?.id}`);
  if (spec.kind !== "special_story" || touchesRoadAxis(spec.bounds)) throw new Error(`invalid special spatial contract: ${spec.id}`);
  if (minimumWallClearance(spec.bounds) < spec.requiredClearance.wall || minimumTowerClearance(spec.bounds) < spec.requiredClearance.tower) {
    throw new Error(`special building violates perimeter clearance: ${spec.id}`);
  }
  const allExisting = [
    ...SPATIAL_PLAN.flatMap((entry) => [entry.bounds, ...entry.reserveEnvelopes.map((reserve) => reserve.bounds)]),
    ...LEGACY_L1_10_ENVELOPES.map((entry) => entry.bounds),
    LEGACY_SPECIAL_RESERVATION.bounds
  ];
  if (allExisting.some((bounds) => rectanglesOverlap(bounds, spec.bounds))) throw new Error(`special building overlaps existing allocation: ${spec.id}`);
  const road = ROAD_AXES[spec.approach.axis];
  if (!road || spec.approach.width < 2) throw new Error(`invalid special approach: ${spec.id}`);
  const peers = SPECIAL_BUILDINGS.filter((peer) => peer.id !== spec.id);
  if (peers.some((peer) => rectanglesOverlap(peer.bounds, spec.bounds) || rectanglesOverlap(peer.bounds, spec.approach.bounds))) {
    throw new Error(`special building or connector overlaps another special allocation: ${spec.id}`);
  }
  if (allExisting.some((bounds) => rectanglesOverlap(bounds, spec.approach.bounds))) {
    throw new Error(`special connector overlaps an existing allocation: ${spec.id}`);
  }
  return spec;
}

/**
 * Builds one detached future special object and its exact two-block connector.
 * No dynamic property, entity, inventory, quest, reward or runtime level state
 * is read or written here.
 */
export function buildSpecialBuilding(dimension, origin, facing, id) {
  const spec = validateSpecialSpec(specialBuildingForId(id));
  prepareSite(dimension, origin, facing, spec.footprint.fMin, spec.footprint.fMax, spec.footprint.sMin, spec.footprint.sMax, {
    padding: 0,
    clearHeight: 12,
    fillDepth: 5,
    surfaceBlock: "minecraft:grass_block"
  });
  prepareSite(dimension, origin, facing, spec.approach.bounds.fMin, spec.approach.bounds.fMax, spec.approach.bounds.sMin, spec.approach.bounds.sMax, {
    padding: 0,
    clearHeight: 5,
    fillDepth: 4,
    surfaceBlock: "minecraft:grass_block"
  });

  const raw = makePlacer(dimension, origin, facing);
  for (let f = spec.approach.bounds.fMin; f <= spec.approach.bounds.fMax; f++) {
    for (let s = spec.approach.bounds.sMin; s <= spec.approach.bounds.sMax; s++) {
      raw.block(f, s, -1, "minecraft:gravel");
      for (let up = 0; up <= 3; up++) raw.block(f, s, up, "minecraft:air");
    }
  }

  const placer = boundedPlacer(dimension, origin, facing, spec.footprint);
  const result = BUILDERS[spec.id](placer, spec);
  return Object.freeze({
    ...spec,
    bounds: cloneRect(spec.bounds),
    footprint: cloneRect(spec.footprint),
    entry: { ...spec.entry },
    entryPath: cloneRect(spec.entryPath),
    approach: { ...spec.approach, bounds: cloneRect(spec.approach.bounds) },
    interiorZones: spec.interiorZones.map((zone) => ({ ...zone, bounds: cloneRect(zone.bounds) })),
    roofSpecs: result.roofSpecs.map((roof) => ({ ...roof })),
    rooms: result.rooms.map((room) => ({ ...room })),
    terrainBounds: Object.freeze({ footprint: cloneRect(spec.footprint), connector: cloneRect(spec.approach.bounds) })
  });
}
