import { __test__, world } from "@minecraft/server";
import {
  allVillages, registerVillage, updateVillage, forgetVillage,
  villagesNear, nearestVillage, nearestNeighbour,
  registryByteCount, PAGE_BUDGET, MAX_VILLAGES, __registryKeys
} from "./scripts/village_registry.js";
import { foundVillage } from "./scripts/village.js";
import { PROP_ID, PROP_LEVEL } from "./scripts/village_state.js";

/**
 * The world index of villages.
 *
 * Before this existed, a village lived only as dynamic properties on its
 * elder, so the only way to learn anything about one was to have that elder
 * loaded - and there was no way at all to ask "what villages are in this
 * world". That blocked every feature where two settlements have to know about
 * each other: roads between them, caravans, relations, or simply putting the
 * nearest village on the compass.
 *
 * The two things worth proving hardest are the ones that only break on a
 * long-lived world, where nobody would connect the symptom to the cause:
 *
 *  - registering the same village twice must update it, never duplicate it,
 *    because every level-up re-registers;
 *  - no single dynamic property may exceed 32,767 bytes, which is why the
 *    list is paged. The mock enforces that ceiling now, so a broken pager
 *    throws here instead of on someone's world after a hundred villages.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

/** A store backed by a plain Map, so list logic is provable without a world. */
function memoryStore() {
  const map = new Map();
  return {
    get: (key) => map.get(key),
    set: (key, value) => { map.set(key, value); return true; },
    _map: map
  };
}

function clearWorldRegistry() {
  const pages = world.getDynamicProperty(__registryKeys.PROP_COUNT) || 0;
  for (let page = 0; page < pages; page++) world.setDynamicProperty(__registryKeys.PROP_PAGE + page, "");
  world.setDynamicProperty(__registryKeys.PROP_COUNT, 0);
}

// ---------- 1. основы ----------
console.log("\n=== a village goes in and comes back out ===");
{
  const store = memoryStore();
  assert(allVillages(store).length === 0, "an untouched world has no villages");

  const added = registerVillage({ id: "aaa111", x: 120, z: -340, level: 3, palette: "taiga" }, store);
  assert(added.ok, `registering succeeds (${added.reason ?? "ok"})`);

  const [entry] = allVillages(store);
  assert(!!entry, "and the village is listed");
  assert(entry.id === "aaa111" && entry.x === 120 && entry.z === -340,
    `with its id and coordinates intact (${entry?.id} at ${entry?.x},${entry?.z})`);
  assert(entry.level === 3 && entry.palette === "taiga",
    `and its level and palette (${entry?.level}, ${entry?.palette})`);
}

console.log("\n=== registering the same village again updates it, never duplicates ===");
{
  const store = memoryStore();
  registerVillage({ id: "bbb222", x: 10, z: 20, level: 1, palette: "plains" }, store);
  // This is exactly what a level-up does, and it happens up to nineteen times
  // for one village. A list that grew each time would be the bug.
  for (let level = 2; level <= 20; level++) {
    registerVillage({ id: "bbb222", x: 10, z: 20, level, palette: "plains" }, store);
  }
  const list = allVillages(store);
  assert(list.length === 1, `nineteen level-ups leave one record, not twenty (${list.length})`);
  assert(list[0].level === 20, `and it holds the latest level (${list[0].level})`);
}

console.log("\n=== updating and forgetting ===");
{
  const store = memoryStore();
  registerVillage({ id: "ccc333", x: 0, z: 0, level: 5, palette: "plains" }, store);

  const bumped = updateVillage("ccc333", { level: 9 }, store);
  assert(bumped.ok && bumped.entry.level === 9, `a patch changes only what it names (level ${bumped.entry?.level})`);
  assert(bumped.entry.palette === "plains", "and leaves the rest alone");
  assert(!updateVillage("nope", { level: 2 }, store).ok, "patching an unknown village is refused");

  assert(forgetVillage("ccc333", store).ok, "a village can be dropped from the index");
  assert(allVillages(store).length === 0, "and is then gone");
  assert(!forgetVillage("ccc333", store).ok, "dropping it twice is refused rather than silent");
}

