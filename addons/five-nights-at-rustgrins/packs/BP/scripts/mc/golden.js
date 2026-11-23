// The Golden Dog in the world (the session side is core/ai/golden_dog.js; docs/GOLDEN_DOG.md is the
// design, data/cellar.js the map's contract, data/story.js GOLDEN every line of text). game.js calls in here:
//
//   render      every `fx: 'golden'` effect: his place on the stage, the watch, each shift and its end
//   tick        once per tick of a night: the silence while the cast is held, where the guard's eyes are
//               (the one thing the session asks of this layer), his breath, his walk, the phone
//   onCams      the monitor went up or switched: the wrong feed shows the cellar, a visit shows his face
//   onPhone     the desk phone was clicked: in the Other Office it is the way back
//   keep        the guard is kept in the Other Office while they sit there
//   stop        a night ended, however: everything he bent is put back
//   roamStart / roamTick / roamStop     Free Roam: he stands on his stage, his head follows whoever looks at him,
//               he is not quite as he was when they look back, and the cellar has its own air
//
// Everything here is presentation: the session has already decided what happens. One rule holds for all of
// it, and it is the player's to learn: never look at the Golden Dog.

import { system } from '@minecraft/server';
import { GOLDEN as ID } from '../core/config.js';
import { GOLDEN as TEXT } from '../data/story.js';
import { CELLAR } from '../data/cellar.js';
import { NODES } from '../data/nodes.js';
import { CAMERA_BY_ID } from '../data/cameras.js';
import { OFFICE } from '../data/layout.js';
import { W, Wv, L, dim, setLocal, setStateLocal, blockAt, typeAtLocal, runCmd } from './world_io.js';
import { log } from './log.js';

/**
 * HIS NUMBERS. The one place the game keeps the Golden Dog's measurements (blocks, as rendered), from the
 * models' own measuring tool (tools/entities/measure.mjs): standing eye height, eye height on the held frame of
 * his jumpscare, how far in front of the lens the jumpscare starts (his head reaches 1.68 in front of his feet,
 * so its nearest point ends about 0.45 from the lens, like the others'), his standing height and his width.
 * game.js reads them into its own tables (HEAD_Y, JUMPSCARE_EYE_Y, JUMPSCARE_DIST).
 */
export const GOLDEN_BODY = Object.freeze({ eyeY: 2.82, jumpscareEyeY: 2.34, jumpscareDist: 2.13, height: 3.52, width: 2.0 });

/**
 * "Looking at him": the angle (degrees) between the guard's view and the nearest part of him (knees, chest,
 * eyes) at or under which he counts as looked at. A visit: he fills a good part of the screen from four blocks,
 * and a careful guard may catch him at its edge without facing him. The Other Office: he is far down the hall,
 * dead ahead of the seat, and looking down at the desk (and its phone) is well outside it. Free Roam is lenient.
 */
const LOOK_CONE = Object.freeze({ visit: 30, other: 20, roam: 38 });
/** Head up on his stage (his level is low): the slump tips his head down about 40 degrees; this lifts it off his chest. */
const WAKE_PITCH = -34;
/** One breath lasts this long (fnar.golden.breath is 4 s). */
const BREATH_TICKS = 80;
/** The Other Office: the old phone rings this often, and he puts a foot down this often while he walks. */
const RING_EVERY = 50;
const STEP_EVERY = 13;
/** The light that goes with him down the hall, and the little there is on the desk (palette light keys). */
const HIS_LIGHT = 'light13';
const DESK_LIGHT = 'light7';
/** Loops that are the guard's own gear: they are not part of the building's silence. */
const KEEP_LOOPS = /^(cam_hum|buzz_|cellar)/;
const FOG = Object.freeze({ nightPop: 'fog @a remove fnar_night', latePop: 'fog @a remove fnar_late', nightPush: 'fog @a push fnar:night fnar_night', latePush: 'fog @a push fnar:night_late fnar_late' });
/** Free Roam: how he may stand when somebody looks back (never twice the same in a row). `step`: blocks forward. */
const ROAM_LOOKS = Object.freeze([
  { anim: 'stand' }, { anim: 'pose' }, { anim: 'stand', yaw: 16 }, { anim: 'idle', yaw: -12 }, { anim: 'lean' },
  { anim: 'stand', step: 0.7 }, { anim: 'slump' }, { anim: 'stand', eyes: true }, { anim: 'pose', yaw: -20, eyes: true },
]);
/** Extras > The Cast: where he stands in the Gallery while he is looked at (between the two rows of pedestals). */
export const GALLERY_SPOT = Object.freeze({ x: 8.5, y: 0, z: 45.5, yaw: -90, view: Object.freeze({ x: 13.5, y: 0, z: 45.5 }) });

