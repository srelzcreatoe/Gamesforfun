// Horror dwellers: a configurable "stalker" AI that compiles into standard
// Bedrock entity data at export time. The pattern mirrors how vanilla builds
// state-driven mobs (an enum property + mutually exclusive component groups +
// sensors firing filtered events):
//
//   dormant ──notice──▶ stalking ──too close / timer / hurt──▶ hunting
//      ▲                  │  ▲                                   │
//      │                  │  └──────── regroup ◀── fleeing ◀─seen┤
//      └──── lose ◀───────┴─── give up (stalk | dormant | gone) ◀┘
//   seen reactions: flee · freeze (moves only when unseen) · vanish · teleport · charge · stare
import { clone, isObj } from './util.js';

export const HORROR_STATES = ['dormant', 'stalking', 'hunting', 'fleeing', 'frozen', 'gone'];

export const SEEN_REACTIONS = [
  ['none', 'Ignore it', 'Doesn\'t care if you look at it.'],
  ['flee', 'Flee', 'Bolts into the dark when you spot it, then comes back.'],
  ['freeze', 'Freeze', 'Can only move while nobody is looking at it.'],
  ['vanish', 'Vanish', 'Disappears in a puff of smoke when you spot it.'],
  ['teleport', 'Blink away', 'Teleports somewhere nearby when you spot it.'],
  ['charge', 'Charge', 'Looking at it makes it attack immediately.'],
  ['stare', 'Stare back', 'Just stares… and plays a sound.'],
];
export const AFTER_HUNT = [['stalk', 'Go back to stalking'], ['dormant', 'Lose interest (dormant)'], ['vanish', 'Vanish']];
export const HABITATS = [
  ['caves', 'Deep caves', 'Underground, in total darkness'],
  ['night', 'Surface at night', 'Anywhere outside after dark'],
  ['forest', 'Dark forests', 'Forests and taigas at night'],
  ['anywhere', 'Any dark place', 'Caves and the surface at night'],
];
export const RARITY = { rare: 2, uncommon: 6, common: 15 };

export function defaultHorror() {
  return {
    enabled: false,
    archetype: 'stalker',
    senses: { detect: 32, lose: 64, seen: 'flee', seenRange: 48, fov: 24, lookTime: 0.4, pumpkinSafe: true },
    stalk: { on: true, keep: 14, speed: 0.85, huntAfter: 60 },
    hunt: { onClose: true, close: 6, onHurt: true, speed: 1.6, damage: 8, duration: 25, after: 'stalk', leap: false },
    scares: {
      darkness: true, heartbeat: true, scream: true, shake: true, fog: true, messages: true, particles: true,
      screamSound: 'mob.warden.roar', heartbeatSound: 'mob.warden.heartbeat', seenSound: 'mob.endermen.stare',
      notice: 'You feel watched...', huntMsg: 'RUN.', seenMsg: '', fogColor: '#08080c', fogDistance: 20,
    },
    traits: { breakLights: true, breakDoors: true, climb: false, noFall: true },
    weakness: { sunlight: 'vanish', fire: true },
    habitat: { where: 'caves', rarity: 'rare' },
  };
}

