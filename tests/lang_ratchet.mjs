import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

/**
 * A ratchet on hardcoded player-facing text.
 *
 * The mod ships one language and will for a while, so translating the ~400
 * Russian string literals already sitting in the scripts is deliberately not
 * on the plan. But there is a difference between "not translated yet" and
 * "getting worse every release": every new hardcoded string is one more line
 * that a future localisation pass has to find and move, and the cost of that
 * pass grows with the pile.
 *
 * So this suite does not ask for anything to be translated. It only refuses
 * to let the pile grow. New player-facing text goes through a
 * `growing_villages.*` key and the `.lang` files - which the craftsman arcs,
 * the watchman arc and the L16-20 screens already do - even when only
 * `ru_RU.lang` is filled in. Then localisation, whenever it happens, is a
 * translator's job rather than a refactor of two dozen modules.
 *
 * Rules:
 *   - a file may never contain MORE Cyrillic string literals than the
 *     recorded baseline;
 *   - a file with no baseline entry (i.e. a new module) must contain none;
 *   - fewer than the baseline is progress: it passes, with a note to
 *     re-record so the ratchet tightens.
 *
 * Re-record after deliberately removing literals:
 *
 *     node tests/lang_ratchet.mjs --write
 */

const HERE = import.meta.dirname;
const SCRIPTS = `${HERE}/../GrowingVillages_BP/scripts`;
const BASELINE = `${HERE}/lang_baseline.json`;

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * Counts string and template literals containing Cyrillic, skipping comments.
 *
 * Hand-written scanner rather than a regex: a regex over lines cannot tell a
 * quote inside a comment from a real one, and this number has to be stable
 * enough to compare against a committed baseline. A comment that mentions a
 * Russian word - and several do, explaining past fixes - must not count.
 */
export function countLiterals(source) {
  let count = 0;
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    // comments
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // string and template literals
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let body = "";
      i++;
      while (i < n) {
        if (source[i] === "\\") { body += source[i + 1] ?? ""; i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        // A template literal ends a run of plain text at ${; the expression
        // inside is code, not text, so it is skipped rather than scanned.
        if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            i++;
          }
          continue;
        }
        body += source[i];
        i++;
      }
      if (CYRILLIC.test(body)) count++;
      continue;
    }

    i++;
  }
  return count;
}

/** file -> number of Cyrillic literals, for every script that has any. */
export function measureAll() {
  const out = {};
  for (const file of readdirSync(SCRIPTS).filter((f) => f.endsWith(".js")).sort()) {
    const count = countLiterals(readFileSync(`${SCRIPTS}/${file}`, "utf8"));
    if (count > 0) out[file] = count;
  }
  return out;
}

const measured = measureAll();

// ---------- --write: re-record the baseline ----------
if (process.argv.includes("--write")) {
  const total = Object.values(measured).reduce((a, b) => a + b, 0);
  writeFileSync(BASELINE, JSON.stringify(measured, null, 2) + "\n");
  console.log(`recorded ${total} hardcoded literals across ${Object.keys(measured).length} files -> ${BASELINE}`);
  process.exit(0);
}

// ---------- the scanner itself has to work ----------
// Without this, a scanner that always returned 0 would make every check below
// pass and the ratchet would be worthless.
console.log("\n=== the scanner counts what it should and ignores what it should not ===");
{
  assert(countLiterals('const a = "Принеси 32 пшеницы";') === 1, "a plain Russian string counts");
  assert(countLiterals('const a = `Уровень ${level}`;') === 1, "so does a template literal");
  assert(countLiterals('const a = `level ${russianName}`;') === 0,
    "but not one whose only Russian is inside an interpolated expression");
  assert(countLiterals('// Принеси 32 пшеницы') === 0, "a line comment does not count");
  assert(countLiterals('/* Принеси\n * 32 пшеницы\n */') === 0, "nor does a block comment");
  assert(countLiterals('const a = "plain english";') === 0, "an English string does not count");
  assert(countLiterals('const a = "one"; const b = "два"; const c = "три";') === 2,
    "several literals on one line are counted separately");
  assert(countLiterals('const a = "он сказал \\"да\\"";') === 1, "an escaped quote does not end the string early");
  assert(countLiterals('const url = "https://x/y"; // Принеси') === 0,
    "a comment after code still does not count");
}