// ---------- 2. поиск ----------
console.log("\n=== finding neighbours ===");
{
  const list = [
    { id: "near", x: 100, z: 0, level: 4, palette: "plains" },
    { id: "far", x: 900, z: 0, level: 8, palette: "desert" },
    { id: "middle", x: 400, z: 0, level: 2, palette: "taiga" }
  ];
  const ordered = villagesNear({ x: 0, z: 0 }, 1000, list).map((entry) => entry.id);
  assert(JSON.stringify(ordered) === JSON.stringify(["near", "middle", "far"]),
    `nearest first (${ordered.join(", ")})`);

  const within = villagesNear({ x: 0, z: 0 }, 500, list).map((entry) => entry.id);
  assert(JSON.stringify(within) === JSON.stringify(["near", "middle"]),
    `a range limit is respected (${within.join(", ")})`);

  assert(nearestVillage({ x: 0, z: 0 }, 1000, list)?.id === "near", "nearestVillage picks the closest");
  assert(nearestVillage({ x: 0, z: 0 }, 10, list) === null, "and returns null when nothing is in range");

  // What a road or a caravan actually asks: the closest village that is not me.
  assert(nearestNeighbour("near", 1000, list)?.id === "middle",
    `nearestNeighbour skips the village doing the asking (${nearestNeighbour("near", 1000, list)?.id})`);
  assert(nearestNeighbour("far", 1000, list)?.id === "middle", "and works from the far end too");
  assert(nearestNeighbour("unknown", 1000, list) === null, "an unregistered village has no neighbours");

  // Height must not matter - a village is a place on the map.
  const uphill = villagesNear({ x: 100, z: 0, y: 200 }, 5, list);
  assert(uphill.length === 1 && uphill[0].id === "near",
    "distance ignores height, so a village on a mountain is still next door");
}

// ---------- 3. мусор на входе ----------
console.log("\n=== a bad record is refused, not stored ===");
{
  const store = memoryStore();
  const bad = [
    [{ id: "", x: 1, z: 1 }, "an empty id"],
    [{ id: "x", x: "nowhere", z: 1 }, "a non-numeric coordinate"],
    [{ id: "x", x: 1, z: undefined }, "a missing coordinate"],
    // Tabs and newlines are the field and row separators, so an id containing
    // one would corrupt every record after it on the page.
    [{ id: "with\ttab", x: 1, z: 1 }, "an id containing the field separator"],
    [{ id: "with\nnewline", x: 1, z: 1 }, "an id containing the row separator"]
  ];
  for (const [village, label] of bad) {
    assert(!registerVillage(village, store).ok, `${label} is refused`);
  }
  assert(allVillages(store).length === 0, "and nothing was written");

  // A junk level or palette is corrected rather than refused - those are
  // cosmetic, and losing the village over them would be worse.
  registerVillage({ id: "ddd444", x: 5, z: 5, level: -3, palette: 42 }, store);
  const [fixed] = allVillages(store);
  assert(fixed.level === 1 && fixed.palette === "plains",
    `a nonsense level and palette fall back to sane values (${fixed?.level}, ${fixed?.palette})`);
}

// ---------- 4. постраничность против лимита в 32767 байт ----------
console.log("\n=== no single property ever exceeds the engine's string cap ===");
{
  // Straight through the real world object, so the mock's 32,767-byte ceiling
  // is the thing being tested and not a stand-in for it.
  clearWorldRegistry();
  let threw = null;
  try {
    for (let i = 0; i < MAX_VILLAGES; i++) {
      registerVillage({
        id: `v${String(i).padStart(5, "0")}`,
        x: i * 512, z: -i * 512, level: (i % 20) + 1, palette: "plains"
      });
    }
  } catch (error) {
    threw = error;
  }
  assert(threw === null, `filling the registry to its cap never throws (${threw?.message ?? "clean"})`);

  const stored = allVillages();
  assert(stored.length === MAX_VILLAGES, `all ${MAX_VILLAGES} villages are readable back (${stored.length})`);
  assert(stored[0].id === "v00000" && stored[MAX_VILLAGES - 1].id === `v${String(MAX_VILLAGES - 1).padStart(5, "0")}`,
    "first and last records survived the paging");

  const pages = world.getDynamicProperty(__registryKeys.PROP_COUNT);
  assert(pages >= 1, `the list is paged (${pages} page(s))`);
  for (let page = 0; page < pages; page++) {
    const raw = world.getDynamicProperty(__registryKeys.PROP_PAGE + page) || "";
    assert(raw.length <= 32767, `page ${page} is inside the engine's cap (${raw.length} bytes)`);
    assert(raw.length <= PAGE_BUDGET + 64,
      `page ${page} respects the page budget (${raw.length} <= ~${PAGE_BUDGET})`);
    // A row split across two pages would decode as two broken records.
    for (const line of raw.split("\n")) {
      assert(line.split("\t").length === 5, `page ${page}: every row has all five fields`);
    }
  }
  assert(registryByteCount() > 0, `the registry reports its size (${registryByteCount()} bytes)`);

  // One more past the ceiling is refused rather than silently dropping a village.
  const overflow = registerVillage({ id: "one_too_many", x: 1, z: 1, level: 1, palette: "plains" });
  assert(!overflow.ok && overflow.reason === "registry_full",
    `a village past the cap is refused with a reason (${overflow.reason})`);
  assert(allVillages().length === MAX_VILLAGES, "and the existing list is untouched");

  // Shrinking must not resurrect anything from a page that is no longer used.
  clearWorldRegistry();
  registerVillage({ id: "solo", x: 7, z: 7, level: 1, palette: "plains" });
  assert(allVillages().length === 1,
    `after shrinking, no stale page is read back (${allVillages().length})`);
}

