// Minimal mock of @minecraft/server for headless smoke-testing the add-on scripts in Node.
// It models a voxel world (stone underground with a cave room and a strip-mined tunnel), entities,
// players, events, system scheduling and runJob generators. It is NOT a faithful simulation of
// Minecraft - just enough surface for every code path to execute and surface runtime errors.

export const log = { sounds: [], particles: [], errors: [], events: [], props: [], music: [], commands: [] };

// ------------------------------------------------------------------ enums / small classes
export const GameMode = { Survival: "Survival", Creative: "Creative", Adventure: "Adventure", Spectator: "Spectator" };
export const EntityDamageCause = { entityAttack: "entityAttack" };
export const EquipmentSlot = { Mainhand: "Mainhand", Offhand: "Offhand" };
export const EntityInitializationCause = { Born: "Born", Event: "Event", Loaded: "Loaded", Spawned: "Spawned", Transformed: "Transformed" };
export const PlayerPermissionLevel = { Visitor: 0, Member: 1, Operator: 2, Custom: 3 };
export class MolangVariableMap { constructor() { this.v = {}; } setFloat(k, x) { this.v[k] = x; } }
export class ItemStack { constructor(id, amount = 1) { this.typeId = id; this.amount = amount; } }
export class BlockVolume { constructor(from, to) { this.from = from; this.to = to; } }
export class BlockVolumeBase {}

const KNOWN_BLOCK = (id) => typeof id === "string" && id.includes(":") && !id.includes("deepslate_lit_");
export const BlockTypes = { get: (id) => (KNOWN_BLOCK(id) ? { id } : undefined) };

class Permutation {
  constructor(id, states = {}) { this.type = { id }; this.states = { ...states }; }
  getState(n) { return this.states[n]; }
  withState(n, v) { return new Permutation(this.type.id, { ...this.states, [n]: v }); }
}
export const BlockPermutation = { resolve: (id, states) => { if (!KNOWN_BLOCK(id)) throw new Error("bad block " + id); return new Permutation(id, states); } };

// ------------------------------------------------------------------ voxel world
const blocks = new Map(); // key -> Permutation
const k = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
export const SURFACE = 64;
function base(x, y, z) {
  if (y < -63) return "minecraft:bedrock";
  if (y > SURFACE) return "minecraft:air";
  // big cave room around (0,-20,0)
  const dx = x / 14, dy = (y + 20) / 6, dz = z / 14;
  if (dx * dx + dy * dy + dz * dz < 1 && y >= -24) return "minecraft:air";
  // 1x2 strip tunnel along +x from the room at y=-24..-23, z=0
  if (z === 0 && x >= 0 && x <= 90 && (y === -24 || y === -23)) return "minecraft:air";
  // side cave along -z
  if (x >= -3 && x <= 3 && z <= -10 && z >= -70 && y >= -24 && y <= -21) return "minecraft:air";
  if (y < 0) return "minecraft:deepslate";
  return (x * 7 + z * 13 + y * 3) % 23 === 0 ? "minecraft:andesite" : "minecraft:stone";
}
export function getId(x, y, z) {
  const p = blocks.get(k(x, y, z));
  return p ? p.type.id : base(Math.floor(x), Math.floor(y), Math.floor(z));
}
function getPerm(x, y, z) {
  return blocks.get(k(x, y, z)) || new Permutation(base(Math.floor(x), Math.floor(y), Math.floor(z)));
}
export function setId(x, y, z, id, states) { blocks.set(k(x, y, z), new Permutation(id, states || {})); }
const PASS = (id) => id === "minecraft:air" || id.includes("water") || id.includes("lava") || id.includes("torch") ||
  ["shaftbreaker:bloodroot_vines", "shaftbreaker:hanging_tissue", "shaftbreaker:crimson_thorns", "shaftbreaker:glowspore_cluster",
    "shaftbreaker:skull_pile", "shaftbreaker:dweller_droppings", "shaftbreaker:bloodmoss_carpet", "shaftbreaker:sinew_membrane",
    "shaftbreaker:bone_chime"].includes(id);
