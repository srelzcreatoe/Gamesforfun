#!/usr/bin/env python3
"""Generate the resource pack's art and model JSON from the supplied skins and models.

Inputs  : art/skins/*.png (the skins supplied by the map owner, unmodified)
          art/models_incoming/*.zip (the owner's models, read as-is): Fredbear V6
          (tools/fredbear_v6.py); Freddy V6, Bonnie V2, Morgrave and Valek (tools/owner_models.py).
          Chica is still built from her skin. The skin-built Freddy, Bonnie and Fredbear
          are still generated, but only into art/models_archive/<name>_v1/ (kept, not in the game).
Outputs : packs/FredbearRP/
            textures/entity/fb/<name>.png        128x64: skin (left half) + accessory atlas (right half)
            textures/entity/fb/<name>_eyes.png   128x64: only the glowing pupils
            textures/items/fb_*.png              16x16 item icons
            textures/item_texture.json
            models/entity/fb_<name>.geo.json     geometry (format 1.21.0, humanoid layout + accessories)
            animations/fb_animatronic.animation.json
            animation_controllers/fb_animatronic.animation_controllers.json
            render_controllers/fb_animatronic.render_controllers.json
            entity/fb_<name>.entity.json         client entities (format 1.10.0)
            fogs/fb_night_<n>.json               per-night fog (format 1.21.90)
            texts/en_US.lang, texts/languages.json
            pack_icon.png (both packs)

Formats mirror the vanilla files in Mojang/bedrock-samples v1.26.50.4:
  geometry 1.21.0 (models/entity/humanoid.custom.geo.json), client entity 1.10.0,
  animations 1.8.0, animation controllers 1.10.0, render controllers 1.10.0
  (creaking two-layer eyes pattern), fogs 1.21.90.

The script is deterministic: running it twice produces identical files.
"""
import json
import pathlib
import random

from PIL import Image, ImageDraw

import fredbear_v6 as V6
import owner_models as OM

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKINS = ROOT / "art" / "skins"
FREDBEAR_ZIP = ROOT / "art" / "models_incoming" / "Fredbear_V6_NoEyeDots_Complete.zip"
ARCHIVE = ROOT / "art" / "models_archive" / "fredbear_v1"
MODELS_IN = ROOT / "art" / "models_incoming"
# Head turn toward a point (the stare at the camera, heads following you in Free Roam), eased per frame.
LOOK_PRE = [
    "variable.fb_ly = math.lerp(variable.fb_ly, query.property('fb:look_yaw'), 0.06);",
    "variable.fb_lp = math.lerp(variable.fb_lp, query.property('fb:look_pitch'), 0.06);",
    "variable.fb_lt = math.lerp(variable.fb_lt, query.property('fb:look_tilt'), 0.05);",
]
RP = ROOT / "packs" / "FredbearRP"
BP = ROOT / "packs" / "FredbearBP"
TEX_W, TEX_H = 128, 64
ANIMS = ["idle", "perform", "walk", "stalk", "crawl", "look", "pause", "threat", "attack", "retreat", "dormant", "music"]
BONES = ["root", "waist", "body", "head", "snout", "jaw", "leftEar", "rightEar", "crown", "leftArm", "rightArm", "leftLeg", "rightLeg", "prop"]


