"""Original procedural sound design for the Shaftbreaker (numpy DSP -> OGG Vorbis via ffmpeg).
Every sound here is synthesized from scratch; nothing is sampled from any game or add-on."""
import os, json, subprocess, math, tempfile, wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, 'Shaftbreaker_RP')
OUT = os.path.join(RP, 'sounds/shaftbreaker')
SR = 44100
R = np.random.default_rng(1337)


# ----------------------------------------------------------------------------- primitives
def t_axis(d):
    return np.arange(int(d * SR)) / SR


def noise(d, color='white'):
    n = R.standard_normal(int(d * SR))
    if color == 'white':
        return n
    X = np.fft.rfft(n); f = np.fft.rfftfreq(len(n), 1 / SR); f[0] = 1
    X = X / (np.sqrt(f) if color == 'pink' else f / 20)
    y = np.fft.irfft(X, len(n))
    return y / (np.abs(y).max() + 1e-9)


def spec_filter(x, gain):
    pad = int(0.25 * SR)
    xp = np.concatenate([np.zeros(pad), x, np.zeros(pad)])
    X = np.fft.rfft(xp); f = np.fft.rfftfreq(len(xp), 1 / SR)
    return np.fft.irfft(X * gain(f), len(xp))[pad:pad + len(x)]


def lp(x, fc, n=2):
    return spec_filter(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * n)))


def hp(x, fc, n=2):
    return spec_filter(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1)) ** (2 * n)))


def bp(x, lo, hi, n=2):
    return hp(lp(x, hi, n), lo, n)


def peaks(f, formants):
    g = np.zeros_like(f)
    for fc, bw, amp in formants:
        g += amp / (1 + ((f - fc) / (bw / 2)) ** 2)
    return g


def stft_shape(x, gain_fn, n=2048, hop=512):
    """time varying spectral shaping: gain_fn(freqs, t) -> gain array"""
    win = np.hanning(n)
    pad = np.concatenate([np.zeros(n), x, np.zeros(n)])
    out = np.zeros_like(pad); norm = np.zeros_like(pad)
    f = np.fft.rfftfreq(n, 1 / SR)
    for s in range(0, len(pad) - n, hop):
        seg = pad[s:s + n] * win
        t = (s - n + n / 2) / SR
        y = np.fft.irfft(np.fft.rfft(seg) * gain_fn(f, max(0.0, t)), n) * win
        out[s:s + n] += y; norm[s:s + n] += win ** 2
    out = out / np.maximum(norm, 1e-3)
    return out[n:n + len(x)]


def env_exp(d, decay, attack=0.002):
    t = t_axis(d)
    e = np.exp(-t / decay)
    a = np.minimum(1, t / max(attack, 1e-4))
    return e * a


def env_adsr(d, a, dcy, s, r):
    t = t_axis(d); e = np.zeros_like(t)
    for i, tt in enumerate((0,)):
        pass
    e = np.where(t < a, t / a, np.where(t < a + dcy, 1 - (1 - s) * (t - a) / dcy, s))
    rel = np.clip((d - t) / r, 0, 1)
    return e * rel


def osc_saw(f0):
    ph = np.cumsum(f0) / SR
    return 2 * (ph % 1.0) - 1


def osc_sin(f0):
    return np.sin(2 * np.pi * np.cumsum(f0) / SR)


def damped(freq, decay, d, phase=0.0):
    t = t_axis(d)
    return np.sin(2 * np.pi * freq * t + phase) * np.exp(-t / decay)


def place(dst, src, at):
    i = int(at * SR)
    if i >= len(dst):
        return dst
    n = min(len(src), len(dst) - i)
    dst[i:i + n] += src[:n]
    return dst


def norm(x, peak=0.89):
    m = np.abs(x).max()
    return x * (peak / m) if m > 0 else x


def fade(x, fin=0.003, fout=0.02):
    n1 = max(1, int(fin * SR)); n2 = max(1, int(fout * SR))
    x = x.copy(); x[:n1] *= np.linspace(0, 1, n1); x[-n2:] *= np.linspace(1, 0, n2)
    return x


