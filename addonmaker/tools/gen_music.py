"""Renders Mobsmith's five original background tracks (each 2+ minutes).

Everything is synthesized from scratch with numpy (additive / FM / subtractive
synthesis, noise drums, convolution reverb) from algorithmic compositions, then
encoded to Ogg Vorbis with ffmpeg. Deterministic: same output every run.

    python3 addonmaker/tools/gen_music.py [outdir]
"""
import math
import os
import subprocess
import sys
import wave

import numpy as np

SR = 32000
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'src', 'main', 'assets', 'www', 'music')


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def n_of(sec):
    return max(1, int(sec * SR))


def env(n, a=0.01, d=0.1, s=0.7, r=0.2):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    s_n = max(0, n - a_n - d_n - r_n)
    parts = []
    if a_n:
        parts.append(np.linspace(0, 1, a_n, endpoint=False))
    if d_n:
        parts.append(np.linspace(1, s, d_n, endpoint=False))
    parts.append(np.full(s_n, s))
    if r_n:
        parts.append(np.linspace(s, 0, r_n))
    e = np.concatenate(parts)
    return np.pad(e, (0, max(0, n - len(e))))[:n]


def decay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def phase(f, n, ph=0.0):
    if np.isscalar(f):
        return (ph + f * np.arange(n) / SR) % 1.0
    return (ph + np.cumsum(f) / SR) % 1.0


def saw(f, n, ph=0.0):
    return 2 * phase(f, n, ph) - 1


def square(f, n, duty=0.5):
    return np.where(phase(f, n) < duty, 1.0, -1.0)


def tri(f, n):
    return 4 * np.abs(phase(f, n) - 0.5) - 1


def sine(f, n, ph=0.0):
    return np.sin(2 * np.pi * phase(f, n, ph / (2 * np.pi)))


def lowpass(x, cutoff, order=2):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / cutoff) ** (2 * order)), len(x))


def highpass(x, cutoff, order=2):
    X = np.fft.rfft(x)
    f = np.maximum(np.fft.rfftfreq(len(x), 1 / SR), 1e-3)
    return np.fft.irfft(X / np.sqrt(1 + (cutoff / f) ** (2 * order)), len(x))


