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
const { remember, beliefsFor, cleanMemory, memoryHints } = await core('core/ai/memory.js');
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
  for (const n of [1, 3, 4, 5, 7, 8]) if (hash(n, 4242 + n) !== hash(n, 4242 + n)) same = false;
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


// ======================================================================== the advanced cast
// Memory across nights, the signature tricks, the group tactics and the signs of life. Every
// trick: its tell comes before its effect, its counter works, and it never kills by itself.
const OTHER = { L: 'R', R: 'L' };
/** A guard who knows where everybody is and shuts whatever somebody stands at (never the cameras). */
const doorman = (s) => {
  const c = s.chars;
  const at = { L: false, R: false };
  for (const x of Object.values(c)) {
    if (x.inside) continue;
    const n = NODES[x.node ?? x.walk?.to];
    if (n?.door) at[n.door] = true;
    if (x.id === 'cat' && x.state === 'run') at[x.side] = true;
  }
  if (c.rustgrin.node === 'NOOK' || c.rustgrin.walk?.to === 'NOOK') at.R = true;
  for (const side of ['L', 'R']) if (at[side] !== s.doorClosed(side)) s.input(side === 'L' ? 'door_l' : 'door_r');
  for (const v of ['L', 'R']) {
    const need = c.purple_rat.side === v && (c.purple_rat.state === 'vent' || !!NODES[c.purple_rat.walk?.to]?.vent);
    if (need !== s.ventClosed(v)) s.input(v === 'L' ? 'vent_l' : 'vent_r');
  }
};
/** Hash of a night's effects (optionally without the cosmetic 'idle' ones). */
const fxHash = (h, e) => {
  const j = JSON.stringify(e);
  for (let i = 0; i < j.length; i++) h = (Math.imul(h, 31) + j.charCodeAt(i)) | 0;
  return h;
};

