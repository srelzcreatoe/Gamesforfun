"""Original procedural sound design for the Shaftbreaker (numpy DSP -> OGG Vorbis via ffmpeg).
Every sound here is synthesized from scratch; nothing is sampled from any game or add-on."""
import os, json, subprocess, math, tempfile, wave, zlib
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


def swing(v):
    d = 0.42
    n = noise(d)
    x = stft_shape(n, lambda f, tt: peaks(f, [(500 + 2400 * math.sin(math.pi * min(1, tt / d)) + 100 * v, 700, 1.0)]))
    return fade(norm(x * np.hanning(len(x)) ** 0.8))


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


def neck_crack(v):
    """bone popping under strain: a quick ratchet of sharp cracks over a dry grinding creak"""
    d = 1.1
    x = np.zeros(int(d * SR))
    grind = stft_shape(noise(0.55), lambda f, tt: peaks(f, [(700 + 400 * tt, 300, 1.0), (2300, 600, 0.5)])) * env_adsr(0.55, 0.05, 0.2, 0.7, 0.25)
    place(x, grind * 0.22, 0.04)
    at = 0.05
    for k in range(4 + v):
        n = int(0.012 * SR)
        burst = hp(noise(0.012), 1800) * np.exp(-np.linspace(0, 9, n))
        pop = damped(160 + 60 * R.random(), 0.018, 0.05)
        place(x, burst * (0.9 + 0.3 * R.random()), at)
        place(x, pop * 0.55, at)
        at += 0.045 + R.random() * (0.05 if k < 3 else 0.12)
    return fade(norm(reverb(x, 0.18, 0.7)[:int(d * SR)]))


def step_soft(v):
    """the creature's own slow, heavy footfall: stone thud + a claw tick + grit"""
    d = 0.55
    t = t_axis(d)
    thump = osc_sin(46 + 22 * np.exp(-t / 0.025)) * env_exp(d, 0.11 + 0.02 * v)
    body = lp(noise(d), 520) * env_exp(d, 0.06)
    x = thump * 0.9 + body * 0.5
    place(x, damped(1700 + 300 * v, 0.008, 0.05) * 0.25, 0.03 + 0.01 * v)       # claw tick
    place(x, grains(0.25, 14, 1500, 5200, size=0.003, decay=0.05) * 0.35, 0.02)
    return fade(norm(lp(x, 3800)))


def loopify(x, xf=0.08):
    """crossfade the tail into the head so the loop point is continuous"""
    L = int(xf * SR)
    y = x[:-L].copy()
    r = np.linspace(0, 1, L)
    y[:L] = x[:L] * r + x[-L:] * (1 - r)
    return y


# ============================================================================= v3: the horror pass
# Everything below is original synthesis: no samples, no borrowed melodies (the lullaby and the chase motif
# are written for this add-on). Loop rule for the music: a loop is rendered on a circular timeline. Events
# are wrap-placed (their tails fold back onto the head), beds are filtered circularly, LFOs run whole cycles
# per loop, reverb is circular and the limiter's gain envelope wraps, so the last sample runs into the first.

def midi(m):
    return 440.0 * 2 ** ((np.asarray(m, float) - 69) / 12)


def nsamp(d):
    return int(round(d * SR))


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))) + 1e-12)


def ramp(t, pts):
    """piecewise-linear curve through (time, value) points"""
    a = np.asarray(pts, float)
    return np.interp(t, a[:, 0], a[:, 1])


def bell(t, c, w):
    return np.exp(-0.5 * ((np.asarray(t) - c) / w) ** 2)


def cfilt(x, gain):
    """zero-phase FFT filter with no padding: circular, so a loop stays seamless"""
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(np.fft.rfft(x) * gain(f), len(x))


def clp(x, fc, n=2):
    return cfilt(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * n)))


def chp(x, fc, n=2):
    return cfilt(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * n)))


def cbp(x, lo, hi, n=2):
    return chp(clp(x, hi, n), lo, n)


def snoise(n, fc):
    """smooth random curve with unit deviation (jitter, drift, gusts); circular"""
    y = clp(R.standard_normal(n), fc, 2)
    return y / (np.std(y) + 1e-12)


def pink(n):
    f = np.fft.rfftfreq(n, 1 / SR); f[0] = f[1]
    y = np.fft.irfft(np.fft.rfft(R.standard_normal(n)) / np.sqrt(f), n)
    return y / (np.std(y) + 1e-12)


def brown(n):
    f = np.fft.rfftfreq(n, 1 / SR); f[0] = f[1]
    y = np.fft.irfft(np.fft.rfft(R.standard_normal(n)) / f, n)
    return y / (np.std(y) + 1e-12)


