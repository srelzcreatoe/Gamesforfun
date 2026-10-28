// Node-side block resolution for the world renderer.
// Turns voxel-snapshot palette entries ({ name, states }) into render descriptors:
//  * vanilla blocks: shape class + per-face textures via Mojang's blocks.json /
//    terrain_texture.json (+ vanilla VV texture sets: MERS),
//  * custom blocks (fnar:* or any namespace found in a behaviour pack): BP block JSON
//    with permutations (tiny molang), geometry, material instances, transformation,
//    light emission/dampening, RP terrain textures, texture sets (MER + heightmap/normal),
//    flipbooks and local lighting colours.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { loadVanillaRegistry, ensureTextures, toPNG, parseJsonLoose, ROOT } from './fetch_vanilla.mjs';
import { processTexture } from './texproc.mjs';

// ------------------------------------------------------------------ molang (subset)
/** Evaluate a simple molang expression. ctx.state(name) returns a block state value. */
export function evalMolang(src, ctx = {}) {
  if (typeof src === 'boolean' || typeof src === 'number') return src;
  if (typeof src !== 'string') return 0;
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?f?)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([A-Za-z_][\w.:]*)|(==|!=|<=|>=|&&|\|\||\?\?|[()+\-*/<>!?:,;]))/gy;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(at))) break; throw new Error(`molang: bad token at ${at} in ${src}`); }
    if (m[1] !== undefined) toks.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) toks.push({ t: 'str', v: m[2].slice(1, -1) });
    else if (m[3] !== undefined) toks.push({ t: 'id', v: m[3] });
    else if (m[4] !== undefined) toks.push({ t: 'op', v: m[4] });
  }
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`molang: expected ${v} in ${src}`); i++; };
  const truthy = (v) => (typeof v === 'string' ? v.length > 0 : !!v);
  const num = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? v : Number(v) || 0);
  const eq = (a, b) => {
    if (typeof a === 'string' || typeof b === 'string') return String(a) === String(b);
    return num(a) === num(b);
  };
  function primary() {
    const tk = toks[i++];
    if (!tk) throw new Error('molang: unexpected end');
    if (tk.t === 'num' || tk.t === 'str') return tk.v;
    if (tk.t === 'op' && tk.v === '(') { const v = ternary(); expect(')'); return v; }
    if (tk.t === 'op' && tk.v === '!') return !truthy(unary());
    if (tk.t === 'op' && tk.v === '-') return -num(unary());
    if (tk.t === 'id') {
      const id = tk.v.toLowerCase();
      if (id === 'true') return true;
      if (id === 'false') return false;
      let args = null;
      if (isOp('(')) {
        i++; args = [];
        while (!isOp(')')) { args.push(ternary()); if (isOp(',')) i++; }
        i++;
      }
      const fn = id.replace(/^query\./, 'q.');
      if (fn === 'q.block_state' || fn === 'q.block_property') return ctx.state ? ctx.state(args?.[0]) : 0;
      if (fn === 'q.has_block_state') return ctx.state ? ctx.state(args?.[0]) !== undefined : false;
      if (fn.startsWith('math.') && args) {
        const f = Math[fn.slice(5)];
        if (typeof f === 'function') return f(...args.map(num));
      }
      if (ctx.vars && id in ctx.vars) return ctx.vars[id];
      return 0;
    }
    throw new Error(`molang: unexpected ${tk.v}`);
  }
  function unary() { return primary(); }
  function mul() { let a = unary(); while (isOp('*') || isOp('/')) { const o = toks[i++].v; const b = unary(); a = o === '*' ? num(a) * num(b) : num(a) / num(b); } return a; }
  function add() { let a = mul(); while (isOp('+') || isOp('-')) { const o = toks[i++].v; const b = mul(); a = o === '+' ? num(a) + num(b) : num(a) - num(b); } return a; }
  function cmp() {
    let a = add();
    while (peek() && peek().t === 'op' && ['<', '>', '<=', '>='].includes(peek().v)) {
      const o = toks[i++].v; const b = add();
      a = o === '<' ? num(a) < num(b) : o === '>' ? num(a) > num(b) : o === '<=' ? num(a) <= num(b) : num(a) >= num(b);
    }
    return a;
  }
  function equality() {
    let a = cmp();
    while (isOp('==') || isOp('!=')) { const o = toks[i++].v; const b = cmp(); a = o === '==' ? eq(a, b) : !eq(a, b); }
    return a;
  }
  function and() { let a = equality(); while (isOp('&&')) { i++; const b = equality(); a = truthy(a) && truthy(b); } return a; }
  function or() { let a = and(); while (isOp('||')) { i++; const b = and(); a = truthy(a) || truthy(b); } return a; }
  function ternary() {
    const c = or();
    if (isOp('?')) { i++; const a = ternary(); expect(':'); const b = ternary(); return truthy(c) ? a : b; }
    return c;
  }
  let v = ternary();
  while (isOp(';')) { i++; if (i < toks.length) v = ternary(); }
  return v;
}
export const molangTruthy = (v) => (typeof v === 'string' ? v.length > 0 : !!v);

