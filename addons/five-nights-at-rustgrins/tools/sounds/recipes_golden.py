"""Recipes: the Golden Dog and the cellar (fnar.golden.*, fnar.js.golden_dog).

Same conventions as the other recipe modules: fn(v, r, n) -> mono (n,) or
stereo (2, n) float array. Everything is synthesised.

  golden.watch    his tell: a pocket watch, the tick speeding up over 2.5 s (the length of
                  the tell in core/config.js: golden.tell = 50 ticks). Nothing else in the
                  building ticks.
  golden.tear     a shift starts or ends: the place rips like cloth
  golden.breath   a visit: slow, huge breathing behind the seat (a silent-ended 4 s loop)
  golden.chime    the false dawn: the 6 AM chime, off-key from its first note and sagging
  golden.step     the Other Office: his weight on the cellar's boards, far down the hall
  golden.phone    the Other Office: an old two-gong bell telephone (one ring; the script repeats it)
  golden.cellar   the cellar's own air: a boiler, pipes, water, wood (a stereo loop)
  js.golden_dog   his scream: the watch races and breaks, then a howl through a blown speaker
"""
from __future__ import annotations

import numpy as np

from fnar_dsp import (N, PI2, SR, T, ar, band_noise, bitcrush, bq, bw, circ, click_train, decay, env_pts, eq,
                      fit, formants, gate, loop_hz, periodic_lfo, phase, place, resonators, reverb, room_ir, sat,
                      saw, servo, smooth_noise, strike, tvbq, varispeed, voice_src, vowel_track, white)
from recipes_common import (P, creak, drip, duct_modes, frame_modes, hit, ir_big_st, ir_office, small_metal, thud,
                            wood_modes)
from recipes_office import clock_6am


# =============================================================================
# rooms
# =============================================================================
def ir_gold_room():
    """the old supper theatre under the dining hall: low ceiling, plaster and rotten plush"""
    return room_ir('gold_room', 1.9, length=2.4, predelay=0.012, n_early=16, early_span=0.06, lf=1.4, hf=0.3)


def ir_gold_room_st():
    return room_ir('gold_room_st', 1.9, length=2.4, stereo=True, predelay=0.012, n_early=16, early_span=0.06,
                   lf=1.4, hf=0.3)


def ir_long_hall():
    """three blocks wide and twenty long: a slap that comes back"""
    return room_ir('gold_hall', 2.6, length=3.0, predelay=0.03, n_early=22, early_span=0.16, lf=1.2, hf=0.35)


# =============================================================================
# the pocket watch
# =============================================================================
def _tick(r, k, bright=1.0):
    """one beat of a lever escapement: the pallet drops (tick), the wheel locks (a softer,
    lower tock a few milliseconds later), ringing in a small gold case"""
    m = N(0.09)
    tock = k % 2
    a = strike(m, 0.0006, 0.00012, 1.0)
    b = strike(m, 0.0006 + (0.0042 if tock else 0.0031), 0.00016, 0.55)
    case = resonators(a + b, small_metal('watch_case%d' % tock))
    wheel = resonators(a, [(f * (0.94 if tock else 1.0), d, g) for f, d, g in
                           ((4310.0, 0.035, 1.0), (6120.0, 0.022, 0.7), (8900.0, 0.014, 0.5), (2630.0, 0.05, 0.35))])
    click = bw(a + 0.5 * b, 'hp', 2500, 2)
    return (0.6 * P(case) + 0.9 * bright * P(wheel) + 0.5 * P(click)) * decay(m, 0.06)


