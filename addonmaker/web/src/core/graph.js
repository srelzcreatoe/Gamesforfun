// Node board for dwellers: a drag-and-drop view of the same settings the
// sliders edit. graphFromConfig() builds blocks + wires from the config;
// applyGraph() turns blocks + wires back into config. Round-trips cleanly.
import { migrateHorror } from './horror.js';

const num = (min, max, step = 1) => ({ t: 'num', min, max, step });
const pick = (...o) => ({ t: 'pick', o });
export const NODE_TYPES = {
  core: { kind: 'core', label: 'Dweller', icon: '👁', ins: ['part'] },
  // Stats / spawning / traits plug into the dweller.
  health: { kind: 'stat', label: 'Health', icon: '❤', out: 'part', fields: { value: ['Health', num(10, 300, 5)] }, desc: 'How much damage it can take' },
  damage: { kind: 'stat', label: 'Damage', icon: '🗡', out: 'part', fields: { value: ['Damage per hit', num(1, 40)] }, desc: 'How hard it hits' },
  speed: { kind: 'stat', label: 'Speed', icon: '👣', out: 'part', fields: { value: ['Walk speed', num(0.1, 0.7, 0.01)], chase: ['Chase speed boost', num(0.8, 3, 0.05)] }, desc: 'Walking and chase speed' },
  senses: { kind: 'stat', label: 'Senses', icon: '👂', out: 'part', fields: { detect: ['Notices within', num(8, 64)], lose: ['Loses track beyond', num(16, 160)] }, desc: 'How far it notices you' },
  where: { kind: 'spawn', label: 'Lives', icon: '🌗', out: 'part', fields: { type: ['Where', pick('underground', 'surface', 'both')], time: ['When', pick('night', 'always')] }, desc: 'Underground, surface or both' },
  timer: { kind: 'spawn', label: 'Appearance timer', icon: '⏱', out: 'part', fields: { firstAfter: ['First after (min)', num(1, 30)], everyMin: ['Every, shortest (min)', num(1, 60)], everyMax: ['Every, longest (min)', num(1, 90)], chance: ['Chance %', num(5, 100, 5)], leaveAfter: ['Leaves after (min, 0 = never)', num(0, 20)], distance: ['Appears', pick('near', 'medium', 'far')] }, desc: 'Comes to find you on a schedule' },
  limit: { kind: 'spawn', label: 'How many at once', icon: '☝', out: 'part', fields: { max: ['At most', pick('1', '2', '3', '5')] }, desc: 'Extra copies vanish the moment they appear' },
  natural: { kind: 'spawn', label: 'Natural spawning', icon: '🌱', out: 'part', fields: { rarity: ['Rarity', pick('rare', 'uncommon', 'common')] }, desc: 'Spawns in the dark like normal mobs' },
  lights: { kind: 'trait', label: 'Smashes lights', icon: '🕯', out: 'part', desc: 'Breaks torches and lanterns while hunting' },
  doors: { kind: 'trait', label: 'Breaks doors', icon: '🚪', out: 'part', desc: 'Bashes doors down' },
  climb: { kind: 'trait', label: 'Climbs walls', icon: '🧗', out: 'part', desc: 'Crawls up walls' },
  nofall: { kind: 'trait', label: 'No fall damage', icon: '🪂', out: 'part', desc: 'Drops from anywhere' },
  fire: { kind: 'trait', label: 'Weak to fire', icon: '🔥', out: 'part', desc: 'Takes 2.5× fire damage' },
  sun: { kind: 'trait', label: 'Hates sunlight', icon: '☀', out: 'part', fields: { mode: ['In sunlight it', pick('vanish', 'burn')] }, desc: 'Vanishes or burns in daylight' },
  // Triggers ("When…") wire into actions ("Then…").
  notice: { kind: 'when', label: 'Notices you', icon: '👀', out: 'flow', ins: ['scares'], desc: 'A player comes within its senses' },
  close: { kind: 'when', label: 'You get close', icon: '📏', out: 'flow', fields: { dist: ['Within (blocks)', num(2, 24)] }, desc: 'You walk right up to it' },
  time: { kind: 'when', label: 'Stalked long enough', icon: '⏳', out: 'flow', fields: { seconds: ['After about (s)', num(10, 300, 5)] }, desc: 'It has been stalking for a while' },
  hit: { kind: 'when', label: 'You hit it', icon: '💥', out: 'flow', desc: 'A player attacks it' },
  seen: { kind: 'when', label: 'You look at it', icon: '👁', out: 'flow', ins: ['scares'], fields: { range: ['Notices from (blocks)', num(6, 96)], fov: ['Gaze cone (degrees)', num(5, 120)], stare: ['Stare time (s)', num(0, 3, 0.1)], pumpkin: ['Carved pumpkin hides you', { t: 'bool' }] }, desc: 'Your gaze lands on it' },
  ends: { kind: 'when', label: 'Hunt ends', icon: '⌛', out: 'flow', fields: { seconds: ['Chases for (s)', num(5, 120)] }, desc: 'It gives up the chase' },
  stalk: { kind: 'do', label: 'Stalk', icon: '🚶', ins: ['flow'], fields: { keep: ['Keeps away (blocks)', num(3, 40)], speed: ['Speed boost', num(0.3, 2, 0.05)] }, desc: 'Follows at a distance and watches' },
  hunt: { kind: 'do', label: 'Hunt', icon: '🩸', ins: ['flow', 'scares'], fields: { leap: ['Pounces', { t: 'bool' }] }, desc: 'Chases and attacks' },
  flee: { kind: 'do', label: 'Hide', icon: '🏃', ins: ['flow'], desc: 'Bolts into the dark, then returns' },
  freeze: { kind: 'do', label: 'Freeze', icon: '🗿', ins: ['flow'], desc: 'Can\'t move while watched' },
  vanish: { kind: 'do', label: 'Vanish', icon: '💨', ins: ['flow'], desc: 'Disappears in smoke' },
  blink: { kind: 'do', label: 'Blink away', icon: '⚡', ins: ['flow'], desc: 'Teleports somewhere nearby' },
  stare: { kind: 'do', label: 'Stare back', icon: '😶', ins: ['flow'], desc: 'Just stares at you' },
  rest: { kind: 'do', label: 'Lose interest', icon: '💤', ins: ['flow'], desc: 'Goes back to wandering' },
  // Scares wire into "Notices you", "You look at it" or "Hunt".
  scream: { kind: 'scare', label: 'Scream', icon: '😱', out: 'scares', multi: true, fields: { sound: ['Sound', { t: 'sound' }] } },
  heartbeat: { kind: 'scare', label: 'Heartbeat', icon: '💓', out: 'scares', multi: true, fields: { sound: ['Sound', { t: 'sound' }] } },
  stare_sound: { kind: 'scare', label: 'Stare sound', icon: '🔉', out: 'scares', multi: true, fields: { sound: ['Sound', { t: 'sound' }] } },
  message: { kind: 'scare', label: 'Message', icon: '💬', out: 'scares', multi: true, fields: { text: ['Text', { t: 'text' }] } },
  darkness: { kind: 'scare', label: 'Darkness', icon: '🌑', out: 'scares', multi: true },
  shake: { kind: 'scare', label: 'Camera shake', icon: '📳', out: 'scares', multi: true },
  fog: { kind: 'scare', label: 'Dread fog', icon: '🌫', out: 'scares', multi: true, fields: { color: ['Colour', { t: 'color' }], dist: ['You can see (blocks)', num(6, 64)] } },
  particles: { kind: 'scare', label: 'Soul particles', icon: '✨', out: 'scares', multi: true },
};
export const KIND_INFO = {
  when: ['When…', '#c98a2c'], do: ['Then…', '#b83a2e'], scare: ['Scares', '#7a4ab0'], stat: ['Stats', '#4f8a3a'], spawn: ['Spawning', '#3a6fa8'], trait: ['Traits', '#2f8a84'], core: ['Dweller', '#d9772b'],
};
export const ALLOWED = {
  notice: ['stalk', 'hunt'], close: ['hunt'], time: ['hunt'], hit: ['hunt'],
  seen: ['flee', 'freeze', 'vanish', 'blink', 'hunt', 'stare'], ends: ['stalk', 'rest', 'vanish'],
};
const SEEN_TO = { flee: 'flee', freeze: 'freeze', vanish: 'vanish', teleport: 'blink', charge: 'hunt', stare: 'stare' };
const TO_SEEN = Object.fromEntries(Object.entries(SEEN_TO).map(([a, b]) => [b, a]));
const SCARE_TYPE = { scream: 'scream', heartbeat: 'heartbeat', stare_sound: 'stare', message: 'message', darkness: 'darkness', shake: 'shake', fog: 'fog', particles: 'particles' };
const TYPE_SCARE = Object.fromEntries(Object.entries(SCARE_TYPE).map(([a, b]) => [b, a]));
const MOMENT_NODE = { notice: 'notice', seen: 'seen', hunt: 'hunt' };

