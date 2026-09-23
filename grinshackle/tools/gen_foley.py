#!/usr/bin/env python3
"""Grinshackle creature foley: fully procedural synthesis (numpy only).
No samples. Building blocks: gaussian noise, zero-phase FFT band filters,
exponentially decaying inharmonic sine partials (metal), gaussian formant
stacks, low-frequency random modulators, envelopes."""
import os, json, math
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw

SR = 44100
ROOT = "/tmp/claude-0/-home-user-Gamesforfun/f0d9b1e4-8cf6-5788-bfed-3c567a50b1ea/scratchpad"
OUT = f"{ROOT}/build/Grinshackle_RP/sounds/grinshackle"
PREV = f"{ROOT}/assets_work/audio_previews"
os.makedirs(OUT, exist_ok=True); os.makedirs(PREV, exist_ok=True)
rng = np.random.default_rng(0x6E15)

# ---------------------------------------------------------------- helpers
def db(x): return 10.0 ** (x / 20.0)
def to_db(v): return -200.0 if v <= 0 else 20.0 * math.log10(v)
def secs(s): return int(round(s * SR))
def taxis(n): return np.arange(n) / SR
def noise(n): return rng.standard_normal(n)

def _fgain(n):
    f = np.fft.rfftfreq(n, 1.0 / SR)
    return np.maximum(f, 1e-3)

def bandpass(x, lo, hi, order=4):
    """Zero-phase Butterworth-magnitude band filter via FFT (pads short input)."""
    n = len(x); m = max(n, 8192)
    X = np.fft.rfft(x, n=m); f = _fgain(m)
    g = 1.0 / np.sqrt(1.0 + (lo / f) ** (2 * order)) / np.sqrt(1.0 + (f / hi) ** (2 * order))
    return np.fft.irfft(X * g, n=m)[:n]

def lowpass(x, hi, order=4):
    n = len(x); m = max(n, 8192)
    X = np.fft.rfft(x, n=m); f = _fgain(m)
    return np.fft.irfft(X / np.sqrt(1.0 + (f / hi) ** (2 * order)), n=m)[:n]

def formants(x, centres, widths_oct, weights):
    """Gaussian-in-log-frequency bandpass stack (formant-like resonances)."""
    n = len(x); m = max(n, 8192)
    X = np.fft.rfft(x, n=m); f = _fgain(m)
    g = np.zeros_like(f)
    for c, w, a in zip(centres, widths_oct, weights):
        g += a * np.exp(-0.5 * (np.log2(f / c) / w) ** 2)
    return np.fft.irfft(X * g, n=m)[:n]

def slow_mod(n, rate_hz, depth=1.0, order=2):
    """Random low-frequency modulator in [1-depth, 1]."""
    m = lowpass(noise(n + secs(0.5)), rate_hz, order)[secs(0.25):secs(0.25) + n]
    m = m / (np.abs(m).max() + 1e-12)
    return 1.0 - depth * 0.5 * (1.0 - m)

def add(buf, start_s, seg, gain=1.0):
    s = int(round(start_s * SR)); e = min(len(buf), s + len(seg))
    if s < 0: seg = seg[-s:]; s = 0
    if e > s: buf[s:e] += gain * seg[:e - s]

def env_ad(n, attack_s, tau_s, hold_s=0.0):
    t = taxis(n)
    a = np.clip(t / max(attack_s, 1e-5), 0, 1)
    a = 0.5 - 0.5 * np.cos(np.pi * a)
    d = np.where(t > attack_s + hold_s, np.exp(-(t - attack_s - hold_s) / tau_s), 1.0)
    return a * d

def hump(n, t0, t1, skew=1.0):
    t = taxis(n); u = (t - t0) / (t1 - t0)
    e = np.zeros(n); m = (u >= 0) & (u <= 1)
    e[m] = np.sin(np.pi * np.clip(u[m], 0, 1) ** skew) ** 1.2
    return e

