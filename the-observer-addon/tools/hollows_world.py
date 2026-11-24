#!/usr/bin/env python3
"""The Hollows' great chambers (1.7.0): hollow places carved deep in the Shaftbreaker's caves, organic and foul — drawn
block by block here and written as .mcstructure files that its world generation places underground (like the
Brinesleeper's great halls: before the rest of the caves' decoration, in the Hollows only).

  hollows/flesh_cavern_0..1   a great cavern lined with flesh and veinstone, giant ribs arching over it, organ cores in
                              the walls with bloodroot weeping from them, dripfangs, watcher pods, thorns and glowspores
                              on a floor of bloodmoss round a pool (blood-red in the Hollows), and the dead
  hollows/rib_hall_0..1       a long hall through a ribcage: arch after arch of bone, flesh between, a stream of blood
  hollows/heart_chamber       a round chamber round a heart: a mass of organ cores and pulsing flesh, tied to the walls by
                              vines of bloodroot, watcher pods round it
  hollows/mine_collapse       an old mine gallery the Hollows have taken: timber supports, a ladder, lanterns long out,
                              the miners who did not get out, the flesh creeping over all of it

Every cell outside a chamber's lining is a structure void (the rock round it stays as it is); the hollow inside is
written as air, so it carves itself out of the rock. Block states: the server's own (tools/hollows_states.json, as
for the Rift: tools/rift_world.py --names / otest:states).

Usage: python3 tools/hollows_world.py [--names]
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_structures as MS  # noqa: E402
from rift_world import hash01, vnoise, smooth  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
STATE_FILES = [os.path.join(ROOT, "tools", "hollows_states.json"), os.path.join(ROOT, "tools", "rift_states.json")]
STATES, TYPES = {}, {}
for f in STATE_FILES:
    if os.path.exists(f):
        for k, v in json.load(open(f)).items():
            if k in STATES:
                continue
            STATES[k] = v["states"] if isinstance(v, dict) and "states" in v else v
            if isinstance(v, dict) and "type" in v:
                TYPES[k] = v["type"]
USED = set()
AIR = "minecraft:air"
VOID = "minecraft:structure_void"
SB = "shaftbreaker:"


def n3(seed, x, y, z, s):
    """A cheap 3D noise from two 2D ones."""
    return 0.5 * (vnoise(seed, x + 0.37 * y, z, s) + vnoise(seed + 9, x, z + 0.53 * y, s))


class Chamber(MS.Structure):
    def __init__(self, name, size, seed):
        super().__init__(*size)
        self.name = name
        self.seed = seed
        self.r = random.Random(seed)
        self.hollow = set()   # cells carved out (air or what stands in the air)
        self.lining = set()   # the organic wall cells

    def set(self, x, y, z, name, states=None, be=None):
        USED.add(name)
        sx, sy, sz = self.size
        if not (0 <= x < sx and 0 <= y < sy and 0 <= z < sz):
            return
        st = dict(STATES.get(name, {}))
        if states:
            for k, v in states.items():
                if name in STATES and k not in STATES[name]:
                    raise KeyError(f"{name} has no state {k}")
                st[k] = v
        self.cells[(x, y, z)] = (TYPES.get(name, name), st, be)

    def at(self, x, y, z):
        c = self.cells.get((x, y, z))
        return c[0] if c else None

    def is_air(self, x, y, z):
        return self.at(x, y, z) == AIR

    def is_wall(self, x, y, z):
        n = self.at(x, y, z)
        return n is not None and n != AIR and (x, y, z) in self.lining

    def pick(self, *opts):
        tot = sum(w for _, w in opts)
        v = self.r.random() * tot
        for n, w in opts:
            v -= w
            if v <= 0:
                return n
        return opts[-1][0]


def flesh(t, x, y, z):
    """The lining: veinstone mostly, flesh in bands, its cracks glowing, now and then a seam of bone."""
    v = n3(t.seed + 3, x, y, z, 5)
    w = hash01(t.seed + 4, x * 31 + y, z)
    if v > 0.42:
        return SB + ("pulsing_flesh" if w < 0.35 else "fleshstone")
    if v < -0.5:
        return "minecraft:deepslate" if w < 0.5 else SB + "veinstone"
    if w < 0.06:
        return SB + "cracked_veinstone"
    if w < 0.09:
        return SB + "ribstone"
    return SB + "veinstone"


def carve(t, inside, floor_at=None, shell=2.4, pool=None):
    """Carve the hollow where inside(x, y, z) <= 1 (a distance-like measure), line it, lay its floor."""
    sx, sy, sz = t.size
    for x in range(sx):
        for z in range(sz):
            fl = floor_at(x, z) if floor_at else -1
            for y in range(sy):
                d = inside(x, y, z)
                if d <= 1 and y > fl:
                    t.set(x, y, z, AIR)
                    t.hollow.add((x, y, z))
                elif d <= 1 + shell / 10 or (d <= 1 and y <= fl):
                    t.set(x, y, z, flesh(t, x, y, z))
                    t.lining.add((x, y, z))
    if pool:
        px, pz, pr = pool
        for (x, y, z) in list(t.hollow):
            if math.hypot(x - px, z - pz) <= pr + 1.2 * vnoise(t.seed + 50, x, z, 3) and not t.is_air(x, y - 1, z) and (x, y - 1, z) in t.lining:
                # the pool: one deep, held in by the floor round it
                ring = all(t.at(x + dx, y, z + dz) in (AIR, "minecraft:water") or (x + dx, y, z + dz) in t.lining for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                if ring and all(((x + dx, y - 1, z + dz) in t.lining) or t.at(x + dx, y - 1, z + dz) == "minecraft:water" for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    t.set(x, y - 1, z, "minecraft:water")
                    t.lining.discard((x, y - 1, z))
    # anything the pool left open to the void below is closed (no water may run out)
    for (x, y, z), (n, _, _) in list(t.cells.items()):
        if n == "minecraft:water":
            for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, -1, 0)):
                q = (x + dx, y + dy, z + dz)
                if q not in t.cells:
                    t.set(*q, SB + "fleshstone")
                    t.lining.add(q)


def floors(t):
    """Cells of the hollow with lining under them (where things stand)."""
    return [c for c in t.hollow if t.is_air(*c) and (c[0], c[1] - 1, c[2]) in t.lining]


def ceilings(t):
    return [c for c in t.hollow if t.is_air(*c) and (c[0], c[1] + 1, c[2]) in t.lining]


def walls(t):
    out = []
    for (x, y, z) in t.hollow:
        if not t.is_air(x, y, z):
            continue
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (x + dx, y, z + dz) in t.lining:
                out.append((x, y, z, dx, dz))
                break
    return out


def dress(t, density=1.0, dead=1.0):
    """The organic dressing of a hollow: bloodmoss on the floor, thorns, glowspores, watcher pods, organ cores in the walls
    weeping bloodroot, dripfangs from the ceiling, and the dead."""
    r = t.r
    fl = floors(t)
    r.shuffle(fl)
    for (x, y, z) in fl:
        if not t.is_air(x, y, z):
            continue
        v = r.random() / density
        if v < 0.22:
            t.set(x, y, z, SB + "bloodmoss")
        elif v < 0.255:
            t.set(x, y, z, SB + "crimson_thorns")
        elif v < 0.285:
            t.set(x, y, z, SB + "glowspore_cluster")
        elif v < 0.297:
            t.set(x, y, z, SB + "watcher_pod", {"shaftbreaker:open": r.random() < 0.3})
        elif v < 0.31 * dead and v >= 0.297:
            t.set(x, y, z, r.choice(("observer:skeleton", "observer:corpse")), {"minecraft:cardinal_direction": r.choice(("north", "south", "east", "west"))})
        elif v < 0.33 and v >= 0.31:
            t.set(x, y, z, "observer:blood", {"observer:splash": r.randint(0, 3)})
        elif v < 0.336:
            t.set(x, y, z, "minecraft:bone_block", {"pillar_axis": r.choice(("x", "y", "z"))})
        elif v < 0.34:
            t.set(x, y, z, "minecraft:skeleton_skull", {"facing_direction": 1})
    # organ cores set in the walls, bloodroot weeping from them
    wl = walls(t)
    r.shuffle(wl)
    for (x, y, z, dx, dz) in wl[: int(len(wl) * 0.012 * density)]:
        wx, wz = x + dx, z + dz
        t.set(wx, y, wz, SB + ("cracked_organ_core" if r.random() < 0.3 else "organ_core"))
        t.lining.add((wx, y, wz))
        n = r.randint(2, 6)
        for k in range(1, n + 1):
            if not t.is_air(x, y - k, z) or (x, y - k - 1, z) in t.lining:
                break
            t.set(x, y - k, z, SB + "bloodroot_vines", {"shaftbreaker:tip": k == n})
        # the flesh round it pulses
        for ddx, ddy, ddz in ((0, 1, 0), (0, -1, 0), (dz, 0, dx), (-dz, 0, -dx)):
            q = (wx + ddx, y + ddy, wz + ddz)
            if q in t.lining and r.random() < 0.7:
                t.set(*q, SB + "pulsing_flesh")
    # pulsing flesh in patches on the walls
    for (x, y, z, dx, dz) in wl[: int(len(wl) * 0.06 * density)]:
        q = (x + dx, y, z + dz)
        if t.at(*q) and SB + "organ_core" not in t.at(*q):
            t.set(*q, SB + "pulsing_flesh")
    # the ceiling: dripfangs, bloodroot
    cl = ceilings(t)
    r.shuffle(cl)
    for (x, y, z) in cl[: int(len(cl) * 0.07 * density)]:
        if r.random() < 0.55:
            n = r.randint(1, 3)
            for k in range(n):
                if not t.is_air(x, y - k, z):
                    break
                t.set(x, y - k, z, SB + "dripfang", {"shaftbreaker:tip": k == n - 1})
        else:
            n = r.randint(2, 8)
            for k in range(n):
                if not t.is_air(x, y - k, z) or (x, y - k - 1, z) in t.lining:
                    break
                t.set(x, y - k, z, SB + "bloodroot_vines", {"shaftbreaker:tip": k == n - 1})


def rib(t, z0, cx, floor_y, top_y, half_w, thick=2, axis="z"):
    """One great rib: an arch of bone from floor to floor over the hollow, across the axis at z0 (or x0)."""
    steps = 80
    for i in range(steps + 1):
        a = math.pi * i / steps
        u = cx + half_w * math.cos(a)
        y = floor_y + (top_y - floor_y) * math.sin(a)
        for du in range(thick):
            for dy in range(thick):
                for dw in range(thick):
                    pos = (int(round(u)) + du, int(round(y)) + dy, z0 + dw) if axis == "z" else (z0 + dw, int(round(y)) + dy, int(round(u)) + du)
                    if pos in t.hollow:
                        t.set(*pos, SB + "ribstone")
                        t.hollow.discard(pos)
                        t.lining.add(pos)


# ----------------------------------------------------------------------------- the chambers

def flesh_cavern(seed):
    t = Chamber("flesh_cavern", (64, 36, 64), seed)
    c = (31.5, 16, 31.5)
    rx, ry, rz = 27, 14, 27

    def inside(x, y, z):
        return ((x - c[0]) / rx) ** 2 + ((y - c[1]) / ry) ** 2 + ((z - c[2]) / rz) ** 2 + 0.22 * n3(seed, x, y, z, 6)

    floor_at = lambda x, z: int(7 + 2.2 * vnoise(seed + 1, x, z, 9) + 3 * smooth(math.hypot(x - c[0], z - c[2]) / 26))
    carve(t, inside, floor_at, pool=(c[0] + t.r.randint(-6, 6), c[2] + t.r.randint(-6, 6), 6.5))
    # giant ribs over it
    for k, zr in enumerate(range(12, 54, 8)):
        rib(t, zr, c[0], 8, 26 - abs(zr - c[2]) * 0.25, 22 - abs(zr - c[2]) * 0.35, thick=2)
    dress(t, 1.0)
    # mine supports on one side: the miners got this far
    mine_frame(t, 10, 26, 3)
    return t


def rib_hall(seed):
    t = Chamber("rib_hall", (30, 26, 64), seed)
    cx = 14.5

    def inside(x, y, z):
        wob = 2.2 * vnoise(seed + 2, z, y, 7)
        return ((x - cx - wob) / 10.5) ** 2 + ((y - 11) / 10) ** 2 + 0.18 * n3(seed, x, y, z, 5) + (max(0, 3 - z) + max(0, z - 60)) * 0.4

    floor_at = lambda x, z: int(4 + 1.5 * vnoise(seed + 1, x, z, 6))
    carve(t, inside, floor_at)
    for z0 in range(5, 60, 5):
        rib(t, z0, cx, 4, 19 + 1.5 * math.sin(z0 / 7), 9, thick=2)
    # the stream of blood down its middle
    for z in range(4, 60):
        x = int(round(cx + 2.2 * vnoise(seed + 2, z, 6, 7)))
        for dx in (0, 1):
            fy = None
            for y in range(1, 25):
                if (x + dx, y, z) in t.hollow and (x + dx, y - 1, z) in t.lining:
                    fy = y
                    break
            if fy is not None and all((x + dx + a, fy - 1, z + b) in t.lining or t.at(x + dx + a, fy - 1, z + b) == "minecraft:water" for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                t.set(x + dx, fy - 1, z, "minecraft:water")
                t.lining.discard((x + dx, fy - 1, z))
    for (x, y, z), (n, _, _) in list(t.cells.items()):
        if n == "minecraft:water":
            for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, -1, 0)):
                q = (x + dx, y + dy, z + dz)
                if q not in t.cells or t.at(*q) == AIR and q not in t.hollow:
                    t.set(*q, SB + "fleshstone")
                    t.lining.add(q)
    dress(t, 1.2)
    return t


def heart_chamber(seed):
    t = Chamber("heart_chamber", (44, 34, 44), seed)
    c = (21.5, 15, 21.5)

    def inside(x, y, z):
        return ((x - c[0]) / 19) ** 2 + ((y - c[1]) / 14) ** 2 + ((z - c[2]) / 19) ** 2 + 0.2 * n3(seed, x, y, z, 5)

    floor_at = lambda x, z: int(4 + 2 * smooth(math.hypot(x - c[0], z - c[2]) / 17) + 1.2 * vnoise(seed + 1, x, z, 5))
    carve(t, inside, floor_at)
    # the heart: a mass of organ cores and pulsing flesh, hung in the middle
    hx, hy, hz = 21, 14, 21
    for x in range(hx - 5, hx + 6):
        for y in range(hy - 5, hy + 6):
            for z in range(hz - 5, hz + 6):
                d = ((x - hx) / 4.6) ** 2 + ((y - hy) / 5.2) ** 2 + ((z - hz) / 4.6) ** 2 + 0.25 * n3(seed + 70, x, y, z, 2)
                if d <= 1 and (x, y, z) in t.hollow:
                    edge = d > 0.6
                    name = (SB + ("organ_core" if t.r.random() < 0.3 else "cracked_organ_core" if t.r.random() < 0.15 else "pulsing_flesh")) if edge else SB + "fleshstone"
                    t.set(x, y, z, name)
                    t.hollow.discard((x, y, z))
                    t.lining.add((x, y, z))
    # tied to the walls and the ceiling by ribs of flesh, bloodroot hanging from it
    for k in range(7):
        a = k / 7 * math.tau + t.r.uniform(-0.2, 0.2)
        up = t.r.uniform(-0.2, 0.9)
        for s in range(5, 26):
            x = int(round(hx + math.cos(a) * s))
            z = int(round(hz + math.sin(a) * s))
            y = int(round(hy + up * s * 0.6))
            if (x, y, z) in t.hollow:
                t.set(x, y, z, SB + "pulsing_flesh" if s % 3 else SB + "fleshstone")
                t.hollow.discard((x, y, z))
                t.lining.add((x, y, z))
            elif (x, y, z) in t.lining:
                break
    for (x, y, z) in list(t.hollow):
        if t.is_air(x, y, z) and t.at(x, y + 1, z) in (SB + "pulsing_flesh", SB + "fleshstone", SB + "organ_core") and math.hypot(x - hx, z - hz) < 8 and t.r.random() < 0.25:
            n = t.r.randint(2, 7)
            for k in range(n):
                if not t.is_air(x, y - k, z) or (x, y - k - 1, z) in t.lining:
                    break
                t.set(x, y - k, z, SB + "bloodroot_vines", {"shaftbreaker:tip": k == n - 1})
    # watcher pods round it, looking in
    for k in range(10):
        a = k / 10 * math.tau
        x, z = int(round(hx + math.cos(a) * 11)), int(round(hz + math.sin(a) * 11))
        for y in range(2, 25):
            if t.is_air(x, y, z) and (x, y - 1, z) in t.lining:
                t.set(x, y, z, SB + "watcher_pod", {"shaftbreaker:open": k % 3 == 0})
                break
    dress(t, 0.8)
    return t


def mine_frame(t, x0, z0, n, along="x"):
    """Timber supports (posts, a beam over them) every four blocks, where the hollow is wide enough."""
    for i in range(n):
        x = x0 + i * 4
        z = z0
        fy = None
        for y in range(1, t.size[1] - 6):
            if t.is_air(x, y, z) and (x, y - 1, z) in t.lining:
                fy = y
                break
        if fy is None:
            continue
        for dz in (-2, 2):
            for y in range(fy, fy + 4):
                if t.is_air(x, y, z + dz):
                    t.set(x, y, z + dz, "minecraft:dark_oak_log", {"pillar_axis": "y"})
        for dz in range(-2, 3):
            if t.is_air(x, fy + 4, z + dz):
                t.set(x, fy + 4, z + dz, "minecraft:dark_oak_log", {"pillar_axis": "z"})
        if t.r.random() < 0.6 and t.is_air(x, fy + 3, z):
            t.set(x, fy + 3, z, "minecraft:iron_chain", {"pillar_axis": "y"})
            if t.is_air(x, fy + 2, z):
                t.set(x, fy + 2, z, "minecraft:lantern", {"hanging": True})


def mine_collapse(seed):
    t = Chamber("mine_collapse", (48, 18, 24), seed)

    def inside(x, y, z):
        return ((x - 23.5) / 22) ** 2 + ((y - 7) / 5.5) ** 2 * 1.6 + ((z - 11.5) / 5.5) ** 2 + 0.25 * n3(seed, x, y, z, 4)

    floor_at = lambda x, z: int(3 + 0.8 * vnoise(seed + 1, x, z, 5))
    carve(t, inside, floor_at, shell=3.0)
    mine_frame(t, 4, 11, 11)
    # rails down its length, a ladder up one end, the miners who did not get out
    for x in range(3, 45):
        for y in range(1, 12):
            if t.is_air(x, y, 11) and (x, y - 1, 11) in t.lining:
                if t.r.random() < 0.8:
                    t.set(x, y, 11, "minecraft:rail", {"rail_direction": 1})
                break
    for (x, y, z) in floors(t)[:]:
        if t.r.random() < 0.012:
            t.set(x, y, z, t.r.choice(("observer:skeleton", "observer:corpse")), {"minecraft:cardinal_direction": t.r.choice(("north", "south", "east", "west"))})
    dress(t, 0.7, dead=2.0)
    return t


PIECES = {
    "flesh_cavern_0": lambda: flesh_cavern(17001), "flesh_cavern_1": lambda: flesh_cavern(17002),
    "rib_hall_0": lambda: rib_hall(17101), "rib_hall_1": lambda: rib_hall(17102),
    "heart_chamber": lambda: heart_chamber(17201), "mine_collapse": lambda: mine_collapse(17301),
}


# ----------------------------------------------------------------------------- world generation

ROCK = ["minecraft:air", "minecraft:cave_air", "minecraft:stone", "minecraft:deepslate", "minecraft:tuff", "minecraft:andesite", "minecraft:diorite",
        "minecraft:granite", "minecraft:calcite", "minecraft:dirt", "minecraft:gravel", "minecraft:clay", "minecraft:smooth_basalt",
        "minecraft:dripstone_block", "minecraft:pointed_dripstone", "minecraft:water", "minecraft:flowing_water", "minecraft:glow_lichen",
        "minecraft:cobbled_deepslate", "minecraft:infested_deepslate", "minecraft:infested_stone",
        "minecraft:coal_ore", "minecraft:iron_ore", "minecraft:copper_ore", "minecraft:gold_ore", "minecraft:redstone_ore", "minecraft:lapis_ore",
        "minecraft:diamond_ore", "minecraft:emerald_ore", "minecraft:deepslate_coal_ore", "minecraft:deepslate_iron_ore",
        "minecraft:deepslate_copper_ore", "minecraft:deepslate_gold_ore", "minecraft:deepslate_redstone_ore", "minecraft:deepslate_lapis_ore",
        "minecraft:deepslate_diamond_ore", "minecraft:deepslate_emerald_ore", "minecraft:raw_iron_block", "minecraft:raw_copper_block",
        "shaftbreaker:veinstone", "shaftbreaker:cracked_veinstone", "shaftbreaker:fleshstone", "shaftbreaker:pulsing_flesh",
        "shaftbreaker:ribstone", "shaftbreaker:bloodmoss", "shaftbreaker:bloodroot_vines", "shaftbreaker:dripfang",
        "shaftbreaker:crimson_thorns", "shaftbreaker:glowspore_cluster", "shaftbreaker:organ_core", "shaftbreaker:cracked_organ_core",
        "shaftbreaker:watcher_pod"]


def worldgen():
    """The chambers placed in the Hollows: one in about every fourteen chunks of it, deep, before anything else."""
    out = {}
    feats = []
    for name in PIECES:
        ident = f"shaftbreaker:hl_{name}"
        out[f"features/hollows/hl_{name}.json"] = {"format_version": "1.21.60", "minecraft:structure_template_feature": {
            "description": {"identifier": ident}, "structure_name": f"hollows:{name}", "adjustment_radius": 0,
            "facing_direction": "random", "rotate_around_center": True,
            # it carves only into ordinary rock (never into lava, a fortress, a city)
            "constraints": {"block_intersection": {"block_allowlist": ROCK}}}}
        feats.append([ident, 3 if "flesh" in name else 2])
    out["features/hollows/hl_great_chamber.json"] = {"format_version": "1.21.60", "minecraft:weighted_random_feature": {
        "description": {"identifier": "shaftbreaker:hl_great_chamber"}, "features": feats}}
    out["feature_rules/hollows/hl_great_chamber_rule.json"] = {"format_version": "1.21.60", "minecraft:feature_rules": {
        "description": {"identifier": "shaftbreaker:hl_great_chamber_rule", "places_feature": "shaftbreaker:hl_great_chamber"},
        "conditions": {"placement_pass": "first_pass",
                       "minecraft:biome_filter": [{"test": "has_biome_tag", "operator": "==", "value": "shaftbreaker_hollows"}]},
        "distribution": {"iterations": 1, "coordinate_eval_order": "zyx",
                         "x": {"distribution": "uniform", "extent": [0, 16]},
                         "y": {"distribution": "uniform", "extent": [-48, 8]},
                         "z": {"distribution": "uniform", "extent": [0, 16]},
                         "scatter_chance": {"numerator": 1, "denominator": 14}}}}
    return out


def main():
    names_only = "--names" in sys.argv
    out = []
    for name, fn in PIECES.items():
        t = fn()
        if names_only:
            continue
        out.append(t.write(os.path.join(BP, "structures", "hollows", f"{name}.mcstructure")))
    if names_only:
        print(" ".join(sorted(USED)))
        return
    missing = sorted(n for n in USED if n not in STATES)
    if missing:
        print("MISSING STATES (ask the server):", " ".join(missing))
        sys.exit(1)
    for rel, data in worldgen().items():
        p = os.path.join(BP, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        out.append(p)
    for p in out:
        print(os.path.relpath(p, ROOT))


if __name__ == "__main__":
    main()
