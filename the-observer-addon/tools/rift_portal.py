#!/usr/bin/env python3
"""The rift itself (1.6.0): the tear that opens in the world, and the Rift's weather. All original, drawn here.

  the portal     observer:rift_portal — a tall oval of void, five blocks wide and seven high: deep purple swirling round
                 a dark middle, full of stars that come and go (eight frames), torn at its edge, crimson veins running
                 in from the rim, a soft violet glow round it; now and then a crimson eye opens in the middle of it and
                 looks at you. It turns to face whoever is nearest (scripts), grows from a crack when it opens and
                 closes back into one.
  particles      sparks thrown off its rim, motes drifting round it, the burst when it tears open or shuts, the Rift's
                 rain (it stops at roofs), embers rising from the ground there
  fog            observer:rift — the Rift's mist (close, grey-violet)

Writes RP textures/entity/rift_portal/*.png, models/entity/rift_portal.geo.json, entity/rift_portal.entity.json,
render_controllers, animations, animation_controllers, particles/rift_*.json, textures/particle/observer/rift_*.png,
fogs/rift.json, and BP entities/rift_portal.json. Safe to re-run.
"""
import json
import math
import os
import random

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
RP = os.path.join(ROOT, "packs", "TheObserver_RP")
W, H = 80, 112          # the void's texture, one pixel to a model pixel (5 x 7 blocks)
CX, CY = 39.5, 55.5
RX, RY = 38.0, 54.0
FRAMES = 8


