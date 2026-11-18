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
import { scanPlan, STAGE_FOCUS } from '../../packs/BP/scripts/data/guests.js';
import { generatePlan } from '../../packs/BP/scripts/data/build_plan.js';

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
  // the pizzeria at night (mc/nightset.js): night 4, the heads backstage turned to the wall, dying lights
  ns_midnight: { mode: 'night', nightSet: { night: 4, heads: 'away', dying: true } },
  ns_late: { mode: 'night', nightSet: { night: 4, heads: 'lens', dying: true } },
  ns_hall_l: { mode: 'night', hall: ['L'], nightSet: { night: 4, heads: 'lens', dying: true } },
  day_clean: { mode: 'day', cleanWalls: true },
  // the pizzeria by day with guests (mc/guests.js): the front doors open to the floor; and closing time,
  // every room dark, the stage lights still on, daylight in the doorway
  day_open: { mode: 'day', cleanWalls: true, dayDoors: true },
  closing: { mode: 'day', cleanWalls: true, dayDoors: true, closing: [] },
};

/** An animatronic standing on a route node (node yaw unless overridden). */
const at = (id, node, anim = 'idle', extra = {}) => {
  const n = NODES[node];
  if (!n) throw new Error(`unknown node ${node}`);
  return { id: `fnar:${id}`, pos: [n.x, n.y, n.z], yaw: n.yaw, anim, t: 0.4, eyes: false, ...extra };
};

// ---- the daytime guests (fnar:guest), placed the way mc/guests.js places them
const GUEST_INFO = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../entities/guest_skins.json'), 'utf8'));
const GUEST_SEATS = scanPlan(generatePlan()).seats;
const GUEST_SIZE = { adult: 98, teen: 90, child: 62 };
const angleDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
const yawTo = (dx, dz) => (Math.atan2(-dx, dz) * 180) / Math.PI;
/**
 * A guest: its skin (index), where it stands (feet), which way it faces, what it does.
 * o: size (percent), t (seconds into the animation), look [yaw, pitch] (the game's fnar:look_yaw / _pitch),
 *    hold (fnar:hold: 1 left hand out, 2 right, 3 both)
 */
const guest = (skin, pos, yaw, anim = 'idle', o = {}) => {
  const s = (o.size ?? GUEST_SIZE[GUEST_INFO.skins[skin].kind]) / 100;
  const t = (o.t ?? 0.4) + skin * 0.73;
  return {
    id: 'fnar:guest', pos, yaw, anim, t: 0, eyes: false, textureKey: `s${skin}`, layers: ['size', 'look'], hide: anim === 'eat' ? [] : ['slice'],
    vars: {
      fnar_size: s, fnar_head: 1 + Math.min(Math.max(0.92 - s, 0), 0.45) * 0.8, fnar_t: t, fnar_w: (t * 700) / s,
      fnar_hl: o.hold === 1 || o.hold === 3 ? 1 : 0, fnar_hr: o.hold >= 2 ? 1 : 0, fnar_ha: s < 0.8 ? 98 : 34,
      fnar_ly: o.look?.[0] ?? 0, fnar_lp: o.look?.[1] ?? 0,
    },
    _s: s,
  };
};
/** The head turn that looks from a guest at a point (as Guests.faceTo does). */
const lookAtFrom = (g, target) => {
  const dx = target.x - g.pos[0], dz = target.z - g.pos[2];
  const eye = g.pos[1] + 1.64 * g._s;
  return [Math.max(-85, Math.min(85, angleDiff(g.yaw, yawTo(dx, dz)))), (-Math.atan2(target.y - eye, Math.hypot(dx, dz)) * 180) / Math.PI];
};
/** A guest standing somewhere, turned to look at a point. */
const watcher = (skin, x, z, anim, target = STAGE_FOCUS, o = {}) => {
  const g = guest(skin, [x, 0, z], yawTo(target.x - x, target.z - z), anim, o);
  const [ly, lp] = lookAtFrom(g, target);
  g.vars.fnar_ly = ly;
  g.vars.fnar_lp = lp;
  return g;
};
/**
 * A guest on a real seat of the build plan (the chair's block cell). With `target` it watches that point: the
 * body twists on the chair by up to 48 degrees, the head turns the rest.
 */
