import { world } from "@minecraft/server";

/**
 * The first sixty seconds.
 *
 * The mod had no entry point at all. The Oracle Bell that founds a village had
 * no crafting recipe, so in survival a village could not be founded - the only
 * way to meet one was to wander until worldgen produced it. And nothing ever
 * told a new player the mod was installed, let alone what to do about it.
 *
 * For a Bedrock addon that is not a small gap. Someone installs it to record
 * two minutes of video, and someone else installs it because they watched that
 * video; both of them need the first thing to happen quickly and on purpose.
 *
 * So: the bell is craftable now (see recipes/oracle_bell.json), and this says
 * so once, to each player, the first time they arrive.
 *
 * All text goes through `.lang` keys rather than literals - the rule the
 * ratchet in tests/lang_ratchet.mjs enforces for new content. Only `ru_RU` is
 * meant to be read today; `en_US` is filled in so the pair stays mirrored.
 */

/** Set on a player once they have been greeted, so it happens exactly once. */
const PROP_GREETED = "village:greeted";

export const ONBOARDING_KEYS = Object.freeze({
  what: "growing_villages.onboarding.what",
  how: "growing_villages.onboarding.how",
  charter: "growing_villages.onboarding.charter"
});

/** The greeting, as a single raw message rather than three chat lines. */
export function welcomeMessage() {
  return {
    rawtext: [
      { translate: ONBOARDING_KEYS.what }, { text: "\n" },
      { translate: ONBOARDING_KEYS.how }, { text: "\n" },
      { translate: ONBOARDING_KEYS.charter }
    ]
  };
}

/** True when this player has never been greeted. Never throws. */
export function needsGreeting(player) {
  try {
    return player?.getDynamicProperty?.(PROP_GREETED) !== true;
  } catch (error) {
    // A player whose properties cannot be read is not worth greeting twice
    // over, and definitely not worth an exception in a spawn handler.
    return false;
  }
}

/**
 * Greets one player if they have not been greeted before.
 *
 * The flag is written BEFORE the message is sent, deliberately: greeting twice
 * is worse than not greeting at all, and a send that fails is not a reason to
 * try again on every respawn.
 */
export function greet(player) {
  if (!needsGreeting(player)) return { ok: false, reason: "already_greeted" };
  try {
    player.setDynamicProperty(PROP_GREETED, true);
  } catch (error) {
    return { ok: false, reason: "flag_write_failed" };
  }
  try {
    player.sendMessage(welcomeMessage());
  } catch (error) {
    console.warn("[village] could not greet a player: " + error);
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true };
}

/**
 * Starts listening for players arriving.
 *
 * `playerSpawn` fires on respawn as well as on first join, and `initialSpawn`
 * is what separates the two - but the per-player flag is what actually
 * guarantees once-only, so a build where that field is missing still behaves.
 */
export function startOnboarding() {
  try {
    world.afterEvents.playerSpawn.subscribe((event) => {
      if (event?.initialSpawn === false) return;
      const player = event?.player;
      if (!player) return;
      try {
        greet(player);
      } catch (error) {
        console.warn("[village] onboarding failed: " + error);
      }
    });
  } catch (error) {
    // An engine without playerSpawn simply gets no greeting; nothing else in
    // the mod depends on this running.
    console.warn("[village] playerSpawn unavailable, skipping onboarding: " + error);
  }
}