def partials(freqs, amps, taus, n, phases=None):
    t = taxis(n); out = np.zeros(n)
    if phases is None: phases = rng.uniform(0, 2 * np.pi, len(freqs))
    for f, a, tau, ph in zip(freqs, amps, taus, phases):
        out += a * np.exp(-t / tau) * np.sin(2 * np.pi * f * t + ph)
    return out

def transient(ms, lo, hi, amp=1.0):
    """A very short band-limited noise tick with an exponential decay."""
    n = secs(ms / 1000.0)
    x = bandpass(noise(n), lo, hi, 2)
    x *= np.exp(-taxis(n) / (ms / 1000.0 / 3.0))
    return amp * x / (np.abs(x).max() + 1e-12)

def metal_hit(band=(1200, 4000), n_part=4, taus=(0.03, 0.11), amp=1.0,
              tr_ms=1.5, tr_amp=0.6, tilt=-0.35, extra=None):
    """One metallic link impact: random inharmonic partials + a tick."""
    fr = rng.uniform(band[0], band[1], n_part)
    ta = rng.uniform(taus[0], taus[1], n_part)
    am = rng.uniform(0.5, 1.0, n_part) * (fr / band[0]) ** tilt
    if extra:  # (freq, amp, tau) fixed resonance, e.g. a body mode
        fr = np.append(fr, extra[0]); am = np.append(am, extra[1] * am.sum()); ta = np.append(ta, extra[2])
    am = am / am.sum()
    L = secs(max(ta) * 6) + 64
    seg = partials(fr, am, ta, L)
    seg /= (np.abs(seg).max() + 1e-12)
    if tr_amp > 0:
        add(seg, 0, transient(tr_ms, max(band[0], 800), min(band[1] * 2.2, 12000), tr_amp))
    return amp * seg / (np.abs(seg).max() + 1e-12)

def noise_burst(dur_s, lo, hi, attack_s, tau_s, amp=1.0, order=3):
    n = secs(dur_s)
    x = bandpass(noise(n), lo, hi, order) * env_ad(n, attack_s, tau_s)
    return amp * x / (np.abs(x).max() + 1e-12)

def fade(x, ms=5.0):
    n = secs(ms / 1000.0); r = np.linspace(0, 1, n)
    x[:n] *= r; x[-n:] *= r[::-1]; return x

def normalize(x, peak_db):
    return x / (np.abs(x).max() + 1e-12) * db(peak_db)

def seamless(x, N, fade_s=0.05):
    """x has N + fade samples; fold the tail beyond N into the head."""
    F = secs(fade_s); out = x[:N].copy(); r = np.linspace(0, 1, F)
    out[:F] = x[:F] * r + x[N:N + F] * (1 - r)
    return out

# ---------------------------------------------------------------- sounds
SOUNDS = {}   # name -> (array, description, loop)

def chain_drag():
    N = secs(1.0); F = secs(0.05); T = N + F
    rum = bandpass(noise(T), 90, 180, 3)
    scrape_env = slow_mod(T, 5.0, 0.8)            # slow pressure changes
    grain = 0.55 + 0.45 * slow_mod(T, 40.0, 1.0)  # stone graininess
    rum = rum * scrape_env * (0.7 + 0.3 * grain)
    grit = bandpass(noise(T), 500, 2600, 2) * scrape_env * grain
    x = rum / np.abs(rum).max() + 0.16 * grit / np.abs(grit).max()
    k = int(rng.integers(4, 7))
    for p in np.sort(rng.uniform(0.03, 0.97, k)):
        add(x, p * 1.0, metal_hit((1200, 4000), 5, (0.03, 0.11), amp=rng.uniform(0.7, 1.2)))
    x = seamless(x, N)
    return normalize(x, -9.0), (f"1.0 s seamless loop (last 50 ms crossfaded into start). 90-180 Hz band-limited "
        f"noise rumble modulated by a 5 Hz random pressure LFO and a 40 Hz grain LFO, plus a low-level 500-2600 Hz "
        f"grit band; {k} link clicks = 5 random inharmonic decaying sines 1.2-4 kHz (tau 30-110 ms) + 1.5 ms tick."), True

