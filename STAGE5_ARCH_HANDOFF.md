READY FOR INTEGRATION

# STAGE5_ARCH_HANDOFF — runtime L11–15 для versioned city layout

**Этап:** 5 — первый runtime integration change set архитектуры  
**Дата:** 26 августа 2026 года  
**Базовый архив:** `GrowingVillages_Source_0.5.0_beta_fixed_stage4_combined_approved.zip`  
**Проверенный SHA-256 baseline:** `9b90881f9e6384798dd7780b4bd9ca936a586ff1dba4a41fb5b2ef69a079aca7`  
**Статус:** новые деревни layout v2 реально проходят L1–15; existing/keyless и malformed layouts безопасно не переходят за L10.

> Этап не мигрирует старые деревни, не запускает `buildDefenceStage()`, не подключает L16–20 и не меняет chapter/UI, economy, quests, production, NPC economy, localisation или special content. Экономическая ветка владеет расширением chapter/UI и должна быть объединена отдельно.

## 1. Changed paths

| Path | Изменение | Назначение |
|---|---|---|
| `GrowingVillages_BP/scripts/levels.js` | L11–15, canonical `cityBuildingId`, layout-aware max-level helper. | Routing approved city builders без координатного дубляжа. |
| `GrowingVillages_BP/scripts/village.js` | `layoutVersion`, city build-state transaction, city runtime routing, dynamic sign/text cap. | Безопасная progression v2 и legacy block. |
| `GrowingVillages_BP/scripts/city_connectors.js` | **Новый** narrow connector module. | Строит только 2-wide approach из city metadata до края canonical road band. |
| `tests/scripts/levels.js`, `tests/scripts/village.js`, `tests/scripts/city_connectors.js` | Синхронизированные BP copies. | Test harness использует реальный runtime code. |
| `tests/city_progression_11_15.mjs` | **Новый** 60-check executable integration suite. | V2/legacy/invalid layout, L1→15, rollback, state recovery и spatial connector proof. |
| `tests/progression_guard.mjs` | Обновлён versioned runtime contract. | Проверяет static legacy cap 10 и v2 runtime cap 15 одновременно. |
| `tests/chapter_state.mjs`, `tests/run.mjs`, `tests/integration.mjs` | Scope-correct regression cases. | L1–10 chapter/house assertions сохранены; v2 L11–15 проверяются новым suite. |

Неизменность запрещённых владельцев подтверждена SHA-256 сравнением с combined baseline: `chapter_state.js`, `chapter_journal.js`, `quest_contract_v2.js`, `quests.js`, `ui.js`, `production.js`, `npc.js`, `dialogue.js`, `special_content.js`, `defences_roads.js`, `walls.js`, `terrain.js`, `main.js`.

## 2. Versioned layout policy

| Сценарий | Runtime result |
|---|---|
| Новое основание через `foundVillage()` | После создания core elder state один раз записывается `village:layoutVersion = 2`. Повторная foundation-path запись при существующем ключе отказана и логируется. |
| Existing elder без ключа | `getLayoutVersion()` возвращает legacy v1. L1–10 сохраняют legacy path; на L10 попытка следующего шага возвращает `legacy_layout_max` без списания requirements. |
| Corrupted/unknown key | `layoutPolicy()` логирует diagnostic и возвращает `invalid_layout_version`; city builder не вызывается, уровень/сундук не меняются. |
| V2 elder | `maxLevelForLayoutVersion(2) = 15`; L11–15 разрешены только после обычной chest validation. |
| Static UI/chapter cap | `MAX_BETA_LEVEL=10` остаётся контрактом пока не merged экономический chapter/UI change set. `MAX_LAYOUT_V2_LEVEL=15` используется только layout-aware village runtime, sign и effective requirements. |

`MAX_BETA_LEVEL` намеренно не поднят в этом change set: комбинированный baseline содержит owner-owned `chapter_state.js` с `RUNTIME_CHAPTER_MAX_LEVEL=10`, `chapter_journal.js` и localisation tests, которые ещё корректно показывают L10 terminal UI. Однако `village.js` после успешного L11–15 по-прежнему вызывает `setVillageChapterForLevel(elder, nextLevel)`. До параллельного merge ответ нейтрален; после merge чистый owner module увидит уже записанный village level без изменения архитектурного pipeline.

## 3. Реальная progression L11–15

