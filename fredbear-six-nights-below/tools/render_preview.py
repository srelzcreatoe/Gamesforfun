#!/usr/bin/env python3
"""Offline preview renderer for the generated animatronic geometry.

This is a static check of geometry, UV mapping and animation poses, NOT an
in-game screenshot: every cube face is drawn texel-by-texel with an
orthographic camera and a painter's sort. Box UV and per-face UV are both
supported (per-face UV follows Blockbench's box-UV face layout, including the
flipped up/down faces). Bone rotations use R = Rz * Ry * Rx about each bone
pivot (signs matched to vanilla animation conventions), inherited from parents; poses are sampled from the real animation file.
Output: docs/model_previews.png
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


# ------------------------------------------------------------------ animation sampling
def sample(channel, t):
    """Value of an animation channel (constant, keyframe dict, pre/post snaps) at time t."""
    if isinstance(channel, (int, float)):
        return [channel] * 3
    if isinstance(channel, list):
        return channel
    keys = sorted((float(k), v) for k, v in channel.items())

    def val(v, side):
        if isinstance(v, dict):
            return v["pre" if side == "pre" else "post"]
        return v

    if t <= keys[0][0]:
        return val(keys[0][1], "pre")
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            a = val(v0, "post")
            b = val(v1, "pre")
            f = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            return [a[i] + (b[i] - a[i]) * f for i in range(3)]
    return val(keys[-1][1], "post")


def pose_from(anim, t):
    rot, pos, scale = {}, {}, {}
    for bone, ch in anim.get("bones", {}).items():
        if "rotation" in ch:
            rot[bone] = sample(ch["rotation"], t)
        if "position" in ch:
            pos[bone] = sample(ch["position"], t)
        if "scale" in ch:
            scale[bone] = sample(ch["scale"], t)
    return {"rot": rot, "pos": pos, "scale": scale}


# ------------------------------------------------------------------ geometry
def bone_transforms(bones, pose):
    """Return name -> function(point) giving the posed model-space point."""
    by_name = {b["name"]: b for b in bones}
    cache = {}

    def get(name):
        if name in cache:
            return cache[name]
        b = by_name[name]
        r = list(b.get("rotation", [0, 0, 0]))
        extra = pose["rot"].get(name, [0, 0, 0])
        r = [r[i] + extra[i] for i in range(3)]
        # Game conventions: +X pitches the top forward (-Z); +Z rolls the top toward +X (vanilla evoker/bob
        # animations raise rightArm (at -X) outward with +Z and leftArm (at +X) with -Z).
        m = rot_matrix(-r[0], -r[1], -r[2])
        piv = b.get("pivot", [0, 0, 0])
        off = pose["pos"].get(name, [0, 0, 0])
        parent = get(b["parent"]) if b.get("parent") else (lambda p: p)

        def f(p, m=m, piv=piv, parent=parent, off=off):
            q = apply(m, [p[0] - piv[0], p[1] - piv[1], p[2] - piv[2]])
            return parent([q[0] + piv[0] + off[0], q[1] + piv[1] + off[1], q[2] + piv[2] - off[2]])
        cache[name] = f
        return f
    return {b["name"]: get(b["name"]) for b in bones}


def hidden_bones(bones, pose):
    """Bones scaled to zero (and their children)."""
    zero = {n for n, s in pose["scale"].items() if all(abs(v) < 1e-6 for v in s)}
    changed = True
    while changed:
        changed = False
        for b in bones:
            if b.get("parent") in zero and b["name"] not in zero:
                zero.add(b["name"])
                changed = True
    return zero


def face_uvs(c):
    """Per-face UV rects {face: (u, v, w, h)} in Blockbench's layout, for box or per-face UV cubes."""
    if isinstance(c["uv"], dict):
        return {f: (*e["uv"], *e["uv_size"]) for f, e in c["uv"].items()}
    u, v = c["uv"]
    w, h, d = c["size"]
    return {
        "north": (u + d, v + d, w, h), "east": (u, v + d, d, h), "south": (u + 2 * d + w, v + d, w, h),
        "west": (u + d + w, v + d, d, h), "up": (u + d + w, v + d, -w, -d), "down": (u + d + 2 * w, v, -w, d),
    }


