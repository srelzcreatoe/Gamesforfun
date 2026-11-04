// Shot list for the MP4 preview and the stills used on the preview sheet.
// Three.js space: the creature faces -Z; +X is the creature's right side.
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const L = (a, b, k) => a + (b - a) * k;
const ease = k => { k = clamp(k); return k * k * (3 - 2 * k); };
const V = (a, b, k) => a.map((v, i) => L(v, b[i], k));

function dolly(p0, p1, t0, t1, fov0, fov1, dur) {
  return (t) => { const k = ease(t / dur); return { pos: V(p0, p1, k), target: V(t0, t1, k), fov: L(fov0, fov1, k) }; };
}
function track(off, toff, fov, drift = [0, 0, 0], dur = 1) {
  return (t, mp) => {
    const k = t / dur;
    return { pos: [mp.x + off[0] + drift[0] * k, off[1] + drift[1] * k, mp.z + off[2] + drift[2] * k], target: [mp.x + toff[0], toff[1], mp.z + toff[2]], fov };
  };
}
function splash(t, x, y, z, n = 70, power = 1, size = 1.15) {
  return { t0: t, t1: t + 0.08, rate: n / 0.08, at: () => [x, y, z], spread: [6 * power, 0, 6 * power], radial: 26 * power, up: 95 * power,
           vel: [0, 40 * power, 0], vspread: [9, 20, 9], life: 0.6, size, color: [0.30, 0.40, 0.45], gravity: -460, floor: y - 0.5 };
}
function streaming(t0, t1, at, rate = 60) {
  return { t0, t1, rate, at, spread: [10, 30, 6], vel: [0, -10, 0], vspread: [4, 6, 4], life: 0.9, size: 1.0, color: [0.25, 0.33, 0.37], gravity: -380, floor: -0.5 };
}

const LABEL_SUB = {
  watch: 'animation.brinesleeper.watch · loop 6.0s',
  idle_water: 'animation.brinesleeper.idle_water · loop 4.0s',
  walk: 'animation.brinesleeper.walk · loop 2.4s',
  crouch_stalk: 'animation.brinesleeper.crouch_stalk · loop 3.2s',
  run: 'animation.brinesleeper.run · loop 0.72s',
  lunge: 'animation.brinesleeper.lunge · 1.3s',
  grasp: 'animation.brinesleeper.grasp · 2.2s',
  emerge: 'animation.brinesleeper.emerge · 2.8s',
  submerge: 'animation.brinesleeper.submerge · 2.6s',
  swim: 'animation.brinesleeper.swim · loop 1.8s',
};

// run-cycle landings (phase of each limb's touchdown) for splash timing
const RUN_T = 0.72, RUN_SPEED = 62 / 0.72;
function runSplashes(z0, dur) {
  const out = [];
  const limbs = [[0.06, 12.5, -24], [0.16, -12.5, -22], [0.62, 5.5, 2], [0.71, -5.5, 4]];
  for (let k = -1; k * RUN_T < dur; k++) {
    for (const [ph, x, zr] of limbs) {
      const t = (k + ph) * RUN_T;
      if (t < 0 || t > dur) continue;
      out.push(splash(t, x, 3.6, z0 - RUN_SPEED * t + zr, 34, 1.0, 2.2));
    }
  }
  out.push({ t0: 0, t1: dur, rate: 90, at: (t) => [0, 3.6, z0 - RUN_SPEED * t + 8], spread: [16, 0, 10], vel: [0, 40, 30], vspread: [30, 30, 20],
             life: 0.45, size: 0.9, color: [0.22, 0.30, 0.34], gravity: -400, floor: 3.0 });
  return out;
}

