// Global coordinator: one decision loop for every encounter, round-robin scheduling,
// spawning, event wiring and orphan cleanup.  No per-animation timers are created.
import { Difficulty, EntityDamageCause, GameMode, ItemStack, Player, system, world } from "@minecraft/server";
import { ENCOUNTER, ENTITY_ID, GUIDE_ITEM_ID, LURE_ID, TICKS } from "../config.js";
import { setupWeights } from "../core/memory.js";
import { eligibility, ensureGrace, onPlayerDeath, pickGroupTarget, rollStart } from "../core/scheduler.js";
import { SETUPS, SETUP_IDS, pickSetup } from "../core/setups.js";
import { makeRng } from "../util/rng.js";
import { dist, hdist } from "../util/vec.js";
import { forgetPlayer } from "./audio.js";
import { Encounter, survivalLike } from "./encounter.js";
import { dlog, errorText, setDebug, warn } from "./log.js";
import { lightAt } from "./perception.js";
import { isNightWoodland, spawnSearch } from "./spots.js";
import { getMemory, getPrefs, getSchedule, getSettings, saveSchedule, setPrefs } from "./store.js";
import { headroom } from "./terrain.js";

const SLOTS = ["a", "b", "c"];

export class Director {
  constructor() {
    this.encounters = new Map(); // entity id -> Encounter
    this.rng = makeRng();
    this.rr = 0; // round-robin index for scheduling checks
    this.nextCheck = new Map(); // player id -> tick
    this.sinceHurt = new Map(); // player id -> tick of last damage
    this.pendingSpawn = new Set(); // player ids with a spawn search running
    this.creating = false;
    this.lastOutcome = new Map();
    this.lastReason = new Map();
    this.stats = { started: 0, ended: 0, outcomes: {}, rays: 0 };
  }

  now() {
    try {
      return world.getAbsoluteTime();
    } catch {
      return system.currentTick;
    }
  }

  playerById(id) {
    for (const p of world.getAllPlayers()) if (p.id === id) return p;
    return undefined;
  }

  freeSlot() {
    const used = new Set([...this.encounters.values()].map((e) => e.slot));
    return SLOTS.find((s) => !used.has(s));
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    setDebug(getSettings().debugLog);
    system.runInterval(() => this.tickEncounters(), TICKS.decision);
    system.runInterval(() => this.tickSchedule(), TICKS.director);
    system.runInterval(() => this.sweep(), TICKS.sweep);
    this.wireEvents();
    system.runTimeout(() => this.adoptExisting(), 40);
  }

  tickEncounters() {
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
  }

  register(enc) {
    this.encounters.set(enc.twId, enc);
    this.stats.started++;
  }

  unregister(enc, outcome) {
    this.encounters.delete(enc.twId);
    this.stats.ended++;
    this.stats.outcomes[outcome] = (this.stats.outcomes[outcome] || 0) + 1;
    if (enc.targetId) this.lastOutcome.set(enc.targetId, `${enc.setup}:${outcome}`);
  }