// Archetypes only set behaviour; presets.js adds bodies, textures and sounds.
export const ARCHETYPES = {
  stalker: {
    label: 'Stalker', icon: '👁', blurb: 'Watches from the edge of your torchlight, flees when spotted, hunts when you get close or after a while.',
    apply: (h) => {
      Object.assign(h.senses, { seen: 'flee', detect: 32, seenRange: 48 });
      Object.assign(h.stalk, { on: true, keep: 14, speed: 0.85, huntAfter: 60 });
      Object.assign(h.hunt, { onClose: true, close: 6, speed: 1.6, duration: 25, after: 'stalk', leap: false });
    },
  },
  statue: {
    label: 'Still one', icon: '🗿', blurb: 'Frozen while you look at it. The moment you look away, it moves, fast.',
    apply: (h) => {
      Object.assign(h.senses, { seen: 'freeze', detect: 24, seenRange: 40, fov: 70, lookTime: 0 });
      Object.assign(h.stalk, { on: false });
      Object.assign(h.hunt, { onClose: false, speed: 2.2, duration: 60, after: 'dormant', leap: false });
      Object.assign(h.scares, { heartbeat: true, scream: false, shake: false, fog: false, darkness: false, seenSound: 'mob.creaking.freeze', notice: 'Don\'t blink.' });
      h.weakness.sunlight = 'none';
    },
  },
  crawler: {
    label: 'Crawler', icon: '🕷', blurb: 'Skitters along walls and ceilings and lunges the instant you look at it.',
    apply: (h) => {
      Object.assign(h.senses, { seen: 'charge', detect: 28, seenRange: 32, lookTime: 0.6 });
      Object.assign(h.stalk, { on: true, keep: 10, speed: 1, huntAfter: 40 });
      Object.assign(h.hunt, { onClose: true, close: 5, speed: 1.9, duration: 20, after: 'stalk', leap: true });
      h.traits.climb = true;
    },
  },
  shade: {
    label: 'Shade', icon: '🌫', blurb: 'A drifting shadow that smothers you in darkness and fog, then vanishes when you look.',
    apply: (h) => {
      Object.assign(h.senses, { seen: 'vanish', detect: 36, seenRange: 40, lookTime: 0.8 });
      Object.assign(h.stalk, { on: true, keep: 18, speed: 0.7, huntAfter: 45 });
      Object.assign(h.hunt, { onClose: true, close: 7, speed: 1.4, duration: 15, after: 'vanish', leap: false });
      Object.assign(h.scares, { darkness: true, fog: true, fogDistance: 14, screamSound: 'mob.ghast.moan', notice: 'The air goes cold.' });
    },
  },
  mimic: {
    label: 'Mimic', icon: '🎭', blurb: 'Acts like a harmless villager (and sounds like one) until you get too close.',
    apply: (h) => {
      Object.assign(h.senses, { seen: 'none', detect: 12 });
      Object.assign(h.stalk, { on: false });
      Object.assign(h.hunt, { onClose: true, close: 4, speed: 1.7, duration: 20, after: 'dormant', leap: false });
      Object.assign(h.scares, { heartbeat: false, notice: '', huntMsg: 'That\'s not a villager.', screamSound: 'mob.warden.roar' });
      h.weakness.sunlight = 'none';
    },
  },
  screamer: {
    label: 'Screamer', icon: '😱', blurb: 'Stands still in the distance. Look at it and it shrieks and sprints at you.',
    apply: (h) => {
      Object.assign(h.senses, { seen: 'charge', detect: 48, seenRange: 64, lookTime: 1.2, fov: 18 });
      Object.assign(h.stalk, { on: false });
      Object.assign(h.hunt, { onClose: true, close: 8, speed: 2.4, duration: 12, after: 'vanish', leap: false });
      Object.assign(h.scares, { screamSound: 'mob.ghast.scream', shake: true, huntMsg: '' });
    },
  },
};

export const hProp = (ns) => `${ns}:horror_state`;
export const hGroup = (ns, s) => `${ns}:horror_${s}`;
export const hEvent = (ns, s) => `${ns}:horror_${s}`;
export const fogId = (ns, name) => `${ns}:${name}_dread`;
const fogTag = (ns, name) => `${ns}_${name}_dread`;
export const HORROR_GROUP_KEYS = ['mobile', 'frozen', 'dormant', 'stalking', 'hunting', 'fleeing', 'teleporting', 'gone'];
export const HORROR_EVENT_KEYS = ['notice', 'hunt', 'seen', 'unseen', 'give_up', 'lose', 'regroup', 'sunlight'];

const isPlayer = { test: 'is_family', subject: 'other', value: 'player' };
const notCreative = { test: 'has_ability', subject: 'other', operator: 'not', value: 'instabuild' };
const stateIs = (ns, v) => ({ test: 'enum_property', subject: 'self', domain: hProp(ns), value: v });
const stateNot = (ns, v) => ({ test: 'enum_property', subject: 'self', domain: hProp(ns), operator: 'not', value: v });
// Light sources it smashes while hunting (Bedrock block ids).
export const LIGHTS = ['minecraft:torch', 'minecraft:soul_torch', 'minecraft:redstone_torch', 'minecraft:copper_torch', 'minecraft:underwater_torch',
  'minecraft:lantern', 'minecraft:soul_lantern', 'minecraft:copper_lantern', 'minecraft:candle', 'minecraft:lit_pumpkin', 'minecraft:sea_lantern', 'minecraft:glowstone'];
const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

