// Small shared helpers (no DOM access so they run in Node tests too).

export const uid = () => Math.random().toString(36).slice(2, 9) + (Date.now() % 1e6).toString(36);

export function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** lower_snake identifier part: a-z 0-9 _ (dots allowed when `dots`). */
export function slug(s, { dots = false, fallback = 'thing' } = {}) {
  const re = dots ? /[^a-z0-9_.]+/g : /[^a-z0-9_]+/g;
  const out = String(s || '').toLowerCase().trim().replace(/\s+/g, '_').replace(re, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return out || fallback;
}

export const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function titleCase(s) {
  return String(s).replace(/^minecraft:/, '').replace(/^behavior\./, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Strip // and /* *\/ comments plus trailing commas, as the Bedrock JSON reader allows them. */
export function parseLenientJSON(text) {
  let out = '', i = 0, inStr = false;
  const s = String(text);
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += s[i + 1] ?? ''; i += 2; continue; }
      if (c === '"') inStr = false;
      i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; continue; }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

export function base64ToBytes(b64) {
  const clean = String(b64).replace(/^data:[^,]*,/, '');
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

export function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  return Buffer.from(bytes).toString('base64');
}

export const utf8 = (s) => new TextEncoder().encode(s);

export function hexToRgb(hex) {
  const h = String(hex || '#888888').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const ticksToClock = (t) => {
  // Minecraft time 0 = 06:00. 1000 ticks = 1 hour.
  const mins = Math.round(((t / 1000) * 60 + 360) % 1440);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};
export const clockToTicks = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  const mins = ((h || 0) * 60 + (m || 0) - 360 + 1440) % 1440;
  return Math.round((mins / 60) * 1000);
};