def rgb(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def mul(c, f):
    return (max(0, min(255, int(c[0] * f))), max(0, min(255, int(c[1] * f))), max(0, min(255, int(c[2] * f))), c[3])


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------- skins
def legacy_to_64x64(src):
    """Convert a legacy 64x32 skin to 64x64 the way the game does: the left arm
    and left leg reuse the right limbs, each face mirrored, outer faces swapped."""
    out = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    out.paste(src, (0, 0))

    def copy(sx, sy, dx, dy, w, h):
        region = src.crop((sx, sy, sx + w, sy + h)).transpose(Image.FLIP_LEFT_RIGHT)
        out.paste(region, (sx + dx, sy + dy))

    # leg (0,16) -> left leg (16,48)
    copy(4, 16, 16, 32, 4, 4)
    copy(8, 16, 16, 32, 4, 4)
    copy(0, 20, 24, 32, 4, 12)
    copy(4, 20, 16, 32, 4, 12)
    copy(8, 20, 8, 32, 4, 12)
    copy(12, 20, 16, 32, 4, 12)
    # arm (40,16) -> left arm (32,48)
    copy(44, 16, -8, 32, 4, 4)
    copy(48, 16, -8, 32, 4, 4)
    copy(40, 20, 0, 32, 4, 12)
    copy(44, 20, -8, 32, 4, 12)
    copy(48, 20, -16, 32, 4, 12)
    copy(52, 20, -8, 32, 4, 12)
    return out


def load_skin(name):
    im = Image.open(SKINS / name).convert("RGBA")
    if im.size == (64, 32):
        return legacy_to_64x64(im)
    if im.size != (64, 64):
        raise SystemExit(f"{name}: unsupported skin size {im.size}")
    return im


# --------------------------------------------------------------------------- atlas
class Atlas:
    """Shelf packer for box-UV accessory cubes in the right half of the texture."""

    def __init__(self, x0=64, x1=128, y0=0, y1=64):
        self.x0, self.x1, self.y1 = x0, x1, y1
        self.x, self.y, self.row_h = x0, y0, 0

    def alloc(self, w, h):
        if self.x + w > self.x1:
            self.x = self.x0
            self.y += self.row_h
            self.row_h = 0
        if self.y + h > self.y1:
            raise SystemExit("accessory atlas full")
        u, v = self.x, self.y
        self.x += w
        self.row_h = max(self.row_h, h)
        return u, v


def box_faces(u, v, size):
    w, h, d = size
    return {
        "top": (u + d, v, w, d),
        "bottom": (u + d + w, v, w, d),
        "east": (u, v + d, d, h),
        "front": (u + d, v + d, w, h),
        "west": (u + d + w, v + d, d, h),
        "back": (u + 2 * d + w, v + d, w, h),
    }


def fill(color, noise=0.07, edge=0.82):
    def paint(img, x0, y0, w, h, rnd):
        for yy in range(h):
            for xx in range(w):
                f = 1.0 + rnd.uniform(-noise, noise)
                if w >= 3 and h >= 3 and (xx in (0, w - 1) or yy in (0, h - 1)):
                    f *= edge
                img.putpixel((x0 + xx, y0 + yy), mul(color, f))
    return paint


def inner(border, centre):
    def paint(img, x0, y0, w, h, rnd):
        fill(border, edge=1.0)(img, x0, y0, w, h, rnd)
        for yy in range(1, max(1, h - 1)):
            for xx in range(1, max(1, w - 1)):
                img.putpixel((x0 + xx, y0 + yy), mul(centre, 1.0 + rnd.uniform(-0.05, 0.05)))
    return paint


def band(base, band_color, band_rows=1):
    def paint(img, x0, y0, w, h, rnd):
        fill(base, edge=1.0)(img, x0, y0, w, h, rnd)
        for yy in range(max(0, h - band_rows), h):
            for xx in range(w):
                img.putpixel((x0 + xx, y0 + yy), band_color)
    return paint


def dots(base, dot, positions):
    def paint(img, x0, y0, w, h, rnd):
        fill(base, edge=1.0)(img, x0, y0, w, h, rnd)
        for (xx, yy) in positions:
            if xx < w and yy < h:
                img.putpixel((x0 + xx, y0 + yy), dot)
    return paint


def cube(origin, size, paint, inflate=None):
    """paint: a painter for every face, or a dict face -> painter with key '*' as default."""
    return {"origin": origin, "size": size, "paint": paint, "inflate": inflate}


# --------------------------------------------------------------------------- characters
def character_specs():
    fr = dict(fur=rgb("613819"), fur2=rgb("4d2c14"), muzzle=rgb("a9774a"), nose=rgb("1c1c1c"),
              tooth=rgb("efe6cf"), gap=rgb("3a2a1a"), mouth=rgb("3a0d0b"), hat=rgb("161616"), band=rgb("2e2e2e"),
              inner=rgb("39200f"))
    bo = dict(fur=rgb("611d62"), fur2=rgb("4f1850"), muzzle=rgb("8f84a5"), nose=rgb("1a0a1a"),
              tooth=rgb("dcdcdc"), gap=rgb("2a1030"), mouth=rgb("2a0a10"), inner=rgb("b28fc0"),
              red=rgb("b01818"), wood=rgb("3b2410"), hole=rgb("1a0606"))
    ch = dict(fur=rgb("a4a219"), fur2=rgb("bab81c"), beak=rgb("d9512b"), beak2=rgb("b23f1f"),
              tooth=rgb("f0f0e0"), gap=rgb("5a1a0a"), mouth=rgb("3a0a05"), tuft=rgb("d1ce1f"),
              plate=rgb("e4e4e4"), wrapper=rgb("e7a6c0"), frosting=rgb("ff5fa2"), candle=rgb("fff2a0"),
              eye=rgb("101010"))
    fb = dict(fur=rgb("907600"), fur2=rgb("755f00"), muzzle=rgb("bb9900"), nose=rgb("1c1601"),
              tooth=rgb("f5e5a7"), gap=rgb("2c2301"), mouth=rgb("2c0a01"), purple=rgb("3c0496"),
              purple2=rgb("4d1977"), band=rgb("1c0a3a"), metal=rgb("8a8a8a"), grill=rgb("4a4a4a"),
              handle=rgb("c8a000"))
    mic_fr = [
        cube([-6.5, 10.5, -5], [1, 1, 5], fill(rgb("303030"))),
        cube([-7, 10, -7], [2, 2, 2], {"*": fill(rgb("8a8a8a")), "front": dots(rgb("8a8a8a"), rgb("4a4a4a"), [(0, 0), (1, 1)])}),
    ]
    mic_fb = [
        cube([-6.5, 10.5, -5], [1, 1, 5], fill(fb["handle"])),
        cube([-7, 10, -7], [2, 2, 2], {"*": fill(fb["metal"]), "front": dots(fb["metal"], fb["grill"], [(0, 0), (1, 1)])}),
    ]

    specs = {}
    specs["freddy"] = dict(
        skin="freddy_source.png", label="Freddy",
        eyes=[((10, 11), "e8f4ff"), ((13, 11), "e8f4ff")],
        mouth=dict(tooth=fr["tooth"], dark=rgb("140504"), roof=fr["mouth"], tongue=rgb("6a1c1a"), teeth="TgTgTgT"),
        bones={
            "leftEar": dict(pivot=[3, 32, 0], cubes=[cube([2, 32, -0.5], [3, 3, 1], {"*": fill(fr["fur"]), "front": inner(fr["fur"], fr["inner"])})]),
            "rightEar": dict(pivot=[-3, 32, 0], cubes=[cube([-5, 32, -0.5], [3, 3, 1], {"*": fill(fr["fur"]), "front": inner(fr["fur"], fr["inner"])})]),
            "crown": dict(pivot=[0, 32.5, 0], rotation=[-6, 0, 0], cubes=[
                cube([-3, 32.5, -3], [6, 1, 6], fill(fr["hat"])),
                cube([-2, 33.5, -2], [4, 4, 4], {"*": band(fr["hat"], fr["band"]), "top": fill(fr["hat"]), "bottom": fill(fr["hat"])}),
            ]),
            "prop": dict(parent="rightArm", pivot=[-6, 12, 0], cubes=mic_fr),
        },
        hide_prop_unless_perform=False,
    )
    specs["bonnie"] = dict(
        skin="bonnie_source.png", label="Bonnie",
        eyes=[((9, 10), "ffe8ff"), ((10, 10), "ffe8ff"), ((9, 11), "ffe8ff"),
              ((13, 10), "ffe8ff"), ((14, 10), "ffe8ff"), ((14, 11), "ffe8ff")],
        mouth=dict(tooth=bo["tooth"], dark=rgb("12040f"), roof=bo["mouth"], tongue=rgb("5e1a3a"), teeth="TTgTgTT"),
        bones={
            "leftEar": dict(pivot=[2, 32, 0], rotation=[0, 0, 10], cubes=[cube([1, 32, -0.5], [2, 8, 1], {"*": fill(bo["fur"]), "front": inner(bo["fur"], bo["inner"])})]),
            "rightEar": dict(pivot=[-2, 32, 0], rotation=[0, 0, -10], cubes=[cube([-3, 32, -0.5], [2, 8, 1], {"*": fill(bo["fur"]), "front": inner(bo["fur"], bo["inner"])})]),
            "crown": dict(pivot=[0, 32, 0], cubes=[]),
            "prop": dict(parent="body", pivot=[0, 17, -3], rotation=[0, 0, 30], cubes=[
                cube([-3, 12, -4.5], [6, 5, 1], {"*": fill(bo["red"]), "front": dots(bo["red"], bo["hole"], [(2, 2), (3, 2)])}),
                cube([-0.5, 17, -4.5], [1, 8, 1], fill(bo["wood"])),
                cube([-1, 25, -4.5], [2, 2, 1], fill(bo["red"])),
            ]),
        },
        hide_prop_unless_perform=True,
    )
    specs["chica"] = dict(
        skin="chica_source_legacy64x32.png", label="Chica",
        eyes=[((10, 12), "d070ff"), ((13, 12), "d070ff"), ((9, 12), "ffffff"), ((14, 12), "ffffff")],
        mouth=dict(tooth=ch["tooth"], dark=rgb("1a0603"), roof=ch["mouth"], tongue=rgb("7a2a12"), teeth="TgTTTgT"),
        # Beak: the skin's own beak pixels (hat layer rows 5 and 7, columns 2-5) extruded slightly.
        beak=dict(upper=dict(uv=(42, 13, 4, 1), depth=1.5), lower=dict(uv=(42, 15, 4, 1), depth=1.25)),
        bones={
            "leftEar": dict(pivot=[2, 32, 0], cubes=[]),
            "rightEar": dict(pivot=[-2, 32, 0], cubes=[]),
            "crown": dict(pivot=[0, 32, 0], cubes=[
                cube([-1, 32.5, -1.5], [1, 2, 1], fill(ch["tuft"])),
                cube([0, 32.5, -0.5], [1, 3, 1], fill(ch["tuft"])),
                cube([-1, 32.5, 0.5], [1, 2, 1], fill(ch["tuft"])),
            ]),
            "prop": dict(parent="leftArm", pivot=[6, 12, 0], cubes=[
                cube([4, 10.5, -6], [4, 1, 4], fill(ch["plate"])),
                cube([5, 11.5, -5], [2, 1, 2], fill(ch["wrapper"])),
                cube([5, 12.5, -5], [2, 2, 2], {"*": fill(ch["frosting"]), "front": dots(ch["frosting"], ch["eye"], [(0, 0), (1, 0)])}),
                cube([5.5, 14.5, -4.5], [1, 1, 1], fill(ch["candle"])),
            ]),
        },
        hide_prop_unless_perform=False,
    )
    specs["fredbear"] = dict(
        skin="fredbear_source.png", label="Fredbear",
        eyes=[((10, 11), "fff6d0"), ((13, 11), "fff6d0")],
        mouth=dict(tooth=fb["tooth"], dark=rgb("140a01"), roof=fb["mouth"], tongue=rgb("5a1a06"), teeth="TgTgTgT"),
        bones={
            "leftEar": dict(pivot=[3, 32, 0], cubes=[cube([2, 32, -0.5], [3, 3, 1], {"*": fill(fb["fur"]), "front": inner(fb["fur"], fb["purple"])})]),
            "rightEar": dict(pivot=[-3, 32, 0], cubes=[cube([-5, 32, -0.5], [3, 3, 1], {"*": fill(fb["fur"]), "front": inner(fb["fur"], fb["purple"])})]),
            "crown": dict(pivot=[0, 32.5, 0], rotation=[-4, 0, 0], cubes=[
                cube([-3, 32.5, -3], [6, 1, 6], fill(fb["purple"])),
                cube([-2, 33.5, -2], [4, 4, 4], {"*": band(fb["purple2"], fb["band"]), "top": fill(fb["purple2"]), "bottom": fill(fb["purple2"])}),
            ]),
            "prop": dict(parent="rightArm", pivot=[-6, 12, 0], cubes=mic_fb),
        },
        hide_prop_unless_perform=False,
    )
    return specs


# --------------------------------------------------------------------------- geometry
def humanoid_bones():
    """Bone set of vanilla geometry.humanoid.custom (bedrock-samples models/entity/humanoid.custom.geo.json)."""
    return [
        dict(name="root", pivot=[0, 0, 0]),
        dict(name="waist", parent="root", pivot=[0, 12, 0]),
        dict(name="body", parent="waist", pivot=[0, 24, 0], cubes=[
            {"origin": [-4, 12, -2], "size": [8, 12, 4], "uv": [16, 16]},
            {"origin": [-4, 12, -2], "size": [8, 12, 4], "uv": [16, 32], "inflate": 0.25},
        ]),
        dict(name="head", parent="body", pivot=[0, 24, 0], cubes=[
            {"origin": [-4, 24, -4], "size": [8, 8, 8], "uv": [0, 0]},
            {"origin": [-4, 24, -4], "size": [8, 8, 8], "uv": [32, 0], "inflate": 0.5},
        ]),
        dict(name="leftArm", parent="body", pivot=[5, 22, 0], cubes=[
            {"origin": [4, 12, -2], "size": [4, 12, 4], "uv": [32, 48]},
            {"origin": [4, 12, -2], "size": [4, 12, 4], "uv": [48, 48], "inflate": 0.25},
        ]),
        dict(name="rightArm", parent="body", pivot=[-5, 22, 0], cubes=[
            {"origin": [-8, 12, -2], "size": [4, 12, 4], "uv": [40, 16]},
            {"origin": [-8, 12, -2], "size": [4, 12, 4], "uv": [40, 32], "inflate": 0.25},
        ]),
        dict(name="leftLeg", parent="root", pivot=[1.9, 12, 0], cubes=[
            {"origin": [-0.1, 0, -2], "size": [4, 12, 4], "uv": [16, 48]},
            {"origin": [-0.1, 0, -2], "size": [4, 12, 4], "uv": [0, 48], "inflate": 0.25},
        ]),
        dict(name="rightLeg", parent="root", pivot=[-1.9, 12, 0], cubes=[
            {"origin": [-3.9, 0, -2], "size": [4, 12, 4], "uv": [0, 16]},
            {"origin": [-3.9, 0, -2], "size": [4, 12, 4], "uv": [0, 32], "inflate": 0.25},
        ]),
    ]


def pf(u, v, w, h):
    """One per-face UV entry (negative sizes flip, as Blockbench exports box UV faces)."""
    return {"uv": [u, v], "uv_size": [w, h]}


def head_side_faces(u0, v0, row0, rows):
    """Side faces of an 8x8x8 box-UV head at (u0, v0), restricted to texture rows row0..row0+rows-1.
    Face placement follows Blockbench's box-UV layout (east | north | west | south)."""
    v = v0 + 8 + row0
    return {"east": pf(u0, v, 8, rows), "north": pf(u0 + 8, v, 8, rows), "west": pf(u0 + 16, v, 8, rows), "south": pf(u0 + 24, v, 8, rows)}


JAW_ROW = 6  # the jaw is the bottom two rows of the face (rows 6-7): the mouth opens at y = 26


def head_and_jaw(spec, tex, atlas, rnd):
    """Split head: the skin's face stays exactly as drawn, with a full-width jaw hinged at the back.
    Teeth and a dark mouth cavity sit inside the closed head and only show when the jaw opens."""
    m = spec["mouth"]
    bx, by = atlas.alloc(2, 2)  # left transparent: hidden inner faces of the hat layer
    blank = pf(bx, by, 1, 1)
    dx, dy = atlas.alloc(2, 2)
    fill(m["dark"], noise=0.03, edge=1.0)(tex, dx, dy, 2, 2, rnd)
    dark = pf(dx, dy, 2, 2)
    rx, ry = atlas.alloc(8, 8)
    fill(m["roof"], noise=0.08, edge=0.7)(tex, rx, ry, 8, 8, rnd)
    roof = pf(rx, ry, 8, 8)
    gx, gy = atlas.alloc(8, 8)
    fill(m["dark"], noise=0.05, edge=1.0)(tex, gx, gy, 8, 8, rnd)
    fill(m["tongue"], noise=0.08, edge=1.0)(tex, gx + 2, gy + 1, 4, 6, rnd)
    tongue = pf(gx, gy, 8, 8)
    tx, ty = atlas.alloc(8, 1)
    for i, ch in enumerate(m["teeth"]):
        tex.putpixel((tx + i, ty), m["tooth"] if ch == "T" else m["dark"])
    tex.putpixel((tx + 7, ty), m["tooth"])
    teeth_front = pf(tx, ty, 7, 1)
    tooth = pf(tx, ty, 1, 1)

    def teeth_cube(y):
        return {"origin": [-3.5, y, -3.8], "size": [7, 0.6, 0.5],
                "uv": {"north": teeth_front, "south": tooth, "east": tooth, "west": tooth, "up": tooth, "down": tooth}}

    upper = 8 - JAW_ROW  # 2 rows in the jaw, 6 above
    head_cubes = [
        # base layer, rows 0-5
        {"origin": [-4, 32 - JAW_ROW, -4], "size": [8, JAW_ROW, 8],
         "uv": {**head_side_faces(0, 0, 0, JAW_ROW), "up": pf(16, 8, -8, -8), "down": roof}},
        # hat (outer) layer, rows 0-5; same texel size as the vanilla 0.5 inflate (9/8 per pixel)
        {"origin": [-4.5, 32.5 - JAW_ROW * 1.125, -4.5], "size": [9, JAW_ROW * 1.125, 9],
         "uv": {**head_side_faces(32, 0, 0, JAW_ROW), "up": pf(48, 8, -8, -8), "down": blank}},
        # mouth cavity (inside the jaw while closed)
        {"origin": [-3.6, 24.3, -3.6], "size": [7.2, 1.7, 7.2],
         "uv": {f: dark for f in ("north", "south", "east", "west", "up", "down")}},
        teeth_cube(25.4),
    ]
    jaw_cubes = [
        {"origin": [-4, 24, -4], "size": [8, upper, 8],
         "uv": {**head_side_faces(0, 0, JAW_ROW, upper), "down": pf(24, 0, -8, 8), "up": tongue}},
        {"origin": [-4.5, 23.5, -4.5], "size": [9, upper * 1.125, 9],
         "uv": {**head_side_faces(32, 0, JAW_ROW, upper), "down": pf(56, 0, -8, 8), "up": blank}},
        teeth_cube(26),
    ]
    snout_cubes = []
    beak = spec.get("beak")
    if beak:
        def beak_cube(part, y):
            u, v, w, h = beak[part]["uv"]
            face = pf(u, v, w, h)
            side = pf(u, v, 1, h)
            depth = beak[part]["depth"]
            return {"origin": [-2.25, y, -4.5 - depth], "size": [4.5, 1.125, depth],
                    "uv": {"north": face, "up": face, "down": face, "south": face, "east": side, "west": side}}
        snout_cubes.append(beak_cube("upper", 32.5 - 6 * 1.125))  # hat row 5
        jaw_cubes.append(beak_cube("lower", 32.5 - 8 * 1.125))  # hat row 7
    return head_cubes, jaw_cubes, snout_cubes


def build_character(name, spec):
    skin = load_skin(spec["skin"])
    tex = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
    tex.paste(skin, (0, 0))
    atlas = Atlas()
    rnd = random.Random(f"fb-{name}")
    bones = humanoid_bones()
    head_cubes, jaw_cubes, snout_cubes = head_and_jaw(spec, tex, atlas, rnd)
    next(b for b in bones if b["name"] == "head")["cubes"] = head_cubes
    bones.append({"name": "snout", "parent": "head", "pivot": [0, 26, -4], **({"cubes": snout_cubes} if snout_cubes else {})})
    bones.append({"name": "jaw", "parent": "head", "pivot": [0, 26, 4], "cubes": jaw_cubes})
    for bone_name in ["leftEar", "rightEar", "crown", "prop"]:
        b = spec["bones"][bone_name]
        parent = b.get("parent", "head")
        bone = {"name": bone_name, "parent": parent, "pivot": b["pivot"]}
        if "rotation" in b:
            bone["rotation"] = b["rotation"]
        cubes = []
        for c in b["cubes"]:
            w, h, d = c["size"]
            u, v = atlas.alloc(2 * (d + w), d + h)
            paint = c["paint"]
            for face, (x0, y0, fw, fh) in box_faces(u, v, c["size"]).items():
                p = paint.get(face, paint["*"]) if isinstance(paint, dict) else paint
                p(tex, x0, y0, fw, fh, rnd)
            entry = {"origin": c["origin"], "size": c["size"], "uv": [u, v]}
            if c["inflate"]:
                entry["inflate"] = c["inflate"]
            cubes.append(entry)
        if cubes:
            bone["cubes"] = cubes
        bones.append(bone)
    geo = {
        "format_version": "1.21.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": f"geometry.fb.{name}",
                "texture_width": TEX_W,
                "texture_height": TEX_H,
                "visible_bounds_width": 3.5,
                "visible_bounds_height": 4,
                "visible_bounds_offset": [0, 1.8, 0],
            },
            "bones": bones,
        }],
    }
    eyes = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
    for (x, y), col in spec["eyes"]:
        eyes.putpixel((x, y), rgb(col))
    return tex, eyes, geo


