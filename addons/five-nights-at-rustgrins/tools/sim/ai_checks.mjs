// Behaviour checks for the animatronic AI (core/ai): scripted guards and many seeded nights.
//
//   node tools/sim/ai_checks.mjs [--runs=40] [--verbose]
//
// Exit code 1 when a check fails. Every check uses the pure core only (no Minecraft), so the
// numbers are deterministic for a given seed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const core = (p) => import(path.join(ROOT, 'packs/BP/scripts', p));
const { NightSession } = await core('core/session.js');
const { CONFIG } = await core('core/config.js');
const { NODES } = await core('data/nodes.js');
const { CAMS_FOR_NODE } = await core('data/cameras.js');
const { planPath, DOOR_NODES, isCrawl } = await core('core/ai/graph.js');
const { Bot } = await import('./bot.mjs');

const opt = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const RUNS = Number(opt.runs ?? 40);
let failed = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
};
const pct = (a, b) => (b ? (100 * a) / b : 0).toFixed(0) + '%';
const ONLY = (over) => ({ mirehop: 0, noxbriar: 0, rustgrin: 0, cat: 0, purple_rat: 0, top_hat_rat: 0, ...over });
const CUES = new Set();
const night = (n, seed, o = {}) => {
  const s = new NightSession(n, { seed, ...o });
  const emit = s.emit.bind(s);
  s.emit = (e) => {
    if (e.fx === 'cue') CUES.add(e.kind);
    emit(e);
  };
  return s;
};

/** Run a session with a per-tick guard script and an fx listener until it ends or `ticks` pass. */
function run(s, { ticks = 20000, guard = null, onFx = null, each = null } = {}) {
  while (!s.result && s.t < ticks) {
    s.tick();
    for (const e of s.drain()) onFx?.(e, s);
    each?.(s);
    if (!s.result) guard?.(s);
  }
  return s;
}

/** A night played by the sim bot. */
function botNight(n, seed, kind, hooks = {}) {
  const s = night(n, seed, hooks.opts);
  const bot = new Bot(s, kind, seed * 31 + 7);
  return run(s, {
    ...hooks,
    onFx: (e) => { bot.hear(e); hooks.onFx?.(e, s); },
    guard: () => bot.tick(),
  });
}

// ------------------------------------------------------------------------ 1. graph
{
  let ok = true;
  for (const side of ['L', 'R']) {
    for (const n of Object.keys(NODES)) {
      if (isCrawl(n) || NODES[n].door) continue;
      if (!planPath(n, DOOR_NODES[side][0], { blocked: (m) => isCrawl(m) })) ok = false;
    }
  }
  check(ok, 'the route graph: every walkable node has a path to both office doors');
  // a stalker placed somewhere its table does not know still finds its way to its door
  const s = night(3, 7, { ai: ONLY({ mirehop: 20 }), ticksPerHour: 3000 });
  s.chars.mirehop.placeAt('DIN_CAB', 'stand');
  let reached = false;
  run(s, { ticks: 6000, onFx: (e) => { if (e.fx === 'at_door' && e.who === 'mirehop') reached = true; } });
  check(reached, 'Mirehop placed off his table (DIN_CAB) plans a path to the left door');
}

// ------------------------------------------------------------------------ 2. determinism
{
  const hash = (n, seed) => {
    let h = 0;
    botNight(n, seed, 'good', { onFx: (e) => { const j = JSON.stringify(e); for (let i = 0; i < j.length; i++) h = (Math.imul(h, 31) + j.charCodeAt(i)) | 0; } });
    return h;
  };
  let same = true;
  for (const n of [1, 3, 5, 7, 8]) if (hash(n, 4242 + n) !== hash(n, 4242 + n)) same = false;
  check(same, 'deterministic: the same seed and guard give the same night, effect for effect');
}