def cstft(x, fn, n=2048):
    """stft_shape for a loop: the edges wrap so the result stays seamless"""
    P = 2 * n; L = len(x); d = L / SR
    xp = np.concatenate([x[-P:], x, x[:P]])
    return stft_shape(xp, lambda f, t: fn(f, (t - P / SR) % d), n, n // 4)[P:P + L]


def wplace(dst, src, at):
    """place() on a loop: whatever runs past the end folds back onto the start"""
    L = len(dst); i = int(round(at * SR)) % L; k = 0
    while k < len(src):
        m = min(len(src) - k, L - i)
        dst[i:i + m] += src[k:k + m]; k += m; i = 0
    return dst


def read_at(x, pos, wrap=False):
    n = len(x); i0 = np.floor(pos).astype(np.int64); fr = pos - i0
    if wrap:
        i0 = i0 % n
        return x[i0] * (1 - fr) + x[(i0 + 1) % n] * fr
    y = np.zeros(len(pos)); ok = (i0 >= 0) & (i0 < n - 1)
    y[ok] = x[i0[ok]] * (1 - fr[ok]) + x[i0[ok] + 1] * fr[ok]
    return y


def varispeed(x, rate):
    """a tape transport at a time-varying speed: pitch and tempo bend together (output length = len(rate))"""
    return read_at(x, np.concatenate([[0.0], np.cumsum(rate[:-1])]))


def tape_stop(x, at, length, curve=1.4):
    """from `at` seconds the motor dies and the tape grinds to a halt over `length` seconds"""
    s = nsamp(at); m = nsamp(length)
    r = np.concatenate([np.ones(s), (1 - np.linspace(0, 1, m, endpoint=False)) ** curve])
    return varispeed(x, r) * np.concatenate([np.ones(s), np.linspace(1, 0, m) ** 0.6])


def wow(x, depth=0.004, rate=0.4, flutter=0.0001, frate=6.0, drift=0.0, wrap=False):
    """tape wow / flutter / drift as a modulated delay line (depths in seconds)"""
    n = len(x); t = np.arange(n) / SR; d = n / SR
    if wrap:
        rate = max(1, round(rate * d)) / d; frate = max(1, round(frate * d)) / d
    dl = depth * (1 - np.cos(2 * np.pi * rate * t)) + flutter * (1 - np.cos(2 * np.pi * frate * t + 1.1))
    if drift:
        dl = dl + drift * (snoise(n, 0.35) + 3)
    return read_at(x, np.arange(n) - dl * SR, wrap)


def crush(x, rate=8000, bits=6):
    """sample-rate reduction (sample & hold) + bit reduction; expects roughly +-1 input"""
    n = len(x)
    idx = np.minimum((np.floor(np.arange(n) * rate / SR) * SR / rate).astype(np.int64), n - 1)
    q = 2 ** (bits - 1)
    return np.round(x[idx] * q) / q


def stutter(x, at, size, reps, decay=1.0, crush_rate=None):
    """buffer-repeat glitch: the slice at `at` is repeated `reps` times over what follows"""
    y = x.copy(); s = nsamp(at); m = max(16, nsamp(size))
    seg = x[s:s + m].copy()
    if crush_rate:
        pk = np.abs(seg).max() + 1e-9
        seg = crush(seg / pk, crush_rate, 5) * pk
    for k in range(reps):
        i = s + k * m
        if i + m > len(y):
            break
        y[i:i + m] = seg * decay ** k
    return y


def drive(x, amt=3.0, asym=0.0):
    """tanh waveshaper (asym adds even harmonics)"""
    return (np.tanh(amt * x + asym) - np.tanh(asym)) / np.tanh(amt + abs(asym))


def fold(x, amt=1.5):
    return np.sin(0.5 * np.pi * amt * x)


def softclip(x, ceil=0.86, knee=0.9):
    k = knee * ceil; a = np.abs(x); over = a > k
    y = x.copy()
    y[over] = np.sign(x[over]) * (k + (ceil - k) * np.tanh((a[over] - k) / (ceil - k)))
    return y


def comb(x, delay_fn, g=0.8, n=1024, wrap=False):
    """metallic ring: the magnitude response of a feedback comb whose delay (s) moves with time"""
    fn = lambda f, t: (1 - g) / np.abs(1 - g * np.exp(-2j * np.pi * f * delay_fn(t)))
    return cstft(x, fn, n) if wrap else stft_shape(x, fn, n, n // 4)


def saw(f0):
    """band-limited (polyBLEP) sawtooth for a per-sample frequency array"""
    dt = np.clip(np.asarray(f0, float) / SR, 1e-7, 0.45)
    ph = np.cumsum(dt) % 1.0
    y = 2 * ph - 1
    m = ph < dt; u = ph[m] / dt[m]; y[m] -= u + u - u * u - 1
    m = ph > 1 - dt; u = (ph[m] - 1) / dt[m]; y[m] -= u * u + u + u + 1
    return y


def glottal(f0, oq=0.6, sub=0.0, shimmer=0.0, skew=0.72):
    """glottal-flow-derivative pulse train (Rosenberg pulses). `sub` (scalar or per-sample, 0..1) alternates the
    length and strength of every other cycle -> period doubling / subharmonics; `shimmer` randomises each
    cycle's strength (vocal fry). Returns (source, flow)."""
    n = len(f0)
    sub = np.broadcast_to(np.asarray(sub, float), (n,))
    ph = np.cumsum(f0) / SR
    if np.any(sub > 0):
        k = np.floor(ph).astype(np.int64)
        ph = np.cumsum(f0 * (1 + 0.35 * sub * np.where(k % 2 == 0, 1.0, -1.0))) / SR
    k = np.floor(ph).astype(np.int64); p = ph - k
    tp = oq * skew; tn = oq * (1 - skew)
    g = np.where(p < tp, 0.5 * (1 - np.cos(np.pi * p / tp)), np.where(p < tp + tn, np.cos(0.5 * np.pi * (p - tp) / tn), 0.0))
    amp = np.maximum(1 + shimmer * R.standard_normal(k.max() + 2)[k], 0.05) * (1 - 0.55 * sub * (k % 2))
    flow = g * amp
    src = np.diff(flow, prepend=0.0)
    return src / (np.abs(src).max() + 1e-12), flow / (flow.max() + 1e-12)


def voice(f0, formants, oq=0.6, sub=0.0, shimmer=0.1, jit=0.01, breath=0.1, n=1024, floor=0.004):
    """source-filter voice: glottal pulses (+ flow-modulated aspiration) through time-varying formants.
    formants: list or fn(t) -> [(freq, bandwidth, amp), ...]"""
    L = len(f0)
    f0 = np.maximum(f0 * (1 + jit * snoise(L, 60)), 8)
    src, flow = glottal(f0, oq, sub, shimmer)
    asp = chp(R.standard_normal(L), 600) * (0.35 + flow)
    x = src / rms(src) + breath * asp / rms(asp)
    fm = formants if callable(formants) else (lambda tt: formants)
    y = stft_shape(x, lambda f, tt: peaks(f, fm(tt)) + floor, n, n // 4)
    return y / (np.abs(y).max() + 1e-12)


def gated_rms(x):
    """loudness over 400 ms blocks with a -20 dB relative gate (silences don't drag it down)"""
    w = nsamp(0.4); m = len(x) // w
    if m < 3:
        return rms(x)
    b = np.mean(x[:m * w].reshape(m, w) ** 2, axis=1)
    keep = b > b.mean() * 0.01
    return float(np.sqrt(b[keep].mean()) + 1e-12)


def at_rms(x, dbfs):
    return x * (10 ** (dbfs / 20) / gated_rms(x))


def limiter(x, ceil=0.86, release=0.15, wrap=False, blk=32):
    """look-ahead peak limiter (block gain computer, instant attack, smooth release) + soft clip safety"""
    n = len(x); nb = -(-n // blk)
    a = np.zeros(nb * blk); a[:n] = np.abs(x)
    if wrap and nb * blk > n:
        a[n:] = np.abs(x[:nb * blk - n])
    g = np.minimum(1.0, ceil / np.maximum(a.reshape(nb, blk).max(1), 1e-9))
    gm = g.copy()
    for s in (1, 2):
        gm = np.minimum(gm, np.minimum(np.roll(g, s), np.roll(g, -s)))
    c = 1 - math.exp(-blk / (release * SR))
    out = np.empty(nb); st = 1.0
    for _ in range(2 if wrap else 1):
        for i in range(nb):
            st = min(gm[i], st + (1 - st) * c); out[i] = st
    padded = np.concatenate([out[-1:], out, out[:1]]) if wrap else np.concatenate([out[:1], out, out[-1:]])
    sm = np.convolve(padded, np.ones(3) / 3, 'valid')
    gi = np.interp(np.arange(n), np.arange(nb) * blk + blk / 2, sm)
    return softclip(x * gi, ceil)


def band_limit(x, c, wrap=False):
    """steep 15.5 kHz low-pass after the limiter (nothing up there but fizz, and it makes Vorbis overshoot),
    then make sure the ceiling still holds"""
    x = clp(x, 15500, 8) if wrap else lp(x, 15500, 8)
    m = np.abs(x).max()
    return x * (c / m) if m > c else x


def master_fx(x, level=None, ceil_db=-1.5):
    """one-shot mastering: DC/rumble cut, then either peak-normalise or push to a loudness and limit"""
    x = lp(hp(x, 28), 15500, 8)
    c = 10 ** (ceil_db / 20)
    if level is None:
        return norm(x, c * 0.97)
    for _ in range(6):
        x = limiter(at_rms(x, level), c, release=0.06)
    return band_limit(x, c)


MUSIC_LUFSISH = -15.0   # every music track is mastered to the same gated RMS (dBFS)


def calm_start(x, look=0.02):
    """rotate a loop by up to `look` s so the file starts, and the loop point falls, on a quiet zero crossing just
    before the downbeat instead of on a transient (the loop content is circular, so this changes nothing else)"""
    L = len(x); r = np.arange(1, nsamp(look)); k = L - r
    return np.roll(x, int(r[np.argmin(np.abs(x[k]) + np.abs(x[k] - x[k - 1]))]))


def master_music(x, target=MUSIC_LUFSISH, ceil_db=-1.5, wrap=True):
    x = clp(chp(x, 24), 15500, 8) if wrap else lp(hp(x, 24), 15500, 8)
    c = 10 ** (ceil_db / 20)
    for _ in range(5):
        x = limiter(at_rms(x, target), c, wrap=wrap)
    x = band_limit(x, c, wrap)
    return calm_start(x) if wrap else x


def creverb(x, wet=0.3, rt=2.0, bright=2500):
    """circular cave reverb for loops, wet level matched by RMS"""
    y = convolve(x, cave_ir(rt, bright=bright), circular=True)
    return x * (1 - 0.5 * wet) + y * (rms(x) / rms(y)) * wet


def echoes(x, taps):
    """distant tunnel echoes: (delay s, gain, lowpass Hz) taps"""
    out = np.zeros(len(x) + nsamp(max(tp[0] for tp in taps)) + 1)
    out[:len(x)] += x
    for dl, g, fc in taps:
        place(out, lp(x, fc) * g, dl)
    return out


# ----------------------------------------------------------------------------- instruments
def tine(m, d=2.6, vel=1.0, cents=0.0, bright=1.0):
    """music-box comb tooth / toy-piano rod: clamped-bar partials (1 : 6.27 : 17.55) + a pluck tick"""
    f = float(midi(m)) * 2 ** (cents / 1200); n = nsamp(d); t = np.arange(n) / SR; x = np.zeros(n)
    sus = 1.6 * (1.25 - 0.5 * min(1.0, f / 1600))
    for r, a, dc in ((1.0, 1.0, 1.0), (2.0, 0.05, 0.45), (6.27, 0.3 * bright, 0.16), (17.55, 0.1 * bright, 0.04)):
        if f * r < 15000:
            x += a * np.sin(2 * np.pi * f * r * t + R.random() * 6.283) * np.exp(-t / (dc * sus))
    x *= np.minimum(1, t / 0.0012)
    k = nsamp(0.004); x[:k] += R.standard_normal(k) * np.hanning(k) * 0.1 * bright
    return x * vel


def piano(m, d=4.0, vel=0.8, cents=0.0, hammer=1.0):
    """additive piano: stretched (inharmonic) partials, three slightly detuned strings, two-stage decay"""
    f = float(midi(m)) * 2 ** (cents / 1200); n = nsamp(d); t = np.arange(n) / SR; x = np.zeros(n)
    B = 0.0003 * 2 ** ((m - 60) / 24)
    T = 3.2 * 2 ** (-(m - 48) / 20) + 0.4
    for k in range(1, int(min(60, 11000 / f)) + 1):
        fk = k * f * math.sqrt(1 + B * k * k)
        a = vel ** (0.3 + 0.07 * k) / k ** 0.9 * (0.25 + abs(math.sin(math.pi * k * 0.13)))
        dk = T / (1 + 0.3 * (k - 1))
        e = 0.55 * np.exp(-t / (dk * 0.18)) + 0.45 * np.exp(-t / dk)
        for s in (-1, 0, 1):
            x += a / 3 * np.sin(2 * np.pi * fk * 2 ** (s * 0.9 * (0.7 + 0.6 * R.random()) / 1200) * t + R.random() * 6.283) * e
    x *= np.minimum(1, t / 0.002)
    k = nsamp(0.05)
    x[:k] += lp(R.standard_normal(k), 1200 + 2500 * vel) * np.exp(-np.arange(k) / (0.008 * SR)) * 0.12 * hammer * vel * (np.abs(x).max() + 1e-9)
    return x


def bowed(f0, pont=0.0, vib=5.6, depth=0.004):
    """bowed string: band-limited saw + bow noise through a violin-ish body; pont -> glassy sul ponticello"""
    n = len(f0); t = np.arange(n) / SR
    f = f0 * (1 + depth * np.sin(2 * np.pi * (vib + 0.5 * R.random()) * t + R.random() * 6.28) + 0.0015 * snoise(n, 3))
    x = saw(f) + chp(R.standard_normal(n), 1800) * (0.04 + 0.3 * pont) * (1 + 0.5 * snoise(n, 30))
    body = [(290, 140, 1.0), (480, 180, 0.8), (1100, 400, 0.55), (2700, 700, 0.45 + 0.7 * pont), (4300, 1200, 0.12 + 0.7 * pont)]
    return spec_filter(x, lambda fq: peaks(fq, body) + 0.03 + 0.25 * pont * (fq > 2200))


VOWELS = {'a': [(800, 110, 1.0), (1150, 120, 0.5), (2900, 150, 0.25), (3900, 200, 0.12)],
          'o': [(450, 90, 1.0), (800, 100, 0.55), (2830, 150, 0.12), (3800, 200, 0.06)],
          'u': [(325, 80, 1.0), (700, 90, 0.4), (2530, 150, 0.08)],
          'e': [(400, 90, 1.0), (1600, 110, 0.5), (2700, 150, 0.3), (3300, 200, 0.15)]}


def choir(notes, d, vowel='o', voices=3, spread=14, breath=0.2, vib=0.005):
    """a small, far, slightly out-of-tune choir: detuned saw voices with vibrato through vowel formants"""
    n = nsamp(d); t = np.arange(n) / SR; x = np.zeros(n)
    for m in notes:
        for _ in range(voices):
            f = float(midi(m)) * 2 ** (R.uniform(-spread, spread) / 1200)
            f = f * (1 + vib * np.sin(2 * np.pi * (4.5 + R.random()) * t + R.random() * 6.28) + 0.003 * snoise(n, 1.5))
            x += saw(f) * (0.75 + 0.25 * np.sin(2 * np.pi * R.uniform(0.1, 0.3) * t + R.random() * 6.28))
    x = x / (np.std(x) + 1e-9) + breath * R.standard_normal(n)
    fm = VOWELS[vowel] if isinstance(vowel, str) else vowel
    return lp(spec_filter(x, lambda f: peaks(f, fm) + 0.002), 5000)


def rev_swell(x, length, rt=2.6, bright=2800):
    """reverse-reverb swell: the sound's own reverb played backwards, ending abruptly on its (reversed) attack"""
    y = reverb(x, 0.88, rt, bright=bright)[::-1]
    k = min(len(y), nsamp(length))
    y = y[-k:].copy()
    y *= np.linspace(0, 1, k) ** 1.6
    y[-nsamp(0.004):] *= np.linspace(1, 0, nsamp(0.004))
    return y


def crackle(n, rate=6.0, pops=0.3):
    """vinyl / old tape crackle (circular)"""
    x = np.zeros(n)
    k = R.poisson(rate * n / SR); i = R.integers(0, n, k)
    x[i] += R.choice([-1.0, 1.0], k) * np.minimum(3, 0.2 + R.pareto(2.5, k) * 0.3)
    x = chp(convolve(x, np.exp(-np.arange(nsamp(0.0006)) / (SR * 0.00015)), circular=True), 900)
    kp = R.poisson(pops * n / SR); ip = R.integers(0, n, kp)
    y = np.zeros(n); y[ip] = R.choice([-1.0, 1.0], kp) * (1 + R.random(kp))
    y = clp(convolve(y, np.exp(-np.arange(nsamp(0.004)) / (SR * 0.0012)), circular=True), 2500)
    return x + y * 0.6


def shepard(L, base=27.5, N=8):
    """endless rising Shepard-Risset glissando, one octave per loop; phases are handed from each partial to
    the next one up so the loop point is exactly continuous"""
    d = L / SR; t = np.arange(L) / SR; x = np.zeros(L)
    c = 2 * np.pi * base * d / math.log(2)
    ph0 = R.random() * 6.283
    for i in range(N):
        ph = ph0 + c * 2 ** i * (2 ** (t / d) - 1)
        x += (0.5 - 0.5 * np.cos(2 * np.pi * (i + t / d) / N)) * np.sin(ph)
        ph0 = ph0 + c * 2 ** i
    return x


# ----------------------------------------------------------------------------- the lullaby (original)
# 3/4, B minor, with a sour flat-two (C) and flat-five (F) so it never quite resolves. (bar, beat, midi, beats)
LULLABY = [(0, 0, 78, 1), (0, 1, 74, 1), (0, 2, 71, 1),
           (1, 0, 72, 3),
           (2, 0, 74, 1), (2, 1, 76, 1), (2, 2, 77, 1),
           (3, 0, 76, 2), (3, 2, 70, 1),
           (4, 0, 71, 1), (4, 1, 78, 1), (4, 2, 79, 1),
           (5, 0, 78, 1), (5, 1, 77, 1), (5, 2, 74, 1),
           (6, 0, 72, 1), (6, 1, 71, 1), (6, 2, 70, 1),
           (7, 0, 71, 3)]
LULL_BASS = [(0, 59, [62, 66]), (1, 60, [64, 67]), (2, 55, [59, 62]), (3, 54, [58, 64]),
             (4, 59, [62, 66]), (5, 55, [59, 62]), (6, 54, [60, 64]), (7, 47, [])]


def box_phrase(beat, notes=None, bass=True, transpose=0, cents=-30.0, skip=(), drop=(), double=0.0, vel=0.9, slop=0.012):
    """the lullaby on a cheap, out-of-tune music box (dry). skip/drop index into `notes`."""
    notes = LULLABY if notes is None else notes
    b0 = min(nt[0] for nt in notes); b1 = max(nt[0] for nt in notes)
    x = np.zeros(nsamp((b1 - b0 + 1) * 3 * beat + 3.0))
    for i, (b, bt, m, du) in enumerate(notes):
        if i in skip:
            continue
        at = ((b - b0) * 3 + bt) * beat + abs(R.normal(0, slop))
        c = cents + R.normal(0, 9)
        mm = m + transpose - (12 if i in drop else 0)
        place(x, tine(mm, 2.8, vel * (0.8 + 0.3 * R.random()), c), at)
        if double:
            place(x, tine(mm + 12, 2.0, vel * double, c + 38), at + 0.021)   # a second, wrongly tuned comb
    if bass:
        for b, m, dy in LULL_BASS:
            if b0 <= b <= b1:
                at = (b - b0) * 3 * beat
                place(x, tine(m + transpose, 3.0, 0.5, cents + R.normal(0, 12), 0.6), at + 0.004)
                for k in (1, 2):
                    for mm in dy:
                        place(x, tine(mm + transpose, 2.2, 0.2 if k == 1 else 0.15, cents + R.normal(0, 14), 0.5), at + k * beat + 0.006)
    return x


# ----------------------------------------------------------------------------- creature voice
def _scream(d, crack, base=1.0):
    """inhuman scream with a broken-voice crack: a register flip up, a chaotic subharmonic burst, then it falls
    back below where it was. A detuned growl two octaves under it makes it sound like two throats."""
    n = nsamp(d); t = np.arange(n) / SR; c = crack
    f0 = ramp(t, [(0, 400), (0.12, 820), (0.35, 960), (c, 1060), (c + 0.002, 1580), (c + 0.1, 1480),
                  (c + 0.102, 880), (d - 0.3, 800), (d, 500)]) * base
    f0 = f0 * (1 + 0.035 * np.sin(2 * np.pi * 10.5 * t) + 0.02 * snoise(n, 18))
    sub = ramp(t, [(0, 0.3), (0.1, 0.1), (c - 0.01, 0.15), (c, 1.0), (c + 0.13, 0.8), (c + 0.2, 0.2), (d - 0.25, 0.3), (d, 0.9)])
    hi = voice(f0, [(1150, 320, 1.0), (2500, 380, 0.95), (3600, 500, 0.7), (5000, 900, 0.35)],
               oq=0.42, sub=sub, shimmer=0.28, jit=0.03, breath=0.55, n=512)
    lo = voice(f0 / 4, [(520, 170, 1.0), (900, 210, 0.8), (1800, 300, 0.45), (2700, 400, 0.3)],
               oq=0.7, sub=0.7, shimmer=0.4, jit=0.04, breath=0.3, n=1024)
    x = hi + 0.4 * lo + hp(R.standard_normal(n), 1800) * bell(t, c + 0.04, 0.03) * 0.8
    met = comb(x, lambda tt: 0.0017 + 0.0005 * math.sin(2 * math.pi * 2.7 * tt), g=0.86, n=1024)
    return x + 0.6 * met / (np.abs(met).max() + 1e-9), t


def screech(v):
    """the rage scream before a chase"""
    d = (1.15, 1.0, 1.2)[v % 3]
    x, t = _scream(d, (0.55, 0.45, 0.62)[v % 3], (1.0, 1.12, 0.9)[v % 3])
    env = np.minimum(1, t / 0.035) * ramp(t, [(0, 1), (d - 0.28, 1), (d, 0)]) ** 1.5
    x = hp(lp(drive(x / rms(x) * 0.35 * env, 5.0, 0.3), 10500), 180)
    y = reverb(x, 0.22, 1.3, bright=3500)[:nsamp(d + 0.3)]
    return fade(master_fx(y, -12), 0.002, 0.12)


ROAR_V = [
    dict(f0=[(0, 58), (0.26, 72), (0.6, 112), (1.1, 140), (1.5, 122), (1.9, 90), (2.3, 60), (2.7, 52)], ratio=5.2, scream=0.6, peak=1.15, sw=0.34),
    dict(f0=[(0, 46), (0.26, 58), (0.7, 82), (1.3, 104), (1.7, 92), (2.1, 66), (2.4, 48), (2.7, 44)], ratio=5.6, scream=0.38, peak=1.45, sw=0.3),
    dict(f0=[(0, 62), (0.26, 82), (0.55, 132), (0.95, 172), (0.97, 236), (1.35, 226), (1.38, 150), (1.9, 100), (2.3, 66), (2.7, 56)],
         ratio=4.6, scream=0.9, peak=1.12, sw=0.42),
]


def roar_dry(v):
    """inhale + reverse swell, sub impact, then the roar: a guttural, fry-laden growl with period-doubling
    subharmonics through open-mouth formants, a shriek blended in at the peak, and a comb-filtered metallic
    screech, all waveshaped together"""
    P = ROAR_V[v % 3]; T0 = 0.26; d = 2.7
    n = nsamp(d); t = np.arange(n) / SR
    f0 = ramp(t, P['f0']) * (1 + 0.03 * np.sin(2 * np.pi * 5.3 * t) * bell(t, P['peak'], 0.4))
    sub = ramp(t, [(0, 0.9), (T0, 0.85), (0.8, 0.45), (1.5, 0.5), (2.0, 0.9), (2.7, 1.0)])
    opn = [(0, 0.2), (T0, 0.35), (0.8, 1.0), (1.8, 1.0), (2.3, 0.35), (2.7, 0.2)]

    def fm(tt):
        o = float(ramp(tt, opn))
        return [(360 + 220 * o, 150, 1.0), (760 + 300 * o, 200, 0.85), (1650 + 300 * o, 300, 0.55), (2600, 420, 0.4), (3600, 650, 0.25)]
    body = voice(f0, fm, oq=0.75, sub=sub, shimmer=0.3, jit=0.016, breath=0.3, n=2048)
    body *= 1 + 0.25 * snoise(n, 40)                                            # roughness
    sbh = lp(saw(f0 / 2), 320) * 0.6 + np.sin(2 * np.pi * np.cumsum(f0 / 3) / SR) * 0.4   # subharmonic floor
    turb = stft_shape(R.standard_normal(n), lambda f, tt: peaks(f, fm(tt)) + 0.01, 2048, 512)
    fs = f0 * P['ratio'] * (1 + 0.04 * np.sin(2 * np.pi * 9.5 * t) + 0.025 * snoise(n, 14))
    scr = voice(fs, [(1100, 320, 1.0), (2400, 380, 0.9), (3500, 480, 0.7), (4800, 850, 0.4)],
                oq=0.45, sub=0.25, shimmer=0.2, jit=0.015, breath=0.25, n=1024)
    senv = P['scream'] * bell(t, P['peak'], P['sw'])
    met = comb(scr * 0.7 + hp(R.standard_normal(n), 1500) * 0.3, lambda tt: 0.0024 - 0.0009 * min(1.0, tt / 1.8), g=0.88)
    met = bp(met, 900, 9000)
    env = np.clip((t - T0) / 0.025, 0, 1) * ramp(t, [(0, 1), (1.85, 1), (2.25, 0.0), (2.7, 0)]) ** 1.3 * (0.82 + 0.18 * bell(t, P['peak'], 0.5))
    core = (body / rms(body) + sbh / rms(sbh) * 0.45 * sub + turb / rms(turb) * 0.2
            + scr / rms(scr) * senv * 2.2 + met / rms(met) * senv * 0.45) * env
    x = drive(core * 0.35, 2.6, 0.2) * 0.8 + fold(core * 0.12, 1.4) * 0.2
    x = hp(lp(x, 9500), 35)
    # sub impact on the onset, kept clean of the distortion
    on = (t >= T0).astype(float); tb = np.clip(t - T0, 0, None)
    imp = np.sin(2 * np.pi * np.cumsum((28 + 80 * np.exp(-tb / 0.05)) * on) / SR) * np.exp(-tb / 0.33) * on
    imp = drive(imp, 1.8) + lp(R.standard_normal(n), 180) * np.exp(-tb / 0.05) * on * 0.5
    # the breath in, and the roar's own reverb pulled backwards into the onset
    k = nsamp(T0)
    ih = stft_shape(R.standard_normal(k), lambda f, tt: peaks(f, [(900 + 1600 * tt / T0, 600, 1.0), (2800, 900, 0.4)]) + 0.01, 1024, 256)
    ih *= (np.arange(k) / k) ** 2
    rs = rev_swell(x[k:k + nsamp(0.45)], T0 + 0.02, rt=1.2)
    pre = np.zeros(n)
    place(pre, ih / (np.abs(ih).max() + 1e-9) * 0.22, 0.0)
    place(pre, rs / (np.abs(rs).max() + 1e-9) * 0.45, 0.0)
    return x + imp * 0.55 + pre, t


def roar(v, cut=None):
    dry, t = roar_dry(v)
    if cut:   # cut off mid-roar: the throat slams shut, only the tunnel answers for a moment
        x = dry[:nsamp(cut)].copy(); k = nsamp(0.006); x[-k:] *= np.linspace(1, 0, k)
        y = reverb(x, 0.12, 0.5, bright=2500)[:nsamp(cut + 0.08)]
        return fade(master_fx(y, -11), 0.002, 0.03)
    y = reverb(dry, 0.3, 1.7, bright=3000)[:nsamp(2.7)]
    return fade(master_fx(y, -11.5), 0.002, 0.3)


def growl(v):
    """deep, wet, menacing: a fry-heavy low growl with period doubling, a rattling throat, gurgling bubbles
    and saliva crackle"""
    d = 1.15; n = nsamp(d); t = np.arange(n) / SR
    base = (54, 47, 60)[v % 3]
    f0 = base * (1 + 0.08 * np.sin(2 * np.pi * (0.8 + 0.25 * v) * t + v) + 0.03 * snoise(n, 6)) * ramp(t, [(0, 0.85), (0.25, 1.0), (0.9, 1.04), (d, 0.82)])
    sub = 0.55 + 0.35 * (0.5 + 0.5 * np.sin(2 * np.pi * 3.1 * t + v))
    fm = lambda tt: [(340 + 50 * math.sin(tt * 4 + v), 140, 1.0), (660 + 60 * math.sin(tt * 3), 180, 0.75), (1100, 250, 0.4), (2250, 380, 0.2), (3100, 500, 0.08)]
    body = voice(f0, fm, oq=0.8, sub=sub, shimmer=0.45, jit=0.05, breath=0.3, n=2048)
    body *= 1 + 0.55 * np.sin(2 * np.pi * np.cumsum(19 + 6 * snoise(n, 4)) / SR)     # throat rattle
    subo = np.sin(2 * np.pi * np.cumsum(f0 / 2) / SR)
    wet = np.zeros(n)
    for _ in range(int(34 * d)):                                                    # gurgling bubbles
        m = nsamp(R.uniform(0.008, 0.03)); tt = np.arange(m) / SR
        b = np.sin(2 * np.pi * np.cumsum(R.uniform(260, 900) * (1 + 1.2 * tt / tt[-1])) / SR) * np.exp(-tt / (m / SR / 3))
        place(wet, b * R.uniform(0.3, 1.0), R.uniform(0, d - 0.03))
    spit = np.zeros(n)
    for _ in range(int(20 * d)):                                                    # saliva crackle
        m = nsamp(R.uniform(0.0015, 0.004))
        place(spit, hp(R.standard_normal(m), 2500) * np.hanning(m) * R.uniform(0.2, 1.0), R.uniform(0, d - 0.01))
    env = np.minimum(1, t / 0.12) * ramp(t, [(0, 1), (d - 0.35, 0.9), (d, 0)])
    x = (body / rms(body) + 0.5 * subo / rms(subo) + 0.3 * bp(wet, 250, 2500) / (rms(wet) + 1e-9) + 0.22 * spit / (rms(spit) + 1e-9)) * env
    x = lp(drive(x * 0.4, 2.4, 0.15), 6500)
    y = reverb(x, 0.15, 0.8, bright=2500)[:nsamp(d + 0.1)]
    return fade(master_fx(y, -13), 0.004, 0.08)


# ----------------------------------------------------------------------------- player-side stingers / fx
def static_burst(d, rate=None):
    """TV snow: bright noise with a field-rate flicker and mains buzz, sample-and-hold crushed"""
    n = nsamp(d); t = np.arange(n) / SR
    x = hp(R.standard_normal(n), 300) * (0.8 + 0.2 * np.sign(np.sin(2 * np.pi * 59.94 * t + R.random() * 6)))
    x = lp(x, 11000) + 0.18 * lp(saw(np.full(n, 60.0)), 1800)
    return crush(x / (np.abs(x).max() + 1e-9), rate or float(R.choice([5500.0, 8000.0, 12000.0])), 7)


def static_fx(v):
    """TV static / digital glitch: chopped segments of snow, crushed snow, data tones, dropouts and stutters"""
    d = (0.75, 1.3, 1.9)[v % 3]; n = nsamp(d); x = np.zeros(n)
    at = 0.0; prev = None
    while at < d - 0.02:
        L = min(R.uniform(0.03, 0.16), d - at); m = nsamp(L); tt = np.arange(m) / SR
        kind = R.choice(['snow', 'snow', 'crushed', 'tone', 'gap', 'stutter'])
        if kind == 'crushed':
            seg = static_burst(L, R.uniform(1500, 3500)) * 0.8
        elif kind == 'tone':
            f = R.uniform(300, 2800)
            seg = np.sign(np.sin(2 * np.pi * f * tt)) * 0.45 * (1 + (R.random() < 0.5) * np.sign(np.sin(2 * np.pi * R.uniform(20, 60) * tt))) / 2 + static_burst(L) * 0.25
        elif kind == 'gap':
            seg = R.standard_normal(m) * 0.01
        elif kind == 'stutter' and prev is not None:
            sl = prev[:max(32, nsamp(R.uniform(0.008, 0.03)))]
            seg = np.tile(sl, m // len(sl) + 1)[:m]
        else:
            seg = static_burst(L) * R.uniform(0.6, 1.0)
        place(x, seg, at); prev = seg; at += L
    t = np.arange(n) / SR
    if v % 3 == 2:   # the long one dies away, stuttering
        x = stutter(x * ramp(t, [(0, 1), (d * 0.6, 1), (d, 0.25)]), d * 0.72, 0.035, 6, 0.8)
    return fade(master_fx(x, -12), 0.001, 0.03)


def jumpscare(v):
    """instant full-level hit: shriek + roar + static + a cluster stab + a sub drop, all at t=0"""
    d = (1.25, 1.1)[v % 2]; n = nsamp(d); t = np.arange(n) / SR
    fs = ramp(t, [(0, 980), (0.05, 1250), (0.4, 1150), (0.7, 1350), (d, 900)] if v == 0 else
              [(0, 1400), (0.08, 1100), (0.3, 1500), (0.32, 950), (d, 700)])
    fs = fs * (1 + 0.05 * np.sin(2 * np.pi * 13 * t) + 0.03 * snoise(n, 25))
    shriek = voice(fs, [(1200, 350, 1.0), (2600, 400, 1.0), (3700, 500, 0.8), (5200, 900, 0.45)], oq=0.4, sub=0.5, shimmer=0.4, jit=0.05, breath=0.6, n=512)
    low = voice(ramp(t, [(0, 140), (0.3, 110), (d, 70)]), [(500, 180, 1.0), (900, 220, 0.8), (1700, 300, 0.5), (2600, 400, 0.4)],
                oq=0.75, sub=0.8, shimmer=0.4, jit=0.04, breath=0.3, n=1024)
    stab = sum(saw(np.full(n, float(midi(m)) * 2 ** (R.uniform(-15, 15) / 1200))) for m in (36, 37, 42, 48, 49, 54, 55, 61))
    stab = lp(stab, 3500)
    sub = np.sin(2 * np.pi * np.cumsum(ramp(t, [(0, 120), (0.35, 40), (d, 26)])) / SR)
    snow = static_burst(d, 7000.0)
    hit = np.minimum(1, t / 0.0015)
    core = shriek / rms(shriek) + low / rms(low) * 0.8 + stab / rms(stab) * 0.5
    x = drive(core * 0.5, 4.5, 0.2) * hit * ramp(t, [(0, 1), (0.45, 0.9), (d, 0)]) ** 1.2
    x = x + snow * hit * ramp(t, [(0, 0.7), (0.25, 0.45), (0.6, 0.15), (d, 0.05)]) + drive(sub * 1.2, 2) * hit * ramp(t, [(0, 0.45), (0.8, 0.25), (d, 0)])
    x = stutter(x, d - 0.32, 0.04, 5, 0.75)
    return fade(master_fx(x, -7.5), 0.0005, 0.05)


def sting_reveal(v):
    """the moment you spot it: a reversed swell sucks into a slam (low piano cluster + violin screech cluster)"""
    d = 2.6; hit = (0.8, 0.62)[v % 2]; n = nsamp(d); x = np.zeros(n)
    hi = (88, 89, 94) if v % 2 == 0 else (87, 93, 94)
    pre = sum(piano(m, 2.5, 0.8) for m in (64, 65, 70, 71))
    sw = rev_swell(pre, hit, rt=2.2)
    k = nsamp(hit); tk = np.arange(k) / SR
    whoosh = stft_shape(R.standard_normal(k), lambda f, tt: peaks(f, [(300 + 3200 * (tt / hit) ** 2, 700, 1.0)]) + 0.01, 1024, 256) * (tk / hit) ** 3
    place(x, sw / (np.abs(sw).max() + 1e-9) * 0.6 + whoosh / (np.abs(whoosh).max() + 1e-9) * 0.35, 0.0)
    hd = d - hit; m = nsamp(hd); th = np.arange(m) / SR
    slam = sum(piano(mm, hd, 1.0, hammer=2.5) for mm in (21 + v, 22 + v, 27, 28, 33, 34))
    slam = drive(slam / np.abs(slam).max() * 1.3, 2.0)
    vi = sum(bowed(float(midi(mm)) * ramp(th, [(0, 0.94), (0.05, 1.0), (hd, 1.06)]), pont=1.0, depth=0.008) for mm in hi)
    vi = vi * np.minimum(1, th / 0.006) * np.exp(-th / 0.9)
    boom = np.sin(2 * np.pi * np.cumsum(30 + 30 * np.exp(-th / 0.08)) / SR) * np.exp(-th / 0.5)
    h = slam * 0.8 + vi / np.abs(vi).max() * 0.75 + boom * 0.6
    h = reverb(h, 0.35, 2.0, bright=3500)[:m]
    place(x, h, hit)
    return fade(master_fx(x, -11), 0.005, 0.25)


# whispered vowels (F1 lifted, as in real whispering) and fricatives
WH_VOW = [[(760, 230, 1.0), (1250, 260, 0.7), (2600, 380, 0.45), (3600, 520, 0.25)],
          [(480, 190, 0.8), (2050, 280, 1.0), (2900, 380, 0.55), (3700, 520, 0.3)],
          [(430, 180, 1.0), (880, 230, 0.6), (2500, 380, 0.22), (3500, 520, 0.1)],
          [(620, 210, 1.0), (1750, 270, 0.75), (2600, 380, 0.4), (3500, 520, 0.2)],
          [(530, 200, 1.0), (1150, 250, 0.65), (2450, 380, 0.3), (3400, 520, 0.15)]]
WH_FRIC = {'s': [(6800, 3200, 1.0), (9500, 2600, 0.5)], 'sh': [(2900, 1500, 1.0), (4600, 2200, 0.7)],
           'f': [(4500, 7000, 0.45)], 'th': [(6500, 5000, 0.5)], 'h': None}


def whisper_phrase(d, rate=4.8, intensity=1.0):
    """unintelligible whispering: syllables of fricative / plosive + gliding whispered vowel, grouped into words"""
    n = nsamp(d); x = np.zeros(n)
    at = R.uniform(0.03, 0.12)
    while at < d - 0.18:
        if R.random() < 0.18:
            at += R.uniform(0.1, 0.32)
            continue
        syl = R.uniform(0.6, 1.3) / rate
        c = str(R.choice(['s', 'sh', 'f', 'th', 'h', 't', 'k', 'p', '', '']))
        amp = R.uniform(0.5, 1.0) * intensity; cl = 0.0
        if c in WH_FRIC:
            cl = R.uniform(0.04, 0.1); m = nsamp(cl); z = R.standard_normal(m)
            z = spec_filter(z, lambda f: peaks(f, WH_FRIC[c]) + 0.02) if WH_FRIC[c] else bp(z, 500, 4000)
            place(x, z / rms(z) * np.hanning(m) ** 0.6 * amp * (0.55 if c != 'h' else 0.35), at)
        elif c in ('t', 'k', 'p'):
            m = nsamp(0.012); z = R.standard_normal(m) * np.exp(-np.arange(m) / (0.003 * SR))
            z = bp(z, {'t': 3500, 'k': 1500, 'p': 600}[c], {'t': 9000, 'k': 4500, 'p': 2500}[c])
            place(x, z / (np.abs(z).max() + 1e-9) * amp * 0.9, at); cl = 0.025
        vd = max(0.06, syl - cl); m = nsamp(vd)
        fa, fb = WH_VOW[R.integers(len(WH_VOW))], WH_VOW[R.integers(len(WH_VOW))]
        z = stft_shape(R.standard_normal(m), lambda f, tt: peaks(f, [(a[0] + (b[0] - a[0]) * min(1, tt / vd), a[1], a[2]) for a, b in zip(fa, fb)]) + 0.015, 512, 128)
        place(x, z / rms(z) * np.sin(np.pi * np.arange(m) / m) ** R.uniform(0.6, 1.4) * amp * 0.5, at + cl * 0.7)
        at += cl + vd * R.uniform(0.75, 1.0)
    return hp(lp(x, 10000), 220)


def whisper(v):
    d = (1.7, 2.3, 2.7, 1.6, 2.6, 2.1)[v % 6]
    x = whisper_phrase(d, rate=R.uniform(4.2, 5.8))
    if v in (2, 5):   # two of them, talking over each other
        place(x, whisper_phrase(d - 0.13, rate=5.5, intensity=0.8) * 0.6, 0.13)
    if v in (1, 4):   # backwards speech
        x = x[::-1].copy()
    x = reverb(x, 0.18, 0.9, bright=4500)[:nsamp(d + 0.25)]
    return fade(master_fx(x, -19), 0.01, 0.15)


def distant_scream(v):
    """someone (something) screaming far down the tunnels: filtered, echoing, mostly reverb"""
    sd = (1.5, 1.25)[v % 2]; m = nsamp(sd); t = np.arange(m) / SR
    f0 = ramp(t, [(0, 480), (0.25, 760), (0.8, 820), (sd, 560)] if v % 2 == 0 else [(0, 620), (0.15, 900), (0.5, 870), (0.56, 640), (0.7, 820), (sd, 600)])
    f0 = f0 * (1 + 0.025 * np.sin(2 * np.pi * 6.2 * t))
    sc = voice(f0, [(950, 300, 1.0), (2300, 400, 0.8), (3300, 500, 0.5)], oq=0.5, sub=0.2, shimmer=0.2, jit=0.02, breath=0.45, n=512)
    sc = bp(drive(sc * ramp(t, [(0, 0), (0.08, 1), (sd - 0.4, 0.85), (sd, 0)]), 2.0), 300, 2200)
    total = 3.8; x = np.zeros(nsamp(total))
    place(x, echoes(sc, [(0.29, 0.55, 1800), (0.61, 0.4, 1400), (0.97, 0.3, 1100), (1.5, 0.2, 900)]), 0.05)
    y = reverb(x, 0.8, 3.6, bright=1100)[:nsamp(total)]
    return fade(master_fx(y), 0.02, 0.8)


# ----------------------------------------------------------------------------- the Hollows (biome ambience)
def timber_groan(d=2.4, base=11.0, span=26.0):
    """stressed mine timber: slow stick-slip pulses through wood resonances"""
    n = nsamp(d); t = np.arange(n) / SR
    rate = np.maximum(base + span * (0.5 - 0.5 * np.cos(2 * np.pi * t / d)) ** 1.3 + 4 * snoise(n, 3), 2)
    ph = np.cumsum(rate) / SR
    imp = (np.diff(np.floor(ph), prepend=0) > 0) * (0.6 + 0.4 * R.random(n))
    res = sum(convolve(imp, damped(fq, dc, 0.25))[:n] * a for fq, dc, a in [(118, 0.05, 1.0), (265, 0.03, 0.7), (610, 0.012, 0.45), (1350, 0.005, 0.25)])
    res = res / (np.abs(res).max() + 1e-9) + 0.12 * bp(R.standard_normal(n), 300, 1500) * rate / rate.max()
    return res * np.sin(np.pi * t / d) ** 0.5


def hollows_loop(v):
    """deep wind moaning through the shafts, sub rumble, creaking timber (seamless 32 s loop)"""
    L = nsamp(32.0); d = L / SR; t = np.arange(L) / SR
    w = lambda k, ph=0.0: np.sin(2 * np.pi * k / d * t + ph)                 # whole cycles per loop
    gust = np.clip(0.55 + 0.25 * w(2, 0.4) + 0.15 * w(3, 2.0) + 0.1 * w(5, 1.0), 0.08, None) ** 1.5
    fc = lambda tt: 190 + 45 * math.sin(2 * math.pi * 2 * tt / d) + 20 * math.sin(2 * math.pi * 5 * tt / d + 1)
    moan = cstft(pink(L), lambda f, tt: peaks(f, [(fc(tt), 22, 1.0), (2.17 * fc(tt) + 30 * math.sin(2 * math.pi * 3 * tt / d), 35, 0.45), (0.5 * fc(tt), 15, 0.5)]) + 0.01, 4096)
    air = clp(pink(L), 700) * np.roll(gust, nsamp(3.0))
    rumble = clp(brown(L), 55) + 0.3 * w(round(29 * d))
    tim = np.zeros(L)
    for at, dd in ((5.5, 2.6), (17.0, 3.2), (26.5, 2.0)):
        wplace(tim, timber_groan(dd, R.uniform(8, 14), R.uniform(18, 30)) * R.uniform(0.6, 1.0), at)
    for _ in range(3):
        wplace(tim, damped(R.uniform(2000, 3000), 0.02, 0.12) * 0.25, R.uniform(0, d))
    mix = at_rms(moan * gust, -24) + at_rms(air, -30) + at_rms(rumble, -27) + at_rms(creverb(tim, 0.5, 2.6, 1800), -30)
    mix = creverb(mix, 0.3, 3.0, 1600)
    return master_music(mix, -21)


def hollows_mood(v):
    if v % 2 == 0:   # the mine exhales: a sub swell, a gust whistling down a shaft, a far metal groan
        d = 6.5; n = nsamp(d); t = np.arange(n) / SR
        sub = np.sin(2 * np.pi * np.cumsum(ramp(t, [(0, 38), (d, 31)])) / SR) * np.sin(np.pi * t / d) ** 1.5
        gust = stft_shape(pink(n), lambda f, tt: peaks(f, [(420 - 270 * min(1, tt / d), 25, 1.0), (900 - 500 * min(1, tt / d), 60, 0.3)]) + 0.01, 4096, 1024)
        gust *= ramp(t, [(0, 0), (2.0, 1), (4.5, 0.7), (d, 0)])
        mg = sum(np.sin(2 * np.pi * np.cumsum(87 * r * ramp(t, [(0, 1.0), (d, 0.94)])) / SR + R.random() * 6) * a
                 for r, a in [(1, 1.0), (2.31, 0.6), (3.89, 0.4), (5.12, 0.25), (7.03, 0.15)])
        mg = lp(mg * (0.7 + 0.3 * np.sin(2 * np.pi * 1.7 * t)) * bell(t, 3.6, 1.0), 1500)
        x = sub / rms(sub) * 0.6 + gust / rms(gust) * 0.5 + mg / rms(mg) * 0.35
        y = reverb(x, 0.55, 3.5, bright=1500)[:n]
    else:            # voices in the rock: a reversed choir swell, a whisper inside it, a far thud
        d = 5.5; n = nsamp(d); t = np.arange(n) / SR; y = np.zeros(n)
        ch = choir([50, 51, 57], 3.5, 'u', voices=3, spread=25) * np.hanning(nsamp(3.5))
        place(y, lp(rev_swell(ch, 4.3, rt=3.0, bright=1400), 1500), 0.1)
        place(y, lp(whisper_phrase(1.8, 4.5, 0.8), 3000) * 0.08, 2.0)
        k = nsamp(1.1); tk = np.arange(k) / SR
        thud = np.sin(2 * np.pi * np.cumsum(30 + 15 * np.exp(-tk / 0.05)) / SR) * np.exp(-tk / 0.35) + lp(R.standard_normal(k), 120) * np.exp(-tk / 0.1)
        place(y, thud * 0.7, 4.4)
        y = reverb(y, 0.45, 3.2, bright=1300)[:n]
    return fade(master_fx(y, ceil_db=-3.0), 0.05, 0.6)


def pick_hit():
    d = 0.6; n = nsamp(d); t = np.arange(n) / SR
    ring = sum(np.sin(2 * np.pi * fq * (0.97 + 0.06 * R.random()) * t) * np.exp(-t / dc) * a for fq, dc, a in [(2050, 0.07, 1.0), (3330, 0.045, 0.7), (5150, 0.025, 0.4)])
    return ring * 0.4 + hp(R.standard_normal(n), 900) * np.exp(-t / 0.012) * 0.8


def wood_knock():
    d = 0.5; n = nsamp(d); t = np.arange(n) / SR
    k = sum(np.sin(2 * np.pi * fq * t) * np.exp(-t / dc) * a for fq, dc, a in [(172, 0.12, 1.0), (404, 0.06, 0.6), (760, 0.03, 0.35), (1290, 0.015, 0.2)])
    return k + lp(R.standard_normal(n), 1400) * np.exp(-t / 0.012) * 0.6


def hollows_addition(v):
    v %= 5
    if v == 0:     # a pickaxe somewhere far below; the last strike comes too late
        total = 5.0; x = np.zeros(nsamp(total))
        for at in (0.2, 1.0, 1.75, 3.05):
            place(x, pick_hit() * R.uniform(0.7, 1.0), at)
        y = reverb(echoes(lp(x, 2600), [(0.33, 0.35, 1800), (0.71, 0.2, 1200)]), 0.75, 3.2, bright=1600)[:nsamp(total)]
    elif v == 1:   # knock knock knock ... knock-knock
        total = 4.5; x = np.zeros(nsamp(total))
        for at in (0.2, 0.75, 1.3, 2.6, 2.82):
            place(x, wood_knock() * R.uniform(0.8, 1.0), at)
        y = reverb(lp(x, 1500), 0.6, 2.8, bright=1400)[:nsamp(total)]
    elif v == 2:   # an old timber groaning under the weight of the mountain
        total = 3.8; x = np.zeros(nsamp(total))
        place(x, timber_groan(3.2, 7, 22), 0.1)
        y = reverb(x, 0.35, 2.0, bright=1800)[:nsamp(total)]
    elif v == 3:   # gravel trickling down a shaft wall, a few pebbles bouncing away
        total = 3.5; n = nsamp(total); x = np.zeros(n); at = 0.05
        while at < 2.4:
            m = nsamp(R.uniform(0.002, 0.005))
            place(x, R.standard_normal(m) * np.hanning(m) * R.uniform(0.2, 1.0) * float(bell(at, 0.9, 0.6)), at)
            at += R.exponential(0.012 + 0.03 * (at > 1.6))
        for p0 in (0.5, 1.2, 1.9):
            at, g, gap = p0, 1.0, 0.16
            while g > 0.08:
                place(x, damped(R.uniform(1800, 3200), 0.008, 0.03) * g * 0.8, at)
                at += gap; gap *= 0.72; g *= 0.62
        y = reverb(bp(x, 700, 6000), 0.4, 1.8, bright=2500)[:n]
    else:          # a broken music box phrase, far off, that winds down and stops
        total = 6.5
        b = box_phrase(0.9, notes=LULLABY[:7], bass=False, cents=-60)
        b = tape_stop(b, 3.4, 1.6)
        b = wow(b, depth=0.009, rate=0.6, drift=0.003)
        x = np.zeros(nsamp(total)); place(x, hp(lp(b, 2600), 300), 0.1)
        y = reverb(x, 0.65, 3.4, bright=1500)[:nsamp(total)]
    return fade(master_fx(y, -20, ceil_db=-3.0), 0.01, 0.4)     # one shared volume, so one loudness


# ----------------------------------------------------------------------------- music
def presence_music():
    """It is near. A slowed, detuned music-box lullaby on warped tape, hiss and crackle, a sub drone, reversed
    piano swells and a far, out-of-tune choir. 24 bars of 3/4 at 56 bpm = 77.1 s, seamless."""
    beat = 60 / 56; bar = 3 * beat; L = nsamp(24 * bar); d = L / SR; t = np.arange(L) / SR
    box = np.zeros(L); pads = np.zeros(L); sw = np.zeros(L)
    # bars 1-8: the lullaby, slowed and sagging
    a = wow(box_phrase(beat, cents=-35), depth=0.0055, rate=0.31, flutter=0.00007, frate=5.3, drift=0.0025)
    wplace(box, a, 0.0)
    # bars 13-20: it comes back broken: notes missing or an octave down, a second comb a quarter-tone off,
    # two bars of nothing in the middle, and the tape sags and drags at the end
    sub = LULLABY[0:9] + LULLABY[15:19]
    b = box_phrase(beat, notes=sub, skip=(1, 5), drop=(3, 10), cents=-55, double=0.35)
    tb = np.arange(len(b)) / SR
    b = varispeed(b, 1 - 0.06 * bell(tb, 9.0, 1.6) - 0.1 * np.clip((tb - 19.5) / 5, 0, 1) ** 1.5)
    wplace(box, wow(b, depth=0.008, rate=0.42, flutter=0.0001, frate=6.1, drift=0.004), 12 * bar)
    # a single wrong plink in the empty bars
    wplace(box, tine(83, 3.0, 0.45, 45), 21.5 * bar)
    # reversed piano swells: into bar 11 (landing on a low cluster) and into the loop point
    s1 = rev_swell(sum(piano(m, 4.5, 0.75) for m in (35, 41, 48)), 3.6, rt=3.4)
    wplace(sw, s1, 10 * bar - len(s1) / SR)
    wplace(sw, reverb(piano(35, 4.0, 0.5) + piano(36, 4.0, 0.45), 0.5, 3.0)[:nsamp(6)] * 0.6, 10 * bar)
    s2 = rev_swell(sum(piano(m, 4.5, 0.7) for m in (59, 65, 70)), 4.2, rt=3.4)
    wplace(sw, s2, d - len(s2) / SR)
    # far choir
    for at, notes, vw in ((8 * bar, (59, 62, 65), 'u'), (19.5 * bar, (60, 64, 70), 'o')):
        c = choir(notes, 14.0, vw, voices=3, spread=22) * np.sin(np.pi * np.arange(nsamp(14.0)) / nsamp(14.0)) ** 2
        wplace(pads, wow(lp(c, 1800), depth=0.006, rate=0.25), at)
    # sub drone (whole cycles), hiss, crackle
    part = lambda f, ph=0.0: np.sin(2 * np.pi * round(f * d) / d * t + ph)
    dr = (part(30.87) * 0.7 + part(32.70) * 0.55 + part(61.74, 1) * 0.3 + part(46.25, 2) * 0.2 + part(92.5, 0.5) * 0.08)
    dr = drive(dr * (0.7 + 0.3 * np.sin(2 * np.pi * 2 / d * t)) * 0.8, 1.6)
    mix = at_rms(box, -18) + at_rms(sw, -21) + at_rms(pads, -27) + at_rms(dr, -24)
    mix = creverb(mix, 0.42, 3.4, 1900)
    mix = wow(mix, depth=0.0015, rate=0.2, wrap=True)
    mix = mix + at_rms(cbp(R.standard_normal(L), 1800, 9000), -46) + at_rms(crackle(L, 7, 0.25), -40)
    return master_music(mix)


def heart_hit(f_hi, f_lo, amp=1.0):
    d = 0.32; n = nsamp(d); t = np.arange(n) / SR
    f = f_lo + (f_hi - f_lo) * np.exp(-t / 0.035)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.085) * np.minimum(1, t / 0.003)
    return (x + lp(R.standard_normal(n), 160) * np.exp(-t / 0.03) * 0.35) * amp


def close_music():
    """It is close. A heartbeat ostinato, a tritone/minor-second bass cluster, tremolo string clusters, reversed
    choir, the lullaby bit-crushed, a ticking mechanism, whispers, and static that cuts everything off.
    16 bars of 4/4 at 75 bpm = 51.2 s, seamless."""
    beat = 0.8; bar = 4 * beat; L = nsamp(16 * bar); d = L / SR; t = np.arange(L) / SR
    heart = np.zeros(L)
    lub, dub = heart_hit(55, 38, 1.0), heart_hit(48, 34, 0.7)
    for k in range(64):
        g = (0.75 + 0.25 * (k >= 32)) * (1.0 if k % 4 == 0 else 0.85)
        wplace(heart, lub * g, k * beat); wplace(heart, dub * g, k * beat + 0.19)
    heart = clp(drive(heart * 1.5, 2.0), 320)
    fw = lambda f: round(f * d) / d
    drone = sum(saw(np.full(L, fw(f))) * a for f, a in ((55.0, 1.0), (58.27, 0.8), (77.78, 0.6)))
    drone = cstft(drone, lambda f, tt: 1 / np.sqrt(1 + (f / (160 + 380 * (0.5 - 0.5 * math.cos(2 * math.pi * 2 * tt / d)))) ** 4))
    strings = np.zeros(L)
    m = nsamp(4 * bar); tm = np.arange(m) / SR
    for sb in (4, 8, 12):
        s = sum(bowed(np.full(m, float(midi(mm))), pont=0.6, depth=0.003) for mm in (64, 65, 70, 71))
        s = s * (0.55 + 0.45 * np.abs(np.sin(2 * np.pi * 5 * tm))) * ramp(tm, [(0, 0), (9, 1), (12.7, 1), (12.8, 0)])
        wplace(strings, s, sb * bar)
    rch = np.zeros(L)
    for eb in (4, 8, 12, 16):
        c = choir([62, 63, 68], 3.0, 'a', voices=3, spread=20) * np.hanning(nsamp(3.0))
        r = rev_swell(c, 3.4, rt=2.2)
        wplace(rch, r, eb * bar - len(r) / SR)
    bx = box_phrase(0.8, notes=LULLABY[:9], bass=False, cents=-80)
    bx = wow(bx, depth=0.012, rate=0.5, drift=0.004)
    bx = crush(bx / np.abs(bx).max(), 4800, 5)
    box = np.zeros(L); wplace(box, bx, 8 * bar)
    ticks = np.zeros(L)
    for k in range(128):
        tk = damped(3100 if k % 2 == 0 else 2450, 0.0015, 0.02) + 0.5 * damped(5200, 0.001, 0.02)
        wplace(ticks, tk * (0.8 + 0.2 * R.random()), k * beat / 2 + R.normal(0, 0.004) + 0.01)
    wh = np.zeros(L)
    for at, rev in ((2.5 * bar, False), (6.75 * bar, True), (11.25 * bar, False), (14.0 * bar, True)):
        p = whisper_phrase(2.4, R.uniform(4.5, 5.5), 0.9)
        wplace(wh, lp(p[::-1] if rev else p, 6000), at)
    mix = (at_rms(heart, -19) + at_rms(drone, -24) + at_rms(strings, -25) + at_rms(rch, -24)
           + at_rms(box, -27) + at_rms(ticks, -36) + at_rms(wh, -31))
    mix = creverb(mix, 0.3, 2.0, 2400)
    # static that cuts everything off
    stat = np.zeros(L); mask = np.zeros(L)
    for bb, bt, dur in ((3, 2.5, 0.22), (7, 3.5, 0.35), (10, 1.5, 0.18), (14, 3.0, 0.45)):
        at = bb * bar + bt * beat
        wplace(stat, static_burst(dur) * np.hanning(nsamp(dur)) ** 0.1, at)
        wplace(mask, np.ones(nsamp(dur)), at)
    mask = np.convolve(np.concatenate([mask[-64:], mask, mask[:64]]), np.ones(129) / 129, 'same')[64:64 + L]
    mix = mix * (1 - 0.85 * mask) + at_rms(stat, -17) * 1.0
    return master_music(mix)


def standoff_music():
    """It is staring at you. A glass whine detuning against itself, a sub throb, the music box slowing down and
    stopping, glitch stutters, and two near-silences. 40 s, seamless."""
    L = nsamp(40.0); d = L / SR; t = np.arange(L) / SR

    def whole(fc):   # scale a frequency curve so it runs a whole number of cycles per loop
        c = fc.sum() / SR
        return fc * (round(c) / c)

    def osc(fc, ph=0.0):
        return np.sin(2 * np.pi * np.cumsum(whole(fc)) / SR + ph)
    cents = ramp(t, [(0, 0), (29.4, -48), (30.6, 0), (d, 0)])
    amp = ramp(t, [(0, 0.45), (4, 0.75), (29.2, 1.0), (29.6, 0.0), (33.5, 0.0), (37, 0.3), (d, 0.45)])
    shimmer = 1 + 0.07 * np.sin(2 * np.pi * round(5.1 * d) / d * t)
    whine = (osc(np.full(L, 1975.5)) + 0.9 * osc(1975.5 * 2 ** (cents / 1200), 1.0) + 0.25 * osc(np.full(L, 987.8 * 2 ** (7 / 1200)), 2.0)) * amp * shimmer
    fw = lambda f: round(f * d) / d
    throb = (np.sin(2 * np.pi * fw(36) * t) + np.sin(2 * np.pi * fw(38.5) * t + 1)) * (0.6 + 0.4 * np.sin(2 * np.pi * fw(0.45) * t))
    throb = drive(throb * 0.7, 1.5)
    press = clp(pink(L), 300) * ramp(t, [(0, 0.15), (13, 0.15), (28, 1.0), (29.6, 0.15), (d, 0.15)])
    box = np.zeros(L)
    f1 = tape_stop(box_phrase(0.95, notes=LULLABY[:9], bass=False, cents=-25), 5.6, 3.6)
    place(box, wow(f1, depth=0.006, rate=0.4, drift=0.003), 1.4)
    f2 = tape_stop(box_phrase(1.05, notes=LULLABY[9:15], bass=False, cents=-40), 1.9, 2.4)
    place(box, wow(f2, depth=0.008, rate=0.5, drift=0.003), 18.0)
    place(box, tine(95, 3.0, 0.35, 40), 36.2)
    mix = at_rms(whine, -27) + at_rms(throb, -22) + at_rms(press, -30) + at_rms(box, -18)
    mix = stutter(mix, 7.1, 0.055, 4)                               # the box skips
    mix = stutter(mix, 24.0, 0.035, 6, crush_rate=4000)
    mix = stutter(mix, 29.0, 0.022, 12, 0.93, crush_rate=3000)       # it breaks up right before the silence
    mix = creverb(mix, 0.3, 2.6, 2200)
    duck = ramp(t, [(0, 1), (10.75, 1), (10.85, 0.03), (12.7, 0.03), (13.2, 1), (29.55, 1), (29.62, 0.006), (33.4, 0.006), (34.8, 1), (d, 1)])
    mix = mix * duck
    click = np.zeros(L)
    wplace(click, damped(1300, 0.004, 0.05) + 0.4 * damped(420, 0.01, 0.05), 31.9)   # in the silence: something moved
    wplace(click, damped(1150, 0.004, 0.05) * 0.8, 32.06)
    mix = mix + click * 0.02 + at_rms(cbp(R.standard_normal(L), 1500, 8000), -54)
    return master_music(mix)


def ck_kick():
    d = 0.35; n = nsamp(d); t = np.arange(n) / SR
    f = 42 + 140 * np.exp(-t / 0.018) + 40 * np.exp(-t / 0.08)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    k = nsamp(0.004); x[:k] += hp(R.standard_normal(k), 2000) * 0.4
    return lp(drive(x * 1.8, 3.0), 8000)


def ck_snare():
    d = 0.3; n = nsamp(d); t = np.arange(n) / SR
    body = np.sin(2 * np.pi * np.cumsum(185 + 60 * np.exp(-t / 0.01)) / SR) * np.exp(-t / 0.06)
    nz = bp(R.standard_normal(n), 1500, 9000) * np.exp(-t / 0.11)
    metal = sum(np.sin(2 * np.pi * f * t + R.random() * 6) for f in (523, 812, 1157, 1693, 2433, 3511)) * np.exp(-t / 0.09) * 0.35
    return drive(body * 0.8 + nz + metal, 2.5)


def ck_hat():
    d = 0.06; n = nsamp(d); t = np.arange(n) / SR
    x = hp(R.standard_normal(n), 6500) * np.exp(-t / 0.015) + np.sin(2 * np.pi * 7600 * t) * np.exp(-t / 0.01) * 0.3
    return crush(x / np.abs(x).max(), 16000, 6)


def ck_clang():
    d = 0.6; n = nsamp(d); t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * 310 * r * t + R.random() * 6) * np.exp(-t / (0.4 / r ** 0.5)) for r in (1, 1.47, 2.09, 2.56, 3.14, 3.92, 4.6))
    x += hp(R.standard_normal(n), 1000) * np.exp(-t / 0.02) * 2
    return drive(x / np.abs(x).max() * 1.5, 2.0)


# the chase motif (original): chromatic neighbours and tritone leaps; (midi | None, eighths, bend semitones)
LEAD1 = [(71, 2), (72, 2), (71, 1), (70, 1), (67, 2),
         (76, 4), (77, 1), (76, 1), (75, 2),
         (71, 2), (72, 2), (75, 1), (76, 1), (79, 2),
         (78, 6, -1), (None, 2)]
LEAD2 = [(76, 2), (77, 2), (76, 1), (75, 1), (72, 2),
         (81, 4), (82, 1), (81, 1), (80, 2),
         (76, 1), (77, 1), (80, 1), (81, 1), (82, 2), (83, 2),
         (84, 4), (83, 2, -12), (None, 2)]
BASS_PAT = [[28] * 6 + [29, 28] + [28] * 4 + [34, 33, 28, 28],
            [28] * 6 + [29, 28] + [31, 31, 30, 30, 29, 29, 28, 27],
            [28] * 6 + [29, 28] + [28] * 4 + [34, 35, 34, 28],
            [28] * 4 + [27] * 4 + [26] * 4 + [25, 25, 26, 27]]


def lead_phrase(notes, e8, tr=0):
    """screaming detuned lead: scooped attacks, glides, delayed vibrato, bends; 3 detuned saws + sub + octave,
    vowel-ish formants, hard distortion"""
    total = sum(nt[1] for nt in notes) * e8 + 0.3
    n = nsamp(total); semi = np.full(n, np.nan); gate = np.zeros(n)
    pos = 0.0; prev = None
    for nt in notes:
        m, n8 = nt[0], nt[1]; bend = nt[2] if len(nt) > 2 else 0
        i0, i1 = nsamp(pos), nsamp(pos + n8 * e8)
        if m is not None:
            tt = np.arange(i1 - i0) / SR; dur = (i1 - i0) / SR
            start = prev if prev is not None else m + tr - 1.0
            cv = m + tr + (start - (m + tr)) * np.exp(-tt / 0.022)
            if bend:
                cv = cv + bend * np.clip((tt - 0.35 * dur) / (0.65 * dur), 0, 1) ** 2
            cv = cv + 0.25 * np.clip((tt - 0.15) / 0.2, 0, 1) * np.sin(2 * np.pi * 6.3 * tt)
            semi[i0:i1] = cv; gate[i0:i1] = 1; prev = cv[-1]
        else:
            prev = None
        pos += n8 * e8
    idx = np.where(~np.isnan(semi), np.arange(n), 0); idx = np.maximum.accumulate(idx)
    semi = semi[idx]; semi[np.isnan(semi)] = notes[0][0] + tr
    k = nsamp(0.012); gate = np.convolve(gate, np.hanning(k) / np.hanning(k).sum(), 'same')
    hz = 440 * 2 ** ((semi - 69) / 12) * (1 + 0.004 * snoise(n, 8))
    x = (saw(hz * 2 ** (-17 / 1200)) + saw(hz * 2 ** (4 / 1200)) + saw(hz * 2 ** (21 / 1200)) + 0.45 * saw(hz / 2) + 0.2 * saw(hz * 2))
    x = spec_filter(x, lambda fq: peaks(fq, [(950, 500, 1.0), (2300, 600, 0.9), (3400, 700, 0.55)]) + 0.12)
    x = drive(x / np.std(x) * 0.8, 4.5, 0.25)
    return hp(lp(x, 7500), 220) * gate


def tape_region(x, at, length):
    i = nsamp(at); m = nsamp(length)
    r = (1 - np.linspace(0, 1, m, endpoint=False)) ** 1.3
    x[i:i + m] = varispeed(x[i:i + m], r) * np.linspace(1, 0, m) ** 0.5
    return x


def chase_music():
    """The chase you cannot win: 175 bpm, distorted drums, a chugging chromatic bass, a screaming detuned lead,
    an endless Shepard riser, tape-stops, stutters and a bit-crushed breakdown. 24 bars = 32.9 s, seamless."""
    bpm = 175; beat = 60 / bpm; s16 = beat / 4; bar = 4 * beat; nb = 24
    L = nsamp(nb * bar); d = L / SR; t = np.arange(L) / SR
    drums = np.zeros(L); bass = np.zeros(L); lead = np.zeros(L); fx = np.zeros(L)
    K, S, H, C = ck_kick(), ck_snare(), ck_hat(), ck_clang()
    notes = {}
    for b in range(nb):
        b0 = b * bar; brk = 12 <= b < 16; fill = b % 4 == 3
        kicks = [0, 8] if brk else [0, 3, 6, 8, 11, 14] + ([13, 15] if fill else [])
        for s in kicks:
            wplace(drums, K * (1.0 if s in (0, 8) else 0.85), b0 + s * s16)
        for s in ([8] if brk else [4, 12]):
            wplace(drums, S * 0.9, b0 + s * s16)
        if b in (11, 23):    # snare roll into the next section, 32nds at the very end
            for s in range(8, 16):
                wplace(drums, S * (0.35 + 0.05 * s), b0 + s * s16)
            for s in range(12):
                wplace(drums, S * (0.5 + 0.04 * s), b0 + 3 * beat + s * s16 / 3)
        for s in range(16):
            if brk and s % 2:
                continue
            wplace(drums, H * (0.55 if s % 4 == 2 else 0.3), b0 + s * s16)
        if not brk and b % 4 == 0:
            wplace(drums, C, b0)
        if not brk and b % 2 == 1:
            wplace(drums, C * 0.5, b0 + 10 * s16)
        pat = BASS_PAT[b % 4]
        for s in range(16):
            if brk and s % 4:
                continue
            m = pat[s] if not brk else 28
            dur = s16 * (0.9 if not brk else 3.8)
            key = (m, round(dur, 4))
            if key not in notes:
                nn = nsamp(dur); f = float(midi(m)); tt = np.arange(nn) / SR
                x = saw(np.full(nn, f)) + 0.7 * saw(np.full(nn, f * 1.006)) + 0.4 * saw(np.full(nn, f * 2.003))
                e = np.minimum(1, tt / 0.002) * np.exp(-tt / (0.09 if not brk else 0.4)); e[-nsamp(0.004):] *= np.linspace(1, 0, nsamp(0.004))
                notes[key] = x * e
            wplace(bass, notes[key], b0 + s * s16)
    bass = clp(drive(clp(bass, 1100) * 0.6, 3.5), 4000)
    e8 = beat / 2
    for at, ph, tr in ((4, LEAD1, 0), (8, LEAD2, 0), (16, LEAD1, 1), (20, LEAD2, 1)):
        wplace(lead, lead_phrase(ph, e8, tr), at * bar)
    # endless riser + string cluster tremolo over the second half
    rise = drive(shepard(L, 27.5, 8) * 0.8, 1.6)
    m = nsamp(8 * bar); tm = np.arange(m) / SR
    st = sum(bowed(np.full(m, float(midi(mm))), pont=0.8, depth=0.004) for mm in (76, 77, 82, 83))
    st = st * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * (1 / (2 * s16)) * tm))) * ramp(tm, [(0, 0.2), (8 * bar - 0.02, 1.0), (8 * bar, 0)])
    wplace(fx, at_rms(st, -20), 16 * bar)
    # screams: a reversed one sucking into bar 17, a bit-crushed one on the breakdown
    sc, _ = _scream(1.3, 0.62)
    sc = drive(sc / np.abs(sc).max(), 3.0)
    rs = rev_swell(sc, 1.4, rt=1.4)
    wplace(fx, at_rms(rs, -18), 16 * bar - len(rs) / SR)
    wplace(fx, at_rms(crush(sc * np.minimum(1, np.arange(len(sc)) / 400), 6000, 4), -19), 12 * bar)
    mix = at_rms(drums, -17) + at_rms(bass, -19) + at_rms(lead, -19) + at_rms(rise, -27) + fx
    mix = tape_region(mix, 12 * bar - 2 * beat, 2 * beat)                     # tape-stop into the breakdown
    i0, i1 = nsamp(12 * bar), nsamp(16 * bar)
    pk = np.abs(mix[i0:i1]).max()
    mix[i0:i1] = crush(mix[i0:i1] / pk, 7000, 6) * pk                         # bit-crushed breakdown
    mix = stutter(mix, 16 * bar - beat, s16 / 2, 8)                            # buffer-repeat fill into bar 17
    mix = stutter(mix, 20 * bar - beat / 2, s16 / 3, 6, crush_rate=5000)
    mix = creverb(mix, 0.18, 1.0, 4000)
    return master_music(drive(mix / np.abs(mix).max() * 1.6, 1.3))


