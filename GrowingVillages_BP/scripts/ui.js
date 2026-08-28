import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { effectiveRequirementsText, tryLevelUp, chestSatisfiesRequirements } from "./village.js";
import { applyCraftsmanUpgrade } from "./upgrades.js";
import { craftsmanItemLocalizationKey, getCraftsmanQuestView, tryCompleteCraftsmanTurnIn } from "./craftsman_quests.js";
import { announceToNearbyPlayers } from "./dialogue.js";
import { SPECIAL_QUESTS, getSpecialQuestStep, turnInSpecialQuest, alchemistProducts, buyAlchemistProduct } from "./special_content.js";
import { buildChapterJournalModel } from "./chapter_journal.js";
import {
  extensionMenuAvailable,
  getExtensionStatus,
  tryAdvanceSpecialArcStep,
  tryCommitExtensionBuild
} from "./extension_runtime_16_18.js";
import {
  finalCityMenuAvailable,
  getFinalCityStatus,
  tryCommitFinalCityBuild,
  tryDepositFinalCityRequirements
} from "./final_runtime_19_20.js";

// L19-20 elder chrome lives in its own namespace, separate from L16-18's
// growing_villages.ui.elder.special.* keys - a village shows at most one of
// the two entries at a time, matching its actual current level.
const FINAL_KEYS = Object.freeze({
  button: "growing_villages.ui.elder.final.button",
  title: "growing_villages.ui.elder.final.title",
  close: "growing_villages.ui.elder.final.close",
  cancel: "growing_villages.ui.elder.final.cancel",
  deposit: "growing_villages.ui.elder.final.deposit",
  build: "growing_villages.ui.elder.final.build",
  needHeader: "growing_villages.ui.elder.final.need_header",
  needLine: "growing_villages.ui.elder.final.need_line",
  ready: "growing_villages.ui.elder.final.ready",
  depositDone: "growing_villages.ui.elder.final.deposit_done",
  buildDone: "growing_villages.ui.elder.final.build_done",
  buildFailed: "growing_villages.ui.elder.final.build_failed",
  notEnough: "growing_villages.ui.elder.final.not_enough",
  noChest: "growing_villages.ui.elder.final.no_chest",
  unavailable: "growing_villages.ui.elder.final.unavailable",
  error: "growing_villages.ui.elder.final.error"
});

// Elder special-chapter chrome. These keys live in their own namespace so the
// existing chronicle and craftsman localisation scopes stay untouched.
const EXTENSION_KEYS = Object.freeze({
  button: "growing_villages.ui.elder.special.button",
  title: "growing_villages.ui.elder.special.title",
  close: "growing_villages.ui.elder.special.close",
  cancel: "growing_villages.ui.elder.special.cancel",
  turnIn: "growing_villages.ui.elder.special.turn_in",
  build: "growing_villages.ui.elder.special.build",
  stepHeader: "growing_villages.ui.elder.special.step_header",
  needHeader: "growing_villages.ui.elder.special.need_header",
  needLine: "growing_villages.ui.elder.special.need_line",
  ready: "growing_villages.ui.elder.special.ready",
  stepDone: "growing_villages.ui.elder.special.step_done",
  arcDone: "growing_villages.ui.elder.special.arc_done",
  buildDone: "growing_villages.ui.elder.special.build_done",
  buildFailed: "growing_villages.ui.elder.special.build_failed",
  notEnough: "growing_villages.ui.elder.special.not_enough",
  noInventory: "growing_villages.ui.elder.special.no_inventory",
  staleState: "growing_villages.ui.elder.special.stale_state",
  unavailable: "growing_villages.ui.elder.special.unavailable",
  error: "growing_villages.ui.elder.special.error"
});

function isUsableEntity(entity) {
  return !!entity && entity.isValid !== false;
}

// Bedrock's native RawMessage.with accepts a string[] OR a single RawMessage
// (an object with a rawtext array) - never an array containing raw-message
// objects directly. Most calls here only ever need plain string substitutions
// (amounts, counts) and pass a string[]. When a substitution itself must be a
// translated key (e.g. an item name), pass a single { rawtext: [...] } object
// as withArgs instead of an array - passing a mixed array of objects fails
// the native type conversion at the game engine, not in this JS layer, so it
// only ever surfaces on-device.
function translated(key, withArgs = []) {
  if (Array.isArray(withArgs)) {
    return withArgs.length > 0 ? { translate: key, with: withArgs } : { translate: key };
  }
  return { translate: key, with: withArgs };
}

