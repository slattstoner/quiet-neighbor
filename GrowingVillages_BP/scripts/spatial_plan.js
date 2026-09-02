/**
 * Canonical, runtime-neutral spatial contract for Growing Villages 1–20.
 *
 * This module intentionally imports nothing from Minecraft and performs no
 * world operation. It describes the future town layout only; existing L1–10
 * builders keep their legacy geometry until a later, explicitly approved
 * integration stage connects them to this data.
 */

export const FINAL_RADIUS = 94;
export const WALL_INNER_FACE = 93;
export const TOWER_INNER_FACE = 90;

const ROAD_HALF_WIDTH = 1;
const GATE_HALF_WIDTH = 2;

function rect(fMin, fMax, sMin, sMax) {
  if (![fMin, fMax, sMin, sMax].every(Number.isFinite) || fMin > fMax || sMin > sMax) {
    throw new Error(`invalid spatial bounds: ${fMin}..${fMax} / ${sMin}..${sMax}`);
  }
  return Object.freeze({ fMin, fMax, sMin, sMax });
}

function cloneRect(bounds) {
  return bounds ? { fMin: bounds.fMin, fMax: bounds.fMax, sMin: bounds.sMin, sMax: bounds.sMax } : null;
}

function planEntry({ level, buildingId, bounds, roadLink, reserveEnvelopes = [], note = "" }) {
  return Object.freeze({
    level,
    buildingId,
    bounds: rect(bounds.fMin, bounds.fMax, bounds.sMin, bounds.sMax),
    roadLink: Object.freeze({ ...roadLink }),
    reserveEnvelopes: Object.freeze(reserveEnvelopes.map((item) => Object.freeze({
      id: item.id,
      bounds: rect(item.bounds.fMin, item.bounds.fMax, item.bounds.sMin, item.bounds.sMax)
    }))),
    note
  });
}

/**
 * The only approved stages for fortifications. `castle_expand` deliberately
 * reuses castle material semantics; it is not a fourth wall tier.
 */
export const PERIMETER_SCHEDULE = Object.freeze([
  Object.freeze({ level: 5, tier: "palisade", radius: 44 }),
  Object.freeze({ level: 8, tier: "cobble", radius: 62 }),
  Object.freeze({ level: 10, tier: "castle", radius: 78 }),
  Object.freeze({ level: 15, tier: "castle_expand", radius: 94 })
]);

/** Three-block road arms that future builders must keep walkable to the gates. */
export const ROAD_AXES = Object.freeze({
  forward: Object.freeze({
    id: "forward",
    orientation: "forward",
    width: 3,
    bounds: rect(-FINAL_RADIUS, FINAL_RADIUS, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH)
  }),
  side: Object.freeze({
    id: "side",
    orientation: "side",
    width: 3,
    bounds: rect(-ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, -FINAL_RADIUS, FINAL_RADIUS)
  }),
  intersection: Object.freeze({
    id: "intersection",
    bounds: rect(-ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH)
  })
});

/**
 * Gate openings use the same five-block convention on every wall side. The
 * `axis` field makes the road-to-gate alignment data-driven for future code.
 */
export const GATE_SPECS = Object.freeze([
  Object.freeze({ id: "east_gate", edge: "fMax", fixed: { axis: "forward", value: FINAL_RADIUS }, span: { axis: "side", min: -GATE_HALF_WIDTH, max: GATE_HALF_WIDTH }, width: 5, roadAxis: "forward" }),
  Object.freeze({ id: "west_gate", edge: "fMin", fixed: { axis: "forward", value: -FINAL_RADIUS }, span: { axis: "side", min: -GATE_HALF_WIDTH, max: GATE_HALF_WIDTH }, width: 5, roadAxis: "forward" }),
  Object.freeze({ id: "south_gate", edge: "sMax", fixed: { axis: "side", value: FINAL_RADIUS }, span: { axis: "forward", min: -GATE_HALF_WIDTH, max: GATE_HALF_WIDTH }, width: 5, roadAxis: "side" }),
  Object.freeze({ id: "north_gate", edge: "sMin", fixed: { axis: "side", value: -FINAL_RADIUS }, span: { axis: "forward", min: -GATE_HALF_WIDTH, max: GATE_HALF_WIDTH }, width: 5, roadAxis: "side" })
]);

