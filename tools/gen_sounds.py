#!/usr/bin/env python3
"""
Procedural audio generator for Cubic World.

Synthesizes every sound effect, ambience loop and music loop for the game
from scratch (filtered noise + sine/triangle/bell synthesis). All content is
original; melodies are invented pentatonic sequences composed for this game.

Deterministic: a single seeded numpy PRNG drives every random decision.

Output: 16-bit mono WAV, 22050 Hz, written to <repo>/assets/audio/.
"""

import math
import os
import struct
import wave

import numpy as np

SR = 22050
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "audio")

rng = np.random.default_rng(0xC0B1C)

written = []  # (name, bytes)


# ---------------------------------------------------------------------------
# Basic DSP helpers
# ---------------------------------------------------------------------------

def save(name, x, peak=0.85):
    """Normalize to `peak`, convert to 16-bit and write a mono WAV."""
    x = np.asarray(x, dtype=np.float64)
    m = np.max(np.abs(x))
    if m > 1e-9:
        x = x * (peak / m)
    x = np.clip(x, -1.0, 1.0)
    data = (x * 32767.0).astype("<i2").tobytes()
    path = os.path.join(OUT_DIR, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)
    written.append((name + ".wav", os.path.getsize(path)))


def fade_edges(x, fin=0.004, fout=0.012):
    """Short cosine fades at both ends so playback never clicks."""
    x = x.copy()
    a = min(len(x) // 2, max(8, int(fin * SR)))
    r = min(len(x) // 2, max(8, int(fout * SR)))
    x[:a] *= 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, a))
    x[-r:] *= 0.5 + 0.5 * np.cos(np.linspace(0, math.pi, r))
    return x


def env(n, attack, decay, hold=0.0):
    """Attack ramp, optional hold, then exponential decay."""
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0.0, 1.0)
    d = np.exp(-np.maximum(t - attack - hold, 0.0) / max(decay, 1e-4))
    return a * d


def filt(x, lo=None, hi=None, order=4):
    """FFT-domain Butterworth-magnitude band filter (deterministic, no scipy)."""
    n = len(x)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1.0 / SR)
    mask = np.ones_like(f)
    if lo is not None:
        fs = np.maximum(f, 1e-6)
        mask *= 1.0 / np.sqrt(1.0 + (lo / fs) ** (2 * order))
    if hi is not None:
        mask *= 1.0 / np.sqrt(1.0 + (f / hi) ** (2 * order))
    return np.fft.irfft(spec * mask, n)


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def brown(dur):
    x = np.cumsum(rng.standard_normal(int(dur * SR)))
    x = filt(x, lo=18.0, order=2)  # remove drift/DC
    m = np.max(np.abs(x))
    return x / m if m > 1e-9 else x


def tone(freq, dur, kind="sine", detune=0.0):
    t = np.arange(int(dur * SR)) / SR
    ph = 2 * math.pi * freq * t
    if kind == "triangle":
        s = 2.0 / math.pi * np.arcsin(np.sin(ph))
    else:
        s = np.sin(ph)
    if detune:
        s = 0.6 * s + 0.4 * np.sin(2 * math.pi * freq * (1.0 + detune) * t)
    return s


def sweep(f0, f1, dur, kind="sine"):
    n = int(dur * SR)
    fr = np.linspace(f0, f1, n)
    ph = 2 * math.pi * np.cumsum(fr) / SR
    if kind == "triangle":
        return 2.0 / math.pi * np.arcsin(np.sin(ph))
    return np.sin(ph)


def mix(buf, sig, at):
    """Add `sig` into `buf` starting at time `at` (seconds), truncating."""
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i]


def delay_verb(x, taps=((0.091, 0.30), (0.173, 0.20), (0.311, 0.12))):
    """Cheap reverb-ish multi-tap delay."""
    y = x.copy()
    for dt, g in taps:
        d = int(dt * SR)
        if d < len(x):
            y[d:] += x[:-d] * g
    return y


