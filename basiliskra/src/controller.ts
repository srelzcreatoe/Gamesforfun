/**
 * The one controller.  Every appearance of Basiliskra -- the first arrival, a return after a
 * death, a reload, an evolution -- goes through here, and it is the only code that ever creates
 * the entity.  It reserves in the world record BEFORE it creates anything, so two simultaneous
 * triggers, an interrupted arrival or a restart can never make a second animal.
 */
import { Dimension, Entity, ItemStack, Player, system, world } from "@minecraft/server";
import { CONFIG, FIN_ITEM, HITBOX, KNOCK_GAP_TICKS, OVERWORLD, PROP, TICKS, TYPE } from "./config";
import { Brain, isDusk, pace } from "./brain";
import { Creature, partOwner } from "./creature";
import { Ending } from "./ending";
import { BrainOne } from "./forms/one";
import { BrainThree } from "./forms/three";
import { BrainTwo } from "./forms/two";
import { beginTick, particle, players, sound } from "./fx";
import { RIGS } from "./generated/rig";
import type { Trigger } from "./harm";
import { newToken, store } from "./store";
import { add, dist, distXZ, dot, forwardOf, hash, mul, norm, sub, wrapDeg, yawTo, type V3 } from "./vec";
import { NONE, UNLOADED, deepHere, isLoaded, overworld, waterColumn } from "./world";

