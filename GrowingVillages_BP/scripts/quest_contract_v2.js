// Data-only future quest contract. This module deliberately has no Bedrock, UI,
// builder or runtime imports. It describes future content but executes nothing.

export const QUEST_SCHEMA_VERSION = 3;
const LOCALIZATION_PREFIX = "growing_villages";
const SPECIAL_BUILD_TRIGGER = "special_arc_complete_then_build";
const SPECIAL_RUNTIME_STATUS = "planned";
const ALLOWED_DEFERRED_REWARD_POLICIES = Object.freeze([
  "rare_utility_cosmetic",
  "one_time_settlement_discount",
  "lore_and_build_only"
]);
const FORBIDDEN_SPECIAL_ITEMS = new Set([
  "minecraft:diamond", "minecraft:emerald", "minecraft:netherite_ingot", "minecraft:netherite_scrap",
  "minecraft:enchanted_golden_apple", "minecraft:diamond_axe", "minecraft:diamond_pickaxe",
  "minecraft:diamond_horse_armor", "minecraft:enchanted_book", "minecraft:potion"
]);

export const CANONICAL_BUILDING_IDS = Object.freeze([
  "town_hall", "campfire", "starter_house", "farmer_homestead", "blacksmith_forge",
  "cartographer_house", "fortification_palisade", "miner_house", "resident_house",
  "fortification_cobble", "artisan_house", "fortification_castle", "market_square",
  "granary_yard", "travellers_inn", "guard_barracks", "village_archive",
  "memorial_grove", "village_infirmary", "civic_workshop", "founders_hall",
  "village_beacon"
]);

function localizationFor(kind, id) {
  return Object.freeze({
    title: `${LOCALIZATION_PREFIX}.${kind}.${id}.title`,
    objective: `${LOCALIZATION_PREFIX}.${kind}.${id}.objective`,
    complete: `${LOCALIZATION_PREFIX}.${kind}.${id}.complete`,
    locked: `${LOCALIZATION_PREFIX}.${kind}.${id}.locked`
  });
}

function extensionLocalization(level, slug) {
  const base = `${LOCALIZATION_PREFIX}.chapter.chapter.${String(level).padStart(2, "0")}.${slug}`;
  return Object.freeze({
    title: `${base}.title`, intro: `${base}.intro`, requirements: `${base}.requirements`,
    buildComplete: `${base}.build_complete`, locked: `${base}.locked`, outOfOrder: `${base}.out_of_order`
  });
}

function chapter(level, slug, buildingId, giverRoleId, objectiveType, options = {}) {
  const id = `chapter.${String(level).padStart(2, "0")}.${slug}`;
  return Object.freeze({
    id,
    level,
    buildingId,
    startBuildingIds: Object.freeze(options.startBuildingIds || []),
    giverRoleId,
    objective: Object.freeze({ type: objectiveType }),
    minLevel: options.minLevel || level,
    questArcId: options.questArcId || null,
    progressKind: options.progressKind || objectiveType,
    buildTrigger: options.buildTrigger || null,
    requirements: Object.freeze((options.requirements || []).map((entry) => Object.freeze({ ...entry }))),
    runtimeStatus: options.runtimeStatus || "current",
    reward: Object.freeze({
      id: options.rewardId || `reward.level.${String(level).padStart(2, "0")}.none`,
      kind: options.rewardKind || "none",
      repeatPolicy: options.rewardRepeatPolicy || "none"
    }),
    repeatPolicy: "once_per_village",
    localization: options.localization || localizationFor("chapter", id),
    onComplete: Object.freeze({ kind: "set_chapter_state", state: "complete", description: "future_state_marker_only" })
  });
}

