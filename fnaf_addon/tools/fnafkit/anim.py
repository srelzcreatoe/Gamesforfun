"""Shared animation core: pose helpers, ground contact, arm IK and keyframe sampling.

Every clip is written as a pose function  pose(t) -> {bone: {channel: [x, y, z]}}
using Bedrock / Blockbench animation values:

  rotation x > 0  swings a hanging limb backward  (tilts an upright bone forward)
  rotation z > 0  swings a hanging limb toward the character's right (+X)
  rotation y > 0  turns the front toward the character's right
  position x > 0  moves toward the character's LEFT, y up, z > 0 backward

make_clip() samples the pose function into keyframes and drops redundant ones
so the result stays editable in Blockbench's timeline.
"""
import bisect
import math
from collections import OrderedDict

import numpy as np

from . import rig

ANIMS = OrderedDict()
TAU = 2 * math.pi
S = {"right": 1, "left": -1}

# Arm IK settings a character overrides: palm centre of the right hand (the
# left is mirrored) and the box the elbow must stay out of (torso space).
DEFAULT_ARM = dict(palm=(7.875, 17.0, 0.0), chest=dict(half_x=7.0, z=(-5.5, 5.0), y=(19.0, 34.0)))
ARM = dict(DEFAULT_ARM)


def reset(arm=None):
    ANIMS.clear()
    ARM.clear()
    ARM.update(DEFAULT_ARM)
    ARM.update(arm or {})

# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def sn(x):
    return math.sin(x)


def cs(x):
    return math.cos(x)


def pos(v):
    return max(0.0, v)


def setr(p, bone, x=0.0, y=0.0, z=0.0, add=False):
    d = p.setdefault(bone, {})
    if add and "rotation" in d:
        o = d["rotation"]
        d["rotation"] = [o[0] + x, o[1] + y, o[2] + z]
    else:
        d["rotation"] = [x, y, z]


def setp(p, bone, x=0.0, y=0.0, z=0.0):
    p.setdefault(bone, {})["position"] = [x, y, z]


def sets(p, bone, v):
    p.setdefault(bone, {})["scale"] = [v, v, v]


def rot(p, bone):
    return list(p.get(bone, {}).get("rotation", [0.0, 0.0, 0.0]))


FOOT_BONES = ("rightFoot", "leftFoot")


def ground(p, extra=0.0, z=0.0):
    """Move the root so the lowest point of either foot rests on y = 0 (z: optional forward shift)."""
    p.get("root", {}).pop("position", None)
    mats = rig.world_matrices(p)
    low = 1e9
    for fb in FOOT_BONES:
        for c in rig.BONES[fb].cubes:
            for x in (c.frm[0], c.to[0]):
                for y in (c.frm[1], c.to[1]):
                    for zz in (c.frm[2], c.to[2]):
                        low = min(low, rig.to_world(mats, fb, (x, y, zz))[1])
    setp(p, "root", 0.0, -low + extra, z)


def flat_foot(p, side, toe=0.0):
    """Counter-rotate the foot so the sole stays level (toe > 0 points the toes down)."""
    leg, shin = rot(p, f"{side}Leg"), rot(p, f"{side}Shin")
    setr(p, f"{side}Foot", -(leg[0] + shin[0]) + toe, -(leg[1] + shin[1]), -(leg[2] + shin[2]))


# --------------------------------------------------------------------------
# tiny Nelder-Mead + arm IK
# --------------------------------------------------------------------------


def nelder_mead(f, x0, step=8.0, iters=900, tol=1e-7):
    n = len(x0)
    pts = [np.array(x0, float)]
    for i in range(n):
        e = np.array(x0, float)
        e[i] += step
        pts.append(e)
    vals = [f(x) for x in pts]
    for _ in range(iters):
        order = np.argsort(vals)
        pts = [pts[i] for i in order]
        vals = [vals[i] for i in order]
        if abs(vals[-1] - vals[0]) < tol:
            break
        c = np.mean(pts[:-1], axis=0)
        xr = c + (c - pts[-1])
        fr = f(xr)
        if fr < vals[0]:
            xe = c + 2 * (c - pts[-1])
            fe = f(xe)
            pts[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]:
            pts[-1], vals[-1] = xr, fr
        else:
            xc = c + 0.5 * (pts[-1] - c)
            fc = f(xc)
            if fc < vals[-1]:
                pts[-1], vals[-1] = xc, fc
            else:
                for i in range(1, len(pts)):
                    pts[i] = pts[0] + 0.5 * (pts[i] - pts[0])
                    vals[i] = f(pts[i])
    i = int(np.argmin(vals))
    return pts[i], vals[i]



