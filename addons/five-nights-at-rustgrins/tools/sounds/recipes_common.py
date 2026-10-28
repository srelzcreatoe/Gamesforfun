"""Shared materials for the recipe modules: rooms, mode sets, bells, small helpers.

Mode sets are seeded by name, so e.g. every sound of the office door
(slam, open, the Cat banging on it) excites the *same* steel door.
"""
from __future__ import annotations

import functools

import numpy as np

from fnar_dsp import (N, PI2, SR, T, ar, bw, click_train, env_pts, fm, norm_peak, phase, plate_modes,
                      resonators, rng, room_ir, sat, smooth_noise, strike, white)


def P(x, peak=1.0):
    """normalise to a linear peak"""
    m = float(np.max(np.abs(x)))
    return x * (peak / m) if m > 0 else x


# ----------------------------------------------------------------------------
# rooms (synthetic impulse responses)
# ----------------------------------------------------------------------------
def ir_office():
    return room_ir('office', 0.5, n_early=10, early_span=0.03, lf=1.4, hf=0.4)


def ir_hall():
    """long tiled corridor with a flutter echo between parallel walls"""
    return room_ir('hall', 1.35, early_span=0.05, flutter=(0.0152, 0.62, 12), lf=1.2, hf=0.5)


def ir_duct():
    return room_ir('duct', 0.4, n_early=6, early_span=0.008, metallic=[(0.0031, 0.78), (0.0047, 0.72),
                                                                         (0.0069, 0.6)], lf=0.8, hf=0.6)


def ir_room_st():
    return room_ir('room_st', 0.9, stereo=True, early_span=0.035)


def ir_dining_st():
    return room_ir('dining_st', 2.3, stereo=True, early_span=0.06, lf=1.35, hf=0.4)


def ir_big_st():
    return room_ir('big_st', 3.2, stereo=True, early_span=0.07, lf=1.25, hf=0.45, length=4.5)


def ir_stage_st():
    return room_ir('stage_st', 1.1, stereo=True, early_span=0.04, lf=1.3, hf=0.5)


def ir_midway():
    return room_ir('midway', 1.1, early_span=0.04, lf=1.3, hf=0.45)


def ir_plate_st():
    return room_ir('plate_st', 1.4, stereo=True, early_span=0.01, n_early=4, lf=0.9, hf=0.8)


# ----------------------------------------------------------------------------
# materials (mode sets)
# ----------------------------------------------------------------------------
@functools.lru_cache(maxsize=None)
def door_modes():
    """heavy steel roller shutter in the office doorway"""
    r = rng('mat', 'door')
    return tuple(plate_modes(r, 170, 4300, 72, 0.95, 0.22, -4.0,
                             low=[(58, 0.25, 2.6), (91, 0.32, 1.9), (131, 0.45, 1.3), (177, 0.55, 0.9)]))


@functools.lru_cache(maxsize=None)
def slat_modes():
    r = rng('mat', 'slat')
    return tuple(plate_modes(r, 650, 6800, 36, 0.07, 0.025, -2.0))


@functools.lru_cache(maxsize=None)
def vent_modes():
    """thin sheet-steel vent hatch: brighter, tinnier, less body"""
    r = rng('mat', 'vent')
    return tuple(plate_modes(r, 280, 7500, 58, 0.6, 0.13, -2.0, low=[(156, 0.2, 1.1), (231, 0.3, 0.9)]))


@functools.lru_cache(maxsize=None)
def duct_modes():
    """sheet-metal duct walls (oil-can thumps)"""
    r = rng('mat', 'duct')
    return tuple(plate_modes(r, 180, 4200, 46, 0.35, 0.08, -3.5, low=[(96, 0.25, 1.4), (143, 0.3, 1.0)]))


@functools.lru_cache(maxsize=None)
def tile_modes():
    r = rng('mat', 'tile')
    return tuple(plate_modes(r, 1300, 9500, 26, 0.035, 0.010, -1.0, low=[(620, 0.03, 0.5)]))


@functools.lru_cache(maxsize=None)
def plastic_modes(name='btn'):
    r = rng('mat', 'plastic', name)
    return tuple(plate_modes(r, 900, 6500, 20, 0.045, 0.012, -2.0, low=[(r.uniform(330, 520), 0.035, 0.7)]))


@functools.lru_cache(maxsize=None)
def small_metal(name='ping'):
    r = rng('mat', 'smallmetal', name)
    return tuple(plate_modes(r, 1800, 9500, 22, 0.13, 0.035, -1.0))


@functools.lru_cache(maxsize=None)
def wood_modes(name='wood'):
    r = rng('mat', 'wood', name)
    return tuple(plate_modes(r, 160, 2400, 30, 0.07, 0.025, -3.0))


@functools.lru_cache(maxsize=None)
def frame_modes(name='frame'):
    """animatronic metal skeleton / limbs"""
    r = rng('mat', 'frame', name)
    return tuple(plate_modes(r, 450, 5200, 40, 0.16, 0.04, -2.5, low=[(r.uniform(210, 300), 0.08, 0.8)]))


