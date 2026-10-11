"""Bonnie's animations.

Every clip is written as a pose function  pose(t) -> {bone: {channel: [x, y, z]}}
using Bedrock / Blockbench animation values:

  rotation x > 0  swings a hanging limb backward  (tilts an upright bone forward)
  rotation z > 0  swings a hanging limb toward the character's right (+X)
  rotation y > 0  turns the front toward the character's right
  position x > 0  moves toward the character's LEFT, y up, z > 0 backward

The pose function is sampled into keyframes, the feet are kept on the ground
with forward kinematics, the hands are kept on the banjo with a small IK
solver, and redundant keyframes are dropped so the result stays editable in
Blockbench's timeline.
"""
import bisect
import math
from collections import OrderedDict

import numpy as np

import rig

ANIMS = OrderedDict()
TAU = 2 * math.pi
S = {"right": 1, "left": -1}

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


def ground(p, extra=0.0):
    """Move the root so the lowest point of either foot rests on y = 0."""
    p.get("root", {}).pop("position", None)
    mats = rig.world_matrices(p)
    low = 1e9
    for fb in FOOT_BONES:
        for c in rig.BONES[fb].cubes:
            for x in (c.frm[0], c.to[0]):
                for y in (c.frm[1], c.to[1]):
                    for z in (c.frm[2], c.to[2]):
                        low = min(low, rig.to_world(mats, fb, (x, y, z))[1])
    setp(p, "root", 0.0, -low + extra, 0.0)


def flat_foot(p, side, toe=0.0):
    """Counter-rotate the foot so the sole stays level (toe > 0 points the toes down)."""
    leg, shin = rot(p, f"{side}Leg"), rot(p, f"{side}Shin")
    setr(p, f"{side}Foot", -(leg[0] + shin[0]) + toe, -(leg[1] + shin[1]), -(leg[2] + shin[2]))


def hide_banjo(p):
    sets(p, "banjo", 0)


def performance_eyes(p):
    sets(p, "eyesNormal", 0)
    setp(p, "eyesPerformance", 0, 0, -0.4)


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
    return (S[side] * 7.875, 17.0, 0.0)


def solve_arm(p, side, goal, x0, restarts=1):
    """goal(mats) -> dict(point, normal, fingers, elbow) in world space (any may be None).

    Solves rotations for arm, forearm and hand (9 values) and writes them into p.
    """
    s = S[side]
    names = arm_chain(side)
    hand_b = rig.BONES[f"{side}Hand"]
    fore_b = rig.BONES[f"{side}Forearm"]

    def apply(v, q):
        setr(q, names[0], *v[0:3])
        setr(q, names[1], *v[3:6])
        setr(q, names[2], *v[6:9])

    need = names + ["banjo", "torso"]

    def cost(v):
        apply(v, p)
        mats = rig.world_matrices(p, need)
        g = goal(mats)
        c = 0.0
        palm = rig.to_world(mats, names[2], palm_center(side))
        c += 4.0 * float(np.sum((palm - g["point"]) ** 2))
        if g.get("normal") is not None:
            nrm = rig.dir_world(mats, names[2], (-s, 0, 0))
            c += 8.0 * (1 - float(nrm @ g["normal"]))
        if g.get("fingers") is not None:
            fd = rig.dir_world(mats, names[2], (0, -1, 0))
            c += 4.0 * (1 - float(fd @ g["fingers"]))
        elbow = rig.to_world(mats, names[1], fore_b.pivot)
        if g.get("elbow") is not None:
            c += 0.25 * float(np.sum((elbow - g["elbow"]) ** 2))
        # keep the elbow out of the chest (checked in torso space)
        tinv = np.linalg.inv(mats["torso"])
        e = (tinv @ np.append(elbow, 1.0))[:3] + np.array(rig.BONES["torso"].pivot)
        if abs(e[0]) < 7.0 and -5.5 < e[2] < 5.0 and 19.0 < e[1] < 34.0:
            c += 2.0 * (7.0 - abs(e[0])) ** 2
        fa = v[3:6]
        c += 0.004 * (fa[1] ** 2 + fa[2] ** 2) + 0.02 * pos(fa[0] - 5) ** 2 + 0.02 * pos(-fa[0] - 140) ** 2
        c += 0.002 * sum(pos(abs(a) - 70) ** 2 for a in v[6:9])
        c += 0.00004 * float(np.sum(np.array(v) ** 2))
        return c

    best, best_val = None, 1e18
    starts = [np.array(x0, float)]
    rng = np.random.default_rng(len(side) * 101)
    for _ in range(restarts - 1):
        starts.append(np.array(x0, float) + rng.normal(0, 25, 9))
    for st in starts:
        x, val = nelder_mead(cost, st, step=12.0, iters=1600)
        x, val = nelder_mead(cost, x, step=3.0, iters=800)
        if val < best_val:
            best, best_val = x, val
    apply(best, p)
    return list(best), best_val


