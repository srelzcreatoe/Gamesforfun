#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Basiliskra - deterministic procedural sound synthesiser.

    python3 synth.py                 regenerate every .ogg, sound_definitions.json and docs/SOUNDS.md
    python3 synth.py --only roar     render only events whose id contains "roar" (json/doc untouched)
    python3 synth.py --spectro DIR   additionally write spectrogram PNGs (needs Pillow) into DIR
    python3 synth.py --work DIR      keep WAV intermediates in DIR (default: a temp dir that is removed)

Everything is ORIGINAL SYNTHESIS: numpy only, no samples, no downloads.  Every sound has a
fixed seed (crc32 of "<event>#<variant>"), so two runs produce identical audio.

Output format: mono, 44100 Hz, Ogg Vorbis (ffmpeg -c:a libvorbis -q:a 4 -ac 1).
Mono matters: Bedrock only spatialises mono sounds.

DSP approach (no scipy):
  * static filters are analog prototypes evaluated on the FFT bins (causal, no pre-ringing)
  * time-varying filters are STFT masks (formant sweeps, whooshes, opening low-passes)
  * voices are additive harmonic stacks weighted by moving formants (+ sub-harmonics, jitter)
  * impacts are modal sums (decaying sinusoids) + filtered noise transients
  * reverbs are convolutions with synthetic decaying-noise impulse responses
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import wave
import zlib
from multiprocessing import Pool

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

SR = 44100
TAU = 2.0 * np.pi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))          # .../basiliskra
RP_SOUNDS = os.path.join(ROOT, 'packs', 'RP', 'sounds')
OGG_DIR = os.path.join(RP_SOUNDS, 'basiliskra')
DEFS_PATH = os.path.join(RP_SOUNDS, 'sound_definitions.json')
DOC_PATH = os.path.join(ROOT, 'docs', 'SOUNDS.md')

PEAK_LIMIT_DB = -1.0      # hard requirement on the decoded .ogg
PRE_ENCODE_CEIL_DB = -2.0  # ceiling before the lossy encoder (Vorbis may overshoot a little)
HIGHPASS_HZ = 28.0


# =====================================================================================
# 1. basic helpers
# =====================================================================================

def N(d):
    return int(round(d * SR))


def T(d):
    return np.arange(N(d)) / SR


def dbg(v):
    return 10.0 ** (v / 20.0)


def todb(v):
    return 20.0 * math.log10(max(float(v), 1e-12))


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0


def rng_for(tag):
    return np.random.default_rng(zlib.crc32(tag.encode('utf-8')))


def pow2(n):
    return 1 << int(max(int(n) - 1, 1)).bit_length()


def fit(x, n):
    if len(x) >= n:
        return np.array(x[:n], dtype=float)
    return np.concatenate([np.asarray(x, float), np.zeros(n - len(x))])


def nr(x):
    """normalise to unit RMS"""
    return x / (rms(x) + 1e-12)


def pk(x):
    """normalise to unit peak"""
    return x / (np.abs(x).max() + 1e-12)


def curve(n, v):
    """scalar or array -> audio-rate array of length n"""
    if np.isscalar(v):
        return np.full(n, float(v))
    v = np.asarray(v, float)
    if len(v) == n:
        return v
    return np.interp(np.linspace(0.0, 1.0, n), np.linspace(0.0, 1.0, len(v)), v)


def fftconv(a, b):
    L = len(a) + len(b) - 1
    nfft = pow2(L)
    return np.fft.irfft(np.fft.rfft(a, nfft) * np.fft.rfft(b, nfft), nfft)[:L]


def conv(x, ker):
    """causal convolution, truncated to len(x)"""
    return fftconv(x, ker)[:len(x)]


def smooth(x, sec):
    k = int(sec * SR) | 1
    if k < 3:
        return x
    h = k // 2
    w = np.hanning(k + 2)[1:-1]
    w /= w.sum()
    return fftconv(np.pad(x, (h, h), mode='edge'), w)[2 * h:2 * h + len(x)]


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def env(d, pts, kind='lin', sm=0.0):
    """break-point envelope; pts = [(time_s, value), ...]; kind 'lin' or 'exp' (geometric)"""
    t = T(d)
    tp = np.array([p[0] for p in pts], float)
    vp = np.array([p[1] for p in pts], float)
    if kind == 'exp':
        y = np.exp(np.interp(t, tp, np.log(np.maximum(vp, 1e-5))))
    else:
        y = np.interp(t, tp, vp)
    if sm > 0:
        y = smooth(y, sm)
    return y


def hump(d, t0, t1, a=0.05, r=0.1, power=1.0):
    """smooth trapezoid that is 1 between t0+a and t1-r"""
    t = T(d)
    return (smoothstep((t - t0) / a) * smoothstep((t1 - t) / r)) ** power


def after(d, t0):
    """time since t0, clipped at 0, plus a 0/1 gate"""
    t = T(d) - t0
    return np.maximum(t, 0.0), (t >= 0).astype(float)


