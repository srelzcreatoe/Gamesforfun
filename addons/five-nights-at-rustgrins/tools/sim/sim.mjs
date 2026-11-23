// Headless night simulator with a bot guard, for balance and crash testing.
//
//   node tools/sim/sim.mjs [nights=1-6] [runs=200] [--bot=good|medium|idle|sloppy|listener|gullible] [--ai=m,n,r,c,p,t[,g]] [--mods=lightsOut,tapeRot,doorJam]
//       --ai: the six levels in CAST order, then the Golden Dog's (left out: the night's own);  --golden=N: only his level
//   node tools/sim/sim.mjs --campaign [runs=200] [--bot=...]   the week with the cast's memory (core/ai/memory.js):
//       nights 1-5 in order, every night retried until it is won (4 tries at most), the memory carried along
//       the way the game does. Printed against the same nights played blank.
//   --cues   also count the tricks' cues per night, and the Golden Dog's shifts (g:visit, ...; g:seen = a visit looked at)
//
// The bot (tools/sim/bot.mjs) only acts on what a player could perceive.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { NightSession } = await import(path.join(ROOT, 'packs/BP/scripts/core/session.js'));
const { Bot } = await import('./bot.mjs');
const { CAST, FULL_CAST, GOLDEN } = await import(path.join(ROOT, 'packs/BP/scripts/core/config.js'));
const { remember } = await import(path.join(ROOT, 'packs/BP/scripts/core/ai/memory.js'));

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const pos = args.filter((a) => !a.startsWith('--'));
const [n1, n2] = (pos[0] ?? '1-6').split('-').map(Number);
const runs = Number(pos[1] ?? 200);
const botKind = opt.bot ?? 'good';
const customAi = opt.ai ? Object.fromEntries(String(opt.ai).split(',').map((v, i) => [FULL_CAST[i], Number(v)])) : opt.golden !== undefined ? { [GOLDEN]: Number(opt.golden) } : null;
const custom = !!opt.ai;
const count = (night, k) => { (cueCount[night] ??= {})[k] = (cueCount[night]?.[k] ?? 0) + 1; };
const mods = opt.mods ? Object.fromEntries(String(opt.mods).split(',').map((m) => [m, true])) : undefined;

const cueCount = {};
function runNight(night, seed, memory = null) {
  const s = new NightSession(night, { seed, ai: customAi ?? undefined, mods, memory });
  const bot = new Bot(s, botKind, seed * 31 + 7);
  let ticks = 0;
  const trace = opt.trace && seed === 1000 + night ? [] : null;
  if (opt.power) {
    // account where the power goes: devices per tick vs one-off drains (bangs, spotlights)
    const acc = (s.powerAcc = { base: 0, door: 0, light: 0, cams: 0, vent: 0, oneoff: 0 });
    const orig = s.drainPower.bind(s);
    let inTick = false;
    const tickOrig = s.tick.bind(s);
    s.tick = () => { inTick = true; tickOrig(); inTick = false; };
    s.drainPower = (u) => {
      const d = s.devices; const P = s.cfg.power;
      if (u >= 1000) acc.oneoff += u;
      else { acc.door += (d.doorL ? P.door : 0) + (d.doorR ? P.door : 0); acc.light += (d.lightL ? P.light : 0) + (d.lightR ? P.light : 0); acc.cams += d.cams.open ? P.cams : 0; acc.vent += (d.ventL ? P.vent : 0) + (d.ventR ? P.vent : 0); acc.base += P.base[night] ?? 3; }
      orig(u);
    };
  }
  while (!s.result && ticks < 20000) {
    s.tick();
    for (const e of s.drain()) {
      bot.hear(e);
      if (opt.cues && e.fx === 'cue' && !e.again) count(night, e.kind);
      if (opt.cues && e.fx === 'golden' && (e.kind === 'shift' || (e.kind === 'seen' && e.on) || (e.kind === 'stare' && e.on))) count(night, `g:${e.shift ?? e.kind}`);
      if (trace && ['pa', 'event', 'act', 'spotlight', 'jumpscare', 'power_out', 'door', 'vent', 'hour'].includes(e.fx)) trace.push(`${s.t} h${s.hour} p${Math.round(s.power / 1000)} ${JSON.stringify(e).slice(0, 120)}`);
    }
    if (!s.result) bot.tick();
    ticks++;
  }
  if (trace) console.log(trace.slice(-60).join('\n'));
  if (opt.power && seed === 1000 + night) console.log('power use (%):', Object.fromEntries(Object.entries(s.powerAcc).map(([k, v]) => [k, Math.round(v / 1000)])), 'hour', s.hour);
  return { result: s.result, killer: s.killer, hour: s.hour, power: Math.round(s.power / 1000), summary: s.summary() };
}