const TOKEN = "bk:token";
const SPAWN_STEP = 3;

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

  get now(): number { return system.currentTick; }

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
    this.quarantine(e);
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
    const c = new Creature(e);
    c.form = rec.form;
    c.resync();
    c.set(PROP.gill, rec.born > 0);
    c.set(PROP.visLo, 0);
    c.set(PROP.visHi, 8);
    this.creature = c;
    this.brain = this.makeBrain(c);
    this.missing = 0;
    // an encounter that was running when the world closed is over; saved sequences resume from the record
    this.ending.reset();
  }

  private makeBrain(c: Creature): Brain {
    return c.form === 1 ? new BrainOne(c) : c.form === 2 ? new BrainTwo(c) : new BrainThree(c);
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
      try { list = dim.getEntities({ type: HITBOX }); } catch { list = []; }
      for (const h of list) { try { if (!partOwner.has(h.id)) h.remove(); } catch { /* gone */ } }
    }
  }

  // ---- events from main ------------------------------------------------------------------------
  /** A region crossed the threshold.  Only the first request ever becomes a reservation. */
  requestArrival(t: Trigger): boolean {
    const rec = store.rec;
    if (rec.stage !== "dormant") return false;
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
    rec.health = 300;
    store.save();
  }

  onHurt(by: Player | undefined, amount: number): void {
    const c = this.creature;
    if (!c || amount <= 0) return;          // a snowball is not a wound
    this.brain?.onHurt(by);
    if (amount >= 6 && this.now - this.hurtCryAt > 70) { this.hurtCryAt = this.now; c.say("basiliskra.hurt", c.anchor("nose"), 64); }
  }

  // ---- tick ----------------------------------------------------------------------------------------
  tick(): void {
    const now = this.now;
    beginTick(now);
    const rec = store.rec;
    if (this.creature && !this.creature.valid) { this.creature.dropParts(); this.creature = null; this.brain = null; }
    if (now % 20 === 0) this.sweep();
    switch (rec.stage) {
      case "pending": if (now % 100 === 0) this.tryReserve(); break;
      case "arriving": this.arrive(); break;
      case "alive": this.live(); break;
      default: break;
    }
    if (now % 40 === 0) store.flush();
  }

  // ---- pending -> reservation ------------------------------------------------------------------------
  /** A stretch of deep, loaded water near the damaged coast with room for a thirty-block body. */
  /**
   * Deep water near the site with a clear lane to swim out of the seam and to turn and ram it:
   * LANE blocks of open water ahead, three abreast.  A few candidates are read per call (the
   * search continues on the next call), nearest first, and never through an unloaded chunk.
   */
  private waterTry = 0;
  private findWater(site: V3): { at: V3; yaw: number } | null {
    const dim = overworld();
    const LANE = 44, DEEP = 6;
    for (let n = 0; n < 6; n++) {
      const i = this.waterTry++ % 60;
      const a = hash(this.now, i, 1) * Math.PI * 2;
      const r = 6 + (i / 60) * 70;
      const x = Math.floor(site.x + Math.cos(a) * r), z = Math.floor(site.z + Math.sin(a) * r);
      const col = waterColumn(dim, x, z, site.y, 16);
      if (col === UNLOADED || col === NONE || col.surface - col.floor < DEEP) continue;
      const toward = yawTo({ x, y: 0, z }, site);
      // he comes through facing the shore he was called to if there is room; if not, along it; if not, out to sea
      const yaws = [0, 45, 90, 135, 180, 225, 270, 315].sort((p, q) => Math.cos((toward - q) * Math.PI / 180) - Math.cos((toward - p) * Math.PI / 180));
      for (const yaw of yaws) {
        const f = forwardOf(yaw), l = { x: f.z, y: 0, z: -f.x };
        let ok = true;
        for (const side of [0, -3, 3]) {
          for (let s = side ? 2 : 4; s <= LANE && ok; s += side ? 3 : 4) {
            if (deepHere(dim, x + f.x * s + l.x * side, z + f.z * s + l.z * side, col.surface, DEEP) !== true) ok = false;
          }
          if (!ok) break;
        }
        if (ok) return { at: { x: x + 0.5, y: col.surface - 5.5, z: z + 0.5 }, yaw };
      }
    }
    return null;
  }
  private tryReserve(): void {
    const rec = store.rec;
    if (rec.stage !== "pending" || !rec.pending) return;
    const site = rec.pending.site;
    const dim = overworld();
    // the coast has to be loaded: if nobody is near, the event simply waits
    if (!players().some((p) => { try { return p.dimension.id === dim.id && distXZ(p.location, site) < 128; } catch { return false; } })) return;
    const w = this.findWater(site);
    if (!w) return;
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
    const near = players().some((p) => { try { return p.dimension.id === dim.id && distXZ(p.location, a.water) < 96; } catch { return false; } });
    if (a.step >= SPAWN_STEP) {
      // creation has been attempted at some point: reconcile identity before anything else
      if (!this.creature) {
        if (rec.entityId !== null) return;               // he exists but is not loaded: wait for him
        if (!isLoaded(dim, a.water)) return;
        this.sweep();                                    // adopts a matching token if one is loaded
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
        if (t > KNOCK_GAP_TICKS * 3 + 30) this.setStep(2);
        break;
      }
      case 2: {
        // at dusk a vertical red seam opens below the surface
        if (t === 1) {
          rec.rift = { ...a.water, yaw: a.yaw };
          store.save();
          sound(dim, "basiliskra.rift.open", a.water, 72);
        }
        if (t % 4 === 0) particle(dim, "basiliskra:seam", a.water, 72);
        if (t % 60 === 30) sound(dim, "basiliskra.rift.hum", a.water, 48);
        if (t > 90 && near) this.setStep(SPAWN_STEP);
        break;
      }
      case SPAWN_STEP: {
        if (t % 4 === 0) particle(dim, "basiliskra:seam", a.water, 72);
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
          if (!rec.born) { rec.born = now; rec.mut.formSince = now; }
          store.save();
          this.brain?.finish();
        }
        break;
      }
    }
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
        if (t % 4 === 0) particle(dim, "basiliskra:seam", a.water, 72);
        if (lo === 0) break;
        yield;
      }
      // the seam closes across the tip of his tail: the pale notch he carries from now on
      c.set(PROP.visLo, 0);
      sound(dim, "basiliskra.rift.close", a.water, 72);
      particle(dim, "basiliskra:seam_close", a.water, 72);
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
          try {
            for (const b of dim.getEntities({ location: nose, maxDistance: 18, families: ["boat"] })) b.applyImpulse(mul({ x: -f.z, y: 0.12, z: f.x }, 0.35));
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
    const near = players().some((p) => { try { return p.dimension.id === dim.id && distXZ(p.location, rec.rift!) < 96; } catch { return false; } });
    if (!near) return;
    const at = rec.form === 1 ? rec.rift : (rec.beach ?? rec.rift);
    if (!isLoaded(dim, at)) return;
    sound(dim, "basiliskra.rift.open", rec.rift, 72);
    this.create(dim, { x: at.x + 0.5, y: at.y + (rec.form === 1 ? 0 : 1), z: at.z + 0.5 }, rec.rift.yaw);
  }

  // ---- evolution: the same entity, in place, resumable ---------------------------------------------------
  private evolve(c: Creature): void {
    const rec = store.rec, ev = rec.evolve!, now = this.now;
    const t = now - ev.t0;
    c.halt();
    if (ev.step === 0) {
      if (c.phase !== "evolve") { this.brain?.finish(); c.setPhase("evolve"); c.say("basiliskra.mutate", c.pos, 72); }
      if (t >= 90 || t < 0) {
        // the record changes first; the entity is then brought into line with it
        rec.form = ev.to;
        rec.mut.formSince = now;
        ev.step = 1; ev.t0 = now;
        store.save();
      }
      return;
    }
    if (ev.step === 1) {
      if (c.form !== rec.form) {
        c.form = rec.form;
        try { c.entity.triggerEvent(`basiliskra:bind_${rec.form}`); } catch { return; }
        c.dropParts();
        c.resync();
        this.brain = this.makeBrain(c);
        c.setPhase("beach");
        c.say("basiliskra.mutate", c.pos, 72, 1, 0.9);
        if (rec.form === 2) {
          // a crimson strip of shed fin lies where he struggled
          this.dropFin(c.dim, c.pos);
          rec.beach = { x: Math.floor(c.pos.x), y: Math.floor(c.pos.y), z: Math.floor(c.pos.z) };
        }
      }
      ev.step = 2; ev.t0 = now;
      store.save();
      return;
    }
    if (c.form !== rec.form) { ev.step = 1; return; }       // reloaded between the two writes
    if (c.phase !== "beach") c.setPhase("beach");
    if (t >= 70) {
      rec.evolve = null;
      store.save();
      this.brain?.finish();
      if (rec.form === 3) c.say("basiliskra.iii.roar", c.anchor("nose"), 128);
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
