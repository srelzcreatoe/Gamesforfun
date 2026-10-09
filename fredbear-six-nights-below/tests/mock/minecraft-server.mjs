// Headless stand-in for `@minecraft/server` 2.10.0, used ONLY by the
// integration tests. It is not Minecraft: it models the subset of the API the
// map's scripts call, closely enough to run the real Game state machine,
// builder, actuator bus and puppets for thousands of ticks.
//
// What it simulates (and validates against official 1.26.50 metadata):
//   * a voxel world (flat: dirt up to y -61) with BlockPermutation.resolve
//     checked against tools/ref/mojang-blocks.json;
//   * world.structureManager.place reading the pack's real .mcstructure files
//     (palette + command-block NBT);
//   * command blocks: impulse blocks fire when a redstone block is placed next
//     to them, chain blocks follow with their TickDelay, repeating blocks run
//     every TickDelay ticks; a small interpreter executes setblock / fill
//     (incl. block states and `replace` filters) / scriptevent, every other
//     command is recorded;
//   * entities (identifiers must exist in the BP), players (camera, input
//     permissions, effects checked against mojang-effects.json, sounds checked
//     against the RP sound_definitions.json, inventory), dynamic properties,
//     events, system.run/runTimeout/runInterval/runJob and custom commands.
// What it does NOT simulate: rendering, physics, redstone beyond the pad ->
// impulse link, lighting, chunk streaming, real timing budgets.
import fs from 'node:fs';
import path from 'node:path';
import { readNbt, plain } from '../../tools/lib/nbt.mjs';
import { loadBlockMeta, checkBlock } from '../../tools/validate_blocks.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const BLOCK_META = loadBlockMeta();
const SOUND_DEFS = readJson('packs/FredbearRP/sounds/sound_definitions.json').sound_definitions;
const SOUND_IDS = new Set(Object.keys(SOUND_DEFS));
const PARTICLES = new Set(fs.readFileSync(path.join(ROOT, 'tools/ref/vanilla_particles.txt'), 'utf8').split('\n').filter(Boolean));
const EFFECT_IDS = new Set(readJson('tools/ref/mojang-effects.json').data_items.map((d) => d.name));
const CAMERA_PRESETS = new Set(readJson('tools/ref/mojang-camera-presets.json').data_items.map((d) => d.name));
const VANILLA_ITEMS = new Set(readJson('tools/ref/mojang-items.json').data_items.map((d) => d.name));
const ENTITY_DEFS = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'packs/FredbearBP/entities'))) {
  const e = readJson(`packs/FredbearBP/entities/${f}`)['minecraft:entity'];
  ENTITY_DEFS.set(e.description.identifier, { families: e.components['minecraft:type_family']?.family ?? [], properties: e.description.properties ?? {} });
}
const CUSTOM_ITEMS = new Set(fs.readdirSync(path.join(ROOT, 'packs/FredbearBP/items')).map((f) => readJson(`packs/FredbearBP/items/${f}`)['minecraft:item'].description.identifier));
const STRUCTURE_DIR = path.join(ROOT, 'packs/FredbearBP/structures');

// ------------------------------------------------------------------ enums
export const ItemLockMode = Object.freeze({ inventory: 'inventory', none: 'none', slot: 'slot' });
export const EntityComponentTypes = Object.freeze({ Inventory: 'minecraft:inventory' });
export const InputPermissionCategory = Object.freeze({ Camera: 1, Movement: 2, LateralMovement: 4, Sneak: 5, Jump: 6, Mount: 7, Dismount: 8 });
export const InputButton = Object.freeze({ Jump: 'Jump', Sneak: 'Sneak' });
export const ButtonState = Object.freeze({ Pressed: 'Pressed', Released: 'Released' });
export const EasingType = Object.freeze({ Linear: 'Linear', InOutSine: 'InOutSine' });
export const GameMode = Object.freeze({ Adventure: 'Adventure', Creative: 'Creative', Spectator: 'Spectator', Survival: 'Survival' });
export const CommandPermissionLevel = Object.freeze({ Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4 });
export const CustomCommandParamType = Object.freeze({ Boolean: 'Boolean', Integer: 'Integer', Float: 'Float', String: 'String', Enum: 'Enum' });
export const CustomCommandStatus = Object.freeze({ Success: 0, Failure: 1 });
export const ScriptEventSource = Object.freeze({ Block: 'Block', Entity: 'Entity', NPCDialogue: 'NPCDialogue', Server: 'Server' });

