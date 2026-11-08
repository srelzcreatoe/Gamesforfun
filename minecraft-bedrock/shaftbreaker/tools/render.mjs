#!/usr/bin/env node
// Headless renderer for the Shaftbreaker add-on (uses the real RP files).
//
//   node tools/render.mjs views   --anim <name|none> [--t 0] [--views front,right,back,threequarter] [--size 512] --out f.png
//   node tools/render.mjs strip   --anim <name> [--frames 8] [--from 0] [--to <len>] [--view right] [--size 384] --out f.png
//   node tools/render.mjs compare --anim <name|none> [--t 0] --ref stalk_full.png [--azimuth 35] [--elevation 5] --out f.png
//   node tools/render.mjs video   --plan tools/preview_plan.json --out preview/shaftbreaker_preview.mp4
//   common: --bg studio|mine  --query "query.modified_move_speed=1,variable.x=2"  --prop "shaftbreaker:phase=stalking"
//           --debug-bones  --distance 7.5 --elevation 8 --fov 35 --target 0,1.55,0
//           --geo/--texture/--anims to override files (paths relative to the add-on root)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RP = 'Shaftbreaker_RP';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s.startsWith('--')) {
      const k = s.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      a[k] = v;
    } else a._.push(s);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

function listAnimFiles() {
  const dir = path.join(ROOT, RP, 'animations');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => `/${RP}/animations/${f}`);
}
function kv(str, conv) {
  const out = {};
  if (!str || str === true) return out;
  for (const part of String(str).split(',')) {
    const i = part.lastIndexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = conv ? conv(v) : v;
  }
  return out;
}
const num = (v) => (isNaN(Number(v)) ? v : Number(v));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function openViewer(init) {
  const { chromium } = require('playwright');
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: init.width, height: init.height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/tools/viewer/index.html`);
  await page.waitForFunction(() => window.__sbReady === true, null, { timeout: 30000 }).catch(() => {
    throw new Error('viewer failed to load: ' + errors.join('\n'));
  });
  const info = await page.evaluate((c) => window.sb.init(c), init).catch((e) => {
    throw new Error('init failed: ' + e.message + '\n' + errors.join('\n'));
  });
  return { page, browser, srv, info, errors };
}

function baseInit(extra = {}) {
  return {
    geo: '/' + (args.geo || `${RP}/models/entity/shaftbreaker.geo.json`),
    texture: '/' + (args.texture || `${RP}/textures/entity/shaftbreaker.png`),
    geoId: args['geo-id'],
    animations: args.anims === undefined ? listAnimFiles() : args.anims === true ? [] : String(args.anims).split(',').filter(Boolean).map((s) => '/' + s),
    background: args.bg || 'studio',
    scale: args.scale ? Number(args.scale) : 0.58,
    emissive: args['no-emissive'] ? false : true,
    fov: args.fov ? Number(args.fov) : 35,
    ...(args.lights ? kv(args.lights, num) : {}),
    ...extra,
  };
}

function frameOpts(t, cam) {
  const layers = [];
  if (args.anim && args.anim !== 'none' && args.anim !== true) {
    for (const spec of String(args.anim).split('+')) {
      const [name, w] = spec.split('@');
      layers.push({ anim: name, time: t, weight: w ? Number(w) : 1, hold: true });
    }
  }
  return {
    layers,
    lifeTime: t,
    query: kv(args.query, num),
    properties: kv(args.prop),
    camera: {
      distance: args.distance ? Number(args.distance) : undefined,
      elevation: args.elevation !== undefined ? Number(args.elevation) : undefined,
      target: args.target ? String(args.target).split(',').map(Number) : undefined,
      fov: args.fov ? Number(args.fov) : undefined,
      ...cam,
    },
    debugBones: !!args['debug-bones'],
    events: false,
  };
}

async function composeSheet(page, tiles, cols, tileW, tileH, title) {
  return page.evaluate(
    async ({ tiles, cols, tileW, tileH, title }) => {
      const rows = Math.ceil(tiles.length / cols);
      const head = title ? 28 : 0;
      const c = document.createElement('canvas');
      c.width = cols * tileW;
      c.height = rows * tileH + head;
      const g = c.getContext('2d');
      g.fillStyle = '#1b1b1b';
      g.fillRect(0, 0, c.width, c.height);
      if (title) {
        g.fillStyle = '#eee';
        g.font = '16px monospace';
        g.fillText(title, 8, 19);
      }
      for (let i = 0; i < tiles.length; i++) {
        const img = new Image();
        img.src = tiles[i].url;
        await img.decode();
        const x = (i % cols) * tileW, y = Math.floor(i / cols) * tileH + head;
        g.drawImage(img, x, y, tileW, tileH);
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(x, y, tileW, 20);
        g.fillStyle = '#fff';
        g.font = '13px monospace';
        g.fillText(tiles[i].label, x + 5, y + 15);
      }
      return c.toDataURL('image/png');
    },
    { tiles, cols, tileW, tileH, title },
  );
}

function writeDataURL(url, out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', out);
}

async function cmdViews() {
  const size = Number(args.size || 512);
  const v = await openViewer(baseInit({ width: size, height: Math.round(size * 1.25) }));
  const views = String(args.views || 'front,threequarter,right,back').split(',');
  const t = Number(args.t || 0);
  const tiles = [];
  for (const view of views) {
    const cam = /^-?\d+$/.test(view) ? { azimuth: Number(view) } : { preset: view };
    await v.page.evaluate((o) => window.sb.frame(o), frameOpts(t, cam));
    tiles.push({ url: await v.page.evaluate(() => window.sb.capture('image/png')), label: `${view}  t=${t}` });
  }
  const sheet = await composeSheet(v.page, tiles, Math.min(tiles.length, Number(args.cols || 4)), size, Math.round(size * 1.25), `${args.anim || 'rest'}  [${v.info.animations.length} anims loaded]`);
  writeDataURL(sheet, args.out || 'views.png');
  if (v.errors.length) console.error('page errors:\n' + v.errors.join('\n'));
  await v.browser.close();
  v.srv.close();
}

async function cmdStrip() {
  const size = Number(args.size || 384);
  const v = await openViewer(baseInit({ width: size, height: Math.round(size * 1.25) }));
  const name = String(args.anim).split('+')[0].split('@')[0];
  const len = await v.page.evaluate(async (n) => {
    const mod = await import('/tools/lib/anim.js');
    return 0; // length resolved below
  }, name);
  const animLen = Number(args.to ?? (await animLength(name)));
  const from = Number(args.from || 0);
  const frames = Number(args.frames || 8);
  const view = args.view || 'right';
  const cam = /^-?\d+$/.test(view) ? { azimuth: Number(view) } : { preset: view };
  const tiles = [];
  for (let i = 0; i < frames; i++) {
    const t = from + ((animLen - from) * i) / frames;
    await v.page.evaluate((o) => window.sb.frame(o), frameOpts(t, cam));
    tiles.push({ url: await v.page.evaluate(() => window.sb.capture('image/png')), label: `t=${t.toFixed(2)}` });
  }
  const sheet = await composeSheet(v.page, tiles, Math.min(frames, Number(args.cols || 4)), size, Math.round(size * 1.25), `${args.anim}  view=${view}`);
  writeDataURL(sheet, args.out || 'strip.png');
  if (v.errors.length) console.error('page errors:\n' + v.errors.join('\n'));
  await v.browser.close();
  v.srv.close();
  void len;
}

async function animLength(name) {
  const { animationLength } = await import('./lib/anim.js');
  for (const f of listAnimFiles()) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    if (j.animations && j.animations[name]) return animationLength(j.animations[name]);
  }
  throw new Error('animation not found: ' + name);
}

async function cmdCompare() {
  const refPath = path.join(ROOT, 'tools/reference', String(args.ref));
  const size = Number(args.size || 512);
  const v = await openViewer(baseInit({ width: size, height: Math.round(size * 1.25) }));
  const t = Number(args.t || 0);
  const cam = { azimuth: Number(args.azimuth || 0) };
  await v.page.evaluate((o) => window.sb.frame(o), frameOpts(t, cam));
  const tiles = [
    { url: 'data:image/png;base64,' + fs.readFileSync(refPath).toString('base64'), label: 'concept: ' + args.ref },
    { url: await v.page.evaluate(() => window.sb.capture('image/png')), label: `model ${args.anim || 'rest'} t=${t} az=${cam.azimuth}` },
  ];
  const sheet = await composeSheet(v.page, tiles, 2, size, Math.round(size * 1.25), 'reference vs model');
  writeDataURL(sheet, args.out || 'compare.png');
  if (v.errors.length) console.error('page errors:\n' + v.errors.join('\n'));
  await v.browser.close();
  v.srv.close();
}

// ---------------------------------------------------------------- video
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
function lerpObj(a = {}, b = {}, t) {
  const out = { ...a };
  for (const [k, vb] of Object.entries(b)) {
    const va = a[k];
    if (typeof vb === 'number' && typeof va === 'number') out[k] = lerp(va, vb, t);
    else if (Array.isArray(vb) && Array.isArray(va)) out[k] = vb.map((x, i) => lerp(va[i], x, t));
    else out[k] = vb;
  }
  return out;
}
function shotLayers(shot, st) {
  return (shot.layers || []).map((L, i) => ({
    anim: L.anim,
    id: `${shot.name || ''}#${i}`,
    time: (L.offset || 0) + st * (L.speed ?? 1),
    weight: L.weight ?? 1,
    hold: L.hold,
  }));
}

