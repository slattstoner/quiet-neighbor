export const PALETTES = {
  plains: { id: "plains", label: "Равнины", wood: "oak", stone: "cobblestone", roof: "oak_stairs", surface: "grass_block" },
  meadow: { id: "meadow", label: "Луга", wood: "oak", stone: "stone_bricks", roof: "oak_stairs", surface: "grass_block" },
  taiga: { id: "taiga", label: "Тайга", wood: "spruce", stone: "cobblestone", roof: "spruce_stairs", surface: "grass_block" },
  savanna: { id: "savanna", label: "Саванна", wood: "acacia", stone: "terracotta", roof: "acacia_stairs", surface: "grass_block" },
  desert: { id: "desert", label: "Пустыня", wood: "acacia", stone: "sandstone", roof: "sandstone_stairs", surface: "sand" }
};

const BIOME_TO_PALETTE = {
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
  "minecraft:desert": "desert"
};

export function paletteForBiomeId(biomeId) {
  return PALETTES[BIOME_TO_PALETTE[biomeId] || "plains"];
}

export function paletteAt(dimension, location) {
  try { return paletteForBiomeId(dimension.getBiome(location)?.id); } catch (e) { return PALETTES.plains; }
}

export function paletteById(id) { return PALETTES[id] || PALETTES.plains; }
