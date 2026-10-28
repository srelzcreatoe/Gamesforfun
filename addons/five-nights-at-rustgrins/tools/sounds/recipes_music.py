"""Recipes: music. All melodies here are original compositions for this project.

  * Rustgrin's Theme  - melancholy A-minor music-box waltz (power-out song,
                         title theme, ending theme in major)
  * The Midway waltz  - C-major circus waltz on a steam calliope (show tape)
  * "Pizza Party Tonight" - the Rusty Revue's cheesy 80s daytime song (G major)
"""
from __future__ import annotations

import functools

import numpy as np

from fnar_dsp import (N, PI2, SR, T, additive, ar, band_noise, bq, bw, chord, circ, click_train, comp, decay,
                      env_pts, eq, formants, gate, hz, interp_read, ks_string, loop_hz, midi, norm_rms, op_lp,
                      parse_line, periodic_lfo, phase, pink, place, pulse, resonators, reverb, rng, sat, saw,
                      servo, smooth_noise, strike, tvbq, varispeed, voice_src, voicing, vowel_track, white,
                      wow_flutter, fit, sine, shaped_noise, rms)
from recipes_common import (P, glock, hit, ir_big_st, ir_midway, ir_office, ir_plate_st, ir_stage_st,
                            plastic_modes, small_metal, thud)

# =============================================================================
# compositions (original)
# =============================================================================
# Rustgrin's Theme - A minor, 3/4. Notes as NAME/beats, bars split by '|'.
RUSTGRIN_THEME = (
    "E5/1 A5/1 C6/1 | B5/2 A5/1 | G#5/1 A5/1 E5/1 | F5/3 | "
    "D5/1 F5/1 A5/1 | G#5/2 F5/1 | E5/1 D#5/1 E5/1 | B4/3 | "
    "E5/1 A5/1 C6/1 | E6/2 D6/1 | C6/1 B5/1 A5/1 | F5/3 | "
    "D5/1 E5/1 F5/1 | G#5/2 B5/1 | A5/3 | r/3")
RUSTGRIN_CHORDS = ['Am', 'Am', 'E', 'Dm', 'Dm', 'E', 'Am', 'E', 'Am', 'Am', 'F', 'Dm', 'Dm', 'E', 'Am', 'Am']

# Ending: the theme's opening, turning to A major at bar 4.
ENDING_THEME = (
    "E5/1 A5/1 C6/1 | B5/2 A5/1 | G#5/1 A5/1 B5/1 | F#5/3 | "
    "D5/1 F#5/1 A5/1 | G#5/2 B5/1 | A5/1 C#6/1 E6/1 | A6/3")
ENDING_CHORDS = ['Am', 'Am', 'E', 'D', 'D', 'E', 'A', 'A']

# The Midway waltz - C major, 3/4, one beat = 1/3 s (16 bars = 16 s).
CALLIOPE_TUNE = (
    "C5/1 E5/1 G5/1 | A5/2 G#5/1 | A5/1 F5/1 D5/1 | G5/3 | "
    "B4/1 D5/1 G5/1 | F5/2 E5/1 | D5/1 E5/1 F5/1 | E5/3 | "
    "C5/1 E5/1 G5/1 | C6/2 B5/1 | A5/1 F#5/1 A5/1 | G5/3 | "
    "F5/1 A5/1 C6/1 | B5/2 D6/1 | C6/1 G5/1 E5/1 | C5/2 r/1")
CALLIOPE_CHORDS = ['C', 'F', 'Dm', 'G7', 'G', 'G7', 'G7', 'C', 'C', 'Am', 'D7', 'G', 'F', 'G7', 'C', 'C']

# "Pizza Party Tonight" - G major, 4/4, 120 bpm, 24 bars = 48 s.
SHOW_LEAD = (
    # intro hook
    "D5/0.5 G5/0.5 B5/0.5 D6/1.5 r/1 | C6/0.5 B5/0.5 A5/0.5 F#5/1.5 r/1 | "
    # verse
    "D5/1 B4/1 G4/1 B4/0.5 D5/0.5 | E5/2 D5/1 B4/1 | C5/1 E5/1 G5/1 E5/1 | A5/1 F#5/1 D5/1.5 r/0.5 | "
    "D5/1 B4/0.5 D5/0.5 G5/1 F#5/0.5 E5/0.5 | E5/1 B4/1 E5/1 G5/1 | A5/1 G5/0.5 E5/0.5 C5/1 E5/1 | "
    "D5/2 F#5/1 A5/1 | "
    # chorus
    "G5/1.5 E5/0.5 G5/1 A5/1 | F#5/1.5 D5/0.5 F#5/1 A5/1 | B5/1 A5/1 G5/1 D5/1 | E5/2 G5/1 B5/1 | "
    "C6/1.5 B5/0.5 A5/1 G5/1 | A5/1.5 G5/0.5 F#5/1 D5/1 | G5/2 B5/1 D6/1 | G5/3 r/1 | "
    # bridge
    "A5/0.5 A5/0.5 G5/0.5 E5/0.5 A5/2 | F#5/0.5 F#5/0.5 E5/0.5 D5/0.5 F#5/2 | "
    "D5/0.5 D5/0.5 F#5/0.5 A5/0.5 B5/2 | G#5/2 B5/1 D6/1 | "
    # turnaround
    "C6/1 B5/1 A5/1 E5/1 | F#5/1 A5/1 C6/1 r/1")
SHOW_CHORDS = ['G', 'D',
               'G', 'Em', 'C', 'D', 'G', 'Em', 'C', 'D',
               'C', 'D', 'G', 'Em', 'C', 'D', 'G', 'G',
               'Am', 'D', 'Bm', 'E7',
               'Am', 'D7']
SHOW_SECTIONS = ['intro'] * 2 + ['verse'] * 8 + ['chorus'] * 8 + ['bridge'] * 4 + ['turn'] * 2

