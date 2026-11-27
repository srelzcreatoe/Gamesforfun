#!/usr/bin/env python3
"""Builds Kaijus Srelz Pack (behavior pack + resource pack + .mcaddon).

    python3 build.py            # full build
    python3 build.py --fast     # skip texture/sound regeneration if present

Outputs:
    ../behavior_pack/   ../resource_pack/   ../dist/KaijusSrelzPack.mcaddon
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
import minus  # noqa: E402
import sounds  # noqa: E402
import tex  # noqa: E402

ROOT = os.path.dirname(HERE)
BP = os.path.join(ROOT, "behavior_pack")
RP = os.path.join(ROOT, "resource_pack")
DIST = os.path.join(ROOT, "dist")
ASSETS = os.path.join(HERE, "assets")
PACK = "Kaijus Srelz Pack"
VERSION = [1, 0, 0]
MIN_ENGINE = [1, 21, 90]
FAST = "--fast" in sys.argv

F2, F3, F4 = "sg:shin_godzilla_2", "sg:shin_godzilla_3", "sg:shin_godzilla"
F4R = "sg:shin_godzilla_rampage"   # same creature, but it never tires and never stops attacking
M1, M0 = "sg:godzilla_minus_one", "sg:godzilla_minus_zero"


def uid(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/srelzcreatoe/gamesforfun/kaijus_srelz_pack/" + name))


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
    models["m1"], models["m0"] = minus.build(variant="one"), minus.build(variant="zero")
    geo.save(os.path.join(RP, "models/entity/godzilla_minus_one.geo.json"), models["m1"].to_json((130, 70), (0, 24, 0)))
    geo.save(os.path.join(RP, "models/entity/godzilla_minus_zero.geo.json"), models["m0"].to_json((140, 80), (0, 26, 0)))
    for k, m in models.items():
        print("%s: %d cubes, %d bones" % (k if isinstance(k, str) else "form %d" % k, m.cube_count(), len(m.bones)))
    return models


def build_textures():
    from PIL import Image
    out = os.path.join(RP, "textures/entity/shin_godzilla")
    os.makedirs(out, exist_ok=True)
    # (form, [(variant, painted size, shipped size)]): the glowing/frozen skins are painted at
    # full size and shipped at half so their fissures line up exactly with the normal skin.
    jobs = [(4, [("normal", 2048, 2048), ("charged", 2048, 1024), ("frozen", 2048, 1024)]),
            (3, [("normal", 1024, 1024)]), (2, [("normal", 1024, 1024)]),
            (5, [("normal", 2048, 2048), ("charged", 2048, 1024)]),       # Godzilla Minus One
            (6, [("normal", 2048, 2048), ("charged", 2048, 1024)])]       # Godzilla Minus Zero
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
def minus_sets(m, prefix):
    fins = [(b, up, tr) for (b, par, up, tr, tip, h) in m.fins]
    return anim.minus_set(prefix, minus.TAIL_N, minus.TAIL_REST, fins, roar_len=sounds.ROAR_M_LEN)


# ticks at which Minus Godzilla's blows land (they follow the animations in anim.minus_set)
MINUS_TIMING = {"claw": {"hit1": 8, "hit2": 17, "end": 30}, "grab": {"bite": 10, "release": 38, "end": 48}, "whip": {"from": 7, "to": 24, "end": 32}}


def minus_anchors(m):
    """Effect points for a Minus kaiju, in the poses its animations put it in."""
    import math
    A = minus_sets(m, "x")
    k = m.k
    mouth = tuple(c * k for c in minus.MOUTH)
    mouth_tab = [[a] + r3(geo.world_point(m, "head", mouth, anim.pose_of(A["x.breath"], 0.0, {"AIM": a}))) for a in (-35, -15, 0, 15, 30, 45, 60)]
    cpose = anim.pose_of(A["x.charge"], 0.0)
    fins = [r3(geo.world_point(m, par, tip, cpose)) for (b, par, up, tr, tip, h) in m.fins]          # tips, in the order they rise
    dorsal = [r3(geo.world_point(m, par, tip, cpose)) for (b, par, up, tr, tip, h) in m.fins if not par.startswith("tail")]
    ipose = anim.pose_of(A["x.focus"], 1.3)

    def posed(name, t, bone, point):
        """a point on the model at time t of an animation (its body offset included)"""
        bp = anim.pose_of(A["x." + name], t, key="position").get("body", (0, 0, 0))
        return [a + b / 16.0 for a, b in zip(geo.world_point(m, bone, point, anim.pose_of(A["x." + name], t)), bp)]
    T = MINUS_TIMING
    claws = {sd: r3(posed("claw", T["claw"][key] / 20.0, "hand_" + sd, m.hand[sd])) for sd, key in (("R", "hit1"), ("L", "hit2"))}
    grab = [[tick] + r3(posed("grab", tick / 20.0, "head", mouth)) for tick in range(T["grab"]["bite"], T["grab"]["release"] + 1, 2)]
    base = [c * k for c in minus.TAIL_BASE]
    last = "tail%d" % (minus.TAIL_N - 1)
    whip, prev = [], None
    for tick in range(T["whip"]["from"] - 2, T["whip"]["to"] + 3):       # [tick, bearing of the tail tip, its reach, bearing of the tail root]
        pose = anim.pose_of(A["x.whip"], tick / 20.0)
        tip = geo.world_point(m, last, m.tail_tip, pose)
        brg = math.degrees(math.atan2(tip[0], tip[2]))
        while prev is not None and brg < prev - 180:
            brg += 360
        while prev is not None and brg > prev + 180:
            brg -= 360
        prev = brg
        whip.append([tick, round(brg, 1), round(math.hypot(tip[0], tip[2]), 1), round(pose.get("root", (0, 0, 0))[1], 1)])
    return {"mouth_by_aim": mouth_tab, "dorsal": dorsal, "surge": fins, "fins": fins,
            "inhale_mouth": r3(geo.world_point(m, "head", mouth, ipose)),
            "claw_R": claws["R"], "claw_L": claws["L"], "grab": grab, "whip": whip,
            "tail_reach": round(min(row[2] for row in whip if T["whip"]["from"] <= row[0] <= T["whip"]["to"]), 1),
            "tail_base": r3(base), "height": round(38.7 * k, 1)}


def compute_anchors(models):
    m4, m3, m2 = models[4], models[3], models[2]
    sets4 = anim.big_set("x", form4.TAIL_N, rest_tail=form4.TAIL_REST)
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
    # the path the glow runs along as it charges: tail tip -> down the tail -> up the back -> nape
    cpose = anim.pose_of(sets4["x.charge"], 0.0, {"AIM": 30})
    order = ["tail%d" % i for i in range(form4.TAIL_N - 1, -1, -1)] + ["hips", "torso", "chest", "neck1", "neck2"]
    centre = [(b, p) for (b, p, h) in m4.plate_tips if abs(p[0]) < 0.6]
    surge = []
    for bone in order:
        pts = [p for (b, p) in centre if b == bone]
        pts.sort(key=lambda p: (-p[2] if bone.startswith("tail") else p[1]))
        surge += [r3(geo.world_point(m4, bone, p, cpose)) for p in pts]
    # where the tail's tip is for each sideways swing of the tail (standalone ray / during the breath)
    SW = (-45, -30, -15, 0, 15, 30, 45)
    tail_tab = [[sw] + r3(geo.world_point(m4, last, m4.tail_tip, anim.pose_of(sets4["x.tail"], 0.0, {"TAILSW": sw}))) for sw in SW]
    tailb_tab = [[sw] + r3(geo.world_point(m4, last, m4.tail_tip, anim.pose_of(sets4["x.breath"], 0.0, {"AIM": 20, "TAILSW": sw}))) for sw in SW]
    g3 = {"mouth": form3.anchors(m3)["mouth"]}
    for key, phi in (("gill_L", -12), ("gill_R", 192)):
        p, nrm, _ = spine.surface(12.5, phi, out=0.6)
        g3[key] = r3(geo.world_point(m3, "neck1", tuple(float(c) * 0.5 for c in p)))
    # where the jaws are when a bite lands, and the tail's root (the sweep is measured from it)
    bite = anim.pose_of(sets4["x.bite"], 0.55)
    bpos = anim.pose_of(sets4["x.bite"], 0.55, key="position").get("body", (0, 0, 0))
    bite_mouth = [a + b / 16.0 for a, b in zip(geo.world_point(m4, "head", form4.MOUTH, bite), bpos)]
    T = sounds.BREATH
    order = ("charge", "smoke", "fire", "focus", "beam", "sputter")
    ticks, acc = {}, 0
    for k in order:                      # tick at which each breath phase begins
        ticks[k] = acc
        acc += int(round(T[k] * 20))
    ticks["end"] = acc
    heat, acc = {}, 0
    for k in ("charge", "inhale", "fire", "recover"):          # the Minus heat ray's phases
        heat[k] = acc
        acc += int(round(sounds.HEAT[k] * 20))
    heat["end"] = acc
    anchors = {
        "timing": {"breath": ticks, "roar": int(round((sounds.ROAR_LEN + 0.1) * 20)), "roar_m": int(round((sounds.ROAR_M_LEN + 0.1) * 20)),
                   "heat": heat,
                   "leap": {"crouch": 8, "land": 16}, "bite": {"hit": 11, "end": 24}, "sweep": {"from": 9, "to": 17, "end": 34},
                   **MINUS_TIMING},
        "f4": {"mouth_by_aim": mouth_tab, "dorsal": dorsal, "tail_tip": r3(tip), "tail_dir": r3([v / ln for v in tdir]),
               "surge": surge, "tail_by_swing": tail_tab, "tail_breath_by_swing": tailb_tab,
               "bite_mouth": r3(bite_mouth), "tail_base": r3(form4.TAIL_BASE), "sweep_arc": [-52, 89, 104]},
        "f3": g3,
        "f2": form2.anchors(m2),
        "m1": minus_anchors(models["m1"]),
        "m0": minus_anchors(models["m0"]),
    }
    anchors["f4"]["height"] = 48.0
    print("minus anchors: fins=%d  mouth(0)=%s  tail reach=%s" % (len(anchors["m1"]["fins"]), anchors["m1"]["mouth_by_aim"][2], anchors["m1"]["tail_reach"]))
    print("anchors: mouth(0)=%s  dorsal pts=%d  surge pts=%d  tail tip=%s" % (mouth_tab[2], len(dorsal), len(surge), r3(tip)))
    print("  tail tip by swing (ray):   ", [t[1:] for t in tail_tab[::3]])
    print("  tail tip by swing (breath):", [t[1:] for t in tailb_tab[::3]])
    return anchors


# =============================================================== client side
def client_entity(ident, geo_id, textures, anims, controller, egg, render_ctrl, always=()):
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": ident,
        "materials": {"default": "entity_emissive_alpha"},
        "textures": textures,
        "geometry": {"default": geo_id},
        "render_controllers": [render_ctrl],
        "animations": dict(anims, ctrl=controller),
        "scripts": {"animate": ["ctrl"] + list(always)},
        "spawn_egg": {"texture": egg, "texture_index": 0},
        "enable_attachables": False,
    }}}


def build_client(models):
    # ---- animations
    a4 = anim.big_set("animation.sg.f4", form4.TAIL_N, 20.0, 1.0, rest_tail=form4.TAIL_REST, roar_len=sounds.ROAR_LEN)
    keep3 = ("idle", "walk", "look", "roar", "evolving", "dying")
    a3 = {k: v for k, v in anim.big_set("animation.sg.f3", form4.TAIL_N, 36.0, 0.5, stagger=1.0, rest_tail=form4.TAIL_REST3,
                                        roar_len=3.2).items() if k.split(".")[-1] in keep3}
    a2 = anim.kamata_set("animation.sg.f2", form2.TAIL_N)
    write(os.path.join(RP, "animations/shin_godzilla.animation.json"), anim.to_bedrock(a4))
    write(os.path.join(RP, "animations/shin_godzilla_3.animation.json"), anim.to_bedrock(a3))
    write(os.path.join(RP, "animations/shin_godzilla_2.animation.json"), anim.to_bedrock(a2))

    walkset = ["idle", {"walk": "math.clamp(q.modified_move_speed*8, 0, 1)"}, "look"]
    c4 = anim.controller("controller.animation.sg.f4", {
        "default": (["walk"], walkset),
        "roar": (["roar"], ["roar", "idle"]),
        "charge": (["charge"], ["charge"]),
        "spew": (["smoke"], ["spew"]),
        "focus": (["focus"], ["focus"]),
        "breath": (["beam"], ["breath"]),
        "dorsal": (["dorsal"], ["dorsal"]),
        "tail": (["tail"], ["tail"]),
        "leap": (["leap"], ["leap"], 0.12),
        "land": (["land"], ["land"], 0.25),
        "bite": (["bite"], ["bite"], 0.2),
        "sweep": (["sweep"], ["sweep"], 0.3),
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
    n4 = ["idle", "walk", "look", "roar", "charge", "spew", "focus", "breath", "dorsal", "tail", "leap", "land", "bite", "sweep",
          "dormant", "frozen", "waking", "dying"]
    n3 = ["idle", "walk", "look", "roar", "evolving", "dying"]
    base = "textures/entity/shin_godzilla/"
    write(os.path.join(RP, "entity/shin_godzilla.entity.json"), client_entity(
        F4, "geometry.sg.shin_godzilla",
        {"normal": base + "form4", "charged": base + "form4_charged", "frozen": base + "form4_frozen"},
        amap("animation.sg.f4", n4), "controller.animation.sg.f4", "sg_egg_4", "controller.render.sg.shin_godzilla"))
    write(os.path.join(RP, "entity/shin_godzilla_rampage.entity.json"), client_entity(
        F4R, "geometry.sg.shin_godzilla",
        {"normal": base + "form4", "charged": base + "form4_charged", "frozen": base + "form4_frozen"},
        amap("animation.sg.f4", n4), "controller.animation.sg.f4", "sg_egg_4r", "controller.render.sg.shin_godzilla"))
    write(os.path.join(RP, "entity/shin_godzilla_3.entity.json"), client_entity(
        F3, "geometry.sg.shin_godzilla_3", {"default": base + "form3"},
        amap("animation.sg.f3", n3), "controller.animation.sg.f3", "sg_egg_3", "controller.render.sg.shin_godzilla_simple"))
    write(os.path.join(RP, "entity/shin_godzilla_2.entity.json"), client_entity(
        F2, "geometry.sg.shin_godzilla_2", {"default": base + "form2"},
        amap("animation.sg.f2", n3), "controller.animation.sg.f2", "sg_egg_2", "controller.render.sg.shin_godzilla_simple"))

    # ---- Godzilla Minus One / Minus Zero
    cm = anim.controller("controller.animation.sg.minus", {
        "default": (["walk"], walkset),
        "roar": (["roar"], ["roar", "idle"]),
        "charge": (["charge"], ["charge"], 0.35),
        "focus": (["focus"], ["focus"], 0.1),
        "breath": (["beam"], ["breath"], 0.3),
        # his own way of fighting, on the shared state names: charge, stomp, claws, jaws, tail whip
        "rush": (["leap"], ["rush"], 0.2),
        "land": (["land"], ["land"], 0.25),
        "claw": (["bite"], ["claw"], 0.2),
        "grab": (["dorsal"], ["grab"], 0.25),
        "whip": (["sweep"], ["whip"], 0.0),        # it ends a full turn round: no blending back through it
        "dying": (["dying"], ["dying"]),
    })
    write(os.path.join(RP, "animation_controllers/godzilla_minus.ac.json"), cm)
    nm = ["idle", "walk", "look", "roar", "charge", "focus", "breath", "rush", "land", "claw", "grab", "whip", "dying", "fins"]
    for key, ident, name, form, egg in (("m1", M1, "godzilla_minus_one", 5, "sg_egg_m1"), ("m0", M0, "godzilla_minus_zero", 6, "sg_egg_m0")):
        prefix = "animation.sg." + key
        write(os.path.join(RP, "animations/%s.animation.json" % name), anim.to_bedrock(minus_sets(models[key], prefix)))
        write(os.path.join(RP, "entity/%s.entity.json" % name), client_entity(
            ident, "geometry.sg." + name, {"normal": base + "form%d" % form, "charged": base + "form%d_charged" % form},
            amap(prefix, nm), "controller.animation.sg.minus", egg, "controller.render.sg.minus", always=["fins"]))

    write(os.path.join(RP, "render_controllers/shin_godzilla.rc.json"), {
        "format_version": "1.10.0", "render_controllers": {
            "controller.render.sg.shin_godzilla": {
                "arrays": {"textures": {"Array.skins": ["Texture.normal", "Texture.charged", "Texture.frozen"]}},
                "geometry": "Geometry.default",
                "materials": [{"*": "Material.default"}],
                "textures": ["Array.skins[q.property('sg:glow')]"],
            },
            "controller.render.sg.minus": {
                "arrays": {"textures": {"Array.skins": ["Texture.normal", "Texture.charged"]}},
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
def family(cfg):
    """Shin Godzilla's forms are one kind and the Minus Godzillas another: a kaiju never harms or
    hunts its own kind, but the two kinds will fight each other."""
    return [cfg.get("kind", "shin_godzilla"), "kaiju", "monster", "mob"] + cfg.get("extra_family", [])


def sensor(explosion_mult, kind="shin_godzilla"):
    return {"minecraft:damage_sensor": {"triggers": [
        {"on_damage": {"filters": {"test": "is_family", "subject": "other", "value": kind}}, "deals_damage": "no"},
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
        # closes on its target; the hits themselves (bite, tail, stomp) are staged by the script
        "minecraft:behavior.melee_attack": {"priority": 3, "speed_multiplier": 1.0, "track_target": True, "reach_multiplier": 0.02},
        "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.85, "xz_dist": stroll, "y_dist": 7, "interval": 80},
        "minecraft:behavior.look_at_player": {"priority": 7, "look_distance": 40, "probability": 0.03},
        "minecraft:behavior.random_look_around": {"priority": 8},
    }


def mode_groups(kind="shin_godzilla"):
    not_kin = {"test": "is_family", "subject": "other", "operator": "!=", "value": kind}
    golem = {"filters": {"test": "is_family", "subject": "other", "value": "irongolem"}, "max_dist": 40}
    anything = {"filters": {"all_of": [not_kin, {"any_of": [
        {"test": "is_family", "subject": "other", "value": "player"},
        {"test": "is_family", "subject": "other", "value": "mob"},
        {"test": "is_family", "subject": "other", "value": "monster"}]}]}, "max_dist": 72}
    return {
        "sg:mode_movie": {
            "minecraft:behavior.hurt_by_target": {"priority": 1, "entity_types": {"filters": not_kin}},
            "minecraft:behavior.nearest_attackable_target": {"priority": 2, "must_see": True, "reselect_targets": True,
                                                              "within_radius": 40, "entity_types": [golem]},
        },
        "sg:mode_hunt": {
            "minecraft:behavior.hurt_by_target": {"priority": 1, "entity_types": {"filters": not_kin}},
            "minecraft:behavior.nearest_attackable_target": {"priority": 2, "must_see": False, "reselect_targets": True,
                                                              "within_radius": 72, "scan_interval": 20, "entity_types": [anything]},
        },
        "sg:mode_peaceful": {"minecraft:behavior.random_look_around": {"priority": 9}},
    }


# Health multipliers the config wheel can pick (event sg:hp_<key>).
HP_TIERS = {"025": 0.25, "05": 0.5, "1": 1, "2": 2, "4": 4, "8": 8}


def entity_bp(ident, cfg):
    modes = list(mode_groups().keys())
    groups = {
        "sg:ai": ai_group(cfg["stroll"]),
        "sg:move": {"minecraft:movement": {"value": cfg["speed"]}},
        "sg:locked": {"minecraft:movement": {"value": 0.0}},
        "sg:sense": sensor(cfg["explosion"], cfg.get("kind", "shin_godzilla")),
        "sg:immune": IMMUNE,
        "sg:despawn": {"minecraft:instant_despawn": {}},
        "sg:size_full": {"minecraft:scale": {"value": 1.0}},
        "sg:size_half": {"minecraft:scale": {"value": 0.5}},
        "sg:size_quarter": {"minecraft:scale": {"value": 0.25}},
    }
    groups.update(mode_groups(cfg.get("kind", "shin_godzilla")))
    for key, k in HP_TIERS.items():
        if k != 1:
            hp = int(round(cfg["health"] * k))
            groups["sg:hp_" + key] = {"minecraft:health": {"value": hp, "max": hp}}
    init = ["sg:ai", "sg:move", "sg:sense", "sg:mode_hunt"]
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
    for key in HP_TIERS:
        events["sg:hp_" + key] = {"remove": {"component_groups": ["sg:hp_" + k for k, v in HP_TIERS.items() if k != key and v != 1]}}
        if HP_TIERS[key] != 1:
            events["sg:hp_" + key]["add"] = {"component_groups": ["sg:hp_" + key]}
    for size in ("full", "half", "quarter"):
        events["sg:size_" + size] = {"remove": {"component_groups": ["sg:size_" + x for x in ("full", "half", "quarter") if x != size]},
                                     "add": {"component_groups": ["sg:size_" + size]}}
    states = cfg["states"]
    props = {"sg:state": {"type": "enum", "values": states, "default": "walk", "client_sync": True}}
    if cfg.get("dormancy"):
        props["sg:glow"] = {"type": "int", "range": [0, 2], "default": 0, "client_sync": True}
        props["sg:aim"] = {"type": "int", "range": [-90, 90], "default": 0, "client_sync": True}
        props["sg:tail"] = {"type": "int", "range": [-45, 45], "default": 0, "client_sync": True}
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
                             "add": {"component_groups": ["sg:ai", "sg:move", "sg:mode_hunt"]}}
        events["sg:freeze"] = {"remove": {"component_groups": ["sg:ai", "sg:move", "sg:dormant", "sg:sense"] + modes},
                               "add": {"component_groups": ["sg:locked", "sg:frozen"]}}
        events["sg:thaw"] = {"remove": {"component_groups": ["sg:frozen", "sg:locked"]},
                             "add": {"component_groups": ["sg:ai", "sg:move", "sg:sense", "sg:mode_hunt"]}}
        events["sg:coagulant_hit"] = {"add": {"component_groups": ["sg:dormant"]}}
    if cfg.get("minus"):
        props["sg:glow"] = {"type": "int", "range": [0, 1], "default": 0, "client_sync": True}
        props["sg:aim"] = {"type": "int", "range": [-90, 90], "default": 0, "client_sync": True}
        props["sg:fins"] = {"type": "float", "range": [0.0, 40.0], "default": 0.0, "client_sync": True}   # how many fins have risen
    if cfg.get("evolves_into"):
        groups["sg:transform"] = {"minecraft:transformation": {"into": cfg["evolves_into"], "keep_level": True,
                                                               "drop_equipment": False, "delay": {"value": 0.0}}}
        events["sg:begin_evolve"] = {"remove": {"component_groups": ["sg:ai", "sg:move"]},
                                     "add": {"component_groups": ["sg:locked"]},
                                     "set_property": {"sg:state": "evolving"}}
        events["sg:evolve"] = {"add": {"component_groups": ["sg:transform"]}}

    comps = {
        "minecraft:type_family": {"family": family(cfg)},
        "minecraft:health": {"value": cfg["health"], "max": cfg["health"]},
        "minecraft:boss": {"hud_range": cfg["hud"], "name": cfg["boss_name"], "should_darken_sky": cfg.get("darken", False)},
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
        "minecraft:attack": {"damage": 2},
        "minecraft:follow_range": {"value": 64, "max": 96},
        "minecraft:persistent": {},
        "minecraft:nameable": {"always_show": False, "allow_name_tag_renaming": False},
        "minecraft:loot": {"table": "loot_tables/entities/%s.json" % ident.split(":")[1]},
        "minecraft:experience_reward": {"on_death": str(cfg["xp"])},
        "minecraft:conditional_bandwidth_optimization": {},
    }
    return {"format_version": "1.21.0", "minecraft:entity": {
        "description": {"identifier": ident, "is_spawnable": True, "is_summonable": True, "properties": props},
        "component_groups": groups, "components": comps, "events": events}}


# Boss bar names: plain text, because the custom bar in ui/hud_screen.json is shown by matching them.
BOSS = {F4: "Shin Godzilla", F4R: "Shin Godzilla Rampage", F3: "Shin Godzilla 3rd Form", F2: "Shin Godzilla 2nd Form",
        M1: "Godzilla Minus One", M0: "Godzilla Minus Zero"}


# Every state of the upright forms.  An enum property holds at most 16 values, so the smoke and
# the fire of the breath share one ("smoke": same pose; the script knows which it is).
BIG_STATES = ["walk", "roar", "charge", "smoke", "focus", "beam", "dorsal", "tail", "leap", "land", "bite", "sweep",
              "dormant", "frozen", "waking", "dying"]
assert len(BIG_STATES) <= 16


def build_behavior():
    write(os.path.join(BP, "entities/shin_godzilla.json"), entity_bp(F4, dict(
        health=2000, box=(4.0, 12.0), hit=(12, 44), speed=0.2, swim=0.12, attack=30, stroll=32, explosion=1.6,
        hud=128, boss_name=BOSS[F4], darken=True, xp=500, dormancy=True,
        states=BIG_STATES)))
    write(os.path.join(BP, "entities/shin_godzilla_rampage.json"), entity_bp(F4R, dict(
        health=3000, box=(4.0, 12.0), hit=(12, 44), speed=0.24, swim=0.14, attack=40, stroll=40, explosion=1.2,
        hud=160, boss_name=BOSS[F4R], darken=True, xp=800, dormancy=True, extra_family=["rampage"],
        states=BIG_STATES)))
    write(os.path.join(BP, "entities/shin_godzilla_3.json"), entity_bp(F3, dict(
        health=650, box=(2.6, 8.0), hit=(7, 22), speed=0.18, swim=0.12, attack=18, stroll=24, explosion=1.3,
        hud=96, boss_name=BOSS[F3], xp=200, evolves_into=F4,
        states=["walk", "roar", "evolving", "dying"])))
    write(os.path.join(BP, "entities/shin_godzilla_2.json"), entity_bp(F2, dict(
        health=320, box=(3.2, 4.0), hit=(9, 9), speed=0.13, swim=0.16, attack=10, stroll=20, explosion=1.2,
        hud=80, boss_name=BOSS[F2], xp=100, evolves_into=F3,
        states=["walk", "roar", "evolving", "dying"])))

    write(os.path.join(BP, "entities/godzilla_minus_one.json"), entity_bp(M1, dict(
        health=1800, box=(3.6, 10.0), hit=(10, 34), speed=0.2, swim=0.2, attack=30, stroll=30, explosion=1.4,
        hud=128, boss_name=BOSS[M1], xp=500, minus=True, kind="minus_godzilla", states=BIG_STATES)))
    write(os.path.join(BP, "entities/godzilla_minus_zero.json"), entity_bp(M0, dict(
        health=2800, box=(3.8, 11.0), hit=(11, 37), speed=0.22, swim=0.22, attack=40, stroll=34, explosion=1.2,
        hud=144, boss_name=BOSS[M0], darken=True, xp=800, minus=True, kind="minus_godzilla", states=BIG_STATES)))

    for name, lo, hi in (("shin_godzilla", 4, 8), ("shin_godzilla_rampage", 8, 12), ("shin_godzilla_3", 2, 4), ("shin_godzilla_2", 1, 2),
                         ("godzilla_minus_one", 4, 8), ("godzilla_minus_zero", 8, 12)):
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
    write(os.path.join(BP, "items/config_wheel.json"), item("sg:config_wheel", "Shin Godzilla Config Wheel", "sg_wheel", 1, "equipment"))

    unlock = {"context": "AlwaysUnlocked"}
    write(os.path.join(BP, "recipes/yashiori_coagulant.json"), {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
        "description": {"identifier": "sg:yashiori_coagulant"}, "tags": ["crafting_table"], "unlock": unlock,
        "ingredients": [{"item": "sg:g_cell"}, {"item": "minecraft:glass_bottle"}, {"item": "minecraft:snowball"}, {"item": "minecraft:slime_ball"}],
        "result": {"item": "sg:yashiori_coagulant", "count": 2}}})
    write(os.path.join(BP, "recipes/yashiori_coagulant_alt.json"), {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
        "description": {"identifier": "sg:yashiori_coagulant_alt"}, "tags": ["crafting_table"], "unlock": unlock,
        "ingredients": [{"item": "minecraft:glass_bottle"}, {"item": "minecraft:blue_ice"}, {"item": "minecraft:slime_ball"}, {"item": "minecraft:redstone"}],
        "result": {"item": "sg:yashiori_coagulant", "count": 1}}})
    write(os.path.join(BP, "recipes/config_wheel.json"), {"format_version": "1.20.10", "minecraft:recipe_shaped": {
        "description": {"identifier": "sg:config_wheel"}, "tags": ["crafting_table"], "unlock": unlock,
        "pattern": [" I ", "IAI", " I "],
        "key": {"I": {"item": "minecraft:iron_ingot"}, "A": {"item": "minecraft:amethyst_shard"}},
        "result": {"item": "sg:config_wheel", "count": 1}}})
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
    for f in ("egg_2.png", "egg_3.png", "egg_4.png", "egg_4r.png", "egg_m1.png", "egg_m0.png"):
        src = os.path.join(ASSETS, f)
        shutil.copy(src if os.path.exists(src) else os.path.join(ASSETS, "egg_4.png"), os.path.join(RP, "textures/items/sg", f))
    write(os.path.join(RP, "textures/item_texture.json"), {"resource_pack_name": "kaijus_srelz_pack", "texture_name": "atlas.items", "texture_data": {
        "sg_coagulant": {"textures": "textures/items/sg/yashiori_coagulant"},
        "sg_g_cell": {"textures": "textures/items/sg/g_cell"},
        "sg_tablet": {"textures": "textures/items/sg/kaiju_tablet"},
        "sg_wheel": {"textures": "textures/items/sg/config_wheel"},
        "sg_egg_2": {"textures": "textures/items/sg/egg_2"},
        "sg_egg_3": {"textures": "textures/items/sg/egg_3"},
        "sg_egg_4": {"textures": "textures/items/sg/egg_4"},
        "sg_egg_4r": {"textures": "textures/items/sg/egg_4r"},
        "sg_egg_m1": {"textures": "textures/items/sg/egg_m1"},
        "sg_egg_m0": {"textures": "textures/items/sg/egg_m0"},
    }})
    # the boss bar: our own frame and fill drawn over the vanilla one whenever the boss is one of ours.
    # It is added to the vanilla panel as a modification, so another pack's boss bar can live beside it.
    fx.make_ui_textures(os.path.join(RP, "textures/ui"))

    def boss_bar(frame, fill, names, colour):
        collection = {"binding_type": "collection", "binding_collection_name": "boss_bars"}
        return {
            "type": "panel", "size": [182, 20], "anchor_from": "top_middle", "anchor_to": "top_middle", "layer": 50,
            "controls": [
                {"frame": {"type": "image", "texture": "textures/ui/" + frame, "size": [182, 20], "layer": 1}},
                {"fill": {"type": "image", "texture": "textures/ui/" + fill, "size": [170, 6], "anchor_from": "top_left", "anchor_to": "top_left",
                          "offset": [6, 12], "layer": 2, "clip_direction": "left", "clip_pixelperfect": False,
                          "bindings": [dict(collection, binding_name="#progress_percentage", binding_name_override="#clip_ratio")]}},
                {"name": {"type": "label", "text": "#bossName", "color": colour, "shadow": True, "anchor_from": "top_middle", "anchor_to": "top_middle",
                          "offset": [0, 2], "layer": 3, "bindings": [dict(collection, binding_name="#bossName")]}},
            ],
            "bindings": [dict(collection, binding_name="#bossName"),
                         {"binding_type": "view", "source_property_name": "(" + " or ".join("(#bossName = '%s')" % n for n in names) + ")",
                          "target_property_name": "#visible"}],
        }
    write(os.path.join(RP, "ui/hud_screen.json"), {
        "namespace": "hud",
        "boss_health_panel": {"modifications": [{"array_name": "controls", "operation": "insert_back", "value": [
            {"sg_boss_bar@hud.sg_boss_bar": {}}, {"sg_boss_bar_rampage@hud.sg_boss_bar_rampage": {}},
            {"sg_boss_bar_minus@hud.sg_boss_bar_minus": {}}]}]},
        "sg_boss_bar": boss_bar("sg_boss_frame", "sg_boss_fill", [BOSS[F4], BOSS[F3], BOSS[F2]], [0.93, 0.74, 1.0]),
        "sg_boss_bar_rampage": boss_bar("sg_boss_frame_rampage", "sg_boss_fill_rampage", [BOSS[F4R]], [1.0, 0.62, 0.5]),
        "sg_boss_bar_minus": boss_bar("sg_boss_frame_minus", "sg_boss_fill_minus", [BOSS[M1], BOSS[M0]], [0.72, 0.9, 1.0]),
    })
    # the air itself changes while he fires: ember dusk under the fire, violet night under the beam
    for name, air in (("fire_fog", "#3a1606"), ("atomic_fog", "#1d0b33"), ("heat_fog", "#0a1c3c"), ("ash_fog", "#3b3733")):
        write(os.path.join(RP, "fogs/sg_%s.json" % name), {"format_version": "1.16.100", "minecraft:fog_settings": {
            "description": {"identifier": "sg:" + name},
            "distance": {"air": {"fog_start": 0.12, "fog_end": 0.92, "fog_color": air, "render_distance_type": "render"},
                         "weather": {"fog_start": 0.1, "fog_end": 0.85, "fog_color": air, "render_distance_type": "render"}}}})
    # sounds
    sdir = os.path.join(RP, "sounds/sg")
    if not (FAST and os.path.isdir(sdir)):
        sounds.build_all(sdir)
    loud = {"roar4": 320, "roar3": 160, "roar2": 128, "growl": 128, "step": 160, "land": 256, "leap": 128, "bite": 128, "sweep": 160,
            "breath_smoke": 256, "breath_fire": 288, "breath_focus": 288, "breath_beam": 320, "rays": 288, "tail_ray": 288,
            "impact": 256, "ignite": 320, "surge": 128, "rumble": 200,
            "crash": 128, "charge": 256, "evolve": 128, "freeze": 128, "dormant": 64, "coagulant": 32, "hurt": 96,
            "roar_m": 320, "fin": 160, "heat_charge": 256, "inhale": 256, "heat_ray": 320, "nuke": 512}
    defs = {}
    for name in sounds.ALL:
        defs["sg." + name] = {"category": "hostile", "min_distance": 12.0 if loud.get(name, 64) >= 128 else 4.0, "max_distance": float(loud.get(name, 64)),
                              "sounds": [{"name": "sounds/sg/" + name, "volume": 1.0, "load_on_low_memory": True}]}
    write(os.path.join(RP, "sounds/sound_definitions.json"), {"format_version": "1.20.20", "sound_definitions": defs})
    write(os.path.join(RP, "sounds.json"), {"entity_sounds": {"entities": {
        F4: {"volume": 1.0, "pitch": [0.9, 1.05], "events": {"hurt": {"sound": "sg.hurt", "volume": 2.0}, "death": {"sound": "sg.roar4", "volume": 4.0}}},
        F4R: {"volume": 1.0, "pitch": [0.85, 0.98], "events": {"hurt": {"sound": "sg.hurt", "volume": 2.0}, "death": {"sound": "sg.roar4", "volume": 4.0}}},
        M1: {"volume": 1.0, "pitch": [0.95, 1.05], "events": {"hurt": {"sound": "sg.growl", "volume": 2.0, "pitch": 1.5}, "death": {"sound": "sg.roar_m", "volume": 4.0}}},
        M0: {"volume": 1.0, "pitch": [0.82, 0.9], "events": {"hurt": {"sound": "sg.growl", "volume": 2.0, "pitch": 1.3}, "death": {"sound": "sg.roar_m", "volume": 4.0}}},
        F3: {"volume": 1.0, "pitch": [1.0, 1.15], "events": {"hurt": {"sound": "sg.hurt", "volume": 1.5, "pitch": 1.2}, "death": {"sound": "sg.roar3", "volume": 3.0}}},
        F2: {"volume": 1.0, "pitch": [1.05, 1.2], "events": {"hurt": {"sound": "sg.hurt", "volume": 1.2, "pitch": 1.35}, "death": {"sound": "sg.roar2", "volume": 2.0}}},
    }}})
    # language
    lang = "\n".join([
        "entity.sg:shin_godzilla.name=Shin Godzilla",
        "item.sg:config_wheel=Shin Godzilla Config Wheel",
        "entity.sg:shin_godzilla_rampage.name=Shin Godzilla (Rampage)",
        "item.spawn_egg.entity.sg:shin_godzilla_rampage.name=Spawn Shin Godzilla - RAMPAGE (never goes dormant)",
        "entity.sg:godzilla_minus_one.name=Godzilla Minus One",
        "entity.sg:godzilla_minus_zero.name=Godzilla Minus Zero",
        "item.spawn_egg.entity.sg:godzilla_minus_one.name=Spawn Godzilla Minus One",
        "item.spawn_egg.entity.sg:godzilla_minus_zero.name=Spawn Godzilla Minus Zero",
        "entity.sg:shin_godzilla_3.name=Shin Godzilla (3rd Form)",
        "entity.sg:shin_godzilla_2.name=Shin Godzilla (2nd Form)",
        "item.spawn_egg.entity.sg:shin_godzilla.name=Spawn Shin Godzilla (4th Form)",
        "item.spawn_egg.entity.sg:shin_godzilla_3.name=Spawn Shin Godzilla (3rd Form)",
        "item.spawn_egg.entity.sg:shin_godzilla_2.name=Spawn Shin Godzilla (2nd Form)",
        "action.interact.sg.inject=Inject Coagulant",
        "pack.name=Kaijus Srelz Pack",
        "pack.description=Shin Godzilla, Godzilla Minus One and Godzilla Minus Zero",
        "",
    ])
    write(os.path.join(RP, "texts/en_US.lang"), lang)
    write(os.path.join(RP, "texts/languages.json"), ["en_US"])
    # script + generated anchors
    os.makedirs(os.path.join(BP, "scripts"), exist_ok=True)
    for fn in sorted(os.listdir(os.path.join(HERE, "scripts"))):
        if fn.endswith(".js"):
            shutil.copy(os.path.join(HERE, "scripts", fn), os.path.join(BP, "scripts", fn))
    write(os.path.join(BP, "scripts/anchors.js"),
          "// Generated by build.py from the model + animation poses. Do not edit.\nexport const ANCHORS = " +
          json.dumps(anchors, indent=1) + ";\n")
    # pack icons
    shutil.copy(os.path.join(ASSETS, "pack_icon.png"), os.path.join(BP, "pack_icon.png"))
    shutil.copy(os.path.join(ASSETS, "pack_icon.png"), os.path.join(RP, "pack_icon.png"))


def build_manifests():
    bp_h, rp_h = uid("bp-header"), uid("rp-header")
    desc = "Kaijus for Minecraft Bedrock: Shin Godzilla in all its forms, Godzilla Minus One and Godzilla Minus Zero, with their beams, duels and cinematics."
    write(os.path.join(BP, "manifest.json"), {
        "format_version": 2,
        "header": {"name": PACK + " (Behavior)", "description": desc, "uuid": bp_h, "version": VERSION, "min_engine_version": MIN_ENGINE},
        "modules": [{"type": "data", "uuid": uid("bp-data"), "version": VERSION},
                    {"type": "script", "language": "javascript", "uuid": uid("bp-script"), "entry": "scripts/main.js", "version": VERSION}],
        "dependencies": [{"uuid": rp_h, "version": VERSION},
                         {"module_name": "@minecraft/server", "version": "2.0.0"},
                         {"module_name": "@minecraft/server-ui", "version": "2.0.0"}],
    })
    write(os.path.join(RP, "manifest.json"), {
        "format_version": 2,
        "header": {"name": PACK + " (Resources)", "description": desc, "uuid": rp_h, "version": VERSION, "min_engine_version": MIN_ENGINE},
        "modules": [{"type": "resources", "uuid": uid("rp-res"), "version": VERSION}],
        "dependencies": [{"uuid": bp_h, "version": VERSION}],
    })


def _zip(out, bp, rp):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for src, arc in ((bp, PACK + " BP"), (rp, PACK + " RP")):
            for dp, _, files in os.walk(src):
                for fn in sorted(files):
                    full = os.path.join(dp, fn)
                    z.write(full, os.path.join(arc, os.path.relpath(full, src)))
    print("packaged", out, "%.1f MB" % (os.path.getsize(out) / 1e6))


def package():
    os.makedirs(DIST, exist_ok=True)
    for old in ("ShinGodzilla.mcaddon",):
        if os.path.exists(os.path.join(DIST, old)):
            os.remove(os.path.join(DIST, old))
    _zip(os.path.join(DIST, "KaijusSrelzPack.mcaddon"), BP, RP)
    # If the user's own film audio is present (src/user_audio, never committed), also build a
    # private copy that uses it. Same packs, same timing; only the sound files differ.
    film = sounds.film_sounds(os.path.join(HERE, "user_audio"))
    if film:
        local = os.path.join(ROOT, "local")
        rp2 = os.path.join(local, "resource_pack")
        shutil.rmtree(local, ignore_errors=True)
        shutil.copytree(RP, rp2)
        for name, x in film.items():
            sounds.write_ogg(x, os.path.join(rp2, "sounds/sg", name + ".ogg"))
        _zip(os.path.join(local, "KaijusSrelzPack-%d.%d.%d.mcaddon" % tuple(VERSION)), BP, rp2)
        shutil.rmtree(rp2)
        print("film audio used for:", ", ".join(sorted(film)))


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
