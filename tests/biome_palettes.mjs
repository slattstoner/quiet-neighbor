import { __test__ } from "@minecraft/server";
import { readFileSync, readdirSync } from "node:fs";
import { PALETTES, BIOME_TO_PALETTE, paletteAt, paletteById } from "./scripts/palettes.js";
import { foundVillage } from "./scripts/village.js";
import { PROP_PALETTE } from "./scripts/village_state.js";

/**
 * Which palette a village is built from, decided by the biome it stands in.
 *
 * This whole subsystem was untestable and therefore untested. `paletteAt` is
 * the only code that resolves a biome to a palette, and it does it through
 * `Dimension.getBiome` - which the mock did not implement at all. The call
 * threw on every run, the bare `catch` returned plains, and so all sixty
 * suites exercised the fallback and nothing else: BIOME_TO_PALETTE, the ten
 * .biome.json files and four of the five palettes were dead weight as far as
 * the suite was concerned. palette_block_ids.mjs looks like it covers this,
 * but it hands each builder a palette id directly and never asks how a real
 * village would have chosen one.
 *
 * On the old mock the first section below fails outright: a taiga village
 * comes back oak instead of spruce.
 *
 * The second thing this pins is the agreement between two files that have no
 * reason to know about each other: every biome our own biomes/*.json can
 * generate - including the hills and mutated variants they name as
 * transformation targets - has to appear in BIOME_TO_PALETTE. That gap is how
 * a snowy village ended up in oak once already.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

const HERE = import.meta.dirname;
const BIOMES = `${HERE}/../GrowingVillages_BP/biomes`;
const dim = __test__.makeDimension();

/** Paints a biome over the whole area a village could occupy and resolves it. */
function paletteInBiome(biomeId, at = { x: 0, y: 70, z: 0 }) {
  dim._clearBiomes();
  dim._setBiome({ x1: at.x - 200, x2: at.x + 200, z1: at.z - 200, z2: at.z + 200 }, biomeId);
  return paletteAt(dim, at);
}

// ---------- 1. биом решает палитру ----------
console.log("\n=== the biome a village stands in decides what it is built from ===");
{
  const expected = [
    ["minecraft:plains", "plains", "oak"],
    ["minecraft:taiga", "taiga", "spruce"],
    ["minecraft:desert", "desert", "acacia"],
    ["minecraft:savanna", "savanna", "acacia"],
    ["minecraft:meadow", "meadow", "oak"]
  ];
  for (const [biomeId, paletteId, wood] of expected) {
    const palette = paletteInBiome(biomeId);
    assert(palette.id === paletteId,
      `${biomeId} builds in the ${paletteId} palette (got ${palette.id})`);
    assert(palette.wood === wood, `  and its houses are ${wood} (${palette.wood})`);
  }

  // The distinctions that matter on the ground, and that the plains fallback
  // erased: stone under a desert house, spruce in the snow.
  assert(paletteInBiome("minecraft:desert").stone === "sandstone",
    `a desert village stands on sandstone (${paletteInBiome("minecraft:desert").stone})`);
  assert(paletteInBiome("minecraft:ice_plains").wood === "spruce",
    `a snowy village is spruce, not oak (${paletteInBiome("minecraft:ice_plains").wood})`);
  assert(paletteInBiome("minecraft:savanna").stone === "hardened_clay",
    `and a savanna village uses Bedrock's hardened_clay (${paletteInBiome("minecraft:savanna").stone})`);
}

console.log("\n=== an unknown or unreadable biome falls back, it does not throw ===");
{
  assert(paletteInBiome("minecraft:mushroom_island").id === "plains",
    "a biome nothing maps falls back to plains");

  // The fallback has to be a real fallback rather than a mask: getBiome throws
  // LocationInUnloadedChunkError for a chunk that is not loaded, and founding
  // a village must survive that rather than abort halfway.
  dim._clearBiomes();
  dim._markUnloaded({ x1: 4000, x2: 4100, z1: 4000, z2: 4100 });
  const cold = paletteAt(dim, { x: 4050, y: 70, z: 4050 });
  assert(cold && cold.id === "plains", `an unloaded chunk yields plains rather than an exception (${cold?.id})`);
  dim._clearUnloaded();
}