def loopify(x, fade=1.5):
    """Crossfade the tail into the head (equal power) for a seamless loop."""
    n = len(x)
    f = int(fade * SR)
    f = min(f, n // 3)
    out = x[: n - f].copy()
    t = np.linspace(0, 1, f)
    up = np.sqrt(t)
    down = np.sqrt(1.0 - t)
    out[:f] = out[:f] * up + x[n - f:] * down
    return out


def wrap_tail(buf, loop_sec):
    """Fold everything past the loop point back onto the start (seamless)."""
    m = int(loop_sec * SR)
    out = buf[:m].copy()
    tail = buf[m:]
    k = min(len(tail), m)
    out[:k] += tail[:k]
    return out


# ---------------------------------------------------------------------------
# Sound effects: material bursts
# ---------------------------------------------------------------------------

def bubbles(count, f_lo, f_hi, span, amp):
    """Short rising sine blips scattered over `span` seconds (for liquids)."""
    n = int((span + 0.12) * SR)
    buf = np.zeros(n)
    for _ in range(count):
        f0 = rng.uniform(f_lo, f_hi)
        d = rng.uniform(0.03, 0.07)
        b = sweep(f0, f0 * rng.uniform(1.6, 2.4), d) * env(int(d * SR), 0.004, d * 0.5)
        mix(buf, b * amp * rng.uniform(0.6, 1.0), rng.uniform(0.0, span))
    return buf


# Per-material burst recipe:
#   lo/hi  : band limits of the noise body
#   attack : envelope attack (s)
#   decay  : envelope decay (s)
#   dur    : total length of the break version (s)
#   extra  : callable(dur) -> additional signal layered in
MATERIALS = {
    "earth": dict(lo=None, hi=380, attack=0.006, decay=0.10, dur=0.30,
                  extra=lambda d: sweep(110, 55, d) * env(int(d * SR), 0.004, 0.09) * 0.8),
    "stone": dict(lo=650, hi=3600, attack=0.001, decay=0.055, dur=0.22,
                  extra=lambda d: filt(noise(d), lo=1200, hi=5200) *
                  env(int(d * SR), 0.001, 0.018) * 0.9),
    "wood": dict(lo=140, hi=950, attack=0.002, decay=0.09, dur=0.26,
                 extra=lambda d: (tone(196, d) * env(int(d * SR), 0.002, 0.07) * 0.55 +
                                  tone(347, d) * env(int(d * SR), 0.002, 0.05) * 0.35)),
    "plant": dict(lo=1100, hi=6200, attack=0.020, decay=0.10, dur=0.28, extra=None),
    "metal": dict(lo=500, hi=6000, attack=0.001, decay=0.03, dur=0.55,
                  extra=lambda d: sum(
                      tone(f, d) * env(int(d * SR), 0.001, dec) * a
                      for f, dec, a in ((624, 0.30, 0.50), (1123, 0.24, 0.38),
                                        (1877, 0.18, 0.26), (2742, 0.13, 0.18)))),
    "glass": dict(lo=2400, hi=9200, attack=0.001, decay=0.09, dur=0.40,
                  extra="glass_pings"),
    "cloth": dict(lo=None, hi=520, attack=0.010, decay=0.075, dur=0.20, extra=None),
    "liquid": dict(lo=380, hi=4200, attack=0.008, decay=0.13, dur=0.42,
                   extra=lambda d: bubbles(5, 280, 700, d * 0.8, 0.5)[: int(d * SR)]),
}


def glass_pings(dur):
    n = int(dur * SR)
    buf = np.zeros(n)
    for _ in range(5):
        f = rng.uniform(2600, 7200)
        d = rng.uniform(0.06, 0.16)
        p = tone(f, d) * env(int(d * SR), 0.001, d * 0.35)
        mix(buf, p * rng.uniform(0.15, 0.35), rng.uniform(0.0, dur * 0.5))
    return buf


def material_burst(mat, dur_scale=1.0, soft=False):
    p = MATERIALS[mat]
    dur = p["dur"] * dur_scale
    n = int(dur * SR)
    attack = p["attack"] * (2.0 if soft else 1.0)
    decay = p["decay"] * dur_scale
    body = noise(dur)
    body = filt(body, lo=p["lo"] if p["lo"] else 30.0, hi=p["hi"])
    m = np.max(np.abs(body))
    if m > 1e-9:
        body /= m
    x = body * env(n, attack, decay)
    extra = p["extra"]
    if extra == "glass_pings":
        x = x + glass_pings(dur) * (0.5 if soft else 1.0)
    elif callable(extra):
        e = extra(dur)
        x = x + e[:n] * (0.55 if soft else 1.0)
    return fade_edges(x)


def gen_effects():
    for mat in MATERIALS:
        save("break_" + mat, material_burst(mat), peak=0.85)
        save("place_" + mat, material_burst(mat, dur_scale=0.6, soft=True), peak=0.55)

    # dig_earth: two quick low scuffs
    dur = 0.34
    buf = np.zeros(int(dur * SR))
    for at in (0.0, 0.16):
        s = filt(noise(0.13), hi=500) * env(int(0.13 * SR), 0.008, 0.05)
        mix(buf, s, at)
    mix(buf, sweep(95, 60, 0.1) * env(int(0.1 * SR), 0.005, 0.06) * 0.5, 0.0)
    save("dig_earth", fade_edges(buf), peak=0.7)

    # footsteps: quiet filtered scuffs per surface
    def step(lo, hi, dur, thump=None):
        n = int(dur * SR)
        x = filt(noise(dur), lo=lo, hi=hi)
        m = np.max(np.abs(x))
        if m > 1e-9:
            x /= m
        x = x * env(n, 0.005, dur * 0.35)
        if thump:
            x = x + tone(thump, dur) * env(n, 0.003, dur * 0.3) * 0.5
        return fade_edges(x)

    save("step_grass", step(900, 5200, 0.13), peak=0.32)
    save("step_stone", step(420, 2600, 0.11, thump=170), peak=0.34)
    save("step_wood", step(150, 900, 0.13, thump=200), peak=0.34)
    # sand: granular crunch (noise gated by rectified slow noise)
    dsand = 0.16
    g = np.abs(filt(noise(dsand), hi=60))
    g = g / max(np.max(g), 1e-9)
    sand = filt(noise(dsand), lo=500, hi=3200) * (0.35 + 0.65 * g)
    sand *= env(int(dsand * SR), 0.008, 0.06)
    save("step_sand", fade_edges(sand), peak=0.32)

    # tool_break: snap + descending chirp
    dur = 0.45
    buf = np.zeros(int(dur * SR))
    snap = filt(noise(0.05), lo=900, hi=6500) * env(int(0.05 * SR), 0.001, 0.015)
    mix(buf, snap * 1.0, 0.0)
    ch = sweep(1250, 280, 0.32, kind="triangle") * env(int(0.32 * SR), 0.006, 0.14)
    mix(buf, ch * 0.7, 0.05)
    save("tool_break", fade_edges(buf), peak=0.8)

    # hit: dull thump with pitch drop
    dur = 0.16
    n = int(dur * SR)
    x = sweep(150, 62, dur) * env(n, 0.003, 0.07)
    x += filt(noise(dur), hi=420) * env(n, 0.002, 0.03) * 0.5
    save("hit", fade_edges(x), peak=0.8)

    # hurt: short low non-vocal tone with downward bend
    dur = 0.22
    n = int(dur * SR)
    x = sweep(160, 105, dur, kind="triangle") * env(n, 0.006, 0.10)
    x += sweep(320, 210, dur) * env(n, 0.006, 0.06) * 0.3
    save("hurt", fade_edges(x), peak=0.75)

    # creature_die: soft descending tone
    dur = 0.55
    n = int(dur * SR)
    x = sweep(420, 140, dur) * env(n, 0.015, 0.30)
    x += sweep(840, 280, dur) * env(n, 0.015, 0.16) * 0.25
    x = delay_verb(x, taps=((0.11, 0.2),))
    save("creature_die", fade_edges(x), peak=0.6)

    # eat: two soft munch bursts
    dur = 0.32
    buf = np.zeros(int(dur * SR))
    for at in (0.0, 0.16):
        mn = filt(noise(0.11), lo=180, hi=1400) * env(int(0.11 * SR), 0.010, 0.035)
        mix(buf, mn, at)
    save("eat", fade_edges(buf), peak=0.5)

    # click: tiny UI tick
    dur = 0.10
    n = int(dur * SR)
    x = tone(1900, dur) * env(n, 0.001, 0.014)
    x += filt(noise(dur), lo=2500, hi=7000) * env(n, 0.001, 0.008) * 0.4
    save("click", fade_edges(x), peak=0.5)

    # splash: bigger liquid event
    dur = 0.55
    n = int(dur * SR)
    x = filt(noise(dur), lo=300, hi=5200) * env(n, 0.010, 0.18)
    mix(x, bubbles(8, 240, 650, 0.42, 0.55), 0.0)
    save("splash", fade_edges(x), peak=0.8)

    # chirp: pleasant 2-note creature call (D6 -> G6 with vibrato)
    dur = 0.32
    buf = np.zeros(int(dur * SR))
    for f, at, d in ((1174.7, 0.0, 0.13), (1568.0, 0.15, 0.15)):
        nn = int(d * SR)
        t = np.arange(nn) / SR
        vib = f * (1.0 + 0.012 * np.sin(2 * math.pi * 26 * t))
        ph = 2 * math.pi * np.cumsum(vib) / SR
        mix(buf, np.sin(ph) * env(nn, 0.012, d * 0.45), at)
    save("chirp", fade_edges(buf), peak=0.55)

    # pop: item pickup blip
    dur = 0.12
    n = int(dur * SR)
    x = sweep(480, 980, dur) * env(n, 0.004, 0.045)
    save("pop", fade_edges(x), peak=0.65)


# ---------------------------------------------------------------------------
# Ambience loops (seamless)
# ---------------------------------------------------------------------------

def gen_ambience():
    # wind: filtered brown noise, slowly modulated (whole cycles over the loop)
    dur = 18.0
    n = int(dur * SR)
    t = np.arange(n) / SR
    low = filt(brown(dur), hi=260, order=3)
    mid = filt(brown(dur), lo=250, hi=850, order=3)
    m1 = 1.0 + 0.35 * np.sin(2 * math.pi * 3 * t / dur)          # 3 cycles/loop
    m2 = 1.0 + 0.45 * np.sin(2 * math.pi * 5 * t / dur + 1.3)    # 5 cycles/loop
    wind = low * m1 * 0.8 + mid * m2 * 0.45
    save("ambience_wind", loopify(wind, fade=2.0), peak=0.5)

    # rain: steady dense patter
    dur = 18.0
    n = int(dur * SR)
    bed = filt(noise(dur), lo=900, hi=7800) * 0.30
    drops = np.zeros(n)
    for _ in range(250):
        d = rng.uniform(0.004, 0.012)
        dn = int(d * SR)
        tick = filt(noise(d + 0.01)[:dn], lo=1800, hi=7000) * env(dn, 0.0005, d)
        mix(drops, tick * rng.uniform(0.2, 0.7), rng.uniform(0.0, dur - 0.05))
    save("ambience_rain", loopify(bed + drops, fade=1.5), peak=0.5)

    # cave: sparse low drones + occasional distant echoes
    dur = 22.0
    n = int(dur * SR)
    t = np.arange(n) / SR

    def whole(f):  # snap frequency to a whole number of cycles per loop
        return round(f * dur) / dur

    drone = (np.sin(2 * math.pi * whole(55.0) * t) * 0.5 +
             np.sin(2 * math.pi * whole(57.7) * t) * 0.35 +
             np.sin(2 * math.pi * whole(82.4) * t) * 0.22)
    drone *= 1.0 + 0.25 * np.sin(2 * math.pi * 2 * t / dur)
    rumble = filt(brown(dur), hi=150, order=3) * 0.35

    buf = np.zeros(n + int(4 * SR))
    mix(buf, drone, 0)
    mix(buf, rumble, 0)
    for _ in range(5):
        f = rng.uniform(380, 900)
        d = rng.uniform(0.25, 0.5)
        ping = tone(f, d) * env(int(d * SR), 0.02, d * 0.4)
        ping = delay_verb(np.concatenate([ping, np.zeros(int(2.5 * SR))]),
                          taps=((0.33, 0.45), (0.71, 0.28), (1.19, 0.15)))
        mix(buf, ping * rng.uniform(0.06, 0.14), rng.uniform(0.0, dur))
    save("ambience_cave", wrap_tail(buf, dur), peak=0.5)


# ---------------------------------------------------------------------------
# Music (original compositions, seamless 32 s loops)
# ---------------------------------------------------------------------------

def mf(midi):
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def synth_note(freq, dur, timbre, amp):
    if timbre == "pad":
        rel = 0.8
        n = int((dur + rel) * SR)
        t = np.arange(n) / SR
        s = (np.sin(2 * math.pi * freq * t) * 0.62 +
             np.sin(2 * math.pi * freq * 1.004 * t) * 0.30 +
             np.sin(2 * math.pi * freq * 2.0 * t) * 0.16 +
             np.sin(2 * math.pi * freq * 3.0 * t) * 0.05)
        a = min(0.8, dur * 0.3)
        e = np.clip(t / a, 0, 1) ** 2
        e *= np.where(t < dur, 1.0, np.clip(1.0 - (t - dur) / rel, 0, 1) ** 2)
        return s * e * amp
    if timbre == "pluck":
        n = int(dur * SR)
        s = tone(freq, dur, kind="triangle")
        return s * env(n, 0.008, dur * 0.38) * amp
    if timbre == "bell":
        n = int(dur * SR)
        t = np.arange(n) / SR
        s = np.zeros(n)
        for r, a, dec in ((1.0, 1.0, 0.9), (2.02, 0.45, 0.45),
                          (3.01, 0.22, 0.28), (4.17, 0.12, 0.18)):
            s += np.sin(2 * math.pi * freq * r * t) * a * np.exp(-t / (dur * dec))
        e = np.clip(t / 0.012, 0, 1)
        return s * e * amp
    if timbre == "bass":
        n = int(dur * SR)
        s = tone(freq, dur) * 0.8 + tone(freq * 2, dur) * 0.25
        return s * env(n, 0.006, dur * 0.55) * amp
    raise ValueError(timbre)


def render_song(events, loop_sec, spb, verb=((0.28, 0.22), (0.47, 0.13)), tail=4.0):
    """events: (start_beat, dur_beats, midi, amp, timbre). Seamless loop out."""
    buf = np.zeros(int((loop_sec + tail) * SR))
    for beat, durb, midi, amp, timbre in events:
        sig = synth_note(mf(midi), durb * spb, timbre, amp)
        mix(buf, sig, beat * spb)
    buf = delay_verb(buf, taps=verb)
    return fade_edges(wrap_tail(buf, loop_sec), fin=0.002, fout=0.002)


def music_day():
    # C major pentatonic (C D E G A). 60 BPM, 8 bars of 4/4 = 32 s.
    spb, loop = 1.0, 32.0
    ev = []
    # warm pad chords, one per bar
    chords = [(48, 55, 64), (45, 52, 60), (41, 48, 57), (43, 50, 59),
              (48, 55, 64), (41, 48, 57), (45, 52, 60), (43, 50, 62)]
    for bar, ch in enumerate(chords):
        for k, m in enumerate(ch):
            ev.append((bar * 4, 4.0, m, 0.16 - 0.02 * k, "pad"))
    # slow arpeggios: root, fifth, tenth on beats 0/1.5/2.5
    for bar, ch in enumerate(chords):
        arp = (ch[0] + 12, ch[1] + 12, ch[2] + 12)
        for k, b in enumerate((0.0, 1.5, 2.5)):
            ev.append((bar * 4 + b, 1.2, arp[k], 0.10, "pluck"))
    # original pentatonic melody (invented contour, rises then settles)
    mel = [
        (0.0, 2.0, 64), (2.0, 1.0, 67), (3.0, 1.0, 69),      # E4 G4 A4
        (4.0, 1.5, 67), (5.5, 0.5, 64), (6.0, 2.0, 62),      # G4 E4 D4
        (8.0, 1.0, 60), (9.0, 1.0, 62), (10.0, 1.0, 64), (11.0, 1.0, 67),
        (12.0, 2.5, 69), (14.5, 1.5, 72),                    # A4 -> C5 lift
        (16.0, 2.0, 74), (18.0, 1.0, 72), (19.0, 1.0, 69),   # D5 C5 A4
        (20.0, 1.5, 67), (21.5, 0.5, 69), (22.0, 2.0, 64),
        (24.0, 1.0, 62), (25.0, 1.0, 64), (26.0, 2.0, 67),
        (28.0, 1.5, 62), (29.5, 0.5, 64), (30.0, 2.0, 60),   # settle on C4
    ]
    for b, d, m in mel:
        ev.append((b, d, m + 12, 0.20, "pluck"))
    save("music_day", render_song(ev, loop, spb), peak=0.55)


def music_night():
    # A minor pentatonic (A C D E G). Sparser and softer. 32 s.
    spb, loop = 1.0, 32.0
    ev = []
    chords = [(45, 52, 60), (45, 52, 60), (43, 50, 57), (40, 47, 55),
              (45, 52, 60), (41, 48, 57), (43, 50, 57), (45, 52, 60)]
    for bar, ch in enumerate(chords):
        for k, m in enumerate(ch):
            ev.append((bar * 4, 4.0, m - 12 if k == 0 else m, 0.11 - 0.02 * k, "pad"))
    # sparse lone notes drifting down, with space between phrases
    mel = [
        (1.0, 2.0, 76), (5.0, 1.5, 72), (7.0, 2.0, 74),
        (12.0, 2.0, 69), (15.0, 1.0, 67),
        (17.0, 2.5, 72), (21.0, 2.0, 64),
        (26.0, 2.0, 67), (29.0, 2.5, 69),
    ]
    for b, d, m in mel:
        ev.append((b, d, m, 0.13, "bell"))
    save("music_night", render_song(ev, loop, spb,
                                    verb=((0.37, 0.28), (0.61, 0.17))), peak=0.45)


def music_underground():
    # Low drones + slow bell tones over A. 32 s.
    spb, loop = 1.0, 32.0
    ev = []
    for b in (0, 8, 16, 24):
        ev.append((b, 8.0, 33, 0.20, "pad"))   # A1 drone
        ev.append((b, 8.0, 40, 0.12, "pad"))   # E2
    ev.append((8, 8.0, 45, 0.07, "pad"))
    ev.append((24, 8.0, 43, 0.07, "pad"))
    bells = [(2.0, 57), (6.5, 60), (11.0, 64), (14.5, 62),
             (19.0, 57), (23.5, 67), (27.0, 64), (30.0, 60)]
    for b, m in bells:
        ev.append((b, 3.5, m, 0.11, "bell"))
    save("music_underground", render_song(ev, loop, spb,
                                          verb=((0.41, 0.30), (0.79, 0.18))), peak=0.5)


def music_danger():
    # Tense pulsing low ostinato in E minor color. 120 BPM, 16 bars = 32 s.
    spb, loop = 0.5, 32.0
    ev = []
    # eighth-note bass pulse: E2 with recurring F2 (b2) and Bb2 tension
    pattern = [40, 40, 43, 40, 41, 40, 46, 41]  # E E G E F E Bb F
    for bar in range(16):
        heavy = bar % 4 == 3
        for k in range(8):
            m = pattern[k] if (k % 2 == 0 or heavy) else pattern[0]
            a = 0.20 if k == 0 else 0.13
            ev.append((bar * 4 + k * 0.5, 0.48, m - 12, a, "bass"))
    # slow dissonant pad swells
    for b, m1, m2 in ((0, 52, 53), (16, 52, 58)):
        ev.append((b, 16.0, m1, 0.07, "pad"))
        ev.append((b + 8, 8.0, m2, 0.06, "pad"))
    # sparse high tension stabs
    for b, m in ((7.0, 71), (15.0, 77), (23.0, 74), (30.0, 71)):
        ev.append((b, 1.5, m, 0.08, "bell"))
    save("music_danger", render_song(ev, loop, spb,
                                     verb=((0.19, 0.18), (0.31, 0.10))), peak=0.6)


# ---------------------------------------------------------------------------

REQUIRED = (
    [f"break_{m}" for m in MATERIALS] + [f"place_{m}" for m in MATERIALS] +
    ["dig_earth", "step_grass", "step_stone", "step_wood", "step_sand",
     "tool_break", "hit", "hurt", "creature_die", "eat", "click", "splash",
     "chirp", "pop", "ambience_wind", "ambience_rain", "ambience_cave",
     "music_day", "music_night", "music_underground", "music_danger"]
)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    gen_effects()
    gen_ambience()
    music_day()
    music_night()
    music_underground()
    music_danger()

    have = {n for n, _ in written}
    missing = [n for n in (r + ".wav" for r in REQUIRED) if n not in have]
    if missing:
        raise SystemExit("missing files: " + ", ".join(missing))

    print(f"\nWrote {len(written)} files to {OUT_DIR}\n")
    total = 0
    for name, size in sorted(written):
        total += size
        print(f"  {name:28s} {size / 1024.0:9.1f} KB")
    print(f"\n  total: {total / (1024.0 * 1024.0):.2f} MB")
    if total > 9 * 1024 * 1024:
        raise SystemExit("over the 9 MB audio budget")


if __name__ == "__main__":
    main()
