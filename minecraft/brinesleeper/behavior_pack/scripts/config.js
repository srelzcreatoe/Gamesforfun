// Settings shared by every part of the Brinesleeper add-on, saved with the world.
import { world } from '@minecraft/server';

// pacing presets (seconds). firstQuiet is time spent in the caves before anything happens at all.
export const PRESETS = {
  quiet: { label: 'Quiet Dread', minor: [90, 180], major: [8 * 60, 14 * 60], firstQuiet: [3 * 60, 5 * 60], hunt: 0.2, revelation: 0.06,
    stalkGap: [150, 300], chase: 0.25, deep: [90, 180], damage: 0.8 },
  balanced: { label: 'Balanced Horror', minor: [30, 70], major: [2 * 60, 4 * 60], firstQuiet: [40, 75], hunt: 0.55, revelation: 0.1,
    stalkGap: [30, 75], chase: 0.6, deep: [25, 60], damage: 1 },
  relentless: { label: 'Relentless', minor: [15, 40], major: [60, 140], firstQuiet: [15, 30], hunt: 0.75, revelation: 0.12,
    stalkGap: [15, 40], chase: 0.8, deep: [15, 35], damage: 1 },
  nightmare: { label: 'Nightmare', minor: [8, 25], major: [40, 90], firstQuiet: [5, 12], hunt: 0.9, revelation: 0.14,
    stalkGap: [8, 22], chase: 0.9, deep: [10, 25], damage: 1.25 },
  observation: { label: 'Observation Only', minor: [35, 80], major: [3 * 60, 6 * 60], firstQuiet: [45, 90], hunt: 0, revelation: 0.08,
    stalkGap: [50, 120], chase: 0, deep: [35, 80], damage: 0 },
};
export const PRESET_KEYS = Object.keys(PRESETS);

// how dangerous the creature itself is: health and melee come from its entity file (brine:threat_N), the rest from here
export const THREATS = {
  1: { label: 'Dangerous', melee: 6, lunge: 10, grasp: 3, speed: 1.0, chaseSeconds: [20, 30] },
  2: { label: 'Deadly', melee: 8, lunge: 12, grasp: 4, speed: 1.08, chaseSeconds: [25, 40] },
  3: { label: 'Apex', melee: 11, lunge: 15, grasp: 6, speed: 1.16, chaseSeconds: [30, 50] },
};

export const DEFAULTS = {
  enabled: true, preset: 'balanced', threat: 2, frequency: 100,
  grasp: true, heartbeat: true, music: true, screen: true, lights: true, whispers: true, lures: true,
  blockHostiles: true, repair: true, halls: true, debug: false,
  follow: true, notebook: true,
};
export const config = { ...DEFAULTS };

export function loadConfig() {
  try {
    const raw = world.getDynamicProperty('brine:config');
    if (typeof raw === 'string') Object.assign(config, JSON.parse(raw));
  } catch (e) { /* keep defaults */ }
  if (!PRESETS[config.preset]) config.preset = 'balanced';
  if (!THREATS[config.threat]) config.threat = 2;
}
export function saveConfig() { world.setDynamicProperty('brine:config', JSON.stringify(config)); }
export function setConfig(changes) { Object.assign(config, changes); saveConfig(); }
export const preset = () => PRESETS[config.preset] ?? PRESETS.balanced;
export const threat = () => THREATS[config.threat] ?? THREATS[2];
export const freq = () => Math.max(0.5, Math.min(2, (config.frequency ?? 100) / 100));
