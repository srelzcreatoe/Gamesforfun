#!/usr/bin/env python3
"""Tailwail v2 animation studio.

Every gameplay clip is authored here as a function of time, sampled ("baked") into
linear keyframes, grounded against the real rig (feet / hands solved onto y = 0), and
written to packs/TailwailRP/animations/tall_wail.v2.animation.json.

Clips are SELF-CONTAINED: a body clip carries its whole pose (including any supplied
base pose it builds on), so one controller state plays exactly one body clip plus the
always-on overlays (breathing, tremor, look, jaw, tail, mimic).  Nothing waits for
"animation finished", so no state can strand the creature.

  python3 -I tools/anim_studio.py            # write clips + docs/generated/anim_v2_report.md
  python3 -I tools/anim_studio.py --sheet    # also render review sheets to build/anim_review/
"""
import argparse
import copy
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("TAILWAIL_ROOT") or os.path.dirname(HERE)
sys.path.insert(0, HERE)
import bedrock_model as bm  # noqa: E402

RP = os.path.join(ROOT, "packs", "TailwailRP")
OUT = os.path.join(RP, "animations", "tall_wail.v2.animation.json")
REPORT = os.path.join(ROOT, "docs", "generated", "anim_v2_report.md")
SRC_ANIM = os.path.join(RP, "animations", "tall_wail.animation.json")
REHEARSAL = os.path.join(RP, "animations", "tall_wail.rehearsal.animation.json")
GEO = os.path.join(RP, "models", "entity", "tall_wail.geo.json")
P = "animation.tall_wail."
SCALE = 1.5

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


# ------------------------------------------------------------------ rig access
class Rig:
    def __init__(self):
        self.geo = bm.Geometry(GEO)
        self.anims = bm.load_animations(SRC_ANIM)
        self.rehearsal = bm.load_animations(REHEARSAL)

    def supplied(self, name, t=0.0, env=None):
        a = self.anims[P + name]
        e = {"q.life_time": t}
        e.update(env or {})
        return bm.pose_from(self.anims, [(a, 1, 0)], t, e)

    def min_y(self, pose, bones):
        lo, _ = self.geo.bounds(pose, bones)
        return float(lo[1])

    def top_y(self, pose):
        _, hi = self.geo.bounds(pose)
        return float(hi[1])


def to_np(pose):
    return {b: {ch: np.array(v, dtype=float) for ch, v in c.items()} for b, c in pose.items()}


# ------------------------------------------------------------------ baking
def bake(rig, fn, length, fps, loop, ground=None, extra=None, start_pose_zero=False):
    """Samples fn(t)->pose; grounds it; returns a Bedrock clip dict and stats."""
    n = max(1, int(round(length * fps)))
    samples = []
    worst = 0.0
    tops = []
    for i in range(n + 1):
        t = length * i / n
        pose = to_np(fn(t))
        if ground:
            bones = FEET if ground == "feet" else FEET + HANDS
            y = rig.min_y(pose, bones)
            worst = max(worst, abs(y))
            pose = merge(pose, POS(root=(0, -y, 0)))
        tops.append(rig.top_y(pose))
        samples.append((t, pose))
    bones = {}
    allkeys = sorted({(b, ch) for _, p in samples for b, c in p.items() for ch in c})
    for b, ch in allkeys:
        keys = {}
        for t, p in samples:
            v = p.get(b, {}).get(ch)
            if v is None:
                v = np.ones(3) if ch == "scale" else np.zeros(3)
            keys[("%.3f" % t).rstrip("0").rstrip(".") if t else "0.0"] = [round(float(x), 2) for x in v]
        vals = list(keys.values())
        if all(v == vals[0] for v in vals):
            if all(abs(x) < 1e-6 for x in vals[0]) and ch != "scale":
                continue
            bones.setdefault(b, {})[ch] = vals[0]
        else:
            bones.setdefault(b, {})[ch] = keys
    clip = {"animation_length": round(length, 3), "bones": dict(sorted(bones.items()))}
    if loop is not None:
        clip["loop"] = loop
    if extra:
        clip.update(extra)
    return clip, {"ground_fix_max": worst, "top_px": max(tops), "top_blocks": max(tops) * SCALE / 16}


