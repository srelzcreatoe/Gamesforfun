"""fnar_dsp - the small DSP toolkit behind gen_sounds.py (numpy + scipy).

Everything here is deterministic: random numbers always come from a
numpy Generator seeded from a string key (see `rng`).

Conventions
  * sample rate SR = 44100, float64 internally
  * mono signals are 1-D arrays (n,), stereo signals are (2, n)
  * times are in seconds unless a name says otherwise
  * "circular" processing treats a buffer as one period of a loop, so the
    result can be repeated back to back without a seam
"""
from __future__ import annotations

import functools
import zlib

import numpy as np
from scipy import ndimage as ndi
from scipy import signal as sps

SR = 44100
PI2 = 2.0 * np.pi


# ----------------------------------------------------------------------------
# basics
# ----------------------------------------------------------------------------
def N(sec: float) -> int:
    """seconds -> samples"""
    return max(0, int(round(sec * SR)))


def T(n: int) -> np.ndarray:
    return np.arange(n) / SR


def dbamp(db):
    return 10.0 ** (np.asarray(db, float) / 20.0)


def ampdb(a):
    return 20.0 * np.log10(np.maximum(np.abs(a), 1e-12))


def rng(*key) -> np.random.Generator:
    """Deterministic generator from a readable key, e.g. rng('door.close', 2)."""
    return np.random.default_rng(zlib.crc32('/'.join(str(k) for k in key).encode('utf-8')))


def hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, float) - 69.0) / 12.0)


_NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def midi(name: str) -> int:
    """'C4' -> 60, 'F#5' -> 78, 'Bb3' -> 58"""
    name = name.strip()
    base = _NOTE[name[0].upper()]
    i, acc = 1, 0
    while i < len(name) and name[i] in '#b':
        acc += 1 if name[i] == '#' else -1
        i += 1
    return 12 * (int(name[i:]) + 1) + base + acc


def mono(x):
    return x if x.ndim == 1 else x.mean(axis=0)


def stereo(x):
    return np.stack([x, x]) if x.ndim == 1 else x


def pan(x, p):
    """equal-power pan of a mono signal, p in [-1 (left), 1 (right)]"""
    th = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.stack([np.cos(th) * x, np.sin(th) * x]) * np.sqrt(2)


def place(buf, x, t, gain=1.0, wrap=False, p=None):
    """Mix x into buf starting at time t. wrap=True folds overhang to the head
    (circular placement for loops). A mono x into a stereo buf is centred, or
    panned with p."""
    x = np.asarray(x, float) * gain
    if buf.ndim == 2 and x.ndim == 1:
        x = pan(x, p) * (1 / np.sqrt(2)) if p is not None else np.stack([x, x])
    if buf.ndim == 1 and x.ndim == 2:
        x = x.mean(axis=0)
    L = buf.shape[-1]
    m = x.shape[-1]
    i0 = int(round(t * SR))
    if not wrap:
        a, b = max(i0, 0), min(i0 + m, L)
        if b > a:
            buf[..., a:b] += x[..., a - i0:b - i0]
        return buf
    pos, k = i0 % L, 0
    while k < m:
        c = min(L - pos, m - k)
        buf[..., pos:pos + c] += x[..., k:k + c]
        k += c
        pos = 0
    return buf


def fit(x, n):
    """pad with zeros / cut to n samples"""
    if x.shape[-1] >= n:
        return x[..., :n]
    pad = [(0, 0)] * (x.ndim - 1) + [(0, n - x.shape[-1])]
    return np.pad(x, pad)


# ----------------------------------------------------------------------------
# envelopes and control signals
# ----------------------------------------------------------------------------
def env_pts(n, pts, log=False):
    """piecewise-linear (or log-linear) envelope through (time, value) points"""
    ts = np.array([p[0] for p in pts], float)
    vs = np.array([p[1] for p in pts], float)
    t = T(n)
    if log:
        return np.exp(np.interp(t, ts, np.log(np.maximum(vs, 1e-9))))
    return np.interp(t, ts, vs)


def decay(n, t60, t0=0.0):
    """exponential decay reaching -60 dB after t60 seconds, starting at t0"""
    t = T(n) - t0
    return np.where(t >= 0, 10.0 ** (-3.0 * np.maximum(t, 0) / t60), 0.0)


def ar(n, attack, t60, t0=0.0):
    """raised-cosine attack then exponential decay"""
    t = T(n) - t0
    if attack > 0:
        a = np.clip(t / attack, 0, 1)
        a = 0.5 - 0.5 * np.cos(np.pi * a)
    else:
        a = (t >= 0).astype(float)
    return a * 10.0 ** (-3.0 * np.maximum(t - attack, 0) / t60) * (t >= 0)


