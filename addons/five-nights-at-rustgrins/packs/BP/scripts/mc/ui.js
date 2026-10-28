// Forms (stable @minecraft/server-ui). Every form re-opens once if the player
// was busy (FormCancelationReason.UserBusy) and treats closing as "no
// change", so a dismissed form never leaves the game half-way.

import { system } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData, FormCancelationReason, uiManager } from '@minecraft/server-ui';
import { CAMERAS, CAMERA_BY_ID } from '../data/cameras.js';
import { CLIPPINGS, GUIDE } from '../data/story.js';
import { CONFIG, CAST, CAST_NAMES } from '../core/config.js';
import { log } from './log.js';

/** @param {import('@minecraft/server').Player} player */
async function show(player, form, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await form.show(player);
      if (r.canceled && r.cancelationReason === FormCancelationReason.UserBusy && i < retries) {
        await new Promise((res) => system.runTimeout(() => res(undefined), 10));
        continue;
      }
      return r;
    } catch (e) {
      log.warn(`form failed: ${e?.message ?? e}`);
      return undefined;
    }
  }
  return undefined;
}

/**
 * The clickable camera map. A form whose title starts with this mark is drawn
 * by the resource pack (ui/server_form.json) as the pizzeria map in the
 * bottom-right corner: one button per camera in CAMERAS order, then LOWER,
 * then PLAY SHOW. The feed stays visible around the map.
 */
export const CAM_FORM_MARK = '§k§r§k§r§m';

/** Show the camera map once. Resolves to { kind: 'cam', id } | { kind: 'close' } | { kind: 'wind' } | { kind: 'dismissed', reason } | undefined. */
/** @param {import('@minecraft/server').Player} player */
export async function cameraMapForm(player, snap) {
  const live = snap.devices.cam;
  const f = new ActionFormData().title(`${CAM_FORM_MARK}SECURITY CAMERAS`).body(CAMERA_BY_ID[live]?.label ?? '');
  for (const c of CAMERAS) f.button(`${c.id === live ? '§a' : ''}${c.id}`);
  f.button('§cLOWER');
  f.button(live === '8' && snap.tape ? `§6PLAY SHOW ${snap.tape.pct}%` : '§8PLAY SHOW');
  let r;
  try {
    r = await f.show(player);
  } catch (e) {
    log.warn(`camera map form failed: ${e?.message ?? e}`);
    return undefined;
  }
  if (r.canceled) return { kind: 'dismissed', reason: r.cancelationReason };
  if (r.selection === CAMERAS.length) return { kind: 'close' };
  if (r.selection === CAMERAS.length + 1) return { kind: 'wind' };
  const c = CAMERAS[r.selection ?? -1];
  return c ? { kind: 'cam', id: c.id } : undefined;
}

/** @param {import('@minecraft/server').Player} player */
export function closeForms(player) {
  try {
    uiManager.closeAllForms(player);
  } catch (e) {
    log.warn(`closeAllForms: ${e?.message ?? e}`);
  }
}

/** Accessible office remote: every control from one menu. Resolves to an action or undefined. */
/** @param {import('@minecraft/server').Player} player */
export async function officeRemote(player, snap) {
  const d = snap.devices;
  const st = (b, on, off) => (b ? on : off);
  const items = [
    ['door_l', `LEFT DOOR  ${st(d.doorL, '§6[shut]', '§2[open]')}`],
    ['light_l', `LEFT LIGHT  ${st(d.lightL, '§e[on]', '§8[off]')}`],
    ['door_r', `RIGHT DOOR  ${st(d.doorR, '§6[shut]', '§2[open]')}`],
    ['light_r', `RIGHT LIGHT  ${st(d.lightR, '§e[on]', '§8[off]')}`],
    ['vent_l', `LEFT VENT  ${st(d.ventL, '§6[closed]', '§2[open]')}`],
    ['vent_r', `RIGHT VENT  ${st(d.ventR, '§6[closed]', '§2[open]')}`],
    ['cams_toggle', d.camsOpen ? 'LOWER MONITOR' : 'RAISE MONITOR'],
  ];
  if (snap.tape && d.camsOpen && d.cam === '8') items.push(['wind', `§6PLAY SHOW (${snap.tape.pct}%)`]);
  items.push(['mute_call', 'MUTE CALL']);
  const f = new ActionFormData().title('§lOFFICE REMOTE').body(`Power ${snap.powerPct}%  ·  usage ${snap.usage}`);
  for (const [, label] of items) f.button(label);
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined) return undefined;
  return items[r.selection][0];
}

