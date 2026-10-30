#!/usr/bin/env python3
"""Builds Tailwail's resource-pack model assets from the untouched supplied archive.

  python3 -I tools/build_assets.py [--check]

Inputs : source_assets/original/TallWail_Blockbench_v3.zip (never modified)
Outputs: packs/TailwailRP/models/entity/tall_wail.geo.json      (copy; culling bounds widened)
         packs/TailwailRP/textures/entity/tall_wail/tall_wail.png (byte-identical copy)
         packs/TailwailRP/animations/tall_wail.animation.json    (byte-identical copy)
         packs/TailwailRP/animations/tall_wail.rehearsal.animation.json (derived + new clips)
         docs/generated/animation_report.md                      (measurements)

Every derived clip is computed numerically against the supplied rig with the
evaluator in bedrock_model.py; grounding offsets are solved so feet/hands stay
on the floor instead of being hand-guessed.  --check re-derives everything and
fails if the committed outputs differ (used by tools/validate.py).
"""
import argparse
import copy
import hashlib
import io
import json
import math
import os
import sys
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import bedrock_model as bm  # noqa: E402

ZIP = os.path.join(ROOT, "source_assets", "original", "TallWail_Blockbench_v3.zip")
RP = os.path.join(ROOT, "packs", "TailwailRP")
OUT_GEO = os.path.join(RP, "models", "entity", "tall_wail.geo.json")
OUT_TEX = os.path.join(RP, "textures", "entity", "tall_wail", "tall_wail.png")
OUT_ANIM = os.path.join(RP, "animations", "tall_wail.animation.json")
OUT_NEW = os.path.join(RP, "animations", "tall_wail.rehearsal.animation.json")
REPORT = os.path.join(ROOT, "docs", "generated", "animation_report.md")

# World scale applied by the client entity (scripts.scale).  Chosen so the
# fully unfolded head height is ~4.7 blocks (~15.4 ft); see docs/ASSET_CHANGES.md.
RENDER_SCALE = 1.5
P = "animation.tall_wail."
TAIL = ["tail0", "tail1", "tail2", "tail3", "tail4"]
FEET = ["foot_r", "foot_l"] + ["toe_%s%d" % (s, i) for s in "rl" for i in range(4)]
HANDS = ["hand_r", "hand_l"] + ["finger_%s%d%s" % (s, i, t) for s in "rl" for i in range(4) for t in ("", "_tip")] + \
        ["thumb_r", "thumb_l", "thumb_r_tip", "thumb_l_tip"]
LIMBS = FEET + HANDS
EXPECTED_SHA = {
    "tall_wail.geo.json": "b180cc397834a173d539df0857ec9761046829a7d5cd461ee4a87d36f622511b",
    "tall_wail.animation.json": "e903f5e905ea3c834abe7900a0953ce48ca1c6dc10f26eda97ea34fceebb5604",
    "tall_wail.png": "a23e2443f5124bc177d25c98bdcb4e49422f165b12f97b3dd4688d1ce033a0e7",
}


def r3(v):
    return float("%.3f" % v)


def vec(v):
    return [r3(x) for x in v]


def tkey(t):
    return ("%.4f" % t).rstrip("0").rstrip(".") if t else "0.0"


# --------------------------------------------------------------------------
class Rig:
    def __init__(self, geo_path, anim_path):
        self.geo = bm.Geometry(geo_path)
        self.anims = bm.load_animations(anim_path)

    def clip(self, name):
        return self.anims[P + name]

    def pose(self, layers, t, env=None):
        env = dict(env or {})
        env.setdefault("q.life_time", t)
        return bm.pose_from(self.anims, layers, t, env)

    def min_y(self, pose, bones=LIMBS):
        lo, _ = self.geo.bounds(pose, bones)
        return float(lo[1])

    def top_y(self, pose, exclude=()):
        bones = [b for b in self.geo.order if b not in exclude]
        _, hi = self.geo.bounds(pose, bones)
        return float(hi[1])


