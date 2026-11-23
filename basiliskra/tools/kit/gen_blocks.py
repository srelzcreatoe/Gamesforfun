#!/usr/bin/env python3
"""The fallout's blocks and items: block and item files, the crystal's model, textures with Vibrant Visuals texture
sets, the terrain atlas entries, block sounds, loot tables, recipes, the fog and the names.

    python3 tools/kit/gen_blocks.py

Block files follow the 1.26.60 block schema in Mojang's bedrock-samples (checked by tools/validate);
the script falls back to vanilla blocks if the game ever refuses one (src/fallout.ts).
"""
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
BP, RP = os.path.join(ROOT, "packs", "BP"), os.path.join(ROOT, "packs", "RP")
NS = "basiliskra"


def rng(seed):
    return np.random.default_rng(seed)


def noise(r, base, spread):
    return np.clip(np.array(base, float)[None, None, :] + r.normal(0, spread, (16, 16, 1)), 0, 255)


def soil_top(r):
    c = noise(r, (70, 60, 57), 7)
    m = np.zeros((16, 16, 3))                                # metalness, emissive, roughness
    m[..., 2] = 235
    for _ in range(3):                                       # dark cracks
        x, y = r.integers(0, 16, 2)
        for k in range(r.integers(4, 9)):
            c[y % 16, x % 16] = (34, 28, 28)
            x += r.integers(-1, 2); y += r.integers(0, 2)
    for _ in range(9):                                       # pale ash flecks
        x, y = r.integers(0, 16, 2)
        c[y, x] = (150, 144, 140)
    for _ in range(3):                                       # short veins of it, glowing through the crust
        x, y = r.integers(1, 15, 2)
        for k in range(r.integers(3, 6)):
            c[y % 16, x % 16] = (214, 40, 44); m[y % 16, x % 16, 1] = 210
            x += r.integers(-1, 2); y += r.integers(-1, 2)
    for _ in range(7):                                       # crimson specks that glow
        x, y = r.integers(1, 15, 2)
        c[y, x] = (196, 32, 38)
        m[y, x, 1] = 170
    for _ in range(2):
        x, y = r.integers(2, 14, 2)
        c[y, x] = (255, 196, 176)
        m[y, x, 1] = 255
    return c, m


def soil_side(r):
    c = noise(r, (92, 66, 48), 8)
    m = np.zeros((16, 16, 3)); m[..., 2] = 240
    top, _ = soil_top(rng(7))
    c[:3] = top[:3]
    for x in range(16):                                      # a ragged ash crust over the dirt
        if r.random() < 0.5:
            c[3, x] = top[2, x]
    for _ in range(2):
        x, y = r.integers(0, 16), r.integers(0, 3)
        c[y, x] = (196, 32, 38); m[y, x, 1] = 150
    return c, m


def soil_bottom(r):
    c = noise(r, (84, 60, 42), 8)
    m = np.zeros((16, 16, 3)); m[..., 2] = 240
    return c, m


def trinitite(r):
    c = noise(r, (36, 14, 18), 5)
    m = np.zeros((16, 16, 3)); m[..., 2] = 60                # glassy: smooth
    m[..., 0] = 20
    for _ in range(6):                                       # lighter fused patches
        x, y = r.integers(0, 16, 2)
        for dx in range(-1, 2):
            for dy in range(-1, 2):
                if r.random() < 0.7:
                    c[(y + dy) % 16, (x + dx) % 16] = (72, 24, 30)
    for _ in range(3):                                       # crimson veins, glowing
        x, y = r.integers(0, 16, 2)
        for k in range(r.integers(5, 11)):
            c[y % 16, x % 16] = (204, 34, 42); m[y % 16, x % 16, 1] = 200
            x += r.integers(0, 2); y += r.integers(-1, 2)
    for _ in range(4):                                       # bubbles: dark rim, hot centre
        x, y = r.integers(1, 15, 2)
        c[y, x] = (250, 214, 200); m[y, x, 1] = 255
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            c[y + dy, x + dx] = (22, 8, 10)
    return c, m