// ------------------------------------------------------------------ vanilla tables
// [light level, colour, VV light type]
const WARM = '#ffc98a';
export const VANILLA_EMITTERS = {
  lantern: [15, '#ffb35c', 'point'], soul_lantern: [10, '#6fd8ff', 'point'],
  copper_lantern: [15, '#b6f5c4', 'point'], exposed_copper_lantern: [15, '#b6f5c4', 'point'], weathered_copper_lantern: [15, '#b6f5c4', 'point'], oxidized_copper_lantern: [15, '#b6f5c4', 'point'],
  waxed_copper_lantern: [15, '#b6f5c4', 'point'], waxed_exposed_copper_lantern: [15, '#b6f5c4', 'point'], waxed_weathered_copper_lantern: [15, '#b6f5c4', 'point'], waxed_oxidized_copper_lantern: [15, '#b6f5c4', 'point'],
  seaLantern: [15, '#d9f6ff', 'point'], lit_redstone_lamp: [15, '#ffcf8f', 'point'], glowstone: [15, '#ffdc9a', 'point'],
  torch: [14, '#ffb867', 'point'], soul_torch: [10, '#6fd8ff', 'point'], redstone_torch: [7, '#ff4a2e', 'point'], copper_torch: [14, '#a6f2b8', 'point'],
  end_rod: [14, '#f6ecff', 'point'], shroomlight: [15, '#ffad6b', 'point'], ochre_froglight: [15, '#ffe9a8', 'point'],
  verdant_froglight: [15, '#d6ffb0', 'point'], pearlescent_froglight: [15, '#f6d0ff', 'point'], lit_pumpkin: [15, '#ffb050', 'point'],
  beacon: [15, '#e0f8ff', 'point'], campfire: [15, '#ffa040', 'point'], soul_campfire: [10, '#6fd8ff', 'point'],
  lit_furnace: [13, '#ffa040', 'point'], lit_blast_furnace: [13, '#ffa040', 'point'], lit_smoker: [13, '#ffa040', 'point'],
  magma: [3, '#ff6020', 'static'], crying_obsidian: [10, '#a050ff', 'static'], glow_lichen: [7, '#c8f0d0', 'static'],
  amethyst_cluster: [5, '#d8a0ff', 'static'], enchanting_table: [7, '#c0a0ff', 'static'], ender_chest: [7, '#80ffd0', 'static'],
  brewing_stand: [1, WARM, 'static'], conduit: [15, '#d0f0ff', 'point'], lava: [15, '#ff7020', 'point'], flowing_lava: [15, '#ff7020', 'point'],
  fire: [15, '#ff9a30', 'point'], soul_fire: [10, '#6fd8ff', 'point'], lit_redstone_ore: [9, '#ff4a2e', 'static'], lit_deepslate_redstone_ore: [9, '#ff4a2e', 'static'],
  sea_pickle: [6, '#b0ffd0', 'static'], portal: [11, '#a050ff', 'static'], end_gateway: [15, '#ffffff', 'static'],
  respawn_anchor: [0, '#a050ff', 'static'], cave_vines_body_with_berries: [14, '#ffc060', 'point'], cave_vines_head_with_berries: [14, '#ffc060', 'point'],
  copper_bulb: [0, WARM, 'point'], sculk_catalyst: [6, '#80ffe0', 'static'], small_amethyst_bud: [1, '#d8a0ff', 'static'],
  medium_amethyst_bud: [2, '#d8a0ff', 'static'], large_amethyst_bud: [4, '#d8a0ff', 'static'],
};
const LIGHT_BLOCK_COLOR = '#ffeedd';