def out(*parts):
    p = os.path.join(*parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def dump(obj, *parts):
    with open(out(*parts), "w") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


# ----------------------------------------------------------------------------- the shape: an oval, torn at its edge

rng = random.Random(16600)
TEAR = [rng.uniform(-1.0, 1.0) for _ in range(64)]


def edge_r(ang):
    """How far out the edge is at this angle (1 = on the oval), torn: a little in and out."""
    k = ((ang % math.tau) / math.tau) * len(TEAR)
    i = int(k) % len(TEAR)
    f = k - int(k)
    v = TEAR[i] * (1 - f) + TEAR[(i + 1) % len(TEAR)] * f
    return 1.0 + 0.035 * v + 0.02 * math.sin(ang * 9)


def polar(x, y):
    dx, dy = (x - CX) / RX, (y - CY) / RY
    return math.hypot(dx, dy), math.atan2(dy, dx)


STARS = [(rng.uniform(4, W - 4), rng.uniform(4, H - 4), rng.random(), rng.random()) for _ in range(90)]
VEINS = []
for _ in range(7):
    a = rng.uniform(0, math.tau)
    pts = []
    r = 1.0
    ang = a
    while r > 0.55:
        pts.append((CX + math.cos(ang) * RX * r, CY + math.sin(ang) * RY * r))
        r -= rng.uniform(0.03, 0.06)
        ang += rng.uniform(-0.12, 0.12)
    VEINS.append(pts)


def void_frame(f):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    ph = f / FRAMES * math.tau
    for y in range(H):
        for x in range(W):
            r, ang = polar(x + 0.5, y + 0.5)
            e = edge_r(ang)
            if r > e:
                continue
            rr = r / e
            # deep in the middle, violet toward the rim
            base = lerp((8, 3, 16), (58, 14, 98), min(1, rr ** 1.6))
            # the swirl: arms turning round the middle
            sw = 0.5 + 0.5 * math.sin(3 * ang + 7.5 * rr - ph)
            arm = sw ** 3 * (0.25 + 0.75 * rr) * (1 - rr ** 6)
            c = lerp(base, (150, 70, 230), arm * 0.55)
            # the rim: bright, a band two pixels wide
            if rr > 0.93:
                c = lerp(c, (226, 180, 255), (rr - 0.93) / 0.07)
            px[x, y] = c + (255,)
    # crimson veins running in from the rim, pulsing
    pulse = 0.55 + 0.45 * math.sin(ph)
    for pts in VEINS:
        for i, (vx, vy) in enumerate(pts):
            x, y = int(vx), int(vy)
            if 0 <= x < W and 0 <= y < H and px[x, y][3]:
                t = (1 - i / max(1, len(pts))) * pulse
                px[x, y] = lerp(px[x, y][:3], (200, 16, 40), 0.35 + 0.6 * t) + (255,)
    # stars, coming and going
    for (sx, sy, tw, big) in STARS:
        x, y = int(sx), int(sy)
        r, ang = polar(x + 0.5, y + 0.5)
        if r > edge_r(ang) * 0.9:
            continue
        b = 0.5 + 0.5 * math.sin(ph * (1 + int(tw * 3)) + tw * math.tau)
        if b < 0.25:
            continue
        col = lerp((120, 90, 200), (255, 250, 255), b)
        px[x, y] = col + (255,)
        if big > 0.82 and b > 0.6:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if 0 <= x + dx < W and 0 <= y + dy < H and px[x + dx, y + dy][3]:
                    px[x + dx, y + dy] = lerp(px[x + dx, y + dy][:3], col, 0.6) + (255,)
    return img


def halo():
    """The glow round it: drawn on the halo plane (112 x 144 model pixels mapped onto this 80 x 112 texture)."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    # this plane is 112/80 wide and 144/112 tall of the void: the oval sits in its middle at that scale
    sx, sy = 112 / 80, 144 / 112
    for y in range(H):
        for x in range(W):
            mx = (x + 0.5) / W * 112 - 56 + 40
            my = (y + 0.5) / H * 144 - 72 + 56
            r, ang = polar(mx, my)
            e = edge_r(ang)
            d = r - e
            if d < -0.06:
                continue
            a = math.exp(-max(0, d) * 7.5) * (0.9 if d > 0 else (1 + d / 0.06))
            col = lerp((170, 90, 255), (220, 40, 80), max(0, math.sin(ang)) * 0.45)
            px[x, y] = col + (int(255 * max(0, min(1, a)) * 0.85),)
    return img


def eye():
    """A crimson eye in the middle of it, a slit for a pupil (its scale opens and shuts it)."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    ew, eh = 17.0, 6.5
    for y in range(H):
        for x in range(W):
            dx, dy = (x + 0.5 - CX) / ew, (y + 0.5 - CY) / eh
            # an almond: narrower toward its corners
            lim = (1 - dx * dx)
            if lim <= 0 or dy * dy > lim * lim:
                continue
            r = math.hypot(x + 0.5 - CX, (y + 0.5 - CY) * 1.6)
            if r < 6.5:
                col = (255, 40, 50) if r > 4.8 else (200, 12, 24)
                if abs(x + 0.5 - CX) < 1.1:
                    col = (8, 0, 4)
            else:
                col = lerp((150, 10, 30), (60, 0, 12), min(1, (r - 6.5) / 9))
            px[x, y] = col + (240,)
    # a glint
    for (x, y) in ((int(CX) - 3, int(CY) - 2), (int(CX) - 2, int(CY) - 2)):
        px[x, y] = (255, 230, 235, 255)
    return img


def spark_sheet():
    img = Image.new("RGBA", (32, 8), (0, 0, 0, 0))
    px = img.load()
    shapes = [
        [(3, 3), (4, 3), (3, 4), (4, 4), (2, 3), (5, 4), (3, 2), (4, 5)],              # a soft dot
        [(3, 1), (3, 2), (3, 4), (3, 5), (1, 3), (2, 3), (4, 3), (5, 3), (3, 3)],      # a four-point star
        [(3, 3), (4, 4), (2, 2), (5, 5), (2, 5), (5, 2)],                              # a cross
        [(3, 3), (4, 3), (3, 4), (4, 4)],                                              # a speck
    ]
    for i, pts in enumerate(shapes):
        for (x, y) in pts:
            a = 255 if (x, y) in ((3, 3), (4, 4), (3, 4), (4, 3)) else 170
            px[i * 8 + x, y] = (255, 255, 255, a)
    return img


def rain():
    img = Image.new("RGBA", (2, 32), (0, 0, 0, 0))
    px = img.load()
    for y in range(32):
        a = int(200 * math.sin(math.pi * y / 31))
        for x in range(2):
            px[x, y] = (210, 215, 235, a if x == 0 else a // 2)
    return img


# ----------------------------------------------------------------------------- the entity

def geometry():
    def plane(origin, size, z):
        return {"origin": [origin[0], origin[1], z], "size": [size[0], size[1], 0],
                "uv": {"north": {"uv": [0, 0], "uv_size": [W, H]}, "south": {"uv": [W, 0], "uv_size": [-W, H]}}}
    return {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.observer.rift_portal", "texture_width": W, "texture_height": H,
                        "visible_bounds_width": 10, "visible_bounds_height": 11, "visible_bounds_offset": [0, 4, 0]},
        "bones": [
            {"name": "root", "pivot": [0, 0, 0]},
            {"name": "halo", "parent": "root", "pivot": [0, 64, 0],
             "cubes": [plane([-56, -8], [112, 144], -0.06), plane([-56, -8], [112, 144], 0.06)]},
            {"name": "void", "parent": "root", "pivot": [0, 64, 0], "cubes": [plane([-40, 8], [80, 112], 0)]},
            {"name": "eye", "parent": "root", "pivot": [0, 64, 0],
             "cubes": [plane([-40, 8], [80, 112], -0.3), plane([-40, 8], [80, 112], 0.3)],
             "locators": {"center": [0, 64, 0]}},
        ]}]}