def cave_ir(rt=1.8, d=None, bright=3500, er=True):
    d = d or rt * 1.2
    t = t_axis(d)
    n = R.standard_normal(len(t)) * np.exp(-6.9 * t / rt)
    n = stft_shape(n, lambda f, tt: 1 / np.sqrt(1 + (f / max(400, bright * math.exp(-tt * 1.6))) ** 4))
    ir = n * 0.35
    ir[0] = 1.0
    if er:
        for dl, g in [(0.013, 0.5), (0.027, 0.38), (0.041, 0.3), (0.063, 0.22), (0.088, 0.16)]:
            ir[int(dl * SR)] += g * (1 if R.random() > 0.5 else -1)
    return ir


def convolve(x, ir, circular=False):
    if circular:
        n = len(x)
        irp = np.zeros(n); m = min(n, len(ir)); irp[:m] = ir[:m]
        return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(irp), n)
    n = len(x) + len(ir) - 1
    N = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:n]
    return y


def reverb(x, wet=0.3, rt=1.6, bright=3500):
    y = convolve(x, cave_ir(rt, bright=bright))
    out = np.zeros(len(y)); out[:len(x)] += x * (1 - wet)
    return out + y / (np.abs(y).max() + 1e-9) * np.abs(x).max() * wet


def grains(d, count, lo, hi, size=0.004, spread=None, decay=None):
    out = np.zeros(int(d * SR))
    for _ in range(count):
        at = R.random() * (spread or d) if decay is None else min(d - 0.01, R.exponential(decay))
        g = R.standard_normal(int(size * SR * (0.5 + R.random()))) * np.hanning(int(size * SR * (0.5 + R.random())) or 2)[:1].mean()
        L = int(size * SR * (0.5 + R.random()))
        g = R.standard_normal(L) * np.hanning(L)
        place(out, g * (0.3 + R.random()), at)
    return bp(out, lo, hi)


def vocal(d, f0_curve, formants_curve, rough=0.0, sub=0.0, breath=0.15, drive=2.0, jitter=0.01):
    t = t_axis(d)
    f0 = f0_curve(t) * (1 + jitter * lp(R.standard_normal(len(t)), 30) * 6)
    src = osc_saw(f0) + sub * osc_saw(f0 / 2)
    if rough:
        am = 1 + rough * lp(R.standard_normal(len(t)), 60) * 4
        src = src * am
    src = src + breath * R.standard_normal(len(t))
    shaped = stft_shape(src, lambda f, tt: peaks(f, formants_curve(tt)) + 0.006)
    return lp(np.tanh(drive * norm(shaped, 1.0)), 5200, 3)


# ----------------------------------------------------------------------------- sound designs
def step(v):
    d = 0.45
    t = t_axis(d)
    f = 52 + 18 * np.exp(-t / 0.03)
    thump = osc_sin(f) * env_exp(d, 0.09 + 0.02 * v)
    body = lp(noise(d), 700) * env_exp(d, 0.05)
    grit = grains(d, 26, 1800, 6000, size=0.003, decay=0.05) * 0.5
    return fade(norm(thump * 1.0 + body * 0.6 + grit * 0.45))


def scrape(v):
    d = 0.7 + 0.1 * v
    t = t_axis(d)
    n = noise(d)
    stick = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * np.cumsum(30 + 25 * lp(R.standard_normal(len(t)), 8) * 5) / SR))
    shaped = stft_shape(n * (0.4 + 0.6 * stick), lambda f, tt: peaks(f, [(1300 + 1400 * tt / d + 200 * v, 900, 1.0), (3200 + 300 * v, 600, 0.5), (5200, 1200, 0.25)]))
    sq = sum(damped(fq * (1 + 0.04 * v), 0.25, d) for fq in (1870, 2990, 4410)) * 0.12
    e = env_adsr(d, 0.05, 0.2, 0.7, 0.25)
    return fade(norm((shaped + sq * stick) * e))