def banjo_goal(local_point, local_normal=None, local_fingers=None, elbow=None):
    P = rig.BANJO_PIVOT

    def goal(mats):
        lp = (local_point[0] + P[0], local_point[1] + P[1], local_point[2] + P[2])
        g = {"point": rig.to_world(mats, "banjo", lp)}
        if local_normal is not None:
            n = rig.dir_world(mats, "banjo", local_normal)
            g["normal"] = n / np.linalg.norm(n)
        if local_fingers is not None:
            fdir = rig.dir_world(mats, "banjo", local_fingers)
            g["fingers"] = fdir / np.linalg.norm(fdir)
        if elbow is not None:
            g["elbow"] = rig.to_world(mats, "torso", elbow)
        return g

    return goal


def torso_goal(point, normal=None, fingers=None, elbow=None):
    def goal(mats):
        g = {"point": rig.to_world(mats, "torso", point)}
        for k, v in (("normal", normal), ("fingers", fingers)):
            if v is not None:
                d = rig.dir_world(mats, "torso", v)
                g[k] = d / np.linalg.norm(d)
        if elbow is not None:
            g["elbow"] = rig.to_world(mats, "torso", elbow)
        return g

    return goal


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


# --------------------------------------------------------------------------
# clips
# --------------------------------------------------------------------------


def idle(t):
    L = 4.0
    w = TAU * t / L
    p = {}
    hide_banjo(p)
    setr(p, "body", 0, 0, 0)
    setr(p, "torso", 1.2 * sn(w), 0, 0)
    setp(p, "torso", 0, 0.12 * sn(w), 0)
    setr(p, "head", 2.0 * sn(w + 0.6), 7.0 * sn(w * 0.5 + 0.4) , 1.5 * sn(w * 0.5))
    setr(p, "jaw", 1.5 + 1.5 * sn(w * 2), 0, 0)
    for side in ("right", "left"):
        s = S[side]
        ph = 0 if s > 0 else 0.7
        setr(p, f"{side}Arm", 2.0 * sn(w + ph), 0, s * (1.0 + 1.2 * sn(w + ph)))
        setr(p, f"{side}Forearm", -5.0 - 2.0 * sn(w + ph), 0, 0)
        setr(p, f"{side}Hand", 0, 0, s * 2.0 * sn(w + ph + 0.5))
        setr(p, f"{side}Fingers", 4.0 * sn(w * 0.5 + ph), 0, 0)
        setr(p, f"{side}Leg", 0, 0, s * 1.0)
        setr(p, f"{side}Shin", 0, 0, 0)
        flat_foot(p, side)
        setr(p, f"{side}Ear", -2.0 * sn(w + ph), 0, s * 1.5 * sn(w * 2 + ph))
        setr(p, f"{side}EarTip", -3.0 * sn(w * 2 + ph + 1.0), 0, 0)
    ground(p)
    return p