def faces_of(c):
    (ox, oy, oz), (w, h, d) = c["origin"], c["size"]
    inf = c.get("inflate", 0)
    x0, y0, z0 = ox - inf, oy - inf, oz - inf
    x1, y1, z1 = ox + w + inf, oy + h + inf, oz + d + inf
    geo = {  # (s, t) in [0,1]^2 -> 3D point, outward normal, (a, b) per-face uv param -> (s, t)
        "north": (lambda s, t: (x0 + (x1 - x0) * s, y1 - (y1 - y0) * t, z0), (0, 0, -1), lambda a, b: (a, b)),
        "south": (lambda s, t: (x1 - (x1 - x0) * s, y1 - (y1 - y0) * t, z1), (0, 0, 1), lambda a, b: (a, b)),
        "east": (lambda s, t: (x0, y1 - (y1 - y0) * t, z1 - (z1 - z0) * s), (-1, 0, 0), lambda a, b: (a, b)),
        "west": (lambda s, t: (x1, y1 - (y1 - y0) * t, z0 + (z1 - z0) * s), (1, 0, 0), lambda a, b: (a, b)),
        "up": (lambda s, t: (x0 + (x1 - x0) * s, y1, z1 - (z1 - z0) * t), (0, 1, 0), lambda a, b: (1 - a, 1 - b)),
        "down": (lambda s, t: (x0 + (x1 - x0) * s, y0, z0 + (z1 - z0) * t), (0, -1, 0), lambda a, b: (1 - a, b)),
    }
    out = []
    for face, (u, v, sw, sh) in face_uvs(c).items():
        fn, normal, param = geo[face]
        out.append((u, v, sw, sh, fn, normal, param))
    return out


def render(geo, tex, yaw_deg, pose, size=(220, 300), scale=6.0, ground=12):
    bones = geo["minecraft:geometry"][0]["bones"]
    xf = bone_transforms(bones, pose)
    hide = hidden_bones(bones, pose)
    yaw = math.radians(yaw_deg)
    cy, sy = math.cos(yaw), math.sin(yaw)
    quads = []
    for b in bones:
        if b["name"] in hide:
            continue
        f = xf[b["name"]]
        for c in b.get("cubes", []):
            for u, v, sw, sh, fn, normal, param in faces_of(c):
                tw, th = int(round(abs(sw))), int(round(abs(sh)))
                if tw == 0 or th == 0:
                    continue
                n0 = f([0, 0, 0])
                n1 = f(list(normal))
                nrm = [n1[i] - n0[i] for i in range(3)]
                nz = sy * nrm[0] + cy * nrm[2]
                shade = 0.65 + 0.35 * max(0.0, -nz) + (0.12 if nrm[1] > 0.5 else 0)
                for j in range(th):
                    for i in range(tw):
                        px = tex.getpixel((u + i if sw > 0 else u - 1 - i, v + j if sh > 0 else v - 1 - j))
                        if px[3] < 128:
                            continue
                        corners = []
                        for a, bb in ((i / tw, j / th), ((i + 1) / tw, j / th), ((i + 1) / tw, (j + 1) / th), (i / tw, (j + 1) / th)):
                            corners.append(fn(*param(a, bb)))
                        pts = []
                        depth = 0
                        for p in corners:
                            q = f(list(p))
                            x = q[0] * cy + q[2] * sy
                            z = -q[0] * sy + q[2] * cy
                            pts.append((size[0] / 2 + x * scale, size[1] - ground - q[1] * scale))
                            depth += z
                        col = tuple(min(255, int(ch * shade)) for ch in px[:3])
                        quads.append((depth / 4, pts, col))
    img = Image.new("RGBA", size, (24, 22, 30, 255))
    d = ImageDraw.Draw(img)
    for _, pts, col in sorted(quads, key=lambda q: -q[0]):
        d.polygon(pts, fill=col)
    return img


def load_clips(who):
    return json.loads((RP / "animations" / f"fb_{who}.animation.json").read_text())["animations"]