def smash(v):
    d = 1.6
    t = t_axis(d)
    thump = osc_sin(44 + 40 * np.exp(-t / 0.05)) * env_exp(d, 0.22)
    crack = hp(noise(d), 1500) * env_exp(d, 0.012)
    rumble = lp(noise(d, 'brown'), 260) * env_exp(d, 0.4)
    deb = grains(d, 60, 1200, 5500, size=0.004, decay=0.35) * 0.6
    x = thump * 1.0 + crack * 0.7 + rumble * 0.7 + deb
    return fade(norm(reverb(norm(x), 0.25, 1.4)[:int(d * SR) + int(0.8 * SR)]))


def screech(v):
    d = 1.7
    f0 = lambda t: (380 + 260 * np.sin(np.pi * np.clip(t / d, 0, 1)) ** 0.7 - 120 * (t / d) ** 2 + 18 * np.sin(2 * np.pi * 7.5 * t)) * (1 + 0.06 * v)
    fm = lambda tt: [(720 + 200 * math.sin(tt * 3), 260, 1.0), (1850, 300, 0.8), (3050, 500, 0.55), (4300, 700, 0.3)]
    x = vocal(d, f0, fm, rough=0.6, sub=0.5, breath=0.22, drive=3.0)
    t = t_axis(d)
    x = x * (0.7 + 0.3 * np.sin(2 * np.pi * 63 * t))
    e = env_adsr(d, 0.06, 0.3, 0.75, 0.5)
    return fade(norm(reverb(norm(x * e), 0.22, 1.3)))


def roar(v, cut=None):
    d = 2.6
    f0 = lambda t: (88 + 46 * np.sin(np.pi * np.clip(t / 1.9, 0, 1)) - 22 * np.clip((t - 1.6) / 1.0, 0, 1)) * (1 + 0.05 * v)
    fm = lambda tt: [(640, 220, 1.0), (1100, 260, 0.75), (2450, 420, 0.4), (3600, 600, 0.2)]
    x = vocal(d, f0, fm, rough=1.0, sub=0.9, breath=0.14, drive=2.4, jitter=0.02)
    t = t_axis(d)
    sub = osc_sin(42 + 6 * np.sin(2 * np.pi * 0.7 * t)) * 0.5
    e = env_adsr(d, 0.12, 0.4, 0.85, 0.7)
    x = (x + sub) * e
    if cut:
        n = int(cut * SR)
        x = x[:n]; x[-int(0.004 * SR):] *= np.linspace(1, 0, int(0.004 * SR))
        return fade(norm(x), 0.003, 0.004)
    return fade(norm(reverb(norm(x), 0.25, 1.8)))


def swing(v):
    d = 0.42
    n = noise(d)
    x = stft_shape(n, lambda f, tt: peaks(f, [(500 + 2400 * math.sin(math.pi * min(1, tt / d)) + 100 * v, 700, 1.0)]))
    return fade(norm(x * np.hanning(len(x)) ** 0.8))


def growl(v):
    d = 1.4
    f0 = lambda t: (72 + 10 * np.sin(2 * np.pi * 0.9 * t)) * (1 + 0.04 * v)
    x = vocal(d, f0, lambda tt: [(420, 160, 1.0), (820, 200, 0.6), (2300, 500, 0.15)], rough=1.3, sub=0.7, breath=0.12, drive=2.2, jitter=0.03)
    return fade(norm(x * env_adsr(d, 0.15, 0.3, 0.8, 0.45)))


def collapse(v):
    d = 3.2
    groan = vocal(1.9, lambda t: 150 * np.exp(-t / 1.4) + 55, lambda tt: [(520 - tt * 120, 200, 1.0), (980, 260, 0.6), (2400, 500, 0.2)],
                  rough=0.9, sub=0.6, breath=0.4, drive=2.6) * env_adsr(1.9, 0.1, 0.5, 0.7, 0.8)
    x = np.zeros(int(d * SR))
    place(x, groan * 0.8, 0.0)
    place(x, fade(smash(0)[:int(1.2 * SR)], 0.001, 0.25) * 0.6, 1.25)
    place(x, fade(smash(1)[:int(1.6 * SR)], 0.001, 0.3) * 0.9, 2.05)
    return fade(norm(x))


