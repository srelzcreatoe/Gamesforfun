#!/usr/bin/env python3
"""Builds the Shin Godzilla add-on (behavior pack + resource pack + .mcaddon).

    python3 build.py            # full build
    python3 build.py --fast     # skip texture/sound regeneration if present

Outputs:
    ../behavior_pack/   ../resource_pack/   ../dist/ShinGodzilla.mcaddon
"""
import json
import os
import shutil
import sys
import uuid
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import anim  # noqa: E402
import form2  # noqa: E402
import form3  # noqa: E402
import form4  # noqa: E402
import fx  # noqa: E402
import geo  # noqa: E402
import sounds  # noqa: E402
import tex  # noqa: E402

ROOT = os.path.dirname(HERE)
BP = os.path.join(ROOT, "behavior_pack")
RP = os.path.join(ROOT, "resource_pack")
DIST = os.path.join(ROOT, "dist")
ASSETS = os.path.join(HERE, "assets")
VERSION = [1, 0, 0]
MIN_ENGINE = [1, 21, 90]
FAST = "--fast" in sys.argv

F2, F3, F4 = "sg:shin_godzilla_2", "sg:shin_godzilla_3", "sg:shin_godzilla"


def uid(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/srelzcreatoe/gamesforfun/shin_godzilla/" + name))


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if isinstance(data, (dict, list)):
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
    else:
        with open(path, "w") as f:
            f.write(data)


def r3(v):
    return [round(x, 3) for x in v]


# =============================================================== models
def build_models():
    models = {}
    m4 = form4.build()
    m3 = form3.build()
    m2 = form2.build()
    models[4], models[3], models[2] = m4, m3, m2
    geo.save(os.path.join(RP, "models/entity/shin_godzilla.geo.json"), m4.to_json((190, 130), (0, 36, 0)))
    geo.save(os.path.join(RP, "models/entity/shin_godzilla_3.geo.json"), m3.to_json((100, 70), (0, 18, 0)))
    geo.save(os.path.join(RP, "models/entity/shin_godzilla_2.geo.json"), m2.to_json((110, 36), (0, 8, 0)))
    for k, m in models.items():
        print("form %d: %d cubes, %d bones" % (k, m.cube_count(), len(m.bones)))
    return models


def build_textures():
    from PIL import Image
    out = os.path.join(RP, "textures/entity/shin_godzilla")
    os.makedirs(out, exist_ok=True)
    # (form, [(variant, painted size, shipped size)]): the glowing/frozen skins are painted at
    # full size and shipped at half so their fissures line up exactly with the normal skin.
    jobs = [(4, [("normal", 2048, 2048), ("charged", 2048, 1024), ("frozen", 2048, 1024)]),
            (3, [("normal", 1024, 1024)]), (2, [("normal", 1024, 1024)])]
    for form, variants in jobs:
        cache = tex.MapCache(1.0, 100 * form)
        for v, paint, ship in variants:
            name = "form%d%s.png" % (form, "" if v == "normal" else "_" + v)
            p = os.path.join(out, name)
            if FAST and os.path.exists(p):
                continue
            img = tex.build_atlas(form, v, paint, cache)
            if ship != paint:
                img = img.resize((ship, ship), Image.LANCZOS)
            img.save(p, optimize=True)
            print("texture", name, "%.1f MB" % (os.path.getsize(p) / 1e6))


# =============================================================== anchors
def compute_anchors(models):
    m4, m3, m2 = models[4], models[3], models[2]
    sets4 = anim.big_set("x", form4.TAIL_N)
    mouth_tab = []
    for a in (-35, -15, 0, 15, 30, 45, 60, 75):
        pose = anim.pose_of(sets4["x.breath"], 0.0, {"AIM": a})
        mouth_tab.append([a] + r3(geo.world_point(m4, "head", form4.MOUTH, pose)))
    dpose = anim.pose_of(sets4["x.dorsal"], 0.0)
    tips = [(b, p) for (b, p, h) in m4.plate_tips if b in ("hips", "torso", "chest", "neck1") and h >= 3.6]
    dorsal = [r3(geo.world_point(m4, b, p, dpose)) for (b, p) in tips]
    tpose = anim.pose_of(sets4["x.tail"], 0.0)
    last = "tail%d" % (form4.TAIL_N - 1)
    tip = geo.world_point(m4, last, m4.tail_tip, tpose)
    pre = geo.world_point(m4, last, m4.tail_pre, tpose)
    tdir = [tip[i] - pre[i] for i in range(3)]
    ln = sum(v * v for v in tdir) ** 0.5
    spine = geo.Path(form4.SPINE, hint=(0, 0, 1))
    g3 = {"mouth": form3.anchors(m3)["mouth"]}
    for key, phi in (("gill_L", -12), ("gill_R", 192)):
        p, nrm, _ = spine.surface(12.5, phi, out=0.6)
        g3[key] = r3(geo.world_point(m3, "neck1", tuple(float(c) * 0.5 for c in p)))
    anchors = {
        "f4": {"mouth_by_aim": mouth_tab, "dorsal": dorsal, "tail_tip": r3(tip), "tail_dir": r3([v / ln for v in tdir])},
        "f3": g3,
        "f2": form2.anchors(m2),
    }
    print("anchors: mouth(0)=%s  dorsal pts=%d  tail tip=%s" % (mouth_tab[2], len(dorsal), r3(tip)))
    return anchors


# =============================================================== client side
def client_entity(ident, geo_id, textures, anims, controller, egg, render_ctrl):
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": ident,
        "materials": {"default": "entity_emissive_alpha"},
        "textures": textures,
        "geometry": {"default": geo_id},
        "render_controllers": [render_ctrl],
        "animations": dict(anims, ctrl=controller),
        "scripts": {"animate": ["ctrl"]},
        "spawn_egg": {"texture": egg, "texture_index": 0},
        "enable_attachables": False,
    }}}