def echo_texture(src):
    """Fredbear's false-camera echo: purple, scan-lined and partly broken up."""
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    rnd = random.Random("fb-echo")
    for y in range(src.size[1]):
        for x in range(src.size[0]):
            r, g, b, a = src.getpixel((x, y))
            if a == 0:
                continue
            lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255.0
            f = 0.55 if y % 2 else 1.0
            col = (int((70 + 120 * lum) * f), int((10 + 40 * lum) * f), int((120 + 135 * lum) * f), 255)
            if y % 2 and rnd.random() < 0.18:
                continue  # broken scanline pixel (alpha-tested hole)
            out.putpixel((x, y), col)
    return out


# --------------------------------------------------------------------------- animations
def kf(*pairs):
    return {f"{t:.2f}": v for t, v in pairs}


def snap(before, after):
    return {"pre": before, "post": after}


def beat(period, length, lo, hi, offset=0.0):
    """Keyframes alternating lo/hi every `period` seconds over `length` (loops cleanly)."""
    out = {}
    t = 0.0
    i = 0
    while t <= length + 1e-6:
        out[f"{t + offset:.2f}"] = hi if i % 2 else lo
        t += period
        i += 1
    out[f"{length:.2f}"] = lo
    return out


def jaw(deg):
    return [deg, 0, 0]