def add_delta(pose, delta, w=1.0):
    out = copy.deepcopy(pose)
    for bone, chans in delta.items():
        d = out.setdefault(bone, {})
        for ch, v in chans.items():
            d[ch] = d.get(ch, np.zeros(3)) + np.array(v, dtype=float) * w
    return out


def lerp_delta(a, b, s):
    keys = set(a) | set(b)
    out = {}
    for bone in keys:
        out[bone] = {}
        for ch in set(a.get(bone, {})) | set(b.get(bone, {})):
            va = np.array(a.get(bone, {}).get(ch, [0, 0, 0]), dtype=float)
            vb = np.array(b.get(bone, {}).get(ch, [0, 0, 0]), dtype=float)
            out[bone][ch] = va + (vb - va) * s
    return out


def delta_to_keys(samples, loop, length, extra=None):
    """samples: list of (t, delta-dict). Returns bedrock bones dict with linear keys."""
    bones = {}
    for t, delta in samples:
        for bone, chans in delta.items():
            for ch, v in chans.items():
                bones.setdefault(bone, {}).setdefault(ch, {})[tkey(t)] = vec(v)
    bones = {b: dict(sorted(bones[b].items())) for b in sorted(bones)}  # deterministic output order
    # collapse channels that never change into a constant
    for bone, chans in bones.items():
        for ch, keys in list(chans.items()):
            vals = list(keys.values())
            if all(v == vals[0] for v in vals):
                chans[ch] = vals[0]
    clip = {"animation_length": r3(length), "bones": bones}
    if loop is not None:
        clip["loop"] = loop
    if extra:
        clip.update(extra)
    return clip


# --------------------------------------------------------------------------
def grounding_clip(rig, base_name, step=0.05, env_fn=None, bones=LIMBS, extra=None):
    """Root offset that keeps the lowest limb point of `base_name` on y=0."""
    base = rig.clip(base_name)
    L = base.length
    n = max(1, int(round(L / step)))
    samples = []
    worst = 0.0
    for i in range(n + 1):
        t = L * i / n
        env = env_fn(t) if env_fn else {}
        pose = rig.pose([(base, 1, 0)], t, env)
        y = rig.min_y(pose, bones)
        worst = max(worst, abs(y))
        samples.append((t, {"root": {"position": [0, -y, 0]}}))
    clip = delta_to_keys(samples, base.loop if base.loop is not True else True, L, extra)
    return clip, worst


def strip_tail(src):
    c = copy.deepcopy(src)
    for b in TAIL:
        c["bones"].pop(b, None)
    return c


def retime(src, warp):
    """warp: list of (old_t, new_t) monotonic control points; keys re-timed piecewise-linearly."""
    def f(t):
        for (a0, b0), (a1, b1) in zip(warp, warp[1:]):
            if a0 <= t <= a1:
                return b0 + (b1 - b0) * (t - a0) / (a1 - a0)
        return warp[-1][1]
    c = copy.deepcopy(src)
    for bone, chans in c["bones"].items():
        for ch, keys in chans.items():
            if isinstance(keys, dict):
                chans[ch] = {tkey(f(float(k))): v for k, v in keys.items()}
    c["animation_length"] = r3(warp[-1][1])
    return c


