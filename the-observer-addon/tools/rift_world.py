#!/usr/bin/env python3
"""The Rift's world (1.6.0): every piece of it drawn here, block by block, and written as .mcstructure files that the
scripts lay out in the rift dimension each time a rift opens (scripts/rift/realm.js).

The Rift is the Goatwalker's Stellar Taiga and the Weeping Mire torn into one: dead pines of the Rift's own grey bark
standing in mist over moss, podzol and the Mire's moss, with the Goatwalker's void trees and the Mire's weeping trees
among them, puddles, boulders, ferns, and the dead (bodies, blood, skeletons, hanged men). Five kinds of piece, each
48 x 52 x 48 (world y 48 to 99; the ground at y 64), every cell written (air included), so laying a piece down again
puts it back exactly as it was:

  rift/woods_1..4     the dead woods
  rift/edge_1..3      the woods ending at a crumbling edge over the void (the edge on the north side; turned to fit)
  rift/corner_1..2    the same on two sides (north and west)
  rift/landing        the clearing where a rift sets you down: a ring of standing stones, where the way out opens
  rift/church         a ruined church: a nave of pews, an altar with a body on it, a bell tower with a crimson lamp,
                      a crypt under the nave, a graveyard and a mausoleum
  rift/castle         a castle: curtain walls and corner towers, a gatehouse, a courtyard with a gallows, a keep of three
                      floors (great hall and throne, armoury and treasury, the lord's chamber and library), a tower with a
                      crimson lamp, and a dungeon under it all

Chests carry the Rift's loot tables (loot_tables/rift/*.json, written here too): the best in the game, enchanted as
far as it goes. Block states are the game's own defaults (tools/rift_states.json, asked of a dedicated server), with
only what matters (facing, half, axis) changed.

Usage: python3 tools/rift_world.py            writes everything
       python3 tools/rift_world.py --names    the block names it uses (to ask the server for their states)
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_structures as MS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
STATE_FILE = os.path.join(ROOT, "tools", "rift_states.json")

_raw = json.load(open(STATE_FILE)) if os.path.exists(STATE_FILE) else {}
STATES = {k: (v["states"] if isinstance(v, dict) and "states" in v else v) for k, v in _raw.items()}
TYPES = {k: v["type"] for k, v in _raw.items() if isinstance(v, dict) and "type" in v}
USED = set()

NT = 48          # a piece is NT x HT x NT
HT = 52
Y0 = 48          # world y of a piece's bottom
SURF = 16        # local y of the ground's top (world 64)

AIR = "minecraft:air"
# weirdo_direction: the way a stair rises — 0 east (+x), 1 west (-x), 2 south (+z), 3 north (-z)
EAST, WEST, SOUTH, NORTH = 0, 1, 2, 3
FACE = {"north": 2, "south": 3, "west": 4, "east": 5}


# ----------------------------------------------------------------------------- noise

def hash01(seed, ix, iz):
    h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFF) / 0xFFFFFF


def vnoise(seed, x, z, scale):
    fx, fz = x / scale, z / scale
    ix, iz = math.floor(fx), math.floor(fz)
    tx, tz = fx - ix, fz - iz
    tx, tz = tx * tx * (3 - 2 * tx), tz * tz * (3 - 2 * tz)
    a = hash01(seed, ix, iz) * 2 - 1
    b = hash01(seed, ix + 1, iz) * 2 - 1
    c = hash01(seed, ix, iz + 1) * 2 - 1
    d = hash01(seed, ix + 1, iz + 1) * 2 - 1
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------- a piece

class Piece(MS.Structure):
    def __init__(self, name, seed):
        super().__init__(NT, HT, NT)
        self.name = name
        self.seed = seed
        self.r = random.Random(seed)
        self.h = {}        # (x, z) -> local y of the ground's top block; missing = the void
        self.bottom = {}   # (x, z) -> lowest ground block
        self.kind = {}     # (x, z) -> the ground's top block
        self.taken = set()  # (x, z) columns with something on them (no plants, no trees)
        self.water = set()

    def set(self, x, y, z, name, states=None, be=None):
        USED.add(name)
        sx, sy, sz = self.size
        if not (0 <= x < sx and 0 <= y < sy and 0 <= z < sz):
            return
        st = dict(STATES.get(name, {}))
        if states:
            for k, v in states.items():
                if STATES and name in STATES and k not in STATES[name]:
                    raise KeyError(f"{name} has no state {k}")
                st[k] = v
        self.cells[(x, y, z)] = (TYPES.get(name, name), st, be)

    def chance(self, p):
        return self.r.random() < p

    def pick(self, *opts):
        """pick(("a", 5), ("b", 1)) by weight"""
        tot = sum(w for _, w in opts)
        v = self.r.random() * tot
        for n, w in opts:
            v -= w
            if v <= 0:
                return n
        return opts[-1][0]

    def fill(self, x0, y0, z0, x1, y1, z1, name, states=None):
        for x in range(min(x0, x1), max(x0, x1) + 1):
            for y in range(min(y0, y1), max(y0, y1) + 1):
                for z in range(min(z0, z1), max(z0, z1) + 1):
                    self.set(x, y, z, name() if callable(name) else name, states)

    def clear(self, x0, y0, z0, x1, y1, z1):
        self.fill(x0, y0, z0, x1, y1, z1, AIR)

    def name_at(self, x, y, z):
        c = self.cells.get((x, y, z))
        return c[0] if c else None

    def solid_at(self, x, y, z):
        n = self.name_at(x, y, z)
        return bool(n) and n != AIR and n not in SOFT

    def finish(self):
        """Every cell not drawn is air, so laying the piece down again clears whatever was built there."""
        for x in range(NT):
            for y in range(HT):
                for z in range(NT):
                    if (x, y, z) not in self.cells:
                        self.cells[(x, y, z)] = (AIR, {}, None)
        connect(self)
        return self


SOFT = {"minecraft:short_grass", "minecraft:fern", "minecraft:large_fern", "minecraft:deadbush", "minecraft:water", "minecraft:web",
        "observer:blood", "observer:corpse", "observer:skeleton", "observer:hanged", "goatwalker:rift_fern", "goatwalker:stellar_grass",
        "goatwalker:mooncap", "goatwalker:bleeding_shrub", "goatwalker:blood_ash", "goatwalker:ritual_marking_floor",
        "goatwalker:tattered_cloth", "goatwalker:hanging_moss", "goatwalker:hanging_moss_tip", "goatwalker:void_crystal",
        "wmire:bone_grass", "wmire:bone_sprout", "wmire:eyebloom_stalk", "wmire:eyebloom", "wmire:weeping_tendril",
        "minecraft:brown_mushroom", "minecraft:redstone_wire", "minecraft:black_candle", "minecraft:red_candle", "minecraft:soul_lantern",
        "minecraft:lantern", "minecraft:chain", "minecraft:soul_torch", "minecraft:skeleton_skull", "minecraft:red_carpet",
        "minecraft:black_carpet", "minecraft:ladder", "minecraft:barrier", "observer:gravestone"}
LINKS = {"minecraft:iron_bars", "minecraft:red_stained_glass_pane", "minecraft:dark_oak_fence", "minecraft:deepslate_brick_wall"}


def connect(t):
    """Bars, panes, fences and walls joined to what is beside them (the game would on the next update)."""
    for (x, y, z), (name, st, be) in list(t.cells.items()):
        if name not in LINKS:
            continue
        sides = {"north": (0, -1), "south": (0, 1), "west": (-1, 0), "east": (1, 0)}
        con = {}
        for side, (dx, dz) in sides.items():
            n = t.name_at(x + dx, y, z + dz)
            con[side] = bool(n) and n != AIR and (n in LINKS or n not in SOFT)
        if name == "minecraft:deepslate_brick_wall":
            for side in sides:
                st[f"wall_connection_type_{side}"] = "short" if con[side] else "none"
            straight = (con["north"] and con["south"] and not con["east"] and not con["west"]) or \
                       (con["east"] and con["west"] and not con["north"] and not con["south"])
            st["wall_post_bit"] = not straight
        else:
            for side in sides:
                st[f"minecraft:connection_{side}"] = con[side]


# ----------------------------------------------------------------------------- the ground

STONE = (("minecraft:stone", 10), ("minecraft:tuff", 3), ("minecraft:cobblestone", 1))


def ground_kind(t, x, z):
    s = t.seed
    a = vnoise(s + 11, x, z, 9)
    b = vnoise(s + 12, x, z, 5)
    if hash01(s + 13, x, z) < 0.03:
        return "minecraft:gravel"
    if a > 0.38:
        return "goatwalker:ashen_podzol" if b > 0.15 else "minecraft:podzol"
    if a < -0.42:
        return "wmire:mire_moss" if b > -0.2 else "minecraft:coarse_dirt"
    if b > 0.5:
        return "minecraft:podzol"
    if b < -0.55:
        return "minecraft:coarse_dirt"
    return "observer:rift_moss"


def terrain(t, exists=None, bottom=None, flat=None, relief=2.6, kind=None):
    """The ground. exists(x, z): False = the void there; bottom(x, z): lowest ground block (default: the bedrock at 0);
    flat(x, z) -> 0..1: how far this cell is pressed flat to the base height (1 = flat)."""
    s = t.seed
    for x in range(NT):
        for z in range(NT):
            if exists and not exists(x, z):
                continue
            edge = min(x, z, NT - 1 - x, NT - 1 - z)
            taper = smooth(edge / 9)
            n = relief * vnoise(s + 1, x, z, 13) + 1.1 * vnoise(s + 2, x, z, 5)
            if flat:
                n *= 1 - flat(x, z)
            h = SURF + round(taper * n)
            t.h[(x, z)] = h
            b = bottom(x, z) if bottom else 0
            t.bottom[(x, z)] = b
            k = kind(x, z) if kind else ground_kind(t, x, z)
            t.kind[(x, z)] = k
            for y in range(b, h + 1):
                if y == 0:
                    name = "minecraft:bedrock"
                elif y == h:
                    name = k
                elif y >= h - 3:
                    name = "minecraft:mud" if k == "minecraft:mud" else "minecraft:dirt" if k != "minecraft:gravel" else "minecraft:gravel"
                else:
                    name = STONE[0][0] if hash01(s + 3, x * 7 + y, z) > 0.28 else ("minecraft:tuff" if hash01(s + 4, x, z * 5 + y) > 0.3 else "minecraft:cobblestone")
                t.set(x, y, z, name)


def set_top(t, x, z, name):
    if (x, z) in t.h:
        t.kind[(x, z)] = name
        t.set(x, t.h[(x, z)], z, name)


def puddles(t, n, keep=None):
    r = t.r
    for _ in range(n):
        for _try in range(20):
            cx, cz = r.randint(9, NT - 10), r.randint(9, NT - 10)
            if keep and not keep(cx, cz):
                continue
            if (cx, cz) not in t.h:
                continue
            break
        else:
            continue
        rx, rz = r.uniform(2, 4.5), r.uniform(1.6, 3.4)
        ang = r.uniform(0, math.pi)
        ca, sa = math.cos(ang), math.sin(ang)
        inside = []
        for x in range(cx - 6, cx + 7):
            for z in range(cz - 6, cz + 7):
                dx, dz = x - cx, z - cz
                u, v = dx * ca + dz * sa, -dx * sa + dz * ca
                e = (u / rx) ** 2 + (v / rz) ** 2 + 0.25 * vnoise(t.seed + 20, x, z, 2)
                if e <= 1 and (x, z) in t.h and (not keep or keep(x, z)):
                    inside.append((x, z))
        if len(inside) < 4:
            continue
        # the water's level: the lowest ground round it, so it cannot run out
        ring = set()
        for (x, z) in inside:
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (x + dx, z + dz)
                if q not in inside:
                    ring.add(q)
        if any(q not in t.h for q in ring):
            continue
        level = min(t.h[q] for q in ring)
        level = min(level, min(t.h[q] for q in inside))
        for (x, z) in inside:
            for y in range(level, t.h[(x, z)] + 1):
                t.set(x, y, z, AIR)
            t.set(x, level, z, "minecraft:water")
            t.set(x, level - 1, z, "minecraft:mud")
            t.h[(x, z)] = level
            t.kind[(x, z)] = "minecraft:water"
            t.water.add((x, z))
            t.taken.add((x, z))
        for q in ring:
            if q not in t.water and t.r.random() < 0.7:
                set_top(t, q[0], q[1], "minecraft:mud")


def boulder(t, cx, cz, rad=None):
    r = t.r
    if (cx, cz) not in t.h:
        return
    rad = rad or r.uniform(1.4, 3.0)
    ry = rad * r.uniform(0.6, 0.9)
    base = t.h[(cx, cz)]
    mat = t.pick(("minecraft:stone", 4), ("minecraft:cobblestone", 2), ("minecraft:mossy_cobblestone", 3), ("minecraft:tuff", 2),
                 ("goatwalker:rift_stone", 2))
    for x in range(int(cx - rad - 1), int(cx + rad + 2)):
        for z in range(int(cz - rad - 1), int(cz + rad + 2)):
            if (x, z) not in t.h or (x, z) in t.water:
                continue
            for y in range(base - 1, int(base + ry + 2)):
                d = ((x - cx) / rad) ** 2 + ((z - cz) / rad) ** 2 + ((y - base) / ry) ** 2 + 0.3 * vnoise(t.seed + 30, x + y, z, 2)
                if d <= 1:
                    top = d > 0.55 and y > base and r.random() < 0.35
                    t.set(x, y, z, "minecraft:mossy_cobblestone" if top else mat)
                    t.taken.add((x, z))


# ----------------------------------------------------------------------------- trees

def log(t, x, y, z, name, axis="y"):
    face = {"y": "up", "x": "east", "z": "south"}[axis]
    t.set(x, y, z, name, {"minecraft:block_face": face})


def dead_pine(t, x, z, tall=None):
    r = t.r
    if (x, z) not in t.h:
        return
    base = t.h[(x, z)] + 1
    snapped = r.random() < 0.18
    H = r.randint(5, 10) if snapped else (tall or r.randint(13, 25))
    top = base + H - 1
    for y in range(base, top + 1):
        log(t, x, y, z, "observer:rift_bark")
    t.taken.add((x, z))
    # roots spread at its foot
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        q = (x + dx, z + dz)
        if q in t.h and t.h[q] == base - 1 and q not in t.taken and r.random() < 0.35:
            log(t, q[0], base, q[1], "observer:rift_bark", "x" if dx else "z")
            t.taken.add(q)
    if snapped:
        if r.random() < 0.5:
            t.set(x, top + 1, z, "observer:rift_bark", {"minecraft:block_face": "up"})
        return
    # bare branches up the trunk, dead needles thinning out above
    y = base + max(3, int(H * 0.33))
    while y < top - 1:
        if r.random() < 0.55:
            dx, dz = r.choice(((1, 0), (-1, 0), (0, 1), (0, -1)))
            frac = (y - base) / H
            n = max(1, min(3, round((1.0 - frac) * 4 + r.uniform(-0.5, 0.5))))
            tip = None
            for i in range(1, n + 1):
                bx, bz = x + dx * i, z + dz * i
                by = y + (1 if i == n and n >= 3 and r.random() < 0.4 else 0)
                log(t, bx, by, bz, "observer:rift_bark", "x" if dx else "z")
                tip = (bx, by, bz)
            if tip and frac > 0.45 and r.random() < 0.7:
                clump(t, *tip, r.randint(2, 5))
            # a body hanged from it, now and then
            if tip and 0.3 < frac < 0.7 and n >= 2 and r.random() < HANG_CHANCE[0]:
                hang(t, tip[0], tip[1] - 1, tip[2])
        y += r.randint(1, 3)
    for yy in range(top - 3, top + 1):
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if r.random() < 0.45 - 0.08 * (yy - (top - 3)):
                needle(t, x + dx, yy, z + dz)
    needle(t, x, top + 1, z)
    if r.random() < 0.5:
        needle(t, x, top + 2, z)


HANG_CHANCE = [0.04]


def needle(t, x, y, z):
    if t.name_at(x, y, z) in (None, AIR):
        t.set(x, y, z, "observer:rift_needles")


def clump(t, x, y, z, n):
    r = t.r
    needle(t, x, y + 1, z)
    for _ in range(n):
        dx, dy, dz = r.randint(-1, 1), r.randint(0, 1), r.randint(-1, 1)
        needle(t, x + dx, y + dy, z + dz)


def hang(t, x, y, z):
    """A body hanged from the branch above (x, y+1, z): the upper half at y, the lower at y-1, if there is room."""
    if any(t.name_at(x, yy, z) not in (None, AIR) for yy in (y, y - 1, y - 2)):
        return
    if (x, z) in t.h and t.h[(x, z)] >= y - 3:
        return
    face = t.r.choice(("north", "south", "east", "west"))
    t.set(x, y, z, "observer:hanged", {"observer:part": 1, "minecraft:cardinal_direction": face})
    t.set(x, y - 1, z, "observer:hanged", {"observer:part": 0, "minecraft:cardinal_direction": face})
    if (x, z) in t.h and t.r.random() < 0.8:
        t.set(x, t.h[(x, z)] + 1, z, "observer:blood", {"observer:splash": t.r.randint(0, 3)})


def weeping_tree(t, x, z):
    r = t.r
    if (x, z) not in t.h:
        return
    base = t.h[(x, z)] + 1
    H = r.randint(6, 9)
    for y in range(base, base + H):
        log(t, x, y, z, "wmire:weeping_log")
    t.taken.add((x, z))
    cy = base + H - 1
    rad = r.uniform(2.2, 3.2)
    crown = []
    for dx in range(-3, 4):
        for dz in range(-3, 4):
            for dy in range(-1, 3):
                d = (dx * dx + dz * dz) / (rad * rad) + (dy * dy) / 4.0
                if d <= 1 and r.random() < 0.8 and t.name_at(x + dx, cy + dy, z + dz) in (None, AIR):
                    t.set(x + dx, cy + dy, z + dz, "wmire:weeping_leaves")
                    crown.append((x + dx, cy + dy, z + dz))
    # tendrils weep from the crown's underside
    for (lx, ly, lz) in crown:
        if t.name_at(lx, ly - 1, lz) in (None, AIR) and r.random() < 0.35:
            for k in range(1, r.randint(2, 5)):
                if t.name_at(lx, ly - k, lz) not in (None, AIR) or ((lx, lz) in t.h and ly - k <= t.h[(lx, lz)] + 1):
                    break
                t.set(lx, ly - k, lz, "wmire:weeping_tendril")


def void_tree(t, x, z):
    r = t.r
    if (x, z) not in t.h:
        return
    base = t.h[(x, z)] + 1
    H = r.randint(8, 12)
    for y in range(base, base + H):
        log(t, x, y, z, "goatwalker:void_log")
    t.taken.add((x, z))
    top = base + H - 1
    leaves = []
    for dy in range(-4, 2):
        rad = 2 if dy <= -2 else 1
        for dx in range(-rad, rad + 1):
            for dz in range(-rad, rad + 1):
                if abs(dx) + abs(dz) > rad + (1 if dy <= -3 else 0) or r.random() < 0.15:
                    continue
                if t.name_at(x + dx, top + dy, z + dz) in (None, AIR):
                    t.set(x + dx, top + dy, z + dz, "goatwalker:void_leaves", {"goatwalker:persistent": True})
                    leaves.append((x + dx, top + dy, z + dz))
    t.set(x, top + 2, z, "goatwalker:void_leaves", {"goatwalker:persistent": True})
    for (lx, ly, lz) in leaves:
        if t.name_at(lx, ly - 1, lz) in (None, AIR) and r.random() < 0.3:
            n = r.randint(1, 3)
            for k in range(1, n + 1):
                t.set(lx, ly - k, lz, "goatwalker:hanging_moss_tip" if k == n else "goatwalker:hanging_moss")


def fallen_log(t, x, z):
    r = t.r
    axis = r.choice("xz")
    n = r.randint(4, 8)
    cells = [(x + (i if axis == "x" else 0), z + (i if axis == "z" else 0)) for i in range(n)]
    if any(c not in t.h or c in t.taken or c in t.water for c in cells):
        return
    hs = [t.h[c] for c in cells]
    if max(hs) - min(hs) > 1:
        return
    y = max(hs) + 1
    for c in cells:
        log(t, c[0], y, c[1], "observer:rift_bark", axis)
        t.taken.add(c)


def poisson(t, mind, tries, ok):
    pts = []
    for _ in range(tries):
        x, z = t.r.randint(1, NT - 2), t.r.randint(1, NT - 2)
        if not ok(x, z):
            continue
        if all((x - a) ** 2 + (z - b) ** 2 >= mind * mind for a, b in pts):
            pts.append((x, z))
    return pts


def forest(t, density=1.0, keep=None, mind=3.6):
    ok = lambda x, z: (x, z) in t.h and (x, z) not in t.taken and (x, z) not in t.water and (not keep or keep(x, z))
    pts = poisson(t, mind, int(700 * density), ok)
    for (x, z) in pts:
        k = t.pick(("pine", 78), ("weep", 8), ("void", 7), ("fallen", 7))
        if k == "pine":
            dead_pine(t, x, z)
        elif k == "weep":
            weeping_tree(t, x, z)
        elif k == "void":
            void_tree(t, x, z)
        else:
            fallen_log(t, x, z)


# ----------------------------------------------------------------------------- what grows, and the dead

VANILLA_SOIL = {"minecraft:podzol", "minecraft:coarse_dirt", "minecraft:moss_block"}
GW_SOIL = {"goatwalker:ashen_podzol", "goatwalker:stellar_soil", "minecraft:podzol", "minecraft:moss_block"}
MIRE_SOIL = {"wmire:mire_moss", "minecraft:coarse_dirt", "minecraft:podzol", "minecraft:mud", "minecraft:moss_block"}


def free_above(t, x, z, n=1):
    if (x, z) not in t.h or (x, z) in t.water:
        return False
    y = t.h[(x, z)]
    return all(t.name_at(x, y + k, z) in (None, AIR) for k in range(1, n + 1))


def plants(t, keep=None, dead=1.0):
    r = t.r
    for x in range(NT):
        for z in range(NT):
            if (x, z) in t.taken or (keep and not keep(x, z)) or not free_above(t, x, z, 3):
                continue
            k = t.kind.get((x, z))
            y = t.h[(x, z)] + 1
            v = r.random()
            if k in VANILLA_SOIL or k in GW_SOIL or k in MIRE_SOIL:
                if k in VANILLA_SOIL and v < 0.10:
                    t.set(x, y, z, "minecraft:fern")
                elif k in VANILLA_SOIL and v < 0.13:
                    t.set(x, y, z, "minecraft:large_fern", {"upper_block_bit": False})
                    t.set(x, y + 1, z, "minecraft:large_fern", {"upper_block_bit": True})
                elif k in VANILLA_SOIL and v < 0.17:
                    t.set(x, y, z, "minecraft:short_grass")
                elif k in VANILLA_SOIL and v < 0.19:
                    t.set(x, y, z, "minecraft:deadbush")
                elif k in GW_SOIL and v < 0.27:
                    t.set(x, y, z, t.pick(("goatwalker:rift_fern", 6), ("goatwalker:stellar_grass", 4), ("goatwalker:mooncap", 1),
                                          ("goatwalker:bleeding_shrub", 0.6)))
                elif k in MIRE_SOIL and v < 0.33:
                    if r.random() < 0.04 and free_above(t, x, z, 4):
                        eyebloom(t, x, y, z)
                    else:
                        t.set(x, y, z, t.pick(("wmire:bone_grass", 6), ("wmire:bone_sprout", 1.5)))
                else:
                    gore(t, x, y, z, dead)
            else:
                gore(t, x, y, z, dead)


def eyebloom(t, x, y, z):
    face = t.r.choice(("north", "south", "east", "west"))
    t.set(x, y, z, "wmire:eyebloom_stalk")
    t.set(x, y + 1, z, "wmire:eyebloom_stalk")
    t.set(x, y + 2, z, "wmire:eyebloom", {"minecraft:cardinal_direction": face})
    t.taken.add((x, z))


def gore(t, x, y, z, dead=1.0):
    r = t.r
    v = r.random() / max(0.05, dead)
    face = r.choice(("north", "south", "east", "west"))
    if v < 0.012:
        t.set(x, y, z, "observer:blood", {"observer:splash": r.randint(0, 3)})
    elif v < 0.0135:
        t.set(x, y, z, "observer:corpse", {"minecraft:cardinal_direction": face})
        t.taken.add((x, z))
    elif v < 0.0155:
        t.set(x, y, z, "observer:skeleton", {"minecraft:cardinal_direction": face})
        t.taken.add((x, z))
    elif v < 0.018:
        t.set(x, y, z, "goatwalker:blood_ash")
    elif v < 0.0188:
        t.set(x, y, z, "minecraft:skeleton_skull", {"facing_direction": 1})
    elif v < 0.0195 and t.kind.get((x, z)) not in ("minecraft:mud",):
        # a stake with a skull on it
        t.set(x, y, z, "minecraft:dark_oak_fence")
        t.set(x, y + 1, z, "minecraft:dark_oak_fence")
        t.set(x, y + 2, z, "minecraft:skeleton_skull", {"facing_direction": 1})
        t.taken.add((x, z))


def blood_pool(t, cx, y, cz, rad, floor_ok=None):
    for x in range(int(cx - rad), int(cx + rad) + 1):
        for z in range(int(cz - rad), int(cz + rad) + 1):
            if (x - cx) ** 2 + (z - cz) ** 2 <= rad * rad + 0.5 and t.r.random() < 0.8:
                if t.name_at(x, y, z) in (None, AIR) and t.solid_at(x, y - 1, z) and (not floor_ok or floor_ok(x, z)):
                    t.set(x, y, z, "observer:blood", {"observer:splash": t.r.randint(0, 3)})


# ----------------------------------------------------------------------------- the dead woods, and their edges

def woods(seed):
    t = Piece("woods", seed)
    terrain(t)
    puddles(t, t.r.randint(2, 5))
    for _ in range(t.r.randint(3, 7)):
        boulder(t, t.r.randint(4, NT - 5), t.r.randint(4, NT - 5))
    HANG_CHANCE[0] = 0.05
    forest(t)
    plants(t)
    # a traveller who did not make it out: their pack, by their body
    if t.r.random() < 0.6:
        for _ in range(30):
            x, z = t.r.randint(6, NT - 7), t.r.randint(6, NT - 7)
            if free_above(t, x, z, 2) and (x, z) not in t.taken and (x + 1, z) in t.h and free_above(t, x + 1, z, 2) and t.h[(x + 1, z)] == t.h[(x, z)]:
                y = t.h[(x, z)] + 1
                t.set(x, y, z, "observer:corpse", {"minecraft:cardinal_direction": "east"})
                t.chest(x + 1, y, z, "loot_tables/rift/traveller.json", kind="barrel")
                blood_pool(t, x, y, z, 1.6)
                t.taken.update({(x, z), (x + 1, z)})
                break
    return t.finish()


def ragged(seed, n0=16):
    """The line where the ground ends: around 16 blocks in, ragged, and exactly 16 at both ends (so pieces meet)."""
    out = []
    for i in range(NT):
        end = smooth(min(i, NT - 1 - i) / 8)
        v = n0 + end * (5 * vnoise(seed, i, 0, 7) + 2 * vnoise(seed + 1, i, 0, 2.5))
        out.append(int(round(v)))
    return out


def edge_piece(seed, corner=False):
    t = Piece("corner" if corner else "edge", seed)
    north = ragged(seed + 100)
    west = ragged(seed + 200) if corner else None

    def exists(x, z):
        return z >= north[x] and (not west or x >= west[z])

    def depth(x, z):
        d = z - north[x]
        if west:
            d = min(d, x - west[z])
        return d

    def bottom(x, z):
        # the ground thins out to a crumbling lip over the void
        d = depth(x, z)
        return 0 if d > 6 else max(1, SURF - 3 - 2 * d - int(3 * hash01(seed + 5, x, z)))

    terrain(t, exists=exists, bottom=bottom)
    # an invisible rail along the lip (the scripts also bring back anyone who falls)
    lip = set()
    for x in range(NT):
        for z in range(NT):
            if (x, z) in t.h and depth(x, z) <= 0:
                lip.add((x, z))
    for (x, z) in list(lip):
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            q = (x + dx, z + dz)
            if q in t.h and depth(*q) <= 1:
                lip.add(q)
    for (x, z) in lip:
        for y in range(t.h[(x, z)] + 1, t.h[(x, z)] + 5):
            t.set(x, y, z, "minecraft:barrier")
        t.taken.add((x, z))
    # rocks torn loose, hanging in the void beyond, a void crystal glowing on some
    for _ in range(t.r.randint(3, 6)):
        cx, cz = t.r.randint(4, NT - 5), t.r.randint(1, 9)
        if corner and t.r.random() < 0.5:
            cx, cz = cz, cx
        cy = SURF + t.r.randint(-8, 6)
        rad = t.r.uniform(1.0, 2.4)
        top = {}
        for x in range(int(cx - rad - 1), int(cx + rad + 2)):
            for z in range(int(cz - rad - 1), int(cz + rad + 2)):
                if exists(x, z) or depth(x, z) > -3:
                    continue
                for y in range(int(cy - rad * 1.6), int(cy + rad) + 1):
                    d = ((x - cx) / rad) ** 2 + ((z - cz) / rad) ** 2 + ((y - cy) / (rad * (1.6 if y < cy else 0.8))) ** 2
                    if d <= 1 + 0.25 * vnoise(seed + 40, x + y, z, 1.5):
                        t.set(x, y, z, t.pick(("goatwalker:rift_stone", 5), ("goatwalker:cracked_rift_stone", 2), ("minecraft:tuff", 2)))
                        top[(x, z)] = max(top.get((x, z), -1), y)
        for (x, z), y in top.items():
            if t.r.random() < 0.12:
                t.set(x, y + 1, z, "goatwalker:void_crystal", {"minecraft:block_face": "up"})
    puddles(t, t.r.randint(1, 3), keep=lambda x, z: depth(x, z) > 5)
    for _ in range(t.r.randint(3, 6)):
        x, z = t.r.randint(4, NT - 5), t.r.randint(24, NT - 5)
        boulder(t, x, z)
    HANG_CHANCE[0] = 0.04
    # the trees thin out toward the edge
    forest(t, density=0.9, keep=lambda x, z: depth(x, z) > 3 and t.r.random() < smooth((depth(x, z) - 3) / 10) + 0.15)
    plants(t, keep=lambda x, z: depth(x, z) > 1)
    return t.finish()


# ----------------------------------------------------------------------------- the landing

def landing(seed):
    t = Piece("landing", seed)
    c = (NT - 1) / 2
    flat = lambda x, z: 1 - smooth((math.hypot(x - c, z - c) - 12) / 6)

    def kind(x, z):
        d = math.hypot(x - c, z - c)
        if d < 13:
            v = hash01(seed + 7, x, z)
            return "minecraft:gravel" if v < 0.18 else "minecraft:coarse_dirt" if v < 0.55 else "minecraft:podzol" if v < 0.8 else "observer:rift_moss"
        # the paths out, north, south, east and west
        if min(abs(x - c), abs(z - c)) < 1.6 + 0.8 * vnoise(seed + 8, x, z, 4):
            return "minecraft:gravel" if hash01(seed + 9, x, z) < 0.4 else "minecraft:coarse_dirt"
        return ground_kind(t, x, z)

    terrain(t, flat=flat, kind=kind)
    cx = cz = int(c)
    # where the way out opens: kept clear
    for x in range(cx - 3, cx + 5):
        for z in range(cz - 3, cz + 5):
            t.taken.add((x, z))
    # the ring of standing stones
    n = 11
    for i in range(n):
        a = i / n * math.tau + t.r.uniform(-0.1, 0.1)
        x, z = int(round(c + 9.5 * math.cos(a))), int(round(c + 9.5 * math.sin(a)))
        H = t.r.randint(3, 6)
        y0 = t.h[(x, z)]
        for y in range(y0, y0 + H + 1):
            name = t.pick(("goatwalker:rift_stone", 5), ("goatwalker:cracked_rift_stone", 3))
            if y == y0 + H and t.r.random() < 0.45:
                name = "goatwalker:bleeding_stone"
            t.set(x, y, z, name)
            if H >= 5 and y >= y0 + 2 and t.r.random() < 0.35:
                dx, dz = t.r.choice(((1, 0), (0, 1)))
                t.set(x + dx, y, z + dz, name)
        t.taken.add((x, z))
        if t.r.random() < 0.5:
            fx, fz = int(round(c + 8 * math.cos(a))), int(round(c + 8 * math.sin(a)))
            t.set(fx, t.h[(fx, fz)] + 1, fz, t.r.choice(("observer:corpse", "observer:skeleton")),
                  {"minecraft:cardinal_direction": t.r.choice(("north", "south", "east", "west"))})
            t.taken.add((fx, fz))
    # the marks on the ground round where it opens
    for i in range(16):
        a = i / 16 * math.tau
        x, z = int(round(c + 5.5 * math.cos(a))), int(round(c + 5.5 * math.sin(a)))
        if (x, z) not in t.taken:
            t.set(x, t.h[(x, z)] + 1, z, "goatwalker:ritual_marking_floor", {"minecraft:cardinal_direction": t.r.choice(("north", "south", "east", "west"))})
            t.taken.add((x, z))
    for _ in range(5):
        a = t.r.uniform(0, math.tau)
        blood_pool(t, c + 7 * math.cos(a), SURF + 1, c + 7 * math.sin(a), t.r.uniform(0.8, 1.8))
    # soul fires burning low by two of the stones
    for a in (0.8, 3.9):
        x, z = int(round(c + 7.5 * math.cos(a))), int(round(c + 7.5 * math.sin(a)))
        t.set(x, t.h[(x, z)] + 1, z, "minecraft:soul_campfire")
        t.taken.add((x, z))
    keep = lambda x, z: math.hypot(x - c, z - c) > 14 and min(abs(x - c), abs(z - c)) > 2.5
    puddles(t, 2, keep=keep)
    HANG_CHANCE[0] = 0.07
    forest(t, keep=keep)
    plants(t, keep=lambda x, z: math.hypot(x - c, z - c) > 11.5)
    return t.finish()


# ----------------------------------------------------------------------------- building helpers

F = SURF  # the floor of the buildings: the ground's level
# the cardinal state of the Goatwalker's trophies and cloth, by which wall they hang on (their models hug their north
# side; the Goatwalker's own hangOn() gives a block on a west wall "west", and so on)
WALL_FACE = {"west": "west", "east": "east", "north": "north", "south": "south"}


def brick(t):
    return t.pick(("observer:rift_bricks", 10), ("observer:rift_bricks_cracked", 3), ("minecraft:deepslate_bricks", 2),
                  ("minecraft:cracked_deepslate_bricks", 1), ("minecraft:mossy_stone_bricks", 1))


def castle_stone(t):
    return t.pick(("minecraft:stone_bricks", 10), ("minecraft:mossy_stone_bricks", 3), ("minecraft:cracked_stone_bricks", 3),
                  ("observer:rift_bricks", 3), ("observer:rift_bricks_cracked", 1))


def stair(t, x, y, z, name, rises, upside=False):
    t.set(x, y, z, name, {"weirdo_direction": rises, "upside_down_bit": upside})


def slab(t, x, y, z, name, top=False):
    t.set(x, y, z, name, {"minecraft:vertical_half": "top" if top else "bottom", "top_slot_bit": top})


def lantern(t, x, y, z, hanging=True, soul=True):
    t.set(x, y, z, "minecraft:soul_lantern" if soul else "minecraft:lantern", {"hanging": hanging})


def chandelier(t, x, ytop, z, drop=2, soul=True):
    for k in range(drop):
        t.set(x, ytop - k, z, "minecraft:chain", {"pillar_axis": "y"})
    lantern(t, x, ytop - drop, z, True, soul)


def candles(t, x, y, z, color="black", n=None):
    t.set(x, y, z, f"minecraft:{color}_candle", {"candles": n if n is not None else t.r.randint(1, 3), "lit": True})


def window(t, x0, z0, x1, z1, y0, y1, glass="observer:rift_glass", broken=0.2):
    """A pointed window in a wall running along x (z0 == z1) or z (x0 == x1)."""
    cells = [(x, z) for x in range(x0, x1 + 1) for z in range(z0, z1 + 1)]
    mid = (len(cells) - 1) / 2
    for i, (x, z) in enumerate(cells):
        top = y1 - (0 if abs(i - mid) < 0.6 else 1 if abs(i - mid) < 1.6 else 2)
        for y in range(y0, top + 1):
            v = t.r.random()
            t.set(x, y, z, AIR if v < broken * 0.4 else "minecraft:iron_bars" if v < broken else glass)


def ladder(t, x, y0, y1, z, facing):
    for y in range(y0, y1 + 1):
        t.set(x, y, z, "minecraft:ladder", {"facing_direction": FACE[facing]})


def flight(t, x0, x1, z_from, y_from, steps, dz, name, support):
    """Stairs climbing one block per step from (z_from, y_from), toward dz (-1 north, +1 south), the full width x0..x1,
    with headroom cleared above each step and the stone under it filled."""
    rises = NORTH if dz < 0 else SOUTH
    for i in range(steps):
        z = z_from + dz * i
        y = y_from + i
        for x in range(x0, x1 + 1):
            stair(t, x, y, z, name, rises)
            for yy in range(y + 1, y + 4):
                t.set(x, yy, z, AIR)
            if support:
                for yy in range(y_from - 1, y):
                    if t.name_at(x, yy, z) in (None, AIR):
                        t.set(x, yy, z, support)


def lectern(t, x, y, z, book, facing):
    t.lectern(x, y, z, book, facing)


def flatten(t, x0, z0, x1, z1, kind=None):
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            t.taken.add((x, z))


# ----------------------------------------------------------------------------- the church

def church(seed):
    t = Piece("church", seed)
    # nave x 17..31, z 9..35; the tower x 21..27, z 35..41; the graveyard round it; flat under all of it
    def flat(x, z):
        dx = max(0, 3 - x, x - 44)
        dz = max(0, 3 - z, z - 45)
        return 1 - smooth(max(dx, dz) / 3)

    def kind(x, z):
        v = hash01(seed + 3, x, z)
        if 16 <= x <= 32 and 8 <= z <= 42:
            return "minecraft:coarse_dirt"
        return "minecraft:podzol" if v < 0.45 else "minecraft:coarse_dirt" if v < 0.65 else "observer:rift_moss" if v < 0.9 else "wmire:mire_moss"

    terrain(t, flat=flat, kind=kind)
    r = t.r
    X0, X1, Z0, Z1 = 17, 31, 9, 35
    # ---- the nave's shell
    for x in range(X0, X1 + 1):
        for z in range(Z0, Z1 + 1):
            t.set(x, F - 1, z, "minecraft:deepslate_tiles")
            t.set(x, F, z, "minecraft:polished_deepslate" if r.random() > 0.15 else "minecraft:cracked_deepslate_bricks")
            wall = x in (X0, X1) or z in (Z0, Z1)
            for y in range(F + 1, F + 11):
                t.set(x, y, z, brick(t) if wall else AIR)
            t.taken.add((x, z))
    for x in (X0, X1):
        for z in (Z0, Z1):
            t.fill(x, F, z, x, F + 10, z, "minecraft:polished_deepslate")
    # buttresses
    for z in (11, 15, 19, 23, 27, 31):
        for side, out, rise in ((X0, -1, EAST), (X1, 1, WEST)):
            bx = side + out
            t.fill(bx, F, z, bx, F + 7, z, "minecraft:deepslate_bricks")
            stair(t, bx, F + 8, z, "minecraft:deepslate_brick_stairs", rise)
            t.fill(bx + out, F, z, bx + out, F + 3, z, "minecraft:deepslate_bricks")
            stair(t, bx + out, F + 4, z, "minecraft:deepslate_brick_stairs", rise)
            t.taken.update({(bx, z), (bx + out, z)})
    # tall pointed windows between them
    for zc in (13, 17, 21, 25, 29):
        for x in (X0, X1):
            window(t, x, zc - 1, x, zc + 1, F + 3, F + 8)
    # the apse wall: the crimson eye (the Observer's) over the altar
    window(t, 21, Z0, 27, Z0, F + 3, F + 9, broken=0.05)
    for (ex, ey) in ((23, F + 6), (24, F + 6), (25, F + 6), (24, F + 7), (24, F + 5)):
        t.set(ex, ey, Z0, "minecraft:black_concrete")
    t.set(24, F + 6, Z0, "minecraft:crying_obsidian")
    # ---- the roof: steep, broken through in places
    for z in range(Z0 - 1, Z1 + 1):
        for i in range(0, 9):
            y = F + 11 + i
            xl, xr = X0 - 1 + i, X1 + 1 - i
            hole = r.random() < 0.13 and Z0 + 2 < z < Z1 - 2 and 0 < i < 8
            if xl == xr:
                slab(t, xl, y, z, "minecraft:deepslate_brick_slab")
            elif not hole:
                stair(t, xl, y, z, "minecraft:deepslate_brick_stairs", EAST)
                stair(t, xr, y, z, "minecraft:deepslate_brick_stairs", WEST)
    # the gable ends are walled up to the roof
    for z in (Z0, Z1):
        for i in range(0, 8):
            for x in range(X0 + i, X1 - i + 1):
                t.set(x, F + 11 + i, z, brick(t))
    # beams across under the roof
    for z in range(Z0 + 2, Z1 - 1, 4):
        for x in range(X0 + 1, X1):
            t.set(x, F + 10, z, "minecraft:stripped_dark_oak_log", {"pillar_axis": "x"})
    # ---- inside: the floor, the aisle, the pews
    for z in range(13, Z1):
        for x in (23, 24, 25):
            if r.random() < 0.85:
                t.set(x, F + 1, z, "minecraft:red_carpet")
    for z in range(16, 34, 2):
        for xs in ((19, 22), (26, 29)):
            if r.random() < 0.12:
                continue
            for x in range(xs[0], xs[1] + 1):
                if r.random() < 0.08:
                    slab(t, x, F + 1, z, "minecraft:dark_oak_slab")
                else:
                    stair(t, x, F + 1, z, "minecraft:dark_oak_stairs", SOUTH)
    # the dead in the pews and the aisle
    for _ in range(7):
        x = r.choice((19, 20, 21, 22, 26, 27, 28, 29, 23, 25))
        z = r.randrange(17, 34, 2)
        t.set(x, F + 1, z, r.choice(("observer:corpse", "observer:skeleton")), {"minecraft:cardinal_direction": r.choice(("east", "west", "north"))})
    for _ in range(6):
        blood_pool(t, r.randint(19, 29), F + 1, r.randint(15, 33), r.uniform(0.6, 1.6))
    for z in range(14, 34):
        if r.random() < 0.5:
            t.set(24 + r.choice((-1, 0, 0, 1)), F + 1, z, "minecraft:redstone_wire")
    # pilasters with lanterns on chains
    for z in range(11, Z1 - 1, 4):
        for x in (X0 + 1, X1 - 1):
            t.fill(x, F + 1, z, x, F + 9, z, "minecraft:polished_deepslate")
        chandelier(t, 24, F + 9, z + 2, 3 if z % 8 == 3 else 2)
    # cobwebs high in the corners
    for _ in range(14):
        x, z, y = r.randint(X0 + 1, X1 - 1), r.randint(Z0 + 1, Z1 - 1), r.randint(F + 7, F + 9)
        if t.name_at(x, y, z) == AIR:
            t.set(x, y, z, "minecraft:web")
    # ---- the chancel: one step up, the altar with a body on it, the chests behind
    for x in range(X0 + 1, X1):
        for z in range(Z0 + 1, 14):
            t.set(x, F + 1, z, "minecraft:polished_blackstone_bricks")
        stair(t, x, F + 1, 14, "minecraft:polished_blackstone_brick_stairs", NORTH)
    for x in range(22, 27):
        t.set(x, F + 2, 11, "minecraft:polished_blackstone_bricks")
    t.set(24, F + 3, 11, "observer:corpse", {"minecraft:cardinal_direction": "east"})
    for x, col in ((22, "black"), (23, "red"), (25, "red"), (26, "black")):
        candles(t, x, F + 3, 11, col, 3 if col == "black" else None)
    for (x, z) in ((22, 12), (26, 12), (24, 13), (23, 12), (25, 12)):
        t.set(x, F + 2, z, "observer:blood", {"observer:splash": r.randint(0, 3)})
    t.chest(20, F + 2, 10, "loot_tables/rift/church_altar.json", "south")
    t.chest(28, F + 2, 10, "loot_tables/rift/church_altar.json", "south")
    for x in (19, 29):
        candles(t, x, F + 2, 10, "red", 3)
    lectern(t, 24, F + 2, 13, RIFT_BOOK, "south")
    for x in (21, 27):
        t.set(x, F + 2, 13, "minecraft:soul_torch", {"torch_facing_direction": "top"})
    # ---- the crypt under the nave (floor F-6, room F-5..F-2), the stairs down in the south-east corner
    for x in range(X0 + 1, X1):
        for z in range(11, 30):
            for y in range(F - 7, F - 1):
                edge = x in (X0 + 1, X1 - 1) or z in (11, 29)
                t.set(x, y, z, brick(t) if (edge or y in (F - 7, F - 6)) else AIR)
            t.set(x, F - 6, z, "minecraft:polished_deepslate" if r.random() > 0.2 else "minecraft:cracked_deepslate_bricks")
    for x in range(27, 30):
        for z in range(27, 35):
            for y in range(F + 1, F + 4):
                t.set(x, y, z, AIR)
    flight(t, 28, 29, 28, F - 5, 6, 1, "minecraft:deepslate_brick_stairs", "minecraft:deepslate_bricks")
    for z in range(29, 34):
        for y in range(F - 5, F):
            for x in (27, 30):
                t.set(x, y, z, brick(t))
    for z in range(29, 34):
        t.set(27, F + 1, z, "minecraft:dark_oak_fence")
    for x in (28, 29):
        t.set(x, F + 1, 29, "minecraft:dark_oak_fence")
    # the crypt: niches with the dead in the side walls, sarcophagi down the middle, an ossuary at the end
    for z in range(13, 27, 3):
        for x in (X0 + 1, X1 - 1):
            t.set(x, F - 4, z, AIR)
            t.set(x, F - 5, z, r.choice(("observer:skeleton", "observer:corpse")), {"minecraft:cardinal_direction": "north"})
    for z in range(14, 27, 4):
        for x in (21, 27):
            t.fill(x, F - 5, z, x, F - 5, z + 1, "minecraft:polished_blackstone")
            if r.random() < 0.5:
                t.set(x, F - 4, z, r.choice(("observer:skeleton", "observer:corpse")), {"minecraft:cardinal_direction": "north"})
            else:
                slab(t, x, F - 4, z, "minecraft:deepslate_brick_slab")
                slab(t, x, F - 4, z + 1, "minecraft:deepslate_brick_slab")
            candles(t, x + (1 if x == 21 else -1), F - 5, z, "red")
    for x in range(X0 + 2, X1 - 1):
        for y in range(F - 5, F - 2):
            if r.random() < 0.7:
                t.set(x, y, 12, "minecraft:bone_block", {"pillar_axis": r.choice(("x", "y", "z"))})
            elif r.random() < 0.6:
                t.set(x, y, 12, "minecraft:skeleton_skull", {"facing_direction": 3})
    t.chest(24, F - 5, 13, "loot_tables/rift/crypt.json", "south")
    t.set(23, F - 5, 13, "minecraft:soul_torch", {"torch_facing_direction": "top"})
    t.set(25, F - 5, 13, "minecraft:soul_torch", {"torch_facing_direction": "top"})
    for z in range(15, 28, 4):
        chandelier(t, 24, F - 2, z, 1)
    for _ in range(5):
        blood_pool(t, r.randint(20, 28), F - 5, r.randint(14, 27), r.uniform(0.7, 1.5))
    for _ in range(10):
        x, z = r.randint(X0 + 2, X1 - 2), r.randint(12, 28)
        if t.name_at(x, F - 2, z) == AIR:
            t.set(x, F - 2, z, "minecraft:web")
    lectern(t, 26, F - 5, 14, CRYPT_BOOK, "west")
    # ---- the bell tower, its door the church's door
    TX0, TX1, TZ0, TZ1 = 21, 27, 35, 41
    for x in range(TX0, TX1 + 1):
        for z in range(TZ0, TZ1 + 1):
            t.set(x, F, z, "minecraft:polished_deepslate")
            wall = x in (TX0, TX1) or z in (TZ0, TZ1)
            for y in range(F + 1, F + 23):
                t.set(x, y, z, brick(t) if wall else AIR)
            t.taken.add((x, z))
    for x in (TX0, TX1):
        for z in (TZ0, TZ1):
            t.fill(x, F, z, x, F + 22, z, "minecraft:polished_deepslate")
    for z in (TZ0, TZ1):
        for x in range(23, 26):
            for y in range(F + 1, F + 5):
                t.set(x, y, z, AIR)
        t.set(24, F + 5, z, AIR)
    for x in range(23, 26):
        t.set(x, F + 1, TZ1 + 1, "minecraft:stone_brick_stairs", {"weirdo_direction": NORTH, "upside_down_bit": False})
    # its floors: the ringing chamber, then the belfry open on all four sides, the bell hung in it
    for x in range(TX0 + 1, TX1):
        for z in range(TZ0 + 1, TZ1):
            t.set(x, F + 9, z, "minecraft:dark_oak_planks")
            t.set(x, F + 16, z, "minecraft:dark_oak_planks")
    ladder(t, TX0 + 1, F + 1, F + 22, TZ0 + 3, "east")
    t.set(TX0 + 1, F + 9, TZ0 + 3, "minecraft:ladder", {"facing_direction": FACE["east"]})
    t.set(TX0 + 1, F + 16, TZ0 + 3, "minecraft:ladder", {"facing_direction": FACE["east"]})
    for x in range(23, 26):
        for y in range(F + 17, F + 21):
            for z in (TZ0, TZ1):
                t.set(x, y, z, AIR)
    for z in range(37, 40):
        for y in range(F + 17, F + 21):
            for x in (TX0, TX1):
                t.set(x, y, z, AIR)
    t.set(24, F + 21, 38, "minecraft:dark_oak_planks")
    t.set(24, F + 20, 38, "minecraft:bell", {"attachment": "hanging", "direction": 0})
    # a rose window under the belfry
    for (dx, dy) in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1), (2, 0), (-2, 0), (0, 2), (0, -2)):
        t.set(24 + dx, F + 12 + dy, TZ1, "observer:rift_glass" if (dx or dy) else "minecraft:black_concrete")
    # the spire, and the crimson lamp on top of it (it can be seen through the mist)
    for i in range(0, 7):
        y = F + 23 + i
        x0, x1, z0, z1 = TX0 + i, TX1 - i, TZ0 + i, TZ1 - i
        if x0 > x1:
            break
        if x0 == x1:
            t.set(x0, y, z0, "minecraft:polished_deepslate")
            continue
        for x in range(x0, x1 + 1):
            stair(t, x, y, z0, "minecraft:deepslate_brick_stairs", SOUTH)
            stair(t, x, y, z1, "minecraft:deepslate_brick_stairs", NORTH)
        for z in range(z0 + 1, z1):
            stair(t, x0, y, z, "minecraft:deepslate_brick_stairs", EAST)
            stair(t, x1, y, z, "minecraft:deepslate_brick_stairs", WEST)
    top = F + 27
    t.set(24, top, 38, "minecraft:iron_bars")
    t.set(24, top + 1, 38, "observer:rift_lamp")
    t.set(24, top + 2, 38, "minecraft:iron_bars")
    # ---- the graveyard: rows of stones, open graves, a fence of bars, a mausoleum, dead trees
    stones = []
    for gx in list(range(4, 15, 3)) + list(range(35, 45, 3)):
        for gz in range(8, 44, 3):
            if 33 <= gx and gz >= 33:
                continue  # the mausoleum
            if r.random() < 0.18:
                continue
            stones.append((gx, gz))
    for (gx, gz) in stones:
        x, z = gx + r.choice((0, 0, 1)), gz
        if (x, z) not in t.h:
            continue
        y = t.h[(x, z)] + 1
        if r.random() < 0.22:
            # an open grave, the dead in it
            for dz in (1, 2):
                if (x, z + dz) in t.h:
                    t.set(x, t.h[(x, z + dz)], z + dz, AIR)
                    t.set(x, t.h[(x, z + dz)] - 1, z + dz, r.choice(("observer:skeleton", "observer:corpse")) if dz == 1 else AIR,
                          {"minecraft:cardinal_direction": "north"} if dz == 1 else None)
                    t.taken.add((x, z + dz))
            if (x + 1, z + 1) in t.h:
                t.set(x + 1, t.h[(x + 1, z + 1)] + 1, z + 1, "minecraft:coarse_dirt")
                t.taken.add((x + 1, z + 1))
        t.set(x, y, z, "observer:gravestone", {"minecraft:cardinal_direction": "south"})
        t.taken.add((x, z))
        if r.random() < 0.25:
            candles(t, x, y, z + 1, r.choice(("red", "black")))
            t.taken.add((x, z + 1))
    # the fence (bars on a low wall), broken in places, a gate in front
    for i in range(2, 46):
        for (x, z) in ((i, 3), (i, 45), (2, i), (45, i)):
            if (x, z) not in t.h:
                continue
            if z == 45 and 21 <= x <= 27:
                continue
            if r.random() < 0.12:
                continue
            y = t.h[(x, z)]
            t.set(x, y + 1, z, r.choice(("minecraft:mossy_cobblestone", "minecraft:cobblestone", "minecraft:stone_bricks")))
            if r.random() < 0.8:
                t.set(x, y + 2, z, "minecraft:iron_bars")
            t.taken.add((x, z))
    for x in (20, 28):
        y = t.h[(x, 45)]
        t.fill(x, y + 1, 45, x, y + 4, 45, "minecraft:stone_bricks")
        t.set(x, y + 5, 45, "minecraft:soul_lantern", {"hanging": False})
        t.taken.add((x, 45))
    # the mausoleum
    MX0, MX1, MZ0, MZ1 = 35, 42, 35, 42
    for x in range(MX0, MX1 + 1):
        for z in range(MZ0, MZ1 + 1):
            t.set(x, F, z, "minecraft:polished_deepslate")
            wall = x in (MX0, MX1) or z in (MZ0, MZ1)
            for y in range(F + 1, F + 6):
                t.set(x, y, z, castle_stone(t) if wall else AIR)
            t.set(x, F + 6, z, "minecraft:stone_bricks")
            t.taken.add((x, z))
    for i in range(0, 4):
        for x in range(MX0 + i, MX1 - i + 1):
            stair(t, x, F + 7 + i, MZ0 + i, "minecraft:stone_brick_stairs", SOUTH)
            stair(t, x, F + 7 + i, MZ1 - i, "minecraft:stone_brick_stairs", NORTH)
        for z in range(MZ0 + i + 1, MZ1 - i):
            stair(t, MX0 + i, F + 7 + i, z, "minecraft:stone_brick_stairs", EAST)
            stair(t, MX1 - i, F + 7 + i, z, "minecraft:stone_brick_stairs", WEST)
    for x in (38, 39):
        for y in range(F + 1, F + 4):
            t.set(x, y, MZ0, "minecraft:iron_bars" if y == F + 3 else AIR)
    t.fill(37, F + 1, 39, 40, F + 1, 40, "minecraft:polished_blackstone")
    t.set(38, F + 2, 39, "observer:corpse", {"minecraft:cardinal_direction": "east"})
    candles(t, 37, F + 2, 40, "black", 3)
    candles(t, 40, F + 2, 39, "red", 3)
    t.chest(39, F + 1, 41, "loot_tables/rift/mausoleum.json", "north")
    chandelier(t, 38, F + 5, 37, 1)
    blood_pool(t, 38.5, F + 1, 37.5, 1.2)
    # dead trees among the graves, a body hanged from one
    HANG_CHANCE[0] = 0.25
    keep = lambda x, z: not (15 <= x <= 33 and 7 <= z <= 43) and not (MX0 - 1 <= x <= MX1 + 1 and MZ0 - 1 <= z <= MZ1 + 1)
    forest(t, density=0.45, keep=keep, mind=6)
    plants(t, keep=keep, dead=1.6)
    # the edges of the piece run back into the woods
    HANG_CHANCE[0] = 0.05
    return t.finish()


# ----------------------------------------------------------------------------- the castle

def castle(seed):
    t = Piece("castle", seed)
    flat = lambda x, z: 1.0

    def kind(x, z):
        v = hash01(seed + 3, x, z)
        return "minecraft:gravel" if v < 0.2 else "minecraft:coarse_dirt" if v < 0.55 else "minecraft:podzol" if v < 0.8 else "observer:rift_moss"

    terrain(t, flat=flat, kind=kind)
    r = t.r
    W0, W1 = 4, 43       # the curtain wall's outer faces
    WT = F + 10          # its walk
    # ---- the curtain wall: two thick, a walk on top, battlements
    for i in range(W0, W1 + 1):
        for (x, z) in [(i, W0), (i, W0 + 1), (i, W1), (i, W1 - 1), (W0, i), (W0 + 1, i), (W1, i), (W1 - 1, i)]:
            for y in range(F - 1, WT + 1):
                t.set(x, y, z, "minecraft:polished_deepslate" if y <= F + 1 else castle_stone(t))
            t.taken.add((x, z))
    for i in range(W0, W1 + 1):
        for (x, z) in [(i, W0), (i, W1), (W0, i), (W1, i)]:
            if (x + z) % 2 == 0:
                t.set(x, WT + 1, z, castle_stone(t))
    # arrow slits
    for i in range(W0 + 6, W1 - 5, 5):
        for (x, z) in [(i, W0), (i, W1), (W0, i), (W1, i)]:
            for y in (F + 4, F + 5):
                t.set(x, y, z, "minecraft:iron_bars")
    # ---- the corner towers
    for (cx0, cz0) in ((1, 1), (39, 1), (1, 39), (39, 39)):
        tower(t, cx0, cz0, 8, F + 16)
    # ---- the gatehouse on the south wall
    for (gx0, gx1) in ((17, 21), (26, 30)):
        for x in range(gx0, gx1 + 1):
            for z in range(W1 - 3, W1 + 4):
                if (x, z) not in t.h:
                    continue
                wall = x in (gx0, gx1) or z in (W1 - 3, W1 + 3)
                for y in range(F - 1, F + 15):
                    t.set(x, y, z, castle_stone(t) if wall or y <= F else AIR)
                t.taken.add((x, z))
                if (x + z) % 2 == 0 and wall:
                    t.set(x, F + 15, z, castle_stone(t))
                elif not wall:
                    t.set(x, F + 14, z, "minecraft:stone_bricks")
        ladder(t, gx0 + 1, F + 1, F + 14, W1 - 2, "east")
        t.set(gx0 + 1, F + 14, W1 - 2, "minecraft:ladder", {"facing_direction": FACE["east"]})
        door = gx1 if gx0 == 17 else gx0
        for y in (F + 1, F + 2):
            t.set(door, y, W1 - 2, AIR)
        for y in (F + 4, F + 8):
            t.set(gx0 + 2, y, W1 + 3, "minecraft:iron_bars")
    for x in range(22, 26):
        for z in range(W1 - 3, W1 + 4):
            for y in range(F - 1, F + 15):
                inside = y <= F + 6 - (1 if x in (22, 25) else 0)
                t.set(x, y, z, ("minecraft:stone_bricks" if y == F else AIR) if (inside and y >= F) else castle_stone(t) if y > F else "minecraft:polished_deepslate")
            t.taken.add((x, z))
        t.set(x, F + 15, W1 + 3, castle_stone(t)) if x % 2 == 0 else None
        # the portcullis, half up, rusted
        for y in (F + 5, F + 6):
            t.set(x, y, W1, "minecraft:iron_bars")
        if r.random() < 0.5:
            t.set(x, F + 4, W1, "minecraft:iron_bars")
    for x in range(22, 26):
        t.set(x, F, W1 + 4, "minecraft:stone_bricks")
    # ---- the courtyard
    for x in range(W0 + 2, W1 - 1):
        for z in range(W0 + 2, W1 - 1):
            t.taken.discard((x, z))
    for z in range(27, W1 - 1):
        for x in range(22, 26):
            t.set(x, F, z, r.choice(("minecraft:cobblestone", "minecraft:stone_bricks", "minecraft:mossy_cobblestone", "minecraft:gravel")))
            t.kind[(x, z)] = "minecraft:cobblestone"
            t.taken.add((x, z))
    # stairs up to the walk, inside the west wall
    flight(t, W0 + 2, W0 + 3, 38, F + 1, 10, -1, "minecraft:stone_brick_stairs", "minecraft:stone_bricks")
    for z in range(27, 39):
        for x in (W0 + 2, W0 + 3):
            t.taken.add((x, z))
    # the gallows
    for (x, z) in ((10, 28), (10, 33)):
        t.fill(x, F + 1, z, x, F + 6, z, "minecraft:dark_oak_log", {"pillar_axis": "y"})
    for z in range(28, 34):
        t.set(10, F + 7, z, "minecraft:dark_oak_log", {"pillar_axis": "z"})
        t.set(10, F + 1, z, "minecraft:dark_oak_planks") if z in (28, 33) else slab(t, 10, F + 1, z, "minecraft:dark_oak_slab")
        t.taken.add((10, z))
    for z in (29, 30, 32):
        t.set(10, F + 6, z, "observer:hanged", {"observer:part": 1, "minecraft:cardinal_direction": "east"})
        t.set(10, F + 5, z, "observer:hanged", {"observer:part": 0, "minecraft:cardinal_direction": "east"})
        t.set(11, F + 1, z, "observer:blood", {"observer:splash": r.randint(0, 3)})
    stair(t, 11, F + 1, 31, "minecraft:dark_oak_stairs", WEST)
    # the well
    for x in range(34, 37):
        for z in range(30, 33):
            if (x, z) == (35, 31):
                for y in range(F - 5, F + 1):
                    t.set(x, y, z, AIR)
                t.set(x, F - 6, z, "minecraft:water")
            else:
                t.set(x, F + 1, z, "minecraft:mossy_cobblestone")
            t.taken.add((x, z))
    for (x, z) in ((34, 30), (36, 32)):
        t.fill(x, F + 2, z, x, F + 3, z, "minecraft:dark_oak_fence")
    for x in range(34, 37):
        for z in range(30, 33):
            slab(t, x, F + 4, z, "minecraft:dark_oak_slab")
    t.set(35, F + 3, 31, "minecraft:chain", {"pillar_axis": "y"})
    # the pyre: the dead heaped by a soul fire
    t.set(37, F + 1, 22, "minecraft:soul_campfire")
    for (x, z) in ((36, 21), (38, 21), (36, 23), (38, 23), (37, 24), (39, 22)):
        t.set(x, F + 1, z, r.choice(("observer:corpse", "observer:skeleton", "observer:corpse")),
              {"minecraft:cardinal_direction": r.choice(("north", "south", "east", "west"))})
        t.taken.add((x, z))
    t.set(37, F + 1, 20, "minecraft:hay_block", {"pillar_axis": "x"})
    blood_pool(t, 37, F + 1, 25.5, 1.6)
    # cages, with the dead in them
    for (x0, z0) in ((7, 18), (34, 35)):
        for x in range(x0, x0 + 3):
            for z in range(z0, z0 + 3):
                for y in range(F + 1, F + 4):
                    edge = x in (x0, x0 + 2) or z in (z0, z0 + 2)
                    t.set(x, y, z, "minecraft:iron_bars" if edge else AIR)
                t.set(x, F + 4, z, "minecraft:polished_blackstone")
                t.taken.add((x, z))
        t.set(x0 + 1, F + 1, z0 + 1, "observer:skeleton", {"minecraft:cardinal_direction": "north"})
        t.set(x0 + 1, F + 2, z0 + 2, AIR)
    # the dead tree in the courtyard, bodies hanged from it
    HANG_CHANCE[0] = 0.5
    t.taken.discard((29, 33))
    dead_pine(t, 29, 33, tall=14)
    # ---- the keep
    keep_build(t)
    # the courtyard's ground: dead grass, ferns, blood
    HANG_CHANCE[0] = 0.05
    inner = lambda x, z: W0 + 2 <= x <= W1 - 2 and W0 + 2 <= z <= W1 - 2 and not (12 <= x <= 35 and 8 <= z <= 27)
    plants(t, keep=inner, dead=2.0)
    # outside the walls: the woods come up to them
    outside = lambda x, z: not (W0 - 1 <= x <= W1 + 1 and W0 - 1 <= z <= W1 + 4)
    forest(t, density=0.3, keep=outside, mind=3.0)
    plants(t, keep=outside)
    return t.finish()


def tower(t, x0, z0, size, top):
    x1, z1 = x0 + size - 1, z0 + size - 1
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            wall = x in (x0, x1) or z in (z0, z1)
            for y in range(F - 1, top + 1):
                t.set(x, y, z, (castle_stone(t) if y > F + 1 else "minecraft:polished_deepslate") if (wall or y <= F) else AIR)
            t.set(x, F + 10, z, "minecraft:dark_oak_planks" if not wall else castle_stone(t))
            t.set(x, top, z, "minecraft:stone_bricks")
            if wall and (x + z) % 2 == 0:
                t.set(x, top + 1, z, castle_stone(t))
            t.taken.add((x, z))
    # slits, a door from the courtyard, a door onto each wall walk, a ladder up the middle
    for y in (F + 4, F + 5, F + 13, F + 14):
        for (x, z) in (((x0 + x1) // 2, z0), ((x0 + x1) // 2, z1), (x0, (z0 + z1) // 2), (x1, (z0 + z1) // 2)):
            t.set(x, y, z, "minecraft:iron_bars")
    inward_x = x1 if x0 < 20 else x0
    inward_z = z1 if z0 < 20 else z0
    # into the courtyard (the corner diagonally inward)
    for y in (F + 1, F + 2):
        t.set(inward_x, y, inward_z - (1 if z0 < 20 else -1) * 2, AIR)
        t.set(inward_x - (1 if x0 < 20 else -1) * 2, y, inward_z, AIR)
    for y in (F + 11, F + 12):
        t.set(inward_x, y, (z0 + z1) // 2 + (0 if z0 < 20 else 1), AIR)
        t.set((x0 + x1) // 2 + (0 if x0 < 20 else 1), y, inward_z, AIR)
    lx = x0 + 2 if x0 < 20 else x1 - 2
    lz = (z0 + z1) // 2
    face = "east" if x0 < 20 else "west"
    wallx = lx - 1 if x0 < 20 else lx + 1
    for y in range(F + 1, top):
        t.set(wallx, y, lz, "minecraft:stone_bricks")
    ladder(t, lx, F + 1, top, lz, face)
    t.set(lx, F + 10, lz, "minecraft:ladder", {"facing_direction": FACE[face]})
    chandelier(t, (x0 + x1) // 2 + (1 if x0 < 20 else -1), F + 9, (z0 + z1) // 2 + (1 if z0 < 20 else -1), 1)
    if t.r.random() < 0.7:
        t.set((x0 + x1) // 2, F + 1, (z0 + z1) // 2 + (1 if z0 < 20 else -1), t.r.choice(("observer:skeleton", "observer:corpse")),
              {"minecraft:cardinal_direction": "south"})


def keep_build(t):
    r = t.r
    K0, K1, KZ0, KZ1 = 12, 35, 8, 27
    FL = (F, F + 6, F + 12, F + 18)   # the floors' blocks: ground, second, third, roof
    for x in range(K0, K1 + 1):
        for z in range(KZ0, KZ1 + 1):
            wall = x in (K0, K1) or z in (KZ0, KZ1)
            for y in range(F - 7, F + 19):
                if wall:
                    name = "minecraft:polished_deepslate" if y <= F + 1 else brick(t) if r.random() < 0.5 else castle_stone(t)
                elif y in FL or y in (F - 7, F - 6, F - 1):
                    name = "minecraft:deepslate_tiles" if y == F + 18 else "minecraft:dark_oak_planks" if y in (F + 6, F + 12) else "minecraft:polished_deepslate"
                else:
                    name = AIR
                t.set(x, y, z, name)
            t.taken.add((x, z))
    for x in (K0, K1):
        for z in (KZ0, KZ1):
            t.fill(x, F - 7, z, x, F + 19, z, "minecraft:polished_deepslate")
    # battlements round the roof
    for x in range(K0, K1 + 1):
        for z in range(KZ0, KZ1 + 1):
            if (x in (K0, K1) or z in (KZ0, KZ1)) and (x + z) % 2 == 0:
                t.set(x, F + 19, z, castle_stone(t))
    # windows on every floor
    for base in (F + 2, F + 8, F + 14):
        for x in range(K0 + 3, K1 - 2, 4):
            for z in (KZ0, KZ1):
                if z == KZ1 and 21 <= x <= 26 and base == F + 2:
                    continue
                window(t, x, z, x + 1, z, base, base + 2, broken=0.25)
        for z in range(KZ0 + 3, KZ1 - 2, 4):
            for x in (K0, K1):
                window(t, x, z, x, z + 1, base, base + 2, broken=0.25)
    # the door, steps up to it
    for x in range(22, 26):
        for y in range(F + 1, F + 5):
            t.set(x, y, KZ1, AIR)
        t.set(x, F + 5, KZ1, AIR) if x in (23, 24) else None
    # ---- the great hall: the throne under the crimson eye, the long tables of a feast long rotted, the hearth
    for x in range(K0 + 1, K1):
        for z in range(KZ0 + 1, KZ0 + 4):
            t.set(x, F + 1, z, "minecraft:polished_blackstone_bricks")
        stair(t, x, F + 1, KZ0 + 4, "minecraft:polished_blackstone_brick_stairs", NORTH)
    stair(t, 23, F + 2, KZ0 + 1, "minecraft:polished_blackstone_brick_stairs", NORTH)
    stair(t, 24, F + 2, KZ0 + 1, "minecraft:polished_blackstone_brick_stairs", NORTH)
    for x in (22, 25):
        t.set(x, F + 2, KZ0 + 1, "minecraft:gold_block")
    t.set(23, F + 2, KZ0 + 3, "observer:corpse", {"minecraft:cardinal_direction": "west"})
    blood_pool(t, 23.5, F + 2, KZ0 + 2.5, 1.3)
    for (ex, ey) in ((21, F + 4), (22, F + 4), (23, F + 4), (24, F + 4), (25, F + 4), (26, F + 4), (22, F + 5), (23, F + 5), (24, F + 5),
                     (25, F + 5), (22, F + 3), (23, F + 3), (24, F + 3), (25, F + 3)):
        t.set(ex, ey, KZ0, "observer:rift_glass")
    for (ex, ey) in ((23, F + 4), (24, F + 4)):
        t.set(ex, ey, KZ0, "minecraft:black_concrete")
    for z in range(KZ0 + 5, KZ1):
        for x in (23, 24):
            if r.random() < 0.9:
                t.set(x, F + 1, z, "minecraft:red_carpet")
    for tx in (17, 30):
        for z in range(13, 23):
            t.set(tx, F + 1, z, "minecraft:dark_oak_planks")
            for side, rise in ((-1, WEST), (1, EAST)):
                if r.random() < 0.7:
                    stair(t, tx + side, F + 1, z, "minecraft:dark_oak_stairs", rise)
            v = r.random()
            if v < 0.18:
                t.set(tx, F + 2, z, "minecraft:skeleton_skull", {"facing_direction": 1})
            elif v < 0.36:
                candles(t, tx, F + 2, z, r.choice(("red", "black")))
            elif v < 0.46:
                t.set(tx, F + 2, z, "observer:blood", {"observer:splash": r.randint(0, 3)})
        t.set(tx - 2, F + 1, r.randint(14, 21), "observer:corpse", {"minecraft:cardinal_direction": "north"})
    for z in range(11, 25, 4):
        for x in (K0 + 2, K1 - 2):
            t.fill(x, F + 1, z, x, F + 5, z, "minecraft:polished_deepslate")
        chandelier(t, 20, F + 5, z + 2, 1)
        chandelier(t, 27, F + 5, z + 2, 1)
    # the Goatwalker's trophies on the walls, and torn cloth hung between them
    for z in range(12, 20, 3):
        t.set(K0 + 1, F + 4, z, "goatwalker:trophy_head", {"minecraft:cardinal_direction": WALL_FACE["west"]})
        t.set(K1 - 1, F + 4, z, "goatwalker:trophy_head", {"minecraft:cardinal_direction": WALL_FACE["east"]})
        t.set(K0 + 1, F + 3, z + 1, "goatwalker:tattered_cloth", {"minecraft:cardinal_direction": WALL_FACE["west"]})
        t.set(K1 - 1, F + 3, z + 1, "goatwalker:tattered_cloth", {"minecraft:cardinal_direction": WALL_FACE["east"]})
    # the hearth
    for x in range(K0 + 1, K0 + 2):
        for z in range(16, 20):
            t.set(x, F + 1, z, "minecraft:deepslate_bricks")
    t.set(K0 + 1, F + 1, 17, "minecraft:soul_campfire")
    t.set(K0 + 1, F + 1, 18, "minecraft:soul_campfire")
    # ---- stairs up: the west flight to the second floor, the east flight to the third
    flight(t, K0 + 1, K0 + 2, KZ1 - 1, F + 1, 6, -1, "minecraft:dark_oak_stairs", None)
    for z in range(KZ1 - 6, KZ1):
        for x in (K0 + 1, K0 + 2):
            if t.name_at(x, F + 6, z) == "minecraft:dark_oak_planks":
                t.set(x, F + 6, z, AIR)
    for z in range(KZ1 - 6, KZ1 - 1):
        t.set(K0 + 3, F + 7, z, "minecraft:dark_oak_fence")
    flight(t, K1 - 2, K1 - 1, KZ1 - 1, F + 7, 6, -1, "minecraft:dark_oak_stairs", None)
    for z in range(KZ1 - 6, KZ1):
        for x in (K1 - 2, K1 - 1):
            if t.name_at(x, F + 12, z) == "minecraft:dark_oak_planks":
                t.set(x, F + 12, z, AIR)
    for z in range(KZ1 - 6, KZ1 - 1):
        t.set(K1 - 3, F + 13, z, "minecraft:dark_oak_fence")
    # ---- the second floor: the armoury (west), the treasury behind bars (east)
    S = F + 7
    for z in range(KZ0 + 1, KZ1 - 7):
        for y in range(S, S + 5):
            t.set(21, y, z, brick(t))
            t.set(26, y, z, "minecraft:iron_bars")
    for y in (S, S + 1):
        t.set(21, y, KZ1 - 8, AIR)
        t.set(26, y, KZ1 - 8, AIR)
    t.chest(30, S, KZ0 + 1, "loot_tables/rift/castle_treasury.json", "south")
    t.chest(32, S, KZ0 + 1, "loot_tables/rift/castle_treasury.json", "south")
    t.chest(34, S, KZ0 + 3, "loot_tables/rift/castle_treasury.json", "west")
    for (x, z, b) in ((28, KZ0 + 1, "minecraft:gold_block"), (29, KZ0 + 1, "minecraft:gold_block"), (31, KZ0 + 1, "minecraft:diamond_block"),
                      (33, KZ0 + 1, "minecraft:gold_block"), (34, KZ0 + 1, "minecraft:netherite_block"), (28, KZ0 + 2, "minecraft:gold_block")):
        t.set(x, S, z, b)
    t.set(29, S + 1, KZ0 + 1, "minecraft:gold_block")
    t.set(30, S, KZ0 + 5, "observer:corpse", {"minecraft:cardinal_direction": "south"})
    t.set(32, S, KZ0 + 6, "observer:skeleton", {"minecraft:cardinal_direction": "east"})
    blood_pool(t, 31, S, KZ0 + 5, 1.6)
    chandelier(t, 30, S + 4, KZ0 + 4, 1)
    for z in (KZ0 + 2, KZ0 + 6):
        t.set(34, S + 3, z, "minecraft:chain", {"pillar_axis": "y"})
        t.set(34, S + 2, z, "minecraft:chain", {"pillar_axis": "y"})
    t.set(34, S, KZ0 + 6, "observer:skeleton", {"minecraft:cardinal_direction": "north"})
    # the armoury
    t.chest(14, S, KZ0 + 1, "loot_tables/rift/castle_armoury.json", "south", kind="barrel")
    t.chest(16, S, KZ0 + 1, "loot_tables/rift/castle_armoury.json", "south", kind="barrel")
    t.set(18, S, KZ0 + 1, "minecraft:anvil", {"direction": 1})
    for z in range(KZ0 + 3, KZ1 - 8, 2):
        t.set(20, S + 1, z, "minecraft:dark_oak_trapdoor", {"direction": 1, "open_bit": True})
        t.set(13, S + 1, z, "minecraft:dark_oak_trapdoor", {"direction": 0, "open_bit": True})
    t.set(17, S, KZ0 + 6, "observer:corpse", {"minecraft:cardinal_direction": "east"})
    chandelier(t, 17, S + 4, KZ0 + 4, 1)
    # ---- the third floor: the lord's chamber (west) and the library (east)
    T = F + 13
    for z in range(KZ0 + 1, KZ1 - 7):
        for y in range(T, T + 5):
            t.set(23, y, z, brick(t))
    for y in (T, T + 1):
        t.set(23, y, KZ0 + 6, AIR)
    # the lord's bed, the lord in it
    for x in (15, 16):
        for z in (KZ0 + 1, KZ0 + 2, KZ0 + 3):
            t.set(x, T, z, "minecraft:red_wool" if z > KZ0 + 1 else "minecraft:dark_oak_planks")
    for (x, z) in ((14, KZ0 + 1), (17, KZ0 + 1), (14, KZ0 + 3), (17, KZ0 + 3)):
        t.fill(x, T, z, x, T + 2, z, "minecraft:dark_oak_fence")
    t.set(15, T + 1, KZ0 + 2, "observer:corpse", {"minecraft:cardinal_direction": "south"})
    blood_pool(t, 16, T + 1, KZ0 + 3, 1.0)
    t.chest(19, T, KZ0 + 1, "loot_tables/rift/castle_lord.json", "south")
    t.set(20, T, KZ0 + 1, "minecraft:bookshelf")
    t.set(13, T, KZ0 + 5, "minecraft:bookshelf")
    chandelier(t, 18, T + 4, KZ0 + 4, 1)
    # the library: shelves, a lectern, a ritual drawn on the floor with the dead round it
    for z in range(KZ0 + 1, KZ1 - 7):
        for y in range(T, T + 4):
            t.set(K1 - 1, y, z, "minecraft:bookshelf")
    for x in range(25, K1 - 1):
        for y in range(T, T + 4):
            t.set(x, y, KZ0 + 1, "minecraft:bookshelf" if r.random() > 0.15 else AIR)
    lectern(t, 28, T, KZ0 + 5, CASTLE_BOOK, "west")
    for (dx, dz) in ((0, 0), (1, 0), (0, 1), (1, 1), (-1, 0), (0, -1), (2, 1), (1, 2)):
        t.set(29 + dx, T, KZ0 + 8 + dz, "goatwalker:ritual_marking_floor", {"minecraft:cardinal_direction": "north"})
    for (x, z) in ((27, KZ0 + 7), (32, KZ0 + 7), (27, KZ0 + 11), (32, KZ0 + 11)):
        candles(t, x, T, z, "black", 3)
    t.set(30, T, KZ0 + 11, "observer:skeleton", {"minecraft:cardinal_direction": "north"})
    chandelier(t, 29, T + 4, KZ0 + 8, 2)
    # ---- the roof, a hatch up to it, the tower with the crimson lamp
    R = F + 18
    for y in range(T, R + 1):
        t.set(K0 + 1, y, KZ1 - 8, "minecraft:ladder", {"facing_direction": FACE["east"]})
    TX0, TX1, TZ0, TZ1 = 21, 26, 13, 18
    for x in range(TX0, TX1 + 1):
        for z in range(TZ0, TZ1 + 1):
            wall = x in (TX0, TX1) or z in (TZ0, TZ1)
            for y in range(R + 1, R + 11):
                t.set(x, y, z, brick(t) if wall else AIR)
            t.set(x, R + 11, z, "minecraft:deepslate_tiles")
            if wall and (x + z) % 2 == 0:
                t.set(x, R + 12, z, castle_stone(t))
    for y in (R + 1, R + 2):
        t.set(23, y, TZ1, AIR)
        t.set(24, y, TZ1, AIR)
    for y in (R + 6, R + 7):
        for (x, z) in ((23, TZ0), (24, TZ1), (TX0, 15), (TX1, 16)):
            t.set(x, y, z, "observer:rift_glass")
    ladder(t, TX0 + 1, R + 1, R + 11, 15, "east")
    t.set(TX0, R + 1, 15, brick(t))
    t.set(23, R + 12, 15, "observer:rift_lamp")
    t.set(24, R + 12, 16, "observer:rift_lamp")
    t.set(23, R + 13, 15, "minecraft:iron_bars")
    t.set(24, R + 13, 16, "observer:rift_lamp")
    t.set(24, R + 14, 16, "minecraft:iron_bars")
    # ---- the dungeon (floor F-6, cells F-5..F-2): a corridor, cells either side behind bars, the warden's chest
    D = F - 5
    ladder(t, K1 - 1, D, F, 18, "west")
    t.set(K1 - 1, F + 1, 18, AIR)
    for x in range(K0 + 1, K1):
        for z in (17, 20):
            for y in range(D, D + 4):
                t.set(x, y, z, "minecraft:iron_bars")
    for cx in range(K0 + 5, K1, 5):
        for z in list(range(KZ0 + 1, 17)) + list(range(21, KZ1)):
            for y in range(D, D + 4):
                t.set(cx, y, z, brick(t))
    for cx0 in range(K0 + 1, K1 - 1, 5):
        for (z0, z1, gate) in ((KZ0 + 1, 16, 17), (21, KZ1 - 1, 20)):
            gx = cx0 + 2
            if gx >= K1:
                continue
            for y in (D, D + 1):
                t.set(gx, y, gate, AIR)
            v = r.random()
            mx, mz = cx0 + 1, (z0 + z1) // 2
            t.set(mx, D, mz, r.choice(("observer:skeleton", "observer:corpse")), {"minecraft:cardinal_direction": r.choice(("north", "south", "east", "west"))})
            if v < 0.5:
                for k in range(3):
                    t.set(cx0 + 3, D + 3 - k, z0 + 1, "minecraft:chain", {"pillar_axis": "y"})
            if r.random() < 0.5:
                t.set(cx0 + 2, D, z0, "minecraft:hay_block", {"pillar_axis": "x"})
            blood_pool(t, mx + 1, D, mz, 1.1)
            if r.random() < 0.4:
                t.set(cx0 + 3, D, z1, "minecraft:bone_block", {"pillar_axis": "y"})
    t.chest(K0 + 2, D, KZ0 + 2, "loot_tables/rift/dungeon.json", "south")
    t.set(K0 + 3, D, KZ0 + 2, "minecraft:cauldron", {"cauldron_liquid": "lava", "fill_level": 6})
    for x in range(K0 + 2, K1 - 1, 4):
        chandelier(t, x, D + 3, 18, 1)
        if r.random() < 0.6:
            t.set(x + 1, D, 19, "observer:blood", {"observer:splash": r.randint(0, 3)})
    for _ in range(8):
        x, z = r.randint(K0 + 1, K1 - 1), r.randint(KZ0 + 1, KZ1 - 1)
        if t.name_at(x, D + 3, z) == AIR:
            t.set(x, D + 3, z, "minecraft:web")


# ----------------------------------------------------------------------------- lore (original)

RIFT_BOOK = ("The Rift", "Brother Caine", [
    "It opens where it\nlikes. A wound in\nthe air, purple and\nfull of stars, and\nwarm, like breath.\n\nWe walked in.",
    "The woods on the\nother side are its.\nThe pines are dead\nand do not rot. The\nrain does not stop.\nNothing lives here.\n\nNothing but it.",
    "We built this church\nto hold it out. It\nsat in the back pew\nduring the first\nmass. Nobody saw it\ncome in.",
    "The more often the\nwound opens, the\nhungrier it is when\nyou come through.\nIt learns faster.\nIt runs faster.\nIt does not tire.",
    "There is a way back:\nthe stones where you\nwoke. Run for them.\n\nDo not stop for the\ngold.\n\nYou will stop for\nthe gold.",
])
CRYPT_BOOK = ("Ossuary", "the sexton", [
    "I have counted the\nbones twice. There\nare more than there\nwere. Nobody new\nhas been buried.",
    "The skulls face the\nstairs now. I turned\nthem to the wall.\nIn the morning they\nfaced the stairs.",
    "It walks the crypt\nat night. It does\nnot need the stairs.",
])
CASTLE_BOOK = ("The Castellan's Account", "the last castellan", [
    "We held these walls\nagainst everything\nthat came out of the\ntrees. Wolves. Men.\nThe goat-thing.\n\nThe goat-thing knelt\nwhen it came.",
    "It does not come\nthrough the gate. It\nis simply in the\ncourtyard, and then\nit is on the walls,\nand then it is in\nthe hall.",
    "The treasury is\nfull. We filled it.\nWe thought it might\nwant gold.\n\nIt wants whoever\ncomes for the gold.",
    "I am writing this\nin the library. The\ncandles are lit.\nI did not light\nthem.\n\nIt is on the stairs.",
])


# ----------------------------------------------------------------------------- loot: the best in the game

def item(name, weight, lo=1, hi=1, fns=None):
    return MS.item(name, weight, lo, hi, fns)


def ench(*pairs):
    return [{"function": "specific_enchants", "enchants": [{"id": k, "level": v} for k, v in pairs]}]


SWORD = ench(("sharpness", 5), ("unbreaking", 3), ("mending", 1), ("fire_aspect", 2), ("looting", 3), ("knockback", 2))
AXE = ench(("sharpness", 5), ("efficiency", 5), ("unbreaking", 3), ("mending", 1))
PICK = ench(("efficiency", 5), ("fortune", 3), ("unbreaking", 3), ("mending", 1))
ARMOR = ench(("protection", 4), ("unbreaking", 3), ("mending", 1))
HELM = ench(("protection", 4), ("unbreaking", 3), ("mending", 1), ("respiration", 3), ("aqua_affinity", 1))
BOOTS = ench(("protection", 4), ("unbreaking", 3), ("mending", 1), ("feather_falling", 4), ("depth_strider", 3))
LEGS = ench(("protection", 4), ("unbreaking", 3), ("mending", 1), ("swift_sneak", 3))
BOW = ench(("power", 5), ("punch", 2), ("flame", 1), ("infinity", 1), ("unbreaking", 3))
TRIDENT = ench(("loyalty", 3), ("channeling", 1), ("impaling", 5), ("unbreaking", 3), ("mending", 1))
ELYTRA = ench(("unbreaking", 3), ("mending", 1))
MACE = ench(("density", 5), ("wind_burst", 3), ("unbreaking", 3), ("mending", 1))
CROSSBOW = ench(("quick_charge", 3), ("multishot", 1), ("unbreaking", 3), ("mending", 1))

GOD_GEAR = [
    item("minecraft:netherite_sword", 6, 1, 1, SWORD), item("minecraft:netherite_axe", 4, 1, 1, AXE),
    item("minecraft:netherite_pickaxe", 5, 1, 1, PICK), item("minecraft:netherite_helmet", 5, 1, 1, HELM),
    item("minecraft:netherite_chestplate", 5, 1, 1, ARMOR), item("minecraft:netherite_leggings", 5, 1, 1, LEGS),
    item("minecraft:netherite_boots", 5, 1, 1, BOOTS), item("minecraft:bow", 4, 1, 1, BOW), item("minecraft:elytra", 3, 1, 1, ELYTRA),
    item("minecraft:trident", 3, 1, 1, TRIDENT), item("minecraft:mace", 2, 1, 1, MACE), item("minecraft:crossbow", 3, 1, 1, CROSSBOW),
]
BOOKS = [item("minecraft:book", 4, 1, 1, ench((k, v))) for k, v in (("mending", 1), ("sharpness", 5), ("protection", 4), ("efficiency", 5),
                                                                   ("fortune", 3), ("looting", 3), ("unbreaking", 3), ("feather_falling", 4),
                                                                   ("silk_touch", 1), ("power", 5))]
RICHES = [item("minecraft:diamond", 10, 4, 12), item("minecraft:netherite_ingot", 6, 1, 3), item("minecraft:emerald_block", 5, 1, 4),
          item("minecraft:gold_block", 6, 2, 6), item("minecraft:diamond_block", 2, 1, 2), item("minecraft:experience_bottle", 10, 16, 48),
          item("minecraft:enchanted_golden_apple", 5, 1, 2), item("minecraft:golden_apple", 8, 2, 6), item("minecraft:totem_of_undying", 5, 1, 1),
          item("minecraft:golden_carrot", 6, 8, 24), item("minecraft:ender_pearl", 6, 4, 12)]
OBSERVER = [item("observer:flare", 6, 2, 6), item("observer:witness_lens", 3, 1, 1), item("observer:ward_lantern", 3, 1, 1),
            item("observer:cold_eye", 3, 1, 2)]

LOOT = {
    "church_altar": {"pools": [
        {"rolls": {"min": 6, "max": 9}, "entries": RICHES + OBSERVER},
        {"rolls": {"min": 1, "max": 2}, "entries": GOD_GEAR},
        {"rolls": 2, "entries": BOOKS},
    ]},
    "crypt": {"pools": [
        {"rolls": {"min": 5, "max": 8}, "entries": RICHES + [item("minecraft:bone", 8, 4, 16), item("minecraft:echo_shard", 4, 2, 6),
                                                             item("minecraft:music_disc_11", 2), item("minecraft:music_disc_13", 2),
                                                             item("minecraft:netherite_scrap", 5, 2, 4)] + OBSERVER},
        {"rolls": 1, "entries": GOD_GEAR},
        {"rolls": 2, "entries": BOOKS},
    ]},
    "mausoleum": {"pools": [
        {"rolls": {"min": 5, "max": 7}, "entries": RICHES + [item("minecraft:echo_shard", 4, 1, 4), item("minecraft:netherite_upgrade_smithing_template", 3, 1, 2)]},
        {"rolls": 1, "entries": GOD_GEAR},
        {"rolls": 1, "entries": BOOKS},
    ]},
    "castle_treasury": {"pools": [
        {"rolls": {"min": 8, "max": 12}, "entries": RICHES + [item("minecraft:nether_star", 3, 1, 1), item("minecraft:beacon", 2, 1, 1),
                                                              item("minecraft:heart_of_the_sea", 2, 1, 1), item("minecraft:shulker_shell", 4, 2, 4),
                                                              item("minecraft:netherite_block", 1, 1, 1)]},
        {"rolls": {"min": 2, "max": 3}, "entries": GOD_GEAR},
        {"rolls": 2, "entries": BOOKS},
    ]},
    "castle_armoury": {"pools": [
        {"rolls": {"min": 3, "max": 4}, "entries": GOD_GEAR},
        {"rolls": {"min": 3, "max": 5}, "entries": [item("minecraft:arrow", 8, 32, 64), item("minecraft:shield", 5, 1, 1, ench(("unbreaking", 3), ("mending", 1))),
                                                    item("minecraft:golden_apple", 6, 2, 6), item("minecraft:totem_of_undying", 3, 1, 1),
                                                    item("minecraft:netherite_ingot", 3, 1, 2), item("observer:flare", 5, 2, 6)]},
    ]},
    "castle_lord": {"pools": [
        {"rolls": {"min": 5, "max": 8}, "entries": RICHES + OBSERVER + [item("minecraft:name_tag", 3, 1, 2), item("minecraft:saddle", 2)]},
        {"rolls": {"min": 1, "max": 2}, "entries": GOD_GEAR},
        {"rolls": 2, "entries": BOOKS},
    ]},
    "dungeon": {"pools": [
        {"rolls": {"min": 5, "max": 8}, "entries": RICHES + [item("minecraft:bone", 8, 4, 16), item("minecraft:iron_ingot", 8, 6, 18),
                                                             item("minecraft:iron_chain", 4, 2, 6), item("minecraft:netherite_scrap", 5, 1, 4)]},
        {"rolls": 1, "entries": GOD_GEAR + [{"type": "empty", "weight": 12}]},
        {"rolls": 1, "entries": BOOKS},
    ]},
    "traveller": {"pools": [
        {"rolls": {"min": 4, "max": 6}, "entries": [item("minecraft:bread", 8, 2, 6), item("minecraft:cooked_beef", 8, 2, 6), item("minecraft:arrow", 6, 8, 24),
                                                    item("minecraft:iron_ingot", 8, 3, 9), item("minecraft:gold_ingot", 6, 2, 8),
                                                    item("minecraft:diamond", 4, 1, 4), item("minecraft:golden_apple", 4, 1, 3),
                                                    item("minecraft:ender_pearl", 4, 1, 4), item("minecraft:experience_bottle", 6, 4, 16)] + OBSERVER},
        {"rolls": 1, "entries": BOOKS + [{"type": "empty", "weight": 20}]},
    ]},
}


# ----------------------------------------------------------------------------- out

PIECES = {
    "woods_1": lambda: woods(16001), "woods_2": lambda: woods(16002), "woods_3": lambda: woods(16003), "woods_4": lambda: woods(16004),
    "edge_1": lambda: edge_piece(16101), "edge_2": lambda: edge_piece(16102), "edge_3": lambda: edge_piece(16103),
    "corner_1": lambda: edge_piece(16201, corner=True), "corner_2": lambda: edge_piece(16202, corner=True),
    "landing": lambda: landing(16301), "church": lambda: church(16401), "castle": lambda: castle(16501),
}


def main():
    names_only = "--names" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = []
    stats = {}
    for name, fn in PIECES.items():
        if only and name not in only:
            continue
        t = fn()
        if names_only:
            continue
        stats[name] = sum(1 for c in t.cells.values() if c[0] != AIR)
        out.append(t.write(os.path.join(BP, "structures", "rift", f"{name}.mcstructure")))
    if names_only:
        print(" ".join(sorted(USED | {"minecraft:lectern"})))
        return
    missing = sorted(n for n in USED if n not in STATES)
    if missing:
        print("MISSING STATES (ask the server):", " ".join(missing))
        sys.exit(1)
    for name, table in LOOT.items():
        p = os.path.join(BP, "loot_tables", "rift", f"{name}.json")
        with open(p, "w") as f:
            json.dump(table, f, indent=2)
            f.write("\n")
        out.append(p)
    for p in out:
        print(os.path.relpath(p, ROOT), stats.get(os.path.splitext(os.path.basename(p))[0], ""))


if __name__ == "__main__":
    main()
