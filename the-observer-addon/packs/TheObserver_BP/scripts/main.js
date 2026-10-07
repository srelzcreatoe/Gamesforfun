// @ts-check
// The Observer — entry point.
import { world, system, MolangVariableMap } from "@minecraft/server";
import { W, loadWorld, saveWorld, savePlayers, ps, now, dropPlayer, markPlayerDirty, markWorldDirty } from "./core/state.js";
import { S } from "./core/settings.js";
import { DEBUG, safe, trace, dimIndex, V, allPlayers } from "./core/util.js";
import { PARTICLES } from "./core/constants.js";
import * as ledger from "./world/ledger.js";
import * as body from "./observer/body.js";
import * as memory from "./observer/memory.js";
import * as director from "./director/director.js";
import * as items from "./progression/items.js";
import * as dev from "./dev/commands.js";

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
memory.registerEvents();
dev.register();
body.registerEvents(() => director.activeEncId());

// blocks placed by involved players are routed to their running encounters (e.g. bringing a light)
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  for (const enc of director.running()) {
    if (enc.pid !== ev.player.id && !enc.witnesses(48).some((w) => w.id === ev.player.id)) continue;
    enc.inputs.push({ kind: "place", typeId: ev.block.typeId, loc: ev.block.location, player: ev.player });
  }
});

// ledger releases are routed to the encounter that made the change
ledger.onRelease((e, how, player) => {
  const enc = director.running().find((x) => x.id === e.enc);
  if (enc) enc.released.push({ kind: e.kind, how, player, loc: { x: e.x, y: e.y, z: e.z } });
});

items.registerEvents({
  startVigil: (p) => {
    const def = director.byId("vigil");
    if (def) director.start(def, p, undefined, true);
  },
  onLensed: (encId) => {
    const enc = director.running().find((x) => x.id === encId);
    if (enc) enc.data.lensed = true;
  },
  onBodyHit: () => {
    const enc = director.activeEncounter();
    if (!enc) return;
    if (enc.def.id === "closed_path" || enc.def.id === "pursuit") enc.data.hit = true;
    else {
      body.setState("recoil");
      enc.result(enc.outcome || "struck_away", true);
      enc.abort("struck");
    }
  },
});

world.afterEvents.worldLoad.subscribe(() => init());

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ready) init();
  const p = ev.player;
  ps(p);
  if (ev.initialSpawn) memory.motion(p);
});

world.beforeEvents.playerLeave.subscribe((ev) => {
  const id = ev.player.id;
  system.run(() => {
    director.abortFor(id, "target_left");
    memory.forget(id);
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
  try {
    saveWorld(true);
    savePlayers(true);
    ledger.save(true);
  } catch (e) {
    // shutdown may run in a restricted context; periodic saves cover this case
  }
});

// ------------------------------------------------------------------ loops

system.runInterval(() => {
  if (!ready) return;
  body.maintain(system.currentTick);
  if (system.currentTick % 10 === 0) safe(() => ledger.scan(new Set(director.running().map((e) => e.id))));
}, 5);

system.runInterval(() => {
  if (!ready) return;
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
  safe(() => ledger.processDue(12));
  if (tick % 40 === 0) {
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
  for (const p of allPlayers()) safe(() => memory.decay(p));
  safe(() => body.sweepStrays(director.activeEncId()));
  safe(() => items.validateWards());
}, 1200);

system.runInterval(() => {
  if (ready) safe(() => body.tickPuppets());
}, 10);

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