class Track:
    def __init__(self, seconds, seed):
        self.n = n_of(seconds)
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n)
        self.rng = np.random.default_rng(seed)

    def add(self, t, x, pan=0.0, gain=1.0):
        i = int(t * SR)
        if i >= self.n:
            return
        x = x[: self.n - i] * gain
        lg, rg = math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)
        self.L[i:i + len(x)] += x * lg * 1.414
        self.R[i:i + len(x)] += x * rg * 1.414

    def noise(self, n):
        return self.rng.uniform(-1, 1, n)

    # ---------- instruments ----------
    def pad(self, t, notes, dur, gain=0.12, cutoff=1400, pan=0.0, attack=0.8, release=1.6):
        n = n_of(dur + release)
        for k, m in enumerate(notes):
            f = mtof(m)
            for det, p in ((-0.0045, -0.5), (0.0, 0.0), (0.0052, 0.5)):
                x = saw(f * (1 + det), n, self.rng.random())
                x = lowpass(x, cutoff) * env(n, attack, 0.3, 0.8, release)
                self.add(t, x, max(-1, min(1, pan + p * 0.6)), gain / len(notes))

    def pluck(self, t, m, dur=1.2, gain=0.25, pan=0.0, bright=1.0):
        n = n_of(dur)
        f = mtof(m)
        tt = np.arange(n) / SR
        x = np.zeros(n)
        for k in range(1, 11):
            if f * k > SR / 2.2:
                break
            x += (1 / k) * np.sin(2 * np.pi * f * k * tt + k) * np.exp(-tt * (1.8 + k * 1.3 / bright))
        x[: n_of(0.004)] += self.noise(n_of(0.004)) * 0.3
        self.add(t, x * env(n, 0.002, 0.0, 1.0, 0.05), pan, gain)

    def bell(self, t, m, dur=3.0, gain=0.18, pan=0.0, ratio=3.5, index=4.0):
        n = n_of(dur)
        f = mtof(m)
        tt = np.arange(n) / SR
        idx = index * np.exp(-tt / 0.6) + 0.2
        x = np.sin(2 * np.pi * f * tt + idx * np.sin(2 * np.pi * f * ratio * tt))
        self.add(t, x * decay(n, dur / 3.2) * env(n, 0.003, 0, 1, 0.08), pan, gain)

    def musicbox(self, t, m, dur=2.0, gain=0.16, pan=0.0):
        n = n_of(dur)
        f = mtof(m)
        tt = np.arange(n) / SR
        x = (np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.9) + 0.35 * np.sin(2 * np.pi * f * 3.01 * tt) * np.exp(-tt / 0.25)
             + 0.2 * np.sin(2 * np.pi * f * 5.43 * tt) * np.exp(-tt / 0.12))
        x *= 1 + 0.12 * np.sin(2 * np.pi * 5.1 * tt)
        self.add(t, x * env(n, 0.001, 0, 1, 0.05), pan, gain)

    def lead(self, t, m, dur, gain=0.11, pan=0.0, duty=0.5, vib=0.22, cutoff=2600):
        n = n_of(dur)
        tt = np.arange(n) / SR
        fv = mtof(m) * 2 ** ((vib * np.sin(2 * np.pi * 5.5 * tt) * np.clip((tt - 0.12) * 5, 0, 1)) / 12)
        x = np.where(phase(fv, n) < duty, 1.0, -1.0)
        x = lowpass(x, cutoff, 2) * env(n, 0.005, 0.08, 0.7, min(0.08, dur * 0.3))
        self.add(t, x, pan, gain)

    def tri_bass(self, t, m, dur, gain=0.3, pan=0.0):
        n = n_of(dur)
        self.add(t, tri(mtof(m), n) * env(n, 0.003, 0.05, 0.85, 0.04), pan, gain)

    def synth_bass(self, t, m, dur, gain=0.28, pan=0.0, cutoff=900):
        n = n_of(dur)
        f = mtof(m)
        raw = saw(f, n) * 0.7 + square(f / 2, n) * 0.3
        bright, dark = lowpass(raw, cutoff * 2.5), lowpass(raw, cutoff * 0.35)
        fe = decay(n, 0.09)
        self.add(t, (bright * fe + dark * (1 - fe)) * env(n, 0.003, 0.05, 0.8, 0.03), pan, gain)

    def drone(self, t, m, dur, gain=0.2, pan=0.0):
        n = n_of(dur)
        f = mtof(m)
        tt = np.arange(n) / SR
        x = sine(f, n) + 0.5 * sine(f * 1.5, n) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * tt))
        x += 0.25 * lowpass(saw(f * 1.002, n), 300)
        self.add(t, x * env(n, 3.0, 0.5, 0.9, 4.0), pan, gain)

    def choir(self, t, notes, dur, gain=0.1, pan=0.0):
        n = n_of(dur + 1.5)
        tt = np.arange(n) / SR
        for m in notes:
            f = mtof(m) * (1 + 0.004 * np.sin(2 * np.pi * 4.6 * tt + m))
            x = np.zeros(n)
            for k, a in ((1, 1.0), (2, 0.5), (3, 0.35), (4, 0.25), (5, 0.12)):
                x += a * np.sin(2 * np.pi * np.cumsum(f * k) / SR)
            self.add(t, lowpass(x, 1800) * env(n, 1.2, 0.3, 0.8, 1.5), pan, gain / len(notes))

    def wind(self, t, dur, gain=0.08, pan=0.0):
        n = n_of(dur)
        tt = np.arange(n) / SR
        x = lowpass(highpass(self.noise(n), 300), 1400)
        x *= 0.5 + 0.5 * np.sin(2 * np.pi * (0.05 + self.rng.random() * 0.05) * tt + self.rng.random() * 6) ** 2
        self.add(t, x * env(n, 2.5, 0, 1, 2.5), pan, gain)

    def kick(self, t, gain=0.55):
        n = n_of(0.35)
        tt = np.arange(n) / SR
        f = 45 + 85 * np.exp(-tt / 0.04)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.13)
        x[: n_of(0.003)] += 0.4
        self.add(t, x, 0, gain)

    def snare(self, t, gain=0.3, pan=0.05):
        n = n_of(0.25)
        tt = np.arange(n) / SR
        x = highpass(self.noise(n), 1200) * np.exp(-tt / 0.07) + 0.5 * np.sin(2 * np.pi * 185 * tt) * np.exp(-tt / 0.05)
        self.add(t, x, pan, gain)

    def hat(self, t, gain=0.08, pan=0.2, length=0.05):
        n = n_of(length * 3)
        x = highpass(self.noise(n), 6500) * decay(n, length)
        self.add(t, x, pan, gain)

    def clank(self, t, gain=0.12, pan=-0.3):
        n = n_of(0.4)
        tt = np.arange(n) / SR
        x = np.sin(2 * np.pi * 310 * tt + 7 * np.sin(2 * np.pi * 1130 * tt)) * np.exp(-tt / 0.11)
        x += highpass(self.noise(n), 3000) * np.exp(-tt / 0.03) * 0.4
        self.add(t, x, pan, gain)

    def heartbeat(self, t, gain=0.5):
        for dt, g in ((0, 1.0), (0.22, 0.7)):
            n = n_of(0.3)
            tt = np.arange(n) / SR
            f = 38 + 30 * np.exp(-tt / 0.05)
            self.add(t + dt, lowpass(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.09), 200), 0, gain * g)

    # ---------- mastering ----------
    def render(self, path, reverb=0.25, ir_len=2.4, fade_in=1.5, fade_out=4.0, air=11000):
        mix = []
        for ch in (0, 1):
            dry = self.L if ch == 0 else self.R
            n_ir = n_of(ir_len)
            ir = lowpass(self.rng.uniform(-1, 1, n_ir), 5000) * np.exp(-np.arange(n_ir) / (0.45 * SR))
            ir[: n_of(0.012)] = 0
            ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
            size = 1 << int(np.ceil(np.log2(len(dry) + n_ir)))
            wet = np.fft.irfft(np.fft.rfft(dry, size) * np.fft.rfft(ir, size), size)[: len(dry)]
            mix.append(lowpass(highpass(dry + wet * reverb * 6, 28), air, 2))
        x = np.stack(mix)
        fi, fo = n_of(fade_in), n_of(fade_out)
        x[:, :fi] *= np.linspace(0, 1, fi)
        x[:, -fo:] *= np.linspace(1, 0, fo)
        x /= np.max(np.abs(x)) + 1e-9
        x = np.tanh(x * 1.15) / np.tanh(1.15) * 0.92
        pcm = (x.T * 32767).astype('<i2')
        wav = path + '.wav'
        with wave.open(wav, 'wb') as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '1.5', path + '.ogg'], check=True)
        os.remove(wav)
        print(f'{os.path.basename(path)}.ogg  {len(self.L) / SR:.0f}s  {os.path.getsize(path + ".ogg") / 1024:.0f} KB', flush=True)


