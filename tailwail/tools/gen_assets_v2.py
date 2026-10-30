#!/usr/bin/env python3
"""Generates the v2 support assets (deterministic, re-runnable):

  BP blocks/snuffed_torch.json            the burnt-out torch block (+ relight custom component)
  BP loot_tables/blocks/*.json            breaking it gives the torch back
  RP models/blocks/tailwail_snuffed_torch.geo.json   standing + wall stick
  RP textures/blocks/tailwail_snuffed_torch.png      16x16 charred stick
  RP textures/terrain_texture.json, blocks.json
  RP fogs/tailwail_dread.json             the encounter fog (pushed per player by script)
  RP particles/snuff_smoke.json           the wisp when a torch goes out
  RP textures/item_texture.json           (array form)
  RP render_controllers/*.json            (uv_anim made explicit)
"""
import json
import os
import sys

from PIL import Image

ROOT = os.environ.get("TAILWAIL_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "packs", "TailwailRP")
BP = os.path.join(ROOT, "packs", "TailwailBP")

BLOCK_ID = "tailwail:snuffed_torch"
FACINGS = ["top", "north", "south", "east", "west"]
KINDS = ["minecraft:torch", "minecraft:soul_torch", "minecraft:copper_torch"]
# the wall model leans north (top toward -z, base against a wall to the south)
WALL_ROT = {"north": 0, "west": 90, "south": 180, "east": -90}


def write(path, data, raw=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        if raw:
            fh.write(data)
        else:
            json.dump(data, fh, indent=2)
            fh.write("\n")


def stick_uv():
    side = {"uv": [7, 6], "uv_size": [2, 10]}
    return {"north": side, "south": side, "east": side, "west": side,
            "up": {"uv": [7, 6], "uv_size": [2, 2]}, "down": {"uv": [7, 14], "uv_size": [2, 2]}}


def geometry():
    common = {"texture_width": 16, "texture_height": 16, "visible_bounds_width": 2, "visible_bounds_height": 2,
              "visible_bounds_offset": [0, 0.5, 0]}
    standing = {"description": {"identifier": "geometry.tailwail_snuffed_torch", **common},
                "bones": [{"name": "stick", "pivot": [0, 0, 0],
                           "cubes": [{"origin": [-1, 0, -1], "size": [2, 10, 2], "uv": stick_uv()}]}]}
    wall = {"description": {"identifier": "geometry.tailwail_snuffed_torch_wall", **common},
            "bones": [{"name": "stick", "pivot": [0, 3.5, 7], "rotation": [22.5, 0, 0],
                       "cubes": [{"origin": [-1, 3.5, 6], "size": [2, 10, 2], "uv": stick_uv()}]}]}
    return {"format_version": "1.12.0", "minecraft:geometry": [standing, wall]}


def texture(path):
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    wood = [(58, 40, 24), (49, 33, 20), (42, 28, 17), (54, 37, 22)]
    for y in range(6, 16):
        for x in (7, 8):
            c = wood[(x * 3 + y * 5) % len(wood)]
            # charring creeps down from the tip
            k = max(0.0, 1.0 - (y - 6) / 5.0)
            c = tuple(int(v * (1 - 0.75 * k) + 8 * k) for v in c)
            px[x, y] = c + (255,)
    # ash crust and one dying ember
    px[7, 6] = (92, 88, 84, 255)
    px[8, 6] = (70, 66, 63, 255)
    px[7, 7] = (36, 30, 28, 255)
    px[8, 7] = (122, 34, 18, 255)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


def block():
    perms = []
    for f, rot in WALL_ROT.items():
        perms.append({"condition": "q.block_state('tailwail:facing') == '%s'" % f, "components": {
            "minecraft:geometry": "geometry.tailwail_snuffed_torch_wall",
            "minecraft:transformation": {"rotation": [0, rot, 0]},
            "minecraft:selection_box": {"origin": [-2, 3, 2], "size": [4, 10, 6]},
        }})
    for k, item in enumerate(KINDS):
        if k == 0:
            continue
        perms.append({"condition": "q.block_state('tailwail:kind') == %d" % k,
                      "components": {"minecraft:loot": "loot_tables/blocks/tailwail_snuffed_%s.json" % item.split(":")[1]}})
    return {"format_version": "1.21.90", "minecraft:block": {
        "description": {
            "identifier": BLOCK_ID,
            "menu_category": {"category": "none", "is_hidden_in_commands": False},
            "states": {"tailwail:facing": FACINGS, "tailwail:kind": [0, 1, 2]},
        },
        "components": {
            "minecraft:geometry": "geometry.tailwail_snuffed_torch",
            "minecraft:material_instances": {"*": {"texture": "tailwail_snuffed_torch", "render_method": "alpha_test",
                                                   "ambient_occlusion": False, "face_dimming": False}},
            "minecraft:collision_box": False,
            "minecraft:selection_box": {"origin": [-2, 0, -2], "size": [4, 10, 4]},
            "minecraft:light_dampening": 0,
            "minecraft:destructible_by_mining": {"seconds_to_destroy": 0},
            "minecraft:destructible_by_explosion": {"explosion_resistance": 0},
            "minecraft:loot": "loot_tables/blocks/tailwail_snuffed_torch.json",
            "minecraft:display_name": "tile.tailwail:snuffed_torch.name",
            "tailwail:relight": {},
        },
        "permutations": perms,
    }}


def loot(item):
    return {"pools": [{"rolls": 1, "entries": [{"type": "item", "name": item, "weight": 1}]}]}


def fog():
    air = {"fog_start": 3.0, "fog_end": 26.0, "fog_color": "#060508", "render_distance_type": "fixed"}
    return {"format_version": "1.16.100", "minecraft:fog_settings": {
        "description": {"identifier": "tailwail:dread"},
        "distance": {
            "air": air,
            "weather": dict(air),
            "water": {"fog_start": 0.0, "fog_end": 9.0, "fog_color": "#05060a", "render_distance_type": "fixed"},
            "lava": {"fog_start": 0.0, "fog_end": 0.64, "fog_color": "#991a00", "render_distance_type": "fixed"},
        },
    }}


def particle():
    return {"format_version": "1.10.0", "particle_effect": {
        "description": {"identifier": "tailwail:snuff_smoke",
                        "basic_render_parameters": {"material": "particles_alpha", "texture": "textures/particle/particles"}},
        "components": {
            "minecraft:emitter_rate_instant": {"num_particles": 7},
            "minecraft:emitter_lifetime_once": {"active_time": 0.1},
            "minecraft:emitter_shape_sphere": {"radius": 0.05, "direction": [0, 1, 0]},
            "minecraft:particle_initial_speed": 0.25,
            "minecraft:particle_lifetime_expression": {"max_lifetime": "1.4 + variable.particle_random_1 * 1.0"},
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.3, 0], "linear_drag_coefficient": 1.5},
            "minecraft:particle_appearance_billboard": {
                "size": ["0.05 + variable.particle_age * 0.05", "0.05 + variable.particle_age * 0.05"],
                "facing_camera_mode": "lookat_xyz",
                "uv": {"texture_width": 128, "texture_height": 128, "flipbook": {
                    "base_UV": [56, 0], "size_UV": [8, 8], "step_UV": [-8, 0], "frames_per_second": 6, "max_frame": 8,
                    "stretch_to_lifetime": True, "loop": False}}},
            "minecraft:particle_appearance_tinting": {"color": [0.22, 0.21, 0.2, "0.85 - variable.particle_age / variable.particle_lifetime * 0.85"]},
        },
    }}


