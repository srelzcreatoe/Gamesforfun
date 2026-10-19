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

reg("hardened_clay", "minecraft:hardened_clay", rgb=(152, 94, 67))
reg("slime", "minecraft:slime", rgb=(120, 200, 90))
reg("packed_ice", "minecraft:packed_ice", rgb=(150, 185, 245))
reg("bookshelf", "minecraft:bookshelf", rgb=(120, 90, 60))
reg("smooth_quartz", "minecraft:quartz_block", {"chisel_type": "smooth", "pillar_axis": "y"}, (240, 236, 230))
reg("lantern:stand", "minecraft:lantern", {"hanging": False}, (250, 200, 110), "thin")
reg("end_rod:west", "minecraft:end_rod", {"facing_direction": 4}, (245, 240, 230), "thin")
# buttons stuck on the side of a block: facing_direction = the way the button points
for _d, _v in {"north": 2, "south": 3, "west": 4, "east": 5}.items():
    reg(f"button:{_d}", "minecraft:stone_button", {"button_pressed_bit": False, "facing_direction": _v},
        (140, 140, 140), "thin")
# wooden doors (closed, open them by hand): direction 0 east, 1 south, 2 west, 3 north
for _d in range(4):
    for _half in ("lower", "upper"):
        reg(f"door:{_d}:{_half}", "minecraft:wooden_door",
            {"direction": _d, "door_hinge_bit": False, "open_bit": False, "upper_block_bit": _half == "upper"},
            (160, 125, 75), "thin")


# ---------------------------------------------------------------------------
# voxel grid
# ---------------------------------------------------------------------------

W, H, D = 96, 46, 92          # x (east), y (up), z (south edge, exclusive)
ZN = 0                        # north edge of the grid
GY = 2                        # ground / floor block layer
FY = 3                        # first walkable layer (feet)
CY = 13                       # ceiling + roof layer of the building
BZ1 = 63                      # front wall of the building (z); parking lot is south of it
BACK = 13                     # wall between the back-of-house strip (z 1..12) and the main floor
FRONT = 47                    # wall line between the main floor and the front rooms (z 48..62)
BCY = FY + 4                  # back-of-house ceiling (rooms are 4 tall, vents run above)
VY = BCY + 1                  # floor level the player walks on inside the vents


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


def draw_text(text, ox, oy, oz, right, key):
    """Text in a vertical plane. (ox, oy, oz) is the bottom-left block and
    `right` the (dx, dz) reading direction as seen by the viewer."""
    cursor = 0
    for ch in text:
        glyph = FONT[ch]
        for row, line in enumerate(glyph):
            for col, px in enumerate(line):
                if px == "#":
                    u = cursor + col
                    g.set(ox + right[0] * u, oy + 4 - row, oz + right[1] * u, key)
        cursor += len(glyph[0]) + 1


def draw_art(rows, ox, oy, oz, right, legend):
    """Pixel art in a vertical plane; rows top to bottom, '.' = untouched."""
    hgt = len(rows)
    for r, line in enumerate(rows):
        for c, px in enumerate(line):
            if px != ".":
                g.set(ox + right[0] * c, oy + (hgt - 1 - r), oz + right[1] * c, legend[px])


def ring_plane(cx, cy, z, r, key_fn, fill=None):
    """circle in the vertical plane z; key_fn(i) picks the colour of ring cell i"""
    i = 0
    for y in range(int(cy - r - 1), int(cy + r + 2)):
        for x in range(int(cx - r - 1), int(cx + r + 2)):
            d = math.hypot(x - cx, y - cy)
            if abs(d - r) <= 0.5:
                g.set(x, y, z, key_fn(i))
                i += 1
            elif fill and d < r - 0.5:
                g.set(x, y, z, fill)


MOUSE_LEGEND = {"E": "wool:gray", "P": "wool:pink", "C": "wool:purple", "G": "wool:light_gray",
                "W": "wool:white", "K": "wool:black", "N": "wool:black"}
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
MOUSE_FACE_SMALL = [
    "EE.......EE",
    "EPE.....EPE",
    "EPECCCCCEPE",
    ".EGCCCCCGE.",
    "..GGGGGGG..",
    "..GWKGKWG..",
    "..GGGGGGG..",
    "...GWNWG...",
    "....WWW....",
]


# ---------------------------------------------------------------------------
# outside: ground, parking lot, building shell, sign
# ---------------------------------------------------------------------------

def build_ground():
    g.fill(0, 0, ZN, W - 1, 1, D - 1, "dirt")
    g.fill(0, GY, ZN, W - 1, GY, D - 1, "grass")
    g.fill(0, GY, BZ1 + 1, W - 1, GY, BZ1 + 3, "smooth_stone")        # sidewalk
    g.fill(0, GY, BZ1 + 4, W - 1, GY, D - 2, "concrete:gray")          # asphalt
    for x in range(2, W - 1, 4):
        if 42 <= x <= 53:
            continue                      # keep the walkway to the doors clear
        g.fill(x, GY, BZ1 + 5, x, GY, BZ1 + 10, "concrete:white")
        g.fill(x, GY, D - 9, x, GY, D - 4, "concrete:white")
    for z in range(BZ1 + 4, D - 1):       # zebra walkway to the doors
        for x in range(44, 52):
            if z % 2 == 0 or x in (44, 51):
                g.set(x, GY, z, "concrete:white")


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
    g.fill(x, FY, z, x, FY + 4, z, "iron_bars")
    g.set(x, FY + 5, z, "sea_lantern")


def car(x, z, color):
    """little 3x5 car parked nose-in, front at z"""
    body = f"concrete:{color}"
    g.fill(x, FY, z, x + 2, FY + 1, z + 4, body)
    for (cx, cz) in ((x, z + 1), (x + 2, z + 1), (x, z + 3), (x + 2, z + 3)):
        g.set(cx, FY, cz, "concrete:black")
    g.fill(x, FY + 1, z + 1, x + 2, FY + 1, z + 3, "glass")
    g.fill(x, FY + 2, z + 1, x + 2, FY + 2, z + 3, body)
    g.set(x, FY + 1, z, "froglight_yellow")
    g.set(x + 2, FY + 1, z, "froglight_yellow")
    g.set(x, FY + 1, z + 4, "concrete:red")
    g.set(x + 2, FY + 1, z + 4, "concrete:red")


def build_lot():
    for x in (6, 22, 36, 60, 74, 90):
        g.fill(x - 1, GY, BZ1 + 2, x + 1, GY, BZ1 + 2, "grass")
        tree(x, BZ1 + 2)
    for x in (14, 30, 66, 82):
        lamp_post(x, BZ1 + 12)
        lamp_post(x, D - 11)
    for (x, z, c) in ((3, BZ1 + 5, "red"), (15, BZ1 + 5, "light_blue"), (27, BZ1 + 5, "yellow"),
                      (59, BZ1 + 5, "white"), (71, BZ1 + 5, "purple"), (83, BZ1 + 5, "lime"),
                      (7, D - 9, "orange"), (35, D - 9, "black"), (63, D - 9, "magenta"),
                      (79, D - 9, "blue")):
        car(x, z, c)
    # pylon sign at the lot entrance
    g.fill(89, FY, D - 3, 89, FY + 7, D - 3, "smooth_quartz")
    g.fill(84, FY + 8, D - 3, 94, FY + 17, D - 3, "concrete:purple")
    draw_art(MOUSE_FACE_SMALL, 84, FY + 9, D - 3, (1, 0), MOUSE_LEGEND)