SHOW_DUR = 16.0
SHOW_SLOW_DUR = round(SHOW_DUR / 0.7, 4)      # 22.8571 s: the whole tune at 70 % speed


class Tempo:
    """beat -> seconds through a piecewise-linear bpm curve (+ optional wobble)"""

    def __init__(self, pts, wobble=0.0, wob_period=7.0):
        bmax = pts[-1][0] + 16
        self.g = np.linspace(0, bmax, 40000)
        bpm = np.interp(self.g, [p[0] for p in pts], [p[1] for p in pts])
        bpm = bpm * (1 + wobble * np.sin(PI2 * self.g / wob_period))
        dt = 60.0 / bpm
        self.tc = np.concatenate([[0.0], np.cumsum((dt[1:] + dt[:-1]) / 2 * np.diff(self.g))])

    def __call__(self, b):
        return float(np.interp(b, self.g, self.tc))


def U(x):
    """normalise to unit RMS"""
    v = rms(x)
    return x / v if v > 0 else x


# =============================================================================
# instruments
# =============================================================================
def music_box_note(f, dur, r, vel=1.0, bright=1.0):
    """comb tine: clamped-bar modes (1 : 6.27 : 17.55), FM glockenspiel
    shimmer on the attack, and the pin's pluck click"""
    n = N(dur)
    t = T(n)
    t60 = float(np.clip(3.0 * (440.0 / f) ** 0.5, 0.9, 3.6))
    y = np.sin(PI2 * f * t) * 10 ** (-3 * t / t60)
    y += 0.07 * np.sin(PI2 * 2 * f * t + 0.3) * 10 ** (-3 * t / (t60 * 0.45))
    for ratio, a, tt in ((6.267, 0.20, 0.32), (17.55, 0.06, 0.06)):
        fr = f * ratio
        if fr < SR * 0.45:
            y += a * bright * np.sin(PI2 * fr * t + r.uniform(0, PI2)) * 10 ** (-3 * t / tt)
    idx = 1.4 * bright * np.exp(-t / 0.04)
    y += 0.22 * np.sin(PI2 * f * t + idx * np.sin(PI2 * 3.5 * f * t)) * 10 ** (-3 * t / (t60 * 0.3))
    m = N(0.003)
    click = bw(r.standard_normal(m) * np.exp(-np.arange(m) / (0.0004 * SR)), 'hp', 2500)
    y[:m] += 0.12 * bright * click
    y *= 1 - np.exp(-t / 0.0003)
    return y * vel


def render_music_box(events, n, r, wrap=False, detune=8.0, seed='mb', bright=1.0, ring=5.0):
    """events: [(time, midi, vel)]; detune: fixed per-tine detune range in cents"""
    out = np.zeros(n)
    for tt, m, vel in events:
        c = rng(seed, m).uniform(-1, 1) * detune
        f = hz(m) * 2 ** (c / 1200)
        place(out, music_box_note(f, ring, r, vel, bright), tt, wrap=wrap)
    return out


def calliope_note(f, dur, r, vel=1.0, detune_c=0.0, rel=0.07, bright=1.0, breath=1.0):
    """steam calliope whistle: bright harmonic tone with an onset pitch scoop,
    steam-pressure wobble, breath noise locked to the tone, and a chiff"""
    n = N(dur + rel)
    t = T(n)
    f0 = f * 2 ** (detune_c / 1200)
    scoop = -0.022 * np.exp(-t / 0.03)
    vib = 0.0045 * np.sin(PI2 * 5.8 * t + r.uniform(0, PI2)) * (1 - np.exp(-t / 0.12))
    wob = 0.0025 * smooth_noise(r, n, 4)
    ff = f0 * (1 + scoop + vib + wob)
    k = np.arange(12)
    amps = np.array([1.0, 0.62, 0.40, 0.26, 0.17, 0.11, 0.075, 0.05, 0.035, 0.025, 0.018, 0.012]) * bright ** k
    tone = additive(ff, n, amps)
    lock = 1 + 0.6 * np.sin(PI2 * phase(ff, n))
    br = U(bq(r.standard_normal(n), 'bp', f0, 10)) * 0.07 + U(bq(r.standard_normal(n), 'bp', 2 * f0, 8)) * 0.04
    hiss = U(bw(r.standard_normal(n), 'hp', 3500)) * 0.03
    chiff = U(bq(r.standard_normal(n), 'bp', 3 * f0, 2.5)) * np.exp(-t / 0.014) * 0.25
    env = gate(n, 0.0, dur, 0.022, rel)
    am = 1 + 0.05 * smooth_noise(r, n, 9)
    return (tone + breath * (br * lock + hiss) + chiff) * env * am * vel


DRAWBARS = (0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0)


def organ_note(f, dur, r, vel=1.0, bars=(8, 6, 8, 5, 3, 4, 0, 0, 2), perc=0.35, click=0.06, rel=0.045):
    n = N(dur + rel)
    t = T(n)
    s = np.zeros(n)
    for ratio, lv in zip(DRAWBARS, bars):
        fr = f * ratio
        if lv and fr < SR * 0.45:
            s += 10 ** ((lv - 8) * 3 / 20) * np.sin(PI2 * fr * t + r.uniform(0, PI2))
    if perc:
        s += perc * np.sin(PI2 * 3 * f * t) * np.exp(-t / 0.12)
    m = N(0.004)
    s[:m] += click * bw(r.standard_normal(m), 'bp', (800, 6000)) * np.hanning(m)
    s *= gate(n, 0.0, dur, 0.004, rel)
    return s * vel / 3.0