function journalBody(model) {
  if (model.isFallback && !model.chapterKeys) return translated(model.keys.safeError);

  const parts = [
    translated(model.keys.currentLevel, [String(model.level)]), { text: "\n\n" },
    translated(model.keys.chapterHeader), { text: " " }, translated(model.chapterKeys.title), { text: "\n" },
    translated(model.chapterKeys.intro), { text: "\n\n" },
    translated(model.keys.statusHeader), { text: " " },
    translated(model.chapterState === "open" ? model.keys.statusOpen
      : model.chapterState === "complete" ? model.keys.statusComplete : model.keys.statusUnknown)
  ];

  if (model.isFallback) parts.push({ text: "\n" }, translated(model.keys.safeError));
  if (model.isTerminal) {
    parts.push({ text: "\n\n" }, translated(model.keys.betaCap));
  } else if (model.nextChapterKeys) {
    parts.push(
      { text: "\n\n" }, translated(model.keys.nextGrowth), { text: " " }, translated(model.nextChapterKeys.title),
      { text: "\n" }, translated(model.keys.nextGrowthHint)
    );
  }

  parts.push({ text: "\n\n" }, translated(model.keys.arcsHeader));
  if (model.availableArcs.length === 0) {
    parts.push({ text: "\n" }, translated(model.keys.noArcs));
  } else {
    for (const arc of model.availableArcs) {
      parts.push({ text: "\n" }, translated(arc.keys.title));
    }
  }
  return { rawtext: parts };
}

export async function openVillageJournal(player, elder) {
  if (!isUsableEntity(player) || !isUsableEntity(elder)) return;
  const model = buildChapterJournalModel(elder);
  const form = new ActionFormData()
    .title(translated(model.keys.title, model.level === null ? [] : [String(model.level)]))
    .body(journalBody(model))
    .button(translated(model.keys.back));

  const response = await form.show(player);
  if (!isUsableEntity(player) || !isUsableEntity(elder) || response.canceled) return;
  if (response.selection === 0) return openElderMenu(player, elder);
}

export async function openElderMenu(player, elder) {
  if (!isUsableEntity(player) || !isUsableEntity(elder)) return;
  const journal = buildChapterJournalModel(elder);
  // Sequential level gating means these two are naturally mutually exclusive:
  // a village is never both mid-L16-18 and mid-L19-20 at once.
  const showExtension = extensionMenuAvailable(elder);
  const showFinal = !showExtension && finalCityMenuAvailable(elder);
  const form = new ActionFormData()
    .title("Староста")
    .body(effectiveRequirementsText(elder))
    .button("Проверить сундук и построить")
    .button(translated(journal.keys.button));
  if (showExtension) form.button(translated(EXTENSION_KEYS.button));
  if (showFinal) form.button(translated(FINAL_KEYS.button));
  form.button("Закрыть");

  const response = await form.show(player);
  if (!isUsableEntity(player) || !isUsableEntity(elder) || response.canceled) return;

  if (response.selection === 1) return openVillageJournal(player, elder);
  if (showExtension && response.selection === 2) return openExtensionMenu(player, elder);
  if (showFinal && response.selection === 2) return openFinalCityMenu(player, elder);

  if (response.selection === 0) {
    const check = chestSatisfiesRequirements(elder);
    if (check.finished) {
      await new MessageFormData()
        .title("Староста")
        .body("Деревня уже достигла максимума этой бета-версии. Спасибо, что помог нам вырасти!")
        .button1("Понятно")
        .button2("Закрыть")
        .show(player);
      return;
    }
    if (!check.done) {
      await new MessageFormData()
        .title("Староста")
        .body("В сундуке ратуши пока не хватает ресурсов. Загляни ещё раз, когда принесёшь всё нужное.")
        .button1("Понятно")
        .button2("Закрыть")
        .show(player);
      return;
    }
    const result = tryLevelUp(elder);
    if (result.done && result.leveledUpTo) {
      announceToNearbyPlayers(elder, `§eСтароста: §rНаконец-то! "${result.label}" готов(а). Деревня растёт!`);
    }
  }
}

