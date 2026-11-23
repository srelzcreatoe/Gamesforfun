// Behaviour checks for the Golden Dog (core/ai/golden_dog.js), run at the end of ai_checks.mjs.
//
// For every shift: its tell comes first, its answer works, and nothing kills without its warning. And for
// all of them: the rest of the cast really holds still while he is at work, he never starts on top of
// something the guard must answer, and with him switched off the night is the same night for the others.
// Pure core only (no Minecraft): "is the guard looking at him" is the one input the game layer would give,
// and the scripted guards below give it themselves (NightSession.look).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const core = (p) => import(path.join(ROOT, 'packs/BP/scripts', p));
const { CONFIG, GOLDEN, CAST, FULL_CAST } = await core('core/config.js');
const { SHIFTS, WALK_LENGTH, walkPoint } = await core('core/ai/golden_dog.js');
const { CELLAR } = await core('data/cellar.js');
const { NODES } = await core('data/nodes.js');
const { CAMERA_BY_ID } = await core('data/cameras.js');
const { remember, cleanMemory, beliefsFor } = await core('core/ai/memory.js');

const G = CONFIG.golden;
/** Effects only the cast (or the things that run on its clock) can make: none may appear while it is held. */
const CAST_FX = new Set(['move', 'place', 'pose', 'hide', 'idle', 'cue', 'at_door', 'at_vent', 'at_nook', 'breach', 'left_door', 'cat_bang', 'vent_bang', 'tape', 'tape_stop', 'show_music', 'hallucination', 'rusted', 'pa', 'event', 'act', 'applause']);
/** Sounds a guard's own hands make (everything else that sounds is the cast). */
const HAND_SOUNDS = new Set(['fnar.door.error', 'fnar.tophat.rewind', 'fnar.tophat.fanfare']);
const isCastFx = (e) => CAST_FX.has(e.fx) || (e.fx === 'sound' && !HAND_SOUNDS.has(e.id));
const golden = (fx, kind) => fx.filter((e) => e.fx === 'golden' && (!kind || e.kind === kind));

