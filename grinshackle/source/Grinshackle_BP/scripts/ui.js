// Chainbound Dial: the configuration menus. Standard @minecraft/server-ui forms only (action / modal / message), no custom UI JSON.
// Admin sections (tag gs_admin or world owner) change the world for everyone; Audio (personal) and Status are open to every player.
// Every show() is wrapped, canceled responses are ignored, and every submit returns to the main menu.
import { world } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData } from '@minecraft/server-ui';
import { IDS } from './constants.js';
import { S } from './state.js';
import { safe, isValid, clamp, logError } from './util.js';
import * as config from './config.js';
import * as gates from './gates.js';
import * as audio from './audio.js';
import * as memory from './memory.js';
import * as markers from './markers.js';
import * as reservation from './reservation.js';
import * as timers from './timers.js';
import * as text from './text.js';
// Written by other modules of the same pack; every use goes through call()/has() so a missing export never throws.
import * as director from './director.js';
import * as preview from './preview.js';
import * as items from './items.js';

const ICON = (name) => 'textures/ui/gs_icon_' + name + '.png';
const ADMIN_HINT = 'Ask the world owner or run /function grinshackle/admin (operator).';

// ---------------------------------------------------------------- helpers
function cfg() { return S.config || config.load(); }
function has(ns, name) { try { return !!ns && typeof ns[name] === 'function'; } catch { return false; } }
/** Call an optional export of another module; never throws. */
function call(ns, name, ...args) {
  try { return has(ns, name) ? ns[name](...args) : undefined; } catch (e) { logError(e); return undefined; }
}
/** Show any form; resolves to the response, or undefined when canceled / failed. */
async function show(form, player) {
  if (!isValid(player)) return undefined;
  try { const r = await form.show(player); return r && !r.canceled ? r : undefined; } catch (e) { logError(e); return undefined; }
}
export function isAdmin(player) {
  if (!isValid(player)) return false;
  if (safe(() => player.hasTag(IDS.ADMIN_TAG), false)) return true;
  const id = safe(() => player.id, undefined);
  return !!id && (id === S.owner || id === safe(() => world.getDynamicProperty(IDS.PROP_OWNER), undefined));
}
async function requireAdmin(player) {
  if (isAdmin(player)) return true;
  const f = new MessageFormData().title('Admin only').body('This section changes the world for everyone.\n' + ADMIN_HINT)
    .button1('Back').button2('Close');
  const r = await show(f, player);
  if (r && r.selection === 0) await openDial(player);
  return false;
}
function onOff(b) { return b ? 'ON' : 'OFF'; }
function pct(x) { return Math.round(x * 100) + ' %'; }
function playerName(id) { return safe(() => world.getAllPlayers().find((p) => p.id === id), undefined)?.name || 'none'; }
function firstLine(s) { return typeof s === 'string' && s.length ? s.split('\n')[0] : ''; }
function headline() { return firstLine(call(director, 'statusLine')) || gateLine(); }
function gateLine() { const g = gates.spawnGate(); return text.gateSentence(g.reason, g.detail); }

// Declarative modal rows: sl() = slider (config value = slider / scale), tg() = toggle.
const sl = (k, label, min, max, step, scale = 1) => ({ k, label, min, max, step, scale });
const tg = (k, label) => ({ k, label });
const snap = (v, min, max, step) => clamp(min + Math.round((clamp(v, min, max) - min) / step) * step, min, max);
/** Add one row to a modal, reading its current value from `source` (config object or prefs object). */
function addRow(f, r, source) {
  if (r.min === undefined) f.toggle(r.label, { defaultValue: !!source[r.k] });
  else f.slider(r.label, r.min, r.max, { defaultValue: snap(Number(source[r.k]) * r.scale, r.min, r.max, r.step), valueStep: r.step });
}
function modal(title, rows, source) {
  const f = new ModalFormData().title(title);
  for (const r of rows) addRow(f, r, source);
  return f.submitButton('Apply');
}
/** Map submitted values back onto rows → [{row, value}]. Header/divider/label slots arrive as undefined and are skipped. */
function readRows(rows, formValues) {
  const vals = (formValues || []).filter((x) => x !== undefined);
  const out = [];
  rows.forEach((r, i) => { if (i < vals.length) out.push({ row: r, value: r.min === undefined ? !!vals[i] : Number(vals[i]) / r.scale }); });
  return out;
}
function applyConfig(entries) { for (const e of entries) config.set(e.row.k, e.value); }

