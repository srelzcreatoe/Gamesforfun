"""Original synthesized sound effects (the repository build uses no film audio).

Roars are built from a bowed-string-like harmonic source with a moving
pitch contour, vocal-tract formants, rasp (noise AM) and a large-space
reverb tail; impacts and beams from shaped noise, FM and sub-bass layers.
Each sound is written as mono OGG Vorbis via ffmpeg.
"""
import os
import subprocess
import tempfile
import wave
import numpy as np

SR = 44100
RNG = np.random.default_rng(1954)


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def env(n, a, d_start, d_len):
    t = np.arange(n) / SR
    e = np.clip(t / max(a, 1e-4), 0, 1)
    rel = np.clip(1 - (t - d_start) / max(d_len, 1e-4), 0, 1)
    return e * np.where(t > d_start, rel, 1.0)


def fft_filter(x, bands, base=0.05):
    """Sum of gaussian bands [(freq, width, gain)], plus base passthrough."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    h = np.full_like(f, base)
    for fc, bw, g in bands:
        h += g * np.exp(-0.5 * ((f - fc) / bw) ** 2)
    return np.fft.irfft(X * h, len(x))


def lowpass(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / (1 + (f / fc) ** 4), len(x))


def highpass(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * (1 - 1 / (1 + (f / fc) ** 4)), len(x))


def noise(n):
    return RNG.standard_normal(n)


def slow_noise(n, rate):
    k = max(2, int(n / SR * rate))
    pts = RNG.standard_normal(k + 1)
    return np.interp(np.linspace(0, k, n), np.arange(k + 1), pts)


def harmonic(f0, n_h=40, tilt=0.9, jitter=0.0):
    ph = 2 * np.pi * np.cumsum(f0) / SR
    out = np.zeros_like(f0)
    for k in range(1, n_h + 1):
        fk = f0 * k
        a = (1.0 / k ** tilt) * (fk < SR / 2 - 500)
        out += a * np.sin(k * ph + RNG.uniform(0, 6.28))
    return out


def reverb(x, secs=1.8, wet=0.35, pre=0.03):
    n = int(SR * secs)
    ir = noise(n) * np.exp(-np.arange(n) / (SR * secs / 6.0))
    ir = lowpass(ir, 5000)
    ir[: int(SR * pre)] *= np.linspace(0, 1, int(SR * pre))
    m = len(x) + n
    y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)
    y = y / (np.max(np.abs(y)) + 1e-9) * np.max(np.abs(x))
    out = np.zeros(m)
    out[: len(x)] += x * (1 - wet)
    out += y * wet
    return out


def norm(x, peak=0.92):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def contour(n, pts):
    """pts: [(time, value)] piecewise-smooth curve."""
    t = np.arange(n) / SR
    ts, vs = zip(*pts)
    c = np.interp(t, ts, vs)
    k = int(SR * 0.04)
    return np.convolve(c, np.ones(k) / k, mode="same") if k > 1 else c


def master(x, drive=2.2, sub=0.0, peak=0.97):
    """Make it hit: optional extra sub-bass, then soft saturation into a limiter so the
    whole sound sits near full scale instead of only its loudest instant."""
    x = x / (np.max(np.abs(x)) + 1e-9)
    if sub:
        x = x + sub * norm(lowpass(x, 85), 1.0)
        x = x / (np.max(np.abs(x)) + 1e-9)
    return norm(np.tanh(x * drive) / np.tanh(drive), peak)


def boom(dur, f0=72.0, f1=24.0, decay=2.2, bend=9.0):
    """A falling sub-bass thud: the weight in every footfall and blast."""
    t = t_axis(dur)
    f = f1 + (f0 - f1) * np.exp(-t * bend)
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.exp(-t * decay)
    # the fundamental is below what a phone speaker can move, so it is overdriven into
    # harmonics (2x..5x) that carry the same weight where small speakers can play it
    grit = np.tanh(np.sin(ph) * 4.0 * e ** 0.5) * e
    return 0.6 * np.sin(ph) * e + 0.75 * grit + 0.6 * np.sin(2 * ph) * e ** 1.6 + 0.4 * np.sin(3 * ph + 0.7) * e ** 2.2


def burst(n, at, length, fc_lo, fc_hi):
    """A band of noise switched on at `at` seconds and dying over `length`."""
    t = np.arange(n) / SR
    e = (t >= at) * np.exp(-np.clip(t - at, 0, None) / max(length, 1e-3))
    return highpass(lowpass(noise(n), fc_hi), fc_lo) * e


def rubble_rain(n, t0, t1, count, fc=2600, rate=24):
    t = np.arange(n) / SR
    x = np.zeros(n)
    for d in RNG.uniform(t0, t1, count):
        x += RNG.uniform(0.3, 1.0) * lowpass(noise(n), RNG.uniform(fc * 0.4, fc)) * np.exp(-np.clip(t - d, 0, None) * rate) * (t > d)
    return x


# ----------------------------------------------------------------- roars
def roar(dur, pts, rasp=0.45, formants=((620, 160, 1.0), (1250, 260, 0.8), (2350, 380, 0.55), (3400, 500, 0.3)),
         tilt=0.85, gurgle=0.0, sub=0.35, tail=2.0):
    n = int(SR * dur)
    f0 = contour(n, pts)
    f0 *= 1 + 0.018 * np.sin(2 * np.pi * 5.3 * t_axis(dur)) + 0.03 * slow_noise(n, 6)
    src = harmonic(f0, 44, tilt)
    # rasp: rosin-on-string roughness
    am = 1 + rasp * lowpass(noise(n), 140) / 0.15
    src = src * np.clip(am, 0, None)
    if gurgle:
        gur = 1 + gurgle * np.sin(2 * np.pi * (9 + 4 * slow_noise(n, 3)) * t_axis(dur))
        src = src * gur
    voiced = fft_filter(src, formants, 0.08)
    screech = fft_filter(noise(n) * (0.5 + 0.5 * np.abs(np.sin(np.cumsum(f0) * 2 * np.pi / SR))), [(2800, 900, 1.0)], 0.0)
    body = norm(voiced) + 0.18 * norm(screech)
    rumble = lowpass(noise(n), 70) * sub * 6 + sub * np.sin(2 * np.pi * 42 * t_axis(dur))
    x = (body + 0.6 * norm(rumble) * sub) * env(n, 0.12, dur * 0.72, dur * 0.28)
    return norm(reverb(x, tail, 0.38))


def roar4():
    return roar(4.3, [(0, 150), (0.3, 300), (0.9, 330), (2.2, 348), (3.0, 300), (3.7, 230), (4.3, 170)])


def roar3():
    return roar(3.2, [(0, 190), (0.25, 320), (1.4, 360), (2.4, 300), (3.2, 210)], rasp=0.6, tilt=0.8,
                formants=((700, 180, 1.0), (1450, 280, 0.8), (2600, 400, 0.5)), sub=0.25, tail=1.6)


def roar2():
    return roar(2.6, [(0, 200), (0.3, 270), (1.4, 290), (2.0, 240), (2.6, 180)], rasp=0.7, tilt=0.95,
                formants=((520, 160, 1.0), (1100, 240, 0.7), (2100, 360, 0.4)), gurgle=0.7, sub=0.2, tail=1.2)


def hurt():
    return roar(0.9, [(0, 260), (0.15, 330), (0.9, 210)], rasp=0.6, sub=0.2, tail=0.9)


# ----------------------------------------------------------------- impacts
def step():
    """A footfall you feel before you hear: a sub drop, the crack of the ground giving, then debris."""
    dur = 2.6
    n = int(SR * dur)
    t = t_axis(dur)
    sub = boom(dur, 78, 22, 2.0)
    body = burst(n, 0.0, 0.16, 70, 260)
    crack = burst(n, 0.0, 0.012, 1200, 9000) + 0.6 * burst(n, 0.035, 0.02, 600, 5000)
    crunch = burst(n, 0.01, 0.12, 200, 1400)
    ground = lowpass(noise(n), 60) * np.exp(-t * 1.6)
    knock = burst(n, 0.0, 0.07, 140, 520)
    x = 0.6 * norm(sub) + 1.1 * norm(body) + 1.0 * norm(knock) + 0.7 * norm(crack) + 0.55 * norm(crunch) + 0.4 * norm(rubble_rain(n, 0.05, 0.9, 22)) + 0.3 * norm(ground)
    return master(reverb(x, 2.2, 0.28), 2.8)


def land():
    """He comes down from a leap: two hits a heartbeat apart and the street coming apart after them."""
    dur = 3.6
    n = int(SR * dur)
    t = t_axis(dur)
    k = int(0.085 * SR)
    sub = boom(dur, 95, 19, 1.4, 7.0)
    sub[k:] += 0.8 * boom(dur, 80, 21, 1.7)[:-k]
    body = burst(n, 0.0, 0.22, 60, 300) + 0.8 * burst(n, 0.085, 0.2, 60, 260)
    crack = burst(n, 0.0, 0.015, 900, 10000) + burst(n, 0.085, 0.02, 700, 8000) + 0.5 * burst(n, 0.21, 0.03, 500, 4000)
    ground = lowpass(noise(n), 55) * np.exp(-t * 1.0)
    cascade = rubble_rain(n, 0.1, 1.9, 60, 3000, 18)
    knock = burst(n, 0.0, 0.09, 130, 560) + 0.8 * burst(n, 0.085, 0.09, 130, 500)
    x = 0.8 * norm(sub) + 1.0 * norm(body) + 0.85 * norm(knock) + 0.65 * norm(crack) + 0.55 * norm(cascade) + 0.35 * norm(ground)
    return master(reverb(x, 2.8, 0.3), 3.2)


def crash():
    """Masonry and steel giving way."""
    dur = 2.4
    n = int(SR * dur)
    t = t_axis(dur)
    x = np.zeros(n)
    for d in np.sort(RNG.uniform(0, 1.2, 46)):
        a = RNG.uniform(0.3, 1.0)
        x += a * fft_filter(noise(n), [(RNG.uniform(300, 3200), 600, 1)], 0.02) * np.exp(-np.clip(t - d, 0, None) * 26) * (t > d)
    groan = harmonic(contour(n, [(0, 150), (0.5, 90), (1.4, 60)]), 14, 0.8) * np.exp(-t * 2.2)      # steel bending
    x = norm(x) + 0.7 * norm(boom(dur, 64, 26, 2.4)) + 0.5 * norm(lowpass(noise(n), 110)) * np.exp(-t * 1.8) + 0.25 * norm(groan)
    return master(reverb(x, 1.6, 0.3), 2.4)


def leap():
    """The push off the ground: a deep heave of air and effort."""
    dur = 1.5
    n = int(SR * dur)
    t = t_axis(dur)
    fc = contour(n, [(0, 220), (0.45, 1100), (1.0, 380), (1.5, 160)])
    ph = np.cumsum(fc) / SR
    whoosh = noise(n) * (0.6 + 0.4 * np.sin(2 * np.pi * ph * 0.02))
    whoosh = fft_filter(whoosh, [(500, 420, 1.0), (1100, 700, 0.5)], 0.02) * env(n, 0.3, 0.55, 0.9)
    push = boom(dur, 60, 26, 4.0) + 0.5 * burst(n, 0.0, 0.1, 80, 500)
    grunt = roar(0.9, [(0, 95), (0.2, 140), (0.9, 80)], rasp=0.9, sub=0.4, tail=0.4)
    x = 0.9 * norm(whoosh) + 0.8 * norm(push)
    x[: min(n, len(grunt))] += 0.55 * grunt[: min(n, len(grunt))]
    return master(reverb(x, 1.2, 0.2), 2.2)


def bite():
    """Jaws coming together on something."""
    dur = 1.1
    n = int(SR * dur)
    t = t_axis(dur)
    snap = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * 60) for f in (640, 1180, 1930, 2760))
    snap = norm(snap) + 0.8 * norm(burst(n, 0.0, 0.01, 1500, 9000)) + 0.5 * norm(burst(n, 0.05, 0.02, 800, 6000))
    wet = burst(n, 0.03, 0.09, 300, 2400)
    growl_ = roar(0.9, [(0, 130), (0.12, 210), (0.9, 110)], rasp=1.0, sub=0.4, tail=0.4)
    x = 0.9 * norm(snap) + 0.35 * norm(wet) + 0.6 * norm(boom(dur, 70, 30, 6.0))
    x[: min(n, len(growl_))] += 0.6 * growl_[: min(n, len(growl_))]
    return master(reverb(x, 0.9, 0.2), 2.6)


def sweep():
    """A tail the length of a street cutting through the air, and the crack at its end."""
    dur = 1.7
    n = int(SR * dur)
    t = t_axis(dur)
    swell = np.exp(-((t - 0.62) / 0.3) ** 2)
    low = lowpass(noise(n), 320) * swell
    mid = fft_filter(noise(n), [(700, 500, 1.0)], 0.0) * np.exp(-((t - 0.68) / 0.16) ** 2)
    whip = burst(n, 0.72, 0.03, 1500, 9000) + 0.8 * boom(dur, 110, 36, 5.0) * 0
    thud = np.zeros(n)
    k = int(0.72 * SR)
    b = boom(dur, 90, 28, 3.2)
    thud[k:] = b[: n - k]
    x = norm(low) + 0.7 * norm(mid) + 0.6 * norm(whip) + 0.8 * norm(thud)
    return master(reverb(x, 1.4, 0.25), 2.4)


def impact():
    """Where a beam meets the ground: a blast that never quite stops, and things burning."""
    dur = 2.2
    n = int(SR * dur)
    t = t_axis(dur)
    blast = boom(dur, 85, 24, 2.4) + 0.8 * burst(n, 0.0, 0.3, 60, 500) + 0.5 * burst(n, 0.0, 0.02, 1000, 9000)
    sizzle = highpass(noise(n), 2200) * (0.55 + 0.45 * np.sign(np.sin(2 * np.pi * 61 * t))) * np.exp(-t * 1.3)
    roar_ = burst(n, 0.0, 0.5, 150, 900) * (1 + 0.5 * slow_noise(n, 20))
    x = norm(blast) + 0.8 * norm(roar_) + 0.5 * norm(sizzle) + 0.45 * norm(rubble_rain(n, 0.05, 1.2, 30)) + 0.2 * norm(lowpass(noise(n), 70)) * np.exp(-t * 1.2)
    return master(reverb(x, 1.8, 0.28), 2.8)


def ignite():
    """The instant the beam lights: the air is pulled in, then split."""
    dur = 3.0
    n = int(SR * dur)
    t = t_axis(dur)
    at = 0.28
    k = int(at * SR)
    pull = highpass(noise(n), 500) * np.clip(t / at, 0, 1) ** 3 * (t < at)                 # the in-rush
    hit = np.zeros(n)
    hit[k:] = (boom(dur, 110, 18, 1.2, 6.0) + 0.6 * boom(dur, 55, 30, 2.0))[: n - k]
    crack = burst(n, at, 0.02, 800, 12000) + 0.7 * burst(n, at + 0.03, 0.12, 300, 5000)
    tz = np.clip(t - at, 0, None)
    zap = np.sin(2 * np.pi * np.cumsum(2600 * np.exp(-tz * 5) + 180) / SR) * np.exp(-tz * 3) * (t >= at)
    thunder = lowpass(noise(n), 260) * (t >= at) * np.exp(-tz * 1.4) * (1 + 0.6 * slow_noise(n, 14))
    tail = highpass(noise(n), 3000) * (t >= at) * np.exp(-tz * 1.6)
    split = burst(n, at, 0.35, 180, 1400) * (1 + 0.5 * slow_noise(n, 25))
    x = 0.35 * norm(pull) + 0.9 * norm(hit) + 0.8 * norm(crack) + 0.5 * norm(zap) + 0.6 * norm(thunder) + 0.8 * norm(split) + 0.3 * norm(tail)
    return master(reverb(x, 2.6, 0.3), 3.0)


def surge():
    """Lightning jumping between the plates."""
    dur = 0.8
    n = int(SR * dur)
    t = t_axis(dur)
    gate = (np.sin(2 * np.pi * (95 + 40 * slow_noise(n, 30)) * t) > 0.2) * (RNG.random(n) < 0.6)
    buzz = highpass(noise(n) * gate, 1400) * np.exp(-t * 5)
    chirp = np.sin(2 * np.pi * np.cumsum(3200 * np.exp(-t * 14) + 400) / SR) * np.exp(-t * 16)
    snap = burst(n, 0.0, 0.006, 2000, 12000)
    x = norm(buzz) + 0.5 * norm(chirp) + 0.7 * norm(snap) + 0.3 * norm(boom(dur, 120, 50, 9.0))
    return master(reverb(x, 0.7, 0.2), 2.4)


def rumble():
    """The ground under everything while he charges: felt more than heard."""
    dur = 4.6
    n = int(SR * dur)
    t = t_axis(dur)
    wob = np.sin(2 * np.pi * 31 * t + 2 * np.sin(2 * np.pi * 0.6 * t))
    x = 0.45 * norm(lowpass(noise(n), 58) * (1 + 0.5 * slow_noise(n, 5))) + 0.5 * np.tanh(wob * 6) + 0.2 * np.sin(2 * np.pi * 47 * t)
    x = x + 1.6 * norm(highpass(lowpass(noise(n), 360), 100)) * (0.55 + 0.45 * slow_noise(n, 9))
    return master(x * env(n, 0.5, dur - 0.7, 0.7), 2.0, peak=0.9)


def growl():
    """A long low growl from somewhere in the chest."""
    g = roar(2.4, [(0, 62), (0.5, 92), (1.4, 84), (2.4, 55)], rasp=1.0, gurgle=0.6, sub=0.12, tail=1.2,
             formants=((300, 140, 1.0), (640, 220, 0.9), (1300, 320, 0.5)), tilt=0.7)
    return master(g, 2.6)


# ----------------------------------------------------------------- energy
def charge():
    """The plates catching: a buzz that stutters exactly as the glow does (sin(18 t^2) > 0, the
    script's own flicker), a whine climbing under it, and the ground starting to hum."""
    dur = 2.0
    n = int(SR * dur)
    t = t_axis(dur)
    lit = np.where(t < 1.4, (np.sin(18 * t * t) > 0).astype(float), 1.0)
    k = int(0.004 * SR)
    lit = np.convolve(lit, np.ones(k) / k, mode="same")
    f = 60 + 640 * (t / dur) ** 1.8
    whine = harmonic(f, 14, 1.1) * (1 + 0.5 * np.sin(2 * np.pi * (6 + 20 * t / dur) * t))
    buzz = harmonic(np.full(n, 118.0) * (1 + 0.5 * t / dur), 30, 0.6) * lit
    crackle = highpass((RNG.random(n) < 0.004 + 0.03 * t / dur) * noise(n), 1800) * (0.4 + 0.6 * lit)
    riser = np.sin(2 * np.pi * np.cumsum(28 + 44 * (t / dur) ** 2) / SR) * (t / dur) ** 1.5
    shriek = fft_filter(noise(n), [(2600, 500, 1.0)], 0.0) * np.clip((t - 1.55) / 0.45, 0, 1) ** 2
    x = 0.5 * norm(whine) * (0.15 + 0.85 * t / dur) + 0.75 * norm(buzz) + 0.6 * norm(crackle) + 0.45 * np.tanh(norm(riser, 1.0) * 3) * (t / dur) + 0.4 * norm(shriek)
    return master(reverb(x * env(n, 0.03, dur - 0.06, 0.06), 1.0, 0.22), 2.4)


def smoke():
    dur = 1.6
    n = int(SR * dur)
    x = lowpass(noise(n), 500) * env(n, 0.5, 1.0, 0.6)
    return norm(reverb(x, 1.0, 0.2), 0.8)


def fire():
    dur = 2.2
    n = int(SR * dur)
    x = fft_filter(noise(n), [(600, 500, 1.0), (1800, 800, 0.5)], 0.05)
    x *= 1 + 0.6 * slow_noise(n, 18)
    x += 0.5 * norm(lowpass(noise(n), 150))
    return norm(reverb(x * env(n, 0.2, 1.7, 0.5), 1.0, 0.25))


def beam_start():
    dur = 1.8
    n = int(SR * dur)
    t = t_axis(dur)
    boom = lowpass(noise(n), 200) * np.exp(-t * 3)
    zap = np.sin(2 * np.pi * np.cumsum(1800 * np.exp(-t * 4) + 200) / SR) * np.exp(-t * 2.5)
    sizzle = highpass(noise(n), 3000) * np.exp(-t * 2)
    x = norm(boom) + 0.6 * norm(zap) + 0.4 * norm(sizzle)
    return norm(reverb(x, 1.8, 0.35))


def beam():
    dur = 2.1
    n = int(SR * dur)
    t = t_axis(dur)
    mod = np.sin(2 * np.pi * 1030 * t) * (3 + 2 * np.sin(2 * np.pi * 0.7 * t))
    fm = np.sin(2 * np.pi * 310 * t + mod)
    buzz = harmonic(np.full(n, 118.0), 30, 0.7)
    sizzle = highpass(noise(n), 2500) * (0.6 + 0.4 * slow_noise(n, 25))
    roarn = lowpass(noise(n), 400)
    x = 0.55 * norm(fm) + 0.5 * norm(buzz) + 0.35 * norm(sizzle) + 0.4 * norm(roarn)
    fade = int(SR * 0.08)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    return norm(x, 0.85)


def dorsal():
    dur = 2.0
    n = int(SR * dur)
    t = t_axis(dur)
    x = np.zeros(n)
    for d in np.sort(RNG.uniform(0, 1.4, 16)):
        f = RNG.uniform(900, 2200)
        ln = (t > d) * np.exp(-np.clip(t - d, 0, None) * 6)
        x += np.sin(2 * np.pi * np.cumsum(f * np.exp(-np.clip(t - d, 0, None) * 3) + 150) / SR) * ln
    x = norm(x) + 0.4 * norm(beam()[:n])
    return norm(reverb(x, 1.5, 0.3))


def dormant():
    dur = 3.2
    n = int(SR * dur)
    t = t_axis(dur)
    breath = lowpass(noise(n), 520) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.31 * t - 1.5)) ** 2
    hum = np.tanh(np.sin(2 * np.pi * 38 * t) * 3) * 0.3
    return norm(reverb(norm(breath) + 0.5 * hum, 1.4, 0.3), 0.7)


