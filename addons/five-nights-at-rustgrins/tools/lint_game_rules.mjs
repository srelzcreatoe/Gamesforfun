// Load rules the game enforces but the JSON schemas do not. Each rule below broke a real
// load in Minecraft 1.26.60 (content log: "failed to load from JSON", "invalid numeric value",
// "Unknown property [collection_name]"), so the build fails on them.
//
//   1. blocks: material_instances.*.ambient_occlusion is a number 0..10 (a boolean fails the
//      whole block since block format 1.26.20)
//   2. blocks / items / entities: every minecraft:* component has a definition in the official
//      schema package (@minecraft/bedrock-schemas forms), and none of its notes says it stopped
//      parsing at or before the file's format_version (e.g. minecraft:pushable, split in 1.26.10)
//   3. blocks: light_emission / light_dampening are integers 0..15
//   4. resource pack UI: collection_name only on grid / stack_panel / collection_panel /
//      grid_page_indicator (the only types that carry it in the vanilla UI files), and
//      collection_index only on controls inside such a container
//   5. no experimental features: the packs must load with every experiment toggle off, so no
//      beta script module, no manifest capability but "pbr" (Vibrant Visuals), and no component
//      or component field whose schema description says it needs an experiment
//
// Usage: node tools/lint_game_rules.mjs   (exit 1 on problems)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = path.join(ROOT, 'packs');
const FORMS = path.join(ROOT, 'tools/node_modules/@minecraft/bedrock-schemas/forms');

const problems = [];
const report = (file, msg) => problems.push(`${path.relative(ROOT, file)}: ${msg}`);
const ver = (v) => (Array.isArray(v) ? v : String(v ?? '0').split('.')).map(Number);
const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) : []);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// ------------------------------------------------------------ component notes from the schema package
const forms = new Map(); // component id -> notes[]
const experimental = new Map(); // component id -> Set of field ids that need an experiment ('' = the whole component)
const NEEDS_EXPERIMENT = /requires? (?:the )?[\w ]*experiment|experimental toggle|\[Requires the Beta APIs/i;
const NOT_ANYMORE = /no longer requires|still requires the Voxel Shapes experimental toggle/i; // that one is about vanilla blocks only
function walkForms(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkForms(p);
    else if (e.name.endsWith('.json')) {
      let d;
      try {
        d = read(p);
      } catch {
        continue;
      }
      collect(d);
    }
  }
}
function notesOf(o) {
  return Object.entries(o).filter(([k, v]) => k.startsWith('note') && typeof v === 'string').map(([, v]) => v);
}
/**
 * Field ids under a component's form whose description or notes say they need an experiment
 * ('' = the component itself). Nested sub-forms without an id belong to the field above them.
 */
function experimentFields(o, out, owner) {
  if (Array.isArray(o)) return o.forEach((x) => experimentFields(x, out, owner));
  if (!o || typeof o !== 'object') return;
  const here = owner === null ? '' : typeof o.id === 'string' ? o.id : owner;
  const text = [o.description, ...notesOf(o)].filter((t) => typeof t === 'string').join(' ');
  if (NEEDS_EXPERIMENT.test(text) && !NOT_ANYMORE.test(text)) out.add(here);
  for (const [k, v] of Object.entries(o)) if (k !== 'id' && typeof v === 'object') experimentFields(v, out, here);
}
function collect(o) {
  if (Array.isArray(o)) return o.forEach(collect);
  if (!o || typeof o !== 'object') return;
  if (typeof o.id === 'string' && o.id.startsWith('minecraft:')) {
    const ex = experimental.get(o.id) ?? new Set();
    experimentFields(o, ex, null);
    if (ex.size) experimental.set(o.id, ex);
    const notes = forms.get(o.id) ?? [];
    notes.push(...notesOf(o));
    if (o.subFormId) {
      const sf = path.join(FORMS, `${o.subFormId}.form.json`);
      if (fs.existsSync(sf)) notes.push(...notesOf(read(sf)));
    }
    forms.set(o.id, notes);
  }
  for (const v of Object.values(o)) collect(v);
}
walkForms(FORMS);

/** The format version from which a component no longer loads, per its notes (or null). */
function removedSince(id) {
  for (const n of forms.get(id) ?? []) {
    if (!/no longer parsed|is no longer parsed|Removed in format version/i.test(n)) continue;
    const m = n.match(/(?:Removed in format version|In)\s+(\d+\.\d+\.\d+)/i);
    if (m) return ver(m[1]);
  }
  return null;
}

/** Does a JSON value use the key `k` anywhere inside it? */
function usesKey(v, k) {
  if (!v || typeof v !== 'object') return false;
  if (!Array.isArray(v) && k in v) return true;
  return Object.values(v).some((x) => usesKey(x, k));
}

