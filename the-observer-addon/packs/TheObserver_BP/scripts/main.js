// @ts-check
// The Observer — entry point.
import { world, system, MolangVariableMap } from "@minecraft/server";
import { W, loadWorld, saveWorld, savePlayers, savePlayer, ps, now, dropPlayer, markPlayerDirty, markWorldDirty } from "./core/state.js";
import { S } from "./core/settings.js";
import { DEBUG, safe, trace, dimIndex, V, allPlayers } from "./core/util.js";
import { PARTICLES, TARGET_TAG, ITEMS } from "./core/constants.js";
import * as ledger from "./world/ledger.js";
import * as body from "./observer/body.js";
import * as memory from "./observer/memory.js";
import * as director from "./director/director.js";
import * as items from "./progression/items.js";
import * as dev from "./dev/commands.js";
import * as illusions from "./observer/illusions.js";
import { vigilStatus } from "./ui/forms.js";
import { openWheel, canConfigure } from "./ui/wheel.js";
import { give, discover } from "./progression/discoveries.js";
import * as flare from "./progression/flare.js";
import * as learn from "./observer/learn.js";
import * as hush from "./observer/hush.js";
import * as pages from "./observer/pages.js";
import * as returns from "./observer/returns.js";
import * as mire from "./mire/mire.js";
import { pending as mirePending } from "./encounters/mire_watcher.js";

// encounter library (each file registers itself)
import "./encounters/distant_watch.js";
import "./encounters/extra_step.js";
import "./encounters/home_visit.js";
import "./encounters/closed_path.js";
import "./encounters/borrowed_sound.js";
import "./encounters/turned_object.js";
import "./encounters/door_ajar.js";
import "./encounters/snuffed_lights.js";
import "./encounters/mirror_bearing.js";
import "./encounters/echo_ahead.js";
import "./encounters/unfamiliar_route.js";
import "./encounters/close_breath.js";
import "./encounters/pursuit.js";
import "./encounters/window_watch.js";
import "./encounters/second_witness.js";
import "./encounters/night_visit.js";
import "./encounters/portal_follow.js";
import "./encounters/vigil.js";
import "./encounters/showcase.js";
import "./encounters/creeping.js";
import "./encounters/inside.js";
import "./encounters/sign.js";
import "./encounters/borrowed_eyes.js";
import "./encounters/mire_watcher.js";
import "./encounters/tests.js";

let ready = false;

system.beforeEvents.startup.subscribe((ev) => {
  dev.registerCommands(ev.customCommandRegistry);
});

function init() {
  if (ready) return;
  ready = true;
  const existed = loadWorld();
  DEBUG.on = !!S().dev;
  DEBUG.trace = !!S().dev;
  const n = ledger.load();
  director.recoverInterrupted();
  body.sweepStrays(director.activeEncId());
  trace(`ready: world state ${existed ? "loaded" : "new"}, ${n} ledger entries, ${director.REGISTRY.length} encounter types`);
}

// ------------------------------------------------------------------ events

ledger.registerEvents();
illusions.registerEvents();
memory.registerEvents();
returns.registerEvents();
// the Weeping Mire, its home: wind, falling leaves and the torn pages. The Mire's old watcher is the
// Observer now: a torn page may bring it up behind you, and the last of the eight always does.
mire.register({
  watcher(p, o) {
    const go = () => {
      mirePending.set(p.id, o);
      if (director.tryManual("mire_watcher", p, { anyway: o.why === "all_pages" })) return true;
      mirePending.delete(p.id);
      return false;
    };
    if (go() || o.why !== "all_pages") return;
    // the last page always brings it: if it is busy, as soon as it is free (for up to a minute)
    let tries = 0;
    const h = system.runInterval(() => {
      if (!p.isValid || go() || ++tries >= 30) system.clearRun(h);
    }, 40);
  },
});
// it writes down what it has learned
learn.onAdapt((p, method) => {
  pages.learned(p, method);
  system.runTimeout(() => safe(() => p.isValid && p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.learned" }] })), 60);
});
dev.register();
body.registerEvents(() => director.activeEncId());

// blocks placed by involved players are routed to their running encounters (e.g. bringing a light)
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  for (const enc of director.running()) {
    if (enc.pid !== ev.player.id && !(enc.p.isValid && enc.witnesses(48).some((w) => w.id === ev.player.id))) continue;
    enc.inputs.push({ kind: "place", typeId: ev.block.typeId, loc: ev.block.location, player: ev.player });
  }
});

// ledger releases are routed to the encounter that made the change
ledger.onRelease((e, how, player) => {
  const enc = director.running().find((x) => x.id === e.enc);
  if (enc) enc.released.push({ kind: e.kind, how, player, loc: { x: e.x, y: e.y, z: e.z } });
});