# ------------------------------------------------------------------ the poses
def breath_pose(t, period, amp):
    s = math.sin(t / period * 2 * math.pi)
    return merge(R(chest=(-amp * s, 0, 0), abdomen=(-amp * 0.5 * s, 0, 0), neck=(amp * 0.6 * s, 0, 0)),
                 mirror_arm(arm_r=(0, 0, amp * 0.6 * (s + 1) / 2)), POS(mane_body=(0, 0.35 * amp * (s + 1) / 2, 0)))


def clip_idle_up(rig):
    """Upright, alive: deep breaths, slow head search, an uncanny head snap, restless fingers."""
    L = 6.0

    def fn(t):
        look = 22 * math.sin(t / L * 2 * math.pi)
        snap = jerk(t, 3.0, 7, hold=0.45)
        head = R(head=(-4 + 3 * math.sin(t * 1.3), look + 26 * snap, 14 * snap + 4 * math.sin(t * 0.9)),
                 neck=(2, look * 0.35, 3 * snap))
        fing = fingers(12 + 10 * math.sin(t * 2.2), 12 + 10 * math.sin(t * 2.2 + 1.7))
        arms = mirror_arm(arm_r=(4 + 2 * math.sin(t * 0.8), 0, 2), forearm_r=(-6, 0, 0))
        return merge(breath_pose(t, 3.0, 4.0), head, fing, arms)

    return bake(rig, fn, L, 12, True, ground="feet")


def low_base(rig):
    return to_np(rig.supplied("planted", 0.05))


def clip_idle_low(rig):
    """Hunched on its knuckles: heaving back, head low and scanning, fingers drumming the rock."""
    L = 4.0
    base = low_base(rig)

    def fn(t):
        s = math.sin(t / 2.0 * 2 * math.pi)
        drum = {}
        for i, f in enumerate(FINGERS_R):
            k = max(0.0, math.sin((t * 3.0 - i * 0.18) * 2 * math.pi)) ** 6
            drum[f] = (0, 0, -18 * k)
        for i, f in enumerate(FINGERS_L):
            k = max(0.0, math.sin((t * 3.0 - 0.5 - i * 0.18) * 2 * math.pi)) ** 6
            drum[f] = (0, 0, 18 * k)
        snap = jerk(t, 2.0, 3, hold=0.3)
        return merge(base, R(chest=(-5 * s, 0, 0), abdomen=(-3 * s, 0, 0), hips=(1.5 * s, 0, 0),
                             head=(-14 + 4 * math.sin(t * 1.1), 30 * math.sin(t / L * 2 * math.pi) + 22 * snap, 10 * snap),
                             neck=(-8, 8 * math.sin(t / L * 2 * math.pi), 0)),
                     R(**drum), POS(mane_body=(0, 0.8 * (s + 1) / 2, 0)))

    return bake(rig, fn, L, 12, True, ground="limbs")


def clip_watch_low(rig):
    """Stalking stillness: folded low, neck craned up, head cocked, staring."""
    base = low_base(rig)

    def fn(t):
        k = ease_io(seg(t, 0, 0.8))
        return merge(base, scale(R(neck=(-24, 0, 6), head=(-18, 0, 26), chest=(-6, 0, 0)), k),
                     scale(fingers(-10, -10, spread=6), k))

    return bake(rig, fn, 0.8, 15, "hold_on_last_frame", ground="limbs")


def clip_tilt(rig):
    """Head slowly tilts far past a natural angle, neck following."""
    def fn(t):
        k = ease_io(seg(t, 0, 1.4))
        return merge(R(head=(-6 * k, 8 * k, 48 * k), neck=(4 * k, 4 * k, 14 * k)), fingers(10 * k, 10 * k))

    return bake(rig, fn, 1.4, 15, "hold_on_last_frame", ground="feet")


def clip_owl(rig):
    """Head turns all the way around in three stuttering steps."""
    def fn(t):
        steps = [(0.0, 0.0), (0.25, 70.0), (0.45, 70.0), (0.6, 125.0), (0.8, 125.0), (0.95, 172.0)]
        y = 0.0
        for (t0, a0), (t1, a1) in zip(steps, steps[1:]):
            if t >= t0:
                y = a0 + (a1 - a0) * ease_out(seg(t, t0, t1))
        return R(head=(-4, y, 6 * math.sin(t * 9)), neck=(0, y * 0.12, 0))

    return bake(rig, fn, 1.0, 20, "hold_on_last_frame", ground="feet")


