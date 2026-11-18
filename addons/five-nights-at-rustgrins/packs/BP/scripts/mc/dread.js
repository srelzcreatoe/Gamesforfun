// Night dread: the building gets worse as the night goes on. Presentation only: nothing here moves an
// animatronic or changes a rule, so the AI balance is untouched.
//
//   - a sub drone under the whole night, a second layer once something is close, a heartbeat once
//     something is at the office (or the power is nearly gone)
//   - honest tells at the office: breathing outside an open door, knocking and rattling on a shut one,
//     something breathing (or knocking) in a vent
//   - the sounds of the empty building: a far music box, children laughing in rooms nobody is in, a
//     radio in a back room, metal scraping down a hall, drips, the frame groaning, later a giggle
//     right behind the seat
//   - eyes that go hollow (pupils gone, a cold pinprick in each black socket) when an animatronic is
//     stared at on a camera, caught in the hall light, at the turn of an hour, in some jumpscares
//   - a hall light that stutters while something stands in it, the office lamp stuttering at midnight
//     and at 4 AM, darkness pulses when the power is almost out
import { system } from '@minecraft/server';
import { CAMERA_BY_ID } from '../data/cameras.js';
import { NODES } from '../data/nodes.js';
import { leanSpot } from './lean.js';
import { runCmd, W } from './world_io.js';
import { log } from './log.js';

/** Office nodes: an animatronic here is at the left door, the right door or the right window. */
const AT_DOOR = Object.freeze({ DOOR_L: 'L', DOOR_R: 'R', WIN_R: 'R' });
/** The duct ends over the office vents. */
const AT_VENT = Object.freeze({ WD_END: 'L', ED_END: 'R' });
/** One step out from the office: the hall corners, the nook, the hall ends, the last duct sections. */
const NEAR = new Set(['WC', 'EC', 'NOOK', 'WH_S', 'EH_S', 'WD_5', 'ED_5']);

/** Where the building's own sounds come from (local coordinates). */
const PLACES = Object.freeze({
  stage: { x: 38.5, y: 3.0, z: 6.0 },
  backstage: { x: 7.0, y: 1.5, z: 7.0 },
  gallery: { x: 8.5, y: 1.5, z: 45.0 },
  dining: { x: 38.5, y: 2.0, z: 22.0 },
  party: { x: 36.0, y: 1.5, z: 47.5 },
  gameroom: { x: 64.0, y: 1.5, z: 52.0 },
  funzone: { x: 90.0, y: 2.0, z: 56.0 },
  west_hall_n: { x: 27.5, y: 1.5, z: 41.0 },
  east_hall_n: { x: 45.5, y: 1.5, z: 41.0 },
  kitchen: { x: 72.0, y: 1.5, z: 7.0 },
  staff: { x: 8.0, y: 1.5, z: 60.0 },
  parts: { x: 64.0, y: 1.5, z: 67.0 },
  restrooms: { x: 72.0, y: 1.5, z: 20.0 },
  office_back: { x: 36.5, y: 1.7, z: 69.5 }, // behind the seat
});

/** The empty building. hour: from which hour (0 = 12 AM) it can happen; w: weight. */
const AMBIENT = Object.freeze([
  { id: 'fnar.night.musicbox_far', at: ['stage', 'backstage', 'gallery'], hour: 1, w: 3, vol: 0.9, cap: 'a music box, somewhere far away' },
  { id: 'fnar.night.kids', at: ['dining', 'party', 'gameroom', 'funzone'], hour: 2, w: 3, vol: 0.8, cap: 'children laughing in the empty building' },
  { id: 'fnar.night.scrape', at: ['west_hall_n', 'east_hall_n', 'dining'], hour: 1, w: 2, vol: 0.8, cap: 'metal scraping, far down a hall' },
  { id: 'fnar.night.radio', at: ['kitchen', 'staff', 'parts'], hour: 0, w: 2, vol: 0.8, cap: 'a radio crackles in a back room' },
  { id: 'fnar.night.drip', at: ['restrooms', 'kitchen', 'backstage', 'west_hall_n', 'east_hall_n'], hour: 0, w: 4, vol: 0.7, cap: null },
  { id: 'fnar.night.groan', at: ['dining', 'gameroom', 'party'], hour: 2, w: 2, vol: 1.0, cap: 'the building groans' },
  { id: 'fnar.night.giggle', at: ['office_back'], hour: 4, w: 1, vol: 0.45, cap: 'a giggle... right behind you' },
]);

