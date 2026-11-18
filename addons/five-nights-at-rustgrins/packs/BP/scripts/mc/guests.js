// The daytime guests: people who come in from the street, sit, eat, play, watch the show and go
// home again while the pizzeria is open (Free Roam), and who all file out when it closes.
//
// Like the animatronics (mc/puppets.js) they are entities moved by teleport, with the animation picked
// through an entity property. They only ever walk on the walkways of data/guests.js, which the build
// checks against the built map, so nobody walks through a table, a wall or a closed door leaf.
//
// Entity properties of fnar:guest (BP entities/guest.json, built by tools/entities/build_guest.py):
//   fnar:anim   enum  idle walk hurry clap cheer wave point play talk sit eat sit_clap sit_talk sit_wave sit_cheer
//   fnar:skin   int   which of the skins
//   fnar:size   int   percent of adult height (children are small)
//   fnar:hold   int   0 no, 1 left hand out, 2 right hand out, 3 both (walking hand in hand)
//   fnar:look_yaw / fnar:look_pitch  int  head turn (degrees, smoothed client side)
//
// A day, in short: groups (a parent with a child or two, couples, teenagers) arrive every so often
// while there is room, stop at the hand-stamp podium, then go round a few stops of their own: a table
// to eat at, the arcade cabinets, the prize counter, the ball pit. When a show is announced the ones
// who are wandering head for the Dining Hall; during the show everyone there watches the stage, and
// they clap and cheer, loudest at the bow. After a while each group walks out to the street. At
// closing time everybody stops, gets up and leaves, parents taking the children by the hand, faster
// when the lights start going out; the last child out stops in the doorway and looks back at the stage.
//
// Cost: a seated or standing guest is looked at once every second or two (staggered); only the ones
// walking are moved every tick.

import { system } from '@minecraft/server';
import { CROWD, DAY_OPEN, DOOR, PORTALS, STANDS, STAGE_FOCUS, SKINS, SIZES, PARTIES, WAYPOINTS, scanPlan, buildGraph, anchor, anchorAt, route, laneOf } from '../data/guests.js';
import { dim, W, L, setLocal, typeAtLocal } from './world_io.js';
import { yawToward } from './puppets.js';
import { log } from './log.js';

export const GUEST_TYPE = 'fnar:guest';
const TAG = 'fnar_guest';

/** Eye height of a standing guest at fnar:size 100 (28 model px at the entity's 0.9375 render scale). */
const EYE = 1.64;
/** A seated guest's feet origin is this far (x its size) below the seat: the underside of its thighs is 10 model px up. */
const SEAT_DROP = 0.6;
/** Walking speeds in blocks per tick, by build (the walk animation's steps cover about 2.7 blocks a second at most). */
const STROLL = Object.freeze({ adult: [0.108, 0.132], teen: [0.114, 0.134], child: [0.112, 0.136] });
/** How much faster everyone walks at closing time (a jog), and once the lights start going out (a run). */
const PACE = Object.freeze({ day: 1, closing: 1.8, hurry: 2.8 });
/** How long a group stays at each kind of stop (ticks). */
const STAY = Object.freeze({ seats: [2200, 4200], arcade: [700, 1300], prize: [300, 600], pit: [400, 800], stage: [260, 480], podium: [45, 95] });
/** The sounds of a crowd (tools/sounds/recipes_day.py). */
const SND = Object.freeze({ crowd: 'fnar.day.crowd', cheer: 'fnar.day.cheer', chime: 'fnar.day.door_chime' });
/** Where the murmur comes from, and which guests count for it. */
const MURMUR = Object.freeze([
  Object.freeze({ key: 'crowd_dining', at: Object.freeze({ x: 38.5, y: 2, z: 24 }), has: (g) => g.x < 63, full: 14 }),
  Object.freeze({ key: 'crowd_games', at: Object.freeze({ x: 70, y: 2, z: 50 }), has: (g) => g.x >= 48 && g.x < 100 && g.z >= 42, full: 8 }),
]);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Turn `cur` towards `want` (degrees) by at most `max`. */
function turnToward(cur, want, max) {
  const d = ((((want - cur) % 360) + 540) % 360) - 180;
  return cur + clamp(d, -max, max);
}
/** How long sliding onto (or off) a seat takes: longer along a bench. */
const slideTicks = (dx, dz) => Math.max(7, Math.round(Math.hypot(dx, dz) / 0.13));
/** The smallest signed angle from a to b. */
const angleDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

/** What the build plan puts in each of some cells (the last write wins), as palette keys. */
function planKeysAt(plan, cells) {
  const keys = cells.map(() => null);
  for (const ops of Object.values(plan.ops)) {
    for (const op of ops) {
      cells.forEach(([x, y, z], i) => {
        if (op[0] === 'F' && x >= op[1] && x <= op[4] && y >= op[2] && y <= op[5] && z >= op[3] && z <= op[6]) keys[i] = op[7];
        else if (op[0] === 'A' && (!keys[i] || keys[i] === 'air') && x >= op[1] && x <= op[4] && y >= op[2] && y <= op[5] && z >= op[3] && z <= op[6]) keys[i] = op[7];
        else if (op[0] === 'L') {
          const l = op[2];
          for (let k = 0; k < l.length; k += 3) if (l[k] === x && l[k + 1] === y && l[k + 2] === z) keys[i] = op[1];
        } else if (op[0] === 'T' && op[1] === x && op[2] === y && op[3] === z) keys[i] = op[4];
      });
    }
  }
  return keys;
}

export class Guests {
  /** @param {any} game the Game (plan, rng, audio, players()) */
  constructor(game) {
    this.game = game;
    this.graph = buildGraph();
    const g = this.graph;
    const { seats, cabinets } = scanPlan(game.plan);
    /** Every place a guest can be: seats, cabinets, standing spots; each with where it joins the walkways and who has it. */
    this.places = [
      ...seats.map((s) => ({ ...s, an: anchor(g, s.ax, s.az, { aisle: s.room === 'DINING' }), by: null })),
      ...cabinets.map((c) => ({ ...c, ax: c.x, az: c.z, room: 'GAMEROOM', an: anchor(g, c.x, c.z), by: null })),
      ...STANDS.map((s, i) => ({ ...s, id: `${s.kind}_${i}`, ax: s.x, az: s.z, room: s.kind === 'stage' ? 'DINING' : 'OTHER', an: anchor(g, s.x, s.z), by: null })),
    ];
    this.placeById = new Map(this.places.map((p) => [p.id, p]));
    /** @type {any[]} */
    this.list = [];
    /** @type {any[]} */
    this.groups = [];
    this.serial = 0;
    /** 'off' (no guests), 'open' (a day in Free Roam), 'closing' (everyone is leaving) */
    this.state = 'off';
    /** the live show: 'off', 'soon' (announced), 'on', 'bow' */
    this.show = 'off';
    /** @type {number} how fast everyone walks: PACE.day, .closing or .hurry */
    this.pace = PACE.day;
    this.nextArrival = 0;
    this.nextCheer = 0;
    /** @type {number | undefined} */
    this.timer = undefined;
    /** the doorway by day: what the plan builds in the cells that are opened, and whether they are open now */
    this.doorKeys = planKeysAt(game.plan, DAY_OPEN);
    this.doorOpen = false;
    this.doorChecked = false;
    /** closing time: the child who looks back from the doorway */
    this.lastChild = null;
  }

