#!/usr/bin/env node
// Driver for the offline reference viewer.
//   node render.cjs sheet <i|ii|iii> [--glow 0.8] [--out file.png] [--pose pose.json] [--zoom name]
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.tga': 'application/octet-stream', '.cjs': 'text/javascript', '.mjs': 'text/javascript' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function open() {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/tools/preview/viewer.html`);
  await page.waitForFunction('window.ready === true');
  return { srv, browser, page, close: async () => { await browser.close(); srv.close(); } };
}

// (Vathrok, 2.0, is the form-five model under its own name)
const FILE_NAME = (f) => (f === 'v' ? 'vathrok' : `basiliskra_${f}`);
const FORM_FILES = (f) => ({
  geo: `/packs/RP/models/entity/${FILE_NAME(f)}.geo.json`,
  tex: `/packs/RP/textures/entity/basiliskra/${FILE_NAME(f)}.png`,
  glow: `/packs/RP/textures/entity/basiliskra/${FILE_NAME(f)}_glow.png`,
});

function arg(args, name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
}

async function sheet(args) {
  const form = args[0];
  const out = arg(args, 'out', path.join(ROOT, 'previews', `sheet_${form}.png`));
  const glow = parseFloat(arg(args, 'glow', '0'));
  const poseFile = arg(args, 'pose', null);
  const zoom = arg(args, 'zoom', null);
  const night = args.includes('--night');
  const s = await open();
  const info = await s.page.evaluate(async ({ form, files, glow, pose, zoom, night }) => {
    const BK = window.BK, THREE = BK.THREE;
    const inf = await BK.loadForm(form, files);
    if (pose) BK.setPose(form, pose);
    BK.setGlow(form, glow);
    const dummy = BK.Stage.playerDummy();
    BK.scene.add(dummy);
    if (night) { BK.env.uLight.value.set(0.30, 0.34, 0.5); BK.env.uAmbient.value.set(0.16, 0.17, 0.25); }
    const b = BK.bounds(form);
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
    dummy.position.set(b.min[0] - 1.5, 0, b.min[2] + 2);
    const bg = night ? '#0b1020' : '#9db9e6';
    const W = 2200, H = 1500;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#16181d'; g.fillRect(0, 0, W, H);
    const draw = async (x, y, w, h, cam, label) => {
      const url = BK.shot(w, h, cam, bg);
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = url; });
      g.drawImage(img, x, y);
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y, 13 * label.length + 16, 26);
      g.fillStyle = '#fff'; g.font = '18px monospace'; g.fillText(label, x + 8, y + 19);
    };
    const pad = 1.06;
    if (zoom) {
      const p = BK.bonePos(form, zoom);
      const r = Math.max(sy, 6) * 0.22;
      // the animal's left is -X here; "left" views look along +X
      await draw(0, 0, 1100, 750, { ortho: r, dir: [-1, 0.05, 0], target: p }, `${zoom}: left`);
      await draw(1100, 0, 1100, 750, { ortho: r, dir: [0, 0.05, -1], target: p }, `${zoom}: front`);
      await draw(0, 750, 1100, 750, { pos: [p[0] - r * 2.2, p[1] + r * 0.5, p[2] - r * 2.6], target: p, fov: 40 }, `${zoom}: 3/4`);
      await draw(1100, 750, 1100, 750, { ortho: r * 0.42, dir: [-1, 0, -0.15], target: p }, `${zoom}: close`);
    } else {
      await draw(0, 0, 2200, 560, { ortho: Math.max(sy * 0.5 * pad, sz * 0.5 * pad * 560 / 2200), dir: [-1, 0, 0], target: [cx, cy, cz] }, 'left side');
      await draw(0, 560, 1100, 470, { ortho: Math.max(sx * 0.5 * pad, sz * 0.5 * pad * 470 / 1100), dir: [0, 1, 0.0001], target: [cx, cy, cz] }, 'top (head left = -Z up)');
      await draw(1100, 560, 550, 470, { ortho: Math.max(sy * 0.5 * pad, sx * 0.5 * pad * 470 / 550), dir: [0, 0, -1], target: [cx, cy, cz] }, 'front');
      await draw(1650, 560, 550, 470, { ortho: Math.max(sy * 0.5 * pad, sx * 0.5 * pad * 470 / 550), dir: [0, 0, 1], target: [cx, cy, cz] }, 'back');
      const R = Math.max(sx, sy, sz);
      await draw(0, 1030, 1100, 470, { pos: [cx - R * 0.55, cy + R * 0.22, b.min[2] - R * 0.42], target: [cx, cy, cz - sz * 0.12], fov: 38 }, '3/4 front-left');
      await draw(1100, 1030, 1100, 470, { pos: [cx + R * 0.5, cy + R * 0.3, b.max[2] + R * 0.35], target: [cx, cy, cz + sz * 0.1], fov: 38 }, '3/4 rear-right');
    }
    return { inf, b, url: cv.toDataURL('image/png') };
  }, { form, files: FORM_FILES(form), glow, pose: poseFile ? JSON.parse(fs.readFileSync(poseFile, 'utf8')) : null, zoom, night });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(info.url.split(',')[1], 'base64'));
  console.log(JSON.stringify({ out, ...info.inf, bounds: info.b }));
  await s.close();
}