export const blockCount = () => blocks.size;
export const changedBlocks = () => blocks;

class Block {
  constructor(dim, x, y, z) { this.dimension = dim; this.location = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }; this.isValid = true; }
  get typeId() { return getId(this.location.x, this.location.y, this.location.z); }
  get isAir() { return this.typeId === "minecraft:air"; }
  get isLiquid() { return this.typeId.includes("water") || this.typeId.includes("lava"); }
  get isWaterlogged() { return false; }
  get permutation() { return getPerm(this.location.x, this.location.y, this.location.z); }
  get type() { return { id: this.typeId }; }
  setType(id) { if (!KNOWN_BLOCK(id)) throw new Error("bad type " + id); setId(this.location.x, this.location.y, this.location.z, id); }
  setPermutation(p) { blocks.set(k(this.location.x, this.location.y, this.location.z), p); }
  getLightLevel() { return 0; }
  getSkyLightLevel() { return 0; }
  matches(id) { return this.typeId === id; }
}

// ------------------------------------------------------------------ entities
let nextId = 1;
const entities = new Map();
const FAMILIES = {
  "minecraft:player": ["player"], "shaftbreaker:shaftbreaker": ["shaftbreaker", "monster", "mob"],
  "shaftbreaker:waypoint": ["shaftbreaker_waypoint"], "shaftbreaker:phantom": ["shaftbreaker_phantom", "inanimate"],
  "shaftbreaker:grinning_moth": ["grinning_moth", "arthropod", "mob"], "minecraft:zombie": ["zombie", "monster", "mob"],
};
class Entity {
  constructor(dim, typeId, loc) {
    this.id = String(nextId++); this.typeId = typeId; this.dimension = dim; this.location = { ...loc }; this.isValid = true;
    this._rot = { x: 0, y: 0 }; this._props = {}; this._dyn = {}; this._tags = new Set(); this._groups = new Set(); this._vel = { x: 0, y: 0, z: 0 };
    this.isSneaking = false; this.isSprinting = false; this.isOnGround = true; this.isInWater = false; this.isFalling = false;
    this._hp = typeId === "shaftbreaker:shaftbreaker" ? 160 : 20; this._move = 0.3; this.nameTag = "";
    entities.set(this.id, this);
  }
  getComponent(name) {
    const self = this;
    switch (name) {
      case "minecraft:health": return { get currentValue() { return self._hp; }, effectiveMax: 160, setCurrentValue(v) { self._hp = v; return true; }, resetToMaxValue() {} };
      case "minecraft:movement": return { setCurrentValue(v) { self._move = v; return true; }, get currentValue() { return self._move; } };
      case "minecraft:type_family": return { hasTypeFamily: (f) => (FAMILIES[self.typeId] || []).includes(f) };
      case "minecraft:equippable": return { getEquipment: (s) => (self._equip || {})[s] };
      case "minecraft:inventory": return { container: { addItem() {}, getItem: () => undefined, setItem() {} } };
      default: return undefined;
    }
  }
  setProperty(n, v) { this._props[n] = v; log.props.push([this.typeId, n, v]); }
  getProperty(n) { return this._props[n]; }
  setDynamicProperty(n, v) { this._dyn[n] = v; }
  getDynamicProperty(n) { return this._dyn[n]; }
  triggerEvent(e) { log.events.push([this.typeId, e]); this._groups.add(e); if (e.endsWith(":despawn")) this.remove(); }
  teleport(loc, opts = {}) { this._check(); this.location = { ...loc }; if (opts.dimension) this.dimension = opts.dimension; }
  tryTeleport(loc) { this.teleport(loc); return true; }
  setRotation(r) { this._check(); this._rot = { ...r }; }
  getRotation() { return { ...this._rot }; }
  lookAt() {}
  getViewDirection() { const yaw = (this._rot.y * Math.PI) / 180; return { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) }; }
  getHeadLocation() { return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z }; }
  getVelocity() { return { ...this._vel }; }
  clearVelocity() { this._vel = { x: 0, y: 0, z: 0 }; }
  applyImpulse(v) { this._check(); if (this.typeId === "minecraft:player") throw new Error("applyImpulse on player"); this._vel.x += v.x; this._vel.y += v.y; this._vel.z += v.z; }
  applyKnockback(h, v) { this._check(); if (typeof h !== "object") throw new Error("applyKnockback signature"); }
  applyDamage(n) { this._check(); this._hp -= n; return true; }
  addEffect(id, d, o) { this._check(); if (typeof id !== "string") throw new Error("effect"); }
  addTag(t) { this._tags.add(t); return true; }
  removeTag(t) { return this._tags.delete(t); }
  hasTag(t) { return this._tags.has(t); }
  getTags() { return [...this._tags]; }
  remove() { this.isValid = false; entities.delete(this.id); }
  kill() { this.remove(); return true; }
  matches() { return true; }
  extinguishFire() { return true; }
  _check() { if (!this.isValid) throw new Error("InvalidEntity " + this.typeId); }
}
class Player extends Entity {
  constructor(dim, name, loc) {
    super(dim, "minecraft:player", loc); this.name = name; this._gm = GameMode.Survival; this.selectedSlotIndex = 0;
    this.playerPermissionLevel = PlayerPermissionLevel.Operator;
    this.onScreenDisplay = { setActionBar: (t) => log.events.push(["actionbar", t]), setTitle() {} };
    this.camera = { fade() {} };
  }
  getGameMode() { return this._gm; }
  playSound(id, o) { log.sounds.push(["player", id]); }
  playMusic(id) { log.music.push(["play", id]); }
  queueMusic() {}
  stopMusic() { log.music.push(["stop"]); }
  spawnParticle(id) { log.particles.push(id); }
  sendMessage(m) { log.events.push(["msg", m]); }
  startItemCooldown(c, d) { if (typeof c !== "string") throw new Error("cooldown"); }
}

