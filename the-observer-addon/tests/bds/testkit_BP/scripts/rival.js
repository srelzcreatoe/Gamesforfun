// A stand-in for another add-on's creature and its own scripts (1.4.0 tests): "otest:rival_dweller" is driven here,
// in the test kit's own script context — separate from the Observer's, as another add-on's would be — the way such
// add-ons drive theirs: it is teleported away and back, to the player, into another dimension; made invisible; its
// effects cleared; deleted; killed; and it hurts players in its own name or in no one's. The Observer is meant to
// hold on to it through all of that without knowing anything about it.
//   /scriptevent otest:rival <behaviour> [ticks]    off | tp_away | tp_player | tp_every_tick | tp_nether | invis |
//                                                  clear_fx | delete | kill | hurt_named | hurt_anon | hurt_self
import { world, system } from "@minecraft/server";

const TYPE = "otest:rival_dweller";
let mode = "off";
let every = 40;
let since = 0;
/** tp_every_tick: where the creature was each time its scripts came round (where it was left at the end of a tick) */
const seen = [];

const ow = () => world.getDimension("overworld");
const all = () => {
  const out = [];
  for (const d of ["overworld", "nether"]) {
    try {
      out.push(...world.getDimension(d).getEntities({ type: TYPE }));
    } catch {}
  }
  return out;
};
const nearestPlayer = (e) => {
  let best, bd = Infinity;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== e.dimension.id) continue;
    const d = Math.hypot(p.location.x - e.location.x, p.location.z - e.location.z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best ? { p: best, d: bd } : undefined;
};
const log = (m) => console.warn(`[RIVAL] ${m}`);

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "otest:rival") return;
  const [m, n] = ev.message.trim().split(/\s+/);
  mode = m || "off";
  every = Number(n) || 40;
  since = system.currentTick;
  log(`mode ${mode} every ${every}`);
  // one-off behaviours act at once
  for (const e of all()) {
    try {
      if (mode === "delete") e.remove();
      else if (mode === "kill") e.kill();
      else if (mode === "tp_nether") e.teleport({ x: 8.5, y: 70, z: 8.5 }, { dimension: world.getDimension("nether") });
      else if (mode === "hurt_self") e.applyDamage(30);
    } catch (err) {
      log(`one-off ${mode} failed: ${err}`);
    }
  }
  if (["delete", "kill", "tp_nether", "hurt_self"].includes(mode)) mode = "off";
});

system.runInterval(() => {
  if (mode === "off") return;
  const t = system.currentTick - since;
  for (const e of all()) {
    try {
      const np = nearestPlayer(e);
      switch (mode) {
        case "tp_away":
          if (t % every === 0) {
            const a = Math.random() * Math.PI * 2;
            e.teleport({ x: e.location.x + Math.cos(a) * 25, y: e.location.y + 1, z: e.location.z + Math.sin(a) * 25 });
          }
          break;
        case "tp_every_tick":
          // where it is as its own scripts come round again: where everyone saw it at the end of the last tick
          seen.push({ ...e.location });
          e.teleport({ x: e.location.x + 8, y: e.location.y, z: e.location.z });
          break;
        case "tp_player":
          if (np && t % every === 0) {
            const r = np.p.getViewDirection();
            e.teleport({ x: np.p.location.x + r.x * 1.4, y: np.p.location.y, z: np.p.location.z + r.z * 1.4 }, { facingLocation: np.p.location });
          }
          break;
        case "invis":
          if (t % every === 0) e.addEffect("invisibility", 200, { showParticles: false });
          break;
        case "clear_fx":
          if (t % 2 === 0) for (const fx of e.getEffects()) e.removeEffect(fx.typeId);
          break;
        case "hurt_named":
          if (np && np.d < 5 && t % every === 0) np.p.applyDamage(6, { cause: "entityAttack", damagingEntity: e });
          break;
        case "hurt_anon":
          if (np && np.d < 5 && t % every === 0) np.p.applyDamage(6);
          break;
      }
    } catch (err) {
      if (t % 100 === 0) log(`${mode} failed: ${err}`);
    }
  }
}, 1);

export const rivalMode = () => mode;
/** Where it was found each tick of the tug of war (and forget it). */
export function trail() {
  return seen.splice(0, seen.length);
}
