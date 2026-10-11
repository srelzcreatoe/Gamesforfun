// Animatronic puppets: the visible entities. The night simulation is the
// single source of truth for where each animatronic is; puppets only mirror
// it. Each tick a puppet is teleported to its logical pose (small steps along
// validated route polylines, so movement never crosses walls) and its
// animation/eye/hidden properties are synced to the client.
//
// Integrity rules (checked every 40 ticks and on demand):
//   * exactly one tagged puppet per character - extras are removed;
//   * a missing/invalid puppet is respawned at its logical pose;
//   * untagged stray fb: entities are removed;
//   * a puppet more than 3 blocks from its logical pose is snapped back.

import { system } from '@minecraft/server';
import { dim, Wv } from './world_io.js';
import { NODE_BY_ID } from '../data/nodes.js';
import { log } from './log.js';

export const PUPPET_TYPES = Object.freeze({
  freddy: 'fb:freddy',
  bonnie: 'fb:bonnie',
  chica: 'fb:chica',
  fredbear: 'fb:fredbear',
  morgrave: 'fb:morgrave',
  valek: 'fb:valek',
  echo: 'fb:fredbear_echo',
});
export const MAIN = Object.freeze(['freddy', 'bonnie', 'chica', 'fredbear', 'morgrave', 'valek']);
const TRIO = new Set(['freddy', 'bonnie', 'chica']);
const HOME = Object.freeze({ freddy: 'STAGE_F', bonnie: 'STAGE_B', chica: 'STAGE_C', fredbear: 'CHAMBER_F', morgrave: 'M_HOME', valek: 'V_HOME' });
const ALWAYS_DORMANT = new Set(['fredbear', 'morgrave', 'valek']); // outside a night they stand switched off
const NO_LOOK = Object.freeze({ yaw: 0, pitch: 0, tilt: 0 });

function homePose(who, anim) {
  const n = NODE_BY_ID[HOME[who]];
  return { x: n.x, y: n.y, z: n.z, yaw: n.yaw ?? 0, anim, eyes: false, hidden: false };
}

export class Puppets {
  constructor() {
    this.ents = Object.create(null);
    this.applied = Object.create(null);
    this.stats = { spawned: 0, removed: 0, snapped: 0 };
    this.withered = false; // nights 7-9 and the challenges: the trio wear their withered suits (fb:variant 1)
    /** @type {Record<string, { yaw: number, pitch: number, tilt: number }>} head turns (the stare, Free Roam) */
    this.looks = Object.create(null);
  }

  /** Locate (or create) the single puppet entity for `who`. */
  entity(who, pose) {
    let e = this.ents[who];
    if (e?.isValid) return e;
    e = this.scan(who);
    if (!e && pose) e = this.spawn(who, pose);
    this.ents[who] = e;
    delete this.applied[who];
    return e;
  }

  scan(who) {
    let keep;
    try {
      for (const e of dim().getEntities({ type: PUPPET_TYPES[who] })) {
        if (!keep && e.hasTag('fb_puppet')) keep = e;
        else {
          e.remove();
          this.stats.removed++;
        }
      }
    } catch (e) {
      log.warn(`puppet scan ${who}: ${e?.message ?? e}`);
    }
    return keep;
  }

  spawn(who, pose) {
    try {
      const loc = Wv(pose);
      if (!dim().isChunkLoaded(loc)) return undefined;
      const e = dim().spawnEntity(PUPPET_TYPES[who], loc, { initialRotation: pose.yaw ?? 0 });
      e.addTag('fb_puppet');
      e.addTag(`fb_${who}`);
      this.stats.spawned++;
      return e;
    } catch (err) {
      log.warn(`puppet spawn ${who}: ${err?.message ?? err}`);
      return undefined;
    }
  }

  /** Mirror one pose onto the puppet (only changed values are sent). */
  apply(who, pose) {
    const e = this.entity(who, pose);
    if (!e) return;
    const a = this.applied[who] ?? {};
    const moved = a.x === undefined || Math.abs(a.x - pose.x) > 0.005 || Math.abs(a.y - pose.y) > 0.005 || Math.abs(a.z - pose.z) > 0.005 || Math.abs((a.yaw ?? 0) - pose.yaw) > 0.5;
    try {
      if (moved) e.teleport(Wv(pose), { rotation: { x: 0, y: pose.yaw } });
      if (a.anim !== pose.anim) e.setProperty('fb:anim', pose.anim);
      if (a.eyes !== pose.eyes) e.setProperty('fb:eyes', !!pose.eyes);
      if (a.hidden !== pose.hidden) e.setProperty('fb:hidden', !!pose.hidden);
      const variant = pose.variant ?? (TRIO.has(who) ? (this.withered ? 1 : 0) : undefined);
      if (variant !== undefined && a.variant !== variant) e.setProperty('fb:variant', variant);
      const look = pose.anim === 'attack' || pose.hidden ? NO_LOOK : this.looks[who] ?? NO_LOOK;
      const al = a.look ?? {};
      if (al.yaw !== look.yaw) e.setProperty('fb:look_yaw', look.yaw);
      if (al.pitch !== look.pitch) e.setProperty('fb:look_pitch', look.pitch);
      if (al.tilt !== look.tilt) e.setProperty('fb:look_tilt', look.tilt);
      this.applied[who] = { ...pose, variant, look };
    } catch (err) {
      delete this.ents[who];
      log.warn(`puppet apply ${who}: ${err?.message ?? err}`);
    }
  }

