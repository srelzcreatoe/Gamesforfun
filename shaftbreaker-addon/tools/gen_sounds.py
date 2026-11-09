#!/usr/bin/env python3
"""
gen_sounds.py - procedural sound generator for "The Shaftbreaker" Bedrock add-on.

Every sound is synthesised from scratch with numpy/scipy: shaped noise,
PolyBLEP oscillators, FM and ring modulation, source-filter formant voices,
modal (resonator) synthesis, stick-slip friction models, waveshaping and
convolution with synthetic decaying-noise impulse responses.  No samples or
downloaded material of any kind are used.

Output : RP/sounds/shaftbreaker/<group>/<name>.ogg   (44.1 kHz Vorbis q4)
         RP/sounds/shaftbreaker/sounds_manifest.json
         previews/sound_spectrograms.png              (contact sheet)

Reproducible: every sound has its own RNG seeded from BASE_SEED and a CRC of
its path, so output does not depend on render order or worker count.

Usage:  python3 tools/gen_sounds.py [--only GLOB] [--jobs N] [--no-check] [--no-sheet]
"""
import argparse
import fnmatch
import json
import os
import subprocess
import sys
import time
import zlib

sys.dont_write_bytecode = True

import numpy as np
from scipy import signal
from scipy.interpolate import CubicSpline
from scipy.signal import fftconvolve

SR = 44100
TAU = 2 * np.pi
BASE_SEED = 20261109
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP_DIR = os.path.join(ROOT, 'RP')
OUT_DIR = os.path.join(RP_DIR, 'sounds', 'shaftbreaker')
SHEET = os.path.join(ROOT, 'previews', 'sound_spectrograms.png')
FFMPEG = '/usr/bin/ffmpeg'
FFPROBE = '/usr/bin/ffprobe'


# =============================================================================
#  DSP primitives
# =============================================================================
def N(d):
    return int(round(d * SR))


def tt(n):
    return np.arange(n) / SR


def fa(n, v):
    """Broadcast scalar-or-array to a float array of length n."""
    if np.ndim(v) == 0:
        return np.full(n, float(v))
    return np.asarray(v, float)


def wn(r, n):
    return r.standard_normal(n)


def norm(x, peak=1.0):
    m = np.max(np.abs(x)) if len(x) else 0.0
    return x * (peak / m) if m > 1e-12 else x


def sat(x, drive=2.0):
    return np.tanh(drive * x) / np.tanh(drive)


def pad_to(x, n):
    if len(x) >= n:
        return x[:n]
    pad = [(0, n - len(x))] + [(0, 0)] * (x.ndim - 1)
    return np.pad(x, pad)


def place(dst, src, t, g=1.0, wrap=False):
    """Mix src into dst starting at time t (seconds). wrap=True -> circular."""
    i0 = int(round(t * SR))
    n, m = len(dst), len(src)
    if wrap:
        pos, start = 0, i0 % n
        while pos < m:
            take = min(n - start, m - pos)
            dst[start:start + take] += g * src[pos:pos + take]
            pos += take
            start = 0
        return dst
    a, b = max(i0, 0), min(i0 + m, n)
    if b > a:
        dst[a:b] += g * src[a - i0:b - i0]
    return dst


def curve(n, pts, mode='lin'):
    """Breakpoint envelope: pts = [(time_s, value), ...]; mode 'log' interpolates exponentially."""
    pts = sorted(pts, key=lambda p: p[0])
    ts = np.array([p[0] for p in pts], float) * SR
    vs = np.array([p[1] for p in pts], float)
    x = np.arange(n)
    if mode == 'log':
        return np.exp(np.interp(x, ts, np.log(np.maximum(vs, 1e-9))))
    return np.interp(x, ts, vs)


def rlfo(n, rate, r):
    """Smooth random LFO (cubic spline through random points), roughly in [-1, 1]."""
    k = max(int(np.ceil(n / SR * rate)) + 3, 4)
    xs = np.linspace(0, n - 1, k)
    return np.clip(CubicSpline(xs, r.uniform(-1, 1, k))(np.arange(n)), -1.5, 1.5)


def _sos(kind, f, order):
    nyq = SR / 2
    if kind in ('low', 'high'):
        f = min(max(f, 5.0), nyq * 0.95)
    else:
        f = [max(f[0], 5.0), min(f[1], nyq * 0.95)]
    return signal.butter(order, f, btype=kind, fs=SR, output='sos')


def lp(x, f, order=2):
    return signal.sosfilt(_sos('low', f, order), x, axis=0)


def hp(x, f, order=2):
    return signal.sosfilt(_sos('high', f, order), x, axis=0)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos('band', (lo, hi), order), x, axis=0)


def _rbj(kind, f, q):
    f = np.clip(f, 10.0, SR * 0.45)
    q = np.clip(q, 0.1, 400.0)
    w0 = TAU * f / SR
    cw, sw = np.cos(w0), np.sin(w0)
    al = sw / (2 * q)
    a0 = 1 + al
    a1, a2 = -2 * cw / a0, (1 - al) / a0
    if kind == 'bp':        # constant 0 dB peak gain
        b0, b1, b2 = al / a0, 0.0 * al, -al / a0
    elif kind == 'lp':
        b0 = (1 - cw) / 2 / a0
        b1, b2 = (1 - cw) / a0, b0
    else:                   # hp
        b0 = (1 + cw) / 2 / a0
        b1, b2 = -(1 + cw) / a0, b0
    return b0, b1, b2, a1, a2


def reson(x, f, q):
    b0, b1, b2, a1, a2 = _rbj('bp', f, q)
    return signal.lfilter([b0, b1, b2], [1.0, a1, a2], x)


