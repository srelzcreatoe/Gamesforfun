#!/usr/bin/env node
// Renders an encounter preview from a replay.
//   node scenes.cjs <arrival|window|beam> [--size 1280x720] [--fps 30] [--from s] [--to s]
//   node scenes.cjs <name> --stills 2,6.5,11 [--size 960x540]      a contact sheet instead of a video
const { open, ROOT, arg } = require('./render.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FILES = {
  geo: '/packs/RP/models/entity/basiliskra_%.geo.json',
  tex: '/packs/RP/textures/entity/basiliskra/basiliskra_%.png',
  glow: '/packs/RP/textures/entity/basiliskra/basiliskra_%_glow.png',
  client: {
    entity: '/packs/RP/entity/basiliskra.entity.json',
    animations: ['/packs/RP/animations/basiliskra.animation.json'],
    controllers: ['/packs/RP/animation_controllers/basiliskra.animation_controllers.json'],
    renderControllers: ['/packs/RP/render_controllers/basiliskra.render_controllers.json'],
  },
};

async function main() {
  const args = process.argv.slice(2), name = args[0];
  const [W, H] = arg(args, 'size', '1280x720').split('x').map(Number);
  const fps = parseFloat(arg(args, 'fps', '30'));
  const stills = arg(args, 'stills', null);
  const outDir = path.join(ROOT, 'build/previews');
  fs.mkdirSync(outDir, { recursive: true });
  const particleFiles = fs.readdirSync(path.join(ROOT, 'packs/RP/particles')).filter((f) => f.endsWith('.json')).map((f) => '/packs/RP/particles/' + f);
  const s = await open();
  const info = await s.page.evaluate(([n, pf, files]) => window.BK.openScene(n, pf, files), [name, particleFiles, FILES]);
  if (info.missing.length) console.error('missing bones:', info.missing);
  const from = parseFloat(arg(args, 'from', '0')), to = Math.min(parseFloat(arg(args, 'to', '1e9')), info.duration);
  const dt = 1 / fps;
  if (stills) {
    const times = stills.split(',').map(Number).sort((a, b) => a - b);
    const shots = [];
    let t = 0, i = 0;
    while (i < times.length && t < info.duration) {
      t += dt;
      const draw = t >= times[i] - 1e-9;
      const r = await s.page.evaluate(([d, w, h, dr]) => window.BK.sceneFrame(d, w, h, dr, 'image/png'), [dt, W, H, draw]);
      if (draw) { shots.push([times[i], r.url]); i++; }
    }
    const out = arg(args, 'out', path.join(outDir, `${name}_stills.png`));
    const cols = parseInt(arg(args, 'cols', '2'), 10);
    const url = await s.page.evaluate(async ([shots, W, H, cols]) => {
      const cv = document.createElement('canvas'); cv.width = W * cols; cv.height = H * Math.ceil(shots.length / cols);
      const g = cv.getContext('2d');
      for (let i = 0; i < shots.length; i++) {
        const img = new Image(); await new Promise((r) => { img.onload = r; img.src = shots[i][1]; });
        const x = (i % cols) * W, y = Math.floor(i / cols) * H;
        g.drawImage(img, x, y);
        g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x, y, 120, 26); g.fillStyle = '#fff'; g.font = '18px monospace'; g.fillText('t=' + shots[i][0].toFixed(1) + 's', x + 8, y + 19);
      }
      return cv.toDataURL('image/png');
    }, [shots, W, H, cols]);
    fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    console.log(out);
    await s.close();
    return;
  }
  const silent = path.join(outDir, `${name}_silent.mp4`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  const cams = [];
  let t = 0, n = 0;
  const started = Date.now();
  while (t + dt <= to + 1e-9) {
    t += dt;
    const draw = t >= from;
    const r = await s.page.evaluate(([d, w, h, dr]) => window.BK.sceneFrame(d, w, h, dr), [dt, W, H, draw]);
    if (!draw) continue;
    cams.push({ t: +(t - from).toFixed(4), pos: r.cam.pos.map((v) => +v.toFixed(2)), fwd: r.cam.fwd.map((v) => +v.toFixed(3)), under: r.cam.under });
    if (!ff.stdin.write(Buffer.from(r.url.split(',')[1], 'base64'))) await new Promise((res) => ff.stdin.once('drain', res));
    if (++n % 150 === 0) console.log(`${name}: ${n} frames, ${(n / ((Date.now() - started) / 1000)).toFixed(1)} fps`);
  }
  ff.stdin.end();
  await done;
  fs.writeFileSync(path.join(outDir, `${name}.cam.json`), JSON.stringify({ name, fps, from, frames: n, cams }));
  console.log(`${silent}: ${n} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  await s.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
