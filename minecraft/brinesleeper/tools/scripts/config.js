// Settings shared by every part of the Brinesleeper add-on, saved with the world.
import { world } from '@minecraft/server';

// pacing presets (seconds). firstQuiet is time spent in the caves before anything happens at all.
export const PRESETS = {
  quiet: { label: 'Quiet Dread', minor: [90, 180], major: [8 * 60, 14 * 60], firstQuiet: [3 * 60, 5 * 60], hunt: 0.2, revelation: 0.06,
    stalkGap: [150, 300], chase: 0.25, deep: [90, 180], damage: 0.8 },
  balanced: { label: 'Balanced Horror', minor: [35, 80], major: [3 * 60, 6 * 60], firstQuiet: [45, 90], hunt: 0.45, revelation: 0.08,
    stalkGap: [50, 120], chase: 0.45, deep: [35, 80], damage: 1 },
  relentless: { label: 'Relentless', minor: [20, 45], major: [90, 180], firstQuiet: [20, 40], hunt: 0.7, revelation: 0.09,
    stalkGap: [25, 60], chase: 0.65, deep: [20, 45], damage: 1 },
  nightmare: { label: 'Nightmare', minor: [12, 30], major: [60, 120], firstQuiet: [5, 15], hunt: 0.85, revelation: 0.1,
    stalkGap: [12, 35], chase: 0.8, deep: [12, 30], damage: 1.25 },
  observation: { label: 'Observation Only', minor: [35, 80], major: [3 * 60, 6 * 60], firstQuiet: [45, 90], hunt: 0, revelation: 0.08,
    stalkGap: [50, 120], chase: 0, deep: [35, 80], damage: 0 },
};
export const PRESET_KEYS = Object.keys(PRESETS);

// how dangerous the creature itself is: health and melee come from its entity file (brine:threat_N), the rest from here
export const THREATS = {
  1: { label: 'Dangerous', lunge: 10, grasp: 3, speed: 1.0, chaseSeconds: [12, 18] },
  2: { label: 'Deadly', lunge: 12, grasp: 4, speed: 1.08, chaseSeconds: [14, 22] },
  3: { label: 'Apex', lunge: 15, grasp: 6, speed: 1.16, chaseSeconds: [16, 26] },
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
