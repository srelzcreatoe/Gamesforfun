// previews/models_before_after.png: every animatronic of the cast as it was supplied (assets/source_models)
// next to what the build makes of it (packs/RP, after tools/entities/rework.py), from the front and from a
// three-quarter view, in the same pose and at the size the game draws them; and, last row, the Golden Dog at
// his true size beside the reworked Rustgrin.
//
//   node tools/entities/before_after.mjs [out.png] [--ids rustgrin,cat]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRenderer } from '../render/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RP = path.join(ROOT, 'packs/RP');
const SRC = path.join(ROOT, 'assets/source_models');
const CAST = [['rustgrin', 'Rustgrin', 'FNAF_Animatronics_RP'], ['mirehop', 'Mirehop', 'FNAF_Animatronics_RP'], ['noxbriar', 'Noxbriar', 'FNAF_Animatronics_RP'],
  ['purple_rat', 'The Purple Rat', 'FNAF_Animatronics_2_RP'], ['cat', 'The Cat', 'FNAF_Animatronics_2_RP'], ['top_hat_rat', 'The Ringmaster', 'FNAF_Animatronics_2_RP']];
const args = process.argv.slice(2);
const only = args.includes('--ids') ? args[args.indexOf('--ids') + 1].split(',') : null;
const out = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--ids') ?? path.join(ROOT, 'previews/models_before_after.png'));
const scaleOf = (id) => Number(JSON.parse(fs.readFileSync(path.join(RP, `entity/fnar_${id}.entity.json`), 'utf8'))['minecraft:client_entity'].description.scripts.scale);
const anim = (id) => ({ anim: `/R/animations/fnar_${id}.animation.json`, animName: `animation.fnar.${id}.idle`, t: 0.4 });
const before = (id, pack, extra = {}) => ({ geo: `/S/${pack}/models/entity/${id}.geo.json`, texture: `/S/${pack}/textures/entity/${id}.png`, ...anim(id), yaw: 0, scale: scaleOf(id), ...extra });
const after = (id, extra = {}) => ({ geo: `/R/models/entity/fnar_${id}.geo.json`, texture: `/R/textures/entity/fnar/${id}.png`, ...anim(id), yaw: 0, scale: scaleOf(id), ...extra });
const YAW = { front: 0, q3: -35 };
const scene = (models, view, half = 1.75, cy = 1.6, tx = 0) => {
  const yaw = (YAW[view] * Math.PI) / 180, D = 20;
  return {
    background: '#565c66',
    hemi: { sky: '#ffffff', ground: '#606060', intensity: 1.35 },
    lights: [
      { type: 'dir', color: '#ffffff', intensity: 2.2, pos: [3 * Math.sin(yaw) + 2 * Math.cos(yaw), 6, 3 * Math.cos(yaw) - 2 * Math.sin(yaw)], target: [0, 1.4, 0] },
      { type: 'dir', color: '#9fb0ff', intensity: 0.6, pos: [-4, 3, -3] },
    ],
    floor: { size: 14, color: '#4a4e56', grid: '#666a72' },
    models,
    camera: { ortho: half, pos: [tx + D * Math.sin(yaw), cy + 1.2, D * Math.cos(yaw)], target: [tx, cy, 0] },
  };
};
const cells = [];
for (const [id, name, pack] of CAST) {
  if (only && !only.includes(id)) continue;
  for (const view of ['front', 'q3']) {
    cells.push({ label: `${name}: before${view === 'q3' ? ' (three-quarter)' : ''}`, scene: scene([before(id, pack)], view) });
    cells.push({ label: `${name}: after${view === 'q3' ? ' (three-quarter)' : ''}`, scene: scene([after(id)], view) });
  }
}
if (!only) {
  // the Golden Dog at his true size beside the reworked Rustgrin (and the supplied Rustgrin on the far side)
  for (const view of ['front', 'q3']) {
    const pair = [after('rustgrin', { pos: [-1.05, 0, 0] }), after('golden_dog', { pos: [0.95, 0, 0] })];
    cells.push({ label: `Rustgrin (after) and the Golden Dog, at their sizes in the game${view === 'q3' ? ' (three-quarter)' : ''}`, scene: scene(pair, view, 2.7, 2.15) });
    const trio = [before('rustgrin', 'FNAF_Animatronics_RP', { pos: [-1.05, 0, 0] }), after('golden_dog', { pos: [0.95, 0, 0] })];
    cells.push({ label: `Rustgrin as supplied and the Golden Dog${view === 'q3' ? ' (three-quarter)' : ''}`, scene: scene(trio, view, 2.7, 2.15) });
  }
}
await withRenderer(async (render) => {
  await render.sheet({ cols: 4, cellW: 440, cellH: 560, title: 'The cast before and after the rework (left: as supplied, right: as built)', exposure: 1.2, cells }, out);
}, { mounts: { '/R': RP, '/S': SRC } });
console.log(`wrote ${path.relative(ROOT, out)}`);
