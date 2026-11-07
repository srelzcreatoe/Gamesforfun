#!/usr/bin/env node
// Bridge to the REAL Blockbench (https://web.blockbench.net, the same editor used to build
// Minecraft mobs by hand) running headless in Chromium. It imports the add-on's Bedrock files
// exactly like dragging them into Blockbench, so it doubles as an independent check that
// Blockbench parses the geometry/texture/animations correctly.
//
//   node tools/blockbench.mjs bbmodel [--out Shaftbreaker.bbmodel]
//        -> editable Blockbench project (model + embedded texture + every animation)
//   node tools/blockbench.mjs shots --mode edit|animate|paint [--anim <name>] [--t 0.5]
//        [--view front|threequarter|right|back|left|top|face] [--viewport-only] --out f.png
//   node tools/blockbench.mjs record --plan tools/blockbench_plan.json --out preview/part_blockbench.mp4
//
// Run from minecraft-bedrock/shaftbreaker/. Network access to web.blockbench.net is required.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RP = path.join(ROOT, 'Shaftbreaker_RP');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s.startsWith('--')) a[s.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else a._.push(s);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));

// Camera presets in Blockbench space (model units; creature faces -Z / "north", ~84 units tall)
const VIEWS = {
  front: { position: [0, 50, -175], target: [0, 44, 0] },
  threequarter: { position: [-105, 58, -140], target: [0, 44, 0] },
  threequarter_left: { position: [105, 58, -140], target: [0, 44, 0] },
  right: { position: [-175, 50, 0], target: [0, 44, 0] },
  left: { position: [175, 50, 0], target: [0, 44, 0] },
  back: { position: [0, 55, 175], target: [0, 44, 0] },
  top: { position: [0, 220, -40], target: [0, 40, 0] },
  face: { position: [-14, 80, -40], target: [0, 76, 0] },
  hands: { position: [-60, 30, -70], target: [-8, 24, 0] },
};

export async function openBlockbench({ width = 1280, height = 720 } = {}) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height } });
  const page = await ctx.newPage();
  const log = [];
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(m.type() + ': ' + m.text()); });
  await page.goto('https://web.blockbench.net/', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.Blockbench && window.Blockbench.version, null, { timeout: 120000 });
  return { browser, page, log };
}

function readPackFiles() {
  const geoPath = path.join(RP, 'models/entity/shaftbreaker.geo.json');
  const texPath = path.join(RP, 'textures/entity/shaftbreaker.png');
  const animDir = args['anims-dir'] ? path.resolve(String(args['anims-dir'])) : path.join(RP, 'animations');
  const anims = fs.existsSync(animDir)
    ? fs.readdirSync(animDir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ path: f, content: fs.readFileSync(path.join(animDir, f), 'utf8') }))
    : [];
  return {
    geo: fs.readFileSync(args.geo ? path.resolve(args.geo) : geoPath, 'utf8'),
    tex: 'data:image/png;base64,' + fs.readFileSync(args.texture ? path.resolve(args.texture) : texPath).toString('base64'),
    anims,
  };
}

export async function loadIntoBlockbench(page, files) {
  return page.evaluate(async ({ geo, tex, anims }) => {
    loadModelFile({ content: geo, path: 'shaftbreaker.geo.json', name: 'shaftbreaker.geo.json' });
    const t0 = Date.now();
    while (!window.Project && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50));
    const texture = new Texture({ name: 'shaftbreaker.png' }).fromDataURL(tex).add(false);
    while (!texture.loaded && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    for (const a of anims) AnimationCodec.codecs.bedrock.loadFile({ content: a.content, path: a.path });
    Project.name = 'shaftbreaker';
    Canvas.updateAll();
    return {
      blockbench: Blockbench.version,
      format: Format.id,
      bones: Group.all.length,
      cubes: Cube.all.length,
      locators: (window.Locator ? Locator.all.length : 0),
      textures: Texture.all.map((t) => `${t.name} ${t.width}x${t.height}`),
      uv: [Project.texture_width, Project.texture_height],
      animations: Animation.all.map((a) => `${a.name} (${a.length}s, ${a.loop})`),
    };
  }, files);
}

async function setView(page, { mode = 'edit', anim, t = 0, view = 'threequarter', camera }) {
  await page.evaluate(({ mode, anim, t, preset }) => {
    if (Modes.options[mode] && !Modes.options[mode].selected) Modes.options[mode].select();
    if (mode === 'animate' && anim) {
      const a = Animation.all.find((x) => x.name === anim);
      if (!a) throw new Error('animation not found in Blockbench: ' + anim);
      if (Animation.selected !== a) a.select();
      Timeline.setTime(t);
      Animator.preview();
    }
    Preview.selected.loadAnglePreset({ ...preset, projection: 'perspective' });
  }, { mode, anim, t, preset: camera || VIEWS[view] || VIEWS.threequarter });
  await page.waitForTimeout(120);
}

