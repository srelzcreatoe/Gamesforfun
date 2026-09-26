#!/usr/bin/env python3
"""Render the Cubic World texture atlas from data-driven tile recipes.

Reads assets/data/tiles.json, item_tiles.json, creature_tiles.json and renders
every 16x16 tile procedurally (all art is original and generated here), then
packs them into assets/textures/atlas.png + atlas.json.
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "assets", "data")
OUT = os.path.join(ROOT, "assets", "textures")
T = 16  # tile size


class Rng:
    """Tiny deterministic PRNG so tiles look identical on every build."""

    def __init__(self, seed):
        self.s = (seed * 2654435761 + 1013904223) & 0xFFFFFFFF

    def next(self):
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.s

    def f(self):
        return self.next() / 0xFFFFFFFF

    def pick(self, seq):
        return seq[self.next() % len(seq)]


def clamp(v):
    return max(0, min(255, int(v)))


def shade(c, f):
    return tuple(clamp(x * f) for x in c[:3])


def mix(a, b, t):
    return tuple(clamp(a[i] + (b[i] - a[i]) * t) for i in range(3))


def base_noise(img, rng, base, accent, strength=0.5):
    px = img.load()
    for y in range(T):
        for x in range(T):
            t = rng.f() * strength
            px[x, y] = mix(base, accent, t) + (255,)


# ---- pattern renderers ------------------------------------------------------

def p_flat(d, rng, base, accent, accent2):
    d.img.paste(base + (255,), (0, 0, T, T))
    base_noise(d.img, rng, base, shade(base, 1.06), 0.35)


def p_speckle(d, rng, base, accent, accent2):
    base_noise(d.img, rng, base, shade(base, 0.92), 0.5)
    px = d.img.load()
    for _ in range(26):
        x, y = rng.next() % T, rng.next() % T
        px[x, y] = (accent + (255,))
        if rng.f() > 0.5 and x < T - 1:
            px[x + 1, y] = mix(accent, base, 0.4) + (255,)


def p_noise(d, rng, base, accent, accent2):
    base_noise(d.img, rng, base, accent, 0.75)
    px = d.img.load()
    for _ in range(10):
        x, y = rng.next() % T, rng.next() % T
        c = accent2 if accent2 and rng.f() > 0.5 else shade(base, 0.8)
        px[x, y] = tuple(c) + (255,)


def p_grain_v(d, rng, base, accent, accent2):
    px = d.img.load()
    for x in range(T):
        stripe = mix(base, accent, (rng.f() * 0.6) if x % 3 else 0.55)
        for y in range(T):
            j = mix(stripe, shade(stripe, 0.9), rng.f() * 0.4)
            px[x, y] = j + (255,)


def p_grain_h(d, rng, base, accent, accent2):
    px = d.img.load()
    for y in range(T):
        stripe = mix(base, accent, (rng.f() * 0.6) if y % 3 else 0.55)
        for x in range(T):
            j = mix(stripe, shade(stripe, 0.9), rng.f() * 0.4)
            px[x, y] = j + (255,)


def p_planks(d, rng, base, accent, accent2):
    p_grain_h(d, rng, base, accent, accent2)
    px = d.img.load()
    dark = shade(base, 0.55)
    for y in (3, 7, 11, 15):
        for x in range(T):
            px[x, y] = dark + (255,)
    for y0, xoff in ((0, 5), (4, 11), (8, 3), (12, 9)):
        for y in range(y0, min(y0 + 4, T)):
            px[xoff, y] = dark + (255,)


def p_brick(d, rng, base, accent, accent2):
    mortar = accent2 or shade(base, 0.6)
    px = d.img.load()
    for y in range(T):
        for x in range(T):
            row = y // 4
            joint_y = (y % 4 == 3)
            xo = (x + (row % 2) * 4) % 8
            joint_x = (xo == 7)
            if joint_y or joint_x:
                px[x, y] = tuple(mortar) + (255,)
            else:
                px[x, y] = mix(base, accent, rng.f() * 0.35) + (255,)


def p_crystal(d, rng, base, accent, accent2):
    base_noise(d.img, rng, shade(base, 0.85), base, 0.5)
    dr = ImageDraw.Draw(d.img)
    for _ in range(4):
        cx, cy = rng.next() % T, rng.next() % T
        r = 2 + rng.next() % 3
        dr.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=accent + (255,))
        dr.line([(cx, cy - r), (cx, cy + r)], fill=(accent2 or shade(accent, 1.25)) + (255,))


def p_leaf(d, rng, base, accent, accent2):
    px = d.img.load()
    for y in range(T):
        for x in range(T):
            r = rng.f()
            if r < 0.12:
                px[x, y] = (0, 0, 0, 0)          # holes for depth in the cutout pass
            elif r < 0.5:
                px[x, y] = shade(base, 0.85) + (255,)
            elif r < 0.9:
                px[x, y] = base + (255,)
            else:
                px[x, y] = accent + (255,)


def p_cross_plant(d, rng, base, accent, accent2):
    px = d.img.load()
    for y in range(T):
        for x in range(T):
            px[x, y] = (0, 0, 0, 0)
    # a few stems with leaf tips
    for s in range(3):
        sx = 3 + (rng.next() % 10)
        h = 6 + rng.next() % 8
        for i in range(h):
            y = T - 1 - i
            x = sx + (1 if (i > 3 and rng.f() > 0.7) else 0)
            if 0 <= x < T:
                px[x, y] = mix(base, shade(base, 0.85), rng.f() * 0.4) + (255,)
        tipc = accent if s % 2 == 0 else (accent2 or accent)
        px[min(T - 1, sx), max(0, T - 1 - h)] = tuple(tipc) + (255,)
        if sx + 1 < T:
            px[sx + 1, max(0, T - h)] = mix(tipc, base, 0.4) + (255,)


def p_liquid(d, rng, base, accent, accent2):
    px = d.img.load()
    for y in range(T):
        for x in range(T):
            w = math.sin((x + y * 0.6) * 0.8) * 0.5 + rng.f() * 0.3
            px[x, y] = mix(base, accent, max(0, w)) + (235,)


def p_ore(d, rng, base, accent, accent2):
    stone = accent2 or (120, 120, 125)
    base_noise(d.img, rng, stone, shade(stone, 0.9), 0.5)
    px = d.img.load()
    for _ in range(4):
        cx, cy = 2 + rng.next() % 12, 2 + rng.next() % 12
        for dy in range(-1, 2):
            for dx in range(-1, 2):
                if abs(dx) + abs(dy) <= 1 or rng.f() > 0.6:
                    x, y = cx + dx, cy + dy
                    if 0 <= x < T and 0 <= y < T:
                        c = accent if (dx == 0 and dy == 0) else base
                        px[x, y] = tuple(c) + (255,)


def p_glass(d, rng, base, accent, accent2):
    px = d.img.load()
    for y in range(T):
        for x in range(T):
            edge = x == 0 or y == 0 or x == T - 1 or y == T - 1
            if edge:
                px[x, y] = base + (255,)
            elif (x + y) % 7 == 0 and x > 2:
                px[x, y] = accent + (140,)
            else:
                px[x, y] = base + (60,)


def p_crop(d, rng, base, accent, accent2):
    p_cross_plant(d, rng, base, accent, accent2)
    px = d.img.load()
    # fruit dots
    for _ in range(4):
        x, y = rng.next() % T, 4 + rng.next() % 10
        if px[x, y][3] > 0:
            px[x, y] = (accent2 or accent) + (255,)


def p_ring(d, rng, base, accent, accent2):
    px = d.img.load()
    cx = cy = T / 2 - 0.5
    for y in range(T):
        for x in range(T):
            r = math.hypot(x - cx, y - cy)
            band = int(r * 1.6) % 2
            c = base if band else accent
            px[x, y] = mix(c, shade(c, 0.9), rng.f() * 0.3) + (255,)


def p_sand(d, rng, base, accent, accent2):
    base_noise(d.img, rng, base, accent, 0.45)
    px = d.img.load()
    for _ in range(12):
        x, y = rng.next() % T, rng.next() % T
        px[x, y] = shade(base, 1.15) + (255,)


def p_gravel(d, rng, base, accent, accent2):
    px = d.img.load()
    for y in range(T):
        for x in range(T):
            px[x, y] = shade(base, 0.8 + rng.f() * 0.4) + (255,)
    for _ in range(9):
        x, y = rng.next() % (T - 2), rng.next() % (T - 2)
        c = accent if rng.f() > 0.5 else shade(base, 0.6)
        for dy in range(2):
            for dx in range(2):
                px[x + dx, y + dy] = tuple(c) + (255,)


def p_glow(d, rng, base, accent, accent2):
    px = d.img.load()
    cx = cy = T / 2 - 0.5
    for y in range(T):
        for x in range(T):
            r = math.hypot(x - cx, y - cy) / (T * 0.7)
            alpha = clamp(255 * (1.35 - r * 1.8))
            px[x, y] = mix(accent, base, min(1, r + rng.f() * 0.15)) + (alpha,)


def p_crack(d, rng, base, accent, accent2):
    """Break-progress overlay: dark crack lines radiating from the centre.
    Line count comes from accent2[0] so four stages share one renderer."""
    px = d.img.load()
    for y in range(T):
        for x in range(T):
            px[x, y] = (0, 0, 0, 0)
    lines = accent2[0] if accent2 else 6
    for _ in range(lines):
        x, y = T // 2 + rng.next() % 5 - 2, T // 2 + rng.next() % 5 - 2
        dx = 1 if rng.f() > 0.5 else -1
        dy = 1 if rng.f() > 0.5 else -1
        steps = 4 + rng.next() % 9
        for s in range(steps):
            if 0 <= x < T and 0 <= y < T:
                px[x, y] = (20, 16, 12, 200)
            if rng.f() > 0.5:
                x += dx
            else:
                y += dy


PATTERNS = {
    "flat": p_flat, "speckle": p_speckle, "noise": p_noise, "grain_v": p_grain_v,
    "grain_h": p_grain_h, "planks": p_planks, "brick": p_brick, "crystal": p_crystal,
    "leaf": p_leaf, "cross_plant": p_cross_plant, "liquid": p_liquid, "ore": p_ore,
    "glass": p_glass, "crop": p_crop, "ring": p_ring, "sand": p_sand,
    "gravel": p_gravel, "glow": p_glow, "crack": p_crack,
}


class TileCtx:
    def __init__(self):
        self.img = Image.new("RGBA", (T, T), (0, 0, 0, 0))


def render_tile(recipe):
    ctx = TileCtx()
    pattern = recipe.get("pattern", "noise")
    if pattern not in PATTERNS:
        print(f"WARNING: unknown pattern '{pattern}' for {recipe['name']}, using noise")
        pattern = "noise"
    rng = Rng(recipe.get("seed", 1) + sum(ord(c) for c in recipe["name"]))
    base = tuple(recipe.get("base", [128, 128, 128]))
    accent = tuple(recipe.get("accent", shade(base, 1.15)))
    accent2 = tuple(recipe["accent2"]) if recipe.get("accent2") else None
    PATTERNS[pattern](ctx, rng, base, accent, accent2)
    return ctx.img


# ---- engine-required extra tiles (not content-driven) -----------------------

EXTRA_TILES = [
    {"name": "white", "pattern": "flat", "base": [255, 255, 255], "seed": 1},
    {"name": "sun_disc", "pattern": "glow", "base": [255, 210, 120], "accent": [255, 250, 220], "seed": 2},
    {"name": "moon_disc", "pattern": "glow", "base": [170, 180, 210], "accent": [235, 240, 255], "seed": 3},
    {"name": "rain_drop", "pattern": "liquid", "base": [90, 130, 200], "accent": [160, 200, 240], "seed": 4},
    {"name": "snow_flake", "pattern": "speckle", "base": [235, 240, 250], "accent": [255, 255, 255], "seed": 5},
    {"name": "satchel", "pattern": "gravel", "base": [140, 100, 60], "accent": [180, 140, 90], "seed": 6},
    # original wanderer player palette: teal tunic, warm skin, slate trousers
    {"name": "player_body", "pattern": "speckle", "base": [46, 130, 128], "accent": [66, 160, 152], "seed": 7},
    {"name": "player_head", "pattern": "flat", "base": [214, 172, 138], "accent": [222, 184, 150], "seed": 8},
    {"name": "player_legs", "pattern": "grain_v", "base": [70, 78, 96], "accent": [88, 98, 118], "seed": 9},
    {"name": "crack_0", "pattern": "crack", "base": [0, 0, 0], "accent2": [4, 0, 0], "seed": 21},
    {"name": "crack_1", "pattern": "crack", "base": [0, 0, 0], "accent2": [9, 0, 0], "seed": 22},
    {"name": "crack_2", "pattern": "crack", "base": [0, 0, 0], "accent2": [16, 0, 0], "seed": 23},
    {"name": "crack_3", "pattern": "crack", "base": [0, 0, 0], "accent2": [26, 0, 0], "seed": 24},
]


def main():
    tiles = []
    seen = set()
    for fname in ("tiles.json", "item_tiles.json", "creature_tiles.json"):
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            continue
        for t in json.load(open(path))["tiles"]:
            if t["name"] in seen:
                print(f"WARNING: duplicate tile {t['name']} in {fname}, keeping first")
                continue
            seen.add(t["name"])
            tiles.append(t)
    for t in EXTRA_TILES:
        if t["name"] not in seen:
            seen.add(t["name"])
            tiles.append(t)

    cols = 16
    rows = (len(tiles) + cols - 1) // cols
    pot_rows = 1
    while pot_rows < rows:
        pot_rows *= 2
    atlas = Image.new("RGBA", (cols * T, pot_rows * T), (0, 0, 0, 0))
    index = {}
    for i, t in enumerate(tiles):
        img = render_tile(t)
        atlas.paste(img, ((i % cols) * T, (i // cols) * T))
        index[t["name"]] = i

    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, "atlas.png"))
    json.dump(
        {"tileSize": T, "cols": cols, "rows": pot_rows, "tiles": index},
        open(os.path.join(OUT, "atlas.json"), "w"), indent=1,
    )
    print(f"atlas: {len(tiles)} tiles, {cols}x{pot_rows} grid -> textures/atlas.png")


if __name__ == "__main__":
    main()