// ------------------------------------------------------------ manifests: stable modules, no experiment capabilities
for (const pack of ['BP', 'RP']) {
  const f = path.join(PACKS, pack, 'manifest.json');
  if (!fs.existsSync(f)) continue;
  const m = read(f);
  for (const c of m.capabilities ?? []) if (c !== 'pbr') report(f, `capability "${c}" needs an experiment or a special world (only "pbr" is allowed)`);
  for (const d of m.dependencies ?? []) {
    if (typeof d.version === 'string' && /beta|alpha|preview|internal/i.test(d.version)) report(f, `${d.module_name}@${d.version} is not a stable script module (needs the Beta APIs experiment)`);
    if (d.module_name) {
      const pkg = path.join(ROOT, 'tools/node_modules', d.module_name, 'package.json');
      if (fs.existsSync(pkg) && read(pkg).version !== d.version) report(f, `${d.module_name}@${d.version} differs from the typings the scripts are checked against (${read(pkg).version})`);
    }
  }
}

// ------------------------------------------------------------ behavior pack: blocks, items, entities
for (const [kind, dir] of [['block', 'blocks'], ['item', 'items'], ['entity', 'entities']]) {
  for (const f of list(path.join(PACKS, 'BP', dir))) {
    const d = read(f);
    const fv = ver(d.format_version);
    const root = d[`minecraft:${kind === 'entity' ? 'entity' : kind}`];
    if (!root) continue;
    const groups = [root.components ?? {}, ...(root.permutations ?? []).map((p) => p.components ?? {}), ...Object.values(root.component_groups ?? {})];
    for (const comps of groups) {
      for (const [id, val] of Object.entries(comps)) {
        if (!id.startsWith('minecraft:')) continue;
        if (!forms.has(id)) report(f, `${id}: no such component in the 1.26 schema package`);
        for (const field of experimental.get(id) ?? []) {
          if (field === '') report(f, `${id} needs an experiment toggle`);
          else if (usesKey(val, field)) report(f, `${id}.${field} needs an experiment toggle`);
        }
        const r = removedSince(id);
        if (r && cmp(fv, r) >= 0) report(f, `${id} no longer loads at format ${fv.join('.')} (since ${r.join('.')}) - the whole ${kind} fails`);
        if (kind === 'block' && id === 'minecraft:material_instances') {
          for (const [inst, m] of Object.entries(val)) {
            if (m && typeof m === 'object' && 'ambient_occlusion' in m) {
              const ao = m.ambient_occlusion;
              if (typeof ao !== 'number' || ao < 0 || ao > 10) report(f, `material_instances.${inst}.ambient_occlusion must be a number 0..10, got ${JSON.stringify(ao)}`);
            }
          }
        }
        if (kind === 'block' && (id === 'minecraft:light_emission' || id === 'minecraft:light_dampening')) {
          if (!Number.isInteger(val) || val < 0 || val > 15) report(f, `${id} must be an integer 0..15, got ${JSON.stringify(val)}`);
        }
      }
    }
  }
}

// ------------------------------------------------------------ resource pack UI
const COLLECTION_TYPES = new Set(['grid', 'stack_panel', 'collection_panel', 'grid_page_indicator']);
for (const f of list(path.join(PACKS, 'RP', 'ui'))) {
  const d = read(f);
  const ns = d.namespace;
  const defs = new Map(Object.entries(d).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => [k.split('@')[0], [k, v]]));
  const typeOf = (key, o, seen = new Set()) => {
    if (o.type) return o.type;
    const ref = key.includes('@') ? key.split('@')[1] : null;
    if (!ref) return null;
    const [rns, rname] = ref.includes('.') ? ref.split('.') : [ns, ref];
    if (rns === ns && defs.has(rname) && !seen.has(rname)) {
      seen.add(rname);
      const [bk, bv] = defs.get(rname);
      return typeOf(bk, bv, seen);
    }
    return null; // a vanilla base: unknown here
  };
  const walk = (key, o, inCollection, where) => {
    if (!o || typeof o !== 'object') return;
    const t = typeOf(key, o);
    if ('collection_name' in o && t && !COLLECTION_TYPES.has(t)) report(f, `${where}: collection_name on a "${t}" (only ${[...COLLECTION_TYPES].join(' / ')} carry it)`);
    if ('collection_index' in o && !inCollection) report(f, `${where}: collection_index outside a collection container`);
    const here = inCollection || ('collection_name' in o && (!t || COLLECTION_TYPES.has(t)));
    for (const c of o.controls ?? []) for (const [ck, cv] of Object.entries(c)) walk(ck, cv, here, `${where} > ${ck.split('@')[0]}`);
  };
  // definitions reached only through a collection container count as inside it
  for (const [k, v] of Object.entries(d)) if (v && typeof v === 'object') walk(k, v, false, k.split('@')[0]);
}

for (const p of problems) console.log('  ' + p);
console.log(problems.length ? `lint_game_rules: ${problems.length} problem(s)` : `lint_game_rules: ok (${forms.size} component definitions, ${experimental.size} with experiment-only parts avoided)`);
process.exit(problems.length ? 1 : 0);
