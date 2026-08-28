import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LEVELS, MAX_BETA_LEVEL, MAX_LAYOUT_V2_LEVEL, isCityLevel, maxForwardForLevel, maxLevelForLayoutVersion } from "./scripts/levels.js";
import {
  RUNTIME_CHAPTER_MAX_LEVEL,
  chapterForVillageLevel,
  setVillageChapterForLevel
} from "./scripts/chapter_state.js";

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error("FAIL:", message);
  } else console.log("ok:", message);
}

function importedModuleSpecifiers(relativePath) {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return [...source.matchAll(/\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)].map((match) => match[1]);
}

console.log("\n=== v2 progression contract ===");
assert(MAX_BETA_LEVEL === 10, "legacy/chapter static cap remains 10 pending the parallel UI merge");
assert(MAX_LAYOUT_V2_LEVEL === 15 && maxLevelForLayoutVersion(2) === 15 && maxLevelForLayoutVersion(1) === 10,
  "layout-aware runtime admits L15 only for explicit v2 villages");
const buildLevels = Object.keys(LEVELS).map(Number).sort((a, b) => a - b);
assert(JSON.stringify(buildLevels) === JSON.stringify([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
  "LEVELS contains every actual build level 2 through 15");
const expectedCity = ["market_square", "granary_yard", "travellers_inn", "guard_barracks", "village_archive"];
assert(JSON.stringify([11, 12, 13, 14, 15].map((level) => LEVELS[level].cityBuildingId)) === JSON.stringify(expectedCity),
  "L11–15 retain canonical city building IDs");
assert([11, 12, 13, 14, 15].every(isCityLevel) && !isCityLevel(10), "only L11–15 take city builder path");

console.log("\n=== legacy forward geometry remains bounded ===");
const expectedForward = new Map([
  [1, 12], [2, 12], [3, 12], [4, 12], [5, 12],
  [6, 12], [7, 12], [8, 26], [9, 26], [10, 38],
  [11, 38], [12, 38], [13, 38], [14, 38], [15, 38]
]);
for (const [level, expected] of expectedForward) assert(maxForwardForLevel(level) === expected, `maxForward L${level} remains ${expected}`);
assert(maxForwardForLevel(15) === 38 && maxForwardForLevel(15) < 94,
  "city runtime does not activate final R94 roads or defensive stages");

console.log("\n=== module ownership and chapter handoff ===");
const levelImports = importedModuleSpecifiers("./scripts/levels.js");
const villageImports = importedModuleSpecifiers("./scripts/village.js");
const mainImports = importedModuleSpecifiers("./scripts/main.js");
assert(levelImports.includes("./city_buildings_11_15.js"), "levels owns the approved city-builder routing");
assert(villageImports.includes("./city_connectors.js"), "village owns narrow connector transaction wiring");
assert(!mainImports.includes("./city_buildings_11_15.js") && !mainImports.includes("./defences_roads.js"), "main does not directly activate city or defence builders");
assert(RUNTIME_CHAPTER_MAX_LEVEL === 10, "parallel chapter owner remains unchanged in this architecture-only change set");
assert(chapterForVillageLevel(11) === "chapter.11.market_day", "chapter data already describes level 11 for the parallel merge");
let writes = 0;
const preMergeChapter = { getDynamicProperty() { return undefined; }, setDynamicProperty() { writes++; } };
const futureResult = setVillageChapterForLevel(preMergeChapter, 11);
assert(!futureResult.ok && futureResult.reason === "unsupported_runtime_level", "pre-merge chapter adapter remains neutral above its owned cap");
assert(writes === 0, "pre-merge chapter refusal produces no dynamic-property write");

console.log("\n=== no world side effects in data guard ===");
assert(typeof LEVELS === "object" && typeof maxForwardForLevel === "function" && typeof isCityLevel === "function",
  "guard uses imported data/pure helpers and does not touch world, production or NPC economy");

console.log(failures === 0 ? "\nALL PROGRESSION GUARD TESTS PASSED" : `\n${failures} PROGRESSION GUARD TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
