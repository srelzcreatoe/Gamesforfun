// Forms (stable @minecraft/server-ui). Every form re-opens itself once if the
// player was busy (FormCancelationReason.UserBusy) and treats closing as "no
// change", so a dismissed form never leaves the game in a half state.

import { system } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData, FormCancelationReason } from '@minecraft/server-ui';
import { CAMERAS, CAMERA_MAP_LAYOUT } from '../data/cameras.js';
import { SECRETS, TUTORIAL_STEPS, CLIPPINGS, FINAL_CHOICE } from '../data/story.js';
import { CONFIG } from '../core/config.js';
import { GUIDE_SECTIONS } from '../data/guide_text.js';
import { log } from './log.js';

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

/** Camera selection map. Resolves to a camera id, 'close', or undefined. */
export async function cameraMenu(player, snap) {
  const f = new ActionFormData().title('§lSECURITY CAMERAS');
  const order = CAMERAS.slice().sort((a, b) => {
    const pa = CAMERA_MAP_LAYOUT[a.id];
    const pb = CAMERA_MAP_LAYOUT[b.id];
    return pa[1] - pb[1] || pa[0] - pb[0];
  });
  f.body(`Night ${snap.night} · Power ${snap.powerPct}% · ${snap.devices.camsOpen ? `Viewing ${snap.devices.cam}` : 'Monitor down'}\nScroll the hotbar (or LB/RB) to step through cameras. Sneak to lower the monitor.`);
  for (const c of order) f.button(`${c.label}${c.id === snap.devices.cam && snap.devices.camsOpen ? '  §2[LIVE]' : ''}`);
  f.button('§cLOWER MONITOR');
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined) return undefined;
  if (r.selection === order.length) return 'close';
  return order[r.selection].id;
}

/** Accessible office remote: every console action from one menu. */
export async function officeRemote(player, snap) {
  const d = snap.devices;
  const items = [
    ['door_l', `LEFT DOOR  ${d.doorL ? '§6[closed]' : '§2[open]'}`],
    ['light_l', `LEFT LIGHT  ${d.lightL ? '§2[on]' : '§8[off]'}`],
    ['door_r', `RIGHT DOOR  ${d.doorR ? '§6[closed]' : '§2[open]'}`],
    ['light_r', `RIGHT LIGHT  ${d.lightR ? '§2[on]' : '§8[off]'}`],
    ['cams_toggle', d.camsOpen ? 'LOWER MONITOR' : 'RAISE MONITOR'],
  ];
  if (snap.hatchInstalled) items.push(['hatch', `HATCH  ${d.hatch ? '§6[sealed]' : '§2[open]'}`]);
  if (snap.strobe.installed) items.push(['strobe', `§6EMERGENCY STROBE (${snap.strobe.charges})`]);
  if (snap.breaker.tripped) items.push(['breaker', '§cRESET BREAKER']);
  if (snap.powerOut?.stage === 'reserve') items.push(['reserve', '§c§lPULL EMERGENCY RESERVE']);
  const f = new ActionFormData().title('§lOFFICE REMOTE').body(`Power ${snap.powerPct}% · usage ${snap.usage}/5`);
  for (const [, label] of items) f.button(label);
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined) return undefined;
  return items[r.selection][0];
}

/**
 * Shift Guide: a Music ON/OFF switch, then a topic menu; each topic explains
 * one mechanic (data/guide_text.js).
 * @param {any} player
 * @param {{ music?: () => boolean, toggleMusic?: () => void }} [hooks]
 */