  // ================================================================ the day
  /** The pizzeria opens: a room that is already busy, a family on its way in, and more to come. */
  open() {
    this.clear();
    this.state = 'open';
    this.show = 'off';
    this.pace = PACE.day;
    this.frontDoors(true);
    const now = system.currentTick;
    const rng = this.game.rng;
    // people who are already inside: at tables, at the cabinets, at the prizes
    const starts = ['seats', 'seats', 'arcade', 'seats', 'prize', 'seats', 'pit'];
    for (const kind of starts) {
      if (this.list.length >= CROWD.open - 3) break;
      const grp = this.makeGroup(now, this.pickParty(CROWD.open - 3 - this.list.length));
      if (!grp) break;
      grp.stops = [{ kind }, ...this.planStops(grp).filter((s) => s.kind !== 'podium' && s.kind !== kind).slice(0, 1)];
      if (!this.settle(grp, now)) this.dropGroup(grp);
    }
    // the first of them is about to go home: someone comes out as you walk up
    const first = this.groups.find((gr) => gr.stops[0]?.kind === 'seats');
    if (first) first.leaveAt = now + 260 + rng.int(0, 200);
    // a family crossing the lot towards the doors right now
    const arriving = this.makeGroup(now, this.pickParty(4, true));
    if (arriving) this.arrive(arriving, now, anchorAt(this.graph, rng.chance(0.5) ? 'LOT_N' : 'LOT_S'));
    this.nextArrival = now + 240 + rng.int(0, 200);
    this.timer = system.runInterval(() => this.tick(), 1);
  }

  /** Remove every guest (the lobby, a night, a rebuild, a script reload) and put the doorway back as built. */
  clear() {
    if (this.timer !== undefined) system.clearRun(this.timer);
    this.timer = undefined;
    this.state = 'off';
    this.show = 'off';
    this.pace = PACE.day;
    this.lastChild = null;
    for (const p of this.places) p.by = null;
    this.list = [];
    this.groups = [];
    try {
      // by tag and by type: guests left behind by a script reload carry no record here
      for (const e of dim().getEntities({ type: GUEST_TYPE })) e.remove();
      for (const e of dim().getEntities({ tags: [TAG] })) e.remove();
    } catch (err) {
      log.warn(`guests: clean-up: ${err?.message ?? err}`);
    }
    for (const m of MURMUR) this.game.audio.stop(m.key);
    this.frontDoors(false);
  }

  /**
   * The front doors: by day the two open leaves are open down to the floor (the facade's plinth runs
   * across the doorway), at night the doorway is as built.
   */
  frontDoors(open) {
    if (!open && !this.doorOpen && this.doorChecked) return;
    if (!open && !this.game.builder?.isBuilt?.()) return; // nothing built to put back
    this.doorChecked = true;
    this.doorOpen = !!open;
    DAY_OPEN.forEach(([x, y, z], i) => {
      const key = this.doorKeys[i];
      if (!key || key === 'air') return; // the plan itself leaves the doorway open
      try {
        const now = typeAtLocal(x, y, z);
        if (open && now && now !== 'minecraft:air') setLocal(x, y, z, 'air');
        else if (!open && now === 'minecraft:air') setLocal(x, y, z, key);
      } catch (err) {
        log.warn(`guests: front doors: ${err?.message ?? err}`);
      }
    });
  }

  /** How many guests there are. */
  count() {
    return this.list.length;
  }

  /** How many are still inside the building. */
  inside() {
    return this.list.reduce((n, g) => n + (g.x < DOOR.x ? 1 : 0), 0);
  }

  // ================================================================ the show (called by the game)
  /** The show is announced: whoever is wandering heads for the Dining Hall. */
  showSoon() {
    if (this.state !== 'open') return;
    this.show = 'soon';
    const now = system.currentTick;
    for (const grp of this.groups) {
      if (grp.leaving) continue;
      const kind = grp.stops[grp.at]?.kind;
      if (kind === 'seats' || kind === 'stage' || kind === 'podium') continue;
      if (!this.game.rng.chance(0.75)) continue;
      grp.stops.splice(grp.at + 1, 0, { kind: 'show' });
      grp.until = Math.min(grp.until, now + this.game.rng.int(10, 120));
    }
  }

  /** The show starts: everyone in the Dining Hall watches the stage. */
  showStart() {
    if (this.state !== 'open') return;
    this.show = 'on';
    const now = system.currentTick;
    for (const g of this.list) if (g.place && !g.walk) g.next = Math.min(g.next, now + 5 + (g.n % 20));
  }

  /** The bow: applause from everyone who watched. */
  showBow() {
    if (this.state !== 'open') return;
    this.show = 'bow';
    const now = system.currentTick;
    let n = 0;
    for (const g of this.list) {
      if (!this.watching(g)) continue;
      n++;
      this.applaud(g, now, 110 + this.game.rng.int(0, 50));
    }
    if (n) this.cheer(now, clamp(0.35 + n * 0.05, 0.4, 1.1), true);
  }

  /** The show is over: back to the pizza, the games, the way home. */
  showEnd() {
    if (this.state !== 'open') return;
    this.show = 'off';
    const now = system.currentTick;
    for (const grp of this.groups) {
      const kind = grp.stops[grp.at]?.kind;
      // those who stood for the show move on; some of those at the tables leave now that it is over
      if (kind === 'stage') grp.until = Math.min(grp.until, now + this.game.rng.int(20, 160));
      else if (kind === 'seats' && grp.leaveAt < now + 1500 && this.game.rng.chance(0.5)) grp.leaveAt = now + this.game.rng.int(40, 300);
    }
    for (const g of this.list) if (g.place && !g.walk) g.next = Math.min(g.next, now + 10 + (g.n % 30));
  }

  // ================================================================ closing time (called by the game)
  /**
   * Closing time: the music has died. Everyone stops and looks at the stage, then gets up and files out
   * through the front doors, the children by the hand.
   */
  closing() {
    if (this.state !== 'open') return;
    this.state = 'closing';
    this.show = 'off';
    this.pace = PACE.closing;
    for (const m of MURMUR) this.game.audio.stop(m.key);
    const now = system.currentTick;
    const rng = this.game.rng;
    // everybody stops where they are
    for (const g of this.list) {
      g.follow = null;
      g.lead = null;
      if (g.walk) {
        g.walk = null;
        if (g.heading) this.release(g); // not there yet: the place is not theirs any more
      }
      g.heading = null;
      this.setHold(g, 0);
      if (!g.slide) this.anim(g, g.seated ? 'sit' : 'idle');
      this.faceTo(g, STAGE_FOCUS, g.seated ? 40 : 0);
      g.next = now + 100000; // the group's plan below moves them
    }
    // then, group by group, they leave: nearest the doors first, like a room emptying
    const order = [...this.groups].sort((a, b) => this.groupX(b) - this.groupX(a));
    order.forEach((grp, i) => {
      grp.leaving = true;
      grp.goAt = now + 18 + Math.min(i * 3, 30) + rng.int(0, 8);
    });
    // the last child out stops in the doorway and looks back: the one with the longest way to go
    let far = null;
    for (const g of this.list) {
      if (g.kind !== 'child' || g.x >= DOOR.x - 6) continue;
      if (!far || g.x < far.x) far = g;
    }
    this.lastChild = far;
    if (far) far.grp.goAt += 14; // and its family is the last to get up
  }

