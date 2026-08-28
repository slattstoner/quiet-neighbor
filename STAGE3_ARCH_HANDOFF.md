READY FOR INTEGRATION

# STAGE3_ARCH_HANDOFF — изолированные городские builders уровней 11–15

**Этап:** 3 — архитектурный контент, готовый к будущему подключению  
**Дата:** 26 августа 2026 года  
**Базовый снимок:** `GrowingVillages_Source_0.5.0_beta_fixed` с фундаментом Этапа 2  
**Статус runtime:** L11–15 **не подключены** к `tryLevelUp()`, `levels.js`, `village.js`, UI, NPC, квестам, производству или worldgen.

> Этап реализует пять независимых builders, но не меняет существующую игру. Их можно вызывать напрямую с `dimension`, `origin` и `facing`, получать shape/metadata и проверять в mock-мире. Только отдельная будущая задача координатора может включить их в прогрессию для новых деревень.

## 1. Результат

| Уровень | `buildingId` | Реализованная роль | Изолированный builder |
|---:|---|---|---|
| 11 | `market_square` | Открытый рынок: 6 навесов, каменный водный узел, скамьи, kiosk, barrel, composter и ночной свет. | `buildCityBuilding("market_square", ...)` |
| 12 | `granary_yard` | Высокий амбар, unloading court, бочки, сундук, компостер, сено и декоративная тележка; без income/transfer logic. | `buildCityBuilding("granary_yard", ...)` |
| 13 | `travellers_inn` | Двухъярусный ванильный постоялый двор с четырьмя гостевыми кроватями, кухней, storage, тёплым светом и отдельным стойлом. | `buildCityBuilding("travellers_inn", ...)` |
| 14 | `guard_barracks` | Каменные казармы с четырьмя кроватями, armory storage, grindstone/smithing decor, training yard и watchfire; без выдачи предметов. | `buildCityBuilding("guard_barracks", ...)` |
| 15 | `village_archive` | Архив с каменным цоколем, тёмными балками, bookshelf/lectern/cartography slots, сундуком, тихим reading court и светом. | `buildCityBuilding("village_archive", ...)` |

Все пять builders используют `boundsFor(buildingId)` и каноническую запись `SPATIAL_PLAN` из `spatial_plan.js`. В коде не создан второй источник core bounds: локальные габариты домов, стоек и дворов — только offsets внутри утверждённого core envelope.

## 2. Изменённые файлы и публичный API

| Файл | Изменение | Совместимость |
|---|---|---|
| `GrowingVillages_BP/scripts/city_buildings_11_15.js` | **Новый** isolated module с пятью builders, bounded placement, local plot preparation, gabled roofs, entrances, interiors и metadata. | Не импортируется ни одним runtime entry point. |
| `GrowingVillages_BP/scripts/builder.js` | Один additive export: `placeBed`. | Логика существующих builders не изменена; экспортирует уже проверенный helper безопасной двухблочной кровати. |
| `tests/scripts/city_buildings_11_15.js` | Синхронизированная копия нового BP module. | Проверяется `diff -qr` с BP scripts. |
| `tests/scripts/builder.js` | Синхронизированная копия additive export. | Идентична BP copy. |
| `tests/city_11_15.mjs` | **Новый исполнимый тест** всех объектов и всех четырёх orientation. | Тест импортирует реальные builders и реальные `spatial_plan` data. |
| `STAGE3_ARCH_CITY_11_15.patch` | Patch на 5 файлов. | Применяется из корня исходника обычным `patch -p1`. |
| `STAGE3_ARCH_FULL_TEST_LOG.txt` | Полный финальный журнал. | Содержит 14 legacy suites, spatial proof, city suite и syntax pass. |

### 2.1 Export `city_buildings_11_15.js`

| Export | Семантика |
|---|---|
| `CITY_BUILDING_IDS` | Immutable ordered list из пяти IDs: `market_square`, `granary_yard`, `travellers_inn`, `guard_barracks`, `village_archive`. |
| `buildCityBuilding(buildingId, dimension, origin, facing)` | Строит один строго ограниченный городский объект и возвращает immutable metadata. Неподдерживаемый ID выбрасывает ошибку. Не создаёт NPC, не пишет village state и не меняет уровень. |
| `buildCityBuildings11To15(dimension, origin, facing)` | Удобный прямой вызов пяти изолированных builders в order уровней 11–15; для будущей интеграции, пока не импортирован runtime. |

Каждый успешный результат содержит стабильные поля:

