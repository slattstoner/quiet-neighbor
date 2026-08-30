import {
  GATE_SPECS,
  PERIMETER_SCHEDULE,
  ROAD_AXES,
  SPATIAL_PLAN,
  perimeterForRadius,
  scheduleForLevel
} from "./spatial_plan.js";
import { makePlacer, stairs } from "./builder.js";

/**
 * Detached defensive-road foundation for the approved R44/R62/R78/R94 plan.
 *
 * This module deliberately has no village-state or progression import. It is
 * callable directly for tests and future integration, while legacy walls.js
 * remains the only wall implementation used by levels 1–10 today.
 */

const TIER_STYLE = Object.freeze({
  palisade: Object.freeze({
    wall: "minecraft:oak_log",
    foundation: "minecraft:oak_log",
    cap: "minecraft:oak_fence",
    tower: "minecraft:oak_log",
    towerTop: "minecraft:oak_planks",
    gate: "minecraft:oak_log",
    accent: "minecraft:oak_planks",
    height: 4,
    towerHeight: 5,
    gateHeight: 4,
    family: "palisade"
  }),
  cobble: Object.freeze({
    wall: "minecraft:cobblestone",
    foundation: "minecraft:cobblestone",
    cap: "minecraft:cobblestone_wall",
    tower: "minecraft:cobblestone",
    // Bedrock flattened the old "stone_slab" id away; smooth_stone_slab is
    // the modern block that id used to render as. The castle tier below
    // already uses a real slab id (stone_brick_slab) - this tier did not, so
    // cobble-tier towers were left open-topped.
    towerTop: "minecraft:smooth_stone_slab",
    gate: "minecraft:stone_bricks",
    accent: "minecraft:spruce_log",
    height: 6,
    towerHeight: 7,
    gateHeight: 5,
    family: "cobble"
  }),
  castle: Object.freeze({
    wall: "minecraft:stone_bricks",
    foundation: "minecraft:cobblestone",
    cap: "minecraft:stone_brick_slab",
    tower: "minecraft:stone_bricks",
    towerTop: "minecraft:stone_brick_slab",
    gate: "minecraft:stone_bricks",
    accent: "minecraft:cobblestone",
    height: 8,
    towerHeight: 10,
    gateHeight: 7,
    family: "castle"
  })
});

function styleFor(tier) {
  if (tier === "castle_expand") return TIER_STYLE.castle;
  const style = TIER_STYLE[tier];
  if (!style) throw new Error(`unsupported defence tier: ${tier}`);
  return style;
}

function cloneBounds(bounds) {
  return { fMin: bounds.fMin, fMax: bounds.fMax, sMin: bounds.sMin, sMax: bounds.sMax };
}

function freezeCells(cells) {
  return Object.freeze(cells.map((cell) => Object.freeze({ ...cell })));
}

function stageFor(stageOrLevel) {
  if (stageOrLevel && typeof stageOrLevel === "object" && Number.isInteger(stageOrLevel.radius)) {
    const found = PERIMETER_SCHEDULE.find((stage) => stage.radius === stageOrLevel.radius && stage.tier === stageOrLevel.tier);
    if (found) return found;
  }
  if (!Number.isInteger(stageOrLevel)) throw new Error(`stage or level must be an integer, got ${stageOrLevel}`);
  const exact = PERIMETER_SCHEDULE.find((stage) => stage.level === stageOrLevel);
  return exact || scheduleForLevel(stageOrLevel) || (() => { throw new Error(`no defence stage unlocked at level ${stageOrLevel}`); })();
}

/** Immutable public stage list, derived directly from the spatial contract. */
export const DEFENCE_STAGES = Object.freeze(PERIMETER_SCHEDULE.map((stage) => Object.freeze({
  ...stage,
  paletteFamily: styleFor(stage.tier).family
})));

function edgeFor(f, s, radius) {
  if (f === radius) return "fMax";
  if (f === -radius) return "fMin";
  if (s === radius) return "sMax";
  if (s === -radius) return "sMin";
  return null;
}