def build_client(models):
    # ---- animations
    a4 = anim.big_set("animation.sg.f4", form4.TAIL_N, 20.0, 1.0)
    keep3 = ("idle", "walk", "look", "roar", "evolving", "dying")
    a3 = {k: v for k, v in anim.big_set("animation.sg.f3", form4.TAIL_N, 36.0, 0.5, stagger=1.0).items() if k.split(".")[-1] in keep3}
    a2 = anim.kamata_set("animation.sg.f2", form2.TAIL_N)
    write(os.path.join(RP, "animations/shin_godzilla.animation.json"), anim.to_bedrock(a4))
    write(os.path.join(RP, "animations/shin_godzilla_3.animation.json"), anim.to_bedrock(a3))
    write(os.path.join(RP, "animations/shin_godzilla_2.animation.json"), anim.to_bedrock(a2))

    walkset = ["idle", {"walk": "q.modified_move_speed"}, "look"]
    c4 = anim.controller("controller.animation.sg.f4", {
        "default": (["walk"], walkset),
        "roar": (["roar"], ["roar", "idle"]),
        "charge": (["charge"], ["charge"]),
        "spew": (["smoke", "fire"], ["spew"]),
        "breath": (["beam"], ["breath"]),
        "dorsal": (["dorsal"], ["dorsal"]),
        "tail": (["tail"], ["tail"]),
        "dormant": (["dormant"], ["dormant"]),
        "frozen": (["frozen"], ["frozen"]),
        "waking": (["waking"], ["waking"]),
        "dying": (["dying"], ["dying"]),
    })
    c3 = anim.controller("controller.animation.sg.f3", {
        "default": (["walk"], walkset),
        "roar": (["roar"], ["roar", "idle"]),
        "evolving": (["evolving"], ["evolving"]),
        "dying": (["dying"], ["dying"]),
    })
    c2 = anim.controller("controller.animation.sg.f2", {
        "default": (["walk"], walkset),
        "roar": (["roar"], ["roar", "idle"]),
        "evolving": (["evolving"], ["evolving"]),
        "dying": (["dying"], ["dying"]),
    })
    for name, c in (("shin_godzilla", c4), ("shin_godzilla_3", c3), ("shin_godzilla_2", c2)):
        write(os.path.join(RP, "animation_controllers/%s.ac.json" % name), c)

    def amap(prefix, names):
        return {n: "%s.%s" % (prefix, n) for n in names}
    n4 = ["idle", "walk", "look", "roar", "charge", "spew", "breath", "dorsal", "tail", "dormant", "frozen", "waking", "dying"]
    n3 = ["idle", "walk", "look", "roar", "evolving", "dying"]
    base = "textures/entity/shin_godzilla/"
    write(os.path.join(RP, "entity/shin_godzilla.entity.json"), client_entity(
        F4, "geometry.sg.shin_godzilla",
        {"normal": base + "form4", "charged": base + "form4_charged", "frozen": base + "form4_frozen"},
        amap("animation.sg.f4", n4), "controller.animation.sg.f4", "sg_egg_4", "controller.render.sg.shin_godzilla"))
    write(os.path.join(RP, "entity/shin_godzilla_3.entity.json"), client_entity(
        F3, "geometry.sg.shin_godzilla_3", {"default": base + "form3"},
        amap("animation.sg.f3", n3), "controller.animation.sg.f3", "sg_egg_3", "controller.render.sg.shin_godzilla_simple"))
    write(os.path.join(RP, "entity/shin_godzilla_2.entity.json"), client_entity(
        F2, "geometry.sg.shin_godzilla_2", {"default": base + "form2"},
        amap("animation.sg.f2", n3), "controller.animation.sg.f2", "sg_egg_2", "controller.render.sg.shin_godzilla_simple"))

    write(os.path.join(RP, "render_controllers/shin_godzilla.rc.json"), {
        "format_version": "1.10.0", "render_controllers": {
            "controller.render.sg.shin_godzilla": {
                "arrays": {"textures": {"Array.skins": ["Texture.normal", "Texture.charged", "Texture.frozen"]}},
                "geometry": "Geometry.default",
                "materials": [{"*": "Material.default"}],
                "textures": ["Array.skins[q.property('sg:glow')]"],
            },
            "controller.render.sg.shin_godzilla_simple": {
                "geometry": "Geometry.default",
                "materials": [{"*": "Material.default"}],
                "textures": ["Texture.default"],
            },
        }})