  // ------------------------------------------------------------------ scheduling
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
      underground: sky <= ENCOUNTER.caveSkyLightMax && head.y < 62,
      nightWoodland: isNightWoodland(p.dimension, p, world.getTimeOfDay()),
      light: lightAt(p.dimension, head),
    };
  }

  tickSchedule() {
    const settings = getSettings();
    const peaceful = world.getDifficulty() === Difficulty.Peaceful;
    if (peaceful && this.encounters.size) {
      for (const e of [...this.encounters.values()]) e.end("aborted", true);
      return;
    }
    const players = world.getAllPlayers();
    if (!players.length) return;
    const p = players[this.rr++ % players.length];
    const tick = system.currentTick;
    if ((this.nextCheck.get(p.id) || 0) > tick || this.pendingSpawn.has(p.id)) return;
    this.nextCheck.set(p.id, tick + ENCOUNTER.checkPeriod * 20);
    try {
      this.consider(p, settings, peaceful);
    } catch (e) {
      warn("schedule check failed", errorText(e));
    }
  }

  consider(p, settings, peaceful, forcedSetup) {
    const now = this.now();
    const s = ensureGrace(getSchedule(p), now, settings);
    saveSchedule(p, s);
    const snap = this.playerSnapshot(p);
    const activeNear = [...this.encounters.values()].some((e) => e.tw.isValid && e.dim.id === p.dimension.id && dist(e.tw.location, p.location) < 96);
    const el = forcedSetup
      ? { ok: true, reason: "forced" }
      : eligibility(snap, s, now, settings, { peaceful, activeNear, activeCount: this.encounters.size });
    this.lastReason.set(p.id, el.reason);
    if (!el.ok) return el;
    if (!forcedSetup && !rollStart(settings, this.rng)) return { ok: false, reason: "roll" };
    // a group shares one encounter: target the most exposed member
    const group = world.getAllPlayers().filter((o) => o.dimension.id === p.dimension.id && dist(o.location, p.location) <= ENCOUNTER.groupRadius && survivalLike(o, false));
    const target = group.length > 1 ? pickGroupTarget(group.map((o) => ({ player: o, light: lightAt(o.dimension, o.getHeadLocation()), lastEncAt: getSchedule(o).lastEnd }))).player : p;
    this.beginSpawn(target, settings, forcedSetup);
    return { ok: true, reason: "spawning" };
  }

  beginSpawn(player, settings, forcedSetup) {
    const slot = this.freeSlot();
    if (!slot) return;
    const mem = getMemory(player);
    // choose the setup first, then search for terrain that suits it
    const weights = setupWeights(mem, SETUP_IDS);
    let setup = forcedSetup || this.rng.weighted(weights.filter(([, w]) => w > 0));
    if (!setup) setup = "delayed_imitation";
    const def = SETUPS[setup];
    const out = {};
    const dim = player.dimension;
    const players = dim.getPlayers({ location: player.location, maxDistance: 96 });
    this.pendingSpawn.add(player.id);
    const job = spawnSearch({ dim, player, players, rng: this.rng, band: def.spawnBand, minHead: def.needsHeadroom === 7 ? 3 : def.needsHeadroom, maxHead: def.maxHeadroom, out });
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
      // full_height_reveal needs a cavern somewhere near; fall back if the site is cramped
      let chosen = setup;
      if (def.needsHeadroom > out.result.head && !forcedSetup) {
        chosen = pickSetup(weights, { headroom: out.result.head }, self.rng) || "delayed_imitation";
      }
      self.spawnAt(player, out.result, chosen, slot, false);
    })(this));
  }

  spawnAt(player, site, setup, slot, manual) {
    if (!slot || this.encounters.size >= getSettings().maxConcurrent && !manual) return null;
    const dim = player.dimension;
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
    const posture = SETUPS[setup].posture === "crawl" ? "crawl" : site.posture || "tall";
    const enc = new Encounter({ director: this, tw, target: player, setup, slot, rng: makeRng((this.rng.next() * 2 ** 32) >>> 0), manual, posture });
    this.register(enc);
    return enc;
  }

  // ------------------------------------------------------------------ adoption & sweep
  adoptExisting() {
    for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
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

  /** A Tailwail without a live controller (reload, egg, /summon). */
  adopt(tw, reloaded) {
    if (!tw.isValid || this.encounters.has(tw.id)) return;
    const slot = this.freeSlot();
    const settings = getSettings();
    const near = tw.dimension.getPlayers({ location: tw.location, maxDistance: 48 }).filter((p) => survivalLike(p, true));
    near.sort((a, b) => dist(a.location, tw.location) - dist(b.location, tw.location));
    if (!slot || (!reloaded && this.encounters.size >= Math.max(settings.maxConcurrent, 3))) {
      for (const p of near.slice(0, 1)) p.sendMessage("§7[Tailwail] Encounter cap reached; the summoned Tailwail was removed.");
      tw.remove();
      return;
    }
    if (!near.length) {
      if (reloaded) tw.remove(); // nobody to haunt: tidy up quietly (no player can see this)
      else {
        const enc = new Encounter({ director: this, tw, target: null, setup: "voluntary_withdrawal", slot, rng: makeRng(), manual: true, orphan: true });
        this.register(enc);
      }
      return;
    }
    const setup = reloaded ? "voluntary_withdrawal" : "delayed_imitation";
    const enc = new Encounter({ director: this, tw, target: near[0], setup, slot, rng: makeRng(), manual: !reloaded, orphan: reloaded });
    this.register(enc);
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
      for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
        const dim = world.getDimension(dimId);
        for (const l of dim.getEntities({ type: LURE_ID })) this.checkLure(l);
        for (const e of dim.getEntities({ type: ENTITY_ID })) if (!this.encounters.has(e.id)) this.adopt(e, true);
      }
      // forget stale per-player bookkeeping
      const ids = new Set(world.getAllPlayers().map((p) => p.id));
      for (const k of [...this.nextCheck.keys()]) if (!ids.has(k)) this.nextCheck.delete(k);
    } catch (e) {
      warn("sweep", errorText(e));
    }
  }

  encounterFor(entity) {
    return this.encounters.get(entity.id);
  }

  // ------------------------------------------------------------------ events
  wireEvents() {
    // lethal damage becomes a scripted death so the full death clip plays; damage taken
    // is divided by the health multiplier setting.  Before-events are read-only, so the
    // world change is deferred with system.run.
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
        if (enc && src && src.typeId === "minecraft:player") enc.onHit(src);
      } else if (hurt instanceof Player) {
        const src = ev.damageSource.damagingEntity;
        if (!src || src.typeId !== ENTITY_ID) this.sinceHurt.set(hurt.id, system.currentTick);
      }
    });

    world.afterEvents.entityDie.subscribe((ev) => {
      const d = ev.deadEntity;
      if (d.typeId === "minecraft:player") {
        const s = onPlayerDeath(getSchedule(d), this.now(), getSettings());
        saveSchedule(d, s);
      }
    }, { entityTypes: ["minecraft:player"] });

    world.afterEvents.entitySpawn.subscribe((ev) => {
      const e = ev.entity;
      if (this.creating || !e.isValid || e.typeId !== ENTITY_ID) return;
      system.run(() => {
        if (e.isValid && !this.encounters.has(e.id)) this.adopt(e, false);
      });
    });

    world.afterEvents.entityLoad.subscribe((ev) => {
      const e = ev.entity;
      if (!e.isValid) return;
      if (e.typeId === ENTITY_ID && !this.encounters.has(e.id)) system.run(() => this.adopt(e, true));
      else if (e.typeId === LURE_ID) system.run(() => e.isValid && this.checkLure(e));
    });

    world.beforeEvents.playerLeave.subscribe((ev) => {
      const id = ev.player.id;
      system.run(() => {
        forgetPlayer(id);
        this.sinceHurt.delete(id);
        // its encounter notices the target is gone on the next tick and withdraws
      });
    });

    world.afterEvents.playerSpawn.subscribe((ev) => {
      const p = ev.player;
      if (!ev.initialSpawn) return;
      system.runTimeout(() => {
        if (!p.isValid) return;
        const s = ensureGrace(getSchedule(p), this.now(), getSettings());
        saveSchedule(p, s);
        const prefs = getPrefs(p);
        if (!prefs.guideGiven) {
          try {
            const inv = p.getComponent("minecraft:inventory").container;
            if (inv.emptySlotsCount > 0) {
              this.giveGuide(p);
              prefs.guideGiven = true;
              setPrefs(p, prefs);
            }
          } catch (e) {
            dlog("guide give", e);
          }
        }
      }, 60);
    });

    world.afterEvents.playerGameModeChange.subscribe((ev) => {
      if (ev.toGameMode === GameMode.Spectator || ev.toGameMode === GameMode.Creative) {
        dlog(`${ev.player.name} left survival; their encounter will withdraw`);
      }
    });
  }

  giveGuide(p) {
    p.getComponent("minecraft:inventory").container.addItem(new ItemStack(GUIDE_ITEM_ID, 1));
    p.sendMessage("§8[Tailwail] §7Something in the caves has started rehearsing. Read the §fField Guide§7 (or type §f/tailwail:guide§7).");
  }

  // ------------------------------------------------------------------ diagnostics
  status(p) {
    const lines = [`§6Tailwail ${this.encounters.size} active / cap ${getSettings().maxConcurrent}`];
    for (const e of this.encounters.values()) lines.push("§7" + e.describe());
    const s = getSchedule(p);
    const wait = Math.max(0, (s.nextAt - this.now()) / 20);
    lines.push(`§7you: next eligible in ${wait.toFixed(0)}s, last check: ${this.lastReason.get(p.id) || "-"}, last: ${this.lastOutcome.get(p.id) || "-"}`);
    lines.push(`§7started ${this.stats.started} ended ${this.stats.ended} ${JSON.stringify(this.stats.outcomes)}`);
    return lines.join("\n");
  }

  forceEncounter(p, setup) {
    if (setup && !SETUPS[setup]) return `unknown setup; one of ${SETUP_IDS.join(", ")}`;
    if (!this.freeSlot()) return "no free slot";
    this.beginSpawn(p, getSettings(), setup || this.rng.pick(SETUP_IDS));
    return "spawn search started";
  }

  endAll(reason) {
    for (const e of [...this.encounters.values()]) {
      e.brain.finish(reason);
      e.end(reason, true);
    }
  }

  hdist(a, b) {
    return hdist(a, b);
  }

  headroomAt(p) {
    return headroom(p.dimension, p.location);
  }
}

export { EntityDamageCause };