def wrist_click():
    n = secs(0.18); x = np.zeros(n)
    add(x, 0.004, metal_hit((2500, 5000), 4, (0.012, 0.04), amp=1.0, tr_ms=0.8, tr_amp=0.5))
    return fade(normalize(x, -16.0)), ("Single tiny link: 4 inharmonic sines 2.5-5 kHz decaying 12-40 ms "
        "plus a 0.8 ms band-limited tick. Very quiet (-16 dBFS)."), False

def breath():
    n = secs(2.4)
    inh = hump(n, 0.05, 1.12, 0.85) * slow_mod(n, 4.5, 0.35)
    exh = hump(n, 1.28, 2.36, 1.25) * slow_mod(n, 3.5, 0.3)
    src = bandpass(noise(n), 200, 900, 4)
    a = formants(src, [330, 560, 820], [0.28, 0.25, 0.22], [1.0, 0.7, 0.45])
    b = formants(src, [250, 440, 700], [0.30, 0.28, 0.22], [1.0, 0.6, 0.3])
    x = a / np.abs(a).max() * inh + 0.85 * b / np.abs(b).max() * exh
    x = bandpass(x, 200, 900, 4)
    return fade(normalize(x, -14.0)), ("Noise band-limited to 200-900 Hz through two gaussian formant stacks "
        "(inhale 330/560/820 Hz, exhale 250/440/700 Hz); inhale hump 0.05-1.12 s, exhale 1.28-2.36 s, each "
        "roughened by a 3.5-4.5 Hz random modulator so it is slightly uneven. Quiet (-14 dBFS)."), False

def rattle():
    n = secs(0.9); x = np.zeros(n); tt = 0.004; count = 0
    while tt < 0.84:
        rate = 170 * math.exp(-tt / 0.32) + 18
        amp = rng.uniform(0.35, 1.0) * math.exp(-tt / 0.33)
        res = (700 + rng.uniform(-18, 18), 1.3, 0.035)
        add(x, tt, metal_hit((1500, 5000), 3, (0.008, 0.035), amp=amp, tr_ms=1.0, tr_amp=0.8, extra=res))
        tt += rng.exponential(1.0 / rate); count += 1
    return fade(normalize(x, -5.0)), (f"{count} clicks from a Poisson process whose rate decays from ~190/s to 18/s; "
        "each click = 1 ms tick + 3 sines 1.5-5 kHz (tau 8-35 ms) + a fixed 700 Hz resonance (tau 35 ms). "
        "Overall exponential decay tau 330 ms. Medium-loud (-5 dBFS)."), False

def lure():
    n = secs(2.6); x = np.zeros(n)
    for c0 in (0.08, 1.0, 1.85):
        k = int(rng.integers(7, 11)); span = rng.uniform(0.22, 0.3)
        for i in range(k):
            t = c0 + rng.uniform(0, span)
            add(x, t, metal_hit((2000, 6500), 3, (0.008, 0.03), amp=rng.uniform(0.4, 1.0), tr_ms=0.8, tr_amp=0.7,
                                extra=(1100 + rng.uniform(-30, 30), 0.5, 0.02)))
        s0 = c0 + span + 0.02
        add(x, s0, noise_burst(0.2, 700, 3500, 0.03, 0.06, amp=0.45) * hump(secs(0.2), 0.0, 0.2, 1.0))
        for j in range(3):
            add(x, s0 + rng.uniform(0.02, 0.16), metal_hit((2500, 6000), 2, (0.006, 0.02), amp=0.3, tr_ms=0.6, tr_amp=0.6))
    return fade(normalize(x, -8.0)), ("Three clusters at 0.08/1.0/1.85 s; each = 7-10 small-link clicks (sines 2-6.5 kHz, "
        "tau 8-30 ms, weak 1.1 kHz body mode) followed by a 0.2 s 700-3500 Hz noise scrape with three tiny clicks. "
        "Smaller/brighter than the creature's own chain. -8 dBFS."), False

