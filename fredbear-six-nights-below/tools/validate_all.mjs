// Runs every static validator and reports one summary line each.
//   npm run validate
// Exit code 1 if any validator fails. (Tests run separately: npm test.)
import { spawnSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const steps = [
  ['palette vs official block metadata', 'node', ['tools/validate_blocks.mjs']],
  ['map (routes, cameras, office seal, walkability)', 'node', ['tools/validate_map.mjs']],
  ['commands vs official 1.26.50 grammar', 'node', ['tools/validate_commands.mjs']],
  ['pack JSON vs official json_schemas', 'python3', ['tools/validate_schemas.py']],
  ['asset cross-references', 'node', ['tools/validate_assets.mjs']],
  ['Script API types (tsc vs @minecraft/server 2.10.0)', 'npx', ['--no-install', 'tsc', '-p', 'tsconfig.json']],
];

let failed = 0;
for (const [name, cmd, args] of steps) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').filter(Boolean);
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${out.length ? ` — ${out.at(-1)}` : ''}`);
  if (!ok) console.log(out.slice(-15).map((l) => `      ${l}`).join('\n'));
}
console.log(failed ? `\n${failed} validator(s) failed` : '\nall validators passed');
process.exit(failed ? 1 : 0);
