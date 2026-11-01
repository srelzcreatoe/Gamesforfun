"""Small posing toolkit on top of fk.Skeleton, used by the generator to fit poses to each skeleton:
a deterministic minimiser, oriented-box penetration between bone groups (the same separating-axis test as
tools/entities/check_hands.mjs), bone groups and the eye point.

Coordinates are model pixels with Bedrock axes: +y up, the model's front is -z (so "forward" = -z).
"""
import math
import numpy as np

from fk import rot

PROPS = ('right_maraca', 'left_maraca', 'right_cane', 'microphone', 'guitar')


# ------------------------------------------------------------------ minimiser
def minimize(f, x0, steps, lo=None, hi=None, iters=60, restarts=3, seed=7):
    """Coordinate descent with step halving and a few deterministic restarts around the best point."""
    rng = np.random.default_rng(seed)
    n = len(x0)
    lo = [-1e9] * n if lo is None else lo
    hi = [1e9] * n if hi is None else hi
    clamp = lambda x: [min(max(v, lo[i]), hi[i]) for i, v in enumerate(x)]
    best_x = clamp(list(x0))
    best_c = f(best_x)
    for r in range(restarts):
        x = best_x[:] if r == 0 else clamp([v + (rng.random() - 0.5) * steps[i] * 4 for i, v in enumerate(best_x)])
        c = f(x)
        st = list(steps)
        for _ in range(iters):
            improved = False
            for i in range(n):
                for s in (1, -1):
                    y = x[:]
                    y[i] += s * st[i]
                    y = clamp(y)
                    cy = f(y)
                    if cy < c:
                        x, c, improved = y, cy, True
            if not improved:
                st = [v / 2 for v in st]
                if all(v < steps[i] / 64 for i, v in enumerate(st)):
                    break
        if c < best_c:
            best_x, best_c = x, c
    return best_x, best_c


# ------------------------------------------------------------------ bone groups
class Rig:
    def __init__(self, skel):
        self.sk = skel
        self.bones = skel.bones
        kids = {}
        for n, b in self.bones.items():
            kids.setdefault(b.get('parent'), []).append(n)
        self._kids = kids

    def under(self, bone):
        out, stack = [], [bone]
        while stack:
            n = stack.pop()
            if n not in self.bones:
                continue
            out.append(n)
            stack.extend(self._kids.get(n, []))
        return out

    def has(self, b):
        return b in self.bones

    def legs(self, side=None):
        sides = (side,) if side else ('right', 'left')
        return [b for s in sides for b in self.under(f'{s}_leg')]

    def arm(self, side, props=False):
        return [b for b in self.under(f'{side}_arm') if props or b not in PROPS]

    def forearm(self, side, props=False):
        return [b for b in self.under(f'{side}_forearm') if props or b not in PROPS]

    def hand(self, side, props=False):
        return [b for b in self.under(f'{side}_hand') if props or b not in PROPS]

    def head(self):
        return self.under('head')

    def tail(self):
        return [b for b in self.bones if b.startswith('tail')]

    def props(self):
        return [b for b in PROPS if b in self.bones]

    def body(self):
        """Everything but the arms, the props and the head."""
        skip = set(self.arm('right', True) + self.arm('left', True) + self.head() + self.props())
        return [b for b in self.bones if b not in skip]

    def solid(self):
        return [b for b in self.bones if len(self.sk._local_corners(b))]


# ------------------------------------------------------------------ boxes
_LOCAL = {}


def _local_boxes(sk, bone):
    """Per cube of a bone (cached): centre relative to the bone pivot, rotation, half size."""
    key = (id(sk), bone)
    if key not in _LOCAL:
        b = sk.bones[bone]
        piv = np.array(b.get('pivot', [0, 0, 0]), float)
        out = []
        for c in b.get('cubes', []):
            o = np.array(c['origin'], float)
            s = np.array(c['size'], float)
            half = s / 2 + c.get('inflate', 0)
            if np.any(half < 0.01):
                continue
            centre = o + s / 2
            Rc = np.eye(3)
            if c.get('rotation'):
                cp = np.array(c.get('pivot', [0, 0, 0]), float)
                Rc = rot(c['rotation'])
                centre = cp + Rc @ (centre - cp)
            out.append((centre - piv, Rc, half))
        _LOCAL[key] = out
    return _LOCAL[key]


def obbs(sk, W, bones):
    """Oriented boxes (centre, axes 3x3 as rows, half sizes) of every cube of the bones."""
    out = []
    for bn in bones:
        R, O = W[bn]
        for c, Rc, half in _local_boxes(sk, bn):
            out.append((O + R @ c, (R @ Rc).T, half))
    return out


def _depth(A, B):
    ca, Aa, ha = A
    cb, Bb, hb = B
    d = cb - ca
    cr = np.cross(Aa[:, None, :], Bb[None, :, :]).reshape(9, 3)
    axes = np.vstack([Aa, Bb, cr])
    n = np.linalg.norm(axes, axis=1)
    ok = n > 1e-6
    axes = axes[ok] / n[ok][:, None]
    ra = np.abs(axes @ Aa.T) @ ha
    rb = np.abs(axes @ Bb.T) @ hb
    ov = ra + rb - np.abs(axes @ d)
    m = float(ov.min())
    return m if m > 0 else 0.0


