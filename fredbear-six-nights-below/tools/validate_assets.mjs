// Cross-reference check of every pack asset (static; no game required).
//  * every .json in both packs parses as strict JSON
//  * BP entities <-> RP client entities <-> script PUPPET_TYPES are the same set
//  * client entity textures/geometry/animations/render controllers resolve
//  * render controller Geometry/Material/Texture keys exist on each user
//  * geometry UV boxes stay inside the texture and match the PNG size,
//    bone parents exist, every animated bone exists in every geometry
//  * animation controller states/transitions reference real animations/states
//  * fb:anim values used by scripts and controllers are in the BP enum
//  * q.property() names used by the RP are declared in the BP
//  * item icons resolve through item_texture.json to 16x16 PNGs
//  * sound files exist; every sound id the scripts emit is defined
//  * fog ids pushed by commands exist; lang has a name for every entity
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const BP = path.join(ROOT, 'packs/FredbearBP');
const RP = path.join(ROOT, 'packs/FredbearRP');
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, ext, out);
    else if (f.name.endsWith(ext)) out.push(p);
  }
  return out;
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    err(`${path.relative(ROOT, p)}: invalid JSON (${e.message})`);
    return null;
  }
}

export function pngSize(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${p}: not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const rel = (p) => path.relative(ROOT, p);

export function validateAssets() {
  // ------------------------------------------------------------ JSON parse
  const allJson = [...walk(BP, '.json'), ...walk(RP, '.json')].filter((p) => !p.includes(`${path.sep}scripts${path.sep}`));
  const docs = new Map(allJson.map((p) => [p, readJson(p)]));

  // ------------------------------------------------------------ BP entities
  const bpEntities = new Map();
  for (const p of walk(path.join(BP, 'entities'), '.json')) {
    const d = docs.get(p)?.['minecraft:entity'];
    if (d) bpEntities.set(d.description.identifier, d);
  }
  const animEnum = new Set();
  const declaredProps = new Set();
  for (const [id, e] of bpEntities) {
    const props = e.description.properties ?? {};
    for (const [k, v] of Object.entries(props)) {
      declaredProps.add(k);
      if (k === 'fb:anim') {
        if (v.type !== 'enum') err(`${id}: fb:anim must be an enum`);
        if (v.values.length > 16) err(`${id}: fb:anim has ${v.values.length} values (max 16)`);
        for (const val of v.values) {
          if (val.length > 32) err(`${id}: enum value '${val}' longer than 32 characters`);
          animEnum.add(val);
        }
        if (!v.values.includes(v.default)) err(`${id}: fb:anim default not in values`);
      }
    }
  }

  // ------------------------------------------------------------ RP lookups
  const geometries = new Map();
  for (const p of walk(path.join(RP, 'models'), '.json')) {
    for (const g of docs.get(p)?.['minecraft:geometry'] ?? []) geometries.set(g.description.identifier, { g, file: p });
  }
  const animations = new Map();
  for (const p of walk(path.join(RP, 'animations'), '.json')) for (const [k, v] of Object.entries(docs.get(p)?.animations ?? {})) animations.set(k, v);
  const controllers = new Map();
  for (const p of walk(path.join(RP, 'animation_controllers'), '.json')) for (const [k, v] of Object.entries(docs.get(p)?.animation_controllers ?? {})) controllers.set(k, v);
  const renderControllers = new Map();
  for (const p of walk(path.join(RP, 'render_controllers'), '.json')) for (const [k, v] of Object.entries(docs.get(p)?.render_controllers ?? {})) renderControllers.set(k, v);

  // ------------------------------------------------------------ client entities
  const clientIds = new Set();
  const KNOWN_MATERIALS = new Set(['entity_alphatest', 'creaking_eyes']); // both used by vanilla 1.26.50 client entities
  for (const p of walk(path.join(RP, 'entity'), '.json')) {
    const d = docs.get(p)?.['minecraft:client_entity']?.description;
    if (!d) continue;
    clientIds.add(d.identifier);
    if (!bpEntities.has(d.identifier)) err(`${rel(p)}: no BP entity ${d.identifier}`);
    for (const m of Object.values(d.materials ?? {})) if (!KNOWN_MATERIALS.has(m)) err(`${rel(p)}: material '${m}' not in the verified list`);
    const texSizes = {};
    for (const [k, t] of Object.entries(d.textures ?? {})) {
      const f = path.join(RP, `${t}.png`);
      if (!fs.existsSync(f)) err(`${rel(p)}: texture ${t}.png missing`);
      else texSizes[k] = pngSize(f);
    }
    for (const gid of Object.values(d.geometry ?? {})) {
      const g = geometries.get(gid);
      if (!g) {
        err(`${rel(p)}: geometry ${gid} not found`);
        continue;
      }
      for (const [k, s] of Object.entries(texSizes)) {
        if (s.w !== g.g.description.texture_width || s.h !== g.g.description.texture_height) err(`${rel(p)}: texture '${k}' is ${s.w}x${s.h}, geometry ${gid} expects ${g.g.description.texture_width}x${g.g.description.texture_height}`);
      }
    }
    for (const [short, full] of Object.entries(d.animations ?? {})) {
      if (full.startsWith('controller.')) {
        if (!controllers.has(full)) err(`${rel(p)}: controller ${full} missing`);
      } else if (!animations.has(full)) err(`${rel(p)}: animation ${full} missing`);
      void short;
    }
    for (const a of d.scripts?.animate ?? []) {
      const key = typeof a === 'string' ? a : Object.keys(a)[0];
      if (!(key in (d.animations ?? {}))) err(`${rel(p)}: animate '${key}' has no animations entry`);
    }
    for (const rc of d.render_controllers ?? []) {
      const id = typeof rc === 'string' ? rc : Object.keys(rc)[0];
      const c = renderControllers.get(id);
      if (!c) {
        err(`${rel(p)}: render controller ${id} missing`);
        continue;
      }
      const refs = JSON.stringify(c).match(/(Geometry|Material|Texture)\.[a-z_0-9]+/g) ?? [];
      for (const r of refs) {
        const [kind, name] = r.split('.');
        const table = { Geometry: d.geometry, Material: d.materials, Texture: d.textures }[kind] ?? {};
        if (!(name in table)) err(`${rel(p)}: ${id} uses ${r} which the entity does not define`);
      }
    }
    // controller -> short animation names of this entity
    for (const full of Object.values(d.animations ?? {})) {
      const c = controllers.get(full);
      if (!c) continue;
      for (const [sn, st] of Object.entries(c.states)) {
        for (const a of st.animations ?? []) {
          const k = typeof a === 'string' ? a : Object.keys(a)[0];
          if (!(k in d.animations)) err(`${rel(p)}: ${full} state ${sn} plays '${k}' which the entity does not map`);
        }
        for (const t of st.transitions ?? []) {
          const target = Object.keys(t)[0];
          if (!(target in c.states)) err(`${full}: state ${sn} transitions to unknown state ${target}`);
        }
      }
      if (!(c.initial_state in c.states)) err(`${full}: initial_state ${c.initial_state} missing`);
    }
    // Molang property names
    const text = JSON.stringify(d);
    for (const m of text.matchAll(/query\.property\('([^']+)'\)|q\.property\('([^']+)'\)/g)) {
      const name = m[1] ?? m[2];
      if (!declaredProps.has(name)) err(`${rel(p)}: property ${name} is not declared by any BP entity`);
    }
  }
  for (const id of bpEntities.keys()) if (!clientIds.has(id)) err(`BP entity ${id} has no client entity`);

  // ------------------------------------------------------------ geometry checks
  const animatedBones = new Set();
  for (const a of animations.values()) for (const b of Object.keys(a.bones ?? {})) animatedBones.add(b);
  for (const [gid, { g, file }] of geometries) {
    const W = g.description.texture_width;
    const H = g.description.texture_height;
    const names = new Set();
    for (const b of g.bones) {
      if (names.has(b.name)) err(`${gid}: duplicate bone ${b.name}`);
      names.add(b.name);
    }
    for (const b of g.bones) {
      if (b.parent && !names.has(b.parent)) err(`${gid}: bone ${b.name} parent ${b.parent} missing`);
      for (const c of b.cubes ?? []) {
        if (Array.isArray(c.uv)) {
          // box UV
          const [w, h, dd] = c.size;
          const [u, v] = c.uv;
          if (u < 0 || v < 0 || u + 2 * (w + dd) > W || v + dd + h > H) err(`${gid}: bone ${b.name} cube uv ${c.uv} size ${c.size} exceeds ${W}x${H}`);
        } else {
          // per-face UV: every face present, rect (negative sizes flip) inside the texture
          for (const face of ['north', 'south', 'east', 'west', 'up', 'down']) {
            const f = c.uv[face];
            if (!f) {
              err(`${gid}: bone ${b.name} cube at ${c.origin} has no '${face}' UV`);
              continue;
            }
            const [u, v] = f.uv;
            const [sw, sh] = f.uv_size;
            const [u0, u1] = [Math.min(u, u + sw), Math.max(u, u + sw)];
            const [v0, v1] = [Math.min(v, v + sh), Math.max(v, v + sh)];
            if (u0 < 0 || v0 < 0 || u1 > W || v1 > H || sw === 0 || sh === 0) err(`${gid}: bone ${b.name} ${face} UV ${f.uv}/${f.uv_size} outside ${W}x${H}`);
          }
        }
      }
    }
    for (const b of animatedBones) if (!names.has(b)) err(`${gid}: animated bone '${b}' missing (${rel(file)})`);
  }

  // ------------------------------------------------------------ animations
  for (const [id, a] of animations) {
    const len = a.animation_length ?? Infinity;
    for (const [bone, ch] of Object.entries(a.bones ?? {})) {
      for (const [chan, val] of Object.entries(ch)) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          for (const t of Object.keys(val)) if (Number(t) > len + 1e-6) err(`${id}: ${bone}.${chan} keyframe ${t} beyond length ${len}`);
        }
      }
    }
  }
  for (const [id, c] of controllers) {
    for (const [, st] of Object.entries(c.states)) {
      for (const t of st.transitions ?? []) {
        const expr = Object.values(t)[0];
        for (const m of expr.matchAll(/fb_anim == '([^']+)'/g)) if (!animEnum.has(m[1])) err(`${id}: transition tests fb_anim == '${m[1]}' not in the BP enum`);
      }
    }
    for (const v of animEnum) if (!(v in c.states) && id === 'controller.animation.fb.pose') err(`${id}: no state for fb:anim value '${v}'`);
  }

  // ------------------------------------------------------------ scripts
  const scriptFiles = walk(path.join(BP, 'scripts'), '.js');
  const scriptText = scriptFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  // Every literal assigned to an anim (`anim = 'x'`, `anim: 'x'`, the ternary
  // branches `? 'x' : 'y'` on such a line, and setProperty('fb:anim', 'x')).
  const animLiterals = new Set();
  for (const line of scriptText.split('\n')) {
    if (/^\s*\/\//.test(line)) continue;
    for (const m of line.matchAll(/\banim\s*[=:]\s*'([a-z_]+)'|'fb:anim',\s*'([a-z_]+)'/g)) animLiterals.add(m[1] ?? m[2]);
    const tern = line.match(/\bthis\.anim\s*=\s*(.+);/);
    if (tern && tern[1].includes('?')) for (const m of tern[1].matchAll(/\?\s*'([a-z_]+)'|:\s*'([a-z_]+)'/g)) animLiterals.add(m[1] ?? m[2]);
  }
  for (const a of animLiterals) if (!animEnum.has(a)) err(`script sets anim '${a}' not in the fb:anim enum`);
  for (const a of ['walk', 'stalk', 'crawl', 'retreat']) if (!animLiterals.has(a)) warnings.push(`anim '${a}' never set by scripts`);
  // Jumpscare framing (game.js SCALE) must match the entities' minecraft:scale.
  const scaleBlock = scriptText.match(/const SCALE = Object\.freeze\(\{([^}]+)\}\)/)?.[1] ?? '';
  for (const m of scaleBlock.matchAll(/(\w+):\s*([\d.]+)/g)) {
    const v = bpEntities.get(`fb:${m[1]}`)?.components?.['minecraft:scale']?.value;
    if (v !== Number(m[2])) err(`game.js SCALE.${m[1]} = ${m[2]} but fb:${m[1]} minecraft:scale = ${v}`);
  }
  const puppetTypes = [...scriptText.matchAll(/PUPPET_TYPES = Object\.freeze\(\{([^}]+)\}/g)][0]?.[1] ?? '';
  for (const m of puppetTypes.matchAll(/'(fb:[a-z_]+)'/g)) if (!bpEntities.has(m[1])) err(`PUPPET_TYPES lists ${m[1]} with no BP entity`);

  // ------------------------------------------------------------ items
  const itemTex = docs.get(path.join(RP, 'textures/item_texture.json'))?.texture_data ?? {};
  for (const p of walk(path.join(BP, 'items'), '.json')) {
    const it = docs.get(p)?.['minecraft:item'];
    if (!it) continue;
    const icon = it.components['minecraft:icon'];
    const key = typeof icon === 'string' ? icon : icon?.textures?.default;
    const entry = itemTex[key];
    if (!entry) {
      err(`${rel(p)}: icon '${key}' not in item_texture.json`);
      continue;
    }
    const f = path.join(RP, `${entry.textures}.png`);
    if (!fs.existsSync(f)) err(`${rel(p)}: icon file ${entry.textures}.png missing`);
    else {
      const s = pngSize(f);
      if (s.w !== 16 || s.h !== 16) err(`${rel(p)}: icon is ${s.w}x${s.h}, expected 16x16`);
    }
  }
  for (const id of ['fb:tablet', 'fb:remote', 'fb:guide']) if (!scriptText.includes(`'${id}'`)) warnings.push(`item ${id} not referenced by scripts`);

  // ------------------------------------------------------------ sounds
  const sd = docs.get(path.join(RP, 'sounds/sound_definitions.json'))?.sound_definitions ?? {};
  for (const [id, def] of Object.entries(sd)) {
    for (const s of def.sounds ?? []) {
      const name = typeof s === 'string' ? s : s.name;
      if (!fs.existsSync(path.join(RP, `${name}.ogg`))) err(`sound ${id}: file ${name}.ogg missing`);
    }
  }
  const used = new Set([...scriptText.matchAll(/'(fb\.[a-z_]+\.[a-z_0-9]+)'/g)].map((m) => m[1]));
  for (const who of ['freddy', 'bonnie', 'chica', 'fredbear']) {
    used.add(`fb.step.${who}`); // base.js emitStep: `fb.step.${this.id}`
    used.add(`fb.js.${who}`); // game.js applyFx: `fb.js.${who}` for actuate js.<who>
  }
  for (const id of used) if (!(id in sd)) err(`script sound '${id}' not defined in sound_definitions.json`);
  for (const id of Object.keys(sd)) if (!used.has(id) && !fs.readFileSync(path.join(BP, 'scripts/data/actuators.js'), 'utf8').includes(id)) warnings.push(`sound ${id} defined but never played`);

  // ------------------------------------------------------------ fogs
  const fogIds = new Set();
  for (const p of walk(path.join(RP, 'fogs'), '.json')) {
    const id = docs.get(p)?.['minecraft:fog_settings']?.description?.identifier;
    if (id) fogIds.add(id);
  }
  const pushed = [...scriptText.matchAll(/fog @a push ([a-z_]+:[a-z_0-9]+)(?![a-z_0-9$])/g)].map((m) => m[1]);
  for (const n of [1, 2, 3, 4, 5, 6]) pushed.push(`fb:night_${n}`); // fogCommand(n) builds these ids
  for (const id of new Set(pushed)) if (!fogIds.has(id)) err(`fog ${id} missing (pushed by scripts/mc/commands.js)`);

  // ------------------------------------------------------------ lang
  const lang = fs.readFileSync(path.join(RP, 'texts/en_US.lang'), 'utf8');
  for (const id of bpEntities.keys()) if (!lang.includes(`entity.${id}.name=`)) err(`en_US.lang: no name for ${id}`);
  for (const p of [path.join(BP, 'pack_icon.png'), path.join(RP, 'pack_icon.png')]) if (!fs.existsSync(p)) err(`${rel(p)} missing`);

  return { errors, warnings, counts: { json: allJson.length, entities: bpEntities.size, geometries: geometries.size, animations: animations.size, sounds: Object.keys(sd).length, fogs: fogIds.size } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = validateAssets();
  for (const w of r.warnings) console.log(`  warn: ${w}`);
  for (const e of r.errors) console.log(`  FAIL: ${e}`);
  const c = r.counts;
  console.log(`assets: ${c.json} JSON files, ${c.entities} entities, ${c.geometries} geometries, ${c.animations} animations, ${c.sounds} sounds, ${c.fogs} fogs: ${r.errors.length ? `${r.errors.length} error(s)` : 'all references resolve'}`);
  process.exit(r.errors.length ? 1 : 0);
}