def hollows_music():
    """Biome music for the Hollows (~2 min): wind in the shafts, a far piano, a low beating drone, a distant
    choir, the lullaby from very far away winding down, a reversed swell into a low cluster, a metal groan."""
    d = 120.0; n = nsamp(d); t = np.arange(n) / SR
    wind = stft_shape(pink(n), lambda f, tt: peaks(f, [(170 + 40 * math.sin(tt * 0.21) + 15 * math.sin(tt * 0.53), 26, 1.0),
                                                        (390 + 50 * math.sin(tt * 0.17 + 1), 40, 0.4)]) + 0.02, 4096, 1024)
    wind *= np.clip(0.5 + 0.3 * np.sin(2 * np.pi * t / 23 + 1) + 0.2 * np.sin(2 * np.pi * t / 9.7), 0.05, None) ** 1.3
    drone = (np.sin(2 * np.pi * 55 * t) + 0.8 * np.sin(2 * np.pi * 58.27 * t + 1) + 0.3 * np.sin(2 * np.pi * 82.4 * t))
    drone = drive(drone * ramp(t, [(0, 0), (6, 1), (40, 0.7), (60, 0.3), (82, 1), (106, 0.8), (d, 0)]) * 0.6, 1.5)
    pno = np.zeros(n)
    for at, m, vel in ((8, 76, .6), (8, 45, .4), (10.5, 72, .5), (12.2, 71, .5), (15.5, 77, .55), (15.5, 46, .4), (17.5, 76, .45),
                       (19.2, 69, .5), (22.5, 68, .55), (22.5, 40, .45), (25, 64, .45), (28.5, 41, .4), (29, 74, .4), (31, 70, .45),
                       (33.5, 69, .35), (82, 57, .5), (84.5, 58, .45), (87, 52, .5), (98, 64, .3), (101, 63, .3), (104, 57, .35), (112, 88, .25)):
        place(pno, piano(m, 6.0, vel, cents=R.normal(0, 6)), at + R.normal(0, 0.03))
    cl = sum(piano(m, 7.0, 0.7) for m in (33, 34, 40))
    place(pno, rev_swell(cl, 3.5, rt=3.5), 94 - 3.5)
    place(pno, cl * 0.8, 94)
    ch = choir([57, 60, 63], 22.0, 'u', voices=3, spread=24) * np.sin(np.pi * np.arange(nsamp(22.0)) / nsamp(22.0)) ** 2
    chl = np.zeros(n); place(chl, wow(lp(ch, 1600), depth=0.006, rate=0.22), 40)
    bx = box_phrase(1.15, notes=LULLABY[:12], bass=True, transpose=-2, cents=-45)
    bx = wow(tape_stop(bx, 12.0, 3.0), depth=0.009, rate=0.35, drift=0.004)
    box = np.zeros(n); place(box, hp(lp(bx, 2200), 250), 61)
    tg = np.arange(nsamp(12.0)) / SR
    mg = sum(np.sin(2 * np.pi * np.cumsum(73 * r * ramp(tg, [(0, 1.0), (12, 0.93)])) / SR + R.random() * 6) * a
             for r, a in [(1, 1.0), (2.31, 0.6), (3.89, 0.4), (5.12, 0.25), (7.03, 0.15)])
    met = np.zeros(n); place(met, lp(mg * np.sin(np.pi * tg / 12) ** 2, 1400), 88)
    whs = np.zeros(n); place(whs, lp(whisper_phrase(2.6, 4.6, 0.7), 4000), 114)
    mix = (at_rms(wind, -29) + at_rms(drone, -28) + at_rms(pno, -19) + at_rms(chl, -27) + at_rms(box, -24)
           + at_rms(met, -29) + at_rms(whs, -36))
    mix = reverb(mix, 0.45, 4.5, bright=2000)[:n]
    mix = mix + at_rms(cbp(R.standard_normal(n), 1800, 9000), -50) + at_rms(crackle(n, 4, 0.15), -44)
    mix = mix * np.minimum(1, t / 4.0) * np.clip((d - t) / 6.0, 0, 1)
    return master_music(mix, wrap=False)


