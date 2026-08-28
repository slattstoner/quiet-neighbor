# READY FOR INTEGRATION

# HANDOFF_ARCH_2 — технический пространственный фундамент

**Этап:** 2 — исполнимый и тестируемый spatial contract  
**Дата:** 26 августа 2026 года  
**Базовый снимок:** `GrowingVillages_Source_0.5.0_beta_fixed`  
**Режим:** добавлены только чистая спецификация и тест. Новые здания 11–20, прогрессия, worldgen, NPC, квесты, рельеф и runtime-поведение уровней 1–10 не изменялись.

> Результат Этапа 2 — не новый город в мире Minecraft, а один импортируемый, вычисляемый источник истины. Он позволяет координатору и следующим этапам воспроизводимо проверить границы, четыре ворота, дороги, schedule стен, reserves ремесленников и безопасные буферы без доверия статическому handoff-документу.

## 1. Реализация

| Файл | Изменение | Назначение |
|---|---|---|
| `GrowingVillages_BP/scripts/spatial_plan.js` | **Новый**, data-only модуль. | Канонический spatial contract 1–20 без импорта Minecraft API и без побочных эффектов. |
| `tests/scripts/spatial_plan.js` | **Новая синхронизированная копия** модуля BP. | Позволяет тестам импортировать ровно те же данные, которые войдут в BP. |
| `tests/spatial_plan.mjs` | **Новый исполнимый тест.** | Импортирует спецификацию, вычисляет инварианты и завершает процесс с ненулевым кодом при ошибке. |
| `STAGE2_SPATIAL_FOUNDATION.patch` | **Новый patch** на 3 файла. | Применимый снимок внесённых additive-изменений. |
| `STAGE2_FULL_TEST_LOG.txt` | **Новый полный журнал.** | Полный регрессионный запуск Этапа 2. |

### 1.1 Публичный API `spatial_plan.js`

| Export | Тип / семантика |
|---|---|
| `FINAL_RADIUS` | Число `94`; финальная allocation boundary. |
| `WALL_INNER_FACE` | Число `93`; внутренняя линия куртины для R94. |
| `TOWER_INNER_FACE` | Число `90`; внутренняя грань угловой башни для R94. |
| `PERIMETER_SCHEDULE` | Неизменяемый массив стадий: `L5 palisade R44`, `L8 cobble R62`, `L10 castle R78`, `L15 castle_expand R94`. Последняя стадия не вводит четвёртый материал. |
| `ROAD_AXES` | Чистые bounds продольной и поперечной трёхблочных дорог, обе от `-94` до `94`, и 3×3 intersection. |
| `GATE_SPECS` | Ровно четыре спецификации (`east`, `west`, `south`, `north`), каждая с 5-блочным span и явной привязкой к road axis. |
| `SPATIAL_PLAN` | Один immutable entry на каждый из 22 canonical `buildingId`; содержит уровень, core bounds, road link и reserve envelopes. |
| `CANONICAL_BUILDING_IDS` | Список canonical ID, производный из `SPATIAL_PLAN`. |
| `LEGACY_SPECIAL_RESERVATION` | Чистый reserve для существующего merged special content: `f=45..63`, `s=-15..11`. |
| `LEGACY_L1_10_ENVELOPES` | Консервативные текущие L1–10 bounds исключительно для safety test; это не новые runtime-инструкции. |
| `perimeterForRadius(radius)` | Создаёт квадрат `{ fMin, fMax, sMin, sMax }` для валидного целого радиуса. |
| `boundsFor(buildingId)` | Возвращает defensive copy core bounds и reserve envelopes либо `null`. |
| `allocationEnvelopesFor(buildingId)` | Возвращает core и связанные reserve envelopes для proof. |
| `scheduleForLevel(level)` | Возвращает последнюю открытую wall stage или `null` до L5. |
| `rectanglesOverlap(a,b)` | Чистая проверка пересечения закрытых прямоугольников. |
| `touchesRoadAxis(bounds)` | Проверяет захват хотя бы одной трёхблочной road band. |
| `crossroadCells(radius)` | Возвращает union клеток двух дорог без обращений к миру. |
| `minimumWallClearance(bounds,radius)` | Возвращает прямой просвет до внутренней линии куртины. |
| `minimumTowerClearance(bounds,radius)` | Возвращает точный Chebyshev-просвет до ближайшего из четырёх реальных 5×5 corner tower footprints. |

`SPATIAL_PLAN` сохраняет четыре обязательных future reserves: farmer quest annex, blacksmith quest yard, cartographer quest annex и miner quest yard. Эти allocations участвуют в overlap и clearance-проверках наравне с core envelope, поэтому они не могут быть забыты при будущей реализации зданий.