# =============================================================== behavior side
FAMILY = ["shin_godzilla", "kaiju", "monster", "mob"]


def sensor(explosion_mult):
    return {"minecraft:damage_sensor": {"triggers": [
        {"on_damage": {"filters": {"test": "is_family", "subject": "other", "value": "kaiju"}}, "deals_damage": "no"},
        {"cause": "fall", "deals_damage": "no"},
        {"cause": "suffocation", "deals_damage": "no"},
        {"cause": "drowning", "deals_damage": "no"},
        {"cause": "fire", "deals_damage": "no"},
        {"cause": "fire_tick", "deals_damage": "no"},
        {"cause": "lava", "deals_damage": "no"},
        {"cause": "lightning", "deals_damage": "no"},
        {"cause": "freezing", "deals_damage": "no"},
        {"cause": "contact", "deals_damage": "no"},
        {"cause": "fly_into_wall", "deals_damage": "no"},
        {"cause": "projectile", "deals_damage": "yes", "damage_multiplier": 0.4},
        {"cause": "entity_explosion", "deals_damage": "yes", "damage_multiplier": explosion_mult},
        {"cause": "block_explosion", "deals_damage": "yes", "damage_multiplier": explosion_mult},
    ]}}


IMMUNE = {"minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]}}


def ai_group(stroll):
    return {
        "minecraft:behavior.melee_attack": {"priority": 3, "speed_multiplier": 1.0, "track_target": True, "reach_multiplier": 1.4},
        "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.85, "xz_dist": stroll, "y_dist": 7, "interval": 80},
        "minecraft:behavior.look_at_player": {"priority": 7, "look_distance": 40, "probability": 0.03},
        "minecraft:behavior.random_look_around": {"priority": 8},
    }


def mode_groups():
    not_kaiju = {"test": "is_family", "subject": "other", "operator": "!=", "value": "kaiju"}
    golem = {"filters": {"test": "is_family", "subject": "other", "value": "irongolem"}, "max_dist": 40}
    return {
        "sg:mode_movie": {
            "minecraft:behavior.hurt_by_target": {"priority": 1, "entity_types": {"filters": not_kaiju}},
            "minecraft:behavior.nearest_attackable_target": {"priority": 2, "must_see": True, "reselect_targets": True,
                                                              "within_radius": 40, "entity_types": [golem]},
        },
        "sg:mode_hunt": {
            "minecraft:behavior.hurt_by_target": {"priority": 1, "entity_types": {"filters": not_kaiju}},
            "minecraft:behavior.nearest_attackable_target": {"priority": 2, "must_see": False, "reselect_targets": True,
                                                              "within_radius": 64, "entity_types": [
                                                                  {"filters": {"test": "is_family", "subject": "other", "value": "player"}, "max_dist": 64},
                                                                  golem,
                                                                  {"filters": {"test": "is_family", "subject": "other", "value": "villager"}, "max_dist": 40}]},
        },
        "sg:mode_peaceful": {"minecraft:behavior.random_look_around": {"priority": 9}},
    }


def entity_bp(ident, cfg):
    modes = list(mode_groups().keys())
    groups = {
        "sg:ai": ai_group(cfg["stroll"]),
        "sg:move": {"minecraft:movement": {"value": cfg["speed"]}},
        "sg:locked": {"minecraft:movement": {"value": 0.0}},
        "sg:sense": sensor(cfg["explosion"]),
        "sg:immune": IMMUNE,
        "sg:despawn": {"minecraft:instant_despawn": {}},
        "sg:size_full": {"minecraft:scale": {"value": 1.0}},
        "sg:size_half": {"minecraft:scale": {"value": 0.5}},
        "sg:size_quarter": {"minecraft:scale": {"value": 0.25}},
    }
    groups.update(mode_groups())
    init = ["sg:ai", "sg:move", "sg:sense", "sg:mode_movie"]
    events = {
        "minecraft:entity_spawned": {"add": {"component_groups": init}},
        "minecraft:entity_transformed": {"add": {"component_groups": init}, "set_property": {"sg:state": "roar"}},
        "sg:lock": {"remove": {"component_groups": ["sg:ai", "sg:move"]}, "add": {"component_groups": ["sg:locked"]}},
        "sg:unlock": {"remove": {"component_groups": ["sg:locked"]}, "add": {"component_groups": ["sg:ai", "sg:move"]}},
        "sg:dying": {"remove": {"component_groups": ["sg:ai", "sg:move", "sg:sense"] + modes + (["sg:dormant"] if cfg.get("dormancy") else [])},
                     "add": {"component_groups": ["sg:locked", "sg:immune"]}},
        "sg:despawn": {"add": {"component_groups": ["sg:despawn"]}},
    }
    for mname in modes:
        events[mname] = {"remove": {"component_groups": [x for x in modes if x != mname]}, "add": {"component_groups": [mname]}}
    for size in ("full", "half", "quarter"):
        events["sg:size_" + size] = {"remove": {"component_groups": ["sg:size_" + x for x in ("full", "half", "quarter") if x != size]},
                                     "add": {"component_groups": ["sg:size_" + size]}}
    states = cfg["states"]
    props = {"sg:state": {"type": "enum", "values": states, "default": "walk", "client_sync": True}}
    if cfg.get("dormancy"):
        props["sg:glow"] = {"type": "int", "range": [0, 2], "default": 0, "client_sync": True}
        props["sg:aim"] = {"type": "int", "range": [-90, 90], "default": 0, "client_sync": True}
        groups["sg:dormant"] = {"minecraft:interact": {"interactions": [{
            "on_interact": {"filters": {"all_of": [
                {"test": "has_equipment", "subject": "other", "domain": "hand", "value": "sg:yashiori_coagulant"}]},
                "event": "sg:coagulant_hit", "target": "self"},
            "use_item": True, "swing": True, "cooldown": 1.0,
            "interact_text": "action.interact.sg.inject"}]}}
        groups["sg:frozen"] = dict(IMMUNE)
        events["sg:go_dormant"] = {"remove": {"component_groups": ["sg:ai", "sg:move"] + modes},
                                   "add": {"component_groups": ["sg:locked", "sg:dormant"]}}
        events["sg:wake"] = {"remove": {"component_groups": ["sg:locked", "sg:dormant"]},
                             "add": {"component_groups": ["sg:ai", "sg:move", "sg:mode_movie"]}}
        events["sg:freeze"] = {"remove": {"component_groups": ["sg:ai", "sg:move", "sg:dormant", "sg:sense"] + modes},
                               "add": {"component_groups": ["sg:locked", "sg:frozen"]}}
        events["sg:thaw"] = {"remove": {"component_groups": ["sg:frozen", "sg:locked"]},
                             "add": {"component_groups": ["sg:ai", "sg:move", "sg:sense", "sg:mode_movie"]}}
        events["sg:coagulant_hit"] = {"add": {"component_groups": ["sg:dormant"]}}
    if cfg.get("evolves_into"):
        groups["sg:transform"] = {"minecraft:transformation": {"into": cfg["evolves_into"], "keep_level": True,
                                                               "drop_equipment": False, "delay": {"value": 0.0}}}
        events["sg:begin_evolve"] = {"remove": {"component_groups": ["sg:ai", "sg:move"]},
                                     "add": {"component_groups": ["sg:locked"]},
                                     "set_property": {"sg:state": "evolving"}}
        events["sg:evolve"] = {"add": {"component_groups": ["sg:transform"]}}

    comps = {
        "minecraft:type_family": {"family": FAMILY + cfg.get("extra_family", [])},
        "minecraft:health": {"value": cfg["health"], "max": cfg["health"]},
        "minecraft:collision_box": {"width": cfg["box"][0], "height": cfg["box"][1]},
        "minecraft:custom_hit_test": {"hitboxes": [{"pivot": [0, cfg["hit"][1] / 2, 0], "width": cfg["hit"][0], "height": cfg["hit"][1]}]},
        "minecraft:physics": {},
        "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
        "minecraft:knockback_resistance": {"value": 1.0},
        "minecraft:fire_immune": {},
        "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0, "breathes_water": True, "breathes_air": True, "generates_bubbles": False},
        "minecraft:movement.basic": {},
        "minecraft:jump.static": {},
        "minecraft:navigation.walk": {"can_path_over_water": False, "avoid_water": False, "can_sink": True, "can_walk_in_lava": True,
                                      "avoid_damage_blocks": False, "can_break_doors": True, "can_pass_doors": True},
        "minecraft:underwater_movement": {"value": cfg["swim"]},
        "minecraft:attack": {"damage": cfg["attack"]},
        "minecraft:follow_range": {"value": 64, "max": 96},
        "minecraft:boss": {"hud_range": cfg["hud"], "name": cfg["boss_name"], "should_darken_sky": cfg.get("darken", False)},
        "minecraft:persistent": {},
        "minecraft:nameable": {},
        "minecraft:loot": {"table": "loot_tables/entities/%s.json" % ident.split(":")[1]},
        "minecraft:experience_reward": {"on_death": str(cfg["xp"])},
        "minecraft:conditional_bandwidth_optimization": {},
    }
    return {"format_version": "1.21.0", "minecraft:entity": {
        "description": {"identifier": ident, "is_spawnable": True, "is_summonable": True, "properties": props},
        "component_groups": groups, "components": comps, "events": events}}


def build_behavior():
    write(os.path.join(BP, "entities/shin_godzilla.json"), entity_bp(F4, dict(
        health=2000, box=(4.0, 12.0), hit=(12, 44), speed=0.2, swim=0.12, attack=30, stroll=32, explosion=1.6,
        hud=96, boss_name="Shin Godzilla", darken=True, xp=500, dormancy=True,
        states=["walk", "roar", "charge", "smoke", "fire", "beam", "dorsal", "tail", "dormant", "frozen", "waking", "dying"])))
    write(os.path.join(BP, "entities/shin_godzilla_3.json"), entity_bp(F3, dict(
        health=650, box=(2.6, 8.0), hit=(7, 22), speed=0.18, swim=0.12, attack=18, stroll=24, explosion=1.3,
        hud=64, boss_name="Shin Godzilla - 3rd Form", xp=200, evolves_into=F4,
        states=["walk", "roar", "evolving", "dying"])))
    write(os.path.join(BP, "entities/shin_godzilla_2.json"), entity_bp(F2, dict(
        health=320, box=(3.2, 4.0), hit=(9, 9), speed=0.13, swim=0.16, attack=10, stroll=20, explosion=1.2,
        hud=48, boss_name="Shin Godzilla - 2nd Form", xp=100, evolves_into=F3,
        states=["walk", "roar", "evolving", "dying"])))

    for name, lo, hi in (("shin_godzilla", 4, 8), ("shin_godzilla_3", 2, 4), ("shin_godzilla_2", 1, 2)):
        write(os.path.join(BP, "loot_tables/entities/%s.json" % name), {"pools": [{"rolls": 1, "entries": [
            {"type": "item", "name": "sg:g_cell", "weight": 1, "functions": [{"function": "set_count", "count": {"min": lo, "max": hi}}]}]}]})

    def item(ident, name, icon, stack, cat):
        return {"format_version": "1.21.40", "minecraft:item": {
            "description": {"identifier": ident, "menu_category": {"category": cat}},
            "components": {"minecraft:icon": {"textures": {"default": icon}}, "minecraft:display_name": {"value": name},
                           "minecraft:max_stack_size": stack}}}
    write(os.path.join(BP, "items/yashiori_coagulant.json"), item("sg:yashiori_coagulant", "Yashiori Coagulant", "sg_coagulant", 16, "items"))
    write(os.path.join(BP, "items/g_cell.json"), item("sg:g_cell", "G-Cell Sample", "sg_g_cell", 64, "items"))
    write(os.path.join(BP, "items/kaiju_tablet.json"), item("sg:kaiju_tablet", "Kaiju Control Tablet", "sg_tablet", 1, "equipment"))

    unlock = {"context": "AlwaysUnlocked"}
    write(os.path.join(BP, "recipes/yashiori_coagulant.json"), {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
        "description": {"identifier": "sg:yashiori_coagulant"}, "tags": ["crafting_table"], "unlock": unlock,
        "ingredients": [{"item": "sg:g_cell"}, {"item": "minecraft:glass_bottle"}, {"item": "minecraft:snowball"}, {"item": "minecraft:slime_ball"}],
        "result": {"item": "sg:yashiori_coagulant", "count": 2}}})
    write(os.path.join(BP, "recipes/yashiori_coagulant_alt.json"), {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
        "description": {"identifier": "sg:yashiori_coagulant_alt"}, "tags": ["crafting_table"], "unlock": unlock,
        "ingredients": [{"item": "minecraft:glass_bottle"}, {"item": "minecraft:blue_ice"}, {"item": "minecraft:slime_ball"}, {"item": "minecraft:redstone"}],
        "result": {"item": "sg:yashiori_coagulant", "count": 1}}})
    write(os.path.join(BP, "recipes/kaiju_tablet.json"), {"format_version": "1.20.10", "minecraft:recipe_shaped": {
        "description": {"identifier": "sg:kaiju_tablet"}, "tags": ["crafting_table"], "unlock": unlock,
        "pattern": ["IGI", "IRI", "III"],
        "key": {"I": {"item": "minecraft:iron_ingot"}, "G": {"item": "minecraft:glass_pane"}, "R": {"item": "minecraft:redstone"}},
        "result": {"item": "sg:kaiju_tablet", "count": 1}}})


