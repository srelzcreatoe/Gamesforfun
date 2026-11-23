/**
 * The one controller.  Every appearance of Basiliskra -- the first arrival, a return after a
 * death, a reload, an evolution -- goes through here, and it is the only code that ever creates
 * the entity.  It reserves in the world record BEFORE it creates anything, so two simultaneous
 * triggers, an interrupted arrival or a restart can never make a second animal.
 */
import { Dimension, Entity, ItemStack, Player, system, world } from "@minecraft/server";
import { CONFIG, FIN_ITEM, KNOCK_GAP_TICKS, OVERWORLD, PART_FAMILY, PROP, TICKS, TYPE } from "./config";
import { Brain, isDusk, pace } from "./brain";
import { CHANGES } from "./change";
import { Creature, partOwner } from "./creature";
import { Ending } from "./ending";
import { BrainOne } from "./forms/one";
import { BrainThree } from "./forms/three";
import { BrainFour } from "./forms/four";
import { BrainTwo } from "./forms/two";
import { beginTick, particle, players, sizeVars, sound } from "./fx";
import { shake } from "./roar";
import { RIFT_SIZE, riftClose, riftOpen, riftTick } from "./rift";
import { cutAll, film, filmTick } from "./scene";
import { RIGS } from "./generated/rig";
import { clearHarm, type Trigger } from "./harm";
import { addFallout, clearFallout, falloutTick } from "./fallout";
import { cityTick } from "./city";
import { musicStop, musicTick, sceneTheme } from "./music";
import { titans } from "./titan";
import { freshRecord, newToken, store } from "./store";
import { add, dist, distXZ, dot, forwardOf, hash, mul, norm, sub, wrapDeg, yawTo, type V3 } from "./vec";
import { NONE, UNLOADED, blockAt, deepHere, groundY, isLoaded, isWaterId, overworld, waterColumn } from "./world";

const TOKEN = "bk:token";
const ROMAN = ["", "I", "II", "III", "IV"];

/** A line for the players near something that just happened (an explicit action, never recurring). */
function tellNear(dimId: string, at: V3, msg: string): void {
  for (const p of players()) {
    try { if (p.dimension.id === dimId && dist(p.location, at) < 64) p.sendMessage(msg); } catch { /* left */ }
  }
}
const SPAWN_STEP = 3;
/** The last form he can change into. */
const MAX_FORM = 4;
/** How far back the camera must stand to hold all of each form in the picture, and how high his middle is (blocks). */
const FRAME = [0, 17, 21, 34, 46];
const BODY_MID = [0, 1.5, 3.5, 6, 24];
const NAME_CARD = ["", "", "§7he has left the water", "§7he stands up", "§7the last form"];

/** Places tried round a site in one full search for water (six a call, a call every five seconds). */
const WATER_CANDIDATES = 60;

export class Controller {
  creature: Creature | null = null;
  brain: Brain | null = null;
  ending = new Ending(this);
  /** How many copied or unauthorised instances have been removed (kept for the test report). */
  quarantined = 0;
  private ticket: Entity | null = null;
  private runner: Generator<void, void, void> | null = null;
  private missing = 0;
  private hurtCryAt = -999;

  // ---- start-up ------------------------------------------------------------------------------
  init(): void {
    store.load();
    this.sweep();
  }

  get now(): number { return store.rec.clock; }

  // ---- identity ------------------------------------------------------------------------------
  /** Decide what an entity of our type is: the one Basiliskra, or something to remove at once. */
  inspect(e: Entity): void {
    let id: string;
    try { if (!e.isValid || e.typeId !== TYPE) return; id = e.id; } catch { return; }
    if (this.creature && this.creature.entity.id === id) return;
    if (this.ticket && this.ticket.id === id) return;
    const rec = store.rec;
    const mayExist = rec.stage === "alive" || rec.stage === "arriving";
    if (mayExist && rec.entityId === id) { this.adopt(e); return; }
    if (mayExist && rec.entityId === null && rec.token && !this.creature) {
      let token: unknown;
      try { token = e.getDynamicProperty(TOKEN); } catch { token = undefined; }
      if (token === rec.token) {
        // a creation that was interrupted after the entity existed but before the record named it
        rec.entityId = id;
        rec.down = null;
        store.save();
        this.adopt(e);
        return;
      }
    }
    // No token at all: nobody reserved it.  That is a spawn egg, /summon or /basiliskra:spawn, and it means
    // "bring him here".  (A copy made with a structure block carries his token and is removed above/below.)
    let token: unknown;
    try { token = e.getDynamicProperty(TOKEN); } catch { token = undefined; }
    if (token === undefined && CONFIG.allowSummon) { this.summoned(e); return; }
    this.quarantine(e);
  }

  // ---- called on purpose: spawn egg, /summon, /basiliskra:spawn, the config wheel ----------------------------
  /** A Basiliskra nobody reserved has appeared.  The one Basiliskra comes to that place instead. */
  summoned(e: Entity): void {
    let at: V3, yaw = 0, dimId = "";
    try { at = { ...e.location }; yaw = e.getRotation().y; dimId = e.dimension.id; } catch { return; }
    if (dimId !== OVERWORLD) {
      this.quarantine(e);
      tellNear(dimId, at, "§7Basiliskra lives in the Overworld. He cannot be called here.");
      return;
    }
    const said = this.bringHere(at, yaw, CONFIG.spawnForm, e);
    tellNear(dimId, at, `§7${said}`);
  }

