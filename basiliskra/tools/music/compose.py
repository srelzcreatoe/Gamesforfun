#!/usr/bin/env python3
"""
compose.py -- Basiliskra kaiju themes.

Renders three original orchestral-style pieces entirely from code:

    theme_dread  "He is near"      D minor,  66.67 BPM
    theme_wrath  "He is fighting"  C minor,  70 BPM
    theme_last   "The last form"   F minor,  64 BPM

No samples, soundfonts or third-party audio are used.  Every instrument is a
physically-inspired model (bowed-string ensembles through modal body filters,
brass whose brightness follows loudness, glottal-pulse/formant choir, modal
membranes, inharmonic metal, pipe ranks) played from a written score, placed on
a virtual stage and sent through a synthetic concert-hall convolution reverb.

Deterministic: fixed seeds only.  Needs numpy and ffmpeg (libvorbis).

    python3 compose.py                 # render all three -> packs/RP/sounds/basiliskra/music
    python3 compose.py --only wrath    # one track
    python3 compose.py --stems         # also print a per-bus level table
"""
import argparse
import json
import os
import subprocess
import sys
import time
import zlib
from multiprocessing import Pool

import numpy as np

SR = 44100
LN2_1200 = np.log(2.0) / 1200.0
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'packs', 'RP', 'sounds', 'basiliskra', 'music'))
WORK_DIR = os.path.join(HERE, 'out')


# ----------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------
NOTE_BASE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def nn(name):
    """Note name ('C#2', 'Db3', 'Fb5') or number -> MIDI note number."""
    if isinstance(name, (int, float, np.integer, np.floating)):
        return float(name)
    i = 1
    acc = 0
    while name[i] in '#b':
        acc += 1 if name[i] == '#' else -1
        i += 1
    return float(12 * (int(name[i:]) + 1) + NOTE_BASE[name[0].upper()] + acc)


def hz(m):
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def crc(s):
    return zlib.crc32(s.encode('utf-8'))


def db(x):
    return 20.0 * np.log10(max(float(x), 1e-12))


def fast_len(n):
    """Smallest 2^a 3^b 5^c >= n (keeps numpy's FFT fast)."""
    best = 1 << (int(n) - 1).bit_length()
    p5 = 1
    while p5 < best:
        p35 = p5
        while p35 < best:
            x = p35
            while x < n:
                x *= 2
            if x < best:
                best = x
            p35 *= 3
        p5 *= 5
    return best


def cosramp(n):
    return 0.5 - 0.5 * np.cos(np.pi * (np.arange(n) + 0.5) / n)


def env_ar(n_note, att, rel):
    """Raised-cosine attack, flat sustain for n_note samples, raised-cosine release."""
    n_note = max(int(n_note), 32)
    na = int(min(max(att * SR, 16), n_note))
    nr = int(max(rel * SR, 48))
    e = np.ones(n_note + nr)
    e[:na] = cosramp(na)
    e[n_note:] = cosramp(nr)[::-1]
    return e


def smooth_rand(n, rate, rng, sigma=1.0):
    """Band-limited random curve: gaussian control points at `rate` Hz, linearly interpolated."""
    k = int(n * rate / SR) + 3
    pts = rng.standard_normal(k) * sigma
    x = np.arange(n) * (rate / SR) + rng.random()
    return np.interp(x, np.arange(k), pts)


def shaped_noise(n, mag_fn, rng):
    """Gaussian noise with an arbitrary magnitude spectrum, unit RMS."""
    n = int(n)
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    X *= mag_fn(f)
    y = np.fft.irfft(X, n)
    return y / np.sqrt(np.mean(y * y) + 1e-20)


def reson(f, f0, q):
    """Complex response of a causal two-pole band-pass resonator (peak gain 1 at f0)."""
    r = f / f0
    j = 1j * r / q
    return j / (1.0 - r * r + j)


def peak_mag(f, f0, q):
    """Magnitude of a two-pole resonance normalised to 1 at its peak (formant shape)."""
    r = f / f0
    return (1.0 / q) / np.sqrt((1.0 - r * r) ** 2 + (r / q) ** 2)


class NoiseBank:
    """A long pre-shaped noise buffer from which notes take random slices."""

    def __init__(self, seconds, mag_fn, rng):
        self.buf = shaped_noise(int(seconds * SR), mag_fn, rng).astype(np.float32)

    def take(self, n, rng):
        m = len(self.buf)
        if n >= m:
            reps = n // m + 1
            return np.tile(self.buf, reps)[:n]
        s = int(rng.integers(0, m - n))
        return self.buf[s:s + n]


