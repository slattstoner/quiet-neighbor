# Growing Villages — Stage 11 handoff: runtime-активация L19–L20

**База:** Stage 10 approved tree (уже включает `extension_runtime_16_18.js`).
Ничего из Stage 10 не откачено и не изменено.

**Статус:** L19 (`founders_hall`) и L20 (`village_beacon`) подключены к live
runtime. Полная цепочка L1 → L20 теперь проходима целиком через игровой UI.

---

## 1. Фактический результат тестов

```
suites = 35   BP script modules (node --check) = 32
TOTAL ok = 6883   FAIL = 0
```

Было после Stage 10: **6 814 ok / 0 FAIL**. Прирост **+69** — целиком новый набор
`final_runtime_19_20.mjs`. Ни одно существующее ожидание (включая Stage 10)
не переписано.

Полный лог: `STAGE11_FULL_TEST_LOG.txt` в корне исходника.

> **Ручной тест в Minecraft Bedrock 1.26.44 на iPhone 16 Pro НЕ проводился.**
> Подтверждения владельца нет. Это касается уже двух построек: `founders_hall`
> и `village_beacon`, плюс полной цепочки L1→L20 целиком.

## 2. Изменённые/новые пути (10)

| Путь | Тип | Что сделано |
|---|---|---|
| `GrowingVillages_BP/scripts/final_runtime_19_20.js` | **новый** | Координатор L19–20: deposit-фаза + build-фаза |
| `GrowingVillages_BP/scripts/ui.js` | изменён | Вторая условная кнопка старосты (взаимоисключающая с L16–18) + подменю |
| `GrowingVillages_RP/texts/ru_RU.lang` | изменён | +16 ключей, namespace `growing_villages.ui.elder.final.*` |
| `GrowingVillages_RP/texts/en_US.lang` | изменён | те же +16 ключей |
| `tests/final_runtime_19_20.mjs` | **новый** | 69 проверок |
| `tests/scripts/*` | синхронизировано | зеркало `GrowingVillages_BP/scripts` |
| `STAGE11_DESIGN_NOTE.md` | новый | design note: state keys, порядок commit, failure matrix |
| `STAGE11_FULL_TEST_LOG.txt` | новый | полный лог |
| `STAGE11_HANDOFF_RU.md` | новый | этот файл |

**Не тронуты (в т.ч. Stage 10):** `extension_runtime_16_18.js`,
`progression_16_20.js`, `planned_build_transaction.js`,
`special_buildings_16_18.js`, `final_city_19_20.js`, `quest_contract_v2.js`,
`levels.js`, `village.js`, `chapter_state.js`, `chapter_journal.js`,
`craftsman_quests.js`, `production.js`, `npc.js`, `main.js`.

## 3. Архитектурное решение

**Новый, отдельный** координатор `final_runtime_19_20.js` — не расширение
Stage 10. Причины:

* Изоляционные тесты Stage 10 фиксируют, какие модули имеют право
  импортировать `extension_runtime_16_18.js` (только `ui.js`). Расширять его
  под другой диапазон уровней значило бы трогать уже принятый файл без
  необходимости.
* У L19–20 нет арки (`arcId: null`), другая Фаза A (депозит в сундук ратуши,
  а не сдача предметов игроком старосте лично) — модели шага не совпадают.
* `planned_build_transaction.js` уже маршрутизирует `level <= 18` → builder
  особых глав, `level > 18` → final-city builder **внутри одного вызова** —
  dispatcher менять не пришлось вовсе.

Новый тест явно проверяет, что `final_runtime_19_20.js` не импортирует
`extension_runtime_16_18.js` и наоборот.

## 4. State keys

