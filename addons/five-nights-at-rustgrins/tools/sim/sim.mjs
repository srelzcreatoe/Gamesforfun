// Headless night simulator with a bot guard, for balance and crash testing.
//
//   node tools/sim/sim.mjs [nights=1-6] [runs=200] [--bot=good|idle|sloppy] [--ai=m,n,r,c,p,t] [--verbose]
//
// The bot only acts on what a player could perceive: the hall light shows the
// door nodes, a working camera shows the nodes it sees, and a few loud audio
// tells (the Cat's run, maracas at a vent, the guitar at the left door,
// humming at the right window). It has reaction delays and a cyclic routine.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { NightSession } = await import(path.join(ROOT, 'packs/BP/scripts/core/session.js'));
const { CAMERA_BY_ID } = await import(path.join(ROOT, 'packs/BP/scripts/data/cameras.js'));
const { CAST } = await import(path.join(ROOT, 'packs/BP/scripts/core/config.js'));

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const pos = args.filter((a) => !a.startsWith('--'));
const [n1, n2] = (pos[0] ?? '1-6').split('-').map(Number);
const runs = Number(pos[1] ?? 200);
const botKind = opt.bot ?? 'good';
const customAi = opt.ai ? Object.fromEntries(String(opt.ai).split(',').map((v, i) => [CAST[i], Number(v)])) : null;

