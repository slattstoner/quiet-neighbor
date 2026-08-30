import { BlockPermutation } from "@minecraft/server";

/**
 * Resolves a block permutation defensively. If the requested states are
 * invalid (e.g. a state name changed between versions) we fall back to the
 * plain block, and if even that fails we fall back to air rather than
 * throwing and aborting an entire build.
 */
function safePermutation(typeId, states) {
  try {
    if (states) return BlockPermutation.resolve(typeId, states);
    return BlockPermutation.resolve(typeId);
  } catch (e1) {
    try {
      return BlockPermutation.resolve(typeId);
    } catch (e2) {
      console.warn(`[village] unknown block ${typeId}, using air`);
      return BlockPermutation.resolve("minecraft:air");
    }
  }
}

/**
 * Places a block with a two-step guarantee: the block TYPE is set first
 * via Block.setType(), which needs no state resolution and is far less
 * likely to fail than BlockPermutation.resolve(typeId, states). Only once
 * the block itself genuinely exists do we attempt to layer on an oriented
 * permutation, and if every state scheme fails, the plain block stays
 * exactly as setType left it rather than being replaced with air.
 *
 * This is what actually fixes "doors just aren't there": whatever was
 * making the state-resolve calls fail, the door block itself now survives
 * regardless, at worst with a default orientation instead of no door.
 */
export function setBlockMulti(dimension, x, y, z, typeId, stateCandidates) {
  let block;
  try {
    block = dimension.getBlock({ x, y, z });
    if (!block) return false;
    block.setType(typeId);
  } catch (e) {
    console.warn(`[village] could not place base block ${typeId}: ${e}`);
    return false;
  }
  for (const states of stateCandidates) {
    try {
      block.setPermutation(BlockPermutation.resolve(typeId, states));
      return true;
    } catch (e) {
      /* try the next scheme; the plain block from setType still stands */
    }
  }
  return true;
}

/** Cardinal names in the order used by the integer "direction" state (0=S,1=W,2=N,3=E). */
export const CARDINAL_NAMES = ["south", "west", "north", "east"];

/** facing_direction integer for a cardinal name (2=N,3=S,4=W,5=E). */
export const FACING_DIRECTION = { north: 2, south: 3, west: 4, east: 5 };

/** The compass direction directly opposite the given one. */
export function oppositeCardinal(name) {
  return { north: "south", south: "north", east: "west", west: "east" }[name];
}

/**
 * Places a single block, swallowing errors from unloaded chunks so one bad
 * coordinate never stops the rest of a build. Uses the same type-first
 * guarantee as setBlockMulti: the block exists even if its states don't
 * apply cleanly.
 */
export function setBlock(dimension, x, y, z, typeId, states) {
  let block;
  try {
    block = dimension.getBlock({ x, y, z });
    if (!block) return false;
    block.setType(typeId);
  } catch (e) {
    return false;
  }
  if (states) {
    try {
      block.setPermutation(BlockPermutation.resolve(typeId, states));
    } catch (e) {
      /* plain block from setType still stands */
    }
  }
  return true;
}

/** Fills an axis-aligned box (inclusive) with a single block type. */
export function fillBox(dimension, x1, y1, z1, x2, y2, z2, typeId, states) {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
  let perm = null;
  if (states) {
    try {
      perm = BlockPermutation.resolve(typeId, states);
    } catch (e) {
      /* fall through to plain setType per block below */
    }
  }
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        try {
          const block = dimension.getBlock({ x, y, z });
          if (!block) continue;
          if (perm) {
            block.setPermutation(perm);
          } else {
            block.setType(typeId);
          }
        } catch (e) {
          /* unloaded chunk edge - skip */
        }
      }
    }
  }
}

/**
 * Converts a "local" street-relative coordinate (forward = distance down the
 * main street from the origin, side = perpendicular offset, up = height)
 * into a world coordinate, based on the village's stored facing (0=+X,
 * 1=-X, 2=+Z, 3=-Z). This lets every building be authored once and placed
 * correctly no matter which way the village ended up facing when it was
 * founded.
 */
export function toWorld(origin, facing, forward, side, up) {
  const y = origin.y + (up || 0);
  switch (facing) {
    case 0: return { x: origin.x + forward, y, z: origin.z + side };
    case 1: return { x: origin.x - forward, y, z: origin.z - side };
    case 2: return { x: origin.x + side, y, z: origin.z + forward };
    case 3: return { x: origin.x - side, y, z: origin.z - forward };
    default: return { x: origin.x + forward, y, z: origin.z + side };
  }
}

/** 0=+X, 1=-X, 2=+Z, 3=-Z from a player's view direction, snapped to a cardinal. */
export function facingFromDirection(viewDirection) {
  const { x, z } = viewDirection;
  if (Math.abs(x) >= Math.abs(z)) {
    return x >= 0 ? 0 : 1;
  }
  return z >= 0 ? 2 : 3;
}

export function randomId() {
  return Math.random().toString(36).slice(2, 9);
}

/** Colored name helper using Bedrock's "§" formatting codes. */
/**
 * Every custom villager (elder, craftsmen, residents, guards) is spawned
 * with this identifier and these options instead of plain
 * dimension.spawnEntity("minecraft:villager_v2", location). Bedrock's own
 * villager spawn logic randomizes age the same way it does for cows - a
 * small chance of coming out as a baby - and a baby villager can't be
 * interacted with the way an adult can (no trading UI, and this mod's own
 * menu/dialogue hooks off the same interaction), so a plain spawn could
 * silently produce an elder whose menu never opens.
 *
 * ADULT_SPAWN_OPTIONS.spawnEvent forces the entity straight to its adult
 * component group at spawn, before any baby state is ever assigned - this
 * is the *current* API for it. An earlier version of this fix used the
 * "minecraft:villager_v2<minecraft:ageable_grow_up>" identifier suffix
 * instead; that syntax is deprecated as of engine 1.21.80 and now throws
 * InvalidArgumentError on every single spawn (including the elder's, at
 * founding), which - because that throw was caught by main.js's generic
 * error handler - showed up in-game as a misleading "surface is too
 * uneven, try somewhere else" message that had nothing to do with terrain.
 * Always pass spawnEvent as a SpawnEntityOptions argument, never folded
 * into the identifier string.
 */
export const VILLAGER_TYPE = "minecraft:villager_v2";
export const ADULT_SPAWN_OPTIONS = { spawnEvent: "minecraft:ageable_grow_up" };

export const COLORS = {
  elder: "§e",       // yellow
  crafter: "§b",     // aqua/blue
  villager: "§7",    // gray
  guard: "§c",       // red
  quest: "§a",       // green
  reset: "§r"
};

export function coloredName(text, colorCode) {
  return `${colorCode}${text}${COLORS.reset}`;
}
