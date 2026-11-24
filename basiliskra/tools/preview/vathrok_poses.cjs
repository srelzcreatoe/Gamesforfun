#!/usr/bin/env node
// Vathrok (2.0) through its moves, posed by its shipped client entity and animation in the offline viewer: one still
// per row of MOVES.   node tools/preview/vathrok_poses.cjs [out.png] [--cam yaw] [--size 480x400]
const { open, ROOT, arg } = require('./render.cjs');
const fs = require('fs'), path = require('path');
const POSE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/kit/out/pose.json'), 'utf8'));
const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(ROOT, 'build/vathrok_poses.png');
const camYaw = parseFloat(arg(process.argv, 'cam', '60'));
const [CW, CH] = arg(process.argv, 'size', '480x400').split('x').map(Number);
// label, phase, seconds into it, properties
const MOVES = [
  ['standing', 'idle', 1.5, {}],
  ['walking', 'move', 1.2, { walk: 3.0 }],
  ['roar', 'roar', 1.2, {}],
  ['charging', 'charge', 2.5, { charge: 14 }],
  ['breath', 'fire', 1.0, { charge: 20 }],
  ['bite: drawn back', 'bite', 0.32, { look_yaw: 0 }],
  ['bite: struck', 'bite', 0.5, { look_yaw: 0 }],
  ['claws: raised', 'swipe', 0.45, { look_yaw: 40 }],
  ['claws: rake', 'swipe', 0.65, { look_yaw: 40 }],
  ['tail: wound', 'sweep', 0.5, { look_yaw: 70 }],
  ['tail: lash', 'sweep', 0.75, { look_yaw: 70 }],
  ['staggered', 'recoil', 0.4, {}],
  ['beaten', 'fall', 2.6, {}],
];
(async () => {
  const s = await open();
  const url = await s.page.evaluate(async ({ MOVES, PH, camYaw, CW, CH }) => {
    const BK = window.BK;
    await BK.loadForm('v', { geo: '/packs/RP/models/entity/vathrok.geo.json', tex: '/packs/RP/textures/entity/basiliskra/vathrok.png', glow: '/packs/RP/textures/entity/basiliskra/vathrok_glow.png' });
    await BK.makeAnimator('v', { entity: '/packs/RP/entity/vathrok.entity.json', animations: ['/packs/RP/animations/basiliskra.animation.json'], controllers: ['/packs/RP/animation_controllers/basiliskra.animation_controllers.json'], renderControllers: ['/packs/RP/render_controllers/basiliskra.render_controllers.json'] });
    const m = BK.models.v, a = m.animator;
    const cols = 4, rows = Math.ceil(MOVES.length / cols);
    const cv = document.createElement('canvas'); cv.width = CW * cols; cv.height = CH * rows;
    const g = cv.getContext('2d');
    for (let i = 0; i < MOVES.length; i++) {
      const [label, ph, t, props] = MOVES[i];
      for (const [k, v] of Object.entries({ form: 5, bound: true, phase: 0, charge: 0, look_yaw: 0, look_pitch: 0, bend: 0, pitch: 0, gait: 1, gill: false, fx_kind: 0, fx_seq: 0, tier: 3, vis_lo: 0, vis_hi: 8 })) a.setProperty('basiliskra:' + k, v);
      a.state.distance = 0; a.state.speed = 0;
      for (let j = 0; j < 45; j++) a.update(1 / 30);
      a.setProperty('basiliskra:phase', PH[ph]);
      for (const [k, v] of Object.entries(props)) if (k !== 'walk') a.setProperty('basiliskra:' + k, v);
      const n = Math.round(t * 30);
      let dist = 0;
      for (let j = 0; j < n; j++) {
        if (props.walk) { dist += props.walk / 30; a.state.distance = dist; a.state.speed = props.walk / 20; if (Math.floor(dist / 2.975) !== Math.floor((dist - props.walk / 30) / 2.975)) a.setProperty('basiliskra:gait', (Math.floor(dist / 2.975)) & 3); }
        a.update(1 / 30);
      }
      m.holder.updateMatrixWorld(true);
      const c = BK.bonePos('v', 'body'), r = camYaw * Math.PI / 180;
      const u = BK.shot(CW, CH, { pos: [c[0] + Math.sin(r) * 52, c[1] + 10, c[2] - Math.cos(r) * 52], target: [c[0], c[1] - 2, c[2] - 6], fov: 50 }, '#1d2347');
      const img = new Image(); await new Promise((res) => { img.onload = res; img.src = u; });
      g.drawImage(img, (i % cols) * CW, Math.floor(i / cols) * CH);
      g.fillStyle = '#fff'; g.font = '20px sans-serif'; g.fillText(`${label} (${t} s)`, (i % cols) * CW + 10, Math.floor(i / cols) * CH + 26);
    }
    return cv.toDataURL('image/png');
  }, { MOVES, PH: POSE.phase, camYaw, CW, CH });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64')); console.log(out);
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
