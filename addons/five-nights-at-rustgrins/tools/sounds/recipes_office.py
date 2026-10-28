"""Recipes: ambience, office devices, cameras, clock, phone, hallucinations, UI.

Every recipe has the signature fn(v, r, n) -> np.ndarray, where v is the
variant index, r a seeded numpy Generator and n the target length in
samples. Loops are built circularly (periodic noise, integer LFO cycles,
wrapped event placement, filters/reverb run over two periods).
"""
from __future__ import annotations

import numpy as np

from fnar_dsp import (N, PI2, SR, T, ar, band_noise, bitcrush, bw, circ, click_train, decay, env_pts, eq, fm,
                      formants, gate, loop_hz, periodic_lfo, phase, place, pulse, resonators, reverb, saw, sat,
                      smooth_noise, strike, tvbq, voice_src, vowel_track, white, midi, hz, bq)
from recipes_common import (SOFT_BELL, P, bell, creak, door_modes, drip, glock, hit, ir_big_st, ir_dining_st,
                            ir_duct, ir_office, ir_room_st, phone_line, plastic_modes, slat_modes, small_metal,
                            thud, vent_modes, wood_modes, duct_modes)


# =============================================================================
# ambience
# =============================================================================
def _ballast(r, n, f=120.0, wobble=0.0012, cycles=3):
    """magnetic-ballast fluorescent buzz: 120 Hz family, asymmetric clipping
    for the 'zzz', a rasp of noise bursts synced to the mains peaks"""
    wob = 1 + wobble * periodic_lfo(n, cycles, r, harmonics=2)
    ph = phase(f * wob, n)
    s = np.sin(PI2 * ph)
    hum = (0.55 * s + 0.32 * np.sin(2 * PI2 * ph + 0.7) + 0.18 * np.sin(3 * PI2 * ph + 1.9)
           + 0.10 * np.sin(4 * PI2 * ph + 0.3) + 0.06 * np.sin(5 * PI2 * ph + 2.2))
    buzz = np.tanh(4.0 * (s + 0.35)) - np.tanh(1.4)
    buzz = circ(bw, buzz, 'bp', (240, 5200))
    rasp = band_noise(r, n, 1800, 7500) * np.maximum(s, 0) ** 10
    return hum, buzz, rasp


def amb_office(v, r, n):
    t = T(n)
    hum, buzz, rasp = _ballast(r, n)
    lvl = 1 + 0.06 * periodic_lfo(n, 7, r) + 0.03 * periodic_lfo(n, 23, r)
    # the tubes lead: hum lines + 'zzz' buzz + rasp, all clearly above the HVAC
    light = (P(hum) + 0.55 * P(buzz) + 0.35 * P(rasp)) * lvl
    # distant HVAC: blower rumble, air in the ducts, motor tone
    rumble = band_noise(r, n, 25, 220, slope=-3) * (1 + 0.25 * periodic_lfo(n, 1, r) + 0.12 * periodic_lfo(n, 4, r))
    air = band_noise(r, n, 200, 2600, slope=-4) * (1 + 0.15 * periodic_lfo(n, 2, r))
    fmot = loop_hz(29.6, n)
    blower = 0.25 * np.sin(PI2 * fmot * t) + 0.1 * np.sin(PI2 * 2 * fmot * t + 1) + 0.04 * np.sin(PI2 * loop_hz(236.8, n) * t)
    hvac = 0.8 * rumble + 0.22 * air + blower
    return 0.5 * light + 0.12 * hvac


def amb_fan(v, r, n):
    t = T(n)
    rot = loop_hz(19.5, n)            # revolutions per second (integer per loop)
    bpf = 3 * rot                      # three blades
    air = band_noise(r, n, 150, 7000, slope=-2.5)
    am = 1 + 0.38 * np.sin(PI2 * bpf * t) + 0.14 * np.sin(PI2 * 2 * bpf * t + 0.5)
    whir = air * am
    whir = circ(eq, whir, ('peak', 1100, 1.0, 3.0), ('peak', 3400, 2.0, 2.0))
    tone = sum(a * np.sin(PI2 * k * bpf * t + r.uniform(0, PI2)) for k, a in
               [(1, 0.5), (2, 0.25), (3, 0.12), (4, 0.08), (6, 0.04)])
    motor = (0.18 * np.sin(PI2 * 120 * t) + 0.08 * np.sin(PI2 * 240 * t + 1)
             + 0.025 * np.sin(PI2 * loop_hz(2310, n) * t) * (1 + 0.3 * np.sin(PI2 * rot * t)))
    revs = int(round(rot * n / SR))
    ex = np.zeros(n)
    for k in range(revs):
        a = 0.5 + 0.5 * np.sin(PI2 * 2 * k / revs + 1.0)   # rattle swells twice per loop
        if r.uniform() < 0.85:
            ex += strike(n, (k + 0.3 + 0.03 * r.standard_normal()) / rot, 0.0003, a * r.uniform(0.4, 1.0))
    modes = small_metal('fan')
    rattle = circ(lambda z: resonators(z, modes), ex)
    return 0.6 * P(whir) + 0.1 * P(tone) + 0.3 * P(motor) + 0.16 * P(rattle)