async function shot(page, viewportOnly, out, type = 'png') {
  const opts = { type, ...(type === 'jpeg' ? { quality: 92 } : {}) };
  if (viewportOnly) {
    const el = await page.$('#preview');
    return el ? el.screenshot({ path: out, ...opts }) : page.screenshot({ path: out, ...opts });
  }
  return page.screenshot({ path: out, ...opts });
}

async function cmdBbmodel() {
  const { browser, page, log } = await openBlockbench();
  const info = await loadIntoBlockbench(page, readPackFiles());
  console.log(JSON.stringify(info, null, 1));
  const bb = await page.evaluate(() => {
    const out = Codecs.project.compile({ editor_state: false });
    return typeof out === 'string' ? out : JSON.stringify(out);
  });
  const out = path.resolve(ROOT, args.out || 'Shaftbreaker.bbmodel');
  fs.writeFileSync(out, bb);
  const parsed = JSON.parse(bb);
  console.log(`wrote ${out} (${(bb.length / 1024).toFixed(0)} KB): ${parsed.elements?.length} cubes, ${parsed.animations?.length || 0} animations, ` +
    `${parsed.textures?.length} texture(s) embedded=${!!parsed.textures?.[0]?.source}`);
  const bad = log.filter((l) => !/favicon|service worker|DevTools/i.test(l));
  if (bad.length) console.log('Blockbench console:\n' + bad.slice(0, 30).join('\n'));
  await browser.close();
}

async function cmdShots() {
  const { browser, page, log } = await openBlockbench({ width: Number(args.width || 1280), height: Number(args.height || 720) });
  const info = await loadIntoBlockbench(page, readPackFiles());
  console.log(`Blockbench ${info.blockbench}: ${info.bones} bones, ${info.cubes} cubes, ${info.animations.length} animations`);
  const times = String(args.t ?? '0').split(',').map(Number);
  const views = String(args.view || 'threequarter').split(',');
  const outBase = String(args.out || 'blockbench.png');
  let i = 0;
  for (const view of views)
    for (const t of times) {
      await setView(page, { mode: args.mode || (args.anim ? 'animate' : 'edit'), anim: args.anim, t, view });
      const out = views.length * times.length > 1 ? outBase.replace(/\.png$/, `_${view}_${t}.png`) : outBase;
      await shot(page, !!args['viewport-only'], out);
      console.log('wrote', out);
      i++;
    }
  const bad = log.filter((l) => !/favicon|service worker|DevTools/i.test(l));
  if (bad.length) console.log('Blockbench console:\n' + bad.slice(0, 20).join('\n'));
  await browser.close();
}

// plan: { fps, width, height, segments: [{ mode, anim, duration, timeFrom, speed, viewFrom, viewTo, orbit }] }
async function cmdRecord() {
  const plan = JSON.parse(fs.readFileSync(path.resolve(String(args.plan)), 'utf8'));
  const fps = plan.fps || 30;
  const { browser, page } = await openBlockbench({ width: plan.width || 1280, height: plan.height || 720 });
  await loadIntoBlockbench(page, readPackFiles());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bbrec-'));
  let frame = 0;
  const lerp = (a, b, u) => a.map((v, k) => v + (b[k] - v) * u);
  for (const seg of plan.segments) {
    const n = Math.round(seg.duration * fps);
    for (let f = 0; f < n; f++) {
      const u = n > 1 ? f / (n - 1) : 0;
      const e = u * u * (3 - 2 * u);
      let camera;
      if (seg.orbit) {
        const [a0, a1] = seg.orbit.degrees;
        const ang = ((a0 + (a1 - a0) * e) * Math.PI) / 180;
        const r = seg.orbit.radius || 175;
        camera = { position: [-Math.sin(ang) * r, seg.orbit.height ?? 55, -Math.cos(ang) * r], target: seg.orbit.target || [0, 44, 0] };
      } else {
        const A = VIEWS[seg.viewFrom] || seg.cameraFrom, B = VIEWS[seg.viewTo || seg.viewFrom] || seg.cameraTo || A;
        camera = { position: lerp(A.position, B.position, e), target: lerp(A.target, B.target, e) };
      }
      const t = (seg.timeFrom || 0) + (f / fps) * (seg.speed ?? 1);
      await setView(page, { mode: seg.mode || 'animate', anim: seg.anim, t: seg.loopLength ? t % seg.loopLength : t, camera });
      await shot(page, !!seg.viewportOnly, path.join(tmp, `f${String(frame).padStart(5, '0')}.jpg`), 'jpeg');
      frame++;
      if (frame % 30 === 0) process.stdout.write(`\rblockbench frame ${frame}`);
    }
  }
  await browser.close();
  const out = path.resolve(String(args.out || 'blockbench.mp4'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(tmp, 'f%05d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
  if (ff.status !== 0) throw new Error('ffmpeg failed');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nwrote ${out} (${frame} frames)`);
}

const cmds = { bbmodel: cmdBbmodel, shots: cmdShots, record: cmdRecord };
const cmd = args._[0];
if (!cmds[cmd]) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n'));
  process.exit(cmd ? 1 : 0);
}
cmds[cmd]().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
