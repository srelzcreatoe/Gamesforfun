// Pure audio processing for the sound editor (no browser APIs): trim, pitch,
// reverse, gain/normalize, fades, and 16-bit WAV encoding under a size limit.
export const MAX_BYTES = 6 * 1024 * 1024;

export function processAudio(chs, rate, o) {
  const s0 = Math.max(0, Math.floor(o.start * rate)), s1 = Math.min(chs[0].length, Math.ceil(o.end * rate));
  const len0 = Math.max(1, s1 - s0);
  const ratio = Math.pow(2, (Number(o.pitch) || 0) / 12);
  const len = Math.max(1, Math.round(len0 / ratio));
  const out = chs.map((src) => {
    const seg = src.subarray(s0, s0 + len0);
    const res = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const x = i * ratio, j = Math.floor(x), f = x - j;
      const a = seg[Math.min(j, len0 - 1)], b = seg[Math.min(j + 1, len0 - 1)];
      res[i] = a + (b - a) * f;
    }
    if (o.reverse) res.reverse();
    return res;
  });
  let gain = Math.pow(10, (Number(o.gain) || 0) / 20);
  if (o.normalize) {
    let peak = 0;
    for (const c of out) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
    if (peak > 0) gain *= 0.89 / peak;
  }
  const fi = Math.round((Number(o.fadeIn) || 0) * rate), fo = Math.round((Number(o.fadeOut) || 0) * rate);
  for (const c of out) {
    for (let i = 0; i < c.length; i++) {
      let g = gain;
      if (fi && i < fi) g *= i / fi;
      if (fo && i > c.length - fo) g *= (c.length - i) / fo;
      c[i] = Math.max(-1, Math.min(1, c[i] * g));
    }
  }
  return out;
}

function toMono(chs) {
  if (chs.length === 1) return chs;
  const m = new Float32Array(chs[0].length);
  for (const c of chs) for (let i = 0; i < m.length; i++) m[i] += c[i] / chs.length;
  return [m];
}
function halfRate(chs) {
  return chs.map((c) => { const r = new Float32Array(Math.floor(c.length / 2)); for (let i = 0; i < r.length; i++) r[i] = (c[2 * i] + c[2 * i + 1]) / 2; return r; });
}

/** 16-bit PCM WAV. */
export function encodeWav(chs, rate) {
  const n = chs[0].length, nc = chs.length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * nc * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { const x = chs[c][i]; v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
  return new Uint8Array(buf);
}

/** Fits the result under the size limit: mono first, then half sample rate. */
export function fitWav(chs, rate) {
  let c = chs, r = rate, bytes = encodeWav(c, r);
  if (bytes.length > MAX_BYTES && c.length > 1) { c = toMono(c); bytes = encodeWav(c, r); }
  while (bytes.length > MAX_BYTES && r > 12000) { c = halfRate(c); r = Math.round(r / 2); bytes = encodeWav(c, r); }
  return { bytes, rate: r, channels: c.length };
}