# =============================================================== assets
def build_assets(anchors):
    # particles
    for name, data in fx.particles().items():
        write(os.path.join(RP, "particles/%s.particle.json" % name), data)
    fx.make_particle_textures(os.path.join(RP, "textures/particle/sg"))
    # items + icons
    fx.make_item_icons(os.path.join(RP, "textures/items/sg"))
    for f in ("egg_2.png", "egg_3.png", "egg_4.png"):
        shutil.copy(os.path.join(ASSETS, f), os.path.join(RP, "textures/items/sg", f))
    write(os.path.join(RP, "textures/item_texture.json"), {"resource_pack_name": "shin_godzilla", "texture_name": "atlas.items", "texture_data": {
        "sg_coagulant": {"textures": "textures/items/sg/yashiori_coagulant"},
        "sg_g_cell": {"textures": "textures/items/sg/g_cell"},
        "sg_tablet": {"textures": "textures/items/sg/kaiju_tablet"},
        "sg_egg_2": {"textures": "textures/items/sg/egg_2"},
        "sg_egg_3": {"textures": "textures/items/sg/egg_3"},
        "sg_egg_4": {"textures": "textures/items/sg/egg_4"},
    }})
    # sounds
    sdir = os.path.join(RP, "sounds/sg")
    if not (FAST and os.path.isdir(sdir)):
        sounds.build_all(sdir)
    loud = {"roar4": 256, "roar3": 160, "roar2": 128, "beam": 200, "beam_start": 256, "dorsal": 200, "step": 128,
            "crash": 96, "charge": 128, "fire": 128, "smoke": 96, "evolve": 128, "freeze": 128, "dormant": 64,
            "coagulant": 32, "hurt": 64}
    defs = {}
    for name in sounds.ALL:
        defs["sg." + name] = {"category": "hostile", "min_distance": 4.0, "max_distance": float(loud.get(name, 64)),
                              "sounds": [{"name": "sounds/sg/" + name, "volume": 1.0, "load_on_low_memory": True}]}
    write(os.path.join(RP, "sounds/sound_definitions.json"), {"format_version": "1.20.20", "sound_definitions": defs})
    write(os.path.join(RP, "sounds.json"), {"entity_sounds": {"entities": {
        F4: {"volume": 1.0, "pitch": [0.9, 1.05], "events": {"hurt": {"sound": "sg.hurt", "volume": 2.0}, "death": {"sound": "sg.roar4", "volume": 4.0}}},
        F3: {"volume": 1.0, "pitch": [1.0, 1.15], "events": {"hurt": {"sound": "sg.hurt", "volume": 1.5, "pitch": 1.2}, "death": {"sound": "sg.roar3", "volume": 3.0}}},
        F2: {"volume": 1.0, "pitch": [1.05, 1.2], "events": {"hurt": {"sound": "sg.hurt", "volume": 1.2, "pitch": 1.35}, "death": {"sound": "sg.roar2", "volume": 2.0}}},
    }}})
    # language
    lang = "\n".join([
        "entity.sg:shin_godzilla.name=Shin Godzilla",
        "entity.sg:shin_godzilla_3.name=Shin Godzilla (3rd Form)",
        "entity.sg:shin_godzilla_2.name=Shin Godzilla (2nd Form)",
        "item.spawn_egg.entity.sg:shin_godzilla.name=Spawn Shin Godzilla (4th Form)",
        "item.spawn_egg.entity.sg:shin_godzilla_3.name=Spawn Shin Godzilla (3rd Form)",
        "item.spawn_egg.entity.sg:shin_godzilla_2.name=Spawn Shin Godzilla (2nd Form)",
        "action.interact.sg.inject=Inject Coagulant",
        "pack.name=Shin Godzilla",
        "pack.description=Shin Godzilla in all its forms",
        "",
    ])
    write(os.path.join(RP, "texts/en_US.lang"), lang)
    write(os.path.join(RP, "texts/languages.json"), ["en_US"])
    # script + generated anchors
    os.makedirs(os.path.join(BP, "scripts"), exist_ok=True)
    shutil.copy(os.path.join(HERE, "scripts/main.js"), os.path.join(BP, "scripts/main.js"))
    write(os.path.join(BP, "scripts/anchors.js"),
          "// Generated by build.py from the model + animation poses. Do not edit.\nexport const ANCHORS = " +
          json.dumps(anchors, indent=1) + ";\n")
    # pack icons
    shutil.copy(os.path.join(ASSETS, "pack_icon.png"), os.path.join(BP, "pack_icon.png"))
    shutil.copy(os.path.join(ASSETS, "pack_icon.png"), os.path.join(RP, "pack_icon.png"))