/**
 * One authoritative record per canonical buildingId. `bounds` is the core
 * envelope. All future attached work areas are held separately in
 * `reserveEnvelopes` and must be considered with the core during overlap and
 * clearance checks.
 */
export const SPATIAL_PLAN = Object.freeze([
  planEntry({ level: 1, buildingId: "town_hall", bounds: rect(2, 12, 2, 12), roadLink: { type: "civic_path", axis: "side", width: 2 }, note: "Civic hall and progress chest." }),
  planEntry({ level: 1, buildingId: "campfire", bounds: rect(-9, -3, 2, 8), roadLink: { type: "civic_path", axis: "side", width: 2 }, note: "Open communal camp, never on the road band." }),
  planEntry({ level: 1, buildingId: "starter_house", bounds: rect(2, 10, -10, -2), roadLink: { type: "civic_path", axis: "forward", width: 2 }, note: "Starter resident house." }),
  planEntry({
    level: 2,
    buildingId: "farmer_homestead",
    bounds: rect(11, 21, -20, -4),
    roadLink: { type: "plot_path", axis: "forward", width: 2 },
    reserveEnvelopes: [{ id: "farmer_quest_annex", bounds: rect(10, 36, -42, -22) }],
    note: "Core house, base field, and all five future farm upgrades."
  }),
  planEntry({
    level: 3,
    buildingId: "blacksmith_forge",
    bounds: rect(13, 21, 4, 16),
    roadLink: { type: "plot_path", axis: "forward", width: 2 },
    reserveEnvelopes: [{ id: "blacksmith_quest_yard", bounds: rect(40, 66, 22, 40) }],
    note: "Forge core and five-tier smithing yard reserve."
  }),
  planEntry({
    level: 4,
    buildingId: "cartographer_house",
    bounds: rect(-15, -4, -16, -4),
    roadLink: { type: "plot_path", axis: "forward", width: 2 },
    reserveEnvelopes: [{ id: "cartographer_quest_annex", bounds: rect(-42, -16, -40, -20) }],
    note: "Cartographer core and archive/route extension reserve."
  }),
  planEntry({ level: 5, buildingId: "fortification_palisade", bounds: rect(-16, -6, 22, 32), roadLink: { type: "pedestrian_path", axis: "side", width: 2 }, note: "The level record reserves a ward house; the actual palisade is defined by PERIMETER_SCHEDULE." }),
  planEntry({
    level: 6,
    buildingId: "miner_house",
    bounds: rect(-28, -18, 4, 20),
    roadLink: { type: "plot_path", axis: "forward", width: 2 },
    reserveEnvelopes: [{ id: "miner_quest_yard", bounds: rect(-42, -20, 24, 42) }],
    note: "Mine house, enclosed minehead and five-tier production yard reserve."
  }),
  planEntry({ level: 7, buildingId: "resident_house", bounds: rect(-28, -18, -16, -4), roadLink: { type: "plot_path", axis: "forward", width: 2 }, note: "Residential plot." }),
  planEntry({ level: 8, buildingId: "fortification_cobble", bounds: rect(23, 32, -16, -4), roadLink: { type: "plot_path", axis: "forward", width: 2 }, note: "The level record reserves a ward house; cobble wall radius is scheduled separately." }),
  planEntry({ level: 9, buildingId: "artisan_house", bounds: rect(24, 34, 4, 16), roadLink: { type: "plot_path", axis: "forward", width: 2 }, note: "Artisan or expanded residential plot." }),
  // fMin is 35, not 36: the ward house here is built while the R44 palisade is
  // still standing (this level raises R78 and takes R44 down straight after),
  // so its far end has to stop short of forward 44. Pulling the house back one
  // block to clear the ring puts its roof eaves at 35, and the envelope has to
  // contain every block the building actually places, eaves included.
  planEntry({ level: 10, buildingId: "fortification_castle", bounds: rect(35, 44, -16, -4), roadLink: { type: "plot_path", axis: "forward", width: 2 }, note: "The level record reserves a ward house; castle wall radius is scheduled separately." }),
  planEntry({ level: 11, buildingId: "market_square", bounds: rect(-42, -30, 6, 20), roadLink: { type: "pedestrian_path", axis: "forward", width: 2 }, note: "Market stalls and a public water feature." }),
  planEntry({ level: 12, buildingId: "granary_yard", bounds: rect(8, 36, 48, 66), roadLink: { type: "service_path", axis: "side", width: 2 }, note: "Storage, threshing and cart yard; no production-cap increase." }),
  planEntry({ level: 13, buildingId: "travellers_inn", bounds: rect(40, 66, -42, -18), roadLink: { type: "service_path", axis: "forward", width: 2 }, note: "Inn, stable and service yard." }),
  planEntry({ level: 14, buildingId: "guard_barracks", bounds: rect(-66, -44, -40, -18), roadLink: { type: "service_path", axis: "forward", width: 2 }, note: "Barracks and drill yard." }),
  planEntry({ level: 15, buildingId: "village_archive", bounds: rect(-18, -4, 46, 62), roadLink: { type: "service_path", axis: "side", width: 2 }, note: "Archive and map court; this level expands the existing castle wall to R94." })
]);

