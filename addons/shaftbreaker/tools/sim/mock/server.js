// Minimal behavioural mock of @minecraft/server for offline simulation of the Shaftbreaker scripts.
// It is NOT the game: it models the subset of the API the add-on uses, closely enough to exercise logic.
import { VoxelWorld } from '../voxel.js';

let tick = 0;
let idSeq = 1;
export const SIM = { deferred: [], warnings: [], errors: [], sounds: [], particles: [], commands: [], messages: [], events: [], hits: [], broken: [], musics: [], log: false };

class Signal {
  constructor(name) { this.name = name; this.subs = []; }
  subscribe(cb, opts) { this.subs.push({ cb, opts }); return cb; }
  unsubscribe(cb) { this.subs = this.subs.filter((s) => s.cb !== cb); }
  fire(ev) {
    for (const s of this.subs) {
      if (s.opts && s.opts.eventTypes && ev.eventId && !s.opts.eventTypes.includes(ev.eventId)) continue;
      try { s.cb(ev); } catch (e) { SIM.errors.push(`${this.name} handler: ${e.stack || e}`); }
    }
  }
}

// ------------------------------------------------------------------ system
class System {
  constructor() {
    this.jobs = []; this.seq = 1;
    this.beforeEvents = { startup: new Signal('startup') };
    this.afterEvents = { scriptEventReceive: new Signal('scriptEventReceive') };
  }
  get currentTick() { return tick; }
  run(cb) { return this._add(cb, 0, false); }
  runTimeout(cb, t = 1) { return this._add(cb, Math.max(1, t | 0), false); }
  runInterval(cb, t = 1) { return this._add(cb, Math.max(1, t | 0), true); }
  clearRun(id) { this.jobs = this.jobs.filter((j) => j.id !== id); }
  runJob(gen) { const id = this.seq++; const step = () => { const r = gen.next(); if (!r.done) this._add(step, 1, false); }; this._add(step, 1, false); return id; }
  _add(cb, delay, repeat) { const id = this.seq++; this.jobs.push({ id, cb, at: tick + (delay || 1), every: delay, repeat }); return id; }
  _tick() {
    tick++;
    const due = this.jobs.filter((j) => j.at <= tick);
    for (const j of due) {
      try { j.cb(); } catch (e) { SIM.errors.push(`job: ${e.stack || e}`); }
      if (j.repeat) j.at = tick + j.every; else this.jobs = this.jobs.filter((x) => x !== j);
    }
  }
}
export const system = new System();

// ------------------------------------------------------------------ enums & simple classes
export const CommandPermissionLevel = { Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4 };
export const CustomCommandParamType = { BlockType: 'BlockType', Boolean: 'Boolean', EntitySelector: 'EntitySelector', Enum: 'Enum', Float: 'Float', Integer: 'Integer', String: 'String' };
export const CustomCommandStatus = { Success: 0, Failure: 1 };
export const GameMode = { Adventure: 'Adventure', Creative: 'Creative', Spectator: 'Spectator', Survival: 'Survival' };
export const EquipmentSlot = { Head: 'Head', Chest: 'Chest', Legs: 'Legs', Feet: 'Feet', Mainhand: 'Mainhand', Offhand: 'Offhand' };
export class MolangVariableMap { setFloat() {} }
export class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }
export class BlockPermutation {
  constructor(id, states = {}) { this.type = { id }; this.states = { ...states }; }
  static resolve(id, states = {}) { return new BlockPermutation(id, states); }
  getState(k) { return this.states[k]; }
  withState(k, v) { return new BlockPermutation(this.type.id, { ...this.states, [k]: v }); }
  getAllStates() { return { ...this.states }; }
}

// ------------------------------------------------------------------ blocks / dimension
class Block {
  constructor(dim, x, y, z) { this.dimension = dim; this.location = { x, y, z }; this.x = x; this.y = y; this.z = z; }
  get typeId() { return this.dimension.vw.get(this.x, this.y, this.z); }
  get isAir() { return this.typeId === 'minecraft:air'; }
  get isLiquid() { return /water|lava/.test(this.typeId); }
  get permutation() { return new BlockPermutation(this.typeId, this.dimension.vw.getStates(this.x, this.y, this.z)); }
  setType(id) { this.dimension._set(this.x, this.y, this.z, typeof id === 'string' ? id : id.id, {}); }
  setPermutation(p) { this.dimension._set(this.x, this.y, this.z, p.type.id, p.states); }
  getLightLevel() { return this.dimension.getLightLevel(this.location); }
  getSkyLightLevel() { return this.dimension.getSkyLightLevel(this.location); }
}

