#!/usr/bin/env python3
"""Synthesize The Observer's original sound set and encode it to OGG Vorbis.

Every sound is generated from scratch here (oscillators, filtered noise, envelopes) —
no samples or third-party recordings — so the audio is original to this project.
Design notes per sound are in docs/AUDIO.md.

Output: packs/TheObserver_RP/sounds/observer/<name>.ogg  (mono, 44.1 kHz)
Requires numpy and ffmpeg with libvorbis.
`--only voice,presence,notice,shriek,vanish` regenerates just those (OGG files differ byte-wise between runs).
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
rng = np.random.default_rng(20261007)


def t(sec):
    return np.arange(int(round(SR * sec))) / SR


def env(n, a, d, s=0.0, r=0.0, sus_level=0.0):
    """ADSR-ish envelope over n samples; a, d, r in seconds; s = sustain seconds."""
    parts = []
    na, nd, ns, nr = (int(SR * x) for x in (a, d, s, r))
    parts.append(np.linspace(0, 1, max(1, na)))
    parts.append(np.linspace(1, sus_level if (s or r) else 0, max(1, nd)))
    if ns:
        parts.append(np.full(ns, sus_level))
    if nr:
        parts.append(np.linspace(sus_level, 0, nr))
    e = np.concatenate(parts)
    if len(e) < n:
        e = np.concatenate([e, np.zeros(n - len(e))])
    return e[:n]


def expdecay(n, tau):
    return np.exp(-np.arange(n) / (SR * tau))


def noise(n):
    return rng.standard_normal(n)


def onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def lp(x, fc, order=2):
    for _ in range(order):
        x = onepole_lp(x, fc)
    return x


def hp(x, fc, order=1):
    return x - lp(x, fc, order)


def bp(x, lo, hi):
    return hp(lp(x, hi, 2), lo, 2)


def sweep_bp(x, f0, f1):
    """Band-pass whose centre moves from f0 to f1 (block-wise)."""
    out = np.zeros_like(x)
    blocks = 32
    n = len(x)
    for b in range(blocks):
        s, e = b * n // blocks, (b + 1) * n // blocks
        fc = f0 + (f1 - f0) * b / max(1, blocks - 1)
        out[s:e] = bp(x[s:e], fc * 0.6, fc * 1.6)
    return out


def sine(freq, sec, phase=0.0):
    tt = t(sec)
    if callable(freq):
        f = freq(tt)
        ph = 2 * np.pi * np.cumsum(f) / SR
        return np.sin(ph + phase)
    return np.sin(2 * np.pi * freq * tt + phase)


def reverb(x, decay=0.5, mix=0.25):
    """Cheap feedback-comb reverb tail."""
    tail = np.zeros(len(x) + int(SR * decay * 3))
    tail[: len(x)] = x
    for delay_ms, g in ((29.7, 0.6), (37.1, 0.55), (41.1, 0.5), (43.7, 0.45)):
        d = int(SR * delay_ms / 1000)
        y = np.copy(tail)
        for i in range(d, len(y)):
            y[i] += g * y[i - d] * np.exp(-delay_ms / 1000 / decay)
        tail = tail + (y - tail) * 0.25
    out = (1 - mix) * np.pad(x, (0, len(tail) - len(x))) + mix * tail
    return out


def norm(x, peak=0.89):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def fade(x, fin=0.005, fout=0.02):
    n = len(x)
    a, b = int(SR * fin), int(SR * fout)
    x = x.copy()
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def write(name, x, peak=0.89):
    os.makedirs(OUT, exist_ok=True)
    x = fade(norm(x, peak))
    pcm = (x * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    dst = os.path.join(OUT, name + ".ogg")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-c:a", "libvorbis", "-q:a", "4", dst], check=True)
    os.remove(tmp)
    return dst, len(x) / SR


# ----------------------------------------------------------------------------- sounds

def step(v):
    n = int(SR * 0.42)
    f0 = 74 + v * 7
    thump = sine(lambda tt: f0 * (1 - 0.35 * np.minimum(tt / 0.12, 1)), 0.42) * expdecay(n, 0.07)
    cloth = bp(noise(n), 250, 1900) * expdecay(n, 0.05) * 0.55
    grit = hp(noise(n), 2500) * expdecay(n, 0.012) * 0.25
    return thump * 1.0 + cloth + grit


def hum():
    sec = 6.0
    n = int(round(SR * sec))
    tt = t(sec)
    swell = np.clip(tt / 4.0, 0, 1) ** 1.6 * np.clip((sec - tt) / 0.8, 0, 1)
    x = (sine(46, sec) + 0.8 * sine(47.3, sec) + 0.45 * sine(69.5, sec) + 0.2 * sine(92.6, sec))
    x += 0.25 * lp(noise(n), 180) * 6
    trem = 1 + 0.25 * np.sin(2 * np.pi * 0.7 * tt)
    return x * swell * trem


def tell():
    sec = 2.2
    n = int(round(SR * sec))
    parts = [(1187, 1.0, 0.9), (1731, 0.6, 0.6), (2643, 0.35, 0.35), (3302, 0.18, 0.2)]
    x = sum(a * sine(f, sec) * expdecay(n, d) for f, a, d in parts)
    x += hp(noise(n), 4000) * expdecay(n, 0.004) * 0.6
    return reverb(x, 0.9, 0.35)


def breath(v):
    sec = 2.3
    n = int(round(SR * sec))
    e = env(n, 0.45 + 0.1 * v, 0.2, 0.6, 1.0, 0.75)
    x = bp(noise(n), 260 + 40 * v, 1300) * e
    x *= 1 + 0.15 * np.sin(2 * np.pi * (3.1 + v) * t(sec))
    return x


def fabric(v):
    sec = 0.6
    n = int(round(SR * sec))
    x = np.zeros(n)
    for _ in range(5 + v):
        s = int(rng.uniform(0, 0.4) * SR)
        ln = int(rng.uniform(0.04, 0.14) * SR)
        burst = bp(noise(ln), 900, 5200) * np.hanning(ln)
        x[s:s + ln] += burst[: max(0, min(ln, n - s))] * rng.uniform(0.4, 1)
    return x


def knock():
    sec = 0.9
    n = int(round(SR * sec))
    x = np.zeros(n)
    for start in (0.0, 0.27):
        s = int(start * SR)
        ln = int(0.25 * SR)
        k = (sine(178, 0.25) * expdecay(ln, 0.05) + 0.5 * sine(523, 0.25) * expdecay(ln, 0.02)
             + 0.6 * bp(noise(ln), 600, 3000) * expdecay(ln, 0.006))
        x[s:s + ln] += k
    return reverb(x, 0.4, 0.2)


def snuff():
    sec = 0.35
    n = int(round(SR * sec))
    x = lp(noise(n), 1800) * env(n, 0.005, 0.12) * 1.2
    x += bp(noise(n), 3000, 7000) * expdecay(n, 0.05) * 0.2
    return x


def windup():
    sec = 0.6
    n = int(round(SR * sec))
    x = sweep_bp(noise(n), 300, 1600) * np.linspace(0.1, 1, n) ** 2
    return x


def strike():
    sec = 0.6
    n = int(round(SR * sec))
    thump = sine(lambda tt: 58 * (1 - 0.4 * np.minimum(tt / 0.2, 1)), sec) * expdecay(n, 0.12)
    crack = bp(noise(n), 400, 4000) * expdecay(n, 0.025)
    return reverb(thump * 1.2 + crack * 0.8, 0.35, 0.2)


def whiff():
    sec = 0.4
    n = int(round(SR * sec))
    return sweep_bp(noise(n), 1600, 400) * np.hanning(n)


def sting():
    sec = 1.7
    n = int(round(SR * sec))
    tt = t(sec)
    rise = np.clip(tt / 0.55, 0, 1) ** 3
    cut = np.where(tt < 0.62, 1.0, np.exp(-(tt - 0.62) / 0.28))
    cluster = sum(sine(f, sec) for f in (196.0, 207.7, 293.7, 311.1, 466.2)) / 5
    x = (cluster + 0.25 * bp(noise(n), 1500, 6000)) * rise * cut
    return reverb(x, 1.0, 0.35)


def seal():
    sec = 1.1
    n = int(round(SR * sec))
    pre = sweep_bp(noise(n), 400, 2400) * np.linspace(0, 1, n) ** 3
    k = int(0.62 * SR)
    thud = np.zeros(n)
    ln = n - k
    thud[k:] = sine(66, ln / SR) * expdecay(ln, 0.12) * 1.4
    return reverb(pre * 0.7 + thud, 0.5, 0.25)


def arrival():
    sec = 1.4
    n = int(round(SR * sec))
    whoosh = sweep_bp(noise(n), 200, 900) * env(n, 0.5, 0.6)
    k = int(0.55 * SR)
    ln = n - k
    thud = np.zeros(n)
    thud[k:] = sine(52, ln / SR) * expdecay(ln, 0.16) * 1.5
    return reverb(lp(whoosh, 1500) + thud, 0.6, 0.3)


def chalk(v):
    sec = 0.35
    n = int(round(SR * sec))
    grains = (rng.random(n) < 0.08).astype(float) * rng.uniform(0.3, 1, n)
    x = hp(lp(grains + 0.3 * noise(n), 7000), 2200 + 300 * v)
    return x * env(n, 0.01, 0.3)


def discovery():
    sec = 1.6
    n = int(round(SR * sec))
    scr = np.zeros(n)
    c = chalk(1) * 0.6
    scr[: len(c)] = c
    bell = (sine(880, sec) + 0.4 * sine(1320.5, sec) + 0.2 * sine(2210, sec)) * expdecay(n, 0.6)
    bell[: int(0.35 * SR)] = 0
    return reverb(scr + bell * 0.45, 0.8, 0.3)


def lens():
    sec = 1.3
    n = int(round(SR * sec))
    tt = t(sec)
    x = sum(sine(lambda q, f=f: f * (1 + 0.05 * q), sec) * a for f, a in ((1568, 0.6), (2349, 0.4), (3136, 0.25)))
    x *= env(n, 0.08, 1.1) * (1 + 0.3 * np.sin(2 * np.pi * 11 * tt))
    return reverb(x, 0.7, 0.3)


def effigy_break():
    sec = 0.7
    n = int(round(SR * sec))
    x = np.zeros(n)
    for _ in range(14):
        s = int(rng.uniform(0, 0.45) * SR)
        ln = int(0.03 * SR)
        f = rng.uniform(700, 2600)
        click = (sine(f, ln / SR) * expdecay(ln, 0.006) + bp(noise(ln), 1000, 6000) * expdecay(ln, 0.004))
        x[s:s + ln] += click * rng.uniform(0.3, 1)
    return x


def vigil():
    sec = 9.0
    n = int(round(SR * sec))
    tt = t(sec)
    drone = (sine(55, sec) + 0.6 * sine(82.4, sec) + 0.3 * sine(110.3, sec)) * np.clip(tt / 3, 0, 1) * np.clip((sec - tt) / 2, 0, 1)
    bells = np.zeros(n)
    for start in (1.5, 5.2):
        s = int(start * SR)
        ln = n - s
        b = (sine(392, ln / SR) + 0.5 * sine(587.3 * 1.01, ln / SR) + 0.3 * sine(1046, ln / SR)) * expdecay(ln, 1.2)
        bells[s:] += b * 0.35
    return reverb(drone * 0.6 + bells, 1.2, 0.35)


def turn():
    sec = 0.5
    n = int(round(SR * sec))
    grain = 1 + 0.8 * np.sign(np.sin(2 * np.pi * 37 * t(sec)))
    return lp(noise(n), 1200) * grain * env(n, 0.04, 0.42)


def sink():
    sec = 1.8
    n = int(round(SR * sec))
    x = lp(noise(n), 120) * 3 * env(n, 0.2, 1.5)
    for _ in range(26):
        s = int(rng.uniform(0, 1.5) * SR)
        ln = int(rng.uniform(0.02, 0.06) * SR)
        f0 = rng.uniform(260, 900)
        blip = sine(lambda q, f0=f0: f0 * (1 + 3 * q), ln / SR) * np.hanning(ln)
        x[s:s + ln] += blip * rng.uniform(0.2, 0.6)
    return x


def ring():
    sec = 1.8
    n = int(round(SR * sec))
    return sine(6200, sec) * env(n, 0.5, 0.2, 0.4, 0.7, 0.8) * 0.5


# ----------------------------------------------------------------------------- its own voice (1.0.2)

def trim(x, floor=0.003):
    """Cut the silent end of a reverb tail (keeps 60 ms after the last audible sample)."""
    m = np.max(np.abs(x)) or 1
    idx = np.nonzero(np.abs(x) > floor * m)[0]
    end = min(len(x), (idx[-1] if len(idx) else len(x)) + int(SR * 0.06))
    return x[:end]


def glottal(f0_fn, sec, jitter=0.08):
    """Irregular glottal pulse train (vocal fry): one short decaying pulse per period."""
    n = int(round(SR * sec))
    x = np.zeros(n)
    tpos = 0.0
    while tpos < sec:
        i = int(tpos * SR)
        ln = min(n - i, int(SR * 0.012))
        if ln > 0:
            x[i:i + ln] += np.exp(-np.arange(ln) / (SR * 0.0025)) * rng.uniform(0.6, 1.0)
        f = max(8.0, f0_fn(tpos)) * (1 + rng.uniform(-jitter, jitter))
        tpos += 1.0 / f
    return x


def formants(x, centres, q=1.6):
    return sum(bp(x, fc / q, fc * q) * g for fc, g in centres)


def voice(v):
    """Its own noise: a slow creaking groan through cloth, a wet inhale, and throat clicks."""
    sec = 3.2 + v * 0.5
    n = int(round(SR * sec))
    tt = t(sec)
    base = 42 - v * 5
    fry = glottal(lambda q: base * (1.0 - 0.25 * q / sec) + 6 * np.sin(2 * np.pi * 0.7 * q), sec)
    groan = formants(fry, [(330 + v * 40, 1.0), (880, 0.6), (2300, 0.25)])
    shape = np.clip(tt / 0.6, 0, 1) * np.clip((sec - tt) / 1.0, 0, 1)
    groan *= shape * (1 + 0.25 * np.sin(2 * np.pi * 5.5 * tt))
    # wet inhale before the groan, a dry exhale after it
    inhale = bp(noise(n), 500, 3200) * np.exp(-((tt - 0.35) / 0.22) ** 2) * 0.35
    exhale = bp(noise(n), 300, 1800) * np.exp(-((tt - (sec - 0.6)) / 0.3) ** 2) * 0.25
    clicks = np.zeros(n)
    for _ in range(4 + v):
        s0 = int(rng.uniform(0.5, sec - 0.4) * SR)
        ln = int(SR * 0.008)
        f = rng.uniform(1800, 3800)
        clicks[s0:s0 + ln] += np.sin(2 * np.pi * f * np.arange(ln) / SR) * np.exp(-np.arange(ln) / (SR * 0.0015)) * rng.uniform(0.4, 0.9)
    sub = sine(base * 0.5, sec) * shape * 0.25
    return trim(reverb(groan * 1.3 + inhale + exhale + clicks * 0.6 + sub, 0.9, 0.35))


def presence(v):
    """It arrives: pressure in the ears, a reversed swell that cuts off, and a thin whine."""
    sec = 2.6
    n = int(round(SR * sec))
    tt = t(sec)
    swell = np.clip(tt / 1.9, 0, 1) ** 3 * (tt < 1.95)
    rev = bp(noise(n), 400, 7000) * swell * 0.7
    sub = sine(lambda q: 38 + 10 * v + 12 * np.clip(q / 1.9, 0, 1), sec) * np.clip(tt / 1.2, 0, 1) * np.clip((sec - tt) / 0.7, 0, 1)
    whine = sine(6800 + 300 * v, sec) * np.clip((tt - 1.95) / 0.05, 0, 1) * np.exp(-np.maximum(tt - 1.95, 0) / 0.5) * 0.12
    thud = sine(lambda q: 55 * (1 - 0.5 * np.clip((q - 1.95) / 0.3, 0, 1)), sec) * (tt >= 1.95) * np.exp(-np.maximum(tt - 1.95, 0) / 0.18)
    return trim(reverb(rev + sub * 0.8 + whine + thud * 0.9, 1.2, 0.4))


def notice(v):
    """It notices you looking: accelerating wet clicks and a crack of the neck."""
    sec = 1.1
    n = int(round(SR * sec))
    x = np.zeros(n)
    tpos, gap = 0.02, 0.11
    for _ in range(10):  # ten clicks, each gap shorter than the last
        i = int(tpos * SR)
        ln = int(SR * 0.012)
        f = rng.uniform(1400, 3200)
        x[i:i + ln] += np.sin(2 * np.pi * f * np.arange(ln) / SR) * np.exp(-np.arange(ln) / (SR * 0.002))
        x[i:i + ln] += bp(noise(ln), 800, 5000) * np.exp(-np.arange(ln) / (SR * 0.003)) * 0.6
        tpos += gap
        gap *= 0.78
    c = int(SR * (0.68 + 0.03 * v))
    ln = n - c
    crack = bp(noise(ln), 150, 2400) * np.exp(-np.arange(ln) / (SR * 0.035))
    crack += sine(lambda q: 90 * (1 - 0.6 * np.minimum(q / 0.1, 1)), ln / SR) * np.exp(-np.arange(ln) / (SR * 0.06)) * 0.8
    x[c:] += crack * 1.4
    return trim(reverb(x, 0.6, 0.3))


def shriek(v):
    """A distorted scream that rises: detuned saws through an 'ee' formant, saturated."""
    sec = 1.9
    n = int(round(SR * sec))
    tt = t(sec)
    f0 = lambda q: (260 + 40 * v) * (1 + 1.6 * np.clip(q / 0.5, 0, 1) ** 0.7) * (1 + 0.03 * np.sin(2 * np.pi * 9 * q))
    saw = np.zeros(n)
    for det in (0.985, 1.0, 1.013, 1.5):
        ph = np.cumsum(f0(tt) * det) / SR
        saw += 2 * (ph - np.floor(ph + 0.5))
    voiced = formants(saw, [(380, 0.6), (2600, 1.0), (3400, 0.7)], 1.4)
    rasp = bp(noise(n), 1500, 7000) * 0.5
    x = (voiced + rasp) * np.clip(tt / 0.04, 0, 1) * np.clip((sec - tt) / 0.7, 0, 1)
    x = np.tanh(x * 3.5)
    return trim(reverb(x, 1.0, 0.35))


def vanish(v):
    """It tears apart: ripping cloth, a sucked-in breath, a soft collapse."""
    sec = 1.4
    n = int(round(SR * sec))
    tt = t(sec)
    crackle = (rng.random(n) < 0.004 + 0.003 * v).astype(float) * rng.uniform(0.3, 1.0, n)
    rip = sweep_bp(noise(n) * 0.4 + crackle * 3, 5000, 900) * np.clip(tt / 0.02, 0, 1) * np.exp(-tt / 0.35)
    suck = bp(noise(n), 600, 4000) * np.clip(tt / 0.5, 0, 1) ** 2 * (tt < 0.5) * 0.4
    whump = sine(lambda q: 70 * (1 - 0.5 * np.minimum(q / 0.4, 1)), sec) * np.exp(-np.maximum(tt - 0.45, 0) / 0.2) * (tt >= 0.45)
    return trim(reverb(rip * 1.2 + suck[::-1] * 0.3 + whump * 0.8, 0.8, 0.35))


def main():
    only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 and sys.argv[1] == "--only" else None
    if only:
        made = []
        gens = {"voice": (voice, 3, 0.8), "presence": (presence, 2, 0.8), "notice": (notice, 2, 0.8),
                "shriek": (shriek, 2, 0.7), "vanish": (vanish, 2, 0.8)}
        for name in only:
            fn, variants, peak = gens[name]
            for v in range(variants):
                made.append(write(f"{name}{v + 1}", fn(v), peak))
        for path, dur in made:
            print(f"{os.path.relpath(path, ROOT)}  {dur:.2f}s  {os.path.getsize(path)} bytes")
        return 0
    made = []
    for v in range(4):
        made.append(write(f"step{v + 1}", step(v)))
    made.append(write("hum", hum(), 0.8))
    made.append(write("tell", tell(), 0.7))
    for v in range(2):
        made.append(write(f"breath{v + 1}", breath(v), 0.8))
    for v in range(3):
        made.append(write(f"fabric{v + 1}", fabric(v), 0.75))
    made.append(write("knock", knock()))
    made.append(write("snuff", snuff(), 0.7))
    made.append(write("windup", windup(), 0.8))
    made.append(write("strike", strike()))
    made.append(write("whiff", whiff(), 0.8))
    made.append(write("sting", sting(), 0.85))
    made.append(write("seal", seal()))
    made.append(write("arrival", arrival()))
    for v in range(2):
        made.append(write(f"chalk{v + 1}", chalk(v), 0.6))
    made.append(write("discovery", discovery(), 0.6))
    made.append(write("lens", lens(), 0.7))
    made.append(write("effigy_break", effigy_break(), 0.8))
    made.append(write("vigil", vigil(), 0.8))
    made.append(write("turn", turn(), 0.7))
    made.append(write("sink", sink(), 0.8))
    made.append(write("ring", ring(), 0.35))
    for name, fn, variants, peak in (("voice", voice, 3, 0.8), ("presence", presence, 2, 0.8), ("notice", notice, 2, 0.8),
                                     ("shriek", shriek, 2, 0.7), ("vanish", vanish, 2, 0.8)):
        for v in range(variants):
            made.append(write(f"{name}{v + 1}", fn(v), peak))
    for path, dur in made:
        print(f"{os.path.relpath(path, ROOT)}  {dur:.2f}s  {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    sys.exit(main())
