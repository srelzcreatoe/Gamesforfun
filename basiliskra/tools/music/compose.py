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
                bm = np.minimum(bm + 0.1, 1.0)
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
            side = pr.uniform(0.4, 1.0)
            st = t0 + pr.uniform(0.0, 0.012)
            if f < 26.0 or f > 9000.0:
                continue
            key = (rname, int(round(m0 * 4)))
            T = self.tabs.get(key)
            if T is None:
                T = self.tabs[key] = build_tables(f, [R['fn']], lambda k: pr.normal(0, 0.4, len(k)), fmax=11000.0)
            speak = float(np.clip(0.03 + 5.0 / f, 0.03, 0.22))
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
            pan = self.pan + self.spread * (1.0 if int(round(m0)) % 2 else -1.0) * side
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


# ----------------------------------------------------------------------------
# score helper
# ----------------------------------------------------------------------------
def seq(inst, b, spec, v=0.7, tp=0, **kw):
    """Play a line written as 'PITCH:BEATS' tokens, e.g. "C3:2 Eb3:2 B2:3@0.9 r:1".
    'r' is a rest, 'C3+G3' a chord, '@x' overrides the velocity, tp transposes
    (semitones).  Returns the beat after the last token."""
    for tok in spec.split():
        body, dur = tok.split(':')
        vel = v
        if '@' in dur:
            dur, vv = dur.split('@')
            vel = float(vv)
        d = float(dur)
        if body != 'r':
            for p in body.split('+'):
                inst.play(b, d, nn(p) + tp, vel, **kw)
        b += d
    return b


# ----------------------------------------------------------------------------
# mixing desk, hall, mastering
# ----------------------------------------------------------------------------
MIX_DEFAULT = {
    'vn': dict(body='violin', pos='front', gain=1.0, dry=1.0, wet=0.55),
    'va': dict(body='viola', pos='front', gain=1.0, dry=1.0, wet=0.55),
    'vc': dict(body='cello', pos='front', gain=1.0, dry=1.0, wet=0.50),
    'cb': dict(body='bass', pos='front', gain=1.0, dry=1.0, wet=0.40),
    'brass': dict(pos='mid', gain=1.0, dry=0.9, wet=0.75),
    'ww': dict(pos='mid', gain=1.0, dry=1.0, wet=0.6),
    'choir': dict(pos='rear', gain=1.0, dry=0.75, wet=1.0),
    'organ': dict(pos='rear', gain=1.0, dry=0.7, wet=1.0),
    'drums': dict(pos='rear', gain=1.0, dry=1.0, wet=0.45, sat=0.6),
    'metal': dict(pos='rear', gain=1.0, dry=0.8, wet=0.8),
}
HALLS = {'front': dict(seed=101, predelay=0.012, er_gain=1.0),
         'mid': dict(seed=202, predelay=0.024, er_gain=0.8),
         'rear': dict(seed=303, predelay=0.036, er_gain=0.55)}


def bus_cfg(tr, name):
    base = name[:2] if name[:2] in ('vn', 'va', 'vc', 'cb') else name
    cfg = dict(MIX_DEFAULT[base])
    cfg.update(tr.mix.get(base, {}))
    return cfg


def window_rms_db(x, win):
    """RMS (dB) of consecutive windows of a (2, n) signal."""
    n = x.shape[1] // win
    p = (x[:, :n * win] ** 2).reshape(2, n, win).mean(axis=(0, 2))
    return 10.0 * np.log10(p + 1e-12)


def mixdown(tr, stems=False, log=print):
    """Body filters, stage/hall, summing -- all in the frequency domain."""
    N = tr.N
    f = np.fft.rfftfreq(N, 1.0 / SR)
    nb = len(f)
    dry = [np.zeros(nb, dtype=np.complex128), np.zeros(nb, dtype=np.complex128)]
    send = {}
    bodies = {}
    report = []
    for name in sorted(tr.buses):
        cfg = bus_cfg(tr, name)
        bus = tr.buses[name]
        if cfg.get('sat'):
            # gentle tape-like saturation of drum transients
            thr = cfg['sat'] * float(np.max(np.abs(bus))) + 1e-9
            bus = thr * np.tanh(bus / thr)
        X = [np.fft.rfft(bus[0].astype(np.float64)), np.fft.rfft(bus[1].astype(np.float64))]
        if cfg.get('body'):
            key = (cfg['body'], name[-1])
            if key not in bodies:
                fg, Hg = body_response(cfg['body'], [tr.seed % 97, crc(cfg['body'] + name[-1])])
                bodies[key] = np.interp(f, fg, Hg.real) + 1j * np.interp(f, fg, Hg.imag)
            for ch in (0, 1):
                X[ch] *= bodies[key]
        g = cfg['gain']
        s = send.setdefault(cfg['pos'], [np.zeros(nb, dtype=np.complex128), np.zeros(nb, dtype=np.complex128)])
        for ch in (0, 1):
            dry[ch] += (g * cfg['dry']) * X[ch]
            s[ch] += (g * cfg['wet']) * X[ch]
        if stems:
            y = np.stack([np.fft.irfft(g * cfg['dry'] * X[0], N), np.fft.irfft(g * cfg['dry'] * X[1], N)])
            report.append((name, window_rms_db(y[:, :int(tr.length * SR)], 10 * SR), db(np.max(np.abs(y)))))
        del X
    tr.buses.clear()
    bodies.clear()
    # hall
    wet_hp = (f / 90.0) / np.sqrt(1.0 + (f / 90.0) ** 2)
    for pos, s in send.items():
        h = HALLS[pos]
        ll, rr, lr, rl = [np.fft.rfft(ir, N) for ir in make_hall(h['seed'], h['predelay'], h['er_gain'])]
        dry[0] += (s[0] * ll + s[1] * rl) * wet_hp
        dry[1] += (s[1] * rr + s[0] * lr) * wet_hp
        del ll, rr, lr, rl
    send.clear()
    # master EQ: rumble filter (4th-order high-pass at 25 Hz), mono-ish sub-bass
    hp = 1.0 / np.sqrt(1.0 + (25.0 / np.maximum(f, 1e-3)) ** 8)
    hp[0] = 0.0
    mid = 0.5 * (dry[0] + dry[1]) * hp
    side = 0.5 * (dry[0] - dry[1]) * hp * (1.0 - 0.65 / (1.0 + (f / 95.0) ** 4))
    n = int(tr.length * SR)
    out = np.stack([np.fft.irfft(mid + side, N)[:n], np.fft.irfft(mid - side, N)[:n]])
    if stems:
        log('    bus      peak  | RMS per 10 s window (dB, dry only, before mastering)')
        for name, w, pk in report:
            log('    %-7s %6.1f | %s' % (name, pk, ' '.join('%4.0f' % x for x in w)))
        log('    %-7s %6.1f | %s' % ('MIX', db(np.max(np.abs(out))), ' '.join('%4.0f' % x for x in window_rms_db(out, 10 * SR))))
    return out


def compress(x, thr_db, ratio=1.7, knee=10.0, att=0.06, rel=0.7):
    """Gentle feed-forward bus compressor on the stereo-linked 100 ms RMS level."""
    hop = 256
    n = x.shape[1]
    nb = n // hop
    p = ((x[0, :nb * hop] ** 2 + x[1, :nb * hop] ** 2) * 0.5).reshape(nb, hop).mean(axis=1)
    k = max(1, int(0.1 * SR / hop))
    c = np.cumsum(np.concatenate([np.zeros(k), p]))
    lev = 10.0 * np.log10((c[k:] - c[:-k]) / k + 1e-12)
    over = lev - thr_db
    slope = 1.0 - 1.0 / ratio
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, over * slope, (over + knee / 2) ** 2 / (2 * knee) * slope))
    a_att = np.exp(-hop / (SR * att))
    a_rel = np.exp(-hop / (SR * rel))
    g = 0.0
    sm = np.empty(nb)
    for i in range(nb):
        tgt = gr[i]
        a = a_att if tgt > g else a_rel
        g = a * g + (1.0 - a) * tgt
        sm[i] = g
    gain_db = -np.interp(np.arange(n), (np.arange(nb) + 0.5) * hop, sm)
    return x * 10.0 ** (gain_db / 20.0), float(sm.max())


def limit(x, ceiling):
    """Look-ahead peak limiter: 3 ms look-ahead, instant attack, 120 ms release."""
    blk = 32
    n = x.shape[1]
    nb = n // blk + 1
    pk = np.zeros(nb * blk)
    pk[:n] = np.maximum(np.abs(x[0]), np.abs(x[1]))
    req = np.minimum(1.0, ceiling / np.maximum(pk.reshape(nb, blk).max(axis=1), 1e-9))
    la = 5
    pad = np.concatenate([req, np.ones(la)])
    ahead = req.copy()
    for j in range(1, la + 1):
        ahead = np.minimum(ahead, pad[j:j + nb])
    coef = 1.0 - np.exp(-blk / (SR * 0.12))
    g = 1.0
    sm = np.empty(nb)
    for i in range(nb):
        g = g + (1.0 - g) * coef
        if ahead[i] < g:
            g = ahead[i]
        sm[i] = g
    gs = np.repeat(sm, blk)
    k = 3 * blk
    c = np.cumsum(np.concatenate([np.full(k, gs[0]), gs]))
    gs = ((c[k:] - c[:-k]) / k)[:n]
    y = x * gs
    return np.clip(y, -ceiling, ceiling), float(-db(sm.min()))


