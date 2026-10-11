// Regenerates every generated artifact from source, then packages the packs.
//   npm run build
// Order matters: structures feed the register and the builder table; the
// voxel-based floor plans and the RP art are independent; docs come last.
import { spawnSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const steps = [
  ['command-block structures + register data', 'node', ['tools/gen_structures.mjs']],
  ['command-block register (docs/06, CSV)', 'node', ['tools/gen_cb_register.mjs']],
  ['player route-guidance graph', 'node', ['tools/gen_guide.mjs']],
  ['seasonal decorations (needs the guidance graph)', 'node', ['tools/gen_holidays.mjs']],
  ['floor plan data', 'node', ['tools/export_floorplan.mjs']],
  ['floor plan images', 'python3', ['tools/render_floorplans.py']],
  ['resource pack art, models, animations, fogs, icons', 'python3', ['tools/gen_rp.py']],
  ['camera map HUD (needs the floor plan data)', 'python3', ['tools/gen_cam_map.py']],
  ['resource pack sounds', 'python3', ['tools/gen_sounds.py']],
  ['model preview sheet', 'python3', ['tools/render_preview.py']],
  ['generated docs (02 floor plan, 05 balance)', 'node', ['tools/gen_docs.mjs']],
  ['packages (dist/)', 'python3', ['tools/package.py']],
];

for (const [name, cmd, args] of steps) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').filter(Boolean);
  if (r.status !== 0) {
    console.error(`FAIL  ${name}\n${out.slice(-20).join('\n')}`);
    process.exit(1);
  }
  console.log(`ok    ${name}${out.length ? ` — ${out.at(-1)}` : ''}`);
}