// ------------------------------------------------------------------------ 3. Mirehop prefers moves while unwatched
{
  // a guard who stares at the dining room (CAM 1B) half the time and the backstage (CAM 5) otherwise
  let moves = 0;
  let watchedMoves = 0;
  let slips = 0;
  let watchedTicks = 0;
  let idleTicks = 0;
  for (let i = 0; i < RUNS; i++) {
    const s = night(3, 100 + i, { ai: ONLY({ mirehop: 12 }), ticksPerHour: 1200 });
    let slipNext = false;
    run(s, {
      guard: (s) => {
        if (s.t % 400 === 1) s.input('cams_open', '1B');
        if (s.t % 400 === 201) s.input('cam_select', '5');
        if (s.chars.mirehop.node === 'DOOR_L' && !s.devices.doorL) s.input('door_l');
        if (s.chars.mirehop.node !== 'DOOR_L' && s.devices.doorL && s.t % 40 === 0) s.input('door_l');
      },
      onFx: (e, s) => {
        if (e.fx === 'cue' && e.kind === 'slip') slipNext = true;
        if (e.fx === 'move' && e.who === 'mirehop') {
          moves++;
          if (slipNext) slips++;
          else if (s.isWatchingNode(e.fromNode)) watchedMoves++;
          slipNext = false;
        }
      },
      each: (s) => {
        const m = s.chars.mirehop;
        if (m.walk || !m.node || m.node === 'DOOR_L') return;
        idleTicks++;
        if (s.isWatchingNode(m.node)) watchedTicks++;
      },
    });
  }
  check(moves > 50 && watchedMoves === 0, 'Mirehop never starts a planned move while the guard watches him', `${moves} moves, ${watchedMoves} watched, ${slips} slips; watched ${pct(watchedTicks, idleTicks)} of his idle time`);
  check(slips > 0 && slips < moves * 0.2, 'stared at too long, Mirehop sometimes slips out of the frame (cue: the feed tears)', `${slips} slips`);
}

// ------------------------------------------------------------------------ 4. no stacking at a door
{
  let ticks = 0;
  let stacked = 0;
  let rightBoth = 0;
  for (const kind of ['good', 'medium']) {
    for (const n of [3, 4, 5, 7, 8]) {
      for (let i = 0; i < RUNS / 4; i++) {
        botNight(n, 900 + i * 13 + n, kind, {
          each: (s) => {
            ticks++;
            const c = s.chars;
            for (const side of ['L', 'R', 'VL', 'VR']) if (Object.values(c).filter((x) => x.holds(side)).length > 1) stacked++;
            const nox = c.noxbriar.node === 'WIN_R' || c.noxbriar.walk?.to === 'WIN_R';
            const rust = c.rustgrin.node === 'NOOK' || c.rustgrin.walk?.to === 'NOOK';
            if (nox && rust) rightBoth++;
          },
        });
      }
    }
  }
  check(stacked === 0 && rightBoth === 0, 'no two animatronics work the same way in (Noxbriar never at the window while Rustgrin is in the nook)', `${ticks} ticks checked`);
}

// ------------------------------------------------------------------------ 5. patience at a shut door
{
  let stays = 0;
  let longest = 0;
  let over = 0;
  const hold = CONFIG.characters.mirehop.hold(20);
  for (let i = 0; i < RUNS / 2; i++) {
    const s = night(3, 300 + i, { ai: ONLY({ mirehop: 20 }), ticksPerHour: 1000 });
    let since = -1;
    run(s, {
      guard: (s) => { if (!s.devices.doorL) s.input('door_l'); }, // camps the left door all night
      each: (s) => {
        const at = s.chars.mirehop.node === 'DOOR_L';
        if (at && since < 0) since = s.t;
        if (!at && since >= 0) {
          stays++;
          longest = Math.max(longest, s.t - since);
          if (s.t - since > hold + 2) over++;
          since = -1;
        }
      },
    });
  }
  check(stays > RUNS && over === 0, 'patience: Mirehop gives up on a shut door within his hold time (shorter when the door is camped)', `${stays} visits, longest ${longest} ticks, hold ${hold}`);
}