export const typeOf = (id) => id.split('#')[0];

/** Can a wire go from node `from` to node `to`? Returns null or a reason. */
export function canLink(from, to) {
  const a = NODE_TYPES[typeOf(from)], b = NODE_TYPES[typeOf(to)];
  if (!a || !b || from === to) return 'Not a valid connection';
  if (a.out === 'part') return b.kind === 'core' ? null : `${a.label} plugs into the Dweller block`;
  if (a.out === 'scares') return (b.ins || []).includes('scares') ? null : 'Scares plug into “Notices you”, “You look at it” or “Hunt”';
  if (a.out === 'flow') return (ALLOWED[typeOf(from)] || []).includes(typeOf(to)) ? null : `“${a.label}” can't lead to “${b.label}”`;
  return `${a.label} has nothing to connect`;
}

/** Like canLink, but also checks the rest of the board (some wires only work together). */
export function linkProblem(g, from, to) {
  const r = canLink(from, to);
  if (r) return r;
  const has = (a, b) => g.links.some((l) => l.from === a && l.to === b);
  if (typeOf(from) === 'time' && !has('notice', 'stalk')) return '“Stalked long enough” only works when “Notices you” leads to “Stalk”';
  if (typeOf(from) === 'ends' && typeOf(to) === 'stalk' && !has('notice', 'stalk')) return 'It can only go back to stalking if “Notices you” leads to “Stalk”';
  return null;
}

