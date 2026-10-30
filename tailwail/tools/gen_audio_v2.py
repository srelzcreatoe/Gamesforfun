#!/usr/bin/env python3
"""TAILWAIL sound palette v2: every sound synthesized from scratch (no samples, no
third-party audio), deterministic per seed.

  python3 -I tools/gen_audio_v2.py            # all sounds + sound_definitions.json
  python3 -I tools/gen_audio_v2.py scream     # just the named designs (fast iteration)
  python3 -I tools/gen_audio_v2.py --wav DIR  # also keep the .wav renders for review

Toolkit: band-limited glottal source with jitter / shimmer / period-doubling roughness,
time-varying formant filtering (STFT), aspiration noise, granular crackle, damped
resonators, a stone-cave reverb with frequency-dependent decay, soft saturation.
Encoded to Ogg Vorbis (libvorbis q4) with ffmpeg.
"""
import json
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "packs", "TailwailRP", "sounds", "tailwail")
DEFS = os.path.join(ROOT, "packs", "TailwailRP", "sounds", "sound_definitions.json")
SR = 44100


# =========================================================================== basics
def N(sec):
    return max(1, int(round(sec * SR)))


def tax(n):
    return np.arange(n) / SR


def white(n, rng):
    return rng.standard_normal(n)


def colored(n, rng, slope):
    """slope 0 = white, -0.5 = pink, -1 = brown (amplitude per frequency exponent)."""
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1] if len(f) > 1 else 1
    X *= f ** slope
    x = np.fft.irfft(X, n)
    return x / (np.std(x) + 1e-12)


def curve(n, pts, ease=False):
    """pts: [(fraction 0..1, value)] -> piecewise curve of n samples (optionally cosine-eased)."""
    xs = np.array([p[0] for p in pts], dtype=float)
    ys = np.array([p[1] for p in pts], dtype=float)
    u = np.linspace(0, 1, n)
    if not ease:
        return np.interp(u, xs, ys)
    idx = np.clip(np.searchsorted(xs, u, side="right") - 1, 0, len(xs) - 2)
    a, b = xs[idx], xs[idx + 1]
    s = np.where(b > a, (u - a) / np.maximum(b - a, 1e-12), 0)
    s = 0.5 - 0.5 * np.cos(np.pi * np.clip(s, 0, 1))
    return ys[idx] + (ys[idx + 1] - ys[idx]) * s


def wobble(n, rng, rate):
    """Smooth random curve in about [-1, 1] changing `rate` times per second."""
    k = max(3, int(n / SR * rate) + 3)
    pts = rng.uniform(-1, 1, k)
    x = np.interp(np.linspace(0, k - 1, n), np.arange(k), pts)
    w = max(1, int(SR / rate / 4))
    if w > 1 and n > w * 2:
        x = np.convolve(x, np.ones(w) / w, mode="same")
    return x


def env(n, a, r, hold=None, ca=1.5, cr=2.0):
    """Attack / release envelope in seconds."""
    e = np.ones(n)
    ai, ri = N(a), N(r)
    if ai and ai < n:
        e[:ai] = np.linspace(0, 1, ai) ** ca
    if ri and ri < n:
        e[-ri:] *= np.linspace(1, 0, ri) ** cr
    return e


