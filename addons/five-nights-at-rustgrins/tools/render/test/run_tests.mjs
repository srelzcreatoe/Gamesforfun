// Regenerates the test snapshots (test_room, gallery, showcase) and renders every scene in
// test/scenes*/ into tools/render/test/<scene>.png in one browser session (worlds built once).
// Usage: node tools/render/test/run_tests.mjs [nameFilter] [--perf]
//   --perf  also builds the 110x40x100 performance world and renders scenes_perf/ at 1920x1080
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderWorld } from '../render_world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const perf = args.includes('--perf');
const filter = args.find((a) => !a.startsWith('--'));
const gen = ['make_test_room.mjs', 'make_gallery.mjs', 'make_showcase.mjs', ...(perf ? ['make_perf_world.mjs'] : [])];
for (const g of gen) execFileSync(process.execPath, [path.join(HERE, g)], { stdio: 'inherit' });
const dirs = ['scenes', 'scenes_gallery', 'scenes_showcase', ...(perf ? ['scenes_perf'] : [])];
const jobs = [];
for (const d of dirs) {
  for (const f of fs.readdirSync(path.join(HERE, d)).filter((x) => x.endsWith('.json')).sort()) {
    if (filter && !f.includes(filter)) continue;
    jobs.push({ scene: path.join(HERE, d, f), out: path.join(HERE, f.replace(/\.json$/, '.png')) });
  }
}
const t0 = Date.now();
const res = await renderWorld(jobs, { quiet: !args.includes('--verbose') });
console.log(`\n${res.length} images in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const r of res) console.log(`  ${path.relative(process.cwd(), r.out)}  ${r.ms} ms`);
