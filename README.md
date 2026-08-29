# Growing Villages

Аддон для Minecraft Bedrock Edition: ванильные деревни заменяются на
растущие — игрок находит крошечное поселение и вкладывает ресурсы в
ратушу, чтобы поднимать её по уровням. Деревня достраивается вдоль
улицы, приходят ремесленники с квестами, на поздних уровнях появляются
стены, башни и стража.

Текущая версия — см. `header.version` в `GrowingVillages_BP/manifest.json`
(любое число, зафиксированное тут, устареет). Целевой движок — Bedrock
1.21.80+.

## Структура

- `GrowingVillages_BP/` — behavior pack (скрипты в `scripts/`, предметы в `items/`)
- `GrowingVillages_RP/` — resource pack (текстуры, тексты)
- `tests/` — эмулятор Bedrock Script API на Node.js и наборы тестов
- `HANDOVER.md` — полная передача контекста проекта (архитектура, грабли, баланс)

## Разработка

Полный контекст для продолжения разработки — в [`HANDOVER.md`](HANDOVER.md).
Начни с него.

### Тесты

`tests/` — эмулятор Bedrock Script API на Node.js. Перед запуском любого
теста синхронизируй код (`tests/scripts` — рабочая копия, в git не
хранится, см. `.gitignore`):

```bash
rm -rf tests/scripts && cp -r GrowingVillages_BP/scripts tests/scripts
node tests/имя_файла.mjs
```

На каждую задачу пиши новый узкий тест под конкретную правку, а не
перезапускай весь исторический `tests/*.mjs` по умолчанию — подробности
и когда всё же стоит прогнать всё целиком — в [`HANDOVER.md`](HANDOVER.md).
