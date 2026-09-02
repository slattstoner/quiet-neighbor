import { __test__, world } from "@minecraft/server";
import {
  defineBuilding, structureSizeFor, buildingRecord, requiredStructureIds,
  BUILDING_MANIFEST, PLACEHOLDER_BLOCKS, MATERIAL_ROLES, POI_KINDS, MAX_STRUCTURE_SPAN
} from "./scripts/building_manifest.js";
import {
  FACING_ROTATION, placeBuilding, localFootprint, worldAnchorFor, resolvePoi,
  swapPlaceholdersJob, structureAvailable, missingStructures, packStructureIds,
  resetStructureCache, structuresSupported, captureBuilding, reportMissingStructures
} from "./scripts/structure_build.js";
import { PALETTES, paletteById } from "./scripts/palettes.js";
import { toWorld } from "./scripts/util.js";

/**
 * The structure pipeline: buildings as data rather than as code.
 *
 * What this suite can and cannot prove is worth stating plainly, because the
 * pipeline is half code and half art asset.
 *
 * PROVABLE HERE, and proved below: the manifest schema and every way it can be
 * malformed; the footprint arithmetic that turns a plot-relative record into a
 * world box; that a record with no `.mcstructure` file falls back to the
 * procedural builder instead of producing an invisible building; that a
 * missing file is reported rather than swallowed; that placeholder blocks are
 * swapped for the village's real palette; and that the resulting shape carries
 * what the rest of the mod needs.
 *
 * NOT PROVABLE HERE, and flagged as such in structure_build.js: whether the
 * engine anchors `place()` at the structure's minimum corner, and whether the
 * rotation enum turns a structure the way the derivation says. Both are
 * derived rather than guessed, and both are pinned by a test below so a
 * correction on device is a one-line edit - but a mock cannot settle either.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}
function throws(fn, fragment, message) {
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  const ok = caught !== null && String(caught.message).includes(fragment);
  assert(ok, `${message}${caught ? ` (got: ${caught.message})` : " (nothing thrown)"}`);
}

const dim = __test__.makeDimension();

/** A record good enough to build on, for the arithmetic checks. */
const cottage = defineBuilding({
  id: "test_cottage",
  structure: "gv:buildings/test_cottage",
  fallback: "buildPlainHouse",
  footprint: { fMin: 0, fMax: 6, sMin: -3, sMax: 3, upMin: -1, upMax: 5 },
  poi: [
    { kind: "bed", at: { f: 1, s: 2, up: 0 } },
    { kind: "storage", at: { f: 5, s: 2, up: 0 } },
    { kind: "npc", at: { f: 3, s: 0, up: 0 } }
  ]
});

