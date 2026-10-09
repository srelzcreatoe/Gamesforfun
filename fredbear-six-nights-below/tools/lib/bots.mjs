// Player policies used by the balance simulator and the automated tests.
//
//   idle       never touches anything.
//   oracle     reads the true AI state (upper bound: proves a valid defence
//              exists every night; not a human model).
//   human      reacts only to information a real player can perceive: hall
//              lights it switches on, camera feeds it looks at, and audio cues
//              (captions). Reaction delay 8-20 ticks, imperfect routine.
//   wasteful   keeps doors shut, lights on and cameras up (power stress test).

import { Rng } from '../../packs/FredbearBP/scripts/core/rng.js';
import { CAMERA_BY_ID } from '../../packs/FredbearBP/scripts/data/cameras.js';
import { NODE_BY_ID } from '../../packs/FredbearBP/scripts/data/nodes.js';

export function idleBot() {
  return { name: 'idle', act() {} };
}

const ENGAGED = ['APPROACH', 'TELEGRAPH', 'LURK', 'FORCING', 'JAMMED'];

export function oracleBot() {
  return {
    name: 'oracle',
    act(s) {
      const snap = s.snapshot();
      const want = { L: false, R: false, H: false };
      for (const id of s.order) {
        const a = s.anim[id];
        if (ENGAGED.includes(a.state) && a.entry) want[a.entry] = true;
      }
      // Freddy approaching the right corner: close early so he never slips in.
      const f = s.anim.freddy;
      if (f.state === 'STALK' && f.node === 'EH_S') want.R = true;
      const d = snap.devices;
      if (snap.phase === 'POWER_OUT' && snap.powerOut?.stage === 'reserve') s.input('reserve');
      if (snap.phase !== 'RUNNING') return;
      const fb = s.anim.fredbear;
      if (snap.mods.noDoors) {
        // No Doors challenge: a lit hall light is the barrier (one side at a time).
        const side = want.L && !(want.R && d.lightL && s.anim.bonnie.state !== 'TELEGRAPH') ? 'L' : want.R ? 'R' : null;
        if (side === 'L' && !d.lightL) s.input('light_l');
        else if (side === 'R' && !d.lightR) s.input('light_r');
        else if (!side && d.lightL) s.input('light_l');
        else if (!side && d.lightR) s.input('light_r');
        if (fb.entry && ['TELEGRAPH', 'FORCING', 'JAMMED'].includes(fb.state) && snap.strobe.cooldown === 0) s.input('strobe');
        if (snap.breaker.tripped && snap.breaker.resetting === 0) s.input('breaker');
        return;
      }
      if (want.L !== d.doorL && !snap.jammed.L) s.input('door_l');
      if (want.R !== d.doorR && !snap.jammed.R) s.input('door_r');
      if (snap.hatchInstalled && want.H !== d.hatch && !snap.jammed.H) s.input('hatch');
      if (['TELEGRAPH', 'FORCING', 'JAMMED'].includes(fb.state) && fb.entry && (s.barrierClosed(fb.entry) || s.jammed[fb.entry]) && snap.strobe.cooldown === 0) s.input('strobe');
      if (snap.breaker.tripped && snap.breaker.resetting === 0) s.input('breaker');
    },
  };
}

/**
 * Cue-driven human approximation. It keeps its own beliefs about each entry
 * and only updates them from lights, camera feeds and captions.
 */