const ALIASES = {
  grass_block: 'grass', iron_chain: 'chain', sea_lantern: 'seaLantern', dark_oak_wall_sign: 'darkoak_wall_sign',
  dark_oak_standing_sign: 'darkoak_standing_sign', oak_wall_sign: 'wall_sign', oak_standing_sign: 'standing_sign',
  lit_pumpkin: 'lit_pumpkin', unlit_redstone_torch: 'unlit_redstone_torch', underwater_torch: 'torch',
  colored_torch_red: 'torch', colored_torch_blue: 'torch', colored_torch_green: 'torch', colored_torch_purple: 'torch',
  // convenience names (the 1.26 ids are the legacy ones on the right)
  oak_trapdoor: 'trapdoor', oak_button: 'wooden_button', oak_pressure_plate: 'wooden_pressure_plate', oak_fence_gate: 'fence_gate',
  oak_door: 'wooden_door', dark_oak_standing_sign: 'darkoak_standing_sign', oak_leaves: 'oak_leaves',
};
const DOOR_INDEX = { wooden_door: 0, oak_door: 0, spruce_door: 1, birch_door: 2, jungle_door: 3, acacia_door: 4, dark_oak_door: 5, iron_door: 6 };
const PILLAR_EXTRA = new Set(['basalt', 'polished_basalt', 'quartz_pillar', 'purpur_pillar', 'bone_block', 'hay_block', 'deepslate', 'infested_deepslate',
  'muddy_mangrove_roots', 'bamboo_block', 'stripped_bamboo_block', 'ochre_froglight', 'verdant_froglight', 'pearlescent_froglight', 'creaking_heart']);
const CROSS = /^(short_grass|tallgrass|fern|dead_bush|deadbush|sapling|.*_sapling|poppy|dandelion|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|web|cobweb|brown_mushroom|red_mushroom|crimson_roots|warped_roots|nether_sprouts|short_dry_grass|bush|firefly_bush|open_eyeblossom|closed_eyeblossom|pink_petals_none)$/;

/** Shape class for a vanilla block (name without namespace, after aliasing). */
export function vanillaShape(n) {
  if (n === 'air' || n.startsWith('light_block') || n === 'barrier' || n === 'structure_void' || n === 'trip_wire' || n === 'tripwire' || n === 'moving_block' || n === 'piston_arm_collision' || n === 'sticky_piston_arm_collision') return 'none';
  if (/_double_slab$/.test(n)) return 'cube';
  if (/_slab$/.test(n)) return 'slab';
  if (/_stairs$/.test(n)) return 'stairs';
  if (/carpet$/.test(n)) return 'carpet';
  if (/trapdoor$/.test(n)) return 'trapdoor';
  if (/door$/.test(n)) return 'door';
  if (/(^|_)bars$/.test(n) || /glass_pane$/.test(n)) return 'pane';
  if (/(^|_)chain$/.test(n)) return 'chain';
  if (/lantern$/.test(n) && n !== 'seaLantern') return 'lantern';
  if (/fence_gate$/.test(n)) return 'fence_gate';
  if (/fence$/.test(n)) return 'fence';
  if (/_wall$/.test(n) && !/sign/.test(n)) return 'wall';
  if (/button$/.test(n)) return 'button';
  if (/wall_sign$/.test(n)) return 'wall_sign';
  if (/standing_sign$/.test(n)) return 'standing_sign';
  if (/hanging_sign$/.test(n)) return 'hanging_sign';
  if (n === 'ladder') return 'ladder';
  if (/cake$/.test(n)) return 'cake';
  if (n === 'flower_pot') return 'flower_pot';
  if (/(_log|_wood|_stem|_hyphae)$/.test(n) || PILLAR_EXTRA.has(n)) return 'pillar';
  if (n === 'barrel') return 'barrel';
  if (/torch$/.test(n) && n !== 'torchflower') return 'torch';
  if (n === 'end_rod' || /lightning_rod$/.test(n)) return 'rod';
  if (/pressure_plate$/.test(n)) return 'plate';
  if (n === 'snow_layer') return 'snow_layer';
  if (CROSS.test(n)) return 'cross';
  if (/leaves/.test(n)) return 'leaves';
  if (/glass$/.test(n) || n === 'ice' || n === 'slime' || n === 'honey_block') return 'glass';
  return 'cube';
}

// ------------------------------------------------------------------ helpers
function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out); else if (pred(p)) out.push(p);
  }
  return out;
}
function readJson(file, warn) {
  try { return parseJsonLoose(fs.readFileSync(file, 'utf8')); } catch (e) { warn?.(`cannot parse ${file}: ${e.message}`); return null; }
}
function findImage(base) {
  for (const ext of ['.png', '.tga', '.PNG', '.TGA']) if (fs.existsSync(base + ext)) return toPNG(base + ext);
  return null;
}
function hexColor(v) {
  if (typeof v === 'string') return v.startsWith('#') ? v.slice(0, 7) : null;
  if (Array.isArray(v) && v.length >= 3) {
    const f = v.some((x) => x > 1) ? 1 : 255;
    return '#' + v.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round(x * f))).toString(16).padStart(2, '0')).join('');
  }
  if (v && typeof v === 'object' && 'r' in v) return hexColor([v.r, v.g, v.b]);
  return null;
}
const vec3 = (v, d) => (Array.isArray(v) ? [v[0] ?? d, v[1] ?? d, v[2] ?? d] : v && typeof v === 'object' ? [v.x ?? d, v.y ?? d, v.z ?? d] : [d, d, d]);