def chew(v):
    d = 0.55
    x = np.zeros(int(d * SR))
    for k in range(3):
        place(x, grains(0.09, 30, 1400, 4500, size=0.003) * env_exp(0.09, 0.03), 0.05 + k * 0.15 + R.random() * 0.03)
    place(x, lp(noise(0.3), 500) * env_exp(0.3, 0.08) * 0.4, 0.0)
    return fade(norm(x))


def hurt(v):
    d = 0.6
    x = np.zeros(int(d * SR))
    place(x, hp(noise(0.05), 1200) * env_exp(0.05, 0.01), 0)
    g = vocal(0.4, lambda t: 115 + 30 * np.exp(-t / 0.08) + 10 * v, lambda tt: [(560, 200, 1.0), (1150, 260, 0.6)], rough=0.8, sub=0.4, drive=2.5)
    place(x, g * env_adsr(0.4, 0.02, 0.1, 0.6, 0.2) * 0.8, 0.02)
    place(x, grains(0.3, 18, 1500, 5000, decay=0.1) * 0.4, 0.0)
    return fade(norm(x))


def click(v):
    d = 0.7
    x = np.zeros(int(d * SR))
    at = 0.02
    for k in range(3 + v):
        c = damped(950 + R.random() * 500, 0.006, 0.03) + 0.4 * damped(340, 0.012, 0.04)[:int(0.03 * SR)]
        place(x, c * (0.6 + 0.4 * R.random()), at)
        at += 0.05 + R.random() * 0.12
    return fade(norm(reverb(x, 0.2, 0.8)[:int(d * SR)]))


def breath(v):
    d = 3.0
    x = np.zeros(int(d * SR))
    ins = stft_shape(noise(1.1), lambda f, tt: peaks(f, [(900 + 700 * tt, 700, 1.0), (2600, 900, 0.35)])) * env_adsr(1.1, 0.5, 0.3, 0.8, 0.3)
    outb = stft_shape(noise(1.5), lambda f, tt: peaks(f, [(650 - 150 * tt, 500, 1.0), (1500, 600, 0.4)])) * env_adsr(1.5, 0.08, 0.4, 0.6, 0.9)
    rasp = vocal(1.5, lambda t: 58 + 4 * np.sin(5 * t), lambda tt: [(500, 200, 1.0), (1000, 300, 0.4)], rough=1.0, breath=0.6, drive=1.5) * 0.18
    place(x, ins * 0.7, 0.05)
    place(x, (outb + rasp * env_adsr(1.5, 0.1, 0.3, 0.5, 0.8)) * (0.9 + 0.1 * v), 1.35)
    return fade(norm(lp(x, 4500)))


def knock(v):
    d = 0.9
    x = np.zeros(int(d * SR))
    hit = sum(damped(fq * (1 + 0.03 * v), dc, 0.5) * a for fq, dc, a in [(172, 0.12, 1.0), (404, 0.06, 0.6), (760, 0.03, 0.35), (1290, 0.015, 0.2)])
    hit += lp(noise(0.5), 1400) * env_exp(0.5, 0.012) * 0.6
    place(x, hit, 0)
    return fade(norm(reverb(lp(x, 2600), 0.35, 1.9)[:int(1.6 * SR)]))


def pickaxe(v):
    d = 0.55
    x = np.zeros(int(d * SR))
    ring = sum(damped(fq * (0.93 + 0.02 * v), dc, d) * a for fq, dc, a in [(2050, 0.08, 1.0), (3330, 0.05, 0.7), (5150, 0.03, 0.4), (2870, 0.06, 0.35)])
    crack = hp(noise(d), 900) * env_exp(d, 0.018)
    deb = grains(d, 22, 1500, 6000, decay=0.08) * 0.5
    x = fade(ring * 0.45 + crack * 0.9 + deb, 0.001, 0.12)
    return fade(norm(reverb(x, 0.25, 1.1)[:int(0.9 * SR)]), 0.001, 0.1)


