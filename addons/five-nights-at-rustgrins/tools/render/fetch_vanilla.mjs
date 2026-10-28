// Fetches and caches the vanilla Bedrock resource files the world renderer needs
// (Mojang bedrock-samples, https://raw.githubusercontent.com/Mojang/bedrock-samples/main/<path>)
// into tools/.cache/vanilla/<path>. TGA textures are decoded and stored next to the
// original as <name>.png so the browser only ever loads PNGs.
//
// CLI:
//   node tools/render/fetch_vanilla.mjs                    registry files only (blocks.json, terrain_texture.json, ...)
//   node tools/render/fetch_vanilla.mjs snap.json [...] [--packs dir,dir]   + every texture the snapshots' palettes need
//   node tools/render/fetch_vanilla.mjs --all              + every texture referenced by blocks.json (slow, ~3k files)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const CACHE_DIR = path.join(ROOT, 'tools/.cache/vanilla');
const BASE_URL = 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/';
const LOCAL_SAMPLES = '/opt/bedrock-samples'; // pre-downloaded copy (optional)
const MISSING_FILE = path.join(CACHE_DIR, 'missing.json');

let missing = null;
function missingSet() {
  if (!missing) {
    try { missing = new Set(JSON.parse(fs.readFileSync(MISSING_FILE, 'utf8'))); } catch { missing = new Set(); }
  }
  return missing;
}
function saveMissing() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(MISSING_FILE, JSON.stringify([...missingSet()].sort(), null, 0));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let quiet = false;
export function setQuiet(q) { quiet = q; }

/** Download one repo-relative file into the cache. Returns abs path or null (404). */
export async function fetchFile(rel, { retries = 4 } = {}) {
  const dst = path.join(CACHE_DIR, rel);
  if (fs.existsSync(dst)) return dst;
  if (missingSet().has(rel)) return null;
  const local = path.join(LOCAL_SAMPLES, rel);
  if (fs.existsSync(local)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(local, dst);
    return dst;
  }
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BASE_URL + rel);
      if (res.status === 404) { missingSet().add(rel); return null; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst + '.tmp', buf);
      fs.renameSync(dst + '.tmp', dst);
      if (!quiet) console.log(`[fetch_vanilla] ${rel}`);
      return dst;
    } catch (e) {
      lastErr = e;
      await sleep(300 * (attempt + 1));
    }
  }
  console.warn(`[fetch_vanilla] failed ${rel}: ${lastErr?.message}`);
  return null;
}

/** Parse JSON that may contain // and block comments (Mojang files do). */
export function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  let out = '', i = 0, inStr = false;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === '"') inStr = false;
      i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  // trailing commas
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

let registry = null;
/** blocks.json, terrain_texture.json, flipbook_textures.json (parsed). */
export async function loadVanillaRegistry() {
  if (registry) return registry;
  const [b, t, f] = await Promise.all([
    fetchFile('resource_pack/blocks.json'),
    fetchFile('resource_pack/textures/terrain_texture.json'),
    fetchFile('resource_pack/textures/flipbook_textures.json'),
  ]);
  if (!b || !t) throw new Error('fetch_vanilla: cannot obtain blocks.json / terrain_texture.json');
  saveMissing();
  registry = {
    blocks: parseJsonLoose(fs.readFileSync(b, 'utf8')),
    terrain: parseJsonLoose(fs.readFileSync(t, 'utf8')).texture_data,
    flipbooks: f ? parseJsonLoose(fs.readFileSync(f, 'utf8')) : [],
  };
  return registry;
}