const fill = (text, vars) => String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));

/**
 * Is this player looking at him? `feet`: where he stands (local coordinates).
 * @param {import('@minecraft/server').Player} p
 * @param {{ x: number, y: number, z: number }} feet
 * @param {number} cone degrees
 */
export function looksAt(p, feet, cone) {
  let view;
  let eye;
  try {
    view = p.getViewDirection();
    eye = L(p.getHeadLocation());
  } catch {
    return false;
  }
  const min = Math.cos((cone * Math.PI) / 180);
  for (const up of [0.9, 1.8, GOLDEN_BODY.eyeY]) {
    const v = { x: feet.x - eye.x, y: feet.y + up - eye.y, z: feet.z - eye.z };
    const d = Math.hypot(v.x, v.y, v.z) || 1;
    if ((v.x * view.x + v.y * view.y + v.z * view.z) / d >= min) return true;
  }
  return false;
}

export class Golden {
  /** @param {any} game the Game */
  constructor(game) {
    this.game = game;
    /** Free Roam state, or null */
    this.roam = null;
    this.roamSpot = null;
    this.reset();
  }

  reset() {
    /** the building is silent: the cast is held (mirrors the session, a tick behind) */
    this.hush = false;
    /** @type {[string, any][]} the loops put out for the silence */
    this.saved = [];
    this.bgmWasOn = false;
    /** @type {{ x: number, y: number, z: number, perm: any }[]} gilded cells and what was there */
    this.gilded = [];
    /** @type {number[][]} light blocks of his in the world */
    this.lights = [];
    /** @type {number[] | null} the light that walks with him */
    this.follow = null;
    /** @type {{ breathAt: number, inst: any } | null} */
    this.visit = null;
    /** @type {{ there: boolean, ringing: boolean, ringAt: number, walking: boolean, stepAt: number, told: Record<string, boolean> } | null} */
    this.other = null;
    this.lampOff = false;
    /** the watch cut into the Ringmaster's call (he says so once a night) */
    this.interrupted = false;
    this.saidInterrupted = false;
    /** how he stands on his stage tonight ('slump' | 'wake' | 'stand') */
    this.pose = 'slump';
    /** @type {any[]} sounds that must stop with a shift (the watch, the chime, a breath) */
    this.playing = [];
  }

  get session() {
    return this.game.session;
  }

  /** The guard sits in the Other Office right now. */
  get away() {
    return !!this.session?.golden.away;
  }

  cap(text, ticks = 80) {
    if (text && this.game.save.settings.captions) this.game.hud.setCaption(text, system.currentTick, ticks);
  }

  /** A sound at the guard that a shift's end can cut off. */
  playHeld(g, id, o = {}) {
    try {
      const inst = o.at ? dim().playSound(id, W(o.at.x, o.at.y, o.at.z), { volume: o.vol ?? 1, pitch: o.pitch ?? 1 }) : g.playSound(id, { volume: o.vol ?? 1, pitch: o.pitch ?? 1 });
      this.playing = [...this.playing.slice(-3), inst];
      return inst;
    } catch (e) {
      log.warn(`golden sound ${id}: ${e?.message ?? e}`);
      return undefined;
    }
  }

  cut() {
    for (const inst of this.playing) {
      try {
        inst?.stop();
      } catch {
        // already over
      }
    }
    this.playing = [];
  }

  tear(g, vol = 0.8, pitch = 1) {
    this.game.audio.play('fnar.golden.tear', null, g, { vol, pitch });
  }

  /** Tell the co-op camera operators (they sit in the Staff Room and see none of this). */
  tellOps(text) {
    for (const id of this.game.ops.keys()) {
      const p = this.game.players().find((x) => x.id === id);
      try {
        p?.sendMessage(text);
      } catch {
        // gone
      }
    }
  }

