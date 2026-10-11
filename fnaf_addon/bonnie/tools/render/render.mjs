// Headless preview renderer for bonnie.bbmodel (three.js in Chromium via Playwright).
//
//   npm install                       (in this folder: installs three + playwright)
//   node render.mjs stills <outDir>   front / side / back / 3-4 views + animation key poses
//   node render.mjs video  <out.mp4>  turntable + every animation, encoded with ffmpeg
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelDir = path.resolve(here, '..', '..');
const threeDir = path.resolve(process.env.THREE_DIR || path.join(here, 'node_modules', 'three'));
const [mode = 'stills', out = path.join(modelDir, 'preview')] = process.argv.slice(2);
const W = +(process.env.W || 1280), H = +(process.env.H || 720), FPS = +(process.env.FPS || 30);

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.bbmodel': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (url.startsWith('/three/')) file = path.join(threeDir, url.slice(7));
  else if (url.startsWith('/model/')) file = path.join(modelDir, url.slice(7));
  else file = path.join(here, url === '/' ? 'preview.html' : url.slice(1));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', e => console.error('[page error]', e.message));
await page.goto(`http://localhost:${port}/preview.html?w=${W}&h=${H}`);
await page.waitForFunction(() => window.api);
await page.evaluate(() => window.api.ready);
const anims = await page.evaluate(() => window.api.animations());

async function shot(opts, file) {
  await page.evaluate(o => window.api.frame(o), opts);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
}

const pretty = n => n.replace('animation.bonnie.', '').replace(/_/g, ' ').toUpperCase().replace(/(\D)(\d)$/, '$1 $2');

if (mode === 'stills') {
  fs.mkdirSync(out, { recursive: true });
  const T = [0, 26, 0];
  const views = {
    front: { az: 0, el: 4, dist: 200, target: T, fov: 28 },
    side: { az: 90, el: 4, dist: 200, target: T, fov: 28 },
    back: { az: 180, el: 4, dist: 200, target: T, fov: 28 },
    three_quarter: { az: 32, el: 10, dist: 175, target: [0, 28, 0], fov: 30 },
    face: { az: 0, el: 2, dist: 70, target: [0, 39, -4], fov: 22 },
  };
  for (const [name, cam] of Object.entries(views)) {
    await shot({ cam, text: { label: name.replace('_', ' ').toUpperCase() + ' VIEW' } }, path.join(out, `view_${name}.png`));
  }
  const animCam = process.env.CAM ? JSON.parse(process.env.CAM) : { az: 30, el: 8, dist: 190, target: T, fov: 30 };
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const a of anims) {
    if (only && !only.includes(a.name.replace('animation.bonnie.', ''))) continue;
    const times = (process.env.TIMES || '0.25,0.5').split(',').map(Number);
    for (const f of times) {
      const t = a.length * f;
      await shot({ anim: a.name, time: t, cam: animCam, text: { label: pretty(a.name), sublabel: `t = ${t.toFixed(2)}s` } },
        path.join(out, `anim_${a.name.replace('animation.bonnie.', '')}_${Math.round(f * 100)}.png`));
    }
  }
} else if (mode === 'shots') {
  // SHOTS=<json file>: [{file, anim, time, cam}] rendered without overlays
  fs.mkdirSync(out, { recursive: true });
  for (const sh of JSON.parse(fs.readFileSync(process.env.SHOTS, 'utf8'))) {
    await shot({ anim: sh.anim || null, time: sh.time || 0, cam: sh.cam, text: { showTitle: false } }, path.join(out, sh.file));
  }
} else if (mode === 'video') {
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'bonnie-frames-'));
  const byName = Object.fromEntries(anims.map(a => [a.name.replace('animation.bonnie.', ''), a]));
  // timeline: [clip, seconds, camera(t, u) -> cam, sublabel]
  const order = (process.env.CLIPS || 'idle,walk,run,pose1,pose2,performance1,performance2').split(',');
  const segs = [{ clip: null, secs: 6, label: 'MODEL TURNAROUND', sub: '3/4 VIEW', cam: u => ({ az: 32 + 360 * u, el: 9, dist: 165, target: [0, 28, 0], fov: 30 }) }];
  const camFor = {
    walk: u => ({ az: 55 - 40 * u, el: 8, dist: 160, target: [0, 27, 0], fov: 30 }),
    run: u => ({ az: 70 - 40 * u, el: 8, dist: 160, target: [0, 27, 0], fov: 30 }),
  };
  const face = u => ({ az: 18 - 36 * u, el: 4, dist: 92, target: [-7, 39, -3], fov: 24 });
  if (byName.idle) segs.push({ clip: byName.idle.name, secs: 3, label: 'FACE DETAIL (NORMAL)', sub: 'CLOSE-UP', cam: face });
  if (byName.performance1) segs.push({ clip: byName.performance1.name, secs: 3, label: 'FACE DETAIL (PERFORMANCE)', sub: 'CLOSE-UP', cam: face });
  const secsFor = { idle: 5, performance1: 6, performance2: 6 };
  for (const c of order) {
    if (!byName[c]) continue;
    const secs = secsFor[c] || 4;
    segs.push({ clip: byName[c].name, secs, label: pretty(byName[c].name), sub: 'ANIMATION PREVIEW', cam: camFor[c] || (u => ({ az: 40 - 50 * u, el: 9, dist: 155, target: [0, 28, 0], fov: 30 })) });
  }
  let n = 0;
  let prev = null;
  for (const s of segs) {
    const total = Math.round(s.secs * FPS);
    for (let i = 0; i < total; i++) {
      const t = i / FPS, u = i / total;
      const blendW = prev && prev.clip ? Math.min(1, t / 0.35) : 1;
      const opts = { anim: s.clip, time: t, cam: s.cam(u), text: { label: s.label, sublabel: s.sub } };
      if (blendW < 1) Object.assign(opts, { blendFrom: prev.clip, blendTime: prev.secs + t, blendW });
      await shot(opts, path.join(frames, `f${String(n++).padStart(5, '0')}.png`));
    }
    prev = s;
    process.stdout.write(`rendered ${s.label} (${n} frames)\n`);
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: 'inherit' });
  fs.rmSync(frames, { recursive: true, force: true });
  console.log('wrote', out);
}

await browser.close();
server.close();
