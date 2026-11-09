#!/usr/bin/env python3
"""Tiny software renderer for Bedrock .geo.json models + .animation.json poses.

Used only to produce preview images and to sanity-check generated animations.
Coordinates are converted to Blockbench space (x mirrored, x/y rotations negated),
which is right-handed with the model facing -Z.
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def rot_matrix(rx, ry, rz):
    rx, ry, rz = (math.radians(a) for a in (rx, ry, rz))
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx  # Three.js Euler order 'ZYX'


def sample_channel(chan, t):
    """chan: list/number or dict time->value. Returns 3-vector."""
    if chan is None:
        return np.zeros(3)
    if isinstance(chan, (int, float)):
        return np.array([chan] * 3, dtype=float)
    if isinstance(chan, list):
        return np.array([v if isinstance(v, (int, float)) else 0.0 for v in chan], dtype=float)
    if isinstance(chan, dict):
        if 'vector' in chan:
            return sample_channel(chan['vector'], t)
        keys = sorted(chan.keys(), key=float)
        times = [float(k) for k in keys]

        def val(k, which='post'):
            v = chan[k]
            if isinstance(v, dict):
                v = v.get(which, v.get('post', v.get('pre')))
            return sample_channel(v, 0)

        if t <= times[0]:
            return val(keys[0], 'pre')
        if t >= times[-1]:
            return val(keys[-1])
        for i in range(len(times) - 1):
            if times[i] <= t <= times[i + 1]:
                a, b = val(keys[i]), val(keys[i + 1], 'pre')
                f = (t - times[i]) / max(1e-9, times[i + 1] - times[i])
                return a + (b - a) * f
    return np.zeros(3)


class Model:
    def __init__(self, geo_path, tex_path):
        g = json.load(open(geo_path))
        geo = g['minecraft:geometry'][0]
        d = geo['description']
        self.tw, self.th = d['texture_width'], d['texture_height']
        self.tex = np.asarray(Image.open(tex_path).convert('RGBA')).astype(np.float32) / 255.0
        self.bones = {b['name']: b for b in geo['bones']}
        self.order = [b['name'] for b in geo['bones']]

    def bone_world(self, pose):
        """pose: name -> (rot3, pos3, scale3) additive. returns name -> (M3, t3) mapping local->world"""
        out = {}

        def solve(name):
            if name in out:
                return out[name]
            b = self.bones[name]
            piv = np.array(b.get('pivot', [0, 0, 0]), dtype=float)
            piv = np.array([-piv[0], piv[1], piv[2]])
            r = np.array(b.get('rotation', [0, 0, 0]), dtype=float)
            ar, ap, sc = pose.get(name, (np.zeros(3), np.zeros(3), np.ones(3)))
            r = r + ar
            R = rot_matrix(-r[0], -r[1], r[2]) @ np.diag(sc)
            p = np.array([-ap[0], ap[1], ap[2]])
            # local transform: x -> R(x - piv) + piv + p
            M = R
            t = piv + p - R @ piv
            if b.get('parent'):
                PM, Pt = solve(b['parent'])
                M, t = PM @ M, PM @ t + Pt
            out[name] = (M, t)
            return out[name]

        for n in self.order:
            solve(n)
        return out

    def faces(self, pose):
        bw = self.bone_world(pose)
        res = []
        for name in self.order:
            b = self.bones[name]
            M, t = bw[name]
            for c in b.get('cubes', []):
                o = np.array(c['origin'], dtype=float)
                s = np.array(c['size'], dtype=float)
                inf = c.get('inflate', 0)
                x0, x1 = -(o[0] + s[0]) - inf, -o[0] + inf
                y0, y1 = o[1] - inf, o[1] + s[1] + inf
                z0, z1 = o[2] - inf, o[2] + s[2] + inf
                CR, Ct = np.eye(3), np.zeros(3)
                if 'rotation' in c:
                    cp = np.array(c.get('pivot', [0, 0, 0]), dtype=float)
                    cp = np.array([-cp[0], cp[1], cp[2]])
                    cr = c['rotation']
                    CR = rot_matrix(-cr[0], -cr[1], cr[2])
                    Ct = cp - CR @ cp
                P = lambda x, y, z: M @ (CR @ np.array([x, y, z]) + Ct) + t
                uv = c.get('uv', {})
                # corners ordered: top-left, top-right, bottom-right, bottom-left (as seen on texture)
                quads = {
                    'north': [P(x1, y1, z0), P(x0, y1, z0), P(x0, y0, z0), P(x1, y0, z0)],
                    'south': [P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1), P(x0, y0, z1)],
                    'east': [P(x1, y1, z1), P(x1, y1, z0), P(x1, y0, z0), P(x1, y0, z1)],
                    'west': [P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1), P(x0, y0, z0)],
                    'up': [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)],
                    'down': [P(x0, y0, z1), P(x1, y0, z1), P(x1, y0, z0), P(x0, y0, z0)],
                }
                for fn, q in quads.items():
                    f = uv.get(fn)
                    if not f:
                        continue
                    u, v = f['uv']
                    w, h = f.get('uv_size', [0, 0])
                    res.append((q, (u, v, u + w, v + h)))
        return res


def pose_from_anims(anims, t_by_anim, weights=None):
    pose = {}
    for i, an in enumerate(anims):
        w = 1.0 if not weights else weights[i]
        t = t_by_anim[i]
        L = an.get('animation_length', 0) or 0
        if an.get('loop') is True and L:
            t = t % L
        for bname, ch in an.get('bones', {}).items():
            r = sample_channel(ch.get('rotation'), t) * w
            p = sample_channel(ch.get('position'), t) * w
            sc = ch.get('scale')
            s = sample_channel(sc, t) if sc is not None else np.ones(3)
            pr, pp, ps = pose.get(bname, (np.zeros(3), np.zeros(3), np.ones(3)))
            pose[bname] = (pr + r, pp + p, ps * (1 + (s - 1) * w))
    return pose


def render(model, pose, size=(520, 720), yaw=-35, pitch=12, scale=None, bg=(18, 12, 14), center_y=None,
           light=(0.45, 0.8, -0.4)):
    W, H = size
    faces = model.faces(pose)
    Ry = rot_matrix(0, yaw, 0)
    Rx = rot_matrix(pitch, 0, 0)
    V = Rx @ Ry
    pts = []
    for q, uv in faces:
        pts.append([V @ p for p in q])
    allp = np.array([p for q in pts for p in q])
    if scale is None:
        hgt = allp[:, 1].max() - allp[:, 1].min()
        wid = allp[:, 0].max() - allp[:, 0].min()
        scale = min((H * 0.88) / hgt, (W * 0.88) / max(wid, 1))
    cy = (allp[:, 1].max() + allp[:, 1].min()) / 2 if center_y is None else center_y
    cx = (allp[:, 0].max() + allp[:, 0].min()) / 2
    img = np.zeros((H, W, 3), dtype=np.float32)
    img[:] = np.array(bg) / 255.0
    zbuf = np.full((H, W), 1e9, dtype=np.float32)
    L = np.array(light) / np.linalg.norm(light)
    tex = model.tex
    TH, TW = tex.shape[:2]
    sx, sy = TW / model.tw, TH / model.th
    for (q, uv), qv in zip(faces, pts):
        sp = np.array([[W / 2 - (p[0] - cx) * scale, H / 2 - (p[1] - cy) * scale, p[2]] for p in qv])
        n = np.cross(qv[1] - qv[0], qv[3] - qv[0])
        nl = np.linalg.norm(n)
        if nl < 1e-9:
            continue
        n = n / nl
        # camera looks toward +z; visible faces have normals pointing to -z
        if n[2] > 0.0:
            continue
        shade = 0.35 + 0.65 * max(0.0, float(np.dot(n, -L) * -1 if False else np.dot(n, L)))
        shade = 0.45 + 0.55 * max(0.0, float(-np.dot(n, np.array([0.35, -0.55, 0.75]))))
        u0, v0, u1, v1 = uv
        tuv = np.array([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], dtype=float)
        for tri in ((0, 1, 2), (0, 2, 3)):
            a, b, c = sp[list(tri)]
            ta, tb, tc = tuv[list(tri)]
            minx, maxx = int(max(0, math.floor(min(a[0], b[0], c[0])))), int(min(W - 1, math.ceil(max(a[0], b[0], c[0]))))
            miny, maxy = int(max(0, math.floor(min(a[1], b[1], c[1])))), int(min(H - 1, math.ceil(max(a[1], b[1], c[1]))))
            if minx > maxx or miny > maxy:
                continue
            xs, ys = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-9:
                continue
            w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
            w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
            w2 = 1 - w0 - w1
            m = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
            if not m.any():
                continue
            z = w0 * a[2] + w1 * b[2] + w2 * c[2]
            tu = (w0 * ta[0] + w1 * tb[0] + w2 * tc[0]) * sx
            tv = (w0 * ta[1] + w1 * tb[1] + w2 * tc[1]) * sy
            tu = np.clip(tu.astype(int), 0, TW - 1)
            tv = np.clip(tv.astype(int), 0, TH - 1)
            col = tex[tv, tu]
            m &= col[..., 3] > 0.3
            zz = zbuf[miny:maxy + 1, minx:maxx + 1]
            m &= z < zz
            if not m.any():
                continue
            zz[m] = z[m]
            region = img[miny:maxy + 1, minx:maxx + 1]
            region[m] = col[..., :3][m] * shade
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)), scale


def load_anims(paths):
    out = {}
    for p in paths:
        out.update(json.load(open(p))['animations'])
    return out


if __name__ == '__main__':
    geo, tex, out = sys.argv[1:4]
    m = Model(geo, tex)
    img, _ = render(m, {})
    img.save(out)