def golden_watch(v, r, n):
    """a pocket watch held to the ear: five beats a second at first, three times that
    at the end, each tick a little louder and nearer; then the lid snaps"""
    dur = n / SR
    out = np.zeros((2, n))
    # beat times: integrate a rate that climbs from 5 Hz to 16 Hz
    times = []
    tt, k = 0.04, 0
    while tt < dur - 0.22:
        times.append(tt)
        x = tt / (dur - 0.22)
        tt += 1.0 / (5.0 + 11.0 * x ** 1.7)
    for k, tk in enumerate(times):
        x = tk / dur
        tick = _tick(r, k, bright=0.8 + 0.5 * x)
        # it swings from ear to ear, closer every beat
        place(out, tick * (0.35 + 0.65 * x ** 1.3), tk, p=0.75 * np.sin(PI2 * (0.7 * x + 0.35 * x * x) + 0.6))
    # the mainspring: a thin whir that winds up under the ticking
    t = T(n)
    whir = servo(r, n, env_pts(n, [(0, 0.0), (dur - 0.25, 0.9), (dur - 0.2, 0.0), (dur, 0.0)]), base=900, span=1900,
                 ratio=0.5, index=0.8, gear=0.5, grit=0.1)
    whir = bw(whir, 'hp', 1500) * env_pts(n, [(0, 0), (0.4, 0.2), (dur - 0.25, 1.0), (dur - 0.2, 0), (dur, 0)])
    out += 0.07 * np.stack([whir, whir])
    # the lid
    lid = hit(n, dur - 0.2, small_metal('watch_lid'), 0.0004) + 0.6 * hit(n, dur - 0.2, frame_modes('watch'), 0.0007)
    place(out, P(lid) * 0.7, 0)
    out = reverb(out, ir_office(), wet=0.1)
    hush = 0.02 * bw(white(r, n), 'bp', (300, 2400)) * env_pts(n, [(0, 0), (0.3, 1), (dur - 0.2, 1), (dur - 0.15, 0), (dur, 0)])
    return out + np.stack([hush, hush]) * np.max(np.abs(out))


# =============================================================================
# the tear
# =============================================================================
def golden_tear(v, r, n):
    """the place rips: a held breath of air sucked backwards, then cloth torn in one
    pull (band noise chopped by a fast, irregular train of threads giving way), a low
    thump as it closes"""
    dur = n / SR
    t = T(n)
    t0 = (0.2, 0.26)[v]
    rip_len = (0.36, 0.3)[v]
    # the suck: reversed, reverberated noise swelling into the rip
    k = N(t0)
    src = bw(white(r, k + N(0.6)), 'bp', (500, 6000)) * ar(k + N(0.6), 0.001, 0.25)
    suck = reverb(src, ir_office(), wet=1.0, dry=0.3)[:k][::-1]
    pre = np.zeros(n)
    place(pre, P(suck) * (np.linspace(0, 1, k) ** 2), 0)
    # the rip: threads snapping faster and faster, the band sliding down as the tear opens
    g = gate(n, t0, t0 + rip_len, 0.004, 0.05)
    rate = 55 + 260 * np.clip((t - t0) / rip_len, 0, 1) ** 0.7
    threads = click_train(r, n, rate, jitter=0.55, amp_jitter=0.8, t0=t0, t1=t0 + rip_len)
    chop = np.clip(bw(np.abs(threads), 'lp', 400, 1) * 14, 0.15, 1.0)
    fc = env_pts(n, [(0, 5200), (t0, 5200), (t0 + rip_len, 700 if v == 0 else 1100), (dur, 500)], log=True)
    cloth = tvbq(white(r, n), 'bp', fc, 1.4) * g * chop
    snap = bw(threads, 'bp', (1800, 9000)) * g
    # it closes
    shut = thud(r, n, t0 + rip_len, 80, 30, 0.35, 0.05, noise=0.7, noise_lp=160)
    air = bw(white(r, n), 'hp', 3000) * ar(n, 0.002, 0.3, t0 + rip_len) * 0.25
    mono = 0.5 * pre + 1.0 * P(cloth) + 0.55 * P(snap) + 0.8 * P(shut) + P(air) * 0.3
    mono = sat(mono, 1.4)
    out = np.zeros((2, n))
    # it runs across the head as it tears
    sweep = np.clip((t - t0) / max(rip_len, 1e-3), 0, 1) * (1 if v == 0 else -1)
    out[0] = mono * (0.75 - 0.35 * sweep)
    out[1] = mono * (0.75 + 0.35 * sweep)
    out = reverb(out, ir_big_st(), wet=0.22)
    return out * env_pts(n, [(0, 1), (dur - 0.12, 1), (dur, 0)])