## 2. Совместимость уровней 1–10

Модуль `spatial_plan.js` не импортирован из `main.js`, `village.js`, `levels.js`, `builder.js`, `walls.js`, `terrain.js` или другого runtime-модуля. Он не импортирует `@minecraft/server`, не обращается к `world`, не строит блоки и не меняет `perimeterFor()` в `walls.js`. Следовательно, существующая прогрессия 1–10 по-прежнему вызывает старые строители, старый schedule, старую геометрию и существующие тесты без изменений поведения.

Не применялась миграция старых деревень. `LEGACY_L1_10_ENVELOPES` и `LEGACY_SPECIAL_RESERVATION` существуют только в чистой спецификации и позволяют доказать, что будущие уровни 11–20 не наложены на известные legacy allocations. Никакая загрузка мира, dynamic property, NPC, квест, UI или manifest не изменялись.

| Что остаётся прежним | Почему это важно |
|---|---|
| `walls.js → perimeterFor(maxForward)` | Текущие L5/L8/L10 продолжают строить свой прежний компактный периметр, пока будущая интеграция явно не подключит schedule для новых деревень. |
| `builder.js → extendPath()` | Текущие дороги L1–10 не расширяются до R94 и не получают runtime-побочных эффектов. |
| `levels.js`, `MAX_BETA_LEVEL`, `village.js` | Нет уровней 11–20, нет новой экономики и нет изменения основания старой деревни. |
| `terrain.js` | Не запускается широкая очистка квадрата 189×189; performance-риск намеренно отложен. |

## 3. Исполнимый тест `spatial_plan.mjs`

Тест импортирует `./scripts/spatial_plan.js`; он не ищет текстовые строки и не доверяет статическому JSON. Его итог: **1751 зелёная проверка**.

| Инварианта | Реальная проверка |
|---|---|
| Полнота | 22 ID существуют ровно по одному; L1 содержит отдельные `town_hall`, `campfire`, `starter_house`; присутствует `grand_council_hall`; все bounds — валидные целочисленные rectangles. |
| Reserves | У farmer, blacksmith, cartographer и miner есть явные future envelopes. |
| Overlap | Все core/reserve allocations разных `buildingId` попарно не пересекаются; отношения core/reserve одного ID явно допускаются как документированные. |
| Roads | Каждый envelope вне обеих road bands; `crossroadCells()` покрывает все 1125 уникальных клеток двух трёхблочных осей от `-94` до `94`. |
| Gates | Существует ровно 4 gate spec; одна на каждую сторону; ширина каждого проезда 5 блоков; span содержит соответствующую трёхблочную road axis. |
| Schedule | Зафиксирован единственный schedule `R44/R62/R78/R94` на L5/L8/L10/L15; L15 имеет `castle_expand`, а не новый tier. |
| Буферы | Для каждого core/reserve: wall clearance ≥20, exact tower clearance ≥20. Глобальные minima зафиксированы как **27** и **24**. |
| Legacy safety | Все future L11–20 envelopes не пересекают current L1–10 safety envelopes и merged special reservation. |
| Чистота | Исходник не импортирует `@minecraft/server` и не использует `world.*`. |

### 3.1 Исправленные вопросы отладки

| Вопрос | Принятое решение |
|---|---|
| Ложное завышение просвета до башен при одном глобальном `max(abs(f),abs(s))`. | `minimumTowerClearance()` вычисляет расстояние до каждой конкретной 5×5 угловой башни по двум интервалам и возвращает минимум Chebyshev-расстояний. Это корректно только тогда, когда bounds действительно близки к тому же углу по обеим осям. |
| Риск утратить будущие пристройки ремесленников при проверке core bounds. | Reserve envelopes хранятся с entry и разворачиваются `allocationEnvelopesFor()`; тестирует их в overlap, roads, buffers и legacy safety. |
| Четыре ворота могли бы разойтись по условным координатам в будущих модулях. | `GATE_SPECS` задаёт edge, fixed coordinate, 5-блочный span и road axis в одном data-only месте. |
| R94 мог бы незаметно стать runtime default на Этапе 2. | Модуль не импортируется runtime, `walls.js` не редактировался, а тест совместимости подтверждает прежний регрессионный набор. |

Остаточный риск не является дефектом этого этапа: привязка `PERIMETER_SCHEDULE` к реальному `walls.js`, новой geometry и batched terrain strategy требует отдельной integration-задачи. Она намеренно не выполнялась.

## 4. Тестирование

