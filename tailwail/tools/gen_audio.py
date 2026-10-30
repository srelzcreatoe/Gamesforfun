#!/usr/bin/env python3
"""Synthesises Tailwail's original sound palette (no samples, no third-party audio).

  python3 -I tools/gen_audio.py          # writes packs/TailwailRP/sounds/tailwail/*.ogg
                                          # and packs/TailwailRP/sounds/sound_definitions.json

Every sound is generated from noise and oscillators with fixed seeds, then encoded to
Ogg Vorbis with ffmpeg (libvorbis).  Loudness is normalised per category so the wail is
the only cue that approaches full scale.
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


# ------------------------------------------------------------------ DSP helpers
def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def band(x, lo, hi, soft=0.25):
    """FFT band-pass with soft log-frequency edges."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR) + 1e-6
    lf = np.log2(f)
    m = 1 / (1 + np.exp(-(lf - np.log2(lo)) / soft)) * 1 / (1 + np.exp((lf - np.log2(hi)) / soft))
    return np.fft.irfft(X * m, n)


def formants(x, peaks):
    """peaks: [(freq, bandwidth_hz, gain)] resonant emphasis via FFT."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.full_like(f, 0.08)
    for fc, bw, gain in peaks:
        g += gain / (1 + ((f - fc) / (bw / 2)) ** 2)
    return np.fft.irfft(X * g, n)


def lowpass(x, fc):
    return band(x, 10, fc, 0.3)


def env_ar(n, attack, release, curve=2.0):
    a = int(attack * SR)
    r = int(release * SR)
    e = np.ones(n)
    if a:
        e[:a] = np.linspace(0, 1, a) ** curve
    if r:
        e[-r:] *= np.linspace(1, 0, r) ** curve
    return e


def osc(freq_curve, harmonics=12, tilt=1.0, rng=None, jitter=0.0):
    """Band-limited-ish harmonic oscillator following an instantaneous frequency curve."""
    f = np.asarray(freq_curve, dtype=float)
    if jitter and rng is not None:
        j = np.cumsum(rng.normal(0, 1, len(f))) / np.sqrt(len(f)) * 6
        f = f * (1 + jitter * lowpass(j, 25))
    phase = 2 * np.pi * np.cumsum(f) / SR
    out = np.zeros_like(f)
    for h in range(1, harmonics + 1):
        mask = (f * h) < SR * 0.45
        out += mask * np.sin(phase * h) / h ** tilt
    return out


def glide(n, points):
    """points: [(t_fraction, value)] -> piecewise-linear curve of length n."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return np.interp(np.linspace(0, 1, n), xs, ys)


def grains(n, rng, rate, length, lo, hi, decay=0.004):
    """Granular crackle: many short decaying noise grains (scrapes, crunches)."""
    out = np.zeros(n)
    t = 0.0
    while t < n / SR:
        t += rng.exponential(1 / rate)
        i = int(t * SR)
        L = int(length * SR * rng.uniform(0.5, 1.5))
        if i + L >= n:
            break
        g = rng.normal(0, 1, L) * np.exp(-np.arange(L) / (decay * SR)) * rng.uniform(0.3, 1)
        out[i:i + L] += g
    return band(out, lo, hi, 0.2)


def thump(n, rng, f0=60, f1=38, dur=0.25):
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.03)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (dur / 3))
    click = rng.normal(0, 1, n) * np.exp(-t / 0.004)
    return s + 0.3 * band(click, 200, 3000)


def reverb(x, size=0.35, mix=0.25, seed=1):
    """Cheap cave reverb: decaying noise impulse convolution."""
    r = np.random.default_rng(seed)
    L = int(size * SR)
    ir = r.normal(0, 1, L) * np.exp(-np.arange(L) / (L / 5))
    ir = band(ir, 120, 5000)
    ir /= np.max(np.abs(ir)) + 1e-9
    dry = np.concatenate([x, np.zeros(L)])
    wet = np.convolve(x, ir)[: len(dry)]
    wet = np.concatenate([wet, np.zeros(len(dry) - len(wet))])
    wet *= np.max(np.abs(dry)) / (np.max(np.abs(wet)) + 1e-9)
    return dry * (1 - mix) + wet * mix


def finish(x, peak_db, fade=0.02):
    x = x - np.mean(x)
    n = len(x)
    f = int(fade * SR)
    if f and n > 2 * f:
        x[:f] *= np.linspace(0, 1, f)
        x[-f:] *= np.linspace(1, 0, f)
    x = x / (np.max(np.abs(x)) + 1e-9) * 10 ** (peak_db / 20)
    return x


