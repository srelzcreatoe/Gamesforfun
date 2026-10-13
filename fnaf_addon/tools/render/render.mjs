// Headless preview renderer for the FNAF .bbmodel files (three.js in Chromium via Playwright).
//
//   npm install                                    (in this folder: installs three + playwright)
//   node render.mjs <character> video  [out.mp4]   turnaround, close-ups and every animation (ffmpeg)
//   node render.mjs <character> stills [outDir]    reference views + animation key poses
//   node render.mjs <character> shots  <outDir>    SHOTS=<json file>: [{file, anim, time, cam}], no overlays
//
// <character> is a folder under fnaf_addon/ with a matching configs/<character>.json.
// Camera values in the config may be [start, end] pairs, interpolated across a segment.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const [character, mode = 'stills', outArg] = process.argv.slice(2);
if (!character) throw new Error('usage: node render.mjs <character> video|stills|shots [out]');
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'configs', `${character}.json`), 'utf8'));
const modelDir = path.resolve(process.env.MODEL_DIR || path.join(here, '..', '..', character));
const threeDir = path.resolve(process.env.THREE_DIR || path.join(here, 'node_modules', 'three'));
const W = +(process.env.W || 1280), H = +(process.env.H || 720), FPS = +(process.env.FPS || 30);
const prefix = `animation.${character}.`;

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
const q = new URLSearchParams({
  w: W, h: H, title: cfg.title, subtitle: cfg.subtitle || '', theme: cfg.theme || 'studio',
  model: `/model/${character}.bbmodel`, emissive: `/model/textures/${character}_emissive.png`,
});
await page.goto(`http://localhost:${port}/preview.html?${q}`);
await page.waitForFunction(() => window.api);
await page.evaluate(() => window.api.ready);
const anims = await page.evaluate(() => window.api.animations());
const byName = Object.fromEntries(anims.map(a => [a.name.replace(prefix, ''), a]));

async function shot(opts, file) {
  await page.evaluate(o => window.api.frame(o), opts);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
}

// a camera whose numeric values (or target) may be [start, end] pairs
function camAt(cam, u) {
  const out = {};
  for (const [k, v] of Object.entries(cam)) {
    if (k === 'target') out[k] = Array.isArray(v[0]) ? v[0].map((a, i) => a + (v[1][i] - a) * u) : v;
    else out[k] = Array.isArray(v) ? v[0] + (v[1] - v[0]) * u : v;
  }
  return out;
}

const pretty = n => n.replace(/_/g, ' ').toUpperCase().replace(/(\D)(\d)$/, '$1 $2');

if (mode === 'stills') {
  const out = outArg || path.join(modelDir, 'preview', 'stills');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, cam] of Object.entries(cfg.views)) {
    await shot({ cam, text: { label: pretty(name) + ' VIEW' } }, path.join(out, `view_${name}.png`));
  }
  const animCam = process.env.CAM ? JSON.parse(process.env.CAM) : cfg.stills_cam;
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const times = (process.env.TIMES || '0.25,0.5').split(',').map(Number);
  for (const [short, a] of Object.entries(byName)) {
    if (only && !only.includes(short)) continue;
    for (const f of times) {
      const t = a.length * f;
      await shot({ anim: a.name, time: t, cam: animCam, text: { label: pretty(short), sublabel: `t = ${t.toFixed(2)}s` } },
        path.join(out, `anim_${short}_${Math.round(f * 100)}.png`));
    }
  }
} else if (mode === 'shots') {
  fs.mkdirSync(outArg, { recursive: true });
  for (const sh of JSON.parse(fs.readFileSync(process.env.SHOTS, 'utf8'))) {
    const anim = sh.anim ? (byName[sh.anim] || { name: sh.anim }).name : null;
    await shot({ anim, time: sh.time || 0, cam: sh.cam, text: { showTitle: false } }, path.join(outArg, sh.file));
  }
} else if (mode === 'video') {
  const out = outArg || path.join(modelDir, 'preview', `${character}_preview.mp4`);
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), `${character}-frames-`));
  const segs = [{ clip: null, secs: cfg.turnaround.secs, label: 'MODEL TURNAROUND', sub: '3/4 VIEW', cam: cfg.turnaround.cam }];
  for (const c of cfg.closeups || []) {
    if (byName[c.clip]) segs.push({ clip: byName[c.clip].name, secs: c.secs, label: c.label, sub: 'CLOSE-UP', cam: c.cam, start: c.start || 0 });
  }
  for (const c of cfg.clips) {
    if (!byName[c.name]) continue;
    segs.push({ clip: byName[c.name].name, secs: c.secs, label: c.label || pretty(c.name), sub: 'ANIMATION PREVIEW', cam: c.cam || cfg.default_cam });
  }
  let n = 0;
  let prev = null;
  for (const s of segs) {
    const total = Math.round(s.secs * FPS);
    for (let i = 0; i < total; i++) {
      const t = i / FPS, u = i / total;
      const blendW = prev && prev.clip ? Math.min(1, t / 0.35) : 1;
      const opts = { anim: s.clip, time: (s.start || 0) + t, cam: camAt(s.cam, u), text: { label: s.label, sublabel: s.sub } };
      if (blendW < 1) Object.assign(opts, { blendFrom: prev.clip, blendTime: (prev.start || 0) + prev.secs + t, blendW });
      await shot(opts, path.join(frames, `f${String(n++).padStart(5, '0')}.png`));
    }
    prev = s;
    process.stdout.write(`rendered ${s.label} (${n} frames)\n`);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: 'inherit' });
  fs.rmSync(frames, { recursive: true, force: true });
  console.log('wrote', out);
}

await browser.close();
server.close();