/** Adds a link, replacing the source's previous link (every block has one output). */
export function addLink(graph, from, to) {
  graph.links = graph.links.filter((l) => l.from !== from);
  graph.links.push({ from, to });
}

const COL = { scare: 0, when: 240, do: 490, core: 740, part: 990, trait: 1220 };

export function graphFromConfig(e, prev) {
  const h = migrateHorror(e.horror);
  const nodes = [], links = [];
  const prevPos = new Map((prev?.nodes || []).map((n) => [n.id, [n.x, n.y]]));
  const add = (id, x, y, data = {}) => {
    const p = prevPos.get(id);
    nodes.push({ id, x: p ? p[0] : x, y: p ? p[1] : y, data });
    return id;
  };
  const link = (from, to) => links.push({ from, to });
  add('core', COL.core, 260);
  let py = 0;
  const part = (id, data, on = true) => { add(id, COL.part, py, data); py += 120; if (on) link(id, 'core'); };
  part('health', { value: Number(e.components['minecraft:health']?.value) || 20 });
  part('damage', { value: h.hunt.damage });
  part('speed', { value: Number(e.components['minecraft:movement']?.value) || 0.3, chase: h.hunt.speed });
  part('senses', { detect: h.senses.detect, lose: h.senses.lose });
  part('where', { type: h.type, time: h.time });
  part('timer', { firstAfter: h.appear.firstAfter, everyMin: h.appear.every[0], everyMax: h.appear.every[1], chance: h.appear.chance, leaveAfter: h.appear.leaveAfter, distance: h.appear.distance }, h.appear.director);
  part('natural', { rarity: h.appear.rarity }, h.appear.natural);
  part('limit', { max: String(e.limit?.max || 1) }, !!e.limit?.on);
  const traits = [['lights', h.traits.breakLights], ['doors', h.traits.breakDoors], ['climb', h.traits.climb], ['nofall', h.traits.noFall], ['fire', h.weakness.fire]];
  traits.forEach(([id, on], i) => { add(id, COL.trait, i * 100); if (on) link(id, 'core'); });
  add('sun', COL.trait, traits.length * 100, { mode: h.weakness.sunlight === 'burn' ? 'burn' : 'vanish' });
  if (h.weakness.sunlight !== 'none') link('sun', 'core');
  // Triggers and actions.
  const notice = h.notice || (h.stalk.on ? 'stalk' : 'hunt');
  add('notice', COL.when, 0);
  add('stalk', COL.do, 0, { keep: h.stalk.keep, speed: h.stalk.speed });
  add('hunt', COL.do, 220, { leap: !!h.hunt.leap });
  if (h.stalk.on && notice !== 'none') link('notice', 'stalk');
  else if (notice === 'hunt') link('notice', 'hunt');
  add('close', COL.when, 140, { dist: h.hunt.close });
  if (h.hunt.onClose) link('close', 'hunt');
  add('time', COL.when, 260, { seconds: h.stalk.huntAfter || 60 });
  if (h.stalk.on && Number(h.stalk.huntAfter) > 0) link('time', 'hunt');
  add('hit', COL.when, 380);
  if (h.hunt.onHurt) link('hit', 'hunt');
  add('seen', COL.when, 500, { range: h.senses.seenRange, fov: h.senses.fov, stare: h.senses.lookTime, pumpkin: !!h.senses.pumpkinSafe });
  const seenAction = SEEN_TO[h.senses.seen];
  if (seenAction && seenAction !== 'hunt') add(seenAction, COL.do, 460);
  if (seenAction) link('seen', seenAction);
  add('ends', COL.when, 700, { seconds: h.hunt.duration });
  const endTo = h.hunt.after === 'vanish' ? 'vanish' : h.hunt.after === 'dormant' || !h.stalk.on ? 'rest' : 'stalk';
  if (!nodes.some((n) => n.id === endTo)) add(endTo, COL.do, endTo === 'rest' ? 680 : 600);
  link('ends', endTo);
  // Scares.
  const moments = h.moments || null;
  const derived = moments || (() => {
    const s = h.scares, m = { notice: [], seen: [], hunt: [] };
    if (s.messages && s.notice) m.notice.push('message');
    if (s.heartbeat) m.notice.push('heartbeat');
    if (s.seenSound) m.seen.push('stare');
    if (s.messages && s.seenMsg) m.seen.push('message');
    for (const k of ['scream', 'shake', 'darkness']) if (s[k]) m.hunt.push(k);
    if (s.messages && s.huntMsg) m.hunt.push('message');
    if (s.fog) m.hunt.push('fog');
    if (s.particles) m.hunt.push('particles');
    return m;
  })();
  // Stack the scare blocks in one column, grouped by the moment they play at.
  let sy = 0;
  for (const moment of ['notice', 'hunt', 'seen']) {
    const list = derived[moment] || [];
    if (moment === 'seen') sy = Math.max(sy, 460);
    list.forEach((type) => {
      const nt = TYPE_SCARE[type];
      if (!nt) return;
      const data = {};
      if (nt === 'scream') data.sound = h.scares.screamSound;
      if (nt === 'heartbeat') data.sound = h.scares.heartbeatSound;
      if (nt === 'stare_sound') data.sound = h.scares.seenSound;
      if (nt === 'message') data.text = moment === 'notice' ? h.scares.notice : moment === 'seen' ? h.scares.seenMsg : h.scares.huntMsg;
      if (nt === 'fog') { data.color = h.scares.fogColor; data.dist = h.scares.fogDistance; }
      const id = add(`${nt}#${moment}`, COL.scare, sy, data);
      sy += nt === 'fog' ? 86 : NODE_TYPES[nt].fields ? 70 : 50;
      link(id, MOMENT_NODE[moment]);
    });
    if (list.length) sy += 24;
  }
  // Keep blocks the user dragged in but hasn't wired yet.
  for (const n of prev?.nodes || []) if (!nodes.some((m) => m.id === n.id) && NODE_TYPES[typeOf(n.id)]) nodes.push(n);
  return { nodes, links };
}

