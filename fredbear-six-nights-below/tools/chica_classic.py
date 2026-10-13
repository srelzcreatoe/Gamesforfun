#!/usr/bin/env python3
"""Chica, version 1.5: built on the owner's Classic Freddy model.

The owner asked for a Chica "based on the Freddy and Bonnie models and the animations they have, with
the same height and vibe". The Midnight Banjo Bonnie is itself built on the Classic Freddy body, so
Chica is too: every body shell, hand, foot, eyelid, brow and the eye rig of
art/models_incoming/Classic_Freddy_Pack.zip, with Freddy's own clips (idle, walk, run, the stare, the
shows, the jumpscare). What changes:

  * the suit: Freddy's brown fur becomes Chica's yellow, his tan belly and pads a pale cream; the blue
    irises turn violet (the black "active" eyes with white pupils stay as they are);
  * the face: no ears, no hat, no nose; the muzzle becomes an orange upper beak with a jutting tip,
    the jaw an orange lower beak that keeps Freddy's eight teeth;
  * a tuft of three feathers on top of the head; orange feet;
  * the bow tie is replaced by her bib, "LET'S EAT!!!";
  * the microphone is replaced by Mr. Cupcake on a plate (bone `cupcake`, in the same hand).

New parts are painted into atlas space no face of the kept model uses. Used by tools/owner_models.py.
"""
import colorsys
import io
import json
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont

GEO = "Classic_Freddy/classic_freddy.geo.json"
ANIM = "Classic_Freddy/classic_freddy.animation.json"
TEX = "Classic_Freddy/classic_freddy.png"
REMOVED = {"hat", "right_ear", "left_ear", "bow_tie", "microphone"}

YELLOW_H = 48 / 360.0
ORANGE_H = 26 / 360.0
VIOLET_H = 288 / 360.0


