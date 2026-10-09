// Seasonal decorations (Halloween, Christmas) from the device's date.
//
// The cells come from tools/gen_holidays.mjs (data/holiday_decor.generated.js):
// every one is air in the built map and clear of camera sight lines,
// animatronic routes, the guidance graph, doorways and controls. They are
// placed only into air and removed only where the decoration block is still
// there, so nothing else in the map can ever be overwritten. The season that
// is currently placed is stored in the fb:holiday dynamic property; a failed
// (unloaded) cell leaves it unchanged so the next lobby visit tries again.

import { system } from '@minecraft/server';
import { HOLIDAY_DECOR } from '../data/holiday_decor.generated.js';
import { PALETTE } from '../data/palette.js';
import { setLocal, typeAtLocal } from './world_io.js';
import { readHoliday, storeHoliday } from './persistence.js';
import { log } from './log.js';

const PER_SLICE = 48;

/** 'halloween' (Oct 15 - Nov 2), 'christmas' (Dec 10 - Jan 6) or null. */
export function seasonFor(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if ((m === 10 && d >= 15) || (m === 11 && d <= 2)) return 'halloween';
  if ((m === 12 && d >= 10) || (m === 1 && d <= 6)) return 'christmas';
  return null;
}

export class Holidays {
  constructor() {
    this.busy = false;
    this.lastResult = null;
  }

  /** Bring the placed decorations in line with `want` (a season or null). Time-sliced; returns true if work started. */
  sync(want) {
    if (this.busy) return false;
    const have = readHoliday();
    if (have === want) return false;
    this.busy = true;
    system.runJob(this.job(have, want));
    return true;
  }

  *job(have, want) {
    let failed = 0;
    try {
      if (have && HOLIDAY_DECOR[have]) failed += yield* this.paint(HOLIDAY_DECOR[have], false);
      if (want && HOLIDAY_DECOR[want]) failed += yield* this.paint(HOLIDAY_DECOR[want], true);
      if (!failed) storeHoliday(want);
      this.lastResult = { have, want, failed };
      if (failed) log.warn(`holiday decorations: ${failed} cells could not be changed (unloaded); will retry`);
    } finally {
      this.busy = false;
    }
  }

  /** Place (into air) or remove (back to air, only if the decoration is still there). Returns failures. */
  *paint(set, place) {
    let failed = 0;
    const { keys, cells } = set;
    for (let i = 0; i < cells.length; i += 4) {
      const [x, y, z, k] = [cells[i], cells[i + 1], cells[i + 2], cells[i + 3]];
      const key = keys[k];
      const t = typeAtLocal(x, y, z);
      if (t === undefined) {
        failed++;
      } else {
        try {
          if (place && t === 'minecraft:air') setLocal(x, y, z, key);
          else if (!place && t === PALETTE[key].name) setLocal(x, y, z, 'air');
        } catch {
          failed++;
        }
      }
      if ((i / 4) % PER_SLICE === PER_SLICE - 1) yield;
    }
    return failed;
  }
}