def animations():
    """Shared animations for every animatronic (bone names are identical in all four models).
    Rotations follow vanilla conventions: arms -X = raised forward, rightArm +Z / leftArm -Z = outward,
    jaw +X = open (hinged at the back of the head)."""
    A = {}
    A["animation.fb.idle"] = {"loop": True, "animation_length": 4.0, "bones": {
        "body": {"rotation": kf((0, [0, 0, 0]), (2, [1.5, 0, 0]), (4, [0, 0, 0]))},
        "head": {"rotation": {"0.00": [0, 0, 0], "1.60": snap([0, 0, 0], [2, 8, 0]), "2.40": snap([2, 8, 0], [0, 0, 0]), "4.00": [0, 0, 0]}},
        "jaw": {"rotation": {"0.00": jaw(4), "3.00": snap(jaw(4), jaw(11)), "3.20": snap(jaw(11), jaw(4)), "4.00": jaw(4)}},
        "leftArm": {"rotation": kf((0, [0, 0, -3]), (2, [2, 0, -5]), (4, [0, 0, -3]))},
        "rightArm": {"rotation": kf((0, [0, 0, 3]), (2, [2, 0, 5]), (4, [0, 0, 3]))},
    }}
    # ---- stage performances, one per character (props stay in the hands)
    A["animation.fb.perform.freddy"] = {"loop": True, "animation_length": 2.0, "bones": {
        "waist": {"rotation": kf((0, [0, 0, 0]), (0.5, [2, 0, 0]), (1, [0, 0, 0]), (1.5, [2, 0, 0]), (2, [0, 0, 0]))},
        "body": {"rotation": kf((0, [0, 0, -3]), (1, [0, 0, 3]), (2, [0, 0, -3]))},
        "head": {"rotation": kf((0, [0, 0, -4]), (0.5, [6, 0, 0]), (1, [0, 0, 4]), (1.5, [6, 0, 0]), (2, [0, 0, -4]))},
        "jaw": {"rotation": kf((0, jaw(2)), (0.25, jaw(16)), (0.5, jaw(3)), (0.75, jaw(14)), (1, jaw(3)), (1.25, jaw(18)), (1.5, jaw(3)), (1.75, jaw(10)), (2, jaw(2)))},
        "rightArm": {"rotation": kf((0, [-80, 0, 4]), (1, [-86, 0, 7]), (2, [-80, 0, 4]))},  # microphone at the mouth
        "leftArm": {"rotation": kf((0, [-20, 0, -12]), (0.5, [-45, 0, -22]), (1, [-20, 0, -12]), (1.5, [-45, 0, -22]), (2, [-20, 0, -12]))},
        "rightLeg": {"rotation": kf((0, [0, 0, 0]), (0.25, [-8, 0, 0]), (0.5, [0, 0, 0]), (1.25, [-8, 0, 0]), (1.5, [0, 0, 0]), (2, [0, 0, 0]))},
    }}
    A["animation.fb.perform.bonnie"] = {"loop": True, "animation_length": 1.6, "bones": {
        "body": {"rotation": kf((0, [0, 0, -3]), (0.8, [0, 0, 3]), (1.6, [0, 0, -3]))},
        "head": {"rotation": kf((0, [0, 0, 0]), (0.4, [8, 0, 0]), (0.8, [0, 0, 0]), (1.2, [8, 0, 0]), (1.6, [0, 0, 0]))},
        "jaw": {"rotation": kf((0, jaw(2)), (0.4, jaw(12)), (0.8, jaw(2)), (1.2, jaw(14)), (1.6, jaw(2)))},
        "leftEar": {"rotation": kf((0, [0, 0, 0]), (0.4, [0, 0, 6]), (0.8, [0, 0, 0]), (1.2, [0, 0, 6]), (1.6, [0, 0, 0]))},
        "rightEar": {"rotation": kf((0, [0, 0, 0]), (0.4, [0, 0, -6]), (0.8, [0, 0, 0]), (1.2, [0, 0, -6]), (1.6, [0, 0, 0]))},
        "rightArm": {"rotation": beat(0.2, 1.6, [-30, 0, 6], [-18, 0, 6])},  # strumming hand at the guitar body
        "leftArm": {"rotation": kf((0, [-55, 0, -8]), (0.8, [-63, 0, -8]), (1.6, [-55, 0, -8]))},  # fretting hand on the neck
        "leftLeg": {"rotation": kf((0, [0, 0, 0]), (0.4, [-7, 0, 0]), (0.8, [0, 0, 0]), (1.2, [-7, 0, 0]), (1.6, [0, 0, 0]))},
    }}
    A["animation.fb.perform.chica"] = {"loop": True, "animation_length": 2.0, "bones": {
        "body": {"rotation": kf((0, [0, 0, -2]), (1, [0, 0, 2]), (2, [0, 0, -2]))},
        "head": {"rotation": kf((0, [0, 0, -8]), (1, [4, 0, 8]), (2, [0, 0, -8]))},
        "jaw": {"rotation": kf((0, jaw(2)), (0.25, jaw(14)), (0.5, jaw(2)), (0.75, jaw(12)), (1, jaw(2)), (1.25, jaw(14)), (1.5, jaw(2)), (1.75, jaw(10)), (2, jaw(2)))},
        "leftArm": {"rotation": kf((0, [-50, 0, -4]), (1, [-56, 0, -6]), (2, [-50, 0, -4]))},  # presenting the cupcake
        "prop": {"rotation": kf((0, [50, 0, 0]), (1, [56, 0, 0]), (2, [50, 0, 0]))},  # keeps the plate level
        "rightArm": {"rotation": kf((0, [-20, 0, 45]), (0.5, [-20, 0, 70]), (1, [-20, 0, 45]), (1.5, [-20, 0, 70]), (2, [-20, 0, 45]))},  # waving
    }}
    A["animation.fb.walk"] = {"loop": True, "animation_length": 1.2, "bones": {
        "leftLeg": {"rotation": kf((0, [25, 0, 0]), (0.6, [-25, 0, 0]), (1.2, [25, 0, 0]))},
        "rightLeg": {"rotation": kf((0, [-25, 0, 0]), (0.6, [25, 0, 0]), (1.2, [-25, 0, 0]))},
        "leftArm": {"rotation": kf((0, [-15, 0, -4]), (0.6, [15, 0, -4]), (1.2, [-15, 0, -4]))},
        "rightArm": {"rotation": kf((0, [15, 0, 4]), (0.6, [-15, 0, 4]), (1.2, [15, 0, 4]))},
        "body": {"rotation": kf((0, [0, 4, 0]), (0.6, [0, -4, 0]), (1.2, [0, 4, 0]))},
        "head": {"rotation": {"0.00": [5, 0, 0], "0.30": snap([5, 0, 0], [5, 6, 0]), "0.90": snap([5, 6, 0], [5, 0, 0]), "1.20": [5, 0, 0]}},
        "jaw": {"rotation": kf((0, jaw(5)), (0.3, jaw(9)), (0.6, jaw(5)), (0.9, jaw(9)), (1.2, jaw(5)))},
        "root": {"position": kf((0, [0, 0, 0]), (0.3, [0, 0.6, 0]), (0.6, [0, 0, 0]), (0.9, [0, 0.6, 0]), (1.2, [0, 0, 0]))},
    }}
    A["animation.fb.stalk"] = {"loop": True, "animation_length": 2.0, "bones": {
        "waist": {"rotation": [16, 0, 0]},
        "head": {"rotation": kf((0, [-14, 0, 0]), (1, [-14, 10, 4]), (2, [-14, 0, 0]))},
        "jaw": {"rotation": jaw(12)},
        "leftArm": {"rotation": kf((0, [-35, 0, -6]), (1, [-25, 0, -6]), (2, [-35, 0, -6]))},
        "rightArm": {"rotation": kf((0, [-25, 0, 6]), (1, [-35, 0, 6]), (2, [-25, 0, 6]))},
        "leftLeg": {"rotation": kf((0, [15, 0, 0]), (1, [-15, 0, 0]), (2, [15, 0, 0]))},
        "rightLeg": {"rotation": kf((0, [-15, 0, 0]), (1, [15, 0, 0]), (2, [-15, 0, 0]))},
    }}
    A["animation.fb.crawl"] = {"loop": True, "animation_length": 1.6, "bones": {
        "root": {"rotation": [80, 0, 0], "position": [0, 2, 0]},
        "head": {"rotation": [-60, 0, 0]},
        "jaw": {"rotation": jaw(14)},
        "leftArm": {"rotation": kf((0, [-100, 0, 0]), (0.8, [-60, 0, 0]), (1.6, [-100, 0, 0]))},
        "rightArm": {"rotation": kf((0, [-60, 0, 0]), (0.8, [-100, 0, 0]), (1.6, [-60, 0, 0]))},
        "leftLeg": {"rotation": kf((0, [6, 0, 0]), (0.8, [-6, 0, 0]), (1.6, [6, 0, 0]))},
        "rightLeg": {"rotation": kf((0, [-6, 0, 0]), (0.8, [6, 0, 0]), (1.6, [-6, 0, 0]))},
    }}
    A["animation.fb.look"] = {"loop": True, "animation_length": 4.0, "bones": {
        "head": {"rotation": {
            "0.00": [0, 0, 0],
            "0.50": snap([0, 0, 0], [0, 35, 0]),
            "1.80": snap([0, 35, 0], [4, 20, 6]),
            "2.10": snap([4, 20, 6], [0, -35, 0]),
            "3.40": snap([0, -35, 0], [0, 0, 0]),
            "4.00": [0, 0, 0]}},
        "jaw": {"rotation": jaw(4)},
        "body": {"rotation": kf((0, [0, 0, 0]), (1, [0, 6, 0]), (2.5, [0, -6, 0]), (4, [0, 0, 0]))},
    }}
    A["animation.fb.pause"] = {"loop": True, "animation_length": 2.0, "bones": {
        "head": {"rotation": kf((0, [6, 22, 12]), (1, [6, 23, 12.5]), (2, [6, 22, 12]))},
        "jaw": {"rotation": jaw(8)},
        "leftLeg": {"rotation": [14, 0, 0]},
        "rightLeg": {"rotation": [-14, 0, 0]},
        "leftArm": {"rotation": [-10, 0, -4]},
        "rightArm": {"rotation": [10, 0, 4]},
    }}
    A["animation.fb.threat"] = {"loop": True, "animation_length": 1.0, "bones": {
        "waist": {"rotation": [10, 0, 0]},
        "head": {"rotation": {"0.00": [-6, 0, 8], "0.45": snap([-6, 0, 8], [-6, 6, -8]), "0.85": snap([-6, 6, -8], [-6, 0, 8]), "1.00": [-6, 0, 8]}},
        "jaw": {"rotation": kf((0, jaw(22)), (0.5, jaw(34)), (1, jaw(22)))},
        "leftArm": {"rotation": kf((0, [-55, 0, -10]), (0.5, [-48, 0, -12]), (1, [-55, 0, -10]))},
        "rightArm": {"rotation": kf((0, [-45, 0, 10]), (0.5, [-52, 0, 12]), (1, [-45, 0, 10]))},
    }}
    A["animation.fb.attack"] = {"loop": "hold_on_last_frame", "animation_length": 0.8, "bones": {
        "root": {"position": kf((0, [0, 0, 0]), (0.15, [0, 1, -4]), (0.8, [0, 1, -4]))},
        "leftArm": {"rotation": kf((0, [-40, 0, -10]), (0.15, [-150, 0, -25]), (0.8, [-145, 0, -25]))},
        "rightArm": {"rotation": kf((0, [-40, 0, 10]), (0.15, [-150, 0, 25]), (0.8, [-145, 0, 25]))},
        "head": {"rotation": kf((0, [0, 0, 0]), (0.15, [-20, 0, 0]), (0.3, [-20, 10, 0]), (0.4, [-20, -10, 0]), (0.5, [-20, 10, 0]), (0.6, [-20, -10, 0]), (0.8, [-20, 0, 0]))},
        "jaw": {"rotation": kf((0, jaw(4)), (0.12, jaw(55)), (0.8, jaw(55)))},
    }}
    A["animation.fb.retreat"] = {"loop": True, "animation_length": 1.4, "bones": {
        "leftLeg": {"rotation": kf((0, [-20, 0, 0]), (0.7, [20, 0, 0]), (1.4, [-20, 0, 0]))},
        "rightLeg": {"rotation": kf((0, [20, 0, 0]), (0.7, [-20, 0, 0]), (1.4, [20, 0, 0]))},
        "head": {"rotation": [18, 0, 0]},
        "jaw": {"rotation": jaw(4)},
        "leftArm": {"rotation": [6, 0, -3]},
        "rightArm": {"rotation": [6, 0, 3]},
    }}
    A["animation.fb.dormant"] = {"loop": True, "animation_length": 6.0, "bones": {
        "waist": {"rotation": [24, 0, 4]},
        "head": {"rotation": {"0.00": [40, 0, 15], "4.20": snap([40, 0, 15], [34, 6, 10]), "4.40": snap([34, 6, 10], [40, 0, 15]), "6.00": [40, 0, 15]}},
        "jaw": {"rotation": jaw(24)},
        "leftArm": {"rotation": [12, 0, -10]},
        "rightArm": {"rotation": [8, 0, 14]},
        "leftLeg": {"rotation": [-4, 0, -3]},
        "rightLeg": {"rotation": [-4, 0, 3]},
    }}
    A["animation.fb.music"] = {"loop": True, "animation_length": 3.0, "bones": {
        "head": {"rotation": kf((0, [0, -20, -6]), (1.5, [0, 20, 6]), (3, [0, -20, -6]))},
        "jaw": {"rotation": kf((0, jaw(4)), (0.75, jaw(16)), (1.5, jaw(4)), (2.25, jaw(16)), (3, jaw(4)))},
        "body": {"rotation": kf((0, [0, 0, -3]), (1.5, [0, 0, 3]), (3, [0, 0, -3]))},
    }}
    A["animation.fb.hide_prop"] = {"loop": True, "bones": {"prop": {"scale": 0}}}
    # Additive head turn toward a point (fb:look_* properties, eased in the client entity's pre_animation).
    A["animation.fb.look_at"] = {"loop": True, "bones": {"head": {"rotation": ["variable.fb_lp", "variable.fb_ly", "variable.fb_lt"]}}}
    return {"format_version": "1.8.0", "animations": A}


