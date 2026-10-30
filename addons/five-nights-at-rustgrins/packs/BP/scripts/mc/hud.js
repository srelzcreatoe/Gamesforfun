// Heads-up display: action bar status lines, captions for audio tells, and
// the camera-map title code read by the resource pack (ui/hud_screen.json).

import { CAMERA_BY_ID, CAMERA_ORDER } from '../data/cameras.js';

const HOURS = ['12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM'];
export const hourLabel = (h) => HOURS[Math.max(0, Math.min(6, h))];

/**
 * Camera map HUD: an invisible title made only of formatting codes. The RP
 * draws the map when the title starts with MAP_ON and highlights the camera
 * whose two-digit index follows ("§0§3" = CAMERAS[3]).
 */
export const MAP_ON = '§k§r§k§r§l';
/** The camera-feed look (grain, scanlines, tint) without the map, when the map is switched off in Settings. */
export const FX_ON = '§k§r§k§r§n';
/** A jumpscare is playing: the resource pack hides the action bar (and every camera overlay) while this title is up. */
export const JS_ON = '§k§r§k§r§o';
export const MAP_OFF = ' ';
export function mapTitle(camId) {
  const i = CAMERA_ORDER.indexOf(camId);
  if (i < 0) return MAP_OFF;
  const s = String(i).padStart(2, '0');
  return `${MAP_ON}§${s[0]}§${s[1]}`;
}

function usageBar(n) {
  const c = n >= 5 ? '§c' : n >= 3 ? '§e' : '§a';
  return `${c}${'▮'.repeat(n)}§8${'▯'.repeat(Math.max(0, 7 - n))}`;
}

function powerColor(p) {
  return p > 40 ? '§f' : p > 15 ? '§e' : '§c';
}

/** Can the guard use the SPOTLIGHT now? (Act III of the Final Act, or a Custom Night with the Ringmaster on.) */
export function spotlightReady(snap) {
  return !!snap.ringmaster && (!snap.final || snap.act === 3);
}

/** Word-wrap a line for the action bar; continuation lines keep the text white. */
export function wrap(text, width = 64) {
  const out = [];
  let line = '';
  let visible = 0;
  for (const word of String(text).split(' ')) {
    const len = word.replace(/§./g, '').length;
    if (line && visible + 1 + len > width) {
      out.push(line);
      line = `§f${word}`;
      visible = len;
    } else {
      line = line ? `${line} ${word}` : word;
      visible += (visible ? 1 : 0) + len;
    }
  }
  if (line) out.push(line);
  return out;
}

const PERFORMER = Object.freeze({ mirehop: 'MIREHOP', noxbriar: 'NOXBRIAR', rustgrin: 'RUSTGRIN', cat: 'THE CAT', purple_rat: 'THE PURPLE RAT' });

/** The Final Act's current cue: who is coming where, or what he wants, and the seconds left. */
export function eventLine(ev) {
  if (!ev) return null;
  const left = `${ev.left <= 3 ? '§c§l' : '§f'}${ev.left}s`;
  if (ev.kind === 'summon') {
    // the band's halls are known; the Cat and the Purple Rat pick a side - listen for it
    const known = ev.who !== 'cat' && ev.who !== 'purple_rat';
    const side = ev.side === 'L' ? 'LEFT' : 'RIGHT';
    const what = ev.guard === 'vent' ? 'VENT' : 'DOOR';
    const where = known ? `§e${side} ${what}` : `§e${what} §7(listen: left or right?)`;
    return `§c${PERFORMER[ev.who] ?? '?'} §7-> ${where}  ${left}`;
  }
  const task = {
    still: 'TOUCH NOTHING',
    cam: `SHOW HIM CAM ${ev.cam}`,
    find: 'FIND HIM: CAM 1C',
    doors: 'CLOSE BOTH DOORS',
    doors_open: 'OPEN BOTH DOORS',
    light: `LIGHT THE ${ev.side === 'L' ? 'LEFT' : 'RIGHT'} HALL`,
    vents: 'SEAL BOTH VENTS',
  }[ev.game];
  return task ? `§6${task}  ${left}` : null;
}

export class Hud {
  constructor() {
    this.caption = null;
    this.captionUntil = 0;
    this.message = null;
    this.messageUntil = 0;
    this.speech = null;
    this.speechUntil = 0;
  }

  /** What the Ringmaster is saying (phone call or PA), shown over the cameras too. */
  setSpeech(text, now, ticks = 100) {
    this.speech = text || null;
    this.speechUntil = now + ticks;
  }

  setCaption(text, now, ticks = 60) {
    this.caption = text;
    this.captionUntil = now + ticks;
  }

  setMessage(text, now, ticks = 100) {
    this.message = text;
    this.messageUntil = now + ticks;
  }

  /** Action bar for a running night. */
  nightBar(snap, now, { captions = true, overlay = null, cover = null, hint = null } = {}) {
    const lines = [];
    if (snap.devices.camsOpen) {
      const cam = CAMERA_BY_ID[snap.devices.cam];
      let label = cam ? cam.label : '';
      if (cover === 'static') label = '§7-- SIGNAL INTERFERENCE --';
      else if (cover === 'audio') label = `§6${label} §7(audio only)`;
      lines.push(`§f${label}`);
      if (snap.devices.cam === '8' && snap.tape) lines.push(`§6SHOW TAPE ${snap.tape.pct}%${snap.tape.pct < 30 ? ' §c§lREWIND' : ''}`);
    }
    const cue = eventLine(snap.event);
    if (cue) lines.push(cue);
    if (this.speech && now < this.speechUntil) lines.push(...wrap(this.speech));
    if (this.message && now < this.messageUntil) lines.push(`§e${this.message}`);
    else if (snap.devices.camsOpen && hint) lines.push(`§8${hint}`);
    const p = snap.powerPct;
    lines.push(`§7${snap.title} §8| §f${hourLabel(snap.hour)} §8| ${powerColor(p)}POWER ${p}% §8| §7USAGE ${usageBar(snap.usage)}`);
    const warn = [];
    const b = snap.devices.broken;
    if (b.L) warn.push('§4LEFT CONTROLS DEAD');
    if (b.R) warn.push('§4RIGHT CONTROLS DEAD');
    if (snap.devices.ventL) warn.push('§bL VENT SHUT');
    if (snap.devices.ventR) warn.push('§bR VENT SHUT');
    if (snap.powerOut) warn.push('§4§lPOWER OUT');
    if (warn.length) lines.push(warn.join(' §8| '));
    if (captions && this.caption && now < this.captionUntil) lines.push(`§7[${this.caption}]`);
    if (overlay) lines.push(overlay);
    return lines.join('\n');
  }
}
