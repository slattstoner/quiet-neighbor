import { world, system } from "@minecraft/server";
import { readFileSync, readdirSync, existsSync } from "node:fs";

// Resolve everything against THIS file, never the shell's working directory.
// These paths used to be cwd-relative, so the documented `node tests/lint.mjs`
// from the repo root crashed on a missing "./scripts" while the same file
// passed from inside tests/ - a whole lint suite that silently only ran from
// one directory.
const HERE = import.meta.dirname;
const SCRIPTS = `${HERE}/scripts`;

// The packs may sit either beside this folder (source archive layout) or one
// level up in a working checkout, so locate them rather than assuming.
const PACK_ROOT = [`${HERE}/..`, `${HERE}/../addon`].find(
  (root) => existsSync(`${root}/GrowingVillages_BP/manifest.json`)
) || `${HERE}/..`;

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

// ---------- 1. EARLY EXECUTION ----------
// The engine refuses world API calls while a script file is still being
// evaluated. Loading main.js with that restriction switched on reproduces
// exactly the crash reported from the game.
console.log("\n=== early execution safety ===");
{
  world._earlyExecution = true;
  let crashed = null;
  try {
    await import("./scripts/main.js");
  } catch (e) {
    crashed = e;
  }
  world._earlyExecution = false;

  // Work the pack deferred to the first tick must now run cleanly
  let deferredCrash = null;
  try {
    system.flushDeferred();
  } catch (e) {
    deferredCrash = e;
  }
  assert(deferredCrash === null,
    deferredCrash ? `deferred start-up failed: ${deferredCrash.message}` : "deferred start-up runs cleanly on the first tick");

  assert(crashed === null,
    crashed
      ? `main.js must not call world APIs at load time (got: ${crashed.message})`
      : "main.js loads without touching world APIs during early execution");

  // Deferred start-up work should have been queued, not skipped
  assert(system._intervals.length > 0,
    `background loops are still registered after deferred start-up (${system._intervals.length})`);
}

// ---------- 2. NO TOP-LEVEL WORLD CALLS ANYWHERE ----------
console.log("\n=== no module-scope world calls ===");
{
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".js"));
  const FORBIDDEN = /^\s*world\.(sendMessage|getPlayers|getDimension|getAllPlayers|getTimeOfDay|getAbsoluteTime)\s*\(/;
  let offenders = 0;
  for (const file of files) {
    const lines = readFileSync(`${SCRIPTS}/${file}`, "utf8").split("\n");
    for (const [i, line] of lines.entries()) {
      // module scope = no leading indentation
      if (FORBIDDEN.test(line) && !line.startsWith(" ") && !line.startsWith("\t")) {
        offenders++;
        console.error(`  ${file}:${i + 1}  ${line.trim()}`);
      }
    }
  }
  assert(offenders === 0, `no script calls a world API at module scope (${offenders} found)`);
}

// ---------- 3. ITEM JSON SCHEMA ----------
console.log("\n=== item definitions ===");
{
  const dir = `${PACK_ROOT}/GrowingVillages_BP/items`;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert(files.length > 0, `item definitions exist (${files.length})`);

  for (const file of files) {
    const json = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
    const item = json["minecraft:item"];
    assert(!!item, `${file}: has a minecraft:item block`);
    const components = item.components || {};

    // "texture" inside minecraft:icon is deprecated and logs a schema
    // warning in-game; the current form is a plain shortname string.
    const icon = components["minecraft:icon"];
    assert(icon !== undefined, `${file}: declares an icon`);
    assert(typeof icon === "string" || (icon && icon.textures),
      `${file}: icon uses the current schema, not the deprecated {texture:...} form`);

    // Icon shortname must actually be defined in the resource pack
    if (typeof icon === "string") {
      const texJson = JSON.parse(readFileSync(`${PACK_ROOT}/GrowingVillages_RP/textures/item_texture.json`, "utf8"));
      assert(icon in texJson.texture_data,
        `${file}: icon shortname "${icon}" is defined in item_texture.json`);
      const texPath = texJson.texture_data[icon].textures;
      const rel = `${PACK_ROOT}/GrowingVillages_RP/${texPath}.png`;
      let exists = true;
      try { readFileSync(rel); } catch (e) { exists = false; }
      assert(exists, `${file}: texture file ${texPath}.png exists in the resource pack`);
    }

    assert(!!item.description?.identifier, `${file}: has an identifier`);
    assert(!!item.description?.menu_category, `${file}: appears in a creative menu category`);
  }
}

// ---------- 4. MANIFEST SANITY ----------
console.log("\n=== manifests ===");
{
  const bp = JSON.parse(readFileSync(`${PACK_ROOT}/GrowingVillages_BP/manifest.json`, "utf8"));
  const rp = JSON.parse(readFileSync(`${PACK_ROOT}/GrowingVillages_RP/manifest.json`, "utf8"));

  const uuids = new Set();
  for (const m of [bp, rp]) {
    uuids.add(m.header.uuid);
    for (const mod of m.modules) uuids.add(mod.uuid);
  }
  assert(uuids.size === 5, `all pack/module UUIDs are distinct (${uuids.size}/5)`);

  const dep = bp.dependencies.find((d) => d.uuid);
  assert(dep && dep.uuid === rp.header.uuid, "behaviour pack depends on the matching resource pack");
  assert(JSON.stringify(dep.version) === JSON.stringify(rp.header.version),
    `dependency version matches the resource pack version (${JSON.stringify(dep.version)} vs ${JSON.stringify(rp.header.version)})`);

  const scriptMod = bp.modules.find((m) => m.type === "script");
  assert(!!scriptMod, "behaviour pack declares a script module");
  assert(scriptMod.entry === "scripts/main.js", `script entry points at main.js (${scriptMod.entry})`);

  // Every script module dependency must be a real, non-beta version string
  for (const d of bp.dependencies.filter((x) => x.module_name)) {
    assert(!/beta/i.test(d.version), `${d.module_name} uses a stable version (${d.version})`);
  }
}

