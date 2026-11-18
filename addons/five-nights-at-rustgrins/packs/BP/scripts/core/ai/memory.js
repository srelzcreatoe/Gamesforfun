// What the animatronics remember about the guard from one night of the week to the next.
//
// The session only knows one night. When a night ends, the game layer asks for its summary
// (`summarize`), folds it into the memory kept in the save (`remember`) and hands that memory
// to the next night (`NightSession.recall`), where it becomes a handful of starting beliefs
// (`beliefsFor`). Everything here is small, bounded and pure (no @minecraft imports):
//
//   stored    how much of the night each door and each vent cover was shut, how often each
//             hall light was checked (per hour), how much of the night the monitor was up,
//             how the guard died last time (who, and through which door or vent) and how many
//             deaths in a row. Nothing else: no positions, no timings, no camera lists.
//   decay     each new night counts as much as everything before it together (older nights
//             fade by half every night); a night cut short tells them less (its weight is
//             the hours played); and tonight's beliefs fade over the first hours, so by 3 AM
//             only what they see tonight counts.
//   caps      every number is clamped on the way in and on the way out (`cleanMemory`), and
//             how sure they can get is capped too.
//   fairness  beliefs move WHERE and WHEN they try first (the hall you checked least, the vent
//             you sealed least), never how hard: nobody gets a higher AI level out of it. A
//             death never makes the next night harder: the director eases off a step for
//             every death in a row, and whoever caught the guard comes back first and by the
//             very same way, with its usual tells (the 'grudge' cue): predictable on purpose.
//   blank     night 1 always starts blank (so does a fresh save), and only the week's nights
//             (1-5) are remembered: the Final Act, the Custom Night, the challenges and the
//             Encore neither read nor write it.

import { CONFIG, CAST } from '../config.js';

export const MEMORY_VERSION = 1;
const SIDES = Object.freeze(['L', 'R']);
const OTHER = Object.freeze({ L: 'R', R: 'L' });
const WAYS = Object.freeze(['L', 'R', 'VL', 'VR', 'power']);

const num = (v, lo, hi, d = lo) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
const r3 = (v) => Math.round(v * 1000) / 1000;
const pair = (o, lo, hi) => ({ L: r3(num(o?.L, lo, hi)), R: r3(num(o?.R, lo, hi)) });

/** Is this a night of the week they remember the guard on (and from)? */
export function memoryNight(night) {
  return CONFIG.memory.nights.includes(night);
}

/**
 * One finished (or lost) night, as they will remember it.
 * @param {import('../session.js').NightSession} s
 */
export function summarize(s) {
  const T = s.habits.total;
  const ticks = Math.max(1, T.ticks);
  const hours = Math.min(6, s.t / s.ticksPerHour);
  const per = (n) => r3(Math.min(1, n / ticks));
  const perHour = (n) => r3(Math.min(CONFIG.memory.maxChecks, hours > 0.05 ? n / hours : 0));
  return {
    night: s.night,
    hours: r3(hours),
    door: { L: per(T.door.L), R: per(T.door.R) },
    vent: { L: per(T.vent.L), R: per(T.vent.R) },
    light: { L: perHour(s.habits.light.L.checks), R: perHour(s.habits.light.R.checks) },
    cams: per(T.cams),
    died: s.result === 'lose' ? s.killer : null,
    way: s.result === 'lose' ? s.killWay ?? null : null,
  };
}

/**
 * Sanitise a memory read from the save (or built by `remember`): every field clamped, anything
 * unknown dropped. Returns null for "they do not know the guard".
 */
export function cleanMemory(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== MEMORY_VERSION) return null;
  const M = CONFIG.memory;
  const nights = r3(num(raw.nights, 0, M.maxNights, 0));
  const deaths = Math.round(num(raw.deaths, 0, M.maxDeaths, 0));
  let death = null;
  const d = raw.death;
  if (d && typeof d === 'object' && typeof d.who === 'string' && (CAST.includes(d.who) || d.who === 'rusted')) {
    death = { who: d.who, way: WAYS.includes(d.way) ? d.way : null, night: Math.round(num(d.night, 0, 9, 0)) };
  }
  if (nights <= 0 && !death) return null;
  return {
    v: MEMORY_VERSION,
    nights,
    door: pair(raw.door, 0, 1),
    vent: pair(raw.vent, 0, 1),
    light: pair(raw.light, 0, M.maxChecks),
    cams: r3(num(raw.cams, 0, 1)),
    death,
    deaths: death ? Math.max(1, deaths) : 0,
  };
}

/**
 * Fold a night into the memory. Pure: returns a new memory (or null).
 * @param {ReturnType<typeof cleanMemory>} memory what they knew before (null = nothing)
 * @param {ReturnType<typeof summarize>} sum the night that just ended
 */