Ни один новый ключ не введён. Единственный ключ, который Stage 9/10
сознательно оставили без автора — `village:v2:extension:level:<19|20>:ready» —
теперь получил единственного владельца: координатор Stage 11.

| Ключ | Пишет ли Stage 11 |
|---|---|
| `village:v2:extension:level:<19\|20>:ready` | **да** (впервые) |
| `village:v2:extension:level:<19\|20>:committed` | да, через `plan.statePatch`, как в Stage 10 |
| `village:v2:build:<founders_hall\|village_beacon>` | только через dispatcher |
| `village:level` | да, только после подтверждённого build |
| `village:v2:extension:chapter` | переиспользуется ключ Stage 10 |

**Место депозита:** тот же сундук ратуши, что и для legacy L1–15
(`getVillageState(elder).chest`) — не новый инвентарь. Это буквально
соответствует `progressKind: "town_hall_deposit_then_build"`.

## 5. Порядок commit

Тот же принцип, что и в Stage 10: **build не тратит ничего**, поэтому
провалившийся физический build не может стоить игроку ресурсов.

* **Фаза A (депозит):** guard → отказ, если L18 не committed → отказ, если
  `ready` уже true (идемпотентность) → чтение сундука → сверка с
  `chapter.requirements` → снятие ровно нужного → запись `ready = true`.
  Любой сбой на любом шаге — полный откат сундука, инвентарь/уровень не тронуты.
* **Фаза B (build):** идентична Stage 10 — guard → `planBuildCommit()`
  (отклоняет, если `ready` не true) → обработка dispatcher state 0/1/2
  (corrupt/queued/repair) → `buildPlannedVillageBuilding()` → `statePatch`
  (committed) **до** `village:level` → `village:level` → chapter → знак.

## 6. UI

Вторая условная кнопка старосты, `growing_villages.ui.elder.final.*`,
**взаимоисключающая** с кнопкой Stage 10: секвенциальность уровней гарантирует,
что деревня не может одновременно быть «в процессе L16–18» и «в процессе
L19–20» — тест это явно проверяет. Экран депозита показывает ровно 4
канонических предмета из `LEVEL_CHAPTERS`; наград нет (`reward.kind: "none"`).

## 7. Покрытие нового набора (69 проверок)

Предусловия (L18 не committed, legacy/corrupt-layout) · депозит: нехватка,
точная сумма, повторный депозит (идемпотентность), откат сундука при сбое
записи ready-флага · build: отказ до готовности, точная форма request для
обоих зданий, падение builder-а, залипшая очередь, already-built retry,
corrupt marker · полная цепочка L19→L20 · инертность L21+ · маршрутизация UI
(взаимоисключающая кнопка, депозит не меняет уровень) · границы владения
модулей (в т.ч. что координаторы Stage 10/11 не импортируют друг друга).

## 8. Полный regression

Та же процедура, что в §7 базового handoff и §8 Stage 10, плюс
`final_runtime_19_20` в конце списка:

```bash
cd tests
rm -rf scripts
cp -r ../GrowingVillages_BP/scripts ./scripts
for f in lint run integration geometry roof fixes features polish orientation round2 \
         specials bells quest_upgrades crossroads spatial_plan city_11_15 defences_roads \
         economy_contract quest_contract_v2 chapter_state quest_availability progression_guard \
         chapter_journal localization_chapters craftsman_quests craftsman_quest_ui \
         localization_quests city_progression_11_15 special_buildings_16_18 final_city_19_20 \
         special_arcs_16_18 planned_build_transaction progression_16_20 extension_runtime_16_18 \
         final_runtime_19_20; do
  node "$f.mjs" || exit 1
done
for f in ../GrowingVillages_BP/scripts/*.js; do node --check "$f" || exit 1; done
```

## 9. Итог по бета-версии

Мод-контент L1–L20 полностью реализован и подключён к runtime. Из
непереговорных инвариантов handoff'а ничего не нарушено: только ванильные
блоки, производство/баланс не менялись, алмазы/незерит не производятся,
других биомов/караванов/репутации/уровней выше 20 не добавлено.

## 10. Что осталось перед релизом

1. **Ручной smoke test на iPhone 16 Pro — обязателен.** Особенно: геометрия и
   крыши `founders_hall`/`village_beacon` на всех `facing`, депозит через
   реальный сундук ратуши (не мок), полная цепочка L15→L20 вживую, отсутствие
   визуальных коллизий между L16–18 и L19–20 объектами на одной площадке.
2. Решение владельца по `chapter_journal.js` — сейчас он показывает
   safe-fallback выше L10 (поведение не менялось ни в Stage 10, ни в Stage 11).
3. Финальный релизный проход: version bump, RELEASE_NOTES, финальный combined
   regression перед тегированием approved-версии.
