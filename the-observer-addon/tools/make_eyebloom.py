#!/usr/bin/env python3
"""The Mire Eyebloom (1.5.1): a plant three blocks tall with an eye for a flower, drawn and built here.

Writes (all original, drawn pixel by pixel with its own seeded generator):
  RP textures/blocks/wmire/eyebloom_stalk.png   the stalk (a cross plant: a black-green stem, drooping leaves with red veins)
  RP textures/blocks/wmire/eyebloom_petals.png  a halo of dark petals with crimson tips behind the eye
  RP textures/blocks/wmire/eyebloom_white.png   the eyeball: off-white, shaded, red veins
  RP textures/blocks/wmire/eyebloom_eye.png     its eye, a flipbook strip of 8 frames (16x128): looking ahead, left,
                                                right, up, half shut, shut, down, and the pupil wide
  RP textures/blocks/wmire/eyebloom_shut.png    the lid, shut tight (when you stare at it)
  BP structures/wmire/eyebloom.mcstructure      stalk, stalk, flower: what the Mire's worldgen places

Usage: python3 tools/make_eyebloom.py
"""
import os
import random
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nbt_le as N  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "packs", "TheObserver_RP")
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
rng = random.Random(1510)

CLEAR = (0, 0, 0, 0)
STEM = [(24, 30, 26, 255), (32, 40, 34, 255), (18, 22, 20, 255)]
LEAF = [(30, 36, 31, 255), (38, 46, 39, 255), (22, 27, 23, 255)]
VEIN = (96, 14, 20, 255)
PETAL = [(20, 18, 21, 255), (28, 24, 28, 255), (14, 12, 15, 255)]
TIP = [(78, 8, 16, 255), (104, 12, 22, 255)]
SCLERA = (222, 214, 198, 255)
SCLERA_DARK = (176, 164, 148, 255)
VEINS = [(150, 30, 32, 255), (120, 18, 24, 255)]
IRIS = [(120, 6, 14, 255), (176, 20, 28, 255), (210, 40, 40, 255)]
PUPIL = (6, 4, 6, 255)
LID = [(52, 34, 32, 255), (66, 42, 38, 255), (40, 26, 26, 255)]
SEAM = (20, 10, 10, 255)


