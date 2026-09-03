// Stage 6: the survey charter and the sites it marks.
//
// The point of an outpost is that it is *outside* the village and stays
// outside it. The obvious implementation - place it just beyond the wall the
// village has right now - looks correct the day it is built and is wrong by
// level 15, when the curtain pushes out to R94 and swallows anything that was
// sitting beyond an R44 palisade. So the first thing checked here is that the
// sites clear the wall's *final* reach, not its current one.

import { __test__, ItemStack } from "@minecraft/server";
import { OUTPOST_SLOTS, OUTPOST_KINDS, OUTPOST_ORDER, OUTPOST_HALF, buildOutpost } from "./scripts/outposts.js";
import {
  SURVEY_CHARTER_ID, CHARTER_MIN_LEVEL, useSurveyCharter, nextSurvey,
  surveyedSlots, charterMessage
} from "./scripts/outpost_runtime.js";
import { FINAL_RADIUS, SPATIAL_PLAN, ROAD_AXES } from "./scripts/spatial_plan.js";
import { ALL_SLOTS as QUARTER_SLOTS } from "./scripts/quarters.js";
import { foundVillage, getVillageState } from "./scripts/village.js";
import { PROP_LEVEL } from "./scripts/village_state.js";
import { toWorld } from "./scripts/util.js";

let checks = 0, failures = 0;
function assert(condition, label) {
  checks++;
  if (condition) console.log(`ok: ${label}`);
  else { failures++; console.error(`FAIL: ${label}`); }
}
const blockAt = (dimension, x, y, z) => {
  try { return dimension.getBlock({ x, y, z })?.typeId; } catch (e) { return undefined; }
};
const overlap = (a, b) => a.fMin <= b.fMax && a.fMax >= b.fMin && a.sMin <= b.sMax && a.sMax >= b.sMin;
const boundsOf = (slot) => ({
  fMin: slot.f - OUTPOST_HALF, fMax: slot.f + OUTPOST_HALF,
  sMin: slot.s - OUTPOST_HALF, sMax: slot.s + OUTPOST_HALF
});

// ---------------------------------------------------------------- 1
console.log("=== the sites stay outside the wall, forever ===");
{
  assert(OUTPOST_SLOTS.length === 4, `one site per corner (${OUTPOST_SLOTS.length})`);
  assert(OUTPOST_ORDER.length === OUTPOST_SLOTS.length, "a different kind of site for each corner");
  assert(new Set(OUTPOST_ORDER).size === OUTPOST_ORDER.length, "no village ends up with four abandoned mines");
  for (const kind of OUTPOST_ORDER) assert(!!OUTPOST_KINDS[kind], `${kind}: has a builder`);

  let siteCollisions = 0;
  for (const slot of OUTPOST_SLOTS) {
    const b = boundsOf(slot);
    const nearest = Math.min(Math.abs(b.fMin), Math.abs(b.fMax), Math.abs(b.sMin), Math.abs(b.sMax));
    // R94 is the last stage in PERIMETER_SCHEDULE. Clearing it by the whole
    // site footprint is what makes "the wall can never grow over this" true
    // rather than merely true today.
    assert(nearest > FINAL_RADIUS, `${slot.id}: the whole site clears the final R${FINAL_RADIUS} wall (nearest edge ${nearest})`);
    // Both road arms run out to the gates on the axes; a diagonal site misses
    // them without having to know anything about roads.
    assert(!overlap(b, ROAD_AXES.forward.bounds) && !overlap(b, ROAD_AXES.side.bounds), `${slot.id}: clear of both road arms`);
    for (const planned of SPATIAL_PLAN) {
      for (const envelope of [planned.bounds, ...planned.reserveEnvelopes.map((r) => r.bounds)]) {
        if (overlap(b, envelope)) { siteCollisions++; assert(false, `${slot.id} overlaps ${planned.buildingId}`); }
      }
    }
    for (const quarter of QUARTER_SLOTS) {
      if (overlap(b, quarter.bounds)) { siteCollisions++; assert(false, `${slot.id} overlaps the ${quarter.id} district plot`); }
    }
  }
  for (let i = 0; i < OUTPOST_SLOTS.length; i++) {
    for (let j = i + 1; j < OUTPOST_SLOTS.length; j++) {
      if (overlap(boundsOf(OUTPOST_SLOTS[i]), boundsOf(OUTPOST_SLOTS[j]))) {
        siteCollisions++;
        assert(false, `${OUTPOST_SLOTS[i].id} overlaps ${OUTPOST_SLOTS[j].id}`);
      }
    }
  }
  // Was assert(true, ...): it reported success even when the loops above had
  // just failed. The count is what makes the summary mean something.
  assert(siteCollisions === 0,
    `no site overlaps the village, its districts, its roads or another site (${siteCollisions} collisions)`);
}

