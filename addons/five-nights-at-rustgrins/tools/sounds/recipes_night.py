"""Recipes: the night shift (fnar.night.*), the layer of dread under every shift.

Same conventions as the other recipe modules: fn(v, r, n) -> mono (n,) or
stereo (2, n) float array. The two beds (drone, heartbeat) are built
circularly: every tone has an integer number of cycles per loop, events are
placed with wrap-around, and filters and reverbs run over two periods.
Everything is synthesised. The only tunes are the add-on's own: Rustgrin's
Theme (music box) and the Midway waltz (calliope) from recipes_music.
"""
from __future__ import annotations

import functools

import numpy as np

from fnar_dsp import (N, PI2, SR, T, ar, band_noise, bitcrush, bq, bw, circ, click_train, decay, env_pts, eq, fit,
                      formants, gate, hz, midi, parse_line, periodic_lfo, phase, place, plate_modes, pulse,
                      resonators, reverb, rng, room_ir, sat, saw, servo, smooth_noise, strike, tvbq, varispeed,
                      voice_src, vowel_track, white)
from recipes_common import (BRIGHT_BELL, SOFT_BELL, P, bell, door_modes, frame_modes, hit, ir_big_st, ir_dining_st,
                            ir_hall, ir_office, slat_modes, small_metal, thud, tile_modes, wood_modes)
from recipes_music import RUSTGRIN_THEME, Tempo, U, music_box_note, show_dry
from recipes_office import _crackle, babble


# =============================================================================
# rooms and materials
# =============================================================================
def ir_far():
    """the empty halls beyond the office: long, dark, late reflections"""
    return room_ir('night_far', 3.6, length=4.2, predelay=0.035, n_early=18, early_span=0.13, lf=1.3, hf=0.28)


def ir_far_st():
    return room_ir('night_far_st', 3.6, length=4.2, stereo=True, predelay=0.035, n_early=18, early_span=0.13,
                   lf=1.3, hf=0.28)


def ir_cellar():
    """a small dark room with hard, wet walls"""
    return room_ir('night_cellar', 0.85, n_early=12, early_span=0.022, lf=1.0, hf=0.6)


def ir_backroom():
    """a cluttered back room behind a closed door"""
    return room_ir('night_backroom', 0.55, n_early=10, early_span=0.028, lf=1.3, hf=0.35)


FREE_BEAM = (1.0, 2.756, 5.404, 8.933, 13.344, 18.638, 24.81, 31.87)   # free-free bending modes


@functools.lru_cache(maxsize=None)
def beam_modes():
    """the building's steel frame: two long I-beams (bending modes, a little apart
    so they beat) and the deck plate they carry"""
    r = rng('mat', 'beam')
    modes = []
    for f1, a in ((38.5, 1.0), (40.1, 0.7)):
        for q in FREE_BEAM:
            modes.append((f1 * q * r.uniform(0.99, 1.01), 3.2 * q ** -0.3, a * q ** -0.2))
    modes += plate_modes(r, 180, 2400, 50, 1.8, 0.4, -5.0)
    return tuple(modes)


@functools.lru_cache(maxsize=None)
def pipe_modes():
    """a loose steel pipe / endoskeleton strut: bright, long-ringing bending modes"""
    r = rng('mat', 'pipe')
    modes = [(165.0 * q * r.uniform(0.99, 1.01), 0.8 * q ** -0.35, 0.5 * q ** 0.2) for q in FREE_BEAM]
    modes += plate_modes(r, 1100, 7000, 22, 0.45, 0.12, -2.0)
    return tuple(modes)


def _delay(x, sec):
    return fit(np.pad(x, [(0, 0)] * (x.ndim - 1) + [(N(sec), 0)]), x.shape[-1])


def _circ_sweep(x, kind, f, q):
    """time-varying biquad over a loop: f (per sample) is periodic, run over two periods"""
    return circ(lambda z: tvbq(z, kind, np.concatenate([f, f]), q), x)


def _backwards(x, ir, tail=1.6, dry=0.5):
    """x and its reverb tail played backwards: the echo swells up into the reversed sound"""
    y = np.concatenate([x, np.zeros(N(tail))])
    return reverb(y, ir, wet=1.0, dry=dry)[::-1]


def _preverb(x, ir, tail=1.2):
    """reverse reverb: the echo arrives before the sound and swells into it.
    The result starts `tail` seconds before x does."""
    y = np.concatenate([np.zeros(N(tail)), x])
    return reverb(y[::-1], ir, wet=1.0, dry=0.0)[::-1]