export function humanBot(seed = 7, skill = 1.0) {
  const rng = new Rng(seed);
  const pending = []; // [tick, fn]
  const belief = { L: 0, R: 0, H: 0 }; // tick until which the entry is believed threatened
  let lightPhase = 0;
  let nextRoutine = 40;
  let camUntil = 0;
  let camPlan = [];
  let nextCams = 200;
  let freddyNear = 0;
  let fredbearEntry = null;
  const checks = []; // queued targeted light checks
  let checkSide = null;
  let checkUntil = 0;
  const react = (s, fn) => pending.push([s.t + rng.int(Math.round(8 / skill), Math.round(20 / skill)), fn]);

  // Visible = standing on the node, or (while walking) physically within
  // 3.5 blocks of it - e.g. stepping into a lit alcove.
  function seenAt(s, nodeId) {
    const n = NODE_BY_ID[nodeId];
    for (const id of s.order) {
      const a = s.anim[id];
      if (a.hidden || a.state === 'DORMANT') continue;
      if (!a.move && a.node === nodeId) return a;
      if (a.move) {
        const p = a.pose();
        if (!p.hidden && Math.hypot(p.x - n.x, p.z - n.z) < 3.5 && Math.abs(p.y - n.y) < 2) return a;
      }
    }
    return null;
  }

  return {
    name: 'human',
    onFx(s, fx) {
      if (fx.fx === 'repel') {
        // Fredbear's roar + flash: that entry is clear again.
        react(s, () => (belief[fx.entry] = 0));
        return;
      }
      if (fx.fx !== 'caption') return;
      const t = fx.text;
      if (/music box plays at the (LEFT DOOR|RIGHT DOOR|HATCH)/.test(t)) {
        const e = t.includes('LEFT') ? 'L' : t.includes('RIGHT') ? 'R' : 'H';
        react(s, () => {
          belief[e] = s.t + 400;
          fredbearEntry = e;
        });
      } else if (/forcing|jammed open/.test(t)) {
        react(s, () => s.input('strobe'));
      } else if (/OFFLINE/.test(t)) {
        react(s, () => s.input('breaker'));
      } else if (/reserve/i.test(t) && /POWER OUT/.test(t)) {
        react(s, () => s.input('reserve'));
      } else if (/laughter/.test(t)) {
        freddyNear = s.t + 300;
      } else if (/vents/.test(t)) {
        react(s, () => (belief.L = Math.max(belief.L, s.t + 160)));
      } else if (/(groan|breathing) at the (LEFT|RIGHT)/.test(t)) {
        const e = t.includes('LEFT') ? 'L' : 'R';
        react(s, () => (belief[e] = Math.max(belief[e], s.t + 120)));
      } else if (/Footsteps — (west|east) side/.test(t)) {
        // Footsteps nearby: do a quick light check on that side soon.
        const side = t.includes('west') ? 'L' : 'R';
        react(s, () => checks.push(side));
      } else if (/footsteps — beneath/i.test(t) && s.hatchInstalled) {
        react(s, () => (belief.H = Math.max(belief.H, s.t + 200)));
      }
    },
    act(s) {
      const snap = s.snapshot();
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i][0] <= s.t) {
          const fn = pending[i][1];
          pending.splice(i, 1);
          fn();
        }
      }
      if (snap.phase !== 'RUNNING') return;
      const d = snap.devices;
      const noDoors = !!snap.mods.noDoors;
      // No Doors challenge: while a side is believed threatened, its hall light is the barrier.
      if (noDoors && (belief.L > s.t || belief.R > s.t)) {
        const both = belief.L > s.t && belief.R > s.t;
        const side = both ? (s.t % 120 < 60 ? 'L' : 'R') : belief.L > s.t ? 'L' : 'R';
        const key = side === 'L' ? 'lightL' : 'lightR';
        if (!d[key] && !snap.breaker.tripped) s.input(side === 'L' ? 'light_l' : 'light_r');
        checkSide = null;
      }
      // Targeted light check prompted by footsteps.
      if (checkSide && s.t >= checkUntil) {
        const node = checkSide === 'L' ? 'W_DOOR' : 'E_DOOR';
        { const side = checkSide; if (seenAt(s, node)) react(s, () => (belief[side] = s.t + 70)); }
        const key = checkSide === 'L' ? 'lightL' : 'lightR';
        if (d[key]) s.input(checkSide === 'L' ? 'light_l' : 'light_r');
        checkSide = null;
      } else if (!checkSide && checks.length && !d.camsOpen && !snap.breaker.tripped) {
        checkSide = checks.shift();
        const key = checkSide === 'L' ? 'lightL' : 'lightR';
        if (!d[key]) s.input(checkSide === 'L' ? 'light_l' : 'light_r');
        checkUntil = s.t + 8;
        return;
      }
      // Light routine: flash left, then right, every ~4-7 s.
      if (s.t >= nextRoutine && !d.camsOpen && !checkSide && !(noDoors && (belief.L > s.t || belief.R > s.t))) {
        if (lightPhase === 0 && !snap.breaker.tripped) {
          if (!d.lightL) s.input('light_l');
          lightPhase = 1;
          nextRoutine = s.t + 10;
        } else if (lightPhase === 1) {
          if (seenAt(s, 'W_DOOR')) react(s, () => (belief.L = s.t + 70));
          else if (belief.L < s.t + 1 && fredbearEntry !== 'L') belief.L = 0;
          if (d.lightL) s.input('light_l');
          lightPhase = 2;
          nextRoutine = s.t + 4;
        } else if (lightPhase === 2 && !snap.breaker.tripped) {
          if (!d.lightR) s.input('light_r');
          lightPhase = 3;
          nextRoutine = s.t + 10;
        } else {
          if (seenAt(s, 'E_DOOR')) react(s, () => (belief.R = s.t + 70));
          if (d.lightR) s.input('light_r');
          lightPhase = 0;
          nextRoutine = s.t + rng.int(80, 140);
        }
      }
      // Breaker tripped: rely on cameras for the corners instead of lights.
      if (snap.breaker.tripped && snap.breaker.resetting === 0) react(s, () => s.input('breaker'));
      // Camera checks.
      if (!snap.mods.noCams && !d.camsOpen && s.t >= nextCams && snap.blackout === 'none') {
        if (freddyNear > s.t && !d.doorR) {
          s.input('door_r');
          belief.R = Math.max(belief.R, s.t + 200);
        }
        camPlan = ['C07', 'C12'];
        if (rng.chance(0.4)) camPlan.push(s.night >= 4 ? 'C16' : 'C01');
        s.input('cams_open', camPlan.shift());
        camUntil = s.t + 30;
      } else if (d.camsOpen && s.t >= camUntil) {
        const cam = CAMERA_BY_ID[d.cam];
        for (const n of cam.sees) {
          const a = seenAt(s, n);
          if (a && snap.disrupt === 0) {
            if (n === 'W_DOOR' || n === 'WH_S') belief.L = Math.max(belief.L, s.t + 140);
            if (n === 'E_DOOR' || n === 'EH_S') belief.R = Math.max(belief.R, s.t + 140);
            if (a.id === 'freddy' && (n === 'EH_S' || n === 'EH_M')) freddyNear = s.t + 300;
          }
        }
        if (camPlan.length) {
          s.input('cam_select', camPlan.shift());
          camUntil = s.t + 20;
        } else {
          s.input('cams_close');
          nextCams = s.t + rng.int(200, 360);
        }
      }
      // Door shut and belief about to lapse: look through the window first.
      for (const side of ['L', 'R']) {
        if (belief[side] > s.t && belief[side] - s.t === 8 && !checks.includes(side) && checkSide !== side) checks.push(side);
      }
      // Apply beliefs to barriers.
      const wantL = belief.L > s.t;
      const wantR = belief.R > s.t || (freddyNear > s.t && d.camsOpen);
      const wantH = belief.H > s.t;
      if (!noDoors) {
        if (wantL !== d.doorL && !snap.jammed.L) s.input('door_l');
        if (wantR !== d.doorR && !snap.jammed.R) s.input('door_r');
        if (snap.hatchInstalled && wantH !== d.hatch && !snap.jammed.H) s.input('hatch');
      }
      if (fredbearEntry && belief[fredbearEntry] > s.t && (s.barrierClosed(fredbearEntry) || snap.mods.strobeNoBarrier)) {
        const fb = s.anim.fredbear;
        if (['TELEGRAPH', 'FORCING', 'JAMMED'].includes(fb.state) && snap.strobe.cooldown === 0 && snap.strobe.charges > 0) {
          // The player only knows Fredbear is there from the cue; strobe once the barrier is shut.
          react(s, () => s.input('strobe'));
          fredbearEntry = null;
        }
      }
    },
  };
}

