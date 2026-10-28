// World-side devices: the office shutters (animated top-down), hall lights
// (invisible light blocks + the lamp outside each door), button glow, ceiling
// vents, the CRT and phone props, ceiling lamps by group, stage spotlights,
// the Cabaret curtain, the show-tape VU meter and the camera "IR lights".
//
// Every change is idempotent and remembered, so reset() can always return the
// building to its night-start state.

import { system } from '@minecraft/server';
import { OFFICE, CABARET, SHOW_TAPE, DAY_LIGHTS } from '../data/layout.js';
import { CAMERA_BY_ID } from '../data/cameras.js';
import { NODES } from '../data/nodes.js';
import { CONFIG } from '../core/config.js';
import { setLocal, setStateLocal, typeAtLocal, fillLocal, blockAt } from './world_io.js';
import { log } from './log.js';

const LIGHT_KEY = (n) => `light${n}`;

export class Actuators {
  /** @param {{ lamps: any[], spots: any[], hanging: any[], exits: any[] }} meta build metadata */
  constructor(meta) {
    this.meta = meta;
    this.doorAnim = { L: null, R: null }; // { closing: bool, row, next }
    this.doorState = { L: false, R: false };
    this.camLights = []; // cells currently holding a camera light
    this.flicker = new Map(); // lamp key -> until
  }

  // ------------------------------------------------------------ doors
  /** Animate a shutter: closing drops rows top-down, opening lifts them bottom-up. */
  door(side, closed) {
    this.doorState[side] = closed;
    const d = OFFICE.doors[side];
    this.doorAnim[side] = { closing: closed, row: closed ? d.y2 : d.y1, next: system.currentTick };
  }

  tickDoors() {
    const now = system.currentTick;
    const step = Math.max(1, Math.floor(CONFIG.devices.doorAnimTicks / 4));
    for (const side of ['L', 'R']) {
      const a = this.doorAnim[side];
      if (!a || now < a.next) continue;
      const d = OFFICE.doors[side];
      if (a.closing) {
        fillSafe(d.x, a.row, d.z1, d.x, a.row, d.z2, a.row === d.y1 ? 'shutter_bottom' : 'shutter');
        a.row--;
        if (a.row < d.y1) this.doorAnim[side] = null;
      } else {
        fillSafe(d.x, a.row, d.z1, d.x, a.row, d.z2, 'air');
        a.row++;
        if (a.row > d.y2) this.doorAnim[side] = null;
      }
      if (this.doorAnim[side]) this.doorAnim[side].next = now + step;
    }
  }

  /** Snap both shutters to a state immediately (reset / load). */
  doorsInstant(closedL, closedR) {
    for (const [side, closed] of [['L', closedL], ['R', closedR]]) {
      const d = OFFICE.doors[side];
      this.doorAnim[side] = null;
      this.doorState[side] = closed;
      if (closed) {
        fillSafe(d.x, d.y1 + 1, d.z1, d.x, d.y2, d.z2, 'shutter');
        fillSafe(d.x, d.y1, d.z1, d.x, d.y1, d.z2, 'shutter_bottom');
      } else fillSafe(d.x, d.y1, d.z1, d.x, d.y2, d.z2, 'air');
    }
  }

  // ------------------------------------------------------------ hall lights + buttons
  hallLight(side, on) {
    const h = OFFICE.hallLights[side];
    const [x1, y1, z1, x2, y2, z2] = h.box;
    if (on) fillSafe(x1, y1, z1, x2, y2, z2, LIGHT_KEY(h.level), true);
    else fillSafe(x1, y1, z1, x2, y2, z2, 'air', [`minecraft:light_block_${h.level}`]);
    setStateLocal(h.lamp.x, h.lamp.y, h.lamp.z, 'fnar:lit', on);
    this.button(side === 'L' ? 'light_l' : 'light_r', on);
  }

  button(which, on) {
    const b = OFFICE.buttons[which];
    if (b) setStateLocal(b.x, b.y, b.z, 'fnar:on', !!on);
  }

  // ------------------------------------------------------------ vents, props
  vent(side, closed) {
    const v = OFFICE.vents[side];
    setStateLocal(v.x, v.y, v.z, 'fnar:closed', !!closed);
  }