# =============================================================================
# beds: drone (stereo, ambient) and heartbeat (mono, at the player)
# =============================================================================
def night_drone(v, r, n):
    """12 s seamless sub drone: close low tones a tritone apart beating slowly, a
    growl, sub rumble, slowly moving air, and a faint metallic shimmer drifting in
    and out across the stereo field"""
    dur = n / SR
    u = np.arange(n) / n                         # 0..1 over the loop: k*u has exactly k cycles
    # beating pairs, as cycles per loop (left a/b, right a/b): the beats differ per side,
    # so the throb wanders slowly across the stereo field
    pairs = [((440, 443), (440, 442), 1.0),      # ~36.7 Hz (D1): 3 beats per loop left, 2 right
             ((623, 625), (623, 626), 0.5),      # ~51.9 Hz (Ab1), a tritone up
             ((881, 884), (882, 884), 0.2)]      # ~73.4 Hz (D2)
    sub = np.zeros((2, n))
    for ch in range(2):
        d = np.zeros(n)
        for cyc, a in ((p[ch], p[2]) for p in pairs):
            sw = 1 + 0.3 * periodic_lfo(n, int(r.integers(1, 3)), r)
            d += a * sw * (np.sin(PI2 * cyc[0] * u + r.uniform(0, PI2))
                           + 0.85 * np.sin(PI2 * cyc[1] * u + r.uniform(0, PI2)))
        sub[ch] = np.tanh(0.6 * d) / 0.6             # gentle intermodulation: more slow beats
    # growl: a low saw on the bottom tone gives the drone harmonics small speakers can play
    growl = circ(bw, saw(440 / dur, n), 'lp', 150, 2) * (0.6 + 0.4 * periodic_lfo(n, 1, r))
    rumble = np.stack([band_noise(r, n, 18, 80, slope=-2), band_noise(r, n, 18, 80, slope=-2)])
    rumble *= 1 + 0.3 * periodic_lfo(n, 1, r)
    # air through the building: a band of noise whose centre wanders 200..520 Hz
    air = np.zeros((2, n))
    for ch in range(2):
        fc = 200 * 2 ** (1.4 * (0.5 + 0.5 * np.sin(PI2 * u + r.uniform(0, PI2))))
        air[ch] = _circ_sweep(band_noise(r, n, 80, 1600, slope=-4.5), 'bp', fc, 1.4)
    # shimmer: inharmonic high partials (a bowed sheet of metal far off), each a beating
    # pair that swells in and out once or twice per loop and pans slowly
    r2 = rng('night', 'shimmer')
    ks = sorted({int(round(f * dur)) for f in r2.uniform(1900, 6400, 8)})
    sh = np.zeros((2, n))
    for i, k in enumerate(ks):
        c = 1 + i % 2
        ph = r.uniform(0, PI2)
        am = (0.5 + 0.5 * np.sin(PI2 * c * u + ph)) ** 4
        dev = 70.0 * np.sin(PI2 * (1 + i % 3) * u + r.uniform(0, PI2))     # phase wander, a few Hz
        s = np.sin(PI2 * k * u + dev) + 0.7 * np.sin(PI2 * (k + 1 + i % 2) * u + 1.1 * dev + 1.3)
        th = (0.75 * np.sin(PI2 * c * u + ph + r.uniform(1, 2)) + 1) * np.pi / 4
        g = am * (k / dur / 2000) ** -0.5
        sh[0] += s * g * np.cos(th)
        sh[1] += s * g * np.sin(th)
    sh = reverb(sh, ir_far_st(), wet=1.0, dry=0.35, circular=True)
    sh = circ(bw, sh, 'hp', 1200, 2)
    mix = (U(sub) + 0.4 * U(growl) + 0.28 * U(rumble) + 0.06 * U(air) + 0.012 * U(sh))
    return mix * (1 + 0.12 * periodic_lfo(n, 1, r))


def _lubdub(r, dur=1.2, amp=1.0, gap=0.29):
    """one heartbeat as felt from inside the head: S1 'lub' then S2 'dub', two low,
    soft-edged thumps with falling pitch and a knock an octave up, then the blood rush"""
    n = N(dur)
    out = np.zeros(n)
    for t0, (fh, fl), a, t60, att in ((0.0, (64.0, 34.0), 1.0, 0.26, 0.016),
                                      (gap, (88.0, 46.0), 0.7, 0.17, 0.010)):
        tt = np.maximum(T(n) - t0, 0)
        f = fl + (fh - fl) * np.exp(-tt / 0.045)
        body = np.sin(PI2 * phase(f, n)) * ar(n, att, t60, t0)
        knock = np.sin(PI2 * phase(2.05 * f, n) + 0.6) * ar(n, att * 0.7, t60 * 0.35, t0)
        thump = P(bw(white(r, n), 'lp', 120, 2) * ar(n, att, t60 * 0.4, t0))
        out += a * (body + 0.3 * knock + 0.45 * thump)
    rush = bw(white(r, n), 'bp', (40, 220), 2) * ar(n, 0.07, 0.45, 0.02)
    return amp * (P(out) + 0.07 * P(rush))


def _muffle(x):
    """inside the head: saturate a little (harmonics small speakers can play), then
    take the top off and give it the body's low resonance"""
    x = sat(P(x), 1.8)
    return eq(bw(x, 'lp', 380, 2), ('peak', 90, 1.0, 3.0))


def night_heartbeat(v, r, n):
    """a heavy heartbeat, two lub-dubs per 2 s loop (60 bpm), close and muffled"""
    out = np.zeros(n)
    for t0, a in ((0.28, 1.0), (1.285, 0.93)):           # the seam falls in the quiet before a beat
        place(out, _lubdub(r, 1.2, a), t0, wrap=True)
    x = P(out) + 0.015 * band_noise(r, n, 22, 140, slope=-3)
    x = sat(x, 1.8)
    x = circ(bw, x, 'lp', 380, 2)
    return circ(eq, x, ('peak', 90, 1.0, 3.0))