| Поле | Использование будущей интеграцией |
|---|---|
| `buildingId`, `level`, `bounds` | Связь результата с canonical plan и проверка отдельного уровня. |
| `roadLink`, `approach`, `entryPath`, `entry` | Данные для будущих внешних road segments и проверки двухблочного подхода без дублирования координат. В Этапе 3 внешняя часть corridor остаётся свободной: она лежит вне allocation envelope и не строится до интеграции дорог. |
| `npcAnchor` | Свободная клетка для будущего NPC; builder сам никого не спавнит. |
| `beds`, `storage`, `workstations`, `lights` | Стабильные локальные slots для привязки будущих NPC/контейнеров и для regression. |
| `rooms`, `roofSpecs` | Машинно проверяемые shape/roof descriptions, используемые city test. |

## 3. Геометрия, доступ и Bedrock-совместимость

`buildCityBuilding()` сначала получает core bounds от `spatial_plan.js`, затем вызывает `prepareSite()` исключительно для этого envelope с `padding: 0`, `clearHeight: 12` и `fillDepth: 5`. Полный квадрат `189×189`, final wall R94 и `prepareFortifiedArea()` не вызываются.

`boundedPlacer` перед каждой установкой проверяет local `f/s` против core bounds. Это делает выход блока за allocation envelope runtime-ошибкой, а не визуальной надеждой. Внешняя двухблочная corridor до соответствующей road axis возвращается в `metadata.approach`; она не заполнена блоками Этапа 3, поскольку находится вне allocation envelope и будет строиться только вместе с approved final road integration.

Все основные входы — настоящие двухблочные `minecraft:wooden_door`. Они используют проверенный `placeDoor()` с нижней и верхней половинами и fallback state candidates. Крыши используют `stairs()` с `resolveFirst()`/`setBlockMulti()` через существующий `makePlacer`; скаты у обеих сторон направлены наружу от конька при каждом `facing`. Beds, storage, workstations и lights имеют стабильные metadata slots и проверяются на доступную соседнюю воздушную клетку.

| Инварианта | Реализация |
|---|---|
| Bounds | Core bounds берутся только из `boundsFor()`. `boundedPlacer` блокирует установку за их пределами. |
| Road safety | `entryFor()` отклоняет plan, соприкасающийся с canonical road bands; тест дополнительно проверяет это для каждого ID. |
| Terrain safety | Подготовка ограничена текущим core envelope, без padding. Маркерный блок в соседнем участке сохраняется в каждой из 20 build-case. |
| NPC safety | Нет вызовов `spawnEntity`; test фиксирует неизменное число entities. |
| Economy safety | В builders нет `ItemStack`, inventory transfers, production calls, rewards, торговли или добычи. Гранарий и казармы только визуальны. |
| Старый runtime | `levels.js`, `village.js`, `main.js`, `ui.js`, `production.js`, `quests.js`, `npc.js`, `special_content.js`, `walls.js`, `terrain.js` байтово совпадают с архивом Этапа 2. |

## 4. Исполнимый тест и результаты

`tests/city_11_15.mjs` строит каждый из пяти объектов во всех четырёх `facing` в независимых частях mock-world: всего 20 реальных build-case. Он не делает текстовый search, а вызывает builder, читает реальные blocks и block states из mock Dimension.

| Проверка | Результат |
|---|---|
| Canonical geometry | Для всех 20 case metadata `bounds` точно совпадают с `boundsFor(buildingId)`; построенные blocks остаются внутри core envelope. |
| Four-facing | Все пять buildings успешно строятся при `facing=0,1,2,3`; двери, interiors, roofs и slots сохраняют local role. |
| Doors | Для каждого case проверены `minecraft:wooden_door`, `upper_block_bit=false` внизу и `upper_block_bit=true` наверху. |
| Access | У каждой внутренней entry path ширина ≥2; future external approach имеет ширину ≥2 и остаётся свободным; beds, storage и workstations имеют соседнюю walkable air cell. |
| Roofs | Для каждого room/canopy проверены stair block и `weirdo_direction` обеих сторон крыши; скаты смотрят наружу от ridge. |
| Interiors and light | `npcAnchor`, beds (кроме рынка), storage, workstations и lantern slots реально существуют и проверены. |
| Terrain safety | Соседний `minecraft:gold_block` marker сохраняется во всех 20 case. |
| Non-runtime | City builders не создают entities. |
| Итог city suite | **`ALL CITY 11–15 TESTS PASSED (1093 checks)`**. |

Финальный полный запуск выполнен после последнего изменения test. Scripts синхронизированы перед запуском; `diff -qr GrowingVillages_BP/scripts tests/scripts` завершился `PASS`.

```bash
cd tests
rm -rf scripts
cp -r ../GrowingVillages_BP/scripts ./scripts
for f in lint run integration geometry roof fixes features polish orientation round2 specials bells quest_upgrades crossroads spatial_plan city_11_15; do
  node "$f.mjs" || exit 1
done
for f in ../GrowingVillages_BP/scripts/*.js; do
  node --check "$f" || exit 1
done
```