def loudest_rms_db(x, seconds=10.0):
    p = (x[0] ** 2 + x[1] ** 2) * 0.5
    c = np.cumsum(np.concatenate([[0.0], p]))
    w = min(int(seconds * SR), len(p))
    return 10.0 * np.log10(np.max(c[w:] - c[:-w]) / w + 1e-12)


def true_peak_db(x, k=4):
    """Inter-sample peak estimate by 4x band-limited oversampling (in chunks)."""
    pk = 0.0
    step = 1 << 19
    for ch in x:
        for s in range(0, len(ch), step):
            seg = ch[max(0, s - 256):s + step + 256]
            pk = max(pk, float(np.max(np.abs(resample_up(seg, k)))))
    return db(pk)


def master(tr, x, log=print):
    x, gr = compress(x, thr_db=loudest_rms_db(x) - 8.0)
    x = x * 10.0 ** ((tr.target_db - loudest_rms_db(x)) / 20.0)
    x, lim = limit(x, 10.0 ** (-1.6 / 20.0))
    n = x.shape[1]
    nf = int(0.008 * SR)
    x[:, :nf] *= cosramp(nf)
    nt = int(min(3.0, tr.length - tr.lead - tr.music_len) * SR)
    x[:, n - nt:] *= cosramp(nt)[::-1] ** 2
    log('    master: compressor max %.1f dB, limiter max %.1f dB, loudest-10s RMS %.1f dBFS, peak %.2f dBFS'
        % (gr, lim, loudest_rms_db(x), db(np.max(np.abs(x)))))
    return x


def encode(x, path):
    """Stereo float -> Ogg Vorbis q5 through ffmpeg (bit-exact flags for determinism)."""
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', 'pipe:0',
           '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
           '-c:a', 'libvorbis', '-q:a', '5', path]
    subprocess.run(cmd, input=np.ascontiguousarray(x.T, dtype=np.float32).tobytes(), check=True)


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), 'pipe:1'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)


# ----------------------------------------------------------------------------
# the shared idea: his three knocks
# ----------------------------------------------------------------------------
def knock_motif(inst, b, root, v, hold=1.0, inv=False, last_shape=None, **kw):
    """Three even notes one beat apart (about 0.9 s): root, a minor third up, then
    a semitone below the root, the last one held.  inv=True mirrors the intervals
    (minor third down, semitone above)."""
    r = nn(root)
    s = -1 if inv else 1
    inst.play(b, 1.0, r, v, **kw)
    inst.play(b + 1.0, 1.0, r + 3 * s, v, **kw)
    inst.play(b + 2.0, 1.0 + hold, r - 1 * s, v, shape=last_shape, **kw)


SWELL = [(0.0, 0.2), (0.55, 1.0), (1.0, 0.15)]
HAIR = [(0.0, 0.3), (0.5, 1.0), (1.0, 0.25)]
CRESC = [(0.0, 0.25), (1.0, 1.0)]
FPCRESC = [(0.0, 1.0), (0.10, 0.55), (1.0, 1.05)]
DIM = [(0.0, 1.0), (0.25, 0.85), (1.0, 0.3)]


