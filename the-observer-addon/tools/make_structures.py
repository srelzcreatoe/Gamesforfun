#!/usr/bin/env python3
"""Build the Weeping Mire's ruins (1.5.0): five structures written as .mcstructure files, their loot tables and lore,
and the world-generation files that scatter them through the Mire.

  the drowned chapel      a deepslate chapel sinking into the mire: pews facing a black altar, a broken roof, a lectern
  the watcher's spire     a narrow tower of stone and weeping wood; three floors up a ladder, and a window seat at the
                          top, looking out over the Mire (its best loot)
  the bone altar          a ring of bone pillars with soul lanterns round a black altar, on blackstone and sculk
  the sunken archive      a buried library, half underground: shelves, a desk, two chests of books and maps
  the surveyors' camp     the last camp of the surveyors: a tent, a dead fire, barrels and a chest of supplies

Everything is drawn here, block by block (tools/nbt_le.py writes the files). Block states are the game's own full
default states (asked of a dedicated server), with only the facing changed. Chests and barrels carry a loot table
(filled when first opened); lecterns carry a journal. Outside each building the cells are structure voids, so the
terrain around it is left as it is.
"""
import json
import os
import random

import nbt_le as N

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
VERSION = 18184192
rng = random.Random(1500)

# the game's own default states (bedrock dedicated server 1.26.52), overridden per placement where it matters
DEFAULTS = {
    "minecraft:deepslate_brick_stairs": {"minecraft:corner": "none", "weirdo_direction": 0, "upside_down_bit": False},
    "minecraft:deepslate_tile_stairs": {"minecraft:corner": "none", "weirdo_direction": 0, "upside_down_bit": False},
    "minecraft:stone_brick_stairs": {"minecraft:corner": "none", "weirdo_direction": 0, "upside_down_bit": False},
    "minecraft:dark_oak_stairs": {"minecraft:corner": "none", "weirdo_direction": 0, "upside_down_bit": False},
    "minecraft:deepslate_brick_slab": {"minecraft:vertical_half": "bottom", "top_slot_bit": False},
    "minecraft:deepslate_tile_slab": {"minecraft:vertical_half": "bottom", "top_slot_bit": False},
    "minecraft:dark_oak_slab": {"minecraft:vertical_half": "bottom", "top_slot_bit": False, "wood_type": "dark_oak"},
    "minecraft:stone_brick_slab": {"minecraft:vertical_half": "bottom", "top_slot_bit": False, "stone_slab_type": "stone_brick"},
    "minecraft:iron_bars": {"minecraft:connection_west": False, "minecraft:connection_south": False, "minecraft:connection_east": False, "minecraft:connection_north": False},
    "minecraft:dark_oak_fence": {"minecraft:connection_west": False, "minecraft:connection_east": False, "minecraft:connection_north": False, "minecraft:connection_south": False},
    "minecraft:chain": {"pillar_axis": "y"},
    "minecraft:soul_lantern": {"hanging": False},
    "minecraft:lantern": {"hanging": False},
    "minecraft:black_candle": {"candles": 0, "lit": False},
    "minecraft:white_candle": {"candles": 0, "lit": False},
    "minecraft:chest": {"minecraft:cardinal_direction": "north", "facing_direction": 2},
    "minecraft:barrel": {"open_bit": False, "facing_direction": 1},
    "minecraft:lectern": {"minecraft:cardinal_direction": "south", "powered_bit": False, "direction": 0},
    "minecraft:chiseled_bookshelf": {"books_stored": 0, "direction": 0},
    "minecraft:ladder": {"facing_direction": 2},
    "minecraft:bone_block": {"pillar_axis": "y", "deprecated": 0},
    "minecraft:dark_oak_planks": {"wood_type": "dark_oak"},
    "minecraft:stone_bricks": {"stone_brick_type": "default"},
    "minecraft:mossy_stone_bricks": {"stone_brick_type": "mossy"},
    "minecraft:cracked_stone_bricks": {"stone_brick_type": "cracked"},
    "minecraft:campfire": {"minecraft:cardinal_direction": "south", "extinguished": True, "direction": 0},
    "minecraft:gray_wool": {"color": "gray"},
    "minecraft:black_wool": {"color": "black"},
    "minecraft:gray_carpet": {"color": "gray"},
    "minecraft:pale_hanging_moss": {"tip": True},
    "minecraft:hay_block": {"pillar_axis": "y", "deprecated": 0},
    "minecraft:spruce_log": {"pillar_axis": "y", "old_log_type": "spruce"},
    "minecraft:stripped_dark_oak_log": {"pillar_axis": "y"},
    "wmire:weeping_log": {"minecraft:block_face": "up"},
}
# weirdo_direction: the way a stair rises — 0 east (+x), 1 west (-x), 2 south (+z), 3 north (-z)
EAST, WEST, SOUTH, NORTH = 0, 1, 2, 3


