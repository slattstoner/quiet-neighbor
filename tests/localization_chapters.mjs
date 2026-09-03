import { MAX_BETA_LEVEL } from "./scripts/levels.js";
import { chapterForLevel } from "./scripts/quest_contract_v2.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildChapterJournalModel, JOURNAL_KEYS } from "./scripts/chapter_journal.js";

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error("FAIL:", message);
  } else {
    console.log("ok:", message);
  }
}

function languageMap(relativePath) {
  const content = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  const result = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0) result.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return result;
}

function elderForLevel(level) {
  const chapter = `chapter.${String(level).padStart(2, "0")}.${[
    "foundation", "field", "forge", "routes", "watch", "safe_mine", "neighbours", "remembered_places", "craft_circle", "safe_roads"
  ][level - 1]}`;
  const properties = new Map([
    ["village:level", level],
    ["village:schema", 2],
    ["village:v2:chapter", chapter],
    [`village:v2:chapter:${chapter}`, "open"]
  ]);
  return { getDynamicProperty(key) { return properties.get(key); }, isValid: true };
}

console.log("\n=== localisation key parity ===");
const ru = languageMap("../GrowingVillages_RP/texts/ru_RU.lang");
const en = languageMap("../GrowingVillages_RP/texts/en_US.lang");
const isJournalKey = (key) => key.startsWith("growing_villages.ui.elder.chronicle.") || key.startsWith("growing_villages.chapter.");
const ruJournalKeys = [...ru.keys()].filter(isJournalKey).sort();
const enJournalKeys = [...en.keys()].filter(isJournalKey).sort();
const isActiveJournalKey = (key) => key.startsWith("growing_villages.ui.elder.chronicle.") ||
  /^growing_villages\.chapter\.chapter\.(0[1-9]|10)\./.test(key);
const ruActiveJournalKeys = ruJournalKeys.filter(isActiveJournalKey);
assert(ruJournalKeys.length > 0 && enJournalKeys.length > 0, "both language files define journal/chapter owner keys");
assert(JSON.stringify(ruJournalKeys) === JSON.stringify(enJournalKeys),
  "RU and EN have an identical journal/chapter key-name set");
assert(ruJournalKeys.every((key) => ru.get(key).length > 0 && en.get(key).length > 0),
  "every journal/chapter key has non-empty RU and EN text");

console.log("\n=== model and UI localisation references ===");
const required = new Set(Object.values(JOURNAL_KEYS));
for (let level = 1; level <= 10; level++) {
  const model = buildChapterJournalModel(elderForLevel(level), level % 2 ? "ru_RU" : "en_US");
  required.add(model.chapterKeys.title);
  required.add(model.chapterKeys.intro);
  if (model.nextChapterKeys) {
    required.add(model.nextChapterKeys.title);
    required.add(model.nextChapterKeys.intro);
  }
  for (const arc of model.availableArcs) required.add(arc.keys.title);
  assert(model.chapterKeys.title.startsWith("growing_villages.") && model.chapterKeys.intro.startsWith("growing_villages."),
    `level ${level} model uses namespaced chapter localisation keys`);
}
assert([...required].every((key) => ru.has(key) && en.has(key)),
  "every localisation key referenced by journal models exists in both languages");
assert([...required].every((key) => !/\s/.test(key)), "journal localisation references contain only stable key tokens");

console.log("\n=== localisation content scope ===");
assert(!ruJournalKeys.some((key) => /chapter\.1[1-5]\./.test(key)),
  "journal localisation does not present levels 11-15 as active beta UI");

// The other half of that statement, which nothing asserted: text must exist
// for every level the journal can actually reach. Together the two say "the
// chapters with text are exactly the chapters that are live".
//
// This matters because chapter_journal.js builds its keys by interpolation -
// `growing_villages.chapter.${chapterId}.title` - and the ratchet's
// key-existence scan only sees whole string literals, so a chapter with no
// text at all is invisible to it. Raising MAX_BETA_LEVEL by one currently
// turns the chronicle into raw key text with no test objecting; now one does.
for (let level = 1; level <= MAX_BETA_LEVEL; level++) {
  const chapter = chapterForLevel(level);
  assert(!!chapter, `level ${level} has a chapter`);
  if (!chapter) continue;
  for (const part of ["title", "intro"]) {
    const key = `growing_villages.chapter.${chapter.id}.${part}`;
    assert(ru.has(key) && en.has(key),
      `level ${level} (${chapter.id}) has ${part} text in both languages`);
  }
}
const unsupportedPromise = /reward|turn[- ]?in|service|наград|сдат[ьё]|услуг/i;
assert(!ruActiveJournalKeys.some((key) => unsupportedPromise.test(ru.get(key)) || unsupportedPromise.test(en.get(key))),
  "active journal/chapter texts do not promise rewards, turn-ins or services");

console.log(failures === 0 ? "\nALL CHAPTER LOCALISATION TESTS PASSED" : `\n${failures} CHAPTER LOCALISATION TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