// ---------- 1. схема манифеста ----------
console.log("\n=== a building record is checked when it is written, not when it is built ===");
{
  assert(cottage.size.x === 7 && cottage.size.y === 7 && cottage.size.z === 7,
    `size is derived from the footprint (${cottage.size.x}x${cottage.size.y}x${cottage.size.z})`);
  assert(cottage.swapPlaceholders === true, "placeholder swapping is on by default");
  assert(Object.isFrozen(cottage) && Object.isFrozen(cottage.footprint), "the record is frozen");

  throws(() => defineBuilding({ structure: "gv:x", footprint: cottage.footprint }),
    "needs an id", "a record with no id is refused");
  throws(() => defineBuilding({ id: "x", structure: "no_namespace", footprint: cottage.footprint }),
    "namespaced identifier", "a structure id with no namespace is refused");
  throws(() => defineBuilding({ id: "x", structure: "gv:x", footprint: { fMin: 0 } }),
    "integer fMin/fMax", "an incomplete footprint is refused");
  throws(() => defineBuilding({ id: "x", structure: "gv:x",
      footprint: { fMin: 5, fMax: 0, sMin: 0, sMax: 1, upMin: 0, upMax: 1 } }),
    "inverted", "an inverted footprint is refused");

  // Bedrock cannot save a structure wider than 64, so a record asking for more
  // can never have a file - better to say so now than at placement time.
  throws(() => defineBuilding({ id: "x", structure: "gv:x",
      footprint: { fMin: 0, fMax: 80, sMin: 0, sMax: 4, upMin: 0, upMax: 4 } }),
    `over Bedrock's ${MAX_STRUCTURE_SPAN.x} limit`, "a footprint past the engine's structure limit is refused");

  throws(() => defineBuilding({ id: "x", structure: "gv:x", footprint: cottage.footprint,
      poi: [{ kind: "teleporter", at: { f: 0, s: 0, up: 0 } }] }),
    "unknown kind", "an unknown point-of-interest kind is refused");
  throws(() => defineBuilding({ id: "x", structure: "gv:x", footprint: cottage.footprint,
      poi: [{ kind: "bed", at: { f: 99, s: 0, up: 0 } }] }),
    "outside the footprint", "a point of interest outside the building is refused");
  throws(() => defineBuilding({ id: "x", structure: "gv:x", footprint: cottage.footprint,
      poi: [{ kind: "npc", at: { f: 1, s: 0, up: 0 } }, { kind: "npc", at: { f: 2, s: 0, up: 0 } }] }),
    "expected at most one", "two residents in one house is refused");

  assert(structureSizeFor({ fMin: -2, fMax: 2, sMin: 0, sMax: 9, upMin: 0, upMax: 3 }).z === 10,
    "structureSizeFor maps s span onto the structure's z axis");
}

console.log("\n=== placeholders and palettes line up ===");
{
  for (const [block, role] of Object.entries(PLACEHOLDER_BLOCKS)) {
    assert(MATERIAL_ROLES.includes(role), `${block} maps to a known material role (${role})`);
  }
  // A placeholder that occurs in a real village would be eaten by the swap
  // pass. These are the ids the existing builders actually place.
  const realVillageBlocks = new Set([
    "minecraft:oak_planks", "minecraft:spruce_planks", "minecraft:birch_planks",
    "minecraft:cobblestone", "minecraft:stone_bricks", "minecraft:sandstone",
    "minecraft:hardened_clay", "minecraft:oak_log", "minecraft:spruce_log",
    "minecraft:grass_block", "minecraft:gravel", "minecraft:lantern",
    "minecraft:chest", "minecraft:wooden_door", "minecraft:oak_stairs"
  ]);
  for (const block of Object.keys(PLACEHOLDER_BLOCKS)) {
    assert(!realVillageBlocks.has(block), `${block} never appears in a real village, so swapping it is safe`);
  }
  // Every palette must be able to answer for every role, or a swap would write
  // "minecraft:undefined".
  for (const palette of Object.values(PALETTES)) {
    const resolved = {
      wall: `minecraft:${palette.wood}_planks`,
      foundation: `minecraft:${palette.stone}`,
      roof: `minecraft:${palette.roof}`,
      timber: `minecraft:${palette.wood}_log`,
      accent: `minecraft:${palette.stone}`
    };
    assert(Object.values(resolved).every((id) => id && !id.includes("undefined")),
      `palette "${palette.id}" resolves every material role`);
  }
}