def freeze():
    dur = 2.4
    n = int(SR * dur)
    t = t_axis(dur)
    clicks = highpass((RNG.random(n) < 0.01) * noise(n), 3000) * np.exp(-t * 0.8)
    tones = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * RNG.uniform(1.5, 3)) for f in (2093, 2637, 3136, 4186))
    whoosh = fft_filter(noise(n), [(1500, 1200, 1)], 0.0) * env(n, 0.3, 0.8, 1.4)
    x = 0.7 * norm(clicks) + 0.4 * norm(tones) + 0.5 * norm(whoosh)
    return norm(reverb(x, 1.6, 0.35))


def evolve():
    dur = 4.5
    n = int(SR * dur)
    t = t_axis(dur)
    wet = lowpass(noise(n), 900) * (1 + np.sin(2 * np.pi * (7 + 5 * slow_noise(n, 2)) * t))
    crack = highpass((RNG.random(n) < 0.006) * noise(n), 1200) * 2
    groan = roar(dur, [(0, 90), (1.5, 120), (3.5, 160), (4.5, 140)], rasp=0.8, sub=0.4, tail=0.8)[:n]
    x = 0.5 * norm(wet) + 0.4 * norm(crack) + 0.7 * groan
    return norm(x * env(n, 0.3, 3.6, 0.9))


