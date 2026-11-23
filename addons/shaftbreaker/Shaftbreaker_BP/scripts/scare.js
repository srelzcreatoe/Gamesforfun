// @ts-check
/**
 * Everything that makes it frightening rather than merely dangerous: fog that closes in, darkness
 * pulses, the camera shaking with its roar, the reveal sting, its face in yours, whispers, words on
 * your screen, and two pale points in the dark that go out when you look at them.
 * Every effect has a world switch (the Wheel) and respects personal settings; all are rate-limited.
 */
import { world } from '@minecraft/server';
import { now, sec, rand, chance, pick, safe, valid, sub, len, norm, angleTo, floor3, clamp } from './core/util.js';
import { config, prefs, diff } from './core/config.js';
import { playFor, playAt } from './audio.js';
import { lineOfSight, lightAt, BlockCache } from './world/space.js';
import { unlockNote } from './notes.js';

export const FOG = Object.freeze({ near: 'shaftbreaker:fog_near', rage: 'shaftbreaker:fog_rage', territory: 'shaftbreaker:fog_territory' });

/** @type {Map<string, {fogs:Set<string>, lastScare:number, lastWhisper:number, lastMind:number, eyes:any, lastEyes:number, mindIdx:number}>} */
const st = new Map();
function ps(p) {
  let s = st.get(p.id);
  if (!s) { s = { fogs: new Set(), lastScare: -1e9, lastWhisper: -1e9, lastMind: -1e9, eyes: null, lastEyes: -1e9, mindIdx: 0 }; st.set(p.id, s); }
  return s;
}
export function forgetScares(id) { st.delete(id); }

// ------------------------------------------------------------------ fog, darkness, shake
export function pushFog(p, fogId, tag) {
  if (!config().darkness || !valid(p)) return;
  const s = ps(p);
  if (s.fogs.has(tag)) return;
  s.fogs.add(tag);
  safe('fogPush', () => p.runCommand(`fog @s push ${fogId} ${tag}`));
}
export function dropFog(p, tag) {
  if (!valid(p)) return;
  const s = ps(p);
  if (!s.fogs.has(tag)) return;
  s.fogs.delete(tag);
  safe('fogRemove', () => p.runCommand(`fog @s remove ${tag}`));
}
export function clearFogs(p) { for (const t of [...ps(p).fogs]) dropFog(p, t); }

/** the warden's darkness: the light pulses away around you */
export function darkness(p, seconds) {
  if (!config().darkness || !valid(p)) return;
  safe('darkness', () => p.addEffect('darkness', Math.round(seconds * 20), { amplifier: 0, showParticles: false }));
}

export function shake(p, intensity, seconds) {
  if (!config().cameraShake || !valid(p)) return;
  safe('shake', () => p.runCommand(`camerashake add @s ${clamp(intensity, 0.05, 1).toFixed(2)} ${seconds.toFixed(2)} positional`));
}

function flash(p, hold = 0.12) {
  if (prefs(p).reducedFlicker) return;
  safe('fade', () => p.camera.fade({ fadeTime: { fadeInTime: 0.04, holdTime: hold, fadeOutTime: 0.4 }, fadeColor: { red: 0, green: 0, blue: 0 } }));
}

// ------------------------------------------------------------------ stingers
/** the moment you notice it */
export function revealSting(p) {
  if (!valid(p)) return;
  playFor(p, 'shaftbreaker.sting_reveal', undefined, 0.95, rand(0.95, 1.05));
}

export function canJumpscare(p, minGap = 75) {
  if (!config().jumpscares || !prefs(p).jumpscares) return false;
  return now() - ps(p).lastScare > sec(minGap / diff().scare);
}

/**
 * Its face in yours: it is suddenly right in front of you, screaming, the screen blinks black.
 * Returns true when it happened. The creature is left standing there (callers decide what next).
 * @param {import('./ai/creature.js').Creature|null} cr
 */