function commands(ns, name, h) {
  const s = h.scares, R = Math.round(h.senses.detect), q = (msg) => clean(msg);
  const fog = `${fogId(ns, name)} ${fogTag(ns, name)}`;
  const notice = [], hunt = [], seen = [], calm = [], vanish = [];
  if (s.messages && q(s.notice)) notice.push(`title @a[r=${R}] actionbar §7§o${q(s.notice)}`);
  if (s.heartbeat && s.heartbeatSound) notice.push(`playsound ${s.heartbeatSound} @a[r=${R}] ~ ~ ~ 1 1`);
  if (s.seenSound) seen.push(`playsound ${s.seenSound} @a[r=${Math.round(h.senses.seenRange)}] ~ ~ ~ 1 0.8`);
  if (s.messages && q(s.seenMsg)) seen.push(`title @a[r=${Math.round(h.senses.seenRange)}] actionbar §7${q(s.seenMsg)}`);
  if (s.scream && s.screamSound) hunt.push(`playsound ${s.screamSound} @a[r=${R + 16}] ~ ~ ~ 2 0.7`);
  if (s.shake) hunt.push(`camerashake add @a[r=20] 0.5 1.5 positional`);
  if (s.darkness) hunt.push(`effect @a[r=20] darkness 8 0 true`);
  if (s.messages && q(s.huntMsg)) hunt.push(`title @a[r=${R}] actionbar §4§l${q(s.huntMsg)}`);
  if (s.fog) hunt.push(`fog @a[r=${R + 16}] push ${fog}`);
  if (s.particles) hunt.push('particle minecraft:sculk_soul_particle ~ ~1.5 ~');
  if (s.fog) calm.push(`fog @a[r=${R * 3}] remove ${fogTag(ns, name)}`);
  vanish.push('particle minecraft:basic_smoke_particle ~ ~1 ~', 'particle minecraft:soul_particle ~ ~1.5 ~', 'playsound mob.endermen.portal @a[r=16] ~ ~ ~ 0.7 0.5');
  if (s.fog) vanish.push(`fog @a[r=${R * 3}] remove ${fogTag(ns, name)}`);
  const qc = (list) => (list.length ? { queue_command: { command: list } } : {});
  return { notice: qc(notice), hunt: qc(hunt), seen: qc(seen), calm: qc(calm), vanish: qc(vanish) };
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

/**
 * Compiles the horror config into the (already cloned) entity output.
 * Mutates components/groups/events/properties; returns extra RP files.
 */
export function compileHorror({ ns, name, h, components, groups, events, properties, notes }) {
  const se = h.senses, st = h.stalk, hu = h.hunt, sc = h.scares, tr = h.traits, wk = h.weakness;
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
    if (sc.darkness) g.stalking['minecraft:mob_effect'] = { effect_range: Math.max(6, (Number(st.keep) || 12) + 6), mob_effect: 'darkness', effect_time: 4, cooldown_time: 20, entity_filter: players };
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
  if (sc.darkness) g.hunting['minecraft:mob_effect'] = { effect_range: 16, mob_effect: 'darkness', effect_time: 6, cooldown_time: 6, entity_filter: players };
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
      'minecraft:teleport': { random_teleports: true, min_random_teleport_time: 0, max_random_teleport_time: 0.3, random_teleport_cube: [24, 8, 24], target_teleport_chance: 0, light_teleport_chance: 1, dark_teleport_chance: 1 },
      'minecraft:timer': { looping: false, randomInterval: false, time: { min: 1.5, max: 1.5 }, time_down_event: { event: E('regroup'), target: 'self' } },
    };
  }
  g.gone = { 'minecraft:instant_despawn': {} };

  // Components living in state groups must not also be in the base list:
  // removing a group removes the component entirely.
  const managed = new Set(Object.values(g).flatMap((c) => Object.keys(c)));
  const stripped = Object.keys(components).filter((id) => managed.has(id));
  for (const id of stripped) delete components[id];
  if (stripped.length) notes.push(`Horror AI moved ${stripped.length} base component(s) into its state groups: ${stripped.join(', ')}`);
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

  const subs = [
    { event: E('notice'), range: [detect, 16], minimum_count: 1, cooldown: 1, event_filters: { all_of: [isPlayer, notCreative, stateIs(ns, 'dormant')] } },
    { event: E('lose'), range: [lose, 32], minimum_count: 0, maximum_count: 0, cooldown: 4, event_filters: { all_of: [isPlayer, notCreative] } },
  ];
  if (hu.onClose) subs.push({ event: E('hunt'), range: [Math.max(2, Number(hu.close) || 6), 6], minimum_count: 1, cooldown: 1, event_filters: { all_of: [isPlayer, notCreative, { any_of: [stateIs(ns, 'stalking'), stateIs(ns, 'dormant')] }] } });
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

  // ---- Property ----
  properties[P] = { type: 'enum', values: HORROR_STATES, default: 'dormant', client_sync: true };

  // ---- Events ----
  const all = (keys) => keys.filter((k) => g[k]).map(G);
  const moving = ['dormant', 'stalking', 'hunting', 'fleeing', 'teleporting', 'frozen'];
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
  const step = (filters, body) => ({ filters, ...body });
  const spawnAction = { add: { component_groups: all(['mobile', 'dormant']) }, set_property: { [P]: 'dormant' } };
  events['minecraft:entity_spawned'] = events['minecraft:entity_spawned'] ? { sequence: [events['minecraft:entity_spawned'], spawnAction] } : spawnAction;
  events[E('notice')] = { sequence: [step(stateIs(ns, 'dormant'), st.on ? goTo('stalking', cmd.notice) : { trigger: E('hunt'), ...cmd.notice })] };
  events[E('hunt')] = { sequence: [step({ all_of: [stateNot(ns, 'hunting'), stateNot(ns, 'gone'), stateNot(ns, 'frozen')] }, goTo('hunting', cmd.hunt))] };
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
  events[E('lose')] = { sequence: [step({ all_of: [stateNot(ns, 'dormant'), stateNot(ns, 'gone')] }, goTo('dormant', cmd.calm))] };
  if (g.fleeing || g.teleporting) events[E('regroup')] = { sequence: [step(stateIs(ns, 'fleeing'), goTo(st.on ? 'stalking' : 'dormant'))] };
  if (wk.sunlight === 'vanish') events[E('sunlight')] = { sequence: [step(stateNot(ns, 'gone'), goTo('gone', merge(cmd.calm, cmd.vanish)))] };
  for (const ev of Object.values(events)) pruneEmpty(ev);

  notes.push(`Horror AI → property ${P}, ${Object.keys(g).length} state groups, ${Object.keys(events).filter((k) => k.includes(':horror_')).length} events, entity sensor${se.seen !== 'none' ? ', looked_at' : ''}`);
  const files = [];
  if (sc.fog) {
    const fogAir = { fog_start: 0, fog_end: Math.max(6, Number(sc.fogDistance) || 20), fog_color: sc.fogColor || '#08080c', render_distance_type: 'fixed' };
    files.push({
      path: `fogs/${name}_dread.json`,
      json: { format_version: '1.16.100', 'minecraft:fog_settings': { description: { identifier: fogId(ns, name) }, distance: { air: fogAir, weather: { ...fogAir } } } },
    });
    notes.push(`Dread fog ${fogId(ns, name)} pushed onto nearby players while it hunts`);
  }
  return { files };
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