def hit(n, t0, modes, contact=0.0008, amp=1.0):
    return resonators(strike(n, t0, contact, amp), modes)


def thud(r, n, t0, f_hi=95.0, f_lo=46.0, t60=0.2, glide=0.03, noise=0.6, noise_lp=200.0):
    """low body thump with a falling pitch (impact on a heavy object/floor)"""
    t = np.maximum(T(n) - t0, 0)
    f = f_lo + (f_hi - f_lo) * np.exp(-t / glide)
    s = np.sin(PI2 * phase(f, n)) * ar(n, 0.0015, t60, t0)
    s += noise * bw(white(r, n), 'lp', noise_lp, 2) * ar(n, 0.0008, t60 * 0.45, t0) * 3.0
    return s


def creak(r, dur, f_lo=45.0, f_hi=130.0, modes=None, jitter=0.3):
    """stick-slip creak / groan: irregular friction pulses through resonances"""
    n = N(dur)
    rate = env_pts(n, [(0, f_lo), (dur * 0.45, f_hi), (dur, f_lo * 1.3)])
    rate = rate * (1 + 0.18 * smooth_noise(r, n, 7))
    clicks = click_train(r, n, rate, jitter=jitter, amp_jitter=0.6)
    t = T(n)
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.7
    return resonators(clicks * env, modes or wood_modes('creak'))


def drip(r):
    """single water drop: an upward chirping bubble + tiny tick"""
    n = N(0.12)
    t = T(n)
    f0 = r.uniform(950, 1300)
    f = f0 * (1 + 0.9 * (1 - np.exp(-t / 0.011)))
    s = np.sin(PI2 * phase(f, n)) * ar(n, 0.0006, 0.045)
    s += 0.25 * bw(strike(n, 0.0, 0.0002), 'bp', (2000, 7000))
    return s


def bell(f, dur, partials, attack=0.002, beat=0.0006, r=None, ph_rand=True):
    """additive bell: partials = [(ratio, amp, t60)]; every partial is a
    slightly split pair so it beats like a real bell"""
    n = N(dur)
    t = T(n)
    out = np.zeros(n)
    for i, (ratio, a, t60) in enumerate(partials):
        fr = f * ratio
        if fr > SR * 0.45:
            continue
        ph1 = r.uniform(0, PI2) if (r is not None and ph_rand) else 0.0
        ph2 = r.uniform(0, PI2) if (r is not None and ph_rand) else 1.0
        d = 10 ** (-3 * t / t60)
        out += a * d * 0.5 * (np.sin(PI2 * fr * (1 - beat) * t + ph1) + np.sin(PI2 * fr * (1 + beat) * t + ph2))
    if attack > 0:
        out *= np.clip(t / attack, 0, 1) ** 1.5
    return out


SOFT_BELL = [(0.5, 0.32, 3.4), (1.0, 1.0, 2.8), (1.19, 0.42, 2.0), (1.5, 0.28, 1.6), (2.0, 0.5, 1.4),
             (2.52, 0.16, 0.8), (3.01, 0.1, 0.6), (4.07, 0.05, 0.35)]
BRIGHT_BELL = [(1.0, 1.0, 2.4), (2.0, 0.12, 1.2), (2.76, 0.42, 0.9), (4.1, 0.08, 0.5), (5.4, 0.2, 0.3),
               (8.93, 0.06, 0.12)]


def glock(f, dur, r, bright=1.0, t60=None):
    """bright bell / glockenspiel: additive bar modes + a short FM shimmer"""
    n = N(dur)
    t = T(n)
    t60 = t60 or float(np.clip(2.6 * (1000.0 / f) ** 0.35, 0.8, 3.0))
    parts = [(ratio, a * (bright if ratio > 1 else 1.0), tt * t60 / 2.4) for ratio, a, tt in BRIGHT_BELL]
    s = bell(f, dur, parts, attack=0.0008, r=r)
    idx = 2.2 * bright * np.exp(-t / 0.03)
    s += 0.35 * fm(f, 3.5, idx, n) * 10 ** (-3 * t / (t60 * 0.25))
    s += 0.08 * bright * bw(strike(n, 0.0, 0.00015), 'hp', 3000)
    return s


def phone_line(x, r, hiss=0.02, drive=2.0):
    """telephone earpiece / line: 300-3400 Hz band, carbon-mic grit, hiss"""
    y = bw(x, 'bp', (300, 3400), 4)
    y = norm_peak(y, 0)
    y = sat(y * 1.0, drive, 0.1)
    from fnar_dsp import eq
    y = eq(y, ('peak', 1700, 1.0, 4.0), ('peak', 650, 1.4, 2.0))
    n = y.shape[-1]
    y += hiss * bw(white(r, n), 'bp', (300, 3400), 2)
    return y