function gateForEdge(edge, radius) {
  const gate = GATE_SPECS.find((item) => item.edge === edge);
  if (!gate) throw new Error(`missing canonical gate spec for ${edge}`);
  const sign = gate.fixed.value < 0 ? -1 : 1;
  const fixedValue = radius * sign;
  const cells = [];
  for (let offset = gate.span.min; offset <= gate.span.max; offset++) {
    cells.push(gate.fixed.axis === "forward" ? { f: fixedValue, s: offset } : { f: offset, s: fixedValue });
  }
  const bounds = gate.fixed.axis === "forward"
    ? { fMin: fixedValue, fMax: fixedValue, sMin: gate.span.min, sMax: gate.span.max }
    : { fMin: gate.span.min, fMax: gate.span.max, sMin: fixedValue, sMax: fixedValue };
  return { id: gate.id, edge: gate.edge, width: gate.width, roadAxis: gate.roadAxis, cells: freezeCells(cells), bounds: Object.freeze(bounds) };
}

/** Five opening cells for each of the four canonical gates at a chosen stage. */
export function gateOpeningCells(stageOrLevel) {
  const stage = stageFor(stageOrLevel);
  const openings = GATE_SPECS.map((gate) => gateForEdge(gate.edge, stage.radius));
  return Object.freeze(openings.map((opening) => Object.freeze(opening)));
}

function gateCellSet(stageOrLevel) {
  const set = new Set();
  for (const gate of gateOpeningCells(stageOrLevel)) for (const cell of gate.cells) set.add(`${cell.f},${cell.s}`);
  return set;
}

/** Curtain-wall line cells only; canonical five-wide gate openings are omitted. */
export function wallCellsForStage(stageOrLevel) {
  const stage = stageFor(stageOrLevel);
  const rect = perimeterForRadius(stage.radius);
  const gateCells = gateCellSet(stage);
  const cells = [];
  for (let f = rect.fMin; f <= rect.fMax; f++) {
    for (const s of [rect.sMin, rect.sMax]) {
      if (!gateCells.has(`${f},${s}`)) cells.push({ f, s, edge: edgeFor(f, s, stage.radius) });
    }
  }
  for (let s = rect.sMin + 1; s <= rect.sMax - 1; s++) {
    for (const f of [rect.fMin, rect.fMax]) {
      if (!gateCells.has(`${f},${s}`)) cells.push({ f, s, edge: edgeFor(f, s, stage.radius) });
    }
  }
  return freezeCells(cells);
}

/** Four inward 5×5 corner footprints. They never extend beyond the stage radius. */
export function towerFootprintsForStage(stageOrLevel) {
  const stage = stageFor(stageOrLevel);
  const radius = stage.radius;
  const corners = [
    { id: "north_west", f: -radius, s: -radius },
    { id: "north_east", f: radius, s: -radius },
    { id: "south_west", f: -radius, s: radius },
    { id: "south_east", f: radius, s: radius }
  ];
  return Object.freeze(corners.map((corner) => {
    const fDir = corner.f < 0 ? 1 : -1;
    const sDir = corner.s < 0 ? 1 : -1;
    const fEnd = corner.f + fDir * 4;
    const sEnd = corner.s + sDir * 4;
    return Object.freeze({
      id: corner.id,
      corner: Object.freeze({ f: corner.f, s: corner.s }),
      bounds: Object.freeze({
        fMin: Math.min(corner.f, fEnd), fMax: Math.max(corner.f, fEnd),
        sMin: Math.min(corner.s, sEnd), sMax: Math.max(corner.s, sEnd)
      })
    });
  }));
}

/** Union of canonical 3-wide forward and side road cells inside a radius. */
export function roadCellsForRadius(radius) {
  const rect = perimeterForRadius(radius);
  const forwardWidth = ROAD_AXES.forward.width;
  const sideWidth = ROAD_AXES.side.width;
  const forwardHalf = Math.floor(forwardWidth / 2);
  const sideHalf = Math.floor(sideWidth / 2);
  const cells = new Map();
  const put = (f, s, axis) => cells.set(`${f},${s}`, { f, s, axis });
  for (let f = rect.fMin; f <= rect.fMax; f++) {
    for (let s = -forwardHalf; s <= forwardHalf; s++) put(f, s, "forward");
  }
  for (let s = rect.sMin; s <= rect.sMax; s++) {
    for (let f = -sideHalf; f <= sideHalf; f++) put(f, s, "side");
  }
  return freezeCells([...cells.values()]);
}

function intervalsOverlap(aMin, aMax, bMin, bMax) {
  return aMin <= bMax && aMax >= bMin;
}