# ----------------------------------------------------------------------------
# I.  theme_dread -- "He is near"
# ----------------------------------------------------------------------------
def build_dread():
    tr = Track('theme_dread', 'He is near', bpm=200.0 / 3.0, bpb=4, bars=44, tail=6.5, seed=11,
               target_db=-18.5, key='D minor (octatonic colouring over a D pedal)')
    tr.sections = [('A  Depth: bass pedal, first knocks, first distant brass swell', 1),
                   ('B  The knock motif D-F-C# in celli/contrabassoon, sequenced by minor thirds; brass answers', 9),
                   ('C  Cold high violin line (the motif in half notes) over tremolo violas', 19),
                   ('D  Surge: the motif tutti, ff, four rising statements', 31),
                   ('E  Coda: pedal, last contrabassoon statement, three far knocks', 39)]
    tr.mix = {'brass': dict(dry=0.55, wet=1.15), 'ww': dict(dry=0.9, wet=0.7)}
    B = tr.bt
    v1 = Strings(tr, 'vn1', 'vn', 10, -0.62, 0.26, 0.22)
    v2 = Strings(tr, 'vn2', 'vn', 8, -0.25, 0.22, 0.20)
    va = Strings(tr, 'va', 'va', 7, 0.18, 0.20, 0.20)
    vc = Strings(tr, 'vc', 'vc', 6, 0.48, 0.20, 0.26)
    cb = Strings(tr, 'cb', 'cb', 5, 0.66, 0.16, 0.32)
    cbsn = Winds(tr, 'cbsn', 'cbsn', 1, 0.22, 0.0, 0.17)
    bcl = Winds(tr, 'bcl', 'bcl', 1, -0.12, 0.0, 0.10)
    hn = Winds(tr, 'hn', 'horn', 4, -0.20, 0.16, 0.34)
    tb = Winds(tr, 'tb', 'tbn', 3, 0.40, 0.12, 0.34)
    tu = Winds(tr, 'tuba', 'tuba', 1, 0.52, 0.0, 0.26)
    tp = Winds(tr, 'tp', 'tpt', 3, 0.15, 0.10, 0.24)
    men = Choir(tr, 'men', 'B', 8, 0.30, 0.30, 0.16)
    pc = Perc(tr)

    def knocks(bar, v, timp=True):
        for k in range(3):
            pc.gc(B(bar, 1 + k), v * (1.0, 0.86, 0.93)[k])
            if timp:
                pc.timp(B(bar, 1 + k), 'D2', v * 0.8)

    # ---- the pedal: basses on D1/D2 for the whole piece except the surge.
    #      The two halves of the section change bow in different bars.
    cb.dynamics([(1, 1, .34), (2, 3, .46), (4, 1, .34), (6, 1, .48), (8, 1, .38), (9, 1, .42), (15, 1, .56),
                 (17, 1, .42), (19, 1, .36), (27, 1, .42), (29, 1, .56), (31, 1, 1.0), (38, 4, 1.0),
                 (39, 1, .44), (42, 1, .36), (44, 1, .26), (45, 1, 0.0)])
    for bar in list(range(1, 29, 2)) + [39, 41, 43]:
        cb.play(B(bar), 8.3, 'D1', 1.0, div=(0, 2), vib=0.5)
    cb.play(B(29), 8.0, 'D1', 1.0, div=(0, 2), vib=0.5)
    cb.play(B(1), 4.3, 'D2', 1.0, div=(1, 2), vib=0.5)
    for bar in list(range(2, 29, 2)) + [40, 42]:
        cb.play(B(bar), 8.3, 'D2', 1.0, div=(1, 2), vib=0.5)
    cb.play(B(30), 4.0, 'D2', 1.0, div=(1, 2), vib=0.5)
    cb.play(B(39), 4.3, 'D2', 1.0, div=(1, 2), vib=0.5)
    cb.play(B(44), 4.3, 'D2', 1.0, div=(1, 2), vib=0.5)

    # ---- A. Depth (bars 1-8)
    pc.tam(B(1), 0.30)
    pc.gc(B(1), 0.38)
    knocks(3, 0.45)
    va.play(B(4), 8.0, 'D3', 0.36, tone='pont', trem=1.0, div=(0, 2), shape=HAIR)
    va.play(B(4), 8.0, 'Eb3', 0.36, tone='pont', trem=1.0, div=(1, 2), shape=HAIR)
    seq(cbsn, B(5), 'D2:4 F2:2 C#2:2', v=0.50, leg=True)        # the motif foreshadowed, twice as slow
    seq(bcl, B(5), 'D3:4 F3:2 C#3:2', v=0.34, leg=True)
    knocks(7, 0.50)
    hn.chord(B(7), 7.6, ['D3', 'A3'], 0.50, shape=SWELL)
    tb.chord(B(7), 7.6, ['D2', 'A2'], 0.50, shape=SWELL)
    hn.play(B(8), 3.6, 'Bb3', 0.42, div=(3, 4), shape=SWELL)       # the flat sixth rubs against A
    va.play(B(7, 3), 6.0, 'D3', 0.34, tone='pont', trem=1.0, div=(0, 2), shape=HAIR)
    va.play(B(7, 3), 6.0, 'Eb3', 0.34, tone='pont', trem=1.0, div=(1, 2), shape=HAIR)

    # ---- B. The motif (bars 9-18): D, F, Ab, D -- a cycle of minor thirds; each
    #      held note is answered by a distant minor triad a third further on.
    for bar, root, ch_tb, ch_hn, v in [
            (9, 'D2', ['Bb2', 'Db3', 'F3'], ['F3', 'Bb3', 'Db4', 'F4'], 0.55),
            (11, 'F2', ['Ab2', 'Db3', 'E3'], ['E3', 'Ab3', 'Db4', 'E4'], 0.60),
            (13, 'Ab2', ['G2', 'B2', 'E3'], ['E3', 'G3', 'B3', 'E4'], 0.66),
            (15, 'D3', ['G2', 'Bb2', 'E3'], ['E3', 'G3', 'Bb3', 'C#4'], 0.80)]:
        knock_motif(vc, B(bar), root, v, hold=4.0, art='marc', gate=0.97, last_shape=DIM)
        knock_motif(cbsn, B(bar), nn(root) - (12 if bar == 15 else 0), v * 0.9, hold=4.0, art='marc', gate=0.97,
                    last_shape=DIM)
        for k in range(3):
            pc.gc(B(bar, 1 + k), 0.30 + 0.12 * (bar == 15))
        hn.chord(B(bar + 1), 4.3, ch_hn, v * 0.85, shape=SWELL)
        tb.chord(B(bar + 1), 4.3, ch_tb, v * 0.85, shape=SWELL)
    knock_motif(va, B(15), 'D3', 0.70, hold=4.0, art='marc', gate=0.97, last_shape=DIM)
    tu.play(B(16), 4.2, 'D2', 0.50, shape=SWELL)
    pc.tam(B(15), 0.38)
    for bar in (10, 12):
        va.play(B(bar), 8.2, 'A3', 0.33, tone='pont', trem=1.0, div=(0, 2), shape=HAIR)
        va.play(B(bar), 8.2, 'Bb3', 0.33, tone='pont', trem=1.0, div=(1, 2), shape=HAIR)
    knocks(17, 0.46)
    cbsn.play(B(17), 8.0, 'D1', 0.42, shape=HAIR)
    va.play(B(17), 8.0, 'D3', 0.33, tone='pont', trem=1.0, div=(0, 2), shape=DIM)
    va.play(B(17), 8.0, 'Eb3', 0.33, tone='pont', trem=1.0, div=(1, 2), shape=DIM)

    # ---- C. The cold line (bars 19-30): the motif in half notes, high, senza
    #      vibrato, shadowed a fourth lower; then it slides down by semitones.
    v1.dynamics([(19, 1, .40), (23, 1, .48), (27, 1, .52), (29, 1, .60), (31, 1, 1.0), (38, 4, 1.0),
                 (39, 1, .30), (44, 1, .28), (45, 1, 0.0)])
    v2.dynamics([(19, 1, .36), (23, 1, .42), (27, 1, .48), (29, 1, .60), (31, 1, 1.0), (38, 4, 1.0)])
    seq(v1, B(19), 'A5:2 C6:2 G#5:6', v=1.0, leg=True, tone='harm', vib=0.15)
    seq(v2, B(19), 'E5:2 G5:2 D#5:6', v=1.0, leg=True, tone='harm', vib=0.15)
    seq(v1, B(23), 'D6:2 F6:2 C#6:6 C6:2 B5:2 Bb5:2 A5:8', v=1.0, leg=True, tone='harm', vib=0.15)
    seq(v2, B(23), 'A5:2 C6:2 G#5:6 G5:2 F#5:2 F5:2 E5:8', v=1.0, leg=True, tone='harm', vib=0.15)
    for bar in (19, 21, 23, 25, 27):
        va.play(B(bar), 8.2, 'A3', 0.34, tone='pont', trem=1.0, div=(0, 2), shape=[(0, .5), (.5, 1), (1, .5)])
        va.play(B(bar), 8.2, 'Bb3', 0.34, tone='pont', trem=1.0, div=(1, 2), shape=[(0, .5), (.5, 1), (1, .5)])
    for bar in (19, 21, 23, 25):
        vc.chord(B(bar), 8.2, ['A2', 'D3'], 0.30, vib=0.4)
    knocks(21, 0.42)
    hn.chord(B(22), 4.2, ['D3', 'A3', 'Bb3'], 0.42, shape=SWELL)
    knocks(25, 0.45)
    knock_motif(vc, B(27), 'D2', 0.50, hold=4.0, art='marc', gate=0.97, last_shape=DIM)
    knock_motif(cbsn, B(27), 'D2', 0.48, hold=4.0, art='marc', gate=0.97, last_shape=DIM)
    # bars 29-30: everything starts to rise
    knocks(29, 0.55)
    knocks(30, 0.72)
    v1.play(B(29), 8.0, 'A5', 0.9, to='F6', trem=1.0, shape=CRESC)
    v2.play(B(29), 8.0, 'E5', 0.9, to='Db6', trem=1.0, shape=CRESC)
    va.play(B(29), 8.0, 'A3', 0.8, to='Db4', tone='pont', trem=1.0, div=(0, 2), shape=CRESC)
    va.play(B(29), 8.0, 'Bb3', 0.8, to='F4', tone='pont', trem=1.0, div=(1, 2), shape=CRESC)
    vc.chord(B(29), 8.0, ['D2', 'A2'], 0.8, trem=1.0, shape=CRESC)
    tb.chord(B(29), 7.8, ['D2', 'A2', 'D3'], 0.78, shape=CRESC)
    hn.chord(B(29), 7.8, ['D3', 'A3', 'Eb4'], 0.78, shape=CRESC)
    tu.play(B(29), 7.8, 'D1', 0.70, shape=CRESC)
    pc.timp_roll(B(29), 8.0, 'D2', 0.15, 0.8)
    pc.cym_roll(B(30), 4.0, 0.10, 0.70)

    # ---- D. Surge (bars 31-38): the motif in every bass instrument, ff, on D, F, Ab
    #      and D again; over it minor triads a third apart and a rising violin line.
    units = [
        (31, 'D', ['Bb2', 'Db3', 'F3'], ['F3', 'Bb3', 'Db4', 'F4'], None, ['Db4', 'F4'], 'Db6', 'F6', 0.86),
        (33, 'F', ['Ab2', 'Db3', 'E3'], ['E3', 'Ab3', 'Db4', 'E4'], None, ['E4', 'Ab4'], 'E6', 'Ab6', 0.90),
        (35, 'Ab', ['G2', 'B2', 'E3'], ['G3', 'B3', 'E4', 'G4'], ['E4', 'G4', 'B4'], ['G4', 'B4'], 'G6', 'B6', 0.95),
        (37, 'D', ['G2', 'Bb2', 'E3'], ['G3', 'Bb3', 'C#4', 'E4'], ['G4', 'Bb4', 'C#5'], ['Bb4', 'C#5'], 'Bb6', 'D7', 1.0),
    ]
    for bar, root, ch_tb, ch_hn, ch_tp, ch_va, n2, n1, v in units:
        last = bar == 37
        hold = 1.0 if last else 5.0
        b = B(bar)
        r1, r2 = nn(root + '1'), nn(root + '2')
        if root == 'Ab':
            r1, r2 = nn('Ab1'), nn('Ab2')
        for inst, r, kw in ((cbsn, r1, {}), (tu, r1, {}), (vc, r2, {}), (cb, r1, dict(div=(0, 2))), (cb, r2, dict(div=(1, 2)))):
            knock_motif(inst, b, r, v, hold=hold, art='marc', gate=0.96, last_shape=None if last else FPCRESC, **kw)
        for k, vv in enumerate((0.92, 0.82, 0.88)):
            pc.gc(b + k, vv * v)
            pc.timp(b + k, r2 + (0, 3, -1)[k], 0.85 * v)
        dur = 4.0 if last else 7.7
        hn.chord(b, dur, ch_hn, v, art='sfz', shape=FPCRESC)
        tb.chord(b, dur, ch_tb, v, art='sfz', shape=FPCRESC)
        if ch_tp:
            tp.chord(b, dur, ch_tp, v * 0.9, art='sfz', shape=FPCRESC)
        va.chord(b, dur, ch_va, 1.0, trem=1.0, shape=[(0, .8), (1, 1)])
        v2.play(b, dur, n2, 1.0, trem=1.0, shape=[(0, .8), (1, 1)])
        v1.play(b, dur, n1, 1.0, trem=1.0, shape=[(0, .8), (1, 1)])
        if not last:
            pc.timp_roll(b + 4.0, 4.0, r2 - 1, 0.3, 0.8)
            pc.cym_roll(b + 4.0, 4.0, 0.15, 0.6)
    pc.tam(B(31), 0.70)
    pc.crash(B(31), 0.70)
    pc.crash(B(35), 0.70)
    pc.tam(B(37), 0.85)
    # bar 38: the diminished chord collapses onto bare D and A, fff, then is cut off
    b = B(38)
    for inst, p, kw in ((cbsn, 'D1', {}), (tu, 'D1', {}), (vc, 'D2', {}), (cb, 'D1', dict(div=(0, 2))), (cb, 'D2', dict(div=(1, 2)))):
        inst.play(b, 3.0, p, 1.0, art='marc', **kw)
    hn.chord(b, 3.0, ['A3', 'D4', 'A3', 'D4'], 1.0, art='sfz')
    tb.chord(b, 3.0, ['D2', 'A2', 'D3'], 1.0, art='sfz')
    tp.chord(b, 3.0, ['A4', 'D5', 'A4'], 0.92, art='sfz')
    va.chord(b, 3.0, ['A4', 'D5'], 1.0, trem=1.0)
    v2.play(b, 3.0, 'A6', 1.0, trem=1.0)
    v1.play(b, 3.0, 'D7', 1.0, trem=1.0)
    pc.gc(b, 1.0)
    pc.crash(b, 0.9)
    pc.timp_roll(b, 3.0, 'D2', 0.9, 0.95)

    # ---- E. Coda (bars 39-44)
    knock_motif(cbsn, B(40), 'D2', 0.42, hold=3.0, leg=True, last_shape=DIM)
    cbsn.play(B(41, 3), 6.0, 'D2', 0.36, leg=True, shape=DIM)
    men.chord(B(39, 3), 14.0, ['A2', 'D3'], 0.34, vowel=-0.3, shape=[(0, .3), (.4, 1), (1, .2)])
    v1.play(B(41), 10.0, 'A5', 1.0, tone='harm', vib=0.15, shape=[(0, .6), (.3, 1), (1, .3)])
    knocks(43, 0.32)
    return tr


