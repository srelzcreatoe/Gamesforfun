"""Minimal Bedrock entity-model evaluator used by Tailwail's dev tools.

Loads a Bedrock geometry (format 1.12.0) and animation file (format 1.8.0),
evaluates Molang expressions from a small whitelisted subset, samples
keyframes (linear / catmull-rom), and produces posed cube vertices.

Conventions follow Blockbench's Bedrock codec: geometry X is mirrored into a
right-handed display space, and bone Euler rotations are applied as
Rz(z) * Ry(-y) * Rx(-x).  Animation rotations are added to the bind-pose
rotation component-wise; animation positions offset the bone.

This is a preview/measurement tool, not a reimplementation of the game
renderer.  Results that matter for gameplay (height, ground contact) are
cross-checked in-game per docs/TESTING.md.
"""
import json
import math
import re

import numpy as np

# --------------------------------------------------------------------------
# Molang subset
# --------------------------------------------------------------------------
_ALLOWED = re.compile(r"^[\s0-9.+\-*/(),<>=!?:&|a-z_A-Z]*$")
_IDENT = re.compile(r"\b(math|q|query|v|variable|t|temp)\.([a-z_0-9]+)")


def _deg_fn(f):
    return lambda x: f(math.radians(x))


MATH = {
    "sin": _deg_fn(math.sin),
    "cos": _deg_fn(math.cos),
    "abs": abs,
    "max": max,
    "min": min,
    "pow": lambda a, b: math.pow(a, b),
    "clamp": lambda x, lo, hi: max(lo, min(hi, x)),
    "sqrt": math.sqrt,
    "floor": math.floor,
    "mod": lambda a, b: math.fmod(a, b),
    "lerp": lambda a, b, t: a + (b - a) * t,
}


class Molang:
    """Compiles whitelisted Molang expressions into Python callables."""

    def __init__(self):
        self.cache = {}

    def compile(self, expr):
        if isinstance(expr, (int, float)):
            v = float(expr)
            return lambda env: v
        if expr in self.cache:
            return self.cache[expr]
        src = expr.strip().rstrip(";")
        if not _ALLOWED.match(src):
            raise ValueError("unsupported characters in molang: %r" % expr)
        names = []

        def repl(m):
            ns, name = m.group(1), m.group(2)
            if ns == "math":
                if name not in MATH:
                    raise ValueError("unsupported math fn %s" % name)
                return "M_" + name
            key = {"q": "q", "query": "q", "v": "v", "variable": "v", "t": "t", "temp": "t"}[ns]
            names.append((key, name))
            return "%s_%s" % (key, name)

        py = _IDENT.sub(repl, src)
        # any remaining bare identifiers would be a parse risk -> reject
        leftover = re.sub(r"\b(M_[a-z_]+|[qvt]_[a-z_0-9]+)\b", "", py)
        if re.search(r"[A-Za-z_]", leftover):
            raise ValueError("unsupported molang tokens: %r" % expr)
        code = compile(py, "<molang>", "eval")
        glb = {"__builtins__": {}}
        glb.update({"M_" + k: f for k, f in MATH.items()})

        def fn(env, code=code, names=tuple(names)):
            loc = {}
            for key, name in names:
                loc["%s_%s" % (key, name)] = env.get(key + "." + name, 0.0)
            return float(eval(code, glb, loc))

        fn.names = names
        self.cache[expr] = fn
        return fn


MOLANG = Molang()


def molang_vars(expr):
    if not isinstance(expr, str):
        return set()
    return {"%s.%s" % ({"query": "q", "variable": "v"}.get(a, a), b) for a, b in _IDENT.findall(expr) if a != "math"}


# --------------------------------------------------------------------------
# Rotation helpers (display space)
# --------------------------------------------------------------------------
def rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def bedrock_rot(r):
    x, y, z = (math.radians(v) for v in r)
    return rz(z) @ ry(-y) @ rx(-x)


def affine(R=None, t=(0, 0, 0)):
    m = np.eye(4)
    if R is not None:
        m[:3, :3] = R
    m[:3, 3] = t
    return m


# --------------------------------------------------------------------------
# Animation sampling
# --------------------------------------------------------------------------
def _vec(v):
    if isinstance(v, (int, float, str)):
        return [v, v, v]
    return list(v)


