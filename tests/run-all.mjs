/**
 * Runs the whole suite with one command, from anywhere:
 *
 *   node tests/run-all.mjs            # sync scripts, run every suite
 *   node tests/run-all.mjs lint spat  # only suites whose name contains these
 *
 * It syncs tests/scripts from GrowingVillages_BP/scripts first. That copy is
 * the one every suite imports and is deliberately untracked (.gitignore), so
 * running a suite against a stale copy - testing code you already changed -
 * used to be a silent and very confusing failure mode.
 */
import { cpSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const HERE = import.meta.dirname;
const REPO = `${HERE}/..`;
const SELF = "run-all.mjs";

rmSync(`${HERE}/scripts`, { recursive: true, force: true });
cpSync(`${REPO}/GrowingVillages_BP/scripts`, `${HERE}/scripts`, { recursive: true });
console.log("synced tests/scripts from GrowingVillages_BP/scripts\n");

const filters = process.argv.slice(2);
const suites = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && f !== SELF)
  .filter((f) => !filters.length || filters.some((needle) => f.includes(needle)))
  .sort();

if (!suites.length) {
  console.error(`no suite matches ${filters.join(", ")}`);
  process.exit(1);
}

const failed = [];
for (const suite of suites) {
  const run = spawnSync(process.execPath, [`${HERE}/${suite}`], { encoding: "utf8" });
  const ok = run.status === 0;
  if (!ok) failed.push({ suite, run });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${suite}`);
}

console.log(`\n${suites.length - failed.length}/${suites.length} suites passed`);

for (const { suite, run } of failed) {
  console.log(`\n--- ${suite} ---`);
  const lines = `${run.stdout}${run.stderr}`.split("\n").filter((l) => /FAIL|Error|error/.test(l));
  console.log(lines.slice(0, 15).join("\n") || `exited with status ${run.status}`);
}

process.exit(failed.length ? 1 : 0);
