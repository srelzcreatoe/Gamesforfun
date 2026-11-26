"""Particle effects, particle textures and item icons."""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TEX = "textures/particle/sg/"


# ------------------------------------------------------------ particle textures
def _save(arr, path):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA").save(path)


def make_particle_textures(out):
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(7)
    # soft radial glow
    n = 64
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    r = np.sqrt(xx ** 2 + yy ** 2)
    a = np.clip(1 - r, 0, 1) ** 1.8
    core = np.clip(1 - r * 2.2, 0, 1)
    _save(np.dstack([np.full_like(a, 255), np.full_like(a, 255), np.full_like(a, 255), (a * 0.85 + core * 0.15) * 255]), out + "/glow.png")
    # beam strip: bright along x, gaussian across y, soft ends
    w, h = 64, 16
    yy, xx = np.mgrid[0:h, 0:w]
    across = np.exp(-((yy - (h - 1) / 2) / (h * 0.22)) ** 2)
    ends = np.clip(np.minimum(xx, w - 1 - xx) / 6.0, 0, 1)
    a = across * ends
    _save(np.dstack([np.full_like(a, 255.0), np.full_like(a, 255.0), np.full_like(a, 255.0), a * 255]), out + "/beam.png")
    # smoke puffs flipbook (4 frames of 64)
    frames = []
    for i in range(4):
        n = 64
        yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
        r = np.sqrt(xx ** 2 + yy ** 2)
        nz = np.array(Image.fromarray((rng.random((16, 16)) * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)) / 255.0
        a = np.clip(1 - r * (1.0 + 0.6 * (nz - 0.5)), 0, 1) ** 1.3 * (0.55 + 0.45 * nz)
        g = 150 + 90 * nz
        frames.append(np.dstack([g, g, g, a * 255 * (1 - i * 0.12)]))
    _save(np.concatenate(frames, axis=1), out + "/smoke.png")
    # flame flipbook (8 frames of 32)
    frames = []
    for i in range(8):
        n = 32
        yy, xx = np.mgrid[0:n, 0:n] / (n - 1)
        nz = np.array(Image.fromarray((rng.random((8, 8)) * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)) / 255.0
        shape = np.clip(1 - np.abs(xx - 0.5) * 2.2 / np.clip(yy + 0.15, 0.1, 1) - (1 - yy) * 0.3 + (nz - 0.5) * 0.6, 0, 1)
        heat = shape ** 0.7
        rch = 255 * np.ones_like(heat)
        gch = 70 + 185 * heat ** 1.5
        bch = 20 + 160 * heat ** 4
        a = shape * (1 - i / 10)
        frames.append(np.dstack([rch, gch, bch, a * 255]))
    _save(np.concatenate(frames, axis=1), out + "/flame.png")
    # spark (small 4-point star)
    n = 16
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    a = np.clip(1 - np.sqrt(xx ** 2 + yy ** 2) * 1.6, 0, 1) + np.clip(1 - np.abs(xx) * 8, 0, 1) * np.clip(1 - np.abs(yy), 0, 1) + \
        np.clip(1 - np.abs(yy) * 8, 0, 1) * np.clip(1 - np.abs(xx), 0, 1)
    _save(np.dstack([np.full_like(a, 255), np.full_like(a, 255), np.full_like(a, 255), np.clip(a, 0, 1) * 255]), out + "/spark.png")
    # debris chunks (4 frames of 16)
    frames = []
    for i in range(4):
        img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        pts = [(8 + np.cos(t) * rng.uniform(3, 7), 8 + np.sin(t) * rng.uniform(3, 7)) for t in np.linspace(0, 6.28, 7)[:-1]]
        c = int(rng.uniform(110, 170))
        d.polygon(pts, fill=(c, c - 5, c - 10, 255))
        frames.append(np.array(img).astype(float))
    _save(np.concatenate(frames, axis=1), out + "/debris.png")
    # shockwave ring
    n = 128
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    r = np.sqrt(xx ** 2 + yy ** 2)
    a = np.exp(-((r - 0.82) / 0.09) ** 2)
    _save(np.dstack([np.full_like(a, 255), np.full_like(a, 255), np.full_like(a, 255), a * 255]), out + "/ring.png")
    # droplet
    n = 16
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    a = np.clip(1 - np.sqrt(xx ** 2 + (yy * 0.8) ** 2) * 1.3, 0, 1) ** 0.6
    _save(np.dstack([np.full_like(a, 255), np.full_like(a, 255), np.full_like(a, 255), a * 255]), out + "/drop.png")


# ------------------------------------------------------------ particle json
def P(ident, texture, material, comps):
    return {"format_version": "1.10.0", "particle_effect": {
        "description": {"identifier": ident, "basic_render_parameters": {"material": material, "texture": TEX + texture}},
        "components": comps}}


def uv_full(w, h):
    return {"texture_width": w, "texture_height": h, "uv": [0, 0], "uv_size": [w, h]}


def flip(w, h, fw, frames, fps, stretch=False):
    return {"texture_width": w, "texture_height": h, "flipbook": {
        "base_UV": [0, 0], "size_UV": [fw, h], "step_UV": [fw, 0], "frames_per_second": fps,
        "max_frame": frames, "stretch_to_lifetime": stretch, "loop": False}}


DIR = ["variable.dx", "variable.dy", "variable.dz"]


def spread(k):
    return ["variable.dx+math.random(-%g,%g)" % (k, k), "variable.dy+math.random(-%g,%g)" % (k, k), "variable.dz+math.random(-%g,%g)" % (k, k)]


def particles():
    fx = {}
    # --- atomic beam: oriented core streak + round glow orbs
    def streak(ident, width, color, life):
        return P(ident, "beam", "particles_add", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_point": {"direction": DIR},
            "minecraft:particle_initial_speed": 0.01,
            "minecraft:particle_lifetime_expression": {"max_lifetime": life},
            "minecraft:particle_appearance_billboard": {"size": ["variable.len", width], "facing_camera_mode": "lookat_direction", "uv": uv_full(64, 16)},
            "minecraft:particle_appearance_tinting": {"color": color},
        })

    def orb(ident, size, color, life):
        return P(ident, "glow", "particles_add", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": life},
            "minecraft:particle_appearance_billboard": {"size": [size, size], "facing_camera_mode": "lookat_xyz", "uv": uv_full(64, 64)},
            "minecraft:particle_appearance_tinting": {"color": color},
        })
    fx["beam_core"] = streak("sg:beam_core", 0.55, [1.0, 0.92, 1.0, 1.0], 0.11)
    fx["beam_glow"] = orb("sg:beam_glow", "variable.len*0.55", [0.62, 0.28, 1.0, 0.85], 0.12)
    fx["ray_core"] = streak("sg:ray_core", 0.22, [1.0, 0.9, 1.0, 1.0], 0.1)
    fx["ray_glow"] = orb("sg:ray_glow", "variable.len*0.4", [0.6, 0.25, 1.0, 0.7], 0.1)
    fx["mouth_glow"] = orb("sg:mouth_glow", 2.6, [0.85, 0.6, 1.0, 0.9], 0.2)

    fx["beam_impact"] = P("sg:beam_impact", "spark", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 10},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 0.8, "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(6,16)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -14, 0], "linear_drag_coefficient": 1.2},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.4,0.9)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.35*(1-v.particle_age/v.particle_lifetime)+0.05", "0.35*(1-v.particle_age/v.particle_lifetime)+0.05"], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": "v.particle_age/v.particle_lifetime",
                                                            "gradient": {"0.0": "#FFFFFFFF", "0.3": "#FFC890FF", "1.0": "#FF8A2BE2"}}},
    })
    fx["dorsal_glow"] = P("sg:dorsal_glow", "spark", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 3},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 1.2, "direction": [0, 1, 0]},
        "minecraft:particle_initial_speed": "math.random(1.5,4)",
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.4,0.8)"},
        "minecraft:particle_appearance_billboard": {"size": [0.45, 0.45], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": [0.78, 0.5, 1.0, 1.0]},
    })
    # --- smoke and fire from the mouth
    fx["smoke_plume"] = P("sg:smoke_plume", "smoke", "particles_blend", {
        "minecraft:emitter_rate_instant": {"num_particles": 5},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 0.8, "direction": spread(0.25)},
        "minecraft:particle_initial_speed": "variable.spd*math.random(0.5,1.0)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 1.2, 0], "linear_drag_coefficient": 1.6},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(2.0,3.2)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-30,30)"},
        "minecraft:particle_appearance_billboard": {"size": ["1.2+v.particle_age*2.6", "1.2+v.particle_age*2.6"], "facing_camera_mode": "rotate_xyz",
                                                    "uv": flip(256, 64, 64, 4, 1.5, True)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": "v.particle_age/v.particle_lifetime",
                                                            "gradient": {"0.0": "#E0201418", "0.6": "#B01A1416", "1.0": "#00100C0C"}}},
        "minecraft:particle_appearance_lighting": {},
    })
    fx["fire_spray"] = P("sg:fire_spray", "flame", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 10},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 0.5, "direction": spread(0.16)},
        "minecraft:particle_initial_speed": "variable.spd*math.random(0.6,1.0)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 2, 0], "linear_drag_coefficient": 0.9},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.7,1.1)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.6+v.particle_age*4", "0.6+v.particle_age*4"], "facing_camera_mode": "rotate_xyz",
                                                    "uv": flip(256, 32, 32, 8, 8, True)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": "v.particle_age/v.particle_lifetime",
                                                            "gradient": {"0.0": "#FFFFF0D0", "0.25": "#FFFF9A30", "0.7": "#C0E03010", "1.0": "#00401008"}}},
    })
    # --- the breath stream itself: colour, tightness and speed are driven by the script so
    #     one effect carries orange fire -> white heat -> magenta -> the forming beam
    age = "v.particle_age/v.particle_lifetime"
    fx["breath_stream"] = P("sg:breath_stream", "glow", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 9},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 0.5, "direction": [
            "variable.dx+math.random(-variable.spread,variable.spread)",
            "variable.dy+math.random(-variable.spread,variable.spread)",
            "variable.dz+math.random(-variable.spread,variable.spread)"]},
        "minecraft:particle_initial_speed": "variable.spd*math.random(0.7,1.0)",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 0.5},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.7,1.1)"},
        "minecraft:particle_appearance_billboard": {"size": ["variable.size*(0.7+v.particle_age*2.4)", "variable.size*(0.7+v.particle_age*2.4)"],
                                                    "facing_camera_mode": "lookat_xyz", "uv": uv_full(64, 64)},
        "minecraft:particle_appearance_tinting": {"color": ["variable.cr", "variable.cg", "variable.cb", "1-" + age]},
    })
    fx["ground_fire"] = P("sg:ground_fire", "flame", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 14},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_disc": {"radius": 3.5, "plane_normal": "y", "direction": ["math.random(-0.4,0.4)", 1, "math.random(-0.4,0.4)"]},
        "minecraft:particle_initial_speed": "math.random(2,6)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 3, 0], "linear_drag_coefficient": 1.0},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.8,1.6)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(-20,20)"},
        "minecraft:particle_appearance_billboard": {"size": ["1.2+v.particle_age*2.6", "1.2+v.particle_age*2.6"], "facing_camera_mode": "rotate_xyz",
                                                    "uv": flip(256, 32, 32, 8, 8, True)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": age, "gradient": {"0.0": "#FFFFF0D0", "0.3": "#FFFF9A30", "0.75": "#C0E03010", "1.0": "#00401008"}}},
    })
    fx["haze"] = P("sg:haze", "glow", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 1},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.9},
        "minecraft:particle_appearance_billboard": {"size": ["variable.size", "variable.size"], "facing_camera_mode": "lookat_xyz", "uv": uv_full(64, 64)},
        "minecraft:particle_appearance_tinting": {"color": [0.5, 0.2, 1.0, "0.16*math.sin(" + age + "*180)"]},
    })
    # --- charge-up: the surge of light that runs up the tail and back, rising embers, the flash
    fx["surge"] = P("sg:surge", "glow", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 1},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.45},
        "minecraft:particle_appearance_billboard": {"size": ["variable.size*(1-" + age + "*0.6)", "variable.size*(1-" + age + "*0.6)"],
                                                    "facing_camera_mode": "lookat_xyz", "uv": uv_full(64, 64)},
        "minecraft:particle_appearance_tinting": {"color": [0.9, 0.7, 1.0, "1-" + age]},
    })
    fx["embers"] = P("sg:embers", "spark", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 18},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_disc": {"radius": "variable.size", "plane_normal": "y", "direction": ["math.random(-0.3,0.3)", 1, "math.random(-0.3,0.3)"]},
        "minecraft:particle_initial_speed": "math.random(3,9)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 2, 0], "linear_drag_coefficient": 0.4},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.2,2.4)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.3*(1-" + age + ")+0.06", "0.3*(1-" + age + ")+0.06"], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": age, "gradient": {"0.0": "#FFFFFFFF", "0.4": "#FFD9A6FF", "1.0": "#008A2BE2"}}},
    })
    fx["flash"] = P("sg:flash", "glow", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 1},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.5},
        "minecraft:particle_appearance_billboard": {"size": ["variable.size*(0.4+" + age + ")", "variable.size*(0.4+" + age + ")"],
                                                    "facing_camera_mode": "lookat_xyz", "uv": uv_full(64, 64)},
        "minecraft:particle_appearance_tinting": {"color": [0.92, 0.8, 1.0, "(1-" + age + ")*0.9"]},
    })
    # --- steam, frost, freeze, evolution
    fx["steam"] = P("sg:steam", "smoke", "particles_blend", {
        "minecraft:emitter_rate_instant": {"num_particles": 3},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 1.5, "direction": [0, 1, 0]},
        "minecraft:particle_initial_speed": "math.random(1,2.5)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.8, 0], "linear_drag_coefficient": 0.5},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(2.5,4)"},
        "minecraft:particle_appearance_billboard": {"size": ["1+v.particle_age*1.4", "1+v.particle_age*1.4"], "facing_camera_mode": "rotate_xyz",
                                                    "uv": flip(256, 64, 64, 4, 1, True)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": "v.particle_age/v.particle_lifetime",
                                                            "gradient": {"0.0": "#A0FFFFFF", "1.0": "#00FFFFFF"}}},
    })
    fx["frost"] = P("sg:frost", "spark", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 4},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 2.5},
        "minecraft:particle_initial_speed": 0.3,
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -0.6, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 3},
        "minecraft:particle_appearance_billboard": {"size": [0.2, 0.2], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": [0.8, 0.95, 1.0, 0.9]},
    })
    fx["freeze_burst"] = P("sg:freeze_burst", "spark", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 40},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 3, "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(2,8)",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 1.5, "linear_acceleration": [0, -1, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1,2.5)"},
        "minecraft:particle_appearance_billboard": {"size": [0.35, 0.35], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": [0.75, 0.92, 1.0, 1.0]},
    })
    fx["coagulant"] = P("sg:coagulant", "smoke", "particles_blend", {
        "minecraft:emitter_rate_instant": {"num_particles": 12},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 1, "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(1,4)",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 1.0},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.5,2.5)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.8+v.particle_age", "0.8+v.particle_age"], "facing_camera_mode": "rotate_xyz", "uv": flip(256, 64, 64, 4, 2, True)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": "v.particle_age/v.particle_lifetime",
                                                            "gradient": {"0.0": "#E0D8F0FF", "1.0": "#00C0E0FF"}}},
    })
    fx["evolve_burst"] = P("sg:evolve_burst", "spark", "particles_add", {
        "minecraft:emitter_rate_instant": {"num_particles": 16},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 1.5, "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(2,7)",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 1.2, "linear_acceleration": [0, 2, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.6,1.4)"},
        "minecraft:particle_appearance_billboard": {"size": [0.5, 0.5], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": "v.particle_age/v.particle_lifetime",
                                                            "gradient": {"0.0": "#FFFFD080", "0.5": "#FFFF4020", "1.0": "#00800808"}}},
    })
    # --- footsteps, rubble, shockwave, gill blood
    fx["dust"] = P("sg:dust", "smoke", "particles_blend", {
        "minecraft:emitter_rate_instant": {"num_particles": 16},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_disc": {"radius": 2.5, "plane_normal": "y", "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(3,7)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.6, 0], "linear_drag_coefficient": 2.2},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.2,2.2)"},
        "minecraft:particle_appearance_billboard": {"size": ["1+v.particle_age*1.6", "1+v.particle_age*1.6"], "facing_camera_mode": "rotate_xyz", "uv": flip(256, 64, 64, 4, 2, True)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": "v.particle_age/v.particle_lifetime",
                                                            "gradient": {"0.0": "#C08A7A66", "1.0": "#00807060"}}},
        "minecraft:particle_appearance_lighting": {},
    })
    fx["debris"] = P("sg:debris", "debris", "particles_alpha", {
        "minecraft:emitter_rate_instant": {"num_particles": 14},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_box": {"half_dimensions": [3, 4, 1], "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(3,9)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -20, 0]},
        "minecraft:particle_motion_collision": {"collision_radius": 0.2, "coefficient_of_restitution": 0.2, "collision_drag": 4},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.5,2.5)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-200,200)"},
        "minecraft:particle_appearance_billboard": {"size": ["math.random(0.2,0.6)", "math.random(0.2,0.6)"], "facing_camera_mode": "rotate_xyz",
                                                    "uv": {"texture_width": 64, "texture_height": 16, "uv": ["math.floor(math.random(0,4))*16", 0], "uv_size": [16, 16]}},
        "minecraft:particle_appearance_lighting": {},
    })
    fx["shockwave"] = P("sg:shockwave", "ring", "particles_blend", {
        "minecraft:emitter_rate_instant": {"num_particles": 1},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {"offset": [0, 0.3, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.7},
        "minecraft:particle_appearance_billboard": {"size": ["1+v.particle_age*22", "1+v.particle_age*22"], "facing_camera_mode": "emitter_transform_xz", "uv": uv_full(128, 128)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": "v.particle_age/v.particle_lifetime",
                                                            "gradient": {"0.0": "#C0D8C8B0", "1.0": "#00D8C8B0"}}},
    })
    fx["blood_spray"] = P("sg:blood_spray", "drop", "particles_alpha", {
        "minecraft:emitter_rate_steady": {"spawn_rate": 40, "max_particles": 60},
        "minecraft:emitter_lifetime_once": {"active_time": 0.8},
        "minecraft:emitter_shape_sphere": {"radius": 0.6, "direction": ["variable.dx+math.random(-0.3,0.3)", "0.4+math.random(0,0.5)", "variable.dz+math.random(-0.3,0.3)"]},
        "minecraft:particle_initial_speed": "math.random(3,7)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -16, 0]},
        "minecraft:particle_motion_collision": {"collision_radius": 0.1, "expire_on_contact": True},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 2},
        "minecraft:particle_appearance_billboard": {"size": [0.16, 0.16], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": [0.62, 0.02, 0.05, 1.0]},
        "minecraft:particle_appearance_lighting": {},
    })
    return fx


