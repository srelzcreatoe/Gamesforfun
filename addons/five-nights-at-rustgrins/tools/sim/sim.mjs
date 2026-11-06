// Headless night simulator with a bot guard, for balance and crash testing.
//
//   node tools/sim/sim.mjs [nights=1-6] [runs=200] [--bot=good|medium|idle|sloppy] [--ai=m,n,r,c,p,t] [--mods=lightsOut,tapeRot,doorJam]
//
// The bot (tools/sim/bot.mjs) only acts on what a player could perceive.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { NightSession } = await import(path.join(ROOT, 'packs/BP/scripts/core/session.js'));
const { Bot } = await import('./bot.mjs');
const { CAST } = await import(path.join(ROOT, 'packs/BP/scripts/core/config.js'));

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const pos = args.filter((a) => !a.startsWith('--'));
const [n1, n2] = (pos[0] ?? '1-6').split('-').map(Number);
const runs = Number(pos[1] ?? 200);
const botKind = opt.bot ?? 'good';
const customAi = opt.ai ? Object.fromEntries(String(opt.ai).split(',').map((v, i) => [CAST[i], Number(v)])) : null;
const mods = opt.mods ? Object.fromEntries(String(opt.mods).split(',').map((m) => [m, true])) : undefined;

function runNight(night, seed) {
  const s = new NightSession(night, { seed, ai: customAi ?? undefined, mods });
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
      if (trace && ['pa', 'event', 'act', 'spotlight', 'jumpscare', 'power_out', 'door', 'vent', 'hour'].includes(e.fx)) trace.push(`${s.t} h${s.hour} p${Math.round(s.power / 1000)} ${JSON.stringify(e).slice(0, 120)}`);
    }
    if (!s.result) bot.tick();
    ticks++;
  }
  if (trace) console.log(trace.slice(-60).join('\n'));
  if (opt.power && seed === 1000 + night) console.log('power use (%):', Object.fromEntries(Object.entries(s.powerAcc).map(([k, v]) => [k, Math.round(v / 1000)])), 'hour', s.hour);
  return { result: s.result, killer: s.killer, hour: s.hour, power: Math.round(s.power / 1000) };
}

for (let n = n1; n <= (n2 || n1); n++) {
  const killers = {};
  let wins = 0; let powerSum = 0; let powerOuts = 0;
  for (let i = 0; i < runs; i++) {
    const r = runNight(n, 1000 + i * 7919 + n);
    if (r.result === 'win' || r.result === 'takeover') { wins++; powerSum += r.power; } else killers[r.killer] = (killers[r.killer] ?? 0) + 1;
    if (r.power === 0) powerOuts++;
  }
  console.log(`night ${n}${customAi ? ' (custom)' : ''} bot=${botKind}: win ${(100 * wins / runs).toFixed(0)}%  avg power left ${(wins ? powerSum / wins : 0).toFixed(0)}%  power-outs ${powerOuts}  deaths ${JSON.stringify(killers)}`);
}
