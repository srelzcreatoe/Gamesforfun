#!/usr/bin/env python3
"""Draw an .mcstructure as a picture (a quick look at a piece without the game): an isometric view, flat colours per
block, optionally cut away above a height or along a plane to show what is inside.

Usage: python3 tools/preview_structure.py FILE.mcstructure OUT.png [--cut-y N] [--cut-z N] [--rot 0..3] [--scale 4]
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nbt_le as N  # noqa: E402

COLORS = [
    ("cracked_veinstone", (70, 40, 44)), ("veinstone", (84, 46, 50)), ("pulsing_flesh", (190, 40, 52)), ("fleshstone", (150, 74, 76)),
    ("ribstone", (214, 204, 182)), ("organ_core", (120, 10, 24)), ("bloodmoss", (110, 18, 22)), ("bloodroot", (90, 12, 18)),
    ("dripfang", (226, 220, 200)), ("watcher_pod", (240, 200, 60)), ("glowspore", (150, 230, 120)), ("crimson_thorns", (130, 20, 30)),
    ("rail", (150, 130, 100)), ("tinted_glass", (40, 30, 50)),
    ("white_concrete", (225, 225, 225)), ("red_concrete", (150, 25, 25)), ("black_concrete", (14, 14, 18)), ("white_wool", (220, 220, 215)),
    ("gray_wool", (90, 90, 95)), ("brown_wool", (110, 75, 45)), ("calcite", (215, 215, 210)), ("amethyst", (150, 100, 210)),
    ("obsidian", (25, 15, 40)), ("end_rod", (250, 245, 230)), ("stellar", (40, 36, 60)), ("spruce", (100, 74, 44)),
    ("crafting", (140, 100, 60)), ("hay", (190, 160, 50)), ("bell", (220, 180, 50)),
    ("water", (40, 60, 110)), ("blood", (120, 10, 16)), ("redstone_wire", (110, 10, 10)), ("rift_lamp", (230, 30, 40)),
    ("rift_glass", (150, 20, 40)), ("bleeding", (170, 30, 40)), ("void_crystal", (160, 90, 230)), ("rift_needles", (40, 52, 42)),
    ("rift_bark", (72, 70, 68)), ("void_log", (40, 30, 60)), ("void_leaves", (60, 40, 90)), ("weeping_log", (60, 52, 44)),
    ("weeping_leaves", (70, 80, 60)), ("tendril", (90, 100, 80)), ("hanging_moss", (80, 70, 110)), ("rift_moss", (36, 44, 34)),
    ("mire_moss", (58, 72, 52)), ("ashen_podzol", (70, 64, 60)), ("podzol", (90, 66, 40)), ("coarse_dirt", (100, 76, 54)),
    ("mud", (58, 50, 48)), ("dirt", (110, 80, 56)), ("gravel", (120, 116, 112)), ("bedrock", (30, 30, 30)), ("tuff", (100, 102, 96)),
    ("cobblestone", (110, 110, 110)), ("rift_stone", (64, 58, 80)), ("stone_brick", (122, 122, 122)), ("rift_bricks", (66, 60, 64)),
    ("deepslate", (60, 60, 66)), ("blackstone", (44, 38, 44)), ("stone", (128, 128, 128)), ("dark_oak", (66, 44, 24)),
    ("corpse", (150, 140, 120)), ("hanged", (150, 130, 110)), ("skeleton", (230, 225, 205)), ("bone", (220, 215, 195)),
    ("skull", (220, 215, 195)), ("gravestone", (130, 130, 136)), ("fern", (60, 110, 50)), ("grass", (80, 120, 60)),
    ("bone_grass", (190, 190, 170)), ("eyebloom", (200, 40, 40)), ("mooncap", (150, 150, 220)), ("deadbush", (120, 90, 50)),
    ("candle", (240, 200, 120)), ("lantern", (120, 200, 230)), ("soul", (90, 200, 220)), ("campfire", (90, 200, 220)),
    ("gold", (240, 200, 40)), ("diamond", (90, 230, 220)), ("netherite", (60, 50, 50)), ("iron_bars", (160, 160, 165)),
    ("iron_chain", (140, 140, 150)), ("chest", (160, 110, 40)), ("barrel", (130, 90, 50)), ("lectern", (140, 100, 60)),
    ("bookshelf", (120, 80, 50)), ("red_", (150, 20, 24)), ("black_", (20, 20, 22)), ("crying", (80, 20, 120)), ("web", (230, 230, 230)),
    ("ladder", (150, 110, 60)), ("hay", (200, 170, 50)), ("anvil", (70, 70, 74)), ("cauldron", (200, 80, 20)), ("bell", (230, 190, 60)),
    ("trophy", (170, 150, 130)), ("cloth", (110, 90, 70)), ("ritual", (110, 20, 30)), ("rift_fern", (70, 60, 100)),
    ("stellar_grass", (90, 80, 140)), ("shrub", (150, 30, 40)), ("ash", (90, 85, 85)), ("moss", (60, 100, 50)),
]
SKIP = {"minecraft:air", "minecraft:structure_void", "minecraft:barrier"}


def color(name):
    for key, c in COLORS:
        if key in name:
            return c
    return (200, 0, 200)


def load(path):
    raw = N.read(open(path, "rb").read())
    root = N.plain(raw[1]) if isinstance(raw, tuple) and len(raw) == 2 and isinstance(raw[0], str) else N.plain(raw)
    sx, sy, sz = root["size"]
    st = root["structure"]
    idx = st["block_indices"][0]
    pal = st["palette"]["default"]["block_palette"]
    names = [p["name"] for p in pal]
    return (sx, sy, sz), idx, names


def render(path, out, cut_y=None, cut_z=None, rot=0, scale=4):
    (sx, sy, sz), idx, names = load(path)
    cells = {}
    for x in range(sx):
        for y in range(sy):
            for z in range(sz):
                n = names[idx[(x * sy + y) * sz + z]]
                if n in SKIP:
                    continue
                if cut_y is not None and y > cut_y:
                    continue
                if cut_z is not None and z > cut_z:
                    continue
                X, Z = x, z
                for _ in range(rot):
                    X, Z = sz - 1 - Z, X
                cells[(X, y, Z)] = n
    s = scale
    W = (sx + sz) * s * 2 + 40
    H = (sx + sz) * s + sy * s * 2 + 40
    img = Image.new("RGB", (W, H), (14, 12, 18))
    d = ImageDraw.Draw(img)
    ox, oy = (sz) * s * 2 + 20, sy * s * 2 + 20

    def iso(x, y, z):
        return (ox + (x - z) * s * 2, oy + (x + z) * s - y * s * 2)

    for (x, y, z) in sorted(cells, key=lambda c: (c[0] + c[2], c[1], c[0])):
        n = cells[(x, y, z)]
        c = color(n)
        # only faces that can be seen
        top = (x, y + 1, z) not in cells
        left = (x, y, z + 1) not in cells
        right = (x + 1, y, z) not in cells
        if not (top or left or right):
            continue
        p = lambda a, b, cc: iso(x + a, y + b, z + cc)
        if top:
            d.polygon([p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1)], fill=c)
        if left:
            d.polygon([p(0, 1, 1), p(1, 1, 1), p(1, 0, 1), p(0, 0, 1)], fill=tuple(int(v * 0.72) for v in c))
        if right:
            d.polygon([p(1, 1, 0), p(1, 1, 1), p(1, 0, 1), p(1, 0, 0)], fill=tuple(int(v * 0.55) for v in c))
    img.save(out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("out")
    ap.add_argument("--cut-y", type=int)
    ap.add_argument("--cut-z", type=int)
    ap.add_argument("--rot", type=int, default=0)
    ap.add_argument("--scale", type=int, default=4)
    a = ap.parse_args()
    print(render(a.file, a.out, a.cut_y, a.cut_z, a.rot, a.scale))


if __name__ == "__main__":
    main()
