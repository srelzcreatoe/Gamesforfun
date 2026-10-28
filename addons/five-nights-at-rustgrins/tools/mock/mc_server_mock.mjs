// A strict, minimal mock of @minecraft/server for running the behavior pack in
// Node (tools/mock/run_game.mjs). It is not an emulator: it records what the
// scripts do and REJECTS what the real game would reject - unknown block
// names/states (checked against Mojang's block metadata and packs/BP/blocks),
// unknown entity properties or enum values (packs/BP/entities), unknown sound
// events (packs/RP/sounds/sound_definitions.json), fills over 32768 blocks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBlock } from '../validate_blocks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DTS = path.join(ROOT, 'tools/node_modules/@minecraft/server/index.d.ts');

// ---------------------------------------------------------------- enums parsed from the real typings
function parseEnums(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const m of src.matchAll(/export enum (\w+) \{([\s\S]*?)\n\}/g)) {
    const e = {};
    for (const mm of m[2].matchAll(/^\s+(\w+) = ('?)([^',\n]+)\2,/gm)) e[mm[1]] = mm[2] ? mm[3] : Number(mm[3]);
    out[m[1]] = Object.freeze(e);
  }
  return out;
}
const E = parseEnums(DTS);
export const { GameMode, HudVisibility, HudElement, InputButton, ButtonState, WeatherType, InputPermissionCategory, EasingType, CustomCommandParamType, CustomCommandStatus, CommandPermissionLevel, Direction } = E;

// ---------------------------------------------------------------- recorded state for assertions
export const mock = {
  tick: 0,
  errors: [],
  warnings: [],
  commands: [],
  sounds: [],
  titles: [],
  forms: [],
  formPolicy: null, // (form, player) => response
  blocks: new Map(),
  entities: new Map(),
  props: new Map(),
  fills: 0,
  setBlocks: 0,
};

// ---------------------------------------------------------------- definitions from the packs
const entityProps = {};
for (const f of fs.existsSync(path.join(ROOT, 'packs/BP/entities')) ? fs.readdirSync(path.join(ROOT, 'packs/BP/entities')) : []) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/BP/entities', f), 'utf8'))['minecraft:entity'];
  entityProps[j.description.identifier] = j.description.properties || {};
}
let soundDefs = null;
const sdPath = path.join(ROOT, 'packs/RP/sounds/sound_definitions.json');
if (fs.existsSync(sdPath)) soundDefs = JSON.parse(fs.readFileSync(sdPath, 'utf8')).sound_definitions;
export const missingSounds = new Set();
function checkSound(id) {
  if (!soundDefs) return;
  if (!soundDefs[id]) missingSounds.add(id);
}
const itemIds = new Set(fs.existsSync(path.join(ROOT, 'packs/BP/items')) ? fs.readdirSync(path.join(ROOT, 'packs/BP/items')).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/BP/items', f), 'utf8'))['minecraft:item'].description.identifier) : []);

// ---------------------------------------------------------------- blocks
export class BlockPermutation {
  constructor(type, states) {
    this.type = type;
    this.states = { ...states };
  }

  static resolve(name, states = {}) {
    const errs = checkBlock({ name, states });
    if (errs.length) throw new Error(`BlockPermutation.resolve: ${errs.join('; ')}`);
    return new BlockPermutation(name, states);
  }

  withState(k, v) {
    const s = { ...this.states, [k]: v };
    const errs = checkBlock({ name: this.type, states: { [k]: v } });
    if (errs.length) throw new Error(`withState: ${errs.join('; ')}`);
    return new BlockPermutation(this.type, s);
  }

  getState(k) {
    return this.states[k];
  }
}
const AIR = new BlockPermutation('minecraft:air', {});
const key = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;

export class BlockVolume {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }

  *locations() {
    const a = this.from, b = this.to;
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++) yield { x, y, z };
  }

  size() {
    const a = this.from, b = this.to;
    return (Math.abs(a.x - b.x) + 1) * (Math.abs(a.y - b.y) + 1) * (Math.abs(a.z - b.z) + 1);
  }
}
export class ListBlockVolume {
  constructor(locs) {
    this.locs = locs;
  }

  *locations() {
    yield* this.locs;
  }

  size() {
    return this.locs.length;
  }
}

function makeBlock(loc) {
  const k = key(loc);
  return {
    location: { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) },
    get permutation() {
      return mock.blocks.get(k) ?? AIR;
    },
    get typeId() {
      return (mock.blocks.get(k) ?? AIR).type;
    },
    get isAir() {
      return (mock.blocks.get(k) ?? AIR).type === 'minecraft:air';
    },
    setPermutation(p) {
      mock.blocks.set(k, p);
      mock.setBlocks++;
    },
    getComponent(c) {
      if (c === 'minecraft:sign' && /sign/.test((mock.blocks.get(k) ?? AIR).type)) return { setText() {}, setWaxed() {} };
      return undefined;
    },
  };
}

