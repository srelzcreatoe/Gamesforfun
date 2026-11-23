#!/usr/bin/env python3
"""The people of his cities: an original townsperson, for him to frighten.

A plain humanoid (head, body, arms, legs, and an outer layer for hair and caps) on the usual 64 x 64 skin layout,
painted here in a dozen outfits: office clothes, hoodies, overalls, sundresses, uniforms; a spread of skin and hair.
They walk the streets, look at whoever passes, and when a giant comes into sight they throw their arms up and run
(src/civilians.ts decides who has seen what; the behaviour pack only has to know how to flee).

Writes: the behaviour-pack entity, the client entity, its geometry, textures, animations, render controller, the
names, the spawn egg, and the sounds the game already has for a person being hurt.

    python3 tools/kit/gen_civilian.py
"""
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
BP, RP = os.path.join(ROOT, "packs", "BP"), os.path.join(ROOT, "packs", "RP")
NS, NAME = "basiliskra", "civilian"
ID = f"{NS}:{NAME}"

# ---- the skin layout: where each face of each part is (u, v, w, h) --------------------------------------------------
def faces(u, v, w, h, d):
    return {"top": (u + d, v, w, d), "bottom": (u + d + w, v, w, d), "right": (u, v + d, d, h), "front": (u + d, v + d, w, h),
            "left": (u + d + w, v + d, d, h), "back": (u + 2 * d + w, v + d, w, h)}

PARTS = {
    "head": faces(0, 0, 8, 8, 8), "hat": faces(32, 0, 8, 8, 8), "body": faces(16, 16, 8, 12, 4),
    "arm_r": faces(40, 16, 4, 12, 4), "arm_l": faces(32, 48, 4, 12, 4), "leg_r": faces(0, 16, 4, 12, 4), "leg_l": faces(16, 48, 4, 12, 4),
}

SKIN = [(244, 208, 177), (233, 186, 148), (210, 160, 120), (176, 122, 84), (139, 92, 60), (98, 62, 40)]
HAIR = [(38, 28, 22), (74, 48, 30), (122, 82, 44), (196, 152, 86), (230, 206, 150), (150, 46, 30), (60, 60, 64), (210, 210, 214)]
# (shirt, sleeve: "short"/"long", trousers, shoes, hair style, extra)
OUTFITS = [
    dict(shirt=(46, 82, 150), sleeve="long", legs=(40, 40, 48), shoes=(20, 20, 22), hair="short", tie=(160, 30, 36)),      # office, blue shirt and tie
    dict(shirt=(200, 60, 60), sleeve="long", legs=(58, 80, 120), shoes=(230, 230, 230), hair="short", hood=True),          # red hoodie, jeans
    dict(shirt=(240, 200, 60), sleeve="short", legs=(240, 200, 60), shoes=(140, 90, 60), hair="long", dress=True),         # yellow sundress
    dict(shirt=(70, 120, 70), sleeve="short", legs=(150, 130, 100), shoes=(90, 64, 40), hair="cap", cap=(40, 60, 140)),   # green tee, khakis, cap
    dict(shirt=(30, 34, 46), sleeve="long", legs=(30, 34, 46), shoes=(14, 14, 16), hair="bun", collar=(230, 230, 230)),    # dark suit
    dict(shirt=(230, 120, 40), sleeve="long", legs=(60, 70, 90), shoes=(40, 40, 40), hair="short", vest=(240, 220, 40)),   # hi-vis worker
    dict(shirt=(150, 80, 170), sleeve="short", legs=(40, 40, 48), shoes=(220, 220, 225), hair="long"),                     # purple tee
    dict(shirt=(240, 240, 240), sleeve="long", legs=(240, 240, 240), shoes=(200, 200, 205), hair="bun", coat=True),        # white coat (a doctor)
    dict(shirt=(60, 150, 170), sleeve="short", legs=(230, 150, 80), shoes=(250, 250, 250), hair="short"),                  # teal tee, orange shorts
    dict(shirt=(110, 70, 40), sleeve="long", legs=(58, 80, 120), shoes=(90, 60, 40), hair="cap", cap=(170, 40, 40)),      # brown jacket, red cap
    dict(shirt=(35, 45, 90), sleeve="long", legs=(35, 45, 90), shoes=(14, 14, 16), hair="cap", cap=(35, 45, 90), badge=(230, 200, 60)),  # police
    dict(shirt=(220, 100, 150), sleeve="short", legs=(70, 70, 80), shoes=(240, 240, 240), hair="long"),                    # pink tee
]
VARIANTS = len(OUTFITS)


