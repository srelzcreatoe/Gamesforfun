#!/usr/bin/env python3
"""Tailwail v3 animation studio: the ONE animation file the resource pack ships.

Every clip the creature plays is authored here as a function of time, sampled into
keyframes, grounded against the real rig and written to
packs/TailwailRP/animations/tall_wail.v3.animation.json (ids animation.tall_wail.v3.*).
The supplied clips are read straight from the untouched archive and re-baked where they
are reused; the resource pack no longer ships the supplied, rehearsal or v2 files.

Design rules (v3 feedback: "he's very still"):
  * nothing holds a frozen frame: every pose clip LOOPS with breathing, twitches and
    restless fingers baked in, at amplitudes that read at 20+ blocks;
  * gaits are distance-driven (`anim_time_update` from q.modified_distance_moved) with
    the stride measured from the foot travel, so feet do not skate;
  * BODY clips never touch the tail bones (the tail overlay owns them);
  * ONE-SHOTS (scream, swipes, slam, pounce, grab, bite...) are absolute full-body clips
    played by the script with Entity.playAnimation while the body controller sits in
    its neutral "shot" state; PARTIAL one-shots (flinch) add on top of any state.

  python3 -I tools/anim_v3.py                 # write clips + docs/generated/anim_v3_report.md
  python3 -I tools/anim_v3.py --sheet a,b     # also render review sheets to build/anim_v3/
"""
import argparse
import io
import json
import math
import os
import sys
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("TAILWAIL_ROOT") or os.path.dirname(HERE)
sys.path.insert(0, HERE)
import bedrock_model as bm  # noqa: E402
from pose_lib import (  # noqa: E402
    FEET, FINGERS_L, FINGERS_R, HANDS, POS, R, TAIL, bump, ease_in, ease_io, ease_out, fingers, jerk, lerp, merge,
    mirror_arm, scale, seg, solve_tail, to_np,
)

RP = os.path.join(ROOT, "packs", "TailwailRP")
OUT = os.path.join(RP, "animations", "tall_wail.v3.animation.json")
REPORT = os.path.join(ROOT, "docs", "generated", "anim_v3_report.md")
ZIP = os.path.join(ROOT, "source_assets", "original", "TallWail_Blockbench_v3.zip")
GEO = os.path.join(RP, "models", "entity", "tall_wail.geo.json")
P = "animation.tall_wail."
V3 = P + "v3."
SCALE = 1.5
PX = SCALE / 16.0          # blocks per model pixel at the entity scale
TAU = 2 * math.pi
TAILSET = set(TAIL)


# ------------------------------------------------------------------ rig
class Rig:
    def __init__(self):
        self.geo = bm.Geometry(GEO)
        with zipfile.ZipFile(ZIP) as z:
            data = json.loads(z.read("TallWail_Blockbench_v3/tall_wail.animation.json"))
        self.anims = {k: bm.Animation(k, v) for k, v in data["animations"].items()}

    def supplied(self, name, t=0.0, env=None):
        a = self.anims[P + name]
        e = {"q.life_time": t}
        e.update(env or {})
        tt = t
        return to_np(bm.pose_from(self.anims, [(a, 1, 0)], tt, e))

    def min_y(self, pose, bones=None):
        lo, _ = self.geo.bounds(pose, bones)
        return float(lo[1])

    def top_y(self, pose):
        _, hi = self.geo.bounds(pose)
        return float(hi[1])


def strip(pose, bones):
    return {b: c for b, c in pose.items() if b not in bones}


def wave(t, period, phase=0.0):
    return math.sin((t / period + phase) * TAU)


def rnd(k, seed):
    v = math.sin(k * 12.9898 + seed * 78.233) * 43758.5453
    return v - math.floor(v)


def shiver(t, freq, seed=0.0):
    """Fast irregular shudder in [-1, 1]."""
    return (math.sin(t * freq * TAU + seed) * 0.55 + math.sin(t * freq * 1.73 * TAU + seed * 2.1) * 0.3
            + math.sin(t * freq * 2.91 * TAU + seed * 3.7) * 0.15)


def ripple(t, rate, amp, base=0.0, spread=0.18, sign_r=-1):
    """Restless fingers: a wave rolling across the four fingers of each hand."""
    d = {}
    for i, f in enumerate(FINGERS_R):
        c = base + amp * (0.5 + 0.5 * math.sin((t * rate - i * spread) * TAU))
        d[f] = (0, 0, sign_r * c)
        d[f + "_tip"] = (0, 0, sign_r * c * 1.2)
    for i, f in enumerate(FINGERS_L):
        c = base + amp * (0.5 + 0.5 * math.sin((t * rate - i * spread + 0.37) * TAU))
        d[f] = (0, 0, -sign_r * c)
        d[f + "_tip"] = (0, 0, -sign_r * c * 1.2)
    return R(**d)


def breath(t, period, amp):
    s = wave(t, period)
    return merge(R(chest=(-amp * s, 0, 0), abdomen=(-amp * 0.5 * s, 0, 0), neck=(amp * 0.5 * s, 0, 0)),
                 mirror_arm(arm_r=(0, 0, amp * 0.45 * (s + 1))), POS(mane_body=(0, 0.3 * amp * (s + 1) / 2, 0)))


def twitch(t, period, seed, amp, hold=0.12):
    """Head/neck snap to a random angle at irregular moments (uncanny 'bird' twitch)."""
    return jerk(t, period, seed, hold=hold) * amp


# ------------------------------------------------------------------ stances (absolute, relative to bind)
def st_low(rig):
    """Supplied 'planted': folded on its knuckles, arms splayed like a spider's."""
    return rig.supplied("planted", 0.05)


def st_tall():
    """Unfolded to full height: spine straightened, knees nearly locked, head tipped down at you."""
    return merge(R(hips=(-4, 0, 0), abdomen=(-8, 0, 0), chest=(-9, 0, 0), neck=(2, 0, 0), head=(12, 0, 0),
                   leg_r=(18, 0, -6), leg_l=(18, 0, 6), shin_r=(-30, 0, 0), shin_l=(-30, 0, 0),
                   foot_r=(12, 0, 0), foot_l=(12, 0, 0)),
                 mirror_arm(arm_r=(14, 0, -4), forearm_r=(10, 0, 0)), fingers(6, 6, spread=6))


def st_gallop():
    """Quadruped charge stance: torso pitched ~60 deg, arms planted ahead, head up and level."""
    return merge(R(hips=(20, 0, 0), abdomen=(14, 0, 0), chest=(22, 0, 0), neck=(-40, 0, 0), head=(-16, 0, 0),
                   leg_r=(-26, 0, 4), leg_l=(-26, 0, -4), shin_r=(36, 0, 0), shin_l=(36, 0, 0),
                   foot_r=(-10, 0, 0), foot_l=(-10, 0, 0)),
                 mirror_arm(arm_r=(-34, 0, 4), forearm_r=(-6, 0, 0), hand_r=(28, 0, 0)), fingers(30, 30))


def st_hold():
    """Both hands closed around a body held at its own face."""
    return merge(R(chest=(24, 0, 0), abdomen=(10, 0, 0), neck=(-18, 0, 0), head=(-8, 0, 0), jaw=(30, 0, 0),
                   leg_l=(-22, 0, 0), shin_l=(30, 0, 0)),
                 mirror_arm(arm_r=(-88, 14, 4), forearm_r=(-36, 0, 0)), fingers(55, 55), POS(jaw=(0, -1.0, 0.3)))


# ------------------------------------------------------------------ baking
def tkey(t):
    return ("%.3f" % t).rstrip("0").rstrip(".") if t else "0.0"


def bake(rig, fn, length, fps, loop, ground=None, post=None, keep_tail=False, extra=None, settle=None, floor=True):
    """Samples fn(t) -> pose, grounds it (feet / limbs), adds post(t) root offset, returns (clip, stats).

    ground: None | 'feet' | 'limbs' | 'lift' (limbs, but only ever raised, for airborne frames)
    settle: optional (t0, t1) window outside of which grounding is skipped (jumps)."""
    n = max(1, int(round(length * fps)))
    samples, fixes, tops, lows = [], [], [], []
    for i in range(n + 1):
        t = length * i / n
        pose = to_np(fn(t))
        if not keep_tail:
            pose = strip(pose, TAILSET)
        if ground and (settle is None or settle[0] <= t <= settle[1]):
            bones = FEET if ground == "feet" else FEET + HANDS
            y = rig.min_y(pose, bones)
            if ground == "lift":
                y = min(0.0, y)
            fixes.append(abs(y))
            pose = merge(pose, POS(root=(0, -y, 0)))
        if post:
            pose = merge(pose, POS(root=post(t)))
        if floor:
            # nothing (head, elbows, mane) may sink through the floor either
            body_low = rig.min_y(pose, [b for b in rig.geo.order if b not in TAILSET])
            if body_low < -0.3:
                pose = merge(pose, POS(root=(0, -body_low - 0.3, 0)))
        lows.append(rig.min_y(pose, [b for b in rig.geo.order if b not in TAILSET]))
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
            keys[tkey(t)] = [round(float(x), 2) + 0.0 for x in v]
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
    st = {"ground_fix_max": max(fixes) if fixes else 0.0, "top_blocks": max(tops) * PX, "low_blocks": min(lows) * PX,
          "frames": n + 1}
    return clip, st, samples


