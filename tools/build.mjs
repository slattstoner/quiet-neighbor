#!/usr/bin/env node
/**
 * Builds the installable add-on.
 *
 *   node tools/build.mjs            # dist/GrowingVillages-<version>.mcaddon (+ .mcpack)
 *   node tools/build.mjs --check    # say what would ship, build nothing
 *
 * Until now there was no build at all - only a sentence in HANDOVER.md telling
 * the reader to copy two folders and zip them. `.gitignore` already ignored
 * `*.mcaddon`, so the output was clearly intended; there was just nothing to
 * produce it. That is the gap between "the code is right" and "here is a file
 * you can install", and it is the whole point of this script.
 *
 * Three rules it exists to enforce:
 *
 *  - Only the two packs ship. `tests/`, `dist/`, `tools/`, `.git` and every
 *    `.md` are excluded - including GrowingVillages_BP/structures/README.md,
 *    which is tracked on purpose (authors need it) but sits inside the folder
 *    Bedrock scans for structures, so it must not reach a player.
 *  - The version comes from the manifest, never from a flag. A build whose
 *    name disagrees with what it contains is worse than no build.
 *  - It verifies its own output. After writing the archive it reads it back
 *    with an independent implementation (python's zipfile, or unzip) and
 *    compares the file list and both manifests byte-for-byte against source.
 *    A build that quietly shipped the wrong thing is the failure this catches.
 */
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, sep } from "node:path";

const HERE = import.meta.dirname;
const REPO = join(HERE, "..");
const PACKS = ["GrowingVillages_BP", "GrowingVillages_RP"];
const DIST = join(REPO, "dist");

const check = process.argv.includes("--check");

/** Never ships, whatever it is called or wherever it sits. */
function excluded(relPath) {
  const name = relPath.split(sep).pop();
  return /\.md$/i.test(name) ||
         /^\.(DS_Store|gitkeep|gitignore)$/i.test(name) ||
         name === "Thumbs.db" ||
         relPath.split(sep).includes("node_modules");
}