# The skin-built Fredbear's stage show (archived with that model, see archive_old_fredbear).
OLD_FREDBEAR_PERFORM = {"loop": True, "animation_length": 2.4, "bones": {
    "waist": {"rotation": kf((0, [0, 0, 0]), (1.2, [3, 0, 0]), (2.4, [0, 0, 0]))},
    "body": {"rotation": kf((0, [0, 0, -4]), (1.2, [0, 0, 4]), (2.4, [0, 0, -4]))},
    "head": {"rotation": kf((0, [0, 0, -5]), (0.6, [8, 0, 0]), (1.2, [0, 0, 5]), (1.8, [8, 0, 0]), (2.4, [0, 0, -5]))},
    "jaw": {"rotation": kf((0, jaw(2)), (0.3, jaw(20)), (0.6, jaw(3)), (0.9, jaw(16)), (1.2, jaw(3)), (1.5, jaw(20)), (1.8, jaw(3)), (2.1, jaw(12)), (2.4, jaw(2)))},
    "rightArm": {"rotation": kf((0, [-80, 0, 4]), (1.2, [-86, 0, 7]), (2.4, [-80, 0, 4]))},  # microphone at the mouth
    "leftArm": {"rotation": kf((0, [-70, 0, -35]), (1.2, [-85, 0, -45]), (2.4, [-70, 0, -35]))},
}}


