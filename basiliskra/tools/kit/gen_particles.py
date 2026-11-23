#!/usr/bin/env python3
"""
Particle effects and the small textures that are not part of a model: the particle sprite
sheet, the shed-fin item icon and the pack icons.  Everything is drawn here; nothing is
borrowed.  Particle JSON mirrors the structure of the vanilla 1.26.x definitions.

Colour rule (learned the hard way on beams): a colour that is only *added* to the screen turns
white over sky and orange over grass.  So every beam is drawn twice: an alpha-blended scarlet
body that keeps its hue against any background, and a thin additive white-hot core inside it.
"""
from __future__ import annotations

import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RP = os.path.join(ROOT, "packs", "RP")
NS = "basiliskra"
TEX = f"textures/particle/{NS}_particles"
CELL, GRID = 16, 4
SHEET = CELL * GRID

SPRITES = ["pixel", "soft", "spark", "square_ring", "bubble", "flake", "drop", "puff",
           "streak", "halo", "zigzag", "seam", "ring", "ember", "wisp", "flare"]


def draw_sheet() -> np.ndarray:
    a = np.zeros((SHEET, SHEET, 4), dtype=np.float64)
    yy, xx = np.mgrid[0:CELL, 0:CELL]
    cx = cy = (CELL - 1) / 2.0
    r = np.hypot(xx - cx, yy - cy)

    def put(i, alpha, shade=None):
        gx, gy = i % GRID, i // GRID
        cell = np.ones((CELL, CELL, 4))
        if shade is not None:
            cell[..., :3] = shade[..., None]
        cell[..., 3] = np.clip(alpha, 0, 1)
        a[gy * CELL:(gy + 1) * CELL, gx * CELL:(gx + 1) * CELL] = cell

    put(0, ((np.abs(xx - cx) < 4) & (np.abs(yy - cy) < 4)).astype(float))
    put(1, np.round(np.clip(1.25 - r / 5.5, 0, 1) * 4) / 4)                       # stepped: pixel-art soft dot
    put(2, (((np.abs(xx - cx) < 1) & (np.abs(yy - cy) < 7)) | ((np.abs(yy - cy) < 1) & (np.abs(xx - cx) < 7)) |
            ((np.abs(xx - cx) < 2.5) & (np.abs(yy - cy) < 2.5))).astype(float))
    m = np.maximum(np.abs(xx - cx), np.abs(yy - cy))
    put(3, ((m > 5.5) & (m < 7.6)).astype(float))                                 # square ring: silt in a block world
    put(4, ((r > 4.2) & (r < 5.8)).astype(float) + ((xx == 5) & (yy == 5)) * 1.0)
    put(5, (((xx + yy * 3) % 5 < 2) & (r < 5.5)).astype(float))
    put(6, ((np.abs(xx - cx) < 2) & (yy > 3) & (yy < 12)).astype(float) + ((np.abs(xx - cx) < 3) & (yy > 8) & (yy < 12)) * 1.0)
    put(7, (((np.abs(xx - cx) < 6) & (np.abs(yy - cy) < 4)) | ((np.abs(xx - cx) < 4) & (np.abs(yy - cy) < 6))).astype(float) * 0.85)
    v = np.abs(yy - cy)
    put(8, np.where(v < 1.6, 1.0, np.where(v < 3.6, 0.7, np.where(v < 5.6, 0.3, 0.0))))                  # beam core streak
    put(9, np.where(v < 3.6, 0.55, np.where(v < 5.6, 0.35, np.where(v < 7.6, 0.15, 0.0))))               # beam body
    zig = np.array([7, 8, 9, 10, 9, 7, 5, 4, 5, 7, 9, 11, 10, 8, 7, 6])
    put(10, (np.abs(yy - zig[xx]) < 1.3).astype(float))
    put(11, np.where(np.abs(xx - cx) < 1.1, 1.0, np.where(np.abs(xx - cx) < 3.1, 0.4, 0.0)))             # the seam: a vertical cut
    put(12, ((r > 5.6) & (r < 7.6)).astype(float))
    put(13, (np.abs(xx - cx) + np.abs(yy - cy) < 4.2).astype(float))
    put(14, (((np.abs(xx - cx - np.sin(yy * 0.9) * 2.2) < 1.6)) & (yy > 1) & (yy < 14)).astype(float) * 0.7)
    put(15, np.clip(np.maximum(1.0 - np.abs(xx - cx) * np.abs(yy - cy) / 3.0, 0) * (r < 7.5), 0, 1))
    return (a * 255).round().astype(np.uint8)


# ---- the breath's own sheet: animated plasma, a hot core, a soft band, glows, a star and a ring (192 x 128) ------------
TEXB = f"textures/particle/{NS}_beam"
BW, BH = 192, 128


def _noise1(n, seed, octaves=((3, 1.0), (7, 0.5), (15, 0.25))):
    """Smooth periodic noise along a strip of n pixels (a sum of sines with seeded phases), in -1..1."""
    r = np.random.default_rng(seed)
    x = np.arange(n) / n * 2 * np.pi
    out = np.zeros(n)
    for k, a in octaves:
        out += a * np.sin(k * x + r.uniform(0, 2 * np.pi))
    return out / sum(a for _, a in octaves)


def draw_beam_sheet() -> np.ndarray:
    a = np.zeros((BH, BW, 4), dtype=np.float64)
    vv = (np.arange(16) - 7.5) / 7.5                                   # across a band: -1 .. 1
    for f in range(8):
        y0 = f * 16
        # plasma: a turbulent band whose edge wanders along its length, bright filaments inside it
        edge = 0.66 + 0.22 * _noise1(64, 100 + f)
        lumps = 0.82 + 0.18 * _noise1(64, 200 + f, ((5, 1.0), (11, 0.6), (23, 0.3)))
        fil = [0.45 * _noise1(64, 300 + f * 3 + k, ((2, 1.0), (5, 0.4))) for k in range(3)]
        for u in range(64):
            d = np.abs(vv) / edge[u]
            alpha = np.clip(1 - d ** 2, 0, 1) ** 0.6 * lumps[u]
            light = 0.55 + 0.45 * np.clip(1 - d, 0, 1)
            for k in range(3):
                light = light + 0.45 * (np.abs(vv - fil[k][u]) < 0.11)
            a[y0:y0 + 16, u, :3] = np.clip(light, 0, 1)[:, None]
            a[y0:y0 + 16, u, 3] = alpha
        # the core: a narrow white-hot line that crackles
        width = 0.24 + 0.07 * _noise1(64, 400 + f, ((6, 1.0), (17, 0.5)))
        for u in range(64):
            d = np.abs(vv) / width[u]
            a[y0:y0 + 16, 64 + u, :3] = 1.0
            a[y0:y0 + 16, 64 + u, 3] = np.clip(1.15 - d, 0, 1) ** 0.5
    # a soft band (the glow round the beam)
    a[0:16, 128:192, :3] = 1.0
    a[0:16, 128:192, 3] = np.exp(-(vv / 0.5) ** 2)[:, None]
    yy, xx = np.mgrid[0:32, 0:32]
    r = np.hypot(xx - 15.5, yy - 15.5) / 15.5
    ang = np.arctan2(yy - 15.5, xx - 15.5)
    def put(x0, y0, rgb, alpha):
        a[y0:y0 + 32, x0:x0 + 32, :3] = rgb[..., None] if np.ndim(rgb) == 2 else rgb
        a[y0:y0 + 32, x0:x0 + 32, 3] = np.clip(alpha, 0, 1)
    put(128, 16, np.ones((32, 32)), np.exp(-(r / 0.5) ** 2))                                            # glow
    star = np.maximum(np.exp(-(r / 0.22) ** 2), np.clip(1 - r, 0, 1) ** 1.5 * np.abs(np.cos(3 * ang)) ** 18)
    put(160, 16, np.ones((32, 32)), star)                                                                  # six-pointed flare
    put(128, 48, np.clip(1.2 - r, 0, 1), np.clip(1 - r ** 2, 0, 1) ** 1.5)                                 # an energy blob, hot in the middle
    put(160, 48, np.ones((32, 32)), np.exp(-((r - 0.8) / 0.12) ** 2))                                      # a ring
    return (a * 255).round().astype(np.uint8)


