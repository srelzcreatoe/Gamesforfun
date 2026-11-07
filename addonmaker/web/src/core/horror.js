// Horror dwellers v2: a configurable stalker AI that compiles into standard
// Bedrock data at export time.
//
//  * State machine (like vanilla's creaking): an enum property + mutually
//    exclusive component groups + filtered events.
//      arriving ─▶ dormant ──notice──▶ stalking ──close / timer / hurt──▶ hunting
//      gaze reactions: flee · freeze (moves only while unwatched) · vanish · blink · charge · stare
//  * Appearance director: behavior-pack functions (tick.json) keep a per-player
//    timer and bring the dweller to you: first after N minutes, then every
//    X–Y minutes with a chance roll, one at a time. It arrives invisibly,
//    teleports to a valid spot nearby, checks its habitat (underground /
//    surface / both, night or any time) and only then shows itself.
import { clone, isObj, hashStr } from './util.js';

export const HORROR_STATES = ['dormant', 'stalking', 'hunting', 'fleeing', 'frozen', 'gone', 'arriving'];

export const SEEN_REACTIONS = [
  ['none', 'Ignore it', 'Doesn\'t care if you look at it.'],
  ['flee', 'Hide', 'Bolts into the dark when you spot it, then comes back.'],
  ['freeze', 'Freeze', 'Can only move while nobody is looking at it.'],
  ['vanish', 'Vanish', 'Disappears in a puff of smoke when you spot it.'],
  ['teleport', 'Blink away', 'Teleports somewhere nearby when you spot it.'],
  ['charge', 'Charge', 'Looking at it makes it attack immediately.'],
  ['stare', 'Stare back', 'Just stares… and plays a sound.'],
];
export const AFTER_HUNT = [['stalk', 'Go back to stalking'], ['dormant', 'Lose interest'], ['vanish', 'Vanish']];
export const DWELLER_TYPES = [
  ['underground', 'Underground', 'Lives in caves and deep tunnels', '⛏'],
  ['surface', 'Surface', 'Roams the overworld', '🌲'],
  ['both', 'Underground + surface', 'Can turn up anywhere', '🌗'],
];
export const DWELLER_TIMES = [['night', 'Only at night (surface)'], ['always', 'Day and night']];
export const RARITY = { rare: 8, uncommon: 20, common: 45 };

export function defaultHorror() {
  return {
    enabled: false,
    archetype: 'stalker',
    type: 'underground',
    time: 'night',
    appear: { director: true, firstAfter: 3, every: [6, 12], chance: 70, oneAtATime: true, leaveAfter: 5, distance: 'medium', natural: true, rarity: 'uncommon' },
    senses: { detect: 32, lose: 64, seen: 'flee', seenRange: 48, fov: 24, lookTime: 0.4, pumpkinSafe: true },
    stalk: { on: true, keep: 14, speed: 0.85, huntAfter: 60 },
    hunt: { onClose: true, close: 6, onHurt: true, speed: 1.6, damage: 8, duration: 25, after: 'stalk', leap: false },
    scares: {
      darkness: true, heartbeat: true, scream: true, shake: true, fog: true, messages: true, particles: true,
      screamSound: 'mob.warden.roar', heartbeatSound: 'mob.warden.heartbeat', seenSound: 'mob.endermen.stare',
      notice: 'You feel watched...', huntMsg: 'RUN.', seenMsg: '', fogColor: '#08080c', fogDistance: 20,
    },
    moments: null, // optional per-moment scare lists from the node board
    traits: { breakLights: true, breakDoors: true, climb: false, noFall: true },
    weakness: { sunlight: 'vanish', fire: true },
    graph: null,
  };
}

/** Upgrades configs saved by Mobsmith 1.1. */
export function migrateHorror(h) {
  const d = defaultHorror();
  const out = { ...d, ...h };
  for (const k of ['appear', 'senses', 'stalk', 'hunt', 'scares', 'traits', 'weakness']) out[k] = { ...d[k], ...(h?.[k] || {}) };
  if (h?.habitat && !h.type) {
    out.type = h.habitat.where === 'caves' ? 'underground' : h.habitat.where === 'anywhere' ? 'both' : 'surface';
    out.time = h.habitat.where === 'caves' ? 'night' : 'night';
    out.appear.rarity = h.habitat.rarity || 'uncommon';
  }
  delete out.habitat;
  return out;
}