/** Load one pack pair { bp, rp } (either may be missing). */
function loadPack(name, bpDir, rpDir, warn) {
  const pack = { name, bp: bpDir, rp: rpDir, blocks: new Map(), terrain: {}, geos: new Map(), lights: {}, flipbooks: new Set(), flipTiles: new Set() };
  for (const f of walk(path.join(bpDir, 'blocks'), (p) => p.endsWith('.json'))) {
    const j = readJson(f, warn);
    const b = j?.['minecraft:block'];
    const id = b?.description?.identifier;
    if (id) pack.blocks.set(id, { def: b, file: f });
  }
  const tt = readJson(path.join(rpDir, 'textures/terrain_texture.json'));
  if (tt?.texture_data) pack.terrain = tt.texture_data;
  const fb = readJson(path.join(rpDir, 'textures/flipbook_textures.json'));
  for (const e of Array.isArray(fb) ? fb : []) { if (e.flipbook_texture) pack.flipbooks.add(e.flipbook_texture); if (e.atlas_tile) pack.flipTiles.add(e.atlas_tile); }
  const ll = readJson(path.join(rpDir, 'local_lighting/local_lighting.json'));
  if (ll) pack.lights = ll['minecraft:local_light_settings'] ?? ll['minecraft:local_lighting_settings'] ?? {};
  for (const f of walk(path.join(rpDir, 'models'), (p) => p.endsWith('.json'))) {
    const j = readJson(f, warn);
    if (!j) continue;
    if (Array.isArray(j['minecraft:geometry'])) {
      for (const g of j['minecraft:geometry']) if (g?.description?.identifier) pack.geos.set(g.description.identifier, { format_version: j.format_version, 'minecraft:geometry': [g] });
    } else {
      for (const [k, g] of Object.entries(j)) {
        if (!k.startsWith('geometry.')) continue;
        const id = k.split(':')[0];
        pack.geos.set(id, { format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: id, texture_width: g.texturewidth ?? 16, texture_height: g.textureheight ?? 16 }, bones: g.bones ?? [] }] });
      }
    }
  }
  return pack;
}

function analyzeAlpha(file) {
  try {
    const png = PNG.sync.read(fs.readFileSync(file));
    let cut = 0, semi = 0;
    const d = png.data;
    for (let k = 3; k < d.length; k += 4) { const a = d[k]; if (a < 250) { if (a > 8) semi++; else cut++; } }
    const n = d.length / 4;
    return { w: png.width, h: png.height, alpha: semi > n * 0.08 ? 'blend' : (cut + semi) > 0 ? 'cutout' : 'opaque' };
  } catch { return { w: 16, h: 16, alpha: 'opaque' }; }
}

// ------------------------------------------------------------------ resolver
/**
 * @param {object} o
 * @param {string} [o.root] project root (packs/BP, packs/RP)
 * @param {string[]} [o.packs] extra pack folders, each with BP/ and/or RP/ (e.g. test fixtures)
 */
