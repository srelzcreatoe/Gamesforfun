// Shot list for the MP4 preview and the stills used on the preview sheets.
// Three.js space: the creature faces -Z; +X is the creature's right side.
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const L = (a, b, k) => a + (b - a) * k;
const ease = k => { k = clamp(k); return k * k * (3 - 2 * k); };
const V = (a, b, k) => a.map((v, i) => L(v, b[i], k));

function dolly(p0, p1, t0, t1, fov0, fov1, dur) {
  return (t) => { const k = ease(t / dur); return { pos: V(p0, p1, k), target: V(t0, t1, k), fov: L(fov0, fov1, k) }; };
}
function fixed(pos, target, fov, drift = [0, 0, 0], dur = 4) {
  return (t) => { const k = ease(t / dur); return { pos: V(pos, [pos[0] + drift[0], pos[1] + drift[1], pos[2] + drift[2]], k), target, fov }; };
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
const sub = (n, len, loop) => `animation.brinesleeper.${n} · ${loop ? 'loop ' : ''}${len}s`;

// limb touchdowns for a lateral-sequence gait -> little splashes in shallow water
function gaitSplashes(z0, speed, T, dur, limbs, y = 3.6, n = 18) {
  const out = [];
  for (let k = -1; k * T < dur; k++) for (const [ph, x, zr] of limbs) {
    const t = (k + ph) * T;
    if (t >= 0 && t <= dur) out.push(splash(t, x, y, z0 - speed * t + zr, n, 0.6, 1.0));
  }
  return out;
}

// ---------------------------------------------------------------- set pieces
const PILLAR_L = [{ type: 'blocks', tex: 'deepslate', box: [-14, 0, -26, 2, 5, 1] }];
const PILLAR_R = [{ type: 'blocks', tex: 'deepslate', box: [-22, 0, -23, 2, 5, 1] }];
const CEILING = [{ type: 'blocks', tex: 'deepslate', box: [-64, 64, -72, 8, 1, 8] }];
const LEDGE = [{ type: 'blocks', tex: 'stone', box: [-48, 0, -36, 6, 2, 1] }];
const VINES = [{ type: 'vines', xs: [-46, -33, -21, -9, 2, 13, 26, 39, 51], top: 104, z: -36, len: 92 }];

// ---------------------------------------------------------------- the 20 poses (shared by the video and the poses sheet)
export const POSES = [
  { id: 'submerged_watch', label: '1. Submerged Watch', desc: 'Only its head visible above the water, silently observing.', len: 6.0, loop: true,
    env: 'pool', waterLevel: 0, at: [0, -33, -40], camera: fixed([0, 6, -150], [0, 9, -46], 26, [6, 1, 12]), still: 2.6,
    ripples: () => [[0, -45, -0.4, 0.5], [0, -45, 1.0, 0.45], [0, -45, 2.4, 0.5], [0, -45, 3.8, 0.45], [0, -45, 5.2, 0.5]], exposure: 1.55, lights: { under: 0.7 } },
  { id: 'shoreline_stalk', label: '2. Shoreline Stalk', desc: 'Slowly crawling out of the water, but not attacking.', len: 4.0, loop: true,
    env: 'shallows', at: [0, 0, 40], camera: track([-62, 14, -112], [0, 16, -18], 32), still: 0.4,
    particles: (m) => gaitSplashes(40, m.shoreline_stalk.speed, 4.0, 4.2, [[0.25, 17, -27], [0.75, -17, -27], [0.55, 5.8, 8], [0.05, -5.8, 8]]), exposure: 1.55 },
  { id: 'corner_watch', label: '3. Corner Watch', desc: 'Peeking from around cave corners, waiting for you to pass.', len: 6.0, loop: true,
    env: 'shore', at: [0, 0, 0], props: PILLAR_L, camera: fixed([-66, 42, -156], [-15, 37, -18], 30, [-6, 0, 8]), still: 2.4, exposure: 1.55 },
  { id: 'ceiling_lurk', label: '4. Ceiling Lurk', desc: 'Clinging beneath a low ceiling, its head hanging down unnaturally.', len: 6.0, loop: true,
    env: 'shore', at: [0, 0, 0], props: CEILING, camera: fixed([-44, 10, -150], [0, 40, -10], 34, [10, 2, 8]), still: 1.3, exposure: 1.6 },
  { id: 'distant_observer', label: '5. Distant Observer', desc: 'Standing or crouched across a cave lake, watching from afar.', len: 6.0, loop: true,
    env: 'shore', at: [0, 0, 0], camera: fixed([-22, 16, -320], [0, 16, -12], 15, [6, 0, 16]), still: 2.0, exposure: 1.55 },
  { id: 'veil_stalk', label: '6. Veil Stalk', desc: 'Hidden within vines or vegetation, blending with the environment.', len: 5.0, loop: true,
    env: 'shore', at: [0, 0, 0], props: VINES, camera: fixed([12, 20, -150], [0, 20, -12], 30, [-8, 0, 8]), still: 1.2, exposure: 1.55 },
  { id: 'reflection_lurk', label: '7. Reflection Lurk', desc: 'Staring at its own reflection, or imitating yours.', len: 6.0, loop: true,
    env: 'shore', at: [0, 0, -26], camera: fixed([-112, 5, -92], [0, 5, -48], 30, [6, 0, 6]), still: 1.6, exposure: 1.6,
    ripples: () => [[0, -52, 0.6, 0.25], [0, -52, 2.4, 0.3], [0, -52, 4.4, 0.25]] },
  { id: 'tunnel_crawl', label: '8. Tunnel Crawl', desc: 'Crawling through tight spaces and narrow waterways.', len: 2.8, loop: true,
    env: 'shallows', at: [0, 0, 40], camera: track([-70, 9, -76], [0, 7, -18], 32), still: 0.5,
    particles: (m) => gaitSplashes(40, m.tunnel_crawl.speed, 2.8, 3.2, [[0.3, 19, -21], [0.8, -19, -21], [0.45, 10.8, 9], [0.95, -10.8, 9]]), exposure: 1.55 },
  { id: 'patient_strike', label: '9. Patient Strike', desc: 'Motionless with one hand outstretched in the water, waiting for movement.', len: 6.0, loop: true,
    env: 'shore', at: [0, 0, -18], camera: fixed([42, 7, -152], [0, 9, -42], 30, [-6, 0, 10]), still: 2.0, exposure: 1.6,
    ripples: () => [[7, -49, 0.2, 0.35], [7, -49, 1.2, 0.25], [7, -49, 3.1, 0.4], [7, -49, 4.1, 0.3]] },
  { id: 'shadow_hide', label: '10. Shadow Hide', desc: 'A faint silhouette blending into the darkness, nearly indistinguishable.', len: 6.0, loop: true,
    env: 'shore', at: [0, 0, 20], camera: fixed([16, 30, -230], [0, 30, 10], 24, [0, 0, 12]), still: 3.0, exposure: 1.0, lights: { key: 0.35, rim: 2.0, hemi: 0.4, fill: 0.15 } },
  { id: 'full_stand', label: '11. Full Stand', desc: 'Its true height revealed, standing upright and still.', len: 6.0, loop: true,
    env: 'shore', at: [0, 0, 0], camera: fixed([0, 12, -168], [0, 34, 0], 30, [8, 2, 10]), still: 3.0, exposure: 1.55 },
  { id: 'head_tilt', label: '12. Head Tilt', desc: 'Slowly tilting its head as if studying you.', len: 5.0, loop: true,
    env: 'shore', at: [0, 0, 0], camera: fixed([0, 44, -118], [0, 45, -10], 26, [4, 0, 8]), still: 1.8, exposure: 1.5 },
  { id: 'slow_approach', label: '13. Slow Approach', desc: 'Walking on two legs with a deliberate, unnatural gait.', len: 3.2, loop: true,
    env: 'shore', at: [0, 0, 70], camera: fixed([20, 32, -170], [0, 32, 10], 28), still: 0.9, exposure: 1.55 },
  { id: 'emerge_roar', label: '14. Emerge Roar', desc: 'Rising to its full height with a silent open maw, a threat display.', len: 3.4, loop: false,
    env: 'pool', waterLevel: 0, at: [0, -6, -40], camera: fixed([-18, 8, -188], [0, 32, -44], 30, [4, 2, 14], 3.4), still: 1.7,
    particles: () => [splash(0.8, 0, 0.1, -46, 60, 0.9), streaming(0.8, 2.6, (t) => [0, 18 + (t - 0.8) * 14, -46], 50)],
    ripples: () => [[0, -46, 0.8, 0.8], [0, -46, 1.6, 0.5]], exposure: 1.6, lights: { under: 0.7 } },
  { id: 'water_rise', label: '15. Water Rise', desc: 'Standing from the water, fully emerged, water pouring from its body.', len: 3.2, loop: false,
    env: 'pool', waterLevel: 0, at: [0, -8, -40], camera: fixed([22, 10, -190], [0, 28, -46], 30, [-4, 2, 12], 3.2), still: 2.6,
    particles: () => [streaming(0.3, 3.2, (t) => [0, Math.min(46, 6 + (t - 0.3) * 18), -46], 90), streaming(1.2, 3.2, () => [-14, 26, -46], 30), streaming(1.2, 3.2, () => [14, 26, -46], 30)],
    ripples: () => [[0, -46, 0.4, 0.7], [0, -46, 1.1, 0.6], [0, -46, 1.9, 0.5], [0, -46, 2.7, 0.4]], exposure: 1.6, lights: { under: 0.7 } },
  { id: 'hunting_stance', label: '16. Hunting Stance', desc: 'A forward-leaning stance before breaking into a chase.', len: 3.0, loop: true,
    env: 'shore', at: [0, 0, 0], camera: fixed([-74, 16, -140], [0, 22, -14], 30, [8, 0, 10], 3.0), still: 0.8, exposure: 1.6 },
  { id: 'behind_cover', label: '17. Behind Cover', desc: 'Standing behind a pillar or tree, only part of its body visible.', len: 6.0, loop: true,
    env: 'shore', at: [0, 0, 0], props: PILLAR_R, camera: fixed([92, 44, -160], [16, 42, -16], 30, [6, 0, 10]), still: 2.5, exposure: 1.55 },
  { id: 'ledge_watch', label: '18. Ledge Watch', desc: 'Standing on a higher ledge, looking down at you.', len: 6.0, loop: true,
    env: 'shore', at: [0, 0, 0], props: LEDGE, camera: fixed([-22, 8, -142], [0, 42, -14], 32, [8, 0, 8]), still: 2.0, exposure: 1.55 },
  { id: 'lunge', label: '19. Lunge', desc: 'A sudden, long-reaching attack motion on two legs.', len: 1.6, loop: false, hold: 0.7,
    env: 'shore', at: [0, 0, 0], camera: (t) => {
      const s = t > 0.58 ? Math.exp(-(t - 0.58) * 9) : 0;
      return { pos: [8 + Math.sin(t * 61) * 1.8 * s, 34 + Math.sin(t * 53) * 1.5 * s, -104], target: [0, 32, -20], fov: 40 };
    }, still: 0.7, exposure: 1.6, lights: { key: 1.9 } },
  { id: 'retreat', label: '20. Retreat', desc: 'Turning away and slowly walking back into the water, disappearing.', len: 4.4, loop: false,
    env: 'pool', waterLevel: 0, at: [0, -6, -40], camera: fixed([0, 12, -178], [0, 22, -10], 30, [0, 0, 10], 4.4), still: 2.0,
    ripples: () => [[0, -38, 1.0, 0.5], [0, -26, 1.8, 0.5], [0, -12, 2.6, 0.55], [0, 2, 3.4, 0.6], [0, 12, 4.1, 0.6]], exposure: 1.6, lights: { under: 0.6 } },
];

const poseShots = POSES.map(p => ({
  name: p.id, dur: p.loop ? Math.min(p.len, p.id === 'submerged_watch' || p.id === 'head_tilt' ? 4.0 : 3.2) : p.len + (p.hold || 0.3),
  env: p.env, waterLevel: p.waterLevel, at: p.at, anim: p.id, props: p.props, camera: p.camera, particles: p.particles, ripples: p.ripples,
  label: p.label, sub: p.desc, exposure: p.exposure, lights: p.lights, animOffset: p.loop ? (p.offset || 0) : 0,
}));

export const SHOTS = [
  {
    name: 'intro', dur: 5.0, env: 'shore', anim: 'head_tilt', at: [0, 0, 0],
    camera: dolly([-10, 45, -150], [-4, 46, -96], [26, 45, -14], [22, 46, -14], 26, 24, 5.0),
    title: { in: 0.6, out: 4.2, lines: ['Aquatic Cave Dweller  ·  3.5 blocks tall', 'Vanilla-style Minecraft Bedrock entity  ·  29 animations'] },
    exposure: 1.45, lights: { key: 1.6 },
  },
  {
    name: 'turntable', dur: 7.0, env: 'studio', anim: 'full_stand', at: [0, 0, 4], spin: t => (t / 7) * Math.PI * 2,
    camera: () => ({ pos: [0, 40, -245], target: [0, 30, 0], fov: 25 }),
    label: 'Turnaround', sub: '55 bones · 77 cubes · 128×64 box-UV texture · dorsal spines, rib cage, glossy drips', fade: 0.3,
    lights: { key: 1.7, rim: 1.5, hemi: 0.9, keyDir: [-140, 200, -220] }, exposure: 1.2, vignette: 0.6,
  },
  {
    name: 'stalk_fixed', dur: 5.0, env: 'shore', anim: 'crouch_stalk', at: [0, 0, 20],
    camera: track([-150, 16, -36], [0, 14, -16], 30, [0, 0, -8], 5.0),
    label: 'Crouch / Stalk', sub: 'fixed: now crawls forward, hands and feet stay planted', exposure: 1.6,
  },
  {
    name: 'emerge_fixed', dur: 4.0, env: 'pool', waterLevel: 0, at: [0, -4, -40], timeline: [{ anim: 'emerge', start: 0, dur: 2.8 }, { anim: 'watch', start: 2.8, dur: 1.2 }],
    camera: dolly([-22, 6, -226], [-10, 12, -192], [0, 24, -48], [0, 30, -46], 32, 30, 4.0),
    particles: () => [splash(0.55, 0, 0.1, -46, 60, 1.0), splash(1.0, 24, 0.1, -52, 50, 0.9), splash(1.05, -24, 0.1, -52, 50, 0.9),
                      splash(1.45, 25, 0.1, -52, 60, 1.1), splash(1.48, -25, 0.1, -52, 60, 1.1), streaming(0.9, 2.6, (t) => [0, Math.min(52, 10 + (t - 0.9) * 40), -48])],
    ripples: () => [[0, -46, 0.5, 0.9], [24, -52, 1.0, 0.6], [-24, -52, 1.05, 0.6], [25, -52, 1.45, 1.0], [-25, -52, 1.48, 1.0], [0, -46, 2.1, 0.6]],
    label: 'Emerging', sub: 'fixed: arms flung wide, hands slam down far out, no wrist twist', exposure: 1.55, lights: { under: 0.6 },
  },
  {
    name: 'run', dur: 3.6, env: 'shallows', anim: 'run', at: [0, 0, 140],
    camera: track([-92, 26, -120], [0, 14, -16], 34, [0, 0, 20], 3.6),
    particles: (m) => gaitSplashes(140, m.run.speed, 0.72, 3.8, [[0.06, -13, -30], [0.16, 13, -28], [0.6, -5.4, 5], [0.69, 5.4, 6]], 3.6, 28),
    label: 'Run (Hunt State)', sub: 'fixed: gallop direction', exposure: 1.55, lights: { torch: 300 },
  },
  ...poseShots,
  {
    name: 'outro', dur: 4.5, env: 'shore', anim: 'watch', at: [0, 0, 0], animOffset: 1.6,
    camera: dolly([-14, 47, -128], [-10, 48, -104], [32, 45, -18], [30, 46, -18], 24, 22, 4.5),
    title: { in: 0.5, out: 9, lines: ['Bedrock .geo.json + .animation.json + texture', 'Blockbench .bbmodel  ·  29 animations'] },
    exposure: 1.45, fade: 0.6,
  },
];

// ---------------------------------------------------------------- stills
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
  face: { env: 'shore', anim: 'shadow_hide', t: 0.2, at: [0, 0, 0], camera: () => ({ pos: [-6, 47, -78], target: [0, 47, -18], fov: 26 }), exposure: 1.8 },
  pose_idle_water: { env: 'pool', waterLevel: 0, anim: 'idle_water', t: 1.0, at: [0, -33, -40], camera: () => ({ pos: [-26, 12, -170], target: [0, 10, -48], fov: 34 }), exposure: 2.16, lights: { under: 0.7 },
                     ripples: () => [[0, -46, -0.6, 0.5], [20, -52, 0.4, 0.35], [-19, -45, 0.1, 0.35]] },
  pose_watch: { env: 'shore', anim: 'watch', t: 2.7, at: [0, 0, 0], camera: () => ({ pos: [20, 30, -150], target: [0, 40, -14], fov: 30 }), exposure: 1.82 },
  pose_stalk: { env: 'shore', anim: 'crouch_stalk', t: 0.6, at: [0, 0, 0], speed: 0, camera: () => ({ pos: [-80, 14, -150], target: [0, 16, -18], fov: 30 }), exposure: 1.89 },
  pose_run: { env: 'shallows', anim: 'run', t: 0.3, at: [0, 0, 0], speed: 0, camera: () => ({ pos: [-80, 18, -125], target: [0, 16, -18], fov: 32 }),
              particles: () => [splash(0.12, -12.5, 3.6, -22, 50, 1.1), splash(0.2, 12.5, 3.6, -24, 50, 1.1), splash(0.18, 0, 3.6, 4, 50, 1.0)], exposure: 2.16, lights: { torch: 320 } },
  pose_emerge: { env: 'pool', waterLevel: 0, anim: 'emerge', t: 1.05, at: [0, -4, -40], camera: () => ({ pos: [-16, 10, -170], target: [0, 26, -46], fov: 34 }),
                 particles: () => [splash(0.55, 0, 0.1, -46, 70, 1.0), splash(0.95, 14, 0.1, -50, 50, 0.9), splash(0.98, -14, 0.1, -50, 50, 0.9)],
                 ripples: () => [[0, -46, 0.5, 0.9], [14, -50, 0.95, 0.6], [-14, -50, 0.98, 0.6]], exposure: 2.16, lights: { under: 0.6 } },
  pose_submerge: { env: 'pool', waterLevel: 0, anim: 'submerge', t: 1.9, at: [0, -4, -40], camera: () => ({ pos: [0, 10, -118], target: [0, 8, -46], fov: 28 }),
                   ripples: () => [[0, -46, 1.2, 0.5], [0, -46, 1.7, 0.6], [0, -46, 2.05, 0.8]], exposure: 2.16, lights: { under: 0.7 } },
  reflection: { env: 'pool', waterLevel: 0, anim: 'submerge', t: 2.05, at: [0, -4, -40], camera: () => ({ pos: [0, 6, -120], target: [0, 5, -46], fov: 24 }),
                ripples: () => [[0, -46, 1.2, 0.5], [0, -46, 1.6, 0.6], [0, -46, 1.95, 0.7]], exposure: 2.16, lights: { under: 0.7 } },
  swim_still: { env: 'underwater', anim: 'swim', t: 0.35, at: [0, -40, 0], speed: 0, camera: () => ({ pos: [-120, -6, -120], target: [0, -14, -30], fov: 36 }), exposure: 2.03, tint: [0.92, 1.02, 1.04] },
  torch_still: { env: 'shore', anim: 'crouch_stalk', t: 1.4, at: [0, 0, 60], speed: 0, camera: () => ({ pos: [40, 26, -70], target: [-20, 20, 60], fov: 40 }), exposure: 2.03, lights: { torch: 420, key: 0.9 } },
  hero: { env: 'pool', waterLevel: 0, anim: 'emerge', t: 1.75, at: [0, -4, -40], camera: () => ({ pos: [-48, 16, -142], target: [0, 20, -52], fov: 38 }),
          particles: () => [streaming(1.0, 1.75, () => [0, 30, -50], 70)], ripples: () => [[25, -52, 1.45, 1.0], [-25, -52, 1.48, 1.0], [0, -46, 1.6, 0.6]], exposure: 1.9, lights: { under: 0.7, key: 1.9 } },
};
for (const p of POSES) {
  STILLS['pose_' + p.id] = { env: p.env, waterLevel: p.waterLevel, at: p.at, anim: p.id, t: p.still, props: p.props, camera: p.camera,
                             camT: p.still, particles: p.particles, ripples: p.ripples, exposure: (p.exposure || 1.5) * 1.25, lights: p.lights, speed: 0 };
}
