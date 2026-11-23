// The Golden Dog. He was here before the Revue: the mascot of the supper club the pizzeria was built on top
// of, still standing on his little stage in the cellar (docs/GOLDEN_DOG.md, data/cellar.js). He never comes
// up the stairs and he never walks the halls. He bends the place instead: what the clock says, what the
// cameras show, which hand is which, and in the end where the office is.
//
// One rule holds for everything he does, and the guard can learn it: NEVER LOOK AT THE GOLDEN DOG.
//
//   the tell     a pocket watch, ticking faster and faster for `tell` ticks before every shift. Nothing else
//                in the building ticks.
//   the hold     from the first tick of the watch the rest of the cast holds still (they are afraid of him
//                too): the session stops their clock, so nothing else moves on the guard while the watch
//                runs, nor during the shifts that take the guard's eyes (gilding, the false dawn, the visit,
//                the Other Office). The night's own clock keeps running, so a visit and the Other Office
//                cost a little power instead. The mirror and the wrong feed are about the guard's own
//                controls: for those the building moves again as soon as the watch stops.
//   CAM 11       shows him on his stage: slumped while his level is 0, head up at a low level, standing from
//                `standAt`. Watching CAM 11 is looking at him: after `stare.after` ticks at a time he turns to
//                the lens and his next shift comes sooner. An empty stage means he is at work.
//
// The shifts, mildest first (each needs a level: config.js `golden.unlock`):
//   gild     cosmetic: for a few seconds a poster, a drawing or a hall floor is his. No answer needed.
//   dawn     the clock jumps to 6 AM, the chime plays off-key, the 6 AM card starts and tears away: it is
//            still night. Nothing was real: the watch ticked first, and the real 6 AM never ticks.
//   feed     every camera the guard picks shows the cellar's empty stage. Lower the monitor (that ends it);
//            `feed.picks` cameras picked in a row bring him up: a visit, at once.
//   mirror   left is right: the left buttons work the right door, light and vent, and the other way round.
//            Use the other hand, or wait it out.
//   visit    he stands in the office behind the seat, breathing. Do not turn around, do not raise the monitor
//            (it shows only his face). Looked at for more than `visit.look` ticks in all, he takes the guard.
//   other    once a night: the lamp stutters and the guard sits in the Other Office, in the cellar. He is on
//            his stage at the far end of the hall and walks while he is watched. The phone rings: picking it
//            up is the way back. Watched all the way to the desk, he takes the guard; left ringing too long,
//            he comes anyway.
//
// Never two shifts at once, and no tell during a jumpscare, a blackout, the Rusted one's moment or the
// Ringmaster's "Places!", while somebody stands at an open door or vent, is stepping in or is about to
// (a bait in the air, a racket in the kitchen), or within `quiet` ticks of anybody's arrival at the office.
// Off on the training night and in the Final Act. The week's memory does not track him.
//
// "Looking at him" is not the core's business: the game layer decides it from the guard's view direction and
// hands it over as a boolean every tick (NightSession.look); the sim's bots model it.
//
// He draws from a random stream of his own, so with his level at 0 the night is the same night for the
// others, effect for effect. Effects (all `fx: 'golden'`):
//   { kind: 'place', node, pose }             night start, and after every shift: back on his stage
//   { kind: 'tell', shift, dur }              the watch (his stage is empty from now on)
//   { kind: 'shift', shift, dur, ... }        the shift begins (gild: `where`; visit: `from`; other: `fade`, `phone`)
//   { kind: 'pick', n, of }                   the wrong feed: another camera picked
//   { kind: 'seen', on, left }                the visit: the guard looks at him / looks away again
//   { kind: 'arrive' }                        the Other Office: the fade is over, the guard sits there
//   { kind: 'phone', ring | late }            the Other Office: the phone starts to ring / he stops waiting
//   { kind: 'walk', on }  { kind: 'step', node }   the Other Office: he walks / stops; he passes a spot
//   { kind: 'end', shift, how }               the shift is over ('time', 'lowered', 'picked', 'answered', 'power')
//   { kind: 'stare', on }                     CAM 11: he turns to the lens / lets go of it
// Pure (no @minecraft imports).