  /** Sync every animatronic from a night session (or rest poses when there is none). */
  sync(session, restAnim = 'perform') {
    for (const who of MAIN) {
      const pose = session ? session.anim[who].pose() : homePose(who, ALWAYS_DORMANT.has(who) ? 'dormant' : restAnim);
      this.apply(who, pose);
    }
    if (system.currentTick % 40 === 0) this.integrity(session);
  }

  integrity(session) {
    for (const who of MAIN) {
      const e = this.ents[who];
      if (!e?.isValid) continue;
      const want = session ? session.anim[who].pose() : this.applied[who];
      if (!want) continue;
      const loc = e.location;
      const w = Wv(want);
      if (Math.hypot(loc.x - w.x, loc.y - w.y, loc.z - w.z) > 3) {
        this.stats.snapped++;
        delete this.applied[who];
      }
      // duplicates
      this.scan(who);
    }
    try {
      for (const e of dim().getEntities({ families: ['fb_animatronic'] })) {
        if (!e.hasTag('fb_puppet') && e.typeId !== PUPPET_TYPES.echo) {
          e.remove();
          this.stats.removed++;
        }
      }
    } catch {
      // families query unsupported before chunks load; ignore
    }
  }

  // ------------------------------------------------------------ echo (false camera event / foreshadow / shadow)
  /** @param {string} nodeId @param {'echo' | 'shadow'} [kind] shadow = the black stage silhouette (fb:variant 1) */
  showEcho(nodeId, kind = 'echo') {
    this.hideEcho();
    const n = NODE_BY_ID[nodeId];
    if (!n) return;
    const e = this.spawn('echo', { x: n.x, y: n.y, z: n.z, yaw: n.yaw ?? 0 });
    if (e) {
      e.setProperty('fb:variant', kind === 'shadow' ? 1 : 0);
      e.setProperty('fb:anim', kind === 'shadow' ? 'idle' : 'look');
      e.setProperty('fb:eyes', true);
      this.echo = e;
    }
  }

  hideEcho() {
    try {
      for (const e of dim().getEntities({ type: PUPPET_TYPES.echo })) e.remove();
    } catch {
      // ignore
    }
    this.echo = undefined;
  }

  /**
   * Place `who` right in front of the player's eyes for a jumpscare.
   * Styles (docs/04 "Jumpscares by place"): 'front'; 'below' rises up through the floor
   * (the hatch); 'vent' bursts up from low at one side (out of the vent).
   * @param {number} eyeHeight the model's eye height in blocks (already scaled)
   * @param {number} [variant] Fredbear: which of his jumpscare animations plays (fb:variant)
   * @param {'front' | 'below' | 'vent'} [style]
   */
  lunge(who, eye, viewDir, eyeHeight, variant = 0, style = 'front') {
    const e = this.entity(who, homePose(who, 'attack'));
    if (!e) return undefined;
    const d = who === 'fredbear' ? 1.7 : 1.15; // the taller rigs lunge forward in their own animation
    const pos = { x: eye.x + viewDir.x * d, y: eye.y - eyeHeight, z: eye.z + viewDir.z * d };
    const yaw = (Math.atan2(viewDir.x, -viewDir.z) * 180) / Math.PI;
    // Start lower (and, out of the vent, off to one side), then rise into the face over a few ticks.
    const side = { x: -viewDir.z, z: viewDir.x };
    const start = style === 'below' ? { x: pos.x, y: pos.y - 2.2, z: pos.z }
      : style === 'vent' ? { x: pos.x + side.x * 1.1, y: pos.y - 1.4, z: pos.z + side.z * 1.1 } : pos;
    try {
      e.teleport(start, { rotation: { x: 0, y: yaw } });
      if (who === 'fredbear') e.setProperty('fb:variant', variant);
      else if (who === 'valek') e.setProperty('fb:variant', 0); // the whole bear, not just the eyes
      e.setProperty('fb:anim', 'attack');
      e.setProperty('fb:eyes', true);
      e.setProperty('fb:hidden', false);
      for (const k of ['fb:look_yaw', 'fb:look_pitch', 'fb:look_tilt']) e.setProperty(k, 0);
      this.applied[who] = undefined;
      if (start !== pos) {
        for (let k = 1; k <= 3; k++) {
          const f = k / 3;
          system.runTimeout(() => {
            try {
              if (e.isValid) e.teleport({ x: start.x + (pos.x - start.x) * f, y: start.y + (pos.y - start.y) * f, z: start.z + (pos.z - start.z) * f }, { rotation: { x: 0, y: yaw } });
            } catch {
              // ignore
            }
          }, k * 2);
        }
      }
    } catch (err) {
      log.warn(`lunge ${who}: ${err?.message ?? err}`);
    }
    return { x: pos.x, y: pos.y + eyeHeight, z: pos.z };
  }

  status() {
    const out = {};
    for (const who of MAIN) {
      let n = 0;
      try {
        n = dim().getEntities({ type: PUPPET_TYPES[who] }).length;
      } catch {
        n = -1;
      }
      out[who] = n;
    }
    return out;
  }
}