  // ================================================================ the night: effects
  /**
   * @param {any} e an effect with fx 'golden'
   * @param {import('@minecraft/server').Player} g the guard
   */
  render(e, g) {
    const game = this.game;
    const s = game.session;
    const pup = game.puppets;
    const now = system.currentTick;
    const C = TEXT.caption;
    switch (e.kind) {
      case 'place':
        this.pose = e.pose;
        this.onStage(e.node);
        return;
      case 'tell':
        // the pocket watch: nothing else in the building ticks. His stage is empty from now on
        this.playHeld(g, 'fnar.golden.watch', { vol: 1 });
        this.cap(C.tell, 60);
        pup.hide(ID, true);
        if (game.phoneSeq && game.phoneSeq.i >= 0) {
          // the Ringmaster stops in the middle of a word
          this.interrupted = true;
          game.hud.setSpeech('', now, 0);
        }
        return;
      case 'shift':
        this.cut();
        this.tear(g);
        return this.begin(e, g, now);
      case 'pick':
        // the wrong feed: every camera picked brings him a step nearer
        game.audio.play('fnar.golden.step', null, g, { vol: 0.35 + 0.2 * e.n, pitch: 0.9 });
        this.cap(fill(e.n >= e.of ? C.picked : C.pick, { n: e.n, of: e.of }), 70);
        if (e.n >= e.of) game.audio.play('fnar.cam.glitch', null, g, { vol: 0.9, pitch: 0.7 });
        return;
      case 'seen':
        if (e.on) {
          // he saw the guard look: the breathing stops, and his head comes round
          this.cut();
          game.audio.play('fnar.hall.sting', null, g, { vol: 0.55, pitch: 0.7 });
          try {
            pup.lookAt(ID, g.getHeadLocation());
          } catch {
            // ignore
          }
          this.cap(C.seen, 50);
        } else {
          pup.look(ID, 0, 0);
          if (this.visit) this.visit.breathAt = now + 12;
          this.cap(C.unseen, 50);
        }
        return;
      case 'arrive':
        return this.arrive(g, now);
      case 'phone':
        return this.phone(e, g, now);
      case 'walk':
        if (!this.other) return;
        this.other.walking = !!e.on;
        this.other.stepAt = now;
        pup.anim(ID, e.on ? 'walk' : 'stand');
        this.cap(e.on ? C.walk : C.stop, 60);
        return;
      case 'step':
        // he passes one of his spots: a board gives, nearer than the last
        if (this.other) game.audio.play('fnar.golden.step', this.hisSpot(1.2), g, { vol: 1, pitch: 0.92 });
        return;
      case 'stare':
        return this.stare(e.on, g);
      case 'end':
        this.cut();
        return this.finish(e, g, now);
      default:
        log.warn(`golden: unknown effect ${e.kind}`);
    }
  }

  /** He stands on his stage, the way tonight's level has him. */
  onStage(node = CELLAR.stage) {
    const pup = this.game.puppets;
    pup.spawn(ID, node, this.pose === 'stand' ? 'stand' : 'slump');
    this.settle();
  }

  /** His eyes and head for tonight's pose (after anything that turned them). */
  settle() {
    const pup = this.game.puppets;
    pup.eyes(ID, this.pose !== 'slump');
    pup.hollow(ID, this.pose === 'wake');
    pup.look(ID, 0, this.pose === 'wake' ? WAKE_PITCH : 0);
  }

  /** CAM 11: he turns to the lens / lets go of it. */
  stare(on, g) {
    const game = this.game;
    const pup = game.puppets;
    if (!on) return this.settle();
    const cam = CAMERA_BY_ID[CELLAR.cam];
    const n = NODES[CELLAR.stage];
    if (!cam || !n) return;
    pup.eyes(ID, true);
    pup.hollow(ID, true);
    pup.lookAt(ID, W(cam.loc[0], cam.loc[1], cam.loc[2]));
    game.audio.play('fnar.servo.head', { x: n.x, y: n.y + GOLDEN_BODY.eyeY, z: n.z }, g, { vol: 0.7, pitch: 0.7, relayCam: game.cams.active ? CELLAR.cam : null });
    this.cap(TEXT.caption.stare, 70);
  }