def coagulant():
    dur = 1.3
    n = int(SR * dur)
    t = t_axis(dur)
    hiss = highpass(noise(n), 1500) * env(n, 0.05, 0.6, 0.7)
    pump = sum(np.sin(2 * np.pi * 70 * t) * np.exp(-np.clip(t - d, 0, None) * 12) * (t > d) for d in (0.0, 0.35, 0.7))
    return norm(0.6 * norm(hiss) + norm(pump))


# ----------------------------------------------------------------- atomic breath phases
# Phase lengths (seconds) of the atomic breath.  The gameplay script, the
# animations and every breath sound are all cut to this one timeline, which
# was measured from the film's heat-ray sound effect.
BREATH = dict(charge=2.0, smoke=2.5, fire=5.0, focus=2.0, beam=9.0, sputter=2.5)
ROAR_LEN = 4.9


def breath_smoke():
    dur = BREATH["smoke"] + 0.5
    n = int(SR * dur)
    x = lowpass(noise(n), 700) * (1 + 0.4 * slow_noise(n, 6)) + 0.6 * norm(lowpass(noise(n), 120))
    return norm(reverb(x * env(n, 0.5, dur - 0.7, 0.7), 1.0, 0.2), 0.8)


def breath_fire():
    dur = BREATH["fire"] + 0.6
    n = int(SR * dur)
    x = fft_filter(noise(n), [(500, 500, 1.0), (1800, 900, 0.6), (3500, 1200, 0.25)], 0.04) * (1 + 0.5 * slow_noise(n, 20))
    x = norm(x) + 0.6 * norm(lowpass(noise(n), 140))
    return norm(reverb(x * env(n, 0.3, dur - 0.7, 0.7), 1.2, 0.25))