/** Spawn conditions for a habitat/rarity pair. */
export function habitatSpawn(habitat) {
  const weight = RARITY[habitat.rarity] || 4;
  const base = {
    'minecraft:difficulty_filter': { min: 'easy', max: 'hard' },
    'minecraft:weight': { default: weight },
    'minecraft:herd': { min_size: 1, max_size: 1 },
    'minecraft:density_limit': { surface: 1, underground: 1 },
  };
  const caves = { 'minecraft:spawns_underground': {}, 'minecraft:brightness_filter': { min: 0, max: 3, adjust_for_weather: false }, 'minecraft:height_filter': { min: -64, max: 48 }, ...clone(base) };
  const night = { 'minecraft:spawns_on_surface': {}, 'minecraft:brightness_filter': { min: 0, max: 5, adjust_for_weather: true }, ...clone(base) };
  switch (habitat.where) {
    case 'night': return [{ ...night, 'minecraft:biome_filter': { test: 'has_biome_tag', value: 'monster' } }];
    case 'forest': return [{ ...night, 'minecraft:biome_filter': { any_of: [{ test: 'has_biome_tag', value: 'forest' }, { test: 'has_biome_tag', value: 'taiga' }, { test: 'has_biome_tag', value: 'roofed' }] } }];
    case 'anywhere': return [caves, { ...night, 'minecraft:biome_filter': { test: 'has_biome_tag', value: 'monster' } }];
    default: return [caves];
  }
}