def eq(x, gain_fn):
    """Zero-phase FFT filter, zero-padded so transients never wrap around the buffer."""
    n = len(x)
    m = 1 << (n + min(max(n // 2, 8192), 88200) - 1).bit_length()
    X = np.fft.rfft(x, m)
    f = np.fft.rfftfreq(m, 1 / SR)
    # zero-phase: the acausal half of each response lands in the padding, never in the signal
    return np.fft.irfft(X * gain_fn(f), m)[:n]


def bandpass(x, lo, hi, soft=0.22):
    def g(f):
        lf = np.log2(np.maximum(f, 1e-3))
        return 1 / (1 + np.exp(-(lf - np.log2(lo)) / soft)) / (1 + np.exp((lf - np.log2(hi)) / soft))
    return eq(x, g)


def lowpass(x, fc, soft=0.25):
    return bandpass(x, 5, fc, soft)


def highpass(x, fc, soft=0.25):
    return bandpass(x, fc, 30000, soft)


def sat(x, drive):
    return np.tanh(drive * x) / np.tanh(drive)


def norm(x, peak=1.0):
    return x / (np.max(np.abs(x)) + 1e-12) * peak


def place(dst, src, at, gain=1.0):
    i = N(at)
    if i >= len(dst):
        return dst
    m = min(len(src), len(dst) - i)
    dst[i:i + m] += src[:m] * gain
    return dst


def pad(x, sec):
    return np.concatenate([x, np.zeros(N(sec))])


# =========================================================================== filters that move
def stft_filter(x, gain_fn, frame=2048, hop=256):
    """Time-varying filter: gain_fn(t_seconds, freqs) -> gains, applied frame by frame."""
    n = len(x)
    xp = np.concatenate([np.zeros(frame), x, np.zeros(frame * 2)])
    win = np.hanning(frame)
    out = np.zeros(len(xp))
    wsum = np.zeros(len(xp))
    freqs = np.fft.rfftfreq(frame, 1 / SR)
    for s in range(0, len(xp) - frame, hop):
        tc = (s + frame / 2 - frame) / SR
        y = np.fft.irfft(np.fft.rfft(xp[s:s + frame] * win) * gain_fn(tc, freqs), frame) * win
        out[s:s + frame] += y
        wsum[s:s + frame] += win * win
    return (out / np.maximum(wsum, 1e-6))[frame:frame + n]


VOWELS = {  # (F, bandwidth) for F1..F5, adult male reference
    "a": [(730, 90), (1090, 110), (2440, 170), (3400, 250), (4500, 320)],
    "ae": [(660, 100), (1720, 120), (2410, 170), (3400, 250), (4500, 320)],
    "e": [(530, 80), (1840, 100), (2480, 150), (3400, 250), (4500, 320)],
    "i": [(270, 60), (2290, 120), (3010, 170), (3700, 250), (4700, 320)],
    "o": [(570, 80), (840, 100), (2410, 160), (3400, 250), (4500, 320)],
    "u": [(300, 70), (870, 100), (2240, 160), (3400, 250), (4500, 320)],
    "er": [(490, 80), (1350, 110), (1690, 140), (3400, 250), (4500, 320)],
    "h": [(800, 300), (1500, 400), (2600, 500), (3600, 600), (4800, 700)],
}
FORMANT_AMP = [1.0, 0.55, 0.32, 0.18, 0.1]


def vowel_track(pts, tract=1.0):
    """pts [(fraction, vowel)] -> f(frac) -> list of (F, BW) (linear morph)."""
    fr = [p[0] for p in pts]
    vs = [np.array(VOWELS[p[1]], dtype=float) for p in pts]

    def at(u):
        u = min(max(u, 0.0), 1.0)
        for i in range(len(fr) - 1):
            if fr[i] <= u <= fr[i + 1]:
                k = 0 if fr[i + 1] == fr[i] else (u - fr[i]) / (fr[i + 1] - fr[i])
                v = vs[i] * (1 - k) + vs[i + 1] * k
                return [(F * tract, B * (0.7 + 0.3 * tract)) for F, B in v]
        v = vs[-1] if u >= fr[-1] else vs[0]
        return [(F * tract, B) for F, B in v]
    return at


def formant_gain(formants, f, floor=0.015, bright=1.0):
    g = np.full_like(f, floor)
    for k, (F, B) in enumerate(formants):
        g += FORMANT_AMP[k] * bright ** k / np.sqrt(1 + ((f - F) / (B / 2)) ** 2)
    return g


def formant_filter(x, track, dur, floor=0.015, bright=1.0):
    return stft_filter(x, lambda t, f: formant_gain(track(t / dur), f, floor, bright))


# =========================================================================== sources
def glottal(f0, rng, tilt=1.1, jitter=0.01, shimmer=0.08, rough=0.0, maxk=90, maxf=14000):
    """Band-limited voiced source following f0 (array, Hz).  rough adds period doubling."""
    n = len(f0)
    f = f0 * (1 + jitter * wobble(n, rng, 35))
    ph = 2 * np.pi * np.cumsum(f) / SR
    out = np.zeros(n)
    kmax = int(min(maxk, maxf / max(np.min(f), 30)))
    for k in range(1, kmax + 1):
        mask = (f * k) < maxf
        out += mask * np.sin(k * ph) / k ** tilt
    if rough > 0:
        # subharmonic period doubling + irregular amplitude flutter: growl
        out *= 1 + rough * (0.6 * np.sin(ph / 2 + 0.7) + 0.4 * wobble(n, rng, 70))
    out *= 1 + shimmer * wobble(n, rng, 45)
    return out / (np.std(out) + 1e-12)


def voice(dur, f0_pts, vowels, rng, tract=0.8, tilt=1.1, rough=0.0, breath=0.12, jitter=0.012, shimmer=0.1,
          vib=(0.0, 5.5), sub=0.0, bright=1.0, ease=True, amp_pts=None):
    n = N(dur)
    f0 = curve(n, f0_pts, ease)
    if vib[0]:
        # irregular: part periodic, mostly random, so it never sounds sung
        f0 = f0 * (1 + vib[0] * (0.35 * np.sin(2 * np.pi * vib[1] * tax(n) + wobble(n, rng, 2)) + 0.65 * wobble(n, rng, vib[1] * 1.3)))
    src = glottal(f0, rng, tilt, jitter, shimmer, rough)
    if sub:
        src += sub * glottal(f0 / 2, rng, 1.3, jitter * 2, shimmer, rough * 0.5, maxk=40)
    asp = colored(n, rng, -0.2) * breath * (0.6 + 0.4 * np.abs(np.sin(np.pi * np.cumsum(f0) / SR)))
    x = formant_filter(src + asp, vowel_track(vowels, tract), dur, bright=bright)
    if amp_pts:
        x *= curve(n, amp_pts, True)
    return x


def breathy(dur, vowels, rng, tract=0.75, slope=-0.3, amp_pts=None, bright=1.0):
    """Unvoiced airflow through a vocal tract: breaths, whispers, sniffs."""
    n = N(dur)
    x = formant_filter(colored(n, rng, slope), vowel_track(vowels, tract), dur, floor=0.05, bright=bright)
    if amp_pts:
        x *= curve(n, amp_pts, True)
    return x


def resonator(n, f, decay, rng=None, phase=0.0):
    t = tax(n)
    return taper(np.sin(2 * np.pi * f * t + phase) * np.exp(-t / decay), 0.1)


def crack(rng, size=1.0):
    """A single bone / joint crack: sharp broadband snap + short resonance + a little body."""
    n = N(0.09)
    t = tax(n)
    snap = white(n, rng) * np.exp(-t / (0.0016 * size))
    body = resonator(n, rng.uniform(900, 2400) / size, 0.008 * size, phase=rng.uniform(0, 6))
    low = resonator(n, rng.uniform(140, 260), 0.012 * size)
    return highpass(snap, 600) * 1.2 + body * 0.6 + low * 0.35


def taper(x, frac=0.2):
    """Raised-cosine fade over the last `frac` of a buffer (no truncation clicks)."""
    k = max(2, int(len(x) * frac))
    x[-k:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, k))
    return x


def thump(rng, f0=70, f1=40, dur=0.3, click=0.25):
    n = N(dur)
    t = tax(n)
    f = f1 + (f0 - f1) * np.exp(-t / 0.035)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (dur / 3.5))
    c = bandpass(white(n, rng) * np.exp(-t / 0.005), 300, 4000)
    return taper(s + click * c)


def grains(n, rng, rate, length, lo, hi, decay=0.004, accel=None):
    """Granular crackle (scrapes, crunches, gravel)."""
    out = np.zeros(n)
    t = 0.0
    while True:
        r = rate if accel is None else rate * accel(t / (n / SR))
        t += rng.exponential(1 / max(r, 1e-3))
        i = N(t)
        L = N(length * rng.uniform(0.5, 1.5))
        if i + L >= n:
            break
        g = white(L, rng) * np.exp(-np.arange(L) / (decay * SR)) * rng.uniform(0.25, 1.0)
        out[i:i + L] += g
    return bandpass(out, lo, hi, 0.2)


def bubbles(n, rng, count, lo=250, hi=900):
    """Wet gurgles: short upward chirps."""
    out = np.zeros(n)
    for _ in range(count):
        L = N(rng.uniform(0.02, 0.06))
        i = rng.integers(0, max(1, n - L))
        t = tax(L)
        f = rng.uniform(lo, hi) * (1 + 2.5 * t / t[-1])
        out[i:i + L] += np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / t[-1]) ** 2 * rng.uniform(0.3, 1)
    return out


