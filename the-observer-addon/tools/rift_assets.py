#!/usr/bin/env python3
"""The Rift's own blocks (1.6.0), all original: drawn, modelled and defined here.

  observer:rift_bark          dead pine wood: grey-black bark split by pale cracks (a log: it turns with the face it sits on)
  observer:rift_needles       what is left of a pine's needles: sparse, dark, dead
  observer:rift_moss          the dead woods' ground: black-green moss over wet soil
  observer:rift_bricks        old masonry seeping red at the joints   (+ observer:rift_bricks_cracked)
  observer:rift_glass         crimson glass in black lead
  observer:rift_lamp          a crimson lamp, glowing
  observer:blood              blood on the ground, four splashes
  observer:corpse             a body wrapped in sacking, one grey hand out of it
  observer:hanged             a body hanged from a branch (two blocks: observer:part 1 the upper, 0 the lower)
  observer:skeleton           a skeleton lying where it fell
  observer:gravestone         a headstone, its name worn off

Writes RP textures/blocks/rift/*.png, RP models/blocks/rift_*.geo.json, BP blocks/rift/*.json, and registers the
textures (terrain_texture.json), sounds (blocks.json) and names (en_US.lang). Safe to re-run.
Usage: python3 tools/rift_assets.py
"""
import json
import math
import os
import random

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
RP = os.path.join(ROOT, "packs", "TheObserver_RP")
rng = random.Random(1600)


def save(img, name):
    p = os.path.join(RP, "textures", "blocks", "rift", name + ".png")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p)
    return p