# =============================================================================
# breathing, voices
# =============================================================================
def night_breath(v, r, n):
    """slow mechanical breathing through a speaker grille just outside the door:
    a ragged inhale, a valve tick and servo hiss, a rattling exhale"""
    dur = n / SR
    t = T(n)
    ins, ex, fry, catches = [([(0.06, 1.05)], (1.30, 2.78), 38.0, (0.40, 0.72)),
                             ([(0.05, 1.22)], (1.48, 2.86), 31.0, (0.58,)),
                             ([(0.05, 0.40), (0.52, 1.02)], (1.26, 2.80), 44.0, (0.80,))][v]
    # inhale: air pulled in past the grille, brightening, catching on the way
    inh = np.zeros(n)
    for a, b in ins:
        inh += gate(n, a, b, (b - a) * 0.6, 0.05)
    for c in catches:
        inh *= 1 - 0.85 * gate(n, c, c + 0.05, 0.012, 0.03)
    inh *= np.clip(1 + 0.45 * smooth_noise(r, n, 16), 0.15, 2.0)
    e0, e1 = ex
    exh = env_pts(n, [(0, 0), (e0, 0), (e0 + 0.09, 1.0), (e0 + 0.45, 0.8), (e1 - 0.25, 0.35), (e1, 0)])
    exh *= np.clip(1 + 0.25 * smooth_noise(r, n, 9), 0.3, 2.0)
    keys = [(0.0, 'uh'), (ins[0][0] + 0.15, 'a'), (ins[-1][1], 'ae'), (e0, 'o'), (e0 + 0.5, 'u'), (e1, 'uh'),
            (dur, 'uh')]
    F, B = vowel_track(n, keys, fscale=0.92, jitter=0.03, r=r)
    air_in = formants(white(r, n) * inh, F, B, (0, -2, -5, -8)) + 0.4 * bw(white(r, n), 'hp', 2500) * inh
    air_out = formants(white(r, n) * exh, F, B, (0, -3, -8, -13))
    # the rattle: irregular glottal-fry pulses through the same mouth, and the grille buzzing
    rate = fry * (1 - 0.3 * np.clip((t - e0) / (e1 - e0), 0, 1))
    pulses = click_train(r, n, rate, jitter=0.35, amp_jitter=0.7, t0=e0 + 0.03, t1=e1 - 0.05) * exh
    rattle = formants(bw(pulses, 'lp', 3000, 1), F, B, (0, -4, -10, -15))
    grille = resonators(pulses, small_metal('grille'))
    # between the breaths: a valve ticks and a small servo hisses
    tv = ins[-1][1] + 0.04
    valve = hit(n, tv, small_metal('valve'), 0.0003) + 0.5 * hit(n, e0 - 0.03, frame_modes('chest'), 0.0008)
    hiss = bw(white(r, n), 'hp', 2800) * ar(n, 0.004, 0.2, tv + 0.01)
    whir = servo(r, n, gate(n, tv, tv + 0.2, 0.03, 0.06) * 0.5, base=360, span=260, gear=0.25, grit=0.15)
    s = (P(air_in) * 1.25 + P(air_out) + 0.55 * P(rattle) + 0.12 * P(grille) + 0.18 * P(valve) + 0.1 * P(hiss)
         + 0.07 * P(whir))
    # through the animatronic's speaker: band-limited, peaky, a little broken
    s = bw(s, 'bp', (170, 6500), 2)
    s = eq(s, ('peak', 1150, 2.0, 5.0), ('peak', 2700, 2.5, 4.0))
    s = sat(P(s) * 1.2, 1.8)
    s = 0.85 * s + 0.15 * bitcrush(s, 9, 2)
    on = bw(np.minimum(inh + exh, 1.0), 'lp', 8, 1)
    s += 0.008 * (np.sin(PI2 * 60 * t) + 0.6 * np.sin(PI2 * 180 * t + 1.0)) * on
    s = reverb(s, ir_hall(), wet=0.22)
    return s * env_pts(n, [(0, 1), (dur - 0.12, 1), (dur, 0)])


def night_musicbox_far(v, r, n):
    """Rustgrin's Theme on the music box, very far away down empty halls: detuned,
    the spring running down, a note or two dying out, a big dark reverb"""
    dur = n / SR
    notes, _ = parse_line(RUSTGRIN_THEME, 3)
    if v == 0:      # bars 1-4: E A C | B . A | G# A E | F
        b0, b1 = 0, 10
        tempo = Tempo([(0, 128), (4, 118), (10, 58)])
        weak = {6: (0.16, 0.2, -45), 9: (0.32, 0.35, -30)}       # beat -> (velocity, brightness, cents)
        bass = [(0, 'A3', 0.3), (3, 'A3', 0.25), (6, 'E3', 0.22)]
    else:           # bars 13-15: D E F | G# . B | A, the spring nearly gone before the last note
        b0, b1 = 36, 46
        tempo = Tempo([(0, 116), (3, 100), (6, 40)])
        weak = {41: (0.35, 0.35, -25), 42: (0.13, 0.2, -50)}
        bass = [(36, 'D3', 0.3), (39, 'E3', 0.25)]
    t0 = 0.15
    box = np.zeros(n)
    for b, _d, m in notes:
        if m is None or not b0 <= b < b1:
            continue
        vel, br, cents = weak.get(b, (1.0, 0.6, 0))
        c = rng('mb-far', m).uniform(-1, 1) * 34 + cents               # every tine badly out of tune
        place(box, music_box_note(hz(m) * 2 ** (c / 1200), 4.5, r, vel, br),
              t0 + tempo(b - b0) + r.uniform(-0.02, 0.02))
    for b, nm, vel in bass:
        m = midi(nm)
        c = rng('mb-far', m).uniform(-1, 1) * 34
        place(box, music_box_note(hz(m) * 2 ** (c / 1200), 4.5, r, vel, 0.4), t0 + tempo(b - b0))
    # wow, and the pitch sagging as it runs down
    t = T(n)
    sp = (1 - 0.035 * (t / dur) ** 1.5) * (1 + 0.007 * np.sin(PI2 * 0.45 * t + r.uniform(0, PI2))
                                          + 0.002 * np.sin(PI2 * 5.1 * t))
    box = varispeed(box, sp)
    # very far away: no low end, no highs, a big dark room and a late echo off the far wall
    box = bw(bw(box, 'hp', 300, 2), 'lp', 2800, 2)
    wet = reverb(box, ir_far(), wet=1.0, dry=0.0)
    out = 0.16 * P(box) + P(wet)
    out += 0.35 * bw(_delay(out, 0.23), 'lp', 1800, 2)
    out = bw(out, 'lp', 3000, 2)
    return out * env_pts(n, [(0, 1), (dur - 1.2, 1), (dur, 0)])


def _child_laugh(r, k, rate, f0, fscale, vowel='a', fall=0.25, gasp=0.0, amp_fall=0.3):
    """a child's laugh: k syllables ('ha-ha' with vowel 'a', 'hee-hee' with 'i'), the pitch
    hopping up on each and falling across the laugh; gasp > 0 adds the squeaky in-breath"""
    dur = (k + 1.5) / rate + 0.45
    n = N(dur)
    t = T(n)
    f0c = np.full(n, f0)
    venv = np.zeros(n)
    henv = np.zeros(n)
    on_v = {'a': 'ae', 'i': 'i', 'e': 'i', 'uh': 'a'}[vowel]
    keys = [(0.0, 'uh')]
    tt = 0.03
    for i in range(k):
        d = r.uniform(0.55, 0.72) / rate
        fi = f0 * (1 - fall * i / max(1, k - 1)) * r.uniform(0.96, 1.05)
        x = np.clip((t - tt) / d, 0, 1)
        f0c = np.where(t >= tt - 0.012, fi * (1 + 0.15 * np.sin(np.pi * x) - 0.1 * x), f0c)
        a = (1 - amp_fall * i / k) * r.uniform(0.8, 1.0)
        henv += gate(n, tt, tt + 0.03, 0.004, 0.02) * a
        venv += gate(n, tt + 0.018, tt + d, 0.008, 0.03) * a
        keys += [(tt + 0.004, on_v), (tt + d * 0.6, vowel), (tt + d, 'uh')]
        tt += r.uniform(0.92, 1.1) / rate
    if gasp:
        x = np.clip((t - tt) / 0.2, 0, 1)
        f0c = np.where(t >= tt - 0.01, 1.9 * f0 * (1 + 0.25 * x), f0c)
        venv += gate(n, tt, tt + 0.2, 0.03, 0.05) * gasp * 0.5
        henv += gate(n, tt - 0.02, tt + 0.22, 0.03, 0.05) * gasp
        keys += [(tt, 'i'), (tt + 0.22, 'i')]
    keys.append((dur, 'uh'))
    keys.sort(key=lambda kk: kk[0])
    src = voice_src(r, f0c, n, jitter=0.015, shimmer=0.07, breath=0.3)
    F, B = vowel_track(n, keys, fscale=fscale)
    s = formants(src * venv, F, B, (0, -3, -8, -13))
    asp = formants(white(r, n) * henv, F, B, (0, -2, -5, -9))
    return P(s) + 0.4 * P(asp)