def rock(r):
    """Irradiated rock: dark stone split by veins that glow."""
    c = noise(r, (58, 52, 54), 7)
    m = np.zeros((16, 16, 3)); m[..., 2] = 215
    for _ in range(10):                                      # darker pits
        x, y = r.integers(0, 16, 2)
        c[y, x] = (36, 31, 33)
    for _ in range(4):                                       # the veins: a hot centre line with a dimmer edge
        x, y = r.integers(0, 16), r.integers(0, 16)
        dx, dy = r.choice([-1, 1]), r.choice([-1, 1])
        for _ in range(r.integers(6, 12)):
            c[y % 16, x % 16] = (232, 52, 48); m[y % 16, x % 16, 1] = 235
            for ex, ey in ((1, 0), (0, 1)):
                if r.random() < 0.45 and m[(y + ey) % 16, (x + ex) % 16, 1] == 0:
                    c[(y + ey) % 16, (x + ex) % 16] = (120, 22, 28); m[(y + ey) % 16, (x + ex) % 16, 1] = 110
            x += dx if r.random() < 0.7 else 0
            y += dy if r.random() < 0.7 else 0
            if r.random() < 0.15:
                dx = -dx
    for _ in range(3):
        x, y = r.integers(1, 15, 2)
        c[y, x] = (255, 206, 180); m[y, x, 1] = 255
    return c, m


def slag_hot(r):
    """Glowing slag: a black crust floating on something molten."""
    yy, xx = np.mgrid[0:16, 0:16]
    seeds = r.integers(0, 16, (7, 2))
    d = np.stack([np.minimum(np.abs(xx - sx), 16 - np.abs(xx - sx)) + np.minimum(np.abs(yy - sy), 16 - np.abs(yy - sy)) for sx, sy in seeds])
    d.sort(axis=0)
    edge = d[1] - d[0]                                       # small where two plates of crust meet
    c = np.zeros((16, 16, 3)); m = np.zeros((16, 16, 3)); m[..., 2] = 150
    crust = noise(r, (30, 20, 20), 5)
    c[:] = crust
    hot = edge <= 1
    warm = (edge == 2)
    c[warm] = (150, 30, 22); m[warm, 1] = 150
    c[hot] = (255, 120, 60); m[hot, 1] = 255
    core = hot & (r.random((16, 16)) < 0.4)
    c[core] = (255, 226, 170)
    return c, m


def slag_cold(r):
    """Cooled slag: the same plates gone dark and glassy, the cracks between them dull red-brown."""
    yy, xx = np.mgrid[0:16, 0:16]
    seeds = r.integers(0, 16, (7, 2))
    d = np.stack([np.minimum(np.abs(xx - sx), 16 - np.abs(xx - sx)) + np.minimum(np.abs(yy - sy), 16 - np.abs(yy - sy)) for sx, sy in seeds])
    d.sort(axis=0)
    edge = d[1] - d[0]
    c = noise(r, (38, 32, 34), 5)
    m = np.zeros((16, 16, 3)); m[..., 2] = 70; m[..., 0] = 30
    c[edge <= 1] = (20, 15, 16)
    c[(edge == 2) & (r.random((16, 16)) < 0.35)] = (70, 30, 28)
    for _ in range(5):
        x, y = r.integers(0, 16, 2)
        c[y, x] = (86, 78, 82)
    return c, m


def crystal(r):
    """The crystal's skin: columns that run from a dark root to a white-hot tip (the model maps each spike onto a column)."""
    c = np.zeros((16, 16, 3)); m = np.zeros((16, 16, 3)); m[..., 2] = 40; m[..., 0] = 60
    for y in range(16):
        t = 1 - y / 15                                       # 1 at the tip (top row), 0 at the root
        base = np.array((70, 6, 14)) * (1 - t) + np.array((255, 70, 60)) * t
        if t > 0.82:
            base = np.array((255, 214, 196))
        for x in range(16):
            facet = (0.82, 1.0, 0.9, 1.08)[x % 4]
            c[y, x] = np.clip(base * facet + r.normal(0, 5, 3), 0, 255)
            m[y, x, 1] = 120 + 135 * t
    for _ in range(8):
        x, y = r.integers(0, 16, 2)
        c[y, x] = (255, 236, 220); m[y, x, 1] = 255
    return c, m