def save(img, *parts):
    path = os.path.join(*parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    return path


def stalk():
    img = Image.new("RGBA", (16, 16), CLEAR)
    px = img.load()
    for y in range(16):
        for x in (7, 8):
            px[x, y] = STEM[0] if x == 7 else STEM[1]
        if rng.random() < 0.25:
            px[rng.choice((7, 8)), y] = STEM[2]
    # drooping leaves: out from the stem, then down
    for (y0, side, length) in ((3, -1, 6), (8, 1, 6), (12, -1, 5), (5, 1, 4)):
        x, y = (6 if side < 0 else 9), y0
        for i in range(length):
            if 0 <= x < 16 and 0 <= y < 16:
                px[x, y] = LEAF[i % 3]
                if i in (1, 2) and 0 <= y + 1 < 16:
                    px[x, y + 1] = LEAF[2]
            x += side
            if i >= 2:
                y += 1
        # a red vein along the leaf
        vx, vy = (6 if side < 0 else 9), y0
        for i in range(min(3, length)):
            if 0 <= vx < 16:
                px[vx, vy] = VEIN
            vx += side
    return save(img, RP, "textures", "blocks", "wmire", "eyebloom_stalk.png")


def petals():
    img = Image.new("RGBA", (16, 16), CLEAR)
    px = img.load()
    cx = cy = 7.5
    import math
    for y in range(16):
        for x in range(16):
            dx, dy = x - cx, y - cy
            r = math.hypot(dx, dy)
            a = math.atan2(dy, dx)
            # eight petals: the radius they reach waves with the angle
            reach = 5.5 + 2.5 * abs(math.cos(4 * a))
            if 2.0 < r <= reach:
                c = PETAL[(x * 3 + y) % 3]
                if r > reach - 1.3:
                    c = TIP[(x + y) % 2]
                px[x, y] = c
    return save(img, RP, "textures", "blocks", "wmire", "eyebloom_petals.png")


def sclera(px, ox=0, oy=0):
    for y in range(16):
        for x in range(16):
            edge = min(x, y, 15 - x, 15 - y)
            px[ox + x, oy + y] = SCLERA_DARK if edge < 2 else SCLERA
    r = random.Random(77)
    for _ in range(5):
        x, y = r.choice([(0, r.randint(2, 13)), (15, r.randint(2, 13)), (r.randint(2, 13), 0), (r.randint(2, 13), 15)])
        for _ in range(r.randint(3, 6)):
            px[ox + x, oy + y] = VEINS[r.randint(0, 1)]
            x = max(0, min(15, x + r.choice((-1, 0, 1)) + (1 if x < 8 else -1)))
            y = max(0, min(15, y + r.choice((-1, 0, 1)) + (1 if y < 8 else -1)))


def white():
    img = Image.new("RGBA", (16, 16), CLEAR)
    sclera(img.load())
    return save(img, RP, "textures", "blocks", "wmire", "eyebloom_white.png")


def iris(px, ox, oy, cx, cy, pupil=1):
    for y in range(16):
        for x in range(16):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= 3.6:
                px[ox + x, oy + y] = IRIS[0] if d > 2.9 else IRIS[1] if d > 1.8 else IRIS[2]
            if d <= pupil + 0.3:
                px[ox + x, oy + y] = PUPIL
    # a glint
    gx, gy = int(cx + 1), int(cy - 2)
    if 0 <= gx < 16 and 0 <= gy < 16:
        px[ox + gx, oy + gy] = (250, 240, 230, 255)


def lid(px, ox, oy, rows):
    for y in range(rows):
        for x in range(16):
            px[ox + x, oy + y] = LID[(x + y * 2) % 3]
    if rows < 16:
        for x in range(16):
            px[ox + x, oy + rows] = SEAM


def eye():
    img = Image.new("RGBA", (16, 16 * 8), CLEAR)
    px = img.load()
    frames = [(7.5, 7.5, 1), (5.0, 7.5, 1), (10.0, 7.5, 1), (7.5, 5.5, 1), (7.5, 7.5, 1), None, (7.0, 9.5, 1), (7.5, 7.5, 2)]
    for i, f in enumerate(frames):
        oy = i * 16
        sclera(px, 0, oy)
        if f:
            iris(px, 0, oy, *f)
        if i == 4:
            lid(px, 0, oy, 8)  # half shut
        if i == 5:
            lid(px, 0, oy, 16)  # shut
            for x in range(2, 14):
                px[x, oy + 8] = SEAM
    return save(img, RP, "textures", "blocks", "wmire", "eyebloom_eye.png")


def shut():
    img = Image.new("RGBA", (16, 16), CLEAR)
    px = img.load()
    lid(px, 0, 0, 16)
    for x in range(1, 15):
        px[x, 8] = SEAM
        if x % 3 == 0:
            px[x, 9] = (110, 14, 18, 255)  # it weeps
    px[7, 10] = px[8, 11] = (140, 16, 22, 255)
    return save(img, RP, "textures", "blocks", "wmire", "eyebloom_shut.png")


def structure():
    """A 1x3x1 template: stalk, stalk, flower (facing north; the feature turns it at random)."""
    states_stalk = {}
    states_head = {"minecraft:cardinal_direction": (N.STRING, "north"), "wmire:shut": (N.BYTE, 0)}
    palette = [
        {"name": (N.STRING, "wmire:eyebloom_stalk"), "states": (N.COMPOUND, states_stalk), "version": (N.INT, 18184192)},
        {"name": (N.STRING, "wmire:eyebloom"), "states": (N.COMPOUND, states_head), "version": (N.INT, 18184192)},
    ]
    blocks = [0, 0, 1]  # index = (x*Y + y)*Z + z with X = Z = 1
    root = {
        "format_version": (N.INT, 1),
        "size": (N.LIST, (N.INT, [1, 3, 1])),
        "structure": (N.COMPOUND, {
            "block_indices": (N.LIST, (N.LIST, [(N.INT, blocks), (N.INT, [-1, -1, -1])])),
            "entities": (N.LIST, (N.COMPOUND, [])),
            "palette": (N.COMPOUND, {"default": (N.COMPOUND, {
                "block_palette": (N.LIST, (N.COMPOUND, palette)),
                "block_position_data": (N.COMPOUND, {}),
            })}),
        }),
        "structure_world_origin": (N.LIST, (N.INT, [0, 0, 0])),
    }
    path = os.path.join(BP, "structures", "wmire", "eyebloom.mcstructure")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(N.write("", (N.COMPOUND, root)))
    # read it back: the same tree
    assert N.read(open(path, "rb").read())[1] == (N.COMPOUND, root)
    return path


def main():
    for p in (stalk(), petals(), white(), eye(), shut(), structure()):
        print(os.path.relpath(p, ROOT))


if __name__ == "__main__":
    main()