class Channel:
    def __init__(self, data):
        self.const = None
        self.keys = []
        if isinstance(data, dict) and data and all(_is_time(k) for k in data):
            for k, v in sorted(data.items(), key=lambda kv: float(kv[0])):
                if isinstance(v, dict):
                    pre = v.get("pre", v.get("post"))
                    post = v.get("post", v.get("pre"))
                    mode = v.get("lerp_mode", "linear")
                else:
                    pre = post = v
                    mode = "linear"
                self.keys.append((float(k), [MOLANG.compile(e) for e in _vec(pre)],
                                  [MOLANG.compile(e) for e in _vec(post)], mode))
        else:
            self.const = [MOLANG.compile(e) for e in _vec(data)]

    def sample(self, t, env):
        if self.const is not None:
            return np.array([f(env) for f in self.const])
        ks = self.keys
        if t <= ks[0][0]:
            return np.array([f(env) for f in ks[0][1]])
        if t >= ks[-1][0]:
            return np.array([f(env) for f in ks[-1][2]])
        for i in range(len(ks) - 1):
            t1, t2 = ks[i][0], ks[i + 1][0]
            if t1 <= t <= t2:
                s = 0.0 if t2 == t1 else (t - t1) / (t2 - t1)
                p1 = np.array([f(env) for f in ks[i][2]])
                p2 = np.array([f(env) for f in ks[i + 1][1]])
                if ks[i][3] == "catmullrom" or ks[i + 1][3] == "catmullrom":
                    p0 = np.array([f(env) for f in ks[max(0, i - 1)][2]]) if i > 0 else p1
                    p3 = np.array([f(env) for f in ks[i + 2][1]]) if i + 2 < len(ks) else p2
                    s2, s3 = s * s, s * s * s
                    return 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2
                                  + (-p0 + 3 * p1 - 3 * p2 + p3) * s3)
                return p1 + (p2 - p1) * s
        return np.array([f(env) for f in ks[-1][2]])


def _is_time(k):
    try:
        float(k)
        return True
    except ValueError:
        return False


class Animation:
    def __init__(self, name, data):
        self.name = name
        self.length = float(data.get("animation_length", 0.0))
        self.loop = data.get("loop", False)
        self.anim_time_update = data.get("anim_time_update")
        self.bones = {}
        for bone, chans in data.get("bones", {}).items():
            self.bones[bone] = {ch: Channel(v) for ch, v in chans.items() if ch in ("rotation", "position", "scale")}

    def local_time(self, t):
        if self.length <= 0:
            return 0.0
        if self.loop is True:
            return math.fmod(t, self.length)
        return min(t, self.length)

    def sample(self, t, env):
        lt = self.local_time(t)
        out = {}
        for bone, chans in self.bones.items():
            out[bone] = {ch: c.sample(lt, env) for ch, c in chans.items()}
        return out


def load_animations(path):
    with open(path) as fh:
        data = json.load(fh)
    return {k: Animation(k, v) for k, v in data["animations"].items()}


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------
FACE_CORNERS = {
    # corners TL, TR, BR, BL as seen from outside, in display space
    "north": [(1, 1, 0), (0, 1, 0), (0, 0, 0), (1, 0, 0)],
    "south": [(0, 1, 1), (1, 1, 1), (1, 0, 1), (0, 0, 1)],
    "east": [(1, 1, 1), (1, 1, 0), (1, 0, 0), (1, 0, 1)],
    "west": [(0, 1, 0), (0, 1, 1), (0, 0, 1), (0, 0, 0)],
    "up": [(0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)],
    "down": [(0, 0, 1), (1, 0, 1), (1, 0, 0), (0, 0, 0)],
}
FACE_NORMAL = {"north": (0, 0, -1), "south": (0, 0, 1), "east": (1, 0, 0), "west": (-1, 0, 0),
               "up": (0, 1, 0), "down": (0, -1, 0)}