def controller():
    states = {}
    for a in ANIMS:
        st = {"animations": [a], "blend_transition": 0.05 if a == "attack" else 0.2,
              "transitions": [{b: f"variable.fb_anim == '{b}'"} for b in ANIMS if b != a]}
        states[a] = st
    return {"format_version": "1.10.0", "animation_controllers": {
        "controller.animation.fb.pose": {"initial_state": "idle", "states": states}}}


def render_controllers():
    return {"format_version": "1.10.0", "render_controllers": {
        "controller.render.fb.animatronic": {
            "geometry": "Geometry.default",
            "materials": [{"*": "Material.default"}],
            "textures": ["Texture.default"],
            "part_visibility": [{"*": "!variable.fb_hidden"}],
        },
        "controller.render.fb.eyes": {
            "geometry": "Geometry.default",
            "materials": [{"*": "Material.eyes"}],
            "textures": ["Texture.eyes"],
            "ignore_lighting": True,
            "part_visibility": [{"*": "variable.fb_eyes && !variable.fb_hidden"}],
        },
        # Freddy, Bonnie, Chica: fb:variant 1 = withered suit (nights 7-9 and the challenges).
        "controller.render.fb.withered": {
            "arrays": {"textures": {"Array.skins": ["Texture.default", "Texture.withered"]}},
            "geometry": "Geometry.default",
            "materials": [{"*": "Material.default"}],
            "textures": ["Array.skins[variable.fb_variant]"],
            "part_visibility": [{"*": "!variable.fb_hidden"}],
        },
        # Valek: fb:variant 1 = only his eyes show (on the hunt, in the dark).
        "controller.render.fb.valek": {
            "geometry": "Geometry.default",
            "materials": [{"*": "Material.default"}],
            "textures": ["Texture.default"],
            "part_visibility": [{"*": "!variable.fb_hidden && variable.fb_variant != 1"}],
        },
        # Fredbear's camera echo: fb:variant 0 = purple ECHO feed, 1 = black stage silhouette (shadow Fredbear).
        "controller.render.fb.echo": {
            "arrays": {"textures": {"Array.skins": ["Texture.default", "Texture.shadow"]}},
            "geometry": "Geometry.default",
            "materials": [{"*": "Material.default"}],
            "textures": ["Array.skins[variable.fb_variant]"],
            "part_visibility": [{"*": "!variable.fb_hidden"}],
        },
        "controller.render.fb.echo_eyes": {
            "arrays": {"textures": {"Array.eyes": ["Texture.eyes", "Texture.shadow_eyes"]}},
            "geometry": "Geometry.default",
            "materials": [{"*": "Material.eyes"}],
            "textures": ["Array.eyes[variable.fb_variant]"],
            "ignore_lighting": True,
            "part_visibility": [{"*": "variable.fb_eyes && !variable.fb_hidden"}],
        },
    }}


def client_entity(identifier, geo, tex, eyes_tex, hide_prop, perform, withered=None):
    animate = ["pose_controller", "look_at"]
    if hide_prop:
        animate.append({"hide_prop": "variable.fb_anim != 'perform'"})
    anims = {"pose_controller": "controller.animation.fb.pose", "hide_prop": "animation.fb.hide_prop", "look_at": "animation.fb.look_at"}
    for a in ANIMS:
        anims[a] = f"animation.fb.{a}"
    anims["perform"] = f"animation.fb.perform.{perform}"
    textures = {"default": tex, "eyes": eyes_tex}
    if withered:
        textures["withered"] = withered
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": identifier,
        "materials": {"default": "entity_alphatest", "eyes": "creaking_eyes"},
        "textures": textures,
        "geometry": {"default": geo},
        "scripts": {
            "pre_animation": [
                "variable.fb_anim = query.property('fb:anim');",
                "variable.fb_eyes = query.property('fb:eyes');",
                "variable.fb_hidden = query.property('fb:hidden');",
                "variable.fb_variant = query.property('fb:variant');",
                *LOOK_PRE,
            ],
            "animate": animate,
        },
        "animations": anims,
        "render_controllers": ["controller.render.fb.withered" if withered else "controller.render.fb.animatronic", "controller.render.fb.eyes"],
    }}}


def fredbear_client_entity(identifier, textures, render_controllers, look=True):
    """Fredbear V6 client entity: own controller (rotating shows, three jumpscares by fb:variant)."""
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": identifier,
        "materials": {"default": "entity_alphatest", "eyes": "creaking_eyes"},
        "textures": textures,
        "geometry": {"default": "geometry.fb.fredbear"},
        "scripts": {
            "pre_animation": [
                "variable.fb_anim = query.property('fb:anim');",
                "variable.fb_eyes = query.property('fb:eyes');",
                "variable.fb_hidden = query.property('fb:hidden');",
                "variable.fb_variant = query.property('fb:variant');",
                *(LOOK_PRE if look else []),
            ],
            "animate": ["pose_controller", *(["look_at"] if look else [])],
        },
        "animations": {**V6.client_animation_map(), **({"look_at": "animation.fb.fredbear.look_at"} if look else {})},
        "render_controllers": render_controllers,
    }}}


