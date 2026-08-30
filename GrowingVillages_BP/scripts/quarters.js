/**
 * Named districts and building plots inside the crossroads village.
 *
 * Like spatial_plan.js this module imports nothing from Minecraft and performs
 * no world operation. It is a contract: it answers the question the village
 * kept failing in play - the wall encloses a great deal of ground and almost
 * none of it is used, so *where exactly* does the next building go?
 *
 * spatial_plan.js owns the twenty numbered plots. What it does not describe is
 * everything between them, which on an R94 crossroads is most of the enclosed
 * area. These are those gaps. Every rectangle here was found by scanning the
 * enclosed area for ground that is clear of the numbered plots, their reserve
 * envelopes, both road arms, the special sheds and the corner towers - and the
 * test re-proves all of those separations rather than trusting the numbers.
 *
 * `unlockLevel` is a growth curve, not just a gate. Two rules shape it:
 *   - a plot can never unlock before the wall actually encloses it
 *     (PERIMETER_SCHEDULE: R44 at 5, R62 at 8, R78 at 10, R94 at 15), which is
 *     the exact mistake the numbered L12-L18 plots used to make; and
 *   - at most two plots unlock per level, so the village thickens steadily
 *     instead of a whole district appearing in one level-up.
 */

/** Kept clear of the curtain wall and its inside walkway. */
export const BUILDABLE_INNER_RADIUS = 88;

/**
 * What a plot gets built as. The builders are archetypes rather than one
 * bespoke function per plot: a plot describes what it is, and quarter_buildings.js
 * knows how to build that kind anywhere.
 *
 *   cottage  - a small home with a bed. Houses a resident.
 *   workshop - a home with a vanilla job-site block, so its villager picks up
 *              a real profession and real trades from vanilla AI.
 *   yard     - an open working yard: fences, storage, no interior.
 *   civic    - a small public building.
 *   commons  - an unwalled public fitting: a well, a covered gathering spot.
 */
export const SLOT_KINDS = Object.freeze(["cottage", "workshop", "yard", "civic", "commons"]);

function slot(id, kind, unlockLevel, bounds, options = {}) {
  return Object.freeze({
    id,
    kind,
    unlockLevel,
    label: options.label || id,
    bounds: Object.freeze({ ...bounds }),
    // The vanilla job-site block a workshop places. Its villager claims it a
    // few seconds after spawning and becomes that profession on its own - the
    // same mechanism npc.js already relies on for the craftsmen, and the
    // reason none of this needs a "spawn_<profession>" event name.
    jobSite: options.jobSite || null,
    resident: options.resident || null,
    note: options.note || ""
  });
}

function quarter(id, label, slots) {
  return Object.freeze({
    id,
    label,
    unlockLevel: Math.min(...slots.map((entry) => entry.unlockLevel)),
    slots: Object.freeze(slots)
  });
}