def whoosh(rng, dur=0.35, lo=250, hi=2600):
    n = N(dur)
    x = colored(n, rng, -0.3)
    c = curve(n, [(0, lo), (0.6, hi), (1, lo * 1.5)], True)
    y = stft_filter(x, lambda t, f: 1 / np.sqrt(1 + ((f - np.interp(t, np.linspace(0, dur, n), c)) / 500) ** 2))
    return y * np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5


# =========================================================================== space
_IR = {}


def cave_ir(sec=2.4, bright=0.6, seed=7, early=True):
    key = (sec, bright, seed, early)
    if key in _IR:
        return _IR[key]
    rng = np.random.default_rng(seed)
    n = N(sec)
    t = tax(n)
    ir = np.zeros(n)
    for lo, hi, m in ((30, 250, 1.0), (250, 1000, 0.85), (1000, 3500, 0.55 * bright + 0.1), (3500, 14000, 0.3 * bright + 0.05)):
        b = bandpass(white(n, rng), lo, hi)
        ir += b / (np.std(b) + 1e-12) * 10 ** (-3 * t / (sec * m))
    ir *= np.clip(t / 0.02, 0, 1)  # late tail fades in after the early field
    if early:
        for _ in range(14):
            d = rng.uniform(0.004, 0.07)
            ir[N(d)] += rng.uniform(-1, 1) * 3.0 * (1 - d / 0.08)
    ir = np.concatenate([np.zeros(N(0.008)), ir])
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-12
    _IR[key] = ir
    return ir


def convolve(x, h):
    n = len(x) + len(h) - 1
    size = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(h, size), size)[:n]


def reverb(x, mix=0.3, sec=2.4, bright=0.6, seed=7):
    h = cave_ir(sec, bright, seed)
    wet = convolve(x, h)
    dry = np.concatenate([x, np.zeros(len(wet) - len(x))])
    wet *= (np.std(x) + 1e-12) / (np.std(wet[: len(x)]) + 1e-12)
    return dry * (1 - mix) + wet * mix


def finish(x, peak_db=-1.0, fade_in=0.004, fade_out=0.05, trim=True, drive=0.0):
    x = x - np.mean(x)
    if drive:  # soft-clip compression: brings quiet bodies up under sharp transients
        x = sat(norm(x) * drive, 1.0)
    if trim:  # drop the silent reverb tail
        a = np.abs(x)
        thr = np.max(a) * 10 ** (-62 / 20)
        last = np.nonzero(a > thr)[0]
        if len(last):
            x = x[: min(len(x), last[-1] + N(0.02))]
    n = len(x)
    fi, fo = N(fade_in), N(fade_out)
    if n > fi + fo:
        x[:fi] *= np.linspace(0, 1, fi)
        x[-fo:] *= np.linspace(1, 0, fo) ** 2
    return norm(x, 10 ** (peak_db / 20))


# =========================================================================== creature designs
def s_breath(rng):
    """Stalking breath: a long wet inhale, a beat, a growling exhale.  Cave reverb."""
    dur = rng.uniform(2.9, 3.5)
    n = N(dur)
    x = np.zeros(n)
    ti = rng.uniform(1.0, 1.25)
    inh = breathy(ti, [(0, "u"), (1, "o")], rng, tract=0.7, slope=-0.25, amp_pts=[(0, 0), (0.75, 1), (1, 0.2)])
    place(x, highpass(inh, 180) * 0.8, 0.0)
    te = dur - ti - 0.2
    exh = breathy(te, [(0, "a"), (0.5, "o"), (1, "u")], rng, tract=0.68, slope=-0.4, amp_pts=[(0, 0), (0.12, 1), (0.6, 0.6), (1, 0)])
    growl = voice(te, [(0, 64), (0.5, 58), (1, 52)], [(0, "a"), (1, "o")], rng, tract=0.62, rough=0.9, breath=0.6,
                  amp_pts=[(0, 0), (0.2, 0.7), (0.7, 0.4), (1, 0)])
    wet = bubbles(N(te), rng, rng.integers(3, 7), 900, 2200) * 0.12
    place(x, exh + growl * 0.45 + wet, ti + 0.2)
    return finish(reverb(lowpass(x, 7000), 0.32, 2.6, 0.5), -5, drive=1.5)


def s_breath_behind(rng):
    """Right behind your head: dry, close, heavy, a wet catch at the end."""
    dur = rng.uniform(1.8, 2.3)
    n = N(dur)
    x = np.zeros(n)
    inh = breathy(0.7, [(0, "u"), (1, "er")], rng, tract=0.72, slope=-0.15, amp_pts=[(0, 0), (0.8, 0.8), (1, 0.3)])
    place(x, inh, 0.0)
    exh = breathy(dur - 0.85, [(0, "h"), (0.4, "a"), (1, "o")], rng, tract=0.7, slope=-0.25, amp_pts=[(0, 0), (0.08, 1), (0.5, 0.7), (1, 0)])
    rasp = voice(dur - 0.85, [(0, 75), (1, 58)], [(0, "a"), (1, "o")], rng, tract=0.65, rough=1.2, breath=0.8,
                 amp_pts=[(0, 0), (0.15, 0.6), (1, 0)])
    place(x, exh + rasp * 0.5 + bubbles(N(dur - 0.85), rng, 4, 1200, 2600) * 0.1, 0.8)
    return finish(reverb(x, 0.08, 0.6, 0.8), -3, drive=1.5)


def s_tail_scrape(rng):
    dur = rng.uniform(1.2, 1.7)
    n = N(dur)
    e = curve(n, [(0, 0), (0.15, 1), (0.7, 0.8), (1, 0)], True)
    fr = grains(n, rng, rng.uniform(140, 220), 0.006, 900, 6500, 0.002) * (1 + 0.6 * wobble(n, rng, 9))
    rumble = bandpass(colored(n, rng, -0.8), 70, 420) * 0.5
    return finish(reverb((fr + rumble) * e, 0.35, 2.4, 0.5), -6, drive=2.0)


def s_knock(rng):
    """Three knocks on stone; the third comes late."""
    dur = 2.2
    x = np.zeros(N(dur))
    times = [0.05, 0.05 + rng.uniform(0.28, 0.34), 0.0]
    times[2] = times[1] + rng.uniform(0.52, 0.7)
    for i, t0 in enumerate(times):
        k = thump(rng, f0=rng.uniform(150, 190), f1=95, dur=0.18, click=0.6) + resonator(N(0.18), 420, 0.02) * 0.2
        place(x, k * (0.9 if i < 2 else 1.1), t0)
    return finish(reverb(lowpass(x, 3500), 0.45, 2.0, 0.4), -4, drive=1.6)