def wall_key(y):
    if y <= GY + 1:
        return "concrete:gray"
    if y == CY - 2:
        return "concrete:orange"
    if y >= CY - 1:
        return "concrete:purple"
    return "concrete:white"


def build_shell():
    g.fill(1, GY, 1, W - 2, GY, BZ1 - 1, "concrete:white")
    for y in range(GY, CY + 1):
        for x in range(W):
            g.set(x, y, 0, wall_key(y))
            g.set(x, y, BZ1, wall_key(y))
        for z in range(BZ1 + 1):
            g.set(0, y, z, wall_key(y))
            g.set(W - 1, y, z, wall_key(y))
    g.fill(1, CY, 1, W - 2, CY, BZ1 - 1, "concrete:white")
    g.fill(1, CY + 1, 1, W - 2, CY + 1, BZ1 - 1, "smooth_stone")        # roof over the ceilings
    for y in (CY + 1, CY + 2):
        for x in range(W):
            g.set(x, y, 0, "concrete:light_gray")
            g.set(x, y, BZ1, "concrete:purple")
        for z in range(BZ1 + 1):
            g.set(0, y, z, "concrete:light_gray")
            g.set(W - 1, y, z, "concrete:light_gray")
    for (ax, az) in ((10, 6), (40, 8), (70, 30), (24, 32), (84, 50)):
        g.fill(ax, CY + 2, az, ax + 2, CY + 3, az + 1, "iron_block")
        g.set(ax + 1, CY + 3, az, "iron_bars")
    # neon stripe wrapping the sides and back
    for x in range(1, W - 1, 2):
        g.set(x, CY - 2, 0, "froglight_pink")
    for z in range(1, BZ1, 2):
        g.set(0, CY - 2, z, "froglight_pink")
        g.set(W - 1, CY - 2, z, "froglight_pink")

    # back of house: wall to the main floor, low ceiling, solid attic for the vents
    g.fill(1, FY, BACK, W - 2, CY - 1, BACK, "concrete:white")
    g.fill(1, BCY, 1, W - 2, CY - 1, BACK - 1, "smooth_stone")

    # storefront: glass either side of the doors, 4-wide doorway, awning
    g.fill(41, FY, BZ1, 56, FY + 6, BZ1, "glass_pane")
    g.fill(46, FY, BZ1, 49, FY + 3, BZ1, "air")
    g.fill(40, FY + 7, BZ1 + 1, 55, FY + 7, BZ1 + 3, "wool:purple")
    for x in range(40, 56):
        g.set(x, FY + 7, BZ1 + 4, "wool:orange" if x % 2 else "wool:purple")
    for x in (40, 55):
        g.fill(x, FY, BZ1 + 3, x, FY + 6, BZ1 + 3, "iron_bars")
    # windows: party rooms, ticket area, dining side wall
    for (x0, x1) in ((23, 27), (33, 37), (59, 66)):
        g.fill(x0, FY + 2, BZ1, x1, FY + 5, BZ1, "glass_pane")
    for z0 in (33, 39):
        g.fill(0, FY + 2, z0, 0, FY + 4, z0 + 3, "glass_pane")


def build_sign():
    """CHUCK E. CHEESE banner on the roof edge, round mouse logo above it"""
    text = "CHUCK E. CHEESE"
    tw = text_width(text)
    bx0 = (W - (tw + 4)) // 2
    bx1 = bx0 + tw + 3
    by0, by1 = CY + 1, CY + 8
    for y in range(by0, by1 + 1):
        for x in range(bx0, bx1 + 1):
            edge = y in (by0, by1) or x in (bx0, bx1)
            g.set(x, y, BZ1, "concrete:orange" if edge else "concrete:purple")
    for x in range(bx0, bx1 + 1, 6):
        g.fill(x, CY + 1, BZ1 - 1, x, by1 - 1, BZ1 - 1, "concrete:light_gray")
    draw_text(text, bx0 + 2, by0 + 2, BZ1, (1, 0), "concrete:yellow")
    for x in range(bx0 + 1, bx1, 3):
        g.set(x, by1, BZ1 - 1, "glowstone")
    # round logo: purple disc, yellow ring, mouse face
    cx, cy = W / 2 - 0.5, by1 + 11
    ring_plane(cx, cy, BZ1, 9.5, lambda i: "concrete:yellow", fill="concrete:purple")
    draw_art(MOUSE_FACE, int(cx - 7), int(cy - 6), BZ1, (1, 0), MOUSE_LEGEND)
    g.fill(int(cx) - 1, by1 + 1, BZ1 - 1, int(cx) + 1, int(cy), BZ1 - 1, "concrete:light_gray")


# ---------------------------------------------------------------------------
# floors and ceilings
#   back of house  z 1..12 : backstage x1-45, restrooms x47-58, security x59-76,
#                            manager's office x77-85, break room x87-94
#   main floor     z 14..46: showroom + dining x1-45, game room x47-94
#   front rooms    z 48..62: kitchen x1-19, party rooms x21-29 / x31-39,
#                            lobby x41-56, ticket blaster x58-67, prizes x68-94
# ---------------------------------------------------------------------------

def showroom_carpet():
    r = rng.random()
    if r < 0.06:
        return rng.choice(["concrete:yellow", "concrete:magenta", "concrete:lime", "concrete:orange"])
    return "concrete:purple" if r < 0.35 else "concrete:blue"


def arcade_carpet():
    r = rng.random()
    if r < 0.06:
        return rng.choice(["concrete:lime", "concrete:yellow", "concrete:magenta", "concrete:light_blue"])
    return "concrete:blue" if r < 0.3 else "concrete:black"