def amb_building(v, r, n):
    t = T(n)
    dur = n / SR
    bed = np.zeros((2, n))
    for ch in range(2):
        d = np.zeros(n)
        for f, a in [(41.2, 0.5), (55.0, 0.32), (61.9, 0.18), (82.6, 0.1)]:
            fl = loop_hz(f * (1 + 0.003 * (ch - 0.5)), n)
            d += a * np.sin(PI2 * fl * t + r.uniform(0, PI2)) * (1 + 0.35 * periodic_lfo(n, int(r.integers(1, 4)), r))
        rum = band_noise(r, n, 22, 150, slope=-2) * 0.45 * (1 + 0.4 * periodic_lfo(n, 2, r))
        tone = band_noise(r, n, 80, 1400, slope=-6) * 0.1
        bed[ch] = 0.7 * d + rum + tone
    # events (wrapped so the loop stays seamless)
    ev = np.zeros((2, n))
    creak_times = [1.3, 7.9, 13.6, 19.4]
    for i, tc in enumerate(creak_times):
        cd = r.uniform(0.5, 1.3)
        modes = wood_modes('bld%d' % i) if i % 2 == 0 else duct_modes()
        c = creak(r, cd, r.uniform(30, 55), r.uniform(80, 150), modes)
        place(ev, P(c) * r.uniform(0.25, 0.45), tc, wrap=True, p=r.uniform(-0.9, 0.9))
    for k in range(5):                       # a far-off drip every ~4.8 s
        tdrop = 2.4 + 4.8 * k + 0.05 * r.standard_normal()
        place(ev, P(drip(r)) * r.uniform(0.18, 0.26), tdrop, wrap=True, p=-0.55)
    for k in range(7):                       # metallic ticks (ducts cooling)
        tk = r.uniform(0, dur)
        m = N(0.4)
        pk = resonators(strike(m, 0.001, 0.0002), small_metal('tick%d' % (k % 3)))
        place(ev, P(pk) * r.uniform(0.08, 0.2), tk, wrap=True, p=r.uniform(-1, 1))
    ev = circ(bw, ev, 'lp', 5500)
    wet = reverb(ev, ir_dining_st(), wet=1.0, dry=0.35, circular=True)
    return bed * 0.5 + wet * 0.9


def amb_duct(v, r, n):
    air = band_noise(r, n, 40, 4500, slope=-3.5)

    def res(z):
        for f, q, g in [(118, 9, 9), (236, 10, 7), (354, 10, 5), (473, 10, 4), (590, 12, 3), (1420, 6, 3)]:
            z = bq(z, 'peak', f, q, g)
        return z
    hollow = circ(res, air)
    gust = 1 + 0.35 * periodic_lfo(n, 1, r) + 0.18 * periodic_lfo(n, 3, r)
    bright = circ(bw, hollow, 'hp', 900)
    flow = hollow * gust + 0.6 * bright * np.maximum(gust - 0.9, 0)
    whistle = circ(lambda z: bq(z, 'bp', 1880, 22), band_noise(r, n, 1000, 4000)) * np.maximum(gust - 0.7, 0) ** 2
    pops = np.zeros(n)
    for k in range(3):
        m = N(0.5)
        e = strike(m, 0.002, 0.003)
        place(pops, resonators(e, duct_modes()), r.uniform(0, n / SR), wrap=True)
    return P(flow) + 0.25 * P(whistle) + 0.12 * P(pops)


def amb_light_buzz(v, r, n):
    t = T(n)
    dur = n / SR
    ph = phase(120.0, n)
    s = np.sin(PI2 * ph)
    s60 = np.sin(np.pi * ph)
    harsh = np.tanh(6 * (s + 0.5 * s60 + 0.2))
    harsh = circ(bw, harsh, 'bp', (90, 6500))
    rasp = band_noise(r, n, 1500, 9000) * np.maximum(s, 0) ** 6
    sizzle = band_noise(r, n, 4000, 12000)
    # flicker: two moments per loop where the tube stutters (periodic bumps)
    flick = np.zeros(n)
    crack = np.zeros(n)
    for tc, w in [(0.55, 0.06), (1.42, 0.035)]:
        dd = (t - tc + dur / 2) % dur - dur / 2
        flick += np.exp(-0.5 * (dd / w) ** 2)
        for k in range(6):
            crack += strike(n, (tc + r.uniform(-w, w)) % dur, 0.0002, r.uniform(0.3, 1))
    crack = circ(bw, crack, 'bp', (1500, 8000))
    lvl = 1 - 0.75 * np.clip(flick, 0, 1) * (0.5 + 0.5 * np.sign(np.sin(PI2 * loop_hz(14, n) * t)))
    return (0.6 * P(harsh) + 0.25 * P(rasp) + 0.08 * P(sizzle) * (0.4 + flick)) * lvl + 0.3 * P(crack)


