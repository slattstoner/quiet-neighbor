/**
 * Named districts and free building plots inside the crossroads village.
 *
 * Like spatial_plan.js this module imports nothing from Minecraft and performs
 * no world operation - it is a contract, not a builder. Its job is to answer
 * the question the village kept failing in play: the wall encloses a great
 * deal of ground and almost none of it is used, so *where exactly* does the
 * next building go?
 *
 * `spatial_plan.js` already owns the twenty numbered plots. What it does not
 * describe is everything between them, which on an R94 crossroads is most of
 * the enclosed area. These are those gaps, cut into rectangles that are
 * provably clear of the numbered plots, their reserve envelopes, both road
 * arms, the special sheds and the corner towers - the test asserts every one
 * of those separations rather than trusting the numbers written here.
 *
 * Nothing here builds yet. Stage 2 fills these slots; this exists now so that
 * the layout work can be checked for having actually left room for it.
 */

/** Kept clear of the curtain wall and its inside walkway. */
export const BUILDABLE_INNER_RADIUS = 88;

function slot(id, kind, bounds, unlockLevel, note) {
  return Object.freeze({
    id,
    kind,
    unlockLevel,
    bounds: Object.freeze({ ...bounds }),
    note: note || ""
  });
}

function quarter(id, label, unlockLevel, slots) {
  return Object.freeze({ id, label, unlockLevel, slots: Object.freeze(slots) });
}

/**
 * Eight districts, two plots each. The unlock level of a district is the level
 * at which the curtain wall has grown far enough out to actually enclose it
 * (PERIMETER_SCHEDULE: R44 at 5, R62 at 8, R78 at 10, R94 at 15), so no
 * district can be offered while it would still stand outside the wall - the
 * exact mistake the numbered L12-L18 plots were making.
 */
export const QUARTERS = Object.freeze([
  quarter("quiet_corner", "Тихий угол", 8, [
    slot("quiet_corner.cottages", "residential", { fMin: -39, fMax: -27, sMin: -55, sMax: -43 }, 8, "Пара жилых дворов за домом картографа."),
    slot("quiet_corner.well", "commons", { fMin: -24, fMax: -12, sMin: -55, sMax: -43 }, 8, "Общий колодец и скамьи вокруг него.")
  ]),
  quarter("trade_slope", "Торговый спуск", 8, [
    slot("trade_slope.shop", "trade", { fMin: 5, fMax: 17, sMin: -57, sMax: -45 }, 8, "Лавка с прилавком на улицу."),
    slot("trade_slope.stable", "service", { fMin: 20, fMax: 32, sMin: -57, sMax: -45 }, 8, "Конюшня и двор для повозок.")
  ]),
  quarter("weavers_slope", "Ткацкий склон", 8, [
    slot("weavers_slope.workshop", "craft", { fMin: -57, fMax: -45, sMin: 5, sMax: 17 }, 8, "Ткацкая мастерская."),
    slot("weavers_slope.dyeyard", "craft", { fMin: -57, fMax: -45, sMin: 20, sMax: 32 }, 8, "Красильный двор с котлами и сушилами.")
  ]),
  quarter("upper_meadow", "Верхний луг", 8, [
    slot("upper_meadow.apiary", "production", { fMin: -39, fMax: -27, sMin: 45, sMax: 57 }, 8, "Пасека."),
    slot("upper_meadow.mill", "production", { fMin: -24, fMax: -12, sMin: 65, sMax: 77 }, 15, "Мельница - высокая постройка, нужна вся R94.")
  ]),
  quarter("lower_yards", "Нижние дворы", 10, [
    slot("lower_yards.pottery", "craft", { fMin: 5, fMax: 17, sMin: -72, sMax: -60 }, 10, "Гончарня с печами для обжига."),
    slot("lower_yards.tannery", "craft", { fMin: 20, fMax: 32, sMin: -72, sMax: -60 }, 10, "Кожевня, намеренно на отшибе.")
  ]),
  quarter("west_commons", "Западная пустошь", 10, [
    slot("west_commons.chapel", "civic", { fMin: -72, fMax: -60, sMin: 5, sMax: 17 }, 10, "Часовня и небольшой двор."),
    slot("west_commons.gathering", "commons", { fMin: -72, fMax: -60, sMin: 20, sMax: 32 }, 10, "Крытая площадка для сходов.")
  ]),
  quarter("craft_row", "Ремесленный ряд", 15, [
    slot("craft_row.glasshouse", "craft", { fMin: 66, fMax: 78, sMin: 5, sMax: 17 }, 15, "Стеклодувная."),
    slot("craft_row.woodyard", "production", { fMin: 69, fMax: 81, sMin: 20, sMax: 32 }, 15, "Лесопилка и штабеля брёвен.")
  ]),
  quarter("north_gate_yards", "Северные дворы", 15, [
    slot("north_gate_yards.granary_annex", "service", { fMin: 5, fMax: 17, sMin: 69, sMax: 81 }, 15, "Второй амбар у северных ворот."),
    slot("north_gate_yards.guardhouse", "defence", { fMin: 20, fMax: 32, sMin: 69, sMax: 81 }, 15, "Караулка при северных воротах.")
  ])
]);

export const ALL_SLOTS = Object.freeze(QUARTERS.flatMap((district) => district.slots));

/** Every free plot the village has actually enclosed by `level`. */
export function slotsUnlockedAt(level) {
  if (!Number.isInteger(level)) return Object.freeze([]);
  return Object.freeze(ALL_SLOTS.filter((entry) => level >= entry.unlockLevel));
}

export function slotById(id) {
  return ALL_SLOTS.find((entry) => entry.id === id) || null;
}

/** Districts, in the order the village grows into them. */
export function quartersUnlockedAt(level) {
  if (!Number.isInteger(level)) return Object.freeze([]);
  return Object.freeze(QUARTERS.filter((district) => level >= district.unlockLevel));
}