def paint(k: int) -> np.ndarray:
    o = OUTFITS[k]
    rng = np.random.default_rng(700 + k)
    skin = np.array(SKIN[(k * 5 + 1) % len(SKIN)], float)
    hair = np.array(HAIR[(k * 3 + 2) % len(HAIR)], float)
    img = np.zeros((64, 64, 4), float)

    def rect(r, col, rows=None, alpha=255, jitter=7):
        u, v, w, h = r
        y0, y1 = (v, v + h) if rows is None else (v + rows[0], v + rows[1])
        if y1 <= y0:
            return
        c = np.array(col, float)[None, None, :] + rng.normal(0, jitter, (y1 - y0, w, 1))
        img[y0:y1, u:u + w, :3] = np.clip(c, 0, 255)
        img[y0:y1, u:u + w, 3] = alpha

    def px(x, y, col, a=255):
        img[y, x, :3] = col
        img[y, x, 3] = a

    # head: skin all round, hair over the top, the back and the tops of the sides
    for f, r in PARTS["head"].items():
        rect(r, skin, jitter=4)
    rect(PARTS["head"]["top"], hair)
    long_hair = o["hair"] == "long"
    for f in ("back", "left", "right"):
        rect(PARTS["head"][f], hair, (0, 8 if (long_hair or f == "back") else 3))
    rect(PARTS["head"]["front"], hair, (0, 2))
    u, v, w, h = PARTS["head"]["front"]
    # eyes, brows and a mouth
    for ex in (u + 1, u + 5):
        px(ex, v + 4, (250, 250, 250)); px(ex + 1, v + 4, (40, 50, 70))
        px(ex, v + 3, hair * 0.8); px(ex + 1, v + 3, hair * 0.8)
    for mx in range(u + 3, u + 5):
        px(mx, v + 6, skin * 0.68)
    px(u + 3, v + 5, skin * 0.85); px(u + 4, v + 5, skin * 0.85)
    if long_hair:
        rect((u, v, 1, 7), hair); rect((u + 7, v, 1, 7), hair)
    # the outer layer: a cap, a bun, or long hair falling over the shoulders
    if o["hair"] == "cap":
        cap = o["cap"]
        for f in ("top", "front", "left", "right", "back"):
            rect(PARTS["hat"][f], cap, (0, 3) if f != "top" else None)
        hu, hv, hw, hh = PARTS["hat"]["front"]
        rect((hu, hv + 2, hw, 1), np.array(cap) * 0.7)
    elif o["hair"] == "bun":
        rect(PARTS["hat"]["top"], hair)
        hu, hv, hw, hh = PARTS["hat"]["back"]
        rect((hu + 3, hv, 2, 3), hair * 0.85)
    elif long_hair:
        rect(PARTS["hat"]["back"], hair, (0, 8))

    shirt, legs, shoes = np.array(o["shirt"], float), np.array(o["legs"], float), np.array(o["shoes"], float)
    # body
    for f, r in PARTS["body"].items():
        rect(r, shirt)
    bu, bv, bw, bh = PARTS["body"]["front"]
    if o.get("tie"):
        rect((bu + 3, bv, 2, 8), o["tie"]); rect((bu + 2, bv, 4, 1), (240, 240, 240))
    if o.get("collar"):
        rect((bu + 2, bv, 1, 3), o["collar"]); rect((bu + 5, bv, 1, 3), o["collar"]); rect((bu + 3, bv, 2, 6), (150, 30, 40))
    if o.get("hood"):
        rect((bu + 1, bv, 6, 1), shirt * 0.75); rect((bu + 2, bv + 7, 4, 3), shirt * 0.8)                   # the hood's edge, a pocket
    if o.get("vest"):
        for f in ("front", "back"):
            uu, vv, ww, hh = PARTS["body"][f]
            rect((uu, vv, ww, 9), o["vest"]); rect((uu, vv + 6, ww, 1), (210, 210, 210))
    if o.get("coat"):
        rect((bu + 3, bv, 2, 12), (210, 210, 214)); rect((bu + 1, bv + 2, 1, 1), (60, 120, 200))
    if o.get("badge"):
        px(bu + 5, bv + 2, o["badge"]); px(bu + 6, bv + 2, o["badge"]); rect((bu, bv + 10, bw, 1), (20, 20, 22))
    if o.get("dress"):
        for f in ("front", "back", "left", "right"):
            uu, vv, ww, hh = PARTS["body"][f]
            rect((uu, vv + 8, ww, 1), shirt * 0.8)
    else:
        for f in ("front", "back", "left", "right"):                                                      # a belt
            uu, vv, ww, hh = PARTS["body"][f]
            rect((uu, vv + 10, ww, 2), legs)
            rect((uu, vv + 10, ww, 1), np.array((40, 32, 26)) if not o.get("badge") else (20, 20, 22))
    # arms: sleeves, then the hands
    for side in ("arm_r", "arm_l"):
        for f, r in PARTS[side].items():
            rect(r, skin, jitter=4)
            if f == "bottom":
                continue
            sleeve_rows = 12 if o["sleeve"] == "long" else 4
            if f == "top":
                rect(r, shirt)
            else:
                rect(r, shirt, (0, min(sleeve_rows, 10)))
    # legs: trousers (or the dress, or bare below shorts), shoes
    for side in ("leg_r", "leg_l"):
        for f, r in PARTS[side].items():
            if f in ("top",):
                rect(r, legs)
                continue
            if f == "bottom":
                rect(r, shoes)
                continue
            if o.get("dress"):
                rect(r, skin, jitter=4); rect(r, shirt, (0, 5))
            elif o["shirt"] == (60, 150, 170):                                                            # (shorts)
                rect(r, skin, jitter=4); rect(r, legs, (0, 5))
            else:
                rect(r, legs)
            rect(r, shoes, (10, 12))
    return np.clip(img, 0, 255).round().astype(np.uint8)