// ------------------------------------------------------------------ TGA
/** Decode a TGA (types 1,2,3,9,10,11; 8/15/16/24/32 bpp). Returns { width, height, data: RGBA Uint8Array }. */
export function decodeTGA(buf) {
  const idLen = buf[0], cmType = buf[1], type = buf[2];
  const cmFirst = buf.readUInt16LE(3), cmLen = buf.readUInt16LE(5), cmDepth = buf[7];
  const width = buf.readUInt16LE(12), height = buf.readUInt16LE(14), bpp = buf[16], desc = buf[17];
  const alphaBits = desc & 0x0f, topDown = !!(desc & 0x20), rightLeft = !!(desc & 0x10);
  let p = 18 + idLen;
  let cmap = null;
  const readColor = (b, at, depth) => {
    if (depth === 32) return [b[at + 2], b[at + 1], b[at], b[at + 3]];
    if (depth === 24) return [b[at + 2], b[at + 1], b[at], 255];
    if (depth === 15 || depth === 16) {
      const v = b[at] | (b[at + 1] << 8);
      return [((v >> 10) & 31) * 255 / 31 | 0, ((v >> 5) & 31) * 255 / 31 | 0, (v & 31) * 255 / 31 | 0, depth === 16 && alphaBits ? ((v & 0x8000) ? 255 : 0) : 255];
    }
    if (depth === 8) return [b[at], b[at], b[at], 255];
    throw new Error('TGA: unsupported depth ' + depth);
  };
  if (cmType === 1) {
    const step = Math.ceil(cmDepth / 8);
    cmap = [];
    for (let i = 0; i < cmLen; i++) cmap.push(readColor(buf, p + i * step, cmDepth));
    p += cmLen * step;
  }
  const base = type & 7; // 1 = mapped, 2 = truecolor, 3 = grey
  const rle = type & 8;
  const pxBytes = Math.ceil(bpp / 8);
  const n = width * height;
  const raw = new Uint8Array(n * 4);
  const pixelAt = (at) => {
    if (base === 1) { const idx = pxBytes === 2 ? buf.readUInt16LE(at) : buf[at]; return cmap[idx - cmFirst] ?? [0, 0, 0, 0]; }
    if (base === 3) { const g = buf[at]; return [g, g, g, pxBytes === 2 ? buf[at + 1] : 255]; }
    return readColor(buf, at, bpp);
  };
  let i = 0;
  if (!rle) {
    for (; i < n; i++, p += pxBytes) raw.set(pixelAt(p), i * 4);
  } else {
    while (i < n) {
      const h = buf[p++];
      const cnt = (h & 0x7f) + 1;
      if (h & 0x80) { const c = pixelAt(p); p += pxBytes; for (let k = 0; k < cnt && i < n; k++, i++) raw.set(c, i * 4); }
      else { for (let k = 0; k < cnt && i < n; k++, i++, p += pxBytes) raw.set(pixelAt(p), i * 4); }
    }
  }
  // Some writers store 32-bit data with alphaBits = 0 and an all-zero alpha channel.
  if (bpp === 32 && alphaBits === 0) {
    let any = false;
    for (let k = 3; k < raw.length; k += 4) if (raw[k]) { any = true; break; }
    if (!any) for (let k = 3; k < raw.length; k += 4) raw[k] = 255;
  }
  // Reorder to top-down, left-to-right.
  const data = new Uint8Array(n * 4);
  for (let y = 0; y < height; y++) {
    const sy = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const sx = rightLeft ? width - 1 - x : x;
      const s = (sy * width + sx) * 4, d = (y * width + x) * 4;
      data[d] = raw[s]; data[d + 1] = raw[s + 1]; data[d + 2] = raw[s + 2]; data[d + 3] = raw[s + 3];
    }
  }
  return { width, height, data };
}

export function writePNG(file, { width, height, data }) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
}

/** Image file (png or tga) -> abs path of a PNG. TGAs inside the vanilla cache are converted next to
 * the original; TGAs anywhere else (e.g. in packs/) are converted into tools/.cache/render/tga/. */
export function toPNG(file) {
  if (!file) return null;
  if (file.toLowerCase().endsWith('.png')) return file;
  if (file.toLowerCase().endsWith('.tga')) {
    let out;
    if (path.resolve(file).startsWith(CACHE_DIR + path.sep)) out = file.slice(0, -4) + '.png';
    else {
      const rel = path.relative(ROOT, path.resolve(file)).replace(/[\\/:]/g, '_').replace(/^\.+/, '');
      out = path.join(ROOT, 'tools/.cache/render/tga', rel.slice(0, -4) + '.png');
    }
    if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(file).mtimeMs) writePNG(out, decodeTGA(fs.readFileSync(file)));
    return out;
  }
  return null;
}