# ------------------------------------------------------------------ sound designs
def s_breath(rng):
    n = int(rng.uniform(2.6, 3.3) * SR)
    x = np.zeros(n)
    inhale = int(n * 0.38)
    pause = int(n * 0.12)
    ex = n - inhale - pause
    a = rng.normal(0, 1, inhale) * glide(inhale, [(0, 0), (0.7, 1), (1, 0.2)])
    a = formants(band(a, 300, 2200), [(700, 500, 1.0), (1500, 700, 0.6)])
    b = rng.normal(0, 1, ex) * glide(ex, [(0, 0), (0.15, 1), (1, 0)]) ** 1.5
    rasp = 1 + 0.35 * np.sin(2 * np.pi * rng.uniform(28, 38) * np.arange(ex) / SR)
    b = formants(band(b * rasp, 140, 1300), [(380, 300, 1.0), (900, 500, 0.5)])
    x[:inhale] += a * 0.8
    x[inhale + pause:] += b
    return finish(reverb(lowpass(x, 2400), 0.6, 0.35, rng.integers(1e6)), -10)


def s_tail_scrape(rng):
    n = int(rng.uniform(1.2, 1.8) * SR)
    e = glide(n, [(0, 0), (0.25, 1), (0.7, 0.8), (1, 0)])
    x = grains(n, rng, rate=260, length=0.006, lo=700, hi=5000) * e
    x += 0.4 * band(rng.normal(0, 1, n), 120, 600) * e
    return finish(reverb(x, 0.4, 0.25, rng.integers(1e6)), -9)


def s_nail(rng):
    n = int(rng.uniform(1.0, 1.5) * SR)
    t = np.arange(n) / SR
    rate = rng.uniform(45, 75) * (1 + 0.3 * np.sin(2 * np.pi * 1.3 * t))
    pulses = np.zeros(n)
    ph = np.cumsum(rate) / SR
    idx = np.where(np.diff(np.floor(ph)) > 0)[0]
    for i in idx:
        L = min(220, n - i)
        pulses[i:i + L] += rng.normal(0, 1, L) * np.exp(-np.arange(L) / 30.0)
    x = formants(pulses, [(rng.uniform(2300, 2900), 220, 1.0), (rng.uniform(4100, 4800), 300, 0.7), (1400, 300, 0.3)])
    x *= glide(n, [(0, 0), (0.1, 1), (0.85, 0.9), (1, 0)])
    return finish(reverb(x, 0.45, 0.3, rng.integers(1e6)), -11)


def s_click(rng):
    n = int(rng.uniform(0.7, 1.0) * SR)
    x = np.zeros(n)
    t = 0.04
    for _ in range(rng.integers(3, 7)):
        i = int(t * SR)
        L = int(0.05 * SR)
        if i + L >= n:
            break
        tt = np.arange(L) / SR
        f = rng.uniform(170, 260)
        c = np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.012) + 0.6 * rng.normal(0, 1, L) * np.exp(-tt / 0.002)
        x[i:i + L] += c * rng.uniform(0.6, 1)
        t += rng.uniform(0.07, 0.19)
    x = formants(x, [(450, 250, 1.0), (1200, 500, 0.5)])
    return finish(reverb(x, 0.3, 0.25, rng.integers(1e6)), -8)


def s_inhale(rng):
    n = int(rng.uniform(1.3, 1.6) * SR)
    nz = rng.normal(0, 1, n)
    fc = glide(n, [(0, 250), (0.85, 2600), (1, 2600)])
    out = np.zeros(n)
    seg = 2048
    for s in range(0, n, seg):
        e = min(n, s + seg)
        c = fc[s]
        out[s:e] = band(nz[max(0, s - seg):e], c * 0.5, c * 1.6)[-(e - s):]
    e = glide(n, [(0, 0), (0.8, 1), (0.93, 1), (1, 0)]) ** 1.4
    voiced = osc(glide(n, [(0, 110), (1, 150)]), harmonics=10, tilt=1.3) * 0.15
    x = formants(out * e + voiced * e, [(800, 600, 1.0), (2200, 900, 0.6)])
    return finish(reverb(x, 0.5, 0.3, rng.integers(1e6)), -6, fade=0.005)