function extensionErrorKey(reason) {
  if (reason === "extension_not_enough") return EXTENSION_KEYS.notEnough;
  if (reason === "extension_no_inventory") return EXTENSION_KEYS.noInventory;
  if (reason === "extension_inventory_changed") return EXTENSION_KEYS.notEnough;
  if (reason === "extension_stale_state" || reason === "extension_step_out_of_order") return EXTENSION_KEYS.staleState;
  if (reason === "extension_no_active_step" || reason === "extension_unavailable") return EXTENSION_KEYS.unavailable;
  return EXTENSION_KEYS.error;
}

function shortItemName(itemId) {
  return typeof itemId === "string" ? itemId.replace("minecraft:", "") : "?";
}

async function showExtensionMessage(player, bodyKey) {
  if (!isUsableEntity(player)) return;
  await new MessageFormData()
    .title(translated(EXTENSION_KEYS.title))
    .body(translated(bodyKey))
    .button1(translated(EXTENSION_KEYS.close))
    .button2(translated(EXTENSION_KEYS.cancel))
    .show(player);
}

function extensionStepBody(status) {
  const parts = [
    translated(status.titleKey), { text: "\n" },
    translated(status.summaryKey), { text: "\n\n" },
    translated(EXTENSION_KEYS.stepHeader, [String(status.nextStep), String(status.stepCount)]), { text: "\n" },
    translated(status.stepKeys.objectiveKey), { text: "\n\n" },
    translated(EXTENSION_KEYS.needHeader)
  ];
  for (const requirement of status.requirements) {
    parts.push({ text: "\n" }, translated(EXTENSION_KEYS.needLine,
      [String(requirement.amount), shortItemName(requirement.itemId)]));
  }
  return { rawtext: parts };
}

function extensionBuildBody(status) {
  return { rawtext: [
    translated(status.titleKey), { text: "\n" },
    translated(status.completionKey), { text: "\n\n" },
    translated(status.buildKey), { text: "\n\n" },
    translated(EXTENSION_KEYS.ready)
  ] };
}

/**
 * L16-L18 elder flow. Arc steps consume player items; the build action itself
 * costs nothing, so a failed build can never take resources or grant a level.
 */
export async function openExtensionMenu(player, elder) {
  if (!isUsableEntity(player) || !isUsableEntity(elder)) return;
  const status = getExtensionStatus(elder);
  if (!status.ok || (status.status !== "arc_step" && status.status !== "ready_to_build")) {
    await showExtensionMessage(player, EXTENSION_KEYS.unavailable);
    return;
  }

  const isBuild = status.status === "ready_to_build";
  const form = new ActionFormData()
    .title(translated(EXTENSION_KEYS.title))
    .body(isBuild ? extensionBuildBody(status) : extensionStepBody(status))
    .button(translated(isBuild ? EXTENSION_KEYS.build : EXTENSION_KEYS.turnIn))
    .button(translated(EXTENSION_KEYS.cancel));

  const response = await form.show(player);
  if (!isUsableEntity(player) || !isUsableEntity(elder) || response.canceled || response.selection !== 0) return;

  if (isBuild) {
    const result = tryCommitExtensionBuild(elder);
    if (!result.ok) {
      await showExtensionMessage(player, EXTENSION_KEYS.buildFailed);
      return;
    }
    announceToNearbyPlayers(elder, "§eСтароста: §rОбщее дело завершено. Деревня выросла.");
    await showExtensionMessage(player, EXTENSION_KEYS.buildDone);
    return;
  }

  const result = tryAdvanceSpecialArcStep(elder, player, status.stepId);
  if (!result.ok) {
    await showExtensionMessage(player, extensionErrorKey(result.reason));
    return;
  }
  await showExtensionMessage(player, result.arcComplete ? EXTENSION_KEYS.arcDone : EXTENSION_KEYS.stepDone);
}

function shortItemList(requirements) {
  return requirements.map((requirement) => `${requirement.amount}x ${shortItemName(requirement.itemId)}`).join(", ");
}