const SECTIONS = [
  { label: 'Master', icon: ICON('master'), admin: true, open: (p) => sectionMaster(p) },
  { label: 'Spawning', icon: ICON('spawning'), admin: true, open: (p) => sectionSpawning(p) },
  { label: 'Behavior', icon: ICON('behavior'), admin: true, open: (p) => sectionBehavior(p) },
  { label: 'Audio', icon: ICON('audio'), admin: false, open: (p) => sectionAudio(p) },
  { label: 'Encounter Tools', icon: ICON('tools'), admin: true, open: (p) => sectionTools(p) },
  { label: 'Player Study', icon: ICON('study'), admin: true, open: (p) => sectionStudy(p) },
  { label: 'Presets', icon: ICON('presets'), admin: true, open: (p) => sectionPresets(p) },
  { label: 'Status', icon: ICON('status'), admin: false, open: (p) => sectionStatus(p) },
];

// ---------------------------------------------------------------- main menu
/** The Chainbound Dial main menu: one status line and the eight sections. */
export async function openDial(player) {
  if (!isValid(player)) return;
  const admin = isAdmin(player);
  const f = new ActionFormData().title('Chainbound Dial')
    .body(headline() + (admin ? '' : '\n§8Admin sections are locked for you. Audio and Status are yours.'));
  for (const s of SECTIONS) f.button(s.admin && !admin ? '§7' + s.label + ' §8(admin)' : s.label, s.icon);
  const r = await show(f, player);
  const sec = r && r.selection !== undefined ? SECTIONS[r.selection] : undefined;
  if (!sec) return;
  if (sec.admin && !admin) { await requireAdmin(player); return; }
  await sec.open(player);
}

// ---------------------------------------------------------------- sections
const MASTER_ROWS = [tg('master', 'Master switch'), tg('naturalSpawning', 'Natural spawning'), tg('debug', 'Debug log'), tg('learning', 'Learning (player study)')];
export async function sectionMaster(player) {
  if (!(await requireAdmin(player))) return;
  const before = !!cfg().master;
  const r = await show(modal('Master', MASTER_ROWS, cfg()), player);
  if (r) {
    const entries = readRows(MASTER_ROWS, r.formValues);
    applyConfig(entries.filter((e) => e.row.k !== 'master'));
    const master = entries.find((e) => e.row.k === 'master');
    if (master) {
      config.set('master', master.value);
      if (before && !master.value) {
        if (has(director, 'masterOff')) call(director, 'masterOff');
        else { timers.cancelAll(); markers.clear(); audio.stopAll(); }           // minimal fallback: stop everything now
      } else if (!before && master.value) call(director, 'masterOn');
    }
  }
  await openDial(player);
}

const SPAWN_ROWS = [
  sl('spawnChance', 'Spawn chance (%)', 5, 100, 5, 100), sl('graceSeconds', 'Grace before first (s)', 0, 900, 30),
  sl('cooldownMinSeconds', 'Cooldown min (s)', 30, 1800, 30), sl('cooldownMaxSeconds', 'Cooldown max (s)', 30, 3600, 30),
  sl('maxSpawnY', 'Max spawn Y', -64, 320, 8), sl('minSpawnDistance', 'Min distance', 6, 32, 1), sl('maxSpawnDistance', 'Max distance', 8, 48, 1),
];
export async function sectionSpawning(player) {
  if (!(await requireAdmin(player))) return;
  const r = await show(modal('Spawning', SPAWN_ROWS, cfg()), player);
  if (r) applyConfig(readRows(SPAWN_ROWS, r.formValues));  // config.set keeps max >= min
  await openDial(player);
}

const BEHAVIOR_ROWS = [
  sl('stalkMinSeconds', 'Stalk min (s)', 5, 120, 5), sl('stalkMaxSeconds', 'Stalk max (s)', 5, 180, 5), sl('huntCapSeconds', 'Hunt cap (s)', 10, 45, 5),
  sl('health', 'Health', 40, 200, 10), sl('damageScale', 'Damage (%)', 0, 200, 5, 100), sl('speedScale', 'Speed (%)', 60, 140, 5, 100),
  sl('aggression', 'Aggression (%)', 50, 150, 5, 100), sl('lightThreshold', 'Light threshold (lights)', 1, 8, 1), sl('effectDensity', 'Effect density (%)', 0, 150, 10, 100),
  tg('crawling', 'Crawling'), tg('lightAvoidance', 'Light avoidance'), tg('chainFragments', 'Chain fragments'),
  tg('omenFootsteps', 'Omen: footsteps'), tg('omenMine', 'Omen: answering mine'), tg('omenDrag', 'Omen: distant drag'),
  tg('cornerWatch', 'Corner watch'), tg('lastLink', 'Last Link'), tg('thresholds', 'Remember passages'),
  tg('unfinishedRetreat', 'Unfinished retreat'), tg('atmosphericLines', 'Atmospheric lines'), tg('subtitles', 'Subtitles (world)'),
];
export async function sectionBehavior(player) {
  if (!(await requireAdmin(player))) return;
  const r = await show(modal('Behavior', BEHAVIOR_ROWS, cfg()), player);
  if (r) applyConfig(readRows(BEHAVIOR_ROWS, r.formValues));
  await openDial(player);
}