// ------------------------------------------------------------------------ 6. the fake-out comes back when the door opens
{
  let lingers = 0;
  let back = 0;
  let toldBack = 0;
  for (let i = 0; i < RUNS; i++) {
    const s = night(3, 500 + i, { ai: ONLY({ mirehop: 20 }), ticksPerHour: 1500 });
    let lingerAt = -1;
    let openedAt = -1;
    let stepped = false;
    let counted = false;
    run(s, {
      guard: (s) => {
        const m = s.chars.mirehop;
        if (lingerAt < 0 && !s.devices.doorL) s.input('door_l');
        // he lingers: open the door once he reaches the corner, and wait for him
        if (lingerAt >= 0 && openedAt < 0 && !m.walk && s.devices.doorL) {
          s.input('door_l');
          openedAt = s.t;
        }
        if (openedAt >= 0 && m.node === 'DOOR_L' && !s.devices.doorL) s.input('door_l');
      },
      onFx: (e, s) => {
        if (e.fx === 'cue' && e.kind === 'linger' && lingerAt < 0) { lingerAt = s.t; lingers++; }
        if (openedAt >= 0 && e.fx === 'sound' && e.id === 'fnar.step.heavy' && e.approach === 'L') stepped = true;
        if (!counted && openedAt >= 0 && e.fx === 'at_door' && e.who === 'mirehop' && s.t - openedAt < 220) {
          counted = true;
          back++;
          if (stepped) toldBack++;
        }
      },
    });
  }
  check(lingers > RUNS / 3 && back >= lingers * 0.8, 'a fake-out: he waits in the corner and comes back soon after the door opens', `${lingers} fake-outs, ${back} came back`);
  check(toldBack === back, 'the comeback is announced by footsteps in the West Hall', `${toldBack}/${back}`);
}

// ------------------------------------------------------------------------ 6b. a light left on is no wall
{
  let mire = 0;
  let rust = 0;
  for (let i = 0; i < RUNS / 2; i++) {
    run(night(3, 600 + i, { ai: ONLY({ mirehop: 12 }), ticksPerHour: 1500, mods: { infinitePower: true } }), {
      guard: (s) => { if (!s.devices.lightL) s.input('light_l'); },
      onFx: (e) => { if (e.fx === 'at_door' && e.who === 'mirehop') mire++; },
    });
    run(night(4, 650 + i, { ai: ONLY({ rustgrin: 14 }), ticksPerHour: 1500, mods: { infinitePower: true } }), {
      guard: (s) => { if (!s.devices.lightR) s.input('light_r'); if (!s.devices.doorR) s.input('door_r'); },
      onFx: (e) => { if (e.fx === 'at_nook') rust++; },
    });
  }
  check(mire >= RUNS / 2 && rust >= RUNS / 2, 'a hall light left on all night only delays them: Mirehop still reaches the door, Rustgrin the nook', `${mire} door visits, ${rust} nook visits`);
}

// ------------------------------------------------------------------------ 7. the learned light rhythm
{
  // a guard who checks the left light every 150 ticks (and shuts the door on whoever is there)
  let steps = 0;
  let good = 0;
  for (let i = 0; i < RUNS; i++) {
    const s = night(3, 700 + i, { ai: ONLY({ mirehop: 14 }), ticksPerHour: 1500 });
    run(s, {
      guard: (s) => {
        const ph = s.t % 150;
        if (ph === 0 && !s.devices.lightL) s.input('light_l');
        if (ph === 12) {
          if (s.chars.mirehop.node === 'DOOR_L' && !s.devices.doorL) s.input('door_l');
          if (s.devices.lightL) s.input('light_l');
        }
        if (s.devices.doorL && s.chars.mirehop.node !== 'DOOR_L' && !s.chars.mirehop.walk && ph === 30) s.input('door_l');
      },
      onFx: (e, s) => {
        if (e.fx === 'move' && e.who === 'mirehop' && e.toNode === 'DOOR_L' && s.chars.mirehop.state !== 'linger') {
          steps++;
          const since = s.habits.sinceCheck('L');
          if (since > 0 && since < 150 * CONFIG.brain.afterCheck + 5) good++;
        }
      },
    });
  }
  check(steps > RUNS && good / steps > 0.7, 'Mirehop learns the light rhythm: he steps into the doorway right after a check', `${pct(good, steps)} of ${steps} steps (blind timing would be ~45%)`);
}