import { CONFIG, GOLDEN } from '../config.js';
import { Rng } from '../rng.js';
import { NODES } from '../../data/nodes.js';
import { CELLAR } from '../../data/cellar.js';
import { SLOTS } from './director.js';

export const SHIFTS = Object.freeze(['gild', 'dawn', 'feed', 'mirror', 'visit', 'other']);
/** The shifts he picks from by weight (the Other Office has its own hour). */
const COMMON = Object.freeze(['gild', 'dawn', 'feed', 'mirror', 'visit']);
const MIRRORED = Object.freeze({ door_l: 'door_r', door_r: 'door_l', light_l: 'light_r', light_r: 'light_l', vent_l: 'vent_r', vent_r: 'vent_l' });
/** States of the others that mean a way into the office is being used right now. */
const STEPPING = new Set(['entering', 'inside', 'run']);

/** The line he walks from his stage to the Other Office's desk: points and running lengths. */
const WALK = (() => {
  const pts = CELLAR.walk.map((id) => NODES[id]).filter(Boolean).map((n) => [n.x, n.y, n.z]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  return Object.freeze({ nodes: CELLAR.walk, pts, cum, len: cum[cum.length - 1] ?? 0 });
})();

/** The point `dist` blocks along his walk (clamped to its ends). */
export function walkPoint(dist) {
  const { pts, cum } = WALK;
  if (!pts.length) return [0, 0, 0];
  const d = Math.max(0, Math.min(WALK.len, dist));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1];
  const b = pts[i] ?? a;
  const seg = (cum[i] ?? 0) - cum[i - 1] || 1;
  const f = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export const WALK_LENGTH = WALK.len;

export class GoldenDog {
  /**
   * @param {import('../session.js').NightSession} s
   * @param {number} seed the night's seed (his stream is derived from it, apart from the night's own)
   */
  constructor(s, seed) {
    this.s = s;
    this.id = GOLDEN;
    this.cfg = CONFIG.golden;
    this.rng = new Rng(((seed >>> 0) ^ 0x60d0d06) >>> 0);
    /** 0..20, like the others' AI: how often he acts and which shifts he knows */
    this.level = Math.max(0, Math.min(20, Math.round(s.def.ai?.[GOLDEN] ?? 0)));
    /** he stands on his stage (CAM 11 shows him) on every night but the training night and the Final Act */
    this.present = !s.final && s.night !== 0;
    /** ...and at a level above 0 he acts */
    this.enabled = this.present && this.level > 0;
    /** 'stage' (on his stage, waiting) | 'tell' (the watch) | one of SHIFTS */
    this.state = 'stage';
    /** @type {{ kind: string, until: number } | null} */
    this.tell = null;
    /** @type {any} the shift in progress */
    this.shift = null;
    /** shifts he does once a night */
    this.done = { dawn: false, other: false };
    this.last = null;
    this.lastEnd = 0;
    /** provoked on CAM 11: his next shift is one of the worse ones */
    this.angry = false;
    this.stared = 0;
    this.unseen = 0;
    this.turned = false;
    /** tick (the cast's clock) of the last arrival at a door, a vent or the nook */
    this.arrivalAt = -1e9;
    /** @type {Record<string, string | null>} slot -> who worked it at the last look */
    this.heldBy = { L: null, R: null, VL: null, VR: null };
    /** how many of each shift tonight (for the tools) */
    this.count = { tell: 0, gild: 0, dawn: 0, feed: 0, mirror: 0, visit: 0, other: 0, stare: 0 };
    const c = this.cfg;
    const [lo, hi] = c.gap(this.level);
    /** @type {number} tick (the night's clock, NightSession.now) of his next tell */
    this.nextAt = this.enabled ? Math.round(lo * c.first) + this.rng.int(0, hi - lo) : Infinity;
    /** @type {number} tick from which the Other Office is due (once a night, at a level that knows it) */
    this.otherAt = this.enabled && this.knows('other') ? Math.round(s.ticksPerHour * (c.other.hours[0] + this.rng.next() * (c.other.hours[1] - c.other.hours[0]))) : Infinity;
  }

  // ------------------------------------------------------------ what the session asks
  /** While this is true the session holds the rest of the cast still (their clock stops). */
  get holding() {
    return this.state === 'tell' || !!this.cfg.hold[this.state];
  }

  /** At work: the watch is ticking or a shift is on (his stage is empty). */
  get busy() {
    return this.state !== 'stage';
  }

  /** The wrong feed is on: whatever camera is picked, the guard sees the cellar. */
  get blind() {
    return this.state === 'feed';
  }

  /** The false dawn is on: the clock says 6 AM. */
  get dawn() {
    return this.state === 'dawn';
  }

  /** The guard sits in the Other Office (after the fade): nothing of the real office answers. */
  get away() {
    return this.state === 'other' && !!this.shift?.there;
  }

  /** How he stands on his stage tonight. */
  get pose() {
    return this.level >= this.cfg.standAt ? 'stand' : this.level >= this.cfg.wakeAt ? 'wake' : 'slump';
  }

  /** Power per tick while he is in the room with the guard ("the lights dim"). */
  drain() {
    if (this.state === 'visit') return this.cfg.visit.cost;
    if (this.away) return this.cfg.other.cost;
    return 0;
  }

  /** The mirror: the left controls work the right side and the other way round. */
  remap(action) {
    return this.state === 'mirror' ? MIRRORED[action] ?? action : action;
  }

  /** The night starts: he is on his stage. */
  begin() {
    if (!this.present) return;
    this.s.emit({ fx: 'golden', kind: 'place', node: CELLAR.stage, pose: this.pose });
  }

  /** The guard picked another camera (the wrong feed counts them). */
  onPick() {
    if (this.state !== 'feed') return;
    const sh = this.shift;
    const c = this.cfg.feed;
    sh.picks++;
    this.s.emit({ fx: 'golden', kind: 'pick', n: sh.picks, of: c.picks });
    if (sh.picks >= c.picks) {
      // three in a row: he comes up
      this.finish('picked', false);
      this.start('visit', 'feed');
    }
  }

  /** The monitor went up or down. */
  onCams(open) {
    if (this.state !== 'feed') return;
    if (open) this.shift.seen = true;
    else if (this.shift.seen) this.finish('lowered'); // the answer: lower the monitor
  }

  /** The phone in the Other Office: the way back. */
  answer() {
    if (this.state !== 'other' || !this.shift.there) return { ok: false, reason: 'unknown' };
    if (!this.shift.ringing) return { ok: false, reason: 'quiet' };
    this.finish('answered');
    return { ok: true };
  }

  /** The power went out (or the night was cut short): whatever he was doing, he lets go. */
  abort(how = 'power') {
    if (this.state === 'stage') return;
    if (this.state === 'tell') {
      const kind = this.tell.kind;
      this.tell = null;
      this.state = kind;
      this.shift = { kind };
    }
    this.finish(how);
  }

  // ------------------------------------------------------------ the tick
  /** Once per session tick, after the cast (also while he holds them still). */
  tick() {
    if (!this.present) return;
    const s = this.s;
    this.scan();
    if (this.state === 'stage') {
      this.tickStare();
      if (!this.enabled || s.now < this.nextAt) return;
      const kind = this.choose();
      if (!kind) {
        this.nextAt = s.now + this.cfg.retry;
        return;
      }
      this.startTell(kind);
      return;
    }
    if (this.state === 'tell') {
      if (s.now >= this.tell.until) {
        const kind = this.tell.kind;
        this.tell = null;
        this.start(kind);
      }
      return;
    }
    this.tickShift();
  }

  /** Who works which way into the office: a new one is an arrival the guard must answer. */
  scan() {
    const s = this.s;
    const cast = Object.values(s.chars);
    for (const k of SLOTS) {
      const who = cast.find((c) => c.holds(k))?.id ?? null;
      if (who && who !== this.heldBy[k]) this.arrivalAt = s.t;
      this.heldBy[k] = who;
    }
    for (const c of cast) if (STEPPING.has(c.state)) this.arrivalAt = s.t;
  }

  /** Is CAM 11 on him right now (he is on his stage, and the feed is a real one)? */
  watched() {
    const s = this.s;
    const c = s.devices.cams;
    return this.state === 'stage' && c.open && c.cam === CELLAR.cam && !s.powerOut && s.camWorking(c.cam);
  }

  /** Watching CAM 11 is looking at him: a few seconds are safe, a stare is not. */
  tickStare() {
    const s = this.s;
    const c = this.cfg.stare;
    if (this.watched()) {
      this.stared++;
      this.unseen = 0;
      if (this.turned || this.stared < c.after) return;
      this.turned = true;
      this.count.stare++;
      s.emit({ fx: 'golden', kind: 'stare', on: true });
      if (!this.enabled) return;
      // he noticed: the next shift comes sooner (never right on top of the last one), and it is a worse one
      this.angry = true;
      const soon = s.now + this.rng.int(c.sooner[0], c.sooner[1]);
      const rest = this.lastEnd + Math.round(this.cfg.gap(this.level)[0] * c.rest);
      this.nextAt = Math.max(rest, Math.min(this.nextAt, soon));
      return;
    }
    if (this.stared > 0 && ++this.unseen >= c.forget) {
      this.stared = 0;
      this.unseen = 0;
      if (this.turned) {
        this.turned = false;
        s.emit({ fx: 'golden', kind: 'stare', on: false });
      }
    }
  }

  knows(kind) {
    return this.level >= (this.cfg.unlock[kind] ?? 99);
  }

  /** May the watch start ticking now? (See the header: never on top of something the guard must answer.) */
  maySpeak() {
    const s = this.s;
    const c = this.cfg;
    if (s.result || s.powerOut || s.rusted) return false;
    if (s.now > s.hours * s.ticksPerHour - c.endMargin) return false;
    if (s.chars.top_hat_rat?.places) return false; // the Ringmaster's "Places!"
    if (s.t < s.director.clatterUntil) return false; // a racket in the kitchen: somebody is stepping up
    if (s.t - this.arrivalAt < c.quiet) return false;
    for (const ch of Object.values(s.chars)) {
      if (ch.inside || STEPPING.has(ch.state) || ch.bait) return false;
      if (ch.id === 'top_hat_rat' && ch.enabled && ch.state === 'door') return false;
    }
    // somebody stands at a door or vent the guard has not shut yet
    for (const k of SLOTS) {
      if (!this.heldBy[k]) continue;
      const shut = k === 'L' || k === 'R' ? s.doorClosed(k) : s.ventClosed(k.slice(1));
      if (!shut) return false;
    }
    return true;
  }

  /** The Other Office is due: once a night, in its hours, with the power to pay for it. */
  otherDue() {
    const s = this.s;
    const c = this.cfg;
    return !this.done.other && s.now >= this.otherAt && s.power >= c.minPower && s.now <= s.hours * s.ticksPerHour - c.other.endMargin;
  }

  /** The next shift, or null when this is no moment for one. */
  choose() {
    const s = this.s;
    const c = this.cfg;
    if (!this.maySpeak()) return null;
    if (this.otherDue()) return 'other';
    const pool = [];
    for (const kind of COMMON) {
      if (!this.knows(kind)) continue;
      let w = c.weight[kind] ?? 1;
      if (kind === 'gild' && this.level >= c.gildAt) w *= 0.25;
      if (kind === 'dawn') {
        if (this.done.dawn || s.hours !== CONFIG.clock.hours || s.hour < c.dawn.fromHour) continue;
        if (s.hour >= 4) w *= 2; // the nearer the real 6 AM, the better the lie
      }
      if (kind === 'feed') w *= s.devices.cams.open ? 2 : 0.4;
      if (kind === 'visit' && s.power < c.minPower) continue;
      if (kind === this.last) w *= 0.3;
      if (this.angry) w *= kind === 'visit' ? 3 : kind === 'gild' ? 0.2 : 1;
      pool.push([kind, w]);
    }
    return pool.length ? this.rng.weighted(pool) : null;
  }

  startTell(kind) {
    const s = this.s;
    const wasWatched = this.watched();
    this.state = 'tell';
    this.tell = { kind, until: s.now + this.cfg.tell };
    this.count.tell++;
    this.stared = 0;
    this.unseen = 0;
    this.turned = false;
    // CAM 11: the feed tears and his stage is empty
    if (wasWatched) s.staticOn([CELLAR.cam], 14);
    s.emit({ fx: 'golden', kind: 'tell', shift: kind, dur: this.cfg.tell });
  }

  /** A shift begins (after its tell; a visit brought on by the wrong feed starts at once). */
  start(kind, from = null) {
    const s = this.s;
    const c = this.cfg[kind];
    const now = s.now;
    this.state = kind;
    this.count[kind]++;
    switch (kind) {
      case 'gild':
        this.shift = { kind, until: now + c.lasts };
        // what the guard is looking at changes: the office from the seat, or a hall on a camera
        s.emit({ fx: 'golden', kind: 'shift', shift: kind, dur: c.lasts, where: s.devices.cams.open ? 'hall' : 'office' });
        return;
      case 'dawn':
        this.done.dawn = true;
        this.shift = { kind, until: now + c.lasts };
        s.closeCams('golden'); // as at the real 6 AM
        s.emit({ fx: 'golden', kind: 'shift', shift: kind, dur: c.lasts });
        return;
      case 'feed':
        this.shift = { kind, until: now + c.lasts, picks: 0, seen: s.devices.cams.open };
        s.emit({ fx: 'golden', kind: 'shift', shift: kind, dur: c.lasts, cam: CELLAR.cam });
        return;
      case 'mirror':
        this.shift = { kind, until: now + c.lasts };
        s.emit({ fx: 'golden', kind: 'shift', shift: kind, dur: c.lasts });
        return;
      case 'visit':
        this.shift = { kind, until: now + c.lasts, looked: 0, seen: false };
        // the monitor drops: from here on raising it is looking at him
        s.closeCams('golden');
        s.emit({ fx: 'golden', kind: 'shift', shift: kind, dur: c.lasts, node: CELLAR.visit, from: from ?? undefined });
        return;
      case 'other':
        this.done.other = true;
        this.shift = { kind, startAt: now + c.fade, phoneAt: now + c.fade + c.phone, lateAt: now + c.fade + c.phone + c.patience, there: false, ringing: false, late: false, walking: false, dist: 0, idx: 0 };
        s.closeCams('golden');
        s.emit({ fx: 'golden', kind: 'shift', shift: kind, fade: c.fade, phone: c.phone });
        return;
      default:
        this.finish('time');
    }
  }

  tickShift() {
    const s = this.s;
    const sh = this.shift;
    const now = s.now;
    switch (this.state) {
      case 'visit': {
        const c = this.cfg.visit;
        // looking at him: turning round to him, or raising the monitor (it shows only his face)
        const look = s.looking || s.devices.cams.open;
        if (look) {
          sh.looked++;
          if (!sh.seen) {
            sh.seen = true;
            s.emit({ fx: 'golden', kind: 'seen', on: true, left: Math.max(0, c.look - sh.looked) });
          }
          if (sh.looked > c.look) return this.take('visit');
        } else if (sh.seen) {
          sh.seen = false;
          s.emit({ fx: 'golden', kind: 'seen', on: false, left: Math.max(0, c.look - sh.looked) });
        }
        if (now >= sh.until) this.finish('time');
        return;
      }
      case 'other': {
        const c = this.cfg.other;
        if (now < sh.startAt) return; // the lamp stutters, the fade
        if (!sh.there) {
          sh.there = true;
          s.emit({ fx: 'golden', kind: 'arrive' });
        }
        if (!sh.ringing && now >= sh.phoneAt) {
          sh.ringing = true;
          s.emit({ fx: 'golden', kind: 'phone', ring: true });
        }
        if (!sh.late && now >= sh.lateAt) {
          sh.late = true;
          s.emit({ fx: 'golden', kind: 'phone', late: true });
        }
        // he walks while he is watched (and once he has waited long enough, whether he is or not)
        const moving = s.looking || sh.late;
        if (moving !== sh.walking) {
          sh.walking = moving;
          s.emit({ fx: 'golden', kind: 'walk', on: moving });
        }
        if (!moving) return;
        sh.dist += c.speed;
        while (sh.idx + 1 < WALK.cum.length && sh.dist >= WALK.cum[sh.idx + 1]) {
          sh.idx++;
          s.emit({ fx: 'golden', kind: 'step', node: WALK.nodes[sh.idx], n: sh.idx, of: WALK.nodes.length - 1 });
        }
        if (sh.dist >= WALK.len) this.take('other');
        return;
      }
      default:
        // gilding, the false dawn, the wrong feed, the mirror: they pass
        if (now >= sh.until) this.finish('time');
    }
  }

  /** He takes the guard: the visit looked at too long, or watched all the way to the desk. */
  take(way) {
    const s = this.s;
    s.breaches[GOLDEN] = { side: way, note: `golden_${way}` };
    s.kill(GOLDEN);
  }

  /** The shift is over: he is back on his stage, and the next tell is a while off. */
  finish(how, back = true) {
    const s = this.s;
    const kind = this.state;
    const [lo, hi] = this.cfg.gap(this.level);
    this.state = 'stage';
    this.shift = null;
    this.tell = null;
    this.last = kind;
    this.lastEnd = s.now;
    this.angry = false;
    this.stared = 0;
    this.unseen = 0;
    this.turned = false;
    this.nextAt = s.now + this.rng.int(lo, hi);
    s.emit({ fx: 'golden', kind: 'end', shift: kind, how });
    if (back && !s.result) s.emit({ fx: 'golden', kind: 'place', node: CELLAR.stage, pose: this.pose });
  }

  // ------------------------------------------------------------ views
  /** Where he stands in the Other Office right now ([x, y, z], local), or null. */
  pos() {
    return this.state === 'other' ? walkPoint(this.shift.dist) : null;
  }

  /** For the snapshot (the HUD and the game layer). */
  view() {
    const s = this.s;
    const sh = this.shift;
    const left = (until) => Math.max(0, Math.ceil((until - s.now) / 20));
    return {
      level: this.level,
      state: this.state,
      hold: this.holding,
      onStage: this.state === 'stage',
      pose: this.pose,
      turned: this.turned,
      mirror: this.state === 'mirror',
      feed: this.state === 'feed',
      picks: this.state === 'feed' ? sh.picks : 0,
      dawn: this.state === 'dawn',
      visit: this.state === 'visit',
      seen: this.state === 'visit' && sh.seen,
      away: this.away,
      ringing: this.state === 'other' && sh.ringing,
      walking: this.state === 'other' && sh.walking,
      left: sh?.until ? left(sh.until) : this.tell ? left(this.tell.until) : 0,
    };
  }

  debug() {
    const s = this.s;
    const sh = this.shift;
    let what = this.state;
    if (this.state === 'stage') what = this.enabled ? `stage ${this.nextAt === Infinity ? '-' : Math.max(0, this.nextAt - s.now)}${this.angry ? '!' : ''}` : 'stage';
    else if (this.state === 'tell') what = `tell>${this.tell.kind}`;
    else if (this.state === 'visit') what = `visit looked ${sh.looked}`;
    else if (this.state === 'feed') what = `feed picks ${sh.picks}`;
    else if (this.state === 'other') what = `other ${sh.dist.toFixed(1)}/${WALK.len.toFixed(1)}${sh.ringing ? ' ring' : ''}`;
    return `golden:${this.level} ${what}`;
  }
}
