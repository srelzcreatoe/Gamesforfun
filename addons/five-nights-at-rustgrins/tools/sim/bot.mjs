// The sim's bot guard (shared by sim.mjs and ai_checks.mjs).
//
// The bot only acts on what a player could perceive: the hall light shows the
// door nodes, a working camera shows the nodes it sees, and audio tells (the Cat's
// run, maracas at a vent, the guitar at the left door, humming at the right window,
// footsteps and soft cues near the office). `earP` is the chance a cue is noticed;
// it has reaction delays and a cyclic routine.
//
// The cast's tricks are answered the way a player who has read the Shift Guide would: a
// knock on the wall is looked at twice, a hum that is too clean sends it to the OTHER hall,
// a racket in the kitchen or the Ringmaster's "places!" means a look down both halls, a
// squealing feed is looked away from, a warbling tape is rewound. `wiseP` is the chance it
// sees through a trick it heard (otherwise it takes the bait, like a player who has not
// learnt it yet). Sounds carry the side they come from (`door`), never who it is. After a
// 'grudge' cue (the one who got in last time comes back the same way) it listens for that way.
//
// The Golden Dog (core/ai/golden_dog.js) is played the same way, on the night's own clock (`s.now`:
// the bot's hands and eyes are not held still with the cast). The bot hands the session the one thing
// the game layer does: whether the guard is looking at him (`s.look`). A good guard looks away after
// the tell and never looks back; an average one is sometimes slow:
//   the wrong feed   seen for what it is after a moment: monitor down, and no camera work till it is
//                    over. Until then the sweep goes on picking cameras (three bring him up).
//   the mirror       the other hand for every control once it has noticed (`mirrorP`: whether it does
//                    at all); what a hall light shows is only seen in the hall that is really lit.
//   the visit        eyes forward. With `lookP` it turns round to look, for a moment that may be too long.
//   the Other Office it sits facing him: it looks at him until it thinks to look down at the desk, and
//                    picks up the phone a moment after it starts to ring.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { CAMERA_BY_ID } = await import(path.join(ROOT, 'packs/BP/scripts/data/cameras.js'));
const MIRROR = Object.freeze({ door_l: 'door_r', door_r: 'door_l', light_l: 'light_r', light_r: 'light_l', vent_l: 'vent_r', vent_r: 'vent_l' });