  monitor(on) {
    const m = OFFICE.monitor;
    setStateLocal(m.x, m.y, m.z, 'fnar:on', !!on);
  }

  phone(ringing) {
    const p = OFFICE.phone;
    setStateLocal(p.x, p.y, p.z, 'fnar:ringing', !!ringing);
  }

  tape(level) {
    setStateLocal(SHOW_TAPE.x, SHOW_TAPE.y, SHOW_TAPE.z, 'fnar:level', Math.max(0, Math.min(4, level)));
  }

  // ------------------------------------------------------------ lamps
  /** Switch every lamp in a group (see build_plan lights(): office, dining, hall_w, hall_e, door_l, door_r, kitchen, ...). */
  lampGroup(group, on) {
    for (const l of this.meta.lamps) if (l.group === group) setStateLocal(l.x, l.y, l.z, 'fnar:lit', !!on);
  }

  allLamps(on, except = []) {
    for (const l of this.meta.lamps) if (!except.includes(l.group)) setStateLocal(l.x, l.y, l.z, 'fnar:lit', !!on);
    for (const h of this.meta.hanging) setStateLocal(h.x, h.y, h.z, 'fnar:lit', !!on);
  }

  spots(group, on) {
    for (const s of this.meta.spots) if (!group || s.group === group) setStateLocal(s.x, s.y, s.z, 'fnar:lit', !!on);
  }

  officeLamp(on) {
    const L = OFFICE.lamp;
    setStateLocal(L.x, L.y, L.z, 'fnar:lit', !!on);
  }

  /** A random hall lamp flickers on briefly (night ambience). */
  tickFlicker(rng) {
    const now = system.currentTick;
    for (const [k, until] of this.flicker) {
      if (now >= until) {
        const [x, y, z] = k.split(',').map(Number);
        setStateLocal(x, y, z, 'fnar:lit', false);
        this.flicker.delete(k);
      }
    }
    if (rng.next() < 0.004) {
      const pool = this.meta.lamps.filter((l) => l.group === 'hall_w' || l.group === 'hall_e' || l.group === 'restrooms');
      const l = pool[Math.floor(rng.next() * pool.length)];
      if (l) {
        setStateLocal(l.x, l.y, l.z, 'fnar:lit', true);
        this.flicker.set(`${l.x},${l.y},${l.z}`, now + 2 + Math.floor(rng.next() * 6));
      }
    }
  }

  // ------------------------------------------------------------ the Cabaret curtain
  /** stage 0 closed, 1 a gap at the peek row, 2-3 the gap stays; 3 adds the OUT OF ORDER sign. */
  curtain(stage) {
    const c = CABARET.curtain;
    fillSafe(c.x, c.y1, c.z1, c.x, c.y2, c.z2, 'curtain_purple');
    const g = CABARET.gap;
    if (stage >= 1) fillSafe(c.x, g.y1, g.z1, c.x, g.y2, g.z2, 'air');
    if (stage >= 2) fillSafe(c.x, g.y1, g.z1 - 1, c.x, g.y2, g.z2 + 1, 'air');
    const o = CABARET.outOfOrder;
    for (let z = o.z1; z <= o.z2; z++) {
      const tile = z - o.z1;
      if (stage >= 3) setLocal(o.x, o.y, z, `pic:sign_out_of_order:${tile}:${o.dir}`);
      else if (typeAtLocal(o.x, o.y, z) === 'fnar:sign_out_of_order') setLocal(o.x, o.y, z, 'air');
    }
  }

  /** Daytime: the Cabaret curtain fully open. */
  curtainOpen(open) {
    const c = CABARET.curtain;
    fillSafe(c.x, c.y1, c.z1, c.x, c.y2, c.z2, open ? 'air' : 'curtain_purple');
  }