def _party_toot(r, dur=0.5, f0=430.0):
    """a paper party blower: a buzzy reed that sags at the end"""
    n = N(dur)
    t = T(n)
    f = f0 * (1 - 0.12 * np.clip((t - dur * 0.7) / (dur * 0.3), 0, 1)) * (1 + 0.01 * smooth_noise(r, n, 12))
    s = pulse(f, n, 0.3, os=2) + 0.4 * saw(2 * f, n, os=2)
    s = bw(s, 'bp', (350, 3000), 2) * gate(n, 0.01, dur - 0.06, 0.02, 0.05)
    return P(s)


def _kid_babble(r, dur, f0, fscale):
    """excited child chatter: the phone babble with a child's pitch and formants and
    big, lively swings of intonation"""
    n = N(dur)
    lively = f0 * 2 ** (0.3 * smooth_noise(r, n, 2.2) + 0.1 * smooth_noise(r, n, 7))
    return babble(r, dur, lively, fscale)


def _remembered(r, dry, n, speed, wow=0.012, heads=((0.0, 1.0), (0.019, 0.45), (0.037, 0.3))):
    """play a dry recording back slowed to `speed`, warbling, read by three slightly
    detuned heads (smeared), out of a big room far away"""
    t = T(n)
    out = np.zeros(n)
    for j, (off, g) in enumerate(heads):
        dev = (wow * np.sin(PI2 * (0.43 + 0.11 * j) * t + r.uniform(0, PI2))
               + 0.003 * np.sin(PI2 * (3.3 + j) * t + r.uniform(0, PI2)))
        out += g * varispeed(dry, speed * (1 + dev), start=-N(off))
    wet = reverb(out, ir_dining_st()[0], wet=1.0, dry=0.0)
    out = 0.8 * out + 0.42 * wet            # wetter than this and the laughs lose their 'ha-ha' rhythm
    return bw(bw(out, 'hp', 200, 2), 'lp', 3000, 2)


def night_kids(v, r, n):
    """distant children's party chatter and laughter, as if remembered: slowed,
    smeared, far away, some of it backwards"""
    dur = n / SR
    speed = (0.82, 0.86, 0.66)[v]
    m = N(dur * speed + 0.15)
    dd = m / SR
    dry = np.zeros(m)
    if v in (0, 1):
        for f0, fs, t0, t1, a in ((300, 1.42, 0.1, dd - 0.5, 0.32), (335, 1.5, 0.6, dd - 0.25, 0.27),
                                  (275, 1.38, 1.2, dd - 0.1, 0.22)):
            place(dry, P(_kid_babble(r, t1 - t0, f0, fs)) * a, t0)
        place(dry, _child_laugh(r, 6, 5.2, 430, 1.45, 'a', gasp=0.8), 1.05)
        place(dry, _child_laugh(r, 5, 6.0, 500, 1.55, 'i') * 0.8, 1.3)
        place(dry, _child_laugh(r, 4, 5.6, 460, 1.5, 'a') * 0.55, 2.35)
        place(dry, _party_toot(r, 0.45, 440) * 0.12, 0.35)
        if v == 0:
            # one laugh plays backwards, its echo swelling up into it
            lg = _backwards(_child_laugh(r, 4, 4.8, 400, 1.45, 'a'), ir_dining_st()[0])
            place(dry, P(lg) * 0.6, 3.3 - lg.shape[-1] / SR)
        else:
            dry = reverb(dry, ir_dining_st()[0], wet=0.8, dry=0.6)[::-1]       # all of it backwards
            place(dry, _child_laugh(r, 5, 5.5, 450, 1.5, 'a', amp_fall=0.6) * 0.45, dd - 1.1)
    else:
        # one burst of group laughter, slowed right down (deep, slurred), its echo arriving first
        group = np.zeros(N(2.4))
        for i, (f0, fs, t0, k, rate, vw) in enumerate(((440, 1.45, 0.0, 7, 5.0, 'a'), (520, 1.55, 0.07, 6, 5.8, 'i'),
                                                       (390, 1.4, 0.15, 6, 4.6, 'a'))):
            place(group, _child_laugh(r, k, rate, f0, fs, vw, gasp=0.6 if i == 0 else 0.0) * (1.0 - 0.2 * i), t0)
        t_on, tail = 0.75, 0.7
        place(dry, group, t_on)
        place(dry, P(_preverb(group, ir_dining_st()[0], tail)) * 0.5 * float(np.max(np.abs(group))), t_on - tail)
        place(dry, P(_kid_babble(r, 1.4, 320, 1.45)) * 0.25, 2.1)
    out = _remembered(r, dry, n, speed, wow=(0.012, 0.012, 0.018)[v])
    return out * env_pts(n, [(0, 0), (0.45, 1), (dur - 0.7, 1), (dur, 0)])


