// Animatronic puppets: one entity per character, moved by teleport every
// tick along the polylines the night session announces, with the animation
// chosen through the fnar:anim entity property (client-synced, drives the
// resource pack's animation controller).
//
// Entity properties (BP entities/*.json):
//   fnar:anim    enum  idle perform perform2 stand walk run scurry crawl peek stare jumpscare slump pose
//   fnar:eyes    bool  glowing eyes layer
//   fnar:hidden  bool  render nothing (kept alive so its chunk/tag stay valid)
//   fnar:look_yaw / fnar:look_pitch  int  head turn towards a camera (degrees, smoothed client side)
//   fnar:variant int   0 normal, 1 alternate skin (Rustgrin: rusted)

import { NODES } from '../data/nodes.js';
import { CAST } from '../core/config.js';
import { dim, W, Wv } from './world_io.js';
import { log } from './log.js';

export const ENTITY_ID = Object.freeze({ ...Object.fromEntries(CAST.map((id) => [id, `fnar:${id}`])), rusted: 'fnar:rusted' });
const TAG = 'fnar_puppet';

function yawToward(dx, dz) {
  // Minecraft yaw: 0 = +Z (south), 90 = -X (west)
  return (Math.atan2(-dx, dz) * 180) / Math.PI;
}

export class Puppets {
  constructor() {
    /** @type {Record<string, any>} */
    this.ents = {};
    /** @type {Record<string, { path: number[][], cum: number[], len: number, dur: number, t: number, yaw: number }>} */
    this.walks = {};
    this.props = {}; // last set property values (avoid redundant network traffic)
  }

  get(id) {
    const e = this.ents[id];
    if (e?.isValid) return e;
    // re-acquire an existing puppet (world reload) or spawn a new one
    try {
      const found = dim().getEntities({ type: ENTITY_ID[id], tags: [TAG] });
      if (found.length) {
        for (const extra of found.slice(1)) extra.remove();
        this.ents[id] = found[0];
        this.props[id] = {};
        return found[0];
      }
    } catch (err) {
      log.warn(`puppet lookup ${id}: ${err?.message ?? err}`);
    }
    return undefined;
  }

  /** Spawn (or reuse) a puppet at an arbitrary local position. */
  spawnAt(id, local, yaw, anim = 'idle') {
    let e = this.get(id);
    try {
      if (!e) {
        e = dim().spawnEntity(ENTITY_ID[id], W(local.x, local.y, local.z));
        e.addTag(TAG);
        this.ents[id] = e;
        this.props[id] = {};
      }
      delete this.walks[id];
      this.teleport(id, local, yaw);
      this.hide(id, false);
      this.anim(id, anim);
      this.look(id, 0, 0);
    } catch (err) {
      log.warn(`spawnAt ${id}: ${err?.message ?? err}`);
    }
    return e;
  }

  /** Put a puppet right in front of the guard for a jumpscare. */
  jumpscareAt(id, local, yaw) {
    this.spawnAt(id, local, yaw, 'jumpscare');
    this.eyes(id, true);
  }

  remove(id) {
    const e = this.get(id);
    delete this.walks[id];
    try {
      e?.remove();
    } catch {
      // ignore
    }
    delete this.ents[id];
    delete this.props[id];
  }

  spawn(id, node, pose = 'idle') {
    let e = this.get(id);
    const n = NODES[node];
    if (!n) return undefined;
    try {
      if (!e) {
        e = dim().spawnEntity(ENTITY_ID[id], W(n.x, n.y, n.z));
        e.addTag(TAG);
        this.ents[id] = e;
        this.props[id] = {};
      }
      this.placeNode(id, node, pose);
    } catch (err) {
      log.warn(`spawn ${id}: ${err?.message ?? err}`);
    }
    return e;
  }

  setProp(id, key, value) {
    const e = this.get(id);
    if (!e) return;
    const cache = (this.props[id] ??= {});
    if (cache[key] === value) return;
    try {
      e.setProperty(key, value);
      cache[key] = value;
    } catch (err) {
      log.warn(`setProperty ${id} ${key}=${value}: ${err?.message ?? err}`);
    }
  }

  anim(id, a) {
    this.setProp(id, 'fnar:anim', a);
  }

  eyes(id, on) {
    this.setProp(id, 'fnar:eyes', !!on);
  }

  hide(id, hidden = true) {
    this.setProp(id, 'fnar:hidden', !!hidden);
  }

  variant(id, v) {
    this.setProp(id, 'fnar:variant', v);
  }

  look(id, yaw, pitch) {
    this.setProp(id, 'fnar:look_yaw', Math.round(Math.max(-80, Math.min(80, yaw))));
    this.setProp(id, 'fnar:look_pitch', Math.round(Math.max(-40, Math.min(40, pitch))));
  }

  teleport(id, local, yaw) {
    const e = this.get(id);
    if (!e) return;
    try {
      e.teleport(Wv(local), { rotation: { x: 0, y: yaw } });
    } catch (err) {
      log.warn(`teleport ${id}: ${err?.message ?? err}`);
    }
  }

  placeNode(id, node, pose = 'idle') {
    const n = NODES[node];
    if (!n) return;
    delete this.walks[id];
    this.teleport(id, { x: n.x, y: n.y, z: n.z }, n.yaw);
    this.hide(id, false);
    this.anim(id, pose);
    this.look(id, 0, 0);
  }

  /** Begin animating a walk along a polyline (local coordinates) over `dur` ticks. */
  walk(id, path, dur, anim, finalYaw) {
    const cum = [0];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    this.walks[id] = { path, cum, len: cum[cum.length - 1] || 1, dur: Math.max(1, dur), t: 0, yaw: finalYaw };
    this.hide(id, false);
    this.anim(id, anim);
    this.look(id, 0, 0);
  }

  isWalking(id) {
    return !!this.walks[id];
  }

  /** Current local position of a puppet (its node or its walk), or undefined. */
  positionOf(id) {
    const e = this.get(id);
    if (!e) return undefined;
    try {
      const l = e.location;
      return l;
    } catch {
      return undefined;
    }
  }

  tick() {
    for (const [id, w] of Object.entries(this.walks)) {
      w.t++;
      const d = Math.min(w.len, (w.t / w.dur) * w.len);
      let i = 1;
      while (i < w.cum.length - 1 && w.cum[i] < d) i++;
      const a = w.path[i - 1];
      const b = w.path[i];
      const seg = w.cum[i] - w.cum[i - 1] || 1;
      const f = Math.max(0, Math.min(1, (d - w.cum[i - 1]) / seg));
      const pos = { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f };
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const yaw = Math.abs(dx) + Math.abs(dz) > 0.01 ? yawToward(dx, dz) : w.yaw;
      this.teleport(id, pos, w.t >= w.dur ? w.yaw : yaw);
      if (w.t >= w.dur) delete this.walks[id];
    }
  }

  /** Remove every puppet in the dimension (night end, lobby, rebuild). */
  removeAll() {
    this.walks = {};
    try {
      for (const e of dim().getEntities({ tags: [TAG] })) e.remove();
    } catch (err) {
      log.warn(`removeAll: ${err?.message ?? err}`);
    }
    this.ents = {};
    this.props = {};
  }
}

export { yawToward };