// ------------------------------------------------------------------------ 14. memory: carried over, decaying, capped, fair
{
  // night 2, played by a guard who checks the left hall like clockwork and never the right one
  const lopsided = (seed, side = 'L') => {
    const s = night(2, seed, { ticksPerHour: 1000 });
    const light = side === 'L' ? 'light_l' : 'light_r';
    const lit = () => (side === 'L' ? s.devices.lightL : s.devices.lightR);
    run(s, {
      guard: (s) => {
        doorman(s);
        if (s.t % 120 === 0 && !lit()) s.input(light);
        if (s.t % 120 === 10 && lit()) s.input(light);
        if (s.t % 400 === 50) s.input('cams_open', '8');
        if (s.t % 400 === 60) s.input('wind');
        if (s.t % 400 === 70) s.input('cams_close');
      },
    });
    return s;
  };
  const n2 = lopsided(31);
  const sum = n2.summary();
  const mem = remember(null, sum);
  const b3 = beliefsFor(mem, 3);
  check(n2.result === 'win' && sum.light.L > 5 && sum.light.R === 0 && b3?.soft === 'R' && b3.softBy > 0.9 && b3.conf === 1, 'memory: a night of checking only the left hall is remembered: the right hall is the soft side', `light checks per hour L ${sum.light.L} R ${sum.light.R}; ${JSON.stringify(mem).length} bytes in the save`);
  check(memoryHints(mem, 3)[0] === 'soft.R', 'the Ringmaster can hint at it in the next call', memoryHints(mem, 3).join(', '));

  // night 3 opens with them probing that side: Noxbriar is at her window sooner, Mirehop no sooner
  const firstVisit = (memory) => {
    let nox = 0;
    let mire = 0;
    let noxFirst = 0;
    const N = RUNS;
    for (let i = 0; i < N; i++) {
      const s = night(3, 4100 + i, { ai: ONLY({ mirehop: 6, noxbriar: 6 }), memory, mods: { infinitePower: true } });
      const at = {};
      run(s, {
        ticks: s.ticksPerHour * 3,
        guard: doorman,
        onFx: (e, s) => { if (e.fx === 'at_door' && at[e.who] === undefined) at[e.who] = s.t; },
      });
      const end = s.ticksPerHour * 3;
      nox += at.noxbriar ?? end;
      mire += at.mirehop ?? end;
      if ((at.noxbriar ?? end) < (at.mirehop ?? end)) noxFirst++;
    }
    return { nox: Math.round(nox / N), mire: Math.round(mire / N), noxFirst };
  };
  const withMem = firstVisit(mem);
  const blank = firstVisit(null);
  check(withMem.nox < blank.nox * 0.8 && withMem.noxFirst >= RUNS * 0.8 && withMem.noxFirst > blank.noxFirst && withMem.mire >= blank.mire * 0.9, 'night 3 opens with them probing the hall neglected on night 2 (the other one comes no sooner)', `Noxbriar's first visit at tick ${withMem.nox} vs ${blank.nox} blank, first of the two in ${withMem.noxFirst} vs ${blank.noxFirst} of ${RUNS} nights; Mirehop ${withMem.mire} vs ${blank.mire}`);

  // decay: within the night (by 3 AM only tonight counts), and from night to night
  const s3 = night(3, 9, { memory: mem });
  const t0 = s3.trust();
  s3.t = s3.ticksPerHour * 1.5;
  const tMid = s3.trust();
  s3.t = s3.ticksPerHour * 3;
  // (how lopsided they remember the guard's light checks: 1 = one hall only, 0 = both alike)
  const tilt = (m) => (m.light.L - m.light.R) / Math.max(m.light.L, m.light.R);
  const even = { ...sum, light: { L: sum.light.L, R: sum.light.L } };
  const m1 = remember(mem, even);
  const m3 = remember(remember(m1, even), even);
  check(t0 === 1 && tMid === 0.5 && s3.trust() === 0 && s3.chars.noxbriar.huntChance() === night(3, 9).chars.noxbriar.huntChance(), 'the memory fades during the night: by 3 AM they go only by what they see tonight', `trust ${t0} at 12 AM, ${tMid} at 1:30, ${s3.trust()} at 3 AM`);
  check(tilt(mem) === 1 && tilt(m1) < 0.4 && tilt(m3) < 0.1 && !beliefsFor(m1, 4)?.soft && m3.nights <= 2, 'and from night to night: each new night counts as much as everything before it together', `the remembered lean ${tilt(mem)} -> ${tilt(m1).toFixed(2)} after one even night -> ${tilt(m3).toFixed(2)} after three`);
  // a night cut short tells them little
  const short = { ...sum, hours: 0.3, light: { L: 0, R: sum.light.L } };
  const ms = remember(mem, short);
  check(beliefsFor(ms, 3)?.soft === 'R' && tilt(ms) > 0.6, 'a night cut short after a few minutes hardly changes what they know', `lean ${tilt(ms).toFixed(2)} after 20 minutes of the opposite habit`);

  // the monitor: a guard who lived on the cameras, and one who hardly touched them
  {
    const watcher = remember(null, { ...even, cams: 0.8 });
    const shy = remember(null, { ...even, cams: 0.05 });
    const wait = (memory) => {
      const s = night(4, 6450, { ai: ONLY({ rustgrin: 10 }), memory, mods: { infinitePower: true, noRusted: true } });
      const r = s.chars.rustgrin;
      r.placeAt('NOOK', 'stand');
      let at = -1;
      run(s, { ticks: 1500, guard: (s) => { if (!s.devices.doorR) s.input('door_r'); }, each: (s) => { if (at < 0 && r.patientUntil > 0) at = r.patientUntil - s.t; } });
      return at;
    };
    const firstPull = (memory) => {
      const s = night(3, 6400, { ai: ONLY({ cat: 8 }), memory, mods: { infinitePower: true, noRusted: true } });
      let at = -1;
      run(s, { ticks: 2000, onFx: (e, s) => { if (at < 0 && e.fx === 'cue' && e.kind === 'pull') at = s.t; } });
      return at;
    };
    const w = [wait(watcher), wait(null)];
    const p = [firstPull(shy), firstPull(null)];
    check(beliefsFor(watcher, 4).monitor === 'watcher' && beliefsFor(shy, 3).monitor === 'shy' && memoryHints(shy, 3).includes('shy') && w[0] > 0 && w[0] < w[1] && p[0] > 0 && p[0] < p[1],
      'the monitor is remembered too: Rustgrin waits less for a guard who lived on the cameras, the Cat is at the tape deck sooner for one who ignored them', `turned away, he waits ${w[0]} ticks instead of ${w[1]}; her first pull at tick ${p[0]} instead of ${p[1]}`);
  }

  // caps: whatever is in the save, it comes out clamped and small
  const junk = cleanMemory({ v: 1, nights: 99, door: { L: 7, R: -3 }, vent: 'x', light: { L: 1e9, R: NaN }, cams: 'lots', death: { who: 'mirehop', way: 'roof', night: 1e6 }, deaths: 50, extra: 'x'.repeat(5000) });
  let grown = null;
  for (let i = 0; i < 40; i++) grown = remember(grown, { ...sum, night: 2 + (i % 4), died: i % 3 === 0 ? 'mirehop' : null, way: 'L', light: { L: 1e9, R: 1e9 }, door: { L: 5, R: 5 } });
  const M = CONFIG.memory;
  const ok = (m) => m.nights <= M.maxNights && m.door.L <= 1 && m.door.R >= 0 && m.light.L <= M.maxChecks && m.cams <= 1 && m.deaths <= M.maxDeaths && JSON.stringify(m).length < 300 && Object.keys(m).length === 8;
  check(ok(junk) && junk.death.way === null && ok(grown) && cleanMemory({ v: 99, nights: 1 }) === null && cleanMemory('x') === null, 'the memory is bounded: every number clamped, unknown fields dropped, never more than a few hundred bytes', `${JSON.stringify(grown).length} bytes after 40 nights`);

  // blank: a fresh save, night 1, and every night outside the week
  const sBlank = night(7, 5, { memory: mem });
  check(beliefsFor(null, 3) === null && beliefsFor(mem, 1) === null && [0, 6, 7, 8].every((n) => beliefsFor(mem, n) === null) && sBlank.beliefs === null && sBlank.trust() === 0 && remember(mem, { ...sum, night: 7 }) !== null && JSON.stringify(remember(mem, { ...sum, night: 7 })) === JSON.stringify(cleanMemory(mem)),
    'a fresh save and night 1 start blank; the Final Act, the Custom Night and the Encore neither read nor write the memory');

  // a death: the killer comes back first and by the same way, and says so; nothing gets harder
  const died = remember(null, { ...even, night: 3, died: 'mirehop', way: 'L' });
  const bd = beliefsFor(died, 3);
  let told = 0;
  let first = 0;
  const N = RUNS;
  for (let i = 0; i < N; i++) {
    const s = night(3, 4300 + i, { memory: died, mods: { infinitePower: true } });
    let grudgeAt = -1;
    let who = null;
    run(s, {
      ticks: s.ticksPerHour * 3,
      guard: doorman,
      onFx: (e, s) => {
        if (e.fx === 'cue' && e.kind === 'grudge' && e.who === 'mirehop' && e.way === 'L' && grudgeAt < 0) grudgeAt = s.t;
        if (e.fx === 'at_door' && !who) {
          who = e.who;
          if (e.who === 'mirehop' && e.side === 'L') first++;
          if (grudgeAt >= 0 && s.t - grudgeAt >= 100) told++;
        }
      },
    });
  }
  const sd = night(4, 5, { memory: remember(died, { ...sum, night: 4, died: 'noxbriar', way: 'R' }) });
  sd.t = Math.round(sd.ticksPerHour * 3);
  sd.power = 80000;
  const eased = sd.director.judge();
  const fresh = night(4, 5);
  fresh.t = sd.t;
  fresh.power = 80000;
  check(bd.encore?.who === 'mirehop' && !bd.soft && bd.ease === 1 && first >= N * 0.75 && told >= first * 0.95, 'after a death the killer comes back first, by the same way, and its grudge is heard well before it arrives', `Mirehop first at the left door in ${first}/${N} nights, announced ${told} times`);
  check(eased < fresh.director.judge() && eased <= 0 && beliefsFor(remember(died, sum), 3)?.encore === null && remember(died, sum).deaths === 0, 'a death never raises the pressure: the director eases off a step per death in a row, and a night survived wipes the grudge', `cruising guard: +${fresh.director.judge()} fresh, ${eased} after two deaths`);

  // two of them inside at once: the catch is remembered by the killer's own way in
  {
    const s = night(3, 4400);
    s.breach('L', 'mirehop');
    s.breach('R', 'noxbriar', false, 'decoy');
    s.kill('mirehop');
    const one = s.summary();
    const p = night(3, 4401);
    p.power = 1;
    run(p, { ticks: 3000 });
    check(one.died === 'mirehop' && one.way === 'L' && s.killNote === null && p.result === 'lose' && p.summary().way === 'power' && beliefsFor(remember(null, p.summary()), 3).encore === null && memoryHints(remember(null, p.summary()), 3)[0] === 'power',
      'the catch is remembered by the killer\'s own way in (others may be inside too); a blackout is remembered as one, with no grudge', `${one.died} by ${one.way}; ${p.summary().died} by ${p.summary().way}`);
  }

  // losing does not snowball: the medium bot's retries (with the memory of its deaths) against the same nights blank
  let withM = 0;
  let without = 0;
  let tries = 0;
  for (const n of [3, 4, 5]) {
    for (let i = 0; i < RUNS; i++) {
      const lost = botNight(n, 4500 + i * 11 + n, 'medium');
      if (lost.result !== 'lose') continue;
      const m = remember(mem, lost.summary());
      tries++;
      if (botNight(n, 4700 + i * 11 + n, 'medium', { opts: { memory: m } }).result !== 'lose') withM++;
      if (botNight(n, 4700 + i * 11 + n, 'medium').result !== 'lose') without++;
    }
  }
  check(tries > 15 && withM >= without - tries * 0.1, 'losing does not snowball: a retry with the memory of the death is no harder than the same night played blank', `${withM} vs ${without} of ${tries} retries won (medium bot, nights 3-5)`);

  // the same night whether the memory is given at the start or recalled on the first tick (the game layer does that)
  const h = (late) => {
    const s = night(4, 77, late ? {} : { memory: died });
    const bot = new Bot(s, 'good', 99);
    let x = 0;
    let recalled = !late;
    run(s, {
      onFx: (e) => {
        if (!recalled && e.fx === 'start') { s.recall(died); recalled = true; }
        bot.hear(e);
        x = fxHash(x, e);
      },
      guard: () => bot.tick(),
    });
    return x;
  };
  check(h(false) === h(true), 'deterministic: recalling the memory on the first tick gives the same night as starting with it');
}