class Geometry:
    def __init__(self, path):
        with open(path) as fh:
            data = json.load(fh)
        geo = data["minecraft:geometry"][0]
        self.description = geo["description"]
        self.tex_w = geo["description"]["texture_width"]
        self.tex_h = geo["description"]["texture_height"]
        self.bones = {b["name"]: b for b in geo["bones"]}
        self.order = [b["name"] for b in geo["bones"]]
        self.children = {n: [] for n in self.order}
        for b in geo["bones"]:
            if b.get("parent"):
                self.children[b["parent"]].append(b["name"])

    @staticmethod
    def flip(p):
        return np.array([-p[0], p[1], p[2]], dtype=float)

    def bone_matrices(self, pose):
        """pose: bone -> {rotation: deg[3], position: px[3], scale: [3]} (animation deltas)."""
        mats = {}

        def visit(name, parent_m):
            b = self.bones[name]
            piv = self.flip(b.get("pivot", [0, 0, 0]))
            rot = np.array(b.get("rotation", [0, 0, 0]), dtype=float)
            pos = np.zeros(3)
            scl = np.ones(3)
            if name in pose:
                p = pose[name]
                if "rotation" in p:
                    rot = rot + p["rotation"]
                if "position" in p:
                    pos = self.flip(p["position"])
                if "scale" in p:
                    scl = np.array(p["scale"], dtype=float)
            m = affine(t=pos) @ affine(t=piv) @ affine(bedrock_rot(rot)) @ affine(np.diag(scl)) @ affine(t=-piv)
            m = parent_m @ m
            mats[name] = m
            for c in self.children[name]:
                visit(c, m)

        for n in self.order:
            if not self.bones[n].get("parent"):
                visit(n, np.eye(4))
        return mats

    def posed_faces(self, pose):
        """Yields (bone, face_name, corners[4,3] world, uv, uv_size, normal)."""
        mats = self.bone_matrices(pose)
        out = []
        for name in self.order:
            b = self.bones[name]
            m = mats[name]
            for c in b.get("cubes", []):
                o = np.array(c["origin"], dtype=float)
                s = np.array(c["size"], dtype=float)
                inf = float(c.get("inflate", 0.0))
                lo = np.array([-(o[0] + s[0]), o[1], o[2]]) - inf
                hi = np.array([-o[0], o[1] + s[1], o[2] + s[2]]) + inf
                cm = np.eye(4)
                if "rotation" in c:
                    piv = self.flip(c.get("pivot", [0, 0, 0]))
                    cm = affine(t=piv) @ affine(bedrock_rot(c["rotation"])) @ affine(t=-piv)
                full = m @ cm
                for face, corners in FACE_CORNERS.items():
                    uvd = c["uv"].get(face) if isinstance(c["uv"], dict) else None
                    if uvd is None:
                        continue
                    pts = np.array([[lo[i] if k == 0 else hi[i] for i, k in enumerate(cr)] for cr in corners])
                    ph = np.c_[pts, np.ones(4)] @ full.T
                    n = full[:3, :3] @ np.array(FACE_NORMAL[face], dtype=float)
                    out.append((name, face, ph[:, :3], uvd["uv"], uvd["uv_size"], n))
        return out

    def _local_corners(self, name):
        """Cube corners for one bone in bone space (homogeneous, cube rotations applied); cached."""
        cache = self.__dict__.setdefault("_corner_cache", {})
        if name in cache:
            return cache[name]
        pts = []
        for c in self.bones[name].get("cubes", []):
            o = np.array(c["origin"], dtype=float)
            s = np.array(c["size"], dtype=float)
            inf = float(c.get("inflate", 0.0))
            lo = np.array([-(o[0] + s[0]), o[1], o[2]]) - inf
            hi = np.array([-o[0], o[1] + s[1], o[2] + s[2]]) + inf
            cm = np.eye(4)
            if "rotation" in c:
                piv = self.flip(c.get("pivot", [0, 0, 0]))
                cm = affine(t=piv) @ affine(bedrock_rot(c["rotation"])) @ affine(t=-piv)
            for ix in (lo[0], hi[0]):
                for iy in (lo[1], hi[1]):
                    for iz in (lo[2], hi[2]):
                        pts.append(cm @ np.array([ix, iy, iz, 1.0]))
        arr = np.array(pts) if pts else np.zeros((0, 4))
        cache[name] = arr
        return arr

    def bone_points(self, pose, bones=None):
        mats = self.bone_matrices(pose)
        out = {}
        for name in (bones or self.order):
            loc = self._local_corners(name)
            if len(loc):
                out[name] = (loc @ mats[name].T)[:, :3]
        return out

    def bounds(self, pose, bones=None):
        pts = list(self.bone_points(pose, bones).values())
        allp = np.concatenate(pts)
        return allp.min(axis=0), allp.max(axis=0)


def pose_from(anims, layers, t, env):
    """layers: list of (animation, weight, time_offset). Rotations/positions add, weighted."""
    pose = {}
    for anim, w, toff in layers:
        tt = t - toff
        if anim.anim_time_update:
            tt = MOLANG.compile(anim.anim_time_update)(env)
        sampled = anim.sample(tt, env)
        for bone, chans in sampled.items():
            dst = pose.setdefault(bone, {})
            for ch, v in chans.items():
                if ch == "scale":
                    dst[ch] = dst.get(ch, np.ones(3)) * (1 + (v - 1) * w)
                else:
                    dst[ch] = dst.get(ch, np.zeros(3)) + v * w
    return pose
