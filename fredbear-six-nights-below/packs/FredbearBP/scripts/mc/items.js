// The guard's kit: three locked tool items (cannot be dropped or moved).
//   slot 0  Camera Tablet  - raise/lower the monitor; camera map while it is up
//   slot 1  Office Remote  - accessible menu for every office control
//   slot 2  Shift Guide    - rules, controls and counterplay summary
// Slot 4 is the neutral "scroll anchor" used for hotbar camera switching.

import { ItemStack, ItemLockMode, EntityComponentTypes } from '@minecraft/server';
import { log } from './log.js';

export const ITEMS = Object.freeze({ tablet: 'fb:tablet', remote: 'fb:remote', guide: 'fb:guide' });
export const ANCHOR_SLOT = 4;

export function giveKit(player) {
  try {
    const inv = player.getComponent(EntityComponentTypes.Inventory);
    const c = inv?.container;
    if (!c) return;
    c.clearAll();
    const kit = [{ id: ITEMS.tablet, slot: 0 }, { id: ITEMS.remote, slot: 1 }, { id: ITEMS.guide, slot: 2 }];
    for (const { id, slot } of kit) {
      const s = new ItemStack(id, 1);
      s.lockMode = ItemLockMode.slot;
      s.keepOnDeath = true;
      c.setItem(slot, s);
    }
    player.selectedSlotIndex = ANCHOR_SLOT;
  } catch (e) {
    log.warn(`kit: ${e?.message ?? e}`);
  }
}

export function clearKit(player) {
  try {
    player.getComponent(EntityComponentTypes.Inventory)?.container?.clearAll();
  } catch (e) {
    log.warn(`clear kit: ${e?.message ?? e}`);
  }
}