// ------------------------------------------------------------------------ 15. Rustgrin: the burnt feed
{
  const stare = (heed, noBurn = false) => {
    const out = { squeals: 0, burns: 0, early: 0, dead: 0, movedDead: 0, nook: 0 };
    for (let i = 0; i < RUNS / 2; i++) {
      const s = night(4, 5100 + i, { ai: ONLY({ rustgrin: 12 }), ticksPerHour: 1500, mods: { infinitePower: true, noRusted: true } });
      if (noBurn) s.chars.rustgrin.tickGlare = () => {};
      let squealAt = -1;
      let away = 0;
      let burnt = null;
      run(s, {
        guard: (s) => {
          const r = s.chars.rustgrin;
          if (r.node === 'NOOK' && !s.devices.doorR) s.input('door_r');
          if (s.t < away) { if (s.devices.cams.open) s.input('cams_close'); return; }
          const cam = r.node && CAMS_FOR_NODE[r.node]?.find((c) => s.camWorking(c) || r.burnt(c));
          if (!cam) return;
          if (!s.devices.cams.open) s.input('cams_open', cam);
          else if (s.devices.cams.cam !== cam) s.input('cam_select', cam);
        },
        onFx: (e, s) => {
          if (e.fx === 'cue' && e.kind === 'squeal') {
            out.squeals++;
            squealAt = s.t;
            if (heed) away = s.t + 12 + 60; // looks away half a second later, for three seconds
          }
          if (e.fx === 'cue' && e.kind === 'burn') {
            out.burns++;
            if (squealAt < 0 || s.t - squealAt < CONFIG.characters.rustgrin.burn.warn) out.early++;
            if (!s.camWorking(e.cam) && s.chars.rustgrin.burnt(e.cam)) out.dead++;
            burnt = { cam: e.cam, until: s.t + e.ticks };
            squealAt = -1;
          }
          if (e.fx === 'move' && e.who === 'rustgrin' && burnt && s.t < burnt.until && CAMS_FOR_NODE[e.fromNode]?.includes(burnt.cam)) out.movedDead++;
          if (e.fx === 'at_nook') out.nook++;
        },
      });
    }
    return out;
  };
  const a = stare(false);
  const b = stare(true);
  const held = stare(false, true);
  check(a.squeals > RUNS / 2 && a.burns > RUNS / 2 && a.early === 0 && a.dead === a.burns, 'Rustgrin, stared at too long: his microphone squeals through the monitor, and only if the guard keeps watching does that camera burn out', `${a.squeals} squeals, ${a.burns} burnt feeds, none sooner than ${CONFIG.characters.rustgrin.burn.warn} ticks after the squeal`);
  check(a.movedDead > 0 && a.nook > held.nook * 1.5, 'a dead feed does not hold him: he walks on under it (staring him down all night no longer works)', `${a.movedDead} moves under a burnt feed; ${a.nook} visits to the nook vs ${held.nook} if he could not burn a feed`);
  check(b.squeals > 0 && b.burns === 0, 'the counter: look away when the feed squeals and nothing burns', `${b.squeals} squeals, ${b.burns} burnt feeds`);
  // never while the guard needs the cameras for the spotlight
  const s = night(7, 5300, { ai: ONLY({ rustgrin: 12, top_hat_rat: 20 }), ticksPerHour: 1500, mods: { infinitePower: true } });
  let unfair = 0;
  run(s, {
    ticks: 6000,
    guard: (s) => {
      const r = s.chars.rustgrin;
      if (r.node === 'NOOK' && !s.devices.doorR) s.input('door_r');
      const cam = r.node && CAMS_FOR_NODE[r.node]?.[0];
      if (cam && !s.devices.cams.open) s.input('cams_open', cam);
      else if (cam && s.devices.cams.cam !== cam) s.input('cam_select', cam);
      const rm = s.chars.top_hat_rat;
      if (rm.out && rm.idx >= 3 && !rm.walk) { rm.idx = 0; rm.state = 'home'; rm.placeAt('CAB', 'stand'); rm.pauseUntil = s.t + 400; }
    },
    onFx: (e, s) => { if (e.fx === 'cue' && e.kind === 'squeal' && s.chars.top_hat_rat.out) unfair++; },
  });
  check(unfair === 0, 'he never burns a feed while the Ringmaster is out and the guard needs the cameras for the SPOTLIGHT');
}

