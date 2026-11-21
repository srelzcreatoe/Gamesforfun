// Scripted property timelines for the model views (front / side / back / eye detail of each form).
// Unlike the encounter replays these are NOT produced by the behaviour script: they only set the
// synchronised properties the client animation reads, so each model can be seen walking, swimming,
// looking, pulsing and charging from fixed angles.      node tools/preview/model_replays.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`basiliskra:${k}`, v]));
const BASE = { bound: true, phase: 0, charge: 0, look_yaw: 0, look_pitch: 0, bend: 0, pitch: 0, gait: 2, gill: true, fx_kind: 0, fx_seq: 0, tier: 1, vis_lo: 0, vis_hi: 8 };

function build(name, terrain, form, seconds, at, script, initialEdits = []) {
  const frames = [];
  let pos = [...at], last = {}, state = { ...BASE, form }, speed = 0, tod = 6000, rain = false;
  for (let t = 1; t <= seconds * 20; t++) {
    const s = t / 20;
    const u = script(s, t) || {};
    if (u.speed !== undefined) speed = u.speed;
    if (u.tod !== undefined) tod = u.tod;
    if (u.rain !== undefined) rain = u.rain;
    for (const [k, v] of Object.entries(u)) if (k in BASE) state[k] = v;
    pos = [pos[0], pos[1], pos[2] + speed];           // yaw 0: he faces +z
    const ch = {};
    for (const [k, v] of Object.entries(P(state))) if (last[k] !== v) { ch[k] = v; last[k] = v; }
    const f = { t, pos: [...pos], yaw: 0, tod, rain, players: [{ name: 'scale', pos: form === 1 ? [at[0] - 4.5, at[1] + 0.5, pos[2] + 4] : [at[0] + 7, at[1], pos[2] + (form === 3 ? 8 : 3)] }], boats: [] };
    if (Object.keys(ch).length) f.props = ch;
    frames.push(f);
  }
  const out = path.join(ROOT, 'build/replays');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ name, terrain, ticks: frames.length, initialEdits, frames, particles: [], sounds: [], blocks: [] }));
  console.log(`${name}: ${seconds} s`);
}

const ramp = (s, a, b, lo, hi) => Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, (s - a) / (b - a))));

// Form I: swims, looks, knocks three times at the gills, then the spasm runs down his back.
build('model_i', 'tank', 1, 23, [0, 52, 0], (s) => {
  if (s < 10.6) return { phase: 1, speed: 0.2, bend: Math.round(6 * Math.sin(s * 0.9)) };
  if (s < 14.2) return { phase: 0, speed: 0.02, bend: 0, look_yaw: s > 12 ? 40 : 0 };
  if (s < 17.6) return { phase: 4, speed: 0, look_yaw: 0, fx_kind: 1, fx_seq: s < 15.1 ? 1 : s < 16 ? 2 : 3 };
  if (s < 20.4) return { phase: 9, speed: 0.02 };
  return { phase: 0, speed: 0.06 };
});

// Form II: the dragging gait (reach, pull, rest; one side then the other), then the first discharge.
const G = [12, 18, 22];
build('model_ii', 'shore', 2, 23, [0, 64, 0], (s, t) => {
  if (s < 12.2) {
    const cyc = (t - 1) % ((G[0] + G[1] + G[2]) * 2), half = cyc >= G[0] + G[1] + G[2], k = half ? cyc - (G[0] + G[1] + G[2]) : cyc;
    const step = k < G[0] ? 0 : k < G[0] + G[1] ? 1 : 2;
    return { phase: 1, gait: (half ? 3 : 0) + step, speed: step === 1 ? 0.095 : 0 };
  }
  if (s < 16) return { phase: 0, gait: 2, speed: 0, tod: 12900, look_yaw: s > 14 ? -35 : 0, look_pitch: s > 14 ? 8 : 0 };
  if (s < 19.2) return { phase: 15, tod: 14500, look_yaw: 0, look_pitch: 0, fx_kind: 2, fx_seq: s < 16.7 ? 1 : s < 17.4 ? 2 : 3 };
  return { phase: 0 };
});

// Form III: walks (four footfalls), looks round, stands against a rainy sky, then charges, fires and vents.
build('model_iii', 'flat', 3, 27, [0, 64, 0], (s) => {
  if (s < 10) return { phase: 1, speed: 0.14, gait: (Math.floor((s * 20 * 0.14 - 0.14) / 1.75) + 3) % 4 };      // the foot that landed last, as the script reports it
  if (s < 11) return { phase: 0, speed: 0 };
  if (s < 15) return { tod: 14500, look_yaw: s > 12.5 ? 50 : 0, look_pitch: s > 12.5 ? 14 : 0 };
  if (s < 17.6) return { tod: 12300, rain: true, look_yaw: 0, look_pitch: 0 };
  if (s < 22.2) return { tod: 15000, rain: false, phase: 18, charge: ramp(s, 17.6, 21.9, 0, 18) };
  if (s < 23.6) return { phase: 19, charge: 20 };
  if (s < 26.4) return { phase: 20, charge: ramp(s, 23.6, 26.2, 18, 0) };
  return { phase: 0, charge: 0 };
});