def breath_focus():
    dur = BREATH["focus"] + 0.4
    n = int(SR * dur)
    t = t_axis(dur)
    f = 500 + 2700 * (t / dur) ** 1.6
    whine = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.4 * np.sin(4 * np.pi * np.cumsum(f) / SR)
    roar_n = fft_filter(noise(n), [(800, 600, 1.0)], 0.05) * (1 - 0.5 * t / dur)
    return norm((0.55 * norm(whine) * (0.2 + 0.8 * t / dur) + 0.7 * norm(roar_n)) * env(n, 0.2, dur - 0.3, 0.3))


def breath_beam():
    dur = BREATH["beam"] + BREATH["sputter"]
    n = int(SR * dur)
    t = t_axis(dur)
    tone = np.sin(2 * np.pi * 3200 * t) * 0.5 + 0.3 * np.sin(2 * np.pi * 6400 * t)
    fm = np.sin(2 * np.pi * 310 * t + np.sin(2 * np.pi * 1030 * t) * 3)
    sizzle = highpass(noise(n), 2500) * (0.6 + 0.4 * slow_noise(n, 25))
    rumble = lowpass(noise(n), 160)
    x = 0.3 * tone + 0.4 * norm(fm) + 0.35 * norm(sizzle) + 0.6 * norm(rumble)
    return norm(x * env(n, 0.15, BREATH["beam"], BREATH["sputter"]), 0.9)