def click_release():
    n = secs(0.5); x = np.zeros(n)
    latch = metal_hit((1500, 4000), 3, (0.02, 0.05), amp=1.0, tr_ms=2.0, tr_amp=1.0)
    body = partials([340, 610, 920], [1.0, 0.6, 0.35], [0.09, 0.07, 0.05], secs(0.5))
    add(x, 0.02, latch); add(x, 0.02, 0.8 * body / np.abs(body).max())
    add(x, 0.038, metal_hit((1800, 4500), 3, (0.01, 0.03), amp=0.35, tr_ms=1.0, tr_amp=0.8))  # latch bounce
    slide = noise_burst(0.3, 600, 3500, 0.06, 0.09, amp=0.5) * hump(secs(0.3), 0.0, 0.3, 1.1)
    add(x, 0.13, slide)
    for i in range(5):
        add(x, 0.15 + i * 0.05 + rng.uniform(0, 0.03), metal_hit((1200, 4000), 4, (0.02, 0.06), amp=0.55 - 0.08 * i))
    return fade(normalize(x, -6.0)), ("One heavy latch click at 20 ms: 2 ms broadband tick + 3 sines 1.5-4 kHz + a low "
        "body (340/610/920 Hz decaying 50-90 ms) and a small bounce at 38 ms; then a 0.3 s 600-3500 Hz noise slide "
        "carrying five diminishing link clicks. -6 dBFS."), False

def chain_snap():
    n = secs(1.4); x = np.zeros(n)
    crack = noise_burst(0.006, 3000, 6000, 0.0003, 0.0012, amp=1.0, order=4)
    add(x, 0.010, crack); add(x, 0.010, transient(0.6, 2000, 12000, 0.7))
    ring = partials([1800, 1800 * 1.0045, 3650, 1150], [1.0, 0.45, 0.18, 0.22],
                    [0.22, 0.17, 0.07, 0.11], secs(1.3))
    add(x, 0.012, 0.75 * ring / np.abs(ring).max())
    for td, a in ((0.72, 0.55), (0.98, 0.42)):
        add(x, td, metal_hit((1200, 4000), 5, (0.03, 0.1), amp=a))
        add(x, td, noise_burst(0.04, 180, 600, 0.002, 0.012, amp=0.3 * a))
    return fade(normalize(x, -3.0)), ("Crack: 6 ms noise burst band-limited 3-6 kHz with 0.3 ms attack plus a 0.6 ms broadband "
        "tick; ring: 1.8 kHz sine (tau 220 ms, audible ~1 s) with a detuned twin for beating and weak 3.65/1.15 kHz "
        "partials; two link drops at 0.72 s and 0.98 s (inharmonic 1.2-4 kHz partials + a 180-600 Hz stone thud). "
        "Impact level -3 dBFS."), False

def collapse_chains():
    n = secs(2.2); x = np.zeros(n); tt = 0.03; count = 0
    while tt < 1.85:
        if tt < 0.5: rate = 10 + 70 * tt / 0.5
        elif tt < 1.2: rate = 45
        else: rate = max(2.0, 45 * (1 - (tt - 1.2) / 0.65))
        genv = 1.0 if tt < 1.2 else max(0.05, 1 - (tt - 1.2) / 0.7)
        amp = rng.uniform(0.3, 1.0) * genv
        add(x, tt, metal_hit((900, 5000), 4, (0.02, 0.09), amp=amp))
        add(x, tt, noise_burst(0.035, 120, 500, 0.002, 0.01, amp=0.5 * amp))
        tt += rng.exponential(1.0 / rate); count += 1
    pile = bandpass(noise(n), 1500, 6000, 2) * hump(n, 0.0, 1.9, 0.9) * slow_mod(n, 30, 0.9)
    x += 0.08 * pile / np.abs(pile).max()
    return fade(normalize(x, -4.0)), (f"{count} link impacts from a Poisson process (rate ramps 10 to 45/s, holds, then "
        "decays to zero by 1.85 s); each = 4 sines 0.9-5 kHz (tau 20-90 ms) + a 35 ms 120-500 Hz stone thud; a faint "
        "1.5-6 kHz pile rustle underneath; the last ~0.35 s is silence. -4 dBFS."), False

