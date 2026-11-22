#!/usr/bin/env python3
"""
The invisible hit volumes: one entity type per size (basiliskra:hitbox_0 .. _9), each with a fixed
collision box.  (They used to be one type resized by component groups; a box whose size never changes
cannot be out of step between the server and a client.)  Writes the behaviour-pack entities and their
client entities; the sizes are the SIZES table in src/creature.ts.
"""
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
NS = "basiliskra"
SIZES = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 9.0, 11.0, 13.0]
# positions matter here (a hit volume that lags is a hit that misses): never dropped for bandwidth
BANDWIDTH = {"default_values": {"max_optimized_distance": 0.0, "max_dropped_ticks": 0, "use_motion_prediction_hints": False}}
NO = [{"cause": c, "deals_damage": "no"} for c in (
    "fall", "suffocation", "drowning", "lava", "fire", "fire_tick", "freezing", "contact", "magma", "stalactite",
    "stalagmite", "fly_into_wall", "campfire", "soul_campfire", "lightning", "void")]


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


def main():
    bp, rp = os.path.join(ROOT, "packs", "BP", "entities"), os.path.join(ROOT, "packs", "RP", "entity")
    for d in (bp, rp):
        for fn in os.listdir(d):
            if fn.startswith(f"{NS}_hitbox"):
                os.remove(os.path.join(d, fn))
    for i, size in enumerate(SIZES):
        ident = f"{NS}:hitbox_{i}"
        write(os.path.join(bp, f"{NS}_hitbox_{i}.json"), {
            "format_version": "1.26.60",
            "minecraft:entity": {
                "description": {"identifier": ident, "is_spawnable": False, "is_summonable": True, "spawn_category": "misc"},
                "component_groups": {
                    # it lives twenty seconds unless the script that owns it says "keep" (so none outlives him)
                    f"{NS}:life": {"minecraft:timer": {"looping": False, "time": {"min": 20, "max": 20}, "randomInterval": False,
                                                       "time_down_event": {"event": f"{NS}:expire", "target": "self"}}},
                    f"{NS}:gone": {"minecraft:instant_despawn": {}},
                },
                "components": {
                    "minecraft:type_family": {"family": [f"{NS}_part", "inanimate"]},
                    "minecraft:collision_box": {"width": size, "height": size},
                    "minecraft:health": {"value": 1000, "max": 1000},
                    "minecraft:physics": {"has_gravity": False, "has_collision": False},
                    "minecraft:transient": {},
                    "minecraft:fire_immune": {},
                    "minecraft:dimension_bound": {},
                    "minecraft:knockback_resistance": {"value": 1.0},
                    "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0, "breathes_air": True, "breathes_water": True,
                                             "generates_bubbles": False},
                    "minecraft:damage_sensor": {"triggers": NO},
                    "minecraft:conditional_bandwidth_optimization": BANDWIDTH,
                },
                "events": {
                    "minecraft:entity_spawned": {"add": {"component_groups": [f"{NS}:life"]}},
                    f"{NS}:keep": {"sequence": [{"remove": {"component_groups": [f"{NS}:life"]}}, {"add": {"component_groups": [f"{NS}:life"]}}]},
                    f"{NS}:expire": {"add": {"component_groups": [f"{NS}:gone"]}},
                },
            }})
        write(os.path.join(rp, f"{NS}_hitbox_{i}.entity.json"), {
            "format_version": "1.10.0",
            "minecraft:client_entity": {"description": {
                "identifier": ident, "materials": {"default": "entity_alphatest"},
                "textures": {"default": f"textures/entity/{NS}/{NS}_i"}, "geometry": {"default": f"geometry.{NS}.none"},
                "render_controllers": [f"controller.render.{NS}.none"]}}})
    print(f"{len(SIZES)} hit volume entities: {SIZES}")


if __name__ == "__main__":
    main()
