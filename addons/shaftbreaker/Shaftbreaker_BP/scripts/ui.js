// @ts-check
import { ItemStack } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData } from '@minecraft/server-ui';
import { config, setConfig, applyPreset, ENUMS, prefs, setPrefs, DIFFICULTY, diff } from './core/config.js';
import { isOperator, compassName, worldTicks, safe, now, dist, valid } from './core/util.js';
import { profile, topTraits, SIGNAL_TEXT, resetProfile, markDirty } from './ai/memory.js';
import { pstate, forceShow, forceById, setMood, stopEncounter } from './ai/director.js';
import { ws, nearestDen } from './ai/worldstate.js';
import { playFor, stopMusic, startMusic, previewMusic, endPreview } from './audio.js';
import { creature } from './ai/creature.js';
import { jumpscare, whisper, startEyes, mindGame, shake } from './scare.js';
import { tryGenerateDen, guideNow } from './world/den.js';
import { HOLLOWS, inHollows } from './world/space.js';
import { huntDue, reactions } from './ai/encounters/stalk.js';
import { FIELD_NOTES, unlockedNotes } from './notes.js';

const NEEDLE = ['§8▁', '§7▂', '§7▃', '§f▄', '§e▅', '§6▆', '§c▇', '§4█'];

function needle(v) { return NEEDLE[Math.max(0, Math.min(NEEDLE.length - 1, Math.floor(v / 100 * NEEDLE.length)))]; }

/** The Resonance Dial: what the player can know, nothing more (no exact coordinates). */
export async function openDial(player) {
  playFor(player, 'shaftbreaker.dial', undefined, 0.6);
  const s = pstate(player);
  const pf = profile(player);
  const den = nearestDen(player.location, 160);
  const lines = [];
  lines.push(`§7Resonance: ${needle(s.interest)} §8(${s.state})`);
  lines.push(`§7Encounters: §f${pf.encounters}§7  sightings §f${pf.sightings}§7  hunts survived §f${pf.huntsEscaped}/${pf.hunts}`);
  if (den) lines.push(`§7The dial hums toward the §f${compassName(player.location, den.den)}§7 (${den.dist < 40 ? 'close' : den.dist < 90 ? 'some way off' : 'far'}).`);
  else lines.push('§7No den hum nearby.');
  const learned = topTraits(player, 3);
  lines.push('');
  lines.push(learned.length ? '§7What it has learned about you:' : '§7It has not learned your habits yet.');
  for (const [k, t] of learned) lines.push(` §8• §f${SIGNAL_TEXT[k]} §8(${Math.round(t.s)}%)`);
  if (worldTicks() < ws().defeatedUntil) lines.push('\n§aThe territory is silent after its defeat.');
  const form = new ActionFormData()
    .title('Resonance Dial')
    .body(lines.join('\n'))
    .button('Personal settings')
    .button('Field notes')
    .button('Forget me (reset my memory)');
  if (isOperator(player)) form.button('World settings (operator)');
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  if (res.selection === 0) return personal(player);
  if (res.selection === 1) return notes(player);
  if (res.selection === 2) return confirmReset(player);
  if (res.selection === 3) return worldSettings(player);
}

async function personal(player) {
  const p = prefs(player);
  const f = new ModalFormData().title('Personal settings')
    .toggle('Reduced audio (softer stingers, quieter heartbeat)', { defaultValue: p.reducedAudio })
    .toggle('Reduced flicker (no screen fades)', { defaultValue: p.reducedFlicker })
    .toggle('No chase music for me', { defaultValue: p.reducedChase })
    .toggle('Threat captions in the action bar', { defaultValue: p.captions })
    .toggle('Heartbeat', { defaultValue: p.heartbeat })
    .toggle('Trophy filter (subtle pulse while wearing the skull)', { defaultValue: p.trophyFilter });
  const r = await f.show(player);
  if (r.canceled || !r.formValues) return;
  const v = r.formValues;
  setPrefs(player, { reducedAudio: !!v[0], reducedFlicker: !!v[1], reducedChase: !!v[2], captions: !!v[3], heartbeat: !!v[4], trophyFilter: !!v[5] });
  player.sendMessage('§7[Shaftbreaker] Personal settings saved.');
}