def main():
    anims = json.loads((RP / "animations" / "fb_animatronic.animation.json").read_text())["animations"]
    rest = {"rot": {}, "pos": {}, "scale": {}}
    hide_prop = pose_from(anims["animation.fb.hide_prop"], 0)
    tile_w, tile_h = 220, 300
    clips = {who: load_clips(who) for who in ("fredbear", "freddy", "bonnie", "morgrave", "valek")}

    def clip(who, name, t):
        return pose_from(clips[who][f"animation.fb.{who}.{name}"], t)

    def with_hide(p):  # Chica's cupcake is hidden outside the show
        return {"rot": p["rot"], "pos": p["pos"], "scale": {**p["scale"], **hide_prop["scale"]}}

    # rows: (label, [(tile name, geometry, texture, yaw, pose)])
    rows = []
    for who, show, extra in (("freddy", "perform_showman", "stalk"), ("bonnie", "perform_solo", "crawl")):
        rows.append((who, [
            ("front (idle)", who, who, 0, clip(who, "idle", 0)),
            ("three-quarter", who, who, 35, clip(who, "idle", 1.0)),
            (f"show: {show.split('_')[1]}", who, who, 25, clip(who, show, 1.2)),
            (f"{extra} (added)", who, who, 50, clip(who, extra, 0.4)),
            ("threat (added)", who, who, 20, clip(who, "threat", 0.5)),
        ]))
    rows.append(("chica", [
        ("front", "chica", "chica", 0, with_hide(rest)),
        ("three-quarter", "chica", "chica", 35, with_hide(rest)),
        ("perform", "chica", "chica", 25, pose_from(anims["animation.fb.perform.chica"], 0.25)),
        ("threat (jaw open)", "chica", "chica", 20, with_hide(pose_from(anims["animation.fb.threat"], 0.5))),
        ("attack", "chica", "chica", 25, with_hide(pose_from(anims["animation.fb.attack"], 0.8))),
    ]))
    rows.append(("withered (night 7+)", [
        ("freddy", "freddy", "freddy_withered", 20, clip("freddy", "idle", 0)),
        ("bonnie", "bonnie", "bonnie_withered", 20, clip("bonnie", "idle", 0)),
        ("chica", "chica", "chica_withered", 20, with_hide(rest)),
        ("bonnie: dormant", "bonnie", "bonnie_withered", 35, clip("bonnie", "pose_powered_down", 0.5)),
        ("freddy: dormant", "freddy", "freddy_withered", 35, clip("freddy", "dormant", 0.5)),
    ]))
    for who, extra in (("morgrave", "crawl"), ("valek", "stalk")):
        rows.append((who, [
            ("front (idle)", who, who, 0, clip(who, "idle", 0)),
            ("three-quarter", who, who, 35, clip(who, "idle", 1.0)),
            (f"{extra} (added)", who, who, 60 if extra == "crawl" else 30, clip(who, extra, 0.4 if extra == "crawl" else 0.9)),
            ("threat (added)", who, who, 20, clip(who, "threat", 0.5)),
            ("jumpscare", who, who, 15, clip(who, "jumpscare", 1.1)),
        ]))
    rows.append(("fredbear", [
        ("front (idle)", "fredbear", "fredbear", 0, clip("fredbear", "idle", 0)),
        ("three-quarter", "fredbear", "fredbear", 35, clip("fredbear", "idle", 1.2)),
        ("show: sing", "fredbear", "fredbear", 25, clip("fredbear", "perform_sing", 1.6)),
        ("threat (points at you)", "fredbear", "fredbear", 20, clip("fredbear", "perform_crowd_point", 2.0)),
        ("jumpscare: snap bite", "fredbear", "fredbear", 20, clip("fredbear", "jumpscare_snap_bite", 0.7)),
    ]))
    rows.append(("fredbear (more)", [
        ("crawl (added)", "fredbear", "fredbear", 60, clip("fredbear", "crawl", 0.3)),
        ("bow (door held)", "fredbear", "fredbear", 70, clip("fredbear", "pose_bow", 2.0)),
        ("showman (Golden Hour)", "fredbear", "fredbear", 25, clip("fredbear", "pose_showman", 3.0)),
        ("echo (false camera)", "fredbear", "fredbear_echo", 20, clip("fredbear", "idle", 0)),
        ("shadow on the stage", "fredbear", "fredbear_shadow", 15, clip("fredbear", "idle", 0)),
    ]))
    geos, texs, scales = {}, {}, {}
    for _, tiles in rows:
        for _, g, t, _, _ in tiles:
            if g not in geos:
                geos[g] = json.loads((RP / "models" / "entity" / f"fb_{g}.geo.json").read_text())
                top = max(c["origin"][1] + c["size"][1] for b in geos[g]["minecraft:geometry"][0]["bones"] for c in b.get("cubes", []))
                scales[g] = min(6.0, 250.0 / top)
            if t not in texs:
                texs[t] = Image.open(RP / "textures" / "entity" / "fb" / f"{t}.png").convert("RGBA")
    sheet = Image.new("RGBA", (tile_w * 5, tile_h * len(rows) + 20), (12, 12, 16, 255))
    d = ImageDraw.Draw(sheet)
    for r, (label, tiles) in enumerate(rows):
        for c, (name, g, t, yaw, pose) in enumerate(tiles):
            sheet.alpha_composite(render(geos[g], texs[t], yaw, pose, scale=scales[g]), (c * tile_w, r * tile_h))
            d.text((c * tile_w + 6, r * tile_h + 4), f"{label} - {name}", fill=(230, 230, 230, 255))
    d.text((6, tile_h * len(rows) + 4), "Offline preview of geometry, UVs and animation poses (tools/render_preview.py). Not an in-game screenshot.", fill=(200, 200, 200, 255))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