# --------------------------------------------------------------------------
# Designed overlays
# --------------------------------------------------------------------------
def crouch_delta(rig, depth, curl):
    """Lower the body by `depth` px with knees bending forward; solve legs so feet stay planted."""
    base = rig.pose([(rig.clip("idle"), 1, 0)], 0.0)
    target = {}
    for side in "rl":
        lo, hi = rig.geo.bounds(base, ["foot_" + side] + ["toe_%s%d" % (side, i) for i in range(4)])
        target[side] = (lo[1], (lo[2] + hi[2]) / 2)
    def err_of(a, b):
        d = {"root": {"position": [0, -depth, 0]}}
        for side in "rl":
            d["leg_" + side] = {"rotation": [-a, 0, 0]}
            d["shin_" + side] = {"rotation": [b, 0, 0]}
            d["foot_" + side] = {"rotation": [a - b, 0, 0]}
        pose = add_delta(base, d)
        err = 0.0
        for side in "rl":
            lo, hi = rig.geo.bounds(pose, ["foot_" + side] + ["toe_%s%d" % (side, i) for i in range(4)])
            err += (lo[1] - target[side][0]) ** 2 + 0.5 * (((lo[2] + hi[2]) / 2) - target[side][1]) ** 2
        return err
    best = min((err_of(a, b), a, b) for a in np.arange(0, 61, 4.0) for b in np.arange(0, 91, 4.0))
    for span in (2.0, 0.5):
        _, a0, b0 = best
        best = min([best] + [(err_of(a, b), a, b) for a in np.arange(a0 - 2 * span, a0 + 2 * span + 1e-6, span)
                             for b in np.arange(b0 - 2 * span, b0 + 2 * span + 1e-6, span)])
    _, a, b = best
    d = {"root": {"position": [0, -depth, 0]},
         "hips": {"rotation": [6 * curl, 0, 0]},
         "abdomen": {"rotation": [8 * curl, 0, 0]},
         "chest": {"rotation": [10 * curl, 0, 0]},
         "neck": {"rotation": [-12 * curl, 0, 0]},
         "head": {"rotation": [-6 * curl, 0, 0]},
         "arm_r": {"rotation": [-10 * curl, 0, 6 * curl]},
         "arm_l": {"rotation": [-10 * curl, 0, -6 * curl]},
         "forearm_r": {"rotation": [-14 * curl, 0, 0]},
         "forearm_l": {"rotation": [-14 * curl, 0, 0]}}
    for side in "rl":
        d["leg_" + side] = {"rotation": [-a, 0, 0]}
        d["shin_" + side] = {"rotation": [b, 0, 0]}
        d["foot_" + side] = {"rotation": [a - b, 0, 0]}
    # re-check and fine-correct residual foot height with root
    pose = add_delta(base, d)
    lo = rig.min_y(pose, FEET)
    d["root"]["position"][1] -= lo
    return d, (a, b, lo)


def build_mimic_crouch(rig, report):
    # anim time == crouch amount: 1.0 = a normal crouch, 1.6 = "too deep"
    pts = [(0.0, 0.0, 0.0), (0.5, 3.0, 0.4), (1.0, 6.5, 1.0), (1.6, 11.0, 1.9)]
    samples = []
    for t, depth, curl in pts:
        if t == 0:
            samples.append((t, {"root": {"position": [0, 0, 0]}}))
            continue
        d, info = crouch_delta(rig, depth, curl)
        report.append("mimic_crouch t=%.1f depth=%.1fpx thigh=%.1f knee=%.1f foot residual=%.3f" % (t, depth, info[0], info[1], info[2]))
        samples.append((t, d))
    # make every key carry every channel (zeros at t=0)
    allch = {(b, ch) for _, d in samples for b, chs in d.items() for ch in chs}
    for _, d in samples:
        for b, ch in sorted(allch):
            d.setdefault(b, {}).setdefault(ch, [0, 0, 0])
    return delta_to_keys(samples, "hold_on_last_frame", 1.6, {"anim_time_update": "v.mimic_crouch"})


def build_mimic_step():
    # anim time 0..1 : 0 neutral, 0.5 right foot lifted mid-step and torso committed, 1 neutral
    lift = {"leg_r": {"rotation": [-34, 0, 0]}, "shin_r": {"rotation": [48, 0, 0]}, "foot_r": {"rotation": [-10, 0, 0]},
            "hips": {"rotation": [3, 0, -3]}, "chest": {"rotation": [6, 4, 0]}, "neck": {"rotation": [-4, 0, 0]},
            "arm_l": {"rotation": [-12, 0, 0]}, "arm_r": {"rotation": [8, 0, 0]}}
    zero = {b: {ch: [0, 0, 0] for ch in chs} for b, chs in lift.items()}
    samples = [(0.0, zero), (0.5, lift), (1.0, zero)]
    return delta_to_keys(samples, "hold_on_last_frame", 1.0, {"anim_time_update": "v.mimic_step"})