# =============================================================================
# doors, lights, buttons, vents
# =============================================================================
def door_close(v, r, n):
    ti = 0.30
    rate = env_pts(n, [(0, 20), (0.15, 34), (0.29, 62), (0.3, 62)])
    clicks = click_train(r, n, rate, jitter=0.3, amp_jitter=0.6, t0=0.012, t1=ti - 0.004)
    renv = env_pts(n, [(0, 0.2), (0.15, 0.5), (ti, 1.0), (ti + 0.001, 0)])
    roll = resonators(clicks * renv, slat_modes())
    scrape = tvbq(white(r, n), 'bp', env_pts(n, [(0, 900), (ti, 2600)]), 1.4) \
        * env_pts(n, [(0, 0), (0.05, 0.25), (ti - 0.01, 0.6), (ti, 0)])
    whoosh = tvbq(white(r, n), 'lp', env_pts(n, [(0, 300), (ti, 1800)], log=True), 0.7) \
        * env_pts(n, [(0, 0), (ti - 0.03, 0.5), (ti, 0.2), (ti + 0.04, 0)])
    exc = strike(n, ti, 0.00025, 1.0) + strike(n, ti + 0.038, 0.0005, 0.35) + strike(n, ti + 0.094, 0.0007, 0.15)
    exc += bw(white(r, n), 'hp', 1500) * ar(n, 0.0002, 0.012, ti) * 0.08
    clang = resonators(exc, door_modes())
    crash = bw(white(r, n), 'bp', (1800, 11000), 2) * ar(n, 0.0004, 0.16, ti) \
        + 0.5 * bw(white(r, n), 'bp', (1800, 9000), 2) * ar(n, 0.0004, 0.08, ti + 0.038)
    crash = resonators(crash, slat_modes()) * 0.5 + crash
    body = thud(r, n, ti, 95, 44, 0.32, 0.03, noise=0.7)
    rr = click_train(r, n, 28, jitter=0.4, amp_jitter=0.7, t0=ti + 0.03, t1=ti + 0.42) * decay(n, 0.25, ti)
    settle = resonators(rr, slat_modes())
    mix = (0.22 * P(roll) + 0.10 * P(scrape) + 0.08 * P(whoosh) + 1.0 * P(clang) + 0.95 * P(body)
           + 0.12 * P(settle) + 0.35 * P(crash))
    mix = reverb(mix, ir_office(), wet=0.22)
    return sat(P(mix) * 1.3, 1.3)


def door_open(v, r, n):
    sp = env_pts(n, [(0, 0), (0.03, 0), (0.18, 1.0), (1.12, 1.0), (1.2, 0.0)])
    fmot = 80 + 45 * sp
    motor = bw(saw(fmot, n) * 0.5 + pulse(fmot * 2, n, 0.3) * 0.25, 'lp', 1400) * sp
    whine = (fm(700 + 520 * sp, 0.5, 1.4, n) * 0.25 + np.sin(PI2 * phase(1400 + 1040 * sp, n)) * 0.06) * sp ** 1.2
    chain = resonators(click_train(r, n, 16 + 22 * sp, jitter=0.25, t0=0.05, t1=1.15) * sp, slat_modes())
    rumble = bw(white(r, n), 'bp', (60, 500)) * sp * 0.4
    tc = 1.16
    clank = resonators(strike(n, tc, 0.0004, 1.0) + strike(n, tc + 0.031, 0.0007, 0.3), door_modes())
    latch = hit(n, tc + 0.055, small_metal('latch'), 0.0003, 1.0)
    stop = thud(r, n, tc, 110, 60, 0.15, 0.02, noise=0.4)
    mix = (0.45 * P(motor) + 0.25 * P(whine) + 0.35 * P(chain) + 0.2 * P(rumble) + 0.75 * P(clank)
           + 0.25 * P(latch) + 0.5 * P(stop))
    mix = reverb(mix, ir_office(), wet=0.2)
    return sat(P(mix) * 1.2, 1.2)


def door_error(v, r, n):
    t = T(n)
    click = hit(n, 0.006, plastic_modes('btn'), 0.0004)
    f = 118.0
    src = pulse(f, n, 0.25) + 0.5 * saw(f * 2.003, n)
    chatter = 1 + 0.45 * np.sign(np.sin(PI2 * 33 * t))
    env = gate(n, 0.03, 0.17, 0.004, 0.012) + gate(n, 0.23, 0.39, 0.004, 0.015)
    buzz = sat(bw(src, 'bp', (150, 3500)) * 2.5, 2.5) * env * chatter
    relay = np.zeros(n)
    for tt in (0.03, 0.17, 0.23, 0.39):
        relay += hit(n, tt, small_metal('relay'), 0.0003, 1.0)
    dead = thud(r, n, 0.42, 120, 80, 0.06, 0.01, noise=0.3)
    return 0.5 * P(click) + 0.8 * P(buzz) + 0.25 * P(relay) + 0.4 * P(dead)


def _switch(r, n, t0, name, amp=1.0):
    exc = strike(n, t0, 0.00025, 1.0) + strike(n, t0 + 0.0045, 0.0004, 0.4)
    snap = resonators(exc, plastic_modes(name)) + 0.5 * resonators(exc, small_metal(name))
    thock = resonators(strike(n, t0, 0.0015), [(420, 0.05, 1.0), (760, 0.03, 0.5)])
    return amp * (P(snap) + 0.45 * P(thock))


def light_on(v, r, n):
    t = T(n)
    sw = _switch(r, n, 0.006, 'light')
    tb = 0.022
    thunk = thud(r, n, tb, 75, 55, 0.12, 0.02, noise=0.4)
    hum = (np.sin(PI2 * 120 * t) + 0.5 * np.sin(PI2 * 240 * t + 1) + 0.25 * np.sin(PI2 * 360 * t + 2)) \
        * ar(n, 0.01, 0.35, tb)
    buzz = band_noise(r, n, 2000, 6500) * np.maximum(np.sin(PI2 * 120 * t), 0) ** 8 * ar(n, 0.005, 0.2, tb)
    ping = hit(n, tb + 0.012, [(4230, 0.09, 1.0), (6120, 0.05, 0.4)], 0.0002)
    return 0.9 * sw + 0.6 * P(thunk) + 0.22 * P(hum) + 0.12 * P(buzz) + 0.1 * P(ping)


def light_off(v, r, n):
    t = T(n)
    sw = _switch(r, n, 0.005, 'lightoff')
    hum = (np.sin(PI2 * 120 * t) + 0.5 * np.sin(PI2 * 240 * t + 1)) * decay(n, 0.05, 0.0) * gate(n, 0.0, 0.006, 0.003, 0.03)
    return 0.9 * sw + 0.12 * P(hum)