/**
 * L16-20 are deliberately NOT in SPATIAL_PLAN.
 *
 * They were, once - as five reservations for `ranger_lodge`,
 * `mercy_infirmary`, `engineer_workshop`, `commons_infrastructure` and
 * `grand_council_hall`. None of those five was ever built. By the time the
 * L16-20 runtime landed, its buildings were `memorial_grove`,
 * `village_infirmary`, `civic_workshop`, `founders_hall` and
 * `village_beacon`, on entirely different ground - and the last two old names
 * are on progression_16_20.js's explicit forbidden list, so the rename was
 * settled, not pending.
 *
 * That left five rectangles reserving ground for buildings that will never
 * exist, and because both L16-20 validators check `spec.bounds` against every
 * SPATIAL_PLAN rect, the buildings that DO exist had to route around them.
 * The reservations were pure obstruction.
 *
 * Each L16-20 building now owns its own bounds beside its builder
 * (`SPECIAL_BUILDINGS` in special_buildings_16_18.js, `FINAL_CITY_BUILDINGS`
 * in final_city_19_20.js), which is also where its entry, connector and
 * interior geometry live - one place per building instead of two that can
 * drift. What SPATIAL_PLAN is the authority on is L1-15, and only that.
 *
 * The invariant those reservations were supposed to protect - that no two
 * allocations anywhere overlap - is not lost: it is asserted across both
 * modules at once in tests/extension_allocations.mjs, which is a stronger
 * check than the old one, since the old rects never matched what got built.
 */

export const CANONICAL_BUILDING_IDS = Object.freeze(SPATIAL_PLAN.map((entry) => entry.buildingId));

/** Existing merged special-content strip; final new envelopes must not consume it. */
export const LEGACY_SPECIAL_RESERVATION = Object.freeze({
  id: "legacy_special_strip",
  bounds: rect(45, 63, -15, 11)
});

/**
 * Conservative current L1–10 envelopes used only to prove that untouched
 * legacy runtime structures do not collide with planned new L11–20 envelopes.
 * They are not the new build instructions and must not be consumed by runtime.
 */
export const LEGACY_L1_10_ENVELOPES = Object.freeze([
  Object.freeze({ id: "legacy_town_hall", level: 1, bounds: rect(-1, 9, 1, 11) }),
  Object.freeze({ id: "legacy_campfire", level: 1, bounds: rect(-9, -3, -3, 3) }),
  Object.freeze({ id: "legacy_starter_house", level: 1, bounds: rect(-1, 7, -10, -2) }),
  Object.freeze({ id: "legacy_farmer", level: 2, bounds: rect(11, 19, -18, -6) }),
  Object.freeze({ id: "legacy_blacksmith", level: 3, bounds: rect(11, 19, 6, 15) }),
  Object.freeze({ id: "legacy_cartographer", level: 4, bounds: rect(-13, -5, -14, -6) }),
  Object.freeze({ id: "legacy_palisade_house", level: 5, bounds: rect(-13, -5, 6, 14) }),
  Object.freeze({ id: "legacy_miner", level: 6, bounds: rect(-27, -19, 6, 19) }),
  Object.freeze({ id: "legacy_resident", level: 7, bounds: rect(-27, -19, -14, -6) }),
  Object.freeze({ id: "legacy_cobble_house", level: 8, bounds: rect(25, 33, -14, -6) }),
  Object.freeze({ id: "legacy_artisan", level: 9, bounds: rect(25, 33, 6, 14) }),
  Object.freeze({ id: "legacy_castle_house", level: 10, bounds: rect(37, 45, -14, -6) })
]);