export async function guide(player, hooks = {}) {
  for (;;) {
    const musicOn = hooks.music?.() ?? true;
    const menu = new ActionFormData()
      .title('§lSHIFT GUIDE')
      .body('Pick a topic. Every mechanic of the game is explained here.\n§7The night keeps running while this menu is open.');
    menu.button(musicOn ? '§2♫ Music: ON §7(press to turn off)' : '§8♫ Music: OFF §7(press to turn on)');
    for (const s of GUIDE_SECTIONS) menu.button(s.title);
    menu.button('§cClose');
    const r = await show(player, menu);
    if (!r || r.canceled || r.selection === undefined || r.selection > GUIDE_SECTIONS.length) return;
    if (r.selection === 0) {
      hooks.toggleMusic?.();
      continue;
    }
    const topic = GUIDE_SECTIONS[r.selection - 1];
    const page = new ActionFormData().title(`§l${topic.title.toUpperCase()}`).body(topic.body).button('Back to topics').button('Close');
    const r2 = await show(player, page);
    if (!r2 || r2.canceled || r2.selection !== 0) return;
  }
}

export async function lobbyConfirm(player, title, body, yes = 'Yes', no = 'Cancel') {
  const f = new MessageFormData().title(title).body(body).button1(no).button2(yes);
  const r = await show(player, f);
  return r?.selection === 1;
}

export async function settingsForm(player, settings) {
  const f = new ModalFormData()
    .title('§lSETTINGS')
    .toggle('Captions for audio cues (accessibility)', { defaultValue: settings.captions })
    .toggle('Gameplay hints', { defaultValue: settings.hints })
    .toggle('Deterministic nights (fixed seed, for testing)', { defaultValue: settings.deterministic })
    .slider('Seed (deterministic mode)', 1, 9999, { defaultValue: Math.max(1, Math.min(9999, settings.seed)), valueStep: 1 })
    .toggle('Developer overlay', { defaultValue: settings.debugOverlay })
    .toggle('Night music (12 AM - 6 AM)', { defaultValue: settings.music !== false })
    .toggle('Holiday decorations (Halloween, Christmas)', { defaultValue: settings.holidays !== false });
  const r = await show(player, f);
  if (!r || r.canceled || !r.formValues) return undefined;
  const [captions, hints, deterministic, seed, debugOverlay, music, holidays] = r.formValues;
  return { captions: !!captions, hints: !!hints, deterministic: !!deterministic, seed: Number(seed) || 1983, debugOverlay: !!debugOverlay, music: !!music, holidays: !!holidays };
}

/** Challenge modes. Resolves to a challenge id or undefined. */
export async function challengeForm(player, save) {
  const ids = Object.keys(CONFIG.challenges);
  const f = new ActionFormData().title('§lCHALLENGES').body(`Each challenge is one full night (12-6 AM) with a twist. Beaten: ${save.challenges.length}/${ids.length}\n§7They take something away and give something back.`);
  for (const id of ids) f.button(`${save.challenges.includes(id) ? '§2✔ ' : ''}${CONFIG.challenges[id].title}`);
  f.button('§cClose');
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined || r.selection >= ids.length) return undefined;
  const id = ids[r.selection];
  const c = CONFIG.challenges[id];
  const ok = await lobbyConfirm(player, `§l${c.title.toUpperCase()}`, c.text, 'Start', 'Back');
  return ok ? id : undefined;
}

/** Newspaper clippings: one unlocks per night survived. */
export async function clippingsForm(player, save) {
  for (;;) {
    const have = CLIPPINGS.filter((c) => save.completed.includes(c.night));
    const f = new ActionFormData().title('§lLOCAL NEWS').body(`Clippings found: ${have.length}/${CLIPPINGS.length}. A new one appears every time you survive a night.`);
    for (const c of CLIPPINGS) f.button(save.completed.includes(c.night) ? `§0${c.headline}` : `§8??? - survive night ${c.night}`);
    f.button('§cClose');
    const r = await show(player, f);
    if (!r || r.canceled || r.selection === undefined || r.selection >= CLIPPINGS.length) return;
    const c = CLIPPINGS[r.selection];
    if (!save.completed.includes(c.night)) continue;
    const page = new ActionFormData().title(`§l${c.headline}`).body(`§7${c.date}§r\n\n${c.text}`).button('Back').button('Close');
    const r2 = await show(player, page);
    if (!r2 || r2.canceled || r2.selection !== 0) return;
  }
}