def build_mimic_shrug():
    # anim time 0..1.5 : shoulders hiked past a resting pose (1.5 = grotesquely high)
    up = {"arm_r": {"rotation": [-6, 0, 14]}, "arm_l": {"rotation": [-6, 0, -14]},
          "forearm_r": {"rotation": [-10, 0, -6]}, "forearm_l": {"rotation": [-10, 0, 6]},
          "chest": {"rotation": [-6, 0, 0]}, "neck": {"rotation": [10, 0, 0]}, "head": {"rotation": [-8, 0, 0]},
          "mane_body": {"position": [0, 1.2, 0]}}
    zero = {b: {ch: [0, 0, 0] for ch in chs} for b, chs in up.items()}
    big = {b: {ch: (np.array(v) * 1.5).tolist() for ch, v in chs.items()} for b, chs in up.items()}
    return delta_to_keys([(0.0, zero), (1.0, up), (1.5, big)], "hold_on_last_frame", 1.5,
                         {"anim_time_update": "v.mimic_shrug"})


def build_mimic_tilt():
    # head pitch copy + quizzical roll; v.mimic_roll and v.mimic_pitch are degrees
    return {"loop": True, "animation_length": 1.0, "bones": {
        "neck": {"rotation": ["v.mimic_pitch * 0.35", 0, "v.mimic_roll * 0.35"]},
        "head": {"rotation": ["v.mimic_pitch * 0.55", 0, "v.mimic_roll * 0.65"]},
    }}


def solve_tail_drag(rig, base_layers, t, report, label, target_low=0.6, trail_w=0.15):
    """Search tail angles so the tail hangs to the floor and trails backward (tip >= 0.3 px up)."""
    base = rig.pose(base_layers, t)
    base = add_delta(base, {"root": {"position": [0, -rig.min_y(base), 0]}})  # grounded, as in game
    best = None
    for a0 in range(-95, -20, 5):
        for a1 in range(0, 70, 5):
            for a2 in range(0, 45, 5):
                d = {"tail0": {"rotation": [a0, 12, 0]}, "tail1": {"rotation": [a1, 30, 0]}, "tail2": {"rotation": [a2, 6, 0]},
                     "tail3": {"rotation": [8, 4, 0]}, "tail4": {"rotation": [6, 0, 0]}}
                pts = rig.geo.bone_points(add_delta(base, d), TAIL)
                low = min(v[:, 1].min() for v in pts.values())
                tip = pts["tail4"]
                trail = tip[:, 2].mean()  # +z = behind the creature
                err = abs(low - target_low) * 4 + (0 if low >= 0.2 else 50) - trail * trail_w
                if best is None or err < best[0]:
                    best = (err, a0, a1, a2, low, trail)
    _, a0, a1, a2, low, trail = best
    report.append("tail_drag %s: tail0 %d tail1 %d tail2 %d -> lowest %.2f px, tip %.1f px behind" % (label, a0, a1, a2, low, trail))
    return {"tail0": [a0, 12, 0], "tail1": [a1, 30, 0], "tail2": [a2, 6, 0], "tail3": [8, 4, 0], "tail4": [6, 0, 0]}


def build_tail_drag(rig, report, base_layers, t, label, **kw):
    # Tail lowered to the floor and dragged; sway reuses the supplied idle tail motion, slowed and damped.
    base = solve_tail_drag(rig, base_layers, t, report, label, **kw)
    sway = {"tail0": ("0.6", "20", "90", "2.0", "0"), "tail1": ("0.6", "20", "60", "3.0", "-35"),
            "tail2": ("0.6", "20", "30", "4.0", "-70"), "tail3": ("0.6", "20", "0", "5.0", "-105"),
            "tail4": ("0.6", "20", "-30", "6.0", "-140")}
    bones = {}
    for b, v in base.items():
        ax, f, px, ay, py = sway[b]
        bones[b] = {"rotation": ["%s + %s*math.sin(q.life_time*%s*0.6+%s)" % (v[0], ax, f, px),
                                 "%s + %s*math.sin(q.life_time*%s*0.6+%s)" % (v[1], ay, f, py), 0]}
    return {"loop": True, "animation_length": 8.0, "bones": bones}