def leslie(x, r, rate=6.3, circular=False):
    """rotating-speaker effect: horn (highs) and drum (lows) with Doppler + AM, stereo out"""
    n = x.shape[-1]
    t = T(n)
    fr = loop_hz(rate, n) if circular else rate
    fd = loop_hz(rate * 0.83, n) if circular else rate * 0.83
    lo = circ(bw, x, 'lp', 800, 2) if circular else bw(x, 'lp', 800, 2)
    hi = x - lo
    out = np.zeros((2, n))
    for ch, ph in ((0, 0.0), (1, np.pi / 2)):
        mh = np.sin(PI2 * fr * t + ph)
        md = np.sin(PI2 * fd * t + ph + 1.0)
        pos = np.arange(n) - (0.00035 * SR) * (1 + mh) - 3
        hi_c = interp_read(hi, pos, circular) * (1 + 0.3 * mh)
        pos = np.arange(n) - (0.0002 * SR) * (1 + md) - 3
        lo_c = interp_read(lo, pos, circular) * (1 + 0.12 * md)
        out[ch] = hi_c + lo_c
    return out


def bass_note(f, dur, r, vel=1.0):
    s = ks_string(f, dur + 0.06, r, t60=1.8, bright=0.12, pick=0.25, exc_lp=1500)
    n = s.shape[-1]
    s = P(s) + 0.3 * np.sin(PI2 * f * T(n))
    s *= gate(n, 0.0, dur, 0.001, 0.035)
    return bw(s, 'lp', 2500) * vel


def guitar_chord(midis, dur, r, vel=1.0, spread=0.006, drive=3.0, t60=3.0, mute=True, detune=6.0):
    n = N(dur + 0.12)
    s = np.zeros(n)
    for i, m in enumerate(midis):
        f = hz(m) * 2 ** (r.uniform(-detune, detune) / 1200)
        st = ks_string(f, dur + 0.12, r, t60=t60, bright=0.32, pick=0.13 + 0.05 * r.uniform())
        place(s, st * r.uniform(0.8, 1.0), i * spread)
    if mute:
        s *= gate(n, 0.0, dur, 0.0005, 0.05)
    s = P(s)
    s = sat(s * 1.0, drive, 0.12)
    s = eq(s, ('peak', 1700, 0.9, 3.0))
    s = bw(bw(s, 'lp', 4800, 2), 'hp', 90, 2)
    return s * vel


def ooh_note(f, dur, r, vowel_end='o', fscale=1.15, vel=1.0):
    n = N(dur + 0.35)
    t = T(n)
    f0 = f * (1 + 0.007 * np.sin(PI2 * 5.2 * t + r.uniform(0, PI2)) * (1 - np.exp(-t / 0.3))
              + 0.003 * smooth_noise(r, n, 3))
    src = voice_src(r, f0, n, jitter=0.004, shimmer=0.03, breath=0.1, tilt=2200)
    F, B = vowel_track(n, [(0, 'u'), (dur, vowel_end), (dur + 0.35, vowel_end)], fscale)
    s = formants(src, F, B, (0, -6, -14, -20))
    return P(s) * gate(n, 0.0, dur, 0.12, 0.3) * vel


# --- drum machine ------------------------------------------------------------
@functools.lru_cache(maxsize=None)
def drum_kit():
    r = rng('kit')
    k = {}
    n = N(0.5)
    t = T(n)
    f = 48 + 120 * np.exp(-t / 0.03)
    body = np.sin(PI2 * phase(f, n)) * ar(n, 0.0008, 0.42)
    click = bw(white(r, n), 'hp', 3000) * ar(n, 0.0002, 0.01) * 0.4
    k['kick'] = P(sat(body + click, 1.6))
    n = N(0.6)
    t = T(n)
    tone = (np.sin(PI2 * phase(190 * (1 + 0.15 * np.exp(-t / 0.01)), n)) * 0.6 + np.sin(PI2 * 330 * t) * 0.3) \
        * ar(n, 0.0008, 0.11)
    nz = bw(white(r, n), 'bp', (1200, 9500)) * ar(n, 0.0008, 0.22)
    dry = P(tone + nz * 0.9)
    wet = reverb(dry, ir_plate_st(), wet=1.0, dry=0.0)
    g = env_pts(n, [(0, 1), (0.17, 1), (0.25, 0)])
    k['snare'] = np.stack([dry, dry]) + 0.9 * P(wet) * g
    n = N(0.5)
    t = T(n)
    sq = sum(np.sign(np.sin(PI2 * fr * t + r.uniform(0, PI2))) for fr in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0))
    metal = bw(sq, 'bp', (6000, 12500), 2)
    k['hat'] = P(metal * ar(n, 0.0004, 0.06) + 0.3 * bw(white(r, n), 'hp', 8000) * ar(n, 0.0004, 0.04))
    k['ohat'] = P(metal * ar(n, 0.0004, 0.42) + 0.3 * bw(white(r, n), 'hp', 8000) * ar(n, 0.0004, 0.3))
    n = N(2.2)
    t = T(n)
    sq = sum(np.sign(np.sin(PI2 * fr * 1.37 * t + r.uniform(0, PI2))) for fr in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0))
    k['crash'] = P(bw(sq * 0.5 + white(r, n), 'bp', (3000, 14000)) * ar(n, 0.002, 1.9))
    for name, f0 in (('tom_hi', 196.0), ('tom_lo', 131.0)):
        n = N(0.5)
        t = T(n)
        ff = f0 * (1 + 0.45 * np.exp(-t / 0.04))
        s = np.sin(PI2 * phase(ff, n)) * ar(n, 0.001, 0.35) + 0.25 * bw(white(r, n), 'bp', (300, 3000)) * ar(n, 0.001, 0.06)
        k[name] = P(s)
    n = N(0.3)
    cl = np.zeros(n)
    for i, dt in enumerate((0.0, 0.009, 0.018, 0.027)):
        cl += white(r, n) * gate(n, dt, dt + 0.004, 0.0005, 0.003) * (1.0 if i < 3 else 1.2)
    cl += white(r, n) * ar(n, 0.001, 0.12, 0.027) * 0.6
    k['clap'] = P(bw(cl, 'bp', (900, 2800)))
    k['bd'] = P(sat(np.sin(PI2 * phase(42 + 60 * np.exp(-T(N(0.7)) / 0.04), N(0.7))) * ar(N(0.7), 0.002, 0.6), 1.2))
    return k