async function notes(player) {
  const f = new ActionFormData().title('Field notes').body([
    '§fIt is always near, and it wants to be seen.§7 On the ground, on a ledge, on the ceiling, behind a tree. Look away and it is closer.',
    '§fDo not stare it down. Do not hit it. Do not run at it.§7 It snaps, screams, and comes faster than you can run.',
    '§fEvery attack is announced:§7 a scream before a chase, a coil before a lunge. Walk right up to it and it strikes.',
    '§fIt opens doors and smashes glass to reach you.§7 It puts everything back afterwards.',
    '§fIt learns slowly and forgets slowly.§7 Using the same escape again and again makes it wait for you there. Change routes.',
    '§fLight, company and preparation make it leave.§7 Groups are watched from afar.',
    '§fIt will not follow you into daylight.§7 At night the surface is no refuge.',
    '§fMeat§7 dropped near it can distract it. Not always.',
    '§fShaft moths§7 lead the way to its den: follow one and it waits for you. Breaking the Den Heart quiets the territory for days, but it remembers.',
    '§fIt is usually close.§7 Listen: clicks, scrapes and breathing come from where it really is. The music deepens when it is near.',
    '§fCraft a Resonance Dial§7 from copper, redstone and an amethyst shard or resonance shard.',
  ].join('\n\n')).button('Close');
  await f.show(player);
}

async function confirmReset(player) {
  const r = await new MessageFormData().title('Forget me').body('Erase everything it has learned about you?').button1('Erase').button2('Cancel').show(player);
  if (r.selection === 0) { resetProfile(player); player.sendMessage('§7[Shaftbreaker] Your memory profile was reset.'); }
}

async function worldSettings(player) {
  if (!isOperator(player)) return;
  const c = config();
  const idx = (k) => Math.max(0, ENUMS[k].indexOf(c[k]));
  const f = new ModalFormData().title('World settings')
    .toggle('Enabled', { defaultValue: c.enabled })
    .toggle('Natural encounters', { defaultValue: c.naturalEncounters })
    .dropdown('Preset', ENUMS.preset, { defaultValueIndex: idx('preset') })
    .dropdown('Encounter frequency', ENUMS.frequency, { defaultValueIndex: idx('frequency') })
    .dropdown('Stalking intensity', ENUMS.stalkIntensity, { defaultValueIndex: idx('stalkIntensity') })
    .toggle('Persistent learning', { defaultValue: c.learning })
    .dropdown('Memory decay', ENUMS.memoryDecay, { defaultValueIndex: idx('memoryDecay') })
    .dropdown('Block destruction', ENUMS.blockDestruction, { defaultValueIndex: idx('blockDestruction') })
    .dropdown('Player-build alteration', ENUMS.playerBuildAlteration, { defaultValueIndex: idx('playerBuildAlteration') })
    .toggle('Den generation', { defaultValue: c.denGeneration })
    .dropdown('Torch manipulation', ENUMS.torchManipulation, { defaultValueIndex: idx('torchManipulation') })
    .slider('Max hunt (seconds)', 10, 40, { defaultValue: c.maxHuntSeconds, valueStep: 1 })
    .slider('Post-death grace (seconds)', 60, 180, { defaultValue: c.deathGraceSeconds, valueStep: 5 })
    .toggle('Chase music', { defaultValue: c.chaseMusic })
    .toggle('Quiet hunt variant (ultra rare)', { defaultValue: c.quietHunt })
    .toggle('Surface mode (advanced)', { defaultValue: c.surfaceMode })
    .toggle('Harmless preview (no damage, no block edits)', { defaultValue: c.harmless })
    .toggle('Trophy drop on defeat', { defaultValue: c.trophyDrop })
    .dropdown('Debug logging', ENUMS.debug, { defaultValueIndex: idx('debug') })
    .toggle('Stalk creative-mode players too (no damage)', { defaultValue: c.creativeEncounters })
    .toggle('Night stalking on the surface', { defaultValue: c.nightStalking });
  const r = await f.show(player);
  if (r.canceled || !r.formValues) return;
  const v = r.formValues;
  const newPreset = ENUMS.preset[/** @type {number} */ (v[2])];
  if (newPreset !== c.preset) applyPreset(newPreset);
  const map = [['enabled', 0], ['naturalEncounters', 1], ['learning', 5], ['denGeneration', 9], ['chaseMusic', 13], ['quietHunt', 14], ['surfaceMode', 15], ['harmless', 16], ['trophyDrop', 17]];
  for (const [k, i] of map) setConfig(k, !!v[i]);
  const en = [['frequency', 3], ['stalkIntensity', 4], ['memoryDecay', 6], ['blockDestruction', 7], ['playerBuildAlteration', 8], ['torchManipulation', 10], ['debug', 18]];
  if (newPreset === c.preset) for (const [k, i] of en) setConfig(k, ENUMS[k][/** @type {number} */ (v[i])]);
  else setConfig('debug', ENUMS.debug[/** @type {number} */ (v[18])]);
  setConfig('maxHuntSeconds', Number(v[11]));
  setConfig('deathGraceSeconds', Number(v[12]));
  setConfig('creativeEncounters', !!v[19]);
  setConfig('nightStalking', !!v[20]);
  player.sendMessage('§7[Shaftbreaker] World settings saved.');
}

