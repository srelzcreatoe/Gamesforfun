// Contact sheets of entity animations: rows = character x animation (x pack variant), columns = time x view.
// Honours the client entity's scaleX/scaleY/scaleZ (like the game), draws a 1-block floor grid and a
// 1.8-block player marker for scale.
//
// CLI:
//   node tools/render/anim_sheet.mjs out.png --ids rustgrin,cat --anims pose_1,perform_1 \
//        [--times 0,1,2] [--views front,right,left,back,q3] [--cell 200x300] [--title "..."] \
//        [--rp packs/RP] [--compare /path/to/other/RP[,label]] [--label after] [--noscale] [--pair cat,purple_rat]
//        [--frac N (N even times per animation)] [--zoom z] [--center y] [--camUp dy] [--cols n] [--exposure e] [--noref]
//   --compare adds a row per (id, anim) rendered from another RP folder (e.g. a "before" snapshot of
//   packs/RP/animations + packs/RP/entity; missing models/textures fall back to packs/RP).
//   --pair renders the listed ids side by side in one scene per cell (e.g. a shared stage).
//
// Module: import { renderSheets } from './tools/render/anim_sheet.mjs'; await renderSheets([sheetSpec, ...]);
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRenderer } from './render.mjs';
import { entityScale } from './render_world.mjs';
import { ROOT } from './fetch_vanilla.mjs';

const MAIN_RP = path.join(ROOT, 'packs/RP');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (p.endsWith('.json')) out.push(p);
  }
  return out;
}
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** Resolve fnar:<id> in an RP folder (falls back to packs/RP for models/textures it lacks). */
function resolve(id, rp) {
  const ident = id.includes(':') ? id : `fnar:${id}`;
  let d = null;
  for (const dir of [rp, MAIN_RP]) {
    for (const f of walk(path.join(dir, 'entity'))) { const j = readJ(f)['minecraft:client_entity']; if (j?.description?.identifier === ident) { d = j.description; break; } }
    if (d) break;
  }
  if (!d) throw new Error(`${ident}: no client entity in ${rp}`);
  const geoId = d.geometry.default;
  let geoFile = null;
  for (const dir of [rp, MAIN_RP]) {
    geoFile = walk(path.join(dir, 'models')).find((f) => readJ(f)['minecraft:geometry']?.some((g) => g.description.identifier === geoId));
    if (geoFile) break;
  }
  const texFile = [rp, MAIN_RP].map((dir) => path.join(dir, d.textures.default + '.png')).find((f) => fs.existsSync(f));
  const anims = new Map();
  for (const f of walk(path.join(rp, 'animations'))) for (const k of Object.keys(readJ(f).animations ?? {})) anims.set(k, f);
  return { ident, d, geoFile, texFile, anims, scale: entityScale(d) };
}

// camera direction around the entity (it faces +Z): 'right' looks at the entity's right side
const VIEW_YAW = { front: 0, right: -90, left: 90, back: 180, q3: -35, q3l: 35 };

/**
 * spec: { out, ids, anims, times, views, cell: [w, h], title, rp, compare: [{ rp, label }], label, noscale, pair, center, half }
 */