# ------------------------------------------------------------ item icons
def make_item_icons(out):
    os.makedirs(out, exist_ok=True)
    S = 32
    # Yashiori coagulant canister: steel cylinder with a translucent blue-white window
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([9, 5, 22, 29], 3, fill=(150, 158, 170, 255), outline=(60, 64, 72, 255))
    d.rectangle([12, 2, 19, 6], fill=(90, 96, 106, 255), outline=(50, 54, 60, 255))
    d.rectangle([11, 10, 20, 25], fill=(210, 238, 255, 255), outline=(80, 120, 160, 255))
    d.rectangle([11, 16, 20, 25], fill=(120, 200, 255, 255))
    d.line([13, 11, 13, 24], fill=(255, 255, 255, 200))
    d.rectangle([9, 13, 22, 14], fill=(230, 200, 40, 255))
    img.save(out + "/yashiori_coagulant.png")
    # Kaiju control tablet: dark slate with purple-lit kaiju silhouette
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([3, 6, 28, 26], 3, fill=(36, 38, 44, 255), outline=(12, 12, 16, 255))
    d.rectangle([6, 9, 25, 23], fill=(14, 8, 26, 255))
    sil = [(11, 22), (12, 16), (14, 13), (15, 10), (17, 10), (17, 12), (16, 13), (18, 15), (19, 18), (23, 21), (24, 22)]
    d.polygon(sil, fill=(150, 70, 255, 255))
    for x, y in ((13, 12), (14, 11), (15, 14)):
        d.point((x, y), fill=(230, 200, 255, 255))
    d.line([6, 20, 10, 20], fill=(90, 230, 120, 255))
    d.ellipse([14, 23, 17, 25], fill=(80, 80, 90, 255))
    img.save(out + "/kaiju_tablet.png")
    # G-cell sample: glowing red cell cluster in a vial
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([11, 4, 20, 28], 4, fill=(200, 225, 235, 120), outline=(120, 140, 150, 255))
    for cx, cy, r in ((15, 20, 4), (17, 15, 3), (14, 12, 3), (16, 24, 2)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(200, 24, 30, 255), outline=(255, 90, 60, 255))
    d.rectangle([10, 3, 21, 5], fill=(70, 70, 80, 255))
    img.save(out + "/g_cell.png")