def stride_of(rig, samples, foot):
    """Backward travel (blocks) of a foot while it carries weight = distance per gait cycle."""
    zs = []
    for _, pose in samples:
        pts = rig.geo.bone_points(pose, [foot])[foot]
        if pts[:, 1].min() < 0.9:  # on the floor (model px)
            zs.append(float(pts[:, 2].mean()))
    if len(zs) < 2:
        return 0.0
    return (max(zs) - min(zs)) * PX


def gait_extra(stride):
    return {"anim_time_update": "math.mod(q.modified_distance_moved, %.3f) / %.3f" % (stride, stride)}


# ------------------------------------------------------------------ GAITS (loop over phase 0..1, distance driven)
# Blocks per gallop cycle.  3.6: at the 7.8 blocks/s chase that is ~2.2 bounds a second, slower
# and heavier than v3's 3.0 at 8.4 (2.8 a second).
GALLOP_STRIDE = 3.6
# The hallucination runner moves at the chase speed; its time-driven gallop matches the stride.
ECHO_RUN_SPEED = 7.8


def gait_gallop(rig):
    """Transverse gallop on knuckles and feet: the charge."""
    base = st_gallop()

    def fn(p):
        legs, arms = {}, {}
        for side, ph in (("r", 0.0), ("l", 0.1)):
            a = TAU * (p - ph)
            sw, lift, comp = math.cos(a), max(0.0, math.sin(a)), max(0.0, -math.sin(a))
            legs["leg_" + side] = (30 + 30 * sw - 14 * comp, 0, 0)
            legs["shin_" + side] = (-10 + 44 * lift - 8 * sw + 30 * comp, 0, 0)
            legs["foot_" + side] = (20 * sw - 18 * lift - 16 * comp, 0, 0)
        for side, ph in (("r", 0.5), ("l", 0.62)):
            a = TAU * (p - ph)
            sw, lift, comp = math.cos(a), max(0.0, math.sin(a)), max(0.0, -math.sin(a))
            arms["arm_" + side] = (20 + 40 * sw - 8 * comp, 0, 0)
            arms["forearm_" + side] = (-46 * lift - 26 * comp, 0, 0)
            arms["hand_" + side] = (-26 * lift + 10 * sw + 18 * comp, 0, 0)
        flex = -math.cos(TAU * p)          # +1 gathered (spine curled), -1 extended
        spine = R(hips=(5 * flex, 0, 0), abdomen=(6 * flex, 0, 0), chest=(7 * flex, 0, 0),
                  neck=(-9 * flex, 0, 0), head=(-6 * flex + 3 * math.sin(TAU * 2 * p), 0, 0),
                  jaw=(14 + 10 * max(0.0, math.sin(TAU * 2 * p + 0.6)), 0, 0))
        roll = R(chest=(0, 6 * math.sin(TAU * p), 4 * math.sin(TAU * p)), hips=(0, -5 * math.sin(TAU * p), 0))
        claw = fingers(20 + 26 * max(0.0, math.cos(TAU * (p - 0.5))), 20 + 26 * max(0.0, math.cos(TAU * (p - 0.62))),
                       spread=10)
        return merge(base, R(**legs), R(**arms), spine, roll, claw)

    clip, st, samples = bake(rig, fn, 1.0, 24, True, ground="limbs",
                             post=lambda p: (0, 2.2 * max(0.0, math.cos(TAU * p)) ** 2, 0))
    stride = round(max(stride_of(rig, samples, "foot_r"), stride_of(rig, samples, "foot_l")) * 2.0, 2)
    stride = max(stride, GALLOP_STRIDE)
    clip.update(gait_extra(stride))
    st["stride"] = stride
    return clip, st


def gait_walk(rig):
    """Hunched stalking walk: long deliberate steps, rolling shoulders, head locked forward."""
    def fn(p):
        walk = rig.supplied("walk", 0.0, {"v.walk": 360.0 * p, "v.move": 1.0})
        walk = strip(walk, TAILSET)
        a = TAU * p
        upper = merge(R(chest=(4 + 2 * math.sin(2 * a), 9 * math.sin(a), 3 * math.sin(a)),
                        abdomen=(2, -4 * math.sin(a), 0), hips=(0, -3 * math.sin(a), 2.5 * math.sin(a)),
                        neck=(-6, -5 * math.sin(a), 0), head=(-2 - 2 * math.sin(2 * a), -4 * math.sin(a), -3 * math.sin(a))),
                      mirror_arm(arm_r=(-4 + 16 * math.sin(a + math.pi), 0, 3), forearm_r=(-10 - 10 * max(0.0, math.sin(a + 2.4)), 0, 0)),
                      R(arm_l=(-4 + 16 * math.sin(a), 0, 0), forearm_l=(-10 - 10 * max(0.0, math.sin(a - 0.7)), 0, 0)),
                      ripple(p * 2, 1.0, 16, base=8))
        return merge(walk, upper)

    clip, st, samples = bake(rig, fn, 1.0, 24, True, ground="feet")
    stride = round(max(stride_of(rig, samples, "foot_r"), stride_of(rig, samples, "foot_l")) * 2.0, 2)
    stride = min(max(stride, 1.6), 3.2)
    clip.update(gait_extra(stride))
    st["stride"] = stride
    return clip, st


def gait_creep(rig):
    """Low stalking crawl on knuckles (supplied crawl), head level and fixed on you."""
    def fn(p):
        c = strip(rig.supplied("crawl", 0.0, {"v.crawl": p}), TAILSET)
        return merge(c, R(neck=(-6, 0, 0), head=(-4 + 3 * math.sin(TAU * 2 * p), 0, 0)), ripple(p, 1.0, 14, base=10))

    clip, st, samples = bake(rig, fn, 1.0, 24, True, ground="limbs")
    stride = round(max(stride_of(rig, samples, "foot_r"), stride_of(rig, samples, "foot_l")) * 2.0, 2)
    stride = min(max(stride, 1.2), 2.6)
    clip.update(gait_extra(stride))
    st["stride"] = stride
    return clip, st


TUNNEL_TOP_PX = (1.92 / PX)  # body must stay under ~1.92 blocks in a 2-high tunnel
# spine pressed to the floor, legs splayed like a lizard's, arms swept back (v2-proven: < 2 blocks)
TUNNEL_DELTA = {"abdomen": (11.2, 0, 0), "chest": (-5.0, 0, 0), "neck": (-0.9, 0, 0), "head": (-13.1, 0, 0),
                "leg_r": (1.2, 0, 45.0), "leg_l": (1.2, 0, -45.0), "shin_r": (45.7, 0, 0), "shin_l": (45.7, 0, 0),
                "arm_r": (60.0, 0, 13.1), "arm_l": (60.0, 0, -13.1), "forearm_r": (-90.0, 0, -1.8),
                "forearm_l": (-90.0, 0, 1.8), "hand_r": (-15.5, 0, 0), "hand_l": (-15.5, 0, 0)}


def _tunnel_squash(p):
    a = TAU * p
    return merge(R(**TUNNEL_DELTA), R(chest=(0, 3 * math.sin(a), 0), neck=(5, 0, 0), head=(10 + 2 * math.sin(2 * a), 4 * math.sin(a), 0)))


def st_flat(rig):
    """Pressed flat: the tunnel crawl's still pose (also the ceiling cling, upside down)."""
    return merge(strip(rig.supplied("planted", 0.05), TAILSET), R(**TUNNEL_DELTA))


def gait_tunnel(rig):
    """Belly-crawl squeezed into a 2-high tunnel."""
    def fn(p):
        c = strip(rig.supplied("crawl", 0.0, {"v.crawl": p}), TAILSET)
        return merge(c, _tunnel_squash(p), ripple(p, 1.0, 10, base=8))

    clip, st, samples = bake(rig, fn, 1.0, 24, True, ground="limbs", floor=False)
    stride = round(max(stride_of(rig, samples, "foot_r"), stride_of(rig, samples, "foot_l")) * 2.0, 2)
    stride = min(max(stride, 1.0), 2.4)
    clip.update(gait_extra(stride))
    st["stride"] = stride
    return clip, st


# The squeeze: through a 1-high gap its whole body is crushed flat (root scale) over the
# belly-crawl, limbs splayed, head rolled sideways.  The collision box is 0.9 high.
SQUEEZE_SCALE = (1.16, 0.5, 1.08)


