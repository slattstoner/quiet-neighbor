import { world, system } from "@minecraft/server";
import { foundVillageAtLevel, findNearestElder } from "./village.js";
import { facingFromDirection } from "./util.js";
import { openElderMenu, openCraftsmanMenu, openOldtimerMenu, openAlchemistMenu } from "./ui.js";
import { startAmbientDialogue } from "./dialogue.js";
import { startTetherLoop, repairGolem } from "./npc.js";
import { startProductionLoop } from "./production.js";
import { startExplorationVillageLoop } from "./worldgen.js";
import { startSpecialContentLoop } from "./special_content.js";

const ORACLE_BELL_ID = "village:oracle_bell";
const LEVEL_BELL_TARGETS = new Map([
  [ORACLE_BELL_ID, 1],
  ...Array.from({ length: 10 }, (_, index) => [`village:oracle_bell_level_${index + 1}`, index + 1])
]);

world.afterEvents.itemUse.subscribe((event) => {
  const { source: player, itemStack } = event;
  const targetLevel = LEVEL_BELL_TARGETS.get(itemStack?.typeId);
  if (!targetLevel || !player || player.typeId !== "minecraft:player") return;

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
  startAmbientDialogue();
  startTetherLoop();
  startProductionLoop();
  startExplorationVillageLoop();
  startSpecialContentLoop();
  world.sendMessage("§7[Growing Villages] бета загружена.");
});