# =============================================================================
# the visit: breathing behind the seat
# =============================================================================
def golden_breath(v, r, n):
    """one slow breath of something very big standing right behind you: a long, wet
    inhale through a muzzle, a pause, an exhale with a low growl riding under it. It
    starts and ends in silence, so the script can loop it."""
    dur = n / SR
    t = T(n)
    i0, i1, e0, e1 = 0.10, 1.45, 1.85, 3.72
    inh = gate(n, i0, i1, 0.75, 0.12) * np.clip(1 + 0.35 * smooth_noise(r, n, 11), 0.2, 2.0)
    exh = env_pts(n, [(0, 0), (e0, 0), (e0 + 0.14, 1.0), (e0 + 0.7, 0.75), (e1 - 0.4, 0.3), (e1, 0), (dur, 0)])
    exh *= np.clip(1 + 0.22 * smooth_noise(r, n, 7), 0.3, 2.0)
    keys = [(0.0, 'u'), (i0 + 0.3, 'o'), (i1, 'uh'), (e0, 'o'), (e0 + 0.8, 'u'), (dur, 'u')]
    F, B = vowel_track(n, keys, fscale=0.66, jitter=0.03, r=r)          # a long muzzle: everything low
    air_in = formants(white(r, n) * inh, F, B, (0, -3, -8, -13)) + 0.25 * bw(white(r, n), 'bp', (1800, 5200)) * inh
    air_out = formants(white(r, n) * exh, F, B, (0, -4, -10, -16))
    # the growl under the exhale: a slack, slow voice an octave under a man's, half fry
    f0 = env_pts(n, [(0, 46), (e0, 46), (e0 + 0.5, 41), (e1, 33), (dur, 33)])
    voiced = voice_src(r, f0, n, jitter=0.035, shimmer=0.25, breath=0.2, sub=0.5) * exh ** 1.4
    growl = formants(voiced, F, B, (0, -5, -12, -18))
    fry = click_train(r, n, 23 * (1 - 0.35 * np.clip((t - e0) / (e1 - e0), 0, 1)), jitter=0.4, amp_jitter=0.7,
                      t0=e0 + 0.1, t1=e1 - 0.1) * exh
    rattle = formants(bw(fry, 'lp', 2200, 1), F, B, (0, -4, -10, -15))
    chest = bw(white(r, n), 'lp', 110, 2) * (0.5 * inh + exh) * 2.5          # the weight of the lungs
    s = P(air_in) * 0.9 + P(air_out) * 1.0 + 0.6 * P(growl) + 0.35 * P(rattle) + 0.5 * P(chest)
    # a wet click of the jaw as the breath turns
    s += 0.1 * P(hit(n, i1 + 0.12, frame_modes('jaw'), 0.0009))
    s = bw(s, 'bp', (45, 5200), 2)
    s = eq(s, ('peak', 240, 1.2, 4.0), ('peak', 900, 2.0, 2.5))
    s = sat(P(s) * 1.1, 1.5)
    s = reverb(s, ir_office(), wet=0.14)
    return s * env_pts(n, [(0, 0), (0.05, 1), (dur - 0.2, 1), (dur - 0.02, 0), (dur, 0)])


