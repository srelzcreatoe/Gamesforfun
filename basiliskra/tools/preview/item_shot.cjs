#!/usr/bin/env node
// A still of any single model (an attachable, a block model) from two sides, in the offline viewer.
//   node item_shot.cjs <geo.json> <texture.png> <out.png> [--size 1200x600]
const { open, ROOT, arg } = require('./render.cjs');
const fs = require('fs');
const path = require('path');
(async () => {
  const [geo, tex, out] = process.argv.slice(2);
  const [W, H] = arg(process.argv, 'size', '1200x600').split('x').map(Number);
  const rel = (f) => '/' + path.relative(ROOT, path.resolve(f)).split(path.sep).join('/');
  const s = await open();
  const url = await s.page.evaluate(async ({ geo, tex, W, H }) => {
    const BK = window.BK, THREE = BK.THREE;
    await BK.loadForm('item', { geo, tex, glow: null });
    const m = BK.models.item;
    m.holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m.holder), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const views = [[35, 22], [215, 18]];
    for (let i = 0; i < views.length; i++) {
      const [yaw, pitch] = views[i].map((d) => d * Math.PI / 180);
      const d = size * 1.25;
      const u = BK.shot(W / views.length, H, { pos: [c.x - Math.cos(yaw) * Math.cos(pitch) * d, c.y + Math.sin(pitch) * d, c.z - Math.sin(yaw) * Math.cos(pitch) * d], target: c.toArray(), fov: 30 }, '#232a5c');
      const img = new Image(); await new Promise((r) => { img.onload = r; img.src = u; });
      g.drawImage(img, i * W / views.length, 0);
    }
    return cv.toDataURL('image/png');
  }, { geo: rel(geo), tex: rel(tex), W, H });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(out);
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