export const LEVEL_CHAPTERS = Object.freeze([
  chapter(1, "foundation", "town_hall", "elder", "found_village", { startBuildingIds: ["town_hall", "campfire", "starter_house"] }),
  chapter(2, "field", "farmer_homestead", "farmer", "town_hall_deposit"),
  chapter(3, "forge", "blacksmith_forge", "blacksmith", "town_hall_deposit"),
  chapter(4, "routes", "cartographer_house", "cartographer", "town_hall_deposit"),
  chapter(5, "watch", "fortification_palisade", "elder", "town_hall_deposit"),
  chapter(6, "safe_mine", "miner_house", "miner", "town_hall_deposit"),
  chapter(7, "neighbours", "resident_house", "elder", "town_hall_deposit"),
  chapter(8, "remembered_places", "fortification_cobble", "oldtimer", "town_hall_deposit"),
  chapter(9, "craft_circle", "artisan_house", "blacksmith", "town_hall_deposit"),
  chapter(10, "safe_roads", "fortification_castle", "elder", "town_hall_deposit"),
  chapter(11, "market_day", "market_square", "cartographer", "town_hall_deposit"),
  chapter(12, "shared_store", "granary_yard", "farmer", "town_hall_deposit"),
  chapter(13, "guest_book", "travellers_inn", "elder", "town_hall_deposit"),
  chapter(14, "shared_watch", "guard_barracks", "blacksmith", "town_hall_deposit"),
  chapter(15, "three_returns", "village_archive", "oldtimer", "town_hall_deposit"),
  chapter(16, "roots_of_the_road", "memorial_grove", "elder", SPECIAL_BUILD_TRIGGER, { minLevel: 16, questArcId: "special.roots_of_the_road", buildTrigger: SPECIAL_BUILD_TRIGGER, runtimeStatus: SPECIAL_RUNTIME_STATUS }),
  chapter(17, "oath_of_care", "village_infirmary", "elder", SPECIAL_BUILD_TRIGGER, { minLevel: 17, questArcId: "special.oath_of_care", buildTrigger: SPECIAL_BUILD_TRIGGER, runtimeStatus: SPECIAL_RUNTIME_STATUS }),
  chapter(18, "tools_for_all", "civic_workshop", "elder", SPECIAL_BUILD_TRIGGER, { minLevel: 18, questArcId: "special.tools_for_all", buildTrigger: SPECIAL_BUILD_TRIGGER, runtimeStatus: SPECIAL_RUNTIME_STATUS }),
  chapter(19, "founders_assembly", "founders_hall", "elder", "town_hall_deposit_then_build", {
    minLevel: 19, progressKind: "town_hall_deposit_then_build", buildTrigger: "town_hall_deposit_then_build", runtimeStatus: SPECIAL_RUNTIME_STATUS,
    requirements: [{ itemId: "minecraft:stone_bricks", amount: 256 }, { itemId: "minecraft:dark_oak_planks", amount: 128 }, { itemId: "minecraft:bookshelf", amount: 24 }, { itemId: "minecraft:lantern", amount: 16 }],
    localization: extensionLocalization(19, "founders_assembly")
  }),
  chapter(20, "light_of_the_village", "village_beacon", "elder", "town_hall_deposit_then_build", {
    minLevel: 20, progressKind: "town_hall_deposit_then_build", buildTrigger: "town_hall_deposit_then_build", runtimeStatus: SPECIAL_RUNTIME_STATUS,
    requirements: [{ itemId: "minecraft:stone_bricks", amount: 320 }, { itemId: "minecraft:dark_oak_log", amount: 96 }, { itemId: "minecraft:soul_lantern", amount: 16 }, { itemId: "minecraft:glass_pane", amount: 24 }],
    localization: extensionLocalization(20, "light_of_the_village")
  })
]);

function specialKeys(slug, stepNumber = null) {
  const base = `${LOCALIZATION_PREFIX}.special.${slug}`;
  if (stepNumber === null) {
    return Object.freeze({
      titleKey: `${base}.title`, summaryKey: `${base}.summary`, completionKey: `${base}.completion`,
      buildKey: `${base}.build`, deferredPolicyKey: `${base}.deferred_policy`
    });
  }
  const step = `${base}.step_${String(stepNumber).padStart(2, "0")}`;
  return Object.freeze({ objectiveKey: `${step}.objective`, successKey: `${step}.success` });
}

function specialStep(slug, number, requirements) {
  return Object.freeze({
    id: `${slug}.step_${String(number).padStart(2, "0")}`,
    number,
    objective: Object.freeze({ type: "inventory_turn_in" }),
    requirements: Object.freeze(requirements.map((entry) => Object.freeze({ ...entry }))),
    localization: specialKeys(slug, number),
    repeatPolicy: "once_per_village",
    onComplete: Object.freeze({ kind: "advance_arc_step", description: "future_state_marker_only" })
  });
}