def uvb(x, y, w, h, frames=False) -> dict:
    d = {"texture_width": BW, "texture_height": BH, "uv": [x, y], "uv_size": [w, h]}
    if frames:
        d["uv"] = [x, f"math.floor(v.particle_random_1 * 7.99) * 16"]      # each one drawn picks a frame: the plasma never holds still
    return d


PLASMA, CORE = (0, 0, 64, 16, True), (64, 0, 64, 16, True)
BAND, GLOW, STAR, BLOB, RINGB = (128, 0, 64, 16), (128, 16, 32, 32), (160, 16, 32, 32), (128, 48, 32, 32), (160, 48, 32, 32)


def fxb(name, material, **components):
    """An effect drawn from the breath's own sheet."""
    return name, {
        "format_version": "1.26.10",
        "particle_effect": {
            "description": {"identifier": f"{NS}:{name}", "basic_render_parameters": {"material": material, "texture": TEXB}},
            "components": components,
        }}, None


def beam2(name, region, material, tint, half_width):
    """One quad laid from the mouth along the beam (variable.dir, variable.len), `half_width` x variable.width across."""
    return fxb(name, material, **ONCE, **burst(1), **{
        "minecraft:emitter_shape_point": {
            "offset": ["v.dir.x * v.len * 0.5", "v.dir.y * v.len * 0.5", "v.dir.z * v.len * 0.5"],
            "direction": ["v.dir.x", "v.dir.y", "v.dir.z"]},
        "minecraft:particle_initial_speed": 0.05,
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.14},
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": {"size": ["v.len * 0.5", f"v.width * {half_width}"], "facing_camera_mode": "lookat_direction",
                                                    "direction": ALONG, "uv": uvb(*region)},
        "minecraft:particle_appearance_tinting": {"color": list(tint) if isinstance(tint, tuple) else tint},
    })


def at_mouth(name, region, material, size, life, color, n=1, spin=False):
    """Something at the mouth itself, sized by the breath (variable.width)."""
    comps = {**ONCE, **burst(n), "minecraft:emitter_shape_point": {}, "minecraft:particle_initial_speed": 0,
             "minecraft:particle_lifetime_expression": {"max_lifetime": life}, "minecraft:particle_motion_dynamic": {}}
    if spin:
        comps["minecraft:particle_initial_spin"] = {"rotation": "math.random(0, 360)", "rotation_rate": "math.random(-90, 90)"}
    comps["minecraft:particle_appearance_billboard"] = {"size": size, "facing_camera_mode": "rotate_xyz", "uv": uvb(*region)}
    comps["minecraft:particle_appearance_tinting"] = {"color": color}
    return fxb(name, material, **comps)