def arm_chain(side):
    return [f"{side}Arm", f"{side}Forearm", f"{side}Hand"]


def palm_center(side):
    x, y, z = ARM["palm"]
    return (S[side] * x, y, z)


def solve_arm(p, side, goal, x0, restarts=1, effector=None, lock_hand=None):
    """Solve arm, forearm and hand rotations so the hand meets goal, and write them into p.

    goal(mats) -> dict(point, normal, fingers, axis, elbow) in world space (any but point may be None).
    effector:  (bone, point, axis) - the point (and optional local axis) that must reach goal["point"]
               (default: the palm centre of the hand).
    lock_hand: fixed hand rotation; only the arm and forearm (6 values) are solved.
    """
    s = S[side]
    names = arm_chain(side)
    fore_b = rig.BONES[f"{side}Forearm"]
    eff_bone, eff_point, eff_axis = effector or (names[2], palm_center(side), None)
    box = ARM["chest"]
    n_dof = 6 if lock_hand is not None else 9

    def apply(v, q):
        setr(q, names[0], *v[0:3])
        setr(q, names[1], *v[3:6])
        setr(q, names[2], *(v[6:9] if lock_hand is None else lock_hand))

    need = names + ["torso", eff_bone] + list(getattr(goal, "bones", ()))

    def cost(v):
        apply(v, p)
        mats = rig.world_matrices(p, need)
        g = goal(mats)
        c = 0.0
        palm = rig.to_world(mats, eff_bone, eff_point)
        c += 4.0 * float(np.sum((palm - g["point"]) ** 2))
        if g.get("normal") is not None:
            nrm = rig.dir_world(mats, names[2], (-s, 0, 0))
            c += 8.0 * (1 - float(nrm @ g["normal"]))
        if g.get("fingers") is not None:
            fd = rig.dir_world(mats, names[2], (0, -1, 0))
            c += 4.0 * (1 - float(fd @ g["fingers"]))
        if g.get("axis") is not None and eff_axis is not None:
            ax = rig.dir_world(mats, eff_bone, eff_axis)
            c += 8.0 * (1 - float(ax @ g["axis"]))
        elbow = rig.to_world(mats, names[1], fore_b.pivot)
        if g.get("elbow") is not None:
            c += 0.25 * float(np.sum((elbow - g["elbow"]) ** 2))
        # keep the elbow out of the chest (checked in torso space)
        tinv = np.linalg.inv(mats["torso"])
        e = (tinv @ np.append(elbow, 1.0))[:3] + np.array(rig.BONES["torso"].pivot)
        if abs(e[0]) < box["half_x"] and box["z"][0] < e[2] < box["z"][1] and box["y"][0] < e[1] < box["y"][1]:
            c += 2.0 * (box["half_x"] - abs(e[0])) ** 2
        fa = v[3:6]
        c += 0.004 * (fa[1] ** 2 + fa[2] ** 2) + 0.02 * pos(fa[0] - 5) ** 2 + 0.02 * pos(-fa[0] - 140) ** 2
        c += 0.002 * sum(pos(abs(a) - 70) ** 2 for a in v[6:9])
        c += 0.00004 * float(np.sum(np.array(v) ** 2))
        return c

    best, best_val = None, 1e18
    starts = [np.array(x0[:n_dof], float)]
    rng = np.random.default_rng(len(side) * 101)
    for _ in range(restarts - 1):
        starts.append(np.array(x0[:n_dof], float) + rng.normal(0, 25, n_dof))
    for st in starts:
        x, val = nelder_mead(cost, st, step=12.0, iters=1600)
        x, val = nelder_mead(cost, x, step=3.0, iters=800)
        if val < best_val:
            best, best_val = x, val
    apply(best, p)
    return list(best), best_val