/** Shift guide: a topic menu; each topic explains one mechanic. */
/** @param {import('@minecraft/server').Player} player */
export async function guide(player) {
  for (;;) {
    const menu = new ActionFormData().title('§lSHIFT GUIDE').body('Pick a topic.\n§7The night keeps running while this is open.');
    for (const [t] of GUIDE) menu.button(t);
    menu.button('§cClose');
    const r = await show(player, menu);
    if (!r || r.canceled || r.selection === undefined || r.selection >= GUIDE.length) return;
    const [title, body] = GUIDE[r.selection];
    const page = new ActionFormData().title(`§l${title.toUpperCase()}`).body(body).button('Back').button('Close');
    const r2 = await show(player, page);
    if (!r2 || r2.canceled || r2.selection !== 0) return;
  }
}

/** @param {import('@minecraft/server').Player} player */
export async function confirm(player, title, body, yes = 'Yes', no = 'Cancel') {
  const f = new MessageFormData().title(title).body(body).button1(no).button2(yes);
  const r = await show(player, f);
  return r?.selection === 1;
}

/** @param {import('@minecraft/server').Player} player */
export async function messageBox(player, title, body, button = 'OK') {
  const f = new ActionFormData().title(title).body(body).button(button);
  await show(player, f);
}

/** @param {import('@minecraft/server').Player} player */
export async function settingsForm(player, s) {
  const f = new ModalFormData()
    .title('§lSETTINGS')
    .toggle('Captions for important sounds', { defaultValue: s.captions })
    .toggle('Gameplay tips', { defaultValue: s.hints })
    .toggle('Music in the lobby and free roam', { defaultValue: s.music })
    .toggle('Camera map on screen while watching the cameras', { defaultValue: s.camMap })
    .toggle('Clickable camera map (mouse, controller or touch)', { defaultValue: s.camCursor })
    .toggle('Developer overlay', { defaultValue: s.debugOverlay })
    .toggle('Deterministic nights (fixed seed)', { defaultValue: s.deterministic })
    .slider('Seed', 1, 9999, { defaultValue: Math.max(1, Math.min(9999, s.seed)), valueStep: 1 });
  const r = await show(player, f);
  if (!r || r.canceled || !r.formValues) return undefined;
  const [captions, hints, music, camMap, camCursor, debugOverlay, deterministic, seed] = r.formValues;
  return { captions: !!captions, hints: !!hints, music: !!music, camMap: !!camMap, camCursor: !!camCursor, debugOverlay: !!debugOverlay, deterministic: !!deterministic, seed: Number(seed) || 1991 };
}

/** Custom Night: presets or six sliders. Resolves to an AI map or undefined. */
/** @param {import('@minecraft/server').Player} player */
export async function customNightForm(player, last) {
  const f = new ActionFormData().title('§lCUSTOM NIGHT').body('Pick a preset or set every animatronic yourself (0-20).');
  f.button('§lSet levels...');
  for (const p of CONFIG.presets) f.button(p.title);
  f.button('§cBack');
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined) return undefined;
  if (r.selection === 0) {
    const m = new ModalFormData().title('§lCUSTOM NIGHT');
    for (const id of CAST) m.slider(CAST_NAMES[id], 0, 20, { defaultValue: last?.[id] ?? 5, valueStep: 1 });
    const r2 = await show(player, m);
    if (!r2 || r2.canceled || !r2.formValues) return undefined;
    return Object.fromEntries(CAST.map((id, i) => [id, Number(r2.formValues[i]) || 0]));
  }
  const preset = CONFIG.presets[r.selection - 1];
  return preset ? { ...preset.ai } : undefined;
}