def walk(t):
    L = 1.25
    f = TAU * t / L
    p = {}
    hide_banjo(p)
    for side in ("right", "left"):
        s = S[side]
        ph = f if s > 0 else f + math.pi
        th = -24.0 * sn(ph)
        bend = 6.0 + 34.0 * pos(cs(ph + 0.35)) ** 1.4
        setr(p, f"{side}Leg", th, 0, s * 1.0)
        setr(p, f"{side}Shin", bend, 0, 0)
        flat_foot(p, side, toe=-10.0 * sn(ph))
        setr(p, f"{side}Arm", 18.0 * sn(ph), 0, s * (1.5 + 1.5 * pos(-sn(ph))))
        setr(p, f"{side}Forearm", -10.0 - 10.0 * pos(-sn(ph)), 0, 0)
        setr(p, f"{side}Hand", 4.0 * sn(ph - 0.6), 0, 0)
        setr(p, f"{side}Ear", 3.0 * sn(2 * f - 1.0), 0, s * 2.0 * cs(f))
        setr(p, f"{side}EarUpper", 2.0 * sn(2 * f - 1.4), 0, 0)
        setr(p, f"{side}EarTip", 5.0 * sn(2 * f - 1.8), 0, 0)
    setr(p, "body", 0, -5.0 * sn(f), 3.0 * cs(f))
    setp(p, "body", 0.4 * cs(f), 0, 0)
    setr(p, "torso", 2.0, 10.0 * sn(f), -1.5 * cs(f))
    setr(p, "head", 2.0 + 2.0 * cs(2 * f), -6.0 * sn(f), -2.0 * cs(f))
    setr(p, "jaw", 2.0, 0, 0)
    ground(p)
    return p


def run(t):
    L = 0.75
    f = TAU * t / L
    p = {}
    hide_banjo(p)
    for side in ("right", "left"):
        s = S[side]
        ph = f if s > 0 else f + math.pi
        th = -12.0 - 42.0 * sn(ph)
        bend = 16.0 + 84.0 * pos(cs(ph + 0.45)) ** 1.2
        setr(p, f"{side}Leg", th, 0, s * 2.0)
        setr(p, f"{side}Shin", bend, 0, 0)
        flat_foot(p, side, toe=-14.0 * sn(ph) + 6.0)
        setr(p, f"{side}Arm", 50.0 * sn(ph) - 8.0, 0, s * 6.0)
        setr(p, f"{side}Forearm", -78.0 + 14.0 * sn(ph), 0, 0)
        setr(p, f"{side}Hand", 6.0 * sn(ph), 0, 0)
        setr(p, f"{side}Fingers", 15.0, 0, 0)
        setr(p, f"{side}Ear", 14.0 + 6.0 * sn(2 * f - 1.2), 0, s * 3.0 * cs(f))
        setr(p, f"{side}EarUpper", 6.0 + 4.0 * sn(2 * f - 1.6), 0, 0)
        setr(p, f"{side}EarTip", 8.0 + 8.0 * sn(2 * f - 2.0), 0, 0)
    setr(p, "body", 12.0, -6.0 * sn(f), 2.0 * cs(f))
    setr(p, "torso", 4.0, 12.0 * sn(f), 0)
    setr(p, "head", -14.0 + 3.0 * cs(2 * f), -8.0 * sn(f), 0)
    setr(p, "jaw", 6.0, 0, 0)
    ground(p, extra=1.2 * pos(sn(2 * f + 0.9)))
    return p


def wave_pose(t):
    L = 2.0
    w = TAU * t / L
    p = {}
    hide_banjo(p)
    setr(p, "torso", 0, -4.0, -2.0)
    setr(p, "head", 3.0 * sn(w * 2), 8.0, -6.0 + 2.0 * sn(w))
    setr(p, "jaw", 4.0 + 4.0 * pos(sn(w * 2)), 0, 0)
    # left arm relaxed
    setr(p, "leftArm", -4.0, 0, -2.0)
    setr(p, "leftForearm", -14.0, 0, 0)
    setr(p, "leftHand", 0, 0, -4.0)
    for side in ("right", "left"):
        s = S[side]
        setr(p, f"{side}Leg", 0, 0, s * 1.5)
        flat_foot(p, side)
    setr(p, "rightEar", 0, 0, -6.0 + 4.0 * sn(w * 2))
    setr(p, "rightEarTip", 6.0 * sn(w * 2 + 1.0), 0, 0)
    setr(p, "leftEar", 0, 0, 3.0 * sn(w * 2 + 0.5))
    # right hand waves beside the head, palm toward the viewer
    swing = sn(w * 2)
    ang = math.radians(16.0 * swing)
    goal = torso_goal((12.5 + 1.6 * swing, 41.0, -4.0), normal=(0, 0, 1),
                      fingers=(-math.sin(ang), -math.cos(ang), 0), elbow=(13.5, 30.0, -1.0))
    x0 = wave_pose.last or [0, 0, 80, -10, 0, 70, 0, 80, 0]
    wave_pose.last, _ = solve_arm(p, "right", goal, x0, restarts=1 if wave_pose.last else 6)
    setr(p, "rightFingers", -10.0, 0, 0)
    setr(p, "rightThumb", 0, 0, 20.0)
    ground(p)
    return p


