import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { world, system } from "@minecraft/server";

/**
 * Is this pack whole, and does it tell the truth about itself?
 *
 * Every other suite asks whether some piece of the mod behaves. This one asks
 * whether the thing we would hand a player is internally consistent: that its
 * modules all resolve, that its start-up actually starts everything, that its
 * recipes name real items, and that its manifest does not claim a version or
 * an engine it cannot deliver.
 *
 * It exists because HANDOVER.md used to ask a human to "re-check the manifest
 * by eye", and because two silent failures got past sixty suites:
 *
 *  - the pack version stayed at 0.11.0 while three features landed on top of
 *    it, so a bug report could not be tied to a build;
 *  - the manifest declared `@minecraft/server 2.0.0`, but `Potions` (the
 *    alchemist's healing and night-vision bottles) only exists from 2.4.0 and
 *    `Dimension.getBiome` only from 2.3.0. Both are wrapped in try/catch, as
 *    everything here is, so on a real device the alchemist simply had nothing
 *    to sell and every village came out in plains oak - with no error anywhere.
 *
 * That second one is the reason for the API-availability section below, and it
 * is the check with the most teeth: a script may only use an API that exists in
 * the module version the manifest asks for. Every version in that table was
 * read off the official changelog, never guessed:
 * learn.microsoft.com/minecraft/creator/scriptapi/minecraft/server/changelog
 *
 * Deliberately NOT duplicated here: item JSON schema, module-scope world calls
 * and the bad-block/bad-item id denylists (tests/lint.mjs), and ru/en key
 * mirroring (tests/localization_quests.mjs).
 */

const HERE = import.meta.dirname;
const REPO = `${HERE}/..`;
const BP = `${REPO}/GrowingVillages_BP`;
const RP = `${REPO}/GrowingVillages_RP`;
const SCRIPTS = `${HERE}/scripts`;

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".js")).sort();
const source = new Map(files.map((f) => [f, readFileSync(`${SCRIPTS}/${f}`, "utf8")]));

/** Engine modules, as opposed to files inside this pack. */
const ENGINE_MODULES = new Set(["@minecraft/server", "@minecraft/server-ui"]);

/**
 * Every `import ... from "x"` and `export ... from "x"` in one file.
 *
 * Parsed from the text rather than by importing: a module that happens never to
 * be executed by any suite would otherwise go unchecked, which is exactly the
 * blind spot we are trying to close.
 */
function edgesOf(text) {
  const out = [];
  const re = /^[ \t]*(import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/gm;
  let match;
  while ((match = re.exec(text))) {
    const clause = match[2].trim();
    let names = null;                       // null: default or namespace import
    if (clause.startsWith("{")) {
      names = clause.replace(/^\{|\}$/g, "").split(",")
        .map((part) => part.trim()).filter(Boolean)
        .map((part) => part.split(/\s+as\s+/)[0].trim());
    }
    out.push({ kind: match[1], specifier: match[3], names });
  }
  return out;
}

/** Every name a module exports, including re-exports and generators. */
function exportsOf(text) {
  const names = new Set();
  const declaration = /^export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let match;
  while ((match = declaration.exec(text))) names.add(match[1]);
  const list = /^export\s*\{([^}]*)\}/gm;
  while ((match = list.exec(text))) {
    for (const part of match[1].split(",").map((p) => p.trim()).filter(Boolean)) {
      const bits = part.split(/\s+as\s+/);
      names.add((bits[1] || bits[0]).trim());
    }
  }
  return names;
}

const edges = new Map(files.map((f) => [f, edgesOf(source.get(f))]));
const exported = new Map(files.map((f) => [f, exportsOf(source.get(f))]));