class Structure:
    def __init__(self, sx, sy, sz):
        self.size = (sx, sy, sz)
        self.cells = {}  # (x,y,z) -> (name, states, block_entity or None)

    def set(self, x, y, z, name, states=None, be=None):
        sx, sy, sz = self.size
        if not (0 <= x < sx and 0 <= y < sy and 0 <= z < sz):
            return
        st = dict(DEFAULTS.get(name, {}))
        if states:
            st.update(states)
        self.cells[(x, y, z)] = (name, st, be)

    def box(self, x0, y0, z0, x1, y1, z1, name, states=None, hollow=False, pick=None):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    if hollow and x0 < x < x1 and z0 < z < z1 and y0 < y < y1:
                        continue
                    self.set(x, y, z, pick() if pick else name, states)

    def get(self, x, y, z):
        return self.cells.get((x, y, z), ("minecraft:structure_void", {}, None))[0]

    def chest(self, x, y, z, table, facing="north", kind="chest"):
        fd = {"north": 2, "south": 3, "west": 4, "east": 5}[facing]
        if kind == "chest":
            self.set(x, y, z, "minecraft:chest", {"minecraft:cardinal_direction": facing, "facing_direction": fd},
                     be=("Chest", table))
        else:
            self.set(x, y, z, "minecraft:barrel", {"facing_direction": 1}, be=("Barrel", table))

    def lectern(self, x, y, z, book, facing="north"):
        self.set(x, y, z, "minecraft:lectern", {"minecraft:cardinal_direction": facing}, be=("Lectern", book))

    def write(self, path):
        sx, sy, sz = self.size
        palette, index = [], {}
        prim = []
        bpd = {}
        for x in range(sx):
            for y in range(sy):
                for z in range(sz):
                    name, st, be = self.cells.get((x, y, z), ("minecraft:structure_void", {}, None))
                    key = (name, json.dumps(st, sort_keys=True))
                    if key not in index:
                        index[key] = len(palette)
                        palette.append((name, st))
                    i = (x * sy + y) * sz + z
                    prim.append(index[key])
                    if be:
                        bpd[str(i)] = (N.COMPOUND, {"block_entity_data": (N.COMPOUND, block_entity(be, x, y, z))})
        pal = []
        for name, st in palette:
            states = {}
            for k, v in st.items():
                states[k] = (N.BYTE, int(v)) if isinstance(v, bool) else (N.INT, v) if isinstance(v, int) else (N.STRING, v)
            pal.append({"name": (N.STRING, name), "states": (N.COMPOUND, states), "version": (N.INT, VERSION)})
        root = {
            "format_version": (N.INT, 1),
            "size": (N.LIST, (N.INT, [sx, sy, sz])),
            "structure": (N.COMPOUND, {
                "block_indices": (N.LIST, (N.LIST, [(N.INT, prim), (N.INT, [-1] * len(prim))])),
                "entities": (N.LIST, (N.COMPOUND, [])),
                "palette": (N.COMPOUND, {"default": (N.COMPOUND, {
                    "block_palette": (N.LIST, (N.COMPOUND, pal)),
                    "block_position_data": (N.COMPOUND, bpd),
                })}),
            }),
            "structure_world_origin": (N.LIST, (N.INT, [0, 0, 0])),
        }
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(N.write("", (N.COMPOUND, root)))
        return path