async function showFinalMessage(player, bodyKey) {
  if (!isUsableEntity(player)) return;
  await new MessageFormData()
    .title(translated(FINAL_KEYS.title))
    .body(translated(bodyKey))
    .button1(translated(FINAL_KEYS.close))
    .button2(translated(FINAL_KEYS.cancel))
    .show(player);
}

function finalDepositBody(status) {
  const parts = [translated(FINAL_KEYS.needHeader)];
  for (const requirement of status.requirements) {
    parts.push({ text: "\n" }, translated(FINAL_KEYS.needLine, [String(requirement.amount), shortItemName(requirement.itemId)]));
  }
  return { rawtext: parts };
}

/**
 * L19-20 elder flow: deposit into the town hall chest, then build. The build
 * action itself costs nothing, so a failed build never takes resources or a
 * level. Deposit and build never both appear in the same visit.
 */
export async function openFinalCityMenu(player, elder) {
  if (!isUsableEntity(player) || !isUsableEntity(elder)) return;
  const status = getFinalCityStatus(elder);
  if (!status.ok || (status.status !== "deposit_pending" && status.status !== "ready_to_build")) {
    await showFinalMessage(player, FINAL_KEYS.unavailable);
    return;
  }

  const isBuild = status.status === "ready_to_build";
  const form = new ActionFormData()
    .title(translated(FINAL_KEYS.title))
    .body(isBuild ? translated(FINAL_KEYS.ready) : finalDepositBody(status))
    .button(translated(isBuild ? FINAL_KEYS.build : FINAL_KEYS.deposit))
    .button(translated(FINAL_KEYS.cancel));

  const response = await form.show(player);
  if (!isUsableEntity(player) || !isUsableEntity(elder) || response.canceled || response.selection !== 0) return;

  if (isBuild) {
    const result = tryCommitFinalCityBuild(elder);
    if (!result.ok) {
      await showFinalMessage(player, FINAL_KEYS.buildFailed);
      return;
    }
    announceToNearbyPlayers(elder, "§eСтароста: §rВеликое дело завершено. Деревня достигла нового рубежа.");
    await showFinalMessage(player, FINAL_KEYS.buildDone);
    return;
  }

  const result = tryDepositFinalCityRequirements(elder);
  if (!result.ok) {
    const key = result.reason === "extension_not_enough" ? FINAL_KEYS.notEnough
      : result.reason === "extension_no_chest" ? FINAL_KEYS.noChest
      : FINAL_KEYS.error;
    await showFinalMessage(player, key);
    return;
  }
  await showFinalMessage(player, FINAL_KEYS.depositDone);
}

function findCraftsmanElder(npc) {
  try {
    const villageTag = npc?.getTags?.().find((tag) => tag.startsWith("village:"));
    if (!villageTag || !npc.dimension?.getEntities) return null;
    return npc.dimension.getEntities({ tags: ["village_elder", villageTag] })[0] || null;
  } catch (error) {
    return null;
  }
}

function craftsmanErrorKey(reason, view) {
  if (reason === "locked") return view?.arc?.localization?.locked || "growing_villages.ui.craftsman.quest.locked";
  if (reason === "inventory_full") return "growing_villages.ui.craftsman.quest.inventory_full";
  if (reason === "stale_state") return "growing_villages.ui.craftsman.quest.stale_state";
  if (reason === "not_enough") return "growing_villages.ui.craftsman.quest.not_enough";
  if (reason === "no_active_quest") return "growing_villages.ui.craftsman.quest.no_active_quest";
  return "growing_villages.ui.craftsman.quest.error";
}

async function showCraftsmanMessage(player, titleKey, bodyKey) {
  if (!isUsableEntity(player)) return;
  await new MessageFormData()
    .title(translated(titleKey))
    .body(translated(bodyKey))
    .button1(translated("growing_villages.ui.craftsman.quest.close"))
    .button2(translated("growing_villages.ui.craftsman.quest.cancel"))
    .show(player);
}