// ------------------------------------------------------------------ dimension
class Dimension {
  constructor(id) { this.id = "minecraft:" + id; }
  getBlock(loc) { if (loc.y < -64 || loc.y > 319) throw new Error("LocationOutOfWorldBoundaries"); return new Block(this, loc.x, loc.y, loc.z); }
  getBlockBelow(loc) { return this.getBlock({ x: loc.x, y: loc.y - 1, z: loc.z }); }
  fillBlocks(vol, type, opts = {}) {
    const id = typeof type === "string" ? type : type.type ? type.type.id : type.id;
    if (!KNOWN_BLOCK(id)) throw new Error("fill bad type " + id);
    const f = vol.from, t = vol.to;
    const n = (Math.abs(t.x - f.x) + 1) * (Math.abs(t.y - f.y) + 1) * (Math.abs(t.z - f.z) + 1);
    if (n > 32768) throw new Error("fill volume too large " + n);
    const inc = opts.blockFilter && opts.blockFilter.includeTypes;
    if (inc) for (const tt of inc) if (!KNOWN_BLOCK(tt)) throw new Error("filter bad type " + tt);
    for (let x = Math.min(f.x, t.x); x <= Math.max(f.x, t.x); x++)
      for (let y = Math.min(f.y, t.y); y <= Math.max(f.y, t.y); y++)
        for (let z = Math.min(f.z, t.z); z <= Math.max(f.z, t.z); z++) {
          if (inc && !inc.includes(getId(x, y, z))) continue;
          setId(x, y, z, id);
        }
    return { getCapacity: () => n };
  }
  getBlockFromRay(origin, dir, opts = {}) {
    const max = opts.maxDistance ?? 64;
    for (let d = 0; d <= max; d += 0.05) {
      const x = origin.x + dir.x * d, y = origin.y + dir.y * d, z = origin.z + dir.z * d;
      const id = getId(x, y, z);
      if (!PASS(id)) {
        const b = new Block(this, x, y, z);
        return { block: b, face: "Up", faceLocation: { x: x - Math.floor(x), y: y - Math.floor(y), z: z - Math.floor(z) } };
      }
    }
    return undefined;
  }
  getTopmostBlock(xz) { return new Block(this, xz.x, SURFACE, xz.z); }
  getLightLevel(loc) { return loc.y > SURFACE ? 15 : 0; }
  getSkyLightLevel(loc) { return loc.y > SURFACE ? 15 : 0; }
  getBiome() { return { id: "minecraft:dripstone_caves" }; }
  spawnEntity(id, loc) {
    if (!id.includes(":")) throw new Error("bad entity id");
    const e = new Entity(this, id, loc);
    for (const fn of subs.entitySpawn) fn({ entity: e, cause: EntityInitializationCause.Spawned });
    return e;
  }
  spawnItem(item, loc) { return new Entity(this, "minecraft:item", loc); }
  getEntities(o = {}) {
    let out = [...entities.values()].filter((e) => e.isValid && e.dimension === this);
    if (o.type) out = out.filter((e) => e.typeId === o.type);
    if (o.location && o.maxDistance !== undefined) out = out.filter((e) => Math.hypot(e.location.x - o.location.x, e.location.y - o.location.y, e.location.z - o.location.z) <= o.maxDistance);
    if (o.families) out = out.filter((e) => o.families.every((f) => (FAMILIES[e.typeId] || []).includes(f)));
    if (o.excludeFamilies) out = out.filter((e) => !o.excludeFamilies.some((f) => (FAMILIES[e.typeId] || []).includes(f)));
    if (o.excludeTypes) out = out.filter((e) => !o.excludeTypes.includes(e.typeId));
    if (o.tags) out = out.filter((e) => o.tags.every((t) => e.hasTag(t)));
    return out;
  }
  getPlayers(o = {}) { return this.getEntities({ ...o, type: "minecraft:player" }); }
  playSound(id, loc, o) { if (!loc || typeof loc.x !== "number" || Number.isNaN(loc.x)) throw new Error("playSound bad loc " + id); log.sounds.push(["dim", id]); }
  spawnParticle(id, loc) { if (!loc || Number.isNaN(loc.x)) throw new Error("particle bad loc"); log.particles.push(id); }
  runCommand(cmd) {
    log.commands.push(cmd);
    const m = cmd.match(/^setblock (-?\d+) (-?\d+) (-?\d+) (\S+)/);
    if (m) setId(+m[1], +m[2], +m[3], m[4].includes(":") ? m[4] : "minecraft:" + m[4]);
    return { successCount: 1 };
  }
}
const dims = { overworld: new Dimension("overworld"), nether: new Dimension("nether"), the_end: new Dimension("the_end") };