def block_entity(be, x, y, z):
    kind, data = be
    pos = {"x": (N.INT, x), "y": (N.INT, y), "z": (N.INT, z)}
    if kind in ("Chest", "Barrel"):
        out = {"id": (N.STRING, kind), "isMovable": (N.BYTE, 1), "Findable": (N.BYTE, 0),
               "LootTable": (N.STRING, f"loot_tables/wmire/{data}.json"), "LootTableSeed": (N.INT, 0),
               "Items": (N.LIST, (N.COMPOUND, []))}
        out.update(pos)
        return out
    if kind == "Lectern":
        title, author, pages = data
        book = {"Name": (N.STRING, "minecraft:written_book"), "Count": (N.BYTE, 1), "Damage": (N.SHORT, 0),
                "WasPickedUp": (N.BYTE, 0),
                "tag": (N.COMPOUND, {"author": (N.STRING, author), "title": (N.STRING, title), "generation": (N.INT, 0),
                                     "xuid": (N.LONG, 0),
                                     "pages": (N.LIST, (N.COMPOUND, [{"photoname": (N.STRING, ""), "text": (N.STRING, p)} for p in pages]))})}
        out = {"id": (N.STRING, "Lectern"), "isMovable": (N.BYTE, 1), "hasBook": (N.BYTE, 1), "page": (N.INT, 0),
               "totalPages": (N.INT, len(pages)), "book": (N.COMPOUND, book)}
        out.update(pos)
        return out
    raise ValueError(kind)


# ----------------------------------------------------------------------------- lore (original)

CHOIR = ("The Choir", "Fr. Aldous Wren", [
    "We built the chapel\nwhere the marsh was\nquietest. We thought\nthe quiet was holy.\n\nIt was listening.",
    "Every evening the\nchoir sang to the\ntree line. Every\nevening something\nstood at the edge\nof the fog and did\nnot sing back.",
    "It stood in the\ndoorway during\nvespers. Nobody\nturned round. We\nall knew. We sang\nlouder.",
    "One by one the\nvoices went. Not\ndead. Gone. Their\npews still face the\naltar.\n\nThey still face it.",
    "If you are reading\nthis, do not pray\nhere. It answers.",
])
INDEX = ("Index of the Unwritten", "The Archivist", [
    "Catalogue, shelf 1:\naccounts of the\nfigure at the edge\nof the trees.\n\nAll of them end the\nsame way: it was\ncloser.",
    "Shelf 2: letters\nto no one. Written\nin a hand none of\nus had. Signed with\nthe names of the\npeople who found\nthem.",
    "Shelf 3: empty.\n\nIt took that shelf\nfirst. It took the\nbooks about itself.",
    "I have stopped\nwriting its name.\nWhen I write it,\nthe ink runs\nbackwards.",
    "I buried the archive\nto keep it from\nreading us.\n\nIt reads anyway.",
])
SPIRE = ("Watch Log", "Keeper", [
    "Day 1. From the top\nof the spire you can\nsee the whole Mire.\nNothing moves.\n\nGood.",
    "Day 4. Something\nmoves when I blink.\nI am trying not to\nblink.",
    "Day 9. There is a\nfigure at the foot\nof the tower. It is\nlooking up.\n\nIt is always\nlooking up.",
    "Day 10. It is on the\nstairs.",
    "Day 1",
])
CAMP = ("Last Entry", "Surveyors' Company", [
    "Camp three. The\nother two camps are\ngone. Not packed up.\nGone. Tents, fires,\nmen.",
    "Mapped the bone\naltar today. The\ncandles were lit\nwhen we got there.\nWe did not light\nthem.",
    "Fire went out by\nitself. The animals\nwould not come near\nthe tent. They stood\nin a line and\nwatched it instead.",
    "Whoever finds this:\nthe map is wrong.\nThe Mire is bigger\nat night.",
])
ALTAR = ("Offering", "unknown", [
    "Leave nothing here.\n\nIt does not want\nwhat you bring.\nIt wants the one\nwho brings it.",
])


# ----------------------------------------------------------------------------- the five ruins

def chance(p):
    return rng.random() < p