def patch_item_textures():
    p = os.path.join(RP, "textures", "item_texture.json")
    d = json.load(open(p))
    for k, v in d["texture_data"].items():
        if isinstance(v.get("textures"), str):
            v["textures"] = [v["textures"]]
    write(p, d)


def patch_render_controllers():
    p = os.path.join(RP, "render_controllers", "tall_wail.render_controllers.json")
    d = json.load(open(p))
    for rc in d["render_controllers"].values():
        rc.setdefault("uv_anim", {"offset": [0.0, 0.0], "scale": [1.0, 1.0]})
    write(p, d)


VERSION = (3, 0, 0)
VS = "%d.%d.%d" % VERSION
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_client_v3 import RP_CHECK  # noqa: E402

RP_LANG_STATIC = [
    "pack.name=TAILWAIL %s (Resources)" % VS,
    "pack.description=Tailwail %s: models, animations and sounds. Must be the same version as TAILWAIL %s (Behavior)." % (VS, VS),
    # the behavior pack prints this key on join: raw text = this resource pack is missing or out of date
    "%s=§aResource pack %s active: animations and sounds loaded." % (RP_CHECK, VS),
    "entity.tailwail:tall_wail.name=Tailwail",
    "entity.tailwail:echo.name=...",
    "entity.tailwail:lure.name=Tailwail Trail",
    "item.spawn_egg.entity.tailwail:tall_wail.name=Tailwail Spawn Egg",
    "item.tailwail:field_guide.name=Torn Journal",
    "item.tailwail.field_guide.name=Torn Journal",
    "tile.tailwail:snuffed_torch.name=Burnt-out Torch",
]
BP_LANG = [
    "pack.name=TAILWAIL %s (Behavior)" % VS,
    "pack.description=Tailwail %s: the dweller that hunts. No experiments required. Apply TAILWAIL %s (Resources) too." % (VS, VS),
]