const S = (h, o) => Object.assign(h, o);
// Stalking styles. Each sets behaviour only; presets add bodies/sounds.
export const ARCHETYPES = {
  stalker: {
    label: 'Stalker', icon: '👁', blurb: 'Follows at the edge of your torchlight, hides when spotted, hunts when you get close or after a while.',
    apply: (h) => {
      S(h.senses, { seen: 'flee', detect: 32, seenRange: 48, fov: 24, lookTime: 0.4 });
      S(h.stalk, { on: true, keep: 14, speed: 0.85, huntAfter: 60 });
      S(h.hunt, { onClose: true, close: 6, onHurt: true, speed: 1.6, duration: 25, after: 'stalk', leap: false });
    },
  },
  peeker: {
    label: 'Peeker', icon: '🫣', blurb: 'Peeks at you from far away and ducks out of sight the moment you notice. Rarely attacks.',
    apply: (h) => {
      S(h.senses, { seen: 'flee', detect: 40, seenRange: 56, fov: 20, lookTime: 0.2 });
      S(h.stalk, { on: true, keep: 22, speed: 0.7, huntAfter: 240 });
      S(h.hunt, { onClose: true, close: 4, onHurt: true, speed: 1.5, duration: 15, after: 'vanish', leap: false });
    },
  },
  watcher: {
    label: 'Watcher', icon: '🕴', blurb: 'Stands far off and just watches. Stare too long and it\'s gone. Only fights back if hit.',
    apply: (h) => {
      S(h.senses, { seen: 'vanish', detect: 48, seenRange: 64, fov: 16, lookTime: 1.5 });
      S(h.stalk, { on: true, keep: 28, speed: 0.6, huntAfter: 0 });
      S(h.hunt, { onClose: false, onHurt: true, speed: 1.4, duration: 12, after: 'vanish', leap: false });
    },
  },
  statue: {
    label: 'Statue', icon: '🗿', blurb: 'Frozen while you look at it. The moment you look away, it moves, fast.',
    apply: (h) => {
      S(h.senses, { seen: 'freeze', detect: 24, seenRange: 40, fov: 70, lookTime: 0 });
      S(h.stalk, { on: false });
      S(h.hunt, { onClose: false, onHurt: true, speed: 2.2, duration: 60, after: 'dormant', leap: false });
      S(h.scares, { scream: false, shake: false, fog: false, darkness: false, seenSound: 'mob.creaking.freeze', notice: 'Don\'t blink.' });
      h.weakness.sunlight = 'none';
    },
  },
  crawler: {
    label: 'Ambusher', icon: '🕷', blurb: 'Waits on walls and ceilings and lunges the instant you look at it.',
    apply: (h) => {
      S(h.senses, { seen: 'charge', detect: 28, seenRange: 32, lookTime: 0.6 });
      S(h.stalk, { on: true, keep: 10, speed: 1, huntAfter: 40 });
      S(h.hunt, { onClose: true, close: 5, speed: 1.9, duration: 20, after: 'stalk', leap: true });
      h.traits.climb = true;
    },
  },
  shade: {
    label: 'Shade', icon: '🌫', blurb: 'Smothers you in darkness and fog, then vanishes when you look straight at it.',
    apply: (h) => {
      S(h.senses, { seen: 'vanish', detect: 36, seenRange: 40, lookTime: 0.8 });
      S(h.stalk, { on: true, keep: 18, speed: 0.7, huntAfter: 45 });
      S(h.hunt, { onClose: true, close: 7, speed: 1.4, duration: 15, after: 'vanish', leap: false });
      S(h.scares, { darkness: true, fog: true, fogDistance: 14, screamSound: 'mob.ghast.moan', notice: 'The air goes cold.' });
    },
  },
  shadow: {
    label: 'Blinker', icon: '⚡', blurb: 'Blinks to a new spot every time you look, always a little closer, until it pounces.',
    apply: (h) => {
      S(h.senses, { seen: 'teleport', detect: 36, seenRange: 48, fov: 30, lookTime: 0.3 });
      S(h.stalk, { on: true, keep: 8, speed: 1.0, huntAfter: 50 });
      S(h.hunt, { onClose: true, close: 4, speed: 1.8, duration: 18, after: 'stalk', leap: false });
    },
  },
  mimic: {
    label: 'Mimic', icon: '🎭', blurb: 'Acts like a harmless villager (and sounds like one) until you get too close.',
    apply: (h) => {
      S(h.senses, { seen: 'none', detect: 12 });
      S(h.stalk, { on: false });
      S(h.hunt, { onClose: true, close: 4, speed: 1.7, duration: 20, after: 'dormant', leap: false });
      S(h.scares, { heartbeat: false, notice: '', huntMsg: 'That\'s not a villager.', screamSound: 'mob.warden.roar' });
      h.weakness.sunlight = 'none';
    },
  },
  screamer: {
    label: 'Screamer', icon: '😱', blurb: 'Stands still in the distance. Meet its gaze and it shrieks and sprints at you.',
    apply: (h) => {
      S(h.senses, { seen: 'charge', detect: 48, seenRange: 64, lookTime: 1.2, fov: 18 });
      S(h.stalk, { on: false });
      S(h.hunt, { onClose: true, close: 8, speed: 2.4, duration: 12, after: 'vanish', leap: false });
      S(h.scares, { screamSound: 'mob.ghast.scream', shake: true, huntMsg: '' });
    },
  },
  hunter: {
    label: 'Relentless', icon: '🩸', blurb: 'No games: the moment it notices you, it hunts, and it doesn\'t give up easily.',
    apply: (h) => {
      S(h.senses, { seen: 'none', detect: 40 });
      S(h.stalk, { on: false });
      S(h.hunt, { onClose: true, close: 12, onHurt: true, speed: 1.7, duration: 60, after: 'dormant', leap: true });
    },
  },
};

