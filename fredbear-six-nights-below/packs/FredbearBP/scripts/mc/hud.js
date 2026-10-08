// Heads-up display: action bar status lines, captions (accessibility
// subtitles for every audio cue) and the optional debug overlay.

import { CAMERA_BY_ID } from '../data/cameras.js';

const HOUR_LABEL = ['12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM'];

export function hourLabel(h) {
  return HOUR_LABEL[Math.max(0, Math.min(6, h))];
}

function usageBar(n) {
  return `§a${'#'.repeat(n)}§8${'-'.repeat(5 - n)}`;
}

function powerColor(p) {
  return p > 40 ? '§b' : p > 15 ? '§e' : '§c';
}

export class Hud {
  constructor() {
    this.caption = null;
    this.captionUntil = 0;
    this.message = null;
    this.messageUntil = 0;
  }

  setCaption(text, now, ticks = 70) {
    this.caption = text;
    this.captionUntil = now + ticks;
  }

  setMessage(text, now, ticks = 100) {
    this.message = text;
    this.messageUntil = now + ticks;
  }

  /** Build the action bar for a running night. */
  nightLines(snap, view, now, { captions = true, overlay = null } = {}) {
    const lines = [];
    if (snap.devices.camsOpen) {
      const cam = CAMERA_BY_ID[snap.devices.cam];
      let label = cam ? cam.label : '';
      if (view.cover === 'static') label = '§7-- SIGNAL INTERFERENCE --';
      else if (view.cover === 'lost') label = `§8${label} §7-- SIGNAL LOST --`;
      else if (view.cover === 'audio') label = `§6${label}`;
      else if (view.echo) label = '§5CAM ?? · ECHO §d[unverified feed]';
      lines.push(`§f${label}`);
    } else if (this.message && now < this.messageUntil) {
      lines.push(`§e${this.message}`);
    }
    const p = snap.powerPct;
    let status = `§fNIGHT ${snap.night} §7· §e${hourLabel(snap.hour)} §7· ${powerColor(p)}POWER ${p}% §7USAGE ${usageBar(snap.usage)}`;
    if (snap.strobe.installed) status += ` §7· §6STROBE ${snap.strobe.charges}${snap.strobe.cooldown > 0 ? '…' : ''}`;
    lines.push(status);
    const warn = [];
    if (snap.breaker.tripped) warn.push(snap.breaker.resetting > 0 ? '§eBREAKER RESETTING' : '§cHALL LIGHTS OFFLINE: RESET BREAKER');
    if (snap.blackout === 'warn' || snap.blackout === 'on') warn.push('§cBLACKOUT');
    if (snap.jammed.L || snap.jammed.R || snap.jammed.H) warn.push('§cJAMMED');
    if (snap.powerOut?.stage === 'reserve') warn.push('§c§lPOWER OUT: PULL THE RESERVE LEVER');
    if (warn.length) lines.push(warn.join(' §7· '));
    if (captions && this.caption && now < this.captionUntil) lines.push(`§7[${this.caption}]`);
    if (overlay) lines.push(overlay);
    return lines.join('\n');
  }
}