def pstep(v):
    d = 0.22
    x = bp(noise(d), 450 + 60 * v, 3200) * env_exp(d, 0.03) + osc_sin(np.full(int(d * SR), 95.0)) * env_exp(d, 0.04) * 0.4
    return fade(norm(x))


def distant_impact(v):
    d = 3.5
    t = t_axis(d)
    rum = lp(noise(d, 'brown'), 140) * env_adsr(d, 0.05, 0.6, 0.5, 2.2)
    th = osc_sin(36 + 20 * np.exp(-t / 0.08)) * env_exp(d, 0.4)
    deb = lp(grains(d, 50, 600, 2500, decay=0.6), 1500) * 0.3
    return fade(norm(reverb(rum * 0.8 + th + deb, 0.4, 2.6, bright=1200)[:int(4.5 * SR)]))


def call(v):
    d = 2.6
    f0 = lambda t: (230 - 70 * (t / d) + 8 * np.sin(2 * np.pi * 5.2 * t)) * (1 + 0.08 * v)
    x = vocal(d, f0, lambda tt: [(330, 140, 1.0), (880, 220, 0.45), (2300, 500, 0.1)], rough=0.3, sub=0.2, breath=0.25, drive=1.6)
    x = lp(x * env_adsr(d, 0.4, 0.5, 0.8, 1.0), 1800)
    return fade(norm(reverb(x, 0.55, 3.0, bright=1500)))


def creak(v):
    d = 1.5
    t = t_axis(d)
    rate = 18 + 50 * (0.5 + 0.5 * np.sin(2 * np.pi * (0.4 + 0.2 * v) * t)) + 10 * lp(R.standard_normal(len(t)), 5) * 8
    ph = np.cumsum(rate) / SR
    imp = (np.diff(np.floor(ph), prepend=0) > 0).astype(float)
    res = sum(convolve(imp, damped(fq, dc, 0.08))[:len(t)] * a for fq, dc, a in [(215, 0.03, 1.0), (590, 0.012, 0.5), (1170, 0.006, 0.3)])
    return fade(norm(res * env_adsr(d, 0.2, 0.4, 0.8, 0.5) + noise(d) * 0.02))


def debris_fall(v):
    d = 1.8
    x = grains(d, 70, 900, 5200, size=0.004, spread=1.4) * np.linspace(1, 0.3, int(d * SR))
    x += bp(noise(d), 2000, 8000) * env_adsr(d, 0.1, 0.5, 0.4, 0.8) * 0.15
    return fade(norm(reverb(x, 0.3, 1.2)[:int(2.4 * SR)]))


def vanish(v):
    d = 1.5
    ex = stft_shape(noise(d), lambda f, tt: peaks(f, [(500 - 150 * tt, 500, 1.0), (1300, 700, 0.3)])) * env_adsr(d, 0.1, 0.4, 0.6, 0.9)
    wh = lp(noise(d, 'pink'), 600) * np.hanning(int(d * SR)) * 0.5
    return fade(norm(ex + wh))


def heartbeat(v):
    d = 0.75
    x = np.zeros(int(d * SR))
    t = t_axis(0.18)
    place(x, osc_sin(58 + 20 * np.exp(-t / 0.02)) * env_exp(0.18, 0.05), 0.0)
    place(x, osc_sin(49 + 15 * np.exp(-t / 0.02)) * env_exp(0.18, 0.045) * 0.75, 0.24)
    return fade(norm(lp(x, 220)))


def drone_loop(v):
    d = 12.0
    t = t_axis(d)
    # integer-cycle partials over the loop length so the loop is seamless
    def part(f):
        return np.sin(2 * np.pi * round(f * d) / d * t)
    x = part(41.2) * 0.6 + part(43.65) * 0.5 + part(61.7) * 0.25 + part(87.3) * 0.15 + part(92.5) * 0.1
    sw = 0.75 + 0.25 * np.sin(2 * np.pi * 1 / d * t)
    air = convolve(lp(noise(d, 'pink'), 380), np.ones(1) * 1.0, circular=True) * 0.25
    return norm((x * sw + air), 0.7)


