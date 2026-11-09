// @ts-check
import { world, system, ItemStack } from '@minecraft/server';
import { ACT, ACT_SECONDS } from '../generated/acts.js';
import { now, sec, valid, sub, len, lenXZ, norm, add, floor3, center, dist, yawTo, dirFromYaw, rand, chance, reportError, OVERWORLD, safe } from '../core/util.js';
import { config } from '../core/config.js';
import { BlockCache, WalkMap, lightAt, lineOfSight, perceive, bodyPoints } from '../world/space.js';
import { canBreak } from '../world/protection.js';
import { playAt } from '../audio.js';
import { log } from '../core/log.js';

export const SB_ID = 'shaftbreaker:shaftbreaker';
export const PHASES = ['dormant', 'stalking', 'watching', 'breaker', 'frenzy'];
/** movement speeds in blocks per tick */
export const SPEED = { creep: 0.055, stalk: 0.085, walk: 0.115, fast: 0.18, scramble: 0.21, rage: 0.34 };   // rage is faster than a sprinting player (0.28)

/** does any player in range currently see the creature? */
export function seenByAnyone(cr, maxDist = 64) {
  if (!cr || !valid(cr.e)) return false;
  const pts = bodyPoints(cr.loc, cr.stance);
  for (const p of cr.dim.getPlayers({ location: cr.loc, maxDistance: maxDist })) {
    const s = perceive(p, pts);
    if (s.visible && s.angle < 60) return true;
  }
  return false;
}

/** The one and only Shaftbreaker (world singleton). */
export class Creature {
  /** @param {import('@minecraft/server').Entity} entity */
  constructor(entity) {
    this.e = entity;
    this.dim = entity.dimension;
    this.mode = 'still';
    this.phase = 'dormant';
    this.act = 0;
    this.actUntil = 0;
    this.stance = 0;
    this.grav = true;
    this.nav = 'walk';
    this.goal = null;        // movement target
    this.path = null;        // validated cell centres to follow
    this.pathI = 0;
    this.job = null;         // incremental path search
    this.speed = SPEED.walk;
    this.faceTarget = null;  // keep facing this while moving (backward retreat)
    this.gain = 1.0;         // adaptive physics gain
    this.slowTicks = 0;
    this.stepMode = false;   // path-stepping fallback when physics stalls
    this.movingProp = 0;
    this.chaseTarget = null; // scripted pursuit (harmless preview / engine fallback)
    this.lastEngineHit = 0;
    this.relocator = null;   // brain hook: returns a hidden spot or null
    this.manual = false;     // spawned by egg/summon: stalks whoever is nearest, anywhere
    this.hiddenSince = 0;
    this.nextSqueeze = 0;
    this.chaseSpeed = 0;
    this.nextChasePlan = 0;
    /** @type {{x:number,y:number,z:number}|null} */
    this.prevStep = null;
    this.lastPos = entity.location;
    this.lastMoveCheck = now();
    this.stuckTicks = 0;
    this.spawnTick = now();
    this.broken = 0;         // blocks broken this encounter
    this.nextBreak = 0;
    this.defeated = false;
    this.safeChase = null;   // harmless-preview chase target
    this.resumeMode = null;  // movement mode to restore after a rooted act
    this.lockStance = false;
    this.rage = false;       // rage chase: faster engine mode, scripted fallback at rage speed
  }

  get valid() { return valid(this.e) && !this.defeated; }
  get loc() { try { return this.e.location; } catch { return this.lastPos; } }

  // ---------------------------------------------------------------- state setters
  setPhase(p) {
    if (this.phase === p) return;
    this.phase = p;
    safe('setPhase', () => this.e.setProperty('shaftbreaker:phase', p));
  }