export function jumpscare(p, cr, force = false) {
  if (!valid(p) || (!force && !canJumpscare(p))) return false;
  ps(p).lastScare = now();
  const eye = p.getHeadLocation();
  const v = p.getViewDirection();
  const f = norm({ x: v.x, y: 0, z: v.z });
  if (cr && cr.valid) {
    const c = new BlockCache(p.dimension);
    let placed = false;
    for (const d of [1.35, 1.8, 2.3]) {
      const q = { x: p.location.x + f.x * d, y: p.location.y, z: p.location.z + f.z * d };
      const b = floor3(q);
      if (!c.passable(b.x, b.y, b.z) || !c.passable(b.x, b.y + 1, b.z)) continue;
      cr.halt(); cr.setGravity(true); cr.lockStance = false;
      safe('scareTp', () => cr.e.teleport(q, { keepVelocity: false, facingLocation: eye }));
      cr.setPhase('frenzy'); cr.setEyes(1.0); cr.setAct(36 /* SCREAM_CUT */);
      placed = true;
      break;
    }
    if (!placed) cr.face(eye);
  }
  playFor(p, 'shaftbreaker.jumpscare', undefined, 1.0, rand(0.95, 1.05));
  flash(p);
  shake(p, 0.6, 0.5);
  darkness(p, 2.5);
  return true;
}

// ------------------------------------------------------------------ whispers and mind games
const LINES = [
  '§8you dig too loud', '§8it knows the way you came', '§8do not turn around', '§8it was here before the tunnels',
  '§8it is counting your torches', '§8listen', '§8it remembers you', '§8one of the footsteps is not yours',
  '§8the walls are thin here', '§8it is closer than the echo',
];
const GLITCH = ['̶', '̷', '̸', '̴'];
function corrupt(t, amount) {
  let out = '';
  for (const ch of t) { out += ch; if (ch !== ' ' && Math.random() < amount) out += pick(GLITCH); }
  return out;
}

/** a whisper just behind you; with mind games on, sometimes words on your screen */
export function whisper(p, force = false) {
  if (!valid(p)) return false;
  const s = ps(p);
  if (!force && now() - s.lastWhisper < sec(40 / diff().scare)) return false;
  s.lastWhisper = now();
  const v = p.getViewDirection();
  const at = { x: p.location.x - v.x * 2.2 + rand(-0.6, 0.6), y: p.location.y + 1.5, z: p.location.z - v.z * 2.2 + rand(-0.6, 0.6) };
  playAt(p.dimension, 'shaftbreaker.whisper', at, 0.8, rand(0.9, 1.05));
  unlockNote(p, 'whisper');
  if (config().mindGames && (force || chance(0.45))) {
    const line = chance(0.25) ? `§8...${p.name}...` : pick(LINES);
    safe('mindLine', () => p.onScreenDisplay.setActionBar(corrupt(line, 0.35)));
  }
  return true;
}

/**
 * Fourth-wall scares (mind games): its name in the join message, one red word on your screen,
 * a false hurt, static on your screen. Rare by design.
 */
export function mindGame(p, force = false) {
  if (!valid(p) || !config().mindGames) return false;
  const s = ps(p);
  if (!force && now() - s.lastMind < sec(240 / diff().scare)) return false;
  s.lastMind = now();
  const kind = s.mindIdx++ % 4;
  if (kind === 0) {
    safe('fakeJoin', () => p.sendMessage('§eShaftbreaker joined the game'));
    setTimeoutTicks(sec(rand(25, 70)), () => { if (valid(p)) p.sendMessage('§eShaftbreaker left the game'); });
  } else if (kind === 1) {
    safe('word', () => p.onScreenDisplay.setTitle(corrupt(pick(['§4BEHIND YOU', '§4FOUND YOU', '§4I HEAR YOU', '§4STAY']), 0.2), { fadeInDuration: 0, stayDuration: 6, fadeOutDuration: 4, subtitle: '' }));
    playFor(p, 'shaftbreaker.static', undefined, 0.9, 1.0);
  } else if (kind === 2) {
    playFor(p, 'game.player.hurt', undefined, 1.0, rand(0.8, 0.9));
    if (!prefs(p).reducedFlicker) safe('redFade', () => p.camera.fade({ fadeTime: { fadeInTime: 0.02, holdTime: 0.05, fadeOutTime: 0.3 }, fadeColor: { red: 0.5, green: 0, blue: 0 } }));
  } else {
    playFor(p, 'shaftbreaker.static', undefined, 1.0, rand(0.85, 1.0));
    safe('staticBar', () => p.onScreenDisplay.setActionBar(corrupt('§7▓▒░ ░▒▓ ▓▒░▒▓░ ▒▓', 0.5)));
  }
  return true;
}