# =============================================================================
# the false dawn
# =============================================================================
def golden_chime(v, r, n):
    """the 6 AM chime, wrong: a semitone flat from its first bell and wavering, the warm
    chord sagging like a tape with a thumb on the reel, and cut dead before it resolves"""
    dur = n / SR
    src = clock_6am(0, r, N(6.0))
    t = T(n)
    cut = dur - 0.5
    speed = env_pts(n, [(0, 0.945), (1.1, 0.93), (2.2, 0.9), (cut - 0.5, 0.74), (cut, 0.55), (dur, 0.5)])
    speed = speed * (1 + 0.018 * np.sin(PI2 * 5.3 * t) + 0.03 * smooth_noise(r, n, 2.2))
    out = np.stack([varispeed(src[ch], speed) for ch in range(2)])
    # the second voice: the same bells a quarter-tone under themselves
    ghost = np.stack([varispeed(src[1 - ch], speed * 0.972) for ch in range(2)])
    out = out + 0.4 * ghost
    out = eq(out, ('peak', 700, 1.2, 3.0))
    out = 0.85 * out + 0.15 * bitcrush(out, 8, 2)
    # under it, faintly: the watch never stopped
    for k in range(int(cut * 4)):
        place(out, _tick(r, k) * 0.05, 0.1 + k / 4.0, p=0.3 if k % 2 else -0.3)
    gone = env_pts(n, [(0, 1), (cut, 1), (cut + 0.03, 0), (dur, 0)])
    out = out * gone
    # the cut itself: the first thread of the tear
    rip = bw(white(r, n), 'bp', (900, 6000)) * ar(n, 0.001, 0.12, cut) + thud(r, n, cut + 0.02, 70, 32, 0.3, 0.04)
    return P(out) + 0.35 * np.stack([P(rip), P(rip)])


# =============================================================================
# the Other Office
# =============================================================================
def golden_step(v, r, n):
    """one step of the biggest thing in the building on old floorboards, heard down a
    long hall: a slow heel, the board taking the weight, a groan from the frame"""
    t0 = 0.03
    heel = thud(r, n, t0, 74 * r.uniform(0.92, 1.08), 31, 0.34, 0.045, noise=0.9, noise_lp=170)
    board = hit(n, t0 + 0.004, wood_modes('cellar_floor%d' % (v % 2)), 0.0016)
    toe = thud(r, n, t0 + r.uniform(0.09, 0.13), 60, 34, 0.18, 0.03, noise=0.6, noise_lp=200) * 0.5
    c = creak(r, 0.42, 24, 58, wood_modes('cellar_joist'))
    groan = np.zeros(n)
    place(groan, P(c), t0 + 0.05)
    joint = servo(r, n, gate(n, t0 + 0.02, t0 + 0.3, 0.05, 0.12) * 0.5, base=150, span=120, gear=0.5, grit=0.35)
    chain = hit(n, t0 + r.uniform(0.14, 0.2), small_metal('watch_chain%d' % v), 0.0003)    # the chain at his pocket
    mix = 1.0 * P(heel) + 0.55 * P(board) + P(toe) * 0.5 + 0.3 * groan + 0.12 * P(joint) + 0.07 * P(chain)
    mix = bw(mix, 'lp', 4200)
    return reverb(mix, ir_long_hall(), wet=0.38)


def golden_phone(v, r, n):
    """a 1950s desk telephone with two brass gongs, one of them cracked: a single long
    ring, the clapper slowing as the generator sags, in a damp little room"""
    dur = n / SR
    b0, b1 = 0.03, 1.45
    exA, exB, rat = np.zeros(n), np.zeros(n), np.zeros(n)
    k, tt = 0, b0
    while tt < b1:
        x = (tt - b0) / (b1 - b0)
        a = r.uniform(0.7, 1.0) * min(1.0, (tt - b0) / 0.04 + 0.35) * (1 - 0.3 * x)
        (exA if k % 2 == 0 else exB)[:] += strike(n, tt, 0.00035, a)
        rat += strike(n, tt + 0.002, 0.00025, a * r.uniform(0.3, 1))
        k += 1
        tt += 1.0 / (27.0 - 6.0 * x)                 # 27 strikes a second, dragging to 21
    ratios = [1.0, 1.43, 2.27, 2.74, 3.63, 4.45]
    t60 = [1.5, 1.0, 0.7, 0.5, 0.35, 0.25]
    amps = [1.0, 0.55, 0.6, 0.35, 0.25, 0.15]
    gA = resonators(exA, [(905 * q * r.uniform(0.996, 1.004), d, a) for q, d, a in zip(ratios, t60, amps)])
    # the cracked gong: its partials are split and die sooner
    gB = resonators(exB, [(1076 * q * s, d * 0.55, a * 0.6) for q, d, a in zip(ratios, t60, amps) for s in (0.985, 1.021)])
    body = resonators(rat, wood_modes('phone_base')) * 0.5
    s = P(gA) + 0.8 * P(gB) + 0.14 * P(bw(rat, 'hp', 3200, 3)) + 0.2 * P(body)
    s = eq(s, ('peak', 780, 1.0, 3.5))
    s = bw(s, 'lp', 7000)
    s = s * (1 + 0.05 * np.sin(PI2 * 3.1 * T(n)))
    wet = reverb(s, room_ir('other_office', 0.9, n_early=12, early_span=0.03, lf=1.1, hf=0.5), wet=0.3)
    return wet * env_pts(n, [(0, 1), (dur - 0.25, 1), (dur, 0)])


