"""dread.py: the Brinesleeper's sound, built only from noise, drones, bowed metal, breath and throats.

Rules this file keeps (what made the old sounds feel light instead of frightening):
  * no melodies, no scales, no music box, no tuned bells: only clusters a semitone apart, tritones, and slow glides
  * no cartoon drips or bubble "bloops": water is noise, low gurgles and real recordings
  * no steady beat in the calm music; the chase runs in an uneven 7/8
  * the dread lives where phone and tablet speakers can play it (150 Hz to 4 kHz), not only in the sub-bass
  * long, dark cave reverb; music in stereo (voices and metal on both sides of you), sound effects in mono
Only numpy is needed. Every sound is generated from a fixed seed, so the packs rebuild identically.
"""
import numpy as np

SR = 32000


# =================================================================== spectra and filters
def _nfft(n):
    return 1 << max(1, (n - 1).bit_length())


def shape(x, resp, sr=SR):
    """static filter: multiply the spectrum by resp(freqs)"""
    n = len(x)
    N = _nfft(n)
    X = np.fft.rfft(x, N)
    f = np.fft.rfftfreq(N, 1 / sr)
    return np.fft.irfft(X * resp(f), N)[:n]


def lowpass(x, fc, order=4, sr=SR):
    return shape(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)), sr)


def highpass(x, fc, order=4, sr=SR):
    return shape(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * order)), sr)


def bandpass(x, lo, hi, order=4, sr=SR):
    return shape(x, lambda f: 1 / np.sqrt((1 + (f / hi) ** (2 * order)) * (1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))), sr)


def peaks(f, centers, widths, gains):
    """a sum of resonances on a log-frequency axis (widths in octaves)"""
    lf = np.log2(np.maximum(f, 1.0))
    g = np.zeros_like(f)
    for c, w, a in zip(centers, widths, gains):
        g += a * np.exp(-0.5 * ((lf - np.log2(c)) / w) ** 2)
    return g


def stft_filter(x, gain_fn, sr=SR, win=2048, hop=512):
    """time-varying filter: gain_fn(frame_times[:, None], freqs[None, :]) -> gains, applied by overlap-add"""
    n = len(x)
    w = np.hanning(win)
    pad = np.concatenate([np.zeros(win), x, np.zeros(win + hop)])
    starts = np.arange(0, len(pad) - win, hop)
    view = np.lib.stride_tricks.sliding_window_view(pad, win)
    f = np.fft.rfftfreq(win, 1 / sr)
    out = np.zeros(len(pad))
    norm = np.zeros(len(pad))
    for c in range(0, len(starts), 800):
        st = starts[c:c + 800]
        t = (st - win + win / 2) / sr
        Y = np.fft.rfft(view[st] * w, axis=1) * gain_fn(t[:, None], f[None, :])
        y = np.fft.irfft(Y, win, axis=1) * w
        for i, s in enumerate(st):
            out[s:s + win] += y[i]
            norm[s:s + win] += w * w
    return (out / np.maximum(norm, 1e-6))[win:win + n]


# =================================================================== sources
def white(n, rng):
    return rng.normal(0, 1, n)


def pink(n, rng):
    return shape(rng.normal(0, 1, n), lambda f: 1 / np.sqrt(np.maximum(f, 20.0)))


def brown(n, rng):
    return shape(rng.normal(0, 1, n), lambda f: 1 / np.maximum(f, 15.0))


def smooth_noise(n, rng, rate, sr=SR):
    """a slowly wandering control signal in [-1, 1] that changes about `rate` times a second (cosine-eased)"""
    k = max(3, int(n / sr * rate) + 3)
    pts = rng.uniform(-1, 1, k)
    pos = np.arange(n) * (k - 1) / max(1, n - 1)
    i = np.minimum(np.floor(pos).astype(int), k - 2)
    w = (1 - np.cos(np.pi * (pos - i))) / 2
    return pts[i] * (1 - w) + pts[i + 1] * w


def env(n, a, r, sr=SR):
    t = np.arange(n) / sr
    return np.clip(np.minimum(t / max(a, 1e-4), (n / sr - t) / max(r, 1e-4)), 0, 1)


def place(buf, x, at, sr=SR, gain=1.0):
    s = int(at * sr)
    if s >= len(buf) or s + len(x) <= 0:
        return
    a, b = max(0, -s), min(len(x), len(buf) - s)
    buf[s + a:s + b] += gain * x[a:b]


def saw(freq, n, sr=SR, max_h=40, phase=0.0, cap=None):
    """a band-limited saw with a per-sample frequency (array) or a fixed one; `cap` (Hz) drops harmonics above it"""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    ph = 2 * np.pi * np.cumsum(f) / sr + phase
    top = float(np.max(f)) or 1.0
    K = int(min(max_h, (sr / 2) / top, (cap / top) if cap else 1e9))
    out = np.zeros(n)
    for k in range(1, max(1, K) + 1):
        out += np.sin(k * ph) / k
    return out


def sine(freq, n, sr=SR, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    return np.sin(2 * np.pi * np.cumsum(f) / sr + phase)


# =================================================================== the cave: reverb with dark, long, uneven tails
def cave_ir(seconds, seed, bright=2600.0, sr=SR):
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    T = seconds / 6.9                                      # -60 dB at `seconds`
    nz = rng.normal(0, 1, n)
    ir = lowpass(nz, 450, 2, sr) * np.exp(-t / T) + 0.8 * bandpass(nz, 450, 2200, 2, sr) * np.exp(-t / (T * 0.7)) \
        + 0.35 * highpass(nz, 2200, 2, sr) * np.exp(-t / (T * 0.35))
    ir = lowpass(ir, bright, 2, sr)
    pre = int(0.021 * sr)
    ir = np.concatenate([np.zeros(pre), ir])[:n]
    peak = np.max(np.abs(ir))
    for d, g in ((0.047, 0.55), (0.083, 0.4), (0.131, 0.3), (0.199, 0.22)):   # rock walls, near and far
        i = int(d * sr) + int(rng.integers(0, 60))
        if i < n:
            ir[i] += g * peak * rng.choice([-1, 1])
    return ir / (np.sqrt(np.sum(ir ** 2)) + 1e-12)


def conv(x, ir):
    n = len(x) + len(ir) - 1
    N = _nfft(n)
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:n]


def verb(x, seconds=3.2, seed=1, wet=0.5, bright=2600.0, sr=SR):
    """the dry sound followed by its cave; the output is longer than the input by the tail"""
    y = conv(x, cave_ir(seconds, seed, bright, sr))
    dry = np.concatenate([x, np.zeros(len(y) - len(x))])
    ry, rd = np.sqrt(np.mean(y ** 2)) + 1e-12, np.sqrt(np.mean(dry ** 2)) + 1e-12
    return (1 - wet) * dry + wet * y * (rd / ry)