// ---------- 2. арифметика участка ----------
console.log("\n=== a record is plot-independent: the same building lands where it is put ===");
{
  const onPlot = localFootprint(cottage, 14, -10);
  assert(onPlot.fMin === 14 && onPlot.fMax === 20, `f shifts by the plot anchor (${onPlot.fMin}..${onPlot.fMax})`);
  assert(onPlot.sMin === -13 && onPlot.sMax === -7, `s shifts by the plot side (${onPlot.sMin}..${onPlot.sMax})`);
  assert(onPlot.upMin === -1 && onPlot.upMax === 5, "height is absolute, not plot-relative");

  const origin = { x: 1000, y: 70, z: 2000 };
  for (const facing of [0, 1, 2, 3]) {
    const anchor = worldAnchorFor(origin, facing, onPlot);
    // Whatever way the local axes end up pointing, the anchor must be the
    // minimum corner of the world box the footprint actually covers.
    const corners = [];
    for (const f of [onPlot.fMin, onPlot.fMax]) {
      for (const s of [onPlot.sMin, onPlot.sMax]) corners.push(toWorld(origin, facing, f, s, onPlot.upMin));
    }
    const minX = Math.min(...corners.map((c) => c.x));
    const minZ = Math.min(...corners.map((c) => c.z));
    assert(anchor.x === minX && anchor.z === minZ,
      `facing ${facing}: anchor is the minimum corner of the footprint (${anchor.x},${anchor.z})`);
    assert(anchor.y === origin.y + onPlot.upMin,
      `facing ${facing}: anchor sits at the footprint's floor (y ${anchor.y})`);
  }
}

console.log("\n=== the facing-to-rotation mapping is pinned ===");
{
  // Derived in structure_build.js from toWorld's own transform. Pinned here
  // because it is one of the two things a mock cannot settle: if a device
  // shows a building turned the wrong way, this table is the single edit.
  assert(FACING_ROTATION[0] === "None", "facing 0 (+X) places unrotated");
  assert(FACING_ROTATION[1] === "Rotate180", "facing 1 (-X) is a half turn");
  assert(FACING_ROTATION[2] === "Rotate90", "facing 2 (+Z) is a quarter turn clockwise");
  assert(FACING_ROTATION[3] === "Rotate270", "facing 3 (-Z) is three quarters clockwise");
  assert(new Set(Object.values(FACING_ROTATION)).size === 4, "all four facings get a distinct rotation");
}

console.log("\n=== points of interest come back in world coordinates ===");
{
  const origin = { x: 500, y: 64, z: -500 };
  const poi = resolvePoi(cottage, origin, 0, 10, 4);
  assert(poi.length === 3, `every declared point is resolved (${poi.length})`);
  const bed = poi.find((entry) => entry.kind === "bed");
  const expected = toWorld(origin, 0, 1 + 10, 2 + 4, 0);
  assert(bed.world.x === expected.x && bed.world.y === expected.y && bed.world.z === expected.z,
    `the bed resolves through the same transform the builders use (${bed.world.x},${bed.world.y},${bed.world.z})`);
  assert(poi.every((entry) => POI_KINDS.includes(entry.kind)), "every resolved point keeps a known kind");
}

// ---------- 3. откат, когда файла нет ----------
console.log("\n=== with no structure file, the pipeline stands aside ===");
{
  __test__.clearPackStructures();
  resetStructureCache();

  assert(structuresSupported(), "the engine exposes structure placement");
  assert(packStructureIds().size === 0, "the pack contains no structures, which is its real state today");
  assert(BUILDING_MANIFEST.length === 0,
    "and the manifest is empty to match, so no record can point at a missing file");
  assert(requiredStructureIds().length === 0, "nothing is required of the pack yet");
  assert(missingStructures().length === 0, "so nothing is reported missing");
  assert(reportMissingStructures().length === 0, "and the start-up check is quiet");

  // The important half: an id the manifest does not know returns null so the
  // caller uses its procedural builder, rather than half-building anything.
  assert(placeBuilding(dim, { x: 0, y: 70, z: 0 }, 0, "resident_cottage", 0, 0, "plains") === null,
    "an unknown building id hands back to the procedural builder");
  assert(structureAvailable("resident_cottage") === false, "and reports itself unavailable");
}