console.log("\n=== the multi-page path actually runs ===");
{
  // The check above filled the registry to its 512-village cap and still fit
  // on ONE page, so it proved the cap and not the pager. Long ids push the
  // same number of records past the page budget, which is the only way to
  // exercise the branch that opens a second property - and the branch that
  // has to read them back in order.
  clearWorldRegistry();
  const long = (i) => `village_with_a_deliberately_long_identifier_${String(i).padStart(4, "0")}`;
  for (let i = 0; i < MAX_VILLAGES; i++) {
    registerVillage({ id: long(i), x: i * 1024, z: i * -1024, level: 20, palette: "sunflower_plains" });
  }

  const pages = world.getDynamicProperty(__registryKeys.PROP_COUNT);
  assert(pages > 1, `long records really span several pages (${pages})`);

  const back = allVillages();
  assert(back.length === MAX_VILLAGES, `every record survives a multi-page round trip (${back.length})`);
  assert(back[0].id === long(0), `the first record is intact (${back[0]?.id})`);
  assert(back[MAX_VILLAGES - 1].id === long(MAX_VILLAGES - 1),
    `and so is the last, which lives on a later page (${back[MAX_VILLAGES - 1]?.id})`);
  assert(back.every((entry, i) => entry.x === i * 1024),
    "records come back in the order they were written, across the page boundary");

  for (let page = 0; page < pages; page++) {
    const raw = world.getDynamicProperty(__registryKeys.PROP_PAGE + page) || "";
    assert(raw.length <= 32767, `page ${page} of ${pages} is inside the engine's cap (${raw.length} bytes)`);
    assert(!raw.startsWith("\n") && !raw.endsWith("\n"),
      `page ${page} has no half-written row at either edge`);
  }

  // Updating a record that sits on a later page must not disturb the earlier ones.
  const target = long(MAX_VILLAGES - 1);
  assert(updateVillage(target, { level: 7 }).ok, "a record on a later page can be patched");
  const after = allVillages();
  assert(after.length === MAX_VILLAGES, `and the list keeps its length (${after.length})`);
  assert(after.find((entry) => entry.id === target)?.level === 7, "with the patch applied");
  assert(after[0].id === long(0), "and page one untouched");

  // Shrinking from many pages to one must not leave a stale page behind.
  clearWorldRegistry();
  registerVillage({ id: "after_the_flood", x: 1, z: 1, level: 1, palette: "plains" });
  assert(allVillages().length === 1,
    `dropping from ${pages} pages to one leaves exactly one record (${allVillages().length})`);
}

// ---------- 5. подключено к настоящему основанию ----------
console.log("\n=== founding a village really registers it ===");
{
  clearWorldRegistry();
  const player = __test__.makePlayer("Founder", { x: 770000, y: 70, z: 770000 });
  const elder = foundVillage(player, { x: 770000, y: 70, z: 770000 }, 0);
  const id = elder.getDynamicProperty(PROP_ID);

  const listed = allVillages().find((entry) => entry.id === id);
  assert(!!listed, `the new village is in the index (${id})`);
  assert(listed?.x === 770000 && listed?.z === 770000,
    `at its own origin (${listed?.x},${listed?.z})`);
  assert(listed?.level === elder.getDynamicProperty(PROP_LEVEL),
    `with the level the elder holds (${listed?.level})`);

  // A second village elsewhere, so "nearest neighbour" has something to find.
  const player2 = __test__.makePlayer("Founder2", { x: 771000, y: 70, z: 770000 });
  const elder2 = foundVillage(player2, { x: 771000, y: 70, z: 770000 }, 0);
  const id2 = elder2.getDynamicProperty(PROP_ID);
  assert(allVillages().length === 2, `two foundings, two records (${allVillages().length})`);
  assert(nearestNeighbour(id, 5000)?.id === id2,
    "and each village can now find the other without either elder being loaded");
}

console.log(failures === 0 ? "\nALL VILLAGE REGISTRY CHECKS PASSED" : `\n${failures} VILLAGE REGISTRY CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