def gate(n, t_on, t_off, att=0.005, rel=0.02):
    """0 -> 1 at t_on (raised cosine over att), 1 -> 0 at t_off (over rel)"""
    t = T(n)
    up = np.clip((t - t_on) / max(att, 1e-6), 0, 1)
    dn = np.clip((t - t_off) / max(rel, 1e-6), 0, 1)
    return (0.5 - 0.5 * np.cos(np.pi * up)) * (0.5 + 0.5 * np.cos(np.pi * dn))


def smooth_noise(r, n, rate):
    """slowly varying random control signal, roughly unit RMS, bandwidth ~rate Hz"""
    k = int(np.ceil(n / SR * rate)) + 4
    pts = r.standard_normal(k)
    x = np.arange(n) / SR * rate
    i = np.floor(x).astype(int)
    f = x - i
    p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
    # Catmull-Rom between p1 and p2
    out = 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f ** 2
                 + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)
    return out / 0.85


def periodic_lfo(n, cycles, r=None, harmonics=1):
    """smooth random control signal that is exactly periodic over n samples
    (integer number of cycles) - for loops"""
    t = np.arange(n) / n
    out = np.zeros(n)
    for h in range(1, harmonics + 1):
        ph = r.uniform(0, PI2) if r is not None else 0.0
        out += np.sin(PI2 * cycles * h * t + ph) / h
    return out / np.sqrt(np.sum(1.0 / np.arange(1, harmonics + 1) ** 2) / 2)


def loop_hz(f, n):
    """nearest frequency with an integer number of cycles in n samples"""
    dur = n / SR
    return max(1, round(f * dur)) / dur