/** Every file under `root`, relative to it. Exclusion is the caller's call. */
function walk(root, prefix = "") {
  const out = [];
  for (const entry of readdirSync(join(root, prefix)).sort()) {
    const rel = prefix ? join(prefix, entry) : entry;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out;
}

function fail(message) {
  console.error(`\nbuild failed: ${message}`);
  process.exit(1);
}

// ---------- 1. version ----------
const manifests = {};
for (const pack of PACKS) {
  const path = join(REPO, pack, "manifest.json");
  if (!existsSync(path)) fail(`${pack}/manifest.json is missing`);
  manifests[pack] = JSON.parse(readFileSync(path, "utf8"));
}

const version = manifests.GrowingVillages_BP.header.version;
const label = version.join(".");

// The manifests must agree before anything is written. tests/pack_integrity.mjs
// checks this too, but a build is exactly the moment it must not be skipped.
for (const pack of PACKS) {
  const header = JSON.stringify(manifests[pack].header.version);
  if (header !== JSON.stringify(version)) {
    fail(`${pack} is version ${header}, but the behaviour pack is ${JSON.stringify(version)}`);
  }
  for (const [index, module] of manifests[pack].modules.entries()) {
    if (JSON.stringify(module.version) !== header) {
      fail(`${pack} modules[${index}] is ${JSON.stringify(module.version)}, header says ${header}`);
    }
  }
}
const rpDependency = manifests.GrowingVillages_BP.dependencies.find((entry) => entry.uuid);
if (JSON.stringify(rpDependency?.version) !== JSON.stringify(version)) {
  fail(`the behaviour pack depends on resource pack ${JSON.stringify(rpDependency?.version)}, not ${JSON.stringify(version)}`);
}

// ---------- 2. contents ----------
const contents = {};
const skipped = [];
let total = 0;
for (const pack of PACKS) {
  const all = walk(join(REPO, pack));
  contents[pack] = all.filter((rel) => !excluded(rel));
  for (const rel of all) if (excluded(rel)) skipped.push(`${pack}/${rel}`);
  total += contents[pack].length;
}

console.log(`Growing Villages ${label}`);
console.log(`engine ${manifests.GrowingVillages_BP.header.min_engine_version.join(".")}, ` +
  manifests.GrowingVillages_BP.dependencies.filter((entry) => entry.module_name)
    .map((entry) => `${entry.module_name} ${entry.version}`).join(", "));
for (const pack of PACKS) console.log(`  ${pack}: ${contents[pack].length} files`);

if (skipped.length) console.log(`  excluded: ${skipped.join(", ")}`);

if (check) {
  console.log(`\n--check: ${total} files would ship as dist/GrowingVillages-${label}.mcaddon`);
  console.log("manifests agree; nothing was written.");
  process.exit(0);
}

// ---------- 3. archive ----------
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

/** Zips an exact list of relative paths, rooted at `cwd`. */
function zipExactly(cwd, relPaths, outFile) {
  const stdin = relPaths.join("\n") + "\n";
  try {
    execFileSync("zip", ["-q", "-X", "-@", outFile], { cwd, input: stdin });
  } catch (error) {
    // No system zip: python's zipfile writes the same archive.
    execFileSync("python3", ["-c", `
import sys, zipfile, os
out, root = sys.argv[1], sys.argv[2]
names = [l for l in sys.stdin.read().split("\\n") if l]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for n in names:
        z.write(os.path.join(root, n), n)
`, outFile, cwd], { input: stdin });
  }
}

const addon = join(DIST, `GrowingVillages-${label}.mcaddon`);
// Both packs sit at the top level of a .mcaddon, each as its own folder.
zipExactly(REPO, PACKS.flatMap((pack) => contents[pack].map((rel) => join(pack, rel))), addon);

// A .mcpack is one pack, so its manifest.json is at the archive root - useful
// for installing the packs separately or by hand.
const mcpacks = {};
for (const pack of PACKS) {
  const short = pack.replace("GrowingVillages_", "").toLowerCase();
  mcpacks[pack] = join(DIST, `GrowingVillages-${label}-${short}.mcpack`);
  zipExactly(join(REPO, pack), contents[pack], mcpacks[pack]);
}

// ---------- 4. verify the archive we just wrote ----------
/** Reads an archive back with whichever independent tool is available. */
function listArchive(file) {
  try {
    return execFileSync("python3", ["-c",
      "import sys,zipfile;print('\\n'.join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))", file],
      { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (error) {
    const text = execFileSync("unzip", ["-Z", "-1", file], { encoding: "utf8" });
    return text.split("\n").filter(Boolean).filter((name) => !name.endsWith("/")).sort();
  }
}

function readFromArchive(file, member) {
  return execFileSync("python3", ["-c",
    "import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))",
    file, member], { encoding: "utf8" });
}

const expected = PACKS.flatMap((pack) => contents[pack].map((rel) => join(pack, rel).split(sep).join("/"))).sort();
const actual = listArchive(addon);

const missing = expected.filter((name) => !actual.includes(name));
const extra = actual.filter((name) => !expected.includes(name));
if (missing.length) fail(`the archive is missing ${missing.length} file(s): ${missing.slice(0, 5).join(", ")}`);
if (extra.length) fail(`the archive carries ${extra.length} file(s) it should not: ${extra.slice(0, 5).join(", ")}`);

// The two files that decide whether Minecraft accepts the pack at all.
for (const pack of PACKS) {
  const inArchive = readFromArchive(addon, `${pack}/manifest.json`);
  const onDisk = readFileSync(join(REPO, pack, "manifest.json"), "utf8");
  if (inArchive !== onDisk) fail(`${pack}/manifest.json in the archive differs from the source`);
}

for (const [pack, file] of Object.entries(mcpacks)) {
  const names = listArchive(file);
  if (!names.includes("manifest.json")) fail(`${file}: a .mcpack must have manifest.json at its root`);
  if (names.length !== contents[pack].length) {
    fail(`${file}: ${names.length} files, expected ${contents[pack].length}`);
  }
}

// Nothing that must never ship may have slipped in.
const forbidden = actual.filter((name) =>
  /\.(md|mjs)$/i.test(name) || name.includes("node_modules") || name.startsWith("tests/") || name.startsWith("tools/"));
if (forbidden.length) fail(`excluded files reached the archive: ${forbidden.join(", ")}`);

const size = (file) => (statSync(file).size / 1024).toFixed(1);
console.log(`\nwrote dist/GrowingVillages-${label}.mcaddon (${size(addon)} KB, ${actual.length} files)`);
for (const file of Object.values(mcpacks)) {
  console.log(`      dist/${relative(DIST, file)} (${size(file)} KB)`);
}
console.log("verified: file list and both manifests match the source.");
console.log("\nInstall: open the .mcaddon on the device (or copy it into Minecraft's");
console.log("import folder), then enable BOTH packs on the world - the behaviour");
console.log("pack and the resource pack.");
console.log("No 'Beta APIs' experiment is required: the docs only demand it for");
console.log("-beta modules, and both modules here are pinned to stable versions.");
