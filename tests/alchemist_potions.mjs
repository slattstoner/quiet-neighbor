import { __test__, ItemStack, Potions } from "@minecraft/server";
import { ALCHEMIST_PRODUCTS, giveProduct, potionStack } from "./scripts/specials.js";

/**
 * The alchemist has to hand over the potion he charged for.
 *
 * In Bedrock a potion's effect is item data, not part of its identifier: every
 * potion in the game is `minecraft:potion`, and what it does comes from the
 * potion type stored on the stack. So `new ItemStack("minecraft:potion", 1)`
 * is the default, effectless bottle - which is what the shop handed over for
 * both of its potions. "Зелье лечения" cost 4 emeralds, "Зелье ночного зрения"
 * cost 6, and the player received the identical useless item either way.
 *
 * The fix routes potions through Potions.resolve(effect, delivery)
 * (learn.microsoft.com/minecraft/creator/scriptapi/minecraft/server/potions).
 * The mock only accepts effect and delivery ids the real catalogue knows and
 * throws otherwise, exactly as the engine does, so a wrong id fails here
 * instead of shipping as another silently-wrong bottle.
 */

let failures = 0;
function assert(condition, message) {
  if (!condition) { failures++; console.error("FAIL:", message); }
  else console.log("ok:", message);
}

function stockedPlayer(emeralds, extras = []) {
  const player = __test__.makePlayer("buyer", { x: 0, y: 70, z: 0 });
  const container = player.getComponent("minecraft:inventory").container;
  for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined);
  container.setItem(0, new ItemStack("minecraft:emerald", emeralds));
  let slot = 1;
  for (const stack of extras) container.setItem(slot++, stack);
  return { player, container };
}

function firstOf(container, typeId) {
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === typeId) return stack;
  }
  return null;
}

console.log("\n=== the shop's potions declare an effect at all ===");
{
  const potions = ALCHEMIST_PRODUCTS.filter((product) => product.id === "minecraft:potion");
  assert(potions.length > 0, `the alchemist sells potions (${potions.length})`);
  for (const product of potions) {
    assert(typeof product.potionEffect === "string" && product.potionEffect.length > 0,
      `"${product.label}" names the effect it is supposed to have (${product.potionEffect})`);
  }
  const effects = new Set(potions.map((product) => product.potionEffect));
  assert(effects.size === potions.length,
    `no two potions on the menu are secretly the same item (${effects.size} distinct effects for ${potions.length} potions)`);
}

console.log("\n=== each declared effect actually resolves on this engine ===");
for (const product of ALCHEMIST_PRODUCTS.filter((entry) => entry.potionEffect)) {
  const stack = potionStack(product.potionEffect);
  assert(stack !== null, `"${product.label}" resolves to a real potion (${product.potionEffect})`);
  assert(stack?._potionEffect === product.potionEffect,
    `and it carries that exact effect, not a default bottle (${stack?._potionEffect})`);
}

console.log("\n=== buying a potion delivers that potion ===");
{
  const healing = ALCHEMIST_PRODUCTS.find((product) => product.potionEffect === "healing");
  const { player, container } = stockedPlayer(64, [new ItemStack(healing.ingredient, 4)]);
  const result = giveProduct(player, healing);
  assert(result.ok, `the purchase goes through (reason: ${result.reason})`);
  const received = firstOf(container, "minecraft:potion");
  assert(!!received, "the player is actually holding a potion afterwards");
  assert(received?._potionEffect === "healing",
    `and it is the healing potion they paid for (got: ${received?._potionEffect ?? "an effectless bottle"})`);
}

console.log("\n=== two different potions never merge into one stack ===");
{
  const [healing, night] = ["healing", "night_vision"]
    .map((effect) => ALCHEMIST_PRODUCTS.find((product) => product.potionEffect === effect));
  const { player, container } = stockedPlayer(64, [new ItemStack(healing.ingredient, 8)]);
  assert(giveProduct(player, healing).ok, "the healing potion is bought");
  assert(giveProduct(player, night).ok, "the night-vision potion is bought");

  const effects = [];
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack?.typeId === "minecraft:potion") effects.push(stack._potionEffect);
  }
  assert(effects.length === 2, `both potions occupy their own slot (${effects.length} potion slots)`);
  assert(new Set(effects).size === 2, `and they are two different potions (${effects.join(", ")})`);
}

console.log("\n=== an engine with no potion support refuses the sale rather than charging ===");
{
  // A silent fallback to a plain bottle is exactly the bug being fixed, so an
  // unresolvable potion has to cost the player nothing at all.
  const realResolve = Potions.resolve;
  Potions.resolve = () => { throw new Error("InvalidPotionEffectTypeError: unsupported on this build"); };
  try {
    const healing = ALCHEMIST_PRODUCTS.find((product) => product.potionEffect === "healing");
    const { player, container } = stockedPlayer(64, [new ItemStack(healing.ingredient, 4)]);
    const result = giveProduct(player, healing);
    assert(!result.ok, `the sale is refused (ok: ${result.ok})`);
    assert(result.reason === "unavailable", `and says why (reason: ${result.reason})`);
    assert(firstOf(container, "minecraft:emerald")?.amount === 64, "no emeralds were taken");
    assert(firstOf(container, healing.ingredient)?.amount === 4, "and no bottle was taken either");
  } finally {
    Potions.resolve = realResolve;
  }
}

console.log("\n=== ordinary, non-potion goods are unaffected ===");
{
  const dust = ALCHEMIST_PRODUCTS.find((product) => product.id === "minecraft:glowstone_dust");
  const { player, container } = stockedPlayer(64);
  const result = giveProduct(player, dust);
  assert(result.ok, `a plain item still sells (reason: ${result.reason})`);
  assert(firstOf(container, dust.id)?.amount === dust.amount,
    `and arrives in the right amount (${firstOf(container, dust.id)?.amount})`);
  assert(firstOf(container, "minecraft:emerald")?.amount === 64 - dust.cost,
    "with exactly the listed price taken");
}

console.log(failures === 0 ? "\nALL ALCHEMIST POTION CHECKS PASSED" : `\n${failures} ALCHEMIST POTION CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