def step(material):
    if material == "stone":
        n = secs(0.25); x = noise_burst(0.25, 300, 1500, 0.002, 0.045, amp=1.0)
        add(x, 0.0, transient(1.2, 1000, 6000, 0.35))
        d = "300-1500 Hz noise, 2 ms attack, 45 ms decay, with a 1.2 ms tick."
    elif material == "deepslate":
        n = secs(0.28); x = noise_burst(0.28, 150, 900, 0.003, 0.06, amp=1.0)
        add(x, 0.0, transient(1.5, 500, 3000, 0.25))
        d = "150-900 Hz noise, 3 ms attack, 60 ms decay, darker and duller tick."
    elif material == "gravel":
        n = secs(0.24); x = np.zeros(n); k = int(rng.integers(9, 15))
        for i in range(k):
            t = rng.uniform(0, 0.09) * (1 + 0.3 * i / k)
            add(x, t, noise_burst(rng.uniform(0.003, 0.008), 800, 3000, 0.0005, 0.002, amp=rng.uniform(0.3, 1.0)))
        x += noise_burst(0.24, 400, 1600, 0.004, 0.05, amp=0.35)
        d = f"{k} granular 3-8 ms micro-bursts 800-3000 Hz scattered over ~100 ms plus a soft 400-1600 Hz bed."
    elif material == "wood":
        n = secs(0.26); x = noise_burst(0.26, 120, 400, 0.003, 0.05, amp=1.0)
        tone = partials([176, 341], [1.0, 0.4], [0.06, 0.035], n)
        x += 0.45 * tone / np.abs(tone).max()
        add(x, 0.0, transient(1.0, 600, 2500, 0.2))
        d = "120-400 Hz noise thump, 3 ms attack, 50 ms decay, plus a slight 176/341 Hz decaying tone."
    else:  # dirt
        n = secs(0.26); x = noise_burst(0.26, 100, 500, 0.008, 0.07, amp=1.0)
        d = "100-500 Hz noise, soft 8 ms attack, 70 ms decay, no tick (muffled)."
    return fade(normalize(x, -12.0)), f"Single footstep on {material}: {d} Quiet (-12 dBFS).", False

SOUNDS["chain_drag"] = chain_drag()
SOUNDS["wrist_click"] = wrist_click()
SOUNDS["breath"] = breath()
SOUNDS["rattle"] = rattle()
SOUNDS["lure"] = lure()
SOUNDS["click_release"] = click_release()
SOUNDS["chain_snap"] = chain_snap()
SOUNDS["collapse_chains"] = collapse_chains()
for m in ("stone", "deepslate", "gravel", "wood", "dirt"):
    SOUNDS[f"step_{m}"] = step(m)

