#!/usr/bin/env python3
"""Offline forward-kinematics preview renderer for Bedrock geometry + animations.

Used during development to:
  * confirm the rotation convention of the supplied Hollow Dweller assets
    (by comparing renders of the supplied clips with the supplied previews), and
  * visually and numerically check the supplemental animations authored for
    The Observer (stalk walk, peek, recoil, stoop).

It is a QA tool, not part of the shipped add-on. Rendering is orthographic,
flat-shaded with each face's average texture colour, painter-sorted.

Convention (verified against dweller_preview.png / dweller_turnaround.png):
  Bedrock geometry JSON is X-mirrored relative to Blockbench's display space.
  In JSON space: bone matrix = T(pivot) * Rz(-z) * Ry(y) * Rx(-x) * T(-pivot);
  the image is mirrored back (screen x = +x_json when viewed from the front).
  The model faces -Z. Animation rotations are added to the bone's rest
  rotation; animation positions are added to the bone translation.

Usage:
  render_model.py GEO TEXTURE OUT.png [--anim FILE NAME TIME]... [--view front|side|three_quarter|back]
                  [--height-report]
"""
import argparse
import json
import math
import re
import sys

import numpy as np
from PIL import Image, ImageDraw


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]], dtype=float)


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]], dtype=float)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=float)


def trans(v):
    m = np.eye(4)
    m[:3, 3] = v
    return m


def lerp_keys(channel, t, length, loop):
    """Evaluate a Bedrock animation channel (dict of time->vec or a constant)."""
    if channel is None:
        return np.zeros(3)
    if isinstance(channel, list):
        return np.array([eval_num(c) for c in channel], dtype=float)
    if isinstance(channel, (int, float)):
        return np.array([channel] * 3, dtype=float)
    keys = sorted(((float(k), v) for k, v in channel.items()), key=lambda kv: kv[0])

    def vec(v):
        if isinstance(v, dict):
            v = v.get("post", v.get("pre"))
        if isinstance(v, (int, float)):
            return np.array([v] * 3, dtype=float)
        return np.array([eval_num(c) for c in v], dtype=float)

    if loop is True and length:
        t = t % length
    if t <= keys[0][0]:
        return vec(keys[0][1])
    if t >= keys[-1][0]:
        return vec(keys[-1][1])
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            f = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            return vec(v0) * (1 - f) + vec(v1) * f
    return vec(keys[-1][1])


MOLANG_VARS = {"q.property('observer:side')": 1.0, "query.property('observer:side')": 1.0,
               "query.anim_time": 0.0, "q.anim_time": 0.0,
               "query.target_x_rotation": 0.0, "query.target_y_rotation": 0.0,
               "q.target_x_rotation": 0.0, "q.target_y_rotation": 0.0}


def eval_num(c):
    """Evaluate a constant or a simple Molang expression (math.sin/cos/clamp, anim_time)."""
    if isinstance(c, (int, float)):
        return float(c)
    expr = c.lower()
    for k, v in MOLANG_VARS.items():
        expr = expr.replace(k, repr(v))
    expr = expr.replace("math.sin", "_sin").replace("math.cos", "_cos").replace("math.clamp", "_clamp")
    expr = expr.replace("math.abs", "abs").replace("math.min", "min").replace("math.max", "max")
    if re.search(r"[a-z_]+\.[a-z_]+", expr):
        raise ValueError("unsupported molang in preview: " + c)
    return float(eval(expr, {"__builtins__": {}}, {
        "_sin": lambda d: math.sin(math.radians(d)),
        "_cos": lambda d: math.cos(math.radians(d)),
        "_clamp": lambda v, lo, hi: max(lo, min(hi, v)),
        "abs": abs, "min": min, "max": max}))