export { safe };


// =================================================================== the Breaker's Wheel
export const WHEEL_ID = 'shaftbreaker:breakers_wheel';

function hasItem(player, id) {
  return !!safe('inv', () => {
    const inv = /** @type {any} */ (player.getComponent('minecraft:inventory'))?.container;
    if (!inv) return false;
    for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (it && it.typeId === id) return true; }
    return false;
  }, false);
}

/** first join, and after every death (world switch): you get the Wheel */
export function giveWheel(player, initial) {
  if (!valid(player) || !config().giveWheel) return;
  if (initial && player.getDynamicProperty('sb:wheelGiven')) return;
  if (hasItem(player, WHEEL_ID)) return;
  safe('giveWheel', () => {
    const inv = /** @type {any} */ (player.getComponent('minecraft:inventory'))?.container;
    if (inv) inv.addItem(new ItemStack(WHEEL_ID, 1));
    player.setDynamicProperty('sb:wheelGiven', true);
    if (initial) player.sendMessage('§8You are carrying a rusted winding wheel with an eye in it. §7Use it: the Breaker\'s Wheel.');
  });
}

function moodText(player) {
  const s = pstate(player);
  const c = creature();
  const t = s.tension || 0;
  const mood = !c ? '§7It is not here.' : t > 70 ? '§4It is furious with you.' : t > 40 ? '§cIt is losing patience.' : t > 15 ? '§6It is watching you closely.' : '§7It is curious about you.';
  const where = !c ? '' : (() => { const d = dist(c.loc, player.location); return d < 12 ? ' §4It is very close.' : d < 30 ? ' §cIt is near.' : ' §7It is somewhere in the dark.'; })();
  return mood + where;
}

/** the Wheel's main face */
export async function openWheel(player) {
  playFor(player, 'shaftbreaker.dial', undefined, 0.7, 0.7);
  const op = isOperator(player);
  const d = diff();
  const lines = [
    `§7How hard: §f${d.label}${config().harmless ? ' §8(cannot hurt you)' : ''}§7   How often: §f${config().frequency}`,
    moodText(player),
    pstate(player).hollows ? '§8You are in the Hollows. This is its land.' : '',
  ].filter(Boolean);
  const buttons = [];
  const form = new ActionFormData().title("§lThe Breaker's Wheel").body(lines.join('\n'));
  const add = (label, fn, icon) => { buttons.push(fn); if (icon) form.button(label, icon); else form.button(label); };
  if (op) add('Make it do something', () => doSomething(player), 'textures/items/sb_breakers_wheel');
  if (op) add('How hard it is', () => howHard(player));
  if (op) add('Switches', () => switches(player));
  add('Its mood', () => itsMood(player, op));
  add('Field notes', () => fieldNotes(player));
  if (op) add('Sounds and music', () => soundsAndMusic(player));
  add('Find the Hollows', () => findHollows(player));
  add('Personal settings', () => personal(player));
  if (op) add('All world settings (advanced)', () => worldSettings(player));
  const r = await form.show(player);
  if (r.canceled || r.selection === undefined) return;
  return buttons[r.selection]();
}