def s_skitter(rng):
    """Fast scrabbling limbs: the sound of it moving while you weren't looking."""
    dur = rng.uniform(0.7, 0.95)
    n = N(dur)
    taps = np.zeros(n)
    t = 0.02
    while t < dur - 0.05:
        L = N(0.012)
        tap = highpass(white(L, rng), 1800) * np.exp(-np.arange(L) / (0.0025 * SR))
        tap += resonator(L, rng.uniform(2800, 5200), 0.003) * 0.6
        place(taps, tap * rng.uniform(0.4, 1.0), t)
        if rng.random() < 0.35:
            place(taps, thump(rng, 120, 70, 0.06, 0.4) * 0.35, t)
        t += rng.uniform(0.028, 0.06)
    scuff = bandpass(colored(n, rng, -0.5), 300, 2500) * curve(n, [(0, 0), (0.2, 0.35), (0.8, 0.3), (1, 0)])
    return finish(reverb(taps + scuff, 0.22, 1.4, 0.6), -4, drive=3.0)


def s_creak(rng):
    """Bones creaking into a new position, ending in a crack."""
    dur = rng.uniform(0.6, 0.85)
    n = N(dur)
    x = np.zeros(n)
    rate = curve(n, [(0, rng.uniform(25, 40)), (1, rng.uniform(90, 160))])
    ph = np.cumsum(rate) / SR
    idx = np.nonzero(np.diff(np.floor(ph)) > 0)[0]
    f = rng.uniform(800, 1400)
    for i in idx:
        L = N(0.02)
        place(x, resonator(L, f * rng.uniform(0.9, 1.1), 0.004) * rng.uniform(0.3, 1), i / SR)
    x *= curve(n, [(0, 0.2), (0.8, 1), (1, 0.6)])
    place(x, crack(rng, 1.2) * 1.6, dur * rng.uniform(0.82, 0.92))
    return finish(reverb(x, 0.2, 1.2, 0.6), -4, drive=3.0)


def s_neck_crack(rng):
    dur = 1.5
    x = np.zeros(N(dur))
    t = 0.03
    gap = rng.uniform(0.2, 0.26)
    for _ in range(rng.integers(6, 9)):
        place(x, crack(rng, rng.uniform(0.7, 1.3)) * rng.uniform(0.6, 1.0), t)
        t += gap
        gap *= rng.uniform(0.7, 0.82)
        if t > dur - 0.1:
            break
    creak = grains(N(dur), rng, 60, 0.01, 600, 2200, 0.004) * 0.15
    return finish(reverb(x + creak, 0.18, 1.2, 0.6), -3, drive=3.0)


def s_jaw(rng):
    """The jaw unhinges: a deep crack, a wet stretch, a groan through the open mouth."""
    dur = rng.uniform(1.2, 1.45)
    n = N(dur)
    x = np.zeros(n)
    place(x, crack(rng, 1.8) * 0.8, 0.02)
    sq = colored(N(0.5), rng, -0.2)
    c = curve(N(0.5), [(0, 300), (1, 1300)], True)
    sq = stft_filter(sq, lambda t, f: 1 / np.sqrt(1 + ((f - np.interp(t, np.linspace(0, 0.5, len(c)), c)) / 160) ** 2))
    place(x, sq * np.sin(np.linspace(0, np.pi, len(sq))) * 0.7 + bubbles(N(0.5), rng, 6, 300, 800) * 0.3, 0.08)
    groan = voice(dur - 0.35, [(0, 70), (0.5, 62), (1, 50)], [(0, "o"), (0.4, "a"), (1, "a")], rng, tract=0.6, rough=1.0,
                  breath=0.4, amp_pts=[(0, 0), (0.25, 0.8), (1, 0)])
    place(x, groan * 1.0, 0.3)
    return finish(reverb(x, 0.25, 1.8, 0.5), -3, drive=3.0)


def s_click(rng):
    """Throat clicks, accelerating: it is getting agitated."""
    dur = 1.1
    x = np.zeros(N(dur))
    t = 0.02
    gap = rng.uniform(0.17, 0.22)
    for _ in range(rng.integers(4, 7)):
        L = N(0.05)
        c = resonator(L, rng.uniform(1700, 2600), 0.006) + resonator(L, rng.uniform(520, 700), 0.012) * 0.7
        c += highpass(white(L, rng), 2000) * np.exp(-np.arange(L) / (0.0015 * SR)) * 0.4
        place(x, c * rng.uniform(0.6, 1.0), t)
        t += gap
        gap *= rng.uniform(0.78, 0.9)
    hum = voice(dur, [(0, 58), (1, 66)], [(0, "u"), (1, "o")], rng, tract=0.6, rough=0.6, breath=0.3,
                amp_pts=[(0, 0), (0.2, 0.18), (1, 0)])
    return finish(reverb(x + hum, 0.25, 1.6, 0.55), -4, drive=2.5)


def s_inhale(rng):
    """The long inhale before it screams: air and a rising vocal-fry rattle."""
    dur = rng.uniform(1.9, 2.3)
    n = N(dur)
    air = breathy(dur, [(0, "u"), (0.6, "o"), (1, "a")], rng, tract=0.7, slope=-0.2, amp_pts=[(0, 0), (0.85, 1), (1, 0.9)])
    rate = curve(n, [(0, 22), (1, 55)])
    ph = np.cumsum(rate) / SR
    fry = np.zeros(n)
    for i in np.nonzero(np.diff(np.floor(ph)) > 0)[0]:
        L = N(0.02)
        place(fry, resonator(L, rng.uniform(380, 520), 0.004), i / SR)
    fry = formant_filter(fry, vowel_track([(0, "o"), (1, "a")], 0.65), dur) * curve(n, [(0, 0), (1, 1)], True)
    x = air + fry * 0.8
    x[-N(0.03):] *= np.linspace(1, 0, N(0.03))  # cut off: the scream takes over
    return finish(reverb(x, 0.25, 2.0, 0.5), -4, fade_out=0.01)