  /** The lights are going out: run. */
  hurry() {
    if (this.state !== 'closing' || this.pace === PACE.hurry) return;
    this.pace = PACE.hurry;
  }

  // ================================================================ every tick
  tick() {
    if (this.state === 'off') return;
    const now = system.currentTick;
    try {
      let gone = false;
      for (const g of this.list) {
        if (!g.e?.isValid) {
          g.gone = true; // unloaded or removed by something else
        } else if (g.slide) this.stepSlide(g, now);
        else if (g.walk) this.stepWalk(g, now);
        else if (now >= g.next) this.think(g, now);
        gone ||= g.gone;
      }
      if (gone) this.sweepGone();
      if (now % 10 === 3) {
        for (const grp of this.groups) this.thinkGroup(grp, now);
        if (this.state === 'open') {
          this.arrivals(now);
          this.noticePlayers(now);
        }
      }
      if (now % 40 === 7 && this.state === 'open') this.murmur();
    } catch (err) {
      log.error('guests tick failed', err);
    }
  }

  // ================================================================ groups
  /** Who comes together: a party that fits in `room` places. `family`: with at least one child. */
  pickParty(room, family = false) {
    // nobody meets their double: a party only comes if there is an unused skin for each of its members
    const free = { adult: SKINS.adult.length, teen: SKINS.teen.length, child: SKINS.child.length };
    for (const grp of this.groups) for (const g of grp.members) free[g.kind]--;
    const fits = PARTIES.filter((p) => p.kinds.length <= room && (!family || p.kinds.includes('child')) && Object.keys(free).every((k) => p.kinds.filter((x) => x === k).length <= free[k]));
    if (!fits.length) return null;
    return this.game.rng.weighted(fits.map((p) => [p.kinds, p.weight]));
  }

  /** A new group: its members exist as records only (no entity yet). */
  makeGroup(now, kinds) {
    if (!kinds) return null;
    const rng = this.game.rng;
    const grp = { id: ++this.serial, members: [], stops: [], at: 0, until: now, phase: 'travel', leaveAt: now + rng.int(5200, 9500), leaving: false, goAt: 0, chimed: false, portal: null, since: now };
    const used = new Set(this.groups.flatMap((gr) => gr.members.map((g) => g.skin)));
    for (const kind of kinds) {
      const free = SKINS[kind].filter((s) => !used.has(s));
      const skin = rng.pick(free.length ? free : SKINS[kind]);
      used.add(skin);
      const [lo, hi] = SIZES[kind];
      const size = rng.int(lo, hi);
      const [v0, v1] = STROLL[kind];
      grp.members.push({
        n: ++this.serial, e: null, grp, kind, skin, size, s: size / 100, speed: v0 + rng.next() * (v1 - v0),
        x: 0, y: 0, z: 0, yaw: 0, props: {}, place: null, heading: null, seated: false, walk: null, slide: null, follow: null, lead: null,
        next: now + rng.int(5, 40), busyUntil: 0, glanceUntil: 0, waveAt: 0, blockUntil: 0, yield: 0, lookBack: 0, gone: false,
      });
    }
    grp.stops = this.planStops(grp);
    this.groups.push(grp);
    return grp;
  }

  /** The stops of a visit, in order. */
  planStops(grp) {
    const rng = this.game.rng;
    const kids = grp.members.some((g) => g.kind === 'child');
    const teens = grp.members.every((g) => g.kind === 'teen');
    const plans = teens
      ? [[3, ['arcade', 'seats']], [2, ['arcade']], [1, ['seats', 'arcade']], [1, ['prize', 'arcade']]]
      : kids
        ? [[3, ['seats']], [3, ['arcade', 'seats']], [2, ['seats', 'arcade']], [1.5, ['prize', 'seats']], [1.5, ['seats', 'pit']], [1, ['arcade', 'pit', 'seats']], [1, ['stage', 'seats']]]
        : [[4, ['seats']], [1, ['prize', 'seats']], [1, ['seats', 'arcade']], [0.7, ['stage', 'seats']]];
    const stops = rng.weighted(plans.map(([w, p]) => [p, w])).map((kind) => ({ kind }));
    if (rng.chance(0.6)) stops.unshift({ kind: 'podium' });
    return stops;
  }

  /** A group's place on the map, for sorting (how far east its members are, on average). */
  groupX(grp) {
    return grp.members.reduce((s, g) => s + g.x, 0) / Math.max(1, grp.members.length);
  }

  dropGroup(grp) {
    for (const g of grp.members) this.removeGuest(g);
    this.groups = this.groups.filter((x) => x !== grp);
  }

  /** Put a new group straight at its first stop (the day starts with people already inside). */
  settle(grp, now) {
    const picked = this.pickPlaces(grp, grp.stops[0].kind);
    if (!picked) return false;
    for (const g of grp.members) {
      const p = picked.get(g);
      if (!this.spawn(g, p.x, p.z, p.yaw)) return false;
      this.take(g, p);
      this.settleAt(g, now);
    }
    grp.phase = 'stay';
    grp.until = now + Math.round(this.stay(grp.stops[0].kind) * (0.25 + this.game.rng.next() * 0.75));
    grp.leaveAt = now + this.game.rng.int(1200, 6500); // they came at different times
    return true;
  }

  /** A new group appears at a walkway anchor (a portal, or already in the lot) and walks in. */
  arrive(grp, now, from) {
    grp.portal = this.game.rng.weighted(PORTALS.map((p) => [p.id, p.weight]));
    const picked = this.pickPlaces(grp, grp.stops[0].kind) ?? this.fallbackPlaces(grp);
    if (!picked) {
      this.dropGroup(grp);
      return false;
    }
    const lanes = this.lanes(grp);
    let ahead = 0;
    // the grown-ups in front, the children a step or two behind, each already on its own lane
    for (const g of [...grp.members].sort((a, b) => (a.kind === 'child' ? 0 : 1) - (b.kind === 'child' ? 0 : 1))) {
      if (!this.spawn(g, from.x, from.z, 90)) {
        g.gone = true;
        continue;
      }
      this.goTo(g, picked.get(g), now, { from, lane: lanes.get(g), d0: ahead });
      ahead += g.kind === 'child' ? 0.9 : 0.5;
    }
    grp.phase = 'travel';
    grp.since = now;
    return true;
  }

  /** Each member's lane: adults near the middle, children outside them. Positive = right of the way they walk. */
  lanes(grp) {
    const rng = this.game.rng;
    const lanes = new Map();
    const adults = grp.members.filter((g) => g.kind !== 'child');
    const kids = grp.members.filter((g) => g.kind === 'child');
    // keep right, like people do: everyone a lane of their own, from just right of the middle outwards (where the
    // walkway is too narrow for that they fall in behind one another)
    const order = rng.chance(0.5) ? [...adults, ...kids] : [...kids, ...adults];
    const first = 0.12 + rng.next() * 0.3;
    order.forEach((g, i) => lanes.set(g, first + i * (0.62 + rng.next() * 0.12)));
    return lanes;
  }