def s_wail(rng):
    n = int(rng.uniform(3.3, 3.7) * SR)
    t = np.arange(n) / SR
    f0 = glide(n, [(0, 150), (0.08, 330), (0.35, 420), (0.7, 390), (1, 240)])
    vib = 1 + 0.022 * np.sin(2 * np.pi * (5.2 + 1.5 * t / t[-1]) * t)
    v1 = osc(f0 * vib, harmonics=28, tilt=0.85, rng=rng, jitter=0.012)
    v2 = osc(f0 * vib * 1.498 * (1 + 0.006 * np.sin(2 * np.pi * 0.7 * t)), harmonics=18, tilt=1.0, rng=rng, jitter=0.02)
    sub = osc(f0 * 0.5, harmonics=8, tilt=1.2) * (0.5 + 0.5 * np.sin(2 * np.pi * 31 * t))
    voice = v1 + 0.45 * v2 + 0.35 * sub
    # vowel shift: open "aah" to a strained "eeh"
    a = formants(voice, [(800, 120, 1.0), (1150, 140, 0.7), (2900, 300, 0.35)])
    e = formants(voice, [(400, 100, 0.9), (2300, 220, 0.8), (3200, 300, 0.45)])
    k = glide(n, [(0, 0), (0.45, 0.2), (0.8, 0.85), (1, 1)])
    x = a * (1 - k) + e * k
    rough = band(rng.normal(0, 1, n), 1200, 7000) * 0.25
    x = (x + rough) * glide(n, [(0, 0), (0.05, 0.8), (0.12, 1), (0.8, 0.9), (1, 0)])
    x = np.tanh(x / (np.max(np.abs(x)) + 1e-9) * 2.2)
    return finish(reverb(x, 1.1, 0.32, rng.integers(1e6)), -1.0)


def s_exertion(rng):
    n = int(rng.uniform(0.55, 0.85) * SR)
    f0 = glide(n, [(0, rng.uniform(95, 120)), (1, rng.uniform(70, 85))])
    v = osc(f0, harmonics=16, tilt=1.1, rng=rng, jitter=0.03)
    v = formants(v, [(520, 200, 1.0), (1000, 300, 0.5)])
    br = band(rng.normal(0, 1, n), 300, 2500) * 0.6
    e = glide(n, [(0, 0), (0.08, 1), (0.4, 0.7), (1, 0)]) ** 1.5
    return finish(reverb((v + br) * e, 0.35, 0.2, rng.integers(1e6)), -6)


def s_step_heavy(rng):
    n = int(0.42 * SR)
    x = thump(n, rng, f0=rng.uniform(55, 75), f1=rng.uniform(32, 40), dur=0.3)
    x += 0.35 * grains(n, rng, rate=900, length=0.003, lo=500, hi=4500) * np.exp(-np.arange(n) / (0.05 * SR))
    return finish(reverb(x, 0.4, 0.22, rng.integers(1e6)), -4, fade=0.003)


def s_step_soft(rng):
    n = int(0.28 * SR)
    x = 0.6 * thump(n, rng, f0=rng.uniform(80, 100), f1=50, dur=0.15)
    x += 0.25 * grains(n, rng, rate=600, length=0.003, lo=800, hi=5000) * np.exp(-np.arange(n) / (0.04 * SR))
    return finish(lowpass(x, 3000), -12, fade=0.003)


def s_swipe(rng):
    n = int(0.5 * SR)
    nz = rng.normal(0, 1, n)
    out = np.zeros(n)
    fc = glide(n, [(0, 350), (0.6, 2600), (1, 1500)])
    seg = 1024
    for s in range(0, n, seg):
        e = min(n, s + seg)
        c = fc[s]
        out[s:e] = band(nz[max(0, s - seg):e], c * 0.6, c * 1.5)[-(e - s):]
    out *= np.exp(-((np.arange(n) / SR - 0.24) / 0.09) ** 2)
    return finish(out, -6, fade=0.005)


def s_impact(rng):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    x = thump(n, rng, f0=70, f1=35, dur=0.35)
    crack = band(rng.normal(0, 1, n), 1500, 9000) * np.exp(-t / 0.012)
    crunch = grains(n, rng, rate=1400, length=0.002, lo=900, hi=6000) * np.exp(-t / 0.08)
    return finish(np.tanh((x + 0.6 * crack + 0.5 * crunch) * 1.8), -2, fade=0.002)


def s_snarl(rng):
    n = int(rng.uniform(1.1, 1.4) * SR)
    t = np.arange(n) / SR
    f0 = glide(n, [(0, 80), (0.3, 115), (1, 70)])
    v = osc(f0, harmonics=30, tilt=0.9, rng=rng, jitter=0.05)
    rough = 0.6 + 0.4 * np.sign(np.sin(2 * np.pi * rng.uniform(22, 30) * t))
    v = formants(v * rough, [(600, 220, 1.0), (1400, 350, 0.6), (2600, 500, 0.3)])
    br = band(rng.normal(0, 1, n), 400, 3500) * 0.3
    e = glide(n, [(0, 0), (0.1, 1), (0.7, 0.8), (1, 0)])
    return finish(reverb(np.tanh((v + br) * e * 2), 0.5, 0.25, rng.integers(1e6)), -4)