# ----------------------------------------------------------------------------
# II.  theme_wrath -- "He is fighting"
# ----------------------------------------------------------------------------
# The march theme (trombone octave).  Its head is the knock motif in half notes
# (C - Eb - B); both halves end with a falling tritone (C-F#, G-Db).
WRATH_THEME = 'C3:2 Eb3:2 B2:3 G2:1 Ab2:1.5 Bb2:.5 C3:2 F#2:4 C3:2 Eb3:2 B2:2 D3:1 F3:1 Ab3:3 G3:1 Db3:2 C3:2'
# violin counter-line for the second and third statements
WRATH_COUNTER = 'Eb5:2 G5:2 B5:4 C6:3 Bb5:1 A5:4 G5:2 Eb5:2 D5:2 F5:2 Ab5:3 G5:1 F5:2 Eb5:2'
# harmony of the eight theme bars:  Cm | Em | Ab | F#m | Cm | G7/B | Fm | Db - Cm
#   (bass per half bar, accented ostinato notes per beat, repeated note per beat)
WRATH_OST = [
    (('C2', 'C2'), ['C3', 'Eb3', 'B2', 'C3'], ['C3'] * 4),
    (('E2', 'E2'), ['E3', 'G3', 'D#3', 'E3'], ['E3'] * 4),
    (('Ab1', 'Ab1'), ['Ab2', 'C3', 'G2', 'Ab2'], ['Ab2'] * 4),
    (('F#1', 'F#1'), ['F#2', 'A2', 'F2', 'F#2'], ['F#2'] * 4),
    (('C2', 'C2'), ['C3', 'Eb3', 'B2', 'C3'], ['C3'] * 4),
    (('B1', 'B1'), ['B2', 'D3', 'F3', 'D3'], ['B2'] * 4),
    (('F1', 'F1'), ['F2', 'Ab2', 'E2', 'F2'], ['F2'] * 4),
    (('Db2', 'C2'), ['Db3', 'F3', 'C3', 'B2'], ['Db3', 'Db3', 'C3', 'C3']),
]
WRATH_TIMP = [['C3'] * 3, ['E3'] * 3, ['Ab2'] * 3, ['F#2'] * 3, ['C3'] * 3, ['B2'] * 3, ['F2'] * 3, ['Db3', 'Db3', 'C3']]
# choir voicings (bass, tenor, alto, soprano) for the same eight bars
WRATH_CHOIR = [
    [(4, ['C3', 'C4', 'Eb4', 'G4'])], [(4, ['E3', 'B3', 'E4', 'G4'])], [(4, ['Ab2', 'C4', 'Eb4', 'Ab4'])],
    [(4, ['F#2', 'C#4', 'F#4', 'A4'])], [(4, ['C3', 'C4', 'Eb4', 'G4'])], [(4, ['B2', 'D4', 'F4', 'G4'])],
    [(4, ['F3', 'C4', 'F4', 'Ab4'])], [(2, ['Db3', 'Db4', 'F4', 'Ab4']), (2, ['C3', 'C4', 'Eb4', 'G4'])],
]