def gait_squeeze(rig):
    """Forcing itself through a 1-high gap: the belly-crawl crushed flat, heaving in pulses."""
    def fn(p):
        a = TAU * p
        c = strip(rig.supplied("crawl", 0.0, {"v.crawl": p}), TAILSET)
        pulse = 0.04 * math.sin(2 * a)  # it heaves: the squash breathes as it drags itself along
        squash = {"root": {"scale": np.array([SQUEEZE_SCALE[0] - pulse, SQUEEZE_SCALE[1] + 0.5 * pulse, SQUEEZE_SCALE[2]])}}
        return merge(c, _tunnel_squash(p), R(head=(4, 6 * math.sin(a), 14 + 6 * math.sin(a))), ripple(p, 1.0, 10, base=8), squash)

    clip, st, samples = bake(rig, fn, 1.0, 24, True, ground="limbs", floor=False)
    stride = round(max(stride_of(rig, samples, "foot_r"), stride_of(rig, samples, "foot_l")) * 2.0, 2)
    stride = min(max(stride, 0.8), 1.6)
    clip.update(gait_extra(stride))
    st["stride"] = stride
    return clip, st


# ------------------------------------------------------------------ IDLES / persistent acts (looping, alive)
def idle_prowl(rig):
    """Standing hunched: heavy breathing, scanning head with bird-like snaps, a full-body shudder."""
    L = 8.0

    def fn(t):
        scan = 26 * wave(t, L)
        sn = twitch(t, 2.0, 5, 1.0, hold=0.2)
        shud = bump(t, 5.0, 5.08, 5.45, 5.6) * shiver(t, 13, 1)
        sway = wave(t, L, 0.25)
        return merge(breath(t, 2.0, 5.0),
                     R(head=(-3 + 4 * wave(t, 3.1) + 8 * shud, scan + 34 * sn, 22 * sn + 3 * wave(t, 2.3)),
                       neck=(2 + 5 * shud, scan * 0.35 + 6 * sn, 4 * sn),
                       chest=(3 * shud, 4 * sway, 2 * sway + 3 * shud), hips=(0, 0, 3 * sway),
                       leg_r=(0, 0, 2 * sway), leg_l=(0, 0, 2 * sway)),
                     mirror_arm(arm_r=(5 * wave(t, 4.0), 0, 2 + 3 * shud), forearm_r=(-8 + 6 * wave(t, 2.6), 0, 0)),
                     ripple(t, 0.7, 22, base=6))

    return bake(rig, fn, L, 12, True, ground="feet")


def idle_low(rig):
    """Folded on its knuckles: heaving back, head craned up and scanning, fingers drumming."""
    L = 6.0
    base = st_low(rig)

    def fn(t):
        s = wave(t, 1.5)
        sn = twitch(t, 1.5, 3, 1.0, hold=0.25)
        drum = {}
        for i, f in enumerate(FINGERS_R):
            k = max(0.0, math.sin((t * 2.5 - i * 0.16) * TAU)) ** 6
            drum[f] = (0, 0, -24 * k)
        for i, f in enumerate(FINGERS_L):
            k = max(0.0, math.sin((t * 2.5 - 0.5 - i * 0.16) * TAU)) ** 6
            drum[f] = (0, 0, 24 * k)
        return merge(base, R(chest=(-7 * s, 0, 0), abdomen=(-4 * s, 0, 0), hips=(2 * s, 0, 0),
                             head=(-12 + 5 * wave(t, 2.2), 32 * wave(t, L) + 30 * sn, 16 * sn),
                             neck=(-10, 10 * wave(t, L), 0)),
                     R(**drum), POS(mane_body=(0, 0.9 * (s + 1) / 2, 0)))

    return bake(rig, fn, L, 12, True, ground="limbs")


def idle_tunnel(rig):
    L = 4.0

    def fn(t):
        c = st_flat(rig)
        s = wave(t, 1.6)
        return merge(c, R(chest=(-4 * s, 0, 0), head=(-6, 24 * wave(t, L), 10 * twitch(t, 2.0, 9, 1.0))),
                     ripple(t, 0.9, 16, base=6))

    return bake(rig, fn, L, 12, True, ground="limbs", floor=False)


def act_watch(rig):
    """The stare: weight forward, head jutting at you, slowly tilting past natural then snapping back."""
    L = 6.0

    def fn(t):
        tilt = ease_io(seg(t, 0.4, 3.2)) * (1 - ease_out(seg(t, 4.2, 4.35)))
        snap = bump(t, 4.2, 4.27, 4.5, 4.9)
        sh = shiver(t, 11, 2) * (0.4 + 0.6 * bump(t, 4.25, 4.35, 4.8, 5.3))
        return merge(breath(t, 1.6, 6.0),
                     R(chest=(8, 0, 0), neck=(-12, 0, 6 * tilt), head=(-6 + 2 * sh, 6 * sh - 22 * snap, 44 * tilt + 3 * sh),
                       leg_r=(-6, 0, 0), leg_l=(-6, 0, 0), shin_r=(10, 0, 0), shin_l=(10, 0, 0)),
                     mirror_arm(arm_r=(-10 + 4 * wave(t, 2.0), 0, 6), forearm_r=(-14, 0, 0)),
                     ripple(t, 1.3, 30, base=-6, spread=0.22))

    return bake(rig, fn, L, 15, True, ground="feet")


def act_watch_low(rig):
    """Crouched like a cat before the pounce: rump swaying, head dead still and fixed on you."""
    L = 3.0
    base = st_low(rig)

    def fn(t):
        sw = wave(t, 1.5)
        return merge(base, R(hips=(0, 4 * sw, 5 * sw), abdomen=(0, -3 * sw, -2 * sw), chest=(-4 + 3 * wave(t, 1.0), -2 * sw, 0),
                             neck=(-24, 2 * sw, 0), head=(-14, 1.5 * sw, 8 + 3 * shiver(t, 7))),
                     ripple(t, 1.0, 20, base=4, spread=0.25), POS(mane_body=(0, 0.5 * (wave(t, 1.0) + 1), 0)))

    return bake(rig, fn, L, 15, True, ground="limbs")


def act_tall(rig):
    """Unfolded to full height, looming, head tipped down at you, rocking, arms hanging past its knees."""
    L = 6.0
    base = st_tall()

    def fn(t):
        rock = wave(t, 3.0)
        roll = 30 * ease_io(seg(t, 1.0, 3.0)) * (1 - ease_io(seg(t, 4.6, 5.2)))
        sh = shiver(t, 9, 4) * bump(t, 3.0, 3.1, 3.6, 3.9)
        return merge(base, breath(t, 2.2, 6.0),
                     R(hips=(2 * rock, 0, 0), chest=(2 * rock + 4 * sh, 0, 0), head=(4 + 3 * sh, 4 * sh, roll), neck=(0, 0, roll * 0.2)),
                     mirror_arm(arm_r=(4 * wave(t, 3.0, 0.3), 0, 2), forearm_r=(-4, 0, 0)),
                     ripple(t, 0.8, 26, base=-10, spread=0.2))

    return bake(rig, fn, L, 15, True, ground="feet")


def act_peek(rig, side):
    """Leaning out from cover: body bent sideways, a hand gripping the edge, head cocked the wrong way."""
    sgn = 1 if side == "r" else -1
    L = 4.0

    def fn(t):
        bob = wave(t, 2.0)
        tw = twitch(t, 1.3, 11 if side == "r" else 12, 1.0, hold=0.3)
        body = R(hips=(0, 0, 6 * sgn), abdomen=(0, 0, 14 * sgn), chest=(8, 10 * sgn, 26 * sgn + 3 * bob),
                 neck=(0, 0, 8 * sgn), head=(-6 + 3 * bob, -18 * sgn + 12 * tw, -30 * sgn - 18 * tw * sgn))
        arm = side
        grip = R(**{"arm_" + arm: (-48, 0, 52 * sgn), "forearm_" + arm: (-46, 0, 0), "hand_" + arm: (-10, 0, 0)})
        tap = {}
        fl = FINGERS_R if side == "r" else FINGERS_L
        for i, f in enumerate(fl):
            k = max(0.0, math.sin((t * 1.5 - i * 0.12) * TAU)) ** 8
            tap[f] = (0, 0, -sgn * (30 + 25 * k))
        return merge(body, grip, R(**tap), fingers(0 if side == "r" else 10, 10 if side == "r" else 0),
                     R(leg_r=(0, 0, -6 * sgn), leg_l=(0, 0, -6 * sgn)), breath(t, 1.8, 3.0))

    return bake(rig, fn, L, 15, True, ground="feet")


CLING_H = 2.6 / PX  # px: ceiling height above the entity origin while clinging


def _cling_pose(rig, t):
    """Spread on the ceiling like a spider, back to the floor, face rolled upright to watch you."""
    base = st_flat(rig)
    s = wave(t, 1.8)
    regrip = bump(t, 2.0, 2.15, 2.45, 2.7)
    return merge(base,
                 R(chest=(-5 * s, 0, 0), neck=(-24, 0, 0), head=(-44 + 6 * wave(t, 2.5), 26 * wave(t, 5.0), 150 + 16 * twitch(t, 1.7, 21, 1.0)),
                   jaw=(10 + 8 * wave(t, 1.3), 0, 0),
                   arm_r=(-40 * regrip, 0, -18 * regrip), forearm_r=(30 * regrip, 0, 0)),
                 ripple(t, 0.9, 24, base=10),
                 R(root=(0, 0, 180)))