/** @param {import('@minecraft/server').Player} player */
export async function clippingsForm(player, save) {
  for (;;) {
    const have = CLIPPINGS.filter((c) => save.beaten.includes(c.night));
    const f = new ActionFormData().title('§lLOCAL NEWS').body(`Clippings: ${have.length}/${CLIPPINGS.length}. A new one appears every time you survive a night.`);
    for (const c of CLIPPINGS) f.button(save.beaten.includes(c.night) ? c.headline : `§8??? (survive night ${c.night})`);
    f.button('§cClose');
    const r = await show(player, f);
    if (!r || r.canceled || r.selection === undefined || r.selection >= CLIPPINGS.length) return;
    const c = CLIPPINGS[r.selection];
    if (!save.beaten.includes(c.night)) continue;
    const page = new ActionFormData().title(`§l${c.headline}`).body(`§7${c.date}§r\n\n${c.text}`).button('Back').button('Close');
    const r2 = await show(player, page);
    if (!r2 || r2.canceled || r2.selection !== 0) return;
  }
}

/**
 * Result after a night. Resolves to 'next' | 'retry' | 'lobby'.
 * @param {any} player
 * @param {{ won: boolean, label: string, canNext?: boolean, nextLabel?: string, tip?: string }} o
 */
export async function resultForm(player, { won, label, canNext = false, nextLabel = '', tip = '' }) {
  const f = new ActionFormData().title(won ? `§l${label.toUpperCase()} COMPLETE` : '§lGAME OVER');
  f.body(won ? 'You made it to 6 AM.' : `${label}.${tip ? `\n\n§e${tip}` : ''}`);
  const options = [];
  if (won && canNext) {
    f.button(`Continue: ${nextLabel}`);
    options.push('next');
  }
  f.button(won ? `Replay ${label}` : `Retry ${label}`);
  options.push('retry');
  f.button('Back to the time clock');
  options.push('lobby');
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined) return 'lobby';
  return options[r.selection];
}

/** First join on a world without the map. Resolves to 'build' | 'later'. */
/** @param {import('@minecraft/server').Player} player */
export async function setupForm(player) {
  const f = new MessageFormData()
    .title("§lFIVE NIGHTS AT RUSTGRIN'S")
    .body("Build Rustgrin's Pizza Revue here?\n\nThe pizzeria and its lot (about 140 x 105 blocks) will be built around where you stand, clearing what is there. A §lFlat world§r works best.\n\nYou can also do it later with /fnar:setup (cheats on).")
    .button1('Later')
    .button2('Build it here');
  const r = await show(player, f);
  return r?.selection === 1 ? 'build' : 'later';
}

/** @param {import('@minecraft/server').Player} player */
export async function galleryInfo(player, id) {
  const lines = {
    rustgrin: 'RUSTGRIN - lead singer of the Rusty Revue since 1984. Grey fur, red vest, a microphone he never puts down. Moves only when nobody is watching.',
    mirehop: 'MIREHOP - guitarist. His amp still hums at night. Prefers the west hall.',
    noxbriar: 'NOXBRIAR - backup vocals, the darkest costume in the building. On camera, look for the eyes.',
    purple_rat: 'PURPLE RAT - maracas. Nervous, twitchy, always in the vents.',
    cat: "THE CAT - star of Kitty's Cabaret. Fast. Very fast.",
    top_hat_rat: 'THE RINGMASTER - Marvello\'s Midnight Midway. The show must go on.',
  };
  await messageBox(player, `§l${CAST_NAMES[id].toUpperCase()}`, lines[id] ?? '');
}