# ----------------------------------------------------------------------------
# noise
# ----------------------------------------------------------------------------
def shaped_noise(r, n, shape):
    """FFT-shaped gaussian noise, exactly periodic over n samples.
    shape(freqs_hz) -> magnitude. Normalised to unit RMS."""
    spec = r.standard_normal(n // 2 + 1) + 1j * r.standard_normal(n // 2 + 1)
    f = np.fft.rfftfreq(n, 1 / SR)
    mag = np.zeros_like(f)
    mag[1:] = shape(f[1:])
    x = np.fft.irfft(spec * mag, n)
    s = np.sqrt(np.mean(x ** 2))
    return x / s if s > 0 else x


def white(r, n):
    return r.standard_normal(n)


def pink(r, n):
    return shaped_noise(r, n, lambda f: 1 / np.sqrt(np.maximum(f, 10)))


def brown(r, n):
    return shaped_noise(r, n, lambda f: 1 / np.maximum(f, 15))


def band_noise(r, n, lo, hi, slope=0.0):
    """periodic noise with a smooth band-pass shape and optional dB/oct tilt"""
    def shp(f):
        g = 1 / np.sqrt(1 + (lo / f) ** 4) / np.sqrt(1 + (f / hi) ** 4)
        return g * (f / max(lo, 1)) ** (slope / 6.02)
    return shaped_noise(r, n, shp)


# ----------------------------------------------------------------------------
# filters
# ----------------------------------------------------------------------------
@functools.lru_cache(maxsize=4096)
def _sos(kind, f, order):
    btype = {'lp': 'lowpass', 'hp': 'highpass', 'bp': 'bandpass', 'bs': 'bandstop'}[kind]
    return sps.butter(order, f, btype=btype, fs=SR, output='sos')


def bw(x, kind, f, order=2):
    """Butterworth filter. kind lp/hp (f scalar) or bp/bs (f = (lo, hi))."""
    if isinstance(f, (tuple, list)):
        f = (float(max(f[0], 1.0)), float(min(f[1], SR * 0.49)))
    else:
        f = float(min(max(f, 1.0), SR * 0.49))
    return sps.sosfilt(_sos(kind, f, order), x, axis=-1)


def bq_coef(kind, f, q=0.7071, gain_db=0.0):
    """RBJ cookbook biquad coefficients"""
    f = min(max(f, 5.0), SR * 0.49)
    w = PI2 * f / SR
    c, s = np.cos(w), np.sin(w)
    al = s / (2 * q)
    A = 10 ** (gain_db / 40)
    if kind == 'lp':
        b, a = [(1 - c) / 2, 1 - c, (1 - c) / 2], [1 + al, -2 * c, 1 - al]
    elif kind == 'hp':
        b, a = [(1 + c) / 2, -(1 + c), (1 + c) / 2], [1 + al, -2 * c, 1 - al]
    elif kind == 'bp':
        b, a = [al, 0.0, -al], [1 + al, -2 * c, 1 - al]
    elif kind == 'notch':
        b, a = [1.0, -2 * c, 1.0], [1 + al, -2 * c, 1 - al]
    elif kind == 'peak':
        b, a = [1 + al * A, -2 * c, 1 - al * A], [1 + al / A, -2 * c, 1 - al / A]
    elif kind in ('ls', 'hs'):
        sq = 2 * np.sqrt(A) * al
        if kind == 'ls':
            b = [A * ((A + 1) - (A - 1) * c + sq), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sq)]
            a = [(A + 1) + (A - 1) * c + sq, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sq]
        else:
            b = [A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq)]
            a = [(A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq]
    else:
        raise ValueError(kind)
    b = np.array(b, float) / a[0]
    a = np.array(a, float) / a[0]
    return b, a


def bq(x, kind, f, q=0.7071, gain_db=0.0, n=1):
    b, a = bq_coef(kind, f, q, gain_db)
    for _ in range(n):
        x = sps.lfilter(b, a, x, axis=-1)
    return x


def eq(x, *bands):
    """bands: ('peak', f, q, db) / ('ls', f, q, db) / ('hs', f, q, db) ..."""
    for kind, f, q, g in bands:
        x = bq(x, kind, f, q, g)
    return x


def bq_coef_vec(kind, f, q, gain_db):
    """vectorised RBJ coefficients for arrays of f/q/gain -> b (k,3), a (k,3), a0-normalised"""
    f = np.clip(np.asarray(f, float), 5.0, SR * 0.49)
    w = PI2 * f / SR
    c, s_ = np.cos(w), np.sin(w)
    al = s_ / (2 * np.asarray(q, float))
    A = 10 ** (np.asarray(gain_db, float) / 40)
    one = np.ones_like(f)
    if kind == 'lp':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
        a = [1 + al, -2 * c, 1 - al]
    elif kind == 'hp':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
        a = [1 + al, -2 * c, 1 - al]
    elif kind == 'bp':
        b = [al, 0 * one, -al]
        a = [1 + al, -2 * c, 1 - al]
    elif kind == 'peak':
        b = [1 + al * A, -2 * c, 1 - al * A]
        a = [1 + al / A, -2 * c, 1 - al / A]
    else:
        raise ValueError(kind)
    b = np.stack(b, axis=-1) * one[..., None]
    a = np.stack(a, axis=-1) * one[..., None]
    return b / a[:, :1], a / a[:, :1]


def tvbq(x, kind, f, q=0.7071, gain_db=0.0, block=16):
    """time-varying biquad (lp/hp/bp/peak): f / q / gain may be per-sample
    arrays. Coefficients are updated every `block` samples (16 = 0.36 ms:
    switching artefacts stay below -80 dB); at every update the TDF-II state
    is rebuilt from the last two input/output samples (direct-form-I
    behaviour), so sweeping does not cause transients."""
    x = np.asarray(x, float)
    if x.ndim == 2:
        return np.stack([tvbq(ch, kind, f, q, gain_db, block) for ch in x])
    n = x.shape[-1]
    starts = np.arange(0, n, block)
    centers = np.minimum(starts + block // 2, n - 1)
    fa = np.broadcast_to(np.asarray(f, float), (n,))[centers]
    qa = np.broadcast_to(np.asarray(q, float), (n,))[centers]
    ga = np.broadcast_to(np.asarray(gain_db, float), (n,))[centers]
    B, A = bq_coef_vec(kind, fa, qa, ga)
    y = np.empty_like(x)
    x1 = x2 = y1 = y2 = 0.0
    lf = sps.lfilter
    for k, i in enumerate(starts):
        j = min(n, i + block)
        b = B[k]
        a = A[k]
        zi = np.array([b[1] * x1 - a[1] * y1 + b[2] * x2 - a[2] * y2, b[2] * x1 - a[2] * y1])
        yy, _ = lf(b, a, x[i:j], zi=zi)
        y[i:j] = yy
        if j - i >= 2:
            x1, x2, y1, y2 = x[j - 1], x[j - 2], yy[-1], yy[-2]
        else:
            x1, x2, y1, y2 = x[j - 1], x1, yy[-1], y1
    return y


def op_lp(x, fc):
    a = np.exp(-PI2 * fc / SR)
    return sps.lfilter([1 - a], [1, -a], x, axis=-1)


def op_hp(x, fc):
    return x - op_lp(x, fc)


def circ(fn, x, *args, **kw):
    """Run a causal process over two periods of a loop and keep the second,
    so the result is seamless when the loop repeats."""
    n = x.shape[-1]
    y = fn(np.concatenate([x, x], axis=-1), *args, **kw)
    return y[..., n:2 * n]


def dc_block(x, fc=18.0, circular=False):
    f = (lambda v: bw(v, 'hp', fc, 2))
    return circ(f, x) if circular else f(x)


# ----------------------------------------------------------------------------
# oscillators
# ----------------------------------------------------------------------------
def _arr(v, n):
    return np.broadcast_to(np.asarray(v, float), (n,))


def phase(freq, n, ph=0.0):
    """running phase in cycles for a (possibly time-varying) frequency"""
    f = _arr(freq, n)
    return np.concatenate([[0.0], np.cumsum(f[:-1])]) / SR + ph


def sine(freq, n, ph=0.0):
    return np.sin(PI2 * phase(freq, n, ph))


def _blep(p, dt):
    out = np.zeros_like(p)
    m = p < dt
    x = p[m] / dt[m]
    out[m] = x + x - x * x - 1
    m = p > 1 - dt
    x = (p[m] - 1) / dt[m]
    out[m] = x * x + x + x + 1
    return out


def _decimate(x, os, n):
    return sps.resample_poly(x, 1, os, window=('kaiser', 9.0))[:n]


def saw(freq, n, ph=0.0, os=1):
    """band-limited (polyBLEP) sawtooth, -1..1. os>1 renders at os x the rate
    and decimates, which removes the residual polyBLEP aliasing (use it for
    gliding pitches, where aliases would otherwise sweep audibly)."""
    if os > 1:
        return _decimate(saw(np.repeat(_arr(freq, n), os) / os, n * os, ph), os, n)
    f = _arr(freq, n)
    p = phase(f, n, ph) % 1.0
    dt = np.minimum(np.abs(f) / SR, 0.5)
    return 2 * p - 1 - _blep(p, dt)


def pulse(freq, n, width=0.5, ph=0.0, os=1):
    """band-limited pulse wave, zero mean, about -1..1 for width 0.5"""
    if os > 1:
        return _decimate(pulse(np.repeat(_arr(freq, n), os) / os, n * os, np.repeat(_arr(width, n), os), ph),
                         os, n)
    f = _arr(freq, n)
    w = _arr(width, n)
    p = phase(f, n, ph) % 1.0
    dt = np.minimum(np.abs(f) / SR, 0.5)
    s1 = 2 * p - 1 - _blep(p, dt)
    p2 = (p + 1 - w) % 1.0
    s2 = 2 * p2 - 1 - _blep(p2, dt)
    # -2(1-w) for the first w of the cycle, +2w after: zero mean
    return s1 - s2


def tri(freq, n, ph=0.0):
    p = phase(freq, n, ph) % 1.0
    return 4 * np.abs(p - 0.5) - 1


def additive(freq, n, amps, ph=None, inharm=0.0):
    """harmonic additive tone; amps[k] is the level of harmonic k+1.
    Partials above 0.45*SR are skipped. inharm stretches partials (stiff strings)."""
    f = _arr(freq, n)
    p = phase(f, n)
    fmax = float(np.max(f))
    out = np.zeros(n)
    for k, a in enumerate(amps, 1):
        if a == 0:
            continue
        stretch = k * np.sqrt(1 + inharm * k * k)
        if stretch * fmax > SR * 0.45:
            break
        out += a * np.sin(PI2 * stretch * p + (ph[k - 1] if ph is not None else 0.0))
    return out


def fm(fc, ratio, index, n, ph=0.0):
    """2-operator FM (phase modulation): sin(2pi fc t + I sin(2pi fc*ratio t))"""
    fcv = _arr(fc, n)
    pc = phase(fcv, n, ph)
    pm = phase(fcv * ratio, n)
    return np.sin(PI2 * pc + _arr(index, n) * np.sin(PI2 * pm))


# ----------------------------------------------------------------------------
# physical-ish building blocks
# ----------------------------------------------------------------------------
def resonators(exc, modes):
    """bank of 2-pole resonators; modes = [(freq, t60, amp), ...]"""
    out = np.zeros_like(exc, dtype=float)
    for f, t60, a in modes:
        if f <= 10 or f >= SR * 0.47 or a == 0:
            continue
        r = 10.0 ** (-3.0 / (max(t60, 1e-3) * SR))
        w = PI2 * f / SR
        out += a * sps.lfilter([np.sin(w)], [1.0, -2 * r * np.cos(w), r * r], exc, axis=-1)
    return out


def plate_modes(r, f_lo, f_hi, count, t60_lo, t60_hi, tilt_db=-3.0, low=None):
    """Inharmonic mode set roughly like a steel plate (uniform modal density).
    low = list of extra (freq, t60, amp) body modes."""
    fs = np.sort(r.uniform(f_lo, f_hi, count))
    k = np.log(t60_hi / t60_lo) / np.log(f_hi / f_lo)
    t60 = t60_lo * (fs / f_lo) ** k * r.uniform(0.75, 1.3, count)
    amps = r.rayleigh(1.0, count) * (fs / f_lo) ** (tilt_db / 6.02)
    modes = list(zip(fs, t60, amps))
    if low:
        modes += list(low)
    return modes


def strike(n, t0, contact=0.001, amp=1.0):
    """half-sine contact pulse (a 'hit') at t0; longer contact = softer/duller"""
    out = np.zeros(n)
    m = max(2, N(contact))
    i0 = N(t0)
    p = np.sin(np.pi * (np.arange(m) + 0.5) / m) * amp
    a, b = i0, min(n, i0 + m)
    if b > a:
        out[a:b] += p[:b - a]
    return out


def impulses(n, times, amps, contact=0.0004):
    out = np.zeros(n)
    for t, a in zip(times, amps):
        out += strike(n, t, contact, a)
    return out


def click_train(r, n, rate, jitter=0.25, amp_jitter=0.5, t0=0.0, t1=None):
    """irregular impulse train (stick-slip, rattles, gears). rate may be an array."""
    rate = _arr(rate, n) * (1 + jitter * np.clip(smooth_noise(r, n, 30), -2, 2))
    ph = np.cumsum(np.maximum(rate, 0)) / SR
    idx = np.nonzero(np.diff(np.floor(ph)) > 0)[0] + 1
    t = T(n)
    t1 = t[-1] if t1 is None else t1
    idx = idx[(t[idx] >= t0) & (t[idx] <= t1)]
    out = np.zeros(n)
    out[idx] = 1 + amp_jitter * (r.uniform(-1, 1, len(idx)))
    return out


def ks_string(f, dur, r, t60=4.0, bright=0.3, pick=0.18, exc_lp=6000.0, amp=1.0):
    """Karplus-Strong plucked string with a fractional-delay loop.
    bright 0..0.5 is the loop low-pass tap (0.5 = classic averaging, darker)."""
    n = N(dur)
    D = SR / f
    s = float(np.clip(0.5 - bright, 0.05, 0.5))
    Nd = int(np.floor(D - s))
    p = D - s - Nd
    g = 10.0 ** (-3.0 / (t60 * f))
    a = np.zeros(Nd + 3)
    a[0] = 1.0
    a[Nd] -= g * (1 - s) * (1 - p)
    a[Nd + 1] -= g * ((1 - s) * p + s * (1 - p))
    a[Nd + 2] -= g * s * p
    L = Nd
    exc = r.uniform(-1, 1, L)
    exc = op_lp(exc, exc_lp)
    k = max(1, int(round(pick * L)))
    exc = exc - np.concatenate([np.zeros(k), exc[:-k]])
    exc -= exc.mean()
    x = np.zeros(n)
    x[:min(L, n)] = exc[:min(L, n)]
    y = sps.lfilter([1.0], a, x)
    return y * amp


def servo(r, n, speed, base=380.0, span=520.0, ratio=0.5, index=1.6, gear=0.35, grit=0.25):
    """electric servo / gear-motor whine. speed: 0..1 array (motion profile)."""
    sp = np.clip(_arr(speed, n), 0, None)
    jit = 1 + 0.012 * smooth_noise(r, n, 25)
    f = (base + span * sp) * jit
    w = fm(f, ratio, index * (0.6 + 0.4 * sp), n) * 0.6
    w += 0.35 * fm(f * 2.0, 0.5, index * 0.7, n, r.uniform())
    w += 0.18 * np.sin(PI2 * phase(f * 3.01, n))
    teeth = click_train(r, n, f / 7.0, jitter=0.15, amp_jitter=0.6)
    g = bw(r.standard_normal(n), 'bp', (1800, 7000)) * bw(teeth, 'lp', 900) * 6
    g += bw(teeth, 'bp', (2500, 9000)) * 0.6
    body = w + gear * g + grit * bw(r.standard_normal(n), 'bp', (600, 3000)) * 0.3
    return body * (sp ** 0.7)


# ----------------------------------------------------------------------------
# voice / formants
# ----------------------------------------------------------------------------
VOWELS = {  # (F1..F4) adult male-ish, bandwidths
    'a': ((730, 1090, 2440, 3400), (90, 110, 170, 250)),
    'ae': ((660, 1720, 2410, 3400), (90, 110, 170, 250)),
    'e': ((530, 1840, 2480, 3500), (60, 100, 150, 250)),
    'i': ((280, 2250, 3010, 3600), (60, 100, 150, 250)),
    'o': ((570, 840, 2410, 3400), (70, 90, 150, 250)),
    'u': ((310, 870, 2240, 3300), (60, 90, 150, 250)),
    'uh': ((640, 1190, 2390, 3400), (80, 100, 150, 250)),
    'er': ((490, 1350, 1690, 3300), (70, 100, 120, 250)),
    'm': ((260, 1050, 2300, 3300), (60, 250, 300, 350)),
    'n': ((280, 1600, 2600, 3400), (60, 250, 300, 350)),
}


def vowel_track(n, keys, fscale=1.0, jitter=0.0, r=None):
    """keys = [(t, vowel), ...] -> F (4,n), BW (4,n); log-interpolated"""
    ts = np.array([k[0] for k in keys], float)
    F = np.zeros((4, n))
    B = np.zeros((4, n))
    t = T(n)
    for i in range(4):
        fv = np.log([VOWELS[k[1]][0][i] for k in keys])
        bv = np.log([VOWELS[k[1]][1][i] for k in keys])
        F[i] = np.exp(np.interp(t, ts, fv)) * fscale
        B[i] = np.exp(np.interp(t, ts, bv)) * np.sqrt(fscale)
        if jitter and r is not None:
            F[i] *= 1 + jitter * smooth_noise(r, n, 6)
    return F, B


def formants(src, F, B, gains_db=(0, -5, -11, -17), block=16):
    out = np.zeros_like(src)
    for i in range(F.shape[0]):
        out += dbamp(gains_db[i]) * tvbq(src, 'bp', F[i], F[i] / B[i], block=block)
    return out


def voice_src(r, f0, n, jitter=0.008, shimmer=0.05, breath=0.06, tilt=None, sub=0.0):
    """voiced source: band-limited saw (glottal-ish -6 dB/oct) + aspiration"""
    f = _arr(f0, n) * (1 + jitter * smooth_noise(r, n, 35))
    s = saw(f, n, os=4)
    if sub:
        s = s + sub * saw(f * 0.5, n, 0.25, os=4)
    if tilt:
        s = op_lp(s, tilt)
    s = s * (1 + shimmer * smooth_noise(r, n, 50))
    ph = phase(f, n) % 1.0
    asp = bw(r.standard_normal(n), 'hp', 900) * (0.55 + 0.45 * np.cos(PI2 * ph))
    return s + breath * asp


# ----------------------------------------------------------------------------
# space
# ----------------------------------------------------------------------------
_IRS = {}


def room_ir(name, rt60, length=None, stereo=False, predelay=0.006, n_early=12, early_span=0.045,
            lf=1.3, hf=0.45, flutter=None, metallic=None):
    """Synthetic room impulse response: early reflections + band-wise
    exponentially decaying noise tail (low bands ring longer than highs).
    Normalised to unit energy. Cached by name."""
    key = (name, rt60, length, stereo)
    if key in _IRS:
        return _IRS[key]
    r = rng('ir', name)
    L = N(length if length else min(4.5, rt60 * 1.15))
    t = T(L)
    chans = []
    for c in range(2 if stereo else 1):
        tail = np.zeros(L)
        for lo, hi, ratio in ((30, 280, lf), (280, 1100, 1.0), (1100, 4200, (1 + hf) / 2), (4200, 16000, hf)):
            tail += bw(r.standard_normal(L), 'bp', (lo, hi), 2) * 10 ** (-3 * t / (rt60 * ratio))
        build = np.clip((t - predelay) / 0.02, 0, 1) ** 1.5
        tail *= build
        er = np.zeros(L)
        for k in range(n_early):
            d = predelay + early_span * (r.uniform() ** 1.4)
            g = r.uniform(0.35, 1.0) * (1 - 0.6 * (d - predelay) / early_span) * r.choice([-1, 1])
            i = N(d)
            if i < L:
                er[i] += g
        if flutter:
            per, g0, cnt = flutter
            for k in range(1, cnt + 1):
                i = N(predelay + per * k + r.uniform(-0.0003, 0.0003))
                if i < L:
                    er[i] += (g0 ** k) * (1 if k % 2 else -1)
        er = bw(er, 'lp', 7000, 1)
        if metallic:
            # tube/duct: dense combs with metallic colouration
            for per, g0 in metallic:
                comb = np.zeros(L)
                k = 1
                while N(per * k) < L and g0 ** k > 1e-3:
                    comb[N(per * k)] += g0 ** k
                    k += 1
                er += bw(comb, 'bp', (300, 6000), 1) * 0.6
        tail /= np.sqrt(np.sum(tail ** 2)) + 1e-12
        er /= np.sqrt(np.sum(er ** 2)) + 1e-12
        h = 0.55 * er + tail
        h = bw(h, 'hp', 40, 1)
        h /= np.sqrt(np.sum(h ** 2))
        chans.append(h)
    out = np.stack(chans) if stereo else chans[0]
    _IRS[key] = out
    return out


def _conv(x, h, circular):
    n = x.shape[-1]
    if not circular:
        return sps.fftconvolve(x, h)[:n]
    hf = np.zeros(n)
    for i in range(0, h.shape[-1], n):
        seg = h[i:i + n]
        hf[:len(seg)] += seg
    return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(hf), n)


def reverb(x, ir, wet=0.25, dry=1.0, circular=False, pre_hp=None):
    """convolve with a synthetic IR. mono x + stereo ir -> stereo out."""
    src = bw(x, 'hp', pre_hp, 1) if pre_hp else x
    if ir.ndim == 2 and x.ndim == 1:
        w = np.stack([_conv(src, ir[0], circular), _conv(src, ir[1], circular)])
        return dry * np.stack([x, x]) + wet * w
    if x.ndim == 2:
        h0 = ir[0] if ir.ndim == 2 else ir
        h1 = ir[1] if ir.ndim == 2 else ir
        w = np.stack([_conv(src[0], h0, circular), _conv(src[1], h1, circular)])
        return dry * x + wet * w
    return dry * x + wet * _conv(src, ir, circular)


# ----------------------------------------------------------------------------
# non-linear / tape / time
# ----------------------------------------------------------------------------
def sat(x, drive=1.0, bias=0.0):
    """tanh saturation, unity small-signal gain-ish, bias for even harmonics"""
    return (np.tanh(drive * x + bias) - np.tanh(bias)) / max(np.tanh(drive), 1e-9) if drive > 0 else x


def oversampled(fn, x, k=4):
    up = sps.resample_poly(x, k, 1, axis=-1)
    y = fn(up)
    return sps.resample_poly(y, 1, k, axis=-1)[..., :x.shape[-1]]


def hardclip(x, t):
    return np.clip(x, -t, t)


def bitcrush(x, bits=6, hold=4):
    n = x.shape[-1]
    held = np.repeat(x[..., ::hold], hold, axis=-1)[..., :n]
    q = 2 ** (bits - 1)
    return np.round(held * q) / q


def interp_read(x, pos, circular=False):
    """4-point cubic (Catmull-Rom) read of x at fractional sample positions"""
    n = x.shape[-1]
    i = np.floor(pos).astype(np.int64)
    f = pos - i
    if circular:
        idx = [(i + k) % n for k in (-1, 0, 1, 2)]
    else:
        idx = [np.clip(i + k, 0, n - 1) for k in (-1, 0, 1, 2)]
    xm1, x0, x1, x2 = (x[..., j] for j in idx)
    c1 = 0.5 * (x1 - xm1)
    c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    y = ((c3 * f + c2) * f + c1) * f + x0
    if not circular:
        y = y * ((pos >= 0) & (pos <= n - 1))
    return y


def wow_flutter(x, r, wow=0.0025, wow_hz=0.55, flutter=0.0007, flutter_hz=8.3, drift=0.0, circular=False):
    """tape speed instability: wow/flutter as pitch-ratio deviations"""
    n = x.shape[-1]
    t = np.arange(n) / SR
    if circular:
        wow_hz, flutter_hz = loop_hz(wow_hz, n), loop_hz(flutter_hz, n)
        f3 = loop_hz(wow_hz * 2.37, n)
        f4 = loop_hz(flutter_hz * 1.61, n)
    else:
        f3, f4 = wow_hz * 2.37, flutter_hz * 1.61
    dev = (wow * (0.75 * np.sin(PI2 * wow_hz * t + r.uniform(0, PI2)) + 0.35 * np.sin(PI2 * f3 * t + r.uniform(0, PI2)))
           + flutter * (0.8 * np.sin(PI2 * flutter_hz * t + r.uniform(0, PI2)) + 0.4 * np.sin(PI2 * f4 * t + r.uniform(0, PI2))))
    if drift and not circular:
        dev = dev + drift * smooth_noise(r, n, 0.7)
    dev -= dev.mean()
    D = np.cumsum(dev)
    if circular:
        D -= D.mean()
        return interp_read(x, np.arange(n) + D, circular=True)
    D -= D.max() + 2
    return interp_read(x, np.arange(n) + D, circular=False)


def varispeed(x, speed, circular=False, start=0.0):
    """read x with a per-output-sample speed curve (tape slow-down, rewind...)"""
    pos = start + np.concatenate([[0.0], np.cumsum(speed[:-1])])
    return interp_read(x, pos, circular=circular)


# ----------------------------------------------------------------------------
# dynamics / finishing
# ----------------------------------------------------------------------------
def limiter(x, ceiling_db=-1.5, look=0.0015, release=0.06, circular=False):
    """look-ahead brick-wall peak limiter (linked stereo). Gain never lets a
    sample exceed the ceiling: min-filter over 2h, box average over h."""
    if circular:
        n = x.shape[-1]
        y = limiter(np.concatenate([x, x, x], axis=-1), ceiling_db, look, release)
        return y[..., n:2 * n]
    a = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), axis=0)
    c = float(dbamp(ceiling_db))
    g = np.minimum(1.0, c / np.maximum(a, 1e-12))
    h = max(1, N(look) // 2)
    g = ndi.minimum_filter1d(g, 4 * h + 1, mode='nearest')
    g = ndi.uniform_filter1d(g, 2 * h + 1, mode='nearest')
    if release:
        k = np.exp(-1.0 / (release * SR))
        gr = sps.lfilter([1 - k], [1, -k], g, zi=[k * g[0]])[0]
        g = np.minimum(g, gr)
    return np.clip(x * g, -c, c)


def comp(x, thresh_db=-18.0, ratio=4.0, att=0.004, rel=0.12, makeup_db=0.0):
    """simple feed-forward RMS-ish compressor (linked)"""
    a = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), axis=0)
    ka = np.exp(-1 / (att * SR))
    kr = np.exp(-1 / (rel * SR))
    # attack/release follower via two one-poles and max (fast enough, vectorised)
    fa = sps.lfilter([1 - ka], [1, -ka], a)
    fr = sps.lfilter([1 - kr], [1, -kr], a)
    env = np.maximum(fa, fr)
    lvl = ampdb(env)
    over = np.maximum(lvl - thresh_db, 0)
    gdb = -over * (1 - 1 / ratio) + makeup_db
    return x * dbamp(gdb)