if (opt.campaign) {
  // the week, with and without the cast's memory
  const N = Number(pos[0] ?? 200);
  const TRIES = 4;
  const won = (r) => r.result === 'win' || r.result === 'takeover';
  const row = () => ({ first: 0, firstN: 0, retry: 0, retryN: 0, blank: 0, blankRetry: 0, grudgeKills: 0, sameKiller: 0 });
  const stat = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, row()]));
  let weeks = 0;
  for (let i = 0; i < N; i++) {
    let mem = null;
    let cleared = true;
    for (let n = 1; n <= 5 && cleared; n++) {
      let last = null;
      for (let k = 0; k < TRIES; k++) {
        const seed = 1000 + i * 7919 + n + k * 104729;
        if (n === 1) mem = null; // night 1 always starts blank
        const r = runNight(n, seed, mem);
        const b = runNight(n, seed, null);
        const st = stat[n];
        if (k === 0) { st.firstN++; if (won(r)) st.first++; if (won(b)) st.blank++; } else { st.retryN++; if (won(r)) st.retry++; if (won(b)) st.blankRetry++; if (!won(r) && r.killer === last) st.sameKiller++; }
        if (r.killer !== GOLDEN) mem = remember(mem, r.summary); // (the week's memory does not track him: mc/game.js does the same)
        last = r.killer;
        if (won(r)) break;
        if (k === TRIES - 1) cleared = false;
      }
    }
    if (cleared) weeks++;
  }
  console.log(`the week with memory, bot=${botKind}, ${N} weeks (up to ${TRIES} tries a night): ${(100 * weeks / N).toFixed(0)}% of weeks cleared`);
  for (const n of [1, 2, 3, 4, 5]) {
    const st = stat[n];
    const p = (a, b) => (b ? `${(100 * a / b).toFixed(0)}%` : '-');
    console.log(`night ${n}: first try ${p(st.first, st.firstN)} (blank ${p(st.blank, st.firstN)}, ${st.firstN} nights)   retries after a death ${p(st.retry, st.retryN)} (blank ${p(st.blankRetry, st.retryN)}, ${st.retryN} retries; ${st.sameKiller} lost to the same one again)`);
  }
  process.exit(0);
}

for (let n = n1; n <= (n2 || n1); n++) {
  const killers = {};
  let wins = 0; let powerSum = 0; let powerOuts = 0;
  for (let i = 0; i < runs; i++) {
    const r = runNight(n, 1000 + i * 7919 + n);
    if (r.result === 'win' || r.result === 'takeover') { wins++; powerSum += r.power; } else killers[r.killer] = (killers[r.killer] ?? 0) + 1;
    if (r.power === 0) powerOuts++;
  }
  console.log(`night ${n}${custom ? ' (custom)' : ''} bot=${botKind}: win ${(100 * wins / runs).toFixed(0)}%  avg power left ${(wins ? powerSum / wins : 0).toFixed(0)}%  power-outs ${powerOuts}  deaths ${JSON.stringify(killers)}`);
  if (opt.cues) console.log(`   cues per night: ${Object.entries(cueCount[n] ?? {}).sort().map(([k, v]) => `${k} ${(v / runs).toFixed(2)}`).join(', ') || 'none'}`);
}