  /** Every ten ticks: move a group on when its time at a stop is up; send it home when its visit is over. */
  thinkGroup(grp, now) {
    if (!grp.members.length) {
      this.groups = this.groups.filter((x) => x !== grp);
      return;
    }
    if (this.state === 'closing') {
      if (grp.goAt && now >= grp.goAt) {
        grp.goAt = 0;
        this.leaveNow(grp, now, true);
      }
      return;
    }
    if (grp.leaving) return;
    const moving = grp.members.some((g) => g.walk || g.slide);
    if (grp.phase === 'travel') {
      if (moving && now - grp.since < 2400) return;
      grp.phase = 'stay';
      grp.until = now + this.stay(grp.stops[grp.at]?.kind);
      return;
    }
    // nobody walks out on a show
    const show = this.show === 'on' || this.show === 'bow';
    const here = grp.stops[grp.at]?.kind;
    if (show && (here === 'seats' || here === 'stage')) return;
    if (now >= grp.leaveAt && here !== 'podium') return void this.leaveNow(grp, now, false);
    if (now < grp.until) return;
    // the next stop, or home
    let next = grp.stops[grp.at + 1];
    if (!next) return void this.leaveNow(grp, now, false);
    let kind = next.kind;
    if (kind === 'show') kind = this.show === 'off' ? null : this.game.rng.chance(0.65) ? 'seats' : 'stage';
    else if (this.show === 'soon' && kind !== 'seats' && kind !== 'stage') kind = 'seats'; // not now: the show is about to start
    let picked = kind ? this.pickPlaces(grp, kind) : null;
    if (!picked && kind === 'seats') picked = this.pickPlaces(grp, (kind = 'stage'));
    grp.at++;
    if (!picked) {
      grp.until = now; // no room there: on to the stop after it
      grp.stops[grp.at] = { kind: 'none' };
      return;
    }
    grp.stops[grp.at] = { kind };
    this.moveGroup(grp, picked, now);
  }

  /** Everyone gets up and walks to their new places: the children first when it is somewhere fun. */
  moveGroup(grp, picked, now) {
    const lanes = this.lanes(grp);
    const kind = grp.stops[grp.at].kind;
    const kidsFirst = kind === 'arcade' || kind === 'pit' || kind === 'stage';
    grp.members.forEach((g, i) => {
      const lead = (g.kind === 'child') === kidsFirst;
      this.goTo(g, picked.get(g), now, { lane: lanes.get(g), delay: (lead ? 0 : 16) + i * 6 + this.game.rng.int(0, 8) });
    });
    grp.phase = 'travel';
    grp.since = now;
  }

  /** How long to stay at a stop. */
  stay(kind) {
    const [a, b] = STAY[kind] ?? [40, 80];
    return this.game.rng.int(a, b);
  }

  /** Home: out through the front doors to the street. At closing time the children go by the hand. */
  leaveNow(grp, now, closing) {
    grp.leaving = true;
    grp.portal ??= this.game.rng.weighted(PORTALS.map((p) => [p.id, p.weight]));
    const out = anchorAt(this.graph, grp.portal);
    const adults = grp.members.filter((g) => g.kind !== 'child');
    const kids = grp.members.filter((g) => g.kind === 'child');
    if (!closing || !adults.length || !kids.length) {
      const lanes = this.lanes(grp);
      grp.members.forEach((g, i) => this.goTo(g, null, now, { to: out, lane: lanes.get(g), delay: (g.kind === 'child' ? 10 : 0) + i * 6, then: 'gone' }));
      return;
    }
    // hand in hand: every adult takes a child (or two) and they walk the adult's way out together
    const pairs = adults.map((a) => ({ a, kids: [] }));
    kids.forEach((k, i) => {
      const p = pairs.reduce((best, q) => (q.kids.length < best.kids.length || (q.kids.length === best.kids.length && Math.hypot(q.a.x - k.x, q.a.z - k.z) < Math.hypot(best.a.x - k.x, best.a.z - k.z)) ? q : best), pairs[i % pairs.length]);
      if (p.kids.length < 2) p.kids.push(k);
      else pairs.sort((x, y) => x.kids.length - y.kids.length)[0].kids.push(k);
    });
    pairs.forEach((p, i) => {
      const from = this.anchorOf(p.a);
      const way = route(this.graph, from, out);
      const two = p.kids.length > 1;
      const side = this.game.rng.chance(0.5) ? 1 : -1;
      const wait = (p.kids.length ? 14 : 0) + i * 6;
      this.walkWay(p.a, way, two ? 0 : side * 0.5, now, { delay: wait, then: 'gone' });
      p.kids.slice(0, 2).forEach((k, j) => {
        // the child walks to the adult, then beside it: on the left of an adult who walks on the right, and so on
        const lane = two ? (j ? 0.95 : -0.95) : -side * 0.5;
        const own = route(this.graph, this.anchorOf(k), from);
        const join = own.length ? own.length - 1 : 0;
        const whole = own.length ? [...own, ...way.slice(1)] : way;
        this.walkWay(k, whole, lane, now, { delay: j * 6, then: 'gone' });
        if (k.walk) {
          k.follow = { lead: p.a, at: join + (k.walk.lead ?? 0), trail: 0.42, synced: false, hand: lane < 0 ? 2 : 1 };
          p.a.lead = [...(p.a.lead ?? []), k];
        }
      });
    });
  }

  // ================================================================ places
  /** Reserve places for a whole group at a stop of this kind: Map member -> place, or null when there is no room. */
  pickPlaces(grp, kind) {
    const rng = this.game.rng;
    const free = (p) => !p.by;
    const n = grp.members.length;
    /** @type {Map<any, any>} */
    const out = new Map();
    const near = (list, a, max) => list.filter((p) => p !== a && Math.hypot(p.x - a.x, p.z - a.z) <= max).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
    if (kind === 'seats') {
      // a bench seat by the wall can only be reached past the one beside it: both go to the same group, or neither
      const seats = this.places.filter((p) => p.kind === 'seat' && p.room === 'DINING' && free(p));
      const ok = (p) => !p.past || !this.placeById.get(p.past)?.by;
      const show = this.show !== 'off';
      for (let attempt = 0; attempt < 12; attempt++) {
        let a = rng.pick(seats);
        if (!a || !ok(a)) continue;
        if (show) {
          // for a show: nearer the stage, and not with the back to it
          for (let k = 0; k < 4; k++) {
            const b = rng.pick(seats);
            if (b && ok(b) && b.z - (b.dir === 's' ? -12 : 0) < a.z - (a.dir === 's' ? -12 : 0)) a = b;
          }
        }
        const chosen = [a];
        for (const p of near(seats, a, 4.2)) {
          if (chosen.length >= n) break;
          if (!ok(p) || chosen.includes(p)) continue;
          if (p.past && !chosen.some((c) => c.id === p.past)) {
            const outer = this.placeById.get(p.past);
            if (!outer || outer.by || chosen.length + 2 > n) continue;
            chosen.push(outer);
          }
          chosen.push(p);
        }
        if (a.past && !chosen.some((c) => c.id === a.past)) continue;
        if (chosen.length < n) continue;
        // children next to the adults is what a table looks like anyway: hand them out as they come
        grp.members.forEach((g, i) => out.set(g, chosen[i]));
        return out;
      }
      return null;
    }
    if (kind === 'arcade') {
      const cabs = this.places.filter((p) => (p.kind === 'arcade' || p.kind === 'skee') && free(p));
      for (let attempt = 0; attempt < 8; attempt++) {
        const a = rng.pick(cabs);
        if (!a) return null;
        const chosen = [a, ...near(cabs, a, 3.2).filter((p) => p.yaw === a.yaw).slice(0, n - 1)];
        if (chosen.length < n) continue;
        // the children get the first machines, the grown-ups stand at the ones beside them
        const order = [...grp.members].sort((x, y) => (x.kind === 'child' ? 0 : 1) - (y.kind === 'child' ? 0 : 1));
        order.forEach((g, i) => out.set(g, chosen[i]));
        return out;
      }
      return null;
    }
    const stands = this.places.filter((p) => p.kind === kind && free(p));
    if (kind === 'stage') {
      // children in the front row, the grown-ups behind them
      const front = stands.filter((p) => p.row === 0);
      const back = stands.filter((p) => p.row === 1);
      for (let attempt = 0; attempt < 8; attempt++) {
        const a = rng.pick(front);
        if (!a) return null;
        const f = [a, ...near(front, a, 3.4)];
        const b = near(back, a, 3.4);
        let ok = true;
        for (const g of grp.members) {
          const p = (g.kind === 'child' ? f.shift() : b.shift()) ?? f.shift() ?? b.shift();
          if (!p) ok = false;
          else out.set(g, p);
        }
        if (ok) return out;
        out.clear();
      }
      return null;
    }
    const a = rng.pick(stands);
    if (!a) return null;
    const chosen = [a, ...near(stands, a, kind === 'podium' ? 4 : 3.5).slice(0, n - 1)];
    if (chosen.length < n) return null;
    grp.members.forEach((g, i) => out.set(g, chosen[i]));
    return out;
  }