def act_cling(rig):
    L = 5.0

    def fn(t):
        return _cling_pose(rig, t)

    def post(t):
        pose = to_np(_cling_pose(rig, t))
        top = rig.geo.bounds(strip(pose, TAILSET), FEET + HANDS)[1][1]
        return (0, CLING_H - top, 0)

    return bake(rig, fn, L, 12, True, ground=None, post=post, floor=False)


def act_climb(rig):
    """Scaling a wall it faces: arms hauling hand over hand, legs kicking for holds."""
    L = 1.0

    def fn(t):
        a = TAU * t
        armr, arml = math.sin(a), math.sin(a + math.pi)
        return merge(R(hips=(-4, 0, 0), abdomen=(-6, 0, 0), chest=(-4, 6 * math.sin(a), 0), neck=(-16, 0, 0),
                       head=(-24 + 4 * math.sin(2 * a), -6 * math.sin(a), 0),
                       arm_r=(-150 - 22 * armr, 0, 16), forearm_r=(-28 - 30 * max(0.0, -armr), 0, 0), hand_r=(-20, 0, 0),
                       arm_l=(-150 - 22 * arml, 0, -16), forearm_l=(-28 - 30 * max(0.0, -arml), 0, 0), hand_l=(-20, 0, 0),
                       leg_r=(-50 - 26 * math.sin(a + 1.2), 0, 8), shin_r=(70 + 20 * math.sin(a + 1.2), 0, 0),
                       leg_l=(-50 - 26 * math.sin(a + 1.2 + math.pi), 0, -8), shin_l=(70 + 20 * math.sin(a + 1.2 + math.pi), 0, 0)),
                     fingers(50 + 20 * max(0.0, armr), 50 + 20 * max(0.0, arml)), POS(root=(0, 0, -2.5)))

    return bake(rig, fn, L, 20, True, ground=None)


def act_hold(rig):
    """Holding you up to its face: shaking you, head tilting to inspect, jaw working."""
    L = 2.0
    base = st_hold()

    def fn(t):
        s = math.sin(t / L * TAU * 4)
        insp = 26 * wave(t, L) + 18 * twitch(t, 1.0, 31, 1.0, hold=0.25)
        return merge(base, mirror_arm(arm_r=(8 * s, 0, 0), forearm_r=(-5 * s, 0, 0)),
                     R(chest=(3 * s, 0, 0), head=(5 * shiver(t, 6), 8 * math.sin(t * 5), insp),
                       jaw=(12 * max(0.0, math.sin(t * TAU * 1.5)) + 4 * shiver(t, 9), 0, 0)))

    return bake(rig, fn, L, 20, True, ground="feet")


def act_sniff(rig):
    """Searching: face to the ground, sweeping, short hard sniffs, a sudden head-up listen."""
    L = 4.0
    base = st_low(rig)

    def fn(t):
        sweep = 36 * wave(t, L)
        sn = sum(bump(t, s, s + 0.05, s + 0.08, s + 0.16) for s in (0.6, 0.85, 1.1, 2.3, 2.5, 2.7))
        up = bump(t, 3.0, 3.1, 3.5, 3.8)
        return merge(base, R(chest=(10 - 14 * up, 0, 0), neck=(14 - 30 * up, sweep * 0.3, 0),
                             head=(30 - 6 * sn - 40 * up, sweep * (1 - up), 10 * wave(t, 1.3) + 20 * up), jaw=(5 * sn, 0, 0)),
                     ripple(t, 1.2, 16, base=6))

    return bake(rig, fn, L, 15, True, ground="limbs")


def act_stunned(rig):
    """Reeling: staggering, a hand clawing at its own face, head wobbling."""
    L = 2.4

    def fn(t):
        wob = wave(t, L)
        return merge(R(hips=(0, 0, 6 * wob), chest=(10, 8 * wob, -8 * wob), neck=(6, 0, 10 * wob),
                       head=(16 + 6 * wave(t, 0.8), 20 * wave(t, 1.2), 24 * wob), leg_r=(-10 * wob, 0, 4), leg_l=(10 * wob, 0, -4)),
                     R(arm_r=(-120, 20, 30), forearm_r=(-86 + 10 * wave(t, 0.6), 0, 0), hand_r=(-10, 0, 0)),
                     R(arm_l=(-20, 0, -30 - 10 * wob), forearm_l=(-20, 0, 0)), fingers(30 + 20 * wave(t, 0.5), -10), breath(t, 0.8, 5.0))

    return bake(rig, fn, L, 15, True, ground="feet")


def act_savor(rig):
    """Standing over its victim: head low, sniffing, a shudder of pleasure, then craning up to shriek."""
    L = 3.0

    def fn(t):
        sn = sum(bump(t, s, s + 0.04, s + 0.07, s + 0.14) for s in (0.3, 0.5, 0.7, 1.3, 1.45))
        up = bump(t, 1.9, 2.15, 2.5, 2.9)
        sh = shiver(t, 12, 6) * bump(t, 1.0, 1.1, 1.6, 1.8)
        return merge(R(hips=(10, 0, 0), abdomen=(14, 0, 0), chest=(26 - 30 * up, 0, 4 * sh), neck=(18 - 40 * up, 0, 0),
                       head=(34 - 6 * sn - 30 * up + 4 * sh, 10 * wave(t, 1.5), 12 * sh), jaw=(6 * sn + 50 * up, 0, 0),
                       leg_r=(-30, 0, 6), leg_l=(-30, 0, -6), shin_r=(46, 0, 0), shin_l=(46, 0, 0)),
                     mirror_arm(arm_r=(-30, 0, 30 + 20 * up), forearm_r=(-40, 0, 0)), fingers(-10, -10, spread=14))

    return bake(rig, fn, L, 15, True, ground="limbs")


def act_huddle(rig):
    """Balled up in the dark like a heap of rock and hair: back heaving, head buried."""
    L = 4.0
    base = st_low(rig)

    def fn(t):
        s = wave(t, 2.0)
        return merge(base, R(hips=(18, 0, 0), abdomen=(14 - 4 * s, 0, 0), chest=(30 - 6 * s, 0, 0), neck=(30, 0, 0), head=(36, 0, 6),
                             leg_r=(-24, 0, 8), leg_l=(-24, 0, -8), shin_r=(24, 0, 0), shin_l=(24, 0, 0)),
                     mirror_arm(arm_r=(-60, 0, -60), forearm_r=(-80, 0, 0)), fingers(40, 40),
                     POS(mane_body=(0, 1.2 * (s + 1) / 2, 0)))

    return bake(rig, fn, L, 12, True, ground="limbs")


def act_bash(rig):
    """Hammering a door with both fists in turn."""
    L = 0.9

    def fn(t):
        def fist(ph):
            x = (t / L + ph) % 1.0
            return ease_in(seg(x, 0.0, 0.18)) if x < 0.18 else 1 - ease_io(seg(x, 0.18, 0.5))
        r, l = fist(0.0), fist(0.5)
        return merge(R(chest=(14 + 6 * (r + l), 10 * (r - l), 0), head=(4, 0, 0), jaw=(20, 0, 0),
                       leg_r=(-14, 0, 4), leg_l=(4, 0, -4), shin_r=(24, 0, 0)),
                     R(arm_r=(-140 + 100 * r, 0, 16), forearm_r=(-40 + 30 * r, 0, 0)),
                     R(arm_l=(-140 + 100 * l, 0, -16), forearm_l=(-40 + 30 * l, 0, 0)), fingers(60, 60))

    return bake(rig, fn, L, 30, True, ground="feet")


def act_reach_in(rig):
    """Pressed flat to a gap you crawled into, one long arm groping inside for you."""
    L = 1.6
    base = st_flat(rig)

    def fn(t):
        g = wave(t, L)
        return merge(base,
                     R(chest=(16, -10, 0), neck=(-10, 0, 0), head=(-6, -14, -20),
                       arm_r=(-70 - 8 * g, -14, -60), forearm_r=(-6 + 8 * g, 0, 0), hand_r=(20 * g, 0, 0)),
                     fingers(30 + 40 * max(0.0, math.sin(t / L * TAU * 2)), 30, spread=14))

    return bake(rig, fn, L, 15, True, ground="limbs", floor=False)


def act_listen(rig):
    """Frozen mid-step, head cocked, then three sharp head turns toward a sound."""
    L = 4.0
    base = st_low(rig)

    def fn(t):
        turns = [(0.0, 0.0), (1.0, 40.0), (1.8, -35.0), (2.6, 10.0), (3.6, 0.0)]
        y = 0.0
        for (t0, a0), (t1, a1) in zip(turns, turns[1:]):
            if t >= t0:
                y = a0 + (a1 - a0) * ease_out(seg(t, t0, t0 + 0.12))
        return merge(base, R(neck=(-30, y * 0.3, 0), head=(-20, y, 24 + 3 * shiver(t, 8))), ripple(t, 0.5, 8, base=8))

    return bake(rig, fn, L, 20, True, ground="limbs")


