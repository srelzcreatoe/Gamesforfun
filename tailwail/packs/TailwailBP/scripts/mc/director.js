// Global coordinator: one decision loop for every encounter, per-player scheduling and
// escalation, presence events, spawning, event wiring and orphan cleanup.
import { ButtonState, Difficulty, GameMode, InputButton, ItemStack, Player, system, world } from "@minecraft/server";
import { ADDON_VERSION, ECHO_ID, ENCOUNTER, ENTITY_ID, GUIDE_ITEM_ID, LURE_ID, SEARCH, TICKS } from "../config.js";
import { RP_CHECK_KEY } from "../core/ids.js";
import { unlock } from "../core/journal.js";
import { setupWeights } from "../core/memory.js";
import { PRESENCE_EVENTS, pickPresence } from "../core/presence_rules.js";
import {
  computeStage, eligibility, encounterBlockers, ensureFirst, onPlayerDeath, onPresence, pickGroupTarget, rollStart, tickEligible,
} from "../core/scheduler.js";
import { SETUPS, fitsTerrain, pickSetup, setupsForStage } from "../core/setups.js";
import { makeRng } from "../util/rng.js";
import { dist, hdist, yawTo } from "../util/vec.js";
import { forgetPlayer } from "./audio.js";
import { removeAllEchoes, setRealGate, sweepEchoes, tickEchoes } from "./echo.js";
import { Encounter, survivalLike } from "./encounter.js";
import * as fx from "./fx.js";
import { onStrugglePressed, releaseAll } from "./grab.js";
import { dlog, errorText, setDebug, warn } from "./log.js";
import { lightAt } from "./perception.js";
import { Presence } from "./presence.js";
import { Signs } from "./signs.js";
import { isNightOutside, spawnSearch } from "./spots.js";
import { forgetPrefs, getMemory, getPrefs, getSchedule, getSettings, saveSchedule, setPrefs } from "./store.js";

const SLOTS = ["a", "b", "c"];
const MAX_TAILWAILS = 1; // only one Tailwail may be present in the world at a time
const DIMS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
// things a player can shoot or throw at it: an aggressive move during the stand-off
const PROJECTILES = new Set(["minecraft:arrow", "minecraft:snowball", "minecraft:egg", "minecraft:ender_pearl",
  "minecraft:thrown_trident", "minecraft:splash_potion", "minecraft:lingering_potion", "minecraft:xp_bottle",
  "minecraft:wind_charge_projectile", "minecraft:fireworks_rocket"]);

export class Director {
  constructor() {
    this.encounters = new Map(); // entity id -> Encounter
    this.rng = makeRng();
    this.presence = new Presence(this.rng);
    this.signs = new Signs(this.rng); // 3.2: claw marks, tallies, your things moved, its nest
    this.lastCheck = new Map(); // player id -> tick of last encounter roll
    this.sinceHurt = new Map(); // player id -> tick of last damage by something else
    this.pendingSpawn = new Set();
    this.lastPresence = new Map(); // player id -> last presence id
    this.sleeping = new Map(); // player id -> sleep start tick
    this.creating = false;
    this.lastReason = new Map();
    this.stats = { started: 0, ended: 0, outcomes: {}, presence: {} };
    this.forcedNext = new Map(); // player id -> setup forced by command
    this.returnAt = new Map(); // player id -> tick it comes back (it only pretended to leave)
    this.dummies = new Set(); // showcase entities driven by /tailwail:debug anim, never adopted
    // only one Tailwail body is ever in the world: hallucinations wait while the real one is out
    setRealGate(() => this.encounters.size + this.dummies.size + this.pendingSpawn.size > 0);
  }

  playerById(id) {
    for (const p of world.getAllPlayers()) if (p.id === id) return p;
    return undefined;
  }

  /** A lure slot, or undefined when a Tailwail (or a showcase copy) is already in the world: only one at a time. */
  freeSlot() {
    if (this.encounters.size + this.dummies.size >= MAX_TAILWAILS) return undefined;
    const used = new Set([...this.encounters.values()].map((e) => e.slot));
    return SLOTS.find((s) => !used.has(s));
  }