# ------------------------------------------------------------------ tracks
def lantern_glow(path):
    """Calm creator theme: pads, plucked arpeggios and a bell melody (C major / F lydian)."""
    bpm, beat = 76, 60 / 76
    prog = [[48, 55, 64, 67], [45, 52, 60, 64], [41, 48, 57, 64], [43, 50, 59, 62],
            [41, 48, 57, 64, 71], [43, 50, 59, 62], [40, 47, 55, 59], [45, 52, 60, 64]]
    bars = 64
    T = Track(bars * 4 * beat + 6, 11)
    mel_a = [76, 74, 72, 74, 76, 79, 76, 74, 72, 71, 72, 74, 72, None, 69, 71]
    mel_b = [79, 81, 79, 76, 74, 76, 72, None, 74, 76, 77, 76, 74, 72, 71, 72]
    for bar in range(bars):
        t0 = bar * 4 * beat
        ch = prog[bar % len(prog)]
        sec = bar // 8
        T.pad(t0, ch, 4 * beat, gain=0.14, cutoff=1100 + 300 * (sec % 3))
        if bar >= 4:
            arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[-1] + 12]
            for i in range(8):
                if sec in (4,) and i % 2:
                    continue
                T.pluck(t0 + i * beat / 2, arp[[0, 1, 2, 3, 2, 1, 2, 3][i]], 1.4, gain=0.16, pan=(-0.4 if i % 2 else 0.4))
        if 8 <= bar < 56 and sec not in (4,):
            mel = mel_a if (bar // 4) % 2 == 0 else mel_b
            for i in range(4):
                m = mel[(bar % 4) * 4 + i]
                if m and (bar % 2 == 0 or i % 2 == 0):
                    T.bell(t0 + i * beat, m - (12 if sec == 5 else 0), 2.6, gain=0.11, pan=0.15, ratio=2.0, index=2.0)
        T.tri_bass(t0, ch[0] - 12, 2 * beat, gain=0.18)
        T.tri_bass(t0 + 2 * beat, ch[0] - 12 + (7 if bar % 2 else 0), 2 * beat, gain=0.14)
    T.render(path, reverb=0.32)


def deepslate_drift(path):
    """Dark cave ambience: drones, wind, distant bells, a heartbeat that comes and goes (D minor)."""
    dur = 150
    T = Track(dur, 23)
    scale = [62, 65, 67, 69, 72, 74, 77]
    for t in range(0, dur - 10, 24):
        T.drone(t, 38, 30, gain=0.22)
        T.drone(t + 12, 45 if (t // 24) % 2 else 43, 26, gain=0.12, pan=0.3)
        T.wind(t + T.rng.random() * 6, 18, gain=0.07, pan=T.rng.uniform(-0.7, 0.7))
    t = 6.0
    while t < dur - 8:
        m = scale[T.rng.integers(len(scale))] - (12 if T.rng.random() < 0.4 else 0)
        T.bell(t, m, 5.0, gain=0.09, pan=T.rng.uniform(-0.8, 0.8), ratio=2.76, index=3.0)
        if T.rng.random() < 0.3:
            T.bell(t + 0.18, m + 3, 4.0, gain=0.05, pan=T.rng.uniform(-0.8, 0.8), ratio=2.76, index=3.0)
        t += T.rng.uniform(3.5, 7.5)
    for start, end, bpm in ((40, 70, 58), (100, 128, 66)):
        x = start
        while x < end:
            T.heartbeat(x, gain=0.35 + 0.25 * (x - start) / (end - start))
            x += 60 / bpm
    for t0, notes in ((30, [50, 53, 56]), (64, [49, 52, 55, 58]), (96, [50, 51, 57]), (124, [38, 50, 53, 57])):
        T.choir(t0, notes, 12, gain=0.16, pan=-0.2)
    T.render(path, reverb=0.45, ir_len=3.2, fade_in=4, fade_out=8)


def cobble_run(path):
    """Upbeat chiptune: square lead, triangle bass, arpeggios and noise drums (G major, key change)."""
    bpm = 144
    beat = 60 / bpm
    prog = [[55, 59, 62], [52, 55, 59], [48, 52, 55], [50, 54, 57]]
    motif = [[0, 2, 4, 7, 4, 2, 4, None], [9, 7, 4, 2, 4, None, 2, 0], [0, 2, 4, 2, 0, -1, 0, None], [7, 9, 11, 12, 11, 9, 7, None]]
    major = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16]
    bars = 84
    T = Track(bars * 4 * beat + 4, 37)

    def deg(d, root):
        if d is None:
            return None
        o, i = divmod(d, 7)
        return root + 12 * o + major[i] if d >= 0 else root - 1

    for bar in range(bars):
        t0 = bar * 4 * beat
        key = 0 if bar < 64 else 2
        ch = [m + key for m in prog[bar % 4]]
        sec = bar // 16
        T.tri_bass(t0, ch[0] - 12, beat * 0.9)
        T.tri_bass(t0 + beat, ch[0] - 12, beat * 0.4)
        T.tri_bass(t0 + 1.5 * beat, ch[0] - 5, beat * 0.4)
        T.tri_bass(t0 + 2 * beat, ch[0] - 12, beat * 0.9)
        T.tri_bass(t0 + 3 * beat, ch[0] - 10 if bar % 2 else ch[0] - 7, beat * 0.9)
        if bar >= 2:
            for i in range(16):
                T.lead(t0 + i * beat / 4, ch[i % 3] + 12, beat / 4 * 0.8, gain=0.03, pan=-0.45, duty=0.25, vib=0, cutoff=1800)
        if bar >= 4:
            for b in range(4):
                if b in (0, 2) or (sec >= 2 and b == 3 and bar % 2):
                    T.kick(t0 + b * beat, gain=0.4)
                if b in (1, 3):
                    T.snare(t0 + b * beat, gain=0.22)
                for h in (0, 0.5):
                    T.hat(t0 + (b + h) * beat, gain=0.03 if h else 0.045)
        if 8 <= bar < 80 and sec != 3:
            phrase = motif[(bar // 2) % 4] if sec != 4 else motif[(bar // 2 + 2) % 4]
            half = bar % 2
            for i in range(4):
                d = phrase[half * 4 + i]
                if d is not None:
                    m = deg(d, 67 + key + (12 if sec == 4 else 0))
                    T.lead(t0 + i * beat, m, beat * (1.9 if i == 3 else 0.95), gain=0.075, pan=0.2, duty=0.5)
        if sec == 3:
            for i in range(8):
                T.pluck(t0 + i * beat / 2, ch[(i * 2) % 3] + 24, 0.5, gain=0.08, pan=0.3)
    T.render(path, reverb=0.14, ir_len=1.2, air=8000)


def moonlit_hollow(path):
    """Eerie music-box waltz in 3/4 with pizzicato bass, wind and a low choir (A minor)."""
    bpm = 96
    beat = 60 / bpm
    prog = [[57, 60, 64], [52, 56, 59], [57, 60, 64], [50, 53, 57], [53, 57, 60], [52, 56, 59], [57, 60, 64], [52, 56, 59]]
    tune = [[76, 72, 69], [71, 68, 64], [72, 76, 81], [77, 74, 69], [72, 69, 65], [71, 68, 64], [69, 72, 76], [75, 71, 68]]
    bars = 80
    T = Track(bars * 3 * beat + 6, 51)
    for bar in range(bars):
        t0 = bar * 3 * beat
        ch = prog[bar % 8]
        sec = bar // 16
        T.pluck(t0, ch[0] - 24, 1.4, gain=0.28, bright=0.6)
        for b in (1, 2):
            T.pluck(t0 + b * beat, ch[1] - 12, 0.6, gain=0.1, pan=-0.3, bright=0.8)
            T.pluck(t0 + b * beat, ch[2] - 12, 0.6, gain=0.1, pan=0.3, bright=0.8)
        if sec != 2:
            notes = tune[bar % 8]
            for i, m in enumerate(notes):
                detune = 0.3 if sec >= 3 else 0
                T.musicbox(t0 + i * beat, m + (12 if sec == 1 else 0) + detune * (i == 2), 2.2, gain=0.15, pan=0.25)
        else:
            if bar % 2 == 0:
                T.choir(t0, [ch[0] - 12, ch[1] - 12, ch[2] - 12], 6 * beat, gain=0.18)
        if bar % 4 == 0:
            T.pad(t0, [m - 12 for m in ch], 12 * beat, gain=0.06, cutoff=700, attack=1.5)
        if bar % 8 == 0:
            T.wind(t0, 10, gain=0.05 + 0.03 * (sec >= 2))
    T.render(path, reverb=0.4, ir_len=3.0, fade_out=6)


def forge_pulse(path):
    """Driving synthwave/industrial: 16th-note bass sequencer, gated pads, clanks (E minor)."""
    bpm = 108
    beat = 60 / bpm
    prog = [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]]
    lead = [[71, 69, 67, 64], [67, 69, 71, 74], [76, 74, 71, 69], [69, 71, 74, 78]]
    bars = 76
    T = Track(bars * 4 * beat + 5, 77)
    for bar in range(bars):
        t0 = bar * 4 * beat
        ch = prog[bar % 4]
        sec = bar // 12
        breakdown = sec == 3
        for i in range(16):
            if breakdown and i % 4:
                continue
            m = ch[0] - 24 + (12 if i % 4 == 2 else 0) + (7 if i == 14 else 0)
            T.synth_bass(t0 + i * beat / 4, m, beat / 4 * 0.9, gain=0.2, cutoff=500 + 120 * (sec % 4))
        for g in range(8):
            T.pad(t0 + g * beat / 2, ch, beat / 2 * 0.7, gain=0.05, cutoff=1800, attack=0.01, release=0.08)
        if not breakdown and bar >= 4:
            for b in range(4):
                T.kick(t0 + b * beat, gain=0.45)
                if b in (1, 3):
                    T.snare(t0 + b * beat, gain=0.25)
                T.hat(t0 + (b + 0.5) * beat, gain=0.04)
                if b == 3 and bar % 2:
                    T.clank(t0 + (b + 0.75) * beat, gain=0.1)
        if bar >= 24 and not breakdown:
            ph = lead[(bar // 2) % 4]
            for i in range(4):
                if (bar % 2 == 0) or i < 2:
                    T.lead(t0 + i * beat, ph[i], beat * 0.9, gain=0.05, pan=0.25, duty=0.33, vib=0.15)
        if breakdown and bar % 2 == 0:
            T.choir(t0, [ch[0], ch[1], ch[2] + 12], 8 * beat, gain=0.12)
    T.render(path, reverb=0.18, ir_len=1.8, air=8500)


TRACKS = [
    ('lantern_glow', lantern_glow),
    ('deepslate_drift', deepslate_drift),
    ('cobble_run', cobble_run),
    ('moonlit_hollow', moonlit_hollow),
    ('forge_pulse', forge_pulse),
]

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    only = os.environ.get('ONLY')
    for name, fn in TRACKS:
        if only and name != only:
            continue
        fn(os.path.join(OUT, name))