def room_tone(v):
    d = 14.0
    base = lp(noise(d, 'brown'), 220) * 0.6 + bp(noise(d), 300, 900) * 0.05
    drips = np.zeros(int(d * SR))
    for k in range(4 + v):
        place(drips, damped(2300 + R.random() * 900, 0.025, 0.2) * 0.25, 0.5 + R.random() * (d - 1.5))
    x = base + convolve(drips, cave_ir(2.4, bright=3000), circular=True)
    return norm(x, 0.6)


def sting_soft(v):
    d = 3.2
    t = t_axis(d)
    cl = sum(osc_saw(np.full(len(t), f)) for f in (110, 155.6, 233.1)) / 3
    cl = lp(cl, 900) * np.clip(t / 2.6, 0, 1) ** 2 * env_adsr(d, 0.01, 0.1, 1.0, 0.6)
    sw = stft_shape(noise(d), lambda f, tt: peaks(f, [(300 + 900 * tt / d, 400, 1.0)])) * np.clip(t / 2.8, 0, 1) ** 2
    return fade(norm(reverb(cl * 0.7 + sw * 0.5, 0.35, 2.0)[:int(4.2 * SR)]), 0.01, 0.4)


def trophy_hum(v):
    d = 2.4
    t = t_axis(d)
    x = (osc_sin(np.full(len(t), 110.0)) + 0.5 * osc_sin(np.full(len(t), 164.8))) * (0.7 + 0.3 * np.sin(2 * np.pi * 3 * t))
    return fade(norm(x * env_adsr(d, 0.4, 0.4, 0.7, 0.9), 0.5), 0.05, 0.4)


def dial(v):
    d = 0.6
    x = damped(1318.5, 0.18, d) + 0.5 * damped(1975.5, 0.12, d) + 0.25 * damped(2637, 0.07, d)
    return fade(norm(x, 0.7))


def flutter(v):
    d = 0.6
    t = t_axis(d)
    am = 0.5 + 0.5 * np.sin(2 * np.pi * (32 + 4 * v) * t)
    return fade(norm(bp(noise(d), 500, 3000) * am * np.hanning(len(t)), 0.5))


# ----------------------------------------------------------------------------- music (original)
def taiko(d=0.9, f=62):
    t = t_axis(d)
    return osc_sin(f + 50 * np.exp(-t / 0.03)) * env_exp(d, 0.22) + lp(noise(d), 900) * env_exp(d, 0.03) * 0.5


def chase_music():
    bpm = 132; beat = 60 / bpm; bars = 16
    d = bars * 4 * beat
    n = int(d * SR)
    x = np.zeros(n)
    t = t_axis(d)
    # pulse bass: eighth notes, A (55) with a b2 (58.27) turn every bar, last 4 bars climb
    notes = []
    for bar in range(bars):
        root = 55.0 if bar < 12 else 55.0 * (2 ** ((bar - 11) / 12))
        for e in range(8):
            f = root * (2 ** (1 / 12)) if e in (6, 7) else root
            notes.append((bar * 4 * beat + e * beat / 2, f))
    for at, f in notes:
        dd = beat / 2
        tt = t_axis(dd)
        s = osc_saw(np.full(len(tt), f)) + 0.5 * osc_saw(np.full(len(tt), f * 2.005))
        s = lp(s, 380 + 500 * np.exp(-0.0)) * env_exp(dd, 0.12)
        place(x, s * 0.55, at)
    # drums
    for bar in range(bars):
        b0 = bar * 4 * beat
        for k, amp in [(0, 1.0), (1.5, 0.8), (3, 0.9), (3.5, 0.6 if bar % 2 else 0.0)]:
            if amp:
                place(x, taiko() * amp * 0.9, b0 + k * beat)
        for s16 in range(16):
            tick = hp(noise(0.04), 5000) * env_exp(0.04, 0.008) * (0.12 if s16 % 4 else 0.2)
            place(x, tick, b0 + s16 * beat / 4)
    # dissonant tremolo strings, swelling in the second half
    cl = sum(osc_saw(np.full(n, f) * (1 + 0.003 * math.sin(i))) for i, f in enumerate((220.0, 233.1, 329.6, 349.2)))
    trem = 0.55 + 0.45 * np.sin(2 * np.pi * 12 * t)
    swell = 0.25 + 0.75 * np.clip((t - d * 0.35) / (d * 0.5), 0, 1)
    strings = lp(cl, 2200) * trem * swell * 0.18
    x = x + strings
    # rising glide in the last quarter
    gl = osc_sin(np.clip(440 + 440 * (t - d * 0.75) / (d * 0.25), 440, 880)) * np.clip((t - d * 0.75) / (d * 0.25), 0, 1) * 0.06
    x = x + gl
    wet = convolve(x, cave_ir(1.6, bright=4000), circular=True)
    y = x * 0.8 + wet / np.abs(wet).max() * np.abs(x).max() * 0.25
    return norm(y, 0.85)


