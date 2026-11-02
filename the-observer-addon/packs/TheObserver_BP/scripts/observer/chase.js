// @ts-check
// Driving its puppets (1.4.0). While it has a creature, the creature's own legs do nothing (observer/puppets.js keeps
// its own movement switched off); it moves it itself, here: straight at where it is going whenever the way is open,
// otherwise along a route it finds (world/path.js) — round walls, up steps and down drops, through doors it opens,
// up the face of a wall the way it climbs. Stuck for a moment, it twitches forward through the gap.
// The hunt: about as fast as someone sprinting (faster on High), quicker as it goes, and a lunge in the last few blocks;
// if the creature has no blow of its own that lands, it strikes through it. Its pack, when it lets several loose at
// once (its rage): one comes straight at you, one cuts you off where you are running to, and the rest wait in the
// doorways and gaps ahead of you.
import { system } from "@minecraft/server";
import { V, safe, emit } from "../core/util.js";
import { PARTICLES, SOUNDS } from "../core/constants.js";
import { aggression } from "../core/settings.js";
import { straight, plan, bodyCells, chokepoint } from "../world/path.js";
import { toggleOpenable } from "../world/manipulate.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {{x:number,y:number,z:number}} Vec */
/** @typedef {import("../world/path.js").PathNode} PathNode */
/**
 * @typedef {Object} Nav
 * @property {PathNode[]|undefined} path
 * @property {number} i
 * @property {Vec|undefined} goalAt   where the goal was when the route was found
 * @property {number} plannedAt
 * @property {boolean} pending
 * @property {boolean} direct
 * @property {number} checkedAt
 * @property {Vec|undefined} last     where it was at the last progress check
 * @property {number} lastAt
 * @property {number} blinkAt
 * @property {number} jumpAt
 * @property {number} lungeAt
 * @property {number} strikeAt
 * @property {number} hitAt           its own blow last landed on someone
 * @property {number} since           tick the hunt began (it is quicker as it goes)
 */

/** @returns {Nav} */
export const freshNav = () => ({ path: undefined, i: 0, goalAt: undefined, plannedAt: -1e9, pending: false, direct: false, checkedAt: -1e9,
  last: undefined, lastAt: 0, blinkAt: -1e9, jumpAt: -1e9, lungeAt: -1e9, strikeAt: -1e9, hitAt: -1e9, since: system.currentTick });

const wrap = (/** @type {number} */ d) => ((((d + 180) % 360) + 360) % 360) - 180;
const center = (/** @type {PathNode} */ n) => ({ x: n.x + 0.5, y: n.y, z: n.z + 0.5 });

/**
 * The speed it sets on a hunting puppet each tick: ground friction takes about a third of it, so this comes out at
 * about a sprint (5.8 blocks a second) on Standard and 6.6 on High (measured on a dedicated server).
 */
export function huntSpeed() {
  return aggression() >= 3 ? 0.48 : 0.42;
}

/**
 * Drive one of its puppets toward `goal` this tick. @param {any} pp a puppet (observer/puppets.js)
 * @param {Vec} goal @param {number} t
 * @param {{speed:number, stopAt?:number, turn?:number, climb?:boolean, doors?:boolean, look?:Vec}} o
 * @returns {number} how far it still is (horizontally)
 */
