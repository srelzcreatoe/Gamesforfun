// The cast's tricks, their memory and their signs of life, in the world (the session side is
// core/ai: door_stalker.js, rustgrin.js, cat.js, purple_rat.js, top_hat_rat.js, director.js,
// memory.js, liveliness.js). game.js calls in here from its effect switch:
//
//   renderTrick   every trick's tell: a sound and a caption (the 'cue' effects game.js does
//                 not render itself)
//   renderIdle    the 'idle' effects: a head tilt, a pose for a while, a shuffle out and back
//   doorCaption   who is at which door (they may have traded halls)
//   memoryStart / memoryEnd / memoryLine   the save's memory of the guard: handed to the night
//                 when it starts, folded back in when it ends, hinted at in the Ringmaster's call
//   killNote      the extra game-over line when a trick was part of the catch
//
// Everything here is presentation: the session has already decided what happens.

import { system } from '@minecraft/server';
import { NODES } from '../data/nodes.js';
import { CAMERA_BY_ID } from '../data/cameras.js';
import { CAST_NAMES } from '../core/config.js';
import { MEMORY_CALLS, DIRECTS, KILL_TIPS } from '../data/story.js';
import { remember, memoryHints, memoryNight } from '../core/ai/memory.js';
import { storeSave } from './persistence.js';
import { W } from './world_io.js';
import { log } from './log.js';

const HALL = Object.freeze({ L: 'West Hall', R: 'East Hall' });
const DUCT = Object.freeze({ L: 'west', R: 'east' });
const DOOR_SPOT = Object.freeze({ L: 'door_l', R: 'door_r' });
const WAY = Object.freeze({ L: 'the left door', R: 'the right door', VL: 'the left vent', VR: 'the right vent' });
/** Each one's own sound: a grudge is heard coming, far off and slow. */
const SIGNATURE = Object.freeze({
  mirehop: 'fnar.mirehop.strum', noxbriar: 'fnar.noxbriar.hum', rustgrin: 'fnar.rustgrin.laugh',
  cat: 'fnar.cat.bell', purple_rat: 'fnar.rat.maracas', top_hat_rat: 'fnar.tophat.laugh',
});
/** Watched this long on a camera, a head is on the lens (game.js tickStare; the first look of the night counts too). */
const STARE_AFTER = 40;
/** Poses a sign of life may borrow for a moment, and only from these. */
const AT_REST = new Set(['stand', 'idle']);

const Name = (id) => {
  const n = CAST_NAMES[id] ?? id;
  return n.charAt(0).toUpperCase() + n.slice(1);
};
const fill = (text, vars) => String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));

/**
 * Tells for the cast's tricks: every one plays a sound and shows a caption.
 * @param {any} game the Game
 * @param {any} e the 'cue' effect
 * @param {import('@minecraft/server').Player} g the guard
 * @returns {boolean} whether the cue was one of these
 */