wave_pose.last = None


def cool_pose(t):
    L = 2.0
    w = TAU * t / L
    p = {}
    hide_banjo(p)
    setr(p, "body", 0, 8.0, -6.0)
    setp(p, "body", -0.6, 0, 0)
    setr(p, "torso", -2.0 + 1.0 * sn(w), -6.0, 9.0)
    setr(p, "head", -4.0 + 1.5 * sn(w + 0.5), 10.0, -14.0)
    setr(p, "jaw", 3.0, 0, 0)
    # right leg kicked out to the side, heel down
    setr(p, "rightLeg", -14.0, -10.0, 18.0)
    setr(p, "rightShin", 4.0, 0, 0)
    flat_foot(p, "right", toe=-14.0)
    setr(p, "leftLeg", 3.0, 6.0, -2.0)
    setr(p, "leftShin", 2.0, 0, 0)
    flat_foot(p, "left")
    # loose right arm
    setr(p, "rightArm", -12.0 + 1.5 * sn(w), 0, 4.0)
    setr(p, "rightForearm", -28.0, 0, 6.0)
    setr(p, "rightHand", 0, 0, 8.0)
    setr(p, "rightFingers", 10.0, 0, 0)
    # floppy ear like the sheet
    setr(p, "rightEar", 0, 0, -22.0)
    setr(p, "rightEarUpper", 0, 0, -38.0)
    setr(p, "rightEarTip", -10.0 + 4.0 * sn(w), 0, -28.0)
    setr(p, "leftEar", 0, 0, -18.0)
    setr(p, "leftEarUpper", 0, 0, -10.0)
    setr(p, "leftEarTip", 10.0, 0, -30.0)
    # left hand on the hip, elbow out
    goal = torso_goal((-6.6, 21.5, -0.5), normal=(1, 0, 0), fingers=(0, -0.35, -1), elbow=(-13.0, 26.5, 1.5))
    x0 = cool_pose.last or [10, 0, -40, -70, 0, 0, 0, 0, 0]
    cool_pose.last, _ = solve_arm(p, "left", goal, x0, restarts=1 if cool_pose.last else 6)
    ground(p)
    return p


cool_pose.last = None


