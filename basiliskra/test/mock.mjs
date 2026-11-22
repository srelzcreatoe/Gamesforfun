// A small simulated Bedrock world for running the behaviour-pack script outside the game.
// It implements the subset of the stable @minecraft/server 2.11.0 surface the pack uses, with
// the behaviours that matter for the acceptance scenarios: persistent entity ids, chunks that
// unload when no player is near, after-events queued to the end of the tick, entity properties
// validated against the pack's own entity JSON, and a "restart" that throws away every script
// object and reloads the bundle against the saved world.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENTITY_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/BP/entities/basiliskra.json'), 'utf8'));
const PROPS = ENTITY_JSON['minecraft:entity'].description.properties;
const EVENTS = Object.keys(ENTITY_JSON['minecraft:entity'].events);
const HIT_EVENTS = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/BP/entities/basiliskra_hitbox.json'), 'utf8'))['minecraft:entity'].events);

export const EntityDamageCause = { entityAttack: 'entityAttack', projectile: 'projectile', entityExplosion: 'entityExplosion', blockExplosion: 'blockExplosion',
  magic: 'magic', thorns: 'thorns', sonicBoom: 'sonicBoom', maceSmash: 'maceSmash', override: 'override', fall: 'fall', lava: 'lava', suffocation: 'suffocation', drowning: 'drowning' };
export const GameMode = { Survival: 'Survival', Creative: 'Creative', Adventure: 'Adventure', Spectator: 'Spectator' };
export const EquipmentSlot = { Mainhand: 'Mainhand', Offhand: 'Offhand' };
export const EasingType = { Linear: 'linear', InOutSine: 'in_out_sine' };
export class BlockVolume { constructor(from, to) { this.from = { ...from }; this.to = { ...to }; } }
export class MolangVariableMap { constructor() { this.v = {}; } setFloat(k, v) { this.v[k] = v; } setVector3(k, v) { this.v[k] = v; } setColorRGB(k, v) { this.v[k] = v; } }
export class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } }
export const CommandPermissionLevel = { Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4 };
export const CustomCommandParamType = { BlockType: 'BlockType', Boolean: 'Boolean', EntitySelector: 'EntitySelector', EntityType: 'EntityType', Enum: 'Enum', Float: 'Float', Integer: 'Integer', Location: 'Location', PlayerSelector: 'PlayerSelector', String: 'String' };
export const CustomCommandStatus = { Success: 0, Failure: 1 };
export const PlayerPermissionLevel = { Visitor: 0, Member: 1, Operator: 2, Custom: 3 };
export const EntityInitializationCause = { Born: 'Born', Event: 'Event', Loaded: 'Loaded', Spawned: 'Spawned', Transformed: 'Transformed' };

// ---- @minecraft/server-ui: forms record what they would show, and answer from the player's queue ----------------
export const FormCancelationReason = { UserBusy: 'UserBusy', UserClosed: 'UserClosed' };
class MockForm {
  constructor(kind) { this.kind = kind; this.spec = { kind, title: '', body: '', buttons: [], controls: [] }; }
  title(t) { this.spec.title = t; return this; }
  body(t) { this.spec.body = t; return this; }
  button(t) { this.spec.buttons.push(t); return this; }
  button1(t) { this.spec.buttons[0] = t; return this; }
  button2(t) { this.spec.buttons[1] = t; return this; }
  slider(label, min, max, o = {}) { this.spec.controls.push({ type: 'slider', label, min, max, value: o.defaultValue ?? min }); return this; }
  dropdown(label, items, o = {}) { this.spec.controls.push({ type: 'dropdown', label, items, value: o.defaultValueIndex ?? 0 }); return this; }
  toggle(label, o = {}) { this.spec.controls.push({ type: 'toggle', label, value: o.defaultValue ?? false }); return this; }
  textField(label) { this.spec.controls.push({ type: 'text', label, value: '' }); return this; }
  submitButton() { return this; }
  divider() { return this; } header() { return this; } label() { return this; }
  show(player) {
    player.forms.push(this.spec);
    const a = player.answers.shift();
    if (a === undefined) return Promise.resolve({ canceled: true, cancelationReason: 'UserClosed' });
    if (a === 'busy') return Promise.resolve({ canceled: true, cancelationReason: 'UserBusy' });
    if (this.kind === 'modal') {
      const values = this.spec.controls.map((c, i) => (a && i in a ? a[i] : c.value));
      return Promise.resolve({ canceled: false, formValues: values });
    }
    return Promise.resolve({ canceled: false, selection: a });
  }
}
export class ActionFormData extends MockForm { constructor() { super('action'); } }
export class ModalFormData extends MockForm { constructor() { super('modal'); } }
export class MessageFormData extends MockForm { constructor() { super('message'); } }
export const UI = { ActionFormData, ModalFormData, MessageFormData, FormCancelationReason };

