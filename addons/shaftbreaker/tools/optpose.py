"""Tiny pose optimizer over the FK model (adaptive random search)."""
import sys, os, json, math, random
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from animkit import *

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rig = Rig(os.path.join(S, 'src_assets/model/shaftbreaker.geo.json'))
FINGERS_R = [f'finger_right_{i}_{s}' for i in range(1, 5) for s in 'ab'] + ['thumb_right_a', 'thumb_right_b']
HAND_R = ['hand_right'] + FINGERS_R
HAND_L = [mirror_name(b) for b in HAND_R]


def params_to_pose(spec, x, sym=True):
    pose = {}
    for (bone, ch, ax, lo, hi, _), v in zip(spec, x):
        pose.setdefault(bone, {}).setdefault(ch, [0, 0, 0])[ax] = v
        if sym and ('right' in bone):
            mb = mirror_name(bone)
            sgn = 1 if (ch == 'r' and ax == 0) or (ch == 'p' and ax != 0) else -1
            pose.setdefault(mb, {}).setdefault(ch, [0, 0, 0])[ax] = v * sgn
    return pose


def bone_axis(mats, bone, local=(0, -1, 0)):
    m = mats[bone][0]
    v = m[:3, :3] @ np.array(local, float)
    return v / (np.linalg.norm(v) + 1e-9)


def optimize(spec, objective, iters=2500, seed=1, base=None, sym=True, contacts=None):
    rnd = random.Random(seed)
    x = [s[5] for s in spec]
    lo = [s[3] for s in spec]; hi = [s[4] for s in spec]

    def ev(xx):
        p = params_to_pose(spec, xx, sym)
        if base:
            p = merge(base, p)
        p = rig.ground(p, contacts or list(rig.byname.keys()), 0.0)
        return objective(p), p
    best, bp = ev(x)
    sig = 12.0
    fails = 0
    for it in range(iters):
        y = list(x)
        k = rnd.randint(1, 4)
        for _ in range(k):
            i = rnd.randrange(len(y))
            y[i] = min(hi[i], max(lo[i], y[i] + rnd.gauss(0, sig)))
        f, p = ev(y)
        if f < best:
            best, bp, x = f, p, y
            fails = 0
        else:
            fails += 1
            if fails > 60:
                sig = max(1.0, sig * 0.7); fails = 0
    return bp, best, x