def scream_core(rng, dur, f_lo, f_hi, f_end, vowels, tract, rough, far=False):
    n = N(dur)
    main = voice(dur, [(0, f_lo), (0.12, f_hi), (0.55, f_hi * 1.04), (1, f_end)], vowels, rng, tract=tract, tilt=0.85,
                 rough=rough, breath=0.25, jitter=0.02, shimmer=0.2, vib=(0.035, 6.5), sub=0.25, bright=1.25,
                 amp_pts=[(0, 0), (0.06, 1), (0.8, 0.85), (1, 0)])
    # a second, slightly detuned throat: the "two voices at once" wrongness
    second = voice(dur, [(0, f_lo * 1.5), (0.14, f_hi * 1.47), (1, f_end * 1.55)], vowels, rng, tract=tract * 1.15, tilt=1.0,
                   rough=rough * 0.6, breath=0.3, jitter=0.03, vib=(0.05, 7.3), amp_pts=[(0, 0), (0.1, 0.6), (0.85, 0.5), (1, 0)])
    growl = voice(dur, [(0, 55), (0.2, 72), (1, 50)], [(0, "o"), (1, "a")], rng, tract=0.55, rough=1.4, breath=0.4,
                  amp_pts=[(0, 0), (0.1, 1), (0.85, 0.7), (1, 0)])
    hiss = bandpass(colored(n, rng, 0.0), 2200, 9000) * curve(n, [(0, 0), (0.08, 0.5), (0.8, 0.35), (1, 0)])
    ring = main * np.sin(2 * np.pi * 37 * tax(n))  # inharmonic, metallic edge
    x = main + 0.55 * second + 0.5 * growl + 0.35 * hiss + 0.18 * ring
    x = sat(x / (np.max(np.abs(x)) + 1e-12) * 1.0, 2.2)
    if far:
        return reverb(lowpass(x, 2200), 0.7, 4.5, 0.3, seed=11)
    return reverb(x, 0.3, 2.8, 0.55)


def s_scream(rng):
    dur = rng.uniform(3.2, 3.6)
    v = [(0, "o"), (0.15, "a"), (0.6, "ae"), (1, "a")] if rng.random() < 0.5 else [(0, "u"), (0.18, "a"), (0.7, "a"), (1, "o")]
    return finish(scream_core(rng, dur, rng.uniform(170, 210), rng.uniform(430, 500), rng.uniform(300, 360), v, 1.0, 1.0), -0.5)


def s_scream_far(rng):
    x = scream_core(rng, 3.4, 190, 460, 320, [(0, "o"), (0.2, "a"), (1, "o")], 1.0, 0.9, far=True)
    return finish(x, -3)


def s_screech(rng):
    dur = rng.uniform(0.7, 1.0)
    v = [(0, "a"), (0.4, "ae"), (1, "i")] if rng.random() < 0.5 else [(0, "ae"), (1, "a")]
    x = scream_core(rng, dur, rng.uniform(280, 340), rng.uniform(600, 760), rng.uniform(420, 520), v, 1.15, 1.2)
    return finish(x, -1)


def s_step_soft(rng):
    x = thump(rng, rng.uniform(85, 110), 55, 0.16, 0.25) * 0.8 + grains(N(0.16), rng, 120, 0.004, 1500, 6000, 0.002) * 0.15
    return finish(reverb(x, 0.2, 1.2, 0.5), -10)


def s_step_heavy(rng):
    x = thump(rng, rng.uniform(70, 90), 38, 0.32, 0.5)
    slap = bandpass(white(N(0.05), rng), 500, 3500) * np.exp(-np.arange(N(0.05)) / (0.008 * SR))
    place(x, slap * 0.6, 0.0)
    place(x, grains(N(0.25), rng, 160, 0.004, 1200, 7000, 0.002) * 0.25, 0.02)
    return finish(reverb(x, 0.22, 1.6, 0.45), -3, drive=1.8)


def s_grab(rng):
    dur = 1.1
    x = np.zeros(N(dur))
    place(x, whoosh(rng, 0.3, 300, 2400) * 0.7, 0.0)
    place(x, thump(rng, 80, 42, 0.3, 0.8) * 1.0, 0.27)
    place(x, bandpass(white(N(0.12), rng), 400, 3000) * np.exp(-np.arange(N(0.12)) / (0.02 * SR)) * 0.6, 0.27)
    snarl = voice(0.7, [(0, 120), (0.3, 140), (1, 90)], [(0, "a"), (1, "o")], rng, tract=0.6, rough=1.3, breath=0.4,
                  amp_pts=[(0, 0), (0.15, 1), (1, 0)])
    place(x, snarl * 0.8, 0.32)
    return finish(reverb(sat(x, 1.5), 0.18, 1.4, 0.55), -1)


def s_hold(rng):
    """Held at its face: a wet, rumbling growl inches away, gurgling."""
    dur = 2.7
    n = N(dur)
    g = voice(dur, [(0, 78), (0.3, 70), (0.7, 84), (1, 66)], [(0, "o"), (0.4, "a"), (0.8, "er"), (1, "a")], rng, tract=0.58,
              rough=1.5, breath=0.5, jitter=0.03, sub=0.4, amp_pts=[(0, 0), (0.1, 1), (0.85, 0.9), (1, 0)])
    wet = bubbles(n, rng, 18, 250, 900) * 0.2 + bandpass(colored(n, rng, -0.3), 800, 4000) * 0.08 * (1 + wobble(n, rng, 6))
    return finish(reverb(sat(g + wet, 1.6), 0.1, 0.8, 0.7), -1)


def s_throw(rng):
    x = np.zeros(N(0.9))
    place(x, voice(0.35, [(0, 140), (1, 100)], [(0, "a"), (1, "o")], rng, tract=0.6, rough=1.0, breath=0.4,
                   amp_pts=[(0, 0), (0.2, 1), (1, 0)]) * 0.8, 0.0)
    place(x, whoosh(rng, 0.45, 400, 3000), 0.12)
    return finish(reverb(x, 0.15, 1.2, 0.6), -2)


def s_bite(rng):
    x = np.zeros(N(1.0))
    t = 0.0
    for _ in range(rng.integers(5, 8)):
        place(x, crack(rng, rng.uniform(1.2, 2.0)) * rng.uniform(0.6, 1.0), t)
        t += rng.uniform(0.012, 0.03)
    sq = bandpass(colored(N(0.4), rng, -0.2), 300, 2200) * np.exp(-np.arange(N(0.4)) / (0.1 * SR))
    place(x, sq * 0.7 + bubbles(N(0.4), rng, 8, 300, 900) * 0.4, 0.05)
    place(x, thump(rng, 90, 45, 0.25, 0.5) * 0.8, 0.0)
    return finish(reverb(sat(x, 1.8), 0.15, 1.2, 0.6), -0.5)


def s_swipe(rng):
    return finish(reverb(whoosh(rng, 0.45, 300, 3200), 0.15, 1.0, 0.6), -3)