class Signal {
  constructor() { this.subs = []; }
  subscribe(fn) { this.subs.push(fn); return fn; }
  unsubscribe(fn) { this.subs = this.subs.filter((f) => f !== fn); }
  fire(ev) { for (const f of [...this.subs]) f(ev); }
}

const CHUNK_RANGE = 80;          // blocks from a player within which chunks stay loaded
const SEA = 62;

/** The saved world: survives restarts. */
export class Save {
  constructor() {
    this.worldProps = new Map();
    this.entities = new Map();     // id -> record
    this.edits = new Map();        // "dim|x,y,z" -> block id
    this.nextId = 1000;
    this.tick = 0;
    this.timeOfDay = 6000;
    this.difficulty = 'normal';
  }
  snapshot() { return { worldProps: new Map(this.worldProps) }; }
}

export function terrain(dim, x, y, z) {
  if (dim !== 'minecraft:overworld') return y <= 30 ? 'minecraft:netherrack' : 'minecraft:air';
  if (y < -60) return 'minecraft:bedrock';
  const bay = x >= -90 && x <= 90 && z >= 20 && z <= 160;
  if (bay) {
    if (y <= 40) return 'minecraft:stone';
    if (y <= SEA) return 'minecraft:water';
    return 'minecraft:air';
  }
  if (y <= 60) return 'minecraft:stone';
  if (y <= 62) return 'minecraft:dirt';
  if (y === 63) return z > 160 || z < 20 ? 'minecraft:grass_block' : 'minecraft:sand';
  return 'minecraft:air';
}

export class Sim {
  constructor(save = new Save()) {
    this.work = { blocks: 0, queries: 0, rays: 0 };
    this.save = save;
    this.players = [];
    this.log = { particles: [], sounds: [], commands: [], damage: [] };
    this.boot();
  }

