#!/usr/bin/env python3
"""Grinshackle music beds: fully original procedural synthesis (numpy only, no samples).

music_stalk.ogg  32 s stereo seamless loop  (drone + bowed additive pad + sparse metallic plucks)
music_hunt.ogg   8 bars @ 96 BPM = 20 s stereo seamless loop (muffled kick, chain hits, ostinato, swell)

Loop strategy: every sustained component is built *periodic* over the loop length
(oscillator frequencies are integer multiples of 1/T, random drifts are sums of
integer-cycle sinusoids, noise beds are filtered with a circular FFT of exactly T),
and every event (pluck, kick, chain hit, reverb tail) is placed on a circular buffer
so tails wrap around to the start. The mandated 50 ms tail->head crossfade is then
applied on top, and the seam is measured after Vorbis decode.

Usage:  python3 gen_music.py            -> build/Grinshackle_RP/sounds/grinshackle/music_*.ogg
        python3 gen_music.py --alt      -> assets_work/audio_alt/music_hunt_24s_80bpm.ogg (80 BPM, 24 s)
"""
import os, sys, json, math
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw

SR = 44100
ROOT = "/tmp/claude-0/-home-user-Gamesforfun/f0d9b1e4-8cf6-5788-bfed-3c567a50b1ea/scratchpad"
OUT = f"{ROOT}/build/Grinshackle_RP/sounds/grinshackle"
PREV = f"{ROOT}/assets_work/audio_previews"
ALT = f"{ROOT}/assets_work/audio_alt"
XFADE_S = 0.050


# ------------------------------------------------------------------ helpers
def secs(s):
    return int(round(s * SR))


def to_db(v):
    return -200.0 if v <= 0 else 20.0 * math.log10(v)


def db(d):
    return 10.0 ** (d / 20.0)


def peak(x):
    return float(np.abs(x).max())


def rms(x):
    return float(np.sqrt(np.mean(x ** 2)))


def _f_axis(n):
    return np.maximum(np.fft.rfftfreq(n, 1.0 / SR), 1e-3)


def fft_gain(x, gain_fn, periodic=False):
    """Zero-phase filter by multiplying the spectrum with gain_fn(f).
    periodic=True uses an FFT of exactly len(x): circular filtering, so a loop
    stays seamless (the filter tail wraps around)."""
    n = len(x)
    m = n if periodic else max(1 << (n + 8191).bit_length(), 8192)
    X = np.fft.rfft(x, n=m)
    y = np.fft.irfft(X * gain_fn(_f_axis(m)), n=m)
    return y[:n]


def butter_lp(hi, order=4):
    return lambda f: 1.0 / np.sqrt(1.0 + (f / hi) ** (2 * order))


def butter_hp(lo, order=4):
    return lambda f: 1.0 / np.sqrt(1.0 + (lo / f) ** (2 * order))


def butter_bp(lo, hi, order=4):
    return lambda f: butter_lp(hi, order)(f) * butter_hp(lo, order)(f)


def lowpass(x, hi, order=4, periodic=False):
    return fft_gain(x, butter_lp(hi, order), periodic)


def highpass(x, lo, order=4, periodic=False):
    return fft_gain(x, butter_hp(lo, order), periodic)


def bandpass(x, lo, hi, order=4, periodic=False):
    return fft_gain(x, butter_bp(lo, hi, order), periodic)


def fftconv(a, b):
    n = len(a) + len(b) - 1
    m = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(a, m) * np.fft.rfft(b, m), m)[:n]


