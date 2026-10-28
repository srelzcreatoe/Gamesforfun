// Sound playback for the night: positional one-shots, looping beds that are
// re-triggered on a timer (and stopped through their SoundInstance), and the
// camera relay (sounds from the room on the live camera are also played to
// the guard, softer, like a feed's microphone).

import { system } from '@minecraft/server';
import { OFFICE } from '../data/layout.js';
import { CAMERA_BY_ID } from '../data/cameras.js';
import { ROOMS } from '../data/layout.js';
import { dim, W } from './world_io.js';
import { log } from './log.js';

/** Named spots (local coordinates) a sound can be anchored to. */
export const SPOTS = Object.freeze({
  door_l: { x: 30.0, y: 1.5, z: 66.0 },
  door_r: { x: 42.5, y: 1.5, z: 66.0 },
  vent_l: { x: OFFICE.vents.L.x + 0.5, y: 6.0, z: OFFICE.vents.L.z + 0.5 },
  vent_r: { x: OFFICE.vents.R.x + 0.5, y: 6.0, z: OFFICE.vents.R.z + 0.5 },
  office: { x: 36.5, y: 1.6, z: 65.5 },
  near_office: { x: 36.5, y: 2.0, z: 56.0 },
  desk: { x: 34.5, y: 1.4, z: 60.5 },
  cam8: { x: 10.5, y: 1.0, z: 25.5 },
  midway: { x: 6.5, y: 2.0, z: 21.5 },
  stage: { x: 38.5, y: 3.0, z: 6.0 },
  kitchen: { x: 70.5, y: 1.5, z: 7.5 },
});

/** @param {{ x: number, y: number, z: number }} p */
function roomAt(p) {
  return ROOMS.find((r) => p.x >= r.box[0] && p.x <= r.box[2] + 1 && p.z >= r.box[1] && p.z <= r.box[3] + 1)?.id;
}

/** Loop lengths in ticks (must match the generated .ogg lengths). */
export const LOOPS = Object.freeze({
  'fnar.amb.office': 200,
  'fnar.amb.fan': 80,
  'fnar.amb.building': 480,
  'fnar.cam.hum': 200,
  'fnar.tophat.show': 320,
  'fnar.tophat.show_slow': 320,
  'fnar.music.title': 800,
  'fnar.music.showtime': 960,
  'fnar.amb.light_buzz': 40,
  'fnar.amb.duct': 120,
});

export class Audio {
  constructor() {
    /** @type {Map<string, { id: string, next: number, inst: any[], where: any, vol: number, player: any }>} */
    this.loops = new Map();
  }

  /**
   * One-shot sound.
   * @param {string} id sound event
   * @param {{ x: number, y: number, z: number } | string | null} where local position, a SPOTS key, or null = at the player
   * @param {any} player the guard
   * @param {{ vol?: number, pitch?: number, relayCam?: string | null }} [o]
   */
  play(id, where, player, o = {}) {
    const vol = o.vol ?? 1;
    const pitch = o.pitch ?? 1;
    try {
      const p = typeof where === 'string' ? SPOTS[where] : where;
      if (!p) {
        player?.playSound(id, { volume: vol, pitch });
        return;
      }
      dim().playSound(id, W(p.x, p.y, p.z), { volume: vol, pitch });
      // Camera microphone: a sound in the live camera's room is relayed to the guard.
      if (o.relayCam && player) {
        const cam = CAMERA_BY_ID[o.relayCam];
        if (cam && roomAt(p) === cam.room) player.playSound(id, { volume: vol * 0.55, pitch });
      }
    } catch (e) {
      log.warn(`sound ${id}: ${e?.message ?? e}`);
    }
  }

  /**
   * Start (or keep) a loop under `key`. where as in play(); null = at the player.
   * @param {import('@minecraft/server').Player} player
   */
  loop(key, id, where, player, vol = 1) {
    const cur = this.loops.get(key);
    if (cur && cur.id === id) return;
    if (cur) this.stop(key);
    this.loops.set(key, { id, next: 0, inst: [], where, vol, player });
  }

  stop(key) {
    const l = this.loops.get(key);
    if (!l) return;
    for (const inst of l.inst) {
      try {
        inst?.stop();
      } catch {
        // already finished
      }
    }
    this.loops.delete(key);
  }

  stopAll() {
    for (const k of [...this.loops.keys()]) this.stop(k);
  }

  tick() {
    const now = system.currentTick;
    for (const l of this.loops.values()) {
      if (now < l.next) continue;
      l.next = now + (LOOPS[l.id] ?? 200);
      try {
        let inst;
        const p = typeof l.where === 'string' ? SPOTS[l.where] : l.where;
        if (!p) inst = l.player?.playSound(l.id, { volume: l.vol });
        else inst = dim().playSound(l.id, W(p.x, p.y, p.z), { volume: l.vol });
        l.inst = [...l.inst.slice(-1), inst]; // the previous copy may still be fading
      } catch (e) {
        log.warn(`loop ${l.id}: ${e?.message ?? e}`);
        l.next = now + 100;
      }
    }
  }
}