  /** Throw away every script-side object and build a fresh API over the same saved world. */
  boot() {
    this.session0 = this.save.tick;
    this.loaded = new Map();       // id -> MockEntity wrapper
    this.queue = [];               // after-events to fire at the end of the tick
    this.runs = [];
    this.intervals = [];
    this.timeouts = [];
    const sim = this;
    const after = () => new Signal();
    this.ev = {
      worldLoad: after(), entityLoad: after(), entitySpawn: after(), entityHurt: after(), entityDie: after(), playerBreakBlock: after(),
      playerInteractWithBlock: after(), weatherChange: after(), bEntityRemove: after(), bEntityHurt: after(), shutdown: after(), scriptEvent: after(),
      itemUse: after(), playerSpawn: after(), startup: after(),
    };
    this.commands = new Map();          // custom commands the script registered at start-up
    this.enums = new Map();
    this.dims = new Map();
    for (const id of ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end']) this.dims.set(id, new MockDimension(this, id));
    this.api = {
      EntityDamageCause, GameMode, EquipmentSlot, MolangVariableMap, ItemStack, Player: MockPlayer, Entity: MockEntity, BlockVolume, EasingType,
      CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, PlayerPermissionLevel, EntityInitializationCause,
      world: {
        getDynamicProperty: (k) => sim.save.worldProps.get(k),
        setDynamicProperty: (k, v) => {
          if (typeof v === 'string' && v.length > 32767) throw new Error('dynamic property string too long: ' + v.length);
          if (v === undefined) sim.save.worldProps.delete(k); else sim.save.worldProps.set(k, v);
        },
        getDimension: (id) => { const d = sim.dims.get(id); if (!d) throw new Error('no dimension ' + id); return d; },
        getAllPlayers: () => sim.players.filter((p) => p.online),
        getTimeOfDay: () => sim.save.timeOfDay,
        setTimeOfDay: (t) => { sim.save.timeOfDay = t; },
        getDifficulty: () => sim.save.difficulty,
        getEntity: (id) => sim.loaded.get(id),
        sendMessage: (m) => sim.log.commands.push(String(m)),
        afterEvents: { worldLoad: this.ev.worldLoad, entityLoad: this.ev.entityLoad, entitySpawn: this.ev.entitySpawn, entityHurt: this.ev.entityHurt,
          entityDie: this.ev.entityDie, playerBreakBlock: this.ev.playerBreakBlock, playerInteractWithBlock: this.ev.playerInteractWithBlock, weatherChange: this.ev.weatherChange,
          itemUse: this.ev.itemUse, playerSpawn: this.ev.playerSpawn },
        beforeEvents: { entityRemove: this.ev.bEntityRemove, entityHurt: this.ev.bEntityHurt },
      },
      system: {
        get currentTick() { return sim.save.tick - sim.session0; },      // the engine's counter starts again every session
        run: (fn) => { sim.runs.push(fn); return 0; },
        runTimeout: (fn, t = 1) => { sim.timeouts.push({ fn, at: sim.save.tick + t }); return 0; },
        runInterval: (fn, t = 1) => { sim.intervals.push({ fn, t }); return 0; },
        beforeEvents: { shutdown: this.ev.shutdown, startup: this.ev.startup },
        afterEvents: { scriptEventReceive: { subscribe: (fn) => this.ev.scriptEvent.subscribe(fn) } },
      },
    };
  }

  // ---- world ------------------------------------------------------------------------------
  blockId(dim, x, y, z) {
    const k = `${dim}|${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return this.save.edits.get(k) ?? (this.terrainFn ?? terrain)(dim, Math.floor(x), Math.floor(y), Math.floor(z));
  }
  setBlock(dim, x, y, z, id) {
    this.save.edits.set(`${dim}|${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`, id);
    if (this.onBlock) this.onBlock(Math.floor(x), Math.floor(y), Math.floor(z), id);
  }
  chunkLoaded(dim, p) {
    return this.players.some((pl) => pl.online && pl.dimension.id === dim && Math.max(Math.abs(pl.location.x - p.x), Math.abs(pl.location.z - p.z)) <= CHUNK_RANGE);
  }

  // ---- entities -----------------------------------------------------------------------------
  newRecord(typeId, dim, loc, rot = 0) {
    const id = String(-(this.save.nextId++) * 4294967296 - 17);       // looks like an engine id; never parsed
    const props = {};
    if (typeId === 'basiliskra:basiliskra') for (const [k, d] of Object.entries(PROPS)) props[k] = d.default;
    const rec = { id, typeId, dim, loc: { ...loc }, rot: { x: 0, y: rot }, vel: { x: 0, y: 0, z: 0 }, props, dyn: {}, health: typeId === 'basiliskra:hitbox' ? 1000 : typeId === 'basiliskra:basiliskra' ? 600 : 10, events: [], item: null, riders: [], family: [] };
    this.save.entities.set(id, rec);
    return rec;
  }
  attach(rec, cause) {
    const e = new MockEntity(this, rec);
    this.loaded.set(rec.id, e);
    this.queue.push(() => this.ev[cause].fire({ entity: e, cause: cause === 'entitySpawn' ? 'Spawned' : 'Loaded' }));
    return e;
  }
  /** What /summon, a spawn egg or a structure block would do: an entity the controller did not make. */
  summon(typeId, dim, loc) { return this.attach(this.newRecord(typeId, dim, loc), 'entitySpawn'); }
  /** A structure-block copy: same properties and dynamic properties, a new engine id. */
  copyEntity(e) {
    const r = this.newRecord(e.rec.typeId, e.rec.dim, { x: e.rec.loc.x + 3, y: e.rec.loc.y, z: e.rec.loc.z });
    r.props = { ...e.rec.props }; r.dyn = { ...e.rec.dyn }; r.health = e.rec.health;
    return this.attach(r, 'entitySpawn');
  }
  destroy(e, died = false) {
    if (!e.attached) return;
    this.ev.bEntityRemove.fire({ removedEntity: e });
    e.attached = false;
    this.loaded.delete(e.rec.id);
    this.save.entities.delete(e.rec.id);
  }
  count(typeId) { let n = 0; for (const r of this.save.entities.values()) if (r.typeId === typeId) n++; return n; }

  addPlayer(name, loc, dim = 'minecraft:overworld') {
    const p = new MockPlayer(this, name, loc, this.dims.get(dim));
    this.players.push(p);
    return p;
  }
  /** A player joining the world for real: they spawn, and the engine says so. */
  join(name, loc, dim = 'minecraft:overworld') {
    const p = this.addPlayer(name, loc, dim);
    this.queue.push(() => this.ev.playerSpawn.fire({ player: p, initialSpawn: true }));
    return p;
  }

  // ---- time ---------------------------------------------------------------------------------
  flush() { while (this.queue.length) this.queue.shift()(); }
  step(n = 1) {
    for (let i = 0; i < n; i++) {
      this.save.tick++;
      this.save.timeOfDay = (this.save.timeOfDay + 1) % 24000;
      const runs = this.runs; this.runs = [];
      for (const f of runs) f();
      for (const t of this.timeouts.filter((t) => t.at <= this.save.tick)) t.fn();
      this.timeouts = this.timeouts.filter((t) => t.at > this.save.tick);
      for (const it of this.intervals) if (this.save.tick % it.t === 0) it.fn();
      // physics: velocity carries entities, with a little drag
      for (const e of this.loaded.values()) {
        const r = e.rec;
        r.loc.x += r.vel.x; r.loc.y += r.vel.y; r.loc.z += r.vel.z;
        r.vel.x *= 0.9; r.vel.y *= 0.9; r.vel.z *= 0.9;
      }
      this.flush();
      // chunks follow the players: entities outside leave the simulation, entities inside return
      for (const e of [...this.loaded.values()]) {
        if (e.rec.typeId === 'minecraft:player') continue;
        if (!this.chunkLoaded(e.rec.dim, e.rec.loc)) {
          this.ev.bEntityRemove.fire({ removedEntity: e });
          e.attached = false;
          this.loaded.delete(e.rec.id);
          if (e.rec.typeId === 'basiliskra:hitbox') this.save.entities.delete(e.rec.id);     // transient: never saved
        }
      }
      for (const r of this.save.entities.values()) {
        if (!this.loaded.has(r.id) && this.chunkLoaded(r.dim, r.loc)) this.attach(r, 'entityLoad');
      }
      this.flush();
    }
  }

  /** The engine's start-up: scripts register custom commands here, before the world loads. */
  startup() {
    const sim = this;
    this.ev.startup.fire({ customCommandRegistry: {
      registerEnum(name, values) { if (!name.includes(':')) throw new Error('enum needs a namespace'); sim.enums.set(name, values); },
      registerCommand(def, cb) {
        if (!def.name.includes(':')) throw new Error('command needs a namespace');
        for (const prm of [...(def.mandatoryParameters ?? []), ...(def.optionalParameters ?? [])]) {
          if (prm.type === 'Enum' && !sim.enums.has(prm.name)) throw new Error(`enum ${prm.name} is not registered`);
        }
        sim.commands.set(def.name, { def, cb });
      },
    } });
  }

  /** A player types /name args: permission and cheats checked as the engine does; the callback runs restricted. */
  runCommand(name, player, ...args) {
    const c = this.commands.get(name);
    if (!c) return { status: 1, message: `unknown command ${name}` };
    if (c.def.cheatsRequired !== false && !this.cheats) return { status: 1, message: 'cheats are required' };
    const level = player.playerPermissionLevel >= 2 ? 1 : 0;
    if (c.def.permissionLevel > level) return { status: 1, message: 'permission denied' };
    if (c.def.optionalParameters?.[0]?.type === 'Enum' && args[0] !== undefined && !this.enums.get(c.def.optionalParameters[0].name).includes(args[0])) return { status: 1, message: 'bad enum value' };
    return c.cb({ sourceEntity: player, initiator: player, sourceType: 'Entity' }, ...args);
  }

  /** Close the world and open it again: nothing script-side survives, the save does. */
  restart(bootScript) {
    this.ev.shutdown.fire({});
    for (const r of [...this.save.entities.values()]) if (r.typeId === 'basiliskra:hitbox') this.save.entities.delete(r.id);
    const online = this.players.filter((p) => p.online).map((p) => ({ name: p.name, loc: { ...p.location }, dim: p.dimension.id, id: p.id, dyn: p.dyn, level: p.playerPermissionLevel }));
    this.players = [];
    this.boot();
    bootScript(this.api);
    for (const o of online) { const p = this.addPlayer(o.name, o.loc, o.dim); p.id = o.id; p.dyn = o.dyn; p.playerPermissionLevel = o.level; }
    this.startup();
    this.ev.worldLoad.fire({});
    for (const r of this.save.entities.values()) if (this.chunkLoaded(r.dim, r.loc)) this.attach(r, 'entityLoad');
    this.flush();
  }
}

class MockBlock {
  constructor(sim, dim, x, y, z) { this.sim = sim; this.dimension = dim; this.x = x; this.y = y; this.z = z; }
  get location() { return { x: this.x, y: this.y, z: this.z }; }
  get typeId() { return this.sim.blockId(this.dimension.id, this.x, this.y, this.z); }
  get isAir() { return this.typeId === 'minecraft:air'; }
  get isLiquid() { return this.typeId === 'minecraft:water' || this.typeId === 'minecraft:lava'; }
  get isValid() { return true; }
  setType(id) {
    // the game refuses an id it does not know; the pack's own blocks are known unless a test says otherwise
    if (this.sim.refuseBlocks?.has(id)) throw new Error(`unknown block ${id}`);
    this.sim.setBlock(this.dimension.id, this.x, this.y, this.z, id);
  }
  /** Leaves a player placed carry persistent_bit; everything else here is as the world made it. */
  get permutation() { const self = this; return { getState: (k) => (k === 'persistent_bit' ? self.sim.save.edits.get(`placed|${self.x},${self.y},${self.z}`) === true : undefined) }; }
  getRedstonePower() { return this.sim.save.edits.get(`power|${this.x},${this.y},${this.z}`) ?? 0; }
}

class MockDimension {
  constructor(sim, id) { this.sim = sim; this.id = id; this.heightRange = { min: -64, max: 320 }; }
  isChunkLoaded(p) { return this.sim.chunkLoaded(this.id, p); }
  getBlock(p) {
    this.sim.work.blocks++;                       // work counters for test/perf.mjs: calls into the engine, not time
    if (!this.isChunkLoaded(p)) throw new Error('LocationInUnloadedChunkError');
    return new MockBlock(this.sim, this, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  }
  getEntities(o = {}) {
    this.sim.work.queries++;
    const out = [];
    for (const e of this.sim.loaded.values()) {
      const r = e.rec;
      if (r.dim !== this.id) continue;
      if (o.type && r.typeId !== o.type) continue;
      if (o.excludeTypes && o.excludeTypes.includes(r.typeId)) continue;
      if (o.families && !o.families.some((f) => r.family.includes(f))) continue;
      if (o.location && o.maxDistance != null && Math.hypot(r.loc.x - o.location.x, r.loc.y - o.location.y, r.loc.z - o.location.z) > o.maxDistance) continue;
      out.push(e);
    }
    for (const p of this.sim.players) {
      if (!p.online || p.dimension.id !== this.id || o.type || (o.families) ) continue;
      if (o.excludeTypes && o.excludeTypes.includes('minecraft:player')) continue;
      if (o.location && o.maxDistance != null && Math.hypot(p.location.x - o.location.x, p.location.y - o.location.y, p.location.z - o.location.z) > o.maxDistance) continue;
      out.push(p);
    }
    return out;
  }
  /** The engine's filtered block query: every block of the listed types in the volume (loaded chunks only). */
  getBlocks(volume, o = {}, allowUnloaded = false) {
    this.sim.work.queries++;
    const lo = { x: Math.min(volume.from.x, volume.to.x), y: Math.min(volume.from.y, volume.to.y), z: Math.min(volume.from.z, volume.to.z) };
    const hi = { x: Math.max(volume.from.x, volume.to.x), y: Math.max(volume.from.y, volume.to.y), z: Math.max(volume.from.z, volume.to.z) };
    const types = new Set(o.includeTypes ?? []);
    const out = [];
    for (let x = lo.x; x <= hi.x; x++) for (let z = lo.z; z <= hi.z; z++) {
      if (!this.isChunkLoaded({ x, y: lo.y, z })) { if (!allowUnloaded) throw new Error('UnloadedChunksError'); continue; }
      for (let y = lo.y; y <= hi.y; y++) if (types.has(this.sim.blockId(this.id, x, y, z))) out.push({ x, y, z });
    }
    return { getBlockLocationIterator: () => out[Symbol.iterator]() };
  }
  getBlockFromRay(from, dir, o = {}) {
    this.sim.work.rays++;
    const max = o.maxDistance ?? 64;
    for (let d = 0; d <= max; d += 0.2) {
      const p = { x: from.x + dir.x * d, y: from.y + dir.y * d, z: from.z + dir.z * d };
      if (!this.isChunkLoaded(p)) return undefined;
      const id = this.sim.blockId(this.id, p.x, p.y, p.z);
      // passable blocks (grass, flowers, torches, snow layers...) are skipped unless asked for, as in the game
      const passable = /short_grass|tall_grass|fern|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|sapling|torch|snow_layer|deadbush/.test(id);
      if (passable && o.includePassableBlocks === false) continue;
      if (id !== 'minecraft:air' && id !== 'minecraft:water') return { block: new MockBlock(this.sim, this, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), faceLocation: p };
    }
    return undefined;
  }
  spawnEntity(typeId, loc, o = {}) {
    if (!this.isChunkLoaded(loc)) throw new Error('LocationInUnloadedChunkError');
    const rec = this.sim.newRecord(String(typeId), this.id, loc, o.initialRotation ?? 0);
    return this.sim.attach(rec, 'entitySpawn');
  }
  spawnItem(stack, loc) {
    const rec = this.sim.newRecord('minecraft:item', this.id, loc);
    rec.item = stack;
    return this.sim.attach(rec, 'entitySpawn');
  }
}

class MockEntity {
  constructor(sim, rec) { this.sim = sim; this.rec = rec; this.attached = true; }
  addEffect(id, duration, o = {}) { (this.rec.effects ??= []).push({ id, duration, amplifier: o.amplifier ?? 0 }); return {}; }
  get id() { return this.rec.id; }
  get typeId() { return this.rec.typeId; }
  get isValid() { return this.attached; }
  need() { if (!this.attached) throw new Error('InvalidEntityError'); }
  get location() { this.need(); return { ...this.rec.loc }; }
  get dimension() { this.need(); return this.sim.dims.get(this.rec.dim); }
  get isInWater() { return this.sim.blockId(this.rec.dim, this.rec.loc.x, this.rec.loc.y, this.rec.loc.z) === 'minecraft:water'; }
  getRotation() { this.need(); return { ...this.rec.rot }; }
  setRotation(r) { this.need(); this.rec.rot = { x: r.x, y: r.y }; }
  getVelocity() { this.need(); return { ...this.rec.vel }; }
  applyImpulse(v) { this.need(); if (![v.x, v.y, v.z].every(Number.isFinite)) throw new Error('ArgumentOutOfBoundsError'); this.rec.vel.x += v.x; this.rec.vel.y += v.y; this.rec.vel.z += v.z; }
  applyKnockback(h, v) { this.need(); this.rec.vel.x += h.x; this.rec.vel.z += h.z; this.rec.vel.y += v; }
  teleport(loc, o = {}) { this.need(); this.rec.loc = { ...loc }; if (o.rotation) this.rec.rot = { ...o.rotation }; if (o.dimension) this.rec.dim = o.dimension.id; }
  remove() { this.need(); this.sim.destroy(this); }
  getProperty(k) { this.need(); return this.rec.props[k]; }
  setProperty(k, v) {
    this.need();
    const d = PROPS[k];
    if (!d) throw new Error(`property ${k} is not defined on ${this.rec.typeId}`);
    if (d.type === 'bool' && typeof v !== 'boolean') throw new Error(`property ${k} expects bool, got ${v}`);
    if (d.type === 'int' && (!Number.isInteger(v) || v < d.range[0] || v > d.range[1])) throw new Error(`property ${k}=${v} outside ${d.range}`);
    this.rec.props[k] = v;
  }
  getDynamicProperty(k) { this.need(); return this.rec.dyn[k]; }
  setDynamicProperty(k, v) { this.need(); this.rec.dyn[k] = v; }
  triggerEvent(n) {
    this.need();
    const known = this.rec.typeId === 'basiliskra:basiliskra' ? EVENTS : HIT_EVENTS;
    if (!known.includes(n)) throw new Error(`event ${n} is not defined on ${this.rec.typeId}`);
    this.rec.events.push(n);
  }
  getComponent(id) {
    this.need();
    const rec = this.rec, sim = this.sim, self = this;
    if (id === 'minecraft:health') return { get currentValue() { return rec.health; }, setCurrentValue(v) { rec.health = v; }, effectiveMax: 600 };
    if (id === 'minecraft:item') return rec.item ? { itemStack: rec.item } : undefined;
    if (id === 'minecraft:rideable') return { getRiders: () => rec.riders };
    if (id === 'minecraft:riding') return undefined;
    return undefined;
  }
  applyDamage(amount, opts = {}) {
    this.need();
    const ev = { hurtEntity: this, damage: amount, damageSource: { cause: opts.cause ?? 'entityAttack', damagingEntity: opts.damagingEntity }, cancel: false };
    this.sim.ev.bEntityHurt.fire(ev);
    if (ev.cancel || ev.damage <= 0) return false;
    this.rec.health -= ev.damage;
    this.sim.log.damage.push({ id: this.id, type: this.typeId, amount: ev.damage, tick: this.sim.save.tick });
    const src = ev.damageSource;
    this.sim.queue.push(() => { if (this.attached) this.sim.ev.entityHurt.fire({ hurtEntity: this, damage: ev.damage, damageSource: src }); });
    if (this.rec.health <= 0) {
      const dead = this;
      this.sim.queue.push(() => this.sim.ev.entityDie.fire({ deadEntity: dead, damageSource: src }));
      this.sim.queue.push(() => this.sim.destroy(dead, true));
    }
    return true;
  }
  /** /kill: no before-event can trim it. */
  kill() { this.rec.health = 0; const dead = this; this.sim.queue.push(() => this.sim.ev.entityDie.fire({ deadEntity: dead, damageSource: { cause: 'selfDestruct' } })); this.sim.queue.push(() => this.sim.destroy(dead, true)); }
}

let playerSeq = 1;
class MockPlayer {
  constructor(sim, name, loc, dim) {
    this.sim = sim; this.name = name; this.id = 'p' + (playerSeq++); this.typeId = 'minecraft:player'; this.online = true;
    this.loc = { ...loc }; this.dim = dim; this.mode = GameMode.Survival; this.health = 20; this.hand = null; this.inv = []; this.vehicle = null; this.heard = []; this.seen = [];
    this.vel = { x: 0, y: 0, z: 0 };
    this.playerPermissionLevel = 2; this.messages = []; this.forms = []; this.answers = []; this.dyn = {}; this.view = { x: 0, y: 0, z: 1 };
    this.onScreenDisplay = { setActionBar: (t) => this.messages.push('[actionbar] ' + t) };
    // the camera: what a cutscene did to it is kept, so a test can see that it was taken and given back
    this.cam = { log: [], held: false };
    const cam = this.cam;
    this.camera = {
      setCamera: (preset, o) => { cam.held = true; cam.log.push({ preset, at: o?.location, look: o?.facingLocation, tick: sim.save.tick }); },
      clear: () => { cam.held = false; cam.log.push({ clear: true, tick: sim.save.tick }); },
      fade: (o) => { cam.log.push({ fade: o?.fadeColor, tick: sim.save.tick }); },
    };
  }
  get isValid() { return this.online; }
  sendMessage(m) { this.messages.push(String(m)); }
  addEffect(id, duration, o = {}) { (this.effects ??= []).push({ id, duration, amplifier: o.amplifier ?? 0, tick: this.sim.save.tick }); return {}; }
  getViewDirection() { return { ...this.view }; }
  getDynamicProperty(k) { return this.dyn[k]; }
  setDynamicProperty(k, v) { this.dyn[k] = v; }
  /** The player uses the item in hand (right click / long press). */
  use(typeId) { this.sim.queue.push(() => this.sim.ev.itemUse.fire({ itemStack: { typeId }, source: this })); }
  get location() { return { ...this.loc }; }
  get dimension() { return this.dim; }
  get isInWater() { return this.sim.blockId(this.dim.id, this.loc.x, this.loc.y, this.loc.z) === 'minecraft:water'; }
  getHeadLocation() { return { x: this.loc.x, y: this.loc.y + 1.62, z: this.loc.z }; }
  getGameMode() { return this.mode; }
  getVelocity() { return { ...this.vel }; }
  playSound(id, o = {}) { this.heard.push({ id, tick: this.sim.save.tick, ...o }); this.sim.log.sounds.push({ id, to: this.name, tick: this.sim.save.tick }); }
  spawnParticle(id, loc, vars) { this.seen.push({ id, loc, tick: this.sim.save.tick, vars: vars?.v }); this.sim.log.particles.push({ id, to: this.name, tick: this.sim.save.tick }); }
  runCommand(c) { this.sim.log.commands.push(c); return { successCount: 1 }; }
  applyKnockback(h, v) { this.vel.x += h.x; this.vel.z += h.z; this.loc.x += h.x; this.loc.z += h.z; }
  applyDamage(amount, opts = {}) { this.health -= amount; this.sim.log.damage.push({ id: this.id, type: 'minecraft:player', name: this.name, amount, tick: this.sim.save.tick }); return true; }
  getComponent(id) {
    const self = this;
    if (id === 'minecraft:riding') return this.vehicle ? { entityRidingOn: this.vehicle } : undefined;
    if (id === 'minecraft:equippable') return { getEquipment: (slot) => (slot === undefined || slot === 'Mainhand' ? self.hand : null) };
    if (id === 'minecraft:inventory') return { container: { size: self.inv.length, getItem: (i) => self.inv[i], addItem: (it) => { self.inv.push(it); return undefined; } } };
    return undefined;
  }
  moveTo(loc, dimId) { this.loc = { ...loc }; if (dimId) this.dim = this.sim.dims.get(dimId); }
}
