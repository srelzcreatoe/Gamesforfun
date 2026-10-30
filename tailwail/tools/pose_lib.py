#!/usr/bin/env python3
"""Pose algebra shared by the animation tools (tools/anim_v3.py).

A pose is {bone: {"rotation"|"position"|"scale": np.array(3)}}; rotations are Bedrock
degrees added on top of the bind pose.  merge() adds poses, scale() weights them, lerp()
blends two; fingers() / mirror_arm() are rig conventions of the supplied model.
"""
import math

import numpy as np

FINGERS_R = ["finger_r%d" % i for i in range(4)]
FINGERS_L = ["finger_l%d" % i for i in range(4)]
TIPS_R = [f + "_tip" for f in FINGERS_R]
TIPS_L = [f + "_tip" for f in FINGERS_L]
FEET = ["foot_r", "foot_l"] + ["toe_%s%d" % (s, i) for s in "rl" for i in range(4)]
HANDS = ["hand_r", "hand_l"] + FINGERS_R + FINGERS_L + TIPS_R + TIPS_L + ["thumb_r", "thumb_l", "thumb_r_tip", "thumb_l_tip"]
TAIL = ["tail0", "tail1", "tail2", "tail3", "tail4"]


# ------------------------------------------------------------------ pose algebra
def R(**bones):
    """R(chest=(x,y,z), ...) -> pose dict of rotations."""
    return {b: {"rotation": np.array(v, dtype=float)} for b, v in bones.items()}


def POS(**bones):
    return {b: {"position": np.array(v, dtype=float)} for b, v in bones.items()}


def merge(*poses):
    out = {}
    for p in poses:
        for b, chans in p.items():
            d = out.setdefault(b, {})
            for ch, v in chans.items():
                d[ch] = d.get(ch, np.zeros(3) if ch != "scale" else np.ones(3)) + (np.array(v) if ch != "scale" else np.array(v) - 1)
    return out


def scale(pose, s):
    out = {}
    for b, chans in pose.items():
        out[b] = {ch: (np.array(v) * s if ch != "scale" else 1 + (np.array(v) - 1) * s) for ch, v in chans.items()}
    return out


def lerp(a, b, t):
    return merge(scale(a, 1 - t), scale(b, t))


def mirror_arm(**right):
    """Right-side rotations mirrored onto the left: (x, y, z) -> (x, -y, -z)."""
    out = {}
    for name, v in right.items():
        out[name] = v
        left = name.replace("_r", "_l")
        out[left] = (v[0], -v[1], -v[2])
    return R(**out)


def fingers(curl_r, curl_l=None, spread=0.0, tips=1.3):
    """Finger curl in degrees (+ = curl).  Right fingers bend about -z, left about +z."""
    curl_l = curl_r if curl_l is None else curl_l
    d = {}
    for i, f in enumerate(FINGERS_R):
        d[f] = (0, spread * (i - 1.5), -curl_r)
        d[f + "_tip"] = (0, 0, -curl_r * tips)
    for i, f in enumerate(FINGERS_L):
        d[f] = (0, -spread * (i - 1.5), curl_l)
        d[f + "_tip"] = (0, 0, curl_l * tips)
    d["thumb_r"] = (-curl_r * 0.4, 0, -curl_r * 0.3)
    d["thumb_l"] = (-curl_l * 0.4, 0, curl_l * 0.3)
    return R(**d)


# ------------------------------------------------------------------ easing / noise
def ease_io(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def ease_in(x):
    x = min(1.0, max(0.0, x))
    return x ** 3


def seg(t, t0, t1):
    """0..1 progress of t through [t0, t1]."""
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return min(1.0, max(0.0, (t - t0) / (t1 - t0)))


def bump(t, t0, t1, t2, t3):
    """0 -> 1 between t0..t1, hold 1 until t2, back to 0 by t3 (smooth)."""
    return ease_io(seg(t, t0, t1)) * (1 - ease_io(seg(t, t2, t3)))


def noise(t, seed, freq):
    """Smooth deterministic noise in [-1, 1] (sum of incommensurate sines)."""
    return (math.sin(t * freq * 6.283 + seed * 1.7) * 0.5 + math.sin(t * freq * 2.71 * 6.283 + seed * 3.1) * 0.3
            + math.sin(t * freq * 5.13 * 6.283 + seed * 5.3) * 0.2)


def jerk(t, period, seed, hold=0.18):
    """Uncanny twitch: snaps to a random offset at irregular moments, holds, eases back."""
    k = math.floor(t / period)
    local = t - k * period
    rnd = math.sin((k + 1) * 12.9898 + seed * 78.233) * 43758.5453
    rnd = rnd - math.floor(rnd)
    when = 0.15 + rnd * 0.55 * period
    if local < when:
        return 0.0
    if local < when + 0.06:
        return (local - when) / 0.06 * (rnd * 2 - 1)
    if local < when + 0.06 + hold:
        return rnd * 2 - 1
    return (rnd * 2 - 1) * (1 - ease_io(seg(local, when + 0.06 + hold, when + 0.06 + hold + 0.35)))


def to_np(pose):
    return {b: {ch: np.array(v, dtype=float) for ch, v in c.items()} for b, c in pose.items()}


def solve_tail(rig, body, sway, floor_px=0.6):
    """Rotates tail0..tail4 in turn (about x) so each segment rests on the floor, then adds sway."""
    tail = {}
    for i, b in enumerate(TAIL):
        best = None
        for d in np.arange(-90.0, 90.1, 3.0):
            trial = merge(body, R(**tail), R(**{b: (d, 0, 0)}))
            low = rig.min_y(trial, [b])
            score = abs(low - floor_px) + 0.002 * abs(d)
            if best is None or score < best[0]:
                best = (score, d)
        d0 = best[1]
        for d in np.arange(d0 - 3, d0 + 3.01, 0.25):
            trial = merge(body, R(**tail), R(**{b: (d, 0, 0)}))
            low = rig.min_y(trial, [b])
            score = abs(low - floor_px) + 0.002 * abs(d)
            if score < best[0]:
                best = (score, d)
        tail[b] = (best[1], sway * (0.4 + 0.3 * i), 0)
    return R(**tail)
