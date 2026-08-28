import { __test__ } from "@minecraft/server";
import { foundVillageAtLevel, getVillageState } from "./scripts/village.js";
import { candidateForCell } from "./scripts/worldgen.js";
import { MAX_BETA_LEVEL } from "./scripts/levels.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

console.log("\n=== level comparison bells ===");
for (let level = 1; level <= MAX_BETA_LEVEL; level++) {
  const player = __test__.makePlayer(`BellTester${level}`, { x: level * 1000, y: 70, z: level * 1000 });
  try {
    const elder = foundVillageAtLevel(player, { x: level * 1000, y: 70, z: level * 1000 }, level % 4, level);
    const state = getVillageState(elder);
    assert(state.level === level, `level bell ${level} creates a level-${level} village`);
    assert(state.chest && Number.isFinite(state.chest.x), `level bell ${level} keeps a valid town hall chest`);
  } catch (e) {
    assert(false, `level bell ${level} failed: ${e.stack || e.message}`);
  }
}

console.log("\n=== exploration candidates ===");
const a = candidateForCell(12, -4);
const b = candidateForCell(12, -4);
assert(JSON.stringify(a) === JSON.stringify(b), "same exploration cell always has the same candidate");
assert(a.x >= 12 * 512 + 96 && a.x < 12 * 512 + 416, "candidate stays inside its cell on X");
assert(a.z >= -4 * 512 + 96 && a.z < -4 * 512 + 416, "candidate stays inside its cell on Z");
assert(Number.isInteger(a.facing) && a.facing >= 0 && a.facing < 4, "candidate has a stable cardinal village orientation");

console.log(failures === 0 ? "\nALL BELL TESTS PASSED" : `\n${failures} BELL TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