  /** Ends every live encounter (the creature leaves cleanly) and removes showcase copies. */
  clearTheWorld(outcome = "aborted") {
    for (const e of [...this.encounters.values()]) {
      try {
        e.end(outcome, true);
      } catch {
        this.encounters.delete(e.twId);
      }
    }
    for (const id of [...this.dummies]) {
      try {
        const d = world.getEntity(id);
        if (d && d.isValid) d.remove();
      } catch {
        /* gone */
      }
      this.dummies.delete(id);
    }
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    setDebug(getSettings().debugLog);
    system.runInterval(() => this.tickFast(), TICKS.decision);
    system.runInterval(() => this.tickPlayers(), TICKS.director);
    system.runInterval(() => this.sweep(), TICKS.sweep);
    this.wireEvents();
    system.runTimeout(() => {
      sweepEchoes();
      for (const p of world.getAllPlayers()) fx.clearAll(p, true); // nothing can be left over from a crash
      this.adoptExisting();
    }, 40);
  }

  tickFast() {
    for (const enc of [...this.encounters.values()]) {
      try {
        enc.update();
      } catch (e) {
        warn(`encounter ${enc.id} failed; cleaning up`, errorText(e));
        try {
          enc.end("aborted", true);
        } catch {
          this.encounters.delete(enc.twId);
        }
      }
    }
    try {
      const get = (id) => this.playerById(id);
      fx.tickHeartbeats(get);
      this.presence.tick(get);
      tickEchoes();
    } catch (e) {
      warn("fast tick", errorText(e));
    }
  }

  register(enc) {
    this.encounters.set(enc.twId, enc);
    this.stats.started++;
  }

  unregister(enc, outcome) {
    this.encounters.delete(enc.twId);
    this.stats.ended++;
    this.stats.outcomes[outcome] = (this.stats.outcomes[outcome] || 0) + 1;
  }

  encounterFor(entity) {
    return this.encounters.get(entity.id);
  }

  encounterTargeting(playerId) {
    for (const e of this.encounters.values()) if (e.targetId === playerId) return e;
    return undefined;
  }

  // ------------------------------------------------------------------ per player, once a second
  playerSnapshot(p) {
    const tick = system.currentTick;
    let health = 20;
    try {
      health = p.getComponent("minecraft:health").currentValue;
    } catch {
      /* default */
    }
    const head = p.getHeadLocation();
    let sky = 15;
    try {
      sky = p.dimension.getSkyLightLevel({ x: Math.floor(head.x), y: Math.floor(head.y), z: Math.floor(head.z) });
    } catch {
      /* default */
    }
    let riding = false;
    try {
      riding = !!p.getComponent("minecraft:riding");
    } catch {
      /* default */
    }
    const hurtAt = this.sinceHurt.get(p.id);
    return {
      survivalLike: survivalLike(p, false),
      dimension: p.dimension.id,
      alive: health > 0,
      health,
      sinceHurt: hurtAt === undefined ? 999 : (tick - hurtAt) / 20,
      inWater: p.isInWater,
      riding,
      sleeping: p.isSleeping,
      flying: p.isFlying || p.isGliding,
      underground: sky <= ENCOUNTER.caveSkyLightMax && head.y < 64,
      nightOutside: isNightOutside(p.dimension, p, world.getTimeOfDay()),
      light: lightAt(p.dimension, head),
    };
  }

  tickPlayers() {
    const settings = getSettings();
    const peaceful = world.getDifficulty() === Difficulty.Peaceful;
    if ((peaceful || !settings.enabled) && this.encounters.size) {
      for (const e of [...this.encounters.values()]) e.end("aborted", true);
    }
    for (const p of world.getAllPlayers()) {
      try {
        this.tickPlayer(p, settings, peaceful);
      } catch (e) {
        warn("player tick", errorText(e));
      }
    }
  }