  /**
   * Bring the one Basiliskra to `at`, in `want` form (0 = his stage in the story).  If he is loaded he is moved
   * here; otherwise a body here becomes him and the old one, wherever it lies, is removed when its chunk loads.
   * Never more than one.  Returns what happened, in words.
   */
  bringHere(at: V3, yaw: number, want: 0 | 1 | 2 | 3 | 4, body?: Entity): string {
    const rec = store.rec, dim = overworld();
    const form = this.formFor(want, at);
    if (form === 1) {
      // the water form goes to the nearest deep water; with none in reach he cannot be here at all
      const w = this.waterNear(at, 96);
      if (!w) {
        if (body) this.quarantine(body);
        return "Basiliskra I lives in deep water, and there is none within 96 blocks (it has to be 5 deep). Bring him as II or III, or go to the sea.";
      }
      at = w;
    }
    const c = this.creature;
    if (c && c.valid) {
      if (body) this.quarantine(body);
      this.runner = null;
      this.ending.reset();
      if (rec.stage !== "alive") { rec.stage = "alive"; rec.arrival = null; rec.pending = null; }
      rec.evolve = null; rec.down = null;
      if (!rec.born) { rec.born = Math.max(1, this.now); rec.mut.formSince = this.now; }
      if (!rec.rift) rec.rift = { ...(this.waterNear(at, 64) ?? at), yaw };
      rec.home = { ...at };                              // brought here on purpose: this is where he keeps to now
      if (c.form !== form) this.setForm(c, form);
      this.brain?.finish();
      c.halt();
      c.pos = { ...at }; c.yaw = yaw;
      try { c.entity.teleport(at, { rotation: { x: 0, y: yaw } }); } catch { /* unloading */ }
      store.save();
      return `Basiliskra ${ROMAN[form]} has come.`;
    }
    let made = false;
    if (!body) {
      if (!isLoaded(dim, at)) return "That place is not loaded.";
      try { body = dim.spawnEntity(TYPE, at, { initialRotation: yaw }); made = true; } catch { return "He could not come there."; }
    }
    this.ticket = body;
    try {
      // the record first: from this line it is this body that is him
      rec.stage = "alive";
      if (!rec.token) rec.token = newToken();
      rec.entityId = body.id;
      rec.form = form;
      rec.pending = null; rec.arrival = null; rec.evolve = null; rec.ending = null; rec.down = null;
      if (!rec.born) { rec.born = Math.max(1, this.now); rec.mut.formSince = this.now; }
      if (!rec.rift) rec.rift = { ...(this.waterNear(at, 64) ?? at), yaw };
      if (!rec.origin) rec.origin = { ...at };
      rec.home = { ...at };
      store.save();
      try { body.setDynamicProperty(TOKEN, rec.token); } catch { /* gone */ }
      this.adopt(body);
      try {
        const h = body.getComponent("minecraft:health");
        if (h) h.setCurrentValue(Math.max(1, Math.min(rec.health || h.effectiveMax, h.effectiveMax)));
      } catch { /* no health */ }
    } finally { this.ticket = null; }
    if (!this.creature && made) { try { body.remove(); } catch { /* gone */ } }
    return this.creature ? `Basiliskra ${ROMAN[form]} has come.` : "He could not come there.";
  }

  /** Which form a call makes. */
  private formFor(want: 0 | 1 | 2 | 3 | 4, at: V3): 1 | 2 | 3 | 4 {
    if (want) return want;
    const rec = store.rec;
    if (rec.born > 0) return rec.form;                 // he has been here: as he is in the story
    return this.waterNear(at, 6) ? 1 : 3;              // a new world: in the water as he begins, on land as he ends
  }