def client_entity():
    tex = {f"f{i}": f"textures/entity/rift_portal/void_{i}" for i in range(FRAMES)}
    tex.update({"halo": "textures/entity/rift_portal/halo", "eye": "textures/entity/rift_portal/eye"})
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "observer:rift_portal",
        "materials": {"void": "entity_alphatest", "halo": "entity_alphablend", "eye": "entity_alphablend"},
        "textures": tex,
        "geometry": {"default": "geometry.observer.rift_portal"},
        "render_controllers": ["controller.render.observer.rift_portal_halo", "controller.render.observer.rift_portal_void",
                               "controller.render.observer.rift_portal_eye"],
        "animations": {"grow": "animation.observer.rift_portal.grow", "full": "animation.observer.rift_portal.full",
                       "shrink": "animation.observer.rift_portal.shrink", "idle": "animation.observer.rift_portal.idle",
                       "phase": "controller.animation.observer.rift_portal.phase"},
        "scripts": {"animate": ["idle", "phase"]},
        "particle_effects": {"sparks": "observer:rift_sparks", "motes": "observer:rift_motes"},
        "enable_attachables": False}}}


def render_controllers():
    rc = {}
    rc["controller.render.observer.rift_portal_void"] = {
        "arrays": {"textures": {"Array.frames": [f"Texture.f{i}" for i in range(FRAMES)]}},
        "geometry": "Geometry.default", "materials": [{"*": "Material.void"}],
        "textures": [f"Array.frames[math.mod(math.floor(q.life_time * 7), {FRAMES})]"],
        "ignore_lighting": True, "part_visibility": [{"*": False}, {"void": True}]}
    rc["controller.render.observer.rift_portal_halo"] = {
        "geometry": "Geometry.default", "materials": [{"*": "Material.halo"}], "textures": ["Texture.halo"],
        "ignore_lighting": True, "part_visibility": [{"*": False}, {"halo": True}]}
    rc["controller.render.observer.rift_portal_eye"] = {
        "geometry": "Geometry.default", "materials": [{"*": "Material.eye"}], "textures": ["Texture.eye"],
        "ignore_lighting": True, "part_visibility": [{"*": False}, {"eye": True}]}
    return {"format_version": "1.8.0", "render_controllers": rc}