class Dimension {
  constructor(id, vw) { this.id = id; this.vw = vw; this.heightRange = { min: vw.minY, max: vw.maxY }; }
  _set(x, y, z, id, states) {
    const old = this.vw.get(x, y, z);
    if (SIM.guardSet) SIM.guardSet(x, y, z, old, id);
    this.vw.set(x, y, z, id, states);
  }
  getBlock(p) {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    if (!this.vw.inBounds(x, y, z)) return undefined;
    return new Block(this, x, y, z);
  }
  getBlockFromRay(origin, dir, opts = {}) {
    const hit = this.vw.raycast(origin, dir, opts.maxDistance ?? 64, !!opts.includePassableBlocks, !!opts.includeLiquidBlocks);
    if (!hit) return undefined;
    return { block: new Block(this, hit.x, hit.y, hit.z), face: 'Up', faceLocation: { x: hit.fx - hit.x, y: hit.fy - hit.y, z: hit.fz - hit.z } };
  }
  getTopmostBlock(p) { const y = this.vw.topY(Math.floor(p.x), Math.floor(p.z)); return y === null ? undefined : new Block(this, Math.floor(p.x), y, Math.floor(p.z)); }
  getLightLevel(p) { return this.vw.light(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); }
  getSkyLightLevel(p) { return this.vw.sky(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); }
  isChunkLoaded(p) { return this.vw.inBounds(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); }
  getEntities(q = {}) { return world._entities.filter((e) => e.isValid && e.dimension === this && matches(e, q)).sort(byDist(q.location)).slice(0, q.closest ?? 1e9); }
  getPlayers(q = {}) { return world._players.filter((e) => e.isValid && matches(e, q)); }
  spawnEntity(id, loc) {
    const e = new Entity(id, this, { ...loc });
    world._entities.push(e);
    SIM.deferred.push(() => world.afterEvents.entitySpawn.fire({ entity: e, cause: 'Spawned' }));
    if (SIM.onSpawn) SIM.onSpawn(e);
    return e;
  }
  spawnItem(stack, loc) { const e = this.spawnEntity('minecraft:item', loc); e._item = stack; return e; }
  spawnParticle(id, loc) { SIM.particles.push({ t: tick, id }); }
  playSound(id, loc, o) { SIM.sounds.push({ t: tick, id, loc, who: 'world' }); }
  runCommand(cmd) {
    SIM.commands.push(cmd);
    const m = cmd.match(/^setblock (-?\d+) (-?\d+) (-?\d+) air destroy$/);
    if (m) { const [x, y, z] = m.slice(1).map(Number); const old = this.vw.get(x, y, z); SIM.broken.push({ t: tick, x, y, z, id: old, by: SIM.cmdContext || 'cmd' }); this._set(x, y, z, 'minecraft:air', {}); }
    return { successCount: 1 };
  }
}

function byDist(loc) { return (a, b) => (loc ? d3(a.location, loc) - d3(b.location, loc) : 0); }
function d3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function matches(e, q) {
  if (q.type && e.typeId !== q.type) return false;
  if (q.location && q.maxDistance !== undefined && d3(e.location, q.location) > q.maxDistance) return false;
  if (q.tags && !q.tags.every((t) => e._tags.has(t))) return false;
  return true;
}