/** Fetch an image by extension-less resource-pack path (e.g. 'textures/blocks/stone'):
 * tries .png then .tga. Returns PNG abs path or null. */
export async function fetchImage(relNoExt) {
  const png = await fetchFile('resource_pack/' + relNoExt + '.png');
  if (png) return png;
  const tga = await fetchFile('resource_pack/' + relNoExt + '.tga');
  return tga ? toPNG(tga) : null;
}

/** Texture set lookup for a vanilla color texture (extension-less resource-pack path).
 * Returns { color: abs png|null, mers: abs png|null, mersUniform, normal, heightmap }. */
const texCache = new Map();
export async function ensureTexture(relNoExt) {
  if (texCache.has(relNoExt)) return texCache.get(relNoExt);
  const job = (async () => {
    const color = await fetchImage(relNoExt);
    const out = { color, mers: null, mersKind: null, mersUniform: null, normal: null, heightmap: null };
    const setFile = await fetchFile('resource_pack/' + relNoExt + '.texture_set.json');
    if (setFile) {
      try {
        const ts = parseJsonLoose(fs.readFileSync(setFile, 'utf8'))['minecraft:texture_set'] || {};
        const dir = path.posix.dirname(relNoExt);
        for (const [key, kind] of [['metalness_emissive_roughness_subsurface', 'mers'], ['metalness_emissive_roughness', 'mer']]) {
          const v = ts[key];
          if (v === undefined) continue;
          if (typeof v === 'string' && !v.startsWith('#')) { out.mers = await fetchImage(`${dir}/${v}`); out.mersKind = kind; }
          else { out.mersUniform = v; out.mersKind = kind; }
        }
        if (typeof ts.normal === 'string') out.normal = await fetchImage(`${dir}/${ts.normal}`);
        if (typeof ts.heightmap === 'string') out.heightmap = await fetchImage(`${dir}/${ts.heightmap}`);
      } catch (e) { console.warn('[fetch_vanilla] bad texture set', relNoExt, e.message); }
    }
    return out;
  })();
  texCache.set(relNoExt, job);
  return job;
}

/** Ensure many textures with limited concurrency. Returns Map(rel -> ensureTexture result). */
export async function ensureTextures(rels, { concurrency = 12 } = {}) {
  const list = [...new Set(rels)];
  const out = new Map();
  let k = 0;
  const worker = async () => { while (k < list.length) { const r = list[k++]; out.set(r, await ensureTexture(r)); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  saveMissing();
  return out;
}

// ------------------------------------------------------------------ CLI
// (not awaited at top level: blocks.mjs imports this module, so module evaluation must finish first)
async function main() {
  const args = process.argv.slice(2);
  const reg = await loadVanillaRegistry();
  console.log(`registry: ${Object.keys(reg.blocks).length} blocks, ${Object.keys(reg.terrain).length} terrain textures`);
  let rels = [];
  if (args.includes('--all')) {
    for (const v of Object.values(reg.terrain)) {
      const t = v.textures;
      const list = Array.isArray(t) ? t : [t];
      for (const x of list) { const p = typeof x === 'string' ? x : x?.path; if (p) rels.push(p); }
    }
  }
  const pk = args.indexOf('--packs');
  const packs = pk >= 0 ? args[pk + 1].split(',').map((p) => path.resolve(p)) : [];
  const snaps = args.filter((a, i) => !a.startsWith('--') && !(pk >= 0 && i === pk + 1));
  if (snaps.length) {
    const { createBlockResolver } = await import('./blocks.mjs');
    const resolver = await createBlockResolver({ packs });
    for (const s of snaps) {
      const snap = JSON.parse(fs.readFileSync(s, 'utf8'));
      for (const e of snap.palette) resolver.resolve(e);
    }
    rels.push(...resolver.vanillaTexturePaths());
  }
  const res = await ensureTextures(rels);
  const miss = [...res].filter(([, v]) => !v.color).map(([k]) => k);
  console.log(`textures: ${res.size} ok=${res.size - miss.length}${miss.length ? ' missing: ' + miss.join(', ') : ''}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