// ------------------------------------------------------------------------ 16. the baits: Mirehop's knock, Noxbriar's thrown voice
{
  // a guard who stays off the cameras and checks one hall every 15 seconds: plenty of lulls at the corner.
  // `wise`: after a bait, looks at the right hall and looks again a moment later.
  // `deaf`: bites, and then never shuts the door at all (how soon can a bait kill?)
  const trial = (who, wise, deaf = false) => {
    const cfg = CONFIG.characters[who];
    const side = cfg.side;
    const kind = cfg.bait.kind;
    const out = { baits: 0, bitten: 0, stepped: 0, soonest: 1e9, caught: 0, deaths: 0, entries: 0, early: 0, kill: 1e9 };
    for (let i = 0; i < RUNS; i++) {
      const s = night(4, 5500 + i, { ai: ONLY({ [who]: 14 }), ticksPerHour: 1500, mods: { infinitePower: true } });
      const light = (sd) => (sd === 'L' ? 'light_l' : 'light_r');
      const lit = (sd) => (sd === 'L' ? s.devices.lightL : s.devices.lightR);
      const door = side === 'L' ? 'door_l' : 'door_r';
      const looks = []; // [on, off, hall]
      let bait = null; // { at, off }
      let arrived = -1;
      let twang = -1;
      const c = s.chars[who];
      run(s, {
        guard: (s) => {
          const ph = s.t % 300;
          if (ph === 0) looks.push([s.t, s.t + 12, side]);
          for (const l of looks) {
            if (s.t === l[0] && !lit(l[2])) s.input(light(l[2]));
            // the second look after a bait: there they are, in the light
            if (l[3] && bait && !bait.caught && s.t > l[0] && s.t <= l[1] && lit(side) && c.node === c.door && c.state === 'door') { bait.caught = true; out.caught++; }
            if (s.t === l[1]) {
              if (!deaf && l[2] === side && c.node === c.door && !s.doorClosed(side)) s.input(door);
              if (lit(l[2])) s.input(light(l[2]));
            }
          }
          if (deaf) return;
          // hears the twang / the hum at the door a second and a half later (every guard does)
          if (twang >= 0 && s.t >= twang + 30 && c.node === c.door && !s.doorClosed(side)) s.input(door);
          if (s.doorClosed(side) && c.node !== c.door && !c.walk && c.state !== 'linger' && s.t % 20 === 0) s.input(door);
        },
        onFx: (e, s) => {
          if (e.fx === 'cue' && e.kind === kind) {
            out.baits++;
            bait = { at: s.t, off: -1 };
            const heard = e.side; // where the guard hears it
            if (wise) {
              // the hall the bait does NOT point at (her side), or the same hall again (his knock): twice
              looks.push([s.t + 20, s.t + 30, side], [s.t + 75, s.t + 110, side, true]);
            } else looks.push([s.t + 20, s.t + 32, heard]);
            if (!wise) bait.off = kind === 'knock' ? s.t + 32 : s.t + 20;
          }
          if (e.fx === 'move' && e.who === who && e.toNode === c.door && bait) {
            if (!wise && bait.off >= 0 && s.t >= bait.off && s.t - bait.off <= 12) { out.bitten++; out.stepped++; } else if (!wise && bait.off >= 0 && s.t < bait.at + cfg.bait.window) out.bitten++;
          }
          if (e.fx === 'at_door' && e.who === who) {
            arrived = s.t;
            twang = s.t;
            if (bait) out.soonest = Math.min(out.soonest, s.t - bait.at);
          }
          if (e.fx === 'sound' && e.id === 'fnar.servo.move' && e.at === who) {
            out.entries++;
            if (s.t - arrived < cfg.entryGrace) out.early++;
          }
          if (e.fx === 'left_door' && e.who === who) { bait = null; twang = -1; }
          if (e.fx === 'breach' && bait) out.kill = Math.min(out.kill, s.t - bait.at);
          if (e.fx === 'jumpscare') out.deaths++;
        },
      });
    }
    return out;
  };
  for (const who of ['mirehop', 'noxbriar']) {
    const name = who === 'mirehop' ? "Mirehop's knock" : "Noxbriar's thrown voice";
    const bite = trial(who, false);
    const wise = trial(who, true);
    const deaf = trial(who, false, true);
    const need = CONFIG.characters[who].entryGrace + CONFIG.characters[who].enterDelay;
    check(bite.baits > RUNS && bite.stepped >= bite.baits * 0.6, `${name}: with no good moment in sight, the bait; when the guard bites, the step into the doorway follows at once`, `${bite.baits} baits, ${bite.stepped} step-ins right as the guard looked ${who === 'mirehop' ? 'away again' : 'the wrong way'}`);
    check(deaf.early === 0 && deaf.entries > 0 && deaf.kill >= need + 20, 'the bait is a tell, not a kill: the arrival tell and the full grace still come before any entry', `a guard who bites and then does nothing at all: caught ${deaf.kill} ticks after the bait at the soonest (${deaf.entries} entries, none before the grace)`);
    check(wise.deaths === 0 && bite.deaths === 0 && wise.caught >= wise.baits * 0.6, `the counter: ${who === 'mirehop' ? 'look again a moment later' : 'check HER hall, twice'} - the second look finds them standing in the doorway`, `caught in the light after ${wise.caught} of ${wise.baits} baits; no deaths in ${RUNS * 2} nights`);
  }
}