def night_giggle(v, r, n):
    """a single small, warped, childlike giggle, much too close"""
    dur = n / SR
    m = N(dur + 0.4)
    g = np.zeros(m)
    lg = _child_laugh(r, (5, 6)[v], (8.0, 7.2)[v], (440, 410)[v], 1.55, 'i', fall=0.3, amp_fall=0.45)
    place(g, lg, 0.13)
    # a quick nasal in-breath right before it, and the lips parting
    sniff = bw(white(r, m), 'bp', (1500, 7000)) * gate(m, 0.02, 0.11, 0.03, 0.02)
    lips = resonators(strike(m, 0.12, 0.0003), [(1900, 0.012, 1.0), (3300, 0.008, 0.5)])
    g = P(g) + 0.12 * P(sniff) + 0.05 * P(lips)
    t = T(n)
    if v == 0:
        sp = 1 + 0.045 * np.sin(PI2 * 5.5 * t) + 0.02 * np.sin(PI2 * 13.0 * t + 1.0)   # tape chewing
        sp *= env_pts(n, [(0, 1.0), (dur, 0.9)])
    else:
        sp = env_pts(n, [(0, 1.0), (0.62, 1.0), (1.05, 0.5), (dur, 0.42)])          # slurs down into a chuckle
    s = varispeed(g, sp)
    s = s * (0.85 + 0.15 * np.sin(PI2 * 37 * t))                                     # a hint of the voice box
    s = 0.9 * s + 0.1 * bitcrush(s, 10, 2)
    s = eq(s, ('ls', 220, 0.7, 4.0), ('peak', 3200, 1.5, 2.0))                      # proximity, breath
    s = reverb(s, ir_office(), wet=0.07)
    return s * env_pts(n, [(0, 1), (dur - 0.15, 1), (dur, 0)])


# =============================================================================
# the building and things moving in it
# =============================================================================
def _speed_segments(r, n, segs, jerk=0.35):
    t = T(n)
    sp = np.zeros(n)
    for a, b, h in segs:
        x = np.clip((t - a) / (b - a), 0, 1)
        sp = np.maximum(sp, h * np.sin(np.pi * x) ** 0.7)
    return np.clip(sp * (1 + jerk * smooth_noise(r, n, 6)), 0, None) * (sp > 0)


def night_scrape(v, r, n):
    """metal dragged slowly over tile somewhere down the hall: stick-slip chatter
    through the object and the floor, grit, a thin squeal, the corridor"""
    t = T(n)
    if v == 0:
        sp = _speed_segments(r, n, [(0.08, 1.2, 1.0), (1.45, 2.65, 0.85)])
        modes, sq_f = pipe_modes(), 1730.0
    else:
        sp = _speed_segments(r, n, [(0.1, 2.35, 0.9)], jerk=0.6)
        modes, sq_f = frame_modes('drag'), 1180.0
    clicks = click_train(r, n, 18 + 110 * sp, jitter=0.45, amp_jitter=0.7) * sp ** 1.2
    obj = resonators(clicks, modes)
    floor = resonators(clicks, tile_modes())
    grit = tvbq(white(r, n), 'bp', 900 + 2200 * sp, 1.2) * sp ** 1.5 * (1 + 0.5 * smooth_noise(r, n, 40))
    sq_amp = np.clip((sp - 0.6) / 0.25, 0, 1) ** 2 * np.clip(0.5 + smooth_noise(r, n, 3), 0, 1)
    squeal = np.sin(PI2 * phase(sq_f * (1 + 0.006 * smooth_noise(r, n, 9)), n)) * bw(sq_amp, 'lp', 20, 1)
    mix = P(obj) + 0.35 * P(floor) + 0.3 * P(grit) + 0.07 * P(squeal)
    if v == 1:
        tp = 2.5                                       # set down at the end
        mix += 0.8 * P(thud(r, n, tp, 110, 55, 0.25, 0.02, noise=0.8)) + 0.5 * P(hit(n, tp, modes, 0.0012))
    mix = bw(mix, 'lp', 4200, 2)
    out = reverb(mix, ir_hall(), wet=0.55, dry=0.55)
    out += 0.25 * P(reverb(mix, ir_far(), wet=1.0, dry=0.0)) * float(np.max(np.abs(out)))
    return out * env_pts(n, [(0, 1), (n / SR - 0.2, 1), (n / SR, 0)])


def night_knock(v, r, n):
    """three slow, heavy knocks on the office's steel door; the third a little late"""
    times = [(0.06, 0.78, 1.74), (0.06, 0.70, 1.62)][v]
    amps = [(0.9, 1.0, 0.95), (1.0, 0.85, 1.0)][v]
    ex = np.zeros(n)
    boom = np.zeros(n)
    knuck = np.zeros(n)
    rat = np.zeros(n)
    for tt, a in zip(times, amps):
        ex += strike(n, tt, r.uniform(0.0045, 0.006), a)
        boom += thud(r, n, tt, 78, 40, 0.42, 0.035, noise=1.0, noise_lp=160) * a
        knuck += strike(n, tt - 0.0015, 0.0005, a)
        rat += click_train(r, n, 26, jitter=0.4, amp_jitter=0.6, t0=tt + 0.03, t1=tt + 0.3) * decay(n, 0.2, tt) * a
    clang = bw(resonators(ex, door_modes()), 'lp', 2600, 2)       # a heavy hand: dull, deep
    metal = resonators(knuck, frame_modes('knuckle'))                # the steel fingers on the steel door
    slats = resonators(rat, slat_modes())
    mix = P(clang) + P(boom) + 0.16 * P(metal) + 0.1 * P(slats)
    if v == 1:
        # then the fingertips drag slowly down the door
        sp = gate(n, 1.95, 2.3, 0.05, 0.08)
        fr = click_train(r, n, 70 + 40 * sp, jitter=0.5, amp_jitter=0.7, t0=1.95, t1=2.35) * sp
        mix += 0.1 * P(resonators(fr, door_modes())) + 0.04 * P(bw(white(r, n), 'bp', (1500, 5000)) * sp)
    mix = reverb(mix, ir_office(), wet=0.25)
    return sat(P(mix) * 1.2, 1.2)