def noise_img(base, var, w=16, h=16, seed=0):
    r = random.Random(seed)
    img = Image.new("RGBA", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            d = r.randint(-var, var)
            px[x, y] = (max(0, min(255, base[0] + d)), max(0, min(255, base[1] + d)), max(0, min(255, base[2] + d)), 255)
    return img, px


# ----------------------------------------------------------------------------- textures

def bark():
    img, px = noise_img((46, 44, 42), 7, seed=1)
    r = random.Random(11)
    for x in range(16):
        # vertical furrows
        if x % 4 == 1:
            for y in range(16):
                px[x, y] = (26, 25, 25, 255)
    for _ in range(7):
        x, y = r.randint(0, 15), r.randint(0, 15)
        for k in range(r.randint(2, 5)):
            if 0 <= y + k < 16:
                px[x, y + k] = (92, 90, 86, 255)  # pale cracks
    save(img, "rift_bark")
    top, tp = noise_img((58, 54, 50), 5, seed=2)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d > 7:
                tp[x, y] = (40, 38, 36, 255)
            elif int(d) % 2 == 0:
                tp[x, y] = (70, 66, 60, 255)
    save(top, "rift_bark_top")


def needles():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    r = random.Random(3)
    for _ in range(46):
        x, y = r.randint(0, 15), r.randint(0, 15)
        c = r.choice([(30, 36, 30, 255), (38, 40, 34, 255), (24, 26, 24, 255), (52, 48, 40, 255)])
        px[x, y] = c
        if x + 1 < 16 and r.random() < 0.5:
            px[x + 1, y] = c
    save(img, "rift_needles")


def moss():
    top, tp = noise_img((34, 40, 32), 8, seed=4)
    r = random.Random(41)
    for _ in range(14):
        tp[r.randint(0, 15), r.randint(0, 15)] = (54, 60, 44, 255)
    save(top, "rift_moss_top")
    soil, sp = noise_img((40, 33, 28), 7, seed=5)
    save(soil, "rift_soil")
    side, sd = noise_img((40, 33, 28), 7, seed=6)
    for x in range(16):
        drop = 3 + (x * 7 % 3)
        for y in range(drop):
            sd[x, y] = tp[x, y]
    save(side, "rift_moss_side")


def bricks(cracked):
    img, px = noise_img((52, 50, 52), 6, seed=7 + cracked)
    r = random.Random(70 + cracked)
    for y in range(16):
        for x in range(16):
            row = y // 4
            off = 4 if row % 2 else 0
            if y % 4 == 3 or (x + off) % 8 == 7:
                px[x, y] = (22, 18, 20, 255)
                if r.random() < 0.28:
                    px[x, y] = (92, 10, 16, 255)  # seeping red
    if cracked:
        x, y = 3, 1
        for _ in range(14):
            px[x % 16, y % 16] = (16, 14, 15, 255)
            x += r.choice((0, 1, 1))
            y += 1
    save(img, "rift_bricks_cracked" if cracked else "rift_bricks")


def glass():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y in range(16):
        for x in range(16):
            if x in (0, 15) or y in (0, 15) or x == 7 or y == 7:
                px[x, y] = (12, 10, 12, 255)
            else:
                g = 30 + int(20 * math.sin(x * 0.7 + y * 0.4))
                px[x, y] = (110 + g, 8, 18, 150)
    save(img, "rift_glass")


def lamp():
    img = Image.new("RGBA", (16, 16))
    px = img.load()
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if x in (0, 15) or y in (0, 15):
                px[x, y] = (20, 16, 18, 255)
            else:
                k = max(0.0, 1 - d / 9)
                px[x, y] = (int(150 + 100 * k), int(10 + 60 * k * k), int(20 + 30 * k * k), 255)
    save(img, "rift_lamp")


def blood():
    for v in range(4):
        img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        px = img.load()
        r = random.Random(90 + v)
        cx, cy = 7.5 + r.uniform(-2, 2), 7.5 + r.uniform(-2, 2)
        rad = r.uniform(3.5, 5.5)
        for y in range(16):
            for x in range(16):
                a = math.atan2(y - cy, x - cx)
                edge = rad + 1.6 * math.sin(a * 5 + v) + 0.8 * math.sin(a * 11 + v * 2)
                d = math.hypot(x - cx, y - cy)
                if d < edge:
                    dark = d / max(edge, 0.1)
                    px[x, y] = (int(120 - 50 * dark), 6, 12, 235)
        for _ in range(5 + v):  # drops
            x, y = r.randint(0, 15), r.randint(0, 15)
            px[x, y] = (96, 6, 10, 230)
        save(img, f"blood_{v}")


def cloth():
    img, px = noise_img((58, 50, 40), 8, seed=12)
    for y in range(16):
        for x in range(16):
            if (x + y) % 3 == 0:
                c = px[x, y]
                px[x, y] = (c[0] - 10, c[1] - 9, c[2] - 8, 255)
    r = random.Random(13)
    for _ in range(18):  # old blood through the sacking
        x, y = r.randint(2, 13), r.randint(2, 13)
        px[x, y] = (78, 18, 16, 255)
    save(img, "corpse_cloth")


def skin():
    img, px = noise_img((128, 124, 118), 6, seed=14)
    save(img, "corpse_skin")


def bone():
    img, px = noise_img((196, 188, 168), 8, seed=15)
    save(img, "skeleton_bone")
    face, fp = noise_img((196, 188, 168), 6, seed=16)
    for (x, y) in [(4, 6), (5, 6), (4, 7), (5, 7), (10, 6), (11, 6), (10, 7), (11, 7), (7, 10), (8, 10)]:
        fp[x, y] = (24, 20, 18, 255)
    for x in range(4, 12):
        if x % 2 == 0:
            fp[x, 13] = (40, 34, 30, 255)
    save(face, "skull_face")


def gravestone():
    img, px = noise_img((92, 92, 96), 9, seed=17)
    for y in range(3, 12):
        px[7, y] = (44, 44, 48, 255)
        px[8, y] = (44, 44, 48, 255)
    for x in range(5, 11):
        px[x, 5] = (44, 44, 48, 255)
    r = random.Random(18)
    for _ in range(12):
        px[r.randint(0, 15), r.randint(0, 15)] = (60, 72, 54, 255)  # lichen
    save(img, "gravestone")


# ----------------------------------------------------------------------------- models (blocks: 16 px = a block)

def cube(origin, size, uv, faces=("north", "south", "east", "west", "up", "down"), inst=None):
    u = {}
    for f in faces:
        e = {"uv": uv[:2], "uv_size": uv[2:]}
        if inst:
            e["material_instance"] = inst.get(f, inst.get("*")) if isinstance(inst, dict) else inst
        u[f] = e
    return {"origin": origin, "size": size, "uv": u}


def geo(ident, cubes, w=16, h=16):
    return {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": ident, "texture_width": w, "texture_height": h, "visible_bounds_width": 3,
                        "visible_bounds_height": 2, "visible_bounds_offset": [0, 0.5, 0]},
        "bones": [{"name": "root", "pivot": [0, 0, 0], "cubes": cubes}]}]}


