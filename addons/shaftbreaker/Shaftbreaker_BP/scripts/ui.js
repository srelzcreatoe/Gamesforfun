// @ts-check
import { ActionFormData, ModalFormData, MessageFormData } from '@minecraft/server-ui';
import { config, setConfig, applyPreset, ENUMS, prefs, setPrefs } from './core/config.js';
import { isOperator, compassName, worldTicks, safe } from './core/util.js';
import { profile, topTraits, SIGNAL_TEXT, resetProfile } from './ai/memory.js';
import { pstate } from './ai/director.js';
import { ws, nearestDen } from './ai/worldstate.js';
import { playFor } from './audio.js';

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
    '§fIt usually only watches.§7 Most meetings end with it backing into the dark.',
    '§fEvery real attack is announced:§7 a roar or, rarely, dust, breath and a raised claw. You always get a moment.',
    '§fIt learns slowly and forgets slowly.§7 Using the same escape again and again makes it wait for you there. Change routes.',
    '§fLight, company and preparation make it leave.§7 Groups are watched from afar.',
    '§fIt will not follow you into daylight§7 (unless your world enables surface mode).',
    '§fMeat§7 dropped near it can distract it. Not always.',
    '§fShaft moths§7 drift toward its den. Breaking the Den Heart quiets the territory for days, but it remembers.',
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
    .dropdown('Debug logging', ENUMS.debug, { defaultValueIndex: idx('debug') });
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
  player.sendMessage('§7[Shaftbreaker] World settings saved.');
}

export { safe };
