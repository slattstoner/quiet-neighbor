# Growing Villages — Stage 10 handoff: runtime-активация L16–L18

**База:** `GrowingVillages_Source_0.5.0_beta_fixed_stage9_combined_approved.zip`,
SHA-256 `c890774984ba8e6e0b3fa23443aebd81d4ded6fca6e2a458655f77c32d8bd9b4` (сверено).
Исторические patch из transfer-архива повторно **не накладывались**.

**Статус:** L16, L17, L18 подключены к live runtime. L19 и L20 остаются planned
data и намеренно не активированы.

---

## 1. Фактический результат тестов

Полный локальный regression по процедуре §7 базового handoff, плюс новый набор:

```
suites = 34   BP script modules (node --check) = 31
TOTAL ok = 6814   FAIL = 0
```

Было до изменений (эта же база, эта же машина): **6 705 ok / 0 FAIL**.
Прирост **+109** — целиком новый набор `extension_runtime_16_18.mjs`.
Ни одно существующее ожидание не переписано и не ослаблено.

Полный лог: `STAGE10_FULL_TEST_LOG.txt` в корне исходника.

> **Ручной тест в Minecraft Bedrock 1.26.44 на iPhone 16 Pro НЕ проводился.**
> Подтверждения владельца нет. Автотесты его не заменяют — особенно по
> геометрии, крышам и ориентации трёх новых физических построек в игре.

## 2. Изменённые пути (8)

| Путь | Тип | Что сделано |
|---|---|---|
| `GrowingVillages_BP/scripts/extension_runtime_16_18.js` | **новый** | Координатор L16–18: единственный модуль, соединяющий planner и dispatcher |
| `GrowingVillages_BP/scripts/ui.js` | изменён | Одна условная кнопка старосты + подменю особых глав |
| `GrowingVillages_RP/texts/ru_RU.lang` | изменён | +19 ключей в новом namespace `growing_villages.ui.elder.special.*` |
| `GrowingVillages_RP/texts/en_US.lang` | изменён | те же +19 ключей (паритет RU/EN сохранён) |
| `tests/extension_runtime_16_18.mjs` | **новый** | 109 проверок |
| `tests/scripts/extension_runtime_16_18.js` | новый | синхронизированная копия BP scripts |
| `tests/scripts/ui.js` | изменён | синхронизированная копия BP scripts |
| `STAGE10_DESIGN_NOTE.md` | новый | design note: state keys, порядок commit, failure matrix |

**Не тронуты:** `progression_16_20.js`, `planned_build_transaction.js`,
`special_buildings_16_18.js`, `final_city_19_20.js`, `quest_contract_v2.js`,
`levels.js`, `village.js`, `chapter_state.js`, `chapter_journal.js`,
`craftsman_quests.js`, `production.js`, `npc.js`, `main.js`, `walls.js`,
`defences_roads.js`, `city_buildings_11_15.js`, `city_connectors.js`,
`spatial_plan.js`, `builder.js`, `terrain.js`.

## 3. Архитектурное решение

Stage 9 оставил две изолированные половины, и существующие тесты **жёстко
запрещают** импорт любой из них в `main.js`, `village.js`, `levels.js`, `ui.js`,
`chapter_state.js`, `chapter_journal.js`. Это архитектурный контракт, а не
случайность. Поэтому Stage 10 добавляет **один новый координатор**:

```
ui.js  →  extension_runtime_16_18.js  →  progression_16_20.js   (чистое решение)
                                     →  planned_build_transaction.js (физика)
                                     →  village.js  (layout-гейт, refreshSign)
```

`ui.js` по-прежнему не видит ни planner, ни dispatcher. Бизнес-правила не попали
ни в builders, ни в чистый planner.

### Что сознательно НЕ менялось и почему

* **`runtimeStatus: "planned"` в `quest_contract_v2.js`** — этого требует
  `validateExtensionContract()` и три существующих набора тестов.
  `runtimeStatus` описывает *контракт данных*, а не runtime-гейт. Активация
  выражена allow-list `[16, 17, 18]` в координаторе. Фикстуры не переписаны.
* **`RUNTIME_CHAPTER_MAX_LEVEL = 10` в `chapter_state.js`** — зафиксировано
  `progression_guard.mjs`. Повторён прецедент L11–15: legacy-владелец главы
  остаётся нетронутым, а расширенная глава живёт в собственном ключе.
* **`MAX_LAYOUT_V2_LEVEL = 15` в `levels.js`** — в `LEVELS` нет строк 16–18,
  поэтому путь сундука ратуши для L16+ **уже инертен** сам по себе. Поднятие
  предела сломало бы `foundVillageAtLevel` на `LEVELS[16] === undefined`.
  L16–18 идут только через меню особых глав.
* **Баланс, производство, награды ремесленников, требования L19/L20** — 0 правок.

## 4. State keys

