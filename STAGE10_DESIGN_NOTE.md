# Stage 10 — Design note: runtime activation L16–L18 only

Base: `GrowingVillages_Source_0.5.0_beta_fixed_stage9_combined_approved.zip`
(SHA-256 `c890774984ba8e6e0b3fa23443aebd81d4ded6fca6e2a458655f77c32d8bd9b4`), verified
locally at **6 705 `ok:` checks / 0 failures** before any edit.

Scope: activate **L16, L17, L18 only**. L19–L20 stay planned data. No production,
balance, craftsman-reward, biome, caravan or reputation change.

---

## 1. Chosen ownership decision

Stage 9 deliberately left two isolated halves:

* `progression_16_20.js` — **pure planner**, no world access, owns the *decision*.
* `planned_build_transaction.js` — **physical dispatcher**, owns only
  `village:v2:build:<buildingId>` = 0/1/2.

The existing Stage 9 tests hard-assert that `main.js`, `village.js`, `levels.js`,
`ui.js`, `chapter_state.js`, `chapter_journal.js` import **neither** of those
modules. Those assertions are the architecture contract, not incidental. Therefore
Stage 10 does **not** move business rules into any of those owners.

**Decision: a single new coordinator module** `extension_runtime_16_18.js`.
It is the only module allowed to import both halves. `ui.js` only calls the
coordinator's four exported functions; it never sees planner or dispatcher.

Modules NOT touched: `progression_16_20.js`, `planned_build_transaction.js`,
`special_buildings_16_18.js`, `final_city_19_20.js`, `quest_contract_v2.js`,
`chapter_state.js`, `chapter_journal.js`, `levels.js`, `village.js`,
`craftsman_quests.js`, `production.js`, `npc.js`, `main.js`.

### 1.1 Why `runtimeStatus` stays `"planned"`

`validateExtensionContract()` *requires* `chapter.runtimeStatus === "planned"` and
three separate suites assert it. `runtimeStatus` describes the **data contract**,
not the runtime gate. Activation is expressed by the coordinator's allow-list
`[16, 17, 18]`, so no data file changes and no test fixture is rewritten.

### 1.2 Why `chapter_state.js` is not extended

`RUNTIME_CHAPTER_MAX_LEVEL = 10` is asserted by `progression_guard.mjs`, and the
established L11–15 precedent in `tryCityLevelUp` is: call it, accept the neutral
refusal, record `chapterId = null`. Stage 10 follows the same precedent and stores
the extension chapter in its own key instead of widening the legacy owner.

### 1.3 Why `levels.js` / `MAX_LAYOUT_V2_LEVEL` are not changed

`LEVELS` has no 16–18 rows, so `chestSatisfiesRequirements()` at L15 already returns
`{done:true, finished:true}` and the town-hall chest path is **naturally inert** for
L16+. Raising the cap would make `foundVillageAtLevel` walk into `LEVELS[16] ===
undefined`. L16–18 are routed entirely through the elder's special-chapter menu.

---

## 2. State keys

| Key | Type | Owner | Written by Stage 10 |
|---|---|---|---|
| `village:layoutVersion` | int | `village.js` | never (read-only gate, must be `2`) |
| `village:level` | int | `village.js` | **yes**, only after a confirmed build |
| `village:v2:build:<buildingId>` | 0/1/2 | `planned_build_transaction.js` | never directly; only via the dispatcher |
| `village:v2:extension:arc:<arcId>:step` | 0..3 | planner contract | yes, via `plan.statePatch` |
| `village:v2:extension:arc:<arcId>:ready` | bool | planner contract | yes, via `plan.statePatch` |
| `village:v2:extension:level:<level>:ready` | bool | planner contract | **never** (L19/20 deposit flag) |
| `village:v2:extension:level:<level>:committed` | bool | planner contract | yes, via `plan.statePatch` |
| `village:v2:extension:chapter` | string | **new, coordinator** | yes, best-effort after commit |

`village:v2:extension:chapter` is a flat 1-segment suffix; the planner's
`stateKey()` always emits 3 segments, so the namespaces cannot collide.

Untouched: `quest_step`, `village:discount:*`, `village:tier`,
`village:golemsSpawned`, `village:v2:chapter*`, all production keys.

---

## 3. Progression model

`memorial_grove` (16), `village_infirmary` (17), `civic_workshop` (18) are
`special_arc_complete_then_build`, three steps each, `once_per_village`.

Deliberate **two-phase** split:

* **Phase A — arc steps 1..3.** Player inventory turn-in to the elder. Consumes
  items, advances `:step`, sets `:ready` on step 3. No build, no level, no chapter.
* **Phase B — build commit.** Consumes **nothing**. Runs the dispatcher, then and
  only then writes `committed`, `village:level`, extension chapter, sign.

This is what makes the non-negotiable invariant literally true: a failed physical
build cannot consume resources, because the build transaction has no resource cost
at all. A failed build leaves `:ready = true`, so the player simply retries.