// ---------- 1. граф модулей ----------
console.log("\n=== every import resolves, and every imported name is really exported ===");
{
  // Sanity check on the parser itself: if the regex silently stopped matching,
  // every assertion below would pass vacuously.
  let declaredImports = 0;
  for (const text of source.values()) declaredImports += (text.match(/^[ \t]*import\s/gm) || []).length;
  const parsedImports = [...edges.values()].flat().filter((edge) => edge.kind === "import").length;
  assert(parsedImports === declaredImports,
    `the import parser sees every import statement (${parsedImports} of ${declaredImports})`);
  assert(parsedImports > 60, `and there are imports to check at all (${parsedImports})`);

  let bad = 0;
  for (const file of files) {
    for (const edge of edges.get(file)) {
      if (ENGINE_MODULES.has(edge.specifier)) continue;
      if (!edge.specifier.startsWith("./")) {
        bad++; console.error(`  ${file}: "${edge.specifier}" is neither an engine module nor a local file`);
        continue;
      }
      const target = edge.specifier.slice(2);
      if (!source.has(target)) {
        bad++; console.error(`  ${file}: imports "${edge.specifier}", which does not exist`);
        continue;
      }
      for (const name of edge.names || []) {
        if (!exported.get(target).has(name)) {
          bad++; console.error(`  ${file}: imports { ${name} } from ${edge.specifier}, which does not export it`);
        }
      }
    }
  }
  assert(bad === 0, `no dangling import or missing export (${bad} found)`);
}

console.log("\n=== the module graph has no cycles ===");
{
  // village_state.js exists precisely to break one: eighteen modules read elder
  // state through it rather than importing village.js back. A cycle here is a
  // regression against a deliberate decision, not a stylistic nit.
  const local = (file) => edges.get(file).map((edge) => edge.specifier)
    .filter((specifier) => specifier.startsWith("./")).map((specifier) => specifier.slice(2))
    .filter((target) => source.has(target));

  const state = new Map();
  const cycles = [];
  function walk(file, path) {
    if (state.get(file) === "done") return;
    if (state.get(file) === "open") { cycles.push([...path.slice(path.indexOf(file)), file].join(" -> ")); return; }
    state.set(file, "open");
    for (const next of local(file)) walk(next, [...path, file]);
    state.set(file, "done");
  }
  for (const file of files) walk(file, []);
  for (const cycle of cycles) console.error(`  cycle: ${cycle}`);
  assert(cycles.length === 0, `the import graph is acyclic (${cycles.length} cycles)`);
}