  /** A shift begins. */
  begin(e, g, now) {
    const game = this.game;
    const s = game.session;
    const pup = game.puppets;
    const C = TEXT.caption;
    switch (e.shift) {
      case 'gild':
        this.gild(e.where);
        this.cap(e.where === 'hall' ? C.gild_hall : C.gild_office, e.dur);
        return;
      case 'dawn':
        // the 6 AM card, as the real one is shown (game.js sixAm), and the chime that is not the chime
        this.playHeld(g, 'fnar.golden.chime', { vol: 1 });
        try {
          g.onScreenDisplay.setTitle(TEXT.dawn.card[0], { fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 20, subtitle: fill(TEXT.dawn.card[1], { label: game.nightLabel }) });
        } catch {
          // ignore
        }
        this.cap(C.dawn, e.dur);
        return;
      case 'feed':
        game.audio.play('fnar.cam.glitch', null, g, { vol: 0.9, pitch: 0.8 });
        if (game.cams.active) this.onCams({ open: true, cam: s.devices.cams.cam, reason: 'feed' }, g);
        this.cap(C.feed, 90);
        return;
      case 'mirror':
        this.flash(g, { red: 0.55, green: 0.42, blue: 0.08 }, 0.25);
        this.cap(C.mirror, 100);
        return;
      case 'visit': {
        // behind the seat, between the doors, facing the guard's back. The lamp dims while he is in the room
        pup.spawn(ID, e.node, 'idle');
        pup.eyes(ID, true);
        pup.hollow(ID, true);
        game.act.officeLamp(false);
        this.lampOff = true;
        this.visit = { breathAt: now + 4, inst: null };
        this.cap(C.visit, 100);
        this.tellOps(TEXT.operator.visit);
        return;
      }
      case 'other': {
        // the lamp stutters, the dark comes up, and when it lifts the office is not the office
        this.other = { there: false, ringing: false, ringAt: 0, walking: false, stepAt: 0, told: {} };
        this.lampOff = true;
        const lamp = (on, at) => system.runTimeout(() => {
          if (game.session === s && this.other && !this.other.there) game.act.officeLamp(on);
        }, at);
        game.act.officeLamp(false);
        lamp(true, 4);
        lamp(false, 7);
        lamp(true, 12);
        lamp(false, 15);
        const t = Math.max(0.2, (e.fade - 12) / 20);
        try {
          g.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: t, holdTime: 0.9, fadeOutTime: 1.2 } });
        } catch {
          // ignore
        }
        this.cap(C.other, 90);
        this.tellOps(TEXT.operator.other);
        return;
      }
      default:
    }
  }

  /** A shift is over (`how`: 'time', 'lowered', 'picked', 'answered', 'power'): what he bent goes back. */
  finish(e, g, now) {
    const game = this.game;
    const s = game.session;
    const C = TEXT.caption;
    const dark = !!s?.powerOut;
    switch (e.shift) {
      case 'gild':
        this.ungild();
        this.tear(g, 0.5, 1.2);
        return;
      case 'dawn':
        // it tears away: it is still night
        this.tear(g, 1, 0.9);
        this.flash(g, { red: 0.45, green: 0, blue: 0.03 }, 0.35);
        runCmd(`camerashake add @a[name="${g.name}"] 0.3 0.6 rotational`);
        try {
          g.onScreenDisplay.setTitle(TEXT.dawn.torn[0], { fadeInDuration: 0, stayDuration: 16, fadeOutDuration: 8, subtitle: TEXT.dawn.torn[1] });
        } catch {
          // ignore
        }
        this.cap(C.dawn_end, 70);
        return;
      case 'feed':
        if (e.how === 'picked') return; // (the visit that follows has its own tear)
        this.tear(g, 0.6, 1.2);
        if (game.cams.active && s) {
          // the cameras are their own again
          game.cams.show(s.devices.cams.cam);
          game.act.camLight(s.devices.cams.cam);
        }
        this.cap(C.feed_end, 50);
        return;
      case 'mirror':
        this.tear(g, 0.6, 1.2);
        this.flash(g, { red: 0.55, green: 0.42, blue: 0.08 }, 0.2);
        this.cap(C.mirror_end, 50);
        return;
      case 'visit':
        this.tear(g, 0.7, 1.1);
        game.puppets.hide(ID, true);
        this.visit = null;
        this.lamp(!dark);
        if (game.cams.active && s && !s.result) {
          // (the monitor was up: it shows the cameras again)
          game.cams.show(s.devices.cams.cam);
          game.act.camLight(s.devices.cams.cam);
        }
        this.cap(C.visit_end, 60);
        return;
      case 'other':
        this.leave(e.how, g, now);
        return;
      default:
        this.cap(C.end, 40);
    }
  }

  lamp(on) {
    if (!this.lampOff) return;
    this.lampOff = !on;
    this.game.act.officeLamp(on);
  }

  flash(g, color, hold) {
    try {
      g.camera.fade({ fadeColor: color, fadeTime: { fadeInTime: 0.04, holdTime: hold, fadeOutTime: 0.4 } });
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------- gilding
  /**
   * For a few seconds the place is his: every gild cell in what the guard is looking at (`where`: 'office' or
   * 'hall'; all of them when the map lists none for it) gets its alternate block. What stood there is kept as
   * found and put back by ungild(), so it works for any list and for cells the night has already changed.
   * @param {string} where
   * @param {readonly { x: number, y: number, z: number, key: string, where?: string }[]} [list] the cells (the map's own)
   */
  gild(where, list = CELLAR.gild) {
    this.ungild();
    const all = list;
    const cells = all.some((c) => c.where === where) ? all.filter((c) => c.where === where) : all;
    for (const c of cells) {
      const b = blockAt(c.x, c.y, c.z);
      if (!b) continue;
      let perm;
      try {
        // a light of somebody else's is not his to move (it would not be put out again)
        if (b.typeId.startsWith('minecraft:light_block')) continue;
        perm = b.permutation;
      } catch {
        continue;
      }
      if (setLocal(c.x, c.y, c.z, c.key)) this.gilded.push({ x: c.x, y: c.y, z: c.z, perm });
    }
  }

  ungild() {
    for (const c of this.gilded) {
      try {
        dim().setBlockPermutation(W(c.x, c.y, c.z), c.perm);
      } catch (e) {
        log.warn(`ungild @${c.x},${c.y},${c.z}: ${e?.message ?? e}`);
      }
    }
    this.gilded = [];
  }

  // ---------------------------------------------------------------- the monitor
  /**
   * The monitor went up or another camera was picked (game.js renderCams, after its own work). During the
   * wrong feed every camera shows the cellar; during a visit the monitor shows only his face.
   * @returns {boolean} whether he took the picture over
   */
  onCams(e, g) {
    const game = this.game;
    const gd = game.session?.golden;
    if (!gd || !e.open || !game.cams.active) return false;
    if (gd.blind) {
      game.cams.show(CELLAR.cam);
      game.act.camLight(CELLAR.cam);
      if (e.reason !== 'feed') game.audio.play('fnar.cam.glitch', null, g, { vol: 0.5, pitch: 0.9 });
      return true;
    }
    if (gd.state === 'visit') {
      const n = NODES[CELLAR.visit];
      if (!n) return false;
      // a lens an arm's length in front of his eyes (he faces n.yaw)
      const r = (n.yaw * Math.PI) / 180;
      const fwd = { x: -Math.sin(r), z: Math.cos(r) };
      const eye = { x: n.x + fwd.x * 0.48, y: n.y + GOLDEN_BODY.eyeY, z: n.z + fwd.z * 0.48 };
      game.cams.showAt({ x: eye.x + fwd.x * 1.25, y: eye.y - 0.08, z: eye.z + fwd.z * 1.25 }, eye);
      game.act.clearCamLight();
      game.audio.play('fnar.cam.glitch', null, g, { vol: 0.8, pitch: 0.6 });
      return true;
    }
    return false;
  }

  /** Is his picture on the monitor instead of a camera's (no static, no "audio only" over it)? */
  get onMonitor() {
    const gd = this.session?.golden;
    return !!gd && (gd.blind || gd.state === 'visit');
  }

  // ---------------------------------------------------------------- the Other Office
  /** Where he stands down there (local), `up` blocks above his feet. */
  hisSpot(up = 0) {
    const p = this.session?.golden.pos() ?? [NODES[CELLAR.stage].x, NODES[CELLAR.stage].y, NODES[CELLAR.stage].z];
    return { x: p[0], y: p[1] + up, z: p[2] };
  }

  /** The dark lifts: the guard sits in the Other Office, and he is on his stage at the far end of the hall. */
  arrive(g, now) {
    const game = this.game;
    const o = this.other;
    if (!o) return;
    o.there = true;
    const seat = CELLAR.otherOffice.spawn;
    try {
      g.teleport(W(seat.x, seat.y, seat.z), { rotation: { x: 0, y: seat.yaw ?? OFFICE.spawn.yaw } });
    } catch (e) {
      log.warn(`other office: ${e?.message ?? e}`);
    }
    // the night's fog ends at 40 blocks, and he is 45 away: down here the air is clear and the dark does the work
    runCmd(FOG.nightPop);
    runCmd(FOG.latePop);
    game.puppets.spawn(ID, CELLAR.stage, 'stand');
    game.puppets.eyes(ID, true);
    game.puppets.hollow(ID, true);
    // light: a little on the desk (the phone must be found), and the light that goes with him
    const d = CELLAR.otherOffice.offset;
    this.light(OFFICE.monitor.x + d.x, OFFICE.monitor.y + d.y + 2, OFFICE.monitor.z + d.z + 2, DESK_LIGHT);
    this.followLight();
    game.audio.loop('cellar', 'fnar.golden.cellar', null, g, 0.7);
    try {
      g.onScreenDisplay.setTitle(TEXT.other.card[0], { fadeInDuration: 20, stayDuration: 50, fadeOutDuration: 20, subtitle: TEXT.other.card[1] });
    } catch {
      // ignore
    }
  }

  /** A light block of his, only into air; remembered so it can be taken away again. */
  light(x, y, z, key) {
    if (typeAtLocal(x, y, z) !== 'minecraft:air') return null;
    if (!setLocal(x, y, z, key)) return null;
    const cell = [x, y, z];
    this.lights.push(cell);
    return cell;
  }

  unlight(cell) {
    if (!cell) return;
    const [x, y, z] = cell;
    if (typeAtLocal(x, y, z)?.startsWith('minecraft:light_block')) setLocal(x, y, z, 'air');
    this.lights = this.lights.filter((c) => c !== cell);
  }

  /** The light that walks with him: one cell over his head, moved as he moves. */
  followLight() {
    const p = this.hisSpot();
    const cell = [Math.floor(p.x), Math.floor(p.y) + 3, Math.floor(p.z)];
    const f = this.follow;
    if (f && f[0] === cell[0] && f[1] === cell[1] && f[2] === cell[2]) return;
    this.unlight(f);
    this.follow = this.light(cell[0], cell[1], cell[2], HIS_LIGHT);
  }

  phone(e, g, now) {
    const o = this.other;
    if (!o) return;
    const ph = CELLAR.otherOffice.phone;
    if (e.ring) {
      o.ringing = true;
      o.ringAt = now;
      setStateLocal(ph.x, ph.y, ph.z, 'fnar:ringing', true);
      this.cap(TEXT.caption.phone, 100);
    } else if (e.late) {
      // nobody picked up: the ringing stops, and he stops waiting
      o.ringing = false;
      setStateLocal(ph.x, ph.y, ph.z, 'fnar:ringing', false);
      this.cap(TEXT.caption.late, 100);
    }
  }

  /** The desk phone was clicked. In the Other Office it is the way back. @returns {boolean} handled */
  onPhone(player) {
    const s = this.session;
    if (!s || !s.golden.away) return false;
    const res = s.input('answer');
    if (!res.ok) this.game.hud.setMessage(TEXT.message.quiet, system.currentTick, 50);
    return true;
  }

  /** The guard is kept in the Other Office while they sit there. @returns {boolean} handled */
  keep(g) {
    if (!this.away) return false;
    const l = L(g.location);
    const b = CELLAR.otherOffice.bounds;
    const seat = CELLAR.otherOffice.spawn;
    if (l.x >= b.x1 && l.x < b.x2 && l.z >= b.z1 && l.z < b.z2 && l.y > seat.y - 1 && l.y < seat.y + 4) return true;
    try {
      g.teleport(W(seat.x, seat.y, seat.z), { rotation: g.getRotation() });
      this.game.hud.setMessage(TEXT.message.stay, system.currentTick, 60);
    } catch {
      // ignore
    }
    return true;
  }

  /** The Other Office lets go of the guard: back in the real seat, the lamp their own again. */
  leave(how, g, now) {
    const game = this.game;
    const s = game.session;
    const o = this.other;
    this.other = null;
    const ph = CELLAR.otherOffice.phone;
    setStateLocal(ph.x, ph.y, ph.z, 'fnar:ringing', false);
    for (const cell of [...this.lights]) this.unlight(cell);
    this.follow = null;
    game.audio.stop('cellar');
    if (o?.there) {
      const seat = OFFICE.spawn;
      try {
        g.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0, holdTime: 0.5, fadeOutTime: 0.8 } });
        g.teleport(W(seat.x, seat.y, seat.z), { rotation: { x: 0, y: seat.yaw } });
      } catch (e) {
        log.warn(`back from the other office: ${e?.message ?? e}`);
      }
      // the night's own fog again (and the late one on top of it, if it has come)
      runCmd(FOG.nightPop);
      runCmd(FOG.latePop);
      if (!s?.powerOut) {
        runCmd(FOG.nightPush);
        if (game.nightset?.late) runCmd(FOG.latePush);
      }
      this.tellOps(TEXT.operator.back);
    }
    this.tear(g, 0.8, 1.1);
    this.lamp(!s?.powerOut);
    if (how === 'answered') {
      // the voice on the line is the Ringmaster's, from very far away
      game.audio.play('fnar.phone.pickup', OFFICE.phone, g, { vol: 0.9 });
      game.audio.play('fnar.phone.voice', null, g, { vol: 0.5, pitch: 0.85 });
      game.hud.setSpeech(`§5☎ §dThe Ringmaster§7: §f${fill(game.rng.pick(TEXT.other.line), { name: g.name })}`, now, 90);
      this.cap(TEXT.caption.answered, 70);
    }
  }

  // ================================================================ the night: every tick
  /**
   * @param {import('@minecraft/server').Player} g the guard
   * @param {number} now
   */
  tick(g, now) {
    const game = this.game;
    const s = game.session;
    if (!s) return;
    const gd = s.golden;
    // the silence while the cast is held
    if (gd.holding !== this.hush) this.setHush(gd.holding, g, now);
    if (this.hush && game.phoneSeq) game.phoneSeq.next = Math.max(game.phoneSeq.next, now + 2); // nobody talks while the watch runs
    // where the guard's eyes are: the session's one question
    let look = false;
    if (gd.state === 'visit') look = !game.cams.active && looksAt(g, NODES[CELLAR.visit], LOOK_CONE.visit);
    else if (gd.away) look = looksAt(g, this.hisSpot(), LOOK_CONE.other);
    s.look(look);
    // the visit: one breath after another, right behind the seat (he holds it while he is looked at)
    const v = this.visit;
    if (v && gd.state === 'visit' && !gd.shift.seen && now >= v.breathAt) {
      const n = NODES[CELLAR.visit];
      v.breathAt = now + BREATH_TICKS;
      this.playHeld(g, 'fnar.golden.breath', { at: { x: n.x, y: n.y + 2.4, z: n.z }, vol: 1 });
    }
    // the Other Office: he is where the session has him, his light with him; the phone rings; his steps
    const o = this.other;
    if (o?.there && gd.state === 'other') {
      const p = this.hisSpot();
      if (o.walking) {
        game.puppets.teleport(ID, p, NODES[CELLAR.stage].yaw);
        this.followLight();
        if (now >= o.stepAt) {
          o.stepAt = now + STEP_EVERY;
          game.audio.play('fnar.golden.step', { x: p.x, y: p.y + 0.5, z: p.z }, g, { vol: 1 });
        }
      }
      if (o.ringing && now >= o.ringAt) {
        o.ringAt = now + RING_EVERY;
        const ph = CELLAR.otherOffice.phone;
        game.audio.play('fnar.golden.phone', { x: ph.x + 0.5, y: ph.y + 0.5, z: ph.z + 0.5 }, g, { vol: 1 });
      }
    }
  }

  /**
   * The cast is held (or let go): the puppets stop where they are, the building's own sounds go out, and the
   * Ringmaster stops talking. Only the watch (and the guard's own gear) is heard.
   */
  setHush(on, g, now) {
    const game = this.game;
    const s = game.session;
    this.hush = on;
    game.puppets.frozen = on;
    if (on) {
      this.saved = [];
      for (const [key, l] of game.audio.loops) {
        if (KEEP_LOOPS.test(key)) continue;
        this.saved.push([key, { id: l.id, where: l.where, vol: l.vol, player: l.player, pitch: l.pitch }]);
      }
      for (const [key] of this.saved) game.audio.stop(key);
      this.bgmWasOn = !!game.bgmPlaying;
      if (this.bgmWasOn) game.stopBgm(g);
      return;
    }
    // let go: the building breathes again (unless the power went, or the night is over)
    const saved = this.saved;
    this.saved = [];
    if (!s || s.powerOut || s.result || game.state !== 'NIGHT') return;
    for (const [key, l] of saved) if (!game.audio.loops.has(key)) game.audio.loop(key, l.id, l.where, l.player, l.vol, l.pitch);
    if (this.bgmWasOn) game.startBgm(g);
    // the Ringmaster finds his voice again
    const ph = game.phoneSeq;
    if (this.interrupted && !this.saidInterrupted && ph && ph.i >= 0 && ph.i < ph.lines.length) {
      this.saidInterrupted = true;
      const lines = s.night >= 4 ? TEXT.interrupted.admit : TEXT.interrupted.deny;
      ph.lines.splice(ph.i, 0, game.rng.pick(lines));
      ph.next = now + 30;
    }
    this.interrupted = false;
  }

  /** The status line's part about him (the Radar cheat). */
  radar() {
    const gd = this.session?.golden;
    if (!gd?.present) return null;
    return `Golden §f${gd.state === 'stage' ? `CAM ${CELLAR.cam}` : gd.state === 'tell' ? 'tick...' : gd.state}`;
  }

  /** A night ended, however it did: everything he bent is put back. */
  stop() {
    this.cut();
    this.ungild();
    for (const cell of [...this.lights]) this.unlight(cell);
    if (this.other) {
      const ph = CELLAR.otherOffice.phone;
      setStateLocal(ph.x, ph.y, ph.z, 'fnar:ringing', false);
    }
    this.game.puppets.frozen = false;
    this.reset();
  }

  // ================================================================ Free Roam
  /** By day he stands on his stage in the Gold Room. He does not talk. */
  roamStart() {
    const pup = this.game.puppets;
    pup.spawn(ID, CELLAR.stage, 'stand');
    pup.eyes(ID, false);
    pup.hollow(ID, false);
    this.roam = { look: 0, unseen: 0, changed: false, say: Object.create(null), air: new Set() };
    /** @type {{ x: number, y: number, z: number } | null} where he stands right now, if not on his mark */
    this.roamSpot = null;
  }

  roamStop() {
    this.roam = null;
    this.roamSpot = null;
  }

  /** @param {number} now */
  roamTick(now) {
    const r = this.roam;
    if (!r || now % 4 !== 0) return;
    const game = this.game;
    const pup = game.puppets;
    const n = NODES[CELLAR.stage];
    if (!n || !pup.get(ID)) return;
    const feet = this.roamSpot ?? { x: n.x, y: n.y, z: n.z };
    /** @type {{ p: any, d: number, looks: boolean }[]} */
    const near = [];
    for (const p of game.players()) {
      let l;
      try {
        l = L(p.location);
      } catch {
        continue;
      }
      // the cellar has its own air, for whoever is down there
      const below = l.y < CELLAR.ceilY;
      const key = `cellar_${p.id}`;
      if (below && !r.air.has(p.id)) {
        r.air.add(p.id);
        game.audio.loop(key, 'fnar.golden.cellar', null, p, 0.8);
        this.cap(TEXT.caption.cellar, 60);
      } else if (!below && r.air.has(p.id)) {
        r.air.delete(p.id);
        game.audio.stop(key);
      }
      const d = Math.hypot(l.x - feet.x, l.y - feet.y, l.z - feet.z);
      if (below && d < 44) near.push({ p, d, looks: looksAt(p, feet, LOOK_CONE.roam) });
    }
    const watchers = near.filter((q) => q.looks).sort((a, b) => a.d - b.d);
    if (watchers.length) {
      const w = watchers[0];
      if (r.changed) {
        // somebody looked back: he is not quite as he was
        r.changed = false;
        if (w.d < 30 && game.rng.chance(0.6)) game.roamSay(w.p, game.rng.pick(TEXT.moved), 60);
      }
      r.unseen = 0;
      // his head follows whoever looks at him
      try {
        pup.lookAt(ID, w.p.getHeadLocation());
      } catch {
        // ignore
      }
      // he does not talk
      if (w.d < 6 && now >= (r.say[w.p.id] ?? 0)) {
        r.say[w.p.id] = now + 400;
        game.roamSay(w.p, game.rng.pick(TEXT.silent), 70);
      }
      return;
    }
    if (!near.length) return;
    r.unseen += 4;
    if (r.unseen >= 40 && !r.changed) {
      r.changed = true;
      this.roamChange(near[0].p);
    }
  }

  /** Nobody is looking: he stands a little differently (never the same twice in a row). */
  roamChange(p) {
    const r = this.roam;
    const game = this.game;
    const pup = game.puppets;
    const n = NODES[CELLAR.stage];
    let i = game.rng.int(0, ROAM_LOOKS.length - 1);
    if (i === r.look) i = (i + 1) % ROAM_LOOKS.length;
    r.look = i;
    const v = ROAM_LOOKS[i];
    const yaw = n.yaw + (v.yaw ?? 0);
    const rad = (n.yaw * Math.PI) / 180;
    const step = v.step ?? 0;
    this.roamSpot = { x: n.x - Math.sin(rad) * step, y: n.y, z: n.z + Math.cos(rad) * step };
    pup.teleport(ID, this.roamSpot, yaw);
    pup.anim(ID, v.anim);
    pup.eyes(ID, !!v.eyes);
    pup.look(ID, 0, 0);
    // a servo, behind whoever just looked away
    game.audio.play('fnar.servo.head', { x: this.roamSpot.x, y: n.y + GOLDEN_BODY.eyeY, z: this.roamSpot.z }, p, { vol: 0.5, pitch: 0.7 });
  }
}