export const SHOTS = [
  {
    name: 'intro', dur: 5.5, env: 'shore', anim: 'watch', at: [0, 0, 0],
    camera: dolly([-30, 30, -300], [-6, 44, -150], [30, 33, -10], [34, 44, -16], 30, 26, 5.5),
    title: { in: 0.7, out: 4.6, lines: ['Aquatic Cave Dweller  ·  3.5 blocks tall', 'Vanilla-style Minecraft Bedrock entity model'] },
    exposure: 1.2, lights: { key: 1.5 },
  },
  {
    name: 'turntable', dur: 8.0, env: 'studio', anim: 'watch', at: [0, 0, 4], spin: t => (t / 8) * Math.PI * 2,
    camera: () => ({ pos: [0, 38, -235], target: [0, 28, 0], fov: 24 }),
    label: 'Turnaround', sub: '53 bones · 65 cubes · 128×64 box-UV texture', fade: 0.3,
    lights: { key: 1.7, rim: 1.5, hemi: 0.9, keyDir: [-140, 200, -220] }, exposure: 1.15, vignette: 0.6,
  },
  {
    name: 'watch', dur: 6.0, env: 'shore', anim: 'watch', at: [0, 0, 0],
    camera: dolly([44, 17, -175], [24, 23, -142], [0, 35, -12], [0, 37, -14], 27, 26, 6.0),
    label: 'Watching (Shoreline)', sub: LABEL_SUB.watch, exposure: 1.6,
  },
  {
    name: 'idle_water', dur: 6.0, env: 'pool', waterLevel: 0, anim: 'idle_water', at: [0, -33, -40],
    camera: dolly([-30, 9, -205], [-10, 8, -168], [0, 9, -48], [0, 10, -48], 30, 29, 6.0),
    ripples: () => [[0, -46, -0.6, 0.5], [0, -46, 1.4, 0.5], [0, -46, 3.4, 0.5], [20, -52, 0.6, 0.35], [-19, -45, 2.3, 0.35], [20, -52, 4.1, 0.35], [0, -46, 5.3, 0.5], [-19, -45, 4.9, 0.3]],
    label: 'Idle (In Water)', sub: LABEL_SUB.idle_water, exposure: 1.5, lights: { under: 0.6 },
  },
  {
    name: 'walk', dur: 5.5, env: 'shore', anim: 'walk', at: [0, 0, 34],
    camera: track([165, 30, -26], [0, 27, -10], 28, [0, 0, -10], 5.5),
    label: 'Walk', sub: LABEL_SUB.walk, exposure: 1.6, lights: { keyDir: [220, 210, -120], rim: 1.3 },
  },
  {
    name: 'stalk', dur: 6.0, env: 'shore', anim: 'crouch_stalk', at: [0, 0, 12],
    camera: track([-120, 14, -150], [0, 14, -16], 30, [50, 4, 10], 6.0),
    label: 'Crouch / Stalk', sub: LABEL_SUB.crouch_stalk, exposure: 1.5,
  },
  {
    name: 'run', dur: 4.5, env: 'shallows', anim: 'run', at: [0, 0, 160],
    camera: track([-92, 26, -120], [0, 14, -16], 34, [0, 0, 20], 4.5),
    particles: () => runSplashes(160, 4.5),
    label: 'Run (Hunt State)', sub: LABEL_SUB.run, exposure: 1.5, lights: { torch: 300 },
  },
  {
    name: 'lunge', dur: 4.3, env: 'shore', at: [0, 0, 0],
    timeline: [{ anim: 'watch', start: 0, dur: 0.9, offset: 4.4 }, { anim: 'lunge', start: 0.9, dur: 1.3 }, { anim: 'watch', start: 2.2, dur: 0.6, offset: 0.2 }, { anim: 'lunge', start: 2.8, dur: 1.5 }],
    camera: (t) => {
      const shake = (a) => Math.exp(-Math.max(0, t - a) * 9) * (t > a ? 1 : 0);
      const s = shake(1.33) + shake(3.23);
      return { pos: [-92 + Math.sin(t * 61) * 1.6 * s, 32 + Math.sin(t * 53) * 1.4 * s, -118], target: [0, 30, -22], fov: 38 };
    },
    label: 'Lunge Attack', sub: LABEL_SUB.lunge, exposure: 1.5, lights: { key: 1.8 },
  },
  {
    name: 'grasp', dur: 3.7, env: 'pool', waterLevel: 0, at: [0, -33, -40],
    timeline: [{ anim: 'idle_water', start: 0, dur: 0.5 }, { anim: 'grasp', start: 0.5, dur: 2.2 }, { anim: 'idle_water', start: 2.7, dur: 1.0 }],
    camera: (t) => ({ pos: [4, 12 - 4 * ease((t - 1.1) / 0.6), -140], target: [0, 13 - 5 * ease((t - 1.1) / 0.6), -46], fov: 40 }),
    particles: () => [splash(0.95, 0, 0.1, -78, 50, 0.9), splash(1.55, 8, 0.1, -66, 70, 1.25), splash(1.6, -8, 0.1, -66, 50, 1.1)],
    ripples: () => [[0, -46, -0.5, 0.45], [0, -78, 0.95, 0.9], [6, -66, 1.55, 1.2], [-6, -66, 1.6, 1.0], [0, -46, 2.6, 0.5]],
    label: 'Drowning Grasp', sub: LABEL_SUB.grasp, exposure: 1.55, lights: { under: 0.6 },
  },
  {
    name: 'emerge', dur: 4.2, env: 'pool', waterLevel: 0, at: [0, -4, -40],
    timeline: [{ anim: 'emerge', start: 0, dur: 2.8 }, { anim: 'watch', start: 2.8, dur: 1.4 }],
    camera: dolly([-24, 6, -232], [-10, 12, -196], [0, 24, -48], [0, 30, -46], 32, 30, 4.2),
    particles: () => [splash(0.55, 0, 0.1, -46, 60, 1.0), splash(0.95, 14, 0.1, -50, 40, 0.9), splash(1.05, -14, 0.1, -50, 40, 0.9),
                      splash(1.45, 0, 0.1, -60, 70, 1.2), streaming(0.9, 2.6, (t) => [0, Math.min(52, 10 + (t - 0.9) * 40), -48]),
                      streaming(1.5, 2.8, (t) => [0, 20, -62], 40)],
    ripples: () => [[0, -46, 0.5, 0.9], [14, -50, 0.95, 0.6], [-14, -50, 1.05, 0.6], [0, -60, 1.45, 1.0], [0, -46, 2.1, 0.6], [0, -46, 3.0, 0.4]],
    label: 'Emerging', sub: LABEL_SUB.emerge, exposure: 1.5, lights: { under: 0.55 },
  },
  {
    name: 'submerge', dur: 3.8, env: 'pool', waterLevel: 0, at: [0, -4, -40],
    timeline: [{ anim: 'watch', start: 0, dur: 0.35, offset: 5.2 }, { anim: 'submerge', start: 0.35, dur: 3.45 }],
    camera: (t) => { const k = ease((t - 0.6) / 2.6); return { pos: [0, L(16, 6, k), -165], target: [0, L(34, 4, k), -46], fov: 32 }; },
    particles: () => [{ t0: 1.3, t1: 3.8, rate: 26, at: () => [0, 0.3, -46], spread: [14, 0, 10], vel: [0, 10, 0], vspread: [6, 8, 6], life: 0.5, size: 1.4, color: [0.7, 0.82, 0.88], gravity: -60, floor: 0 }],
    ripples: () => [[0, -46, 0.9, 0.45], [0, -46, 1.5, 0.55], [0, -46, 2.1, 0.7], [0, -46, 2.7, 0.85], [0, -46, 3.15, 0.6], [6, -40, 2.5, 0.4]],
    label: 'Retreat (Submerge)', sub: LABEL_SUB.submerge, exposure: 1.55, lights: { under: 0.6 },
  },
  {
    name: 'swim', dur: 6.0, env: 'underwater', anim: 'swim', at: [0, -40, 110],
    camera: track([-150, 34, -110], [0, -8, -24], 34, [40, 0, 30], 6.0),
    particles: () => [{ t0: 0, t1: 6, rate: 18, at: (t) => [0, -2, 110 - 34 * t - 44], spread: [3, 2, 3], vel: [0, 0, 0], vspread: [4, 2, 4], life: 3.0, size: 1.6, color: [0.75, 0.92, 0.96], gravity: 30, wobble: 1.5 }],
    label: 'Swim (Underwater)', sub: LABEL_SUB.swim, exposure: 1.6, tint: [0.92, 1.02, 1.04], lights: { key: 1.1, rim: 1.4, hemi: 0.9 },
  },
  {
    name: 'outro', dur: 4.5, env: 'shore', anim: 'watch', at: [0, 0, 0], animOffset: 1.6,
    camera: dolly([-14, 47, -128], [-10, 48, -104], [32, 45, -18], [30, 46, -18], 24, 22, 4.5),
    title: { in: 0.6, out: 9, lines: ['Bedrock .geo.json + .animation.json + texture', 'Blockbench .bbmodel  ·  10 animations'] },
    exposure: 1.2, fade: 0.6,
  },
];