export function wastefulBot() {
  return {
    name: 'wasteful',
    act(s) {
      const snap = s.snapshot();
      if (snap.phase !== 'RUNNING') return;
      const d = snap.devices;
      if (!d.doorL && !snap.jammed.L) s.input('door_l');
      if (!d.doorR && !snap.jammed.R) s.input('door_r');
      if (!d.lightL && !snap.breaker.tripped && s.t % 10 === 0) s.input('light_l');
      if (!d.camsOpen && s.t % 20 === 0) s.input('cams_open', 'C01');
    },
  };
}

/** Run one night to completion. Returns a summary. */
export async function runNight(NightSession, { night, seed, bot, overrides, options, maxTicks = 20000 }) {
  const s = new NightSession({ night, seed, overrides, options });
  let ticks = 0;
  let minPower = s.power;
  const allFx = [];
  while (!['WON', 'LOST'].includes(s.phase) && ticks < maxTicks) {
    bot.act(s);
    const fx = s.tick();
    for (const f of fx) {
      bot.onFx?.(s, f);
      if (f.fx === 'maint_begin') s.resumeMaintenance();
      allFx.push({ ...f, t: s.t });
    }
    minPower = Math.min(minPower, s.power);
    ticks++;
  }
  return {
    night, seed, bot: bot.name, result: s.phase, t: s.t, power: s.power, minPower,
    attacker: s.stats.attacks.at(-1)?.who ?? null, stats: s.stats, session: s, fx: allFx,
  };
}