/** @type {[string, (p:any) => any][]} */
const ACTIONS = [
  ['Stand still where I will see it', (p) => forceShow(p, 'still')],
  ['Watch me from a ledge above', (p) => forceShow(p, 'ledge')],
  ['Hang from the ceiling over me', (p) => forceShow(p, 'ceiling')],
  ['Be right behind me', (p) => forceShow(p, 'behind')],
  ['Wait ahead of me, round the corner', (p) => forceShow(p, 'ahead')],
  ['Hide behind a tree or pillar and peek', (p) => forceShow(p, 'peek')],
  ['A standoff (it tests me)', (p) => forceShow(p, 'any', 'standoff')],
  ['Lunge at me', (p) => forceShow(p, 'any', 'lunge')],
  ['Snap: scream and chase me', (p) => forceShow(p, 'any', 'rage')],
  ['Flee when I see it', (p) => forceShow(p, 'any', 'flee')],
  ['Jumpscare me', (p) => forceShow(p, 'behind', 'jumpscare')],
  ['Ambush me (in a few seconds)', (p) => { setMood(p, 'ambush'); return 'it will come at you from behind'; }],
  ['Roar', (p) => { const c = creature(); if (c) { playFor(p, 'shaftbreaker.roar', c.loc, 1.0); shake(p, 0.4, 1.2); return 'it roared'; } playFor(p, 'shaftbreaker.roar', undefined, 1.0); return 'it roared somewhere far away'; }],
  ['Whisper to me', (p) => (whisper(p, true) ? 'listen' : 'no')],
  ['Eyes in the dark', (p) => (startEyes(p, true) ? 'look around' : 'no dark place in sight')],
  ['Play a mind game', (p) => (mindGame(p, true) ? '...' : 'mind games are switched off')],
  ['Mimic my sounds', (p) => forceById(p, 'mimic')],
  ['Knock on my door (indoors at night)', (p) => forceById(p, 'knock_door')],
  ['Visit me when I sleep (use a bed first)', (p) => (p.isSleeping ? forceById(p, 'bedside') : 'get into a bed, then ask again')],
  ['Grow a den near me (underground)', (p) => (tryGenerateDen(p) ? 'a den is growing somewhere close' : 'no chamber for a den here, or there is one nearby')],
  ['Send me a guide moth', (p) => guideNow(p)],
  ['Send it away', () => { stopEncounter(); return 'it is gone, for now'; }],
];

async function doSomething(player) {
  const f = new ActionFormData().title('Make it do something').body('§7It does it to you, now. Some need a place: a ceiling, a ledge, trees, the dark.');
  for (const [label] of ACTIONS) f.button(label);
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined) return;
  const msg = safe('wheelAction', () => ACTIONS[/** @type {number} */ (r.selection)][1](player), 'it would not');
  player.sendMessage(`§8[Wheel] §7${msg}`);
}

async function howHard(player) {
  const keys = ['easy', 'normal', 'hard', 'nightmare'];
  const f = new ActionFormData().title('How hard it is').body('§7How dangerous the Shaftbreaker is in this world.');
  for (const k of keys) f.button(`${config().difficulty === k && !config().harmless ? '§l' : ''}${DIFFICULTY[k].label}\n§8${DIFFICULTY[k].blurb.slice(0, 60)}`);
  f.button(`${config().harmless ? '§l' : ''}Harmless\n§8It does everything, but never hurts you`);
  f.button('How often things happen');
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined) return;
  const i = /** @type {number} */ (r.selection);
  if (i < 4) {
    setConfig('difficulty', keys[i]); setConfig('harmless', false);
    setConfig('maxHuntSeconds', DIFFICULTY[keys[i]].chase);
    player.sendMessage(`§8[Wheel] §7${DIFFICULTY[keys[i]].label}: ${DIFFICULTY[keys[i]].blurb}`);
  } else if (i === 4) { setConfig('harmless', true); player.sendMessage('§8[Wheel] §7Harmless: it will never hurt you or touch a block.'); }
  else return howOften(player);
}

