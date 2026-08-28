import { world, system } from "@minecraft/server";
import { foundVillage, findNearestElder } from "./village.js";
import { toWorld } from "./util.js";
import { paletteAt } from "./palettes.js";
import { probeGround } from "./terrain.js";

const CELL = 512;
const MIN_DISTANCE = 360;
// A candidate is considered once globally after a player comes close enough
// to its cell, avoiding per-player duplicate attempts.
const checkedCandidates = new Set();

function hash(x, z) {
  let n = Math.imul(x, 374761393) + Math.imul(z, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  return (Math.imul(n, 1274126177) ^ (n >>> 16)) >>> 0;
}

function candidateForCell(cx, cz) {
  const h = hash(cx, cz);
  return {
    x: cx * CELL + 96 + (h % 320),
    z: cz * CELL + 96 + (Math.floor(h / 1024) % 320),
    roll: (h >>> 12) % 100,
    facing: h % 4
  };
}

function hasVanillaVillageNearby(dimension, location) {
  try {
    return dimension.getEntities({ location, maxDistance: 180, type: "minecraft:villager_v2" })
      .some((e) => !e.hasTag("village_npc"));
  } catch (e) { return true; }
}

function suitableSite(dimension, candidate) {
  const heights = [];
  for (const dx of [-16, 0, 16]) for (const dz of [-16, 0, 16]) {
    const g = probeGround(dimension, candidate.x + dx, candidate.z + dz, 160, -32);
    if (!g || g.typeId.includes("water") || g.typeId.includes("lava")) return null;
    heights.push(g.y);
  }
  const spread = Math.max(...heights) - Math.min(...heights);
  if (spread > 5) return null;
  const ground = probeGround(dimension, candidate.x, candidate.z, 160, -32);
  return ground ? { x: candidate.x, y: ground.y + 1, z: candidate.z } : null;
}

function tryGenerateFor(player) {
  if (player.dimension.id && player.dimension.id !== "minecraft:overworld") return;
  const cx = Math.floor(player.location.x / CELL), cz = Math.floor(player.location.z / CELL);
  // candidateForCell only knows x/z (it's a pure hash of the cell, computed
  // before any ground probe exists). The player's own y is a fine stand-in
  // for these preliminary existence checks - they only need a valid number
  // for the native location argument, not an accurate height; the real
  // ground height is computed later by suitableSite() for the actual site.
  const candidate = { ...candidateForCell(cx, cz), y: player.location.y };
  if (Math.hypot(player.location.x - candidate.x, player.location.z - candidate.z) > 176) return;

  const dimension = player.dimension;
  const key = `${dimension.id || "minecraft:overworld"}:${cx},${cz}`;
  if (checkedCandidates.has(key)) return;
  checkedCandidates.add(key);

  // One stable candidate per cell, attempted every time (no extra random
  // skip), the same way a vanilla structure set tries once per spacing
  // region: only terrain suitability and distance to a neighbor thin out
  // attempts, so our villages end up about as common as vanilla ones would
  // have been across the same ground. The candidate does not depend on
  // player direction.
  if (findNearestElder(dimension, candidate, MIN_DISTANCE) || hasVanillaVillageNearby(dimension, candidate)) return;
  const palette = paletteAt(dimension, candidate);
  const site = suitableSite(dimension, candidate);
  if (!site) return;
  system.run(() => {
    if (findNearestElder(dimension, site, MIN_DISTANCE) || hasVanillaVillageNearby(dimension, site)) return;
    const elder = foundVillage(player, site, candidate.facing, palette.id);
    elder?.setDynamicProperty("village:generated", true);
    elder?.setDynamicProperty("village:palette", palette.id);
    player.sendMessage(`§7Вдали виднеется новое поселение: §r${palette.label}.`);
  });
}

export function startExplorationVillageLoop() {
  system.runInterval(() => {
    for (const player of world.getPlayers()) {
      try { tryGenerateFor(player); } catch (e) { console.warn("[village] exploration generation failed: " + e); }
    }
  }, 20 * 15);
}

export { candidateForCell, suitableSite };