def clip_neck(rig):
    """Neck extends toward you; the head stays level, jaw sagging."""
    def fn(t):
        k = ease_io(seg(t, 0, 1.6))
        tr = math.sin(t * 31) * 0.8 * k
        return merge(R(chest=(14 * k, 0, 0), neck=(-34 * k, 0, 0), head=(20 * k + tr, 0, 8 * k), jaw=(18 * k, 0, 0)),
                     POS(neck=(0, 2.8 * k, -4.6 * k), head=(0, 1.4 * k, -2.6 * k)),
                     mirror_arm(arm_r=(-14 * k, 0, 6 * k), forearm_r=(-20 * k, 0, 0)), fingers(24 * k, 24 * k, spread=8 * k))

    return bake(rig, fn, 1.6, 15, "hold_on_last_frame", ground="feet")


def clip_unhinge(rig):
    """Jaw drops off its hinge; the head shudders."""
    L = 1.0

    def fn(t):
        shake = math.sin(t * 2 * math.pi * 11) * 5 + math.sin(t * 2 * math.pi * 17) * 3
        return merge(R(head=(-16, shake, shake * 0.6), neck=(-8, 0, 0), jaw=(58, 0, 0), chest=(-6, 0, 0)),
                     POS(jaw=(0, -2.0, 0.6)), fingers(30, 30, spread=10))

    return bake(rig, fn, L, 24, True, ground="feet")


STATUES = {
    # each: (description, pose builder)
    "statue_reach": ("mid-step, one arm reaching for you", lambda: merge(
        R(chest=(14, -10, 4), abdomen=(6, 0, 0), head=(-14, 10, 30), neck=(-6, 0, 8),
          leg_l=(-26, 0, 0), shin_l=(36, 0, 0), foot_l=(-10, 0, 0)),
        R(arm_r=(-92, 0, 8), forearm_r=(-8, 0, 0), hand_r=(-12, 0, 0)), R(arm_l=(10, 0, -6), forearm_l=(-10, 0, 0)),
        fingers(-14, 28, spread=14))),
    "statue_arms_up": ("arms raised overhead, head thrown back", lambda: merge(
        R(chest=(-12, 0, 0), head=(-28, 0, -10), neck=(-10, 0, 0), jaw=(22, 0, 0)),
        mirror_arm(arm_r=(-156, 0, 26), forearm_r=(-12, 0, 0)), fingers(-10, -10, spread=16))),
    "statue_cover": ("hands over its face, peering between fingers", lambda: merge(
        R(chest=(10, 0, 0), head=(14, 0, -12), neck=(6, 0, 0)),
        mirror_arm(arm_r=(-62, -18, 32), forearm_r=(-74, 0, -10), hand_r=(-20, 0, 0)), fingers(6, 6, spread=12))),
    "statue_bow": ("bent deep, face craned up at you", lambda: merge(
        R(chest=(40, 0, 0), abdomen=(18, 0, 0), hips=(8, 0, 0), neck=(-36, 0, 0), head=(-34, 0, 18)),
        mirror_arm(arm_r=(-30, 0, 4), forearm_r=(-6, 0, 0)), fingers(20, 20))),
    "statue_sideways": ("whole body tilted, head at a right angle", lambda: merge(
        R(hips=(0, 0, 8), abdomen=(0, 0, 10), chest=(0, 12, 14), neck=(0, 0, 20), head=(0, -20, 62)),
        R(arm_r=(-20, 0, 40), forearm_r=(-30, 0, 0), arm_l=(6, 0, -4)), fingers(30, 4, spread=10))),
}


def clip_statue(rig, name):
    target = STATUES[name][1]()

    def fn(t):
        return scale(target, ease_out(seg(t, 0, 0.25)))

    return bake(rig, fn, 0.25, 20, "hold_on_last_frame", ground="feet")


def clip_peek(rig, side):
    """Leans out from cover: body bent sideways, a hand gripping the edge, head cocked the wrong way."""
    sgn = 1 if side == "r" else -1

    def fn(t):
        k = ease_out(seg(t, 0, 0.7))
        body = R(hips=(0, 0, 6 * sgn), abdomen=(0, 0, 14 * sgn), chest=(8, 10 * sgn, 26 * sgn), neck=(0, 0, 8 * sgn),
                 head=(-6, -18 * sgn, -30 * sgn))
        arm = "r" if side == "r" else "l"
        grip = R(**{"arm_" + arm: (-48, 0, 52 * sgn), "forearm_" + arm: (-46, 0, 0), "hand_" + arm: (-10, 0, 0)})
        return merge(scale(body, k), scale(grip, k), scale(fingers(34 if side == "r" else 6, 6 if side == "r" else 34), k),
                     R(leg_r=(0, 0, -6 * sgn * k), leg_l=(0, 0, -6 * sgn * k)))

    return bake(rig, fn, 0.7, 20, "hold_on_last_frame", ground="feet")