def night_door_rattle(v, r, n):
    """someone slowly testing the steel shutter: the slats rattle in their rails,
    scrape up a finger's width and drop back"""
    if v == 0:
        bursts = [(0.05, 0.5, 1.0, 34.0), (0.68, 0.95, 0.6, 26.0), (1.12, 1.55, 0.85, 40.0)]
        lift, drop = (1.15, 1.5), 1.56
    else:
        bursts = [(0.05, 0.35, 0.7, 28.0), (0.45, 1.05, 1.0, 38.0)]
        lift, drop = (0.5, 1.0), 1.25
    rat = np.zeros(n)
    push = np.zeros(n)
    for a, b, g, rate in bursts:
        e = gate(n, a, b, 0.04, 0.08) * g
        rat += click_train(r, n, rate * (1 + 0.2 * smooth_noise(r, n, 3)), jitter=0.45, amp_jitter=0.7,
                           t0=a, t1=b) * e
        push += e
    slats = resonators(rat, slat_modes())
    panel = resonators(rat, door_modes())
    flex = bw(white(r, n), 'lp', 90, 2) * bw(push, 'lp', 6, 1)          # the whole panel leaning in its frame
    sp = gate(n, lift[0], lift[1], 0.05, 0.04)
    fr = click_train(r, n, 60 + 80 * sp, jitter=0.45, amp_jitter=0.6, t0=lift[0], t1=lift[1]) * sp
    rail = P(resonators(fr, slat_modes())) + 0.4 * P(tvbq(white(r, n), 'bp', 1500 + 1800 * sp, 1.5) * sp)
    clunk = resonators(strike(n, drop, 0.003), door_modes()) + 0.8 * thud(r, n, drop, 100, 55, 0.2, 0.02, noise=0.5)
    mix = P(slats) + 0.35 * P(panel) + 0.12 * P(flex) + 0.45 * P(rail) + 0.6 * P(clunk)
    mix = bw(reverb(mix, ir_office(), wet=0.22), 'lp', 9000, 2)          # thick steel: no fizz on top
    return mix * env_pts(n, [(0, 1), (n / SR - 0.12, 1), (n / SR, 0)])


def night_radio(v, r, n):
    """an old radio left on in a back room: static as the dial drifts, a muffled,
    warped snatch of the Midway waltz coming in and fading out, static again"""
    dur = n / SR
    t = T(n)
    # the dial: 1.0 is the station with the waltz on it, 0.35 another (talk) station
    dial = [env_pts(n, [(0, 0.12), (0.45, 0.42), (0.75, 0.30), (1.3, 0.93), (1.55, 1.0), (3.05, 1.0), (3.5, 1.07),
                        (4.0, 1.22), (dur, 1.3)]),
            env_pts(n, [(0, 1.35), (0.7, 1.12), (1.15, 1.0), (2.4, 1.0), (2.8, 0.97), (3.4, 0.9), (3.9, 0.66),
                        (4.3, 0.36), (dur, 0.3)])][v]
    dial = dial + 0.004 * smooth_noise(r, n, 2)                  # a loose dial
    sig = np.exp(-((dial - 1.0) / 0.05) ** 2)
    talk = np.exp(-((dial - 0.35) / 0.05) ** 2)
    # heterodyne whistles: loud just off a station, sliding down to nothing at dead centre
    whistle = np.zeros(n)
    for c in (1.0, 0.35):
        dd = np.abs(dial - c)
        a = np.exp(-(dd / 0.15) ** 2) * np.clip(dd / 0.02, 0, 1)
        whistle += a * np.sin(PI2 * phase(40 + 9000 * dd, n))
    # the waltz, warped (slow, wobbling) - lined up so the tune is under way when it tunes in
    start, speed = [(0.4, 0.9), (8.0, 0.74)][v]
    sp = speed * (1 + 0.012 * np.sin(PI2 * 0.6 * t) + 0.004 * np.sin(PI2 * 4.7 * t + 1.0))
    mus = varispeed(show_dry(), sp, circular=True, start=N(start) - N(1.2 * speed))
    mus = mus * (1 + 0.35 * smooth_noise(r, n, 1.3))           # the signal fading in and out
    voice = P(babble(r, dur, 150.0, 1.0))
    static = band_noise(r, n, 300, 6000, slope=-1.5) * (1 + 0.3 * smooth_noise(r, n, 12)) + 3 * _crackle(r, n, 90)
    prog = P(mus) * sig + 0.6 * voice * talk
    static = P(static) * (1 - 0.8 * np.maximum(sig, talk))
    rx = 0.8 * prog + 0.35 * static + 0.12 * whistle
    # the radio's little speaker, then the back room behind a door
    rx = bw(rx, 'bp', (280, 3400), 4)
    rx = eq(rx, ('peak', 900, 1.2, 4.0))
    rx = sat(P(rx) * 1.3, 2.0)
    rx = reverb(rx, ir_backroom(), wet=0.35)
    rx = bw(rx, 'lp', 2300, 2) + 0.01 * (np.sin(PI2 * 60 * t) + 0.5 * np.sin(PI2 * 120 * t + 0.7))
    return rx * env_pts(n, [(0, 0), (0.12, 1), (dur - 0.4, 1), (dur, 0)])


def _drop(r, n, t0, f0, amp=1.0, ring=0.05, splash=0.25, tick=0.3):
    """one water drop: the bubble's rising chirp, the impact tick, a little splash"""
    tt = np.maximum(T(n) - t0, 0)
    f = f0 * (1 + 0.9 * (1 - np.exp(-tt / 0.011)))
    s = np.sin(PI2 * phase(f, n)) * ar(n, 0.0004, ring, t0)
    s += tick * P(bw(strike(n, t0, 0.00015), 'bp', (2500, 9000)))
    s += splash * bw(white(r, n), 'bp', (1800, 7000)) * ar(n, 0.0005, 0.03, t0) * 0.5
    return amp * s


def night_drip(v, r, n):
    """a water drip in a small dark room"""
    s = np.zeros(n)
    if v == 0:      # into a puddle, two droplets thrown up fall back
        s += _drop(r, n, 0.05, r.uniform(980, 1150))
        s += _drop(r, n, 0.12, r.uniform(2100, 2400), 0.15, 0.02, 0.0, 0.1)
        s += _drop(r, n, 0.16, r.uniform(2500, 2900), 0.1, 0.015, 0.0, 0.1)
    elif v == 1:    # onto a wet hard floor
        s += _drop(r, n, 0.05, r.uniform(1400, 1600), 0.45, 0.03, splash=1.0, tick=0.8)
    else:           # two drops, the second smaller
        s += _drop(r, n, 0.05, r.uniform(1050, 1200))
        s += _drop(r, n, 0.43, r.uniform(1300, 1450), 0.55, 0.04)
    s = reverb(s, ir_cellar(), wet=0.45)
    return bw(s, 'lp', 7000, 2) * env_pts(n, [(0, 1), (n / SR - 0.15, 1), (n / SR, 0)])


