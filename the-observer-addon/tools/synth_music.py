#!/usr/bin/env python3
"""Synthesize The Observer's broken music (1.5.0) and its glitch / static sounds, and encode them to OGG Vorbis.

Original music, written here note by note and rendered from oscillators and noise — no samples, no existing songs.
The style it is after: a cheerful little 16-bit tune that has gone wrong. Played too slow, out of tune, wobbling like
a stretched tape, its bits crushed, chunks of it running backwards, cut off by static and dead silence, a music box
in a minor key underneath, and a drone below everything.

  stalk   its presence from the fourth stage: the music box, the drone, fragments of the tune drifting in and out
  chase   when it (or its pack) is coming for you: driving, fast, a tritone bass, stutters, a tape-stop at every
          phrase's end
  mire    its home from the fourth stage: low voices, slow wrong bells, the tune heard from underwater
  end     the fifth stage: the cheerful tune, over and over, each time slower, lower, more broken, until it is a drone
  glitch1-3, static1-2   stings

Output: packs/TheObserver_RP/sounds/observer/music/*.ogg and sounds/observer/glitch*.ogg, static*.ogg (mono).
Requires numpy and ffmpeg with libvorbis. Deterministic (seeded); OGG bytes may differ between ffmpeg builds.
"""
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "packs", "TheObserver_RP", "sounds", "observer")
rng = np.random.default_rng(15000)


# ----------------------------------------------------------------------------- building blocks

def secs(n):
    return int(round(n * SR))


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def osc(kind, freq, dur, duty=0.5, phase=0.0):
    """freq: number or array (per sample)."""
    n = secs(dur)
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, dtype=float)[:n]
    ph = (np.cumsum(f) / SR + phase) % 1.0
    if kind == "square":
        return np.where(ph < duty, 1.0, -1.0)
    if kind == "tri":
        return 4 * np.abs(ph - 0.5) - 1
    if kind == "saw":
        return 2 * ph - 1
    return np.sin(2 * np.pi * ph)


def env(n, a=0.005, d=0.08, s=0.6, r=0.05):
    e = np.ones(n) * s
    na, nd, nr = secs(a), secs(d), secs(r)
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na) if na else e[:na]
    if nd and na < n:
        k = min(nd, n - na)
        e[na:na + k] = np.linspace(1, s, k)
    if nr:
        k = min(nr, n)
        e[-k:] *= np.linspace(1, 0, k)
    return e


def place(buf, x, at):
    i = secs(at)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(x))
    buf[i:j] += x[: j - i]


def lp_fast(x, fc):
    """One-pole low-pass, exact, computed block by block with cumulative sums (no per-sample Python loop)."""
    a = np.exp(-2 * np.pi * fc / SR)
    la = -np.log(a)
    blk = max(1, min(4096, int(500 / la)))
    y = np.empty(len(x))
    carry = 0.0
    for s0 in range(0, len(x), blk):
        seg = x[s0:s0 + blk]
        k = np.arange(len(seg))
        c = np.cumsum(seg * np.exp(la * k)) * (1 - a)
        ys = np.exp(-la * k) * c + np.exp(-la * (k + 1)) * carry
        y[s0:s0 + len(seg)] = ys
        carry = ys[-1]
    return y


def hp(x, fc):
    return x - lp_fast(x, fc)


def crush(x, bits=6, hold=4):
    """Bit-crush: fewer levels, and each sample held for `hold` samples (a lower sample rate)."""
    q = 2 ** (bits - 1)
    y = np.round(x * q) / q
    if hold > 1:
        y = np.repeat(y[::hold], hold)[: len(x)]
    return y


def wow(x, depth=0.004, rate=0.6, flutter=0.0015, frate=7.0):
    """A stretched tape: the playback speed wanders (wow) and trembles (flutter)."""
    n = len(x)
    t = np.arange(n) / SR
    speed = 1 + depth * np.sin(2 * np.pi * rate * t) + flutter * np.sin(2 * np.pi * frate * t + 1.3)
    pos = np.cumsum(speed)
    pos = pos - pos[0]
    pos = np.clip(pos, 0, n - 1)
    return np.interp(pos, np.arange(n), x)


def tape_stop(x, dur):
    """The end of x slows to a stop (pitch falling to nothing)."""
    n = secs(dur)
    if n >= len(x):
        return x
    head, tail = x[:-n], x[-n:]
    speed = np.linspace(1, 0.02, n) ** 1.6
    pos = np.cumsum(speed)
    pos = np.clip(pos, 0, n - 1)
    return np.concatenate([head, np.interp(pos, np.arange(n), tail) * np.linspace(1, 0.2, n)])