# ---------------------------------------------------------------- preview
def preview(x, path, title):
    W, HW, HS, HT = 1000, 120, 300, 26
    img = Image.new("RGB", (W, HT + HW + HS), (16, 16, 20)); dr = ImageDraw.Draw(img)
    n = len(x); idx = np.linspace(0, n, W + 1).astype(int)
    mid = HT + HW // 2
    for c in range(W):
        seg = x[idx[c]:max(idx[c] + 1, idx[c + 1])]
        lo, hi = seg.min(), seg.max()
        dr.line([(c, mid - int(hi * (HW / 2 - 2))), (c, mid - int(lo * (HW / 2 - 2)))], fill=(120, 200, 255))
    dr.line([(0, mid), (W, mid)], fill=(60, 60, 70))
    for lvl, col in ((0.708, (255, 90, 90)), (0.9, (255, 200, 90))):  # -3 dBFS, hard ceiling
        for s in (1, -1):
            y = mid - int(s * lvl * (HW / 2 - 2)); dr.line([(0, y), (W, y)], fill=col)
    # STFT
    NF = 2048; win = np.hanning(NF); fr = np.fft.rfftfreq(NF, 1 / SR)
    starts = np.linspace(0, max(n - NF, 1), W).astype(int)
    xp = np.concatenate([x, np.zeros(NF)])
    spec = np.stack([np.abs(np.fft.rfft(xp[s:s + NF] * win)) for s in starts])
    spec = 20 * np.log10(spec / (NF / 4) + 1e-9)
    fmin, fmax = 40.0, 16000.0
    rows = fmin * (fmax / fmin) ** (np.arange(HS)[::-1] / (HS - 1))
    bins = np.clip(np.searchsorted(fr, rows), 0, len(fr) - 1)
    S = spec[:, bins].T                                   # HS x W
    v = np.clip((S + 96) / 96, 0, 1)
    r = np.clip(v * 3, 0, 1); g = np.clip(v * 3 - 1, 0, 1); b = np.clip(v * 3 - 2, 0, 1) * 0.9 + (v < 0.33) * v * 1.5
    rgb = (np.stack([r, g, np.clip(b, 0, 1)], -1) * 255).astype(np.uint8)
    img.paste(Image.fromarray(rgb, "RGB"), (0, HT + HW))
    for f in (100, 300, 1000, 3000, 10000):
        y = HT + HW + int((HS - 1) * (1 - math.log(f / fmin) / math.log(fmax / fmin)))
        dr.line([(0, y), (W, y)], fill=(70, 70, 80)); dr.text((4, y - 11), f"{f} Hz", fill=(200, 200, 200))
    for t in np.arange(0, n / SR, 0.25):
        c = int(t / (n / SR) * W); dr.line([(c, HT), (c, HT + HW + HS)], fill=(50, 50, 60)); dr.text((c + 2, HT + 2), f"{t:.2f}s", fill=(150, 150, 160))
    dr.text((6, 6), title, fill=(240, 240, 240))
    img.save(path)

# ---------------------------------------------------------------- write / verify
summary = []
for name, (x, desc, loop) in SOUNDS.items():
    assert np.abs(x).max() <= 0.9 + 1e-9, name
    path = f"{OUT}/{name}.ogg"
    sf.write(path, x.astype(np.float32), SR, format="OGG", subtype="VORBIS")
    y, sr = sf.read(path, dtype="float32")
    assert sr == SR, (name, sr)
    assert y.ndim == 1, (name, "not mono")
    dur = len(y) / SR
    assert abs(dur - len(x) / SR) < 0.005, (name, dur, len(x) / SR)
    pk = float(np.abs(y).max()); rms = float(np.sqrt(np.mean(y ** 2)))
    assert pk <= 0.9, (name, pk)
    if loop:  # seam check: discontinuity between last and first sample vs typical step
        step_typ = float(np.median(np.abs(np.diff(y)))); seam = abs(float(y[-1]) - float(y[0]))
        desc += f" Seam |y[-1]-y[0]| = {seam:.4f} (median sample step {step_typ:.4f})."
    preview(y, f"{PREV}/{name}.png", f"{name}.ogg  {dur:.3f}s  peak {to_db(pk):.1f} dBFS  rms {to_db(rms):.1f} dBFS")
    summary.append({"name": f"gs.{name.replace('step_', 'step.')}", "file": f"sounds/grinshackle/{name}.ogg",
                    "seconds": round(dur, 4), "peak_dbfs": round(to_db(pk), 2), "rms_dbfs": round(to_db(rms), 2),
                    "loop": loop, "description": desc})
with open(f"{ROOT}/assets_work/foley_summary.json", "w") as fh:
    json.dump(summary, fh, indent=1)
print(json.dumps(summary, indent=1))
