# Growing Villages

Аддон для Minecraft Bedrock Edition: ванильные деревни заменяются на
растущие — игрок находит крошечное поселение и вкладывает ресурсы в
ратушу, чтобы поднимать её по уровням. Деревня достраивается вдоль
улицы, приходят ремесленники с квестами, на поздних уровнях появляются
стены, башни и стража.

Текущая версия исходников: **0.5.4** (Bedrock 1.21.80+).

## Структура

- `GrowingVillages_BP/` — behavior pack (скрипты в `scripts/`, предметы в `items/`)
- `GrowingVillages_RP/` — resource pack (текстуры, тексты)
- `tests/` — эмулятор Bedrock Script API на Node.js и наборы тестов
- `HANDOVER.md` — полная передача контекста проекта (архитектура, грабли, баланс)

## Разработка

Полный контекст для продолжения разработки — в [`HANDOVER.md`](HANDOVER.md).
Начни с него.

### Тесты

```bash
cd tests
cp -r ../GrowingVillages_BP/scripts ./scripts   # синхронизировать код
for f in lint run integration geometry roof fixes features polish; do
  echo "=== $f ==="; node "$f.mjs"
done
```

`tests/scripts` — синхронизируемая копия, в git не хранится (см. `.gitignore`).