// ------------------------------------------------------------------ entities
export class Entity {
  constructor(typeId, dim, loc) {
    this.id = String(idSeq++); this.typeId = typeId; this.dimension = dim; this.location = loc;
    this._valid = true; this._props = {}; this._dyn = {}; this._tags = new Set(); this._groups = new Set();
    this._rot = { x: 0, y: 0 }; this._vel = { x: 0, y: 0, z: 0 }; this._hp = 20; this._max = 20; this.nameTag = '';
    this.isOnGround = true; this.isClimbing = false; this.isInWater = false; this.isSwimming = false; this.isSprinting = false; this.isSneaking = false;
    if (typeId === 'shaftbreaker:shaftbreaker') { this._hp = 112; this._max = 112; this._groups = new Set(['sb:mode_still', 'sb:grav_on', 'sb:stance_stand', 'sb:nav_walk']); this._props = { 'shaftbreaker:phase': 'dormant', 'shaftbreaker:act': 0, 'shaftbreaker:stance': 0, 'shaftbreaker:gait': 0, 'shaftbreaker:spectral': false, 'shaftbreaker:eyes': 0.85, 'shaftbreaker:moving': 0, 'shaftbreaker:defeated': false }; }
  }
  get isValid() { return this._valid; }
  remove() { this._valid = false; world._entities = world._entities.filter((e) => e !== this); }
  kill() { this.remove(); return true; }
  getProperty(k) { return this._props[k]; }
  setProperty(k, v) { if (this.typeId === 'shaftbreaker:shaftbreaker' && !(k in this._props)) throw new Error(`unknown property ${k}`); this._props[k] = v; }
  getDynamicProperty(k) { return this._dyn[k]; }
  setDynamicProperty(k, v) { this._dyn[k] = v; }
  addTag(t) { this._tags.add(t); return true; }
  removeTag(t) { return this._tags.delete(t); }
  hasTag(t) { return this._tags.has(t); }
  getTags() { return [...this._tags]; }
  triggerEvent(ev) {
    SIM.events.push({ t: tick, id: this.id, ev });
    if (this.typeId === 'shaftbreaker:shaft_moth') { if (ev === 'sb:become_guide') { this._groups.delete('sb:wander'); this._groups.add('sb:guide'); } else if (ev === 'sb:despawn') this.remove(); return; }
    if (this.typeId !== 'shaftbreaker:shaftbreaker') return;
    const cats = { mode: 'sb:mode_', grav: 'sb:grav_', stance: 'sb:stance_', nav: 'sb:nav_' };
    for (const pre of Object.values(cats)) {
      if (ev.startsWith(pre)) { if (this._props['shaftbreaker:defeated']) return; for (const g of [...this._groups]) if (g.startsWith(pre)) this._groups.delete(g); this._groups.add(ev); return; }
    }
    if (ev === 'sb:despawn') this.remove();
  }
  mode() { for (const g of this._groups) if (g.startsWith('sb:mode_')) return g.slice(8); return 'still'; }
  teleport(loc, o = {}) { const from = { ...this.location }; this.location = { ...loc }; if (o.facingLocation) this.lookAt(o.facingLocation); this._vel = { x: 0, y: 0, z: 0 }; if (SIM.onTeleport) SIM.onTeleport(this, from, this.location); }
  tryTeleport(loc, o) { this.teleport(loc, o); return true; }
  lookAt(p) { this._rot = { x: 0, y: Math.atan2(-(p.x - this.location.x), p.z - this.location.z) * 57.2958 }; }
  setRotation(r) { this._rot = { ...r }; }
  getRotation() { return { ...this._rot }; }
  getVelocity() { return { ...this._vel }; }
  clearVelocity() { this._vel = { x: 0, y: 0, z: 0 }; }
  applyImpulse(v) { this._vel = { x: this._vel.x + v.x, y: this._vel.y + v.y, z: this._vel.z + v.z }; this._impulse = 6; this._impulsed = true; }
  applyKnockback(h, v) { if (this.typeId === 'minecraft:player') this._knock = { ...h, v }; }
  getHeadLocation() { return { x: this.location.x, y: this.location.y + (this.typeId === 'minecraft:player' ? 1.62 : 2.6), z: this.location.z }; }
  getViewDirection() { const r = this._rot.y / 57.2958, p = this._rot.x / 57.2958; return { x: -Math.sin(r) * Math.cos(p), y: -Math.sin(p), z: Math.cos(r) * Math.cos(p) }; }
  addEffect(t, d, o) { (this._effects ||= {})[t] = tick + d; return {}; }
  applyDamage(n, o = {}) {
    if (!this._valid) return false;
    const by = o.damagingEntity;
    if (this.typeId === 'minecraft:player' && by && by.typeId === 'shaftbreaker:shaftbreaker') SIM.hits.push({ t: tick, n, act: by._props['shaftbreaker:act'], phase: by._props['shaftbreaker:phase'], mode: by.mode(), src: 'script', p: { ...this.location }, c: { ...by.location } });
    return world._damage(this, n, o.cause || 'entityAttack', by);
  }
  getComponent(id) {
    const self = this;
    if (id === 'minecraft:health') return { get currentValue() { return self._hp; }, get effectiveMax() { return self._max; }, setCurrentValue(v) { self._hp = v; } };
    if (id === 'minecraft:equippable') return { getEquipment(slot) { return (self._equip || {})[slot]; } };
    if (id === 'minecraft:riding') return self._riding ? { entityRidingOn: self._riding } : undefined;
    if (id === 'minecraft:rideable') return { ejectRiders() { SIM.events.push({ t: tick, ev: 'eject' }); } };
    if (id === 'minecraft:item') return self._item ? { itemStack: self._item } : undefined;
    return undefined;
  }
  get playerPermissionLevel() { return 2; }
}