def reverse_chunks(x, chunk, prob):
    y = x.copy()
    n = secs(chunk)
    for s0 in range(0, len(x) - n, n):
        if rng.random() < prob:
            y[s0:s0 + n] = y[s0:s0 + n][::-1]
    return y


def dropouts(x, prob, dur=0.12):
    y = x.copy()
    n = secs(dur)
    for s0 in range(0, len(x) - n, n):
        if rng.random() < prob:
            y[s0:s0 + n] *= 0.0
    return y


def stutter(x, at, length=0.06, times=6):
    """Repeat a tiny slice of x (a skipping CD / a glitching cartridge) at `at` seconds."""
    i = secs(at)
    n = secs(length)
    if i + n * times >= len(x):
        return x
    piece = x[i:i + n].copy()
    y = x.copy()
    for k in range(times):
        y[i + k * n:i + (k + 1) * n] = piece * (1 - 0.08 * k)
    return y


def noise(n):
    return rng.standard_normal(n)


def reverb(x, decay=0.5, mix=0.3):
    out = x.copy()
    for dly, g in ((0.0297, 0.7), (0.0371, 0.66), (0.0411, 0.62), (0.0437, 0.6), (0.067, 0.5), (0.089, 0.42)):
        d = secs(dly)
        buf = np.zeros(len(x) + d * 40)
        buf[: len(x)] += x
        for k in range(1, 40):
            amp = (g * decay) ** k
            if amp < 0.003:
                break
            buf[d * k: d * k + len(x)] += x * amp
        out = out + buf[: len(x)] * mix / 6
    return out


def drive(x, amt=3.0):
    return np.tanh(x * amt) / np.tanh(amt)


def norm(x, peak=0.85):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def loopable(x, fade=0.6):
    """Crossfade the end into the start so the track loops without a click."""
    n = secs(fade)
    head = x[:n].copy()
    y = x[:-n].copy() if len(x) > 2 * n else x.copy()
    y[:n] = y[:n] * np.linspace(0, 1, n) + x[-n:] * np.linspace(1, 0, n) if len(x) > 2 * n else y[:n]
    _ = head
    return y


def write(name, x, peak=0.85, q=3):
    os.makedirs(os.path.dirname(os.path.join(OUT, name)), exist_ok=True)
    x = norm(x, peak)
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    dst = os.path.join(OUT, name + ".ogg")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-c:a", "libvorbis", "-q:a", str(q), dst], check=True)
    os.remove(tmp)
    return dst, len(x) / SR


# ----------------------------------------------------------------------------- the tunes (original)

# a cheerful little tune — the thing that goes wrong (C major, bouncing)
JINGLE = [(72, .25), (76, .25), (79, .25), (84, .5), (83, .25), (79, .25), (76, .5),
          (77, .25), (81, .25), (84, .25), (86, .5), (84, .25), (81, .25), (79, .5),
          (76, .25), (79, .25), (84, .25), (88, .375), (86, .125), (84, .25), (83, .25), (81, .25),
          (79, .25), (77, .25), (76, .25), (74, .25), (72, 1.0)]
# the music box underneath (A harmonic minor), slow
BOX = [(69, .5), (72, .5), (76, .5), (81, 1.0), (80, .5), (76, .5), (72, .5), (71, 1.0),
       (65, .5), (69, .5), (72, .5), (77, 1.0), (76, .5), (72, .5), (69, .5), (68, 1.5)]


def render_line(notes, bpm, kind="square", duty=0.25, octave=0, detune=0.0, gate=0.85, a=0.004, d=0.06, s=0.55, r=0.04, vib=0.0):
    beat = 60 / bpm
    total = sum(n[1] for n in notes) * beat
    buf = np.zeros(secs(total) + secs(1))
    t = 0.0
    for note, length in notes:
        dur = length * beat
        if note is not None:
            f = midi(note + 12 * octave) * (2 ** (detune / 1200))
            n = secs(dur * gate)
            if vib:
                tt = np.arange(n) / SR
                f = f * (1 + vib * np.sin(2 * np.pi * 5.5 * tt))
            x = osc(kind, f, dur * gate, duty) * env(n, a, d, s, r)
            place(buf, x, t)
        t += dur
    return buf[: secs(total)]


def music_box(notes, bpm):
    """A small comb of bells: two inharmonic partials, fast decay, slightly flat."""
    beat = 60 / bpm
    total = sum(n[1] for n in notes) * beat
    buf = np.zeros(secs(total) + secs(3))
    t = 0.0
    for note, length in notes:
        f = midi(note) * (2 ** (-18 / 1200))
        n = secs(2.5)
        tt = np.arange(n) / SR
        x = (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * f * 2.76 * tt) + 0.15 * np.sin(2 * np.pi * f * 5.4 * tt)) * np.exp(-tt / 0.7)
        place(buf, x * 0.6, t)
        t += length * beat
    return buf[: secs(total) + secs(2)]


