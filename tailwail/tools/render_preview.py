#!/usr/bin/env python3
"""Software preview renderer for Tailwail clips.

Usage:
  python3 -I tools/render_preview.py --geo GEO --anim ANIM --tex PNG --out DIR \
      [--clips idle,walk] [--frames 5] [--views front,side,three]

Writes one contact sheet per clip (rows = views, columns = sampled times),
with a 1-block grid and a ground line so height and foot contact are
readable.  Molang variables can be set with --var v.walk=90 (repeatable) or
are driven per clip by DEFAULT_DRIVERS below.
"""
import argparse
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bedrock_model as bm  # noqa: E402

VIEWS = {"front": (0.0, 0.0), "side": (90.0, 0.0), "three": (35.0, 12.0), "back": (180.0, 0.0),
         "top": (0.0, 80.0)}


def camera(yaw_deg, pitch_deg):
    # camera starts in front of the model (model faces -Z), looking toward +Z
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    R = bm.rx(p) @ bm.ry(y)
    return R


def render(geo, tex, pose, view, size=(360, 520), ppu=6.0, origin_y=None, scale=1.0):
    W, H = size
    img = np.zeros((H, W, 3), dtype=np.float32)
    img[:] = (0.13, 0.13, 0.15)
    depth = np.full((H, W), np.inf, dtype=np.float32)
    R = camera(*VIEWS[view])
    faces = geo.posed_faces(pose)
    texa = np.asarray(tex, dtype=np.float32) / 255.0
    th, tw = texa.shape[:2]
    oy = origin_y if origin_y is not None else H - 40
    light = np.array([0.35, 0.8, -0.5])
    light /= np.linalg.norm(light)

    def proj(p):
        q = (R @ (p * scale).T).T
        # screen x: display-space +X appears on the left when viewing the front
        sx = W / 2 - q[:, 0] * ppu
        sy = oy - q[:, 1] * ppu
        return np.c_[sx, sy, q[:, 2]]

    # grid: 1 block = 16 px of model space
    gimg = Image.new("RGB", (W, H))
    for f in faces:
        bone, face, pts, uv, uvs, n = f
        nr = R @ n
        if nr[2] > 1e-6:  # back-facing (camera looks toward +Z)
            continue
        s = proj(pts)
        u0, v0 = uv
        du, dv = uvs
        uvc = np.array([[u0, v0], [u0 + du, v0], [u0 + du, v0 + dv], [u0, v0 + dv]], dtype=np.float32)
        shade = 0.45 + 0.55 * max(0.0, float(np.dot(n / (np.linalg.norm(n) + 1e-9), light)))
        for tri in ((0, 1, 2), (0, 2, 3)):
            P = s[list(tri)]
            T = uvc[list(tri)]
            x0, x1 = int(max(0, math.floor(P[:, 0].min()))), int(min(W - 1, math.ceil(P[:, 0].max())))
            y0, y1 = int(max(0, math.floor(P[:, 1].min()))), int(min(H - 1, math.ceil(P[:, 1].max())))
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, ay, az), (bx, by, bz), (cx, cy, cz) = P
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-9:
                continue
            w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
            w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
            w2 = 1 - w0 - w1
            m = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
            if not m.any():
                continue
            z = w0 * az + w1 * bz + w2 * cz
            u = w0 * T[0, 0] + w1 * T[1, 0] + w2 * T[2, 0]
            v = w0 * T[0, 1] + w1 * T[1, 1] + w2 * T[2, 1]
            ui = np.clip(np.floor(u).astype(int), 0, tw - 1)
            vi = np.clip(np.floor(v).astype(int), 0, th - 1)
            px = texa[vi, ui]
            m &= px[..., 3] > 0.1
            sub = depth[y0:y1 + 1, x0:x1 + 1]
            m &= z < sub
            if not m.any():
                continue
            sub[m] = z[m]
            img[y0:y1 + 1, x0:x1 + 1][m] = px[..., :3][m] * shade
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(out)
    # ground line and block grid (16 model px per block)
    d.line([(0, oy), (W, oy)], fill=(200, 80, 80), width=1)
    blk = 16 * ppu
    k = 1
    while oy - k * blk > 0:
        yy = oy - k * blk
        d.line([(0, yy), (12, yy)], fill=(120, 120, 120))
        d.text((14, yy - 6), "%d" % k, fill=(150, 150, 150))
        k += 1
    return out


DEFAULT_DRIVERS = {
    # clip suffix -> function(t) -> dict of molang vars
    "walk": lambda t: {"v.walk": (t * 180.0) % 360.0, "v.move": 1.0},
    "pace": lambda t: {"v.walk": (t * 180.0) % 360.0, "v.move": 1.0},
    "look": lambda t: {"v.look_x": 20 * math.sin(t * 2), "v.look_y": 60 * math.sin(t * 3)},
    "jaw": lambda t: {"v.jaw": 30 * abs(math.sin(t * 2))},
    "crawl": lambda t: {"v.crawl": t % 1.0},
    "climb": lambda t: {"v.climb_t": t % 1.0},
}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--geo", required=True)
    ap.add_argument("--anim", required=True)
    ap.add_argument("--tex", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--clips", default="")
    ap.add_argument("--frames", type=int, default=5)
    ap.add_argument("--views", default="front,side")
    ap.add_argument("--base", default="", help="comma list of clips layered under each clip")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--ppu", type=float, default=5.0)
    ap.add_argument("--size", default="360x520")
    ap.add_argument("--var", action="append", default=[])
    a = ap.parse_args(argv)
    geo = bm.Geometry(a.geo)
    anims = bm.load_animations(a.anim)
    tex = Image.open(a.tex).convert("RGBA")
    os.makedirs(a.out, exist_ok=True)
    names = [n.strip() for n in a.clips.split(",") if n.strip()] or [k.split(".")[-1] for k in anims]
    fixed = {}
    for kv in a.var:
        k, v = kv.split("=")
        fixed[k] = float(v)
    base = [anims["animation.tall_wail." + b] for b in a.base.split(",") if b]
    views = a.views.split(",")
    for n in names:
        key = n if n.startswith("animation.") else "animation.tall_wail." + n
        anim = anims[key]
        L = anim.length if anim.length > 0 else 1.0
        times = [L * i / max(1, a.frames - 1) for i in range(a.frames)]
        cells = []
        for v in views:
            row = []
            for t in times:
                env = {"q.life_time": t, "q.anim_time": t}
                drv = DEFAULT_DRIVERS.get(n)
                if drv:
                    env.update(drv(t))
                env.update(fixed)
                layers = [(b, 1.0, 0.0) for b in base] + [(anim, 1.0, 0.0)]
                pose = bm.pose_from(anims, layers, t, env)
                W, H = (int(x) for x in a.size.split("x"))
                im = render(geo, tex, pose, v, size=(W, H), ppu=a.ppu, scale=a.scale, origin_y=H - 20)
                ImageDraw.Draw(im).text((4, 4), "%s %s t=%.2f" % (n, v, t), fill=(255, 255, 0))
                row.append(im)
            cells.append(row)
        w, h = cells[0][0].size
        sheet = Image.new("RGB", (w * len(times), h * len(views)))
        for r, row in enumerate(cells):
            for c, im in enumerate(row):
                sheet.paste(im, (c * w, r * h))
        sheet.save(os.path.join(a.out, "%s.png" % n.replace(".", "_")))
        print("wrote", n)


if __name__ == "__main__":
    main()