  /** Somewhere to go when the first stop is full. */
  fallbackPlaces(grp) {
    for (const kind of ['seats', 'stage', 'arcade', 'prize', 'pit']) {
      const picked = this.pickPlaces(grp, kind);
      if (picked) {
        grp.stops = [{ kind }];
        grp.at = 0;
        return picked;
      }
    }
    return null;
  }

  take(g, place) {
    this.release(g);
    g.place = place;
    place.by = g;
  }

  release(g) {
    for (const p of [g.place, g.heading]) if (p && p.by === g) p.by = null;
    g.place = null;
    g.heading = null;
  }

  /** Where a guest joins the walkways from where it is now. */
  anchorOf(g) {
    if (g.place && !g.walk) return { ...g.place.an, x: g.place.ax, z: g.place.az };
    return anchor(this.graph, g.x, g.z);
  }

  // ================================================================ entities
  /** Create a guest's entity at a local position. */
  spawn(g, x, z, yaw) {
    try {
      const e = dim().spawnEntity(GUEST_TYPE, W(x, 0, z));
      e.addTag(TAG);
      g.e = e;
      g.props = {};
      g.x = x;
      g.y = 0;
      g.z = z;
      g.yaw = yaw;
      this.prop(g, 'fnar:skin', g.skin);
      this.prop(g, 'fnar:size', g.size);
      this.anim(g, 'idle');
      this.place(g);
      this.list.push(g);
      return true;
    } catch (err) {
      log.warn(`guests: spawn: ${err?.message ?? err}`);
      return false;
    }
  }

  removeGuest(g) {
    this.release(g);
    g.walk = null;
    g.slide = null;
    g.gone = true;
    for (const k of g.lead ?? []) k.follow = null;
    try {
      if (g.e?.isValid) g.e.remove();
    } catch {
      // gone already
    }
    g.e = null;
  }

  /** Forget the guests that have left (or whose entity is gone). */
  sweepGone() {
    for (const g of this.list) if (g.gone) this.removeGuest(g);
    this.list = this.list.filter((g) => !g.gone);
    for (const grp of this.groups) grp.members = grp.members.filter((g) => !g.gone);
    this.groups = this.groups.filter((grp) => grp.members.length);
    if (this.lastChild?.gone) this.lastChild = null;
  }

  prop(g, key, value) {
    if (g.props[key] === value) return;
    try {
      g.e.setProperty(key, value);
      g.props[key] = value;
    } catch (err) {
      log.warn(`guests: ${key}=${value}: ${err?.message ?? err}`);
    }
  }

  anim(g, a) {
    this.prop(g, 'fnar:anim', a);
  }

  setHold(g, h) {
    this.prop(g, 'fnar:hold', h);
  }

  look(g, yaw, pitch) {
    this.prop(g, 'fnar:look_yaw', Math.round(clamp(yaw, -85, 85)));
    this.prop(g, 'fnar:look_pitch', Math.round(clamp(pitch, -40, 40)));
  }

  /** Teleport the entity to the guest's position. */
  place(g) {
    try {
      g.e.teleport(W(g.x, g.y, g.z), { rotation: { x: 0, y: g.yaw } });
    } catch (err) {
      log.warn(`guests: move: ${err?.message ?? err}`);
      g.gone = true;
    }
  }

  /**
   * Look at a point: the head turns, and the body too when the head alone cannot (a standing guest turns
   * round; a seated one twists on the chair by up to `twist` degrees).
   */
  faceTo(g, target, twist = 0) {
    const dx = target.x - g.x;
    const dz = target.z - g.z;
    const want = yawToward(dx, dz);
    const base = g.seated && g.place ? g.place.yaw : g.yaw;
    let rel = angleDiff(base, want);
    if (g.seated) {
      const t = clamp(rel * 0.5, -twist, twist);
      if (Math.abs(angleDiff(g.yaw, base + t)) > 4) {
        g.yaw = base + t;
        this.place(g);
      }
      rel -= t;
    } else if (!g.walk && Math.abs(rel) > 50 && twist >= 0) {
      g.yaw = want;
      this.place(g);
      rel = 0;
    }
    const eye = g.y + EYE * g.s;
    const pitch = (-Math.atan2((target.y ?? eye) - eye, Math.hypot(dx, dz)) * 180) / Math.PI;
    this.look(g, rel, pitch);
  }

  // ================================================================ walking
  /**
   * Send a guest to a place (or to a walkway anchor: o.to). It gets up if it is seated, walks its own
   * lane of the walkways, and sits down, takes its spot or leaves at the end.
   */
  goTo(g, place, now, o = {}) {
    const from = o.from ?? this.anchorOf(g);
    const to = place ? { ...place.an, x: place.ax, z: place.az } : o.to;
    const way = route(this.graph, from, to);
    if (place) {
      this.releaseHeading(g);
      g.heading = place;
      place.by = g;
    }
    this.walkWay(g, way, o.lane ?? 0, now, { delay: o.delay ?? 0, then: o.then ?? (place ? 'place' : 'gone'), d0: o.d0 });
  }

  releaseHeading(g) {
    if (g.heading && g.heading.by === g) g.heading.by = null;
    g.heading = null;
  }