def s_impact(rng):
    x = thump(rng, 85, 40, 0.35, 0.9)
    place(x, crack(rng, 1.5) * 0.6, 0.005)
    return finish(reverb(sat(x, 1.6), 0.15, 1.2, 0.6), -1)


def s_pain(rng):
    dur = rng.uniform(0.9, 1.2)
    x = scream_core(rng, dur, 380, rng.uniform(620, 720), 260, [(0, "a"), (0.5, "i"), (1, "er")], 1.1, 1.3)
    return finish(x, -1)


def s_sniff(rng):
    dur = 1.4
    x = np.zeros(N(dur))
    t = 0.02
    for i in range(rng.integers(3, 5)):
        L = rng.uniform(0.09, 0.14) if i < 3 else 0.35
        s = breathy(L, [(0, "i"), (1, "u")], rng, tract=0.9, slope=0.05, amp_pts=[(0, 0), (0.3, 1), (1, 0)], bright=1.2)
        place(x, highpass(s, 900) * (0.7 + 0.1 * i), t)
        t += L + rng.uniform(0.05, 0.1)
    return finish(reverb(x, 0.25, 1.4, 0.6), -5, drive=1.5)


def s_frustrated(rng):
    dur = rng.uniform(2.2, 2.6)
    main = voice(dur, [(0, 140), (0.25, 330), (0.7, 280), (1, 160)], [(0, "u"), (0.3, "a"), (0.8, "o"), (1, "u")], rng,
                 tract=0.85, tilt=0.95, rough=1.1, breath=0.25, vib=(0.04, 5.0), sub=0.35, amp_pts=[(0, 0), (0.15, 1), (0.8, 0.8), (1, 0)])
    growl = voice(dur, [(0, 60), (1, 50)], [(0, "a"), (1, "o")], rng, tract=0.55, rough=1.4, breath=0.4, amp_pts=[(0, 0), (0.2, 0.8), (1, 0)])
    return finish(reverb(sat(main + growl * 0.5, 1.8), 0.4, 3.2, 0.5), -1)


def s_retreat(rng):
    dur = rng.uniform(2.2, 2.7)
    x = voice(dur, [(0, 72), (1, 54)], [(0, "o"), (1, "u")], rng, tract=0.62, rough=0.7, breath=0.55,
              amp_pts=[(0, 0), (0.2, 0.9), (1, 0)])
    return finish(reverb(lowpass(x, 3000), 0.45, 3.0, 0.4), -5, drive=1.4)


def s_hurt(rng):
    dur = rng.uniform(0.4, 0.55)
    x = voice(dur, [(0, 260), (0.3, rng.uniform(460, 540)), (1, 220)], [(0, "a"), (1, "er")], rng, tract=0.9, tilt=0.9,
              rough=1.0, breath=0.3, amp_pts=[(0, 0), (0.1, 1), (1, 0)])
    return finish(reverb(sat(x, 1.8), 0.2, 1.4, 0.6), -2)


def s_death(rng):
    dur = 3.6
    x = np.zeros(N(dur + 0.8))
    wail = voice(dur, [(0, 330), (0.3, 300), (0.75, 170), (1, 90)], [(0, "a"), (0.5, "o"), (1, "u")], rng, tract=0.9,
                 tilt=0.95, rough=0.8, breath=0.3, vib=(0.05, 4.0), sub=0.3,
                 amp_pts=[(0, 0), (0.08, 1), (0.7, 0.6), (1, 0)])
    place(x, wail, 0.0)
    place(x, bubbles(N(1.2), rng, 14, 200, 700) * 0.35, dur - 1.2)
    place(x, thump(rng, 60, 30, 0.6, 0.6) * 1.2, dur + 0.05)
    place(x, grains(N(0.4), rng, 200, 0.005, 800, 6000, 0.003) * 0.4, dur + 0.06)
    return finish(reverb(x, 0.35, 3.0, 0.5), -1)


# =========================================================================== presence designs (heard by one player)
def s_whisper(rng):
    """Whispered gibberish that almost sounds like words."""
    dur = rng.uniform(2.2, 2.8)
    x = np.zeros(N(dur))
    t = 0.05
    vowels = ["a", "e", "i", "o", "u", "er", "ae"]
    while t < dur - 0.25:
        if rng.random() < 0.45:  # consonant
            kind = rng.choice(["s", "sh", "t", "k", "f"])
            L = {"s": 0.09, "sh": 0.11, "t": 0.03, "k": 0.035, "f": 0.07}[kind]
            band_ = {"s": (4500, 10000), "sh": (2000, 6000), "t": (2500, 8000), "k": (1200, 4000), "f": (1500, 9000)}[kind]
            c = bandpass(white(N(L), rng), *band_) * curve(N(L), [(0, 0), (0.2, 1), (1, 0)])
            place(x, c * (0.5 if kind in ("t", "k") else 0.35), t)
            t += L * rng.uniform(0.7, 1.1)
        L = rng.uniform(0.07, 0.16)
        v = rng.choice(vowels)
        w = rng.choice(vowels)
        s = breathy(L, [(0, v), (1, w)], rng, tract=1.05, slope=-0.05, amp_pts=[(0, 0), (0.3, 1), (1, 0.2)], bright=1.1)
        place(x, s, t)
        t += L + (rng.uniform(0.08, 0.2) if rng.random() < 0.25 else 0.0)
    ghost = np.concatenate([np.zeros(N(0.045)), x])[: len(x)] * 0.45  # a second whisperer, just behind the first
    return finish(reverb(highpass(x + ghost, 300), 0.22, 1.0, 0.8), -5)


def s_stinger(rng):
    """Jumpscare hit: a boom, a dissonant cluster, a shriek riding on top."""
    dur = 2.4
    n = N(dur)
    t = tax(n)
    boom = thump(rng, 70, 28, 1.2, 1.0)
    cl = np.zeros(n)
    for f in (110, 116.5, 155.6, 233.1, 246.9, 349.2):
        ph = 2 * np.pi * f * (1 + 0.003 * wobble(n, rng, 3)) * t
        saw = sum(np.sin(k * ph) / k for k in range(1, 18))
        cl += saw
    cl = lowpass(cl, 5000) * np.exp(-t / 0.7) * (1 + 0.3 * np.sin(2 * np.pi * 11 * t))
    shriek = scream_core(rng, 1.0, 420, 820, 600, [(0, "ae"), (1, "i")], 1.2, 1.2)[: N(1.0)]
    x = np.zeros(n)
    place(x, boom, 0.0)
    place(x, cl / (np.max(np.abs(cl)) + 1e-12) * 0.7, 0.0)
    place(x, shriek / (np.max(np.abs(shriek)) + 1e-12) * 0.5, 0.02)
    return finish(reverb(sat(x, 1.5), 0.3, 2.6, 0.6), -0.3)