// One free camera view.  --yaw 0 looks at the animal's LEFT side, 90 from the front, 180 right
// side, 270 from behind; --pitch degrees above the horizon; --dist blocks; --at bone/locator or
// --target x,y,z (blocks); --fov; --size WxH; --glow a; --pose file; --night
async function view(args) {
  const form = args[0];
  const out = arg(args, 'out', path.join(ROOT, 'previews', `view_${form}.png`));
  const [W, H] = arg(args, 'size', '1400x800').split('x').map(Number);
  const o = {
    form, files: FORM_FILES(form), W, H,
    yaw: parseFloat(arg(args, 'yaw', '0')), pitch: parseFloat(arg(args, 'pitch', '8')),
    dist: parseFloat(arg(args, 'dist', '0')), fov: parseFloat(arg(args, 'fov', '45')),
    at: arg(args, 'at', null), target: arg(args, 'target', null), glow: parseFloat(arg(args, 'glow', '0')),
    pose: arg(args, 'pose', null) ? JSON.parse(fs.readFileSync(arg(args, 'pose', null), 'utf8')) : null,
    night: args.includes('--night'), bg: arg(args, 'bg', null), dummy: !args.includes('--no-dummy'),
  };
  const s = await open();
  const url = await s.page.evaluate(async (o) => {
    const BK = window.BK;
    await BK.loadForm(o.form, o.files);
    if (o.pose) BK.setPose(o.form, o.pose);
    BK.setGlow(o.form, o.glow);
    if (o.night) { BK.env.uLight.value.set(0.30, 0.34, 0.5); BK.env.uAmbient.value.set(0.16, 0.17, 0.25); }
    const b = BK.bounds(o.form);
    if (o.dummy) { const d = BK.Stage.playerDummy(); d.position.set(b.min[0] - 2, 0, b.min[2] + 4); BK.scene.add(d); }
    let t = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    if (o.at) t = BK.bonePos(o.form, o.at);
    if (o.target) t = o.target.split(',').map(Number);
    const R = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const dist = o.dist || R * 1.15;
    const y = o.yaw * Math.PI / 180, p = o.pitch * Math.PI / 180;
    // yaw 0: camera on -X (the animal's left); yaw 90: camera in front (-Z)
    const dir = [-Math.cos(y) * Math.cos(p), Math.sin(p), -Math.sin(y) * Math.cos(p)];
    const pos = [t[0] + dir[0] * dist, t[1] + dir[1] * dist, t[2] + dir[2] * dist];
    return BK.shot(o.W, o.H, { pos, target: t, fov: o.fov }, o.bg ?? (o.night ? '#0b1020' : '#9db9e6'));
  }, o);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(out);
  await s.close();
}

const CLIENT_FILES = {
  entity: '/packs/RP/entity/basiliskra.entity.json',
  animations: ['/packs/RP/animations/basiliskra.animation.json'],
  controllers: ['/packs/RP/animation_controllers/basiliskra.animation_controllers.json'],
  renderControllers: ['/packs/RP/render_controllers/basiliskra.render_controllers.json'],
};

