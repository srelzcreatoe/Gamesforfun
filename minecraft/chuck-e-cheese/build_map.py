#!/usr/bin/env python3
"""Build the Chuck E. Cheese fan map for Minecraft Bedrock Edition.

Everything is generated from code: the building is modelled as a voxel grid,
then written out as .mcstructure files inside a behavior pack together with a
`/function chuckecheese` command that places it next to the player.

Output (next to this script):
  ChuckECheese.mcpack    the add-on to import into Minecraft Bedrock
  preview_outside.png    isometric view from the parking lot
  preview_inside.png     same view with the roof and upper walls cut away
  preview_floorplan.png  top-down floor plan

Block names use the Minecraft 1.18 ids/states together with the 1.18 block
version number; Bedrock upgrades them on load (wool -> red_wool and so on), so
the same file works on old and current versions of the game.
"""
import io
import json
import math
import os
import random
import struct
import zipfile

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# palette
# ---------------------------------------------------------------------------

V118 = 17959425   # block version 1.18.10.1: legacy ids, upgraded by the game
V119 = 18035201   # block version 1.19.50.1: needed for froglights

COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
          "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"]
BEDROCK_COLOR = {c: ("silver" if c == "light_gray" else c) for c in COLORS}

CONCRETE_RGB = {
    "white": (207, 213, 214), "orange": (224, 97, 1), "magenta": (169, 48, 159),
    "light_blue": (36, 137, 199), "yellow": (241, 175, 21), "lime": (94, 169, 25),
    "pink": (214, 101, 143), "gray": (55, 58, 62), "light_gray": (125, 125, 115),
    "cyan": (21, 119, 136), "purple": (100, 32, 156), "blue": (45, 47, 143),
    "brown": (96, 60, 32), "green": (73, 91, 36), "red": (142, 33, 33), "black": (8, 10, 15),
}
WOOL_RGB = {
    "white": (234, 236, 237), "orange": (241, 118, 20), "magenta": (189, 68, 179),
    "light_blue": (58, 175, 217), "yellow": (248, 198, 40), "lime": (112, 185, 26),
    "pink": (238, 141, 172), "gray": (63, 68, 72), "light_gray": (142, 142, 135),
    "cyan": (21, 138, 145), "purple": (122, 42, 172), "blue": (53, 57, 157),
    "brown": (114, 72, 41), "green": (85, 110, 28), "red": (161, 39, 35), "black": (21, 21, 26),
}

# key -> (bedrock name, states, version, preview rgb, preview shape)
# preview shape: "cube" | "flat" (carpet/slab-ish, drawn low) | "thin" (panes, rods)
PALETTE = {}


def reg(key, name, states=None, rgb=(255, 0, 255), shape="cube", version=V118):
    PALETTE[key] = (name, states or {}, version, rgb, shape)


reg("air", "minecraft:air", rgb=None)
for _c in COLORS:
    bc = BEDROCK_COLOR[_c]
    reg(f"concrete:{_c}", "minecraft:concrete", {"color": bc}, CONCRETE_RGB[_c])
    reg(f"wool:{_c}", "minecraft:wool", {"color": bc}, WOOL_RGB[_c])
    reg(f"carpet:{_c}", "minecraft:carpet", {"color": bc}, WOOL_RGB[_c], "flat")
    glass_rgb = tuple(int(v * 0.6 + 255 * 0.4) for v in WOOL_RGB[_c])
    reg(f"glass:{_c}", "minecraft:stained_glass", {"color": bc}, glass_rgb)
    reg(f"pane:{_c}", "minecraft:stained_glass_pane", {"color": bc}, glass_rgb, "thin")

reg("grass", "minecraft:grass", rgb=(95, 159, 53))
reg("dirt", "minecraft:dirt", {"dirt_type": "normal"}, (134, 96, 67))
reg("smooth_stone", "minecraft:smooth_stone", rgb=(160, 160, 160))
reg("stone_slab", "minecraft:stone_slab", {"stone_slab_type": "smooth_stone", "top_slot_bit": False},
    (168, 168, 168), "flat")
reg("brick", "minecraft:brick_block", rgb=(150, 74, 58))
reg("quartz", "minecraft:quartz_block", {"chisel_type": "default", "pillar_axis": "y"}, (236, 230, 223))
reg("glass", "minecraft:glass", rgb=(200, 228, 236))
reg("glass_pane", "minecraft:glass_pane", rgb=(200, 228, 236), shape="thin")
reg("oak_planks", "minecraft:planks", {"wood_type": "oak"}, (162, 130, 78))
reg("dark_oak_planks", "minecraft:planks", {"wood_type": "dark_oak"}, (66, 43, 20))
reg("oak_log", "minecraft:log", {"old_log_type": "oak", "pillar_axis": "y"}, (109, 85, 50))
reg("oak_leaves", "minecraft:leaves", {"old_leaf_type": "oak", "persistent_bit": True, "update_bit": False},
    (60, 130, 40))
reg("dark_oak_fence", "minecraft:fence", {"wood_type": "dark_oak"}, (66, 43, 20), "thin")
reg("sea_lantern", "minecraft:seaLantern", rgb=(210, 230, 225))
reg("glowstone", "minecraft:glowstone", rgb=(250, 215, 120))
reg("shroomlight", "minecraft:shroomlight", rgb=(240, 146, 70))
reg("froglight_green", "minecraft:verdant_froglight", {"pillar_axis": "y"}, (180, 235, 160), version=V119)
reg("froglight_yellow", "minecraft:ochre_froglight", {"pillar_axis": "y"}, (250, 240, 160), version=V119)
reg("froglight_pink", "minecraft:pearlescent_froglight", {"pillar_axis": "y"}, (240, 205, 235), version=V119)
reg("magma", "minecraft:magma", rgb=(200, 90, 30))
reg("iron_block", "minecraft:iron_block", rgb=(220, 220, 220))
reg("gold_block", "minecraft:gold_block", rgb=(246, 208, 61))
reg("iron_bars", "minecraft:iron_bars", rgb=(160, 160, 160), shape="thin")
reg("target", "minecraft:target", rgb=(230, 170, 160))
reg("lantern", "minecraft:lantern", {"hanging": True}, (250, 200, 110), "thin")
reg("end_rod", "minecraft:end_rod", {"facing_direction": 1}, (245, 240, 230), "thin")
reg("lever", "minecraft:lever", {"lever_direction": "up_north_south", "open_bit": False}, (110, 90, 60), "thin")
reg("button", "minecraft:stone_button", {"button_pressed_bit": False, "facing_direction": 1}, (140, 140, 140),
    "thin")
reg("cake", "minecraft:cake", {"bite_counter": 0}, (240, 235, 230), "flat")
reg("candle_cake", "minecraft:candle_cake", {"lit": True}, (240, 210, 200), "flat")
reg("crafting_table", "minecraft:crafting_table", rgb=(150, 110, 70))
for _c in ("red", "yellow", "light_blue", "white"):
    reg(f"candle:{_c}", f"minecraft:{_c}_candle", {"candles": 2, "lit": True}, WOOL_RGB[_c], "thin")

# stairs: weirdo_direction = side the tall back faces (0 east, 1 west, 2 south, 3 north)
STAIR_DIR = {"east": 0, "west": 1, "south": 2, "north": 3}
for _kind, _rgb in (("purpur", (169, 125, 169)), ("dark_oak", (66, 43, 20)),
                    ("smooth_sandstone", (224, 214, 170)), ("quartz", (236, 230, 223))):
    for _d, _v in STAIR_DIR.items():
        reg(f"stairs:{_kind}:{_d}", f"minecraft:{_kind}_stairs",
            {"weirdo_direction": _v, "upside_down_bit": False}, _rgb)
# iron doors (open; a lever keeps them powered): direction 0 east, 2 west
for _d in (0, 2):
    for _half in ("lower", "upper"):
        reg(f"iron_door:{_d}:{_half}", "minecraft:iron_door",
            {"direction": _d, "door_hinge_bit": False, "open_bit": True, "upper_block_bit": _half == "upper"},
            (200, 200, 205), "thin")
