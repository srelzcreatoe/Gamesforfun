#!/usr/bin/env node
// Basiliskra IV's hands at rest, close up, in the offline viewer (shipped geometry and textures): from the front, so
// the hands show edge-on (palms turned in toward each other), and from his left, where the back of the hand shows.
//   node tools/preview/hands.cjs [out.png] [--size 1920x720]
const { open, ROOT, arg } = require('./render.cjs');
const fs = require('fs');
const path = require('path');
(async () => {
  const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(ROOT, 'previews/form_iv_hands.png');
  const [W, H] = arg(process.argv, 'size', '1920x720').split('x').map(Number);
  const s = await open();
  const url = await s.page.evaluate(async ({ W, H }) => {
    const BK = window.BK;
    await BK.loadForm('iv', { geo: '/packs/RP/models/entity/basiliskra_iv.geo.json', tex: '/packs/RP/textures/entity/basiliskra/basiliskra_iv.png', glow: '/packs/RP/textures/entity/basiliskra/basiliskra_iv_glow.png' });
    BK.setGlow('iv', 0.8);
    const l = BK.bonePos('iv', 'hand_l'), r = BK.bonePos('iv', 'hand_r');
    const mid = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2 - 2.5, (l[2] + r[2]) / 2 - 1.5];
    const views = [
      { label: 'from the front: palms turned in, toward each other', cam: { pos: [mid[0], mid[1] + 1.5, mid[2] - 30], target: mid, fov: 40 } },
      { label: 'his left hand from his left: the back of the hand out, the palm in', cam: { pos: [l[0] - 8, l[1] - 9, l[2] - 14], target: [l[0], l[1] - 3, l[2] - 1.5], fov: 50 } },
    ];
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    for (let i = 0; i < views.length; i++) {
      const u = BK.shot(W / views.length, H, views[i].cam, '#1d2347');
      const img = new Image(); await new Promise((res) => { img.onload = res; img.src = u; });
      g.drawImage(img, i * W / views.length, 0);
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(i * W / views.length, H - 34, W / views.length, 34);
      g.fillStyle = '#fff'; g.font = '20px sans-serif'; g.fillText(views[i].label, i * W / views.length + 12, H - 11);
    }
    return cv.toDataURL('image/png');
  }, { W, H });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(out);
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
