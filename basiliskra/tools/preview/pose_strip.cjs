#!/usr/bin/env node
// A strip of stills of Basiliskra IV (or the Titan) through one phase, posed by the shipped client animation in the
// offline viewer: to look at a move.  node tools/preview/pose_strip.cjs <phase> <seconds,...> [out.png] [--look yaw,pitch] [--cam yaw]
const { open, ROOT, arg } = require('./render.cjs');
const fs = require('fs'), path = require('path');
const POSE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/kit/out/pose.json'), 'utf8'));
const phase = process.argv[2], times = process.argv[3].split(',').map(Number);
const out = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : path.join(ROOT, `build/strip_${phase}.png`);
const look = arg(process.argv, 'look', '0,0').split(',').map(Number), camYaw = parseFloat(arg(process.argv, 'cam', '25'));
(async () => {
  const s = await open();
  const url = await s.page.evaluate(async ({ ph, times, look, camYaw }) => {
    const BK = window.BK;
    await BK.loadForm('iv', { geo: '/packs/RP/models/entity/basiliskra_iv.geo.json', tex: '/packs/RP/textures/entity/basiliskra/basiliskra_iv.png', glow: '/packs/RP/textures/entity/basiliskra/basiliskra_iv_glow.png' });
    await BK.makeAnimator('iv', { entity: '/packs/RP/entity/basiliskra.entity.json', animations: ['/packs/RP/animations/basiliskra.animation.json'], controllers: ['/packs/RP/animation_controllers/basiliskra.animation_controllers.json'], renderControllers: ['/packs/RP/render_controllers/basiliskra.render_controllers.json'] });
    const a = BK.models.iv.animator;
    const W = 480 * times.length, H = 640, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    for (let i = 0; i < times.length; i++) {
      for (const [k, v] of Object.entries({ form: 4, bound: true, phase: 0, charge: 0, look_yaw: 0, look_pitch: 0, bend: 0, pitch: 0, gait: 1, gill: false, fx_kind: 0, fx_seq: 0, tier: 3, vis_lo: 0, vis_hi: 8 })) a.setProperty('basiliskra:' + k, v);
      for (let j = 0; j < 45; j++) a.update(1 / 30);
      a.setProperty('basiliskra:phase', ph); a.setProperty('basiliskra:look_yaw', look[0]); a.setProperty('basiliskra:look_pitch', look[1]);
      const n = Math.round(times[i] * 30);
      for (let j = 0; j < n; j++) a.update(1 / 30);
      BK.models.iv.holder.updateMatrixWorld(true);
      const c = BK.bonePos('iv', 'chest'), r = camYaw * Math.PI / 180;
      const u = BK.shot(480, H, { pos: [c[0] + Math.sin(r) * 42, c[1] + 2, c[2] - Math.cos(r) * 42], target: [c[0], c[1] - 4, c[2]], fov: 60 }, '#1d2347');
      const img = new Image(); await new Promise((res) => { img.onload = res; img.src = u; });
      g.drawImage(img, i * 480, 0);
      g.fillStyle = '#fff'; g.font = '22px sans-serif'; g.fillText(`${times[i]} s`, i * 480 + 12, 30);
    }
    return cv.toDataURL('image/png');
  }, { ph: POSE.phase[phase], times, look, camYaw });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64')); console.log(out);
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