// ------------------------------------------------------------------ events
const subs = {};
const sig = (name) => { subs[name] = subs[name] || []; return { subscribe: (fn) => { subs[name].push(fn); return fn; }, unsubscribe() {} }; };
const AFTER = ["worldLoad", "entitySpawn", "playerBreakBlock", "playerPlaceBlock", "entityHurt", "entityHitEntity", "entityDie",
  "entityLoad", "playerSpawn", "playerLeave", "explosion", "itemUse", "projectileHitBlock", "playerInteractWithBlock", "entityRemove"];
const worldDyn = {};
export const world = {
  afterEvents: Object.fromEntries(AFTER.map((n) => [n, sig(n)])),
  beforeEvents: { playerLeave: sig("bPlayerLeave"), itemUse: sig("bItemUse"), playerBreakBlock: sig("bBreak") },
  getDimension: (id) => dims[id.replace("minecraft:", "")],
  getAllPlayers: () => dims.overworld.getPlayers().concat(dims.nether.getPlayers()),
  getPlayers: (o = {}) => dims.overworld.getPlayers(o),
  getEntity: (id) => { const e = entities.get(id); return e && e.isValid ? e : undefined; },
  getDynamicProperty: (k2) => worldDyn[k2],
  setDynamicProperty: (k2, v) => { if (typeof v === "string" && v.length > 32767) throw new Error("dyn too long " + k2); worldDyn[k2] = v; },
  getAbsoluteTime: () => system.currentTick,
  getDefaultSpawnLocation: () => ({ x: 2000, y: 70, z: 2000 }),
  playMusic() {}, stopMusic() {},
};
export const worldDynamic = worldDyn;