console.log("\n=== the pile of hardcoded text does not grow ===");
{
  assert(existsSync(BASELINE), `a baseline is recorded (${BASELINE.split("/").pop()})`);
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));

  const measuredTotal = Object.values(measured).reduce((a, b) => a + b, 0);
  const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0);

  let grew = 0, shrank = 0;
  for (const [file, count] of Object.entries(measured)) {
    const allowed = baseline[file];
    if (allowed === undefined) {
      grew++;
      console.error(`  ${file}: new module with ${count} hardcoded literal(s) - use growing_villages.* keys instead`);
      continue;
    }
    if (count > allowed) {
      grew++;
      console.error(`  ${file}: ${count} hardcoded literals, baseline allows ${allowed} (+${count - allowed})`);
    } else if (count < allowed) {
      shrank++;
    }
  }
  assert(grew === 0, `no script added hardcoded player-facing text (${grew} offending file(s))`);

  // Files that disappeared from the measurement entirely are progress too.
  const cleared = Object.keys(baseline).filter((file) => measured[file] === undefined);
  if (shrank > 0 || cleared.length > 0) {
    console.log(`note: ${shrank + cleared.length} file(s) now hold fewer literals ` +
      `(${baselineTotal} -> ${measuredTotal}). Re-record so the ratchet tightens:\n` +
      "      node tests/lang_ratchet.mjs --write");
  }

  assert(measuredTotal <= baselineTotal,
    `the total never rises (${measuredTotal} <= ${baselineTotal})`);
  console.log(`      current: ${measuredTotal} literals in ${Object.keys(measured).length} files`);
}

console.log("\n=== the localisation machinery new text should use is in place ===");
{
  const packRoot = [`${HERE}/..`, `${HERE}/../addon`].find(
    (root) => existsSync(`${root}/GrowingVillages_RP/texts/ru_RU.lang`)) || `${HERE}/..`;
  const langDir = `${packRoot}/GrowingVillages_RP/texts`;
  assert(existsSync(`${langDir}/ru_RU.lang`), "ru_RU.lang exists for new keys to go into");

  const languages = JSON.parse(readFileSync(`${langDir}/languages.json`, "utf8"));
  assert(Array.isArray(languages) && languages.includes("ru_RU"),
    `languages.json lists ru_RU (${languages.join(", ")})`);

  // Every key referenced from a script must exist in ru_RU.lang, or new text
  // routed through a key would render as the raw key on screen - which is a
  // worse failure than a hardcoded string.
  const ru = readFileSync(`${langDir}/ru_RU.lang`, "utf8");
  const defined = new Set(
    ru.split("\n")
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
      .map((line) => line.split("=")[0].trim()));

  const referenced = new Set();
  for (const file of readdirSync(SCRIPTS).filter((f) => f.endsWith(".js"))) {
    const text = readFileSync(`${SCRIPTS}/${file}`, "utf8");
    for (const match of text.matchAll(/["'`](growing_villages\.[A-Za-z0-9_.]+)["'`]/g)) {
      referenced.add(match[1]);
    }
  }
  const missing = [...referenced].filter((key) => !defined.has(key));
  for (const key of missing.slice(0, 10)) console.error(`  missing translation: ${key}`);
  assert(missing.length === 0,
    `every growing_villages.* key a script uses is defined in ru_RU.lang ` +
    `(${referenced.size} referenced, ${missing.length} missing)`);
}

console.log(failures === 0 ? "\nALL LANG RATCHET CHECKS PASSED" : `\n${failures} LANG RATCHET CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