// ---------------------------------------------------------------- stills for the preview sheet
const studio = (yaw, pitch = 3, dist = 640, fov = 6.4, ty = 28, tz = -6) => () => {
  const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
  return { pos: [-Math.sin(y) * Math.cos(p) * dist, ty + Math.sin(p) * dist, tz - Math.cos(y) * Math.cos(p) * dist], target: [0, ty, tz], fov };
};
const S_LIGHT = { key: 2.4, rim: 1.6, hemi: 1.6, fill: 1.2, keyDir: [-140, 200, -220] };
export const STILLS = {
  turn_front: { env: 'studio', at: [0, 0, 0], camera: studio(0), lights: { ...S_LIGHT, keyDir: [-120, 200, -260] }, exposure: 2.16, vignette: 0.3 },
  turn_side: { env: 'studio', at: [0, 0, 0], camera: studio(-90), lights: { ...S_LIGHT, keyDir: [260, 200, -120] }, exposure: 2.16, vignette: 0.3 },
  turn_back: { env: 'studio', at: [0, 0, 0], camera: studio(180), lights: { ...S_LIGHT, keyDir: [120, 200, 260] }, exposure: 2.16, vignette: 0.3 },
  turn_34: { env: 'studio', at: [0, 0, 0], camera: studio(-42, 5), lights: { ...S_LIGHT, keyDir: [140, 200, -220] }, exposure: 2.16, vignette: 0.3 },
  pose_idle_water: { env: 'pool', waterLevel: 0, anim: 'idle_water', t: 1.0, at: [0, -33, -40], camera: () => ({ pos: [-26, 12, -170], target: [0, 10, -48], fov: 34 }), exposure: 2.16, lights: { under: 0.7 },
                     ripples: () => [[0, -46, -0.6, 0.5], [20, -52, 0.4, 0.35], [-19, -45, 0.1, 0.35]] },
  pose_watch: { env: 'shore', anim: 'watch', t: 2.7, at: [0, 0, 0], camera: () => ({ pos: [20, 30, -150], target: [0, 40, -14], fov: 30 }), exposure: 1.82 },
  pose_stalk: { env: 'shore', anim: 'crouch_stalk', t: 0.6, at: [0, 0, 0], speed: 0, camera: () => ({ pos: [-80, 14, -150], target: [0, 16, -18], fov: 30 }), exposure: 1.89 },
  pose_run: { env: 'shallows', anim: 'run', t: 0.3, at: [0, 0, 0], speed: 0, camera: () => ({ pos: [-80, 18, -125], target: [0, 16, -18], fov: 32 }),
              particles: () => [splash(0.12, -12.5, 3.6, -22, 50, 1.1), splash(0.2, 12.5, 3.6, -24, 50, 1.1), splash(0.18, 0, 3.6, 4, 50, 1.0)], exposure: 2.16, lights: { torch: 320 } },
  pose_lunge: { env: 'shore', anim: 'lunge', t: 0.56, at: [0, 0, 0], camera: () => ({ pos: [-40, 30, -130], target: [0, 30, -26], fov: 34 }), exposure: 2.16, lights: { key: 1.9 } },
  pose_emerge: { env: 'pool', waterLevel: 0, anim: 'emerge', t: 1.05, at: [0, -4, -40], camera: () => ({ pos: [-16, 10, -170], target: [0, 26, -46], fov: 34 }),
                 particles: () => [splash(0.55, 0, 0.1, -46, 70, 1.0), splash(0.95, 14, 0.1, -50, 50, 0.9), splash(0.98, -14, 0.1, -50, 50, 0.9)],
                 ripples: () => [[0, -46, 0.5, 0.9], [14, -50, 0.95, 0.6], [-14, -50, 0.98, 0.6]], exposure: 2.16, lights: { under: 0.6 } },
  pose_submerge: { env: 'pool', waterLevel: 0, anim: 'submerge', t: 1.9, at: [0, -4, -40], camera: () => ({ pos: [0, 10, -118], target: [0, 8, -46], fov: 28 }),
                   ripples: () => [[0, -46, 1.2, 0.5], [0, -46, 1.7, 0.6], [0, -46, 2.05, 0.8]], exposure: 2.16, lights: { under: 0.7 } },
  hero: { env: 'pool', waterLevel: 0, anim: 'emerge', t: 1.9, at: [0, -4, -40], camera: () => ({ pos: [-48, 16, -142], target: [0, 20, -52], fov: 36 }),
          particles: () => [streaming(1.0, 1.9, (t) => [0, 30, -50], 70)], ripples: () => [[0, -60, 1.45, 1.0], [0, -46, 1.7, 0.6]], exposure: 2.16, lights: { under: 0.7, key: 1.9 } },
  reflection: { env: 'pool', waterLevel: 0, anim: 'submerge', t: 2.05, at: [0, -4, -40], camera: () => ({ pos: [0, 6, -120], target: [0, 5, -46], fov: 24 }),
                ripples: () => [[0, -46, 1.2, 0.5], [0, -46, 1.6, 0.6], [0, -46, 1.95, 0.7]], exposure: 2.16, lights: { under: 0.7 } },
  face: { env: 'shore', anim: 'watch', t: 0.2, at: [0, 0, 0], camera: () => ({ pos: [-6, 45, -82], target: [0, 46, -18], fov: 26 }), exposure: 1.76 },
  swim_still: { env: 'underwater', anim: 'swim', t: 0.35, at: [0, -40, 0], speed: 0, camera: () => ({ pos: [-120, -6, -120], target: [0, -14, -30], fov: 36 }), exposure: 2.03, tint: [0.92, 1.02, 1.04] },
  torch_still: { env: 'shore', anim: 'crouch_stalk', t: 1.4, at: [0, 0, 60], speed: 0, camera: () => ({ pos: [40, 26, -70], target: [-20, 20, 60], fov: 40 }), exposure: 2.03, lights: { torch: 420, key: 0.9 } },
};