  tickPlayer(p, settings, peaceful) {
    const snap = this.playerSnapshot(p);
    this.bedCheck(p, snap, settings);
    const s = ensureFirst(getSchedule(p), settings, this.rng);
    // the signs it leaves work whether or not you are somewhere it can come for you right now
    if (settings.enabled && !peaceful && snap.survivalLike) {
      try {
        this.signs.tickPlayer(p, s, settings, (flag) => this.unlockPage(p, s, flag));
      } catch (e) {
        warn("signs", errorText(e));
      }
    }
    const el = eligibility(snap, settings, { peaceful });
    const mine = this.encounterTargeting(p.id);
    if (!el.ok) {
      this.lastReason.set(p.id, el.reason);
      saveSchedule(p, s);
      return;
    }
    // waits only count down while something is not already happening to this player
    if (!mine && !this.pendingSpawn.has(p.id)) tickEligible(s, TICKS.director / 20);
    s.stage = computeStage(s);

    if (!mine && !this.pendingSpawn.has(p.id)) {
      const back = this.returnAt.get(p.id);
      if (back !== undefined && system.currentTick >= back) {
        this.returnAt.delete(p.id);
        if (!this.forcedNext.has(p.id) && settings.enabled) this.forcedNext.set(p.id, "the_return");
      }
      const forced = this.forcedNext.get(p.id);
      const tick = system.currentTick;
      const activeNear = [...this.encounters.values()].some((e) => e.tw.isValid && e.dim.id === p.dimension.id && dist(e.tw.location, p.location) < 96);
      const block = forced ? null : encounterBlockers(snap, s, settings, { activeNear, activeCount: this.encounters.size });
      if (!block && (forced || tick - (this.lastCheck.get(p.id) || 0) >= ENCOUNTER.checkPeriod * 20)) {
        this.lastCheck.set(p.id, tick);
        if (forced || rollStart(settings, this.rng)) {
          this.forcedNext.delete(p.id);
          saveSchedule(p, s);
          this.beginSpawn(p, s, settings, forced || null);
          this.lastReason.set(p.id, "spawning");
          return;
        }
        this.lastReason.set(p.id, "roll");
      } else {
        this.lastReason.set(p.id, block || "waiting");
      }
      // presence fills the waiting
      if (s.presWait <= 0 && settings.presence > 0 && !activeNear) this.firePresence(p, s, settings);
    }
    saveSchedule(p, s);
  }

  /** Opens a journal page (saved with the schedule by the caller) and says so a moment later. */
  unlockPage(p, s, flag) {
    const r = unlock(s.jr, flag);
    if (!r.added) return;
    s.jr = r.mask;
    system.runTimeout(() => p.isValid && p.sendMessage(`§8[Torn journal] §7A new page: §f${r.added.title}`), 60);
  }

  /** An encounter ended: after a cave encounter it has a nest somewhere near. */
  afterEncounter(enc, outcome, pos) {
    const settings = getSettings();
    if (!settings.signs || outcome === "aborted") return;
    try {
      const under = pos.y < 64 && enc.dim.getSkyLightLevel({ x: Math.floor(pos.x), y: Math.floor(pos.y) + 1, z: Math.floor(pos.z) }) <= 3;
      if (!under) return;
      this.signs.ensureNest(enc.dim, pos, enc.dim.getPlayers({ location: pos, maxDistance: 96 }));
    } catch (e) {
      dlog("nest", e);
    }
  }

  firePresence(p, s, settings, forcedId) {
    const env = this.presence.env(p);
    const id = forcedId || pickPresence(s.stage, s.eligibleS, s.pres, env, settings, this.rng, this.lastPresence.get(p.id) || null);
    if (!id) {
      s.presWait = 15; // nothing fits here right now: look again soon
      return null;
    }
    const ok = this.presence.run(id, p, env);
    dlog(`presence ${id} for ${p.name}: ${ok ? "done" : "not possible"}`);
    if (ok) {
      this.lastPresence.set(p.id, id);
      onPresence(s, id, settings, this.rng);
      this.stats.presence[id] = (this.stats.presence[id] || 0) + 1;
      const r = unlock(s.jr, id === "snuff" || id === "lights_out" ? "snuff" : "presence");
      if (r.added) {
        s.jr = r.mask;
        system.runTimeout(() => p.isValid && p.sendMessage(`§8[Torn journal] §7A new page: §f${r.added.title}`), 200);
      }
    } else {
      s.pres[id] = s.eligibleS; // cool that one down and try another soon
      s.presWait = 10;
    }
    return ok ? id : null;
  }

