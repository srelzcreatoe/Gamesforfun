#!/usr/bin/env node
// Turnaround of one model on its own: stills from named angles, and a turntable as numbered frames.
//   node turn.cjs <i|ii|iii|iv> --out DIR [--frames 72] [--glow 0] [--night] [--size 1280x800] [--stills]
// Stills: back, front, left side, right side, and two three-quarter views, on a plain pale ground.
const fs = require('fs');
const path = require('path');
const { open, FORM_FILES, arg } = require('./render.cjs');

(async () => {
  const args = process.argv.slice(2);
  const form = args[0];
  const out = arg(args, 'out', path.join(__dirname, '../../build/turn_' + form));
  const [W, H] = arg(args, 'size', '1280x800').split('x').map(Number);
  const frames = parseInt(arg(args, 'frames', '72'), 10);
  const glow = parseFloat(arg(args, 'glow', '0'));
  const night = args.includes('--night');
  const stillsOnly = args.includes('--stills');
  fs.mkdirSync(out, { recursive: true });
  const s = await open();
  await s.page.evaluate(async ({ form, files, glow, night }) => {
    const BK = window.BK;
    await BK.loadForm(form, files);
    BK.setGlow(form, glow);
    if (night) { BK.env.uLight.value.set(0.30, 0.34, 0.5); BK.env.uAmbient.value.set(0.16, 0.17, 0.25); }
    const b = BK.bounds(form);
    const d = BK.Stage.playerDummy();
    d.position.set(b.min[0] * 0.35, 0, b.min[2] - 3);        // a player, standing in front of him, for scale
    BK.scene.add(d);
  }, { form, files: FORM_FILES(form), glow, night });
  const shoot = async (file, yaw, pitch, k = 1.0, bg = null) => {
    const url = await s.page.evaluate(({ form, yaw, pitch, k, W, H, bg, night }) => {
      const BK = window.BK, b = BK.bounds(form);
      const t = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      const R = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180, dist = R * 1.5 * k;
      // yaw 0: the camera stands on his left; 90: in front of him; 180: on his right; 270: behind him
      const dir = [-Math.cos(y) * Math.cos(p), Math.sin(p), -Math.sin(y) * Math.cos(p)];
      return BK.shot(W, H, { pos: [t[0] + dir[0] * dist, t[1] + dir[1] * dist, t[2] + dir[2] * dist], target: t, fov: 34 }, bg ?? (night ? '#0b1020' : '#efe6dc'));
    }, { form, yaw, pitch, k, W, H, bg, night });
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  };
  const named = [['back', 270, 4, 1.0], ['front', 90, 4, 1.0], ['side', 0, 4, 1.0], ['side_right', 180, 4, 1.0], ['three_quarter', 62, 10, 0.95], ['rear_quarter', 235, 14, 0.95]];
  for (const [name, yaw, pitch, k] of named) await shoot(path.join(out, `${name}.png`), yaw, pitch, k);
  if (!stillsOnly) {
    for (let i = 0; i < frames; i++) {
      await shoot(path.join(out, `f${String(i).padStart(4, '0')}.png`), 90 + (i / frames) * 360, 8, 1.0);
      if (i % 12 === 0) console.log(`frame ${i}/${frames}`);
    }
  }
  console.log(out);
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
