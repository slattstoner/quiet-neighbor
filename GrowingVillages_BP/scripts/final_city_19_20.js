import {
  FINAL_RADIUS,
  ROAD_AXES,
  SPATIAL_PLAN,
  LEGACY_L1_10_ENVELOPES,
  LEGACY_SPECIAL_RESERVATION,
  minimumTowerClearance,
  minimumWallClearance,
  rectanglesOverlap,
  touchesRoadAxis
} from "./spatial_plan.js";
import { prepareSite } from "./terrain.js";
import { makePlacer, placeDoor, facingBlock, stairs } from "./builder.js";

/**
 * Detached final-city foundation for future L19–20.
 *
 * This module deliberately has no progression, quest, NPC, UI, economy or
 * world-global dependency. It owns the only local coordinates for the final
 * ensemble. A later coordinator-approved owner merge must reconcile its IDs
 * with the future chapter contract before any runtime import is allowed.
 */

const PLUS_SIDE = ["south", "north", "east", "west"];
const MINUS_SIDE = ["north", "south", "west", "east"];
const PLUS_FORWARD = ["east", "west", "south", "north"];

function rect(fMin, fMax, sMin, sMax) {
  if (![fMin, fMax, sMin, sMax].every(Number.isInteger) || fMin > fMax || sMin > sMax) {
    throw new Error(`invalid final-city bounds: ${fMin}..${fMax}/${sMin}..${sMax}`);
  }
  return Object.freeze({ fMin, fMax, sMin, sMax });
}

function cloneRect(bounds) {
  return { fMin: bounds.fMin, fMax: bounds.fMax, sMin: bounds.sMin, sMax: bounds.sMax };
}

function point(value) {
  return Object.freeze({ ...value });
}

function finalRecord(spec) {
  return Object.freeze({
    ...spec,
    bounds: rect(spec.bounds.fMin, spec.bounds.fMax, spec.bounds.sMin, spec.bounds.sMax),
    footprint: rect(spec.footprint.fMin, spec.footprint.fMax, spec.footprint.sMin, spec.footprint.sMax),
    entry: Object.freeze({ ...spec.entry }),
    entryPath: rect(spec.entryPath.fMin, spec.entryPath.fMax, spec.entryPath.sMin, spec.entryPath.sMax),
    connector: Object.freeze({ ...spec.connector, bounds: rect(spec.connector.bounds.fMin, spec.connector.bounds.fMax, spec.connector.bounds.sMin, spec.connector.bounds.sMax) }),
    roadLink: Object.freeze({ ...spec.roadLink }),
    palette: Object.freeze({ ...spec.palette }),
    clearance: Object.freeze({ ...spec.clearance }),
    roofContract: Object.freeze({ ...spec.roofContract }),
    noService: Object.freeze({ ...spec.noService }),
    layout: Object.freeze({ ...spec.layout }),
    interiorZones: Object.freeze(spec.interiorZones.map((zone) => Object.freeze({ ...zone, bounds: rect(zone.bounds.fMin, zone.bounds.fMax, zone.bounds.sMin, zone.bounds.sMax), anchor: point(zone.anchor) }))),
    focalBlocks: Object.freeze(spec.focalBlocks.map(point)),
    storage: Object.freeze((spec.storage || []).map(point)),
    lights: Object.freeze(spec.lights.map(point)),
    navigation: Object.freeze({ ...spec.navigation, anchors: Object.freeze(spec.navigation.anchors.map(point)) }),
    kind: "final_city"
  });
}

/**
 * The authoritative final-city spatial addendum. It does not modify the
 * existing 22-record SPATIAL_PLAN because future runtime/quest owners remain
 * intentionally unchanged in this stage.
 */