// ------------------------------------------------------------------------ 17. the Purple Rat plays dead
{
  // `glances`: a look at the duct camera of two seconds every eight (too short to make him squeak);
  // otherwise the camera stays on him all night
  const trial = (glances) => {
    const out = { dead: 0, bursts: 0, two: 0, squeaks: 0, fast: 0, soonest: 1e9, deaths: 0 };
    for (let i = 0; i < RUNS / 2; i++) {
      const s = night(4, 5900 + i, { ai: ONLY({ purple_rat: 9 }), ticksPerHour: 3000, mods: { infinitePower: true } });
      let away = 0;
      let burstAt = -1;
      let from = -1;
      s.mods.noRusted = true;
      run(s, {
        guard: (s) => {
          const r = s.chars.purple_rat;
          const cam = r.side === 'L' ? '9' : '10';
          if (s.t % 300 === 0) { s.tape.level = 100000; s.tape.update(); } // (the show tape kept wound: he is as bold as his level says)
          away = glances && s.t % 160 >= 40 ? s.t + 1 : 0;
          if (s.t < away) { if (s.devices.cams.open) s.input('cams_close'); } else if (!s.devices.cams.open) s.input('cams_open', cam);
          else if (s.devices.cams.cam !== cam) s.input('cam_select', cam);
          // (the vents stay open unless he is right there: the bolt must leave time to seal one)
          for (const v of ['L', 'R']) {
            const need = r.side === v && r.state === 'vent' && s.t >= r.graceUntil - 20;
            if (need !== s.ventClosed(v)) s.input(v === 'L' ? 'vent_l' : 'vent_r');
          }
        },
        each: (s) => { from = s.chars.purple_rat.idx; },
        onFx: (e, s) => {
          if (e.fx === 'cue' && e.kind === 'playdead') out.dead++;
          if (e.fx === 'cue' && e.kind === 'nervous') out.squeaks++;
          if (e.fx === 'cue' && e.kind === 'burst') {
            out.bursts++;
            burstAt = s.t;
            if (s.chars.purple_rat.idx - from === 2) out.two++;
          }
          if (e.fx === 'breach' && burstAt >= 0) out.soonest = Math.min(out.soonest, s.t - burstAt);
          if (e.fx === 'vent_bang' && burstAt >= 0) { out.soonest = Math.min(out.soonest, s.t - burstAt); burstAt = -1; }
          if (e.fx === 'move' && e.who === 'purple_rat' && burstAt !== s.t) burstAt = -1;
          if (e.fx === 'jumpscare') out.deaths++;
        },
      });
    }
    return out;
  };
  const glance = trial(true);
  const starer = trial(false);
  check(glance.dead > RUNS / 2 && glance.bursts >= glance.dead * 0.9 && glance.two > glance.bursts / 4, 'the Purple Rat plays dead under the duct camera (the maracas stop), and bolts when the guard looks away: a glance makes him faster', `${glance.dead} times frozen by a two-second glance, ${glance.bursts} bolts, ${glance.two} of them two sections`);
  check(starer.bursts === 0 && starer.squeaks > starer.dead * 0.8, 'the counter: keep the camera on him - he squeaks and backs off, and never bolts', `${starer.dead} times frozen, ${starer.squeaks} squeaks, ${starer.bursts} bolts`);
  check(glance.soonest >= 100 && glance.deaths === 0 && starer.deaths === 0, 'a bolt obeys every rule: at the vent, the maracas and the grace still come first', `soonest bang on a sealed vent ${glance.soonest} ticks after a bolt`);
}