  /** The bed visit (stage 2+, jumpscares on): it watches you sleep. */
  bedCheck(p, snap, settings) {
    if (!snap.sleeping) {
      this.sleeping.delete(p.id);
      return;
    }
    if (this.sleeping.has(p.id)) return;
    this.sleeping.set(p.id, system.currentTick);
    const s = getSchedule(p);
    if (!settings.enabled || !settings.jumpscares || s.stage < 2 || !snap.survivalLike) return;
    if (!this.rng.chance(0.35)) return;
    system.runTimeout(() => {
      if (p.isValid && p.isSleeping) this.presence.bedVisit(p);
    }, 50);
  }

  // ------------------------------------------------------------------ spawning
  beginSpawn(player, s, settings, forcedSetup) {
    const slot = this.freeSlot();
    if (!slot) return;
    const mem = getMemory(player);
    const snap = this.playerSnapshot(player);
    const where = snap.underground ? "cave" : "surface";
    let allowed = forcedSetup ? [forcedSetup] : setupsForStage(s.stage, where);
    if (!settings.ambushes) allowed = allowed.filter((id) => !["cling", "huddle"].includes(SETUPS[id].opener) || id === forcedSetup);
    const weights = setupWeights(mem, allowed).map(([id, w]) => [id, w * (SETUPS[id] ? SETUPS[id].weight : 1)]);
    let setup = forcedSetup || this.rng.weighted(weights.filter(([, w]) => w > 0)) || (where === "cave" ? "stalker" : "treeline");
    const def = SETUPS[setup];
    const out = {};
    const dim = player.dimension;
    const players = dim.getPlayers({ location: player.location, maxDistance: 96 });
    this.pendingSpawn.add(player.id);
    const behindOnly = def.opener === "behind";
    const job = spawnSearch({
      dim, player, players, rng: this.rng, band: def.spawnBand, minHead: def.needsHeadroom >= 7 ? 3 : def.needsHeadroom, maxHead: def.maxHeadroom, out, behindOnly,
    });
    system.runJob((function* (self) {
      try {
        yield* job;
      } catch (e) {
        out.result = null;
        out.reason = "error";
        warn("spawn search", errorText(e));
      }
      self.pendingSpawn.delete(player.id);
      if (!player.isValid) return;
      if (!out.result) {
        dlog(`spawn rejected for ${player.name}: ${out.reason} (${setup})`);
        self.lastReason.set(player.id, "spawn:" + out.reason);
        return;
      }
      if (!fitsTerrain(setup, out.result.head) && !forcedSetup) {
        setup = pickSetup(weights, { headroom: out.result.head }, self.rng) || "stalker";
      }
      self.spawnAt(player, out.result, setup, slot, false, false, s.stage);
    })(this));
  }

  spawnAt(player, site, setup, slot, manual, showcase, stage = 0) {
    if (!slot || this.encounters.size + this.dummies.size >= MAX_TAILWAILS) return null;
    const dim = player.dimension;
    removeAllEchoes(); // never a hallucination and the real one at the same time
    this.creating = true;
    let tw;
    try {
      tw = dim.spawnEntity(ENTITY_ID, { x: site.x, y: site.y, z: site.z }, { initialRotation: site.facing || 0 });
    } catch (e) {
      warn("spawnEntity failed", errorText(e));
      return null;
    } finally {
      this.creating = false;
    }
    const def = SETUPS[setup];
    const posture = def.posture === "crawl" ? "crawl" : site.posture || "tall";
    const enc = new Encounter({ director: this, tw, target: player, setup, slot, rng: makeRng((this.rng.next() * 2 ** 32) >>> 0), manual, showcase, posture, stage });
    this.register(enc);
    return enc;
  }

  // ------------------------------------------------------------------ adoption & sweep
  adoptExisting() {
    for (const dimId of DIMS) {
      let dim;
      try {
        dim = world.getDimension(dimId);
      } catch {
        continue;
      }
      for (const e of dim.getEntities({ type: ENTITY_ID })) this.adopt(e, true);
      for (const l of dim.getEntities({ type: LURE_ID })) this.checkLure(l);
    }
  }