# ----------------------------------------------------------------------------- export
SOUNDS = {
    # event: (generator, variants, category, kwargs for sound_definitions)
    'shaftbreaker.step': (step, 4, 'hostile', {'volume': 0.9, 'min_distance': 2, 'max_distance': 28}),
    'shaftbreaker.scrape': (scrape, 3, 'hostile', {'volume': 0.8, 'max_distance': 32}),
    'shaftbreaker.smash': (smash, 3, 'hostile', {'volume': 1.0, 'max_distance': 48}),
    'shaftbreaker.screech': (screech, 3, 'hostile', {'volume': 1.0, 'max_distance': 64}),
    'shaftbreaker.roar': (roar, 3, 'hostile', {'volume': 1.0, 'max_distance': 72}),
    'shaftbreaker.roar_cut': (lambda v: roar(v, cut=0.92 + 0.08 * v), 2, 'hostile', {'volume': 1.0, 'max_distance': 64}),
    'shaftbreaker.swing': (swing, 3, 'hostile', {'volume': 0.7, 'max_distance': 16}),
    'shaftbreaker.growl': (growl, 3, 'hostile', {'volume': 0.85, 'max_distance': 28}),
    'shaftbreaker.collapse': (collapse, 1, 'hostile', {'volume': 1.0, 'max_distance': 48}),
    'shaftbreaker.chew': (chew, 2, 'hostile', {'volume': 0.6, 'max_distance': 16}),
    'shaftbreaker.hurt': (hurt, 3, 'hostile', {'volume': 0.9, 'max_distance': 32}),
    'shaftbreaker.click': (click, 3, 'hostile', {'volume': 0.55, 'max_distance': 24}),
    'shaftbreaker.neck_crack': (neck_crack, 2, 'hostile', {'volume': 0.85, 'max_distance': 24}),
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
    'music.shaftbreaker.chase': (lambda v: chase_music(), 1, 'music', {'volume': 0.8, 'stream': True}),
    'music.shaftbreaker.presence': (lambda v: presence_music(), 1, 'music', {'volume': 0.8, 'stream': True}),
    'music.shaftbreaker.close': (lambda v: close_music(), 1, 'music', {'volume': 0.8, 'stream': True}),
    'shaftbreaker.step_soft': (step_soft, 4, 'hostile', {'volume': 0.85, 'min_distance': 2, 'max_distance': 30}),
    'music.shaftbreaker.standoff': (lambda v: standoff_music(), 1, 'music', {'volume': 0.8, 'stream': True}),
    # v3 horror pass
    'shaftbreaker.jumpscare': (jumpscare, 2, 'player', {'volume': 1.0}),
    'shaftbreaker.sting_reveal': (sting_reveal, 2, 'player', {'volume': 0.9}),
    'shaftbreaker.static': (static_fx, 3, 'player', {'volume': 0.7}),
    'shaftbreaker.whisper': (whisper, 6, 'hostile', {'volume': 0.75, 'max_distance': 12}),
    'shaftbreaker.distant_scream': (distant_scream, 2, 'ambient', {'volume': 0.9, 'max_distance': 128}),
    'shaftbreaker.ambient.hollows.loop': (hollows_loop, 1, 'ambient', {'volume': 0.7, 'stream': True, 'is3D': False}),
    'shaftbreaker.ambient.hollows.mood': (hollows_mood, 2, 'ambient', {'volume': 0.75}),
    'shaftbreaker.ambient.hollows.additions': (hollows_addition, 5, 'ambient', {'volume': 0.55, 'is3D': False}),
    'music.shaftbreaker.hollows': (lambda v: hollows_music(), 1, 'music', {'volume': 0.65, 'stream': True}),
}

