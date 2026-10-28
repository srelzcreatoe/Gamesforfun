// Offline preview renderer for fnar-voxels-1 snapshots (see docs/RENDERER.md).
//
// CLI:
//   node tools/render/render_world.mjs scene.json out.png [scene2.json out2.png ...] [--packs dirA,dirB] [--quiet]
//
// Module:
//   import { renderWorld } from './tools/render/render_world.mjs';
//   await renderWorld({ scene: 'scene.json' | {...}, out: 'out.png' });           // one image
//   await renderWorld([{ scene, out }, ...], { packs: ['extra/pack'], baseDir }); // many images, one browser
//   -> [{ out, ms, log: [...] }]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withRenderer } from './render.mjs';
import { createBlockResolver } from './blocks.mjs';
import { ROOT, parseJsonLoose, toPNG } from './fetch_vanilla.mjs';
import { readPNG, writePNGFile, RENDER_CACHE, processTexture } from './texproc.mjs';
import { faceUVs } from './bedrock_model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ urls
function makeUrlMapper() {
  const extra = new Map();
  const urlFor = (abs) => {
    const a = path.resolve(abs);
    if (a.startsWith(ROOT + path.sep)) return '/P/' + path.relative(ROOT, a).split(path.sep).map(encodeURIComponent).join('/');
    const dir = path.dirname(a);
    if (!extra.has(dir)) extra.set(dir, `/M${extra.size}`);
    return `${extra.get(dir)}/${encodeURIComponent(path.basename(a))}`;
  };
  const mounts = () => ({ '/P': ROOT, ...Object.fromEntries([...extra].map(([d, m]) => [m, d])) });
  return { urlFor, mounts };
}

// ------------------------------------------------------------------ entities
function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out); else if (pred(p)) out.push(p);
  }
  return out;
}
const readJ = (f) => { try { return parseJsonLoose(fs.readFileSync(f, 'utf8')); } catch { return null; } };
function findImage(base) { for (const ext of ['.png', '.tga']) if (fs.existsSync(base + ext)) return toPNG(base + ext); return null; }

/** Entity resource roots: the add-on RP first, then the source model packs (fnaf:* ids). */
function entityRoots(root, packs) {
  const roots = [{ rp: path.join(root, 'packs/RP'), ns: 'fnar' }];
  for (const p of packs) roots.push({ rp: path.join(p, 'RP'), ns: null });
  const src = path.join(root, 'assets/source_models');
  if (fs.existsSync(src)) for (const d of fs.readdirSync(src)) if (fs.existsSync(path.join(src, d, 'entity'))) roots.push({ rp: path.join(src, d), ns: 'fnaf' });
  return roots;
}

const entityCache = new Map();
function resolveEntityResources(id, root, packs) {
  const key = id + '|' + packs.join(',');
  if (entityCache.has(key)) return entityCache.get(key);
  const short = id.includes(':') ? id.split(':')[1] : id;
  const ids = new Set([id, `fnar:${short}`, `fnaf:${short}`]);
  let found = null;
  for (const R of entityRoots(root, packs)) {
    for (const f of walk(path.join(R.rp, 'entity'), (p) => p.endsWith('.json'))) {
      const j = readJ(f);
      const d = j?.['minecraft:client_entity']?.description;
      if (d && ids.has(d.identifier)) { found = { R, d, file: f }; break; }
    }
    if (found) break;
  }
  if (!found) throw new Error(`entity ${id}: no client entity definition found (packs/RP/entity or assets/source_models)`);
  const { R, d } = found;
  const geoId = d.geometry?.default ?? Object.values(d.geometry ?? {})[0];
  let geoFile = null;
  for (const f of walk(path.join(R.rp, 'models'), (p) => p.endsWith('.json'))) {
    const j = readJ(f);
    if (j?.['minecraft:geometry']?.some((g) => g.description?.identifier === geoId)) { geoFile = f; break; }
  }
  if (!geoFile) throw new Error(`entity ${id}: geometry ${geoId} not found`);
  const texRel = d.textures?.default ?? Object.values(d.textures ?? {})[0];
  const texFile = findImage(path.join(R.rp, texRel));
  if (!texFile) throw new Error(`entity ${id}: texture ${texRel} not found`);
  const eyesRel = Object.entries(d.textures ?? {}).find(([k]) => /eye|glow|emissive/i.test(k))?.[1];
  const animFiles = walk(path.join(R.rp, 'animations'), (p) => p.endsWith('.json'));
  const res = { id, identifier: d.identifier, rp: R.rp, geoId, geoFile, texFile, texRel, eyesFile: eyesRel ? findImage(path.join(R.rp, eyesRel)) : null, animations: d.animations ?? {}, animFiles };
  // texture set (MER) for the entity texture
  const setFile = path.join(R.rp, texRel + '.texture_set.json');
  if (fs.existsSync(setFile)) {
    const ts = readJ(setFile)?.['minecraft:texture_set'] ?? {};
    const mer = ts.metalness_emissive_roughness ?? ts.metalness_emissive_roughness_subsurface;
    if (typeof mer === 'string') res.merFile = findImage(path.join(path.dirname(path.join(R.rp, texRel)), mer));
    if (typeof ts.heightmap === 'string') res.heightFile = findImage(path.join(path.dirname(path.join(R.rp, texRel)), ts.heightmap));
  }
  entityCache.set(key, res);
  return res;
}

