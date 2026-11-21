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


SPH = lambda r: {"minecraft:emitter_shape_sphere": {"radius": r, "direction": "outwards"}}
SHRINK = lambda s: [f"{s} * (1 - v.particle_age / v.particle_lifetime)"] * 2
RAND = lambda a, b: f"math.random({a}, {b})"

EFFECTS = [
    # ---- the beam ---------------------------------------------------------------------------
    beam("beam_core", "streak", "particles_add", WHITE),
    beam("beam_halo", "halo", "particles_blend", (1.0, 0.10, 0.07, 0.9)),
    scatter("beam_spiral", "pixel", 1, 0.02, RAND(0.2, 0.9), 0.28, SHRINK(0.26), grad((0, RED), (0.6, RED), (1, DEEP))),
    scatter("beam_impact", "ember", 9, 0.35, RAND(3, 8), RAND(0.35, 0.8), SHRINK(0.2), grad((0, WHITE), (0.3, HOT), (0.7, RED), (1, DEEP)),
            accel=[0, -12, 0], drag=1.2, material="particles_add"),
    scatter("arc_seg", "zigzag", 1, 0.01, 0, 0.11, [RAND(0.3, 0.55), RAND(0.2, 0.4)], grad((0, WHITE), (0.5, RED), (1, DEEP)), facing="rotate_xyz"),
    # ---- the seam -----------------------------------------------------------------------------
    scatter("seam", "seam", 7, 0, RAND(0.02, 0.2), RAND(0.25, 0.45), [0.09, RAND(0.4, 0.9)], grad((0, WHITE), (0.25, RED), (1, DEEP)),
            shape={"minecraft:emitter_shape_box": {"half_dimensions": [0.12, 4.2, 0.12], "direction": [0, 1, 0]}}, facing="lookat_y"),
    scatter("seam_close", "spark", 26, 0, RAND(0.5, 2.5), RAND(0.4, 0.9), SHRINK(0.3), grad((0, WHITE), (0.4, RED), (1, DEEP)),
            shape={"minecraft:emitter_shape_box": {"half_dimensions": [0.2, 4.2, 0.2], "direction": "outwards"}}, drag=2.0),
    ring("seam_pulse", "ring", 0.4, 2.6, 0.7, grad((0, (1, 0.2, 0.15, 0.9)), (1, DEEP))),
    scatter("fin_spark", "spark", 1, 0.01, 0, 0.5, SHRINK(0.16), grad((0, RED), (1, DEEP))),
    # ---- water ----------------------------------------------------------------------------------
    ring("shock_ring", "ring", 1.0, 7.5, 0.9, grad((0, (0.9, 0.97, 1, 0.9)), (1, (0.9, 0.97, 1, 0))), facing="lookat_xyz"),
    ring("silt_ring", "square_ring", 0.6, 4.6, 1.1, grad((0, SILT), (1, (0.52, 0.47, 0.40, 0)))),
    scatter("silt_puff", "puff", 5, 0.5, RAND(0.2, 0.8), RAND(0.8, 1.6), [RAND(0.25, 0.5)] * 2, grad((0, SILT), (1, (0.5, 0.45, 0.4, 0))), drag=1.5),
    scatter("gravel_cloud", "pixel", 22, 1.2, RAND(0.8, 3), RAND(0.7, 1.6), [RAND(0.08, 0.2)] * 2, grad((0, (0.55, 0.52, 0.5, 1)), (1, (0.4, 0.38, 0.36, 0))),
            accel=[0, -3, 0], drag=1.6),
    scatter("bubble_trail", "bubble", 3, 0.4, RAND(0.05, 0.3), RAND(0.6, 1.2), [RAND(0.08, 0.2)] * 2, grad((0, WATER), (1, (0.8, 0.9, 1, 0))), accel=[0, 0.6, 0]),
    scatter("fin_break", "drop", 8, 0.3, RAND(1.5, 4), RAND(0.4, 0.8), [RAND(0.07, 0.14)] * 2, grad((0, WATER), (0.6, (1, 0.5, 0.5, 0.9)), (1, (0.8, 0.2, 0.2, 0))),
            accel=[0, -14, 0], shape={"minecraft:emitter_shape_sphere": {"radius": 0.3, "direction": [RAND(-0.4, 0.4), 1, RAND(-0.4, 0.4)]}}),
    scatter("splash", "drop", 7, 0.2, RAND(1.5, 3.5), RAND(0.3, 0.6), [RAND(0.06, 0.12)] * 2, grad((0, WATER), (1, (0.8, 0.9, 1, 0))),
            accel=[0, -14, 0], shape={"minecraft:emitter_shape_sphere": {"radius": 0.2, "direction": [RAND(-0.5, 0.5), 1, RAND(-0.5, 0.5)]}}),
    # ---- land -----------------------------------------------------------------------------------
    scatter("grit", "pixel", 6, 0.4, RAND(0.5, 2), RAND(0.4, 0.9), [RAND(0.05, 0.12)] * 2, grad((0, (0.5, 0.48, 0.45, 1)), (1, (0.4, 0.38, 0.36, 0))), accel=[0, -9, 0]),
    scatter("step_dust", "puff", 12, 1.6, RAND(0.6, 2.2), RAND(0.7, 1.5), [RAND(0.3, 0.7)] * 2, grad((0, (0.45, 0.4, 0.34, 0.7)), (1, (0.4, 0.36, 0.3, 0))),
            accel=[0, 0.4, 0], drag=2.2, shape={"minecraft:emitter_shape_disc": {"radius": 1.8, "plane_normal": "y", "direction": "outwards"}}),
    scatter("lamp_flare", "flare", 3, 0.35, 0.05, RAND(0.25, 0.45), SHRINK(0.9), grad((0, (1, 0.9, 0.6, 1)), (0.5, HOT), (1, DEEP)), material="particles_add"),
    # ---- bound to his own body (started by the client animation controller at locators) ----------
    looping("charge_spark", "spark", 26, 40, SPH(1.9), RAND(0.5, 2.5), RAND(0.15, 0.4), SHRINK(0.3), grad((0, WHITE), (0.4, RED), (1, DEEP)), drag=1.0, material="particles_add"),
    looping("plate_ember", "ember", 7, 14, SPH(0.5), RAND(0.2, 1.0), RAND(0.4, 0.9), SHRINK(0.16), grad((0, HOT), (0.5, RED), (1, DEEP)), accel=[0, 1.6, 0]),
    looping("throat_glow", "soft", 9, 12, SPH(0.4), RAND(0.0, 0.3), RAND(0.2, 0.35), SHRINK(0.9), grad((0, (1, 0.85, 0.7, 0.55)), (1, (1, 0.2, 0.1, 0))), material="particles_add"),
    looping("mouth_flare", "flare", 14, 10, SPH(0.2), 0.0, RAND(0.1, 0.16), [RAND(1.6, 2.6)] * 2, grad((0, WHITE), (1, (1, 0.3, 0.2, 0))), material="particles_add"),
    looping("gill_steam", "wisp", 16, 40, SPH(0.4), RAND(0.6, 1.8), RAND(0.6, 1.3), [RAND(0.3, 0.7)] * 2, grad((0, (1, 0.8, 0.75, 0.6)), (1, (0.9, 0.9, 0.9, 0))),
            accel=[0, 1.8, 0], drag=1.0),
    looping("club_arc", "zigzag", 18, 14, SPH(1.4), 0.0, RAND(0.06, 0.12), [RAND(0.5, 1.0), RAND(0.3, 0.6)], grad((0, WHITE), (0.5, RED), (1, DEEP)), material="particles_add"),
    looping("club_crackle", "zigzag", 0.8, 3, SPH(0.5), 0.0, RAND(0.08, 0.14), [RAND(0.3, 0.6), RAND(0.2, 0.4)], grad((0, (1, 0.5, 0.45, 0.9)), (1, DEEP))),
    looping("horn_arc", "zigzag", 0.5, 2, SPH(0.3), 0.0, RAND(0.08, 0.14), [RAND(0.4, 0.8), RAND(0.2, 0.4)], grad((0, (1, 0.5, 0.45, 0.9)), (1, DEEP))),
    looping("horn_arc_big", "zigzag", 14, 12, SPH(0.8), 0.0, RAND(0.06, 0.12), [RAND(0.6, 1.2), RAND(0.3, 0.6)], grad((0, WHITE), (0.5, RED), (1, DEEP)), material="particles_add"),
    looping("drip", "drop", 3, 8, SPH(0.4), 0.0, RAND(0.5, 0.9), [RAND(0.05, 0.1)] * 2, grad((0, WATER), (1, (0.8, 0.9, 1, 0.3))), accel=[0, -12, 0]),
    looping("shed_flakes", "flake", 9, 30, SPH(2.5), RAND(0.2, 1.0), RAND(0.9, 1.8), [RAND(0.1, 0.25)] * 2, grad((0, (0.62, 0.1, 0.13, 1)), (1, (0.3, 0.05, 0.07, 0))), accel=[0, -2.5, 0], drag=1.0),
    looping("gill_bubbles", "bubble", 1.6, 8, SPH(0.6), RAND(0.05, 0.3), RAND(0.8, 1.6), [RAND(0.06, 0.16)] * 2, grad((0, WATER), (1, (0.8, 0.9, 1, 0))), accel=[0, 0.9, 0]),
    looping("gill_silt", "puff", 10, 24, SPH(0.8), RAND(0.4, 1.4), RAND(0.7, 1.4), [RAND(0.25, 0.55)] * 2, grad((0, SILT), (1, (0.5, 0.45, 0.4, 0))), drag=1.6),
    looping("fin_splash", "drop", 8, 16, SPH(0.3), RAND(1.0, 3.0), RAND(0.3, 0.6), [RAND(0.06, 0.12)] * 2, grad((0, WATER), (1, (1, 0.5, 0.5, 0))), accel=[0, -12, 0]),
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
    Image.fromarray(draw_fin_icon(), "RGBA").save(os.path.join(RP, "textures", "items", f"{NS}_shed_fin.png"))
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