def uv(sprite: str) -> dict:
    i = SPRITES.index(sprite)
    return {"texture_width": SHEET, "texture_height": SHEET, "uv": [(i % GRID) * CELL, (i // GRID) * CELL], "uv_size": [CELL, CELL]}


def grad(*stops):
    """stops: (t, (r, g, b, a))"""
    return {"gradient": {f"{t:.2f}": list(c) for t, c in stops}, "interpolant": "v.particle_age / v.particle_lifetime"}


WHITE = (1.0, 0.95, 0.86, 1.0)
HOT = (1.0, 0.62, 0.30, 1.0)
RED = (1.0, 0.13, 0.09, 1.0)
DEEP = (0.55, 0.03, 0.05, 0.0)
SILT = (0.52, 0.47, 0.40, 0.85)
WATER = (0.78, 0.90, 1.0, 0.9)


def fx(name, sprite, material="particles_blend", **components):
    return name, {
        "format_version": "1.26.10",
        "particle_effect": {
            "description": {"identifier": f"{NS}:{name}", "basic_render_parameters": {"material": material, "texture": TEX}},
            "components": components,
        }}, sprite


def bb(sprite, size, facing="lookat_xyz", direction=None):
    d = {"size": size, "facing_camera_mode": facing, "uv": uv(sprite)}
    if direction:
        d["direction"] = direction
    return d


ONCE = {"minecraft:emitter_lifetime_once": {"active_time": 0.05}}
ALONG = {"mode": "derive_from_velocity", "min_speed_threshold": 0.001}


def burst(n):
    return {"minecraft:emitter_rate_instant": {"num_particles": n}}


def steady(rate, cap, active=None):
    d = {"minecraft:emitter_rate_steady": {"spawn_rate": rate, "max_particles": cap}}
    d["minecraft:emitter_lifetime_looping" if active is None else "minecraft:emitter_lifetime_once"] = {"active_time": 1.0 if active is None else active}
    return d


def beam(name, sprite, material, tint):
    """One quad stretched from the mouth to where the server's ray ended (variable.len), turning
    about its own axis to face the camera.  The server passes direction, length and width."""
    return fx(name, sprite, material, **ONCE, **burst(1), **{
        "minecraft:emitter_shape_point": {
            "offset": ["v.dir.x * v.len * 0.5", "v.dir.y * v.len * 0.5", "v.dir.z * v.len * 0.5"],
            "direction": ["v.dir.x", "v.dir.y", "v.dir.z"]},
        "minecraft:particle_initial_speed": 0.05,
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.14},
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": bb(sprite, ["v.len * 0.5", "v.width * 0.5"], "lookat_direction", ALONG),
        "minecraft:particle_appearance_tinting": {"color": list(tint)},
    })


def scatter(name, sprite, n, radius, speed, life, size, color, accel=None, drag=0.0, material="particles_blend", shape=None, facing="lookat_xyz"):
    comps = {**ONCE, **burst(n)}
    comps.update(shape or {"minecraft:emitter_shape_sphere": {"radius": radius, "direction": "outwards"}})
    comps["minecraft:particle_initial_speed"] = speed
    comps["minecraft:particle_lifetime_expression"] = {"max_lifetime": life}
    comps["minecraft:particle_motion_dynamic"] = {"linear_acceleration": accel or [0, 0, 0], "linear_drag_coefficient": drag}
    comps["minecraft:particle_appearance_billboard"] = bb(sprite, size, facing)
    comps["minecraft:particle_appearance_tinting"] = {"color": color}
    return fx(name, sprite, material, **comps)


def ring(name, sprite, r0, r1, life, color, facing="emitter_transform_xz"):
    """An expanding ring lying flat (on the bed, on the surface)."""
    grow = f"{r0} + ({r1} - {r0}) * (v.particle_age / v.particle_lifetime)"
    return fx(name, sprite, "particles_blend", **ONCE, **burst(1), **{
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_initial_speed": 0,
        "minecraft:particle_lifetime_expression": {"max_lifetime": life},
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": bb(sprite, [grow, grow], facing),
        "minecraft:particle_appearance_tinting": {"color": color},
    })


def looping(name, sprite, rate, cap, shape, speed, life, size, color, accel=None, drag=0.0, material="particles_blend"):
    comps = {"minecraft:emitter_local_space": {"position": True, "rotation": False, "velocity": False}, **steady(rate, cap)}
    comps.update(shape)
    comps["minecraft:particle_initial_speed"] = speed
    comps["minecraft:particle_lifetime_expression"] = {"max_lifetime": life}
    comps["minecraft:particle_motion_dynamic"] = {"linear_acceleration": accel or [0, 0, 0], "linear_drag_coefficient": drag}
    comps["minecraft:particle_appearance_billboard"] = bb(sprite, size)
    comps["minecraft:particle_appearance_tinting"] = {"color": color}
    return fx(name, sprite, material, **comps)


def streak_along(name, sprite, n, drag, life, size, color, accel=None, material="particles_blend", spread=0.08, facing="lookat_xyz", direction=None):
    """Particles thrown from the mouth along the beam the server measured (variable.dir, variable.len); each one is
    slowed by drag so it comes to rest at a random point of the beam, then drifts (smoke rises, embers fall)."""
    comps = {**ONCE, **burst(n)}
    comps["minecraft:emitter_shape_point"] = {"offset": [0, 0, 0], "direction": [
        f"v.dir.x + math.random(-{spread}, {spread})", f"v.dir.y + math.random(-{spread}, {spread})", f"v.dir.z + math.random(-{spread}, {spread})"]}
    comps["minecraft:particle_initial_speed"] = f"math.random(0.03, 1.0) * v.len * {drag}"
    comps["minecraft:particle_lifetime_expression"] = {"max_lifetime": life}
    comps["minecraft:particle_motion_dynamic"] = {"linear_acceleration": accel or [0, 0, 0], "linear_drag_coefficient": drag}
    comps["minecraft:particle_appearance_billboard"] = bb(sprite, size, facing, direction)
    comps["minecraft:particle_appearance_tinting"] = {"color": color}
    return fx(name, sprite, material, **comps)


def beam_ring(name, sprite, speed, size, color, life=None, material="particles_add"):
    """A ring standing square to the beam (variable.dir), growing as it goes.  `speed` blocks a second along the beam;
    it dies where the beam ends (variable.len) unless a lifetime is given (the muzzle shock: it stays at the mouth)."""
    return fx(name, sprite, material, **ONCE, **burst(1), **{
        "minecraft:emitter_shape_point": {"direction": ["v.dir.x", "v.dir.y", "v.dir.z"]},
        "minecraft:particle_initial_speed": speed,
        "minecraft:particle_lifetime_expression": {"max_lifetime": life if life is not None else f"math.max(0.1, v.len / {speed})"},
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": bb(sprite, size, "direction_z", ALONG),
        "minecraft:particle_appearance_tinting": {"color": color},
    })


def wave(name, sprite, n, speed, size, color, accel=None):
    """A ring of dust thrown outward along the ground at the speed of the server's shockwave; it reaches
    variable.reach blocks (the radius the server will carry the wave to) and dies there."""
    comps = {**ONCE, **burst(n)}
    comps["minecraft:emitter_shape_disc"] = {"radius": 1.5, "plane_normal": "y", "surface_only": True, "direction": "outwards"}
    comps["minecraft:particle_initial_speed"] = speed
    comps["minecraft:particle_lifetime_expression"] = {"max_lifetime": f"math.max(0.3, v.reach / {speed})"}
    comps["minecraft:particle_motion_dynamic"] = {"linear_acceleration": accel or [0, 0, 0]}
    comps["minecraft:particle_appearance_billboard"] = bb(sprite, size)
    comps["minecraft:particle_appearance_tinting"] = {"color": color}
    return fx(name, sprite, "particles_blend", **comps)


def flat_ring(name, sprite, speed, color):
    """One ring lying on the ground, growing at the wave's speed to variable.reach."""
    grow = f"1 + {speed} * v.particle_age"
    return fx(name, sprite, "particles_blend", **ONCE, **burst(1), **{
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_initial_speed": 0,
        "minecraft:particle_lifetime_expression": {"max_lifetime": f"math.max(0.3, v.reach / {speed})"},
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": bb(sprite, [grow, grow], "emitter_transform_xz"),
        "minecraft:particle_appearance_tinting": {"color": color},
    })


AGE = "v.particle_age / v.particle_lifetime"
SPH = lambda r: {"minecraft:emitter_shape_sphere": {"radius": r, "direction": "outwards"}}
SHRINK = lambda s: [f"{s} * (1 - v.particle_age / v.particle_lifetime)"] * 2
RAND = lambda a, b: f"math.random({a}, {b})"          # evaluated once: speed, lifetime, direction
PR = lambda a, b, k=1: f"({a} + {round(b - a, 4)} * v.particle_random_{k})"   # per-particle constant: sizes
# radiation: a mote that flickers (each at its own phase) and dims as it rises
FLICKER = lambda s: f"({s} + {round(s * 0.5, 4)} * math.sin(v.particle_age * 720 + v.particle_random_2 * 360)) * (1 - 0.6 * v.particle_age / v.particle_lifetime)"
RAD = ((0, WHITE), (0.25, (1.0, 0.36, 0.30, 1.0)), (0.7, RED), (1, DEEP))

SMOKE = grad((0, (0.42, 0.09, 0.07, 0.0)), (0.08, (0.40, 0.10, 0.08, 0.8)), (0.4, (0.20, 0.17, 0.17, 0.65)), (1, (0.10, 0.09, 0.09, 0)))
FIRE = grad((0, WHITE), (0.2, HOT), (0.55, RED), (1, DEEP))
DUST = grad((0, (0.50, 0.45, 0.39, 0.0)), (0.1, (0.50, 0.45, 0.39, 0.8)), (1, (0.42, 0.38, 0.33, 0)))
GROW = lambda a, b: [f"({a} + ({b} - {a}) * v.particle_age / v.particle_lifetime) * (0.8 + 0.4 * v.particle_random_1)"] * 2

EFFECTS = [
    # ---- the beam ---------------------------------------------------------------------------
    # Drawn in layers, every one sized from variable.width (the breath is drawn to fill the mouth it leaves by):
    # a white-hot crackling core, a scarlet body of plasma that never holds still, a layer of fire over it, and a
    # soft scarlet glow round the whole.  (Blended layers keep their colour against the sky; the added ones burn.)
    beam2("beam_core", CORE, "particles_add", WHITE, 0.17),
    beam2("beam_halo", PLASMA, "particles_blend", (1.0, 0.16, 0.08, 0.93), 0.42),
    beam2("beam_heat", PLASMA, "particles_add", (1.0, 0.42, 0.18, 0.55), 0.3),
    beam2("beam_glow", BAND, "particles_blend", (0.92, 0.07, 0.05, 0.34), 1.25),
    # light racing down it from his mouth, and what leaves his mouth with it: a white burst, a star, sparks thrown off
    fxb("beam_pulse", "particles_add", **ONCE, **burst(1), **{
        "minecraft:emitter_shape_point": {"direction": ["v.dir.x", "v.dir.y", "v.dir.z"]},
        "minecraft:particle_initial_speed": 85,
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.max(0.05, v.len / 85)"},
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": {"size": ["v.width * 0.42", "v.width * 0.42"], "facing_camera_mode": "rotate_xyz", "uv": uvb(*BLOB)},
        "minecraft:particle_appearance_tinting": {"color": grad((0, WHITE), (0.5, (1, 0.6, 0.4, 0.9)), (1, (1, 0.2, 0.1, 0.4)))}}),
    at_mouth("mouth_burst", GLOW, "particles_add", ["v.width * (0.9 + 0.25 * v.particle_random_1)"] * 2, 0.13, grad((0, (1, 0.85, 0.75, 0.95)), (1, (1, 0.3, 0.15, 0)))),
    at_mouth("mouth_star", STAR, "particles_add", ["v.width * (1.2 + 0.5 * v.particle_random_1)"] * 2, 0.18, grad((0, WHITE), (0.5, (1, 0.5, 0.35, 0.8)), (1, (1, 0.1, 0.05, 0))), spin=True),
    streak_along("beam_sparks", "spark", 8, 6.0, RAND(0.25, 0.6), SHRINK(0.18), grad((0, WHITE), (0.4, HOT), (1, DEEP)), accel=[0, -8, 0], material="particles_add", spread=0.35),
    # where it lands: a star too bright to look at
    at_mouth("impact_flash", STAR, "particles_add", ["v.width * (2.0 + 1.0 * v.particle_random_1)"] * 2, 0.22, grad((0, WHITE), (0.4, (1, 0.6, 0.4, 0.85)), (1, (1, 0.15, 0.08, 0))), spin=True),
    streak_along("beam_smoke", "puff", 12, 4.0, RAND(1.8, 3.2), GROW(0.5, 2.4), SMOKE, accel=[0, 1.6, 0], spread=0.12),
    streak_along("beam_embers", "ember", 10, 3.0, RAND(0.5, 1.1), SHRINK(0.22), FIRE, accel=[0, -3, 0], material="particles_add", spread=0.2),
    # before it: a thin line down the path it is about to take (from the moment his eye stops following)
    beam("beam_aim", "streak", "particles_add", (1.0, 0.16, 0.12, 0.55)),
    # as it fires: a white flare and a shock ring at the mouth; then rings racing down it and lightning crawling along it
    scatter("muzzle_flash", "flare", 3, 0.2, 0.0, RAND(0.16, 0.3), [f"(v.width > 0 ? v.width * (1.6 + 1.8 * v.particle_random_1) : 5 + 6 * v.particle_random_1) * (1 - {AGE})"] * 2,
            grad((0, WHITE), (0.5, HOT), (1, (1, 0.15, 0.1, 0))), material="particles_add"),
    beam_ring("muzzle_shock", "ring", 0.6, [f"1 + (v.width > 0 ? v.width * 4 : 15) * {AGE}"] * 2, grad((0, WHITE), (0.3, (1, 0.5, 0.4, 0.8)), (1, (1, 0.1, 0.08, 0))), life=0.55),
    fxb("beam_ring", "particles_add", **ONCE, **burst(1), **{
        "minecraft:emitter_shape_point": {"direction": ["v.dir.x", "v.dir.y", "v.dir.z"]},
        "minecraft:particle_initial_speed": 46,
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.max(0.1, v.len / 46)"},
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": {"size": [f"v.width * (0.75 + 1.3 * {AGE})"] * 2, "facing_camera_mode": "direction_z", "direction": ALONG, "uv": uvb(*RINGB)},
        "minecraft:particle_appearance_tinting": {"color": grad((0, (1, 0.9, 0.8, 0.9)), (0.5, (1, 0.3, 0.22, 0.7)), (1, (0.9, 0.08, 0.06, 0)))}}),
    streak_along("beam_arc", "zigzag", 7, 5.0, RAND(0.08, 0.2), [PR(0.5, 1.3), PR(0.25, 0.6, 2)], grad((0, WHITE), (0.4, (1, 0.4, 0.35, 1)), (1, DEEP)),
                 material="particles_add", spread=0.045, facing="rotate_xyz"),
    # where it lands: a white flash, fire, a column of smoke, and the ground thrown into the air
    scatter("impact_blast", "flare", 5, 0.8, RAND(1, 4), RAND(0.35, 0.6), GROW(1.6, 4.2), FIRE, drag=2.0, material="particles_add"),
    scatter("impact_fire", "wisp", 9, 1.4, RAND(0.5, 2.5), RAND(0.6, 1.3), [PR(0.5, 1.1), PR(0.8, 1.6, 2)], FIRE, accel=[0, 3.5, 0], drag=1.2, material="particles_add"),
    scatter("impact_smoke", "puff", 8, 1.6, RAND(0.6, 2.2), RAND(3.0, 5.0), GROW(1.2, 4.5), SMOKE, accel=[0, 1.4, 0], drag=0.7,
            shape={"minecraft:emitter_shape_sphere": {"radius": 1.6, "direction": [RAND(-0.6, 0.6), 1, RAND(-0.6, 0.6)]}}),
    scatter("impact_debris", "square_ring", 14, 0.8, RAND(5, 13), RAND(0.9, 1.8), [PR(0.12, 0.32)] * 2,
            grad((0, (0.36, 0.33, 0.31, 1)), (0.8, (0.30, 0.27, 0.25, 1)), (1, (0.25, 0.22, 0.2, 0))), accel=[0, -20, 0], drag=0.3,
            shape={"minecraft:emitter_shape_sphere": {"radius": 0.8, "direction": [RAND(-0.8, 0.8), 1, RAND(-0.8, 0.8)]}}, facing="rotate_xyz"),
    # ... a glare too bright to look at, a ring of fire across the ground and a fountain of sparks
    scatter("impact_glare", "soft", 1, 0.05, 0.0, 0.2, [f"7 + 4 * v.particle_random_1"] * 2, grad((0, (1, 0.9, 0.8, 0.75)), (1, (1, 0.2, 0.12, 0))), material="particles_add"),
    ring("impact_ring", "ring", 1.0, 11.0, 0.5, grad((0, (1, 0.9, 0.8, 0.85)), (0.4, (1, 0.35, 0.25, 0.6)), (1, (0.9, 0.1, 0.08, 0)))),
    scatter("impact_fountain", "spark", 14, 0.4, RAND(9, 22), RAND(0.6, 1.3), SHRINK(0.34), grad((0, WHITE), (0.3, HOT), (0.7, RED), (1, DEEP)),
            accel=[0, -18, 0], drag=0.4, material="particles_add",
            shape={"minecraft:emitter_shape_sphere": {"radius": 0.4, "direction": [RAND(-0.45, 0.45), 1, RAND(-0.45, 0.45)]}}),
    # the seabed hauled ashore: black water, gravel and weed thrown up along the front of the wave
    scatter("surge", "puff", 9, 1.2, RAND(2, 6), RAND(0.7, 1.4), GROW(1.0, 3.0),
            grad((0, (0.08, 0.10, 0.13, 0.0)), (0.15, (0.08, 0.10, 0.13, 0.9)), (0.6, (0.16, 0.20, 0.22, 0.7)), (1, (0.3, 0.34, 0.36, 0))), accel=[0, -9, 0], drag=0.6,
            shape={"minecraft:emitter_shape_sphere": {"radius": 1.2, "direction": [RAND(-0.5, 0.5), 1, RAND(-0.5, 0.5)]}}),
    scatter("surge_spray", "drop", 12, 1.0, RAND(4, 10), RAND(0.6, 1.2), [PR(0.08, 0.2)] * 2,
            grad((0, WATER), (0.7, WATER), (1, (0.7, 0.85, 1.0, 0))), accel=[0, -16, 0], drag=0.3,
            shape={"minecraft:emitter_shape_sphere": {"radius": 1.0, "direction": [RAND(-0.7, 0.7), 1, RAND(-0.7, 0.7)]}}),
    # the roar: a ring of dust thrown out along the ground at the speed of the shockwave, and the ring itself
    wave("roar_wave", "puff", 110, 40, GROW(0.8, 2.6), DUST, accel=[0, 1.2, 0]),
    flat_ring("roar_ring", "ring", 40, grad((0, (1, 0.92, 0.86, 0.55)), (0.6, (1, 0.6, 0.5, 0.3)), (1, (0.8, 0.3, 0.25, 0)))),
    scatter("beam_spiral", "pixel", 1, 0.02, RAND(0.2, 0.9), 0.28, SHRINK(0.26), grad((0, RED), (0.6, RED), (1, DEEP))),
    scatter("beam_impact", "ember", 9, 0.35, RAND(3, 8), RAND(0.35, 0.8), SHRINK(0.2), grad((0, WHITE), (0.3, HOT), (0.7, RED), (1, DEEP)),
            accel=[0, -12, 0], drag=1.2, material="particles_add"),
    scatter("arc_seg", "zigzag", 1, 0.01, 0, 0.11, [PR(0.3, 0.55), PR(0.2, 0.4, 2)], grad((0, WHITE), (0.5, RED), (1, DEEP)), facing="rotate_xyz"),
    # ---- the seam -----------------------------------------------------------------------------
    # spawned at his swimming depth; the cut itself stands from the sea bed side to well clear of the surface,
    # so it is seen from a pier at dusk as well as from under water
    scatter("seam", "seam", 12, 0, RAND(0.02, 0.2), RAND(0.25, 0.45), [PR(0.2, 0.42, 2), PR(0.6, 1.3)], grad((0, WHITE), (0.25, RED), (1, DEEP)),
            shape={"minecraft:emitter_shape_box": {"offset": [0, 2.6, 0], "half_dimensions": [0.14, 7.0, 0.14], "direction": [0, 1, 0]}}, facing="lookat_y"),
    scatter("seam_close", "spark", 34, 0, RAND(0.5, 2.5), RAND(0.4, 0.9), SHRINK(0.3), grad((0, WHITE), (0.4, RED), (1, DEEP)),
            shape={"minecraft:emitter_shape_box": {"offset": [0, 2.6, 0], "half_dimensions": [0.2, 7.0, 0.2], "direction": "outwards"}}, drag=2.0),
    ring("seam_pulse", "ring", 0.4, 2.6, 0.7, grad((0, (1, 0.2, 0.15, 0.9)), (1, DEEP))),
    # ---- the rift, torn wide (the script sends variable.size: its height in blocks) ---------------------------
    scatter("rift_tear", "seam", 18, 0, RAND(0.02, 0.4), RAND(0.25, 0.55), [PR(0.35, 0.9, 2), PR(1.4, 3.2)], grad((0, WHITE), (0.2, RED), (1, DEEP)),
            shape={"minecraft:emitter_shape_box": {"offset": [0, "v.size * 0.5", 0], "half_dimensions": [0.25, "v.size * 0.5", 0.25], "direction": [0, 1, 0]}},
            facing="lookat_y", material="particles_add"),
    scatter("rift_core", "seam", 6, 0, 0.0, RAND(0.12, 0.2), ["v.size * 0.05 + 0.3", "v.size * 0.5"], grad((0, WHITE), (0.5, (1, 0.5, 0.4, 0.9)), (1, DEEP)),
            shape={"minecraft:emitter_shape_box": {"offset": [0, "v.size * 0.5", 0], "half_dimensions": [0.1, 0.1, 0.1], "direction": [0, 1, 0]}},
            facing="lookat_y", material="particles_add"),
    scatter("rift_arc", "zigzag", 5, 0, 0.0, RAND(0.08, 0.16), [PR(1.6, 4.2), PR(0.8, 1.8, 2)], grad((0, WHITE), (0.5, RED), (1, DEEP)),
            shape={"minecraft:emitter_shape_box": {"offset": [0, "v.size * 0.5", 0], "half_dimensions": ["v.size * 0.22", "v.size * 0.5", "v.size * 0.22"], "direction": "outwards"}},
            facing="rotate_xyz", material="particles_add"),
    fx("rift_ring", "ring", "particles_blend", **ONCE, **burst(1), **{
        "minecraft:emitter_shape_point": {"offset": [0, "v.size * 0.5", 0]},
        "minecraft:particle_initial_speed": 0,
        "minecraft:particle_lifetime_expression": {"max_lifetime": 1.1},
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": bb("ring", ["1 + v.size * 1.3 * (v.particle_age / v.particle_lifetime)"] * 2, "lookat_xyz"),
        "minecraft:particle_appearance_tinting": {"color": grad((0, (1, 0.5, 0.4, 0.9)), (0.5, (1, 0.15, 0.1, 0.5)), (1, DEEP))}}),
    scatter("rift_suck", "spark", 30, 0, RAND(9, 17), "v.size * 0.07 + 0.25", SHRINK(0.3), grad((0, DEEP), (0.3, RED), (1, WHITE)),
            shape={"minecraft:emitter_shape_sphere": {"offset": [0, "v.size * 0.5", 0], "radius": "v.size * 0.9 + 3", "surface_only": True, "direction": "inwards"}},
            material="particles_add"),
    scatter("rift_burst", "flare", 70, 0, RAND(6, 22), RAND(0.5, 1.3), SHRINK(0.9), FIRE, drag=1.6, material="particles_add",
            shape={"minecraft:emitter_shape_box": {"offset": [0, "v.size * 0.5", 0], "half_dimensions": [0.4, "v.size * 0.45", 0.4], "direction": "outwards"}}),
    fx("rift_flash", "soft", "particles_add", **ONCE, **burst(1), **{
        "minecraft:emitter_shape_point": {"offset": [0, "v.size * 0.5", 0]},
        "minecraft:particle_initial_speed": 0,
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.3},
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_appearance_billboard": bb("soft", ["v.size * (1.2 + 1.2 * v.particle_age / v.particle_lifetime)"] * 2),
        "minecraft:particle_appearance_tinting": {"color": grad((0, (1, 0.9, 0.85, 0.95)), (1, (1, 0.2, 0.1, 0)))}}),
    # a change: light gathers on him from all round, and is thrown off again when it is done
    scatter("mutate_gather", "ember", 26, 0, RAND(5, 11), "v.size * 0.1 + 0.3", SHRINK(0.26), grad((0, DEEP), (0.4, RED), (1, WHITE)),
            shape={"minecraft:emitter_shape_sphere": {"radius": "v.size + 2", "surface_only": True, "direction": "inwards"}}, material="particles_add"),
    scatter("mutate_burst", "ember", 90, 2.0, RAND(8, 26), RAND(0.6, 1.5), SHRINK(0.5), FIRE, drag=1.4, accel=[0, -4, 0], material="particles_add"),
    scatter("fin_spark", "spark", 1, 0.01, 0, 0.5, SHRINK(0.16), grad((0, RED), (1, DEEP))),
    # ---- water ----------------------------------------------------------------------------------
    ring("shock_ring", "ring", 1.0, 7.5, 0.9, grad((0, (0.9, 0.97, 1, 0.9)), (1, (0.9, 0.97, 1, 0))), facing="lookat_xyz"),
    ring("silt_ring", "square_ring", 0.6, 4.6, 1.1, grad((0, SILT), (1, (0.52, 0.47, 0.40, 0)))),
    scatter("silt_puff", "puff", 5, 0.5, RAND(0.2, 0.8), RAND(0.8, 1.6), [PR(0.25, 0.5)] * 2, grad((0, SILT), (1, (0.5, 0.45, 0.4, 0))), drag=1.5),
    scatter("gravel_cloud", "pixel", 22, 1.2, RAND(0.8, 3), RAND(0.7, 1.6), [PR(0.08, 0.2)] * 2, grad((0, (0.55, 0.52, 0.5, 1)), (1, (0.4, 0.38, 0.36, 0))),
            accel=[0, -3, 0], drag=1.6),
    scatter("bubble_trail", "bubble", 3, 0.4, RAND(0.05, 0.3), RAND(0.6, 1.2), [PR(0.08, 0.2)] * 2, grad((0, WATER), (1, (0.8, 0.9, 1, 0))), accel=[0, 0.6, 0]),
    scatter("fin_break", "drop", 8, 0.3, RAND(1.5, 4), RAND(0.4, 0.8), [PR(0.07, 0.14)] * 2, grad((0, WATER), (0.6, (1, 0.5, 0.5, 0.9)), (1, (0.8, 0.2, 0.2, 0))),
            accel=[0, -14, 0], shape={"minecraft:emitter_shape_sphere": {"radius": 0.3, "direction": [RAND(-0.4, 0.4), 1, RAND(-0.4, 0.4)]}}),
    scatter("splash", "drop", 7, 0.2, RAND(1.5, 3.5), RAND(0.3, 0.6), [PR(0.06, 0.12)] * 2, grad((0, WATER), (1, (0.8, 0.9, 1, 0))),
            accel=[0, -14, 0], shape={"minecraft:emitter_shape_sphere": {"radius": 0.2, "direction": [RAND(-0.5, 0.5), 1, RAND(-0.5, 0.5)]}}),
    # ---- land -----------------------------------------------------------------------------------
    scatter("grit", "pixel", 6, 0.4, RAND(0.5, 2), RAND(0.4, 0.9), [PR(0.05, 0.12)] * 2, grad((0, (0.5, 0.48, 0.45, 1)), (1, (0.4, 0.38, 0.36, 0))), accel=[0, -9, 0]),
    scatter("step_dust", "puff", 16, 2.6, RAND(0.8, 3.0), RAND(0.9, 1.8), [PR(0.45, 1.0)] * 2, grad((0, (0.45, 0.4, 0.34, 0.75)), (1, (0.4, 0.36, 0.3, 0))),
            accel=[0, 0.4, 0], drag=2.2, shape={"minecraft:emitter_shape_disc": {"radius": 2.8, "plane_normal": "y", "direction": "outwards"}}),
    scatter("lamp_flare", "flare", 3, 0.35, 0.05, RAND(0.25, 0.45), SHRINK(0.9), grad((0, (1, 0.9, 0.6, 1)), (0.5, HOT), (1, DEEP)), material="particles_add"),
    # ---- fallout: his radiation, in the air over poisoned ground (sent by the script) -------------
    scatter("rad_mote", "ember", 2, 0.6, RAND(0.05, 0.3), RAND(1.6, 3.0), [FLICKER(0.07)] * 2, grad(*RAD), accel=[0, 0.18, 0], drag=0.8, material="particles_add"),
    scatter("rad_glint", "spark", 4, 0.3, RAND(0.6, 1.6), RAND(0.25, 0.5), SHRINK(0.14), grad((0, WHITE), (0.5, RED), (1, DEEP)), accel=[0, -2, 0], drag=1.0, material="particles_add"),
    scatter("rad_shimmer", "wisp", 1, 0.4, RAND(0.1, 0.3), RAND(1.0, 1.6), [PR(0.4, 0.7), PR(0.7, 1.2, 2)],
            grad((0, (1, 0.25, 0.2, 0.0)), (0.3, (1, 0.25, 0.2, 0.22)), (1, (0.6, 0.05, 0.05, 0))), accel=[0, 0.6, 0], drag=0.5),
    # a zone's air: motes rising all over it (variable.size: its radius), and a ring of sparks at its edge while it spreads
    scatter("rad_cloud", "ember", 42, 0, RAND(0.05, 0.35), RAND(2.2, 3.8), [FLICKER(0.085)] * 2, grad(*RAD), accel=[0, 0.22, 0], drag=0.8, material="particles_add",
            shape={"minecraft:emitter_shape_disc": {"radius": "v.size", "plane_normal": "y", "surface_only": False, "direction": [RAND(-0.3, 0.3), 1, RAND(-0.3, 0.3)],
                                                    "offset": [0, RAND(0.0, 2.5), 0]}}),
    scatter("rad_front", "spark", 46, 0, RAND(0.4, 1.6), RAND(0.5, 1.0), SHRINK(0.26), grad((0, WHITE), (0.4, RED), (1, DEEP)), accel=[0, 1.5, 0], drag=1.0, material="particles_add",
            shape={"minecraft:emitter_shape_disc": {"radius": "v.size", "plane_normal": "y", "surface_only": True, "direction": [0, 1, 0]}}),
    scatter("crystal_break", "square_ring", 10, 0.25, RAND(1.5, 4), RAND(0.4, 0.8), [PR(0.07, 0.16)] * 2, grad((0, WHITE), (0.3, RED), (1, DEEP)), accel=[0, -12, 0], drag=0.6,
            material="particles_add", facing="rotate_xyz"),
    scatter("fallout_ash", "flake", 10, 0, RAND(0.05, 0.3), RAND(2.5, 4.0), [PR(0.06, 0.13)] * 2,
            grad((0, (0.3, 0.28, 0.27, 0.0)), (0.15, (0.3, 0.28, 0.27, 0.9)), (1, (0.2, 0.18, 0.18, 0))), accel=[0, -1.0, 0], drag=1.4,
            shape={"minecraft:emitter_shape_box": {"offset": [0, 2.5, 0], "half_dimensions": [2.5, 1.0, 2.5], "direction": "outwards"}}),
    # ---- bound to his own body (started by the client animation controller at locators) ----------
    looping("rad_drift", "ember", 3, 10, SPH(0.6), RAND(0.05, 0.3), RAND(1.4, 2.6), [FLICKER(0.08)] * 2, grad(*RAD), accel=[0, 0.25, 0], drag=0.8, material="particles_add"),
    looping("charge_spark", "spark", 26, 40, SPH(1.9), RAND(0.5, 2.5), RAND(0.15, 0.4), SHRINK(0.3), grad((0, WHITE), (0.4, RED), (1, DEEP)), drag=1.0, material="particles_add"),
    # charging, light is drawn out of the air into his mouth
    looping("charge_gather", "spark", 34, 44, {"minecraft:emitter_shape_sphere": {"radius": 6.5, "surface_only": True, "direction": "inwards"}},
            RAND(8, 12), RAND(0.45, 0.62), SHRINK(0.34), grad((0, (1, 0.2, 0.15, 0)), (0.3, RED), (0.8, HOT), (1, WHITE)), material="particles_add"),
    looping("plate_ember", "ember", 7, 14, SPH(0.5), RAND(0.2, 1.0), RAND(0.4, 0.9), SHRINK(0.16), grad((0, HOT), (0.5, RED), (1, DEEP)), accel=[0, 1.6, 0]),
    looping("throat_glow", "soft", 9, 12, SPH(0.4), RAND(0.0, 0.3), RAND(0.2, 0.35), SHRINK(0.9), grad((0, (1, 0.85, 0.7, 0.55)), (1, (1, 0.2, 0.1, 0))), material="particles_add"),
    looping("mouth_flare", "flare", 18, 12, SPH(0.3), 0.0, RAND(0.1, 0.16), [PR(2.4, 3.6)] * 2, grad((0, WHITE), (1, (1, 0.3, 0.2, 0))), material="particles_add"),
    # firing, every plate blazes, and smoke pours off his back and out of his mouth after
    looping("plate_blaze", "flare", 12, 8, SPH(0.4), 0.0, RAND(0.12, 0.22), [PR(1.1, 2.0)] * 2, grad((0, WHITE), (0.4, HOT), (1, (1, 0.15, 0.1, 0))), material="particles_add"),
    looping("plate_smoke", "puff", 6, 18, SPH(0.6), RAND(0.4, 1.2), RAND(1.6, 2.8), GROW(0.5, 1.8), SMOKE, accel=[0, 2.0, 0], drag=0.8),
    looping("mouth_smoke", "puff", 8, 20, SPH(0.4), RAND(0.6, 1.6), RAND(1.5, 2.5), GROW(0.4, 1.6), SMOKE, accel=[0, 1.4, 0], drag=0.9),
    looping("roar_haze", "wisp", 14, 24, SPH(0.6), RAND(2.0, 5.0), RAND(0.4, 0.8), [PR(0.6, 1.2), PR(0.9, 1.6, 2)],
            grad((0, (1, 0.9, 0.85, 0.0)), (0.2, (1, 0.9, 0.85, 0.3)), (1, (0.9, 0.8, 0.8, 0))), drag=1.8),
    looping("gill_steam", "wisp", 16, 40, SPH(0.4), RAND(0.6, 1.8), RAND(0.6, 1.3), [PR(0.3, 0.7)] * 2, grad((0, (1, 0.8, 0.75, 0.6)), (1, (0.9, 0.9, 0.9, 0))),
            accel=[0, 1.8, 0], drag=1.0),
    looping("club_arc", "zigzag", 18, 14, SPH(1.4), 0.0, RAND(0.06, 0.12), [PR(0.5, 1.0), PR(0.3, 0.6, 2)], grad((0, WHITE), (0.5, RED), (1, DEEP)), material="particles_add"),
    looping("club_crackle", "zigzag", 0.8, 3, SPH(0.5), 0.0, RAND(0.08, 0.14), [PR(0.3, 0.6), PR(0.2, 0.4, 2)], grad((0, (1, 0.5, 0.45, 0.9)), (1, DEEP))),
    looping("horn_arc", "zigzag", 0.5, 2, SPH(0.3), 0.0, RAND(0.08, 0.14), [PR(0.4, 0.8), PR(0.2, 0.4, 2)], grad((0, (1, 0.5, 0.45, 0.9)), (1, DEEP))),
    looping("horn_arc_big", "zigzag", 14, 12, SPH(0.8), 0.0, RAND(0.06, 0.12), [PR(0.6, 1.2), PR(0.3, 0.6, 2)], grad((0, WHITE), (0.5, RED), (1, DEEP)), material="particles_add"),
    looping("drip", "drop", 3, 8, SPH(0.4), 0.0, RAND(0.5, 0.9), [PR(0.05, 0.1)] * 2, grad((0, WATER), (1, (0.8, 0.9, 1, 0.3))), accel=[0, -12, 0]),
    looping("shed_flakes", "flake", 9, 30, SPH(2.5), RAND(0.2, 1.0), RAND(0.9, 1.8), [PR(0.1, 0.25)] * 2, grad((0, (0.62, 0.1, 0.13, 1)), (1, (0.3, 0.05, 0.07, 0))), accel=[0, -2.5, 0], drag=1.0),
    looping("gill_bubbles", "bubble", 1.6, 8, SPH(0.6), RAND(0.05, 0.3), RAND(0.8, 1.6), [PR(0.06, 0.16)] * 2, grad((0, WATER), (1, (0.8, 0.9, 1, 0))), accel=[0, 0.9, 0]),
    looping("gill_silt", "puff", 10, 24, SPH(0.8), RAND(0.4, 1.4), RAND(0.7, 1.4), [PR(0.25, 0.55)] * 2, grad((0, SILT), (1, (0.5, 0.45, 0.4, 0))), drag=1.6),
    looping("fin_splash", "drop", 8, 16, SPH(0.3), RAND(1.0, 3.0), RAND(0.3, 0.6), [PR(0.06, 0.12)] * 2, grad((0, WATER), (1, (1, 0.5, 0.5, 0))), accel=[0, -12, 0]),
]


def draw_fin_icon() -> np.ndarray:
    """16x16 inventory icon: a torn crimson strip of fin with dark rays."""
    a = np.zeros((16, 16, 4), dtype=np.uint8)
    rows = ["................", "...........dd...", ".........ddrrd..", ".......ddrrbrd..", "......drrbrrrd..", ".....drbrrrbd...",
            "....drrrbrrrd...", "...drbrrrbrd....", "...drrbrrrd.....", "..drbrrrbd......", "..drrrbrd.......", ".drbrrrd........",
            ".drrbrd.........", ".dkrrd..........", "..dkd...........", "................"]
    col = {"d": (58, 8, 14, 255), "r": (158, 24, 32, 255), "b": (212, 44, 48, 255), "k": (28, 24, 26, 255)}
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in col:
                a[y, x] = col[ch]
    return a


def draw_rows(rows, col) -> np.ndarray:
    a = np.zeros((16, 16, 4), dtype=np.uint8)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in col:
                a[y, x] = col[ch]
    return a


def draw_journal_icon() -> np.ndarray:
    """16x16: a dark leather book, a crimson ridge of plates down its spine, one pale eye on the cover."""
    rows = ["................", "..kkkkkkkkkkk...", "..krpppppppppk..", "..rrpppppppppk..", "..krpppppppppk..",
            "..rrpppkkkpppk..", "..krppkweekppk..", "..rrppkeekkppk..", "..krpppkkkpppk..", "..rrpppppppppk..",
            "..krpppppppppk..", "..rrpppppppppk..", "..krpppppppppk..", "..kkwwwwwwwwwk..", "...kkkkkkkkkkk..", "................"]
    col = {"k": (20, 17, 19, 255), "p": (54, 46, 44, 255), "r": (176, 28, 36, 255), "w": (226, 218, 196, 255), "e": (14, 10, 10, 255)}
    return draw_rows(rows, col)


def draw_wheel_icon() -> np.ndarray:
    """16x16: a copper gear wheel with a crimson hub."""
    rows = ["................", ".......cc.......", "...c..cCCc..c...", "..cCccCddCccCc..", "...cCdddddddCc..",
            "...cddddddddc...", ".ccCddcrrcddCcc.", ".cCCddrRRrddCCc.", ".cCCddrRRrddCCc.", ".ccCddcrrcddCcc.",
            "...cddddddddc...", "...cCdddddddCc..", "..cCccCddCccCc..", "...c..cCCc..c...", ".......cc.......", "................"]
    col = {"c": (122, 62, 40, 255), "C": (196, 112, 76, 255), "d": (150, 82, 54, 255), "r": (120, 14, 22, 255), "R": (214, 40, 46, 255)}
    return draw_rows(rows, col)


def draw_pack_icon(seed=5) -> np.ndarray:
    """256x256: one small pale eye under a brow, in the dark, a crimson ridge behind it."""
    n = 32
    a = np.zeros((n, n, 4), dtype=np.float64)
    rng = np.random.default_rng(seed)
    a[..., :3] = np.array([12, 14, 24]) / 255.0
    a[..., 3] = 1
    for x in range(n):                                   # crimson ridge
        h = int(6 + 5 * abs(np.sin(x * 0.9)) + rng.integers(0, 3))
        for y in range(8 + (x % 3), 8 + (x % 3) - h, -1):
            if 0 <= y < n and 4 < x < 28:
                a[y, x, :3] = np.array([150 + rng.integers(0, 60), 22, 30]) / 255.0
    for y in range(9, n):                                # hide
        for x in range(2, 30):
            if y - 9 >= abs(x - 16) * 0.25:
                v = 26 + rng.integers(0, 26)
                a[y, x, :3] = np.array([v, v - 3, v - 2]) / 255.0
    a[13:16, 6:16, :3] = np.array([14, 12, 13]) / 255.0  # brow
    a[16:18, 10:12, :3] = np.array([238, 233, 208]) / 255.0
    a[17, 11, :3] = np.array([12, 9, 9]) / 255.0
    a[16, 10, :3] = 1.0
    big = np.kron((a * 255).round().astype(np.uint8), np.ones((8, 8, 1), dtype=np.uint8))
    return big


def main():
    os.makedirs(os.path.join(RP, "textures", "particle"), exist_ok=True)
    os.makedirs(os.path.join(RP, "textures", "items"), exist_ok=True)
    os.makedirs(os.path.join(RP, "particles"), exist_ok=True)
    Image.fromarray(draw_sheet(), "RGBA").save(os.path.join(RP, TEX + ".png"))
    Image.fromarray(draw_beam_sheet(), "RGBA").save(os.path.join(RP, TEXB + ".png"))
    Image.fromarray(draw_fin_icon(), "RGBA").save(os.path.join(RP, "textures", "items", f"{NS}_shed_fin.png"))
    Image.fromarray(draw_journal_icon(), "RGBA").save(os.path.join(RP, "textures", "items", f"{NS}_journal.png"))
    Image.fromarray(draw_wheel_icon(), "RGBA").save(os.path.join(RP, "textures", "items", f"{NS}_config_wheel.png"))
    icon = Image.fromarray(draw_pack_icon(), "RGBA")
    icon.save(os.path.join(RP, "pack_icon.png"))
    icon.save(os.path.join(ROOT, "packs", "BP", "pack_icon.png"))
    for f in os.listdir(os.path.join(RP, "particles")):
        os.remove(os.path.join(RP, "particles", f))
    names = []
    for name, data, _ in EFFECTS:
        with open(os.path.join(RP, "particles", f"{NS}_{name}.particle.json"), "w") as f:
            json.dump(data, f, indent=1)
            f.write("\n")
        names.append(name)
    print(f"{len(names)} particle effects, sprite sheet {SHEET}x{SHEET}, item icon, pack icons")
    return names


if __name__ == "__main__":
    main()