const HOLLOW_PROP = 'fnar:hollow';

/** What flashes up, blood red, for a blink under "12 AM" as a night starts (none on the first night). */
const OPENING_LINES = Object.freeze({
  2: '§4YOU CAME BACK',
  3: '§4HE KNOWS YOUR NAME',
  4: '§4THE SHOW MUST GO ON',
  5: '§4IT IS ALMOST TIME',
  6: '§4CURTAIN UP',
  7: '§4AGAIN',
});

/** Caught in the hall light with the door open, they lean in this much closer (blocks) while the guard
 *  watches: the face stops 0.2 outside the shutter, so a door shut in its face never cuts through it. */
const CREEP_MAX = 0.35;
const CREEP_STEP = 0.012; // per 2 ticks: all the way in about 3 seconds
/** Each one's own sound, slowed down, a moment after it is caught in the light: [sound, pitch]. */
const DOOR_VOICE = Object.freeze({
  rustgrin: ['fnar.rustgrin.laugh', 0.6],
  rusted: ['fnar.rustgrin.laugh', 0.5],
  mirehop: ['fnar.mirehop.strum', 0.5],
  noxbriar: ['fnar.noxbriar.hum', 0.55],
  purple_rat: ['fnar.rat.squeak', 0.5],
  cat: ['fnar.cat.growl', 0.7],
  top_hat_rat: ['fnar.tophat.laugh', 0.6],
});