# --------------------------------------------------------------------------- texture
def recolour_suit(tex):
    """Brown fur -> yellow, tan -> cream, blue irises -> violet; greys, blacks and whites untouched."""
    a = np.asarray(tex.convert("RGBA")).astype(np.float32) / 255.0
    rgb = a[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    v = mx
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    d = np.maximum(mx - mn, 1e-6)
    h = np.select([mx == r, mx == g], [((g - b) / d) % 6, (b - r) / d + 2], (r - g) / d + 4) / 6.0
    hd = h * 360
    warm = (s > 0.25) & (hd >= 8) & (hd <= 45)
    blue = (s > 0.25) & (hd >= 170) & (hd <= 250)
    nh, ns, nv = h.copy(), s.copy(), v.copy()
    nh[warm] = YELLOW_H + (h[warm] - 28 / 360.0) * 0.25
    ns[warm] = np.clip(s[warm] * 1.06, 0, 0.84)
    nv[warm] = np.power(v[warm], 0.6)
    nh[blue] = VIOLET_H
    out = _hsv_to_rgb(nh, ns, nv)
    res = np.concatenate([out, a[..., 3:]], -1)
    return Image.fromarray((np.clip(res, 0, 1) * 255).round().astype(np.uint8), "RGBA").copy()


def _hsv_to_rgb(h, s, v):
    i = np.floor(h * 6).astype(int) % 6
    f = h * 6 - np.floor(h * 6)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    out = np.zeros(h.shape + (3,), np.float32)
    for k, (x, y, z) in enumerate([(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]):
        m = i == k
        out[m] = np.stack([x[m], y[m], z[m]], -1)
    return out


def face_rects(cube):
    out = []
    for e in cube["uv"].values():
        u, v = e["uv"]
        w, h = e["uv_size"]
        x0, x1 = sorted((u, u + w))
        y0, y1 = sorted((v, v + h))
        out.append((int(np.floor(x0)), int(np.floor(y0)), max(1, int(np.ceil(x1)) - int(np.floor(x0))), max(1, int(np.ceil(y1)) - int(np.floor(y0)))))
    return out


def paint_orange(px, src, rects, dark=False):
    """Repaint rects orange, keeping the original shading (value) of each texel."""
    for x0, y0, w, h in rects:
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                r, g, b, al = src[x, y]
                v = max(r, g, b) / 255.0
                vv = (0.55 + 0.3 * v) if not dark else (0.42 + 0.25 * v)
                rr, gg, bb = colorsys.hsv_to_rgb(ORANGE_H, 0.86, min(1.0, vv))
                px[x, y] = (int(rr * 255), int(gg * 255), int(bb * 255), al)


class Atlas:
    """Free rectangles in the texture: texels no kept face uses."""

    def __init__(self, used):
        self.used = used

    def alloc(self, w, h):
        H, W = self.used.shape
        for y in range(2, H - h - 2, 2):
            row = self.used[y - 1:y + h + 1]
            free = ~row.any(axis=0)
            run = 0
            for x in range(1, W - 1):
                run = run + 1 if free[x] else 0
                if run >= w + 2:
                    x0 = x - w
                    self.used[y - 1:y + h + 1, x0 - 1:x0 + w + 1] = True
                    return x0, y
        raise SystemExit(f"chica: no free {w}x{h} atlas space")


def swatch(img, atlas, color, w=8, h=8, seed=0, spread=0.07):
    x0, y0 = atlas.alloc(w, h)
    rnd = np.random.default_rng(seed)
    px = img.load()
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            k = 1 + spread * (rnd.random() * 2 - 1)
            px[x, y] = tuple(min(255, int(c * k)) for c in color[:3]) + (255,)
    return x0, y0, w, h


def box(origin, size, faces, rotation=None, pivot=None):
    """A cube whose six faces map to the given atlas rects ({face: (x, y, w, h)} or one rect for all)."""
    if not isinstance(faces, dict):
        faces = {f: faces for f in ("north", "south", "east", "west", "up", "down")}
    uv = {}
    for f in ("north", "south", "east", "west", "up", "down"):
        x, y, w, h = faces.get(f, faces.get("*"))
        uv[f] = {"uv": [x, y], "uv_size": [w, h]} if f not in ("up", "down") else {"uv": [x + w, y + h], "uv_size": [-w, -h]}
    c = {"origin": [round(v, 3) for v in origin], "size": [round(v, 3) for v in size], "uv": uv}
    if rotation:
        c["rotation"] = rotation
        c["pivot"] = pivot
    return c


def bib_texture(img, atlas):
    """The front of the bib: white with LET'S EAT!!! in bright letters (12 texels per block unit)."""
    w, h = 110, 98
    x0, y0 = atlas.alloc(w, h)
    d = ImageDraw.Draw(img)
    d.rectangle([x0, y0, x0 + w - 1, y0 + h - 1], fill=(236, 232, 222, 255))
    rnd = np.random.default_rng(7)
    px = img.load()
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            k = 1 + 0.035 * (rnd.random() * 2 - 1)
            r, g, b, _ = px[x, y]
            px[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), 255)
    d.rectangle([x0, y0, x0 + w - 1, y0 + h - 1], outline=(196, 186, 170, 255), width=3)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 25)
    except OSError:
        font = ImageFont.load_default()
    colours = [(150, 60, 190), (232, 112, 30), (40, 150, 170), (210, 40, 60), (110, 170, 40)]
    for line, words in enumerate(["LET'S", "EAT!!!"]):
        tw = d.textlength(words, font=font)
        x = x0 + (w - tw) / 2
        y = y0 + 14 + line * 38
        for i, ch in enumerate(words):
            col = colours[(i + line * 2) % len(colours)]
            d.text((x + 1.5, y + 1.5), ch, font=font, fill=(40, 30, 30, 255))
            d.text((x, y), ch, font=font, fill=col + (255,))
            x += d.textlength(ch, font=font)
    return x0, y0, w, h


def frosting_front(img, atlas):
    """Mr. Cupcake's face: pink frosting with two eyes."""
    x0, y0, w, h = swatch(img, atlas, (238, 112, 168), 18, 10, seed=11)
    d = ImageDraw.Draw(img)
    for ex in (4, 11):
        d.rectangle([x0 + ex, y0 + 3, x0 + ex + 2, y0 + 6], fill=(250, 250, 250, 255))
        d.rectangle([x0 + ex + 1, y0 + 4, x0 + ex + 1, y0 + 5], fill=(20, 20, 20, 255))
    return x0, y0, w, h