def build_floors_and_ceilings():
    for z in range(BACK + 1, BZ1):
        for x in range(1, W - 1):
            if z < FRONT:
                key = showroom_carpet() if x <= 46 else arcade_carpet()
            elif x <= 19:
                key = "concrete:light_gray" if (x + z) % 2 else "concrete:white"        # kitchen
            elif 21 <= x <= 29:
                key = "concrete:pink" if (x // 2 + z // 2) % 2 else "concrete:purple"   # party 1
            elif 31 <= x <= 39:
                key = "concrete:yellow" if (x // 2 + z // 2) % 2 else "concrete:light_blue"  # party 2
            elif 41 <= x <= 56:
                edge = x in (41, 56) or z == BZ1 - 1
                key = "concrete:purple" if edge else "smooth_quartz"                     # lobby
            else:
                key = arcade_carpet()
            g.set(x, GY, z, key)
            g.set(x, CY, z, "concrete:black" if x >= 47 else "concrete:white")
    for z in range(BACK + 3, BZ1, 5):
        for x in range(3, W - 1, 5):
            g.set(x, CY, z, "sea_lantern")


# ---------------------------------------------------------------------------
# showroom: Circles-of-Light style stage with the whole band, dance floor,
# giant LED video wall and the dining room
# ---------------------------------------------------------------------------

def place_bot(bot, x0, y0, zfront):
    """animatronic facing south; front layer at zfront, back layer behind it"""
    for layer, z in (("back", zfront - 1), ("front", zfront)):
        rows = bot[layer]
        for r, line in enumerate(rows):
            for c, px in enumerate(line):
                if px != ".":
                    g.set(x0 + c, y0 + (len(rows) - 1 - r), z, bot["legend"][px])


CHUCK = {   # the mouse: purple cap and shirt, jeans, red sneakers
    "front": ["EE...EE", "EPCCCPE", ".GGGGG.", ".GKGKG.", ".GWNWG.", "ASSSSSA", ".SSSSS.", "..L.L..",
              "..F.F.."],
    "back": ["EE...EE", "EECCCEE", ".GGGGG.", ".GGGGG.", ".GGGGG.", ".SSSSS.", ".SSSSS.", "..L.L..",
             "..F.F.."],
    "legend": {"E": "wool:light_gray", "P": "wool:pink", "C": "wool:purple", "G": "wool:light_gray",
               "K": "wool:black", "W": "wool:white", "N": "wool:pink", "A": "wool:light_gray",
               "S": "wool:purple", "L": "wool:blue", "F": "wool:red"},
}
HELEN = {   # the chicken singer
    "front": ["..R..", ".WWW.", ".KWK.", ".WYW.", "WPPPW", "WPPPW", ".PPP.", ".O.O."],
    "back": ["..R..", ".WWW.", ".WWW.", ".WWW.", "WWWWW", "WPPPW", ".PPP.", ".O.O."],
    "legend": {"R": "wool:red", "W": "wool:white", "K": "wool:black", "Y": "wool:orange",
               "P": "wool:pink", "O": "wool:orange"},
}
MUNCH = {   # the purple monster on keyboards
    "front": ["P.....P", "PPPPPPP", "PWKPKWP", "PPPPPPP", "PRRRRRP", "PPPPPPP", ".PPPPP.", ".G...G."],
    "back": ["P.....P", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP", ".PPPPP.", ".G...G."],
    "legend": {"P": "wool:purple", "W": "wool:white", "K": "wool:black", "R": "wool:red", "G": "wool:lime"},
}
JASPER = {  # the hound dog with his cowboy hat and guitar
    "front": ["..HHH..", ".HHHHH.", "E.TTT.E", "ETKTKTE", "E.TNT.E", ".VVVVV.", "AVGGGVA", "..L.L..",
              "..F.F.."],
    "back": ["..HHH..", ".HHHHH.", "E.TTT.E", "ETTTTTE", "E.TTT.E", ".VVVVV.", ".VVVVV.", "..L.L..",
             "..F.F.."],
    "legend": {"H": "wool:brown", "E": "wool:brown", "T": "hardened_clay", "K": "wool:black",
               "N": "wool:black", "V": "wool:red", "A": "hardened_clay", "G": "dark_oak_planks",
               "L": "wool:blue", "F": "wool:brown"},
}
PASQUALLY = {  # the chef on drums
    "front": [".WWWWW.", ".WWWWW.", ".SSSSS.", ".SKSKS.", "SMMMMMS", ".WRRRW.", "AWWWWWA", ".WWWWW.",
              "..L.L.."],
    "back": [".WWWWW.", ".WWWWW.", ".SSSSS.", ".SSSSS.", ".SSSSS.", ".WRRRW.", ".WWWWW.", ".WWWWW.",
             "..L.L.."],
    "legend": {"W": "wool:white", "S": "wool:pink", "K": "wool:black", "M": "wool:black", "R": "wool:red",
               "A": "wool:pink", "L": "wool:black"},
}


def build_stage():
    z0 = BACK + 1                                       # stage backs onto the back-of-house wall
    # main stage (x 12..36) and the two raised side stages
    g.fill(12, FY, z0, 36, FY, z0 + 7, "dark_oak_planks")
    g.fill(12, FY, z0 + 7, 36, FY, z0 + 7, "concrete:black")
    for x in range(13, 36, 3):
        g.set(x, FY, z0 + 7, "froglight_yellow")         # footlights
    for x in range(22, 27):
        g.set(x, FY, z0 + 8, "stairs:dark_oak:north")
    for (x0, x1) in ((3, 10), (37, 44)):
        g.fill(x0, FY, z0, x1, FY + 1, z0 + 5, "dark_oak_planks")
        g.fill(x0, FY + 1, z0 + 5, x1, FY + 1, z0 + 5, "concrete:black")
    # Circles of Light: a big glowing ring behind Chuck E. and two small ones
    ring_plane(24, 8, z0, 4.5, lambda i: "froglight_pink" if i % 2 else "froglight_yellow")
    ring_plane(16.5, 8.5, z0, 2, lambda i: "froglight_green")
    ring_plane(31.5, 8.5, z0, 2, lambda i: "froglight_green")
    for x in range(12, 37):                              # colourful lit overhang
        g.set(x, CY - 1, z0 + 7, ["froglight_pink", "froglight_green", "froglight_yellow"][x % 3])
    # the band
    place_bot(JASPER, 13, FY + 1, z0 + 3)
    place_bot(CHUCK, 21, FY + 1, z0 + 3)
    place_bot(PASQUALLY, 29, FY + 1, z0 + 3)
    place_bot(HELEN, 4, FY + 2, z0 + 3)
    place_bot(MUNCH, 37, FY + 2, z0 + 3)
    g.fill(24, FY + 1, z0 + 4, 24, FY + 2, z0 + 4, "end_rod")       # Chuck E.'s microphone
    g.fill(6, FY + 2, z0 + 4, 6, FY + 3, z0 + 4, "end_rod")         # Helen's microphone
    for x in (30, 32, 34):                                           # Pasqually's drums
        g.set(x, FY + 1, z0 + 4, "concrete:red")
        g.set(x, FY + 2, z0 + 4, "carpet:white")
    g.fill(37, FY + 2, z0 + 4, 43, FY + 2, z0 + 4, "quartz")         # Munch's keyboard
    for x in range(37, 44, 2):
        g.set(x, FY + 3, z0 + 4, "carpet:black")


def build_dance_floor_and_video_wall():
    colors = ["magenta", "light_blue", "yellow", "lime"]
    for z in range(BACK + 10, BACK + 17):
        for x in range(13, 36):
            g.set(x, 1, z, "sea_lantern")                                 # lights under the glass
            g.set(x, GY, z, f"glass:{colors[(x // 2 + z // 2) % 4]}")
    # giant LED video wall on the west wall, facing the dance floor
    z0, z1 = BACK + 9, BACK + 23
    g.fill(1, FY, z0, 1, CY - 1, z1, "concrete:black")
    g.fill(1, FY + 1, z0 + 1, 1, CY - 1, z1 - 1, "concrete:light_blue")
    for z in range(z0 + 1, z1):
        g.set(1, FY + 1, z, ["concrete:magenta", "concrete:yellow", "concrete:lime"][z % 3])
    draw_art(MOUSE_FACE_SMALL, 1, FY + 1, z1 - 2, (0, -1), MOUSE_LEGEND)


def party_table(x0, z, length, cloth):
    for x in range(x0, x0 + length):
        g.set(x, FY, z, "quartz")
        g.set(x, FY, z - 1, "stairs:purpur:north")
        g.set(x, FY, z + 1, "stairs:purpur:south")
        g.set(x, FY + 1, z, f"carpet:{cloth}")
    for x in range(x0 + 1, x0 + length, 2):
        g.set(x, FY + 1, z, "carpet:yellow")            # pizzas


def build_dining():
    for row, z in enumerate((BACK + 19, BACK + 24, BACK + 29)):
        for x0 in (3, 10, 17, 24, 31):
            party_table(x0, z, 5, ["red", "blue", "red"][row])
    # salad bar with a sneeze guard
    toppings = ["lime", "red", "orange", "yellow", "brown", "white", "lime"]
    for i, z in enumerate(range(BACK + 18, BACK + 25)):
        g.fill(39, FY, z, 40, FY, z, "quartz")
        g.fill(39, FY + 1, z, 40, FY + 1, z, f"carpet:{toppings[i]}")
    for z in (BACK + 18, BACK + 24):
        g.fill(39, FY + 1, z, 40, FY + 2, z, "iron_bars")
    g.fill(39, FY + 3, BACK + 18, 40, FY + 3, BACK + 24, "glass")
    # drink station
    g.fill(39, FY, BACK + 27, 40, FY, BACK + 31, "iron_block")
    g.fill(40, FY + 1, BACK + 28, 40, FY + 2, BACK + 30, "concrete:red")
    g.set(40, FY + 2, BACK + 29, "froglight_yellow")
    for z in range(BACK + 28, BACK + 31):
        g.set(39, FY + 1, z, "button")


# ---------------------------------------------------------------------------
# game room, trampoline zone, play structure
# ---------------------------------------------------------------------------

BODY_COLORS = ["purple", "blue", "red", "black", "lime", "orange", "magenta", "cyan"]
SCREENS = ["sea_lantern", "froglight_green", "froglight_pink", "froglight_yellow", "glowstone",
           "shroomlight"]


def cabinet(x, zfront, facing, n):
    """arcade cabinet; the player stands one block beyond zfront"""
    zback = zfront - 1 if facing == "south" else zfront + 1
    body = f"concrete:{BODY_COLORS[n % len(BODY_COLORS)]}"
    g.set(x, FY, zfront, body)
    g.set(x, FY + 1, zfront, "lever" if n % 2 == 0 else "button")
    g.set(x, FY, zback, body)
    g.set(x, FY + 1, zback, SCREENS[n % len(SCREENS)])
    g.set(x, FY + 2, zback, body)
    g.set(x, FY + 3, zback, f"glass:{BODY_COLORS[(n + 3) % len(BODY_COLORS)]}")


def claw_machine(x0, z0, color):
    g.fill(x0, FY, z0, x0 + 3, FY, z0 + 3, f"concrete:{color}")
    g.fill(x0, FY + 1, z0, x0 + 3, FY + 3, z0 + 3, "glass")
    prizes = ["wool:pink", "wool:yellow", "wool:light_blue", "wool:lime"]
    for i, (dx, dz) in enumerate(((1, 1), (2, 1), (1, 2), (2, 2))):
        g.set(x0 + dx, FY + 1, z0 + dz, prizes[i])
        g.set(x0 + dx, FY + 2, z0 + dz, "air")
        g.set(x0 + dx, FY + 3, z0 + dz, "air")
    g.set(x0 + 1, FY + 3, z0 + 2, "iron_bars")
    g.fill(x0, FY + 4, z0, x0 + 3, FY + 4, z0 + 3, f"concrete:{color}")
    g.set(x0 + 1, FY + 5, z0 + 1, "glowstone")


def skeeball_lane(x, zb, zp):
    """lane runs north to the targets at zb; the player rolls from zp"""
    g.fill(x - 1, FY, zb, x - 1, FY + 1, zp - 1, "concrete:red")
    g.fill(x + 1, FY, zb, x + 1, FY + 1, zp - 1, "concrete:red")
    g.fill(x, FY, zb + 7, x, FY, zp - 1, "stone_slab")
    g.fill(x, FY, zb + 4, x, FY, zb + 6, "smooth_stone")
    g.fill(x, FY, zb + 1, x, FY + 2, zb + 3, "air")
    g.set(x, FY, zb + 2, "target")
    g.set(x, FY + 1, zb + 1, "target")
    g.fill(x - 1, FY, zb, x + 1, FY + 4, zb, "concrete:black")
    g.set(x, FY + 3, zb, "glowstone")


def hoop_lane(x0, zb, zp):
    """basketball hoop shoot, 2 wide, net cage, backboard at zb"""
    for x in (x0 - 1, x0 + 2):
        g.fill(x, FY, zb, x, FY + 6, zp - 1, "pane:black")
    g.fill(x0, FY, zb + 3, x0 + 1, FY, zp - 1, "stone_slab")
    g.fill(x0, FY, zb, x0 + 1, FY + 2, zb, "concrete:black")
    g.fill(x0, FY + 3, zb, x0 + 1, FY + 5, zb, "concrete:white")
    g.fill(x0, FY + 4, zb, x0 + 1, FY + 4, zb, "concrete:red")
    g.fill(x0, FY + 3, zb + 1, x0 + 1, FY + 3, zb + 1, "iron_bars")      # the rim
    g.fill(x0, FY + 6, zb, x0 + 1, FY + 6, zb, "froglight_pink")         # score lights
    g.fill(x0, FY, zp - 1, x0 + 1, FY, zp - 1, "concrete:black")         # ball tray
    g.fill(x0, FY + 1, zp - 1, x0 + 1, FY + 1, zp - 1, "carpet:orange")


def bass_wheel(cx, cy, z):
    """big prize wheel facing south, with a pull lever on a pedestal"""
    colors = ["wool:red", "wool:yellow", "wool:blue", "wool:lime", "wool:magenta", "wool:orange",
              "wool:light_blue", "wool:white"]
    for y in range(cy - 5, cy + 6):
        for x in range(cx - 5, cx + 6):
            d = math.hypot(x - cx, y - cy)
            if d <= 4.5:
                seg = int((math.atan2(y - cy, x - cx) + math.pi) / (2 * math.pi) * 8) % 8
                g.set(x, y, z, colors[seg] if d > 0.7 else "gold_block")
            elif d <= 5.3 and y < CY:
                g.set(x, y, z, "froglight_yellow")
    g.set(cx + 6, cy, z + 1, "end_rod:west")                            # the pointer
    g.fill(cx - 2, FY, z, cx + 2, cy - 5, z, "concrete:black")
    g.set(cx, FY, z + 3, "iron_block")
    g.set(cx, FY + 1, z + 3, "lever")


def racer(x, z0, n):
    """sit-down driving game: screen at z0, wheel, seat"""
    color = f"concrete:{BODY_COLORS[n % len(BODY_COLORS)]}"
    g.set(x, FY, z0, color)
    g.set(x, FY + 1, z0, SCREENS[n % len(SCREENS)])
    g.set(x, FY + 2, z0, color)
    g.set(x, FY, z0 + 1, "concrete:black")
    g.set(x, FY + 1, z0 + 1, "lever")
    g.set(x, FY, z0 + 2, "stairs:quartz:south")


def air_hockey(x0, z0):
    """table running east-west, 5 long and 2 wide"""
    g.fill(x0, FY, z0, x0 + 4, FY, z0 + 1, "concrete:white")
    g.fill(x0, FY, z0, x0, FY, z0 + 1, "concrete:blue")
    g.fill(x0 + 4, FY, z0, x0 + 4, FY, z0 + 1, "concrete:red")
    g.set(x0 + 2, FY + 1, z0, "button")                                  # the puck


def kiddie_horse(x, z):
    g.set(x, FY, z, "dark_oak_fence")
    g.set(x, FY + 1, z, "wool:white")
    g.set(x, FY + 1, z + 1, "wool:white")
    g.set(x, FY + 2, z, "wool:white")
    g.set(x, FY + 2, z + 1, "carpet:red")


def build_game_room():
    # signs over the back wall
    g.fill(62, CY - 5, BACK, 84, CY - 1, BACK, "concrete:black")
    draw_text("GAMES", 63, CY - 5, BACK, (1, 0), "froglight_pink")
    # skee-ball (4 lanes) and basketball (2 lanes) along the back
    for x in (49, 51, 53, 55):
        skeeball_lane(x, BACK + 4, BACK + 16)
    hoop_lane(58, BACK + 4, BACK + 14)
    hoop_lane(62, BACK + 4, BACK + 14)
    bass_wheel(70, 8, BACK + 5)
    for i, x in enumerate(range(66, 77, 2)):
        racer(x, BACK + 12, i)
    # arcade cabinets: two double rows
    n = 0
    for (zn, zs) in ((BACK + 18, BACK + 21), (BACK + 24, BACK + 27)):
        for x in range(49, 76):
            if x in (55, 62, 69):
                continue
            cabinet(x, zn, "north", n)
            cabinet(x, zs, "south", n + 1)
            n += 2
    # front row: air hockey, whac-a-mole, claws, kiddie rides
    zr = BACK + 29                                                       # front row
    air_hockey(49, zr + 1)
    air_hockey(49, zr + 4)
    g.fill(55, FY, zr + 2, 56, FY, zr + 3, "concrete:lime")              # whac-a-mole
    for (x, z) in ((55, zr + 2), (56, zr + 2), (55, zr + 3), (56, zr + 3)):
        g.set(x, FY + 1, z, "button")
    g.fill(55, FY, zr + 1, 56, FY + 2, zr + 1, "concrete:black")
    g.set(55, FY + 2, zr + 1, "froglight_green")
    for i, x0 in enumerate((58, 63, 68)):
        claw_machine(x0, zr, ["yellow", "red", "light_blue"][i])
    kiddie_horse(73, zr + 1)
    kiddie_horse(75, zr + 1)


def build_trampolines():
    """Trampoline Zone: slime-block trampolines inside a net"""
    for z in range(BACK + 1, BACK + 15):
        for x in range(79, W - 1):
            pad = (x - 79) % 4 == 3 or (z - BACK - 1) % 4 == 3
            g.set(x, GY, z, "wool:blue" if pad else "slime")
    g.fill(78, FY, BACK + 1, 78, FY + 4, BACK + 15, "pane:black")
    g.fill(78, FY, BACK + 15, W - 2, FY + 4, BACK + 15, "pane:black")
    g.fill(78, FY, BACK + 11, 78, FY + 2, BACK + 12, "air")             # gate
    for y in range(FY, FY + 5):                                           # height-check post
        g.set(77, y, BACK + 10, "concrete:yellow" if y % 2 else "concrete:black")


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
    for y in range(FY, max(levels) + 1):
        g.set(lx, y, lz, f"ladder:{face}")
        g.set(lx + back[0], y, lz + back[1], f"concrete:{post}")


def tube_z(z0, z1, x0, floor_y, color):
    """tube running north-south, 2 wide (x0, x0+1) and 2 tall inside"""
    for z in range(min(z0, z1), max(z0, z1) + 1):
        shell = f"concrete:{color}" if z % 3 == 0 else f"glass:{color}"
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
        for side in (z0 - 1, z0 + 2):
            g.set(x, y, side, "concrete:yellow")
            g.set(x, y + 1, side, "concrete:yellow")
        x -= 1


def build_play_structure():
    """SkyTubes-style play area: ball pit, two towers, a tube and two slides"""
    zo = BACK + 16
    g.fill(78, FY, zo, 78, FY + 2, FRONT - 1, "pane:light_blue")
    g.fill(78, FY, FRONT - 1, W - 2, FY + 2, FRONT - 1, "pane:light_blue")
    g.fill(78, FY, zo + 6, 78, FY + 2, zo + 7, "air")                   # entrance
    for z in range(zo, FRONT - 1):
        for x in range(79, W - 1):
            g.set(x, GY, z, ["wool:red", "wool:blue", "wool:yellow", "wool:lime"][(x // 3 + z // 3) % 4])
    # ball pit, sunk two blocks
    px0, px1, pz0, pz1 = 81, 88, zo + 2, FRONT - 4
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
    g.fill(px0 - 1, FY, zo + 6, px0 - 1, FY, zo + 7, "air")
    # tower A (north) and tower B (south) joined by a tube on the top level
    ta, tb = zo + 1, FRONT - 6
    tower(90, ta, "red", (FY + 3, FY + 6), (92, ta + 1, "south"))
    tower(90, tb, "orange", (FY + 3, FY + 6), (92, tb + 2, "north"))
    g.fill(91, FY + 7, ta + 3, 92, FY + 8, ta + 3, "air")
    g.fill(91, FY + 7, tb, 92, FY + 8, tb, "air")
    tube_z(ta + 4, tb - 1, 91, FY + 6, "light_blue")
    # slides: from A's top level into the ball pit, from B's lower level too
    g.fill(90, FY + 7, ta + 1, 90, FY + 8, ta + 2, "air")
    slide_west(89, ta + 1, FY + 6, FY)
    g.fill(90, FY + 4, tb + 1, 90, FY + 5, tb + 2, "air")
    slide_west(89, tb + 1, FY + 3, FY)


# ---------------------------------------------------------------------------
# front rooms: kitchen, party rooms, lobby with Kid Check, ticket blaster,
# photo booth, prize counter
# ---------------------------------------------------------------------------

def build_front_walls():
    g.fill(1, FY, FRONT, 40, CY - 1, FRONT, "concrete:white")
    g.fill(20, FY, FRONT + 1, 20, CY - 1, BZ1 - 1, "concrete:white")
    g.fill(30, FY, FRONT + 1, 30, CY - 1, BZ1 - 1, "concrete:white")
    g.fill(40, FY, FRONT + 1, 40, CY - 1, BZ1 - 1, "concrete:purple")
    g.fill(57, FY, FRONT + 5, 57, CY - 1, BZ1 - 1, "concrete:purple")
    for x0 in (24, 34):                                                  # party room doorways
        g.fill(x0, FY, FRONT, x0 + 2, FY + 2, FRONT, "air")
        g.fill(x0, FY + 3, FRONT, x0 + 2, FY + 3, FRONT, "concrete:yellow")


def conveyor_oven(x0, z):
    g.fill(x0, FY, z, x0 + 6, FY, z + 1, "iron_block")
    g.fill(x0, FY + 1, z, x0, FY + 1, z + 1, "stone_slab")
    g.fill(x0 + 6, FY + 1, z, x0 + 6, FY + 1, z + 1, "stone_slab")
    g.fill(x0 + 1, FY + 1, z, x0 + 5, FY + 2, z + 1, "iron_block")
    g.fill(x0 + 2, FY + 1, z, x0 + 4, FY + 1, z, "magma")                # glowing belt slot
    g.fill(x0, FY + 5, z - 1, x0 + 6, FY + 5, z + 1, "iron_block")      # hood
    g.fill(x0 + 3, FY + 6, z, x0 + 3, CY - 1, z, "iron_bars")


def build_kitchen():
    # order counter facing the dining room, with the menu board above
    g.fill(3, FY, FRONT, 15, FY, FRONT, "quartz")
    g.fill(3, FY + 1, FRONT, 15, FY + 2, FRONT, "air")
    for x in (6, 12):
        g.set(x, FY + 1, FRONT, "iron_block")
        g.set(x, FY + 2, FRONT, "button")
    g.fill(1, FY + 3, FRONT, 19, CY - 1, FRONT, "concrete:black")
    draw_text("PIZZA", 19, FY + 4, FRONT, (-1, 0), "concrete:yellow")
    g.set(18, FY, FRONT, "door:1:lower")
    g.set(18, FY + 1, FRONT, "door:1:upper")
    conveyor_oven(3, BZ1 - 3)
    conveyor_oven(11, BZ1 - 3)
    g.fill(6, FY, FRONT + 5, 14, FY, FRONT + 6, "smooth_stone")          # make line
    for i, x in enumerate(range(6, 15)):
        g.set(x, FY + 1, FRONT + 5, ["carpet:white", "carpet:red", "carpet:yellow"][i % 3])
    g.fill(1, FY, FRONT + 8, 5, FY + 4, FRONT + 12, "packed_ice")        # walk-in cooler
    g.fill(2, FY, FRONT + 9, 4, FY + 3, FRONT + 11, "air")
    g.fill(5, FY, FRONT + 10, 5, FY + 1, FRONT + 10, "air")
    for z in (FRONT + 9, FRONT + 11):
        g.fill(2, FY, z, 2, FY + 2, z, "iron_block")
    g.fill(16, FY, FRONT + 8, 19, FY, FRONT + 10, "quartz")              # dish pit
    for z in (FRONT + 8, FRONT + 10):
        g.set(16, FY + 1, z, "lever")
    g.fill(1, FY, FRONT + 2, 1, FY + 3, FRONT + 3, "concrete:white")     # pizza box towers
    g.set(1, FY + 4, FRONT + 2, "carpet:red")
    g.set(1, FY + 4, FRONT + 3, "carpet:red")


def party_room(x0, x1, theme):
    zt = FRONT + 7
    for x in range(x0 + 2, x1):
        g.fill(x, FY, zt, x, FY, zt + 1, "quartz")
        g.set(x, FY, zt - 1, "stairs:purpur:north")
        g.set(x, FY, zt + 2, "stairs:purpur:south")
        g.fill(x, FY + 1, zt, x, FY + 1, zt + 1, f"carpet:{theme}")
    g.set(x0 + 3, FY + 1, zt, "candle_cake")
    g.set(x0 + 5, FY + 1, zt + 1, "cake")
    # birthday star throne at the head of the table
    g.set(x0 + 1, FY, zt, "stairs:smooth_sandstone:west")
    g.fill(x0, FY, zt, x0, FY + 2, zt, "gold_block")
    g.set(x0, FY + 3, zt, "glowstone")
    balloons = ["wool:red", "wool:yellow", "wool:light_blue", "wool:lime", "wool:pink", "wool:orange"]
    for i, (x, z) in enumerate(((x0, FRONT + 1), (x1, FRONT + 1), (x0, BZ1 - 1), (x1, BZ1 - 1),
                                (x0 + 4, FRONT + 2), (x1 - 1, FRONT + 12))):
        g.set(x, CY - 2, z, balloons[i % len(balloons)])
        g.set(x, CY - 3, z, balloons[(i + 2) % len(balloons)])
        g.fill(x, FY + 3, z, x, CY - 4, z, "dark_oak_fence")
    for (x, z, box, bow) in ((x1, FRONT + 4, "red", "yellow"), (x1, FRONT + 5, "blue", "pink"),
                             (x0, BZ1 - 2, "lime", "red")):
        g.set(x, FY, z, f"wool:{box}")
        g.set(x, FY + 1, z, f"carpet:{bow}")


def build_lobby():
    # vestibule: glass walls and inner doorway
    g.fill(43, FY, BZ1 - 4, 52, FY + 6, BZ1 - 4, "glass")
    g.fill(43, FY, BZ1 - 3, 43, FY + 6, BZ1 - 1, "glass")
    g.fill(52, FY, BZ1 - 3, 52, FY + 6, BZ1 - 1, "glass")
    g.fill(46, FY, BZ1 - 4, 49, FY + 3, BZ1 - 4, "air")
    g.fill(43, FY + 7, BZ1 - 4, 52, FY + 7, BZ1 - 1, "concrete:purple")
    # welcome wall with the mouse, to walk around
    g.fill(44, FY, FRONT + 2, 54, CY - 1, FRONT + 2, "concrete:purple")
    draw_art(MOUSE_FACE_SMALL, 44, FY, FRONT + 2, (1, 0), MOUSE_LEGEND)
    g.fill(44, CY - 1, FRONT + 2, 54, CY - 1, FRONT + 2, "froglight_yellow")
    # Kid Check desk: everyone gets a matching hand stamp
    g.fill(55, FY, FRONT + 5, 55, FY, FRONT + 9, "concrete:purple")
    g.set(55, FY + 1, FRONT + 6, "button")                               # the stamp
    g.set(55, FY + 1, FRONT + 8, "lantern:stand")
    g.set(56, FY, FRONT + 7, "stairs:quartz:east")
    # Play Pass kiosks
    for z in (FRONT + 6, FRONT + 9):
        g.set(41, FY, z, "iron_block")
        g.set(41, FY + 1, z, "sea_lantern")
        g.set(42, FY + 1, z, "button:east")
        g.set(41, FY + 2, z, "concrete:orange")


def build_ticket_blaster_and_photo_booth():
    # Ticket Blaster: step in, tickets fly around
    x0, z0 = 59, FRONT + 6
    g.fill(x0, FY, z0, x0 + 3, FY + 3, z0 + 3, "glass")
    g.fill(x0 + 1, FY, z0 + 1, x0 + 2, FY + 3, z0 + 2, "air")
    g.fill(x0 + 1, FY, z0, x0 + 2, FY + 1, z0, "air")
    g.fill(x0, FY + 4, z0, x0 + 3, FY + 4, z0 + 3, "concrete:orange")
    g.fill(x0 + 1, FY + 4, z0 + 1, x0 + 2, FY + 4, z0 + 2, "iron_bars")  # the fan
    g.set(x0 + 1, FY + 5, z0 + 1, "glowstone")
    for (dx, dz) in ((1, 1), (2, 2), (2, 1)):
        g.set(x0 + dx, FY, z0 + dz, "carpet:yellow" if dx == dz else "carpet:orange")
    # photo booth with a curtain
    x0 = 63
    g.fill(x0, FY, z0, x0 + 3, FY + 3, z0 + 3, "concrete:purple")
    g.fill(x0 + 1, FY, z0 + 1, x0 + 2, FY + 2, z0 + 2, "air")
    g.fill(x0 + 1, FY, z0, x0 + 1, FY + 1, z0, "air")
    g.fill(x0 + 2, FY, z0, x0 + 2, FY + 1, z0, "wool:red")
    g.fill(x0 + 1, FY, z0 + 2, x0 + 2, FY, z0 + 2, "stairs:dark_oak:south")
    g.set(x0 + 1, FY + 2, z0, "froglight_yellow")
    g.set(x0 + 2, FY + 2, z0, "froglight_yellow")


def build_prize_counter():
    for x in range(69, 93):
        g.set(x, FY, FRONT + 3, "quartz")
        g.set(x, FY + 1, FRONT + 3, "glass")
    for x in range(70, 92, 3):
        g.set(x, FY + 2, FRONT + 3,
              ["candle:red", "candle:yellow", "candle:light_blue", "candle:white"][x % 4])
    # ticket munchers in front of the counter
    for x in (72, 77, 82):
        g.set(x, FY, FRONT + 1, "iron_block")
        g.set(x, FY + 1, FRONT + 1, "froglight_green")
        g.set(x, FY + 1, FRONT, "button:north")
    # prize wall with PRIZES over it
    for x in range(68, W - 1):
        for y in range(FY, FY + 4):
            g.set(x, y, BZ1 - 1, "oak_planks" if y % 2 == 1 else
                  rng.choice(BALL_COLORS + ["sea_lantern", "gold_block"]))
    g.fill(68, FY + 4, BZ1 - 1, W - 2, CY - 1, BZ1 - 1, "concrete:purple")
    draw_text("PRIZES", 92, FY + 5, BZ1 - 1, (-1, 0), "concrete:yellow")
    # giant teddy bears
    for (bx, color) in ((70, "brown"), (89, "pink")):
        bz = BZ1 - 3
        g.fill(bx, FY, bz, bx + 2, FY + 3, bz, f"wool:{color}")
        g.set(bx, FY + 4, bz, f"wool:{color}")                              # ears
        g.set(bx + 2, FY + 4, bz, f"wool:{color}")
        g.set(bx, FY + 3, bz - 1, "wool:black")                             # eyes
        g.set(bx + 2, FY + 3, bz - 1, "wool:black")
        g.set(bx + 1, FY + 2, bz - 1, "wool:white")                         # snout


# ---------------------------------------------------------------------------
# back of house (z 1..12): backstage, restrooms, security office, manager's
# office, break room. Rooms are 4 tall; vents run in the attic above.
# ---------------------------------------------------------------------------

def room(x0, z0, x1, z1):
    g.fill(x0, FY, z0, x1, BCY - 1, z1, "air")


def door(x, z, direction):
    g.set(x, FY, z, f"door:{direction}:lower")
    g.set(x, FY + 1, z, f"door:{direction}:upper")


def ceiling_light(x, z):
    g.set(x, BCY, z, "sea_lantern")


def build_back_of_house_shell():
    # solid block, rooms carved out below
    g.fill(1, FY, 1, W - 2, BCY - 1, BACK - 1, "concrete:light_gray")
    for z in range(1, BACK):
        for x in range(1, W - 1):
            g.set(x, GY, z, "concrete:light_gray" if (x + z) % 2 else "concrete:gray")


def build_backstage():
    room(1, 1, 13, 12)                     # storage
    room(15, 1, 28, 12)                    # costume room
    room(30, 1, 45, 12)                    # show control room
    door(14, 10, 0)                        # clear of the dressing mirror
    door(29, 6, 0)
    door(45, BACK, 1)                      # staff door from the showroom
    for (x, z) in ((7, 6), (21, 6), (37, 6)):
        ceiling_light(x, z)
    # storage: shelves of boxes and spare parts
    for x in range(2, 13):
        g.fill(x, FY, 1, x, FY + 2, 1, "oak_planks" if x % 3 else "iron_block")
        g.set(x, FY + 3, 1, rng.choice(BALL_COLORS))
    for (x, z) in ((3, 5), (4, 5), (3, 6), (10, 9), (11, 9)):
        g.fill(x, FY, z, x, FY + 1, z, "oak_planks")
    g.set(8, FY, 10, "pumpkin_face:south")                 # spare animatronic heads
    g.set(9, FY, 10, "pumpkin_face:south")
    # costume room: Chuck E.'s walk-around costume, dressing mirror, costume rack
    g.fill(21, FY, 1, 23, FY, 1, "dark_oak_planks")
    g.set(22, FY + 1, 1, "wool:light_gray")
    g.set(22, FY + 2, 1, "wool:purple")
    g.set(21, FY + 2, 1, "wool:light_gray")
    g.set(23, FY + 2, 1, "wool:light_gray")
    g.fill(15, FY + 1, 4, 15, FY + 2, 7, "iron_block")      # mirror
    for z in range(3, 9):
        g.set(15, FY + 3, z, "glowstone")
    g.fill(15, FY + 1, 3, 15, FY + 2, 3, "glowstone")
    g.fill(15, FY + 1, 8, 15, FY + 2, 8, "glowstone")
    g.fill(17, FY, 4, 17, FY, 7, "stairs:dark_oak:east")
    g.fill(17, FY + 3, 11, 27, FY + 3, 11, "iron_bars")      # rack
    for x in range(17, 28, 2):
        g.fill(x, FY + 1, 11, x, FY + 2, 11, ["wool:purple", "wool:yellow", "wool:light_gray",
                                               "wool:pink", "wool:brown", "wool:white"][(x - 17) // 2])
    # show control room: monitors, control desks, show tapes
    for x in range(31, 45):
        g.set(x, FY, 1, "iron_block")
        g.set(x, FY + 1, 1, ["froglight_green", "sea_lantern", "froglight_pink"][x % 3])
        g.set(x, FY + 2, 1, "concrete:black" if x % 2 else "froglight_green")
    for x in range(32, 44, 2):
        g.set(x, FY, 3, "iron_block")
        g.set(x, FY + 1, 3, "lever" if x % 4 else "button")
        g.set(x, FY, 4, "stairs:dark_oak:south")
    g.fill(30, FY, 8, 30, FY + 2, 11, "bookshelf")


def build_restrooms():
    g.fill(53, FY, 1, 53, BCY - 1, 12, "concrete:white")
    for (x0, x1, color, door_x) in ((47, 52, "light_blue", 49), (54, 58, "pink", 56)):
        room(x0, 1, x1, 12)
        for z in range(1, BACK):
            for x in range(x0, x1 + 1):
                g.set(x, GY, z, f"concrete:{color}" if (x + z) % 2 else "concrete:white")
        door(door_x, BACK, 1)
        g.set(door_x, FY + 3, BACK, f"wool:{color}")                    # boys / girls sign
        # toilets along the back wall, with stall partitions
        for x in range(x0, x1 + 1, 2):
            g.set(x, FY, 1, "stairs:quartz:north")
            g.set(x, FY + 1, 1, "button:south")
        for x in range(x0 + 1, x1, 2):
            g.fill(x, FY, 1, x, FY + 2, 3, "concrete:light_gray")
        # sinks with mirrors
        for z in (7, 9):
            g.set(x0, FY, z, "quartz")
            g.set(x0, FY + 1, z, "lever")
            g.set(x0 - 1, FY + 1, z, "iron_block")
            g.set(x0 - 1, FY + 2, z, "iron_block")
        ceiling_light((x0 + x1) // 2, 6)


# security office: two halls lead to it, each door has a door lever and a light switch
OX0, OX1 = 63, 72                          # office interior x
OZ0, OZ1 = 8, 12                           # office interior z
WEST_HALL, EAST_HALL = 60, 74              # each hall is this x and the next


def annex_wall(x, y, z):
    if y <= FY:
        return "concrete:gray"
    if y == FY + 1:
        return "concrete:black" if (x + z) % 2 else "concrete:white"   # checkered stripe
    return "concrete:light_gray"


def vent(path):
    """carve a 1 wide, 2 tall duct through the attic"""
    for (x, z) in path:
        g.set(x, VY, z, "air")
        g.set(x, VY + 1, z, "air")


def build_security_office():
    for z in range(1, BACK):
        for x in range(59, 77):
            g.set(x, GY, z, "concrete:black" if (x + z) % 2 else "concrete:gray")
            for y in range(FY, BCY):
                g.set(x, y, z, annex_wall(x, y, z))
    room(WEST_HALL, 1, WEST_HALL + 1, 12)
    room(EAST_HALL, 1, EAST_HALL + 1, 12)
    room(WEST_HALL, 1, EAST_HALL + 1, 2)                  # back hall
    room(OX0, OZ0, OX1, OZ1)                              # office
    room(OX0, 4, OX1, 6)                                  # parts & service
    for x in (WEST_HALL, EAST_HALL):
        g.fill(x, FY, BACK, x + 1, FY + 2, BACK, "air")   # halls open onto the game room
    g.fill(67, FY, 3, 67, FY + 1, 3, "air")               # parts room door

    # doors: the lever on the red panel keeps the door powered open; flip it to
    # slam the door. The other lever lights a lamp so you can see into the hall.
    dz = OZ0 + 2
    for (wall, inside, door_dir, face) in ((OX0 - 1, OX0, 0, "east"), (OX1 + 1, OX1, 2, "west")):
        g.set(wall, FY, dz, f"iron_door:{door_dir}:lower")
        g.set(wall, FY + 1, dz, f"iron_door:{door_dir}:upper")
        g.set(wall, FY + 1, dz - 1, "concrete:red")
        g.set(inside, FY + 1, dz - 1, f"wall_lever:{face}:on")
        g.set(wall, FY + 1, OZ1, "redstone_lamp")
        g.set(inside, FY + 1, OZ1, f"wall_lever:{face}:off")
        g.fill(wall, FY + 1, dz + 1, wall, FY + 2, dz + 1, "glass_pane")

    # desk with the camera monitors, desk fan and a cupcake
    g.fill(65, FY, OZ0, 70, FY, OZ0, "dark_oak_planks")
    for x, key in zip(range(65, 71), ("carpet:white", "froglight_green", "iron_bars", "froglight_green",
                                      "froglight_green", "candle_cake")):
        g.set(x, FY + 1, OZ0, key)
    g.set(67, FY, OZ0 + 1, "stairs:dark_oak:south")
    g.set(67, BCY - 1, OZ0 + 3, "lantern")
    for (x, y, color) in ((64, FY + 2, "yellow"), (66, FY + 3, "pink"), (69, FY + 3, "light_blue"),
                          (71, FY + 2, "lime")):
        g.set(x, y, OZ0 - 1, f"wool:{color}")

    # animatronics lurking outside the windows: purple bunny (west), chicken (east)
    for (x, body, face, top, legs) in ((WEST_HALL, "wool:purple", "pumpkin_face:east", "wool:purple",
                                        "wool:purple"),
                                       (EAST_HALL + 1, "wool:yellow", "pumpkin_face:west", "wool:red",
                                        "wool:orange")):
        g.set(x, FY, dz + 1, legs)
        g.set(x, FY + 1, dz + 1, body)
        g.set(x, FY + 2, dz + 1, face)
        g.set(x, FY + 3, dz + 1, top)

    # parts & service: spare costumes, an endoskeleton, tools
    for (x, color) in ((64, "light_gray"), (65, "purple"), (70, "yellow")):
        g.set(x, FY, 4, f"wool:{color}")
        g.set(x, FY + 1, 4, "pumpkin_face:south")
    g.fill(71, FY, 4, 71, FY + 1, 4, "iron_bars")
    g.set(71, FY + 2, 4, "iron_block")
    g.set(72, FY, 6, "crafting_table")
    g.set(63, FY, 6, "candle:white")

    # dim candles keep the halls spooky but too bright for mobs to spawn
    for z in (1, 4, 7, 10):
        g.set(WEST_HALL, FY, z, "candle:plain")
        g.set(EAST_HALL + 1, FY, z, "candle:plain")
    for x in (63, 66, 69, 72):
        g.set(x, FY, 1, "candle:plain")

    # left vent: ladder in the office's north-west corner, west through the
    # attic and out onto the stage behind Chuck E.
    vent([(x, OZ0) for x in range(24, OX0 + 1)] + [(24, z) for z in range(OZ0 + 1, BACK + 1)])
    for y in range(FY, VY + 1):
        g.set(OX0, y, OZ0, "ladder:south")
    for y in range(FY + 1, VY):
        g.set(24, y, BACK + 1, "ladder:south")
    # right vent: north-east corner, east and out over the trampolines
    vent([(x, OZ0) for x in range(OX1, 87)] + [(86, z) for z in range(OZ0 + 1, BACK + 1)])
    for y in range(FY, VY + 1):
        g.set(OX1, y, OZ0, "ladder:south")
    for y in range(FY, VY):
        g.set(86, y, BACK + 1, "ladder:south")
    for x in (30, 40, 50, 60, 78, 84):
        g.set(x, VY + 2, OZ0, "crying_obsidian")           # glowing vent lights


def build_manager_and_break_room():
    room(77, 1, 85, 12)
    room(87, 1, 94, 12)
    door(76, 10, 0)                         # from the east hall
    door(86, 10, 0)                         # manager's office -> break room
    ceiling_light(81, 6)
    ceiling_light(90, 6)
    # manager's office: desk, computer, safe, filing cabinets, notice board
    g.fill(79, FY, 3, 83, FY, 3, "dark_oak_planks")
    g.set(81, FY + 1, 3, "sea_lantern")
    g.set(81, FY, 4, "stairs:dark_oak:south")
    g.fill(85, FY, 1, 85, FY + 1, 2, "iron_block")                       # safe
    g.set(85, FY + 2, 1, "lever")
    for z in (5, 6, 7):
        g.fill(77, FY, z, 77, FY + 1, z, "iron_block")
        g.set(78, FY + 1, z, "button:east")
    g.fill(79, FY + 2, 1, 83, FY + 3, 1, "oak_planks")
    for x in (79, 81, 83):
        g.set(x, FY + 3, 1, rng.choice(["wool:yellow", "wool:pink", "wool:light_blue", "wool:white"]))
    # break room: lockers, table, vending machine, fridge
    for x in range(87, 95):
        g.fill(x, FY, 1, x, FY + 1, 1, "iron_block")
        g.set(x, FY + 1, 2, "button:south")
    g.fill(89, FY, 6, 91, FY, 7, "quartz")
    for x in (89, 91):
        g.set(x, FY, 5, "stairs:dark_oak:north")
        g.set(x, FY, 8, "stairs:dark_oak:south")
    g.fill(93, FY, 4, 94, FY + 3, 5, "concrete:black")
    g.fill(93, FY + 1, 4, 93, FY + 2, 5, "glass")
    for (y, z, c) in ((FY + 1, 4, "red"), (FY + 1, 5, "yellow"), (FY + 2, 4, "lime"), (FY + 2, 5, "blue")):
        g.set(94, y, z, f"wool:{c}")
    g.fill(94, FY, 10, 94, FY + 2, 11, "iron_block")


def build_all():
    build_ground()
    build_lot()
    build_shell()
    build_floors_and_ceilings()
    build_back_of_house_shell()
    build_stage()
    build_dance_floor_and_video_wall()
    build_dining()
    build_game_room()
    build_trampolines()
    build_play_structure()
    build_front_walls()
    build_kitchen()
    party_room(21, 29, "pink")
    party_room(31, 39, "light_blue")
    build_lobby()
    build_ticket_blaster_and_photo_booth()
    build_prize_counter()
    build_backstage()
    build_restrooms()
    build_security_office()
    build_manager_and_break_room()
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
PACK_VERSION = [2, 0, 0]       # bump on every release so Minecraft replaces the old import
PIECE = 64                      # Bedrock structures stay within 64 x 64 blocks
ANCHOR = (46, FY, 45)          # grid cell the player stands in when running the function
VIEW_SPOT = (48, FY, 88)       # where the player is sent afterwards: the parking lot


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
        if z > BZ1 + 4:
            return False
        if z <= BACK:   # back of house: drop its low ceiling and the attic with the vents
            return y >= BCY
        return y >= CY or (y > FY + 1 and (z >= BZ1 or x == W - 1))

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
            if z < BACK:
                ymax = BCY - 1
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
