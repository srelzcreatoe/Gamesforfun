// @ts-check
import { world, system, ItemStack } from '@minecraft/server';
import { ACT, ACT_SECONDS } from '../generated/acts.js';
import { now, sec, valid, sub, len, lenXZ, norm, add, floor3, center, dist, yawTo, dirFromYaw, rand, chance, reportError, OVERWORLD, safe } from '../core/util.js';
import { config } from '../core/config.js';
import { BlockCache, lightAt, lineOfSight } from '../world/space.js';
import { canBreak } from '../world/protection.js';
import { playAt } from '../audio.js';
import { log } from '../core/log.js';

export const SB_ID = 'shaftbreaker:shaftbreaker';
export const WP_ID = 'shaftbreaker:waypoint';
export const PHASES = ['dormant', 'stalking', 'watching', 'breaker', 'frenzy'];

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
    this.wp = null;          // waypoint entity
    this.goal = null;        // waypoint target position
    this.lastPos = entity.location;
    this.lastMoveCheck = now();
    this.stuckTicks = 0;
    this.spawnTick = now();
    this.broken = 0;         // blocks broken this encounter
    this.nextBreak = 0;
    this.defeated = false;
    this.manualStep = null;  // scripted stepping (backward retreat)
    this.safeChase = null;   // harmless-preview chase target
    this.resumeMode = null;  // movement mode to restore after a rooted act
    this.lockStance = false;
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
      this.setMode('scripted');
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
    if (m !== 'travel' && m !== 'travel_fast') this.clearWaypoint();
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

  /** walk (real pathfinding) to a position using the invisible waypoint lure */
  moveTo(pos, fast = false) {
    this.goal = { x: pos.x, y: pos.y, z: pos.z };
    this.manualStep = null;
    safe('moveTo', () => {
      if (!valid(this.wp)) {
        this.wp = this.dim.spawnEntity(WP_ID, { x: pos.x, y: pos.y + 0.1, z: pos.z });
      } else {
        this.wp.teleport({ x: pos.x, y: pos.y + 0.1, z: pos.z });
      }
    });
    this.mode = '';
    this.setMode(fast ? 'travel_fast' : 'travel');
    this.stuckTicks = 0;
  }

  arrived(r = 1.4) {
    if (!this.goal) return true;
    const l = this.loc;
    return lenXZ(sub(l, this.goal)) < r && Math.abs(l.y - this.goal.y) < 2.2;
  }

  clearWaypoint() {
    if (valid(this.wp)) safe('wpRemove', () => this.wp.remove());
    this.wp = null; this.goal = null;
  }

  /**
   * Scripted slow stepping along a validated path (backward retreat, creeping).
   * Every step stays inside cells the walk-map proved to be open: no phasing.
   * @param {{x:number,y:number,z:number}[]} cells path cells (feet positions)
   * @param {{x:number,y:number,z:number}|null} facePos keep facing this point
   * @param {number} speed blocks per tick
   */
  stepAlong(cells, facePos, speed = 0.07) {
    this.setMode('scripted');
    this.manualStep = { cells: cells.map(center), i: 0, facePos, speed };
  }

  tickManualStep() {
    const ms = this.manualStep;
    if (!ms) return;
    const l = this.loc;
    const tgt = ms.cells[ms.i];
    if (!tgt) { this.manualStep = null; return; }
    const d = sub(tgt, l);
    const dl = lenXZ(d);
    if (dl < 0.15) { ms.i++; if (ms.i >= ms.cells.length) this.manualStep = null; return; }
    const stepLen = Math.min(ms.speed, dl);
    const n = norm({ x: d.x, y: 0, z: d.z });
    const ny = d.y > 0.05 ? tgt.y : (d.y < -0.05 && dl < 0.55 ? tgt.y : l.y);   // step up at once, step down only above the lower cell
    const next = { x: l.x + n.x * stepLen, y: ny, z: l.z + n.z * stepLen };
    safe('step', () => this.e.teleport(next, ms.facePos ? { facingLocation: ms.facePos, keepVelocity: false } : { keepVelocity: false }));
  }

  // ---------------------------------------------------------------- hunt target
  huntTarget(player, frenzy = false) {
    if (config().harmless) {                       // harmless preview: chase with the lure only, no attack goal exists
      this.safeChase = player;
      this.moveTo(player.location, true);
      return;
    }
    this.safeChase = null;
    for (const p of world.getAllPlayers()) if (p.id !== player.id) safe('untag', () => p.removeTag('sb_target'));
    safe('tag', () => player.addTag('sb_target'));
    this.setMode(frenzy ? 'frenzy' : 'hunt');
  }

  releaseTarget() {
    this.safeChase = null;
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
    if (this.manualStep) this.tickManualStep();
    if (this.safeChase && t % 10 === 0) {
      if (valid(this.safeChase) && (this.mode === 'travel_fast' || this.mode === 'travel')) this.moveTo(this.safeChase.location, true);
      else this.safeChase = null;
    }
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
    const moving = this.mode === 'travel' || this.mode === 'travel_fast' || this.mode === 'hunt' || this.mode === 'frenzy';
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
    if (!(this.mode === 'travel' || this.mode === 'travel_fast' || this.mode === 'hunt')) return;
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
    this.setMode('scripted');
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
  /** controlled vanish (only call when unobserved or as a last-resort despawn) */
  vanish(quiet = false) {
    if (!valid(this.e)) return;
    const l = this.loc;
    if (!quiet) {
      playAt(this.dim, 'shaftbreaker.vanish', l, 0.6, rand(0.9, 1.1));
      safe('vanishFx', () => this.dim.spawnParticle('shaftbreaker:vanish', l));
    }
    this.clearWaypoint();
    this.releaseTarget();
    safe('remove', () => this.e.remove());
  }

  beginDefeat() {
    if (this.defeated) return;
    this.defeated = true;
    this.clearWaypoint();
    this.releaseTarget();
    this.manualStep = null;
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
  if (current && valid(current.e) && current.e.id !== entity.id) safe('replace', () => current.vanish(true));
  current = new Creature(entity);
  return current;
}

export function despawnAll(quiet = true) {
  if (current) { try { current.vanish(quiet); } catch { /* ignore */ } }
  current = null;
  safe('sweep', () => {
    const dim = world.getDimension(OVERWORLD);
    for (const e of dim.getEntities({ type: SB_ID })) e.remove();
    for (const e of dim.getEntities({ type: WP_ID })) e.remove();
  });
}

export function tickCreature() {
  if (current && !valid(current.e)) {
    if (valid(current.wp)) safe('wpOrphan', () => current.wp.remove());
    current = null;
  }
  if (current) current.tick();
}