def button_press(v, r, n):
    modes = plastic_modes('press%d' % v)
    press = resonators(strike(n, 0.005, 0.0003, 1.0), modes)
    tock = resonators(strike(n, 0.005, 0.0012), [(520 + 140 * v, 0.03, 1.0), (980 + 90 * v, 0.02, 0.4)])
    rel = resonators(strike(n, 0.07 + 0.014 * v, 0.0004, 0.45), modes)
    return P(press) + 0.4 * P(tock) + 0.35 * P(rel)


def vent_close(v, r, n):
    ti = 0.12
    sp = env_pts(n, [(0, 0.3), (ti, 1.0), (ti + 0.001, 0)])
    fr = click_train(r, n, 140 + 60 * sp, jitter=0.35, amp_jitter=0.6, t0=0.006, t1=ti - 0.002)
    slide = resonators(fr * sp, vent_modes())
    scrape = bw(white(r, n), 'bp', (1200, 6000)) * sp * gate(n, 0.006, ti, 0.01, 0.002)
    exc = strike(n, ti, 0.0008, 1.0) + strike(n, ti + 0.026, 0.0012, 0.3)
    clang = resonators(exc, vent_modes())
    body = thud(r, n, ti, 160, 120, 0.09, 0.015, noise=0.3)
    rat = click_train(r, n, 48, jitter=0.3, amp_jitter=0.6, t0=ti + 0.01, t1=ti + 0.32) * decay(n, 0.22, ti)
    rattle = resonators(rat, vent_modes())
    mix = 0.18 * P(slide) + 0.1 * P(scrape) + 1.0 * P(clang) + 0.4 * P(body) + 0.18 * P(rattle)
    mix = 0.75 * reverb(mix, ir_duct(), wet=0.25) + 0.25 * reverb(mix, ir_office(), wet=0.3, dry=0)
    return mix


def vent_open(v, r, n):
    sp = env_pts(n, [(0.04, 0), (0.12, 1.0), (0.45, 0.8), (0.56, 0)])
    latch = hit(n, 0.008, small_metal('ventlatch'), 0.0003)
    fr = click_train(r, n, 90 + 90 * sp, jitter=0.4, amp_jitter=0.7, t0=0.04, t1=0.56)
    slide = resonators(fr * sp, vent_modes())
    scrape = bw(white(r, n), 'bp', (800, 5000)) * sp
    tc = 0.585
    stop = resonators(strike(n, tc, 0.0015, 1.0), vent_modes())
    body = thud(r, n, tc, 140, 100, 0.07, 0.01, noise=0.3)
    mix = 0.35 * P(latch) + 0.5 * P(slide) + 0.18 * P(scrape) + 0.6 * P(stop) + 0.3 * P(body)
    return reverb(mix, ir_duct(), wet=0.2)


# =============================================================================
# cameras
# =============================================================================
def _crackle(r, n, density, t0=0.0, t1=None):
    t1 = n / SR if t1 is None else t1
    k = int(density * (t1 - t0))
    out = np.zeros(n)
    for tt in r.uniform(t0, t1, k):
        out += strike(n, tt, 0.00015, r.uniform(-1, 1))
    return bw(out, 'bp', (900, 9000))


def cam_up(v, r, n):
    out = np.zeros((2, n))
    w = tvbq(white(r, n), 'bp', env_pts(n, [(0, 500), (0.22, 2800), (0.32, 3200)], log=True), 1.1) \
        * env_pts(n, [(0, 0), (0.16, 1), (0.24, 0.4), (0.33, 0)])
    pp = env_pts(n, [(0, -0.4), (0.3, 0.3)])
    out += np.stack([np.cos((pp + 1) * np.pi / 4) * w, np.sin((pp + 1) * np.pi / 4) * w]) * 0.5 / np.max(np.abs(w))
    clack = hit(n, 0.2, plastic_modes('monitor'), 0.0005)
    place(out, P(clack) * 0.35, 0)
    tc = 0.24
    thunk = thud(r, n, tc, 70, 48, 0.2, 0.02, noise=0.3)
    t = T(n)
    degauss = bw(pulse(60.0, n, 0.2), 'lp', 900) * ar(n, 0.005, 0.32, tc + 0.01)
    place(out, P(thunk) * 0.6 + P(degauss) * 0.22, 0)
    for ch in range(2):
        hiss = bw(white(r, n), 'hp', 4000) * env_pts(n, [(tc, 0), (0.3, 0.45), (0.5, 0.3)])
        whine = np.sin(PI2 * 15734 * t) * env_pts(n, [(tc, 0), (0.45, 1.0)]) * 0.18
        crack = _crackle(r, n, 300, tc, 0.48)
        out[ch] += 0.18 * hiss / 4 + whine * 0.25 + 0.12 * P(crack)
    return out


def cam_down(v, r, n):
    out = np.zeros((2, n))
    t = T(n)
    tz = 0.015
    tt = np.maximum(t - tz, 0)
    fz = 150 + 6800 * np.exp(-tt / 0.018)
    zipz = np.sin(PI2 * phase(fz, n)) * ar(n, 0.001, 0.09, tz)
    pop = thud(r, n, tz, 90, 50, 0.08, 0.01, noise=0.2)
    place(out, P(zipz) * 0.4 + P(pop) * 0.45, 0)
    w = tvbq(white(r, n), 'bp', env_pts(n, [(0.04, 2800), (0.28, 500)], log=True), 1.1) \
        * env_pts(n, [(0.03, 0), (0.1, 1), (0.22, 0.5), (0.3, 0)])
    out += np.stack([w * 0.8, w * 0.6]) * 0.45 / np.max(np.abs(w))
    clack = hit(n, 0.29, plastic_modes('monitor'), 0.0012)
    place(out, P(clack) * 0.3, 0)
    for ch in range(2):
        out[ch] += bw(white(r, n), 'hp', 4000) * gate(n, 0.0, tz, 0.003, 0.004) * 0.06
    return out


