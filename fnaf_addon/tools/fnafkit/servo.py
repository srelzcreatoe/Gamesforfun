"""Animatronic ("night") motion: servo-style move-and-hold timing.

Real show animatronics don't move like people.  Every joint is driven by its own
servo or pneumatic actuator that jumps to a new position, stops dead (with a
small overshoot) and holds.  This module turns any smooth pose function into
that kind of motion:

  * servo_time() warps time into steps: each step the motion is covered quickly,
    then held until the next step.
  * Mechanical() splits the rig into groups (head, torso, each arm, legs, jaw,
    ears, tail ...) and gives every group its own step timing, so the head snaps
    at different moments from the arms, like separate actuators.
  * make_linear_clip() samples the result at 24 fps with linear keyframes (no
    smoothing, so holds stay dead still) and drops redundant keys.

Base pose functions used with Mechanical() call meta() instead of
anim.ground(); the feet are grounded after the groups are merged.
"""
import math

import numpy as np

from . import anim, rig

FPS = 24


def servo_time(t, step, move, phase=0.0, overshoot=0.06, settle=0.08):
    """Warp time so the motion advances in steps.

    Every `step` seconds the motion covers one step's worth of the underlying
    animation in `move` seconds (eased), overshoots a little, settles within
    `settle` seconds and then holds still until the next step.
    """
    u = t - phase
    k = math.floor(u / step + 1e-9)
    local = u - k * step
    if local < move:
        x = local / move
        s = x * x * (3 - 2 * x)
    else:
        s = 1.0
        d = local - move
        if overshoot and d < settle:
            s += overshoot * math.sin(math.pi * d / settle) * (1 - d / settle)
    return phase + (k + s) * step


def stepper(step, move, phase=0.0, overshoot=0.06, settle=0.08):
    return lambda t: servo_time(t, step, move, phase, overshoot, settle)


def smooth():
    """No stepping (continuous motion), e.g. for legs while walking."""
    return lambda t: t


def meta(p, extra=0.0, z=0.0):
    """Record ground-contact settings for Mechanical (airborne lift, forward shift)."""
    p["_meta"] = {"position": [extra, 0.0, z]}


def default_group(bone):
    if bone in ("_meta", "root") or any(k in bone for k in ("Leg", "Shin", "Foot")):
        return "legs"
    if bone in ("body", "torso"):
        return "torso"
    if bone == "jaw":
        return "jaw"
    if "Ear" in bone:
        return "ears"
    if bone.startswith("tail"):
        return "tail"
    if "Wing" in bone:
        return "wings"
    if "Horn" in bone:
        return "head"
    if bone.startswith("right") or bone == "mic":
        return "armR"
    if bone.startswith("left"):
        return "armL"
    if bone in ("head", "hat", "eyes") or bone.startswith("head"):
        return "head"
    return "torso"


class PoseCache:
    """Samples a pose function on an even grid (in time order, so IK warm starts stay
    coherent) and interpolates it with catmull-rom at any time."""

    def __init__(self, pose_fn, length, n, loop):
        self.length, self.n, self.loop = length, n, loop
        poses = [pose_fn(length * i / n) for i in range(n + 1)]
        if loop:
            poses[-1] = poses[0]
        self.tracks = {}
        for p in poses:
            for b, chans in p.items():
                for ch in chans:
                    self.tracks.setdefault((b, ch), None)
        for (b, ch) in self.tracks:
            default = [1.0, 1.0, 1.0] if ch == "scale" else [0.0, 0.0, 0.0]
            self.tracks[(b, ch)] = np.array([p.get(b, {}).get(ch, default) for p in poses], float)

    def at(self, t):
        L, n = self.length, self.n
        if self.loop:
            t = t % L
        else:
            t = min(max(t, 0.0), L)
        x = t / L * n
        i = min(int(math.floor(x)), n - 1)
        a = x - i

        if self.loop:
            def get(j):
                return j % n
        else:
            def get(j):
                return min(max(j, 0), n)
        i0, i1, i2, i3 = get(i - 1), get(i), get(i + 1), get(i + 2)
        a2, a3 = a * a, a * a * a
        w0 = 0.5 * (-a + 2 * a2 - a3)
        w1 = 0.5 * (2 - 5 * a2 + 3 * a3)
        w2 = 0.5 * (a + 4 * a2 - 3 * a3)
        w3 = 0.5 * (-a2 + a3)
        out = {}
        for (b, ch), arr in self.tracks.items():
            v = w0 * arr[i0] + w1 * arr[i1] + w2 * arr[i2] + w3 * arr[i3]
            out.setdefault(b, {})[ch] = [float(c) for c in v]
        return out