Скрипты BP сначала синхронизированы в `tests/scripts`; `diff -qr GrowingVillages_BP/scripts tests/scripts` завершился `PASS`. В package теперь 19 BP JavaScript-модулей, включая новый чистый модуль.

```bash
cd /home/ubuntu/projects/mcpe-mod-f467f90c/source_review/GrowingVillages_Source_0.5.0_beta_fixed
rm -rf tests/scripts
cp -r GrowingVillages_BP/scripts tests/scripts
cd tests
for f in lint run integration geometry roof fixes features polish orientation round2 specials bells quest_upgrades crossroads spatial_plan; do
  node "$f.mjs" || exit 1
done
for f in ../GrowingVillages_BP/scripts/*.js; do
  node --check "$f" || exit 1
done
```

| Категория | Результат |
|---|---|
| Старые regression suites | **14/14 прошли**: `lint`, `run`, `integration`, `geometry`, `roof`, `fixes`, `features`, `polish`, `orientation`, `round2`, `specials`, `bells`, `quest_upgrades`, `crossroads`. |
| Новый suite | **`spatial_plan.mjs` прошёл: 1751 checks.** |
| Синтаксис | **19/19** BP `.js` файлов прошли `node --check`. |
| Итог | `STAGE2_REGRESSION_STATUS=PASS`. |
| Полный журнал | `STAGE2_FULL_TEST_LOG.txt`. |
| Patch verification | Patch прошёл `patch --dry-run`, применился к свежей распаковке исходного ZIP и воспроизвёл `ALL SPATIAL PLAN TESTS PASSED (1751 checks)`. |

## 5. Отложенный integration patch — не применять на Этапе 2

Ниже определён следующий безопасный набор работ. Это описание будущей интеграции, а не предложение сделать её сейчас.

| Порядок | Файлы будущей задачи | Изменение | Нужная защита |
|---:|---|---|---|
| 1 | `walls.js` | Импортировать чистые `PERIMETER_SCHEDULE`, `GATE_SPECS`, `perimeterForRadius` только в новом path для **новых** деревень. L5→R44, L8→R62, L10→R78, L15→расширение castle до R94. | Сохранить старый `perimeterFor(maxForward)` и существующие вызовы. Добавить tests на четыре воротных прохода, все стадии и отсутствие четвёртого материала. |
| 2 | `builder.js` | Добавить новый builder дорожных осей, принимающий `ROAD_AXES`/`GATE_SPECS`; строить только через narrow segments или batches. | Не заменять `extendPath()` до полного level-1..20 integration test; сохранить существующие roof/door helpers. |
| 3 | `levels.js`, `village.js`, `ui.js` | После продуктового решения добавить L11–20 и зафиксировать, что новый master plan применяется исключительно к новым деревням будущей версии. | Не мигрировать и не перестраивать старые миры; сохранить ограничение экономики. |
| 4 | `upgrades.js`, `quests.js`, `special_content.js` | Связать 5-tiers craft reserves и canonical IDs L16–18 с согласованной моделью условий. | Предотвратить двойное строительство; сохранить rewards и production caps; отдельно решить старые positions special content. |
| 5 | `terrain.js` | Реализовать narrow/batched site preparation только для конкретного plot, куртины и ворот. | Ни одного full-square `prepareSite()`/clear-pass на 189×189; smoke-test производительности на iPhone 16 Pro. |

## 6. Файлы сдачи

| Артефакт | Содержимое |
|---|---|
| `HANDOFF_ARCH_2.md` | Этот технический handoff. |
| `STAGE2_SPATIAL_FOUNDATION.patch` | 685 строк, 3 новых файла, SHA-256 `1a43d08d37045669d4305489ba70f549aefb5ccf0f80031a6fd3aea469154926`. |
| `STAGE2_FULL_TEST_LOG.txt` | Полный текст всех 14 старых suites, нового spatial suite и syntax check. |
| `patch_verify_stage2/.../patch_verify_spatial.log` | Локальный независимый журнал применения patch к чистой распаковке резервного ZIP и повторного spatial test. |
| `GrowingVillages_BP/scripts/spatial_plan.js` | Чистый source of truth для следующей интеграционной задачи. |
| `tests/spatial_plan.mjs` | Независимо запускаемое доказательство контракта. |

## 7. Примечание о входных документах

Файл `COORDINATOR_REVIEW_STAGE_1.md`, указанный в промте Этапа 2, не находился в доступной проектной папке. Обязательные решения из утверждённого промта — R94, schedule R44/R62/R78/R94, четыре ворота, только новые деревни и запрет широкого terrain pass — были применены буквально. При появлении отдельного файла review его следует сверить перед будущей runtime-интеграцией.
