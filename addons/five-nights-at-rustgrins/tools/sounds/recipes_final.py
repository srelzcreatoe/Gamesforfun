"""Sounds for the Final Act (night 6): the Ringmaster's PA chime, the crowd's applause
and the spotlight striking. Same conventions as the other recipe modules:
fn(v, r, n) -> mono (n,) or stereo (2, n) float array."""
from __future__ import annotations

import numpy as np

from fnar_dsp import PI2, SR, T, ar, band_noise, bw, decay, env_pts, hz, midi, place, white
from fnar_dsp import reverb
from recipes_common import P, glock, ir_room_st, thud


def pa_chime(v, r, n):
    """A three-note carnival chime through an old ceiling speaker."""
    out = np.zeros((2, n))
    for i, (nm, t0) in enumerate([('C6', 0.0), ('A5', 0.24), ('E6', 0.48)]):
        g = glock(hz(midi(nm)), 1.3, r, bright=0.9)
        place(out, g * (0.7 if i < 2 else 0.85), 0.02 + t0, p=-0.2 + 0.2 * i)
    # the speaker: band-limited, a little crunchy, with a hum bed
    m = out.mean(axis=0)
    m = bw(bw(m, 'hp', 420, 2), 'lp', 3600, 2)
    m = P(np.tanh(P(m) * 1.8))
    # the speaker's own noise, well under the chime: mains buzz (a small cone has no 60 Hz) and hiss
    t = T(n)
    bed = env_pts(n, [(0, 0), (0.05, 1), (n / SR - 0.25, 1), (n / SR, 0)])
    hum = 0.008 * (np.sin(PI2 * 120 * t) + 0.6 * np.sin(PI2 * 240 * t + 0.4) + 0.3 * np.sin(PI2 * 360 * t + 1.1)) * bed
    hiss = 0.006 * P(band_noise(r, n, 1500, 6000)) * bed
    s = m + hum + hiss
    st = np.stack([s, s])
    return reverb(st, ir_room_st(), wet=0.25)


def crowd_applause(v, r, n):
    """A small, unseen audience clapping (it swells and dies away)."""
    dur = n / SR
    out = np.zeros((2, n))
    env = env_pts(n, [(0, 0.0), (0.35, 1.0), (dur * 0.55, 0.9), (dur, 0.0)])
    claps = int(260 * dur)
    for _ in range(claps):
        t0 = r.uniform(0.0, dur - 0.06)
        k = int(t0 * SR)
        amp = env[min(k, n - 1)] * r.uniform(0.35, 1.0)
        if amp < 0.05:
            continue
        m = int(0.045 * SR)
        burst = band_noise(r, m, r.uniform(700, 1400), r.uniform(3500, 7500)) * decay(m, r.uniform(0.02, 0.05))
        place(out, burst * amp, t0, p=r.uniform(-0.9, 0.9))
    room = 0.05 * band_noise(r, n, 200, 2000) * env
    out += np.stack([room, room])
    return reverb(out, ir_room_st(), wet=0.35)


def spot_on(v, r, n):
    """A theatre spotlight striking: heavy relay clunk, the arc catching, a hot hum."""
    t = T(n)
    clunk = thud(r, n, 0.01, 120, 50, 0.18, 0.03, noise=0.7)
    arc = band_noise(r, n, 2500, 9000) * ar(n, 0.002, 0.25, 0.03) * (0.6 + 0.4 * np.sin(PI2 * 33 * t))
    hum = (np.sin(PI2 * 100 * t) + 0.4 * np.sin(PI2 * 200 * t + 1.0)) * ar(n, 0.02, 0.6, 0.03)
    s = 0.95 * P(clunk) + 0.35 * P(arc) + 0.25 * P(hum)
    return np.stack([s, s])


# ----------------------------------------------------------------------------- storms (nights 5-6)
def storm_thunder(v, r, n):
    """Thunder heard from inside the building: a sharp crack (variants differ in distance),
    then a long low roll with rumbling bursts, muffled by the walls."""
    dur = n / SR
    t = T(n)
    near = (0.9, 0.55, 0.3)[v % 3]               # 0 = close strike, 2 = far away
    crack_at = 0.05 + 0.25 * (v % 3)
    crack = band_noise(r, n, 300, 4500) * ar(n, 0.002, 0.35, crack_at) * near
    roll = np.zeros(n)
    k = crack_at + 0.08
    while k < dur - 0.8:
        a = r.uniform(0.35, 1.0) * (1 - (k / dur) ** 1.5)
        m = int(r.uniform(0.25, 0.9) * SR)
        burst = bw(white(r, m), 'lp', r.uniform(90, 220), 2) * ar(m, r.uniform(0.04, 0.15), r.uniform(0.4, 1.2))
        place(roll, burst * a, k)
        k += r.uniform(0.12, 0.45)
    rumble = bw(white(r, n), 'lp', 70, 2) * env_pts(n, [(0, 0), (crack_at + 0.1, 1), (dur * 0.6, 0.6), (dur, 0)])
    s = P(crack) * 0.8 + P(roll) + 0.6 * P(rumble)
    s = bw(s, 'lp', 1800 + 2500 * near, 2)          # the walls take the top off
    st = np.stack([s, np.roll(s, int(0.011 * SR))])
    return reverb(st, ir_room_st(), wet=0.4)


def storm_rain(v, r, n):
    """Rain on the roof and the windows, heard inside: a dull hiss, drips and gusts (seamless loop)."""
    t = T(n)
    from fnar_dsp import periodic_lfo
    hiss = band_noise(r, n, 250, 2600, slope=-3)
    gust = 0.75 + 0.25 * periodic_lfo(n, 3, r, harmonics=2)
    out = np.stack([hiss * gust, np.roll(hiss, n // 3) * gust]) * 0.6
    for _ in range(int(9 * n / SR)):
        m = int(0.03 * SR)
        drip = band_noise(r, m, 1500, 5000) * decay(m, 0.02)
        place(out, drip * r.uniform(0.15, 0.5), r.uniform(0, n / SR), p=r.uniform(-0.8, 0.8), wrap=True)
    return out
