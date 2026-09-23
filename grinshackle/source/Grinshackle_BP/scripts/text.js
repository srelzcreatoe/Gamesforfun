// Short original text. Atmosphere goes to chat rarely; mechanics go to the actionbar (which also serves as the subtitle channel).
import { S } from './state.js';
import { safe, isValid } from './util.js';
import { prefs } from './config.js';

export const LINES = Object.freeze({
  steps: 'One step too many.',
  silent: 'It stopped dragging the chain.',
  tap: 'The last tap was not yours.',
  counted: 'Something counted your steps.',
  grin: 'The grin has not moved.',
  held: 'It is holding the chain still.',
  gone: 'The cave is only a cave again.',
  watched: 'It let you see it.',
});
export const CUES = Object.freeze({
  rattle: '[chains rattle nearby]',
  snap: '[a chain snaps — it is faster]',
  windup: '[it is winding up]',
  windup_slam: '[it raises both arms]',
  light: '[it hesitates at the light]',
  lost: '[it lost you]',
  gone: '[it has gone]',
  lure_ok: '[decoy: it turned toward the sound]',
  lure_weak: '[decoy: it barely turned its head]',
  lure_ignored: '[decoy: it is not listening]',
  warning: '[a warning growl]',
  roar: '[a roar shakes the chains]',
  release: '[a chain clicks loose]',
  tap: '[a metallic tap, deeper in]',
  footsteps: '[footsteps that are not yours]',
  drag: '[something drags a chain]',
  duplicate: '[only one Grinshackle can exist — the extra one dissolved]',
  preview: '[preview: harmless — it will not target anyone]',
});

const LINE_GAP = 1800; // 90 s
export function line(player, key) {
  if (!isValid(player) || !(S.config && S.config.atmosphericLines)) return;
  const r = S.record; const last = r ? r.lastLine : S.loops.get('line') || 0;
  if (S.tick - last < LINE_GAP) return;
  if (r) r.lastLine = S.tick; else S.loops.set('line', S.tick);
  const text = LINES[key]; if (!text) return;
  safe(() => player.sendMessage('§8§o' + text));
}
export function cue(player, key) {
  if (!isValid(player) || !(S.config && S.config.subtitles)) return;
  if (!prefs(player).subtitles) return;
  const text = CUES[key]; if (!text) return;
  safe(() => player.onScreenDisplay.setActionBar('§7' + text));
}
export function notify(player, text) {
  if (isValid(player)) safe(() => player.sendMessage('§6[Grinshackle] §r' + text));
  else try { console.warn('[Grinshackle] ' + text); } catch { /* ignore */ }
}
export function gateSentence(reason, detail) {
  switch (reason) {
    case 'disabled': return 'Master is OFF — nothing will spawn or act.';
    case 'natural_off': return 'Natural spawning is OFF (previews and tests still work).';
    case 'peaceful': return 'Difficulty is Peaceful — Grinshackle stays away.';
    case 'grace': return `Grace period: ${detail} s left before the first encounter can start.`;
    case 'cooldown': return `Cooldown: next encounter check in ${detail} s.`;
    case 'no_eligible_player': return 'No eligible target (Survival/Adventure, alive, in the Overworld, not just respawned).';
    case 'wrong_habitat': return `No player is underground at or below Y=${(detail || '').replace('maxY ', '')}.`;
    case 'reserved_active': return `An encounter is active (${detail}).`;
    case 'reserved_unloaded': return `A Grinshackle is reserved but its area is unloaded (${detail}). It resumes when loaded or retires after the lost-reservation timeout.`;
    case 'no_safe_location': return 'No collision-safe, dark, out-of-view floor with headroom was found within range on the last attempt.';
    case 'ok': return 'Gate open — an encounter may begin on the next check.';
    default: return reason;
  }
}