def mono_lead(notes, n, r, glide=0.018, vib_depth=0.0085):
    """monophonic synth line. notes: [(t_on, t_off, midi)] sorted by time"""
    t = T(n)
    logf = np.full(n, np.log(hz(notes[0][2])))
    amp = np.zeros(n)
    cut = np.full(n, 1200.0)
    vib = np.zeros(n)
    for i, (on, off, m) in enumerate(notes):
        nxt = notes[i + 1][0] if i + 1 < len(notes) else n / SR
        a, b = N(on), min(n, N(nxt))
        logf[a:b] = np.log(hz(m))
        amp += gate(n, on, off, 0.006, 0.05)
        seg = t[a:b] - on
        cut[a:b] = 1300 + 3800 * np.exp(-seg / 0.15)
        vib[a:b] = np.clip((seg - 0.2) / 0.25, 0, 1) * (t[a:b] < off)
    k = np.exp(-1.0 / (glide * SR))
    from scipy.signal import lfilter
    logf = lfilter([1 - k], [1, -k], logf, zi=[k * logf[0]])[0]
    f = np.exp(logf) * (1 + vib_depth * vib * np.sin(PI2 * 5.5 * t))
    osc = 0.6 * pulse(f, n, 0.5 + 0.12 * np.sin(PI2 * 0.4 * t), os=4) + 0.4 * saw(f * 1.004, n, os=4)
    return tvbq(osc, 'lp', cut, 1.4) * np.minimum(amp, 1.0)


def tape_master(x, r, wow=0.003, flutter=0.001, lp=10000, hiss_db=-52, drive=1.5, circular=True):
    x = wow_flutter(x, r, wow=wow, flutter=flutter, circular=circular)
    x = sat(x, drive, 0.05)
    x = circ(bw, x, 'lp', lp, 2) if circular else bw(x, 'lp', lp, 2)
    x = circ(eq, x, ('ls', 90, 0.7, 2.0)) if circular else eq(x, ('ls', 90, 0.7, 2.0))
    n = x.shape[-1]
    lvl = rms(x)
    hiss = np.stack([pink(r, n), pink(r, n)]) if x.ndim == 2 else pink(r, n)
    hiss = circ(bw, hiss, 'hp', 1500) if circular else bw(hiss, 'hp', 1500)
    return x + hiss * lvl * 10 ** (hiss_db / 20) * 3


# =============================================================================
# Rustgrin's Theme - music box (power-out song, title, ending)
# =============================================================================
def _box_events(theme, chords, tempo, t0=0.0, mel_vel=1.0, acc=True, acc_vel=0.5, jitter=0.0, r=None,
                bass_oct=3, pah_low=60, pah_high=71):
    notes, end = parse_line(theme, 3)
    ev = []
    for b, d, m in notes:
        if m is None:
            continue
        j = r.uniform(-jitter, jitter) if (jitter and r is not None) else 0.0
        ev.append((t0 + tempo(b) + j, m, mel_vel))
    if acc:
        for i, ch in enumerate(chords):
            b = 3 * i
            root, iv = chord(ch, bass_oct)
            tones = voicing(ch, pah_low, pah_high)
            ev.append((t0 + tempo(b), root, acc_vel))
            ev.append((t0 + tempo(b + 1), tones[0], acc_vel * 0.62))
            ev.append((t0 + tempo(b + 1), tones[min(2, len(tones) - 1)], acc_vel * 0.5))
            ev.append((t0 + tempo(b + 2), tones[1], acc_vel * 0.55))
            ev.append((t0 + tempo(b + 2), tones[-1], acc_vel * 0.45))
    return ev


def rustgrin_song(v, r, n):
    """the power-out song: wound-up music box, slowing as the spring runs down"""
    tempo = Tempo([(0, 150), (38, 150), (46, 88), (60, 88)], wobble=0.012, wob_period=6.0)
    t0 = 0.32
    ev = _box_events(RUSTGRIN_THEME, RUSTGRIN_CHORDS, tempo, t0, mel_vel=1.0, acc_vel=0.3, jitter=0.006, r=r)
    box = render_music_box(ev, n, r, detune=11.0, seed='mb-song', bright=1.0, ring=5.0)
    # mechanism: the governor fan whirs while the cylinder turns, slowing at the end
    t = T(n)
    t_end = t0 + tempo(46)
    sp = np.clip(1 - (t - t0 - tempo(38)) / (t_end - t0 - tempo(38)), 0, 1) ** 0.6
    sp = np.where(t < t0 + tempo(38), 1.0, sp) * (t > t0)
    whir = U(bw(white(r, n), 'bp', (1500, 5000))) * (0.6 + 0.4 * np.sin(PI2 * phase(36 * sp + 4, n))) * sp
    ticks = click_train(r, n, 3.0 + 9 * sp, jitter=0.3, t0=t0, t1=t_end)
    tk = resonators(ticks, small_metal('mbox'))
    lever = hit(n, 0.02, small_metal('lever'), 0.0004) + hit(n, 0.05, plastic_modes('box'), 0.0008)
    stop = hit(n, t_end + 0.25, small_metal('lever'), 0.0006) + 0.6 * hit(n, t_end + 0.25, plastic_modes('box'), 0.001)
    box = P(box) + 0.012 * whir + 0.05 * P(tk) + 0.3 * P(lever) + 0.25 * P(stop)
    box = eq(box, ('peak', 520, 1.0, 3.0), ('peak', 2600, 1.2, 1.5))
    box = bw(box, 'hp', 160, 2)
    return reverb(box, ir_office(), wet=0.2)