const WORLD_AUDIO = [sl('musicVolume', 'World music (%)', 0, 100, 5, 100), sl('effectsVolume', 'World effects (%)', 0, 100, 5, 100), tg('quietPreset', 'Quiet preset')];
const MY_AUDIO = [sl('musicVolume', 'My music (%)', 0, 100, 5, 100), sl('effectsVolume', 'My effects (%)', 0, 100, 5, 100), tg('subtitles', 'My subtitles'), tg('muted', 'Mute it for me')];
/** World audio (admin) and personal preferences (everyone) in one form. */
export async function sectionAudio(player) {
  if (!isValid(player)) return;
  const admin = isAdmin(player);
  const prefs = config.prefs(player);
  const f = new ModalFormData().title('Audio');
  if (admin) { f.header('World (everyone)'); for (const r of WORLD_AUDIO) addRow(f, r, cfg()); f.divider(); }
  f.header('Personal (only you)');
  for (const r of MY_AUDIO) addRow(f, r, prefs);
  f.submitButton('Apply');
  const r = await show(f, player);
  if (r) {
    const rows = admin ? WORLD_AUDIO.concat(MY_AUDIO) : MY_AUDIO;
    const entries = readRows(rows, r.formValues);
    for (const e of entries) {
      if (admin && WORLD_AUDIO.includes(e.row)) config.set(e.row.k, e.value);
      else {
        const changed = prefs[e.row.k] !== e.value;
        config.setPref(player, e.row.k, e.value);
        if (e.row.k === 'muted' && changed) audio.stopFor(player);
      }
    }
  }
  await openDial(player);
}

/** Encounter tools: each button runs one action and returns to this menu with a note; Back returns to the dial. */
export async function sectionTools(player, note = '') {
  if (!(await requireAdmin(player))) return;
  const muted = audio.isMuted();
  const tool = (label, run) => ({ label, run });
  const tools = [
    tool('Spawn test', () => { call(director, 'spawnTest', player); return 'Test spawn requested.'; }),
    tool('Preview (harmless)', () => { call(preview, 'start', player); return 'Preview started 5 blocks ahead.'; }),
    tool('Preview: next clip', () => { call(preview, 'next'); return 'Next clip.'; }),
    tool('End / reset encounter', () => { call(director, 'endEncounter', 'reset'); call(preview, 'stop'); return 'Encounter ended.'; }),
    tool('Reset cooldown', () => {
      if (has(director, 'resetCooldown')) call(director, 'resetCooldown'); else { S.nextNaturalCheck = 0; S.naturalGraceUntil = 0; }
      return 'Cooldown and grace cleared.';
    }),
    tool(muted ? 'Restore sound' : 'Mute all sound', () => { audio.mute(!muted); return muted ? 'Sound restored.' : 'All Grinshackle sound muted.'; }),
    tool('Give me a dial', () => { call(items, 'giveDial', player); return 'Dial given (if you had none).'; }),
    tool('Forget all profiles', () => { memory.forgetAll(); return 'All player profiles forgotten.'; }),
    tool('Back', undefined),
  ];
  const f = new ActionFormData().title('Encounter Tools').body(headline() + (note ? '\n§a' + note : ''));
  for (const t of tools) f.button(t.label, t.run ? ICON('tools') : undefined);
  const r = await show(f, player);
  const chosen = r && r.selection !== undefined ? tools[r.selection] : undefined;
  if (!chosen) return;
  if (!chosen.run) { await openDial(player); return; }
  let result = '';
  try { result = chosen.run() || ''; } catch (e) { logError(e); result = 'That action failed; see the content log.'; }
  await sectionTools(player, result);
}

const STUDY_NOTE = '\n\n§7Only in-game movement, sneaking, staring, light placement, escape headings, passage use, melee rushes and dodge sides are counted. '
  + 'Profiles live in this world only and fade after every encounter.';
