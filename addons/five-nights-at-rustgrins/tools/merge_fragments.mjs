// Merges per-agent fragment files into the shared resource pack registries:
//   tools/fragments/terrain_*.json        -> packs/RP/textures/terrain_texture.json (texture_data)
//   tools/fragments/flipbook_*.json       -> packs/RP/textures/flipbook_textures.json (array)
//   tools/fragments/local_lighting_*.json -> packs/RP/local_lighting/local_lighting.json
//   tools/fragments/item_texture_*.json   -> packs/RP/textures/item_texture.json (texture_data)
// Duplicate keys across fragments are an error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAG = path.join(ROOT, 'tools/fragments');
const RP = path.join(ROOT, 'packs/RP');
const read = (f) => JSON.parse(fs.readFileSync(path.join(FRAG, f), 'utf8'));
const files = fs.existsSync(FRAG) ? fs.readdirSync(FRAG).filter((f) => f.endsWith('.json')).sort() : [];
let bad = 0;
function mergeObj(prefix) {
  const out = {};
  for (const f of files.filter((x) => x.startsWith(prefix))) {
    for (const [k, v] of Object.entries(read(f))) {
      if (k in out) { console.log(`duplicate key ${k} in ${f}`); bad++; }
      out[k] = v;
    }
  }
  return out;
}
const write = (rel, obj) => { const p = path.join(RP, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); };

const terrain = mergeObj('terrain_');
write('textures/terrain_texture.json', { resource_pack_name: 'fnar', texture_name: 'atlas.terrain', padding: 8, num_mip_levels: 4, texture_data: terrain });
const items = mergeObj('item_texture_');
if (Object.keys(items).length) write('textures/item_texture.json', { resource_pack_name: 'fnar', texture_name: 'atlas.items', texture_data: items });
const flip = files.filter((x) => x.startsWith('flipbook_')).flatMap((f) => read(f));
if (flip.length) write('textures/flipbook_textures.json', flip);
const lights = mergeObj('local_lighting_');
if (Object.keys(lights).length) write('local_lighting/local_lighting.json', { format_version: '1.21.120', 'minecraft:local_light_settings': lights });
console.log(`merge_fragments: ${Object.keys(terrain).length} terrain textures, ${flip.length} flipbooks, ${Object.keys(lights).length} local lights, ${Object.keys(items).length} item textures`);
process.exit(bad ? 1 : 0);
