#!/usr/bin/env python3
"""Original synthesized sound effects, ambience loops and battle music for Dragon Block Sagas.

Fills every sound the DragonMineZ pack does not provide (block interaction, UI, ambience,
battle/boss/transformation music loops). Deterministic (seeded numpy). Output: 16-bit mono WAV
44100 Hz into game/assets/audio/{sfx,bgm}. DSP helpers adapted from legacy/cubicworld/tools/gen_sounds.py.
"""
import math, os, wave
import numpy as np

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFX = os.path.join(ROOT, "game", "assets", "audio", "sfx")
BGM = os.path.join(ROOT, "game", "assets", "audio", "bgm")
os.makedirs(SFX, exist_ok=True); os.makedirs(BGM, exist_ok=True)
rng = np.random.default_rng(0xD8A11)
written = []

def save(name, x, peak=0.85, folder=SFX):
    x = np.asarray(x, dtype=np.float64)
    m = np.max(np.abs(x))
    if m > 1e-9: x = x * (peak / m)
    x = np.clip(x, -1.0, 1.0)
    data = (x * 32767.0).astype("<i2").tobytes()
    path = os.path.join(folder, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data)
    written.append(name)

def fade_edges(x, fin=0.004, fout=0.012):
    x = x.copy(); a = min(len(x) // 2, max(8, int(fin * SR))); r = min(len(x) // 2, max(8, int(fout * SR)))
    x[:a] *= 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, a)); x[-r:] *= 0.5 + 0.5 * np.cos(np.linspace(0, math.pi, r)); return x

def env(n, attack, decay, hold=0.0):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0.0, 1.0); d = np.exp(-np.maximum(t - attack - hold, 0.0) / max(decay, 1e-4)); return a * d

def filt(x, lo=None, hi=None, order=4):
    n = len(x); spec = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1.0 / SR); mask = np.ones_like(f)
    if lo is not None: mask *= 1.0 / np.sqrt(1.0 + (lo / np.maximum(f, 1e-6)) ** (2 * order))
    if hi is not None: mask *= 1.0 / np.sqrt(1.0 + (f / hi) ** (2 * order))
    return np.fft.irfft(spec * mask, n)

def noise(dur): return rng.standard_normal(int(dur * SR))
def brown(dur):
    x = np.cumsum(rng.standard_normal(int(dur * SR))); x = filt(x, lo=18.0, order=2); m = np.max(np.abs(x)); return x / m if m > 1e-9 else x
def tone(freq, dur, kind="sine", detune=0.0):
    t = np.arange(int(dur * SR)) / SR; ph = 2 * math.pi * freq * t
    s = 2.0 / math.pi * np.arcsin(np.sin(ph)) if kind == "triangle" else (np.sign(np.sin(ph)) if kind == "square" else (2 * ((freq * t) % 1.0) - 1 if kind == "saw" else np.sin(ph)))
    if detune: s = 0.6 * s + 0.4 * np.sin(2 * math.pi * freq * (1.0 + detune) * t)
    return s
def sweep(f0, f1, dur, kind="sine"):
    n = int(dur * SR); fr = np.linspace(f0, f1, n); ph = 2 * math.pi * np.cumsum(fr) / SR
    return 2.0 / math.pi * np.arcsin(np.sin(ph)) if kind == "triangle" else np.sin(ph)
def mix(buf, sig, at):
    i = int(at * SR)
    if i >= len(buf): return
    j = min(len(buf), i + len(sig)); buf[i:j] += sig[: j - i]
def delay_verb(x, taps=((0.091, 0.30), (0.173, 0.20), (0.311, 0.12))):
    y = x.copy()
    for dt, g in taps:
        d = int(dt * SR)
        if d < len(x): y[d:] += x[:-d] * g
    return y