def verb_st(x, seconds=3.2, seed=1, wet=0.5, bright=2600.0, pan=0.0, sr=SR):
    """stereo: the same dry sound placed at `pan` (-1 left .. 1 right), with a different cave tail on each side"""
    L = verb(x, seconds, seed, wet, bright, sr)
    R = verb(x, seconds, seed + 7919, wet, bright, sr)
    gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([L * gl * np.sqrt(2), R * gr * np.sqrt(2)])


# =================================================================== instruments of dread
def drone(root, dur, rng, glide=-1.0, sr=SR):
    """a low unresolved cluster: root, octave, a semitone above the octave (it beats against it), a tritone;
    rich enough in harmonics to be heard on small speakers; it opens and closes like breath and slowly sinks"""
    n = int(dur * sr)
    t = np.arange(n) / sr
    sink = 2 ** (glide * t / dur / 12)
    out = np.zeros(n)
    for mult, amp in ((1.0, 1.0), (2.0, 0.7), (2.0 * 2 ** (1 / 12), 0.55), (2 ** (6 / 12) * 2, 0.3), (3.0 * 2 ** (1 / 12), 0.25)):
        for det in (-0.0035, 0.0, 0.0042):
            wob = 1 + 0.002 * smooth_noise(n, rng, 0.3, sr)
            out += amp * saw(root * mult * (1 + det) * sink * wob, n, sr, max_h=30, phase=rng.uniform(0, 6), cap=1600)
    cut = 260 + 380 * (0.5 + 0.5 * smooth_noise(n, rng, 0.08, sr))
    cut_f = np.interp(np.linspace(0, n, 1 + n // 512), np.arange(n), cut)
    frame_cut = lambda tt: np.interp(np.clip(tt * sr / 512, 0, len(cut_f) - 1), np.arange(len(cut_f)), cut_f)
    out = stft_filter(out, lambda tt, f: 1 / np.sqrt(1 + (f / frame_cut(tt)) ** 6), sr)
    return out * (0.25 + 0.75 * (0.5 + 0.5 * smooth_noise(n, rng, 0.06, sr)) ** 1.5)       # it recedes, then returns


def pressure(dur, rng, sr=SR):
    """felt more than heard: a sub tone that swells"""
    n = int(dur * sr)
    return sine(rng.uniform(27, 33), n, sr) * (0.5 + 0.5 * smooth_noise(n, rng, 0.06, sr)) ** 2


def cave_air(dur, rng, howl=1.0, sr=SR):
    """air pushed through tunnels: noise through wandering resonances, in gusts; with `howl` the resonances narrow"""
    n = int(dur * sr)
    x = pink(n, rng)
    k = max(4, int(dur * 0.4) + 3)
    tracks = [np.interp(np.linspace(0, dur, n // 512 + 2), np.linspace(0, dur, k), rng.uniform(np.log2(lo), np.log2(hi), k))
              for lo, hi in ((160, 420), (380, 950), (900, 2200))]
    tt_f = np.linspace(0, dur, n // 512 + 2)
    width = 0.32 / max(howl, 0.3)

    def gain(tt, f):
        c = [2 ** np.interp(tt, tt_f, tr) for tr in tracks]
        return 0.08 + peaks_t(f, c, [width, width * 0.9, width * 0.8], [1.0, 0.7, 0.35])
    y = stft_filter(x, gain, sr)
    gust = (0.55 + 0.45 * smooth_noise(n, rng, 0.12, sr)) ** 2
    return y * gust


def peaks_t(f, centers, widths, gains):
    lf = np.log2(np.maximum(f, 1.0))
    g = 0.0
    for c, w, a in zip(centers, widths, gains):
        g = g + a * np.exp(-0.5 * ((lf - np.log2(c)) / w) ** 2)
    return g


def waterphone(f0, dur, rng, bend=4.0, sr=SR):
    """bowed metal over water: inharmonic partials gliding together, the iconic singing screech of the deep"""
    n = int(dur * sr)
    t = np.arange(n) / sr
    glide = bend * smooth_noise(n, rng, 0.25, sr) + 0.15 * np.sin(2 * np.pi * rng.uniform(4.5, 6.5) * t)
    base = f0 * 2 ** (glide / 12)
    out = np.zeros(n)
    for ratio, amp in ((1.0, 1.0), (2.32, 0.55), (3.98, 0.4), (5.79, 0.25), (8.12, 0.14)):
        for det in (-0.004, 0.003):
            fr = base * ratio * (1 + det)
            if np.max(fr) > sr / 2 - 500:
                continue
            bow = 0.6 + 0.4 * smooth_noise(n, rng, rng.uniform(1.5, 4.0), sr)
            out += amp * bow * sine(fr, n, sr, rng.uniform(0, 6))
    grit = bandpass(white(n, rng), f0 * 0.8, f0 * 6, 2, sr) * 0.05
    out = np.tanh(1.4 * (out + grit))
    return out * env(n, dur * rng.uniform(0.2, 0.35), dur * rng.uniform(0.3, 0.45), sr)


def metal_groan(dur, rng, sr=SR):
    """a huge sheet of metal or rock bending somewhere far below: low inharmonic partials, slowly bending down"""
    f0 = rng.uniform(55, 95)
    return lowpass(waterphone(f0, dur, rng, bend=2.5, sr=sr), 1400, 2, sr)


def bowed_cymbal(dur, rng, sr=SR):
    """a thin, high, unbearable shimmer; used quietly"""
    n = int(dur * sr)
    out = np.zeros(n)
    for _ in range(18):
        fr = rng.uniform(900, 5200)
        out += sine(fr * (1 + 0.003 * smooth_noise(n, rng, 0.5, sr)), n, sr, rng.uniform(0, 6)) * \
            (0.5 + 0.5 * smooth_noise(n, rng, rng.uniform(0.5, 3), sr)) / np.sqrt(fr / 900)
    return out * env(n, dur * 0.45, dur * 0.4, sr)


def glottal(dur, f_curve, rng, jitter=0.08, sub=0.5, sr=SR):
    """a throat: a jittery pulse train (vocal fry when slow), with period-doubling for an inhuman roughness"""
    n = int(dur * sr)
    out = np.zeros(n)
    tpos, k = 0.0, 0
    pulse_len = int(0.012 * sr)
    pt = np.arange(pulse_len) / sr
    pulse = np.exp(-pt / 0.0022) * np.sin(2 * np.pi * 180 * pt + 0.3)
    while tpos < dur:
        i = int(tpos * sr)
        f = max(8.0, float(f_curve(tpos)))
        amp = 1.0 if (k % 2 == 0 or rng.random() > sub) else rng.uniform(0.3, 0.7)
        e = min(n, i + pulse_len)
        out[i:e] += amp * pulse[:e - i] * rng.uniform(0.75, 1.0)
        tpos += (1.0 / f) * (1 + rng.uniform(-jitter, jitter))
        k += 1
    return out


def voice(dur, f_curve, formants, rng, breath=0.35, jitter=0.08, sub=0.5, sr=SR):
    """pulse + breath through moving vowel formants. formants(t) -> ([centers], [widths], [gains])"""
    n = int(dur * sr)
    src = glottal(dur, f_curve, rng, jitter, sub, sr) + breath * white(n, rng) * 0.08
    step = 0.25
    w = int(step * sr)
    pieces = max(1, int(np.ceil(n / w)))
    y = np.zeros(n)
    for p in range(pieces):
        a, b = max(0, p * w - w // 2), min(n, (p + 1) * w + w // 2)
        cs, ws, gs = formants(min(dur, p * step + step / 2))
        filt = shape(src[a:b], lambda f, cs=cs, ws=ws, gs=gs: 0.02 + peaks(f, cs, ws, gs) / np.sqrt(1 + (f / 4500) ** 4), sr)
        win = np.ones(b - a)
        ramp = min(w // 2, (b - a) // 2)
        if a > 0 and ramp:
            win[:ramp] = np.linspace(0, 1, ramp)
        if b < n and ramp:
            win[-ramp:] = np.linspace(1, 0, ramp)
        y[a:b] += filt * win
    return y


VOWELS = {'oo': ([300, 870, 2240], [0.18, 0.2, 0.25], [1.0, 0.45, 0.15]), 'oh': ([480, 900, 2500], [0.17, 0.2, 0.25], [1.0, 0.55, 0.15]),
          'ah': ([720, 1150, 2600], [0.16, 0.18, 0.24], [1.0, 0.7, 0.25]), 'uh': ([560, 1100, 2450], [0.18, 0.2, 0.25], [1.0, 0.5, 0.2]),
          'eh': ([530, 1850, 2500], [0.17, 0.17, 0.22], [1.0, 0.55, 0.3]), 'ee': ([280, 2250, 2900], [0.17, 0.15, 0.2], [1.0, 0.4, 0.3])}


def morph(a, b, x):
    A, B = VOWELS[a], VOWELS[b]
    return tuple([pa + (pb - pa) * x for pa, pb in zip(ca, cb)] for ca, cb in zip(A, B))


def whispers(dur, rng, sr=SR):
    """breath shaped into syllables that never become words"""
    n = int(dur * sr)
    out = np.zeros(n)
    tpos = rng.uniform(0.05, 0.3)
    while tpos < dur - 0.3:
        ln = rng.uniform(0.12, 0.32)
        m = int(ln * sr)
        cs, ws, gs = VOWELS[rng.choice(list(VOWELS))]
        cs = [c * rng.uniform(0.9, 1.15) for c in cs]
        syl = shape(white(m, rng), lambda f: 0.03 + peaks(f, cs, [w * 1.4 for w in ws], gs) + 0.5 * peaks(f, [3200], [0.4], [0.6]), sr)
        syl *= env(m, ln * 0.25, ln * 0.6, sr)
        place(out, syl, tpos, sr)
        if rng.random() < 0.35:                                     # an "s" or "sh"
            k = int(rng.uniform(0.06, 0.16) * sr)
            sib = bandpass(white(k, rng), rng.choice([2800, 4200]), 8000, 3, sr) * env(k, 0.02, 0.06, sr) * 0.7
            place(out, sib, tpos + ln * 0.8, sr)
        tpos += ln + (rng.uniform(0.02, 0.12) if rng.random() < 0.8 else rng.uniform(0.4, 0.9))
    return out


def gurgle(dur, rng, density=40, sr=SR):
    """water churning around something big: low, muffled bubble bursts (no bright chirps)"""
    n = int(dur * sr)
    out = 0.3 * lowpass(brown(n, rng), 300, 2, sr) * (0.5 + 0.5 * smooth_noise(n, rng, 3, sr))
    for _ in range(int(density * dur)):
        at = rng.uniform(0, dur)
        m = int(rng.uniform(0.02, 0.06) * sr)
        tt = np.arange(m) / sr
        f = rng.uniform(110, 380) * (1 + 0.35 * tt / (m / sr))
        place(out, sine(f, m, sr) * np.exp(-tt / rng.uniform(0.008, 0.02)) * rng.uniform(0.2, 0.8), at, sr)
    return lowpass(out, 900, 2, sr)


def drip(rng, sr=SR):
    """one drop into still water, far away: a tick and a short rising ring, mostly cave"""
    m = int(0.12 * sr)
    tt = np.arange(m) / sr
    tick = white(m, rng) * np.exp(-tt / 0.0015) * 0.6
    ring = sine(rng.uniform(700, 1100) * (1 + 0.7 * (1 - np.exp(-tt / 0.02))), m, sr) * np.exp(-tt / 0.018) * 0.5
    return lowpass(tick + ring, 3200, 2, sr)


def knock(rng, sr=SR):
    """knuckles (or claws) against stone and old wood, far away: a hollow knock you can hear on any speaker"""
    m = int(0.5 * sr)
    tt = np.arange(m) / sr
    f = rng.uniform(190, 260)
    body = sum(a * sine(f * r * (1 + 0.04 * np.exp(-tt / 0.01)), m, sr) * np.exp(-tt / d)
               for r, a, d in ((1.0, 1.0, 0.05), (2.3, 0.5, 0.03), (3.9, 0.25, 0.018)))
    low = sine(85 * np.exp(-tt / 0.2), m, sr) * np.exp(-tt / 0.07) * 0.6
    click = bandpass(white(m, rng), 900, 3500, 2, sr) * np.exp(-tt / 0.006) * 0.8
    return body + low + click


def drum(rng, f_hi=120, f_lo=44, decay=0.4, sr=SR):
    """a deep skin drum, struck hard"""
    m = int(max(0.6, decay * 2.5) * sr)
    tt = np.arange(m) / sr
    f = f_lo + (f_hi - f_lo) * np.exp(-tt / 0.045)
    body = sine(f, m, sr) * np.exp(-tt / decay)
    beater = lowpass(white(m, rng), 1600, 2, sr) * np.exp(-tt / 0.02) * 0.8
    return np.tanh(2.2 * (body + beater))


def strings(freqs, dur, rng, tremolo=0.0, bright=1.0, sr=SR):
    """a section of bowed strings: saws with vibrato and bow noise through a wooden body; `tremolo` in Hz"""
    n = int(dur * sr)
    t = np.arange(n) / sr
    out = np.zeros(n)
    for fr in freqs:
        fr = np.broadcast_to(np.asarray(fr, dtype=float), (n,))
        for det in (-0.003, 0.0025):
            vib = 1 + 0.005 * np.sin(2 * np.pi * rng.uniform(5, 6.5) * t + rng.uniform(0, 6))
            v = saw(fr * (1 + det) * vib, n, sr, max_h=40, phase=rng.uniform(0, 6))
            if tremolo:
                v *= (0.55 + 0.45 * np.sin(2 * np.pi * tremolo * (1 + rng.uniform(-0.04, 0.04)) * t + rng.uniform(0, 6))) ** 1.5
            out += v
    bow = bandpass(white(n, rng), 1500, 7000, 2, sr) * 0.06 * len(freqs)
    body = lambda f: (0.15 + peaks(f, [290, 1050, 2600 * bright], [0.4, 0.45, 0.5], [0.8, 1.0, 0.7])) / np.sqrt(1 + (f / (6000 * bright)) ** 4)
    return shape(out + bow, body, sr) / max(1, len(freqs))


def shepard(dur, rng, base=110.0, octaves=6, up=True, tremolo=0.0, sr=SR):
    """the endless glide: tones an octave apart that rise (or fall) forever. One period = one octave = `dur`.
    The base is nudged so every tone completes a whole number of cycles per period: it loops with no seam at all."""
    n = int(round(dur * sr))
    N = max(1, round(base * dur / np.log(2)))
    base = N * np.log(2) / dur
    t = np.arange(n) / sr
    out = np.zeros(n)
    center = np.log2(base) + octaves / 2
    for k in range(octaves):
        pos = np.mod(k + (t / dur if up else -t / dur), octaves)
        f = base * 2 ** pos
        amp = np.exp(-0.5 * ((np.log2(f) - center) / (octaves / 6)) ** 2)
        out += amp * np.sin(2 * np.pi * np.cumsum(f) / sr)
    if tremolo:
        tr = max(1, round(tremolo * dur)) / dur
        out *= 0.6 + 0.4 * np.sin(2 * np.pi * tr * t)
    return out


def wrap(x, period, sr=SR):
    """fold everything past `period` back onto the start: events placed on a loop ring into its beginning"""
    k = int(round(period * sr))
    y = x[..., :k].copy()
    rest = x[..., k:]
    while rest.shape[-1]:
        m = min(k, rest.shape[-1])
        y[..., :m] += rest[..., :m]
        rest = rest[..., m:]
    return y


def loop_seam(x, xf, sr=SR):
    """make a rendered buffer of length L + xf loop: fold the overhang back over the start (equal power)"""
    k = int(xf * sr)
    body, tail = x[..., :-k].copy(), x[..., -k:]
    a = np.sin(np.linspace(0, np.pi / 2, k))
    body[..., :k] = body[..., :k] * a + tail * np.cos(np.linspace(0, np.pi / 2, k))
    return body


# =================================================================== mixing helpers
def rms(x):
    return float(np.sqrt(np.mean(np.asarray(x) ** 2)) + 1e-12)


def heard(x, sr=SR):
    """what a small speaker reproduces (phones, tablets, laptops): roughly 180 Hz to 7 kHz"""
    m = x.mean(0) if np.ndim(x) == 2 else x
    return bandpass(m, 180, 7000, 2, sr)


def master(x, rms_db, peak_db=-1.0, sub_cut=28.0):
    """loudness is set by what small speakers can play (so the dread is never only in the sub-bass), then the
    peaks are soft-limited. Rumble below `sub_cut` Hz is removed (it only costs headroom)"""
    x = x - np.mean(x, axis=-1, keepdims=True)
    x = np.stack([highpass(c, sub_cut, 2) for c in x]) if np.ndim(x) == 2 else highpass(x, sub_cut, 2)
    x = x * (10 ** (rms_db / 20) / rms(heard(x)))
    ceil = 10 ** (peak_db / 20)
    over = np.abs(x) > ceil * 0.7
    if np.any(over):
        k = ceil * 0.7
        x = np.where(over, np.sign(x) * (k + (ceil - k) * np.tanh((np.abs(x) - k) / (ceil - k))), x)
    return x


def fade(x, a, r, sr=SR):
    n = x.shape[-1]
    return x * env(n, a, r, sr)


def stereo_bed(fn, dur, seed, sr=SR):
    """two decorrelated renders of the same texture, one per ear"""
    L = fn(dur, np.random.default_rng(seed))
    R = fn(dur, np.random.default_rng(seed + 1000))
    return np.stack([L, R])


def mixin(bus, st, at=0.0, gain=1.0, sr=SR):
    for ch in range(2):
        place(bus[ch], st[ch], at, sr, gain)


# =================================================================== music: the caves (calm), it is near, the chase
def calm_track(seed, root, dur=80.0, character='air', sr=SR):
    """no rhythm, no melody: a sinking drone, cave air, metal singing over the water, a throat far below, voices"""
    rng = np.random.default_rng(seed)
    n = int(dur * sr)
    bus = np.zeros((2, n))
    d = highpass(drone(root, dur, rng, glide=-rng.uniform(0.6, 1.4)), 75, 2)
    mixin(bus, np.stack([d, np.roll(d, int(0.011 * sr))]), 0, 0.3)
    mixin(bus, np.stack([pressure(dur, rng)] * 2), 0, 0.08)
    air = stereo_bed(lambda du, r: cave_air(du, r, howl=1.6 if character == 'air' else 0.9), dur, seed + 1)
    mixin(bus, air, 0, 1.3 if character == 'air' else 0.8)
    # metal singing over the water: long gliding phrases, never a tune
    for _ in range({'metal': 4, 'air': 2, 'voices': 2, 'deep': 1, 'still': 1}[character]):
        ln = rng.uniform(7, 13)
        f0 = rng.choice([root * 8, root * 11, root * 13]) * 2 ** (rng.uniform(-1, 1) / 12)
        st = verb_st(waterphone(f0, ln, rng, bend=rng.uniform(3, 6)), 5.5, int(rng.integers(1, 9999)), 0.75, 2400, rng.uniform(-0.8, 0.8))
        mixin(bus, st, rng.uniform(4, dur - ln - 6), 0.4)
    # a throat, far below the water
    for _ in range({'metal': 1, 'air': 1, 'voices': 1, 'deep': 3, 'still': 1}[character]):
        ln = rng.uniform(3.5, 6.0)
        f_start = rng.uniform(55, 80)
        vow = rng.choice(['oo', 'oh', 'uh'])
        g = voice(ln, lambda tt, fs=f_start, ln=ln: fs * (1 - 0.35 * tt / ln) * (1 + 0.04 * np.sin(2 * np.pi * 3 * tt)),
                  lambda tt, v=vow: VOWELS[v], rng, breath=0.6, jitter=0.12, sub=0.6)
        g = lowpass(g * env(len(g), ln * 0.35, ln * 0.5), 1500, 2)
        mixin(bus, verb_st(g, 6.0, int(rng.integers(1, 9999)), 0.8, 1800, rng.uniform(-0.6, 0.6)), rng.uniform(6, dur - ln - 8), 0.5)
    # metal or stone bending under the weight of the water
    for _ in range({'metal': 2, 'air': 1, 'voices': 0, 'deep': 2, 'still': 1}[character]):
        ln = rng.uniform(5, 9)
        mixin(bus, verb_st(metal_groan(ln, rng), 5.0, int(rng.integers(1, 9999)), 0.7, 2000, rng.uniform(-0.5, 0.5)),
              rng.uniform(3, dur - ln - 6), 0.3)
    # voices that are not words
    for _ in range({'metal': 1, 'air': 1, 'voices': 4, 'deep': 1, 'still': 2}[character]):
        ln = rng.uniform(1.6, 3.2)
        w = whispers(ln, rng)
        mixin(bus, verb_st(w, 3.5, int(rng.integers(1, 9999)), 0.55, 3500, rng.choice([-0.9, -0.6, 0.6, 0.9])), rng.uniform(5, dur - 8), 0.3)
    # a high shimmer that makes the skin crawl, once
    if character in ('metal', 'still', 'voices'):
        ln = rng.uniform(6, 10)
        mixin(bus, verb_st(bowed_cymbal(ln, rng), 4.0, int(rng.integers(1, 9999)), 0.7, 5000, rng.uniform(-0.4, 0.4)), rng.uniform(10, dur - ln - 5), 0.05)
    # far-off knocks and the odd drop of water, buried in the cave
    for _ in range(int(rng.integers(1, 4))):
        mixin(bus, verb_st(knock(rng), 4.5, int(rng.integers(1, 9999)), 0.85, 1500, rng.uniform(-1, 1)), rng.uniform(4, dur - 6), 0.35)
    for _ in range(int(rng.integers(1, 3))):
        mixin(bus, verb_st(drip(rng), 4.0, int(rng.integers(1, 9999)), 0.85, 2500, rng.uniform(-1, 1)), rng.uniform(4, dur - 6), 0.08)
    bus = fade(bus, 6.0, 7.0)
    return master(bus, -27.0, -2.0, sub_cut=35.0)


def near_loop(seed, dur=36.0, sr=SR):
    """it has your attention: a slow uneven double pulse, the world sinking (an endless falling glide), breath close by"""
    rng = np.random.default_rng(seed)
    xf = 2.0
    n = int(round(dur * sr))
    ev = np.zeros((2, n + int(8 * sr)))                         # events: wrapped around the loop
    bed = np.zeros((2, int((dur + xf) * sr)))                   # sustained sound: cross-faded at the seam
    sh = shepard(dur, rng, base=65.0, octaves=5, up=False)
    sh = bandpass(np.concatenate([sh, sh, sh]), 90, 1800, 2)[n:2 * n]     # filtered in place, still periodic
    gl = np.stack([sh, np.roll(sh, int(0.017 * sr))])
    d = highpass(drone(rng.choice([46.25, 49.0, 43.65]), dur + xf, rng, glide=0.0), 80, 2)
    mixin(bed, np.stack([d, np.roll(d, int(0.009 * sr))]), 0, 0.4)
    at = 0.4                                                    # a heavy pulse: lub ... dub, uneven
    while at < dur:
        hit = drum(rng, f_hi=150, f_lo=55, decay=0.22)
        mixin(ev, verb_st(lowpass(hit, 900), 1.8, int(rng.integers(1, 9999)), 0.35, 1400), at, 0.5)
        mixin(ev, verb_st(lowpass(hit, 700) * 0.6, 1.8, int(rng.integers(1, 9999)), 0.35, 1400), at + rng.uniform(0.24, 0.3), 0.4)
        at += rng.uniform(1.25, 1.6)
    at = rng.uniform(0.5, 2)                                    # breath, very close, big lungs
    while at < dur - 1:
        ln = rng.uniform(1.8, 2.8)
        b = breath_one(ln, rng, inhale=bool(rng.random() < 0.5))
        mixin(ev, verb_st(b, 1.6, int(rng.integers(1, 9999)), 0.3, 2500, rng.uniform(-0.9, 0.9)), at, 0.35)
        at += ln + rng.uniform(1.5, 4.0)
    for _ in range(2):                                          # metal, nearer now
        ln = rng.uniform(5, 8)
        mixin(ev, verb_st(waterphone(rng.uniform(380, 700), ln, rng, bend=5), 3.0, int(rng.integers(1, 9999)), 0.55, 3000,
                          rng.uniform(-0.8, 0.8)), rng.uniform(0, dur), 0.2)
    for _ in range(2):
        mixin(ev, verb_st(whispers(rng.uniform(1.4, 2.4), rng), 2.0, int(rng.integers(1, 9999)), 0.35, 4000, rng.choice([-1, 1]) * 0.9),
              rng.uniform(0, dur), 0.2)
    out = wrap(ev, dur) + loop_seam(bed, xf)[..., :n] + 0.5 * gl
    return master(out, -23.0, -1.5, sub_cut=40.0)


def breath_one(dur, rng, inhale=False, sr=SR):
    """one breath of something huge and wet, with a rattle in it"""
    n = int(dur * sr)
    t = np.arange(n) / sr
    nz = white(n, rng)
    vow = VOWELS['uh' if not inhale else 'oh']
    b = shape(nz, lambda f: 0.05 + peaks(f, [c * 0.55 for c in vow[0]], [0.35, 0.35, 0.4], vow[2]) / np.sqrt(1 + (f / 3000) ** 4), sr)
    shape_env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** (1.4 if inhale else 0.8)
    rattle = 1 - 0.55 * (0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(22, 32) * t)) * (0 if inhale else 1)
    croak = glottal(dur, lambda tt: 26 + 6 * np.sin(tt * 3), rng, 0.15, 0.4, sr) * (0 if inhale else 0.6)
    croak = shape(croak, lambda f: 0.05 + peaks(f, [420, 1100], [0.3, 0.35], [1.0, 0.5]), sr)
    return (b * rattle + croak) * shape_env


def chase_loop(seed, sr=SR):
    """the chase: drums in an uneven 7/8, a grinding bass a semitone wide, strings screaming upward without end"""
    rng = np.random.default_rng(seed)
    eighth = 0.19
    bar = 7 * eighth
    bars = 16
    dur = bars * bar
    xf = 1.2
    n = int(round(dur * sr))
    ev = np.zeros((2, n + int(6 * sr)))
    bed = np.zeros((2, int((dur + xf) * sr)))
    patterns = [[0, 2, 4], [0, 2, 4, 6], [0, 3, 4], [0, 2, 4, 5, 6]]          # 2 + 2 + 3, pushed differently each bar
    for bi in range(bars):
        pat = patterns[(bi * 3 + (bi // 4)) % len(patterns)]
        for e in pat:
            at = bi * bar + e * eighth
            accent = 1.0 if e == 0 else 0.7
            hit = drum(rng, f_hi=rng.uniform(100, 130), f_lo=rng.uniform(40, 50), decay=0.32)
            tom = drum(rng, f_hi=rng.uniform(260, 320), f_lo=rng.uniform(140, 170), decay=0.14)
            both = 0.6 * hit
            both[:len(tom)] += 0.8 * tom[:len(both)]
            mixin(ev, verb_st(both, 2.2, int(rng.integers(1, 9999)), 0.3, 2400, rng.uniform(-0.3, 0.3)), at, 0.75 * accent)
        if bi % 2 == 1:                                             # a metal strike on the off-bar
            m = int(1.2 * sr)
            tt = np.arange(m) / sr
            clang = sum(np.sin(2 * np.pi * 310 * r * tt) * np.exp(-tt / (0.5 / r ** 0.5)) for r in (1, 2.41, 3.73, 5.21)) * 0.25
            mixin(ev, verb_st(clang, 2.6, int(rng.integers(1, 9999)), 0.5, 3000, rng.uniform(-0.7, 0.7)), bi * bar + 5 * eighth, 0.35)
        for i, e in enumerate((0, 2, 4)):                           # the bass: E and F at once and in turn, distorted
            at = bi * bar + e * eighth
            ln = eighth * (2 if i < 2 else 3)
            m = int(ln * sr)
            f = 41.2 * (2 ** (1 / 12) if (bi + i) % 3 == 2 else 1.0)
            v = saw(f, m, sr, 30) + 0.8 * saw(f * 2 ** (1 / 12) * 1.003, m, sr, 30)
            v = bandpass(np.tanh(4.0 * v), 90, 1400, 2) * env(m, 0.005, ln * 0.6)
            mixin(ev, np.stack([v, v]), at, 0.4)
    for _ in range(3):                                              # its voice in the chase: snarls, near and far
        ln = rng.uniform(0.6, 1.1)
        mixin(ev, verb_st(snarl(ln, rng), 1.8, int(rng.integers(1, 9999)), 0.35, 3000, rng.uniform(-0.9, 0.9)), rng.uniform(0, dur), 0.3)
    sh = shepard(dur, rng, base=220.0, octaves=4, up=True, tremolo=13.0)          # an endless upward scream
    sh = bandpass(np.concatenate([sh, sh, sh]), 300, 5000, 2)[n:2 * n]
    cluster = strings([440, 466.2, 622.3], dur + xf, rng, tremolo=14.0)
    mixin(bed, np.stack([cluster, np.roll(cluster, int(0.02 * sr))]), 0, 0.3)
    out = wrap(ev, dur) + loop_seam(bed, xf)[..., :n] + 0.42 * np.stack([sh, np.roll(sh, int(0.013 * sr))])
    return master(out, -17.0, -1.0, sub_cut=35.0)


# =================================================================== stingers: the moment you see it
def reverse_swell(dur, rng, sr=SR):
    """something drawn backwards out of the dark, rushing at you"""
    m = int(dur * sr)
    hit = lowpass(white(m, rng), 2500, 2, sr) * np.exp(-np.arange(m) / sr / (dur / 4))
    metal = waterphone(rng.uniform(500, 800), dur, rng, bend=1.5) * np.exp(-np.arange(m) / sr / (dur / 3))
    y = verb(hit + 0.6 * metal, dur, int(rng.integers(1, 9999)), 0.8, 3000)[:m]
    return y[::-1] * np.linspace(0, 1, m) ** 2


def sting(seed, sr=SR):
    """a stab: rushing in, then strings shrieking a semitone apart over a drum and a ringing metal fall"""
    rng = np.random.default_rng(seed)
    pre = 0.7
    dur = 4.5
    n = int(dur * sr)
    out = np.zeros(n)
    place(out, reverse_swell(pre, rng), 0.0, sr, 0.8)
    base = rng.choice([880, 932.3, 830.6])
    m = int(1.6 * sr)
    tt = np.arange(m) / sr
    fall = 2 ** (-rng.uniform(1, 4) * tt / 1.6 / 12)
    shriek = strings([base * fall, base * 2 ** (1 / 12) * fall, base * 2 ** (6 / 12) * fall], 1.6, rng, tremolo=0.0, bright=1.3)
    place(out, np.tanh(2 * shriek) * env(m, 0.01, 1.0, sr), pre, sr, 0.9)
    place(out, drum(rng, f_hi=140, f_lo=48, decay=0.45), pre, sr, 0.6)
    place(out, lowpass(white(int(0.5 * sr), rng), 3000, 2, sr) * np.exp(-np.arange(int(0.5 * sr)) / sr / 0.08), pre, sr, 0.6)
    place(out, waterphone(rng.uniform(250, 400), 3.0, rng, bend=-3), pre + 0.1, sr, 0.3)
    out = verb(out, 3.5, seed, 0.45, 3500)[:n]
    return master(fade(out, 0.01, 1.2), -15.0, -1.0, sub_cut=40.0)


def spotted(sr=SR):
    """it has seen you: a breath sucked in backwards, a scream of metal and strings, a blow in the chest"""
    rng = np.random.default_rng(404)
    dur = 2.6
    n = int(dur * sr)
    out = np.zeros(n)
    place(out, reverse_swell(0.55, rng), 0.0, sr, 0.9)
    m = int(1.4 * sr)
    tt = np.arange(m) / sr
    rise = 2 ** (2.5 * np.clip(tt / 0.25, 0, 1) / 12)                # it snaps upward, a whole tone, then holds
    scream = strings([1046.5 * rise, 1108.7 * rise, 1480 * rise], 1.4, rng, tremolo=17.0, bright=1.4)
    place(out, np.tanh(2.5 * scream) * env(m, 0.005, 0.9, sr), 0.55, sr, 0.8)
    place(out, waterphone(1400, 1.4, rng, bend=1.0), 0.55, sr, 0.25)
    place(out, drum(rng, f_hi=150, f_lo=50, decay=0.35), 0.55, sr, 0.5)
    out = verb(out, 2.5, 7, 0.4, 4000)[:n]
    return master(fade(out, 0.005, 0.8), -14.0, -1.0, sub_cut=40.0)


def heartbeat(sr=SR):
    """your own heart, felt through the chest: muffled, heavy"""
    rng = np.random.default_rng(5)
    m = int(0.7 * sr)
    out = np.zeros(m)
    for at, amp in ((0.0, 1.0), (0.26, 0.65)):
        place(out, drum(rng, f_hi=70, f_lo=40, decay=0.12), at, sr, amp)
    m = int(0.7 * sr)
    thud = np.zeros(m)
    for at, amp in ((0.0, 1.0), (0.26, 0.65)):                       # the part a small speaker can play: a dull knock
        k = int(0.12 * sr)
        tk = np.arange(k) / sr
        place(thud, sine(320 * np.exp(-tk / 0.03) + 150, k, sr) * np.exp(-tk / 0.03), at, sr, amp)
    y = lowpass(out, 220, 2) + 1.6 * lowpass(thud, 900, 2)
    return y / (np.max(np.abs(y)) + 1e-12) * 0.89


# =================================================================== its voice and its body (mono, played where it is)
def snarl(dur, rng, sr=SR):
    """a fast, wet snarl: rough throat high in the chest, teeth, spit"""
    f = lambda tt: 120 + 90 * np.sin(np.pi * np.clip(tt / dur, 0, 1)) + 15 * np.sin(2 * np.pi * 11 * tt)
    v = voice(dur, f, lambda tt: morph('ah', 'eh', min(1.0, tt / dur)), rng, breath=1.2, jitter=0.18, sub=0.7)
    hiss_ = bandpass(white(int(dur * sr), rng), 2500, 7000, 2, sr) * 0.25
    return np.tanh(2.2 * (v + hiss_)) * env(int(dur * sr), 0.02, dur * 0.5, sr)


def creature(audio_splash=None, audio_step=None, sr=SR):
    """every sound it makes. Returns {relative path: mono signal}"""
    rng = np.random.default_rng(31)
    fx = {}
    # breathing: big, wet, slow; a rattle on the way out
    b = np.concatenate([breath_one(1.4, rng, inhale=True), np.zeros(int(0.15 * sr)), breath_one(1.9, rng)])
    fx['mob/brinesleeper/breathe'] = verb(b, 1.6, 1, 0.3, 2500)
    # the click: a throat that rattles like something being wound up (vocal fry, getting slower)
    for i in range(2):
        ln = 1.3 + 0.3 * i
        v = voice(ln, lambda tt, ln=ln: (38 - 18 * tt / ln) * (1 + 0.1 * np.sin(2 * np.pi * 1.3 * tt)),
                  lambda tt: VOWELS['oh'] if i == 0 else VOWELS['uh'], rng, breath=0.15, jitter=0.25, sub=0.3)
        fx[f'mob/brinesleeper/click{i + 1}'] = verb(np.tanh(1.8 * v) * env(len(v), 0.05, 0.4), 1.4, 3 + i, 0.3, 3500)
    # the call: a long inhuman wail across the water, voice and metal together, bending down
    ln = 3.4
    wail = voice(ln, lambda tt: 210 * (1 + 0.25 * np.sin(np.pi * tt / ln)) * (1 - 0.3 * tt / ln) * (1 + 0.015 * np.sin(2 * np.pi * 5 * tt)),
                 lambda tt: morph('oo', 'ah', 0.5 - 0.5 * np.cos(np.pi * tt / ln)), rng, breath=0.5, jitter=0.03, sub=0.25)
    wail = wail + 0.15 * waterphone(420, ln, rng, bend=4.0)
    fx['mob/brinesleeper/call'] = verb(np.tanh(1.3 * wail) * env(len(wail), 0.6, 1.4), 4.0, 5, 0.6, 2400)
    # lunge: a short shriek-snarl
    fx['mob/brinesleeper/lunge'] = verb(snarl(0.65, rng) + 0.5 * np.tanh(3 * strings([700, 741.6], 0.65, rng, bright=1.3)) * env(int(0.65 * sr), 0.01, 0.4), 1.2, 6, 0.3, 4000)
    # grasp: water churning, a low growl, held
    g = voice(1.2, lambda tt: 58 + 8 * np.sin(2 * np.pi * 2 * tt), lambda tt: VOWELS['uh'], rng, breath=0.8, jitter=0.2, sub=0.8)
    fx['mob/brinesleeper/grasp'] = verb(gurgle(1.2, rng, 50) + 0.7 * g, 1.3, 7, 0.4, 2000)
    # hurt: a sharp, pained shriek through teeth
    h = voice(0.45, lambda tt: 260 * (1 - 0.4 * tt / 0.45), lambda tt: VOWELS['eh'], rng, breath=0.9, jitter=0.12, sub=0.5)
    fx['mob/brinesleeper/hurt'] = verb(np.tanh(2.4 * h) * env(int(0.45 * sr), 0.005, 0.25), 1.0, 8, 0.35, 3500)
    # death: a long falling moan that drowns
    d = voice(2.6, lambda tt: 140 * (1 - 0.6 * tt / 2.6), lambda tt: morph('ah', 'oo', tt / 2.6), rng, breath=0.6, jitter=0.15, sub=0.6)
    fx['mob/brinesleeper/death'] = verb(np.tanh(1.6 * d) * env(int(2.6 * sr), 0.05, 1.0) + 0.6 * gurgle(2.6, rng, 30), 2.6, 9, 0.5, 2200)
    # roar: huge, torn, two throats a tritone apart, rising then breaking
    ln = 2.3
    r1 = voice(ln, lambda tt: 95 * (1 + 0.5 * np.sin(np.pi * np.clip(tt / ln, 0, 1))) * (1 + 0.03 * np.sin(2 * np.pi * 9 * tt)),
               lambda tt: morph('oh', 'ah', min(1.0, tt / 0.6)), rng, breath=0.7, jitter=0.2, sub=0.8)
    r2 = voice(ln, lambda tt: 95 * 2 ** (6 / 12) * (1 + 0.45 * np.sin(np.pi * np.clip(tt / ln, 0, 1))),
               lambda tt: morph('uh', 'eh', min(1.0, tt / 0.8)), rng, breath=0.7, jitter=0.25, sub=0.8)
    r1, r2 = r1 / (rms(r1) * 8), r2 / (rms(r2) * 8)
    rasp = bandpass(white(int(ln * sr), rng), 900, 3500, 2) * 0.05
    fx['mob/brinesleeper/roar'] = verb(np.tanh(2.2 * (r1 + 0.7 * r2 + rasp)) * env(int(ln * sr), 0.06, 0.9), 2.4, 1, 0.45, 2600)
    # hiss: through teeth, with a growl underneath
    m = int(1.4 * sr)
    hs = shape(white(m, rng), lambda f: 0.02 + peaks(f, [3500, 6000], [0.35, 0.3], [1.0, 0.6])) * env(m, 0.4, 0.6)
    hs *= 0.75 + 0.25 * np.sin(2 * np.pi * 7 * np.arange(m) / sr)
    under = voice(1.4, lambda tt: 52, lambda tt: VOWELS['uh'], rng, breath=0.4, jitter=0.2, sub=0.8) * 0.5 * env(m, 0.4, 0.6)
    fx['mob/brinesleeper/hiss'] = verb(hs + under, 1.8, 2, 0.4, 4000)
    # moan: deep and drowned, opening from "oo" to "ah", with fry at the start and the end
    ln = 3.6
    mo = voice(ln, lambda tt: (68 - 20 * tt / ln) * (1 + 0.03 * np.sin(2 * np.pi * 4 * tt)) * (0.55 if (tt < 0.4 or tt > ln - 0.5) else 1.0),
               lambda tt: morph('oo', 'ah', np.sin(np.pi * tt / ln)), rng, breath=0.5, jitter=0.1, sub=0.6)
    fx['mob/brinesleeper/moan'] = verb(np.tanh(1.5 * mo) * env(int(ln * sr), 0.7, 1.3), 4.5, 3, 0.65, 2000)
    # its steps and the water it moves (the repository's own recordings, slowed and darkened)
    if audio_step is not None:
        for i, pitch in enumerate((0.62, 0.55)):
            st = np.interp(np.arange(0, len(audio_step) - 1, pitch), np.arange(len(audio_step)), audio_step)
            slap = lowpass(st, 1100, 2) + 0.3 * lowpass(gurgle(len(st) / sr, rng, 10), 600, 2)
            fx[f'mob/brinesleeper/step{i + 1}'] = verb(slap, 1.5, 12 + i, 0.4, 2000)
    if audio_splash is not None:
        slow = np.interp(np.arange(0, len(audio_splash) - 1, 0.6), np.arange(len(audio_splash)), audio_splash)
        L = len(slow)
        fx['mob/brinesleeper/emerge'] = verb(lowpass(slow, 1500, 2) + 0.4 * gurgle(L / sr, rng, 20)[:L], 2.2, 10, 0.5, 2000)
        m = max(L, int(1.3 * sr))
        sub_ = np.zeros(m)
        sub_[:L] += 0.5 * lowpass(slow, 900, 2)
        sub_ += gurgle(m / sr, rng, 35)[:m]
        fx['mob/brinesleeper/submerge'] = verb(sub_, 1.8, 11, 0.5, 1800)
        far = np.interp(np.arange(0, len(audio_splash) - 1, 0.75), np.arange(len(audio_splash)), audio_splash)
        fx['brine_fx/splash_far'] = verb(lowpass(far, 800, 2), 3.6, 14, 0.8, 1500)
        fx['brine_fx/surge'] = verb(lowpass(slow, 1000, 2) + 0.5 * gurgle(L / sr, rng, 25)[:L], 2.6, 15, 0.6, 1800)
        m = int(1.8 * sr)
        burst = np.zeros(m)
        burst[:min(L, m)] += 1.3 * slow[:min(L, m)]
        burst += 0.8 * lowpass(white(m, rng), 1800, 2) * np.exp(-np.arange(m) / sr / 0.35)
        place(burst, snarl(0.8, rng), 0.05, sr, 0.6)
        fx['brine_fx/burst'] = verb(burst, 2.0, 5, 0.4, 2600)
    fx['brine_fx/bubbles'] = verb(gurgle(1.1, rng, 45), 1.8, 16, 0.5, 1500)
    m = int(1.2 * sr)
    lap = bandpass(pink(m, rng), 180, 1300, 2) * np.sin(np.pi * np.arange(m) / m) ** 2 * (0.6 + 0.4 * smooth_noise(m, rng, 6))
    fx['brine_fx/ripple'] = verb(lap, 1.8, 17, 0.5, 1400)
    fx['brine_fx/drip'] = verb(drip(rng), 3.0, 18, 0.75, 2500)
    kn = np.zeros(int(1.4 * sr))
    for at in (0.0, 0.31, 0.71):                                   # three knocks; the last one late
        place(kn, knock(rng), at, sr, 1.0)
    fx['brine_fx/knock'] = verb(kn, 2.6, 4, 0.55, 1500)
    m = int(1.0 * sr)
    tt = np.arange(m) / sr
    deep = 1.4 * sine(48 - 16 * tt, m) * np.exp(-tt / 0.18)
    body = sine(260 * np.exp(-tt / 0.06) + 120, m) * np.exp(-tt / 0.07)              # the bump you hear, not just feel
    fx['brine_fx/thump'] = verb(lowpass(deep + 0.9 * body + 0.5 * gurgle(1.0, rng, 25), 1200, 2), 1.2, 21, 0.3, 1500)
    m = int(0.6 * sr)
    fx['brine_fx/snuff'] = highpass(white(m, rng), 2500, 2) * np.exp(-np.arange(m) / sr / 0.14)
    fx['brine_fx/heartbeat'] = heartbeat()
    return fx


def ambient_oneshots(audio_splash=None, sr=SR):
    """what the Stillwater Caves play now and then (the biome's ambient additions): never cute, always far away"""
    rng = np.random.default_rng(9)
    out = {}
    for i in range(2):
        d = np.zeros(int(0.6 * sr))
        place(d, drip(rng), 0.0, sr, 1.0)
        if rng.random() < 0.6:
            place(d, drip(rng), rng.uniform(0.15, 0.4), sr, 0.4)
        out[f'stillwater_drip{i + 1}'] = verb(d, 4.0, 10 + i, 0.85, 2200)
    if audio_splash is not None:
        for i, (pitch, cut) in enumerate(((0.7, 800.0), (0.85, 1100.0))):
            v = np.interp(np.arange(0, len(audio_splash) - 1, pitch), np.arange(len(audio_splash)), audio_splash)
            out[f'stillwater_splash{i + 1}'] = verb(lowpass(v, cut, 2), 4.5, i + 1, 0.8, 1500)
    for i in range(2):                                              # a groan in the rock
        out[f'stillwater_groan{i + 1}'] = verb(metal_groan(rng.uniform(3.5, 5.0), rng), 5.0, 30 + i, 0.75, 1600)
    ln = 2.6                                                        # a voice far off, then nothing
    v = voice(ln, lambda tt: 60 * (1 - 0.2 * tt / ln), lambda tt: VOWELS['oo'], rng, breath=0.6, jitter=0.12, sub=0.6)
    out['stillwater_moan1'] = verb(lowpass(np.tanh(1.4 * v) * env(int(ln * sr), 0.8, 1.2), 900, 2), 5.5, 40, 0.85, 1200)
    out['stillwater_whisper1'] = verb(whispers(2.2, rng), 4.0, 41, 0.75, 3000)
    return out