def periodic_drift(n, rng, cycles=(1, 6), depth=0.5, floor=None):
    """Smooth random signal that is exactly periodic over n samples: sum of
    sinusoids at integer cycles-per-loop with random phases and 1/k weights.
    Returns values in [1-depth, 1] (or [floor, 1])."""
    spec = np.zeros(n // 2 + 1, dtype=complex)
    for k in range(cycles[0], cycles[1] + 1):
        spec[k] = (1.0 / k) * np.exp(2j * np.pi * rng.random())
    d = np.fft.irfft(spec, n)
    d = d / (np.abs(d).max() + 1e-12)          # [-1, 1]
    lo = 1.0 - depth if floor is None else floor
    return lo + (1.0 - lo) * 0.5 * (1.0 + d)


def pan_gains(pan):
    """Constant-power pan, pan in [-1 (L), 1 (R)]."""
    th = (pan + 1.0) * math.pi / 4.0
    return math.cos(th), math.sin(th)


def place_circ(buf, x, at_s, gain=1.0, pan=0.0):
    """Add a mono (n,) or stereo (n,2) event into stereo circular buffer buf at
    at_s seconds; anything past the end wraps to the start (seamless tails)."""
    N = len(buf)
    if x.ndim == 1:
        gl, gr = pan_gains(pan)
        x = np.stack([x * gl, x * gr], axis=1)
    i0 = int(round(at_s * SR)) % N
    j = 0
    while j < len(x):
        n = min(N - i0, len(x) - j)
        buf[i0:i0 + n] += gain * x[j:j + n]
        j += n
        i0 = 0
    return buf


def loop_crossfade(x_ext, N, M):
    """x_ext has N+M samples (the render continued M samples past the loop
    end). Crossfade those M tail samples into the first M samples (equal-gain
    raised cosine: the components are coherent) and return exactly N."""
    y = x_ext[:N].copy()
    tail = x_ext[N:N + M]
    w = 0.5 * (1.0 - np.cos(np.pi * np.arange(M) / M))     # 0 -> 1
    y[:M] = y[:M] * w[:, None] + tail * (1.0 - w)[:, None]
    return y


def decaying_noise_ir(rng, seconds, tau_lo, tau_hi, split_hz=900.0, lp_hz=4000.0, predelay=0.02):
    """Reverb-like impulse response = decaying noise. Two bands: lows ring
    longer than highs (tau_lo > tau_hi), like a stone room."""
    n = secs(seconds)
    t = np.arange(n) / SR
    w = rng.standard_normal(n)
    lo = lowpass(w, split_hz, 2) * np.exp(-t / tau_lo)
    hi = highpass(w, split_hz, 2) * np.exp(-t / tau_hi)
    ir = lowpass(lo + hi, lp_hz, 2)
    ir[:secs(0.003)] *= np.linspace(0, 1, secs(0.003))
    ir = np.concatenate([np.zeros(secs(predelay)), ir])
    return ir / (np.sqrt(np.sum(ir ** 2)) + 1e-12)       # unit energy


# ------------------------------------------------------------------ analysis / preview
def stats(y):
    pk = peak(y)
    r = rms(y)
    return pk, r


def seam_metric(y):
    """Discontinuity at the loop point relative to the typical sample step."""
    step = float(np.median(np.abs(np.diff(y, axis=0))))
    seam = float(np.max(np.abs(y[-1] - y[0])))
    return seam, step


def _cmap(v):
    stops = [(0.0, (5, 4, 18)), (0.28, (60, 16, 96)), (0.55, (190, 55, 40)),
             (0.82, (248, 168, 48)), (1.0, (255, 246, 205))]
    v = np.clip(v, 0, 1)
    out = np.zeros(v.shape + (3,), dtype=np.uint8)
    for (p0, c0), (p1, c1) in zip(stops[:-1], stops[1:]):
        m = (v >= p0) & (v <= p1)
        f = ((v - p0) / (p1 - p0))[m]
        for ch in range(3):
            out[..., ch][m] = (c0[ch] + (c1[ch] - c0[ch]) * f).astype(np.uint8)
    return out


def render_preview(y, path, title, marks=()):
    """Waveform (L blue / R orange), short-term RMS envelope in dB, and a
    log-frequency STFT (20 Hz - 8 kHz) drawn with Pillow."""
    W, HW, HE, HS, PAD = 1400, 150, 90, 380, 34
    n = len(y)
    dur = n / SR
    H = PAD + HW + 8 + HE + 8 + HS + 22
    img = Image.new("RGB", (W + 2 * PAD, H), (16, 16, 20))
    dr = ImageDraw.Draw(img)
    mono = y.mean(axis=1)
    pk, r = stats(y)
    dr.text((PAD, 6), f"{title}   {dur:.3f} s  stereo  peak {to_db(pk):.2f} dBFS  rms {to_db(r):.2f} dBFS", fill=(235, 235, 235))
    # waveform
    y0 = PAD
    dr.rectangle([PAD, y0, PAD + W, y0 + HW], fill=(24, 24, 30), outline=(70, 70, 80))
    mid = y0 + HW / 2
    dr.line([PAD, mid, PAD + W, mid], fill=(60, 60, 70))
    for lvl, col in [(db(-10), (110, 40, 40)), (db(-12), (90, 60, 40))]:
        for s in (1, -1):
            yy = mid - s * lvl * (HW / 2 - 2)
            dr.line([PAD, yy, PAD + W, yy], fill=col)
    for ch, col in ((0, (110, 190, 255)), (1, (255, 170, 90))):
        cols = np.array_split(y[:, ch], W)
        for c, seg in enumerate(cols):
            if seg.size:
                dr.line([PAD + c, mid - seg.max() * (HW / 2 - 2), PAD + c, mid - seg.min() * (HW / 2 - 2)], fill=col)
    # envelope (50 ms RMS, dB)
    y1 = y0 + HW + 8
    dr.rectangle([PAD, y1, PAD + W, y1 + HE], fill=(24, 24, 30), outline=(70, 70, 80))
    hop = secs(0.05)
    nb = n // hop
    env = np.sqrt(np.mean(mono[:nb * hop].reshape(nb, hop) ** 2, axis=1))
    env_db = 20 * np.log10(env + 1e-9)
    pts = []
    for i, e in enumerate(env_db):
        xx = PAD + W * (i + 0.5) / nb
        yy = y1 + HE * (1 - np.clip((e + 60) / 60, 0, 1))
        pts.append((xx, yy))
    for lvl in (-12, -18, -24, -36, -48):
        yy = y1 + HE * (1 - (lvl + 60) / 60)
        dr.line([PAD, yy, PAD + W, yy], fill=(50, 50, 60))
        dr.text((PAD + 2, yy - 10), f"{lvl} dB", fill=(140, 140, 150))
    dr.line(pts, fill=(150, 255, 150), width=1)
    # time ticks + marks
    for k in range(0, 17):
        t = dur * k / 16
        xx = PAD + W * k / 16
        dr.line([xx, y0 + HW, xx, y0 + HW + 4], fill=(200, 200, 200))
        dr.text((xx - 10, y1 + HE + 1), f"{t:.1f}", fill=(180, 180, 180))
    for (t, label) in marks:
        xx = PAD + W * t / dur
        dr.line([xx, y0, xx, y0 + HW], fill=(255, 80, 200))
        dr.text((xx + 2, y0 + 2), label, fill=(255, 120, 220))
    # log-f spectrogram
    y2 = y1 + HE + 8
    nfft = 4096
    hopS = max((n - nfft) // (W - 1), 1)
    win = np.hanning(nfft)
    xp = np.concatenate([mono, np.zeros(nfft)])
    S = np.empty((nfft // 2 + 1, W))
    for c in range(W):
        S[:, c] = np.abs(np.fft.rfft(xp[c * hopS:c * hopS + nfft] * win))
    Sdb = 20 * np.log10(S / (0.5 * nfft) + 1e-9)
    fmin, fmax = 20.0, 8000.0
    binw = SR / nfft
    edges = fmax * (fmin / fmax) ** (np.arange(HS + 1) / HS)   # top->bottom
    rows = np.zeros((HS, W))
    for r_ in range(HS):
        hi_f, lo_f = edges[r_], edges[r_ + 1]
        b0, b1 = int(math.floor(lo_f / binw)), int(math.ceil(hi_f / binw))
        b1 = max(b1, b0 + 1)
        rows[r_] = Sdb[b0:b1].max(axis=0)
    spec = Image.fromarray(_cmap((rows + 84.0) / 84.0), "RGB")
    img.paste(spec, (PAD, y2))
    dr.rectangle([PAD, y2, PAD + W, y2 + HS], outline=(70, 70, 80))
    for f in (30, 50, 100, 200, 500, 1000, 2000, 4000, 8000):
        yy = y2 + HS * math.log(fmax / f) / math.log(fmax / fmin)
        dr.line([PAD - 5, yy, PAD, yy], fill=(200, 200, 200))
        dr.text((PAD + 2, min(yy - 5, y2 + HS - 12)), f"{f}", fill=(235, 235, 235))
    dr.text((PAD, y2 + HS + 4), "STFT 4096 hann, log frequency 20 Hz - 8 kHz, 84 dB range (mono sum)", fill=(150, 150, 150))
    img.save(path)


# ------------------------------------------------------------------ STALK
def stalk_pluck(f0, rng, seconds=3.2, B=0.012):
    """Metallic pluck at note f0: stiff-string inharmonic partials
    f_k = k f0 sqrt(1 + B k^2) with per-partial decay, plus a few non-integer
    'clank' partials and a 4 ms noise transient."""
    n = secs(seconds)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, 15):
        fk = f0 * k * math.sqrt(1 + B * k * k) * (1 + 0.003 * rng.standard_normal())
        if fk > 9000:
            break
        tau = 1.9 / (1 + 0.45 * (k - 1)) * rng.uniform(0.85, 1.15)
        amp = k ** -0.9 * (0.65 if k % 2 == 0 else 1.0)
        out += amp * np.exp(-t / tau) * np.sin(2 * np.pi * fk * t + 2 * np.pi * rng.random())
    for r in (2.76, 4.07, 5.4, 6.83):
        fk = f0 * r * (1 + 0.01 * rng.standard_normal())
        tau = rng.uniform(0.09, 0.28)
        out += 0.28 * np.exp(-t / tau) * np.sin(2 * np.pi * fk * t + 2 * np.pi * rng.random())
    nt = secs(0.004)
    tr = rng.standard_normal(nt) * np.exp(-np.arange(nt) / (nt / 3.0))
    out[:nt] += 0.6 * bandpass(tr, 400, 5000, 2)
    out *= np.minimum(t / 0.0025, 1.0)
    return out / (peak(out) + 1e-12)


def build_stalk(rng, T=32.0):
    N = secs(T)
    M = secs(XFADE_S)
    NE = N + M
    t = np.arange(NE) / SR
    # ---- 1. drone: two detuned sines (integer cycles per loop) + faint octave
    fA, fB, fO = 1328 / T, 1339 / T, 2656 / T          # 41.5, 41.84375, 83.0 Hz
    drift_o = periodic_drift(N, rng, (1, 3), 0.6)
    drift_o = np.concatenate([drift_o, drift_o[:M]])
    drone = 0.5 * np.sin(2 * np.pi * fA * t) + 0.5 * np.sin(2 * np.pi * fB * t + 1.1) \
        + 0.12 * drift_o * np.sin(2 * np.pi * fO * t + 0.4)
    # ---- 1b. filtered noise floor (circular filtering => periodic): brown-ish rumble + faint air
    def floor_noise():
        w = rng.standard_normal(N)
        rum = fft_gain(w, lambda f: butter_bp(28, 170, 2)(f) * (60.0 / f) ** 0.5, periodic=True)
        rum /= rms(rum) + 1e-12
        air = bandpass(rng.standard_normal(N), 1500, 4500, 2, periodic=True)
        air /= rms(air) + 1e-12
        return rum, air
    rumA, airA = floor_noise()
    rumB, airB = floor_noise()
    rumC, airC = floor_noise()
    breathe = periodic_drift(N, rng, (2, 7), 0.55)
    airmod = periodic_drift(N, rng, (3, 11), 0.8)
    floorL = (rumA + 0.6 * rumB) / 1.17 * breathe * 0.055 + airA * airmod * 0.0035
    floorR = (rumA + 0.6 * rumC) / 1.17 * breathe * 0.055 + airB * airmod * 0.0035
    floorL = np.concatenate([floorL, floorL[:M]])
    floorR = np.concatenate([floorR, floorR[:M]])
    # ---- 2. bowed additive pad: D2 + (A2 <-> Ab2 crossfade once per loop)
    # vibrato with integer cycles per loop so the phase closes exactly
    def base_phase(f0):
        mods = [(0.0023, 6 / T, 0.3), (0.0012, 9 / T, 2.1), (0.0007, 15 / T, 4.0)]   # (depth, rate, phase)
        ph = 2 * np.pi * f0 * t
        for d, r, p in mods:
            ph -= 2 * np.pi * f0 * d / (2 * np.pi * r) * np.cos(2 * np.pi * r * t + p)
        return ph
    voices = [(2350 / T, 0, -0.18, None), (3520 / T, 1, 0.22, "A"), (3322 / T, 2, 0.22, "Ab")]
    padL = np.zeros(NE)
    padR = np.zeros(NE)
    xf = 0.5 * (1 + np.cos(2 * np.pi * t / T))       # 1 at loop start, 0 at mid-loop
    xfA, xfAb = np.sqrt(xf), np.sqrt(1 - xf)
    bowL = np.zeros(N)
    bowR = np.zeros(N)
    for f0, vi, vpan, tag in voices:
        ph = base_phase(f0)
        vgain = 1.0 if tag is None else 0.8
        vmix = None if tag is None else (xfA if tag == "A" else xfAb)
        for k in range(1, 17):
            fk = f0 * k
            if fk > 1700:
                break
            drift = periodic_drift(N, rng, (1, 5 + (k % 3)), 0.55)
            drift = np.concatenate([drift, drift[:M]])
            amp = k ** -1.15 * (1.0 / (1 + (fk / 900.0) ** 2)) ** 0.5
            partial = amp * drift * np.sin(k * ph + 2 * np.pi * rng.random())
            if vmix is not None:
                partial = partial * vmix
            gl, gr = pan_gains(vpan + 0.28 * math.sin(k * 1.9 + vi))
            padL += vgain * gl * partial
            padR += vgain * gr * partial
        # bow hiss: noise through narrow resonators at the partial frequencies (periodic FFT)
        res = np.zeros(N // 2 + 1)
        fax = _f_axis(N)
        for k in range(1, 9):
            res += (k ** -1.0) / (1.0 + ((fax - f0 * k) / 4.0) ** 2)
        for ch, dst in ((0, bowL), (1, bowR)):
            w = np.fft.rfft(rng.standard_normal(N))
            h = np.fft.irfft(w * res, N)
            h = h / (rms(h) + 1e-12)
            dst += (vgain * h * (1.0 if vmix is None else vmix[:N]))
    bowmod = periodic_drift(N, rng, (2, 9), 0.7)
    bowL = np.concatenate([bowL * bowmod, (bowL * bowmod)[:M]])
    bowR = np.concatenate([bowR * bowmod, (bowR * bowmod)[:M]])
    padL = padL / (peak(padL) + 1e-12) + 0.05 * bowL / (peak(bowL) + 1e-12)
    padR = padR / (peak(padR) + 1e-12) + 0.05 * bowR / (peak(bowR) + 1e-12)
    padL = lowpass(padL, 1800, 2)
    padR = lowpass(padR, 1800, 2)
    # ---- 3. sparse plucks on a circular buffer with a decaying-noise reverb
    notes = {"D2": 73.416, "F2": 87.307, "Ab2": 103.826, "A2": 110.0}
    while True:
        gaps = rng.uniform(6.3, 8.7, size=4)
        gaps *= T / gaps.sum()
        if np.all(gaps >= 6.0) and np.all(gaps <= 9.0):
            break
    times = np.cumsum(gaps) - gaps[0] + rng.uniform(1.5, 4.0)
    names = list(notes)
    seq = []
    last = None
    for _ in range(4):
        choice = [nm for nm in names if nm != last and (len(seq) < 3 or nm != seq[0])]
        nm = choice[rng.integers(len(choice))]
        seq.append(nm)
        last = nm
    irL = decaying_noise_ir(rng, 3.4, 1.05, 0.5, 700, 3500)
    irR = decaying_noise_ir(rng, 3.4, 1.05, 0.5, 700, 3500)
    plucks = np.zeros((N, 2))
    events = []
    for tt, nm in zip(times, seq):
        dry = stalk_pluck(notes[nm], rng)
        wetL, wetR = fftconv(dry, irL), fftconv(dry, irR)
        wg = 0.35 / (max(peak(wetL), peak(wetR)) + 1e-12)
        pan = rng.uniform(-0.55, 0.55)
        gl, gr = pan_gains(pan)
        ev = np.stack([0.75 * gl * np.concatenate([dry, np.zeros(len(wetL) - len(dry))]) + wg * wetL,
                       0.75 * gr * np.concatenate([dry, np.zeros(len(wetR) - len(dry))]) + wg * wetR], axis=1)
        lvl = rng.uniform(0.8, 1.0)
        place_circ(plucks, ev, tt % T, lvl)
        events.append((float(tt % T), nm, round(pan, 2), round(lvl, 2)))
    plucks = np.concatenate([plucks, plucks[:M]])
    # ---- mix (gains tuned for peak -12 / rms ~ -24 dBFS)
    G_DRONE, G_FLOOR, G_PAD, G_PLUCK = 0.15, 0.8, 0.10, 0.40
    parts = {"drone": G_DRONE * np.stack([drone, drone], axis=1), "floor": G_FLOOR * np.stack([floorL, floorR], axis=1),
             "pad": G_PAD * np.stack([padL, padR], axis=1), "plucks": G_PLUCK * plucks}
    x = sum(parts.values())
    x = loop_crossfade(x, N, M)
    x -= x.mean(axis=0)
    g = db(-12.0) / peak(x)
    x *= g
    comp = {k: (rms(v) * g, peak(v) * g) for k, v in parts.items()}
    desc = (f"32.000 s stereo seamless loop. DRONE: two sines 41.500 + 41.844 Hz (1328 and 1339 cycles per loop, 0.34 Hz beat) "
            f"plus a faint 83 Hz octave with slow drift; NOISE FLOOR: 28-170 Hz brown-tilted noise (circular FFT filter, so periodic) "
            f"'breathing' under a 2-7 cycles/loop random modulator, plus -55 dB 1.5-4.5 kHz air; PAD: bowed additive voices D2 (73.44 Hz) "
            f"and A2<->Ab2 (110/103.8 Hz, equal-power crossfaded once per loop: fifth at the seam, tritone mid-loop), up to 16 partials "
            f"with k^-1.15 tilt, each partial with its own periodic random amplitude drift (1-7 cycles/loop), three integer-cycle vibratos "
            f"(<= 4 cents), bow hiss = noise through 4 Hz-wide resonators at the partials, LP 1.8 kHz; PLUCKS: 4 stiff-string inharmonic "
            f"clusters (f_k = k f0 sqrt(1+0.012 k^2), tau 1.9 s / (1+0.45(k-1)), plus 4 non-integer clank partials and a 4 ms transient) "
            f"convolved with 3.4 s decaying-noise IRs (L/R independent, lows tau 1.05 s, highs 0.5 s) and placed on a circular buffer so tails "
            f"wrap: {', '.join(f'{nm} @ {tt:.2f}s pan {pn:+.2f}' for tt, nm, pn, lv in events)} (gaps {', '.join(f'{g:.2f}' for g in gaps)} s). "
            f"No rhythm, no melody. All oscillators are integer-cycles-per-loop and the noise beds are circularly filtered, then the last 50 ms "
            f"is raised-cosine crossfaded into the head. No loop-edge fades (would break the seam).")
    marks = [(tt, nm) for tt, nm, _, _ in events]
    return x, desc, comp, marks


# ------------------------------------------------------------------ HUNT
def hunt_kick(rng, accent=False):
    d = 0.5
    n = secs(d)
    t = np.arange(n) / SR
    f = 55.0 * (1 + 1.5 * np.exp(-t / 0.032))              # ~137 Hz -> 55 Hz pitch drop
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / (0.21 if accent else 0.16))
    nt = secs(0.03)
    click = np.zeros(n)
    click[:nt] = rng.standard_normal(nt) * np.exp(-np.arange(nt) / (nt / 4.0))
    click = lowpass(bandpass(click, 120, 900, 2), 700, 2) * 0.22
    body = lowpass(body, 160, 1)                              # muffled
    out = body + click
    out *= np.minimum(t / 0.001, 1.0)
    out[-secs(0.01):] *= np.linspace(1, 0, secs(0.01))
    return out / (peak(out) + 1e-12) * (1.0 if not accent else 1.2)


def link_hit(f_base, rng, seconds=0.45):
    ratios = [1.0, 1.51, 2.19, 2.83, 3.67, 4.55]
    n = secs(seconds)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, r in enumerate(ratios):
        f = f_base * r * (1 + 0.03 * rng.standard_normal())
        if f > 14000:
            continue
        tau = rng.uniform(0.05, 0.22) * (0.85 ** k)
        out += (0.72 ** k) * np.exp(-t / tau) * np.sin(2 * np.pi * f * t + 2 * np.pi * rng.random())
    nt = secs(0.0015)
    out[:nt] += 0.35 * rng.standard_normal(nt) * np.exp(-np.arange(nt) / (nt / 3.0))
    return out


def hunt_chain_hit(rng, ir):
    """Chain hit = shackle body thud + 3 link hits jittered within ~30 ms + short stone reverb."""
    n = secs(0.7)
    t = np.arange(n) / SR
    out = np.zeros(n)
    body = np.sin(2 * np.pi * 190.0 * (1 + 0.5 * np.exp(-t / 0.01)) * t) * np.exp(-t / 0.045)
    out += 0.5 * body
    offs = [0.0, rng.uniform(0.008, 0.018), rng.uniform(0.022, 0.036)]
    for i, o in enumerate(offs):
        fb = rng.uniform(750, 1400) if i == 0 else rng.uniform(1200, 2600)
        h = link_hit(fb, rng)
        i0 = secs(o)
        m = min(len(h), n - i0)
        out[i0:i0 + m] += h[:m] * rng.uniform(0.55, 1.0) * (1.0 if i == 0 else 0.7)
    wet = fftconv(out, ir)
    wet = wet[:n] * (0.33 / (peak(wet) + 1e-12))
    out = out / (peak(out) + 1e-12) + wet
    out *= np.minimum(t / 0.0008, 1.0)
    out[-secs(0.01):] *= np.linspace(1, 0, secs(0.01))
    return out / (peak(out) + 1e-12)


def squareish(f0, n):
    t = np.arange(n) / SR
    ph = 2 * np.pi * f0 * t
    y = np.zeros(n)
    for k in range(1, 22, 2):
        y += np.sin(k * ph) / k
    for k in range(2, 11, 2):
        y += 0.15 * np.sin(k * ph) / k
    return y


def build_hunt(rng, bpm=96.0, bars=8):
    beat = 60.0 / bpm
    T = bars * 4 * beat
    N = secs(T)
    M = secs(XFADE_S)
    NE = N + M
    t = np.arange(NE) / SR
    # ---- kick: every beat, accent on the downbeat of each bar
    kicks = np.zeros((N, 2))
    for b in range(bars * 4):
        k = hunt_kick(rng, accent=(b % 4 == 0))
        place_circ(kicks, k, b * beat, 1.0, 0.0)
    kicks = np.concatenate([kicks, kicks[:M]])
    # ---- chain hits on beats 2 and 4 (alternating slight pan)
    ir_short = decaying_noise_ir(rng, 0.55, 0.16, 0.09, 1200, 6000, 0.012)
    chains = np.zeros((N, 2))
    for b in range(bars * 4):
        if b % 4 in (1, 3):
            h = hunt_chain_hit(rng, ir_short)
            pan = -0.3 if b % 4 == 1 else 0.3
            place_circ(chains, h, b * beat + rng.uniform(-0.004, 0.004), rng.uniform(0.85, 1.0), pan)
    chains = np.concatenate([chains, chains[:M]])
    # ---- ostinato: per bar in eighth notes  E1 - - F1 E1 - - rest
    E1, F1 = 41.203, 43.654
    pattern = [(0, 3, E1), (3, 1, F1), (4, 3, E1)]         # (start eighth, length eighths, freq)
    ost = np.zeros(NE)
    eighth = beat / 2
    att, rel = secs(0.008), secs(0.04)
    for bar in range(bars + 1):                             # +1 so the render continues past N
        for s0, ln, f in pattern:
            i0 = int(round((bar * 8 + s0) * eighth * SR))
            i1 = int(round((bar * 8 + s0 + ln) * eighth * SR)) - secs(0.02)
            if i0 >= NE:
                continue
            i1 = min(i1, NE)
            n = i1 - i0
            seg = squareish(f, n)
            env = np.ones(n)
            env[:att] = np.linspace(0, 1, att)
            env[-rel:] *= np.linspace(1, 0, rel)
            ost[i0:i1] += seg * env
    ost = lowpass(ost, 300.0, 4)
    ost /= peak(ost) + 1e-12
    # sidechain-style duck under every kick (-6 dB, 70 ms, 40 ms recovery) so the
    # pulse reads through the sustained bass and downbeat peaks do not stack
    duck = np.ones(NE)
    hold, rec = secs(0.07), secs(0.04)
    for b in range(bars * 4 + 1):
        i0 = int(round(b * beat * SR))
        if i0 >= NE:
            break
        i1, i2 = min(i0 + hold, NE), min(i0 + hold + rec, NE)
        duck[i0:i1] = 0.5
        duck[i1:i2] = np.linspace(0.5, 1.0, i2 - i1)
    ost *= duck
    # ---- filtered-noise swell across the 8-bar phrase (periodic by construction)
    u = (t % T) / T
    rise = u ** 2.4
    rel_start = T - eighth
    tl = t % T
    release = np.where(tl > rel_start, np.exp(-(tl - rel_start) / 0.07), 1.0)
    env = rise * release
    swell = np.zeros((NE, 2))
    for ch in range(2):
        w = rng.standard_normal(N)
        lo = bandpass(w, 180, 900, 2, periodic=True)
        hi = bandpass(w, 700, 4200, 2, periodic=True)
        lo /= rms(lo) + 1e-12
        hi /= rms(hi) + 1e-12
        lo = np.concatenate([lo, lo[:M]])
        hi = np.concatenate([hi, hi[:M]])
        bright = u ** 1.5
        swell[:, ch] = (lo * (1 - bright) + hi * bright) * env
    swell /= peak(swell) + 1e-12
    # ---- mix (no clipping, no saturation anywhere)
    G_KICK, G_CHAIN, G_OST, G_SWELL = 0.52, 0.30, 0.42, 0.20
    parts = {"kick": G_KICK * kicks, "chain": G_CHAIN * chains, "ostinato": G_OST * ost[:, None], "swell": G_SWELL * swell}
    x = sum(parts.values())
    x = loop_crossfade(x, N, M)
    x -= x.mean(axis=0)
    g = db(-10.0) / peak(x)
    x *= g
    comp = {k: (rms(v) * g, peak(v) * g) for k, v in parts.items()}
    desc = (f"{T:.3f} s stereo seamless loop = {bars} bars of 4/4 at {bpm:g} BPM (beat {beat:.4f} s). KICK every beat: sine with pitch "
            f"drop 137 -> 55 Hz (tau 32 ms), decay tau 125 ms, LP 160 Hz (muffled) plus a 30 ms 120-900 Hz noise thump; downbeat of each bar "
            f"accented (+2.4 dB, tau 170 ms). CHAIN HIT on beats 2 and 4 (panned -0.3 / +0.3): 190 Hz shackle body thud + 3 inharmonic link "
            f"clusters (ratios 1, 1.51, 2.19, 2.83, 3.67, 4.55 on bases 750-2600 Hz, tau 50-220 ms) jittered within 36 ms, through a 0.55 s "
            f"decaying-noise stone reverb; every hit is re-synthesised with fresh random detune/decay. OSTINATO per bar in eighths: "
            f"E1(41.2 Hz, 3 eighths) - F1(43.65 Hz, 1 eighth) - E1(3 eighths) - rest; square-ish waves (odd harmonics 1/k + 15 % even) "
            f"lowpassed at 300 Hz (4th order), 8 ms attack / 40 ms release gates, ducked -6 dB for 70 ms under every kick (40 ms recovery). "
            f"SWELL: stereo-independent noise cross-fading from a "
            f"180-900 Hz band to a 700-4200 Hz band while its level rises as (t/T)^2.4 across the whole 8-bar phrase, then releases "
            f"(tau 70 ms) over the last eighth so the loop restarts quiet. Events are placed on a circular buffer (reverb tails wrap), the "
            f"noise beds are circular-FFT filtered, then the last 50 ms is raised-cosine crossfaded into the head. No distortion stage.")
    marks = [(b * 4 * beat, f"bar {b + 1}") for b in range(bars)]
    return x, desc, comp, marks


# ------------------------------------------------------------------ write / verify
def write_and_verify(x, path, name, expect_seconds, target_peak_db, target_rms_db):
    assert x.ndim == 2 and x.shape[1] == 2, "stereo expected"
    assert peak(x) <= 0.9 + 1e-9, (name, peak(x))
    sf.write(path, x.astype(np.float32), SR, format="OGG", subtype="VORBIS")
    y, sr = sf.read(path, dtype="float32")
    assert sr == SR, (name, sr)
    assert y.ndim == 2 and y.shape[1] == 2, (name, y.shape)
    dur = len(y) / SR
    assert len(y) == len(x) == secs(expect_seconds), (name, len(y), len(x), secs(expect_seconds))
    pk, r = stats(y)
    assert pk <= 0.9, (name, pk)
    assert abs(to_db(pk) - target_peak_db) < 0.8, (name, to_db(pk), target_peak_db)
    seam, step = seam_metric(y)
    seam_pre, _ = seam_metric(x)
    # loop-edge sanity: the largest sample step in the 100 samples around the seam vs the whole file
    edge = np.concatenate([y[-100:], y[:100]])
    edge_step = float(np.max(np.abs(np.diff(edge, axis=0))))
    max_step = float(np.max(np.abs(np.diff(y, axis=0))))
    pkL, pkR = peak(y[:, 0]), peak(y[:, 1])
    rL, rR = rms(y[:, 0]), rms(y[:, 1])
    info = {
        "seconds": round(dur, 4), "peak_dbfs": round(to_db(pk), 2), "rms_dbfs": round(to_db(r), 2),
        "peak_dbfs_LR": [round(to_db(pkL), 2), round(to_db(pkR), 2)],
        "rms_dbfs_LR": [round(to_db(rL), 2), round(to_db(rR), 2)],
        "pre_encode_peak_dbfs": round(to_db(peak(x)), 2), "pre_encode_rms_dbfs": round(to_db(rms(x)), 2),
        "seam_abs_step": round(seam, 5), "seam_abs_step_pre_encode": round(seam_pre, 5), "median_sample_step": round(step, 5),
        "max_step_near_seam": round(edge_step, 5), "max_step_whole_file": round(max_step, 5),
        "rms_target_dbfs": target_rms_db, "bytes": os.path.getsize(path),
    }
    return y, info


def main():
    alt = "--alt" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREV, exist_ok=True)
    summary = []
    if alt:
        os.makedirs(ALT, exist_ok=True)
        rng = np.random.default_rng(0x48554E54)
        x, desc, comp, marks = build_hunt(rng, bpm=80.0, bars=8)
        path = f"{ALT}/music_hunt_24s_80bpm.ogg"
        y, info = write_and_verify(x, path, "music_hunt_24s_80bpm", 24.0, -10.0, -18.0)
        render_preview(y, f"{ALT}/music_hunt_24s_80bpm.png", "music_hunt_24s_80bpm.ogg (alternative: 80 BPM, 24 s)", marks)
        summary.append({"name": "gs.music.hunt (alternative)", "file": path, **info, "loop": True, "description": desc,
                        "components_dbfs": {k: {"rms": round(to_db(v[0]), 1), "peak": round(to_db(v[1]), 1)} for k, v in comp.items()}})
    else:
        rng = np.random.default_rng(0x5354414C)
        x, desc, comp, marks = build_stalk(rng)
        y, info = write_and_verify(x, f"{OUT}/music_stalk.ogg", "music_stalk", 32.0, -12.0, -24.0)
        render_preview(y, f"{PREV}/music_stalk.png", "music_stalk.ogg", marks)
        summary.append({"name": "gs.music.stalk", "file": "sounds/grinshackle/music_stalk.ogg", **info, "loop": True,
                        "description": desc, "components_dbfs": {k: {"rms": round(to_db(v[0]), 1), "peak": round(to_db(v[1]), 1)} for k, v in comp.items()}})
        rng = np.random.default_rng(0x48554E54)
        x, desc, comp, marks = build_hunt(rng, bpm=96.0, bars=8)
        y, info = write_and_verify(x, f"{OUT}/music_hunt.ogg", "music_hunt", 20.0, -10.0, -18.0)
        render_preview(y, f"{PREV}/music_hunt.png", "music_hunt.ogg", marks)
        summary.append({"name": "gs.music.hunt", "file": "sounds/grinshackle/music_hunt.ogg", **info, "loop": True,
                        "description": desc, "components_dbfs": {k: {"rms": round(to_db(v[0]), 1), "peak": round(to_db(v[1]), 1)} for k, v in comp.items()}})
        with open(f"{ROOT}/assets_work/music_summary.json", "w") as fh:
            json.dump(summary, fh, indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