export const hProp = (ns) => `${ns}:horror_state`;
export const hGroup = (ns, s) => `${ns}:horror_${s}`;
export const hEvent = (ns, s) => `${ns}:horror_${s}`;
export const fogId = (ns, name) => `${ns}:${name}_dread`;
const fogTag = (ns, name) => `${ns}_${name}_dread`;
export const HORROR_GROUP_KEYS = ['mobile', 'frozen', 'dormant', 'stalking', 'hunting', 'fleeing', 'teleporting', 'gone', 'arrive', 'lifetime'];
export const HORROR_EVENT_KEYS = ['notice', 'hunt', 'seen', 'unseen', 'give_up', 'lose', 'regroup', 'sunlight', 'arrive', 'settle', 'leave'];

const isPlayer = { test: 'is_family', subject: 'other', value: 'player' };
const notCreative = { test: 'has_ability', subject: 'other', operator: 'not', value: 'instabuild' };
const stateIs = (ns, v) => ({ test: 'enum_property', subject: 'self', domain: hProp(ns), value: v });
const stateNot = (ns, v) => ({ test: 'enum_property', subject: 'self', domain: hProp(ns), operator: 'not', value: v });
// Light sources it smashes while hunting (Bedrock block ids).
export const LIGHTS = ['minecraft:torch', 'minecraft:soul_torch', 'minecraft:redstone_torch', 'minecraft:copper_torch', 'minecraft:underwater_torch',
  'minecraft:lantern', 'minecraft:soul_lantern', 'minecraft:copper_lantern', 'minecraft:candle', 'minecraft:lit_pumpkin', 'minecraft:sea_lantern', 'minecraft:glowstone'];
const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/[^\S ]/g, ' ').trim();

export const SCARE_TYPES = [
  ['scream', 'Scream', '😱'], ['heartbeat', 'Heartbeat', '💓'], ['stare', 'Stare sound', '👁'], ['message', 'Message', '💬'],
  ['darkness', 'Darkness', '🌑'], ['shake', 'Camera shake', '📳'], ['fog', 'Dread fog', '🌫'], ['particles', 'Soul particles', '✨'],
];

/** Which scares play at each moment (from the node board, or derived from the toggles). */
export function scareMoments(h) {
  if (h.moments) return h.moments;
  const s = h.scares;
  const notice = [], seen = [], hunt = [];
  if (s.messages && clean(s.notice)) notice.push('message');
  if (s.heartbeat) notice.push('heartbeat');
  if (s.seenSound) seen.push('stare');
  if (s.messages && clean(s.seenMsg)) seen.push('message');
  for (const k of ['scream', 'shake', 'darkness']) if (s[k]) hunt.push(k);
  if (s.messages && clean(s.huntMsg)) hunt.push('message');
  if (s.fog) hunt.push('fog');
  if (s.particles) hunt.push('particles');
  return { notice, seen, hunt };
}

function commands(ns, name, h) {
  const s = h.scares, R = Math.round(h.senses.detect), SR = Math.round(h.senses.seenRange);
  const fog = `${fogId(ns, name)} ${fogTag(ns, name)}`;
  const moments = scareMoments(h);
  const msgFor = { notice: s.notice, seen: s.seenMsg, hunt: s.huntMsg };
  const style = { notice: '§7§o', seen: '§7', hunt: '§4§l' };
  const build = (moment) => {
    const r = moment === 'seen' ? SR : moment === 'hunt' ? R + 16 : R;
    const out = [];
    for (const k of moments[moment] || []) {
      if (k === 'scream' && s.screamSound) out.push(`playsound ${s.screamSound} @a[r=${r}] ~ ~ ~ 2 0.7`);
      if (k === 'heartbeat' && s.heartbeatSound) out.push(`playsound ${s.heartbeatSound} @a[r=${r}] ~ ~ ~ 1 1`);
      if (k === 'stare' && s.seenSound) out.push(`playsound ${s.seenSound} @a[r=${r}] ~ ~ ~ 1 0.8`);
      if (k === 'message' && clean(msgFor[moment])) out.push(`title @a[r=${r}] actionbar ${style[moment]}${clean(msgFor[moment])}`);
      if (k === 'darkness') out.push('effect @a[r=20] darkness 8 0 true');
      if (k === 'shake') out.push('camerashake add @a[r=20] 0.5 1.5 positional');
      if (k === 'fog') out.push(`fog @a[r=${R + 16}] push ${fog}`);
      if (k === 'particles') out.push('particle minecraft:sculk_soul_particle ~ ~1.5 ~');
    }
    return out;
  };
  const usesFog = Object.values(moments).some((l) => l.includes('fog'));
  const calm = usesFog ? [`fog @a[r=${R * 3}] remove ${fogTag(ns, name)}`] : [];
  const vanish = ['particle minecraft:basic_smoke_particle ~ ~1 ~', 'particle minecraft:soul_particle ~ ~1.5 ~', 'playsound mob.endermen.portal @a[r=16] ~ ~ ~ 0.7 0.5', ...calm];
  const qc = (list) => (list.length ? { queue_command: { command: list } } : {});
  return { notice: qc(build('notice')), hunt: qc(build('hunt')), seen: qc(build('seen')), calm: qc(calm), vanish: qc(vanish), usesFog };
}