def build_manifests():
    bp_h, rp_h = uid("bp-header"), uid("rp-header")
    desc = "Shin Godzilla (2016) as a Bedrock add-on: 2nd, 3rd and 4th forms, atomic breath, dorsal rays, tail beam, evolution and the Yashiori Strategy."
    write(os.path.join(BP, "manifest.json"), {
        "format_version": 2,
        "header": {"name": "Shin Godzilla (Behavior)", "description": desc, "uuid": bp_h, "version": VERSION, "min_engine_version": MIN_ENGINE},
        "modules": [{"type": "data", "uuid": uid("bp-data"), "version": VERSION},
                    {"type": "script", "language": "javascript", "uuid": uid("bp-script"), "entry": "scripts/main.js", "version": VERSION}],
        "dependencies": [{"uuid": rp_h, "version": VERSION},
                         {"module_name": "@minecraft/server", "version": "2.0.0"},
                         {"module_name": "@minecraft/server-ui", "version": "2.0.0"}],
    })
    write(os.path.join(RP, "manifest.json"), {
        "format_version": 2,
        "header": {"name": "Shin Godzilla (Resources)", "description": desc, "uuid": rp_h, "version": VERSION, "min_engine_version": MIN_ENGINE},
        "modules": [{"type": "resources", "uuid": uid("rp-res"), "version": VERSION}],
        "dependencies": [{"uuid": bp_h, "version": VERSION}],
    })


