#!/usr/bin/env python3
"""The fallout's blocks and the Geiger counter: block and item files, textures with Vibrant Visuals texture
sets, the terrain atlas entries, block sounds, the loot table, the recipe and the names.

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
    for _ in range(5):                                       # crimson specks that glow
        x, y = r.integers(1, 15, 2)
        c[y, x] = (196, 32, 38)
        m[y, x, 1] = 150
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


def block(ident, display, textures, light, mining, tag, map_color, loot=None):
    comps = {
        "minecraft:display_name": display,
        "minecraft:destructible_by_mining": {"seconds_to_destroy": mining},
        "minecraft:destructible_by_explosion": {"explosion_resistance": mining},
        "minecraft:light_emission": light,
        "minecraft:map_color": map_color,
        "minecraft:tags": [tag],
        "minecraft:material_instances": {face: {"texture": tex, "render_method": "opaque"} for face, tex in textures.items()},
    }
    if loot:
        comps["minecraft:loot"] = loot
    return {"format_version": "1.26.60", "minecraft:block": {"description": {"identifier": ident, "menu_category": {"category": "nature"}}, "components": comps}}


def main():
    names = {}
    for name, fn, seed in (("irradiated_soil_top", soil_top, 11), ("irradiated_soil_side", soil_side, 12),
                           ("irradiated_soil_bottom", soil_bottom, 13), ("scarlet_trinitite", trinitite, 14)):
        c, m = fn(rng(seed))
        save_texture(f"{NS}_{name}", c, m)
        names[f"{NS}_{name}"] = f"textures/blocks/{NS}_{name}"
    write(os.path.join(RP, "textures", "terrain_texture.json"),
          {"resource_pack_name": NS, "texture_name": "atlas.terrain", "padding": 8, "num_mip_levels": 4,
           "texture_data": {k: {"textures": v} for k, v in names.items()}})
    write(os.path.join(RP, "blocks.json"), {"format_version": [1, 1, 0],
                                            f"{NS}:irradiated_soil": {"sound": "gravel"},
                                            f"{NS}:scarlet_trinitite": {"sound": "glass"}})
    write(os.path.join(BP, "blocks", "irradiated_soil.json"),
          block(f"{NS}:irradiated_soil", f"tile.{NS}:irradiated_soil.name",
                {"*": f"{NS}_irradiated_soil_side", "up": f"{NS}_irradiated_soil_top", "down": f"{NS}_irradiated_soil_bottom"},
                3, 0.6, "minecraft:is_shovel_item_destructible", "#4a3a36", f"loot_tables/blocks/{NS}_irradiated_soil.json"))
    write(os.path.join(BP, "blocks", "scarlet_trinitite.json"),
          block(f"{NS}:scarlet_trinitite", f"tile.{NS}:scarlet_trinitite.name", {"*": f"{NS}_scarlet_trinitite"},
                6, 1.2, "minecraft:is_pickaxe_item_destructible", "#5a1018"))
    write(os.path.join(BP, "loot_tables", "blocks", f"{NS}_irradiated_soil.json"),
          {"pools": [{"rolls": 1, "entries": [{"type": "item", "name": "minecraft:dirt", "weight": 1}]}]})
    # the Geiger counter
    Image.fromarray(counter_icon(), "RGBA").save(os.path.join(RP, "textures", "items", f"{NS}_geiger_counter.png"))
    it_path = os.path.join(RP, "textures", "item_texture.json")
    it = json.load(open(it_path))
    it["texture_data"][f"{NS}_geiger_counter"] = {"textures": f"textures/items/{NS}_geiger_counter"}
    write(it_path, it)
    write(os.path.join(BP, "items", "geiger_counter.json"), {"format_version": "1.26.30", "minecraft:item": {
        "description": {"identifier": f"{NS}:geiger_counter", "menu_category": {"category": "equipment"}},
        "components": {"minecraft:display_name": {"value": f"item.{NS}:geiger_counter.name"},
                       "minecraft:icon": {"textures": {"default": f"{NS}_geiger_counter"}}, "minecraft:max_stack_size": 1}}})
    write(os.path.join(BP, "recipes", "geiger_counter.json"), {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
        "description": {"identifier": f"{NS}:geiger_counter"}, "tags": ["crafting_table"],
        "ingredients": [{"item": f"{NS}:scarlet_trinitite"}, {"item": "minecraft:copper_ingot"}, {"item": "minecraft:redstone"}],
        "unlock": [{"item": f"{NS}:scarlet_trinitite"}], "result": {"item": f"{NS}:geiger_counter"}}})
    names_lang = {f"tile.{NS}:irradiated_soil.name": "Irradiated Soil", f"tile.{NS}:scarlet_trinitite.name": "Scarlet Trinitite",
                  f"item.{NS}:geiger_counter.name": "Geiger Counter"}
    for pack in (BP, RP):
        p = os.path.join(pack, "texts", "en_US.lang")
        s = open(p).read().rstrip("\n") + "\n"
        for k, v in names_lang.items():
            if f"{k}=" not in s:
                s += f"{k}={v}\n"
        open(p, "w").write(s)
    print("2 blocks (irradiated soil, scarlet trinitite), 4 textures with texture sets, the Geiger counter")


if __name__ == "__main__":
    main()
