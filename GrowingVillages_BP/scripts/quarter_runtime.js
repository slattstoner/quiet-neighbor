import { world, system } from "@minecraft/server";
import { buildQuarterSlot, residentAnchorFor } from "./quarter_buildings.js";
import { slotsUnlockedAt, quarterForSlot } from "./quarters.js";
import { spawnResident } from "./npc.js";
import { toWorld } from "./util.js";
import {
  DEFAULT_PALETTE_ID, PROP_ID, PROP_LAYOUT_VERSION,
  isUsableFacing, isUsableOrigin, readFacing, readLevel, readOrigin, readPaletteId, readProperty
} from "./village_state.js";

const LAYOUT_V2 = 2;
const BUILT_PREFIX = "village:quarter:";
const RESIDENT_PREFIX = "village:quarterResident:";

// One plot per pass, every five seconds. A district building is a few hundred
// block calls - cheap on its own, but eighteen of them in the same tick is
// not, and a level-up that unlocks two plots would do exactly that. Spreading
// them out also means the village visibly fills in over a minute or two
// instead of a whole district appearing between two blinks.
const LOOP_INTERVAL_TICKS = 100;

function builtKey(slotId) { return BUILT_PREFIX + slotId; }
function residentKey(slotId) { return RESIDENT_PREFIX + slotId; }

/** Village state a district build needs, or null if the elder is not usable yet. */
function districtState(elder) {
  if (readProperty(elder, PROP_LAYOUT_VERSION) !== LAYOUT_V2) return null;
  const origin = readOrigin(elder);
  const facing = readFacing(elder);
  if (!isUsableOrigin(origin) || !isUsableFacing(facing)) return null;
  return {
    elder,
    origin,
    facing,
    palette: readPaletteId(elder) || DEFAULT_PALETTE_ID,
    id: readProperty(elder, PROP_ID),
    level: readLevel(elder)
  };
}

/** The next district plot this village has earned but not yet built. */
export function nextPendingSlot(elder, level) {
  for (const spec of slotsUnlockedAt(level)) {
    if (!elder.getDynamicProperty(builtKey(spec.id))) return spec;
  }
  return null;
}

/**
 * Puts the plot's villager in its own building.
 *
 * Deliberately spawned as a resident rather than a craftsman: it has no quest
 * chain, so the craftsman tag would open an empty quest menu instead of the
 * vanilla trading screen. Its profession arrives on its own once it claims the
 * job-site block standing a couple of blocks away - the same mechanism the
 * four craftsmen already use, and the reason this needs no profession event
 * name to keep in sync with future engine renames.
 */
function settleResident(state, spec, shape) {
  if (!spec.resident) return false;
  if (state.elder.getDynamicProperty(residentKey(spec.id))) return false;
  const anchor = residentAnchorFor(shape);
  const at = toWorld(state.origin, state.facing, anchor.f, anchor.s, 0);
  try {
    spawnResident(state.elder.dimension, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 }, state.id, 8, {
      name: spec.resident,
      districtId: spec.id
    });
    state.elder.setDynamicProperty(residentKey(spec.id), true);
    return true;
  } catch (error) {
    // Almost always an unloaded chunk. The marker stays unset, so the next
    // pass tries again rather than leaving an empty house forever.
    console.warn(`[village] district resident ${spec.id} failed: ${error}`);
    return false;
  }
}

/**
 * Builds at most one pending district plot for one village.
 *
 * The completion marker is written only after a successful build, so a plot
 * that failed (unloaded chunk, ground the site prep could not settle) is
 * simply retried on a later pass instead of being silently skipped forever.
 */
export function advanceDistricts(elder) {
  const state = districtState(elder);
  if (!state) return null;
  const spec = nextPendingSlot(elder, state.level);
  if (!spec) return null;

  const result = buildQuarterSlot(spec.id, elder.dimension, state);
  if (!result.ok) return result;

  try {
    elder.setDynamicProperty(builtKey(spec.id), true);
  } catch (error) {
    // Without the marker this plot would be rebuilt every pass. Better to
    // report the failure than to loop on it.
    console.warn(`[village] district marker write failed for ${spec.id}: ${error}`);
    return { ok: false, reason: "marker_failed", slotId: spec.id };
  }

  const settled = settleResident(state, spec, result.shape);
  const district = quarterForSlot(spec.id);
  return { ...result, settled, districtId: district?.id || null, districtLabel: district?.label || null };
}

/** How much of its districts a village has actually built. */
export function districtProgress(elder) {
  const level = readLevel(elder);
  const unlocked = slotsUnlockedAt(level);
  const built = unlocked.filter((spec) => !!elder.getDynamicProperty(builtKey(spec.id)));
  return { unlocked: unlocked.length, built: built.length, pending: unlocked.length - built.length };
}

export function startQuarterLoop() {
  system.runInterval(() => {
    let elders;
    try {
      elders = world.getDimension("overworld").getEntities({ tags: ["village_elder"] });
    } catch (error) {
      return;
    }
    for (const elder of elders) {
      try {
        const result = advanceDistricts(elder);
        if (result?.ok && result.districtLabel) {
          console.warn(`[village] district built: ${result.districtLabel} / ${result.label}`);
        }
      } catch (error) {
        console.warn("[village] district loop: " + error);
      }
    }
  }, LOOP_INTERVAL_TICKS);
}
