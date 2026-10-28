// Renders prop previews straight from the packs (BP block JSON -> permutations ->
// geometry + material instances + transformation; RP textures via the props fragments).
// Usage: node tools/blocks/props/preview.mjs [--night] [--out file.png] [--cols N] [--tile 320x320] [--title T] [--skip labelPrefix] name[:label|:prefix*] ...
// Views per block come from tools/blocks/props/preview_manifest.json (written by build_props.py).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRenderer } from '../../render/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const RP = path.join(ROOT, 'packs/RP');
const BP = path.join(ROOT, 'packs/BP');
const FRAG = path.join(ROOT, 'tools/fragments');

const args = process.argv.slice(2);
const opt = { night: false, out: path.join(HERE, 'preview.png'), cols: 4, tile: [320, 320], title: '', exposure: 1.0, skip: [] };
const names = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--night') opt.night = true;
  else if (a === '--out') opt.out = path.resolve(args[++i]);
  else if (a === '--cols') opt.cols = Number(args[++i]);
  else if (a === '--tile') opt.tile = args[++i].split('x').map(Number);
  else if (a === '--title') opt.title = args[++i];
  else if (a === '--exposure') opt.exposure = Number(args[++i]);
  else if (a === '--skip') opt.skip.push(args[++i]);
  else names.push(a);
}

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const terrain = {}; const flip = new Set();
for (const f of fs.readdirSync(FRAG)) {
  if (f.startsWith('terrain_')) Object.assign(terrain, readJSON(path.join(FRAG, f)));
  if (f.startsWith('flipbook_')) for (const e of readJSON(path.join(FRAG, f))) flip.add(e.atlas_tile);
}
const geoIndex = {};
for (const f of fs.readdirSync(path.join(RP, 'models/blocks'))) {
  if (!f.endsWith('.json')) continue;
  const j = readJSON(path.join(RP, 'models/blocks', f));
  for (const g of j['minecraft:geometry']) geoIndex[g.description.identifier] = j;
}
const manifest = readJSON(path.join(HERE, 'preview_manifest.json'));

function evalCond(cond, states) {
  const expr = cond.replace(/q(?:uery)?\.block_state\('([^']+)'\)/g, (_, s) => JSON.stringify(states[s]));
  return Function(`return (${expr});`)();
}
function texSpec(short, inst) {
  const e = terrain[short];
  if (!e) throw new Error('unknown texture ' + short);
  let p = e.textures; if (Array.isArray(p)) p = p[0]; if (typeof p === 'object') p = p.path;
  const has = (suf) => fs.existsSync(path.join(RP, p + suf + '.png'));
  return { color: `/RP/${p}.png`, mer: has('_mer') ? `/RP/${p}_mer.png` : null, height: has('_height') ? `/RP/${p}_height.png` : null,
    render: inst.render_method, flip: flip.has(short) };
}
function resolvePart(name, states, pos, frame) {
  const blk = readJSON(path.join(BP, 'blocks', name + '.json'))['minecraft:block'];
  const st = { 'minecraft:cardinal_direction': 'north' };
  for (const [k, v] of Object.entries(blk.description.states || {})) st[k] = Array.isArray(v) ? v[0] : (v.values ? v.values[0] : v.min);
  Object.assign(st, states);
  const comps = { ...blk.components };
  for (const p of blk.permutations || []) if (evalCond(p.condition, st)) Object.assign(comps, p.components);
  const g = comps['minecraft:geometry'];
  const ident = typeof g === 'string' ? g : g.identifier;
  const mis = comps['minecraft:material_instances'];
  const materials = {};
  for (const [k, v] of Object.entries(mis)) {
    let inst = v; let guard = 0;
    while (typeof inst === 'string' && guard++ < 8) inst = mis[inst];
    materials[k] = { ...texSpec(inst.texture, inst), frame };
  }
  const rot = comps['minecraft:transformation']?.rotation?.[1] ?? 0;
  return { geo: geoIndex[ident], identifier: ident, materials, rotY: rot, pos };
}

const items = [];
for (const n of names) {
  const [name, only] = n.split(':');
  const views = manifest[name];
  if (!views) throw new Error('no manifest entry ' + name);
  for (const v of views) {
    if (opt.skip.some((p) => v.label.startsWith(p))) continue;
    if (only && (only.endsWith('*') ? !v.label.startsWith(only.slice(0, -1)) : v.label !== only)) continue;
    const parts = (v.parts || [{ states: v.states || {}, pos: [0, 0, 0] }]).map((p) => resolvePart(name, { ...(v.states || {}), ...p.states }, p.pos || [0, 0, 0], v.frame ?? 0));
    const rotY = parts[0].rotY;
    const walls = [];
    if (v.env === 'wall') walls.push({ size: [3, 3, 0.25], pos: [0, 0.5, 0.625], rotY });
    if (v.env === 'pillar') walls.push({ size: [1, 2, 1], pos: [0, 1, 0] });
    if (v.env === 'ceiling') for (const [dx, dz] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) walls.push({ size: [1, 1, 1], pos: [dx, 0.5, dz] });
    items.push({ label: `${name} ${v.label}`, parts, walls, floor: v.env !== 'ceiling', camera: v.camera, keyLight: v.keyLight, focus: v.focus, dist: v.dist, dir: v.dir });
  }
}
await withRenderer(async (render, page) => {
  await page.addScriptTag({ type: 'module', url: '/P/props_page.js' });
  await page.waitForFunction(() => window.__propsReady === true, null, { timeout: 60000 });
  const url = await page.evaluate((S) => window.renderSheet(S), { tile: opt.tile, cols: opt.cols, items, lighting: opt.night ? 'night' : 'studio', title: opt.title, exposure: opt.exposure });
  fs.mkdirSync(path.dirname(opt.out), { recursive: true });
  fs.writeFileSync(opt.out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', path.relative(ROOT, opt.out), `(${items.length} views)`);
}, { mounts: { '/P': HERE, '/RP': RP } });
