// Checks every block the map uses: vanilla names/states against Mojang's
// 1.26.50 block metadata (bedrock-samples metadata/vanilladata_modules/mojang-blocks.json,
// cached at tools/.cache/vanilla or /opt/bedrock-samples), fnar:* names/states
// against packs/BP/blocks/*.json.
// Usage: node tools/validate_blocks.mjs   (exit 1 on errors)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const META_CANDIDATES = [path.join(ROOT, 'tools/.cache/vanilla/metadata/vanilladata_modules/mojang-blocks.json'), '/opt/bedrock-samples/metadata/vanilladata_modules/mojang-blocks.json'];
const metaPath = META_CANDIDATES.find((p) => fs.existsSync(p));
if (!metaPath) {
  console.error('mojang-blocks.json not found; fetch it from https://raw.githubusercontent.com/Mojang/bedrock-samples/main/metadata/vanilladata_modules/mojang-blocks.json into tools/.cache/vanilla/metadata/vanilladata_modules/');
  process.exit(2);
}
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const propDefs = Object.fromEntries(meta.block_properties.map((p) => [p.name, p]));
const vanilla = Object.fromEntries(meta.data_items.map((b) => [b.name, b]));

// Custom blocks: states from description.states (arrays or {values:{min,max}}) + traits.
const custom = {};
const BDIR = path.join(ROOT, 'packs/BP/blocks');
if (fs.existsSync(BDIR)) {
  for (const f of fs.readdirSync(BDIR).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(BDIR, f), 'utf8'))['minecraft:block'];
    const d = j.description;
    const states = {};
    for (const [k, v] of Object.entries(d.states || {})) {
      if (Array.isArray(v)) states[k] = v;
      else if (v?.values) { const out = []; for (let i = v.values.min; i <= v.values.max; i++) out.push(i); states[k] = out; }
    }
    const pd = d.traits?.['minecraft:placement_direction'];
    if (pd?.enabled_states?.includes('minecraft:cardinal_direction')) states['minecraft:cardinal_direction'] = ['north', 'south', 'east', 'west'];
    if (pd?.enabled_states?.includes('minecraft:facing_direction')) states['minecraft:facing_direction'] = ['down', 'up', 'north', 'south', 'east', 'west'];
    const pp = d.traits?.['minecraft:placement_position'];
    if (pp?.enabled_states?.includes('minecraft:block_face')) states['minecraft:block_face'] = ['down', 'up', 'north', 'south', 'east', 'west'];
    if (pp?.enabled_states?.includes('minecraft:vertical_half')) states['minecraft:vertical_half'] = ['bottom', 'top'];
    custom[d.identifier] = states;
  }
}

export function checkBlock(b) {
  const errs = [];
  if (b.name.startsWith('minecraft:')) {
    const v = vanilla[b.name];
    if (!v) return [`unknown vanilla block ${b.name}`];
    const allowed = Object.fromEntries((v.properties || []).map((p) => [p.name, (propDefs[p.name]?.values || []).map((x) => x.value)]));
    for (const [k, val] of Object.entries(b.states || {})) {
      if (!(k in allowed)) errs.push(`${b.name}: no state ${k} (has ${Object.keys(allowed).join(', ') || 'none'})`);
      else if (!allowed[k].includes(val)) errs.push(`${b.name}: ${k}=${JSON.stringify(val)} not in ${JSON.stringify(allowed[k])}`);
    }
  } else {
    const c = custom[b.name];
    if (!c) return [`custom block ${b.name} has no definition in packs/BP/blocks`];
    for (const [k, val] of Object.entries(b.states || {})) {
      if (!(k in c)) errs.push(`${b.name}: no state ${k} (has ${Object.keys(c).join(', ') || 'none'})`);
      else if (!c[k].includes(val)) errs.push(`${b.name}: ${k}=${JSON.stringify(val)} not in ${JSON.stringify(c[k])}`);
    }
  }
  return errs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { PALETTE, PICTURES, PICTURE_VARIANTS, pictureBlock } = await import(path.join(ROOT, 'packs/BP/scripts/data/palette.js'));
  let bad = 0, missingCustom = new Set();
  const report = (key, b) => {
    for (const e of checkBlock(b)) {
      if (e.startsWith('custom block')) { missingCustom.add(b.name); continue; }
      console.log(`  ${key}: ${e}`); bad++;
    }
  };
  for (const [k, b] of Object.entries(PALETTE)) report(k, b);
  for (const [name, [w, h]] of Object.entries(PICTURES)) {
    const n = Math.max(w * h, PICTURE_VARIANTS[name] ?? 0);
    for (let t = 0; t < n; t++) report(`${name}_${t}`, pictureBlock(name, t, 'n'));
  }
  if (missingCustom.size) { console.log(`  custom blocks not defined yet: ${[...missingCustom].sort().join(', ')}`); }
  console.log(`validate_blocks: ${Object.keys(PALETTE).length} palette keys, ${bad} state errors, ${missingCustom.size} undefined custom blocks`);
  process.exit(bad || (process.argv.includes('--strict') && missingCustom.size) ? 1 : 0);
}