def s_heartbeat(rng):
    x = np.zeros(N(0.62))
    place(x, thump(rng, 62, 42, 0.16, 0.08), 0.0)
    place(x, thump(rng, 55, 38, 0.14, 0.05) * 0.7, 0.24)
    return finish(lowpass(x, 180), -2, fade_out=0.02)


# =========================================================================== music (stream, looping)
def loop_crossfade(x, length, xf):
    """Makes x[:length] loop seamlessly by crossfading its head with the material after `length`."""
    L, X = N(length), N(xf)
    out = x[:L].copy()
    tail = x[L:L + X]
    k = np.linspace(0, 1, len(tail))
    out[: len(tail)] = out[: len(tail)] * np.sqrt(k) + tail * np.sqrt(1 - k)
    return out


def m_standoff(rng):
    """The stand-off: a low beating drone, the cave breathing, metal that groans, a far shimmer."""
    L, tail = 48.0, 6.0
    n = N(L + tail)
    t = tax(n)
    drone = np.zeros(n)
    for f, a in ((55.0, 1.0), (58.27, 0.8), (82.41, 0.3), (87.31, 0.22), (41.2, 0.5)):
        ph = 2 * np.pi * f * t * (1 + 0.0015 * wobble(n, rng, 0.2))
        drone += a * (np.sin(ph) + 0.45 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph) + 0.08 * np.sin(5 * ph))
    cut = lambda tc, f: 1 / np.sqrt(1 + (f / (140 + 260 * (0.5 + 0.5 * np.sin(2 * np.pi * tc / 16.0)))) ** 4)
    drone = stft_filter(drone, cut, frame=4096, hop=1024)
    pad_ = np.zeros(n)
    k = 0.0
    while k < L + tail - 6:
        d = rng.uniform(5, 7)
        b = breathy(d, [(0, "u"), (0.5, "o"), (1, "a")], rng, tract=0.62, slope=-0.6, amp_pts=[(0, 0), (0.45, 1), (1, 0)])
        place(pad_, b, k)
        k += d * rng.uniform(0.75, 0.95)
    shimmer = (np.sin(2 * np.pi * 1760 * t) + np.sin(2 * np.pi * 1864.66 * t)) * (0.5 + 0.5 * np.sin(2 * np.pi * t / 7.3)) ** 3
    metal = np.zeros(n)
    k = rng.uniform(3, 6)
    while k < L + tail - 4:
        d = rng.uniform(2.5, 3.8)
        f = rng.uniform(280, 620)
        src = colored(N(d), rng, -0.2) * curve(N(d), [(0, 0), (0.6, 1), (1, 0)], True)
        res = sum(resonator(N(0.6), f * m, 0.25) * a for m, a in ((1, 1), (2.76, 0.5), (5.4, 0.25)))
        place(metal, convolve(src, res)[: N(d) + N(0.6)], k)
        k += rng.uniform(7, 12)
    knocks = np.zeros(n)
    for _ in range(3):
        place(knocks, thump(rng, 95, 50, 0.35, 0.3), rng.uniform(4, L - 4))
    x = norm(drone) * 0.9 + norm(pad_) * 0.22 + norm(shimmer) * 0.025 + norm(metal) * 0.18 + norm(knocks) * 0.2
    x = reverb(x, 0.35, 3.5, 0.4, seed=21)
    return finish(loop_crossfade(x, L, 4.0), -2, fade_in=0, fade_out=0.001, trim=False)


