#!/usr/bin/env python3
"""The Seam Lance: the one weapon made for him.

A chunky voxel rifle in his own colours (gunmetal, bone plate, crimson crystal): two prongs holding a shard of
crimson crystal at the muzzle, a lit core in the receiver, and a dorsal fin on top like one of his plates.
Writes the held 3D model (an attachable: geometry, texture, the hold animation), the inventory icon (the same
model seen from the side, outlined), the item, its recipe and its name.

    python3 tools/kit/gen_lance.py

The model is held the way the vanilla crossbow is: it lies along -Z under the hand, and the hold animation uses
the crossbow's own first- and third-person offsets (bedrock-samples, animation.crossbow.wield).
"""
import json
import math
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
BP, RP = os.path.join(ROOT, "packs", "BP"), os.path.join(ROOT, "packs", "RP")
NS, NAME = "basiliskra", "seam_lance"

# materials: a swatch of the texture each (8 x 8 pixels, dark edged, so every face of every cube is outlined)
MATS = {
    "metal": ((54, 58, 70), (30, 32, 42)), "plate": ((226, 222, 210), (120, 116, 110)), "crystal": ((236, 44, 52), (120, 8, 22)),
    "core": ((255, 150, 120), (200, 30, 40)), "grip": ((36, 30, 34), (14, 12, 14)), "trim": ((150, 22, 34), (70, 8, 16)),
    "dark": ((30, 32, 40), (12, 12, 18)), "lens": ((255, 232, 220), (236, 60, 60)),
}
ORDER = list(MATS)

# cubes: (x0, y0, z0, x1, y1, z1, material[, (pivot, rotation)]).  -Z is the muzzle; the hand is at the origin.
CUBES = [
    (-1.5, -7.0, -4.0, 1.5, -3.0, 4.0, "metal"),                       # receiver
    (-2.0, -3.0, -5.0, 2.0, -2.0, 3.0, "plate"),                       # top plate
    (-2.0, -6.5, -2.0, 2.0, -3.5, 0.0, "core"),                        # the lit core, showing at both sides
    (-2.25, -5.5, -1.5, 2.25, -4.5, -0.5, "lens"),
    (-1.75, -7.5, -4.5, 1.75, -7.0, 3.0, "trim"),                      # belly rail
    (-1.0, -6.0, -9.0, 1.0, -4.0, -4.0, "dark"),                       # barrel housing
    (-1.5, -6.5, -6.0, 1.5, -3.5, -5.0, "plate"),                      # collar
    (-0.5, -3.5, -13.0, 0.5, -2.5, -5.0, "plate"),                     # upper prong
    (-0.5, -7.5, -13.0, 0.5, -6.5, -5.0, "plate"),                     # lower prong
    (-0.5, -3.0, -13.5, 0.5, -2.0, -12.5, "trim"),                     # prong tips
    (-0.5, -8.0, -13.5, 0.5, -7.0, -12.5, "trim"),
    (-0.9, -5.9, -12.5, 0.9, -4.1, -9.5, "crystal", ((0, -5, -11), (0, 0, 45))),   # the shard, set on its edge
    (-0.5, -5.5, -14.0, 0.5, -4.5, -12.5, "lens"),                     # its lit point
    (-1.0, -7.0, 4.0, 1.0, -4.0, 8.0, "dark"),                         # stock
    (-1.5, -7.5, 8.0, 1.5, -3.5, 9.0, "plate"),                        # butt plate
    (-0.5, -4.0, 5.0, 0.5, -3.0, 8.0, "trim"),
    (-1.0, -10.5, 1.0, 1.0, -7.0, 3.0, "grip", ((0, -7, 2), (-14, 0, 0))),          # grip
    (-0.5, -8.5, -1.5, 0.5, -8.0, 1.0, "grip"),                        # trigger guard
    (-0.5, -2.0, -2.0, 0.5, 1.0, 1.0, "crystal"),                      # the dorsal fin
    (-0.5, -2.0, 1.0, 0.5, -0.5, 2.5, "trim"),
    (-0.5, -2.0, -4.5, 0.5, -1.0, -3.5, "plate"),                      # fore sight
]


