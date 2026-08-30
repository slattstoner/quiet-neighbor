import { ROAD_AXES } from "./spatial_plan.js";
import { prepareSite } from "./terrain.js";
import { makePlacer } from "./builder.js";

/**
 * Narrow, detached city pedestrian connectors.
 *
 * A city builder returns an `approach` corridor rather than paving public
 * space itself. This module consumes that metadata only after a successful
 * city build. It never creates a final R94 crossroad or touches defences.
 */

function cloneBounds(bounds) {
  return { fMin: bounds.fMin, fMax: bounds.fMax, sMin: bounds.sMin, sMax: bounds.sMax };
}

function widthOf(bounds, axis) {
  return axis === "forward"
    ? Math.abs(bounds.fMax - bounds.fMin) + 1
    : Math.abs(bounds.sMax - bounds.sMin) + 1;
}

function isValidApproach(approach) {
  if (!approach || (approach.axis !== "forward" && approach.axis !== "side")) return false;
  const bounds = approach.bounds;
  return !!bounds && [bounds.fMin, bounds.fMax, bounds.sMin, bounds.sMax].every(Number.isInteger) &&
    bounds.fMin <= bounds.fMax && bounds.sMin <= bounds.sMax &&
    Number.isInteger(approach.width) && approach.width >= 2;
}

/** Pure preflight. It rejects malformed metadata before any terrain edit. */
function connectorPlanFor(metadata) {
  if (!metadata || typeof metadata.buildingId !== "string") throw new Error("city metadata is required");
  const approach = metadata.approach;
  if (!isValidApproach(approach)) throw new Error(`invalid city approach: ${metadata.buildingId}`);
  const road = ROAD_AXES[approach.axis];
  if (!road || road.width !== 3) throw new Error(`missing canonical road axis: ${approach.axis}`);
  if (widthOf(approach.bounds, approach.axis) < 2) throw new Error(`approach is narrower than two blocks: ${metadata.buildingId}`);

  // City metadata deliberately stops immediately beside the canonical road
  // band so the building module does not pave public space itself. Adjacency
  // therefore counts as a valid connection; the connector never widens into
  // the three-block road strip.
  const joinsRoad = approach.axis === "forward"
    ? (approach.bounds.sMin <= road.bounds.sMax + 1 && approach.bounds.sMax >= road.bounds.sMin - 1)
    : (approach.bounds.fMin <= road.bounds.fMax + 1 && approach.bounds.fMax >= road.bounds.fMin - 1);
  if (!joinsRoad) throw new Error(`approach does not reach central road band: ${metadata.buildingId}`);

  return Object.freeze({
    buildingId: metadata.buildingId,
    axis: approach.axis,
    width: approach.width,
    bounds: Object.freeze(cloneBounds(approach.bounds)),
    roadBounds: Object.freeze(cloneBounds(road.bounds)),
    entryPath: Object.freeze(cloneBounds(metadata.entryPath || metadata.bounds))
  });
}

/**
 * Paves the pre-approved corridor only. The exact bounds are the terrain
 * bounds; there is no padding and no scan of the city interior.
 */
export function buildCityConnector(dimension, origin, facing, metadata) {
  const plan = connectorPlanFor(metadata);
  const { fMin, fMax, sMin, sMax } = plan.bounds;
  prepareSite(dimension, origin, facing, fMin, fMax, sMin, sMax, {
    padding: 0,
    clearHeight: 5,
    fillDepth: 4,
    surfaceBlock: "minecraft:grass_block"
  });
  const placer = makePlacer(dimension, origin, facing);
  for (let f = fMin; f <= fMax; f++) {
    for (let s = sMin; s <= sMax; s++) {
      placer.block(f, s, -1, "minecraft:gravel");
      for (let up = 0; up <= 3; up++) placer.block(f, s, up, "minecraft:air");
    }
  }
  return Object.freeze({ ...plan, placedBounds: Object.freeze(cloneBounds(plan.bounds)), terrainBounds: Object.freeze(cloneBounds(plan.bounds)) });
}