const seated = (skin, bx, bz, anim = 'sit', target = null, o = {}) => {
  const seat = GUEST_SEATS.find((q) => q.bx === bx && q.bz === bz);
  if (!seat) throw new Error(`no seat at ${bx},${bz}`);
  const g = guest(skin, [seat.x, 0, seat.z], seat.yaw, anim, o);
  g.pos[1] = seat.top - 0.6 * g._s;
  if (target) {
    const rel = angleDiff(seat.yaw, yawTo(target.x - seat.x, target.z - seat.z));
    const twist = Math.max(-48, Math.min(48, rel * 0.5));
    g.yaw = seat.yaw + twist;
    const [ly, lp] = lookAtFrom(g, target);
    g.vars.fnar_ly = ly;
    g.vars.fnar_lp = lp;
  }
  return g;
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
      camera: { pos: [121, 1.9, 50.5], target: [100, 10.5, 34], fov: 66 }, exposure: 1.4,
      extra_lights: [
        { type: 'dir', pos: [170, 70, 110], target: [100, 0, 30], color: '#8193c8', intensity: 1.1, shadow: true, shadowExtent: 80 },
        { type: 'ambient', color: '#1b2236', intensity: 0.9 },
        point([104, 15.5, 34.5], '#ff6fb5', 10, 18),
        point([104, 10, 34.5], '#7ff6e8', 6, 14),
      ],
    },
  },
  {
    name: '02_show_stage', voxels: 'lit', caption: 'The Show Stage: Mirehop, Rustgrin and Noxbriar',
    scene: {
      camera: { pos: [38.5, 2.6, 21.5], target: [38.5, 3.6, 5.0], fov: 60 }, exposure: 1.15,
      entities: [
        at('rustgrin', 'ST_R', 'pose_1', { t: 0.3 }),
        at('mirehop', 'ST_M', 'pose_1', { yaw: -14, t: 0.3 }),
        at('noxbriar', 'ST_N', 'pose_1', { yaw: 14, t: 0.3 }),
      ],
      extra_lights: [
        spot([38.5, 5.6, 13.5], [38.5, 1.6, 6.0], { intensity: 280 }),
        spot([32.5, 5.6, 13.5], [32.5, 1.6, 7.0], { color: '#ffc2d6', intensity: 220 }),
        spot([44.5, 5.6, 13.5], [44.5, 1.6, 7.0], { color: '#c6d6ff', intensity: 220 }),
        point([38.5, 1.6, 9.5], '#ffd9a0', 10, 9),
        point([38.5, 5.0, 13.0], '#ffe2b8', 10, 16),
      ],
    },
  },
  {
    name: '03_office_left_door', voxels: 'hall_l', caption: 'The office: left hall light on - Mirehop is at the door',
    scene: {
      camera: { pos: [39.7, 1.62, 68.7], target: [31.2, 1.3, 64.6], fov: 68 }, exposure: 1.05, lights: { intensity: 9 },
      entities: [at('mirehop', 'DOOR_L', 'lean', { eyes: true, t: 1.1, pos: [31 - 1.49, 0, NODES.DOOR_L.z] })],
      extra_lights: [
        spot([29.2, 5.6, 64.2], [29.7, 0.6, 66.2], { color: '#e4ecff', intensity: 22, angle: 34, distance: 14 }),
        point([36.5, 3.8, 64.5], '#ffd9a0', 2.2, 12),
      ],
    },
  },
  {
    name: '04_office_right_window', voxels: 'hall_r', caption: 'Right hall light: Noxbriar hums at the window',
    scene: {
      camera: { pos: [36.9, 1.62, 61.9], target: [42.7, 1.95, 62.7], fov: 52 }, exposure: 1.05, lights: { intensity: 4 }, lighting: { block: 0.55 },
      entities: [at('noxbriar', 'WIN_R', 'lean', { eyes: true, t: 0.7, eyeIntensity: 16, pos: [42 + 1.61, 0, NODES.WIN_R.z] })],
      extra_lights: [
        spot([43.6, 5.4, 61.2], [42.7, 1.2, 62.6], { color: '#e4ecff', intensity: 16, angle: 30, distance: 10 }),
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
      extra_lights: [irLight('1A', 12), spot([38.5, 5.6, 13], [38.5, 1.6, 6.0], { intensity: 520 }), spot([44.5, 5.6, 13], [44.5, 1.6, 7.0], { intensity: 420 }), point([41.5, 3.2, 9.5], '#e8ffe8', 22, 12)],
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
      extra_lights: [irLight('8', 7), spot([9.5, 6.4, 18.5], [6.2, 1.0, 21.0], { intensity: 110, angle: 34 }), point([6.0, 3.2, 18.0], '#e8ffe8', 6, 7)],
    },
  },
  {
    name: '09_cam_10', voxels: 'night', style: 'camera_feed', caption: 'CAM 10: maracas in the east duct - shut the right vent',
    hud: { cam: '10', lines: ['§fCAM 10 · EAST DUCT', '§7Night 5 §8| §f5 AM §8| §cPOWER 12% §8| §7USAGE §c▮▮▮▮▮§8▯▯'] },
    scene: {
      camera: camShot('10', 66), exposure: 1.65,
      entities: [at('purple_rat', 'ED_5', 'crawl', { yaw: 180, eyes: true, t: 0.4 })],
      extra_lights: [irLight('10', 5), point([39.2, 10.6, 53.2], '#e8ffe8', 3.5, 6)],
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
      camera: { pos: [13.2, 2.3, 21.5], target: [6.5, 2.2, 21.5], fov: 62 }, exposure: 1.2,
      entities: [at('cat', 'MW_T', 'perform_1', { t: 0.9 }), at('purple_rat', 'MW_P', 'perform_1', { t: 0.9 })],
      extra_lights: [
        spot([9.5, 6.4, 18.0], [6.0, 1.2, 20.6], { color: '#ffd7a8', intensity: 140, angle: 32 }),
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
      entities: [{ id: 'fnar:rustgrin', pos: [36.5, 1.62 - 2.15, 63.5 - 1.6], yaw: 0, anim: 'jumpscare', t: 0.35, eyes: true }],
      extra_lights: [point([36.5, 3.6, 63.2], '#ffd9a0', 4, 8), point([35.6, 1.0, 63.4], '#ff7a5c', 1.2, 4)],
      bloom: { strength: 0.6, radius: 0.5, threshold: 0.85 },
    },
  },
  {
    name: '14_power_out', voxels: 'power_out', caption: 'Power out. Rustgrin sings in the left doorway',
    scene: {
      camera: { pos: [36.6, 1.62, 63.6], target: [29.9, 1.6, 66.0], fov: 62 }, exposure: 1.5,
      entities: [at('rustgrin', 'DOOR_L', 'lean', { eyes: true, t: 0.5, eyeIntensity: 20, pos: [31 - 1.61, 0, NODES.DOOR_L.z] })],
      extra_lights: [{ type: 'ambient', color: '#1a2238', intensity: 2.6 }, point([31.4, 2.6, 66.0], '#ffb08a', 2.2, 4)],
    },
  },
  {
    name: '15_free_roam_day', voxels: 'day', caption: 'Free Roam: the showroom by day - star-back chairs, the starry soffit, the band on the curved stage',
    scene: {
      camera: { pos: [58.5, 2.1, 31.5], target: [37.0, 3.0, 9.0], fov: 74 }, exposure: 1.0,
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
      time: 'day', camera: { pos: [54, 66, 102], target: [54, 0, 36], fov: 54 }, exposure: 1.0,
      sun: { dir: [-0.35, -0.85, -0.4], color: '#fff1dc', intensity: 2.2 },
      entities: [
        at('rustgrin', 'ST_R', 'pose_1'), at('mirehop', 'ST_M', 'pose_1'), at('noxbriar', 'ST_N', 'pose_1'),
        at('cat', 'MW_T', 'perform_1'), at('purple_rat', 'MW_P', 'perform_1'), at('top_hat_rat', 'CAB', 'pose_1'),
      ],
    },
  },
  // ---- the last week: the environment pass (spare heads, the birthday table, Walter's car, the auction crates)
  {
    name: '19_cam_5', voxels: 'night', style: 'camera_feed', caption: 'CAM 5: spare heads on every shelf, under the Ringmaster\'s motto',
    hud: { cam: '5', lines: ['§fCAM 5 · BACKSTAGE', '§7Night 3 §8| §f2 AM §8| §fPOWER 64% §8| §7USAGE §a▮▮§8▯▯▯▯▯'] },
    scene: {
      camera: camShot('5', 66), exposure: 1.7,
      extra_lights: [irLight('5', 9), point([6.5, 3.4, 4.5], '#e8ffe8', 8, 9)],
    },
  },
  {
    name: '20_birthday_table', voxels: 'lit', caption: 'Nobody cleared the last birthday party. One candle is still burning',
    scene: {
      camera: { pos: [52.9, 1.95, 26.6], target: [50, 1.05, 23.6], fov: 56 }, exposure: 1.4,
      extra_lights: [point([50.2, 1.9, 24.5], '#ffb867', 2.5, 5)],
    },
  },
  {
    name: '21_walters_car', voxels: 'night', caption: 'Walter\'s car, still in the lot: the door open, the headlights on',
    scene: {
      camera: { pos: [117.5, 1.8, 38.5], target: [108.5, 0.9, 44.5], fov: 60 }, exposure: 1.4,
      extra_lights: [
        { type: 'dir', pos: [170, 70, 110], target: [100, 0, 30], color: '#8193c8', intensity: 0.9, shadow: true, shadowExtent: 80 },
        { type: 'ambient', color: '#1b2236', intensity: 0.8 },
      ],
    },
  },
  {
    name: '22_parts_service', voxels: 'day', caption: 'Parts & Service: six crates for the auction, LOT 1 to LOT 6. All of them empty',
    scene: {
      camera: { pos: [62.5, 2.2, 64.6], target: [59.5, 1.0, 69], fov: 76 }, exposure: 1.0,
      extra_lights: [{ type: 'ambient', color: '#fff4e0', intensity: 1.0 }, point([63, 4, 66], '#ffe7c0', 9, 14)],
    },
  },
  {
    name: '23_fun_zone', voxels: 'day', caption: 'Free Roam: the Fun Zone - two play towers, crawl tubes and a slide into the ball pit',
    scene: { camera: { pos: [96.5, 6.6, 69.5], target: [87, 1.8, 47], fov: 76 }, exposure: 1.0 },
  },
  {
    name: '24_game_room_night', voxels: 'night', caption: 'The Game Room at night: only the screens, the neon and the coin slots are still on',
    scene: { camera: { pos: [77.5, 2.2, 59.5], target: [55, 1.8, 46], fov: 72 }, exposure: 1.6 },
  },
  {
    name: '25_prize_corner', voxels: 'day', caption: 'The Prize Corner: a wall of plush prizes behind the glass counter',
    scene: { camera: { pos: [90.5, 2.4, 24.5], target: [90.5, 1.6, 3], fov: 72 }, exposure: 1.0 },
  },
  // ---- the remake: the rooms of a big 80s family pizzeria
  {
    name: '26_game_room', voxels: 'day', caption: 'The Game Room: skee-ball, rows of arcade cabinets, token machines and a crawl tube overhead',
    scene: { camera: { pos: [76.5, 4.4, 59.5], target: [57, 1.2, 46], fov: 74 }, exposure: 1.0 },
  },
  {
    name: '27_entrance_hall', voxels: 'day', caption: 'The Entrance Hall: the ticket booth, the hand-stamp podium, the arches to the games',
    scene: { camera: { pos: [97.5, 2.6, 39.5], target: [70, 1.8, 31], fov: 72 }, exposure: 1.0 },
  },
  {
    name: '28_dining_hall_night', voxels: 'night', caption: 'The Dining Hall at night: the band waits in the dark, one candle burns',
    scene: {
      camera: { pos: [56.5, 2.6, 33.5], target: [40.5, 2.8, 8], fov: 66 }, exposure: 2.4,
      entities: [at('rustgrin', 'ST_R', 'idle', { eyes: true, t: 0.2 }), at('mirehop', 'ST_M', 'idle', { eyes: true, t: 0.2 }), at('noxbriar', 'ST_N', 'idle', { eyes: true, t: 0.2 })],
      extra_lights: [{ type: 'ambient', color: '#1a2238', intensity: 2.4 }, point([50.2, 1.9, 24.5], '#ffb867', 4, 8), spot([38.5, 6.4, 12], [38.5, 1.0, 5], { color: '#9fb3ff', intensity: 40, angle: 30 })],
    },
  },
  {
    name: '30_cam_1b', voxels: 'night', style: 'camera_feed', caption: 'CAM 1B: the Dining Hall from the corner - Mirehop is off the stage',
    hud: { cam: '1B', lines: ['§fCAM 1B · DINING AREA', '§7Night 3 §8| §f1 AM §8| §fPOWER 83% §8| §7USAGE §a▮▮§8▯▯▯▯▯'] },
    scene: {
      camera: camShot('1B', 64), exposure: 1.7,
      entities: [at('mirehop', 'DIN_C', 'walk', { yaw: 160, eyes: true, t: 0.35 }), at('rustgrin', 'ST_R', 'idle', { eyes: true, t: 0.2 }), at('noxbriar', 'ST_N', 'idle', { t: 0.2 })],
      extra_lights: [irLight('1B', 12), point([38.5, 4.2, 22.5], '#e8ffe8', 18, 10), point([38.5, 5.5, 9.0], '#e8ffe8', 8, 12)],
    },
  },
  {
    name: '31_entrance_arch', voxels: 'day', caption: 'The Entrance Hall: the WELCOME arch in marquee bulbs, the token counter under its starry soffit',
    scene: { camera: { pos: [78.5, 2.0, 38.5], target: [64.5, 2.4, 31.0], fov: 68 }, exposure: 1.0 },
  },
  {
    name: '32_facade', voxels: 'lit', caption: "The street front at night: Rustgrin waves over the neon sign; nobody has opened the doors in weeks",
    scene: {
      camera: { pos: [139, 5.5, 35.5], target: [100, 8.0, 35.5], fov: 56 }, exposure: 1.6,
      extra_lights: [
        { type: 'dir', pos: [190, 110, 10], target: [100, 0, 35], color: '#9aaee0', intensity: 1.5, shadow: true, shadowExtent: 90 },
        { type: 'ambient', color: '#1e2742', intensity: 1.6 },
        point([104, 9, 35.5], '#ff6fb5', 8, 16),
        point([104, 14, 35.5], '#ffe2b0', 6, 14),
      ],
    },
  },
  {
    name: '33_from_the_stage', voxels: 'night', caption: 'From the stage at night: the footlights are dead, the drum and the tables wait in the dark',
    scene: {
      camera: { pos: [38.5, 3.2, 5.5], target: [38.5, 1.4, 30], fov: 78 }, exposure: 2.8,
      extra_lights: [{ type: 'ambient', color: '#1a2238', intensity: 2.2 }, point([50.2, 1.9, 24.5], '#ffb867', 4, 8)],
    },
  },
  // ---- the night shift (1.0.12-1.0.13): hollow eyes and the door scares
  {
    name: '34_door_stare', voxels: 'hall_l', caption: 'Caught in the light: the pupils are gone, the head follows you, and it leans in closer',
    scene: {
      camera: { pos: [36.5, 1.62, 63.5], target: [30.2, 1.75, 66.0], fov: 48 }, exposure: 0.62, lights: { intensity: 5 }, lighting: { block: 0.5 },
      entities: [at('rustgrin', 'DOOR_L', 'lean', { eyes: true, hollow: true, t: 1.1, eyeIntensity: 10, headYaw: 22, headPitch: -6, pos: [31 - 1.61 + 0.35, 0, NODES.DOOR_L.z] })],
      extra_lights: [
        spot([29.2, 5.6, 64.2], [29.9, 0.6, 66.2], { color: '#e4ecff', intensity: 10, angle: 34, distance: 14 }),
        point([36.5, 3.8, 64.5], '#ffd9a0', 1.6, 12),
      ],
    },
  },
  {
    name: '35_dark_doorway', voxels: 'night', caption: 'Light off: nothing in the doorway but two cold pinpricks',
    scene: {
      camera: { pos: [36.5, 1.62, 63.5], target: [30.2, 1.75, 66.0], fov: 48 }, exposure: 1.2,
      entities: [at('mirehop', 'DOOR_L', 'lean', { eyes: true, hollow: true, t: 0.6, eyeIntensity: 14, headYaw: 22, headPitch: -6, pos: [31 - 1.49, 0, NODES.DOOR_L.z] })],
      extra_lights: [{ type: 'ambient', color: '#0c1018', intensity: 0.9 }, point([36.5, 3.8, 64.5], '#ffd9a0', 0.5, 6)],
    },
  },
  {
    name: '36_cam_band_stare', voxels: 'lit', style: 'camera_feed', caption: 'CAM 1A at 3 AM: every face snaps to the lens, the pupils gone',
    hud: { cam: '1A', lines: ['§fCAM 1A · SHOW STAGE', '§7Night 4 §8| §43 AM §8| §fPOWER 38% §8| §7USAGE §e▮▮▮§8▯▯▯▯'] },
    scene: {
      camera: { pos: [38.5, 3.3, 16.0], target: [38.5, 2.9, 6.5], fov: 74 }, exposure: 1.55,
      entities: [
        at('rustgrin', 'ST_R', 'pose_1', { t: 0.3, eyes: true, hollow: true, eyeIntensity: 22, headPitch: 12 }),
        at('mirehop', 'ST_M', 'pose_1', { t: 0.3, eyes: true, hollow: true, eyeIntensity: 22, headYaw: -14, headPitch: 12 }),
        at('noxbriar', 'ST_N', 'pose_1', { t: 0.3, eyes: true, hollow: true, eyeIntensity: 22, headYaw: 14, headPitch: 12 }),
      ],
      extra_lights: [irLight('1A', 12), spot([38.5, 5.6, 13], [38.5, 1.6, 6.0], { intensity: 420 }), point([41.5, 3.2, 9.5], '#e8ffe8', 18, 12)],
    },
  },
  {
    name: '37_window_stare', voxels: 'hall_r', caption: 'The right window: Noxbriar stares in, her eyes empty',
    scene: {
      camera: { pos: [36.9, 1.62, 61.9], target: [42.7, 1.95, 62.7], fov: 52 }, exposure: 0.8, lights: { intensity: 4 }, lighting: { block: 0.5 },
      entities: [at('noxbriar', 'WIN_R', 'lean', { eyes: true, hollow: true, t: 0.7, eyeIntensity: 12, headYaw: -10, pos: [42 + 1.61 - 0.35, 0, NODES.WIN_R.z] })],
      extra_lights: [
        spot([43.6, 5.4, 61.2], [42.7, 1.2, 62.6], { color: '#e4ecff', intensity: 16, angle: 30, distance: 10 }),
        point([41.8, 2.4, 61.4], '#dfe8ff', 1.6, 4),
        point([36.5, 3.8, 64.5], '#ffd9a0', 1.6, 12),
      ],
    },
  },
  {
    name: '38_jumpscare_hollow', voxels: 'night', caption: 'Some of them come at you with empty eyes',
    scene: {
      camera: { pos: [36.5, 1.62, 63.0], target: [36.5, 1.52, 61.85], fov: 70 }, exposure: 1.1,
      entities: [{ id: 'fnar:cat', pos: [36.5, 1.62 - 2.13, 63.0 - 1.65], yaw: 0, anim: 'jumpscare', t: 1.19, eyes: true, hollow: true, eyeIntensity: 10 }],
      extra_lights: [point([36.5, 3.6, 62.7], '#ffd9a0', 4, 8), point([35.6, 1.0, 62.9], '#7aa8ff', 1.0, 4)],
      bloom: { strength: 0.6, radius: 0.5, threshold: 0.85 },
    },
  },
  // ---- the pizzeria at night (1.0.14)
  {
    name: '39_cam5_midnight', voxels: 'ns_midnight', style: 'camera_feed', caption: 'CAM 5 at midnight: the heads on the shelves face the wall',
    hud: { cam: '5', lines: ['§fCAM 5 · BACKSTAGE', '§7Night 4 §8| §f12 AM §8| §fPOWER 99% §8| §7USAGE §a▮§8▯▯▯▯▯▯'] },
    scene: { camera: { pos: [12.5, 5.35, 13.0], target: [6.5, 1.3, 1.5], fov: 26 }, exposure: 1.7, extra_lights: [irLight('5', 9), point([6.5, 3.4, 4.5], '#e8ffe8', 8, 9)] },
  },
  {
    name: '40_cam5_4am', voxels: 'ns_late', style: 'camera_feed', caption: 'CAM 5 at 4 AM: while you were not watching, every face turned to the lens',
    hud: { cam: '5', lines: ['§fCAM 5 · BACKSTAGE', '§7Night 4 §8| §44 AM §8| §ePOWER 27% §8| §7USAGE §e▮▮▮§8▯▯▯▯'] },
    scene: { camera: { pos: [12.5, 5.35, 13.0], target: [6.5, 1.3, 1.5], fov: 26 }, exposure: 1.7, fog: { density: 0.045 }, extra_lights: [irLight('5', 9), point([6.5, 3.4, 4.5], '#e8ffe8', 8, 9)] },
  },
  {
    name: '41_office_drawing_west', voxels: 'ns_late', caption: 'Night 4: the drawing pinned up by the desk has changed - faces at both doors',
    scene: { camera: { pos: [35.2, 2.6, 62.6], target: [32.0, 3.5, 61.5], fov: 34 }, exposure: 1.2, extra_lights: [point([34.5, 3.6, 62.4], '#ffd9a0', 1.6, 6)] },
  },
  {
    name: '42_office_drawing_east', voxels: 'ns_late', caption: 'And the other one: Rustgrin, his eyes black, his smile far too wide',
    scene: { camera: { pos: [37.8, 2.6, 62.6], target: [41.0, 3.5, 61.5], fov: 34 }, exposure: 1.2, extra_lights: [point([38.5, 3.6, 62.4], '#ffd9a0', 1.6, 6)] },
  },
  {
    name: '43_tally_marks', voxels: 'ns_hall_l', caption: 'Outside the left door, in chalk: one mark for every night you came back. HE KNOWS YOUR NAME',
    scene: {
      camera: { pos: [30.4, 2.0, 61.8], target: [26.0, 2.6, 64.0], fov: 66 }, exposure: 0.5, lights: { intensity: 4 }, lighting: { block: 0.45 },
      extra_lights: [spot([29.2, 5.6, 64.2], [27.0, 1.2, 63.0], { color: '#e4ecff', intensity: 6, angle: 40, distance: 14 })],
    },
  },
  {
    name: '44_stage_footlight', voxels: 'ns_late', caption: 'One footlight still works. It sputters under the band in the dark',
    scene: {
      camera: { pos: [38.5, 1.8, 17.0], target: [38.5, 2.4, 6.5], fov: 58 }, exposure: 1.5,
      entities: [
        at('rustgrin', 'ST_R', 'pose_1', { t: 0.3, eyes: true }),
        at('mirehop', 'ST_M', 'pose_1', { t: 0.3, eyes: true }),
        at('noxbriar', 'ST_N', 'pose_1', { t: 0.3, eyes: true }),
      ],
      // the one footlight that still works (40, 0, 11), lighting them from below
      extra_lights: [{ type: 'ambient', color: '#0c1018', intensity: 0.7 }, point([40.5, 1.0, 10.2], '#ffd29a', 34, 14)],
    },
  },
  {
    name: '45_welcome_night', voxels: 'ns_late', caption: 'The WELCOME arch at night: a few bulbs still stutter in the dark',
    scene: { camera: { pos: [78.5, 2.0, 38.5], target: [64.5, 2.4, 31.0], fov: 68 }, exposure: 1.9, extra_lights: [{ type: 'ambient', color: '#0c1018', intensity: 0.9 }] },
  },
  {
    name: '46_hall_writing_day', voxels: 'day_clean', caption: 'The West Hall by day: clean walls',
    scene: { camera: { pos: [28.4, 2.2, 46.5], target: [26.0, 3.2, 53.5], fov: 62 }, exposure: 1.0 },
  },
  {
    name: '47_hall_writing_night', voxels: 'ns_late', style: 'camera_feed', caption: 'The same wall at night: THE SHOW MUST GO ON',
    hud: { cam: '2A', lines: ['§fCAM 2A · WEST HALL', '§7Night 4 §8| §43 AM §8| §ePOWER 38% §8| §7USAGE §e▮▮▮§8▯▯▯▯'] },
    scene: { camera: { pos: [28.4, 2.2, 46.5], target: [26.0, 3.2, 53.5], fov: 62 }, exposure: 1.6, extra_lights: [irLight('2A', 9), point([27.5, 3.4, 50.2], '#e8ffe8', 9, 8)] },
  },
  {
    name: '51_parts_room', voxels: 'day', caption: 'Parts & Service, evened out: a head on every shelf, the two stands facing the door',
    scene: { camera: { pos: [50.6, 2.5, 66.6], target: [70, 1.0, 66.0], fov: 78 }, exposure: 1.3, extra_lights: [{ type: 'ambient', color: '#ffffff', intensity: 1.4 }] },
  },
  {
    name: '52_parts_shelves', voxels: 'day', caption: 'The spare heads stand square on full-depth shelves',
    scene: { camera: { pos: [68.0, 1.8, 67.6], target: [68.0, 1.0, 64.0], fov: 74 }, exposure: 1.3, extra_lights: [{ type: 'ambient', color: '#ffffff', intensity: 1.6 }] },
  },
  // ---- the pizzeria by day: the guests (mc/guests.js)
  {
    name: '48_day_show', voxels: 'day_open', caption: 'Free Roam, showtime: a full house watches the band - families at the tables, children cheering at the front',
    scene: {
      camera: { pos: [48.3, 2.05, 22.6], target: [39.2, 2.5, 6.5], fov: 70 }, exposure: 1.25,
      entities: [
        at('rustgrin', 'ST_R', 'perform_1', { t: 0.8 }), at('mirehop', 'ST_M', 'perform_1', { t: 0.4 }), at('noxbriar', 'ST_N', 'perform_2', { t: 1.1 }),
        // at the long tables
        seated(4, 51, 26, 'sit_clap', STAGE_FOCUS, { t: 0.2 }), seated(18, 51, 28, 'sit_cheer', STAGE_FOCUS, { t: 0.5 }), seated(5, 49, 26, 'sit', STAGE_FOCUS), seated(19, 49, 28, 'sit_clap', STAGE_FOCUS, { t: 0.7 }),
        seated(0, 43, 20, 'sit', STAGE_FOCUS), seated(16, 43, 18, 'sit_cheer', STAGE_FOCUS, { t: 0.1 }), seated(1, 45, 22, 'sit_clap', STAGE_FOCUS, { t: 0.4 }),
        seated(2, 49, 20, 'sit', STAGE_FOCUS), seated(3, 49, 18, 'sit_clap', STAGE_FOCUS, { t: 0.9 }),
        seated(10, 34, 22, 'sit', STAGE_FOCUS), seated(7, 34, 24, 'sit_clap', STAGE_FOCUS, { t: 0.3 }), seated(6, 34, 20, 'sit', STAGE_FOCUS),
        seated(13, 28, 22, 'eat', null), seated(22, 28, 24, 'sit_cheer', STAGE_FOCUS, { t: 0.6 }),
        // at the little tables on the right
        seated(11, 56, 24, 'sit_clap', STAGE_FOCUS, { t: 0.5 }), seated(21, 55, 23, 'sit_cheer', STAGE_FOCUS, { t: 0.3 }), seated(12, 57, 23, 'sit', STAGE_FOCUS),
        seated(9, 55, 28, 'sit', STAGE_FOCUS), seated(23, 57, 28, 'sit_clap', STAGE_FOCUS, { t: 0.2 }),
        // standing in front of the stage, either side of the middle aisle: children in the front row
        watcher(17, 43.6, 13.95, 'cheer', STAGE_FOCUS, { t: 0.15 }), watcher(20, 44.7, 13.95, 'point'), watcher(14, 43.6, 15.1, 'clap', STAGE_FOCUS, { t: 0.4 }), watcher(8, 45.8, 15.1, 'idle'),
        watcher(15, 33.9, 15.1, 'clap', STAGE_FOCUS, { t: 0.1 }), watcher(1, 31.7, 15.1, 'idle', STAGE_FOCUS, { size: 96 }),
      ],
      extra_lights: [
        { type: 'ambient', color: '#fff4e0', intensity: 0.5 },
        spot([38.5, 6.4, 13.5], [38.5, 1.6, 6.0], { intensity: 240 }), spot([32.5, 6.4, 13.5], [32.5, 1.6, 7.0], { color: '#ffc2d6', intensity: 180 }),
        spot([44.5, 6.4, 13.5], [44.5, 1.6, 7.0], { color: '#c6d6ff', intensity: 180 }),
        point([50, 3.8, 24], '#ffe7c0', 22, 16), point([43, 3.8, 18], '#ffe7c0', 18, 14), point([33, 3.8, 20], '#ffe7c0', 14, 14), point([54, 3.2, 16], '#ffe7c0', 8, 9),
      ],
    },
  },
  {
    name: '49_family_at_the_doors', voxels: 'day_open', caption: 'Free Roam: a family comes in through the front doors; by day the pizzeria is full of people',
    scene: {
      time: 'day', camera: { pos: [91.4, 1.7, 32.9], target: [99.6, 1.15, 36.1], fov: 60 }, exposure: 1.0,
      entities: [
        // dad and the two children on the checker walk, mum in the doorway behind them
        guest(0, [97.2, 0, 36.2], 96, 'walk', { t: 0.2, hold: 1, look: [-12, 4] }), guest(16, [97.05, 0, 37.25], 96, 'walk', { t: 0.36, hold: 2, look: [20, -14] }),
        guest(21, [96.3, 0, 35.1], 78, 'cheer', { t: 0.2, look: [0, -10] }),
        guest(1, [99.9, 0, 36.0], 92, 'walk', { t: 0.62, look: [10, 2] }),
        // more on their way across the lot; someone getting a hand stamp at the podium
        guest(10, [104.2, 0, 36.3], 96, 'walk', { t: 0.3 }), guest(7, [103.3, 0, 36.9], 92, 'walk', { t: 0.55, look: [-20, 0] }),
        guest(11, [96.5, 0, 32.55], 180, 'talk', { t: 0.5 }), guest(19, [95.35, 0, 31.6], -90, 'idle', { look: [-20, -8] }),
      ],
      extra_lights: [{ type: 'ambient', color: '#fff4e0', intensity: 0.7 }, point([96.5, 3.4, 34.5], '#ffe7c0', 14, 12)],
    },
  },
  {
    name: '50_closing_last_child', voxels: 'closing', caption: 'Closing time: the lights are out, everyone has gone. In the doorway the last child stops, and looks back at the stage',
    scene: {
      time: 'day', camera: { pos: [90.6, 1.45, 34.5], target: [99.6, 1.0, 36.0], fov: 44 }, exposure: 0.85,
      lighting: { skyIntensity: 0.75 },
      entities: [
        // the child in the doorway, turned to the stage far behind the camera; its mother just outside, looking round for it
        watcher(17, 99.3, 36.0, 'idle', { x: STAGE_FOCUS.x, y: 1.0, z: STAGE_FOCUS.z }, { t: 0.3 }),
        guest(13, [102.4, 0, 35.4], 22, 'idle', { t: 0.7, look: [56, 6] }),
      ],
    },
  },
  {
    name: '29_party_room', voxels: 'day', caption: 'The Party Room between the halls: a birthday table set for children who never came',
    scene: { camera: { pos: [36.5, 2.4, 39.6], target: [36.5, 0.8, 54], fov: 70 }, exposure: 1.0 },
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