items.registerEvents({
  openWheel,
  startVigil: (p) => {
    const def = director.byId("vigil");
    // the form may have stayed open for a while: check everything again
    if (!def || !S().enabled || !vigilStatus(p).ok) return;
    const own = director.encounterFor(p.id);
    if (own && own.def.id === "vigil") return;
    const act = director.activeEncounter();
    if (act && act.pid !== p.id) {
      safe(() => p.sendMessage({ rawtext: [{ translate: "observer.msg.vigil_busy" }] }));
      return;
    }
    director.start(def, p, undefined, true);
  },
  onLensed: (encId) => {
    const enc = director.running().find((x) => x.id === encId);
    if (!enc) return;
    enc.data.lastRepel = "lens";
    if (learn.shrug(enc, "lens")) return; // it has learned the lens: this time it only flinches
    enc.data.lensed = true;
  },
  onBodyHit: (p, encId) => {
    const enc = director.running().find((x) => x.id === encId);
    if (!enc) return;
    enc.data.lastRepel = "hit";
    if (learn.shrug(enc, "hit")) return; // it has learned to take a blow: the first one does nothing
    if (enc.def.id === "closed_path" || enc.def.id === "pursuit") enc.data.hit = true;
    else {
      body.setState("recoil");
      enc.result(enc.outcome || "struck_away", true);
      enc.abort("struck");
    }
  },
});

// the Flare: its glare drives it off (or, once it has learned flares, makes it flinch back)
flare.registerEvents({
  onFlared: (encId, at, owner) => {
    const b = body.get();
    if (!b) return;
    const enc = director.running().find((x) => x.id === encId);
    if (!enc) {
      body.despawn("flare");
      return;
    }
    if (learn.shrug(enc, "flare")) {
      body.setState("recoil");
      const from = owner?.isValid ? owner.location : at;
      const g = body.groundNear(enc.dim, V.add(b.e.location, V.scale(V.flat(V.sub(b.e.location, from)), 5)));
      if (g) body.moveTo(g, enc.p.isValid ? enc.p.getHeadLocation() : undefined);
      system.runTimeout(() => {
        if (body.get() === b && b.state === "recoil") body.setState("stare");
      }, 16);
      return;
    }
    b.repelled = true;
    body.setMode("still");
    body.setState("recoil");
    enc.data.reacting = true;
    if (owner?.isValid) discover(owner, "light_it_doesnt_make");
    enc.result("flared", true);
    enc.abort("flared");
  },
});

world.afterEvents.worldLoad.subscribe(() => init());

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ready) init();
  const p = ev.player;
  ps(p);
  if (!ev.initialSpawn) return;
  memory.motion(p);
  // first join: say that the add-on is running, and hand operators the Config Wheel
  const s = ps(p);
  if (!s.welcomed) {
    s.welcomed = true;
    markPlayerDirty(p);
    system.runTimeout(() => {
      if (!p.isValid) return;
      safe(() => p.sendMessage({ rawtext: [{ translate: "observer.msg.welcome", with: [String(S().graceMinutes)] }] }));
      if (canConfigure(p)) {
        give(p, ITEMS.wheel, 1);
        safe(() => p.sendMessage({ rawtext: [{ translate: "observer.msg.welcome_wheel" }] }));
      } else safe(() => p.sendMessage({ rawtext: [{ translate: "observer.msg.welcome_other" }] }));
    }, 60);
  }
  // someone who left (or crashed) mid-encounter keeps fog layers and tags on their player: clear ours
  if (!director.running().some((e) => e.pid === p.id)) {
    safe(() => p.removeTag(TARGET_TAG));
    for (const d of director.REGISTRY) safe(() => p.runCommand(`fog @s remove observer_${d.id}`));
  }
});

world.beforeEvents.playerLeave.subscribe((ev) => {
  const id = ev.player.id;
  // save while the player object is still valid (dynamic properties may be written here)
  try {
    savePlayer(ev.player);
  } catch (e) {
    DEBUG.log(`leave save failed: ${e}`);
  }
  system.run(() => {
    director.abortFor(id, "target_left");
    memory.forget(id);
    hush.forget(id);
    returns.forget(id);
    mire.forget(id);
    dropPlayer(id);
  });
});

world.afterEvents.entityDie.subscribe((ev) => {
  if (ev.deadEntity.typeId === "minecraft:player") director.onDeath(/** @type {any} */ (ev.deadEntity));
});