def animations():
    a = {}
    a["animation.observer.rift_portal.grow"] = {"animation_length": 6.0, "loop": "hold_on_last_frame", "bones": {"root": {"scale": {
        "0.0": [0.03, 0.2, 1], "1.2": [0.06, 0.75, 1], "3.0": [0.35, 0.92, 1], "4.8": [0.85, 1.0, 1], "6.0": [1, 1, 1]}}}}
    a["animation.observer.rift_portal.full"] = {"loop": True, "bones": {"root": {"scale": [1, 1, 1]}}}
    a["animation.observer.rift_portal.shrink"] = {"animation_length": 1.6, "loop": "hold_on_last_frame", "bones": {"root": {"scale": {
        "0.0": [1, 1, 1], "0.5": [1.1, 1.04, 1], "1.3": [0.05, 0.5, 1], "1.6": [0, 0, 0]}}}}
    a["animation.observer.rift_portal.idle"] = {"loop": True, "animation_length": 2.0, "bones": {
        "halo": {"scale": ["1 + math.sin(q.life_time * 150) * 0.045", "1 + math.sin(q.life_time * 150) * 0.03", 1]},
        "void": {"rotation": [0, 0, "math.sin(q.life_time * 40) * 1.2"]},
        # the eye opens now and then (about every nine seconds), and looks
        "eye": {"scale": [1, "math.clamp(math.sin(q.life_time * 40) * 3.2 - 2.2, 0, 1)", 1],
                "position": ["math.sin(q.life_time * 90) * 2", 0, 0]}},
        "particle_effects": {"0.0": {"effect": "sparks", "locator": "center"}, "0.05": {"effect": "motes", "locator": "center"}}}
    return {"format_version": "1.8.0", "animations": a}


def animation_controller():
    ph = "q.property('observer:phase')"
    return {"format_version": "1.10.0", "animation_controllers": {"controller.animation.observer.rift_portal.phase": {
        "initial_state": "start",
        "states": {
            "start": {"transitions": [{"opening": f"{ph} == 0"}, {"open": f"{ph} == 1"}, {"closing": f"{ph} == 2"}]},
            "opening": {"animations": ["grow"], "transitions": [{"open": f"{ph} == 1 && q.all_animations_finished"}, {"closing": f"{ph} == 2"}]},
            "open": {"animations": ["full"], "transitions": [{"closing": f"{ph} == 2"}]},
            "closing": {"animations": ["shrink"]}}}}}


def behavior_entity():
    return {"format_version": "1.21.90", "minecraft:entity": {
        "description": {"identifier": "observer:rift_portal", "is_spawnable": False, "is_summonable": True,
                        "properties": {"observer:phase": {"type": "int", "range": [0, 2], "default": 0, "client_sync": True}}},
        "components": {
            "minecraft:type_family": {"family": ["observer_rift_portal", "inanimate"]},
            "minecraft:collision_box": {"width": 0.5, "height": 0.5},
            "minecraft:physics": {"has_gravity": False, "has_collision": False},
            "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
            "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
            "minecraft:knockback_resistance": {"value": 1.0},
            "minecraft:fire_immune": {},
            "minecraft:persistent": {},
            "minecraft:conditional_bandwidth_optimization": {}}}}


# ----------------------------------------------------------------------------- particles

def particle(ident, tex, material, comps):
    return {"format_version": "1.10.0", "particle_effect": {
        "description": {"identifier": ident, "basic_render_parameters": {"material": material, "texture": tex}},
        "components": comps}}


SPARK_UV = {"texture_width": 32, "texture_height": 8, "uv": ["math.floor(v.particle_random_1 * 4) * 8", 0], "uv_size": [8, 8]}