def geometry():
    def cube(origin, size, uv, inflate=0):
        c = {"origin": origin, "size": size, "uv": uv}
        if inflate:
            c["inflate"] = inflate
        return c
    bones = [
        {"name": "root", "pivot": [0, 0, 0]},
        {"name": "body", "parent": "root", "pivot": [0, 24, 0], "cubes": [cube([-4, 12, -2], [8, 12, 4], [16, 16])]},
        {"name": "head", "parent": "body", "pivot": [0, 24, 0], "cubes": [cube([-4, 24, -4], [8, 8, 8], [0, 0])]},
        {"name": "hat", "parent": "head", "pivot": [0, 24, 0], "cubes": [cube([-4, 24, -4], [8, 8, 8], [32, 0], 0.5)]},
        {"name": "arm_r", "parent": "body", "pivot": [-5, 22, 0], "cubes": [cube([-8, 12, -2], [4, 12, 4], [40, 16])]},
        {"name": "arm_l", "parent": "body", "pivot": [5, 22, 0], "cubes": [cube([4, 12, -2], [4, 12, 4], [32, 48])]},
        {"name": "leg_r", "parent": "root", "pivot": [-1.9, 12, 0], "cubes": [cube([-3.9, 0, -2], [4, 12, 4], [0, 16])]},
        {"name": "leg_l", "parent": "root", "pivot": [1.9, 12, 0], "cubes": [cube([-0.1, 0, -2], [4, 12, 4], [16, 48])]},
    ]
    return {"format_version": "1.16.0", "minecraft:geometry": [{
        "description": {"identifier": f"geometry.{NS}.{NAME}", "texture_width": 64, "texture_height": 64,
                        "visible_bounds_width": 2, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1.5, 0]},
        "bones": bones}]}


