// Contact sheets of the daytime guests (fnar:guest, built by tools/entities/build_guest.py).
//
//   node tools/render/guest_sheet.mjs skins [out.png]   every skin, front and back, at its own size
//                                                       (default previews/guest_skins.png)
//   node tools/render/guest_sheet.mjs anims [out.png] [--skins 0,16] [--views front,right] [--anims sit,eat] [--cell 170x190]
//                                                       every animation at four moments
//                                                       (default tools/.cache/guest_anims.png)
//   node tools/render/guest_sheet.mjs lineup [out.png]  a family next to a 3-block animatronic, for scale
//
// A yellow post in every cell is 1.8 blocks tall (a player); the floor grid is 1 block.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRenderer } from './render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INFO = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/entities/guest_skins.json'), 'utf8'));
const GEO = '/P/packs/RP/models/entity/fnar_guest.geo.json';
const ANIM = '/P/packs/RP/animations/fnar_guest.animation.json';
const tex = (i) => `/P/packs/RP/textures/entity/fnar/guest_${String(i).padStart(2, '0')}.png`;
/** The size the game gives each kind (percent of adult height): see data/guests.js. */
const SIZE = { adult: 98, teen: 90, child: 62 };

/** A guest as the client shows it: the entity's render scale, the size layer, the walk phase. */
function guest(skin, { anim = 'idle', t = 0.4, yaw = 0, pos = [0, 0, 0], size, hold = 0 } = {}) {
  const s = (size ?? SIZE[INFO.skins[skin].kind]) / 100;
  const time = t + skin * 0.73;
  return {
    geo: GEO, texture: tex(skin), anim: ANIM, animName: `animation.fnar.guest.${anim}`, t: 0, yaw, pos, scale: INFO.scale,
    layers: ['animation.fnar.guest.size'], hide: anim === 'eat' ? [] : ['slice'],
    vars: { fnar_size: s, fnar_head: 1 + Math.min(Math.max(0.92 - s, 0), 0.45) * 0.8, fnar_t: time, fnar_w: (time * 560) / s, fnar_hl: hold === 1 ? 1 : 0, fnar_hr: hold === 2 ? 1 : 0, fnar_ha: s < 0.8 ? 98 : 34 },
  };
}

const VIEW_YAW = { front: 0, right: -90, left: 90, back: 180, q3: -35 };
function cell(models, { label, view = 'front', half = 1.25, cy = 1.0, post = true } = {}) {
  const yaw = (VIEW_YAW[view] ?? 0) * Math.PI / 180;
  const D = 20;
  return {
    label,
    scene: {
      background: '#2a2a30',
      hemi: { sky: '#ffffff', ground: '#5a5a5a', intensity: 1.5 },
      lights: [
        { type: 'dir', color: '#ffffff', intensity: 2.0, pos: [3 * Math.sin(yaw) + 2 * Math.cos(yaw), 6, 3 * Math.cos(yaw) - 2 * Math.sin(yaw)], target: [0, 1, 0], shadow: 4 },
        { type: 'dir', color: '#9fb0ff', intensity: 0.6, pos: [-4, 3, -3] },
      ],
      floor: { size: 12, color: '#55555c', grid: '#77777f' },
      boxes: post ? [{ pos: [1.05 * Math.cos(yaw), 0.9, -1.05 * Math.sin(yaw)], size: [0.05, 1.8, 0.05], color: '#d0c040' }] : [],
      models,
      camera: { ortho: half, pos: [D * Math.sin(yaw), cy + 0.5, D * Math.cos(yaw)], target: [0, cy, 0] },
    },
  };
}

const [mode = 'skins', ...rest] = process.argv.slice(2);
const flag = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
const outArg = rest.find((a, i) => !a.startsWith('--') && !(rest[i - 1] ?? '').startsWith('--'));
let sheet, out;
if (mode === 'skins') {
  out = outArg ?? path.join(ROOT, 'previews/guest_skins.png');
  const cells = INFO.skins.map((sk, i) => cell([guest(i, { pos: [-0.5, 0, 0] }), guest(i, { pos: [0.5, 0, 0], yaw: 180 })], { label: `${i}  ${sk.name}  (${sk.kind})` }));
  sheet = { cols: 8, cellW: 300, cellH: 300, title: `fnar:guest - ${INFO.skins.length} skins, front and back (the yellow post is a 1.8-block player)`, exposure: 1.35, cells };
} else if (mode === 'anims') {
  out = outArg ?? path.join(ROOT, 'tools/.cache/guest_anims.png');
  const skins = (flag('skins') ?? '0,17').split(',').map(Number);
  const views = (flag('views') ?? 'q3,right').split(',');
  const times = [0.1, 0.45, 0.8, 1.15];
  const cells = [];
  const anims = flag('anims') ? flag('anims').split(',') : INFO.anims;
  const [cw, ch] = (flag('cell') ?? '170x190').split('x').map(Number);
  for (const anim of anims) for (const skin of skins) for (const view of views) for (const t of times) cells.push(cell([guest(skin, { anim, t })], { label: `${anim}  t=${t}  ${view}`, view, half: 1.15, cy: 0.9 }));
  sheet = { cols: times.length * views.length * skins.length, cellW: cw, cellH: ch, title: 'fnar:guest animations', exposure: 1.35, cells };
} else if (mode === 'lineup') {
  out = outArg ?? path.join(ROOT, 'tools/.cache/guest_lineup.png');
  const rg = { geo: '/P/packs/RP/models/entity/fnar_rustgrin.geo.json', texture: '/P/packs/RP/textures/entity/fnar/rustgrin.png', anim: '/P/packs/RP/animations/fnar_rustgrin.animation.json', animName: 'animation.fnar.rustgrin.pose_1', t: 0.3, yaw: 0, pos: [0, 0, 0], scale: 1.18 };
  const fam = [guest(0, { pos: [-2.6, 0, 0.3], hold: 1 }), guest(16, { pos: [-1.5, 0, 0.3], hold: 2 }), guest(1, { pos: [1.7, 0, 0.3], anim: 'wave', t: 0.6 }), guest(21, { pos: [2.7, 0, 0.3], anim: 'cheer', t: 0.2 }), guest(7, { pos: [3.7, 0, 0.3], anim: 'point', t: 0.2, yaw: 40 })];
  sheet = { cols: 1, cellW: 1400, cellH: 640, exposure: 1.35, cells: [cell([rg, ...fam], { half: 1.9, cy: 1.6, label: 'a family next to Rustgrin (3 blocks tall)' })] };
} else {
  console.log('usage: node tools/render/guest_sheet.mjs skins|anims|lineup [out.png]');
  process.exit(1);
}
await withRenderer(async (render) => { await render.sheet(sheet, out); }, { mounts: { '/P': ROOT } });
console.log(`guest_sheet: wrote ${path.relative(ROOT, out)}`);
