"""Original synthesized sound effects (no film audio is used).

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
    dur = 1.6
    n = int(SR * dur)
    t = t_axis(dur)
    thump = np.sin(2 * np.pi * (55 * np.exp(-t * 3) + 28) * t) * np.exp(-t * 4)
    crunch = lowpass(noise(n), 900) * np.exp(-t * 9)
    rubble = sum(lowpass(noise(n), 2500) * np.exp(-np.clip(t - d, 0, None) * 25) * (t > d)
                 for d in RNG.uniform(0.02, 0.5, 14)) * 0.25
    x = norm(thump) + 0.5 * norm(crunch) + 0.35 * norm(rubble)
    return norm(reverb(x, 1.6, 0.3))


def crash():
    dur = 1.8
    n = int(SR * dur)
    t = t_axis(dur)
    x = np.zeros(n)
    for d in np.sort(RNG.uniform(0, 1.1, 40)):
        a = RNG.uniform(0.3, 1.0)
        x += a * fft_filter(noise(n), [(RNG.uniform(400, 3000), 600, 1)], 0.02) * np.exp(-np.clip(t - d, 0, None) * 30) * (t > d)
    x += 0.6 * norm(lowpass(noise(n), 120)) * np.exp(-t * 2.5)
    return norm(reverb(norm(x), 1.2, 0.3))


# ----------------------------------------------------------------- energy
def charge():
    dur = 2.0
    n = int(SR * dur)
    t = t_axis(dur)
    f = 70 + 520 * (t / dur) ** 1.7
    whine = harmonic(f, 12, 1.2)
    crackle = (RNG.random(n) < 0.004 + 0.02 * t / dur) * noise(n)
    hum = np.sin(2 * np.pi * 60 * t) * 0.5
    x = norm(whine) * (0.2 + 0.8 * t / dur) + 0.5 * norm(highpass(crackle, 2000)) + 0.3 * hum
    return norm(reverb(x * env(n, 0.05, dur - 0.1, 0.1), 1.0, 0.25))


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
    breath = lowpass(noise(n), 300) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.31 * t - 1.5)) ** 2
    hum = np.sin(2 * np.pi * 38 * t) * 0.6
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


def rays():
    dur = 6.5
    n = int(SR * dur)
    t = t_axis(dur)
    tone = np.sin(2 * np.pi * 3300 * t) * 0.5 + 0.3 * np.sin(2 * np.pi * 6600 * t)
    sizzle = highpass(noise(n), 2000) * (0.6 + 0.4 * slow_noise(n, 30))
    return norm((0.35 * tone + 0.5 * norm(sizzle) + 0.3 * norm(lowpass(noise(n), 300))) * env(n, 0.1, dur - 0.8, 0.8), 0.85)


ALL = {
    "breath_smoke": breath_smoke, "breath_fire": breath_fire, "breath_focus": breath_focus,
    "breath_beam": breath_beam, "rays": rays,

    "roar4": roar4, "roar3": roar3, "roar2": roar2, "hurt": hurt, "step": step, "crash": crash,
    "charge": charge, "dormant": dormant, "freeze": freeze, "evolve": evolve, "coagulant": coagulant,
}


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


def film_sounds(audio_dir):
    """Cut the user's own film audio (kept out of the repository) into the
    same phase-timed clips: {name: samples}.  Returns {} if it is not there.

    heat_ray.mp3 is six takes separated by silence: a dull low roar (smoke),
    a brighter roar (fire), a mid roar, two beam takes carrying the piercing
    3.2 kHz tone, and a hiss.  Each breath phase gets the matching take.
    """
    out = {}
    roar_p, ray_p = os.path.join(audio_dir, "roar.mp3"), os.path.join(audio_dir, "heat_ray.mp3")
    if os.path.exists(roar_p):
        r = _decode(roar_p)
        out["roar4"] = _cut(r, 0.45, 0.45 + ROAR_LEN + 0.05, 0.02, 0.15)
    if os.path.exists(ray_p):
        h = _decode(ray_p)
        B = BREATH
        out["breath_smoke"] = _cut(h, 0.3, 0.3 + B["smoke"] + 0.5, 0.5, 0.7, 0.8)
        out["breath_fire"] = _cut(h, 14.1, 14.1 + B["fire"] + 0.6, 0.3, 0.7)
        # focus: the mid roar with a rising whine added that lands on the beam's 3.2 kHz tone
        f = _cut(h, 31.0, 31.0 + B["focus"] + 0.4, 0.25, 0.3, 1.0)
        t = np.arange(len(f)) / SR
        sweep = 500 + 2700 * (t / t[-1]) ** 1.6
        whine = np.sin(2 * np.pi * np.cumsum(sweep) / SR) * (0.1 + 0.9 * t / t[-1]) ** 2
        out["breath_focus"] = norm(f * (1 - 0.35 * t / t[-1]) + 0.28 * whine * np.minimum(1, (t[-1] - t) / 0.3))
        # beam: rumbling beam take + the brighter take on top, with the take's own decay as the sputter
        total = B["beam"] + B["sputter"]
        d = h[int(44.0 * SR):int((44.0 + total) * SR)].copy()
        e = h[int(60.0 * SR):int(66.6 * SR)].copy()
        e[-int(0.6 * SR):] *= np.linspace(1, 0, int(0.6 * SR))
        d[int(0.25 * SR):int(0.25 * SR) + len(e)] += 0.7 * e
        k = int(B["sputter"] * SR)
        d[-k:] *= np.linspace(1, 0, k) ** 1.3
        d[:int(0.12 * SR)] *= np.linspace(0, 1, int(0.12 * SR))
        out["breath_beam"] = norm(d, 0.95)
        out["rays"] = _cut(h, 60.0, 66.5, 0.08, 0.8, 0.9)
    return out


def build_all(out_dir, film=None):
    """Write every sound; `film` ({name: samples}) replaces the stand-ins."""
    os.makedirs(out_dir, exist_ok=True)
    film = film or {}
    for name, fn in ALL.items():
        write_ogg(film[name] if name in film else fn(), os.path.join(out_dir, name + ".ogg"))
    return list(ALL)