class Bot {
  constructor(s, kind, seed) {
    this.s = s;
    this.kind = kind;
    this.r = seed >>> 0 || 1;
    this.queue = []; // [tick, action, arg]
    this.busyUntil = 0;
    this.phase = 0;
    this.phaseUntil = 0;
    this.need = { L: false, R: false, VL: false, VR: false };
    this.rustAtNook = false;
    this.sloppy = kind === 'sloppy';
    this.earP = kind === 'good' ? 1 : kind === 'medium' ? 0.6 : 0.25; // chance an audio tell is noticed
    this.slow = kind === 'good' ? 0 : kind === 'medium' ? 15 : 25; // extra reaction ticks
  }
  heard() { return this.rand() < this.earP; }
  rand() { this.r = (this.r * 1664525 + 1013904223) >>> 0; return this.r / 4294967296; }
  react(min, max) { return this.s.t + min + this.slow + Math.floor(this.rand() * (max - min + 1 + this.slow)); }
  at(tick, action, arg) { this.queue.push([tick, action, arg]); }
  occupant(node) { return Object.values(this.s.chars).find((c) => c.node === node && !c.walk && !c.inside); }
  hear(e) {
    if (this.kind === 'idle') return;
    if (this.s.final) return this.hearFinal(e);
    const cue = ['at_nook', 'at_vent', 'ringmaster'].includes(e.fx) || (e.fx === 'sound' && ['fnar.cat.run', 'fnar.mirehop.strum', 'fnar.noxbriar.hum', 'fnar.rat.maracas'].includes(e.id));
    if (cue && !this.heard()) return;
    if (e.fx === 'at_nook') { this.rustAtNook = true; this.at(this.react(8, 30), 'want_door_r'); }
    if (e.fx === 'sound' && e.id === 'fnar.cat.run') { const side = e.at === 'door_l' ? 'L' : 'R'; this.need[side] = true; this.at(this.react(10, 30), side === 'L' ? 'want_door_l' : 'want_door_r'); }
    if (e.fx === 'cat_bang') { this.need[e.side] = false; }
    if (e.fx === 'sound' && e.id === 'fnar.rat.maracas' && (e.near || e.vent)) { const side = e.near || e.vent; this.need['V' + side] = true; this.at(this.react(8, 28), 'want_vent_' + side.toLowerCase()); }
    if (e.fx === 'at_vent') { this.need['V' + e.side] = true; this.at(this.react(8, 28), 'want_vent_' + e.side.toLowerCase()); }
    if (e.fx === 'vent_bang') { this.need['V' + e.side] = false; this.at(this.react(10, 40), 'release_vent_' + e.side.toLowerCase()); }
    if (e.fx === 'sound' && e.id === 'fnar.mirehop.strum') { this.need.L = true; this.at(this.react(10, 30), 'want_door_l'); }
    if (e.fx === 'sound' && e.id === 'fnar.noxbriar.hum' && !e.kitchen) { this.need.R = true; this.at(this.react(10, 30), 'want_door_r'); }
    if (e.fx === 'left_door') { this.need[e.side] = false; }
    if (e.fx === 'rusted' && e.on) this.at(this.react(8, 30), 'cams_open');
    if (e.fx === 'ringmaster' && e.state === 'leaving') this.at(this.react(10, 40), 'go_wind');
  }
  tick() {
    const s = this.s;
    const d = s.devices;
    // queued reactions
    this.queue.sort((a, b) => a[0] - b[0]);
    while (this.queue.length && this.queue[0][0] <= s.t) {
      const [, a, arg] = this.queue.shift();
      this.do(a, arg);
    }
    if (this.kind === 'idle') return;
    if (s.final) return this.finalTick();
    // Custom Night: the Ringmaster walks - hunt him with the spotlight now and then
    const rm = s.chars.top_hat_rat;
    if (rm.enabled && rm.out && s.t >= (this.huntAt ?? 0)) {
      this.huntAt = s.t + 70 + this.slow * 2;
      // save the light until he is in a hall
      const cam = rm.node && !rm.walk && ['2A', '2B', '4A', '4B'].find((c) => CAMERA_BY_ID[c].sees.includes(rm.node));
      if (cam) {
        if (!d.cams.open) s.input('cams_open', cam);
        else s.input('cam_select', cam);
        this.at(s.t + 8 + this.slow, 'spot');
        this.busyUntil = s.t + 14;
        return;
      }
    }
    if (s.t < this.busyUntil) return;
    // the routine: cams sweep, then lights, then rest
    const camsSweep = ['4B', '8', '2A', '4A'];
    if (this.phase === 0) { // raise cams
      if (!d.cams.open) s.input('cams_open', '4B');
      this.sweepIdx = 0; this.phase = 1; this.busyUntil = s.t + 12;
    } else if (this.phase === 1) {
      const cam = camsSweep[this.sweepIdx];
      if (!cam) { this.phase = 2; return; }
      if (cam === '8' && !s.tape.enabled) { this.sweepIdx++; return; }
      if (d.cams.cam !== cam) { s.input('cam_select', cam); this.busyUntil = s.t + 6; return; }
      // look
      if (cam === '8') {
        if (s.tape.level < 85000) { s.input('wind'); this.busyUntil = s.t + 9; return; }
      }
      if (cam === '4B') {
        const r = this.occupant('NOOK');
        this.rustAtNook = !!(r && r.id === 'rustgrin');
        if (this.rustAtNook && !d.doorR) s.input('door_r');
      }
      this.sweepIdx++; this.busyUntil = s.t + (this.sloppy ? 6 : 10);
    } else if (this.phase === 2) { // lower and check lights
      if (d.cams.open) s.input('cams_close');
      this.phase = 3; this.busyUntil = s.t + 8;
    } else if (this.phase === 3) {
      s.input('light_l'); this.phase = 4; this.busyUntil = s.t + 10;
    } else if (this.phase === 4) {
      const o = this.occupant('DOOR_L');
      this.need.L = !!o || this.need.L && false;
      if (o && !d.doorL) s.input('door_l');
      if (!o && d.doorL && !this.catRunning('L') && !this.ringmasterNear('L')) s.input('door_l');
      if (d.lightL) s.input('light_l');
      this.phase = 5; this.busyUntil = s.t + 6;
    } else if (this.phase === 5) {
      s.input('light_r'); this.phase = 6; this.busyUntil = s.t + 10;
    } else if (this.phase === 6) {
      const o = this.occupant('WIN_R') || this.occupant('DOOR_R');
      const keep = !!o || this.rustAtNook || this.catRunning('R');
      if (keep && !d.doorR) s.input('door_r');
      if (!keep && d.doorR) s.input('door_r');
      if (d.lightR) s.input('light_r');
      this.phase = 7; this.busyUntil = s.t + (this.sloppy ? 40 : 20 + Math.floor(this.rand() * 30));
    } else {
      this.phase = 0;
    }
  }
  // ---- the Final Act: answer every cue, then hunt the Ringmaster with the spotlight
  hearFinal(e) {
    const s = this.s;
    if (e.fx === 'event' && e.kind === 'summon') {
      this.summonSide = null;
      if (e.who !== 'cat' && e.who !== 'purple_rat') this.at(this.react(20, 60), `want_${e.guard}_${e.side.toLowerCase()}`);
    }
    // the Cat's bells / the Purple Rat's maracas tell which side
    if (e.fx === 'sound' && (e.id === 'fnar.cat.run' || e.id === 'fnar.cat.bell') && /door_/.test(e.at ?? '') && this.heard()) this.at(this.react(8, 25), `want_door_${e.at.slice(5)}`);
    if (e.fx === 'sound' && e.id === 'fnar.rat.maracas' && /vent_/.test(e.at ?? '') && this.heard()) this.at(this.react(8, 25), `want_vent_${e.at.slice(5)}`);
    if (e.fx === 'event' && e.kind === 'none') this.at(this.react(10, 30), 'release_all');
    if (e.fx === 'event' && e.kind === 'game') this.at(this.react(15, 45), 'game', e);
    if (e.fx === 'rusted' && e.on) this.at(this.react(8, 30), 'cams_open');
  }
  finalTick() {
    const s = this.s; const d = s.devices; const rm = s.chars.top_hat_rat;
    const ev = rm.event;
    if (ev && ev.kind === 'game' && ev.game === 'still') return; // hands off
    if (s.t < this.busyUntil) return;
    if (!rm.out) { if (d.cams.open && !(ev && (ev.game === 'cam' || ev.game === 'find'))) s.input('cams_close'); return; }
    // Act III: sweep the cameras that can see him and light him up
    const sweep = ['1C', '1B', '2A', '2B', '4A', '4B'];
    if (!d.cams.open) { s.input('cams_open', sweep[0]); this.busyUntil = s.t + 8; return; }
    const seen = rm.node && !rm.walk && CAMERA_BY_ID[d.cams.cam].sees.includes(rm.node);
    if (seen) { s.input('spotlight'); this.busyUntil = s.t + 12 + this.slow; return; }
    this.sweepI = ((this.sweepI ?? 0) + 1) % sweep.length;
    s.input('cam_select', sweep[this.sweepI]);
    this.busyUntil = s.t + 8 + this.slow;
  }
  catRunning(side) { const c = this.s.chars.cat; return c.state === 'run' && c.side === side; }
  ringmasterNear() { return false; }
  do(a, arg) {
    const s = this.s; const d = s.devices;
    if (a === 'want_vent_l' && !d.ventL) s.input('vent_l');
    if (a === 'want_vent_r' && !d.ventR) s.input('vent_r');
    if (a === 'spot') { s.input('spotlight'); return; }
    if (a === 'release_all') { if (d.doorL) s.input('door_l'); if (d.doorR) s.input('door_r'); if (d.ventL) s.input('vent_l'); if (d.ventR) s.input('vent_r'); if (d.lightL) s.input('light_l'); if (d.lightR) s.input('light_r'); return; }
    if (a === 'game') {
      const g = arg.game;
      if (g === 'cam' || g === 'find') { if (!d.cams.open) s.input('cams_open', arg.cam); else s.input('cam_select', arg.cam); this.busyUntil = s.t + 30; }
      if (g === 'doors') { if (!d.doorL) s.input('door_l'); if (!d.doorR) s.input('door_r'); }
      if (g === 'doors_open') { if (d.doorL) s.input('door_l'); if (d.doorR) s.input('door_r'); }
      if (g === 'light') s.input(arg.side === 'L' ? 'light_l' : 'light_r');
      if (g === 'vents') { if (!d.ventL) s.input('vent_l'); if (!d.ventR) s.input('vent_r'); }
      return;
    }
    if (a === 'want_door_l' && !d.doorL) s.input('door_l');
    if (a === 'want_door_r' && !d.doorR) s.input('door_r');
    if (a === 'want_door_r' && this.rustAtNook && d.cams.open && d.cams.cam !== '4B') s.input('cam_select', '4B');
    if (a === 'want_vent_l' && !d.ventL) s.input('vent_l');
    if (a === 'want_vent_r' && !d.ventR) s.input('vent_r');
    if (a === 'release_vent_l' && d.ventL) s.input('vent_l');
    if (a === 'release_vent_r' && d.ventR) s.input('vent_r');
    if (a === 'cams_open' && !d.cams.open) s.input('cams_open');
    if (a === 'go_wind') { this.phase = 1; this.sweepIdx = 1; if (!d.cams.open) s.input('cams_open', '8'); }
  }
}

function runNight(night, seed) {
  const s = new NightSession(night, { seed, ai: customAi ?? undefined });
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
