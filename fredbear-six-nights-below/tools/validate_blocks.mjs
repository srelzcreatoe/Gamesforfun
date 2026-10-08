// Validates every palette entry (block name + state names + state values)
// against Mojang's 1.26.50 block metadata (tools/ref/mojang-blocks.json).
import fs from 'node:fs';
import { PALETTE } from '../packs/FredbearBP/scripts/data/palette.js';

export function loadBlockMeta() {
  const d = JSON.parse(fs.readFileSync(new URL('./ref/mojang-blocks.json', import.meta.url)));
  const props = Object.fromEntries(d.block_properties.map((p) => [p.name, p]));
  const blocks = Object.fromEntries(d.data_items.map((b) => [b.name, b]));
  return { props, blocks };
}

export function checkBlock(meta, name, states = {}) {
  const errs = [];
  const b = meta.blocks[name];
  if (!b) return [`unknown block ${name}`];
  const allowed = new Set((b.properties ?? []).map((p) => p.name));
  for (const [k, v] of Object.entries(states)) {
    if (!allowed.has(k)) {
      errs.push(`${name}: unknown state ${k} (allowed: ${[...allowed].join(', ') || 'none'})`);
      continue;
    }
    const p = meta.props[k];
    const vals = p.values.map((x) => x.value);
    if (!vals.includes(v)) errs.push(`${name}: ${k}=${JSON.stringify(v)} not in ${JSON.stringify(vals)}`);
  }
  return errs;
}

export function validatePalette() {
  const meta = loadBlockMeta();
  const errs = [];
  for (const [key, b] of Object.entries(PALETTE)) for (const e of checkBlock(meta, b.name, b.states)) errs.push(`${key}: ${e}`);
  return { count: Object.keys(PALETTE).length, errs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { count, errs } = validatePalette();
  if (errs.length) {
    console.error(errs.join('\n'));
    process.exit(1);
  }
  console.log(`palette OK: ${count} entries valid against 1.26.50 block metadata`);
}
