// Renders the add-on's preview pictures from the real build plan.
//
//   node tools/previews/make_previews.mjs [--size=1920x1080] [--only=name,name] [--no-composite]
//
// 1. exports voxel snapshots of the pizzeria in the scene variants the game
//    produces at runtime (tools/map/export_voxels.mjs)
// 2. renders every scene below with tools/render (raw PNGs in tools/.cache/previews/raw/)
// 3. runs composite.py: camera shots get the in-game camera HUD (frame, REC,
//    the camera map with the live camera, action bar), everything is written to
//    previews/*.jpg plus a contact sheet.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildVoxels } from '../map/export_voxels.mjs';
import { renderWorld } from '../render/render_world.mjs';
import { CAMERA_BY_ID } from '../../packs/BP/scripts/data/cameras.js';
import { NODES } from '../../packs/BP/scripts/data/nodes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, 'tools/.cache/previews');
const RAW = path.join(CACHE, 'raw');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const [W, H] = arg('size', '1920x1080').split('x').map(Number);
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;

// Voxel snapshots (see export_voxels.mjs applyMode / applyVariants).
const VARIANTS = {
  lit: { mode: 'night_lit' },
  night: { mode: 'night' },
  day: { mode: 'day' },
  cab: { mode: 'night_lit', curtain: 1 },
  cab2: { mode: 'night_lit', curtain: 2 },
  hall_l: { mode: 'night', hall: ['L'] },
  hall_r: { mode: 'night', hall: ['R'] },
  power_out: { mode: 'night', powerOut: true },
  cutaway: { mode: 'day', cutaway: 4 },
};

/** An animatronic standing on a route node (node yaw unless overridden). */
const at = (id, node, anim = 'idle', extra = {}) => {
  const n = NODES[node];
  if (!n) throw new Error(`unknown node ${node}`);
  return { id: `fnar:${id}`, pos: [n.x, n.y, n.z], yaw: n.yaw, anim, t: 0.4, eyes: false, ...extra };
};

/** A security-camera shot: the camera's own lens position and aim. */
const camShot = (id, fov = 62) => {
  const c = CAMERA_BY_ID[id];
  return { pos: [...c.loc], target: [...c.look], fov };
};
// The game lights the live camera's view with dim "IR" light blocks (Actuators.camLight).
const irLight = (id, intensity = 6) => {
  const c = CAMERA_BY_ID[id];
  const p = c.loc.map((v, i) => v + (c.look[i] - v) * 0.35);
  return { type: 'point', pos: p, color: '#d8ffe0', intensity, distance: 18, decay: 1.6 };
};
const spot = (pos, target, { color = '#ffdcae', intensity = 60, distance = 26, angle = 24, penumbra = 0.55, shadow = true } = {}) =>
  ({ type: 'spot', pos, target, color, intensity, distance, angle, penumbra, shadow });
const point = (pos, color, intensity, distance = 14) => ({ type: 'point', pos, color, intensity, distance, decay: 1.8 });

