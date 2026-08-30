// Stage 2: the districts.
//
// Stage 1 proved the wall finally encloses every planned building. What it
// also showed is how much ground that leaves empty - most of the enclosed
// area. quarters.js reserves that ground and quarter_buildings.js builds on
// it; this checks that what gets built really does stay on its own plot, that
// it appears gradually rather than all at once, and that building it twice is
// impossible.

import { __test__ } from "@minecraft/server";
import { ALL_SLOTS, QUARTERS, SLOT_KINDS, slotsUnlockedAt, slotById, quarterForSlot, BUILDABLE_INNER_RADIUS } from "./scripts/quarters.js";
import { buildQuarterSlot } from "./scripts/quarter_buildings.js";
import { advanceDistricts, nextPendingSlot, districtProgress } from "./scripts/quarter_runtime.js";
import { foundVillage, getVillageState } from "./scripts/village.js";
import { scheduleForLevel, PERIMETER_SCHEDULE } from "./scripts/spatial_plan.js";
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

// ---------------------------------------------------------------- 1
console.log("=== the registry is well formed ===");
{
  const ids = new Set();
  for (const spec of ALL_SLOTS) {
    assert(!ids.has(spec.id), `${spec.id}: id is unique`);
    ids.add(spec.id);
    assert(SLOT_KINDS.includes(spec.kind), `${spec.id}: has a buildable kind (${spec.kind})`);
    assert(Number.isInteger(spec.unlockLevel) && spec.unlockLevel >= 5, `${spec.id}: unlocks at a real level`);
    assert(!!quarterForSlot(spec.id), `${spec.id}: belongs to a district`);
    assert(slotById(spec.id) === spec, `${spec.id}: is findable by id`);
    // A workshop without a job site is just a house - its villager would never
    // pick up a profession, which is the whole reason the archetype exists.
    if (spec.kind === "workshop") assert(!!spec.jobSite, `${spec.id}: workshop declares a job-site block`);
    if (spec.jobSite) assert(spec.jobSite.startsWith("minecraft:"), `${spec.id}: job site is a vanilla block`);
  }
  assert(ALL_SLOTS.length >= 14, `there are enough plots to fill the empty ground (${ALL_SLOTS.length})`);
  assert(QUARTERS.length >= 8, `spread across enough districts (${QUARTERS.length})`);
  assert(ALL_SLOTS.filter((s) => s.resident).length >= 8, `the population actually grows (${ALL_SLOTS.filter((s) => s.resident).length} new villagers)`);
}

// ---------------------------------------------------------------- 2
console.log("\n=== the village fills gradually, and never before its wall reaches ===");
{
  let previous = 0;
  for (let level = 1; level <= 15; level++) {
    const count = slotsUnlockedAt(level).length;
    const added = count - previous;
    // Level 15 is the wall's jump from R78 to R94, so a larger batch there is
    // the newly enclosed ring being settled, not a burst of nothing.
    const cap = level === 15 ? 4 : 2;
    assert(added <= cap, `L${level}: at most ${cap} new plots unlock (${added})`);
    previous = count;
  }
  for (const spec of ALL_SLOTS) {
    const stage = scheduleForLevel(spec.unlockLevel);
    assert(!!stage, `${spec.id}: unlocks at a level that has a wall`);
    const innerFace = stage.radius - 1;
    const b = spec.bounds;
    assert(b.fMin >= -innerFace && b.fMax <= innerFace && b.sMin >= -innerFace && b.sMax <= innerFace,
      `${spec.id}: enclosed by the R${stage.radius} wall standing at L${spec.unlockLevel}`);
    assert(Math.max(Math.abs(b.fMin), Math.abs(b.fMax), Math.abs(b.sMin), Math.abs(b.sMax)) <= BUILDABLE_INNER_RADIUS,
      `${spec.id}: inside the buildable radius`);
  }
  assert(slotsUnlockedAt(5).length === 0, "nothing is offered before the first wall has been paid for");
  assert(slotsUnlockedAt(PERIMETER_SCHEDULE[PERIMETER_SCHEDULE.length - 1].level).length === ALL_SLOTS.length,
    "by the final wall stage every plot is available");
}

