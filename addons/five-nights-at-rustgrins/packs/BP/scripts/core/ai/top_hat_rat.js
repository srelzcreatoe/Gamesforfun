// The Ringmaster (Top-Hat Rat).
//
//   booth   nights 1-5: he stands in his booth (the old Kitty's Cabaret, CAM 1C) and never
//           moves. He calls the office every night instead of the day manager.
//   final   night 6, the Final Act. The other five are his marionettes and move only on
//           his cue, in three acts of two hours:
//             I   Meet the Performers - he sends one performer at a time to a door or vent
//                 with a 10-second warning; a shut door / vent turns them away.
//             II  Audience Participation - Simon-says games with a 10-second timer
//                 (a failed game sends a performer at once), now and then a summon.
//             III The Ringmaster - he walks to the office himself. Doors do not stop him;
//                 a SPOTLIGHT from a camera that sees him drives him back one step.
//   walker  Custom Night with his AI above 0: he walks to the office all night (Act III rules).
//
// Pure (no @minecraft imports): effects go through the session.

import { Animatronic, routePath, polyLength } from './base.js';
import { CONFIG } from '../config.js';
import { NODES } from '../../data/nodes.js';
import { CAMERA_BY_ID } from '../../data/cameras.js';

const PERFORMERS = Object.freeze(['mirehop', 'noxbriar', 'rustgrin', 'cat', 'purple_rat']);

/** Where each performer goes when he calls it: the route from its spot, and what stops it. */
function summonPlan(who, rng) {
  const cat = CONFIG.characters.cat.routes;
  const rat = { L: ['WD_0', 'WD_1', 'WD_2', 'WD_3', 'WD_4', 'WD_5', 'WD_END'], R: ['ED_0', 'ED_1', 'ED_2', 'ED_3', 'ED_4', 'ED_5', 'ED_END'] };
  switch (who) {
    case 'mirehop':
      return { guard: 'door', side: 'L', route: ['ST_M', 'DIN_NW', 'DIN_W', 'DIN_SW', 'WH_N', 'WH_M', 'WH_S', 'WC', 'DOOR_L'], anim: 'walk', home: 'ST_M', tell: 'fnar.mirehop.strum' };
    case 'noxbriar':
      return { guard: 'door', side: 'R', route: ['ST_N', 'DIN_E', 'DIN_SE', 'EH_N', 'EH_M', 'EH_S', 'EC', 'WIN_R'], anim: 'walk', home: 'ST_N', tell: 'fnar.noxbriar.hum' };
    case 'rustgrin':
      return { guard: 'door', side: 'R', route: ['ST_R', 'DIN_C', 'DIN_SE', 'EH_N', 'EH_M', 'EH_S', 'EC', 'DOOR_R'], anim: 'walk', home: 'ST_R', tell: 'fnar.rustgrin.feedback' };
    case 'cat': {
      const side = rng.chance(0.5) ? 'L' : 'R';
      return { guard: 'door', side, route: [...cat[side]], anim: 'run', home: 'MW_T', tell: 'fnar.cat.bell', late: 90 };
    }
    case 'purple_rat': {
      const side = rng.chance(0.5) ? 'L' : 'R';
      return { guard: 'vent', side, route: rat[side], anim: 'crawl', home: 'MW_P', tell: 'fnar.rat.maracas' };
    }
    default:
      return null;
  }
}

const GAME_CAMS = Object.freeze(['1A', '1B', '2A', '2B', '3', '4A', '4B', '5', '7', '8', '9', '10']);
const GAMES = Object.freeze(['still', 'cam', 'find', 'doors', 'light', 'vents']);

export class TopHatRat extends Animatronic {
  constructor(s, id) {
    super(s, id);
    this.F = CONFIG.finale;
    this.mode = s.def.final ? 'final' : this.baseAi > 0 ? 'walker' : 'booth';
    this.node = this.cfg.start;
    this.state = this.mode === 'booth' ? 'booth' : 'home';
    this.side = 'L';
    this.idx = 0;
    this.pauseUntil = 0;
    this.doorUntil = 0;
    this.spotReady = 0;
    this.killAt = 0;
    // the Final Act
    this.act = 0;
    this.event = null;
    this.nextEvent = 0;
    this.lastGame = null;
    this.lastSummon = null;
    this.returns = []; // performers turned away: [{ who, home, at }]
    this.saidHour5 = false;
  }

  /** Does he take part tonight (anything but standing in the booth)? */
  get enabled() {
    return this.mode !== 'booth';
  }