export function remember(memory, sum) {
  const M = CONFIG.memory;
  const old = cleanMemory(memory);
  if (!sum || !memoryNight(sum.night)) return old;
  // how much this night tells them, against what they knew (which fades by `keep` a night)
  const w = num(sum.hours / M.fullAfter, 0, 1, 0);
  const before = old ? old.nights * M.keep : 0;
  const a = w + before > 0 ? w / (w + before) : 0;
  const mix = (x, y) => num(x, 0, 1e6, 0) + (num(y, 0, 1e6, 0) - num(x, 0, 1e6, 0)) * a;
  const both = (x, y) => ({ L: mix(x?.L, y?.L), R: mix(x?.R, y?.R) });
  const died = typeof sum.died === 'string' ? sum.died : null;
  return cleanMemory({
    v: MEMORY_VERSION,
    nights: Math.min(M.maxNights, before + w),
    door: both(old?.door, sum.door),
    vent: both(old?.vent, sum.vent),
    light: both(old?.light, sum.light),
    cams: mix(old?.cams, sum.cams),
    // a night survived wipes the grudge: only the last death is remembered, and only until then
    death: died ? { who: died, way: sum.way, night: sum.night } : null,
    deaths: died ? (old?.deaths ?? 0) + 1 : 0,
  });
}

/**
 * The beliefs a night starts with, or null (blank). They fade during the night: see
 * NightSession.trust().
 * @param {ReturnType<typeof cleanMemory>} memory
 * @param {number} night
 */
export function beliefsFor(memory, night) {
  const m = cleanMemory(memory);
  const M = CONFIG.memory;
  if (!m || !memoryNight(night) || night <= M.nights[0]) return null;
  const conf = Math.min(1, m.nights);
  // the soft side: the hall whose light the guard checks clearly less...
  let soft = null;
  let softBy = 0;
  const hi = Math.max(m.light.L, m.light.R);
  const lo = Math.min(m.light.L, m.light.R);
  if (hi >= M.minChecks && lo <= hi * M.neglect) {
    soft = m.light.L < m.light.R ? 'L' : 'R';
    softBy = Math.min(1, (hi - lo) / hi);
  }
  // ...or the side across from a door the guard keeps shut (and leaves the other one alone)
  let camp = null;
  for (const side of SIDES) if (m.door[side] >= M.camp && m.door[OTHER[side]] < M.camp * 0.7) camp = side;
  if (!soft && camp) {
    soft = OTHER[camp];
    softBy = Math.min(1, m.door[camp]) * 0.8;
  }
  // the vent the guard seals clearly less
  let ventSoft = null;
  const vh = Math.max(m.vent.L, m.vent.R);
  const vl = Math.min(m.vent.L, m.vent.R);
  if (vh >= M.minVent && vl <= vh * M.neglect) ventSoft = m.vent.L < m.vent.R ? 'L' : 'R';
  // the rhythm of the light checks they expect (ticks between two checks of one hall)
  const B = CONFIG.brain;
  const gap = (perHour) => (perHour >= 0.5 ? Math.round(num(CONFIG.clock.ticksPerHour / perHour, M.minGap, B.gapStart * 2)) : B.gapStart);
  const d = m.death;
  const encore = d && CAST.includes(d.who) && ['L', 'R', 'VL', 'VR'].includes(d.way) ? { who: d.who, way: d.way } : null;
  return {
    conf,
    soft,
    softBy: r3(softBy),
    camp,
    ventSoft,
    gap: { L: gap(m.light.L), R: gap(m.light.R) },
    monitor: m.cams >= M.monitor ? 'watcher' : m.cams <= M.shy ? 'shy' : null,
    encore,
    ease: Math.min(M.maxEase, m.deaths * M.ease),
    deaths: m.deaths,
  };
}

/**
 * What the Ringmaster may hint at in tonight's call, most telling first: keys into
 * data/story.js MEMORY_CALLS (e.g. 'encore.mirehop', 'soft.L', 'camp.R', 'monitor').
 * @returns {string[]}
 */
export function memoryHints(memory, night) {
  const m = cleanMemory(memory);
  const b = beliefsFor(m, night);
  if (!m || !b) return [];
  const out = [];
  if (m.death) {
    if (b.encore) out.push(`encore.${b.encore.who}`);
    else if (m.death.way === 'power') out.push('power');
    else if (m.death.who === 'rusted') out.push('rusted');
  }
  if (b.conf >= 0.5) {
    if (b.soft && !b.camp) out.push(`soft.${b.soft}`);
    if (b.camp) out.push(`camp.${b.camp}`);
    if (b.monitor) out.push(b.monitor);
  }
  return out;
}