console.log("\n=== every module is reachable from main.js ===");
{
  const seen = new Set(["main.js"]);
  const queue = ["main.js"];
  while (queue.length) {
    for (const edge of edges.get(queue.pop())) {
      if (!edge.specifier.startsWith("./")) continue;
      const target = edge.specifier.slice(2);
      if (source.has(target) && !seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  const orphans = files.filter((file) => !seen.has(file));
  for (const orphan of orphans) console.error(`  ${orphan} is never imported from main.js`);
  assert(orphans.length === 0,
    `all ${files.length} modules hang off the entry point (${orphans.length} orphaned)`);
}

// ---------- 2. запуск ----------
console.log("\n=== start-up registers every background loop it claims to ===");
{
  // lint.mjs only asserts that _some_ interval registered. The failure this
  // catches is adding a start*() to main.js whose body never registers
  // anything - a loop that looks wired up and silently never runs.
  const main = source.get("main.js");
  const started = new Set((main.match(/\bstart[A-Z]\w*\(\)/g) || []).map((call) => call.slice(0, -2)));
  assert(started.size >= 10, `main.js starts a plausible number of subsystems (${started.size})`);

  world._earlyExecution = true;
  await import("./scripts/main.js");
  world._earlyExecution = false;
  system.flushDeferred();

  // Nine of them register a tick interval; startOnboarding instead subscribes
  // to playerSpawn. Measured, not assumed - claiming "ten intervals" would be
  // wrong and would have to be weakened the first time it was run.
  const intervals = system._intervals.length;
  const spawnHandlers = world.afterEvents.playerSpawn._handlers.length;
  assert(spawnHandlers === 1, `onboarding subscribed to playerSpawn (${spawnHandlers})`);
  assert(intervals + spawnHandlers === started.size,
    `each of the ${started.size} start*() calls registered exactly one thing (${intervals} intervals + ${spawnHandlers} subscription)`);
}

// ---------- 3. рецепты ----------
console.log("\n=== recipes name real items and gate nothing behind themselves ===");
{
  const itemFiles = readdirSync(`${BP}/items`).filter((f) => f.endsWith(".json"));
  const declared = new Set(itemFiles.map((file) =>
    JSON.parse(readFileSync(`${BP}/items/${file}`, "utf8"))["minecraft:item"].description.identifier));

  const recipeFiles = readdirSync(`${BP}/recipes`).filter((f) => f.endsWith(".json"));
  assert(recipeFiles.length > 0, `there are recipes to check (${recipeFiles.length})`);

  // Confirmed present in the official item listing at
  // learn.microsoft.com/minecraft/creator/reference/content/vanillalistingsreference/items
  const KNOWN_VANILLA = new Set([
    "minecraft:gold_ingot", "minecraft:iron_ingot", "minecraft:book", "minecraft:lantern",
    "minecraft:paper", "minecraft:compass", "minecraft:emerald", "minecraft:diamond",
    "minecraft:stick", "minecraft:copper_ingot"
  ]);

  const results = new Set();
  for (const file of recipeFiles) {
    const recipe = JSON.parse(readFileSync(`${BP}/recipes/${file}`, "utf8"));
    const shaped = recipe["minecraft:recipe_shaped"] || recipe["minecraft:recipe_shapeless"];
    assert(!!shaped, `${file}: is a shaped or shapeless recipe`);
    if (!shaped) continue;

    assert(typeof shaped.description?.identifier === "string",
      `${file}: has a description identifier`);
    assert(declared.has(shaped.result.item),
      `${file}: its result "${shaped.result.item}" is an item this pack declares`);
    results.add(shaped.result.item);

    const ingredients = new Set();
    if (shaped.pattern) {
      // Counted from the pattern, so a key entry nothing references and a
      // pattern letter nothing defines are both caught.
      for (const cell of new Set(shaped.pattern.join("").replace(/ /g, ""))) {
        const item = shaped.key?.[cell]?.item;
        assert(!!item, `${file}: pattern letter "${cell}" is defined in the key`);
        if (item) ingredients.add(item);
      }
      const unused = Object.keys(shaped.key || {}).filter((letter) => !shaped.pattern.join("").includes(letter));
      assert(unused.length === 0, `${file}: every key entry is used by the pattern (${unused.join(", ") || "all used"})`);
    }
    for (const item of shaped.ingredients || []) ingredients.add(item.item);

    for (const item of ingredients) {
      // An ingredient this pack itself only hands out would gate the recipe
      // behind the content it unlocks; a bad vanilla id makes the recipe
      // silently never appear in the book, with no error anywhere.
      assert(!declared.has(item) || item === shaped.result.item,
        `${file}: ingredient ${item} is not a reward this mod gates behind itself`);
      assert(KNOWN_VANILLA.has(item), `${file}: ingredient ${item} is a verified vanilla item id`);
    }
  }

  // The ten level-test bells found a village instantly at level N. A recipe for
  // one would let a player skip the entire progression.
  const testBells = [...declared].filter((id) => /oracle_bell_level_\d+$/.test(id));
  assert(testBells.length === 10, `all ten level-test bells exist (${testBells.length})`);
  for (const bell of testBells) assert(!results.has(bell), `${bell} has no recipe`);

  // Having no recipe is not enough. These ten found a village instantly at
  // level N, they all reuse the real bell's icon, and they sat in the same
  // creative category as it - so the creative menu showed eleven identical
  // bells, ten of which skip the entire progression. "category": "none" is the
  // documented way to keep an item out of the creative inventory while /give
  // still works, which is exactly what a developer tool wants.
  for (const file of itemFiles) {
    const item = JSON.parse(readFileSync(`${BP}/items/${file}`, "utf8"))["minecraft:item"];
    const id = item.description.identifier;
    const category = item.description.menu_category?.category;
    assert(!!category, `${file}: declares a creative category`);
    if (/oracle_bell_level_\d+$/.test(id)) {
      assert(category === "none",
        `${id} is hidden from the creative inventory (category "${category}")`);
    } else {
      assert(category !== "none", `${id} is something a player can actually find (${category})`);
    }
  }
}

// ---------- 4. манифесты ----------
const bp = JSON.parse(readFileSync(`${BP}/manifest.json`, "utf8"));
const rp = JSON.parse(readFileSync(`${RP}/manifest.json`, "utf8"));

console.log("\n=== the manifests agree with each other ===");
{
  for (const [label, manifest] of [["BP", bp], ["RP", rp]]) {
    const header = JSON.stringify(manifest.header.version);
    for (const [index, module] of manifest.modules.entries()) {
      assert(JSON.stringify(module.version) === header,
        `${label}: modules[${index}] carries the header version (${JSON.stringify(module.version)} vs ${header})`);
    }
    assert(Array.isArray(manifest.header.min_engine_version) && manifest.header.min_engine_version.length === 3,
      `${label}: declares a min_engine_version (${JSON.stringify(manifest.header.min_engine_version)})`);
  }
  assert(JSON.stringify(bp.header.min_engine_version) === JSON.stringify(rp.header.min_engine_version),
    `both packs require the same engine (${JSON.stringify(bp.header.min_engine_version)})`);

  const dependency = bp.dependencies.find((entry) => entry.uuid);
  assert(JSON.stringify(dependency.version) === JSON.stringify(rp.header.version),
    `the BP's dependency on the RP matches the RP's own version (${JSON.stringify(dependency.version)})`);

  const script = bp.modules.find((module) => module.type === "script");
  assert(existsSync(`${BP}/${script.entry}`), `the script entry "${script.entry}" exists on disk`);

  // A bump that forgot the description leaves the pack describing an older
  // release in the one place a player actually reads.
  assert(bp.header.description.includes(bp.header.version.join(".")),
    `the BP description names its own version (${bp.header.version.join(".")})`);

  // Declaring a module the scripts never import, or importing one the manifest
  // never declares, both end in a runtime that is missing something.
  const declaredModules = new Set(bp.dependencies.filter((entry) => entry.module_name).map((entry) => entry.module_name));
  const usedModules = new Set([...edges.values()].flat()
    .map((edge) => edge.specifier).filter((specifier) => ENGINE_MODULES.has(specifier)));
  for (const module of usedModules) assert(declaredModules.has(module), `${module} is imported and declared`);
  for (const module of declaredModules) assert(usedModules.has(module), `${module} is declared and actually imported`);
}

console.log("\n=== every Script API used exists in the declared module version ===");
{
  /**
   * API -> the @minecraft/server version that first shipped it, each read off
   * the official changelog rather than remembered. This is the check that the
   * Potions bug needed: the manifest asked for 2.0.0, the alchemist called
   * Potions.resolve (2.4.0), and the try/catch around it turned a hard failure
   * into a shop with nothing in it.
   */
  const REQUIRES = [
    { pattern: /\bPotions\b/, api: "Potions", since: [2, 4, 0] },
    { pattern: /\.getBiome\s*\(/, api: "Dimension.getBiome", since: [2, 3, 0] },
    { pattern: /\.locatorBar\b/, api: "Player.locatorBar", since: [2, 8, 0] },
    { pattern: /\bLocationWaypoint\b/, api: "LocationWaypoint", since: [2, 8, 0] },
    { pattern: /\bWaypointTexture\b/, api: "WaypointTexture", since: [2, 8, 0] },
    { pattern: /\.structureManager\b/, api: "World.structureManager", since: [1, 10, 0] },
    { pattern: /\.runJob\s*\(/, api: "System.runJob", since: [1, 12, 0] },
    { pattern: /\.getTopmostBlock\s*\(/, api: "Dimension.getTopmostBlock", since: [1, 13, 0] }
  ];

  /** `watchdogTerminate` is beta-only in the 2.x line, so it must stay guarded. */
  const BETA_ONLY = [{ pattern: /\.watchdogTerminate\b/, api: "SystemBeforeEvents.watchdogTerminate" }];

  const declared = bp.dependencies.find((entry) => entry.module_name === "@minecraft/server").version;
  assert(!/beta|internal|rc/i.test(declared), `@minecraft/server is pinned to a stable version (${declared})`);
  const have = declared.split(".").map(Number);
  const atLeast = (need) => {
    for (let i = 0; i < 3; i++) {
      if ((have[i] || 0) > (need[i] || 0)) return true;
      if ((have[i] || 0) < (need[i] || 0)) return false;
    }
    return true;
  };

  const code = (file) => source.get(file).split("\n")
    .map((line, index) => ({ line, index }))
    // A comment explaining a past decision may legitimately name an API.
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));

  for (const { pattern, api, since } of REQUIRES) {
    const users = files.filter((file) => code(file).some(({ line }) => pattern.test(line)));
    if (users.length === 0) continue;
    assert(atLeast(since),
      `${api} needs @minecraft/server ${since.join(".")} and the manifest asks for ${declared} (used by ${users.join(", ")})`);
  }

  for (const { pattern, api } of BETA_ONLY) {
    for (const file of files) {
      for (const { line, index } of code(file)) {
        if (!pattern.test(line)) continue;
        const before = source.get(file).split("\n").slice(Math.max(0, index - 6), index).join("\n");
        assert(/\btry\s*\{/.test(before),
          `${file}:${index + 1}: ${api} is beta-only in 2.x, so it stays inside a try/catch`);
      }
    }
  }
}

console.log("\n=== the pack does not sit on top of an already-released version ===");
{
  // The rule: content must not change after its version has been written up as
  // shipped. Once RELEASE_NOTES_<version>.md exists, that version is spent and
  // the next content change needs a bump. Before it exists, the version is in
  // progress and this check stands down rather than nagging mid-feature.
  const version = bp.header.version.join(".");
  const notes = `RELEASE_NOTES_${version}.md`;

  const git = (args) => {
    try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim(); }
    catch (error) { return null; }
  };
  const inGit = git(["rev-parse", "--is-inside-work-tree"]) === "true";

  if (!inGit) {
    console.log("ok: not a git checkout, so there is no history to compare against");
  } else if (!existsSync(`${REPO}/${notes}`)) {
    console.log(`ok: ${version} has no release notes yet - a version in progress, nothing to check`);
  } else {
    const commit = git(["log", "-1", "--format=%H", "--", notes]);
    const changed = commit ? (git(["diff", "--name-only", `${commit}..HEAD`, "--",
      "GrowingVillages_BP", "GrowingVillages_RP"]) || "") : "";
    const drifted = changed.split("\n").filter(Boolean);
    for (const file of drifted) console.error(`  ${file} changed after ${notes} shipped`);
    assert(drifted.length === 0, drifted.length === 0
      ? `nothing landed on top of the released ${version}`
      : `${drifted.length} file(s) changed after ${version} shipped - bump the version`);
  }
}

// ---------- 5. что попадёт в архив ----------
console.log("\n=== everything the packs need is tracked, and nothing else is in them ===");
{
  const git = (args) => {
    try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim(); }
    catch (error) { return null; }
  };
  const tracked = git(["ls-files", "GrowingVillages_BP", "GrowingVillages_RP"]);

  if (tracked === null) {
    console.log("ok: no git available, skipping the tracking check");
  } else {
    const known = new Set(tracked.split("\n").filter(Boolean));
    // Two ways a pack file fails to reach a player, worth separating because
    // the second one is invisible: not added yet (git status shows it), or
    // matched by .gitignore (nothing shows it, ever).
    const untracked = (git(["ls-files", "--others", "--exclude-standard",
      "GrowingVillages_BP", "GrowingVillages_RP"]) || "").split("\n").filter(Boolean);
    for (const file of untracked) console.error(`  ${file}: inside a pack but never added to git`);
    assert(untracked.length === 0, `every pack file is added to git (${untracked.length} missing)`);

    const ignored = (git(["ls-files", "--others", "--ignored", "--exclude-standard",
      "GrowingVillages_BP", "GrowingVillages_RP"]) || "").split("\n").filter(Boolean);
    for (const file of ignored) console.error(`  ${file}: inside a pack but matched by .gitignore`);
    assert(ignored.length === 0, `no pack file is silently gitignored (${ignored.length})`);

    // The structures folder documents itself, and that README must not ship to
    // players inside the behaviour pack - the build script excludes it, and
    // this is the assertion that keeps the exclusion honest.
    assert(known.has("GrowingVillages_BP/structures/README.md"),
      "the structure authoring guide is tracked");

    // Git cannot carry an empty directory, so the path the guide tells authors
    // to export into has to be pinned by a file or it vanishes on clone.
    const structurePaths = [...known].filter((file) => file.startsWith("GrowingVillages_BP/structures/"));
    assert(structurePaths.some((file) => file.includes("/gv/buildings/")),
      `the .mcstructure output path survives a clone (${structurePaths.length} tracked under structures/)`);

    // Junk that would ship to a player if the build script's exclusions ever
    // stopped matching: test files, dependency trees, editor leftovers.
    const junk = [...known].filter((file) =>
      /\.mjs$/.test(file) || file.includes("node_modules") || /\.(log|orig|rej|bak)$/.test(file));
    for (const file of junk) console.error(`  ${file}: does not belong inside a pack`);
    assert(junk.length === 0, `neither pack carries test or build junk (${known.size} files checked)`);
  }
}

console.log(failures === 0 ? "\nALL PACK INTEGRITY CHECKS PASSED" : `\n${failures} PACK INTEGRITY CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