### Ordering inside Phase A
1. Guard (elder usable → layout v2 → readable, valid planner snapshot).
2. `planSpecialArcAdvance()` — reject before any mutation.
3. Verify **all** step requirements present in player inventory.
4. Snapshot inventory → remove items.
5. Apply `plan.statePatch` (with per-key rollback).
6. On any failure in 4–5: restore inventory and state keys, return neutral.

### Ordering inside Phase B
1. Guard.
2. `planBuildCommit()` — reject before any mutation.
3. Read `getPlannedBuildState()`. `corrupt` → refuse. `1` → let the dispatcher
   reset the stale queue, refuse this attempt (recoverable). `2` → repair path.
4. `buildPlannedVillageBuilding(elder, { buildingId, level, paletteId: undefined })`.
5. `plan.statePatch` (`committed = true`) — **before** `village:level`.
6. `village:level = level` (best-effort).
7. `village:v2:extension:chapter` (best-effort).
8. `refreshSign()` (best-effort).

Step 5 before step 6 is deliberate. If the process dies between them, the level is
stale but `committed` is true, so L17's precondition (`levelCommitted[16]`) still
holds and progression is not dead-ended. The reverse order would leave
`baseLevel = 16` with `committed = false`, which `priorSatisfied()` rejects forever.

### Repair path (dispatcher `2`, planner not committed)
Only the coordinator can drive the dispatcher for 16–18, and only after
`planBuildCommit()` passes. So `2 + uncommitted` can only mean an interrupted
commit. The coordinator finishes the commit **without rebuilding** and reports
`repaired: true`. This prevents both a duplicate building and a permanent dead end.

---

## 4. Failure matrix

| # | Condition | Result code | Build? | Items? | Level/chapter? | Recovery |
|---|---|---|---|---|---|---|
| 1 | elder missing / no dynamic-property API | `extension_invalid_elder` | no | no | no | none needed |
| 2 | legacy or corrupt `layoutVersion` | `extension_layout_unsupported` | no | no | no | permanently inert |
| 3 | planner snapshot unreadable / invalid | `extension_state_invalid` | no | no | no | neutral, no repair guess |
| 4 | village below L15 or prior level uncommitted | `extension_prior_level_not_committed` | no | no | no | finish previous level |
| 5 | step out of order / duplicate press | `extension_step_out_of_order` | no | no | no | reopen menu |
| 6 | arc already ready, step retried | `extension_arc_already_ready` | no | no | no | use build action |
| 7 | player inventory unavailable | `extension_no_inventory` | no | no | no | retry |
| 8 | missing step items | `extension_not_enough` | no | no | no | retry |
| 9 | inventory changed mid-commit | `extension_inventory_changed` | no | **restored** | no | retry |
| 10 | state write fails after item removal | `extension_state_write_failed` | no | **restored** | no | retry |
| 11 | stale `stepId` from an old form | `extension_stale_state` | no | no | no | reopen menu |
| 12 | arc not complete at build time | `extension_special_arc_not_ready` | no | no | no | finish arc |
| 13 | dispatcher state corrupt (not 0/1/2) | `extension_build_state_corrupt` | no | no | no | manual/owner decision |
| 14 | dispatcher state `1` (stale queue) | `queued_build_recovered` | reset to 0 | no | no | press build again |
| 15 | builder throws / shape mismatch | `planned_build_failed` / `canonical_shape_mismatch` | reset to 0 | no | no | retry |
| 16 | connector too narrow / missing | `connector_failed` | reset to 0 | no | no | retry |
| 17 | invalid village context (origin/facing) | `invalid_village_context` | no | no | no | neutral |
| 18 | `statePatch` fails after a successful build | `extension_commit_failed` | stays `2` | no | no | retry → repair path |
| 19 | `village:level` write fails after commit | ok, `levelWritten: false` | done | no | committed only | next level still unblocked |
| 20 | build pressed twice after success | `extension_level_already_committed` | no | no | no | idempotent |
| 21 | L19/L20 requested | `extension_level_not_active` | no | no | no | out of Stage 10 scope |

---

## 5. UI surface

`ui.js` gains one conditional elder button, shown **only** when
`extensionMenuAvailable(elder)` is true (v2 layout, an active or ready L16–18
chapter). It never renders L19/L20, never exposes a deposit screen, and never
imports planner or dispatcher. New localisation lives in the fresh
`growing_villages.ui.elder.special.*` namespace, which is outside both the
chronicle scope and the craftsman/quest scope asserted by existing suites, so no
existing localisation expectation changes.

---

## 6. Test plan (new suite `extension_runtime_16_18.mjs`)

preconditions and legacy/keyless/corrupt-layout refusal · L1–15 refusal ·
steps 1–3 in order · out-of-order and duplicate step refusal · exact request shape
`{buildingId, level, paletteId: undefined}` · builder failure ·
stale queued-state retry · already-built retry · inventory / level / chapter
non-mutation on every failure · success commit · no duplicate build ·
L19/L20 stay inert · module-isolation guards.