def s_retreat(rng):
    n = int(rng.uniform(2.4, 2.9) * SR)
    t = np.arange(n) / SR
    drag = grains(n, rng, rate=180, length=0.006, lo=600, hi=3500) * glide(n, [(0, 0.8), (1, 0)])
    hum = osc(glide(n, [(0, 120), (1, 70)]), harmonics=8, tilt=1.4) * glide(n, [(0, 0), (0.2, 0.5), (1, 0)])
    hum = formants(hum, [(350, 200, 1.0), (800, 300, 0.4)])
    return finish(reverb(lowpass(drag + hum, 2500), 0.8, 0.4, rng.integers(1e6)), -10)


def s_hurt(rng):
    n = int(rng.uniform(0.5, 0.7) * SR)
    f0 = glide(n, [(0, 320), (0.2, 360), (1, 190)])
    v = osc(f0, harmonics=20, tilt=0.9, rng=rng, jitter=0.03)
    v = formants(v, [(700, 160, 1.0), (1700, 260, 0.6)])
    e = glide(n, [(0, 0), (0.05, 1), (1, 0)]) ** 1.3
    return finish(reverb(np.tanh(v * e * 2), 0.4, 0.2, rng.integers(1e6)), -4)


def s_death(rng):
    n = int(2.8 * SR)
    t = np.arange(n) / SR
    f0 = glide(n, [(0, 300), (0.3, 240), (0.8, 90), (1, 60)])
    v = osc(f0, harmonics=24, tilt=1.0, rng=rng, jitter=0.04)
    v = formants(v, [(650, 200, 1.0), (1100, 300, 0.6)]) * glide(n, [(0, 0), (0.05, 1), (0.75, 0.6), (0.85, 0.1), (1, 0)])
    thud = np.zeros(n)
    i = int(2.05 * SR)
    thud[i:] = thump(n - i, rng, f0=55, f1=30, dur=0.5)
    return finish(reverb(v + 1.4 * thud, 0.9, 0.3, rng.integers(1e6)), -2)


DESIGNS = {
    # id: (function, variants, category, min_distance, max_distance, subtitle)
    "breath": (s_breath, 3, "hostile", 2, 30),
    "tail_scrape": (s_tail_scrape, 3, "hostile", 2, 26),
    "nail_scrape": (s_nail, 2, "hostile", 2, 28),
    "click": (s_click, 3, "hostile", 3, 32),
    "inhale": (s_inhale, 2, "hostile", 4, 40),
    "wail": (s_wail, 2, "hostile", 8, 72),
    "exertion": (s_exertion, 3, "hostile", 4, 40),
    "step_heavy": (s_step_heavy, 4, "hostile", 4, 40),
    "step_soft": (s_step_soft, 3, "hostile", 1, 20),
    "swipe": (s_swipe, 2, "hostile", 2, 24),
    "impact": (s_impact, 2, "hostile", 2, 24),
    "snarl": (s_snarl, 2, "hostile", 4, 40),
    "retreat": (s_retreat, 2, "hostile", 4, 40),
    "hurt": (s_hurt, 2, "hostile", 3, 32),
    "death": (s_death, 1, "hostile", 8, 64),
}


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    os.makedirs(OUT, exist_ok=True)
    defs = {"format_version": "1.20.20", "sound_definitions": {}}
    total = 0
    with tempfile.TemporaryDirectory() as tmp:
        for i, (name, (fn, variants, cat, mind, maxd)) in enumerate(sorted(DESIGNS.items())):
            files = []
            for v in range(variants):
                rng = np.random.default_rng(1000 * (i + 1) + v)
                x = fn(rng)
                wav = os.path.join(tmp, "%s_%d.wav" % (name, v + 1))
                ogg = os.path.join(OUT, "%s_%d.ogg" % (name, v + 1))
                write_wav(wav, x)
                subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-c:a", "libvorbis", "-q:a", "4", "-ac", "1",
                                "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", ogg], check=True)
                total += os.path.getsize(ogg)
                files.append({"name": "sounds/tailwail/%s_%d" % (name, v + 1), "volume": 1.0, "load_on_low_memory": True})
            defs["sound_definitions"]["tailwail." + name] = {
                "category": cat, "min_distance": mind, "max_distance": maxd,
                "subtitle": "subtitles.tailwail." + name, "sounds": files}
    json.dump(defs, open(DEFS, "w"), indent=1)
    print("wrote %d sound events, %.1f KB of audio" % (len(DESIGNS), total / 1024))


if __name__ == "__main__":
    sys.exit(main())