def bone_goal(bone, point, normal=None, fingers=None, axis=None, elbow=None):
    """IK goal fixed to a bone: point/directions in that bone's authored coordinates,
    elbow hint in torso coordinates."""

    def goal(mats):
        g = {"point": rig.to_world(mats, bone, point)}
        for k, v in (("normal", normal), ("fingers", fingers), ("axis", axis)):
            if v is not None:
                d = rig.dir_world(mats, bone, v)
                g[k] = d / np.linalg.norm(d)
        if elbow is not None:
            g["elbow"] = rig.to_world(mats, "torso", elbow)
        return g

    goal.bones = (bone,)
    return goal


def torso_goal(point, normal=None, fingers=None, elbow=None, axis=None):
    return bone_goal("torso", point, normal=normal, fingers=fingers, axis=axis, elbow=elbow)

# --------------------------------------------------------------------------
# keyframe sampling + reduction
# --------------------------------------------------------------------------


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def eval_keys(keys, t):
    ts = [k[0] for k in keys]
    if t <= ts[0]:
        return np.array(keys[0][1])
    if t >= ts[-1]:
        return np.array(keys[-1][1])
    i = bisect.bisect_right(ts, t) - 1
    a = (t - ts[i]) / (ts[i + 1] - ts[i])
    v = [np.array(k[1]) for k in keys]
    return catmull(v[max(0, i - 1)], v[i], v[i + 1], v[min(len(v) - 1, i + 2)], a)


def reduce_keys(keys, dense, tol):
    """Greedily drop keys while the catmull-rom curve still matches the dense samples."""
    keys = list(keys)
    changed = True
    while changed and len(keys) > 2:
        changed = False
        best_i, best_err = None, None
        for i in range(1, len(keys) - 1):
            trial = keys[:i] + keys[i + 1:]
            err = max(float(np.max(np.abs(eval_keys(trial, t) - np.array(v)))) for t, v in dense)
            if err < tol and (best_err is None or err < best_err):
                best_i, best_err = i, err
        if best_i is not None:
            keys.pop(best_i)
            changed = True
    return keys


def make_clip(name, length, pose_fn, n, loop="loop", tol_rot=0.6, tol_pos=0.05, dense_factor=3):
    print(f"  sampling {name} ...", flush=True)
    times = [length * i / n for i in range(n + 1)]
    poses = [pose_fn(t) for t in times]
    if loop == "loop":
        poses[-1] = poses[0]
    # dense samples (for reduction checks) are interpolated from the full key set
    bones = OrderedDict()
    names = []
    for p in poses:
        for b in p:
            if b not in names:
                names.append(b)
    for b in rig.BONES:
        if b not in names:
            continue
        chans = OrderedDict()
        for ch in ("rotation", "position", "scale"):
            if not any(ch in p.get(b, {}) for p in poses):
                continue
            default = [1.0, 1.0, 1.0] if ch == "scale" else [0.0, 0.0, 0.0]
            vals = [list(p.get(b, {}).get(ch, default)) for p in poses]
            vals = [[round(v, 3) for v in vv] for vv in vals]
            if all(np.allclose(v, vals[0], atol=1e-3) for v in vals):
                if ch == "scale" or not np.allclose(vals[0], default, atol=1e-3):
                    chans[ch] = [(0.0, vals[0], "linear")]
                continue
            keys = [(round(t, 4), v) for t, v in zip(times, vals)]
            dense = []
            for i in range(len(keys) - 1):
                for k in range(dense_factor):
                    tt = keys[i][0] + (keys[i + 1][0] - keys[i][0]) * k / dense_factor
                    dense.append((tt, list(eval_keys(keys, tt))))
            dense.append(keys[-1])
            tol = tol_rot if ch == "rotation" else tol_pos
            keys = reduce_keys(keys, dense, tol)
            chans[ch] = [(t, v, "catmullrom") for t, v in keys]
        if chans:
            bones[b] = chans
    ANIMS[name] = dict(loop=loop, length=length, bones=bones)