def act_death(rig):
    """Collapses forward onto its face; the limbs keep twitching for a while."""
    L = 2.4

    def fn(t):
        fall = ease_in(seg(t, 0.0, 0.9))
        tw = shiver(t, 9, 3) * bump(t, 1.0, 1.1, 1.8, 2.4)
        return merge(R(hips=(40 * fall, 0, 10 * fall), abdomen=(20 * fall, 0, 0), chest=(30 * fall, 0, 10 * fall),
                       neck=(10 * fall, 0, 0), head=(20 * fall + 8 * tw, 30 * fall, 40 * fall), jaw=(40 * fall, 0, 0),
                       leg_r=(-40 * fall, 0, 20 * fall), shin_r=(90 * fall, 0, 0), leg_l=(-70 * fall, 0, -10 * fall),
                       shin_l=(100 * fall, 0, 0)),
                     R(arm_r=(-150 * fall, 0, 60 * fall + 10 * tw), arm_l=(-100 * fall, 0, -70 * fall), forearm_l=(-20 * fall, 0, 0)),
                     fingers(30 * fall + 30 * tw, 50 * fall))

    return bake(rig, fn, L, 15, "hold_on_last_frame", ground="limbs")


def act_behind(rig):
    """What you see when you turn around: crouched right there, head on its side, one hand lifted."""
    L = 3.0
    base = st_low(rig)

    def fn(t):
        return merge(base, R(neck=(-30, 0, 0), head=(-20 + 3 * shiver(t, 5), 6 * wave(t, 1.5), 64 + 6 * wave(t, 3.0)), chest=(-14, 0, 0)),
                     R(arm_r=(-70, 0, 20), forearm_r=(-30 + 6 * wave(t, 1.0), 0, 0)), fingers(-16 + 20 * max(0.0, wave(t, 0.7)), 30, spread=16))

    return bake(rig, fn, L, 15, True, ground="feet")


def act_neck(rig):
    """Neck stretched toward you; the head stays level, jaw sagging, shivering."""
    L = 3.0

    def fn(t):
        tr = shiver(t, 10, 7)
        return merge(R(chest=(14, 0, 0), neck=(-34, 0, 0), head=(20 + 2 * tr, 3 * tr, 8 + 10 * wave(t, 3.0)), jaw=(18 + 6 * wave(t, 1.0), 0, 0)),
                     POS(neck=(0, 2.8, -4.6), head=(0, 1.4, -2.6)),
                     mirror_arm(arm_r=(-14, 0, 6), forearm_r=(-20, 0, 0)), ripple(t, 1.0, 20, base=16))

    return bake(rig, fn, L, 15, True, ground="feet")


def act_reach(rig):
    """Mid-step, one arm reaching for you, head cocked (the echo's favourite)."""
    L = 3.0

    def fn(t):
        return merge(R(chest=(14, -10, 4), abdomen=(6, 0, 0), head=(-14 + 3 * shiver(t, 6), 10, 30 + 8 * wave(t, 3.0)), neck=(-6, 0, 8),
                       leg_l=(-26, 0, 0), shin_l=(36, 0, 0), foot_l=(-10, 0, 0)),
                     R(arm_r=(-92 + 4 * wave(t, 1.5), 0, 8), forearm_r=(-8, 0, 0), hand_r=(-12, 0, 0)), R(arm_l=(10, 0, -6), forearm_l=(-10, 0, 0)),
                     fingers(-14 + 20 * max(0.0, wave(t, 1.0)), 28, spread=14))

    return bake(rig, fn, L, 15, True, ground="feet")


# ------------------------------------------------------------------ ONE-SHOTS (played by script with playAnimation)
def gallop_rest():
    """The gallop base at mid-stride: start/end pose of mid-chase one-shots."""
    return st_gallop()


def shot_scream(rig):
    """The wail: unfolds to full height, arches back to draw breath, lunges its face forward and screams
    with its whole body shaking, then drops onto all fours."""
    L = 1.9
    tall = st_tall()
    gal = gallop_rest()

    def fn(t):
        rise = ease_io(seg(t, 0.0, 0.35))
        back = bump(t, 0.2, 0.42, 0.5, 0.62)
        fwd = bump(t, 0.5, 0.62, 1.45, 1.62)
        drop = ease_io(seg(t, 1.5, 1.9))
        shake = shiver(t, 13, 1) * fwd
        body = lerp(lerp(R(), tall, rise), gal, drop)
        return merge(body,
                     scale(R(chest=(-8, 0, 0), abdomen=(-4, 0, 0), head=(-30, 0, 0), neck=(-10, 0, 0), jaw=(30, 0, 0)), back),
                     scale(merge(R(chest=(18, 0, 0), neck=(-22, 0, 0), head=(-4, 0, 0), jaw=(62, 0, 0)), POS(jaw=(0, -2.0, 0.6))), fwd),
                     scale(mirror_arm(arm_r=(-50, 0, 78), forearm_r=(-20, 0, 0)), max(back, fwd) * (1 - drop)),
                     R(head=(5 * shake, 4 * shake, 3 * shake), chest=(2 * shake, 0, 0), neck=(0, 0, 2 * shake)),
                     scale(fingers(-24, -24, spread=20), max(back, fwd)))

    return bake(rig, fn, L, 24, False, ground="feet")


def shot_roar(rig):
    """Mid-chase roar: rears its head up and forward, jaw wide, shaking, then charges on."""
    L = 1.1
    gal = gallop_rest()

    def fn(t):
        k = bump(t, 0.0, 0.18, 0.8, 1.05)
        shake = shiver(t, 14, 2) * bump(t, 0.18, 0.25, 0.75, 0.9)
        return merge(gal, scale(merge(R(hips=(-8, 0, 0), chest=(-18, 0, 0), neck=(-6, 0, 0), head=(-14, 0, 0), jaw=(58, 0, 0)),
                                      POS(jaw=(0, -1.8, 0.5)), mirror_arm(arm_r=(-10, 0, 24)), fingers(-10, -10, spread=16)), k),
                     R(head=(5 * shake, 4 * shake, 3 * shake), chest=(2 * shake, 0, 0)))

    return bake(rig, fn, L, 24, False, ground="limbs")


def shot_swipe(rig, side):
    """Rears out of the charge and rakes one arm across at chest height; impact at 0.28 s."""
    L = 0.62
    gal = gallop_rest()
    sgn = 1 if side == "r" else -1
    s = side
    o = "l" if side == "r" else "r"

    def fn(t):
        up = bump(t, 0.0, 0.14, 0.36, 0.62)
        wind = ease_out(seg(t, 0.0, 0.16)) * (1 - ease_in(seg(t, 0.16, 0.28)))
        strike = ease_in(seg(t, 0.16, 0.28)) * (1 - ease_io(seg(t, 0.36, 0.62)))
        torso = R(hips=(-10 * up, 0, 0), abdomen=(-8 * up, 0, 0), chest=(-14 * up, (-24 * wind + 30 * strike) * sgn, 0),
                  neck=(14 * up, 0, 0), head=(4 * up, (12 * wind - 16 * strike) * sgn, 0), jaw=(40 * max(wind, strike), 0, 0))
        arm = R(**{"arm_" + s: (-90 * wind - 70 * strike, 0, (70 * wind - 30 * strike) * sgn),
                   "forearm_" + s: (-50 * wind - 4 * strike, 0, 0), "hand_" + s: (-20 * wind + 10 * strike, 0, 0)})
        other = R(**{"arm_" + o: (-20 * up, 0, -20 * up * sgn)})
        claw = fingers(-30 * max(wind, strike), 0, spread=20 * strike) if side == "r" else fingers(0, -30 * max(wind, strike), spread=20 * strike)
        return merge(gal, torso, arm, other, claw)

    return bake(rig, fn, L, 30, False, ground="limbs")


def shot_combo(rig):
    """Right then left: two rakes, impacts at 0.28 s and 0.62 s."""
    L = 1.0
    gal = gallop_rest()

    def fn(t):
        def sw(t0, side):
            sgn = 1 if side == "r" else -1
            tt = t - t0
            wind = ease_out(seg(tt, 0.0, 0.16)) * (1 - ease_in(seg(tt, 0.16, 0.28)))
            strike = ease_in(seg(tt, 0.16, 0.28)) * (1 - ease_io(seg(tt, 0.32, 0.5)))
            return merge(R(chest=(0, (-24 * wind + 30 * strike) * sgn, 0), head=(0, (12 * wind - 16 * strike) * sgn, 0),
                           jaw=(40 * max(wind, strike), 0, 0)),
                         R(**{"arm_" + side: (-90 * wind - 70 * strike, 0, (70 * wind - 30 * strike) * sgn),
                              "forearm_" + side: (-50 * wind - 4 * strike, 0, 0)}))
        up = bump(t, 0.0, 0.14, 0.75, 1.0)
        return merge(gal, R(hips=(-10 * up, 0, 0), abdomen=(-8 * up, 0, 0), chest=(-14 * up, 0, 0), neck=(14 * up, 0, 0)),
                     sw(0.0, "r"), sw(0.34, "l"), fingers(-24 * up, -24 * up, spread=18 * up))

    return bake(rig, fn, L, 30, False, ground="limbs")