def rays(pitch=1.0, dur=6.5):
    n = int(SR * dur)
    t = t_axis(dur)
    tone = np.sin(2 * np.pi * 3300 * pitch * t) * 0.5 + 0.3 * np.sin(2 * np.pi * 6600 * pitch * t)
    fm = np.sin(2 * np.pi * 290 * pitch * t + np.sin(2 * np.pi * 980 * t) * 3)
    sizzle = highpass(noise(n), 2000) * (0.6 + 0.4 * slow_noise(n, 30))
    x = 0.3 * tone + 0.35 * norm(fm) + 0.5 * norm(sizzle) + 0.5 * norm(lowpass(noise(n), 220))
    return master(x * env(n, 0.08, dur - 0.8, 0.8), 1.8)


def tail_ray():
    return rays(1.18, 5.5)


# ----------------------------------------------------------------- Godzilla Minus One / Minus Zero
# The heat ray's timeline (seconds): the fins rise one by one, he draws breath, the beam, and
# the stillness after it.  The script and the animations are cut to it.
HEAT = dict(charge=3.2, inhale=1.4, fire=2.8, recover=2.0)
ROAR_M_LEN = 3.7


def roar_m():
    """The old roar: a rising metallic shriek that breaks and falls away into a growl."""
    hi = roar(3.4, [(0, 310), (0.22, 720), (0.7, 980), (1.3, 930), (1.9, 640), (2.5, 360), (3.4, 230)], rasp=0.75, tilt=0.68,
              formants=((880, 240, 1.0), (1750, 380, 0.95), (2900, 520, 0.6), (4100, 600, 0.3)), sub=0.2, tail=2.2)
    lo = roar(3.4, [(0, 150), (0.3, 300), (1.2, 420), (2.2, 260), (3.4, 110)], rasp=0.9, tilt=0.8,
              formants=((420, 160, 1.0), (900, 260, 0.7), (1700, 380, 0.4)), gurgle=0.3, sub=0.4, tail=2.2)
    n = min(len(hi), len(lo))
    return master(hi[:n] + 0.5 * lo[:n], 2.3)