def lamp(r):
    """The shard lamp: a dark iron cage round a block of crimson light."""
    c = np.zeros((16, 16, 3)); m = np.zeros((16, 16, 3)); m[..., 2] = 90
    yy, xx = np.mgrid[0:16, 0:16]
    d = np.maximum(np.abs(xx - 7.5), np.abs(yy - 7.5))
    glow = np.clip(1 - d / 8, 0, 1)
    c[:] = np.array((150, 14, 20))[None, None] + glow[..., None] * np.array((105, 190, 160))[None, None]
    c += r.normal(0, 4, (16, 16, 1))
    m[..., 1] = 170 + 85 * glow
    frame = (xx == 0) | (xx == 15) | (yy == 0) | (yy == 15) | (xx == 7) | (xx == 8) | (yy == 7) | (yy == 8)
    c[frame] = (34, 28, 30); m[frame, 1] = 0; m[frame, 0] = 200; m[frame, 2] = 120
    rivet = ((xx == 0) | (xx == 15)) & ((yy == 0) | (yy == 15))
    c[rivet] = (70, 62, 64)
    return np.clip(c, 0, 255), m


def abyssal(r):
    """Abyssal basalt: the floor and walls of the deep.  Near black, columnar, with a hair of crimson in the joints."""
    c = noise(r, (22, 22, 30), 4)
    m = np.zeros((16, 16, 3)); m[..., 2] = 120
    for x in (0, 5, 9, 13):                                  # the joints between columns
        off = int(r.integers(0, 3))
        for y in range(16):
            c[y, (x + (1 if (y + off) % 7 == 0 else 0)) % 16] = (10, 10, 14)
    for _ in range(4):
        x, y = r.integers(0, 16, 2)
        c[y, x] = (120, 18, 26); m[y, x, 1] = 140
    for _ in range(12):
        x, y = r.integers(0, 16, 2)
        c[y, x] = (36, 36, 48)
    return c, m


def vent_top(r):
    """A seam vent, from above: a throat that glows, ringed with scale."""
    c, m = abyssal(r)
    yy, xx = np.mgrid[0:16, 0:16]
    d = np.hypot(xx - 7.5, yy - 7.5)
    ring = (d >= 4.2) & (d < 6.2)
    c[ring] = np.array((70, 52, 48)) + r.normal(0, 6, (int(ring.sum()), 3))
    hot = d < 4.2
    c[hot] = (236, 60, 44); m[hot, 1] = 230
    core = d < 2.4
    c[core] = (255, 214, 170); m[core, 1] = 255
    return np.clip(c, 0, 255), m


def vent_side(r):
    c, m = abyssal(r)
    for x in range(16):                                      # light spills over the lip and runs down the joints
        n = int(r.integers(1, 4))
        for y in range(n):
            c[y, x] = (200, 44, 40) if y == 0 else (120, 22, 28); m[y, x, 1] = 220 if y == 0 else 120
    return c, m


def lantern(r):
    """A drowned lantern: something like coral, lit from inside, pale at the heart."""
    yy, xx = np.mgrid[0:16, 0:16]
    c = np.zeros((16, 16, 3)); m = np.zeros((16, 16, 3)); m[..., 2] = 90
    cell = np.minimum(np.abs((xx % 5) - 2), np.abs((yy % 5) - 2))
    glow = np.clip(1 - cell / 2.2, 0, 1)
    c[:] = np.array((96, 16, 30))[None, None] + glow[..., None] * np.array((159, 190, 170))[None, None]
    c += r.normal(0, 5, (16, 16, 1))
    m[..., 1] = 130 + 125 * glow
    web = (xx % 5 == 4) | (yy % 5 == 4)
    c[web] = (58, 10, 20); m[web, 1] = 40
    return np.clip(c, 0, 255), m


def bone(r):
    """Old bone: pale, pitted, grained along its length.  The ribs in the deep are made of it."""
    c = noise(r, (206, 198, 178), 6)
    m = np.zeros((16, 16, 3)); m[..., 2] = 200
    for y in range(16):
        if y % 4 == 3:
            c[y] = c[y] * 0.86
    for _ in range(9):
        x, y = r.integers(0, 16, 2)
        c[y, x] = (150, 140, 122)
    for _ in range(2):
        x, y = r.integers(0, 16, 2)
        for k in range(int(r.integers(3, 7))):
            c[(y + k) % 16, x] = (128, 118, 102)
    return c, m