  /** Is he out of the booth, on his way to the office? (Standing in the booth again does not count.) */
  get out() {
    if (this.state === 'door') return true;
    return this.state === 'walk' && (this.idx > 0 || !!this.walk);
  }

  get active() {
    return this.mode === 'final' || super.active;
  }

  tick() {
    if (this.mode === 'booth') return;
    const s = this.s;
    if (this.state === 'inside') {
      if (s.t >= this.killAt) s.kill(this.id);
      return;
    }
    this.tickReturns();
    if (this.mode === 'final') this.tickFinal();
    else if (this.active) this.tickWalker();
  }

  // ------------------------------------------------------------ the Final Act
  tickFinal() {
    const s = this.s;
    const act = s.hour < 2 ? 1 : s.hour < 4 ? 2 : 3;
    if (act !== this.act) this.startAct(act);
    if (s.hour >= 5 && !this.saidHour5) {
      this.saidHour5 = true;
      s.emit({ fx: 'pa', key: 'hour5' });
    }
    if (this.event) this.tickEvent();
    else if (s.t >= this.nextEvent) this.nextEventFor(act);
    if (act === 3) this.tickWalker();
  }

  startAct(n) {
    const s = this.s;
    this.act = n;
    s.emit({ fx: 'act', act: n });
    this.nextEvent = Math.max(this.nextEvent, s.t + this.F.introTicks);
    if (n === 3) {
      // he leaves the booth himself
      this.side = s.rng.chance(0.5) ? 'L' : 'R';
      this.idx = 0;
      this.state = 'walk';
      this.pauseUntil = s.t + this.F.introTicks;
      s.emit({ fx: 'pose', who: this.id, node: this.node, pose: 'stand' });
      s.emit({ fx: 'sound', id: 'fnar.tophat.laugh', at: this.id, vol: 1 });
    }
  }

  nextEventFor(act) {
    const s = this.s;
    const F = this.F;
    const gap = (r) => s.rng.int(r[0], r[1]);
    if (act === 1) {
      this.summon(this.pickPerformer(), F.warn);
      this.nextEvent = s.t + F.warn + gap(F.summonGap);
    } else if (act === 2) {
      if (s.rng.chance(F.gameSummonChance)) this.summon(this.pickPerformer(), F.warn);
      else this.startGame();
      this.nextEvent = s.t + F.warn + gap(F.gameGap);
    } else {
      // Act III: the occasional performer while he walks (not while he is at the door)
      if (this.state !== 'door') this.summon(this.pickPerformer(), F.warn);
      this.nextEvent = s.t + F.warn + gap(F.lateSummonGap);
    }
  }

  pickPerformer() {
    const s = this.s;
    const home = PERFORMERS.filter((id) => id !== this.lastSummon && !this.returns.some((r) => r.who === id));
    return s.rng.pick(home.length ? home : PERFORMERS);
  }

  /** Send a performer to a door or vent; it arrives as the warning runs out. */
  summon(who, warn) {
    const s = this.s;
    const plan = summonPlan(who, s.rng);
    if (!plan) return;
    this.lastSummon = who;
    const path = routePath(plan.route);
    const travel = Math.max(20, warn - 15 - (plan.late ?? 0));
    const start = s.t + (plan.late ?? 0);
    const to = plan.route[plan.route.length - 1];
    this.event = { kind: 'summon', who, guard: plan.guard, side: plan.side, deadline: s.t + warn, home: plan.home, to, tell: plan.tell, moveAt: start, path, travel, anim: plan.anim, from: plan.route[0], moved: false };
    s.emit({ fx: 'pa', key: 'summon', who });
    s.emit({ fx: 'event', kind: 'summon', who, side: plan.side, guard: plan.guard, deadline: s.t + warn });
    s.emit({ fx: 'place', who, node: plan.route[0], pose: plan.anim === 'crawl' ? 'crawl' : 'stand' });
  }