def night_groan(v, r, n):
    """the building's steel frame groaning: slow stick-slip friction through long
    I-beam modes, a moan of friction noise following the slip, far away"""
    dur = n / SR
    if v == 0:      # slow creaks that run together into a moan, and back
        rate = env_pts(n, [(0, 13), (0.7, 18), (1.6, 44), (2.3, 52), (2.9, 30), (3.5, 16), (dur, 13)])
        amp = env_pts(n, [(0, 0), (0.35, 0.35), (1.5, 1.0), (2.7, 0.8), (3.5, 0.15), (dur, 0)])
        pop = None
    else:           # a rising moan, then the stress lets go
        rate = env_pts(n, [(0, 20), (1.2, 30), (2.4, 58), (2.75, 66), (dur, 66)])
        amp = env_pts(n, [(0, 0), (0.5, 0.4), (2.0, 0.9), (2.72, 1.0), (2.76, 0.0), (dur, 0)])
        pop = 2.76
    rate = rate * (1 + 0.08 * smooth_noise(r, n, 4))
    clicks = click_train(r, n, rate, jitter=0.05, amp_jitter=0.25) * amp
    # the slip pulses sound through the frame's broad body resonances, so the slip rate is
    # the groan's pitch; the beams' own modes (damped while loaded) add the metal ring
    src = bw(clicks, 'lp', 1400, 2)
    body = sum(g * P(bq(src, 'bp', f, q)) for f, q, g in ((80, 2.0, 1.0), (215, 2.5, 0.8), (480, 3.0, 0.5),
                                                         (1050, 4.0, 0.3), (1900, 5.0, 0.12)))
    ring = resonators(clicks, [(f, t60 * 0.22, a) for f, t60, a in beam_modes()])
    moan = tvbq(white(r, n), 'bp', rate * 4.0, 3.0) * amp ** 1.5
    mix = P(body) + 0.2 * P(ring) + 0.1 * P(moan)
    if pop:
        bang = resonators(strike(n, pop, 0.002), beam_modes())
        mix += 0.9 * P(bang) + 0.7 * P(thud(r, n, pop, 70, 30, 0.8, 0.05, noise=0.9))
    mix = bw(mix, 'lp', 3000, 2)
    wet = reverb(mix, ir_far(), wet=1.0, dry=0.0)
    out = 0.75 * P(mix) + 0.35 * P(wet)
    return out * env_pts(n, [(0, 1), (dur - 0.6, 1), (dur, 0)])


def night_twitch(v, r, n):
    """a sudden glitchy servo jerk: an animatronic's head snapping round toward you"""
    t = T(n)
    if v == 0:
        segs, stops = [(0.006, 0.17)], [0.17]
    elif v == 1:
        segs, stops = [(0.006, 0.075), (0.12, 0.21)], [0.075, 0.21]
    else:
        segs, stops = [(0.006, 0.24)], [0.24]
    sp = np.zeros(n)
    for a, b in segs:
        # a whip: full speed almost at once, braking hard as it reaches the target, then the stop
        x = np.clip((t - a) / (b - a), 0, 1)
        prof = np.where(x < 0.22, np.sin(0.5 * np.pi * x / 0.22), 1 - 0.55 * (np.maximum(x - 0.22, 0) / 0.78) ** 1.3)
        sp += prof * gate(n, a, b, 0.004, 0.003)
    # the drive glitches: it chatters on and off before it catches
    chat = 0.5 + 0.5 * np.sign(np.sin(PI2 * (42, 58, 35)[v] * t + r.uniform(0, PI2)))
    sp *= np.where(t < segs[0][0] + 0.06, 0.35 + 0.65 * chat, 1.0)
    whine = servo(r, n, sp, base=(820, 700, 600)[v], span=1300, ratio=0.5, index=1.8, gear=0.45, grit=0.35)
    if v == 0:      # a skipping buffer: the first 22 ms of the whine stutter three times
        a = N(0.03)
        w = N(0.022)
        seg = whine[a:a + w] * np.hanning(w) ** 0.3
        for k in range(3):
            whine[a + k * w:a + (k + 1) * w] = seg
    buzz = bw(pulse(118, n, 0.15), 'bp', (200, 4000)) * sp * (0.4 + 0.6 * chat)
    snap = np.zeros(n)
    for i, ts in enumerate(stops):
        g = 1.0 if i == len(stops) - 1 else 0.5
        s = (P(hit(n, ts, frame_modes('neck'), 0.0006)) + 0.6 * P(hit(n, ts, small_metal('neckpin'), 0.0002))
             + 0.5 * P(thud(r, n, ts, 150, 90, 0.07, 0.01, noise=0.3)))
        snap += g * s + 0.3 * g * _delay(s, 0.022)               # overshoot and bounce
    mix = 0.7 * P(whine) + 0.15 * P(buzz) + 0.9 * P(snap)
    if v == 2:
        rat = click_train(r, n, 40, jitter=0.4, amp_jitter=0.6, t0=0.25, t1=0.34) * decay(n, 0.08, 0.24)
        mix += 0.2 * P(resonators(rat, frame_modes('rattle')))
    mix = reverb(mix, ir_hall(), wet=0.08)
    return mix * env_pts(n, [(0, 1), (n / SR - 0.05, 1), (n / SR, 0)])