def particles():
    p = {}
    # thrown off its rim: violet and crimson, glowing, drifting out and up (in its own frame, so they follow it round)
    p["rift_sparks"] = particle("observer:rift_sparks", "textures/particle/observer/rift_spark", "particles_add", {
        "minecraft:emitter_local_space": {"position": True, "rotation": True},
        "minecraft:emitter_rate_steady": {"spawn_rate": 34, "max_particles": 120},
        "minecraft:emitter_lifetime_once": {"active_time": 2.0},
        "minecraft:emitter_shape_custom": {
            "offset": ["math.cos(v.emitter_random_1 * 360 + v.particle_random_4 * 360) * 2.45",
                       "math.sin(v.emitter_random_1 * 360 + v.particle_random_4 * 360) * 3.45", 0],
            "direction": ["math.cos(v.particle_random_4 * 360) * 0.6", "math.sin(v.particle_random_4 * 360) * 0.6 + 0.4", "math.random(-0.6, 0.6)"]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.9, 1.8)"},
        "minecraft:particle_initial_speed": "math.random(0.4, 1.3)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.25, 0], "linear_drag_coefficient": 0.6},
        "minecraft:particle_appearance_billboard": {"size": ["0.07 + v.particle_random_2 * 0.08", "0.07 + v.particle_random_2 * 0.08"],
                                                     "facing_camera_mode": "rotate_xyz", "uv": SPARK_UV},
        # violet mostly, crimson some, fading as they go
        "minecraft:particle_appearance_tinting": {"color": [
            "v.particle_random_3 > 0.7 ? 1.0 : 0.78", "v.particle_random_3 > 0.7 ? 0.16 : 0.48", "v.particle_random_3 > 0.7 ? 0.28 : 1.0",
            "1 - v.particle_age / v.particle_lifetime"]},
    })
    # big soft motes drifting round it
    p["rift_motes"] = particle("observer:rift_motes", "textures/particle/observer/rift_spark", "particles_add", {
        "minecraft:emitter_local_space": {"position": True, "rotation": True},
        "minecraft:emitter_rate_steady": {"spawn_rate": 6, "max_particles": 30},
        "minecraft:emitter_lifetime_once": {"active_time": 2.0},
        "minecraft:emitter_shape_box": {"offset": [0, 0, 0], "half_dimensions": [3.2, 4.2, 1.2], "surface_only": False},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(2.0, 3.5)"},
        "minecraft:particle_initial_speed": 0.15,
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.05, 0]},
        "minecraft:particle_appearance_billboard": {"size": ["0.22 + v.particle_random_2 * 0.2", "0.22 + v.particle_random_2 * 0.2"],
                                                     "facing_camera_mode": "rotate_xyz",
                                                     "uv": {"texture_width": 32, "texture_height": 8, "uv": [0, 0], "uv_size": [8, 8]}},
        "minecraft:particle_appearance_tinting": {"color": [0.6, 0.3, 1.0, "math.sin(v.particle_age / v.particle_lifetime * 180) * 0.55"]},
    })
    # torn open, or shut: a burst of violet shards
    p["rift_burst"] = particle("observer:rift_burst", "textures/particle/observer/rift_spark", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 90},
        "minecraft:emitter_lifetime_once": {"active_time": 0.1},
        "minecraft:emitter_shape_box": {"offset": [0, 3.5, 0], "half_dimensions": [1.2, 3.5, 1.2], "surface_only": False, "direction": "outwards"},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.6, 1.6)"},
        "minecraft:particle_initial_speed": "math.random(3, 9)",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 3.5, "linear_acceleration": [0, -1.5, 0]},
        "minecraft:particle_appearance_billboard": {"size": ["0.1 + v.particle_random_2 * 0.14", "0.1 + v.particle_random_2 * 0.14"],
                                                     "facing_camera_mode": "rotate_xyz", "uv": SPARK_UV},
        "minecraft:particle_appearance_tinting": {"color": ["v.particle_random_3 > 0.75 ? 1.0 : 0.72", "v.particle_random_3 > 0.75 ? 0.15 : 0.42",
                                                            "v.particle_random_3 > 0.75 ? 0.25 : 1.0", "1 - v.particle_age / v.particle_lifetime"]},
    })
    # the Rift's rain, round each player there: it falls hard and stops at whatever it hits (roofs keep it off)
    p["rift_rain"] = particle("observer:rift_rain", "textures/particle/observer/rift_rain", "particles_blend", {
        "minecraft:emitter_rate_steady": {"spawn_rate": 260, "max_particles": 400},
        "minecraft:emitter_lifetime_once": {"active_time": 1.05},
        "minecraft:emitter_shape_box": {"offset": [0, 11, 0], "half_dimensions": [13, 1.5, 13], "surface_only": False, "direction": [0, -1, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 1.1},
        "minecraft:particle_initial_speed": 22,
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0.6, 0, 0.3]},
        "minecraft:particle_motion_collision": {"collision_radius": 0.05, "expire_on_contact": True},
        "minecraft:particle_appearance_billboard": {"size": [0.025, 0.55], "facing_camera_mode": "lookat_y",
                                                     "uv": {"texture_width": 2, "texture_height": 32, "uv": [0, 0], "uv_size": [2, 32]}},
        "minecraft:particle_appearance_tinting": {"color": [0.72, 0.74, 0.86, 0.55]},
    })
    # embers rising from the ground there, now and then
    p["rift_embers"] = particle("observer:rift_embers", "textures/particle/observer/rift_spark", "particles_add", {
        "minecraft:emitter_rate_steady": {"spawn_rate": 5, "max_particles": 20},
        "minecraft:emitter_lifetime_once": {"active_time": 1.05},
        "minecraft:emitter_shape_box": {"offset": [0, 0, 0], "half_dimensions": [10, 2, 10], "surface_only": False},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(2.5, 4.5)"},
        "minecraft:particle_initial_speed": 0.1,
        "minecraft:particle_motion_dynamic": {"linear_acceleration": ["math.sin(v.particle_age * 90) * 0.2", 0.18, 0]},
        "minecraft:particle_appearance_billboard": {"size": [0.06, 0.06], "facing_camera_mode": "rotate_xyz",
                                                     "uv": {"texture_width": 32, "texture_height": 8, "uv": [24, 0], "uv_size": [8, 8]}},
        "minecraft:particle_appearance_tinting": {"color": [0.85, 0.2, 0.45, "math.sin(v.particle_age / v.particle_lifetime * 180)"]},
    })
    return p