export const FINAL_CITY_BUILDINGS = Object.freeze([
  finalRecord({
    id: "founders_hall",
    futureLevel: 19,
    bounds: rect(-42, -30, -16, -4),
    footprint: rect(-42, -30, -16, -4),
    entry: { f: -37, s: -5, up: 0, cardinal: "south" },
    entryPath: rect(-38, -37, -5, -4),
    connector: { axis: "forward", width: 2, bounds: rect(-38, -37, -3, -2), side: "sMax" },
    roadLink: { type: "pedestrian_path", axis: "forward", width: 2 },
    palette: { foundation: "minecraft:stone_bricks", wall: "minecraft:oak_planks", timber: "minecraft:dark_oak_log", roof: "minecraft:dark_oak_stairs", accent: "minecraft:chiseled_stone_bricks" },
    clearance: { wall: 20, tower: 20, perimeter: 20 },
    roofContract: { type: "gabled_eaves_ridge", requiresEaves: true, requiresRidge: true },
    noService: { enabled: true, reason: "decor_only_no_items_entities_rewards_or_runtime_services" },
    layout: {
      room: { fMin: -40, fMax: -32, sMin: -14, sMax: -5, height: 6, door: { f: -37, s: -5, cardinal: "south" } },
      meetingTable: { fMin: -36, fMax: -35, sMin: -9, sMax: -8 },
      benches: [{ f: -39, s: -9 }, { f: -33, s: -9 }, { f: -39, s: -11 }, { f: -33, s: -11 }],
      archive: { lectern: { f: -34, s: -12 }, bookshelf: { f: -39, s: -12 }, barrel: { f: -34, s: -13 } },
      hearth: { f: -38, s: -12 },
      lights: [{ f: -39, s: -6, up: 4 }, { f: -33, s: -6, up: 4 }, { f: -37, s: -13, up: 4 }]
    },
    interiorZones: [
      { id: "assembly_floor", bounds: rect(-39, -33, -10, -6), anchor: { f: -37, s: -7, up: 0 }, purpose: "meeting_table_and_benches" },
      { id: "memory_archive", bounds: rect(-39, -33, -14, -11), anchor: { f: -35, s: -13, up: 0 }, purpose: "lectern_bookshelf_and_barrel_detail" },
      { id: "hearth_or_council_corner", bounds: rect(-39, -36, -13, -11), anchor: { f: -37, s: -11, up: 0 }, purpose: "safe_campfire_and_council_corner" }
    ],
    focalBlocks: [
      { f: -36, s: -9, up: 0, typeId: "minecraft:oak_planks" },
      { f: -34, s: -12, up: 0, typeId: "minecraft:lectern" },
      { f: -38, s: -12, up: 0, typeId: "minecraft:campfire" }
    ],
    storage: [{ f: -34, s: -13, up: 0, typeId: "minecraft:barrel" }],
    lights: [{ f: -39, s: -6, up: 4, typeId: "minecraft:lantern" }, { f: -33, s: -6, up: 4, typeId: "minecraft:lantern" }, { f: -37, s: -13, up: 4, typeId: "minecraft:lantern" }],
    navigation: { anchors: [{ f: -37, s: -6, up: 0 }, { f: -37, s: -7, up: 0 }, { f: -33, s: -12, up: 0 }, { f: -37, s: -11, up: 0 }], independentRoutes: 2 }
  }),
  finalRecord({
    id: "village_beacon",
    futureLevel: 20,
    bounds: rect(68, 72, 18, 30),
    footprint: rect(68, 72, 18, 30),
    entry: { f: 69, s: 20, up: 0, cardinal: "west" },
    entryPath: rect(68, 69, 19, 20),
    connector: { axis: "side", width: 2, bounds: rect(2, 67, 19, 20), side: "fMin" },
    roadLink: { type: "pedestrian_path", axis: "side", width: 2 },
    palette: { foundation: "minecraft:stone_bricks", wall: "minecraft:stone_bricks", timber: "minecraft:dark_oak_log", roof: "minecraft:dark_oak_stairs", accent: "minecraft:deepslate_tiles" },
    clearance: { wall: 20, tower: 20, perimeter: 20 },
    roofContract: { type: "crowned_railed_viewing_platform", requiresEaves: true, requiresCrown: true, railingPolicy: "continuous_fence_except_ladder_exit" },
    noService: { enabled: true, reason: "no_minecraft_beacon_block_or_effect_service" },
    layout: {
      tower: { fMin: 69, fMax: 71, sMin: 20, sMax: 28, height: 9, door: { f: 69, s: 20, cardinal: "west" } },
      ladder: { f: 70, s: 21, upMin: 0, upMax: 8 },
      lanternRoom: { f: 70, s: 24, up: 2 },
      platform: { fMin: 68, fMax: 72, sMin: 22, sMax: 26, up: 9 },
      crown: { f: 70, s: 24, upMin: 10, upMax: 12 },
      lights: [{ f: 70, s: 24, up: 2 }, { f: 70, s: 24, up: 12 }, { f: 68, s: 22, up: 11 }, { f: 72, s: 26, up: 11 }]
    },
    interiorZones: [
      { id: "ground_lantern_room", bounds: rect(69, 71, 20, 25), anchor: { f: 70, s: 24, up: 0 }, purpose: "safe_ground_entry_and_lantern" },
      { id: "stair_or_ladder_core", bounds: rect(70, 70, 21, 21), anchor: { f: 70, s: 21, up: 4 }, purpose: "vertical_ladder_core" },
      { id: "viewing_platform", bounds: rect(68, 72, 22, 26), anchor: { f: 70, s: 24, up: 9 }, purpose: "railed_overlook_without_beacon_service" }
    ],
    focalBlocks: [{ f: 70, s: 24, up: 2, typeId: "minecraft:lantern" }, { f: 70, s: 21, up: 4, typeId: "minecraft:ladder" }, { f: 70, s: 24, up: 12, typeId: "minecraft:soul_lantern" }],
    lights: [{ f: 70, s: 24, up: 2, typeId: "minecraft:lantern" }, { f: 70, s: 24, up: 12, typeId: "minecraft:soul_lantern" }, { f: 68, s: 22, up: 11, typeId: "minecraft:lantern" }, { f: 72, s: 26, up: 11, typeId: "minecraft:lantern" }],
    navigation: { anchors: [{ f: 70, s: 21, up: 0 }, { f: 70, s: 21, up: 4 }, { f: 70, s: 24, up: 9 }], independentRoutes: 1 }
  })
]);

