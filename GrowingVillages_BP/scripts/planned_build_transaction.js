import { buildSpecialBuilding } from "./special_buildings_16_18.js";
import { buildFinalCityBuilding } from "./final_city_19_20.js";
import { PROP_PALETTE, readPlacementContext, readProperty } from "./village_state.js";

/**
 * Isolated architecture-side transaction adapter for canonical future builds.
 *
 * This module owns only the physical-build marker below. It intentionally does
 * not change village level, chapters, arcs, inventory, discounts, entities,
 * UI, signboard or fortifications. A future coordinator may call this once its
 * own economy/state transaction has completed its preconditions.
 */

export const BUILD_STATE_PREFIX = "village:v2:build:";

const BUILDING_LEVELS = Object.freeze({
  memorial_grove: 16,
  village_infirmary: 17,
  civic_workshop: 18,
  founders_hall: 19,
  village_beacon: 20
});

export const PLANNED_BUILDING_IDS = Object.freeze(Object.keys(BUILDING_LEVELS));

function isKnownBuildingId(buildingId) {
  return typeof buildingId === "string" && Object.hasOwn(BUILDING_LEVELS, buildingId);
}

function frozenResult(value) {
  return Object.freeze(value);
}

function safeWarning(options, message) {
  const warn = options?.warn || console.warn;
  try { warn(`[planned-build] ${message}`); } catch (error) { /* warnings never alter transaction semantics */ }
}

function cloneBounds(bounds) {
  return bounds ? Object.freeze({ fMin: bounds.fMin, fMax: bounds.fMax, sMin: bounds.sMin, sMax: bounds.sMax }) : null;
}

function freezeShape(shape) {
  return Object.freeze({
    buildingId: shape.buildingId || shape.id,
    bounds: cloneBounds(shape.bounds),
    footprint: cloneBounds(shape.footprint),
    terrainBounds: shape.terrainBounds ? Object.freeze({
      footprint: cloneBounds(shape.terrainBounds.footprint),
      connector: cloneBounds(shape.terrainBounds.connector)
    }) : null
  });
}

function connectorFrom(shape) {
  const raw = shape.connector || shape.approach;
  if (!raw || !raw.bounds) return null;
  return Object.freeze({
    axis: raw.axis,
    width: raw.width,
    bounds: cloneBounds(raw.bounds)
  });
}

function elderContext(elder, request) {
  const placement = readPlacementContext(elder);
  if (!elder?.dimension || !placement) return null;
  return Object.freeze({
    dimension: elder.dimension,
    origin: Object.freeze(placement.origin),
    facing: placement.facing,
    paletteId: request.paletteId === undefined ? readProperty(elder, PROP_PALETTE) : request.paletteId
  });
}

function validRequest(request) {
  if (!request || typeof request !== "object" || !isKnownBuildingId(request.buildingId)) return { ok: false, error: "invalid_planned_building" };
  if (request.level !== BUILDING_LEVELS[request.buildingId]) return { ok: false, error: "invalid_planned_level" };
  if (request.paletteId !== undefined && typeof request.paletteId !== "string") return { ok: false, error: "invalid_palette_id" };
  return { ok: true };
}

function dependencies(options) {
  return Object.freeze({
    buildSpecial: options?.buildSpecial || buildSpecialBuilding,
    buildFinal: options?.buildFinal || buildFinalCityBuilding,
    connect: options?.connect || ((shape) => connectorFrom(shape))
  });
}

/** Returns the only dynamic-property key this adapter is allowed to write. */
export function plannedBuildStateKey(buildingId) {
  if (!isKnownBuildingId(buildingId)) throw new Error(`unknown planned building: ${buildingId}`);
  return BUILD_STATE_PREFIX + buildingId;
}

/** Returns raw state as 0/1/2, or an immutable corrupt-state descriptor. */
export function getPlannedBuildState(elder, buildingId) {
  const key = plannedBuildStateKey(buildingId);
  let value;
  try {
    value = elder?.getDynamicProperty?.(key);
  } catch (error) {
    return frozenResult({ state: null, corrupt: true, error: "build_state_unreadable" });
  }
  if (value === undefined || value === 0) return 0;
  if (value === 1 || value === 2) return value;
  return frozenResult({ state: value, corrupt: true, error: "build_state_corrupt" });
}

function writeState(elder, buildingId, state) {
  elder.setDynamicProperty(plannedBuildStateKey(buildingId), state);
}

function recoverQueued(elder, buildingId, options) {
  try {
    writeState(elder, buildingId, 0);
    safeWarning(options, `recovered stale queued build: ${buildingId}`);
    return frozenResult({ done: false, recoverable: true, error: "queued_build_recovered", buildingId });
  } catch (error) {
    safeWarning(options, `could not recover queued build ${buildingId}`);
    return frozenResult({ done: false, recoverable: false, error: "build_state_write_failed", buildingId });
  }
}

/**
 * Executes exactly one detached physical build transaction for an approved
 * L16–20 request. Its only persistent mutation is state 0→1→2 for this
 * building, with failure reset 1→0. `options` is test-only dependency injection.
 */
export function buildPlannedVillageBuilding(elder, request, options = undefined) {
  const requestCheck = validRequest(request);
  if (!requestCheck.ok) return frozenResult({ done: false, recoverable: false, error: requestCheck.error });

  const { buildingId, level } = request;
  const current = getPlannedBuildState(elder, buildingId);
  if (typeof current === "object") return frozenResult({ done: false, recoverable: false, error: current.error, buildingId });
  if (current === 2) return frozenResult({ done: false, alreadyBuilt: true, error: "already_built", buildingId, level });
  if (current === 1) return recoverQueued(elder, buildingId, options);

  const context = elderContext(elder, request);
  if (!context) return frozenResult({ done: false, recoverable: false, error: "invalid_village_context", buildingId, level });

  let deps;
  try {
    deps = dependencies(options);
    writeState(elder, buildingId, 1);
  } catch (error) {
    safeWarning(options, `could not queue build ${buildingId}`);
    return frozenResult({ done: false, recoverable: false, error: "build_state_write_failed", buildingId, level });
  }

  try {
    const shape = level <= 18
      ? deps.buildSpecial(context.dimension, context.origin, context.facing, buildingId)
      : deps.buildFinal(context.dimension, context.origin, context.facing, buildingId);
    const actualBuildingId = shape?.buildingId || shape?.id;
    if (!shape || actualBuildingId !== buildingId) throw new Error("canonical_shape_mismatch");

    const connector = deps.connect(shape, context, request);
    if (!connector || !connector.bounds || connector.width < 2) throw new Error("connector_failed");

    writeState(elder, buildingId, 2);
    return frozenResult({
      done: true,
      buildingId,
      level,
      shape: freezeShape(shape),
      connector: Object.freeze({ axis: connector.axis, width: connector.width, bounds: cloneBounds(connector.bounds) })
    });
  } catch (error) {
    try { writeState(elder, buildingId, 0); } catch (resetError) { safeWarning(options, `could not reset failed build ${buildingId}`); }
    const code = error?.message === "canonical_shape_mismatch" ? "canonical_shape_mismatch"
      : error?.message === "connector_failed" ? "connector_failed"
      : "planned_build_failed";
    safeWarning(options, `${code}: ${buildingId}`);
    return frozenResult({ done: false, recoverable: true, error: code, buildingId, level });
  }
}