// ------------------------------------------------------------------ system
const intervals = [];
const timeouts = [];
const jobs = [];
export const system = {
  currentTick: 12347, // deliberately misaligned start, like a real world
  runInterval(fn, n = 1) { intervals.push({ fn, n, next: this.currentTick + n }); return intervals.length; },
  runTimeout(fn, n = 1) { timeouts.push({ fn, at: this.currentTick + Math.max(1, n) }); return timeouts.length; },
  run(fn) { return this.runTimeout(fn, 1); },
  runJob(gen) { if (!gen || typeof gen.next !== "function") throw new Error("runJob needs a generator"); jobs.push(gen); return jobs.length; },
  clearRun() {}, clearJob() {},
  afterEvents: { scriptEventReceive: sig("scriptEvent") },
  beforeEvents: { startup: sig("startup"), shutdown: sig("shutdown") },
};

function safe(label, fn) {
  try { fn(); } catch (e) { log.errors.push(label + ": " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)); }
}

/** Advances the simulation by one tick (scheduling + crude mob movement). */
export function step(onTick) {
  system.currentTick++;
  const t = system.currentTick;
  for (const iv of intervals) if (t >= iv.next) { iv.next = t + iv.n; safe("interval", iv.fn); }
  const due = timeouts.filter((x) => x.at <= t);
  for (const d of due) { timeouts.splice(timeouts.indexOf(d), 1); safe("timeout", d.fn); }
  for (let j = jobs.length - 1; j >= 0; j--) {
    let done = false;
    safe("job", () => { for (let i = 0; i < 40; i++) { const r = jobs[j].next(); if (r.done) { done = true; break; } } });
    if (done) jobs.splice(j, 1);
  }
  // crude AI movement for the creature: walk toward its waypoint (seek) or tagged prey (hunt)
  for (const e of entities.values()) {
    if (e.typeId !== "shaftbreaker:shaftbreaker" || !e.isValid) continue;
    const lastMode = [...log.events].reverse().find((ev) => ev[0] === e.typeId && ev[1].includes(":mode_"));
    const mode = lastMode ? lastMode[1].split(":mode_")[1] : "passive";
    let goal = null;
    if (mode === "seek") goal = [...entities.values()].find((o) => o.typeId === "shaftbreaker:waypoint" && o.isValid);
    if (mode === "hunt") goal = dims.overworld.getPlayers().find((p) => p.hasTag("shaftbreaker_prey"));
    if (goal) {
      const dx = goal.location.x - e.location.x, dz = goal.location.z - e.location.z, dy = goal.location.y - e.location.y;
      const d = Math.hypot(dx, dz);
      const sp = Math.min(d, e._move * 0.9);
      if (d > 0.9) { e.location = { x: e.location.x + (dx / d) * sp, y: e.location.y + Math.sign(dy) * Math.min(Math.abs(dy), 0.2), z: e.location.z + (dz / d) * sp }; }
    }
    e._vel = { x: 0, y: 0, z: 0 };
  }
  if (onTick) safe("onTick", () => onTick(t));
}

export function fire(name, ev) { for (const fn of subs[name] || []) safe("event:" + name, () => fn(ev)); }
export function addPlayer(name, loc) { return new Player(dims.overworld, name, loc); }
export { Player, Entity, entities, dims };