def fade(x, fi=0.003, fo=0.01):
    y = np.array(x, dtype=float)
    a = min(N(fi), len(y) // 2)
    b = min(N(fo), len(y) // 2)
    if a > 0:
        y[:a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if b > 0:
        y[-b:] *= 0.5 + 0.5 * np.cos(np.pi * (np.arange(b) + 1) / b)
    return y


def place(buf, x, t0, g=1.0):
    """mix x into buf starting at time t0 (seconds)"""
    i = int(round(t0 * SR))
    a = max(i, 0)
    b = min(i + len(x), len(buf))
    if b > a:
        buf[a:b] += g * x[a - i:b - i]
    return buf


# =====================================================================================
# 2. noise
# =====================================================================================

def white(n, rng):
    return rng.standard_normal(n)


def colored(n, rng, slope):
    """noise with a spectral tilt in dB/octave (-3 pink, -6 brown), unit RMS"""
    m = pow2(n)
    X = np.fft.rfft(rng.standard_normal(m))
    f = np.fft.rfftfreq(m, 1.0 / SR)
    f[0] = f[1]
    g = (np.maximum(f, 20.0) / 1000.0) ** (slope / 6.0206)
    g *= np.minimum(1.0, (f / 20.0) ** 2)
    y = np.fft.irfft(X * g, m)[:n]
    return y / (y.std() + 1e-12)


def lfo_noise(n, fc, rng):
    """smooth random modulator (gaussian low-passed noise), zero mean, unit std"""
    m = pow2(n + 16)
    X = np.fft.rfft(rng.standard_normal(m))
    f = np.fft.rfftfreq(m, 1.0 / SR)
    X *= np.exp(-0.5 * (f / fc) ** 2)
    X[0] = 0.0
    y = np.fft.irfft(X, m)[:n]
    return y / (y.std() + 1e-12)


def ulfo(n, fc, rng):
    """smooth random modulator in (0, 1)"""
    return 0.5 + 0.5 * np.tanh(lfo_noise(n, fc, rng))


# =====================================================================================
# 3. static filters: analog prototypes evaluated on FFT bins (causal responses)
# =====================================================================================

def _bwq(order):
    return [1.0 / (2.0 * math.cos(math.pi * (2 * k + 1) / (2.0 * order))) for k in range(order // 2)]


def LP(fc, order=2):
    def H(f):
        s = 1j * f / fc
        h = np.ones(len(f), dtype=complex)
        for q in _bwq(order):
            h = h / (s * s + s / q + 1.0)
        if order % 2:
            h = h / (s + 1.0)
        return h
    return H


def HP(fc, order=2):
    def H(f):
        s = 1j * f / fc
        h = np.ones(len(f), dtype=complex)
        for q in _bwq(order):
            h = h * (s * s) / (s * s + s / q + 1.0)
        if order % 2:
            h = h * s / (s + 1.0)
        return h
    return H


def BP(fc, q=1.0, g=1.0):
    def H(f):
        s = 1j * f / fc
        return g * (s / q) / (s * s + s / q + 1.0)
    return H


def PK(fc, q, gdb):
    a = dbg(gdb) - 1.0

    def H(f):
        s = 1j * f / fc
        return 1.0 + a * (s / q) / (s * s + s / q + 1.0)
    return H


def HS(fc, gdb):
    a = dbg(gdb)

    def H(f):
        s = 1j * f / fc
        return (1.0 + a * s) / (1.0 + s)
    return H


def LS(fc, gdb):
    a = dbg(gdb)

    def H(f):
        s = 1j * f / fc
        return (a + s) / (1.0 + s)
    return H


def BANK(specs, floor=0.0):
    """parallel resonators: specs = [(fc, q, gain), ...]"""
    def H(f):
        h = np.full(len(f), floor, dtype=complex)
        for fc, q, g in specs:
            s = 1j * f / fc
            h = h + g * (s / q) / (s * s + s / q + 1.0)
        return h
    return H


def COMB(delay, g):
    """feedback comb (metallic colouring)"""
    def H(f):
        return 1.0 / (1.0 - g * np.exp(-1j * TAU * f * delay))
    return H


def filt(x, *stages, pad=0.3, tail=False):
    n = len(x)
    m = n + N(pad)
    nfft = pow2(m)
    f = np.fft.rfftfreq(nfft, 1.0 / SR)
    H = np.ones(len(f), dtype=complex)
    for st in stages:
        H = H * st(f)
    y = np.fft.irfft(np.fft.rfft(x, nfft) * H, nfft)
    return y[:m].copy() if tail else y[:n].copy()


# =====================================================================================
# 4. time-varying filters (STFT masks)
# =====================================================================================

def stft_filter(x, gain_fn, nfft=1024, hop=None):
    """gain_fn(frame_times, bin_freqs) -> real gain matrix (frames, bins)"""
    hop = hop or nfft // 4
    win = 0.5 - 0.5 * np.cos(TAU * np.arange(nfft) / nfft)
    n = len(x)
    xp = np.concatenate([np.zeros(nfft), x, np.zeros(2 * nfft)])
    nfr = 1 + (len(xp) - nfft) // hop
    starts = hop * np.arange(nfr)
    frames = sliding_window_view(xp, nfft)[starts] * win
    S = np.fft.rfft(frames, axis=1)
    tt = (starts + nfft / 2.0 - nfft) / SR
    ff = np.fft.rfftfreq(nfft, 1.0 / SR)
    y = np.fft.irfft(S * gain_fn(tt, ff), nfft, axis=1) * win
    out = np.zeros(len(xp))
    for i, s0 in enumerate(starts):
        out[s0:s0 + nfft] += y[i]
    out /= (win * win).sum() / hop
    return out[nfft:nfft + n]


def _at(tt, arr):
    return np.interp(tt, np.arange(len(arr)) / SR, arr)


def _res(f, F, B):
    """magnitude of a 2-pole band-pass resonator, unity at F"""
    x = f / F
    q = F / B
    return (x / q) / np.sqrt((1.0 - x * x) ** 2 + (x / q) ** 2)


def fmask(n, formants, floor=0.0):
    """moving formants: [(F, B, gain), ...] each scalar or audio-rate array"""
    fm = [(curve(n, F), curve(n, B), curve(n, A)) for F, B, A in formants]

    def g(tt, ff):
        f = np.maximum(ff, 1.0)[None, :]
        G = np.full((len(tt), len(ff)), float(floor))
        for F, B, A in fm:
            G += _at(tt, A)[:, None] * _res(f, _at(tt, F)[:, None], _at(tt, B)[:, None])
        return G
    return g


def bandmask(n, fc, width_oct, floor=0.0):
    """gaussian band in log-frequency whose centre follows fc"""
    fc = curve(n, fc)
    w = curve(n, width_oct)

    def g(tt, ff):
        f = np.maximum(ff, 1.0)[None, :]
        c = _at(tt, fc)[:, None]
        return floor + np.exp(-0.5 * (np.log2(f / c) / (_at(tt, w)[:, None] * 0.5)) ** 2)
    return g


def lpmask(n, fc, order=2):
    fc = curve(n, fc)

    def g(tt, ff):
        return 1.0 / np.sqrt(1.0 + (ff[None, :] / _at(tt, fc)[:, None]) ** (2 * order))
    return g


def band_noise(d, rng, fc, width_oct, slope=-3.0):
    """noise in a moving log-gaussian band, unit RMS (whooshes, rushes, air)"""
    n = N(d)
    return nr(stft_filter(colored(n, rng, slope), bandmask(n, fc, width_oct)))


def formant_noise(d, rng, formants, slope=-3.0, floor=0.0):
    """noise through moving formants, unit RMS (breath, aspiration)"""
    n = N(d)
    return nr(stft_filter(colored(n, rng, slope), fmask(n, formants, floor)))


def swept_noise(fc, bw, rng):
    """narrow-band noise around a (moving) centre frequency: heterodyned low-pass noise"""
    n = len(fc)
    a = filt(rng.standard_normal(n), LP(bw / 2.0, 2))
    b = filt(rng.standard_normal(n), LP(bw / 2.0, 2))
    ph = TAU * np.cumsum(fc) / SR
    return nr(a * np.cos(ph) + b * np.sin(ph))


# =====================================================================================
# 5. oscillators, modal bodies, voices
# =====================================================================================

def phase(f):
    return TAU * np.cumsum(f) / SR


def sine(f, ph0=0.0):
    return np.sin(phase(f) + ph0)


def saw(f):
    """band-limited (polyBLEP) sawtooth, f = audio-rate frequency array"""
    dt = f / SR
    p = np.mod(np.cumsum(dt), 1.0)
    y = 2.0 * p - 1.0
    m1 = p < dt
    x = p[m1] / dt[m1]
    y[m1] -= x + x - x * x - 1.0
    m2 = p > 1.0 - dt
    x = (p[m2] - 1.0) / dt[m2]
    y[m2] -= x * x + x + x + 1.0
    return y


def fm(fc, ratio, index, ph0=0.0):
    return np.sin(phase(fc) + index * np.sin(phase(fc * ratio)) + ph0)


def modal(d, modes, pitch=None):
    """sum of decaying sinusoids; modes = [(freq, t60, amp), ...]; pitch = multiplier curve"""
    t = T(d)
    ph = TAU * t if pitch is None else TAU * np.cumsum(pitch) / SR
    y = np.zeros(len(t))
    for f, t60, a in modes:
        y += a * np.exp(-6.908 * t / t60) * np.sin(f * ph)
    return y


def thump(d, f_end, f_drop, tau, t60, drive=0.0):
    """pitched low thud: sine falling from f_end+f_drop to f_end with time constant tau"""
    t = T(d)
    y = np.sin(phase(f_end + f_drop * np.exp(-t / tau))) * np.exp(-6.908 * t / t60)
    if drive > 0:
        y = np.tanh(drive * y) / math.tanh(drive)
    return y


def burst(d, rng, tau, *stages):
    """exponentially decaying noise burst through filter stages"""
    t = T(d)
    x = rng.standard_normal(len(t)) * np.exp(-t / tau)
    return filt(x, *stages) if stages else x


def voice(d, f0, formants, rng, tilt=1.1, jitter=0.02, jit_fc=30.0, sub=0.0, shimmer=0.08,
          fmax=7000.0, floor=0.015, drift=0.0):
    """
    Additive creature voice: harmonics k*f0 (and sub-harmonics (k-0.5)*f0 for period-doubling
    roughness), each weighted by moving formant resonances.  f0 / formants / sub may be curves.
    """
    n = N(d)
    f0 = curve(n, f0)
    j = 1.0 + jitter * lfo_noise(n, jit_fc, rng)
    if drift:
        j = j * (1.0 + drift * lfo_noise(n, 1.5, rng))
    f0j = f0 * j
    ph = TAU * np.cumsum(f0j) / SR
    ic = np.unique(np.minimum(np.arange(0, n + 64, 64), n - 1))
    f0c = f0j[ic]
    fmc = [(curve(n, F)[ic], curve(n, B)[ic], curve(n, A)[ic]) for F, B, A in formants]
    subc = curve(n, sub)
    has_sub = bool(np.any(subc > 0))
    kmax = int(min(fmax * 1.3, 0.45 * SR) / max(float(f0.min()) * 0.9, 10.0))
    kmax = max(1, min(kmax, 240))
    ar = np.arange(n)

    def weight(fk):
        w = np.full(len(fk), float(floor))
        for F, B, A in fmc:
            w += A * _res(fk, F, B)
        w = w / (1.0 + (fk / fmax) ** 8)
        w[fk > 0.47 * SR] = 0.0
        return w

    out = np.zeros(n)
    for k in range(1, kmax + 1):
        out += np.interp(ar, ic, weight(k * f0c)) * k ** (-tilt) * np.sin(k * ph)
        if has_sub:
            kk = k - 0.5
            out += subc * np.interp(ar, ic, weight(kk * f0c)) * kk ** (-tilt) * np.sin(kk * ph + 1.3 * k)
    if shimmer:
        out = out * (1.0 + shimmer * lfo_noise(n, 45.0, rng))
    return out


# =====================================================================================
# 6. event generators: pulses, crackle, bubbles, grit
# =====================================================================================

def pulse_times(d, rate, rng, jitter=0.2, t0=0.0, t1=None):
    """quasi-periodic pulse times following a rate curve (Hz) with period jitter"""
    n = N(d)
    r = curve(n, rate)
    t1 = d if t1 is None else t1
    ts = []
    t = t0
    while t < t1:
        ts.append(t)
        rr = max(float(r[min(int(t * SR), n - 1)]), 0.5)
        t += (1.0 / rr) * float(np.clip(1.0 + jitter * rng.standard_normal(), 0.25, 3.0))
    return np.array(ts)


def poisson_times(d, rate, rng):
    """random event times with a time-varying mean rate (events / second)"""
    n = N(d)
    r = np.maximum(curve(n, rate), 0.0)
    rmax = float(r.max())
    if rmax <= 0:
        return np.zeros(0)
    cnt = int(rng.poisson(rmax * d))
    ts = np.sort(rng.random(cnt) * d)
    keep = rng.random(cnt) < r[np.minimum((ts * SR).astype(int), n - 1)] / rmax
    return ts[keep]


def impulses(n, times, amps=None):
    """impulse train with linear-interpolated (sub-sample) placement"""
    buf = np.zeros(n + 2)
    times = np.asarray(times, float)
    if len(times) == 0:
        return buf[:n]
    amps = np.ones(len(times)) if amps is None else np.asarray(amps, float)
    pos = times * SR
    i = np.floor(pos).astype(int)
    fr = pos - i
    ok = (i >= 0) & (i < n)
    np.add.at(buf, i[ok], amps[ok] * (1.0 - fr[ok]))
    np.add.at(buf, i[ok] + 1, amps[ok] * fr[ok])
    return buf[:n]


def pulse_env(d, times, tau, amps=None):
    """impulse train smeared into a decaying envelope (stick-slip, sputter), peak ~1"""
    n = N(d)
    L = N(tau * 7) + 2
    e = conv(impulses(n, times, amps), np.exp(-np.arange(L) / SR / tau))
    return e / (e.max() + 1e-12)


def crackle(d, rate, rng, lo=1500.0, hi=9000.0, click=0.0015, sigma=0.7, kernels=3):
    """sparse electric / tearing clicks: Poisson impulses x short noise kernels, band-limited"""
    n = N(d)
    rate = curve(n, rate)
    out = np.zeros(n)
    for _ in range(kernels):
        ts = poisson_times(d, rate / kernels, rng)
        amps = rng.lognormal(0.0, sigma, len(ts)) * rng.choice([-1.0, 1.0], len(ts))
        L = max(8, N(click * 4))
        ker = rng.standard_normal(L) * np.exp(-6.908 * np.arange(L) / SR / click)
        out += conv(impulses(n, ts, amps), ker)
    return filt(out, HP(lo, 2), LP(hi, 2))


def bubbles(d, rate, rng, lo=300.0, hi=2500.0, rise=0.5, cyc=(8.0, 20.0), big=0.5):
    """Minnaert-style bubbles: short sine chirps that rise in pitch while they decay"""
    n = N(d)
    out = np.zeros(n)
    for t0 in poisson_times(d, rate, rng):
        f0 = lo * (hi / lo) ** rng.random()
        t60 = rng.uniform(*cyc) / f0
        L = N(t60 * 1.15) + 8
        tt = np.arange(L) / SR
        f = f0 * (1.0 + rise * rng.uniform(0.3, 1.3) * tt / t60)
        g = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-6.908 * tt / t60) * np.minimum(1.0, tt / 0.0015)
        place(out, g, t0, (lo / f0) ** big * rng.uniform(0.35, 1.0))
    return out


def crunch(d, dens, rng, lo=700.0, hi=6500.0, bands=5, grain=(0.002, 0.009)):
    """gravel / grit: several noise bands, each gated by its own sparse grain envelope"""
    n = N(d)
    dens = curve(n, dens)
    out = np.zeros(n)
    for b in range(bands):
        fc = lo * (hi / lo) ** ((b + rng.random()) / bands)
        ts = poisson_times(d, dens / bands, rng)
        amps = rng.lognormal(0.0, 0.6, len(ts))
        tau = rng.uniform(*grain) * (1200.0 / fc) ** 0.3
        L = N(tau * 7) + 2
        e = conv(impulses(n, ts, amps), np.exp(-np.arange(L) / SR / tau))
        out += filt(rng.standard_normal(n), BP(fc, 1.6)) * e
    return out


# =====================================================================================
# 7. spaces
# =====================================================================================

def reverb(x, rng, t60=0.6, wet=0.25, lp=6000.0, hp=150.0, pre=0.008, er=0, er_span=0.03, tail=0.0):
    """convolution reverb with a synthetic impulse response (decaying filtered noise + taps)"""
    L = N(t60 * 1.3)
    t = np.arange(L) / SR
    ir = rng.standard_normal(L) * np.exp(-6.908 * t / t60)
    ir = filt(ir, LP(lp, 2), HP(hp, 2), pad=0.05)
    ir /= math.sqrt(float(np.sum(ir * ir))) + 1e-12
    for k in range(er):
        i = int(rng.uniform(0.002, er_span) * SR)
        if i < L:
            ir[i] += 0.55 * (0.8 ** k) * rng.choice([-1.0, 1.0])
    ir /= math.sqrt(float(np.sum(ir * ir))) + 1e-12
    n = len(x)
    m = n + N(tail)
    full = fftconv(x, ir)
    p = N(pre)
    w = np.zeros(m)
    seg = full[:max(0, m - p)]
    w[p:p + len(seg)] = seg
    y = np.zeros(m)
    y[:n] = x
    return y + wet * w


def underwater(x, rng, fc=900.0, order=4, wet=0.28, t60=0.35):
    """heard through water: steep low-pass, boxy low-mid resonances, short dark dense reverb"""
    y = filt(x, LP(fc, order), PK(260.0, 1.2, 3.0), PK(520.0, 2.0, 2.0))
    return reverb(y, rng, t60=t60, wet=wet, lp=fc * 1.2, hp=80.0, pre=0.004)


# =====================================================================================
# 8. mastering
# =====================================================================================

def limiter(x, ceil, win=0.004):
    """look-ahead peak limiter (min-filtered then smoothed gain): never exceeds ceil"""
    k = N(win) | 1
    h = k // 2
    need = np.minimum(1.0, ceil / np.maximum(np.abs(x), 1e-9))
    v = sliding_window_view(np.pad(need, (h, h), mode='edge'), k).min(axis=1)
    w = np.hanning(k + 2)[1:-1]
    w /= w.sum()
    g = np.convolve(np.pad(v, (h, h), mode='edge'), w, mode='valid')
    return x * g, float(g.min())


def finalize(x, dur, rms_db, fi=0.003, fo=0.012, loop=False):
    """trim, high-pass (DC/subsonic), fade, loudness-normalise to a target RMS, limit"""
    n = N(dur)
    x = fit(np.asarray(x, float), n)
    info = {}
    if loop:
        # circular filtering keeps the buffer exactly periodic
        f = np.fft.rfftfreq(n, 1.0 / SR)
        X = np.fft.rfft(x) * HP(HIGHPASS_HZ, 2)(f)
        X[0] = 0.0
        x = np.fft.irfft(X, n)
        info['seam'] = float(abs(x[0] - x[-1]) / (np.percentile(np.abs(np.diff(x)), 99) + 1e-12))
    else:
        x = filt(x, HP(HIGHPASS_HZ, 2))
    x = x - x.mean()
    x = fade(x, fi, fo)
    ceil = dbg(PRE_ENCODE_CEIL_DB)
    gr = 1.0
    for _ in range(3):
        x = x * (dbg(rms_db) / (rms(x) + 1e-12))
        if np.abs(x).max() <= ceil:
            break
        x, g = limiter(x, ceil)
        gr *= g
    p = float(np.abs(x).max())
    if p > ceil:
        x = x * (ceil / p)
    info['gr_db'] = todb(gr)
    return x, info


# =====================================================================================
# 9. THE MOTIF - one dull, low, slightly hollow body-knock (a mallet on a waterlogged hull)
# =====================================================================================
#
# knock_body() is seeded only by the variant index, NOT by the event name, so
# basiliskra.knock.gill N and basiliskra.knock.vent N contain the *same* body
# (same fundamental, same overtone ratios, same click).  Only the "room" differs:
# gill = heard through water, vent = dry and hot with a steam burst and a ping.

KNOCK_F0 = (112.0, 105.0, 118.0)     # fundamentals of the three variants (Hz)
PRE = 0.005                          # impacts start 5 ms in, so the fade-in never eats a transient


def knock_body(v, d=0.36, droop=0.0):
    r = rng_for('knock_body#%d' % v)
    f0 = KNOCK_F0[v - 1]
    t = T(d)

    def j():
        return 1.0 + 0.012 * r.standard_normal()

    def a():
        return 1.0 + 0.12 * r.standard_normal()

    # struck slightly sharp, settles within ~30 ms; optional slow droop (water loading)
    pitch = 1.0 + 0.16 * np.exp(-t / 0.011) - droop * (t / d)
    modes = [(f0, 0.30, 1.00),
             (f0 * 1.52 * j(), 0.17, 0.20 * a()),
             (f0 * 2.07 * j(), 0.15, 0.36 * a()),      # hollow partial: air inside the hull
             (f0 * 2.93 * j(), 0.10, 0.16 * a()),
             (f0 * 3.64 * j(), 0.075, 0.11 * a()),
             (f0 * 5.20 * j(), 0.05, 0.07 * a())]
    body = modal(d, modes, pitch)
    puff = burst(d, r, 0.02, BP(f0 * 2.07, 3.0), LP(650.0, 2))       # cavity puff
    thud = burst(d, r, 0.008, LP(170.0, 2))                           # mallet contact
    clk = burst(d, r, 0.0022, BP(1450.0, 1.1), HP(450.0, 2))          # woody click
    wood = modal(d, [(760.0 * j(), 0.036, 0.5), (1185.0 * j(), 0.028, 0.4), (1900.0 * j(), 0.02, 0.25)])
    y = pk(body) + 0.30 * pk(puff) + 0.30 * pk(thud) + 0.20 * pk(clk) + 0.12 * pk(wood)
    return y * np.minimum(1.0, t / 0.0012)


def s_knock_gill(v, rng):
    d = 0.35
    n = N(d)
    y = np.zeros(n)
    place(y, knock_body(v, 0.34, droop=0.07), PRE)
    y = filt(y, LP(900.0, 4), PK(230.0, 1.5, 2.5))
    y = reverb(y, rng, t60=0.2, wet=0.22, lp=800.0, hp=70.0, pre=0.006)
    bub = bubbles(d, env(d, [(0, 0), (0.07, 0), (0.1, 60), (0.2, 35), (0.32, 0), (d, 0)]), rng, 380.0, 1150.0, rise=0.6)
    bub = filt(bub, LP(1300.0, 2))
    return pk(y) + 0.07 * pk(bub)


def s_knock_vent(v, rng):
    d = 0.45
    n = N(d)
    y = np.zeros(n)
    place(y, knock_body(v, 0.36), PRE)
    y = pk(y)
    ts, gate = after(d, PRE + 0.006)
    fc = 2600.0 + 4200.0 * np.exp(-ts / 0.2)
    hiss = stft_filter(white(n, rng), bandmask(n, fc, 1.1), nfft=512)
    e = gate * np.minimum(1.0, ts / 0.004) * (0.7 * np.exp(-ts / 0.04) + 0.3 * np.exp(-ts / 0.15))
    hiss = hiss * e * (1.0 + 0.35 * lfo_noise(n, 70.0, rng))
    jj = 1.0 + 0.012 * (v - 2)
    ping = np.zeros(n)
    place(ping, modal(0.42, [(2140.0 * jj, 0.30, 1.0), (3370.0 * jj, 0.2, 0.6), (5230.0 * jj, 0.11, 0.35)]), PRE)
    return y + 0.32 * pk(hiss) + 0.05 * pk(ping)


# =====================================================================================
# 10. arrival / rift
# =====================================================================================

def s_boat_knock(v, rng):
    d = 0.4
    n = N(d)
    f = (176.0, 158.0, 197.0)[v - 1]

    def hit(scale, bright):
        def j():
            return 1.0 + 0.02 * rng.standard_normal()
        dd = 0.3
        t = T(dd)
        fs = f * scale
        modes = [(fs, 0.2, 1.0), (fs * 1.71 * j(), 0.15, 0.55), (fs * 2.43 * j(), 0.11, 0.5),
                 (fs * 3.6 * j(), 0.08, 0.3 * bright), (fs * 5.1 * j(), 0.055, 0.22 * bright),
                 (fs * 7.3 * j(), 0.04, 0.12 * bright)]
        h = pk(modal(dd, modes, 1.0 + 0.05 * np.exp(-t / 0.008)))
        h = h + 0.3 * bright * pk(burst(dd, rng, 0.002, BP(2200.0, 0.9)))
        h = h + 0.35 * pk(burst(dd, rng, 0.007, LP(260.0, 2)))
        return h * np.minimum(1.0, t / 0.001)

    y = np.zeros(n)
    place(y, hit(1.0, 1.0), PRE)
    if v == 2:                                   # hull rebounds once
        place(y, hit(1.035, 0.7), PRE + 0.085, 0.38)
    if v == 3:                                   # double tap and a small rattle
        place(y, hit(0.97, 0.8), PRE + 0.052, 0.55)
        place(y, hit(1.02, 0.5), PRE + 0.13, 0.22)
    y = filt(y, PK(f * 0.74, 3.0, 5.0), PK(430.0, 2.0, 3.0), HS(5000.0, -4.0))   # hollow hull cavity
    return reverb(y, rng, t60=0.18, wet=0.1, lp=3500.0, hp=200.0, pre=0.01)


def s_rift_open(v, rng):
    d = 4.0
    n = N(d)
    t = T(d)
    rise = smoothstep((t - 0.3) / 3.1)
    f = 55.0 * 1.5 ** rise                                   # sub drone rising a perfect fifth
    swell = env(d, [(0, 0), (0.5, 0.3), (2.4, 0.65), (3.45, 1.0), (3.75, 0.55), (d, 0)], sm=0.03)
    drone = sine(f) + 0.5 * sine(2 * f * 1.004) + 0.28 * sine(3 * f * 0.997) + 0.45 * sine(f * 1.011)
    drone = drone + 0.25 * fm(2 * f, 1.5, 3.0 * rise) * rise
    drone = np.tanh(0.9 * drone) * swell * (1.0 + 0.12 * lfo_noise(n, 3.0, rng))
    drone = filt(drone, LP(700.0, 2))
    press = band_noise(d, rng, 60.0 * (200.0 / 60.0) ** rise, 1.3, slope=-6.0)
    press = press * env(d, [(0, 0.05), (2.0, 0.3), (3.45, 1.0), (3.6, 0.5), (d, 0.0)], sm=0.02) ** 1.3
    dens = env(d, [(0, 4), (1.0, 16), (2.5, 70), (3.4, 230), (3.6, 60), (d, 4)], 'exp')
    tear = crackle(d, dens, rng, lo=260.0, hi=3400.0, click=0.004, sigma=0.9) * env(d, [(0, 0.2), (3.4, 1.0), (d, 0.2)])
    slip = pulse_env(d, pulse_times(d, env(d, [(0, 11), (2.5, 34), (3.4, 62), (d, 20)], 'exp'), rng, jitter=0.5), 0.008)
    rip = band_noise(d, rng, env(d, [(0, 420), (3.4, 1500), (d, 700)], 'exp'), 1.2) * slip
    rip = rip * env(d, [(0, 0.05), (2.0, 0.4), (3.45, 1.0), (3.7, 0.3), (d, 0)])
    tb, gate = after(d, 3.42)                                # the seam gives: upward bloom + escaping bubbles
    bloom = band_noise(d, rng, 220.0 + 1800.0 * np.minimum(tb / 0.35, 1.0), 1.0)
    bloom = bloom * gate * np.exp(-tb / 0.14) * np.minimum(1.0, tb / 0.01)
    bub = bubbles(d, env(d, [(0, 2), (3.3, 8), (3.5, 70), (3.9, 20), (d, 0)]), rng, 250.0, 2000.0)
    y = 1.0 * nr(drone) + 0.75 * nr(press) + 0.45 * nr(tear) + 0.5 * nr(rip) + 0.3 * nr(bloom) + 0.25 * nr(bub)
    return underwater(y, rng, fc=2600.0, order=2, wet=0.3, t60=0.8)


# partials of the seam hum (Hz, level).  Close pairs beat at 1/3 Hz, 233/247 is a rough minor second.
HUM_PARTS = [(58.0, 1.0), (58.0 + 1.0 / 3.0, 0.8), (86.0 + 2.0 / 3.0, 0.45), (87.0, 0.32),
             (116.0 + 1.0 / 3.0, 0.34), (174.0, 0.2), (233.0, 0.12), (247.0, 0.11), (349.0 + 1.0 / 3.0, 0.05)]
HUM_WHISTLES = [(419.0, 1.0), (1127.0, 0.7), (1690.0, 0.4)]


def s_rift_hum(v, rng):
    """
    Seamless loop: everything is built *circularly* over exactly 3.000 s.  Every partial
    completes a whole number of cycles, noise and modulators are filtered with an FFT of
    exactly the loop length, so sample N-1 runs straight into sample 0.
    """
    d = 3.0
    n = N(d)
    t = T(d)
    fbin = np.fft.rfftfreq(n, 1.0 / SR)

    def clfo(fc):
        X = np.fft.rfft(rng.standard_normal(n)) * np.exp(-0.5 * (fbin / fc) ** 2)
        X[0] = 0.0
        y = np.fft.irfft(X, n)
        return y / y.std()

    def cfilt(x, *stages):
        H = np.ones(len(fbin), dtype=complex)
        for st in stages:
            H = H * st(fbin)
        return np.fft.irfft(np.fft.rfft(x) * H, n)

    y = np.zeros(n)
    for f, a in HUM_PARTS:
        fq = round(f * d) / d                              # whole cycles per loop
        y += a * np.sin(TAU * fq * t + rng.uniform(0, TAU)) * (1.0 + 0.22 * clfo(0.9))
    y *= 1.0 + 0.12 * np.sin(TAU * 29.0 * t)               # 29 Hz throb = 87 cycles per loop
    w = np.zeros(n)
    for fc, g in HUM_WHISTLES:                             # thin "seam" whistles
        w += g * nr(cfilt(rng.standard_normal(n), BP(fc, 45.0))) * (0.55 + 0.45 * np.tanh(clfo(1.3)))
    bed = nr(cfilt(rng.standard_normal(n), LP(180.0, 2), HP(35.0, 2))) * (1.0 + 0.3 * clfo(0.7))
    y = nr(y) + 0.16 * nr(w) + 0.3 * bed
    return cfilt(y, LP(2400.0, 2))


def s_rift_close(v, rng):
    d = 1.5
    n = N(d)
    t = T(d)
    ts = 0.55
    u = np.clip(t / ts, 0.0, 1.0)
    f = 760.0 * (55.0 / 760.0) ** (u ** 0.8)               # fast downward sweep
    e = env(d, [(0, 0), (0.04, 0.25), (0.5, 1.0), (ts, 1.0), (ts + 0.015, 0.0), (d, 0)])
    sweep = (0.5 * saw(f) + 0.3 * sine(1.5 * f) + sine(0.5 * f)) * e
    rush = band_noise(d, rng, 2.2 * f, 0.9) * e
    tc, g = after(d, ts)
    slc = filt(white(n, rng) * g * np.exp(-tc / 0.004), HP(2500.0, 2))        # wet slicing click
    zp = swept_noise(2000.0 * 3.5 ** np.minimum(tc / 0.025, 1.0), 1500.0, rng) * g * np.exp(-tc / 0.012)
    wetb = bubbles(d, env(d, [(0, 0), (ts, 0), (ts + 0.005, 170), (ts + 0.1, 40), (ts + 0.5, 6), (d, 0)]),
                   rng, 500.0, 3200.0)
    th = np.zeros(n)                                        # dull thump
    place(th, thump(0.8, 42.0, 55.0, 0.03, 0.55, drive=1.5), ts + 0.03)
    place(th, 0.5 * pk(burst(0.3, rng, 0.02, LP(160.0, 2))), ts + 0.03)
    rum = nr(filt(colored(n, rng, -6.0), LP(120.0, 2))) * g * np.exp(-tc / 0.3)
    y = 0.8 * nr(sweep) + 0.5 * nr(rush) + 3.0 * pk(slc) + 2.0 * pk(zp) + 1.5 * pk(wetb) + 4.0 * pk(th) + 0.3 * rum
    return underwater(y, rng, fc=3000.0, order=2, wet=0.25, t60=0.6)


def s_ram(v, rng):
    d = 1.6
    n = N(d)
    ti = 0.12
    heavy = (v == 2)
    boom = np.zeros(n)
    place(boom, thump(1.45, 32.0 if heavy else 40.0, 40.0 if heavy else 45.0, 0.07, 1.25 if heavy else 0.95, drive=2.0), ti)
    thud = np.zeros(n)
    place(thud, burst(0.5, rng, 0.05 if heavy else 0.04, LP(150.0, 2)), ti)
    fc = env(d, [(0, 110), (ti, 240), (ti + 0.15, 520), (0.8, 220), (d, 130)], 'exp')
    wh = band_noise(d, rng, fc, 1.4, slope=-4.0)            # pressure-wave whoosh
    wh = wh * env(d, [(0, 0), (ti - 0.01, 0.45), (ti + 0.1, 1.0), (0.8, 0.33), (d, 0)], sm=0.01)
    bub = bubbles(d, env(d, [(0, 0), (ti, 0), (ti + 0.05, 70), (0.7, 30), (d, 0)]), rng, 200.0, 1600.0)
    y = 4.0 * pk(boom) + 2.0 * pk(thud) + 1.0 * nr(wh) + 0.35 * nr(bub)
    if heavy:                                               # cracking overtone
        ct = ti + np.cumsum(rng.uniform(0.004, 0.016, 5))
        imp = impulses(n, ct, rng.uniform(0.5, 1.0, 5) * rng.choice([-1.0, 1.0], 5))
        ring = filt(imp, BANK([(310.0, 28.0, 1.0), (472.0, 32.0, 0.9), (742.0, 36.0, 0.8),
                               (1130.0, 30.0, 0.6), (1710.0, 26.0, 0.4)]))
        snap = filt(conv(imp, white(64, rng) * np.exp(-np.arange(64) / 20.0)), HP(700.0, 2))
        y = y + 1.6 * pk(ring) + 1.2 * pk(snap)
    return underwater(y, rng, fc=1900.0 if heavy else 1400.0, order=3, wet=0.3, t60=0.6)


def s_crossing(v, rng):
    d = 5.0
    n = N(d)
    bend = 2.0 ** (-1.25 * smoothstep((T(d) - 0.6) / 3.6))  # the rift hum bends down > an octave
    hum = np.zeros(n)
    for f, a in HUM_PARTS:
        hum += a * np.sin(phase(f * bend) + rng.uniform(0, TAU)) * (1.0 + 0.2 * lfo_noise(n, 0.9, rng))
    hum *= env(d, [(0, 0), (0.3, 0.8), (1.2, 1.0), (3.0, 0.5), (4.4, 0.08), (d, 0)], sm=0.03)
    wh = np.zeros(n)
    for fc, g in HUM_WHISTLES[:2]:
        wh += g * swept_noise(fc * bend, 16.0, rng) * (0.55 + 0.45 * np.tanh(lfo_noise(n, 1.3, rng)))
    wh *= env(d, [(0, 0), (0.3, 1.0), (2.2, 0.5), (3.6, 0.05), (d, 0)])
    surge = band_noise(d, rng, env(d, [(0, 45), (1.6, 150), (3.0, 70), (d, 50)], 'exp'), 1.5, slope=-6.0)
    surge = surge * env(d, [(0, 0), (0.9, 0.6), (1.6, 1.0), (2.6, 0.5), (4.2, 0.1), (d, 0)], sm=0.03)
    sub = sine(env(d, [(0, 50), (1.6, 46), (d, 34)], 'exp'))
    sub = sub * env(d, [(0, 0), (1.0, 0.6), (1.7, 1.0), (3.2, 0.35), (4.6, 0.0), (d, 0)], sm=0.03)
    tr, g = after(d, 3.85)                                  # release: soft exhale + bubble plume
    rel = band_noise(d, rng, 320.0, 1.6) * g * np.minimum(1.0, tr / 0.08) * np.exp(-tr / 0.35)
    bub = bubbles(d, env(d, [(0, 1), (1.5, 10), (3.8, 6), (3.95, 75), (4.5, 20), (d, 0)]), rng, 220.0, 1900.0)
    y = nr(hum) + 0.2 * nr(wh) + 1.1 * nr(surge) + 0.9 * nr(sub) + 0.35 * nr(rel) + 0.22 * nr(bub)
    y = reverb(y, rng, t60=1.4, wet=0.35, lp=1800.0, hp=60.0)
    return filt(y, LP(2300.0, 2))


# =====================================================================================
# 11. Form I - water (everything is heard through water: muffled, bubbly)
# =====================================================================================

def s_i_breath(v, rng):
    d = 3.0
    n = N(d)
    t = T(d)
    if v == 1:
        e = env(d, [(0, 0), (0.35, 0.8), (0.9, 1.0), (2.0, 0.6), (2.7, 0.12), (d, 0)], sm=0.04)
        f0 = 52.0
    else:
        e = env(d, [(0, 0), (0.25, 0.9), (0.8, 0.5), (1.25, 1.0), (2.3, 0.4), (2.8, 0.08), (d, 0)], sm=0.04)
        f0 = 46.0
    e = e * (1.0 + 0.12 * lfo_noise(n, 6.0, rng))
    air = formant_noise(d, rng, [(env(d, [(0, 390), (d, 300)]), 220.0, 1.0), (800.0, 400.0, 0.5), (1600.0, 700.0, 0.2)]) * e
    tone = voice(d, f0 * (1.0 - 0.12 * t / d), [(110.0, 80.0, 1.0), (240.0, 120.0, 0.6), (520.0, 250.0, 0.25)],
                 rng, tilt=1.3, jitter=0.05, sub=0.3, fmax=1200.0) * e ** 1.3
    bub = bubbles(d, 4.0 + 46.0 * np.maximum(e, 0.0) ** 1.5, rng, 220.0, 1800.0)
    y = 0.9 * nr(air) + 0.75 * nr(tone) + 0.5 * nr(bub)
    return underwater(y, rng, fc=1000.0, order=3, wet=0.25, t60=0.4)


def s_i_swim(v, rng):
    d = 2.0
    n = N(d)
    t = T(d)
    tp = 0.6 if v == 1 else 0.85
    e = env(d, [(0, 0), (tp, 1.0), (tp + 0.7, 0.5), (d, 0)], sm=0.08)
    e = e * (1.0 + 0.22 * np.sin(TAU * (1.1 if v == 1 else 1.4) * t + v))
    fc = env(d, [(0, 70), (tp, 215 if v == 1 else 180), (tp + 0.8, 120), (d, 80)], 'exp')
    w = band_noise(d, rng, fc, 1.4, slope=-4.5) * e
    rum = nr(filt(colored(n, rng, -6.0), LP(70.0, 2))) * e ** 0.7
    turb = band_noise(d, rng, fc * 4.0, 1.0) * e ** 2 * ulfo(n, 5.0, rng)      # eddies
    bub = bubbles(d, 9.0 * e, rng, 250.0, 1500.0)
    y = nr(w) + 0.7 * nr(rum) + 0.35 * nr(turb) + 0.18 * nr(bub)
    return underwater(y, rng, fc=750.0, order=3, wet=0.25, t60=0.45)


def s_i_surface(v, rng):
    d = 2.0
    n = N(d)
    tb = 0.45
    ts, g = after(d, tb)
    surge = band_noise(d, rng, env(d, [(0, 80), (tb, 300), (1.0, 150), (d, 110)], 'exp'), 1.4, slope=-5.0)
    surge = surge * env(d, [(0, 0), (tb - 0.05, 0.8), (tb + 0.05, 1.0), (1.1, 0.3), (d, 0)], sm=0.02)
    surge = filt(surge, LP(600.0, 2))
    brst = band_noise(d, rng, env(d, [(0, 1500), (tb, 1500), (tb + 0.2, 3600), (d, 2600)], 'exp'), 2.2, slope=-1.5)
    brst = brst * g * np.minimum(1.0, ts / 0.04) * np.exp(-ts / 0.16)
    hiss = filt(white(n, rng), HP(1500.0, 2), LP(9000.0, 2))                   # water sheeting off
    hiss = hiss * env(d, [(0, 0), (tb, 0), (tb + 0.15, 1.0), (1.2, 0.5), (d, 0)]) * (1.0 + 0.45 * lfo_noise(n, 30.0, rng))
    drops = bubbles(d, env(d, [(0, 0), (tb, 0), (tb + 0.2, 130), (1.4, 60), (d, 5)]), rng, 1200.0, 6000.0, rise=0.25)
    low = np.zeros(n)
    place(low, thump(0.7, 46.0, 22.0, 0.05, 0.45), tb - 0.02)
    return 0.9 * nr(surge) + 1.0 * nr(brst) + 0.5 * nr(hiss) + 0.45 * nr(drops) + 2.5 * pk(low)


def s_i_gill_catch(v, rng):
    d = 0.5
    n = N(d)
    ts = pulse_times(d, env(d, [(0, 44), (0.3, 19), (d, 19)]), rng, jitter=0.12, t0=PRE, t1=0.3)
    y = np.zeros(n)
    for t0 in ts:                                            # the flutter
        f = 430.0 * rng.uniform(0.85, 1.2)
        c = modal(0.06, [(f, 0.022, 1.0), (f * 2.15, 0.013, 0.5), (f * 3.5, 0.008, 0.3)])
        c = c + 0.3 * pk(burst(0.06, rng, 0.0015, HP(600.0, 2)))
        place(y, c, t0, 0.55 + 0.45 * rng.random())
    tcatch = float(ts[-1]) + 0.05                            # ...then it sticks open
    stick = pk(modal(0.16, [(150.0, 0.1, 1.0), (312.0, 0.055, 0.5), (640.0, 0.03, 0.3)],
                     1.0 + 0.15 * np.exp(-T(0.16) / 0.01)))
    stick = stick + 0.4 * pk(burst(0.16, rng, 0.002, BP(1400.0, 1.0)))
    place(y, stick, tcatch, 1.6)
    bub = bubbles(d, env(d, [(0, 25), (0.3, 25), (tcatch, 20), (tcatch + 0.02, 90), (d, 10)]), rng, 500.0, 1800.0)
    bed = band_noise(d, rng, 520.0, 1.2) * env(d, [(0, 0), (0.03, 1), (0.3, 0.6), (tcatch + 0.05, 0.2), (d, 0)])
    y = 3.0 * pk(y) + 0.45 * nr(bub) + 0.35 * nr(bed)
    return underwater(y, rng, fc=1300.0, order=3, wet=0.22, t60=0.2)


def s_i_bite(v, rng):
    d = 0.8
    n = N(d)
    ts_ = 0.2
    rush = band_noise(d, rng, env(d, [(0, 250), (ts_, 1300), (d, 350)], 'exp'), 1.3)
    rush = rush * env(d, [(0, 0), (ts_ - 0.02, 0.9), (ts_, 0.4), (ts_ + 0.03, 1.0), (0.5, 0.3), (d, 0)], sm=0.004)
    snap = np.zeros(n)
    for dt, a in ((0.0, 1.0), (0.009, 0.7)):                 # upper and lower rows of teeth
        c = pk(modal(0.12, [(820.0, 0.05, 1.0), (1340.0, 0.035, 0.7), (2150.0, 0.025, 0.5), (3300.0, 0.015, 0.3)]))
        c = c + 0.8 * pk(burst(0.12, rng, 0.003, HP(1200.0, 2)))
        place(snap, c, ts_ + dt, a)
    jaw = np.zeros(n)
    place(jaw, thump(0.4, 60.0, 38.0, 0.03, 0.2, drive=1.5) + 0.5 * pk(burst(0.4, rng, 0.012, LP(200.0, 2))), ts_)
    bub = bubbles(d, env(d, [(0, 0), (ts_, 0), (ts_ + 0.03, 95), (0.5, 40), (d, 0)]), rng, 300.0, 2500.0)
    y = nr(rush) + 4.5 * pk(snap) + 3.5 * pk(jaw) + 0.4 * nr(bub)
    return underwater(y, rng, fc=2400.0, order=2, wet=0.2, t60=0.3)


def s_i_sweep(v, rng):
    d = 1.2
    n = N(d)
    ts_ = 0.82
    tc, g = after(d, ts_)
    e = env(d, [(0, 0), (0.3, 0.15), (0.7, 0.7), (ts_, 1.0), (ts_ + 0.06, 0.45), (d, 0)], sm=0.01)
    wh = band_noise(d, rng, env(d, [(0, 90), (ts_, 650), (d, 200)], 'exp'), 1.5, slope=-4.0) * e
    rum = nr(filt(colored(n, rng, -6.0), LP(90.0, 2))) * e
    slap = filt(white(n, rng) * g * np.exp(-tc / 0.02), HP(300.0, 2), LP(4500.0, 2))
    th = np.zeros(n)
    place(th, thump(0.36, 48.0, 26.0, 0.03, 0.26, drive=1.5), ts_)
    bub = bubbles(d, env(d, [(0, 3), (ts_, 6), (ts_ + 0.02, 110), (d, 0)]), rng, 300.0, 2400.0)
    y = nr(wh) + 0.6 * nr(rum) + 3.5 * pk(slap) + 3.0 * pk(th) + 0.3 * nr(bub)
    return underwater(y, rng, fc=1800.0, order=2, wet=0.25, t60=0.35)


def s_i_spasm(v, rng):
    d = 2.5
    n = N(d)
    f0 = env(d, [(0, 58), (0.4, 66), (1.2, 57), (1.8, 72), (d, 46)], 'exp', sm=0.05)
    fmts = [(env(d, [(0, 190), (1.8, 240), (d, 180)]), 110.0, 1.0),
            (env(d, [(0, 430), (1.8, 540), (d, 400)]), 200.0, 0.7), (900.0, 350.0, 0.3)]
    amp = env(d, [(0, 0), (0.25, 0.8), (1.0, 0.9), (1.8, 1.0), (2.3, 0.3), (d, 0)], sm=0.03)
    g = voice(d, f0, fmts, rng, tilt=1.15, jitter=0.05,
              sub=env(d, [(0, 0.2), (1.0, 0.5), (1.8, 0.8), (d, 0.3)]), fmax=2500.0)
    trem_ph = phase(9.0 * (1.0 + 0.07 * lfo_noise(n, 1.5, rng)))            # the shudder, ~9 Hz
    depth = env(d, [(0, 0.15), (0.4, 0.75), (2.0, 0.8), (d, 0.4)])
    trem = 1.0 - depth * (0.5 + 0.5 * np.sin(trem_ph)) ** 1.5
    air = formant_noise(d, rng, fmts)
    bub = bubbles(d, 28.0 * amp * trem, rng, 250.0, 1600.0)
    y = (nr(g) + 0.3 * air) * amp * trem + 0.3 * nr(bub)
    return underwater(y, rng, fc=850.0, order=4, wet=0.3, t60=0.4)


def s_i_jam(v, rng):
    d = 2.0
    n = N(d)
    rate = env(d, [(0, 18), (0.5, 40), (1.0, 28), (1.5, 46), (d, 20)])
    ts = pulse_times(d, rate, rng, jitter=0.4)
    amps = rng.lognormal(0.0, 0.4, len(ts))
    creak = filt(impulses(n, ts, amps), BANK([(210.0, 12.0, 1.0), (345.0, 14.0, 0.8), (560.0, 12.0, 0.6),
                                             (930.0, 10.0, 0.4), (1480.0, 8.0, 0.25)]))
    grit = band_noise(d, rng, 700.0, 1.4) * pulse_env(d, ts, 0.012, amps)
    se = env(d, [(0, 0), (0.15, 0.8), (0.9, 1.0), (1.1, 0.5), (1.4, 1.0), (1.85, 0.6), (d, 0)], sm=0.02)
    f0 = env(d, [(0, 70), (0.8, 78), (1.5, 92), (1.9, 84), (d, 80)], 'exp', sm=0.05)
    groan = voice(d, f0, [(260.0, 90.0, 1.0), (610.0, 150.0, 0.8), (1250.0, 300.0, 0.35)], rng,
                  tilt=1.0, jitter=0.035, sub=0.35, fmax=3000.0)
    ge = env(d, [(0, 0), (0.3, 0.5), (1.5, 1.0), (1.85, 0.6), (d, 0)], sm=0.03) * (1.0 + 0.2 * lfo_noise(n, 12.0, rng))
    y = (0.9 * nr(creak) + 0.7 * nr(grit)) * se + 1.0 * nr(groan) * ge
    return underwater(y, rng, fc=1100.0, order=3, wet=0.25, t60=0.35)


def s_i_pull(v, rng):
    d = 1.2
    n = N(d)
    t = T(d)
    tc_ = 0.72
    tp = tc_ + 0.035
    e = env(d, [(0, 0.02), (tc_ - 0.25, 0.3), (tc_, 1.0), (d, 1.0)], 'exp') * smoothstep((tc_ + 0.006 - t) / 0.006)
    rush = band_noise(d, rng, env(d, [(0, 140), (tc_, 1500), (d, 1500)], 'exp'), 1.1) * e
    tone = sine(env(d, [(0, 90), (tc_, 520), (d, 520)], 'exp')) * e * (1.0 + 0.4 * np.sin(TAU * 28.0 * t))
    tq, g = after(d, tp)
    pop = np.zeros(n)
    place(pop, thump(0.3, 85.0, 140.0, 0.02, 0.12, drive=1.2) + 0.4 * pk(burst(0.3, rng, 0.002, HP(1500.0, 2))), tp)
    bub = bubbles(d, env(d, [(0, 0), (tp, 0), (tp + 0.01, 150), (tp + 0.2, 40), (d, 0)]), rng, 300.0, 2500.0)
    rel = nr(filt(colored(n, rng, -5.0), LP(250.0, 2))) * g * np.exp(-tq / 0.12)
    y = nr(rush) + 0.3 * nr(tone) + 4.0 * pk(pop) + 0.5 * nr(bub) + 0.5 * rel
    return underwater(y, rng, fc=1700.0, order=2, wet=0.25, t60=0.3)


def s_splash(v, rng):
    d = 0.6
    n = N(d)
    big = (v == 2)
    y = np.zeros(n)
    place(y, pk(burst(0.1, rng, 0.012, BP(3000.0, 0.7), HP(1200.0, 2))), PRE, 0.6)        # plip

    def bloop(f_a, f_b, dd=0.16):                           # the cavity closing
        tt = T(dd)
        f = f_a * (f_b / f_a) ** np.minimum(tt / 0.07, 1.0)
        return np.sin(phase(f)) * np.minimum(1.0, tt / 0.008) * np.exp(-6.908 * tt / 0.1)

    if big:
        place(y, bloop(230.0, 560.0, 0.2), PRE + 0.03, 1.0)
        place(y, bloop(340.0, 700.0), PRE + 0.14, 0.5)
    else:
        place(y, bloop(330.0, 880.0), PRE + 0.025, 1.0)
    drops = bubbles(d, env(d, [(0, 0), (0.04, 85 if big else 60), (0.2, 30), (0.5, 4), (d, 0)]), rng, 1500.0, 5500.0, rise=0.2)
    spray = filt(white(n, rng), HP(2500.0, 2)) * env(d, [(0, 0), (0.01, 1.0), (0.1, 0.4), (0.4, 0.05), (d, 0)])
    spray = spray * (1.0 + 0.4 * lfo_noise(n, 40.0, rng))
    return y + 0.35 * pk(drops) + 0.2 * pk(spray)


# =====================================================================================
# 12. Form II - shore (air, wet, laboured)
# =====================================================================================

def s_ii_breath(v, rng):
    d = 3.5
    n = N(d)
    if v == 1:
        e_in = hump(d, 0.1, 1.3, 0.35, 0.3)
        e_ex = hump(d, 1.6, 3.38, 0.18, 0.9)
        fw = (88.0, 74.0)
    else:                                                    # the inhale catches half way
        e_in = 0.8 * hump(d, 0.1, 0.55, 0.2, 0.12) + hump(d, 0.68, 1.36, 0.15, 0.3)
        e_ex = hump(d, 1.66, 3.42, 0.25, 1.1)
        fw = (97.0, 70.0)
    flut = 1.0 + 0.15 * lfo_noise(n, 9.0, rng)
    rasp = pulse_env(d, pulse_times(d, 55.0, rng, jitter=0.3), 0.006)
    inh = formant_noise(d, rng, [(env(d, [(0, 650), (1.4, 900), (d, 900)]), 300.0, 1.0),
                                 (env(d, [(0, 1500), (1.4, 1900), (d, 1900)]), 500.0, 0.7),
                                 (2800.0, 900.0, 0.4)], slope=-2.0) * e_in * (0.55 + 0.45 * rasp)
    exh = formant_noise(d, rng, [(env(d, [(0, 480), (1.6, 480), (d, 380)]), 260.0, 1.0),
                                 (env(d, [(0, 1150), (1.6, 1150), (d, 950)]), 450.0, 0.6),
                                 (2300.0, 800.0, 0.3)], slope=-3.5) * e_ex
    pt = pulse_times(d, env(d, [(0, 24), (1.6, 24), (d, 15)]), rng, jitter=0.35)          # phlegm rattle
    rat = filt(impulses(n, pt, rng.lognormal(0.0, 0.5, len(pt))),
               BANK([(340.0, 5.0, 1.0), (720.0, 6.0, 0.8), (1300.0, 5.0, 0.5), (2400.0, 4.0, 0.3)]))
    rat = rat * (e_ex + 0.25 * e_in)
    pops = bubbles(d, 14.0 * e_ex + 3.0 * e_in, rng, 500.0, 2200.0)
    whine = voice(d, env(d, [(0, fw[0]), (1.6, fw[0]), (d, fw[1])], 'exp'),
                  [(420.0, 150.0, 1.0), (1100.0, 300.0, 0.5)], rng, jitter=0.05, sub=0.5, fmax=3000.0) * e_ex ** 2
    wz = swept_noise(env(d, [(0, 830), (1.6, 830), (d, 640)], 'exp'), 40.0, rng) * e_ex * ulfo(n, 4.0, rng)
    y = (0.8 * nr(inh) + 1.0 * nr(exh)) * flut + 0.55 * nr(rat) + 0.3 * nr(pops) + 0.3 * nr(whine)
    y = y + (0.12 if v == 1 else 0.22) * nr(wz)
    return filt(y, HS(6000.0, -3.0))


def s_ii_claw(v, rng):
    d = 0.7
    n = N(d)
    tc_ = 0.28 if v == 1 else 0.22
    pt = pulse_times(d, env(d, [(0, 60), (tc_, 140), (d, 140)]), rng, jitter=0.35, t0=PRE, t1=tc_)
    amps = rng.lognormal(0.0, 0.4, len(pt))
    se = env(d, [(0, 0), (0.03, 0.5), (tc_ - 0.02, 1.0), (tc_, 0.15), (tc_ + 0.05, 0), (d, 0)])
    scr = filt(white(n, rng), HP(1800.0, 2), LP(8000.0, 2)) * pulse_env(d, pt, 0.003, amps) * se
    sq = filt(impulses(n, pt, amps), BANK([(2300.0 * (1.0 + 0.05 * (v - 1)), 8.0, 1.0), (3700.0, 10.0, 0.8),
                                          (5400.0, 8.0, 0.5)])) * se

    def j():
        return 1.0 + 0.03 * rng.standard_normal()

    clk = pk(modal(0.15, [(1240.0 * j(), 0.05, 1.0), (2130.0 * j(), 0.04, 0.8), (3420.0 * j(), 0.03, 0.6),
                          (5150.0 * j(), 0.02, 0.4), (640.0 * j(), 0.06, 0.6)]))
    clk = clk + 0.7 * pk(burst(0.15, rng, 0.002, HP(1000.0, 2))) + 0.6 * thump(0.15, 110.0, 40.0, 0.01, 0.1)
    y = np.zeros(n)
    place(y, clk, tc_)
    grav = crunch(d, env(d, [(0, 0), (tc_, 0), (tc_ + 0.01, 300), (tc_ + 0.15, 90), (d, 0)]), rng, 900.0, 7000.0)
    return 4.0 * pk(y) + 0.9 * nr(scr) + 0.6 * nr(sq) + 0.6 * nr(grav)


def s_ii_drag(v, rng):
    d = 1.6
    n = N(d)
    if v == 1:
        e = env(d, [(0, 0), (0.12, 0.7), (0.5, 1.0), (1.1, 0.85), (1.45, 0.3), (d, 0)], sm=0.03)
    else:                                                    # two heaves
        e = env(d, [(0, 0), (0.1, 0.9), (0.55, 0.55), (0.75, 1.0), (1.3, 0.5), (d, 0)], sm=0.03)
    slip = 0.55 + 0.45 * ulfo(n, 14.0, rng)
    grit = crunch(d, 520.0 * e * slip, rng, 500.0, 6500.0)
    mid = band_noise(d, rng, 450.0 * 2.0 ** (0.3 * lfo_noise(n, 3.0, rng)), 1.4) * e * slip
    low = nr(filt(colored(n, rng, -6.0), LP(110.0, 3))) * e * slip
    th = np.zeros(n)
    for t0 in pulse_times(d, 5.0, rng, jitter=0.5, t0=0.08, t1=1.35):                     # stones shifting
        a = rng.uniform(0.4, 1.0) * float(e[min(int(t0 * SR), n - 1)])
        place(th, thump(0.25, rng.uniform(55.0, 85.0), 30.0, 0.02, rng.uniform(0.1, 0.16)), t0, a)
    return 0.8 * nr(grit) + 0.6 * nr(mid) + 0.9 * nr(low) + 2.0 * pk(th)


def s_ii_rest(v, rng):
    d = 1.0
    n = N(d)
    y = np.zeros(n)
    place(y, thump(0.6, 44.0, 34.0, 0.03, 0.38, drive=1.5), 0.04, 1.0)
    place(y, pk(burst(0.3, rng, 0.03, LP(220.0, 2))), 0.04, 0.6)
    cr = crunch(d, env(d, [(0, 0), (0.04, 0), (0.05, 220), (0.25, 20), (0.5, 0), (d, 0)]), rng, 600.0, 5000.0)
    e = env(d, [(0, 0), (0.22, 0), (0.36, 1.0), (0.6, 0.6), (0.95, 0), (d, 0)], sm=0.02)
    ex = formant_noise(d, rng, [(env(d, [(0, 430), (d, 350)]), 240.0, 1.0), (1050.0, 450.0, 0.5), (2200.0, 800.0, 0.25)]) * e
    sigh = voice(d, env(d, [(0, 70), (d, 58)], 'exp'), [(300.0, 140.0, 1.0), (800.0, 300.0, 0.4)], rng,
                 jitter=0.04, sub=0.3, fmax=2000.0) * e
    return 4.0 * pk(y) + 0.35 * nr(cr) + 0.9 * nr(ex) + 0.25 * nr(sigh)


def s_ii_arc(v, rng):
    d = 0.5
    n = N(d)
    t = T(d)
    L = (0.14, 0.2, 0.11)[v - 1]
    fb = (110.0, 97.0, 128.0)[v - 1]
    t0 = PRE
    ts, g = after(d, t0)
    sn = np.zeros(n)
    place(sn, pk(burst(0.03, rng, 0.0012, HP(1200.0, 2))), t0, 1.0)
    if v == 3:                                               # re-strike
        place(sn, pk(burst(0.03, rng, 0.0012, HP(1200.0, 2))), t0 + 0.07, 0.8)
    gate = smooth((lfo_noise(n, 180.0, rng) > -0.3).astype(float), 0.001)                 # sputter
    el = smooth(g * (ts < L) * np.exp(-ts / (L * 0.8)), 0.002)
    buzz = np.abs(np.sin(TAU * fb * t)) ** 3
    pl = filt(white(n, rng), HP(1800.0, 2), PK(3200.0, 2.0, 6.0), PK(6000.0, 2.0, 4.0)) * (0.25 + 0.75 * buzz) * gate * el
    zap = sine(env(d, [(0, 2800), (t0, 2800), (t0 + L, 700), (d, 700)], 'exp')) * (0.3 + 0.7 * buzz) * el * gate
    ck = crackle(d, env(d, [(0, 0), (t0 + L * 0.8, 0), (t0 + L, 130), (0.36, 30), (d, 0)]), rng, lo=2000.0, hi=10000.0)
    body = np.zeros(n)
    place(body, thump(0.12, 120.0, 60.0, 0.01, 0.05), t0)
    return 3.0 * pk(sn) + 1.6 * pk(pl) + 0.5 * pk(zap) + 0.9 * pk(ck) + 0.9 * pk(body)


def s_ii_drink(v, rng):
    d = 2.5
    n = N(d)
    y = np.zeros(n)
    for t0 in (0.08, 0.6, 1.1, 1.62, 2.05):                 # five gulps
        t0 = t0 + rng.uniform(-0.03, 0.03)
        L = rng.uniform(0.3, 0.4)
        tt = T(L)
        e = (0.25 + 0.75 * (tt / L) ** 1.5) * smoothstep(tt / 0.03) * smoothstep((L - tt) / 0.015)
        sl = band_noise(L, rng, 380.0 * rng.uniform(3.8, 5.0) ** (tt / L), 0.8) * e      # slurp
        gb = bubbles(L, 75.0, rng, 160.0, 700.0, rise=0.8) * e                             # gurgle
        tg = T(0.1)
        gl = np.sin(phase(95.0 * 1.8 ** np.minimum(tg / 0.07, 1.0))) * np.exp(-6.908 * tg / 0.08) * np.minimum(1.0, tg / 0.005)
        a = rng.uniform(0.75, 1.0)
        place(y, sl, t0, 0.5 * a)
        place(y, pk(gb), t0, 1.3 * a)
        place(y, gl, t0 + L - 0.02, 1.6 * a)                                               # glug
    y = y + 0.5 * pk(bubbles(d, 4.0, rng, 1500.0, 4000.0, rise=0.15))                     # drips
    return reverb(y, rng, t60=0.55, wet=0.5, lp=4500.0, hp=150.0, pre=0.006, er=8, er_span=0.035)


def s_ii_growl(v, rng):
    d = 2.5
    n = N(d)
    f0 = env(d, [(0, 44), (0.5, 50), (1.6, 47), (d, 40)], 'exp', sm=0.05)
    fmts = [(env(d, [(0, 250), (1.2, 290), (d, 250)]), 120.0, 1.0),
            (env(d, [(0, 640), (1.2, 720), (d, 620)]), 220.0, 0.7), (1300.0, 400.0, 0.35), (2500.0, 700.0, 0.12)]
    g = voice(d, f0, fmts, rng, tilt=0.95, jitter=0.07, jit_fc=22.0, sub=0.6, fmax=5000.0)
    amp = env(d, [(0, 0), (0.3, 0.7), (1.2, 1.0), (2.0, 0.7), (d, 0)], sm=0.03) * (1.0 + 0.18 * lfo_noise(n, 7.0, rng))
    pt = pulse_times(d, env(d, [(0, 27), (d, 21)]), rng, jitter=0.3)
    rat = filt(impulses(n, pt, rng.lognormal(0.0, 0.5, len(pt))), BANK([(900.0, 6.0, 1.0), (1600.0, 7.0, 0.7), (2700.0, 6.0, 0.4)]))
    wetp = bubbles(d, 12.0, rng, 400.0, 1800.0)
    air = formant_noise(d, rng, fmts)
    y = (nr(g) + 0.3 * nr(rat) + 0.15 * nr(wetp) + 0.25 * air) * amp
    return np.tanh(0.5 * y) * 2.0


def s_mutate(v, rng):
    d = 4.0
    n = N(d)
    rate = env(d, [(0, 10), (1.5, 26), (3.0, 58), (3.6, 80), (d, 30)], 'exp')
    pt = pulse_times(d, rate, rng, jitter=0.45)
    amps = rng.lognormal(0.0, 0.45, len(pt))
    se = env(d, [(0, 0), (0.2, 0.6), (3.4, 1.0), (d, 0)], sm=0.02)
    stretch = filt(impulses(n, pt, amps), BANK([(310.0, 9.0, 1.0), (540.0, 10.0, 0.8), (880.0, 9.0, 0.6),
                                               (1420.0, 8.0, 0.4), (2300.0, 7.0, 0.2)])) * se           # wet stretching
    sq = formant_noise(d, rng, [(500.0 * 2.0 ** (0.5 * lfo_noise(n, 3.0, rng)), 180.0, 1.0),
                                (1400.0 * 2.0 ** (0.4 * lfo_noise(n, 4.0, rng)), 300.0, 0.7)])
    sq = sq * (0.35 + 0.65 * ulfo(n, 6.0, rng)) * se                                                    # squelch
    wetb = bubbles(d, 26.0 * se, rng, 300.0, 1800.0)
    pops = np.zeros(n)                                                                                   # cracking pops
    for t0 in np.sort(0.35 + 3.2 * rng.random(10 if v == 1 else 14) ** 0.7):
        f1 = rng.uniform(700.0, 1400.0)
        c = pk(modal(0.12, [(f1, 0.03, 1.0), (f1 * 1.7, 0.02, 0.7), (f1 * 2.9, 0.012, 0.5)]))
        c = c + 0.8 * pk(burst(0.12, rng, 0.002, HP(1500.0, 2))) + 0.7 * thump(0.12, rng.uniform(120.0, 200.0), 60.0, 0.008, 0.05)
        place(pops, c, t0, rng.uniform(0.5, 1.0))
    if v == 1:
        f0 = env(d, [(0, 58), (0.9, 60), (2.4, 88), (3.4, 138), (3.75, 120), (d, 95)], 'exp', sm=0.04)
    else:
        f0 = env(d, [(0, 48), (1.1, 50), (2.6, 72), (3.5, 112), (3.8, 96), (d, 80)], 'exp', sm=0.04)
    fmts = [(env(d, [(0, 340), (0.9, 360), (3.4, 720), (d, 520)]), 160.0, 1.0),
            (env(d, [(0, 900), (3.4, 1550), (d, 1200)]), 260.0, 0.8),
            (env(d, [(0, 2600), (3.4, 3000), (d, 2700)]), 450.0, 0.35)]
    bel = voice(d, f0, fmts, rng, tilt=1.0, jitter=0.04,
                sub=env(d, [(0, 0.2), (2.5, 0.4), (3.3, 0.9), (d, 0.5)]), fmax=6000.0)                  # pained rising bellow
    ab = env(d, [(0, 0.0), (0.9, 0.05), (2.0, 0.35), (3.3, 1.0), (3.7, 0.7), (d, 0)], sm=0.03) * (1.0 + 0.1 * lfo_noise(n, 8.0, rng))
    air = formant_noise(d, rng, fmts)
    y = 0.5 * nr(stretch) + 0.4 * nr(sq) + 0.2 * nr(wetb) + 2.6 * pk(pops) + 1.6 * (nr(bel) + 0.3 * air) * ab
    return np.tanh(0.45 * y) / 0.45


def s_bell_pin(v, rng):
    d = 1.0
    n = N(d)
    t = T(d)
    f = 233.0
    parts = [(1.0, 0.30, 0.5), (2.0, 0.26, 1.0), (2.4, 0.22, 0.8), (3.0, 0.17, 0.6), (4.0, 0.14, 0.9),
             (5.33, 0.10, 0.5), (6.6, 0.07, 0.4), (8.4, 0.05, 0.3), (10.9, 0.035, 0.2)]
    tt = T(0.6)
    bell = modal(0.6, [(f * r, t60, a) for r, t60, a in parts])                           # every partial dead by 0.3 s
    bell = bell * (1.0 - 0.55 * np.abs(np.sin(TAU * 71.0 * tt)) ** 4 * np.exp(-tt / 0.08))  # buzzing against the claw
    clunk = 0.8 * pk(burst(0.6, rng, 0.003, BP(3200.0, 0.8))) + 0.9 * thump(0.6, 120.0, 40.0, 0.012, 0.09)
    clunk = clunk + 0.6 * pk(modal(0.6, [(410.0, 0.06, 1.0), (640.0, 0.04, 0.7), (980.0, 0.03, 0.5)]))  # wooden frame
    y = np.zeros(n)
    place(y, pk(bell) + 0.8 * clunk, PRE)
    y = y + 0.02 * np.sin(TAU * f * t) * np.exp(-6.908 * t / 0.9) * np.minimum(1.0, t / 0.01)   # faint residual hum
    return reverb(y, rng, t60=0.5, wet=0.12, lp=5000.0, hp=250.0, pre=0.012)


def s_scrape_far(v, rng):
    d = 3.0
    n = N(d)
    segs = [(0.15, 0.95), (1.45, 2.05), (2.45, 2.85)] if v == 1 else [(0.1, 0.5), (0.9, 1.75), (2.2, 2.9)]
    e = np.zeros(n)
    th = np.zeros(n)
    for a, b in segs:                                        # scrape - pause - scrape
        amp = rng.uniform(0.6, 1.0)
        e += amp * hump(d, a, b, 0.12, 0.22)
        place(th, thump(0.4, rng.uniform(52.0, 68.0), 20.0, 0.03, 0.25), a + 0.03, amp)
    slip = 0.5 + 0.5 * ulfo(n, 11.0, rng)
    grit = crunch(d, 380.0 * e * slip, rng, 400.0, 5000.0)
    mid = band_noise(d, rng, 420.0 * 2.0 ** (0.3 * lfo_noise(n, 2.0, rng)), 1.4) * e * slip
    low = nr(filt(colored(n, rng, -6.0), LP(120.0, 2))) * e * slip
    y = 0.8 * nr(grit) + 0.7 * nr(mid) + 0.6 * nr(low) + 1.2 * pk(th)
    y = filt(y, LP(1400.0, 2), HP(90.0, 2), PK(350.0, 1.0, 3.0))                           # distance / air absorption
    return reverb(y, rng, t60=1.3, wet=0.7, lp=1500.0, hp=120.0, pre=0.03)


# =====================================================================================
# 13. Form III - land (air, enormous)
# =====================================================================================

def s_iii_step(v, rng):
    d = 1.0
    n = N(d)
    ti = 0.03
    f0 = (50.0, 56.0, 45.0, 61.0)[v - 1]                     # four feet, four body pitches
    y = np.zeros(n)
    th = thump(0.9, f0, f0 * 1.1, 0.022, rng.uniform(0.42, 0.5), drive=1.6)
    th = th + 0.35 * thump(0.9, f0 * 1.62, f0 * 0.6, 0.015, 0.2)
    place(y, th, ti)
    slap = np.zeros(n)
    place(slap, pk(burst(0.3, rng, 0.02, LP(rng.uniform(330.0, 430.0), 2))), ti)
    dens = env(d, [(0, 0), (ti, 0), (ti + 0.008, 900), (ti + 0.12, 250), (ti + 0.35, 40), (0.8, 0), (d, 0)])
    cr = crunch(d, dens * rng.uniform(0.8, 1.2), rng, rng.uniform(500.0, 800.0), rng.uniform(5500.0, 7500.0))
    rum = nr(filt(colored(n, rng, -6.0), LP(85.0, 3)))       # ground rumble tail
    rum = rum * env(d, [(0, 0), (ti, 0), (ti + 0.05, 1.0), (0.5, 0.35), (d, 0)]) * (1.0 + 0.3 * lfo_noise(n, 9.0, rng))
    return 4.0 * pk(y) + 1.6 * pk(slap) + 1.3 * pk(cr) + 0.3 * rum


def s_iii_breath(v, rng):
    d = 4.0
    n = N(d)
    if v == 1:
        e_in = hump(d, 0.1, 1.55, 0.5, 0.35)
        e_ex = hump(d, 1.85, 3.9, 0.25, 1.2)
        fr = 31.0
    else:
        e_in = hump(d, 0.1, 1.3, 0.4, 0.3)
        e_ex = hump(d, 1.6, 3.92, 0.3, 1.4)
        fr = 27.0
    flut = 1.0 + 0.12 * lfo_noise(n, 7.0, rng)
    inh = formant_noise(d, rng, [(env(d, [(0, 260), (1.5, 340), (d, 340)]), 160.0, 1.0),
                                 (env(d, [(0, 620), (1.5, 760), (d, 760)]), 280.0, 0.6),
                                 (1300.0, 500.0, 0.3), (2600.0, 900.0, 0.1)], slope=-3.5) * e_in
    exh = formant_noise(d, rng, [(env(d, [(0, 300), (1.8, 300), (d, 220)]), 150.0, 1.0),
                                 (env(d, [(0, 560), (1.8, 560), (d, 470)]), 260.0, 0.7),
                                 (1150.0, 450.0, 0.3)], slope=-3.5) * e_ex
    rumv = voice(d, fr, [(70.0, 50.0, 1.0), (150.0, 80.0, 0.7), (320.0, 160.0, 0.3)], rng,
                 tilt=0.9, jitter=0.1, jit_fc=12.0, sub=0.3, fmax=900.0) * (0.3 * e_in + 1.0 * e_ex)   # chest rumble
    sub = nr(filt(colored(n, rng, -6.0), LP(60.0, 2))) * (0.6 * e_in + e_ex)
    return (0.75 * nr(inh) + 1.0 * nr(exh)) * flut + 0.8 * nr(rumv) + 0.3 * sub


def s_iii_window_breath(v, rng):
    d = 4.0
    n = N(d)
    e_in = hump(d, 0.2, 1.7, 0.6, 0.3)
    e_ex = hump(d, 2.05, 3.9, 0.2, 1.3)
    flut = 1.0 + 0.15 * lfo_noise(n, 18.0, rng)              # nostril turbulence
    inh = formant_noise(d, rng, [(env(d, [(0, 500), (1.7, 700), (d, 700)]), 350.0, 1.0),
                                 (env(d, [(0, 1400), (1.7, 1800), (d, 1800)]), 700.0, 0.8),
                                 (3200.0, 1500.0, 0.5), (6000.0, 3000.0, 0.25)], slope=-2.5) * e_in
    exh = formant_noise(d, rng, [(env(d, [(0, 350), (2.0, 350), (d, 280)]), 220.0, 1.0),
                                 (900.0, 500.0, 0.7), (2400.0, 1200.0, 0.4), (5000.0, 3000.0, 0.2)], slope=-3.0) * e_ex
    pt = np.concatenate([pulse_times(d, 16.0, rng, jitter=0.3, t0=1.25, t1=1.7),
                         pulse_times(d, env(d, [(0, 19), (2.6, 19), (d, 12)]), rng, jitter=0.3, t0=2.7, t1=3.8)])
    rat = filt(impulses(n, pt, rng.lognormal(0.0, 0.5, len(pt))),
               BANK([(280.0, 5.0, 1.0), (620.0, 6.0, 0.6), (1200.0, 5.0, 0.3)])) * (0.6 * e_in + e_ex)   # faint throat rattle
    chest = voice(d, 34.0, [(80.0, 60.0, 1.0), (170.0, 90.0, 0.5)], rng, tilt=1.0, jitter=0.08, jit_fc=10.0, fmax=600.0) * e_ex
    ticks = crackle(d, 2.0 * (e_in + e_ex), rng, lo=2000.0, hi=9000.0, click=0.001, sigma=0.4)           # moist ticks
    y = (0.8 * nr(inh) + 1.0 * nr(exh)) * flut + 0.22 * nr(rat) + 0.3 * nr(chest) + 0.6 * pk(ticks)
    return filt(y, LS(200.0, 4.0))                           # proximity


def s_iii_growl(v, rng):
    d = 3.0
    n = N(d)
    f0 = env(d, [(0, 52), (0.6, 49), (2.0, 48), (2.6, 56), (2.9, 68), (d, 66)], 'exp', sm=0.06)   # rises at the end
    fmts = [(env(d, [(0, 230), (2.0, 250), (2.9, 330), (d, 330)]), 120.0, 1.0),
            (env(d, [(0, 600), (2.0, 640), (2.9, 820), (d, 820)]), 220.0, 0.7),
            (env(d, [(0, 1400), (2.0, 1400), (2.9, 1700), (d, 1700)]), 400.0, 0.35), (2700.0, 700.0, 0.12)]
    g = voice(d, f0, fmts, rng, tilt=0.95, jitter=0.06, jit_fc=24.0,
              sub=env(d, [(0, 0.55), (2.0, 0.55), (2.9, 0.3), (d, 0.3)]), fmax=5500.0)
    amp = env(d, [(0, 0), (0.35, 0.75), (1.5, 0.9), (2.6, 1.0), (2.85, 0.8), (d, 0)], sm=0.03) * (1.0 + 0.15 * lfo_noise(n, 6.0, rng))
    chest = sine(f0) + 0.5 * sine(2.0 * f0)
    pt = pulse_times(d, 24.0, rng, jitter=0.3)
    rat = filt(impulses(n, pt, rng.lognormal(0.0, 0.5, len(pt))), BANK([(1100.0, 6.0, 1.0), (1900.0, 7.0, 0.6)]))
    air = formant_noise(d, rng, fmts)
    y = (nr(g) + 0.45 * nr(chest) + 0.15 * nr(rat) + 0.2 * air) * amp
    return np.tanh(0.5 * y) * 2.0


def s_iii_neck_turn(v, rng):
    d = 1.5
    n = N(d)
    rate = env(d, [(0, 9), (0.35, 34), (0.6, 14), (0.95, 42), (1.25, 18), (d, 8)], 'exp')
    pt = pulse_times(d, rate, rng, jitter=0.3, t0=0.02)      # stick-slip of leathery hide
    strain = env(d, [(0, 0.3), (0.35, 1.0), (0.6, 0.5), (0.95, 1.0), (1.3, 0.5), (d, 0.1)])
    amps = rng.lognormal(0.0, 0.4, len(pt)) * strain[np.minimum((pt * SR).astype(int), n - 1)]
    imp = impulses(n, pt, amps)
    lo = filt(imp, BANK([(360.0, 14.0, 1.0), (790.0, 16.0, 0.8), (1280.0, 14.0, 0.5), (2100.0, 12.0, 0.3), (3300.0, 10.0, 0.15)]))
    hi = filt(imp, BANK([(430.0, 14.0, 1.0), (940.0, 16.0, 0.8), (1520.0, 14.0, 0.5), (2500.0, 12.0, 0.3), (3900.0, 10.0, 0.15)]))
    x = smooth(strain, 0.03)
    creak = lo * (1.0 - x) + hi * x                          # resonances tighten with strain
    fr = band_noise(d, rng, env(d, [(0, 900), (0.95, 1400), (d, 900)], 'exp'), 1.2) * pulse_env(d, pt, 0.015, amps)
    body = band_noise(d, rng, 90.0, 1.0, slope=-6.0) * smooth(strain, 0.1)
    return nr(creak) + 0.35 * nr(fr) + 0.35 * nr(body)


def s_iii_club_plant(v, rng):
    d = 1.2
    n = N(d)
    t = T(d)
    ti = 0.03
    tc, g = after(d, ti)
    y = np.zeros(n)
    place(y, thump(1.0, 50.0, 85.0, 0.02, 0.5, drive=2.0), ti)
    crack = np.zeros(n)
    place(crack, pk(burst(0.3, rng, 0.006, HP(500.0, 2)))
          + 0.8 * pk(modal(0.3, [(310.0, 0.09, 1.0), (520.0, 0.07, 0.8), (870.0, 0.05, 0.6), (1400.0, 0.035, 0.4)])), ti)
    deb = crunch(d, env(d, [(0, 0), (ti, 0), (ti + 0.01, 700), (ti + 0.2, 150), (0.7, 10), (d, 0)]), rng, 600.0, 7000.0)
    sn = np.zeros(n)
    place(sn, pk(burst(0.03, rng, 0.0015, HP(2000.0, 2))), ti + 0.005)
    gate = smooth((lfo_noise(n, 150.0, rng) > 0.0).astype(float), 0.001)
    ee = g * env(d, [(0, 1.0), (ti, 1.0), (ti + 0.25, 0.5), (0.9, 0.1), (d, 0)])
    buzz = filt(white(n, rng), HP(1500.0, 2), PK(3500.0, 2.0, 5.0)) * np.abs(np.sin(TAU * 118.0 * t)) ** 3 * gate * ee
    ck = crackle(d, env(d, [(0, 0), (ti, 0), (ti + 0.005, 250), (0.5, 90), (1.1, 10), (d, 0)]), rng, lo=2000.0, hi=11000.0)
    rum = nr(filt(colored(n, rng, -6.0), LP(80.0, 3))) * g * np.exp(-tc / 0.3)
    return 4.0 * pk(y) + 2.2 * pk(crack) + 0.9 * pk(deb) + 1.6 * pk(sn) + 1.0 * pk(buzz) + 1.0 * pk(ck) + 0.3 * rum


def s_iii_club_swing(v, rng):
    d = 1.0
    n = N(d)
    e = env(d, [(0, 0), (0.2, 0.12), (0.42, 0.8), (0.5, 1.0), (0.62, 0.6), (0.85, 0.1), (d, 0)], sm=0.03)
    fc = env(d, [(0, 220), (0.5, 950), (d, 260)], 'exp', sm=0.05)
    wh = band_noise(d, rng, fc, 1.4, slope=-2.0) * e
    hv = band_noise(d, rng, fc / 5.5, 1.2, slope=-5.0) * e   # the weight of it
    wst = swept_noise(fc * 3.1, 140.0, rng) * e ** 2         # air through the spikes
    ck = crackle(d, 40.0 + 260.0 * e, rng, lo=2200.0, hi=11000.0) * (0.3 + 0.7 * e)
    fb = 118.0 * env(d, [(0, 1.08), (0.4, 1.06), (0.6, 0.94), (d, 0.93)])                 # doppler on the buzz
    bz = filt(white(n, rng), HP(1500.0, 2)) * np.abs(np.sin(phase(fb))) ** 3 * e
    return nr(wh) + 0.8 * nr(hv) + 0.15 * nr(wst) + 0.45 * nr(ck) + 0.3 * nr(bz)


def s_iii_charge_tick(v, rng):
    """Pitch-neutral 'tink' at A4 = 440 Hz with harmonic partials, so the game can re-pitch it cleanly."""
    d = 0.5
    n = N(d)
    f = 440.0
    dd = d - PRE
    tt = T(dd)
    tone = modal(dd, [(f * k, t60, a) for k, t60, a in
                      ((1, 0.38, 1.0), (2, 0.26, 0.55), (3, 0.18, 0.35), (5, 0.12, 0.22), (8, 0.07, 0.14), (12, 0.04, 0.08))])
    tone = tone + 0.5 * modal(dd, [(f * 1.004, 0.34, 1.0), (2 * f * 0.997, 0.22, 0.4)])   # slow shimmer beat
    tone = tone * (1.0 + 0.25 * np.sin(TAU * 55.0 * tt) * np.exp(-tt / 0.08)) * np.minimum(1.0, tt / 0.002)  # electric hum
    y = np.zeros(n)
    place(y, pk(tone), PRE)
    place(y, pk(burst(0.02, rng, 0.0008, HP(3000.0, 2))), PRE, 0.25)                       # ignition snap
    place(y, pk(burst(0.3, rng, 0.06, BP(3520.0, 6.0))), PRE, 0.05)                        # glow hiss
    return y


def s_iii_charge(v, rng):
    d = 5.0
    n = N(d)
    u = T(d) / d
    f = 55.0 * 3.0 ** u                                      # hum: 55 -> 165 Hz
    hum = 0.6 * saw(f) + 0.3 * saw(f * 1.5 * 1.002) + 0.5 * sine(0.5 * f)
    hum = stft_filter(hum, lpmask(n, 250.0 * 20.0 ** u, 2))  # brightness opens 250 Hz -> 5 kHz
    fw = 392.0 * 4.0 ** (u ** 1.1)                           # whine: 392 -> 1568 Hz
    whine = (sine(fw) + 0.5 * sine(fw * 2.005) + 0.35 * fm(fw * 1.5, 1.0, 2.0 * u)) * u ** 1.5
    throb = 1.0 - 0.3 * (0.5 + 0.5 * np.sin(phase(4.0 * 5.0 ** u)))                       # 4 -> 20 Hz
    ck = crackle(d, 2.0 * 150.0 ** u, rng, lo=2000.0, hi=11000.0) * (0.2 + 0.8 * u)       # 2 -> 300 clicks/s
    hiss = band_noise(d, rng, np.minimum(fw * 3.0, 9000.0), 1.0, slope=0.0) * u ** 2
    y = (nr(hum) + 0.6 * nr(whine)) * throb + 0.4 * nr(ck) + 0.2 * nr(hiss)
    return y * dbg(-24.0 * (1.0 - u) ** 1.2) * (1.0 + 0.05 * lfo_noise(n, 5.0, rng))


def s_iii_beam_raw(v, rng):
    d = 2.5
    n = N(d)
    drift = 2.0 ** (0.3 * lfo_noise(n, 5.0, rng) + 0.12 * lfo_noise(n, 30.0, rng))        # he cannot hold the pitch
    f = 300.0 * drift
    tone = saw(f) + saw(f * 1.013) + fm(f * 1.5, 2.0, 3.0)
    thr = env(d, [(0, -1.2), (1.2, -0.5), (2.0, 0.2), (d, 1.2)])
    gate = smooth(1.0 / (1.0 + np.exp(-(lfo_noise(n, 22.0, rng) - thr) * 8.0)), 0.002)    # sputter, gaps grow
    rough = pulse_env(d, pulse_times(d, 55.0 * 2.0 ** (0.4 * lfo_noise(n, 3.0, rng)), rng, jitter=0.4), 0.005)
    plasma = filt(colored(n, rng, -2.0), BANK([(420.0, 2.0, 1.0), (1100.0, 2.0, 0.8), (2600.0, 2.0, 0.6), (5200.0, 2.0, 0.4)]))
    plasma = plasma * (0.35 + 0.65 * rough)
    ck = crackle(d, 130.0, rng, lo=1800.0, hi=11000.0) * (1.25 - gate)
    low = sine(52.0 * drift ** 0.5) * (0.5 + 0.5 * rough)
    amp = env(d, [(0, 0), (0.008, 1.0), (0.08, 0.8), (1.5, 0.9), (2.2, 0.6), (d, 0)])
    y = (0.8 * nr(tone) + 1.0 * nr(plasma) + 0.5 * nr(low)) * gate + 0.45 * nr(ck)
    return np.tanh(0.8 * y * amp)


def s_iii_beam(v, rng):
    d = 3.5
    n = N(d)
    t = T(d)
    rel = 0.3
    tr = np.clip((t - (d - rel - 0.01)) / rel, 0.0, 1.0)
    drift = (1.0 + 0.004 * lfo_noise(n, 3.0, rng)) * (1.0 - 0.22 * tr ** 2)
    f1 = 370.0 * drift
    f2 = 370.0 * 1.0075 * drift
    saws = saw(f1) + saw(f2) + 0.5 * saw(f1 * 2.0 * 0.998)   # two detuned saws + octave
    fml = fm(f1 * 1.5, 2.0, 2.2 + 0.8 * lfo_noise(n, 8.0, rng))                           # FM layer a fifth up (555 Hz)
    tone = filt(0.6 * saws + 0.5 * fml, PK(1250.0, 2.0, 6.0), PK(2900.0, 2.5, 8.0), PK(5200.0, 2.0, 5.0), HP(200.0, 1))
    hiss = filt(white(n, rng), HP(4000.0, 2), PK(7200.0, 1.5, 6.0)) * (0.7 + 0.3 * ulfo(n, 40.0, rng))
    ck = crackle(d, 45.0, rng, lo=2500.0, hi=12000.0)
    low = sine(np.full(n, 46.0)) * (0.6 + 0.4 * np.sin(TAU * 11.5 * t)) + 0.3 * sine(np.full(n, 92.0))   # throb
    amp = np.minimum(1.0, t / 0.004) * (1.0 + 0.5 * np.exp(-t / 0.05)) * (1.0 + 0.05 * lfo_noise(n, 6.0, rng))
    amp = amp * (0.5 + 0.5 * np.cos(np.pi * tr))             # 0.3 s release
    onset = np.zeros(n)
    place(onset, pk(burst(0.15, rng, 0.02, HP(1500.0, 2))), 0.0, 1.5)
    place(onset, thump(0.4, 50.0, 30.0, 0.03, 0.2), 0.0, 1.5)
    y = (nr(tone) + 0.22 * nr(hiss) + 0.2 * nr(ck) + 0.45 * nr(low)) * (1.0 + 0.1 * np.sin(TAU * 23.0 * t)) * amp + onset
    return np.tanh(0.5 * y) / 0.5


def s_iii_beam_impact(v, rng):
    d = 1.2
    n = N(d)
    ti = 0.02
    big = (v == 2)
    tc, g = after(d, ti)
    crack = np.zeros(n)
    for dt, a in [(0.0, 1.0), (0.007, 0.7), (0.019, 0.5)] + ([(0.06, 0.9), (0.068, 0.5)] if big else []):
        place(crack, pk(burst(0.05, rng, 0.003, HP(700.0, 2))), ti + dt, a)

    def j():
        return 1.0 + 0.04 * rng.standard_normal()

    rock = np.zeros(n)
    place(rock, modal(0.3, [(430.0 * j(), 0.08, 1.0), (760.0 * j(), 0.06, 0.8), (1290.0 * j(), 0.05, 0.6),
                            (2210.0 * j(), 0.035, 0.5), (3650.0 * j(), 0.02, 0.3)]), ti)
    th = np.zeros(n)
    place(th, thump(0.5, 48.0 if big else 55.0, 30.0, 0.025, 0.28 if big else 0.22, drive=1.5), ti)
    ft = poisson_times(d, 600.0, rng)
    fry = pulse_env(d, ft, 0.002, rng.lognormal(0.0, 0.7, len(ft)))                        # frying grain
    siz = stft_filter(white(n, rng), bandmask(n, env(d, [(0, 7000), (d, 4200)], 'exp'), 1.6))
    siz = filt(siz, HP(2500.0, 2)) * fry * g * env(d, [(0, 1.0), (ti + 0.1, 0.6), (0.9 if big else 0.7, 0.2), (d, 0)])
    chips = np.zeros(n)                                      # spitting debris
    for t0 in ti + rng.exponential(0.28 if big else 0.22, 19 if big else 13):
        if t0 > d - 0.08:
            continue
        f = rng.uniform(1800.0, 5200.0)
        c = modal(0.08, [(f, rng.uniform(0.015, 0.04), 1.0), (f * 1.63, 0.015, 0.5), (f * 2.4, 0.01, 0.3)])
        place(chips, c, t0, rng.uniform(0.3, 1.0) * math.exp(-(t0 - ti) / 0.5))
    deb = crunch(d, env(d, [(0, 0), (ti, 500), (0.4, 100), (1.1, 5), (d, 0)]), rng, 1000.0, 8000.0)
    return 3.5 * pk(crack) + 2.0 * pk(rock) + 3.0 * pk(th) + 0.9 * nr(siz) + 1.6 * pk(chips) + 0.4 * nr(deb)


def s_iii_ground(v, rng):
    d = 1.5
    n = N(d)
    t = T(d)
    ta = 0.03
    tc, g = after(d, ta)
    sn = np.zeros(n)                                         # sharp arc crack into the rod
    place(sn, pk(burst(0.05, rng, 0.002, HP(1200.0, 2))), ta)
    bz = filt(white(n, rng), HP(1500.0, 2), PK(3000.0, 2.0, 5.0)) * np.abs(np.sin(TAU * 124.0 * t)) ** 3 * g * np.exp(-tc / 0.07)
    thock = np.zeros(n)
    place(thock, thump(0.15, 110.0, 60.0, 0.012, 0.06), ta)
    ping = np.zeros(n)                                       # the copper rod rings
    place(ping, modal(1.2, [(1830.0, 0.45, 1.0), (2917.0, 0.3, 0.6), (4710.0, 0.2, 0.4), (6920.0, 0.1, 0.2)]), ta)
    u = np.clip((t - 0.1) / 0.85, 0.0, 1.0)
    fwh = 1500.0 * (70.0 / 1500.0) ** (u ** 0.8)             # the charge whine collapsing
    ce = env(d, [(0, 0), (0.08, 0), (0.14, 1.0), (0.6, 0.6), (0.95, 0.25), (1.05, 0), (d, 0)], sm=0.01)
    col = (sine(fwh) + 0.5 * saw(fwh) + 0.6 * filt(saw(fwh / 4.0), LP(900.0, 2))) * ce
    tw = 0.92
    wh = np.zeros(n)                                         # ...ending in a whump as the glow dies
    place(wh, thump(0.55, 38.0, 45.0, 0.04, 0.45, drive=1.5), tw)
    place(wh, 0.6 * pk(burst(0.4, rng, 0.06, LP(200.0, 2))), tw)
    ck = crackle(d, env(d, [(0, 0), (ta, 200), (0.3, 60), (0.9, 15), (1.4, 0), (d, 0)]), rng, lo=2000.0, hi=11000.0)
    return 3.5 * pk(sn) + 1.5 * pk(bz) + 1.5 * pk(thock) + 0.25 * pk(ping) + 1.0 * nr(col) + 3.5 * pk(wh) + 0.7 * pk(ck)


def s_iii_fizzle(v, rng):
    d = 1.2
    n = N(d)
    ce = env(d, [(0, 0), (0.02, 0), (0.06, 0.8), (0.2, 1.0), (0.24, 1.0), (0.25, 0.0), (d, 0)], sm=0.002)
    ch = voice(d, env(d, [(0, 170), (0.24, 255), (d, 255)], 'exp'),
               [(600.0, 150.0, 1.0), (1500.0, 250.0, 0.8), (2600.0, 400.0, 0.4)], rng,
               tilt=1.0, jitter=0.08, jit_fc=40.0, sub=0.8, fmax=6000.0) * ce                # strangled choke
    out = 0.8 * ch / (rms(ch[ce > 0.1]) + 1e-12)

    def cough(a, lowf):
        dd = 0.3
        tt = T(dd)
        e = np.minimum(1.0, tt / 0.005) * np.exp(-6.908 * tt / 0.17)
        nz = formant_noise(dd, rng, [(env(dd, [(0, 450.0 * lowf), (dd, 340.0 * lowf)]), 200.0, 1.0),
                                     (1100.0 * lowf, 400.0, 0.8), (2300.0 * lowf, 700.0, 0.5)], slope=-2.0)
        vc = voice(dd, env(dd, [(0, 86.0 * lowf), (dd, 58.0 * lowf)], 'exp'),
                   [(400.0 * lowf, 180.0, 1.0), (1000.0 * lowf, 350.0, 0.6)], rng, jitter=0.12, sub=0.9, fmax=3000.0)
        return a * ((nz + 0.8 * nr(vc)) * e + 2.0 * thump(dd, 60.0, 30.0, 0.02, 0.08))

    place(out, cough(1.0, 1.0), 0.34)
    place(out, cough(0.6, 0.9), 0.68)
    sp = crackle(d, env(d, [(0, 60), (0.3, 25), (0.9, 6), (d, 0)]), rng, lo=2500.0, hi=10000.0)   # last sparks
    wz = formant_noise(d, rng, [(380.0, 250.0, 1.0), (900.0, 500.0, 0.5)]) * hump(d, 0.88, 1.19, 0.08, 0.2)
    return out + 0.5 * pk(sp) + 0.25 * wz


def s_iii_scatter(v, rng):
    d = 3.0
    n = N(d)
    t = T(d)
    y = np.zeros(n)
    sz = np.zeros(n)
    base = 1900.0 * (7200.0 / 1900.0) ** np.sort(rng.random(9))
    for fb in base:                                          # nine rays, each a slightly detuned pair
        for det in (1.0, 1.0 + rng.uniform(0.003, 0.008)):
            f = fb * det
            e = hump(d, rng.uniform(0.0, 0.28), rng.uniform(2.25, 2.5) + 0.5, 0.015, 0.5)
            e = e * (0.55 + 0.45 * np.tanh(lfo_noise(n, rng.uniform(6.0, 14.0), rng)))    # shimmer
            fv = f * (1.0 + 0.003 * np.sin(TAU * rng.uniform(4.0, 7.0) * t + rng.uniform(0, TAU)))
            a = (2500.0 / f) ** 0.5 * rng.uniform(0.6, 1.0)
            ph = phase(fv)
            y += a * e * (np.sin(ph) + (0.3 * np.sin(2.0 * ph) if 2.0 * f < 16000.0 else 0.0))
            sz += a * e * swept_noise(fv, f * 0.06, rng)     # each ray sizzles in its own narrow band
    span = hump(d, 0.0, 2.9, 0.05, 0.6)
    ck = crackle(d, 60.0 * span, rng, lo=3000.0, hi=12000.0)
    bed = filt(saw(np.full(n, 92.0)), LP(400.0, 2)) * span
    air = filt(white(n, rng), HP(6000.0, 2)) * span * (0.6 + 0.4 * ulfo(n, 20.0, rng))
    return nr(y) + 0.55 * nr(sz) + 0.25 * nr(ck) + 0.12 * nr(bed) + 0.12 * nr(air)


# =====================================================================================
# 14. misc
# =====================================================================================

def s_fin_pulse(v, rng):
    d = 0.4
    n = N(d)

    def beat(f_end, drop, t60):
        tt = T(0.2)
        x = np.sin(phase(f_end + drop * np.exp(-tt / 0.02)))
        return np.tanh(1.3 * x) * np.minimum(1.0, tt / 0.008) * np.exp(-6.908 * tt / t60)

    y = np.zeros(n)
    place(y, beat(58.0, 30.0, 0.12), 0.012, 1.0)             # lub
    place(y, beat(66.0, 26.0, 0.10), 0.165, 0.7)             # dub
    place(y, pk(burst(0.1, rng, 0.012, LP(260.0, 2))), 0.012, 0.25)
    place(y, pk(burst(0.1, rng, 0.010, LP(300.0, 2))), 0.165, 0.18)
    return filt(y, LP(700.0, 2), PK(130.0, 1.0, 3.0))


def s_hurt(v, rng):
    d = 1.0
    n = N(d)
    if v == 1:
        f0 = env(d, [(0, 92), (0.07, 138), (0.3, 112), (0.6, 84), (d, 70)], 'exp', sm=0.01)
        amp = env(d, [(0, 0), (0.03, 1.0), (0.25, 0.8), (0.55, 0.35), (0.9, 0.05), (d, 0)], sm=0.005)
        F1 = env(d, [(0, 420), (0.1, 720), (0.6, 480), (d, 420)])
        F2 = env(d, [(0, 1100), (0.1, 1650), (0.6, 1200), (d, 1100)])
    else:                                                    # double grunt
        f0 = env(d, [(0, 105), (0.06, 150), (0.22, 118), (0.3, 100), (0.36, 95), (0.42, 128), (0.7, 82), (d, 68)], 'exp', sm=0.01)
        amp = env(d, [(0, 0), (0.025, 1.0), (0.2, 0.7), (0.32, 0.12), (0.4, 0.85), (0.6, 0.4), (0.9, 0.04), (d, 0)], sm=0.005)
        F1 = env(d, [(0, 450), (0.08, 780), (0.3, 500), (0.42, 700), (0.7, 460), (d, 420)])
        F2 = env(d, [(0, 1200), (0.08, 1750), (0.3, 1300), (0.42, 1600), (0.7, 1200), (d, 1100)])
    fmts = [(F1, 180.0, 1.0), (F2, 280.0, 0.8), (2700.0, 500.0, 0.35)]
    g = voice(d, f0, fmts, rng, tilt=1.0, jitter=0.05, jit_fc=35.0,
              sub=env(d, [(0, 0.8), (0.15, 0.4), (0.6, 0.7), (d, 0.7)]), fmax=6500.0)
    air = formant_noise(d, rng, fmts, slope=-2.5)
    y = (nr(g) + 0.3 * air + 0.3 * nr(sine(0.5 * f0))) * amp
    th = np.zeros(n)
    place(th, thump(0.15, 70.0, 50.0, 0.012, 0.08), 0.004)
    return np.tanh(0.5 * (y + 1.2 * th)) * 2.0


# =====================================================================================
# 15. registry
# =====================================================================================
# (event id, variants, duration s, category, min_distance, max_distance, target RMS dBFS,
#  generator, finalize options, one-line synthesis note)

SPEC = [
    # ---- shared motif -------------------------------------------------------------
    ('basiliskra.knock.gill', 3, 0.35, 'hostile', 4, 56, -17.0, s_knock_gill, {},
     'Shared modal knock body (f0 112/105/118 Hz, hollow 2.07x partial, cavity puff, woody click) -> 4-pole 900 Hz low-pass, 7 % pitch droop, short dark reverb, quiet bubble-chirp flutter tail'),
    ('basiliskra.knock.vent', 3, 0.45, 'hostile', 4, 64, -17.0, s_knock_vent, {},
     'The identical knock body (same seed per variant), dry and full-band, + pressurised steam burst (noise band falling 6.8->2.6 kHz, 40/150 ms decay) + faint inharmonic ping (2.14/3.37/5.23 kHz)'),
    # ---- arrival / rift -----------------------------------------------------------
    ('basiliskra.rift.open', 1, 4.0, 'ambient', 8, 72, -15.0, s_rift_open, {},
     'Sub drone 55->82.5 Hz (rising fifth) with beating partials + FM, brown-noise pressure swell, granular tearing crackle (4->230 clicks/s) and stick-slip rip, bloom + bubbles at 3.4 s, through water'),
    ('basiliskra.rift.hum', 1, 3.0, 'ambient', 6, 48, -20.0, s_rift_hum, {'loop': True, 'fi': 0.003, 'fo': 0.003},
     'Circularly-built 3.000 s loop: 9 partials (58/87/116/174/233/247/349 Hz, 1/3 Hz beats) with whole cycles per loop, 29 Hz throb, three narrow noise whistles (419/1127/1690 Hz), low noise bed'),
    ('basiliskra.rift.close', 1, 1.5, 'ambient', 8, 72, -16.0, s_rift_close, {},
     'Saw/sine + noise sweep 760->55 Hz in 0.55 s, then high-passed slicing click + upward zip + bubble cluster, then 97->42 Hz thump with rumble tail'),
    ('basiliskra.boat_knock', 3, 0.4, 'block', 2, 32, -19.0, s_boat_knock, {},
     'Modal oak hull (f0 176/158/197 Hz, ratios 1/1.71/2.43/3.6/5.1/7.3) + click + contact thud, hull-cavity EQ peak, variants 2/3 add rebounds'),
    ('basiliskra.ram', 2, 1.6, 'hostile', 8, 80, -13.0, s_ram, {},
     'Sine boom falling 85->40 Hz (v2 72->32 Hz, longer) + low noise thud + moving-band pressure whoosh + bubbles, through water; v2 adds a 5-click crack ringing five inharmonic resonators (310-1710 Hz)'),
    ('basiliskra.crossing', 1, 5.0, 'ambient', 8, 96, -15.0, s_crossing, {'fo': 0.05},
     'The rift-hum partials and whistles bent down 1.25 octaves, brown-noise surge peaking at 1.6 s, 50->34 Hz sub, release exhale + bubble plume at 3.9 s, long dark reverb'),
    # ---- Form I -------------------------------------------------------------------
    ('basiliskra.i.breath', 2, 3.0, 'hostile', 4, 40, -19.0, s_i_breath, {'fo': 0.03},
     'Formant-filtered noise exhale + 52/46 Hz additive body tone with sub-harmonics + bubble stream following the exhale, through water (1 kHz low-pass)'),
    ('basiliskra.i.swim', 2, 2.0, 'hostile', 4, 40, -18.0, s_i_swim, {'fo': 0.03},
     'Moving-band low whoosh (70->215->120 Hz) + sub-70 Hz rumble + eddy noise + sparse bubbles, slow undulation, through water (750 Hz low-pass)'),
    ('basiliskra.i.surface', 1, 2.0, 'hostile', 6, 56, -16.0, s_i_surface, {'fo': 0.03},
     'Low surge rising to the break at 0.45 s, broadband burst, then sheeting hiss + dense high droplet chirps (1.2-6 kHz) and a 46 Hz body thump'),
    ('basiliskra.i.gill_catch', 1, 0.5, 'hostile', 2, 32, -19.0, s_i_gill_catch, {},
     'Train of ~8 small modal clicks slowing 44->19 Hz (the flutter), then one low 150 Hz "stick" knock, bubbles and a noise bed, through water'),
    ('basiliskra.i.bite', 1, 0.8, 'hostile', 6, 48, -16.0, s_i_bite, {},
     'Inrush band noise rising to the snap at 0.2 s, double modal tooth clack (0.8-3.3 kHz) + 98->60 Hz jaw thud, bubbles after, through water'),
    ('basiliskra.i.sweep', 1, 1.2, 'hostile', 6, 56, -15.0, s_i_sweep, {},
     'Crescendo band whoosh 90->650 Hz + rumble, slap (noise burst + 74->48 Hz thump) at 0.82 s, bubbles after, through water'),
    ('basiliskra.i.spasm', 1, 2.5, 'hostile', 6, 56, -15.0, s_i_spasm, {'fo': 0.03},
     'Additive groan (f0 58-72 Hz wandering, growing sub-harmonics, 3 moving formants) with ~9 Hz tremolo up to 80 % deep, breath noise, bubbles, through water (850 Hz low-pass)'),
    ('basiliskra.i.jam', 1, 2.0, 'hostile', 6, 48, -16.0, s_i_jam, {'fo': 0.03},
     'Stick-slip pulse train (18-46 Hz, jittered) ringing 5 wood/hide resonators + gritty band noise, strained groan f0 70->92 Hz, through water'),
    ('basiliskra.i.pull', 1, 1.2, 'hostile', 4, 40, -16.0, s_i_pull, {},
     'Suction: band noise + fluttering tone rising 140->1500 Hz, cut dead at 0.72 s, then pop (225->85 Hz) + bubble burst + low release, through water'),
    ('basiliskra.splash', 2, 0.6, 'neutral', 2, 24, -21.0, s_splash, {},
     'Plip noise transient + rising cavity "bloop" (330->880 Hz; v2 230->560 Hz plus a second bloop) + droplet chirps + spray hiss'),
    # ---- Form II ------------------------------------------------------------------
    ('basiliskra.ii.breath', 2, 3.5, 'hostile', 4, 40, -19.0, s_ii_breath, {'fo': 0.03},
     'Formant noise inhale (rasped by 55 Hz pulses) and exhale, phlegm rattle (15-24 Hz pulses through wet resonators), mucus pops, voiced distress whine 88->74 Hz, narrow wheeze; v2 inhale catches'),
    ('basiliskra.ii.claw', 2, 0.7, 'hostile', 4, 48, -17.0, s_ii_claw, {},
     'Accelerating stick-slip scrape (60->140 Hz pulses gating 1.8-8 kHz noise + squeal resonators), then hard modal clack (0.6-5.2 kHz) and scattering gravel grains'),
    ('basiliskra.ii.drag', 2, 1.6, 'hostile', 6, 64, -15.0, s_ii_drag, {'fo': 0.03},
     'Dense multi-band gravel grains + wandering mid scrape band + sub-110 Hz weight, all surging irregularly at ~14 Hz, plus 55-85 Hz stone thuds; v2 is two heaves'),
    ('basiliskra.ii.rest', 1, 1.0, 'hostile', 4, 48, -18.0, s_ii_rest, {'fo': 0.03},
     'Soft 78->44 Hz thump + low noise thud + a little gravel, then a formant-noise exhale with a faint voiced sigh'),
    ('basiliskra.ii.arc', 3, 0.5, 'hostile', 4, 48, -18.0, s_ii_arc, {},
     '1 ms broadband snap, sputtering plasma noise amplitude-modulated at 2x 110/97/128 Hz for 0.14/0.2/0.11 s, falling 2.8->0.7 kHz zap tone, trailing crackle; v3 re-strikes'),
    ('basiliskra.ii.drink', 1, 2.5, 'hostile', 4, 32, -18.0, s_ii_drink, {'fo': 0.03},
     'Five gulps: rising slurp band (380->1700 Hz), low gurgle bubbles (160-700 Hz), rising "glug" tone, drips; small stone-well reverb with early reflections'),
    ('basiliskra.ii.growl', 1, 2.5, 'hostile', 6, 56, -14.0, s_ii_growl, {'fo': 0.03},
     'Additive voice f0 40-50 Hz with strong jitter and sub-harmonics through 4 formants, wet rattle pulses (0.9-2.7 kHz), pops, breath noise, soft saturation'),
    ('basiliskra.mutate', 2, 4.0, 'hostile', 8, 72, -14.0, s_mutate, {'fo': 0.03},
     'Accelerating wet stretch (10->80 Hz stick-slip through 5 resonators), squelch noise with wandering formants, 10/14 bone-crack pops, bellow f0 58->138 Hz (v2 48->112 Hz) with opening formants and growing sub-harmonics'),
    ('basiliskra.bell_pin', 1, 1.0, 'block', 2, 32, -21.0, s_bell_pin, {'fo': 0.05},
     'Nine inharmonic bell partials on 233 Hz, all with T60 <= 0.3 s, buzzing (71 Hz) against the claw, metallic click + 160->120 Hz thud + wooden frame modes, faint residual hum'),
    ('basiliskra.scrape_far', 2, 3.0, 'ambient', 8, 72, -24.0, s_scrape_far, {'fo': 0.05},
     'Three irregular drag bursts (gravel grains + mid scrape + low thumps) low-passed at 1.4 kHz and drowned in a 1.3 s outdoor reverb'),
    # ---- Form III -----------------------------------------------------------------
    ('basiliskra.iii.step', 4, 1.0, 'hostile', 8, 96, -15.0, s_iii_step, {'fo': 0.03},
     'Saturated sine thud settling on 50/56/45/61 Hz (+1.62x body mode), low noise slap, gravel crunch burst decaying over 0.35 s, sub-85 Hz ground-rumble tail'),
    ('basiliskra.iii.breath', 2, 4.0, 'hostile', 6, 48, -17.0, s_iii_breath, {'fo': 0.03},
     'Large-cavity formant noise inhale/exhale (formants 220-760 Hz) over a 31/27 Hz pulsed chest rumble and sub-60 Hz noise'),
    ('basiliskra.iii.window_breath', 1, 4.0, 'hostile', 2, 24, -19.0, s_iii_window_breath, {'fo': 0.03},
     'Close, airy inhale/exhale (formants up to 6 kHz, 18 Hz nostril flutter), faint 12-19 Hz throat rattle, 34 Hz chest tone, moist ticks, proximity low shelf'),
    ('basiliskra.iii.growl', 1, 3.0, 'hostile', 8, 72, -13.0, s_iii_growl, {'fo': 0.03},
     'Additive voice f0 48-52 Hz rising to 68 Hz in the last 0.4 s with formants opening, sub-harmonics, chest sine, rattle, soft saturation'),
    ('basiliskra.iii.neck_turn', 1, 1.5, 'hostile', 4, 40, -18.0, s_iii_neck_turn, {'fo': 0.03},
     'Leather creak: stick-slip pulses (8-42 Hz, two strain peaks) through two cross-faded resonator banks, friction noise, low body movement'),
    ('basiliskra.iii.club_plant', 1, 1.2, 'hostile', 8, 96, -14.0, s_iii_club_plant, {'fo': 0.03},
     'Saturated 135->50 Hz thud + rock crack (noise + 4 modes) + debris grains, with electric snap, sputtering 2x118 Hz buzz and decaying crackle'),
    ('basiliskra.iii.club_swing', 1, 1.0, 'hostile', 6, 64, -15.0, s_iii_club_swing, {},
     'Moving-band whoosh 220->950->260 Hz + low weight band + narrow spike whistle, crackle following the swing, doppler-shifted 2x118 Hz buzz'),
    ('basiliskra.iii.charge_tick', 1, 0.5, 'hostile', 6, 72, -18.0, s_iii_charge_tick, {},
     'Harmonic modal "tink" exactly on 440 Hz (partials 1,2,3,5,8,12; slow detune beat), 55 Hz hum modulation, 1 ms ignition snap, faint 3.5 kHz glow hiss'),
    ('basiliskra.iii.charge', 1, 5.0, 'hostile', 8, 96, -15.0, s_iii_charge, {'fo': 0.004},
     'Saw hum 55->165 Hz with a low-pass opening 250 Hz->5 kHz, whine 392->1568 Hz, throb 4->20 Hz, crackle 2->300/s, level ramping +24 dB; cut dead at the peak'),
    ('basiliskra.iii.beam_raw', 1, 2.5, 'hostile', 12, 112, -12.0, s_iii_beam_raw, {'fo': 0.02},
     'Detuned saws + FM around a randomly wandering 300 Hz, formant plasma noise roughened by irregular 55 Hz pulses, random sputter gate whose gaps grow, crackle in the gaps, hard saturation'),
    ('basiliskra.iii.beam', 1, 3.5, 'hostile', 12, 128, -12.0, s_iii_beam, {'fo': 0.01},
     'Two saws 370/372.8 Hz + octave + FM layer at 555 Hz with searing EQ peaks (1.25/2.9/5.2 kHz), >4 kHz hiss, crackle, 46 Hz throb at 11.5 Hz; 4 ms hard start with onset burst, 0.3 s release'),
    ('basiliskra.iii.beam_impact', 2, 1.2, 'hostile', 8, 96, -15.0, s_iii_beam_impact, {'fo': 0.03},
     'Triple (v2 five-fold) crack + rock modes + low thump, frying sizzle band 7->4.2 kHz, 13/19 modal stone-chip pings, debris grains'),
    ('basiliskra.iii.ground', 1, 1.5, 'hostile', 8, 96, -14.0, s_iii_ground, {'fo': 0.03},
     'Arc snap + 2x124 Hz buzz + copper-rod ping (1.83/2.92/4.71 kHz), whine collapsing 1500->70 Hz, 83->38 Hz whump at 0.92 s, dying crackle'),
    ('basiliskra.iii.fizzle', 1, 1.2, 'hostile', 6, 64, -16.0, s_iii_fizzle, {'fo': 0.03},
     'Strangled rising voiced choke (170->255 Hz, cut at 0.25 s), two coughs (formant noise + rough voiced burst + throat thump), last sparks, faint wheeze'),
    ('basiliskra.iii.scatter', 1, 3.0, 'hostile', 12, 112, -15.0, s_iii_scatter, {'fo': 0.03},
     'Nine detuned pairs of thin tones (1.9-7.2 kHz) with staggered onsets, individual 6-14 Hz shimmer and narrow-band sizzle noise, crackle, faint 92 Hz bed'),
    # ---- misc ---------------------------------------------------------------------
    ('basiliskra.fin_pulse', 1, 0.4, 'neutral', 1, 12, -24.0, s_fin_pulse, {'fo': 0.02},
     'Two soft saturated sine beats (88->58 Hz, then 92->66 Hz at 0.7 level) with low noise puffs, low-passed at 700 Hz'),
    ('basiliskra.hurt', 2, 1.0, 'hostile', 6, 64, -14.0, s_hurt, {'fo': 0.03},
     'Additive voiced grunt (f0 jumps 92->138->70 Hz; v2 is a double grunt), formants snapping open then closing, breath noise, sub-octave, throat thump, soft saturation'),
]

ALLOWED_CATEGORIES = {'hostile', 'neutral', 'ambient', 'block', 'weather', 'player'}

# Recordings supplied by the project owner (kept in tools/sound/source/).  They are not synthesised: the same
# run converts them (mono mix, cut, fades, optional filter, peak-matched) and lists them in the definitions.
#   event, file base, source file, start s, length s, fade in s, fade out s, low-pass Hz or None, category,
#   min distance, max distance, what it is
SOURCE_DIR = os.path.join(HERE, 'source')
IMPORTED = [
    ('basiliskra.roar', 'roar', 'basiliskra_roar_1.mp3', 0.0, 10.0, 0.004, 2.2, None, 'hostile', 16, 160,
     'His roar, whole: seven seconds of it and the tail that follows'),
    ('basiliskra.roar_short', 'roar_short', 'basiliskra_roar_1.mp3', 4.4, 4.4, 0.30, 1.3, None, 'hostile', 12, 128,
     'The last two and a half seconds of the same roar and its fall, swelled in: a bellow for moments that come more often'),
    ('basiliskra.roar_under', 'roar_under', 'basiliskra_roar_1.mp3', 0.0, 9.0, 0.05, 2.5, 360.0, 'hostile', 10, 96,
     'The same roar heard through water (two cascaded low-passes at 360 Hz)'),
]
IMPORT_PEAK_DB = -1.5

# Review status per event.  Nobody has listened to any of these files yet.
DEFAULT_REVIEW = 'Unheard. Machine-checked only (decode, mono, duration, peak, RMS, DC, spectrum).'
REVIEW = {}

FUNCS = {s[0]: s[7] for s in SPEC}


def file_bases(event, nvar):
    base = event.split('.', 1)[1].replace('.', '_')
    return [base] if nvar == 1 else ['%s_%d' % (base, i) for i in range(1, nvar + 1)]


# =====================================================================================
# 16. spectrogram PNGs (design checking only; needs Pillow)
# =====================================================================================

_CMAP = np.array([[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66],
                  [245, 125, 21], [250, 193, 39], [252, 255, 164]], float)
SPEC_FMIN, SPEC_FMAX = 30.0, 20000.0


def spectro_rgb(x, width, height, dyn=80.0):
    nfft = 2048 if len(x) < 1.3 * SR else 4096
    zp = 8192
    hop = max(8, len(x) // width)
    xp = np.concatenate([np.zeros(nfft // 2), x, np.zeros(nfft // 2)])
    starts = np.arange(0, len(xp) - nfft + 1, hop)
    win = np.hanning(nfft)
    S = np.abs(np.fft.rfft(sliding_window_view(xp, nfft)[starts] * win, zp, axis=1))
    S = 20.0 * np.log10(S / (win.sum() / 2.0) + 1e-9)
    edges = SPEC_FMIN * (SPEC_FMAX / SPEC_FMIN) ** np.linspace(1.0, 0.0, height + 1)
    bins = np.clip(np.round(edges / SR * zp).astype(int), 0, zp // 2)
    img = np.empty((height, len(starts)))
    for r in range(height):
        lo = bins[r + 1]
        hi = max(bins[r], lo + 1)
        img[r] = S[:, lo:hi].max(axis=1)
    z = np.clip((img - (img.max() - dyn)) / dyn, 0.0, 1.0)
    z = z[:, np.round(np.linspace(0, len(starts) - 1, width)).astype(int)]
    idx = z * (len(_CMAP) - 1)
    i0 = np.clip(np.floor(idx).astype(int), 0, len(_CMAP) - 2)
    fr = (idx - i0)[..., None]
    return (_CMAP[i0] * (1.0 - fr) + _CMAP[i0 + 1] * fr).astype(np.uint8)


def spectro_png(x, path, title):
    from PIL import Image, ImageDraw
    W, H, L, B, TM = 900, 360, 50, 16, 16
    im = Image.new('RGB', (W + L + 8, H + B + TM), (14, 14, 18))
    im.paste(Image.fromarray(spectro_rgb(x, W, H)), (L, TM))
    dr = ImageDraw.Draw(im)
    dr.text((L, 2), title, fill=(235, 235, 235))
    for f, lab in ((50, '50'), (100, '100'), (200, '200'), (500, '500'), (1000, '1k'), (2000, '2k'), (5000, '5k'), (10000, '10k')):
        yy = TM + H * (1.0 - math.log(f / SPEC_FMIN) / math.log(SPEC_FMAX / SPEC_FMIN))
        dr.line([(L - 5, yy), (L, yy)], fill=(220, 220, 220))
        dr.line([(L + W, yy), (L + W + 5, yy)], fill=(220, 220, 220))
        dr.text((4, yy - 6), lab, fill=(220, 220, 220))
    dur = len(x) / SR
    step = 0.05 if dur <= 0.6 else 0.1 if dur <= 1.3 else 0.25 if dur <= 2.6 else 0.5
    k = 0
    while k * step <= dur + 1e-9:
        xx = L + W * (k * step) / dur
        dr.line([(xx, TM + H), (xx, TM + H + 4)], fill=(220, 220, 220))
        dr.text((xx + 2, TM + H + 3), ('%.2f' % (k * step)).rstrip('0').rstrip('.') or '0', fill=(220, 220, 220))
        k += 1
    im.save(path)


def stack_pngs(paths, out):
    from PIL import Image
    ims = [Image.open(p) for p in paths if os.path.exists(p)]
    if not ims:
        return
    sheet = Image.new('RGB', (max(i.width for i in ims), sum(i.height for i in ims)), (14, 14, 18))
    y = 0
    for i in ims:
        sheet.paste(i, (0, y))
        y += i.height
    sheet.save(out)


# =====================================================================================
# 17. file I/O, encoding, verification
# =====================================================================================

def write_wav(path, x):
    """24-bit PCM mono WAV (intermediate only)"""
    q = np.clip(np.round(x * 8388607.0), -8388608, 8388607).astype('<i4')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(q.view(np.uint8).reshape(-1, 4)[:, :3].tobytes())


def encode_ogg(wav, ogg):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-map_metadata', '-1',
                    '-fflags', '+bitexact', '-flags:a', '+bitexact',
                    '-c:a', 'libvorbis', '-q:a', '4', '-ac', '1', '-ar', str(SR), ogg], check=True)


def verify_ogg(ogg, dur):
    """decode the .ogg back with ffmpeg and check it; raises on any problem"""
    pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
                         'stream=codec_name,channels,sample_rate', '-of', 'json', ogg],
                        capture_output=True, check=True)
    st = json.loads(pr.stdout)['streams'][0]
    if st['codec_name'] != 'vorbis' or int(st['channels']) != 1 or int(st['sample_rate']) != SR:
        raise RuntimeError('%s: wrong stream format %r' % (ogg, st))
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', ogg, '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1'],
                         capture_output=True, check=True).stdout
    y = np.frombuffer(raw, dtype='<f4').astype(float)
    if len(y) < 64:
        raise RuntimeError('%s: decoded to nothing' % ogg)
    got = len(y) / SR
    if abs(got - dur) > 0.1:
        raise RuntimeError('%s: duration %.3f s, expected %.3f s' % (ogg, got, dur))
    res = {'dur': got, 'peak_db': todb(np.abs(y).max()), 'rms_db': todb(rms(y)), 'dc': float(y.mean()),
           'edge': float(max(np.abs(y[:8]).max(), np.abs(y[-8:]).max())), 'bytes': os.path.getsize(ogg)}
    if abs(res['dc']) > 0.003:
        raise RuntimeError('%s: DC offset %.5f' % (ogg, res['dc']))
    if res['edge'] > 0.05:
        raise RuntimeError('%s: does not start/end near zero (%.4f) - would click' % (ogg, res['edge']))
    return res


def import_recording(row, work):
    """Convert one supplied recording to the pack's format; returns the same kind of result row as render_job."""
    event, base, src, start, length, fin, fout, lowpass, cat, dmin, dmax, how = row
    path = os.path.join(SOURCE_DIR, src)
    if not os.path.isfile(path):
        raise RuntimeError('%s: source recording %s is missing' % (event, path))
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', '%.3f' % start, '-t', '%.3f' % length, '-i', path,
                          '-f', 'f32le', '-ac', '2', '-ar', str(SR), 'pipe:1'], capture_output=True, check=True).stdout
    st = np.frombuffer(raw, dtype='<f4').astype(float).reshape(-1, 2)
    x = st.mean(axis=1)                                        # mono, so the game can place it in the world
    n = int(round(length * SR))
    x = np.pad(x, (0, max(0, n - len(x))))[:n]
    x -= x.mean()
    if lowpass:
        for _ in range(2):                                     # two one-pole low-passes, run forward
            k = 1.0 - math.exp(-2.0 * math.pi * lowpass / SR)
            y = np.empty_like(x)
            acc = 0.0
            for i in range(len(x)):
                acc += k * (x[i] - acc)
                y[i] = acc
            x = y
    ni, no = max(1, int(fin * SR)), max(1, int(fout * SR))
    x[:ni] *= np.linspace(0.0, 1.0, ni) ** 2
    x[-no:] *= np.linspace(1.0, 0.0, no) ** 2
    x *= dbg(IMPORT_PEAK_DB) / max(1e-9, np.abs(x).max())
    wav = os.path.join(work, base + '.wav')
    ogg = os.path.join(OGG_DIR, base + '.ogg')
    gain = 1.0
    for _ in range(10):
        write_wav(wav, x * gain)
        encode_ogg(wav, ogg)
        res = verify_ogg(ogg, length)
        if res['peak_db'] <= PEAK_LIMIT_DB:
            break
        gain *= dbg(-0.5)
    else:
        raise RuntimeError('%s: cannot get the decoded peak under %.1f dBFS' % (base, PEAK_LIMIT_DB))
    res.update(event=event, base=base, target=float('nan'), gr_db=0.0, seam=None, trim_db=todb(gain), want=length, imported=True)
    return res


def render_job(job):
    event, v, base, dur, rms_db, opts, work, spectro = job
    x = FUNCS[event](v, rng_for('%s#%d' % (event, v)))
    if not np.all(np.isfinite(x)):
        raise RuntimeError('%s: non-finite samples' % base)
    x, info = finalize(x, dur, rms_db, **opts)
    wav = os.path.join(work, base + '.wav')
    ogg = os.path.join(OGG_DIR, base + '.ogg')
    gain = 1.0
    for _ in range(10):
        write_wav(wav, x * gain)
        encode_ogg(wav, ogg)
        res = verify_ogg(ogg, dur)
        if res['peak_db'] <= PEAK_LIMIT_DB:
            break
        gain *= dbg(-0.5)                                    # lossy overshoot: back off and re-encode
    else:
        raise RuntimeError('%s: cannot get the decoded peak under %.1f dBFS' % (base, PEAK_LIMIT_DB))
    res.update(event=event, base=base, target=rms_db, gr_db=info['gr_db'], seam=info.get('seam'),
               trim_db=todb(gain), want=dur)
    if spectro:
        spectro_png(x, os.path.join(spectro, base + '.png'),
                    '%s   %.2f s   peak %.1f dBFS   rms %.1f dBFS' % (base, dur, res['peak_db'], res['rms_db']))
    return res


# =====================================================================================
# 18. sound_definitions.json and docs/SOUNDS.md
# =====================================================================================

def build_definitions():
    defs = {}
    for event, nvar, dur, cat, dmin, dmax, rms_db, fn, opts, how in SPEC:
        if cat not in ALLOWED_CATEGORIES:
            raise RuntimeError('%s: category %r is not allowed' % (event, cat))
        defs[event] = {
            'category': cat,
            'min_distance': float(dmin),
            'max_distance': float(dmax),
            'sounds': [{'name': 'sounds/basiliskra/' + b, 'volume': 1.0, 'load_on_low_memory': True}
                       for b in file_bases(event, nvar)],
        }
    for event, base, src, start, length, fin, fout, lowpass, cat, dmin, dmax, how in IMPORTED:
        if cat not in ALLOWED_CATEGORIES:
            raise RuntimeError('%s: category %r is not allowed' % (event, cat))
        defs[event] = {'category': cat, 'min_distance': float(dmin), 'max_distance': float(dmax),
                       'sounds': [{'name': 'sounds/basiliskra/' + base, 'volume': 1.0, 'load_on_low_memory': True}]}
    return {'format_version': '1.20.20', 'sound_definitions': defs}


def write_doc(results):
    by_base = {r['base']: r for r in results}
    nfiles = len(results)
    total = sum(r['dur'] for r in results)
    size = sum(r['bytes'] for r in results)
    L = []
    L.append('# Basiliskra - sound inventory')
    L.append('')
    L.append('> Generated by `tools/sound/synth.py`. Do not edit by hand - change the script and re-run it.')
    L.append('')
    L.append('- **%d events, %d files**, %.1f s of audio, %.0f kB.' % (len(SPEC), nfiles, total, size / 1024.0))
    L.append('- Every sound is original procedural synthesis (numpy only: modal bodies, additive formant voices,')
    L.append('  filtered noise, FM, granular events, synthetic-impulse-response reverbs). No samples, no downloads.')
    L.append('- Format: mono, 44100 Hz, Ogg Vorbis (`ffmpeg -c:a libvorbis -q:a 4 -ac 1`). Mono is required for')
    L.append('  Bedrock to spatialise a sound.')
    L.append('- Deterministic: every file has a fixed seed, `crc32("<event>#<variant>")`.')
    L.append('- Regenerate everything: `python3 basiliskra/tools/sound/synth.py` (from the repository root).')
    L.append('  Add `--spectro DIR` for spectrogram PNGs, `--only TEXT` to render a subset.')
    L.append('')
    L.append('## Review status - read this first')
    L.append('')
    L.append('**Nobody has listened to any of these files.** They were designed from first principles and checked')
    L.append('by machine only: each `.ogg` is decoded again with ffmpeg and must be mono / 44.1 kHz / Vorbis, within')
    L.append('0.1 s of its nominal duration, peak <= %.1f dBFS, free of DC, and start and end near zero. Spectrograms' % PEAK_LIMIT_DB)
    L.append('of the key sounds were inspected by eye. Timbre, believability and in-game balance still need human ears;')
    L.append('the "Review" column records that.')
    L.append('')
    L.append('## The knock motif')
    L.append('')
    L.append('`basiliskra.knock.gill` N and `basiliskra.knock.vent` N are built on the *same* body (`knock_body()`,')
    L.append('seeded by the variant number only): fundamental %s Hz, a short downward settle on the attack,' % '/'.join('%g' % f for f in KNOCK_F0))
    L.append('a hollow partial at 2.07x, a cavity puff and a woody click. Gill = that body through a 900 Hz 4-pole')
    L.append('low-pass with a slight droop and a bubble flutter; vent = the same body dry, plus a steam burst and a ping.')
    L.append('Play three of either, ~0.5-0.6 s apart, for the motif.')
    L.append('')
    L.append('## Events')
    L.append('')
    L.append('| Event id | Files (`sounds/basiliskra/`) | Dur (s) | Category | Min / max dist | How it is synthesised | Review |')
    L.append('|---|---|---|---|---|---|---|')
    for event, nvar, dur, cat, dmin, dmax, rms_db, fn, opts, how in SPEC:
        bases = file_bases(event, nvar)
        files = '`%s.ogg`' % bases[0] if nvar == 1 else '`%s.ogg` ... `%s.ogg` (%d)' % (bases[0], bases[-1], nvar)
        L.append('| `%s` | %s | %.2f | %s | %g / %g | %s | %s |' % (event, files, dur, cat, dmin, dmax, how,
                                                                    REVIEW.get(event, DEFAULT_REVIEW)))
    L.append('')
    L.append('## Measured levels (decoded .ogg)')
    L.append('')
    L.append('Loudness is matched inside each event family by normalising every file to a target whole-file RMS;')
    L.append('"limiter" is the gain reduction a look-ahead peak limiter had to apply to keep that target under the ceiling.')
    L.append('')
    L.append('| File | Dur (s) | Peak (dBFS) | RMS (dBFS) | Target RMS | Limiter (dB) | Size (kB) |')
    L.append('|---|---|---|---|---|---|---|')
    for event, nvar, dur, cat, dmin, dmax, rms_db, fn, opts, how in SPEC:
        for b in file_bases(event, nvar):
            r = by_base[b]
            L.append('| `%s.ogg` | %.3f | %.1f | %.1f | %.1f | %.1f | %.1f |' % (
                b, r['dur'], r['peak_db'], r['rms_db'], r['target'], r['gr_db'], r['bytes'] / 1024.0))
    L.append('')
    L.append('## Notes for whoever wires these up')
    L.append('')
    L.append('- `sound_definitions.json` uses `format_version` 1.20.20 with explicit `min_distance` / `max_distance`,')
    L.append('  the same entry shape as the vanilla 1.26.60 file (object-form `sounds` entries with `name`, `volume`,')
    L.append('  `load_on_low_memory`). Categories used: hostile, neutral, ambient, block.')
    L.append('- `basiliskra.rift.hum` is a seamless loop: its content is periodic over exactly 3.000 s (the wrap from')
    L.append('  the last sample to the first is continuous). A 3 ms safety fade at each end keeps a re-trigger that is')
    L.append('  a tick early or late from clicking. Re-trigger it every 60 ticks.')
    L.append('- `basiliskra.iii.charge` stops dead at its peak (4 ms fade). Start `basiliskra.iii.beam` on the same tick.')
    L.append('- `basiliskra.iii.charge_tick` sits exactly on 440 Hz with harmonic partials; re-pitch it freely.')
    L.append('- `basiliskra.scrape_far` and `basiliskra.fin_pulse` are deliberately quieter than the rest.')
    L.append('- All "through water" sounds have the muffling baked in; do not add another low-pass.')
    L.append('')
    L.append('## Recordings supplied by the project owner')
    L.append('')
    L.append('These are not synthesised. The source file is kept in `tools/sound/source/` and converted by the same run:')
    L.append('mixed to mono (so the game can place the sound in the world), cut, faded, peak-matched and encoded like')
    L.append('everything else. Where the recording came from is for the project owner to state; this tool only converts it.')
    L.append('')
    L.append('| Event | File | Source | Cut (s) | Fades in / out (s) | Category | Min / max distance | What it is | Decoded: dur s, peak dBFS, RMS dBFS, kB |')
    L.append('|---|---|---|---|---|---|---|---|---|')
    for event, base, src, start, length, fin, fout, lowpass, cat, dmin, dmax, how in IMPORTED:
        r = by_base[base]
        L.append('| `%s` | `%s.ogg` | `%s` | %.1f to %.1f | %g / %g | %s | %g / %g | %s | %.2f, %.1f, %.1f, %.0f |' % (
            event, base, src, start, start + length, fin, fout, cat, dmin, dmax, how,
            r['dur'], r['peak_db'], r['rms_db'], r['bytes'] / 1024.0))
    L.append('')
    with open(DOC_PATH, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(L))


# =====================================================================================
# 19. main
# =====================================================================================

def main():
    ap = argparse.ArgumentParser(description='Basiliskra procedural sound synthesiser')
    ap.add_argument('--only', default=None, help='render only events whose id contains this text')
    ap.add_argument('--work', default=None, help='directory for WAV intermediates (kept)')
    ap.add_argument('--spectro', default=None, help='write spectrogram PNGs into this directory')
    ap.add_argument('--jobs', type=int, default=min(4, os.cpu_count() or 1))
    args = ap.parse_args()

    for tool in ('ffmpeg', 'ffprobe'):
        if shutil.which(tool) is None:
            sys.exit('FATAL: %s not found' % tool)
    os.makedirs(OGG_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(DOC_PATH), exist_ok=True)
    tmp = None
    if args.work:
        work = args.work
        os.makedirs(work, exist_ok=True)
    else:
        tmp = tempfile.mkdtemp(prefix='basiliskra_snd_')
        work = tmp
    if args.spectro:
        os.makedirs(args.spectro, exist_ok=True)

    jobs = []
    for event, nvar, dur, cat, dmin, dmax, rms_db, fn, opts, how in SPEC:
        if args.only and args.only not in event:
            continue
        for i, b in enumerate(file_bases(event, nvar)):
            jobs.append((event, i + 1, b, dur, rms_db, opts, work, args.spectro))
    imports = [row for row in IMPORTED if not args.only or args.only in row[0]]
    if not jobs and not imports:
        sys.exit('nothing matches --only %r' % args.only)

    try:
        if args.jobs > 1 and len(jobs) > 1:
            with Pool(args.jobs) as pool:
                results = pool.map(render_job, jobs, chunksize=1)
        else:
            results = [render_job(j) for j in jobs]
        results += [import_recording(row, work) for row in imports]
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)

    full = args.only is None
    if full:
        expected = {b + '.ogg' for s in SPEC for b in file_bases(s[0], s[1])} | {row[1] + '.ogg' for row in IMPORTED}
        for fn_ in sorted(os.listdir(OGG_DIR)):
            if fn_.endswith('.ogg') and fn_ not in expected:
                os.remove(os.path.join(OGG_DIR, fn_))            # stale file from an older table
        defs = build_definitions()
        for ev, dfn in defs['sound_definitions'].items():
            for s in dfn['sounds']:
                p = os.path.join(ROOT, 'packs', 'RP', s['name'] + '.ogg')
                if not os.path.isfile(p):
                    sys.exit('FATAL: %s references missing file %s' % (ev, p))
        with open(DEFS_PATH, 'w', encoding='utf-8') as fh:
            json.dump(defs, fh, indent=2)
            fh.write('\n')
        write_doc(results)

    if args.spectro:
        sp = args.spectro
        for i in (1, 2, 3):
            stack_pngs([os.path.join(sp, 'knock_gill_%d.png' % i), os.path.join(sp, 'knock_vent_%d.png' % i)],
                       os.path.join(sp, '_knock_compare_%d.png' % i))

    print('%-26s %7s %8s %8s %8s %8s %7s' % ('file', 'dur s', 'peak dB', 'rms dB', 'target', 'limiter', 'kB'))
    print('-' * 80)
    for r in results:
        note = ''
        if r['seam'] is not None:
            note = '  loop seam %.2f x typical sample step' % r['seam']
        if r['trim_db'] < -0.01:
            note += '  (encoder overshoot trim %.1f dB)' % r['trim_db']
        print('%-26s %7.3f %8.2f %8.2f %8.1f %8.2f %7.1f%s' % (r['base'] + '.ogg', r['dur'], r['peak_db'], r['rms_db'],
                                                                r['target'], r['gr_db'], r['bytes'] / 1024.0, note))
    print('-' * 80)
    print('%d files, %.1f s, %.0f kB, max peak %.2f dBFS  ->  %s' % (
        len(results), sum(r['dur'] for r in results), sum(r['bytes'] for r in results) / 1024.0,
        max(r['peak_db'] for r in results), OGG_DIR))
    if full:
        print('wrote %s' % DEFS_PATH)
        print('wrote %s' % DOC_PATH)
    print('ALL CHECKS PASSED (decode, mono, 44.1 kHz, duration +-0.1 s, peak <= %.1f dBFS, DC, edges)' % PEAK_LIMIT_DB)


if __name__ == '__main__':
    main()