// ---------------------------------------------------------------- 2
console.log("\n=== every site actually builds, with loot in it ===");
{
  const player = __test__.makePlayer("OutpostTester", { x: 900000, y: 70, z: 900000 });
  const origin = { x: 900000, y: 70, z: 900000 };
  const elder = foundVillage(player, origin, 0);
  const state = getVillageState(elder);

  for (const [index, kind] of OUTPOST_ORDER.entries()) {
    const slot = OUTPOST_SLOTS[index];
    const result = buildOutpost(kind, slot.id, elder.dimension, state);
    assert(result.ok, `${kind}: builds${result.ok ? "" : " - " + result.error}`);
    if (!result.ok) continue;

    let solid = 0;
    for (let f = slot.f - 6; f <= slot.f + 6; f++) {
      for (let s = slot.s - 6; s <= slot.s + 6; s++) {
        for (let up = -12; up <= 8; up++) {
          const p = toWorld(origin, 0, f, s, up);
          const id = blockAt(elder.dimension, p.x, p.y, p.z);
          if (id && id !== "minecraft:air") solid++;
        }
      }
    }
    assert(solid > 200, `${kind}: a real structure stands there (${solid} blocks)`);

    const chestAt = toWorld(origin, 0, result.shape.chest.f, result.shape.chest.s, result.shape.chest.up);
    assert(blockAt(elder.dimension, chestAt.x, chestAt.y, chestAt.z) === "minecraft:chest", `${kind}: its chest is where the builder says it is`);
    assert(result.looted, `${kind}: the chest was actually stocked`);

    const container = elder.dimension.getBlock(chestAt)?.getComponent("minecraft:inventory")?.container;
    let items = 0, forbidden = [];
    for (let i = 0; i < (container?.size || 0); i++) {
      const stack = container.getItem(i);
      if (!stack) continue;
      items++;
      // The village must never out-earn the player's own mining - the same
      // rule production.js's caps exist for. A chest at the end of a walk is
      // exactly where that rule would quietly get broken.
      if (/diamond|netherite|emerald|enchanted/.test(stack.typeId)) forbidden.push(stack.typeId);
    }
    assert(items >= 3, `${kind}: there is something worth the walk (${items} stacks)`);
    assert(forbidden.length === 0, `${kind}: nothing in it undercuts the player's own mining (${forbidden.join(", ") || "clean"})`);
  }
}

// ---------------------------------------------------------------- 3
console.log("\n=== using the charter ===");
{
  const player = __test__.makePlayer("CharterTester", { x: 930000, y: 70, z: 930000 });
  const origin = { x: 930000, y: 70, z: 930000 };
  const elder = foundVillage(player, origin, 0);
  const container = player.getComponent("minecraft:inventory").container;
  const giveCharter = () => container.setItem(0, new ItemStack(SURVEY_CHARTER_ID, 1));
  const heldCharters = () => {
    let n = 0;
    for (let i = 0; i < container.size; i++) if (container.getItem(i)?.typeId === SURVEY_CHARTER_ID) n++;
    return n;
  };

  giveCharter();
  const tooEarly = useSurveyCharter(player, elder);
  assert(!tooEarly.ok && tooEarly.reason === "too_early", "a level-1 village has no cartographer to have drawn the charter");
  assert(heldCharters() === 1, "…and a refused survey does not eat the charter");
  assert(charterMessage(tooEarly).includes(String(CHARTER_MIN_LEVEL)), "the refusal says which level is needed");

  elder.setDynamicProperty(PROP_LEVEL, CHARTER_MIN_LEVEL);
  assert(surveyedSlots(elder).length === 0, "nothing is surveyed yet");

  const seenKinds = [];
  for (let use = 0; use < OUTPOST_SLOTS.length; use++) {
    giveCharter();
    const pending = nextSurvey(elder);
    assert(!!pending, `use ${use + 1}: there is a site left to mark`);
    const result = useSurveyCharter(player, elder);
    assert(result.ok, `use ${use + 1}: raises ${pending?.kind}`);
    if (result.ok) {
      seenKinds.push(result.kind);
      assert(heldCharters() === 0, `use ${use + 1}: the charter is spent`);
      assert(surveyedSlots(elder).length === use + 1, `use ${use + 1}: the village remembers it`);
      assert(result.remaining === OUTPOST_SLOTS.length - (use + 1), `use ${use + 1}: reports ${result.remaining} left`);
      assert(charterMessage(result).includes(String(result.world.x)), `use ${use + 1}: the player is told where to go`);
    }
  }
  assert(new Set(seenKinds).size === OUTPOST_SLOTS.length, `each corner got a different kind of site (${seenKinds.join(", ")})`);

  giveCharter();
  const exhausted = useSurveyCharter(player, elder);
  assert(!exhausted.ok && exhausted.reason === "all_surveyed", "once all four corners are marked the charter has nothing left to show");
  assert(heldCharters() === 1, "…and it is not consumed for nothing");
}

console.log(failures === 0
  ? `\nALL OUTPOST TESTS PASSED (${checks} checks)`
  : `\n${failures} OUTPOST TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
