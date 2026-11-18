"""Recipes: the pizzeria by day (fnar.day.*), the sound of the guests.

Same conventions as the other recipe modules: fn(v, r, n) -> mono (n,) float
array (all three are positional, so mono). The murmur is a loop and is built
circularly: voices and clinks are placed with wrap-around, the room tone is
periodic noise, the reverb runs circularly. Everything is synthesised; the
voices are the formant babble of recipes_office (speech-like, no words) and the
child voices of recipes_night, here played straight and bright instead of
slowed and far away.
"""
from __future__ import annotations

import numpy as np

from fnar_dsp import (N, PI2, SR, T, ar, band_noise, bw, circ, decay, env_pts, formants, gate, place, reverb,
                      smooth_noise, voice_src, vowel_track, white)
from recipes_common import P, glock, hit, ir_dining_st, ir_room_st, small_metal, thud, wood_modes
from recipes_night import _child_laugh, _kid_babble
from recipes_office import babble


def _far(x, lp, hp=160.0):
    """a voice across the room: the top and the bottom taken off"""
    return bw(bw(x, 'lp', lp, 2), 'hp', hp, 2)


def _whoop(r, f0, dur=0.55, fscale=1.0, vowels=('u', 'u'), rise=1.9):
    """a happy shout on one breath: "woo!" (the pitch sweeps up and tails off) or "yay!" (i -> e -> a)"""
    n = N(dur + 0.12)
    t = T(n)
    x = np.clip(t / dur, 0, 1)
    f = f0 * (1 + (rise - 1) * np.sin(np.pi * np.minimum(x * 1.25, 1) / 2) ** 1.5) * (1 - 0.18 * np.clip((x - 0.75) / 0.25, 0, 1))
    f = f * (1 + 0.012 * smooth_noise(r, n, 9))
    keys = [(0.0, vowels[0])] + [(dur * (i + 1) / len(vowels), v) for i, v in enumerate(vowels)] + [(dur + 0.12, vowels[-1])]
    F, B = vowel_track(n, keys, fscale=fscale)
    src = voice_src(r, f, n, jitter=0.012, shimmer=0.06, breath=0.18)
    env = gate(n, 0.01, dur, 0.035, 0.09)
    return P(formants(src * env, F, B, (0, -3, -8, -13)))


def _clap(r, bright=1.0):
    """one pair of hands: a short burst of band-passed noise with a hollow thump under it"""
    m = N(0.07)
    lo = r.uniform(650, 1300) * bright
    s = band_noise(r, m, lo, r.uniform(3200, 6800) * bright) * decay(m, r.uniform(0.022, 0.05))
    s += 0.5 * band_noise(r, m, 180, 700) * decay(m, 0.03)
    return s * ar(m, 0.0008, 0.06)


def day_crowd(v, r, n):
    """A family restaurant on a busy afternoon, heard from inside the room: two dozen people talking
    over each other, children chattering and laughing, cutlery on plates, a chair pushed back.
    A seamless loop; nobody says a word you could make out."""
    dur = n / SR
    out = np.zeros(n)
    # grown-ups at the tables: each talks in short turns, about half the time. The near ones are clear,
    # the rest are the room.
    for k in range(13):
        man = k % 2 == 0
        f0 = r.uniform(96, 132) if man else r.uniform(178, 232)
        fscale = r.uniform(0.97, 1.04) if man else r.uniform(1.12, 1.2)
        near = k < 3
        gain = r.uniform(0.75, 1.0) if near else r.uniform(0.3, 0.6)
        lp = r.uniform(3600, 4600) if near else r.uniform(1500, 2600)
        t = r.uniform(0, dur)
        spoken = 0.0
        while spoken < dur * (0.5 if near else 0.6):
            d = r.uniform(1.1, 2.6)
            phrase = babble(r, d, f0 * r.uniform(0.94, 1.1), fscale)
            place(out, _far(P(phrase), lp) * gain * r.uniform(0.7, 1.0), t, wrap=True)
            spoken += d
            t += d + r.uniform(0.5, 2.6)
    # children: quick excited chatter, and laughing
    for k in range(5):
        f0 = r.uniform(275, 345)
        fscale = r.uniform(1.38, 1.5)
        gain = r.uniform(0.35, 0.7)
        t = r.uniform(0, dur)
        spoken = 0.0
        while spoken < dur * 0.4:
            d = r.uniform(0.7, 1.6)
            place(out, _far(P(_kid_babble(r, d, f0 * r.uniform(0.95, 1.1), fscale)), r.uniform(2600, 4200), 220) * gain, t, wrap=True)
            spoken += d
            t += d + r.uniform(0.8, 3.0)
    for k in range(4):
        laugh = _child_laugh(r, int(r.integers(3, 6)), r.uniform(4.6, 5.6), r.uniform(300, 380), r.uniform(1.4, 1.5),
                             vowel=str(r.choice(['a', 'i'])), fall=0.2, gasp=float(r.choice([0.0, 0.5])))
        place(out, _far(P(laugh), 4200, 240) * r.uniform(0.35, 0.6), (k + r.uniform(0.1, 0.9)) * dur / 4, wrap=True)
    place(out, _far(_whoop(r, 330, 0.5, 1.45, ('i', 'e', 'a'), rise=1.5), 3800, 240) * 0.3, r.uniform(0, dur), wrap=True)
    # the tables: forks and plates, a glass put down, a chair pushed back on the carpet
    for k in range(int(dur * 1.9)):
        m = N(0.35)
        ping = hit(m, 0.002, small_metal(str(r.choice(['fork', 'plate', 'glass']))), contact=r.uniform(0.0002, 0.0006))
        ping = bw(ping, 'hp', 900, 2) * decay(m, r.uniform(0.08, 0.3))
        place(out, P(ping) * r.uniform(0.03, 0.12), r.uniform(0, dur), wrap=True)
    for k in range(2):
        m = N(0.5)
        scrape = hit(m, 0.01, wood_modes('chair'), contact=0.004) + 0.6 * thud(r, m, 0.02, 120, 60, 0.12, 0.03, noise=0.8)
        place(out, bw(P(scrape), 'lp', 900, 2) * 0.16, r.uniform(0, dur), wrap=True)
    # the room itself: air, the kitchen's fans, the carpet soaking it all up
    out = P(out) + 0.03 * band_noise(r, n, 140, 1600, slope=-3) + 0.012 * band_noise(r, n, 2000, 7000, slope=-4)
    wet = reverb(out, ir_dining_st()[0], wet=1.0, dry=0.0, circular=True)
    out = 0.8 * out + 0.5 * wet
    # the level breathes a little, a whole number of times per loop
    swell = 1 + 0.1 * np.sin(PI2 * 2 * T(n) / dur + 0.6) + 0.06 * np.sin(PI2 * 5 * T(n) / dur + 2.1)
    return circ(lambda x: bw(bw(x, 'hp', 150, 2), 'lp', 6500, 2), out * swell)


