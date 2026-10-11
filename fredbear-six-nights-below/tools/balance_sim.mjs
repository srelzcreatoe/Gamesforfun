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
import { CONFIG, nightVariant } from '../packs/FredbearBP/scripts/core/config.js';
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

export const NIGHTS = [1, 2, 3, 4, 5, 6, 7, '8s', '8b', 9];

/** Night keys: a number, or '8s' / '8b' for night 8 after the seal / burn ending. */
export function nightSpec(k) {
  if (k === '8s') return { night: 8, overrides: nightVariant(8, 'seal'), label: 'N8 seal' };
  if (k === '8b') return { night: 8, overrides: nightVariant(8, 'burn'), label: 'N8 burn' };
  return { night: Number(k), overrides: undefined, label: `N${k}` };
}

/** One night (or challenge) for one player model over `seeds` seeds. */
async function runSeries(p, { night, overrides, options }) {
  const runs = [];
  for (let i = 0; i < p.seeds; i++) {
    const seed = 1000 + i;
    const r = await runNight(NightSession, { night, seed, bot: p.make(seed), overrides, options });
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
  return {
    winRate: Math.round((wins.length / runs.length) * 100),
    meanEndPower: wins.length ? Math.round((wins.reduce((a, r) => a + r.endPower, 0) / wins.length) * 10) / 10 : null,
    worstMinPower: Math.min(...runs.map((r) => r.minPower)),
    powerOuts: runs.filter((r) => r.powerOut).length,
    lossesBy: by,
    meanLossHour: losses.length ? Math.round((losses.reduce((a, r) => a + r.lostAtHour, 0) / losses.length) * 10) / 10 : null,
  };
}

/** Challenge modes for the oracle and both human models. */
export async function simulateChallenges(plan = PLAN.filter((p) => ['oracle', 'human', 'human_low'].includes(p.key))) {
  const out = {};
  for (const p of plan) {
    out[p.key] = { label: p.label, seeds: p.seeds, challenges: {} };
    for (const [id, c] of Object.entries(CONFIG.challenges)) {
      out[p.key].challenges[id] = await runSeries(p, { night: c.base, overrides: c.overrides, options: { mods: c.mods } });
    }
  }
  return out;
}

export function challengeTable(res) {
  const ids = Object.keys(CONFIG.challenges);
  const lines = [`| Player model | ${ids.map((id) => CONFIG.challenges[id].title).join(' | ')} |`, `|---|${ids.map(() => '---').join('|')}|`];
  for (const r of Object.values(res)) lines.push(`| ${r.label} (${r.seeds} seeds) | ${ids.map((id) => `${r.challenges[id].winRate}%`).join(' | ')} |`);
  return lines.join('\n');
}

export async function simulate({ nights = NIGHTS, plan = PLAN } = {}) {
  const out = {};
  for (const p of plan) {
    out[p.key] = { label: p.label, seeds: p.seeds, nights: {} };
    for (const k of nights) out[p.key].nights[k] = await runSeries(p, nightSpec(k));
  }
  return out;
}

export function table(res, nights = NIGHTS) {
  const lines = [];
  lines.push(`| Player model | ${nights.map((n) => nightSpec(n).label).join(' | ')} |`);
  lines.push(`|---|${nights.map(() => '---').join('|')}|`);
  for (const r of Object.values(res)) {
    lines.push(`| ${r.label} (${r.seeds} seeds) | ${nights.map((n) => `${r.nights[n].winRate}%`).join(' | ')} |`);
  }
  return lines.join('\n');
}

export function detailTable(res, key, nights = NIGHTS) {
  const r = res[key];
  const lines = ['| Night | Win rate | Mean power left (wins) | Lowest power seen | Power-outs | Losses by | Mean loss hour |', '|---|---|---|---|---|---|---|'];
  for (const n of nights) {
    const d = r.nights[n];
    const by = Object.entries(d.lossesBy).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
    lines.push(`| ${nightSpec(n).label.slice(1)} | ${d.winRate}% | ${d.meanEndPower ?? '-'}% | ${d.worstMinPower}% | ${d.powerOuts} | ${by} | ${d.meanLossHour === null ? '-' : `${d.meanLossHour === 0 ? 12 : d.meanLossHour} AM`} |`);
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const res = await simulate();
  const ch = await simulateChallenges();
  fs.mkdirSync(path.join(ROOT, 'tools/out'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tools/out/balance.json'), JSON.stringify({ nights: res, challenges: ch }, null, 1));
  console.log(table(res));
  for (const k of ['oracle', 'human', 'human_low']) {
    console.log(`\n${res[k].label}\n${detailTable(res, k)}`);
  }
  console.log(`\nChallenges\n${challengeTable(ch)}`);
  console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s)`);
}