// ------------------------------------------------------------------------ 18. the Cat at the tape deck
{
  const P = CONFIG.characters.cat.pull;
  const trial = (kind) => {
    const out = { pulls: 0, early: 0, hidden: 0, rate: [], base: [], back: 0, slow: 0, deaths: 0 };
    for (let i = 0; i < RUNS / 2; i++) {
      const s = night(3, 6300 + i, { ai: ONLY({ cat: 10 }), ticksPerHour: 1500, mods: { infinitePower: true, noRusted: true } });
      let seen = 0;
      let pullAt = -1;
      let goAt = -1;
      let lvl = s.tape.level;
      run(s, {
        ticks: 7000,
        guard: (s) => {
          doorman(s);
          if (kind === 'watchful' && s.t % 200 === 0) { s.input('cams_open', '8'); seen = s.t; }
          if (kind === 'watchful' && s.t % 200 === 10) { if (s.tape.level < 60000) s.input('wind'); }
          if (kind === 'watchful' && s.t % 200 === 20) s.input('cams_close');
          if (kind === 'answers' && s.t === goAt) { s.input('cams_open', '8'); s.input('cam_select', '8'); }
          if (kind === 'answers' && s.t === goAt + 8) s.input('wind');
          if (kind === 'answers' && s.t === goAt + 20) s.input('cams_close');
          // (nobody lets the tape run out: a rewind when it gets low, without a look at the ring)
          if (kind !== 'watchful' && s.tape.level < 45000 && s.t % 400 === 0) { s.tape.level = 100000; s.tape.update(); }
        },
        each: (s) => {
          const d = lvl - s.tape.level;
          if (d > 0) (s.chars.cat.pulling ? out.rate : out.base).push(d);
          lvl = s.tape.level;
        },
        onFx: (e, s) => {
          if (e.fx === 'cue' && e.kind === 'pull' && !e.again) {
            out.pulls++;
            pullAt = s.t;
            goAt = s.t + 30;
            if (s.t - seen < P.ignored(s.chars.cat.ai)) out.early++;
          }
          if (e.fx === 'hide' && e.who === 'cat' && s.chars.cat.pulling) out.hidden++;
          if (e.fx === 'cue' && e.kind === 'pull_end') {
            if (e.rewound && s.chars.cat.node === 'MW_T' && s.chars.cat.stage === 0) out.back++;
            if (s.t - pullAt > 60) out.slow++;
          }
          if (e.fx === 'jumpscare') out.deaths++;
        },
      });
    }
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return { ...out, ratio: avg(out.rate) / Math.max(1, avg(out.base)) };
  };
  const ignored = trial('ignores');
  const answers = trial('answers');
  const watchful = trial('watchful');
  check(ignored.pulls > RUNS / 2 && ignored.early === 0 && ignored.hidden === ignored.pulls && ignored.ratio > 2 && ignored.ratio < 2.4, 'the Cat, ignored on CAM 8, slips behind the curtain and pulls the tape: the music warbles, the ring is empty, the tape runs down twice as fast', `${ignored.pulls} pulls, tape drain x${ignored.ratio.toFixed(2)} while she is at it`);
  check(answers.pulls > 0 && answers.back === answers.pulls && answers.slow === 0, 'the counter: PLAY SHOW on CAM 8 puts her back on the ring at once', `${answers.back}/${answers.pulls}`);
  check(watchful.pulls === 0 && ignored.deaths + answers.deaths + watchful.deaths === 0, 'a guard who glances at CAM 8 now and then never hears it');
}