def write_lang():
    subs = {}
    sp = os.path.join(ROOT, "docs", "generated", "subtitles.json")
    if os.path.exists(sp):
        subs = json.load(open(sp))
    lines = RP_LANG_STATIC + ["%s=%s" % (k, v) for k, v in sorted(subs.items())]
    write(os.path.join(RP, "texts", "en_US.lang"), "\n".join(lines) + "\n", raw=True)
    write(os.path.join(BP, "texts", "en_US.lang"), "\n".join(BP_LANG) + "\n", raw=True)


def patch_manifests():
    for pack in (RP, BP):
        p = os.path.join(pack, "manifest.json")
        d = json.load(open(p))
        d["header"]["version"] = list(VERSION)
        for m in d["modules"]:
            m["version"] = list(VERSION)
        for dep in d.get("dependencies", []):
            if "uuid" in dep:
                dep["version"] = list(VERSION)
        d["metadata"]["authors"] = ["Tailwail"]
        write(p, d)


def main():
    write(os.path.join(BP, "blocks", "snuffed_torch.json"), block())
    write(os.path.join(BP, "loot_tables", "blocks", "tailwail_snuffed_torch.json"), loot(KINDS[0]))
    for item in KINDS[1:]:
        write(os.path.join(BP, "loot_tables", "blocks", "tailwail_snuffed_%s.json" % item.split(":")[1]), loot(item))
    write(os.path.join(RP, "models", "blocks", "tailwail_snuffed_torch.geo.json"), geometry())
    texture(os.path.join(RP, "textures", "blocks", "tailwail_snuffed_torch.png"))
    write(os.path.join(RP, "textures", "terrain_texture.json"), {
        "resource_pack_name": "tailwail", "texture_name": "atlas.terrain", "padding": 8, "num_mip_levels": 4,
        "texture_data": {"tailwail_snuffed_torch": {"textures": ["textures/blocks/tailwail_snuffed_torch"]}}})
    write(os.path.join(RP, "blocks.json"), {"format_version": [1, 1, 0], BLOCK_ID: {"sound": "wood"}})
    write(os.path.join(RP, "fogs", "tailwail_dread.json"), fog())
    write(os.path.join(RP, "particles", "snuff_smoke.json"), particle())
    patch_item_textures()
    patch_render_controllers()
    write_lang()
    patch_manifests()
    print("assets written (v%s)" % VS)


if __name__ == "__main__":
    main()