def penetration(sk, W, bones_a, bones_b):
    """Deepest overlap (model px) between any cube of bones_a and any cube of bones_b."""
    A = obbs(sk, W, bones_a)
    B = obbs(sk, W, bones_b)
    if not A or not B:
        return 0.0
    ca = np.array([a[0] for a in A])
    cb = np.array([b[0] for b in B])
    ra = np.array([np.linalg.norm(a[2]) for a in A])
    rb = np.array([np.linalg.norm(b[2]) for b in B])
    dist = np.linalg.norm(ca[:, None, :] - cb[None, :, :], axis=2)
    cand = np.argwhere(dist < ra[:, None] + rb[None, :])
    m = 0.0
    for i, j in cand:
        m = max(m, _depth(A[i], B[j]))
    return m


_REST = {}


def excess(sk, W, bones_a, bones_b):
    """penetration() minus the overlap the two groups already have in the rest pose (shoulder joints...)."""
    key = (id(sk), tuple(bones_a), tuple(bones_b))
    if key not in _REST:
        _REST[key] = penetration(sk, sk.world({}), bones_a, bones_b)
    return max(0.0, penetration(sk, W, bones_a, bones_b) - _REST[key])


def extent(sk, W, bones, axis):
    """(min, max) of the cube corners along an axis (0 x, 1 y, 2 z)."""
    vals = [sk.cube_corners(W, b)[:, axis] for b in bones if len(sk._local_corners(b))]
    if not vals:
        return 0.0, 0.0
    v = np.concatenate(vals)
    return float(v.min()), float(v.max())


def forward_profile(sk, W, bones, y_max):
    """Front-most point (forward = -z, px) of the parts below the height y_max."""
    best = -math.inf
    for b in bones:
        if not len(sk._local_corners(b)):
            continue
        c = sk.cube_corners(W, b)
        sel = c[c[:, 1] < y_max]
        if len(sel):
            best = max(best, float(-sel[:, 2].min()))
    return best


# ------------------------------------------------------------------ eyes
def eye_point(geo_g, mask):
    """(bone, model point) at the centre of the eye pixels: the face cube whose north face carries them."""
    best = None
    for b in geo_g['bones']:
        for c in b.get('cubes', []):
            uv = c.get('uv')
            if not isinstance(uv, dict) or 'north' not in uv:
                continue
            u, v = uv['north']['uv']
            us, vs = uv['north']['uv_size']
            x0, x1 = sorted([int(math.floor(u)), int(math.ceil(u + us))])
            y0, y1 = sorted([int(math.floor(v)), int(math.ceil(v + vs))])
            sub = mask[y0:y1, x0:x1]
            if not sub.any():
                continue
            ys, xs = np.nonzero(sub)
            fx = ((xs + x0 + 0.5) - u).mean() / us
            fy = ((ys + y0 + 0.5) - v).mean() / vs
            p = [c['origin'][0] + c['size'][0] * (1 - fx), c['origin'][1] + c['size'][1] * (1 - fy), c['origin'][2]]
            n = int(sub.sum())
            if best is None or n > best[2]:
                best = (b['name'], p, n)
    return best[0], best[1]


# ------------------------------------------------------------------ keyframe helpers
def first_key(ch):
    if isinstance(ch, dict) and not ('pre' in ch or 'post' in ch):
        k = sorted(ch, key=float)[0]
        v = ch[k]
    else:
        v = ch
    if isinstance(v, dict):
        v = v.get('post', v.get('pre'))
    if not isinstance(v, list):
        v = [v, v, v]
    return [float(x) for x in v]


def static_pose(anim):
    """Every rotation / position channel of an animation at its first keyframe."""
    out = {}
    for b, chs in anim['bones'].items():
        for c in ('rotation', 'position'):
            if c in chs:
                out.setdefault(b, {})[c] = first_key(chs[c])
    return out


def r3(v):
    return [round(float(x), 2) for x in v]


def _val(v):
    if isinstance(v, dict):
        v = v.get('post', v.get('pre'))
    if not isinstance(v, list):
        v = [v, v, v]
    return [float(x) for x in v]


def sample_channel(ch, t):
    """Linear sample of a channel at time t (static values, keyframe dicts, pre/post)."""
    if isinstance(ch, dict) and not ('pre' in ch or 'post' in ch):
        ks = sorted(ch, key=float)
        if t <= float(ks[0]):
            return _val(ch[ks[0]])
        if t >= float(ks[-1]):
            return _val(ch[ks[-1]])
        for a, b in zip(ks, ks[1:]):
            if float(a) <= t <= float(b):
                f = (t - float(a)) / (float(b) - float(a))
                va, vb = _val(ch[a]), _val(ch[b])
                return [x + (y - x) * f for x, y in zip(va, vb)]
    return _val(ch)


def anim_pose(anim, t):
    """Every rotation / position channel of an animation at time t."""
    out = {}
    for b, chs in anim['bones'].items():
        for c in ('rotation', 'position'):
            if c in chs:
                out.setdefault(b, {})[c] = sample_channel(chs[c], t)
    return out


def lerp_pose(a, b, w):
    """What a controller cross-fade shows: every channel lerped (missing channels are rest values)."""
    out = {}
    for bone in set(a) | set(b):
        for c in ('rotation', 'position'):
            va = a.get(bone, {}).get(c)
            vb = b.get(bone, {}).get(c)
            if va is None and vb is None:
                continue
            va = va if va is not None else [0.0, 0.0, 0.0]
            vb = vb if vb is not None else [0.0, 0.0, 0.0]
            out.setdefault(bone, {})[c] = [x + (y - x) * w for x, y in zip(va, vb)]
    return out