/** Emissive map for animatronic eyes: an explicit eyes/glow texture, MER green, or bright red pixels on the head. */
function eyesEmissive(res) {
  const out = path.join(RENDER_CACHE, 'entity', `${crypto.createHash('sha1').update(res.texFile + fs.statSync(res.texFile).mtimeMs + (res.eyesFile ?? '') + 'v2').digest('hex').slice(0, 16)}_eyes.png`);
  if (fs.existsSync(out)) return out;
  const img = readPNG(res.texFile);
  const W = img.width, H = img.height;
  const em = new Uint8Array(W * H * 4);
  for (let k = 3; k < em.length; k += 4) em[k] = 255;
  let count = 0;
  if (res.eyesFile) {
    const e = readPNG(res.eyesFile);
    for (let k = 0; k < Math.min(e.data.length, em.length); k += 4) { const a = e.data[k + 3] / 255; em[k] = e.data[k] * a; em[k + 1] = e.data[k + 1] * a; em[k + 2] = e.data[k + 2] * a; if (a > 0.1) count++; }
  } else {
    const geo = readJ(res.geoFile)['minecraft:geometry'].find((g) => g.description.identifier === res.geoId);
    const tw = geo.description.texture_width, th = geo.description.texture_height;
    const sxs = W / tw, sys = H / th;
    const inHead = new Uint8Array(W * H);
    for (const b of geo.bones) {
      if (!(b.name === 'head' || /eye/i.test(b.name))) continue;
      for (const c of b.cubes ?? []) {
        for (const r of Object.values(faceUVs(c))) {
          if (!r) continue;
          const x0 = Math.floor(Math.min(r[0], r[2]) * sxs), x1 = Math.ceil(Math.max(r[0], r[2]) * sxs);
          const y0 = Math.floor(Math.min(r[1], r[3]) * sys), y1 = Math.ceil(Math.max(r[1], r[3]) * sys);
          for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) inHead[y * W + x] = 1;
        }
      }
    }
    const D = img.data;
    const red = (k) => D[k + 3] > 0 && D[k] >= 120 && D[k] > 2 * D[k + 1] && D[k] > 2 * D[k + 2];
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (inHead[i] && red(i * 4)) mask[i] = 1;
    // 1-px growth into bright glints next to the red pupils
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (mask[i] || !inHead[i]) continue;
      const k = i * 4; const lum = (D[k] + D[k + 1] + D[k + 2]) / 765;
      if (lum > 0.7 && (mask[i - 1] || mask[i + 1] || mask[i - W] || mask[i + W])) mask[i] = 2;
    }
    for (let i = 0; i < W * H; i++) if (mask[i]) { em[i * 4] = D[i * 4]; em[i * 4 + 1] = D[i * 4 + 1]; em[i * 4 + 2] = D[i * 4 + 2]; count++; }
  }
  if (!count) return null;
  writePNGFile(out, { width: W, height: H, data: em });
  return out;
}

function resolveEntity(spec, root, packs, urlFor) {
  const res = resolveEntityResources(spec.id, root, packs);
  let animName = null, animFile = null;
  if (spec.anim) {
    // candidates: full name, the entity's short-name map, then any animation of this entity ending in .<anim>
    const all = new Map();
    for (const f of res.animFiles) { const j = readJ(f); for (const k of Object.keys(j?.animations ?? {})) if (!all.has(k)) all.set(k, f); }
    const short = res.identifier.split(':')[1];
    const alias = { perform_1: 'perform', perform: 'perform_1', pose_1: 'pose', pose: 'pose_1', pose_2: 'slump', perform_2: 'perform2' };
    const cands = [spec.anim, res.animations[spec.anim], res.animations[alias[spec.anim]]].filter(Boolean);
    for (const k of all.keys()) if (k.endsWith('.' + spec.anim) && k.includes(short)) cands.push(k);
    cands.push(`animation.${short}.${spec.anim}`, `animation.fnar.${short}.${spec.anim}`);
    animName = cands.find((c) => all.has(c)) ?? null;
    animFile = animName ? all.get(animName) : null;
    if (!animFile) console.warn(`[render_world] entity ${spec.id}: animation '${spec.anim}' not found (have: ${[...all.keys()].filter((k) => k.includes(short)).join(', ')})`);
  }
  const out = { ...spec, geo: urlFor(res.geoFile), texture: urlFor(res.texFile), anim: animFile ? urlFor(animFile) : null, animName };
  if (res.merFile) {
    const t = processTexture({ file: res.texFile, frames: 1, mers: res.merFile, mersKind: 'mer' });
    if (t.pbrFile) out.pbr = urlFor(t.pbrFile);
    if (t.emiFile && spec.eyes !== false && !res.eyesFile) out.emissive = urlFor(t.emiFile);
  }
  if (!out.emissive && spec.eyes !== false) { const e = eyesEmissive(res); if (e) out.emissive = urlFor(e); }
  return out;
}