# wall levers: lever_direction = the face of the support block it sticks out of
for _d in ("east", "west"):
    reg(f"wall_lever:{_d}:on", "minecraft:lever", {"lever_direction": _d, "open_bit": True}, (110, 90, 60), "thin")
    reg(f"wall_lever:{_d}:off", "minecraft:lever", {"lever_direction": _d, "open_bit": False}, (110, 90, 60),
        "thin")
# carved pumpkin faces: direction 0 south, 1 west, 2 north, 3 east
for _d, _v in {"south": 0, "west": 1, "north": 2, "east": 3}.items():
    reg(f"pumpkin_face:{_d}", "minecraft:carved_pumpkin", {"direction": _v}, (210, 120, 25))
reg("redstone_lamp", "minecraft:redstone_lamp", rgb=(130, 80, 50))
reg("crying_obsidian", "minecraft:crying_obsidian", rgb=(50, 10, 90))
reg("candle:plain", "minecraft:candle", {"candles": 0, "lit": True}, (230, 220, 200), "thin")

# ladders: facing_direction = side the ladder faces, away from its wall
for _d, _v in {"north": 2, "south": 3, "west": 4, "east": 5}.items():
    reg(f"ladder:{_d}", "minecraft:ladder", {"facing_direction": _v}, (150, 115, 65), "thin")


# ---------------------------------------------------------------------------
# voxel grid
# ---------------------------------------------------------------------------

W, H, D = 64, 36, 72          # x (east), y (up), z (south edge, exclusive)
ZN = -16                      # north edge: the back-of-house annex sits at negative z
GY = 2                        # ground / floor block layer
FY = 3                        # first walkable layer (feet)
CY = 13                       # ceiling + roof layer
BZ1 = 51                      # front wall of the building (z); parking lot is south of it


class Grid:
    def __init__(self):
        self.cells = ["air"] * (W * H * (D - ZN))

    def _i(self, x, y, z):
        return (y * (D - ZN) + (z - ZN)) * W + x

    def inside(self, x, y, z):
        return 0 <= x < W and 0 <= y < H and ZN <= z < D

    def set(self, x, y, z, key):
        if key not in PALETTE:
            raise KeyError(f"unknown palette key {key}")
        if self.inside(x, y, z):
            self.cells[self._i(x, y, z)] = key

    def get(self, x, y, z):
        if not self.inside(x, y, z):
            return "air"
        return self.cells[self._i(x, y, z)]

    def fill(self, x0, y0, z0, x1, y1, z1, key):
        for y in range(min(y0, y1), max(y0, y1) + 1):
            for z in range(min(z0, z1), max(z0, z1) + 1):
                for x in range(min(x0, x1), max(x0, x1) + 1):
                    self.set(x, y, z, key)

    def fill_fn(self, x0, y0, z0, x1, y1, z1, fn):
        """fill with fn(x, y, z) -> key or None (leave as is)"""
        for y in range(min(y0, y1), max(y0, y1) + 1):
            for z in range(min(z0, z1), max(z0, z1) + 1):
                for x in range(min(x0, x1), max(x0, x1) + 1):
                    k = fn(x, y, z)
                    if k is not None:
                        self.set(x, y, z, k)


g = Grid()
rng = random.Random(1977)     # fixed seed: the map is identical on every build


# ---------------------------------------------------------------------------
# pixel font + pixel art
# ---------------------------------------------------------------------------

FONT = {
    "A": ["###", "#.#", "###", "#.#", "#.#"],
    "C": ["###", "#..", "#..", "#..", "###"],
    "E": ["###", "#..", "###", "#..", "###"],
    "G": ["###", "#..", "#.#", "#.#", "###"],
    "H": ["#.#", "#.#", "###", "#.#", "#.#"],
    "I": ["###", ".#.", ".#.", ".#.", "###"],
    "K": ["#.#", "#.#", "##.", "#.#", "#.#"],
    "M": ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
    "P": ["###", "#.#", "###", "#..", "#.."],
    "R": ["##.", "#.#", "##.", "#.#", "#.#"],
    "S": ["###", "#..", "###", "..#", "###"],
    "U": ["#.#", "#.#", "#.#", "#.#", "###"],
    "Z": ["###", "..#", ".#.", "#..", "###"],
    ".": [".", ".", ".", ".", "#"],
    " ": ["..", "..", "..", "..", ".."],
}


def text_width(text):
    return sum(len(FONT[ch][0]) for ch in text) + len(text) - 1


def draw_text(text, ox, oy, oz, right, key, scale=1):
    """Draw text in a vertical plane. (ox, oy, oz) is the bottom-left block,
    `right` the (dx, dz) reading direction, letters grow upward."""
    cursor = 0
    for ch in text:
        glyph = FONT[ch]
        gw = len(glyph[0])
        for row, line in enumerate(glyph):
            for col, px in enumerate(line):
                if px != "#":
                    continue
                for sy in range(scale):
                    for sx in range(scale):
                        u = (cursor + col) * scale + sx
                        v = (4 - row) * scale + sy
                        g.set(ox + right[0] * u, oy + v, oz + right[1] * u, key)
        cursor += gw + 1


def draw_art(rows, ox, oy, oz, right, legend):
    """Pixel art in a vertical plane; rows are top to bottom, '.' = untouched."""
    hgt = len(rows)
    for r, line in enumerate(rows):
        for c, px in enumerate(line):
            if px == ".":
                continue
            g.set(ox + right[0] * c, oy + (hgt - 1 - r), oz + right[1] * c, legend[px])


MOUSE_FACE = [
    ".EEE.......EEE.",
    "EPPPE.....EPPPE",
    "EPPPE.CCC.EPPPE",
    "EPPPECCCCCEPPPE",
    ".EEGCCCCCCCGEE.",
    "..GGGGGGGGGGG..",
    "..GGWKGGGKWGG..",
    "..GGWKGGGKWGG..",
    "..GGGGGGGGGGG..",
    "...GGWWNWWGG...",
    "...GWWWWWWWG...",
    "....GGWWWGG....",
    ".....GGGGG.....",
]
MOUSE_LEGEND = {"E": "wool:gray", "P": "wool:pink", "C": "wool:purple", "G": "wool:light_gray",
                "W": "wool:white", "K": "wool:black", "N": "wool:black"}


# ---------------------------------------------------------------------------
# ground, parking lot, building shell
# ---------------------------------------------------------------------------

def build_ground():
    g.fill(0, 0, ZN, W - 1, 1, D - 1, "dirt")
    g.fill(0, GY, ZN, W - 1, GY, D - 1, "grass")
    # sidewalk along the front, curb, then asphalt
    g.fill(0, GY, BZ1 + 1, W - 1, GY, BZ1 + 3, "smooth_stone")
    g.fill(0, GY, BZ1 + 4, W - 1, GY, D - 2, "concrete:gray")
    # parking stall lines: two rows of stalls facing a centre drive lane
    for x in range(2, W - 1, 4):
        if 26 <= x <= 37:
            continue                      # keep the walkway to the doors clear
        g.fill(x, GY, BZ1 + 5, x, GY, BZ1 + 9, "concrete:white")
        g.fill(x, GY, D - 7, x, GY, D - 3, "concrete:white")
    # painted walkway to the entrance
    for z in range(BZ1 + 4, D - 1):
        for x in range(29, 35):
            if (z + x) % 2 == 0 or x in (29, 34):
                g.set(x, GY, z, "concrete:white")
    g.fill(0, GY, D - 1, W - 1, GY, D - 1, "grass")


def tree(x, z):
    for y in range(FY, FY + 4):
        g.set(x, y, z, "oak_log")
    for dy in range(2, 6):
        r = 2 if dy < 4 else 1
        for dz in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if abs(dx) + abs(dz) <= r + (1 if dy == 3 else 0) and g.get(x + dx, FY + dy, z + dz) == "air":
                    g.set(x + dx, FY + dy, z + dz, "oak_leaves")