/** Group, event and property names this entity's horror AI will export. */
export function horrorNames(ns, h) {
  if (!h?.enabled) return { groups: [], events: [] };
  return { groups: HORROR_GROUP_KEYS.map((k) => hGroup(ns, k)), events: HORROR_EVENT_KEYS.map((k) => hEvent(ns, k)) };
}

function mergeTriggers(existing, extra) {
  if (!existing) return extra;
  return [...(Array.isArray(existing) ? existing : [existing]), ...extra];
}

/** Filter that is true when the dweller is somewhere it isn't allowed to be. */
function habitatFail(h) {
  const notUnder = { test: 'is_underground', value: false };
  const under = { test: 'is_underground', value: true };
  const day = { test: 'is_daytime', value: true };
  const surfaceByDay = h.time === 'night' ? [{ all_of: [notUnder, day] }] : [];
  if (h.type === 'underground') return notUnder;
  if (h.type === 'surface') return { any_of: [under, ...surfaceByDay] };
  return surfaceByDay.length ? surfaceByDay[0] : null;
}

export const directorObjective = (ns, name) => `ms${(hashStr(`${ns}:${name}`) % 1e7).toString(36)}`;

/**
 * Compiles the horror config into the (already cloned) entity output.
 * Mutates components/groups/events/properties; returns extra RP files and
 * the director spec used to build functions.
 */
