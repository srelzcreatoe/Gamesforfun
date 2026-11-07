// Sound editor processing: trim, pitch, reverse, fades, normalize, WAV output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { processAudio, encodeWav, fitWav, MAX_BYTES } from '../src/core/audio.js';

const RATE = 8000;
const sine = (sec, f = 440, amp = 0.5) => Float32Array.from({ length: sec * RATE }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / RATE));
const base = { start: 0, end: 1, gain: 0, fadeIn: 0, fadeOut: 0, pitch: 0, reverse: false, normalize: false };

test('trim, pitch and reverse change the length and order', () => {
  const ramp = Float32Array.from({ length: RATE }, (_, i) => i / RATE);
  const [t] = processAudio([ramp], RATE, { ...base, start: 0.25, end: 0.75 });
  assert.equal(t.length, RATE / 2);
  assert.ok(Math.abs(t[0] - 0.25) < 1e-3);
  const [up] = processAudio([ramp], RATE, { ...base, pitch: 12 });
  assert.equal(up.length, RATE / 2, 'an octave up halves the length');
  const [rev] = processAudio([ramp], RATE, { ...base, reverse: true });
  assert.ok(rev[0] > 0.99 && rev[rev.length - 1] < 0.01);
});

test('fades, gain and normalize', () => {
  const [f] = processAudio([sine(1)], RATE, { ...base, fadeIn: 0.5, fadeOut: 0.25 });
  const peak = (a, i0, i1) => { let m = 0; for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(a[i])); return m; };
  assert.ok(peak(f, 0, 200) < 0.03, 'starts silent');
  assert.ok(peak(f, f.length - 20, f.length) < 0.01, 'ends silent');
  const [n] = processAudio([sine(1, 440, 0.1)], RATE, { ...base, normalize: true });
  assert.ok(Math.abs(peak(n, 0, n.length) - 0.89) < 0.01);
  const [g] = processAudio([sine(1, 440, 0.9)], RATE, { ...base, gain: 12 });
  assert.ok(peak(g, 0, g.length) <= 1, 'never clips past full scale');
});

test('WAV output is valid PCM and fits under the size limit', () => {
  const w = encodeWav([sine(1)], RATE);
  const v = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...w.slice(8, 12)), 'WAVE');
  assert.equal(v.getUint32(24, true), RATE);
  assert.equal(w.length, 44 + RATE * 2);
  // 40 s of 44.1 kHz stereo is ~7 MB: must be squeezed under 6 MB.
  const long = Array.from({ length: 2 }, () => new Float32Array(44100 * 40));
  const out = fitWav(long, 44100);
  assert.ok(out.bytes.length <= MAX_BYTES);
  assert.equal(out.channels, 1);
});