def clip_scream(rig):
    """The wail: arches back, arms flung wide, then lunges its whole face forward and shakes."""
    L = 1.8

    def fn(t):
        back = bump(t, 0.0, 0.25, 0.45, 0.7)
        fwd = bump(t, 0.45, 0.7, 1.45, 1.8)
        shake = (math.sin(t * 2 * math.pi * 13) * 4 + math.sin(t * 2 * math.pi * 19) * 2.5) * fwd
        return merge(
            scale(R(chest=(-18, 0, 0), abdomen=(-8, 0, 0), head=(-34, 0, 0), neck=(-12, 0, 0), jaw=(30, 0, 0)), back),
            scale(merge(R(chest=(16, 0, 0), neck=(-20, 0, 0), head=(-6, 0, 0), jaw=(60, 0, 0)), POS(jaw=(0, -2.0, 0.6))), fwd),
            scale(mirror_arm(arm_r=(-46, 0, 74), forearm_r=(-18, 0, 0)), max(back, fwd)),
            R(head=(shake, shake * 0.8, shake * 0.6), chest=(shake * 0.3, 0, 0)), scale(fingers(-20, -20, spread=18), max(back, fwd)))

    return bake(rig, fn, L, 24, "hold_on_last_frame", ground="feet")


def clip_grab(rig):
    """Lunges and closes both hands around you at chest height."""
    def fn(t):
        reach = ease_out(seg(t, 0, 0.3))
        close = ease_in(seg(t, 0.25, 0.5))
        return merge(scale(R(chest=(24, 0, 0), abdomen=(10, 0, 0), neck=(-18, 0, 0), head=(-8, 0, 0), jaw=(26, 0, 0),
                             leg_l=(-22, 0, 0), shin_l=(30, 0, 0)), reach),
                     scale(mirror_arm(arm_r=(-88, 0, 18), forearm_r=(-12, 0, 0)), reach),
                     scale(mirror_arm(arm_r=(0, 14, -14), forearm_r=(-24, 0, 0)), close),
                     scale(fingers(-18, -18, spread=16), reach * (1 - close)), scale(fingers(55, 55), close))

    return bake(rig, fn, 0.5, 20, "hold_on_last_frame", ground="feet")


def clip_hold(rig):
    """Holding you up to its face and shaking."""
    L = 0.6
    hold = merge(R(chest=(24, 0, 0), abdomen=(10, 0, 0), neck=(-18, 0, 0), head=(-8, 0, 0), jaw=(40, 0, 0),
                   leg_l=(-22, 0, 0), shin_l=(30, 0, 0)),
                 mirror_arm(arm_r=(-88, 14, 4), forearm_r=(-36, 0, 0)), fingers(55, 55), POS(jaw=(0, -1.2, 0.3)))

    def fn(t):
        s = math.sin(t / L * 2 * math.pi * 3)
        return merge(hold, mirror_arm(arm_r=(6 * s, 0, 0)), R(chest=(3 * s, 0, 0), head=(4 * math.sin(t * 40), 3 * math.sin(t * 33), 0),
                                                             jaw=(6 * math.sin(t * 50), 0, 0)))

    return bake(rig, fn, L, 20, True, ground="feet")


def clip_throw(rig):
    """Flings you aside."""
    hold = merge(R(chest=(24, 0, 0), abdomen=(10, 0, 0), neck=(-18, 0, 0), head=(-8, 0, 0), jaw=(40, 0, 0)),
                 mirror_arm(arm_r=(-88, 14, 4), forearm_r=(-36, 0, 0)), fingers(55, 55))
    fling = merge(R(chest=(10, -46, 0), abdomen=(4, -16, 0), head=(-10, 30, 0), jaw=(20, 0, 0)),
                  R(arm_r=(-40, 0, 92), forearm_r=(-10, 0, 0), arm_l=(-110, 0, 20), forearm_l=(-20, 0, 0)), fingers(-20, -20, spread=16))

    def fn(t):
        return lerp(hold, fling, ease_out(seg(t, 0, 0.35)))

    return bake(rig, fn, 0.6, 20, "hold_on_last_frame", ground="feet")