def lamp_post(x, z):
    for y in range(FY, FY + 4):
        g.set(x, y, z, "iron_bars")
    g.set(x, FY + 4, z, "sea_lantern")


def car(x, z, color):
    """little 3x5 car parked facing north, front at z"""
    body = f"concrete:{color}"
    g.fill(x, FY, z, x + 2, FY, z + 4, body)
    for (cx, cz) in ((x, z + 1), (x + 2, z + 1), (x, z + 3), (x + 2, z + 3)):
        g.set(cx, FY, cz, "concrete:black")          # wheels
    g.fill(x, FY + 1, z, x + 2, FY + 1, z + 4, body)
    g.fill(x, FY + 1, z + 1, x + 2, FY + 1, z + 3, "glass")
    g.fill(x, FY + 2, z + 1, x + 2, FY + 2, z + 3, body)
    g.set(x, FY + 1, z, "froglight_yellow")           # headlights
    g.set(x + 2, FY + 1, z, "froglight_yellow")
    g.set(x, FY + 1, z + 4, "concrete:red")           # tail lights
    g.set(x + 2, FY + 1, z + 4, "concrete:red")


def build_lot():
    # planters with trees along the sidewalk, skipping the entrance
    for x in (5, 16, 47, 58):
        g.fill(x - 1, GY, BZ1 + 2, x + 1, GY, BZ1 + 2, "grass")
        tree(x, BZ1 + 2)
    for x in (12, 24, 40, 52):
        lamp_post(x, BZ1 + 10)
    car(3, BZ1 + 5, "red")
    car(11, BZ1 + 5, "light_blue")
    car(43, BZ1 + 5, "yellow")
    car(7, D - 7, "white")
    car(51, D - 7, "lime")
    car(55, BZ1 + 5, "purple")


def wall_key(x, y, z):
    """exterior wall colour bands"""
    if y <= GY + 2:
        return "brick"
    if y == GY + 3:
        return "concrete:yellow"
    if y >= CY - 1:
        return "concrete:purple"
    return "concrete:white"


def build_shell():
    # floor default (zones repaint it), walls, ceiling/roof
    g.fill(1, GY, 1, W - 2, GY, BZ1 - 1, "concrete:white")
    for y in range(GY, CY + 1):
        for x in range(W):
            g.set(x, y, 0, wall_key(x, y, 0))
            g.set(x, y, BZ1, wall_key(x, y, BZ1))
        for z in range(BZ1 + 1):
            g.set(0, y, z, wall_key(0, y, z))
            g.set(W - 1, y, z, wall_key(W - 1, y, z))
    g.fill(1, CY, 1, W - 2, CY, BZ1 - 1, "concrete:white")
    # roof parapet + rooftop air conditioners
    for x in range(W):
        g.set(x, CY + 1, 0, "concrete:light_gray")
        g.set(x, CY + 1, BZ1, "concrete:purple")
    for z in range(BZ1 + 1):
        g.set(0, CY + 1, z, "concrete:light_gray")
        g.set(W - 1, CY + 1, z, "concrete:light_gray")
    for (ax, az) in ((10, 8), (40, 6), (52, 22), (20, 26)):
        g.fill(ax, CY + 1, az, ax + 2, CY + 2, az + 1, "iron_block")
        g.set(ax + 1, CY + 2, az, "iron_bars")

    # neon stripe that wraps the outside walls
    for x in range(1, W - 1):
        if x % 2 == 0:
            g.set(x, CY - 2, 0, "froglight_pink")
    for z in range(1, BZ1):
        if z % 2 == 0:
            g.set(0, CY - 2, z, "froglight_pink")
            g.set(W - 1, CY - 2, z, "froglight_pink")

    # side windows into the dining room
    for z in (12, 18, 24, 30):
        g.fill(0, FY + 2, z, 0, FY + 4, z + 2, "glass_pane")

    # brick pilasters on the front
    for x in (1, 9, 17, 25, 38, 46, 54, 62):
        g.fill(x, GY, BZ1 + 1, x, CY, BZ1 + 1, "brick")
        g.set(x, CY + 1, BZ1 + 1, "concrete:yellow")

    # front windows (kitchen + party room)
    for (x0, x1) in ((3, 7), (11, 15), (19, 23)):
        g.fill(x0, FY + 2, BZ1, x1, FY + 5, BZ1, "glass_pane")

    # entrance: 4 wide doorway with a glass frame and a purple awning
    g.fill(30, FY, BZ1, 33, FY + 3, BZ1, "air")
    g.fill(29, FY, BZ1, 29, FY + 4, BZ1, "glass")
    g.fill(34, FY, BZ1, 34, FY + 4, BZ1, "glass")
    g.fill(30, FY + 4, BZ1, 33, FY + 4, BZ1, "glass")
    g.fill(27, FY + 5, BZ1 + 1, 36, FY + 5, BZ1 + 3, "wool:purple")
    for x in range(27, 37):
        g.set(x, FY + 5, BZ1 + 4, "wool:yellow" if x % 2 else "wool:purple")
    for x in (27, 36):
        g.fill(x, FY, BZ1 + 3, x, FY + 4, BZ1 + 3, "iron_bars")
    g.fill(28, FY + 6, BZ1 + 1, 35, FY + 6, BZ1 + 1, "froglight_yellow")


def build_sign():
    """CHUCK E. CHEESE banner on the roof edge with the mouse logo on top"""
    text = "CHUCK E. CHEESE"
    tw = text_width(text)
    bx0 = (W - (tw + 4)) // 2
    bx1 = bx0 + tw + 3
    by0, by1 = CY + 1, CY + 9
    for y in range(by0, by1 + 1):
        for x in range(bx0, bx1 + 1):
            edge = y in (by0, by1) or x in (bx0, bx1)
            g.set(x, y, BZ1, "concrete:orange" if edge else "concrete:purple")
    # supports on the roof behind the banner
    for x in range(bx0, bx1 + 1, 6):
        g.fill(x, CY + 1, BZ1 - 1, x, by1 - 1, BZ1 - 1, "concrete:light_gray")
    draw_text(text, bx0 + 2, by0 + 2, BZ1, (1, 0), "concrete:yellow")
    # mouse head logo sitting on the banner
    lx = (W - len(MOUSE_FACE[0])) // 2
    draw_art(MOUSE_FACE, lx, by1 + 1, BZ1, (1, 0), MOUSE_LEGEND)
    # lights under the banner's top edge so it glows at night
    for x in range(bx0 + 1, bx1, 3):
        g.set(x, by1, BZ1 - 1, "glowstone")


# ---------------------------------------------------------------------------
# interior zones
#   dining showroom  x 1..29,  z 1..37   (stage on the back wall)
#   centre aisle     x 30..33, z 1..50   (from the doors to the back)
#   play zone        x 35..62, z 1..17   (ball pit + tubes + slides)
#   arcade           x 35..62, z 19..37
#   kitchen          x 1..20,  z 39..50
#   party room       x 22..28, z 39..50
#   prize counter    x 34..62, z 39..50
# ---------------------------------------------------------------------------

def arcade_carpet(x, z):
    r = rng.random()
    if r < 0.05:
        return rng.choice(["concrete:lime", "concrete:yellow", "concrete:magenta", "concrete:light_blue"])
    if r < 0.30:
        return "concrete:blue"
    return "concrete:black"