def standoff_music():
    d = 24.0
    t = t_axis(d)

    def part(f):
        return np.sin(2 * np.pi * round(f * d) / d * t)
    x = (part(55) * 0.5 + part(58.27) * 0.35 + part(82.4) * 0.2) * (0.7 + 0.3 * np.sin(2 * np.pi * t / d))
    hits = np.zeros(len(t))
    for at, f in [(1.0, 440), (7.5, 466.2), (13.0, 329.6), (19.0, 311.1)]:
        bell = damped(f, 1.2, 3.0) + 0.4 * damped(f * 2.76, 0.6, 3.0) + 0.2 * damped(f * 5.4, 0.3, 3.0)
        place(hits, bell * 0.25, at)
    sw = stft_shape(noise(d), lambda f, tt: peaks(f, [(350 + 150 * math.sin(tt * 0.5), 300, 1.0)])) * 0.08
    y = x + hits + sw
    wet = convolve(y, cave_ir(3.0, bright=2500), circular=True)
    return norm(y * 0.7 + wet / np.abs(wet).max() * np.abs(y).max() * 0.45, 0.75)


# ----------------------------------------------------------------------------- export
SOUNDS = {
    # event: (generator, variants, category, kwargs for sound_definitions)
    'shaftbreaker.step': (step, 4, 'hostile', {'volume': 0.9, 'min_distance': 2, 'max_distance': 28}),
    'shaftbreaker.scrape': (scrape, 3, 'hostile', {'volume': 0.8, 'max_distance': 32}),
    'shaftbreaker.smash': (smash, 3, 'hostile', {'volume': 1.0, 'max_distance': 48}),
    'shaftbreaker.screech': (screech, 2, 'hostile', {'volume': 1.0, 'max_distance': 64}),
    'shaftbreaker.roar': (roar, 2, 'hostile', {'volume': 1.0, 'max_distance': 72}),
    'shaftbreaker.roar_cut': (lambda v: roar(v, cut=0.85 + 0.1 * v), 2, 'hostile', {'volume': 1.0, 'max_distance': 64}),
    'shaftbreaker.swing': (swing, 3, 'hostile', {'volume': 0.7, 'max_distance': 16}),
    'shaftbreaker.growl': (growl, 3, 'hostile', {'volume': 0.8, 'max_distance': 28}),
    'shaftbreaker.collapse': (collapse, 1, 'hostile', {'volume': 1.0, 'max_distance': 48}),
    'shaftbreaker.chew': (chew, 2, 'hostile', {'volume': 0.6, 'max_distance': 16}),
    'shaftbreaker.hurt': (hurt, 3, 'hostile', {'volume': 0.9, 'max_distance': 32}),
    'shaftbreaker.click': (click, 3, 'hostile', {'volume': 0.55, 'max_distance': 24}),
    'shaftbreaker.breath': (breath, 3, 'hostile', {'volume': 0.5, 'max_distance': 14}),
    'shaftbreaker.knock': (knock, 2, 'hostile', {'volume': 0.9, 'max_distance': 48}),
    'shaftbreaker.pickaxe': (pickaxe, 3, 'hostile', {'volume': 0.75, 'max_distance': 40}),
    'shaftbreaker.pstep': (pstep, 3, 'hostile', {'volume': 0.45, 'max_distance': 20}),
    'shaftbreaker.distant_impact': (distant_impact, 2, 'hostile', {'volume': 1.0, 'max_distance': 96}),
    'shaftbreaker.call': (call, 2, 'hostile', {'volume': 0.8, 'max_distance': 96}),
    'shaftbreaker.creak': (creak, 3, 'ambient', {'volume': 0.6, 'max_distance': 24}),
    'shaftbreaker.debris_fall': (debris_fall, 2, 'hostile', {'volume': 0.7, 'max_distance': 24}),
    'shaftbreaker.vanish': (vanish, 2, 'hostile', {'volume': 0.6, 'max_distance': 24}),
    'shaftbreaker.heartbeat': (heartbeat, 1, 'player', {'volume': 0.8}),
    'shaftbreaker.drone': (drone_loop, 1, 'ambient', {'volume': 0.6}),
    'shaftbreaker.room_tone': (room_tone, 2, 'ambient', {'volume': 0.45}),
    'shaftbreaker.sting_soft': (sting_soft, 1, 'player', {'volume': 0.55}),
    'shaftbreaker.trophy_hum': (trophy_hum, 1, 'player', {'volume': 0.25}),
    'shaftbreaker.dial': (dial, 1, 'ui', {'volume': 0.6}),
    'shaftbreaker.moth_flutter': (flutter, 2, 'neutral', {'volume': 0.35, 'max_distance': 10}),
    'music.shaftbreaker.chase': (lambda v: chase_music(), 1, 'music', {'volume': 0.75, 'stream': True}),
    'music.shaftbreaker.standoff': (lambda v: standoff_music(), 1, 'music', {'volume': 0.6, 'stream': True}),
}