def shard_icon():
    rows = ["................", "..........w.....", ".........wr.....", "........wrr.....", ".......wrrd.....", "......wrrrd..w..",
            ".....wrrrdd.wr..", "....wrrrrd.wrd..", "....rrrrdd.rrd..", "...wrrrrd.wrd...", "...rrrrdd.rdd...", "..wrrrdd..dd....",
            "..rrrdd.........", "..rddd..........", "...d............", "................"]
    col = {"w": (255, 226, 210, 255), "r": (226, 36, 44, 255), "d": (110, 10, 22, 255)}
    return draw(rows, col)


def tablets_icon():
    rows = ["................", ".....kkkkkk.....", ".....kwwwwk.....", ".....kwwwwk.....", "....kkkkkkkk....", "....kaaaaaak....",
            "....kaAAAAak....", "....kwwwwwwk....", "....kwwrrwwk....", "....kwrrrrwk....", "....kwwrrwwk....", "....kwwwwwwk....",
            "....kaAAAAak....", "....kaaaaaak....", "....kkkkkkkk....", "................"]
    col = {"k": (40, 30, 26, 255), "w": (236, 230, 220, 255), "a": (190, 110, 40, 255), "A": (224, 150, 70, 255), "r": (200, 40, 44, 255)}
    return draw(rows, col)


def draw(rows, col):
    a = np.zeros((16, 16, 4), dtype=np.uint8)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in col:
                a[y, x] = col[ch]
    return a


def crystal_geometry():
    """A cluster of five spikes.  Every face of a spike is a 2-pixel-wide column of the texture, root at the bottom."""
    spikes = [   # centre of base (x, z), width, height, lean (x, z degrees), which texture column
        ((0.0, 0.0), 3, 13, (4, -6), 0), ((-3.5, 1.5), 2, 9, (-8, 18), 4), ((3.0, -2.5), 2, 8, (14, -16), 8),
        ((2.5, 3.0), 2, 6, (-20, -12), 12), ((-2.5, -3.5), 2, 5, (22, 14), 6)]
    cubes = []
    for (cx, cz), w, h, (rx, rz), col in spikes:
        side = {"uv": [col, 16 - min(16, h + 3)], "uv_size": [2, min(16, h + 3)]}
        cubes.append({"origin": [cx - w / 2, 0, cz - w / 2], "size": [w, h, w], "pivot": [cx, 0, cz], "rotation": [rx, 0, rz],
                      "uv": {"north": side, "south": side, "east": side, "west": side, "up": {"uv": [col, 0], "uv_size": [2, 2]}, "down": {"uv": [col, 14], "uv_size": [2, 2]}}})
    return {"format_version": "1.21.0", "minecraft:geometry": [{
        "description": {"identifier": f"geometry.{NS}.crimson_crystal", "texture_width": 16, "texture_height": 16},
        "bones": [{"name": "crystal", "pivot": [0, 0, 0], "cubes": cubes}]}]}

def counter_icon():
    rows = ["................", "....kkkkkkkk....", "....kyyyyyyk....", "....kyrrrryk....", "....kyrhhryk....", "....kyrrrryk....",
            "....kyyyyyyk....", "....kccccccck...", "....kcKcKcKck...", "....kccccccck...", "....kcKcKcKck...", "....kccccccck...",
            "....kkkkkkkkk...", "......kk..kk....", "......ss..ss....", "................"]
    col = {"k": (26, 22, 22, 255), "y": (64, 56, 50, 255), "r": (150, 20, 28, 255), "h": (246, 196, 170, 255),
           "c": (180, 104, 70, 255), "K": (110, 56, 36, 255), "s": (160, 160, 160, 255)}
    a = np.zeros((16, 16, 4), dtype=np.uint8)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in col:
                a[y, x] = col[ch]
    return a


