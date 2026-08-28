import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QUESTS } from "./scripts/quests.js";
import { CRAFTSMAN_ARCS, SPECIAL_ARCS, LEVEL_CHAPTERS } from "./scripts/quest_contract_v2.js";
import { craftsmanItemLocalizationKey } from "./scripts/craftsman_quests.js";

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

function languageMap(relativePath) {
  const content = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  const result = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("growing_villages.")) continue;
    const separator = line.indexOf("=");
    if (separator > 0) result.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return result;
}

const ru = languageMap("../GrowingVillages_RP/texts/ru_RU.lang");
const en = languageMap("../GrowingVillages_RP/texts/en_US.lang");
const ruKeys = [...ru.keys()].sort();
const enKeys = [...en.keys()].sort();
const isQuestKey = (key) => key.startsWith("growing_villages.ui.craftsman.") ||
  key.startsWith("growing_villages.craftsman.") || key.startsWith("growing_villages.quest.") ||
  key.startsWith("growing_villages.arc.") || key.startsWith("growing_villages.special.") || key.startsWith("growing_villages.item.");
const questKeys = ruKeys.filter(isQuestKey);
const activeCraftsmanKeys = questKeys.filter((key) => !key.startsWith("growing_villages.special."));

console.log("\n=== full language parity ===");
assert(JSON.stringify(ruKeys) === JSON.stringify(enKeys), "RU and EN full Growing Villages key-name sets match exactly");
assert(ruKeys.every((key) => ru.get(key).trim() && en.get(key).trim()), "all Growing Villages keys have non-empty RU and EN values");

console.log("\n=== quest/craftsman owner scope ===");
assert(questKeys.length > 0 && JSON.stringify(questKeys) === JSON.stringify(enKeys.filter(isQuestKey)),
  "RU and EN quest/craftsman owner key-name sets match exactly");
const required = new Set([
  "growing_villages.ui.craftsman.quest.title",
  "growing_villages.ui.craftsman.quest.turn_in",
  "growing_villages.ui.craftsman.quest.cancel",
  "growing_villages.ui.craftsman.quest.close",
  "growing_villages.ui.craftsman.quest.inventory_full",
  "growing_villages.ui.craftsman.quest.stale_state",
  "growing_villages.ui.craftsman.quest.not_enough",
  "growing_villages.ui.craftsman.quest.no_active_quest",
  "growing_villages.ui.craftsman.quest.locked",
  "growing_villages.ui.craftsman.quest.error"
]);
for (const arc of CRAFTSMAN_ARCS) {
  for (const key of Object.values(arc.localization)) required.add(key);
  for (const step of arc.steps) for (const key of Object.values(step.localization)) required.add(key);
  for (const legacyStep of QUESTS[arc.legacyRole].chain) required.add(craftsmanItemLocalizationKey(legacyStep.requiredItem));
  assert(arc.steps.length === 5, `${arc.id} contributes all five localised steps`);
}
for (const arc of SPECIAL_ARCS) {
  for (const key of [arc.titleKey, arc.summaryKey, arc.completionKey, arc.buildKey, arc.deferredPolicyKey]) required.add(key);
  for (const step of arc.steps) for (const key of Object.values(step.localization)) required.add(key);
  assert(arc.steps.length === 3 && arc.runtimeStatus === "planned", `${arc.arcId} contributes three planned data-only lore steps`);
}
assert([...required].every((key) => ru.has(key) && en.has(key)), "every adapter, planned special and UI localisation reference exists in both languages");
assert([...required].every((key) => isQuestKey(key) && !/\s/.test(key)), "all quest references are stable keys in the quest/craftsman owner scope");
assert(!questKeys.some((key) => /^growing_villages\./.test(ru.get(key)) || /^growing_villages\./.test(en.get(key))),
  "quest/craftsman text has no literal localisation-key leaks");

console.log("\n=== supported transaction terminology ===");
const transactionTerm = /reward|discount|turn[- ]?in|наград|скидк|сдат[ьё]/i;
const allowedTermKeys = new Set([
  "growing_villages.ui.craftsman.quest.turn_in",
  ...CRAFTSMAN_ARCS.flatMap((arc) => arc.steps.map((step) => step.localization.objective))
]);
assert(!activeCraftsmanKeys.some((key) => transactionTerm.test(ru.get(key)) || transactionTerm.test(en.get(key))) ||
  activeCraftsmanKeys.filter((key) => transactionTerm.test(ru.get(key)) || transactionTerm.test(en.get(key))).every((key) => allowedTermKeys.has(key)),
  "turn-in, reward or discount terminology appears only in adapter-supported quest UI keys");
assert(![...required].some((key) => /chapter\.1[1-5]|special\.(ranger|healer|engineer)/.test(key)),
  "craftsman adapter references do not activate future chapters or special arcs");

console.log("\n=== planned final-city contract lore ===");
const finalChapters = LEVEL_CHAPTERS.filter((chapter) => chapter.level === 19 || chapter.level === 20);
assert(finalChapters.length === 2 && finalChapters.every((chapter) => chapter.runtimeStatus === "planned"),
  "L19-L20 final-city chapters remain planned contract data");
const finalKeys = finalChapters.flatMap((chapter) => Object.values(chapter.localization));
assert(finalKeys.every((key) => ru.has(key) && en.has(key) && ru.get(key).trim() && en.get(key).trim()),
  "all planned L19-L20 lore keys have non-empty RU and EN values");
assert(finalKeys.every((key) => key.startsWith("growing_villages.chapter.chapter.19.") || key.startsWith("growing_villages.chapter.chapter.20.")),
  "planned final-city keys use stable L19-L20 chapter namespaces");
assert(!finalKeys.some((key) => /^growing_villages\./.test(ru.get(key)) || /^growing_villages\./.test(en.get(key))),
  "planned final-city lore has no literal-key leaks");

console.log(failures === 0 ? "\nALL CRAFTSMAN LOCALISATION TESTS PASSED" : `\n${failures} CRAFTSMAN LOCALISATION TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