| Ключ | Владелец | Пишет ли Stage 10 |
|---|---|---|
| `village:layoutVersion` | `village.js` | нет (только чтение, обязателен `2`) |
| `village:level` | `village.js` | **да**, только после подтверждённого build |
| `village:v2:build:<buildingId>` | dispatcher | только через dispatcher, напрямую никогда |
| `village:v2:extension:arc:<arcId>:step` | planner-контракт | да, через `plan.statePatch` |
| `village:v2:extension:arc:<arcId>:ready` | planner-контракт | да, через `plan.statePatch` |
| `village:v2:extension:level:<level>:ready` | planner-контракт | **никогда** (депозит L19/20) |
| `village:v2:extension:level:<level>:committed` | planner-контракт | да, через `plan.statePatch` |
| `village:v2:extension:chapter` | **новый, координатор** | да, best-effort после commit |

Новый ключ имеет один сегмент после префикса, `stateKey()` planner-а всегда
выдаёт три — пересечение невозможно. `quest_step`, `village:discount:*`,
`village:tier`, `village:golemsSpawned`, `village:v2:chapter*` не тронуты.

## 5. Порядок commit

Сознательное разделение на две фазы:

* **Фаза A — шаги арки 1..3.** Сдача предметов из инвентаря игрока старосте.
  Тратит предметы, двигает `:step`, на третьем шаге ставит `:ready`.
  Ни постройки, ни уровня, ни главы.
* **Фаза B — commit постройки.** Не тратит **ничего**. Запускает dispatcher и
  только после подтверждённой постройки пишет committed → level → chapter → знак.

Именно это делает инвариант буквально истинным: провалившийся физический build
не может съесть ресурсы, потому что у самого build нет ресурсной цены. Провал
оставляет `:ready = true`, игрок просто повторяет попытку.

**Внутри фазы B:** guard → `planBuildCommit()` → чтение физического state
(corrupt → отказ; `1` → dispatcher сбрасывает залипшую очередь, попытка
отклоняется как recoverable; `2` → repair-путь) → `buildPlannedVillageBuilding()`
→ `statePatch` (committed) → `village:level` → chapter → `refreshSign()`.

Флаг committed пишется **до** уровня намеренно: обратный порядок мог бы оставить
`baseLevel = 16` при `committed = false`, что `priorSatisfied()` отвергает
навсегда. Repair-путь (`2` + не committed) достраивает commit **без повторного
строительства** — это единственный способ, которым такое состояние может
возникнуть, потому что dispatcher для 16–18 запускает только координатор.

Полная failure matrix на 21 строку — в `STAGE10_DESIGN_NOTE.md` §4.

## 6. UI

Одна условная кнопка в меню старосты, видимая только при
`extensionMenuAvailable(elder) === true` (layout v2 + активная или готовая
глава L16–18). Меню L19/L20 не показывает никогда, экрана депозита не имеет.
Новая локализация — в отдельном namespace `growing_villages.ui.elder.special.*`,
вне scope и хроники, и ремесленных квестов, поэтому ни одно существующее
локализационное ожидание не изменилось.

## 7. Покрытие нового набора (109 проверок)

Предусловия и отказ legacy / keyless / corrupt-layout · отказ L1–15 вне
предикатов · шаги 1–3 по порядку · отказ вне порядка и повторного шага ·
точная форма request `{buildingId, level, paletteId: undefined}` · падение
builder-а · connector_failed · залипшая очередь и retry · already-built retry ·
corrupt build marker · неизменность inventory / level / chapter при **каждом**
отказе · откат инвентаря при провале записи state · успешный commit ·
отсутствие дубля постройки · полная последовательность L16→L17→L18 ·
инертность L19/L20 · границы владения модулей · маршрутизация UI.

## 8. Полный regression

```bash
cd tests
rm -rf scripts
cp -r ../GrowingVillages_BP/scripts ./scripts
for f in lint run integration geometry roof fixes features polish orientation round2 \
         specials bells quest_upgrades crossroads spatial_plan city_11_15 defences_roads \
         economy_contract quest_contract_v2 chapter_state quest_availability progression_guard \
         chapter_journal localization_chapters craftsman_quests craftsman_quest_ui \
         localization_quests city_progression_11_15 special_buildings_16_18 final_city_19_20 \
         special_arcs_16_18 planned_build_transaction progression_16_20 extension_runtime_16_18; do
  node "$f.mjs" || exit 1
done
for f in ../GrowingVillages_BP/scripts/*.js; do node --check "$f" || exit 1; done
```

Единственное отличие от §7 базового handoff — добавленный в конец списка
`extension_runtime_16_18`.

## 9. Что осталось для Stage 11

1. **Ручной smoke test на iPhone 16 Pro** — обязателен перед приёмкой Stage 10.
   Проверить: геометрия и крыши трёх построек при всех четырёх `facing`,
   двухблочный коннектор до дороги, отсутствие сноса существующих домов,
   поведение меню старосты на L15 → L18.
2. Решение владельца: должен ли `chapter_journal` показывать главы 11–20
   (сейчас он даёт safe-fallback выше L10 — поведение, существовавшее до
   Stage 10 и не менявшееся здесь).
3. Отдельным этапом — активация L19–L20 (`town_hall_deposit_then_build`,
   ключ `village:v2:extension:level:<level>:ready`, который Stage 10 не трогает).