def _pad(chords, times, n, r, low_oct=2, mid=(48, 60), cutoff=700.0, att=1.2, rel=1.6, voices=3, detune=8.0,
         wrap=False, overlap=0.0):
    """slow saw-ensemble pad following a chord list; times = [(t_on, t_off)]"""
    out = np.zeros(n)
    for ch, (on, off) in zip(chords, times):
        root, iv = chord(ch, low_oct)
        notes = [root] + voicing(ch, mid[0], mid[1])
        m = N(off - on + att + rel + overlap)
        for k, mm in enumerate(notes):
            f = hz(mm)
            s = np.zeros(m)
            for j in range(voices):
                c = detune * (j - (voices - 1) / 2) / max(1, (voices - 1) / 2) + r.uniform(-1.5, 1.5)
                s += saw(f * 2 ** (c / 1200), m, r.uniform())
            s = bw(s / voices, 'lp', cutoff, 2) * gate(m, 0.0, off - on + overlap, att, rel)
            place(out, s * (1.0 if k else 0.8), on, wrap=wrap)
    return out


def music_title(v, r, n):
    """slow, detuned music box over a dark pad - 16 bars of 3/4 at 72 bpm = 40 s"""
    beat = 60.0 / 72
    L = n
    off = 0.12
    tempo = (lambda b: b * beat)
    ev = _box_events(RUSTGRIN_THEME, RUSTGRIN_CHORDS, tempo, off, mel_vel=1.0, acc=False, jitter=0.03, r=r)
    acc = []
    for i, ch in enumerate(RUSTGRIN_CHORDS):
        root, _ = chord(ch, 3)
        acc.append((off + 3 * i * beat + 0.01, root, 0.3))
        tones = voicing(ch, 60, 71)
        acc.append((off + (3 * i + 1.5) * beat, tones[1 % len(tones)], 0.16))
    box = render_music_box(ev + acc, L, r, wrap=True, detune=24.0, seed='mb-title', bright=0.9, ring=6.0)
    # ghost: same melody an octave down, one beat late, very quiet (canon)
    ghost_ev = [(tt + beat, m - 12, 0.5) for tt, m, vv in ev]
    ghost = render_music_box(ghost_ev, L, r, wrap=True, detune=30.0, seed='mb-ghost', bright=0.6, ring=6.0)
    box = wow_flutter(box, r, wow=0.004, wow_hz=0.37, flutter=0.0008, circular=True)
    ghost = wow_flutter(ghost, r, wow=0.006, wow_hz=0.29, flutter=0.001, circular=True)
    # reversed tines swelling into bar 1 and bar 9
    swell = np.zeros(L)
    for bar, nm in ((0, 'A5'), (8, 'E6')):
        s = music_box_note(hz(midi(nm)), 2.2, r, 0.8, 0.8)[::-1]
        place(swell, s, off + 3 * bar * beat - 2.2 + 0.02, wrap=True)
    # dark pad: chords held per two bars where they repeat
    times = [(off + 3 * i * beat - 0.3, off + 3 * (i + 1) * beat - 0.3) for i in range(16)]
    pad = _pad(RUSTGRIN_CHORDS, times, L, r, low_oct=2, mid=(50, 62), cutoff=650, att=1.4, rel=1.8, wrap=True,
               overlap=0.4)
    sweep = 0.5 + 0.5 * periodic_lfo(L, 2, r)
    pad_b = circ(bw, pad, 'lp', 1100, 2)
    pad = pad * (1 - 0.5 * sweep) + pad_b * 0.5 * sweep
    t = T(L)
    drone = 0.6 * np.sin(PI2 * 55.0 * t) + 0.25 * circ(bw, saw(110.0, L), 'lp', 300, 2) \
        + 0.15 * np.sin(PI2 * loop_hz(82.2, L) * t)
    drone *= 1 + 0.2 * periodic_lfo(L, 3, r)
    air = np.stack([band_noise(r, L, 1500, 6000), band_noise(r, L, 1500, 6000)]) \
        * (0.5 + 0.5 * periodic_lfo(L, 3, r)) ** 2
    mix = np.zeros((2, L))
    place(mix, U(box) * 0.5, 0, p=-0.15)
    place(mix, U(ghost) * 0.1, 0, p=0.45)
    place(mix, P(swell) * 0.25 * float(np.max(np.abs(U(box)))), 0, p=0.3)
    place(mix, U(pad) * 0.2, 0)
    place(mix, U(drone) * 0.16, 0)
    mix += air * 0.012
    mix = reverb(mix, ir_big_st(), wet=0.42, circular=True)
    mix = circ(bw, mix, 'lp', 9000, 2)
    return mix


def music_ending(v, r, n):
    """Rustgrin's Theme turning to A major: music box + warm strings, bells"""
    tempo = Tempo([(0, 132), (17, 132), (21, 104), (30, 96)])
    t0 = 0.15
    ev = _box_events(ENDING_THEME, ENDING_CHORDS, tempo, t0, mel_vel=1.0, acc_vel=0.3, jitter=0.004, r=r)
    box = render_music_box(ev, n, r, detune=5.0, seed='mb-end', bright=0.95, ring=5.0)
    t_last = t0 + tempo(21)
    dur = n / SR
    chords = ['D', 'D', 'E', 'A']
    bars = [3, 4, 5, 6]
    times = [(t0 + tempo(3 * b), t0 + tempo(3 * (b + 1))) for b in bars]
    times[-1] = (times[-1][0], dur - 1.6)
    pad = _pad(chords, times, n, r, low_oct=2, mid=(52, 66), cutoff=1700, att=0.9, rel=1.4, voices=5, detune=10)
    fin = _pad(['A'], [(t_last, dur - 1.3)], n, r, low_oct=2, mid=(57, 73), cutoff=2200, att=0.6, rel=1.2,
               voices=5, detune=9)
    mix = np.zeros((2, n))
    place(mix, U(box) * 0.5, 0, p=-0.1)
    place(mix, U(pad) * 0.16, 0, p=0.2)
    place(mix, U(fin) * 0.2, 0, p=-0.2)
    for i, nm in enumerate(['A6', 'E6', 'C#7', 'A5', 'E7']):
        place(mix, glock(hz(midi(nm)), 3.0, r, bright=0.6) * 0.06 * float(np.max(np.abs(U(box)))),
              t_last + 0.02 + 0.16 * i, p=-0.6 + 0.3 * i)
    mix = reverb(mix, ir_big_st(), wet=0.35)
    return mix * env_pts(n, [(0, 1), (dur - 1.4, 1), (dur, 0)])