function boundsOverlap(a, b) {
  return intervalsOverlap(a.fMin, a.fMax, b.fMin, b.fMax) && intervalsOverlap(a.sMin, a.sMax, b.sMin, b.sMax);
}

/** Planned allocations relevant at a stage; future buildings outside an earlier wall are intentionally not active yet. */
export function activeAllocationBoundsForStage(stageOrLevel) {
  const stage = stageFor(stageOrLevel);
  return Object.freeze(SPATIAL_PLAN
    .filter((entry) => entry.level <= stage.level)
    .map((entry) => Object.freeze({ buildingId: entry.buildingId, level: entry.level, bounds: cloneBounds(entry.bounds) })));
}

function localBoundsFromCells(cells) {
  const fValues = cells.map((cell) => cell.f);
  const sValues = cells.map((cell) => cell.s);
  return {
    fMin: Math.min(...fValues), fMax: Math.max(...fValues),
    sMin: Math.min(...sValues), sMax: Math.max(...sValues)
  };
}

function outwardCompass(facing, edge) {
  const plusSide = ["south", "north", "east", "west"][facing];
  const minusSide = ["north", "south", "west", "east"][facing];
  const plusForward = ["east", "west", "south", "north"][facing];
  const minusForward = ["west", "east", "north", "south"][facing];
  if (edge === "fMax") return plusForward;
  if (edge === "fMin") return minusForward;
  if (edge === "sMax") return plusSide;
  return minusSide;
}

function innerCell(cell, radius) {
  return {
    f: cell.f === radius ? cell.f - 1 : cell.f === -radius ? cell.f + 1 : cell.f,
    s: cell.s === radius ? cell.s - 1 : cell.s === -radius ? cell.s + 1 : cell.s
  };
}