# =============================================================================
# the cellar
# =============================================================================
def golden_cellar(v, r, n):
    """the air of the cellar (a loop): a boiler somewhere behind a wall, water in old
    pipes, a slow drip, wood under a building's weight. Nothing ticks down here."""
    t = T(n)
    dur = n / SR
    bed = np.zeros((2, n))
    for ch in range(2):
        d = np.zeros(n)
        # the boiler: a low burner note and its beat, breathing slowly
        for f, a in [(33.0, 0.55), (49.4, 0.4), (66.1, 0.22), (98.7, 0.1)]:
            fl = loop_hz(f * (1 + 0.004 * (ch - 0.5)), n)
            d += a * np.sin(PI2 * fl * t + r.uniform(0, PI2)) * (1 + 0.4 * periodic_lfo(n, int(r.integers(1, 3)), r))
        rum = band_noise(r, n, 18, 120, slope=-2) * 0.5 * (1 + 0.35 * periodic_lfo(n, 1, r))
        # water moving in a pipe: a narrow, wandering hiss
        hiss = band_noise(r, n, 600, 3800, slope=-5) * 0.05 * (1 + 0.6 * periodic_lfo(n, 2, r, harmonics=2))
        damp = band_noise(r, n, 90, 700, slope=-7) * 0.12
        bed[ch] = 0.75 * d + rum + hiss + damp
    ev = np.zeros((2, n))
    # the drip: nearly regular, never quite
    k, td = 0, 1.1
    while td < dur:
        place(ev, P(drip(r)) * r.uniform(0.22, 0.34), td, wrap=True, p=0.45)
        td += 2.9 + 0.35 * r.standard_normal()
        k += 1
    # the building settles on its old joists; a pipe knocks as it cools
    for i, tc in enumerate([3.7, 9.4, 13.2]):
        c = creak(r, r.uniform(0.7, 1.6), r.uniform(22, 40), r.uniform(55, 100), wood_modes('cellar%d' % i))
        place(ev, P(c) * r.uniform(0.3, 0.5), tc, wrap=True, p=r.uniform(-0.9, 0.9))
    for i, tk in enumerate([6.2, 6.55, 14.8]):
        m = N(0.8)
        pk = resonators(strike(m, 0.001, 0.0006), duct_modes())
        place(ev, P(pk) * (0.16, 0.1, 0.13)[i], tk, wrap=True, p=-0.7)
    ev = circ(bw, ev, 'lp', 4800)
    wet = reverb(ev, ir_gold_room_st(), wet=1.0, dry=0.3, circular=True)
    return bed * 0.5 + wet * 0.85


