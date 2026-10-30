#!/usr/bin/env python3
"""Generates pack icons and item icons from the supplied model and texture.

  python3 -I tools/gen_icons.py

pack_icon.png (both packs): a three-quarter render of the integrated model in its
unfold pose.  Item icons (16x16): the spawn egg and the field guide, painted from the
creature texture's skull-face pixels.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import bedrock_model as bm  # noqa: E402
from render_preview import render  # noqa: E402

RP = os.path.join(ROOT, "packs", "TailwailRP")
BP = os.path.join(ROOT, "packs", "TailwailBP")


def pack_icon():
    geo = bm.Geometry(os.path.join(RP, "models/entity/tall_wail.geo.json"))
    anims = bm.load_animations(os.path.join(RP, "animations/tall_wail.animation.json"))
    anims.update(bm.load_animations(os.path.join(RP, "animations/tall_wail.rehearsal.animation.json")))
    tex = Image.open(os.path.join(RP, "textures/entity/tall_wail/tall_wail.png")).convert("RGBA")
    layers = [(anims["animation.tall_wail.reveal"], 1, 0), (anims["animation.tall_wail.tw_unfold_mid"], 1, 0),
              (anims["animation.tall_wail.tw_tail_rigid"], 1, 0)]
    pose = bm.pose_from(anims, layers, 2.0, {"q.life_time": 2.0})
    im = render(geo, tex, pose, "three", size=(512, 512), ppu=7.4, origin_y=490, guides=False).convert("RGB")
    a = np.asarray(im).astype(float)
    bg = (a[..., 0] == a[0, 0, 0]) & (a[..., 1] == a[0, 0, 1]) & (a[..., 2] == a[0, 0, 2])
    yy, xx = np.mgrid[0:512, 0:512]
    glow = np.clip(1 - np.hypot(xx - 256, yy - 230) / 330, 0, 1)
    base = np.stack([12 + 30 * glow, 10 + 22 * glow, 9 + 18 * glow], -1)
    a[bg] = base[bg]
    a[~bg] = np.clip(a[~bg] * 1.15, 0, 255)
    out = Image.fromarray(a.astype(np.uint8)).resize((256, 256), Image.LANCZOS)
    d = ImageDraw.Draw(out)
    d.rectangle([0, 0, 255, 255], outline=(60, 44, 34), width=4)
    for path in (os.path.join(RP, "pack_icon.png"), os.path.join(BP, "pack_icon.png")):
        out.save(path)


EGG = [
    "................",
    "......####......",
    ".....######.....",
    "....########....",
    "...##########...",
    "...##########...",
    "..############..",
    "..############..",
    "..############..",
    "..############..",
    "..############..",
    "...##########...",
    "...##########...",
    "....########....",
    ".....######.....",
    "................",
]


def spawn_egg():
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(EGG):
        for x, c in enumerate(row):
            if c == "#":
                shade = 34 + (x - 3) * 2 - (y - 2) * 2
                px[x, y] = (shade + 10, shade, shade - 6, 255)
    # bone-white skull mask with dark eye sockets and a hanging jaw
    skull = {(6, 5), (7, 5), (8, 5), (9, 5), (5, 6), (6, 6), (7, 6), (8, 6), (9, 6), (10, 6),
             (5, 7), (7, 7), (8, 7), (10, 7), (6, 8), (7, 8), (8, 8), (9, 8), (7, 9), (8, 9),
             (6, 10), (7, 11), (8, 11), (9, 10)}
    for (x, y) in skull:
        px[x, y] = (214, 203, 176, 255)
    for (x, y) in [(6, 7), (9, 7)]:
        px[x, y] = (12, 8, 6, 255)
    for (x, y) in [(3, 12), (4, 13), (11, 4), (12, 9)]:
        px[x, y] = (20, 16, 14, 255)  # mane flecks
    im.save(os.path.join(RP, "textures/items/tailwail_spawn_egg.png"))


def field_guide():
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([3, 1, 13, 14], fill=(58, 40, 28, 255))  # cover
    d.rectangle([3, 1, 4, 14], fill=(36, 24, 17, 255))  # spine
    d.rectangle([12, 2, 13, 13], fill=(210, 200, 178, 255))  # page edges
    for y in (4, 7, 10):
        d.point((13, y), fill=(160, 150, 128, 255))
    px = im.load()
    for (x, y) in [(7, 5), (8, 5), (9, 5), (6, 6), (7, 6), (8, 6), (9, 6), (10, 6), (6, 7), (8, 7), (10, 7),
                   (7, 8), (8, 8), (9, 8), (7, 10), (9, 10), (8, 11)]:
        px[x, y] = (214, 203, 176, 255)
    for (x, y) in [(7, 7), (9, 7)]:
        px[x, y] = (10, 6, 4, 255)
    d.line([(5, 12), (8, 13), (11, 12)], fill=(120, 20, 18, 255))  # a scratched mark
    im.save(os.path.join(RP, "textures/items/tailwail_field_guide.png"))


if __name__ == "__main__":
    os.makedirs(os.path.join(RP, "textures/items"), exist_ok=True)
    pack_icon()
    spawn_egg()
    field_guide()
    print("icons written")
