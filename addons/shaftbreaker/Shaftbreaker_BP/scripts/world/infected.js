// @ts-check
/**
 * Its home: the infected caves under the Hollows. The place itself is on its side.
 *  - Watcher pods open when you come near and look at you; the Shaftbreaker then knows where you are.
 *  - Crimson thorns cut and slow you.
 *  - Living walls (pulsing flesh, organ cores) beat; blood drips from the ceilings; red mist hangs low.
 *  - Breaking an organ core wounds it, and it comes for you.
 */
import { BlockVolume } from '@minecraft/server';
import { now, sec, rand, chance, safe, valid, floor3, center, dist, OVERWORLD } from '../core/util.js';
import { config } from '../core/config.js';
import { lineOfSight, isUnderground } from './space.js';
import { playAt, playFor, caption } from '../audio.js';
import { unlockNote } from '../notes.js';

export const POD = 'shaftbreaker:watcher_pod';
const LIVING = ['shaftbreaker:pulsing_flesh', 'shaftbreaker:organ_core', 'shaftbreaker:cracked_organ_core'];

/** @type {Map<string, {pos:{x:number,y:number,z:number}, openedAt:number}>} */
const openPods = new Map();
/** @type {Map<string, {lastAlert:number, lastThorn:number, lastPulse:number}>} */
const st = new Map();
function ps(p) { let s = st.get(p.id); if (!s) { s = { lastAlert: -1e9, lastThorn: -1e9, lastPulse: -1e9 }; st.set(p.id, s); } return s; }
export function forgetInfected(id) { st.delete(id); }

function blocksNear(dim, c, r, ry, types) {
  const out = [];
  safe('infScan', () => {
    const vol = new BlockVolume({ x: c.x - r, y: c.y - ry, z: c.z - r }, { x: c.x + r, y: c.y + ry + 1, z: c.z + r });
    const list = dim.getBlocks(vol, { includeTypes: types }, false);
    for (const loc of list.getBlockLocationIterator()) { out.push({ x: loc.x, y: loc.y, z: loc.z }); if (out.length > 24) break; }
  });
  return out;
}

function setOpen(dim, pos, open) {
  return !!safe('podState', () => {
    const b = dim.getBlock(pos);
    if (!b || b.typeId !== POD) return false;
    b.setPermutation(b.permutation.withState(/** @type {any} */ ('shaftbreaker:open'), open));
    return true;
  }, false);
}

/**
 * every 20 ticks
 * @param {any[]} players
 * @param {(p:any)=>any} pstate
 * @param {(p:any, pos:any)=>void} onWatched  called when a pod opens on a player
 */
export function tickInfected(players, pstate, onWatched) {
  const t = now();
  for (const p of players) {
    if (!valid(p) || p.dimension.id !== OVERWORLD) continue;
    const s = pstate(p);
    if (!s.hollows) continue;
    const z = ps(p);
    const dim = p.dimension;
    const feet = floor3(p.location);
    const eye = p.getHeadLocation();
    // watcher pods: they open when you come close, and it knows
    for (const pos of blocksNear(dim, feet, 7, 3, [POD])) {
      const k = `${pos.x},${pos.y},${pos.z}`;
      if (openPods.has(k)) continue;
      const c = { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 };
      if (dist(c, eye) > 7.5 || !lineOfSight(dim, eye, c)) continue;
      let open = false;
      safe('podOpen?', () => { const b = dim.getBlock(pos); open = !!b && b.permutation.getState(/** @type {any} */ ('shaftbreaker:open')) === true; });
      if (open) continue;
      if (setOpen(dim, pos, true)) {
        openPods.set(k, { pos, openedAt: t });
        playAt(dim, 'shaftbreaker.pod_open', c, 1.0, rand(0.9, 1.05));
        unlockNote(p, 'watched');
        if (t - z.lastAlert > sec(45)) {
          z.lastAlert = t;
          caption(p, 'A pod opens. It has seen you', c);
          onWatched(p, c);
        }
      }
    }
    // crimson thorns cut you
    if (t - z.lastThorn > sec(1) && !config().harmless) {
      let id = '';
      safe('thornFeet', () => { id = dim.getBlock(feet)?.typeId ?? ''; });
      if (id === 'shaftbreaker:crimson_thorns') {
        z.lastThorn = t;
        safe('thorn', () => p.applyDamage(2, { cause: /** @type {any} */ ('contact') }));
        safe('thornSlow', () => p.addEffect('slowness', 30, { amplifier: 1, showParticles: false }));
        unlockNote(p, 'thorns');
      }
    }
    if (!isUnderground(p)) continue;
    // the walls are alive
    if (t - z.lastPulse > sec(rand(3, 6))) {
      const near = blocksNear(dim, feet, 6, 3, LIVING);
      if (near.length) {
        z.lastPulse = t;
        const q = near[Math.floor(Math.random() * near.length)];
        playAt(dim, 'shaftbreaker.flesh_pulse', center(q), 0.8, rand(0.85, 1.0));
      }
    }
    // blood drips from the ceiling; red mist hangs low
    for (let i = 0; i < 2; i++) {
      const x = feet.x + Math.floor(rand(-6, 7)), zz = feet.z + Math.floor(rand(-6, 7));
      for (let dy = 2; dy <= 9; dy++) {
        let solid = false;
        safe('ceil', () => { const b = dim.getBlock({ x, y: feet.y + dy, z: zz }); solid = !!b && !b.isAir && !b.isLiquid; });
        if (solid) {
          const at = { x: x + rand(0.2, 0.8), y: feet.y + dy - 0.02, z: zz + rand(0.2, 0.8) };
          safe('drip', () => dim.spawnParticle('shaftbreaker:blood_drip', at));
          if (chance(0.25)) playAt(dim, 'shaftbreaker.drip', { x: at.x, y: feet.y, z: at.z }, 0.6, rand(0.85, 1.1));
          break;
        }
      }
    }
    if (chance(0.7)) safe('mist', () => dim.spawnParticle('shaftbreaker:red_mist', { x: p.location.x + rand(-7, 7), y: p.location.y + rand(0.1, 1.2), z: p.location.z + rand(-7, 7) }));
  }
  // pods close again once nobody is near
  for (const [k, o] of openPods) {
    if (t - o.openedAt < sec(40)) continue;
    let anyone = false;
    for (const p of players) if (valid(p) && dist(p.location, o.pos) < 10) anyone = true;
    if (anyone) continue;
    for (const p of players) { if (valid(p)) { setOpen(p.dimension, o.pos, false); break; } }
    openPods.delete(k);
  }
}

export { playFor };
