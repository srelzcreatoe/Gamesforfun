// Minimal mock of the STABLE @minecraft/server 2.0.0 surface used by the Grinshackle scripts. Test harness only — not the real engine.
export const GameMode = Object.freeze({ Adventure: 'Adventure', Creative: 'Creative', Spectator: 'Spectator', Survival: 'Survival' });
export const Difficulty = Object.freeze({ Easy: 'Easy', Hard: 'Hard', Normal: 'Normal', Peaceful: 'Peaceful' });
export const EntityDamageCause = Object.freeze({ entityAttack: 'entityAttack', fall: 'fall', void: 'void', none: 'none', suicide: 'suicide', magic: 'magic' });
export const ScriptEventSource = Object.freeze({ Block: 'Block', Entity: 'Entity', NPCDialogue: 'NPCDialogue', Server: 'Server' });

export const __state = { tick: 0, blocks: () => undefined, overrides: new Map(), entities: new Map(), players: [], props: new Map(), difficulty: 'Normal', log: [], runs: [], nextRunId: 1, nextEntityId: 1, formQueue: [], loadGen: 0 };
export function __log(kind, data) { __state.log.push({ tick: __state.tick, kind, ...data }); }

class Signal {
  constructor(name) { this.name = name; this.subs = []; }
  subscribe(cb) { this.subs.push(cb); return cb; }
  unsubscribe(cb) { this.subs = this.subs.filter((s) => s !== cb); }
  emit(data) { for (const s of [...this.subs]) { try { s(data); } catch (e) { __log('subscriberError', { signal: this.name, error: String(e && e.stack || e) }); throw e; } } }
  __reset() { this.subs = []; }
}
const AFTER = ['worldLoad', 'entitySpawn', 'entityLoad', 'entityRemove', 'entityDie', 'entityHurt', 'playerSpawn', 'playerLeave', 'playerJoin', 'playerBreakBlock', 'playerPlaceBlock', 'playerInteractWithBlock', 'playerInteractWithEntity', 'itemUse', 'playerGameModeChange', 'playerDimensionChange', 'pressurePlatePush', 'tripWireTrip', 'leverAction', 'buttonPush', 'dataDrivenEntityTrigger', 'weatherChange', 'projectileHitBlock'];
const BEFORE = ['playerBreakBlock', 'itemUse', 'playerInteractWithBlock', 'startup', 'chatSend'];
export const __signals = {};
function makeSignals(names, prefix) { const o = {}; for (const n of names) { o[n] = new Signal(prefix + n); __signals[prefix + n] = o[n]; } return o; }

const PASSABLE = /(:air$|torch|_carpet|snow_layer|rail|web|flower|grass|tallgrass|fern|sapling|vine|button|lever|pressure_plate|sign|banner)/;
const LIQUID = /(water|lava)$/;
export class Block {
  constructor(dim, x, y, z, typeId) { this.dimension = dim; this.location = { x, y, z }; this.typeId = typeId; this.x = x; this.y = y; this.z = z; }
  get isAir() { return this.typeId === 'minecraft:air'; }
  get isLiquid() { return LIQUID.test(this.typeId); }
  get isValid() { return true; }
  get isWaterlogged() { return false; }
  get permutation() { return { type: { id: this.typeId }, getState: () => undefined, matches: (id) => id === this.typeId }; }
  above(n = 1) { return this.dimension.getBlock({ x: this.x, y: this.y + n, z: this.z }); }
  below(n = 1) { return this.dimension.getBlock({ x: this.x, y: this.y - n, z: this.z }); }
  offset(o) { return this.dimension.getBlock({ x: this.x + o.x, y: this.y + o.y, z: this.z + o.z }); }
  hasTag() { return false; }
  getTags() { return []; }
}
export class LocationInUnloadedChunkError extends Error {}