async function howOften(player) {
  const opts = [['rare', 'Rarely', 'long quiet stretches'], ['balanced', 'Normal', 'a sighting every couple of minutes'], ['frequent', 'Often', 'it hardly leaves you alone'], ['relentless', 'Relentless', 'it is always there']];
  const f = new ActionFormData().title('How often').body('§7How often it shows itself and comes for you.');
  for (const [k, l, b] of opts) f.button(`${config().frequency === k ? '§l' : ''}${l}\n§8${b}`);
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined) return;
  setConfig('frequency', opts[/** @type {number} */ (r.selection)][0]);
  player.sendMessage(`§8[Wheel] §7How often: ${opts[/** @type {number} */ (r.selection)][1]}`);
}

const SWITCHES = [
  ['enabled', 'The Shaftbreaker is active'],
  ['!harmless', 'It can hurt you'],
  ['jumpscares', 'Jumpscares (its face in yours)'],
  ['mindGames', 'Mind games (whispers, words on screen, fourth wall)'],
  ['darkness', 'Darkness and fog (red rage fog, the dark closing in)'],
  ['cameraShake', 'Camera shake'],
  ['eyesInDark', 'Eyes in the dark'],
  ['mimicry', 'It mimics your sounds'],
  ['nightStalking', 'It stalks you on the surface at night'],
  ['dayStalking', 'It stalks you on the surface by day too'],
  ['daylightSafe', 'Daylight ends its chases'],
  ['creativeEncounters', 'It stalks creative-mode players (no damage)'],
  ['denGeneration', 'Dens grow in the caves'],
  ['chaseMusic', 'Chase music'],
  ['giveWheel', 'Players get the Wheel on joining and after dying'],
];

async function switches(player) {
  const c = config();
  const f = new ModalFormData().title('Switches');
  for (const [k, label] of SWITCHES) f.toggle(label, { defaultValue: k.startsWith('!') ? !c[k.slice(1)] : !!c[k] });
  f.dropdown('It breaks things in its way', ['Never', 'Only in its dens', 'Natural stone, doors, glass (put back after)'], { defaultValueIndex: Math.max(0, ['off', 'den', 'natural'].indexOf(c.blockDestruction)) });
  const r = await f.show(player);
  if (r.canceled || !r.formValues) return;
  SWITCHES.forEach(([k], i) => { const v = !!r.formValues[i]; if (k.startsWith('!')) setConfig(k.slice(1), !v); else setConfig(k, v); });
  setConfig('blockDestruction', ['off', 'den', 'natural'][/** @type {number} */ (r.formValues[SWITCHES.length])]);
  player.sendMessage('§8[Wheel] §7Saved.');
}

const HABIT_TEXT = {
  stare: 'you stare it down', charge: 'you run at it', flee: 'you run from it', fight: 'you fight it', hide: 'you shut yourself in', ignore: 'you turn your back on it',
};

async function itsMood(player, op) {
  const s = pstate(player);
  const r = reactions(player);
  const lines = [moodText(player), `§7Tension §f${Math.round(s.tension || 0)}§7/100   §7A chase is ${huntDue(s, player) ? '§cdue' : '§7not due yet'}`];
  const habits = Object.entries(HABIT_TEXT).filter(([k]) => (r[k] || 0) >= 2).sort((a, b) => (r[b[0]] || 0) - (r[a[0]] || 0)).slice(0, 3);
  if (habits.length) { lines.push('', '§7It has noticed that:'); for (const [k, t] of habits) lines.push(` §8• §f${t} §8(${r[k]}x)`); }
  const learned = topTraits(player, 3);
  if (learned.length) { lines.push('', '§7It has learned your escapes:'); for (const [k, t] of learned) lines.push(` §8• §f${SIGNAL_TEXT[k]} §8(${Math.round(t.s)}%)`); }
  const f = new ActionFormData().title('Its mood').body(lines.join('\n'));
  const acts = [];
  if (op) {
    f.button('Calm it'); acts.push(() => setMood(player, 'calm'));
    f.button('Make it watch me'); acts.push(() => setMood(player, 'watching'));
    f.button('Make it furious'); acts.push(() => setMood(player, 'angry'));
    f.button('Make it hunt me now'); acts.push(() => forceShow(player, 'any', 'rage'));
  }
  f.button('Forget me (it unlearns everything about me)'); acts.push(() => confirmReset(player));
  const res = await f.show(player);
  if (res.canceled || res.selection === undefined) return;
  const out = await acts[/** @type {number} */ (res.selection)]();
  if (typeof out === 'string') player.sendMessage(`§8[Wheel] §7${out}`);
}