export function renderTrick(game, e, g) {
  const s = game.session;
  const now = system.currentTick;
  const audio = game.audio;
  const cap = (t) => game.save.settings.captions && game.hud.setCaption(t, now, 80);
  const live = game.cams.active ? s.devices.cams.cam : null;
  const pos = (id) => {
    const p = NODES[s.chars[id]?.node ?? s.chars[id]?.walk?.to];
    return p ? { x: p.x, y: p.y + 1.5, z: p.z } : null;
  };
  switch (e.kind) {
    // ---------------------------------------------------------------- Rustgrin: the burnt feed
    case 'squeal':
      // his microphone, through the monitor's own speaker
      audio.play('fnar.rustgrin.feedback', null, g, { vol: 0.75, pitch: 1.5 });
      cap(`the feed squeals - he is staring back through CAM ${e.cam}. Look away`);
      return true;
    case 'burn':
      audio.play('fnar.cam.glitch', null, g, { vol: 1, pitch: 0.7 });
      audio.play('fnar.rustgrin.laugh', 'near_office', g, { vol: 0.4, pitch: 0.7 });
      cap(`CAM ${e.cam} burns out - a dead feed does not hold him`);
      return true;
    // ---------------------------------------------------------------- Mirehop: the knock
    case 'knock': {
      // three quick taps on the wall by the door: nothing like the slow, heavy knocking on a shut door
      const tap = () => game.session === s && audio.play('fnar.step.light', DOOR_SPOT[e.side], g, { vol: 0.9, pitch: 0.65 });
      tap();
      system.runTimeout(tap, 4);
      system.runTimeout(tap, 8);
      cap(`three quick knocks on the ${e.side === 'L' ? 'left' : 'right'} wall`);
      return true;
    }
    // ---------------------------------------------------------------- Noxbriar: the thrown voice
    case 'decoy':
      // too clear and too close: brighter and louder than her real hum down a hall
      audio.play('fnar.noxbriar.hum', DOOR_SPOT[e.side], g, { vol: 0.85, pitch: 1.25 });
      cap(`humming in the ${HALL[e.side]} - too clear, too close`);
      return true;
    // ---------------------------------------------------------------- the Purple Rat: playing dead
    case 'playdead':
      audio.play('fnar.night.twitch', pos(e.who), g, { vol: 0.7, relayCam: live });
      cap(`the maracas stop dead in the ${DUCT[e.side] ?? 'west'} duct - he knows you are watching`);
      return true;
    case 'burst':
      audio.play('fnar.rat.maracas', e.side === 'R' ? 'vent_r' : 'vent_l', g, { vol: 0.8, pitch: 1.6 });
      audio.play('fnar.rat.crawl', pos(e.who), g, { vol: 1, pitch: 1.4, relayCam: live });
      cap(`a frantic rattle in the ${DUCT[e.side] ?? 'west'} duct - he bolted`);
      return true;
    // ---------------------------------------------------------------- the Cat: at the tape deck
    case 'pull':
      // the show music drags and warbles all through the building
      audio.play('fnar.tophat.rewind', null, g, { vol: e.again ? 0.3 : 0.5, pitch: 0.55 });
      if (live === '8') audio.play('fnar.cam.glitch', null, g, { vol: 0.4 });
      cap(e.again ? 'the show music is still warbling - the tape is running down fast (CAM 8)' : 'the show music warbles - someone is pulling at the tape (CAM 8)');
      return true;
    case 'pull_end':
      audio.play('fnar.cat.bell', 'midway', g, { vol: 0.8, relayCam: live });
      if (e.rewound || live === '8') cap('a bell on the Midway - the Cat is back on the ring');
      return true;
    // ---------------------------------------------------------------- the Ringmaster: "places!"
    case 'places': {
      audio.play('fnar.tophat.cane', null, g, { vol: 0.7 });
      const [a, b] = e.who.map(Name);
      game.paQueue.push(fill(game.pickLine('directs_places', DIRECTS.places), { name: g.name, a, b }));
      cap(`a cane raps twice over the PA - ${a} and ${b} go back to the stage`);
      if (game.booth?.at === 'CAB') game.puppets.anim('top_hat_rat', 'perform');
      return true;
    }
    case 'places_go':
      audio.play('fnar.tophat.cane', null, g, { vol: 0.7, pitch: 1.15 });
      audio.play('fnar.tophat.laugh', null, g, { vol: 0.35 });
      game.paQueue.push(fill(game.pickLine('directs_go', DIRECTS.go), { name: g.name }));
      cap('the cane comes down - they leave the stage together');
      if (game.booth?.at === 'CAB') game.puppets.anim('top_hat_rat', game.booth.anim ?? 'pose');
      return true;
    // ---------------------------------------------------------------- group tactics
    case 'clatter':
      // loud enough to carry to the office; CAM 6 (audio only) relays it at full strength
      audio.play('fnar.rat.bang', 'kitchen', g, { vol: 1, pitch: 1.35, relayCam: live });
      audio.play('fnar.rat.bang', null, g, { vol: 0.35, pitch: 1.35 });
      audio.play('fnar.night.scrape', null, g, { vol: 0.3, pitch: 1.2 });
      cap('a crash of pots in the kitchen');
      return true;
    case 'trade':
      audio.play('fnar.mirehop.strum', null, g, { vol: 0.3, pitch: 0.9 });
      audio.play('fnar.noxbriar.hum', null, g, { vol: 0.3, pitch: 0.9 });
      cap('a twang and a hum together, far off - they are trading halls');
      return true;
    // ---------------------------------------------------------------- memory: the one who got in last time
    case 'grudge':
      audio.play(SIGNATURE[e.who] ?? 'fnar.hall.whisper', null, g, { vol: 0.35, pitch: 0.7 });
      cap(`${Name(e.who)} remembers last night - ${WAY[e.way] ?? 'the same way'} again, first`);
      return true;
    default:
      return false;
  }
}

/**
 * Small signs of life (core/ai/liveliness.js): cosmetic, and never for a puppet that is
 * walking, hidden or in a pose of its own (leaning in at a door, dancing, crawling).
 * @param {any} game the Game
 * @param {any} e the 'idle' effect
 * @param {import('@minecraft/server').Player} g the guard
 */