class Mechanical:
    """Pose function that plays each bone group of `base` on its own servo schedule.

    `post(p, t)` runs on the merged pose in real time (not warped): use it for
    twitches, jaw clacks and shakes that must keep their exact timing.
    """

    def __init__(self, base, length, n_base, loop, warps, group_of=default_group, post=None):
        self.cache = PoseCache(base, length, n_base, loop)
        self.warps = warps
        self.group_of = group_of
        self.post = post

    def __call__(self, t):
        out = {}
        evaluated = {}
        bones = {b for (b, _) in self.cache.tracks}
        for b in bones:
            g = self.group_of(b)
            warp = self.warps.get(g, self.warps.get("*"))
            key = g if g in self.warps else "*"
            if key not in evaluated:
                evaluated[key] = self.cache.at(warp(t) if warp else t)
            out[b] = evaluated[key][b]
        out = {b: {ch: list(v) for ch, v in chans.items()} for b, chans in out.items()}
        if self.post:
            self.post(out, t)
        m = out.pop("_meta", {"position": [0.0, 0.0, 0.0]})["position"]
        out.pop("root", None)
        anim.ground(out, extra=m[0], z=m[2])
        return out


def add_rot(p, bone, x=0.0, y=0.0, z=0.0):
    d = p.setdefault(bone, {})
    r = d.get("rotation", [0.0, 0.0, 0.0])
    d["rotation"] = [r[0] + x, r[1] + y, r[2] + z]


def rdp(times, vals, tol):
    """Indices of the keys to keep so linear interpolation stays within tol of every sample."""
    n = len(times)
    keep = {0, n - 1}
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        span = (times[a + 1:b] - times[a]) / (times[b] - times[a])
        seg = vals[a] + (vals[b] - vals[a]) * span[:, None]
        err = np.max(np.abs(vals[a + 1:b] - seg), axis=1)
        i = int(np.argmax(err))
        if err[i] > tol:
            m = a + 1 + i
            keep.add(m)
            stack += [(a, m), (m, b)]
    return sorted(keep)


def make_linear_clip(name, length, pose_fn, loop="loop", tol_rot=0.35, tol_pos=0.03):
    """Sample pose_fn on Blockbench's 24 fps grid and store linear keyframes."""
    print(f"  sampling {name} ...", flush=True)
    n = int(round(length * FPS))
    times = np.array([round(i / FPS, 4) for i in range(n + 1)])
    poses = [pose_fn(i / FPS) for i in range(n + 1)]
    if loop == "loop":
        poses[-1] = poses[0]
    bones = {}
    for b in rig.BONES:
        chans = {}
        for ch in ("rotation", "position", "scale"):
            if not any(ch in p.get(b, {}) for p in poses):
                continue
            default = [1.0, 1.0, 1.0] if ch == "scale" else [0.0, 0.0, 0.0]
            vals = np.round(np.array([p.get(b, {}).get(ch, default) for p in poses], float), 3)
            if np.allclose(vals, vals[0], atol=1e-3):
                if ch == "scale" or not np.allclose(vals[0], default, atol=1e-3):
                    chans[ch] = [(0.0, list(vals[0]), "linear")]
                continue
            tol = tol_rot if ch == "rotation" else tol_pos
            chans[ch] = [(float(times[i]), list(vals[i]), "linear") for i in rdp(times, vals, tol)]
        if chans:
            bones[b] = chans
    anim.ANIMS[name] = dict(loop=loop, length=length, bones=bones)