def models():
    out = {}
    # a corpse: a long bundle of sacking, a head at one end, a grey hand out of it (lies along z, head north)
    out["rift_corpse"] = geo("geometry.observer.rift_corpse", [
        cube([-4, 0, -9], [8, 4, 20], [0, 0, 16, 16], inst="cloth"),
        cube([-2.5, 0.5, -14], [5, 4, 5], [0, 0, 16, 16], inst="skin"),
        cube([4, 0, -3], [2, 1.5, 5], [0, 0, 16, 16], inst="skin"),
        cube([-3, 4, -6], [6, 1, 9], [0, 0, 16, 16], inst="cloth"),
    ])
    # a skeleton where it fell: skull, spine, ribs, pelvis, the long bones
    out["rift_skeleton"] = geo("geometry.observer.rift_skeleton", [
        cube([-2.5, 0, -13], [5, 4, 4], [0, 0, 16, 16], inst={"north": "skull", "*": "bone"}),
        cube([-0.5, 0, -9], [1, 1, 10], [0, 0, 16, 16], inst="bone"),
        cube([-3.5, 0.5, -8], [7, 1, 1], [0, 0, 16, 16], inst="bone"),
        cube([-3.5, 0.5, -6], [7, 1, 1], [0, 0, 16, 16], inst="bone"),
        cube([-3.5, 0.5, -4], [7, 1, 1], [0, 0, 16, 16], inst="bone"),
        cube([-3, 0, 1], [6, 2, 3], [0, 0, 16, 16], inst="bone"),
        cube([-2.5, 0, 4], [1, 1, 10], [0, 0, 16, 16], inst="bone"),
        cube([1.5, 0, 4], [1, 1, 9], [0, 0, 16, 16], inst="bone"),
        cube([-6, 0, -8], [1, 1, 8], [0, 0, 16, 16], inst="bone"),
        cube([5, 0, -7], [1, 1, 7], [0, 0, 16, 16], inst="bone"),
    ])
    # a headstone, sunk a little, leaning a touch (no rotation: a step at its top)
    out["rift_gravestone"] = geo("geometry.observer.rift_gravestone", [
        cube([-5, 0, -1.5], [10, 11, 3], [0, 0, 16, 16]),
        cube([-4, 11, -1.5], [8, 2, 3], [0, 0, 16, 16]),
        cube([-2.5, 13, -1.5], [5, 1, 3], [0, 0, 16, 16]),
        cube([-6, 0, -3], [12, 1, 6], [0, 0, 16, 16]),
    ])
    # a body hanged from a branch, in two blocks: the upper (the rope, the head bowed, the shoulders) and the lower
    out["rift_hanged_upper"] = geo("geometry.observer.rift_hanged_upper", [
        cube([-0.5, 10, -0.5], [1, 6, 1], [0, 0, 16, 16], inst="rope"),
        cube([-3, 9, -3], [6, 1, 6], [0, 0, 16, 16], inst="rope"),
        cube([-2.5, 3.5, -2], [5, 5.5, 5], [0, 0, 16, 16], inst="skin"),
        cube([-4.5, 0, -2.5], [9, 3.5, 5], [0, 0, 16, 16], inst="cloth"),
    ])
    out["rift_hanged_lower"] = geo("geometry.observer.rift_hanged_lower", [
        cube([-4, 4, -2.5], [8, 12, 5], [0, 0, 16, 16], inst="cloth"),
        cube([-3, 0, -1.5], [2, 4, 3], [0, 0, 16, 16], inst="skin"),
        cube([1, 1, -1.5], [2, 3, 3], [0, 0, 16, 16], inst="skin"),
        cube([4, 6, -1], [1.5, 9, 2], [0, 0, 16, 16], inst="skin"),
    ])
    # blood: a skin of it on the ground
    out["rift_decal"] = geo("geometry.observer.rift_decal", [cube([-8, 0, -8], [16, 0.1, 16], [0, 0, 16, 16], faces=("up",))])
    for k, v in out.items():
        p = os.path.join(RP, "models", "blocks", f"{k}.geo.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(v, f, indent=1)


# ----------------------------------------------------------------------------- block definitions

def block(ident, components, extra=None, category="construction"):
    d = {"format_version": "1.26.0", "minecraft:block": {"description": {"identifier": ident, "menu_category": {"category": category}},
                                                          "components": components}}
    if extra:
        d["minecraft:block"]["description"].update(extra.get("description", {}))
        if "permutations" in extra:
            d["minecraft:block"]["permutations"] = extra["permutations"]
    return d


def solid(tex, seconds, resist, color, inst=None, light=None):
    c = {"minecraft:geometry": "minecraft:geometry.full_block",
         "minecraft:material_instances": inst or {"*": {"texture": tex, "render_method": "opaque"}},
         "minecraft:destructible_by_mining": {"seconds_to_destroy": seconds},
         "minecraft:destructible_by_explosion": {"explosion_resistance": resist},
         "minecraft:map_color": color}
    if light:
        c["minecraft:light_emission"] = light
    return c


CARDINAL = {"description": {"traits": {"minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"], "y_rotation_offset": 180}}},
            "permutations": [{"condition": f"q.block_state('minecraft:cardinal_direction') == '{d}'",
                              "components": {"minecraft:transformation": {"rotation": [0, r, 0]}}}
                             for d, r in (("north", 0), ("west", 90), ("south", 180), ("east", -90))]}