// A filmstrip of the real client files running:  --script '[[t, {prop: value, ...}], ...]'
// (properties without the namespace; "speed" in blocks/s moves the animal), --times 0.5,1,2
async function strip(args) {
  const form = args[0];
  const out = arg(args, 'out', path.join(ROOT, 'previews', `strip_${form}.png`));
  const o = {
    form, files: FORM_FILES(form), client: CLIENT_FILES,
    script: JSON.parse(arg(args, 'script', '[[0,{}]]')), times: arg(args, 'times', '0.5,1,2,3').split(',').map(Number),
    yaw: parseFloat(arg(args, 'yaw', '20')), pitch: parseFloat(arg(args, 'pitch', '8')), dist: parseFloat(arg(args, 'dist', '0')),
    fov: parseFloat(arg(args, 'fov', '36')), target: arg(args, 'target', null), at: arg(args, 'at', null),
    night: args.includes('--night'), cols: parseInt(arg(args, 'cols', '2'), 10), W: parseInt(arg(args, 'w', '1000'), 10), H: parseInt(arg(args, 'h', '460'), 10),
  };
  const s = await open();
  const res = await s.page.evaluate(async (o) => {
    const BK = window.BK;
    await BK.loadForm(o.form, o.files);
    await BK.makeAnimator(o.form, o.client);
    const m = BK.models[o.form], A = m.animator;
    const formNo = { i: 1, ii: 2, iii: 3 }[o.form];
    Object.assign(A.props, { 'basiliskra:form': formNo, 'basiliskra:bound': true, 'basiliskra:phase': 0, 'basiliskra:charge': 0, 'basiliskra:look_yaw': 0,
      'basiliskra:look_pitch': 0, 'basiliskra:bend': 0, 'basiliskra:pitch': 0, 'basiliskra:gait': 2, 'basiliskra:gill': false, 'basiliskra:fx_kind': 0, 'basiliskra:fx_seq': 0, 'basiliskra:tier': 1 });
    if (o.night) { BK.env.uLight.value.set(0.30, 0.34, 0.5); BK.env.uAmbient.value.set(0.16, 0.17, 0.25); }
    const b0 = BK.bounds(o.form);
    const cols = o.cols, rows = Math.ceil(o.times.length / cols);
    const cv = document.createElement('canvas');
    cv.width = o.W * cols; cv.height = o.H * rows;
    const g = cv.getContext('2d');
    let speed = 0, t = 0, ki = 0, shot = 0;
    const dt = 1 / 30;
    const tEnd = Math.max(...o.times) + 1e-6;
    while (t <= tEnd && shot < o.times.length) {
      while (ki < o.script.length && o.script[ki][0] <= t + 1e-9) {
        for (const [k, v] of Object.entries(o.script[ki][1])) {
          if (k === 'speed') speed = v; else A.props['basiliskra:' + k] = v;
        }
        ki++;
      }
      A.state.speed = speed / 20; A.state.distance += speed * dt;
      A.update(dt);
      t += dt;
      if (t >= o.times[shot] - 1e-9) {
        let tg = [(b0.min[0] + b0.max[0]) / 2, (b0.min[1] + b0.max[1]) / 2, (b0.min[2] + b0.max[2]) / 2];
        if (o.at) tg = BK.bonePos(o.form, o.at);
        if (o.target) tg = o.target.split(',').map(Number);
        const R = Math.max(b0.max[0] - b0.min[0], b0.max[1] - b0.min[1], b0.max[2] - b0.min[2]);
        const dist = o.dist || R * 1.1;
        const y = o.yaw * Math.PI / 180, p = o.pitch * Math.PI / 180;
        const dir = [-Math.cos(y) * Math.cos(p), Math.sin(p), -Math.sin(y) * Math.cos(p)];
        const url = BK.shot(o.W, o.H, { pos: [tg[0] + dir[0] * dist, tg[1] + dir[1] * dist, tg[2] + dir[2] * dist], target: tg, fov: o.fov }, o.night ? '#0b1020' : '#9db9e6');
        const img = new Image();
        await new Promise((r) => { img.onload = r; img.src = url; });
        const x = (shot % cols) * o.W, yy = Math.floor(shot / cols) * o.H;
        g.drawImage(img, x, yy);
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, yy, 150, 26); g.fillStyle = '#fff'; g.font = '18px monospace'; g.fillText('t=' + o.times[shot].toFixed(2) + 's', x + 8, yy + 19);
        shot++;
      }
    }
    return { url: cv.toDataURL('image/png'), missing: [...A.missing] };
  }, o);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(res.url.split(',')[1], 'base64'));
  console.log(JSON.stringify({ out, missingBones: res.missing }));
  await s.close();
}

module.exports = { open, FORM_FILES, CLIENT_FILES, ROOT, arg };

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  const run = { sheet, view, strip }[cmd];
  if (!run) { console.error('usage: render.cjs sheet|view <i|ii|iii> [--glow a] [--out f] [--pose f] [--zoom bone] [--night] (view: --yaw --pitch --dist --at --fov --size)'); process.exit(2); }
  run(args).catch((e) => { console.error(e); process.exit(1); });
}