function buildSheet(spec, urlFor) {
  const [cw, ch] = spec.cell ?? [200, 300];
  const times = spec.times ?? [0];
  const views = spec.views ?? ['front', 'right'];
  const variants = [{ rp: spec.rp ?? MAIN_RP, label: spec.label ?? '' }, ...(spec.compare ?? [])];
  const groups = spec.pair ? [spec.pair] : spec.ids.map((i) => [i]);
  const cells = [];
  const half = spec.half ?? 2.05; // ortho half height (blocks)
  const cy = spec.center ?? 1.75;
  for (const ids of groups) {
    for (const anim of spec.anims) {
      for (const V of [...variants].reverse()) {
        // --frac N: N evenly spaced times over each animation's own length (end included for one-shots)
        let rowTimes = times;
        if (spec.frac) {
          let len = 2, loop = true;
          try {
            const R = resolve(ids[0], V.rp);
            const geoShort = R.d.geometry.default.split('.').pop();
            const name = [anim, R.d.animations?.[anim], `animation.fnar.${geoShort}.${anim}`].find((n) => n && R.anims.has(n));
            const A = readJ(R.anims.get(name)).animations[name];
            len = A.animation_length ?? 2; loop = A.loop === true;
          } catch { /* keep defaults */ }
          rowTimes = Array.from({ length: spec.frac }, (_, k) => Math.round((loop ? k * len / spec.frac : k * len / Math.max(1, spec.frac - 1)) * 100) / 100);
        }
        for (const t of rowTimes) {
          for (const view of views) {
            const models = [];
            const errs = [];
            ids.forEach((id, k) => {
              try {
                const R = resolve(id, V.rp);
                const short = R.ident.split(':')[1];
                const geoShort = R.d.geometry.default.split('.').pop();
                const name = [anim, R.d.animations?.[anim], `animation.fnar.${geoShort}.${anim}`, `animation.fnar.${short}.${anim}`].find((n) => n && R.anims.has(n));
                if (!name) { errs.push(`${short}: no ${anim}`); return; }
                const x = ids.length > 1 ? (k - (ids.length - 1) / 2) * (spec.spacing ?? 1.6) : 0;
                models.push({ geo: urlFor(R.geoFile), texture: urlFor(R.texFile), anim: urlFor(R.anims.get(name)), animName: name, t, yaw: 0, pos: [x, 0, 0], scale: spec.noscale ? 1 : R.scale });
              } catch (e) { errs.push(e.message); }
            });
            const yaw = (VIEW_YAW[view] ?? 0) * Math.PI / 180;
            const D = 20;
            const label = `${ids.join('+')} ${anim} t=${t}\n${view}${V.label ? '  [' + V.label + ']' : ''}${errs.length ? '  ' + errs.join(';') : ''}`;
            const wHalf = half * cw / ch * (ids.length > 1 ? 1 : 1);
            cells.push({
              label,
              scene: models.length ? {
                background: '#2a2a30',
                hemi: { sky: '#ffffff', ground: '#4a4a4a', intensity: 1.3 },
                lights: [
                  { type: 'dir', color: '#ffffff', intensity: 2.2, pos: [3 * Math.sin(yaw) + 2 * Math.cos(yaw), 6, 3 * Math.cos(yaw) - 2 * Math.sin(yaw)], target: [0, 1.4, 0], shadow: 4 },
                  { type: 'dir', color: '#9fb0ff', intensity: 0.6, pos: [-4, 3, -3] },
                ],
                floor: { size: 12, color: '#55555c', grid: '#77777f' },
                boxes: spec.noref ? [] : [{ pos: [wHalf * 0.92 * Math.cos(yaw) + 0, 0.9, -wHalf * 0.92 * Math.sin(yaw)], size: [0.06, 1.8, 0.06], color: '#d0c040' }],
                models,
                camera: { ortho: half * (spec.zoom ? 1 / spec.zoom : 1), pos: [D * Math.sin(yaw), cy + (spec.camUp ?? 0.4), D * Math.cos(yaw)], target: [0, cy, 0] },
              } : null,
            });
          }
        }
      }
    }
  }
  return { cols: spec.cols ?? (spec.frac ?? times.length) * views.length, cellW: cw, cellH: ch, title: spec.title, exposure: spec.exposure ?? 1.5, cells };
}

export async function renderSheets(specs) {
  const extra = new Map();
  const urlFor = (abs) => {
    const a = path.resolve(abs);
    if (a.startsWith(ROOT + path.sep)) return '/P/' + path.relative(ROOT, a).split(path.sep).map(encodeURIComponent).join('/');
    const dir = path.dirname(a);
    if (!extra.has(dir)) extra.set(dir, `/M${extra.size}`);
    return `${extra.get(dir)}/${encodeURIComponent(path.basename(a))}`;
  };
  const sheets = specs.map((s) => ({ out: s.out, sheet: buildSheet(s, urlFor) }));
  const mounts = { '/P': ROOT, ...Object.fromEntries([...extra].map(([d, m]) => [m, d])) };
  await withRenderer(async (render) => {
    for (const S of sheets) { await render.sheet(S.sheet, S.out); console.log(`[anim_sheet] wrote ${S.out}`); }
  }, { mounts });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const spec = { ids: [], anims: ['pose_1'] };
  const list = (v) => v.split(',').filter(Boolean);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--ids') spec.ids = list(a[++i]);
    else if (k === '--anims') spec.anims = list(a[++i]);
    else if (k === '--times') spec.times = list(a[++i]).map(Number);
    else if (k === '--frac') spec.frac = Number(a[++i]);
    else if (k === '--views') spec.views = list(a[++i]);
    else if (k === '--cell') spec.cell = a[++i].split('x').map(Number);
    else if (k === '--title') spec.title = a[++i];
    else if (k === '--rp') spec.rp = path.resolve(a[++i]);
    else if (k === '--label') spec.label = a[++i];
    else if (k === '--compare') { const [rp, label] = a[++i].split(','); (spec.compare ??= []).push({ rp: path.resolve(rp), label: label ?? 'compare' }); }
    else if (k === '--noscale') spec.noscale = true;
    else if (k === '--noref') spec.noref = true;
    else if (k === '--pair') spec.pair = list(a[++i]);
    else if (k === '--zoom') spec.zoom = Number(a[++i]);
    else if (k === '--exposure') spec.exposure = Number(a[++i]);
    else if (k === '--center') spec.center = Number(a[++i]);
    else if (k === '--spacing') spec.spacing = Number(a[++i]);
    else if (k === '--camUp') spec.camUp = Number(a[++i]);
    else if (k === '--cols') spec.cols = Number(a[++i]);
    else if (!spec.out) spec.out = path.resolve(k);
    else { console.error(`unknown argument ${k}`); process.exit(1); }
  }
  if (!spec.out || (!spec.ids.length && !spec.pair)) {
    console.log('usage: node tools/render/anim_sheet.mjs out.png --ids a,b --anims x,y [--times ..] [--views front,right,left,back,q3] [--cell WxH] [--rp dir] [--compare dir[,label]] [--pair a,b] [--noscale]');
    process.exit(1);
  }
  await renderSheets([spec]);
}
