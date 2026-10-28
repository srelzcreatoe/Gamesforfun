// Regenerates the fixtures-independent test snapshot and renders every scene in test/scenes/
// into tools/render/test/<scene>.png (one browser session, world built once).
// Usage: node tools/render/test/run_tests.mjs [sceneNameFilter]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderWorld } from '../render_world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(HERE, 'make_test_room.mjs')], { stdio: 'inherit' });
const filter = process.argv[2];
const scenes = fs.readdirSync(path.join(HERE, 'scenes')).filter((f) => f.endsWith('.json') && (!filter || f.includes(filter))).sort();
const jobs = scenes.map((f) => ({ scene: path.join(HERE, 'scenes', f), out: path.join(HERE, f.replace(/\.json$/, '.png')) }));
const t0 = Date.now();
const res = await renderWorld(jobs);
console.log(`\n${res.length} images in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const r of res) console.log(`  ${path.relative(process.cwd(), r.out)}  ${r.ms} ms`);