def build_tail_rigid():
    # Straight, slightly raised, with a fine tremor (commitment cue)
    base = {"tail0": [38, 25, 0], "tail1": [-6, 50, 0], "tail2": [4, 8, 0], "tail3": [4, 4, 0], "tail4": [4, 0, 0]}
    bones = {}
    for i, (b, v) in enumerate(base.items()):
        bones[b] = {"rotation": ["%s + 0.5*math.sin(q.life_time*1900+%d)" % (v[0], i * 70),
                                 "%s + 0.4*math.sin(q.life_time*2300+%d)" % (v[1], i * 50), 0]}
    return {"loop": True, "animation_length": 1.0, "bones": bones}


def build_tail_twitch():
    # Half-lowered tail with irregular flicks; 2.6 s cycle so it never syncs with the 4.4 s body twitch
    base = {"tail0": [14, 18, 0], "tail1": [2, 40, 0], "tail2": [0, 8, 0], "tail3": [0, 4, 0], "tail4": [0, 0, 0]}
    flicks = [(0.0, 0, 0), (0.18, 0, 0), (0.24, 10, 26), (0.34, 4, 18), (0.62, 0, -6), (0.9, 0, 0),
              (1.3, 0, 0), (1.36, 6, -30), (1.46, 2, -20), (1.8, 0, 4), (2.15, 0, 0), (2.2, 14, 12),
              (2.3, 6, 6), (2.6, 0, 0)]
    gains = {"tail0": (0.5, 0.2), "tail1": (0.4, 0.5), "tail2": (0.3, 0.8), "tail3": (0.2, 1.0), "tail4": (0.2, 1.2)}
    bones = {}
    for b, v in base.items():
        gx, gy = gains[b]
        bones[b] = {"rotation": {tkey(t): [r3(v[0] + x * gx), r3(v[1] + y * gy), 0] for t, x, y in flicks}}
    return {"loop": True, "animation_length": 2.6, "bones": bones}


def build_inhale():
    # Agitated inhale: chest swells, shoulders rise, head lifts; holds while voice == inhale
    keys = {0.0: 0.0, 0.6: 1.0, 1.2: 1.0}
    d = {"chest": [-5, 0, 0], "abdomen": [-3, 0, 0], "neck": [-6, 0, 0], "head": [-5, 0, 0],
         "arm_r": [0, 0, 4], "arm_l": [0, 0, -4]}
    bones = {b: {"rotation": {tkey(t): vec(np.array(v) * s) for t, s in keys.items()}} for b, v in d.items()}
    return {"loop": "hold_on_last_frame", "animation_length": 1.2, "bones": bones}