# =============================================================================
# stingers (stereo, at the player)
# =============================================================================
def night_stinger(v, r, n):
    """big scare sting: a reversed swell into a sub-bass hit with a dissonant metal
    cluster and a brass-like stab on top, ending in a ringing tail"""
    dur = n / SR
    t = T(n)
    th = (0.85, 0.95)[v]
    cluster = [['C#4', 'D4', 'G4', 'G#4', 'D5', 'D#5', 'A5'], ['Bb3', 'B3', 'E4', 'F4', 'B4', 'C5', 'F#5']][v]
    m = n - N(th)
    long_bell = [(ra, a, tt * 1.5) for ra, a, tt in BRIGHT_BELL]
    bells = np.zeros((2, n))
    stab = np.zeros((2, n))
    for i, nm in enumerate(cluster):
        p = -0.85 + 1.7 * i / (len(cluster) - 1)
        f = hz(midi(nm)) * 2 ** (r.uniform(-12, 12) / 1200)
        place(bells, bell(f, m / SR, long_bell, attack=0.001, beat=0.0015, r=r) * r.uniform(0.6, 1.0), th, p=p)
        if i < 5:
            fs = f / 2
            s = sum(saw(fs * 2 ** (c / 1200), m, r.uniform()) for c in (-11, 0, 9)) / 3
            s = tvbq(s, 'lp', 300 + 5000 * np.exp(-T(m) / 0.12), 1.0) * ar(m, 0.004, 1.4)
            place(stab, s, th, p=-p)
    boom = thud(r, n, th, 92, 27, 1.8, 0.07, noise=0.9, noise_lp=140)
    clang = hit(n, th, door_modes(), 0.0006)
    crash = bw(white(r, n), 'bp', (900, 9000)) * ar(n, 0.001, 0.6, th)
    hitm = np.zeros((2, n))
    place(hitm, P(boom) * 1.0 + P(clang) * 0.45 + P(crash) * 0.3, 0)
    hitm += P(bells) * 0.55 + P(stab) * 0.45
    hitm = reverb(hitm, ir_big_st(), wet=0.4)
    # the swell: the hit's own bells and crash, reverberated and played backwards into it
    k = N(th)
    src = np.zeros((2, k + N(1.5)))
    for i, nm in enumerate(cluster[::2]):
        place(src, bell(hz(midi(nm)), 1.5, long_bell, attack=0.001, r=r), 0.0, p=0.8 - 0.5 * i)
    place(src, bw(white(r, src.shape[-1]), 'bp', (700, 8000)) * ar(src.shape[-1], 0.001, 0.5) * 0.6, 0.0)
    src = reverb(src, ir_dining_st(), wet=1.0, dry=0.25)[:, :k][:, ::-1]
    suck = thud(r, k, 0.0, 60, 30, 0.6, 0.05, noise=0.6)[::-1]
    swell = np.zeros((2, n))
    place(swell, P(src), 0)
    place(swell, P(suck) * 0.6, 0)
    swell *= (np.clip(t / th, 0, 1) ** 2.2) * (t < th)
    # ears ringing after the hit: a thin high tone beating against its neighbour
    fr = (3150.0, 4410.0)[v]
    ring = (np.sin(PI2 * fr * t) + 0.8 * np.sin(PI2 * (fr + 2.7) * t + 1.0)) \
        * env_pts(n, [(0, 0), (th + 0.25, 0), (th + 0.9, 1.0), (dur, 0.0)])
    out = P(hitm) + 0.6 * P(swell) + np.stack([ring, 0.8 * ring]) * 0.012
    out = sat(out, 1.2)
    return out * env_pts(n, [(0, 1), (dur - 0.6, 1), (dur, 0)])


def night_midnight(v, r, n):
    """the start of the night shift: a clock ticking, one low distant bell toll, a
    heartbeat swelling under it, a breath of static at the end"""
    dur = n / SR
    t = T(n)
    out = np.zeros((2, n))
    # the wall clock: tick-tock, a little uneven, slowing a hair; it stops before the static
    ex_tick, ex_tock = np.zeros(n), np.zeros(n)
    tt, k = 0.12, 0
    while tt < 4.75:
        (ex_tick if k % 2 == 0 else ex_tock)[:] += strike(n, tt, 0.00025, 1.0 if k % 2 == 0 else 0.8)
        tt += 0.5 * (1 + 0.012 * k) + r.uniform(-0.006, 0.006)
        k += 1
    tk = (resonators(ex_tick, small_metal('clock_tick')) + resonators(ex_tock, small_metal('clock_tock'))
          + 0.5 * resonators(bw(ex_tick + ex_tock, 'lp', 3000, 1), wood_modes('clockcase')))
    place(out, reverb(P(tk), ir_office(), wet=0.25) * 0.3, 0, p=-0.4)
    # one toll of a low bell, far off in the building
    t_toll = 0.85
    toll = bell(hz(midi('D3')), dur - t_toll, [(ra, a, tt * 1.8) for ra, a, tt in SOFT_BELL], attack=0.003, r=r)
    toll += 0.3 * bw(white(r, toll.shape[-1]), 'lp', 600, 2) * ar(toll.shape[-1], 0.001, 0.05)
    toll = reverb(bw(toll, 'lp', 1500, 2), ir_far_st(), wet=1.0, dry=0.12)
    place(out, P(toll) * 0.45, t_toll)
    # the heartbeat underneath, getting faster and closer
    hb = np.zeros(n)
    for tb, a in ((1.6, 0.25), (2.5, 0.45), (3.38, 0.65), (4.24, 0.85), (5.08, 1.0)):
        place(hb, _lubdub(r, 1.2, a), tb)
    place(out, _muffle(hb) * 0.7, 0)
    # a breath of static: noise that swells and falls away like an exhale, shaped by a mouth
    m = N(1.0)
    br = np.zeros((2, m))
    common = white(r, m)
    F, B = vowel_track(m, [(0, 'uh'), (0.4, 'o'), (1.0, 'u')], fscale=1.0)
    for ch in range(2):
        nz = 0.7 * common + 0.3 * white(r, m)
        nz = eq(nz, ('peak', 3000, 0.8, 4.0), ('hs', 9000, 0.7, -4.0))
        br[ch] = 0.6 * nz + 0.5 * formants(nz, F, B, (0, -3, -6, -9)) + 0.15 * P(_crackle(r, m, 120))
    br = bw(br, 'lp', 8000, 2) * env_pts(m, [(0, 0), (0.35, 1), (0.55, 0.8), (0.95, 0)])
    place(out, P(br) * 0.3, 4.9)
    out += 0.004 * np.stack([np.sin(PI2 * 60 * t), np.sin(PI2 * 60 * t)]) * gate(n, 4.9, 5.85, 0.2, 0.3)
    return out * env_pts(n, [(0, 1), (dur - 0.4, 1), (dur, 0)])