def fog():
    rift = {"fog_start": 2, "fog_end": 30, "fog_color": "#17131d", "render_distance_type": "fixed"}
    return {"format_version": "1.16.100", "minecraft:fog_settings": {"description": {"identifier": "observer:rift"}, "distance": {
        "air": rift, "weather": rift, "water": {"fog_start": 0, "fog_end": 10, "fog_color": "#0d0a14", "render_distance_type": "fixed"}}}}


def lang():
    p = os.path.join(RP, "texts", "en_US.lang")
    text = open(p, encoding="utf-8").read()
    line = "entity.observer:rift_portal.name=Rift"
    if line not in text:
        marker = "## ---- merged: "
        i = text.find(marker)
        text = (text[:i].rstrip("\n") + "\n" + line + "\n\n" + text[i:]) if i >= 0 else text.rstrip("\n") + "\n" + line + "\n"
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)


def main():
    for i in range(FRAMES):
        void_frame(i).save(out(RP, "textures", "entity", "rift_portal", f"void_{i}.png"))
    halo().save(out(RP, "textures", "entity", "rift_portal", "halo.png"))
    eye().save(out(RP, "textures", "entity", "rift_portal", "eye.png"))
    spark_sheet().save(out(RP, "textures", "particle", "observer", "rift_spark.png"))
    rain().save(out(RP, "textures", "particle", "observer", "rift_rain.png"))
    dump(geometry(), RP, "models", "entity", "rift_portal.geo.json")
    dump(client_entity(), RP, "entity", "rift_portal.entity.json")
    dump(render_controllers(), RP, "render_controllers", "rift_portal.render_controllers.json")
    dump(animations(), RP, "animations", "rift_portal.animation.json")
    dump(animation_controller(), RP, "animation_controllers", "rift_portal.animation_controllers.json")
    for k, v in particles().items():
        dump(v, RP, "particles", f"{k}.json")
    dump(fog(), RP, "fogs", "rift.json")
    dump(behavior_entity(), BP, "entities", "rift_portal.json")
    lang()
    print("rift portal written")


if __name__ == "__main__":
    main()
