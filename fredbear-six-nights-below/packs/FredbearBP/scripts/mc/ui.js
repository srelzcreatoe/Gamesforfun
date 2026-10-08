// Forms (stable @minecraft/server-ui). Every form re-opens itself once if the
// player was busy (FormCancelationReason.UserBusy) and treats closing as "no
// change", so a dismissed form never leaves the game in a half state.

import { system } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData, FormCancelationReason } from '@minecraft/server-ui';
import { CAMERAS, CAMERA_MAP_LAYOUT } from '../data/cameras.js';
import { SECRETS, TUTORIAL_STEPS } from '../data/story.js';
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

/** Shift Guide: a topic menu; each topic explains one mechanic (data/guide_text.js). */
export async function guide(player) {
  for (;;) {
    const menu = new ActionFormData()
      .title('§lSHIFT GUIDE')
      .body('Pick a topic. Every mechanic of the game is explained here.\n§7The night keeps running while this menu is open.');
    for (const s of GUIDE_SECTIONS) menu.button(s.title);
    menu.button('§cClose');
    const r = await show(player, menu);
    if (!r || r.canceled || r.selection === undefined || r.selection >= GUIDE_SECTIONS.length) return;
    const topic = GUIDE_SECTIONS[r.selection];
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
    .toggle('Developer overlay', { defaultValue: settings.debugOverlay });
  const r = await show(player, f);
  if (!r || r.canceled || !r.formValues) return undefined;
  const [captions, hints, deterministic, seed, debugOverlay] = r.formValues;
  return { captions: !!captions, hints: !!hints, deterministic: !!deterministic, seed: Number(seed) || 1983, debugOverlay: !!debugOverlay };
}

export async function extrasForm(player, save) {
  const found = new Set(save.secrets);
  const lines = Object.entries(SECRETS).map(([id, [where, text]]) => (found.has(id) ? `§e#${id} ${where}§r\n${text}` : `§8#${id} ???`));
  const f = new ActionFormData().title('§lARCHIVE & CREDITS').body([
    `Secrets found: ${found.size}/12`, '', ...lines, '',
    '§lCREDITS§r', 'FREDBEAR: SIX NIGHTS BELOW - an original fan-made Minecraft Bedrock map.',
    'Animatronic skins supplied by the map owner. All sounds synthesised for this project.',
    'Inspired by Five Nights at Freddy\'s (Scott Cawthon). Not affiliated with or endorsed by Scott Cawthon or Mojang.',
  ].join('\n'));
  f.button('Close');
  await show(player, f);
}

export async function resultForm(player, { won, night, canNext }) {
  const f = new ActionFormData().title(won ? `§lNIGHT ${night} COMPLETE` : '§lGAME OVER');
  f.body(won ? 'You survived until 6 AM.' : `Night ${night}.`);
  const options = [];
  if (won && canNext) {
    f.button(`Continue to Night ${night + 1}`);
    options.push('next');
  }
  f.button(won ? `Replay Night ${night}` : `Retry Night ${night}`);
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