/** Night 7's last decision. Always resolves to 'seal' or 'burn' (asks again if the form is dismissed). */
export async function finalChoiceForm(player) {
  for (let i = 0; i < 6; i++) {
    const f = new MessageFormData().title('§l6 AM').body(FINAL_CHOICE.question).button1(FINAL_CHOICE.seal.button).button2(FINAL_CHOICE.burn.button);
    const r = await show(player, f);
    if (r && !r.canceled && r.selection !== undefined) return r.selection === 1 ? 'burn' : 'seal';
    await new Promise((res) => system.runTimeout(() => res(undefined), 20));
  }
  return 'seal';
}

export async function extrasForm(player, save) {
  const found = new Set(save.secrets);
  const lines = Object.entries(SECRETS).map(([id, [where, text]]) => (found.has(id) ? `§e#${id} ${where}§r\n${text}` : `§8#${id} ???`));
  const endings = [['seal', 'SEALED'], ['burn', 'ASHES']].map(([k, n]) => (save.endings.includes(k) ? `§6${n}` : '§8???')).join('§r · ');
  const ch = Object.entries(CONFIG.challenges).map(([k, c]) => `${save.challenges.includes(k) ? '§2✔' : '§8·'} ${c.title}`).join('§r  ');
  const f = new ActionFormData().title('§lARCHIVE & CREDITS').body([
    `Secrets found: ${found.size}/12`, '', ...lines, '',
    `Endings: ${endings}`, `Challenges: ${ch}`, '',
    '§lCREDITS§r', 'FREDBEAR: SIX NIGHTS BELOW - an original fan-made Minecraft Bedrock map.',
    'Animatronic skins supplied by the map owner.',
    'Fredbear 3D model, texture and animations (Fredbear V6) supplied by the map owner.',
    'Night music: "Pizza Dinner" from the FNAF 1 Remake fan-game soundtrack, supplied by the map owner.',
    'Jumpscares, laughter and camera monitor sounds supplied by the map owner.',
    'Door slam: "storm door slam 01" by volivieri (freesound.org/s/161190, CC BY 4.0), shortened.',
    'Door opening: "Metal Door.wav" by Analog Bleep Ten (freesound.org/s/75826, CC Sampling+ 1.0), trimmed.',
    'Camera hum: "CCTV camera system in op 2" by FOSSarts (freesound.org/s/740223, CC0).',
    'All other sounds synthesised for this project.',
    'Inspired by Five Nights at Freddy\'s (Scott Cawthon). Not affiliated with or endorsed by Scott Cawthon or Mojang.',
  ].join('\n'));
  f.button('Close');
  await show(player, f);
}

export async function resultForm(player, { won, night, canNext, label = `Night ${night}`, hint = '' }) {
  const f = new ActionFormData().title(won ? `§l${label.toUpperCase()} COMPLETE` : '§lGAME OVER');
  f.body(won ? 'You survived until 6 AM.' : `${label}.${hint ? `\n\n§eTip: §r${hint}` : ''}`);
  const options = [];
  if (won && canNext) {
    f.button(`Continue to Night ${night + 1}`);
    options.push('next');
  }
  f.button(won ? `Replay ${label}` : `Retry ${label}`);
  options.push('retry');
  f.button('Return to the lobby');
  options.push('lobby');
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined) return 'lobby';
  return options[r.selection];
}

export async function maintenanceForm(player, title, text) {
  const f = new ActionFormData().title(`§l${title}`).body(text).button('Show me the way').button('Teleport back to the office (task done)');
  const r = await show(player, f);
  return r?.selection === 1 ? 'teleport' : 'guide';
}

export async function messageBox(player, title, body) {
  const f = new ActionFormData().title(title).body(body).button('OK');
  await show(player, f);
}

export const TUTORIAL_COUNT = TUTORIAL_STEPS.length;
