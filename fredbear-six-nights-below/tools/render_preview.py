#!/usr/bin/env python3
"""Offline preview renderer for the generated animatronic geometry.

This is a static check of geometry + box-UV mapping, NOT an in-game screenshot:
it draws every cube face texel-by-texel with an orthographic camera and a
painter's sort, using the cube UV layout of Bedrock box UV
([side -X][front][side +X][back] under [top][bottom]). Bone rotations use
R = Rz * Ry * Rx about each bone pivot, inherited from parents; lighting is a
fixed per-face shade. Output: docs/model_previews.png
"""
import json
import math
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
RP = ROOT / "packs" / "FredbearRP"
OUT = ROOT / "docs" / "model_previews.png"


def rot_matrix(rx, ry, rz):
    x, y, z = (math.radians(a) for a in (rx, ry, rz))
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    rxm = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    rym = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    rzm = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return matmul(rzm, matmul(rym, rxm))


def matmul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def apply(m, p):
    return [sum(m[i][k] * p[k] for k in range(3)) for i in range(3)]


def bone_transforms(bones, pose):
    """Return name -> function(point) giving the posed model-space point."""
    by_name = {b["name"]: b for b in bones}
    cache = {}

    def get(name):
        if name in cache:
            return cache[name]
        b = by_name[name]
        r = list(b.get("rotation", [0, 0, 0]))
        extra = pose.get(name, [0, 0, 0])
        r = [r[i] + extra[i] for i in range(3)]
        m = rot_matrix(-r[0], -r[1], r[2])  # Bedrock: +X pitches the top forward (-Z), +Y yaws, +Z rolls
        piv = b.get("pivot", [0, 0, 0])
        parent = get(b["parent"]) if b.get("parent") else (lambda p: p)

        def f(p, m=m, piv=piv, parent=parent):
            q = apply(m, [p[0] - piv[0], p[1] - piv[1], p[2] - piv[2]])
            return parent([q[0] + piv[0], q[1] + piv[1], q[2] + piv[2]])
        cache[name] = f
        return f
    return {b["name"]: get(b["name"]) for b in bones}


def faces_of(c):
    (ox, oy, oz), (w, h, d) = c["origin"], c["size"]
    inf = c.get("inflate", 0)
    x0, y0, z0 = ox - inf, oy - inf, oz - inf
    x1, y1, z1 = ox + w + inf, oy + h + inf, oz + d + inf
    u, v = c["uv"]
    # (texture rect, function (s, t) in [0,1]^2 -> 3D point, outward normal)
    return [
        ((u + d, v + d, w, h), lambda s, t: (x0 + (x1 - x0) * s, y1 - (y1 - y0) * t, z0), (0, 0, -1)),
        ((u + 2 * d + w, v + d, w, h), lambda s, t: (x1 - (x1 - x0) * s, y1 - (y1 - y0) * t, z1), (0, 0, 1)),
        ((u, v + d, d, h), lambda s, t: (x0, y1 - (y1 - y0) * t, z1 - (z1 - z0) * s), (-1, 0, 0)),
        ((u + d + w, v + d, d, h), lambda s, t: (x1, y1 - (y1 - y0) * t, z0 + (z1 - z0) * s), (1, 0, 0)),
        ((u + d, v, w, d), lambda s, t: (x0 + (x1 - x0) * s, y1, z1 - (z1 - z0) * t), (0, 1, 0)),
        ((u + d + w, v, w, d), lambda s, t: (x0 + (x1 - x0) * s, y0, z0 + (z1 - z0) * t), (0, -1, 0)),
    ]


def render(geo, tex, yaw_deg, pose, size=(220, 300), scale=6.0):
    bones = geo["minecraft:geometry"][0]["bones"]
    xf = bone_transforms(bones, pose)
    yaw = math.radians(yaw_deg)
    cy, sy = math.cos(yaw), math.sin(yaw)
    quads = []
    for b in bones:
        f = xf[b["name"]]
        for c in b.get("cubes", []):
            for (tu, tv, tw, th), fn, normal in faces_of(c):
                if tw <= 0 or th <= 0:
                    continue
                n0 = f([0, 0, 0])
                n1 = f(list(normal))
                nrm = [n1[i] - n0[i] for i in range(3)]
                nz = -sy * nrm[0] * -1 + cy * nrm[2]  # view-space z of the normal (camera looks toward +Z)
                shade = 0.65 + 0.35 * max(0.0, -nz) + (0.12 if nrm[1] > 0.5 else 0)
                for j in range(int(th)):
                    for i in range(int(tw)):
                        px = tex.getpixel((tu + i, tv + j))
                        if px[3] < 128:
                            continue
                        corners = [fn(i / tw, j / th), fn((i + 1) / tw, j / th), fn((i + 1) / tw, (j + 1) / th), fn(i / tw, (j + 1) / th)]
                        pts = []
                        depth = 0
                        for p in corners:
                            q = f(list(p))
                            x = q[0] * cy + q[2] * sy
                            z = -q[0] * sy + q[2] * cy
                            pts.append((size[0] / 2 + x * scale, size[1] - 12 - q[1] * scale))
                            depth += z
                        col = tuple(min(255, int(ch * shade)) for ch in px[:3])
                        quads.append((depth / 4, pts, col))
    img = Image.new("RGBA", size, (24, 22, 30, 255))
    d = ImageDraw.Draw(img)
    for _, pts, col in sorted(quads, key=lambda q: -q[0]):
        d.polygon(pts, fill=col)
    return img


def main():
    names = ["freddy", "bonnie", "chica", "fredbear", "fredbear_echo"]
    views = [("front", 0, {}), ("three-quarter", 35, {}), ("side", 90, {}),
             ("jaw open", 25, {"jaw": [45, 0, 0], "leftArm": [-150, 0, -25], "rightArm": [-150, 0, 25], "head": [-20, 0, 0]})]
    tile_w, tile_h = 220, 300
    sheet = Image.new("RGBA", (tile_w * len(views), tile_h * len(names) + 20), (12, 12, 16, 255))
    d = ImageDraw.Draw(sheet)
    for r, n in enumerate(names):
        geo_name = "fredbear" if n == "fredbear_echo" else n
        geo = json.loads((RP / "models" / "entity" / f"fb_{geo_name}.geo.json").read_text())
        tex = Image.open(RP / "textures" / "entity" / "fb" / f"{n}.png").convert("RGBA")
        for c, (label, yaw, pose) in enumerate(views):
            sheet.alpha_composite(render(geo, tex, yaw, pose), (c * tile_w, r * tile_h))
            d.text((c * tile_w + 6, r * tile_h + 4), f"{n} - {label}", fill=(230, 230, 230, 255))
    d.text((6, tile_h * len(names) + 4), "Offline preview of geometry + UVs (tools/render_preview.py). Not an in-game screenshot.", fill=(200, 200, 200, 255))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