// ------------------------------------------------------------------------ 8. a camped door shifts the pressure
{
  const trial = (campLeft) => {
    let nox = 0;
    let ratR = 0;
    let ratTrips = 0;
    for (let i = 0; i < RUNS; i++) {
      const s = night(4, 1100 + i, { ai: ONLY({ mirehop: 8, noxbriar: 8, purple_rat: 14 }), ticksPerHour: 2500, mods: { infinitePower: true } });
      run(s, {
        guard: (s) => {
          if (campLeft && !s.devices.doorL) s.input('door_l');
          if (!campLeft && s.chars.mirehop.node === 'DOOR_L' && !s.devices.doorL) s.input('door_l');
          if (!campLeft && s.chars.mirehop.node !== 'DOOR_L' && s.devices.doorL) s.input('door_l');
          if (s.chars.noxbriar.node === 'WIN_R' && !s.devices.doorR) s.input('door_r');
          if (s.chars.noxbriar.node !== 'WIN_R' && s.devices.doorR) s.input('door_r');
          for (const v of ['L', 'R']) {
            const at = s.chars.purple_rat.state === 'vent' && s.chars.purple_rat.side === v;
            if (at !== s.ventClosed(v)) s.input(v === 'L' ? 'vent_l' : 'vent_r');
          }
        },
        onFx: (e) => {
          if (e.fx === 'at_door' && e.who === 'noxbriar') nox++;
          if (e.fx === 'at_vent') {
            ratTrips++;
            if (e.side === 'R') ratR++;
          }
        },
      });
    }
    return { nox, ratR, ratTrips };
  };
  const camp = trial(true);
  const fair = trial(false);
  check(camp.nox > fair.nox * 1.1, 'pincer: while the guard camps the left door, Noxbriar comes to the right window more often', `${camp.nox} vs ${fair.nox} visits`);
  check(camp.ratR / Math.max(1, camp.ratTrips) > fair.ratR / Math.max(1, fair.ratTrips) + 0.05, 'pincer: the Purple Rat works the right vent more while the left door is camped', `${pct(camp.ratR, camp.ratTrips)} of ${camp.ratTrips} vent visits vs ${pct(fair.ratR, fair.ratTrips)} of ${fair.ratTrips}`);
}

// ------------------------------------------------------------------------ 9. Rustgrin: camera-shy, and the blink
{
  let moves = 0;
  let intoWatched = 0;
  let blinks = 0;
  let stares = 0;
  for (let i = 0; i < RUNS; i++) {
    const s = night(4, 1500 + i, { ai: ONLY({ rustgrin: 18 }), ticksPerHour: 1500 });
    run(s, {
      // stare at wherever he is for 60 ticks, then look elsewhere for 80
      guard: (s) => {
        const r = s.chars.rustgrin;
        const ph = s.t % 140;
        if (ph === 0 && r.node && CAMS_FOR_NODE[r.node]?.length) {
          s.input('cams_open', CAMS_FOR_NODE[r.node][0]);
          s.input('cam_select', CAMS_FOR_NODE[r.node][0]);
        }
        if (ph === 60) { s.input('cams_close'); stares++; }
        if (r.node === 'NOOK' && !s.devices.doorR) s.input('door_r');
      },
      onFx: (e, s) => {
        if (e.fx === 'move' && e.who === 'rustgrin') {
          moves++;
          if (s.isWatchingNode(e.toNode)) intoWatched++;
        }
        if (e.fx === 'cue' && e.kind === 'blink') blinks++;
      },
    });
  }
  check(moves > 30 && intoWatched === 0, 'Rustgrin never steps into a room the guard is watching', `${moves} moves`);
  check(blinks > 0, 'when a long stare ends Rustgrin may move at once (cue: a low laugh)', `${blinks} blinks after ${stares} stares`);
}