def clip_sniff(rig):
    """Searching: face to the ground, sweeping, three quick sniffs."""
    L = 3.0
    base = low_base(rig)

    def fn(t):
        sweep = 34 * math.sin(t / L * 2 * math.pi)
        sn = sum(bump(t, s, s + 0.05, s + 0.08, s + 0.16) for s in (0.9, 1.15, 1.4, 2.4, 2.6))
        return merge(base, R(chest=(10, 0, 0), neck=(14, sweep * 0.3, 0), head=(30 - 6 * sn, sweep, 10 * math.sin(t * 2)),
                             jaw=(4 * sn, 0, 0)))

    return bake(rig, fn, L, 12, True, ground="limbs")


def clip_frustrated(rig):
    """Rears up, slams both hands down, shakes its head."""
    L = 1.6
    base = low_base(rig)

    def fn(t):
        up = bump(t, 0.0, 0.35, 0.55, 0.75)
        slam = bump(t, 0.6, 0.72, 1.1, 1.5)
        shake = math.sin(t * 2 * math.pi * 9) * 10 * bump(t, 0.75, 0.85, 1.3, 1.55)
        return merge(base,
                     scale(merge(R(chest=(-40, 0, 0), abdomen=(-20, 0, 0), hips=(-10, 0, 0), head=(-20, 0, 0), jaw=(40, 0, 0)),
                                 mirror_arm(arm_r=(-120, 0, 30))), up),
                     scale(merge(R(chest=(14, 0, 0), head=(10, 0, 0), jaw=(30, 0, 0)), mirror_arm(arm_r=(-20, 0, -10))), slam),
                     R(head=(0, shake, shake * 0.5)))

    return bake(rig, fn, L, 20, "hold_on_last_frame", ground="limbs")


def clip_behind(rig):
    """What you see when you turn around: crouched right there, head on its side, one hand lifted."""
    base = low_base(rig)

    def fn(t):
        k = ease_out(seg(t, 0, 0.2))
        return merge(base, scale(merge(R(neck=(-30, 0, 0), head=(-20, 0, 64), chest=(-14, 0, 0)),
                                       R(arm_r=(-70, 0, 20), forearm_r=(-30, 0, 0)), fingers(-16, 30, spread=16)), k))

    return bake(rig, fn, 0.2, 20, "hold_on_last_frame", ground="feet")