// ------------------------------------------------------------------ test-side state
export const STATE = {
  errors: [], // API misuse detected by the mock (bad block, sound, effect, entity...)
  handlerErrors: [], // exceptions thrown inside event handlers / scheduled callbacks
  commands: [], // every command executed (script runCommand + command blocks)
  sounds: [], // { id, where }
  particles: [], // { id, loc } (last 400)
  music: [], // playMusic / stopMusic calls
  cbRuns: 0,
  maxFill: 0,
};
const misuse = (msg) => {
  STATE.errors.push(msg);
  throw new Error(msg);
};

class Signal {
  constructor() {
    this.handlers = [];
  }

  subscribe(cb, options) {
    this.handlers.push({ cb, options });
    return cb;
  }

  unsubscribe(cb) {
    this.handlers = this.handlers.filter((h) => h.cb !== cb);
  }

  emit(ev, accept) {
    for (const h of [...this.handlers]) {
      if (accept && !accept(h.options)) continue;
      try {
        h.cb(ev);
      } catch (e) {
        STATE.handlerErrors.push(e?.stack ?? String(e));
      }
    }
  }
}

// ------------------------------------------------------------------ blocks
const BOUNDS = { x0: -48, x1: 271, y0: -64, y1: 15, z0: -48, z1: 271 };
const SX = BOUNDS.x1 - BOUNDS.x0 + 1;
const SY = BOUNDS.y1 - BOUNDS.y0 + 1;
const SZ = BOUNDS.z1 - BOUNDS.z0 + 1;

function canon(name, states) {
  const keys = Object.keys(states ?? {}).sort();
  return keys.length ? `${name}[${keys.map((k) => `${k}=${states[k]}`).join(',')}]` : name;
}

export class BlockPermutation {
  constructor(id, states) {
    this.type = { id };
    this.states = states;
    this.key = canon(id, states);
  }

  static resolve(name, states = {}) {
    const id = name.includes(':') ? name : `minecraft:${name}`;
    const errs = checkBlock(BLOCK_META, id, states);
    if (errs.length) throw new Error(`BlockPermutation.resolve: ${errs.join('; ')}`);
    return new BlockPermutation(id, { ...states });
  }

  getAllStates() {
    return { ...this.states };
  }
}

class Store {
  constructor() {
    this.keys = ['minecraft:air', 'minecraft:dirt'];
    this.index = new Map(this.keys.map((k, i) => [k, i]));
    this.data = new Uint16Array(SX * SY * SZ);
    for (let x = 0; x < SX; x++) for (let y = 0; y <= -61 - BOUNDS.y0; y++) for (let z = 0; z < SZ; z++) this.data[(x * SY + y) * SZ + z] = 1;
    this.blockEntities = new Map(); // "x,y,z" -> data
    this.signs = new Map();
  }

  inside(x, y, z) {
    return x >= BOUNDS.x0 && x <= BOUNDS.x1 && y >= BOUNDS.y0 && y <= BOUNDS.y1 && z >= BOUNDS.z0 && z <= BOUNDS.z1;
  }

  idx(x, y, z) {
    return ((x - BOUNDS.x0) * SY + (y - BOUNDS.y0)) * SZ + (z - BOUNDS.z0);
  }

  kid(key) {
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.keys.length;
      this.keys.push(key);
      this.index.set(key, i);
    }
    return i;
  }

  get(x, y, z) {
    return this.keys[this.data[this.idx(x, y, z)]];
  }

  set(x, y, z, key) {
    const k = `${x},${y},${z}`;
    const old = this.get(x, y, z);
    this.data[this.idx(x, y, z)] = this.kid(key);
    if (old !== key) {
      if (!key.startsWith('minecraft:command_block') && !key.startsWith('minecraft:repeating_command_block') && !key.startsWith('minecraft:chain_command_block')) this.blockEntities.delete(k);
      if (!key.includes('sign')) this.signs.delete(k);
      onBlockChanged(x, y, z, key);
    }
  }
}

let store = new Store();
const typeOf = (key) => key.split('[')[0];