| Набор | Результат |
|---|---|
| 14 legacy suites | **14/14 прошли**: `lint`, `run`, `integration`, `geometry`, `roof`, `fixes`, `features`, `polish`, `orientation`, `round2`, `specials`, `bells`, `quest_upgrades`, `crossroads`. |
| Spatial contract | **Прошёл**: `ALL SPATIAL PLAN TESTS PASSED (1751 checks)`. |
| New city suite | **Прошёл**: `ALL CITY 11–15 TESTS PASSED (1093 checks)`. |
| Syntax | **20/20** BP `.js` файлов прошли `node --check`. |
| Final status | `STAGE3_REGRESSION_STATUS=PASS`. |

## 5. Debug-review: исправленные вопросы

| Найденный риск | Исправление до сдачи |
|---|---|
| Внешний roadLink мог быть центрирован по bounds, но не совпадать с настоящей дверью. | `approachFor()` теперь получает `entry`, строит двухблочную reserved corridor, а у каждого объекта добавлена непрерывная `entryPath` внутри core plot. |
| Первичная bounds-проверка выводила по одной строке на каждую очищенную terrain cell. | Тест продолжает обходить все реально записанные blocks, но агрегирует результат в один assertion на build-case; полный лог стал проверяемым и компактным. |
| Нельзя безопасно дублировать ориентированную двухблочную логику кровати. | Из `builder.js` экспортирован существующий `placeBed`; не создана вторая несовместимая реализация. |
| Неправильная глобальная проверка «интерьер доступен» могла пропустить furniture against wall. | Test проверяет adjacent air у каждого bed, storage и workstation slot. |
| `prepareSite` с padding мог уничтожить соседний allocation. | Builders используют только exact core bounds, `padding: 0`; тест сохраняет boundary-neighbour marker при каждом facing. |

## 6. Риски, которые остаются намеренно

Тестовый mock гарантирует placement, states и доступную соседнюю клетку, но не выполняет реальный Bedrock pathfinding, рендеринг и производительный smoke-test на iPhone 16 Pro. До включения уровней в игру требуется ручная проверка в новом мире: двери, проходы, roof silhouette, lantern placement, terrain on slopes, interaction with existing entities and visual read from street level.

Внешние road corridors не строятся в Этапе 3. Это сознательное соблюдение двух ограничений: блоки city builder не выходят за canonical allocation envelope и final crossroad/roads ещё не подключены к runtime. Будущая задача дорог должна использовать `metadata.approach`, `ROAD_AXES` и `GATE_SPECS` как единственную координатную основу.

## 7. Future integration note — не применять сейчас

| Файл будущей задачи | Требуемое изменение | Нельзя нарушить |
|---|---|---|
| `levels.js` | После продуктового решения объявить L11–15 и вызвать `buildCityBuilding()` по соответствующему canonical `buildingId`. | Не менять L1–10 coordinates или их existing builder calls; не включать L16–20 без отдельного этапа. |
| `village.js` | Хранить one-time build state/shape только для новых деревень и передавать `origin/facing` builder-у. | Не мигрировать старые деревни и не перестраивать существующие миры. |
| `builder.js` / новый road module | Построить narrow 2-block corridor от `metadata.entryPath` через `metadata.approach` к `ROAD_AXES`, затем отдельно connected crossroad/gates. | Не строить final R94 roads/walls массово и не дублировать spatial coordinates. |
| `terrain.js` | Ввести batched/narrow strategy для road segments и будущей стены, измерить её на iPhone. | Запретить broad `prepareSite()`/clear-pass по 189×189. |
| `npc.js`, `quests.js`, `special_content.js` | После отдельного продуктового решения занять metadata slots NPC/quests. | City builders по-прежнему не должны сами spawn NPC или давать rewards. |

## 8. Артефакты

| Файл | Назначение |
|---|---|
| `STAGE3_ARCH_HANDOFF.md` | Этот handoff. |
| `STAGE3_ARCH_CITY_11_15.patch` | 5 файлов, 871 строка, SHA-256 `2ba40c059562095cf408e06d741d2f942b898f0f7fa7dfa76dd084af7b363f2e`. |
| `STAGE3_ARCH_FULL_TEST_LOG.txt` | Полный финальный regression log. |
| `GrowingVillages_Source_0.5.0_beta_fixed_stage3_arch_city_11_15.zip` | Проверенный обновлённый исходник; создаётся вместе со сдачей. |

### Patch verification

`STAGE3_ARCH_CITY_11_15.patch` прошёл `patch --dry-run`, применился к свежему ZIP Этапа 2 и затем воспроизвёл `ALL CITY 11–15 TESTS PASSED (1093 checks)` после синхронизации scripts.