def build_unfold(rig, variant, report):
    """Full-height reveal for the commitment.  Layered on the supplied `reveal` (2.0 s)."""
    rev = rig.clip("reveal")
    if variant == "full":
        end = {"leg_r": [14, 0, 0], "leg_l": [14, 0, 0], "shin_r": [-30, 0, 0], "shin_l": [-30, 0, 0],
               "foot_r": [16, 0, 0], "foot_l": [16, 0, 0], "abdomen": [-10, 0, 0], "chest": [-14, 0, 0],
               "neck": [6, 0, 0], "head": [-10, 0, 0],
               "arm_r": [-150, 0, 18], "arm_l": [-150, 0, -18], "forearm_r": [10, 0, 0], "forearm_l": [10, 0, 0],
               "hand_r": [-10, 0, 0], "hand_l": [-10, 0, 0]}
    else:  # "mid": as tall as a ~5-block ceiling allows; arms flung wide instead of up
        end = {"leg_r": [14, 0, 0], "leg_l": [14, 0, 0], "shin_r": [-30, 0, 0], "shin_l": [-30, 0, 0],
               "foot_r": [16, 0, 0], "foot_l": [16, 0, 0], "abdomen": [-10, 0, 0], "chest": [-12, 0, 0],
               "neck": [4, 0, 0], "head": [-6, 0, 0],
               "arm_r": [-40, 0, 62], "arm_l": [-40, 0, -62], "forearm_r": [-10, 0, -10], "forearm_l": [-10, 0, 10]}
    curve = [(0.0, 0.0), (0.4, 0.15), (1.0, 0.65), (1.5, 0.95), (2.0, 1.0)]
    samples = []
    top = 0.0
    for t, s in curve:
        d = {b: {"rotation": (np.array(v) * s).tolist()} for b, v in end.items()}
        pose = add_delta(rig.pose([(rev, 1, 0)], t), d)
        y = rig.min_y(pose, FEET)
        d["root"] = {"position": [0, -y, 0]}
        top = max(top, rig.top_y(add_delta(pose, {"root": {"position": [0, -y, 0]}})))
        samples.append((t, d))
    report.append("unfold_%s: peak silhouette %.1f px = %.2f blocks at scale %.2f" % (variant, top, top * RENDER_SCALE / 16, RENDER_SCALE))
    return delta_to_keys(samples, "hold_on_last_frame", 2.0)


def build_unfold_low(rig, report):
    """Low-ceiling commitment: from the planted stance the chest lifts and arms spread; stays under ~3 blocks."""
    base = rig.clip("planted")
    end = {"chest": [-16, 0, 0], "abdomen": [-8, 0, 0], "neck": [10, 0, 0], "head": [-14, 0, 0],
           "arm_r": [-20, 0, 34], "arm_l": [-20, 0, -34], "forearm_r": [-6, 0, -12], "forearm_l": [-6, 0, 12]}
    samples = []
    top = 0.0
    for t, s in [(0.0, 0.0), (0.5, 0.6), (1.2, 1.0)]:
        d = {b: {"rotation": (np.array(v) * s).tolist()} for b, v in end.items()}
        pose = add_delta(rig.pose([(base, 1, 0)], 0.05), d)
        y = rig.min_y(pose, FEET)
        d["root"] = {"position": [0, -y, 0]}
        top = max(top, rig.top_y(add_delta(pose, {"root": {"position": [0, -y, 0]}})))
        samples.append((t, d))
    report.append("unfold_low: peak %.1f px = %.2f blocks" % (top, top * RENDER_SCALE / 16))
    return delta_to_keys(samples, "hold_on_last_frame", 1.2)


# Found by a constrained pose search (tools/pose_search.py) minimising height over the crawl
# cycle with a width penalty; see docs/ASSET_CHANGES.md.  Arms fold back mantis-like.
TUNNEL_DELTA = {"abdomen": [11.2, 0, 0], "chest": [-5.0, 0, 0], "neck": [-0.9, 0, 0], "head": [-13.1, 0, 0],
                "leg_r": [1.2, 0, 45.0], "leg_l": [1.2, 0, -45.0], "shin_r": [45.7, 0, 0], "shin_l": [45.7, 0, 0],
                "arm_r": [60.0, 0, 13.1], "arm_l": [60.0, 0, -13.1], "forearm_r": [-90.0, 0, -1.8],
                "forearm_l": [-90.0, 0, 1.8], "hand_r": [-15.5, 0, 0], "hand_l": [-15.5, 0, 0]}


def build_tunnel(rig, base_name, report, env_fn=None, extra=None, steps=24):
    """Flattened body for 2-block tunnels: same gait as the supplied crawl, spine pressed toward the floor."""
    base = rig.clip(base_name)
    L = base.length
    samples = []
    tops = []
    for i in range(steps + 1):
        t = L * i / steps
        env = env_fn(t) if env_fn else {}
        d = {b: {"rotation": list(v)} for b, v in TUNNEL_DELTA.items()}
        pose = add_delta(rig.pose([(base, 1, 0)], t, env), d)
        y = rig.min_y(pose, LIMBS)
        d["root"] = {"position": [0, -y, 0]}
        tops.append(rig.top_y(add_delta(pose, {"root": {"position": [0, -y, 0]}}), exclude=TAIL))
        samples.append((t, d))
    report.append("tunnel over %s: max height %.1f px = %.2f blocks (limit 2.0)" % (base_name, max(tops), max(tops) * RENDER_SCALE / 16))
    return delta_to_keys(samples, base.loop if base.loop is not True else True, L, extra), max(tops)