/** Player Study: the adaptive profile, explained; anyone may forget their own profile, admins may pause learning. */
export async function sectionStudy(player) {
  if (!isValid(player)) return;
  const admin = isAdmin(player);
  const learning = !!cfg().learning;
  const body = 'Learning: ' + onOff(learning) + '\nYour profile: ' + memory.describe(player.id) + STUDY_NOTE;
  const f = new ActionFormData().title('Player Study').body(body).button('Forget my profile', ICON('study'));
  if (admin) f.button('Learning: turn ' + onOff(!learning), ICON('master'));
  f.button('Back');
  const r = await show(f, player);
  if (!r || r.selection === undefined) return;
  if (r.selection === 0) { memory.forget(player.id); text.notify(player, 'Your Grinshackle profile was forgotten.'); await sectionStudy(player); return; }
  if (admin && r.selection === 1) { config.set('learning', !learning); await sectionStudy(player); return; }
  await openDial(player);
}

const PRESETS = [
  ['balanced', 'Balanced', 'Defaults: cooldown 3–6 min, stalk 20–40 s, 60 % spawn chance, normal aggression, damage and speed.'],
  ['slow_dread', 'Slow Dread', 'Cooldown 5–10 min, stalk 35–60 s, 40 % spawn chance, aggression 80 %, hunt cap 40 s, every omen on.'],
  ['relentless', 'Relentless', 'Cooldown 2–4 min, stalk 15–25 s, 90 % spawn chance, aggression 140 %, speed 115 %, hunt cap 45 s, light threshold 4.'],
  ['showcase', 'Showcase', 'Natural spawning OFF, aggression 50 %, damage 0 (preview-safe), omens on, music on. Use the tools to spawn or preview.'],
];
export async function sectionPresets(player) {
  if (!(await requireAdmin(player))) return;
  const f = new ActionFormData().title('Presets').body('Current: ' + cfg().preset + '\nA preset replaces every setting except Master and Debug.');
  for (const p of PRESETS) f.button(p[1], ICON('presets'));
  f.button('Back');
  const r = await show(f, player);
  const p = r && r.selection !== undefined ? PRESETS[r.selection] : undefined;
  if (!p) { if (r) await openDial(player); return; }
  const ok = config.applyPreset(p[0]);
  const m = new MessageFormData().title(ok ? 'Preset applied' : 'Preset failed')
    .body((ok ? p[1] + ' is now active.\n\n' : 'Unknown preset.\n\n') + p[2]).button1('Menu').button2('Presets');
  const c = await show(m, player);
  if (!c) return;
  if (c.selection === 1) await sectionPresets(player); else await openDial(player);
}

/** Multi-line status for the Status section: director.statusLine() when present, else a local composition of the same fields. */
function statusBody() {
  const d = call(director, 'statusLine');
  if (typeof d === 'string' && d.length) return d;
  const c = cfg(); const rec = S.record; const res = reservation.current();
  const lines = [
    'Master ' + onOff(c.master) + ' · Natural ' + onOff(c.naturalSpawning) + ' · Preset ' + c.preset + ' · Learning ' + onOff(c.learning),
    gateLine(),
    rec ? 'Active: ' + rec.state + ' (' + rec.variant + ', ' + rec.mode + '), tension ' + Math.round(rec.tension) + ', target ' + playerName(rec.target)
      : 'Active: none' + (S.preview ? ' (preview running)' : ''),
    res ? 'Reservation: gen ' + res.generation + ' ' + res.mode + ' @ ' + res.dimensionId.replace('minecraft:', '') + ' '
      + Math.round(res.x) + ',' + Math.round(res.y) + ',' + Math.round(res.z) + (res.unloadedSinceTick ? ' (unloaded)' : '') : 'Reservation: none',
    'Markers ' + markers.count() + ' · Timers ' + timers.pendingCount() + ' · Muted ' + onOff(audio.isMuted()),
    'Damage ' + pct(c.damageScale) + ' · Speed ' + pct(c.speedScale) + ' · Aggression ' + pct(c.aggression) + ' · Lights ' + c.lightThreshold,
  ];
  return lines.join('\n');
}
export async function sectionStatus(player) {
  if (!isValid(player)) return;
  const f = new MessageFormData().title('Status').body(statusBody()).button1('Refresh').button2('Menu');
  const r = await show(f, player);
  if (!r) return;
  if (r.selection === 0) await sectionStatus(player); else await openDial(player);
}