def build_fredbear_v6(tex_dir):
    """The owner's Fredbear V6 model with all 12 clips (+ crawl, stalk, dormant, chained shows)."""
    geo, raw, tex = V6.load(FREDBEAR_ZIP)
    g = V6.geometry(geo)
    write_json(RP / "models" / "entity" / "fb_fredbear.geo.json", g)
    tex.save(tex_dir / "fredbear.png")
    size = tex.size
    V6.eye_mask(g, size, rgb("fff3b0"), rgb("ffb020")).save(tex_dir / "fredbear_eyes.png")
    echo_texture(tex).save(tex_dir / "fredbear_echo.png")
    V6.eye_mask(g, size, rgb("f0a0ff"), rgb("b040e0")).save(tex_dir / "fredbear_echo_eyes.png")
    V6.shadow_texture(tex).save(tex_dir / "fredbear_shadow.png")
    V6.eye_mask(g, size, rgb("ff3a2a"), rgb("8a0a06")).save(tex_dir / "fredbear_shadow_eyes.png")
    clips, worst = V6.clips(raw)
    clips["animation.fb.fredbear.look_at"] = {"loop": True, "bones": {"head": {"rotation": ["variable.fb_lp", "variable.fb_ly", "variable.fb_lt"]}}}
    write_json(RP / "animations" / "fb_fredbear.animation.json", {"format_version": "1.8.0", "animations": clips})
    write_json(RP / "animation_controllers" / "fb_fredbear.animation_controllers.json", {"format_version": "1.10.0", "animation_controllers": V6.controller()})
    write_json(RP / "entity" / "fb_fredbear.entity.json", fredbear_client_entity(
        "fb:fredbear", {"default": "textures/entity/fb/fredbear", "eyes": "textures/entity/fb/fredbear_eyes"},
        ["controller.render.fb.animatronic", "controller.render.fb.eyes"]))
    write_json(RP / "entity" / "fb_fredbear_echo.entity.json", fredbear_client_entity(
        "fb:fredbear_echo", {"default": "textures/entity/fb/fredbear_echo", "shadow": "textures/entity/fb/fredbear_shadow",
                             "eyes": "textures/entity/fb/fredbear_echo_eyes", "shadow_eyes": "textures/entity/fb/fredbear_shadow_eyes"},
        ["controller.render.fb.echo", "controller.render.fb.echo_eyes"], look=False))
    return len(clips), worst


def owner_client_entity(who, spec, textures, render_controllers):
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": f"fb:{who}",
        "materials": {"default": "entity_alphatest", "eyes": "creaking_eyes"},
        "textures": textures,
        "geometry": {"default": f"geometry.fb.{who}"},
        "scripts": {
            "pre_animation": [
                "variable.fb_anim = query.property('fb:anim');",
                "variable.fb_eyes = query.property('fb:eyes');",
                "variable.fb_hidden = query.property('fb:hidden');",
                "variable.fb_variant = query.property('fb:variant');",
                *LOOK_PRE,
            ],
            "animate": ["pose_controller", OM.LOOK_ANIM],
        },
        "animations": OM.client_animation_map(who, spec),
        "render_controllers": render_controllers,
    }}}


def build_owner_model(who, tex_dir):
    """Freddy V6, Bonnie V2, Morgrave, Valek (tools/owner_models.py). Returns a summary dict."""
    spec = OM.MODELS[who]
    geo, raw, tex = OM.load(MODELS_IN / spec["zip"], spec)
    write_json(RP / "models" / "entity" / f"fb_{who}.geo.json", OM.geometry(geo, who))
    tex.save(tex_dir / f"{who}.png")
    OM.eye_texture(geo, tex, spec).save(tex_dir / f"{who}_eyes.png")
    textures = {"default": f"textures/entity/fb/{who}", "eyes": f"textures/entity/fb/{who}_eyes"}
    rcs = ["controller.render.fb.animatronic", "controller.render.fb.eyes"]
    if spec["withered"]:
        OM.withered_texture(tex, geo, seed=f"withered-{who}").save(tex_dir / f"{who}_withered.png")
        textures["withered"] = f"textures/entity/fb/{who}_withered"
        rcs[0] = "controller.render.fb.withered"
    if who == "valek":
        rcs[0] = "controller.render.fb.valek"
    clips, worst = OM.clips(who, geo, raw, spec)
    write_json(RP / "animations" / f"fb_{who}.animation.json", {"format_version": "1.8.0", "animations": clips})
    write_json(RP / "animation_controllers" / f"fb_{who}.animation_controllers.json", {"format_version": "1.10.0", "animation_controllers": OM.controller(who, spec)})
    write_json(RP / "entity" / f"fb_{who}.entity.json", owner_client_entity(who, spec, textures, rcs))
    return {"clips": len(clips), "worst": worst, "scale": OM.scale_for(geo, spec), "eye_height": OM.eye_height(geo, spec)}


def archive_old_character(name, tex, eyes, geo, spec):
    """The previous, skin-built Freddy / Bonnie: kept outside the packs (not in the game)."""
    out = ROOT / "art" / "models_archive" / f"{name}_v1"
    out.mkdir(parents=True, exist_ok=True)
    tex.save(out / f"{name}.png")
    eyes.save(out / f"{name}_eyes.png")
    write_json(out / f"fb_{name}.geo.json", geo)
    write_json(out / f"fb_{name}.entity.json", client_entity(
        f"fb:{name}", f"geometry.fb.{name}", f"textures/entity/fb/{name}", f"textures/entity/fb/{name}_eyes", spec["hide_prop_unless_perform"], name))
    model = {"freddy": "Freddy_V6_Blink_Coverage.zip", "bonnie": "Bonnie_V2_Proportions_Fixed_Eyes.zip"}[name]
    (out / "README.md").write_text(
        f"# {name.capitalize()} v1 (archived)\n\n"
        f"The skin-built {name.capitalize()} used up to version 1.2 of the map, built from `art/skins/` by `tools/gen_rp.py`.\n"
        f"It is **not in the game** any more: version 1.3 uses the map owner's model (`art/models_incoming/{model}`,\n"
        "imported by `tools/owner_models.py`). Its animations are the shared `animation.fb.*` clips that Chica still uses\n"
        "(`packs/FredbearRP/animations/fb_animatronic.animation.json`).\n\n"
        "To put it back, copy the geometry to `packs/FredbearRP/models/entity/`, the textures to `packs/FredbearRP/textures/entity/fb/`,\n"
        f"`fb_{name}.entity.json` to `packs/FredbearRP/entity/`, and restore `minecraft:scale` in `packs/FredbearBP/entities/{name}.json`\n"
        "and `SCALE` / `EYE_HEIGHT` in `scripts/mc/game.js` (1.35 / 1.3 and 1.55).\n", encoding="utf-8")


def archive_old_fredbear(tex, eyes, geo, spec):
    """The previous, skin-built Fredbear: kept outside the packs (not in the game), regenerated with the rest."""
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    tex.save(ARCHIVE / "fredbear.png")
    eyes.save(ARCHIVE / "fredbear_eyes.png")
    echo = echo_texture(tex)
    echo_eyes = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
    for (x, y), _ in spec["eyes"]:
        echo_eyes.putpixel((x, y), rgb("e070ff"))
    echo.save(ARCHIVE / "fredbear_echo.png")
    echo_eyes.save(ARCHIVE / "fredbear_echo_eyes.png")
    write_json(ARCHIVE / "fb_fredbear.geo.json", geo)
    old_anims = {"format_version": "1.8.0", "animations": {k: v for k, v in animations()["animations"].items()}}
    old_anims["animations"]["animation.fb.perform.fredbear"] = OLD_FREDBEAR_PERFORM
    write_json(ARCHIVE / "fb_fredbear_v1.animation.json", old_anims)
    write_json(ARCHIVE / "fb_fredbear.entity.json", client_entity(
        "fb:fredbear", "geometry.fb.fredbear", "textures/entity/fb/fredbear", "textures/entity/fb/fredbear_eyes", spec["hide_prop_unless_perform"], "fredbear"))
    (ARCHIVE / "README.md").write_text(
        "# Fredbear v1 (archived)\n\n"
        "The skin-built Fredbear model used up to version 1.1 of the map, built from `art/skins/fredbear_source.png` by\n"
        "`tools/gen_rp.py`. It is **not in the game** any more: version 1.2 uses the map owner's Fredbear V6 model\n"
        "(`art/models_incoming/Fredbear_V6_NoEyeDots_Complete.zip`, imported by `tools/fredbear_v6.py`).\n\n"
        "To put this model back, copy `fb_fredbear.geo.json` to `packs/FredbearRP/models/entity/`, the textures to\n"
        "`packs/FredbearRP/textures/entity/fb/`, `fb_fredbear.entity.json` to `packs/FredbearRP/entity/` and add\n"
        "`animation.fb.perform.fredbear` from `fb_fredbear_v1.animation.json` to the shared animation file; then set\n"
        "`minecraft:scale` back to 1.45 in `packs/FredbearBP/entities/fredbear*.json` and `SCALE.fredbear` in\n"
        "`scripts/mc/game.js`.\n", encoding="utf-8")