  /** A Tailwail without a live controller (reload, spawn egg, /summon). */
  adopt(tw, reloaded) {
    if (!tw.isValid || this.encounters.has(tw.id) || this.dummies.has(tw.id)) return;
    // only one in the world: a new one from an egg or /summon replaces the old one; an extra one
    // found on reload is removed
    if (!reloaded && !this.freeSlot()) this.clearTheWorld("aborted");
    const slot = this.freeSlot();
    if (slot) removeAllEchoes(); // this one stays: no hallucination beside it
    const near = tw.dimension.getPlayers({ location: tw.location, maxDistance: 64 }).filter((p) => survivalLike(p, true));
    near.sort((a, b) => dist(a.location, tw.location) - dist(b.location, tw.location));
    if (!slot) {
      dlog("an extra Tailwail was removed: only one may be in the world");
      tw.remove();
      return;
    }
    if (!near.length) {
      if (reloaded) tw.remove(); // nobody to haunt: tidy up quietly
      else {
        const enc = new Encounter({ director: this, tw, target: null, setup: "stalker", slot, rng: makeRng(), manual: true, orphan: true });
        this.register(enc);
      }
      return;
    }
    if (reloaded) {
      const enc = new Encounter({ director: this, tw, target: near[0], setup: "stalker", slot, rng: makeRng(), manual: true, orphan: true });
      this.register(enc);
      return;
    }
    // spawn egg / summon: a showcase that gets to the good part quickly
    const head = this.headroomAt(tw);
    const setup = head <= 2 ? "tunnel_crawler" : "stalker";
    const stage = getSchedule(near[0]).stage || 0;
    const enc = new Encounter({ director: this, tw, target: near[0], setup, slot, rng: makeRng(), manual: true, showcase: true, posture: head >= 5 ? "tall" : head >= 3 ? "hunch" : "crawl", stage });
    this.register(enc);
  }