def chapel():
    s = Structure(11, 11, 15)
    brick = lambda: rng.choice(["minecraft:deepslate_bricks"] * 5 + ["minecraft:cracked_deepslate_bricks"] * 2)
    s.box(0, 0, 0, 10, 0, 14, "minecraft:deepslate_tiles")
    s.box(1, 1, 1, 9, 1, 13, "minecraft:polished_deepslate")
    # walls, the inside cleared
    s.box(0, 1, 0, 10, 6, 14, None, hollow=True, pick=brick)
    s.box(1, 2, 1, 9, 6, 13, "minecraft:air")
    # the doorway, with an arch
    s.box(4, 2, 0, 6, 4, 0, "minecraft:air")
    s.set(4, 5, 0, "minecraft:deepslate_brick_stairs", {"weirdo_direction": EAST, "upside_down_bit": True})
    s.set(6, 5, 0, "minecraft:deepslate_brick_stairs", {"weirdo_direction": WEST, "upside_down_bit": True})
    # windows with bars
    for z in (3, 6, 9, 12):
        for x in (0, 10):
            s.box(x, 3, z, x, 4, z, "minecraft:iron_bars", {"minecraft:connection_north": True, "minecraft:connection_south": True})
    # the roof: a ridge of stairs, slabs to the eaves; the back left corner fallen in
    for z in range(0, 15):
        for x in range(0, 11):
            hole = (x < 5 and z > 8) or chance(0.06)
            if hole:
                continue
            if x in (0, 10):
                s.set(x, 7, z, "minecraft:deepslate_tile_slab")
            elif x in (1, 9):
                s.set(x, 7, z, "minecraft:deepslate_tile_stairs", {"weirdo_direction": EAST if x == 1 else WEST})
            elif x in (2, 8):
                s.set(x, 7, z, "minecraft:deepslate_tiles")
                s.set(x, 8, z, "minecraft:deepslate_tile_stairs", {"weirdo_direction": EAST if x == 2 else WEST})
            elif x in (3, 7):
                s.set(x, 7, z, "minecraft:air")
                s.set(x, 8, z, "minecraft:deepslate_tiles")
                s.set(x, 9, z, "minecraft:deepslate_tile_stairs", {"weirdo_direction": EAST if x == 3 else WEST})
            else:
                s.set(x, 8, z, "minecraft:air")
                s.set(x, 9, z, "minecraft:deepslate_tiles")
                s.set(x, 10, z, "minecraft:deepslate_tile_slab")
    # rubble where it fell, and moss coming through
    for x, z in ((2, 10), (3, 11), (1, 12), (4, 9), (2, 12)):
        s.set(x, 2, z, rng.choice(["minecraft:mossy_cobblestone", "minecraft:cobblestone", "minecraft:cracked_deepslate_bricks"]))
    for _ in range(9):
        x, z = rng.randint(1, 9), rng.randint(1, 11)
        if s.get(x, 2, z) == "minecraft:air":
            s.set(x, 2, z, "minecraft:moss_carpet")
    # pews, facing the altar
    for z in (4, 6, 8):
        for x in (2, 3, 7, 8):
            s.set(x, 2, z, "minecraft:dark_oak_stairs", {"weirdo_direction": NORTH})
    # the altar: black stone, unlit candles, its chest; a lectern with the choirmaster's book
    s.box(4, 2, 12, 6, 2, 13, "minecraft:polished_blackstone_bricks")
    s.set(5, 2, 13, "minecraft:chiseled_polished_blackstone")
    s.set(5, 3, 13, "minecraft:crying_obsidian")
    s.set(4, 3, 12, "minecraft:black_candle", {"candles": 3})
    s.set(6, 3, 12, "minecraft:black_candle", {"candles": 2})
    s.chest(5, 2, 11, "chapel_chest", "north")
    s.lectern(3, 2, 11, CHOIR, "north")
    # webs in the corners, a soul lantern on a chain from the ridge, moss hanging through the holes
    for x, y, z in ((1, 6, 1), (9, 6, 1), (9, 6, 13), (1, 5, 2), (8, 6, 12)):
        s.set(x, y, z, "minecraft:web")
    s.set(5, 8, 6, "minecraft:chain")
    s.set(5, 7, 6, "minecraft:chain")
    s.set(5, 6, 6, "minecraft:soul_lantern", {"hanging": True})
    for x, z in ((4, 9), (3, 10)):
        s.set(x, 6, z, "minecraft:pale_hanging_moss")
    return s