function specialArc({ arcId, level, buildingId, slug, steps, deferredRewardPolicy = "lore_and_build_only" }) {
  return Object.freeze({
    arcId,
    level,
    buildingId,
    minLevel: level,
    titleKey: specialKeys(slug).titleKey,
    summaryKey: specialKeys(slug).summaryKey,
    steps: Object.freeze(steps),
    completionKey: specialKeys(slug).completionKey,
    buildKey: specialKeys(slug).buildKey,
    deferredPolicyKey: specialKeys(slug).deferredPolicyKey,
    deferredRewardPolicy,
    buildTrigger: SPECIAL_BUILD_TRIGGER,
    oneTimePolicy: "once_per_village",
    runtimeStatus: SPECIAL_RUNTIME_STATUS,
    objective: Object.freeze({ type: "arc_progress" }),
    onComplete: Object.freeze({ kind: "set_arc_state", state: "ready_to_build", description: "future_state_marker_only" })
  });
}

// The sole canonical source for future L16–18 special-arc identity, content,
// building linkage, localisation and deferred reward policy. No coordinates live here.
export const SPECIAL_ARCS = Object.freeze([
  specialArc({
    arcId: "special.roots_of_the_road",
    level: 16,
    buildingId: "memorial_grove",
    slug: "roots_of_the_road",
    steps: [
      specialStep("roots_of_the_road", 1, [{ itemId: "minecraft:paper", amount: 16 }, { itemId: "minecraft:oak_sapling", amount: 8 }, { itemId: "minecraft:lantern", amount: 4 }]),
      specialStep("roots_of_the_road", 2, [{ itemId: "minecraft:cobblestone", amount: 24 }, { itemId: "minecraft:oak_sign", amount: 4 }, { itemId: "minecraft:oak_planks", amount: 16 }]),
      specialStep("roots_of_the_road", 3, [{ itemId: "minecraft:book", amount: 3 }, { itemId: "minecraft:torch", amount: 16 }])
    ]
  }),
  specialArc({
    arcId: "special.oath_of_care",
    level: 17,
    buildingId: "village_infirmary",
    slug: "oath_of_care",
    steps: [
      specialStep("oath_of_care", 1, [{ itemId: "minecraft:white_wool", amount: 12 }, { itemId: "minecraft:bread", amount: 16 }, { itemId: "minecraft:lantern", amount: 4 }]),
      specialStep("oath_of_care", 2, [{ itemId: "minecraft:paper", amount: 16 }, { itemId: "minecraft:glass_bottle", amount: 8 }, { itemId: "minecraft:oak_planks", amount: 16 }]),
      specialStep("oath_of_care", 3, [{ itemId: "minecraft:bed", amount: 2 }, { itemId: "minecraft:bucket", amount: 2 }, { itemId: "minecraft:torch", amount: 16 }])
    ]
  }),
  specialArc({
    arcId: "special.tools_for_all",
    level: 18,
    buildingId: "civic_workshop",
    slug: "tools_for_all",
    steps: [
      specialStep("tools_for_all", 1, [{ itemId: "minecraft:cobblestone", amount: 32 }, { itemId: "minecraft:coal", amount: 16 }, { itemId: "minecraft:spruce_planks", amount: 24 }]),
      specialStep("tools_for_all", 2, [{ itemId: "minecraft:iron_ingot", amount: 12 }, { itemId: "minecraft:redstone", amount: 12 }, { itemId: "minecraft:rail", amount: 16 }]),
      specialStep("tools_for_all", 3, [{ itemId: "minecraft:stone_bricks", amount: 24 }, { itemId: "minecraft:iron_nugget", amount: 24 }, { itemId: "minecraft:torch", amount: 24 }])
    ]
  })
]);

// Only long-lived L1–10 legacy state has a migration documentation record. L16–18
// were never active runtime content and therefore intentionally have no aliases or migration.
export const LEGACY_MIGRATION_MAP = Object.freeze({
  quest_step: Object.freeze({ sourceProperty: "quest_step", targetPattern: "village:v2:arc:<roleId>:step", action: "copy_step_without_regrant", regrantRewards: false }),
  discounts: Object.freeze({ sourcePattern: "village:discount:<level>:<itemId>", targetPattern: "village:v2:legacy_discount:<level>:<itemId>", action: "preserve_existing_value", regrantRewards: false })
});

