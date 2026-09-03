import { __test__, world, system, WaypointTexture, LocationWaypoint } from "@minecraft/server";
import { readFileSync } from "node:fs";
import { refreshBar, desiredWaypoints, startWaypointLoop, __waypointTest__ } from "./scripts/waypoints.js";
import { registerVillage, allVillages, __registryKeys } from "./scripts/village_registry.js";
import { foundVillage } from "./scripts/village.js";
import { OUTPOST_SLOTS } from "./scripts/outposts.js";
import { builtKey } from "./scripts/outpost_runtime.js";
import { toWorld } from "./scripts/util.js";

/**
 * The locator bar: villages and surveyed sites on the compass strip.
 *
 * Two things this suite is really about.
 *
 * The first is that it is the first code to *read* the village registry. O2
 * shipped the index in 0.11.0 and nothing ever consulted it - founding wrote a
 * record and no code looked at it again. So the assertions here are as much
 * about the registry finally being load-bearing as about the bar.
 *
 * The second is the engine's rules, which are easy to violate in ways that
 * only hurt other packs:
 *
 *  - a pack may only see and modify waypoints it added itself, so this must
 *    never call removeAllWaypoints and never remove something it did not add;
 *  - maxCount is a hard ceiling and addWaypoint throws past it. The docs give
 *    no number for it, so nothing may assume one - the budget is read from the
 *    bar, and the test proves that by moving the cap and re-running.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

const dim = __test__.makeDimension();

function clearRegistry() {
  const pages = Number(world.getDynamicProperty(__registryKeys.PROP_COUNT) || 0);
  for (let page = 0; page < pages; page++) world.setDynamicProperty(__registryKeys.PROP_PAGE + page, "");
  world.setDynamicProperty(__registryKeys.PROP_COUNT, 0);
}

function playerAt(name, at) {
  const player = __test__.makePlayer(name, { ...at });
  player.locatorBar.removeAllWaypoints();
  __waypointTest__.owned.clear();
  return player;
}

// ---------- 1. деревни из реестра ----------
console.log("\n=== nearby villages appear on the bar, and the registry is what supplies them ===");
{
  clearRegistry();
  const at = { x: 0, y: 70, z: 0 };
  const player = playerAt("Walker", at);

  // Nothing remembered yet: an empty bar, not an error.
  const empty = refreshBar(player);
  assert(empty.ok && empty.added.length === 0, `an empty registry marks nothing (${empty.added.length})`);
  assert(player.locatorBar.count === 0, "and leaves the bar empty");

  // Three villages: one underfoot, one a walk away, one over the horizon.
  registerVillage({ id: "home", x: 10, z: 10, level: 4, palette: "plains" });
  registerVillage({ id: "neighbour", x: 200, z: 0, level: 2, palette: "taiga" });
  registerVillage({ id: "faraway", x: 9000, z: 0, level: 1, palette: "desert" });
  assert(allVillages().length === 3, "three villages are remembered");

  const result = refreshBar(player);
  assert(result.ok, "the bar refreshes");
  assert(result.added.includes("village:neighbour"),
    `the village a walk away is marked (${result.added.join(", ") || "none"})`);
  assert(!result.added.includes("village:home"),
    "the village underfoot is not - you are standing in it");
  assert(!result.added.includes("village:faraway"),
    "and one over the horizon is out of range");
  assert(player.locatorBar.count === 1, `exactly one waypoint on the bar (${player.locatorBar.count})`);

  // A settlement is a square, per the icon vocabulary the module documents.
  const [waypoint] = player.locatorBar.getAllWaypoints();
  const texture = waypoint.textureSelector.textureBoundsList[0].texture;
  assert(texture === WaypointTexture.Square, `a village shows as a square (${texture})`);
  assert(waypoint.dimensionLocation.x === 200 && waypoint.dimensionLocation.z === 0,
    `at the village's own coordinates (${waypoint.dimensionLocation.x}, ${waypoint.dimensionLocation.z})`);

  // Idempotence: the loop runs every ten seconds and must not churn.
  const again = refreshBar(player);
  assert(again.added.length === 0 && again.removed.length === 0,
    `a second pass changes nothing (${again.added.length} added, ${again.removed.length} removed)`);
  assert(player.locatorBar.count === 1, "and does not duplicate the waypoint");
}

console.log("\n=== walking away drops the marker, walking back restores it ===");
{
  clearRegistry();
  const player = playerAt("Rover", { x: 0, y: 70, z: 0 });
  registerVillage({ id: "camp", x: 300, z: 0, level: 3, palette: "plains" });

  refreshBar(player);
  assert(player.locatorBar.count === 1, "in range: marked");

  player.location = { x: 9000, y: 70, z: 0 };
  const gone = refreshBar(player);
  assert(gone.removed.includes("village:camp"), `out of range: removed (${gone.removed.join(", ")})`);
  assert(player.locatorBar.count === 0, "and the bar is empty again");

  player.location = { x: 300, y: 70, z: 200 };
  refreshBar(player);
  assert(player.locatorBar.count === 1, "back in range: marked again");

  // Standing on top of it hides it: a marker on your own feet is noise.
  player.location = { x: 300, y: 70, z: 0 };
  refreshBar(player);
  assert(player.locatorBar.count === 0,
    `standing in the village hides its marker (${player.locatorBar.count})`);
}

// ---------- 2. аванпосты ----------
console.log("\n=== a surveyed outpost gets its own icon, an unsurveyed slot gets nothing ===");
{
  clearRegistry();
  const origin = { x: 500000, y: 70, z: 0 };
  const founder = playerAt("Surveyor", { x: origin.x + 200, y: 70, z: 0 });
  const elder = foundVillage(founder, origin, 0);

  const before = refreshBar(founder);
  const outposts = before.added.filter((key) => key.startsWith("outpost:"));
  assert(outposts.length === 0, `an unsurveyed village contributes no sites (${outposts.length})`);

  // Survey one corner, as useSurveyCharter does.
  const slot = OUTPOST_SLOTS[0];
  elder.setDynamicProperty(builtKey(slot.id), true);

  const after = refreshBar(founder);
  const marked = after.added.filter((key) => key.startsWith("outpost:"));
  assert(marked.length === 1, `the surveyed corner is marked (${marked.length})`);

  const star = founder.locatorBar.getAllWaypoints()
    .find((w) => w.textureSelector.textureBoundsList[0].texture === WaypointTexture.SmallStar);
  assert(!!star, "and it is a star, so it reads differently from a village");
  const expected = toWorld(origin, 0, slot.f, slot.s, 0);
  assert(star.dimensionLocation.x === expected.x && star.dimensionLocation.z === expected.z,
    `at the corner the builder actually used (${star.dimensionLocation.x}, ${star.dimensionLocation.z} vs ${expected.x}, ${expected.z})`);

  // The two kinds must not share a colour, or the icons are the only cue.
  assert(JSON.stringify(__waypointTest__.VILLAGE_COLOR) !== JSON.stringify(__waypointTest__.OUTPOST_COLOR),
    "a village and a site are different colours");
}

// ---------- 3. пределы движка ----------
console.log("\n=== maxCount is read, never assumed ===");
{
  clearRegistry();
  const player = playerAt("Crowded", { x: 0, y: 70, z: 0 });
  // More villages in range than any sane bar will hold.
  for (let i = 0; i < 20; i++) {
    registerVillage({ id: `v${i}`, x: 100 + i * 10, z: 0, level: 1, palette: "plains" });
  }

  const cap = player.locatorBar.maxCount;
  const result = refreshBar(player);
  assert(player.locatorBar.count <= cap,
    `the bar never exceeds the cap it reports (${player.locatorBar.count} <= ${cap})`);
  assert(result.ok, "and filling it is not an error");

  // The ones that survive are the near ones: a compass that drops the village
  // you are walking towards is worse than no compass.
  const shown = player.locatorBar.getAllWaypoints().map((w) => w.dimensionLocation.x).sort((a, b) => a - b);
  const dropped = 100 + 19 * 10;
  assert(!shown.includes(dropped), `the furthest village is the one dropped (kept ${shown.join(", ")})`);
  assert(shown[0] === 100, "and the nearest is kept");

  // Changing the engine's cap must change the outcome - which it only can if
  // the code reads maxCount instead of carrying a number of its own.
  const smaller = 2;
  __test__.setWaypointCap(smaller);
  const other = playerAt("Cramped", { x: 0, y: 70, z: 0 });
  refreshBar(other);
  assert(other.locatorBar.count === smaller,
    `a cap of ${smaller} yields ${smaller} waypoints (${other.locatorBar.count})`);
  __test__.setWaypointCap(cap);
}

console.log("\n=== waypoints another pack owns are never touched ===");
{
  clearRegistry();
  const player = playerAt("Polite", { x: 0, y: 70, z: 0 });

  // Someone else's marker, added straight to the bar and unknown to us.
  const foreign = new LocationWaypoint(
    { dimension: dim, x: -777, y: 70, z: -777 },
    { textureBoundsList: [{ lowerBound: 0, texture: WaypointTexture.Circle }] },
    { red: 1, green: 0, blue: 1 }
  );
  player.locatorBar.addWaypoint(foreign);

  registerVillage({ id: "ours", x: 250, z: 0, level: 1, palette: "plains" });
  refreshBar(player);
  assert(player.locatorBar.hasWaypoint(foreign), "a foreign waypoint survives a refresh");

  // Walking out of range clears ours and still leaves theirs alone.
  player.location = { x: 40000, y: 70, z: 0 };
  refreshBar(player);
  assert(player.locatorBar.hasWaypoint(foreign), "and survives our cleanup too");
  assert(player.locatorBar.count === 1, `only theirs is left (${player.locatorBar.count})`);

  // Nothing in the module may call removeAllWaypoints: it is legal for us and
  // wrong the moment a second pack shares the bar.
  const code = readFileSync(`${import.meta.dirname}/scripts/waypoints.js`, "utf8")
    .split("\n")
    // The module's own doc comment names the call it promises not to make, so
    // a grep over the raw text would always trip on the promise itself.
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert(!/removeAllWaypoints/.test(code),
    "the module never calls removeAllWaypoints");
}

console.log("\n=== an engine with no locator bar is simply skipped ===");
{
  const ancient = { name: "Old", location: { x: 0, y: 70, z: 0 }, dimension: dim, id: "ancient" };
  const result = refreshBar(ancient);
  assert(!result.ok && result.reason === "no_locator_bar",
    `a player with no bar is refused, not crashed into (${result.reason})`);
}

// ---------- 4. цикл ----------
console.log("\n=== the background loop refreshes every player ===");
{
  clearRegistry();
  world._players.length = 0;
  const one = playerAt("First", { x: 0, y: 70, z: 0 });
  const two = playerAt("Second", { x: 800, y: 70, z: 0 });
  world._players.length = 0;
  world._players.push(one, two);
  registerVillage({ id: "shared", x: 400, z: 0, level: 2, palette: "plains" });

  startWaypointLoop();
  const tick = system._intervals[system._intervals.length - 1];
  assert(typeof tick === "function", "the loop registered an interval");

  tick();
  assert(one.locatorBar.count === 1, `the player in range is marked (${one.locatorBar.count})`);
  assert(two.locatorBar.count === 1,
    `and so is the other, from their own side of it (${two.locatorBar.count})`);

  // Bookkeeping for a player who left must not accumulate.
  const before = __waypointTest__.owned.size;
  world._players.length = 0;
  world._players.push(one);
  tick();
  assert(__waypointTest__.owned.size < before,
    `a departed player is forgotten (${before} -> ${__waypointTest__.owned.size})`);
}

console.log(failures === 0 ? "\nALL WAYPOINT CHECKS PASSED" : `\n${failures} WAYPOINT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