export function renderIdle(game, e, g) {
  const s = game.session;
  const pup = game.puppets;
  const id = e.who;
  const props = pup.props[id] ?? {};
  if (!pup.get(id) || pup.isWalking(id) || props['fnar:hidden']) return;
  const node = NODES[e.node];
  if (!node) return;
  // still standing where the session said, and the same night
  const still = () => game.session === s && s.chars[id]?.node === e.node && !s.chars[id]?.walk && !pup.isWalking(id);
  const anim = props['fnar:anim'];
  switch (e.kind) {
    case 'tilt': {
      // (yaw + = to its right, pitch + = down)
      const feed = () => {
        const cam = game.cams.active ? CAMERA_BY_ID[s.devices.cams.cam] : null;
        return cam && !cam.audioOnly && cam.sees.includes(e.node) ? cam : null;
      };
      const cam = feed();
      // a head already turned to the lens (a camera stare) glances away, and comes back to it
      const staring = !!cam && (game.stare[id] ?? 0) >= STARE_AFTER;
      pup.look(id, e.yaw, e.pitch);
      // heard only through the camera that shows it
      if (cam) game.audio.play('fnar.servo.head', { x: node.x, y: node.y + 2, z: node.z }, g, { vol: 0.35, relayCam: cam.id });
      system.runTimeout(() => {
        if (!still()) return;
        const now = feed();
        if (staring && now) pup.lookAt(id, W(now.loc[0], now.loc[1], now.loc[2]));
        else if ((game.stare[id] ?? 0) < STARE_AFTER) pup.look(id, 0, 0);
      }, e.dur);
      return;
    }
    case 'pose':
      if (!AT_REST.has(anim)) return;
      pup.anim(id, e.pose);
      system.runTimeout(() => {
        if (still() && (pup.props[id] ?? {})['fnar:anim'] === e.pose) pup.anim(id, anim);
      }, e.dur);
      return;
    case 'shuffle':
      if (!AT_REST.has(anim)) return;
      pup.walk(id, e.path, e.dur, 'walk', node.yaw);
      system.runTimeout(() => {
        if (still() && (pup.props[id] ?? {})['fnar:anim'] === 'walk') pup.anim(id, anim);
      }, e.dur + 1);
      return;
    default:
  }
}

/** Caption for an arrival at a door or the window: their own tell, and the side it comes from. */
export function doorCaption(e) {
  const where = e.side === 'L' ? 'left door' : e.window ? 'right window' : 'right door';
  return `${e.who === 'mirehop' ? 'a guitar string twangs' : 'soft humming'} - ${where}`;
}

/**
 * A night of the week starts: night 1 always starts blank (so does a New Game), the others
 * start from what the cast remembers of the guard.
 * @param {any} game the Game
 * @param {import('../core/session.js').NightSession} s
 */
export function memoryStart(game, s) {
  const save = game.save;
  if (!memoryNight(s.night) || game.nightOpts?.challenge) return;
  if (s.night <= 1) {
    if (save.memory) {
      save.memory = null;
      storeSave(save);
    }
    return;
  }
  const b = s.recall(save.memory);
  if (b) log.info(`they remember: ${JSON.stringify(b)}`);
}

/**
 * A night of the week ended (6 AM, the takeover or a jumpscare): fold it into the memory.
 * Nights played with cheats are not remembered (they are no guide to how the guard plays).
 * @param {any} game the Game
 * @param {import('../core/session.js').NightSession} s
 */
export function memoryEnd(game, s) {
  if (!s || !memoryNight(s.night) || game.nightOpts?.challenge || game.nightOpts?.cheats) return;
  game.save.memory = remember(game.save.memory, s.summary());
  storeSave(game.save);
}

/** The line the Ringmaster slips into tonight's call about what they remember, or null. */
export function memoryLine(game, night) {
  if (game.nightOpts?.challenge) return null;
  for (const key of memoryHints(game.save.memory, night)) {
    const lines = key.split('.').reduce((o, k) => o?.[k], MEMORY_CALLS);
    if (Array.isArray(lines) && lines.length) return game.rng.pick(lines);
  }
  return null;
}

/**
 * A trick was part of the catch: its tip goes to the chat, where it is still there after the
 * game-over screen (which shows the killer's own tip).
 * @param {any} e the 'jumpscare' effect
 * @param {import('@minecraft/server').Player} g the guard
 */
export function killNote(e, g) {
  const tip = e.note ? KILL_TIPS[e.note] : null;
  if (!tip) return;
  system.runTimeout(() => {
    try {
      if (g.isValid) g.sendMessage(`§7[FNaR] §f${tip}`);
    } catch {
      // the guard left
    }
  }, 50);
}