// Chunk loading: tests may unload chunk columns to emulate a player far away
// without ticking areas. Unloaded chunks have no blocks, and their entities are
// invalid and invisible to queries until the chunk loads again.
const unloadedChunks = new Set();
const chunkKey = (x, z) => `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
const loadedAt = (x, z) => !unloadedChunks.has(chunkKey(x, z));

class SignComponent {
  constructor(k) {
    this.k = k;
  }

  setText(t) {
    store.signs.set(this.k, { ...(store.signs.get(this.k) ?? {}), text: t });
  }

  setWaxed(w) {
    store.signs.set(this.k, { ...(store.signs.get(this.k) ?? {}), waxed: w });
  }

  getText() {
    return store.signs.get(this.k)?.text;
  }
}

class Block {
  constructor(dimension, x, y, z) {
    this.dimension = dimension;
    this.location = { x, y, z };
    this.x = x;
    this.y = y;
    this.z = z;
  }

  get typeId() {
    return typeOf(store.get(this.x, this.y, this.z));
  }

  get permutation() {
    const key = store.get(this.x, this.y, this.z);
    return { type: { id: typeOf(key) }, key };
  }

  get isValid() {
    return true;
  }

  setType(type) {
    const p = BlockPermutation.resolve(type);
    store.set(this.x, this.y, this.z, p.key);
  }

  setPermutation(p) {
    store.set(this.x, this.y, this.z, p.key);
  }

  getComponent(id) {
    if (id === 'minecraft:sign' && this.typeId.includes('sign')) return new SignComponent(`${this.x},${this.y},${this.z}`);
    return undefined;
  }
}

export class BlockVolume {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }

  *cells() {
    const x1 = Math.min(this.from.x, this.to.x);
    const x2 = Math.max(this.from.x, this.to.x);
    const y1 = Math.min(this.from.y, this.to.y);
    const y2 = Math.max(this.from.y, this.to.y);
    const z1 = Math.min(this.from.z, this.to.z);
    const z2 = Math.max(this.from.z, this.to.z);
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) yield [x, y, z];
  }

  getCapacity() {
    return (Math.abs(this.to.x - this.from.x) + 1) * (Math.abs(this.to.y - this.from.y) + 1) * (Math.abs(this.to.z - this.from.z) + 1);
  }
}

export class ListBlockVolume {
  constructor(locations) {
    this.locations = locations;
  }

  *cells() {
    for (const l of this.locations) yield [l.x, l.y, l.z];
  }

  getCapacity() {
    return this.locations.length;
  }
}

// ------------------------------------------------------------------ command blocks
const CB_TYPES = new Set(['minecraft:command_block', 'minecraft:chain_command_block', 'minecraft:repeating_command_block']);
const pendingCb = []; // { at, x, y, z }
const FACING_DELTA = { 0: [0, -1, 0], 1: [0, 1, 0], 2: [0, 0, -1], 3: [0, 0, 1], 4: [-1, 0, 0], 5: [1, 0, 0] };

function onBlockChanged(x, y, z, key) {
  if (typeOf(key) !== 'minecraft:redstone_block') return;
  // A redstone block powers adjacent "needs redstone" impulse command blocks.
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const k = `${x + dx},${y + dy},${z + dz}`;
    const be = store.blockEntities.get(k);
    if (be && be.mode === 0 && !be.auto) pendingCb.push({ at: system.currentTick + 1, x: x + dx, y: y + dy, z: z + dz });
  }
}

function facingOf(x, y, z) {
  const m = /facing_direction=(\d)/.exec(store.get(x, y, z));
  return m ? Number(m[1]) : 5;
}

/** Run a command block and schedule the chain behind it. */
function runCommandBlock(x, y, z) {
  const be = store.blockEntities.get(`${x},${y},${z}`);
  if (!be || !loadedAt(x, z)) return;
  STATE.cbRuns++;
  executeCommand(be.command, { block: new Block(world.getDimension('overworld'), x, y, z) });
  const [dx, dy, dz] = FACING_DELTA[facingOf(x, y, z)];
  const nx = x + dx;
  const ny = y + dy;
  const nz = z + dz;
  const next = store.blockEntities.get(`${nx},${ny},${nz}`);
  if (next && next.mode === 2 && next.auto) {
    if (next.delay > 0) pendingCb.push({ at: system.currentTick + next.delay, x: nx, y: ny, z: nz });
    else runCommandBlock(nx, ny, nz);
  }
}

function tickCommandBlocks() {
  const due = pendingCb.filter((p) => p.at <= system.currentTick);
  for (const p of due) pendingCb.splice(pendingCb.indexOf(p), 1);
  for (const p of due) runCommandBlock(p.x, p.y, p.z);
  for (const [k, be] of store.blockEntities) {
    if (be.mode === 1 && be.auto && system.currentTick % Math.max(1, be.delay) === 0) {
      const [x, y, z] = k.split(',').map(Number);
      runCommandBlock(x, y, z);
    }
  }
}

function parseBlockArg(tokens, i) {
  let name = tokens[i];
  let states = {};
  let j = i + 1;
  if (tokens[j]?.startsWith('[')) {
    let raw = tokens[j];
    while (!raw.endsWith(']')) raw += ` ${tokens[++j]}`;
    j++;
    const body = raw.slice(1, -1).trim();
    if (body) {
      for (const part of body.split(',')) {
        const [k, v] = part.split('=');
        const key = k.trim().replace(/^"|"$/g, '');
        const val = v.trim();
        states[key] = val === 'true' ? true : val === 'false' ? false : /^-?\d+$/.test(val) ? Number(val) : val.replace(/^"|"$/g, '');
      }
    }
  }
  if (!name.includes(':')) name = `minecraft:${name}`;
  return { perm: BlockPermutation.resolve(name, states), next: j };
}

/** Executes the commands the map uses that change world state; records everything. */
export function executeCommand(cmd, ctx = {}) {
  STATE.commands.push(cmd);
  const t = cmd.trim().split(/\s+/);
  const num = (s) => Number(s);
  switch (t[0]) {
    case 'setblock': {
      const [x, y, z] = [num(t[1]), num(t[2]), num(t[3])];
      const { perm } = parseBlockArg(t, 4);
      if (!store.inside(x, y, z) || !loadedAt(x, z)) return 0;
      store.set(x, y, z, perm.key);
      return 1;
    }
    case 'fill': {
      const a = [num(t[1]), num(t[2]), num(t[3])];
      const b = [num(t[4]), num(t[5]), num(t[6])];
      const { perm, next } = parseBlockArg(t, 7);
      let filter = null;
      if (t[next] === 'replace' && t[next + 1]) filter = parseBlockArg(t, next + 1).perm.type.id;
      const vol = (Math.abs(a[0] - b[0]) + 1) * (Math.abs(a[1] - b[1]) + 1) * (Math.abs(a[2] - b[2]) + 1);
      if (vol > 32768) misuse(`fill volume ${vol} > 32768: ${cmd}`);
      let n = 0;
      for (const [x, y, z] of new BlockVolume({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }).cells()) {
        if (!store.inside(x, y, z) || !loadedAt(x, z)) continue;
        if (filter && typeOf(store.get(x, y, z)) !== filter) continue;
        store.set(x, y, z, perm.key);
        n++;
      }
      return n;
    }
    case 'scriptevent': {
      const id = t[1];
      const message = t.slice(2).join(' ');
      system.afterEvents.scriptEventReceive.emit({ id, message, sourceBlock: ctx.block, sourceEntity: ctx.entity, sourceType: ctx.block ? ScriptEventSource.Block : ScriptEventSource.Server });
      return 1;
    }
    case 'playsound': {
      if (!SOUND_IDS.has(t[1]) && t[1].startsWith('fb.')) misuse(`playsound of undefined sound ${t[1]}`);
      STATE.sounds.push({ id: t[1], where: 'command' });
      return 1;
    }
    default:
      return 1;
  }
}

// ------------------------------------------------------------------ entities
let nextEntityId = 1;
const entities = new Map();

class Entity {
  constructor(typeId, location, rotation = 0) {
    if (!ENTITY_DEFS.has(typeId) && typeId !== 'minecraft:player') misuse(`spawnEntity: unknown entity ${typeId}`);
    this.id = `e${nextEntityId++}`;
    this.typeId = typeId;
    this.location = { ...location };
    this.rotation = { x: 0, y: rotation };
    this.tags = new Set();
    this.props = {};
    this.valid = true;
    this.dimension = undefined;
    const def = ENTITY_DEFS.get(typeId);
    if (def) for (const [k, v] of Object.entries(def.properties)) this.props[k] = v.default;
  }

  get isValid() {
    return this.valid && (this.typeId === 'minecraft:player' || loadedAt(this.location.x, this.location.z));
  }

  teleport(loc, opts) {
    if (!this.isValid) throw new Error('entity is invalid');
    this.location = { ...loc };
    if (opts?.rotation) this.rotation = { ...opts.rotation };
  }

  remove() {
    this.valid = false;
    entities.delete(this.id);
  }

  addTag(t) {
    this.tags.add(t);
    return true;
  }

  hasTag(t) {
    return this.tags.has(t);
  }

  getTags() {
    return [...this.tags];
  }

  setProperty(name, value) {
    if (!this.isValid) throw new Error('entity is invalid');
    const def = ENTITY_DEFS.get(this.typeId)?.properties?.[name];
    if (!def) misuse(`setProperty: ${this.typeId} has no property ${name}`);
    if (def.type === 'enum' && !def.values.includes(value)) misuse(`setProperty: ${name}='${value}' not in enum`);
    if (def.type === 'bool' && typeof value !== 'boolean') misuse(`setProperty: ${name} expects a boolean`);
    this.props[name] = value;
  }

  getProperty(name) {
    return this.props[name];
  }

  getRotation() {
    return { ...this.rotation };
  }
}

// ------------------------------------------------------------------ players
class Container {
  constructor(size) {
    this.size = size;
    this.slots = new Array(size).fill(undefined);
  }

  setItem(i, item) {
    this.slots[i] = item;
  }

  getItem(i) {
    return this.slots[i];
  }

  clearAll() {
    this.slots.fill(undefined);
  }
}

export class ItemStack {
  constructor(typeId, amount = 1) {
    if (!CUSTOM_ITEMS.has(typeId) && !VANILLA_ITEMS.has(typeId)) misuse(`ItemStack: unknown item ${typeId}`);
    this.typeId = typeId;
    this.amount = amount;
    this.lockMode = ItemLockMode.none;
    this.keepOnDeath = false;
  }
}

class Player extends Entity {
  constructor(name) {
    super('minecraft:player', { x: 0.5, y: -60, z: 0.5 });
    this.name = name;
    this.inventory = new Container(36);
    this.selectedSlotIndex = 0;
    this.gameMode = GameMode.Survival;
    this.effects = new Map();
    this.messages = [];
    this.actionBar = '';
    this.titles = [];
    this.sounds = [];
    this.permissions = {};
    this.cameraState = { preset: null, history: [], fades: 0 };
    const self = this;
    this.camera = {
      setCamera(preset, opts) {
        if (!CAMERA_PRESETS.has(preset)) misuse(`setCamera: unknown preset ${preset}`);
        self.cameraState.preset = preset;
        self.cameraState.history.push({ preset, opts });
      },
      clear() {
        self.cameraState.preset = null;
      },
      fade() {
        self.cameraState.fades++;
      },
    };
    this.inputPermissions = {
      setPermissionCategory(c, v) {
        self.permissions[c] = v;
      },
      isPermissionCategoryEnabled(c) {
        return self.permissions[c] ?? true;
      },
    };
    this.onScreenDisplay = {
      setActionBar(t) {
        self.actionBar = String(t);
      },
      setTitle(t, opts) {
        self.titles.push({ t, opts });
      },
    };
  }

  getComponent(id) {
    if (id === 'minecraft:inventory') return { container: this.inventory };
    return undefined;
  }

  setGameMode(m) {
    this.gameMode = m;
  }

  getEffects() {
    return [...this.effects.keys()].map((typeId) => ({ typeId }));
  }

  addEffect(id, duration, opts) {
    const full = id.includes(':') ? id : `minecraft:${id}`;
    if (!EFFECT_IDS.has(full)) misuse(`addEffect: unknown effect ${id}`);
    this.effects.set(full, { duration, opts });
  }

  removeEffect(id) {
    const full = id.includes(':') ? id : `minecraft:${id}`;
    if (!EFFECT_IDS.has(full)) misuse(`removeEffect: unknown effect ${id}`);
    return this.effects.delete(full);
  }

  playSound(id, opts) {
    if (!SOUND_IDS.has(id)) misuse(`player.playSound: undefined sound ${id}`);
    this.sounds.push(id);
    STATE.sounds.push({ id, where: 'player' });
    return { stop() {} };
  }

  /** Music track (MusicOptions { fade, loop, volume }); only music-category sounds are tracks. */
  playMusic(trackId, opts = {}) {
    if (SOUND_DEFS[trackId]?.category !== 'music') misuse(`player.playMusic: ${trackId} is not a music-category sound`);
    this.music = { id: trackId, loop: !!opts.loop };
    STATE.music.push({ id: trackId, loop: !!opts.loop, tick: system.currentTick });
  }

  stopMusic() {
    this.music = null;
    STATE.music.push({ id: null, tick: system.currentTick });
  }

  sendMessage(m) {
    this.messages.push(String(m));
  }

  getHeadLocation() {
    return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z };
  }

  getViewDirection() {
    const yaw = ((this.rotation.y ?? 0) * Math.PI) / 180;
    return { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  }
}

// ------------------------------------------------------------------ dimension / world / system
function matchesQuery(e, q = {}) {
  if (!e.isValid) return false;
  if (q.type && e.typeId !== q.type) return false;
  if (q.families && !q.families.every((f) => (ENTITY_DEFS.get(e.typeId)?.families ?? []).includes(f))) return false;
  if (q.tags && !q.tags.every((t) => e.tags.has(t))) return false;
  if (q.location && q.maxDistance !== undefined) {
    const d = Math.hypot(e.location.x - q.location.x, e.location.y - q.location.y, e.location.z - q.location.z);
    if (d > q.maxDistance) return false;
  }
  return true;
}

class Dimension {
  constructor() {
    this.id = 'minecraft:overworld';
  }

  getBlock(loc) {
    const x = Math.floor(loc.x);
    const y = Math.floor(loc.y);
    const z = Math.floor(loc.z);
    if (!store.inside(x, y, z) || !loadedAt(x, z)) return undefined;
    return new Block(this, x, y, z);
  }

  setBlockPermutation(loc, perm) {
    const b = this.getBlock(loc);
    if (!b) throw new Error('UnloadedChunksError');
    b.setPermutation(perm);
  }

  fillBlocks(volume, perm, opts) {
    const include = opts?.blockFilter?.includeTypes;
    STATE.maxFill = Math.max(STATE.maxFill, volume.getCapacity());
    let n = 0;
    for (const [x, y, z] of volume.cells()) {
      if (!store.inside(x, y, z) || !loadedAt(x, z)) throw new Error(`UnloadedChunksError at ${x},${y},${z}`);
      if (include && !include.includes(typeOf(store.get(x, y, z)))) continue;
      store.set(x, y, z, perm.key);
      n++;
    }
    return new ListBlockVolume([]);
  }

  isChunkLoaded(loc) {
    return store.inside(Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z)) && loadedAt(loc.x, loc.z);
  }

  runCommand(cmd) {
    return { successCount: executeCommand(cmd) };
  }

  spawnEntity(typeId, loc, opts) {
    if (!this.isChunkLoaded(loc)) throw new Error('UnloadedChunksError');
    const e = new Entity(typeId, loc, opts?.initialRotation ?? 0);
    e.dimension = this;
    entities.set(e.id, e);
    return e;
  }

  getEntities(q) {
    return [...entities.values()].filter((e) => e.typeId !== 'minecraft:player' && matchesQuery(e, q));
  }

  getPlayers(q) {
    let list = world.getAllPlayers().filter((p) => matchesQuery(p, q));
    if (q?.location && q?.closest) {
      list = list.sort((a, b) => Math.hypot(a.location.x - q.location.x, a.location.z - q.location.z) - Math.hypot(b.location.x - q.location.x, b.location.z - q.location.z)).slice(0, q.closest);
    }
    return list;
  }

  playSound(id, loc, opts) {
    if (!SOUND_IDS.has(id)) misuse(`dimension.playSound: undefined sound ${id}`);
    STATE.sounds.push({ id, where: 'world', loc });
    return { stop() {} };
  }

  spawnParticle(id, loc) {
    if (!PARTICLES.has(id)) misuse(`spawnParticle: ${id} is not a vanilla particle`);
    STATE.particles.push({ id, loc: { ...loc }, tick: system.currentTick });
    if (STATE.particles.length > 400) STATE.particles.shift();
  }
}

const overworld = new Dimension();
let dynamicProps = new Map();
let players = [];

function freshAfterEvents() {
  return {
    worldLoad: new Signal(),
    playerSpawn: new Signal(),
    itemUse: new Signal(),
    playerButtonInput: new Signal(),
    playerHotbarSelectedSlotChange: new Signal(),
  };
}

/** NBT stores boolean block states as TAG_Byte 0/1; the game reads them as booleans. */
function nbtStates(states = {}) {
  const out = {};
  for (const [k, v] of Object.entries(states)) {
    const vals = BLOCK_META.props[k]?.values?.map((x) => x.value) ?? [];
    out[k] = vals.length && vals.every((x) => typeof x === 'boolean') && (v === 0 || v === 1) ? v === 1 : v;
  }
  return out;
}

const structureIds = () => {
  const out = [];
  const walk = (d, prefix) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(d, f.name), `${prefix}${f.name}/`);
      else if (f.name.endsWith('.mcstructure')) out.push({ rel: `${prefix}${f.name}`, file: path.join(d, f.name) });
    }
  };
  walk(STRUCTURE_DIR, '');
  // A structure at structures/<ns>/<name>.mcstructure is addressed as "<ns>:<name>".
  return out.map((s) => {
    const parts = s.rel.replace(/\.mcstructure$/, '').split('/');
    return { id: parts.length > 1 ? `${parts[0]}:${parts.slice(1).join('/')}` : `mystructure:${parts[0]}`, file: s.file };
  });
};

export const world = {
  afterEvents: freshAfterEvents(),
  getDimension(id) {
    if (id !== 'overworld' && id !== 'minecraft:overworld') misuse(`getDimension(${id})`);
    return overworld;
  },
  getAllPlayers() {
    return players.filter((p) => p.valid);
  },
  getDynamicProperty(k) {
    return dynamicProps.get(k);
  },
  setDynamicProperty(k, v) {
    if (v === undefined) dynamicProps.delete(k);
    else {
      if (typeof v === 'string' && v.length > 32767) misuse(`dynamic property ${k} too long (${v.length})`);
      dynamicProps.set(k, v);
    }
  },
  structureManager: {
    getPackStructureIds() {
      return structureIds().map((s) => s.id);
    },
    place(id, dimension, loc) {
      const s = structureIds().find((x) => x.id === id);
      if (!s) misuse(`structure ${id} not found`);
      const { root } = readNbt(fs.readFileSync(s.file));
      const d = plain(root);
      const [sx, sy, sz] = d.size;
      const layer = d.structure.block_indices[0];
      const pal = d.structure.palette.default;
      for (let x = 0; x < sx; x++) {
        for (let y = 0; y < sy; y++) {
          for (let z = 0; z < sz; z++) {
            const i = (x * sy + y) * sz + z;
            const pi = layer[i];
            if (pi < 0) continue;
            const p = pal.block_palette[pi];
            const perm = BlockPermutation.resolve(p.name, nbtStates(p.states));
            const wx = loc.x + x;
            const wy = loc.y + y;
            const wz = loc.z + z;
            store.set(wx, wy, wz, perm.key);
            const be = pal.block_position_data?.[String(i)]?.block_entity_data;
            if (be && CB_TYPES.has(p.name)) {
              store.blockEntities.set(`${wx},${wy},${wz}`, { command: be.Command, mode: be.LPCommandMode, auto: !!be.auto, delay: be.TickDelay, conditional: !!be.conditionalMode, name: be.CustomName });
            }
          }
        }
      }
    },
  },
};

const scheduled = []; // { id, at, fn, every }
let nextRunId = 1;
const jobs = [];
const startup = new Signal();

export const system = {
  currentTick: 0,
  afterEvents: { scriptEventReceive: new Signal() },
  beforeEvents: { startup },
  run(fn) {
    return this.runTimeout(fn, 1);
  },
  runTimeout(fn, ticks = 1) {
    const id = nextRunId++;
    scheduled.push({ id, at: this.currentTick + Math.max(1, ticks), fn, every: 0 });
    return id;
  },
  runInterval(fn, ticks = 1) {
    const id = nextRunId++;
    scheduled.push({ id, at: this.currentTick + Math.max(1, ticks), fn, every: Math.max(1, ticks) });
    return id;
  },
  clearRun(id) {
    const i = scheduled.findIndex((s) => s.id === id);
    if (i >= 0) scheduled.splice(i, 1);
  },
  runJob(gen) {
    const id = nextRunId++;
    jobs.push({ id, gen });
    return id;
  },
  clearJob(id) {
    const i = jobs.findIndex((j) => j.id === id);
    if (i >= 0) jobs.splice(i, 1);
  },
};

// ------------------------------------------------------------------ test control
const JOB_STEPS_PER_TICK = 200;

export const mock = {
  STATE,
  store: () => store,
  entities: () => [...entities.values()],
  dynamicProps: () => dynamicProps,
  /** Fresh world (no blocks built, no players, no properties). */
  resetAll() {
    store = new Store();
    entities.clear();
    dynamicProps = new Map();
    players = [];
    pendingCb.length = 0;
    unloadedChunks.clear();
    this.reload();
    system.currentTick = 0;
    Object.assign(STATE, { errors: [], handlerErrors: [], commands: [], sounds: [], particles: [], music: [], cbRuns: 0, maxFill: 0 });
  },
  /** Simulate quitting and reopening the world: scripts restart, world data persists. */
  reload() {
    scheduled.length = 0;
    jobs.length = 0;
    world.afterEvents = freshAfterEvents();
    system.afterEvents.scriptEventReceive = new Signal();
    startup.handlers = [];
  },
  addPlayer(name = 'Guard') {
    const p = new Player(name);
    p.dimension = overworld;
    players.push(p);
    entities.set(p.id, p);
    world.afterEvents.playerSpawn.emit({ player: p, initialSpawn: true });
    return p;
  },
  removePlayer(p) {
    p.valid = false;
    players = players.filter((x) => x !== p);
    entities.delete(p.id);
  },
  fireStartup() {
    const commands = new Map();
    const registry = {
      registerCommand(def, cb) {
        commands.set(def.name, { def, cb });
      },
      registerEnum() {},
    };
    startup.emit({ customCommandRegistry: registry });
    return commands;
  },
  fireWorldLoad() {
    world.afterEvents.worldLoad.emit({});
  },
  /** Advance n ticks: scheduled script callbacks, jobs, then command blocks. */
  async tick(n = 1) {
    for (let k = 0; k < n; k++) {
      system.currentTick++;
      const due = scheduled.filter((s) => s.at <= system.currentTick).sort((a, b) => a.at - b.at || a.id - b.id);
      for (const s of due) {
        if (s.every) s.at += s.every;
        else scheduled.splice(scheduled.indexOf(s), 1);
        try {
          s.fn();
        } catch (e) {
          STATE.handlerErrors.push(e?.stack ?? String(e));
        }
      }
      for (const j of [...jobs]) {
        for (let step = 0; step < JOB_STEPS_PER_TICK; step++) {
          let r;
          try {
            r = j.gen.next();
          } catch (e) {
            STATE.handlerErrors.push(e?.stack ?? String(e));
            r = { done: true };
          }
          if (r.done) {
            jobs.splice(jobs.indexOf(j), 1);
            break;
          }
        }
      }
      tickCommandBlocks();
      // Let promise continuations (forms) settle between ticks.
      await new Promise((r) => setImmediate(r));
    }
  },
  /** Press the control above an input command block (runs it like redstone would). */
  activateCommandBlockAt(wx, wy, wz) {
    if (!store.blockEntities.has(`${wx},${wy},${wz}`)) throw new Error(`no command block at ${wx},${wy},${wz}`);
    runCommandBlock(wx, wy, wz);
  },
  blockAt(wx, wy, wz) {
    return store.get(wx, wy, wz);
  },
  /** Unload every chunk column touching the world-coordinate box [x1..x2] x [z1..z2]. */
  unloadChunks(x1, z1, x2, z2) {
    for (let cx = Math.floor(x1 / 16); cx <= Math.floor(x2 / 16); cx++) for (let cz = Math.floor(z1 / 16); cz <= Math.floor(z2 / 16); cz++) unloadedChunks.add(`${cx},${cz}`);
  },
  loadAllChunks() {
    unloadedChunks.clear();
  },
  commandBlockCount() {
    return store.blockEntities.size;
  },
  sneak(p) {
    world.afterEvents.playerButtonInput.emit({ player: p, button: InputButton.Sneak, newButtonState: ButtonState.Pressed }, (o) => !o || o.buttons?.includes(InputButton.Sneak));
  },
  useItem(p, typeId) {
    world.afterEvents.itemUse.emit({ source: p, itemStack: { typeId } });
  },
  hotbar(p, prev, next) {
    p.selectedSlotIndex = next;
    world.afterEvents.playerHotbarSelectedSlotChange.emit({ player: p, previousSlotSelected: prev, newSlotSelected: next });
  },
  respawn(p) {
    world.afterEvents.playerSpawn.emit({ player: p, initialSpawn: false });
  },
};