def spire():
    s = Structure(7, 20, 7)
    wall = lambda: rng.choice(["minecraft:stone_bricks"] * 4 + ["minecraft:mossy_stone_bricks"] * 2 + ["minecraft:cracked_stone_bricks"])
    s.box(0, 0, 0, 6, 0, 6, "minecraft:mossy_stone_bricks")
    s.box(0, 1, 0, 6, 17, 6, None, hollow=True, pick=wall)
    s.box(1, 1, 1, 5, 17, 5, "minecraft:air")
    for x, z in ((0, 0), (6, 0), (0, 6), (6, 6)):
        s.box(x, 0, z, x, 18, z, "wmire:weeping_log")
    # the doorway
    s.box(3, 1, 0, 3, 2, 0, "minecraft:air")
    # floors, a ladder up through them
    for y in (6, 12):
        s.box(1, y, 1, 5, y, 5, "wmire:weeping_planks")
    for y in range(1, 18):
        s.set(5, y, 5, "minecraft:ladder", {"facing_direction": 2})
    # slit windows, and the wide openings at the top where it watched from
    for y in (3, 9):
        for x, z in ((3, 6), (0, 3), (6, 3)):
            s.set(x, y, z, "minecraft:iron_bars", {"minecraft:connection_north": x != 3, "minecraft:connection_south": x != 3,
                                                   "minecraft:connection_east": x == 3, "minecraft:connection_west": x == 3})
    for x0, z0, x1, z1 in ((2, 0, 4, 0), (2, 6, 4, 6), (0, 2, 0, 4), (6, 2, 6, 4)):
        s.box(x0, 14, z0, x1, 16, z1, "minecraft:air")
    # its roof, a chain and a soul lantern hanging in the middle
    s.box(0, 18, 0, 6, 18, 6, "minecraft:deepslate_tile_slab")
    s.set(3, 18, 3, "minecraft:deepslate_tiles")
    s.set(3, 17, 3, "minecraft:chain")
    s.set(3, 16, 3, "minecraft:soul_lantern", {"hanging": True})
    # the top: a seat at the window, the best of the loot, the keeper's log
    s.set(3, 13, 1, "minecraft:dark_oak_stairs", {"weirdo_direction": SOUTH})
    s.chest(1, 13, 4, "spire_chest", "east")
    s.lectern(2, 13, 5, SPIRE, "north")
    # the middle floor: stores
    s.chest(1, 7, 1, "camp_barrel", kind="barrel")
    s.set(2, 7, 1, "minecraft:barrel")
    for x, y, z in ((1, 11, 1), (4, 5, 1), (1, 17, 1), (4, 17, 4), (1, 4, 4)):
        s.set(x, y, z, "minecraft:web")
    return s


def altar():
    s = Structure(11, 6, 11)
    c = 5
    for x in range(11):
        for z in range(11):
            r = ((x - c) ** 2 + (z - c) ** 2) ** 0.5
            if r <= 5.2:
                s.set(x, 0, z, rng.choice(["minecraft:blackstone", "minecraft:soul_sand", "minecraft:blackstone", "minecraft:sculk"]))
                for y in range(1, 6):
                    s.set(x, y, z, "minecraft:air")
    for x, z in ((c + 4, c), (c - 4, c), (c, c + 4), (c, c - 4), (c + 3, c + 3), (c - 3, c + 3), (c + 3, c - 3), (c - 3, c - 3)):
        s.box(x, 1, z, x, 3, z, "minecraft:bone_block")
        s.set(x, 4, z, "minecraft:soul_lantern")
    s.box(c - 1, 1, c - 1, c + 1, 1, c + 1, "minecraft:polished_blackstone_bricks")
    s.chest(c, 1, c, "altar_chest", "north")
    for x, z in ((c - 1, c - 1), (c + 1, c - 1), (c - 1, c + 1), (c + 1, c + 1)):
        s.set(x, 2, z, "minecraft:black_candle", {"candles": rng.randint(1, 3)})
    s.lectern(c, 1, c - 3, ALTAR, "north")
    for _ in range(6):
        x, z = rng.randint(1, 9), rng.randint(1, 9)
        if s.get(x, 1, z) == "minecraft:air" and s.get(x, 0, z) != "minecraft:structure_void":
            s.set(x, 1, z, "wmire:bone_root")
    return s