def fin():
    """A dorsal fin slamming out of his back: steel on stone, and the air it displaces."""
    dur = 0.6
    n = int(SR * dur)
    t = t_axis(dur)
    clack = sum(np.sin(2 * np.pi * f * t + RNG.uniform(0, 6)) * np.exp(-t * dk) for f, dk in ((212, 22), (431, 30), (903, 46), (1730, 60), (2950, 80)))
    x = norm(clack) + 0.9 * norm(burst(n, 0.0, 0.008, 900, 9000)) + 0.8 * norm(boom(dur, 150, 48, 9.0)) + 0.4 * norm(burst(n, 0.01, 0.06, 200, 1500))
    return master(reverb(x, 0.9, 0.22), 2.8)


def heat_charge():
    """Under the fins: a hum that climbs for as long as they rise."""
    dur = HEAT["charge"] + 0.2
    n = int(SR * dur)
    t = t_axis(dur)
    k = t / dur
    f = 55 + 380 * k ** 1.6
    hum = harmonic(f, 16, 0.9) * (1 + 0.4 * np.sin(2 * np.pi * (4 + 22 * k) * t))
    shimmer = np.sin(2 * np.pi * np.cumsum(900 + 2600 * k ** 2) / SR) * k ** 2
    air = fft_filter(noise(n), [(1400, 700, 1.0)], 0.02) * k ** 1.5
    low = np.tanh(np.sin(2 * np.pi * np.cumsum(30 + 40 * k) / SR) * 3) * (0.3 + 0.7 * k)
    x = 1.0 * norm(highpass(hum, 110)) * (0.2 + 0.8 * k) + 0.4 * shimmer + 0.5 * norm(air) + 0.22 * low
    return master(reverb(x * env(n, 0.1, dur - 0.08, 0.08), 1.0, 0.2), 2.2)