# ---- how they move: walking, looking about, and running with their arms up -----------------------------------------
SWING = "math.cos(q.modified_distance_moved * 38.17)"
ANIMS = {
    f"animation.{NS}.{NAME}.move": {"loop": True, "bones": {
        "leg_r": {"rotation": [f"{SWING} * 70 * q.modified_move_speed", 0, 0]},
        "leg_l": {"rotation": [f"-{SWING} * 70 * q.modified_move_speed", 0, 0]},
        "arm_r": {"rotation": [f"-{SWING} * 50 * q.modified_move_speed * (1 - v.fright)", 0, 0]},
        "arm_l": {"rotation": [f"{SWING} * 50 * q.modified_move_speed * (1 - v.fright)", 0, 0]}}},
    f"animation.{NS}.{NAME}.look": {"loop": True, "bones": {
        "head": {"rotation": ["q.target_x_rotation * (1 - v.fright)", "q.target_y_rotation * (1 - v.fright)", 0]}}},
    f"animation.{NS}.{NAME}.idle": {"loop": True, "bones": {
        "arm_r": {"rotation": [0, 0, "2.5 + math.sin(q.life_time * 70) * 2.5"]},
        "arm_l": {"rotation": [0, 0, "-2.5 - math.sin(q.life_time * 70) * 2.5"]}}},
    # frightened: both arms thrown up and flailing, the head turning back over the shoulder, a stumble in the body
    f"animation.{NS}.{NAME}.panic": {"loop": True, "bones": {
        "arm_r": {"rotation": ["v.fright * (-155 + math.sin(q.life_time * 900) * 25)", 0, "v.fright * (12 + math.sin(q.life_time * 700) * 10)"]},
        "arm_l": {"rotation": ["v.fright * (-155 - math.sin(q.life_time * 900) * 25)", 0, "v.fright * (-12 - math.sin(q.life_time * 700) * 10)"]},
        "head": {"rotation": ["v.fright * -10", "v.fright * math.sin(q.life_time * 220) * 40", 0]},
        "body": {"rotation": ["v.fright * 8", 0, "v.fright * math.sin(q.life_time * 450) * 4"]}}},
}