# =============================================================================
# the Midway - steam calliope
# =============================================================================
C_MAJOR = (0, 2, 4, 5, 7, 9, 11)


def third_below(m):
    pc = m % 12
    if pc in C_MAJOR:
        i = C_MAJOR.index(pc)
        tgt = C_MAJOR[(i - 2) % 7]
        return m - ((pc - tgt) % 12)
    return m - 3


def _cal_detune(m):
    return float(rng('calliope-pipe', m).uniform(-14, 14))


@functools.lru_cache(maxsize=None)
def show_dry():
    """dry mono mix of the Midway waltz (16 bars, 180 bpm, exactly 16 s, circular)"""
    r = rng('show-dry')
    beat = 1.0 / 3.0
    L = N(SHOW_DUR)
    off = 0.05
    buf = np.zeros(L)
    notes, _ = parse_line(CALLIOPE_TUNE, 3)
    mel = np.zeros(L)
    har = np.zeros(L)
    for b, d, m in notes:
        if m is None:
            continue
        place(mel, calliope_note(hz(m), d * beat * 0.9, r, 1.0, _cal_detune(m)), off + b * beat, wrap=True)
        bar = int(b // 3)
        if bar >= 8 or bar in (2, 3):
            h = third_below(m)
            place(har, calliope_note(hz(h), d * beat * 0.9, r, 0.5, _cal_detune(h), bright=0.9), off + b * beat,
                  wrap=True)
    oom = np.zeros(L)
    pah = np.zeros(L)
    drum = np.zeros(L)
    gl = np.zeros(L)
    kit = drum_kit()
    prev = None
    for i, ch in enumerate(CALLIOPE_CHORDS):
        b = 3 * i
        root, iv = chord(ch, 3)
        if root > midi('F3'):
            root -= 12
        bass = root + 7 if ch == prev else root
        prev = ch
        place(oom, calliope_note(hz(bass), 0.8 * beat, r, 0.75, _cal_detune(bass), bright=0.85), off + b * beat,
              wrap=True)
        tones = voicing(ch, midi('G3'), midi('F4'))[:3]
        for bb in (1, 2):
            for m in tones:
                place(pah, calliope_note(hz(m), 0.5 * beat, r, 0.32, _cal_detune(m), bright=0.8), off + (b + bb) * beat,
                      wrap=True)
        place(drum, kit['bd'] * 0.8, off + b * beat, wrap=True)
    for b, d, m in notes:
        if m is not None and int(b // 3) >= 8:
            place(gl, glock(hz(m + 12), 1.2, r, bright=0.7), off + b * beat, wrap=True)
    t = T(L)
    steam = band_noise(r, L, 2500, 9000) * (0.7 + 0.3 * periodic_lfo(L, 16, r))
    mix = U(mel) * 1.0 + U(har) * 0.35 + U(oom) * 0.55 + U(pah) * 0.4 + U(drum) * 0.35 + U(gl) * 0.12 \
        + steam * 0.02
    return mix


def tophat_show(v, r, n):
    x = show_dry()
    x = reverb(x, ir_midway(), wet=0.3, circular=True)
    x = wow_flutter(x, r, wow=0.0015, wow_hz=0.5, flutter=0.0006, circular=True)
    x = circ(bw, x, 'lp', 11000, 2)
    return fit(x, n)


def tophat_show_slow(v, r, n):
    """the same tape at ~70 % speed: pitch down, deep wow, detune, dull and worn"""
    x = reverb(show_dry(), ir_midway(), wet=0.3, circular=True)
    L0 = x.shape[-1]
    s = L0 / n
    t = T(n)
    dev = (0.016 * np.sin(PI2 * loop_hz(0.42, n) * t + 0.3) + 0.007 * np.sin(PI2 * loop_hz(1.13, n) * t + 2.0)
           + 0.003 * np.sin(PI2 * loop_hz(6.8, n) * t) + 0.006 * periodic_lfo(n, 5, r, harmonics=3))
    dev -= dev.mean()
    y = varispeed(x, s * (1 + dev), circular=True)
    y = sat(y * 1.4, 1.8, 0.1)
    y = circ(bw, y, 'lp', 5200, 2)
    y = circ(eq, y, ('peak', 300, 0.8, 2.0))
    lvl = 1 - 0.18 * (0.5 + 0.5 * periodic_lfo(n, 3, r)) - 0.25 * np.exp(-0.5 * (((t - 9.3 + n / SR / 2) % (n / SR) - n / SR / 2) / 0.08) ** 2)
    hiss = circ(bw, pink(r, n), 'hp', 1200)
    return y * lvl + hiss * rms(y) * 0.02


def tophat_fanfare(v, r, n):
    """"Step right up!" - pickup triplet, rising arpeggio, held chord + crash"""
    kit = drum_kit()
    out = np.zeros(n)
    tri = 0.5 / 3
    seq = [(0.02, 'G4', 0.1, 1.0), (0.02 + tri, 'G4', 0.1, 0.9), (0.02 + 2 * tri, 'G4', 0.1, 0.95),
           (0.52, 'C5', 0.44, 1.0), (1.02, 'E5', 0.22, 1.0), (1.27, 'G5', 0.22, 1.0), (1.52, 'C6', 1.15, 1.1)]
    for tt, nm, d, vel in seq:
        m = midi(nm)
        place(out, calliope_note(hz(m), d, r, vel, _cal_detune(m), rel=0.035 if d < 0.2 else 0.12), tt)
    under = [(0.52, ['E4', 'G4'], 0.44), (1.02, ['C4', 'E4'], 0.22), (1.27, ['E4', 'B4'], 0.22),
             (1.52, ['C5', 'E5', 'G5', 'C4'], 1.15)]
    for tt, nms, d in under:
        for nm in nms:
            m = midi(nm)
            place(out, calliope_note(hz(m), d, r, 0.38, _cal_detune(m), rel=0.12, bright=0.85), tt)
    for tt in (0.52, 1.02):
        place(out, kit['bd'] * 0.5, tt)
    place(out, calliope_note(hz(midi('C3')), 1.15, r, 0.7, 0.0, rel=0.12), 1.52)
    place(out, kit['bd'] * 0.9, 1.52)
    place(out, kit['crash'] * 0.45, 1.52)
    out = reverb(out, ir_midway(), wet=0.3)
    return out


def tophat_rewind(v, r, n):
    t = T(n)
    x = show_dry()
    sp = env_pts(n, [(0.0, 0.0), (0.03, -2.0), (0.85, -14.0), (0.93, -15.0)])
    chip = varispeed(x, sp, circular=True, start=N(8.0))
    chip = bw(chip, 'bp', (900, 6500), 2) * env_pts(n, [(0, 0), (0.05, 0.6), (0.9, 1.0), (0.93, 0)])
    mot_sp = env_pts(n, [(0.0, 0.0), (0.04, 0.2), (0.9, 1.0), (0.93, 0.0)])
    motor = servo(r, n, mot_sp, base=260, span=1100, ratio=0.5, index=1.2, gear=0.2, grit=0.1)
    hiss = bw(white(r, n), 'bp', (2000, 10000)) * mot_sp
    key = hit(n, 0.006, plastic_modes('deck'), 0.0005) + 0.6 * hit(n, 0.006, small_metal('deck'), 0.0003)
    stop = hit(n, 0.93, plastic_modes('deck'), 0.0008) + 0.8 * hit(n, 0.935, small_metal('deck'), 0.0004)
    return 0.35 * P(chip) + 0.45 * P(motor) + 0.08 * P(hiss) + 0.5 * P(key) + 0.6 * P(stop)


def tophat_tape_out(v, r, n):
    t = T(n)
    x = reverb(show_dry(), ir_midway(), wet=0.3, circular=True)
    ts, te = 0.25, 1.15
    sp = np.where(t < ts, 1.0, np.clip(1 - (t - ts) / (te - ts), 0, 1) ** 1.6)
    mus = varispeed(x, sp, circular=True, start=N(4.0))
    mus = tvbq(mus, 'lp', 250 + 9000 * sp, 0.7) * sp ** 0.4
    # loose end of the tape slapping as the reel spins down
    t1, t2 = 1.02, 2.4
    rate = np.where(t < t1, 0.0, 12.0 * np.exp(-(t - t1) / 1.0))
    ph = np.cumsum(rate) / SR
    idx = np.nonzero(np.diff(np.floor(ph)) > 0)[0] + 1
    idx = idx[t[idx] < t2]
    ex = np.zeros(n)
    nz = np.zeros(n)
    for i in idx:
        a = np.exp(-(t[i] - t1) / 0.9)
        ex += strike(n, t[i], 0.0004, a)
        nz += bw(white(r, n), 'bp', (1000, 6000)) * gate(n, t[i], t[i] + 0.006, 0.0005, 0.004) * a
    slap = resonators(ex, plastic_modes('reel'))
    hum = np.sin(PI2 * phase(60 * np.exp(-np.maximum(t - te, 0) / 0.5), n)) * env_pts(n, [(0, 0.3), (te, 0.3), (2.2, 0)])
    return 1.0 * P(mus) + 0.45 * P(slap) + 0.25 * P(nz) + 0.06 * P(hum)


# =============================================================================
# "Pizza Party Tonight" - the Rusty Revue's daytime song
# =============================================================================
def music_showtime(v, r, n):
    beat = 0.5
    L = n
    off = 0.03
    bt = (lambda b: off + b * beat)
    kit = drum_kit()
    drums = np.zeros((2, L))
    for bar in range(24):
        sec = SHOW_SECTIONS[bar]
        b0 = 4 * bar
        kicks = [0, 2] + ([2.5] if sec in ('chorus', 'bridge') and bar % 2 else []) + ([1.5] if sec == 'chorus' else [])
        for k in kicks:
            place(drums, kit['kick'] * 0.95, bt(b0 + k), wrap=True)
        fill = (bar == 9 or bar == 1, bar == 17, bar == 23)
        for k in (1, 3):
            if bar == 23 and k == 3:
                continue
            place(drums, kit['snare'] * 0.8, bt(b0 + k), wrap=True)
            if sec == 'chorus':
                place(drums, kit['clap'] * 0.45, bt(b0 + k) + 0.004, wrap=True, p=0.15)
        for h in np.arange(0, 4, 0.5):
            if (fill[0] or fill[1]) and h >= 3:
                continue
            if fill[2] and h >= 2:
                continue
            openh = sec in ('chorus', 'bridge') and h == 3.5
            place(drums, (kit['ohat'] if openh else kit['hat']) * (0.46 if h % 1 else 0.34), bt(b0 + h), wrap=True,
                  p=0.3)
        if bar in (0, 2, 10, 18, 22):
            place(drums, kit['crash'] * 0.4, bt(b0), wrap=True, p=-0.35)
        if fill[0]:
            for i, h in enumerate((3, 3.25, 3.5, 3.75)):
                place(drums, kit['snare'] * (0.45 + 0.12 * i), bt(b0 + h), wrap=True)
        if fill[1]:
            for i, (h, tn) in enumerate(((3, 'tom_hi'), (3.25, 'tom_hi'), (3.5, 'tom_lo'), (3.75, 'tom_lo'))):
                place(drums, kit[tn] * 0.7, bt(b0 + h), wrap=True, p=0.3 - 0.2 * i)
        if fill[2]:
            seq = ['snare', 'snare', 'tom_hi', 'tom_hi', 'snare', 'tom_hi', 'tom_lo', 'tom_lo']
            for i, nm in enumerate(seq):
                place(drums, (kit[nm] if nm != 'snare' else kit['snare']) * (0.5 + 0.06 * i), bt(b0 + 2 + 0.25 * i),
                      wrap=True, p=0.3 - 0.08 * i)
    # bass: bouncy octave 8ths
    bass = np.zeros(L)
    for bar, ch in enumerate(SHOW_CHORDS):
        root, iv = chord(ch, 2)
        if SHOW_SECTIONS[bar] == 'intro':
            pat = [(0, 0, 0.9), (1, 12, 0.4), (2, 0, 0.9), (3, 12, 0.9)]
        else:
            pat = [(h * 0.5, o, 0.42 if h else 0.85) for h, o in enumerate([0, 0, 12, 0, 7, 0, 12, 0])]
        for h, o, d in pat:
            m = root + o
            place(bass, bass_note(hz(m), d * beat, r, 1.0 if h % 1 == 0 else 0.8), bt(4 * bar + h), wrap=True)
    # organ
    org = np.zeros(L)
    for bar, ch in enumerate(SHOW_CHORDS):
        sec = SHOW_SECTIONS[bar]
        tones = voicing(ch, 55, 68)
        if sec in ('intro', 'verse', 'bridge'):
            hits = [(0.0, 3.97)]
        elif sec == 'chorus':
            hits = [(0.0, 0.4), (0.5, 0.3), (1.5, 0.3), (2.5, 0.3), (3.0, 0.4), (3.5, 0.3)]
        else:
            hits = [(0.0, 0.8), (1.0, 0.8), (2.0, 0.8), (3.0, 0.8)]
        for h, d in hits:
            for m in tones:
                place(org, organ_note(hz(m), d * beat, r, 1.0), bt(4 * bar + h), wrap=True)
    org_st = leslie(org, r, rate=6.3, circular=True)
    # rhythm guitar chops on 2 and 4 (Mirehop)
    gtr = np.zeros(L)
    for bar, ch in enumerate(SHOW_CHORDS):
        sec = SHOW_SECTIONS[bar]
        if sec == 'intro':
            continue
        tones = voicing(ch, 52, 67)[:4]
        vel = 0.6 if sec == 'verse' else 1.0
        for h in (1, 3):
            place(gtr, guitar_chord(tones, 0.22 * beat * 2, r, vel), bt(4 * bar + h), wrap=True)
        if sec == 'chorus':
            place(gtr, guitar_chord(tones, 0.2, r, 0.5), bt(4 * bar + 3.5), wrap=True)
    # backing "ooh"s (Noxbriar) in the chorus, "aah" in the bridge
    vox = np.zeros((2, L))
    for bar, ch in enumerate(SHOW_CHORDS):
        sec = SHOW_SECTIONS[bar]
        if sec not in ('chorus', 'bridge'):
            continue
        tones = voicing(ch, 64, 76)
        pick = [tones[0], tones[min(2, len(tones) - 1)]]
        for i, m in enumerate(pick):
            vw = 'o' if sec == 'chorus' else 'a'
            s = ooh_note(hz(m), 3.8 * beat, r, vowel_end=vw, fscale=1.15)
            place(vox, s, bt(4 * bar) + 0.02, wrap=True, p=-0.5 if i == 0 else 0.5)
    # lead line
    notes, _ = parse_line(SHOW_LEAD, 4)
    ln = [(bt(b), bt(b) + d * beat * 0.9, m) for b, d, m in notes if m is not None]
    lead_lin = mono_lead(ln, L + N(1.0), r)
    lead = lead_lin[:L].copy()
    lead[:N(1.0)] += lead_lin[L:]
    slap = np.roll(lead, N(0.125)) * 0.25
    lead_st = np.stack([lead + slap * 0.6, lead + slap])
    # mix
    def bus(x, g):
        return U(x) * g
    mix = np.zeros((2, L))
    mix += bus(drums, 0.42)
    place(mix, bus(bass, 0.36), 0)
    mix += bus(org_st, 0.2)
    place(mix, bus(gtr, 0.13), 0, p=0.5)
    mix += bus(vox, 0.12)
    mix += bus(lead_st, 0.3)
    send = bus(org_st, 0.2) + bus(lead_st, 0.3) * 0.7 + bus(vox, 0.12)
    mix += reverb(send, ir_stage_st(), wet=0.22, dry=0.0, circular=True)
    mix = comp(mix, thresh_db=-14, ratio=2.5, att=0.005, rel=0.15)
    mix = tape_master(mix, r, wow=0.0035, flutter=0.0012, lp=11500, hiss_db=-50, drive=1.4, circular=True)
    side = (mix[0] - mix[1]) * 0.5 * 0.8
    mid = (mix[0] + mix[1]) * 0.5
    mix = np.stack([mid + side, mid - side])
    t = T(L)
    dur = L / SR
    dips = np.ones(L)
    for tc in (13.7, 31.2):
        dd = (t - tc + dur / 2) % dur - dur / 2
        dips -= 0.4 * np.exp(-0.5 * (dd / 0.05) ** 2)
    return mix * dips