def drone(dur, base=36, beat_hz=0.35):
    n = secs(dur)
    tt = np.arange(n) / SR
    f = midi(base)
    x = osc("saw", f, dur) * 0.5 + osc("saw", f * 1.0055, dur) * 0.5 + 0.6 * np.sin(2 * np.pi * f / 2 * tt)
    x = lp_fast(x, 220)
    return x * (0.8 + 0.2 * np.sin(2 * np.pi * beat_hz * tt))


def static_burst(dur, level=1.0):
    n = secs(dur)
    x = noise(n) * level
    x = crush(x, 4, 3)
    gate = (rng.random(n // 400 + 1) > 0.3).repeat(400)[:n]
    return hp(x * gate, 900)


# ----------------------------------------------------------------------------- tracks

def track_stalk():
    dur = 72.0
    buf = drone(dur, 33) * 0.5
    box = music_box(BOX, 52)
    for at in (2.0, 26.0, 50.0):
        place(buf, wow(box, 0.012, 0.3, 0.004, 6) * 0.55, at)
    # the tune drifting in, far too slow, detuned, crushed — and a piece of it backwards
    tune = render_line(JINGLE, 54, "square", 0.25, -1, detune=-35, vib=0.006) * 0.35
    tune = crush(wow(tune, 0.02, 0.25, 0.006, 5), 5, 6)
    tune = reverse_chunks(tune, 0.6, 0.35)
    tune = lp_fast(tune, 1800)
    place(buf, reverb(tune, 0.6, 0.5) * 0.7, 14.0)
    place(buf, reverb(tune[::-1], 0.6, 0.5) * 0.45, 44.0)
    # static, now and then, and one hard cut to silence
    for at in (9.5, 31.2, 58.7):
        place(buf, static_burst(rng.uniform(0.2, 0.6), 0.35), at)
    buf = dropouts(buf, 0.015, 0.25)
    return loopable(reverb(buf, 0.5, 0.35), 1.0)


def track_chase():
    bpm = 152
    beat = 60 / bpm
    bars = 24
    dur = bars * 4 * beat
    buf = np.zeros(secs(dur) + secs(1))
    # the bass: eighths, E to B-flat (the tritone), and up a semitone every four bars
    roots = [40, 40, 46, 46, 41, 41, 47, 45]
    for bar in range(bars):
        root = roots[bar % len(roots)]
        for k in range(8):
            n = root + (12 if k in (2, 6) else 0)
            x = osc("tri", midi(n), beat / 2 * 0.9) * env(secs(beat / 2 * 0.9), 0.002, 0.05, 0.7, 0.02)
            x = drive(x + 0.4 * osc("square", midi(n), beat / 2 * 0.9, 0.5) * env(secs(beat / 2 * 0.9), 0.002, 0.04, 0.4, 0.02), 2.2)
            place(buf, x * 0.5, bar * 4 * beat + k * beat / 2)
        # kick on the beat (a heartbeat), snare of noise on 2 and 4
        for k in range(4):
            tt = np.arange(secs(0.18)) / SR
            kick = np.sin(2 * np.pi * (110 * np.exp(-tt / 0.04) + 40) * tt) * np.exp(-tt / 0.09)
            place(buf, kick * 0.9, bar * 4 * beat + k * beat)
            if k in (1, 3):
                sn = hp(noise(secs(0.12)), 1500) * np.exp(-np.arange(secs(0.12)) / SR / 0.04)
                place(buf, crush(sn, 5, 2) * 0.45, bar * 4 * beat + k * beat)
    # the lead: the cheerful tune, turned minor and fast, pulse-thin, a little detuned against itself
    minor = [(n - 3 if n % 12 in (4, 11) else n, l) for n, l in JINGLE]
    lead = render_line(minor, bpm, "square", 0.125, 0, detune=-20) * 0.22 + render_line(minor, bpm, "square", 0.125, 0, detune=+25) * 0.18
    for start in (8 * 4 * beat, 16 * 4 * beat):
        place(buf, crush(lead, 6, 3), start)
    # every four bars: a stutter, and a tape-stop at the end of each eight
    out = buf[: secs(dur)]
    for bar in range(3, bars, 4):
        out = stutter(out, bar * 4 * beat + 3.5 * beat, 0.05, 5)
    seg = secs(8 * 4 * beat)
    parts = [tape_stop(out[i:i + seg], 0.45) for i in range(0, len(out), seg)]
    out = np.concatenate(parts)
    for at in np.arange(4 * beat, dur, 6 * 4 * beat):
        place(out, static_burst(0.18, 0.5), float(at))
    return drive(out, 1.4)


def track_mire():
    dur = 80.0
    n = secs(dur)
    tt = np.arange(n) / SR
    # low voices: noise through moving vowel-ish bands
    voices = np.zeros(n)
    for f0, f1, rate in ((300, 700, 0.07), (800, 1200, 0.05), (2400, 2700, 0.09)):
        band = hp(lp_fast(noise(n), f1), f0)
        voices += band * (0.5 + 0.5 * np.sin(2 * np.pi * rate * tt + f0))
    buf = drone(dur, 28, 0.2) * 0.7 + lp_fast(voices, 800) * 0.08
    # slow wrong bells
    for at in np.arange(3.0, dur - 3, 7.3):
        f = midi(rng.choice([57, 60, 63, 66])) * 2 ** (rng.uniform(-40, 40) / 1200)
        k = secs(4)
        t2 = np.arange(k) / SR
        bell = (np.sin(2 * np.pi * f * t2) + 0.5 * np.sin(2 * np.pi * f * 2.4 * t2) + 0.25 * np.sin(2 * np.pi * f * 3.9 * t2)) * np.exp(-t2 / 1.4)
        place(buf, bell * 0.35, float(at))
    # the tune, as if from underwater
    tune = render_line(JINGLE, 40, "tri", 0.5, -1, detune=-60, vib=0.01) * 0.4
    tune = lp_fast(wow(tune, 0.03, 0.18, 0.004, 3), 600)
    place(buf, reverb(tune, 0.7, 0.6), 30.0)
    buf = reverse_chunks(buf, 1.2, 0.08)
    return loopable(reverb(buf, 0.6, 0.4), 1.5)


def track_end():
    """The cheerful tune, again and again — each time slower, lower, more broken — until it is a drone."""
    out = []
    for i in range(6):
        bpm = 132 * (0.86 ** i)
        detune = -15 - 40 * i
        lead = render_line(JINGLE, bpm, "square", 0.25, 0, detune=detune, vib=0.003 * i) * 0.5
        bass = render_line([(n - 24, l) for n, l in JINGLE[::2]], bpm / 2, "tri", 0.5, 0, detune=detune) * 0.4
        m = min(len(lead), len(bass))
        x = lead[:m] + bass[:m]
        if i >= 1:
            x = crush(x, 8 - i, 1 + i)
        if i >= 2:
            x = wow(x, 0.006 * i, 0.4, 0.002 * i, 6)
            x = reverse_chunks(x, 0.35, 0.08 * i)
        if i >= 3:
            x = dropouts(x, 0.04 * i, 0.08)
            x = x + static_burst(len(x) / SR, 0.015 * i)[: len(x)]
        if i == 5:
            x = tape_stop(x, len(x) / SR * 0.6)
        out.append(x)
        out.append(static_burst(0.25, 0.4))
    buf = np.concatenate(out)
    buf = buf + drone(len(buf) / SR, 31, 0.15)[: len(buf)] * np.linspace(0.1, 0.9, len(buf))
    return reverb(buf, 0.45, 0.3)


# ----------------------------------------------------------------------------- stings

def glitch(v):
    dur = [0.35, 0.5, 0.28][v]
    n = secs(dur)
    tt = np.arange(n) / SR
    tone = osc("square", 440 * 2.0 ** (rng.integers(-12, 6, n // 800 + 1).repeat(800)[:n] / 12), dur, 0.3)
    x = crush(tone * 0.6 + noise(n) * 0.4, 4, 4 + v * 2)
    gate = (rng.random(n // 600 + 1) > 0.35).repeat(600)[:n]
    x = x * gate * np.exp(-tt / (dur * 0.8))
    return stutter(x, dur * 0.3, 0.02, 4)


def static(v):
    dur = [1.2, 0.8][v]
    n = secs(dur)
    tt = np.arange(n) / SR
    x = static_burst(dur, 1.0) + 0.2 * np.sin(2 * np.pi * 60 * tt) + 0.1 * np.sin(2 * np.pi * 120 * tt)
    return x * np.minimum(1, (dur - tt) / 0.15)


def main():
    made = []
    for v in range(3):
        made.append(write(f"glitch{v + 1}", glitch(v), 0.7))
    for v in range(2):
        made.append(write(f"static{v + 1}", static(v), 0.6))
    # (1.7.0: its four tracks are made over by tools/synth_dark.py; the 1.5.0 versions stay here, written only on request)
    if "--old-tracks" in sys.argv:
        made.append(write("music/stalk", track_stalk(), 0.8))
        made.append(write("music/chase", track_chase(), 0.85))
        made.append(write("music/mire", track_mire(), 0.8))
        made.append(write("music/end", track_end(), 0.85))
    for path, dur in made:
        print(f"{os.path.relpath(path, ROOT)}  {dur:.1f}s  {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    sys.exit(main())