// ------------------------------------------------------------------------ 10. the Purple Rat is nervous on camera
{
  let nervous = 0;
  let squeaks = 0;
  for (let i = 0; i < RUNS / 2; i++) {
    const s = night(4, 1900 + i, { ai: ONLY({ purple_rat: 16 }), ticksPerHour: 1500, mods: { infinitePower: true } });
    run(s, {
      guard: (s) => {
        const r = s.chars.purple_rat;
        const cam = r.side === 'L' ? '9' : '10';
        if (!s.devices.cams.open) s.input('cams_open', cam);
        else if (s.devices.cams.cam !== cam) s.input('cam_select', cam);
        for (const v of ['L', 'R']) if (!s.ventClosed(v)) s.input(v === 'L' ? 'vent_l' : 'vent_r');
      },
      onFx: (e) => {
        if (e.fx === 'cue' && e.kind === 'nervous') nervous++;
        if (e.fx === 'sound' && e.id === 'fnar.rat.squeak') squeaks++;
      },
    });
  }
  check(nervous > 0 && squeaks >= nervous, 'stared at in a duct, the Purple Rat squeaks and backs off', `${nervous} times`);
}

// ------------------------------------------------------------------------ 11. fairness: spacing, warning time, cues
{
  let strikes = 0;
  let tooClose = 0;
  let inBreather = 0;
  let entries = 0;
  let early = 0;
  const kinds = new Set();
  let approach = 0;
  let growls = 0;
  const grace = Math.min(CONFIG.characters.mirehop.entryGrace, CONFIG.characters.noxbriar.entryGrace);
  for (const kind of ['good', 'medium']) {
    for (const n of [2, 3, 4, 5, 7, 8]) {
      for (let i = 0; i < RUNS / 4; i++) {
        let last = { t: -1e9, who: null };
        let breather = 0;
        const arrived = {};
        botNight(n, 2300 + i * 17 + n, kind, {
          onFx: (e, s) => {
            if (e.fx === 'cue') kinds.add(e.kind);
            if (e.fx === 'sound' && e.approach) approach++;
            if (e.fx === 'sound' && e.id === 'fnar.cat.growl') growls++;
            if (e.fx === 'at_door') arrived[e.who] = s.t;
            if (e.fx === 'sound' && e.id === 'fnar.servo.move' && arrived[e.at] !== undefined) {
              entries++;
              if (s.t - arrived[e.at] < grace) early++;
            }
          },
          each: (s) => {
            const d = s.director;
            if (d.lastStrike === s.t && d.enabled) {
              strikes++;
              if (last.who !== d.lastStriker && s.t - last.t < CONFIG.director.minGap) tooClose++;
              if (s.t < breather) inBreather++;
              last = { t: s.t, who: d.lastStriker };
            }
            breather = d.breatherUntil;
          },
        });
      }
    }
  }
  check(strikes > 100 && tooClose === 0 && inBreather === 0, 'spacing: strikes by different animatronics are at least minGap apart, none during a breather', `${strikes} strikes`);
  check(entries > 20 && early === 0, `fair warning: no door entry starts sooner than ${grace} ticks after the arrival tell`, `${entries} entries`);
  check(kinds.has('linger') && approach > 100, 'in play, the fake-outs and the hall footsteps / hums are heard', `cues: ${[...kinds].join(', ')}; ${approach} hall sounds`);
}