def inhale():
    """He draws breath, and the air for a mile around goes with it."""
    dur = HEAT["inhale"] + 0.1
    n = int(SR * dur)
    t = t_axis(dur)
    k = t / dur
    fc = contour(n, [(0, 260), (dur * 0.7, 1300), (dur, 2400)])
    rush = noise(n) * np.sin(2 * np.pi * np.cumsum(fc) / SR * 0.01 + 1) ** 0
    rush = fft_filter(rush, [(500, 400, 1.0), (1500, 900, 0.8), (3200, 1400, 0.5)], 0.02) * k ** 2.2
    growl_ = harmonic(contour(n, [(0, 70), (dur, 150)]), 20, 0.8) * (1 + 0.6 * lowpass(noise(n), 120) / 0.15) * k ** 1.5
    whine = np.sin(2 * np.pi * np.cumsum(1200 + 3000 * k ** 2) / SR) * k ** 3
    x = norm(rush) + 0.55 * norm(growl_) + 0.3 * whine
    return master(x * env(n, 0.05, dur - 0.03, 0.03), 2.4)


def heat_ray():
    """The beam: a crack, then one sustained tearing note with the roar of the air around it."""
    dur = HEAT["fire"] + 0.9
    n = int(SR * dur)
    t = t_axis(dur)
    hold = env(n, 0.02, HEAT["fire"], 0.9)
    tone = sum(np.sin(2 * np.pi * f * t + 2.5 * np.sin(2 * np.pi * m_ * t)) for f, m_ in ((523, 61), (784, 87), (1568, 113), (2610, 139))) / 4
    saw = harmonic(np.full(n, 131.0) * (1 + 0.01 * np.sin(2 * np.pi * 7 * t)), 40, 0.55)
    hiss = highpass(noise(n), 2600) * (0.6 + 0.4 * slow_noise(n, 40))
    roar_n = fft_filter(noise(n), [(260, 200, 1.0), (700, 400, 0.7)], 0.02) * (1 + 0.4 * slow_noise(n, 18))
    crack = burst(n, 0.0, 0.02, 800, 12000) + 0.9 * boom(dur, 120, 26, 3.0)
    x = (0.5 * norm(tone) + 0.55 * norm(saw) + 0.4 * norm(hiss) + 0.7 * norm(roar_n)) * hold + 0.9 * norm(crack)
    return master(reverb(x, 1.6, 0.2), 2.6)


def nuke():
    """What the beam does where it lands: a flash you hear as a crack, the blast, and the long
    roll of it going out across the land and coming back."""
    dur = 9.0
    n = int(SR * dur)
    t = t_axis(dur)
    crack = burst(n, 0.0, 0.03, 500, 12000) + 0.8 * burst(n, 0.05, 0.25, 150, 3000)
    blast = boom(dur, 120, 17, 0.55, 5.0) + 0.7 * boom(dur, 64, 24, 0.9)
    body = burst(n, 0.02, 0.9, 60, 600) * (1 + 0.5 * slow_noise(n, 16))
    roll = highpass(lowpass(noise(n), 300), 40) * np.exp(-t * 0.42) * (1 + 0.7 * slow_noise(n, 3.5)) * np.clip(t / 0.3, 0, 1)
    wind = fft_filter(noise(n), [(600, 500, 1.0)], 0.0) * np.exp(-((t - 1.3) / 0.9) ** 2)        # the wind of it passing
    debris = rubble_rain(n, 0.6, 5.5, 90, 2600, 12)
    x = 0.7 * norm(crack) + norm(blast) + 0.9 * norm(body) + 0.9 * norm(roll) + 0.45 * norm(wind) + 0.3 * norm(debris)
    return master(reverb(x, 3.2, 0.3), 3.2)


ALL = {
    "breath_smoke": breath_smoke, "breath_fire": breath_fire, "breath_focus": breath_focus,
    "breath_beam": breath_beam, "rays": rays, "tail_ray": tail_ray,

    "roar4": roar4, "roar3": roar3, "roar2": roar2, "hurt": hurt, "growl": growl,
    "step": step, "land": land, "leap": leap, "bite": bite, "sweep": sweep, "crash": crash,
    "impact": impact, "ignite": ignite, "surge": surge, "rumble": rumble,
    "charge": charge, "dormant": dormant, "freeze": freeze, "evolve": evolve, "coagulant": coagulant,

    "roar_m": roar_m, "fin": fin, "heat_charge": heat_charge, "inhale": inhale, "heat_ray": heat_ray, "nuke": nuke,
}
# how hard each stand-in is driven into the limiter (the ones not listed master themselves)
DRIVE = {"breath_smoke": 1.8, "breath_fire": 2.2, "breath_focus": 2.0, "breath_beam": 2.0,
         "roar4": 2.2, "roar3": 2.0, "roar2": 2.0, "hurt": 2.0, "evolve": 2.0, "freeze": 1.6, "dormant": 1.5, "coagulant": 1.6}


def write_ogg(x, path):
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        wav = tf.name
    with wave.open(wav, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "4", path], check=True)
    os.unlink(wav)