// ---------- 4. установка, когда файл есть ----------
console.log("\n=== with a structure file, the building is placed and repainted ===");
{
  // A 3x2x3 lump made entirely of placeholders: foundation course, then walls.
  const blocks = [];
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 3; z++) {
      blocks.push({ x, y: 0, z, typeId: "minecraft:red_wool" });          // foundation
      blocks.push({ x, y: 1, z, typeId: "minecraft:purple_terracotta" }); // wall
    }
  }
  // One block that is NOT a placeholder, to prove the swap is selective.
  blocks.push({ x: 1, y: 1, z: 1, typeId: "minecraft:chest" });

  __test__.clearPackStructures();
  __test__.resetStructurePlacements();
  __test__.addPackStructure("gv:buildings/hut", { x: 3, y: 2, z: 3 }, blocks);
  resetStructureCache();

  // The manifest is empty by design, so the record is injected - the same
  // idiom tryLevelUp uses for its builder. That way this drives the real
  // placeBuilding, not a hand-assembled imitation of it: without the
  // injection, only its fallback branch would ever run in a test.
  const hut = defineBuilding({
    id: "hut",
    structure: "gv:buildings/hut",
    footprint: { fMin: 0, fMax: 2, sMin: 0, sMax: 2, upMin: 0, upMax: 1 },
    poi: [{ kind: "npc", at: { f: 1, s: 1, up: 1 } }]
  });

  for (const paletteId of ["plains", "taiga", "desert"]) {
    __test__.clearPackStructures();
    __test__.resetStructurePlacements();
    __test__.addPackStructure("gv:buildings/hut", { x: 3, y: 2, z: 3 }, blocks);
    resetStructureCache();

    const origin = { x: 40 + Object.keys(PALETTES).indexOf(paletteId) * 60, y: 70, z: 140 };
    const facing = 0;
    const shape = placeBuilding(dim, origin, facing, "hut", 0, 0, paletteId,
      { record: hut, runJob: false });

    assert(shape !== null, `${paletteId}: placeBuilding returned a shape rather than falling back`);
    assert(shape?.source === "structure", `${paletteId}: the shape says where it came from (${shape?.source})`);
    assert(shape?.buildingId === "hut" && shape?.structure === "gv:buildings/hut",
      `${paletteId}: and which structure built it`);
    assert(shape?.f1 === 0 && shape?.f2 === 2 && shape?.s1 === 0 && shape?.s2 === 2,
      `${paletteId}: with the footprint downstream code reads (${shape?.f1}..${shape?.f2})`);
    assert(shape?.poi?.length === 1 && shape.poi[0].kind === "npc",
      `${paletteId}: and the resident's spawn point`);

    const placement = __test__.structurePlacements.at(-1);
    assert(placement?.id === "gv:buildings/hut", `${paletteId}: the structure was placed (${placement?.id})`);
    assert(placement?.rotation === FACING_ROTATION[facing],
      `${paletteId}: with the rotation for facing ${facing} (${placement?.rotation})`);
    assert(placement?.options?.includeEntities === false,
      `${paletteId}: and without dragging entities along`);

    // placeBuilding ran the swap inline (runJob: false), so the palette must
    // already be applied - no placeholder may survive into the finished house.
    const p = paletteById(paletteId);
    const wallAt = toWorld(origin, facing, 0, 0, 1);
    const floorAt = toWorld(origin, facing, 0, 0, 0);
    const chestAt = toWorld(origin, facing, 1, 1, 1);
    assert(dim.getBlock(wallAt).typeId === `minecraft:${p.wood}_planks`,
      `${paletteId}: wall placeholder became ${p.wood}_planks (${dim.getBlock(wallAt).typeId})`);
    assert(dim.getBlock(floorAt).typeId === `minecraft:${p.stone}`,
      `${paletteId}: foundation placeholder became ${p.stone} (${dim.getBlock(floorAt).typeId})`);
    assert(dim.getBlock(chestAt).typeId === "minecraft:chest",
      `${paletteId}: a non-placeholder block was left alone (${dim.getBlock(chestAt).typeId})`);

    let leftover = 0;
    for (let f = 0; f <= 2; f++) {
      for (let sv = 0; sv <= 2; sv++) {
        for (let up = 0; up <= 1; up++) {
          const id = dim.getBlock(toWorld(origin, facing, f, sv, up)).typeId;
          if (PLACEHOLDER_BLOCKS[id]) leftover++;
        }
      }
    }
    assert(leftover === 0, `${paletteId}: no placeholder survived the swap (${leftover} left)`);
  }

  // And the same record with its file removed falls back instead.
  __test__.clearPackStructures();
  resetStructureCache();
  assert(placeBuilding(dim, { x: 0, y: 70, z: 0 }, 0, "hut", 0, 0, "plains", { record: hut }) === null,
    "the same record with no file in the pack falls back to the procedural builder");
}