// ------------------------------------------------------------------------ 19. the Ringmaster's "places!"
{
  const P = CONFIG.characters.top_hat_rat.places;
  const T = CONFIG.director.tactics;
  const trial = (watch) => {
    const out = { calls: 0, onStage: 0, goes: 0, held: 0, left: 0, leftWatched: 0, close: 0, nights: 0, hours: [] };
    for (const n of [3, 4]) {
      for (let i = 0; i < RUNS / 4; i++) {
        const s = night(n, 6700 + i * 3 + n, { mods: { infinitePower: true } });
        out.nights++;
        let pl = null; // { who, at, goAt }
        const arrive = {};
        run(s, {
          guard: (s) => {
            doorman(s);
            if (watch && pl && !pl.done) {
              if (!s.devices.cams.open) s.input('cams_open', '1A');
              else if (s.devices.cams.cam !== '1A') s.input('cam_select', '1A');
              if (pl.goAt && s.t > pl.goAt + CONFIG.brain.freezeMax + 5) { pl.done = true; s.input('cams_close'); }
            } else if (s.tape.enabled && s.t % 300 === 0) { s.tape.level = 100000; s.tape.update(); }
          },
          onFx: (e, s) => {
            if (e.fx === 'cue' && e.kind === 'places') {
              out.calls++;
              out.hours.push(s.t / s.ticksPerHour);
              pl = { who: e.who, at: s.t, goAt: 0 };
              if (e.who.every((id) => s.chars[id].node === s.chars[id].cfg.start)) out.onStage++;
            }
            if (e.fx === 'cue' && e.kind === 'places_go') {
              out.goes++;
              pl.goAt = s.t;
              if (s.t - pl.at === P.hold) out.held++;
            }
            if (pl?.goAt && e.fx === 'move' && pl.who.includes(e.who) && e.fromNode === s.chars[e.who].cfg.start && !pl[e.who]) {
              pl[e.who] = true;
              if (s.t - pl.goAt <= 20) out.left++;
              if (s.t - pl.goAt <= CONFIG.brain.freezeMax && s.isWatchingNode(e.fromNode)) out.leftWatched++;
            }
            if (pl?.goAt && s.t < pl.goAt + P.eager && (e.fx === 'at_door' || e.fx === 'at_nook') && pl.who.includes(e.who)) {
              const other = pl.who.find((id) => id !== e.who);
              if (arrive[other] !== undefined && s.t - arrive[other] < T.duoGap - 40) out.close++;
              arrive[e.who] = s.t;
            }
          },
        });
      }
    }
    return out;
  };
  const free = trial(false);
  const watched = trial(true);
  check(free.calls > free.nights * 0.7 && free.calls <= free.nights && free.onStage === free.calls && free.held === free.goes && Math.min(...free.hours) >= P.hours[0], 'from his booth the Ringmaster calls "places!" once a night: two of the band are back on the stage (a breather), and he holds them there', `${free.calls} calls in ${free.nights} nights, between ${Math.min(...free.hours).toFixed(1)} and ${Math.max(...free.hours).toFixed(1)} AM`);
  check(free.left >= free.goes * 1.6 && free.close === 0, 'then he sends them out together - and the two never reach the office at the same moment', `${free.left} of ${free.goes * 2} stepped off the stage within a second; arrivals always ${T.duoGap - 40}+ ticks apart`);
  check(watched.goes > 0 && watched.leftWatched === 0 && watched.left < free.left * 0.5, 'the counter: keep CAM 1A on the stage and the cue is wasted - nobody steps off while watched', `${watched.left} of ${watched.goes * 2} got away on cue`);
}

// ------------------------------------------------------------------------ 20. group tactics: the racket in the kitchen, trading places
{
  let clatters = 0;
  let loud = 0;
  let own = 0;
  let stepped = 0;
  let early = 0;
  let trades = 0;
  let tradedVisits = 0;
  let wrongSide = 0;
  let home = 0;
  let nights = 0;
  let wins = 0;
  let tradeN4 = 0;
  const { heardOnly } = await core('core/ai/graph.js');
  for (const n of [4, 5, 8]) {
    for (let i = 0; i < RUNS / 2; i++) {
      nights++;
      let clat = null;
      let traded = false;
      const s = botNight(n, 7100 + i * 7 + n, 'good', {
        onFx: (e, s) => {
          if (e.fx === 'cue' && e.kind === 'clatter') {
            clatters++;
            // the one making the noise stands in a room the guard can only listen to, and covers somebody else
            if (!heardOnly(e.node) || s.chars[e.who].node !== e.node) early++;
            if (s.director.clatterFor === e.who || !s.director.covered(s.chars[s.director.clatterFor])) own++;
            clat = { who: e.who, cover: s.director.clatterFor, until: s.t + CONFIG.director.tactics.clatter.window };
          }
          if (clat && s.t <= clat.until) {
            if (e.fx === 'sound' && e.approach && e.at === clat.cover) loud++; // its way down the hall drowns in the noise
            if (e.fx === 'move' && NODES[e.toNode]?.door) {
              if (e.who === clat.who) own++;
              else if (e.who === clat.cover) { stepped++; clat = null; }
            }
          }
          if (e.fx === 'cue' && e.kind === 'trade') {
            trades++;
            traded = true;
            if (n === 4) tradeN4++;
            if (!e.who.every((id) => s.chars[id].traded && s.chars[id].side !== s.chars[id].home)) wrongSide++;
          }
          if (e.fx === 'at_door') {
            const c = s.chars[e.who];
            if (e.side !== c.side || NODES[c.node]?.door !== e.side) wrongSide++;
            if (c.traded) tradedVisits++;
          }
          if (e.fx === 'sound' && e.door && s.chars[e.at]?.side !== e.door) wrongSide++;
          if (e.fx === 'left_door' && !e.linger && traded && s.chars[e.who].traded) home++; // (it is back to its own hall right after this effect)
        },
      });
      if (s.result !== 'lose') wins++;
      for (const id of ['mirehop', 'noxbriar']) if (s.result === 'win' && s.chars[id].traded && s.chars[id].state === 'roam' && s.t > s.chars[id].tradeUntil + 200) wrongSide++;
    }
  }
  check(clatters > nights / 3 && early === 0 && own === 0 && loud === 0 && stepped >= clatters * 0.5, 'the racket: pots crash in the kitchen to cover somebody else on its way to a door - the one making the noise is never the one coming', `${clatters} rackets in ${nights} nights; under ${stepped} of them the covered one stepped up to its door, its footsteps drowned`);
  check(trades > RUNS / 4 && tradeN4 === 0 && tradedVisits > 0 && wrongSide === 0, 'trading places (late nights only): Mirehop and Noxbriar swap halls for one trip, and every tell carries the side it really comes from', `${trades} trades, ${tradedVisits} visits to the other hall's door`);
  check(wins >= nights - 1, 'and the good bot, who trusts the side it hears, still survives them', `${wins}/${nights} nights`);
}