export async function createBlockResolver({ root = ROOT, packs = [] } = {}) {
  const reg = await loadVanillaRegistry();
  const warnings = new Set();
  const warn = (m) => { if (!warnings.has(m)) { warnings.add(m); console.warn('[blocks] ' + m); } };
  const packList = [loadPack('main', path.join(root, 'packs/BP'), path.join(root, 'packs/RP'), warn)];
  // Not-yet-merged registry fragments (tools/fragments/*.json) fill gaps in the main pack.
  const fragDir = path.join(root, 'tools/fragments');
  if (fs.existsSync(fragDir)) {
    const main = packList[0];
    for (const f of fs.readdirSync(fragDir).filter((x) => x.endsWith('.json')).sort()) {
      const j = readJson(path.join(fragDir, f), warn);
      if (!j) continue;
      if (f.startsWith('terrain_')) for (const [k, v] of Object.entries(j)) { if (!(k in main.terrain)) main.terrain[k] = v; }
      else if (f.startsWith('flipbook_') && Array.isArray(j)) for (const e of j) { if (e.flipbook_texture) main.flipbooks.add(e.flipbook_texture); if (e.atlas_tile) main.flipTiles.add(e.atlas_tile); }
      else if (f.startsWith('local_lighting_')) for (const [k, v] of Object.entries(j)) { if (!(k in main.lights)) main.lights[k] = v; }
    }
  }
  packs.forEach((p, k) => packList.push(loadPack('x' + k, path.join(p, 'BP'), path.join(p, 'RP'), warn)));
  const vanillaFlip = new Set(reg.flipbooks.map((e) => e.flipbook_texture));

  const textures = new Map(); // id -> descriptor
  const geometries = new Map(); // identifier -> geo json
  const cache = new Map();

  // ---- textures
  function vanillaTex(shortName, index = 0, tint = null, tintMode = 'full') {
    const e = reg.terrain[shortName];
    if (!e) { warn(`vanilla texture '${shortName}' not in terrain_texture.json`); return missingTex(); }
    let t = e.textures;
    if (Array.isArray(t)) t = t[Math.max(0, Math.min(t.length - 1, index))];
    const rel = typeof t === 'string' ? t : t?.path;
    if (!rel) return missingTex();
    const id = `v:${rel}${tint ? '#' + tint + tintMode[0] : ''}`;
    if (!textures.has(id)) textures.set(id, { id, vanilla: rel, tint, tintMode, flipbook: vanillaFlip.has(rel) });
    return id;
  }
  function missingTex() {
    const id = 'missing';
    if (!textures.has(id)) textures.set(id, { id, missing: true });
    return id;
  }
  function packTex(pack, shortName) {
    let e = pack.terrain[shortName];
    let owner = pack;
    if (!e) { for (const p of packList) if (p.terrain[shortName]) { e = p.terrain[shortName]; owner = p; break; } }
    if (!e) {
      if (reg.terrain[shortName]) return vanillaTex(shortName); // custom blocks may use vanilla textures
      warn(`texture '${shortName}' not found in any terrain_texture.json`);
      return missingTex();
    }
    let t = e.textures;
    let variants = null;
    if (t && !Array.isArray(t) && typeof t === 'object' && Array.isArray(t.variations)) variants = t.variations;
    if (Array.isArray(t)) t = t[0];
    if (variants) {
      const ids = variants.map((v, k) => texFromPath(owner, typeof v === 'string' ? v : v.path, `${shortName}~${k}`, null, shortName));
      const id = `p:${owner.name}:${shortName}~var`;
      textures.set(id, { id, variants: ids, weights: variants.map((v) => v.weight ?? 1) });
      return id;
    }
    const rel = typeof t === 'string' ? t : t?.path;
    return texFromPath(owner, rel, shortName, t?.overlay_color ?? t?.tint_color ?? null, shortName);
  }
  function texFromPath(pack, rel, label, overlay, shortName) {
    if (!rel) return missingTex();
    const id = `p:${pack.name}:${rel}`;
    if (textures.has(id)) return id;
    const base = path.join(pack.rp, rel);
    const color = findImage(base);
    if (!color) warn(`texture file missing: ${base}.png`);
    const d = { id, file: color, missing: !color, tint: overlay ? hexColor(overlay) : null, tintMode: 'overlay', flipbook: pack.flipbooks.has(rel) || pack.flipTiles.has(shortName), mers: null, mersKind: null, mersUniform: null, normal: null, height: null };
    const setFile = base + '.texture_set.json';
    if (fs.existsSync(setFile)) {
      const ts = readJson(setFile, warn)?.['minecraft:texture_set'] ?? {};
      const dir = path.dirname(base);
      for (const [key, kind] of [['metalness_emissive_roughness_subsurface', 'mers'], ['metalness_emissive_roughness', 'mer']]) {
        const v = ts[key];
        if (v === undefined) continue;
        d.mersKind = kind;
        if (typeof v === 'string' && !v.startsWith('#')) { d.mers = findImage(path.join(dir, v)); if (!d.mers) warn(`MER texture missing: ${path.join(dir, v)}`); }
        else d.mersUniform = Array.isArray(v) ? v : hexToArr(v);
      }
      if (typeof ts.heightmap === 'string' && !ts.heightmap.startsWith('#')) { d.height = findImage(path.join(dir, ts.heightmap)); if (!d.height) warn(`heightmap missing: ${path.join(dir, ts.heightmap)}`); }
      if (typeof ts.normal === 'string' && !ts.normal.startsWith('#')) d.normal = findImage(path.join(dir, ts.normal));
    }
    textures.set(id, d);
    return id;
  }
  const hexToArr = (h) => { const c = hexColor(h); return c ? [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)) : null; };

  // ---- vanilla
  function resolveVanilla(name, states) {
    let n = name.replace(/^minecraft:/, '');
    n = ALIASES[n] ?? n;
    if (n.startsWith('hard_')) n = n.slice(5);
    if (n.startsWith('element_') || n === 'unknown') n = 'stone';
    const shape = vanillaShape(n);
    const out = { name, states, kind: 'vanilla', shape, tex: {}, emit: 0, lightColor: null, lightType: null, dampen: 0, cubeLike: false };
    const em = VANILLA_EMITTERS[n];
    if (em) { out.emit = em[0]; out.lightColor = em[1]; out.lightType = em[2]; }
    if (n === 'copper_bulb' || /copper_bulb$/.test(n)) { if (states?.lit) { out.emit = 15; out.lightColor = '#ffd59a'; } }
    if (/candle$/.test(n) && states?.lit) { out.emit = 3 * ((states.candles ?? 0) + 1); out.lightColor = '#ffb867'; out.lightType = 'point'; }
    if (/candle_cake$/.test(n) && states?.lit) { out.emit = 3; out.lightColor = '#ffb867'; out.lightType = 'point'; }
    if (n === 'respawn_anchor') out.emit = [0, 3, 7, 11, 15][states?.respawn_anchor_charge ?? 0] ?? 0;
    if (n === 'sea_pickle' && !states?.dead_bit) out.emit = 6 + 3 * (states?.cluster_count ?? 0);
    if (n.startsWith('light_block')) {
      const lvl = n === 'light_block' ? (states?.block_light_level ?? 15) : parseInt(n.slice('light_block_'.length), 10);
      out.kind = 'invisible'; out.emit = Number.isFinite(lvl) ? lvl : 15; out.lightColor = LIGHT_BLOCK_COLOR; out.lightType = 'static';
      return out;
    }
    if (shape === 'none') { out.kind = n === 'air' ? 'air' : 'invisible'; return out; }
    const bj = reg.blocks[n];
    let td = bj?.textures ?? (reg.terrain[n] ? n : null);
    if (!td) {
      warn(`no textures for ${name} (rendered with missing texture)`);
      td = null;
    }
    out.isotropic = bj?.isotropic === true ? { up: true, down: true } : (bj?.isotropic || null);
    const pick = (face) => {
      if (!td) return null;
      if (typeof td === 'string') return td;
      if (td[face]) return td[face];
      if (['north', 'south', 'east', 'west'].includes(face) && td.side) return td.side;
      return td.side ?? td.up ?? Object.values(td)[0];
    };
    let tint = null;
    if (n === 'grass') tint = '#79c05a';
    if (/leaves/.test(n) || n === 'vine' || shape === 'cross' && /grass|fern|bush/.test(n)) tint = /leaves/.test(n) ? '#48b518' : '#79c05a';
    for (const face of ['up', 'down', 'north', 'south', 'east', 'west']) {
      const s = pick(face);
      if (!s) { out.tex[face] = missingTex(); continue; }
      let idx = 0;
      if (shape === 'door') idx = DOOR_INDEX[n] ?? 0;
      if (n === 'barrel' && face === 'north') idx = states?.open_bit ? 1 : 0;
      if (/cake$/.test(n) && face === 'west') idx = (states?.bite_counter ?? 0) > 0 ? 1 : 0;
      if (/candle$/.test(n)) idx = states?.lit ? 1 : 0;
      let t = null, mode = 'full';
      if (n === 'grass') { if (face === 'up') t = tint; else if (face !== 'down') { t = tint; mode = 'overlay'; } }
      else if (tint) t = tint;
      out.tex[face] = vanillaTex(s, idx, t, mode);
    }
    if (shape === 'door') {
      out.tex.lower = vanillaTex(pick('down'), DOOR_INDEX[n] ?? 0);
      out.tex.upper = vanillaTex(pick('north'), DOOR_INDEX[n] ?? 0);
    }
    if (shape === 'flower_pot') out.tex.dirt = vanillaTex('dirt');
    if (shape === 'cake') out.tex.inner = vanillaTex('cake_west', 1);
    out.cubeLike = ['cube', 'pillar', 'barrel', 'glass', 'leaves'].includes(shape);
    out.cullSame = shape === 'glass' || shape === 'leaves';
    out.dampen = shape === 'leaves' ? 1 : 0; // full opaque cubes get 15 in finalize()
    return out;
  }

  // ---- custom
  function findCustom(name) {
    for (const p of packList) { const b = p.blocks.get(name); if (b) return { pack: p, ...b }; }
    return null;
  }
  function stateDefaults(def) {
    const st = {};
    for (const [k, v] of Object.entries(def.description?.states ?? def.description?.properties ?? {})) {
      if (Array.isArray(v)) st[k] = v[0];
      else if (v && typeof v === 'object' && v.values) st[k] = v.values.min ?? 0;
    }
    const traits = def.description?.traits ?? {};
    const pd = traits['minecraft:placement_direction'];
    if (pd) for (const s of pd.enabled_states ?? []) st[s] = s === 'minecraft:cardinal_direction' ? 'south' : 'down';
    const pp = traits['minecraft:placement_position'];
    if (pp) for (const s of pp.enabled_states ?? []) st[s] = s === 'minecraft:vertical_half' ? 'bottom' : 'down';
    return st;
  }
  function resolveCustom(c, name, states) {
    const def = c.def;
    const st = { ...stateDefaults(def), ...(states ?? {}) };
    const ctx = { state: (k) => st[k] };
    let comps = { ...(def.components ?? {}) };
    for (const perm of def.permutations ?? []) {
      let ok = false;
      try { ok = molangTruthy(evalMolang(perm.condition ?? 'false', ctx)); } catch (e) { warn(`${name}: bad condition '${perm.condition}': ${e.message}`); }
      if (ok) comps = { ...comps, ...(perm.components ?? {}) };
    }
    const out = { name, states: st, kind: 'custom', emit: 0, lightColor: null, lightType: null, dampen: 15, custom: null };
    // geometry
    let g = comps['minecraft:geometry'];
    if (comps['minecraft:unit_cube'] !== undefined && !g) g = 'minecraft:geometry.full_block';
    let geoId = typeof g === 'string' ? g : g?.identifier;
    if (!geoId) geoId = 'minecraft:geometry.full_block';
    const boneVis = {};
    if (g && typeof g === 'object' && g.bone_visibility) {
      for (const [bone, v] of Object.entries(g.bone_visibility)) {
        try { boneVis[bone] = molangTruthy(evalMolang(v, ctx)); } catch { boneVis[bone] = true; }
      }
    }
    let geometry = 'full_block';
    if (geoId !== 'minecraft:geometry.full_block') {
      let found = null;
      for (const p of [c.pack, ...packList]) { if (p.geos.has(geoId)) { found = p.geos.get(geoId); break; } }
      if (found) { geometries.set(geoId, found); geometry = geoId; } else warn(`${name}: geometry ${geoId} not found (drawn as full block)`);
    }
    // material instances
    const mi = comps['minecraft:material_instances'] ?? {};
    const mats = {};
    const resolveInst = (key, depth = 0) => {
      let v = mi[key];
      if (typeof v === 'string' && depth < 8) return resolveInst(v, depth + 1);
      return v;
    };
    for (const key of Object.keys(mi)) {
      const v = resolveInst(key);
      if (!v || typeof v !== 'object') continue;
      const rm = v.render_method ?? 'opaque';
      mats[key] = {
        tex: v.texture ? packTex(c.pack, v.texture) : missingTex(),
        render: /blend/.test(rm) && !/to_opaque/.test(rm) ? 'blend' : /alpha_test|double_sided/.test(rm) && !/to_opaque/.test(rm) ? 'alpha_test' : 'opaque',
        doubleSided: !/single_sided/.test(rm) && /alpha_test|double_sided|blend/.test(rm),
        faceDimming: v.face_dimming !== false,
        ao: v.ambient_occlusion === undefined ? true : !!v.ambient_occlusion,
        isotropic: !!v.isotropic,
      };
    }
    if (!mats['*'] && !Object.keys(mats).length) { warn(`${name}: no material_instances`); mats['*'] = { tex: missingTex(), render: 'opaque', faceDimming: true, ao: true }; }
    // transformation
    const tr = comps['minecraft:transformation'];
    const transform = tr ? {
      rotation: vec3(tr.rotation, 0), rotation_pivot: vec3(tr.rotation_pivot, 0),
      translation: vec3(tr.translation, 0), scale: vec3(tr.scale, 1), scale_pivot: vec3(tr.scale_pivot, 0),
    } : null;
    out.custom = { geometry, boneVisibility: boneVis, materials: mats, transform, uvLock: !!(g && typeof g === 'object' && g.uv_lock) };
    // light
    const le = comps['minecraft:light_emission'];
    out.emit = typeof le === 'number' ? le : (le?.emission ?? le?.value ?? 0);
    const ld = comps['minecraft:light_dampening'];
    out.dampen = typeof ld === 'number' ? ld : (ld?.lightLevel ?? ld?.value ?? 15);
    let lc = null, lt = null;
    for (const p of [c.pack, ...packList]) {
      const e = p.lights?.[name];
      if (e) { lc = hexColor(e.light_color ?? e.color ?? e.colour ?? e.colors); lt = e.light_type ?? e.type ?? null; break; }
    }
    out.lightColor = lc ?? (out.emit > 0 ? WARM : null);
    out.lightType = lt ?? (out.emit > 0 ? 'point' : null);
    out.cubeLike = geometry === 'full_block';
    return out;
  }

  function resolve(entry) {
    const key = JSON.stringify([entry.name, entry.states ?? {}]);
    if (cache.has(key)) return cache.get(key);
    let r;
    const name = entry.name ?? 'minecraft:air';
    const c = findCustom(name);
    if (c) r = resolveCustom(c, name, entry.states);
    else if (!name.startsWith('minecraft:') && name.includes(':')) {
      warn(`unknown custom block ${name} (rendered as missing-texture cube)`);
      r = { name, states: entry.states ?? {}, kind: 'vanilla', shape: 'cube', tex: Object.fromEntries(['up', 'down', 'north', 'south', 'east', 'west'].map((f) => [f, missingTex()])), emit: 0, dampen: 15, cubeLike: true };
    } else r = resolveVanilla(name, entry.states ?? {});
    cache.set(key, r);
    return r;
  }

  function vanillaTexturePaths() {
    return [...textures.values()].filter((t) => t.vanilla).map((t) => t.vanilla);
  }

  /** Download/convert/process textures, analyse alpha, compute opacity flags. urlFor(absPath) -> URL. */
  async function finalize(resolvedList, urlFor) {
    const got = await ensureTextures(vanillaTexturePaths());
    // emitting custom blocks without MER: guess emissive pixels from brightness
    for (const r of resolvedList) {
      if (r?.kind !== 'custom' || !(r.emit > 0)) continue;
      for (const m of Object.values(r.custom.materials)) { const t = textures.get(m.tex); if (t && !t.variants) t.autoEmissiveCandidate = true; }
    }
    for (const t of textures.values()) {
      if (t.vanilla) {
        const g = got.get(t.vanilla) ?? {};
        t.file = g.color; t.missing = !g.color; t.mers = g.mers; t.mersKind = g.mersKind; t.mersUniform = g.mersUniform; t.normal = g.normal; t.height = g.heightmap;
        if (!g.color) warn(`vanilla texture not available: ${t.vanilla}`);
      }
      if (t.variants) continue;
      if (t.missing || !t.file) { t.alpha = 'opaque'; t.frames = 1; processTexture(t); }
      else {
        const a = analyzeAlpha(t.file);
        t.w = a.w; t.h = a.h;
        t.alpha = t.tint && t.tintMode === 'overlay' ? 'opaque' : a.alpha;
        t.frames = t.flipbook && a.h > a.w && a.h % a.w === 0 ? a.h / a.w : 1;
        t.autoEmissive = !!t.autoEmissiveCandidate && !t.mers && !t.mersUniform;
        processTexture(t);
      }
      t.url = urlFor(t.colorFile);
      t.pbrUrl = t.pbrFile ? urlFor(t.pbrFile) : null;
      t.emiUrl = t.emiFile ? urlFor(t.emiFile) : null;
      t.nrmUrl = t.nrmFile ? urlFor(t.nrmFile) : null;
    }
    for (const r of resolvedList) {
      if (!r) continue;
      if (r.kind === 'vanilla') {
        const faces = ['up', 'down', 'north', 'south', 'east', 'west'].map((f) => textures.get(r.tex[f]));
        r.full = r.cubeLike && r.shape !== 'glass' && r.shape !== 'leaves' && faces.every((t) => t && (t.alpha === 'opaque' || t.variants));
        if (r.full) r.dampen = 15;
      } else if (r.kind === 'custom') {
        const mats = Object.values(r.custom.materials);
        r.full = r.custom.geometry === 'full_block' && mats.every((m) => m.render === 'opaque') && !r.custom.transform?.scale?.some((s) => s !== 1);
      } else r.full = false;
    }
    const texOut = {};
    for (const t of textures.values()) {
      texOut[t.id] = t.variants ? { id: t.id, variants: t.variants, weights: t.weights } : {
        id: t.id, url: t.url, missing: !!t.missing, alpha: t.alpha, w: t.w ?? 16, h: (t.h ?? 16) / (t.frames ?? 1), frames: t.frames ?? 1,
        pbr: t.pbrUrl, emi: t.emiUrl, nrm: t.nrmUrl, mersUniform: t.mersUniform ?? null, roughAvg: t.roughAvg ?? null, metalAvg: t.metalAvg ?? null,
        vanilla: !!t.vanilla, src: t.vanilla ?? (t.file ? path.relative(root, t.file) : null),
      };
    }
    const geoOut = Object.fromEntries(geometries);
    return { textures: texOut, geometries: geoOut };
  }

  return { resolve, finalize, textures, geometries, vanillaTexturePaths, warnings, packs: packList };
}