def blocks():
    defs = {}
    defs["rift_bark"] = block("observer:rift_bark", solid(None, 2.6, 3, "#2a2827", inst={
        "*": {"texture": "observer_rift_bark", "render_method": "opaque"},
        "up": {"texture": "observer_rift_bark_top", "render_method": "opaque"},
        "down": {"texture": "observer_rift_bark_top", "render_method": "opaque"}}), extra={
        "description": {"traits": {"minecraft:placement_position": {"enabled_states": ["minecraft:block_face"]}}},
        "permutations": [
            {"condition": "q.block_state('minecraft:block_face') == 'east' || q.block_state('minecraft:block_face') == 'west'",
             "components": {"minecraft:transformation": {"rotation": [0, 0, 90]}}},
            {"condition": "q.block_state('minecraft:block_face') == 'north' || q.block_state('minecraft:block_face') == 'south'",
             "components": {"minecraft:transformation": {"rotation": [90, 0, 0]}}}]}, category="nature")
    defs["rift_bark"]["minecraft:block"]["components"]["minecraft:flammable"] = {"catch_chance_modifier": 5, "destroy_chance_modifier": 5}
    defs["rift_needles"] = block("observer:rift_needles", {
        "minecraft:geometry": "minecraft:geometry.full_block",
        "minecraft:material_instances": {"*": {"texture": "observer_rift_needles", "render_method": "alpha_test"}},
        "minecraft:light_dampening": 1, "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.3},
        "minecraft:destructible_by_explosion": {"explosion_resistance": 0.2}, "minecraft:map_color": "#1e221e",
        "minecraft:flammable": {"catch_chance_modifier": 30, "destroy_chance_modifier": 60},
        "minecraft:loot": "loot_tables/rift/nothing.json"}, category="nature")
    defs["rift_moss"] = block("observer:rift_moss", solid(None, 0.7, 0.6, "#222820", inst={
        "*": {"texture": "observer_rift_moss_side", "render_method": "opaque"},
        "up": {"texture": "observer_rift_moss_top", "render_method": "opaque"},
        "down": {"texture": "observer_rift_soil", "render_method": "opaque"}}), category="nature")
    defs["rift_bricks"] = block("observer:rift_bricks", solid("observer_rift_bricks", 4.0, 12, "#333234"))
    defs["rift_bricks_cracked"] = block("observer:rift_bricks_cracked", solid("observer_rift_bricks_cracked", 4.0, 12, "#2e2d2f"))
    defs["rift_glass"] = block("observer:rift_glass", {
        "minecraft:geometry": "minecraft:geometry.full_block",
        "minecraft:material_instances": {"*": {"texture": "observer_rift_glass", "render_method": "blend"}},
        "minecraft:light_dampening": 0, "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.5},
        "minecraft:destructible_by_explosion": {"explosion_resistance": 0.3}, "minecraft:map_color": "#5a0a10",
        "minecraft:loot": "loot_tables/rift/nothing.json"})
    defs["rift_lamp"] = block("observer:rift_lamp", solid("observer_rift_lamp", 0.5, 0.3, "#a0141c", light=12))
    blood_perms = [{"condition": f"q.block_state('observer:splash') == {v}",
                    "components": {"minecraft:material_instances": {"*": {"texture": f"observer_blood_{v}", "render_method": "alpha_test"}}}}
                   for v in range(1, 4)]
    defs["blood"] = block("observer:blood", {
        "minecraft:geometry": "geometry.observer.rift_decal",
        "minecraft:material_instances": {"*": {"texture": "observer_blood_0", "render_method": "alpha_test"}},
        "minecraft:collision_box": False, "minecraft:selection_box": {"origin": [-8, 0, -8], "size": [16, 0.5, 16]},
        "minecraft:light_dampening": 0, "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.0},
        "minecraft:destructible_by_explosion": {"explosion_resistance": 0.0}, "minecraft:map_color": "#5a0a10",
        "minecraft:loot": "loot_tables/rift/nothing.json"},
        extra={"description": {"states": {"observer:splash": [0, 1, 2, 3]}}, "permutations": blood_perms}, category="nature")
    figure = lambda geom, inst, sel: {
        "minecraft:geometry": geom, "minecraft:material_instances": inst,
        "minecraft:collision_box": False, "minecraft:selection_box": sel, "minecraft:light_dampening": 0,
        "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.4}, "minecraft:destructible_by_explosion": {"explosion_resistance": 0.2},
        "minecraft:map_color": "#3a3028", "minecraft:loot": "loot_tables/rift/bones.json"}
    defs["corpse"] = block("observer:corpse", figure("geometry.observer.rift_corpse", {
        "*": {"texture": "observer_corpse_cloth", "render_method": "opaque"},
        "cloth": {"texture": "observer_corpse_cloth", "render_method": "opaque"},
        "skin": {"texture": "observer_corpse_skin", "render_method": "opaque"}},
        {"origin": [-6, 0, -8], "size": [12, 6, 16]}), extra=CARDINAL, category="nature")
    defs["skeleton"] = block("observer:skeleton", figure("geometry.observer.rift_skeleton", {
        "*": {"texture": "observer_skeleton_bone", "render_method": "opaque"},
        "bone": {"texture": "observer_skeleton_bone", "render_method": "opaque"},
        "skull": {"texture": "observer_skull_face", "render_method": "opaque"}},
        {"origin": [-6, 0, -8], "size": [12, 4, 16]}), extra=CARDINAL, category="nature")
    hanged = figure("geometry.observer.rift_hanged_lower", {
        "*": {"texture": "observer_corpse_cloth", "render_method": "opaque"},
        "cloth": {"texture": "observer_corpse_cloth", "render_method": "opaque"},
        "rope": {"texture": "observer_rift_bark", "render_method": "opaque"},
        "skin": {"texture": "observer_corpse_skin", "render_method": "opaque"}},
        {"origin": [-5, 0, -3], "size": [10, 16, 6]})
    hx = {"description": {"states": {"observer:part": [0, 1]}, **CARDINAL["description"]},
          "permutations": [{"condition": "q.block_state('observer:part') == 1",
                            "components": {"minecraft:geometry": "geometry.observer.rift_hanged_upper"}}] + CARDINAL["permutations"]}
    defs["hanged"] = block("observer:hanged", hanged, extra=hx, category="nature")
    gs = figure("geometry.observer.rift_gravestone", {"*": {"texture": "observer_gravestone", "render_method": "opaque"}},
                {"origin": [-6, 0, -3], "size": [12, 14, 6]})
    gs["minecraft:collision_box"] = {"origin": [-5, 0, -1.5], "size": [10, 14, 3]}
    gs["minecraft:loot"] = "loot_tables/rift/nothing.json"
    defs["gravestone"] = block("observer:gravestone", gs, extra=CARDINAL)
    for k, v in defs.items():
        p = os.path.join(BP, "blocks", "rift", f"{k}.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(v, f, indent=2)
            f.write("\n")
    # loot for what they drop: bones from the dead, nothing from blood, glass and needles
    lt = os.path.join(BP, "loot_tables", "rift")
    os.makedirs(lt, exist_ok=True)
    with open(os.path.join(lt, "nothing.json"), "w") as f:
        json.dump({"pools": []}, f, indent=2)
    with open(os.path.join(lt, "bones.json"), "w") as f:
        json.dump({"pools": [{"rolls": 1, "entries": [{"type": "item", "name": "minecraft:bone", "weight": 1,
                                                      "functions": [{"function": "set_count", "count": {"min": 1, "max": 3}}]}]}]}, f, indent=2)
    return defs


TEX = ["rift_bark", "rift_bark_top", "rift_needles", "rift_moss_top", "rift_moss_side", "rift_soil", "rift_bricks", "rift_bricks_cracked",
       "rift_glass", "rift_lamp", "blood_0", "blood_1", "blood_2", "blood_3", "corpse_cloth", "corpse_skin", "skeleton_bone", "skull_face", "gravestone"]
SOUNDS = {"rift_bark": "wood", "rift_needles": "grass", "rift_moss": "grass", "rift_bricks": "stone", "rift_bricks_cracked": "stone",
          "rift_glass": "glass", "rift_lamp": "glass", "blood": "slime", "corpse": "cloth", "hanged": "cloth", "skeleton": "bone_block", "gravestone": "stone"}
NAMES = {"rift_bark": "Rift Bark", "rift_needles": "Dead Needles", "rift_moss": "Rift Moss", "rift_bricks": "Rift Bricks",
         "rift_bricks_cracked": "Cracked Rift Bricks", "rift_glass": "Crimson Glass", "rift_lamp": "Crimson Lamp", "blood": "Blood",
         "corpse": "Corpse", "hanged": "Hanged Body", "skeleton": "Skeleton", "gravestone": "Gravestone"}


def register():
    p = os.path.join(RP, "textures", "terrain_texture.json")
    tt = json.load(open(p))
    for t in TEX:
        tt["texture_data"][f"observer_{t}"] = {"textures": f"textures/blocks/rift/{t}"}
    with open(p, "w") as f:
        json.dump(tt, f, indent=2)
        f.write("\n")
    p = os.path.join(RP, "blocks.json")
    bj = json.load(open(p))
    for k, s in SOUNDS.items():
        bj[f"observer:{k}"] = {"sound": s}
    with open(p, "w") as f:
        json.dump(bj, f, indent=2)
        f.write("\n")
    p = os.path.join(RP, "texts", "en_US.lang")
    text = open(p, encoding="utf-8").read()
    text = "\n".join(l for l in text.split("\n") if not any(l.startswith(f"tile.observer:{k}.name=") for k in NAMES))
    marker = "## ---- merged: "
    block_lines = "".join(f"tile.observer:{k}.name={v}\n" for k, v in NAMES.items())
    i = text.find(marker)
    text = (text[:i].rstrip("\n") + "\n" + block_lines + "\n" + text[i:]) if i >= 0 else text.rstrip("\n") + "\n" + block_lines
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)


def main():
    bark()
    needles()
    moss()
    bricks(0)
    bricks(1)
    glass()
    lamp()
    blood()
    cloth()
    skin()
    bone()
    gravestone()
    models()
    blocks()
    register()
    print("rift assets written")


if __name__ == "__main__":
    main()