  /** play an act; one-shots auto-clear after their clip length unless `hold` */
  setAct(act, hold = false) {
    // knock-down recoveries root the body for their length, then the previous movement mode resumes
    if ((act === ACT.RECOVER || act === ACT.RECOVER_MIRROR) && this.mode !== 'scripted' && this.mode !== 'defeated') {
      this.resumeMode = this.mode;
      this.halt();
    }
    this.act = act;
    const name = Object.keys(ACT).find((k) => ACT[k] === act);
    const secs = name && ACT_SECONDS[name];
    this.actUntil = act && secs && !hold ? now() + sec(secs) : 0;
    safe('setAct', () => this.e.setProperty('shaftbreaker:act', act));
  }

  clearAct() { if (this.act !== 0) this.setAct(0); }

  setEyes(v) { safe('eyes', () => this.e.setProperty('shaftbreaker:eyes', Math.max(0, Math.min(1, v)))); }
  setSpectral(b) { safe('spectral', () => this.e.setProperty('shaftbreaker:spectral', !!b)); }
  setGait(g) { safe('gait', () => this.e.setProperty('shaftbreaker:gait', g)); }

  setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    safe('mode', () => this.e.triggerEvent(`sb:mode_${m}`));
    if (m === 'hunt' || m === 'frenzy' || m === 'rage') this.stop();
  }

  setGravity(on) { if (this.grav === on) return; this.grav = on; safe('grav', () => this.e.triggerEvent(on ? 'sb:grav_on' : 'sb:grav_off')); }

  setNav(n) { if (this.nav === n) return; this.nav = n; safe('nav', () => this.e.triggerEvent(`sb:nav_${n}`)); }

  // ---------------------------------------------------------------- facing & movement
  face(pos) {
    safe('face', () => {
      const l = this.e.location;
      this.e.setRotation({ x: 0, y: yawTo(l, pos) });
    });
  }

  /**
   * Walk to a position along cells proven walkable (incremental search from the creature's own feet).
   * @param {{x:number,y:number,z:number}} pos
   * @param {boolean|number} speed true = fast, false = walk, or blocks per tick
   */
  moveTo(pos, speed = false, faceTarget = null) {
    if (!this.goal || dist(this.goal, pos) > 1.5) this.replans = 0;
    this.goal = { x: pos.x, y: pos.y, z: pos.z };
    this.speed = typeof speed === 'number' ? speed : speed ? SPEED.fast : SPEED.walk;
    this.faceTarget = faceTarget;
    this.path = null; this.pathI = 0; this.stepMode = false; this.slowTicks = 0; this.stuckTicks = 0;
    const g = floor3(pos);
    this.job = new WalkMap(this.dim, this.loc, { maxNodes: 1600, maxDist: 64, goal: (n) => Math.abs(n.x - g.x) + Math.abs(n.z - g.z) <= 1 && Math.abs(n.y - g.y) <= 1 });
    if (this.mode !== 'scripted' && this.mode !== 'still') { this.mode = ''; }
    this.setMode('scripted');
  }

  stop() {
    this.goal = null; this.path = null; this.job = null; this.chaseTarget = null; this.faceTarget = null;
    this.setMoving(0);
  }

  /** stop moving and hold position under script control (for posed acts) */
  halt() { this.stop(); this.setMode('scripted'); }

  get moving() { return !!(this.job || (this.path && this.pathI < this.path.length)); }

  arrived(r = 1.4) {
    if (!this.goal) return true;
    const l = this.loc;
    return lenXZ(sub(l, this.goal)) < r && Math.abs(l.y - this.goal.y) < 2.2;
  }

  /** follow an explicit validated path (backward retreat, creeping) */
  stepAlong(cells, facePos, speed = 0.07) {
    this.setMode('scripted');
    this.job = null;
    this.path = cells.map(center); this.pathI = 0;
    this.goal = this.path[this.path.length - 1] || null;
    this.faceTarget = facePos; this.speed = speed; this.stepMode = false; this.slowTicks = 0;
  }

  setMoving(v) {
    const q = Math.round(v * 4) / 4;
    if (q === this.movingProp) return;
    this.movingProp = q;
    safe('moving', () => this.e.setProperty('shaftbreaker:moving', q));
  }

  tickMover() {
    if (this.job) {
      this.job.step(160);
      if (!this.job.done) return;
      const m = this.job; this.job = null;
      let end = m.found;
      if (!end && this.goal) {           // unreachable exactly: go as close as the real cave allows
        let best = Infinity;
        for (const n of m.nodes.values()) { const d = Math.abs(n.x + 0.5 - this.goal.x) + Math.abs(n.z + 0.5 - this.goal.z) + Math.abs(n.y - this.goal.y) * 1.5; if (d < best) { best = d; end = n; } }
      }
      this.path = end ? m.pathTo(end).map(center) : [];
      this.pathI = this.path.length > 1 ? 1 : 0;
      if (!this.path.length) { this.goal = null; this.setMoving(0); }
      return;
    }
    if (!this.path) return;
    if (this.pathI >= this.path.length) { this.path = null; this.setMoving(0); return; }
    const l = this.loc;
    const tgt = this.path[this.pathI];
    const d = sub(tgt, l);
    const dl = lenXZ(d);
    if (dl < 0.32 && Math.abs(d.y) < 1.2) { this.pathI++; return; }
    const n = norm({ x: d.x, y: 0, z: d.z });
    // face movement (or the watched target), turning at most 25 degrees per tick
    const want = this.faceTarget ? yawTo(l, this.faceTarget) : yawTo(l, tgt);
    safe('turn', () => {
      const cur = this.e.getRotation().y;
      const diff = ((want - cur + 540) % 360) - 180;
      this.e.setRotation({ x: 0, y: cur + Math.max(-25, Math.min(25, diff)) });
    });
    this.setMoving(Math.min(1, this.speed / 0.12));
    if (this.stepMode) {               // fallback: step along the validated path (never into solid cells)
      const stepLen = Math.min(this.speed, dl);
      const ny = d.y > 0.05 ? tgt.y : (d.y < -0.05 && dl < 0.55 ? tgt.y : l.y);
      const np = { x: l.x + n.x * stepLen, y: ny, z: l.z + n.z * stepLen };
      // the world may have changed since the path was planned (a block placed, a den grown): re-plan instead
      const fc = floor3({ x: np.x, y: np.y + 0.05, z: np.z });
      const c = new BlockCache(this.dim);
      if (!c.passable(fc.x, fc.y, fc.z) || (this.stance !== 2 && !c.passable(fc.x, fc.y + 1, fc.z))) {
        const g = this.goal; const sp = this.speed; const ft = this.faceTarget;
        if (g && (this.replans = (this.replans || 0) + 1) <= 4) this.moveTo(g, sp, ft); else { this.stop(); this.replans = 0; }
        return;
      }
      safe('step', () => this.e.teleport(np, { keepVelocity: false }));
      return;
    }
    // physics steering with adaptive gain (friction differs between surfaces and versions)
    const prev = this.prevStep;
    if (prev) {
      const moved = lenXZ(sub(l, prev));
      const expect = this.speed;
      if (moved < expect * 0.3) this.slowTicks++; else this.slowTicks = Math.max(0, this.slowTicks - 2);
      this.gain = Math.max(0.6, Math.min(3.2, this.gain * Math.pow(expect / Math.max(moved, 0.01), 0.25)));
      if (this.slowTicks > 10) { this.stepMode = true; this.slowTicks = 0; }
    }
    this.prevStep = { x: l.x, y: l.y, z: l.z };
    let onGround = true; try { onGround = this.e.isOnGround; } catch { /* ignore */ }
    const jump = d.y > 0.5 && onGround && dl < 1.4 ? 0.42 : 0;
    safe('impulse', () => {
      const v = this.e.getVelocity();
      this.e.clearVelocity();
      this.e.applyImpulse({ x: n.x * this.speed * this.gain, y: jump || v.y, z: n.z * this.speed * this.gain });
    });
  }

  /** scripted pursuit of a player (harmless preview, or when engine navigation stalls) */
  chase(player, speed = SPEED.fast) {
    this.chaseTarget = player;
    this.chaseSpeed = speed;
    this.nextChasePlan = 0;
  }

  tickChase(t) {
    const p = this.chaseTarget;
    if (!p) return;
    if (!valid(p)) { this.chaseTarget = null; return; }
    if (t >= (this.nextChasePlan || 0)) {
      this.nextChasePlan = t + 15;
      const keep = this.chaseTarget;
      this.moveTo(p.location, this.chaseSpeed || SPEED.fast);
      this.chaseTarget = keep;
    }
  }

  // ---------------------------------------------------------------- hunt target
  huntTarget(player, frenzy = false) {
    if (config().harmless || !isDamageable(player)) {  // harmless preview / creative: a chase with no attack goal at all
      this.safeChase = player;
      this.chase(player, this.rage ? SPEED.rage : frenzy ? SPEED.scramble : SPEED.fast);
      return;
    }
    this.safeChase = null;
    for (const p of world.getAllPlayers()) if (p.id !== player.id) safe('untag', () => p.removeTag('sb_target'));
    safe('tag', () => player.addTag('sb_target'));
    this.setMode(frenzy ? (this.rage ? 'rage' : 'frenzy') : 'hunt');
  }

  releaseTarget() {
    this.safeChase = null;
    this.chaseTarget = null;
    for (const p of world.getAllPlayers()) safe('untag', () => p.removeTag('sb_target'));
  }

  // ---------------------------------------------------------------- per tick maintenance
  tick() {
    if (!valid(this.e)) return;
    const t = now();
    if (!this.defeated) {
      let d = false;
      try { d = !!this.e.getProperty('shaftbreaker:defeated'); } catch { /* ignore */ }
      if (d) { this.beginDefeat(); return; }
    }
    if (this.actUntil && t >= this.actUntil) {
      this.actUntil = 0;
      if (this.act) this.setAct(0);
      if (this.resumeMode && this.mode === 'scripted') { const m = this.resumeMode; this.resumeMode = null; this.mode = ''; this.setMode(m); }
    }
    if (this.chaseTarget) this.tickChase(t);
    if (this.mode === 'scripted') this.tickMover();
    else if (this.movingProp) this.setMoving(0);
    if (t % 4 === 0 && !this.lockStance) this.updateStance();
    if (t % 20 === 0) this.updateStuck();
    if (t % 5 === 0) this.updateClimb();
    if (t % 10 === 0) this.updateSqueeze(t);
  }

  updateStance() {
    if (this.act === ACT.CEILING_HANG || this.act === ACT.CEILING_REACH || this.act === ACT.CRAWL || this.act === ACT.SCRAMBLE) return;
    const c = new BlockCache(this.dim);
    const l = floor3(this.loc);
    let h = c.headroom(l.x, l.y, l.z);
    // look ahead along a scripted path: drop to a crawl before reaching a one-block gap
    if (this.path && this.pathI < this.path.length) {
      for (let i = this.pathI; i < Math.min(this.path.length, this.pathI + 2); i++) {
        const q = floor3(this.path[i]);
        if (lenXZ(sub(this.path[i], this.loc)) < 2.2) h = Math.min(h, Math.max(1, c.headroom(q.x, q.y, q.z)));
      }
    }
    try {
      const v = this.e.getVelocity();
      if (lenXZ(v) > 0.05) {
        const a = floor3(add(this.loc, { x: v.x * 10, y: 0, z: v.z * 10 }));
        h = Math.min(h, Math.max(1, c.headroom(a.x, l.y, a.z)));
      }
    } catch { /* ignore */ }
    const want = h <= 1 ? 2 : h === 2 ? 1 : 0;
    if (want === this.stance) return;
    if (this.stance === 2 && want < 2 && h < 2) return;
    this.stance = want;
    safe('stance', () => {
      this.e.setProperty('shaftbreaker:stance', want);
      this.e.triggerEvent(want === 2 ? 'sb:stance_crawl' : want === 1 ? 'sb:stance_crouch' : 'sb:stance_stand');
    });
  }

  updateStuck() {
    const l = this.loc;
    const moving = this.mode === 'hunt' || this.mode === 'frenzy' || this.mode === 'rage' || (this.mode === 'scripted' && this.moving);
    const moved = lenXZ(sub(l, this.lastPos)) + Math.abs(l.y - this.lastPos.y) * 0.5;
    this.lastPos = { x: l.x, y: l.y, z: l.z };
    if (!moving) { this.stuckTicks = 0; return; }
    if (moved < 0.35) this.stuckTicks += 20; else this.stuckTicks = Math.max(0, this.stuckTicks - 30);
  }

  updateClimb() {
    if (this.act && this.act !== ACT.CLIMB) return;
    let v; try { v = this.e.getVelocity(); } catch { return; }
    let onGround = true; try { onGround = this.e.isOnGround; } catch { /* ignore */ }
    const climbing = !onGround && v.y > 0.06 && (this.nav === 'climb' || safe('climb', () => this.e.isClimbing, false));
    if (climbing && this.act !== ACT.CLIMB) this.setAct(ACT.CLIMB, true);
    else if (!climbing && this.act === ACT.CLIMB && onGround) this.setAct(0);
  }

  /** N22: twist the shoulders through a one-wide gap (animation only; collision is unchanged, no phasing) */
  updateSqueeze(t) {
    if (this.act || this.stance !== 0 || t < (this.nextSqueeze || 0)) return;
    if (!(this.moving || this.mode === 'hunt')) return;
    let v; try { v = this.e.getVelocity(); } catch { return; }
    if (lenXZ(v) < 0.04) return;
    const c = new BlockCache(this.dim);
    const l = floor3(this.loc);
    const along = Math.abs(v.x) > Math.abs(v.z) ? 'x' : 'z';
    const walls = along === 'x' ? !c.passable(l.x, l.y + 1, l.z + 1) && !c.passable(l.x, l.y + 1, l.z - 1)
      : !c.passable(l.x + 1, l.y + 1, l.z) && !c.passable(l.x - 1, l.y + 1, l.z);
    if (walls) { this.nextSqueeze = t + sec(8); this.setAct(ACT.SQUEEZE); }
  }

  get stuck() { return this.stuckTicks >= 60; }

  // ---------------------------------------------------------------- Breaker: protected, telegraphed block clearing
  /** try to open a path toward pos; returns true when a break was started */
  breakToward(pos, onDone) {
    const cfg = config();
    if (cfg.harmless || cfg.blockDestruction === 'off') return false;
    const t = now();
    if (t < this.nextBreak || this.broken >= 14) return false;
    const l = this.loc;
    const d = sub(pos, l);
    const ax = Math.abs(d.x) > Math.abs(d.z) ? { x: Math.sign(d.x), z: 0 } : { x: 0, z: Math.sign(d.z) };
    const base = floor3(l);
    const front = { x: base.x + ax.x, y: base.y, z: base.z + ax.z };
    const rise = d.y > 1.5 ? 1 : d.y < -1.5 ? -1 : 0;
    const targets = [{ x: front.x, y: front.y + rise, z: front.z }, { x: front.x, y: front.y + rise + 1, z: front.z }];
    if (rise > 0) targets.push({ x: base.x, y: base.y + 2, z: base.z });
    const breakable = [];
    for (const b of targets) {
      let id = '';
      try { id = this.dim.getBlock(b)?.typeId ?? ''; } catch { /* ignore */ }
      if (!id || id === 'minecraft:air' || id.startsWith('minecraft:light_block')) continue;
      if (canBreak(this.dim, b)) breakable.push(b); else return false; // a protected block is in the way: do not dig around it
    }
    if (!breakable.length) return false;
    this.nextBreak = t + sec(1.8);
    this.face(pos);
    this.halt();
    this.setAct(ACT.BREAK_STRIKE);
    // tell: scrape + falling grit before the change
    playAt(this.dim, 'shaftbreaker.scrape', l, 0.9, rand(0.85, 1.0));
    safe('grit', () => this.dim.spawnParticle('shaftbreaker:dust_fall', { x: front.x + 0.5, y: front.y + 2.2, z: front.z + 0.5 }));
    system.runTimeout(() => {
      if (!this.valid) return;
      for (const b of breakable) {
        if (!canBreak(this.dim, b)) continue;
        safe('break', () => this.dim.runCommand(`setblock ${b.x} ${b.y} ${b.z} air destroy`));
        safe('debris', () => this.dim.spawnParticle('shaftbreaker:debris', center(b)));
        this.broken++;
      }
      playAt(this.dim, 'shaftbreaker.smash', l, 1.0, rand(0.85, 1.05));
      log('verbose', `breaker opened ${breakable.length} block(s)`);
    }, sec(0.75));
    system.runTimeout(() => { if (this.valid && onDone) onDone(); }, sec(1.3));
    return true;
  }

  // ---------------------------------------------------------------- damage (fair, telegraphed)
  /** applies damage only if config/grace allow it; returns true if it landed */
  strike(player, amount, canHit) {
    if (config().harmless || !this.valid) return false;
    if (canHit && !canHit(player)) return false;
    // fairness: a strike never passes through walls or closed doors
    const l = this.loc; const p = player.location;
    if (!lineOfSight(this.dim, { x: l.x, y: l.y + 1.3, z: l.z }, { x: p.x, y: p.y + 0.9, z: p.z })) return false;
    return !!safe('strike', () => player.applyDamage(amount, { cause: /** @type {any} */ ('entityAttack'), damagingEntity: this.e }), false);
  }

  /** player inside the frontal arc at the moment of the hit frame */
  inFront(player, range, arc = 70) {
    const l = this.loc; const p = player.location;
    if (dist(l, p) > range || Math.abs(p.y - l.y) > 2.6) return false;
    let yaw = 0; try { yaw = this.e.getRotation().y; } catch { /* ignore */ }
    const f = dirFromYaw(yaw);
    const to = norm({ x: p.x - l.x, y: 0, z: p.z - l.z });
    return Math.acos(Math.max(-1, Math.min(1, f.x * to.x + f.z * to.z))) * 57.3 <= arc;
  }

  // ---------------------------------------------------------------- endings
  /**
   * Disappear from the players' point of view. The creature persists: if it is unseen it simply stays
   * in the dark; if it is seen (or a visible vanish is requested) it is relocated to a hidden spot and the
   * old position gets the vanish effect. Only when no hidden spot exists is it removed.
   */
  vanish(quiet = false) {
    if (!valid(this.e) || this.defeated) return;
    const l = this.loc;
    this.releaseTarget(); this.stop(); this.clearAct(); this.setGait(0); this.setSpectral(false);
    this.setGravity(true); this.lockStance = false;
    const watched = seenByAnyone(this);
    if (!quiet || watched) {
      playAt(this.dim, 'shaftbreaker.vanish', l, 0.6, rand(0.9, 1.1));
      safe('vanishFx', () => this.dim.spawnParticle('shaftbreaker:vanish', l));
      const spot = this.relocator ? safe('relocate', () => this.relocator(), null) : null;
      if (!spot) { this.despawn(); return; }
      safe('relocateTp', () => this.e.teleport(spot, { keepVelocity: false }));
    }
    this.setPhase('stalking');
    this.setMode('still');
    this.hiddenSince = now();
  }

  /** really remove it (withdrawal, defeat, commands) */
  despawn() {
    this.releaseTarget(); this.stop();
    safe('remove', () => valid(this.e) && this.e.remove());
  }

  beginDefeat() {
    if (this.defeated) return;
    this.defeated = true;
    this.releaseTarget();
    this.stop();
    const e = this.e;
    const dim = this.dim;
    safe('defeatAct', () => { e.setProperty('shaftbreaker:act', ACT.COLLAPSE); e.setProperty('shaftbreaker:eyes', 0.35); });
    onDefeatHandlers.forEach((h) => safe('onDefeat', () => h(this)));
    system.runTimeout(() => {
      if (!valid(e)) return;
      const l = e.location;
      safe('defeatEyes', () => e.setProperty('shaftbreaker:eyes', 0.0));
      dropLoot(dim, l);
      safe('fx', () => dim.spawnParticle('shaftbreaker:vanish', l));
      playAt(dim, 'shaftbreaker.vanish', l, 0.8, 0.8);
      system.runTimeout(() => safe('defeatRemove', () => valid(e) && e.remove()), sec(0.6));
    }, sec(3.6));
  }
}