export class Dread {
  /** @param {any} game the Game (session, audio, puppets, act, hud, rng, save, cams) */
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.level = -1; // 0 calm, 1 something close, 2 something at the office
    this.nextAmbient = 0;
    /** id -> tick the hollow eyes end */
    this.hollow = new Map();
    /** door/vent key -> next tick a tell may play there */
    this.nextTell = new Map();
    this.nextDark = 0;
    /** @type {Set<string>} tells keys seen this check */
    this.present = new Set();
    this.revealed = new Set(); // sides whose hall light already caught a hollow stare tonight
    /** who stands at each office opening, and what it has done there so far */
    this.door = { L: null, R: null };
    this.firstLook = false; // the first time the monitor goes up tonight
  }

  get rng() {
    return this.game.rng;
  }

  cap(text, ticks = 70) {
    if (text && this.game.save.settings.captions) this.game.hud.setCaption(text, system.currentTick, ticks);
  }

  // ---------------------------------------------------------------- night start / end
  /**
   * The night shift begins. In the dark: the front doors lock, the breakers go room by room, a clock, a bell.
   * Then the office lamp struggles on, the hall lights flash by themselves, something whispers.
   * @param {import('@minecraft/server').Player} g
   * @param {number} night
   */
  start(g, night = 1) {
    this.reset();
    const now = system.currentTick;
    this.nextAmbient = now + 600 + this.rng.int(0, 500);
    this.game.audio.loop('dread_drone', 'fnar.night.drone', null, g, 0.35);
    this.level = 0;
    this.opening(g, night);
  }

  /** The first ten seconds of a shift (the view is black for the first three: see Game.startNight). */
  opening(g, night) {
    const game = this.game;
    const s = game.session;
    const a = game.audio;
    const act = game.act;
    const live = () => game.state === 'NIGHT' && game.session === s && !s.powerOut && g.isValid;
    const at = (t, fn) =>
      system.runTimeout(() => {
        if (!live()) return;
        try {
          fn();
        } catch (e) {
          log.warn(`night opening: ${e?.message ?? e}`);
        }
      }, t);
    // in the dark: the front doors lock behind you, something tries them, the breakers go room by room
    a.play('fnar.door.close', null, g, { vol: 0.8, pitch: 0.6 });
    at(10, () => a.play('fnar.night.door_rattle', null, g, { vol: 0.5, pitch: 0.8 }));
    [18, 26, 34].forEach((t, i) => at(t, () => a.play('fnar.light.off', null, g, { vol: 0.7, pitch: 0.9 - i * 0.12 })));
    // the clock, one far bell, the heartbeat
    at(44, () => a.play('fnar.night.midnight', null, g, { vol: 0.9 }));
    // under "12 AM", for a blink, something else (the camera map uses the title too: never over it)
    const line = OPENING_LINES[night];
    if (line) {
      const title = (text, sub, stay) => !game.cams.active && g.onScreenDisplay.setTitle(text, { fadeInDuration: 0, stayDuration: stay, fadeOutDuration: stay > 4 ? 20 : 0, subtitle: sub });
      at(57, () => title(line, ' ', 3));
      at(60, () => title('§f12 AM', `§7${game.nightLabel ?? ''}`, 30));
      at(57, () => a.play('fnar.cam.glitch', null, g, { vol: 0.5, pitch: 0.7 }));
    }
    // the office lamp is dead when the view comes back, then catches, fails, catches
    this.lampStutter([0, 78, 82, 88, 91, 98]);
    // from the fourth night: for the blink the lamp is on, there is someone slumped in the corner of the office
    if (night >= 4 && night !== 8 && !s.mods?.noRusted) {
      at(88, () => game.renderRusted(true));
      at(92, () => game.renderRusted(false));
    }
    // the hall lights come on by themselves, one after the other, on nothing
    for (const side of ['L', 'R']) {
      const t = side === 'L' ? 126 : 152;
      at(t, () => {
        if (side === 'L' ? s.devices.lightL : s.devices.lightR) return;
        act.hallLight(side, true);
        a.play('fnar.light.on', side === 'L' ? 'door_l' : 'door_r', g, { vol: 0.7, pitch: 0.8 });
        if (side === 'L') this.cap('the hall lights flicker on by themselves');
      });
      at(t + 9, () => act.hallLight(side, side === 'L' ? s.devices.lightL : s.devices.lightR));
    }
    // and from the dark, far off
    at(180, () => a.play('fnar.hall.whisper', PLACES.dining, g, { vol: 1.0, pitch: 0.7 }));
    if (night >= 2) at(230, () => a.play('fnar.night.musicbox_far', PLACES.stage, g, { vol: 0.8, pitch: 0.9 }));
  }

  /**
   * The monitor goes up. The first time each night, everyone on that camera is already looking straight
   * into the lens, eyes empty.
   */
  onCamsOpen(camId, g) {
    if (this.firstLook) return;
    this.firstLook = true;
    const game = this.game;
    const s = game.session;
    const cam = CAMERA_BY_ID[camId];
    if (!cam || cam.audioOnly) return;
    let seen = 0;
    for (const c of Object.values(s.chars)) {
      if (!c.node || c.walk || !cam.sees.includes(c.node)) continue;
      if (!game.puppets.lookAt(c.id, W(cam.loc[0], cam.loc[1], cam.loc[2]))) continue;
      this.setHollow(c.id, true, 50 + this.rng.int(0, 30));
      game.stare[c.id] = 1e6; // already staring: no second head turn
      seen++;
    }
    if (!seen) return;
    game.audio.play('fnar.night.twitch', null, g, { vol: 0.8 });
    game.audio.play('fnar.hall.sting', null, g, { vol: 0.55, pitch: 0.8 });
    this.cap('they were already looking at the camera');
  }

  /** The office lamp goes off and on at these tick offsets (off, on, off, on...), unless the night moved on. */
  lampStutter(at) {
    const act = this.game.act;
    const s = this.game.session;
    const live = () => this.game.state === 'NIGHT' && this.game.session === s && !s.powerOut;
    at.forEach((t, i) => system.runTimeout(() => live() && act.officeLamp(i % 2 === 1), t));
  }

  /** Stop the beds (the night ended, the power went out, a jumpscare). */
  stopBeds() {
    const a = this.game.audio;
    a.stop('dread_drone');
    a.stop('dread_drone2');
    a.stop('dread_heart');
    this.level = -1;
  }

  // ---------------------------------------------------------------- hollow eyes
  /** Pupils gone, a pinprick in each black socket, for `ticks` (0 = until cleared). */
  setHollow(id, on, ticks = 0) {
    const p = this.game.puppets;
    if (on) this.hollow.set(id, ticks ? system.currentTick + ticks : Infinity);
    else this.hollow.delete(id);
    if (typeof p.hollow === 'function') p.hollow(id, on);
    else p.setProp(id, HOLLOW_PROP, !!on);
  }

  clearHollow() {
    for (const id of [...this.hollow.keys()]) this.setHollow(id, false);
  }

  /** How likely an eerie moment is tonight at this hour (grows through the night and the week). */
  odds(base, perHour) {
    const s = this.game.session;
    const night = Math.min(5, s?.night ?? 1);
    return Math.min(0.85, base + perHour * (s?.hour ?? 0) + 0.05 * Math.max(0, night - 1));
  }

  /** An animatronic watched on a camera turned its head to the lens: sometimes its pupils go too. */
  onStare(id, cam, where, g) {
    if (!this.rng.chance(this.odds(0.12, 0.08))) return;
    this.setHollow(id, true, 110 + this.rng.int(0, 90));
    this.game.audio.play('fnar.night.twitch', where, g, { vol: 0.8, relayCam: cam });
  }

  /** The hall light came on: whoever stands in it has its head cocked at a wrong angle, then snaps
   *  round to the guard; often its eyes are empty. */
  onLight(side, on, g) {
    if (!on) return;
    const s = this.game.session;
    const now = system.currentTick;
    for (const c of Object.values(s.chars)) {
      if (!c.node || c.walk || AT_DOOR[c.node] !== side) continue;
      const st = this.occupant(side, c, now);
      st.tiltUntil = now + 12 + this.rng.int(0, 10);
      this.game.puppets.look(c.id, (this.rng.chance(0.5) ? -1 : 1) * (22 + this.rng.int(0, 18)), -8 + this.rng.int(0, 26));
      const spot = side === 'L' ? 'door_l' : 'door_r';
      this.game.audio.play('fnar.night.twitch', spot, g, { vol: 0.9 });
      if (!this.rng.chance(this.odds(0.45, 0.08))) continue;
      this.setHollow(c.id, true, 120 + this.rng.int(0, 80));
      this.shake(g, 0.12, 0.25);
      // the first empty stare caught in the light each night, per side, gets the sting
      if (!this.revealed.has(side)) {
        this.revealed.add(side);
        this.game.audio.play('fnar.night.stinger', null, g, { vol: 0.75 });
      }
    }
  }

  /** The record of whoever stands at an office opening (a new one when someone else arrives). */
  occupant(side, c, now) {
    let st = this.door[side];
    if (!st || st.id !== c.id || st.node !== c.node) {
      st = this.door[side] = { id: c.id, node: c.node, since: now, litSince: -1, creep: 0, voiced: false, whispered: false, knocks: 0, tiltUntil: 0 };
      // arriving in the dark: sometimes the eyes are already empty, two cold pinpricks in the doorway
      if (this.rng.chance(this.odds(0.3, 0.06))) this.setHollow(c.id, true);
    }
    return st;
  }

  /**
   * At the office openings, every 2 ticks: while the hall light is on, the head follows the guard around
   * the office, it leans in closer (door open), makes its own sound slowed down, then whispers the
   * guard's name.
   */
  tickDoors(s, d, g, now) {
    for (const side of ['L', 'R']) {
      const occ = Object.values(s.chars).find((c) => c.node && !c.walk && AT_DOOR[c.node] === side);
      if (!occ) {
        this.door[side] = null;
        continue;
      }
      const st = this.occupant(side, occ, now);
      const lit = side === 'L' ? d.lightL : d.lightR;
      const shut = side === 'L' ? d.doorL : d.doorR;
      if (!lit) {
        st.litSince = -1; // the head stays where it was: on with the light again, it is still on you
        continue;
      }
      if (st.litSince < 0) st.litSince = now;
      const lt = now - st.litSince;
      if (now >= st.tiltUntil) this.trackGuard(st, g);
      if (!shut && st.creep < CREEP_MAX) {
        st.creep = Math.min(CREEP_MAX, st.creep + CREEP_STEP);
        this.leanIn(st);
      }
      const spot = side === 'L' ? 'door_l' : 'door_r';
      if (!st.voiced && lt >= 30) {
        st.voiced = true;
        const v = DOOR_VOICE[this.game.puppets.skin?.[st.id] ?? st.id] ?? DOOR_VOICE[st.id];
        if (v) this.game.audio.play(v[0], spot, g, { vol: 0.9, pitch: v[1] });
      }
      if (!st.whispered && lt >= 70) {
        st.whispered = true;
        this.game.audio.play('fnar.hall.whisper', spot, g, { vol: 0.9, pitch: 0.75 });
        this.game.hud.setMessage(`§8§o...${g.name}...`, now, 50);
      }
    }
  }

  /** Turn the head of whoever is at a door at the guard's eyes. */
  trackGuard(st, g) {
    try {
      this.game.puppets.lookAt(st.id, g.getHeadLocation());
    } catch {
      // ignore
    }
  }

  /** Lean a little further in through the opening (from its lean spot along its facing). */
  leanIn(st) {
    const n = NODES[st.node];
    const base = leanSpot(st.id, st.node);
    const r = (n.yaw * Math.PI) / 180;
    this.game.puppets.teleport(st.id, { x: base.x - Math.sin(r) * st.creep, y: base.y, z: base.z + Math.cos(r) * st.creep }, n.yaw);
  }

  shake(g, intensity, seconds) {
    runCmd(`camerashake add @a[name="${g.name}"] ${intensity} ${seconds} positional`);
  }

  /** The clock struck: things get worse at the turn of the late hours. */
  onHour(hour, g) {
    const s = this.game.session;
    const a = this.game.audio;
    if (hour >= 2 && this.game.cams.active) {
      // every face on the live camera snaps to the lens, eyes empty
      const cam = CAMERA_BY_ID[s.devices.cams.cam];
      for (const c of Object.values(s.chars)) {
        if (!c.node || c.walk || !cam?.sees.includes(c.node)) continue;
        this.setHollow(c.id, true, 60);
        a.play('fnar.night.twitch', null, g, { vol: 0.6, pitch: 0.9 + this.rng.next() * 0.2 });
      }
    }
    if (hour === 3) {
      a.play('fnar.night.musicbox_far', PLACES.stage, g, { vol: 1.0, pitch: 0.92 });
      this.cap('3 AM - the music box plays on the empty stage');
    } else if (hour === 4) {
      a.play('fnar.night.groan', PLACES.dining, g, { vol: 1.0, pitch: 0.8 });
      this.lampStutter([2, 5, 8, 20]);
      this.cap('4 AM - the lights struggle');
    } else if (hour === 5) {
      a.loop('dread_heart', 'fnar.night.heartbeat', null, g, 0.8);
      a.play('fnar.hall.whisper', null, g, { vol: 0.7, pitch: 0.7 });
      this.cap('5 AM - one more hour');
    }
  }

  /** A jumpscare: some of them come at you with empty eyes. */
  onJumpscare(id) {
    this.stopBeds();
    if (this.rng.chance(0.35)) this.setHollow(id, true);
  }

  // ---------------------------------------------------------------- every tick of the night
  /** @param {import('@minecraft/server').Player} g */
  tick(g, now) {
    const s = this.game.session;
    if (!s || this.level < 0) return;
    // hollow eyes run out (or end once the animatronic walks off)
    for (const [id, until] of [...this.hollow]) {
      if (now >= until || s.chars[id]?.walk) this.setHollow(id, false);
    }
    if (now % 2 === 0 && !s.powerOut) this.tickDoors(s, s.devices, g, now);
    if (now % 10 !== 0) return;
    if (s.powerOut) {
      this.stopBeds();
      return;
    }
    const snap = s.snapshot();
    const d = snap.devices;
    let atOffice = 0;
    let near = 0;
    this.present = new Set();
    for (const c of Object.values(s.chars)) {
      if (!c.node || c.walk) continue;
      if (AT_DOOR[c.node] || AT_VENT[c.node]) {
        atOffice++;
        this.tell(c, d, g, now);
      } else if (NEAR.has(c.node)) near++;
    }
    for (const k of [...this.nextTell.keys()]) if (!this.present.has(k)) this.nextTell.delete(k); // they left
    const lowPower = snap.powerPct <= 10;
    const level = atOffice || lowPower ? 2 : near || snap.hour >= 4 ? 1 : 0;
    this.setLevel(level, g);
    // the heartbeat races while one of them stares at you in the light
    const staring = ['L', 'R'].some((side) => this.door[side] && this.door[side].litSince >= 0);
    if (this.level >= 2) this.game.audio.loop('dread_heart', 'fnar.night.heartbeat', null, g, 0.7, staring ? 1.3 : 1);
    this.stutter(s, d, now);
    // darkness pulses as the power runs out (only with the monitor down: the feed has night vision)
    if (lowPower && !this.game.cams.active && now >= this.nextDark) {
      this.nextDark = now + 400 + this.rng.int(0, 400);
      try {
        g.addEffect('darkness', 60, { amplifier: 0, showParticles: false });
      } catch {
        // ignore
      }
    }
    if (now >= this.nextAmbient) this.ambient(snap, g, now);
  }

  setLevel(level, g) {
    if (level === this.level) return;
    const a = this.game.audio;
    if (level >= 1) a.loop('dread_drone2', 'fnar.night.drone', null, g, 0.3);
    else a.stop('dread_drone2');
    if (level >= 2) a.loop('dread_heart', 'fnar.night.heartbeat', null, g, 0.7);
    else if (this.game.session?.hour !== 5) a.stop('dread_heart');
    this.level = level;
  }

  /** Honest tells for whoever is at a door, the window or a vent. */
  tell(c, d, g, now) {
    const key = `${c.id}@${c.node}`;
    this.present.add(key);
    // the first tell comes a few seconds after they arrive (the arrival has its own cue)
    if (!this.nextTell.has(key)) {
      this.nextTell.set(key, now + 60 + this.rng.int(0, 80));
      return;
    }
    if (now < /** @type {number} */ (this.nextTell.get(key))) return;
    const a = this.game.audio;
    const door = AT_DOOR[c.node];
    if (door) {
      const spot = door === 'L' ? 'door_l' : 'door_r';
      const where = door === 'L' ? 'left door' : c.node === 'WIN_R' ? 'right window' : 'right door';
      const shut = door === 'L' ? d.doorL : d.doorR;
      const lit = door === 'L' ? d.lightL : d.lightR;
      if (shut && c.node !== 'WIN_R') {
        const st = this.door[door];
        const n = st && st.id === c.id ? ++st.knocks : 1;
        if (n >= 3 && this.rng.chance(0.6)) {
          // it has lost patience: it pounds on the shutter
          a.play('fnar.night.knock', spot, g, { vol: 1.0, pitch: 0.8 });
          a.play('fnar.night.door_rattle', spot, g, { vol: 1.0, pitch: 0.9 });
          this.shake(g, 0.2, 0.4);
          this.cap(`POUNDING on the ${where}`);
        } else if (this.rng.chance(0.6)) {
          a.play('fnar.night.knock', spot, g, { vol: 0.9 });
          this.cap(`knocking on the ${where}`);
        } else {
          a.play('fnar.night.door_rattle', spot, g, { vol: 0.9 });
          this.cap(`something tries the ${where}`);
        }
        // more and more often as it loses patience
        this.nextTell.set(key, now + Math.max(80, 160 - n * 20) + this.rng.int(0, 120));
        return;
      }
      if (!lit) {
        a.play('fnar.night.breath', spot, g, { vol: 0.8 });
        this.cap(`breathing, just outside the ${where}`);
      }
      this.nextTell.set(key, now + 220 + this.rng.int(0, 200));
      return;
    }
    const vent = AT_VENT[c.node];
    if (vent) {
      const spot = vent === 'L' ? 'vent_l' : 'vent_r';
      const shut = vent === 'L' ? d.ventL : d.ventR;
      if (shut) {
        a.play('fnar.night.knock', spot, g, { vol: 0.7, pitch: 0.8 });
        this.cap(`something knocking inside the ${vent === 'L' ? 'left' : 'right'} vent`);
      } else {
        a.play('fnar.night.breath', spot, g, { vol: 0.7, pitch: 1.15 });
        this.cap(`something breathing in the ${vent === 'L' ? 'left' : 'right'} vent`);
      }
      this.nextTell.set(key, now + 240 + this.rng.int(0, 200));
    }
  }

  /** A lit hall light stutters while something stands in it. */
  stutter(s, d, now) {
    for (const side of ['L', 'R']) {
      const lit = side === 'L' ? d.lightL : d.lightR;
      if (!lit) continue;
      const someone = Object.values(s.chars).some((c) => c.node && !c.walk && AT_DOOR[c.node] === side);
      if (!someone || !this.rng.chance(0.04)) continue;
      const act = this.game.act;
      act.hallLight(side, false);
      system.runTimeout(() => {
        const cur = this.game.session;
        if (this.game.state !== 'NIGHT' || cur !== s || s.powerOut) return;
        act.hallLight(side, side === 'L' ? s.devices.lightL : s.devices.lightR);
      }, 2 + this.rng.int(0, 3));
    }
  }

  /** One of the building's own sounds, from somewhere nobody is. */
  ambient(snap, g, now) {
    const hour = snap.hour ?? 0;
    const pool = AMBIENT.filter((e) => hour >= e.hour);
    const total = pool.reduce((t, e) => t + e.w, 0);
    let r = this.rng.next() * total;
    let e = pool[0];
    for (const x of pool) {
      r -= x.w;
      if (r <= 0) {
        e = x;
        break;
      }
    }
    // sooner as the night goes on
    const base = Math.max(600, 1500 - hour * 150);
    this.nextAmbient = now + Math.round(base * (0.6 + this.rng.next() * 0.8));
    if (!e) return;
    const where = PLACES[this.rng.pick(e.at)];
    try {
      this.game.audio.play(e.id, where, g, { vol: e.vol, pitch: 0.9 + this.rng.next() * 0.15, relayCam: this.game.cams.active ? snap.devices.cam : null });
      this.cap(e.cap);
    } catch (err) {
      log.warn(`dread ${e.id}: ${err?.message ?? err}`);
    }
  }
}