def fade_edges(x, fin=0.005, fout=0.02):
    x = x.copy()
    n = x.shape[-1]
    a, b = N(fin), N(fout)
    if a:
        x[..., :a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if b:
        x[..., n - b:] *= 0.5 + 0.5 * np.cos(np.pi * (np.arange(b) + 1) / b)
    return x


def norm_peak(x, db=-1.0):
    p = np.max(np.abs(x))
    return x * (dbamp(db) / p) if p > 0 else x


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))))


def norm_rms(x, db=-20.0):
    v = rms(x)
    return x * (dbamp(db) / v) if v > 0 else x


# ----------------------------------------------------------------------------
# music helpers
# ----------------------------------------------------------------------------
def parse_line(s, beats_per_bar=None, start=0.0):
    """'E5/1 A5/1 C6/1 | B5/2 A5/1' -> [(beat, beats, midi|None), ...], end_beat.
    '|' separates bars and is checked against beats_per_bar."""
    out, b = [], start
    for bar_i, bar in enumerate(s.split('|')):
        acc = 0.0
        for tok in bar.split():
            name, d = tok.split('/')
            d = float(d)
            out.append((b, d, None if name == 'r' else midi(name)))
            b += d
            acc += d
        if beats_per_bar and bar.strip() and abs(acc - beats_per_bar) > 1e-6:
            raise ValueError(f'bar {bar_i + 1} has {acc} beats: {bar!r}')
    return out, b


CHORDS = {'': (0, 4, 7), 'm': (0, 3, 7), '7': (0, 4, 7, 10), 'm7': (0, 3, 7, 10),
          'dim': (0, 3, 6), 'maj7': (0, 4, 7, 11), 'sus4': (0, 5, 7), 'aug': (0, 4, 8),
          'dim7': (0, 3, 6, 9), 'm6': (0, 3, 7, 9), 'add9': (0, 4, 7, 14)}


def chord(name, octave=3):
    """'F#m7' -> (root midi in octave, intervals)"""
    root = name[0]
    i = 1
    if len(name) > 1 and name[1] in '#b':
        root += name[1]
        i = 2
    return midi(f'{root}{octave}'), CHORDS[name[i:]]


def voicing(name, low=55, high=67):
    """close-position chord tones of `name` inside [low, high] (midi)"""
    rt, iv = chord(name, 0)
    pcs = {(rt + k) % 12 for k in iv}
    return [m for m in range(low, high + 1) if m % 12 in pcs]