  tickEvent() {
    const s = this.s;
    const ev = this.event;
    if (ev.kind === 'summon') {
      if (!ev.moved && s.t >= ev.moveAt) {
        ev.moved = true;
        s.emit({ fx: 'move', who: ev.who, path: ev.path, dur: ev.travel, anim: ev.anim, fromNode: ev.from, toNode: ev.to, yaw: NODES[ev.to].yaw });
        if (ev.who === 'cat') s.emit({ fx: 'sound', id: 'fnar.cat.run', at: 'door_' + ev.side.toLowerCase(), vol: 1 });
      }
      // the tell from the door / vent side: halfway there, and again on arrival
      const half = ev.moveAt + Math.floor(ev.travel / 2);
      if (ev.moved && (s.t === half || s.t === ev.moveAt + ev.travel)) {
        const at = ev.guard === 'vent' ? `vent_${ev.side.toLowerCase()}` : `door_${ev.side.toLowerCase()}`;
        s.emit({ fx: 'sound', id: ev.tell, at, vol: s.t === half ? 0.7 : 1, near: ev.guard === 'vent' ? ev.side : undefined });
      }
      if (s.t >= ev.deadline) this.resolveSummon(ev);
      return;
    }
    // a game
    if (this.gameDone(ev)) return this.gameWon(ev);
    if (s.t >= ev.deadline) {
      if (ev.game === 'still' && s.inputs === ev.inputs) return this.gameWon(ev);
      this.gameLost();
    }
  }

  resolveSummon(ev) {
    const s = this.s;
    this.event = null;
    const blocked = ev.guard === 'vent' ? s.ventClosed(ev.side) : s.doorClosed(ev.side);
    if (blocked) {
      const at = ev.guard === 'vent' ? `vent_${ev.side.toLowerCase()}` : `door_${ev.side.toLowerCase()}`;
      s.emit({ fx: 'sound', id: ev.guard === 'vent' ? 'fnar.rat.bang' : 'fnar.cat.bang', at, vol: 1 });
      s.emit({ fx: 'pa', key: 'blocked', who: ev.who });
      s.emit({ fx: 'event', kind: 'none' });
      this.returns.push({ who: ev.who, home: ev.home, at: s.t + this.F.blockedReturn });
      return;
    }
    s.emit({ fx: 'event', kind: 'none' });
    s.breach(ev.guard === 'vent' ? 'V' + ev.side : ev.side, ev.who);
    s.kill(ev.who);
  }

  tickReturns() {
    const s = this.s;
    if (!this.returns.length) return;
    this.returns = this.returns.filter((r) => {
      if (s.t < r.at) return true;
      s.emit({ fx: 'place', who: r.who, node: r.home, pose: 'pose' });
      return false;
    });
  }

  startGame() {
    const s = this.s;
    const options = GAMES.filter((g) => g !== this.lastGame);
    const game = s.rng.pick(options);
    this.lastGame = game;
    const ev = { kind: 'game', game, deadline: s.t + this.F.warn, inputs: s.inputs };
    if (game === 'cam') ev.cam = s.rng.pick(GAME_CAMS.filter((c) => c !== s.devices.cams.cam));
    if (game === 'find') ev.cam = '1C';
    if (game === 'light') ev.side = s.rng.chance(0.5) ? 'L' : 'R';
    this.event = ev;
    s.emit({ fx: 'pa', key: 'game', game, cam: ev.cam, side: ev.side });
    s.emit({ fx: 'event', kind: 'game', game, cam: ev.cam, side: ev.side, deadline: ev.deadline });
  }

  gameDone(ev) {
    const s = this.s;
    const d = s.devices;
    switch (ev.game) {
      case 'cam':
      case 'find':
        return d.cams.open && d.cams.cam === ev.cam;
      case 'doors':
        return d.doorL && d.doorR;
      case 'doors_open':
        return !d.doorL && !d.doorR;
      case 'light':
        return ev.side === 'L' ? d.lightL : d.lightR;
      case 'vents':
        return d.ventL && d.ventR;
      default:
        return false; // 'still' is judged when the timer runs out
    }
  }

  gameWon(ev) {
    const s = this.s;
    if (ev.game === 'doors') {
      // part two: open them again
      this.event = { kind: 'game', game: 'doors_open', deadline: s.t + this.F.warn, inputs: s.inputs };
      s.emit({ fx: 'pa', key: 'game', game: 'doors_open' });
      s.emit({ fx: 'event', kind: 'game', game: 'doors_open', deadline: this.event.deadline });
      return;
    }
    this.event = null;
    s.emit({ fx: 'pa', key: 'success' });
    s.emit({ fx: 'applause' });
    s.emit({ fx: 'event', kind: 'none' });
  }

  gameLost() {
    const s = this.s;
    this.event = null;
    s.emit({ fx: 'pa', key: 'fail' });
    s.emit({ fx: 'event', kind: 'none' });
    this.summon(this.pickPerformer(), this.F.failWarn);
  }

  // ------------------------------------------------------------ walking (Act III / Custom Night)
  pace() {
    // the Final Act speeds up at 5 AM; the Custom Night follows his AI level
    if (this.mode === 'final') return this.cfg.finalPause[this.s.hour >= 5 ? 1 : 0];
    return this.cfg.pause(this.ai);
  }