def day_cheer(v, r, n):
    """The audience at a show, for a few seconds: a dozen people clapping, a "woo!", children's "yay!".
    v 0: clapping and one whoop; v 1: the children louder; v 2: a short, polite round."""
    dur = n / SR
    out = np.zeros(n)
    people = (12, 10, 8)[v]
    env = env_pts(n, [(0, 0.0), (0.22, 1.0), (dur * 0.55, 0.85), (dur - 0.1, 0.0), (dur, 0.0)])
    for k in range(people):
        rate = r.uniform(3.4, 4.6)           # everyone claps at their own pace
        bright = r.uniform(0.8, 1.25)
        gain = r.uniform(0.35, 1.0)
        t = r.uniform(0.0, 0.3)
        while t < dur - 0.25:
            a = env[min(n - 1, int(t * SR))] * gain * r.uniform(0.75, 1.0)
            if a > 0.03:
                place(out, _clap(r, bright) * a, t)
            t += (1 / rate) * r.uniform(0.9, 1.12)
    shouts = []
    if v == 0:
        shouts = [(0.35, _whoop(r, 215, 0.6, 1.14, ('u', 'u'), 1.9), 0.36), (1.3, _whoop(r, 320, 0.45, 1.45, ('i', 'e', 'a'), 1.5), 0.3)]
    elif v == 1:
        shouts = [(0.2, _whoop(r, 335, 0.5, 1.47, ('i', 'e', 'a'), 1.55), 0.42), (0.9, _whoop(r, 300, 0.55, 1.42, ('u', 'u'), 2.0), 0.36),
                  (1.5, P(_child_laugh(r, 4, 5.2, 340, 1.45, vowel='a', fall=0.2)), 0.36)]
    else:
        shouts = [(0.6, _whoop(r, 190, 0.5, 1.1, ('u', 'u'), 1.7), 0.22)]
    for t0, s, g in shouts:
        place(out, bw(s, 'lp', 4500, 2) * g * float(np.max(np.abs(out)) or 1.0), t0)
    out = P(out)
    wet = reverb(out, ir_dining_st()[0], wet=1.0, dry=0.0)
    return bw(0.85 * out + 0.4 * wet, 'hp', 170, 2)


def day_door_chime(v, r, n):
    """The bell over the front doors: two warm notes, ding... dong, and the door settling."""
    out = np.zeros(n)
    place(out, glock(659.3, 1.1, r, bright=0.7, t60=1.3) * 0.9, 0.03)      # E5
    place(out, glock(523.3, 1.3, r, bright=0.6, t60=1.6) * 0.85, 0.37)    # C5
    # the little hammer of a mechanical chime, and the door's closer
    m = N(0.2)
    for t0 in (0.028, 0.368):
        place(out, bw(hit(m, 0.002, small_metal('chime'), contact=0.0004), 'hp', 1200, 2) * 0.12, t0)
    place(out, thud(r, N(0.4), 0.01, 110, 55, 0.14, 0.03, noise=0.5) * 0.08, 0.9)
    wet = reverb(out, ir_room_st()[0], wet=1.0, dry=0.0)
    return bw(out + 0.22 * wet, 'hp', 220, 2)