# =============================================================================
# his scream
# =============================================================================
def js_golden_dog(v, r, n):
    """the jumpscare: the watch races and its spring lets go, and the howl of a very
    large dog comes through a speaker that was never meant to carry it; a bell of the
    wrong 6 AM tolls once under the tail"""
    dur = n / SR
    t = T(n)
    out = np.zeros((2, n))
    # 0.00 - 0.16: the watch, far too fast, then the spring
    k, tt = 0, 0.0
    while tt < 0.15:
        place(out, _tick(r, k, 1.3) * (0.5 + 3 * tt), tt, p=0.6 if k % 2 else -0.6)
        tt += 1.0 / (22.0 + 260.0 * tt)
        k += 1
    th = 0.16
    spring = resonators(strike(n, th, 0.0005, 1.0), [(f, d, a) for f, d, a in
                                                      ((312.0, 0.9, 1.0), (847.0, 0.6, 0.8), (1663.0, 0.4, 0.6),
                                                       (2741.0, 0.3, 0.5), (4093.0, 0.2, 0.4), (5711.0, 0.14, 0.3))])
    spring = spring * (1 + 0.5 * np.sin(PI2 * 31 * t))                                # the coil shaking loose
    # the howl: two voices a rough fifth apart, falling, with a snarl opening into it
    m = n
    f_hi = env_pts(m, [(0, 150), (th, 150), (th + 0.07, 285), (th + 0.5, 262), (th + 1.3, 196), (dur, 120)])
    f_lo = f_hi * 0.5 * (1 + 0.015 * np.sin(PI2 * 6.2 * t))
    keys = [(0.0, 'uh'), (th, 'ae'), (th + 0.12, 'a'), (th + 0.9, 'o'), (th + 1.6, 'u'), (dur, 'u')]
    F, B = vowel_track(m, keys, fscale=0.78, jitter=0.05, r=r)
    env = env_pts(m, [(0, 0), (th, 0), (th + 0.03, 1.0), (th + 0.9, 0.9), (th + 1.7, 0.4), (dur - 0.15, 0.08), (dur, 0)])
    v1 = voice_src(r, f_hi, m, jitter=0.03, shimmer=0.3, breath=0.25) * env
    v2 = voice_src(r, f_lo, m, jitter=0.05, shimmer=0.4, breath=0.2, sub=0.6) * env
    howl = formants(v1, F, B, (0, -3, -7, -11)) + 0.9 * formants(v2, F, B, (0, -4, -9, -14))
    snarl = formants(click_train(r, m, 58, jitter=0.5, amp_jitter=0.8, t0=th, t1=th + 1.5) * env, F, B, (0, -3, -8, -12))
    blast = bw(white(r, m), 'bp', (500, 7500)) * ar(m, 0.002, 0.55, th)
    shriek = servo(r, m, env * 1.0, base=1250, span=1500, ratio=0.71, index=3.2, gear=0.6, grit=0.5) * env
    voice = P(howl) * 1.0 + 0.5 * P(snarl) + 0.4 * P(blast) + 0.22 * P(shriek)
    # the blown speaker
    voice = sat(voice * 3.2, 2.6)
    voice = 0.8 * voice + 0.2 * bitcrush(voice, 6, 3)
    voice = eq(voice, ('peak', 1300, 1.4, 5.0), ('peak', 3100, 2.0, 4.0))
    voice = bw(voice, 'bp', (70, 8200), 2)
    boom = thud(r, m, th, 96, 26, 1.5, 0.08, noise=0.9, noise_lp=130)
    place(out, P(voice) * 1.0, 0, p=0.0)
    place(out, P(boom) * 0.8 + P(spring) * 0.4, 0)
    # the wrong bell, once, a tritone under the scream
    toll = np.zeros((2, n))
    for i, f in enumerate((185.0, 261.6 * 0.972)):
        b = sum(a * np.sin(PI2 * f * q * T(N(1.8)) + r.uniform(0, PI2)) * 10 ** (-3 * T(N(1.8)) / d)
                for q, a, d in ((1.0, 1.0, 1.7), (2.0, 0.5, 1.2), (2.76, 0.45, 0.8), (5.4, 0.2, 0.3)))
        place(toll, b, th + 0.02, p=(-0.5, 0.5)[i])
    out += 0.16 * P(toll)
    out[0] *= 1 + 0.12 * np.sin(PI2 * 9.0 * t)
    out[1] *= 1 - 0.12 * np.sin(PI2 * 9.0 * t)
    out = reverb(out, ir_big_st(), wet=0.2)
    out = sat(out, 1.3)
    return out * env_pts(n, [(0, 1), (dur - 0.3, 1), (dur, 0)])
