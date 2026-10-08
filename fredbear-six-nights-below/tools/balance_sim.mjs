// Balance simulator: plays every night with scripted player models and
// reports win rates, power margins and who wins when the player loses.
// Deterministic (fixed seed ranges) so the numbers in
// docs/05_NIGHTS_AND_BALANCE.md can be reproduced exactly:
//   node tools/balance_sim.mjs            -> table on stdout + tools/out/balance.json
// The player models are described in tools/lib/bots.mjs. They are models,
// not people: "human" only uses information a player could perceive.
import fs from 'node:fs';
import path from 'node:path';
import { NightSession } from '../packs/FredbearBP/scripts/core/session.js';
import { CONFIG } from '../packs/FredbearBP/scripts/core/config.js';
import { idleBot, oracleBot, humanBot, wastefulBot, runNight } from './lib/bots.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

export const PLAN = [
  { key: 'oracle', label: 'Oracle (perfect information)', seeds: 20, make: () => oracleBot() },
  { key: 'human', label: 'Human model (skill 1.0)', seeds: 30, make: (seed) => humanBot(seed, 1.0) },
  { key: 'human_low', label: 'Human model (skill 0.7)', seeds: 30, make: (seed) => humanBot(seed, 0.7) },
  { key: 'idle', label: 'Idle (does nothing)', seeds: 10, make: () => idleBot() },
  { key: 'wasteful', label: 'Wasteful (everything on)', seeds: 10, make: () => wastefulBot() },
];

const pct = (units) => Math.round((units / CONFIG.power.unitsPerPercent) * 10) / 10;

export async function simulate({ nights = [1, 2, 3, 4, 5, 6], plan = PLAN } = {}) {
  const out = {};
  for (const p of plan) {
    out[p.key] = { label: p.label, seeds: p.seeds, nights: {} };
    for (const night of nights) {
      const runs = [];
      for (let i = 0; i < p.seeds; i++) {
        const seed = 1000 + i;
        const r = await runNight(NightSession, { night, seed, bot: p.make(seed) });
        const tph = r.session.tph;
        runs.push({
          won: r.result === 'WON',
          endPower: pct(r.power),
          minPower: pct(r.minPower),
          lostAtHour: r.result === 'LOST' ? Math.floor(r.t / tph) : null,
          attacker: r.result === 'LOST' ? r.attacker : null,
          powerOut: r.fx.some((f) => f.fx === 'power_out' && f.stage === 'down'),
        });
      }
      const wins = runs.filter((r) => r.won);
      const losses = runs.filter((r) => !r.won);
      const by = {};
      for (const l of losses) by[l.attacker ?? 'none'] = (by[l.attacker ?? 'none'] ?? 0) + 1;
      out[p.key].nights[night] = {
        winRate: Math.round((wins.length / runs.length) * 100),
        meanEndPower: wins.length ? Math.round((wins.reduce((a, r) => a + r.endPower, 0) / wins.length) * 10) / 10 : null,
        worstMinPower: Math.min(...runs.map((r) => r.minPower)),
        powerOuts: runs.filter((r) => r.powerOut).length,
        lossesBy: by,
        meanLossHour: losses.length ? Math.round((losses.reduce((a, r) => a + r.lostAtHour, 0) / losses.length) * 10) / 10 : null,
      };
    }
  }
  return out;
}

export function table(res, nights = [1, 2, 3, 4, 5, 6]) {
  const lines = [];
  lines.push(`| Player model | ${nights.map((n) => `N${n}`).join(' | ')} |`);
  lines.push(`|---|${nights.map(() => '---').join('|')}|`);
  for (const r of Object.values(res)) {
    lines.push(`| ${r.label} (${r.seeds} seeds) | ${nights.map((n) => `${r.nights[n].winRate}%`).join(' | ')} |`);
  }
  return lines.join('\n');
}

export function detailTable(res, key, nights = [1, 2, 3, 4, 5, 6]) {
  const r = res[key];
  const lines = ['| Night | Win rate | Mean power left (wins) | Lowest power seen | Power-outs | Losses by | Mean loss hour |', '|---|---|---|---|---|---|---|'];
  for (const n of nights) {
    const d = r.nights[n];
    const by = Object.entries(d.lossesBy).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
    lines.push(`| ${n} | ${d.winRate}% | ${d.meanEndPower ?? '-'}% | ${d.worstMinPower}% | ${d.powerOuts} | ${by} | ${d.meanLossHour === null ? '-' : `${d.meanLossHour === 0 ? 12 : d.meanLossHour} AM`} |`);
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const res = await simulate();
  fs.mkdirSync(path.join(ROOT, 'tools/out'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tools/out/balance.json'), JSON.stringify(res, null, 1));
  console.log(table(res));
  for (const k of ['oracle', 'human', 'human_low']) {
    console.log(`\n${res[k].label}\n${detailTable(res, k)}`);
  }
  console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s)`);
}