// ---------------------------------------------------------------- entities
let nextEntity = 1;
class Entity {
  constructor(typeId, loc) {
    this.id = `e${nextEntity++}`;
    this.typeId = typeId;
    this.location = { ...loc };
    this.tags = new Set();
    this.isValid = true;
    this.nameTag = '';
    this.props = {};
  }

  addTag(t) {
    this.tags.add(t);
    return true;
  }

  hasTag(t) {
    return this.tags.has(t);
  }

  teleport(loc, opts) {
    if (!this.isValid) throw new Error('teleport on removed entity');
    for (const v of [loc.x, loc.y, loc.z]) if (!Number.isFinite(v)) throw new Error(`teleport to non-finite location ${JSON.stringify(loc)}`);
    this.location = { ...loc };
    if (opts?.rotation && !Number.isFinite(opts.rotation.y)) throw new Error('non-finite rotation');
  }

  setProperty(k, v) {
    const def = entityProps[this.typeId]?.[k];
    if (!def) throw new Error(`setProperty: ${this.typeId} has no property ${k}`);
    if (def.type === 'enum' && !def.values.includes(v)) throw new Error(`setProperty: ${k}=${v} not in ${def.values}`);
    if (def.type === 'int' && (!Number.isInteger(v) || v < def.range[0] || v > def.range[1])) throw new Error(`setProperty: ${k}=${v} out of range ${def.range}`);
    if (def.type === 'bool' && typeof v !== 'boolean') throw new Error(`setProperty: ${k} expects bool`);
    this.props[k] = v;
  }

  getProperty(k) {
    return this.props[k];
  }

  remove() {
    this.isValid = false;
    mock.entities.delete(this.id);
  }
}

// ---------------------------------------------------------------- players
class Player extends Entity {
  constructor(name, loc) {
    super('minecraft:player', loc);
    this.name = name;
    this.rotation = { x: 0, y: 0 };
    this.gameMode = 'Survival';
    this.effects = new Set();
    this.inventory = new Array(36).fill(undefined);
    this.slot = 0;
    this.perms = {};
    this.cameraState = 'default';
    const self = this;
    this.camera = {
      setCamera(preset, opts) {
        if (preset !== 'minecraft:free') throw new Error(`unexpected camera preset ${preset}`);
        for (const k of ['location', 'facingLocation']) if (opts?.[k]) for (const v of Object.values(opts[k])) if (!Number.isFinite(v)) throw new Error('camera non-finite');
        self.cameraState = 'free';
        if (opts?.location) self.cameraLoc = { ...opts.location };
      },
      fade() {},
      clear() {
        self.cameraState = 'default';
      },
    };
    this.inputPermissions = { setPermissionCategory(c, v) { self.perms[c] = v; }, isPermissionCategoryEnabled(c) { return self.perms[c] !== false; } };
    this.onScreenDisplay = {
      setActionBar(t) { self.actionBar = t; },
      setTitle(t, o) { mock.titles.push([t, o?.subtitle]); },
      setHudVisibility() {},
    };
  }

  get selectedSlotIndex() {
    return this.slot;
  }

  /** Like the game, a scripted slot change also reaches playerHotbarSelectedSlotChange (after the current handler). */
  set selectedSlotIndex(v) {
    if (!Number.isInteger(v) || v < 0 || v > 8) throw new Error(`selectedSlotIndex ${v}`);
    const prev = this.slot;
    this.slot = v;
    if (prev !== v) queueMicrotask(() => world.afterEvents.playerHotbarSelectedSlotChange.fire({ player: this, previousSlotSelected: prev, newSlotSelected: v }));
  }

  playSound(id, o) {
    checkSound(id);
    mock.sounds.push(id);
    return { stop() {} };
  }

  getComponent(c) {
    if (c !== 'minecraft:inventory') return undefined;
    const inv = this.inventory;
    return {
      container: {
        setItem(i, item) {
          if (item && !itemIds.has(item.typeId) && !item.typeId.startsWith('minecraft:')) throw new Error(`unknown item ${item.typeId}`);
          inv[i] = item;
        },
        clearAll() { inv.fill(undefined); },
        getItem(i) { return inv[i]; },
      },
    };
  }

  setGameMode(m) {
    if (!Object.values(GameMode).includes(m)) throw new Error(`bad game mode ${m}`);
    this.gameMode = m;
  }

  getGameMode() {
    return this.gameMode;
  }

  addEffect(e) {
    this.effects.add(e);
  }

  removeEffect(e) {
    this.effects.delete(e);
    return true;
  }

  sendMessage(m) {
    this.lastMessage = m;
  }

  getHeadLocation() {
    return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z };
  }

  getRotation() {
    return { ...this.rotation };
  }

  teleport(loc, opts) {
    super.teleport(loc, opts);
    if (opts?.rotation) this.rotation = { ...opts.rotation };
  }
}