// ------------------------------------------------------------------------ 21. signs of life
{
  let fx = 0;
  let ticks = 0;
  let bad = 0;
  const kinds = new Set();
  let same = true;
  for (const n of [1, 3, 5]) {
    const hash = (life) => {
      let h = 0;
      const s = night(n, 7700 + n);
      s.life.enabled = life;
      const bot = new Bot(s, 'good', 7);
      run(s, {
        onFx: (e, s) => {
          bot.hear(e);
          if (e.fx !== 'idle') { h = fxHash(h, e); return; }
          fx++;
          kinds.add(e.kind);
          const c = s.chars[e.who];
          if (c.walk || c.node !== e.node || NODES[e.node].door || NODES[e.node].vent || c.inside || e.who === 'top_hat_rat') bad++;
          if (e.kind === 'shuffle' && (s.isWatchingNode(e.node) || e.path.length !== 3)) bad++;
        },
        guard: () => bot.tick(),
      });
      if (life) ticks += s.t;
      return h;
    };
    if (hash(true) !== hash(false)) same = false;
  }
  check(kinds.size === 3 && bad === 0 && fx < ticks / CONFIG.idle.every[0] && fx > ticks / 600, 'signs of life: head tilts, poses and shuffles for whoever stands about (never at a door, never while walking, shuffles only unwatched), a few a minute', `${fx} effects in ${ticks} ticks: ${[...kinds].join(', ')}`);
  check(same, 'they are cosmetic: the night is the same night, effect for effect, with or without them');
  const fin = night(6, 3);
  let finIdle = 0;
  run(fin, { ticks: 3000, onFx: (e) => { if (e.fx === 'idle') finIdle++; }, guard: (s) => { for (const k of ['door_l', 'door_r', 'vent_l', 'vent_r']) if (!s.devices[k.replace('_l', 'L').replace('_r', 'R')]) s.input(k); } });
  check(finIdle === 0 && night(0, 3).tricks === false && fin.tricks === false && fin.chars.top_hat_rat.placesAt === Infinity && night(0, 3).director.tactics === false, 'the training night and the Final Act keep their own rules: no tricks, no tactics');
}

// ------------------------------------------------------------------------ 22. fairness with every trick on: no death without its warning
{
  // for every catch in bot play: the time from the killer's arrival tell to the breach
  const least = { door: 1e9, vent: 1e9, nook: 1e9, cat: 1e9 };
  const count = { door: 0, vent: 0, nook: 0, cat: 0, untold: 0 };
  const kinds = new Set();
  let goodLost = 0;
  let goodNights = 0;
  for (const kind of ['good', 'medium', 'sloppy']) {
    for (const n of [2, 3, 4, 5, 7, 8]) {
      for (let i = 0; i < RUNS / 4; i++) {
        const told = {};
        const s = botNight(n, 8100 + i * 19 + n, kind, {
          onFx: (e, s) => {
            if (e.fx === 'cue') kinds.add(e.kind);
            if (e.fx === 'at_door') told[e.who] = s.t;
            if (e.fx === 'at_nook') told.rustgrin = s.t;
            if (e.fx === 'at_vent') told.purple_rat = s.t;
            if (e.fx === 'sound' && e.id === 'fnar.cat.run') told.cat = s.t;
            if (e.fx === 'breach' && e.who !== 'top_hat_rat') {
              const k = e.who === 'cat' ? 'cat' : e.who === 'purple_rat' ? 'vent' : e.who === 'rustgrin' ? 'nook' : 'door';
              if (told[e.who] === undefined) count.untold++;
              else {
                count[k]++;
                least[k] = Math.min(least[k], s.t - told[e.who]);
              }
            }
          },
        });
        if (kind === 'good') {
          goodNights++;
          if (s.result === 'lose') goodLost++;
        }
      }
    }
  }
  const D = CONFIG.characters;
  const need = { door: D.mirehop.entryGrace + D.mirehop.enterDelay, vent: 70, nook: D.rustgrin.enterAfter, cat: 60 };
  check(count.untold === 0 && Object.keys(need).every((k) => least[k] >= need[k]), 'no catch without its warning: from the arrival tell to the breach there is always time to answer', Object.keys(need).map((k) => `${k} ${least[k] === 1e9 ? '-' : least[k]}>=${need[k]} (${count[k]})`).join(', '));
  check(goodLost <= goodNights * 0.02, 'nothing is unavoidable: the good bot survives the nights with every trick on', `${goodNights - goodLost}/${goodNights} nights (2-5, custom, encore)`);
}

check(['squeal', 'burn', 'knock', 'decoy', 'playdead', 'burst', 'pull', 'pull_end', 'places', 'places_go', 'clatter', 'trade', 'grudge'].every((k) => CUES.has(k)), 'every trick has its own tell (a cue the game renders as a sound and a caption)', [...CUES].sort().join(', '));

console.log(failed ? `\n${failed} check(s) failed` : '\nall AI checks passed');
process.exit(failed ? 1 : 0);