def shot_slam(rig):
    """Rears to full height with both fists overhead and brings them down; impact at 0.52 s."""
    L = 1.05
    gal = gallop_rest()
    tall = st_tall()

    def fn(t):
        rear = ease_out(seg(t, 0.0, 0.36)) * (1 - ease_in(seg(t, 0.4, 0.52)))
        down = ease_in(seg(t, 0.4, 0.52)) * (1 - ease_io(seg(t, 0.7, 1.05)))
        body = lerp(gal, tall, rear)
        return merge(body,
                     scale(merge(R(chest=(4, 0, 0), head=(-16, 0, 0), jaw=(50, 0, 0)), mirror_arm(arm_r=(-165, 0, 10), forearm_r=(-20, 0, 0))), rear),
                     scale(merge(R(hips=(10, 0, 0), chest=(40, 0, 0), neck=(-10, 0, 0), head=(-10, 0, 0), jaw=(30, 0, 0),
                                   leg_r=(-30, 0, 0), leg_l=(-30, 0, 0), shin_r=(50, 0, 0), shin_l=(50, 0, 0)),
                                 mirror_arm(arm_r=(-60, 0, 0), forearm_r=(-10, 0, 0))), down),
                     fingers(60 * max(rear, down), 60 * max(rear, down)))

    return bake(rig, fn, L, 30, False, ground="feet")


def shot_pounce(rig):
    """Gathers, launches with arms thrown forward (the script supplies the arc), lands and absorbs."""
    L = 1.0
    gal = gallop_rest()

    def fn(t):
        gather = bump(t, 0.0, 0.18, 0.2, 0.3)
        air = bump(t, 0.22, 0.34, 0.6, 0.72)
        land = bump(t, 0.62, 0.72, 0.8, 1.0)
        return merge(gal,
                     scale(R(hips=(10, 0, 0), chest=(10, 0, 0), leg_r=(-20, 0, 0), leg_l=(-20, 0, 0), shin_r=(30, 0, 0), shin_l=(30, 0, 0)), gather),
                     scale(merge(R(hips=(14, 0, 0), abdomen=(4, 0, 0), chest=(6, 0, 0), neck=(-20, 0, 0), head=(-12, 0, 0), jaw=(55, 0, 0),
                                   leg_r=(70, 0, 0), leg_l=(64, 0, 0), shin_r=(-26, 0, 0), shin_l=(-16, 0, 0), foot_r=(30, 0, 0), foot_l=(30, 0, 0)),
                                 mirror_arm(arm_r=(-100, 0, 22), forearm_r=(10, 0, 0)), fingers(-30, -30, spread=24)), air),
                     scale(R(hips=(12, 0, 0), chest=(14, 0, 0), leg_r=(-24, 0, 0), leg_l=(-24, 0, 0), shin_r=(40, 0, 0), shin_l=(40, 0, 0)), land))

    return bake(rig, fn, L, 30, False, ground="lift")


def shot_lunge_grab(rig):
    """Lunges out of the charge and closes both hands around you; ends in the hold pose."""
    L = 0.5
    gal = gallop_rest()
    hold = st_hold()

    def fn(t):
        reach = ease_out(seg(t, 0.0, 0.28))
        close = ease_in(seg(t, 0.26, 0.5))
        k = ease_io(seg(t, 0.0, 0.5))
        body = lerp(gal, hold, k)
        return merge(body, scale(mirror_arm(arm_r=(-30, 0, 30), forearm_r=(20, 0, 0)), reach * (1 - close)),
                     scale(fingers(-60, -60, spread=24), reach * (1 - close)), R(jaw=(30 * reach, 0, 0)))

    return bake(rig, fn, L, 30, False, ground="feet")


def shot_throw(rig):
    """Flings you aside (release at 0.3 s) and drops back to all fours."""
    L = 0.75
    hold = st_hold()
    fling = merge(R(chest=(10, -46, 0), abdomen=(4, -16, 0), head=(-10, 30, 0), jaw=(30, 0, 0)),
                  R(arm_r=(-40, 0, 92), forearm_r=(-10, 0, 0), arm_l=(-110, 0, 20), forearm_l=(-20, 0, 0)), fingers(-20, -20, spread=16))
    gal = gallop_rest()

    def fn(t):
        return lerp(lerp(hold, fling, ease_out(seg(t, 0.0, 0.32))), gal, ease_io(seg(t, 0.4, 0.75)))

    return bake(rig, fn, L, 30, False, ground="feet")


def shot_smash(rig):
    """Lifts you overhead and smashes you into the ground (release at 0.5 s)."""
    L = 1.0
    hold = st_hold()
    over = merge(R(chest=(-14, 0, 0), abdomen=(-8, 0, 0), head=(-26, 0, 0), jaw=(50, 0, 0)), mirror_arm(arm_r=(-172, 8, 8), forearm_r=(-16, 0, 0)), fingers(55, 55))
    down = merge(R(hips=(14, 0, 0), abdomen=(14, 0, 0), chest=(40, 0, 0), neck=(-14, 0, 0), jaw=(40, 0, 0),
                   leg_r=(-34, 0, 0), leg_l=(-34, 0, 0), shin_r=(56, 0, 0), shin_l=(56, 0, 0)),
                 mirror_arm(arm_r=(-50, 0, 6), forearm_r=(-10, 0, 0)), fingers(10, 10))
    gal = gallop_rest()

    def fn(t):
        p = lerp(hold, over, ease_io(seg(t, 0.0, 0.36)))
        p = lerp(p, down, ease_in(seg(t, 0.36, 0.5)))
        return lerp(p, gal, ease_io(seg(t, 0.62, 1.0)))

    return bake(rig, fn, L, 30, False, ground="feet")


def shot_bite(rig):
    """Pulls you to its mouth, jaw unhinged, and bites (snap at 0.38 s), shaking its head; lets go."""
    L = 0.95
    hold = st_hold()
    gal = gallop_rest()

    def fn(t):
        pull = bump(t, 0.0, 0.2, 0.6, 0.8)
        gape = bump(t, 0.1, 0.3, 0.34, 0.38)
        shake = shiver(t, 12, 5) * bump(t, 0.38, 0.42, 0.62, 0.75)
        p = merge(hold, scale(merge(mirror_arm(arm_r=(10, 0, 0), forearm_r=(-40, 0, 0)), R(neck=(-10, 0, 0), head=(14, 0, 0))), pull),
                  merge(scale(merge(R(jaw=(55, 0, 0)), POS(jaw=(0, -2.2, 0.6))), gape), R(jaw=(-25 * (1 - gape) * pull, 0, 0))),
                  R(head=(4 * shake, 14 * shake, 8 * shake), neck=(0, 6 * shake, 0)))
        return lerp(p, gal, ease_io(seg(t, 0.7, 0.95)))

    return bake(rig, fn, L, 30, False, ground="feet")


def shot_flinch(rig):
    """PARTIAL (additive): recoils from a hit and shakes it off."""
    L = 0.4

    def fn(t):
        k = bump(t, 0.0, 0.06, 0.12, 0.4)
        return scale(merge(R(chest=(-16, 6, 0), neck=(-10, 0, 0), head=(-18, 14, 10), jaw=(24, 0, 0)), mirror_arm(arm_r=(-20, 0, 18))), k)

    clip, st, _ = bake(rig, fn, L, 30, False, ground=None)
    return clip, st, None


def shot_drop(rig):
    """Lets go of the ceiling: flips upright on the way down and lands in a crouch."""
    L = 0.8
    low = st_low(rig)

    def fn(t):
        k = ease_io(seg(t, 0.0, 0.32))
        p = _cling_pose(rig, 0.0)
        p = strip(p, {"root"})
        body = lerp(p, merge(strip(low, TAILSET), R(head=(-30, 0, 0), jaw=(40, 0, 0))), k)
        land = bump(t, 0.5, 0.6, 0.65, 0.8)
        return merge(body, R(root=(0, 0, 180 * (1 - k))), scale(R(chest=(14, 0, 0), hips=(8, 0, 0)), land))

    def post(t):
        k = ease_io(seg(t, 0.0, 0.32))
        pose = to_np(_cling_pose(rig, 0.0))
        top = rig.geo.bounds(strip(pose, TAILSET), FEET + HANDS)[1][1]
        return (0, (CLING_H - top) * (1 - k), 0)

    return bake(rig, fn, L, 30, False, ground=None, post=post, floor=False)


def shot_rise(rig):
    """Unfolds from the crouch to its full height (the stand-off's last warning)."""
    L = 1.1
    low = st_low(rig)
    tall = st_tall()

    def fn(t):
        k = ease_io(seg(t, 0.0, 1.0))
        tr = shiver(t, 10, 3) * 0.6
        return merge(lerp(low, tall, k), R(head=(-10 * bump(t, 0.4, 0.7, 0.8, 1.1) + tr, 0, tr)),
                     scale(mirror_arm(arm_r=(-20, 0, 40)), bump(t, 0.3, 0.6, 0.8, 1.1)), fingers(-20 * k, -20 * k, spread=16 * k))

    return bake(rig, fn, L, 24, False, ground="feet")