def tvf(x, fc, q, kind='bp', block=64):
    """Time-varying RBJ biquad (coefficients updated every `block` samples, state carried)."""
    x = np.asarray(x, float)
    n = len(x)
    fc, q = fa(n, fc), fa(n, q)
    idx = np.arange(0, n, block)
    mid = np.minimum(idx + block // 2, n - 1)
    b0, b1, b2, a1, a2 = _rbj(kind, fc[mid], q[mid])
    b1 = np.broadcast_to(b1, b0.shape)
    y = np.empty(n)
    zi = np.zeros(2)
    lf = signal.lfilter
    for k, i in enumerate(idx):
        j = min(i + block, n)
        y[i:j], zi = lf([b0[k], b1[k], b2[k]], [1.0, a1[k], a2[k]], x[i:j], zi=zi)
    return y


def resbank(x, freqs, qs, gains):
    y = np.zeros(len(x))
    for f, q, g in zip(freqs, qs, gains):
        if f < SR * 0.45:
            y += g * reson(x, f, q)
    return y


def pink(r, n):
    X = np.fft.rfft(r.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    x = np.fft.irfft(X / np.sqrt(f), n)
    return x / (np.std(x) + 1e-12)


def brown(r, n):
    X = np.fft.rfft(r.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    x = hp(np.fft.irfft(X / f, n), 15.0, 2)
    return x / (np.std(x) + 1e-12)


def saw(f, r=None):
    """PolyBLEP band-limited sawtooth from an instantaneous-frequency array."""
    f = np.asarray(f, float)
    dt = np.clip(f / SR, 1e-7, 0.49)
    p0 = r.random() if r is not None else 0.0
    p = (p0 + np.cumsum(dt)) % 1.0
    y = 2 * p - 1
    m = p < dt
    x = p[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = p > 1 - dt
    x = (p[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def sine(f, ph0=0.0):
    return np.sin(TAU * np.cumsum(np.asarray(f, float)) / SR + ph0)


def fm_osc(fc, ratio, index):
    fc = np.asarray(fc, float)
    return np.sin(TAU * np.cumsum(fc) / SR + index * np.sin(TAU * np.cumsum(fc * ratio) / SR))


def impulse_train(n, rate, r, jitter=0.2, amp_var=0.5):
    """Irregular impulse train (stick-slip events, glottal fry, crackle...)."""
    rate = fa(n, rate)
    out = np.zeros(n)
    pos = r.uniform(0, SR / max(rate[0], 0.1))
    while pos < n:
        i = int(pos)
        out[i] += 1.0 - amp_var * r.random()
        pos += SR / max(rate[i], 0.05) * (1 + jitter * (2 * r.random() - 1))
    return out


def rattle_env(n, rate, r, decay=0.01, jitter=0.35):
    imp = impulse_train(n, rate, r, jitter, 0.6)
    k = np.exp(-tt(max(N(decay * 6), 2)) / decay)
    e = fftconvolve(imp, k)[:n]
    return e / (np.max(e) + 1e-9)


def crackle(r, n, rate, lo=1500, hi=7000, jitter=0.9, grain=0.0005):
    imp = impulse_train(n, rate, r, jitter, 0.9) * np.sign(r.standard_normal(n))
    y = fftconvolve(imp, np.exp(-tt(max(N(grain * 5), 2)) / grain))[:n]
    return bp(y, lo, hi, 2)


def modal(n, freqs, decays, amps, r, attack=0.00025):
    t = tt(n)
    y = np.zeros(n)
    for f, d, a in zip(freqs, decays, amps):
        if f < SR * 0.45:
            y += a * np.sin(TAU * f * t + r.uniform(0, TAU)) * np.exp(-t / d)
    return y * (1 - np.exp(-t / attack))


def make_ir(r, t60=1.2, bright=7000.0, dark=1500.0, predelay=0.01, n_er=8,
            er_span=0.06, er_gain=1.0, length=None):
    """Synthetic room/cave IR: exponentially decaying noise that darkens over time + early reflections."""
    L = length or min(t60 * 1.15 + predelay, 7.0)
    n = N(L)
    t = tt(n)
    nz = r.standard_normal(n)
    b, d = lp(nz, bright, 2), lp(nz, dark, 2)
    w = np.clip(t / (0.6 * t60), 0, 1)
    ir = (b * (1 - w) + 1.4 * d * w) * 10 ** (-3 * t / t60)
    ir *= 1 - np.exp(-t / 0.008)
    pd = N(predelay)
    ir = np.concatenate([np.zeros(pd), ir])[:n]
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-12
    if n_er:
        er = np.zeros(n)
        for _ in range(n_er):
            ti = predelay + r.uniform(0.003, er_span)
            i = N(ti)
            if i < n:
                er[i] += r.choice([-1.0, 1.0]) * r.uniform(0.4, 1.0) * np.exp(-ti / (er_span * 1.5))
        er = lp(er, bright * 0.7, 2)
        ref = np.max(np.abs(ir[:N(predelay + 0.06)])) + 1e-9
        ir += er_gain * 2.0 * ref * norm(er)
        ir /= np.sqrt(np.sum(ir ** 2))
    return ir


def reverb(x, ir, wet=0.3, dry=1.0):
    return dry * x + wet * fftconvolve(x, ir)[:len(x)]


def echo(x, delay, gain, lpf=2000.0):
    y = x.copy()
    d = N(delay)
    if d < len(x):
        y[d:] += gain * lp(x, lpf)[:len(x) - d]
    return y


def cconv(x, ir):
    """Circular convolution (for seamless loops)."""
    n = len(x)
    if len(ir) > n:
        ir = np.sum(pad_to(ir, int(np.ceil(len(ir) / n)) * n).reshape(-1, n), axis=0)
    return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(ir, n), n)


def creverb_st(x2, irL, irR, wet=0.3):
    """Stereo circular reverb with slight cross-feed."""
    L = cconv(0.75 * x2[:, 0] + 0.25 * x2[:, 1], irL)
    R = cconv(0.75 * x2[:, 1] + 0.25 * x2[:, 0], irR)
    return x2 + wet * np.stack([L, R], 1)


def reverb_st(x2, irL, irR, wet=0.3):
    n = len(x2)
    L = fftconvolve(0.75 * x2[:, 0] + 0.25 * x2[:, 1], irL)[:n]
    R = fftconvolve(0.75 * x2[:, 1] + 0.25 * x2[:, 0], irR)[:n]
    return x2 + wet * np.stack([L, R], 1)


def circ_hp(x, fc=20.0):
    """Zero-phase circular high-pass (DC removal that preserves loop continuity)."""
    n = len(x)
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(n, 1 / SR)
    H = f ** 4 / (f ** 4 + fc ** 4)
    H[0] = 0.0
    if X.ndim == 2:
        H = H[:, None]
    return np.fft.irfft(X * H, n, axis=0)


def pan(x, p):
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def mtof(m):
    return 440.0 * 2 ** ((np.asarray(m, float) - 69) / 12)


# =============================================================================
#  Voice (source-filter) synthesis
# =============================================================================
# formant tables: centre freqs, bandwidths, gains (dB)  (classic singer tables)
VOW = {
    'a':  ([650, 1080, 2650, 2900, 3250], [80, 90, 120, 130, 140], [0, -6, -7, -8, -22]),
    'e':  ([400, 1700, 2600, 3200, 3580], [70, 80, 100, 120, 120], [0, -14, -12, -14, -20]),
    'i':  ([290, 1870, 2800, 3250, 3540], [40, 90, 100, 120, 120], [0, -15, -18, -20, -30]),
    'o':  ([400, 800, 2600, 2800, 3000], [40, 80, 100, 120, 120], [0, -10, -12, -12, -26]),
    'u':  ([350, 600, 2700, 2900, 3300], [40, 60, 100, 120, 120], [0, -20, -17, -14, -26]),
    'ae': ([800, 1150, 2900, 3900, 4950], [80, 90, 120, 130, 140], [0, -6, -22, -16, -36]),
    'ee': ([270, 2140, 2950, 3900, 4950], [60, 90, 100, 120, 120], [0, -12, -20, -22, -34]),
    'aw': ([600, 1040, 2250, 2450, 2750], [60, 70, 110, 120, 130], [0, -7, -9, -9, -20]),
    'oo': ([350, 600, 2400, 2675, 2950], [40, 80, 100, 120, 120], [0, -20, -32, -28, -36]),
}


def formant(x, track, scale=1.0, bw=1.0, nf=5, block=64):
    """Parallel time-varying formant filter bank. track = [(time, vowel), ...]."""
    n = len(x)
    track = sorted(track, key=lambda p: p[0])
    ts = [p[0] for p in track]
    vs = [p[1] for p in track]
    sc = fa(n, scale)
    y = np.zeros(n)
    for k in range(nf):
        f = curve(n, list(zip(ts, [VOW[v][0][k] for v in vs])), 'log') * sc
        b = curve(n, list(zip(ts, [VOW[v][1][k] for v in vs]))) * bw * np.sqrt(sc)
        g = curve(n, list(zip(ts, [10 ** (VOW[v][2][k] / 20) for v in vs])))
        y += g * tvf(x, f, np.clip(f / b, 0.4, 80), 'bp', block)
    return y


def vocal(r, f0, track, scale=1.0, bw=1.0, rough=None, sub=0.0, breath=0.1,
          jitter=0.01, shimmer=0.08, nf=5):
    """Glottal saw source (jitter, shimmer, period-doubling subharmonics,
    roughness AM in the 30-150 Hz 'alarm' range) through formants."""
    n = len(f0)
    f = f0 * (1 + jitter * rlfo(n, 30, r))
    src = saw(f, r)
    cyc = np.cumsum(f) / SR
    if np.any(np.asarray(sub) > 0):
        src = src * (1 + np.asarray(sub) * np.sin(np.pi * cyc + r.uniform(0, TAU)))
    if rough:
        rr, rd = rough
        src = src * (1 + rd * np.sin(TAU * np.cumsum(rr * (1 + 0.25 * rlfo(n, 3, r))) / SR))
    src = src * (1 + shimmer * rlfo(n, 25, r))
    src = norm(src) + breath * norm(r.standard_normal(n))
    return formant(src, track, scale, bw, nf)


# =============================================================================
#  Shared building blocks
# =============================================================================
def thud(r, dur, f_hi, f_lo, drop=0.04, decay=0.12, body=0.5, band=(150, 500), drive=1.6, harm=0.55):
    """Pitch-dropping sine thump (40-90 Hz energy) + band-limited body noise (phone audibility)."""
    n = N(dur)
    t = tt(n)
    f = f_lo + (f_hi - f_lo) * np.exp(-t / drop)
    s = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / decay) * (1 - np.exp(-t / 0.0012))
    b = bp(wn(r, n), band[0], band[1], 2) * np.exp(-t / (decay * 0.35)) * (1 - np.exp(-t / 0.0008))
    h = presence(s)
    return sat(norm(norm(s) + body * norm(b) + harm * norm(h)), drive)


def presence(s, lo=140, hi=700):
    """Harmonic exciter: rectified + clipped copy of a sub signal, band-passed to 140-700 Hz so
    low thumps keep their pitch/punch on small phone speakers."""
    return bp(np.abs(s) + 0.6 * np.tanh(5 * s), lo, hi, 2)


def bubble(r, f0, dur, rise=None, decay=None):
    """Rising-pitch bubble resonance (Minnaert-style)."""
    n = N(dur)
    t = tt(n)
    rise = r.uniform(1.0, 2.5) if rise is None else rise
    f = f0 * (1 + rise * t / dur)
    dec = dur * 0.3 if decay is None else decay
    return np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / dec) * (1 - np.exp(-t / 0.0015))


def pebble(r, fmin=1500, fmax=6500, dmin=0.002, dmax=0.012):
    f = r.uniform(fmin, fmax)
    d = r.uniform(dmin, dmax)
    n = N(d * 6 + 0.003)
    y = modal(n, [f, f * r.uniform(1.5, 2.8), f * r.uniform(3.1, 4.6)], [d, d * 0.6, d * 0.35],
              [1, 0.5, 0.25], r)
    tick = hp(wn(r, n), 1500, 2) * np.exp(-tt(n) / 0.0005)
    return y + 0.35 * tick


def debris(r, n, t0, count, tau, fmin=1200, fmax=6500, bounce=0.3, dmax=0.012):
    y = np.zeros(n)
    for _ in range(int(count)):
        dt = r.exponential(tau)
        t = t0 + dt
        a = r.uniform(0.15, 1.0) * np.exp(-dt / (tau * 2.5))
        place(y, pebble(r, fmin, fmax, dmax=dmax), t, a)
        if r.random() < bounce:
            gap, aa = r.uniform(0.04, 0.12), a
            for _k in range(int(r.integers(2, 5))):
                t += gap
                gap *= r.uniform(0.55, 0.8)
                aa *= r.uniform(0.4, 0.7)
                place(y, pebble(r, fmin, fmax, dmax=dmax), t, aa)
    return y


def grit(r, n, t0, count, tau, lo, hi, gmin=0.001, gmax=0.004):
    y = np.zeros(n)
    for _ in range(int(count)):
        dt = r.exponential(tau)
        m = max(N(r.uniform(gmin, gmax)), 8)
        place(y, wn(r, m) * np.hanning(m) * r.uniform(0.2, 1.0) * np.exp(-dt / (tau * 3)), t0 + dt)
    return bp(y, lo, hi, 2)


def bone_click(r, bright=1.0, body=0.5):
    f = r.uniform(1500, 2500) * bright
    m = N(0.06)
    y = modal(m, [f, f * r.uniform(1.6, 2.0), f * r.uniform(2.8, 3.4), f * r.uniform(4.3, 5.2)],
              [0.012, 0.008, 0.005, 0.003], [1, 0.7, 0.5, 0.3], r)
    y += body * modal(m, [r.uniform(320, 600)], [0.01], [1], r)
    y += 0.5 * hp(wn(r, m), 3000) * np.exp(-tt(m) / 0.0008)
    return y


def scrape_layer(r, dur, f_lo=500, f_hi=1400, grind_rate=(50, 90), screech=0.7, grind=0.4, low=0.25):
    """Claw on rock: coherent stick-slip impulses at audio rate ringing high-Q resonant partials,
    an intermittent mode-locked squeal (2-3.5 kHz, the most grating region) and a granular grind."""
    m = N(dur)
    d = dur
    env = curve(m, [(0, 0), (min(0.06, d * 0.2), 1), (d * 0.5, r.uniform(0.6, 1)),
                    (d * 0.85, r.uniform(0.5, 0.9)), (d, 0)])
    env *= np.clip(0.75 + 0.35 * rlfo(m, 11, r), 0.15, 1.3)
    fss = curve(m, [(0, f_lo * r.uniform(0.9, 1.1)), (d * 0.4, f_hi * r.uniform(0.85, 1.1)),
                    (d, (f_lo + f_hi) / 2 * r.uniform(0.8, 1.1))], 'log') * (1 + 0.04 * rlfo(m, 7, r))
    imp = impulse_train(m, fss, r, jitter=0.05, amp_var=0.35)
    res = [r.uniform(1100, 1500), r.uniform(2300, 2900), r.uniform(3500, 4300), r.uniform(5200, 6400)]
    sc = resbank(imp, res, [40, 55, 70, 80], [1, 1.0, 0.7, 0.4])
    dr = tvf(imp, res[1] * (1 + 0.08 * rlfo(m, 3, r)), 60)
    fq = r.uniform(1800, 3200) * (1 + 0.03 * rlfo(m, 9, r) + 0.06 * rlfo(m, 1.5, r))
    sq = bp(saw(fq, r), 1500, 9000, 2) * np.clip(2.2 * rlfo(m, 6, r) + 0.4, 0, 1)
    sc = sat(norm(norm(sc) + 0.6 * norm(dr) + 0.5 * norm(sq)), 2.0)
    ge = rattle_env(m, curve(m, [(0, grind_rate[0]), (d, grind_rate[1])]), r, decay=0.004)
    gr = sat(norm(bp(wn(r, m), 300, 3500) * (0.25 + ge)), 2.5)
    lo = lp(wn(r, m), 250) * (0.5 + 0.5 * ge)
    return env * (screech * norm(sc) + grind * gr + low * norm(lo))


def creak(r, dur, rate_pts, freqs, qs=(18, 22, 25, 25)):
    m = N(dur)
    imp = impulse_train(m, curve(m, rate_pts, 'log'), r, 0.3, 0.5)
    y = resbank(imp, freqs, qs, [1, 0.8, 0.5, 0.3][:len(freqs)])
    return norm(y) * curve(m, [(0, 0), (min(0.05, dur * 0.2), 1), (dur * 0.8, 0.8), (dur, 0)])


def scream_core(r, dur, a=1.0):
    """The Shaftbreaker's voice: two dissonant distorted formant voices sliding up,
    FM shriek, growl undertone and ring-modulated grit."""
    n = N(dur)
    tu = r.uniform(0.22, 0.38)
    tpk = max(dur * 0.72, tu + 0.45)
    f0 = curve(n, [(0, 150 * a), (tu, 500 * a), (tu + 0.25, 560 * a), (tpk, 730 * a * r.uniform(0.95, 1.1)),
                   (dur - 0.12, 450 * a), (dur, 300 * a)], 'log')
    # abrupt register breaks (non-linear vocal phenomena): short jumps by a 4th/5th/tritone
    brk = np.ones(n)
    for _ in range(int(r.integers(2, 4))):
        tb = r.uniform(tu + 0.1, max(tu + 0.15, dur - 0.35))
        brk[N(tb):N(tb + r.uniform(0.07, 0.16))] *= r.choice([1.33, 1.5, 1.41, 0.75])
    f0 = f0 * (1 + lp(brk - 1, 80, 1))
    vd = curve(n, [(0, 0), (tu, 0.012), (dur, 0.045)])
    vr = r.uniform(6.5, 9.0) * (1 + 0.3 * rlfo(n, 2, r))
    f0 = f0 * (1 + vd * np.sin(TAU * np.cumsum(vr) / SR)) * (1 + 0.025 * rlfo(n, 14, r))
    trk = [(0, 'o'), (tu, 'a'), (dur * 0.6, 'e'), (dur, 'a')]
    v1 = vocal(r, f0, trk, scale=0.82, bw=1.8, rough=(r.uniform(55, 85), 0.55), sub=0.5, breath=0.2, jitter=0.015)
    v2 = vocal(r, f0 * r.uniform(1.39, 1.44), trk, scale=1.22, bw=2.2, rough=(r.uniform(35, 60), 0.4),
               sub=0.25, breath=0.1)
    voc = sat(norm(v1) + 0.6 * norm(v2), r.uniform(4, 6))
    # FM shriek (inharmonic ratio ~ sqrt 2)
    idx = curve(n, [(0, 0.3), (tu, 3.0), (dur * 0.7, 4.0), (dur, 1.0)])
    sh = bp(fm_osc(f0 * r.uniform(4.6, 5.4), r.uniform(1.37, 1.46), idx), 1500, 9500, 2)
    sh = lp(sh, 10000, 2)
    sh_env = curve(n, [(0, 0), (tu * 0.5, 0.0), (tu + 0.08, 1), (dur - 0.25, 0.85), (dur, 0)])
    # growl undertone
    g0 = r.uniform(52, 66) * (1 + 0.05 * rlfo(n, 5, r))
    gs = saw(g0, r) * (1 + 0.8 * np.sin(np.pi * np.cumsum(g0) / SR))
    gs *= 0.4 + rattle_env(n, r.uniform(24, 32), r, 0.01)
    growl = sat(norm(formant(gs, [(0, 'oo')], 0.6, 1.5) + 0.7 * lp(gs, 160)), 3)
    g_env = curve(n, [(0, 0.6), (0.1, 1), (dur - 0.3, 0.8), (dur, 0)])
    # ring-mod grit
    rm = voc * sine(r.uniform(1100, 1700) * (1 + 0.15 * rlfo(n, 3, r)))
    env = curve(n, [(0, 0), (0.025, 0.75), (tu, 1.0), (dur - 0.2, 0.9), (dur, 0)])
    y = env * (voc + 0.3 * norm(rm)) + 0.35 * sh_env * norm(sh) + 0.45 * g_env * growl
    # hiss of breath right before the scream opens
    m = N(0.12)
    place(y, bp(wn(r, m), 900, 6000) * curve(m, [(0, 0), (0.01, 1), (0.12, 0)]), 0.0, 0.35)
    y = sat(norm(y), 1.6)
    return y + 0.25 * bp(y, 2000, 4500)


def breath_phase(r, dur, kind, rasp=0.5, wet=0.5, voice=0.1):
    n = N(dur)
    src = 0.7 * wn(r, n) + 0.5 * pink(r, n)
    if kind == 'in':
        trk = [(0, 'oo'), (dur * 0.6, 'e'), (dur, 'ee')]
        sc = 1.05
        env = curve(n, [(0, 0), (dur * 0.45, 1), (dur * 0.8, 0.8), (dur, 0)])
        hiss = hp(src, 2500)
    else:
        trk = [(0, 'a'), (dur * 0.5, 'aw'), (dur, 'o')]
        sc = 0.9
        env = curve(n, [(0, 0), (dur * 0.12, 1), (dur * 0.5, 0.7), (dur, 0)])
        hiss = hp(src, 1500)
    env = env ** 1.3
    br = norm(formant(src, trk, scale=sc, bw=3.5)) + 0.35 * norm(hiss)
    fl = rattle_env(n, r.uniform(25, 50) * (1 + 0.3 * rlfo(n, 3, r)), r, decay=0.006)
    br = br * (1 - rasp + rasp * 1.8 * fl)
    if voice > 0:
        f0 = r.uniform(65, 90) * (1 + 0.05 * rlfo(n, 4, r))
        vv = vocal(r, f0, trk, scale=sc * 0.8, bw=2.0, rough=(30, 0.6), sub=0.6, breath=0.0)
        br = norm(br) + voice * norm(vv)
    cr = np.zeros(n)
    for _ in range(int(dur * r.uniform(8, 25) * wet)):
        f = r.uniform(1800, 6000)
        place(cr, modal(N(0.02), [f, f * 1.7], [0.002, 0.0012], [1, 0.5], r), r.uniform(0, dur), r.uniform(0.2, 1.0))
    y = env * norm(br)
    if wet > 0:
        y = y + 0.25 * wet * norm(cr) * env ** 0.5
    return hp(y, 120)


def organ_throb(r, dur=0.95, k=1.0):
    """Wet low organic throb: soft-attack sub thump + resonant squish + bubbles."""
    n = N(dur)
    t = tt(n)
    f = (40 + 25 * np.exp(-t / 0.08)) * k
    env = curve(n, [(0, 0), (0.04, 1), (0.25, 0.6), (dur, 0)]) ** 1.5
    s = np.sin(TAU * np.cumsum(f) / SR) * env
    fc = curve(n, [(0, 900 * k), (0.15, 380 * k), (dur, 220 * k)], 'log')
    senv = curve(n, [(0, 0), (0.03, 1), (0.3, 0.3), (dur, 0)])
    sq = (tvf(wn(r, n), fc, 5) + 0.5 * tvf(wn(r, n), fc * 1.9, 7)) * senv
    body = bp(wn(r, n), 120, 500) * senv
    y = norm(s) + 0.4 * norm(sq) + 0.25 * norm(body) + 0.8 * norm(presence(s))
    for _ in range(int(r.integers(1, 4))):
        place(y, bubble(r, r.uniform(200, 500), r.uniform(0.03, 0.06)), r.uniform(0.05, dur * 0.6), r.uniform(0.08, 0.2))
    return sat(norm(y), 2.2)


def squelch(r, dur, f_start, f_end, q=6.0):
    m = N(dur)
    fc = curve(m, [(0, f_start), (dur, f_end)], 'log')
    y = tvf(wn(r, m), fc, q) + 0.6 * tvf(wn(r, m), fc * r.uniform(1.6, 2.2), q * 1.3)
    return norm(y) * curve(m, [(0, 0), (min(0.008, dur * 0.1), 1), (dur * 0.35, 0.5), (dur, 0)])


def glass_tone(r, dur, f):
    n = N(dur)
    ff = f * (1 + 0.003 * np.sin(TAU * r.uniform(0.2, 0.5) * tt(n) + r.uniform(0, TAU)))
    y = fm_osc(ff, r.uniform(2.0, 3.1), 0.5 + 0.3 * rlfo(n, 0.5, r))
    y += 0.5 * fm_osc(ff * 2 ** (r.choice([1, 6, 11]) / 12), 1.41, 0.4)
    return lp(y, 3500) * curve(n, [(0, 0), (dur * 0.4, 1), (dur * 0.6, 0.8), (dur, 0)]) ** 2


def groan(r, dur, f_hi=78, f_lo=48):
    n = N(dur)
    f0 = curve(n, [(0, f_hi * r.uniform(0.9, 1.1)), (dur * 0.3, f_hi * 1.05), (dur, f_lo)], 'log') * (1 + 0.03 * rlfo(n, 5, r))
    y = vocal(r, f0, [(0, 'o'), (dur * 0.5, 'aw'), (dur, 'oo')], 0.6, 1.5, rough=(r.uniform(20, 35), 0.6), sub=0.6, breath=0.3)
    y = lp(sat(norm(y), 2), 700)
    return y * curve(n, [(0, 0), (dur * 0.3, 1), (dur * 0.7, 0.8), (dur, 0)])


# =============================================================================
#  MOB sounds
# =============================================================================
def s_step(r, dur):
    n = N(dur)
    y = np.zeros(n)
    t0 = 0.004
    k = r.uniform(0.9, 1.12)
    place(y, thud(r, 0.35, 125 * k, 46 * k, drop=0.03, decay=r.uniform(0.08, 0.12), body=0.6,
                  band=(170 * k, 520 * k), drive=2.0, harm=0.95), t0)
    m = modal(N(0.15), [r.uniform(260, 340) * k, r.uniform(560, 720) * k, r.uniform(980, 1250) * k, r.uniform(1700, 2100) * k],
              [0.035, 0.022, 0.014, 0.008], [1, 0.7, 0.45, 0.3], r)
    place(y, m, t0, 0.35)
    y += 0.4 * norm(grit(r, n, t0, r.integers(30, 55), r.uniform(0.018, 0.03), 900, 7000))
    cm = N(0.12)
    place(y, sat(norm(bp(wn(r, cm), 600, 4000) * np.exp(-tt(cm) / 0.018)), 2), t0, 0.3)
    for _ in range(int(r.integers(1, 3))):
        f = r.uniform(2600, 4200)
        c = modal(N(0.05), [f, f * r.uniform(1.6, 2.1), f * r.uniform(2.7, 3.3)], [0.008, 0.005, 0.003], [1, .5, .3], r)
        place(y, c, t0 + r.uniform(0.035, 0.11), r.uniform(0.12, 0.22))
    y = sat(norm(y), 1.3)
    return reverb(y, make_ir(r, 0.45, 6000, 1500), 0.2)


def s_step_wet(r, dur):
    n = N(dur)
    y = np.zeros(n)
    t0 = 0.004
    place(y, thud(r, 0.3, 100, 42, 0.035, 0.09, 0.5, (140, 420), 1.5), t0, 0.8)
    place(y, squelch(r, 0.25, r.uniform(1500, 2200), 280, 7), t0, 0.7)
    place(y, squelch(r, 0.18, 300, 1400, 8), r.uniform(0.2, 0.26), 0.35)
    for _ in range(int(r.integers(3, 7))):
        place(y, bubble(r, r.uniform(280, 900), r.uniform(0.02, 0.05)), r.uniform(0.02, 0.38), r.uniform(0.1, 0.3))
    y = sat(norm(y), 1.4)
    return reverb(y, make_ir(r, 0.4, 4000, 1000), 0.15)


def s_scrape(r, dur):
    n = N(dur)
    y = np.zeros(n)
    claws = int(r.integers(2, 4))
    for c in range(claws):
        off = c * r.uniform(0.02, 0.07)
        part = scrape_layer(r, dur - off - 0.01, r.uniform(450, 800), r.uniform(900, 1600))
        place(y, part, off, r.uniform(0.7, 1.0) / np.sqrt(claws))
    y = sat(norm(y), 1.5)
    return reverb(y, make_ir(r, 0.8, 7000, 1800), 0.22)


def s_smash(r, dur):
    n = N(dur)
    y = np.zeros(n)
    t0 = 0.003
    k = r.uniform(0.85, 1.15)
    place(y, thud(r, 0.7, 95 * k, 32 * k, 0.05, 0.22, 0.8, (120, 600), 2.5), t0, 1.0)
    m = N(0.04)
    place(y, sat(norm(wn(r, m) * np.exp(-tt(m) / 0.006)), 3), t0, 0.9)
    for _ in range(int(r.integers(3, 7))):
        mm = N(0.012)
        place(y, norm(hp(wn(r, mm), 1800) * np.exp(-tt(mm) / r.uniform(0.0008, 0.0025))), t0 + r.uniform(0, 0.05), r.uniform(0.4, 0.9))
    mm = N(0.3)
    cr = bp(wn(r, mm), 250, 2200) * np.exp(-tt(mm) / 0.06) * (0.6 + 0.8 * rattle_env(mm, 120, r, 0.003))
    place(y, sat(norm(cr), 2), t0, 0.7)
    y += 0.45 * norm(debris(r, n, t0 + 0.03, r.integers(70, 120), r.uniform(0.15, 0.25), 1000, 7000, bounce=0.35))
    rub = lp(wn(r, n), 500) * curve(n, [(0, 0), (t0 + 0.01, 1), (0.5, 0.3), (dur, 0)]) * (0.5 + rattle_env(n, 35, r, 0.01))
    y += 0.3 * norm(rub)
    y = sat(norm(y), 1.6)
    return reverb(y, make_ir(r, 1.3, 6000, 1200), 0.3)


def s_screech(r, dur):
    y = pad_to(scream_core(r, dur - 0.12, r.uniform(0.92, 1.1)), N(dur))
    return reverb(y, make_ir(r, 1.1, 7000, 1800, predelay=0.015), 0.22)


def s_scream_far(r, dur):
    n = N(dur)
    y = np.zeros(n)
    core = scream_core(r, r.uniform(1.5, 1.8), r.uniform(0.85, 1.0))
    core = hp(lp(core, r.uniform(900, 1300), 4), 120)
    place(y, core, 0.05)
    ir = make_ir(r, 2.3, 2500, 650, predelay=0.05, n_er=12, er_span=0.15)
    y = reverb(y, ir, wet=1.0, dry=0.25)
    y = echo(y, r.uniform(0.19, 0.24), 0.3, 900)
    return echo(y, r.uniform(0.43, 0.5), 0.15, 700)


def s_growl(r, dur):
    n = N(dur)
    a = r.uniform(0.9, 1.1)
    f0 = curve(n, [(0, 58 * a), (0.4, 70 * a), (dur * 0.6, 66 * a * r.uniform(.95, 1.05)), (dur, 52 * a)], 'log')
    f0 = f0 * (1 + 0.04 * rlfo(n, 7, r))
    src = saw(f0, r) * (1 + 0.85 * np.sin(np.pi * np.cumsum(f0) / SR))
    rat = rattle_env(n, r.uniform(18, 28) * (1 + 0.2 * rlfo(n, 2, r)), r, decay=r.uniform(0.008, 0.015))
    src = src * (0.35 + rat)
    gr = bp(wn(r, n), 180, 1600) * rat
    voc = formant(norm(src) + 0.5 * norm(gr), [(0, 'oo'), (dur * 0.4, 'o'), (dur * 0.8, 'aw'), (dur, 'oo')],
                  scale=r.uniform(0.5, 0.6), bw=1.6)
    y = 0.9 * norm(voc) + 0.7 * norm(lp(src, 130, 2)) + 0.25 * norm(bp(gr, 600, 2500))
    y = sat(norm(y), 2.8)
    env = curve(n, [(0, 0), (0.35, 1), (dur - 0.45, 0.85), (dur, 0)]) * np.clip(0.8 + 0.25 * rlfo(n, 3, r), 0, 1.2)
    return reverb(y * env, make_ir(r, 0.7, 5000, 1200), 0.2)


def s_breath(r, dur, v=0):
    n = N(dur)
    y = np.zeros(n)
    if v == 0:      # inhale + exhale
        place(y, breath_phase(r, 1.0, 'in', 0.5, 0.4, 0.05), 0.02)
        place(y, breath_phase(r, 1.4, 'out', 0.6, 0.7, 0.15), 1.12, 0.95)
    elif v == 1:    # long wet exhale
        place(y, breath_phase(r, 1.72, 'out', 0.7, 1.0, 0.2), 0.03)
    elif v == 2:    # slow raspy inhale
        place(y, breath_phase(r, 1.52, 'in', 0.6, 0.5, 0.08), 0.03)
    else:           # shaky stuttering inhale then exhale
        tcur = 0.02
        for i in range(3):
            d = r.uniform(0.26, 0.34)
            place(y, breath_phase(r, d, 'in', 0.7, 0.3, 0.05), tcur, 0.7 + 0.15 * i)
            tcur += d + r.uniform(0.04, 0.09)
        place(y, breath_phase(r, 1.45, 'out', 0.75, 0.8, 0.2), tcur + 0.12)
    return reverb(y, make_ir(r, 0.3, 6000, 2000, n_er=4), 0.06)


def s_click(r, dur, v=0):
    n = N(dur)
    y = np.zeros(n)
    if v == 0:      # jaw chattering
        rate = r.uniform(17, 24)
        tcur = 0.02
        count = int(r.integers(10, 15))
        for k in range(count):
            a = np.sin(np.pi * (k + 0.5) / count) ** 0.6 * r.uniform(0.6, 1.0)
            place(y, bone_click(r, r.uniform(1.2, 1.6), 0.3), tcur, a)
            if r.random() < 0.6:
                place(y, bone_click(r, r.uniform(1.1, 1.5), 0.2), tcur + r.uniform(0.003, 0.007), a * 0.5)
            tcur += 1 / rate * r.uniform(0.8, 1.25)
            if tcur > dur - 0.08:
                break
    elif v == 1:    # joint crack + creak + pop
        t0 = 0.03
        for _ in range(int(r.integers(10, 20))):
            place(y, pebble(r, 1500, 7000, 0.001, 0.004), t0 + r.exponential(0.012), r.uniform(0.3, 1.0))
        place(y, bone_click(r, 1.0, 0.8), t0 + 0.005, 1.0)
        cr = creak(r, 0.32, [(0, 22), (0.32, 65)],
                   [r.uniform(320, 420), r.uniform(850, 1050), r.uniform(1600, 1900), r.uniform(2800, 3300)])
        place(y, cr, t0 + 0.09, 0.55)
        place(y, bone_click(r, 1.3, 0.6), t0 + 0.45, 0.8)
    elif v == 2:    # slow deliberate bone taps
        tcur = 0.04
        for _ in range(3):
            place(y, bone_click(r, r.uniform(0.8, 1.1), 0.9), tcur, r.uniform(0.75, 1))
            place(y, bone_click(r, r.uniform(0.9, 1.2), 0.5), tcur + r.uniform(0.02, 0.04), r.uniform(0.3, 0.5))
            tcur += r.uniform(0.3, 0.38)
    else:           # quick double crack with crunch
        for tc in (0.01, 0.01 + r.uniform(0.07, 0.1)):
            place(y, bone_click(r, r.uniform(0.9, 1.3), 1.0), tc, 1.0)
            y += 0.3 * norm(grit(r, n, tc, 25, 0.01, 1500, 7000))
    y = sat(norm(y), 1.4)
    return reverb(y, make_ir(r, 0.4, 6000, 1500), 0.12)


def s_hurt(r, dur):
    n = N(dur)
    a = r.uniform(0.9, 1.15)
    tp = r.uniform(0.06, 0.1)
    f0 = curve(n, [(0, 380 * a), (tp, 820 * a), (dur * 0.45, 700 * a), (dur, 330 * a)], 'log') * (1 + 0.04 * rlfo(n, 18, r))
    trk = [(0, 'a'), (dur * 0.3, 'ae'), (dur, 'e')]
    v1 = vocal(r, f0, trk, 0.9, 1.8, rough=(r.uniform(60, 90), 0.6), sub=0.4, breath=0.25)
    v2 = vocal(r, f0 * r.uniform(1.45, 1.52), trk, 1.2, 2.0, rough=(45, 0.4), sub=0.2, breath=0.1)
    voc = sat(norm(v1) + 0.5 * norm(v2), 5)
    sh = lp(bp(fm_osc(f0 * 4.8, 1.41, curve(n, [(0, 1), (tp, 3.5), (dur, 0.8)])), 1500, 9000), 10000)
    env = curve(n, [(0, 0), (0.012, 1), (tp + 0.1, 0.95), (dur * 0.7, 0.5), (dur - 0.03, 0.1), (dur, 0)])
    y = env * (norm(voc) + 0.3 * norm(sh))
    m = N(0.08)
    place(y, norm(bp(wn(r, m), 1000, 6000) * np.exp(-tt(m) / 0.02)), 0, 0.3)
    return reverb(sat(norm(y), 1.5), make_ir(r, 0.7, 6000, 1500), 0.18)


def s_death(r, dur):
    n = N(dur)
    y = np.zeros(n)
    wd = 2.55
    m = N(wd)
    f0 = curve(m, [(0, 540), (0.22, 700), (0.9, 470), (1.6, 240), (2.2, 120), (wd, 80)], 'log')
    vd = curve(m, [(0, 0.01), (1.0, 0.03), (wd, 0.06)])
    vr = curve(m, [(0, 8), (wd, 4)])
    f0 = f0 * (1 + vd * np.sin(TAU * np.cumsum(vr) / SR)) * (1 + curve(m, [(0, 0.01), (wd, 0.06)]) * rlfo(m, 16, r))
    trk = [(0, 'ae'), (0.5, 'a'), (1.4, 'aw'), (2.0, 'o'), (wd, 'oo')]
    sub = curve(m, [(0, 0.2), (1.2, 0.5), (wd, 0.95)])
    v1 = vocal(r, f0, trk, 0.85, 1.8, rough=(70, 0.55), sub=sub, breath=0.25)
    v2 = vocal(r, f0 * 1.42, trk, 1.15, 2.0, rough=(40, 0.4), sub=0.3, breath=0.1)
    voc = sat(norm(v1) + 0.5 * norm(v2) * curve(m, [(0, 1), (1.5, 0.3), (wd, 0)]), 4.5)
    sh = lp(bp(fm_osc(f0 * 5, 1.41, curve(m, [(0, 1), (0.3, 3.5), (1.2, 1)])), 1500, 9000), 10000)
    sh *= curve(m, [(0, 0), (0.15, 1), (1.1, 0.2), (1.6, 0)])
    garg = formant(wn(r, m) * rattle_env(m, 13, r, 0.02), [(0, 'o')], 0.7, 1.5)
    garg *= curve(m, [(0, 0), (1.5, 0), (2.0, 1), (wd, 0.4)])
    env = curve(m, [(0, 0), (0.03, 0.8), (0.3, 1), (1.6, 0.8), (2.3, 0.5), (wd, 0)])
    place(y, env * (norm(voc) + 0.25 * norm(sh)) + 0.35 * norm(garg), 0, 1.0)
    tc = 2.42
    place(y, thud(r, 0.58, 90, 30, 0.05, 0.3, 0.9, (120, 600), 2.5), tc, 1.1)
    place(y, thud(r, 0.4, 120, 40, 0.03, 0.12, 0.8, (150, 600), 2.0), tc + 0.12, 0.5)
    y += 0.35 * norm(debris(r, n, tc + 0.01, 50, 0.12, 900, 5000, bounce=0.25))
    for _ in range(4):
        place(y, bone_click(r, r.uniform(0.8, 1.2), 0.8), tc + r.uniform(0.01, 0.2), r.uniform(0.2, 0.4))
    y = sat(norm(y), 1.5)
    return reverb(y, make_ir(r, 1.3, 6000, 1100), 0.28)


def whisper_voice(r, dur, start=0.05, scale=1.0):
    n = N(dur)
    vtrack, env, fric = [], np.zeros(n), np.zeros(n)
    tcur = start
    vowels = ['a', 'e', 'i', 'o', 'u', 'ae', 'aw', 'ee']
    while tcur < dur - 0.25:
        sl = r.uniform(0.1, 0.3)
        if r.random() < 0.55:
            fd = r.uniform(0.04, 0.11)
            kind = r.choice(['s', 'sh', 'h', 'k'])
            fm = N(fd)
            nz = wn(r, fm)
            if kind == 's':
                f = bp(nz, 5000, 10000)
            elif kind == 'sh':
                f = bp(nz, 1800, 5500)
            elif kind == 'h':
                f = 0.6 * bp(nz, 600, 3000)
            else:
                f = hp(nz, 2500) * np.exp(-tt(fm) / 0.008)
            f = f * np.hanning(fm) ** 0.5
            place(fric, norm(f), tcur, r.uniform(0.3, 0.8))
            tcur += fd * 0.7
        vtrack += [(tcur, r.choice(vowels)), (tcur + sl, r.choice(vowels))]
        m = N(sl)
        x = np.linspace(0, 1, m)
        w = np.where(x < 0.3, np.sin(np.pi * x / 0.6), np.cos(np.pi * (x - 0.3) / 1.4)) ** 1.2
        place(env, w, tcur, r.uniform(0.5, 1.0))
        tcur += sl + (r.uniform(0.02, 0.09) if r.random() < 0.75 else r.uniform(0.15, 0.35))
    if not vtrack:
        vtrack = [(0, 'a')]
    voc = formant(0.8 * wn(r, n) + 0.4 * pink(r, n), vtrack, scale, bw=r.uniform(2.2, 3.2))
    return norm(voc) * env + 0.6 * norm(fric)


def s_whisper(r, dur, v=0):
    y = whisper_voice(r, dur, 0.05, r.uniform(0.95, 1.08))
    y = norm(y) + 0.45 * norm(whisper_voice(r, dur, r.uniform(0.12, 0.25), r.uniform(1.12, 1.25)))
    if v >= 2:
        y += 0.35 * norm(whisper_voice(r, dur, 0.2, 0.9)[::-1])
    y = lp(hp(y, 300, 2), 9000, 2)
    y *= curve(N(dur), [(0, 1), (dur - 0.2, 1), (dur, 0)])
    return reverb(y, make_ir(r, 0.9, 6000, 2000), 0.3)


def knock_unit(r, k=1.0):
    m = N(0.45)
    base = r.uniform(115, 165) * k
    modes = modal(m, [base, base * r.uniform(1.55, 1.7), base * r.uniform(2.6, 2.85), base * r.uniform(3.9, 4.4),
                      base * r.uniform(6, 7)], [0.13, 0.09, 0.06, 0.035, 0.02], [1, 0.7, 0.5, 0.3, 0.2], r)
    contact = bp(wn(r, m), 700, 3500) * np.exp(-tt(m) / 0.003)
    th = pad_to(thud(r, 0.25, 110, 55, 0.02, 0.05, 0.3, (150, 450), 1.5), m)
    return sat(norm(norm(modes) + 0.5 * norm(contact) + 0.6 * th), 1.4)


def s_knock(r, dur, count=3):
    n = N(dur)
    y = np.zeros(n)
    tcur = 0.02
    k = r.uniform(0.9, 1.1)
    for i in range(count):
        place(y, knock_unit(r, k), tcur, r.uniform(0.8, 1.0))
        tcur += r.uniform(0.2, 0.34)
    y = reverb(y, make_ir(r, 1.4, 4500, 900, predelay=0.02, n_er=10, er_span=0.09), 0.45)
    y = echo(y, r.uniform(0.17, 0.21), 0.3, 1500)
    return echo(y, r.uniform(0.4, 0.45), 0.15, 1000)


def s_vanish(r, dur):
    n = N(dur)
    t = tt(n)
    y = np.zeros(n)
    tp = r.uniform(0.9, 0.98)
    fc = curve(n, [(0, 250), (tp, r.uniform(4500, 7000)), (dur, 7000)], 'log')
    wh = tvf(0.6 * pink(r, n) + 0.4 * wn(r, n), fc, 1.8, 'bp')
    wenv = np.where(t < tp, (t / tp) ** 3, np.exp(-(t - tp) / 0.03))
    y += 0.8 * norm(wh) * wenv
    gm = N(0.25)
    ghost = vocal(r, curve(gm, [(0, 300), (0.25, 450)], 'log'), [(0, 'a'), (0.25, 'e')], 1.0, 2.0,
                  rough=(60, 0.5), sub=0.3, breath=0.3) * np.hanning(gm)
    gl = np.concatenate([ghost, np.zeros(N(1.0))])
    gw = fftconvolve(gl, make_ir(r, 0.9, 6000, 2000))[:len(gl)][::-1]
    place(y, norm(gw), tp - len(gw) / SR, 0.5)
    rate = curve(n, [(0, 15), (tp * 0.6, 120), (tp, 900), (tp + 0.08, 40), (dur, 3)], 'log')
    st = crackle(r, n, rate, 1200, 9000)
    for _ in range(int(r.integers(3, 6))):     # sample-and-hold digital static bursts
        m = N(r.uniform(0.01, 0.04))
        hold = int(r.integers(4, 14))
        b = np.repeat(wn(r, m // hold + 1), hold)[:m] * np.hanning(m)
        place(st, 0.3 * hp(b, 1500), r.uniform(tp * 0.5, tp))
    y += 0.6 * norm(st)
    m = N(0.5)
    f = 28 + (95 - 28) * np.exp(-tt(m) / 0.12)
    sd = sat(np.sin(TAU * np.cumsum(f) / SR) * np.exp(-tt(m) / 0.2) * (1 - np.exp(-tt(m) / 0.003)), 2.5)
    place(y, sd, tp - 0.01, 0.9)
    return reverb(y, make_ir(r, 0.8, 5000, 1500), 0.2)


def s_appear(r, dur):
    n = N(dur)
    t = tt(n)
    y = np.zeros(n)
    tp = 0.98
    inh = breath_phase(r, 0.5, 'in', 0.3, 0.0, 0.0)
    inl = np.concatenate([inh, np.zeros(N(1.0))])
    rv = fftconvolve(inl, make_ir(r, 0.9, 6000, 2000))[:len(inl)]
    sw = (0.7 * norm(rv) + 0.3 * norm(inl))[::-1]
    place(y, norm(sw), tp - len(sw) / SR)
    senv = np.where(t < tp, (t / tp) ** 2.5, np.exp(-(t - tp) / 0.06))
    low = sat(sine(np.full(n, 52.0)) * senv, 1.5) + 0.4 * norm(bp(wn(r, n), 100, 400)) * senv
    y = y * np.where(t < tp, 1.0, np.exp(-(t - tp) / 0.05)) + 0.35 * low
    return y


def claw_tap(r):
    f = r.uniform(2500, 5500)
    m = N(0.04)
    y = modal(m, [f, f * r.uniform(1.5, 2.3), f * r.uniform(2.6, 3.5)], [0.004, 0.0025, 0.0015], [1, .5, .3], r)
    y += 0.4 * modal(m, [r.uniform(280, 520)], [0.008], [1], r)
    sm = N(r.uniform(0.008, 0.025))
    place(y, bp(wn(r, sm), 2000, 7000) * np.hanning(sm), 0.002, 0.3)
    return y


def s_crawl(r, dur):
    n = N(dur)
    y = np.zeros(n)
    limbs = int(r.integers(4, 7))
    base = r.uniform(5, 8)
    for _ in range(limbs):
        tcur = r.uniform(0, 1 / base)
        rl = base * r.uniform(0.85, 1.2)
        while tcur < dur - 0.05:
            place(y, claw_tap(r), tcur, r.uniform(0.4, 1.0))
            tcur += 1 / rl * r.uniform(0.7, 1.3)
    body = lp(wn(r, n), 700) * np.clip(0.5 + 0.5 * rlfo(n, 6, r), 0, 1)
    y = norm(y) + 0.15 * norm(body)
    y *= curve(n, [(0, 0.5), (0.15, 1), (dur - 0.15, 1), (dur, 0.3)])
    return reverb(sat(y, 1.2), make_ir(r, 0.5, 6000, 1500), 0.15)


def s_climb(r, dur):
    n = N(dur)
    y = np.zeros(n)
    tcur = 0.02
    while tcur < dur - 0.2:
        place(y, bone_click(r, r.uniform(1.2, 1.6), 0.8), tcur, 1.0)
        sd = r.uniform(0.1, 0.2)
        place(y, scrape_layer(r, sd, 700, 1200, (60, 90), 0.6, 0.5, 0.2), tcur + 0.01, 0.55)
        y += 0.15 * norm(debris(r, n, tcur + 0.03, r.integers(3, 8), 0.06, 1500, 6000, 0.2))
        place(y, thud(r, 0.2, 110, 50, 0.02, 0.05, 0.6, (150, 500)), tcur + r.uniform(0.03, 0.07), 0.3)
        tcur += r.uniform(0.2, 0.3)
    y = sat(norm(y), 1.3)
    return reverb(y, make_ir(r, 0.6, 6000, 1500), 0.2)


def s_move_far(r, dur, v=0):
    n = N(dur)
    y = np.zeros(n)
    end = dur * 0.6
    if v in (0, 3):     # shuffling
        tcur = r.uniform(0.05, 0.3)
        while tcur < end:
            sd = r.uniform(0.15, 0.4)
            m = N(sd)
            sh = bp(wn(r, m), 200, 2500) * (0.3 + rattle_env(m, r.uniform(40, 80), r, 0.006))
            place(y, norm(sh) * np.sin(np.pi * np.linspace(0, 1, m)) ** 1.5, tcur, r.uniform(0.4, 0.9))
            if r.random() < 0.5:
                place(y, thud(r, 0.3, 110, 45, 0.03, 0.08, 0.6, (150, 500)), tcur + r.uniform(0, sd), r.uniform(0.5, 1))
            tcur += sd + r.uniform(0.05, 0.4)
    if v in (1, 3):     # dragging
        dd = r.uniform(0.9, min(1.8, end))
        place(y, scrape_layer(r, dd, 300, 700, (30, 50), 0.35, 0.7, 0.5), r.uniform(0.05, max(0.06, end - dd)), 0.8)
        for _ in range(2):
            place(y, bone_click(r, 1.0, 0.8), r.uniform(0.1, end), 0.4)
    if v in (2, 3):     # pebbles falling
        t0 = r.uniform(0.1, dur * 0.3)
        y += 0.7 * norm(debris(r, n, t0, r.integers(25, 50), r.uniform(0.15, 0.3), 900, 5000, bounce=0.5))
        place(y, thud(r, 0.3, 120, 50, 0.03, 0.06, 0.5, (150, 600)), t0, 0.5)
    y = hp(lp(y, r.uniform(850, 1300), 4), 70)
    y = reverb(y, make_ir(r, 2.0, 2500, 600, predelay=0.04, n_er=10, er_span=0.12), wet=1.0, dry=0.35)
    return echo(y, r.uniform(0.18, 0.3), 0.25, 900)


def s_jaw_open(r, dur):
    n = N(dur)
    y = np.zeros(n)
    cr = creak(r, 0.6, [(0, 16), (0.35, 45), (0.6, 90)],
               [r.uniform(260, 330), r.uniform(640, 780), r.uniform(1250, 1550), r.uniform(2400, 2900)], (16, 20, 24, 26))
    place(y, cr, 0.02, 0.8)
    sm = N(0.5)
    st = crackle(r, sm, curve(sm, [(0, 400), (0.15, 250), (0.5, 30)], 'log'), 1500, 6000)
    place(y, norm(st) * curve(sm, [(0, 0), (0.02, 1), (0.5, 0)]), 0.03, 0.35)
    place(y, squelch(r, 0.35, 350, 1500, 6), 0.05, 0.45)
    for _ in range(int(r.integers(2, 5))):
        place(y, bubble(r, r.uniform(400, 1200), r.uniform(0.015, 0.04)), r.uniform(0.05, 0.5), r.uniform(0.15, 0.35))
    place(y, pebble(r, 3000, 6000, 0.001, 0.003), r.uniform(0.5, 0.6), 0.4)
    place(y, breath_phase(r, 0.33, 'out', 0.6, 0.3, 0.15), 0.44, 0.35)
    return reverb(sat(norm(y), 1.3), make_ir(r, 0.4, 5000, 1500), 0.12)


# =============================================================================
#  PLAYER sounds
# =============================================================================
HB = [dict(f1=46, f2=55, s2=0.30, atk=0.012, d1=0.10, d2=0.075, click=0.15),
      dict(f1=50, f2=60, s2=0.22, atk=0.007, d1=0.085, d2=0.065, click=0.3),
      dict(f1=55, f2=66, s2=0.165, atk=0.003, d1=0.07, d2=0.055, click=0.5)]


def heart_beat(r, f, decay, atk, clk, dur_max):
    m = N(min(decay * 7, dur_max))
    tm = tt(m)
    a = 1 - np.exp(-tm / atk)
    s = np.sin(TAU * np.cumsum(f * (1 + 0.6 * np.exp(-tm / 0.02))) / SR) * np.exp(-tm / decay) * a
    body = lp(wn(r, m), 260) * np.exp(-tm / (decay * 0.6)) * a
    skin = bp(wn(r, m), 150, 600) * np.exp(-tm / 0.012) * (1 - np.exp(-tm / (atk * 0.5 + 0.0005)))
    return norm(s) + 0.35 * norm(body) + (0.25 + clk) * norm(skin) + 0.9 * norm(presence(s, 110, 600))


def s_heartbeat(r, dur, speed=0):
    n = N(dur)
    p = HB[speed]
    y = np.zeros(n)
    place(y, heart_beat(r, p['f1'], p['d1'], p['atk'], p['click'], dur), 0.004, 1.0)
    place(y, heart_beat(r, p['f2'], p['d2'], p['atk'] * 0.8, p['click'] * 0.8, dur), p['s2'], 0.72)
    y = y + 0.5 * norm(reson(y, 110, 4)) * np.max(np.abs(y))
    y = sat(norm(y), 2.0)
    return lp(y, 650, 2)


def s_spotted(r, dur, v=0):
    n = N(dur)
    t = tt(n)
    base = [36, 38, 35][v]
    sets = [[0, 1, 6, 7, 12, 13, 18, 24, 25, 30], [0, 6, 11, 12, 17, 23, 24, 29, 30], [0, 1, 7, 13, 18, 19, 25, 31]]
    cl = np.zeros(n)
    for mm in base + np.array(sets[v]):
        f = float(mtof(mm))
        for _ in range(3):
            fv = f * 2 ** (r.uniform(-14, 14) / 1200) * (1 + 0.004 * np.sin(TAU * r.uniform(4.5, 6.5) * t + r.uniform(0, TAU)))
            cl += saw(fv, r) * r.uniform(0.7, 1)
    cl = tvf(cl, curve(n, [(0, 9000), (0.08, 4500), (0.6, 1500), (dur, 700)], 'log'), 0.9, 'lp')
    env = np.exp(-t / r.uniform(0.7, 1.0)) * (1 - np.exp(-t / 0.002)) * (1 + 0.15 * np.sin(TAU * 11 * t))
    cl = sat(norm(cl) * 1.5, 1.5) * env
    mt = resbank(wn(r, n) * curve(n, [(0, 1), (0.05, 0.3), (dur, 0.05)]),
                 [r.uniform(2600, 2900), r.uniform(3800, 4100), r.uniform(4700, 5000), r.uniform(6000, 6300), r.uniform(7200, 7500)],
                 [80, 100, 110, 120, 130], [1, 0.8, 0.7, 0.5, 0.4])
    fm = fm_osc(np.full(n, r.uniform(2800, 3400)) * (1 + 0.01 * np.sin(TAU * 7 * t)), 1.414, curve(n, [(0, 4), (dur, 1)]))
    met = (norm(mt) + 0.5 * norm(lp(bp(fm, 1500, 9000), 10000))) * curve(n, [(0, 0), (0.01, 1), (0.4, 0.6), (dur, 0)])
    sb = pad_to(thud(r, dur, 65, 27, 0.1, 0.7, 0.6, (90, 400), 2.5), n)
    y = 0.9 * cl + 0.35 * met + 0.9 * sb
    m = N(0.06)
    place(y, norm(bp(wn(r, m), 150, 7000) * np.exp(-tt(m) / 0.01)), 0, 0.5)
    y = sat(norm(y), 1.3)
    y = reverb(y, make_ir(r, 2.0, 7000, 1500), 0.35)
    return y * curve(n, [(0, 1), (dur - 0.4, 1), (dur, 0)])


def s_tinnitus(r, dur):
    n = N(dur)
    t = tt(n)
    f = r.uniform(6800, 7600) * (1 + 0.002 * np.sin(TAU * 0.45 * t) + 0.0015 * rlfo(n, 1.5, r))
    tone = sine(f) + 0.25 * sine(f * 1.0045 + 3 * rlfo(n, 0.7, r))
    nb = tvf(wn(r, n), f, 150, 'bp')
    y = norm(tone) + 0.3 * norm(nb)
    env = np.minimum(t / 0.12, 1) * np.exp(-np.maximum(t - 0.3, 0) / 1.1)
    return y * env


def s_rumble(r, dur):
    n = N(dur)
    deep = lp(brown(r, n), 80, 4)
    mid = bp(brown(r, n), 100, 450, 2)
    sw = np.clip(curve(n, [(0, 0), (dur * r.uniform(0.25, 0.45), 1), (dur * 0.75, 0.7), (dur, 0)])
                 * (0.75 + 0.35 * rlfo(n, 1.2, r)), 0, None)
    rum = sat(norm(norm(deep) + 0.5 * norm(mid)), 1.8) * sw
    dens = curve(n, [(0, 0), (dur * 0.3, 1), (dur * 0.6, 0.7), (dur * 0.85, 0)])
    tr = np.zeros(n)
    for _ in range(int(dur * r.uniform(60, 120))):
        tk = r.uniform(0, dur)
        if r.random() < dens[min(N(tk), n - 1)]:
            place(tr, pebble(r, 1200, 5500, 0.001, 0.006), tk, r.uniform(0.1, 1.0))
    sand = hp(wn(r, n), 2500) * lp(np.abs(wn(r, n)), 12) ** 2 * dens
    y = rum + 0.25 * norm(tr) + 0.08 * norm(sand)
    return reverb(y, make_ir(r, 2.2, 3000, 700), 0.4)


def s_drip(r, dur):
    n = N(dur)
    y = np.zeros(n)
    f0 = r.uniform(650, 1300)
    d = r.uniform(0.04, 0.07)
    place(y, bubble(r, f0, d, rise=r.uniform(1.2, 2.5)), 0.012)
    cm = N(0.003)
    place(y, lp(wn(r, cm), 5000) * np.hanning(cm), 0.01, 0.2)
    if r.random() < 0.6:
        place(y, bubble(r, f0 * r.uniform(1.4, 2.0), d * 0.6), 0.012 + r.uniform(0.05, 0.12), r.uniform(0.2, 0.4))
    y = reverb(y, make_ir(r, dur * 1.3, 4500, 1200, predelay=0.02, n_er=8, er_span=0.1), 0.6)
    return echo(y, r.uniform(0.12, 0.2), 0.2, 1500)


def s_ambience(r, dur, v=0):
    n = N(dur)
    base = [36.71, 41.2, 32.7, 43.65, 38.89][v]
    drone = np.zeros(n)
    for i, rt in enumerate([1, 1.498, 2 * 1.0595, 2.83, 4 * 1.06]):
        f = base * rt * (1 + 0.002 * rlfo(n, 0.1, r))
        osc = 0.6 * saw(f, r) + sine(f, r.uniform(0, TAU))
        drone += osc * np.clip(0.55 + 0.45 * rlfo(n, 0.07, r), 0, 1) / (1 + i * 0.5)
    drone = tvf(drone, 120 * 4 ** (0.5 + 0.5 * rlfo(n, 0.05, r)), 1.5, 'lp', 128)
    air = tvf(pink(r, n), 180 * 5 ** (0.5 + 0.5 * rlfo(n, 0.1, r)), r.uniform(1.5, 3), 'bp', 128)
    gust = np.clip(0.5 + 0.5 * rlfo(n, 0.09, r), 0.05, 1) ** 1.5
    sub_air = lp(brown(r, n), 100, 2)
    w = [(0.7, 0.4, 0.4), (0.45, 0.8, 0.35), (0.55, 0.5, 0.4), (0.5, 0.5, 0.35), (0.6, 0.45, 0.5)][v]
    bed = w[0] * norm(drone) + w[1] * norm(air) * gust + w[2] * norm(sub_air)
    ev = np.zeros(n)
    lo_t, hi_t = 2.5, dur - 7.0
    for _ in range(int(r.integers(2, 4))):
        d = r.uniform(4, 7)
        place(ev, glass_tone(r, d, r.uniform(700, 1500)), r.uniform(lo_t, dur - d - 2.5), r.uniform(0.15, 0.3))
    if v in (0, 2, 4):
        for _ in range(int(r.integers(1, 3))):
            place(ev, groan(r, r.uniform(2.5, 4.0)), r.uniform(lo_t, hi_t), r.uniform(0.5, 0.8))
    if v in (1, 2, 3):
        for _ in range(int(r.integers(1, 3))):
            d = r.uniform(1.0, 2.2)
            cr = creak(r, d, [(0, r.uniform(8, 14)), (d * 0.5, r.uniform(25, 40)), (d, r.uniform(10, 18))],
                       [r.uniform(250, 350), r.uniform(600, 800), r.uniform(1100, 1500), r.uniform(2000, 2600)], (20, 25, 30, 30))
            place(ev, lp(cr, 2000), r.uniform(lo_t, hi_t), r.uniform(0.3, 0.5))
    if v == 3:
        for _ in range(int(r.integers(4, 8))):
            place(ev, bubble(r, r.uniform(700, 1300), r.uniform(0.04, 0.07)), r.uniform(lo_t, dur - 4), r.uniform(0.1, 0.25))
    if v == 4:
        place(ev, lp(whisper_voice(r, 2.5, 0.05, 1.0), 2500), r.uniform(8, dur - 9), 0.25)
        for _ in range(int(r.integers(1, 3))):
            dd = r.uniform(1.0, 1.6)
            place(ev, lp(scrape_layer(r, dd, 300, 600, (30, 45), 0.3, 0.6, 0.5), 1200), r.uniform(lo_t, hi_t), 0.25)
    ev = reverb(ev, make_ir(r, 3.5, 3000, 700, predelay=0.05, n_er=12, er_span=0.15), wet=1.0, dry=0.3)
    return bed + 0.6 * ev


def s_territory(r, dur, v=0):
    n = N(dur)
    t = tt(n)
    bpm = r.uniform(48, 60)
    per = 60 / bpm
    hb = np.zeros(n)
    whoosh_env = np.zeros(n)
    tb = r.uniform(0.2, 0.6)
    while tb < dur:
        a = r.uniform(0.85, 1.0)
        place(hb, heart_beat(r, r.uniform(36, 42), 0.12, 0.015, 0.1, 1.0), tb, a)
        place(hb, heart_beat(r, r.uniform(44, 50), 0.09, 0.012, 0.1, 1.0), tb + per * 0.32, a * 0.7)
        m = N(per * 0.8)
        place(whoosh_env, np.sin(np.pi * np.linspace(0, 1, m)) ** 2, tb + 0.05, a)
        tb += per * r.uniform(0.97, 1.03)
    hb = lp(sat(norm(hb), 2.0), 300, 2)
    whoosh = bp(brown(r, n), 70, 350) * whoosh_env
    bed = lp(brown(r, n), 180, 2)
    evt = np.zeros(n)     # throbs
    ev = np.zeros(n)      # wet detail: gurgles + creaks
    tcur = r.uniform(0.5, 2.0)
    while tcur < dur - 1.5:      # slow wet throbs
        place(evt, lp(organ_throb(r, r.uniform(0.8, 1.1), r.uniform(0.8, 1.1)), 900), tcur, r.uniform(0.3, 0.6))
        tcur += r.uniform(2.0, 4.0) if v != 2 else r.uniform(1.4, 2.5)
    ng = [5, 9, 3, 6][v]
    for _ in range(int(r.integers(ng - 2, ng + 2))):    # gurgles
        tc = r.uniform(1.0, dur - 2.0)
        cd = r.uniform(0.2, 0.8)
        for _k in range(int(r.integers(3, 12))):
            place(ev, bubble(r, r.uniform(120, 600), r.uniform(0.03, 0.08)), tc + r.uniform(0, cd), r.uniform(0.15, 0.5))
        m = N(cd + 0.2)
        gg = tvf(wn(r, m), 200 * 4 ** (0.5 + 0.5 * rlfo(m, 8, r)), 8) * np.sin(np.pi * np.linspace(0, 1, m))
        place(ev, norm(lp(gg, 1500)), tc, r.uniform(0.2, 0.4))
    nc = [2, 1, 4, 3][v]
    for _ in range(int(r.integers(max(1, nc - 1), nc + 2))):    # tissue creaks
        d = r.uniform(0.6, 1.5)
        cr = creak(r, d, [(0, r.uniform(8, 12)), (d * 0.6, r.uniform(20, 40)), (d, r.uniform(8, 15))],
                   [r.uniform(150, 250), r.uniform(380, 500), r.uniform(700, 900)], (12, 14, 16))
        place(ev, lp(cr, 1500), r.uniform(1.0, dur - 2.5), r.uniform(0.25, 0.45))
    wv = [(0.8, 0.5, 0.75), (0.55, 0.35, 1.0), (0.6, 0.35, 0.9), (0.7, 0.45, 0.85)][v]
    y = wv[0] * norm(hb) + wv[1] * norm(whoosh) + 0.3 * norm(bed) + 0.55 * norm(evt) + wv[2] * norm(ev)
    y = reverb(y, make_ir(r, 0.9, 2500, 600), 0.3)
    return lp(y, 3000, 2)


def s_pressure(r, dur):
    n = N(dur)
    t = tt(n)
    tp = 2.05
    sub = sine(curve(n, [(0, 52), (tp, 38), (dur, 30)], 'log'))
    senv = np.where(t < tp, (t / tp) ** 2, np.exp(-(t - tp) / 0.12))
    sub = sat(sub * senv * 1.2, 2.0)
    mid = bp(brown(r, n), 90, 400) * senv
    suck = tvf(0.6 * wn(r, n) + 0.4 * pink(r, n), curve(n, [(0, 5000), (tp, 220), (dur, 150)], 'log'), 1.6, 'lp')
    sk = curve(n, [(0, 0), (0.35, 1), (tp - 0.2, 0.8), (tp, 0.4), (tp + 0.15, 0), (dur, 0)])
    y = norm(sub) + 0.35 * norm(mid) + 0.5 * norm(suck * sk)
    place(y, thud(r, 0.2, 180, 80, 0.01, 0.025, 0.4, (200, 800), 1.4), tp + 0.01, 0.4)
    return y


# =============================================================================
#  BLOCK sounds
# =============================================================================
def s_organ_pulse(r, dur):
    y = pad_to(organ_throb(r, dur - 0.05, r.uniform(0.9, 1.1)), N(dur))
    return reverb(y, make_ir(r, 0.5, 3000, 800), 0.15)


def s_organ_burst(r, dur):
    n = N(dur)
    y = np.zeros(n)
    m = N(0.06)
    place(y, sat(norm(lp(wn(r, m), 3000) * np.exp(-tt(m) / 0.012)), 3), 0.003, 0.9)
    place(y, thud(r, 0.5, 85, 35, 0.04, 0.15, 0.7, (120, 500), 2.2), 0.003, 0.9)
    for _ in range(int(r.integers(40, 80))):     # splatter
        dt = r.exponential(0.09)
        gd = r.uniform(0.01, 0.04)
        place(y, squelch(r, gd, r.uniform(1200, 2500), r.uniform(300, 700), 4), 0.01 + dt, r.uniform(0.1, 0.5) * np.exp(-dt / 0.2))
    for _ in range(int(r.integers(4, 9))):
        place(y, bubble(r, r.uniform(250, 800), r.uniform(0.02, 0.05)), r.uniform(0.05, 0.5), r.uniform(0.1, 0.3))
    sm = N(0.65)
    f = curve(sm, [(0, 1150), (0.1, 1250), (0.65, 480)], 'log') * (1 + 0.04 * np.sin(TAU * 9 * tt(sm)))
    sq_src = norm(saw(f, r)) + 0.5 * norm(impulse_train(sm, f, r, 0.15, 0.4))
    squeal = sat(norm(formant(sq_src, [(0, 'ee'), (0.65, 'u')], 1.5, 1.5)), 3)
    squeal *= curve(sm, [(0, 0), (0.04, 1), (0.4, 0.7), (0.65, 0)])
    place(y, squeal, 0.08, 0.45)
    hm = N(1.05)
    hs = tvf(wn(r, hm), curve(hm, [(0, 4000), (1.05, 900)], 'log'), 1.2, 'bp')
    flap = rattle_env(hm, curve(hm, [(0, 32), (1.05, 14)]), r, 0.01)
    hs = norm(hs) * (0.4 + 0.8 * flap) * curve(hm, [(0, 0), (0.08, 1), (0.6, 0.5), (1.05, 0)])
    place(y, hs, 0.35, 0.4)
    y = sat(norm(y), 1.4)
    return reverb(y, make_ir(r, 0.7, 5000, 1200), 0.2)


def s_pod_open(r, dur):
    n = N(dur)
    y = np.zeros(n)
    tm = N(0.7)
    tear = crackle(r, tm, curve(tm, [(0, 200), (0.25, 600), (0.7, 80)], 'log'), 1200, 5000)
    place(y, norm(tear) * curve(tm, [(0, 0), (0.05, 1), (0.5, 0.6), (0.7, 0)]), 0.03, 0.4)
    for i in range(int(r.integers(2, 4))):
        place(y, squelch(r, r.uniform(0.15, 0.3), r.uniform(250, 400), r.uniform(1200, 1800), 6), 0.05 + i * r.uniform(0.15, 0.22), 0.5)
    cr = creak(r, 0.55, [(0, 12), (0.3, 40), (0.55, 18)], [r.uniform(180, 230), r.uniform(480, 560), r.uniform(1000, 1200)], (8, 10, 12))
    place(y, cr, 0.05, 0.4)
    place(y, bubble(r, r.uniform(180, 260), 0.07, rise=1.5), 0.74, 0.6)
    place(y, thud(r, 0.2, 100, 50, 0.02, 0.05, 0.6, (150, 500)), 0.74, 0.4)
    place(y, bubble(r, r.uniform(900, 1300), 0.04), r.uniform(0.86, 0.92), 0.25)
    y = sat(norm(y), 1.3)
    return reverb(y, make_ir(r, 0.45, 4000, 1000), 0.15)


def s_flesh(r, dur, hard=True):
    n = N(dur)
    y = np.zeros(n)
    place(y, thud(r, 0.2, r.uniform(110, 140), 50, 0.02, 0.05, 0.6, (150, 500), 1.8), 0.003, 0.8 if hard else 0.6)
    place(y, squelch(r, dur * 0.7, r.uniform(1400, 2000), r.uniform(250, 400), r.uniform(5, 8)), 0.003, 0.9)
    for _ in range(int(r.integers(1, 4))):
        place(y, bubble(r, r.uniform(300, 900), r.uniform(0.02, 0.04)), r.uniform(0.02, dur * 0.6), r.uniform(0.15, 0.35))
    if hard:
        for _ in range(int(r.integers(10, 25))):
            dt = r.exponential(0.05)
            place(y, squelch(r, r.uniform(0.01, 0.03), r.uniform(1500, 3000), 500, 4), 0.01 + dt, r.uniform(0.1, 0.4))
    y = sat(norm(y), 1.5)
    return reverb(y, make_ir(r, 0.3, 4000, 1000, n_er=4), 0.1)


def s_chime(r, dur):
    n = N(dur)
    y = np.zeros(n)
    tubes = sorted(r.uniform(650, 1500, int(r.integers(4, 6))))
    ratios = [1, 2.756, 5.404, 8.933]
    tcur = 0.01
    for _ in range(int(r.integers(7, 12))):
        if tcur > dur - 0.35:
            break
        for _k in range(1 if r.random() < 0.7 else 2):
            f = tubes[int(r.integers(0, len(tubes)))] * r.uniform(0.99, 1.01)
            dm = r.uniform(0.6, 1.0)
            m = N(0.5)
            tone = modal(m, [f * q for q in ratios], [0.25 * dm, 0.12 * dm, 0.06 * dm, 0.03 * dm], [1, 0.6, 0.35, 0.2], r)
            knk = bp(wn(r, m), 300, 900) * np.exp(-tt(m) / 0.008)
            place(y, norm(tone) + 0.35 * norm(knk), tcur + r.uniform(0, 0.012), r.uniform(0.4, 1.0))
        tcur += r.exponential(0.07) + 0.03
    y = sat(norm(y), 1.2)
    y = reverb(y, make_ir(r, 0.9, 6000, 1500), 0.25)
    return y * curve(n, [(0, 1), (dur - 0.25, 1), (dur, 0)])


# =============================================================================
#  MOTH sounds
# =============================================================================
def s_flutter(r, dur):
    n = N(dur)
    rate = r.uniform(14, 22) * (1 + 0.15 * rlfo(n, 3, r))
    beat = (0.5 - 0.5 * np.cos(TAU * np.cumsum(rate) / SR)) ** 3
    papery = bp(wn(r, n), 1200, 6000) * beat
    crk = crackle(r, n, 300 * beat + 5, 2000, 8000) * beat
    whuff = lp(wn(r, n), 350) * beat
    y = 0.6 * norm(papery) + 0.4 * norm(crk) + 0.5 * norm(whuff)
    y *= curve(n, [(0, 0), (0.08, 1), (dur - 0.15, 0.8), (dur, 0)])
    return reverb(y, make_ir(r, 0.3, 6000, 2000, n_er=4), 0.08)


def s_giggle(r, dur):
    """Insect 'laughter': ha-ha-ha syllables (accelerating, falling in pitch) built from
    stridulation click trains + a tiny high formant voice, ring-modulated and crushed."""
    n = N(dur)
    y = np.zeros(n)
    syl = int(r.integers(5, 9))
    rate = r.uniform(6.5, 9.0)
    p0 = r.uniform(1100, 1500)
    tcur = 0.04
    end = dur - 0.22
    for i in range(syl):
        if tcur > end - 0.06:
            break
        prog = i / syl
        sd = 1 / rate * r.uniform(0.5, 0.8) * (1 - 0.2 * prog)
        m = N(sd)
        x = np.linspace(0, 1, m)
        contour = 1 + r.uniform(0.15, 0.35) * np.sin(np.pi * x) - r.uniform(0.05, 0.2) * x
        ps = (1 - 0.3 * prog) * r.uniform(0.92, 1.08)
        clicks = impulse_train(m, r.uniform(180, 320) * ps * contour, r, 0.15, 0.3)
        cf = r.uniform(0.9, 1.1)
        cl = resbank(clicks, [3200 * cf, 4700 * cf, 6500 * cf], [12, 15, 18], [1, 0.7, 0.5])
        v0, v1 = (('ee', 'a'), ('i', 'ae'), ('e', 'a'))[int(r.integers(0, 3))]
        voc = vocal(r, p0 * ps * contour, [(0, v0), (sd, v1)], r.uniform(2.5, 3.0), 1.5,
                    rough=(r.uniform(130, 170), 0.8), sub=0.3, breath=0.2)
        seg = 0.7 * norm(cl) + 0.5 * norm(voc)
        seg = seg + 0.4 * seg * sine(np.full(m, r.uniform(1500, 1900)))
        seg *= curve(m, [(0, 0), (0.008, 1), (sd * 0.4, 0.7), (sd, 0)])
        place(y, seg, tcur, (1 - 0.45 * prog) * r.uniform(0.75, 1.0))
        if r.random() < 0.5:     # mandible click between syllables
            place(y, pebble(r, 3500, 7000, 0.001, 0.003), tcur + sd + r.uniform(0.005, 0.03), r.uniform(0.3, 0.6))
        tcur += 1 / rate * r.uniform(0.8, 1.25) * (1 - 0.25 * prog)
    sm = N(0.16)                 # breathy rising 'hiih' squeak to finish
    sq = vocal(r, curve(sm, [(0, p0 * 1.1), (0.16, p0 * 1.6)], 'log'), [(0, 'i'), (0.16, 'ee')], 2.8, 2.0,
               rough=(150, 0.6), breath=0.8)
    place(y, norm(sq) * curve(sm, [(0, 0), (0.05, 1), (0.16, 0)]), min(tcur + 0.03, dur - 0.19), 0.45)
    y = sat(norm(y) * 1.5, 4)
    y = np.round(y * 48) / 48                      # crushed / buzzy
    y = lp(y, 12000, 2)
    return reverb(y, make_ir(r, 0.35, 7000, 2500, n_er=4), 0.12)


def s_moth_death(r, dur):
    n = N(dur)
    y = np.zeros(n)
    for _ in range(int(r.integers(20, 40))):
        place(y, pebble(r, 2000, 8000, 0.001, 0.005), 0.005 + r.exponential(0.015), r.uniform(0.3, 1.0))
    place(y, modal(N(0.05), [r.uniform(350, 500)], [0.01], [1], r), 0.005, 0.6)
    y = sat(norm(y), 2)
    fm = N(0.45)
    fz = crackle(r, fm, curve(fm, [(0, 2000), (0.45, 50)], 'log'), 2500, 11000, 0.95, 0.0003)
    fz = norm(fz) + 0.4 * norm(tvf(wn(r, fm), curve(fm, [(0, 8000), (0.45, 2000)], 'log'), 3))
    place(y, fz * np.exp(-tt(fm) / 0.12), 0.04, 0.5)
    cm = N(0.15)
    chirp = vocal(r, curve(cm, [(0, 2200), (0.15, 1300)], 'log'), [(0, 'ee'), (0.15, 'u')], 2.5, 1.5, breath=0.1)
    place(y, norm(chirp) * curve(cm, [(0, 0), (0.01, 1), (0.15, 0)]), 0.03, 0.25)
    return reverb(y, make_ir(r, 0.3, 6000, 2000, n_er=4), 0.08)


# =============================================================================
#  MUSIC (stereo)
# =============================================================================
def m_kick(r, drive=3.0):
    m = N(0.45)
    t = tt(m)
    s = np.sin(TAU * np.cumsum(45 + 130 * np.exp(-t / 0.03)) / SR) * np.exp(-t / 0.22) * (1 - np.exp(-t / 0.0008))
    click = hp(wn(r, m), 2000) * np.exp(-t / 0.002)
    return sat(norm(s) + 0.25 * norm(click), drive) * curve(m, [(0, 1), (0.4, 1), (0.45, 0)])


def m_tom(r, f, decay=0.25):
    m = N(decay * 4)
    t = tt(m)
    fr = f * (1 + 0.5 * np.exp(-t / 0.04))
    s = sine(fr) * np.exp(-t / decay) + 0.4 * sine(fr * 1.58) * np.exp(-t / (decay * 0.5))
    head = bp(wn(r, m), f * 2, min(f * 8, 15000)) * np.exp(-t / 0.03)
    return sat(norm(s) + 0.3 * norm(head), 1.8) * (1 - np.exp(-t / 0.0005))


def m_metal(r, f, decay=0.35):
    m = N(decay * 2.5)
    t = tt(m)
    y = np.zeros(m)
    for i, rt in enumerate([1, 1.41, 2.13, 2.76, 3.5, 4.07]):
        y += np.sin(TAU * f * rt * t + r.uniform(0, TAU)) * np.exp(-t / (decay / (1 + i * 0.4))) / (1 + i * 0.3)
    y = y * (1 + 0.5 * np.sin(TAU * f * 0.73 * t))
    y += 0.4 * hp(wn(r, m), 3000) * np.exp(-t / 0.02)
    return sat(norm(y), 1.5) * (1 - np.exp(-t / 0.0004))


def m_snare(r):
    m = N(0.35)
    t = tt(m)
    nz = bp(wn(r, m), 900, 7000) * np.exp(-t / 0.07)
    body = sine(185 * (1 + 0.3 * np.exp(-t / 0.01))) * np.exp(-t / 0.05)
    return sat(norm(nz) + 0.6 * norm(body), 3) * (1 - np.exp(-t / 0.0004))


def m_hat(r, open_=False):
    m = N(0.3 if open_ else 0.07)
    t = tt(m)
    sq = sum(np.sign(np.sin(TAU * f * 2 * t + r.uniform(0, TAU))) for f in [205.3, 304.4, 369.6, 522.7, 540.0, 800.0])
    return hp(sq + 0.5 * wn(r, m), 7000, 2) * np.exp(-t / (0.09 if open_ else 0.014)) * (1 - np.exp(-t / 0.0003))


def m_crash(r, dur=1.6):
    m = N(dur)
    t = tt(m)
    y = hp(wn(r, m), 3000) * np.exp(-t / 0.5)
    y += 0.5 * pad_to(norm(m_metal(r, r.uniform(380, 460), 0.6)), m)
    return norm(y) * (1 - np.exp(-t / 0.0005)) * curve(m, [(0, 1), (dur - 0.1, 0.3), (dur, 0)])


def m_bass(r, f, d):
    m = N(d)
    t = tt(m)
    s = saw(np.full(m, f), r) + saw(np.full(m, f * 1.007), r) + 0.6 * np.sin(TAU * f / 2 * t)
    s = tvf(s, 250 + 1800 * np.exp(-t / 0.05), 2.5, 'lp', 32)
    return sat(norm(s), 4) * curve(m, [(0, 0), (0.003, 1), (d * 0.7, 0.8), (d, 0)])


def m_stab(r, freqs, d=0.38):
    m = N(d)
    t = tt(m)
    y = np.zeros(m)
    for f in freqs:
        for _ in range(3):
            y += saw(f * 2 ** (r.uniform(-20, 20) / 1200) * (1 - 0.06 * np.exp(-t / 0.03)), r)
    y = sat(norm(hp(y, 600)), 2.5)
    return y * np.exp(-t / 0.12) * (1 - np.exp(-t / 0.002)) * curve(m, [(0, 1), (d - 0.02, 1), (d, 0)])


def m_riser(r, d):
    m = N(d)
    t = tt(m)
    nz = tvf(wn(r, m), curve(m, [(0, 300), (d, 9000)], 'log'), 2.5, 'bp')
    tf = curve(m, [(0, 110), (d, 880)], 'log')
    tone = lp(saw(tf, r) + saw(tf * 1.01, r) + saw(tf * 1.5 * 0.995, r), 4000)
    env = (t / d) ** 2.5 * curve(m, [(0, 1), (d - 0.006, 1), (d, 0)])
    return (0.8 * norm(nz) + 0.4 * norm(tone)) * env


def m_boom(r, dur=2.5):
    m = N(dur)
    t = tt(m)
    s = np.sin(TAU * np.cumsum(24 + 40 * np.exp(-t / 0.15)) / SR) * np.exp(-t / 0.9) * (1 - np.exp(-t / 0.002))
    th = lp(wn(r, m), 300) * np.exp(-t / 0.15)
    body = bp(wn(r, m), 150, 500) * np.exp(-t / 0.08)
    y = sat(norm(s) * 1.3 + 0.3 * norm(th), 2.5) + 0.35 * norm(body)
    return norm(y) * curve(m, [(0, 1), (dur - 0.3, 0.6), (dur, 0)])


def drone_voice(r, f, d, cutoff=300, fade=4.0):
    m = N(d)
    ff = f * (1 + 0.0015 * rlfo(m, 0.1, r))
    y = 0.7 * saw(ff, r) + 0.7 * saw(ff * 1.003, r) + sine(ff * 0.5, r.uniform(0, TAU))
    y = tvf(y, cutoff * 2 ** (rlfo(m, 0.06, r)), 1.2, 'lp', 256)
    y *= np.clip(0.6 + 0.4 * rlfo(m, 0.05, r), 0.1, 1)
    return norm(y) * curve(m, [(0, 0), (fade, 1), (d - fade, 1), (d, 0)])


def bowed_metal(r, d):
    m = N(d)
    modes = r.uniform(380, 460) * np.array([1, 2.71, 4.13, 6.3, 8.9]) * r.uniform(0.97, 1.03, 5)
    exc = 0.4 * wn(r, m) + impulse_train(m, r.uniform(200, 450) * (1 + 0.05 * rlfo(m, 2, r)), r, 0.3, 0.5)
    y = resbank(exc, modes, [150, 200, 220, 250, 250], [1, 0.8, 0.6, 0.45, 0.3])
    y += 0.5 * tvf(exc, modes[2] * (1 + 0.02 * rlfo(m, 0.7, r)), 120)
    return norm(y) * curve(m, [(0, 0), (d * 0.35, 1), (d * 0.6, 0.7), (d, 0)]) ** 1.5


def string_pad(r, midis, d, cutoff=1200, attack=2.0, release=2.0, gliss=0.0, voices=4):
    m = N(d)
    t = tt(m)
    L = np.zeros(m)
    R = np.zeros(m)
    gl = 2 ** (gliss * np.clip(t / d, 0, 1) / 12)
    for k, mm in enumerate(midis):
        f = float(mtof(mm))
        for v in range(voices):
            fv = f * 2 ** (r.uniform(-12, 12) / 1200) * gl * (1 + 0.005 * np.sin(TAU * r.uniform(4.5, 6) * t + r.uniform(0, TAU)))
            s = saw(fv, r)
            if (k + v) % 2:
                L += s
            else:
                R += s
    bow = wn(r, m)
    L = lp(L + 0.6 * bp(bow, 400, 3000) * 0.3, cutoff, 2)
    R = lp(R + 0.6 * bp(wn(r, m), 400, 3000) * 0.3, cutoff, 2)
    env = curve(m, [(0, 0), (attack, 1), (d - release, 1), (d, 0)])
    out = np.stack([L, R], 1) * env[:, None]
    return out / (np.max(np.abs(out)) + 1e-9)


def choir_chunk(r, midis, d, vowels, voices=2):
    m = N(d)
    t = tt(m)
    srcs = [np.zeros(m), np.zeros(m)]
    for k, mm in enumerate(midis):
        f = float(mtof(mm))
        for v in range(voices):
            vib = 1 + 0.006 * np.sin(TAU * r.uniform(4.8, 5.8) * t + r.uniform(0, TAU))
            s = lp(saw(f * 2 ** (r.uniform(-9, 9) / 1200) * vib * (1 + 0.003 * rlfo(m, 3, r)), r), 3000, 1)
            srcs[(k + v) % 2] += s * (1 + 0.1 * rlfo(m, 2, r))
    env = curve(m, [(0, 0), (0.5, 1), (d - 0.7, 0.9), (d, 0)])
    out = []
    for i, s in enumerate(srcs):
        s = norm(s) + 0.08 * wn(r, m)
        out.append(formant(s, vowels, 1.0 + 0.03 * i, 1.3, 5, 128) * env)
    out = np.stack(out, 1)
    return out / (np.max(np.abs(out)) + 1e-9)


def music_stalk(r, dur):
    """45 s seamless loop: low dissonant drones, sparse bowed-metal scrapes, faint slow pulse."""
    n = N(dur)
    out = np.zeros((n, 2))
    X = 4.0
    for f, p, g, c in [(36.71, -0.3, 1.0, 260), (51.91, 0.35, 0.6, 300), (77.78, -0.1, 0.45, 380), (110.6, 0.5, 0.25, 500)]:
        place(out, pan(drone_voice(r, f, dur + X, c, X), p), r.uniform(0, dur), g, wrap=True)
    send = np.zeros((n, 2))
    for i in range(5):
        d = r.uniform(3.0, 6.0)
        place(send, pan(bowed_metal(r, d), r.uniform(-0.8, 0.8)), i * dur / 5 + r.uniform(0, dur / 5 - 1), 0.35, wrap=True)
    per = dur / 24
    for k in range(24):
        th = lp(thud(r, 0.8, 70, 38, 0.04, 0.25, 0.5, (100, 300), 1.6), 250)
        a = 0.35 * (0.8 + 0.2 * np.sin(TAU * k / 24))
        place(out, pan(th, 0.0), k * per, a, wrap=True)
        place(out, pan(th, 0.0), k * per + 0.32, a * 0.55, wrap=True)
    irL = make_ir(r, 4.0, 3000, 600, 0.03, 0)
    irR = make_ir(r, 4.0, 3000, 600, 0.037, 0)
    out = out + 0.25 * send
    return creverb_st(out, irL, irR, 0.35) + creverb_st(send, irL, irR, 0.9) - send


def music_encounter(r, dur):
    """30 s standoff: detuned low string pads, rising chromatic cluster swells, irregular ticking, unresolved end."""
    n = N(dur)
    out = np.zeros((n, 2))
    cut = dur - 2.2
    place(out, string_pad(r, [38, 39, 45], cut + 0.4, 900, 3.0, 0.4, 0.0, 4), 0.0, 0.8)
    place(out, string_pad(r, [26, 27], cut + 0.4, 500, 4.0, 0.4, 0.0, 3), 0.0, 0.6)
    entries = [(4.0, [50, 51, 52]), (9.0, [56, 57, 58, 59]), (14.0, [61, 62, 63, 64]), (19.0, [67, 68, 69, 70]),
               (23.0, [73, 74, 75, 76, 77])]
    for i, (t0, notes) in enumerate(entries):
        d = cut - t0 + 0.4
        pad = string_pad(r, notes, d, 1500 + 600 * i, d * 0.7, 0.4, gliss=r.uniform(1.0, 3.0), voices=3)
        place(out, pad, t0, 0.35 + 0.08 * i)
    sw = curve(n, [(0, 0.5), (cut, 1.0), (dur, 1.0)])
    out *= sw[:, None]
    sub = sat(sine(np.full(n, 36.71)) * curve(n, [(0, 0), (cut, 1), (cut + 0.05, 0), (dur, 0)]) ** 2, 1.5)
    out += 0.4 * pan(sub, 0)
    tcur = 2.0
    side = 1
    while tcur < cut - 0.1:
        tk = pad_to(pebble(r, 2500, 4200, 0.002, 0.006), N(0.04)) + 0.5 * modal(N(0.04), [r.uniform(700, 900)], [0.006], [1], r)
        place(out, pan(norm(tk), 0.6 * side), tcur, r.uniform(0.15, 0.25))
        if r.random() < 0.25:
            place(out, pan(norm(tk), 0.6 * side), tcur + r.uniform(0.08, 0.14), 0.12)
        side = -side
        prog = tcur / cut
        tcur += r.uniform(0.25, 0.9) * (1 - 0.45 * prog)
    for t0 in (7.0, 16.5, 25.0):
        place(out, pan(bowed_metal(r, r.uniform(3, 4.5)), r.uniform(-0.7, 0.7)), t0, 0.18)
    out *= curve(n, [(0, 1), (cut, 1), (cut + 0.04, 0), (dur, 0)])[:, None]
    irL = make_ir(r, 3.0, 4000, 800, 0.02, 0)
    irR = make_ir(r, 3.0, 4000, 800, 0.027, 0)
    return reverb_st(out, irL, irR, 0.4)


CHASE_BASS = [0, 0, 0, 12, 0, 0, 1, 0, 0, 0, 0, 13, 0, 1, 0, -2]


def music_chase(r, dur):
    """150 BPM, 16 bars, seamless loop (all events and reverb wrap circularly)."""
    n = N(dur)
    s16 = 60 / 150 / 4
    out = np.zeros((n, 2))
    room = np.zeros((n, 2))
    hall = np.zeros((n, 2))

    def put(sig, t, g=1.0, p=0.0, rs=0.0, hs=0.0):
        st = pan(sig, p) * g
        place(out, st, t, 1.0, wrap=True)
        if rs:
            place(room, st, t, rs, wrap=True)
        if hs:
            place(hall, st, t, hs, wrap=True)

    def T(bar, step):
        return (bar * 16 + step) * s16

    kicks = [m_kick(r) for _ in range(3)]
    snares = [m_snare(r) for _ in range(3)]
    hats = [m_hat(r) for _ in range(4)]
    ohat = m_hat(r, True)
    toms = {'lo': [m_tom(r, 82) for _ in range(2)], 'mid': [m_tom(r, 118, 0.2) for _ in range(2)],
            'hi': [m_tom(r, 165, 0.16) for _ in range(2)]}
    metals = [m_metal(r, f) for f in (612, 735, 1010)]
    bass_cache = {}
    stab_freqs = [[587.33, 622.25, 830.61], [587.33, 830.61, 880.0], [622.25, 659.26, 932.33]]
    for bar in range(16):
        ph, bq = bar // 4, bar % 4
        kp = [0, 4, 7, 10, 12] + ([14, 15] if ph >= 2 and bq % 2 == 1 else [])
        for s in kp:
            put(kicks[(bar + s) % 3], T(bar, s), 1.0 if s % 4 == 0 else 0.8)
        for s in (4, 12):
            put(snares[(bar + s) % 3], T(bar, s), 0.62, 0.1, rs=0.35)
        for s in range(16):
            if bq == 3 and s >= 8:
                continue
            if s == 14 and bq in (1, 2):
                put(ohat, T(bar, s), 0.35, 0.35, rs=0.2)
            else:
                put(hats[s % 4], T(bar, s), 0.38 if s % 4 == 2 else 0.2, 0.35)
        lo, mid, hi = [3, 11], [6, 14], ([15] if ph >= 1 else [])
        if ph >= 2:
            lo, mid, hi = [3, 9, 11], [6, 13, 14], [7, 15]
        if bq != 3:
            for s in lo:
                put(toms['lo'][s % 2], T(bar, s), 0.7, -0.35, rs=0.2)
            for s in mid:
                put(toms['mid'][s % 2], T(bar, s), 0.6, 0.0, rs=0.2)
            for s in hi:
                put(toms['hi'][s % 2], T(bar, s), 0.5, 0.4, rs=0.2)
        else:   # fill under the riser
            seq = ['hi', 'hi', 'mid', 'mid', 'lo', 'lo', 'lo', 'mid']
            for j, s in enumerate(range(8, 16)):
                put(toms[seq[j]][j % 2], T(bar, s), 0.45 + 0.05 * j, [0.4, 0.4, 0, 0, -0.35, -0.35, -0.35, 0][j], rs=0.2)
        msteps = {0: [7] if bar % 2 else [], 1: [7, 15], 2: [3, 7, 10, 15], 3: [3, 7, 10, 15]}[ph]
        for j, s in enumerate(msteps):
            if bq == 3 and s >= 8:
                continue
            put(metals[(bar + j) % 3], T(bar, s), 0.4, 0.55 if j % 2 else -0.55, hs=0.3)
        tr = [0, 0, 1, 6][bq]
        for s in range(16):
            note = CHASE_BASS[s] + tr
            if note not in bass_cache:
                bass_cache[note] = m_bass(r, 73.42 * 2 ** (note / 12), s16 * 0.85)
            put(bass_cache[note], T(bar, s), 0.55 if s % 4 else 0.65)
        if ph in (1, 3) and bq in (0, 2):
            steps = [0, 6] + ([10] if ph == 3 else [])
            for j, s in enumerate(steps):
                put(m_stab(r, stab_freqs[(bar + j) % 3]), T(bar, s), 0.45, -0.3 if j % 2 else 0.3, hs=0.35)
        if bq == 3:
            put(m_riser(r, 16 * s16), T(bar, 0), 0.55, 0.0, hs=0.2)
        if bq == 0:
            put(m_crash(r), T(bar, 0), 0.5, -0.2, hs=0.25)
            put(m_crash(r), T(bar, 0), 0.4, 0.3)
            put(m_boom(r, 1.2), T(bar, 0), 0.6)
    irL, irR = make_ir(r, 0.9, 6000, 1500, 0.008), make_ir(r, 0.9, 6000, 1500, 0.011)
    hL, hR = make_ir(r, 1.8, 5000, 1200, 0.02), make_ir(r, 1.8, 5000, 1200, 0.026)
    y = out + creverb_st(room, irL, irR, 1.0) - room + creverb_st(hall, hL, hR, 1.0) - hall
    y = circ_hp(y, 25.0)
    return sat(norm(y) * 1.2, 1.3)


FINAL_CHORDS = [[50, 57, 62, 63], [46, 53, 58, 62], [51, 58, 63, 66], [49, 56, 61, 62]]


def music_final(r, dur):
    """110 BPM, 18 bars, seamless loop: booms, formant choir, toms, distorted bass, screeches."""
    n = N(dur)
    beat = 60 / 110
    bar_d = beat * 4
    out = np.zeros((n, 2))
    hall = np.zeros((n, 2))

    def put(sig, t, g=1.0, p=0.0, hs=0.0):
        st = pan(sig, p) * g if sig.ndim == 1 else sig * g
        place(out, st, t, 1.0, wrap=True)
        if hs:
            place(hall, st, t, hs, wrap=True)

    def B(bar, b=0.0):
        return (bar + b / 4) * bar_d

    for c in range(9):    # choir: 2-bar chords, overlapping releases wrap around the loop
        chord = FINAL_CHORDS[c % 4]
        vw = [(0, 'aw'), (bar_d, 'o'), (2 * bar_d + 0.7, 'a')] if c % 2 == 0 else [(0, 'o'), (bar_d, 'oo'), (2 * bar_d + 0.7, 'aw')]
        ch = choir_chunk(r, chord + [chord[0] - 12], 2 * bar_d + 0.7, vw)
        put(ch, B(2 * c) - 0.1, 0.42 + (0.1 if 10 <= 2 * c < 16 else 0.0), hs=0.4)
    booms = [m_boom(r, 2.6) for _ in range(3)]
    kicks = [m_kick(r, 3.5) for _ in range(2)]
    toms = {'lo': [m_tom(r, 70, 0.3) for _ in range(2)], 'mid': [m_tom(r, 100, 0.25) for _ in range(2)],
            'hi': [m_tom(r, 140, 0.2) for _ in range(2)]}
    snares = [m_snare(r) for _ in range(2)]
    hats = [m_hat(r) for _ in range(3)]
    metals = [m_metal(r, f, 0.5) for f in (420, 530)]
    bass_cache = {}
    for bar in range(18):
        root = FINAL_CHORDS[(bar // 2) % 4][0] - 24
        boom_here = bar < 2 or bar >= 14 or bar % 2 == 0 or 10 <= bar < 14
        if boom_here and bar < 16:
            put(booms[bar % 3], B(bar), 0.9, 0.0, hs=0.35)
        if 10 <= bar < 14:
            put(booms[(bar + 1) % 3], B(bar, 2), 0.7, 0.0, hs=0.3)
        drums = 2 <= bar < 14 or bar >= 16
        if drums:
            for b in (0, 2):
                put(kicks[b // 2], B(bar, b), 0.85)
            pat = [('lo', 0.75), ('mid', 1.5), ('lo', 2.5), ('hi', 3.25), ('mid', 3.5)]
            if bar >= 10:
                pat = pat + [('lo', 1.0), ('hi', 1.75), ('mid', 2.75), ('lo', 3.75)]
            if bar < 16:
                for j, (tn, b) in enumerate(pat):
                    put(toms[tn][j % 2], B(bar, b), 0.6, {'lo': -0.35, 'mid': 0.05, 'hi': 0.4}[tn], hs=0.15)
            if 6 <= bar < 14:
                put(snares[bar % 2], B(bar, 2), 0.6, 0.0, hs=0.3)
            if 10 <= bar < 14:
                for k in range(8):
                    put(hats[k % 3], B(bar, k / 2), 0.3 if k % 2 else 0.18, 0.35)
            if 6 <= bar < 14 and bar % 2 == 1:
                put(metals[bar % 2], B(bar, 1.5), 0.35, -0.5 if bar % 4 == 1 else 0.5, hs=0.35)
        if 2 <= bar < 14 or bar >= 16:
            for k in range(8):
                note = root + (12 if k in (3, 7) else 0) + (1 if k == 5 else 0)
                if note not in bass_cache:
                    bass_cache[note] = m_bass(r, float(mtof(note)), beat / 2 * 0.9)
                put(bass_cache[note], B(bar, k / 2), 0.5)
        if bar >= 16:   # build back into bar 0
            k = 0
            b = 0.0
            while b < 4:
                tn = ['hi', 'mid', 'lo'][k % 3]
                put(toms[tn][k % 2], B(bar, b), 0.4 + 0.15 * (bar - 16) + 0.1 * b / 4, [0.4, 0.0, -0.35][k % 3], hs=0.2)
                b += 0.5 if bar == 16 else 0.25
                k += 1
    put(m_riser(r, 2 * bar_d), B(16), 0.6, 0.0, hs=0.3)
    for bar, b, p in [(7, 2.5, -0.6), (11, 1.5, 0.6), (14, 0.5, -0.4), (15, 2.0, 0.5)]:
        sc = scream_core(r, r.uniform(1.4, 1.8), r.uniform(0.8, 0.95))
        sc = lp(sc, 6000) * curve(len(sc), [(0, 1), (len(sc) / SR - 0.05, 1), (len(sc) / SR, 0)])
        put(sc, B(bar, b), 0.28, p, hs=0.5)
    irL, irR = make_ir(r, 2.8, 4500, 900, 0.025, 0), make_ir(r, 2.8, 4500, 900, 0.032, 0)
    y = out + creverb_st(hall, irL, irR, 1.0) - hall
    y = circ_hp(y, 22.0)
    return sat(norm(y) * 1.2, 1.3)


# =============================================================================
#  Registry
# =============================================================================
REG = []


def reg(path, fn, dur, peak=-1.0, rng=None, fade_in=0.006, fade_out=0.02, loop=False, exact=False,
        channels=1, **kw):
    REG.append(dict(path=path, fn=fn, dur=dur, peak=peak, range=rng or (dur, dur), fade_in=fade_in,
                    fade_out=fade_out, loop=loop, exact=exact, channels=channels, kw=kw))


def build_registry():
    M, P, B, T, MU = 'mob/', 'player/', 'block/', 'moth/', 'music/'
    for i, d in enumerate([0.45, 0.5, 0.55, 0.48]):
        reg(M + f'step{i+1}', s_step, d, -1.0, (0.4, 0.6))
    for i in range(2):
        reg(M + f'step_wet{i+1}', s_step_wet, 0.5, -1.0, (0.45, 0.55))
    for i, d in enumerate([1.0, 1.4, 1.2]):
        reg(M + f'scrape{i+1}', s_scrape, d, -1.0, (0.8, 1.6))
    for i, d in enumerate([1.0, 1.15, 0.9]):
        reg(M + f'smash{i+1}', s_smash, d, -1.0, (0.8, 1.2))
    for i, d in enumerate([2.0, 2.4, 1.7]):
        reg(M + f'screech{i+1}', s_screech, d, -1.0, (1.5, 2.5))
    for i, d in enumerate([3.5, 3.9]):
        reg(M + f'scream_far{i+1}', s_scream_far, d, -7.0, (3.0, 4.0), fade_out=0.3)
    for i, d in enumerate([1.8, 2.3, 2.0]):
        reg(M + f'growl{i+1}', s_growl, d, -1.0, (1.5, 2.5))
    for i, d in enumerate([2.6, 1.8, 1.6, 3.0]):
        reg(M + f'breath{i+1}', s_breath, d, -3.0, (1.5, 3.0), v=i)
    for i, d in enumerate([0.7, 0.6, 1.1, 0.35]):
        reg(M + f'click{i+1}', s_click, d, -2.0, (0.3, 1.2), v=i)
    for i, d in enumerate([0.7, 0.85, 0.65]):
        reg(M + f'hurt{i+1}', s_hurt, d, -1.0, (0.6, 1.0))
    reg(M + 'death1', s_death, 3.0, -1.0, (2.7, 3.3), fade_out=0.08)
    for i, d in enumerate([2.2, 1.8, 2.8, 2.5]):
        reg(M + f'whisper{i+1}', s_whisper, d, -9.0, (1.5, 3.0), v=i)
    for i, (d, c) in enumerate([(1.2, 3), (1.5, 3), (1.1, 2)]):
        reg(M + f'knock{i+1}', s_knock, d, -2.0, (1.0, 1.5), fade_out=0.08, count=c)
    for i, d in enumerate([1.5, 1.55]):
        reg(M + f'vanish{i+1}', s_vanish, d, -1.0, (1.3, 1.7), fade_out=0.06)
    reg(M + 'appear1', s_appear, 1.2, -6.0, (1.0, 1.4))
    for i, d in enumerate([1.0, 0.9, 1.2]):
        reg(M + f'crawl{i+1}', s_crawl, d, -3.0, (0.8, 1.2))
    for i, d in enumerate([1.0, 1.05]):
        reg(M + f'climb{i+1}', s_climb, d, -2.0, (0.9, 1.1))
    for i, d in enumerate([3.0, 3.6, 2.5, 3.9]):
        reg(M + f'move_far{i+1}', s_move_far, d, -8.0, (2.0, 4.0), fade_in=0.05, fade_out=0.4, v=i)
    reg(M + 'jaw_open1', s_jaw_open, 0.8, -2.0, (0.7, 0.9))

    for nm, d, sp in [('heartbeat_slow', 0.95, 0), ('heartbeat_med', 0.62, 1), ('heartbeat_fast', 0.42, 2)]:
        reg(P + nm, s_heartbeat, d, -2.0, (d, d), fade_in=0.003, fade_out=0.01, exact=True, speed=sp)
    for i, d in enumerate([2.6, 2.4, 2.9]):
        reg(P + f'spotted{i+1}', s_spotted, d, -1.0, (2.0, 3.0), v=i)
    reg(P + 'tinnitus1', s_tinnitus, 4.0, -14.0, (3.8, 4.2), fade_in=0.02, fade_out=0.2)
    for i, d in enumerate([4.0, 4.8, 3.4]):
        reg(P + f'rumble{i+1}', s_rumble, d, -3.0, (3.0, 5.0), fade_in=0.05, fade_out=0.2)
    for i, d in enumerate([1.0, 1.3, 0.8, 1.5]):
        reg(P + f'drip{i+1}', s_drip, d, -6.0, (0.6, 1.5), fade_out=0.08)
    for i, d in enumerate([26.0, 24.0, 28.0, 22.0, 30.0]):
        reg(P + f'ambience{i+1}', s_ambience, d, -12.0, (20.0, 30.0), fade_in=2.0, fade_out=2.0, v=i)
    for i, d in enumerate([24.0, 27.0, 22.0, 30.0]):
        reg(P + f'territory{i+1}', s_territory, d, -12.0, (20.0, 30.0), fade_in=2.0, fade_out=2.0, v=i)
    reg(P + 'pressure1', s_pressure, 2.5, -3.0, (2.3, 2.7), fade_in=0.02, fade_out=0.1)

    for i, d in enumerate([1.0, 1.05]):
        reg(B + f'organ_pulse{i+1}', s_organ_pulse, d, -2.0, (0.9, 1.1))
    reg(B + 'organ_burst1', s_organ_burst, 1.5, -1.0, (1.3, 1.7), fade_out=0.05)
    reg(B + 'pod_open1', s_pod_open, 1.0, -2.0, (0.9, 1.1))
    for i, d in enumerate([0.35, 0.3, 0.4]):
        reg(B + f'flesh_break{i+1}', s_flesh, d, -2.0, (0.2, 0.4), hard=True)
    for i, d in enumerate([0.25, 0.22, 0.28]):
        reg(B + f'flesh_step{i+1}', s_flesh, d, -3.0, (0.2, 0.4), hard=False)
    for i, d in enumerate([1.2, 1.25]):
        reg(B + f'chime{i+1}', s_chime, d, -3.0, (1.1, 1.3))

    for i, d in enumerate([0.7, 0.9, 0.6]):
        reg(T + f'flutter{i+1}', s_flutter, d, -6.0, (0.6, 1.0))
    for i, d in enumerate([1.0, 1.15, 0.85]):
        reg(T + f'giggle{i+1}', s_giggle, d, -3.0, (0.8, 1.2))
    reg(T + 'death1', s_moth_death, 0.5, -2.0, (0.4, 0.6))

    reg(MU + 'stalk', music_stalk, 45.0, -6.0, (44.0, 46.0), loop=True, channels=2)
    reg(MU + 'encounter', music_encounter, 30.0, -3.0, (29.0, 31.0), fade_in=0.5, fade_out=0.5, channels=2)
    reg(MU + 'chase', music_chase, 25.6, -1.0, (25.6, 25.6), loop=True, exact=True, channels=2)
    reg(MU + 'final', music_final, 18 * 4 * 60 / 110, -1.0, (38.0, 42.0), loop=True, channels=2)


build_registry()


# =============================================================================
#  Render / encode / decode
# =============================================================================
def finish(x, spec):
    x = np.array(x, float)
    if spec['loop']:
        x = circ_hp(x, 20.0)
    else:
        x = hp(x, 20.0, 2)
        x = x - np.mean(x, axis=0)
        fi, fo = N(spec['fade_in']), N(spec['fade_out'])
        if fi > 0:
            w = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fi))
            x[:fi] *= w if x.ndim == 1 else w[:, None]
        if fo > 0:
            w = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo))
            x[-fo:] *= w if x.ndim == 1 else w[:, None]
        # remove residual mean with a Hann-shaped correction (keeps the faded edges at zero)
        w = np.hanning(len(x))
        corr = np.mean(x, axis=0) / np.mean(w)
        x = x - (w * corr if x.ndim == 1 else w[:, None] * corr[None, :])
    p = np.max(np.abs(x))
    return x * (10 ** (spec['peak'] / 20) / p)


def out_path(spec):
    return os.path.join(OUT_DIR, spec['path'] + '.ogg')


def encode(x, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    ch = 1 if x.ndim == 1 else x.shape[1]
    cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch),
           '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', '4', '-page_duration', '50000', '-map_metadata', '-1',
           '-fflags', '+bitexact', '-flags:a', '+bitexact', path]
    subprocess.run(cmd, input=np.ascontiguousarray(x, '<f4').tobytes(), check=True)


def probe_channels(path):
    out = subprocess.run([FFPROBE, '-v', 'error', '-select_streams', 'a:0', '-show_entries',
                          'stream=channels,sample_rate', '-of', 'json', path], capture_output=True, check=True).stdout
    st = json.loads(out)['streams'][0]
    return int(st['channels']), int(st['sample_rate'])


def decode(path):
    ch, sr = probe_channels(path)
    raw = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, '<f4').reshape(-1, ch).astype(float), ch, sr


def render_one(i):
    spec = REG[i]
    t0 = time.time()
    r = np.random.default_rng([BASE_SEED, zlib.crc32(spec['path'].encode())])
    x = spec['fn'](r, spec['dur'], **spec['kw'])
    x = pad_to(np.asarray(x, float), N(spec['dur']))
    if not np.all(np.isfinite(x)):
        raise RuntimeError(f"non-finite samples in {spec['path']}")
    x = finish(x, spec)
    # Vorbis can overshoot sharp transients and adds a little infrasonic error on short thumps:
    # decode, then correct the peak level and residual mean (closed loop, max 5 passes)
    w = np.hanning(len(x))
    for _ in range(5):
        encode(x, out_path(spec))
        y = decode(out_path(spec))[0]
        pk = db(np.max(np.abs(y)))
        dc = np.mean(y, axis=0)
        ok_pk = pk <= spec['peak'] + 0.25
        ok_dc = spec['loop'] or np.max(np.abs(dc)) < 5e-4
        if ok_pk and ok_dc:
            break
        if not ok_dc:
            x = x - (w * dc[0] if x.ndim == 1 else w[:, None] * dc[None, :]) / np.mean(w)
        if not ok_pk:
            x = x * 10 ** ((spec['peak'] - pk) / 20)
    return spec['path'], time.time() - t0


# =============================================================================
#  Verification, manifest, spectrogram sheet
# =============================================================================
def db(v):
    return 20 * np.log10(max(v, 1e-12))


def verify_and_manifest():
    manifest, problems, decoded = {}, [], {}
    for spec in REG:
        p = out_path(spec)
        key = 'sounds/shaftbreaker/' + spec['path']
        if not os.path.exists(p):
            problems.append(f'{key}: MISSING')
            continue
        x, ch, sr = decode(p)
        decoded[spec['path']] = x
        n = len(x)
        dur = n / sr
        peak = float(np.max(np.abs(x)))
        rms = float(np.sqrt(np.mean(x ** 2)))
        dc = float(np.max(np.abs(np.mean(x, axis=0))))
        lo, hi = spec['range']
        if sr != SR:
            problems.append(f'{key}: sample rate {sr}')
        if ch != spec['channels']:
            problems.append(f"{key}: {ch} channels, expected {spec['channels']}")
        if abs(n - N(spec['dur'])) > 1:
            problems.append(f"{key}: {n} samples, expected {N(spec['dur'])}")
        if not (lo - 1e-3 <= dur <= hi + 1e-3):
            problems.append(f'{key}: duration {dur:.3f}s outside {lo}-{hi}s')
        if peak >= 0.995:
            problems.append(f'{key}: clipping (peak {db(peak):.2f} dBFS)')
        if db(rms) < -45:
            problems.append(f'{key}: near-silent (RMS {db(rms):.1f} dBFS)')
        if dc > 2e-3:
            problems.append(f'{key}: DC offset {dc:.4f}')
        if spec['loop']:
            d = np.abs(np.diff(x, axis=0)).max(axis=1)
            seam = float(np.max(np.abs(x[0] - x[-1])))
            if seam > np.quantile(d, 0.999):
                problems.append(f'{key}: loop seam jump {seam:.4f}')
        else:
            edge = float(max(np.max(np.abs(x[:8])), np.max(np.abs(x[-8:]))))
            if edge > 0.02:
                problems.append(f'{key}: edge not faded ({edge:.3f})')
        manifest[key] = {'duration': round(dur, 4), 'channels': ch, 'peak_db': round(db(peak), 2)}
        print(f'  {key:48s} {dur:7.3f}s ch={ch} peak={db(peak):6.2f} rms={db(rms):6.1f} dBFS')
    with open(os.path.join(OUT_DIR, 'sounds_manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    return manifest, problems, decoded


CMAP = np.array([(0, 0, 4), (31, 12, 72), (85, 15, 109), (136, 34, 106), (186, 54, 85),
                 (227, 89, 51), (249, 140, 10), (249, 201, 50), (252, 255, 164)], float)


def colorize(v):
    idx = v * (len(CMAP) - 1)
    i0 = np.clip(np.floor(idx).astype(int), 0, len(CMAP) - 2)
    fr = (idx - i0)[..., None]
    return (CMAP[i0] * (1 - fr) + CMAP[i0 + 1] * fr).astype(np.uint8)


def spec_image(x, w, h, fmin=30.0, fmax=20000.0, nfft=2048, rng_db=80.0):
    if len(x) < nfft:
        x = np.pad(x, (0, nfft - len(x)))
    hop = max(128, (len(x) - nfft) // (w * 4) + 1)
    fr = np.lib.stride_tricks.sliding_window_view(x, nfft)[::hop]
    S = np.abs(np.fft.rfft(fr * np.hanning(nfft), axis=1)) ** 2
    if len(S) >= w:
        P = np.stack([c.mean(0) for c in np.array_split(S, w)])
    else:
        P = S[np.linspace(0, len(S) - 1, w).round().astype(int)]
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    rows = fmin * (fmax / fmin) ** np.linspace(0, 1, h)
    img = np.stack([np.interp(rows, freqs, p) for p in P])
    dbv = 10 * np.log10(img + 1e-20) - 20 * np.log10(np.sum(np.hanning(nfft)) / 2)
    vmax = dbv.max()
    v = np.clip((dbv - (vmax - rng_db)) / rng_db, 0, 1)
    rgb = colorize(v.T[::-1])
    for f in (100, 1000, 10000):
        y = int(round((h - 1) - np.log(f / fmin) / np.log(fmax / fmin) * (h - 1)))
        rgb[y, ::3] = (90, 160, 160)
    return rgb


def contact_sheet(decoded, manifest, path=SHEET, cols=8, tw=232, th=96):
    from PIL import Image, ImageDraw, ImageFont
    try:
        font = ImageFont.load_default(size=11)
        hfont = ImageFont.load_default(size=15)
    except Exception:
        font = hfont = ImageFont.load_default()
    items = [s for s in REG if s['path'] in decoded]
    lab, pad, head = 28, 8, 40
    rows = int(np.ceil(len(items) / cols))
    W = cols * (tw + pad) + pad
    H = head + rows * (th + lab + pad) + pad
    im = Image.new('RGB', (W, H), (18, 18, 22))
    dr = ImageDraw.Draw(im)
    dr.text((pad, 10), 'The Shaftbreaker - procedural SFX spectrograms   (log freq 30 Hz - 20 kHz, '
            'guides at 100 Hz / 1 kHz / 10 kHz, 80 dB range per tile)', fill=(230, 230, 230), font=hfont)
    for k, s in enumerate(items):
        x = decoded[s['path']]
        mono = x.mean(axis=1)
        r_, c_ = divmod(k, cols)
        x0 = pad + c_ * (tw + pad)
        y0 = head + r_ * (th + lab + pad)
        im.paste(Image.fromarray(spec_image(mono, tw, th)), (x0, y0 + lab))
        m = manifest['sounds/shaftbreaker/' + s['path']]
        dr.text((x0, y0), s['path'], fill=(240, 240, 240), font=font)
        dr.text((x0, y0 + 13), f"{m['duration']:.2f}s  {'stereo' if m['channels'] == 2 else 'mono'}  "
                f"pk {m['peak_db']:.1f} dB", fill=(160, 170, 180), font=font)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, optimize=True)
    return path


# =============================================================================
#  Main
# =============================================================================
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', default=None, help='glob of sound paths to render (e.g. "mob/screech*")')
    ap.add_argument('--jobs', type=int, default=os.cpu_count() or 1)
    ap.add_argument('--no-render', action='store_true', help='skip rendering, only verify/manifest/sheet')
    ap.add_argument('--no-check', action='store_true')
    ap.add_argument('--no-sheet', action='store_true')
    a = ap.parse_args()
    idx = [i for i, s in enumerate(REG) if a.only is None or fnmatch.fnmatch(s['path'], a.only)]
    if not a.no_render:
        print(f'rendering {len(idx)} sounds with {a.jobs} worker(s) ...')
        t0 = time.time()
        if a.jobs > 1 and len(idx) > 1:
            from concurrent.futures import ProcessPoolExecutor
            # heavy jobs first for better load balancing
            order = sorted(idx, key=lambda i: -REG[i]['dur'] * REG[i]['channels'])
            with ProcessPoolExecutor(a.jobs) as ex:
                for path, dt in ex.map(render_one, order):
                    print(f'  {path:36s} {dt:6.2f}s')
        else:
            for i in idx:
                path, dt = render_one(i)
                print(f'  {path:36s} {dt:6.2f}s')
        print(f'render done in {time.time() - t0:.1f}s')
    if a.no_check:
        return 0
    print('verifying ...')
    manifest, problems, decoded = verify_and_manifest()
    total = sum(os.path.getsize(out_path(s)) for s in REG if os.path.exists(out_path(s)))
    print(f'{len(manifest)} files, {total / 1e6:.2f} MB')
    if not a.no_sheet:
        print('contact sheet ->', contact_sheet(decoded, manifest))
    if problems:
        print('PROBLEMS:')
        for p in problems:
            print('  ' + p)
        return 1
    print('all checks passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