export function compileHorror({ ns, name, h, components, groups, events, properties, notes }) {
  h = migrateHorror(h);
  const se = h.senses, st = h.stalk, hu = h.hunt, tr = h.traits, wk = h.weakness, ap = h.appear;
  const G = (k) => hGroup(ns, k), E = (k) => hEvent(ns, k), P = hProp(ns);
  const cmd = commands(ns, name, h);
  const speed = Number(components['minecraft:movement']?.value) || 0.3;
  const detect = Math.max(4, Number(se.detect) || 32), lose = Math.max(detect + 8, Number(se.lose) || detect * 2);
  const players = { all_of: [isPlayer, notCreative] };

  // ---- State groups ----
  const g = {};
  g.mobile = { 'minecraft:movement': { value: speed } };
  if (se.seen === 'freeze') g.frozen = { 'minecraft:movement': { value: 0 }, 'minecraft:body_rotation_blocked': {} };
  g.dormant = {
    'minecraft:behavior.random_stroll': { priority: 6, speed_multiplier: 0.6, xz_dist: 12 },
    'minecraft:behavior.look_at_player': { priority: 7, look_distance: detect, probability: 0.05 },
  };
  if (st.on) {
    g.stalking = {
      'minecraft:behavior.nearest_attackable_target': { priority: 1, must_see: false, reselect_targets: true, within_radius: detect, entity_types: [{ filters: players, max_dist: detect }] },
      'minecraft:behavior.avoid_mob_type': { priority: 2, ignore_visibility: true, entity_types: [{ filters: players, max_dist: Math.max(3, Number(st.keep) || 12), walk_speed_multiplier: 1.1, sprint_speed_multiplier: 1.3 }] },
      'minecraft:behavior.move_towards_target': { priority: 3, speed_multiplier: Number(st.speed) || 0.85, within_radius: detect },
      'minecraft:behavior.look_at_target': { priority: 4, look_distance: detect, probability: 1 },
    };
    if (h.scares.darkness) g.stalking['minecraft:mob_effect'] = { effect_range: Math.max(6, (Number(st.keep) || 12) + 6), mob_effect: 'darkness', effect_time: 4, cooldown_time: 20, entity_filter: players };
    if (Number(st.huntAfter) > 0) {
      const t = Number(st.huntAfter);
      g.stalking['minecraft:timer'] = { looping: false, randomInterval: true, time: { min: Math.round(t * 0.7), max: Math.round(t * 1.3) }, time_down_event: { event: E('hunt'), target: 'self' } };
    }
  }
  g.hunting = {
    'minecraft:behavior.nearest_attackable_target': { priority: 1, must_see: false, reselect_targets: true, within_radius: lose, entity_types: [{ filters: players, max_dist: lose }] },
    'minecraft:behavior.melee_box_attack': { priority: 2, speed_multiplier: Number(hu.speed) || 1.5, cooldown_time: 1 },
    'minecraft:timer': { looping: false, randomInterval: false, time: { min: Number(hu.duration) || 20, max: Number(hu.duration) || 20 }, time_down_event: { event: E('give_up'), target: 'self' } },
  };
  if (hu.leap) g.hunting['minecraft:behavior.leap_at_target'] = { priority: 3, yd: 0.5, must_be_on_ground: true };
  if (tr.breakDoors) g.hunting['minecraft:behavior.break_door'] = { priority: 3 };
  if (h.scares.darkness) g.hunting['minecraft:mob_effect'] = { effect_range: 16, mob_effect: 'darkness', effect_time: 6, cooldown_time: 6, entity_filter: players };
  if (tr.breakLights) g.hunting['minecraft:break_blocks'] = { breakable_blocks: LIGHTS };
  if (se.seen === 'flee') {
    g.fleeing = {
      'minecraft:behavior.avoid_mob_type': { priority: 1, ignore_visibility: true, entity_types: [{ filters: players, max_dist: detect, walk_speed_multiplier: 1.5, sprint_speed_multiplier: 1.9 }] },
      'minecraft:behavior.random_stroll': { priority: 5, speed_multiplier: 1.2, xz_dist: 16 },
      'minecraft:timer': { looping: false, randomInterval: true, time: { min: 5, max: 9 }, time_down_event: { event: E('regroup'), target: 'self' } },
    };
  }
  if (se.seen === 'teleport') {
    g.teleporting = {
      'minecraft:teleport': { random_teleports: true, min_random_teleport_time: 0, max_random_teleport_time: 0.3, random_teleport_cube: [Math.max(8, (Number(st.keep) || 10) * 2), 8, Math.max(8, (Number(st.keep) || 10) * 2)], target_teleport_chance: 0, light_teleport_chance: 1, dark_teleport_chance: 1 },
      'minecraft:timer': { looping: false, randomInterval: false, time: { min: 1.5, max: 1.5 }, time_down_event: { event: E('regroup'), target: 'self' } },
    };
  }
  g.gone = { 'minecraft:instant_despawn': {} };
  // Arrival (director): invisible while it teleports to a valid spot and checks its habitat.
  const cube = { near: 24, medium: 40, far: 64 }[ap.distance] || 40;
  g.arrive = {
    'minecraft:teleport': { random_teleports: true, min_random_teleport_time: 0, max_random_teleport_time: 0.2, random_teleport_cube: [cube, 16, cube], target_teleport_chance: 0, light_teleport_chance: 1, dark_teleport_chance: 1 },
    'minecraft:timer': { looping: false, randomInterval: false, time: { min: 1.2, max: 1.2 }, time_down_event: { event: E('settle'), target: 'self' } },
  };
  const leaveSec = Math.round((Number(ap.leaveAfter) || 0) * 60);
  if (leaveSec > 0) {
    g.lifetime = { 'minecraft:behavior.timer_flag_3': { priority: 0, cooldown_range: { min: 20, max: 20 }, duration_range: { min: leaveSec, max: leaveSec }, on_end: { event: E('leave'), target: 'self' } } };
  }

  const managed = new Set(Object.values(g).flatMap((c) => Object.keys(c)));
  const stripped = Object.keys(components).filter((id) => managed.has(id));
  for (const id of stripped) delete components[id];
  if (stripped.length) notes.push(`Dweller AI moved ${stripped.length} base component(s) into its state groups: ${stripped.join(', ')}`);
  for (const [k, c] of Object.entries(g)) groups[G(k)] = c;

  // ---- Base components ----
  if (!Object.keys(components).some((id) => id.startsWith('minecraft:movement.'))) components['minecraft:movement.basic'] = {};
  if (!components['minecraft:jump.static']) components['minecraft:jump.static'] = {};
  if (!components['minecraft:physics']) components['minecraft:physics'] = {};
  if (!components['minecraft:behavior.float']) components['minecraft:behavior.float'] = { priority: 0 };
  let navId = Object.keys(components).find((id) => id.startsWith('minecraft:navigation.'));
  if (tr.climb) {
    if (navId && navId !== 'minecraft:navigation.climb') { components['minecraft:navigation.climb'] = components[navId]; delete components[navId]; }
    navId = 'minecraft:navigation.climb';
    components['minecraft:can_climb'] = {};
  }
  navId ||= 'minecraft:navigation.walk';
  components[navId] = { can_path_over_water: true, avoid_water: true, avoid_damage_blocks: true, ...(components[navId] || {}), ...(tr.breakDoors ? { can_break_doors: true, can_pass_doors: true } : {}) };
  if (tr.breakDoors) components['minecraft:annotation.break_door'] = { break_time: 4, min_difficulty: 'easy' };
  components['minecraft:attack'] = { ...(components['minecraft:attack'] || {}), damage: Number(hu.damage) || 6 };
  components['minecraft:follow_range'] = { value: Math.max(lose, 32) };
  const fam = (components['minecraft:type_family'] ||= { family: [name, 'mob'] }).family;
  for (const f of ['monster', 'horror']) if (!fam.includes(f)) fam.push(f);
  // Big bodies can't fit caves (2-block tunnels): keep the hitbox walkable.
  const cb = components['minecraft:collision_box'];
  if (cb && h.type !== 'surface') {
    if (cb.height > 1.9) { notes.push(`Hitbox height ${cb.height} → 1.9 so it fits 2-block cave tunnels (model stays tall)`); cb.height = 1.9; }
    if (cb.width > 0.9) { notes.push(`Hitbox width ${cb.width} → 0.9 so it fits 1-block tunnels`); cb.width = 0.9; }
  }

  // Sensors never test the dweller's own state; the events do that.
  const subs = [
    { event: E('notice'), range: [detect, 16], minimum_count: 1, cooldown: 1, event_filters: players },
    { event: E('lose'), range: [lose, 32], minimum_count: 0, maximum_count: 0, cooldown: 4, event_filters: players },
  ];
  if (hu.onClose) subs.push({ event: E('hunt'), range: [Math.max(2, Number(hu.close) || 6), 6], minimum_count: 1, cooldown: 1, event_filters: players });
  const es = components['minecraft:entity_sensor'] || {};
  components['minecraft:entity_sensor'] = { ...es, relative_range: false, subsensors: [...(es.subsensors || []), ...subs] };

  if (se.seen !== 'none') {
    const la = {
      search_radius: Number(se.seenRange) || 40,
      find_players_only: true,
      set_target: 'never',
      field_of_view: Number(se.fov) || 30,
      scale_fov_by_distance: false,
      line_of_sight_obstruction_type: 'collision_for_camera',
      look_at_locations: [{ location: 'head' }, { location: 'body' }, { location: 'feet', vertical_offset: 0.5 }],
      looked_at_cooldown: 0.1,
      looked_at_event: { event: E('seen'), target: 'self' },
    };
    if (Number(se.lookTime) > 0) la.min_looked_at_duration = Number(se.lookTime);
    if (se.seen === 'freeze') la.not_looked_at_event = { event: E('unseen'), target: 'self' };
    if (se.pumpkinSafe) la.filters = { test: 'has_equipment', domain: 'head', subject: 'other', operator: 'not', value: 'carved_pumpkin' };
    components['minecraft:looked_at'] = la;
  }
  if (hu.onHurt && !components['minecraft:on_hurt_by_player']) components['minecraft:on_hurt_by_player'] = { event: E('hunt'), target: 'self' };

  const dmg = [];
  if (tr.noFall) dmg.push({ cause: 'fall', deals_damage: 'no' });
  if (wk.fire) dmg.push({ cause: 'fire', damage_multiplier: 2.5 }, { cause: 'fire_tick', damage_multiplier: 2.5 });
  if (dmg.length) {
    const ds = components['minecraft:damage_sensor'] || {};
    components['minecraft:damage_sensor'] = { ...ds, triggers: mergeTriggers(ds.triggers, dmg) };
  }
  if (wk.sunlight === 'burn') components['minecraft:burns_in_daylight'] = {};
  if (wk.sunlight === 'vanish') {
    const env = components['minecraft:environment_sensor'] || {};
    components['minecraft:environment_sensor'] = { ...env, triggers: mergeTriggers(env.triggers, [{
      filters: { all_of: [{ test: 'is_daytime', value: true }, { test: 'is_underground', value: false }, { test: 'is_underwater', value: false }] },
      event: E('sunlight'),
    }]) };
  }

  properties[P] = { type: 'enum', values: HORROR_STATES, default: 'dormant', client_sync: true };

  // ---- Events ----
  const all = (keys) => keys.filter((k) => g[k]).map(G);
  const moving = ['dormant', 'stalking', 'hunting', 'fleeing', 'teleporting', 'frozen', 'arrive'];
  const goTo = (state, extra = {}) => {
    const groupFor = { dormant: ['mobile', 'dormant'], stalking: ['mobile', 'stalking'], hunting: ['mobile', 'hunting'], fleeing: ['mobile', se.seen === 'teleport' ? 'teleporting' : 'fleeing'], frozen: ['frozen'], gone: ['gone'] }[state];
    const keep = new Set(groupFor);
    return {
      remove: { component_groups: all(['mobile', ...moving].filter((k) => !keep.has(k))) },
      add: { component_groups: all(groupFor) },
      set_property: { [P]: state },
      ...extra,
    };
  };
  const step = (filters, body) => (filters ? { filters, ...body } : { ...body });
  const life = g.lifetime ? [G('lifetime')] : [];
  const spawnAction = { add: { component_groups: [...all(['mobile', 'dormant']), ...life] }, set_property: { [P]: 'dormant' } };
  events['minecraft:entity_spawned'] = events['minecraft:entity_spawned'] ? { sequence: [events['minecraft:entity_spawned'], spawnAction] } : spawnAction;
  // Director arrival: hidden, teleport, then settle (or quietly leave and retry soon).
  events[E('arrive')] = { add: { component_groups: [G('arrive')] }, set_property: { [P]: 'arriving' } };
  const fail = habitatFail(h);
  const obj = directorObjective(ns, name);
  const retry = Math.max(0, Math.round(Number(ap.every?.[0] || 6) * 60) - 60);
  const settleOk = { remove: { component_groups: [G('arrive')] }, add: { component_groups: [...all(['mobile', 'dormant']), ...life] }, set_property: { [P]: 'dormant' } };
  events[E('settle')] = { sequence: fail ? [
    step(fail, { remove: { component_groups: [G('arrive')] }, add: { component_groups: [G('gone')] }, set_property: { [P]: 'gone' }, queue_command: { command: [`scoreboard players set @p[r=96] ${obj} ${retry}`] } }),
    step({ none_of: [fail] }, settleOk),
  ] : [settleOk] };
  const noticeMode = st.on ? 'stalk' : h.notice === 'none' ? 'none' : 'hunt';
  const noticeBody = noticeMode === 'stalk' ? goTo('stalking', cmd.notice) : noticeMode === 'hunt' ? { trigger: E('hunt'), ...cmd.notice } : { ...cmd.notice };
  events[E('notice')] = { sequence: [step(stateIs(ns, 'dormant'), noticeBody)] };
  events[E('hunt')] = { sequence: [step({ all_of: [stateNot(ns, 'hunting'), stateNot(ns, 'gone'), stateNot(ns, 'frozen'), stateNot(ns, 'arriving')] }, goTo('hunting', cmd.hunt))] };
  const seenStates = { any_of: [stateIs(ns, 'stalking'), stateIs(ns, 'dormant')] };
  const seen = {
    flee: [step(stateIs(ns, 'stalking'), goTo('fleeing', cmd.seen))],
    freeze: [step({ any_of: [stateIs(ns, 'stalking'), stateIs(ns, 'hunting')] }, goTo('frozen', cmd.seen))],
    vanish: [step(seenStates, goTo('gone', merge(cmd.seen, cmd.vanish)))],
    teleport: [step(stateIs(ns, 'stalking'), goTo('fleeing', merge(cmd.seen, { queue_command: { command: ['particle minecraft:basic_portal_particle ~ ~1 ~', 'playsound mob.endermen.portal @a[r=16] ~ ~ ~ 1 0.6'] } })))],
    charge: [step(seenStates, { ...cmd.seen, trigger: E('hunt') })],
    stare: [step(stateIs(ns, 'stalking'), { ...cmd.seen })],
  }[se.seen];
  if (seen) events[E('seen')] = { sequence: seen };
  if (se.seen === 'freeze') events[E('unseen')] = { sequence: [step(stateIs(ns, 'frozen'), goTo('hunting'))] };
  const after = hu.after === 'vanish' ? goTo('gone', merge(cmd.calm, cmd.vanish)) : goTo(hu.after === 'dormant' || !st.on ? 'dormant' : 'stalking', cmd.calm);
  events[E('give_up')] = { sequence: [step(stateIs(ns, 'hunting'), after)] };
  events[E('lose')] = { sequence: [step({ none_of: [stateIs(ns, 'dormant'), stateIs(ns, 'gone'), stateIs(ns, 'arriving')] }, goTo('dormant', cmd.calm))] };
  if (g.fleeing || g.teleporting) events[E('regroup')] = { sequence: [step(stateIs(ns, 'fleeing'), goTo(st.on ? 'stalking' : 'dormant'))] };
  if (wk.sunlight === 'vanish') events[E('sunlight')] = { sequence: [step({ all_of: [stateNot(ns, 'gone'), stateNot(ns, 'arriving')] }, goTo('gone', merge(cmd.calm, cmd.vanish)))] };
  if (g.lifetime) events[E('leave')] = { sequence: [step({ any_of: [stateIs(ns, 'dormant'), stateIs(ns, 'stalking'), stateIs(ns, 'fleeing')] }, goTo('gone', merge(cmd.calm, cmd.vanish)))] };
  for (const ev of Object.values(events)) pruneEmpty(ev);

  notes.push(`Dweller AI → property ${P}, ${Object.keys(g).length} state groups, ${Object.keys(events).filter((k) => k.includes(':horror_')).length} events, entity sensor${se.seen !== 'none' ? ', looked_at' : ''}`);
  const files = [];
  if (cmd.usesFog) {
    const fogAir = { fog_start: 0, fog_end: Math.max(6, Number(h.scares.fogDistance) || 20), fog_color: h.scares.fogColor || '#08080c', render_distance_type: 'fixed' };
    files.push({
      path: `fogs/${name}_dread.json`,
      json: { format_version: '1.16.100', 'minecraft:fog_settings': { description: { identifier: fogId(ns, name) }, distance: { air: fogAir, weather: { ...fogAir } } } },
    });
    notes.push(`Dread fog ${fogId(ns, name)} pushed onto nearby players while it hunts`);
  }
  return { files, director: ap.director ? { name, objective: obj, ap: clone(ap) } : null };
}