def shot_howl(rig):
    """Lost you: rears up, beats the ground with both fists, throws its head back and howls."""
    L = 1.8
    low = st_low(rig)

    def fn(t):
        up = bump(t, 0.0, 0.3, 0.45, 0.6)
        slam = bump(t, 0.5, 0.6, 0.8, 1.0)
        howl = bump(t, 0.95, 1.2, 1.55, 1.8)
        shake = shiver(t, 9, 8) * slam
        return merge(low,
                     scale(merge(R(chest=(-40, 0, 0), abdomen=(-20, 0, 0), hips=(-10, 0, 0), head=(-20, 0, 0), jaw=(40, 0, 0)),
                                 mirror_arm(arm_r=(-120, 0, 30))), up),
                     scale(merge(R(chest=(14, 0, 0), head=(10, 0, 0), jaw=(30, 0, 0)), mirror_arm(arm_r=(-20, 0, -10))), slam),
                     scale(R(chest=(-30, 0, 0), neck=(-20, 0, 0), head=(-40, 0, 0), jaw=(60, 0, 0)), howl),
                     R(head=(0, 12 * shake, 6 * shake)))

    return bake(rig, fn, L, 24, False, ground="limbs")


def shot_knock(rig):
    """Three slow knocks with the knuckles of one hand."""
    L = 1.2

    def fn(t):
        k = sum(bump(t, s, s + 0.06, s + 0.08, s + 0.2) for s in (0.2, 0.5, 0.8))
        reach = bump(t, 0.0, 0.15, 1.0, 1.2)
        return merge(R(chest=(10 * reach, 0, 0), head=(6, 0, 20 * reach)),
                     R(arm_r=(-80 * reach - 14 * k, 0, 10), forearm_r=(-40 * reach + 20 * k, 0, 0)), fingers(70 * reach, 0))

    return bake(rig, fn, L, 30, False, ground="feet")


def shot_turn(rig):
    """Whips round from the huddle to face you (the script has already turned the body)."""
    L = 0.55
    hud = act_huddle_pose(rig, 0.0)
    gal = gallop_rest()

    def fn(t):
        k = ease_out(seg(t, 0.0, 0.3))
        p = lerp(hud, gal, ease_io(seg(t, 0.1, 0.45)))
        return merge(p, R(root=(0, 180 * (1 - k), 0)), R(jaw=(50 * bump(t, 0.2, 0.3, 0.4, 0.55), 0, 0)))

    return bake(rig, fn, L, 30, False, ground="limbs")


def act_huddle_pose(rig, t):
    base = st_low(rig)
    return merge(base, R(hips=(18, 0, 0), abdomen=(14, 0, 0), chest=(30, 0, 0), neck=(30, 0, 0), head=(36, 0, 6),
                         leg_r=(-24, 0, 8), leg_l=(-24, 0, -8), shin_r=(24, 0, 0), shin_l=(24, 0, 0)),
                 mirror_arm(arm_r=(-60, 0, -60), forearm_r=(-80, 0, 0)), fingers(40, 40))


# ------------------------------------------------------------------ OVERLAYS (Molang, property-driven, always on)
def overlays():
    lt = "q.life_time"
    out = {
        # breathing: v.br_amp degrees, v.br_ph phase (pre_animation)
        "breath": {"loop": True, "animation_length": 1.0, "bones": {
            "chest": {"rotation": ["-(v.br_amp ?? 3.0) * math.sin(v.br_ph ?? (%s * 120.0))" % lt, 0, 0]},
            "abdomen": {"rotation": ["-(v.br_amp ?? 3.0) * 0.5 * math.sin(v.br_ph ?? (%s * 120.0))" % lt, 0, 0]},
            "neck": {"rotation": ["(v.br_amp ?? 3.0) * 0.5 * math.sin(v.br_ph ?? (%s * 120.0))" % lt, 0, 0]}}},
        # tremor: fine shudder of head and fingers
        "tremor": {"loop": True, "animation_length": 1.0, "bones": {
            "head": {"rotation": ["(v.tremor ?? 0.0) * (math.sin(%s * 1700) * 2.2 + math.sin(%s * 2900) * 1.4)" % (lt, lt),
                                  "(v.tremor ?? 0.0) * math.sin(%s * 2300) * 2.0" % lt,
                                  "(v.tremor ?? 0.0) * math.sin(%s * 1300 + 40) * 2.4" % lt]},
            "neck": {"rotation": ["(v.tremor ?? 0.0) * math.sin(%s * 1100) * 1.2" % lt, 0, 0]},
            **{f: {"rotation": [0, 0, "-(v.tremor ?? 0.0) * (6 + 6 * math.sin(%s * 2100 + %d))" % (lt, i * 60)]} for i, f in enumerate(FINGERS_R)},
            **{f: {"rotation": [0, 0, "(v.tremor ?? 0.0) * (6 + 6 * math.sin(%s * 2100 + %d))" % (lt, i * 60 + 30)]} for i, f in enumerate(FINGERS_L)}}},
        # head tracking: neck takes up to 60 deg, the head the rest (owl range up to 178)
        "look": {"loop": True, "animation_length": 1.0, "bones": {
            "neck": {"rotation": ["(v.look_x ?? 0.0) * 0.3", "math.clamp(v.look_y ?? 0.0, -60, 60) * 0.35", 0]},
            "head": {"rotation": ["(v.look_x ?? 0.0) * 0.7", "(v.look_y ?? 0.0) - math.clamp(v.look_y ?? 0.0, -60, 60) * 0.35", 0]}}},
        # upside down on the ceiling the body is rolled 180 deg: yaw and pitch flip
        "look_inv": {"loop": True, "animation_length": 1.0, "bones": {
            "head": {"rotation": ["-(v.look_x ?? 0.0) * 0.8", "-(v.look_y ?? 0.0) * 0.8", 0]}}},
        # jaw: property-driven gape plus a wet quiver when wide open
        "jaw": {"loop": True, "animation_length": 1.0, "bones": {
            "jaw": {"rotation": ["v.jaw ?? 4.0", 0, 0]}}},
        # mimicry (copies your crouch / tilt late)
        "mimic_crouch": {"loop": True, "animation_length": 1.0, "bones": {
            "root": {"position": [0, "-(v.mimic_crouch ?? 0.0) * 4.5", 0]},
            "leg_r": {"rotation": ["-(v.mimic_crouch ?? 0.0) * 22", 0, 0]}, "leg_l": {"rotation": ["-(v.mimic_crouch ?? 0.0) * 22", 0, 0]},
            "shin_r": {"rotation": ["(v.mimic_crouch ?? 0.0) * 40", 0, 0]}, "shin_l": {"rotation": ["(v.mimic_crouch ?? 0.0) * 40", 0, 0]},
            "foot_r": {"rotation": ["-(v.mimic_crouch ?? 0.0) * 18", 0, 0]}, "foot_l": {"rotation": ["-(v.mimic_crouch ?? 0.0) * 18", 0, 0]},
            "chest": {"rotation": ["(v.mimic_crouch ?? 0.0) * 10", 0, 0]}}},
        "mimic_tilt": {"loop": True, "animation_length": 1.0, "bones": {
            "neck": {"rotation": ["(v.mimic_pitch ?? 0.0) * 0.35", 0, "(v.mimic_roll ?? 0.0) * 0.35"]},
            "head": {"rotation": ["(v.mimic_pitch ?? 0.0) * 0.55", 0, "(v.mimic_roll ?? 0.0) * 0.65"]}}},
        "mimic_shrug": {"loop": True, "animation_length": 1.0, "bones": {
            "arm_r": {"rotation": [0, 0, "(v.mimic_shrug ?? 0.0) * 14"]}, "arm_l": {"rotation": [0, 0, "-(v.mimic_shrug ?? 0.0) * 14"]},
            "chest": {"rotation": ["-(v.mimic_shrug ?? 0.0) * 6", 0, 0]}, "neck": {"rotation": ["(v.mimic_shrug ?? 0.0) * 10", 0, 0]}}},
        # hurt flinch (q.hurt_time)
        "hurt": {"loop": False, "animation_length": 0.35, "bones": {
            "chest": {"rotation": {"0.0": [0, 0, 0], "0.06": [-12, 4, 0], "0.35": [0, 0, 0]}},
            "head": {"rotation": {"0.0": [0, 0, 0], "0.06": [-16, 10, 8], "0.35": [0, 0, 0]}},
            "jaw": {"rotation": {"0.0": [0, 0, 0], "0.06": [26, 0, 0], "0.35": [0, 0, 0]}}}},
    }
    return out