export async function goldenChecks({ check, night, run, botNight, ONLY, RUNS }) {
  console.log('\n-- the Golden Dog');
  /** Tick `n` times, the guard's script first each tick; returns the effects. */
  const step = (s, n, guard) => {
    const out = [];
    for (let i = 0; i < n && !s.result; i++) {
      guard?.(s, i);
      s.tick();
      out.push(...s.drain());
    }
    return out;
  };
  /** A quiet Custom Night with nobody but him, a few seconds in; he does nothing until told to (force). */
  const alone = (seed = 1, level = 20, o = {}) => {
    const s = night(7, seed, { golden: true, ai: { ...ONLY(), golden_dog: level }, ...o });
    s.golden.choose = () => null;
    step(s, 60);
    return s;
  };
  /** Start a shift the way he does: the watch first. Returns the effects up to and including the shift's first tick. */
  const force = (s, kind) => {
    s.golden.startTell(kind);
    return step(s, G.tell);
  };

  // ---------------------------------------------------------------------- G1. where he is, and where he is not
  {
    const poses = {};
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const s = night(n, 31 + n, { golden: true });
      const place = golden(step(s, 3), 'place')[0];
      poses[n] = place ? `${place.pose}@${place.node}` : null;
    }
    const st = CELLAR.stage;
    check(poses[0] === null && poses[6] === null && poses[1] === `slump@${st}` && poses[2] === `wake@${st}` && [3, 4, 5, 8].every((n) => poses[n] === `stand@${st}`) && poses[7] === `slump@${st}`,
      'he is on his stage in the cellar every night but the training night and the Final Act: slumped on night 1, head up on night 2, standing from night 3', JSON.stringify(poses));
    let tells = 0;
    let held = 0;
    for (const n of [0, 1, 6]) {
      for (let i = 0; i < 3; i++) {
        const s = botNight(n, 77 + n + i * 5, 'good', { opts: { golden: true }, onFx: (e) => { if (e.fx === 'golden' && e.kind !== 'place') tells++; } });
        held += s.held;
      }
    }
    check(tells === 0 && held === 0, 'off on the training night, on night 1 and in the Final Act: the watch never ticks, nobody is held');
    check(FULL_CAST.length === CAST.length + 1 && FULL_CAST.includes(GOLDEN) && !CAST.includes(GOLDEN), 'he is not one of the six the night runs (CAST): he is listed with them only where a player sees the whole building (FULL_CAST)');
  }

  // ---------------------------------------------------------------------- G2. switched off, the night is the others' own
  {
    // (a) at level 0 the two clocks never part, on any night
    let apart = 0;
    for (const n of [1, 2, 3, 4, 5, 7, 8]) {
      const s = botNight(n, 500 + n, 'medium', { opts: { golden: false }, each: (s) => { if (s.t !== s.now || s.held) apart++; } });
      if (s.golden.count.tell) apart++;
    }
    check(apart === 0, 'at level 0 the night has one clock: the cast is never held, the watch never ticks');
    // (b) he draws from a stream of his own: until his first tell, a night with him is the night without him, effect for
    // effect, and the night's own random generator is in the same state every tick
    let same = true;
    let compared = 0;
    for (const n of [2, 3, 4, 5, 8]) {
      for (const seed of [9001, 9002, 9003]) {
        const on = night(n, seed, { golden: true });
        const off = night(n, seed);
        let r = seed;
        const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
        const ACTIONS = ['door_l', 'door_r', 'light_l', 'light_r', 'vent_l', 'vent_r', 'cams_toggle', 'cam_next', 'wind'];
        for (let i = 0; i < 12000 && !on.result && !off.result; i++) {
          on.tick();
          off.tick();
          const a = on.drain();
          const b = off.drain();
          if (a.some((e) => e.fx === 'golden' && e.kind === 'tell')) break;
          compared++;
          if (JSON.stringify(a.filter((e) => e.fx !== 'golden')) !== JSON.stringify(b.filter((e) => e.fx !== 'golden')) || on.rng.s !== off.rng.s) same = false;
          if (rand() < 0.05) {
            const act = ACTIONS[Math.floor(rand() * ACTIONS.length)];
            on.input(act);
            off.input(act);
          }
        }
      }
    }
    check(same && compared > 5000, 'he has a random stream of his own: until his first tell the night is the same night with or without him, effect for effect', `${compared} ticks compared`);
  }

  // ---------------------------------------------------------------------- G3. the cast really holds still
  {
    // A night full of his holds (gilding only, as often as he can) against the same night without him, with a guard
    // who plays by the cast's clock: in their own time the others do exactly the same things, effect for effect.
    // (Infinite power and a night without hourly ramps, so the only difference left is the time he takes.)
    const ai = { mirehop: 9, noxbriar: 9, rustgrin: 6, cat: 8, purple_rat: 8, top_hat_rat: 0 };
    const play = (level) => {
      const s = night(7, 606, { golden: true, ai: { ...ai, golden_dog: level }, mods: { infinitePower: true, noRusted: true } });
      s.golden.knows = (k) => k === 'gild';
      s.golden.otherAt = Infinity;
      const log = [];
      let r = 606;
      const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
      let acted = 0;
      const last = {};
      const ACTIONS = ['light_l', 'light_r', 'cams_toggle', 'cam_next', 'cam_prev', 'wind'];
      let heldFx = 0;
      let moved = 0;
      while (!s.result && s.now < 20000) {
        const hold = s.golden.holding;
        const t0 = s.t;
        const where = hold ? JSON.stringify(Object.values(s.chars).map((c) => [c.node, c.walk?.until, c.state])) : null;
        s.tick();
        for (const e of s.drain()) {
          if (hold && isCastFx(e)) heldFx++;
          if (e.fx !== 'golden' && e.fx !== 'hour' && e.fx !== 'win') log.push(`${s.t} ${JSON.stringify(e)}`);
        }
        if (hold && (s.t !== t0 || where !== JSON.stringify(Object.values(s.chars).map((c) => [c.node, c.walk?.until, c.state])))) moved++;
        // the guard: both doors and both vents shut for good, then lights, cameras and the tape at random,
        // once per tick of the cast's clock and never the same control twice within ten of them
        if (s.result || s.golden.busy || s.t === acted) continue;
        acted = s.t;
        if (s.t === 5) for (const a of ['door_l', 'door_r', 'vent_l', 'vent_r']) s.input(a);
        if (s.t > 20 && rand() < 0.08) {
          const a = ACTIONS[Math.floor(rand() * ACTIONS.length)];
          const key = a.startsWith('cam') ? 'cam' : a;
          if (s.t - (last[key] ?? -100) >= 10) {
            last[key] = s.t;
            s.input(a);
          }
        }
      }
      return { s, log, heldFx, moved };
    };
    const off = play(0);
    const on = play(20);
    const n = on.log.length;
    const prefix = n > 500 && on.log.every((l, i) => l === off.log[i]);
    check(on.s.held > 1200 && on.heldFx === 0 && on.moved === 0, 'while he is at work the rest of the cast holds still: their clock stops, nobody moves, nothing of theirs sounds', `${on.s.golden.count.gild} shifts, ${on.s.held} ticks held`);
    check(prefix && off.log.length >= n, 'and a hold costs them nothing but time: in their own time the others have the same night as without him, effect for effect', `${n} effects, the night ${on.s.held} ticks shorter for them`);
  }

  // ---------------------------------------------------------------------- G4. in bot play: the tell first, never on top of anything
  const totals = {};
  {
    let untold = 0;
    let overlap = 0;
    let badMoment = 0;
    let heldFx = 0;
    let moved = 0;
    let wrongKind = 0;
    let twice = 0;
    let kills = 0;
    let unwarned = 0;
    let nights = 0;
    let soonest = 1e9;
    const lostTo = { good: 0, medium: 0, sloppy: 0 };
    const played = { good: 0, medium: 0, sloppy: 0 };
    const cases = [[2, {}], [3, {}], [4, {}], [5, {}], [8, {}], [7, { ai: { mirehop: 10, noxbriar: 10, rustgrin: 6, cat: 8, purple_rat: 8, top_hat_rat: 0, golden_dog: 20 } }]];
    for (const kind of ['good', 'medium', 'sloppy']) {
      for (const [n, o] of cases) {
        for (let i = 0; i < Math.max(4, RUNS / 4); i++) {
          let tell = null; // { kind, at }
          let open = null; // the shift in progress
          let lastArrival = -1e9; // on the cast's clock
          let hold = false;
          let t0 = 0;
          let picks = 0;
          let looked = 0;
          let arrived = -1;
          let late = false;
          const seen = { dawn: 0, other: 0 };
          const s = botNight(n, 9100 + i * 23 + n * 7, kind, {
            opts: { golden: true, ...o },
            onFx: (e, s) => {
              if (hold && isCastFx(e)) heldFx++;
              if (e.fx === 'at_door' || e.fx === 'at_vent' || e.fx === 'at_nook' || (e.fx === 'sound' && e.id === 'fnar.cat.run')) lastArrival = s.t;
              if (e.fx !== 'golden') return;
              if (e.kind === 'tell') {
                if (tell || open) overlap++;
                tell = { kind: e.shift, at: s.now };
                soonest = Math.min(soonest, s.t - lastArrival);
                const stepping = Object.values(s.chars).some((c) => c.inside || ['entering', 'inside', 'run'].includes(c.state));
                const openDoor = ['L', 'R'].some((k) => Object.values(s.chars).some((c) => c.holds(k)) && !s.doorClosed(k)) || ['L', 'R'].some((k) => Object.values(s.chars).some((c) => c.holds(`V${k}`)) && !s.ventClosed(k));
                if (s.powerOut || s.rusted || s.chars.top_hat_rat.places || stepping || openDoor || s.t - lastArrival < G.quiet) badMoment++;
              }
              if (e.kind === 'shift') {
                totals[e.shift] = (totals[e.shift] ?? 0) + 1;
                const fromFeed = e.shift === 'visit' && e.from === 'feed';
                if (fromFeed ? picks < G.feed.picks : !tell || tell.kind !== e.shift || s.now - tell.at !== G.tell) untold++;
                if (open && !fromFeed) overlap++;
                if (!fromFeed && s.golden.level < G.unlock[e.shift]) wrongKind++;
                if (e.shift === 'dawn' && (++seen.dawn > 1 || s.hours !== 6 || s.hour < G.dawn.fromHour)) twice++;
                if (e.shift === 'other' && (++seen.other > 1 || s.now < G.other.hours[0] * s.ticksPerHour)) twice++;
                tell = null;
                open = e.shift;
                picks = 0;
                looked = 0;
                arrived = -1;
                late = false;
              }
              if (e.kind === 'pick') picks++;
              if (e.kind === 'arrive') arrived = s.now;
              if (e.kind === 'phone' && e.late) late = true;
              if (e.kind === 'end') {
                open = null;
                hold = false; // (ended by the guard's own hand between two ticks - the phone - the cast moves again at once)
              }
            },
            each: (s) => {
              // (after the tick: was the cast held during it, and did anything of theirs change?)
              if (hold && s.t !== t0) moved++;
              if (open === 'visit' && (s.looking || s.devices.cams.open)) looked++;
              hold = s.golden.holding;
              t0 = s.t;
            },
          });
          nights++;
          played[kind]++;
          if (s.killer === GOLDEN) {
            kills++;
            lostTo[kind]++;
            // his two ways: a visit looked at for longer than its budget, or the Other Office watched to the desk / left ringing
            const ok = s.killWay === 'visit' ? open === 'visit' && looked > G.visit.look : s.killWay === 'other' && open === 'other' && arrived >= 0 && (late || s.now - arrived >= WALK_LENGTH / G.other.speed - 1);
            if (!ok || !s.killNote) unwarned++;
          }
        }
      }
    }
    const list = SHIFTS.map((k) => `${k} ${totals[k] ?? 0}`).join(', ');
    check(untold === 0 && SHIFTS.every((k) => totals[k] > 0), `every shift comes after its tell: the watch ticks for ${G.tell} ticks first (a visit brought on by the wrong feed: after ${G.feed.picks} cameras picked)`, `${nights} nights: ${list}`);
    check(overlap === 0 && twice === 0 && wrongKind === 0, 'never two at once; the false dawn and the Other Office once a night at most, each shift only from its level on');
    check(badMoment === 0 && soonest >= G.quiet, 'the watch never starts on top of something the guard must answer: not in a blackout, the Rusted one\'s moment or "Places!", with nobody stepping in or at an open door, and not right after an arrival', `soonest ${soonest} ticks after one (at least ${G.quiet})`);
    check(heldFx === 0 && moved === 0, 'in bot play too the cast holds still through every tell, gilding, false dawn, visit and Other Office');
    check(unwarned === 0, 'he never takes the guard without his warning: only a visit looked at too long, or the Other Office watched to the desk or left ringing', `${kills} catches`);
    check(lostTo.good === 0 && lostTo.medium > 0 && lostTo.medium <= played.medium * 0.12 && lostTo.sloppy > lostTo.medium, 'a guard who looks away after the tell is never caught by him; an average one sometimes is, a careless one more often', `good ${lostTo.good}/${played.good}, medium ${lostTo.medium}/${played.medium}, sloppy ${lostTo.sloppy}/${played.sloppy} nights lost to him`);
  }

  // ---------------------------------------------------------------------- G5. the schedule by night
  {
    const by = {};
    for (const n of [2, 3, 4, 5]) {
      const c = {};
      for (let i = 0; i < Math.max(6, RUNS / 3); i++) {
        const s = botNight(n, 9500 + i * 29 + n, 'good', { opts: { golden: true } });
        for (const k of SHIFTS) c[k] = (c[k] ?? 0) + s.golden.count[k];
        c.nights = (c.nights ?? 0) + 1;
      }
      by[n] = c;
    }
    const per = (n, k) => by[n][k] / by[n].nights;
    const only = (n, ks) => SHIFTS.every((k) => ks.includes(k) || by[n][k] === 0);
    check(only(2, ['gild']) && per(2, 'gild') >= 1.5, 'night 2: gilding only, a few times a night', `${per(2, 'gild').toFixed(1)} a night`);
    check(only(3, ['gild', 'dawn', 'feed', 'visit']) && per(3, 'dawn') > 0.3 && per(3, 'feed') > 0.5 && per(3, 'visit') < 0.2, 'night 3: the false dawn and the wrong feed join in (a visit only if the guard brings him up)', SHIFTS.map((k) => `${k} ${per(3, k).toFixed(2)}`).join(', '));
    check(only(4, ['gild', 'dawn', 'feed', 'mirror', 'visit']) && per(4, 'mirror') > 0.4 && per(4, 'visit') > 0.4, 'night 4: the mirror and the visit', SHIFTS.map((k) => `${k} ${per(4, k).toFixed(2)}`).join(', '));
    check(per(5, 'other') > 0.7 && per(5, 'other') <= 1 && by[5].dawn === 0, 'night 5: the Other Office, once (and no false dawn on the night the Ringmaster ends at 4 AM)', SHIFTS.map((k) => `${k} ${per(5, k).toFixed(2)}`).join(', '));
  }

  // ---------------------------------------------------------------------- G6. gilding and the false dawn: nothing is real
  {
    const s = alone(11);
    const before = JSON.stringify(s.devices);
    const fx = force(s, 'gild');
    const sh = golden(fx, 'shift')[0];
    const during = step(s, G.gild.lasts - 2);
    const after = step(s, 4);
    check(golden(fx, 'tell').length === 1 && sh?.shift === 'gild' && sh.where === 'office' && golden(during, 'end').length === 0 && golden(after, 'end')[0]?.how === 'time' && JSON.stringify(s.devices) === before && !s.result,
      'gilding: the watch, a few seconds of his gold on what the guard is looking at (the office from the seat, a hall on a camera), and it passes: nothing to answer');
    const cams = alone(12);
    cams.input('cams_open', '2A');
    check(golden(force(cams, 'gild'), 'shift')[0]?.where === 'hall', 'with the monitor up the gilding is in the halls, where the guard is looking');

    const d = alone(13);
    step(d, 2 * d.ticksPerHour); // (it never comes before 2 AM)
    d.input('cams_open', '1A');
    const real = d.hour;
    const fx2 = force(d, 'dawn');
    const lied = d.snapshot().hour;
    const mid = step(d, G.dawn.lasts - 2);
    const out = step(d, 4);
    check(golden(fx2, 'shift')[0]?.shift === 'dawn' && lied === 6 && real < 6 && !d.devices.cams.open && fx2.some((e) => e.fx === 'cams' && !e.open && e.reason === 'golden') && !mid.some((e) => e.fx === 'win') && golden(out, 'end').length === 1 && d.snapshot().hour === d.hour && !d.result,
      'the false dawn: the clock says 6 AM and the monitor drops as at the real one, then it tears away - it is still night, and nothing was won', `the clock said ${lied} at ${real} AM`);
    const s5 = night(5, 5, { golden: true, ai: ONLY() });
    s5.golden.choose = () => null;
    step(s5, 3 * s5.ticksPerHour);
    delete s5.golden.choose;
    s5.golden.done.other = true;
    const picked = new Set();
    for (let i = 0; i < 300; i++) picked.add(s5.golden.choose());
    check(!s5.result && picked.has('visit') && picked.has('mirror') && !picked.has('dawn') && !picked.has(null), 'no false dawn on night 5 (that night has an ending of its own at 4 AM)', `at 3 AM he picks from: ${[...picked].sort().join(', ')}`);
  }

  // ---------------------------------------------------------------------- G7. the wrong feed
  {
    const s = alone(21);
    s.input('cams_open', '1A');
    const fx = force(s, 'feed');
    const blind = Object.keys(NODES).every((n) => !s.isWatchingNode(n));
    step(s, 20);
    s.input('cams_close');
    const out = step(s, 2);
    const end = golden(out, 'end')[0];
    step(s, 8);
    s.input('cams_open', '1A');
    step(s, 2);
    check(golden(fx, 'shift')[0]?.cam === CELLAR.cam && blind && s.golden.view().onStage && end?.shift === 'feed' && end.how === 'lowered' && s.isWatchingNode(CAMERA_BY_ID['1A'].sees[0]) && !s.result,
      'the wrong feed: every camera shows the cellar (the guard sees nobody, whatever is picked); lowering the monitor ends it at once');
    // three cameras in a row bring him up
    const p = alone(22);
    p.input('cams_open', '1A');
    force(p, 'feed');
    const picks = [];
    for (const cam of ['1B', '2A', '4A']) {
      step(p, 6);
      p.input('cam_select', cam);
      picks.push(...step(p, 1));
    }
    const visit = golden(picks, 'shift')[0];
    check(golden(picks, 'pick').length === G.feed.picks && visit?.shift === 'visit' && visit.from === 'feed' && !p.devices.cams.open && p.golden.holding && golden(picks, 'end')[0]?.how === 'picked',
      `picking ${G.feed.picks} cameras in a row brings him up: the monitor drops and he is behind the seat (a visit, at once)`);
    // the monitor never raised: it just passes
    const q = alone(23);
    force(q, 'feed');
    const rest = step(q, G.feed.lasts + 2);
    check(golden(rest, 'end')[0]?.how === 'time' && !q.result && !golden(rest, 'shift').length, 'a wrong feed nobody looks at passes by itself');
    // it does not hold the cast: the building moves again when the watch stops
    check(!G.hold.feed && !G.hold.mirror && G.hold.gild && G.hold.dawn && G.hold.visit && G.hold.other && !q.golden.holding, 'the wrong feed and the mirror are about the guard\'s own controls: the cast is only held while the watch ticks');
  }

  // ---------------------------------------------------------------------- G8. the mirror
  {
    const s = alone(31);
    const fx = force(s, 'mirror');
    const said = s.snapshot().golden.mirror;
    const d = s.devices;
    s.input('door_l');
    const a = d.doorR && !d.doorL;
    s.input('light_l');
    const b = d.lightR && !d.lightL;
    s.input('vent_r');
    const c = d.ventL && !d.ventR;
    // the answer: the other hand
    step(s, 12);
    s.input('door_r');
    const other = d.doorL;
    const mid = step(s, G.mirror.lasts - 20);
    const out = step(s, 12);
    s.input('door_l');
    const backToNormal = !d.doorL; // (the left button works the left door again: it was shut, now it opens)
    check(golden(fx, 'shift')[0]?.shift === 'mirror' && s.golden.count.mirror === 1 && a && b && c && other && golden(mid, 'end').length === 0 && golden(out, 'end').length === 1 && backToNormal && !s.result,
      `the mirror: for ${G.mirror.lasts / 20} seconds the left buttons work the right door, light and vent and the other way round; the other hand answers it, and then left is left again`);
    check(said === true && s.snapshot().golden.mirror === false && alone(32).snapshot().golden.state === 'stage', 'the snapshot says when left is right (for the HUD)');
  }

  // ---------------------------------------------------------------------- G9. the visit
  {
    const P = CONFIG.power;
    // eyes forward: nothing happens, and it costs a little power
    const s = alone(41);
    s.input('cams_open', '1A');
    s.input('door_l');
    const fx = force(s, 'visit');
    const p0 = s.power;
    const during = step(s, G.visit.lasts - 1);
    const p1 = s.power;
    const out = step(s, 3);
    const cost = (p0 - p1) / (G.visit.lasts - 1);
    check(golden(fx, 'shift')[0]?.node === CELLAR.visit && NODES[CELLAR.visit]?.office && !s.devices.cams.open && golden(during, 'seen').length === 0 && golden(out, 'end')[0]?.how === 'time' && !s.result,
      `the visit: he stands behind the seat for ${G.visit.lasts / 20} seconds, the monitor drops; a guard who keeps their eyes forward comes to no harm`);
    check(Math.abs(cost - (P.base[7] + G.visit.cost)) < 0.05 && s.devices.doorL, 'while he holds the building the doors and lights draw nothing: a visit costs the clock\'s own drain and a little on top, whatever was switched on', `${cost.toFixed(2)} a tick with a door shut (${((cost * G.visit.lasts) / 1000).toFixed(2)} % a visit)`);
    // looking at him: a warning first, then he takes the guard
    const k = alone(42);
    force(k, 'visit');
    step(k, 10);
    let seenAt = -1;
    let lookedFor = 0;
    while (!k.result && lookedFor < 200) {
      k.look(true);
      k.tick();
      lookedFor++;
      if (golden(k.drain(), 'seen').some((e) => e.on) && seenAt < 0) seenAt = lookedFor;
    }
    check(k.killer === GOLDEN && k.killWay === 'visit' && k.killNote === 'golden_visit' && seenAt === 1 && lookedFor === G.visit.look + 1,
      `looked at for more than ${G.visit.look} ticks in all, he takes the guard; the first tick of a look is already answered (the 'seen' effect)`, `caught after ${lookedFor} ticks of looking`);
    // glances add up
    const t = alone(43);
    force(t, 'visit');
    let total = 0;
    for (let i = 0; i < G.visit.lasts && !t.result; i++) {
      const look = i % 20 < 9; // a glance of 9 ticks every second
      t.look(look);
      if (look) total++;
      t.tick();
    }
    check(t.killer === GOLDEN && total === G.visit.look + 1, 'the looks add up: short glances over the shoulder take the guard just the same');
    // a short look is forgiven
    const f = alone(44);
    force(f, 'visit');
    const part = step(f, G.visit.lasts + 2, (s, i) => s.look(i >= 20 && i < 20 + G.visit.look - 5));
    check(!f.result && golden(part, 'seen').map((e) => e.on).join() === 'true,false' && golden(part, 'end').length === 1, 'a look shorter than that is forgiven: he says so (seen, and unseen again) and the visit passes');
    // the monitor shows only his face: raising it is looking
    const m = alone(45);
    force(m, 'visit');
    step(m, 5);
    m.input('cams_open', '1A');
    step(m, G.visit.look + 5);
    check(m.killer === GOLDEN && m.killWay === 'visit', 'raising the monitor during a visit is looking at him (it shows only his face)');
    // a blackout ends it
    const b = alone(46);
    force(b, 'visit');
    b.power = 20;
    const dark = step(b, 12);
    check(b.powerOut && golden(dark, 'end')[0]?.how === 'power' && b.golden.state === 'stage' && !b.golden.holding, 'if the power goes during his visit he lets go: the blackout is the Rustgrin\'s own');
  }

  // ---------------------------------------------------------------------- G10. the Other Office
  {
    const O = G.other;
    const walkTicks = Math.ceil(WALK_LENGTH / O.speed);
    // eyes on the desk, the phone answered: back upstairs
    const s = alone(51);
    s.input('cams_open', '1A');
    const fx = force(s, 'other');
    const sh = golden(fx, 'shift')[0];
    const early = s.input('answer');
    const fade = step(s, O.fade);
    const there = s.golden.away;
    const dead = ['door_l', 'light_r', 'vent_l', 'cams_open', 'cam_next'].map((a) => s.input(a));
    const quiet = s.input('answer');
    const wait = step(s, O.phone);
    const stood = s.golden.shift.dist;
    const ring = golden(wait, 'phone').some((e) => e.ring);
    const ok = s.input('answer');
    const back = step(s, 2);
    const works = s.input('door_l').ok && s.devices.doorL;
    check(sh?.shift === 'other' && !s.devices.cams.open && !early.ok && golden(fade, 'arrive').length === 1 && there && dead.every((r) => !r.ok && r.reason === 'away') && !quiet.ok && quiet.reason === 'quiet' && ring && stood === 0 && ok.ok && golden(back, 'end')[0]?.how === 'answered' && !s.golden.away && works && !s.result,
      'the Other Office: the monitor drops, the lamp stutters and the guard sits in the cellar; nothing of the real office answers; unwatched, he does not move; the phone rings, and picking it up is the way back');
    // he walks only while he is watched, and watched all the way he takes the guard
    const w = alone(52);
    force(w, 'other');
    step(w, O.fade);
    let watched = 0;
    let wrong = 0;
    const steps = [];
    for (let i = 0; i < 2000 && !w.result; i++) {
      const look = i % 40 < 30; // watching, then half a second not
      w.look(look);
      const d0 = w.golden.shift?.dist ?? 0;
      w.tick();
      steps.push(...golden(w.drain(), 'step'));
      const d1 = w.golden.shift?.dist ?? d0;
      if (w.golden.shift?.late) break;
      if (look) watched++;
      if ((d1 > d0) !== look && !w.result) wrong++;
    }
    const last = NODES[CELLAR.walk[CELLAR.walk.length - 1]];
    const end = walkPoint(WALK_LENGTH);
    check(wrong === 0 && w.killer === GOLDEN && w.killWay === 'other' && w.killNote === 'golden_other' && Math.abs(watched - walkTicks) <= 1 && steps.map((e) => e.node).join() === CELLAR.walk.slice(1).join() && Math.hypot(end[0] - last.x, end[1] - last.y, end[2] - last.z) < 1e-6,
      'he walks only while he is watched, along the aisle from his stage to the desk; watched all the way, he takes the guard', `${watched} ticks of watching for ${WALK_LENGTH.toFixed(1)} blocks`);
    // the phone left ringing: he comes anyway
    const l = alone(53);
    force(l, 'other');
    const all = step(l, O.fade + O.phone + O.patience + walkTicks + 5);
    const lateAt = all.findIndex((e) => e.fx === 'golden' && e.kind === 'phone' && e.late);
    check(l.killer === GOLDEN && l.killWay === 'other' && lateAt > 0 && golden(all, 'walk')[0]?.on === true, `a phone left ringing for ${O.patience / 20} seconds is no hiding place: he stops waiting and comes whether he is watched or not`);
    // and answering even then is still the way back
    const a = alone(54);
    force(a, 'other');
    step(a, O.fade + O.phone + O.patience + 60);
    const saved = a.input('answer').ok;
    step(a, 3);
    check(saved && !a.result && !a.golden.away, 'but picking it up is the way back until the very end');
    // what it costs
    const c = alone(55);
    force(c, 'other');
    step(c, O.fade + 1);
    const p0 = c.power;
    step(c, 100);
    const cost = (p0 - c.power) / 100;
    check(Math.abs(cost - (CONFIG.power.base[7] + O.cost)) < 0.05, 'the Other Office costs a little power for as long as the guard sits in it', `${cost.toFixed(2)} a tick (about ${(((O.fade + O.phone + 20) * cost) / 1000).toFixed(1)} % for a guard who picks up at once)`);
    // once a night, in its hours
    let outside = 0;
    let more = 0;
    for (let i = 0; i < Math.max(6, RUNS / 3); i++) {
      let n = 0;
      const s5 = botNight(5, 9700 + i * 31, 'good', { opts: { golden: true }, onFx: (e, s) => { if (e.fx === 'golden' && e.kind === 'shift' && e.shift === 'other') { n++; if (s.now < O.hours[0] * s.ticksPerHour || s.now > s.hours * s.ticksPerHour - O.endMargin + G.tell) outside++; } } });
      if (n > 1 || s5.killer === GOLDEN) more++;
    }
    check(outside === 0 && more === 0, 'night 5: once, after the first hour or so and well before 4 AM; the good bot always finds the way back');
    // the takeover or 6 AM cut it short
    const e = alone(56);
    force(e, 'other');
    step(e, O.fade + 5);
    e.t = e.ticksPerHour * 6 - e.held - 2;
    const fin = step(e, 4);
    check(e.result === 'win' && golden(fin, 'end').length === 1 && !e.golden.away, 'if the night ends while the guard sits there, he lets go first (the game layer brings the guard back)');
  }

  // ---------------------------------------------------------------------- G11. CAM 11
  {
    const S = G.stare;
    const s = alone(61, 9);
    const base = s.golden.nextAt;
    s.input('cams_open', CELLAR.cam);
    const short = step(s, S.after - 5);
    s.input('cam_select', '1A');
    step(s, S.forget + 2);
    s.input('cam_select', CELLAR.cam);
    const again = step(s, S.after - 5);
    const calm = golden([...short, ...again], 'stare').length === 0 && s.golden.nextAt === base && !s.golden.angry;
    const stare = step(s, 10);
    const turned = golden(stare, 'stare')[0]?.on === true;
    // (never right on top of the start of the night either: the same rest as after a shift)
    const sooner = s.golden.nextAt < base && s.golden.nextAt <= Math.max(Math.round(G.gap(9)[0] * S.rest), s.now + S.sooner[1]) && s.golden.angry;
    s.input('cam_select', '1A');
    const away = step(s, S.forget + 2);
    check(calm && turned && sooner && golden(away, 'stare')[0]?.on === false,
      `CAM 11 shows him on his stage. A few seconds at a time are safe; watched for ${S.after / 20} seconds he turns to the lens, and his next shift comes sooner`, `next tell in ${s.golden.nextAt - s.now} ticks instead of ${base - s.now}`);
    // provoked, it is one of the worse ones
    const a = alone(62, 9);
    delete a.golden.choose;
    a.golden.angry = true;
    const picks = {};
    for (let i = 0; i < 400; i++) { const k = a.golden.choose(); picks[k] = (picks[k] ?? 0) + 1; }
    const c = alone(62, 9);
    delete c.golden.choose;
    const calmPicks = {};
    for (let i = 0; i < 400; i++) { const k = c.golden.choose(); calmPicks[k] = (calmPicks[k] ?? 0) + 1; }
    check(picks.visit > calmPicks.visit * 1.4, 'provoked, he is more likely to come up himself', `a visit ${picks.visit}/400 times against ${calmPicks.visit}/400`);
    // staring cannot chain his holds: never right on top of the last shift
    const r = alone(63, 20);
    delete r.golden.choose;
    r.input('cams_open', CELLAR.cam);
    let least = 1e9;
    let lastEnd = -1;
    let tells = 0;
    for (let i = 0; i < 6000 && !r.result; i++) {
      if (!r.devices.cams.open && !r.golden.busy) r.input('cams_open', CELLAR.cam);
      if (r.golden.away && r.golden.shift.ringing) r.input('answer');
      r.tick();
      for (const e of golden(r.drain())) {
        if (e.kind === 'end') lastEnd = r.now;
        if (e.kind === 'tell') { tells++; if (lastEnd >= 0) least = Math.min(least, r.now - lastEnd); }
      }
    }
    const rest = Math.round(G.gap(20)[0] * S.rest);
    check(tells >= 3 && least >= rest, 'a guard who stares at CAM 11 all night cannot chain his shifts: there is always a rest after one', `${tells} tells, never less than ${least} ticks after the last shift (at least ${rest})`);
    // while he is at work his stage is empty
    const e = alone(64);
    e.input('cams_open', CELLAR.cam);
    step(e, 5);
    const on = e.golden.watched();
    e.golden.startTell('gild');
    const torn = !e.camWorking(CELLAR.cam);
    check(on && !e.golden.watched() && torn && e.snapshot().golden.onStage === false, 'an empty stage on CAM 11 means he is at work: the feed tears as the watch starts');
    // night 1: he only stands there
    const n1 = night(1, 65, { golden: true });
    step(n1, 30);
    n1.input('cams_open', CELLAR.cam);
    const fx1 = step(n1, S.after + 10);
    check(golden(fx1, 'stare').length === 1 && n1.golden.nextAt === Infinity && !n1.golden.angry, 'on night 1 he is slumped and never acts; stared at, he still lifts his head to the lens');
  }

  // ---------------------------------------------------------------------- G12. the bots, the memory, determinism
  {
    const hash = (n, seed, kind) => {
      let h = 0;
      botNight(n, seed, kind, { opts: { golden: true }, onFx: (e) => { const j = JSON.stringify(e); for (let i = 0; i < j.length; i++) h = (Math.imul(h, 31) + j.charCodeAt(i)) | 0; } });
      return h;
    };
    let same = true;
    for (const n of [2, 3, 4, 5, 8]) for (const kind of ['good', 'medium']) if (hash(n, 5151 + n, kind) !== hash(n, 5151 + n, kind)) same = false;
    check(same, 'deterministic with him too: the same seed and guard give the same night, effect for effect');
    // the week's memory does not track him
    const lost = alone(71);
    force(lost, 'visit');
    step(lost, G.visit.look + 5, (s) => s.look(true));
    const sum = { ...lost.summary(), night: 4 };
    const mem = remember(null, sum);
    check(lost.killer === GOLDEN && sum.died === GOLDEN && (!mem || mem.death === null) && !beliefsFor(mem, 5)?.encore && cleanMemory({ v: 1, nights: 1, death: { who: GOLDEN, way: 'visit', night: 4 }, deaths: 1 })?.death == null,
      'the week\'s memory does not track him: a catch by him leaves no grudge behind');
  }
}
