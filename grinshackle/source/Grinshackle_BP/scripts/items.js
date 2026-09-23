// Chainbound Dial (configuration item) and Rattle Lure (decoy). Dial: given once per player on first join, recoverable without duplicates.
import { world, ItemStack, GameMode } from '@minecraft/server';
import { IDS, SOUNDS } from './constants.js';
import { S } from './state.js';
import { safe, isValid, dist, flatDist, sub, norm, bounded } from './util.js';
import * as config from './config.js';
import * as timers from './timers.js';
import * as scan from './world_scan.js';
import * as perception from './perception.js';
import * as audio from './audio.js';
import * as ui from './ui.js';
import { cue, notify } from './text.js';

const LURE_STATES = ['OBSERVE', 'INVESTIGATE', 'SEARCH', 'STALK'];

function container(player) { return safe(() => player.getComponent('minecraft:inventory')?.container, undefined); }
export function hasItem(player, typeId) {
  const c = container(player); if (!c) return false;
  for (let i = 0; i < c.size; i++) { const it = safe(() => c.getItem(i), undefined); if (it && it.typeId === typeId) return true; }
  return false;
}
/** Explicit recovery: one dial, never a duplicate. Returns a message. */
export function giveDial(player) {
  if (!isValid(player)) return 'Run this as a player.';
  if (hasItem(player, IDS.ITEM_DIAL)) return 'You already carry a Chainbound Dial.';
  const c = container(player); if (!c) return 'No inventory available.';
  const stack = new ItemStack(IDS.ITEM_DIAL, 1);
  safe(() => stack.setLore(['§7Use to open the Grinshackle settings.', '§8Craft: gold ingots around a chain.']));
  const left = safe(() => c.addItem(stack), stack);
  if (left) return 'Your inventory is full; make room and try again.';
  config.setPref(player, 'dialGiven', true);
  return 'Chainbound Dial given.';
}
/** First join only: give the dial once per player. */
export function giveDialOnce(player) {
  if (!isValid(player)) return;
  const prefs = config.prefs(player);
  if (prefs.dialGiven) return;
  if (hasItem(player, IDS.ITEM_DIAL)) { config.setPref(player, 'dialGiven', true); return; }
  const c = container(player); if (!c) return;
  const stack = new ItemStack(IDS.ITEM_DIAL, 1);
  safe(() => stack.setLore(['§7Use to open the Grinshackle settings.', '§8Craft: gold ingots around a chain.']));
  const left = safe(() => c.addItem(stack), stack);
  if (!left) { config.setPref(player, 'dialGiven', true); notify(player, 'A Chainbound Dial was added to your inventory. Use it to configure Grinshackle.'); }
}
export function onPlayerSpawn(event) {
  const player = event && event.player; if (!isValid(player)) return;
  if (event.initialSpawn) {
    safe(() => player.setDynamicProperty(IDS.PLAYER_LAST_SPAWN, S.tick));
    const owner = safe(() => world.getDynamicProperty(IDS.PROP_OWNER), undefined);
    if (typeof owner !== 'string' || !owner) { safe(() => world.setDynamicProperty(IDS.PROP_OWNER, player.id)); S.owner = player.id; }
    else S.owner = owner;
    timers.schedule(20, () => giveDialOnce(player), 'system');
  }
}
export function onItemUse(event) {
  const player = event && event.source; const stack = event && event.itemStack;
  if (!isValid(player) || !stack || player.typeId !== 'minecraft:player') return;
  if (stack.typeId === IDS.ITEM_DIAL) { ui.openDial(player); return; }
  if (stack.typeId === IDS.ITEM_LURE) useLure(player, stack);
}

function lurePoint(player) {
  const dim = player.dimension;
  const hit = safe(() => player.getBlockFromViewDirection({ maxDistance: 8, includeLiquidBlocks: false, includePassableBlocks: false }), undefined);
  let point;
  if (hit && hit.block) {
    const b = hit.block; const loc = b.location;
    const f = hit.faceLocation || { x: 0.5, y: 0.5, z: 0.5 };
    // step out of the hit block toward the face that was hit, then settle on the floor
    const cand = { x: loc.x + f.x + (f.x <= 0.001 ? -0.5 : f.x >= 0.999 ? 0.5 : 0), y: loc.y + f.y + (f.y >= 0.999 ? 0.5 : f.y <= 0.001 ? -0.5 : 0), z: loc.z + f.z + (f.z <= 0.001 ? -0.5 : f.z >= 0.999 ? 0.5 : 0) };
    for (const dy of [0, -1, 1, -2]) {
      const q = { x: Math.floor(cand.x) + 0.5, y: Math.floor(cand.y) + dy, z: Math.floor(cand.z) + 0.5 };
      if (scan.standRoom(dim, q, 2) && scan.isSolidFloor(dim, q)) { point = q; break; }
    }
  }
  if (!point) {
    const v = safe(() => player.getViewDirection(), { x: 0, y: 0, z: 1 }); const flat = norm({ x: v.x, y: 0, z: v.z });
    const ahead = { x: player.location.x + flat.x * 5, y: player.location.y, z: player.location.z + flat.z * 5 };
    point = scan.walkableNear(dim, ahead, 2, { height: 2 });
  }
  if (point && dist(point, player.location) > 10) return undefined;
  return point;
}
/** Throw a decoy rattle. Never cancels a committed attack; repeated identical spots lose effect with visible feedback. */
export function useLure(player, stack) {
  if (!isValid(player)) return;
  const point = lurePoint(player);
  if (!point) { cue(player, 'lure_ignored'); notify(player, 'No clear floor for the lure within 10 blocks.'); return; }
  const mode = safe(() => player.getGameMode(), undefined);
  if (mode !== GameMode.Creative) {
    const c = container(player); const slot = safe(() => player.selectedSlotIndex, 0);
    const it = c ? safe(() => c.getItem(slot), undefined) : undefined;
    if (c && it && it.typeId === IDS.ITEM_LURE) { if (it.amount > 1) { it.amount -= 1; safe(() => c.setItem(slot, it)); } else safe(() => c.setItem(slot, undefined)); }
  }
  let near = 0; for (const l of S.lures) if (flatDist(l.pos, point) < 6) near++;
  const strength = near === 0 ? 1.0 : near === 1 ? 0.6 : 0.3;
  S.lures.push({ pos: point, tick: S.tick }); bounded(S.lures, 8);
  const dimId = safe(() => player.dimension.id, undefined);
  audio.fx(SOUNDS.lure, point, { volume: 0.8, radius: 20, dimensionId: dimId });
  timers.schedule(15, () => audio.fx(SOUNDS.lure, point, { volume: 0.45, radius: 20, pitch: 0.9, dimensionId: dimId }), 'encounter');
  perception.recordNoise('lure', point, player.id, 3.0 * strength);
  const r = S.record;
  if (r && LURE_STATES.includes(r.state) && strength >= 0.6) r.lureRedirect = { point, until: S.tick + (strength >= 1 ? 120 : 60), strength };
  cue(player, !r || !LURE_STATES.includes(r.state) ? (strength >= 0.6 ? 'lure_ok' : 'lure_weak') : strength >= 1 ? 'lure_ok' : strength >= 0.6 ? 'lure_weak' : 'lure_ignored');
}