function narrowTerrainClear(placer, cells, maxUp, foundation) {
  const seen = new Set();
  for (const cell of cells) {
    const key = `${cell.f},${cell.s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    placer.block(cell.f, cell.s, -1, foundation);
    for (let up = 0; up <= maxUp; up++) placer.block(cell.f, cell.s, up, "minecraft:air");
  }
  return freezeCells([...seen].map((key) => {
    const [f, s] = key.split(",").map(Number);
    return { f, s };
  }));
}

function buildRoadCells(placer, cells) {
  for (const cell of cells) {
    const centre = cell.f === 0 || cell.s === 0;
    placer.block(cell.f, cell.s, -1, centre ? "minecraft:cobblestone" : "minecraft:gravel");
    for (let up = 0; up <= 3; up++) placer.block(cell.f, cell.s, up, "minecraft:air");
  }
}

/** Builds a bounded, 3-wide local road segment. No lamp posts are added inside the roadway. */
function buildRoadArm(dimension, origin, facing, axis, from, to) {
  if (axis !== "forward" && axis !== "side") throw new Error(`unsupported road axis: ${axis}`);
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error("road endpoints must be integers");
  const min = Math.min(from, to), max = Math.max(from, to);
  const half = Math.floor((axis === "forward" ? ROAD_AXES.forward.width : ROAD_AXES.side.width) / 2);
  const placer = makePlacer(dimension, origin, facing);
  const cells = [];
  for (let position = min; position <= max; position++) {
    for (let offset = -half; offset <= half; offset++) {
      cells.push(axis === "forward" ? { f: position, s: offset, axis } : { f: offset, s: position, axis });
    }
  }
  buildRoadCells(placer, cells);
  return Object.freeze({ axis, from: min, to: max, width: half * 2 + 1, bounds: Object.freeze(localBoundsFromCells(cells)), cells: freezeCells(cells) });
}

function buildCurtain(placer, stage) {
  const style = styleFor(stage.tier);
  const cells = wallCellsForStage(stage);
  for (const cell of cells) {
    placer.box(cell.f, cell.s, 0, cell.f, cell.s, style.height - 1, style.wall);
    if (style.family === "palisade") {
      const tall = (cell.f + cell.s) % 2 === 0;
      if (tall) placer.block(cell.f, cell.s, style.height, style.cap);
    } else if (style.family === "cobble") {
      placer.block(cell.f, cell.s, style.height, style.cap);
    } else {
      if ((cell.f + cell.s) % 2 === 0) {
        placer.block(cell.f, cell.s, style.height, style.wall);
        placer.block(cell.f, cell.s, style.height + 1, style.cap);
      } else if ((cell.f + cell.s) % 6 === 0) {
        // Arrow slit; the continuous wall remains solid below this level.
        placer.block(cell.f, cell.s, style.height - 2, "minecraft:air");
      }
    }
    const inner = innerCell(cell, stage.radius);
    if (style.family !== "palisade") {
      placer.box(inner.f, inner.s, 0, inner.f, inner.s, style.height - 2, style.foundation);
      placer.block(inner.f, inner.s, style.height - 1, style.wall);
    } else if ((cell.f + cell.s) % 3 === 0) {
      placer.block(inner.f, inner.s, style.height - 1, "minecraft:oak_planks");
    }
  }
  return cells;
}

function buildTower(placer, footprint, stage) {
  const style = styleFor(stage.tier);
  const { fMin, fMax, sMin, sMax } = footprint.bounds;
  const top = style.towerHeight - 1;
  placer.box(fMin, sMin, 0, fMax, sMax, top, style.tower);
  placer.box(fMin + 1, sMin + 1, 0, fMax - 1, sMax - 1, top - 1, "minecraft:air");
  // A real, compact entrance from the interior-facing diagonal.
  const doorF = footprint.corner.f < 0 ? fMax : fMin;
  const doorS = footprint.corner.s < 0 ? sMax : sMin;
  placer.box(doorF, doorS, 0, doorF, doorS, 1, "minecraft:air");
  // Ladder and a visible watch platform create a readable defensive silhouette.
  placer.box(fMin + 1, sMin + 1, 0, fMin + 1, sMin + 1, top - 1, "minecraft:ladder");
  placer.box(fMin + 1, sMin + 1, top, fMax - 1, sMax - 1, top, style.towerTop);
  if (style.family === "castle") {
    for (let f = fMin; f <= fMax; f++) {
      if ((f - fMin) % 2 === 0) {
        placer.block(f, sMin, top + 1, style.wall);
        placer.block(f, sMax, top + 1, style.wall);
      }
    }
    for (let s = sMin + 1; s <= sMax - 1; s++) {
      if ((s - sMin) % 2 === 0) {
        placer.block(fMin, s, top + 1, style.wall);
        placer.block(fMax, s, top + 1, style.wall);
      }
    }
  } else if (style.family === "palisade") {
    for (const f of [fMin, fMax]) for (const s of [sMin, sMax]) placer.block(f, s, top + 1, "minecraft:oak_fence");
  } else {
    for (const f of [fMin, fMax]) for (const s of [sMin, sMax]) placer.block(f, s, top + 1, "minecraft:cobblestone_wall");
  }
  placer.block(Math.round((fMin + fMax) / 2), Math.round((sMin + sMax) / 2), top + 1, "minecraft:lantern", { hanging: false });
}

function gatePierCells(gate) {
  const values = [-3, 3];
  return values.map((offset) => gate.edge === "fMax" || gate.edge === "fMin"
    ? { f: gate.bounds.fMin, s: offset }
    : { f: offset, s: gate.bounds.sMin });
}

function buildGatehouse(placer, gate, stage) {
  const style = styleFor(stage.tier);
  const piers = gatePierCells(gate);
  for (const pier of piers) {
    placer.box(pier.f, pier.s, 0, pier.f, pier.s, style.gateHeight + 1, style.gate);
    placer.block(pier.f, pier.s, style.gateHeight + 2, "minecraft:lantern", { hanging: false });
  }
  // Arch and optional high grille sit strictly above the required 4-block passage.
  for (const cell of gate.cells) {
    placer.block(cell.f, cell.s, style.gateHeight, style.gate);
    if (style.family === "castle") {
      placer.block(cell.f, cell.s, style.gateHeight + 1, "minecraft:iron_bars");
      if (cell.f === gate.cells[0].f && cell.s === gate.cells[0].s) {
        stairs(placer, cell.f, cell.s, style.gateHeight + 2, "minecraft:stone_brick_stairs", outwardCompass(placer.facing, gate.edge), false);
      }
    } else if (style.family === "cobble") {
      placer.block(cell.f, cell.s, style.gateHeight + 1, "minecraft:stone_brick_slab");
    } else {
      placer.block(cell.f, cell.s, style.gateHeight + 1, "minecraft:oak_fence");
    }
    for (let up = 0; up <= 3; up++) placer.block(cell.f, cell.s, up, "minecraft:air");
  }
  return freezeCells([...gate.cells, ...piers]);
}

function stageTerrainCells(stage) {
  const wall = wallCellsForStage(stage);
  // The curtain detail occupies one inward step for walkways/rails. It is
  // still a narrow ring, not an interior-city clear pass.
  const innerWalk = wall.map((cell) => innerCell(cell, stage.radius));
  const roads = roadCellsForRadius(stage.radius);
  const towers = towerFootprintsForStage(stage).flatMap((tower) => {
    const cells = [];
    for (let f = tower.bounds.fMin; f <= tower.bounds.fMax; f++) {
      for (let s = tower.bounds.sMin; s <= tower.bounds.sMax; s++) cells.push({ f, s });
    }
    return cells;
  });
  const gates = gateOpeningCells(stage).flatMap((gate) => [...gate.cells, ...gatePierCells(gate)]);
  return freezeCells([...wall, ...innerWalk, ...roads, ...towers, ...gates]);
}

function ensureActiveAllocationsClear(stage) {
  const wallBounds = perimeterForRadius(stage.radius);
  const active = activeAllocationBoundsForStage(stage);
  for (const allocation of active) {
    // A current allocation may be inside a stage, but it must never touch its narrow wall ring.
    const touchingCurtain = allocation.bounds.fMin <= wallBounds.fMin && allocation.bounds.fMax >= wallBounds.fMin ||
      allocation.bounds.fMin <= wallBounds.fMax && allocation.bounds.fMax >= wallBounds.fMax ||
      allocation.bounds.sMin <= wallBounds.sMin && allocation.bounds.sMax >= wallBounds.sMin ||
      allocation.bounds.sMin <= wallBounds.sMax && allocation.bounds.sMax >= wallBounds.sMax;
    if (touchingCurtain) throw new Error(`active allocation conflicts with defence stage: ${allocation.buildingId}`);
  }
}

/**
 * Builds one detached defensive stage. It only clears/levels the exact wall,
 * tower, gate and road cells returned in metadata; it never scans city interior.
 */
export function buildDefenceStage(dimension, origin, facing, stageOrLevel) {
  const stage = stageFor(stageOrLevel);
  const style = styleFor(stage.tier);
  ensureActiveAllocationsClear(stage);
  const placer = makePlacer(dimension, origin, facing);
  const wallBounds = perimeterForRadius(stage.radius);
  const terrainCells = stageTerrainCells(stage);
  const terrainBounds = narrowTerrainClear(placer, terrainCells, style.towerHeight + 2, style.foundation);

  const forwardRoad = buildRoadArm(dimension, origin, facing, "forward", -stage.radius, stage.radius);
  const sideRoad = buildRoadArm(dimension, origin, facing, "side", -stage.radius, stage.radius);
  const wall = buildCurtain(placer, stage);
  const gates = gateOpeningCells(stage);
  const gateTerrain = [];
  for (const gate of gates) gateTerrain.push(...buildGatehouse(placer, gate, stage));
  const towers = towerFootprintsForStage(stage);
  for (const tower of towers) buildTower(placer, tower, stage);

  return Object.freeze({
    stage: stage.level,
    tier: stage.tier,
    radius: stage.radius,
    paletteFamily: style.family,
    gates: Object.freeze(gates.map((gate) => Object.freeze({ ...gate }))),
    towers: Object.freeze(towers.map((tower) => Object.freeze({ id: tower.id, corner: { ...tower.corner }, bounds: cloneBounds(tower.bounds) }))),
    wallBounds: Object.freeze(cloneBounds(wallBounds)),
    roadArms: Object.freeze([forwardRoad, sideRoad]),
    placedBounds: Object.freeze({
      curtainCells: wall,
      gatehouseCells: freezeCells(gateTerrain),
      towerFootprints: Object.freeze(towers.map((tower) => Object.freeze(cloneBounds(tower.bounds)))),
      roadBounds: Object.freeze([cloneBounds(forwardRoad.bounds), cloneBounds(sideRoad.bounds)])
    }),
    terrainBounds: terrainBounds
  });
}