  // ------------------------------------------------------------ camera IR lights
  /** Soft light around what a camera watches, only while that feed is live. */
  camLight(camId) {
    this.clearCamLight();
    const cam = CAMERA_BY_ID[camId];
    if (!cam || cam.audioOnly) return;
    /** @type {[number, number, number, string][]} */
    const cells = [];
    const [lx, ly, lz] = cam.look;
    const [cx, cy, cz] = cam.loc;
    // a light just below the lens and two along the view direction
    for (const f of [0.15, 0.5, 0.85]) {
      cells.push([Math.floor(cx + (lx - cx) * f), Math.floor(cy + (ly - cy) * f + (f === 0.15 ? -0.6 : 0.8)), Math.floor(cz + (lz - cz) * f), 'light7']);
    }
    // and one over every spot the camera watches, so whoever stands there shows on the feed
    for (const id of cam.sees) {
      const n = NODES[id];
      if (n) cells.push([Math.floor(n.x), Math.floor(n.y) + (n.crawl ? 1 : 3), Math.floor(n.z), 'light10']);
    }
    const done = new Set();
    for (const [x, y, z, key] of cells) {
      const k = `${x},${y},${z}`;
      if (done.has(k)) continue;
      done.add(k);
      // only empty cells: a hall light (light block) there is not ours to replace or remove later
      if (blockAt(x, y, z)?.typeId === 'minecraft:air' && setLocal(x, y, z, key)) this.camLights.push([x, y, z]);
    }
  }

  clearCamLight() {
    for (const [x, y, z] of this.camLights) {
      if (typeAtLocal(x, y, z)?.startsWith('minecraft:light_block')) setLocal(x, y, z, 'air');
    }
    this.camLights = [];
  }

  // ------------------------------------------------------------ whole-office states
  /** The office as a night starts: doors open, lights off, buttons dark, vents open, monitor on. */
  nightStart() {
    this.dayLights(false);
    this.doorsInstant(false, false);
    for (const side of ['L', 'R']) {
      this.hallLight(side, false);
      this.vent(side, false);
    }
    for (const k of Object.keys(OFFICE.buttons)) this.button(k, false);
    this.monitor(true);
    this.phone(false);
    this.allLamps(false);
    this.officeLamp(true);
    this.spots(null, false);
    this.spots('gallery', false);
    this.curtain(0);
    this.tape(4);
    this.clearCamLight();
  }

  powerOut() {
    this.doorsInstant(false, false);
    for (const side of ['L', 'R']) {
      this.hallLight(side, false);
      this.vent(side, false);
    }
    for (const k of Object.keys(OFFICE.buttons)) this.button(k, false);
    this.monitor(false);
    this.officeLamp(false);
    this.clearCamLight();
  }

  /** Invisible fill lights for daytime (placed only into air, removed only where still a light block). */
  dayLights(on) {
    for (const [x, y, z, level] of DAY_LIGHTS) {
      const t = typeAtLocal(x, y, z);
      if (on && t === 'minecraft:air') setLocal(x, y, z, LIGHT_KEY(level));
      else if (!on && t?.startsWith('minecraft:light_block')) setLocal(x, y, z, 'air');
    }
  }

  /** Daytime / free roam: everything lit, curtains open. */
  daytime() {
    this.dayLights(true);
    this.doorsInstant(false, false);
    this.allLamps(true);
    this.officeLamp(true);
    this.spots('stage', true);
    this.spots('cabaret', true);
    this.spots('gallery', true);
    this.curtainOpen(true);
    this.tape(4);
    this.monitor(true);
    this.clearCamLight();
  }

  /** Lobby: building dark except the staff room and gallery. */
  lobby() {
    this.dayLights(false);
    this.doorsInstant(false, false);
    this.allLamps(false);
    for (const l of this.meta.lamps) if (l.room === 'STAFF' || l.room === 'GALLERY') setStateLocal(l.x, l.y, l.z, 'fnar:lit', true);
    this.spots(null, false);
    this.spots('gallery', true);
    this.curtain(0);
    this.monitor(false);
    this.clearCamLight();
  }
}

/** @param {boolean | string[]} [filter] */
function fillSafe(x1, y1, z1, x2, y2, z2, key, filter = false) {
  try {
    fillLocal(x1, y1, z1, x2, y2, z2, key, filter);
  } catch (e) {
    log.warn(`fill ${key} @${x1},${y1},${z1}: ${e?.message ?? e}`);
  }
}