def main():
    def write(path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")

    tex_dir = os.path.join(RP, "textures", "entity", NS, NAME)
    os.makedirs(tex_dir, exist_ok=True)
    for k in range(VARIANTS):
        Image.fromarray(paint(k), "RGBA").save(os.path.join(tex_dir, f"{NAME}_{k}.png"))
    write(os.path.join(RP, "models", "entity", f"{NS}_{NAME}.geo.json"), geometry())
    write(os.path.join(RP, "animations", f"{NS}_{NAME}.animation.json"), {"format_version": "1.8.0", "animations": ANIMS})
    write(os.path.join(RP, "render_controllers", f"{NS}_{NAME}.render_controllers.json"), {"format_version": "1.10.0", "render_controllers": {
        f"controller.render.{NS}.{NAME}": {
            "arrays": {"textures": {"Array.skins": [f"Texture.v{k}" for k in range(VARIANTS)]}},
            "geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Array.skins[q.variant]"]}}})
    write(os.path.join(RP, "entity", f"{NS}_{NAME}.entity.json"), {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": ID,
        "materials": {"default": "entity_alphatest"},
        "textures": {f"v{k}": f"textures/entity/{NS}/{NAME}/{NAME}_{k}" for k in range(VARIANTS)},
        "geometry": {"default": f"geometry.{NS}.{NAME}"},
        "scripts": {
            "initialize": ["v.fright = 0;"],
            "pre_animation": [f"v.fright = math.lerp(v.fright, q.property('{NS}:scared') ? 1 : 0, math.min(1, q.delta_time * 8));"],
            "animate": ["move", "look", {"idle": "v.fright < 0.5"}, {"panic": "v.fright > 0.01"}]},
        "animations": {"move": f"animation.{NS}.{NAME}.move", "look": f"animation.{NS}.{NAME}.look", "idle": f"animation.{NS}.{NAME}.idle",
                       "panic": f"animation.{NS}.{NAME}.panic"},
        "render_controllers": [f"controller.render.{NS}.{NAME}"],
        "spawn_egg": {"base_color": "#3a6ea5", "overlay_color": "#f4d0b1"}}}})

    # ---- behaviour ---------------------------------------------------------------------------------------------
    giants = [{"test": "is_family", "subject": "other", "value": NS}, {"test": "is_family", "subject": "other", "value": f"{NS}_titan"}]
    groups = {f"{NS}:v{k}": {"minecraft:variant": {"value": k}} for k in range(VARIANTS)}
    groups[f"{NS}:calm"] = {
        "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.8, "interval": 60, "xz_dist": 12},
        "minecraft:behavior.look_at_player": {"priority": 7, "look_distance": 8, "probability": 0.04},
        "minecraft:behavior.random_look_around": {"priority": 8},
    }
    groups[f"{NS}:frightened"] = {
        # away from whatever giant is near, at a run; with nothing to run from, anywhere at all
        "minecraft:behavior.avoid_mob_type": {"priority": 1, "entity_types": [{"filters": {"any_of": giants}, "max_dist": 96, "walk_speed_multiplier": 1.7,
                                                                                "sprint_speed_multiplier": 2.1}], "probability_per_strength": 1.0},
        "minecraft:behavior.panic": {"priority": 2, "speed_multiplier": 1.8, "force": True},
    }
    write(os.path.join(BP, "entities", f"{NS}_{NAME}.json"), {"format_version": "1.26.60", "minecraft:entity": {
        "description": {"identifier": ID, "is_spawnable": True, "is_summonable": True,
                        "properties": {f"{NS}:scared": {"type": "bool", "default": False, "client_sync": True}}},
        "component_groups": groups,
        "components": {
            "minecraft:type_family": {"family": [f"{NS}_{NAME}", "mob"]},
            "minecraft:health": {"value": 20, "max": 20},
            "minecraft:collision_box": {"width": 0.6, "height": 1.8},
            "minecraft:physics": {}, "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
            "minecraft:movement": {"value": 0.25}, "minecraft:movement.basic": {}, "minecraft:jump.static": {},
            "minecraft:navigation.walk": {"avoid_water": True, "can_open_doors": True, "can_pass_doors": True, "can_path_over_water": False},
            "minecraft:annotation.open_door": {},
            "minecraft:behavior.float": {"priority": 0},
            "minecraft:behavior.panic": {"priority": 3, "speed_multiplier": 1.4},
            "minecraft:persistent": {},
            "minecraft:nameable": {},
            "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0},
            "minecraft:can_climb": {},
        },
        "events": {
            "minecraft:entity_spawned": {"sequence": [
                {"randomize": [{"weight": 1, "add": {"component_groups": [f"{NS}:v{k}"]}} for k in range(VARIANTS)]},
                {"add": {"component_groups": [f"{NS}:calm"]}}]},
            f"{NS}:panic": {"remove": {"component_groups": [f"{NS}:calm"]}, "add": {"component_groups": [f"{NS}:frightened"]}},
            f"{NS}:calm": {"remove": {"component_groups": [f"{NS}:frightened"]}, "add": {"component_groups": [f"{NS}:calm"]}},
        }}})

    # the game's own sounds for a person hurt and killed
    sp = os.path.join(RP, "sounds.json")
    s = json.load(open(sp)) if os.path.exists(sp) else {}
    s.setdefault("entity_sounds", {}).setdefault("entities", {})[ID] = {"volume": 1.0, "pitch": [0.9, 1.1], "events": {"hurt": "game.player.hurt", "death": "game.player.die"}}
    write(sp, s)
    for pack in (BP, RP):
        p = os.path.join(pack, "texts", "en_US.lang")
        text = open(p).read().rstrip("\n") + "\n"
        for key, val in ((f"entity.{ID}.name", "Civilian"), (f"item.spawn_egg.entity.{ID}.name", "Spawn Civilian")):
            if f"{key}=" not in text:
                text += f"{key}={val}\n"
        open(p, "w").write(text)
    sheet = Image.new("RGBA", (64 * 6, 64 * 2))
    for k in range(VARIANTS):
        sheet.paste(Image.fromarray(paint(k), "RGBA"), ((k % 6) * 64, (k // 6) * 64))
    if os.path.isdir(os.path.join(ROOT, "build")):
        sheet.resize((64 * 6 * 3, 64 * 2 * 3), Image.NEAREST).save(os.path.join(ROOT, "build", "civilian_skins.png"))
    print(f"civilians: {VARIANTS} outfits, entity, client entity, geometry, animations, render controller, spawn egg")


if __name__ == "__main__":
    main()
