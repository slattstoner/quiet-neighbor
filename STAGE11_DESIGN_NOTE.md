# Stage 11 — Design note: runtime activation L19–L20

Base: Stage 10 approved tree, verified at **6 814 `ok:` / 0 failures** before edit.

Scope: activate **L19, L20 only** (`town_hall_deposit_then_build`). No change to
L16–18, no balance/production/craftsman change, no L21+.

---

## 1. Ownership decision — mirrors Stage 10, kept isolated from it

A **new, separate** coordinator `final_runtime_19_20.js`, not an extension of
Stage 10's `extension_runtime_16_18.js`. Reasons:

* Stage 10's isolation tests assert exactly which modules may import
  `extension_runtime_16_18.js` (only `ui.js`). Folding L19–20 into it would force
  editing an already-approved, tested file for a *different* level range —
  against "не трогать без необходимости".
* L19–20 have **no arc** (`arcId: null`) and a **different Phase A** (chest
  deposit, not player-inventory turn-in), so the two coordinators do not share
  a step model; only the *shape* of "decide, then build" repeats.
* `planned_build_transaction.js` already dispatches on `level <= 18` vs `> 18`
  internally, so **no dispatcher change is needed** — L19/20 requests simply
  route to `buildFinal` instead of `buildSpecial` inside the same call.

Not touched: `progression_16_20.js`, `planned_build_transaction.js`,
`special_buildings_16_18.js`, `final_city_19_20.js`, `quest_contract_v2.js`,
`chapter_state.js`, `chapter_journal.js`, `levels.js`, `village.js` (read-only
import of `getVillageState`, `getLayoutVersion`, `refreshSign` — all already
exported), `extension_runtime_16_18.js`, `craftsman_quests.js`, `production.js`,
`npc.js`, `main.js`.

## 2. State keys

| Key | Owner | Written by Stage 11 |
|---|---|---|
| `village:v2:extension:level:<19\|20>:ready` | planner contract, **unset by any prior stage** | **yes** — this is the one key Stage 9/10 deliberately left for a future owner |
| `village:v2:extension:level:<19\|20>:committed` | planner contract | yes, via `plan.statePatch`, same as Stage 10 |
| `village:v2:build:<founders_hall\|village_beacon>` | dispatcher | only via dispatcher |
| `village:level` | `village.js` | yes, only after confirmed build |
| `village:v2:extension:chapter` | Stage 10's key, reused verbatim | yes, best-effort after commit |

No new key is introduced. `village:v2:extension:level:<level>:ready` already
exists in the Stage 9 contract and in `planBuildCommit()`'s `FINAL_LEVELS`
branch; it has simply never had a writer until now.

**Deposit container:** the founders/beacon requirements go into the *same* town
hall chest used by legacy L1–15 (`getVillageState(elder).chest`), not a new
inventory-turn-in. This matches `progressKind: "town_hall_deposit_then_build"`
literally and needs no new UI object (no `barrel`, no second chest).

## 3. Commit order

Two phases, same non-negotiable property as Stage 10: **the build step consumes
no resources**, so a failed physical build can never cost the player anything.

### Phase A — deposit (per level, once)
1. Guard: v2 layout, readable snapshot, prior level committed
   (`priorLevel: 18` for L19, `19` for L20 — enforced by `planBuildCommit`
   itself, not duplicated here).
2. Refuse if `levelReady[level]` is already `true` (idempotent — no double
   consumption of the chest).
3. Read the town hall chest container via `getVillageState(elder).chest`.
4. Compare against `chapter.requirements` (from `extensionProgressionForLevel`).
   Missing → neutral refusal, chest untouched.
5. Snapshot chest → consume exact requirements → on any failure, restore the
   snapshot and return neutral.
6. Write `village:v2:extension:level:<level>:ready = true` directly (this key
   has no planner-side setter; the coordinator is its sole owner by contract).
   On write failure: restore the chest snapshot too, so a failed *state* write
   never leaves consumed items unaccounted for.

### Phase B — build (unchanged shape from Stage 10)
1. Guard, `planBuildCommit()` (rejects unless `levelReady[level] === true`).
2. Dispatcher state 0/1/2 handling — identical logic to Stage 10 (corrupt →
   refuse, `1` → recoverable reset, `2` + uncommitted → repair path).
3. `buildPlannedVillageBuilding(elder, { buildingId, level, paletteId: undefined })`
   — routes to `buildFinal` automatically because `level > 18`.
4. `statePatch` (`committed = true`) **before** `village:level`, same reasoning
   as Stage 10: reversing the order could strand `baseLevel` advanced with
   `committed` still false, which `priorSatisfied()` rejects forever.
5. `village:level = level` (best-effort) → extension chapter (best-effort) →
   `refreshSign()` (best-effort).

## 4. Failure matrix (delta from Stage 10 — new Phase A only; Phase B repeats
Stage 10 §4 rows 13–19 verbatim for L19/L20)

| # | Condition | Result | Chest? | Ready flag? |
|---|---|---|---|---|
| D1 | prior level (18 for L19, 19 for L20) not committed | `extension_prior_level_not_committed` | untouched | untouched |
| D2 | `ready` already true, deposit re-attempted | `extension_level_already_ready` | untouched | untouched |
| D3 | no chest / chest unreadable | `extension_no_chest` | n/a | untouched |
| D4 | chest missing required items | `extension_not_enough` | untouched | untouched |
| D5 | chest contents change mid-commit (drift) | `extension_chest_changed` | **restored** | untouched |
| D6 | `ready` flag write fails after consumption | `extension_state_write_failed` | **restored** | untouched |
| D7 | build attempted before `ready` | `extension_town_hall_requirements_not_ready` (from planner) | untouched | untouched |

## 5. UI

Reuses the same elder-menu slot pattern as Stage 10, but as its **own** menu
entry (`growing_villages.ui.elder.final.*` namespace) so Stage 10's namespace
and tests stay untouched. Shown only when a L19/L20 chapter is active or ready;
never shown alongside or instead of the L16–18 entry — a village sees at most
one special-progression button at a time, matching its actual current level.
No deposit item list beyond the four canonical items per level (already public
in `LEVEL_CHAPTERS`); no discount, no reward screen (`reward.kind === "none"`).

## 6. Test plan (new suite `final_runtime_19_20.mjs`)

preconditions and L18-not-committed refusal · legacy/corrupt-layout refusal ·
deposit under/over/exact requirements · double-deposit idempotency · chest
snapshot restore on drift and on state-write failure · exact dispatcher request
shape for `founders_hall` / `village_beacon` · builder failure · stale queue
retry · already-built retry · corrupt marker refusal · successful commit for
L19 then L20 · full L15→L20 chain reusing Stage 10's L16–18 path · no L21+
leakage · module-isolation guards (this module touches neither
`extension_runtime_16_18.js` nor vice versa).