const onDefeatHandlers = [];
export function onDefeat(fn) { onDefeatHandlers.push(fn); }

export function dropLoot(dim, l) {
  const cfg = config();
  safe('loot', () => {
    if (cfg.trophyDrop) dim.spawnItem(new ItemStack('shaftbreaker:shaftbreaker_skull', 1), l);
    dim.spawnItem(new ItemStack('minecraft:bone', 2 + Math.floor(Math.random() * 3)), l);
    dim.spawnItem(new ItemStack('shaftbreaker:resonance_shard', 1 + Math.floor(Math.random() * 3)), l);
  });
}

// ---------------------------------------------------------------- singleton management
/** @type {Creature|null} */
let current = null;

export function creature() { return current && valid(current.e) ? current : null; }

/** spawn the single primary Shaftbreaker (removes any stray copies first) */
export function spawnCreature(dim, pos, opts = {}) {
  despawnAll(true);
  let e;
  try { e = dim.spawnEntity(SB_ID, pos); } catch (err) { reportError('spawn', err); return null; }
  current = new Creature(e);
  safe('mark', () => e.setDynamicProperty('sb:scripted', true));
  safe('initProps', () => {
    e.setProperty('shaftbreaker:phase', opts.phase || 'dormant');
    e.setProperty('shaftbreaker:act', opts.act || 0);
    e.setProperty('shaftbreaker:eyes', opts.eyes ?? 0.85);
    e.setProperty('shaftbreaker:spectral', !!opts.spectral);
  });
  current.phase = opts.phase || 'dormant';
  current.act = opts.act || 0;
  if (opts.face) current.face(opts.face);
  current.setMode(opts.mode || 'still');
  if (opts.mode === undefined) { current.mode = 'still'; }
  log('basic', `spawned at ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)} (light ${lightAt(dim, pos)})`);
  return current;
}

/** adopt an egg-spawned creature as the primary (newest wins) */
export function adopt(entity) {
  if (current && valid(current.e) && current.e.id !== entity.id) safe('replace', () => current.despawn());
  current = new Creature(entity);
  current.manual = true;               // spawn egg / summon: it stays and stalks whoever is nearest
  return current;
}

export function despawnAll(quiet = true) {
  if (current) { try { if (!quiet) current.vanish(false); current.despawn(); } catch { /* ignore */ } }
  current = null;
  safe('sweep', () => {
    const dim = world.getDimension(OVERWORLD);
    for (const e of dim.getEntities({ type: SB_ID })) e.remove();
  });
}

export function tickCreature() {
  if (current && !valid(current.e)) current = null;
  if (current) current.tick();
}

/** creative/spectator players cannot be damaged: hunts against them are harmless chases */
export function isDamageable(player) {
  try { const g = String(player.getGameMode()).toLowerCase(); return g === 'survival' || g === 'adventure'; } catch { return true; }
}