// ------------------------------------------------------------------------ 12. the Cat picks her hall
{
  const trial = (campLeft) => {
    let east = 0;
    let runs = 0;
    let told = 0;
    for (let i = 0; i < RUNS; i++) {
      const s = night(4, 2700 + i, { ai: ONLY({ cat: 14 }), ticksPerHour: 1500, mods: { infinitePower: true } });
      let growl = null;
      run(s, {
        guard: (s) => {
          if (campLeft && !s.devices.doorL) s.input('door_l');
          if (!s.devices.doorR && s.chars.cat.state === 'run' && s.chars.cat.side === 'R') s.input('door_r');
          if (!campLeft && !s.devices.doorL && s.chars.cat.state === 'run' && s.chars.cat.side === 'L') s.input('door_l');
          if (s.chars.cat.state !== 'run' && s.devices.doorR) s.input('door_r');
          if (!campLeft && s.chars.cat.state !== 'run' && s.devices.doorL) s.input('door_l');
        },
        onFx: (e, s) => {
          if (e.fx === 'sound' && e.id === 'fnar.cat.growl') growl = e.approach;
          if (e.fx === 'sound' && e.id === 'fnar.cat.run') {
            runs++;
            if (s.chars.cat.side === 'R') east++;
            if (growl === s.chars.cat.side) told++;
            growl = null;
          }
        },
      });
    }
    return { east, runs, told };
  };
  const camp = trial(true);
  const fair = trial(false);
  check(camp.east / Math.max(1, camp.runs) > fair.east / Math.max(1, fair.runs) + 0.15, 'the Cat prefers the hall whose door is open: a camped left door sends her east more often', `east ${pct(camp.east, camp.runs)} of ${camp.runs} runs vs ${pct(fair.east, fair.runs)} of ${fair.runs}`);
  check(camp.told === camp.runs && fair.told === fair.runs, 'a low growl down the hall she picked tells which door she will run to', `${camp.told + fair.told}/${camp.runs + fair.runs}`);
}

check(['linger', 'slip', 'blink', 'nervous', 'switch'].every((k) => CUES.has(k)), 'every new habit has its own tell (a cue the game renders as a sound and a caption)', [...CUES].join(', '));

// ------------------------------------------------------------------------ 12b. the Ringmaster remembers the spotlight
{
  // spotlight him on the west route: hits are remembered by side, and his next walks lean east
  const s = night(7, 3100, { ai: ONLY({ top_hat_rat: 20 }), ticksPerHour: 2000, mods: { infinitePower: true } });
  const rm = s.chars.top_hat_rat;
  run(s, { ticks: 1300 });
  const westRoute = CONFIG.characters.top_hat_rat.routes.L;
  rm.side = 'L';
  rm.state = 'walk';
  rm.idx = westRoute.findIndex((n, k) => k >= 3 && CAMS_FOR_NODE[n]?.length);
  rm.placeAt(westRoute[rm.idx], 'stand');
  rm.pauseUntil = s.t + 2000;
  const cam = CAMS_FOR_NODE[rm.node][0];
  s.input('cams_open', cam);
  s.input('cam_select', cam);
  run(s, { ticks: s.t + 40 }); // the placement's static clears
  const hit = s.input('spotlight');
  let east = 0;
  for (let i = 0; i < 400; i++) if (rm.pickSide() === 'R') east++;
  check(hit.hit && rm.spotHits.L === 1 && east > 400 * 0.6, 'the Ringmaster remembers where the spotlight caught him and walks the other way more often', `west hits ${rm.spotHits.L}, then ${pct(east, 400)} of walks east`);
}

// ------------------------------------------------------------------------ 13. the director
{
  const s = night(4, 5);
  s.t = Math.round(s.ticksPerHour * 3); // 3 AM
  s.power = 80000;
  const cruising = s.director.judge();
  s.power = 20000;
  const struggling = s.director.judge();
  s.power = 52000;
  s.director.closeCalls = [s.t - 100, s.t - 50];
  const shaken = s.director.judge();
  check(cruising > 0 && struggling < 0 && shaken < 0, 'the director: more pressure when cruising, a breather when power runs short or after close calls', `+${cruising} / ${struggling} / ${shaken}`);
  const t0 = night(0, 5);
  t0.t = 900;
  t0.power = 99000;
  check(t0.director.judge() === 0 && night(6, 5).director.judge() === 0, 'the director leaves the training night and the Final Act alone');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall AI checks passed');
process.exit(failed ? 1 : 0);