def archive():
    s = Structure(11, 7, 9)
    s.box(0, 0, 0, 10, 6, 8, "minecraft:deepslate_bricks")
    s.box(1, 1, 1, 9, 5, 7, "minecraft:air")
    for _ in range(14):
        x, y, z = rng.randint(0, 10), rng.randint(0, 6), rng.choice([0, 8])
        s.set(x, y, z, "minecraft:cracked_deepslate_bricks")
    # the way in from the surface (it is buried four deep): a gap in the front wall and steps down; the roof is
    # mossed over and fallen in at one corner
    s.box(5, 4, 0, 5, 5, 0, "minecraft:air")
    s.set(5, 3, 1, "minecraft:stone_brick_stairs", {"weirdo_direction": NORTH})
    s.set(5, 2, 2, "minecraft:stone_brick_stairs", {"weirdo_direction": NORTH})
    s.set(5, 1, 3, "minecraft:stone_brick_stairs", {"weirdo_direction": NORTH})
    for x in range(11):
        for z in range(9):
            if chance(0.45):
                s.set(x, 6, z, rng.choice(["wmire:mire_moss", "minecraft:mossy_cobblestone"]))
    s.box(8, 6, 6, 9, 6, 7, "minecraft:air")
    s.set(8, 5, 6, "minecraft:pale_hanging_moss")
    # shelves along both sides
    for x in (1, 9):
        for z in range(2, 7):
            for y in (1, 2, 3):
                s.set(x, y, z, "minecraft:bookshelf" if chance(0.8) else "minecraft:chiseled_bookshelf")
    # the archivist's desk; the index on its lectern; chests of books and maps
    s.set(5, 1, 5, "minecraft:cartography_table")
    s.lectern(4, 1, 5, INDEX, "north")
    s.chest(6, 1, 5, "archive_chest", "north")
    s.chest(8, 1, 7, "archive_chest", "north")
    s.set(2, 1, 7, "minecraft:crafting_table")
    for x, z in ((3, 3), (7, 3), (5, 7)):
        s.set(x, 5, z, "minecraft:soul_lantern", {"hanging": True})
    s.set(5, 2, 5, "minecraft:white_candle", {"candles": 2})
    for x, y, z in ((1, 5, 1), (9, 5, 7), (8, 5, 1), (2, 4, 7)):
        s.set(x, y, z, "minecraft:web")
    return s


def camp():
    s = Structure(9, 5, 9)
    for x in range(9):
        for z in range(9):
            if (x - 4) ** 2 + (z - 4) ** 2 <= 18:
                s.set(x, 0, z, rng.choice(["wmire:mire_soil", "wmire:mire_moss", "wmire:mire_soil"]))
                for y in range(1, 5):
                    s.set(x, y, z, "minecraft:air")
    # the tent: an A of grey wool, open at the end
    for x in range(1, 5):
        s.set(x, 1, 1, "minecraft:gray_wool")
        s.set(x, 1, 3, "minecraft:gray_wool")
        s.set(x, 2, 2, "minecraft:gray_wool")
        s.set(x, 1, 2, "minecraft:air")
    s.set(1, 1, 2, "minecraft:gray_wool")
    s.chest(2, 1, 2, "camp_chest", "east")
    # the dead fire, logs to sit on
    s.set(5, 1, 5, "minecraft:campfire", {"extinguished": True})
    s.set(5, 1, 7, "minecraft:spruce_log", {"pillar_axis": "x"})
    s.set(7, 1, 5, "minecraft:spruce_log", {"pillar_axis": "z"})
    # stores
    s.chest(1, 1, 6, "camp_barrel", kind="barrel")
    s.chest(2, 1, 7, "camp_barrel", kind="barrel")
    s.set(1, 1, 7, "minecraft:hay_block")
    s.set(7, 1, 2, "minecraft:dark_oak_fence")
    s.set(7, 2, 2, "minecraft:lantern")
    s.lectern(6, 1, 2, CAMP, "west")
    s.set(3, 1, 6, "minecraft:web")
    return s


# ----------------------------------------------------------------------------- loot (decent goods)

def item(name, weight, lo=1, hi=1, fns=None):
    e = {"type": "item", "name": name, "weight": weight}
    f = list(fns or [])
    if hi > 1 or lo > 1:
        f.insert(0, {"function": "set_count", "count": {"min": lo, "max": hi}})
    if f:
        e["functions"] = f
    return e


def book(title, author, pages):
    return {"function": "set_book_contents", "author": author, "title": title, "pages": pages}