def loopify(x, fade=1.5):
    n = len(x); f = min(int(fade * SR), n // 3); out = x[: n - f].copy(); t = np.linspace(0, 1, f)
    out[:f] = out[:f] * np.sqrt(t) + x[n - f:] * np.sqrt(1.0 - t); return out

# ---------------------------------------------------------------- material bursts (break / place / step)
MATS = {
    "stone": dict(lo=120, hi=2400, decay=0.10, thump=90), "earth": dict(lo=60, hi=900, decay=0.12, thump=70),
    "sand": dict(lo=400, hi=5000, decay=0.14, thump=None), "wood": dict(lo=150, hi=1800, decay=0.09, thump=140),
    "plant": dict(lo=600, hi=6000, decay=0.08, thump=None), "leaves": dict(lo=700, hi=7000, decay=0.09, thump=None),
    "glass": dict(lo=1500, hi=9000, decay=0.25, thump=None), "metal": dict(lo=500, hi=4000, decay=0.30, thump=260),
    "cloth": dict(lo=200, hi=1500, decay=0.10, thump=None), "snow": dict(lo=300, hi=2500, decay=0.12, thump=None),
    "ice": dict(lo=900, hi=6000, decay=0.18, thump=None), "cloud": dict(lo=200, hi=1200, decay=0.30, thump=None),
    "liquid": dict(lo=200, hi=3000, decay=0.25, thump=None), "special": dict(lo=300, hi=4000, decay=0.4, thump=None),
}
def burst(mat, dur=0.28, soft=False):
    p = MATS[mat]; n = int(dur * SR)
    x = filt(noise(dur), lo=p["lo"], hi=p["hi"]) * env(n, 0.002, p["decay"] * (0.6 if soft else 1.0))
    if p["thump"] and not soft:
        x += 0.8 * sweep(p["thump"] * 1.6, p["thump"] * 0.6, dur) * env(n, 0.001, 0.05)
    if mat == "glass":
        for k in range(4):
            f = rng.uniform(2500, 6000); x += 0.25 * tone(f, dur) * env(n, 0.001, 0.06) * rng.uniform(0.5, 1.0)
    if mat == "metal":
        x += 0.5 * tone(rng.uniform(900, 1300), dur, detune=0.01) * env(n, 0.001, 0.2)
    return fade_edges(x)

def gen_material_sounds():
    for mat in MATS:
        save(f"break_{mat}", burst(mat, 0.32)); save(f"place_{mat}", burst(mat, 0.2, soft=True))
        for i in range(3):
            save(f"step_{mat}_{i}", burst(mat, 0.16, soft=True) * 0.7)
    # dig hits (repeating while mining)
    for mat in ["stone", "earth", "wood", "sand"]:
        save(f"dig_{mat}", burst(mat, 0.12, soft=True) * 0.8)

def gen_ui_and_misc():
    n = int(0.12 * SR)
    save("click", fade_edges(tone(1400, 0.12) * env(n, 0.001, 0.03) + 0.4 * tone(2100, 0.12) * env(n, 0.001, 0.02)))
    save("pop", fade_edges(sweep(600, 1400, 0.1) * env(int(0.1 * SR), 0.002, 0.03)))
    e = np.zeros(int(0.7 * SR))
    for i in range(4):
        mix(e, filt(noise(0.09), lo=300, hi=2500) * env(int(0.09 * SR), 0.003, 0.03), i * 0.16)
    save("eat", fade_edges(e))
    n = int(0.35 * SR); save("hurt", fade_edges(sweep(500, 180, 0.35) * env(n, 0.002, 0.12) + 0.5 * filt(noise(0.35), lo=200, hi=2000) * env(n, 0.001, 0.08)))
    n = int(0.5 * SR); save("fall_damage", fade_edges(0.9 * sweep(120, 45, 0.5) * env(n, 0.002, 0.15) + filt(noise(0.5), lo=80, hi=600) * env(n, 0.001, 0.12)))
    # splash / swim / bubbles
    n = int(0.6 * SR); s = filt(noise(0.6), lo=300, hi=4000) * env(n, 0.01, 0.2)
    for k in range(10):
        f = rng.uniform(400, 1600); at = rng.uniform(0.0, 0.4); b = tone(f, 0.08) * env(int(0.08 * SR), 0.002, 0.03); mix(s, 0.4 * b, at)
    save("splash", fade_edges(s))
    n = int(0.4 * SR); save("swim", fade_edges(filt(noise(0.4), lo=200, hi=2500) * env(n, 0.05, 0.15)))
    b = np.zeros(int(1.2 * SR))
    for k in range(14):
        f = rng.uniform(300, 1200); at = rng.uniform(0, 1.0); mix(b, 0.5 * sweep(f, f * 1.6, 0.09) * env(int(0.09 * SR), 0.002, 0.04), at)
    save("bubbles", fade_edges(b))
    # level up / quest / dragon ball chimes (pentatonic arpeggios)
    def arp(notes, step, dur, timbre="triangle"):
        total = int((len(notes) * step + dur) * SR); buf = np.zeros(total)
        for i, m in enumerate(notes):
            f = 440.0 * 2 ** ((m - 69) / 12); nn = int(dur * SR)
            sig = (tone(f, dur, timbre) + 0.3 * tone(f * 2, dur) + 0.15 * tone(f * 3, dur)) * env(nn, 0.005, 0.35)
            mix(buf, sig, i * step)
        return fade_edges(delay_verb(buf))
    save("level_up", arp([72, 76, 79, 84, 88], 0.09, 0.8))
    save("quest_start", arp([67, 71, 74], 0.12, 0.6))
    save("quest_complete", arp([72, 79, 84, 91], 0.11, 1.0))
    save("skill_learned", arp([69, 73, 76, 81], 0.1, 0.8))
    save("dball_pickup", arp([76, 83, 88, 95], 0.07, 1.4))
    save("item_pickup", arp([84, 91], 0.05, 0.25))
    save("wish_granted", arp([60, 64, 67, 72, 76, 79, 84], 0.13, 1.6))
    save("toast", arp([79, 84], 0.08, 0.4))
    save("error", fade_edges(tone(220, 0.25, "square") * env(int(0.25 * SR), 0.002, 0.12) * 0.4))
    # thunder / explosion rumble / shockwave / whoosh / dash
    n = int(2.5 * SR); t = brown(2.5) * env(n, 0.02, 1.0); t += 0.4 * filt(noise(2.5), lo=60, hi=800) * env(n, 0.005, 0.5)
    save("thunder", fade_edges(delay_verb(t, ((0.2, 0.4), (0.45, 0.25), (0.9, 0.15)))))
    n = int(1.4 * SR); x = filt(noise(1.4), lo=40, hi=1200) * env(n, 0.003, 0.4) + 0.9 * sweep(160, 30, 1.4) * env(n, 0.002, 0.3)
    save("explosion_big", fade_edges(delay_verb(x)))
    n = int(0.9 * SR); save("shockwave", fade_edges(sweep(90, 20, 0.9) * env(n, 0.002, 0.3) + 0.5 * filt(noise(0.9), lo=100, hi=3000) * env(n, 0.002, 0.15)))
    n = int(0.35 * SR); save("whoosh", fade_edges(filt(noise(0.35), lo=400, hi=4000) * env(n, 0.06, 0.1)))
    n = int(0.3 * SR); save("dash", fade_edges(filt(noise(0.3), lo=800, hi=6000) * env(n, 0.02, 0.09) + 0.3 * sweep(900, 300, 0.3) * env(n, 0.01, 0.1)))
    n = int(0.6 * SR); save("land", fade_edges(filt(noise(0.6), lo=60, hi=900) * env(n, 0.002, 0.12) + 0.7 * sweep(110, 40, 0.6) * env(n, 0.002, 0.1)))
    n = int(0.5 * SR); save("ki_charge_start", fade_edges(sweep(150, 900, 0.5) * env(n, 0.05, 0.3) + 0.3 * filt(noise(0.5), lo=500, hi=5000) * env(n, 0.05, 0.2)))
    n = int(0.8 * SR); save("lightning_crack", fade_edges(filt(noise(0.8), lo=1500, hi=12000) * env(n, 0.001, 0.08) + 0.6 * filt(noise(0.8), lo=80, hi=600) * env(n, 0.005, 0.35)))
    n = int(1.2 * SR); save("power_up_burst", fade_edges(sweep(200, 1600, 1.2) * env(n, 0.02, 0.5) + filt(noise(1.2), lo=300, hi=8000) * env(n, 0.01, 0.4)))
    n = int(0.25 * SR); save("block_guard", fade_edges(tone(320, 0.25, "square") * env(n, 0.002, 0.06) * 0.5 + filt(noise(0.25), lo=1000, hi=6000) * env(n, 0.001, 0.05)))
    n = int(0.6 * SR); save("heal", fade_edges((tone(660, 0.6) + tone(990, 0.6) * 0.5 + tone(1320, 0.6) * 0.3) * env(n, 0.05, 0.25)))
    n = int(0.9 * SR); save("teleport", fade_edges(sweep(300, 2400, 0.9) * env(n, 0.01, 0.3) + 0.5 * filt(noise(0.9), lo=2000, hi=9000) * env(n, 0.01, 0.3)))
    n = int(1.0 * SR); save("scouter_beep", fade_edges(np.concatenate([tone(2200, 0.08) * env(int(0.08 * SR), 0.002, 0.03), np.zeros(int(0.08 * SR))] * 3 + [np.zeros(n - 6 * int(0.08 * SR))])))
    n = int(0.6 * SR); save("capsule_pop", fade_edges(filt(noise(0.6), lo=200, hi=3000) * env(n, 0.003, 0.15) + 0.6 * sweep(400, 900, 0.6) * env(n, 0.002, 0.08)))
    n = int(1.5 * SR); save("ship_engine", fade_edges(loopify(filt(brown(1.5), lo=40, hi=400) + 0.3 * tone(55, 1.5, "saw"), 0.3)))

def gen_ambience():
    def whole(f, loop): return round(f * loop) / loop
    loop = 16.0
    w = filt(brown(loop), lo=80, hi=1400); t = np.arange(len(w)) / SR
    w *= 0.55 + 0.45 * np.sin(2 * math.pi * whole(0.11, loop) * t) * np.sin(2 * math.pi * whole(0.07, loop) * t + 1.0)
    save("ambience_wind", loopify(w, 2.0))
    r = filt(noise(loop), lo=800, hi=9000) * 0.6
    for k in range(180):
        at = rng.uniform(0, loop); f = rng.uniform(2500, 7000); mix(r, 0.3 * tone(f, 0.02) * env(int(0.02 * SR), 0.001, 0.006), at)
    save("ambience_rain", loopify(r, 2.0))
    c = filt(brown(loop), lo=30, hi=300) * 0.7
    for k in range(10):
        at = rng.uniform(0, loop); f = rng.uniform(700, 2400); mix(c, 0.4 * tone(f, 0.15) * env(int(0.15 * SR), 0.002, 0.05), at)
    save("ambience_cave", loopify(delay_verb(c, ((0.4, 0.4), (0.9, 0.25))), 2.0))
    s = 0.5 * tone(48, loop, detune=0.003) + 0.3 * tone(72.5, loop) + 0.15 * filt(brown(loop), lo=200, hi=2000)
    save("ambience_space", loopify(s, 2.0))
    b = filt(noise(loop), lo=150, hi=1500) * 0.4; t = np.arange(len(b)) / SR; b *= 0.5 + 0.5 * np.sin(2 * math.pi * whole(0.12, loop) * t)
    for k in range(6):
        at = rng.uniform(0, loop); mix(b, 0.6 * filt(noise(1.2), lo=200, hi=3000) * env(int(1.2 * SR), 0.3, 0.4), at)
    save("ambience_ocean", loopify(b, 2.0))
    h = filt(brown(loop), lo=40, hi=250) * 0.8 + 0.2 * tone(60, loop, "saw")
    for k in range(20):
        at = rng.uniform(0, loop); mix(h, 0.5 * filt(noise(0.3), lo=1500, hi=8000) * env(int(0.3 * SR), 0.01, 0.08), at)
    save("ambience_hell", loopify(h, 2.0))
    hv = 0.3 * tone(220, loop) + 0.2 * tone(330, loop) + 0.15 * tone(440, loop) + 0.1 * filt(noise(loop), lo=3000, hi=9000)
    t = np.arange(len(hv)) / SR; hv *= 0.7 + 0.3 * np.sin(2 * math.pi * whole(0.09, loop) * t)
    save("ambience_heaven", loopify(hv, 2.0))
    f = filt(noise(loop), lo=200, hi=1800) * 0.5; t = np.arange(len(f)) / SR; f *= 0.6 + 0.4 * np.sin(2 * math.pi * whole(1.7, loop) * t)
    save("fly_loop", loopify(f, 1.0))
    a = 0.4 * tone(110, loop, "saw") + 0.3 * tone(165, loop, "triangle") + 0.3 * filt(noise(loop), lo=300, hi=3000); t = np.arange(len(a)) / SR; a *= 0.7 + 0.3 * np.sin(2 * math.pi * whole(6.0, loop) * t)
    save("aura_loop", loopify(a, 1.0))

# ---------------------------------------------------------------- music (original loops)
def mf(midi): return 440.0 * 2 ** ((midi - 69) / 12)
def synth_note(freq, dur, timbre, amp):
    n = int(dur * SR)
    if timbre == "lead": s = tone(freq, dur, "saw", 0.006) * 0.5 + tone(freq, dur, "square") * 0.2; e = env(n, 0.01, dur * 0.5, dur * 0.3)
    elif timbre == "bass": s = tone(freq, dur, "saw") * 0.6 + tone(freq / 2, dur) * 0.6; e = env(n, 0.005, dur * 0.4, dur * 0.4)
    elif timbre == "pad": s = tone(freq, dur, detune=0.004) + 0.5 * tone(freq * 2.0, dur, detune=0.003); e = env(n, dur * 0.3, dur * 0.5, dur * 0.3)
    elif timbre == "brass": s = tone(freq, dur, "saw", 0.01) * 0.6 + tone(freq * 1.005, dur, "saw") * 0.3; e = env(n, 0.03, dur * 0.4, dur * 0.4)
    elif timbre == "bell": s = tone(freq, dur) + 0.5 * tone(freq * 2.76, dur) + 0.3 * tone(freq * 5.4, dur); e = env(n, 0.002, dur * 0.6)
    else: s = tone(freq, dur, "triangle"); e = env(n, 0.01, dur * 0.5, dur * 0.2)
    return s * e * amp
def drum(kind, dur=0.3):
    n = int(dur * SR)
    if kind == "kick": return sweep(150, 40, dur) * env(n, 0.001, 0.09)
    if kind == "snare": return filt(noise(dur), lo=800, hi=6000) * env(n, 0.001, 0.08) + 0.5 * sweep(220, 150, dur) * env(n, 0.001, 0.05)
    if kind == "hat": return filt(noise(dur), lo=6000, hi=14000) * env(n, 0.001, 0.025)
    if kind == "tom": return sweep(200, 90, dur) * env(n, 0.001, 0.12)
    if kind == "crash": return filt(noise(dur), lo=3000, hi=12000) * env(n, 0.002, 0.5)
    return np.zeros(n)
def render(events, drums, loop_sec, bpm, tail=3.0):
    spb = 60.0 / bpm; buf = np.zeros(int((loop_sec + tail) * SR))
    for (beat, midi, beats, timbre, amp) in events:
        mix(buf, synth_note(mf(midi), beats * spb, timbre, amp), beat * spb)
    for (beat, kind, amp) in drums:
        mix(buf, drum(kind) * amp, beat * spb)
    m = int(loop_sec * SR); out = buf[:m].copy(); tl = buf[m:]; k = min(len(tl), m); out[:k] += tl[:k]
    return delay_verb(out, ((0.25, 0.18), (0.5, 0.1)))

def song_battle():
    bpm = 150; bars = 8; beats = bars * 4; ev = []; dr = []
    bass = [45, 45, 48, 45, 43, 43, 41, 43] * 1
    for bar in range(bars):
        root = bass[bar]
        for b in range(8): ev.append((bar * 4 + b * 0.5, root, 0.45, "bass", 0.5))
        for b in range(4):
            dr.append((bar * 4 + b, "kick", 0.9)); dr.append((bar * 4 + b + 0.5, "hat", 0.35)); dr.append((bar * 4 + b, "hat", 0.25))
            if b in (1, 3): dr.append((bar * 4 + b, "snare", 0.7))
        chord = [root + 12, root + 15, root + 19]
        for c in chord: ev.append((bar * 4, c, 3.8, "pad", 0.12))
    lead = [(0, 69, 0.5), (0.5, 72, 0.5), (1, 76, 1), (2, 74, 0.5), (2.5, 72, 0.5), (3, 69, 1), (4, 67, 0.5), (4.5, 69, 0.5), (5, 72, 1), (6, 71, 0.5), (6.5, 69, 0.5), (7, 67, 1),
            (8, 69, 0.5), (8.5, 72, 0.5), (9, 76, 0.5), (9.5, 79, 0.5), (10, 81, 1.5), (11.5, 79, 0.5), (12, 76, 1), (13, 74, 0.5), (13.5, 72, 0.5), (14, 71, 2),
            (16, 64, 0.5), (16.5, 67, 0.5), (17, 69, 1), (18, 72, 0.5), (18.5, 71, 0.5), (19, 69, 1), (20, 67, 0.5), (20.5, 64, 0.5), (21, 62, 1), (22, 64, 2),
            (24, 69, 0.5), (24.5, 72, 0.5), (25, 76, 0.5), (25.5, 79, 0.5), (26, 81, 0.5), (26.5, 84, 0.5), (27, 81, 1), (28, 79, 0.5), (28.5, 76, 0.5), (29, 74, 0.5), (29.5, 72, 0.5), (30, 69, 2)]
    for (b, m, d) in lead: ev.append((b, m, d, "lead", 0.35)); ev.append((b, m - 12, d, "brass", 0.12))
    return render(ev, dr, beats * 60.0 / bpm, bpm)

def song_boss():
    bpm = 168; bars = 8; beats = bars * 4; ev = []; dr = []
    roots = [40, 40, 43, 38, 40, 40, 46, 47]
    for bar in range(bars):
        r = roots[bar]
        for b in range(16): ev.append((bar * 4 + b * 0.25, r if b % 4 != 3 else r + 1, 0.22, "bass", 0.45))
        for b in range(4):
            dr.append((bar * 4 + b, "kick", 1.0)); dr.append((bar * 4 + b + 0.5, "kick", 0.6)); dr.append((bar * 4 + b + 0.25, "hat", 0.3)); dr.append((bar * 4 + b + 0.75, "hat", 0.3))
            if b in (1, 3): dr.append((bar * 4 + b, "snare", 0.8))
        if bar % 4 == 3: dr.append((bar * 4 + 3.5, "crash", 0.5))
        for c in [r + 12, r + 15, r + 18]: ev.append((bar * 4, c, 3.9, "brass", 0.14))
    lead = [(0, 64, 1), (1, 63, 1), (2, 64, 0.5), (2.5, 67, 0.5), (3, 70, 1), (4, 69, 1.5), (5.5, 67, 0.5), (6, 64, 2), (8, 71, 0.5), (8.5, 70, 0.5), (9, 67, 1), (10, 66, 1), (11, 64, 1), (12, 62, 0.5), (12.5, 64, 0.5), (13, 66, 1), (14, 67, 2),
            (16, 76, 0.5), (16.5, 75, 0.5), (17, 76, 0.5), (17.5, 79, 0.5), (18, 82, 1), (19, 81, 1), (20, 79, 0.5), (20.5, 76, 0.5), (21, 74, 1), (22, 76, 2), (24, 70, 1), (25, 71, 1), (26, 74, 0.5), (26.5, 76, 0.5), (27, 77, 1), (28, 76, 0.5), (28.5, 74, 0.5), (29, 71, 1), (30, 70, 2)]
    for (b, m, d) in lead: ev.append((b, m, d, "lead", 0.38))
    return render(ev, dr, beats * 60.0 / bpm, bpm)

def song_transformation():
    bpm = 120; bars = 8; beats = bars * 4; ev = []; dr = []
    roots = [45, 45, 50, 52, 45, 45, 53, 52]
    for bar in range(bars):
        r = roots[bar]
        ev.append((bar * 4, r - 12, 3.9, "bass", 0.5))
        for c in [r, r + 4, r + 7, r + 12]: ev.append((bar * 4, c, 3.9, "pad", 0.18))
        for b in range(4): dr.append((bar * 4 + b, "tom", 0.6 if b % 2 == 0 else 0.3)); dr.append((bar * 4 + b + 0.5, "hat", 0.2))
        if bar >= 4:
            for b in range(4): dr.append((bar * 4 + b, "kick", 0.8))
            if bar % 2 == 1: dr.append((bar * 4 + 2, "snare", 0.6))
        if bar % 4 == 0: dr.append((bar * 4, "crash", 0.6))
    lead = [(0, 69, 2), (2, 72, 2), (4, 76, 3), (7, 74, 1), (8, 72, 2), (10, 74, 2), (12, 76, 4), (16, 81, 2), (18, 79, 2), (20, 76, 3), (23, 79, 1), (24, 84, 2), (26, 81, 2), (28, 79, 4)]
    for (b, m, d) in lead: ev.append((b, m, d, "brass", 0.3)); ev.append((b, m + 12, d, "bell", 0.1))
    return render(ev, dr, beats * 60.0 / bpm, bpm)

def song_space():
    bpm = 90; bars = 8; beats = bars * 4; ev = []; dr = []
    roots = [50, 48, 45, 47, 50, 48, 52, 47]
    for bar in range(bars):
        r = roots[bar]
        for c in [r, r + 7, r + 14, r + 17]: ev.append((bar * 4, c, 3.95, "pad", 0.16))
        ev.append((bar * 4, r - 12, 3.9, "bass", 0.25))
        for b in range(8):
            if rng.random() < 0.5: ev.append((bar * 4 + b * 0.5, r + 24 + [0, 2, 4, 7, 9][int(rng.integers(0, 5))], 0.5, "bell", 0.1))
        dr.append((bar * 4, "kick", 0.4)); dr.append((bar * 4 + 2, "kick", 0.3)); dr.append((bar * 4 + 3, "hat", 0.15))
    return render(ev, dr, beats * 60.0 / bpm, bpm)

def song_namek():
    bpm = 105; bars = 8; beats = bars * 4; ev = []; dr = []
    roots = [43, 43, 46, 48, 43, 43, 41, 43]
    for bar in range(bars):
        r = roots[bar]
        ev.append((bar * 4, r - 12, 3.9, "bass", 0.35)); ev.append((bar * 4 + 2, r - 5, 1.9, "bass", 0.25))
        for c in [r, r + 3, r + 7]: ev.append((bar * 4, c, 3.9, "pad", 0.14))
        for b in range(4): dr.append((bar * 4 + b, "kick", 0.5)); dr.append((bar * 4 + b + 0.5, "hat", 0.25))
        dr.append((bar * 4 + 2, "snare", 0.4))
    lead = [(0, 67, 1), (1, 70, 1), (2, 72, 2), (4, 74, 1), (5, 72, 1), (6, 70, 2), (8, 67, 1), (9, 70, 1), (10, 75, 2), (12, 74, 1), (13, 72, 1), (14, 70, 2), (16, 79, 1), (17, 77, 1), (18, 75, 2), (20, 74, 1), (21, 72, 1), (22, 70, 2), (24, 72, 1), (25, 70, 1), (26, 67, 2), (28, 65, 1), (29, 67, 1), (30, 70, 2)]
    for (b, m, d) in lead: ev.append((b, m, d, "lead", 0.25))
    return render(ev, dr, beats * 60.0 / bpm, bpm)

def song_otherworld():
    bpm = 80; bars = 8; beats = bars * 4; ev = []; dr = []
    roots = [48, 53, 55, 48, 45, 53, 55, 48]
    for bar in range(bars):
        r = roots[bar]
        for c in [r, r + 4, r + 7, r + 11]: ev.append((bar * 4, c, 3.95, "pad", 0.15))
        ev.append((bar * 4, r + 24, 2, "bell", 0.12)); ev.append((bar * 4 + 2, r + 28, 2, "bell", 0.1))
        dr.append((bar * 4, "hat", 0.1))
    return render(ev, dr, beats * 60.0 / bpm, bpm)

def main():
    gen_material_sounds(); gen_ui_and_misc(); gen_ambience()
    save("bgm_battle", song_battle(), 0.8, BGM); save("bgm_boss", song_boss(), 0.8, BGM); save("bgm_transformation", song_transformation(), 0.8, BGM)
    save("bgm_space", song_space(), 0.7, BGM); save("bgm_namek", song_namek(), 0.7, BGM); save("bgm_otherworld", song_otherworld(), 0.7, BGM)
    print(f"generated {len(written)} sounds")

if __name__ == "__main__":
    main()
