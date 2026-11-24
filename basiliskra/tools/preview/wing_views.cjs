#!/usr/bin/env node
// Basiliskra IV's folded wings from behind, above and both sides, posed by the shipped client animation (the offline
// viewer), with a phase given: to see where a wing meets his back.   node tools/preview/wing_views.cjs [phase] [out.png]
const { open, ROOT } = require('./render.cjs');
const fs = require('fs'), path = require('path');
const POSE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/kit/out/pose.json'), 'utf8'));
const phase = process.argv[2] || 'idle', out = process.argv[3] || path.join(ROOT, 'build/wings.png');
(async () => {
  const s = await open();
  const url = await s.page.evaluate(async ({ ph, charge }) => {
    const BK = window.BK;
    await BK.loadForm('iv', { geo: '/packs/RP/models/entity/basiliskra_iv.geo.json', tex: '/packs/RP/textures/entity/basiliskra/basiliskra_iv.png', glow: '/packs/RP/textures/entity/basiliskra/basiliskra_iv_glow.png' });
    await BK.makeAnimator('iv', { entity: '/packs/RP/entity/basiliskra.entity.json', animations: ['/packs/RP/animations/basiliskra.animation.json'], controllers: ['/packs/RP/animation_controllers/basiliskra.animation_controllers.json'], renderControllers: ['/packs/RP/render_controllers/basiliskra.render_controllers.json'] });
    const a = BK.models.iv.animator;
    for (const [k, v] of Object.entries({ form: 4, bound: true, phase: ph, charge, look_yaw: 0, look_pitch: 0, bend: 0, pitch: 0, gait: 1, gill: false, fx_kind: 0, fx_seq: 0, tier: 3, vis_lo: 0, vis_hi: 8 })) a.setProperty('basiliskra:' + k, v);
    for (let i = 0; i < 60; i++) a.update(1 / 30);
    BK.models.iv.holder.updateMatrixWorld(true);
    const c = BK.bonePos('iv', 'chest');
    const views = [[[0, c[1] + 6, 30], 'behind'], [[26, c[1] + 4, 4], 'his left'], [[-26, c[1] + 4, 4], 'his right'], [[0, c[1] + 30, 12], 'above, behind']];
    const W = 1920, H = 1080, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    for (let i = 0; i < 4; i++) {
      const [d, label] = views[i];
      const u = BK.shot(W / 2, H / 2, { pos: [c[0] + d[0], d[1], c[2] + d[2]], target: [c[0], c[1] - 2, c[2] + 2], fov: 55 }, '#1d2347');
      const img = new Image(); await new Promise((r) => { img.onload = r; img.src = u; });
      g.drawImage(img, (i % 2) * W / 2, Math.floor(i / 2) * H / 2);
      g.fillStyle = '#fff'; g.font = '22px sans-serif'; g.fillText(label, (i % 2) * W / 2 + 12, Math.floor(i / 2) * H / 2 + 28);
    }
    return cv.toDataURL('image/png');
  }, { ph: POSE.phase[phase], charge: phase === 'charge' || phase === 'fire' ? 18 : 0 });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64')); console.log(out);
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
