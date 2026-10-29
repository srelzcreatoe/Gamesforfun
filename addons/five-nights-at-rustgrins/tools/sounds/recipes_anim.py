"""Recipes: animatronics (mono, positional) and jumpscares (stereo).

Mechanical sounds use modal synthesis (strikes through resonator banks),
voices use a saw/aspiration source through moving formant filters, the
guitar is Karplus-Strong. Jumpscares stack an impact, screaming formant
voices, a creature-specific layer and a servo grind, then go through
oversampled hard saturation.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import lfilter

from fnar_dsp import (N, PI2, SR, T, ar, bitcrush, bw, click_train, decay, env_pts, eq, fm, formants, gate, hz,
                      ks_string, oversampled, phase, place, pulse, resonators, reverb, saw, sat, servo,
                      smooth_noise, strike, tvbq, varispeed, voice_src, vowel_track, white, wow_flutter, midi, fit)
from recipes_common import (P, door_modes, duct_modes, frame_modes, hit, ir_dining_st, ir_duct, ir_hall,
                            ir_midway, ir_office, small_metal, thud, tile_modes, vent_modes, wood_modes,
                            slat_modes)
from recipes_music import _cal_detune, calliope_note, drum_kit, guitar_chord


# =============================================================================
# footsteps
# =============================================================================
def step_heavy(v, r, n):
    t0 = 0.006
    th = thud(r, n, t0, 100 * r.uniform(0.9, 1.1), 46, 0.2, 0.03, noise=0.8, noise_lp=220)
    tile = hit(n, t0 + 0.001, tile_modes(), 0.0006)
    foot = hit(n, t0, frame_modes('foot%d' % (v % 2)), 0.0009)
    tc = t0 + r.uniform(0.06, 0.11)
    clink = hit(n, tc, small_metal('clink%d' % v), 0.0002)
    sp = gate(n, tc - 0.012, tc + 0.045, 0.01, 0.02)
    whine = servo(r, n, sp, base=r.uniform(500, 800), span=200, gear=0.3)
    rat = click_train(r, n, 35, jitter=0.4, amp_jitter=0.6, t0=t0 + 0.01, t1=t0 + 0.12) * decay(n, 0.1, t0)
    rattle = resonators(rat, frame_modes('rattle'))
    mix = 1.0 * P(th) + 0.5 * P(tile) + 0.45 * P(foot) + 0.22 * P(clink) + 0.1 * P(whine) + 0.12 * P(rattle)
    return reverb(mix, ir_hall(), wet=0.2)


def _light_step(r, n, t0, seed=0, bright=1.0):
    th = thud(r, n, t0, 150, 85, 0.08, 0.015, noise=0.5, noise_lp=400)
    heel = hit(n, t0, tile_modes(), 0.0005)
    toe = hit(n, t0 + r.uniform(0.018, 0.03), tile_modes(), 0.0004, 0.6)
    tick = hit(n, t0 + 0.002, small_metal('catclaw%d' % (seed % 2)), 0.00015)
    return 0.8 * P(th) + 0.6 * bright * P(heel) + 0.4 * bright * P(toe) + 0.15 * bright * P(tick)


def step_light(v, r, n):
    return reverb(_light_step(r, n, 0.005, v), ir_hall(), wet=0.18)


def step_scurry(v, r, n):
    taps = []
    tt = 0.01
    while tt < 0.5:
        taps.append(tt)
        tt += r.uniform(0.028, 0.06)
    out = np.zeros(n)
    span = taps[-1]
    for i, tt in enumerate(taps):
        a = np.sin(np.pi * (0.15 + 0.85 * tt / span) * 0.9) * r.uniform(0.6, 1.0)
        out += a * (P(hit(n, tt, tile_modes(), 0.00015)) * 0.7 + P(hit(n, tt, small_metal('claw'), 0.0001)) * 0.3
                    + P(thud(r, n, tt, 260, 190, 0.03, 0.005, noise=0.2)) * 0.35)
    scratch = bw(white(r, n), 'bp', (3000, 8000)) * (0.5 + 0.5 * smooth_noise(r, n, 25)) ** 2 * gate(n, 0.01, span, 0.02, 0.05)
    return reverb(P(out) + 0.08 * P(scratch), ir_hall(), wet=0.15)


# =============================================================================
# servos
# =============================================================================
def _bell_curve(n, segs):
    t = T(n)
    sp = np.zeros(n)
    for a, b, h in segs:
        x = np.clip((t - a) / (b - a), 0, 1)
        sp = np.maximum(sp, h * np.sin(np.pi * x) ** 0.8)
    return sp


def servo_move(v, r, n):
    segs = [[(0.04, 0.68, 1.0)], [(0.03, 0.3, 1.0), (0.38, 0.7, 0.8)], [(0.05, 0.75, 0.6)]][v]
    sp = _bell_curve(n, segs)
    whine = servo(r, n, sp, base=[420, 520, 300][v], span=[600, 500, 350][v], ratio=[0.5, 0.25, 0.5][v], index=1.6)
    groan = resonators(click_train(r, n, 50 + 90 * sp, jitter=0.35, amp_jitter=0.6) * sp, frame_modes('joint%d' % v))
    fric = bw(white(r, n), 'bp', (300, 2500)) * sp
    tend = max(b for a, b, h in segs)
    clunk = hit(n, tend - 0.01, frame_modes('stop'), 0.001) + 0.5 * thud(r, n, tend - 0.01, 140, 90, 0.05, 0.01, noise=0.2)
    mix = 0.6 * P(whine) + 0.35 * P(groan) * (1.4 if v == 2 else 1.0) + 0.06 * P(fric) + 0.35 * P(clunk)
    return reverb(mix, ir_hall(), wet=0.15)


def servo_head(v, r, n):
    sp = env_pts(n, [(0.01, 0), (0.06, 1.0), (0.24, 1.0), (0.3, 0.0)]) ** 1.2
    whine = servo(r, n, sp, base=[700, 860][v], span=[700, 520][v], ratio=0.5, index=1.3, gear=0.25)
    stop = hit(n, 0.302, small_metal('head%d' % v), 0.0002) + 0.5 * hit(n, 0.302, frame_modes('head'), 0.0006)
    tick = hit(n, 0.335, small_metal('head%d' % v), 0.0002, 0.3)
    return reverb(0.75 * P(whine) + 0.35 * P(stop) + 0.08 * P(tick), ir_hall(), wet=0.12)


# =============================================================================
# Mirehop - guitar
# =============================================================================
GTR_CHORDS = [[40, 47, 52, 55, 59, 64],      # E minor
              [40, 46, 52, 55, 58, 64],      # E with a flat fifth (tritone)
              [41, 48, 53, 56, 60, 65]]      # F minor, a semitone up: wrong, sour


def mirehop_strum(v, r, n):
    s = np.zeros(n)
    pick = np.zeros(n)
    for i, m in enumerate(GTR_CHORDS[v]):
        f = hz(m) * 2 ** (r.uniform(-28, 28) / 1200)
        st = ks_string(f, n / SR, r, t60=r.uniform(3.5, 5.5), bright=0.36, pick=r.uniform(0.1, 0.2))
        to = 0.006 + i * 0.016 + r.uniform(0, 0.004)
        place(s, st * r.uniform(0.7, 1.0), to)
        pick += bw(white(r, n), 'bp', (2000, 6000)) * ar(n, 0.0005, 0.012, to)
    s = P(s) + 0.05 * P(pick)
    s = oversampled(lambda z: np.tanh(3.5 * z + 0.25) - np.tanh(0.25), s, 2)
    s = eq(s, ('peak', 1600, 0.9, 3.0), ('peak', 400, 1.0, -2.0))
    s = bw(bw(s, 'lp', 4800, 2), 'hp', 90, 2)
    t = T(n)
    hum = (np.sin(PI2 * 60 * t) + 0.5 * np.sin(PI2 * 180 * t)) * 0.008
    s = P(s) + hum
    s = reverb(s, ir_hall(), wet=0.22)
    return s * env_pts(n, [(0, 1), (1.55, 1), (2.0, 0)])


# =============================================================================
# Noxbriar - humming
# =============================================================================
HUM_LINES = [
    [(0.25, 'A4', 1.0), (1.25, 'Bb4', 0.6), (1.85, 'A4', 0.55), (2.4, 'G4', 0.8), (3.2, 'F4', 0.6), (3.8, 'E4', 1.0)],
    [(0.25, 'D4', 0.8), (1.05, 'F4', 0.8), (1.85, 'A4', 0.9), (2.75, 'G#4', 0.55), (3.3, 'A4', 0.5), (3.8, 'E4', 1.0)],
]


def noxbriar_hum(v, r, n):
    t = T(n)
    line = HUM_LINES[v]
    logf = np.full(n, np.log(hz(midi(line[0][1]))))
    vib = np.zeros(n)
    amp = np.zeros(n)
    keys = [(0.0, 'm')]
    for i, (on, nm, d) in enumerate(line):
        a = N(on)
        logf[a:] = np.log(hz(midi(nm)))
        x = np.clip((t - on - 0.25) / 0.3, 0, 1) * (t < on + d)
        vib = np.maximum(vib, x)
        amp += gate(n, on, on + d * 0.97, 0.09 if i else 0.25, 0.12)
        if d >= 0.75:
            keys += [(on + 0.15, 'm'), (on + d * 0.5, 'u'), (on + d * 0.8, 'o'), (on + d, 'm')]
        else:
            keys += [(on + 0.05, 'm'), (on + d * 0.6, 'u'), (on + d, 'm')]
    keys.append((n / SR, 'm'))
    keys.sort(key=lambda k: k[0])
    k = np.exp(-1.0 / (0.06 * SR))
    logf = lfilter([1 - k], [1, -k], logf, zi=[k * logf[0]])[0]
    F, B = vowel_track(n, keys, fscale=1.17)
    # overlapping note envelopes: soft-limit and smooth (a hard min() leaves kinks that splatter)
    amp_s = bw(np.tanh(1.3 * amp) / np.tanh(1.3), 'lp', 25, 2)

    def sing(detune):
        f0 = np.exp(logf) * 2 ** (detune / 1200) * (1 + 0.006 * vib * np.sin(PI2 * 5.0 * t + r.uniform(0, PI2))
                                                    + 0.004 * smooth_noise(r, n, 2))
        src = voice_src(r, f0, n, jitter=0.006, shimmer=0.04, breath=0.12, tilt=2200)
        return P(formants(src, F, B, (0, -7, -14, -20)) * amp_s)
    s = sing(0.0)
    # a faint double, a few cents sharp and 23 ms late: a choir of one
    s = s + 0.3 * fit(np.pad(sing(7.0), (N(0.023), 0)), n)
    breath_in = bw(white(r, n), 'bp', (800, 4000)) * gate(n, 0.02, 0.2, 0.08, 0.06)
    s = P(s) + 0.05 * P(breath_in)
    s = wow_flutter(s, r, wow=0.007, wow_hz=0.7, flutter=0.002, flutter_hz=7.5)
    s = sat(bw(s, 'bp', (150, 5500), 2) * 1.3, 1.3)
    s = bw(s, 'hp', 110, 2)                     # small, worn speaker
    s = s + 0.004 * bw(white(r, n), 'hp', 2000)
    return reverb(s, ir_hall(), wet=0.25)


# =============================================================================
# Rustgrin - feedback, laugh
# =============================================================================
def rustgrin_feedback(v, r, n):
    t = T(n)
    tc = 1.32
    if v == 0:
        f = 2650 * (1 + 0.012 * np.clip(t / 1.3, 0, 1))
        f = np.where(t < 0.95, f, 3120 + (t - 0.95) * 30)
    else:
        f = np.where(t < 0.85, 1380 * (1 + 0.02 * np.clip(t / 0.85, 0, 1)), 1720 + (t - 0.85) * 25)
    k = np.exp(-1.0 / (0.012 * SR))
    f = lfilter([1 - k], [1, -k], f, zi=[k * f[0]])[0]
    grow = -50 + 52 * np.clip(t / 1.22, 0, 1) ** 1.4
    a = 10 ** (grow / 20) * (1 + 0.15 * smooth_noise(r, n, 6))
    tone = np.sin(PI2 * phase(f, n)) + 0.6 * np.sin(PI2 * phase(f * 1.004, n))
    x = sat(tone * a * 2.5, 2.0) * (t < tc)
    hum = (np.sin(PI2 * 60 * t) + 0.5 * np.sin(PI2 * 120 * t) + 0.3 * np.sin(PI2 * 180 * t)) * 0.03 * (t < tc)
    pop = thud(r, n, tc, 90, 50, 0.08, 0.01, noise=0.4) + 0.4 * hit(n, tc, small_metal('pa'), 0.0003)
    y = P(x) + hum + 0.25 * P(pop)
    y = bw(y, 'hp', 50, 2)
    return reverb(y, ir_dining_st()[0], wet=0.18)


LAUGH_SYL = [[(0.06, 0.2), (0.34, 0.19), (0.6, 0.19), (0.86, 0.34)],
             [(0.05, 0.17), (0.28, 0.17), (0.5, 0.18), (0.74, 0.2), (1.0, 0.38)]]


def _laugh_voice(r, n, syl, f0_start, f0_end, fscale, vowel='uh', h_amt=0.6, per_drop=0.9):
    t = T(n)
    f0 = np.exp(np.interp(t, [0, n / SR], [np.log(f0_start), np.log(f0_end)]))
    venv = np.zeros(n)
    henv = np.zeros(n)
    keys = [(0.0, vowel)]
    for on, d in syl:
        x = np.clip((t - on) / d, 0, 1)
        f0 = f0 * np.where((t >= on) & (t < on + d), 1 - (1 - per_drop) * x, 1.0)
        henv += gate(n, on, on + 0.04, 0.008, 0.03)
        venv += gate(n, on + 0.025, on + d, 0.02, 0.06)
        keys += [(on + 0.01, vowel), (on + d * 0.7, vowel), (on + d, 'o')]
    keys.append((n / SR, 'o'))
    keys.sort(key=lambda k: k[0])
    return f0, venv, henv, keys


def rustgrin_laugh(v, r, n):
    t = T(n)
    syl = LAUGH_SYL[v]
    f0, venv, henv, keys = _laugh_voice(r, n, syl, [82, 76][v], [56, 50][v], 0.78)
    src = voice_src(r, f0, n, jitter=0.03, shimmer=0.12, breath=0.3, sub=0.5)
    F, B = vowel_track(n, keys, fscale=0.78)
    s = formants(src * venv, F, B, (0, -3, -9, -14))
    asp = formants(white(r, n) * henv, F, B, (0, -2, -6, -10))
    s = P(s) + 0.35 * P(asp)
    s = s * (0.7 + 0.3 * np.sin(PI2 * 31 * t))
    s = 0.75 * s + 0.25 * bitcrush(s, 7, 3)
    s = oversampled(lambda z: np.tanh(3.0 * z), s, 2)
    s = s * bw(np.minimum(venv + henv, 1.0), 'lp', 40, 2)        # keep the gaps between 'huh's
    s = eq(s, ('peak', 380, 1.0, 4.0))
    s = bw(bw(s, 'lp', 3800, 2), 'hp', 60, 2)
    jaw = np.zeros(n)
    for on, d in syl:
        jaw += hit(n, on, small_metal('jaw'), 0.0003, 0.6)
        jaw += servo(r, n, gate(n, on, on + 0.07, 0.01, 0.02), base=420, span=200, gear=0.3, grit=0.1) * 0.5
    s = P(s) + 0.12 * P(jaw)
    return reverb(s, ir_office(), wet=0.1)


# =============================================================================
# the Cat
# =============================================================================
BELL_SETS = [[3150, 3720, 4410], [2890, 3510, 4870]]
SHAKES = [[0.02, 0.27, 0.5, 0.72], [0.02, 0.14, 0.4, 0.55, 0.8]]


def _jingle(r, n, shakes, fs, amp=1.0):
    ratios = [1.0, 1.48, 2.02, 2.63, 3.4]
    t60s = [0.35, 0.25, 0.18, 0.12, 0.1]
    amps = [1.0, 0.6, 0.4, 0.25, 0.15]
    out = np.zeros(n)
    rat = np.zeros(n)
    for b, f in enumerate(fs):
        ex = np.zeros(n)
        for st in shakes:
            tt = st + r.uniform(0, 0.008)
            a = r.uniform(0.7, 1.0)
            for k in range(int(r.integers(3, 8))):
                ex += strike(n, tt, 0.00012, a)
                rat += strike(n, tt, 0.0001, a * 0.5)
                tt += r.uniform(0.003, 0.012)
                a *= 0.8
        out += resonators(ex, [(f * q * r.uniform(0.997, 1.003), d, a) for q, d, a in zip(ratios, t60s, amps)])
    return amp * (P(out) + 0.12 * P(bw(rat, 'hp', 6000)))


def cat_bell(v, r, n):
    s = _jingle(r, n, SHAKES[v], BELL_SETS[v])
    s = bw(s, 'lp', 12000, 2)
    return reverb(s, ir_hall(), wet=0.15)


def cat_run(v, r, n):
    t = T(n)
    steps = []
    tt, dt = 0.03, 0.165
    while tt < 1.9:
        steps.append(tt)
        tt += dt
        dt *= 0.985
    dur = n / SR
    dry = np.zeros(n)
    for i, st in enumerate(steps):
        dist = 1 - st / dur
        g = 10 ** (-24 * dist / 20) * (1.0 if i % 2 == 0 else 0.8)
        m = N(0.25)
        place(dry, _light_step(r, m, 0.002, i, bright=0.6 + 0.4 * (1 - dist)) * g, st)
        if i % 2 == 1:
            place(dry, _jingle(r, N(0.5), [0.0], BELL_SETS[0], 0.12 * g), st + 0.01)
    whine = servo(r, n, 0.5 + 0.5 * t / dur, base=500, span=300, gear=0.2, grit=0.1) * env_pts(n, [(0, 0.05), (dur, 0.35)])
    dry = P(dry) + 0.08 * P(whine) * env_pts(n, [(0, 0.1), (dur, 1)])
    near = tvbq(dry, 'lp', env_pts(n, [(0, 1500), (dur, 12000)], log=True), 0.7)
    wet = reverb(dry, ir_hall(), wet=1.0, dry=0.0)
    return near + wet * env_pts(n, [(0, 0.7), (dur, 0.18)])


def cat_bang(v, r, n):
    times = [[0.01, 0.33, 0.61, 0.98], [0.01, 0.2, 0.42], [0.01, 0.38, 0.58, 0.8]][v]
    amps = [[1.0, 0.85, 0.9, 1.0], [1.0, 1.0, 0.95], [0.9, 1.0, 0.8, 1.0]][v]
    ex = np.zeros(n)
    boom = np.zeros(n)
    rat = np.zeros(n)
    for tt, a in zip(times, amps):
        ex += strike(n, tt, r.uniform(0.0025, 0.004), a)
        boom += thud(r, n, tt, 85, 50, 0.3, 0.03, noise=0.9) * a
        rat += click_train(r, n, 30, jitter=0.4, amp_jitter=0.6, t0=tt + 0.02, t1=tt + 0.25) * decay(n, 0.15, tt) * a
    clang = resonators(ex, door_modes())
    slats = resonators(rat, slat_modes())
    mix = P(clang) + 0.9 * P(boom) + 0.12 * P(slats)
    mix = reverb(mix, ir_office(), wet=0.25)
    return sat(P(mix) * 1.3, 1.3)


def cat_growl(v, r, n):
    t = T(n)
    f0 = 50 * (1 + 0.08 * smooth_noise(r, n, 3))
    src = voice_src(r, f0, n, jitter=0.05, shimmer=0.2, breath=0.4, sub=0.6)
    purr = (0.5 + 0.5 * np.sin(PI2 * 24 * t)) ** 1.5
    F, B = vowel_track(n, [(0, 'm'), (0.4, 'uh'), (0.9, 'o'), (1.2, 'm')], fscale=0.9)
    g = formants(src * purr, F, B, (0, -4, -10, -16))
    rum = bw(white(r, n), 'bp', (40, 220)) * purr
    sv = servo(r, n, env_pts(n, [(0.1, 0), (0.3, 0.7), (0.8, 0.5), (1.0, 0)]), base=330, span=180, gear=0.3)
    env = env_pts(n, [(0, 0), (0.12, 0.7), (0.6, 1.0), (1.0, 0.8), (1.2, 0)])
    mix = (P(g) + 0.5 * P(rum) + 0.18 * P(sv)) * env
    return bw(sat(P(mix) * 1.5, 2.0), 'lp', 4500, 2)


# =============================================================================
# Purple Rat
# =============================================================================
MARACA_PATTERNS = [
    (160, [1, .5, .7, .5, 1, .5, .7, .5, 1, .6, .8, .6, 1, .7, 1, .9]),
    (172, [1, .4, .9, .4, 1, .6, .6, .9, 1, .4, .9, .4, .8, .8, 1, 1, 1]),
    (150, [1, 0, .7, .5, 0, .8, .6, 0, 1, .5, 0, .9, .6, .7, 1]),
]


def _maraca_shake(r, n, t0, a):
    cnt = int(25 * a) + 8
    w = r.uniform(0.03, 0.045)
    u = np.sort(r.uniform(0, 1, cnt)) ** 0.6
    ex = np.zeros(n)
    for x in u:
        ex += strike(n, t0 + w * x, 0.00008, r.uniform(0.2, 1.0) * (0.3 + 0.7 * x) * a)
    ex += strike(n, t0 + w, 0.0002, 1.2 * a)
    beads = bw(ex, 'bp', (3000, 11000), 2)
    beads = eq(beads, ('peak', 4200, 2.0, 5.0), ('peak', 7000, 2.0, 4.0))
    shell = resonators(strike(n, t0 + w, 0.0003, a), [(1850, 0.03, 1.0), (2600, 0.02, 0.5)])
    return beads + 0.06 * shell


def rat_maracas(v, r, n):
    bpm, pat = MARACA_PATTERNS[v]
    six = 60.0 / bpm / 4
    out = np.zeros(n)
    tt = 0.004
    for i, a in enumerate(pat):
        if a > 0:
            out += _maraca_shake(r, n, tt + r.uniform(-0.008, 0.008) + 0.008, a)
            if v == 1 and i % 4 == 3:
                out += _maraca_shake(r, n, tt + six / 2 + 0.008, a * 0.6)
        tt += six
    out = P(out)
    out = reverb(out, ir_duct(), wet=0.3)
    return bw(out, 'lp', 10000, 2)


def rat_squeak(v, r, n):
    squeaks = [[(0.01, 0.12, 2400, 0.2), (0.16, 0.08, 2900, -0.1), (0.27, 0.1, 2200, 0.3)],
               [(0.01, 0.18, 1800, 0.35), (0.22, 0.14, 2600, -0.25)]][v]
    out = np.zeros(n)
    for on, d, f0, gl in squeaks:
        m = N(d)
        x = np.linspace(0, 1, m)
        f = f0 * (1 + gl * x) * (1 + 0.06 * smooth_noise(r, m, 70))
        src = pulse(f, m, 0.22, os=4) + 0.3 * saw(2 * f, m, os=4)
        env = np.sin(np.pi * x) ** 0.5 * np.clip(1 + 0.5 * smooth_noise(r, m, 90), 0, 2)
        place(out, bw(src * env, 'bp', (1200, 9000), 2), on)
    if v == 1:
        out = P(out) + 0.15 * P(servo(r, n, env_pts(n, [(0, 0), (0.05, 0.8), (0.35, 0.6), (0.4, 0)]), base=900,
                                      span=400))
    return reverb(P(out), ir_hall(), wet=0.12)


def _oilcan(r, n, t0, a):
    t = np.maximum(T(n) - t0, 0)
    f1 = r.uniform(180, 320)
    f = f1 * (0.82 + 0.18 * np.exp(-t / 0.03))
    pop = np.sin(PI2 * phase(f, n)) * ar(n, 0.002, 0.14, t0)
    body = resonators(strike(n, t0, 0.004, 1.0), duct_modes())
    thunk = bw(white(r, n), 'lp', 300, 2) * ar(n, 0.002, 0.05, t0)
    return a * (P(pop) * 0.8 + P(body) + 0.5 * P(thunk))


def rat_crawl(v, r, n):
    out = np.zeros(n)
    k = int(r.integers(3, 6))
    times = np.sort(r.uniform(0.01, 0.85, k))
    for tt in times:
        out += _oilcan(r, n, tt, r.uniform(0.5, 1.0))
    for j in range(1 + v % 2):
        s0 = r.uniform(0.05, 0.6)
        sd = r.uniform(0.15, 0.3)
        e = gate(n, s0, s0 + sd, 0.04, 0.06)
        fr = click_train(r, n, r.uniform(120, 260), jitter=0.5, amp_jitter=0.7, t0=s0, t1=s0 + sd) * e
        out += 0.4 * P(resonators(fr, duct_modes())) + 0.15 * P(bw(white(r, n), 'bp', (1000, 6000)) * e)
    return reverb(P(out), ir_duct(), wet=0.4)


def rat_bang(v, r, n):
    ex = np.zeros(n)
    rat = np.zeros(n)
    thump = np.zeros(n)
    for tt, a in ((0.01, 1.0), (0.22, 0.8), (0.4, 0.55)):
        ex += strike(n, tt, 0.0015, a)
        rat += click_train(r, n, 38, jitter=0.35, amp_jitter=0.6, t0=tt + 0.01, t1=tt + 0.2) * decay(n, 0.12, tt) * a
        thump += thud(r, n, tt, 140, 90, 0.08, 0.012, noise=0.6) * a
    mix = P(resonators(ex, vent_modes())) + 0.25 * P(resonators(rat, vent_modes())) + 0.6 * P(thump)
    return reverb(mix, ir_duct(), wet=0.35)


# =============================================================================
# the Ringmaster (Top-Hat Rat)
# =============================================================================
def tophat_cane(v, r, n):
    out = np.zeros(n)
    for i, tt in enumerate((0.01, 0.39, 0.77)):
        a = [0.85, 0.8, 1.0][i]
        tip = P(hit(n, tt, tile_modes(), 0.00015)) + 0.5 * P(hit(n, tt, small_metal('ferrule'), 0.0001))
        wood = P(hit(n, tt + 0.0005, wood_modes('cane'), 0.0004))
        floor = P(thud(r, n, tt, 210, 150, 0.04, 0.005, noise=0.2))
        out += a * (tip + 0.4 * wood + 0.2 * floor)
    return reverb(out, ir_hall(), wet=0.5)


def tophat_laugh(v, r, n):
    t = T(n)
    ons = [0.05, 0.21, 0.36, 0.5, 0.64, 0.83]
    durs = [0.1, 0.1, 0.09, 0.09, 0.13, 0.55]
    f0s = [290, 275, 262, 250, 305, 240]
    f0 = np.full(n, 240.0)
    venv = np.zeros(n)
    henv = np.zeros(n)
    keys = [(0.0, 'a')]
    for on, d, ff in zip(ons, durs, f0s):
        x = np.clip((t - on) / d, 0, 1)
        sel = (t >= on - 0.02)
        f0 = np.where(sel, ff * (1 - 0.18 * x), f0)
        henv += gate(n, on, on + 0.03, 0.006, 0.02)
        venv += gate(n, on + 0.02, on + d, 0.012, 0.03 if d < 0.3 else 0.25)
        keys += [(on + 0.01, 'ae'), (on + d * 0.6, 'a'), (on + d, 'uh')]
    keys.append((n / SR, 'uh'))
    keys.sort(key=lambda k: k[0])
    src = voice_src(r, f0, n, jitter=0.02, shimmer=0.08, breath=0.25)
    F, B = vowel_track(n, keys, fscale=1.25)
    s = formants(src * venv, F, B, (0, -3, -8, -12))
    asp = formants(white(r, n) * henv, F, B, (0, -2, -5, -9))
    s = P(s) + 0.3 * P(asp)
    s = s * (0.75 + 0.25 * np.sin(PI2 * 47 * t))
    s = sat(P(bw(s, 'bp', (500, 6000), 2)) * 1.5, 2.2)
    s = 0.8 * s + 0.2 * bitcrush(s, 8, 2)
    s = s * bw(np.minimum(venv + henv, 1.0), 'lp', 40, 2)
    s = bw(s, 'bp', (650, 5000), 2)                       # tinny horn speaker
    s = eq(s, ('peak', 2600, 1.5, 6.0))
    jaw = np.zeros(n)
    for on in ons:
        jaw += hit(n, on, small_metal('tophatjaw'), 0.0002)
    return reverb(P(s) + 0.1 * P(jaw), ir_midway(), wet=0.12)