# ----------------------------------------------------------------------------
# band-limited wavetables
# ----------------------------------------------------------------------------
def build_tables(f0, amp_fns, theta_fn, fmax=15000.0, headroom=1.07):
    """One single-cycle table per amplitude function, all sharing harmonic phases so
    they can be cross-faded.  Each table is normalised to unit RMS.  The harmonic
    count stops below fmax (and below Nyquist with room for vibrato)."""
    top = min(fmax, 0.47 * SR / headroom)
    nh = max(1, int(top // f0))
    size = 1 << int(np.ceil(np.log2(max(2048, nh * 16))))
    size = min(size, 65536)
    k = np.arange(1, nh + 1, dtype=np.float64)
    f = k * f0
    th = theta_fn(k)
    out = np.empty((len(amp_fns), size + 1), dtype=np.float32)
    for li, fn in enumerate(amp_fns):
        a = np.maximum(fn(f, k), 0.0)
        spec = np.zeros(size // 2 + 1, dtype=np.complex128)
        spec[1:nh + 1] = a * np.exp(1j * (th - np.pi / 2.0))
        tab = np.fft.irfft(spec, size)
        tab /= np.sqrt(np.mean(tab * tab) + 1e-30)
        out[li, :size] = tab
        out[li, size] = tab[0]
    return out


def osc_bank(tabs, phase):
    """Read all tables at `phase` (cycles, unwrapped) with linear interpolation."""
    size = tabs.shape[1] - 1
    x = phase * size
    i = x.astype(np.int64)
    fr = (x - i).astype(np.float32)
    i &= (size - 1)
    a = tabs[:, i]
    return a + fr * (tabs[:, i + 1] - a)


def cents_to_ratio(c):
    x = c * LN2_1200
    return 1.0 + x + 0.5 * x * x


# ----------------------------------------------------------------------------
# hall impulse responses and instrument bodies (frequency-domain objects)
# ----------------------------------------------------------------------------
OCT_FC = np.array([31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000.0])
OCT_RT = np.array([2.3, 2.7, 3.1, 3.3, 3.2, 3.0, 2.5, 1.9, 1.25, 0.75])


def _decay_noise(n, rng, rt_scale):
    """Noise whose every octave band decays with its own RT60 (darker tail)."""
    t = np.arange(n) / SR
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    lf = np.log2(np.maximum(f, 1.0))
    out = np.zeros(n)
    for fc, rt in zip(OCT_FC, OCT_RT):
        d = np.abs(lf - np.log2(fc))
        if fc == OCT_FC[0]:
            d = np.where(lf < np.log2(fc), 0.0, d)
        if fc == OCT_FC[-1]:
            d = np.where(lf > np.log2(fc), 0.0, d)
        mask = np.where(d < 1.0, np.cos(0.5 * np.pi * d) ** 2, 0.0)
        out += np.fft.irfft(X * mask, n) * np.exp(-6.908 * t / (rt * rt_scale))
    return out


def make_hall(seed, predelay, er_gain, rt_scale=1.0, length=4.6):
    """Synthetic concert hall: a handful of early reflections followed by a diffuse,
    frequency-dependent exponential tail.  Returns four IRs (L->L, R->R, L->R, R->L)."""
    rng = np.random.default_rng(seed)
    n = int(length * SR)
    t = np.arange(n) / SR
    pd = int(predelay * SR)
    irs = []
    for ch in range(4):
        cross = ch >= 2
        tail = _decay_noise(n, rng, rt_scale)
        tail *= (1.0 - np.exp(-t / 0.035)) ** 2
        tail /= np.sqrt(np.sum(tail * tail))
        ir = np.zeros(n + pd + 8)
        ir[pd:pd + n] += tail * (0.62 if cross else 1.0)
        # early reflections: sparse, progressively duller taps
        k = 5 if cross else 9
        delays = np.sort(rng.uniform(0.007, 0.095, k)) + (0.006 if cross else 0.0)
        for j, dly in enumerate(delays):
            g = er_gain * (0.34 if cross else 0.5) * (0.82 ** j) * rng.choice([-1.0, 1.0]) * rng.uniform(0.7, 1.0)
            tap = np.array([1.0])
            for _ in range(1 + j // 2):
                tap = np.convolve(tap, [0.25, 0.5, 0.25])
            p = pd + int(dly * SR)
            ir[p:p + len(tap)] += g * tap
        irs.append(ir)
    return irs


def body_response(kind, seed):
    """Modal body of a string instrument: a few named low modes, a few dozen random
    higher ones under a 'bridge hill' envelope, plus a little direct string sound.
    Returned on a 0.5 Hz grid as (freqs, complex response)."""
    rng = np.random.default_rng(seed)
    spec = {
        'violin': dict(fixed=[(275, 14, 0.9), (460, 28, 1.1), (550, 30, 1.25)], lo=650, hi=8500, n=44,
                       env=[(200, 1.0), (1500, 1.0), (2600, 1.7), (3200, 1.6), (5000, 0.5), (8500, 0.12)],
                       direct=0.30, hp=190.0, lp=6500.0),
        'viola': dict(fixed=[(225, 14, 0.9), (370, 25, 1.1), (480, 28, 1.2)], lo=560, hi=7500, n=42,
                      env=[(150, 1.0), (1100, 1.0), (1800, 1.5), (2300, 1.45), (4500, 0.45), (7500, 0.1)],
                      direct=0.30, hp=130.0, lp=5500.0),
        'cello': dict(fixed=[(98, 11, 1.0), (176, 22, 1.2), (206, 20, 1.0), (272, 25, 0.9)], lo=320, hi=5500, n=46,
                      env=[(60, 1.0), (800, 1.0), (1250, 1.35), (1650, 1.3), (3000, 0.4), (5500, 0.08)],
                      direct=0.38, hp=62.0, lp=4200.0),
        'bass': dict(fixed=[(62, 9, 1.0), (103, 16, 1.1), (148, 18, 0.95), (196, 20, 0.9)], lo=240, hi=3800, n=40,
                     env=[(30, 1.0), (420, 1.0), (650, 1.2), (900, 1.15), (2000, 0.35), (3800, 0.07)],
                     direct=0.55, hp=27.0, lp=2600.0),
    }[kind]
    f = np.arange(0.0, SR / 2 + 0.5, 0.5)
    f[0] = 1e-3
    H = np.zeros(len(f), dtype=np.complex128)
    for f0, q, g in spec['fixed']:
        H += g * reson(f, f0 * rng.uniform(0.97, 1.03), q) * rng.choice([-1.0, 1.0])
    fm = np.exp(np.sort(rng.uniform(np.log(spec['lo']), np.log(spec['hi']), spec['n'])))
    ex, ey = zip(*spec['env'])
    for f0 in fm:
        g = np.interp(np.log(f0), np.log(ex), ey) * rng.uniform(0.45, 1.2)
        H += g * reson(f, f0, rng.uniform(22, 48)) * rng.choice([-1.0, 1.0])
    direct = (1j * f / spec['hp']) / (1.0 + 1j * f / spec['hp']) / (1.0 + (f / spec['lp']) ** 2)
    H += spec['direct'] * direct
    band = (f > spec['fixed'][0][0] * 0.9) & (f < spec['hi'] * 0.5)
    H /= np.sqrt(np.mean(np.abs(H[band]) ** 2))
    return f, H


# ----------------------------------------------------------------------------
# track: tempo grid, buses, stage placement
# ----------------------------------------------------------------------------
class Track:
    def __init__(self, name, title, bpm, bpb, bars, tail, seed, target_db, key):
        self.name, self.title, self.key = name, title, key
        self.bpm, self.bpb, self.bars = bpm, bpb, bars
        self.spb = 60.0 / bpm
        self.lead = 0.045
        self.music_len = bars * bpb * self.spb
        self.length = self.lead + self.music_len + tail
        self.N = fast_len(int((self.length + 7.0) * SR))
        self.seed = seed
        self.target_db = target_db
        self.buses = {}
        self.mix = {}
        self.sections = []          # (label, first bar) for the report

    def bt(self, bar, beat=1.0):
        """(bar, beat), both 1-based -> beats from the start."""
        return (bar - 1) * self.bpb + (beat - 1.0)

    def sec(self, beats):
        return self.lead + beats * self.spb

    def bus(self, name):
        b = self.buses.get(name)
        if b is None:
            b = self.buses[name] = np.zeros((2, self.N), dtype=np.float32)
        return b

    def add(self, busname, t0, sig, pan, gain=1.0):
        """Place a mono signal on the stage: constant-power pan plus a small
        inter-channel time difference (far ear up to 0.3 ms late)."""
        bus = self.bus(busname)
        i = int(round(t0 * SR))
        if i < 0:
            sig = sig[-i:]
            i = 0
        d = int(round(abs(pan) * 13))
        n = min(len(sig), self.N - i - d - 1)
        if n <= 0:
            return
        th = (pan + 1.0) * np.pi / 4.0
        dl = d if pan > 0 else 0
        dr = d if pan < 0 else 0
        s = sig[:n]
        bus[0, i + dl:i + dl + n] += (np.cos(th) * gain) * s
        bus[1, i + dr:i + dr + n] += (np.sin(th) * gain) * s


class Section:
    """A group of players sharing a part.  Holds per-player humanisation and the
    written dynamics curve (crescendi / diminuendi)."""

    def __init__(self, tr, name, n, pan, spread, gain):
        self.tr, self.name, self.n = tr, name, n
        self.rng = np.random.default_rng([tr.seed, crc(name)])
        self.gain = gain / np.sqrt(n)
        order = self.rng.permutation(n)
        self.pans = np.clip(pan + spread * ((order + 0.5) / n * 2.0 - 1.0), -0.92, 0.92)
        self._ex = None
        self._ey = None
        self.tabs = {}

    def dynamics(self, pts):
        """pts: [(bar, beat, level), ...] -- the written dynamic, linearly joined."""
        tr = self.tr
        self._ex = np.array([tr.sec(tr.bt(b, bt)) for b, bt, _ in pts])
        self._ey = np.array([p[2] for p in pts], dtype=np.float64)

    def level(self, t):
        if self._ex is None:
            return 1.0 if np.isscalar(t) else np.ones(len(t))
        return np.interp(t, self._ex, self._ey)

    def sel(self, div):
        if div is None:
            return range(self.n)
        i, k = div
        return range(i % k, self.n, k)

    def dyn(self, st, n, v, shape, dur):
        """Dynamic level over a note: velocity x written dynamics x per-note hairpin."""
        if n > 0.28 * SR or shape is not None:
            d = v * self.level(st + np.arange(n) / SR)
            if shape is not None:
                sx, sy = zip(*shape)
                d = d * np.interp(np.arange(n) / (dur * SR), sx, sy)
            return np.clip(d, 0.0, 1.25)
        return float(np.clip(v * self.level(st), 0.0, 1.25))

    def chord(self, b, d, pitches, v=0.7, **kw):
        """Divide the players between the chord notes (divisi)."""
        k = len(pitches)
        for j, p in enumerate(pitches):
            self.play(b, d, p, v, div=(j, k) if self.n >= k and k > 1 else None, **kw)


def ripple_fn(rng, depth_db):
    """Smooth random +/- depth_db ripple over log-frequency: every player's
    instrument is built a little differently."""
    ph = rng.uniform(0, 2 * np.pi, 3)
    w = rng.uniform(1.2, 3.4, 3)
    g = rng.normal(0, depth_db / 1.7, 3)

    def fn(f):
        lf = np.log2(np.maximum(f, 20.0))
        return 10.0 ** ((g[0] * np.sin(w[0] * lf + ph[0]) + g[1] * np.sin(w[1] * lf + ph[1])
                         + g[2] * np.sin(w[2] * lf + ph[2])) / 20.0)
    return fn


def trem_mod(n, rate, rng, depth):
    """Bowed tremolo: the bow reverses 9-13 times a second; amplitude dips at each turn."""
    r = rate * (1.0 + 0.12 * smooth_rand(n, 3.0, rng))
    ph = np.cumsum(r) / SR + rng.random()
    return (1.0 - depth) + depth * np.abs(np.sin(np.pi * ph)) ** 0.35


# ----------------------------------------------------------------------------
# bowed strings
# ----------------------------------------------------------------------------
STR = {
    'vn': dict(fc=(1500.0, 6000.0), vibd=21.0, att=1.0, nz=0.034, ring=1.0, pizz=0.7),
    'va': dict(fc=(1100.0, 4800.0), vibd=18.0, att=1.1, nz=0.034, ring=1.1, pizz=0.9),
    'vc': dict(fc=(760.0, 3800.0), vibd=15.0, att=1.2, nz=0.038, ring=1.35, pizz=1.4),
    'cb': dict(fc=(480.0, 2400.0), vibd=7.0, att=1.5, nz=0.042, ring=1.8, pizz=2.2),
}


class Strings(Section):
    """A string section.  Every player is a separate band-limited sawtooth-like
    voice (Helmholtz motion with a bow-position comb), with its own detune,
    timing, delayed vibrato, pitch drift, bow noise and stage position.  The sum
    is later passed through a modal body filter for the instrument family."""

    def __init__(self, tr, name, fam, n, pan, spread, gain):
        super().__init__(tr, name, n, pan, spread, gain)
        self.fam = fam
        self.F = STR[fam]
        r = self.rng
        self.P = [dict(det=r.normal(0, 6.0), lag=r.normal(0, 0.006), vr=r.uniform(5.1, 6.4),
                       vd=self.F['vibd'] * r.uniform(0.7, 1.25), von=r.uniform(0.16, 0.38),
                       beta=r.uniform(0.07, 0.13), tilt=r.normal(0, 1.1), g=r.uniform(0.82, 1.18),
                       ps=int(r.integers(1 << 30)), trate=r.uniform(9.5, 13.0)) for _ in range(n)]
        self.noise = NoiseBank(14, lambda f: (f / (f + 800.0)) / np.sqrt(1.0 + (f / 7000.0) ** 4), r)

    def table(self, i, m, tone):
        key = (i, int(round(m * 4)), tone)
        T = self.tabs.get(key)
        if T is not None:
            return T
        P = self.P[i]
        f0 = hz(m)
        r = np.random.default_rng([P['ps'], key[1], crc(tone)])
        fc0, fc1 = self.F['fc']
        beta, tilt = P['beta'], P['tilt']

        def saw(fc, lowcut=0.0):
            def fn(f, k):
                a = (0.4 + 0.6 * np.abs(np.sin(np.pi * k * beta))) / k
                a = a / np.sqrt(1.0 + (f / fc) ** 4)
                a = a * 10.0 ** (tilt * np.log2(f / 500.0) / 20.0)
                if lowcut:
                    a = a * (k / (k + lowcut))
                return a
            return fn

        if tone == 'pont':          # sul ponticello: glassy, weak fundamental
            fns = [saw(fc1 * 0.8, 1.5), saw(fc1 * 1.6, 3.0)]
        elif tone == 'harm':        # flautando / harmonics: nearly pure, airy
            fns = [lambda f, k: k ** -2.6, lambda f, k: k ** -1.9]
        elif tone == 'pizz':
            fns = [lambda f, k: k ** -2.2,
                   lambda f, k: np.abs(np.sin(np.pi * k * 0.21)) / k / np.sqrt(1.0 + (f / fc1) ** 4)]
        else:
            fns = [saw(fc0), saw(fc1)]
        T = build_tables(f0, fns, lambda k: r.normal(0, 0.3, len(k)) * k, fmax=13000.0)
        self.tabs[key] = T
        return T

    def play(self, b, d, p, v=0.7, art='arco', to=None, vib=1.0, tone='ord', div=None,
             shape=None, leg=False, trem=0.0, gate=1.0):
        tr, F, rng = self.tr, self.F, self.rng
        t0 = tr.sec(b)
        dur = max(0.04, d * tr.spb * gate)
        m0 = nn(p)
        m1 = None if to is None else nn(to)
        f0 = hz(m0)
        mt = m0 if m1 is None else max(m0, m1)
        if art == 'pizz':
            tone = 'pizz'
        for i in self.sel(div):
            P = self.P[i]
            if art == 'spicc':
                st = t0 + P['lag'] + rng.normal(0, 0.006)
                e = env_ar(min(dur, 0.22 * F['ring']) * SR, 0.007, 0.10 * F['ring'])
            elif art == 'pizz':
                st = t0 + P['lag'] + rng.normal(0, 0.008)
                t60 = float(np.clip(F['pizz'] * (110.0 / f0) ** 0.25, 0.4, 3.0))
                e = env_ar(min(t60 * 1.1, 3.0) * SR, 0.003, 0.05)
            elif art == 'marc':
                st = t0 + P['lag'] + rng.normal(0, 0.009)
                e = env_ar(dur * SR, 0.028 * F['att'], 0.15)
            else:
                st = t0 + P['lag'] + rng.normal(0, 0.016)
                att = F['att'] * (0.05 + 0.20 * (1.0 - min(v, 1.0)))
                dd = dur
                if leg:
                    att *= 0.6
                    dd += 0.06
                e = env_ar(dd * SR, att, 0.17)
            n = len(e)
            t = np.arange(n) / SR
            dc = self.dyn(st, n, v, shape, dur)
            bm = np.clip(1.2 * dc - 0.12, 0.0, 1.0)
            if art == 'spicc':
                e = e * (0.2 + 0.8 * np.exp(-t / (0.08 * F['ring'])))
                bm = min(bm + 0.1, 1.0)
            elif art == 'marc':
                e = e * (1.0 + 0.5 * np.exp(-t / 0.11))
            elif art == 'pizz':
                e = e * np.exp(-6.9 * t / t60)
                bm = np.clip(1.1 * dc, 0, 1) * np.exp(-t / 0.07)
            amp = e * dc ** 1.7 * P['g']
            # pitch: detune, drift, delayed vibrato, optional glissando
            c = P['det'] + rng.normal(0, 1.8)
            if n > 0.3 * SR:
                c = c + smooth_rand(n, 2.2, rng, 2.2)
                if vib > 0 and art in ('arco', 'marc'):
                    on = np.clip((t - P['von']) / 0.35, 0.0, 1.0)
                    on = on * on * (3.0 - 2.0 * on)
                    rate = P['vr'] * (1.0 + rng.normal(0, 0.03))
                    wob = 0.6 * np.sin(2 * np.pi * 0.31 * t + rng.uniform(0, 6.28))
                    c = c + (P['vd'] * vib * (0.55 + 0.6 * np.minimum(dc, 1.0))) * on * \
                        np.sin(2 * np.pi * rate * t + rng.uniform(0, 6.28) + wob)
            ratio = cents_to_ratio(c)
            if m1 is not None:
                g = np.clip(t / dur, 0.0, 1.0)
                ratio = ratio * np.exp2((m1 - m0) / 12.0 * g * g * (3.0 - 2.0 * g))
            if np.isscalar(ratio):
                ph = (f0 * ratio / SR) * np.arange(n) + rng.random()
            else:
                ph = np.cumsum(ratio) * (f0 / SR) + rng.random()
            w = osc_bank(self.table(i, mt, tone), ph)
            sig = w[0] + bm * (w[1] - w[0])
            # bow noise (rosin hiss follows bow speed), scratch at hard attacks
            nzl = F['nz'] * (2.5 if tone == 'harm' else 1.0)
            nz = self.noise.take(n, rng) * (nzl * e * dc ** 1.2)
            if art in ('marc', 'spicc'):
                nz = nz + self.noise.take(n, rng) * (nzl * 4.0 * dc * np.exp(-t / 0.018) * np.minimum(t / 0.002, 1.0))
            if trem > 0:
                mod = trem_mod(n, P['trate'], rng, 0.85 * trem)
                amp = amp * mod
                nz = nz + self.noise.take(n, rng) * (nzl * 2.5 * e * dc * (1.0 - mod))
            desk = 'A' if (i // 2) % 2 == 0 else 'B'
            tr.add(self.fam + desk, st, sig * amp + nz, self.pans[i], self.gain)


# ----------------------------------------------------------------------------
# brass and low reeds
# ----------------------------------------------------------------------------
WIND = {
    'tbn': dict(f_lo=420.0, p=1.0, fc=(260.0, 760.0, 2200.0), scoop=34.0, att=0.042, rel=0.12,
                rasp=0.14, nz=0.012, vib=0.0, alpha=1.7, jit=3.0, bus='brass'),
    'tuba': dict(f_lo=190.0, p=1.0, fc=(170.0, 400.0, 950.0), scoop=24.0, att=0.055, rel=0.14,
                 rasp=0.10, nz=0.012, vib=0.0, alpha=1.6, jit=2.5, bus='brass'),
    'horn': dict(f_lo=330.0, p=1.0, fc=(240.0, 540.0, 1500.0), scoop=28.0, att=0.05, rel=0.13,
                 rasp=0.08, nz=0.010, vib=0.0, alpha=1.7, jit=2.5, dip=(1900.0, 0.55), bus='brass'),
    'tpt': dict(f_lo=880.0, p=1.2, fc=(520.0, 1300.0, 3600.0), scoop=30.0, att=0.032, rel=0.10,
                rasp=0.10, nz=0.010, vib=5.0, alpha=1.7, jit=2.5, bus='brass'),
    'cbsn': dict(reed=True, formants=[(260.0, 2.5, 1.0), (490.0, 3.5, 0.8), (1100.0, 4.0, 0.25)],
                 fc=(450.0, 900.0, 1900.0), even=0.8, slope=0.6, scoop=10.0, att=0.05, rel=0.11,
                 rasp=0.10, nz=0.02, vib=0.0, alpha=1.5, jit=5.0, bus='ww'),
    'bcl': dict(reed=True, formants=[(350.0, 2.0, 1.0), (900.0, 3.0, 0.5), (1700.0, 4.0, 0.2)],
                fc=(550.0, 1200.0, 2600.0), even=0.3, slope=0.8, scoop=8.0, att=0.045, rel=0.10,
                rasp=0.04, nz=0.025, vib=0.0, alpha=1.5, jit=2.5, bus='ww'),
}


class Winds(Section):
    """Lip-reed and cane-reed instruments.  Three spectra per note (soft / medium /
    loud) are cross-faded by the instantaneous dynamic, so brightness rises with
    loudness; attacks get a pitch scoop, a breath/lip burst and a brightness
    overshoot ('blat'); loud playing adds lip-buzz roughness."""

    def __init__(self, tr, name, kind, n, pan, spread, gain):
        super().__init__(tr, name, n, pan, spread, gain)
        self.kind = kind
        self.K = WIND[kind]
        r = self.rng
        self.P = [dict(det=r.normal(0, 3.5), lag=r.normal(0, 0.005), g=r.uniform(0.85, 1.15),
                       ps=int(r.integers(1 << 30)), rip=ripple_fn(r, 1.5), vr=r.uniform(4.8, 5.6)) for _ in range(n)]
        self.noise = NoiseBank(10, lambda f: (f / (f + 500.0)) / (1.0 + (f / 3000.0) ** 2), r)

    def table(self, i, m):
        key = (i, int(round(m * 4)))
        T = self.tabs.get(key)
        if T is not None:
            return T
        K, P = self.K, self.P[i]
        f0 = hz(m)
        r = np.random.default_rng([P['ps'], key[1]])
        fns = []
        for fc in K['fc']:
            if K.get('reed'):
                def fn(f, k, fc=fc):
                    ev = np.where(k % 2 == 0, K['even'] + (1.0 - K['even']) * (1.0 - np.exp(-k / 12.0)), 1.0)
                    form = 0.08
                    for ff, q, g in K['formants']:
                        form = form + g * peak_mag(f, ff, q)
                    return k ** -K['slope'] * ev * form / np.sqrt(1.0 + (f / fc) ** 4) * P['rip'](f)
            else:
                def fn(f, k, fc=fc):
                    a = np.exp(-(f - f0) / fc) / np.sqrt(1.0 + (K['f_lo'] / f) ** (2.0 * K['p']))
                    if 'dip' in K:
                        a = a * (1.0 - K['dip'][1] * np.exp(-0.5 * (np.log2(f / K['dip'][0]) / 0.35) ** 2))
                    return a * P['rip'](f)
            fns.append(fn)
        T = build_tables(f0, fns, lambda k: r.normal(0, 0.12, len(k)) * np.sqrt(k), fmax=12000.0)
        self.tabs[key] = T
        return T

    def play(self, b, d, p, v=0.7, art='sus', div=None, shape=None, leg=False, gate=1.0):
        tr, K, rng = self.tr, self.K, self.rng
        t0 = tr.sec(b)
        dur = max(0.05, d * tr.spb * gate)
        m0 = nn(p)
        f0 = hz(m0)
        for i in self.sel(div):
            P = self.P[i]
            st = t0 + P['lag'] + rng.normal(0, 0.010)
            att = K['att'] * (1.6 - 0.8 * min(v, 1.0))
            dd = dur
            if art in ('marc', 'sfz'):
                att *= 0.7
            if leg:
                att *= 0.8
                dd += 0.04
            e = env_ar(dd * SR, att, K['rel'])
            n = len(e)
            t = np.arange(n) / SR
            dc = self.dyn(st, n, v, shape, dur)
            if art == 'marc':
                dc = dc * (1.0 + 0.30 * np.exp(-t / 0.13))
            elif art == 'sfz':
                dc = dc * (1.0 + 0.7 * np.exp(-t / 0.10))
            bm = np.clip(1.25 * dc - 0.15, 0.0, 1.0)
            c = P['det'] + rng.normal(0, 1.5) + smooth_rand(n, 45.0, rng, K['jit'] * 0.6)
            if n > 0.3 * SR:
                c = c + smooth_rand(n, 3.0, rng, K['jit'] * 0.5)
            if not leg:
                c = c - K['scoop'] * (0.5 + min(v, 1.0)) * rng.uniform(0.6, 1.3) * np.exp(-t / 0.028)
            if K['vib'] > 0 and n > 0.6 * SR:
                on = np.clip((t - 0.45) / 0.4, 0.0, 1.0)
                c = c + K['vib'] * on * np.sin(2 * np.pi * P['vr'] * t + rng.uniform(0, 6.28))
            ph = np.cumsum(cents_to_ratio(c)) * (f0 / SR) + rng.random()
            w = osc_bank(self.table(i, m0), ph)
            sig = w[0] + (w[1] - w[0]) * np.minimum(2.0 * bm, 1.0) + (w[2] - w[1]) * np.maximum(2.0 * bm - 1.0, 0.0)
            amp = e * dc ** K['alpha'] * P['g'] * (1.0 + 0.03 * smooth_rand(n, 6.0, rng))
            amp = amp * (1.0 + K['rasp'] * bm * bm * smooth_rand(n, 140.0, rng))
            nz = self.noise.take(n, rng) * (K['nz'] * e * dc * (1.0 + 5.0 * np.exp(-t / 0.03)))
            tr.add(K['bus'], st, sig * amp + nz, self.pans[i], self.gain)


# ----------------------------------------------------------------------------
# choir
# ----------------------------------------------------------------------------
# five formants per vowel: (frequencies Hz, levels dB, bandwidths Hz)
VOWELS = {
    'B': {'u': ([350, 600, 2400, 2675, 2950], [0, -20, -32, -28, -36], [40, 80, 100, 120, 120]),
          'o': ([400, 750, 2400, 2600, 2900], [0, -11, -21, -20, -40], [40, 80, 100, 120, 120]),
          'a': ([600, 1040, 2250, 2450, 2750], [0, -7, -9, -9, -20], [60, 70, 110, 120, 130])},
    'T': {'u': ([350, 600, 2700, 2900, 3300], [0, -20, -17, -14, -26], [40, 60, 100, 120, 120]),
          'o': ([400, 800, 2600, 2800, 3000], [0, -10, -12, -12, -26], [40, 80, 100, 120, 120]),
          'a': ([650, 1080, 2650, 2900, 3250], [0, -6, -7, -8, -22], [80, 90, 120, 130, 140])},
    'A': {'u': ([325, 700, 2530, 3500, 4950], [0, -12, -30, -40, -64], [50, 60, 170, 180, 200]),
          'o': ([450, 800, 2830, 3500, 4950], [0, -9, -16, -28, -55], [70, 80, 100, 130, 135]),
          'a': ([800, 1150, 2800, 3500, 4950], [0, -4, -20, -36, -60], [80, 90, 120, 130, 140])},
    'S': {'u': ([325, 700, 2700, 3800, 4950], [0, -16, -35, -40, -60], [50, 60, 170, 180, 200]),
          'o': ([450, 800, 2830, 3800, 4950], [0, -11, -22, -22, -50], [70, 80, 100, 130, 135]),
          'a': ([800, 1150, 2900, 3900, 4950], [0, -6, -32, -20, -50], [80, 90, 120, 130, 140])},
}
VOWEL_SLOPE = {'u': 1.9, 'o': 1.45, 'a': 1.15}


class Choir(Section):
    """One voice part of a choir.  Each singer is a glottal pulse train (harmonic
    series with a dynamic-dependent source slope) through five vowel formants
    scaled to that singer's vocal tract, with independent vibrato, pitch drift,
    onset scoop, entry time and breath noise.  The vowel opens from 'oo' through
    'oh' to 'ah' as the dynamic rises."""

    def __init__(self, tr, name, part, n, pan, spread, gain):
        super().__init__(tr, name, n, pan, spread, gain)
        self.part = part
        r = self.rng
        self.P = [dict(det=r.normal(0, 7.0), lag=r.normal(0, 0.012), g=r.uniform(0.8, 1.2),
                       ps=int(r.integers(1 << 30)), tract=r.normal(1.0, 0.035), vr=r.uniform(4.9, 6.1),
                       vd=r.uniform(16.0, 34.0), von=r.uniform(0.22, 0.5), rip=ripple_fn(r, 1.5)) for _ in range(n)]
        F, A, Bw = VOWELS[part]['a']

        def breath(f):
            m = 0.02
            for ff, aa, bb in zip(F, A, Bw):
                m = m + 10.0 ** (aa / 20.0) * peak_mag(np.maximum(f, 1.0), ff, ff / (bb * 2.0))
            return m * (f / (f + 400.0))
        self.noise = NoiseBank(10, breath, r)

    def table(self, i, m):
        key = (i, int(round(m * 4)))
        T = self.tabs.get(key)
        if T is not None:
            return T
        P = self.P[i]
        f0 = hz(m)
        r = np.random.default_rng([P['ps'], key[1]])
        fns = []
        for vw in ('u', 'o', 'a'):
            F, A, Bw = VOWELS[self.part][vw]
            F = [x * P['tract'] for x in F]
            F[0] = max(F[0], f0 * 1.03)       # sopranos track the first formant upward
            F[1] = max(F[1], F[0] * 1.25)

            def fn(f, k, F=F, A=A, Bw=Bw, s=VOWEL_SLOPE[vw]):
                m_ = 0.0
                for ff, aa, bb in zip(F, A, Bw):
                    m_ = m_ + 10.0 ** (aa / 20.0) * peak_mag(f, ff, ff / (bb * 1.6))
                return k ** -s * m_ * P['rip'](f)
            fns.append(fn)
        T = build_tables(f0, fns, lambda k: r.normal(0, 0.10, len(k)) * np.sqrt(k), fmax=9000.0)
        self.tabs[key] = T
        return T

    def play(self, b, d, p, v=0.7, div=None, shape=None, leg=False, vowel=0.0, gate=1.0, art='sus'):
        tr, rng = self.tr, self.rng
        t0 = tr.sec(b)
        dur = max(0.08, d * tr.spb * gate)
        m0 = nn(p)
        f0 = hz(m0)
        for i in self.sel(div):
            P = self.P[i]
            st = t0 + P['lag'] + rng.normal(0, 0.028)
            att = rng.uniform(0.10, 0.22) * (1.5 - 0.6 * min(v, 1.0))
            dd = dur
            if art == 'marc':
                att = rng.uniform(0.05, 0.09)
            if leg:
                att *= 0.55
                dd += 0.09
            e = env_ar(dd * SR, att, rng.uniform(0.2, 0.32))
            n = len(e)
            t = np.arange(n) / SR
            dc = self.dyn(st, n, v, shape, dur)
            vm = np.clip(0.12 + 1.0 * dc + vowel, 0.0, 1.0)
            c = P['det'] + rng.normal(0, 3.0) + smooth_rand(n, 1.8, rng, 4.0) + smooth_rand(n, 22.0, rng, 2.2)
            if not leg:
                c = c - rng.uniform(25.0, 75.0) * np.exp(-t / 0.07)
            on = np.clip((t - P['von']) / 0.45, 0.0, 1.0)
            on = on * on * (3.0 - 2.0 * on)
            rate = P['vr'] * (1.0 + rng.normal(0, 0.03))
            wob = 0.8 * np.sin(2 * np.pi * 0.27 * t + rng.uniform(0, 6.28))
            c = c + P['vd'] * (0.6 + 0.5 * np.minimum(dc, 1.0)) * on * np.sin(2 * np.pi * rate * t + rng.uniform(0, 6.28) + wob)
            ph = np.cumsum(cents_to_ratio(c)) * (f0 / SR) + rng.random()
            w = osc_bank(self.table(i, m0), ph)
            sig = w[0] + (w[1] - w[0]) * np.minimum(2.0 * vm, 1.0) + (w[2] - w[1]) * np.maximum(2.0 * vm - 1.0, 0.0)
            amp = e * dc ** 1.6 * P['g'] * (1.0 + 0.05 * smooth_rand(n, 5.0, rng))
            nz = self.noise.take(n, rng) * (0.035 * e * dc * (1.0 + 2.5 * np.exp(-t / 0.08)))
            tr.add('choir', st, sig * amp + nz, self.pans[i], self.gain)


# ----------------------------------------------------------------------------
# pipe organ
# ----------------------------------------------------------------------------
def _princ(f, k):
    return np.where(k <= 14, k ** -1.6 * (1.0 + 0.25 * (k % 2)), 0.0)


def _reed(f, k):
    return np.where(k <= 48, k ** -0.7, 0.0) / np.sqrt(1.0 + (f / 1400.0) ** 4)


def _stopped(f, k):
    h = np.array([1.0, 0.04, 0.20, 0.015, 0.07, 0.008, 0.03, 0.0, 0.012])
    return np.where(k <= len(h), h[np.minimum(k.astype(int), len(h)) - 1], 0.0)


ORGAN_RANKS = {
    'subbass16': dict(mult=1.0, fn=_stopped, g=1.0, chiff=3),
    'gedackt8': dict(mult=2.0, fn=_stopped, g=0.45, chiff=3),
    'princ16': dict(mult=1.0, fn=_princ, g=0.7, chiff=2),
    'octave8': dict(mult=2.0, fn=_princ, g=0.55, chiff=2),
    'posaune16': dict(mult=1.0, fn=_reed, g=0.55, chiff=0),
    'princ8': dict(mult=1.0, fn=_princ, g=1.0, chiff=2),
    'octave4': dict(mult=2.0, fn=_princ, g=0.6, chiff=2),
    'super2': dict(mult=4.0, fn=_princ, g=0.35, chiff=2),
    'quint': dict(mult=3.0, fn=_princ, g=0.25, chiff=2),
    'mixture': dict(mult=8.0, fn=_princ, g=0.14, chiff=2),
    'trompete8': dict(mult=1.0, fn=_reed, g=0.4, chiff=0),
}
ORGAN_STOPS = {
    'soft': ['subbass16', 'gedackt8'],
    'full': ['subbass16', 'princ16', 'octave8', 'posaune16', 'gedackt8'],
    'plenum': ['princ8', 'octave4', 'super2', 'quint', 'mixture'],
    'tutti': ['princ8', 'octave4', 'super2', 'quint', 'mixture', 'trompete8'],
}


class Organ(Section):
    """Pipe ranks: each pipe is a fixed harmonic stack that speaks slowly (longer for
    big pipes) with a 'chiff' -- an overblown partial and a puff of wind noise at
    the onset.  Ranks are slightly mistuned against each other and all sag gently
    with the wind supply.  No vibrato, no velocity: loudness comes from the stops."""

    def __init__(self, tr, name, pan, spread, gain):
        super().__init__(tr, name, 1, pan, spread, gain)
        self.gain = gain
        self.spread = spread
        self.pan = pan
        self.noise = NoiseBank(8, lambda f: (f / (f + 300.0)) / (1.0 + (f / 2500.0) ** 2), self.rng)

    def play(self, b, d, p, v=0.7, stops='soft', shape=None, gate=1.0):
        tr, rng = self.tr, self.rng
        t0 = tr.sec(b)
        dur = max(0.1, d * tr.spb * gate)
        m0 = nn(p)
        for rname in ORGAN_STOPS[stops]:
            R = ORGAN_RANKS[rname]
            pr = np.random.default_rng([tr.seed, crc(rname), int(round(m0 * 4))])
            f = hz(m0) * R['mult'] * cents_to_ratio(pr.normal(0, 1.6))
            if f < 26.0 or f > 9000.0:
                continue
            key = (rname, int(round(m0 * 4)))
            T = self.tabs.get(key)
            if T is None:
                T = self.tabs[key] = build_tables(f, [R['fn']], lambda k: pr.normal(0, 0.4, len(k)), fmax=11000.0)
            speak = float(np.clip(0.03 + 5.0 / f, 0.03, 0.22))
            st = t0 + pr.uniform(0.0, 0.012)
            e = env_ar(dur * SR, speak, 0.13)
            n = len(e)
            t = np.arange(n) / SR
            dc = self.dyn(st, n, v, shape, dur)
            c = smooth_rand(n, 1.2, rng, 1.0)
            ph = np.cumsum(cents_to_ratio(c)) * (f / SR) + rng.random()
            sig = osc_bank(T, ph)[0] * e
            if R['chiff']:
                ch = R['chiff'] * f
                if ch < 0.4 * SR:
                    sig = sig + 0.35 * np.sin(2 * np.pi * ch * t) * np.exp(-t / 0.05) * np.minimum(t / 0.004, 1.0)
                sig = sig + self.noise.take(n, rng) * (0.22 * np.exp(-t / 0.035) * np.minimum(t / 0.003, 1.0))
            sig = sig + self.noise.take(n, rng) * (0.012 * e)
            pan = self.pan + self.spread * (1.0 if int(round(m0)) % 2 else -1.0) * pr.uniform(0.4, 1.0)
            tr.add('organ', st, sig * (R['g'] * dc ** 1.2), float(np.clip(pan, -0.9, 0.9)), self.gain)


# ----------------------------------------------------------------------------
# percussion
# ----------------------------------------------------------------------------
MEMBRANE = np.array([1.0, 1.593, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.600, 4.060, 4.601, 5.132])
MEMB_AMP = np.array([1.0, 0.5, 0.3, 0.26, 0.2, 0.15, 0.12, 0.1, 0.08, 0.07, 0.05, 0.04])
MEMB_T60 = np.array([1.0, 0.55, 0.42, 0.40, 0.33, 0.30, 0.27, 0.24, 0.22, 0.20, 0.18, 0.16])
TUBE = np.array([9, 25, 49, 81, 121, 169, 225, 289, 361, 441, 529], dtype=np.float64) / 40.5

TAIKO = {
    'o': dict(f=(63.0, 60.5, 66.0), T=1.5, glide=0.16, gt=0.05, stick=(900.0, 5000.0, 0.006, 0.5),
              knock=(150.0, 420.0, 0.03, 0.45), pans=(0.0, -0.3, 0.3), g=1.0),
    'c': dict(f=(104.0, 111.0), T=0.75, glide=0.14, gt=0.035, stick=(1200.0, 6000.0, 0.005, 0.6),
              knock=(250.0, 700.0, 0.02, 0.4), pans=(-0.22, 0.26), g=0.6),
    's': dict(f=(318.0,), T=0.26, glide=0.06, gt=0.02, stick=(2000.0, 8000.0, 0.004, 0.7),
              knock=(500.0, 1200.0, 0.012, 0.3), pans=(0.1,), g=0.34),
}


def resample_up(x, k):
    """Band-limited upsampling by an integer factor (FFT zero-padding)."""
    n = len(x)
    X = np.fft.rfft(x)
    Y = np.zeros(n * k // 2 + 1, dtype=np.complex128)
    Y[:len(X)] = X
    return np.fft.irfft(Y, n * k) * k


def modal(f0, ratios, amps, t60s, dur, glide, gtau, rng, split=0.004, att=0.0015, sr=SR):
    """Sum of decaying inharmonic partials.  All partials share an initial pitch
    drop (membrane tension relaxing); each is a slightly split doublet (beating)."""
    n = int(dur * sr)
    t = np.arange(n) / sr
    base = 2 * np.pi * (t + glide * gtau * (1.0 - np.exp(-t / gtau)))
    out = np.zeros(n)
    for r, a, T in zip(ratios, amps, t60s):
        w = f0 * r
        if w > 0.45 * sr or a <= 0:
            continue
        dcy = np.exp(-6.908 * t / T)
        out += a * dcy * np.sin(w * base)
        out += 0.6 * a * dcy * np.sin(w * (1.0 + split * rng.uniform(0.5, 1.5)) * base + rng.uniform(0, 0.6))
    return out * np.minimum(t / att, 1.0)


def burst(dur, lo, hi, tau, rng):
    """Band-limited noise burst (stick / beater / mallet contact)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = shaped_noise(n, lambda f: (f / (f + lo)) ** 2 / (1.0 + (f / hi) ** 4), rng)
    return x * np.exp(-t / tau) * np.minimum(t / 0.0004, 1.0)


def band_wash(n, edges, env_fn, gain_fn, rng):
    """Dense 'metal' sound above the range where single partials can be heard:
    band-split noise, every band with its own swell and decay."""
    t = np.arange(n) / SR
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    lf = np.log(np.maximum(f, 1.0))
    out = np.zeros(n)
    nb = len(edges) - 1
    for j in range(nb):
        lo, hi = np.log(edges[j]), np.log(edges[j + 1])
        w = (hi - lo) * 0.5
        mask = np.clip((lf - lo) / w + 0.5, 0, 1) * np.clip((hi - lf) / w + 0.5, 0, 1)
        mask = np.sin(0.5 * np.pi * mask) ** 2
        xb = np.fft.irfft(X * mask, n)
        xb /= np.sqrt(np.mean(xb * xb) + 1e-20)
        out += xb * env_fn(j, nb, t) * gain_fn(j, nb, np.sqrt(edges[j] * edges[j + 1]))
    return out


class Perc:
    """Timpani, gran cassa, taiko, tam-tam, cymbals, tubular bells."""

    def __init__(self, tr, gain=1.0):
        self.tr = tr
        self.rng = np.random.default_rng([tr.seed, crc('perc')])
        self.cache = {}
        self.gain = gain

    def _get(self, key, maker):
        x = self.cache.get(key)
        if x is None:
            x = maker(np.random.default_rng([self.tr.seed, crc(repr(key))]))
            x = (x / np.max(np.abs(x))).astype(np.float32)
            self.cache[key] = x
        return x

    # -- timpani: tuned kettle, partials 1 : 1.5 : 1.98 : 2.44 ...
    def timp(self, b, p, v=0.7, pan=-0.08, scale=1.0):
        m = nn(p)
        vq = int(np.clip(round(v * 8), 1, 10))
        var = int(self.rng.integers(3))

        def mk(rng):
            vv = vq / 8.0
            f = hz(m)
            ratios = [1.0, 1.50, 1.98, 2.44, 2.91, 3.37, 3.84, 0.60, 1.35, 2.20]
            amps = [1.0, 0.62 * vv ** 0.3, 0.40 * vv ** 0.6, 0.24 * vv ** 0.9, 0.14 * vv ** 1.2, 0.08 * vv ** 1.5,
                    0.05 * vv ** 1.8, 0.45, 0.12 * vv, 0.08 * vv]
            k = (130.0 / f) ** 0.3
            t60 = [2.6 * k, 1.9 * k, 1.4 * k, 1.0 * k, 0.7 * k, 0.5 * k, 0.4 * k, 0.13, 0.3, 0.25]
            x = modal(f, ratios, amps, t60, 3.4, 0.012 * vv, 0.05, rng, split=0.003)
            s = burst(0.12, 60.0, 350.0 + 1500.0 * vv, 0.012, rng) * (0.5 + 0.5 * vv)
            x[:len(s)] += s * 0.9
            return x
        x = self._get(('timp', m, vq, var), mk)
        self.tr.add('drums', self.tr.sec(b) + self.rng.normal(0, 0.004), x, pan, self.gain * 0.75 * scale * v ** 1.6)

    def timp_roll(self, b, d, p, v0, v1, rate=13.0):
        t, end = 0.0, d * self.tr.spb
        while t < end:
            x = t / end
            v = v0 + (v1 - v0) * x ** 1.3
            self.timp(b + t / self.tr.spb, p, v * self.rng.uniform(0.85, 1.0), scale=0.62)
            t += (1.0 / rate) * self.rng.uniform(0.9, 1.1)

    # -- gran cassa: big two-headed bass drum, soft beater
    def gc(self, b, v=0.7, pan=0.1):
        vq = int(np.clip(round(v * 8), 1, 10))

        def mk(rng):
            vv = vq / 8.0
            amps = MEMB_AMP * vv ** (0.3 * np.arange(12))
            x = modal(41.0, MEMBRANE, amps, 2.4 * MEMB_T60 ** 0.8, 3.8, 0.10 * vv, 0.06, rng, att=0.003)
            s = burst(0.2, 30.0, 220.0 + 520.0 * vv, 0.022, rng)
            x[:len(s)] += s * 0.55
            return x
        x = self._get(('gc', vq, int(self.rng.integers(2))), mk)
        self.tr.add('drums', self.tr.sec(b) + self.rng.normal(0, 0.004), x, pan, self.gain * 1.15 * v ** 1.6)

    # -- taiko: 'o' odaiko (three players), 'c' chu-daiko (two), 's' shime, 'k' rim click
    def taiko(self, b, v=0.8, kind='o'):
        tr, rng = self.tr, self.rng
        if kind == 'k':
            def mk(r):
                n = int(0.25 * SR)
                t = np.arange(n) / SR
                x = np.zeros(n)
                for f, T, a in ((540.0, 0.09, 1.0), (1180.0, 0.06, 0.8), (2350.0, 0.04, 0.5), (3900.0, 0.03, 0.3)):
                    x += a * np.exp(-6.9 * t / T) * np.sin(2 * np.pi * f * r.uniform(0.96, 1.04) * t)
                s = burst(0.05, 1500.0, 7000.0, 0.004, r)
                x[:len(s)] += s * 0.8
                return x * np.minimum(t / 0.0005, 1.0)
            for j, pan in enumerate((-0.3, 0.32)):
                x = self._get(('ka', j), mk)
                tr.add('drums', tr.sec(b) + rng.normal(0, 0.006), x, pan, self.gain * 0.2 * v ** 1.4)
            return
        K = TAIKO[kind]
        vq = int(np.clip(round(v * 8), 1, 10))
        for j, f in enumerate(K['f']):
            def mk(r, f=f):
                vv = vq / 8.0
                amps = MEMB_AMP * vv ** (0.25 * np.arange(12))
                x = modal(f, MEMBRANE, amps, K['T'] * MEMB_T60, K['T'] * 1.25 + 0.2, K['glide'] * vv, K['gt'], r, att=0.0008)
                lo, hi, tau, g = K['stick']
                s = burst(0.06, lo, hi, tau, r)
                x[:len(s)] += s * g * (0.3 + 0.7 * vv)
                lo, hi, tau, g = K['knock']
                s = burst(0.2, lo, hi, tau, r)
                x[:len(s)] += s * g
                return x
            x = self._get(('taiko', kind, j, vq, int(rng.integers(2))), mk)
            tr.add('drums', tr.sec(b) + rng.normal(0, 0.007), x, K['pans'][j],
                   self.gain * K['g'] * v ** 1.5 * rng.uniform(0.9, 1.05))

    # -- tam-tam: low partials speak at once, the high wash blooms a second later
    def tam(self, b, v=0.6, pan=0.25):
        vq = int(np.clip(round(v * 6), 1, 7))

        def mk(rng):
            vv = vq / 6.0
            dur = 15.0
            sr4 = SR // 4
            n4 = int(dur * sr4)
            t = np.arange(n4) / sr4
            low = np.zeros(n4)
            fl = 34.0 * np.exp(np.cumsum(rng.uniform(0.02, 0.09, 60)))
            for f in fl:
                x = min(np.log2(f / 34.0) / 5.0, 1.0)
                rise = 0.004 + (0.9 - 0.45 * vv) * x ** 1.6
                T = 14.0 * (f / 40.0) ** -0.32
                a = (f / 60.0) ** -0.35 * rng.uniform(0.4, 1.0) * vv ** (0.9 * x)
                env = (1.0 - np.exp(-t / rise)) ** 2 * np.exp(-6.908 * t / T)
                ph = 2 * np.pi * f * t
                low += a * env * (np.sin(ph + rng.uniform(0, 6.28)) * np.minimum(t / 0.004, 1.0)
                                  + 0.7 * np.sin(ph * (1.0 + rng.uniform(0.002, 0.006)) + rng.uniform(0, 6.28)))
            low = resample_up(low, 4)
            n = len(low)

            def env_fn(j, nb, tt):
                x = (j + 0.5) / nb
                rise = 0.05 + (1.4 - 0.8 * vv) * x
                return (1.0 - np.exp(-tt / rise)) ** 2 * np.exp(-6.908 * tt / (10.5 - 7.0 * x))

            def gain_fn(j, nb, fc):
                x = (j + 0.5) / nb
                return (fc / 700.0) ** -0.55 * vv ** (1.6 * x + 0.2)
            wash = band_wash(n, np.geomspace(700.0, 11000.0, 9), env_fn, gain_fn, rng)
            x = low / np.sqrt(np.mean(low[:SR * 2] ** 2)) + 0.75 * wash / np.sqrt(np.mean(wash[:SR * 3] ** 2) + 1e-12)
            s = burst(0.25, 20.0, 180.0, 0.03, rng)
            x[:len(s)] += s * 0.6
            tt = np.arange(n) / SR
            return x * np.minimum(tt / 0.002, 1.0) * np.minimum((dur - tt) / 0.5, 1.0)
        x = self._get(('tam', vq), mk)
        self.tr.add('metal', self.tr.sec(b), x, pan, self.gain * 0.9 * v ** 1.4)

    # -- clashed cymbals
    def crash(self, b, v=0.8, pan=0.12):
        vq = int(np.clip(round(v * 5), 1, 6))

        def mk(rng):
            vv = vq / 5.0
            n = int(6.5 * SR)

            def env_fn(j, nb, tt):
                x = (j + 0.5) / nb
                return (1.0 - np.exp(-tt / (0.004 + 0.012 * x))) * np.exp(-6.908 * tt / (6.0 - 4.4 * x))

            def gain_fn(j, nb, fc):
                return (1.0 / (1.0 + (fc / 6500.0) ** 2)) * (fc / 1000.0) ** 0.2 * vv ** (0.8 * (j + 0.5) / nb)
            x = band_wash(n, np.geomspace(320.0, 15000.0, 11), env_fn, gain_fn, rng)
            tt = np.arange(n) / SR
            return x * np.minimum((6.5 - tt) / 0.4, 1.0)
        x = self._get(('crash', vq, int(self.rng.integers(2))), mk)
        self.tr.add('metal', self.tr.sec(b), x, pan, self.gain * 0.55 * v ** 1.4)

    # -- suspended cymbal roll with soft mallets: swells and brightens
    def cym_roll(self, b, d, v0, v1, pan=0.05, ring=3.5):
        tr = self.tr
        dur = d * tr.spb
        n = int((dur + ring) * SR)
        rng = np.random.default_rng([tr.seed, crc('roll%.3f' % b)])
        nd = int(dur * SR)

        def env_fn(j, nb, tt):
            x = np.clip(tt / dur, 0.0, 1.0)
            lvl = v0 + (v1 - v0) * x ** 1.6
            e = lvl ** (1.0 + 1.3 * j / nb)
            e = e * (1.0 + 0.10 * np.sin(2 * np.pi * 9.6 * tt + 0.7 * np.sin(2 * np.pi * 0.9 * tt)))
            tail = np.exp(-6.908 * np.maximum(tt - dur, 0.0) / (ring * (1.0 - 0.5 * j / nb)))
            return e * tail * np.minimum(tt / 0.15, 1.0)

        def gain_fn(j, nb, fc):
            return 1.0 / (1.0 + (fc / 7000.0) ** 2)
        x = band_wash(n, np.geomspace(300.0, 14000.0, 9), env_fn, gain_fn, rng)
        tt = np.arange(n) / SR
        x *= np.minimum((dur + ring - tt) / 0.3, 1.0)
        tr.add('metal', tr.sec(b), (x / 3.0).astype(np.float32), pan, self.gain * 0.5)

    # -- tubular bell: free-free tube partials (2n+1)^2, strike tone an octave below the 4th
    def bell(self, b, p, v=0.7, pan=-0.3):
        m = nn(p)
        vq = int(np.clip(round(v * 6), 1, 7))

        def mk(rng):
            vv = vq / 6.0
            f = hz(m)
            amps = np.array([0.05, 0.25, 0.5, 1.0, 0.8, 0.6, 0.45, 0.3, 0.2, 0.12, 0.07]) * vv ** (0.15 * np.arange(11))
            t60 = [14.0, 12.0, 10.0, 8.0, 6.5, 5.0, 3.8, 2.8, 2.0, 1.5, 1.1]
            x = modal(f, TUBE, amps, t60, 11.0, 0.0, 0.05, rng, split=0.003, att=0.001)
            s = burst(0.05, 1500.0, 6500.0, 0.006, rng)
            x[:len(s)] += s * 0.35 * vv
            tt = np.arange(len(x)) / SR
            return x * np.minimum((11.0 - tt) / 0.6, 1.0)
        x = self._get(('bell', m, vq), mk)
        self.tr.add('metal', self.tr.sec(b) + self.rng.normal(0, 0.003), x, pan, self.gain * 0.5 * v ** 1.4)