class Model:
    def __init__(self, geo_path, tex_path):
        g = json.load(open(geo_path))["minecraft:geometry"][0]
        self.bones = {b["name"]: b for b in g["bones"]}
        self.order = [b["name"] for b in g["bones"]]
        self.tex = Image.open(tex_path).convert("RGBA")
        self.tw, self.th = g["description"]["texture_width"], g["description"]["texture_height"]
        self._face_colors = {}

    def face_color(self, face):
        key = (tuple(face["uv"]), tuple(face.get("uv_size", (1, 1))))
        if key not in self._face_colors:
            u, v = face["uv"]
            w, h = face.get("uv_size", (1, 1))
            x0, x1 = sorted((u, u + w))
            y0, y1 = sorted((v, v + h))
            sx = self.tex.width / self.tw
            sy = self.tex.height / self.th
            box = (int(x0 * sx), int(y0 * sy), max(int(x0 * sx) + 1, int(math.ceil(x1 * sx))),
                   max(int(y0 * sy) + 1, int(math.ceil(y1 * sy))))
            region = np.asarray(self.tex.crop(box)).reshape(-1, 4).astype(float)
            self._face_colors[key] = region[:, :3].mean(axis=0)
        return self._face_colors[key]

    def world_matrices(self, anims):
        """anims: list of (animation_dict, time). Returns bone -> 4x4 matrix."""
        mats = {}

        def anim_delta(name):
            r = np.zeros(3)
            p = np.zeros(3)
            for a, t in anims:
                ch = a.get("bones", {}).get(name)
                if not ch:
                    continue
                MOLANG_VARS["query.anim_time"] = MOLANG_VARS["q.anim_time"] = t
                r += lerp_keys(ch.get("rotation"), t, a.get("animation_length"), a.get("loop"))
                p += lerp_keys(ch.get("position"), t, a.get("animation_length"), a.get("loop"))
            return r, p

        def compute(name):
            if name in mats:
                return mats[name]
            b = self.bones[name]
            pivot = np.array(b.get("pivot", [0, 0, 0]), dtype=float)
            rest = np.array(b.get("rotation", [0, 0, 0]), dtype=float)
            dr, dp = anim_delta(name)
            rx, ry, rz = np.radians(rest + dr)
            local = trans(dp) @ trans(pivot) @ rot_z(-rz) @ rot_y(ry) @ rot_x(-rx) @ trans(-pivot)
            parent = b.get("parent")
            m = compute(parent) @ local if parent else local
            mats[name] = m
            return m

        for n in self.order:
            compute(n)
        return mats

    DEBUG_COLORS = {"thigh": (200, 60, 60), "shin": (240, 140, 60), "foot": (120, 40, 20),
                    "upper_arm": (60, 90, 220), "forearm": (90, 180, 240), "hand": (40, 200, 200),
                    "torso": (60, 160, 60), "pelvis": (30, 100, 30), "head": (160, 60, 160)}
    debug = False

    def bone_debug_color(self, name):
        for k, v in self.DEBUG_COLORS.items():
            if name.endswith(k) or name == k:
                return np.array(v, dtype=float)
        return np.array((90, 90, 90), dtype=float)

    def faces(self, anims):
        mats = self.world_matrices(anims)
        out = []
        for name in self.order:
            m = mats[name]
            for c in self.bones[name].get("cubes", []):
                o = np.array(c["origin"], dtype=float)
                s = np.array(c["size"], dtype=float)
                corners = {}
                for i in (0, 1):
                    for j in (0, 1):
                        for k in (0, 1):
                            p = np.array([o[0] + s[0] * i, o[1] + s[1] * j, o[2] + s[2] * k, 1.0])
                            corners[(i, j, k)] = (m @ p)[:3]
                quads = {
                    "north": [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)],
                    "south": [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
                    "east": [(1, 0, 0), (1, 0, 1), (1, 1, 1), (1, 1, 0)],
                    "west": [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
                    "up": [(0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)],
                    "down": [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
                }
                for fname, idx in quads.items():
                    face = c["uv"].get(fname) if isinstance(c["uv"], dict) else None
                    if face is None:
                        continue
                    pts = np.array([corners[q] for q in idx])
                    col = self.bone_debug_color(name) if self.debug else self.face_color(face)
                    out.append((pts, col))
        return out

    def extent(self, anims):
        pts = np.concatenate([f[0] for f in self.faces(anims)])
        return pts.min(axis=0), pts.max(axis=0)


VIEWS = {
    # camera direction (looking from) -> yaw applied to model before ortho projection along -Z
    "front": 0.0, "three_quarter": -35.0, "side": -90.0, "back": 180.0,
}


def render(model, anims, out, view="front", size=(360, 520), scale=7.0, label=None):
    img = Image.new("RGB", size, (232, 232, 232))
    d = ImageDraw.Draw(img)
    yaw = math.radians(VIEWS[view])
    # rotate model so that its front (-Z) faces the camera at -Z ... camera looks along +Z
    R = rot_y(yaw)[:3, :3]
    light = np.array([0.4, 0.7, -0.6])
    light /= np.linalg.norm(light)
    polys = []
    for pts, col in model.faces(anims):
        p = (R @ pts.T).T
        n = np.cross(p[1] - p[0], p[3] - p[0])
        if np.linalg.norm(n) < 1e-9:
            continue
        n /= np.linalg.norm(n)
        shade = 0.55 + 0.45 * abs(float(n @ light))
        depth = p[:, 2].mean()
        polys.append((depth, p, np.clip(col * shade, 0, 255)))
    # camera at -Z looking toward +Z: far faces have larger z, draw them first
    polys.sort(key=lambda t: -t[0])
    cx, base = size[0] / 2, size[1] - 20
    for _, p, col in polys:
        # JSON space is X-mirrored vs. the in-game/Blockbench view, so +x_json maps to screen right
        xy = [(cx + x * scale, base - y * scale) for x, y, _ in p]
        d.polygon(xy, fill=tuple(int(c) for c in col))
    d.line([(10, base), (size[0] - 10, base)], fill=(120, 120, 120))
    for blocks in range(1, 5):
        y = base - blocks * 16 * scale
        d.line([(4, y), (14, y)], fill=(150, 60, 60))
        d.text((16, y - 6), f"{blocks}b", fill=(150, 60, 60))
    if label:
        d.text((8, 6), label, fill=(20, 20, 20))
    img.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("geo")
    ap.add_argument("texture")
    ap.add_argument("out")
    ap.add_argument("--anim", nargs=3, action="append", default=[], metavar=("FILE", "NAME", "TIME"))
    ap.add_argument("--view", default="front", choices=list(VIEWS))
    ap.add_argument("--label")
    ap.add_argument("--height-report", action="store_true")
    ap.add_argument("--debug-colors", action="store_true")
    ap.add_argument("--side", type=float, default=1.0, help="value for q.property('observer:side')")
    a = ap.parse_args()
    model = Model(a.geo, a.texture)
    model.debug = a.debug_colors
    MOLANG_VARS["q.property('observer:side')"] = MOLANG_VARS["query.property('observer:side')"] = a.side
    anims = []
    for f, n, t in a.anim:
        anims.append((json.load(open(f))["animations"][n], float(t)))
    render(model, anims, a.out, a.view, label=a.label)
    if a.height_report:
        lo, hi = model.extent(anims)
        print(json.dumps({"min": lo.round(2).tolist(), "max": hi.round(2).tolist(),
                          "height_blocks": round((hi[1] - lo[1]) / 16, 3),
                          "top_blocks": round(hi[1] / 16, 3)}))


if __name__ == "__main__":
    sys.exit(main())