def package():
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, "ShinGodzilla.mcaddon")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for src, arc in ((BP, "Shin Godzilla BP"), (RP, "Shin Godzilla RP")):
            for dp, _, files in os.walk(src):
                for fn in sorted(files):
                    full = os.path.join(dp, fn)
                    z.write(full, os.path.join(arc, os.path.relpath(full, src)))
    print("packaged", out, "%.1f MB" % (os.path.getsize(out) / 1e6))


def main():
    for d in (BP, RP):
        if os.path.isdir(d):
            keep = {}
            if FAST:  # keep slow-to-generate assets
                for sub in ("textures/entity/shin_godzilla", "sounds/sg"):
                    p = os.path.join(d, sub)
                    if os.path.isdir(p):
                        keep[sub] = os.path.join(ROOT, ".keep_" + os.path.basename(d) + "_" + sub.replace("/", "_"))
                        shutil.rmtree(keep[sub], ignore_errors=True)
                        shutil.move(p, keep[sub])
            shutil.rmtree(d)
            for sub, tmp in keep.items():
                os.makedirs(os.path.dirname(os.path.join(d, sub)), exist_ok=True)
                shutil.move(tmp, os.path.join(d, sub))
    models = build_models()
    build_textures()
    anchors = compute_anchors(models)
    build_client(models)
    build_behavior()
    build_assets(anchors)
    build_manifests()
    package()


if __name__ == "__main__":
    main()