  tickWalker() {
    const s = this.s;
    if (this.tickWalk()) return;
    if (this.walk) return;
    if (this.state === 'door') {
      if (s.t >= this.doorUntil) this.enter();
      return;
    }
    if (this.state === 'home') {
      // Custom Night: leave the booth when the pause is over
      if (s.t < this.pauseUntil) return;
      this.side = s.rng.chance(0.5) ? 'L' : 'R';
      this.idx = 0;
      this.state = 'walk';
    }
    if (s.t < this.pauseUntil) return;
    const route = this.cfg.routes[this.side];
    if (this.idx === 0 && !this.walk && s.rng.chance(this.cfg.vanishChance)) {
      // the booth feed glitches and he is suddenly in the dining room
      const to = route.indexOf('DIN_SW');
      this.idx = to;
      this.placeAt(route[to], 'stand');
      s.staticOn(['1C', '1B'], 40);
      s.emit({ fx: 'sound', id: 'fnar.cam.glitch', at: 'cam1c', vol: 0.9 });
      s.emit({ fx: 'pa', key: 'step', node: 'DIN_SW' });
      this.pauseUntil = s.t + this.pace();
      return;
    }
    const next = route[this.idx + 1];
    if (!next) return;
    if (this.goTo(next, { speed: this.cfg.walkSpeed, anim: 'walk', statics: false })) {
      this.idx++;
      s.emit({ fx: 'sound', id: 'fnar.tophat.cane', at: this.id, vol: 1, follow: true });
    }
  }

  onArrive(node) {
    const s = this.s;
    const route = this.cfg.routes[this.side];
    if (node === route[route.length - 1]) {
      this.state = 'door';
      this.doorUntil = s.t + this.cfg.doorGrace;
      s.emit({ fx: 'pose', who: this.id, node, pose: 'stand' });
      s.emit({ fx: 'sound', id: 'fnar.tophat.cane', at: `door_${this.side.toLowerCase()}`, vol: 1 });
      s.emit({ fx: 'pa', key: 'step', node });
      return;
    }
    this.pauseUntil = s.t + this.pace();
    s.emit({ fx: 'pose', who: this.id, node, pose: 'stand' });
    if (node === 'DIN_SW' || node === 'WC' || node === 'EC') s.emit({ fx: 'pa', key: 'step', node });
  }

  enter() {
    const s = this.s;
    this.state = 'inside';
    this.inside = true;
    s.breach(this.side, this.id, true);
    this.killAt = s.t + 20;
  }

  /** SPOTLIGHT from the camera map. Hits only when the live camera sees him standing at a spot. */
  spotlight() {
    const s = this.s;
    const F = this.F;
    if (!this.enabled) return { ok: false, reason: 'idle' };
    if (!s.devices.cams.open) return { ok: false, reason: 'not_cams' };
    if (s.t < this.spotReady) return { ok: false, reason: 'cooldown' };
    this.spotReady = s.t + F.spotlightCooldown;
    const cam = CAMERA_BY_ID[s.devices.cams.cam];
    const hit = this.out && !this.walk && !!this.node && s.isWatchingNode(this.node);
    if (!hit) {
      s.drainPower(F.spotlightMissCost);
      s.emit({ fx: 'spotlight', hit: false, cam: cam?.id });
      if (this.out && s.rng.chance(0.3)) s.emit({ fx: 'pa', key: 'miss' });
      return { ok: true, hit: false };
    }
    s.drainPower(F.spotlightCost);
    s.emit({ fx: 'spotlight', hit: true, cam: cam.id });
    s.emit({ fx: 'pa', key: 'spotlight' });
    // he bows and steps back: one spot in the Final Act, all the way to his booth in the Custom Night
    const route = this.cfg.routes[this.side];
    this.idx = this.mode === 'final' ? Math.max(0, this.idx - 1) : 0;
    this.state = this.idx === 0 ? (this.mode === 'final' ? 'walk' : 'home') : 'walk';
    this.placeAt(route[this.idx], 'stand');
    // back in his booth he sulks a while longer before trying again
    this.pauseUntil = s.t + this.pace() * (this.idx === 0 ? 3 : 1);
    return { ok: true, hit: true };
  }

  debug() {
    if (this.mode === 'booth') return 'ringmaster:booth';
    const ev = this.event ? ` ${this.event.kind}:${this.event.game ?? this.event.who}` : '';
    return `ringmaster:${this.mode} act${this.act} ${this.state}${this.out ? `${this.side}${this.idx}` : ''}${ev}`;
  }
}

export { polyLength };