def m_chase(rng):
    """The chase: 150 bpm war drums, a grinding minor-second ostinato, shrieking string clusters."""
    bpm = 150
    beat = 60 / bpm
    bars = 20
    L = bars * 4 * beat
    n = N(L + 4)
    t = tax(n)
    drums = np.zeros(n)
    pattern = [0, 1.5, 2, 3, 3.5]
    for b in range(bars + 1):
        for p in pattern:
            acc = 1.0 if p == 0 else 0.7
            place(drums, thump(rng, rng.uniform(85, 100), 42, 0.55, 0.55) * acc, (b * 4 + p) * beat)
        if b % 2 == 1:
            place(drums, thump(rng, 120, 60, 0.25, 0.8) * 0.5, (b * 4 + 3.75) * beat)
    metal = np.zeros(n)
    for b in range(bars + 1):
        for p in (1, 3):
            L2 = N(0.4)
            hit = sum(resonator(L2, f, 0.08) for f in (523, 1418, 2211, 3367)) + highpass(white(L2, rng), 3000) * np.exp(-tax(L2) / 0.01)
            place(metal, hit * (0.5 if b % 4 else 0.8), (b * 4 + p) * beat)
    bass = np.zeros(n)
    notes = [55.0, 55.0, 58.27, 55.0, 55.0, 55.0, 58.27, 61.74]
    step = beat / 2
    for i in range(int((L + 2) / step)):
        f = notes[i % len(notes)] * (0.5 if (i // 16) % 4 == 3 else 1.0)
        L3 = N(step * 0.95)
        tt = tax(L3)
        ph = 2 * np.pi * f * tt
        saw = sum(np.sin(k * ph) / k for k in range(1, 12)) * np.exp(-tt / 0.16)
        place(bass, saw, i * step)
    bass = lowpass(bass, 900)
    strings = np.zeros(n)
    for f in (220.0, 233.08, 311.13, 329.63, 466.16):
        ph = 2 * np.pi * f * t * (1 + 0.004 * wobble(n, rng, 0.5))
        strings += sum(np.sin(k * ph) / k for k in range(1, 10))
    swell = 0.4 + 0.6 * (0.5 - 0.5 * np.cos(2 * np.pi * t / (4 * 4 * beat)))
    strings = lowpass(strings, 3500) * (0.65 + 0.35 * np.sin(2 * np.pi * 12.5 * t)) * swell
    stabs = np.zeros(n)
    for b in range(0, bars + 1, 4):
        L4 = N(0.7)
        tt = tax(L4)
        f = 880 * np.exp(-tt / 0.5)
        ph = 2 * np.pi * np.cumsum(f) / SR
        st = sum(np.sin(k * ph * r) / k for r in (1, 1.06, 1.414) for k in range(1, 8)) * np.exp(-tt / 0.25)
        place(stabs, sat(st / 6, 2.0), b * 4 * beat)
    x = norm(drums) * 0.95 + norm(metal) * 0.25 + norm(bass) * 0.55 + norm(strings) * 0.35 + norm(stabs) * 0.3
    x = reverb(sat(x / np.max(np.abs(x)), 1.4), 0.2, 2.0, 0.5, seed=31)
    out = x[: N(L)].copy()
    rest = x[N(L):]
    out[: len(rest)] += rest[: N(L)]  # fold the tails of the last bar into the first: grid-aligned loop
    return finish(out, -1, fade_in=0, fade_out=0.001, trim=False)


# =========================================================================== registry & output
# name: (fn, variants, category, min_distance, max_distance, subtitle)
DESIGNS = {
    "breath": (s_breath, 3, "hostile", 4, 32, "Slow, wet breathing"),
    "breath_behind": (s_breath_behind, 2, "hostile", 1, 8, "Breathing right behind you"),
    "tail_scrape": (s_tail_scrape, 2, "hostile", 2, 28, "Something drags across stone"),
    "knock": (s_knock, 2, "hostile", 3, 28, "Three knocks"),
    "skitter": (s_skitter, 3, "hostile", 3, 28, "Fast scrabbling limbs"),
    "creak": (s_creak, 3, "hostile", 3, 26, "Bones creak"),
    "neck_crack": (s_neck_crack, 2, "hostile", 3, 28, "A neck cracks"),
    "jaw": (s_jaw, 2, "hostile", 3, 28, "A jaw unhinges"),
    "click": (s_click, 3, "hostile", 3, 32, "Throat clicking"),
    "inhale": (s_inhale, 2, "hostile", 4, 40, "A long inhale"),
    "scream": (s_scream, 2, "hostile", 8, 96, "THE WAIL"),
    "scream_far": (s_scream_far, 1, "hostile", 16, 128, "A scream, far away"),
    "screech": (s_screech, 4, "hostile", 6, 56, "Screeching"),
    "step_soft": (s_step_soft, 3, "hostile", 2, 18, "Soft footsteps"),
    "step_heavy": (s_step_heavy, 4, "hostile", 4, 40, "Hands pound the ground"),
    "grab": (s_grab, 2, "hostile", 3, 32, "It has you"),
    "hold": (s_hold, 2, "hostile", 2, 24, "A wet growl, inches away"),
    "throw": (s_throw, 2, "hostile", 2, 24, "Thrown"),
    "bite": (s_bite, 2, "hostile", 2, 24, "Teeth"),
    "swipe": (s_swipe, 2, "hostile", 2, 24, "Something swings"),
    "impact": (s_impact, 2, "hostile", 2, 24, "A crushing blow"),
    "pain": (s_pain, 2, "hostile", 4, 40, "A shriek of pain"),
    "sniff": (s_sniff, 3, "hostile", 2, 22, "Sniffing"),
    "frustrated": (s_frustrated, 2, "hostile", 6, 64, "An enraged howl"),
    "retreat": (s_retreat, 2, "hostile", 4, 40, "Something withdraws"),
    "hurt": (s_hurt, 3, "hostile", 3, 32, "It hurts"),
    "death": (s_death, 1, "hostile", 6, 64, "It collapses"),
    "whisper": (s_whisper, 3, "hostile", 1, 6, "Whispering"),
    "stinger": (s_stinger, 2, "hostile", 2, 16, None),
    "heartbeat": (s_heartbeat, 1, "hostile", 1, 4, None),
}
MUSIC = {
    "music.standoff": m_standoff,
    "music.chase": m_chase,
}


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def encode(x, ogg, tmp, q=4):
    wav = os.path.join(tmp, os.path.basename(ogg) + ".wav")
    write_wav(wav, x)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-c:a", "libvorbis", "-q:a", str(q), "-ac", "1",
                    "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", ogg], check=True)
    return wav


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep = None
    if "--wav" in sys.argv:
        keep = sys.argv[sys.argv.index("--wav") + 1]
        args = [a for a in args if a != keep]
        os.makedirs(keep, exist_ok=True)
    only = set(args)
    os.makedirs(OUT, exist_ok=True)
    if not only:
        for f in os.listdir(OUT):
            if f.endswith(".ogg"):
                os.remove(os.path.join(OUT, f))
    defs = {"format_version": "1.20.20", "sound_definitions": {}}
    subtitles = {}
    total = 0
    with tempfile.TemporaryDirectory() as tmp:
        for i, (name, (fn, variants, cat, mind, maxd, sub)) in enumerate(DESIGNS.items()):
            files = []
            for v in range(variants):
                fname = "%s_%d" % (name, v + 1)
                ogg = os.path.join(OUT, fname + ".ogg")
                if not only or name in only:
                    rng = np.random.default_rng(7000 + 97 * i + v)
                    x = fn(rng)
                    wav = encode(x, ogg, tmp)
                    if keep:
                        os.replace(wav, os.path.join(keep, fname + ".wav"))
                total += os.path.getsize(ogg) if os.path.exists(ogg) else 0
                files.append({"name": "sounds/tailwail/" + fname, "volume": 1.0, "load_on_low_memory": True})
            d = {"category": cat, "min_distance": mind, "max_distance": maxd, "sounds": files}
            if sub:
                d["subtitle"] = "subtitles.tailwail." + name
                subtitles["subtitles.tailwail." + name] = sub
            defs["sound_definitions"]["tailwail." + name] = d
        for j, (name, fn) in enumerate(MUSIC.items()):
            fname = name.replace(".", "_")
            ogg = os.path.join(OUT, fname + ".ogg")
            if not only or name in only:
                x = fn(np.random.default_rng(9100 + j))
                wav = encode(x, ogg, tmp, q=3)
                if keep:
                    os.replace(wav, os.path.join(keep, fname + ".wav"))
            total += os.path.getsize(ogg) if os.path.exists(ogg) else 0
            defs["sound_definitions"]["tailwail." + name] = {
                "category": "music", "sounds": [{"name": "sounds/tailwail/" + fname, "stream": True, "volume": 0.9}]}
    with open(DEFS, "w") as fh:
        json.dump(defs, fh, indent=1)
    sub_path = os.path.join(ROOT, "docs", "generated", "subtitles.json")
    os.makedirs(os.path.dirname(sub_path), exist_ok=True)
    with open(sub_path, "w") as fh:
        json.dump(subtitles, fh, indent=1, sort_keys=True)
    print("wrote %d sound events, %.0f KB of audio" % (len(defs["sound_definitions"]), total / 1024))


if __name__ == "__main__":
    sys.exit(main())