  headroomAt(entity) {
    let n = 0;
    try {
      const l = entity.location;
      for (let y = 0; y < 8; y++) {
        const b = entity.dimension.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y) + y, z: Math.floor(l.z) });
        if (!b || !(b.isAir || b.typeId === "minecraft:light_block")) break;
        n++;
      }
    } catch {
      return 3;
    }
    return n;
  }

  checkLure(l) {
    const owner = l.getDynamicProperty("tailwail:owner");
    if (!owner || !this.encounters.has(owner)) {
      try {
        l.remove();
      } catch {
        /* gone */
      }
    }
  }

  sweep() {
    try {
      for (const dimId of DIMS) {
        const dim = world.getDimension(dimId);
        for (const l of dim.getEntities({ type: LURE_ID })) this.checkLure(l);
        for (const e of dim.getEntities({ type: ENTITY_ID })) if (!this.encounters.has(e.id)) this.adopt(e, true);
      }
      for (const id of [...this.dummies]) if (!world.getEntity(id)) this.dummies.delete(id);
      sweepEchoes();
      const ids = new Set(world.getAllPlayers().map((p) => p.id));
      for (const m of [this.lastCheck, this.lastPresence, this.sleeping, this.lastReason, this.returnAt]) for (const k of [...m.keys()]) if (!ids.has(k)) m.delete(k);
    } catch (e) {
      warn("sweep", errorText(e));
    }
  }

  // ------------------------------------------------------------------ events
  /** A player's projectile flying at (or close past) a Tailwail: aim line within 3 blocks of its body. */
  checkShot(e) {
    let owner;
    let p0;
    let v;
    let dimId;
    try {
      if (!e.isValid) return;
      owner = e.getComponent("minecraft:projectile")?.owner;
      p0 = e.location;
      v = e.getVelocity();
      dimId = e.dimension.id;
    } catch {
      return;
    }
    if (!owner || owner.typeId !== "minecraft:player") return;
    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp < 0.05) return;
    for (const enc of this.encounters.values()) {
      try {
        if (!enc.tw || !enc.tw.isValid || enc.tw.dimension.id !== dimId) continue;
        const c = enc.tw.location;
        const rel = { x: c.x - p0.x, y: c.y + 1.2 - p0.y, z: c.z - p0.z };
        const along = (rel.x * v.x + rel.y * v.y + rel.z * v.z) / sp;
        if (along < -1 || along > 64) continue;
        const miss = Math.hypot(rel.x - (v.x / sp) * along, rel.y - (v.y / sp) * along, rel.z - (v.z / sp) * along);
        if (miss <= 3.0) enc.onAggression("shot");
      } catch {
        /* entity gone */
      }
    }
  }

  /** A player's projectile landed next to (or on) a Tailwail. */
  projectileLanded(source, at, dimId, hitEntity) {
    if (!source || source.typeId !== "minecraft:player" || !this.encounters.size) return;
    for (const enc of this.encounters.values()) {
      try {
        if (!enc.tw || !enc.tw.isValid || enc.tw.dimension.id !== dimId) continue;
        const c = enc.tw.location;
        if ((hitEntity && hitEntity.id === enc.twId) || (hdist(c, at) <= 4 && Math.abs(at.y - c.y - 1.5) <= 4)) enc.onAggression("shot");
      } catch {
        /* entity gone */
      }
    }
  }

  noise(player, pos) {
    const enc = this.encounterTargeting(player.id);
    if (enc && dist(enc.tw.location, pos) <= SEARCH.noiseRadius) enc.onNoise(pos);
  }

  wireEvents() {
    // lethal damage becomes a scripted death so the full death clip plays; damage taken is
    // divided by the health multiplier setting.  Before-events are read-only: deferred.
    world.beforeEvents.entityHurt.subscribe((ev) => {
      if (ev.hurtEntity.typeId !== ENTITY_ID) return;
      const enc = this.encounters.get(ev.hurtEntity.id);
      if (!enc) return;
      if (enc.brain.state === "death") {
        ev.cancel = true;
        return;
      }
      ev.damage = ev.damage / Math.max(0.5, enc.settings.healthMultiplier);
      let hp = 1;
      try {
        hp = ev.hurtEntity.getComponent("minecraft:health").currentValue;
      } catch {
        /* default */
      }
      if (ev.damage >= hp - 0.5) {
        ev.cancel = true;
        system.run(() => enc.die());
      }
    });

    world.afterEvents.entityHurt.subscribe((ev) => {
      const hurt = ev.hurtEntity;
      if (hurt.typeId === ENTITY_ID) {
        const enc = this.encounters.get(hurt.id);
        const src = ev.damageSource.damagingEntity;
        if (enc && src && src.typeId === "minecraft:player") enc.onHit(src, ev.damage);
      } else if (hurt instanceof Player) {
        const src = ev.damageSource.damagingEntity;
        if (!src || src.typeId !== ENTITY_ID) {
          this.sinceHurt.set(hurt.id, system.currentTick);
          this.presence.onAction(hurt, "hurt", "");
        }
      }
    });

    world.afterEvents.entityDie.subscribe((ev) => {
      const d = ev.deadEntity;
      if (d.typeId !== "minecraft:player") return;
      try {
        // killed by it, or killed while it hunted you: it carries some of your things to its nest
        const settings = getSettings();
        const by = ev.damageSource && ev.damageSource.damagingEntity;
        const enc = this.encounterTargeting(d.id);
        if (settings.signs && ((by && by.typeId === ENTITY_ID) || (enc && enc.brain.committed))) {
          const at = { ...d.location };
          this.signs.takeDrops(d.dimension, at, d.dimension.getPlayers({ location: at, maxDistance: 96 }));
        }
      } catch (e) {
        dlog("drops", e);
      }
      try {
        const s = onPlayerDeath(getSchedule(d), getSettings());
        saveSchedule(d, s);
        fx.clearAll(d);
      } catch (e) {
        dlog("death bookkeeping", e);
      }
    }, { entityTypes: ["minecraft:player"] });

    world.afterEvents.entitySpawn.subscribe((ev) => {
      const e = ev.entity;
      if (!e.isValid) return;
      if (PROJECTILES.has(e.typeId)) {
        // its velocity is set after the spawn: read the aim line a tick later
        if (this.encounters.size) system.run(() => this.checkShot(e));
        return;
      }
      if (this.creating || e.typeId !== ENTITY_ID) return;
      system.run(() => {
        if (e.isValid && !this.encounters.has(e.id)) this.adopt(e, false);
      });
    });

    world.afterEvents.projectileHitBlock.subscribe((ev) => {
      this.projectileLanded(ev.source, ev.location, ev.dimension.id, null);
    });
    world.afterEvents.projectileHitEntity.subscribe((ev) => {
      let hit = null;
      try {
        hit = ev.getEntityHit().entity || null;
      } catch {
        hit = null;
      }
      this.projectileLanded(ev.source, ev.location, ev.dimension.id, hit);
    });

    world.afterEvents.entityLoad.subscribe((ev) => {
      const e = ev.entity;
      if (!e.isValid) return;
      if (e.typeId === ENTITY_ID && !this.encounters.has(e.id)) system.run(() => this.adopt(e, true));
      else if (e.typeId === LURE_ID) system.run(() => e.isValid && this.checkLure(e));
      else if (e.typeId === ECHO_ID) system.run(() => sweepEchoes());
    });

    world.beforeEvents.playerLeave.subscribe((ev) => {
      const id = ev.player.id;
      system.run(() => {
        forgetPlayer(id);
        forgetPrefs(id);
        fx.forget(id);
        this.presence.forget(id);
        this.sinceHurt.delete(id);
      });
    });

    world.afterEvents.playerSpawn.subscribe((ev) => {
      const p = ev.player;
      system.runTimeout(() => {
        if (!p.isValid) return;
        // joining: unconditional reset (nothing can be left over from a crash or a disconnect
        // mid-grab); respawning: only what this add-on had applied
        fx.clearAll(p, ev.initialSpawn);
        if (!ev.initialSpawn) return;
        this.rpCheck(p);
        const prefs = getPrefs(p);
        if (!prefs.guideGiven) {
          try {
            const inv = p.getComponent("minecraft:inventory").container;
            if (inv.emptySlotsCount > 0) {
              inv.addItem(new ItemStack(GUIDE_ITEM_ID, 1));
              p.sendMessage("§8[Tailwail] §7You found a §ftorn journal§7. Something in the dark has started to rehearse you.");
              setPrefs(p, { ...prefs, guideGiven: true });
            }
          } catch (e) {
            dlog("guide give", e);
          }
        }
      }, 40);
    });

    world.afterEvents.playerButtonInput.subscribe((ev) => {
      if (ev.newButtonState !== ButtonState.Pressed) return;
      if (ev.button === InputButton.Jump) onStrugglePressed(ev.player, "jump");
      else if (ev.button === InputButton.Sneak) onStrugglePressed(ev.player, "sneak");
    });

    // the sounds you make: mimicry (presence) and noise (encounters follow it)
    world.afterEvents.playerBreakBlock.subscribe((ev) => {
      const id = ev.brokenBlockPermutation ? ev.brokenBlockPermutation.type.id : "";
      this.presence.onAction(ev.player, "break", id);
      this.noise(ev.player, ev.block.location);
    });
    world.afterEvents.playerPlaceBlock.subscribe((ev) => {
      this.presence.onAction(ev.player, "place", ev.block.typeId);
      this.noise(ev.player, ev.block.location);
    });
    world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
      if (!ev.isFirstEvent) return;
      const id = ev.block.typeId;
      if (id.endsWith("door") || id.endsWith("trapdoor") || id.includes("fence_gate")) {
        this.presence.onAction(ev.player, "door", id);
        this.noise(ev.player, ev.block.location);
      }
    });
    world.afterEvents.blockContainerOpened.subscribe((ev) => {
      const p = ev.openSource && ev.openSource.entity;
      if (p instanceof Player) {
        this.presence.onAction(p, "chest", ev.block.typeId);
        this.noise(p, ev.block.location);
      }
    });
    world.afterEvents.itemCompleteUse.subscribe((ev) => {
      const id = ev.itemStack.typeId;
      const drink = id.includes("potion") || id.includes("bottle") || id.includes("bucket");
      this.presence.onAction(ev.source, drink ? "drink" : "eat", "");
    });
    world.afterEvents.itemReleaseUse.subscribe((ev) => {
      if (ev.itemStack && (ev.itemStack.typeId === "minecraft:bow" || ev.itemStack.typeId === "minecraft:crossbow")) {
        this.presence.onAction(ev.source, "bow", "");
        this.noise(ev.source, ev.source.location);
      }
    });

    world.afterEvents.playerGameModeChange.subscribe((ev) => {
      if (ev.toGameMode === GameMode.Spectator || ev.toGameMode === GameMode.Creative) {
        dlog(`${ev.player.name} left survival; their encounter will withdraw`);
      }
    });
  }

  /**
   * The resource pack can be stale (an older copy applied to the world) while the behavior
   * pack is new: then nothing animates and the new sounds are silent.  This line is a
   * translation key that only the 3.x resource pack defines; without it the player sees
   * the raw key, which itself says what to do.
   */
  rpCheck(p) {
    try {
      p.sendMessage({ rawtext: [{ text: `§8[Tailwail ${ADDON_VERSION}] ` }, { translate: RP_CHECK_KEY }] });
    } catch (e) {
      dlog("rp check", e);
    }
  }

  /** A passive Tailwail for the animation showcase: no brain, no adoption.  It replaces any live one. */
  spawnShowcaseDummy(p, at) {
    this.clearTheWorld("aborted");
    removeAllEchoes();
    this.creating = true;
    let tw;
    try {
      tw = p.dimension.spawnEntity(ENTITY_ID, at, { initialRotation: yawTo(at, p.location) });
    } finally {
      this.creating = false;
    }
    if (!tw) return undefined;
    this.dummies.add(tw.id);
    tw.setProperty("tailwail:managed", true);
    return tw;
  }

  /** It only pretended to leave: it comes back for this player in a while. */
  scheduleReturn(p) {
    if (!p || !p.isValid || this.returnAt.has(p.id)) return;
    const [lo, hi] = SEARCH.returnDelay;
    this.returnAt.set(p.id, system.currentTick + Math.round(this.rng.range(lo, hi) * 20));
    dlog(`${p.name}: it will come back`);
  }

  // ------------------------------------------------------------------ diagnostics & commands
  status(p) {
    const settings = getSettings();
    const lines = [`§6Tailwail ${this.encounters.size} active (only one at a time), preset ${settings.preset}`];
    for (const e of this.encounters.values()) lines.push("§7" + e.describe());
    if (p) {
      this.rpCheck(p);
      const s = getSchedule(p);
      lines.push(`§7you: stage ${s.stage}, next encounter in ${Math.max(0, s.wait).toFixed(0)}s, next presence in ${Math.max(0, s.presWait).toFixed(0)}s (eligible time only)`);
      lines.push(`§7last check: ${this.lastReason.get(p.id) || "-"}, last outcome: ${s.lastOutcome || "-"}, encounters ${s.encN}, escapes ${s.escN}, presence ${s.presN}`);
      lines.push(`§7presence state: ${this.presence.describe(p.id)}`);
    }
    lines.push(`§7started ${this.stats.started} ended ${this.stats.ended} ${JSON.stringify(this.stats.outcomes)} presence ${JSON.stringify(this.stats.presence)}`);
    return lines.join("\n");
  }

  forceEncounter(p, setup) {
    if (setup && !SETUPS[setup]) return `unknown setup; one of ${Object.keys(SETUPS).join(", ")}`;
    if (this.encounterTargeting(p.id)) return "already in an encounter";
    if (!this.freeSlot()) this.clearTheWorld("aborted"); // only one in the world: the forced one replaces it
    this.forcedNext.set(p.id, setup || this.rng.pick(setupsForStage(getSchedule(p).stage)));
    return `spawn search for ${this.forcedNext.get(p.id)} starts within a second (needs a dark spot 7-40 blocks away)`;
  }

  forcePresence(p, id) {
    if (!PRESENCE_EVENTS[id]) return `unknown event; one of ${Object.keys(PRESENCE_EVENTS).join(", ")}`;
    const s = getSchedule(p);
    const done = this.firePresence(p, s, getSettings(), id);
    saveSchedule(p, s);
    return done ? `presence ${id} ran` : `presence ${id} was not possible here`;
  }

  endAll(reason) {
    for (const e of [...this.encounters.values()]) {
      e.brain.finish(reason);
      e.end(reason, true);
    }
    releaseAll();
  }
}