  /** Walk a route ([x, z, w] points along the walkways) in a lane of one's own. */
  walkWay(g, way, lane, now, o = {}) {
    if (way.length < 2) {
      // nowhere to walk: just be there
      if (!way.length) log.warn(`guests: no way from ${g.x.toFixed(1)},${g.z.toFixed(1)}`);
      g.walk = null;
      this.arrived(g, now, o.then ?? 'gone');
      return;
    }
    const pts = laneOf(way, lane);
    // from where the guest is right now (off its seat's step-off spot, or mid-lane)
    const sx = g.seated && g.place ? g.place.ax : g.x;
    const sz = g.seated && g.place ? g.place.az : g.z;
    let lead = 0;
    if (Math.hypot(pts[0][0] - sx, pts[0][1] - sz) > 0.05) {
      pts.unshift([sx, sz]);
      lead = 1;
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    g.walk = { pts, cum, len: cum[cum.length - 1], d: 0, i: 1, lead, then: o.then ?? 'gone', start: now + (o.delay ?? 0), going: false };
    g.follow = null;
    g.waitAt = undefined;
    if (g.seated) this.standUp(g, now);
    if (o.d0) {
      // already this far along (a group appears in formation, not in a heap)
      const w = g.walk;
      w.d = Math.min(w.len, o.d0);
      while (w.i < pts.length - 1 && cum[w.i] < w.d) w.i++;
      const t = clamp((w.d - cum[w.i - 1]) / (cum[w.i] - cum[w.i - 1] || 1), 0, 1);
      g.x = pts[w.i - 1][0] + (pts[w.i][0] - pts[w.i - 1][0]) * t;
      g.z = pts[w.i - 1][1] + (pts[w.i][1] - pts[w.i - 1][1]) * t;
      g.yaw = yawToward(pts[w.i][0] - pts[w.i - 1][0], pts[w.i][1] - pts[w.i - 1][1]);
      this.place(g);
    }
  }

  /** Off the chair, onto the step-off spot beside it. */
  standUp(g, now) {
    const p = g.place;
    if (!p) return;
    const wait = Math.max(0, (g.walk?.start ?? now) - now);
    g.slide = { x0: g.x, y0: g.y, z0: g.z, x1: p.ax, y1: 0, z1: p.az, yaw0: g.yaw, yaw1: g.yaw, t: -wait, n: slideTicks(g.x - p.ax, g.z - p.az), sit: false };
    g.seated = false;
    if (g.walk) g.walk.start = Math.max(g.walk.start, now + wait + g.slide.n);
  }

  stepSlide(g, now) {
    const s = g.slide;
    s.t++;
    if (s.t <= 0) return;
    if (s.t === 1) this.anim(g, s.sit ? 'sit' : 'idle');
    const f = Math.min(1, s.t / s.n);
    const e = f * f * (3 - 2 * f);
    g.x = s.x0 + (s.x1 - s.x0) * e;
    g.y = s.y0 + (s.y1 - s.y0) * e;
    g.z = s.z0 + (s.z1 - s.z0) * e;
    g.yaw = s.yaw0 + angleDiff(s.yaw0, s.yaw1) * e;
    this.place(g);
    if (f < 1) return;
    g.slide = null;
    if (s.sit) {
      g.seated = true;
      g.next = now + 10 + this.game.rng.int(0, 30);
    } else if (!g.walk) {
      g.next = now + 5;
    }
  }

  stepWalk(g, now) {
    const w = g.walk;
    if (now < w.start) return;
    if (!w.going) {
      w.going = true;
      this.release0(g);
      this.anim(g, this.walkAnim());
      this.look(g, 0, 0);
    }
    if (now < g.blockUntil) return; // someone is in the way (a player), or it is looking back
    let d = w.d;
    const f = g.follow;
    if (f && !f.lead.walk) g.follow = null; // the grown-up has gone ahead or is out: walk on alone
    if (g.follow?.synced && f.lead.walk.going) {
      // beside the grown-up: the same spot of the same stretch of the same walkway, a step behind
      const lw = f.lead.walk;
      const i = clamp(lw.i - lw.lead + f.at, 1, w.pts.length - 1);
      const seg = lw.cum[lw.i] - lw.cum[lw.i - 1] || 1;
      const t = clamp((lw.d - lw.cum[lw.i - 1]) / seg, 0, 1);
      const want = Math.min(w.len, w.cum[i - 1] + (w.cum[i] - w.cum[i - 1]) * t - f.trail);
      d = clamp(want, w.d, w.d + g.speed * this.pace * 1.25); // never backwards, never a jump
    } else if (g.follow?.synced) {
      d = w.d; // the grown-up is waiting: so does the child
    } else {
      let v = g.speed * this.pace;
      if (g.follow) v *= 1.25; // catching up
      if (g.yield > 0) {
        g.yield--;
        v *= 0.35;
      }
      // a grown-up with a child still on its way over walks off slowly so it can catch up, and waits outside the
      // doors for the one who is looking back
      const late = g.lead?.find((k) => k.follow?.lead === g && !k.follow.synced);
      if (late) {
        v *= 0.5;
        if (g.waitAt !== undefined && w.d >= g.waitAt) {
          v = 0;
          this.look(g, clamp(angleDiff(g.yaw, yawToward(late.x - g.x, late.z - g.z)), -85, 85), 8); // over the shoulder
        }
      }
      d = Math.min(w.len, w.d + v);
      if (g.follow && !g.follow.synced) {
        // near enough to take the hand?
        const L2 = g.follow.lead;
        if (Math.hypot(L2.x - g.x, L2.z - g.z) < 1.5 && w.i >= g.follow.at) g.follow.synced = true;
      }
    }
    // the last child out: one look back at the stage from the doorway
    if (g === this.lastChild && !g.lookBack && g.x >= DOOR.x - 1.4 && g.x < DOOR.x) {
      // (if other children are still on their way out, the last of them does it instead)
      const later = this.list.filter((o) => o !== g && o.kind === 'child' && !o.gone && o.x < g.x - 3).sort((a, b) => a.x - b.x)[0];
      this.lastChild = later ?? g;
    }
    if (g === this.lastChild && !g.lookBack && g.x >= DOOR.x - 1.4 && g.x < DOOR.x) {
      g.lookBack = now;
      g.blockUntil = now + 52;
      if (g.follow) {
        g.follow.synced = false;
        const a = g.follow.lead;
        if (a.walk) a.waitAt = a.walk.d + 2.6;
      }
      this.setHold(g, 0);
      for (const a of this.list) if (a.lead?.includes(g)) this.setHold(a, 0);
      this.anim(g, 'idle');
      g.yaw = yawToward(STAGE_FOCUS.x - g.x, STAGE_FOCUS.z - g.z);
      this.place(g);
      this.look(g, 0, -4);
      return;
    }
    if (g.lookBack && now === g.blockUntil) this.anim(g, 'hurry');
    const moved = d - w.d;
    w.d = d;
    while (w.i < w.pts.length - 1 && w.cum[w.i] < w.d) w.i++;
    const a = w.pts[w.i - 1];
    const b = w.pts[w.i];
    const seg = w.cum[w.i] - w.cum[w.i - 1] || 1;
    const t = clamp((w.d - w.cum[w.i - 1]) / seg, 0, 1);
    g.x = a[0] + (b[0] - a[0]) * t;
    g.z = a[1] + (b[1] - a[1]) * t;
    g.y = 0;
    if (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) > 0.02) g.yaw = turnToward(g.yaw, yawToward(b[0] - a[0], b[1] - a[1]), 22);
    this.place(g);
    if (moved <= 1e-4 && w.d < w.len) {
      if (g.props['fnar:anim'] !== 'idle') this.anim(g, 'idle'); // waiting
    } else if (g.props['fnar:anim'] !== this.walkAnim() && moved > 1e-4) this.anim(g, this.walkAnim());
    if ((now + g.n) % 4 === 0) this.mindOthers(g, now);
    if (g.kind === 'child' ? g.follow : g.lead) this.hands(g);
    // through the front doors on the way in: the chime
    if (!g.grp.chimed && !g.grp.leaving && g.x < DOOR.x && g.x > DOOR.x - 1.5) {
      g.grp.chimed = true;
      this.game.audio.play(SND.chime, DOOR.chime, null, { vol: 0.8, pitch: 0.96 + this.game.rng.next() * 0.08 });
    }
    if (w.d >= w.len - 1e-6) {
      g.walk = null;
      this.arrived(g, now, w.then);
    }
  }