export function perimeterForRadius(radius) {
  if (!Number.isInteger(radius) || radius < 1) throw new Error(`radius must be a positive integer, got ${radius}`);
  return { fMin: -radius, fMax: radius, sMin: -radius, sMax: radius };
}

/** Returns a defensive copy of the core bounds and reserve envelopes for one ID. */
export function boundsFor(buildingId) {
  const entry = SPATIAL_PLAN.find((item) => item.buildingId === buildingId);
  if (!entry) return null;
  return {
    bounds: cloneRect(entry.bounds),
    reserveEnvelopes: entry.reserveEnvelopes.map((reserve) => ({ id: reserve.id, bounds: cloneRect(reserve.bounds) }))
  };
}

/** Returns every rectangle which participates in spatial proof for a building. */
export function allocationEnvelopesFor(buildingId) {
  const found = boundsFor(buildingId);
  if (!found) return [];
  return [
    { id: buildingId, kind: "core", bounds: found.bounds },
    ...found.reserveEnvelopes.map((reserve) => ({ id: buildingId, kind: reserve.id, bounds: reserve.bounds }))
  ];
}

/** Returns the last wall stage unlocked at `level`, or null before L5. */
export function scheduleForLevel(level) {
  if (!Number.isInteger(level)) return null;
  let active = null;
  for (const stage of PERIMETER_SCHEDULE) {
    if (stage.level <= level) active = stage;
  }
  return active ? { ...active } : null;
}

export function rectanglesOverlap(a, b) {
  return a.fMin <= b.fMax && a.fMax >= b.fMin && a.sMin <= b.sMax && a.sMax >= b.sMin;
}

export function touchesRoadAxis(bounds) {
  return rectanglesOverlap(bounds, ROAD_AXES.forward.bounds) || rectanglesOverlap(bounds, ROAD_AXES.side.bounds);
}

/** Enumerates the union of both three-block road arms without world access. */
export function crossroadCells(radius = FINAL_RADIUS) {
  const perimeter = perimeterForRadius(radius);
  const cells = new Map();
  const put = (f, s) => cells.set(`${f},${s}`, { f, s });
  for (let f = perimeter.fMin; f <= perimeter.fMax; f++) {
    for (let s = -ROAD_HALF_WIDTH; s <= ROAD_HALF_WIDTH; s++) put(f, s);
  }
  for (let s = perimeter.sMin; s <= perimeter.sMax; s++) {
    for (let f = -ROAD_HALF_WIDTH; f <= ROAD_HALF_WIDTH; f++) put(f, s);
  }
  return [...cells.values()];
}

/**
 * Distance in local blocks to the inner face of the curtain wall. This is the
 * direct axis clearance: radius 94 gives inner face 93.
 */
export function minimumWallClearance(bounds, radius = FINAL_RADIUS) {
  const innerFace = radius - 1;
  return Math.min(
    innerFace - bounds.fMax,
    bounds.fMin + innerFace,
    innerFace - bounds.sMax,
    bounds.sMin + innerFace
  );
}

function intervalGap(aMin, aMax, bMin, bMax) {
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

/**
 * Exact Chebyshev clearance to the closest of four 5×5 corner tower
 * footprints. Unlike a global `max(abs(f), abs(s))` shortcut, this only
 * reports the minimum where a rectangle is actually near the same corner on
 * both local axes.
 */
export function minimumTowerClearance(bounds, radius = FINAL_RADIUS) {
  const inner = radius - 4;
  const towers = [
    rect(inner, radius, inner, radius),
    rect(inner, radius, -radius, -inner),
    rect(-radius, -inner, inner, radius),
    rect(-radius, -inner, -radius, -inner)
  ];
  return Math.min(...towers.map((tower) => Math.max(
    intervalGap(bounds.fMin, bounds.fMax, tower.fMin, tower.fMax),
    intervalGap(bounds.sMin, bounds.sMax, tower.sMin, tower.sMax)
  )));
}