# --------------------------------------------------------------------------
def gait_stats(rig, clip_name, drive, contact_bones, report, cycle=1.0, n=48):
    """Distance a planted contact point travels backwards per cycle (model px) -> blocks per cycle."""
    clip = rig.clip(clip_name)
    zs = []
    for i in range(n + 1):
        ph = cycle * i / n
        env = drive(ph)
        pose = rig.pose([(clip, 1, 0)], ph if clip.anim_time_update else 0.0, env)
        lo, hi = rig.geo.bounds(pose, contact_bones)
        zs.append(((lo[2] + hi[2]) / 2, lo[1]))
    # stance = lowest half of the samples
    ys = sorted(y for _, y in zs)
    thresh = ys[len(ys) // 2]
    stance = [z for z, y in zs if y <= thresh + 1e-6]
    travel = max(stance) - min(stance)
    per_cycle = travel * 2.0  # stance covers ~half a cycle
    report.append("%s stride: contact travel %.1f px/half-cycle -> %.2f blocks/cycle at scale %.2f" %
                  (clip_name, travel, per_cycle * RENDER_SCALE / 16, RENDER_SCALE))
    return per_cycle * RENDER_SCALE / 16


# --------------------------------------------------------------------------
def build(check=False):
    zf = zipfile.ZipFile(ZIP)
    raw = {os.path.basename(n): zf.read(n) for n in zf.namelist() if not n.endswith("/")}
    for name, sha in EXPECTED_SHA.items():
        got = hashlib.sha256(raw[name]).hexdigest()
        if got != sha:
            raise SystemExit("supplied asset %s changed: %s" % (name, got))
    tmp = os.path.join(ROOT, "build", "src")
    os.makedirs(tmp, exist_ok=True)
    for name, data in raw.items():
        open(os.path.join(tmp, name), "wb").write(data)
    rig = Rig(os.path.join(tmp, "tall_wail.geo.json"), os.path.join(tmp, "tall_wail.animation.json"))
    src = json.loads(raw["tall_wail.animation.json"])["animations"]
    report = ["# Tailwail animation build report", "", "Generated by tools/build_assets.py. Units: model px (16 px = 1 block at scale 1).", ""]

    outputs = {}
    # geometry: identical except culling bounds sized for the 1.5x render scale and full reach
    geo = json.loads(raw["tall_wail.geo.json"])
    d = geo["minecraft:geometry"][0]["description"]
    d["visible_bounds_width"] = 8
    d["visible_bounds_height"] = 7.5
    d["visible_bounds_offset"] = [0, 3.5, 0]
    outputs[OUT_GEO] = (json.dumps(geo, indent=1) + "\n").encode()
    outputs[OUT_TEX] = raw["tall_wail.png"]
    outputs[OUT_ANIM] = raw["tall_wail.animation.json"]

    new = {}
    # 1. tail-free copies of procedural body clips (tail is owned by the tail controller)
    for n in ["idle", "walk", "pace", "watch", "menace", "scream"]:
        new[P + n + "_nt"] = strip_tail(src[P + n])
    # 2. grounding corrections for supplied keyframed clips
    for n in ["windup", "windup_c", "planted", "lunge", "stuck", "reveal", "death", "death_low", "peek_left",
              "peek_right", "ambush", "drop", "rise"]:
        clip, worst = grounding_clip(rig, n)
        new[P + "gfix_" + n] = clip
        report.append("gfix_%s: max correction %.2f px" % (n, worst))
    clip, worst = grounding_clip(rig, "crawl", step=1 / 24, env_fn=lambda t: {"v.crawl": t},
                                 extra={"anim_time_update": "v.crawl"})
    new[P + "gfix_crawl"] = clip
    report.append("gfix_crawl: max correction %.2f px" % worst)
    # 3. readable strike: same poses, impact moved from 0.35 s to 0.55 s
    strike = retime(src[P + "strike"], [(0.0, 0.0), (0.2, 0.38), (0.35, 0.55), (0.75, 0.95)])
    new[P + "tw_strike"] = strike
    rig.anims[P + "tw_strike"] = bm.Animation(P + "tw_strike", strike)
    clip, worst = grounding_clip(rig, "tw_strike")
    new[P + "gfix_tw_strike"] = clip
    # 4. imitation overlays
    new[P + "tw_mimic_crouch"] = build_mimic_crouch(rig, report)
    new[P + "tw_mimic_step"] = build_mimic_step()
    new[P + "tw_mimic_shrug"] = build_mimic_shrug()
    new[P + "tw_mimic_tilt"] = build_mimic_tilt()
    # 5. tail states
    # upright, the tail is shorter than the hip height: a low, visibly trailing droop instead of a hidden hang
    new[P + "tw_tail_drag"] = build_tail_drag(rig, report, [(rig.clip("idle"), 1, 0)], 0.0, "upright", target_low=6.0, trail_w=0.6)
    new[P + "tw_tail_drag_low"] = build_tail_drag(rig, report, [(rig.clip("planted"), 1, 0)], 0.05, "hunched")
    new[P + "tw_tail_twitch"] = build_tail_twitch()
    new[P + "tw_tail_rigid"] = build_tail_rigid()
    # 6. breathing / voice
    new[P + "tw_inhale"] = build_inhale()
    # 7. commitment unfold
    new[P + "tw_unfold_full"] = build_unfold(rig, "full", report)
    new[P + "tw_unfold_mid"] = build_unfold(rig, "mid", report)
    new[P + "tw_unfold_low"] = build_unfold_low(rig, report)
    # 8. tunnel posture (2-block-high passages)
    tun_move, h1 = build_tunnel(rig, "crawl", report, env_fn=lambda t: {"v.crawl": t},
                                extra={"anim_time_update": "v.crawl"})
    tun_still, h2 = build_tunnel(rig, "planted", report, steps=1)
    new[P + "tw_tunnel_move"] = tun_move
    new[P + "tw_tunnel_still"] = tun_still
    # 9. gait calibration -> distance-to-phase constants used by the client entity
    RFOOT = ["foot_r"] + ["toe_r%d" % i for i in range(4)]
    k_walk = gait_stats(rig, "walk", lambda ph: {"v.walk": ph * 360.0, "v.move": 1.0}, RFOOT, report)
    k_pace = gait_stats(rig, "pace", lambda ph: {"v.walk": ph * 360.0, "v.move": 1.0}, RFOOT, report)
    k_crawl = gait_stats(rig, "crawl", lambda ph: {"v.crawl": ph}, ["hand_r"], report)
    report.append("")
    report.append("Client constants: walk %.2f blocks/cycle, pace %.2f blocks/cycle, crawl %.2f blocks/cycle" % (k_walk, k_pace, k_crawl))

    anim_doc = {"format_version": "1.8.0", "animations": dict(sorted(new.items()))}
    outputs[OUT_NEW] = (json.dumps(anim_doc, indent=1) + "\n").encode()
    outputs[REPORT] = ("\n".join(report) + "\n").encode()

    bad = []
    for path, data in outputs.items():
        if check:
            if not os.path.exists(path) or open(path, "rb").read() != data:
                bad.append(os.path.relpath(path, ROOT))
        else:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, "wb").write(data)
    if check and bad:
        raise SystemExit("outdated generated assets: %s (run tools/build_assets.py)" % ", ".join(bad))
    print("\n".join(report))
    return {"walk": k_walk, "pace": k_pace, "crawl": k_crawl}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    build(ap.parse_args().check)