export const QUARTERS = Object.freeze([
  quarter("inner_yards", "Ближние дворы", [
    slot("inner_yards.smallholding", "cottage", 6, { fMin: -15, fMax: -7, sMin: 11, sMax: 19 },
      { label: "Малый двор", resident: "Житель", note: "Первая пристройка к ядру деревни." }),
    slot("inner_yards.smokehouse", "workshop", 6, { fMin: -39, fMax: -31, sMin: -17, sMax: -9 },
      { label: "Коптильня", jobSite: "minecraft:smoker", resident: "Мясник" })
  ]),
  quarter("trade_slope", "Торговый спуск", [
    slot("trade_slope.weavers", "workshop", 8, { fMin: 5, fMax: 17, sMin: -57, sMax: -45 },
      { label: "Ткацкая", jobSite: "minecraft:loom", resident: "Пастух" }),
    slot("trade_slope.stable", "yard", 10, { fMin: 20, fMax: 32, sMin: -57, sMax: -45 },
      { label: "Конюшня", note: "Двор для повозок и сена; жителя не селит." })
  ]),
  quarter("craft_slope", "Ремесленный склон", [
    slot("craft_slope.tannery", "workshop", 8, { fMin: -57, fMax: -45, sMin: 5, sMax: 17 },
      { label: "Кожевня", jobSite: "minecraft:cauldron", resident: "Кожевник" }),
    slot("craft_slope.fletchery", "workshop", 11, { fMin: -57, fMax: -45, sMin: 20, sMax: 32 },
      { label: "Стрельня", jobSite: "minecraft:fletching_table", resident: "Стрельник" })
  ]),
  quarter("quiet_corner", "Тихий угол", [
    slot("quiet_corner.cottages", "cottage", 9, { fMin: -39, fMax: -27, sMin: -55, sMax: -43 },
      { label: "Жилой двор", resident: "Житель" }),
    slot("quiet_corner.well", "commons", 10, { fMin: -24, fMax: -12, sMin: -55, sMax: -43 },
      { label: "Общий колодец" })
  ]),
  quarter("upper_meadow", "Верхний луг", [
    slot("upper_meadow.apiary", "yard", 9, { fMin: -39, fMax: -27, sMin: 45, sMax: 57 },
      { label: "Пасека" }),
    slot("upper_meadow.mill", "civic", 12, { fMin: -24, fMax: -12, sMin: 65, sMax: 77 },
      { label: "Мельница", note: "Самая высокая постройка кварталов." })
  ]),
  quarter("lower_yards", "Нижние дворы", [
    slot("lower_yards.pottery", "workshop", 11, { fMin: 5, fMax: 17, sMin: -72, sMax: -60 },
      { label: "Гончарня", jobSite: "minecraft:stonecutter_block", resident: "Каменщик" }),
    slot("lower_yards.smithy_yard", "workshop", 13, { fMin: 20, fMax: 32, sMin: -72, sMax: -60 },
      { label: "Точильный двор", jobSite: "minecraft:grindstone", resident: "Оружейник" })
  ]),
  quarter("west_commons", "Западная пустошь", [
    slot("west_commons.chapel", "civic", 12, { fMin: -72, fMax: -60, sMin: 5, sMax: 17 },
      { label: "Книжный дом", jobSite: "minecraft:lectern", resident: "Библиотекарь" }),
    slot("west_commons.gathering", "commons", 13, { fMin: -72, fMax: -60, sMin: 20, sMax: 32 },
      { label: "Место сходов" })
  ]),
  quarter("craft_row", "Ремесленный ряд", [
    slot("craft_row.glasshouse", "workshop", 15, { fMin: 66, fMax: 78, sMin: 5, sMax: 17 },
      { label: "Бронный двор", jobSite: "minecraft:blast_furnace", resident: "Бронник" }),
    slot("craft_row.woodyard", "yard", 15, { fMin: 69, fMax: 81, sMin: 20, sMax: 32 },
      { label: "Лесопилка" })
  ]),
  quarter("north_gate_yards", "Северные дворы", [
    slot("north_gate_yards.granary_annex", "yard", 15, { fMin: 5, fMax: 17, sMin: 69, sMax: 81 },
      { label: "Второй амбар" }),
    slot("north_gate_yards.guardhouse", "civic", 15, { fMin: 20, fMax: 32, sMin: 69, sMax: 81 },
      { label: "Караулка у северных ворот" })
  ])
]);

export const ALL_SLOTS = Object.freeze(QUARTERS.flatMap((district) => district.slots));

/** Every plot the village has enclosed and earned by `level`. */
export function slotsUnlockedAt(level) {
  if (!Number.isInteger(level)) return Object.freeze([]);
  return Object.freeze(ALL_SLOTS.filter((entry) => level >= entry.unlockLevel));
}

export function slotById(id) {
  return ALL_SLOTS.find((entry) => entry.id === id) || null;
}

/** The district a plot belongs to. */
export function quarterForSlot(slotId) {
  return QUARTERS.find((district) => district.slots.some((entry) => entry.id === slotId)) || null;
}

/** Districts, in the order the village grows into them. */
export function quartersUnlockedAt(level) {
  if (!Number.isInteger(level)) return Object.freeze([]);
  return Object.freeze(QUARTERS.filter((district) => level >= district.unlockLevel));
}