  /** (the place a guest leaves is free from the moment it walks away) */
  release0(g) {
    if (g.place && g.place.by === g && g.place !== g.heading) g.place.by = null;
    if (g.place !== g.heading) g.place = null;
  }

  walkAnim() {
    return this.pace > PACE.day ? 'hurry' : 'walk';
  }

  /** Hand in hand while the two really are side by side. */
  hands(g) {
    if (g.kind === 'child') {
      const f = g.follow;
      const a = f.lead;
      const sep = Math.hypot(a.x - g.x, a.z - g.z);
      const on = f.synced && a.walk?.going && sep > 0.62 && sep < 1.45;
      this.setHold(g, on ? f.hand : 0);
      return;
    }
    let h = 0;
    for (const k of g.lead) if (k.props['fnar:hold']) h |= k.follow?.hand === 2 ? 1 : 2; // the child's right hand is in the adult's left
    this.setHold(g, h);
  }

  /** Slow down behind someone walking the same way; wait a moment for a player standing in the way. */
  mindOthers(g, now) {
    if (g.follow?.synced) return;
    const yaw = (g.yaw * Math.PI) / 180;
    const hx = -Math.sin(yaw);
    const hz = Math.cos(yaw);
    for (const o of this.list) {
      if (o === g || o.slide) continue;
      const dx = o.x - g.x;
      const dz = o.z - g.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.9 || d < 1e-3) continue;
      const ahead = (dx * hx + dz * hz) / d;
      if (ahead < 0.5) continue;
      if (!o.walk?.going) {
        // someone standing there (a friend who has just arrived, a guest held up): slow past
        if (d < 0.6) g.yield = 4;
        continue;
      }
      const oyaw = (o.yaw * Math.PI) / 180;
      const same = -Math.sin(oyaw) * hx + Math.cos(oyaw) * hz;
      if (same > 0.2) g.yield = 5;
    }
    if (this.state !== 'open' || now < g.blockUntil + 60) return;
    for (const p of this.game.players()) {
      let l;
      try {
        l = L(p.location);
      } catch {
        continue;
      }
      const dx = l.x - g.x;
      const dz = l.z - g.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.15 || d < 1e-3 || Math.abs(l.y - g.y) > 1.5) continue;
      if ((dx * hx + dz * hz) / d < 0.6) continue;
      g.blockUntil = now + 30; // "excuse me": then round (well, through) them
      this.anim(g, 'idle');
      this.faceTo(g, { x: l.x, y: l.y + 1.62, z: l.z }, -1);
      return;
    }
  }

  /** At the end of a walk: sit down, take the spot, or leave the world. */
  arrived(g, now, then) {
    this.setHold(g, 0);
    if (then === 'gone') {
      g.gone = true;
      return;
    }
    const p = g.heading;
    g.heading = null;
    if (!p) {
      this.anim(g, 'idle');
      g.next = now + 20;
      return;
    }
    g.place = p;
    p.by = g;
    this.settleAt(g, now, true);
  }

  /** Be at one's place: on the seat (sliding onto it when `slide`), or standing at the spot facing the right way. */
  settleAt(g, now, slide = false) {
    const p = g.place;
    if (p.kind === 'seat') {
      const y = p.top - SEAT_DROP * g.s;
      if (slide) {
        g.slide = { x0: g.x, y0: 0, z0: g.z, x1: p.x, y1: y, z1: p.z, yaw0: g.yaw, yaw1: p.yaw, t: 0, n: slideTicks(g.x - p.x, g.z - p.z), sit: true };
      } else {
        g.x = p.x;
        g.y = y;
        g.z = p.z;
        g.yaw = p.yaw;
        g.seated = true;
        this.place(g);
        this.anim(g, 'sit');
      }
    } else {
      g.x = p.x;
      g.y = 0;
      g.z = p.z;
      g.yaw = p.kind === 'stage' ? yawToward(STAGE_FOCUS.x - p.x, STAGE_FOCUS.z - p.z) : p.yaw;
      g.seated = false;
      this.place(g);
      this.anim(g, 'idle');
    }
    this.look(g, 0, 0);
    g.next = now + 12 + this.game.rng.int(0, 30);
  }

  // ================================================================ being somewhere
  /** Is this guest part of the show's audience right now? */
  watching(g) {
    if ((this.show !== 'on' && this.show !== 'bow') || g.walk || g.slide || !g.place) return false;
    return g.place.room === 'DINING';
  }

  /** Clap (or, for the young, cheer) for a while. */
  applaud(g, now, ticks) {
    const cheer = g.kind === 'child' ? this.game.rng.chance(0.65) : g.kind === 'teen' ? this.game.rng.chance(0.3) : this.game.rng.chance(0.08);
    this.anim(g, g.seated ? (cheer ? 'sit_cheer' : 'sit_clap') : cheer ? 'cheer' : 'clap');
    g.busyUntil = now + ticks;
    g.next = now + ticks;
  }

  /** A burst of clapping and whoops from the hall. */
  cheer(now, vol, big = false) {
    if (now < this.nextCheer && !big) return;
    this.nextCheer = now + 50;
    this.game.audio.play(SND.cheer, { x: 38.5 + (this.game.rng.next() - 0.5) * 16, y: 1.5, z: 20 + this.game.rng.next() * 8 }, null, { vol, pitch: 0.95 + this.game.rng.next() * 0.1 });
  }

  /** What a guest at its place does next (called every second or two, staggered). */
  think(g, now) {
    const rng = this.game.rng;
    const p = g.place;
    if (!p || this.state === 'closing') {
      g.next = now + 40;
      return;
    }
    const child = g.kind === 'child';
    g.next = now + (child ? rng.int(24, 60) : rng.int(40, 90));
    if (now < g.glanceUntil) return; // looking at a player
    if (this.watching(g)) {
      // the show: eyes on the stage, clapping along now and then
      if (now >= g.busyUntil && rng.chance(this.show === 'bow' ? 0.9 : child ? 0.3 : 0.2)) {
        this.applaud(g, now, rng.int(28, 60));
        this.cheer(now, 0.3 + rng.next() * 0.25);
      } else if (now >= g.busyUntil) {
        this.anim(g, g.seated ? 'sit' : child && rng.chance(0.2) ? 'point' : 'idle');
      }
      this.faceTo(g, { x: STAGE_FOCUS.x + (rng.next() - 0.5) * 10, y: STAGE_FOCUS.y, z: STAGE_FOCUS.z }, 48);
      return;
    }
    const mate = this.mate(g);
    if (p.kind === 'seat') {
      if (Math.abs(angleDiff(g.yaw, p.yaw)) > 4) {
        g.yaw = p.yaw; // turn back to the table after the show
        this.place(g);
      }
      const r = rng.next();
      if (r < 0.46) {
        this.anim(g, 'eat');
        this.look(g, rng.int(-12, 12), 14);
        g.next = now + rng.int(70, 150);
      } else if (r < 0.7 && mate) {
        this.anim(g, 'sit_talk');
        this.faceTo(g, { x: mate.x, y: mate.y + EYE * mate.s, z: mate.z }, 0);
      } else if (r < 0.76 && child) {
        this.anim(g, 'sit_cheer');
        g.next = now + rng.int(20, 36);
      } else {
        this.anim(g, 'sit');
        // look about: the table, the stage, the room
        if (rng.chance(0.3)) this.faceTo(g, STAGE_FOCUS, 0);
        else this.look(g, rng.int(-50, 50), rng.int(-4, 10));
      }
      return;
    }
    if (p.kind === 'arcade' || p.kind === 'skee') {
      const plays = child || g.kind === 'teen' || (g.n + Math.floor(now / 600)) % 2 === 0;
      this.anim(g, plays ? 'play' : rng.chance(0.25) ? 'point' : 'idle');
      if (plays || !mate) this.look(g, rng.int(-6, 6), p.kind === 'skee' ? 6 : -6);
      else this.faceTo(g, { x: mate.x, y: mate.y + 1, z: mate.z }, -1);
      return;
    }
    if (p.kind === 'stage') {
      // between shows: looking up at the band
      const r = rng.next();
      this.anim(g, r < (child ? 0.25 : 0.08) ? 'wave' : r < (child ? 0.45 : 0.2) ? 'point' : r < 0.5 && mate ? 'talk' : 'idle');
      this.faceTo(g, { x: STAGE_FOCUS.x + (rng.next() - 0.5) * 12, y: STAGE_FOCUS.y, z: STAGE_FOCUS.z }, 0);
      return;
    }
    // the prize counter, the ball pit, the podium
    const r = rng.next();
    const lively = p.kind === 'pit' && child;
    this.anim(g, r < (lively ? 0.3 : 0.05) ? 'cheer' : r < 0.42 ? 'point' : r < 0.62 && mate ? 'talk' : 'idle');
    if (g.props['fnar:anim'] === 'talk' && mate) this.faceTo(g, { x: mate.x, y: mate.y + EYE * mate.s, z: mate.z }, -1);
    else {
      if (Math.abs(angleDiff(g.yaw, p.yaw)) > 4) {
        g.yaw = p.yaw;
        this.place(g);
      }
      this.look(g, rng.int(-35, 35), p.kind === 'pit' ? 16 : rng.int(-6, 8));
    }
  }

  /** Someone of the same group to talk to (not walking). */
  mate(g) {
    const others = g.grp.members.filter((o) => o !== g && !o.walk && !o.gone && Math.hypot(o.x - g.x, o.z - g.z) < 5);
    return others.length ? this.game.rng.pick(others) : null;
  }

  // ================================================================ the crowd as a whole
  /** New groups keep coming while there is room. */
  arrivals(now) {
    if (now < this.nextArrival) return;
    const rng = this.game.rng;
    const n = this.list.length;
    this.nextArrival = now + (n < CROWD.min ? rng.int(90, 220) : rng.int(420, 900));
    if (n >= CROWD.max - 1) return;
    const grp = this.makeGroup(now, this.pickParty(CROWD.max - n, n < CROWD.min && rng.chance(0.6)));
    if (!grp) return;
    // come in where nobody is looking
    const seen = (id) => {
      const P = WAYPOINTS[id];
      let worst = 0;
      for (const p of this.game.players()) {
        try {
          const l = L(p.location);
          const dx = P.x - l.x;
          const dz = P.z - l.z;
          const d = Math.hypot(dx, dz);
          const v = p.getViewDirection();
          const facing = d > 1e-3 ? (dx * v.x + dz * v.z) / d : 1;
          worst = Math.max(worst, d < 14 ? 3 : facing > 0.3 && d < 72 ? 2 - d / 72 : 0);
        } catch {
          // a player who is leaving
        }
      }
      return worst;
    };
    const ranked = PORTALS.map((p) => ({ id: p.id, s: seen(p.id) - p.weight * 0.01 * rng.next() })).sort((a, b) => a.s - b.s);
    const unseen = ranked.filter((r) => r.s <= 0);
    const id = unseen.length ? rng.weighted(unseen.map((r) => [r.id, PORTALS.find((p) => p.id === r.id).weight])) : ranked[0].id;
    this.arrive(grp, now, anchorAt(this.graph, id));
    grp.portal = this.game.rng.chance(0.7) ? id : grp.portal; // most go home the way they came
  }

  /** Guests glance at a player who comes close, and sometimes wave. */
  noticePlayers(now) {
    for (const p of this.game.players()) {
      let l;
      try {
        l = L(p.location);
      } catch {
        continue;
      }
      for (const g of this.list) {
        const dx = l.x - g.x;
        const dz = l.z - g.z;
        if (Math.abs(dx) > 4 || Math.abs(dz) > 4 || Math.abs(l.y - g.y) > 2.5) continue;
        const d = Math.hypot(dx, dz);
        if (d > 3.8 || now < g.glanceUntil - 20 || g.slide || now < g.busyUntil) continue;
        if (this.watching(g) && !this.game.rng.chance(0.15)) continue; // the show is more interesting
        const head = { x: l.x, y: l.y + 1.62, z: l.z };
        if (g.walk) {
          // a look in passing: only the head
          if (!g.walk.going) continue;
          const rel = angleDiff(g.yaw, yawToward(dx, dz));
          if (Math.abs(rel) > 85) continue;
          this.look(g, rel, 0);
          g.glanceUntil = now + 16;
          continue;
        }
        if (!g.place || !this.game.rng.chance(0.5)) continue;
        g.glanceUntil = now + 40 + this.game.rng.int(0, 40);
        this.faceTo(g, head, g.seated ? 35 : -1);
        if (now >= g.waveAt && d < 3.2 && this.game.rng.chance(g.kind === 'child' ? 0.6 : 0.25)) {
          g.waveAt = now + 500 + this.game.rng.int(0, 400);
          this.anim(g, g.seated ? 'sit_wave' : 'wave');
          g.busyUntil = now + 36;
          g.glanceUntil = now + 44;
        }
        g.next = Math.min(Math.max(g.next, g.glanceUntil), now + 90);
      }
    }
  }

  /** The murmur of the room: louder the more people are in it. */
  murmur() {
    const audio = this.game.audio;
    for (const m of MURMUR) {
      const n = this.list.reduce((k, g) => k + (m.has(g) ? 1 : 0), 0);
      if (!n) {
        audio.stop(m.key);
        continue;
      }
      // a few voices are a murmur already; a full room is not much louder than a busy one
      const vol = Math.round((0.22 + 0.78 * Math.min(1, n / m.full) ** 0.7) * 100) / 100;
      audio.loop(m.key, SND.crowd, m.at, null, vol);
      const l = audio.loops.get(m.key);
      if (l) l.vol = vol; // a running loop takes the new level from its next repeat
    }
  }
}