def tail_clips():
    """Tail overlay clips (the only clips that move tail0..tail4)."""
    lt = "q.life_time"
    spd = "(v.spd ?? math.clamp(q.ground_speed / 7.0, 0.0, 1.0))"
    out = {}
    # free: hangs and sways when still, lifts and streams behind with whipping S-waves when running
    out["tail_free"] = {"loop": True, "animation_length": 1.0, "bones": {
        "tail%d" % i: {"rotation": [
            "math.lerp(%s, %s, %s) + %s * math.sin(%s * %s - %d)" % (
                [-6, 4, 6, 6, 6][i], [40, 2, -4, -4, -4][i], spd, "math.lerp(3.0, 7.0, %s)" % spd, lt, "math.lerp(90.0, 560.0, %s)" % spd, 35 * i),
            "math.lerp(%s, %s, %s) + %s * math.sin(%s * %s - %d)" % (
                [12, 20, 4, 2, 0][i], [20, 30, 6, 2, 0][i], spd, "math.lerp(%d, %d, %s)" % (5 + 3 * i, 9 + 5 * i, spd), lt,
                "math.lerp(70.0, 380.0, %s)" % spd, 40 * i), 0]} for i in range(5)}}
    # lash: agitated whip
    out["tail_lash"] = {"loop": True, "animation_length": 1.0, "bones": {
        "tail%d" % i: {"rotation": ["%d + %d * math.sin(%s * 420 - %d)" % ([10, 6, 6, 6, 6][i], 6 + 2 * i, lt, 50 * i),
                                    "%d * math.sin(%s * 300 - %d) + %d * math.sin(%s * 1300 - %d)" % (14 + 6 * i, lt, 45 * i, 3 + i, lt, 70 * i), 0]}
        for i in range(5)}}
    # curl: raised and curled forward over the back, writhing
    out["tail_curl"] = {"loop": True, "animation_length": 1.0, "bones": {
        "tail%d" % i: {"rotation": ["%d + %d * math.sin(%s * 70 - %d)" % ([58, 30, 34, 30, 26][i], 4 + i, lt, 40 * i),
                                    "%d + %d * math.sin(%s * 50 - %d)" % ([25, 50, 8, 4, 0][i], 6 + 2 * i, lt, 30 * i), 0]} for i in range(5)}}
    # rigid: straight out behind, quivering
    out["tail_rigid"] = {"loop": True, "animation_length": 1.0, "bones": {
        "tail%d" % i: {"rotation": ["%d + 1.5 * math.sin(%s * 1900 - %d)" % ([40, 4, 2, 2, 2][i], lt, 60 * i),
                                    "%d + 1.5 * math.sin(%s * 1500 - %d)" % ([20, 40, 6, 3, 0][i], lt, 50 * i), 0]} for i in range(5)}}
    return out


def tail_tunnel(rig):
    """Floor-solved tail for the 2-high tunnel crawl (would otherwise sink into the floor)."""
    L = 4.0
    body = None

    def fn(t):
        nonlocal body
        if body is None:
            c = to_np(strip(rig.supplied("planted", 0.05), TAILSET))
            body = merge(c, to_np(_tunnel_squash(0.0)))
            y = rig.min_y(body, FEET + HANDS)
            body = merge(body, POS(root=(0, -y, 0)))
        return solve_tail(rig, body, 9 * math.sin(t / L * TAU), floor_px=1.0)

    clip, st, _ = bake(rig, fn, L, 4, True, ground=None, keep_tail=True)
    return clip, st, None


# ------------------------------------------------------------------ registry
GAITS = {"gallop": gait_gallop, "walk": gait_walk, "creep": gait_creep, "tunnel_move": gait_tunnel, "squeeze": gait_squeeze}
ACTS = {
    "idle": idle_prowl, "idle_low": idle_low, "tunnel_idle": idle_tunnel, "watch": act_watch, "watch_low": act_watch_low,
    "tall": act_tall, "peek_l": lambda r: act_peek(r, "l"), "peek_r": lambda r: act_peek(r, "r"), "cling": act_cling,
    "climb": act_climb, "hold": act_hold, "sniff": act_sniff, "stunned": act_stunned, "savor": act_savor,
    "huddle": act_huddle, "bash": act_bash, "reach_in": act_reach_in, "listen": act_listen, "death": act_death,
    "behind": act_behind, "neck": act_neck, "reach": act_reach,
}
SHOTS = {
    "scream": shot_scream, "roar": shot_roar, "swipe_r": lambda r: shot_swipe(r, "r"), "swipe_l": lambda r: shot_swipe(r, "l"),
    "combo": shot_combo, "slam": shot_slam, "pounce": shot_pounce, "lunge_grab": shot_lunge_grab, "throw": shot_throw,
    "smash": shot_smash, "bite": shot_bite, "flinch": shot_flinch, "drop": shot_drop, "rise": shot_rise, "howl": shot_howl,
    "knock": shot_knock, "turn": shot_turn,
}
PARTIAL_SHOTS = {"flinch"}
# times (s) inside each one-shot that the behavior scripts synchronise to
SHOT_META = {
    "scream": {"peak": 0.62}, "roar": {"peak": 0.2}, "swipe_r": {"hits": [0.28]}, "swipe_l": {"hits": [0.28]},
    "combo": {"hits": [0.28, 0.62]}, "slam": {"hits": [0.52]}, "pounce": {"launch": 0.22, "hits": [0.6]},
    "lunge_grab": {"close": 0.4}, "throw": {"release": 0.3}, "smash": {"release": 0.5}, "bite": {"hits": [0.38]},
    "flinch": {}, "drop": {"land": 0.55}, "rise": {}, "howl": {"peak": 1.2}, "knock": {"hits": [0.26, 0.56, 0.86]},
    "turn": {},
}


def build_all(rig, only=None):
    out, stats = {}, {}
    for table in (GAITS, ACTS, SHOTS):
        for name, f in table.items():
            if only and name not in only:
                continue
            res = f(rig)
            clip, st = res[0], res[1]
            out[V3 + name] = clip
            stats[name] = st
    if V3 + "gallop" in out:
        # the hallucination's gallop: same clip, driven by time (the echo is teleported along its path)
        gt = dict(out[V3 + "gallop"])
        gt["anim_time_update"] = "math.mod(q.life_time * %.3f, 1.0)" % (ECHO_RUN_SPEED / GALLOP_STRIDE)
        out[V3 + "gallop_t"] = gt
    if not only or "tail_tunnel" in only:
        clip, st, _ = tail_tunnel(rig)
        out[V3 + "tail_tunnel"] = clip
        stats["tail_tunnel"] = st
    for k, v in overlays().items():
        out[V3 + k] = v
    for k, v in tail_clips().items():
        out[V3 + k] = v
    return out, stats


def render_sheets(rig, clips, names, outdir, views=("side", "three"), frames=6):
    from PIL import Image, ImageDraw
    from render_preview import render
    tex = Image.open(os.path.join(RP, "textures", "entity", "tall_wail", "tall_wail.png")).convert("RGBA")
    W, H = 170, 230
    os.makedirs(outdir, exist_ok=True)
    for n in names:
        an = bm.Animation(V3 + n, clips[V3 + n])
        L = an.length or 1.0
        sheet = Image.new("RGB", (W * frames, H * len(views)))
        for r, view in enumerate(views):
            for c in range(frames):
                t = L * c / max(1, frames - 1) if an.loop is not True else L * c / frames
                pose = an.sample(t, {"q.life_time": t})
                im = render(rig.geo, tex, pose, view, size=(W, H), ppu=2.3, origin_y=H - 14, scale=SCALE)
                ImageDraw.Draw(im).text((3, 3), "%s %.2f" % (n, t), fill=(255, 255, 0))
                sheet.paste(im, (c * W, r * H))
        p = os.path.join(outdir, n + ".png")
        sheet.save(p)
        print("sheet", p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", default="")
    ap.add_argument("--only", default="")
    ap.add_argument("--no-write", action="store_true")
    a = ap.parse_args()
    rig = Rig()
    only = set(a.only.split(",")) if a.only else None
    clips, stats = build_all(rig, only)
    if not a.no_write and not only:
        doc = {"format_version": "1.8.0", "animations": dict(sorted(clips.items()))}
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w") as fh:
            json.dump(doc, fh, separators=(",", ":"), allow_nan=False)
        lines = ["# Tailwail v3 animation report", "", "Generated by `tools/anim_v3.py`.", "",
                 "| clip | frames | max grounding fix (px) | lowest point (blocks) | peak height (blocks) | stride (blocks) |",
                 "|---|---|---|---|---|---|"]
        for k, st in sorted(stats.items()):
            lines.append("| %s | %d | %.2f | %.2f | %.2f | %s |" % (k, st.get("frames", 0), st["ground_fix_max"], st.get("low_blocks", 0),
                                                              st["top_blocks"], ("%.2f" % st["stride"]) if "stride" in st else ""))
        os.makedirs(os.path.dirname(REPORT), exist_ok=True)
        open(REPORT, "w").write("\n".join(lines) + "\n")
        print("wrote %d clips, %.0f KB" % (len(clips), os.path.getsize(OUT) / 1024))
    for k, st in sorted(stats.items()):
        print("%-14s fix %.2f low %.2f top %.2f %s" % (k, st["ground_fix_max"], st.get("low_blocks", 0), st["top_blocks"],
                                                      ("stride %.2f" % st["stride"]) if "stride" in st else ""))
    if a.sheet:
        names = [n for n in a.sheet.split(",") if V3 + n in clips] if a.sheet != "all" else \
            [k[len(V3):] for k in clips if k[len(V3):] in GAITS or k[len(V3):] in ACTS or k[len(V3):] in SHOTS]
        render_sheets(rig, clips, names, os.path.join(ROOT, "build", "anim_v3"))


if __name__ == "__main__":
    main()