def write_ogg(x, path):
    x = np.clip(x, -1, 1)
    pcm = (x * 32767).astype('<i2')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
        tmp = tf.name
    with wave.open(tmp, 'wb') as wv:
        wv.setnchannels(1); wv.setsampwidth(2); wv.setframerate(SR); wv.writeframes(pcm.tobytes())
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libvorbis', '-q:a', '4', path], check=True)
    os.unlink(tmp)


def build(only=None):
    os.makedirs(OUT, exist_ok=True)
    defs = {}
    for ev, (gen, nv, cat, opts) in SOUNDS.items():
        base = ev.replace('music.shaftbreaker.', 'music_').replace('shaftbreaker.', '')
        files = []
        for v in range(nv):
            name = f'{base}_{v + 1}' if nv > 1 else base
            path = os.path.join(OUT, name + '.ogg')
            if only is None or base in only or not os.path.exists(path):
                write_ogg(gen(v), path)
            entry = {'name': f'sounds/shaftbreaker/{name}'}
            for k in ('volume', 'stream'):
                if k in opts:
                    entry[k] = opts[k]
            files.append(entry)
        d = {'category': cat, 'sounds': files}
        if 'max_distance' in opts:
            d['max_distance'] = opts['max_distance']
        if 'min_distance' in opts:
            d['min_distance'] = opts['min_distance']
        defs[ev] = d
    json.dump({'format_version': '1.14.0', 'sound_definitions': defs}, open(os.path.join(RP, 'sounds/sound_definitions.json'), 'w'), indent=2)
    json.dump({'entity_sounds': {'entities': {
        'shaftbreaker:shaftbreaker': {'volume': 1.0, 'pitch': [0.9, 1.05], 'events': {'hurt': 'shaftbreaker.hurt', 'death': 'shaftbreaker.collapse'}},
        'shaftbreaker:shaft_moth': {'volume': 0.6, 'pitch': [0.9, 1.2], 'events': {'ambient': 'shaftbreaker.moth_flutter'}},
    }}}, open(os.path.join(RP, 'sounds.json'), 'w'), indent=2)
    print('sounds:', len(defs))


if __name__ == '__main__':
    import sys
    build(set(sys.argv[1].split(',')) if len(sys.argv) > 1 else None)