export async function openCraftsmanMenu(player, npc) {
  if (!isUsableEntity(player) || !isUsableEntity(npc)) return;
  const elder = findCraftsmanElder(npc);
  const view = getCraftsmanQuestView(npc, elder, player);
  if (!view.ok || view.status !== "active") {
    await showCraftsmanMessage(player, view?.arc?.localization?.title || "growing_villages.ui.craftsman.quest.title", craftsmanErrorKey(view.reason, view));
    return;
  }

  const stepLocalization = view.arc.steps[view.step].localization;
  const form = new ActionFormData()
    .title(translated(view.arc.localization.title))
    .body({ rawtext: [
      translated(stepLocalization.title), { text: "\n" },
      translated(stepLocalization.intro), { text: "\n\n" },
      translated(stepLocalization.objective, { rawtext: [
        { text: String(view.requirement.amount) },
        { translate: craftsmanItemLocalizationKey(view.requirement.itemId) }
      ] }), { text: "\n" },
      translated(stepLocalization.progress, [String(view.step + 1), "5"])
    ] })
    .button(translated("growing_villages.ui.craftsman.quest.turn_in"))
    .button(translated("growing_villages.ui.craftsman.quest.cancel"));

  const response = await form.show(player);
  if (!isUsableEntity(player) || !isUsableEntity(npc) || response.canceled || response.selection !== 0) return;

  const currentElder = findCraftsmanElder(npc);
  const result = tryCompleteCraftsmanTurnIn(npc, currentElder, player, view.stepId);
  if (!result.ok) {
    await showCraftsmanMessage(player, view.arc.localization.title, craftsmanErrorKey(result.reason, result.view || view));
    return;
  }

  if (result.upgrade && currentElder) {
    applyCraftsmanUpgrade(npc, currentElder, result.upgrade);
  }
  await showCraftsmanMessage(player, view.arc.localization.title,
    result.chainComplete ? view.arc.localization.complete : stepLocalization.complete);
}


export async function openOldtimerMenu(player, oldtimer) {
  const keys = Object.keys(SPECIAL_QUESTS);
  const form = new ActionFormData().title("Старожила").body("Я помню три места, которые можно вернуть деревне. Выбери, с чего начнём.");
  for (const key of keys) {
    const quest = SPECIAL_QUESTS[key];
    const step = getSpecialQuestStep(oldtimer, key);
    form.button(`${quest.title} (${Math.min(step + 1, quest.chain.length)}/${quest.chain.length})`);
  }
  form.button("Уйти");
  const response = await form.show(player);
  if (response.canceled || response.selection === keys.length) return;
  const key = keys[response.selection];
  const quest = SPECIAL_QUESTS[key];
  const step = getSpecialQuestStep(oldtimer, key);
  if (step >= quest.chain.length) {
    await new MessageFormData().title(quest.title).body(quest.complete).button1("Понятно").button2("Закрыть").show(player);
    return;
  }
  const current = quest.chain[step];
  const confirm = await new ActionFormData().title(`${quest.title} (${step + 1}/${quest.chain.length})`).body(current.question).button("Выполнить").button("Отмена").show(player);
  if (confirm.canceled || confirm.selection !== 0) return;
  const result = turnInSpecialQuest(player, oldtimer, key);
  const text = result.ok
    ? (result.complete ? `${quest.complete}\n\nПостройка создана: ${quest.building}.` : "Старожила кивает. Первый шаг выполнен.")
    : `Не хватает предметов: ${result.need || current.amount} × ${current.item.replace("minecraft:", "")}. Сейчас есть: ${result.have || 0}.`;
  await new MessageFormData().title("Старожила").body(text).button1("Хорошо").button2("Закрыть").show(player);
}

export async function openAlchemistMenu(player) {
  const products = alchemistProducts();
  const form = new ActionFormData().title("Алхимик").body("Ингредиенты и изумруды — и я приготовлю кое-что полезное.");
  for (const product of products) form.button(`${product.label} — ${product.cost} изумр.`);
  form.button("Уйти");
  const response = await form.show(player);
  if (response.canceled || response.selection >= products.length) return;
  const result = buyAlchemistProduct(player, response.selection);
  const text = result.ok ? `Получено: ${result.product.label}.` : result.reason === "missing_ingredient" ? `Нужен ингредиент: ${result.ingredient.replace("minecraft:", "")}.` : `Нужно изумрудов: ${result.need}.`;
  await new MessageFormData().title("Алхимик").body(text).button1("Спасибо").button2("Закрыть").show(player);
}