# --------------------------------------------------------------------------- items, icons, fogs, text
def item_icons():
    out = {}
    # Camera tablet: dark frame, green camera feed with a REC dot.
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([1, 3, 14, 12], fill=rgb("2a2a2e"))
    d.rectangle([2, 4, 12, 11], fill=rgb("0f3d1a"))
    for y in range(4, 12, 2):
        d.line([2, y, 12, y], fill=rgb("16592a"))
    d.point([11, 5], fill=rgb("ff2020"))
    d.rectangle([5, 7, 8, 9], fill=rgb("3fae5a"))
    d.point([13, 7], fill=rgb("8a8a8a"))
    out["fb_tablet"] = im
    # Office remote: black body, red/yellow/blue buttons.
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([5, 1, 10, 14], fill=rgb("1e1e22"))
    d.rectangle([6, 2, 9, 3], fill=rgb("5a5a60"))
    d.point([6, 5], fill=rgb("e02020"))
    d.point([9, 5], fill=rgb("e02020"))
    d.point([6, 8], fill=rgb("f0c020"))
    d.point([9, 8], fill=rgb("f0c020"))
    d.rectangle([7, 10, 8, 11], fill=rgb("3070e0"))
    out["fb_remote"] = im
    # Shift guide: brown booklet with a golden bear face.
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([2, 1, 13, 14], fill=rgb("5a3418"))
    d.line([3, 1, 3, 14], fill=rgb("3a200c"))
    d.rectangle([6, 5, 11, 10], fill=rgb("c8a000"))
    d.point([6, 4], fill=rgb("c8a000"))
    d.point([11, 4], fill=rgb("c8a000"))
    d.point([7, 7], fill=rgb("1a1a1a"))
    d.point([10, 7], fill=rgb("1a1a1a"))
    d.line([8, 9, 9, 9], fill=rgb("3c0496"))
    out["fb_guide"] = im
    return out


def face_icon(skin, scale):
    """Head front (base + hat layer) of a 64x64 skin, upscaled with nearest neighbour."""
    face = skin.crop((8, 8, 16, 16))
    hat = skin.crop((40, 8, 48, 16))
    face.alpha_composite(hat)
    return face.resize((8 * scale, 8 * scale), Image.NEAREST)


def pack_icons(skins):
    rp = Image.new("RGBA", (128, 128), rgb("0b0a10"))
    rp.alpha_composite(face_icon(skins["fredbear"], 13), (12, 12))
    bp = Image.new("RGBA", (128, 128), rgb("0b0a10"))
    for i, n in enumerate(["freddy", "bonnie", "chica", "fredbear"]):
        bp.alpha_composite(face_icon(skins[n], 7), (4 + (i % 2) * 64, 4 + (i // 2) * 64))
    return rp, bp


def fogs():
    out = {}
    for n in range(1, 10):
        start = round(max(1.0, 8 - n * 0.9), 1)
        end = 56 - min(n, 7) * 5 - (4 if n == 9 else 0)
        # night 8: cold blue-black; night 9: the darkest, a dried-blood red-black
        colour = "#06070c" if n < 4 else ("#07050c" if n < 6 else "#090410" if n == 6 else "#0b0608" if n == 7 else "#05070d" if n == 8 else "#0e0405")
        setting = {"fog_start": start, "fog_end": end, "fog_color": colour, "render_distance_type": "fixed"}
        out[n] = {"format_version": "1.21.90", "minecraft:fog_settings": {
            "description": {"identifier": f"fb:night_{n}"},
            "distance": {"air": dict(setting), "weather": dict(setting)},
        }}
    # Pushed on top of the night fog while the camera monitor is up: the feeds look into rooms 10-50 blocks
    # away, which the night fog would black out. Far, faint and slightly green, like a night-vision camera.
    feed = {"fog_start": 48, "fog_end": 160, "fog_color": "#16221a", "render_distance_type": "fixed"}
    out["camera_feed"] = {"format_version": "1.21.90", "minecraft:fog_settings": {
        "description": {"identifier": "fb:camera_feed"},
        "distance": {"air": dict(feed), "weather": dict(feed)},
    }}
    # Cutscenes: the night 4 flashback (warm sepia memory) and the burn ending (orange smoke).
    for key, ident, setting in (
        ("flashback", "fb:flashback", {"fog_start": 3, "fog_end": 36, "fog_color": "#5a3f1e", "render_distance_type": "fixed"}),
        ("ending_fire", "fb:ending_fire", {"fog_start": 6, "fog_end": 60, "fog_color": "#7a2c08", "render_distance_type": "fixed"}),
    ):
        out[key] = {"format_version": "1.21.90", "minecraft:fog_settings": {
            "description": {"identifier": ident},
            "distance": {"air": dict(setting), "weather": dict(setting)},
        }}
    return out


LANG = """## FREDBEAR: Six Nights Below
entity.fb:freddy.name=Freddy
entity.fb:bonnie.name=Bonnie
entity.fb:chica.name=Chica
entity.fb:fredbear.name=Fredbear
entity.fb:fredbear_echo.name=Fredbear (Echo)
entity.fb:morgrave.name=Morgrave
entity.fb:valek.name=Valek
item.fb:tablet=Camera Tablet
item.fb:remote=Office Remote
item.fb:guide=Shift Guide
"""


# --------------------------------------------------------------------------- main
def main():
    specs = character_specs()
    tex_dir = RP / "textures" / "entity" / "fb"
    tex_dir.mkdir(parents=True, exist_ok=True)
    skins = {}
    for name, spec in specs.items():
        tex, eyes, geo = build_character(name, spec)
        skins[name] = load_skin(spec["skin"])
        if name == "fredbear":
            archive_old_fredbear(tex, eyes, geo, spec)
            continue
        if name in ("freddy", "bonnie"):
            archive_old_character(name, tex, eyes, geo, spec)
            continue
        tex.save(tex_dir / f"{name}.png")
        eyes.save(tex_dir / f"{name}_eyes.png")
        OM.withered_texture(tex, geo, seed=f"withered-{name}").save(tex_dir / f"{name}_withered.png")
        write_json(RP / "models" / "entity" / f"fb_{name}.geo.json", geo)
        write_json(RP / "entity" / f"fb_{name}.entity.json", client_entity(
            f"fb:{name}", f"geometry.fb.{name}", f"textures/entity/fb/{name}", f"textures/entity/fb/{name}_eyes", spec["hide_prop_unless_perform"], name,
            withered=f"textures/entity/fb/{name}_withered"))
    owners = {who: build_owner_model(who, tex_dir) for who in OM.MODELS}
    write_json(ROOT / "tools" / "out" / "owner_models.json", owners)
    v6_clips, v6_err = build_fredbear_v6(tex_dir)
    write_json(RP / "animations" / "fb_animatronic.animation.json", animations())
    write_json(RP / "animation_controllers" / "fb_animatronic.animation_controllers.json", controller())
    write_json(RP / "render_controllers" / "fb_animatronic.render_controllers.json", render_controllers())
    item_dir = RP / "textures" / "items"
    item_dir.mkdir(parents=True, exist_ok=True)
    data = {}
    for key, im in item_icons().items():
        im.save(item_dir / f"{key}.png")
        data[key] = {"textures": f"textures/items/{key}"}
    write_json(RP / "textures" / "item_texture.json", {"resource_pack_name": "fredbear", "texture_name": "atlas.items", "texture_data": data})
    for n, f in fogs().items():
        write_json(RP / "fogs" / (f"fb_night_{n}.json" if isinstance(n, int) else f"fb_{n}.json"), f)
    (RP / "texts").mkdir(parents=True, exist_ok=True)
    (RP / "texts" / "en_US.lang").write_text(LANG, encoding="utf-8")
    write_json(RP / "texts" / "languages.json", ["en_US"])
    rp_icon, bp_icon = pack_icons(skins)
    rp_icon.save(RP / "pack_icon.png")
    bp_icon.save(BP / "pack_icon.png")
    owner_txt = ", ".join(f"{w} {o['clips']} clips" for w, o in owners.items())
    print(f"rp: Chica (skin-built), owner models ({owner_txt}), Fredbear V6 ({v6_clips} clips, max change {v6_err['rotation']:.2f} deg / {v6_err['position']:.3f} units) + echo/shadow, withered skins, {len(fogs())} fogs, 3 item icons")


if __name__ == "__main__":
    main()