world.afterEvents.playerDimensionChange.subscribe((ev) => {
  const p = ev.player;
  director.abortFor(p.id, "dimension");
  const s = ps(p);
  if (s.stage >= 2 && !s.witnessed) {
    s.followAt = now() + 60 + Math.random() * 90;
    s.followFrom = [dimIndex(ev.toDimension.id), Math.floor(ev.toLocation.x), Math.floor(ev.toLocation.y), Math.floor(ev.toLocation.z)];
    markPlayerDirty(p);
  }
});

system.beforeEvents.shutdown.subscribe(() => {
  // each save on its own: one failing must not skip the others (periodic saves cover any failure)
  for (const fn of [() => saveWorld(true), () => savePlayers(true), () => ledger.save(true)]) {
    try {
      fn();
    } catch (e) {
      DEBUG.log(`shutdown save failed: ${e}`);
    }
  }
});

// ------------------------------------------------------------------ loops

// Loops count their own runs: `system.currentTick % n` inside an interval only works if the
// interval happens to start on a multiple of n, which depends on load timing.
let fastRuns = 0;
system.runInterval(() => {
  if (!ready) return;
  fastRuns++;
  body.maintain(fastRuns);
  if (fastRuns % 2 === 0) safe(() => ledger.scan(new Set(director.running().map((e) => e.id))));
  safe(() => director.nearCheck());
}, 5);

let slowRuns = 0;
system.runInterval(() => {
  if (!ready) return;
  slowRuns++;
  const tick = system.currentTick;
  for (const p of allPlayers()) {
    safe(() => memory.sample(p));
    // manual triggers: dimension follow-ups and sleeping
    const s = ps(p);
    if (s.followAt && now() >= s.followAt) {
      s.followAt = 0;
      if (p.dimension.id !== "minecraft:overworld" || Math.random() < 0.5) director.tryManual("portal_follow", p);
    }
    const m = memory.motion(p);
    if (m.sleeping && m.sleptAt > 0 && tick - m.sleptAt > 40) {
      m.sleptAt = -1;
      director.tryManual("night_visit", p);
    }
  }
  safe(() => director.tick());
  safe(() => illusions.tick());
  if (slowRuns % 5 === 0) safe(() => returns.tick());
  if (slowRuns % 20 === 0) safe(() => pages.tick(new Set(director.running().map((e) => e.pid))));
  safe(() => ledger.processDue(12));
  if (slowRuns % 2 === 0) {
    safe(() => items.renderMarks());
    safe(() => tickTraces());
  }
}, 20);

system.runInterval(() => {
  if (!ready) return;
  safe(() => saveWorld());
  safe(() => savePlayers());
  safe(() => ledger.save());
}, 100);

system.runInterval(() => {
  if (!ready) return;
  for (const p of allPlayers()) {
    safe(() => memory.decay(p));
    safe(() => learn.decay(p));
  }
  safe(() => body.sweepStrays(director.activeEncId()));
  safe(() => items.validateWards());
}, 1200);

system.runInterval(() => {
  if (ready) safe(() => body.tickPuppets());
}, 10);

// taiga illusions vanish the instant they are looked at; flares fly, burn and glare
system.runInterval(() => {
  if (!ready) return;
  safe(() => illusions.watch());
  safe(() => flare.tick());
}, 2);

/**
 * Evidence: footprint trails it left are shown to players who come back to the place
 * (each trail lasts 25 minutes; shown to a player at most every 45 s).
 */
function tickTraces() {
  const t = now();
  const before = W.traces.length;
  W.traces = W.traces.filter((tr) => t - tr.t < 25 * 60);
  if (W.traces.length !== before) markWorldDirty();
  for (const p of allPlayers()) {
    const d = dimIndex(p.dimension.id);
    for (const tr of W.traces) {
      if (tr.d !== d) continue;
      if (t - (tr.seen[p.id] ?? -999) < 45) continue;
      const near = tr.pts.some((pt) => Math.hypot(pt[0] - p.location.x, pt[2] - p.location.z) < 10 && Math.abs(pt[1] - p.location.y) < 6);
      if (!near) continue;
      tr.seen[p.id] = t;
      for (let i = 0; i < tr.pts.length; i++) {
        const a = tr.pts[i], b = tr.pts[Math.min(i + 1, tr.pts.length - 1)];
        const yaw = V.yawTo({ x: a[0], y: 0, z: a[2] }, { x: b[0], y: 0, z: b[2] });
        safe(() => p.spawnParticle(PARTICLES.footprint, { x: a[0], y: a[1] + 0.03, z: a[2] }, footprintVars(yaw)));
      }
    }
  }
}

function footprintVars(yaw) {
  const v = new MolangVariableMap();
  v.setFloat("variable.yaw", yaw);
  return v;
}

system.run(() => {
  // scripts reloaded (/reload) after the world already loaded
  if (!ready && allPlayers().length > 0) init();
});