function merge(a, b) {
  const ca = a.queue_command?.command || [], cb = b.queue_command?.command || [];
  return ca.length + cb.length ? { queue_command: { command: [...ca, ...cb] } } : {};
}
function pruneEmpty(a) {
  if (!isObj(a)) return;
  for (const k of ['add', 'remove']) if (isObj(a[k]) && Array.isArray(a[k].component_groups) && !a[k].component_groups.length) delete a[k];
  for (const k of ['randomize', 'sequence']) if (Array.isArray(a[k])) a[k].forEach(pruneEmpty);
}

/** Natural spawn conditions for a dweller type. */
export function dwellerSpawn(h) {
  h = migrateHorror(h);
  const weight = RARITY[h.appear.rarity] || 20;
  const base = () => ({
    'minecraft:difficulty_filter': { min: 'easy', max: 'hard' },
    'minecraft:weight': { default: weight },
    'minecraft:herd': { min_size: 1, max_size: 1 },
  });
  const caves = { 'minecraft:spawns_underground': {}, 'minecraft:brightness_filter': { min: 0, max: 5, adjust_for_weather: false }, 'minecraft:height_filter': { min: -64, max: 56 }, ...base() };
  const surface = { 'minecraft:spawns_on_surface': {}, 'minecraft:brightness_filter': { min: 0, max: h.time === 'night' ? 7 : 15, adjust_for_weather: true }, ...base(), 'minecraft:biome_filter': { test: 'has_biome_tag', value: 'monster' } };
  if (h.type === 'underground') return [caves];
  if (h.type === 'surface') return [surface];
  return [caves, surface];
}
/** @deprecated kept for 1.1 projects */
export const habitatSpawn = (habitat) => dwellerSpawn({ type: habitat.where === 'caves' ? 'underground' : habitat.where === 'anywhere' ? 'both' : 'surface', time: 'night', appear: { rarity: habitat.rarity } });

