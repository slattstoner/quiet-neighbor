import { world, system } from "@minecraft/server";
import { foundVillageAtLevel, findNearestElder } from "./village.js";
import { facingFromDirection } from "./util.js";
import { openElderMenu, openCraftsmanMenu, openOldtimerMenu, openAlchemistMenu, openSentinelMenu } from "./ui.js";
import { startAmbientDialogue } from "./dialogue.js";
import { startTetherLoop, repairGolem } from "./npc.js";
import { startProductionLoop } from "./production.js";
import { startExplorationVillageLoop } from "./worldgen.js";
import { startSpecialContentLoop } from "./special_content.js";
import { startFortificationRepairLoop } from "./fortification_repair.js";
import { startQuarterLoop } from "./quarter_runtime.js";
import { startPatrolLoop } from "./patrol.js";
import { SURVEY_CHARTER_ID, CHARTER_RANGE, charterMessage, useSurveyCharter } from "./outpost_runtime.js";
import { reportMissingStructures } from "./structure_build.js";

const ORACLE_BELL_ID = "village:oracle_bell";
const LEVEL_BELL_TARGETS = new Map([
  [ORACLE_BELL_ID, 1],
  ...Array.from({ length: 10 }, (_, index) => [`village:oracle_bell_level_${index + 1}`, index + 1])
]);

world.afterEvents.itemUse.subscribe((event) => {
  const { source: player, itemStack } = event;
  if (!player || player.typeId !== "minecraft:player") return;

  // The survey charter marks a site outside the village: an abandoned mine,
  // a fallen watchtower, a forest camp, an old quarry. One per corner, four
  // per village, always well outside the wall's final reach.
  if (itemStack?.typeId === SURVEY_CHARTER_ID) {
    const elder = findNearestElder(player.dimension, player.location, CHARTER_RANGE);
    if (!elder) {
      player.sendMessage(charterMessage({ ok: false, reason: "no_village" }));
      return;
    }
    player.sendMessage("§7Ты разворачиваешь грамоту и сверяешь её со старыми отметками...");
    system.run(() => {
      try {
        player.sendMessage(charterMessage(useSurveyCharter(player, elder)));
      } catch (e) {
        player.sendMessage(charterMessage(null));
        console.warn("[village] survey charter failed: " + e);
      }
    });
    return;
  }

  const targetLevel = LEVEL_BELL_TARGETS.get(itemStack?.typeId);
  if (!targetLevel) return;

  const dimension = player.dimension;
  const feet = player.location;
  const origin = { x: Math.floor(feet.x), y: Math.floor(feet.y), z: Math.floor(feet.z) };
  const facing = facingFromDirection(player.getViewDirection());

  const nearby = findNearestElder(dimension, origin, 40);
  if (nearby) {
    player.sendMessage("§cПоблизости уже есть деревня. Отойди подальше, прежде чем звонить в колокол снова.");
    return;
  }

  const label = targetLevel === 1 ? "обычный Колокол-Оракул" : `тестовый колокол уровня ${targetLevel}`;
  player.sendMessage(`§7Звенит ${label}... деревня закладывается, это займёт мгновение.`);
  system.run(() => {
    try {
      foundVillageAtLevel(player, origin, facing, targetLevel);
      player.sendMessage(`§eКолокол: §rДеревня создана сразу на уровне ${targetLevel}.`);
    } catch (e) {
      // This used to always say "surface is too uneven" regardless of what
      // actually went wrong - founding never throws a terrain-specific
      // error (see terrain.js's prepareSite: an uneven surface is handled
      // by digging/filling deeper, not by rejecting the site), so that
      // message was actively misleading for any other failure. A recent
      // one: a deprecated spawnEntity() call threw InvalidArgumentError on
      // every single founding attempt, and the old wording made that look
      // like a terrain problem instead of the actual bug it was.
      player.sendMessage("§cНе удалось заложить деревню здесь. Попробуй другое место или посмотри детали ошибки в логе.");
      console.warn("[village] bell village creation failed: " + e);
    }
  });
});

world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  const { player, target } = event;
  if (!target) return;

  // Elder: always our menu
  if (target.hasTag("village_elder")) {
    event.cancel = true;
    system.run(() => openElderMenu(player, target));
    return;
  }

  // Iron golems: hand them an iron ingot to patch them up after a rough night
  if (target.hasTag("village_golem")) {
    const held = player.getComponent("minecraft:equippable")?.getEquipment("Mainhand");
    if (held?.typeId === "minecraft:iron_ingot") {
      event.cancel = true;
      system.run(() => {
        const result = repairGolem(player, target);
        if (result.ok) {
          player.sendMessage(`§aСтраж починен. §7Прочность: ${Math.round(result.current)}/${Math.round(result.max)}`);
          try {
            target.dimension.playSound("random.anvil_use", target.location);
          } catch (e) { /* sound is optional */ }
        } else if (result.reason === "already_full") {
          player.sendMessage("§7Этот страж цел - чинить нечего.");
        } else if (result.reason === "no_ingot") {
          player.sendMessage("§cНужен железный слиток.");
        }
      });
    }
    return;
  }

  if (target.hasTag("village_oldtimer")) {
    event.cancel = true;
    system.run(() => openOldtimerMenu(player, target));
    return;
  }

  if (target.hasTag("village_alchemist")) {
    event.cancel = true;
    system.run(() => openAlchemistMenu(player));
    return;
  }

  // Tower guards: same convention as craftsmen - a normal tap opens the
  // watchman's courier arc, sneak-tapping falls through to whatever vanilla
  // would have done with this villager.
  if (target.hasTag("village_guard")) {
    if (player.isSneaking) return;
    event.cancel = true;
    system.run(() => openSentinelMenu(player, target));
    return;
  }

  // Craftsmen: a normal tap opens the quest menu (this is what testing
  // showed people expect), while sneak-tapping falls through to the
  // vanilla trading screen so both are still reachable.
  if (target.hasTag("village_crafter")) {
    if (player.isSneaking) return; // let vanilla trading happen
    event.cancel = true;
    system.run(() => openCraftsmanMenu(player, target));
  }
});

// Everything that touches the world must wait until the world is actually
// ready. Calling world.sendMessage during early execution (while the script
// file is first evaluated) throws and takes the entire pack down with it,
// so all start-up work is deferred into system.run.
system.run(() => {
  // Bedrock terminates the whole script runtime when one tick hangs past the
  // watchdog threshold (3000 ms) - which is how a heavy build used to take
  // the pack down mid-structure, losing whatever was still unbuilt. Every
  // heavy pass now runs as a system.runJob, so this should never fire;
  // surviving it if it ever does beats losing the village to one slow tick.
  try {
    system.beforeEvents.watchdogTerminate.subscribe((event) => {
      event.cancel = true;
      console.warn("[village] watchdog termination cancelled: " + event.terminateReason);
    });
  } catch (e) {
    /* older engines have no watchdogTerminate event - nothing to guard */
  }

  // Said once, at start-up: a manifest record whose .mcstructure file is not
  // in the pack would otherwise show up only as a building that never appeared.
  try {
    reportMissingStructures();
  } catch (e) {
    console.warn("[village] structure manifest check failed: " + e);
  }

  startAmbientDialogue();
  startTetherLoop();
  startProductionLoop();
  startExplorationVillageLoop();
  startSpecialContentLoop();
  startFortificationRepairLoop();
  startQuarterLoop();
  startPatrolLoop();
  world.sendMessage("§7[Growing Villages] бета загружена.");
});
