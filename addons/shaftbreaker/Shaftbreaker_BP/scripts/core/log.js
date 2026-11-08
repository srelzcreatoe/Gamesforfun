// @ts-check
import { world } from '@minecraft/server';
import { config } from './config.js';
import { isOperator } from './util.js';

/** Admin-only logging + telemetry ring (T16: every encounter records phase/trigger/telegraph/counterplay). */
const telemetry = [];

export function log(level, msg) {
  const d = config().debug;
  if (d === 'off') return;
  if (level === 'verbose' && d !== 'verbose') return;
  for (const p of world.getAllPlayers()) {
    if (p.hasTag('sb_debug') && isOperator(p)) { try { p.sendMessage(`§8[SB]§7 ${msg}`); } catch { /* ignore */ } }
  }
}

export function record(entry) {
  telemetry.push(entry);
  if (telemetry.length > 60) telemetry.shift();
}

export function recent(n = 10) { return telemetry.slice(-n); }