// ---------- 2. согласие с биомами пака ----------
console.log("\n=== every biome this pack can generate has a palette ===");
{
  const files = readdirSync(BIOMES).filter((f) => f.endsWith(".json"));
  assert(files.length === 10, `all ten biome files are present (${files.length})`);

  const declared = new Set();
  const transformations = new Set();
  for (const file of files) {
    const biome = JSON.parse(readFileSync(`${BIOMES}/${file}`, "utf8"))["minecraft:biome"];
    declared.add(biome.description.identifier);
    const rules = biome.components?.["minecraft:overworld_generation_rules"] || {};
    for (const [key, value] of Object.entries(rules)) {
      if (key.includes("transformation") && typeof value === "string") transformations.add(value);
    }
  }

  // Membership in the map, not the palette a lookup returns: a biome mapped to
  // plains on purpose and one that fell through to plains look identical from
  // outside, and telling them apart is the entire point.
  //
  // A biome the pack redefines is one a village will certainly be founded in,
  // so an unmapped one is not a hypothetical. A variant the pack generates
  // next to it is just as reachable.
  for (const biomeId of [...declared, ...transformations].sort()) {
    assert(Object.hasOwn(BIOME_TO_PALETTE, biomeId),
      `${biomeId} has an explicit palette (resolves to ${paletteInBiome(biomeId).id})`);
    const chosen = BIOME_TO_PALETTE[biomeId];
    if (chosen) {
      assert(Object.hasOwn(PALETTES, chosen), `  and "${chosen}" is a palette that exists`);
      assert(paletteInBiome(biomeId).id === chosen, `  and getBiome resolves to it end to end`);
    }
  }
  console.log(`   (${declared.size} biomes redefined, ${transformations.size} transformation targets)`);
}

console.log("\n=== no palette is unreachable, and none is a typo ===");
{
  // A palette no biome maps to is dead content; paletteById is the only other
  // way in, and it is reached only by an explicit test bell.
  const reachable = new Set();
  for (const biomeId of ["minecraft:plains", "minecraft:sunflower_plains", "minecraft:meadow",
    "minecraft:cherry_grove", "minecraft:taiga", "minecraft:old_growth_pine_taiga",
    "minecraft:ice_plains", "minecraft:cold_taiga", "minecraft:savanna", "minecraft:desert",
    "minecraft:desert_hills", "minecraft:savanna_mutated", "minecraft:ice_mountains"]) {
    reachable.add(paletteInBiome(biomeId).id);
  }
  for (const id of Object.keys(PALETTES)) {
    assert(reachable.has(id), `the ${id} palette is reachable from some biome`);
  }
  // Every palette's own id has to match its key, or paletteById returns the
  // wrong thing for a village that stored it.
  for (const [key, palette] of Object.entries(PALETTES)) {
    assert(palette.id === key, `PALETTES.${key} calls itself "${palette.id}"`);
    assert(paletteById(key).id === key, `paletteById("${key}") round-trips`);
  }
}

// ---------- 3. сквозная проверка ----------
console.log("\n=== a village founded in a desert really is a desert village ===");
{
  // The end of the chain: no explicit palette id anywhere, so foundVillage has
  // to ask the biome itself, store the answer, and every later level has to
  // build from what was stored.
  dim._clearBiomes();
  const origin = { x: 920000, y: 70, z: 0 };
  const player = __test__.makePlayer("Desertling", { ...origin });
  player.dimension._setBiome({ x1: origin.x - 300, x2: origin.x + 300, z1: -300, z2: 300 }, "minecraft:desert");

  const elder = foundVillage(player, origin, 0);
  const stored = elder.getDynamicProperty(PROP_PALETTE);
  assert(stored === "desert", `the village recorded the biome's palette (${stored})`);

  // And the same site in a taiga gives a different village, which is the proof
  // that the biome was actually consulted rather than a default landing right.
  const cold = { x: 921000, y: 70, z: 0 };
  const other = __test__.makePlayer("Taigan", { ...cold });
  other.dimension._setBiome({ x1: cold.x - 300, x2: cold.x + 300, z1: -300, z2: 300 }, "minecraft:cold_taiga");
  const coldElder = foundVillage(other, cold, 0);
  assert(coldElder.getDynamicProperty(PROP_PALETTE) === "taiga",
    `and a snowy site records taiga (${coldElder.getDynamicProperty(PROP_PALETTE)})`);
}

console.log(failures === 0 ? "\nALL BIOME PALETTE CHECKS PASSED" : `\n${failures} BIOME PALETTE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
