// Bundles src/ into the behaviour pack (one file, the only import left is @minecraft/server),
// and into a test build whose @minecraft/server is the simulated world.
import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const banner = '// Basiliskra behaviour script. Built from src/*.ts (see the repository). Stable @minecraft/server 2.11.0 only.\n';

await build({
  entryPoints: [path.join(root, 'src/main.ts')], bundle: true, format: 'esm', target: 'es2021', external: ['@minecraft/server'],
  outfile: path.join(root, 'packs/BP/scripts/main.js'), legalComments: 'none', banner: { js: banner }, charset: 'utf8',
});

// test build: the same sources, with the API taken from a global the harness provides, and the
// controller exposed so scenarios can look inside
const shim = path.join(root, 'build/mc-shim.mjs');
fs.mkdirSync(path.dirname(shim), { recursive: true });
fs.writeFileSync(shim, `const m = globalThis.__MC__;
export const { world, system, EntityDamageCause, GameMode, EquipmentSlot, MolangVariableMap, ItemStack, Player, Entity } = m;
`);
fs.writeFileSync(path.join(root, 'build/test-entry.ts'), `import { ctl } from "../src/main";
import { store } from "../src/store";
import { CONFIG } from "../src/config";
import * as harm from "../src/harm";
import { partOwner } from "../src/creature";
import * as rig from "../src/rig";
(globalThis as any).__BK__ = { ctl, store, CONFIG, harm, partOwner, rig };
`);
await build({
  entryPoints: [path.join(root, 'build/test-entry.ts')], bundle: true, format: 'iife', target: 'es2021',
  alias: { '@minecraft/server': shim }, outfile: path.join(root, 'build/test-bundle.js'), legalComments: 'none',
  footer: { js: '' },
});
const size = fs.statSync(path.join(root, 'packs/BP/scripts/main.js')).size;
console.log(`bundled packs/BP/scripts/main.js (${(size / 1024).toFixed(1)} KiB) and build/test-bundle.js`);