console.log("\n=== a manifest record whose file is missing is reported, not swallowed ===");
{
  __test__.clearPackStructures();
  resetStructureCache();
  // Placement of an id the pack does not have throws in the engine, and the
  // pipeline must turn that into "use the procedural builder" rather than
  // letting it escape into the level-up.
  let escaped = null;
  try {
    world.structureManager.place("gv:buildings/not_there", dim, { x: 0, y: 70, z: 0 }, {});
  } catch (error) {
    escaped = error;
  }
  assert(escaped !== null && String(escaped.message).includes("InvalidStructureError"),
    "the engine really does throw for a missing structure");
  assert(placeBuilding(dim, { x: 0, y: 70, z: 0 }, 0, "not_there", 0, 0, "plains") === null,
    "and placeBuilding turns that into a clean fallback rather than a throw");
}

// ---------- 5. захват готовой постройки ----------
console.log("\n=== an existing building can be captured into a structure ===");
{
  // This is the authoring shortcut: the procedural builder that already draws
  // a house draws it, and the result is saved rather than rebuilt by hand.
  const origin = { x: -300, y: 70, z: -300 };
  const rectangle = { fMin: 0, fMax: 2, sMin: 0, sMax: 2, upMin: 0, upMax: 1 };
  for (let f = 0; f <= 2; f++) {
    for (let s = 0; s <= 2; s++) {
      const p = toWorld(origin, 0, f, s, 0);
      dim.getBlock(p).setType("minecraft:cobblestone");
    }
  }
  const captured = captureBuilding(dim, origin, 0, rectangle, "gv:captured/probe");
  assert(captured.ok, `capture succeeds (${captured.reason ?? "ok"})`);
  assert(world.structureManager.getWorldStructureIds().includes("gv:captured/probe"),
    "and the structure exists afterwards");
  const saved = world.structureManager.get("gv:captured/probe");
  assert(saved.size.x === 3 && saved.size.z === 3, `at the size of the rect (${saved.size.x}x${saved.size.z})`);
  assert(saved.blocks.some((block) => block.typeId === "minecraft:cobblestone"),
    "and it really contains the blocks that were standing there");
}

// ---------- 6. проверка не пустая ----------
console.log("\n=== the fallback is a real branch, not the only branch ===");
{
  // Everything above would pass on a placeBuilding that always returned null,
  // so prove placement does happen when a record and a file both exist.
  __test__.clearPackStructures();
  __test__.resetStructurePlacements();
  __test__.addPackStructure("gv:buildings/probe", { x: 1, y: 1, z: 1 },
    [{ x: 0, y: 0, z: 0, typeId: "minecraft:purple_terracotta" }]);
  resetStructureCache();
  assert(packStructureIds().has("gv:buildings/probe"),
    "the pack listing reflects a structure that was added");
  world.structureManager.place("gv:buildings/probe", dim, { x: 900, y: 70, z: 900 }, { rotation: "Rotate90" });
  assert(__test__.structurePlacements.length === 1, "a placement was recorded");
  assert(__test__.structurePlacements[0].rotation === "Rotate90", "with the rotation it was given");
  assert(dim.getBlock({ x: 900, y: 70, z: 900 }).typeId === "minecraft:purple_terracotta",
    "and the block actually landed in the world");
  __test__.clearPackStructures();
  resetStructureCache();
}

console.log(failures === 0 ? "\nALL STRUCTURE PIPELINE CHECKS PASSED" : `\n${failures} STRUCTURE PIPELINE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