| Level | `buildingId` | Runtime call | Requirements | Логика стоимости |
|---:|---|---|---|---|
| 11 | `market_square` | `buildCityBuilding("market_square", …)` | 192 cobblestone; 64 oak planks; 12 lanterns | Общественная каменная площадь; 268 обычных ванильных единиц — выше L10 по mixed civic effort. |
| 12 | `granary_yard` | `buildCityBuilding("granary_yard", …)` | 96 wheat; 64 oak logs; 8 barrels | Фермерский запас, древесина и переработанная тара; без auto-production или income. |
| 13 | `travellers_inn` | `buildCityBuilding("travellers_inn", …)` | 96 oak planks; 24 glass panes; 20 iron ingots | Гостевой дом требует дерева, стекла и доступного раннего железа; караваны не включаются. |
| 14 | `guard_barracks` | `buildCityBuilding("guard_barracks", …)` | 224 stone bricks; 24 iron ingots; 16 lanterns | Самый тяжёлый civic/security step, сравнимый с L10 castle investment; нет бесконечной экипировки. |
| 15 | `village_archive` | `buildCityBuilding("village_archive", …)` | 48 paper; 16 bookshelves; 64 dark oak planks | Поздний культурный проект из крафтовых ванильных материалов; special buildings не создаются. |

L8 требует 128 cobblestone, 32 stone bricks и 16 torches, а L10 — 160 stone bricks, 16 iron ingots и 8 lanterns. L11–15 сохраняют этот порядок величины: 3 простых survival-ресурса, без diamond, netherite, enchanted gear, нестабильных block states или недоступной добычи. Рост не обязан быть линейным по сумме stack counts: тематические L12/L15 используют renewable harvest/wood/books, L14 — deliberate peak town-security cost.

## 4. Runtime pipeline, transaction и recovery

### 4.1 Нормальный v2 city level

1. `chestSatisfiesRequirements()` проверяет следующий LEVELS record, layout policy и полный town-hall inventory. Для legacy/invalid layout builder не запускается.
2. `tryCityLevelUp()` пишет `village:v2:build:<buildingId>=1` как guard против двойного запуска.
3. Вызывается `runLevelBuild()` → canonical `buildCityBuilding()`. Builder ограничен собственным `SPATIAL_PLAN` envelope.
4. Вызывается `buildCityConnector()` только на metadata `approach.bounds`: 2-wide corridor без padding, от `entryPath` до смежной центральной 3-wide road band. Final crossroad, R94 roads, full-city clear pass и defence runtime не вызываются.
5. Лишь после успешных builder и connector requirements списываются тем же inventory container в single-threaded level action.
6. Записывается `village:level`, затем build state `2`, после чего сохраняется существующая точка `setVillageChapterForLevel(elder, nextLevel)` и обновляется sign.

### 4.2 Stable build flags

| Значение | Значение и реакция |
|---:|---|
| `0`/missing | Объект не начинался; после обычной validation можно строить. |
| `1` | In-flight guard. Любое синхронное builder/connector исключение ловится, флаг сбрасывается в `0`, требования и level остаются прежними. При обнаружении stale `1` следующий action сбрасывает его в `0` без списания и возвращает `city_build_recovered`; повторный action безопасно начинает заново. |
| `2` | Успешно построено/committed. Если такой flag несовместим с текущим уровнем, pipeline возвращает `city_build_state_mismatch` и не пытается угадать или строить второй объект. |

Mock failure injection доказывает builder error: state остаётся L10, inventory не изменяется, temporary flag возвращается в `0`. Connector metadata не проходит preflight, если ширина менее двух, axis отсутствует, bounds malformed или corridor не касается/не смежен с canonical road band.

## 5. Spatial и gameplay boundaries

| Ограничение | Доказательство |
|---|---|
| City envelope | `runLevelBuild()` вызывает approved detached builders; новый test сравнивает `result.shape.bounds` с canonical `SPATIAL_PLAN` для всех L11–15. |
| Connector | `city_connectors.js` использует только `metadata.approach.bounds`, `padding:0`, clear height 5 и fill depth 4. Connector не пересекает `ROAD_AXES` band. |
| No full terrain pass | Source guard для connector-а запрещает `prepareFortifiedArea` и full-square literal; city builder retains its narrow exact-envelope preparation. |
| No defences | `village.js` и connector не импортируют/не вызывают `buildDefenceStage()`. Existing `defences_roads.js` байтово неизменён. |
| NPC/economy | City cfg имеют `npc:null`; city path early-returns до legacy resident/craftsman branch. Нет NPC spawn, production changes, trade, reward или new service. |
| Legacy | L1–10 uses existing build/terrain/fortification calls. Legacy L10 returns neutral `legacy_layout_max` with items intact. |

## 6. Tests

Финальный run синхронизировал `GrowingVillages_BP/scripts` в `tests/scripts`, выполнил все 25 combined executable suites с явной проверкой каждого exit code и `node --check` для 25 BP scripts.