async function cmdVideo() {
  const plan = JSON.parse(fs.readFileSync(path.resolve(String(args.plan)), 'utf8'));
  const fps = plan.fps || 30;
  const W = plan.width || 1280, H = plan.height || 720;
  const v = await openViewer(baseInit({ width: W, height: H, background: plan.background || 'mine', bloom: plan.bloom ?? true, fov: plan.fov || 35, exposure: plan.exposure || 1.0, glow: plan.glow || 1.0, bloomStrength: plan.bloomStrength, bloomThreshold: plan.bloomThreshold, ...(plan.lights || {}) }));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbvid-'));
  let frame = 0, life = 0;
  // --shot N or --shots 0-7,16 renders a subset (for parallel rendering; concat the parts afterwards)
  const sel = args.shots !== undefined || args.shot !== undefined
    ? new Set(String(args.shots ?? args.shot).split(',').flatMap((r) => { const [a, b] = r.split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); }))
    : null;
  for (let si = 0; si < plan.shots.length; si++) {
    const shot = plan.shots[si];
    if (sel && !sel.has(si)) continue;
    const prev = plan.shots[si - 1];
    await v.page.evaluate(() => window.sb.resetEvents());
    const nF = Math.round(shot.duration * fps);
    for (let f = 0; f < nF; f++) {
      const st = f / fps;
      const u = shot.duration > 0 ? st / shot.duration : 0;
      const ce = shot.cameraEase === 'linear' ? u : smooth(u);
      let layers = shotLayers(shot, st);
      if (shot.blendIn && prev && st < shot.blendIn) {
        const w = smooth(st / shot.blendIn);
        const pl = shotLayers(prev, prev.duration + st).map((l) => ({ ...l, weight: l.weight * (1 - w) }));
        layers = [...pl, ...layers.map((l) => ({ ...l, weight: l.weight * w }))];
      }
      const ent = lerpObj(shot.entity?.from || shot.entity || {}, shot.entity?.to || shot.entity?.from || shot.entity || {}, shot.entityEase === 'smooth' ? smooth(u) : u);
      const cam = lerpObj(shot.camera?.from || {}, shot.camera?.to || shot.camera?.from || {}, ce);
      let title = null;
      if (shot.title) {
        const tin = shot.title.in ?? 0.4, tout = shot.title.out ?? shot.duration - 0.4;
        const a = st < tin ? 0 : st < tin + 0.6 ? (st - tin) / 0.6 : st < tout ? 1 : st < tout + 0.6 ? 1 - (st - tout) / 0.6 : 0;
        title = { ...shot.title, alpha: Math.max(0, Math.min(1, a)) * (shot.title.alpha ?? 1) };
      }
      const wall = shot.wall ? { x: shot.wall.x, z: shot.wall.z, progress: lerp(shot.wall.progressFrom ?? 0, shot.wall.progressTo ?? 1, Math.max(0, Math.min(1, (st - (shot.wall.start || 0)) / ((shot.wall.end || shot.duration) - (shot.wall.start || 0))))) } : null;
      const query = { ...(shot.query || {}) };
      for (const [k, val] of Object.entries(shot.queryRamp || {})) query[k] = lerp(val[0], val[1], u);
      await v.page.evaluate((o) => window.sb.frame(o), {
        layers, lifeTime: life, dt: 1 / fps, query, properties: shot.properties || {},
        entity: ent, camera: cam, title, wall, events: true,
      });
      // global fades
      const fadeIn = si === 0 ? Math.min(1, st / 0.8) : 1;
      const fadeOut = si === plan.shots.length - 1 ? Math.min(1, (shot.duration - st) / 1.0) : 1;
      const url = await v.page.evaluate(() => window.sb.capture('image/jpeg', 0.93));
      let buf = Buffer.from(url.split(',')[1], 'base64');
      fs.writeFileSync(path.join(tmp, `f${String(frame).padStart(5, '0')}.jpg`), buf);
      if (fadeIn < 1 || fadeOut < 1) fs.writeFileSync(path.join(tmp, `f${String(frame).padStart(5, '0')}.fade`), String(Math.min(fadeIn, fadeOut)));
      frame++;
      life += 1 / fps;
      if (frame % 30 === 0) process.stdout.write(`\rshot ${si + 1}/${plan.shots.length} frame ${frame}`);
    }
  }
  console.log(`\nrendered ${frame} frames to ${tmp}`);
  if (v.errors.length) console.error('page errors:\n' + v.errors.join('\n'));
  await v.browser.close();
  v.srv.close();
  const out = path.resolve(String(args.out || 'preview.mp4'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // fades via ffmpeg fade filters (first 0.8 s in, last 1 s out)
  const total = frame / fps;
  const fadeInOn = !sel || sel.has(0), fadeOutOn = !sel || sel.has(plan.shots.length - 1);
  const vf = [fadeInOn && `fade=t=in:st=0:d=0.8`, fadeOutOn && `fade=t=out:st=${Math.max(0, total - 1).toFixed(2)}:d=1`].filter(Boolean).join(',') || 'null';
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(tmp, 'f%05d.jpg'), '-vf', vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf || 18), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
  if (ff.status !== 0) throw new Error('ffmpeg failed');
  console.log('wrote', out);
  if (!args.keep) fs.rmSync(tmp, { recursive: true, force: true });
}

const cmds = { views: cmdViews, strip: cmdStrip, compare: cmdCompare, video: cmdVideo };
if (!cmds[cmd]) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n'));
  process.exit(cmd ? 1 : 0);
}
cmds[cmd]().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