/**
 * Behavior-pack functions for the appearance director.
 * Runs every tick via functions/tick.json; does work once per second.
 */
export function directorFunctions(ns, project, directors) {
  if (!directors.length) return [];
  const clock = `ms_clock_${(hashStr(ns) % 1e6).toString(36)}`;
  const roll = `ms_roll_${(hashStr(ns) % 1e6).toString(36)}`;
  const initTag = `${ns}_dweller_init`;
  const files = [];
  const second = [
    `scoreboard players set #clock ${clock} 0`,
    `scoreboard objectives add ${roll} dummy`,
    ...directors.map((d) => `scoreboard objectives add ${d.objective} dummy`),
    `execute as @a[tag=!${initTag}] run function ${ns}/dwellers/init_player`,
  ];
  const init = [];
  for (const d of directors) {
    const id = `${ns}:${d.name}`;
    const minS = Math.max(30, Math.round(Number(d.ap.every?.[0] || 6) * 60));
    const maxS = Math.max(minS, Math.round(Number(d.ap.every?.[1] || d.ap.every?.[0] || 6) * 60));
    const first = Math.max(10, Math.round(Number(d.ap.firstAfter ?? 3) * 60));
    const chance = Math.max(1, Math.min(100, Math.round(Number(d.ap.chance) || 100)));
    const near = { near: 10, medium: 16, far: 24 }[d.ap.distance] || 16;
    init.push(`scoreboard players set @s ${d.objective} ${minS - first}`);
    second.push(`scoreboard players add @a ${d.objective} 1`);
    second.push(`execute as @a[scores={${d.objective}=${minS}..}] at @s run function ${ns}/dwellers/${d.name}`);
    // With a limit, count the copies first and only summon while there's room.
    const guard = d.max ? `if score #n ${roll} matches ..${d.max - 1} ` : '';
    files.push({ path: `functions/${ns}/dwellers/${d.name}.mcfunction`, data: [
      `# Appearance roll for ${id}: every ${minS}-${maxS}s, ${chance}% chance${d.max === 1 ? ', only when none exists yet' : d.max ? `, only while fewer than ${d.max} exist` : ''}.`,
      `scoreboard players random @s ${d.objective} ${minS - maxS} 0`,
      `scoreboard players random @s ${roll} 1 100`,
      ...(d.max ? [`scoreboard players set #n ${roll} 0`, `execute as @e[type=${id}] run scoreboard players add #n ${roll} 1`] : []),
      `execute if score @s ${roll} matches 1..${chance} ${guard}run summon ${id} ^ ^ ^-${near} ~ ~ ${hEvent(ns, 'arrive')}`,
      '',
    ].join('\n') });
  }
  init.push(`tag @s add ${initTag}`);
  files.push({ path: `functions/${ns}/dwellers/second.mcfunction`, data: second.join('\n') + '\n' });
  files.push({ path: `functions/${ns}/dwellers/init_player.mcfunction`, data: init.join('\n') + '\n' });
  files.push({ path: `functions/${ns}/dwellers/tick.mcfunction`, data: [
    `scoreboard objectives add ${clock} dummy`,
    `scoreboard players add #clock ${clock} 1`,
    `execute if score #clock ${clock} matches 20.. run function ${ns}/dwellers/second`,
    '',
  ].join('\n') });
  return files;
}