/** Writes the board's blocks + wires back into the entity's dweller config. */
export function applyGraph(e) {
  const h = (e.horror = migrateHorror(e.horror));
  const g = h.graph;
  if (!g) return;
  const node = (id) => g.nodes.find((n) => n.id === id);
  const d = (id) => node(id)?.data || {};
  const to = (from) => g.links.find((l) => l.from === from)?.to;
  const linked = (a, b) => g.links.some((l) => l.from === a && l.to === b);
  const toCore = (id) => !!node(id) && linked(id, 'core');
  if (toCore('health')) { const v = Number(d('health').value) || 20; e.components['minecraft:health'] = { value: v, max: v }; }
  if (toCore('damage')) h.hunt.damage = Number(d('damage').value) || 6;
  if (toCore('speed')) { e.components['minecraft:movement'] = { value: Number(d('speed').value) || 0.3 }; h.hunt.speed = Number(d('speed').chase) || 1.5; }
  if (toCore('senses')) { h.senses.detect = Number(d('senses').detect) || 32; h.senses.lose = Math.max(h.senses.detect + 8, Number(d('senses').lose) || 64); }
  if (toCore('where')) { h.type = d('where').type || 'both'; h.time = d('where').time || 'night'; }
  h.appear.director = toCore('timer');
  if (node('timer')) {
    const t = d('timer');
    Object.assign(h.appear, { firstAfter: Number(t.firstAfter) || 3, every: [Number(t.everyMin) || 6, Math.max(Number(t.everyMin) || 6, Number(t.everyMax) || 12)], chance: Number(t.chance) || 70, leaveAfter: Number(t.leaveAfter) || 0, distance: t.distance || 'medium' });
  }
  h.appear.natural = toCore('natural');
  if (node('limit')) e.limit = { on: toCore('limit'), max: Number(d('limit').max) || 1 };
  if (node('natural')) h.appear.rarity = d('natural').rarity || 'uncommon';
  h.traits.breakLights = toCore('lights');
  h.traits.breakDoors = toCore('doors');
  h.traits.climb = toCore('climb');
  h.traits.noFall = toCore('nofall');
  h.weakness.fire = toCore('fire');
  h.weakness.sunlight = toCore('sun') ? (d('sun').mode === 'burn' ? 'burn' : 'vanish') : 'none';
  const nt = to('notice');
  h.notice = nt === 'stalk' ? 'stalk' : nt === 'hunt' ? 'hunt' : 'none';
  h.stalk.on = nt === 'stalk';
  if (node('stalk')) { h.stalk.keep = Number(d('stalk').keep) || 12; h.stalk.speed = Number(d('stalk').speed) || 0.85; }
  h.hunt.onClose = linked('close', 'hunt');
  if (node('close')) h.hunt.close = Number(d('close').dist) || 6;
  h.stalk.huntAfter = linked('time', 'hunt') ? Number(d('time').seconds) || 60 : 0;
  h.hunt.onHurt = linked('hit', 'hunt');
  h.hunt.leap = !!d('hunt').leap;
  const st = to('seen');
  h.senses.seen = st ? TO_SEEN[st] || 'none' : 'none';
  if (node('seen')) Object.assign(h.senses, { seenRange: Number(d('seen').range) || 40, fov: Number(d('seen').fov) || 30, lookTime: Number(d('seen').stare) || 0, pumpkinSafe: !!d('seen').pumpkin });
  const et = to('ends');
  h.hunt.after = et === 'vanish' ? 'vanish' : et === 'stalk' && h.stalk.on ? 'stalk' : 'dormant';
  if (node('ends')) h.hunt.duration = Number(d('ends').seconds) || 20;
  const moments = { notice: [], seen: [], hunt: [] };
  for (const n of g.nodes) {
    const type = typeOf(n.id);
    if (NODE_TYPES[type]?.kind !== 'scare') continue;
    const target = to(n.id);
    const moment = Object.keys(MOMENT_NODE).find((m) => MOMENT_NODE[m] === target);
    if (!moment) continue;
    const kind = SCARE_TYPE[type];
    if (!moments[moment].includes(kind)) moments[moment].push(kind);
    if (type === 'scream' && n.data.sound) h.scares.screamSound = n.data.sound;
    if (type === 'heartbeat' && n.data.sound) h.scares.heartbeatSound = n.data.sound;
    if (type === 'stare_sound' && n.data.sound) h.scares.seenSound = n.data.sound;
    if (type === 'message') { const k = { notice: 'notice', seen: 'seenMsg', hunt: 'huntMsg' }[moment]; h.scares[k] = n.data.text || ''; }
    if (type === 'fog') { if (n.data.color) h.scares.fogColor = n.data.color; if (n.data.dist) h.scares.fogDistance = Number(n.data.dist); }
  }
  h.moments = moments;
  h.customized = true;
}

/** Plain-language problems shown on the board. */
export function graphHints(g) {
  const out = [];
  const has = (from, to) => g.links.some((l) => l.from === from && (!to || l.to === to));
  if (!has('notice') && !has('close') && !has('hit') && !has('seen')) out.push('Nothing makes it react to you yet: wire a “When…” block into an action.');
  if (!g.links.some((l) => l.to === 'hunt')) out.push('Nothing leads to “Hunt”, so it never attacks unless you change that.');
  if (!has('timer', 'core') && !has('natural', 'core')) out.push('It never appears on its own: connect “Appearance timer” or “Natural spawning” to the Dweller.');
  return out;
}