/** @type {[string, string, boolean?][]} */
const SOUNDS = [
  ['Music: it is near', 'music.shaftbreaker.presence', true], ['Music: it is close', 'music.shaftbreaker.close', true],
  ['Music: the standoff', 'music.shaftbreaker.standoff', true], ['Music: the chase', 'music.shaftbreaker.chase', true],
  ['Music: the Hollows', 'music.shaftbreaker.hollows', true],
  ['Its roar', 'shaftbreaker.roar'], ['Its scream', 'shaftbreaker.screech'], ['Jumpscare', 'shaftbreaker.jumpscare'],
  ['The moment you see it', 'shaftbreaker.sting_reveal'], ['A whisper', 'shaftbreaker.whisper'], ['Static', 'shaftbreaker.static'],
  ['A scream far away', 'shaftbreaker.distant_scream'], ['Its neck cracking', 'shaftbreaker.neck_crack'], ['Its growl', 'shaftbreaker.growl'],
  ['Heartbeat', 'shaftbreaker.heartbeat'],
];

async function soundsAndMusic(player) {
  const f = new ActionFormData().title('Sounds and music').body('§7Hear anything it makes. Music keeps playing until you pick "Stop the music".');
  for (const [l] of SOUNDS) f.button(String(l));
  f.button('Stop the music');
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined) return;
  const i = /** @type {number} */ (r.selection);
  if (i >= SOUNDS.length) { endPreview(player); return; }
  const [, id, music] = SOUNDS[i];
  if (music) previewMusic(player, /** @type {string} */ (id), 150); else playFor(player, /** @type {string} */ (id), undefined, 1.0);
  return soundsAndMusic(player);
}

/** scan what is loaded around you for the Hollows */
async function findHollows(player) {
  const dim = player.dimension;
  let msg;
  if (inHollows(dim, player.location)) msg = '§7You are standing in the Hollows. §8Its land: it is about by day here too, the fog is its, and its dens grow fast underground.';
  else {
    let best = null;
    for (let r = 24; r <= 256 && !best; r += 24) {
      for (let k = 0; k < 24; k++) {
        const a = k / 24 * Math.PI * 2;
        const q = { x: player.location.x + Math.cos(a) * r, y: Math.max(dim.heightRange.min + 1, Math.min(dim.heightRange.max - 1, player.location.y)), z: player.location.z + Math.sin(a) * r };
        if (inHollows(dim, q)) { best = { q, r }; break; }
      }
    }
    msg = best ? `§7The Hollows lie §f${compassName(player.location, best.q)}§7, about §f${best.r}§7 blocks away.`
      : '§7No Hollows within the loaded land around you. §8It replaces windswept hills, stony peaks, savannas and badlands, but only in land generated after you installed this version. With cheats on: §f/locate biome shaftbreaker:the_hollows';
  }
  const r = await new MessageFormData().title('The Hollows').body(msg).button1('Close').button2('Back').show(player);
  if (r.selection === 1) return openWheel(player);
}

export async function fieldNotes(player, page = 0) {
  const open = unlockedNotes(player);
  const per = 6;
  const pages = Math.ceil(FIELD_NOTES.length / per);
  const slice = FIELD_NOTES.slice(page * per, page * per + per);
  const body = slice.map((n) => (open.has(n.id) ? `§f§l${n.title}§r\n§7${n.text}` : `§8§l???§r\n§8${n.hint}`)).join('\n\n');
  const f = new ActionFormData().title(`Field notes ${page + 1}/${pages}  (${open.size}/${FIELD_NOTES.length})`).body(body);
  if (page > 0) f.button('Previous page');
  if (page < pages - 1) f.button('Next page');
  f.button('Close');
  const r = await f.show(player);
  if (r.canceled || r.selection === undefined) return;
  const labels = [...(page > 0 ? ['prev'] : []), ...(page < pages - 1 ? ['next'] : []), 'close'];
  const pick = labels[/** @type {number} */ (r.selection)];
  if (pick === 'prev') return fieldNotes(player, page - 1);
  if (pick === 'next') return fieldNotes(player, page + 1);
}

export { HOLLOWS, now, markDirty, jumpscare };