// ---------------------------------------------------------------- 3
console.log("\n=== every plot builds, and every building stays on its own plot ===");
// buildQuarterSlot places through a bounded placer that throws the moment a
// block would land outside the plot, so a slot that builds without error has
// proved containment for every block it wrote - not just the ones a test
// happened to sample.
{
  const player = __test__.makePlayer("QuarterTester", { x: 610000, y: 70, z: 610000 });
  const origin = { x: 610000, y: 70, z: 610000 };
  const elder = foundVillage(player, origin, 0);
  const state = getVillageState(elder);

  for (const spec of ALL_SLOTS) {
    const result = buildQuarterSlot(spec.id, elder.dimension, state);
    assert(result.ok, `${spec.id} (${spec.kind}): builds without leaving its plot${result.ok ? "" : " - " + result.error}`);
    if (!result.ok) continue;

    // Something substantial was actually built. Counting solid blocks over the
    // whole plot volume works for every archetype: probing one column does
    // not, because a house's interior, a yard's apron and a well's mouth are
    // all legitimately air at ground level.
    let solid = 0;
    const r = result.shape.rect;
    for (let f = r.f1; f <= r.f2; f++) {
      for (let s = r.s1; s <= r.s2; s++) {
        for (let up = -1; up <= result.shape.height + 2; up++) {
          const p = toWorld(state.origin, state.facing, f, s, up);
          const id = blockAt(elder.dimension, p.x, p.y, p.z);
          if (id && id !== "minecraft:air") solid++;
        }
      }
    }
    assert(solid > 60, `${spec.id}: a real building now stands on the plot (${solid} blocks)`);

    if (spec.jobSite) {
      let found = false;
      for (let f = r.f1; f <= r.f2 && !found; f++) {
        for (let s = r.s1; s <= r.s2 && !found; s++) {
          const p = toWorld(state.origin, state.facing, f, s, 0);
          if (blockAt(elder.dimension, p.x, p.y, p.z) === spec.jobSite) found = true;
        }
      }
      assert(found, `${spec.id}: its job-site block (${spec.jobSite}) is in the building`);
    }
  }
}

// ---------------------------------------------------------------- 4
console.log("\n=== the loop builds one plot at a time and never twice ===");
{
  const player = __test__.makePlayer("LoopTester", { x: 640000, y: 70, z: 640000 });
  const elder = foundVillage(player, { x: 640000, y: 70, z: 640000 }, 0);

  assert(advanceDistricts(elder) === null, "a level-1 village has no district to build yet");

  // Skip the level-ups: this is about what a village of a given level is owed,
  // not about how it got there (integration.mjs already builds all ten levels).
  elder.setDynamicProperty(PROP_LEVEL, 15);

  const built = [];
  for (let pass = 0; pass < ALL_SLOTS.length + 3; pass++) {
    const result = advanceDistricts(elder);
    if (result === null) break;
    if (result.ok) built.push(result.slotId);
  }
  assert(built.length === ALL_SLOTS.length, `every unlocked plot eventually gets built (${built.length}/${ALL_SLOTS.length})`);
  assert(new Set(built).size === built.length, "no plot is ever built twice");
  assert(advanceDistricts(elder) === null, "once the districts are finished the loop goes quiet");

  const progress = districtProgress(elder);
  assert(progress.pending === 0 && progress.built === ALL_SLOTS.length, `progress reports the districts complete (${progress.built}/${progress.unlocked})`);

  const vTag = "village:" + getVillageState(elder).id;
  const residents = elder.dimension.getEntities({ tags: ["village_npc", vTag] })
    .filter((e) => e.getDynamicProperty("village:districtSlot"));
  const expected = ALL_SLOTS.filter((s) => s.resident).length;
  assert(residents.length === expected, `each plot that houses someone got exactly one villager (${residents.length}/${expected})`);
  const names = new Set(residents.map((e) => (e.nameTag || "").replace(/§./g, "")));
  assert(names.size >= 5, `the districts brought in several distinct trades (${[...names].join(", ")})`);
  assert(residents.every((e) => !e.hasTag("village_crafter")),
    "district villagers are residents, not craftsmen - tapping one opens vanilla trading, not an empty quest menu");
}

// ---------------------------------------------------------------- 5
console.log("\n=== a legacy village is left completely alone ===");
{
  const player = __test__.makePlayer("LegacyTester", { x: 670000, y: 70, z: 670000 });
  const elder = foundVillage(player, { x: 670000, y: 70, z: 670000 }, 0);
  elder.setDynamicProperty(PROP_LEVEL, 15);
  // Pre-crossroads saves have no layoutVersion at all.
  elder.setDynamicProperty("village:layoutVersion", undefined);
  assert(advanceDistricts(elder) === null, "districts are a crossroads feature and never touch a legacy village");
  assert(nextPendingSlot(elder, 15) !== null, "…even though at level 15 the plots themselves are unlocked");
}

console.log(failures === 0
  ? `\nALL QUARTERS TESTS PASSED (${checks} checks)`
  : `\n${failures} QUARTERS TEST(S) FAILED out of ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