// ---------------------------------------------------------------- dimension
const dimension = {
  id: 'minecraft:overworld',
  getBlock: (loc) => makeBlock(loc),
  setBlockPermutation(loc, p) {
    if (!(p instanceof BlockPermutation)) throw new Error('setBlockPermutation needs a BlockPermutation');
    mock.blocks.set(key(loc), p);
    mock.setBlocks++;
  },
  setBlockType(loc, t) {
    mock.blocks.set(key(loc), BlockPermutation.resolve(t));
  },
  fillBlocks(vol, block, opts) {
    const p = typeof block === 'string' ? BlockPermutation.resolve(block) : block;
    if (vol.size() > 32768) throw new Error(`fillBlocks volume ${vol.size()} > 32768`);
    const inc = opts?.blockFilter?.includeTypes;
    let n = 0;
    for (const l of vol.locations()) {
      const k = key(l);
      if (inc && !inc.includes((mock.blocks.get(k) ?? AIR).type)) continue;
      mock.blocks.set(k, p);
      n++;
    }
    mock.fills++;
    return new ListBlockVolume([]);
  },
  spawnEntity(id, loc) {
    if (!entityProps[id]) throw new Error(`spawnEntity: unknown entity ${id}`);
    const e = new Entity(id, loc);
    mock.entities.set(e.id, e);
    return e;
  },
  getEntities(q = {}) {
    return [...mock.entities.values()].filter((e) => (!q.type || e.typeId === q.type) && (!q.tags || q.tags.every((t) => e.tags.has(t))));
  },
  playSound(id) {
    checkSound(id);
    mock.sounds.push(id);
    return { stop() {} };
  },
  runCommand(cmd) {
    mock.commands.push(cmd);
    return { successCount: 1 };
  },
  isChunkLoaded: () => true,
  setWeather() {},
};

// ---------------------------------------------------------------- events, system, world
function signal() {
  const subs = [];
  return { subscribe(fn) { subs.push(fn); return fn; }, unsubscribe(fn) { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }, fire(ev) { for (const f of subs) f(ev); }, subs };
}
const timers = [];
let nextRun = 1;
const jobs = [];
export const system = {
  get currentTick() {
    return mock.tick;
  },
  run(fn) {
    return this.runTimeout(fn, 0);
  },
  runTimeout(fn, ticks = 0) {
    const id = nextRun++;
    timers.push({ id, at: mock.tick + Math.max(0, ticks), fn, every: 0 });
    return id;
  },
  runInterval(fn, ticks = 1) {
    const id = nextRun++;
    timers.push({ id, at: mock.tick + ticks, fn, every: Math.max(1, ticks) });
    return id;
  },
  clearRun(id) {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  },
  runJob(gen) {
    const id = nextRun++;
    jobs.push({ id, gen });
    return id;
  },
  beforeEvents: { startup: signal() },
  afterEvents: {},
};
const players = [];
const dyn = new Map();
export const world = {
  afterEvents: Object.fromEntries(['worldLoad', 'playerSpawn', 'buttonPush', 'itemUse', 'playerInteractWithBlock', 'playerHotbarSelectedSlotChange', 'playerButtonInput', 'playerLeave'].map((n) => [n, signal()])),
  beforeEvents: {},
  getDimension: () => dimension,
  getAllPlayers: () => players.filter((p) => p.isValid),
  getDynamicProperty: (k) => dyn.get(k),
  setDynamicProperty: (k, v) => {
    if (v !== undefined && typeof v === 'string' && v.length > 32767) throw new Error('dynamic property too long');
    dyn.set(k, v);
  },
  gameRules: {},
  setTimeOfDay() {},
};

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
  }
}

// ---------------------------------------------------------------- driver helpers
export const driver = {
  addPlayer(name, loc) {
    const p = new Player(name, loc);
    players.push(p);
    return p;
  },
  /** Advance one tick: timers, then jobs (each job runs until it yields 24 times). */
  step() {
    mock.tick++;
    const due = timers.filter((t) => t.at <= mock.tick);
    for (const t of due) {
      if (t.every) t.at = mock.tick + t.every;
      else timers.splice(timers.indexOf(t), 1);
      try {
        t.fn();
      } catch (e) {
        mock.errors.push(`timer: ${e?.stack ?? e}`);
      }
    }
    for (const j of [...jobs]) {
      for (let i = 0; i < 24; i++) {
        let r;
        try {
          r = j.gen.next();
        } catch (e) {
          mock.errors.push(`job: ${e?.stack ?? e}`);
          r = { done: true };
        }
        if (r.done) {
          jobs.splice(jobs.indexOf(j), 1);
          break;
        }
      }
    }
  },
  jobsRunning: () => jobs.length,
};
