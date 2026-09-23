// Script-event command surface: /scriptevent gs:control <verb ...> (also reachable through /function grinshackle/<name>).
// /scriptevent itself requires operator permission, so every verb here is operator-gated by the game.
import { world } from '@minecraft/server';
import { IDS } from './constants.js';
import { S } from './state.js';
import { safe, isValid } from './util.js';
import * as config from './config.js';
import * as director from './director.js';
import * as preview from './preview.js';
import * as audio from './audio.js';
import * as memory from './memory.js';
import * as items from './items.js';
import { notify } from './text.js';

export function helpText() {
  return 'Verbs: status | spawn (test) | preview [clip|list|next|loop|stop] | end | reset | enable | disable | natural on|off | mute | restore | cooldown | forget [player|all] | dial | admin | debug on|off | preset balanced|slow_dread|relentless|showcase | learn on|off | help';
}
function isPlayer(e) { return isValid(e) && e.typeId === 'minecraft:player'; }

export function handle(source, message) {
  const parts = String(message || '').trim().split(/\s+/);
  const verb = (parts[0] || 'help').toLowerCase(); const arg = parts.slice(1).join(' ');
  const player = isPlayer(source) ? source : undefined;
  const reply = (m) => notify(player, m);
  const on = /^(on|true|1|yes)$/i.test(arg), off = /^(off|false|0|no)$/i.test(arg);
  switch (verb) {
    case 'status': reply(director.statusLine()); break;
    case 'spawn': case 'test': reply(player ? director.spawnTest(player) : 'Run spawn as a player.'); break;
    case 'preview': {
      const a = arg.toLowerCase();
      if (a === 'stop') reply(preview.stop());
      else if (a === 'next') reply(preview.next());
      else if (a === 'list') reply(preview.listText());
      else if (!player) reply('Run preview as a player.');
      else if (!preview.active()) reply(preview.start(player, a && a !== 'loop' ? a : undefined) + (a === 'loop' ? ' ' + preview.play('loop') : ''));
      else reply(preview.play(a || 'idle'));
      break;
    }
    case 'end': { const had = !!(S.record || S.active); director.endEncounter('reset'); const pv = preview.stop(); reply(had ? 'Encounter ended and cleaned up.' : pv); break; }
    case 'reset': director.endEncounter('reset'); preview.stop(); director.resetCooldown(); reply('Encounter state reset; cooldown and grace cleared.'); break;
    case 'enable': config.set('master', true); director.masterOn(); reply('Master ON. Natural encounters resume after the grace period.'); break;
    case 'disable': config.set('master', false); director.masterOff(); preview.stop(); reply('Master OFF: damage disabled, callbacks cancelled, reservation retired, markers cleared, audio stopped.'); break;
    case 'natural':
      if (on) { config.set('naturalSpawning', true); reply('Natural spawning ON.'); }
      else if (off) { config.set('naturalSpawning', false); reply('Natural spawning OFF (previews and test spawns still work).'); }
      else reply('Use: natural on|off'); break;
    case 'mute': audio.mute(true); reply('All Grinshackle sound muted (subtitle cues stay on).'); break;
    case 'restore': audio.mute(false); reply('Grinshackle sound restored.'); break;
    case 'cooldown': director.resetCooldown(); reply('Cooldown and grace cleared; the next natural check can spawn immediately when the gate is open.'); break;
    case 'forget': {
      if (!arg || arg.toLowerCase() === 'me') { if (player) { memory.forget(player.id); reply('Your profile was forgotten.'); } else reply('Use: forget <player>|all'); }
      else if (arg.toLowerCase() === 'all') { memory.forgetAll(); reply('All player profiles forgotten.'); }
      else { const t = safe(() => world.getAllPlayers().find((p) => p.name.toLowerCase() === arg.toLowerCase()), undefined); if (t) { memory.forget(t.id); reply(`Profile of ${t.name} forgotten.`); } else reply(`No online player named "${arg}".`); }
      break;
    }
    case 'dial': reply(player ? items.giveDial(player) : 'Run dial as a player.'); break;
    case 'admin': if (player) { safe(() => player.addTag(IDS.ADMIN_TAG)); reply('You are now a Grinshackle admin (this command already required operator permission).'); } else reply('Run admin as a player.'); break;
    case 'debug': if (on || off) { config.set('debug', on); S.debug = on; reply('Debug ' + (on ? 'ON' : 'OFF') + '.'); } else reply('Use: debug on|off'); break;
    case 'preset': reply(config.applyPreset(arg.toLowerCase()) ? `Preset ${arg} applied.` : 'Presets: balanced, slow_dread, relentless, showcase.'); break;
    case 'learn': if (on || off) { config.set('learning', on); reply('Learning ' + (on ? 'ON' : 'OFF') + '.'); } else reply('Use: learn on|off'); break;
    case 'help': default: reply(helpText()); break;
  }
}