# a pack's music_definitions.json replaces the vanilla table, so the vanilla entries are carried over unchanged
VANILLA_RP = os.environ.get('VANILLA_RP', '/home/user/mojang/bedrock-samples/resource_pack')
MUSIC_DEFS = {'shaftbreaker_hollows': {'event_name': 'music.shaftbreaker.hollows', 'min_delay': 30, 'max_delay': 120}}


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, '<i2').astype(np.float64) / 32768.0


def write_ogg(x, path, q=4):
    x = np.clip(x, -1, 1)
    for _ in range(10):
        pcm = np.round(x * 32767).astype('<i2')
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
            tmp = tf.name
        with wave.open(tmp, 'wb') as wv:
            wv.setnchannels(1); wv.setsampwidth(2); wv.setframerate(SR); wv.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libvorbis', '-q:a', str(q), path], check=True)
        os.unlink(tmp)
        pk = np.abs(decode(path)).max()     # Vorbis can overshoot the PCM peak a little: keep decoded peaks <= -1 dBFS
        if pk <= 0.891:
            break
        x = x * (0.88 / pk)


def write_music_definitions():
    out = os.path.join(RP, 'sounds/music_definitions.json')
    table = {}
    for src in (os.path.join(VANILLA_RP, 'sounds/music_definitions.json'), out):
        if os.path.exists(src):
            table = json.load(open(src, encoding='utf-8'))
            break
    else:
        print('warning: vanilla music_definitions.json not found (set VANILLA_RP); writing only the Shaftbreaker entries')
    table.update(MUSIC_DEFS)
    json.dump(table, open(out, 'w'), indent=3)