/** @type {{at:number, fn:Function}[]} */
let timers = [];
function setTimeoutTicks(t, fn) { timers.push({ at: now() + t, fn }); }

// ------------------------------------------------------------------ eyes in the dark
/** two pale points in a dark spot you are not quite looking at; they go out when you look */
export function startEyes(p, force = false) {
  if (!valid(p) || !config().eyesInDark) return false;
  const s = ps(p);
  if (s.eyes || (!force && now() - s.lastEyes < sec(90 / diff().scare))) return false;
  const eye = p.getHeadLocation();
  const v = p.getViewDirection();
  const base = Math.atan2(v.z, v.x);
  for (let i = 0; i < 16; i++) {
    // cast into the dark off to one side of where you are looking; the eyes sit inside the open space it finds
    const yaw = base + rand(0.5, 1.25) * (chance(0.5) ? 1 : -1);
    const pitch = rand(-0.18, 0.22);
    const dir = { x: Math.cos(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.sin(yaw) * Math.cos(pitch) };
    let free = 24;
    safe('eyeRay', () => {
      const hit = p.dimension.getBlockFromRay(eye, dir, { maxDistance: 24, includePassableBlocks: false, includeLiquidBlocks: true });
      if (hit) free = len(sub({ x: hit.block.location.x + hit.faceLocation.x, y: hit.block.location.y + hit.faceLocation.y, z: hit.block.location.z + hit.faceLocation.z }, eye));
    });
    if (free < 9) continue;
    const d = Math.min(free - 1.2, rand(9, 22));
    const at = { x: eye.x + dir.x * d, y: eye.y + dir.y * d, z: eye.z + dir.z * d };
    if (lightAt(p.dimension, at) > 5) continue;
    s.eyes = { at, until: now() + sec(rand(10, 22)) };
    s.lastEyes = now();
    return true;
  }
  return false;
}

/** every 10 ticks: keep the eyes glinting until they are looked at (then they go out) */
export function tickScares() {
  if (timers.length) {
    const due = timers.filter((t) => now() >= t.at);
    timers = timers.filter((t) => now() < t.at);
    for (const t of due) safe('scareTimer', t.fn);
  }
  for (const p of world.getAllPlayers()) {
    const s = st.get(p.id);
    if (!s || !s.eyes) continue;
    const e = s.eyes;
    let eye; try { eye = p.getHeadLocation(); } catch { continue; }
    const ang = angleTo(p.getViewDirection(), eye, e.at);
    if (now() > e.until || len(sub(e.at, eye)) > 40) { s.eyes = null; continue; }
    if (ang < 11) {                                                 // looked at: gone
      s.eyes = null;
      unlockNote(p, 'eyes');
      if (chance(0.5)) playAt(p.dimension, 'shaftbreaker.click', e.at, 0.5, 0.9);
      continue;
    }
    const v = norm(sub(e.at, eye));
    const side = { x: -v.z * 0.13, y: 0, z: v.x * 0.13 };
    for (const sg of [1, -1]) safe('glint', () => p.dimension.spawnParticle('shaftbreaker:eye_glint', { x: e.at.x + side.x * sg, y: e.at.y, z: e.at.z + side.z * sg }));
  }
}

// ------------------------------------------------------------------ territory fog
/** fog thickens near its dens (underground) */
export function territoryFog(p, near) {
  if (near) pushFog(p, FOG.territory, 'sb_territory'); else dropFog(p, 'sb_territory');
}

export { playAt };