export function drive(pp, goal, t, o) {
  /** @type {Entity} */
  const e = pp.e;
  /** @type {Nav} */
  const nav = pp.nav ?? (pp.nav = freshNav());
  const dim = e.dimension;
  const loc = e.location;
  const d = V.hdist(loc, goal);
  const stopAt = o.stopAt ?? 1.2;
  const v = safe(() => e.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
  if (d <= stopAt && Math.abs(goal.y - loc.y) < 2) {
    if (v.x || v.z) safe(() => e.applyImpulse({ x: -v.x, y: 0, z: -v.z }));
    face(pp, V.yawTo(loc, o.look ?? goal), o.look, o.turn ?? 40);
    pp.moving = false;
    return d;
  }
  const h = bodyCells(e);
  // is the way straight there open? (every half second, or as soon as the goal moves off)
  const moved = !nav.goalAt || V.dist(nav.goalAt, goal) > 2.5;
  if (t - nav.checkedAt >= 10 || (moved && t - nav.checkedAt >= 4)) {
    nav.checkedAt = t;
    nav.direct = !!safe(() => straight(dim, loc, goal, h), false);
    const stale = !nav.path || nav.i >= nav.path.length || moved || t - nav.plannedAt > 80;
    if (!nav.direct && !nav.pending && stale) {
      nav.pending = true;
      const from = { ...loc }, to = { ...goal };
      plan(dim, from, to, { h, climb: o.climb === false ? 0 : 5, doors: o.doors !== false }, (path, reached) => {
        nav.pending = false;
        nav.path = path;
        nav.i = 0;
        nav.plannedAt = system.currentTick;
        nav.goalAt = to;
        emit("chase", { what: "route", id: pp.id, n: path?.length ?? 0, reached, climb: !!path?.some((x) => x.act === "climb"), door: !!path?.some((x) => x.act === "door") });
      });
    }
  }
  // where to head now: straight at it, or the next cell of the route
  let wp = goal;
  /** @type {PathNode|undefined} */
  let node;
  if (!nav.direct && nav.path && nav.i < nav.path.length) {
    const path = nav.path;
    while (nav.i < path.length) {
      const c = center(path[nav.i]);
      const nextCloser = nav.i + 1 < path.length && V.hdist(loc, center(path[nav.i + 1])) < V.hdist(loc, c) && Math.abs(path[nav.i + 1].y - loc.y) < 1.5;
      if ((V.hdist(loc, c) < 0.55 && Math.abs(c.y - loc.y) < 1.2) || nextCloser) nav.i++;
      else break;
    }
    node = path[nav.i];
    if (node) {
      wp = center(node);
      // pushed well off the route: find it again
      if (V.hdist(loc, wp) > 4) nav.plannedAt = -1e9;
    }
  }
  const look = o.look ?? goal;
  // a door on the way: open it as it comes up to it (put back afterwards, like its own)
  if (node && node.act === "door" && V.hdist(loc, wp) < 2.6) {
    for (const dy of [0, 1]) safe(() => toggleOpenable(dim, { x: node.x, y: node.y + dy, z: node.z }, 0, 15));
    node.act = undefined;
    emit("chase", { what: "door", id: pp.id });
  }
  const dir = V.flat(V.sub(wp, loc));
  let vy = 0;
  let speed = o.speed;
  // up the face of a wall: it climbs (staring up), then pulls itself over
  if (node && node.act === "climb" && node.y > loc.y + 0.4 && V.hdist(loc, wp) < 1.9) {
    vy = 0.3 - v.y;
    speed = 0.06;
    pp.climbing = true;
    if (t % 6 === 0) emit("chase", { what: "climb", id: pp.id, y: Math.round(loc.y * 10) / 10 });
  } else {
    pp.climbing = false;
    // a step up: a hop
    const up = (node ? node.y : goal.y) > loc.y + 0.45 && V.hdist(loc, wp) < 1.6;
    if (up && t - nav.jumpAt > 8 && safe(() => e.isOnGround, true)) {
      vy = 0.44 - v.y;
      nav.jumpAt = t;
    }
  }
  face(pp, V.yawTo(loc, wp), look, o.turn ?? 40);
  safe(() => e.applyImpulse({ x: dir.x * speed - v.x, y: vy, z: dir.z * speed - v.z }));
  pp.moving = true;
  // stuck a moment (a gap too low, a ledge, something in the way): it twitches forward through it
  if (t - nav.lastAt >= 16) {
    const stuck = nav.last && V.dist(nav.last, loc) < 0.45 && !pp.climbing;
    nav.last = { ...loc };
    nav.lastAt = t;
    if (stuck && t - nav.blinkAt > 16) blink(pp, goal, nav, t);
  }
  return d;
}

/** Turn it toward a yaw (at most `rate` degrees a tick), looking at `look`. @param {any} pp @param {number} want @param {Vec|undefined} look @param {number} rate */
export function face(pp, want, look, rate) {
  pp.yaw += Math.max(-rate, Math.min(rate, wrap(want - pp.yaw)));
  const head = safe(() => pp.e.getHeadLocation(), pp.e.location) ?? pp.e.location;
  const pitch = look ? Math.max(-45, Math.min(45, V.pitchTo(head, look))) : 0;
  safe(() => pp.e.setRotation({ x: pitch, y: pp.yaw }));
}

/** A twitch forward: a cell or two on along its route (or toward the goal), wherever there is room for it. @param {any} pp @param {Vec} goal @param {Nav} nav @param {number} t */
function blink(pp, goal, nav, t) {
  const e = pp.e;
  const dim = e.dimension;
  const loc = e.location;
  /** @type {Vec[]} */
  const tries = [];
  if (nav.path) for (let k = nav.i + 2; k >= nav.i; k--) if (nav.path[k]) tries.push(center(nav.path[k]));
  const dir = V.flat(V.sub(goal, loc));
  for (const s of [2, 1.5, 1]) tries.push({ x: Math.floor(loc.x + dir.x * s) + 0.5, y: Math.floor(loc.y + 0.05), z: Math.floor(loc.z + dir.z * s) + 0.5 });
  for (const to of tries) {
    if (V.hdist(to, loc) < 0.8 || V.hdist(to, loc) > 3.2) continue;
    const b = safe(() => dim.getBlock(to));
    const below = safe(() => dim.getBlock({ x: to.x, y: to.y - 1, z: to.z }));
    if (!b || !(b.isAir || !safe(() => b.isSolid, true)) || !below || below.isAir || below.isLiquid) continue;
    const ok = safe(() => {
      e.teleport(to, { facingLocation: { x: goal.x, y: goal.y + 1.5, z: goal.z } });
      return true;
    }, false);
    if (!ok) continue;
    nav.blinkAt = t;
    nav.plannedAt = -1e9;
    pp.at = { ...to };
    pp.yaw = V.yawTo(to, goal);
    safe(() => dim.spawnParticle(PARTICLES.puppetShred, loc));
    safe(() => dim.playSound(SOUNDS.crack, to, { volume: 0.5, pitch: 1.1 }));
    emit("chase", { what: "twitch", id: pp.id });
    return true;
  }
  return false;
}

/**
 * The hunt, one tick: at them, faster as it goes; a lunge when close; and if its own blow does not land, it strikes
 * through it. @param {any} pp @param {Player} p @param {Vec} goal where to go (them, or where its role sends it)
 * @param {number} t @param {boolean} atThem the goal is the player themselves
 */
export function hunt(pp, p, goal, t, atThem) {
  const nav = pp.nav ?? (pp.nav = freshNav());
  const ramp = Math.min(1, 0.75 + (t - nav.since) / 160);
  const eye = p.getHeadLocation();
  const d = drive(pp, goal, t, { speed: huntSpeed() * ramp, stopAt: atThem ? 1.1 : 0.8, turn: 45, look: eye });
  if (!atThem) return d;
  const e = pp.e;
  const dd = V.dist(e.location, p.location);
  // the lunge: the last few blocks in one bound
  if (dd < 3.4 && dd > 1.4 && t - nav.lungeAt > 30 && safe(() => e.isOnGround, false)) {
    nav.lungeAt = t;
    const dir = V.flat(V.sub(p.location, e.location));
    const v = safe(() => e.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
    safe(() => e.applyImpulse({ x: dir.x * 0.62 - v.x, y: 0.32, z: dir.z * 0.62 - v.z }));
    emit("chase", { what: "lunge", id: pp.id });
  }
  // within reach and its own blow has not landed for a while: it strikes through it
  if (dd < 2.1 && t - nav.hitAt > 30 && t - nav.strikeAt > 30) {
    nav.strikeAt = t;
    const dmg = aggression() >= 3 ? 6 : 4;
    const done = safe(() => p.applyDamage(dmg, { cause: /** @type {any} */ ("entityAttack"), damagingEntity: e }), false);
    emit("chase", { what: "strike", id: pp.id, player: p.name, dmg, done: !!done });
  }
  return d;
}

/**
 * Where a puppet of its pack goes, by its role. @param {any} pp @param {Player} p @param {Vec|undefined} driver where the
 * one coming straight at them is @param {number} t
 * @returns {{goal:Vec, atThem:boolean, wait?:boolean}}
 */
export function packGoal(pp, p, driver, t) {
  const loc = pp.e.location;
  const pl = p.location;
  const d = V.hdist(loc, pl);
  if (pp.role === "cutter" && d > 5) {
    // where they are running to: ahead of them by as long as it would take to get there
    const pv = safe(() => p.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
    const k = Math.min(30, d / 0.3);
    let lead = { x: pv.x * k, y: 0, z: pv.z * k };
    const ll = Math.hypot(lead.x, lead.z);
    if (ll > 10) lead = V.scale(lead, 10 / ll);
    return { goal: { x: pl.x + lead.x, y: pl.y, z: pl.z + lead.z }, atThem: ll < 1 };
  }
  if (pp.role === "blocker") {
    if (d < 4.5) {
      pp.role = "driver";
      emit("chase", { what: "role", id: pp.id, role: "driver", why: "close" });
      return { goal: pl, atThem: true };
    }
    // a doorway or a gap ahead of them (the way they are running — or, standing, away from the one coming at them),
    // looked for again now and then; one it has, it keeps until it finds a better one or they are well past it
    const pv = safe(() => p.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
    const moving = Math.hypot(pv.x, pv.z) > 0.05;
    const settled = driver && V.hdist(driver, pl) > 3;
    if (!pp.post || (t - (pp.postAt ?? 0) > 60 && (moving || settled))) {
      pp.postAt = t;
      const run = moving ? V.flat(pv) : driver ? V.flat(V.sub(pl, driver)) : V.flat(V.sub(pl, loc));
      const post = safe(() => chokepoint(p.dimension, pl, run));
      if (post) {
        if (!pp.post || V.dist(post, pp.post) > 1.5) emit("chase", { what: "post", id: pp.id, x: post.x, y: post.y, z: post.z });
        pp.post = post;
      }
    }
    // they are well past it (or it is far behind them): no use waiting there
    if (pp.post && V.hdist(pl, pp.post) > 18) pp.post = undefined;
    if (pp.post) return { goal: pp.post, atThem: false, wait: V.hdist(loc, pp.post) < 0.9 };
    pp.role = "cutter";
    return packGoal(pp, p, driver, t);
  }
  return { goal: pl, atThem: true };
}

/** Its own blow landed on someone (the strike through it is not needed for a while). @param {any} pp @param {number} t */
export function landed(pp, t) {
  const nav = pp.nav ?? (pp.nav = freshNav());
  nav.hitAt = t;
}