// Every scene: name, voxels variant, caption, optional hud (camera id + action-bar lines), scene fields.
export const SCENES = [
  {
    name: '01_exterior', voxels: 'lit', caption: "Rustgrin's Pizza Revue, Route 6 - November 1991",
    scene: {
      camera: { pos: [101, 2.6, 45.5], target: [81, 4.6, 32], fov: 54 }, exposure: 1.4,
      extra_lights: [
        { type: 'dir', pos: [150, 70, 110], target: [80, 0, 30], color: '#8193c8', intensity: 1.1, shadow: true, shadowExtent: 70 },
        { type: 'ambient', color: '#1b2236', intensity: 0.9 },
      ],
    },
  },
  {
    name: '02_show_stage', voxels: 'lit', caption: 'The Show Stage: Mirehop, Rustgrin and Noxbriar',
    scene: {
      camera: { pos: [38.5, 2.8, 17.0], target: [38.5, 2.55, 4.5], fov: 56 }, exposure: 1.15,
      entities: [
        at('rustgrin', 'ST_R', 'pose_1', { t: 0.3 }),
        at('mirehop', 'ST_M', 'pose_1', { yaw: -14, t: 0.3 }),
        at('noxbriar', 'ST_N', 'pose_1', { yaw: 14, t: 0.3 }),
      ],
      extra_lights: [
        spot([38.5, 6.6, 13], [38.5, 1.6, 4.5], { intensity: 260 }),
        spot([32.5, 6.6, 13], [32.5, 1.6, 5.5], { color: '#ffc2d6', intensity: 210 }),
        spot([44.5, 6.6, 13], [44.5, 1.6, 5.5], { color: '#c6d6ff', intensity: 210 }),
        point([38.5, 3.0, 10.5], '#ffe2b8', 14, 20),
      ],
    },
  },
  {
    name: '03_office_left_door', voxels: 'hall_l', caption: 'The office: left hall light on - Mirehop is at the door',
    scene: {
      camera: { pos: [39.7, 1.62, 68.7], target: [31.2, 1.3, 64.6], fov: 68 }, exposure: 1.05, lights: { intensity: 9 },
      entities: [at('mirehop', 'DOOR_L', 'idle', { eyes: true, t: 1.1 })],
      extra_lights: [
        spot([29.2, 4.6, 64.2], [29.7, 0.6, 66.2], { color: '#e4ecff', intensity: 22, angle: 34, distance: 14 }),
        point([36.5, 3.8, 64.5], '#ffd9a0', 2.2, 12),
      ],
    },
  },
  {
    name: '04_office_right_window', voxels: 'hall_r', caption: 'Right hall light: Noxbriar hums at the window',
    scene: {
      camera: { pos: [36.9, 1.62, 61.9], target: [42.7, 1.95, 62.7], fov: 52 }, exposure: 1.05, lights: { intensity: 4 }, lighting: { block: 0.55 },
      entities: [at('noxbriar', 'WIN_R', 'idle', { eyes: true, t: 0.7, eyeIntensity: 16 })],
      extra_lights: [
        spot([43.6, 4.4, 61.2], [42.7, 1.2, 62.6], { color: '#e4ecff', intensity: 16, angle: 30, distance: 10 }),
        point([41.8, 2.4, 61.4], '#dfe8ff', 1.6, 4),
        point([40.6, 2.3, 62.9], '#ffd9a0', 1.4, 3),
        point([36.5, 3.8, 64.5], '#ffd9a0', 2.2, 12),
      ],
    },
  },
  {
    name: '05_cam_1a', voxels: 'lit', style: 'camera_feed', caption: 'CAM 1A: one of the band is missing...',
    hud: { cam: '1A', lines: ['§fCAM 1A · SHOW STAGE', '§7Night 2 §8| §f1 AM §8| §fPOWER 91% §8| §7USAGE §a▮▮§8▯▯▯▯▯'] },
    scene: {
      camera: camShot('1A'), exposure: 1.55,
      entities: [at('rustgrin', 'ST_R', 'pose_1', { t: 0.3, eyes: true }), at('noxbriar', 'ST_N', 'pose_1', { t: 0.3 })],
      extra_lights: [irLight('1A', 10), spot([38.5, 6.6, 12], [38.5, 1.6, 4.5], { intensity: 520 }), spot([44.5, 6.6, 12], [44.5, 1.6, 5.5], { intensity: 420 }), point([41.5, 3.2, 9.0], '#e8ffe8', 22, 12)],
    },
  },
  {
    name: '06_cam_1c', voxels: 'lit', style: 'camera_feed', caption: 'CAM 1C: the Ringmaster watches from his stage, the Grand Marquee',
    hud: { cam: '1C', lines: ['§fCAM 1C · GRAND MARQUEE', '§5☎ §dThe Ringmaster§7: §fYou may have noticed me on CAM 1C, on my own little stage.', '§7Night 3 §8| §f2 AM §8| §fPOWER 72% §8| §7USAGE §a▮▮§8▯▯▯▯▯'] },
    scene: {
      camera: camShot('1C', 64), exposure: 1.55,
      entities: [at('top_hat_rat', 'CAB', 'pose_1', { eyes: true, t: 0 })],
      extra_lights: [irLight('1C', 8), point([15.6, 2.6, 33.2], '#e8ffe8', 9, 7)],
    },
  },
  {
    name: '07_cam_2a', voxels: 'night', style: 'camera_feed', caption: 'CAM 2A: Mirehop in the West Hall',
    hud: { cam: '2A', lines: ['§fCAM 2A · WEST HALL', '§7Night 4 §8| §f3 AM §8| §ePOWER 38% §8| §7USAGE §e▮▮▮§8▯▯▯▯'] },
    scene: {
      camera: camShot('2A'), exposure: 1.6,
      entities: [at('mirehop', 'WH_M', 'walk', { yaw: 180, eyes: true, t: 0.35 })],
      extra_lights: [irLight('2A', 9), point([27.5, 3.4, 46.2], '#e8ffe8', 9, 8)],
    },
  },
  {
    name: '08_cam_8', voxels: 'lit', style: 'camera_feed', caption: 'CAM 8: the Cat and the Purple Rat dance while the show tape plays - rewind it',
    hud: { cam: '8', lines: ['§fCAM 8 · MIDNIGHT MIDWAY', '§6SHOW TAPE 27% §c§lREWIND', '§7Night 4 §8| §f3 AM §8| §ePOWER 31% §8| §7USAGE §e▮▮▮§8▯▯▯▯'] },
    scene: {
      camera: camShot('8'), exposure: 1.55,
      entities: [at('cat', 'MW_T', 'perform_1', { t: 0.9, eyes: true }), at('purple_rat', 'MW_P', 'perform_1', { t: 0.9, eyes: true })],
      extra_lights: [irLight('8', 7), spot([9.5, 4.6, 18.5], [6.2, 1.0, 21.0], { intensity: 110, angle: 34 }), point([6.0, 3.2, 18.0], '#e8ffe8', 6, 7)],
    },
  },
  {
    name: '09_cam_10', voxels: 'night', style: 'camera_feed', caption: 'CAM 10: maracas in the east duct - shut the right vent',
    hud: { cam: '10', lines: ['§fCAM 10 · EAST DUCT', '§7Night 5 §8| §f5 AM §8| §cPOWER 12% §8| §7USAGE §c▮▮▮▮▮§8▯▯'] },
    scene: {
      camera: camShot('10', 66), exposure: 1.65,
      entities: [at('purple_rat', 'ED_5', 'crawl', { yaw: 180, eyes: true, t: 0.4 })],
      extra_lights: [irLight('10', 5), point([39.2, 8.6, 53.2], '#e8ffe8', 3.5, 6)],
    },
  },
  {
    name: '10_cam_4b', voxels: 'night', style: 'camera_feed', caption: 'CAM 4B: Rustgrin waits in the corner nook',
    hud: { cam: '4B', lines: ['§fCAM 4B · E. HALL CORNER', '§7Night 4 §8| §f4 AM §8| §ePOWER 22% §8| §7USAGE §e▮▮▮§8▯▯▯▯'] },
    scene: {
      camera: camShot('4B', 66), exposure: 1.65,
      entities: [at('rustgrin', 'NOOK', 'idle', { eyes: true, t: 0.2 })],
      extra_lights: [irLight('4B', 7), point([44.0, 3.4, 67.0], '#e8ffe8', 7, 7)],
    },
  },
  {
    name: '11_midway', voxels: 'lit', caption: 'The Midnight Midway ring: the Cat and the Purple Rat share one stage',
    scene: {
      camera: { pos: [12.0, 2.4, 16.6], target: [5.0, 1.8, 21.6], fov: 62 }, exposure: 1.2,
      entities: [at('cat', 'MW_T', 'perform_1', { t: 0.9 }), at('purple_rat', 'MW_P', 'perform_1', { t: 0.9 })],
      extra_lights: [
        spot([9.5, 4.6, 18.0], [6.0, 1.2, 20.6], { color: '#ffd7a8', intensity: 140, angle: 32 }),
        point([6.5, 3.3, 18.2], '#ffe4c4', 7, 8),
        point([2.5, 3.5, 17.5], '#c46bff', 8, 9),
        point([11.5, 3.2, 16.5], '#ff6fa8', 6, 8),
      ],
    },
  },
  {
    name: '12_booth', voxels: 'lit', caption: 'The Grand Marquee, the Ringmaster\'s own stage. He does not move. Not yet',
    scene: {
      camera: { pos: [21.6, 1.75, 35.4], target: [14.2, 1.45, 33.3], fov: 60 }, exposure: 1.15,
      entities: [at('top_hat_rat', 'CAB_PEEK', 'peek', { eyes: true, t: 0.8 })],
      extra_lights: [
        spot([18.5, 5.6, 33.5], [14.5, 1.0, 33.2], { color: '#ffd29a', intensity: 60, angle: 28 }),
        point([15.4, 2.4, 33.3], '#ffcf9a', 4, 5),
        point([20.5, 2.2, 35.5], '#9fb3ff', 3, 9),
      ],
    },
  },
  {
    name: '18_final_act', voxels: 'night', style: 'camera_feed', caption: 'Night 6, The Final Act: he is coming, and doors will not stop him. SPOTLIGHT',
    hud: { cam: '2B', lines: ['§fCAM 2B · W. HALL CORNER', '§5[PA] §dThe Ringmaster§7: §fThe corner, Tester. Right outside. Can you see me?', '§8Find the Ringmaster on a camera, then press SPOTLIGHT', '§7The Final Act §8| §f5 AM §8| §ePOWER 24% §8| §7USAGE §e▮▮▮§8▯▯▯▯'] },
    scene: {
      camera: camShot('2B', 64), exposure: 1.6,
      entities: [at('top_hat_rat', 'WC', 'pose_1', { yaw: 180, eyes: true, t: 0 })],
      extra_lights: [irLight('2B', 8), point([28.4, 3.4, 63.0], '#e8ffe8', 8, 8)],
    },
  },
  {
    name: '13_jumpscare', voxels: 'night', caption: 'Jumpscare',
    scene: {
      camera: { pos: [36.5, 1.62, 63.5], target: [36.5, 1.52, 62.35], fov: 70 }, exposure: 1.1,
      entities: [{ id: 'fnar:rustgrin', pos: [36.5, 1.62 - 2.64, 62.2], yaw: 0, anim: 'jumpscare', t: 0.8, eyes: true }],
      extra_lights: [point([36.5, 3.6, 63.2], '#ffd9a0', 4, 8), point([35.6, 1.0, 63.4], '#ff7a5c', 1.2, 4)],
      bloom: { strength: 0.6, radius: 0.5, threshold: 0.85 },
    },
  },
  {
    name: '14_power_out', voxels: 'power_out', caption: 'Power out. Rustgrin sings in the left doorway',
    scene: {
      camera: { pos: [36.6, 1.62, 63.6], target: [29.9, 1.6, 66.0], fov: 62 }, exposure: 1.5,
      entities: [at('rustgrin', 'DOOR_L', 'perform_1', { eyes: true, t: 0.5, eyeIntensity: 20 })],
      extra_lights: [{ type: 'ambient', color: '#1a2238', intensity: 2.6 }, point([31.4, 2.6, 66.0], '#ffb08a', 2.2, 4)],
    },
  },
  {
    name: '15_free_roam_day', voxels: 'day', caption: 'Free Roam: the pizzeria by day, the band performing',
    scene: {
      camera: { pos: [49.5, 3.4, 24.5], target: [38.5, 2.0, 5.0], fov: 62 }, exposure: 1.0,
      entities: [
        at('rustgrin', 'ST_R', 'perform_1', { t: 0.8 }),
        at('mirehop', 'ST_M', 'perform_1', { t: 0.4 }),
        at('noxbriar', 'ST_N', 'perform_2', { t: 1.1 }),
      ],
      extra_lights: [{ type: 'ambient', color: '#fff4e0', intensity: 0.25 }],
    },
  },
  {
    name: '16_staff_room', voxels: 'lit', caption: 'The Staff Room time clock: every menu is a button on the wall',
    scene: {
      camera: { pos: [11.8, 1.7, 56.4], target: [5.5, 1.5, 52.2], fov: 64 }, exposure: 1.1,
      extra_lights: [point([8.5, 3.6, 56], '#ffe7c0', 6, 14)],
    },
  },
  {
    name: '17_floor_plan', voxels: 'cutaway', caption: 'Cutaway of the whole pizzeria (roof removed)',
    scene: {
      time: 'day', camera: { pos: [41, 64, 100], target: [40, 0, 36], fov: 44 }, exposure: 1.0,
      sun: { dir: [-0.35, -0.85, -0.4], color: '#fff1dc', intensity: 2.2 },
      entities: [
        at('rustgrin', 'ST_R', 'pose_1'), at('mirehop', 'ST_M', 'pose_1'), at('noxbriar', 'ST_N', 'pose_1'),
        at('cat', 'MW_T', 'perform_1'), at('purple_rat', 'MW_P', 'perform_1'), at('top_hat_rat', 'CAB', 'pose_1'),
      ],
    },
  },
];

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const scenes = SCENES.filter((s) => !ONLY || ONLY.includes(s.name));
  const need = [...new Set(scenes.map((s) => s.voxels))];
  for (const key of need) {
    const t0 = Date.now();
    const { snapshot } = buildVoxels(1991, VARIANTS[key]);
    fs.writeFileSync(path.join(CACHE, `${key}.json`), JSON.stringify(snapshot));
    console.log(`snapshot ${key}: ${Date.now() - t0} ms`);
  }
  const jobs = scenes.map((s) => ({
    scene: { width: W, height: H, style: s.style ?? 'vibrant', ...s.scene, voxels: path.join(CACHE, `${s.voxels}.json`) },
    out: path.join(RAW, `${s.name}.png`),
  }));
  const res = await renderWorld(jobs, { quiet: true });
  for (const r of res) console.log(`rendered ${path.relative(ROOT, r.out)} in ${(r.ms / 1000).toFixed(1)} s`);
  fs.writeFileSync(path.join(CACHE, 'scenes.json'), JSON.stringify(SCENES.map(({ name, caption, hud }) => ({ name, caption, hud: hud ?? null })), null, 1));
  if (process.argv.includes('--no-composite')) return;
  const py = spawnSync('python3', [path.join(ROOT, 'tools/previews/composite.py')], { stdio: 'inherit' });
  if (py.status !== 0) process.exit(py.status ?? 1);
}

await main();