def save_texture(name, c, m):
    d = os.path.join(RP, "textures", "blocks")
    os.makedirs(d, exist_ok=True)
    Image.fromarray(c.round().astype(np.uint8), "RGB").save(os.path.join(d, f"{name}.png"))
    Image.fromarray(m.round().astype(np.uint8), "RGB").save(os.path.join(d, f"{name}_mer.png"))
    with open(os.path.join(d, f"{name}.texture_set.json"), "w") as f:
        json.dump({"format_version": "1.21.30", "minecraft:texture_set": {"color": name, "metalness_emissive_roughness": f"{name}_mer"}}, f, indent=1)


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


# What irradiated ground was before he poisoned it: the block remembers (state basiliskra:was), and heals back to it.
# The script reads the same lists (src/generated/blocks.ts).
SOIL_WAS = ["dirt", "grass_block", "podzol", "mycelium", "moss_block", "coarse_dirt", "dirt_with_roots", "sand", "red_sand", "gravel", "mud", "clay",
            "snow", "pale_moss_block"]
ROCK_WAS = ["stone", "deepslate", "granite", "diorite", "andesite", "tuff", "sandstone", "red_sandstone", "calcite", "basalt", "blackstone", "netherrack",
            "end_stone", "dripstone_block", "smooth_basalt", "hardened_clay"]
FADES = f"{NS}:fades"            # a custom component (src/fallout.ts): on a random tick, with no fallout left here, the block goes back
LIGHT = {"irradiated_soil": 7, "irradiated_rock": 8, "scarlet_trinitite": 7, "glowing_slag": 13, "cooled_slag": 0, "crimson_crystal": 12, "shard_lamp": 15,
         "abyssal_basalt": 0, "seam_vent": 11, "drowned_lantern": 14, "old_bone": 0}


def block(ident, display, textures, light, mining, tag, map_color, loot=None, was=False, fades=False, extra=None, method="opaque", category="nature"):
    comps = {
        "minecraft:display_name": display,
        "minecraft:destructible_by_mining": {"seconds_to_destroy": mining},
        "minecraft:destructible_by_explosion": {"explosion_resistance": mining},
        "minecraft:light_emission": light,
        "minecraft:map_color": map_color,
        "minecraft:tags": [tag],
        "minecraft:material_instances": {face: {"texture": tex, "render_method": method} for face, tex in textures.items()},
    }
    if loot:
        comps["minecraft:loot"] = loot
    if fades:
        comps[FADES] = {}
    comps.update(extra or {})
    desc = {"identifier": ident, "menu_category": {"category": category}}
    if was:
        desc["states"] = {f"{NS}:was": {"values": {"min": 0, "max": 15}}}
    return {"format_version": "1.26.60", "minecraft:block": {"description": desc, "components": comps}}


def item(ident, icon, stack=64, extra=None, category="items"):
    comps = {"minecraft:display_name": {"value": f"item.{ident}.name"}, "minecraft:icon": {"textures": {"default": icon}}, "minecraft:max_stack_size": stack}
    comps.update(extra or {})
    return {"format_version": "1.26.30", "minecraft:item": {"description": {"identifier": ident, "menu_category": {"category": category}}, "components": comps}}


def loot(*entries):
    return {"pools": [{"rolls": 1, "entries": [dict(type="item", name=n, weight=1, **({"functions": [{"function": "set_count", "count": {"min": c[0], "max": c[1]}}]} if c else {}))
                                                for n, c in entries]}]}