// Current active runtime can expose only the four legacy craftsman metadata lines.
// Planned special records intentionally do not enter availability helpers or current UI.
export const ARC_AVAILABILITY = Object.freeze([
  Object.freeze({ arcId: "arc.farmer", kind: "legacy_craftsman", minLevel: 2, finalReadyLevel: 2 }),
  Object.freeze({ arcId: "arc.blacksmith", kind: "legacy_craftsman", minLevel: 3, finalReadyLevel: 3 }),
  Object.freeze({ arcId: "arc.cartographer", kind: "legacy_craftsman", minLevel: 4, finalReadyLevel: 4 }),
  Object.freeze({ arcId: "arc.miner", kind: "legacy_craftsman", minLevel: 6, finalReadyLevel: 6 })
]);

function craftsmanArc(id, roleId, legacyRole, minLevel) {
  return Object.freeze({
    id, roleId, legacyRole, minLevel,
    objective: Object.freeze({ type: "inventory_turn_in" }),
    repeatPolicy: "once_per_village",
    localization: Object.freeze({
      title: `${LOCALIZATION_PREFIX}.craftsman.${id}.title`, intro: `${LOCALIZATION_PREFIX}.craftsman.${id}.intro`,
      locked: `${LOCALIZATION_PREFIX}.craftsman.${id}.locked`, complete: `${LOCALIZATION_PREFIX}.craftsman.${id}.complete`,
      error: `${LOCALIZATION_PREFIX}.craftsman.${id}.error`
    }),
    steps: Object.freeze(Array.from({ length: 5 }, (_, index) => {
      const stepId = `${id}.step_${String(index + 1).padStart(2, "0")}`;
      return Object.freeze({
        id: stepId, legacyStep: index, objective: Object.freeze({ type: "inventory_turn_in" }), repeatPolicy: "once_per_village",
        localization: Object.freeze({
          title: `${LOCALIZATION_PREFIX}.craftsman.${stepId}.title`, intro: `${LOCALIZATION_PREFIX}.craftsman.${stepId}.intro`,
          objective: `${LOCALIZATION_PREFIX}.craftsman.${stepId}.objective`, progress: `${LOCALIZATION_PREFIX}.craftsman.${stepId}.progress`,
          complete: `${LOCALIZATION_PREFIX}.craftsman.${stepId}.complete`, locked: `${LOCALIZATION_PREFIX}.craftsman.${stepId}.locked`, error: `${LOCALIZATION_PREFIX}.craftsman.${stepId}.error`
        })
      });
    }))
  });
}

export const CRAFTSMAN_ARCS = Object.freeze([
  craftsmanArc("arc.farmer", "farmer", "Фермер", 2),
  craftsmanArc("arc.blacksmith", "blacksmith", "Кузнец", 3),
  craftsmanArc("arc.cartographer", "cartographer", "Картограф", 4),
  craftsmanArc("arc.miner", "miner", "Шахтёр", 6)
]);

export function craftsmanArcForRole(roleId) { return CRAFTSMAN_ARCS.find((arc) => arc.roleId === roleId) || null; }
export function chapterForLevel(level) { return Number.isInteger(level) && level >= 1 && level <= LEVEL_CHAPTERS.length ? LEVEL_CHAPTERS[level - 1] || null : null; }
export function buildingForLevel(level) { return chapterForLevel(level)?.buildingId || null; }
export function availableArcIdsForLevel(level) {
  if (!Number.isInteger(level) || level < 1) return Object.freeze([]);
  return Object.freeze(ARC_AVAILABILITY.filter((entry) => level >= entry.minLevel).map((entry) => entry.arcId));
}
export function finalReadyArcIdsForLevel(level) {
  if (!Number.isInteger(level) || level < 1) return Object.freeze([]);
  return Object.freeze(ARC_AVAILABILITY.filter((entry) => entry.kind === "special_metadata" && level >= entry.finalReadyLevel).map((entry) => entry.arcId));
}

function validKey(key) { return typeof key === "string" && key.startsWith(`${LOCALIZATION_PREFIX}.`) && !/\s/.test(key); }
function validLocalization(localization) { return localization && Object.values(localization).every(validKey); }
function uniqueField(items, field, label, errors) {
  const seen = new Set();
  for (const item of items) { const value = item?.[field]; if (!value || seen.has(value)) errors.push(`${label}:duplicate_or_missing:${value || "unknown"}`); seen.add(value); }
}