# ------------------------------------------------------------------ overlays (procedural Molang, always on)
def overlays():
    return {
        # breathing: v.br_amp in degrees, v.br_ph phase in degrees (advanced in pre_animation)
        "tw2_breath": {"loop": True, "animation_length": 1.0, "bones": {
            "chest": {"rotation": ["-v.br_amp * math.sin(v.br_ph)", 0, 0]},
            "abdomen": {"rotation": ["-v.br_amp * 0.5 * math.sin(v.br_ph)", 0, 0]},
            "neck": {"rotation": ["v.br_amp * 0.5 * math.sin(v.br_ph)", 0, 0]},
            "arm_r": {"rotation": [0, 0, "v.br_amp * 0.4 * (math.sin(v.br_ph) + 1)"]},
            "arm_l": {"rotation": [0, 0, "-v.br_amp * 0.4 * (math.sin(v.br_ph) + 1)"]},
            "mane_body": {"position": [0, "v.br_amp * 0.15 * (math.sin(v.br_ph) + 1)", 0]}}},
        # tremor: fine shudder of head and fingers scaled by v.tremor (0..1)
        "tw2_tremor": {"loop": True, "animation_length": 1.0, "bones": {
            "head": {"rotation": ["v.tremor * (math.sin(q.life_time * 1700) * 1.6 + math.sin(q.life_time * 2900) * 1.0)",
                                  "v.tremor * math.sin(q.life_time * 2300) * 1.4",
                                  "v.tremor * math.sin(q.life_time * 1300 + 40) * 1.8"]},
            **{f: {"rotation": [0, 0, "-v.tremor * (4 + 4 * math.sin(q.life_time * 2100 + %d))" % (i * 60)]} for i, f in enumerate(FINGERS_R)},
            **{f: {"rotation": [0, 0, "v.tremor * (4 + 4 * math.sin(q.life_time * 2100 + %d))" % (i * 60 + 30)]} for i, f in enumerate(FINGERS_L)}}},
        # head tracking with an owl-wide yaw range (|v.look_y| up to 175)
        "tw2_look": {"loop": True, "animation_length": 1.0, "bones": {
            "neck": {"rotation": ["v.look_x * 0.3", "math.clamp(v.look_y, -60, 60) * 0.3", 0]},
            "head": {"rotation": ["v.look_x * 0.7", "v.look_y - math.clamp(v.look_y, -60, 60) * 0.3", 0]}}},
        # copied head pitch + quizzical roll from the mimic system
        "tw2_mimic_tilt": {"loop": True, "animation_length": 1.0, "bones": {
            "neck": {"rotation": ["v.mimic_pitch * 0.35", 0, "v.mimic_roll * 0.35"]},
            "head": {"rotation": ["v.mimic_pitch * 0.55", 0, "v.mimic_roll * 0.65"]}}},
        # agitated display: tail raised and curled forward over the back, slowly writhing
        "tw2_tail_curl": {"loop": True, "animation_length": 4.0, "bones": {
            "tail0": {"rotation": ["58 + 4 * math.sin(q.life_time * 70)", "25 + 6 * math.sin(q.life_time * 50)", 0]},
            "tail1": {"rotation": ["30 + 5 * math.sin(q.life_time * 70 - 40)", "50 + 8 * math.sin(q.life_time * 50 - 30)", 0]},
            "tail2": {"rotation": ["34 + 6 * math.sin(q.life_time * 70 - 80)", "8 + 10 * math.sin(q.life_time * 50 - 60)", 0]},
            "tail3": {"rotation": ["30 + 7 * math.sin(q.life_time * 70 - 120)", "4 + 12 * math.sin(q.life_time * 50 - 90)", 0]},
            "tail4": {"rotation": ["26 + 8 * math.sin(q.life_time * 70 - 160)", "14 * math.sin(q.life_time * 50 - 120)", 0]}}},
        # creeping walk: shoulders rolled forward, head low and level, arms dangling, driven by the gait phase
        "tw2_creep": {"loop": True, "animation_length": 1.0, "bones": {
            "chest": {"rotation": ["8 + 2 * math.sin(v.walk * 2)", "7 * math.sin(v.walk)", 0]},
            "abdomen": {"rotation": [4, "-3 * math.sin(v.walk)", 0]},
            "neck": {"rotation": [-10, "-5 * math.sin(v.walk)", 0]},
            "head": {"rotation": ["-6 - 2 * math.sin(v.walk * 2)", "-3 * math.sin(v.walk)", 0]},
            "arm_r": {"rotation": ["6 + 10 * math.sin(v.walk + 180)", 0, 4]},
            "arm_l": {"rotation": ["6 + 10 * math.sin(v.walk)", 0, -4]},
            "forearm_r": {"rotation": ["-8 - 6 * math.max(0, math.sin(v.walk + 140))", 0, 0]},
            "forearm_l": {"rotation": ["-8 - 6 * math.max(0, math.sin(v.walk - 40))", 0, 0]}}},
    }


# ------------------------------------------------------------------ tunnel crawl fixes
def _tunnel_body(rig, t, moving):
    """Supplied crawl/planted + the derived tunnel squash, as played by the loco state."""
    if moving:
        env = {"v.crawl": t}
        layers = [(rig.anims[P + "crawl"], 1, 0), (rig.rehearsal[P + "tw_tunnel_move"], 1, 0)]
    else:
        env = {}
        layers = [(rig.anims[P + "planted"], 1, 0), (rig.rehearsal[P + "tw_tunnel_still"], 1, 0)]
    allanims = dict(rig.anims)
    allanims.update(rig.rehearsal)
    return to_np(bm.pose_from(allanims, layers, t if not moving else 0.0, dict(env, **{"q.life_time": t})))


def _solve_tail(rig, body, sway, floor_px=0.6):
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