export class ItemStack {
  constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; this.nameTag = undefined; this.lore = []; this.keepOnDeath = false; }
  setLore(l) { this.lore = l ? [...l] : []; }
  getLore() { return [...this.lore]; }
  clone() { const s = new ItemStack(this.typeId, this.amount); s.lore = [...this.lore]; s.nameTag = this.nameTag; return s; }
  isStackableWith(o) { return o && o.typeId === this.typeId; }
  getComponent() { return undefined; }
}
export class Container {
  constructor(size = 36) { this.size = size; this.slots = new Array(size).fill(undefined); }
  getItem(i) { return this.slots[i]; }
  setItem(i, item) { this.slots[i] = item; }
  addItem(item) {
    for (let i = 0; i < this.size; i++) if (!this.slots[i]) { this.slots[i] = item; __log('addItem', { typeId: item.typeId, amount: item.amount }); return undefined; }
    return item;
  }
  get emptySlotsCount() { return this.slots.filter((s) => !s).length; }
  __count(typeId) { return this.slots.filter((s) => s && s.typeId === typeId).reduce((a, s) => a + s.amount, 0); }
}
export class EntityHealthComponent {
  constructor(entity, max) { this.entity = entity; this.effectiveMax = max; this.defaultValue = max; this.currentValue = max; this.typeId = 'minecraft:health'; }
  setCurrentValue(v) { this.currentValue = Math.max(0, Math.min(this.effectiveMax, v)); return true; }
  resetToMaxValue() { this.currentValue = this.effectiveMax; }
  get isValid() { return this.entity.isValid; }
}
export class MolangVariableMap { constructor() { this.m = new Map(); } setFloat(k, v) { this.m.set(k, v); } setColorRGB() {} setVector3() {} }

const FAMILIES = { 'gs:grinshackle': ['gs_grinshackle', 'monster', 'mob'], 'gs:waypoint': ['gs_waypoint', 'inanimate'], 'cr:chainreaver': ['gs_legacy'], 'minecraft:player': ['player'], 'minecraft:xp_orb': [] };
const HEALTH = { 'gs:grinshackle': 1000, 'gs:waypoint': 10, 'minecraft:player': 20 };
const MOVE = { still: 0, creep: 0.07, stalk: 0.10, walk: 0.15, hunt: 0.32, hunt_slow: 0.26, hunt_fast: 0.38, crawl: 0.16, crawl_slow: 0.13, crawl_fast: 0.20, retreat: 0.25 };