def _decode(path):
    """Decode any audio file to mono float32 at SR via ffmpeg."""
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def _cut(x, t0, t1, fade_in=0.2, fade_out=0.4, peak=0.92):
    y = x[int(t0 * SR):int(t1 * SR)].copy()
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    y[:fi] *= np.linspace(0, 1, fi) ** 1.5
    y[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    return norm(y, peak)


def _resample(x, ratio):
    """Play x at `ratio` times its speed (pitch and length change together)."""
    n = int(len(x) / ratio)
    return np.interp(np.arange(n) * ratio, np.arange(len(x)), x).astype(np.float64)


def _weight(x, amount=0.5):
    """Put a body under a recording: sub-bass that follows its own loudness."""
    n = len(x)
    k = int(0.06 * SR)
    follow = np.convolve(np.abs(x), np.ones(k) / k, mode="same")
    follow = follow / (follow.max() + 1e-9)
    t = np.arange(n) / SR
    low = (np.sin(2 * np.pi * 43 * t) + 0.6 * np.sin(2 * np.pi * 61 * t + 1.0) + 0.9 * norm(lowpass(noise(n), 75), 1.0)) * follow
    return norm(x, 1.0) + amount * norm(low, 1.0)


def film_sounds(audio_dir):
    """Cut the user's own film audio (kept out of the repository) into the
    same phase-timed clips: {name: samples}.  Returns {} if it is not there.

    heat_ray.mp3 is six takes separated by silence: a dull low roar (smoke),
    a brighter roar (fire), a mid roar, two beam takes carrying the piercing
    3.2 kHz tone, and a hiss.  Each breath phase gets the matching take, and
    every clip is given weight underneath and driven into the limiter.
    """
    out = {}
    roar_p, ray_p = os.path.join(audio_dir, "roar.mp3"), os.path.join(audio_dir, "heat_ray.mp3")
    if os.path.exists(roar_p):
        r = _decode(roar_p).astype(np.float64)
        full = _cut(r, 0.45, 0.45 + ROAR_LEN + 0.05, 0.02, 0.15)
        out["roar4"] = master(reverb(_weight(full, 0.55), 1.6, 0.16)[: len(full) + int(0.9 * SR)], 1.9)
        # the same voice, slowed: a growl for when he is only watching, and a bark for when he is hit
        g = _resample(_cut(r, 0.5, 2.4, 0.05, 0.5), 0.62)
        out["growl"] = master(reverb(_weight(g, 0.7), 1.2, 0.2), 2.0)
        h_ = _resample(_cut(r, 1.1, 2.0, 0.02, 0.25), 1.12)
        out["hurt"] = master(_weight(h_, 0.4), 2.0)
    if os.path.exists(ray_p):
        h = _decode(ray_p).astype(np.float64)
        B = BREATH
        out["breath_smoke"] = master(_weight(_cut(h, 0.3, 0.3 + B["smoke"] + 0.5, 0.5, 0.7, 0.8), 0.6), 1.9)
        out["breath_fire"] = master(_weight(_cut(h, 14.1, 14.1 + B["fire"] + 0.6, 0.3, 0.7), 0.5), 2.0)
        # focus: the mid roar with a rising whine added that lands on the beam's 3.2 kHz tone
        f = _cut(h, 31.0, 31.0 + B["focus"] + 0.4, 0.25, 0.3, 1.0)
        t = np.arange(len(f)) / SR
        sweep_ = 500 + 2700 * (t / t[-1]) ** 1.6
        whine = np.sin(2 * np.pi * np.cumsum(sweep_) / SR) * (0.1 + 0.9 * t / t[-1]) ** 2
        out["breath_focus"] = master(_weight(f * (1 - 0.35 * t / t[-1]) + 0.28 * whine * np.minimum(1, (t[-1] - t) / 0.3), 0.4), 1.9)
        # beam: rumbling beam take + the brighter take on top, with the take's own decay as the sputter
        total = B["beam"] + B["sputter"]
        d = h[int(44.0 * SR):int((44.0 + total) * SR)].copy()
        e = h[int(60.0 * SR):int(66.6 * SR)].copy()
        e[-int(0.6 * SR):] *= np.linspace(1, 0, int(0.6 * SR))
        d[int(0.25 * SR):int(0.25 * SR) + len(e)] += 0.7 * e
        k = int(B["sputter"] * SR)
        d[-k:] *= np.linspace(1, 0, k) ** 1.3
        d[:int(0.12 * SR)] *= np.linspace(0, 1, int(0.12 * SR))
        out["breath_beam"] = master(_weight(d, 0.45), 1.8)
        out["rays"] = master(_weight(_cut(h, 60.0, 66.5, 0.08, 0.8, 0.9), 0.3), 1.8)
        out["tail_ray"] = master(_weight(_resample(_cut(h, 60.2, 66.9, 0.06, 0.8, 0.9), 1.16), 0.3), 1.8)
        # the hiss take under the synthesized charge, and as the breath of the cooling body
        hs = _cut(h, 69.6, 69.6 + B["charge"], 0.6, 0.1, 1.0)
        c = charge()
        m = min(len(c), len(hs))
        tt = np.arange(m) / m
        out["charge"] = master(c[:m] + 0.45 * hs[:m] * tt ** 1.5, 2.0)
        out["dormant"] = master(_weight(_resample(_cut(h, 72.0, 75.6, 0.6, 1.0, 0.9), 0.8), 0.5), 1.6, peak=0.75)
    return out


def build_all(out_dir, film=None):
    """Write every sound; `film` ({name: samples}) replaces the stand-ins."""
    os.makedirs(out_dir, exist_ok=True)
    film = film or {}
    for name, fn in ALL.items():
        if name in film:
            x = film[name]
        else:
            x = fn()
            if name in DRIVE:
                x = master(x, DRIVE[name])
        write_ogg(x, os.path.join(out_dir, name + ".ogg"))
    return list(ALL)
