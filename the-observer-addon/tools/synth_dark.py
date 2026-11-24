#!/usr/bin/env python3
"""Dark music and voices (1.7.0): the Observer's four tracks made over, and the Brinesleeper's whole soundtrack and
voice, all original — written here note by note and rendered from oscillators and noise. No samples, no existing songs.

The style it is after is the old horror fan-games' (the ones a cheerful game "went wrong" in): not a chiptune any
more but slow, deep and wrong — sub-bass drones that beat against each other, chords of minor seconds and tritones
swelling in and dying away, a sinister pipe organ, a wordless choir far off, bells and a piano heard backwards,
everything drowned in an enormous reverb, with static, breath and a heartbeat under it. The chases are driving and
brutal: pounding drums, a distorted tritone bass, organ stabs, strings shrieking upward.

  Observer       stalk (its presence), chase, mire (its home), end (the fifth stage)
  Shaftbreaker   presence (something below), hollows (its home, alive), close, standoff, chase
  Brinesleeper   stillwater_1..3 (calm, deep water), near_1..2 (it is near), chase, sting_1..3,
                 and its voice: clicks, breath, call, moan, hiss, roar, lunge, grasp, emerge, submerge, step,
                 hurt, death, spotted, jumpscare

Requires numpy and ffmpeg with libvorbis. Deterministic (seeded).
Usage: python3 tools/synth_dark.py [observer|brine|voice|shaft ...]   (default: all)
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth_music as SM  # noqa: E402  (oscillators, envelopes, tape effects, the encoder)

SR = SM.SR
ROOT = SM.ROOT
RP = os.path.join(ROOT, "packs", "TheObserver_RP")
rng = np.random.default_rng(17000)
secs, midi, osc = SM.secs, SM.midi, SM.osc


# ----------------------------------------------------------------------------- filters and space (FFT: fast in numpy)

def spectral(x, gain_fn):
    n = len(x)
    X = np.fft.rfft(x, n)
    f = np.fft.rfftfreq(n, 1 / SR)
    return np.fft.irfft(X * gain_fn(f), n)


def lowpass(x, fc, order=2):
    return spectral(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)))


def highpass(x, fc, order=2):
    return spectral(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * order)))


def bandpass(x, fc, width):
    return spectral(x, lambda f: np.exp(-0.5 * ((f - fc) / width) ** 2))


VOWELS = {"a": [(800, 80, 1.0), (1150, 90, 0.5), (2900, 120, 0.25), (3900, 130, 0.12)],
          "o": [(450, 70, 1.0), (800, 80, 0.4), (2830, 100, 0.15), (3800, 120, 0.08)],
          "u": [(325, 50, 1.0), (700, 60, 0.25), (2530, 100, 0.08), (3500, 120, 0.04)],
          "e": [(400, 60, 1.0), (1600, 80, 0.35), (2700, 120, 0.25), (3300, 120, 0.1)]}


def formant(x, vowel):
    peaks = VOWELS[vowel] if isinstance(vowel, str) else vowel
    return spectral(x, lambda f: sum(g * np.exp(-0.5 * ((f - fc) / bw) ** 2) for fc, bw, g in peaks))


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    m = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[:n]
    return y


_IR = {}


def impulse(seconds, bright=4000, seed=0):
    key = (seconds, bright, seed)
    if key not in _IR:
        r = np.random.default_rng(1700 + seed)
        n = secs(seconds)
        t = np.arange(n) / SR
        ir = r.standard_normal(n) * np.exp(-t * 6.9 / seconds)
        ir = lowpass(ir, bright, 1)
        ir[: secs(0.012)] *= np.linspace(0, 1, secs(0.012))
        _IR[key] = ir / np.sqrt(np.sum(ir ** 2))
    return _IR[key]


def space(x, seconds=4.0, mix=0.45, bright=4000, seed=0):
    """An enormous dark room: convolution with a decaying noise tail; returns a longer signal (the tail rings out)."""
    wet = convolve(x, impulse(seconds, bright, seed))
    dry = np.zeros(len(wet))
    dry[: len(x)] += x
    return dry * (1 - mix) + wet * mix


def stereo(l, r=None):
    if r is None:
        r = l
    n = max(len(l), len(r))
    out = np.zeros((n, 2))
    out[: len(l), 0] = l
    out[: len(r), 1] = r
    return out


def wide(x, seconds=4.0, mix=0.45, bright=4000):
    """Mono in, a wide stereo room out (two different tails)."""
    return stereo(space(x, seconds, mix, bright, 1), space(x, seconds, mix, bright, 2))


def add(buf, x, at):
    i = secs(at)
    if i >= len(buf):
        return
    n = min(len(x), len(buf) - i)
    buf[i: i + n] += x[:n]


def fit(x, n):
    out = np.zeros((n,) + x.shape[1:])
    m = min(n, len(x))
    out[:m] = x[:m]
    return out


def tail_into_start(x, n):
    """For a loop: whatever rings on past its length is folded back onto its start."""
    out = x[:n].copy()
    rest = x[n:]
    k = min(len(rest), n)
    out[:k] += rest[:k]
    return out


def swell(n, a=0.4, r=0.5):
    """A slow rise and fall (fractions of n)."""
    t = np.linspace(0, 1, n)
    return np.clip(t / max(a, 1e-3), 0, 1) ** 2 * np.clip((1 - t) / max(r, 1e-3), 0, 1) ** 1.5


def detune(note, cents):
    return midi(note) * 2 ** (cents / 1200)


# ----------------------------------------------------------------------------- instruments

def sub_drone(dur, note=26, beat=0.21, level=1.0):
    """Two sines a hair apart beating slowly, a third below, and a dark rumble."""
    n = secs(dur)
    t = np.arange(n) / SR
    f = midi(note)
    x = np.sin(2 * np.pi * f * t) + 0.8 * np.sin(2 * np.pi * (f + beat) * t + 1.3) + 0.35 * np.sin(2 * np.pi * f / 2 * t)
    rumble = lowpass(rng.standard_normal(n), 70, 2) * 6
    x = x * (0.8 + 0.2 * np.sin(2 * np.pi * 0.07 * t)) + rumble
    return x * level / 3


def pad(notes, dur, cents=12, voices=3, bright=900, a=0.45, r=0.45):
    """Detuned saws, darkly filtered, swelling in and out."""
    n = secs(dur)
    x = np.zeros(n)
    for k, nt in enumerate(notes):
        for v in range(voices):
            c = (v - (voices - 1) / 2) * cents + rng.uniform(-3, 3)
            x += osc("saw", detune(nt, c), dur, phase=rng.random())
    x = lowpass(x, bright, 2) / (len(notes) * voices) ** 0.5
    return x * swell(n, a, r)


def organ(notes, dur, a=0.08, r=0.25, vib=4.8, bright=1.0):
    """A pipe organ: stacked harmonics (8', 4', 2 2/3', 2', 1 3/5') with a slight tremulant."""
    n = secs(dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    trem = 1 + 0.06 * np.sin(2 * np.pi * vib * t)
    for nt in notes:
        f = midi(nt)
        for h, g in ((0.5, 0.5), (1, 1.0), (2, 0.6), (3, 0.35 * bright), (4, 0.3 * bright), (5, 0.12 * bright), (6, 0.1 * bright), (8, 0.06 * bright)):
            x += g * np.sin(2 * np.pi * f * h * t + rng.random() * 6.28)
    e = np.minimum(1, t / a) * np.minimum(1, (dur - t) / r)
    return x * trem * np.clip(e, 0, 1) / (2.4 * len(notes) ** 0.5)


def choir(notes, dur, vowel="a", a=0.8, r=0.9, spread=9):
    """A wordless choir: several voices per note, each wavering, filtered through a vowel."""
    n = secs(dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for nt in notes:
        for v in range(4):
            f0 = detune(nt, rng.uniform(-spread, spread))
            vibr = 1 + 0.006 * np.sin(2 * np.pi * rng.uniform(4.5, 5.8) * t + rng.random() * 6.28) + 0.003 * lowpass(rng.standard_normal(n), 3, 1) * 30
            x += osc("saw", f0 * vibr, dur, phase=rng.random())
    x = formant(x, vowel) * 1.4
    e = np.clip(np.minimum(t / a, (dur - t) / r), 0, 1)
    return x * e / (4 * len(notes)) ** 0.5


def bell(note, dur=4.0, bright=1.0):
    """A cold bell: inharmonic partials, long decay."""
    n = secs(dur)
    t = np.arange(n) / SR
    f = midi(note)
    x = np.zeros(n)
    for ratio, g, dec in ((1, 1.0, 1.6), (2.0, 0.45, 1.2), (2.76, 0.5 * bright, 0.9), (5.4, 0.25 * bright, 0.5), (8.93, 0.12 * bright, 0.3)):
        x += g * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / (dec * dur / 4))
    return x * np.minimum(1, t / 0.002) / 2


def piano(note, dur=3.0, detune_c=7):
    """A worn piano note: two strings out of tune with each other, a soft hammer."""
    n = secs(dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for c in (-detune_c / 2, detune_c / 2):
        f = detune(note, c)
        for h, g in ((1, 1.0), (2, 0.5), (3, 0.25), (4, 0.15), (5, 0.08)):
            x += g * np.sin(2 * np.pi * f * h * t) * np.exp(-t * (1.1 + h * 0.6))
    x += lowpass(rng.standard_normal(n), 2500, 1) * np.exp(-t * 80) * 0.6
    return x * np.minimum(1, t / 0.003) / 3


def backwards(x):
    return x[::-1].copy()


def heartbeat(level=1.0):
    n = secs(0.9)
    t = np.arange(n) / SR
    thump = np.sin(2 * np.pi * 52 * t) * np.exp(-t * 18)
    x = thump.copy()
    add(x, thump * 0.7, 0.26)
    return lowpass(x, 180, 2) * level


def kick(level=1.0):
    n = secs(0.5)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 30)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
    x += lowpass(rng.standard_normal(n), 3000, 1) * np.exp(-t * 120) * 0.3
    return np.tanh(x * 2) * level


def tom(note=40, level=1.0):
    n = secs(0.6)
    t = np.arange(n) / SR
    f = midi(note) * (1 + 0.6 * np.exp(-t * 20))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6)
    x += bandpass(rng.standard_normal(n), 900, 400) * np.exp(-t * 30) * 0.5
    return x * level


def anvil(note=76, level=1.0):
    """A metallic hit (FM)."""
    n = secs(1.2)
    t = np.arange(n) / SR
    f = midi(note)
    x = np.sin(2 * np.pi * f * t + 4 * np.exp(-t * 6) * np.sin(2 * np.pi * f * 1.41 * t)) * np.exp(-t * 5)
    return x * level


def screech(dur, start, end, level=1.0):
    """Strings shrieking upward: detuned saws gliding, filtered, a little torn."""
    n = secs(dur)
    f = np.geomspace(midi(start), midi(end), n)
    x = sum(osc("saw", f * 2 ** (c / 1200), dur, phase=rng.random()) for c in (-14, 0, 11))
    x = bandpass(x, 2600, 1500) * swell(n, 0.25, 0.15)
    return np.tanh(x * 1.5) * level


def scream(dur, start, end, vowel="a", level=1.0):
    """A distant scream: a voice gliding, through a vowel."""
    n = secs(dur)
    f = np.geomspace(midi(start), midi(end), n) * (1 + 0.012 * np.sin(2 * np.pi * 6.5 * np.arange(n) / SR))
    x = osc("saw", f, dur)
    return formant(x, vowel) * swell(n, 0.15, 0.6) * level


def breath(dur, level=1.0, low=500, high=2200):
    n = secs(dur)
    x = bandpass(rng.standard_normal(n), (low + high) / 2, (high - low) / 2)
    return x * swell(n, 0.45, 0.4) * level


def static(dur, level=1.0):
    n = secs(dur)
    x = rng.standard_normal(n)
    x = np.sign(x) * (np.abs(x) > 1.6) + 0.4 * x
    return highpass(x, 1200, 1) * level * 0.4


# ----------------------------------------------------------------------------- the Observer

def obs_stalk():
    """Its presence: a drone in D that beats, a cluster swelling and dying, a bell melody heard backwards, a choir far
    off, a piano note now and then, its heartbeat. 96 s, loops."""
    L = 96.0
    n = secs(L)
    m = np.zeros(n)
    m += sub_drone(L, 26, 0.19, 0.9)
    for k, at in enumerate(range(0, 96, 12)):
        chord = [[50, 51, 56], [50, 53, 56, 57], [49, 50, 56], [50, 51, 55, 56]][k % 4]
        add(m, pad(chord, 14.0, cents=16, bright=700, a=0.55, r=0.4) * 0.55, at)
    motif = [74, 73, 70, 69, 66, 65]
    for at in (8, 40, 72):
        line = np.zeros(secs(10))
        for i, nt in enumerate(motif):
            add(line, bell(nt, 3.0, 0.8) * 0.5, i * 0.9)
        add(m, backwards(line) * 0.35, at)
    for at in (24, 60):
        add(m, choir([50, 53, 57], 18, "u") * 0.5, at)
    for at, nt in ((5, 38), (19, 39), (33, 44), (51, 38), (67, 37), (83, 44)):
        add(m, piano(nt, 5.0) * 0.45, at)
    for at in np.arange(2, 96, 1.6):
        add(m, heartbeat(0.22), at)
    for at in (30, 77):
        add(m, static(0.25, 0.25), at)
    for at in (46, 90):
        add(m, scream(3.5, 74, 62, "a", 0.08), at)
    m = SM.wow(m, depth=0.003, rate=0.3)
    out = wide(m, 5.5, 0.5, 3500)
    return tail_into_start(out, n)


def obs_chase():
    """It is coming: pounding drums, a distorted tritone bass, organ stabs, strings shrieking, a choir crying out.
    150 bpm, 16 bars, loops."""
    bpm = 150.0
    beat = 60 / bpm
    bars = 16
    L = bars * 4 * beat
    n = secs(L)
    m = np.zeros(n)
    bassline = [38, 38, 44, 38, 37, 38, 44, 43]
    for b in range(bars):
        t0 = b * 4 * beat
        for i in range(4):
            add(m, kick(0.9), t0 + i * beat)
        for i in (1.5, 3.5):
            add(m, tom(43, 0.6), t0 + i * beat)
        if b % 2:
            add(m, tom(36, 0.7), t0 + 3.75 * beat)
        for i in range(8):
            nt = bassline[(b * 8 + i) % 8 if b % 4 < 2 else (i + 4) % 8]
            note = osc("saw", detune(nt, 0), beat * 0.48) + osc("square", detune(nt - 12, 6), beat * 0.48, duty=0.3)
            note = np.tanh(lowpass(note, 1100, 2) * 3) * SM.env(len(note), a=0.003, d=0.1, s=0.7, r=0.03)
            add(m, note * 0.35, t0 + i * beat / 2)
        stab = [50, 53, 56] if b % 4 < 2 else [49, 52, 55]
        for i in (0.5, 2.5):
            add(m, organ(stab, beat * 0.6, a=0.01, r=0.1, bright=1.3) * 0.5, t0 + i * beat)
        if b % 4 == 3:
            add(m, screech(4 * beat, 62, 86, 0.25), t0)
            add(m, anvil(80, 0.35), t0 + 3 * beat)
        if b % 8 == 0:
            add(m, choir([62, 65, 68], 8 * beat, "a", a=0.1, r=0.8) * 0.55, t0)
    arp = [74, 77, 80, 81]
    for i in range(int(L / (beat / 2))):
        if (i // 16) % 2 == 1:
            add(m, osc("square", midi(arp[i % 4]), beat / 2 * 0.6, duty=0.2) * SM.env(secs(beat / 2 * 0.6), a=0.002, d=0.05, s=0.3, r=0.02) * 0.06, i * beat / 2)
    m = SM.stutter(m, L - beat, 0.05, 6)
    m = np.tanh(m * 1.2)
    out = wide(m, 2.4, 0.28, 5000)
    return tail_into_start(out, n)


def obs_mire():
    """Its home: low voices, slow wrong bells, water dripping in the dark, all of it as if heard underwater. 96 s."""
    L = 96.0
    n = secs(L)
    m = np.zeros(n)
    m += sub_drone(L, 25, 0.13, 0.8)
    for at in range(0, 96, 16):
        add(m, choir([49, 52, 55, 56], 18, "o") * 0.55, at)
    for i, at in enumerate(np.arange(3, 96, 7.5)):
        add(m, bell([61, 60, 57, 56, 64, 55][i % 6], 6.0, 0.6) * 0.3, at)
    for at in rng.uniform(0, 94, 30):
        t = np.arange(secs(0.25)) / SR
        drip = np.sin(2 * np.pi * (1800 - 1400 * t / 0.25) * t) * np.exp(-t * 30)
        add(m, drip * 0.12, at)
    for at in (20, 70):
        add(m, scream(4.0, 67, 55, "u", 0.07), at)
    m = lowpass(m, 1600, 2)
    m = SM.wow(m, depth=0.006, rate=0.18)
    return tail_into_start(wide(m, 6.0, 0.55, 2500), n)


def obs_end():
    """The fifth stage: a slow organ dirge with a choir, a line falling a semitone at a time, and a little music-box
    tune over it that goes more wrong each time, until everything slows and sinks into the drone. 112 s."""
    L = 112.0
    n = secs(L)
    m = np.zeros(n)
    m += sub_drone(L, 26, 0.17, 0.7)
    chords = [[50, 53, 57], [49, 53, 56], [48, 51, 55], [47, 50, 56], [46, 50, 53], [45, 49, 52], [44, 47, 50], [43, 46, 50]]
    for i, ch in enumerate(chords):
        add(m, organ(ch, 13.0, a=1.2, r=2.0) * 0.6, i * 12)
        add(m, choir([c + 12 for c in ch], 13.0, "a") * 0.35, i * 12 + 0.5)
    tune = [74, 77, 79, 81, 79, 77, 74, 73]
    for k, at in enumerate((6, 34, 62, 88)):
        line = np.zeros(secs(10))
        for i, nt in enumerate(tune):
            add(line, bell(nt - k, 2.0, 1.0) * 0.4, i * (0.5 + 0.15 * k))
        line = SM.wow(line, depth=0.004 + 0.006 * k, rate=0.7)
        add(m, line * 0.6, at)
    for at in (52, 99):
        add(m, static(0.4, 0.3), at)
    # everything slows and sinks at the end
    m = fit(SM.tape_stop(m, 14), n)
    return fit(wide(m, 5.0, 0.5, 3200), n)


# ----------------------------------------------------------------------------- the Brinesleeper

def brine_still(v):
    """Calm, deep, still water: a drone far below, slow pings rising out of the dark like sonar, something enormous
    moaning far away, a glass melody of four notes. 80 s each."""
    L = 80.0
    n = secs(L)
    m = np.zeros(n)
    base = [28, 27, 29][v]
    m += sub_drone(L, base, 0.11 + 0.03 * v, 0.8)
    for i, at in enumerate(np.arange(4 + v, 80, 9.5)):
        t = np.arange(secs(5)) / SR
        f = midi(base + 48 + [0, 1, -2, 6][i % 4])
        ping = np.sin(2 * np.pi * f * t) * np.exp(-t * 1.2) * 0.25 + np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t * 2.5) * 0.08
        add(m, ping, at)
    for at in (12 + 4 * v, 50 + 3 * v):
        add(m, scream(7.0, base + 31, base + 24, "u", 0.09), at)
    glass = [64, 65, 60, 59] if v != 1 else [63, 64, 58, 57]
    for k, at in enumerate((20 + v * 2, 58 - v)):
        for i, nt in enumerate(glass):
            add(m, bell(nt, 4.0, 0.3) * 0.25, at + i * 2.2)
    add(m, pad([base + 24, base + 25, base + 31], 30, cents=8, bright=500, a=0.5, r=0.5) * 0.35, 25)
    m = lowpass(m, 2200, 2)
    return fit(wide(m, 6.5, 0.55, 2200), n)


def brine_near(v):
    """It is near: a slow heartbeat, a string cluster creeping up, its jaw clicking in the dark, breath. 36 s, loops."""
    L = 36.0
    n = secs(L)
    m = np.zeros(n)
    m += sub_drone(L, 28 + v, 0.31, 0.7)
    for at in np.arange(0, 36, 1.0):
        add(m, heartbeat(0.35), at)
    add(m, pad([52 + v, 53 + v, 58 + v], 36, cents=20, bright=1400, a=0.9, r=0.08) * 0.45, 0)
    for at in np.arange(1.3, 36, 2.25):
        add(m, click(rng.integers(0, 3)) * 0.18, at + rng.uniform(-0.1, 0.1))
    for at in (6, 22):
        add(m, breath(3.5, 0.25), at)
    for at in (17.5, 34.5):
        add(m, backwards(piano(40 + v, 2.5)) * 0.4, at - 2.5)
    return tail_into_start(wide(m, 3.5, 0.4, 3000), n)


def brine_chase():
    """It is coming through the water at you: 160 bpm, a distorted bass gliding a tritone, metal hits, a choir
    crying out, a screech rising every four bars. 24 s, loops."""
    bpm = 160.0
    beat = 60 / bpm
    bars = 16
    L = bars * 4 * beat
    n = secs(L)
    m = np.zeros(n)
    for b in range(bars):
        t0 = b * 4 * beat
        for i in (0, 1.5, 2, 3, 3.5):
            add(m, kick(0.85), t0 + i * beat)
        add(m, anvil(79 if b % 2 else 74, 0.25), t0 + 2 * beat)
        root = [40, 40, 46, 39][b % 4]
        f = np.concatenate([np.full(secs(beat * 3), midi(root)), np.geomspace(midi(root), midi(root + 6), secs(beat))])
        bass = np.tanh(lowpass(osc("saw", f, 4 * beat) + osc("saw", f * 0.5 * 1.004, 4 * beat), 900, 2) * 3.5)
        add(m, bass * 0.3, t0)
        if b % 4 == 3:
            add(m, screech(4 * beat, 64, 88, 0.3), t0)
        if b % 8 == 4:
            add(m, choir([64, 67, 70], 8 * beat, "a", a=0.05, r=0.6) * 0.6, t0)
    m = np.tanh(m * 1.3)
    return tail_into_start(wide(m, 2.0, 0.25, 5000), n)


def brine_sting(v):
    """A stab: a swell sucked in backwards, then everything at once — organ, a low hit, noise — and a long tail."""
    L = 4.5
    n = secs(L)
    m = np.zeros(n)
    ch = [[40, 41, 46, 52, 53], [39, 40, 45, 51, 58], [41, 42, 47, 53, 54]][v]
    hit = organ(ch, 2.0, a=0.005, r=1.6, bright=1.5) * 0.9
    k = np.zeros(secs(2.0))
    k[: secs(0.5)] = kick(1.0)
    hit = hit + k + highpass(rng.standard_normal(secs(2.0)), 2000, 1) * np.exp(-np.arange(secs(2.0)) / SR * 6) * 0.3
    rev = backwards(space(organ(ch, 1.0, a=0.005, r=0.5), 1.0, 1.0))[-secs(1.0):]
    add(m, rev * 0.5, 0.0)
    add(m, np.tanh(hit * 1.6) * 0.8, 1.0)
    return fit(wide(m, 3.0, 0.4, 3500), n)


# ----------------------------------------------------------------------------- the Brinesleeper's voice (mono)

def click(v):
    """Its jaw clicking: a few sharp, wet clicks."""
    n = secs(0.6)
    x = np.zeros(n)
    for i in range(3 + v):
        t = np.arange(secs(0.03)) / SR
        c = np.sin(2 * np.pi * (2400 + 300 * v) * t) * np.exp(-t * 300) + rng.standard_normal(len(t)) * np.exp(-t * 500) * 0.5
        add(x, c * (1 - 0.15 * i), i * (0.08 + 0.02 * v) + rng.uniform(0, 0.01))
    return x


def growl(dur, note=33, rough=0.6, vowel="o"):
    """A throat: a low voice with a rattle in it."""
    n = secs(dur)
    t = np.arange(n) / SR
    f = midi(note) * (1 + 0.04 * np.sin(2 * np.pi * 0.7 * t)) * (1 + 0.02 * lowpass(rng.standard_normal(n), 8, 1) * 20)
    x = osc("saw", f, dur) + osc("saw", f * 1.5 * 1.003, dur) * 0.4
    rattle = 1 + rough * np.sin(2 * np.pi * 27 * t + 2 * np.sin(2 * np.pi * 3 * t))
    x = formant(x * rattle, vowel) * 1.5 + bandpass(rng.standard_normal(n), 600, 300) * rough * 0.5
    return np.tanh(x * 2)


def wet(dur, level=1.0):
    n = secs(dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for at in rng.uniform(0, dur * 0.8, int(dur * 25)):
        b = np.arange(secs(0.04)) / SR
        add(x, np.sin(2 * np.pi * rng.uniform(300, 1200) * (1 + 3 * b) * b) * np.exp(-b * 120) * rng.uniform(0.2, 1), at)
    return x * swell(n, 0.1, 0.6) * level


def voice():
    """Every sound of its voice: {file stem: mono signal}."""
    v = {}
    v["click1"] = space(click(0), 0.8, 0.25)
    v["click2"] = space(click(1), 0.8, 0.25)
    v["breathe"] = space(breath(4.5, 0.8, 250, 1300) + growl(4.5, 29, 0.2, "u") * 0.1, 1.2, 0.3)
    v["call"] = space(scream(5.5, 63, 56, "u", 0.8) + scream(5.5, 51, 44, "o", 0.5), 3.5, 0.5)
    v["moan"] = space(growl(6.5, 35, 0.3, "u") * swell(secs(6.5), 0.3, 0.5) * 0.8, 3.0, 0.45)
    v["hiss"] = space(highpass(breath(2.6, 1.0, 2500, 7000), 1800) * 1.2 + growl(2.6, 40, 0.8, "e") * 0.15, 0.8, 0.25)
    roar = growl(3.6, 31, 0.9, "a") + scream(3.6, 58, 49, "a", 0.6) + bandpass(rng.standard_normal(secs(3.6)), 900, 500) * 0.4
    v["roar"] = space(np.tanh(roar * swell(secs(3.6), 0.08, 0.5) * 1.8), 2.2, 0.35)
    v["lunge"] = space(np.tanh((growl(1.4, 38, 0.9, "a") + bandpass(rng.standard_normal(secs(1.4)), 1500, 900) * 0.8) * swell(secs(1.4), 0.05, 0.5) * 2), 0.8, 0.2)
    v["grasp"] = space(wet(2.0, 0.9) + growl(2.0, 30, 0.7, "o") * 0.4 * swell(secs(2.0), 0.2, 0.6), 1.0, 0.25)
    v["emerge"] = space(wet(2.6, 1.0) + breath(2.6, 0.6, 200, 1500) + growl(2.6, 28, 0.4, "u") * 0.3, 1.5, 0.35)
    v["submerge"] = space(backwards(wet(2.6, 1.0)) * 0.8 + lowpass(breath(2.6, 0.8, 100, 600), 700), 1.5, 0.35)
    v["step1"] = space(wet(0.6, 1.0) + lowpass(fit(kick(0.4), secs(0.6)), 300) * 0.6, 0.5, 0.2)
    v["step2"] = space(wet(0.7, 1.0) + lowpass(fit(kick(0.35), secs(0.7)), 260) * 0.6, 0.5, 0.2)
    v["hurt"] = space(np.tanh((scream(1.2, 70, 60, "e", 1.0) + growl(1.2, 40, 1.0, "a") * 0.5) * 1.5), 0.9, 0.25)
    death = scream(5.0, 66, 40, "a", 1.0) + growl(5.0, 30, 0.9, "o") * 0.6 + wet(5.0, 0.5)
    v["death"] = space(np.tanh(death * swell(secs(5.0), 0.05, 0.8) * 1.4), 3.0, 0.4)
    spotted = organ([52, 53, 58, 64], 2.2, a=0.003, r=1.6, bright=1.6) + highpass(rng.standard_normal(secs(2.2)), 3000) * np.exp(-np.arange(secs(2.2)) / SR * 5) * 0.4
    v["spotted"] = space(np.tanh(spotted * 2), 2.0, 0.4)
    jump = screech(1.6, 70, 92, 1.0) + scream(1.6, 75, 64, "a", 1.0) + static(1.6, 1.0) + growl(1.6, 34, 1.0, "a") * 0.6
    v["jumpscare"] = np.tanh(SM.crush(jump, bits=5, hold=3) * 2.5) * swell(secs(1.6), 0.01, 0.4)
    return v


# ----------------------------------------------------------------------------- the Shaftbreaker

def creak(dur, note=40, level=1.0):
    """A beam taking weight in the dark: a slow, rough, falling groan of wood."""
    n = secs(dur)
    t = np.arange(n) / SR
    f = midi(note) * (1 + 0.04 * np.sin(2 * np.pi * 3.3 * t)) * np.linspace(1.0, 0.82, n)
    x = osc("saw", f, dur) * (0.6 + 0.4 * (rng.random(n) > 0.6))
    x = bandpass(x, midi(note) * 4, 500) * swell(n, 0.3, 0.4)
    return x * level


def strike(level=1.0, note=70):
    """A pickaxe on rock, far down a shaft: a hard metallic tick and its ring."""
    t = np.arange(secs(1.2)) / SR
    ring = (np.sin(2 * np.pi * midi(note) * t) + 0.5 * np.sin(2 * np.pi * midi(note) * 2.76 * t)) * np.exp(-t * 7)
    tick = highpass(rng.standard_normal(len(t)), 2500, 1) * np.exp(-t * 60)
    return (ring * 0.5 + tick * 0.8) * level


def shaft_presence():
    """Something below: a drone in C sharp, picks striking far down the shafts in no rhythm a man would keep, beams
    creaking, water dripping, a lullaby on a piano played backwards, low voices. 56 s, loops."""
    L = 56.0
    n = secs(L)
    m = np.zeros(n)
    m += sub_drone(L, 25, 0.17, 0.9)
    add(m, pad([49, 50, 55], 28, cents=18, bright=600, a=0.5, r=0.45) * 0.45, 0)
    add(m, pad([48, 49, 55, 56], 28, cents=18, bright=600, a=0.5, r=0.45) * 0.45, 28)
    for at in (1.7, 2.4, 9.8, 10.3, 10.9, 21.5, 30.2, 30.6, 41.0, 41.5, 49.7):
        add(m, strike(0.32, 68 + int(rng.integers(0, 4))), at)
    for at in (6, 25, 44):
        add(m, creak(3.0, 40 + int(rng.integers(-2, 3)), 0.5), at)
    for at in rng.uniform(0, L - 1, 22):
        t = np.arange(secs(0.25)) / SR
        add(m, np.sin(2 * np.pi * (1500 - 1100 * t / 0.25) * t) * np.exp(-t * 28) * 0.1, at)
    line = np.zeros(secs(9))
    for i, nt in enumerate([73, 76, 72, 71, 68, 67]):
        add(line, piano(nt, 2.4) * 0.5, i * 1.2)
    for at in (14, 42):
        add(m, backwards(line) * 0.4, at)
    add(m, choir([37, 40, 44], 20, "o") * 0.45, 18)
    for at in np.arange(0.5, L, 1.9):
        add(m, heartbeat(0.16), at)
    m = SM.wow(m, depth=0.004, rate=0.25)
    return tail_into_start(wide(m, 6.0, 0.55, 2600), n)


def shaft_hollows():
    """The Hollows: the walls are alive. A wet pulse under everything, breath swelling out of the rock, a cluster of
    voices that never resolves, bells gone out of tune, something screaming three tunnels away. 110 s, loops."""
    L = 110.0
    n = secs(L)
    m = np.zeros(n)
    m += sub_drone(L, 24, 0.12, 0.85)
    for at in np.arange(0, L, 2.1):
        add(m, lowpass(wet(0.5, 0.5), 600, 2), at)
        add(m, heartbeat(0.14), at + 0.05)
    for k, at in enumerate(range(0, 110, 22)):
        chord = [[48, 49, 54], [47, 48, 53, 54], [48, 51, 54], [46, 47, 53], [48, 49, 55]][k % 5]
        add(m, choir(chord, 25, "u" if k % 2 else "o") * 0.42, at)
    for at in (8, 38, 66, 95):
        add(m, breath(5.5, 0.32, 300, 1500), at)
    for i, at in enumerate(np.arange(5, L, 11)):
        add(m, bell([60, 59, 55, 54, 61][i % 5], 6.0, 0.5) * 0.22, at + rng.uniform(-0.3, 0.3))
    for at in (31, 84):
        add(m, scream(4.5, 70, 58, "a", 0.06), at)
    for at in (52, 102):
        add(m, creak(4.0, 37, 0.45), at)
    m = lowpass(m, 2000, 2)
    m = SM.wow(m, depth=0.005, rate=0.2)
    return tail_into_start(wide(m, 7.0, 0.6, 2000), n)


def shaft_close():
    """It is close: the heartbeat quickens, strings crawl upward a quarter-tone at a time, a bass pulse on a tritone,
    its jaw clicking, whispering in the walls. 38.4 s, loops."""
    L = 38.4
    n = secs(L)
    m = np.zeros(n)
    m += sub_drone(L, 26, 0.33, 0.7)
    for at in np.arange(0, L, 0.8):
        add(m, heartbeat(0.32), at)
    for i, at in enumerate(np.arange(0, L, 1.6)):
        nt = 38 if (i // 4) % 2 == 0 else 44
        note = np.tanh(lowpass(osc("saw", detune(nt, 0), 0.55), 700, 2) * 3) * SM.env(secs(0.55), a=0.005, d=0.2, s=0.5, r=0.1)
        add(m, note * 0.22, at)
    add(m, pad([62, 63, 68], L, cents=26, bright=1700, a=0.95, r=0.05) * 0.38, 0)
    for at in np.arange(0.9, L, 1.85):
        add(m, click(int(rng.integers(0, 3))) * 0.16, at + rng.uniform(-0.12, 0.12))
    for at in (5, 19, 31):
        add(m, bandpass(breath(2.5, 0.5), 1800, 900), at)
    for at in (12.8, 32.0):
        add(m, strike(0.4, 74), at)
    return tail_into_start(wide(m, 3.2, 0.4, 3200), n)


def shaft_standoff():
    """Neither of you moves: a thin high tone that will not stop, the dark ticking like a clock, the sub-bass pulsing
    slow, one bell. 40 s, loops."""
    L = 40.0
    n = secs(L)
    m = np.zeros(n)
    m += sub_drone(L, 25, 0.5, 0.75)
    t = np.arange(n) / SR
    m += np.sin(2 * np.pi * midi(93) * t * (1 + 0.002 * np.sin(2 * np.pi * 0.3 * t))) * 0.025 * swell(n, 0.2, 0.05)
    for at in np.arange(0, L, 0.5):
        add(m, click(1) * (0.12 if int(at * 2) % 2 == 0 else 0.07), at)
    for at in np.arange(0, L, 2.5):
        k = kick(0.4)
        add(m, lowpass(k, 120, 2), at)
    for at in (10, 30):
        add(m, bell(49, 8.0, 0.4) * 0.3, at)
    add(m, choir([61, 62], 18, "u") * 0.25, 20)
    for at in (17, 37):
        add(m, breath(2.2, 0.28), at)
    return tail_into_start(wide(m, 4.0, 0.45, 3000), n)


def shaft_chase():
    """It is coming up the shaft: 170 bpm, metal on rock for drums, a distorted bass sliding down a tritone, organ
    stabs, a screech every four bars, the choir crying out. 32 bars, about 45 s, loops."""
    bpm = 170.0
    beat = 60 / bpm
    bars = 32
    L = bars * 4 * beat
    n = secs(L)
    m = np.zeros(n)
    for b in range(bars):
        t0 = b * 4 * beat
        for i in (0, 1, 2, 2.5, 3):
            add(m, kick(0.9), t0 + i * beat)
        for i in (1, 3):
            add(m, anvil(72 if b % 2 else 77, 0.3), t0 + i * beat)
        for i in np.arange(0, 4, 0.5):
            add(m, strike(0.12, 80), t0 + (i + 0.25) * beat)
        root = [37, 37, 43, 36][b % 4]
        f = np.concatenate([np.full(secs(beat * 3), midi(root)), np.geomspace(midi(root), midi(root - 6), secs(beat))])
        bass = np.tanh(lowpass(osc("saw", f, 4 * beat) + osc("square", f * 0.5, 4 * beat, duty=0.3), 1000, 2) * 4)
        add(m, bass * 0.3, t0)
        stab = [49, 52, 55] if b % 8 < 4 else [48, 51, 54]
        for i in (0.5, 2.75):
            add(m, organ(stab, beat * 0.5, a=0.01, r=0.1, bright=1.4) * 0.45, t0 + i * beat)
        if b % 4 == 3:
            add(m, screech(4 * beat, 60, 90, 0.28), t0)
        if b % 8 == 0:
            add(m, choir([61, 64, 67], 8 * beat, "a", a=0.05, r=0.7) * 0.55, t0)
    m = SM.stutter(m, L - beat, 0.05, 6)
    m = np.tanh(m * 1.35)
    return tail_into_start(wide(m, 2.2, 0.26, 5200), n)


# ----------------------------------------------------------------------------- out

def write_stereo(path, x, peak=0.8, q=4):
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    os.makedirs(os.path.dirname(path), exist_ok=True)
    import subprocess
    import tempfile
    import wave
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav = tmp.name
    with wave.open(wav, "wb") as w:
        w.setnchannels(x.shape[1] if x.ndim == 2 else 1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", str(q), path], check=True)
    os.unlink(wav)
    return path


OBS = os.path.join(RP, "sounds", "observer", "music")
BRINE_MUSIC = os.path.join(RP, "sounds", "music", "brine_dark")
BRINE_VOICE = os.path.join(RP, "sounds", "mob", "brinesleeper_dark")
SHAFT_MUSIC = os.path.join(RP, "sounds", "music", "shaft_dark")


def main():
    want = set(sys.argv[1:]) or {"observer", "brine", "voice", "shaft"}
    out = []
    if "observer" in want:
        for name, fn in (("stalk", obs_stalk), ("chase", obs_chase), ("mire", obs_mire), ("end", obs_end)):
            out.append(write_stereo(os.path.join(OBS, f"{name}.ogg"), fn()))
    if "brine" in want:
        for v in range(3):
            out.append(write_stereo(os.path.join(BRINE_MUSIC, f"stillwater_{v + 1}.ogg"), brine_still(v)))
            out.append(write_stereo(os.path.join(BRINE_MUSIC, f"sting_{v + 1}.ogg"), brine_sting(v)))
        for v in range(2):
            out.append(write_stereo(os.path.join(BRINE_MUSIC, f"near_{v + 1}.ogg"), brine_near(v)))
        out.append(write_stereo(os.path.join(BRINE_MUSIC, "chase.ogg"), brine_chase()))
    if "shaft" in want:
        global rng
        rng = np.random.default_rng(17500)   # (its own seed: the same tracks whatever else is rendered with it)
        for name, fn in (("presence", shaft_presence), ("hollows", shaft_hollows), ("close", shaft_close), ("standoff", shaft_standoff),
                         ("chase", shaft_chase)):
            out.append(write_stereo(os.path.join(SHAFT_MUSIC, f"{name}.ogg"), fn()))
    if "voice" in want:
        for name, x in voice().items():
            out.append(write_stereo(os.path.join(BRINE_VOICE, f"{name}.ogg"), x, peak=0.72 if name == "jumpscare" else 0.82))
    for p in out:
        print(os.path.relpath(p, ROOT))


if __name__ == "__main__":
    main()