def build(only=None):
    global R
    os.makedirs(OUT, exist_ok=True)
    defs = {}
    for ev, (gen, nv, cat, opts) in SOUNDS.items():
        base = ev.replace('music.shaftbreaker.', 'music_').replace('shaftbreaker.', '').replace('.', '_')
        files = []
        for v in range(nv):
            name = f'{base}_{v + 1}' if nv > 1 else base
            path = os.path.join(OUT, name + '.ogg')
            if only is None or base in only or not os.path.exists(path):
                R = np.random.default_rng(zlib.crc32(name.encode()))    # each file is reproducible on its own
                write_ogg(gen(v), path, opts.get('q', 4))
            entry = {'name': f'sounds/shaftbreaker/{name}'}
            for k in ('volume', 'stream', 'is3D'):
                if k in opts:
                    entry[k] = opts[k]
            files.append(entry)
        d = {'category': cat, 'sounds': files}
        if 'max_distance' in opts:
            d['max_distance'] = opts['max_distance']
        if 'min_distance' in opts:
            d['min_distance'] = opts['min_distance']
        defs[ev] = d
    defs['shaftbreaker.idle'] = {'category': 'hostile', 'max_distance': 24, 'sounds': [
        {'name': f'sounds/shaftbreaker/{n}', 'volume': vol} for n, vol in
        [('breath_1', 0.5), ('breath_2', 0.5), ('click_1', 0.55), ('click_2', 0.55), ('click_3', 0.55), ('growl_1', 0.45), ('growl_3', 0.45), ('step_soft_2', 0.3)]]}
    json.dump({'format_version': '1.14.0', 'sound_definitions': defs}, open(os.path.join(RP, 'sounds/sound_definitions.json'), 'w'), indent=2)
    json.dump({'entity_sounds': {'entities': {
        'shaftbreaker:shaftbreaker': {'volume': 1.0, 'pitch': [0.9, 1.05], 'events': {'hurt': 'shaftbreaker.hurt', 'death': 'shaftbreaker.collapse', 'ambient': 'shaftbreaker.idle', 'step': {'sound': 'shaftbreaker.step_soft', 'volume': 0.8, 'pitch': [0.9, 1.05]}}},
        'shaftbreaker:shaft_moth': {'volume': 0.6, 'pitch': [0.9, 1.2], 'events': {'ambient': 'shaftbreaker.moth_flutter'}},
    }}}, open(os.path.join(RP, 'sounds.json'), 'w'), indent=2)
    write_music_definitions()
    print('sounds:', len(defs))


if __name__ == '__main__':
    import sys
    build(set(sys.argv[1].split(',')) if len(sys.argv) > 1 else None)