def cam_switch(v, r, n):
    out = np.zeros((2, n))
    t = T(n)
    f = [1180.0, 940.0, 1480.0][v]
    if v == 2:
        g = gate(n, 0.004, 0.028, 0.002, 0.003) + gate(n, 0.042, 0.068, 0.002, 0.004)
    else:
        g = gate(n, 0.004, 0.058, 0.002, 0.005)
    beep = (np.sin(PI2 * f * t) + 0.3 * np.sin(PI2 * 3 * f * t)) * g
    place(out, beep * 0.45, 0)
    common = white(r, n)
    env = ar(n, 0.002, 0.28, 0.05) * (1 + 0.5 * smooth_noise(r, n, 40))
    for ch in range(2):
        nz = 0.65 * common + 0.35 * white(r, n)
        nz = bw(nz, 'bp', (400, 9000)) * env
        out[ch] += 0.16 * nz + 0.12 * P(_crackle(r, n, 400, 0.05, 0.25))
    place(out, P(thud(r, n, 0.05, 80, 60, 0.06, 0.01, noise=0.1)) * 0.25, 0)
    return out


def cam_static(v, r, n):
    t = T(n)
    out = np.zeros((2, n))
    common = white(r, n)
    am = 1 + 0.25 * smooth_noise(r, n, 30)
    vs = bw(pulse(60.0, n, 0.1), 'bp', (60, 2000))
    hum = np.sin(PI2 * 60 * t) + 0.6 * np.sin(PI2 * 120 * t)
    for ch in range(2):
        nz = 0.7 * common + 0.3 * white(r, n)
        nz = eq(nz, ('peak', 3000, 0.8, 4.0), ('hs', 9000, 0.7, -3.0))
        out[ch] = (0.5 * nz * am / 3 + 0.12 * P(_crackle(r, n, 250)) + 0.05 * vs + 0.05 * hum
                   + 0.012 * np.sin(PI2 * 15734 * t))
    return out * gate(n, 0.0, n / SR - 0.16, 0.008, 0.15)


def cam_hum(v, r, n):
    t = T(n)
    out = np.zeros((2, n))
    fw = loop_hz(15734, n)
    whine = np.sin(PI2 * fw * t) * (1 + 0.1 * periodic_lfo(n, 3, r))
    hum = sum(a * np.sin(PI2 * k * 60 * t + r.uniform(0, PI2)) for k, a in
              [(1, 0.25), (2, 0.5), (3, 0.2), (4, 0.15), (5, 0.07), (6, 0.05)])
    fly = band_noise(r, n, 2000, 7000) * np.maximum(np.sin(PI2 * 60 * t), 0) ** 12
    for ch in range(2):
        hiss = band_noise(r, n, 2000, 12000)
        out[ch] = 0.9 * hum + 0.06 * whine * (1.0 if ch == 0 else 0.9) + 0.08 * fly + 0.03 * hiss
    return out