ENCH = [{"function": "enchant_randomly"}]
LEVELS = lambda a, b: [{"function": "enchant_with_levels", "levels": {"min": a, "max": b}, "treasure": False}]

LOOT = {
    "chapel_chest": {"pools": [
        {"rolls": {"min": 4, "max": 7}, "entries": [
            item("minecraft:gold_ingot", 12, 2, 6), item("minecraft:iron_ingot", 14, 3, 8), item("minecraft:emerald", 10, 2, 6),
            item("minecraft:golden_apple", 5), item("minecraft:book", 8, 1, 1, ENCH), item("minecraft:black_candle", 8, 2, 5),
            item("minecraft:experience_bottle", 8, 3, 8), item("minecraft:name_tag", 4), item("observer:vestige", 6, 1, 2),
            item("observer:flare", 8, 2, 4), item("minecraft:lapis_lazuli", 8, 4, 12)]},
        {"rolls": 1, "entries": [item("minecraft:diamond", 3, 1, 2), item("minecraft:golden_sword", 4, 1, 1, LEVELS(15, 25)),
                                 {"type": "empty", "weight": 6}]},
    ]},
    "spire_chest": {"pools": [
        {"rolls": {"min": 5, "max": 8}, "entries": [
            item("minecraft:diamond", 6, 1, 3), item("minecraft:emerald", 10, 3, 8), item("minecraft:gold_ingot", 10, 3, 7),
            item("minecraft:ender_pearl", 8, 1, 3), item("minecraft:golden_apple", 6, 1, 2), item("minecraft:spyglass", 4),
            item("minecraft:arrow", 8, 8, 20), item("minecraft:experience_bottle", 8, 4, 10), item("observer:cold_eye", 5, 1, 2),
            item("observer:flare", 8, 3, 6), item("minecraft:book", 6, 1, 1, ENCH)]},
        {"rolls": 1, "entries": [item("minecraft:diamond_sword", 3, 1, 1, LEVELS(20, 30)), item("minecraft:bow", 4, 1, 1, LEVELS(20, 30)),
                                 item("minecraft:diamond_pickaxe", 2, 1, 1, LEVELS(15, 25)), item("observer:witness_lens", 2),
                                 item("minecraft:enchanted_golden_apple", 1), {"type": "empty", "weight": 4}]},
    ]},
    "altar_chest": {"pools": [
        {"rolls": {"min": 4, "max": 6}, "entries": [
            item("observer:vestige", 10, 1, 3), item("observer:cold_eye", 8, 1, 3), item("observer:flare", 10, 2, 5),
            item("observer:chalk", 6, 2, 6), item("minecraft:bone", 10, 3, 9), item("minecraft:bone_meal", 8, 4, 10),
            item("minecraft:soul_lantern", 6, 1, 3), item("minecraft:echo_shard", 3, 1, 2), item("minecraft:emerald", 8, 2, 5),
            item("minecraft:crying_obsidian", 5, 1, 4)]},
        {"rolls": 1, "entries": [item("minecraft:diamond", 3, 1, 2), item("minecraft:music_disc_11", 2), item("minecraft:music_disc_13", 2),
                                 item("observer:ward_lantern", 3), {"type": "empty", "weight": 5}]},
    ]},
    "archive_chest": {"pools": [
        {"rolls": {"min": 4, "max": 7}, "entries": [
            item("minecraft:book", 14, 1, 1, ENCH), item("minecraft:book", 10, 2, 5), item("minecraft:paper", 10, 4, 12),
            item("minecraft:ink_sac", 6, 1, 4), item("minecraft:empty_map", 6, 1, 2), item("minecraft:compass", 4),
            item("minecraft:experience_bottle", 10, 4, 10), item("minecraft:emerald", 6, 2, 6), item("minecraft:feather", 6, 2, 6),
            item("observer:field_notes", 3), item("minecraft:writable_book", 4)]},
        {"rolls": 1, "entries": [item("minecraft:written_book", 1, 1, 1, [book(*INDEX)]), item("minecraft:written_book", 1, 1, 1, [book(*CHOIR)])]},
    ]},
    "camp_chest": {"pools": [
        {"rolls": {"min": 4, "max": 7}, "entries": [
            item("minecraft:bread", 12, 2, 5), item("minecraft:cooked_beef", 10, 2, 5), item("minecraft:baked_potato", 10, 3, 6),
            item("minecraft:torch", 10, 6, 16), item("minecraft:iron_ingot", 10, 2, 6), item("minecraft:coal", 10, 4, 10),
            item("minecraft:arrow", 8, 6, 16), item("minecraft:leather", 6, 2, 5), item("observer:flare", 8, 2, 4),
            item("minecraft:shield", 3), item("minecraft:bow", 3)]},
        {"rolls": 1, "entries": [item("minecraft:iron_pickaxe", 4, 1, 1, LEVELS(10, 20)), item("minecraft:iron_sword", 4, 1, 1, LEVELS(10, 20)),
                                 item("minecraft:written_book", 3, 1, 1, [book(*CAMP)]), {"type": "empty", "weight": 4}]},
    ]},
    "camp_barrel": {"pools": [
        {"rolls": {"min": 3, "max": 6}, "entries": [
            item("minecraft:wheat", 10, 3, 9), item("minecraft:potato", 10, 2, 6), item("minecraft:carrot", 10, 2, 6),
            item("minecraft:string", 8, 2, 6), item("minecraft:stick", 10, 4, 10), item("minecraft:coal", 8, 2, 6),
            item("minecraft:iron_nugget", 8, 4, 12), item("minecraft:rotten_flesh", 6, 2, 5), item("minecraft:bone", 6, 1, 4),
            item("minecraft:apple", 8, 1, 3)]},
    ]},
}