def clip_tunnel_fixes(rig):
    """In 2-high tunnels the squashed crawl drops the tail ~1 block into the floor and the shins
    ~0.2 blocks.  These clips lift the body just enough and lay the tail along the floor."""
    out = {}
    target = -0.05 * 16 / SCALE  # allow 0.05 blocks of shin/knee contact, in model px

    def lift(body):
        bones = [b for b in rig.geo.order if not b.startswith("tail")]
        return max(0.0, target - rig.min_y(body, bones))

    # still: constant lift, tail resting with a slow drag-sway
    body = _tunnel_body(rig, 0.05, False)
    dy = lift(body)
    out["tw2_gfix_tunnel_still"] = ({"loop": "hold_on_last_frame", "animation_length": 0.05,
                                     "bones": {"root": {"position": [0, round(dy, 2), 0]}}},
                                    {"ground_fix_max": dy, "top_px": 0, "top_blocks": 0})
    lifted = merge(body, POS(root=(0, dy, 0)))
    L = 4.0

    keys = {}
    n = 16
    for i in range(n + 1):
        t = L * i / n
        # yaw sway on a pitched hip changes segment height, so every key is solved with its sway
        tl = _solve_tail(rig, lifted, 7 * math.sin(t / L * 2 * math.pi), floor_px=1.0)
        keys["%.2f" % t] = {b: [round(float(tl[b]["rotation"][0]), 2), round(float(tl[b]["rotation"][1]), 2), 0]
                            for b in TAIL}
    out["tw2_tail_tunnel_still"] = ({"loop": True, "animation_length": L, "bones": {
        b: {"rotation": {t: v[b] for t, v in keys.items()}} for b in TAIL}},
        {"ground_fix_max": 0, "top_px": 0, "top_blocks": 0})
    # moving: lift and tail solved per crawl phase, driven by v.crawl like the supplied crawl
    n = 20
    lifts, tails = {}, {}
    for i in range(n + 1):
        ph = i / n
        b0 = _tunnel_body(rig, ph, True)
        dy = lift(b0)
        lifts["%.2f" % ph] = [0, round(dy, 2), 0]
        sw = 9 * math.sin(ph * 2 * math.pi)
        tl = _solve_tail(rig, merge(b0, POS(root=(0, dy, 0))), sw, floor_px=1.0)
        tails["%.2f" % ph] = {b: [round(float(tl[b]["rotation"][0]), 2), round(float(tl[b]["rotation"][1]), 2), 0]
                              for b in TAIL}
    out["tw2_gfix_tunnel_move"] = ({"loop": True, "animation_length": 1.0, "anim_time_update": "v.crawl",
                                    "bones": {"root": {"position": lifts}}},
                                   {"ground_fix_max": max(v[1] for v in lifts.values()), "top_px": 0, "top_blocks": 0})
    out["tw2_tail_tunnel_move"] = ({"loop": True, "animation_length": 1.0, "anim_time_update": "v.crawl", "bones": {
        b: {"rotation": {t: v[b] for t, v in tails.items()}} for b in TAIL}},
        {"ground_fix_max": 0, "top_px": 0, "top_blocks": 0})
    return out


# ------------------------------------------------------------------ registry
def build_all(rig):
    out = {}
    stats = {}

    def add(name, res):
        clip, st = res
        out[P + name] = clip
        stats[name] = st

    add("tw2_idle_up", clip_idle_up(rig))
    add("tw2_idle_low", clip_idle_low(rig))
    add("tw2_watch_low", clip_watch_low(rig))
    add("tw2_tilt", clip_tilt(rig))
    add("tw2_owl", clip_owl(rig))
    add("tw2_neck", clip_neck(rig))
    add("tw2_unhinge", clip_unhinge(rig))
    for s in STATUES:
        add("tw2_" + s, clip_statue(rig, s))
    add("tw2_peek_r", clip_peek(rig, "r"))
    add("tw2_peek_l", clip_peek(rig, "l"))
    add("tw2_scream", clip_scream(rig))
    add("tw2_grab", clip_grab(rig))
    add("tw2_hold", clip_hold(rig))
    add("tw2_throw", clip_throw(rig))
    add("tw2_sniff", clip_sniff(rig))
    add("tw2_frustrated", clip_frustrated(rig))
    add("tw2_behind", clip_behind(rig))
    for k, res in clip_tunnel_fixes(rig).items():
        add(k, res)
    for k, v in overlays().items():
        out[P + k] = v
    return out, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    rig = Rig()
    clips, stats = build_all(rig)
    doc = {"format_version": "1.8.0", "animations": dict(sorted(clips.items()))}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    lines = ["# Tailwail v2 animation report", "", "| clip | max grounding fix (px) | peak height (blocks @1.5) |", "|---|---|---|"]
    for k, st in sorted(stats.items()):
        lines.append("| %s | %.2f | %.2f |" % (k, st["ground_fix_max"], st["top_blocks"]))
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    open(REPORT, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print("wrote %d clips, %.0f KB" % (len(clips), os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