// ---------- 5. RAWTEXT with-ARRAY SHAPE ----------
// Bedrock's native RawMessage.with accepts a string[] or a single RawMessage
// (an object with a rawtext array) - never an array containing raw-message
// objects (e.g. [{ text: ... }, { translate: ... }]). That mistake type-checks
// fine in plain JS and in this mock, so it only ever throws on-device
// ("Native variant type conversion failed") - exactly what broke every
// craftsman's active-quest menu (ui.js:370, found live on iPhone against
// the farmer). Scan every script for the broken call shape directly, since
// no functional test using the JS mock can catch a native-only type error.
console.log("\n=== rawtext with-array shape ===");
{
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".js"));
  // A translated()-style call whose second argument is an array literal
  // that itself opens with an object literal - the broken shape.
  const BROKEN_WITH_ARRAY = /\w+\([^,()]*,\s*\[\s*\{/;
  let offenders = 0;
  for (const file of files) {
    const text = readFileSync(`${SCRIPTS}/${file}`, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (BROKEN_WITH_ARRAY.test(line)) {
        offenders++;
        console.error(`  ${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  assert(offenders === 0, `no rawtext-producing call passes an array of objects as its with-argument (${offenders} found)`);
}

// ---------- 6. NON-EXISTENT BLOCK IDENTIFIERS ----------
// Bedrock rejects unknown block ids, but every placement path in util.js wraps
// setType/setPermutation in a try/catch so one bad coordinate can't abort a
// whole build. The side effect is that a WRONG ID fails completely silently:
// no crash, no log line, just missing geometry the player has to notice and
// screenshot. That is how `cobblestone_stairs` (holey miner's roof) shipped,
// and how `oak_fence_gate`, `oak_pressure_plate`, `stonecutter` and `bricks`
// survived three bugfix rounds.
//
// A functional test can't catch this - the swallowing catch eats the mock's
// throw too. So scan the source text directly. Every id below was confirmed
// ABSENT from the official Block enum at
// learn.microsoft.com/minecraft/creator/commands/enums/block (stable).
console.log("\n=== non-existent block identifiers ===");
{
  const WRONG_BLOCK_IDS = {
    "minecraft:cobblestone_stairs": "minecraft:stone_stairs",
    "minecraft:oak_fence_gate": "minecraft:fence_gate",
    "minecraft:oak_pressure_plate": "minecraft:wooden_pressure_plate",
    "minecraft:oak_standing_sign": "minecraft:standing_sign",
    "minecraft:stonecutter": "minecraft:stonecutter_block",
    "minecraft:bricks": "minecraft:brick_block",
    "minecraft:terracotta": "minecraft:hardened_clay",
    "minecraft:oak_door": "minecraft:wooden_door",
    "minecraft:stone_slab": "minecraft:smooth_stone_slab"
  };
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".js"));
  let offenders = 0;
  for (const file of files) {
    const text = readFileSync(`${SCRIPTS}/${file}`, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      // Comments explaining a past fix legitimately name the dead id.
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      for (const [bad, good] of Object.entries(WRONG_BLOCK_IDS)) {
        // Exact id match: "minecraft:bricks" must not match "minecraft:brick_block",
        // and "minecraft:stonecutter" must not match "minecraft:stonecutter_block".
        if (new RegExp(`"${bad}"`).test(line)) {
          offenders++;
          console.error(`  ${file}:${i + 1}: ${bad} does not exist - use ${good}`);
        }
      }
    }
  }
  assert(offenders === 0, `no script places a block using a non-existent identifier (${offenders} found)`);
}

// ---------- 7. NON-EXISTENT ITEM IDENTIFIERS ----------
// The item equivalent of the block scan above, and it exists for the same
// reason: quest requirements are only ever *compared* against inventory
// contents, never constructed, so a bad item id produces no error at all -
// just a quest step whose requirement can never be satisfied. That is how
// `minecraft:map` sat in the cartographer's final step and in the ranger
// arc: Bedrock has `empty_map` and `filled_map`, and no plain `map`, so
// those two steps were quietly impossible to hand in.
//
// Every id below was confirmed ABSENT from the official item listing at
// learn.microsoft.com/minecraft/creator/reference/content/vanillalistingsreference/items.
console.log("\n=== non-existent item identifiers ===");
{
  const WRONG_ITEM_IDS = {
    "minecraft:map": "minecraft:empty_map"
  };
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".js"));
  let offenders = 0;
  for (const file of files) {
    const text = readFileSync(`${SCRIPTS}/${file}`, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      // A comment explaining the past fix legitimately names the dead id.
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      for (const [bad, good] of Object.entries(WRONG_ITEM_IDS)) {
        if (new RegExp(`"${bad}"`).test(line)) {
          offenders++;
          console.error(`  ${file}:${i + 1}: ${bad} does not exist - use ${good}`);
        }
      }
    }
  }
  assert(offenders === 0, `no script references an item using a non-existent identifier (${offenders} found)`);
}

console.log(failures === 0 ? "\nALL LINT CHECKS PASSED" : `\n${failures} LINT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