# --------------------------------------------------------------------------- build
def build(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        geo = json.loads(z.read(GEO))
        anims = json.loads(z.read(ANIM))["animations"]
        tex = Image.open(io.BytesIO(z.read(TEX))).convert("RGBA")
    g = geo["minecraft:geometry"][0]
    g["description"]["identifier"] = "geometry.chica_classic"
    bones = [b for b in g["bones"] if b["name"] not in REMOVED]
    B = {b["name"]: b for b in bones}

    used = np.zeros((tex.size[1], tex.size[0]), bool)
    for b in bones:
        for c in b.get("cubes", []):
            for x, y, w, h in face_rects(c):
                used[y:y + h + 1, x:x + w + 1] = True
    atlas = Atlas(used)

    src = tex.load()
    out = recolour_suit(tex)
    px = out.load()

    # The beak: muzzle and nose -> orange upper beak; jaw (not the teeth or the mouth) -> lower beak.
    for c in B["head"]["cubes"]:
        x, y, z = c["origin"]
        cx = x + c["size"][0] / 2
        if 42.5 <= y <= 47.3 and z <= -5.3 and abs(cx) < 4.8:
            paint_orange(px, src, face_rects(c), dark=y >= 46.0)
    for c in B["jaw"]["cubes"]:
        rr, gg, bb, _ = src[face_rects(c)[0][0], face_rects(c)[0][1]]
        if max(rr, gg, bb) > 200 or max(rr, gg, bb) < 40:
            continue  # teeth, the dark mouth
        paint_orange(px, src, face_rects(c))
    for foot in ("right_foot", "left_foot", "right_toes", "left_toes"):
        for c in B[foot].get("cubes", []):
            paint_orange(px, src, face_rects(c))

    orange = swatch(out, atlas, (232, 124, 34), seed=1)
    orange_dark = swatch(out, atlas, (196, 92, 22), seed=2)
    feather = swatch(out, atlas, (238, 206, 70), 6, 10, seed=3)
    white = swatch(out, atlas, (234, 232, 226), seed=4)
    plate = swatch(out, atlas, (226, 226, 230), seed=5, spread=0.03)
    wrapper = swatch(out, atlas, (226, 150, 182), seed=6)
    frosting = swatch(out, atlas, (238, 112, 168), seed=8)
    face = frosting_front(out, atlas)
    candle = swatch(out, atlas, (250, 240, 170), 4, 6, seed=9)
    flame = swatch(out, atlas, (255, 196, 60), 4, 4, seed=10, spread=0.02)
    bib = bib_texture(out, atlas)

    # Upper beak tip juts out over the mouth; the lower beak tip follows the jaw.
    B["head"]["cubes"] += [
        box([-2.7, 43.3, -9.3], [5.4, 2.8, 2.3], {"*": orange, "up": orange_dark}),
        box([-1.7, 43.6, -10.3], [3.4, 2.1, 1.05], orange_dark),
        # Three feathers where Freddy's hat was.
        box([-0.65, 52.2, -1.0], [1.3, 3.6, 1.3], feather),
        box([-2.4, 52.0, -0.6], [1.1, 2.8, 1.1], feather, rotation=[0, 0, 22], pivot=[-1.85, 52.0, -0.05]),
        box([1.3, 52.0, -0.6], [1.1, 2.8, 1.1], feather, rotation=[0, 0, -22], pivot=[1.85, 52.0, -0.05]),
    ]
    B["jaw"]["cubes"] += [box([-2.5, 40.85, -8.1], [5.0, 1.5, 1.9], orange)]

    # The bib on the chest (the bow tie's place) and Mr. Cupcake in the microphone's hand.
    bones.append({"name": "bib", "parent": "torso", "pivot": [0, 37.0, -6.1], "cubes": [
        box([-4.6, 28.2, -6.4], [9.2, 8.2, 0.36], {"*": white, "north": bib}),
    ]})
    bones.append({"name": "cupcake", "parent": "right_hand", "pivot": [-7.1, 15.84, -0.05], "cubes": [
        box([-10.1, 15.0, -8.8], [5.6, 0.45, 5.6], plate),
        box([-8.5, 15.45, -7.2], [2.4, 1.6, 2.4], wrapper),
        box([-8.75, 17.05, -7.45], [2.9, 1.3, 2.9], {"*": frosting, "north": face}),
        box([-7.55, 18.35, -6.25], [0.5, 1.4, 0.5], candle),
        box([-7.6, 19.75, -6.3], [0.6, 0.6, 0.6], flame),
    ]})
    g["bones"] = bones

    # Freddy's clips, with the microphone's channels moved to the cupcake and removed parts dropped.
    raw = {}
    for name, a in anims.items():
        clip = {k: v for k, v in a.items() if k != "bones"}
        clip["bones"] = {}
        for bone, chans in a["bones"].items():
            if bone == "microphone":
                clip["bones"]["cupcake"] = chans
            elif bone not in REMOVED:
                clip["bones"][bone] = chans
        raw[name.replace("classic_freddy", "chica")] = clip
    return geo, raw, out