def build_floors_and_ceilings():
    for z in range(1, BZ1):
        for x in range(1, W - 1):
            if x <= 29 and z <= 37:
                key = "concrete:black" if (x + z) % 2 else "concrete:white"     # diner checkerboard
            elif x <= 20 and z >= 39:
                key = "concrete:light_gray" if (x + z) % 2 else "concrete:white"  # kitchen tile
            elif 22 <= x <= 28 and z >= 39:
                key = "concrete:pink" if (x // 2 + z // 2) % 2 else "concrete:light_blue"  # party room
            elif x >= 35 and z <= 17:
                key = ["wool:red", "wool:blue", "wool:yellow", "wool:lime"][(x // 3 + z // 3) % 4]  # padded
            else:
                key = arcade_carpet(x, z)
            g.set(x, GY, z, key)
            dark = x >= 30 and not (x <= 33 and z >= 39)
            g.set(x, CY, z, "concrete:black" if dark else "concrete:white")
    # ceiling light grid
    for z in range(3, BZ1, 5):
        for x in range(3, W - 1, 5):
            g.set(x, CY, z, "sea_lantern")


def build_partitions():
    # kitchen + party room north wall (with the order window), and side walls
    for x in range(1, 30):
        for y in range(FY, CY):
            g.set(x, y, 38, "concrete:purple" if y < FY + 3 else "concrete:white")
    g.fill(4, FY, 38, 16, FY, 38, "quartz")             # order counter
    g.fill(4, FY + 1, 38, 16, FY + 2, 38, "air")        # order window
    g.fill(21, FY, 39, 21, CY - 1, 50, "concrete:white")    # kitchen | party room
    g.fill(29, FY, 38, 29, CY - 1, 50, "concrete:pink")     # party room | entry aisle
    g.fill(29, FY, 42, 29, FY + 2, 44, "air")               # party room doorway
    g.fill(29, FY + 3, 42, 29, FY + 3, 44, "concrete:yellow")
    # menu board above the order window, readable from the dining room
    g.fill(1, FY + 3, 38, 20, CY - 1, 38, "concrete:black")
    draw_text("PIZZA", 20, FY + 4, 38, (-1, 0), "concrete:yellow")
    # play-zone net between the play area and the arcade, with a gap
    for x in range(35, W - 1):
        if 40 <= x <= 42:
            continue
        g.set(x, FY, 18, "wool:blue")
        g.set(x, FY + 1, 18, "pane:light_blue")
        g.set(x, FY + 2, 18, "pane:light_blue")
    g.fill(34, FY, 1, 34, FY, 17, "wool:blue")
    g.fill(34, FY + 1, 1, 34, FY + 2, 17, "pane:light_blue")
    g.fill(34, FY, 6, 34, FY + 2, 8, "air")             # entrance from the aisle


# ---- stage + animatronic band ---------------------------------------------

MOUSE_BOT = {   # front view rows top->bottom, 7 wide; layer 0 = front (faces the crowd)
    "front": [
        "EE...EE",
        "EPCCCPE",
        ".GGGGG.",
        ".GKGKG.",
        ".GWNWG.",
        "ASSSSSA",
        ".SSSSS.",
        "..L.L..",
        "..F.F..",
    ],
    "back": [
        "EE...EE",
        "EECCCEE",
        ".GGGGG.",
        ".GGGGG.",
        ".GGGGG.",
        ".SSSSS.",
        ".SSSSS.",
        "..L.L..",
        "..F.F..",
    ],
    "legend": {"E": "wool:light_gray", "P": "wool:pink", "C": "wool:purple", "G": "wool:light_gray",
               "K": "wool:black", "W": "wool:white", "N": "wool:pink", "A": "wool:light_gray",
               "S": "wool:purple", "L": "wool:blue", "F": "wool:red"},
}
CHICKEN_BOT = {
    "front": [
        "..R..",
        ".WWW.",
        ".KWK.",
        ".WYW.",
        "WPPPW",
        "WPPPW",
        ".PPP.",
        ".O.O.",
    ],
    "back": [
        "..R..",
        ".WWW.",
        ".WWW.",
        ".WWW.",
        "WWWWW",
        "WPPPW",
        ".PPP.",
        ".O.O.",
    ],
    "legend": {"R": "wool:red", "W": "wool:white", "K": "wool:black", "Y": "wool:orange",
               "P": "wool:pink", "O": "wool:orange"},
}
MONSTER_BOT = {
    "front": [
        "P.....P",
        "PPPPPPP",
        "PWKPKWP",
        "PPPPPPP",
        "PRRRRRP",
        "PPPPPPP",
        ".PPPPP.",
        ".G...G.",
    ],
    "back": [
        "P.....P",
        "PPPPPPP",
        "PPPPPPP",
        "PPPPPPP",
        "PPPPPPP",
        "PPPPPPP",
        ".PPPPP.",
        ".G...G.",
    ],
    "legend": {"P": "wool:purple", "W": "wool:white", "K": "wool:black", "R": "wool:red", "G": "wool:lime"},
}


def place_bot(bot, x0, y0, zfront):
    """animatronic facing south; front layer at zfront, back layer behind it"""
    for layer, z in (("back", zfront - 1), ("front", zfront)):
        rows = bot[layer]
        hgt = len(rows)
        for r, line in enumerate(rows):
            for c, px in enumerate(line):
                if px != ".":
                    g.set(x0 + c, y0 + (hgt - 1 - r), z, bot["legend"][px])


def build_stage():
    sx0, sx1, sz1 = 4, 25, 7
    g.fill(sx0, FY, 1, sx1, FY, sz1, "dark_oak_planks")         # stage platform (stand at FY+1)
    g.fill(sx0, FY, sz1, sx1, FY, sz1, "concrete:black")         # front lip
    for x in range(sx0 + 1, sx1, 3):
        g.set(x, FY, sz1, "froglight_yellow")                    # footlights
    for x in range(13, 17):
        g.set(x, FY, sz1 + 1, "stairs:dark_oak:north")           # steps up
    # curtains: back drop, side legs, valance
    g.fill(sx0 - 1, FY, 1, sx1 + 1, CY - 1, 1, "wool:red")
    g.fill(sx0 - 1, FY, 2, sx0 - 1, CY - 1, 3, "wool:red")
    g.fill(sx1 + 1, FY, 2, sx1 + 1, CY - 1, 3, "wool:red")
    g.fill(sx0 - 1, CY - 1, sz1, sx1 + 1, CY - 1, sz1, "wool:red")  # valance
    # stars on the back drop
    for (x, y) in ((6, 9), (10, 11), (19, 11), (23, 9), (14, 11), (8, 6), (21, 6)):
        g.set(x, y, 1, "glowstone")
    # the band: chicken, mouse (centre), purple monster
    place_bot(CHICKEN_BOT, 5, FY + 1, 4)
    place_bot(MOUSE_BOT, 11, FY + 1, 5)
    place_bot(MONSTER_BOT, 18, FY + 1, 4)
    g.set(14, FY + 1, 6, "end_rod")                          # microphone stand
    g.set(14, FY + 2, 6, "end_rod")
    g.fill(18, FY + 1, 5, 24, FY + 1, 5, "quartz")              # keyboard for the monster
    for x in range(18, 25, 2):
        g.set(x, FY + 2, 5, "carpet:black")
    # speakers
    for x in (sx0, sx1):
        g.fill(x, FY + 1, 2, x, FY + 4, 3, "concrete:black")
        g.set(x, FY + 2, 3, "wool:gray")
        g.set(x, FY + 4, 3, "wool:gray")
    # spotlights hanging over the stage
    for x in (8, 15, 22):
        g.set(x, CY - 1, sz1 + 2, "lantern")


# ---- dining tables -----------------------------------------------------------

def party_table(x0, z, length, cloth):
    for x in range(x0, x0 + length):
        g.set(x, FY, z, "quartz")
        g.set(x, FY, z - 1, "stairs:purpur:north")      # seat facing south toward the table
        g.set(x, FY, z + 1, "stairs:purpur:south")      # seat facing north
        g.set(x, FY + 1, z, f"carpet:{cloth}")
    # pizzas (cheese = yellow carpet with pepperoni = red candles are too fiddly, keep it simple)
    for x in range(x0 + 1, x0 + length, 2):
        g.set(x, FY + 1, z, "carpet:yellow")


def build_dining():
    cloths = ["red", "blue", "red", "blue", "red"]
    for row, z in enumerate((12, 17, 22, 27, 32)):
        for x0 in (3, 11, 19):
            party_table(x0, z, 5, cloths[row])
    # birthday cakes on a few tables
    for (x, z) in ((5, 17), (13, 27), (21, 12)):
        g.set(x, FY + 1, z, "candle_cake")


# ---- arcade ------------------------------------------------------------------

BODY_COLORS = ["purple", "blue", "red", "black", "lime", "orange", "magenta", "cyan"]
SCREENS = ["sea_lantern", "froglight_green", "froglight_pink", "froglight_yellow", "glowstone",
           "shroomlight"]


def cabinet(x, zfront, facing, n):
    """arcade cabinet; the player stands one block beyond zfront"""
    zback = zfront - 1 if facing == "south" else zfront + 1
    body = f"concrete:{BODY_COLORS[n % len(BODY_COLORS)]}"
    g.set(x, FY, zfront, body)                       # control panel
    g.set(x, FY + 1, zfront, "lever" if n % 2 == 0 else "button")
    g.set(x, FY, zback, body)
    g.set(x, FY + 1, zback, SCREENS[n % len(SCREENS)])
    g.set(x, FY + 2, zback, body)
    g.set(x, FY + 3, zback, f"glass:{BODY_COLORS[(n + 3) % len(BODY_COLORS)]}")   # marquee


def claw_machine(x0, z0, color):
    g.fill(x0, FY, z0, x0 + 3, FY, z0 + 3, f"concrete:{color}")
    g.fill(x0, FY + 1, z0, x0 + 3, FY + 3, z0 + 3, "glass")
    prizes = ["wool:pink", "wool:yellow", "wool:light_blue", "wool:lime"]
    for i, (dx, dz) in enumerate(((1, 1), (2, 1), (1, 2), (2, 2))):
        g.set(x0 + dx, FY + 1, z0 + dz, prizes[i])
        g.set(x0 + dx, FY + 2, z0 + dz, "air")
        g.set(x0 + dx, FY + 3, z0 + dz, "air")
    g.set(x0 + 1, FY + 3, z0 + 2, "iron_bars")       # the claw
    g.fill(x0, FY + 4, z0, x0 + 3, FY + 4, z0 + 3, f"concrete:{color}")
    g.set(x0 + 1, FY + 5, z0 + 1, "glowstone")


def skeeball_lane(x):
    """lane runs north; the player rolls from z = 37"""
    g.fill(x - 1, FY, 23, x - 1, FY + 1, 36, "concrete:red")      # rails
    g.fill(x + 1, FY, 23, x + 1, FY + 1, 36, "concrete:red")
    g.fill(x, FY, 30, x, FY, 36, "stone_slab")                    # rolling lane
    g.fill(x, FY, 27, x, FY, 29, "smooth_stone")                  # ramp
    g.fill(x, FY, 24, x, FY + 2, 26, "air")
    g.set(x, FY, 25, "target")                                    # score rings
    g.set(x, FY + 1, 24, "target")
    g.fill(x - 1, FY, 23, x + 1, FY + 4, 23, "concrete:black")    # backboard
    g.set(x, FY + 3, 23, "glowstone")                              # score light


def build_arcade():
    n = 0
    for (zf_north, zf_south) in ((21, 24), (28, 31)):
        for x in range(36, 54):
            if x in (40, 45, 50):
                continue
            cabinet(x, zf_north, "north", n)
            cabinet(x, zf_south, "south", n + 1)
            n += 2
    for i, x0 in enumerate((36, 42, 48)):
        claw_machine(x0, 34, ["yellow", "red", "light_blue"][i])
    for x in (56, 58, 60):
        skeeball_lane(x)
    # neon "GAMES" over the arcade, on the play-zone net side, read from the arcade
    g.fill(40, FY + 4, 18, 62, CY - 2, 18, "concrete:black")
    draw_text("GAMES", 41, FY + 5, 18, (1, 0), "froglight_pink")


# ---- play zone: ball pit, tubes and slides -------------------------------------

BALL_COLORS = ["wool:red", "wool:yellow", "wool:blue", "wool:lime", "wool:orange", "wool:purple",
               "wool:pink", "wool:light_blue"]


def tower(x0, z0, post, levels, ladder_at):
    """4x4 play tower: posts at the corners, mesh sides, floors at `levels`"""
    for y in range(FY, CY - 1):
        for (x, z) in ((x0, z0), (x0 + 3, z0), (x0, z0 + 3), (x0 + 3, z0 + 3)):
            g.set(x, y, z, f"concrete:{post}")
    for lvl in levels:
        g.fill(x0, lvl, z0, x0 + 3, lvl, z0 + 3, "wool:blue")
        for y in (lvl + 1, lvl + 2):
            for i in range(1, 3):
                g.set(x0 + i, y, z0, "pane:yellow")
                g.set(x0 + i, y, z0 + 3, "pane:yellow")
                g.set(x0, y, z0 + i, "pane:yellow")
                g.set(x0 + 3, y, z0 + i, "pane:yellow")
    lx, lz, face = ladder_at
    back = {"south": (0, -1), "north": (0, 1), "east": (-1, 0), "west": (1, 0)}[face]
    top = max(levels)
    for y in range(FY, top + 1):
        g.set(lx, y, lz, f"ladder:{face}")
        g.set(lx + back[0], y, lz + back[1], f"concrete:{post}")


def tube_x(x0, x1, z0, floor_y, color):
    """tube running east-west, 2 wide (z0, z0+1) and 2 tall inside"""
    for x in range(min(x0, x1), max(x0, x1) + 1):
        ring = (x % 3 == 0)
        shell = f"concrete:{color}" if ring else f"glass:{color}"
        for dz in (-1, 2):
            for y in range(floor_y, floor_y + 4):
                g.set(x, y, z0 + dz, shell)
        for dz in (0, 1):
            g.set(x, floor_y, z0 + dz, shell)
            g.set(x, floor_y + 3, z0 + dz, shell)
            g.set(x, floor_y + 1, z0 + dz, "air")
            g.set(x, floor_y + 2, z0 + dz, "air")


def tube_z(z0, z1, x0, floor_y, color):
    for z in range(min(z0, z1), max(z0, z1) + 1):
        ring = (z % 3 == 0)
        shell = f"concrete:{color}" if ring else f"glass:{color}"
        for dx in (-1, 2):
            for y in range(floor_y, floor_y + 4):
                g.set(x0 + dx, y, z, shell)
        for dx in (0, 1):
            g.set(x0 + dx, floor_y, z, shell)
            g.set(x0 + dx, floor_y + 3, z, shell)
            g.set(x0 + dx, floor_y + 1, z, "air")
            g.set(x0 + dx, floor_y + 2, z, "air")


def slide_west(x_top, z0, top_y, bottom_y):
    """2-wide slide stepping down one block per block going west"""
    x = x_top
    for y in range(top_y, bottom_y - 1, -1):
        for dz in (0, 1):
            g.set(x, y, z0 + dz, "stairs:smooth_sandstone:east")
        g.set(x, y + 1, z0 - 1, "concrete:yellow")     # side rails
        g.set(x, y + 1, z0 + 2, "concrete:yellow")
        g.set(x, y, z0 - 1, "concrete:yellow")
        g.set(x, y, z0 + 2, "concrete:yellow")
        x -= 1
    return x + 1


def build_play_zone():
    # ball pit: sunk two blocks, full of balls, soft rim around it
    px0, px1, pz0, pz1 = 37, 47, 3, 14
    for z in range(pz0, pz1 + 1):
        for x in range(px0, px1 + 1):
            g.set(x, 0, z, "wool:blue")
            g.set(x, 1, z, rng.choice(BALL_COLORS))
            g.set(x, GY, z, rng.choice(BALL_COLORS))
    for x in range(px0 - 1, px1 + 2):
        g.set(x, FY, pz0 - 1, "wool:red")
        g.set(x, FY, pz1 + 1, "wool:red")
    for z in range(pz0 - 1, pz1 + 2):
        g.set(px0 - 1, FY, z, "wool:red")
        g.set(px1 + 1, FY, z, "wool:red")
    g.fill(px0 - 1, FY, 8, px0 - 1, FY, 9, "air")            # step in from the aisle side

    # tower A next to the pit, with the big slide into the balls
    tower(50, 2, "red", (FY + 3, FY + 6), (51, 4, "south"))
    g.fill(50, FY + 7, 3, 50, FY + 8, 4, "air")               # slide exit (west side, top level)
    slide_west(49, 3, FY + 6, GY + 1)
    # tube A -> B along the top level
    g.fill(53, FY + 7, 3, 53, FY + 8, 4, "air")
    tube_x(54, 57, 3, FY + 6, "light_blue")
    tower(58, 2, "orange", (FY + 3, FY + 6), (59, 4, "south"))
    g.fill(58, FY + 7, 3, 58, FY + 8, 4, "air")
    # tube B -> C going south on the lower level
    g.fill(59, FY + 4, 5, 60, FY + 5, 5, "air")
    tube_z(6, 9, 59, FY + 3, "lime")
    tower(58, 10, "purple", (FY + 3,), (60, 11, "south"))
    g.fill(59, FY + 4, 10, 60, FY + 5, 10, "air")
    # tower C slide back down to the floor
    g.fill(58, FY + 4, 11, 58, FY + 5, 12, "air")
    slide_west(57, 11, FY + 3, FY)


# ---- kitchen, party room, prize counter ---------------------------------------

def pizza_oven(x0):
    g.fill(x0, FY, 48, x0 + 2, FY + 2, 50, "brick")
    g.set(x0 + 1, FY + 1, 48, "air")                   # oven mouth
    g.set(x0 + 1, FY + 1, 49, "air")
    g.set(x0 + 1, FY, 49, "magma")                     # glowing coals
    g.set(x0 + 1, FY, 48, "magma")
    g.fill(x0 + 1, FY + 3, 49, x0 + 1, CY - 1, 49, "brick")    # chimney


def build_kitchen():
    pizza_oven(3)
    pizza_oven(9)
    g.fill(1, FY, 40, 1, FY, 46, "smooth_stone")          # prep counter along the west wall
    for z in range(40, 47, 2):
        g.set(1, FY + 1, z, "carpet:yellow")              # pizzas being made
    g.fill(15, FY, 48, 19, FY, 48, "smooth_stone")
    g.set(16, FY + 1, 48, "crafting_table")
    g.fill(19, FY, 40, 20, FY + 2, 40, "iron_block")      # fridge
    g.fill(6, FY, 43, 14, FY, 44, "smooth_stone")         # middle island
    for x in range(6, 15, 2):
        g.set(x, FY + 1, 43, "carpet:orange")
    g.set(10, FY + 1, 38, "iron_block")                   # cash register on the counter
    g.set(10, FY + 2, 38, "button")


def build_party_room():
    for x in range(23, 28):
        g.set(x, FY, 44, "quartz")
        g.set(x, FY, 45, "quartz")
        g.set(x, FY, 43, "stairs:purpur:north")
        g.set(x, FY, 46, "stairs:purpur:south")
        g.set(x, FY + 1, 44, "carpet:pink")
        g.set(x, FY + 1, 45, "carpet:pink")
    g.set(25, FY + 1, 44, "candle_cake")
    g.set(24, FY + 1, 45, "cake")
    g.set(26, FY + 1, 45, "cake")
    # balloons near the ceiling, some on strings
    balloons = ["wool:red", "wool:yellow", "wool:light_blue", "wool:lime", "wool:pink", "wool:orange"]
    spots = [(22, 39), (28, 39), (22, 50), (28, 50), (25, 40), (23, 48), (27, 47)]
    for i, (x, z) in enumerate(spots):
        g.set(x, CY - 2, z, balloons[i % len(balloons)])
        if i % 2 == 0:
            g.fill(x, CY - 5, z, x, CY - 3, z, "dark_oak_fence")
    # presents: wool box with a carpet bow
    for (x, z, box, bow) in ((22, 41, "red", "yellow"), (28, 48, "blue", "pink"), (22, 47, "lime", "red")):
        g.set(x, FY, z, f"wool:{box}")
        g.set(x, FY + 1, z, f"carpet:{bow}")


def build_prize_counter():
    for x in range(36, 62):
        g.set(x, FY, 44, "quartz")
        g.set(x, FY + 1, 44, "glass")
    g.fill(61, FY, 44, 61, FY + 1, 44, "air")            # staff gap at the east end
    for x in range(37, 60, 3):
        g.set(x, FY + 2, 44, ["candle:red", "candle:yellow", "candle:light_blue", "candle:white"][x % 4])
    # prize wall against the front wall: shelves of plush toys, PRIZES above
    for x in range(35, 62):
        for y in range(FY, FY + 4):
            if y % 2 == 1:
                g.set(x, y, 50, "oak_planks")
            else:
                g.set(x, y, 50, rng.choice(BALL_COLORS + ["sea_lantern", "gold_block"]))
    g.fill(35, FY + 4, 50, 61, CY - 1, 50, "concrete:purple")
    draw_text("PRIZES", 60, FY + 5, 50, (-1, 0), "concrete:yellow")
    # giant teddy bear behind the counter
    bx, bz = 35, 48
    g.fill(bx, FY, bz, bx + 2, FY + 1, bz, "wool:brown")       # body
    g.fill(bx, FY + 2, bz, bx + 2, FY + 4, bz, "wool:brown")   # head
    g.set(bx, FY + 5, bz, "wool:brown")                        # ears
    g.set(bx + 2, FY + 5, bz, "wool:brown")
    g.set(bx, FY + 3, bz - 1, "wool:black")                    # eyes
    g.set(bx + 2, FY + 3, bz - 1, "wool:black")
    g.set(bx + 1, FY + 2, bz - 1, "wool:white")                # snout


def build_aisle():
    # entry mat + token kiosks either side of the aisle near the doors
    g.fill(30, GY, 46, 33, GY, 50, "concrete:red")
    for z in (40, 46):
        g.set(34, FY, z, "iron_block")
        g.set(34, FY + 1, z, "froglight_yellow")


# ---- back of house: security office with two doors, and vents ----------------
#   west hall   x 27..28, z -13..-1   (opens into the dining room)
#   east hall   x 40..41, z -13..-1   (opens into the play zone)
#   back hall   x 27..41, z -13..-12
#   office      x 30..38, z -6..-1    iron doors in its west (x 29) and east (x 39) walls
#   parts room  x 30..38, z -10..-8
# Rooms are 4 tall under a ceiling at y 7; the vents run above it at y 8..9.

AX0, AX1, AZ0 = 26, 42, -14    # annex outer walls; its south side is the building's back wall
ACY = FY + 4                   # annex ceiling
VY = ACY + 1                   # vent floor level the player walks on inside the ducts


def annex_wall(x, y, z):
    if y <= FY:
        return "concrete:gray"
    if y == FY + 1:
        return "concrete:black" if (x + z) % 2 else "concrete:white"    # checkered stripe
    return "concrete:light_gray"


def vent(path, shell_from, shell_to):
    """carve a 1 wide, 2 tall duct through the cells in `path` (x, z at VY),
    and wrap the part between x = shell_from..shell_to (outside the annex) in metal"""
    for (x, z) in path:
        g.set(x, VY, z, "air")
        g.set(x, VY + 1, z, "air")
    for x in range(min(shell_from, shell_to), max(shell_from, shell_to) + 1):
        g.set(x, VY - 1, -1, "concrete:light_gray")
        g.set(x, VY + 2, -1, "concrete:light_gray")
        g.set(x, VY, -2, "iron_bars" if x % 4 == 0 else "concrete:light_gray")   # grates let light in
        g.set(x, VY + 1, -2, "concrete:light_gray")


def build_office():
    # solid block from floor to roof, then carve the rooms out of it
    for z in range(AZ0, 0):
        for x in range(AX0, AX1 + 1):
            g.set(x, GY, z, "concrete:black" if (x + z) % 2 else "concrete:gray")
            for y in range(FY, ACY):
                g.set(x, y, z, annex_wall(x, y, z))
            for y in range(ACY, ACY + 4):
                g.set(x, y, z, "smooth_stone")
    for (x0, z0, x1, z1) in ((27, -13, 28, -1), (40, -13, 41, -1), (27, -13, 41, -12),
                             (30, -6, 38, -1), (30, -10, 38, -8)):
        g.fill(x0, FY, z0, x1, ACY - 1, z1, "air")
    g.fill(27, FY, 0, 28, FY + 2, 0, "air")        # west hall <- dining room
    g.fill(40, FY, 0, 41, FY + 2, 0, "air")        # east hall <- play zone
    g.fill(34, FY, -11, 34, FY + 1, -11, "air")    # parts room door off the back hall

    # the two doors. Each lever sits on a red panel next to its door and keeps
    # the door powered (open); flip it to slam the door shut. A second lever
    # turns on the lamp in the wall that lights up the hall outside.
    for (wall, inside, door_dir, lever_face) in ((29, 30, 0, "east"), (39, 38, 2, "west")):
        g.set(wall, FY, -3, f"iron_door:{door_dir}:lower")
        g.set(wall, FY + 1, -3, f"iron_door:{door_dir}:upper")
        g.set(wall, FY + 1, -4, "concrete:red")
        g.set(inside, FY + 1, -4, f"wall_lever:{lever_face}:on")
        g.set(wall, FY + 1, -1, "redstone_lamp")
        g.set(inside, FY + 1, -1, f"wall_lever:{lever_face}:off")
        g.fill(wall, FY + 1, -6, wall, FY + 2, -5, "glass_pane")         # window onto the hall

    # desk with the camera monitors, desk fan and a cupcake
    g.fill(32, FY, -6, 36, FY, -6, "dark_oak_planks")
    g.set(32, FY + 1, -6, "carpet:white")
    g.set(33, FY + 1, -6, "froglight_green")
    g.set(34, FY + 1, -6, "iron_bars")
    g.set(35, FY + 1, -6, "froglight_green")
    g.set(36, FY + 1, -6, "candle_cake")
    g.set(34, FY, -5, "stairs:dark_oak:south")       # the guard's chair, facing the desk
    g.set(34, ACY - 1, -3, "lantern")
    for (x, y, color) in ((31, FY + 2, "yellow"), (32, FY + 3, "pink"), (37, FY + 2, "light_blue"),
                          (36, FY + 3, "lime")):
        g.set(x, y, -7, f"wool:{color}")              # kids' drawings on the wall

    # animatronics lurking outside the windows: purple bunny (west), chicken (east)
    g.set(27, FY, -5, "wool:purple")
    g.set(27, FY + 1, -5, "wool:purple")
    g.set(27, FY + 2, -5, "pumpkin_face:east")
    g.set(27, FY + 3, -5, "wool:purple")
    g.set(41, FY, -5, "wool:orange")
    g.set(41, FY + 1, -5, "wool:yellow")
    g.set(41, FY + 2, -5, "pumpkin_face:west")
    g.set(41, FY + 3, -5, "wool:red")

    # parts & service: spare costumes, an endoskeleton, tools
    for (x, color) in ((31, "light_gray"), (32, "purple"), (36, "yellow")):
        g.set(x, FY, -10, f"wool:{color}")
        g.set(x, FY + 1, -10, "pumpkin_face:south")
    g.fill(37, FY, -10, 37, FY + 1, -10, "iron_bars")
    g.set(37, FY + 2, -10, "iron_block")
    g.set(38, FY, -8, "crafting_table")
    g.set(30, FY, -8, "candle:white")

    # dim candles keep the halls spooky but too bright for mobs to spawn
    for z in (-1, -4, -7, -10, -13):
        g.set(27, FY, z, "candle:plain")
        g.set(41, FY, z, "candle:plain")
    for x in (30, 33, 36, 39):
        g.set(x, FY, -13, "candle:plain")

    # left vent: ladder up from the office, over the west hall, along the back
    # of the building and out through the curtain onto the stage behind the band
    vent([(x, -1) for x in range(14, 32)] + [(14, 0), (14, 1)], 13, AX0 - 1)
    for y in range(FY, VY + 1):
        g.set(31, y, -1, "ladder:north")
    g.fill(13, VY, -1, 13, VY + 1, -1, "concrete:light_gray")     # end cap
    for y in range(FY + 1, VY):
        g.set(14, y, 2, "ladder:south")
    # right vent: over the east hall and down into the play zone
    vent([(x, -1) for x in range(37, 45)] + [(44, 0)], AX1 + 1, 45)
    for y in range(FY, VY + 1):
        g.set(37, y, -1, "ladder:north")
    g.fill(45, VY, -1, 45, VY + 1, -1, "concrete:light_gray")
    for y in range(FY, VY):
        g.set(44, y, 1, "ladder:south")
    for (x, z) in ((15, -1), (20, -1), (25, -1), (29, -1), (40, -1), (44, -1)):
        g.set(x, VY + 2, z, "crying_obsidian")                     # glowing vent lights


def build_all():
    build_ground()
    build_lot()
    build_shell()
    build_floors_and_ceilings()
    build_partitions()
    build_stage()
    build_dining()
    build_arcade()
    build_play_zone()
    build_kitchen()
    build_party_room()
    build_prize_counter()
    build_aisle()
    build_office()
    build_sign()


# ---------------------------------------------------------------------------
# NBT (little endian, Bedrock flavour) + .mcstructure writer
# ---------------------------------------------------------------------------

TAG_BYTE, TAG_INT, TAG_STRING, TAG_LIST, TAG_COMPOUND = 1, 3, 8, 9, 10


class NbtList:
    def __init__(self, tag, items):
        self.tag, self.items = tag, items


def _tag_of(v):
    if isinstance(v, bool):
        return TAG_BYTE
    if isinstance(v, int):
        return TAG_INT
    if isinstance(v, str):
        return TAG_STRING
    if isinstance(v, NbtList):
        return TAG_LIST
    if isinstance(v, dict):
        return TAG_COMPOUND
    raise TypeError(type(v))


def _w_str(out, s):
    b = s.encode("utf-8")
    out.write(struct.pack("<H", len(b)))
    out.write(b)


def _w_payload(out, tag, v):
    if tag == TAG_BYTE:
        out.write(struct.pack("<b", 1 if v else 0))
    elif tag == TAG_INT:
        out.write(struct.pack("<i", v))
    elif tag == TAG_STRING:
        _w_str(out, v)
    elif tag == TAG_LIST:
        out.write(struct.pack("<b", v.tag))
        out.write(struct.pack("<i", len(v.items)))
        if v.tag == TAG_INT:
            out.write(struct.pack(f"<{len(v.items)}i", *v.items))
        else:
            for item in v.items:
                _w_payload(out, v.tag, item)
    elif tag == TAG_COMPOUND:
        for k, item in v.items():
            t = _tag_of(item)
            out.write(struct.pack("<b", t))
            _w_str(out, k)
            _w_payload(out, t, item)
        out.write(b"\x00")


def nbt_bytes(root):
    out = io.BytesIO()
    out.write(struct.pack("<b", TAG_COMPOUND))
    _w_str(out, "")
    _w_payload(out, TAG_COMPOUND, root)
    return out.getvalue()


def mcstructure(x0, z0, sx, sz):
    """encode the grid region [x0, x0+sx) x [0, H) x [z0, z0+sz)"""
    palette, index = [], {}
    primary = []
    for x in range(x0, x0 + sx):            # ZYX order: z changes fastest, then y, then x
        for y in range(H):
            for z in range(z0, z0 + sz):
                key = g.get(x, y, z)
                if key not in index:
                    index[key] = len(palette)
                    name, states, version, _, _ = PALETTE[key]
                    palette.append({"name": name, "states": dict(states), "version": version})
                primary.append(index[key])
    root = {
        "format_version": 1,
        "size": NbtList(TAG_INT, [sx, H, sz]),
        "structure": {
            "block_indices": NbtList(TAG_LIST, [NbtList(TAG_INT, primary),
                                                NbtList(TAG_INT, [-1] * len(primary))]),
            "entities": NbtList(TAG_COMPOUND, []),
            "palette": {"default": {"block_palette": NbtList(TAG_COMPOUND, palette),
                                    "block_position_data": {}}},
        },
        "structure_world_origin": NbtList(TAG_INT, [0, 0, 0]),
    }
    return nbt_bytes(root)


# ---------------------------------------------------------------------------
# behavior pack
# ---------------------------------------------------------------------------

PACK_UUID = "6b0f6d1e-3c1a-4d8e-9f3b-2a7c5e9d1c01"
MODULE_UUID = "a4e2c7b9-58d3-4f61-8b2e-0c9d7f3a6e02"
PACK_VERSION = [1, 1, 0]       # bump on every release so Minecraft replaces the old import
PIECE = 64                      # Bedrock structures stay within 64 x 64 blocks
ANCHOR = (32, FY, 28)          # grid cell the player stands in when running the function
VIEW_SPOT = (32, FY, 69)       # where the player is sent afterwards: the parking lot


def pack_icon():
    img = Image.new("RGB", (16, 16), (100, 32, 156))
    rows = MOUSE_FACE
    oy = (16 - len(rows)) // 2
    for r, line in enumerate(rows):
        for c, px in enumerate(line):
            if px != ".":
                img.putpixel((c, oy + r), PALETTE[MOUSE_LEGEND[px]][3])
    return img.resize((256, 256), Image.NEAREST)


def build_pack():
    files = {}
    commands = [
        "# Chuck E. Cheese fan map. Stand on flat ground (a Flat world is best) and run",
        "#   /function chuckecheese",
        "# The building appears around you; you are then sent to the parking lot.",
    ]
    ax, ay, az = ANCHOR
    for px in range(0, W, PIECE):
        for pz in range(ZN, D, PIECE):
            sx, sz = min(PIECE, W - px), min(PIECE, D - pz)
            name = f"part_{px // PIECE}_{(pz - ZN) // PIECE}"
            files[f"structures/cec/{name}.mcstructure"] = mcstructure(px, pz, sx, sz)
            commands.append(f"structure load cec:{name} ~{px - ax} ~{-ay} ~{pz - az}")
    vx, vy, vz = VIEW_SPOT
    commands += [
        f"tp @s ~{vx - ax} ~{vy - ay} ~{vz - az} 180 -25",     # face north, looking up at the sign
        "title @s title §dChuck E. Cheese",
        "title @s subtitle §ePizza, games and fun!",
        "playsound random.levelup @s",
    ]
    files["functions/chuckecheese.mcfunction"] = ("\n".join(commands) + "\n").encode()
    manifest = {
        "format_version": 2,
        "header": {
            "name": "Chuck E. Cheese Map",
            "description": "Fan-made pizza and arcade party place. Run /function chuckecheese",
            "uuid": PACK_UUID,
            "version": PACK_VERSION,
            "min_engine_version": [1, 20, 0],
        },
        "modules": [{"type": "data", "uuid": MODULE_UUID, "version": PACK_VERSION}],
    }
    files["manifest.json"] = json.dumps(manifest, indent=2).encode()
    icon = io.BytesIO()
    pack_icon().save(icon, "PNG")
    files["pack_icon.png"] = icon.getvalue()

    path = os.path.join(HERE, "ChuckECheese.mcpack")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 18, 12, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, files[name])
    return path, files


# ---------------------------------------------------------------------------
# previews
# ---------------------------------------------------------------------------

def _shade(rgb, f):
    return tuple(max(0, min(255, int(c * f))) for c in rgb)


def render_iso(path, cut=False, scale=7):
    """isometric view from the south-east, above. cut=True hides the roof,
    sign and the upper part of the walls so the inside shows."""
    a, b, c = scale, scale / 2, scale * 1.15

    def hidden(x, y, z):
        if not cut:
            return False
        if z < 0:   # annex: drop its ceiling, vents and roof, and the east wall facing the camera
            return y >= ACY or (y > FY + 1 and x == AX1)
        in_building = z <= BZ1 + 1
        return in_building and (y >= CY or (y > FY + 1 and (z >= BZ1 or x == W - 1 or x == 0 or z == 0)))

    def solid(x, y, z):
        k = g.get(x, y, z)
        return k != "air" and PALETTE[k][4] == "cube" and not hidden(x, y, z)

    ox = (D - ZN) * a + 20
    oy = H * c + 20
    img = Image.new("RGB", (int((W + D - ZN) * a + 40), int((W + D - ZN) * b + H * c + 40)), (24, 28, 40))
    dr = ImageDraw.Draw(img)

    def proj(x, y, z):
        return (ox + (x - (z - ZN)) * a, oy + (x + (z - ZN)) * b - y * c)

    order = []
    for y in range(H):
        for z in range(ZN, D):
            for x in range(W):
                k = g.get(x, y, z)
                if k == "air" or hidden(x, y, z):
                    continue
                if solid(x + 1, y, z) and solid(x, y + 1, z) and solid(x, y, z + 1):
                    continue
                order.append((x + y + z, y, x, z, k))
    order.sort()
    for _, y, x, z, k in order:
        rgb, shape = PALETTE[k][3], PALETTE[k][4]
        h = 1.0 if shape == "cube" else (0.12 if shape == "flat" else 1.0)
        inset = 0.38 if shape == "thin" else 0.0
        x0, x1, z0, z1 = x + inset, x + 1 - inset, z + inset, z + 1 - inset
        top = [proj(x0, y + h, z0), proj(x1, y + h, z0), proj(x1, y + h, z1), proj(x0, y + h, z1)]
        east = [proj(x1, y, z0), proj(x1, y + h, z0), proj(x1, y + h, z1), proj(x1, y, z1)]
        south = [proj(x0, y, z1), proj(x1, y, z1), proj(x1, y + h, z1), proj(x0, y + h, z1)]
        dr.polygon(east, fill=_shade(rgb, 0.78))
        dr.polygon(south, fill=_shade(rgb, 0.62))
        dr.polygon(top, fill=rgb)
    img.save(path)


def render_plan(path, scale=10):
    """top-down plan: highest block at or below the given layer"""
    img = Image.new("RGB", (W * scale, (D - ZN) * scale), (0, 0, 0))
    dr = ImageDraw.Draw(img)
    for z in range(ZN, D):
        for x in range(W):
            if z < 0:
                ymax = ACY - 1 if AX0 <= x <= AX1 and z >= AZ0 else H - 1
            else:
                ymax = CY - 1 if z <= BZ1 else H - 1
            for y in range(ymax, -1, -1):
                k = g.get(x, y, z)
                if k != "air":
                    f = 0.55 + 0.45 * (y / (CY - 1))
                    zz = z - ZN
                    dr.rectangle([x * scale, zz * scale, (x + 1) * scale - 1, (zz + 1) * scale - 1],
                                 fill=_shade(PALETTE[k][3], min(1.1, f)))
                    break
    img.save(path)


def main():
    build_all()
    path, files = build_pack()
    render_iso(os.path.join(HERE, "preview_outside.png"))
    render_iso(os.path.join(HERE, "preview_inside.png"), cut=True)
    render_plan(os.path.join(HERE, "preview_floorplan.png"))
    used = sorted(set(g.cells))
    print(f"wrote {path} ({os.path.getsize(path) // 1024} KB), {len(used)} block types")
    print(files["functions/chuckecheese.mcfunction"].decode())


if __name__ == "__main__":
    main()
