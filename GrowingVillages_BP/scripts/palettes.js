export const PALETTES = {
  plains: { id: "plains", label: "Равнины", wood: "oak", stone: "cobblestone", roof: "oak_stairs", surface: "grass_block" },
  meadow: { id: "meadow", label: "Луга", wood: "oak", stone: "stone_bricks", roof: "oak_stairs", surface: "grass_block" },
  taiga: { id: "taiga", label: "Тайга", wood: "spruce", stone: "cobblestone", roof: "spruce_stairs", surface: "grass_block" },
  // Bedrock's plain terracotta block is "hardened_clay" - "terracotta" is the
  // Java name and does not resolve, so a savanna village used to get houses
  // with no foundation at all (setBlock swallows the throw). terrain.js has
  // carried a comment saying exactly this since the tree-clearing fix; this
  // palette was simply never updated to match.
  savanna: { id: "savanna", label: "Саванна", wood: "acacia", stone: "hardened_clay", roof: "acacia_stairs", surface: "grass_block" },
  desert: { id: "desert", label: "Пустыня", wood: "acacia", stone: "sandstone", roof: "sandstone_stairs", surface: "sand" }
};

// Exported so tests/biome_palettes.mjs can assert membership exactly rather
// than inferring it from the palette a lookup happens to return - a biome
// deliberately mapped to plains and one that fell through to plains are
// indistinguishable from the outside, and that difference is the bug.
export const BIOME_TO_PALETTE = {
  "minecraft:plains": "plains", "minecraft:sunflower_plains": "plains",
  "minecraft:meadow": "meadow", "minecraft:cherry_grove": "meadow",
  "minecraft:taiga": "taiga", "minecraft:old_growth_pine_taiga": "taiga", "minecraft:old_growth_spruce_taiga": "taiga",
  // Bedrock's legacy cold/snowy biome ids - see the matching .biome.json
  // files shipped in GrowingVillages_BP/biomes/. Left unmapped, a village
  // founded here silently fell back to the "plains" (oak) palette even
  // though the ground and treeline read as taiga, which is why a snowy
  // village could end up all in oak instead of spruce.
  "minecraft:ice_plains": "taiga", "minecraft:cold_taiga": "taiga",
  "minecraft:cold_taiga_hills": "taiga", "minecraft:taiga_hills": "taiga",
  "minecraft:savanna": "savanna", "minecraft:savanna_plateau": "savanna", "minecraft:windswept_savanna": "savanna",
  "minecraft:desert": "desert",
  // The hills and mutated variants our own biomes/*.json name as
  // hills_transformation / mutate_transformation targets. Vanilla generates
  // these next to their parent biome, so a village could land in one - and
  // every one of them used to fall through to the plains oak palette, which
  // is the same bug already fixed once above for the cold biomes: sand and
  // spruce on the ground, oak in the houses.
  //
  // These ids are taken from this pack's biome definitions, not from memory;
  // tests/biome_palettes.mjs asserts that the two stay in agreement, so a new
  // biome file cannot quietly reintroduce the gap.
  "minecraft:desert_hills": "desert", "minecraft:desert_mutated": "desert",
  "minecraft:taiga_mutated": "taiga", "minecraft:cold_taiga_mutated": "taiga",
  "minecraft:ice_mountains": "taiga", "minecraft:ice_plains_spikes": "taiga",
  "minecraft:savanna_mutated": "savanna"
};

function paletteForBiomeId(biomeId) {
  return PALETTES[BIOME_TO_PALETTE[biomeId] || "plains"];
}

export function paletteAt(dimension, location) {
  try { return paletteForBiomeId(dimension.getBiome(location)?.id); } catch (e) { return PALETTES.plains; }
}

export function paletteById(id) { return PALETTES[id] || PALETTES.plains; }