def build_wrath():
    tr = Track('theme_wrath', 'He is fighting', bpm=70.0, bpb=4, bars=46, tail=6.0, seed=22,
               target_db=-16.5, key='C minor')
    tr.sections = [('Intro  Taiko / gran cassa ostinato alone, timpani knocks, strings enter', 1),
                   ('A   March theme: trombones and tuba in octaves over the string gallop', 5),
                   ("A'  Theme again with horns an octave above, violin counter-line, trumpets join", 13),
                   ('B   Development: knock motif passed between horns and trombones, Abm - Bm - Dm - G', 21),
                   ('C   Climax: theme in four octaves of brass, choir "ah", full percussion', 29),
                   ('C2  Hammer chords Cm - Ebm - Bm, Neapolitan D-flat, arrival on bare C', 37),
                   ('Coda  Ostinato dies away to the three knocks over a low C', 39)]
    B = tr.bt
    v1 = Strings(tr, 'vn1', 'vn', 10, -0.62, 0.26, 0.22)
    v2 = Strings(tr, 'vn2', 'vn', 8, -0.25, 0.22, 0.20)
    va = Strings(tr, 'va', 'va', 7, 0.18, 0.20, 0.21)
    vc = Strings(tr, 'vc', 'vc', 6, 0.48, 0.20, 0.25)
    cb = Strings(tr, 'cb', 'cb', 5, 0.66, 0.16, 0.30)
    hn = Winds(tr, 'hn', 'horn', 4, -0.20, 0.16, 0.36)
    tb = Winds(tr, 'tb', 'tbn', 3, 0.40, 0.12, 0.40)
    tu = Winds(tr, 'tuba', 'tuba', 1, 0.52, 0.0, 0.30)
    tp = Winds(tr, 'tp', 'tpt', 3, 0.15, 0.10, 0.30)
    chB = Choir(tr, 'chB', 'B', 8, 0.50, 0.22, 0.17)
    chT = Choir(tr, 'chT', 'T', 8, 0.17, 0.22, 0.17)
    chA = Choir(tr, 'chA', 'A', 8, -0.17, 0.22, 0.17)
    chS = Choir(tr, 'chS', 'S', 8, -0.50, 0.22, 0.17)
    choir = (chB, chT, chA, chS)
    pc = Perc(tr)

    def drums(bar, lvl, pat=1, ka=False, gc=True):
        """One bar of the ostinato: odaiko on beats 1-2-3 (the three knocks), a
        chu-daiko pick-up figure through beat 4."""
        b = B(bar)
        for beat, v in ((0, 1.0), (1, 0.78), (2, 0.9)):
            pc.taiko(b + beat, v * lvl, 'o')
        if gc:
            pc.gc(b, 0.9 * lvl)
            pc.gc(b + 2, 0.6 * lvl)
        fills = {1: [(3, .40), (7, .40), (10, .50), (12, .55), (13, .50), (14, .70), (15, .85)],
                 2: [(3, .45), (6, .50), (7, .40), (11, .50), (12, .60), (14, .60), (15, .80)],
                 3: [(2, .40), (3, .50), (6, .45), (7, .55), (10, .50), (11, .60), (12, .65), (13, .60), (14, .75), (15, .90)]}[pat]
        for i, v in fills:
            pc.taiko(b + i / 4.0, v * lvl, 'c')
        if pat == 3:
            for i in (1, 5, 9, 13):
                pc.taiko(b + i / 4.0, 0.5 * lvl, 's')
        if ka:
            for i in (2, 6, 10, 14):
                pc.taiko(b + i / 4.0, 0.6 * lvl, 'k')

    def gallop(bar, o, lvl, vns=False, basses=True):
        """String ostinato: an accented eighth and two sixteenths on every beat; the
        four accents trace root - third - leading note - root."""
        root, acc, ped = o
        for beat in range(4):
            b = B(bar) + beat
            a, p = nn(acc[beat]), nn(ped[beat])
            parts = [(vc, 0, 1.0), (va, 12, 0.92)] + ([(v2, 24, 0.85)] if vns else [])
            for inst, sh, g in parts:
                inst.play(b, 0.5, a + sh, lvl * g, art='spicc')
                inst.play(b + 0.5, 0.25, p + sh, lvl * g * 0.70, art='spicc')
                inst.play(b + 0.75, 0.25, p + sh, lvl * g * 0.80, art='spicc')
            if basses:
                r = nn(root[beat // 2])
                cb.play(b, 0.5, r, lvl, art='spicc')
                cb.play(b + 0.5, 0.5, r, lvl * 0.72, art='spicc')

    def minor_ost(root):
        r = nn(root)
        return ((r - 12, r - 12), [r, r + 3, r - 1, r], [r] * 4)

    # written dynamics
    tb.dynamics([(1, 1, .50), (4, 1, .50), (5, 1, .80), (8, 1, .88), (9, 1, .82), (11, 1, .92), (12, 3, .86),
                 (13, 1, .90), (20, 1, .97), (21, 1, .58), (25, 1, .72), (27, 1, .90), (28, 4, 1.0), (29, 1, 1.0),
                 (38, 4, 1.06), (39, 1, 1.0), (41, 1, .50), (47, 1, .30)])
    tu.dynamics([(1, 1, .50), (5, 1, .80), (12, 3, .86), (13, 1, .90), (20, 1, .97), (21, 1, .60), (27, 1, .90),
                 (29, 1, 1.0), (38, 4, 1.06), (39, 1, 1.0), (41, 1, .50), (47, 1, .30)])
    hn.dynamics([(1, 1, .50), (4, 4, .75), (13, 1, .88), (20, 1, .96), (21, 1, .58), (25, 1, .74), (27, 1, .92),
                 (29, 1, 1.0), (38, 4, 1.06), (39, 1, 1.0), (41, 1, .42), (47, 1, .30)])
    tp.dynamics([(1, 1, .60), (17, 1, .62), (20, 4, .80), (21, 1, .60), (25, 1, .74), (28, 4, .98), (29, 1, 1.0),
                 (38, 4, 1.06), (39, 1, 1.0), (41, 1, .50)])
    for s in (v1, v2):
        s.dynamics([(1, 1, .60), (13, 1, .80), (20, 4, .92), (21, 1, .40), (23, 1, .40), (28, 4, .95), (29, 1, 1.0),
                    (38, 4, 1.05), (39, 1, .9), (43, 1, .4)])

    # ---- Intro (bars 1-4)
    pc.tam(B(1), 0.45)
    drums(1, 0.85, 1)
    drums(2, 0.85, 2)
    drums(3, 0.90, 1)
    drums(4, 0.95, 2)
    for bar, v in ((3, 0.7), (4, 0.82)):
        for k, p in enumerate(('C3', 'Eb3', 'B2')):
            pc.timp(B(bar, 1 + k), p, v)
    pc.timp_roll(B(4, 4), 1.0, 'G2', 0.4, 0.9)
    gallop(3, WRATH_OST[0], 0.45)
    gallop(4, WRATH_OST[0], 0.62)
    tb.chord(B(4), 3.9, ['C2', 'C3', 'G2'], 1.0, shape=[(0, .5), (1, 1.5)])
    hn.chord(B(4), 3.9, ['C3', 'G3'], 1.0, shape=[(0, .5), (1, 1.5)])

    # ---- A (bars 5-12): theme in trombones + tuba
    seq(tb, B(5), WRATH_THEME, v=1.0, art='marc', gate=0.94)
    seq(tu, B(5), WRATH_THEME, v=1.0, tp=-12, art='marc', gate=0.94)
    for k in range(8):
        bar = 5 + k
        drums(bar, 0.90, 1 + k % 2)
        gallop(bar, WRATH_OST[k], 0.72 + 0.02 * k)
        pc.timp(B(bar), WRATH_TIMP[k][0], 0.75)
    for k, p in enumerate(('C3', 'Eb3', 'B2')):
        pc.timp(B(9, 1 + k), p, 0.8)
    pc.timp_roll(B(8, 3), 2.0, 'F#2', 0.3, 0.8)
    pc.timp_roll(B(12, 4), 1.0, 'G2', 0.4, 0.9)
    pc.crash(B(5), 0.55)

    # ---- A' (bars 13-20): horns double the theme an octave up, violins answer
    seq(tb, B(13), WRATH_THEME, v=1.0, art='marc', gate=0.94)
    seq(tu, B(13), WRATH_THEME, v=1.0, tp=-12, art='marc', gate=0.94)
    seq(hn, B(13), WRATH_THEME, v=1.0, tp=12, art='marc', gate=0.94)
    seq(v1, B(13), WRATH_COUNTER, v=1.0, leg=True)
    seq(v2, B(13), WRATH_COUNTER, v=1.0, tp=-12, leg=True)
    for k in range(8):
        bar = 13 + k
        drums(bar, 1.0, 1 + k % 2, ka=True)
        gallop(bar, WRATH_OST[k], 0.86 + 0.015 * k)
        for j in range(3):
            pc.timp(B(bar, 1 + j), WRATH_TIMP[k][j], 0.8 if j == 0 else 0.6)
    for bar, ch in ((17, ['Eb4', 'G4', 'C5']), (18, ['F4', 'G4', 'D5']), (19, ['F4', 'Ab4', 'C5'])):
        tp.chord(B(bar), 3.8, ch, 1.0, art='marc')
    tp.chord(B(20), 1.9, ['F4', 'Ab4', 'Db5'], 1.0, art='marc')
    tp.chord(B(20, 3), 1.9, ['Eb4', 'G4', 'C5'], 1.0, art='marc')
    pc.crash(B(13), 0.7)
    pc.timp_roll(B(16, 3), 2.0, 'F#2', 0.4, 0.9)
    pc.timp_roll(B(20, 4), 1.0, 'C3', 0.5, 0.9)

    # ---- B (bars 21-28): sudden quiet; the knock motif at its real speed climbs
    #      through A-flat minor, B minor, D minor onto the dominant.
    steps = [(21, 'Ab2', 0.40), (23, 'B2', 0.50), (25, 'D3', 0.66), (27, 'G2', 0.86)]
    for bar, root, lvl in steps:
        o = minor_ost(root)
        gallop(bar, o, lvl)
        gallop(bar + 1, o if bar != 27 else ((nn('G1'), nn('G1')), ['G2', 'B2', 'D3', 'F3'], ['G2'] * 4), lvl + 0.06)
    knock_motif(hn, B(21), 'Ab3', 1.0, hold=3.0, art='marc', gate=0.95, last_shape=DIM)
    knock_motif(tb, B(22), 'Ab2', 1.0, hold=2.0, art='marc', gate=0.95, last_shape=DIM)
    knock_motif(hn, B(23), 'B3', 1.0, hold=3.0, art='marc', gate=0.95, last_shape=DIM)
    knock_motif(tb, B(24), 'B2', 1.0, hold=2.0, art='marc', gate=0.95, last_shape=DIM)
    knock_motif(hn, B(25), 'D4', 1.0, hold=3.0, art='marc', gate=0.95)
    knock_motif(tp, B(25), 'D4', 1.0, hold=3.0, art='marc', gate=0.95)
    knock_motif(tb, B(26), 'D3', 1.0, hold=2.0, art='marc', gate=0.95)
    knock_motif(tu, B(26), 'D2', 1.0, hold=2.0, art='marc', gate=0.95)
    for inst, root in ((tb, 'G2'), (tu, 'G1'), (hn, 'G3'), (tp, 'G4')):
        knock_motif(inst, B(27), root, 1.0, hold=1.0, art='marc', gate=0.95)
    tb.chord(B(28), 3.9, ['G2', 'G3', 'D3'], 1.0, art='sfz', shape=FPCRESC)
    tu.play(B(28), 3.9, 'G1', 1.0, art='sfz', shape=FPCRESC)
    hn.chord(B(28), 1.95, ['G3', 'D4'], 1.0, art='sfz')
    hn.chord(B(28, 3), 1.95, ['F4', 'Ab4'], 1.0, art='marc', shape=CRESC)
    tp.play(B(28), 1.95, 'G4', 1.0, art='sfz')
    tp.chord(B(28, 3), 1.95, ['B4', 'D5', 'F5'], 1.0, art='marc', shape=[(0, .6), (1, 1.1)])
    for bar, a, b_ in ((23, 'F#5', 'D5'), (25, 'A5', 'F5')):
        v1.play(B(bar), 8.1, a, 1.0, trem=1.0)
        v2.play(B(bar), 8.1, b_, 1.0, trem=1.0)
    v1.play(B(27), 4.1, 'Bb5', 1.0, trem=1.0)
    v2.play(B(27), 4.1, 'G5', 1.0, trem=1.0)
    v1.play(B(28), 3.95, 'D6', 1.0, trem=1.0)
    v2.play(B(28), 3.95, 'B5', 1.0, trem=1.0)
    for bar, lvl in ((21, .50), (22, .50), (23, .55), (24, .58)):
        for k in range(3):
            pc.gc(B(bar, 1 + k), lvl * (1.0, 0.85, 0.92)[k])
        for i, v in ((12, .30), (13, .28), (14, .36), (15, .42)):
            pc.taiko(B(bar) + i / 4.0, v + 0.1 * (bar > 22), 'c')
        if bar > 22:
            pc.taiko(B(bar), 0.5, 'o')
    drums(25, 0.68, 1)
    drums(26, 0.74, 2)
    drums(27, 0.86, 1, ka=True)
    for i in range(16):
        pc.taiko(B(28) + i / 4.0, 0.35 + 0.65 * (i / 15.0) ** 1.5, 'o' if i % 4 == 0 else 'c')
    pc.gc(B(28), 0.8)
    pc.gc(B(28, 3), 0.8)
    pc.timp_roll(B(28), 4.0, 'G2', 0.3, 1.0)
    pc.cym_roll(B(27, 3), 6.0, 0.10, 0.90)

    # ---- C (bars 29-36): the theme in four octaves, choir, everything
    seq(tp, B(29), WRATH_THEME, v=1.0, tp=24, art='marc', gate=0.94)
    seq(hn, B(29), WRATH_THEME, v=1.0, tp=12, art='marc', gate=0.94)
    seq(tb, B(29), WRATH_THEME, v=1.0, art='marc', gate=0.94)
    seq(tu, B(29), WRATH_THEME, v=1.0, tp=-12, art='marc', gate=0.94)
    seq(v1, B(29), WRATH_COUNTER, v=1.0, leg=True)
    for k in range(8):
        bar = 29 + k
        drums(bar, 1.0, 3 if k % 2 == 0 else 2, ka=True)
        gallop(bar, WRATH_OST[k], 1.0, vns=True)
        for j in range(3):
            pc.timp(B(bar, 1 + j), WRATH_TIMP[k][j], 0.9 if j == 0 else 0.75)
        b = B(bar)
        for d, notes in WRATH_CHOIR[k]:
            for part, p in zip(choir, notes):
                part.play(b, d, p, 0.92 + 0.01 * k, leg=True, vowel=0.25)
            b += d
    pc.crash(B(29), 0.9)
    pc.tam(B(29), 0.8)
    pc.crash(B(33), 0.8)
    pc.timp_roll(B(32, 3), 2.0, 'F#2', 0.5, 1.0)
    pc.timp_roll(B(36, 4), 1.0, 'C3', 0.6, 1.0)
    pc.cym_roll(B(36, 3), 2.0, 0.3, 0.9, ring=1.5)

    # ---- bars 37-38: the knocks as three tutti chords (Cm - Ebm - Bm), silence,
    #      then the Neapolitan D-flat swelling into the final C.
    hammer = [
        dict(tu='C2', tb=['C3', 'Eb3', 'G3'], hn=['G3', 'C4', 'Eb4', 'G4'], tp=['Eb4', 'G4', 'C5'],
             ch=['C3', 'G3', 'Eb4', 'C5'], vn='C6', timp='C3'),
        dict(tu='Eb2', tb=['Eb3', 'Gb3', 'Bb3'], hn=['Bb3', 'Eb4', 'Gb4', 'Bb4'], tp=['Gb4', 'Bb4', 'Eb5'],
             ch=['Eb3', 'Bb3', 'Gb4', 'Eb5'], vn='Eb6', timp='Eb3'),
        dict(tu='B1', tb=['B2', 'D3', 'F#3'], hn=['F#3', 'B3', 'D4', 'F#4'], tp=['D4', 'F#4', 'B4'],
             ch=['B2', 'F#3', 'D4', 'B4'], vn='B5', timp='B2'),
    ]
    for k, h in enumerate(hammer):
        b = B(37, 1 + k)
        g = 0.72
        tu.play(b, 1.0, h['tu'], 1.0, art='sfz', gate=g)
        tb.chord(b, 1.0, h['tb'], 1.0, art='sfz', gate=g)
        hn.chord(b, 1.0, h['hn'], 1.0, art='sfz', gate=g)
        tp.chord(b, 1.0, h['tp'], 1.0, art='sfz', gate=g)
        for part, p in zip(choir, h['ch']):
            part.play(b, 1.0, p, 1.0, art='marc', vowel=0.3, gate=g)
        v1.play(b, 1.0, h['vn'], 1.0, art='marc', gate=g)
        v2.play(b, 1.0, nn(h['vn']) - 12, 1.0, art='marc', gate=g)
        va.chord(b, 1.0, h['hn'][:2], 1.0, art='marc', gate=g)
        vc.chord(b, 1.0, h['tb'][:2], 1.0, art='marc', gate=g)
        cb.play(b, 1.0, h['tu'], 1.0, art='marc', gate=g)
        pc.taiko(b, 1.0, 'o')
        pc.taiko(b, 0.9, 'c')
        pc.gc(b, 1.0)
        pc.timp(b, h['timp'], 1.0)
        pc.crash(b, 0.85 if k == 0 else 0.6)
    b = B(38)
    up = [(0, .62), (1, 1.1)]
    tu.play(b, 3.95, 'Db2', 1.0, art='sfz', shape=up)
    tb.chord(b, 3.95, ['Db3', 'F3', 'Ab3'], 1.0, art='sfz', shape=up)
    hn.chord(b, 3.95, ['Ab3', 'Db4', 'F4', 'Ab4'], 1.0, art='sfz', shape=up)
    tp.chord(b, 3.95, ['F4', 'Ab4', 'Db5'], 1.0, art='sfz', shape=up)
    for part, p in zip(choir, ['Db3', 'Ab3', 'F4', 'Db5']):
        part.play(b, 3.95, p, 1.0, vowel=0.3, shape=up)
    v1.play(b, 3.95, 'Ab5', 1.0, trem=1.0, shape=up)
    v2.play(b, 3.95, 'F5', 1.0, trem=1.0, shape=up)
    va.chord(b, 3.95, ['Db4', 'F4'], 1.0, trem=1.0, shape=up)
    vc.chord(b, 3.95, ['Db3', 'Ab3'], 1.0, trem=1.0, shape=up)
    cb.play(b, 3.95, 'Db2', 1.0, shape=up)
    pc.timp_roll(b, 4.0, 'Db3', 0.4, 1.0)
    pc.cym_roll(b, 4.0, 0.2, 1.0, ring=2.0)
    pc.gc(b, 0.9)
    for i in range(8):
        pc.taiko(B(38, 3) + i / 4.0, 0.4 + 0.6 * (i / 7.0) ** 1.5, 'o' if i % 4 == 0 else 'c')

    # ---- Coda (bars 39-46)
    b = B(39)
    fall = [(0, 1.0), (0.15, 0.8), (1, 0.25)]
    tu.play(b, 7.5, 'C2', 1.0, art='sfz', shape=fall)
    tb.chord(b, 7.5, ['C3', 'G3', 'C2'], 1.0, art='sfz', shape=fall)
    hn.chord(b, 6.0, ['G3', 'C4'], 1.0, art='sfz', shape=fall)
    tp.chord(b, 2.5, ['G4', 'C5', 'G4'], 1.0, art='sfz', shape=fall)
    for part, p in zip(choir, ['C3', 'G3', 'C4', 'G4']):
        part.play(b, 7.0, p, 1.0, vowel=0.3, shape=fall)
    v1.play(b, 6.0, 'C6', 1.0, trem=1.0, shape=fall)
    pc.tam(b, 0.95)
    pc.crash(b, 0.9)
    for bar, lvl, pat in ((39, .95, 1), (40, .86, 2), (41, .76, 1), (42, .66, 2)):
        drums(bar, lvl, pat)
        gallop(bar, WRATH_OST[0], lvl * 0.9, vns=False, basses=False)
    for bar, lvl in ((43, .58), (44, .50), (45, .42), (46, .34)):
        for k in range(3):
            pc.taiko(B(bar, 1 + k), lvl * (1.0, 0.8, 0.9)[k], 'o')
        pc.gc(B(bar), lvl)
    cb.dynamics([(39, 1, .9), (42, 1, .6), (46, 1, .4), (47, 1, 0.0)])
    for bar in (39, 41, 43, 45):
        cb.play(B(bar), 8.3, 'C1', 1.0, div=(0, 2), vib=0.4)
    for bar in (40, 42, 44):
        cb.play(B(bar), 8.3 if bar < 44 else 12.3, 'C2', 1.0, div=(1, 2), vib=0.4)
    cb.play(B(39), 4.3, 'C2', 1.0, div=(1, 2), vib=0.4)
    knock_motif(hn, B(41), 'C4', 1.0, hold=4.0, art='marc', gate=0.95, last_shape=DIM)
    knock_motif(tb, B(43), 'C3', 1.0, hold=4.0, gate=0.95, last_shape=DIM)
    return tr


# ----------------------------------------------------------------------------
# III.  theme_last -- "The last form"
# ----------------------------------------------------------------------------
# Chorale (two four-bar phrases):  Fm | Dbmaj7 | Bbm/Db | C (4-3)  ||  Fm | Dbm | Gb | Fm/C - C7
LAST_S = ('F4:2 Ab4:2 C5:3 Bb4:1 Db5:2 C5:1 Bb4:1 G4:4', 'Ab4:2 C5:2 Db5:2 Fb5:2 Db5:2 Bb4:2 Ab4:2 G4:2')
LAST_A = ('C4:4 F4:4 F4:4 F4:2 E4:2', 'F4:4 E4:2 Ab4:2 Gb4:4 F4:2 E4:2')
LAST_T = ('Ab3:4 Ab3:4 Bb3:4 C4:4', 'C4:2 Ab3:2 Ab3:4 Bb3:4 C4:2 Bb3:2')
LAST_B = ('F2:4 Db3:4 Db3:4 C3:4', 'F2:4 Db3:4 Gb2:4 C3:4')


def build_last():
    tr = Track('theme_last', 'The last form', bpm=64.0, bpb=4, bars=42, tail=7.0, seed=33,
               target_db=-17.0, key='F minor')
    tr.sections = [('Intro  Organ pedal F, tolling bell, men humming a bare fifth', 1),
                   ('A   Chorale, choir alone over the organ pedal (pp to mp)', 5),
                   ('B   Horns: the knock motif inverted (C-A-Db), harmonised Fm - A - Db; chorale phrase with strings; second horn call', 13),
                   ('C   Chorale in full brass, choir, organ, bell every bar, timpani knocks', 21),
                   ('C2  The wall: F minor then G-flat over an F pedal, hammered inverted motif', 29),
                   ('D   Collapse: bell, distant horns, choir cadence pp', 31),
                   ('Coda  A single low F; three last knocks', 37)]
    tr.mix = {'choir': dict(gain=1.15), 'organ': dict(gain=1.0)}
    B = tr.bt
    v1 = Strings(tr, 'vn1', 'vn', 10, -0.62, 0.26, 0.22)
    v2 = Strings(tr, 'vn2', 'vn', 8, -0.25, 0.22, 0.20)
    va = Strings(tr, 'va', 'va', 7, 0.18, 0.20, 0.21)
    vc = Strings(tr, 'vc', 'vc', 6, 0.48, 0.20, 0.25)
    cb = Strings(tr, 'cb', 'cb', 5, 0.66, 0.16, 0.30)
    hn = Winds(tr, 'hn', 'horn', 4, -0.20, 0.16, 0.36)
    tb = Winds(tr, 'tb', 'tbn', 3, 0.40, 0.12, 0.38)
    tu = Winds(tr, 'tuba', 'tuba', 1, 0.52, 0.0, 0.30)
    tp = Winds(tr, 'tp', 'tpt', 3, 0.15, 0.10, 0.30)
    chB = Choir(tr, 'chB', 'B', 9, 0.50, 0.22, 0.20)
    chT = Choir(tr, 'chT', 'T', 9, 0.17, 0.22, 0.20)
    chA = Choir(tr, 'chA', 'A', 9, -0.17, 0.22, 0.20)
    chS = Choir(tr, 'chS', 'S', 9, -0.50, 0.22, 0.20)
    choir = (chB, chT, chA, chS)
    org = Organ(tr, 'organ', 0.0, 0.42, 0.20)
    pc = Perc(tr)
    lines = (LAST_B, LAST_T, LAST_A, LAST_S)

    def knocks(bar, v, pitch='F2'):
        for k in range(3):
            pc.gc(B(bar, 1 + k), v * (1.0, 0.86, 0.93)[k])
            pc.timp(B(bar, 1 + k), pitch, v * 0.85)

    # written dynamics
    for part in choir:
        part.dynamics([(1, 1, .34), (4, 1, .44), (5, 1, .40), (8, 1, .52), (9, 1, .48), (10, 3, .66), (11, 3, .62),
                       (12, 4, .40), (15, 1, .56), (17, 1, .68), (18, 4, .58), (19, 1, .66), (20, 4, .86),
                       (21, 1, .88), (24, 4, .92), (25, 1, .96), (28, 4, 1.04), (29, 1, 1.08), (30, 4, 1.12),
                       (33, 1, .40), (34, 1, .40), (35, 3, .34), (37, 1, .10)])
    org.dynamics([(1, 1, .55), (4, 1, .70), (5, 1, .62), (12, 4, .66), (13, 1, .55), (20, 4, .80), (21, 1, 1.0),
                  (30, 4, 1.1), (31, 1, .62), (36, 1, .58), (40, 1, .50), (42, 1, .36), (43, 1, 0.0)])
    cb.dynamics([(1, 1, .34), (5, 1, .38), (12, 4, .44), (13, 1, .50), (20, 4, .78), (21, 1, .92), (30, 4, 1.05),
                 (31, 1, .46), (36, 1, .40), (40, 1, .36), (42, 1, .26), (43, 1, 0.0)])
    for s in (v1, v2, va, vc):
        s.dynamics([(9, 1, .34), (12, 4, .40), (13, 1, .46), (15, 1, .52), (17, 1, .64), (18, 4, .56), (19, 1, .62),
                    (20, 4, .84), (21, 1, .88), (25, 1, .95), (28, 4, 1.02), (29, 1, 1.05), (30, 4, 1.1),
                    (31, 1, .34), (37, 1, .2)])
    for s in (hn, tb, tu, tp):
        s.dynamics([(13, 1, .56), (19, 1, .74), (20, 4, .88), (21, 1, .86), (24, 4, .90), (25, 1, .95),
                    (28, 4, 1.02), (29, 1, 1.06), (30, 4, 1.12), (31, 1, .40), (34, 1, .36)])

    # ---- Intro (bars 1-4)
    pc.bell(B(1), 'C4', 0.62)
    pc.gc(B(1), 0.30)
    org.play(B(1), 16.2, 'F1', 1.0, stops='soft')
    cb.play(B(1), 8.3, 'F1', 1.0, div=(0, 2), vib=0.4)
    cb.play(B(1), 4.3, 'F2', 1.0, div=(1, 2), vib=0.4)
    cb.play(B(2), 12.3, 'F2', 1.0, div=(1, 2), vib=0.4)
    cb.play(B(3), 8.3, 'F1', 1.0, div=(0, 2), vib=0.4)
    chB.chord(B(2), 11.6, ['F2', 'C3'], 1.0, vowel=-0.35, shape=[(0, .6), (.6, 1.0), (1, .7)])
    chT.play(B(3), 7.6, 'C3', 0.9, vowel=-0.35, shape=[(0, .6), (.6, 1.0), (1, .7)])
    pc.bell(B(3), 'C4', 0.52)

    # ---- A (bars 5-12): the chorale, choir alone
    for part, ln in zip(choir, lines):
        seq(part, B(5), ln[0] + ' ' + ln[1], v=1.0, leg=True, vowel=-0.08)
    seq(org, B(5), LAST_B[0] + ' ' + LAST_B[1], v=1.0, tp=-12, stops='soft')
    seq(cb, B(5), LAST_B[0] + ' ' + LAST_B[1], v=1.0, tp=-12, leg=True, vib=0.5)
    seq(vc, B(9), LAST_T[1], v=1.0, leg=True)
    seq(va, B(9), LAST_A[1], v=1.0, leg=True)
    for bar, v in ((5, .50), (7, .46), (9, .56), (12, .50)):
        pc.bell(B(bar), 'C4', v)

    # ---- B (bars 13-20)
    def horn_call(bar, root, harm, v):
        """Inverted knock motif in the horns over a chain of major-third-related
        triads (Fm - A - Db / Bbm - D - Gb), then a resolution."""
        knock_motif(hn, B(bar), root, v, hold=3.0, inv=True, art='marc', gate=0.96)
        b = B(bar)
        for d, bass, chord in harm:
            cb.play(b, d, bass, 1.0, leg=True, vib=0.5)
            cb.play(b, d, nn(bass) - 12, 1.0, leg=True, vib=0.4, div=(0, 2))
            org.play(b, d, nn(bass) - 12, 0.9, stops='soft')
            vc.play(b, d, chord[0], 1.0, leg=True)
            va.chord(b, d, chord[1:], 1.0, leg=True)
            b += d
    horn_call(13, 'C4', [(1, 'F2', ['F3', 'Ab3', 'C4']), (1, 'A2', ['E3', 'A3', 'C#4']),
                         (4, 'Db3', ['F3', 'Ab3', 'Db4']), (2, 'C3', ['E3', 'G3', 'C4'])], 1.0)
    hn.play(B(14, 3), 2.0, 'C4', 0.9, leg=True)
    knocks(13, 0.36)
    pc.bell(B(13), 'C4', 0.55)
    # chorale phrase 1 with violins on the melody
    for part, ln in zip(choir, lines):
        seq(part, B(15), ln[0], v=1.0, leg=True, vowel=0.0)
    seq(v1, B(15), LAST_S[0], v=1.0, tp=12, leg=True)
    seq(v2, B(15), LAST_S[0], v=1.0, leg=True)
    seq(va, B(15), LAST_A[0], v=1.0, leg=True)
    seq(vc, B(15), LAST_T[0], v=1.0, leg=True)
    seq(cb, B(15), LAST_B[0], v=1.0, tp=-12, leg=True, vib=0.5)
    seq(org, B(15), LAST_B[0], v=1.0, tp=-12, stops='soft')
    pc.bell(B(15), 'C4', 0.58)
    pc.bell(B(17), 'C4', 0.60)
    # second call, a fourth higher, trombones an octave below, crescendo
    horn_call(19, 'F4', [(1, 'Bb2', ['Bb3', 'Db4', 'F4']), (1, 'D3', ['A3', 'D4', 'F#4']),
                         (4, 'Gb2', ['Bb3', 'Db4', 'Gb4']), (2, 'C3', ['Bb3', 'C4', 'E4'])], 1.0)
    hn.play(B(20, 3), 2.0, 'E4', 1.0, leg=True, shape=CRESC)
    knock_motif(tb, B(19), 'F3', 1.0, hold=3.0, inv=True, art='marc', gate=0.96)
    tb.play(B(20, 3), 2.0, 'E3', 1.0, leg=True, shape=CRESC)
    b = B(19)
    for d, notes in ((1, ['Bb2', 'Bb3', 'Db4', 'F4']), (1, ['D3', 'A3', 'D4', 'F#4']),
                     (4, ['Gb2', 'Bb3', 'Db4', 'Gb4']), (2, ['C3', 'Bb3', 'E4', 'G4'])):
        for part, p in zip(choir, notes):
            part.play(b, d, p, 1.0, leg=True, vowel=0.1)
        b += d
    seq(v1, B(19), 'F5:1 F#5:1 Gb5:4 G5:2', v=1.0, leg=True)
    seq(v2, B(19), 'Db5:1 D5:1 Db5:4 C5:2', v=1.0, leg=True)
    knocks(19, 0.5)
    pc.bell(B(19), 'C4', 0.62)
    pc.timp_roll(B(20, 3), 2.0, 'C3', 0.3, 0.9)
    pc.cym_roll(B(20), 4.0, 0.08, 0.75, ring=2.5)

    # ---- C (bars 21-28): the chorale, tutti
    full = [ln[0] + ' ' + ln[1] for ln in lines]            # bass, tenor, alto, soprano
    for part, ln in zip(choir, full):
        seq(part, B(21), ln, v=1.0, leg=True, vowel=0.28)
    seq(tp, B(21), full[3], v=1.0, art='marc', gate=0.97)
    seq(v1, B(21), full[3], v=1.0, tp=12, leg=True)
    seq(v2, B(21), full[3], v=1.0, leg=True)
    seq(hn, B(21), full[2], v=1.0, art='marc', gate=0.97, div=(0, 2))
    seq(va, B(21), full[2], v=1.0, leg=True)
    seq(hn, B(21), full[1], v=1.0, art='marc', gate=0.97, div=(1, 2))
    seq(tb, B(21), full[1], v=1.0, art='marc', gate=0.97, div=(0, 3))
    seq(tb, B(21), full[1], v=1.0, art='marc', gate=0.97, div=(1, 3))
    seq(vc, B(21), full[1], v=1.0, leg=True)
    seq(tb, B(21), full[0], v=1.0, art='marc', gate=0.97, div=(2, 3))
    seq(tu, B(21), full[0], v=1.0, tp=-12, art='marc', gate=0.97)
    seq(cb, B(21), full[0], v=1.0, tp=-12, art='marc', gate=0.98)
    seq(org, B(21), full[0], v=1.0, tp=-12, stops='full')
    for k in (1, 2, 3):
        seq(org, B(21), full[k], v=0.62 if k < 3 else 0.7, stops='plenum')
    bass = ['F2', 'Db3', 'Db3', 'C3', 'F2', 'Db3', 'Gb2', 'C3']
    for k in range(8):
        bar = 21 + k
        lvl = 0.78 + 0.03 * k
        pc.bell(B(bar), 'C4', 0.80 + 0.02 * k)
        knocks(bar, lvl, bass[k])
    pc.tam(B(21), 0.72)
    pc.crash(B(21), 0.75)
    pc.tam(B(25), 0.80)
    pc.crash(B(26), 0.85)
    pc.timp_roll(B(24, 3), 2.0, 'C3', 0.4, 0.9)
    pc.timp_roll(B(28, 3), 2.0, 'C3', 0.5, 1.0)
    pc.cym_roll(B(28), 4.0, 0.15, 0.95, ring=2.0)

    # ---- bars 29-30: the wall.  F minor, then G-flat major over the F pedal;
    #      low brass hammer the inverted motif (F - D - Gb) twice.
    for bar, chord_hi, ch_notes, st_hi, org_ch in (
            (29, ['Ab4', 'C5', 'F5'], ['F3', 'C4', 'Ab4', 'C5'], ('C6', 'Ab5', ['F4', 'C5'], ['F3', 'C4']),
             ['F3', 'Ab3', 'C4', 'F4']),
            (30, ['Bb4', 'Db5', 'Gb5'], ['Gb3', 'Db4', 'Bb4', 'Db5'], ('Db6', 'Bb5', ['Gb4', 'Db5'], ['Gb3', 'Db4']),
             ['Gb3', 'Bb3', 'Db4', 'Gb4'])):
        b = B(bar)
        d = 4.0 if bar == 29 else 3.6
        tp.chord(b, d, chord_hi, 1.0, art='sfz', shape=FPCRESC)
        knock_motif(hn, b, 'F4', 1.0, hold=d - 3.0, inv=True, art='sfz', gate=0.94)
        knock_motif(tb, b, 'F3', 1.0, hold=d - 3.0, inv=True, art='sfz', gate=0.94)
        for part, p in zip(choir, ch_notes):
            part.play(b, d, p, 1.0, vowel=0.3, art='marc')
        v1.play(b, d, st_hi[0], 1.0, trem=1.0)
        v2.play(b, d, st_hi[1], 1.0, trem=1.0)
        va.chord(b, d, st_hi[2], 1.0, trem=1.0)
        vc.chord(b, d, st_hi[3], 1.0, trem=1.0)
        for p in org_ch:
            org.play(b, d, p, 0.8, stops='tutti')
        for k, vv in enumerate((1.0, 0.9, 0.95)):
            pc.gc(b + k, vv)
            pc.bell(b + k, 'C4', 0.9)
        pc.tam(b, 1.0 if bar == 29 else 0.9)
        pc.crash(b, 0.9)
    tu.play(B(29), 7.6, 'F1', 1.0, art='sfz', shape=FPCRESC)
    cb.play(B(29), 7.6, 'F1', 1.0, art='marc', div=(0, 2))
    cb.play(B(29), 7.6, 'F2', 1.0, art='marc', div=(1, 2))
    org.play(B(29), 7.6, 'F1', 1.0, stops='full')
    pc.timp_roll(B(29), 7.6, 'F2', 0.8, 1.0)
    pc.cym_roll(B(29), 7.6, 0.5, 1.0, ring=3.0)

    # ---- D (bars 31-36): what is left
    pc.bell(B(31), 'C4', 0.55)
    org.play(B(31), 48.2, 'F1', 1.0, stops='soft')
    for bar in (31, 33, 35, 37, 39, 41):
        cb.play(B(bar), 8.3, 'F1', 1.0, div=(0, 2), vib=0.4)
    cb.play(B(31), 4.3, 'F2', 1.0, div=(1, 2), vib=0.4)
    for bar in (32, 34, 36, 38, 40):
        cb.play(B(bar), 8.3, 'F2', 1.0, div=(1, 2), vib=0.4)
    cb.play(B(42), 4.3, 'F2', 1.0, div=(1, 2), vib=0.4)
    knock_motif(hn, B(32), 'C4', 1.0, hold=3.0, inv=True, leg=True, gate=0.98)
    hn.play(B(33, 3), 2.0, 'C4', 0.9, leg=True, shape=DIM)
    pc.bell(B(33), 'C4', 0.45)
    b = B(34)
    for d, notes in ((2, ['Db3', 'Bb3', 'Gb4', 'Db5']), (2, ['Db3', 'Bb3', 'Gb4', 'Bb4']),
                     (2, ['C3', 'C4', 'F4', 'Ab4']), (2, ['C3', 'Bb3', 'E4', 'G4']), (4, ['F2', 'Ab3', 'C4', 'F4'])):
        for part, p in zip(choir, notes):
            part.play(b, d, p, 1.0, leg=True, vowel=-0.3)
        b += d
    pc.bell(B(35), 'C4', 0.40)

    # ---- Coda (bars 37-42): one low note, and he is still knocking
    pc.bell(B(37), 'C4', 0.36)
    knocks(39, 0.30)
    return tr


BUILDERS = {'dread': build_dread, 'wrath': build_wrath, 'last': build_last}


# ----------------------------------------------------------------------------
# driver
# ----------------------------------------------------------------------------
def render(job):
    name, stems = job
    t0 = time.time()
    lines = []
    tr = BUILDERS[name]()
    lines.append('%s  "%s"  %s, %.2f BPM, %d bars' % (tr.name, tr.title, tr.key, tr.bpm, tr.bars))
    lines.append('    score rendered in %.1f s (%d buses)' % (time.time() - t0, len(tr.buses)))
    x = mixdown(tr, stems, lines.append)
    x = master(tr, x, lines.append)
    path = os.path.join(OUT_DIR, tr.name + '.ogg')
    gain = 1.0
    for _ in range(4):
        encode(x * gain, path)
        tp_db = true_peak_db(decode(path))
        if tp_db <= -1.0:
            break
        gain *= 10.0 ** ((-1.25 - tp_db) / 20.0)
    lines.append('    encoded %s: %.1f s, true peak %.2f dBTP, trim %.2f dB, total %.1f s'
                 % (os.path.relpath(path, HERE), x.shape[1] / SR, tp_db, db(gain), time.time() - t0))
    info = dict(name=tr.name, title=tr.title, key=tr.key, bpm=round(tr.bpm, 3), bars=tr.bars, beats_per_bar=tr.bpb,
                seconds=round(x.shape[1] / SR, 2),
                sections=[dict(label=lab, bar=bar, time=round(tr.sec(tr.bt(bar)), 1)) for lab, bar in tr.sections])
    return lines, info


def write_definitions():
    defs = {}
    for key in ('dread', 'wrath', 'last'):
        defs['basiliskra.music.' + key] = {'category': 'music', 'sounds': [
            {'name': 'sounds/basiliskra/music/theme_' + key, 'stream': True, 'volume': 1.0, 'load_on_low_memory': True}]}
    with open(os.path.join(HERE, 'music_definitions.json'), 'w') as fh:
        json.dump(defs, fh, indent=2)
        fh.write('\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', choices=sorted(BUILDERS), action='append', help='render just this track (repeatable)')
    ap.add_argument('--stems', action='store_true', help='print a per-bus level table for balancing')
    ap.add_argument('--serial', action='store_true', help='render one track at a time')
    args = ap.parse_args()
    names = args.only or ['dread', 'wrath', 'last']
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(WORK_DIR, exist_ok=True)
    jobs = [(n, args.stems) for n in names]
    t0 = time.time()
    if args.serial or len(jobs) == 1:
        results = [render(j) for j in jobs]
    else:
        with Pool(len(jobs)) as pool:
            results = pool.map(render, jobs)
    infos = {}
    for lines, info in results:
        print('\n'.join(lines))
        infos[info['name']] = info
    path = os.path.join(WORK_DIR, 'render_info.json')
    old = {}
    if os.path.exists(path):
        with open(path) as fh:
            old = json.load(fh)
    old.update(infos)
    with open(path, 'w') as fh:
        json.dump(old, fh, indent=2)
        fh.write('\n')
    write_definitions()
    print('done in %.1f s' % (time.time() - t0))


if __name__ == '__main__':
    main()