export class Entity {
  constructor(typeId, dim, loc) {
    this.__id = String(__state.nextEntityId++); this.typeId = typeId; this.__dim = dim; this.__loc = { ...loc }; this.__rot = { x: 0, y: 0 };
    this.__tags = new Set(); this.__dyn = new Map(); this.__props = new Map(); this.__removed = false; this.__unloaded = false; this.__dead = false;
    this.__health = new EntityHealthComponent(this, HEALTH[typeId] ?? 20); this.__vel = { x: 0, y: 0, z: 0 }; this.__move = 'still'; this.__targetMode = 'none';
    this.nameTag = ''; this.isSneaking = false; this.__sprinting = false; this.__families = FAMILIES[typeId] || [];
    if (typeId === 'gs:grinshackle') { this.__props.set('gs:pose', 'emerge'); this.__props.set('gs:action', 0); this.__props.set('gs:overlay', 0); this.__props.set('gs:track', false); }
  }
  get id() { return this.__id; }
  get isValid() { return !this.__removed && !this.__unloaded && !(this.__dead && this.typeId !== 'minecraft:player'); }
  get location() { return { ...this.__loc }; }
  get dimension() { return this.__dim; }
  get isOnGround() { return true; }
  get isSprinting() { return this.__sprinting; }
  set isSprinting(v) { this.__sprinting = v; }
  get isFalling() { return false; }
  get isInWater() { return false; }
  get isClimbing() { return false; }
  get isSwimming() { return false; }
  get isSleeping() { return false; }
  getViewDirection() { const yaw = this.__rot.y * Math.PI / 180, pitch = this.__rot.x * Math.PI / 180; return { x: -Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) }; }
  getHeadLocation() { return { x: this.__loc.x, y: this.__loc.y + (this.typeId === 'minecraft:player' ? 1.62 : 2.2), z: this.__loc.z }; }
  getRotation() { return { ...this.__rot }; }
  setRotation(r) { this.__rot = { x: r.x || 0, y: r.y || 0 }; }
  lookAt(t) { this.__rot.y = Math.atan2(-(t.x - this.__loc.x), t.z - this.__loc.z) * 180 / Math.PI; }
  teleport(loc) { this.__loc = { x: loc.x, y: loc.y, z: loc.z }; }
  remove() { if (this.__removed) return; this.__removed = true; __state.entities.delete(this.__id); __log('remove', { entityId: this.__id, typeId: this.typeId }); world.afterEvents.entityRemove.emit({ removedEntityId: this.__id, typeId: this.typeId }); }
  kill() { if (!this.isValid) return false; this.__dead = true; this.__health.currentValue = 0; world.afterEvents.entityDie.emit({ deadEntity: this, damageSource: { cause: 'suicide' } }); if (this.typeId !== 'minecraft:player') this.remove(); return true; }
  addTag(t) { const had = this.__tags.has(t); this.__tags.add(t); return !had; }
  removeTag(t) { return this.__tags.delete(t); }
  hasTag(t) { return this.__tags.has(t); }
  getTags() { return [...this.__tags]; }
  getComponent(id) {
    if (id === 'minecraft:health' || id === 'health') return this.__health;
    if (id === 'minecraft:inventory' || id === 'inventory') { if (!this.__inv) this.__inv = { container: new Container(36), typeId: 'minecraft:inventory', isValid: true }; return this.__inv; }
    if (id === 'minecraft:movement') return { currentValue: MOVE[this.__move] || 0, typeId: 'minecraft:movement' };
    return undefined;
  }
  triggerEvent(name) {
    if (!this.isValid) throw new Error('invalid entity');
    __log('triggerEvent', { entityId: this.__id, eventName: name });
    if (name.startsWith('gs:move_')) this.__move = name.slice(8);
    else if (name === 'gs:target_player') this.__targetMode = 'player';
    else if (name === 'gs:target_waypoint') this.__targetMode = 'waypoint';
    else if (name === 'gs:target_none') this.__targetMode = 'none';
    else if (name === 'gs:crouch') this.__low = true;
    else if (name === 'gs:stand') this.__low = false;
    else if (name === 'gs:expire') this.remove();
  }
  setProperty(id, v) { if (!this.isValid) throw new Error('invalid entity'); this.__props.set(id, v); __log('setProperty', { entityId: this.__id, identifier: id, value: v }); }
  getProperty(id) { return this.__props.get(id); }
  setDynamicProperty(k, v) { if (!this.isValid) throw new Error('invalid entity'); if (v === undefined) this.__dyn.delete(k); else this.__dyn.set(k, v); }
  getDynamicProperty(k) { return this.__dyn.get(k); }
  getDynamicPropertyIds() { return [...this.__dyn.keys()]; }
  applyDamage(amount, opts = {}) {
    if (!this.isValid || amount <= 0) return false;
    if (this.typeId === 'minecraft:player' && (this.__mode === 'Creative' || this.__mode === 'Spectator')) return false;
    this.__health.currentValue = Math.max(0, this.__health.currentValue - amount);
    __log('applyDamage', { entityId: this.__id, typeId: this.typeId, amount, cause: opts.cause, damagingEntityId: opts.damagingEntity ? opts.damagingEntity.id : undefined });
    world.afterEvents.entityHurt.emit({ hurtEntity: this, damage: amount, damageSource: { cause: opts.cause || 'none', damagingEntity: opts.damagingEntity } });
    if (this.__health.currentValue <= 0) { this.__dead = true; world.afterEvents.entityDie.emit({ deadEntity: this, damageSource: { cause: opts.cause || 'none', damagingEntity: opts.damagingEntity } }); if (this.typeId !== 'minecraft:player') this.remove(); }
    return true;
  }
  applyKnockback(xz, y) { __log('applyKnockback', { entityId: this.__id, x: xz.x, z: xz.z, y }); }
  applyImpulse(v) { this.__vel = { ...v }; }
  clearVelocity() { this.__vel = { x: 0, y: 0, z: 0 }; }
  getVelocity() { return { ...this.__vel }; }
  playAnimation(name, opts) { __log('playAnimation', { entityId: this.__id, name, opts }); }
  runCommand(cmd) { __log('runCommand', { entityId: this.__id, command: cmd }); return { successCount: 1 }; }
  matches(opts) { return __matches(this, opts); }
  getBlockFromViewDirection(opts = {}) { return this.__dim.getBlockFromRay(this.getHeadLocation(), this.getViewDirection(), opts); }
  getEntitiesFromViewDirection() { return []; }
}
export class Player extends Entity {
  constructor(name, dim, loc, mode) { super('minecraft:player', dim, loc); this.name = name; this.__mode = mode || 'Survival'; this.selectedSlotIndex = 0; this.__music = undefined; this.isEmoting = false; this.isFlying = false; this.isGliding = false; this.isJumping = false;
    this.onScreenDisplay = { setActionBar: (t) => __log('setActionBar', { playerId: this.__id, text: typeof t === 'string' ? t : JSON.stringify(t) }), setTitle: (t) => __log('setTitle', { playerId: this.__id, text: String(t) }), updateSubtitle: () => {}, isValid: true };
    this.inputInfo = { getMovementVector: () => ({ x: 0, y: 0 }), lastInputModeUsed: 'KeyboardAndMouse', touchOnlyAffectsHotbar: false };
    this.inputPermissions = { isValid: true };
  }
  getGameMode() { return this.__mode; }
  setGameMode(m) { this.__mode = m; }
  playSound(id, opts = {}) { __log('playSound', { playerId: this.__id, soundId: id, location: opts.location, volume: opts.volume, pitch: opts.pitch }); }
  playMusic(id, opts = {}) { this.__music = id; __log('playMusic', { playerId: this.__id, trackId: id, ...opts }); }
  queueMusic(id, opts = {}) { __log('queueMusic', { playerId: this.__id, trackId: id }); }
  stopMusic() { this.__music = undefined; __log('stopMusic', { playerId: this.__id }); }
  sendMessage(m) { __log('sendMessage', { playerId: this.__id, text: typeof m === 'string' ? m : JSON.stringify(m) }); }
  startItemCooldown() {} getItemCooldown() { return 0; }
  getSpawnPoint() { return undefined; }
}
function __matches(e, opts = {}) {
  if (opts.type && e.typeId !== opts.type) return false;
  if (opts.excludeTypes && opts.excludeTypes.includes(e.typeId)) return false;
  if (opts.families && !opts.families.every((f) => e.__families.includes(f))) return false;
  if (opts.tags && !opts.tags.every((t) => e.hasTag(t))) return false;
  if (opts.excludeTags && opts.excludeTags.some((t) => e.hasTag(t))) return false;
  if (opts.location && opts.maxDistance !== undefined) { const d = Math.hypot(e.__loc.x - opts.location.x, e.__loc.y - opts.location.y, e.__loc.z - opts.location.z); if (d > opts.maxDistance) return false; }
  if (opts.location && opts.minDistance !== undefined) { const d = Math.hypot(e.__loc.x - opts.location.x, e.__loc.y - opts.location.y, e.__loc.z - opts.location.z); if (d < opts.minDistance) return false; }
  return true;
}
export class Dimension {
  constructor(id) { this.id = id; this.heightRange = { min: -64, max: 320 }; }
  getBlock(loc) {
    const x = Math.floor(loc.x), y = Math.floor(loc.y), z = Math.floor(loc.z);
    if (this.id !== 'minecraft:overworld') return new Block(this, x, y, z, 'minecraft:air');
    const key = x + ',' + y + ',' + z;
    const t = __state.overrides.has(key) ? __state.overrides.get(key) : __state.blocks(x, y, z);
    if (t === undefined) throw new LocationInUnloadedChunkError('unloaded');
    return new Block(this, x, y, z, t);
  }
  getBlockFromRay(loc, dir, opts = {}) {
    const max = opts.maxDistance ?? 16; const L = Math.hypot(dir.x, dir.y, dir.z) || 1; const d = { x: dir.x / L, y: dir.y / L, z: dir.z / L };
    const step = 0.1; let prev = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
    for (let t = 0; t <= max; t += step) {
      const p = { x: loc.x + d.x * t, y: loc.y + d.y * t, z: loc.z + d.z * t };
      const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
      let b; try { b = this.getBlock({ x: bx, y: by, z: bz }); } catch { return undefined; }
      if (b.isAir) { prev = { x: bx, y: by, z: bz }; continue; }
      if (b.isLiquid && !opts.includeLiquidBlocks) { prev = { x: bx, y: by, z: bz }; continue; }
      if (!opts.includePassableBlocks && PASSABLE.test(b.typeId)) { prev = { x: bx, y: by, z: bz }; continue; }
      const face = prev.y > by ? 'Up' : prev.y < by ? 'Down' : prev.x > bx ? 'East' : prev.x < bx ? 'West' : prev.z > bz ? 'South' : 'North';
      const fl = { x: p.x - bx, y: p.y - by, z: p.z - bz };
      if (face === 'Up') fl.y = 1; else if (face === 'Down') fl.y = 0; else if (face === 'East') fl.x = 1; else if (face === 'West') fl.x = 0; else if (face === 'South') fl.z = 1; else fl.z = 0;
      return { block: b, face, faceLocation: fl };
    }
    return undefined;
  }
  getEntities(opts = {}) {
    let list = [...__state.entities.values()].filter((e) => e.isValid && e.__dim === this && __matches(e, opts));
    if (opts.closest && opts.location) list = list.sort((a, b) => dist(a.__loc, opts.location) - dist(b.__loc, opts.location)).slice(0, opts.closest);
    return list;
  }
  getPlayers(opts = {}) { return this.getEntities({ ...opts, type: 'minecraft:player' }); }
  spawnEntity(typeId, loc) {
    const e = new Entity(typeId, this, { x: loc.x, y: loc.y, z: loc.z }); __state.entities.set(e.id, e);
    __log('spawnEntity', { typeId, entityId: e.id, x: loc.x, y: loc.y, z: loc.z });
    world.afterEvents.entitySpawn.emit({ entity: e, cause: 'Spawned' });
    return e;
  }
  spawnItem(item, loc) { __log('spawnItem', { typeId: item.typeId, amount: item.amount, x: loc.x, y: loc.y, z: loc.z }); return new Entity('minecraft:item', this, loc); }
  spawnParticle(id, loc) { __log('spawnParticle', { effect: id, x: loc.x, y: loc.y, z: loc.z }); }
  playSound(id, loc, opts = {}) { __log('dimensionPlaySound', { soundId: id, location: loc, ...opts }); }
  runCommand(cmd) { __log('runCommand', { dimension: this.id, command: cmd }); return { successCount: 1 }; }
  getTopmostBlock() { return undefined; }
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const DIMS = { 'minecraft:overworld': new Dimension('minecraft:overworld'), 'minecraft:nether': new Dimension('minecraft:nether'), 'minecraft:the_end': new Dimension('minecraft:the_end') };

export const world = {
  afterEvents: makeSignals(AFTER, 'world.'),
  beforeEvents: makeSignals(BEFORE, 'world.before.'),
  getDynamicProperty(k) { return __state.props.get(k); },
  setDynamicProperty(k, v) { if (v === undefined) __state.props.delete(k); else { if (typeof v === 'string' && v.length > 32767) throw new Error('dynamic property too long'); __state.props.set(k, v); } },
  getDynamicPropertyIds() { return [...__state.props.keys()]; },
  clearDynamicProperties() { __state.props.clear(); },
  getAllPlayers() { return __state.players.filter((p) => p.isValid); },
  getPlayers(opts = {}) { return __state.players.filter((p) => p.isValid && __matches(p, opts)); },
  getEntity(id) { const e = __state.entities.get(String(id)); return e && e.isValid ? e : undefined; },
  getDimension(id) { const key = id.startsWith('minecraft:') ? id : 'minecraft:' + id; const d = DIMS[key]; if (!d) throw new Error('unknown dimension ' + id); return d; },
  getDifficulty() { return __state.difficulty; },
  setDifficulty(d) { __state.difficulty = d; },
  sendMessage(m) { __log('worldMessage', { text: String(m) }); },
  playSound(id, loc, opts = {}) { __log('worldPlaySound', { soundId: id, location: loc, ...opts }); },
  stopMusic() { __log('worldStopMusic', {}); },
  getTimeOfDay() { return 6000; }, getAbsoluteTime() { return __state.tick; },
};
export const system = {
  afterEvents: makeSignals(['scriptEventReceive', 'watchdogTerminate'], 'system.'),
  beforeEvents: makeSignals(['startup', 'shutdown'], 'system.before.'),
  get currentTick() { return __state.tick; },
  run(fn) { const id = __state.nextRunId++; __state.runs.push({ id, fn, at: __state.tick + 1, interval: 0 }); return id; },
  runTimeout(fn, ticks = 1) { const id = __state.nextRunId++; __state.runs.push({ id, fn, at: __state.tick + Math.max(1, ticks), interval: 0 }); return id; },
  runInterval(fn, ticks = 1) { const id = __state.nextRunId++; __state.runs.push({ id, fn, at: __state.tick + Math.max(1, ticks), interval: Math.max(1, ticks) }); return id; },
  clearRun(id) { __state.runs = __state.runs.filter((r) => r.id !== id); },
  runJob(gen) { const id = __state.nextRunId++; __state.runs.push({ id, fn: () => { for (const _ of gen) { /* drain */ } }, at: __state.tick + 1, interval: 0 }); return id; },
  clearJob(id) { this.clearRun(id); },
  sendScriptEvent(id, message) { system.afterEvents.scriptEventReceive.emit({ id, message, sourceType: 'Server' }); },
};
// ---------------------------------------------------------------- harness internals
export function __tick() {
  __state.tick++;
  const due = __state.runs.filter((r) => r.at <= __state.tick).sort((a, b) => a.id - b.id);
  for (const r of due) {
    if (r.interval) r.at = __state.tick + r.interval; else __state.runs = __state.runs.filter((x) => x.id !== r.id);
    try { r.fn(); } catch (e) { __log('runError', { error: String(e && e.stack || e) }); throw e; }
  }
  // navigation stand-in
  for (const e of __state.entities.values()) {
    if (!e.isValid || e.typeId === 'minecraft:player') { continue; }
    const speed = (MOVE[e.__move] || 0) * 0.45;
    let target;
    if (e.__targetMode === 'player') target = __state.players.filter((p) => p.isValid && p.hasTag('gs_target'))[0] || undefined;
    else if (e.__targetMode === 'waypoint') target = [...__state.entities.values()].filter((w) => w.isValid && w.typeId === 'gs:waypoint').sort((a, b) => dist(a.__loc, e.__loc) - dist(b.__loc, e.__loc))[0];
    let vel = { x: 0, y: 0, z: 0 };
    if (speed > 0) {
      if (e.__move === 'retreat') {
        const p = __state.players.filter((p) => p.isValid).sort((a, b) => dist(a.__loc, e.__loc) - dist(b.__loc, e.__loc))[0];
        if (p) { const dx = e.__loc.x - p.__loc.x, dz = e.__loc.z - p.__loc.z; const L = Math.hypot(dx, dz) || 1; vel = { x: dx / L * speed, y: 0, z: dz / L * speed }; }
      } else if (target) {
        const dx = target.__loc.x - e.__loc.x, dz = target.__loc.z - e.__loc.z; const L = Math.hypot(dx, dz);
        const stop = e.__targetMode === 'waypoint' ? 0.8 : 1.0;
        if (L > stop) { const s = Math.min(speed, L - stop); vel = { x: dx / L * s, y: 0, z: dz / L * s }; e.__rot.y = Math.atan2(-dx, dz) * 180 / Math.PI; }
      }
    }
    e.__loc.x += vel.x; e.__loc.z += vel.z; e.__vel = vel;
  }
}
export function __reset(opts = {}) {
  __state.tick = 0; __state.blocks = opts.blocks || (() => 'minecraft:air'); __state.overrides = new Map(); __state.entities = new Map(); __state.players = [];
  __state.props = new Map(); __state.difficulty = opts.difficulty || 'Normal'; __state.log = []; __state.runs = []; __state.formQueue = [];
  for (const s of Object.values(__signals)) s.__reset();
}
export function __reload() { __state.runs = []; for (const s of Object.values(__signals)) s.__reset(); __state.loadGen++; }