export function validateQuestContract(contract = {}) {
  const canonicalBuildingIds = contract.canonicalBuildingIds || CANONICAL_BUILDING_IDS;
  const levelChapters = contract.levelChapters || LEVEL_CHAPTERS;
  const specialArcs = contract.specialArcs || SPECIAL_ARCS;
  const legacyMigrationMap = contract.legacyMigrationMap || LEGACY_MIGRATION_MAP;
  const arcAvailability = contract.arcAvailability || ARC_AVAILABILITY;
  const craftsmanArcs = contract.craftsmanArcs || CRAFTSMAN_ARCS;
  const errors = [];
  const canonical = new Set(canonicalBuildingIds);
  const expectedSpecial = new Map([
    ["special.roots_of_the_road", { level: 16, buildingId: "memorial_grove" }],
    ["special.oath_of_care", { level: 17, buildingId: "village_infirmary" }],
    ["special.tools_for_all", { level: 18, buildingId: "civic_workshop" }]
  ]);
  const expectedExtension = new Map([
    [16, { id: "chapter.16.roots_of_the_road", buildingId: "memorial_grove", progressKind: SPECIAL_BUILD_TRIGGER }],
    [17, { id: "chapter.17.oath_of_care", buildingId: "village_infirmary", progressKind: SPECIAL_BUILD_TRIGGER }],
    [18, { id: "chapter.18.tools_for_all", buildingId: "civic_workshop", progressKind: SPECIAL_BUILD_TRIGGER }],
    [19, { id: "chapter.19.founders_assembly", buildingId: "founders_hall", progressKind: "town_hall_deposit_then_build" }],
    [20, { id: "chapter.20.light_of_the_village", buildingId: "village_beacon", progressKind: "town_hall_deposit_then_build" }]
  ]);

  if (canonical.size !== canonicalBuildingIds.length) errors.push("canonical_buildings:duplicate");
  if (levelChapters.length !== 20) errors.push("chapters:count");
  uniqueField(levelChapters, "id", "chapters", errors);
  uniqueField(specialArcs, "arcId", "special_arcs", errors);
  const expectedLevels = new Set(Array.from({ length: 20 }, (_, index) => index + 1));
  for (const entry of levelChapters) {
    if (!expectedLevels.delete(entry.level)) errors.push(`chapters:invalid_or_duplicate_level:${entry.level}`);
    if (!canonical.has(entry.buildingId)) errors.push(`chapters:unknown_building:${entry.buildingId}`);
    if (!entry.giverRoleId || !entry.objective?.type || !entry.repeatPolicy || !validLocalization(entry.localization)) errors.push(`chapters:missing_shape:${entry.id}`);
    if (!entry.reward?.id || !entry.reward.repeatPolicy) errors.push(`chapters:missing_reward_shape:${entry.id}`);
    if (entry.level >= 16 && entry.level <= 20) {
      const expected = expectedExtension.get(entry.level);
      if (!expected || entry.id !== expected.id || entry.buildingId !== expected.buildingId || entry.progressKind !== expected.progressKind || entry.buildTrigger !== expected.progressKind || entry.runtimeStatus !== SPECIAL_RUNTIME_STATUS) errors.push(`chapters:invalid_extension_plan:${entry.id}`);
      if (entry.level <= 18 && !expectedSpecial.has(entry.questArcId)) errors.push(`chapters:invalid_special_plan:${entry.id}`);
      if (entry.level >= 19 && (entry.questArcId !== null || entry.requirements.length !== 4 || entry.reward.kind !== "none" || entry.reward.repeatPolicy !== "none")) errors.push(`chapters:invalid_final_city_plan:${entry.id}`);
    }
  }
  for (const level of expectedLevels) errors.push(`chapters:missing_level:${level}`);
  const referencedBuildings = new Set(levelChapters.flatMap((entry) => [entry.buildingId, ...(entry.startBuildingIds || [])]));
  for (const buildingId of canonical) if (!referencedBuildings.has(buildingId)) errors.push(`canonical_buildings:unused:${buildingId}`);

  if (specialArcs.length !== 3) errors.push("special_arcs:count");
  let rareUtilityCount = 0;
  for (const arc of specialArcs) {
    const expected = expectedSpecial.get(arc.arcId);
    if (!expected || arc.level !== expected.level || arc.minLevel !== expected.level || arc.buildingId !== expected.buildingId) errors.push(`special_arcs:canonical_mismatch:${arc.arcId}`);
    if (!canonical.has(arc.buildingId) || arc.buildTrigger !== SPECIAL_BUILD_TRIGGER || arc.runtimeStatus !== SPECIAL_RUNTIME_STATUS || arc.oneTimePolicy !== "once_per_village") errors.push(`special_arcs:invalid_future_semantics:${arc.arcId}`);
    if (!ALLOWED_DEFERRED_REWARD_POLICIES.includes(arc.deferredRewardPolicy)) errors.push(`special_arcs:invalid_deferred_policy:${arc.arcId}`);
    if (arc.deferredRewardPolicy === "rare_utility_cosmetic") rareUtilityCount++;
    if (![arc.titleKey, arc.summaryKey, arc.completionKey, arc.buildKey, arc.deferredPolicyKey].every(validKey)) errors.push(`special_arcs:invalid_localization:${arc.arcId}`);
    if (arc.steps?.length !== 3) errors.push(`special_arcs:step_count:${arc.arcId}`);
    uniqueField(arc.steps || [], "id", `special_steps:${arc.arcId}`, errors);
    for (const [index, questStep] of (arc.steps || []).entries()) {
      if (questStep.number !== index + 1 || questStep.objective?.type !== "inventory_turn_in" || !validLocalization(questStep.localization) || questStep.repeatPolicy !== "once_per_village") errors.push(`special_arcs:invalid_step:${arc.arcId}:${questStep?.id}`);
      for (const requirement of questStep.requirements || []) {
        if (!requirement.itemId?.startsWith("minecraft:") || !Number.isInteger(requirement.amount) || requirement.amount < 1 || FORBIDDEN_SPECIAL_ITEMS.has(requirement.itemId)) errors.push(`special_arcs:invalid_requirement:${arc.arcId}:${questStep?.id}`);
      }
    }
  }
  if (rareUtilityCount > 1) errors.push("special_arcs:too_many_rare_utility_policies");

  uniqueField(arcAvailability, "arcId", "arc_availability", errors);
  for (const entry of arcAvailability) {
    if (!entry?.arcId || !Number.isInteger(entry.minLevel) || entry.minLevel < 1 || !Number.isInteger(entry.finalReadyLevel) || entry.finalReadyLevel < entry.minLevel || entry.kind === "special_metadata") errors.push(`arc_availability:invalid:${entry?.arcId || "unknown"}`);
  }
  if (arcAvailability.some((entry) => expectedSpecial.has(entry.arcId))) errors.push("arc_availability:planned_special_active");

  if (craftsmanArcs.length !== 4) errors.push("craftsman_arcs:count");
  uniqueField(craftsmanArcs, "id", "craftsman_arcs", errors);
  const expectedCraftsmanGates = new Map([["arc.farmer", 2], ["arc.blacksmith", 3], ["arc.cartographer", 4], ["arc.miner", 6]]);
  for (const arc of craftsmanArcs) {
    if (expectedCraftsmanGates.get(arc.id) !== arc.minLevel || !arc.roleId || !arc.legacyRole || arc.objective?.type !== "inventory_turn_in" || !validLocalization(arc.localization)) errors.push(`craftsman_arcs:invalid:${arc?.id || "unknown"}`);
    if (arc.steps?.length !== 5) errors.push(`craftsman_arcs:step_count:${arc?.id || "unknown"}`);
    uniqueField(arc.steps || [], "id", `craftsman_steps:${arc?.id || "unknown"}`, errors);
  }

  for (const key of ["quest_step", "discounts"]) {
    const mapping = legacyMigrationMap[key];
    if (!mapping?.targetPattern || mapping.regrantRewards !== false) errors.push(`migration:invalid:${key}`);
  }
  if (Object.hasOwn(legacyMigrationMap, "specialQuest") || Object.hasOwn(legacyMigrationMap, "specialBuiltAliases")) errors.push("migration:unexpected_special_alias");
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