def cam_glitch(v, r, n):
    out = np.zeros((2, n))
    tcur = 0.004
    prev = None
    while tcur < 0.56:
        L = float(r.uniform(0.008, 0.06))
        m = N(L)
        kind = r.choice(['static', 'tone', 'buzz', 'gap', 'stutter', 'sweep', 'crush'],
                        p=[0.24, 0.17, 0.15, 0.04, 0.16, 0.11, 0.13])
        if prev is None and kind in ('gap', 'stutter'):
            kind = 'static'
        if kind == 'stutter' and prev is not None:
            seg = np.tile(prev[:max(32, len(prev) // int(r.integers(2, 5)))], 6)[:m]
        elif kind == 'static':
            seg = white(r, m) * 0.6
        elif kind == 'tone':
            seg = np.sign(np.sin(PI2 * r.uniform(200, 3000) * T(m))) * 0.35
        elif kind == 'buzz':
            seg = pulse(r.uniform(50, 130), m, 0.2) * 0.5
        elif kind == 'sweep':
            seg = np.sin(PI2 * phase(np.geomspace(r.uniform(3000, 8000), r.uniform(80, 400), m), m)) * 0.5
        elif kind == 'crush':
            seg = bitcrush(white(r, m) * 0.7 + np.sin(PI2 * 440 * T(m)) * 0.3, 3, 9)
        else:
            seg = np.zeros(m)
        f = min(N(0.0006), m // 4)
        if f > 1:
            seg[:f] *= np.linspace(0, 1, f)
            seg[-f:] *= np.linspace(1, 0, f)
        prev = seg
        p = float(r.uniform(-0.9, 0.9))
        place(out, seg, tcur, p=p)
        tcur += L * r.uniform(0.85, 1.15)
    # a torn-signal bed under the segments so the glitch never drops out completely
    bed = np.stack([white(r, n), white(r, n)]) * 0.08 * (0.5 + 0.5 * np.abs(smooth_noise(r, n, 25)))
    bed *= gate(n, 0.004, 0.57, 0.004, 0.02)
    out += bitcrush(bed, 4, 7)
    crushed = bitcrush(out, 6, 3)
    return 0.6 * out + 0.5 * crushed


def power_out(v, r, n):
    t = T(n)
    out = np.zeros((2, n))
    tc = 0.035
    relay = resonators(strike(n, tc, 0.0006) + strike(n, tc + 0.012, 0.001, 0.4), small_metal('bigrelay'))
    relay += 0.6 * resonators(strike(n, tc, 0.0008), slat_modes())
    thump = thud(r, n, tc, 90, 55, 0.22, 0.02, noise=0.5)
    spark = bw(white(r, n), 'hp', 2500) * ar(n, 0.0005, 0.04, tc)
    place(out, 0.7 * P(relay) + 0.8 * P(thump) + 0.3 * P(spark), 0)
    tt = np.maximum(t - tc, 0)
    sp = np.exp(-tt / 0.62)
    amp = np.where(t < tc, 1.0, sp ** 1.15) * (t < 2.45)
    amp = amp * gate(n, 0.0, 2.3, 0.004, 0.15)
    ph = phase(120 * sp, n)
    hum = sum(a * np.sin(PI2 * k * ph + k) for k, a in [(1, 1.0), (2, 0.6), (3, 0.4), (4, 0.25), (5, 0.18), (7, 0.1)])
    hum = np.tanh(2.0 * hum) * 0.6
    bpf = 55 * sp
    fan = tvbq(white(r, n), 'lp', 200 + 3500 * sp, 0.7) * (1 + 0.35 * np.sin(PI2 * phase(bpf, n)))
    rum = np.sin(PI2 * phase(31 * sp, n)) * 0.8 + bw(white(r, n), 'lp', 150) * 1.5
    place(out, (0.55 * P(hum) * amp), 0)
    place(out, (0.35 * P(fan) * amp), 0, p=-0.35)
    place(out, (0.45 * P(rum) * amp ** 0.8), 0)
    tick = hit(n, 2.47, small_metal('cool'), 0.0002)
    place(out, P(tick) * 0.05, 0, p=0.5)
    return reverb(out, ir_room_st(), wet=0.15)


# =============================================================================
# clock
# =============================================================================
def clock_chime(v, r, n):
    f = hz(midi('E5'))
    b = bell(f, n / SR, SOFT_BELL, attack=0.004, r=r)
    mallet = bw(white(r, n), 'lp', 2000) * ar(n, 0.001, 0.02) * 0.05
    s = (b + mallet) * env_pts(n, [(0, 1), (1.0, 1), (1.5, 0.3)])
    return reverb(s, ir_room_st(), wet=0.4)


def _pad_voice(r, f, n, t_on, t_off, att, rel, voices=3, detune=7.0, cutoff=2000.0, wave='saw'):
    t = T(n)
    s = np.zeros(n)
    for k in range(voices):
        c = detune * (k - (voices - 1) / 2) / max(1, (voices - 1) / 2)
        ff = f * 2 ** ((c + r.uniform(-1.5, 1.5)) / 1200)
        s += saw(ff, n, r.uniform()) if wave == 'saw' else pulse(ff, n, 0.5, r.uniform())
    s = bw(s / voices, 'lp', cutoff, 2)
    return s * gate(n, t_on, t_off, att, rel)


def clock_6am(v, r, n):
    out = np.zeros((2, n))
    notes = ['G5', 'C6', 'E6', 'G6', 'C7']
    for i, nm in enumerate(notes):
        g = glock(hz(midi(nm)), 3.0, r, bright=1.0)
        place(out, g * (0.5 + 0.08 * i), 0.02 + 0.22 * i, p=-0.6 + 0.3 * i)
    tch = 1.15
    dur = n / SR
    chord = ['C2', 'C3', 'G3', 'C4', 'E4', 'G4', 'C5']
    pad = np.zeros((2, n))
    for i, nm in enumerate(chord):
        f = hz(midi(nm))
        s = _pad_voice(r, f, n, tch, dur - 1.0, 0.45, 0.95, voices=3, detune=8, cutoff=1800 if f > 100 else 600)
        org = sum(a * np.sin(PI2 * k * f * T(n)) for k, a in [(1, 0.6), (2, 0.4), (3, 0.2), (4, 0.12)]) \
            * gate(n, tch, dur - 1.0, 0.3, 1.0)
        place(pad, s * 0.5 + org * 0.25, 0, p=-0.5 + i / len(chord))
    pad = tvbq(pad, 'lp', env_pts(n, [(0, 500), (tch, 500), (tch + 1.4, 3200), (dur, 2600)], log=True), 0.8)
    out += pad * 0.35
    for i, nm in enumerate(['C6', 'E6', 'G6', 'C5']):
        place(out, glock(hz(midi(nm)), 3.5, r, bright=0.7) * 0.22, tch + 0.01 * i, p=[-0.5, 0.5, 0.0, 0.2][i])
    for k, nm in enumerate(['G7', 'E7', 'C7', 'G6', 'E7', 'C7']):
        place(out, glock(hz(midi(nm)), 1.5, r, bright=0.5) * 0.06, tch + 0.5 + 0.38 * k, p=r.uniform(-0.8, 0.8))
    out = reverb(out, ir_big_st(), wet=0.32)
    return out * env_pts(n, [(0, 1), (dur - 0.9, 1), (dur, 0)])


# =============================================================================
# phone
# =============================================================================
def phone_ring(v, r, n):
    bursts = [(0.02, 0.82), (1.22, 2.02)]
    ratios = [1.0, 1.42, 2.25, 2.71, 3.6, 4.4]
    t60s = [1.0, 0.7, 0.5, 0.4, 0.3, 0.25]
    amps = [1.0, 0.5, 0.6, 0.35, 0.25, 0.15]
    exA, exB = np.zeros(n), np.zeros(n)
    rat = np.zeros(n)
    for b0, b1 in bursts:
        k = 0
        tt = b0
        while tt < b1:
            a = r.uniform(0.75, 1.0) * min(1.0, (tt - b0) / 0.03 + 0.4)
            (exA if k % 2 == 0 else exB)[:] += strike(n, tt, 0.0003, a)
            rat += strike(n, tt + 0.002, 0.0002, a * r.uniform(0.3, 1))
            k += 1
            tt = b0 + k / 40.0
    gA = resonators(exA, [(1220 * q * r.uniform(0.995, 1.005), d, a) for q, d, a in zip(ratios, t60s, amps)])
    gB = resonators(exB, [(1480 * q * r.uniform(0.995, 1.005), d, a) for q, d, a in zip(ratios, t60s, amps)])
    rattle = bw(rat, 'hp', 3500, 4)
    s = P(gA) + 0.9 * P(gB) + 0.15 * P(rattle)
    s = eq(s, ('peak', 900, 1.0, 3.0))
    s = bw(s, 'lp', 9000)
    return reverb(s, ir_office(), wet=0.2)


def phone_pickup(v, r, n):
    clack = resonators(strike(n, 0.006, 0.0006) + strike(n, 0.014, 0.0008, 0.5), plastic_modes('handset'))
    thock = resonators(strike(n, 0.006, 0.002), [(280, 0.04, 1.0), (610, 0.03, 0.4)])
    hook = hit(n, 0.045, small_metal('hook'), 0.0002)
    t = T(n)
    line = (bw(white(r, n), 'bp', (300, 3400)) * 0.5 + 0.2 * np.sin(PI2 * 60 * t)) * gate(n, 0.06, 0.36, 0.02, 0.03)
    pop = thud(r, n, 0.06, 140, 90, 0.03, 0.005, noise=0.1)
    return P(clack) + 0.4 * P(thock) + 0.35 * P(hook) + 0.06 * P(line) + 0.12 * P(pop)


def babble(r, dur, f0=118.0, fscale=1.0):
    """unintelligible speech-like babble: random syllables with formant
    transitions, consonant noise, and a declining/stressed pitch contour"""
    n = N(dur)
    syl = []
    t = 0.04 + r.uniform(0, 0.05)
    while t < dur - 0.2:
        d = r.uniform(0.11, 0.22)
        syl.append((t, d, str(r.choice(['a', 'e', 'i', 'o', 'u', 'uh', 'ae', 'er'])),
                    str(r.choice(['s', 'sh', 'f', 'p', 't', 'k', 'm', 'n', 'l', '-']))))
        t += d + (r.uniform(0.12, 0.22) if r.uniform() < 0.18 else r.uniform(0.0, 0.03))
    amp = np.zeros(n)
    keys = [(0.0, 'uh')]
    for i, (ts, d, vw, c) in enumerate(syl):
        amp += gate(n, ts, ts + d * 0.85, 0.022, 0.04) * r.uniform(0.6, 1.0)
        on = 'm' if c in 'mn' else ('i' if c in ('s', 't') else 'uh')
        keys.append((ts, on))
        keys.append((ts + d * 0.45, vw))
    keys.append((dur, 'uh'))
    keys.sort(key=lambda k: k[0])
    amp = np.minimum(amp, 1.0)
    f0c = f0 * env_pts(n, [(0, 1.12), (dur, 0.86)])
    tt = T(n)
    for i, (ts, d, vw, c) in enumerate(syl):
        if i % 3 == 0:
            f0c *= 1 + 0.12 * np.exp(-0.5 * ((tt - ts - d * 0.4) / (d * 0.35)) ** 2)
    f0c *= 1 + 0.03 * smooth_noise(r, n, 3)
    src = voice_src(r, f0c, n, jitter=0.01, shimmer=0.06, breath=0.08)
    F, B = vowel_track(n, keys, fscale=fscale)
    voiced = formants(src * amp, F, B, gains_db=(0, -4, -9, -15))
    cons = np.zeros(n)
    for ts, d, vw, c in syl:
        if c == 's':
            cons += bw(white(r, n), 'hp', 4500) * gate(n, ts - 0.07, ts, 0.01, 0.01) * 0.25
        elif c == 'sh':
            cons += bw(white(r, n), 'bp', (1800, 4500)) * gate(n, ts - 0.08, ts, 0.012, 0.01) * 0.3
        elif c == 'f':
            cons += bw(white(r, n), 'bp', (1200, 8000)) * gate(n, ts - 0.06, ts, 0.01, 0.01) * 0.1
        elif c in 'ptk':
            band = {'p': (500, 2000), 't': (2500, 6000), 'k': (1400, 3200)}[c]
            cons += bw(white(r, n), 'bp', band) * ar(n, 0.001, 0.03, ts - 0.004) * 0.4
    return voiced + cons * float(np.max(np.abs(voiced)))


def phone_voice(v, r, n):
    s = babble(r, n / SR, f0=[116.0, 121.0, 112.0, 124.0][v])
    s = phone_line(s, r, hiss=0.015, drive=2.2)
    s += 0.05 * _crackle(r, n, 6)
    return s * (1 + 0.06 * smooth_noise(r, n, 2))


def phone_hangup(v, r, n):
    t = T(n)
    clack = resonators(strike(n, 0.006, 0.0008, 1.0) + strike(n, 0.028, 0.0009, 0.45), plastic_modes('handset'))
    thock = resonators(strike(n, 0.006, 0.0025), [(220, 0.05, 1.0), (470, 0.03, 0.5)])
    hook = hit(n, 0.012, small_metal('hook'), 0.0002)
    tone = (np.sin(PI2 * 350 * t) + np.sin(PI2 * 440 * t)) * env_pts(n, [(0.07, 0), (0.1, 1.0), (0.5, 0)])
    tone = phone_line(tone, r, hiss=0.01, drive=1.2)
    return P(clack) + 0.45 * P(thock) + 0.3 * P(hook) + 0.08 * P(tone)


# =============================================================================
# hallucinations / UI
# =============================================================================
def hall_whisper(v, r, n):
    dur = n / SR
    m = N(dur + 0.4)
    syl_t = 0.15
    amp = np.zeros(m)
    keys = [(0.0, 'uh')]
    while syl_t < dur - 0.1:
        d = r.uniform(0.12, 0.25)
        amp += gate(m, syl_t, syl_t + d, 0.03, 0.08) * r.uniform(0.5, 1.0)
        keys.append((syl_t + d * 0.5, str(r.choice(['a', 'e', 'i', 'o', 'u', 'ae']))))
        syl_t += d + r.uniform(0.02, 0.1)
    keys.append((dur + 0.4, 'uh'))
    src = white(r, m) * 0.7 + bw(white(r, m), 'hp', 2500) * 0.3
    F, B = vowel_track(m, keys, fscale=1.12, jitter=0.03, r=r)
    w = formants(src * amp, F, B, gains_db=(0, -1, -4, -7))
    sib = np.zeros(m)
    for k in range(4):
        ts = r.uniform(0.1, dur - 0.1)
        sib += bw(white(r, m), 'hp', 4200) * gate(m, ts, ts + r.uniform(0.06, 0.14), 0.02, 0.04)
    w = P(w) + 0.35 * P(sib)
    wet = reverb(w, ir_dining_st(), wet=1.0, dry=0.0)
    s = np.stack([w, w]) * 0.6 + wet * 0.9
    s = s[:, ::-1][:, :n]                 # reversed: decays become swells
    s = s * env_pts(n, [(0, 0), (0.3, 0.4), (dur - 0.35, 1.0), (dur, 0)])
    pp = env_pts(n, [(0, 0.8), (dur, -0.7)])
    th = (pp + 1) * np.pi / 4
    return np.stack([s[0] * np.cos(th), s[1] * np.sin(th)]) * np.sqrt(2)


def hall_sting(v, r, n):
    t = T(n)
    th = 0.95
    cluster = ['A2', 'E3', 'F3', 'Bb3', 'B3', 'Eb4', 'E4', 'F5']
    sw = np.zeros((2, n))
    rise = 1 + 0.025 * np.clip(t / th, 0, 1) ** 2
    for i, nm in enumerate(cluster):
        f = hz(midi(nm))
        s = sum(saw(f * rise * 2 ** (c / 1200), n, r.uniform()) for c in (-9, 0, 8)) / 3
        trem = 1 + 0.3 * np.sin(PI2 * phase(6 + 12 * np.clip(t / th, 0, 1), n) + r.uniform(0, PI2))
        place(sw, s * trem, 0, p=-0.8 + 1.6 * i / (len(cluster) - 1))
    sw = tvbq(sw, 'lp', env_pts(n, [(0, 250), (th, 6000)], log=True), 0.9)
    swell = env_pts(n, [(0, 0.001), (th * 0.5, 0.06), (th - 0.01, 1.0), (th + 0.03, 0.0)], log=True) * (t < th + 0.03)
    sw = sw * swell
    air = bw(white(r, n), 'hp', 3000) * swell * 0.4
    sw += np.stack([air, bw(white(r, n), 'hp', 3000) * swell * 0.4])
    hitm = np.zeros((2, n))
    boom = thud(r, n, th, 70, 32, 0.9, 0.06, noise=0.8)
    clang = hit(n, th, door_modes(), 0.0007)
    crash = bw(white(r, n), 'bp', (700, 9000)) * ar(n, 0.001, 0.4, th)
    place(hitm, P(boom) * 1.0 + P(clang) * 0.6 + P(crash) * 0.35, 0)
    hitm = reverb(hitm, ir_dining_st(), wet=0.45)
    out = P(sw) * 0.75 + P(hitm) * 1.0
    return sat(out, 1.4)


def ui_click(v, r, n):
    tick = resonators(strike(n, 0.003, 0.00015), [(2600, 0.02, 1.0), (4100, 0.012, 0.6), (6800, 0.008, 0.4),
                                                  (1300, 0.02, 0.4)])
    body = np.sin(PI2 * 1800 * T(n)) * ar(n, 0.0005, 0.025, 0.003)
    s = P(tick) + 0.3 * P(body)
    return reverb(s, ir_room_st(), wet=0.08)


def ui_star(v, r, n):
    out = np.zeros((2, n))
    notes = ['E6', 'G#6', 'B6', 'E7']
    for i, nm in enumerate(notes):
        place(out, glock(hz(midi(nm)), 1.8, r, bright=1.0) * (0.55 + 0.1 * i), 0.004 + 0.075 * i, p=-0.6 + 0.4 * i)
    place(out, glock(hz(midi('B7')), 1.2, r, bright=0.6) * 0.25, 0.35, p=0.3)
    sp = np.zeros((2, n))
    for k in range(28):
        tt = r.uniform(0.15, 1.3)
        m = N(0.08)
        ping = np.sin(PI2 * r.uniform(6000, 11000) * T(m)) * ar(m, 0.0005, 0.05)
        place(sp, ping * r.uniform(0.2, 1.0) * np.exp(-tt / 0.6), tt, p=r.uniform(-1, 1))
    out += 0.12 * sp
    out = reverb(out, ir_room_st(), wet=0.35)
    return out * env_pts(n, [(0, 1), (1.4, 1), (2.0, 0)])