export class Player extends Entity {
  constructor(name, dim, loc) { super('minecraft:player', dim, loc); this.name = name; this._hp = 20; this._max = 20; this._music = null; this.onScreenDisplay = { setActionBar: (t) => { this._actionbar = t; }, setTitle: (t) => SIM.messages.push(`[title:${name}] ${t}`) }; this.camera = { fade: () => { this._fades = (this._fades || 0) + 1; } }; }
  getGameMode() { return this._gm || 'Survival'; }
  sendMessage(m) { SIM.messages.push(`[${this.name}] ${typeof m === 'string' ? m : JSON.stringify(m)}`); }
  playSound(id, o = {}) { SIM.sounds.push({ t: tick, id, loc: o.location, who: this.name, ctx: SIM.curEnc }); }
  playMusic(id) { this._music = id; SIM.musics.push({ t: tick, id, who: this.name }); }
  stopMusic() { this._music = null; }
  runCommand(c) { SIM.commands.push(`${this.name}: ${c}`); return { successCount: 1 }; }
  getSpawnPoint() { return this._spawnPoint; }
  startItemCooldown(c, t) { this._cooldown = { c, t }; }
}

// ------------------------------------------------------------------ world
class World {
  constructor() {
    this._dyn = {}; this._entities = []; this._players = []; this.dims = {};
    const names = ['worldLoad', 'playerBreakBlock', 'playerPlaceBlock', 'playerInteractWithBlock', 'entityHurt', 'entityDie', 'dataDrivenEntityTrigger', 'playerSpawn', 'playerLeave', 'playerDimensionChange', 'entitySpawn', 'explosion', 'itemUse'];
    this.afterEvents = Object.fromEntries(names.map((n) => [n, new Signal(n)]));
    this.beforeEvents = {};
    this.difficulty = 'Normal';
  }
  _init(vw) { this.dims['minecraft:overworld'] = new Dimension('minecraft:overworld', vw); }
  getDimension(id) { return this.dims[id] || this.dims['minecraft:overworld']; }
  getDynamicProperty(k) { return this._dyn[k]; }
  setDynamicProperty(k, v) { if (typeof v === 'string' && v.length > 32767) throw new Error(`dynamic property ${k} too long (${v.length})`); this._dyn[k] = v; }
  getAllPlayers() { return this._players.filter((p) => p.isValid); }
  getPlayers() { return this.getAllPlayers(); }
  getAbsoluteTime() { return tick + 100000; }
  getTimeOfDay() { return 18000; }
  getDay() { return 5; }
  getDefaultSpawnLocation() { return { x: 0, y: 70, z: 0 }; }
  getDifficulty() { return this.difficulty; }
  sendMessage(m) { SIM.messages.push(String(m)); }
  getEntity(id) { return this._entities.find((e) => e.id === id); }
  _damage(target, n, cause, by) {
    if (target.typeId === 'shaftbreaker:shaftbreaker') {
      if (target._props['shaftbreaker:defeated']) return false;
      if (target._hp <= 22) {
        target._props['shaftbreaker:defeated'] = true; target._props['shaftbreaker:act'] = 29; target._groups.add('sb:mode_defeated');
        this.afterEvents.dataDrivenEntityTrigger.fire({ entity: target, eventId: 'sb:defeated' });
        return false;
      }
      if (cause === 'drowning' || cause === 'suffocation') return false;
    }
    target._hp -= n;
    this.afterEvents.entityHurt.fire({ hurtEntity: target, damage: n, damageSource: { cause, damagingEntity: by } });
    if (target._hp <= 0) {
      this.afterEvents.entityDie.fire({ deadEntity: target, damageSource: { cause, damagingEntity: by } });
      if (target.typeId === 'minecraft:player') { target._dead = tick; }
      else target.remove();
    }
    return true;
  }
}
export const world = new World();
export function _setTick(t) { tick = t; }
export function _tick() { system._tick(); const d = SIM.deferred.splice(0); for (const f of d) { try { f(); } catch (e) { SIM.errors.push('deferred: ' + (e.stack || e)); } } }
export { VoxelWorld };