RUINS = {"drowned_chapel": (chapel, 3), "watchers_spire": (spire, 2), "bone_altar": (altar, 3), "sunken_archive": (archive, 2),
         "surveyors_camp": (camp, 4)}
# how deep each sits in the ground (the archive is buried four deep; the camp and the altar sit on the surface)
SINK = {"drowned_chapel": -1, "watchers_spire": -1, "bone_altar": -1, "sunken_archive": -4, "surveyors_camp": -1}


def worldgen(name):
    js = {"format_version": "1.21.130", "minecraft:jigsaw": {
        "description": {"identifier": f"wmire:{name}"}, "step": "surface_structures", "terrain_adaptation": "beard_thin",
        "start_pool": f"wmire:{name}", "max_depth": 1, "start_height": {"type": "constant", "value": {"absolute": SINK[name]}},
        "heightmap_projection": "world_surface", "liquid_settings": "ignore_waterlogging",
        "biome_filters": [{"test": "has_biome_tag", "operator": "==", "value": "wmire_weeping_mire"}]}}
    pool = {"format_version": "1.21.130", "minecraft:template_pool": {"description": {"identifier": f"wmire:{name}"},
            "elements": [{"element": {"element_type": "minecraft:single_pool_element", "location": f"wmire/{name}", "projection": "rigid"}, "weight": 1}]}}
    return js, pool


def main():
    made = []
    for name, (fn, _) in RUINS.items():
        s = fn()
        made.append(s.write(os.path.join(BP, "structures", "wmire", f"{name}.mcstructure")))
        js, pool = worldgen(name)
        for sub, data in (("structures", js), ("template_pools", pool)):
            path = os.path.join(BP, "worldgen", sub, f"{name}.json")
            with open(path, "w") as f:
                json.dump(data, f, indent=2)
                f.write("\n")
            made.append(path)
    ruins_set = {"format_version": "1.21.130", "minecraft:structure_set": {
        "description": {"identifier": "wmire:mire_ruins"},
        "placement": {"type": "minecraft:random_spread", "salt": 51530917, "spacing": 8, "separation": 3, "spread_type": "linear"},
        "structures": [{"structure": f"wmire:{name}", "weight": w} for name, (_, w) in RUINS.items()]}}
    path = os.path.join(BP, "worldgen", "structure_sets", "mire_ruins.json")
    with open(path, "w") as f:
        json.dump(ruins_set, f, indent=2)
        f.write("\n")
    made.append(path)
    for name, table in LOOT.items():
        path = os.path.join(BP, "loot_tables", "wmire", f"{name}.json")
        with open(path, "w") as f:
            json.dump(table, f, indent=2)
            f.write("\n")
        made.append(path)
    for m in made:
        print(os.path.relpath(m, ROOT))


if __name__ == "__main__":
    main()