export class Bot {
  constructor(s, kind, seed) {
    this.s = s;
    this.kind = kind;
    this.r = seed >>> 0 || 1;
    this.queue = []; // [tick, action, arg]
    this.busyUntil = 0;
    this.phase = 0;
    this.phaseUntil = 0;
    this.need = { L: false, R: false, VL: false, VR: false };
    this.rustAtNook = false;
    this.lingerUntil = { L: 0, R: 0 }; // heard a fake-out twang / hum just outside that door
    this.alert = null; // told which way somebody will come first (the grudge cue): { way, until }
    this.sloppy = kind === 'sloppy';
    // 'listener' and 'gullible': a guard who saves power - good ears, the monitor only every other
    // round, long rests in between (so the cast finds lulls to bait). They differ in one thing:
    // the listener sees through every trick it hears, the gullible one takes every bait.
    const quiet = kind === 'listener' || kind === 'gullible';
    this.earP = kind === 'good' || quiet ? 1 : kind === 'medium' ? 0.6 : 0.25; // chance an audio tell is noticed
    this.slow = kind === 'good' ? 0 : quiet ? 5 : kind === 'medium' ? 15 : 25; // extra reaction ticks
    this.wiseP = kind === 'good' || kind === 'listener' ? 1 : kind === 'gullible' ? 0 : kind === 'medium' ? 0.5 : 0.2; // chance a trick it heard is seen through
    this.rest = quiet ? [70, 150] : this.sloppy ? [40, 40] : [20, 50]; // ticks of rest after a round
    this.camEvery = quiet ? 2 : 1; // the monitor every n-th round
    this.round = 0;
    // the Golden Dog: how good this guard is at not looking, and at left being right
    const sharp = kind === 'good' || kind === 'listener';
    this.lookP = sharp ? 0 : kind === 'medium' || kind === 'gullible' ? 0.25 : 0.6; // chance it turns round to look at a visit
    this.mirrorP = sharp ? 1 : kind === 'medium' || kind === 'gullible' ? 0.75 : 0.4; // chance it works out the mirror
    this.gq = []; // reactions to him, on the night's clock: [tick, fn]
    this.g = { feed: false, wary: false, mirror: false, swap: false, lookUntil: 0 };
  }
  /** One hand for every control: once the bot has worked out the mirror it uses the other one. */
  press(action, arg) {
    return this.s.input(this.g.swap ? MIRROR[action] ?? action : action, arg);
  }
  /** A reaction to the Golden Dog, `min`..`max` ticks from now on the night's clock (slower bots are later). */
  later(min, max, fn) {
    this.gq.push([this.s.now + min + this.slow + Math.floor(this.rand() * (max - min + 1 + this.slow)), fn]);
  }
  /** His tells and shifts (the effects with fx 'golden'). */
  hearGolden(e) {
    const s = this.s;
    const g = this.g;
    if (e.kind === 'shift' && e.shift === 'feed') {
      g.feed = true;
      // it sees the cellar on its monitor: a moment, then down with it, and no cameras until this is over
      this.later(6, 24, () => {
        if (!g.feed) return;
        g.wary = true;
        if (s.devices.cams.open) this.press('cams_close');
        if (this.phase <= 2) { this.phase = 3; this.busyUntil = s.t; }
      });
    }
    if (e.kind === 'shift' && e.shift === 'mirror') {
      g.mirror = true;
      if (this.rand() < this.mirrorP) this.later(4, 24, () => { if (g.mirror) g.swap = true; });
    }
    if (e.kind === 'shift' && e.shift === 'visit' && this.rand() < this.lookP) {
      // it cannot help it: a look over the shoulder
      const from = s.now + 5 + this.slow + Math.floor(this.rand() * 30);
      this.gq.push([from, () => { g.lookUntil = s.now + 10 + Math.floor(this.rand() * 25); }]);
    }
    if (e.kind === 'arrive') {
      // the Other Office: sitting in the seat it faces him. It looks down at the desk when it thinks to
      g.lookUntil = Infinity;
      this.later(4, 12, () => { g.lookUntil = 0; });
    }
    if (e.kind === 'phone' && e.ring) this.later(8, 24, () => this.s.input('answer'));
    if (e.kind === 'end') {
      if (e.shift === 'feed') g.feed = g.wary = false;
      if (e.shift === 'mirror') g.mirror = g.swap = false;
      if (e.shift === 'visit' || e.shift === 'other') g.lookUntil = 0;
    }
  }
  /** Every tick: due reactions to him, and where the guard's eyes are. */
  tickGolden() {
    const s = this.s;
    if (this.gq.length) {
      this.gq.sort((a, b) => a[0] - b[0]);
      while (this.gq.length && this.gq[0][0] <= s.now) this.gq.shift()[1]();
    }
    s.look(s.now < this.g.lookUntil);
  }
  /** Who the hall light shows in a doorway (with the mirror on: only in the hall that is really lit). */
  atDoor(side) {
    const d = this.s.devices;
    if (this.g.mirror && !(side === 'L' ? d.lightL : d.lightR)) return undefined;
    return side === 'L' ? this.occupant('DOOR_L') : this.occupant('WIN_R') || this.occupant('DOOR_R');
  }
  heard() { return this.rand() < this.earP; }
  /** A tell from the way the bot was told to expect somebody (the grudge): it is listening for that one. */
  expected(e) {
    const a = this.alert;
    if (!a || this.s.t > a.until || e.fx === 'cue') return false;
    if (a.way === 'L' || a.way === 'R') return e.door === a.way || e.approach === a.way;
    const side = a.way === 'VL' ? 'L' : 'R';
    return (e.fx === 'at_vent' && e.side === side) || e.near === side || e.vent === side;
  }
  wise() { return this.rand() < this.wiseP; }
  /** The cast's tricks (every one has a tell; see the header). */
  hearCue(e) {
    const other = { L: 'R', R: 'L' };
    switch (e.kind) {
      case 'linger': // a soft twang / hum just outside after a door held: they are lingering, keep it shut a while
        this.lingerUntil[e.side] = this.s.t + 150;
        return;
      case 'knock': // bait for a light check: look, and (knowing the trick) look again a moment later
        this.at(this.react(10, 40), 'peek', e.side);
        if (this.wise()) this.at(this.react(75, 105), 'peek', e.side);
        return;
      case 'decoy': // a hum that is too clean comes from the wrong hall: she is at the other one
        this.at(this.react(10, 40), 'peek', this.wise() ? other[e.side] : e.side);
        return;
      case 'clatter': // a racket in the kitchen: someone else is stepping up to a door
        if (this.wise()) {
          this.at(this.react(10, 30), 'peek', 'L');
          this.at(this.react(50, 75), 'peek', 'R');
        } else this.at(this.react(10, 30), 'listen', '6'); // distracted: up with the monitor, to the kitchen feed
        return;
      case 'places_go': // two of them left the stage together: both halls, in turn
        this.at(this.react(70, 120), 'peek', 'L');
        this.at(this.react(140, 200), 'peek', 'R');
        return;
      case 'grudge': // whoever got in last time is coming the same way first: listen for it there
        this.alert = { way: e.way, until: this.s.t + 1600 };
        if (e.way === 'L' || e.way === 'R') this.at(this.react(60, 110), 'peek', e.way);
        return;
      case 'squeal': // the feed whines: look away before it burns out
        this.at(this.react(4, 20), 'look_away', e.cam);
        return;
      case 'pull': // the music warbles: she is at the tape deck
        if (!e.again || this.s.devices.cams.cam !== '8') this.at(this.react(10, 40), 'go_wind');
        return;
      default:
    }
  }
  rand() { this.r = (this.r * 1664525 + 1013904223) >>> 0; return this.r / 4294967296; }
  react(min, max) { return this.s.t + min + this.slow + Math.floor(this.rand() * (max - min + 1 + this.slow)); }
  at(tick, action, arg) { this.queue.push([tick, action, arg]); }
  occupant(node) { return Object.values(this.s.chars).find((c) => c.node === node && !c.walk && !c.inside); }
  hear(e) {
    if (this.kind === 'idle') return;
    if (e.fx === 'golden') return this.hearGolden(e);
    if (this.s.final) return this.hearFinal(e);
    const cue = ['at_nook', 'at_vent', 'ringmaster', 'cue'].includes(e.fx) || (e.fx === 'sound' && ['fnar.cat.run', 'fnar.mirehop.strum', 'fnar.noxbriar.hum', 'fnar.rat.maracas', 'fnar.servo.move', 'fnar.step.heavy', 'fnar.cat.growl'].includes(e.id));
    if (cue && !this.expected(e) && !this.heard()) return;
    // footsteps / a hum coming down a hall: take a look down that hall soon
    if (e.fx === 'sound' && e.approach && !e.kitchen && e.id !== 'fnar.cat.growl') { this.at(this.react(10, 40), 'peek', e.approach); return; }
    // the whirr of a servo in a doorway: somebody is stepping in - slam that door
    if (e.fx === 'sound' && e.id === 'fnar.servo.move' && e.door) { this.at(this.react(4, 20), e.door === 'L' ? 'want_door_l' : 'want_door_r'); return; }
    if (e.fx === 'cue') return this.hearCue(e);
    if (e.fx === 'at_nook') { this.rustAtNook = true; this.at(this.react(8, 30), 'want_door_r'); }
    if (e.fx === 'sound' && e.id === 'fnar.cat.run') { const side = e.at === 'door_l' ? 'L' : 'R'; this.need[side] = true; this.at(this.react(10, 30), side === 'L' ? 'want_door_l' : 'want_door_r'); }
    if (e.fx === 'cat_bang') { this.need[e.side] = false; }
    if (e.fx === 'sound' && e.id === 'fnar.rat.maracas' && (e.near || e.vent)) { const side = e.near || e.vent; this.need['V' + side] = true; this.at(this.react(8, 28), 'want_vent_' + side.toLowerCase()); }
    if (e.fx === 'at_vent') { this.need['V' + e.side] = true; this.at(this.react(8, 28), 'want_vent_' + e.side.toLowerCase()); }
    if (e.fx === 'vent_bang') { this.need['V' + e.side] = false; this.at(this.react(10, 40), 'release_vent_' + e.side.toLowerCase()); }
    // a twang or a hum at a door: shut the door it comes from (their own, or the other after a trade)
    if (e.fx === 'sound' && (e.id === 'fnar.mirehop.strum' || e.id === 'fnar.noxbriar.hum') && e.door) { this.need[e.door] = true; this.at(this.react(10, 30), e.door === 'L' ? 'want_door_l' : 'want_door_r'); }
    if (e.fx === 'left_door') { this.need[e.side] = false; if (!e.linger) this.lingerUntil[e.side] = 0; }
    if (e.fx === 'rusted' && e.on) this.at(this.react(8, 30), 'cams_open');
    if (e.fx === 'ringmaster' && e.state === 'leaving') this.at(this.react(10, 40), 'go_wind');
  }
  tick() {
    const s = this.s;
    const d = s.devices;
    // queued reactions
    this.queue.sort((a, b) => a[0] - b[0]);
    while (this.queue.length && this.queue[0][0] <= s.t) {
      const [, a, arg] = this.queue.shift();
      this.do(a, arg);
    }
    if (this.kind === 'idle') return;
    this.tickGolden();
    if (s.final) return this.finalTick();
    if (s.golden.holding) return; // (the cast holds still, and so does the routine that answers it)
    // Custom Night: the Ringmaster walks - hunt him with the spotlight now and then
    const rm = s.chars.top_hat_rat;
    if (rm.enabled && rm.out && s.t >= (this.huntAt ?? 0) && !this.g.feed) {
      this.huntAt = s.t + 70 + this.slow * 2;
      // save the light until he is in a hall
      const cam = rm.node && !rm.walk && ['2A', '2B', '4A', '4B'].find((c) => CAMERA_BY_ID[c].sees.includes(rm.node));
      if (cam) {
        if (!d.cams.open) this.press('cams_open', cam);
        else this.press('cam_select', cam);
        this.at(s.t + 8 + this.slow, 'spot');
        this.busyUntil = s.t + 14;
        return;
      }
    }
    if (s.t < this.busyUntil) return;
    // the routine: cams sweep, then lights, then rest
    const camsSweep = ['4B', '8', '2A', '4A'];
    if (this.phase === 0) { // raise cams
      if (this.round++ % this.camEvery) { this.phase = 3; return; } // (a power saver: lights only this round)
      if (this.g.wary) { this.phase = 3; return; } // (the wrong feed: there is nothing to see up there)
      if (!d.cams.open) this.press('cams_open', '4B');
      this.sweepIdx = 0; this.phase = 1; this.busyUntil = s.t + 12;
    } else if (this.phase === 1) {
      if (!d.cams.open) { this.phase = 0; return; } // something put the monitor down: start over
      const cam = camsSweep[this.sweepIdx];
      if (!cam) { this.phase = 2; return; }
      if (cam === '8' && !s.tape.enabled) { this.sweepIdx++; return; }
      if (d.cams.cam !== cam) { this.press('cam_select', cam); this.busyUntil = s.t + 6; return; }
      // look
      if (cam === '8') {
        if (s.tape.level < 85000) { this.press('wind'); this.busyUntil = s.t + 9; return; }
      }
      if (cam === '4B' && s.camWorking('4B') && !this.g.feed) {
        const r = this.occupant('NOOK');
        this.rustAtNook = !!(r && r.id === 'rustgrin');
        if (this.rustAtNook && !d.doorR) this.press('door_r');
        // CAM 4B also shows the window and the right doorway
        if ((this.occupant('WIN_R') || this.occupant('DOOR_R')) && !d.doorR) this.press('door_r');
      }
      this.sweepIdx++; this.busyUntil = s.t + (this.sloppy ? 6 : 10);
    } else if (this.phase === 2) { // lower and check lights
      if (d.cams.open) this.press('cams_close');
      this.phase = 3; this.busyUntil = s.t + 8;
    } else if (this.phase === 3) {
      this.press('light_l'); this.phase = 4; this.busyUntil = s.t + 10;
    } else if (this.phase === 4) {
      const o = this.atDoor('L');
      this.need.L = !!o || this.need.L && false;
      if (o && !d.doorL) this.press('door_l');
      if (!o && d.doorL && !this.catRunning('L') && !this.ringmasterNear('L') && s.t >= this.lingerUntil.L) this.press('door_l');
      if (d.lightL) this.press('light_l');
      this.phase = 5; this.busyUntil = s.t + 6;
    } else if (this.phase === 5) {
      this.press('light_r'); this.phase = 6; this.busyUntil = s.t + 10;
    } else if (this.phase === 6) {
      const o = this.atDoor('R');
      const keep = !!o || this.rustAtNook || this.catRunning('R') || s.t < this.lingerUntil.R;
      if (keep && !d.doorR) this.press('door_r');
      if (!keep && d.doorR) this.press('door_r');
      if (d.lightR) this.press('light_r');
      this.phase = 7; this.busyUntil = s.t + this.rest[0] + Math.floor(this.rand() * (this.rest[1] - this.rest[0]));
    } else {
      this.phase = 0;
    }
  }
  // ---- the Final Act: answer every cue, then hunt the Ringmaster with the spotlight
  hearFinal(e) {
    const s = this.s;
    if (e.fx === 'event' && e.kind === 'summon') {
      this.summonSide = null;
      if (e.who !== 'cat' && e.who !== 'purple_rat') this.at(this.react(20, 60), `want_${e.guard}_${e.side.toLowerCase()}`);
    }
    // the Cat's bells / the Purple Rat's maracas tell which side
    if (e.fx === 'sound' && (e.id === 'fnar.cat.run' || e.id === 'fnar.cat.bell') && /door_/.test(e.at ?? '') && this.heard()) this.at(this.react(8, 25), `want_door_${e.at.slice(5)}`);
    if (e.fx === 'sound' && e.id === 'fnar.rat.maracas' && /vent_/.test(e.at ?? '') && this.heard()) this.at(this.react(8, 25), `want_vent_${e.at.slice(5)}`);
    if (e.fx === 'event' && e.kind === 'none') this.at(this.react(10, 30), 'release_all');
    if (e.fx === 'event' && e.kind === 'game') this.at(this.react(15, 45), 'game', e);
    if (e.fx === 'rusted' && e.on) this.at(this.react(8, 30), 'cams_open');
  }
  finalTick() {
    const s = this.s; const d = s.devices; const rm = s.chars.top_hat_rat;
    const ev = rm.event;
    if (ev && ev.kind === 'game' && ev.game === 'still') return; // hands off
    if (s.t < this.busyUntil) return;
    if (!rm.out) { if (d.cams.open && !(ev && (ev.game === 'cam' || ev.game === 'find'))) this.press('cams_close'); return; }
    // Act III: sweep the cameras that can see him and light him up
    const sweep = ['1C', '1B', '2A', '2B', '4A', '4B'];
    if (!d.cams.open) { this.press('cams_open', sweep[0]); this.busyUntil = s.t + 8; return; }
    const seen = rm.node && !rm.walk && CAMERA_BY_ID[d.cams.cam].sees.includes(rm.node);
    if (seen) { this.press('spotlight'); this.busyUntil = s.t + 12 + this.slow; return; }
    this.sweepI = ((this.sweepI ?? 0) + 1) % sweep.length;
    this.press('cam_select', sweep[this.sweepI]);
    this.busyUntil = s.t + 8 + this.slow;
  }
  catRunning(side) { const c = this.s.chars.cat; return c.state === 'run' && c.side === side; }
  ringmasterNear() { return false; }
  do(a, arg) {
    const s = this.s; const d = s.devices;
    if (a === 'want_vent_l' && !d.ventL) this.press('vent_l');
    if (a === 'want_vent_r' && !d.ventR) this.press('vent_r');
    if (a === 'spot') { this.press('spotlight'); return; }
    if (a === 'listen') {
      // the kitchen camera (audio only), for a couple of seconds
      if (!d.cams.open) this.press('cams_open', arg);
      else this.press('cam_select', arg);
      this.phase = 2; // then back to the lights
      this.busyUntil = Math.max(this.busyUntil, s.t + 40);
      return;
    }
    if (a === 'look_away') {
      // a squealing feed: on to the next camera of the sweep
      if (d.cams.open && d.cams.cam === arg) { this.press('cam_select', arg === '1B' ? '2A' : '1B'); this.busyUntil = Math.max(this.busyUntil, s.t + 8); }
      return;
    }
    if (a === 'peek') {
      // a quick look down one hall: monitor down, light on, look, shut the door if someone is there
      // on the cameras: cut the sweep short and go straight to the light checks
      if (d.cams.open) { if (this.phase === 1) { this.phase = 2; this.busyUntil = s.t; } return; }
      const light = arg === 'L' ? 'light_l' : 'light_r';
      if (!(arg === 'L' ? d.lightL : d.lightR)) this.press(light);
      this.at(s.t + 8, 'peek_look', arg);
      this.busyUntil = Math.max(this.busyUntil, s.t + 10);
      return;
    }
    if (a === 'peek_look') {
      const o = this.atDoor(arg);
      if (o && !(arg === 'L' ? d.doorL : d.doorR)) this.press(arg === 'L' ? 'door_l' : 'door_r');
      if (arg === 'L' ? d.lightL : d.lightR) this.press(arg === 'L' ? 'light_l' : 'light_r');
      return;
    }
    if (a === 'release_all') { if (d.doorL) this.press('door_l'); if (d.doorR) this.press('door_r'); if (d.ventL) this.press('vent_l'); if (d.ventR) this.press('vent_r'); if (d.lightL) this.press('light_l'); if (d.lightR) this.press('light_r'); return; }
    if (a === 'game') {
      const g = arg.game;
      if (g === 'cam' || g === 'find') { if (!d.cams.open) this.press('cams_open', arg.cam); else this.press('cam_select', arg.cam); this.busyUntil = s.t + 30; }
      if (g === 'doors') { if (!d.doorL) this.press('door_l'); if (!d.doorR) this.press('door_r'); }
      if (g === 'doors_open') { if (d.doorL) this.press('door_l'); if (d.doorR) this.press('door_r'); }
      if (g === 'light') this.press(arg.side === 'L' ? 'light_l' : 'light_r');
      if (g === 'vents') { if (!d.ventL) this.press('vent_l'); if (!d.ventR) this.press('vent_r'); }
      return;
    }
    if (a === 'want_door_l' && !d.doorL) this.press('door_l');
    if (a === 'want_door_r' && !d.doorR) this.press('door_r');
    if (a === 'want_door_r' && this.rustAtNook && d.cams.open && d.cams.cam !== '4B') this.press('cam_select', '4B');
    if (a === 'want_vent_l' && !d.ventL) this.press('vent_l');
    if (a === 'want_vent_r' && !d.ventR) this.press('vent_r');
    if (a === 'release_vent_l' && d.ventL) this.press('vent_l');
    if (a === 'release_vent_r' && d.ventR) this.press('vent_r');
    if (a === 'cams_open' && !d.cams.open) this.press('cams_open');
    if (a === 'go_wind') { this.phase = 1; this.sweepIdx = 1; if (!d.cams.open) this.press('cams_open', '8'); }
  }
}
