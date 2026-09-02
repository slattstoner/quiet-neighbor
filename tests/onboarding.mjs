import { __test__, world } from "@minecraft/server";
import { readFileSync, readdirSync } from "node:fs";
import { startOnboarding, greet, needsGreeting, welcomeMessage, ONBOARDING_KEYS } from "./scripts/onboarding.js";

/**
 * The first sixty seconds: the mod has to be findable and startable.
 *
 * Two gaps, both of which made the mod effectively unplayable in survival and
 * undemonstrable on video:
 *
 *  - the Oracle Bell that founds a village had no crafting recipe at all, so
 *    the only way to meet a village was to wander until worldgen made one;
 *  - nothing ever told a new player the mod was installed.
 *
 * The recipe cannot require `minecraft:bell`, which is the obvious-looking
 * ingredient: bells are not craftable in vanilla survival and are found only
 * in villages, so a bell in the recipe would mean "find a village to found a
 * village". This suite pins that, along with the once-only greeting - greeting
 * twice on every respawn would be worse than not greeting at all.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

const HERE = import.meta.dirname;
const PACK = `${HERE}/..`;

// ---------- 1. рецепт ----------
console.log("\n=== the Oracle Bell can be crafted in survival ===");
{
  const recipe = JSON.parse(readFileSync(`${PACK}/GrowingVillages_BP/recipes/oracle_bell.json`, "utf8"));
  const shaped = recipe["minecraft:recipe_shaped"];
  assert(!!shaped, "there is a shaped recipe for the bell");
  assert(shaped.description.identifier === "village:oracle_bell",
    `it identifies itself as the bell (${shaped.description.identifier})`);
  assert(shaped.result.item === "village:oracle_bell" && shaped.result.count === 1,
    "and produces exactly one bell");
  assert(shaped.tags.includes("crafting_table"), "on an ordinary crafting table");

  const used = Object.values(shaped.key).map((entry) => entry.item);
  // The trap: minecraft:bell is village-loot only in vanilla survival, so a
  // bell in the recipe would make founding a village require finding one.
  assert(!used.includes("minecraft:bell"),
    `the recipe does not require an uncraftable bell (${used.join(", ")})`);

  // Nothing in the recipe may be a reward the mod itself hands out, or the
  // bell would be gated behind the village it exists to create.
  const modItems = new Set(["village:oracle_bell", "village:survey_charter"]);
  assert(used.every((item) => !modItems.has(item)), "nor any item the mod only gives out itself");

  // Every ingredient has to be a real id: a typo here is a recipe that simply
  // never appears in the book, with no error anywhere.
  const known = new Set([
    "minecraft:gold_ingot", "minecraft:iron_ingot", "minecraft:book", "minecraft:lantern",
    "minecraft:paper", "minecraft:compass", "minecraft:emerald", "minecraft:diamond"
  ]);
  for (const item of used) assert(known.has(item), `ingredient ${item} is a real vanilla item id`);

  // Expensive enough to be a commitment, cheap enough to reach without a
  // village. Counted from the pattern rather than trusted from the key list.
  const counts = {};
  for (const cell of shaped.pattern.join("").split("")) {
    if (cell === " ") continue;
    const item = shaped.key[cell]?.item;
    assert(!!item, `pattern letter "${cell}" is defined in the key`);
    counts[item] = (counts[item] || 0) + 1;
  }
  assert(counts["minecraft:gold_ingot"] >= 3,
    `the bell costs real gold (${counts["minecraft:gold_ingot"]} ingots)`);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert(total >= 6 && total <= 9, `and fills most of the grid (${total} of 9 cells)`);

  // No diamonds: the mod's standing rule is that it never touches the
  // player's diamond economy.
  assert(!used.includes("minecraft:diamond"), "and never asks for diamonds");
}

console.log("\n=== every craftable mod item has a recipe, and every recipe a real item ===");
{
  const itemFiles = readdirSync(`${PACK}/GrowingVillages_BP/items`).filter((f) => f.endsWith(".json"));
  const recipeFiles = readdirSync(`${PACK}/GrowingVillages_BP/recipes`).filter((f) => f.endsWith(".json"));

  const declaredItems = new Set(itemFiles.map((file) =>
    JSON.parse(readFileSync(`${PACK}/GrowingVillages_BP/items/${file}`, "utf8"))["minecraft:item"].description.identifier));

  for (const file of recipeFiles) {
    const recipe = JSON.parse(readFileSync(`${PACK}/GrowingVillages_BP/recipes/${file}`, "utf8"));
    const shaped = recipe["minecraft:recipe_shaped"] || recipe["minecraft:recipe_shapeless"];
    assert(declaredItems.has(shaped.result.item),
      `${file}: its result "${shaped.result.item}" is an item this pack declares`);
  }

  // The ten level-test bells are a developer tool and must stay creative-only:
  // a recipe for one would let a player skip the whole game.
  const testBells = [...declaredItems].filter((id) => /oracle_bell_level_\d+$/.test(id));
  assert(testBells.length === 10, `all ten level-test bells exist (${testBells.length})`);
  const recipeResults = new Set(recipeFiles.map((file) => {
    const recipe = JSON.parse(readFileSync(`${PACK}/GrowingVillages_BP/recipes/${file}`, "utf8"));
    return (recipe["minecraft:recipe_shaped"] || recipe["minecraft:recipe_shapeless"]).result.item;
  }));
  for (const bell of testBells) {
    assert(!recipeResults.has(bell), `${bell} stays creative-only, with no recipe`);
  }
}

// ---------- 2. приветствие ----------
console.log("\n=== a new player is told the mod is there, exactly once ===");
{
  startOnboarding();
  const player = __test__.makePlayer("Newcomer", { x: 0, y: 70, z: 0 });

  assert(needsGreeting(player), "a player who has never played has not been greeted");
  world._spawnPlayer(player, true);
  assert(player._messages.length === 1, `arriving greets them once (${player._messages.length})`);
  assert(!needsGreeting(player), "and they are marked as greeted");

  const message = player._messages[0];
  const keys = (message.rawtext || []).filter((part) => part.translate).map((part) => part.translate);
  assert(keys.length === 3, `the greeting is three translated lines (${keys.length})`);
  assert(keys.includes(ONBOARDING_KEYS.what) && keys.includes(ONBOARDING_KEYS.how),
    "saying what the mod is and how to start");
  // The rule the ratchet enforces: new player-facing text is keys, not literals.
  assert((message.rawtext || []).every((part) => part.translate || typeof part.text === "string"),
    "and carries no hardcoded sentence of its own");

  // Respawning is not arriving.
  world._spawnPlayer(player, false);
  assert(player._messages.length === 1, `a respawn says nothing (${player._messages.length})`);
  // Neither is arriving again in a later session - the flag is what guarantees
  // it, not the initialSpawn field, so a build without that field still behaves.
  world._spawnPlayer(player, true);
  assert(player._messages.length === 1, `and neither does a second first-spawn (${player._messages.length})`);

  assert(greet(player).reason === "already_greeted", "greeting them directly is refused too");
}

console.log("\n=== a second player gets their own greeting ===");
{
  const other = __test__.makePlayer("Second", { x: 10, y: 70, z: 10 });
  world._spawnPlayer(other, true);
  assert(other._messages.length === 1, `the flag is per player, not global (${other._messages.length})`);
}

// ---------- 3. текст существует ----------
console.log("\n=== the greeting's keys are actually translated ===");
{
  for (const language of ["ru_RU", "en_US"]) {
    const text = readFileSync(`${PACK}/GrowingVillages_RP/texts/${language}.lang`, "utf8");
    const defined = new Set(text.split("\n")
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
      .map((line) => line.split("=")[0].trim()));
    for (const key of Object.values(ONBOARDING_KEYS)) {
      assert(defined.has(key), `${language}: ${key} is defined`);
    }
  }

  // The greeting names the recipe's cost in words, so a change to one without
  // the other would leave the game telling the player something untrue.
  const ru = readFileSync(`${PACK}/GrowingVillages_RP/texts/ru_RU.lang`, "utf8");
  const line = ru.split("\n").find((entry) => entry.startsWith(ONBOARDING_KEYS.how)) || "";
  const recipe = JSON.parse(readFileSync(`${PACK}/GrowingVillages_BP/recipes/oracle_bell.json`, "utf8"))["minecraft:recipe_shaped"];
  const goldCount = recipe.pattern.join("").split("").filter((cell) => recipe.key[cell]?.item === "minecraft:gold_ingot").length;
  const spelledOut = { 3: "три", 4: "четыре", 5: "пять", 6: "шесть", 7: "семь" }[goldCount];
  assert(spelledOut !== undefined && line.includes(spelledOut),
    `the greeting's stated gold cost matches the recipe (${goldCount} -> "${spelledOut}")`);
}

console.log(failures === 0 ? "\nALL ONBOARDING CHECKS PASSED" : `\n${failures} ONBOARDING CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