// ------------------------------------------------------------------ main
function loadScene(job, opts) {
  let scene = job.scene, base = opts.baseDir ?? process.cwd();
  if (typeof scene === 'string') { base = path.dirname(path.resolve(scene)); scene = JSON.parse(fs.readFileSync(scene, 'utf8')); }
  scene = { ...scene };
  if (typeof scene.voxels === 'string') scene.voxelsPath = path.resolve(base, scene.voxels);
  scene.packs = (scene.packs ?? []).map((p) => path.resolve(base, p));
  return scene;
}

/**
 * Render one or more scenes. jobs: { scene: path|object, out: path } or an array of them.
 * opts: { packs: string[] (extra pack dirs with BP/ RP/), baseDir, root, quiet }
 */
export async function renderWorld(jobs, opts = {}) {
  const list = Array.isArray(jobs) ? jobs : [jobs];
  const root = opts.root ?? ROOT;
  const { urlFor, mounts } = makeUrlMapper();
  const prepared = [];
  const worlds = new Map();
  for (const job of list) {
    const scene = loadScene(job, opts);
    const packs = [...(opts.packs ?? []).map((p) => path.resolve(p)), ...scene.packs];
    const snapPath = scene.voxelsPath;
    if (!snapPath) throw new Error('scene.voxels (path to fnar-voxels-1 snapshot) is required');
    const wkey = crypto.createHash('sha1').update(snapPath + fs.statSync(snapPath).mtimeMs + packs.join(',')).digest('hex').slice(0, 16);
    if (!worlds.has(wkey)) {
      const t0 = Date.now();
      const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      if (snap.format !== 'fnar-voxels-1') throw new Error(`${snapPath}: format ${snap.format} != fnar-voxels-1`);
      const resolver = await createBlockResolver({ root, packs });
      const palette = snap.palette.map((e) => resolver.resolve(e));
      const { textures, geometries } = await resolver.finalize(palette, urlFor);
      worlds.set(wkey, { key: wkey, origin: snap.origin ?? [0, 0, 0], size: snap.size, data: snap.data, palette, textures, geometries, signs: snap.signs ?? [] });
      if (!opts.quiet) console.log(`[render_world] ${path.relative(process.cwd(), snapPath)}: ${snap.size.join('x')}, ${palette.length} palette entries, ${Object.keys(textures).length} textures, resolved in ${Date.now() - t0} ms`);
    }
    const entities = [];
    for (const e of scene.entities ?? []) {
      try { entities.push(resolveEntity(e, root, packs, urlFor)); } catch (err) { console.warn(`[render_world] ${err.message}`); }
    }
    const { voxelsPath, packs: _p, ...sceneOut } = scene;
    prepared.push({ out: path.resolve(job.out), scene: sceneOut, worldKey: wkey, entities });
  }
  const results = [];
  await withRenderer(async (_render, page) => {
    for (const P of prepared) {
      const t0 = Date.now();
      const has = await page.evaluate((k) => window.hasWorld(k), P.worldKey);
      const payload = { scene: P.scene, worldKey: P.worldKey, entities: P.entities, world: has ? null : worlds.get(P.worldKey) };
      const r = await page.evaluate((p) => window.renderWorld(p), payload);
      fs.mkdirSync(path.dirname(P.out), { recursive: true });
      fs.writeFileSync(P.out, Buffer.from(r.png.split(',')[1], 'base64'));
      const ms = Date.now() - t0;
      if (!opts.quiet) { for (const l of r.log) console.log('  ' + l); console.log(`[render_world] wrote ${path.relative(process.cwd(), P.out)} (${ms} ms)`); }
      results.push({ out: P.out, ms, log: r.log });
    }
  }, { mounts: mounts(), page: 'world.html' });
  return results;
}

// ------------------------------------------------------------------ CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opts = { packs: [] };
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--packs') opts.packs.push(...args[++i].split(','));
    else if (args[i] === '--quiet') opts.quiet = true;
    else pos.push(args[i]);
  }
  if (pos.length < 2 || pos.length % 2) {
    console.log('usage: node tools/render/render_world.mjs scene.json out.png [scene2.json out2.png ...] [--packs dir,dir] [--quiet]');
    process.exit(1);
  }
  const jobs = [];
  for (let i = 0; i < pos.length; i += 2) jobs.push({ scene: pos[i], out: pos[i + 1] });
  const t0 = Date.now();
  await renderWorld(jobs, opts);
  console.log(`[render_world] done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