def swatch(base, edge, seed):
    r = np.random.default_rng(seed)
    a = np.zeros((8, 8, 4), dtype=np.uint8)
    a[..., 3] = 255
    a[..., :3] = np.clip(np.array(base)[None, None] + r.normal(0, 5, (8, 8, 1)), 0, 255)
    a[1, 1:7, :3] = np.clip(np.array(base) + 26, 0, 255)                # a highlight along the top
    a[0, :, :3] = a[7, :, :3] = edge
    a[:, 0, :3] = a[:, 7, :3] = edge
    return a


def texture():
    t = np.zeros((16, 32, 4), dtype=np.uint8)
    for i, m in enumerate(ORDER):
        t[(i // 4) * 8:(i // 4) * 8 + 8, (i % 4) * 8:(i % 4) * 8 + 8] = swatch(*MATS[m], seed=40 + i)
    return t


def geometry():
    cubes = []
    for c in CUBES:
        x0, y0, z0, x1, y1, z1, m = c[:7]
        i = ORDER.index(m)
        face = {"uv": [(i % 4) * 8, (i // 4) * 8], "uv_size": [8, 8]}
        cube = {"origin": [x0, y0, z0], "size": [round(x1 - x0, 3), round(y1 - y0, 3), round(z1 - z0, 3)],
                "uv": {f: face for f in ("north", "south", "east", "west", "up", "down")}}
        if len(c) > 7:
            cube["pivot"], cube["rotation"] = list(c[7][0]), list(c[7][1])
        cubes.append(cube)
    return {"format_version": "1.16.0", "minecraft:geometry": [{
        "description": {"identifier": f"geometry.{NS}.{NAME}", "texture_width": 32, "texture_height": 16,
                        "visible_bounds_width": 3, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1, 0]},
        "bones": [{"name": "rightitem", "binding": "q.item_slot_to_bone_name(c.item_slot)", "pivot": [0, 0, 0], "cubes": cubes}]}]}


def icon(size=32):
    """The model from its left side, turned muzzle-up like any item icon, with a black outline."""
    img = np.zeros((size, size, 4), dtype=np.uint8)
    a = math.radians(-38)
    scale = 1.28                                                       # pixels per model unit
    for py in range(size):
        for px in range(size):
            u, v = (px - size / 2 + 0.5) / scale, (size / 2 - py - 0.5) / scale
            # undo the turn; u runs toward the muzzle (-Z), v up
            zz, yy = -(u * math.cos(a) - v * math.sin(a)) - 2.0, (u * math.sin(a) + v * math.cos(a)) - 4.8
            best = None
            for c in CUBES:
                x0, y0, z0, x1, y1, z1, m = c[:7]
                if z0 <= zz <= z1 and y0 <= yy <= y1 and (best is None or x1 > best[0]):
                    best = (x1, m, (zz - z0) / max(0.01, z1 - z0), (yy - y0) / max(0.01, y1 - y0))
            if best:
                base, edge = MATS[best[1]]
                k = 1.12 if best[3] > 0.6 else 0.86 if best[3] < 0.25 else 1.0
                img[py, px] = (*[int(min(255, ch * k)) for ch in base], 255)
    out = img.copy()
    solid = img[..., 3] > 0
    for py in range(size):
        for px in range(size):
            if solid[py, px]:
                continue
            near = any(0 <= py + dy < size and 0 <= px + dx < size and solid[py + dy, px + dx] for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if near:
                out[py, px] = (10, 8, 12, 255)
    return out


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def main():
    ident = f"{NS}:{NAME}"
    write(os.path.join(RP, "models", "entity", f"{NS}_{NAME}.geo.json"), geometry())
    os.makedirs(os.path.join(RP, "textures", "entity", NS), exist_ok=True)
    Image.fromarray(texture(), "RGBA").save(os.path.join(RP, "textures", "entity", NS, f"{NAME}.png"))
    Image.fromarray(icon(), "RGBA").save(os.path.join(RP, "textures", "items", f"{NS}_{NAME}.png"))
    it_path = os.path.join(RP, "textures", "item_texture.json")
    it = json.load(open(it_path))
    it["texture_data"][f"{NS}_{NAME}"] = {"textures": f"textures/items/{NS}_{NAME}"}
    write(it_path, it)
    write(os.path.join(RP, "attachables", f"{NAME}.json"), {"format_version": "1.10.0", "minecraft:attachable": {"description": {
        "identifier": ident,
        "materials": {"default": "entity_alphatest", "enchanted": "entity_alphatest_glint"},
        "textures": {"default": f"textures/entity/{NS}/{NAME}", "enchanted": "textures/misc/enchanted_item_glint"},
        "geometry": {"default": f"geometry.{NS}.{NAME}"},
        "animations": {"wield": f"animation.{NS}.{NAME}.wield"},
        "scripts": {"animate": ["wield"]},
        "render_controllers": ["controller.render.item_default"]}}})
    # the vanilla crossbow's hold, so that it sits in the hand as a crossbow does (first person: at the right, pointing ahead)
    write(os.path.join(RP, "animations", f"{NS}_{NAME}.animation.json"), {"format_version": "1.10.0", "animations": {
        f"animation.{NS}.{NAME}.wield": {"loop": True, "bones": {"rightitem": {
            "position": ["c.is_first_person ? 13.0 : 0.5", "c.is_first_person ? 7.0 : -0.5", "c.is_first_person ? 2.0 : -1.5"],
            "rotation": ["c.is_first_person ? -9.0 : 0.0", "c.is_first_person ? 60.0 : -3.0", "c.is_first_person ? -47.0 : 3.25"]}}}}})
    write(os.path.join(BP, "items", f"{NAME}.json"), {"format_version": "1.26.30", "minecraft:item": {
        "description": {"identifier": ident, "menu_category": {"category": "equipment"}},
        "components": {"minecraft:display_name": {"value": f"item.{ident}.name"}, "minecraft:icon": {"textures": {"default": f"{NS}_{NAME}"}},
                       "minecraft:max_stack_size": 1, "minecraft:hand_equipped": True,
                       "minecraft:cooldown": {"category": f"{NS}_lance", "duration": 0.6}}}})
    write(os.path.join(BP, "recipes", f"{NAME}.json"), {"format_version": "1.20.10", "minecraft:recipe_shaped": {
        "description": {"identifier": ident}, "tags": ["crafting_table"], "pattern": ["SSC", "IRI", " I "],
        "key": {"S": {"item": f"{NS}:crimson_shard"}, "C": {"item": f"{NS}:scarlet_trinitite"}, "I": {"item": "minecraft:iron_ingot"}, "R": {"item": "minecraft:redstone_block"}},
        "unlock": [{"item": f"{NS}:crimson_shard"}], "result": {"item": ident}}})
    for pack in (BP, RP):
        p = os.path.join(pack, "texts", "en_US.lang")
        s = open(p).read().rstrip("\n") + "\n"
        if f"item.{ident}.name=" not in s:
            s += f"item.{ident}.name=Seam Lance\n"
        open(p, "w").write(s)
    Image.fromarray(icon(96), "RGBA").save(os.path.join(ROOT, "build", "lance_icon_big.png")) if os.path.isdir(os.path.join(ROOT, "build")) else None
    print(f"the Seam Lance: {len(CUBES)} cubes, a 32x16 texture, a 32x32 icon, attachable, item and recipe")


if __name__ == "__main__":
    main()