def performance(t, energetic=False):
    """Bonnie plays the banjo.  4 beats per 2 s loop (120 BPM), strumming in eighths."""
    L = 2.0
    beat = TAU * t / 0.5
    w = TAU * t / L
    p = {}
    performance_eyes(p)
    st = performance.state.setdefault(energetic, {})
    if not energetic:
        dip = 0.5 - 0.5 * cs(beat)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Leg", -8.0 - 6.0 * dip, s * 6.0, s * 9.0)
            setr(p, f"{side}Shin", 14.0 + 12.0 * dip, 0, 0)
            flat_foot(p, side)
        setr(p, "body", 2.0, 0, 2.5 * sn(beat / 2))
        setr(p, "torso", 2.0, 5.0 * sn(w), 2.0 * sn(beat / 2))
        setr(p, "head", 4.0 + 7.0 * dip, 8.0 * sn(w + 0.4), -5.0 * sn(beat / 2))
        setr(p, "jaw", 9.0 * pos(sn(beat - 0.6)), 0, 0)
        setr(p, "banjo", 0, 0, 0)
        strum = cs(beat * 2)
        chord = -12.0 if (t % 2.0) < 1.0 else -10.0
        ears = 1.0
    else:
        dip = 0.5 - 0.5 * cs(beat)
        setr(p, "rightLeg", 2.0, 10.0, 16.0)
        setr(p, "rightShin", 4.0, 0, 0)
        flat_foot(p, "right", toe=-16.0 * pos(sn(beat)))
        setr(p, "leftLeg", -22.0 - 5.0 * dip, -10.0, -8.0)
        setr(p, "leftShin", 30.0 + 10.0 * dip, 0, 0)
        flat_foot(p, "left")
        setr(p, "body", -5.0, -6.0, 4.0 + 2.0 * sn(beat / 2))
        setr(p, "torso", -5.0 + 2.0 * dip, -4.0 + 5.0 * sn(w), 3.0 * sn(beat / 2))
        setr(p, "head", 2.0 + 12.0 * dip, -6.0 + 6.0 * sn(w), 10.0 + 3.0 * sn(beat / 2))
        setr(p, "jaw", 12.0 * pos(sn(beat - 0.5)), 0, 0)
        setr(p, "banjo", 4.0 * sn(beat / 2), 0, -10.0 - 4.0 * sn(w))
        strum = cs(beat * 2)
        chord = (-12.5, -10.0, -11.0, -9.0)[int((t % 2.0) // 0.5)]
        ears = 1.8
    for side in ("right", "left"):
        s = S[side]
        ph = 0.0 if s > 0 else 0.5
        setr(p, f"{side}Ear", 4.0 * ears * cs(beat + 1.0 + ph), 0, s * 2.0 * ears * sn(beat / 2))
        setr(p, f"{side}EarUpper", 3.0 * ears * cs(beat + 0.6 + ph), 0, 0)
        setr(p, f"{side}EarTip", 6.0 * ears * cs(beat + 0.2 + ph), 0, 0)
    # strumming hand over the strings near the neck joint
    swing = 1.3 if energetic else 1.0
    g_r = banjo_goal((0.5 + 0.3 * strum, 0.3 * swing * strum, -2.05),
                     local_normal=(0, 0, 1), local_fingers=(0.35, -1.0, 0.0), elbow=(10.5, 26.0, -1.0))
    x0 = st.get("right") or [-35, 25, 15, -55, 10, 0, 20, -20, 10]
    st["right"], _ = solve_arm(p, "right", g_r, x0, restarts=1 if st.get("right") else 8)
    setr(p, "rightFingers", 18.0 + 6.0 * strum, 0, 0)
    # fretting hand under the neck, palm up toward the fingerboard
    slide = st.get("chord", chord)
    slide += (chord - slide) * 0.55
    st["chord"] = slide
    g_l = banjo_goal((slide, -2.15, -0.1), local_normal=(0, 1, 0), local_fingers=(0.25, 0.1, -1.0),
                     elbow=(-11.0, 24.0, -3.0))
    x0 = st.get("left") or [-60, -30, -20, -60, 0, 0, 30, 40, 0]
    st["left"], _ = solve_arm(p, "left", g_l, x0, restarts=1 if st.get("left") else 8)
    setr(p, "leftFingers", 25.0 + 8.0 * sn(beat), 0, 0)
    setr(p, "leftThumb", 0, 0, -15.0)
    ground(p)
    return p


performance.state = {}


def build():
    ANIMS.clear()
    wave_pose.last = None
    cool_pose.last = None
    performance.state = {}
    # key times all land on Blockbench's 24 fps snapping grid
    make_clip("animation.bonnie.idle", 4.0, idle, 16)
    make_clip("animation.bonnie.walk", 1.25, walk, 15)
    make_clip("animation.bonnie.run", 0.75, run, 18)
    make_clip("animation.bonnie.pose1", 2.0, wave_pose, 16)
    make_clip("animation.bonnie.pose2", 2.0, cool_pose, 8)
    make_clip("animation.bonnie.performance1", 2.0, lambda t: performance(t, False), 48)
    make_clip("animation.bonnie.performance2", 2.0, lambda t: performance(t, True), 48)