| Проверка | Результат |
|---|---|
| Combined suites | **25/25 exit-code PASS**. |
| Existing architectural suites | `spatial_plan` — 1751 checks; `city_11_15` — 1093 checks; `defences_roads` — 1554 checks. |
| New city runtime suite | **`ALL CITY PROGRESSION 11–15 TESTS PASSED (60 checks)`**. |
| Static legacy/chapter/UI suites | `chapter_state`, `chapter_journal`, `localization_chapters`, `economy_contract`, quest suites и legacy L1–10 integration остаются зелёными. |
| Syntax | **25/25** BP `.js` files прошли `node --check`. |
| Script mirror | `diff -qr GrowingVillages_BP/scripts tests/scripts` → PASS. |
| Forbidden-owner hashes | `stage5_prohibited_owner_modules_unchanged=PASS`. |
| Final marker | `STAGE5_REGRESSION_STATUS=PASS`. |

Новый `city_progression_11_15.mjs` действительно создаёт v2, keyless legacy и corrupted-layout villages в mock environment. Он проходит v2 L1→15, проверяет пять canonical `buildingId`, state=2 после success, connector bounds, terminal no-duplicate action, injected builder exception, stale-queued recovery и preserved chapter hook source contract.

## 7. Patch verification

`STAGE5_ARCH_CITY_RUNTIME.patch` содержит 11 files, 1181 lines, SHA-256 `cb48aea8f4df1c7ee6f342c8695411cd118de898a7940d9da6f0010113e68d58`.

Patch выполнен от корня свежей распаковки exactly указанного combined baseline. Он успешно прошёл `patch -p1 --dry-run`, применился с `patch -p1`, после scripts sync воспроизвёл:

```text
ALL CITY PROGRESSION 11–15 TESTS PASSED (60 checks)
stage5_patch_verify=PASS
```

## 8. Remaining risks и required merge order

| Риск/граница | Required follow-up |
|---|---|
| Chapter/UI отображают terminal L10 до owner merge | Сначала объединить параллельный Stage 5 economy/UI change set, который поднимет chapter runtime contract до L15. Не редактировать эти owner files вручную в архитектурной ветке. |
| Server interruption exactly посреди физической builder write | Синхронные исключения уже reset `1→0`; на реальном iOS необходим manual smoke check после force-close/reload перед публичным release. Не существует безопасного generic world-block rollback для частично выполненной Bedrock write без отдельного migration/reconciliation design. |
| Performance на iPhone | Mock test не заменяет реальный time/frame-budget profiling. Builders и connector ограничены narrow zones, но пять L11–15 builds нужно проверить на реальном iPhone 16 Pro. |
| Staged walls | `defences_roads.js` остаётся isolated. Решение о legacy/v2 visual wall transition и profiling R44→R94 ещё не принято. |
| L16–20 | Не включены в `levels.js` runtime и не должны быть включены данным patch. |

## 9. iPhone 16 Pro manual smoke checklist — не выполнено в sandbox

1. Создать новый мир и новую деревню Колоколом-Оракулом; убедиться, что elder получил layout v2 и town-hall chest доступен.
2. В новом мире пройти L1–10, затем по отдельности L11–15. Перед каждым подтверждением сверить deposit в сундуке и убедиться, что resources исчезают только после успешной постройки.
3. После каждого city level повторно открыть elder form; убедиться, что object/connector не дублируются.
4. Осмотреть market, granary, inn, barracks и archive с улицы и внутри: doors, beds, lights, roof silhouette, вход и непрерывный connector к центральной дороге.
5. Открыть старую сохранённую L10 деревню без layout key; подтвердить `legacy_layout_max`, L10, целостность инвентаря и отсутствие city blocks.
6. Повторить один city build возле slope и воды; проверить отсутствие широкого сноса рельефа, marker-like nearby structure damage и лагов.
7. Проверить ночь/мобов, затем force-close/reload во время и после controlled level-up test; записать любое состояние stale `1` для recovery review.
8. После экономического merge проверить, что L11–15 chapter state/journal отображается owner module без изменения архитектурной transaction path.

## 10. Deliverables

| Файл | Содержимое |
|---|---|
| `STAGE5_ARCH_HANDOFF.md` | Этот handoff. |
| `STAGE5_ARCH_CITY_RUNTIME.patch` | Relative combined-baseline patch. |
| `STAGE5_ARCH_FULL_TEST_LOG.txt` | Полный test log с финальным PASS marker. |
| `GrowingVillages_Source_0.5.0_beta_fixed_stage5_arch_city_runtime.zip` | Полный updated combined baseline с архитектурным runtime integration. |
