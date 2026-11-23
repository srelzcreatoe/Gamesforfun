#!/usr/bin/env node
// The twelve townspeople (basiliskra:civilian) side by side in the offline viewer: the top row calm, as they walk the
// streets; the bottom row as they look when a giant is in sight (arms thrown up, head turned back, a stumble).
//   node tools/preview/civilians.cjs [out.png] [--size 1800x900]
const { open, ROOT, arg } = require('./render.cjs');
const fs = require('fs');
const path = require('path');
(async () => {
  const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(ROOT, 'previews/civilians.png');
  const [W, H] = arg(process.argv, 'size', '1800x900').split('x').map(Number);
  const s = await open();
  const url = await s.page.evaluate(async ({ W, H }) => {
    const BK = window.BK;
    const geo = '/packs/RP/models/entity/basiliskra_civilian.geo.json';
    const calm = (k) => ({ leg_r: { rot: [k % 2 ? 18 : -18, 0, 0] }, leg_l: { rot: [k % 2 ? -18 : 18, 0, 0] },
      arm_r: { rot: [k % 2 ? -14 : 14, 0, 2.5] }, arm_l: { rot: [k % 2 ? 14 : -14, 0, -2.5] }, head: { rot: [0, (k % 3 - 1) * 15, 0] } });
    const scared = (k) => ({ leg_r: { rot: [k % 2 ? 40 : -40, 0, 0] }, leg_l: { rot: [k % 2 ? -40 : 40, 0, 0] },
      arm_r: { rot: [-155 + (k % 3) * 12, 0, 14] }, arm_l: { rot: [-165 + (k % 2) * 16, 0, -16] },
      head: { rot: [-10, (k % 2 ? 1 : -1) * 35, 0] }, body: { rot: [8, 0, (k % 2 ? 3 : -3)] } });
    for (let k = 0; k < 12; k++) {
      for (const row of [0, 1]) {
        const key = `civ${row}_${k}`;
        await BK.loadForm(key, { geo, tex: `/packs/RP/textures/entity/basiliskra/civilian/civilian_${k}.png`, glow: null });
        BK.setPose(key, row ? scared(k) : calm(k));
        const m = BK.models[key];
        m.holder.position.set((k - 5.5) * 1.15, row ? 0 : 2.6, 0);
        m.holder.rotation.y = (row ? (k % 2 ? 0.5 : -0.5) : (k % 2 ? 0.25 : -0.25));
      }
    }
    return BK.shot(W, H, { pos: [0, 3.2, -14.5], target: [0, 2.2, 0], fov: 30 }, '#2a3360');
  }, { W, H });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(out);
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