  /** The nearest loaded column of open water at least five deep, at his swimming depth; null if none within reach. */
  waterNear(at: V3, reach: number): V3 | null {
    const dim = overworld();
    for (let r = 0; r <= reach; r += 4) {
      const n = r === 0 ? 1 : Math.max(8, Math.round(r * 1.5));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
        const col = waterColumn(dim, x, z, at.y, 12, 12);
        if (col === UNLOADED || col === NONE || col.surface - col.floor < 5) continue;
        return { x, y: col.surface - 5.5, z };
      }
    }
    return null;
  }

  /** Change his form now, keeping him (the config wheel, /basiliskra:spawn with a form). */
  private setForm(c: Creature, form: 1 | 2 | 3 | 4): void {
    const rec = store.rec;
    rec.form = form; rec.mut.formSince = this.now; rec.evolve = null;
    if (form === 4) rec.four = undefined;                  // he makes his entrance again
    c.form = form;
    try { c.entity.triggerEvent(`basiliskra:bind_${form}`); } catch { /* unloading */ }
    this.nameHim(c.entity);
    c.dropParts();
    c.resync();
    this.brain = this.makeBrain(c);
  }

  /**
   * The config wheel: open the rift for him NOW.  No dusk, no waiting.  Basiliskra I comes through the nearest
   * deep water (the story begins: he will change as he lives); once he is II or more and has been driven off,
   * the rift opens on land in front of the caller and he walks out of it as he was.
   */
  callNow(site: V3, by: Player, place?: { at: V3; yaw: number }): string {
    const rec = store.rec;
    const c = this.creature;
    if (c && c.valid) return `He is already here, ${Math.round(dist(c.pos, site))} blocks away. Send him away first, or use Bring him here.`;
    if (rec.stage === "arriving") return "The rift is already open: he is coming through.";
    const returning = rec.stage === "alive" && rec.born > 0;          // driven off and owed back: as he was
    const form = returning ? rec.form : 1;
    const origin = { x: Math.floor(site.x), y: Math.floor(site.y), z: Math.floor(site.z) };
    if (form === 1) {
      const w = this.waterNear(site, 96);
      if (!w) return "The rift opens in deep water, and there is none within 96 blocks (it has to be 5 deep). Go to the sea, a deep lake or a wide river and call him again.";
      this.waterSearch = null;
      rec.stage = "arriving"; rec.token = newToken(); rec.entityId = null; rec.down = null; rec.form = 1; rec.pending = null;
      rec.arrival = { step: 1, t0: this.now, water: w, yaw: this.openHeading(w) };
      if (!returning) { rec.origin = origin; rec.guilty = by.id; rec.guiltyName = by.name; }
      rec.home = null;
      store.save();
      return `The rift is opening in the water ${Math.round(dist(w, site))} blocks from you. Watch it.`;
    }
    // Basiliskra IV comes out of the sea if there is any near: the rift opens in the water, he wades out of it,
    // and his first beam is cut across the beach before anyone hears him
    let fromSea = false;
    if (form === 4) {
      const w = this.waterNear(site, 96);
      if (w) {
        // as far out as the water goes along the line from the caller (up to the length he has to walk to be clear
        // of the tear), so that he comes to a stop at the water's edge and not on top of whoever called him
        const out = norm({ x: w.x - site.x, y: 0, z: w.z - site.z });
        for (const d of [78, 60, 40, 20, 0]) {
          const x = w.x + out.x * d, z = w.z + out.z * d;
          const col = waterColumn(overworld(), x, z, w.y + 5.5, 12, 40);
          if (col === NONE || col === UNLOADED || col.surface - col.floor < 2) continue;
          place = { at: { x: Math.floor(x), y: col.floor, z: Math.floor(z) }, yaw: yawTo({ x, y: 0, z }, site) };
          fromSea = true;
          break;
        }
      }
    }
    if (!place) return "He could not come there.";
    rec.stage = "arriving"; rec.entityId = null; rec.down = null; rec.pending = null;
    if (!rec.token) rec.token = newToken();
    rec.arrival = { step: 0, t0: this.now, water: { ...place.at }, yaw: place.yaw, land: true };
    rec.home = { ...place.at };
    store.save();
    return fromSea ? `The rift is opening in the water ${Math.round(dist(place.at, site))} blocks from you. Basiliskra IV is coming out of the sea.`
      : `The rift is opening in front of you. Basiliskra ${ROMAN[form]} is coming through.`;
  }

  /** The heading out of a seam in the water with the longest clear, deep run ahead of it (for his first swim). */
  private openHeading(w: V3): number {
    const dim = overworld();
    let best = 0, run = -1;
    for (let k = 0; k < 8; k++) {
      const yaw = k * 45, f = forwardOf(yaw);
      let n = 0;
      for (let s = 4; s <= 48; s += 4) {
        if (deepHere(dim, w.x + f.x * s, w.z + f.z * s, Math.floor(w.y + 5.5), 4) !== true) break;
        n++;
      }
      if (n > run) { run = n; best = yaw; }
    }
    return best;
  }

  /**
   * The config wheel: he leaves through a seam and stays gone.  The story goes back to its beginning (the anger
   * on record, and his fallout, stay): calling him again starts it afresh.
   */
  sendAway(): boolean {
    const c = this.creature;
    const was = store.rec.stage !== "dormant";
    if (c && c.valid) {
      const at = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
      if (c.form === 1) c.say("basiliskra.roar_under", c.anchor("nose"), 96);
      else c.say("basiliskra.roar_short", c.anchor("nose"), 128, 1, c.form === 2 ? 1.18 : 1);
      riftOpen(c.dim, at, RIFT_SIZE[c.form] * 0.6);
      riftClose(c.dim, at, RIFT_SIZE[c.form] * 0.6);
      this.brain?.finish();
      c.dropParts();
      try { c.entity.setProperty(PROP.bound, false); c.entity.remove(); } catch { /* already unloading */ }
    }
    cutAll();
    musicStop();
    this.creature = null; this.brain = null; this.runner = null; this.waterSearch = null;
    this.ending.reset();
    const old = store.rec;
    store.rec = freshRecord();
    store.rec.clock = old.clock;
    store.rec.fallout = old.fallout;
    store.rec.sites = old.sites;
    store.rec.cities = old.cities;
    store.save();
    store.flush();
    return was;
  }

  /** The config wheel: his next change, now, where he stands (with its scene). */
  evolveNow(): string {
    const c = this.creature, rec = store.rec;
    if (!c || !c.valid || rec.stage !== "alive") return "He is not here to change.";
    if (rec.evolve) return "He is changing already.";
    if (rec.form >= MAX_FORM) return `Basiliskra ${ROMAN[rec.form]} is his last form.`;
    this.ending.reset();
    rec.evolve = { to: (rec.form + 1) as 2 | 3 | 4, step: 0, t0: this.now, at: { ...c.pos } };
    store.save();
    return `Basiliskra ${ROMAN[rec.form]} is changing into Basiliskra ${ROMAN[rec.form + 1]}.`;
  }

  /** The config wheel: forget everything, as if the pack had just been added. */
  resetStory(): void {
    const c = this.creature;
    musicStop();
    this.creature = null; this.brain = null; this.runner = null;
    this.ending.reset();
    if (c) { c.dropParts(); try { c.entity.setProperty(PROP.bound, false); c.entity.remove(); } catch { /* gone */ } }
    const clock = store.rec.clock, cities = store.rec.cities;
    store.rec = freshRecord();
    store.rec.clock = clock;
    store.rec.cities = cities;                              // (they are in the world, whatever the story forgets)
    clearHarm();
    clearFallout();
    store.save();
    store.flush();
  }

  /** A copy, a stray summon, or anything after his departure: gone before it can act. */
  private quarantine(e: Entity): void {
    try { e.setProperty(PROP.bound, false); } catch { /* no matter */ }
    try { e.remove(); this.quarantined++; } catch { /* already gone */ }
  }

  private adopt(e: Entity): void {
    const rec = store.rec;
    try {
      e.setDynamicProperty(TOKEN, rec.token);
      e.triggerEvent(`basiliskra:bind_${rec.form}`);
    } catch { return; }
    this.nameHim(e);
    const c = new Creature(e);
    c.form = rec.form;
    c.resync();
    c.set(PROP.gill, rec.born > 0);
    c.set(PROP.visLo, 0);
    c.set(PROP.visHi, 8);
    this.creature = c;
    this.brain = this.makeBrain(c);
    this.missing = 0;
    this.runner = null;            // a sequence that was running belonged to the handle we no longer have
    // an encounter that was running when the world closed is over; saved sequences resume from the record
    this.ending.reset();
  }

  /** The stage of his life is his name: Basiliskra I, II, III.  It is what a death message says. */
  private nameHim(e: Entity): void {
    try { e.nameTag = `Basiliskra ${ROMAN[store.rec.form]}`; } catch { /* unloading */ }
  }

  private makeBrain(c: Creature): Brain {
    // Form III's walk cycle is counted from the foot that landed last; a fresh brain starts one beat before the first
    if (c.form === 3) c.set(PROP.gait, 3);
    if (c.form === 4) c.set(PROP.gait, 1);
    return c.form === 1 ? new BrainOne(c) : c.form === 2 ? new BrainTwo(c) : c.form === 4 ? new BrainFour(c) : new BrainThree(c);
  }

  /** The only place the entity is ever created.  The reservation is already saved when this runs. */
  private create(dim: Dimension, at: V3, yaw: number): boolean {
    const rec = store.rec;
    if (this.creature || rec.entityId !== null || !rec.token) return false;
    if (rec.stage !== "arriving" && rec.stage !== "alive") return false;
    if (!isLoaded(dim, at)) return false;
    let e: Entity;
    try { e = dim.spawnEntity(TYPE, at, { initialRotation: yaw }); } catch { return false; }
    this.ticket = e;
    try {
      e.setDynamicProperty(TOKEN, rec.token);
      rec.entityId = e.id;
      rec.down = null;
      store.save();
      this.adopt(e);
    } finally { this.ticket = null; }
    return this.creature !== null;
  }

  /** Look at every loaded entity of our types.  Bounded: type queries only, a few times a second. */
  sweep(): void {
    for (const id of [OVERWORLD, "minecraft:nether", "minecraft:the_end"]) {
      let dim: Dimension;
      try { dim = world.getDimension(id); } catch { continue; }
      let list: Entity[] = [];
      try { list = dim.getEntities({ type: TYPE }); } catch { list = []; }
      for (const e of list) this.inspect(e);
      try { list = dim.getEntities({ families: [PART_FAMILY] }); } catch { list = []; }
      for (const h of list) { try { if (!partOwner.has(h.id)) h.remove(); } catch { /* gone */ } }
    }
  }

  // ---- events from main ------------------------------------------------------------------------
  /** A region crossed the threshold.  Only the first request ever becomes a reservation. */
  requestArrival(t: Trigger): boolean {
    const rec = store.rec;
    // one call at a time; but a call that has already searched its own surroundings in vain gives way to a new one
    const stale = rec.stage === "pending" && rec.pending !== null && (rec.pending.passes ?? 0) >= 1 && rec.pending.region !== t.region;
    if (rec.stage !== "dormant" && !stale) return false;
    this.waterSearch = null; this.waterWait = 0;
    rec.stage = "pending";
    rec.pending = { site: { x: Math.floor(t.site.x), y: Math.floor(t.site.y), z: Math.floor(t.site.z) }, since: this.now, region: t.region };
    rec.origin = rec.pending.site;
    rec.guilty = t.guilty;
    rec.guiltyName = t.guiltyName;
    store.save();
    return true;
  }

  /** Called while the entity can still be read, for an unload as much as for a removal. */
  onRemoving(e: Entity): void {
    const c = this.creature;
    if (!c) return;
    try { if (e.id !== c.entity.id) return; } catch { return; }
    const rec = store.rec;
    try { const l = e.location; rec.last = { x: l.x, y: l.y, z: l.z, t: this.now }; } catch { /* keep the older fix */ }
    const parts = c;
    this.creature = null;
    this.runner = null;
    if (this.brain) { const b = this.brain; this.brain = null; system.run(() => { try { b.finish(); } catch { /* entity gone */ } }); }
    system.run(() => { parts.dropParts(); store.touch(); });
  }

  onDie(e: Entity): void {
    const rec = store.rec;
    let id = "";
    try { id = e.id; } catch { return; }
    if (rec.entityId !== id) return;
    // he is not killed, he is driven back through the seam.  The reservation stays; he returns.
    rec.entityId = null;
    rec.down = this.now;
    rec.health = 600;
    store.save();
  }

  /**
   * Worn down to his last breath he is not killed: a seam takes him where he stands, and he comes
   * back through the first one a day later, whole, in the form he had.  The reservation never lapses.
   */
  driveOff(force = false): void {
    const c = this.creature, rec = store.rec;
    if (!c || !c.valid || rec.stage !== "alive") return;
    if (!force && (rec.evolve || rec.ending?.step)) return;
    if (force) { this.ending.reset(); rec.evolve = null; }
    const at = { x: c.pos.x, y: c.pos.y + 3, z: c.pos.z };
    // the same voice at every age: through water, pitched up, or as it is
    if (c.form === 1) c.say("basiliskra.roar_under", c.anchor("nose"), 96);
    else c.say("basiliskra.roar_short", c.anchor("nose"), 128, 1, c.form === 2 ? 1.18 : 1);
    shake(c, 80, c.form === 1 ? 0.3 : 0.5, 1.2);
    sound(c.dim, "basiliskra.rift.open", at, 72, 1, 1.3);
    sound(c.dim, "basiliskra.rift.close", at, 72);
    for (const p of [at, c.anchor("nose"), c.anchor("tail_notch")]) particle(c.dim, "basiliskra:seam_close", p, 72);
    this.brain?.finish();
    rec.last = { x: c.pos.x, y: c.pos.y, z: c.pos.z, t: this.now };
    rec.entityId = null;
    rec.down = this.now;
    rec.health = 600;
    store.save();                                   // the record first: from here he is owed, not present
    this.creature = null; this.brain = null; this.runner = null;
    c.dropParts();
    try { c.entity.setProperty(PROP.bound, false); c.entity.remove(); } catch { /* already unloading */ }
  }

  onHurt(by: Player | undefined, amount: number): void {
    const c = this.creature;
    if (!c || amount <= 0) return;          // a snowball is not a wound
    this.brain?.onHurt(by);
    if (amount >= 6 && this.now - this.hurtCryAt > 70) { this.hurtCryAt = this.now; c.say("basiliskra.hurt", c.anchor("nose"), 64, 1, c.form === 1 ? 0.95 : c.form === 2 ? 1.25 : 1.05); }
  }

  // ---- tick ----------------------------------------------------------------------------------------
  tick(): void {
    const rec = store.rec;
    const now = ++rec.clock;
    if (now % 600 === 0) store.touch();          // the clock itself is worth saving twice a minute
    beginTick(now);
    filmTick();
    falloutTick(now);
    // (with Basiliskra himself not about, a Titan is what the music follows; and Titans fighting is a fight)
    const lead = this.creature ?? titans.creatures().find((t) => t.valid) ?? null;
    musicTick(lead, now, this.brain?.actName ?? "", this.brain?.hurtAt ?? -1, titans.fighting());
    cityTick(now);
    titans.tick(now);
    if (this.creature && !this.creature.valid) { this.creature.dropParts(); this.creature = null; this.brain = null; this.runner = null; }
    if (now % 20 === 0) this.sweep();
    switch (rec.stage) {
      case "pending": this.tryReserve(); break;
      case "arriving": this.arrive(); break;
      case "alive": this.live(); break;
      default: break;
    }
    if (now % 40 === 0) store.flush();
  }

  // ---- pending -> reservation ------------------------------------------------------------------------
  /**
   * Deep water near the site with a clear lane to swim out of the seam and to turn and ram it:
   * every block of a box LANE long, seven wide and his own height deep, from behind where he is
   * created to beyond where he turns.  Nearest places first; the four compass headings, the one
   * facing the shore he was called to before the others.  The reading is spread over ticks (a few
   * hundred blocks at a time) and never goes through an unloaded chunk.
   */
  private waterSearch: Generator<void, { at: V3; yaw: number } | null, void> | null = null;
  private waterWait = 0;
  private *searchWater(site: V3): Generator<void, { at: V3; yaw: number } | null, void> {
    const dim = overworld();
    const LANE = 44, BACK = 9, DEEP = 6, seed = this.now;
    let reads = 0;
    for (let i = 0; i < WATER_CANDIDATES; i++) {
      const a = hash(seed, i, 1) * Math.PI * 2;
      const r = 6 + (i / WATER_CANDIDATES) * 90;
      const x = Math.floor(site.x + Math.cos(a) * r), z = Math.floor(site.z + Math.sin(a) * r);
      const col = waterColumn(dim, x, z, site.y, 16, 12);
      yield;
      if (col === UNLOADED || col === NONE || col.surface - col.floor < DEEP) continue;
      const toward = yawTo({ x, y: 0, z }, site);
      const yaws = [0, 90, 180, 270].sort((p, q) => Math.cos((toward - q) * Math.PI / 180) - Math.cos((toward - p) * Math.PI / 180));
      for (const yaw of yaws) {
        const f = forwardOf(yaw), l = { x: f.z, y: 0, z: -f.x };
        let ok = true;
        lane: for (let s = -BACK; s <= LANE; s++) {
          for (let side = -3; side <= 3; side++) for (const d of [2, 4, 6]) {
            const b = blockAt(dim, { x: x + f.x * s + l.x * side, y: col.surface - d, z: z + f.z * s + l.z * side });
            if (!b || !isWaterId(b.typeId)) { ok = false; break lane; }
          }
          if ((reads += 21) >= 252) { reads = 0; yield; }
        }
        if (ok) return { at: { x: x + 0.5, y: col.surface - 5.5, z: z + 0.5 }, yaw };
      }
    }
    return null;
  }

  private tryReserve(): void {
    const rec = store.rec;
    if (rec.stage !== "pending" || !rec.pending) return;
    if (this.now < this.waterWait) return;
    const site = rec.pending.site;
    const dim = overworld();
    // the coast has to be loaded: if nobody is near, the event simply waits
    if (!this.waterSearch || this.now % 20 === 0) {
      if (!players().some((p) => { try { return p.dimension.id === dim.id && distXZ(p.location, site) < 128; } catch { return false; } })) { this.waterSearch = null; this.waterWait = this.now + 100; return; }
    }
    if (!this.waterSearch) this.waterSearch = this.searchWater(site);
    const step = this.waterSearch.next();
    if (!step.done) return;
    this.waterSearch = null;
    const w = step.value;
    if (!w) {
      // a whole round of candidates with the site loaded and nothing deep and clear enough: remember it
      rec.pending.passes = (rec.pending.passes ?? 0) + 1;
      this.waterWait = this.now + 200;
      // after a dozen rounds the call lapses.  The harm is still on record and can call again.
      if (rec.pending.passes >= 12) { rec.stage = "dormant"; rec.pending = null; rec.origin = null; rec.guilty = null; rec.guiltyName = null; }
      store.save();
      return;
    }
    // RESERVE FIRST.  From this line on exactly one Basiliskra is owed to this world.
    rec.stage = "arriving";
    rec.token = newToken();
    rec.entityId = null;
    rec.form = 1;
    rec.pending = null;
    rec.arrival = { step: 0, t0: this.now, water: w.at, yaw: w.yaw };
    store.save();
  }

  // ---- arrival ---------------------------------------------------------------------------------------
  private setStep(step: number): void {
    const a = store.rec.arrival;
    if (!a) return;
    a.step = step; a.t0 = this.now;
    store.save();
  }

  private arrive(): void {
    const rec = store.rec, a = rec.arrival;
    if (!a) { rec.stage = rec.entityId || rec.down !== null ? "alive" : "dormant"; store.save(); return; }
    const dim = overworld(), now = this.now, t = now - a.t0;
    if (a.land) { this.arriveLand(); return; }
    const near = players().some((p) => { try { return p.dimension.id === dim.id && distXZ(p.location, a.water) < 96; } catch { return false; } });
    if (a.step >= SPAWN_STEP) {
      // creation has been attempted at some point: reconcile identity before anything else
      if (!this.creature) {
        if (rec.entityId !== null) return;               // he exists but is not loaded: wait for him
        if (!isLoaded(dim, a.water)) return;
        if (now % 10 === 0) this.sweep();                // adopts a matching token if one is loaded
        if (this.creature) { this.runner = null; }
        else if (++this.missing > 200) { this.missing = 0; this.runner = null; this.setStep(SPAWN_STEP); }
        else if (a.step > SPAWN_STEP) return;
      }
    }
    switch (a.step) {
      case 0: {
        // fish bunch where the river meets the bay
        if (near && now % 60 === 0 && isLoaded(dim, a.water)) {
          for (const f of dim.getEntities({ location: a.water, maxDistance: 40, families: ["fish"] }).slice(0, 12)) {
            try { f.applyImpulse(mul(norm(sub(a.water, f.location)), 0.12)); } catch { /* gone */ }
          }
        }
        const tod = world.getTimeOfDay();
        if (near && (isDusk(tod) || t > pace(1.2 * TICKS.day))) this.setStep(1);
        break;
      }
      case 1: {
        // an empty boat knocks against the pier three times
        if (t % KNOCK_GAP_TICKS === 2 && t < KNOCK_GAP_TICKS * 3) {
          let at = add(a.water, { x: 0, y: 5.5, z: 0 });
          try {
            const boat = dim.getEntities({ location: a.water, maxDistance: 40, families: ["boat"] }).find((b) => {
              try { return !(b.getComponent("minecraft:rideable")?.getRiders().length); } catch { return true; }
            });
            if (boat) { at = boat.location; boat.applyImpulse({ x: (hash(now, 1) - 0.5) * 0.2, y: 0.02, z: (hash(now, 2) - 0.5) * 0.2 }); }
          } catch { /* no boat: the sound alone */ }
          sound(dim, "basiliskra.boat_knock", at, 32);
        }
        if (t > KNOCK_GAP_TICKS * 3 + 30) {
          rec.rift = { ...a.water, yaw: a.yaw };       // saved with the step, so a restart cannot lose where the seam is
          this.setStep(2);
        }
        break;
      }
      case 2: {
        // the rift tears open in the water, from the bed to well above the surface, and everyone near is shown it
        const foot = { x: a.water.x, y: a.water.y - 2, z: a.water.z };
        if (t === 1) {
          riftOpen(dim, foot, RIFT_SIZE[1]);
          sceneTheme("dread", 300, foot, dim.id);
          addFallout(a.water, 4, 0.4);
          const head = () => (this.creature ? this.creature.anchor("nose") : { x: a.water.x, y: a.water.y + 4, z: a.water.z });
          film(dim, head, { ticks: 330, radius: 110, dist: 30, height: 9, orbit: 50, distEnd: 22, flash: { red: 0.8, green: 0.05, blue: 0.05 } });
        }
        riftTick(dim, foot, RIFT_SIZE[1], t, Math.min(1, t / 90));
        if (t % 4 === 0) particle(dim, "basiliskra:seam", a.water, 72);
        if (t > 90 && near) this.setStep(SPAWN_STEP);
        break;
      }
      case SPAWN_STEP: {
        riftTick(dim, { x: a.water.x, y: a.water.y - 2, z: a.water.z }, RIFT_SIZE[1], t, 1);
        if (!this.creature) {
          if (t % 20 !== 1) break;
          // his head is at the seam; the rest of him is still on the other side
          const at = add(a.water, mul(forwardOf(a.yaw), -7));
          if (!this.create(dim, at, a.yaw)) break;       // not loaded yet: the reservation simply waits
          const c = this.creature!;
          c.set(PROP.visLo, 9);
          c.setPhase("arrive");
        }
        this.setStep(4);
        this.runner = this.emerge(true);
        break;
      }
      default: {
        if (!this.creature) break;
        // resumed after a restart: he is already through.  Finish quietly.
        if (!this.runner) this.runner = this.emerge(false);
        const done = this.runner.next().done;
        this.creature.update();
        if (done) {
          this.runner = null;
          rec.stage = "alive";
          rec.arrival = null;
          if (!rec.born) { rec.born = Math.max(1, now); rec.mut.formSince = now; }
          store.save();
          this.brain?.finish();
        }
        break;
      }
    }
  }

  // ---- a rift on land (a call from the wheel once he is Basiliskra II or more) -----------------------------
  private arriveLand(): void {
    const rec = store.rec, a = rec.arrival!, dim = overworld(), t = this.now - a.t0;
    const form = rec.form, size = RIFT_SIZE[form], at = a.water;
    if (a.step === 0) {
      // the tear opens, and swells for three seconds
      if (this.riftShown !== a.t0) {
        this.riftShown = a.t0;
        riftOpen(dim, at, size);
        sceneTheme(store.rec.form >= 3 ? "wrath" : "dread", 420, at, dim.id);
        addFallout(at, 5, 0.5);
        const focus = (): V3 => (this.creature ? this.creature.anchor("nose") : { x: at.x, y: at.y + size * 0.4, z: at.z });
        film(dim, focus, { ticks: 400, radius: 120, dist: size * 1.5 + 14, height: size * 0.35 + 4, orbit: 60, distEnd: size * 1.2 + 10,
                           flash: { red: 0.8, green: 0.05, blue: 0.05 } });
      }
      riftTick(dim, at, size, t, Math.min(1, t / 60));
      if (t < 60) return;
      // he is made behind it, unseen (the reservation simply waits if that place is not loaded yet)
      if (!this.creature) {
        const f = forwardOf(a.yaw);
        const reach = [0, 14, 12, 30, 22][form];        // how far in front of his middle his nose is
        const back = add(at, mul(f, -(reach + 2)));
        if (!this.create(dim, { x: back.x, y: at.y + 1, z: back.z }, a.yaw)) return;
      }
      const c = this.creature!;
      c.set(PROP.visLo, 9);
      c.setPhase("move");
      c.wade = true;
      this.setStep(4);
      this.runner = this.landWalk();
      return;
    }
    if (!this.creature) {
      // a restart caught him part-way through: he is simply there
      if (rec.entityId !== null) return;                             // he exists but is not loaded: wait for him
      if (this.create(dim, { x: at.x, y: at.y + 1, z: at.z }, a.yaw)) this.finishArrival();
      return;
    }
    if (!this.runner) { this.finishArrival(); return; }
    const done = this.runner.next().done;
    this.creature.update();
    if (done) { this.runner = null; this.finishArrival(); }
  }
  private riftShown = -1;

  /** He is through: the story has him, and he says so. */
  private finishArrival(): void {
    const rec = store.rec, c = this.creature;
    rec.stage = "alive";
    rec.arrival = null;
    if (!rec.born) { rec.born = Math.max(1, this.now); rec.mut.formSince = this.now; }
    store.save();
    if (c) { c.set(PROP.visLo, 0); c.set(PROP.visHi, 8); c.wade = false; }
    this.brain?.finish();
    const b = this.brain;
    // Basiliskra IV makes his entrance every time he comes through: the beam first, and only then the roar
    if (b instanceof BrainFour) rec.four = { debut: false, shots: rec.four?.shots ?? 0, plate: rec.four?.plate ?? null };
    else if (b instanceof BrainThree) b.forced = { name: "roar", run: b.roar(true), limit: 220 };
    else if (b instanceof BrainTwo) b.forced = { name: "roar", run: b.roar(), limit: 120 };
  }

  /** He walks out through the tear: what has passed it is what is seen.  Then it closes behind him. */
  private *landWalk(): Generator<void, void, void> {
    const rec = store.rec, a = rec.arrival!, dim = overworld();
    const form = rec.form, size = RIFT_SIZE[form];
    const at = a.water, f = forwardOf(a.yaw);
    const tail = [0, 26, 24, 42, 70][form];           // how far behind his middle his tail ends
    const c = this.creature!;
    c.goTo(add(at, mul(f, tail + 4)), form === 2 ? 0.1 : 0.14, 2);
    for (let t = 0; t < 700; t++) {
      if (!this.creature) return;
      const pass = this.passed(c, at, a.yaw);
      let lo = 9;
      for (let z = 8; z >= 0 && pass[z]; z--) lo = z;
      c.set(PROP.visLo, lo);
      riftTick(dim, at, size, 60 + t, 1);
      if (t % 24 === 0) { c.say(form >= 3 ? "basiliskra.iii.step" : "basiliskra.ii.drag", c.anchor("nose"), 96, 1, 0.9); shake(c, 48, 0.2, 0.3); }
      if (lo === 0 || c.arrived() || c.blocked > 40) break;
      yield;
    }
    c.wade = false;
    c.set(PROP.visLo, 0);
    c.halt();
    riftClose(dim, at, size);
    for (let t = 0; t < 20; t++) yield;
  }

  /** Zones (head 8 .. tail 0) that have passed a plane through `at` facing `yaw`. */
  private passed(c: Creature, at: V3, yaw: number): boolean[] {
    const f = forwardOf(yaw);
    const zones = RIGS[c.form].zones;
    const out: boolean[] = [];
    for (let z = 0; z <= 8; z++) {
      const bones = zones[String(z)];
      if (!bones || !bones.length) { out.push(out.length ? out[out.length - 1] : false); continue; }
      const p = c.point(bones[0], RIGS[c.form].bones[bones[0]].pivot);
      out.push(dot(sub(p, at), f) > 0);
    }
    return out;
  }

  /** He slips through, the seam closes across his tail tip, and he rams the empty water three times. */
  private *emerge(full: boolean): Generator<void, void, void> {
    const rec = store.rec, a = rec.arrival!, dim = overworld();
    const c = this.creature!;
    const f = forwardOf(a.yaw);
    if (full) {
      c.swimDepth = 5.5;
      c.goTo(add(a.water, mul(f, 44)), 0.3, 2);
      sound(dim, "basiliskra.i.swim", a.water, 56);
      for (let t = 0; t < 260; t++) {
        if (!this.creature) return;
        const pass = this.passed(c, a.water, a.yaw);
        let lo = 9;
        for (let z = 8; z >= 0 && pass[z]; z--) lo = z;
        c.set(PROP.visLo, lo);
        riftTick(dim, { x: a.water.x, y: a.water.y - 2, z: a.water.z }, RIFT_SIZE[1], t, 1);
        if (lo === 0) break;
        yield;
      }
      // the seam closes across the tip of his tail: the pale notch he carries from now on
      c.set(PROP.visLo, 0);
      riftClose(dim, { x: a.water.x, y: a.water.y - 2, z: a.water.z }, RIFT_SIZE[1]);
      this.setStep(5);
      c.halt();
      for (let t = 0; t < 30; t++) yield;
      // he turns on the place he came through and rams the empty water: once, twice, three times
      const door = add(a.water, mul(f, 5));
      c.setPhase("move");
      c.goTo(door, 0.1, 5);                                  // slow, so the turn is tight: he swings round on himself
      for (let t = 0; t < 130 && Math.abs(wrapDeg(yawTo(c.pos, door) - c.yaw)) > 10; t++) { if (!this.creature) return; yield; }
      for (let k = 0; k < 3; k++) {
        if (!this.creature) return;
        c.setPhase("ram");
        c.goTo(door, 0.62, 5);
        for (let t = 0; t < 90 && !c.arrived() && c.blocked < 6; t++) yield;
        c.halt(); c.speed = 0;                              // stopped dead, by nothing
        const nose = c.anchor("muzzle");
        sound(dim, "basiliskra.ram", nose, 80, 1, k === 2 ? 0.86 : 1);
        particle(dim, "basiliskra:shock_ring", nose, 72);
        if (k === 2) {
          // on the third his left gill sticks open, and a boat overhead rocks sideways
          c.set(PROP.gill, true);
          sound(dim, "basiliskra.i.gill_catch", c.anchor("gill_l"), 32);
          // and for the first time he is heard: the roar, through the water
          sound(dim, "basiliskra.roar_under", nose, 96, 0.9);
          shake(c, 64, 0.35, 1.5);
          try {
            for (const b of dim.getEntities({ location: nose, maxDistance: 32, families: ["boat"] })) b.applyImpulse(mul({ x: -f.z, y: 0.12, z: f.x }, 0.35));
          } catch { /* no boats */ }
        }
        for (let t = 0; t < 22; t++) yield;
        if (k === 2) break;
        // he backs off down his own length, still facing it, for another run
        c.setPhase("move");
        for (let t = 0; t < 64; t++) {
          if (!this.creature) return;
          const to = add(c.pos, mul(c.forward, -0.24)), tail = add(to, mul(c.forward, -20));
          const wet = (p: V3) => deepHere(dim, p.x, p.z, Math.floor(c.pos.y) + 3, 3) === true;
          if (!wet(to) || !wet(tail)) break;
          c.pos = to;
          yield;
        }
      }
      this.setStep(6);
    }
    if (!this.creature) return;
    // and he sinks
    c.set(PROP.visLo, 0);
    c.set(PROP.gill, true);
    c.halt();
    c.setPhase("idle");
    c.swimDepth = 64;
    for (let t = 0; t < 80; t++) yield;
  }

  // ---- alive --------------------------------------------------------------------------------------------
  private live(): void {
    const rec = store.rec, now = this.now;
    const c = this.creature;
    if (!c) { this.absent(); return; }
    if (rec.evolve) this.evolve(c);
    else if (!this.ending.drive(c)) this.brain?.tick();
    if (this.creature !== c) return;                 // retired, driven off or unloaded by what just ran
    c.update();
    this.ending.tick(c);
    if (now % 20 === 0) {
      rec.last = { x: c.pos.x, y: c.pos.y, z: c.pos.z, t: now };
      try { const h = c.entity.getComponent("minecraft:health"); if (h) rec.health = h.currentValue; } catch { /* unloading */ }
      store.touch();
    }
  }

  /** He is owed to this world but not loaded here.  That alone is never a reason to make another. */
  private absent(): void {
    const rec = store.rec, now = this.now;
    this.ending.tick(null);
    if (now % 100 !== 0) return;
    const dim = overworld();
    if (rec.entityId !== null) {
      // loaded somewhere we did not look?
      try { const e = world.getEntity(rec.entityId); if (e) { this.inspect(e); return; } } catch { /* not loaded */ }
      // only if every chunk round his last known place is loaded and watched for a full minute
      // do we accept that he is gone from the save, and let him come back through the seam
      const l = rec.last;
      if (!l) return;
      let all = true;
      for (const dx of [-48, -24, 0, 24, 48]) for (const dz of [-48, -24, 0, 24, 48]) if (!isLoaded(dim, { x: l.x + dx, y: l.y, z: l.z + dz })) all = false;
      const watched = players().some((p) => { try { return p.dimension.id === dim.id && distXZ(p.location, l) < 40; } catch { return false; } });
      if (all && watched) { if (++this.missing >= 12) { this.missing = 0; rec.entityId = null; rec.down = now - pace(TICKS.day); store.save(); } }
      else this.missing = 0;
      return;
    }
    if (rec.down === null) { rec.down = now; store.touch(); return; }
    // driven off: he comes back the way he came, a day later, in the form he had
    if (now - rec.down < pace(TICKS.day) || !rec.rift) return;
    // brought somewhere on purpose, he comes back there (on land: a land form is never put back at the bottom of the
    // water); otherwise the way he came, through the seam
    const at = rec.form !== 1 && rec.home ? rec.home : rec.form === 1 ? rec.rift : (rec.beach ?? rec.rift);
    const near = players().some((p) => { try { return p.dimension.id === dim.id && distXZ(p.location, at) < 96; } catch { return false; } });
    if (!near) return;
    if (!isLoaded(dim, at)) return;
    sound(dim, "basiliskra.rift.open", rec.rift, 72);
    this.create(dim, { x: at.x + 0.5, y: at.y + (rec.form === 1 ? 0 : 1), z: at.z + 0.5 }, rec.rift.yaw);
  }

  // ---- evolution: the same entity, in place, resumable ---------------------------------------------------
  /** The scene that is playing (so that its film is started once). */
  private sceneKey = "";
  private evolve(c: Creature): void {
    const rec = store.rec, ev = rec.evolve!, now = this.now;
    c.halt();
    // every change is a scene of its own (change.ts): what happens to him, to the place, and where the camera stands
    const CH = CHANGES[ev.to];
    const big = [0, 6, 9, 16, 34][ev.to] ?? 16;                         // roughly his size after it, in blocks
    if (ev.step === 0) {
      const key = `${ev.to}:${rec.token}:${rec.mut.formSince}`;
      if (this.sceneKey !== key) {
        // it begins now (a scene cut off by the world closing begins again: he is still the animal he was)
        this.sceneKey = key;
        ev.t0 = now;
        this.brain?.finish();
        const was = (ev.to - 1) as 1 | 2 | 3, Fo = FRAME[was], Fn = FRAME[ev.to];
        const body = () => ({ x: c.pos.x, y: c.pos.y + BODY_MID[c.form], z: c.pos.z });
        film(c.dim, body, { ticks: CH.before + CH.after + CH.hold, radius: 140, dist: Fo, height: 4, cinema: true, facing: () => c.yaw, shots: CH.shots(c, Fo, Fn) });
      }
      const t = now - ev.t0;
      if (t >= 0 && t < CH.before) { CH.pre(c, t); return; }
      // the instant of it
      CH.burst(c);
      particle(c.dim, "basiliskra:rift_flash", { x: c.pos.x, y: c.pos.y, z: c.pos.z }, 200, sizeVars(big * 1.6));
      for (const p of players()) {
        try {
          if (p.dimension.id === c.dim.id && dist(p.location, c.pos) < 140) {
            p.camera.fade({ fadeColor: { red: CH.flash.red, green: CH.flash.green, blue: CH.flash.blue }, fadeTime: { fadeInTime: 0.05, holdTime: CH.flash.hold, fadeOutTime: CH.flash.fade } });
          }
        } catch { /* left */ }
      }
      // the record changes first; the entity is then brought into line with it
      rec.form = ev.to;
      rec.mut.formSince = now;
      if (ev.to === 4) rec.four = undefined;
      ev.step = 1; ev.t0 = now;
      store.save();
      return;
    }
    if (ev.step === 1) {
      if (c.form !== rec.form) {
        c.form = rec.form;
        try { c.entity.triggerEvent(`basiliskra:bind_${rec.form}`); } catch { return; }
        this.nameHim(c.entity);
        c.dropParts();
        c.resync();
        this.brain = this.makeBrain(c);
        addFallout(c.pos, rec.form >= 3 ? 7 : 4, rec.form >= 3 ? 0.9 : 0.45);     // the change poisons the ground it happens on
        if (rec.form === 2) {
          // a crimson strip of shed fin lies where he struggled
          this.dropFin(c.dim, c.pos);
          rec.beach = { x: Math.floor(c.pos.x), y: Math.floor(c.pos.y), z: Math.floor(c.pos.z) };
        }
      }
      ev.step = 2; ev.t0 = now;
      CH.post(c, 0);
      if (CH.nameAt === 0) this.nameCard(c, ev.to);
      store.save();
      return;
    }
    if (c.form !== rec.form) { ev.step = 1; return; }       // reloaded between the two writes
    const t = now - ev.t0;
    if (t > 0 && t < CH.after) {
      CH.post(c, t);
      if (t === CH.nameAt) this.nameCard(c, ev.to);
      return;
    }
    c.setCharge(0);
    rec.evolve = null;
    store.save();
    this.brain?.finish();
    // the change is over, and he says so: the whole roar as Basiliskra III, the short one, younger, as II
    const b = this.brain;
    // (Basiliskra IV's first roar comes after his first beam: his brain begins with that)
    if (b instanceof BrainFour) { /* his debut is his own */ }
    else if (b instanceof BrainThree) b.forced = { name: "roar", run: b.roar(true), limit: 220 };
    else if (b instanceof BrainTwo) b.forced = { name: "roar", run: b.roar(), limit: 120 };
  }

  /** His name, as the new animal is seen for the first time. */
  private nameCard(c: Creature, form: number): void {
    for (const p of players()) {
      try {
        if (p.dimension.id !== c.dim.id || dist(p.location, c.pos) > 160) continue;
        p.onScreenDisplay.setTitle(`§4BASILISKRA ${ROMAN[form]}`, { subtitle: NAME_CARD[form], fadeInDuration: 12, stayDuration: 60, fadeOutDuration: 24 });
      } catch { /* left */ }
    }
  }

  dropFin(dim: Dimension, at: V3): void {
    try {
      dim.spawnItem(new ItemStack(FIN_ITEM, 1), { x: at.x, y: at.y + 1, z: at.z });
      store.rec.learned.fragments++;
      store.rec.learned.fragmentAt = this.now;
      store.touch();
    } catch { /* not loaded */ }
  }

  /** He is fully across.  Only now is the encounter retired, permanently, for this save. */
  retire(): void {
    const rec = store.rec;
    const c = this.creature;
    this.creature = null;
    this.brain = null;
    if (c) { c.dropParts(); try { c.entity.remove(); } catch { /* gone */ } }
    rec.stage = "departed";
    rec.entityId = null;
    rec.down = null;
    rec.evolve = null;
    rec.ending = null;
    rec.arrival = null;
    rec.pending = null;
    store.save();
  }
}