def main():
    names = {}
    for name, fn, seed in (("irradiated_soil_top", soil_top, 11), ("irradiated_soil_side", soil_side, 12),
                           ("irradiated_soil_bottom", soil_bottom, 13), ("scarlet_trinitite", trinitite, 14),
                           ("irradiated_rock", rock, 15), ("glowing_slag", slag_hot, 16), ("cooled_slag", slag_cold, 16),
                           ("crimson_crystal", crystal, 17), ("shard_lamp", lamp, 18),
                           ("abyssal_basalt", abyssal, 21), ("seam_vent_top", vent_top, 22), ("seam_vent_side", vent_side, 23),
                           ("drowned_lantern", lantern, 24), ("old_bone", bone, 25)):
        c, m = fn(rng(seed))
        save_texture(f"{NS}_{name}", c, m)
        names[f"{NS}_{name}"] = f"textures/blocks/{NS}_{name}"
    write(os.path.join(RP, "textures", "terrain_texture.json"),
          {"resource_pack_name": NS, "texture_name": "atlas.terrain", "padding": 8, "num_mip_levels": 4,
           "texture_data": {k: {"textures": v} for k, v in names.items()}})
    write(os.path.join(RP, "blocks.json"), {"format_version": [1, 1, 0],
                                            f"{NS}:irradiated_soil": {"sound": "gravel"}, f"{NS}:scarlet_trinitite": {"sound": "glass"},
                                            f"{NS}:irradiated_rock": {"sound": "stone"}, f"{NS}:glowing_slag": {"sound": "stone"},
                                            f"{NS}:cooled_slag": {"sound": "stone"}, f"{NS}:crimson_crystal": {"sound": "glass"},
                                            f"{NS}:shard_lamp": {"sound": "glass"},
                                            f"{NS}:abyssal_basalt": {"sound": "stone"}, f"{NS}:seam_vent": {"sound": "stone"},
                                            f"{NS}:drowned_lantern": {"sound": "glass"}, f"{NS}:old_bone": {"sound": "stone"}})
    B = os.path.join(BP, "blocks")
    T = lambda n: f"tile.{NS}:{n}.name"
    write(os.path.join(B, "irradiated_soil.json"),
          block(f"{NS}:irradiated_soil", T("irradiated_soil"),
                {"*": f"{NS}_irradiated_soil_side", "up": f"{NS}_irradiated_soil_top", "down": f"{NS}_irradiated_soil_bottom"},
                LIGHT["irradiated_soil"], 0.6, "minecraft:is_shovel_item_destructible", "#4a3a36", f"loot_tables/blocks/{NS}_irradiated_soil.json", was=True, fades=True))
    write(os.path.join(B, "irradiated_rock.json"),
          block(f"{NS}:irradiated_rock", T("irradiated_rock"), {"*": f"{NS}_irradiated_rock"}, LIGHT["irradiated_rock"], 1.6,
                "minecraft:is_pickaxe_item_destructible", "#3a3436", f"loot_tables/blocks/{NS}_irradiated_rock.json", was=True, fades=True))
    write(os.path.join(B, "scarlet_trinitite.json"),
          block(f"{NS}:scarlet_trinitite", T("scarlet_trinitite"), {"*": f"{NS}_scarlet_trinitite"},
                LIGHT["scarlet_trinitite"], 1.2, "minecraft:is_pickaxe_item_destructible", "#5a1018"))
    write(os.path.join(B, "glowing_slag.json"),
          block(f"{NS}:glowing_slag", T("glowing_slag"), {"*": f"{NS}_glowing_slag"}, LIGHT["glowing_slag"], 2.4,
                "minecraft:is_pickaxe_item_destructible", "#ff7838", f"loot_tables/blocks/{NS}_glowing_slag.json", fades=True))
    write(os.path.join(B, "cooled_slag.json"),
          block(f"{NS}:cooled_slag", T("cooled_slag"), {"*": f"{NS}_cooled_slag"}, 0, 2.0, "minecraft:is_pickaxe_item_destructible", "#262022",
                category="construction"))
    write(os.path.join(B, "shard_lamp.json"),
          block(f"{NS}:shard_lamp", T("shard_lamp"), {"*": f"{NS}_shard_lamp"}, LIGHT["shard_lamp"], 0.5, "minecraft:is_pickaxe_item_destructible", "#e02830",
                category="construction"))
    # the deep: what the trench off the city's beach is made of, and what stands in it
    write(os.path.join(B, "abyssal_basalt.json"),
          block(f"{NS}:abyssal_basalt", T("abyssal_basalt"), {"*": f"{NS}_abyssal_basalt"}, 0, 3.0, "minecraft:is_pickaxe_item_destructible", "#16161e", category="construction"))
    write(os.path.join(B, "seam_vent.json"),
          block(f"{NS}:seam_vent", T("seam_vent"), {"*": f"{NS}_seam_vent_side", "up": f"{NS}_seam_vent_top", "down": f"{NS}_abyssal_basalt"},
                LIGHT["seam_vent"], 3.0, "minecraft:is_pickaxe_item_destructible", "#ec3c2c", category="construction"))
    write(os.path.join(B, "drowned_lantern.json"),
          block(f"{NS}:drowned_lantern", T("drowned_lantern"), {"*": f"{NS}_drowned_lantern"}, LIGHT["drowned_lantern"], 0.6, "minecraft:is_pickaxe_item_destructible", "#ffd6c8",
                category="construction"))
    write(os.path.join(B, "old_bone.json"),
          block(f"{NS}:old_bone", T("old_bone"), {"*": f"{NS}_old_bone"}, 0, 2.0, "minecraft:is_pickaxe_item_destructible", "#cec6b2", category="construction"))
    # the crystal: a model of its own, nothing to walk into, light pours out of it
    crystal_block = block(f"{NS}:crimson_crystal", T("crimson_crystal"), {"*": f"{NS}_crimson_crystal"}, LIGHT["crimson_crystal"], 0.4,
                          "minecraft:is_pickaxe_item_destructible", "#e02830", f"loot_tables/blocks/{NS}_crimson_crystal.json", fades=True, method="alpha_test",
                          extra={"minecraft:geometry": f"geometry.{NS}.crimson_crystal", "minecraft:collision_box": False,
                                 "minecraft:selection_box": {"origin": [-6, 0, -6], "size": [12, 13, 12]}, "minecraft:light_dampening": 0})
    for inst in crystal_block["minecraft:block"]["components"]["minecraft:material_instances"].values():
        inst.update({"ambient_occlusion": 0, "face_dimming": False})
    write(os.path.join(B, "crimson_crystal.json"), crystal_block)
    write(os.path.join(RP, "models", "blocks", f"{NS}_crimson_crystal.geo.json"), crystal_geometry())
    L = os.path.join(BP, "loot_tables", "blocks")
    write(os.path.join(L, f"{NS}_irradiated_soil.json"), loot(("minecraft:dirt", None)))
    write(os.path.join(L, f"{NS}_irradiated_rock.json"), loot(("minecraft:cobblestone", None)))
    write(os.path.join(L, f"{NS}_glowing_slag.json"), loot((f"{NS}:cooled_slag", None)))
    write(os.path.join(L, f"{NS}_crimson_crystal.json"), loot((f"{NS}:crimson_shard", (1, 3))))
    # items: the Geiger counter, the shard, the tablets
    icons = {"geiger_counter": counter_icon(), "crimson_shard": shard_icon(), "iodine_tablets": tablets_icon()}
    it_path = os.path.join(RP, "textures", "item_texture.json")
    it = json.load(open(it_path))
    for name, art in icons.items():
        Image.fromarray(art, "RGBA").save(os.path.join(RP, "textures", "items", f"{NS}_{name}.png"))
        it["texture_data"][f"{NS}_{name}"] = {"textures": f"textures/items/{NS}_{name}"}
    write(it_path, it)
    I = os.path.join(BP, "items")
    write(os.path.join(I, "geiger_counter.json"), item(f"{NS}:geiger_counter", f"{NS}_geiger_counter", 1, category="equipment"))
    write(os.path.join(I, "crimson_shard.json"), item(f"{NS}:crimson_shard", f"{NS}_crimson_shard", 64, {"minecraft:glint": True}))
    write(os.path.join(I, "iodine_tablets.json"), item(f"{NS}:iodine_tablets", f"{NS}_iodine_tablets", 16, {
        "minecraft:food": {"can_always_eat": True, "nutrition": 0, "saturation_modifier": 0},
        "minecraft:use_animation": {"value": "eat"},
        "minecraft:use_modifiers": {"use_duration": 1.2, "movement_modifier": 0.6}}))
    R = os.path.join(BP, "recipes")
    shapeless = lambda ident, ingredients, result, unlock, count=1: {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
        "description": {"identifier": ident}, "tags": ["crafting_table"], "ingredients": [{"item": i} for i in ingredients],
        "unlock": [{"item": unlock}], "result": {"item": result, "count": count}}}
    write(os.path.join(R, "geiger_counter.json"), shapeless(f"{NS}:geiger_counter", [f"{NS}:scarlet_trinitite", "minecraft:copper_ingot", "minecraft:redstone"],
                                                            f"{NS}:geiger_counter", f"{NS}:scarlet_trinitite"))
    write(os.path.join(R, "geiger_counter_shard.json"), shapeless(f"{NS}:geiger_counter_shard", [f"{NS}:crimson_shard", "minecraft:copper_ingot", "minecraft:redstone"],
                                                                  f"{NS}:geiger_counter", f"{NS}:crimson_shard"))
    write(os.path.join(R, "iodine_tablets.json"), shapeless(f"{NS}:iodine_tablets", ["minecraft:dried_kelp", "minecraft:dried_kelp", "minecraft:sugar"],
                                                            f"{NS}:iodine_tablets", "minecraft:dried_kelp", 2))
    write(os.path.join(R, "shard_lamp.json"), {"format_version": "1.20.10", "minecraft:recipe_shaped": {
        "description": {"identifier": f"{NS}:shard_lamp"}, "tags": ["crafting_table"], "pattern": [" S ", "SGS", " S "],
        "key": {"S": {"item": f"{NS}:crimson_shard"}, "G": {"item": "minecraft:glass"}},
        "unlock": [{"item": f"{NS}:crimson_shard"}], "result": {"item": f"{NS}:shard_lamp"}}})
    # the red haze of strong fallout
    write(os.path.join(RP, "fogs", f"{NS}_fallout_fog.json"), {"format_version": "1.16.100", "minecraft:fog_settings": {
        "description": {"identifier": f"{NS}:fallout_fog"},
        "distance": {"air": {"fog_start": 2.0, "fog_end": 46.0, "fog_color": "#7a1218", "render_distance_type": "fixed"},
                     "weather": {"fog_start": 2.0, "fog_end": 40.0, "fog_color": "#6a1016", "render_distance_type": "fixed"}}}})
    names_lang = {T("irradiated_soil"): "Irradiated Soil", T("scarlet_trinitite"): "Scarlet Trinitite", T("irradiated_rock"): "Irradiated Rock",
                  T("glowing_slag"): "Glowing Slag", T("cooled_slag"): "Cooled Slag", T("crimson_crystal"): "Crimson Crystal", T("shard_lamp"): "Shard Lamp",
                  T("abyssal_basalt"): "Abyssal Basalt", T("seam_vent"): "Seam Vent", T("drowned_lantern"): "Drowned Lantern", T("old_bone"): "Old Bone",
                  f"item.{NS}:geiger_counter.name": "Geiger Counter", f"item.{NS}:crimson_shard.name": "Crimson Shard",
                  f"item.{NS}:iodine_tablets.name": "Iodine Tablets"}
    for pack in (BP, RP):
        p = os.path.join(pack, "texts", "en_US.lang")
        s = open(p).read().rstrip("\n") + "\n"
        for k, v in names_lang.items():
            if f"{k}=" not in s:
                s += f"{k}={v}\n"
        open(p, "w").write(s)
    # the same tables for the script
    ts = ["// GENERATED by tools/kit/gen_blocks.py.  Do not edit.", "",
          "/** What irradiated soil and rock were before (the index is the block's basiliskra:was state). */",
          "export const SOIL_WAS = " + json.dumps([f"minecraft:{n}" for n in SOIL_WAS]) + ";",
          "export const ROCK_WAS = " + json.dumps([f"minecraft:{n}" for n in ROCK_WAS]) + ";",
          f"export const FADES_COMPONENT = {json.dumps(FADES)};", ""]
    with open(os.path.join(ROOT, "src", "generated", "blocks.ts"), "w") as f:
        f.write("\n".join(ts))
    print("11 blocks (irradiated soil and rock, scarlet trinitite, glowing and cooled slag, crimson crystal, shard lamp, abyssal basalt, seam vent, drowned lantern, old bone), 14 textures with texture sets, "
          "3 items (Geiger counter, crimson shard, iodine tablets), 4 recipes, the fallout fog")


if __name__ == "__main__":
    main()