export const FINAL_CITY_BUILDING_IDS = Object.freeze(FINAL_CITY_BUILDINGS.map((record) => record.id));

export function finalCityBuildingForId(id) {
  return FINAL_CITY_BUILDINGS.find((record) => record.id === id) || null;
}

function inside(bounds, f, s) {
  return f >= bounds.fMin && f <= bounds.fMax && s >= bounds.sMin && s <= bounds.sMax;
}

function assertInside(bounds, f1, f2, s1, s2, label) {
  const minF = Math.min(f1, f2), maxF = Math.max(f1, f2);
  const minS = Math.min(s1, s2), maxS = Math.max(s1, s2);
  if (!inside(bounds, minF, minS) || !inside(bounds, maxF, maxS)) throw new Error(`${label} leaves approved final-city footprint`);
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

function gabledRoof(placer, room, palette) {
  const { fMin, fMax, sMin, sMax, height } = room;
  const baseUp = height;
  const ridgeDistance = Math.floor((sMax - sMin) / 2);
  for (let s = sMin; s <= sMax; s++) {
    const distance = Math.min(s - sMin, sMax - s);
    const surfaceUp = baseUp + distance;
    if (surfaceUp - 1 >= baseUp) placer.box(fMin, s, baseUp, fMax, s, surfaceUp - 1, palette.wall);
    if (distance === ridgeDistance) placer.box(fMin, s, surfaceUp, fMax, s, surfaceUp, palette.timber);
    else {
      const direction = (s - sMin) <= (sMax - s) ? MINUS_SIDE[placer.facing] : PLUS_SIDE[placer.facing];
      for (let f = fMin; f <= fMax; f++) stairs(placer, f, s, surfaceUp, palette.roof, direction, false);
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

function lantern(placer, slot) {
  placer.block(slot.f, slot.s, slot.up, slot.typeId, { hanging: true });
}

function buildFoundersHall(placer, spec) {
  const { room, meetingTable, benches, archive, hearth, lights } = spec.layout;
  roomShell(placer, room, spec.palette);
  const roof = gabledRoof(placer, room, spec.palette);
  pave(placer, spec.entryPath);
  placer.box(meetingTable.fMin, meetingTable.sMin, 0, meetingTable.fMax, meetingTable.sMax, 0, "minecraft:oak_planks");
  for (const bench of benches) stairs(placer, bench.f, bench.s, 0, "minecraft:oak_stairs", PLUS_FORWARD[placer.facing], false);
  facingBlock(placer, archive.lectern.f, archive.lectern.s, 0, "minecraft:lectern", MINUS_SIDE[placer.facing]);
  placer.block(archive.bookshelf.f, archive.bookshelf.s, 0, "minecraft:bookshelf");
  facingBlock(placer, archive.barrel.f, archive.barrel.s, 0, "minecraft:barrel", MINUS_SIDE[placer.facing]);
  placer.block(hearth.f, hearth.s, 0, "minecraft:campfire", { extinguished: false });
  for (const slot of lights) lantern(placer, { ...slot, typeId: "minecraft:lantern" });
  return { rooms: [room], roofSpecs: [roof] };
}

function buildBeacon(placer, spec) {
  const { tower, ladder, lanternRoom, platform, crown, lights } = spec.layout;
  roomShell(placer, tower, spec.palette);
  pave(placer, spec.entryPath);
  for (let up = ladder.upMin; up <= ladder.upMax; up++) placer.block(ladder.f, ladder.s, up, "minecraft:ladder");
  placer.block(lanternRoom.f, lanternRoom.s, lanternRoom.up, "minecraft:lantern", { hanging: true });
  placer.box(platform.fMin, platform.sMin, platform.up, platform.fMax, platform.sMax, platform.up, "minecraft:dark_oak_planks");
  for (let f = platform.fMin; f <= platform.fMax; f++) {
    for (const s of [platform.sMin, platform.sMax]) placer.block(f, s, platform.up + 1, "minecraft:dark_oak_fence");
  }
  for (let s = platform.sMin + 1; s <= platform.sMax - 1; s++) {
    for (const f of [platform.fMin, platform.fMax]) placer.block(f, s, platform.up + 1, "minecraft:dark_oak_fence");
  }
  for (let up = crown.upMin; up <= crown.upMax - 1; up++) placer.block(crown.f, crown.s, up, "minecraft:dark_oak_fence");
  placer.block(crown.f, crown.s, crown.upMax, "minecraft:soul_lantern", { hanging: true });
  for (const slot of lights) {
    if (slot.f === crown.f && slot.s === crown.s && slot.up === crown.upMax) continue;
    lantern(placer, { ...slot, typeId: "minecraft:lantern" });
  }
  return {
    rooms: [tower],
    roofSpecs: [{ fMin: platform.fMin, fMax: platform.fMax, sMin: platform.sMin, sMax: platform.sMax, wallTop: tower.height - 1, ridgeUp: crown.upMax, type: "railed_crown" }],
    platform: { ...platform, railingUp: platform.up + 1, crown: { ...crown } }
  };
}

const BUILDERS = Object.freeze({ founders_hall: buildFoundersHall, village_beacon: buildBeacon });

function validateFinalRecord(spec) {
  if (!spec || !BUILDERS[spec.id]) throw new Error(`unsupported final city building: ${spec?.id}`);
  if (spec.kind !== "final_city" || touchesRoadAxis(spec.bounds)) throw new Error(`invalid final city spatial contract: ${spec.id}`);
  if (minimumWallClearance(spec.bounds) < spec.clearance.wall || minimumTowerClearance(spec.bounds) < spec.clearance.tower) {
    throw new Error(`final city building violates wall/tower clearance: ${spec.id}`);
  }
  const existing = [
    ...SPATIAL_PLAN.flatMap((entry) => [entry.bounds, ...entry.reserveEnvelopes.map((reserve) => reserve.bounds)]),
    ...LEGACY_L1_10_ENVELOPES.map((entry) => entry.bounds),
    LEGACY_SPECIAL_RESERVATION.bounds
  ];
  if (existing.some((bounds) => rectanglesOverlap(bounds, spec.bounds) || rectanglesOverlap(bounds, spec.connector.bounds))) {
    throw new Error(`final city building or connector overlaps current allocation: ${spec.id}`);
  }
  const peer = FINAL_CITY_BUILDINGS.find((item) => item.id !== spec.id && (rectanglesOverlap(item.bounds, spec.bounds) || rectanglesOverlap(item.bounds, spec.connector.bounds)));
  if (peer) throw new Error(`final city building overlaps peer final allocation: ${spec.id}`);
  const road = ROAD_AXES[spec.connector.axis];
  if (!road || spec.connector.width !== 2) throw new Error(`invalid final-city connector width: ${spec.id}`);
  const joinsRoad = spec.connector.axis === "forward"
    ? (spec.connector.bounds.sMin <= road.bounds.sMax + 1 && spec.connector.bounds.sMax >= road.bounds.sMin - 1)
    : (spec.connector.bounds.fMin <= road.bounds.fMax + 1 && spec.connector.bounds.fMax >= road.bounds.fMin - 1);
  if (!joinsRoad || touchesRoadAxis(spec.connector.bounds)) throw new Error(`final-city connector fails road-edge contract: ${spec.id}`);
  return spec;
}

/** Builds one detached final-city object and its exact two-block pedestrian connector. */
export function buildFinalCityBuilding(dimension, origin, facing, id) {
  const spec = validateFinalRecord(finalCityBuildingForId(id));
  prepareSite(dimension, origin, facing, spec.footprint.fMin, spec.footprint.fMax, spec.footprint.sMin, spec.footprint.sMax, {
    padding: 0, clearHeight: 14, fillDepth: 5, surfaceBlock: "minecraft:grass_block"
  });
  prepareSite(dimension, origin, facing, spec.connector.bounds.fMin, spec.connector.bounds.fMax, spec.connector.bounds.sMin, spec.connector.bounds.sMax, {
    padding: 0, clearHeight: 5, fillDepth: 4, surfaceBlock: "minecraft:grass_block"
  });
  const connectorPlacer = makePlacer(dimension, origin, facing);
  for (let f = spec.connector.bounds.fMin; f <= spec.connector.bounds.fMax; f++) {
    for (let s = spec.connector.bounds.sMin; s <= spec.connector.bounds.sMax; s++) {
      connectorPlacer.block(f, s, -1, "minecraft:gravel");
      for (let up = 0; up <= 3; up++) connectorPlacer.block(f, s, up, "minecraft:air");
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
    connector: { ...spec.connector, bounds: cloneRect(spec.connector.bounds) },
    interiorZones: spec.interiorZones.map((zone) => ({ ...zone, bounds: cloneRect(zone.bounds), anchor: { ...zone.anchor } })),
    roofSpecs: result.roofSpecs.map((roof) => ({ ...roof })),
    rooms: result.rooms.map((room) => ({ ...room })),
    platform: result.platform ? { ...result.platform, crown: { ...result.platform.crown } } : null,
    terrainBounds: Object.freeze({ footprint: cloneRect(spec.footprint), connector: cloneRect(spec.connector.bounds) })
  });
}
