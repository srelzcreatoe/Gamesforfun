"""Particle effects, particle textures, HUD textures and item icons.

The beams are built the way a long exposure of the film looks: a handful of long
quads laid end to end from the mouth to the impact, in three layers (a soft
violet glow, a turbulent plasma sheath and a white-hot core), with light pulsing
along them, sparks and small lightning crawling over them, a flare at the mouth
and a boiling blast where they land.  Everything is tinted by the script, so
one set of effects carries orange fire, white heat, magenta and violet.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TEX = "textures/particle/sg/"


# ------------------------------------------------------------ particle textures
def _save(arr, path):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA").save(path)


def _white(a):
    return np.dstack([np.full_like(a, 255.0), np.full_like(a, 255.0), np.full_like(a, 255.0), np.clip(a, 0, 1) * 255])


def _wave(rng, w, freqs, amp=1.0):
    """1-D noise that tiles over w pixels (integer frequencies only)."""
    x = np.arange(w) / w * 2 * np.pi
    out = np.zeros(w)
    for f in freqs:
        out += np.sin(x * f + rng.uniform(0, 6.28)) * rng.uniform(0.5, 1.0) / (1 + 0.25 * f)
    return out / max(1e-6, np.abs(out).max()) * amp


def _noise(rng, n, cells):
    return np.array(Image.fromarray((rng.random((cells, cells)) * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)).astype(float) / 255.0


def _puff(rng, n, lobes):
    """A cumulus-like clump of soft balls with a ragged edge, lit from the upper left: (grey, alpha)."""
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    keep = np.ones((n, n))
    for i in range(lobes):
        a = rng.uniform(0, 6.28)
        d = rng.uniform(0.12, 0.52) if i > 1 else rng.uniform(0, 0.12)
        cx, cy = np.cos(a) * d, np.sin(a) * d * 0.85
        r = rng.uniform(0.2, 0.34) if i > 1 else rng.uniform(0.36, 0.46)
        ball = np.clip((r - np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)) / (r * 0.9), 0, 1) ** 0.9
        keep *= 1 - ball
    dens = 1 - keep
    grain = 0.55 * _noise(rng, n, 6) + 0.45 * _noise(rng, n, 14)
    dens = np.clip(dens * (0.62 + 0.6 * grain) - 0.06, 0, 1)
    dens *= np.clip((1.0 - np.sqrt(xx ** 2 + yy ** 2)) / 0.14, 0, 1)      # never touch the tile edge
    soft = np.array(Image.fromarray((dens * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(n / 26))).astype(float) / 255
    sh = np.roll(np.roll(soft, n // 14, axis=0), n // 14, axis=1)
    light = np.clip(0.66 + (soft - sh) * 1.1 + (grain - 0.5) * 0.18, 0.3, 1.0)
    return light, np.clip(dens * 1.25, 0, 1) ** 1.1


def make_particle_textures(out):
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(7)
    # ---- soft radial glow
    n = 64
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    r = np.sqrt(xx ** 2 + yy ** 2)
    a = np.clip(1 - r, 0, 1) ** 1.8
    core = np.clip(1 - r * 2.2, 0, 1)
    _save(_white(a * 0.85 + core * 0.15), out + "/glow.png")

    # ---- beam atlas, 512 x 256: left half 8 plasma sheaths, right half 8 cores (each 256 x 32).
    #      Every strip tiles along its length, so segments laid end to end show no seam.
    W, H = 256, 32
    yn = (np.arange(H) - (H - 1) / 2) / ((H - 1) / 2)
    Y = np.abs(yn)[:, None]
    atlas = np.zeros((H * 8, W * 2))
    for row in range(8):
        edge = 0.66 + _wave(rng, W, (2, 3, 5, 8, 13), 0.2)[None, :]
        bright = 0.8 + _wave(rng, W, (1, 3, 4, 7), 0.2)[None, :]
        x = np.arange(W)[None, :] / W * 2 * np.pi
        wisps = sum(np.sin(x * f + yn[:, None] * rng.uniform(2, 5) + rng.uniform(0, 6.28)) for f in (5, 9, 14)) / 3
        sheath = np.clip((edge - Y) / 0.34, 0, 1) ** 1.25 * bright * (0.9 + 0.1 * wisps)
        atlas[row * H:(row + 1) * H, :W] = sheath * np.clip((1 - Y) / 0.1, 0, 1)
        rad = 0.42 + _wave(rng, W, (3, 5, 9), 0.07)[None, :]
        nodes = 1 + 0.25 * np.clip(_wave(rng, W, (6, 10, 15)), 0, 1)[None, :]
        c = np.exp(-(Y / rad) ** 2 * 2.4) * nodes
        atlas[row * H:(row + 1) * H, W:] = np.clip(c, 0, 1) * np.clip((1 - Y) / 0.12, 0, 1)
    _save(_white(atlas), out + "/beam.png")
    # ---- the glow around a beam: a plain soft band
    g = np.exp(-(yn[:, None] * np.ones((1, 64)) / 0.5) ** 2) * np.clip((1 - Y) / 0.2, 0, 1)
    _save(_white(g), out + "/glowstrip.png")

    # ---- smoke: four clumped puffs (128 px each)
    tiles = []
    for i in range(4):
        light, alpha = _puff(rng, 128, 11)
        v = 255 * light
        tiles.append(np.dstack([v, v, v, alpha * 255]))
    _save(np.concatenate(tiles, axis=1), out + "/smoke.png")
    # ---- rolling fire: the same clumps, but bright in the middle (drawn additively)
    tiles = []
    for i in range(4):
        light, alpha = _puff(rng, 128, 10)
        heat = alpha ** 1.6
        tiles.append(np.dstack([255 * np.ones_like(heat), 140 + 115 * heat * light, 50 + 205 * (heat * light) ** 2.5, alpha * 255]))
    _save(np.concatenate(tiles, axis=1), out + "/fire.png")
    # ---- flame tongues flipbook (8 frames of 64)
    frames = []
    for i in range(8):
        n = 64
        yy, xx = np.mgrid[0:n, 0:n] / (n - 1)
        nz = np.array(Image.fromarray((rng.random((8, 8)) * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)) / 255.0
        lean = (nz - 0.5) * 0.35 * (1 - yy)
        width = 0.42 * np.clip(yy + 0.12, 0.05, 1) ** 0.8
        shape = np.clip(1 - np.abs(xx - 0.5 + lean) / width, 0, 1) * np.clip((yy - 0.02 - i * 0.02) / 0.25, 0, 1) ** 0.6
        shape = np.clip(shape * (0.75 + 0.5 * nz), 0, 1)
        heat = shape ** 0.8
        frames.append(np.dstack([255 * np.ones_like(heat), 90 + 165 * heat ** 1.4, 30 + 190 * heat ** 3.5, shape * (1 - i / 11) * 255]))
    _save(np.concatenate(frames, axis=1), out + "/flame.png")

    # ---- spark (small 4-point star)
    n = 16
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    a = np.clip(1 - np.sqrt(xx ** 2 + yy ** 2) * 1.6, 0, 1) + np.clip(1 - np.abs(xx) * 8, 0, 1) * np.clip(1 - np.abs(yy), 0, 1) + \
        np.clip(1 - np.abs(yy) * 8, 0, 1) * np.clip(1 - np.abs(xx), 0, 1)
    _save(_white(a), out + "/spark.png")
    # ---- star flare (six thin rays over a hot centre)
    n = 64
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    r = np.sqrt(xx ** 2 + yy ** 2)
    ang = np.arctan2(yy, xx)
    rays = np.clip(np.cos(ang * 3) ** 2, 0, 1) ** 24 * np.clip(1 - r, 0, 1) ** 1.2
    a = np.clip(1 - r * 2.4, 0, 1) ** 1.5 + rays * 0.9 + np.clip(1 - r, 0, 1) ** 3 * 0.35
    _save(_white(a), out + "/star.png")
    # ---- lightning: four jagged, branching bolts running the full width of their tile
    tiles = []
    for i in range(4):
        n = 64
        img = Image.new("L", (n * 4, n * 4), 0)
        d = ImageDraw.Draw(img)

        def bolt(p0, p1, depth, width):
            pts = [p0, p1]
            for _ in range(depth):
                nxt = [pts[0]]
                for a_, b_ in zip(pts, pts[1:]):
                    ln = np.hypot(b_[0] - a_[0], b_[1] - a_[1])
                    nxt += [((a_[0] + b_[0]) / 2 + rng.uniform(-0.1, 0.1) * ln, (a_[1] + b_[1]) / 2 + rng.uniform(-0.3, 0.3) * ln), b_]
                pts = nxt
            d.line(pts, fill=255, width=width, joint="curve")
            return pts
        main = bolt((0, n * 2), (n * 4 - 1, n * 2 + rng.uniform(-20, 20)), 4, 7)
        for _ in range(2):
            s = main[int(rng.integers(3, len(main) - 3))]
            bolt(s, (s[0] + rng.uniform(30, 80), s[1] + rng.uniform(-70, 70)), 3, 4)
        img = img.resize((n, n), Image.LANCZOS)
        glow = np.array(img.filter(ImageFilter.GaussianBlur(2.2))).astype(float) / 255
        tiles.append(np.clip(np.array(img).astype(float) / 255 + glow * 0.9, 0, 1))
    _save(_white(np.concatenate(tiles, axis=1)), out + "/bolt.png")
    # ---- claw slash: a tapering crescent
    n = 64
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    r = np.sqrt((xx + 0.55) ** 2 + yy ** 2)
    ang = np.arctan2(yy, xx + 0.55)
    band = np.exp(-((r - 1.15) / (0.11 * np.clip(np.cos(ang * 1.25), 0, 1) + 1e-3)) ** 2) * np.clip(np.cos(ang * 1.25), 0, 1)
    _save(_white(band), out + "/slash.png")
    # ---- debris chunks (4 frames of 16)
    frames = []
    for i in range(4):
        img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        pts = [(8 + np.cos(t) * rng.uniform(3, 7), 8 + np.sin(t) * rng.uniform(3, 7)) for t in np.linspace(0, 6.28, 7)[:-1]]
        c = int(rng.uniform(110, 170))
        d.polygon(pts, fill=(c, c - 5, c - 10, 255))
        frames.append(np.array(img).astype(float))
    _save(np.concatenate(frames, axis=1), out + "/debris.png")
    # ---- shockwave ring
    n = 128
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    r = np.sqrt(xx ** 2 + yy ** 2)
    a = np.exp(-((r - 0.82) / 0.09) ** 2)
    _save(_white(a), out + "/ring.png")
    # ---- droplet
    n = 16
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    a = np.clip(1 - np.sqrt(xx ** 2 + (yy * 0.8) ** 2) * 1.3, 0, 1) ** 0.6
    _save(_white(a), out + "/drop.png")


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


AGE = "v.particle_age/v.particle_lifetime"
R1 = "v.particle_random_1"
DIR = ["variable.dx", "variable.dy", "variable.dz"]
VEL = {"mode": "derive_from_velocity", "min_speed_threshold": 0.001}
ONCE = {"minecraft:emitter_lifetime_once": {"active_time": 0.05}}
PUFF = {"texture_width": 512, "texture_height": 128, "uv": ["math.floor(%s*3.99)*128" % R1, 0], "uv_size": [128, 128]}
SMOKE_FLIP = (512, 128, 128, 4)
FLAME_FLIP = (512, 64, 64, 8)
HOT = {"0.0": "#FFFFF6E0", "0.2": "#FFFFB050", "0.55": "#F0F04818", "1.0": "#00500A08"}       # white -> orange -> red
ATOMIC = {"0.0": "#FFFFFFFF", "0.3": "#FFE8B8FF", "0.7": "#F0A040F0", "1.0": "#005010A0"}     # white -> lilac -> violet


def spread(k, ky=None):
    ky = k if ky is None else ky
    return ["variable.dx+math.random(-%g,%g)" % (k, k), "variable.dy+math.random(-%g,%g)" % (ky, ky), "variable.dz+math.random(-%g,%g)" % (k, k)]


def instant(n):
    return dict(ONCE, **{"minecraft:emitter_rate_instant": {"num_particles": n}})


def grow(a, b, k="variable.width"):
    """size that swells from a*k to b*k over the particle's life, with a little variety."""
    e = "(%g+%g*%s)*%s*(0.75+0.5*%s)" % (a, b - a, AGE, k, R1)
    return [e, e]


def particles():
    fx = {}

    # ================================================================== the beam
    def segment(ident, tex, material, uv, half_width, color, life=0.09):
        """One long quad from the emitter to len blocks along (dx,dy,dz)."""
        c = instant(1)
        c.update({
            "minecraft:emitter_shape_point": {"offset": ["variable.dx*variable.len*0.5", "variable.dy*variable.len*0.5", "variable.dz*variable.len*0.5"],
                                              "direction": DIR},
            "minecraft:particle_initial_speed": 0.05,
            "minecraft:particle_motion_dynamic": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": life},
            "minecraft:particle_appearance_billboard": {"size": ["variable.len*0.5", half_width], "facing_camera_mode": "lookat_direction",
                                                        "direction": VEL, "uv": uv},
            "minecraft:particle_appearance_tinting": {"color": color},
        })
        return P(ident, tex, material, c)
    row = "math.floor(%s*7.99)*32" % R1
    tint = ["variable.cr", "variable.cg", "variable.cb"]
    fx["beam_glow"] = segment("sg:beam_glow", "glowstrip", "particles_blend", uv_full(64, 32), "variable.width*2.0", tint + [0.4])
    fx["beam_halo"] = segment("sg:beam_halo", "beam", "particles_add", {"texture_width": 512, "texture_height": 256, "uv": [0, row], "uv_size": [256, 32]},
                              "variable.width*1.05", tint + [0.95])
    fx["beam_core"] = segment("sg:beam_core", "beam", "particles_add", {"texture_width": 512, "texture_height": 256, "uv": [256, row], "uv_size": [256, 32]},
                              "variable.width*0.62", ["0.9+0.1*variable.cr", "0.88+0.12*variable.cg", "0.92+0.08*variable.cb", 1.0])

    def along(n, speed_k, drag):
        """n particles thrown from the emitter that come to rest spread along len blocks."""
        return dict(instant(n), **{
            "minecraft:particle_initial_speed": "math.random(0.03,1.0)*variable.len*%g" % speed_k,
        }), {"linear_drag_coefficient": drag}
    # light pulsing down the beam
    c = instant(1)
    c.update({
        "minecraft:emitter_shape_point": {"direction": DIR},
        "minecraft:particle_initial_speed": 120,
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.max(0.05, variable.len/120)"},
        "minecraft:particle_appearance_billboard": {"size": ["variable.width*1.15", "variable.width*1.15"], "facing_camera_mode": "lookat_xyz", "uv": uv_full(64, 64)},
        "minecraft:particle_appearance_tinting": {"color": ["0.7+0.3*variable.cr", "0.7+0.3*variable.cg", "0.8+0.2*variable.cb", 0.85]},
    })
    fx["beam_pulse"] = P("sg:beam_pulse", "glow", "particles_add", c)
    # rings thrown off around the beam, facing along it
    c = instant(1)
    c.update({
        "minecraft:emitter_shape_point": {"direction": DIR},
        "minecraft:particle_initial_speed": 55,
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.clamp(variable.len/55, 0.1, 0.55)"},
        "minecraft:particle_appearance_billboard": {"size": ["variable.width*(1.2+2.6*%s)" % AGE, "variable.width*(1.2+2.6*%s)" % AGE],
                                                    "facing_camera_mode": "direction_z", "direction": VEL, "uv": uv_full(128, 128)},
        "minecraft:particle_appearance_tinting": {"color": ["variable.cr", "variable.cg", "variable.cb", "0.8*(1-%s)" % AGE]},
    })
    fx["beam_ring"] = P("sg:beam_ring", "ring", "particles_add", c)
    # sparks shed all along it
    c, m = along(9, 6.0, 6.0)
    c.update({
        "minecraft:emitter_shape_point": {"direction": spread(0.3)},
        "minecraft:particle_motion_dynamic": dict(m, linear_acceleration=[0, -8, 0]),
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.3,0.7)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.34*(1-%s)+0.04" % AGE, "0.34*(1-%s)+0.04" % AGE], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": ATOMIC}},
    })
    fx["beam_sparks"] = P("sg:beam_sparks", "spark", "particles_add", c)
    # small lightning crawling over it
    c, m = along(5, 5.0, 5.0)
    c.update({
        "minecraft:emitter_shape_point": {"direction": spread(0.05)},
        "minecraft:particle_motion_dynamic": m,
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.08,0.2)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)"},
        "minecraft:particle_appearance_billboard": {"size": ["variable.width*(1.1+1.3*%s)" % R1, "variable.width*(0.7+0.8*v.particle_random_2)"],
                                                    "facing_camera_mode": "rotate_xyz",
                                                    "uv": {"texture_width": 256, "texture_height": 64, "uv": ["math.floor(v.particle_random_3*3.99)*64", 0], "uv_size": [64, 64]}},
        "minecraft:particle_appearance_tinting": {"color": ["0.85+0.15*variable.cr", "0.8+0.2*variable.cg", 1.0, "1-%s" % AGE]},
    })
    fx["beam_bolt"] = P("sg:beam_bolt", "bolt", "particles_add", c)
    # scorched air peeling off behind it
    c, m = along(5, 4.0, 4.0)
    c.update({
        "minecraft:emitter_shape_point": {"direction": spread(0.1)},
        "minecraft:particle_motion_dynamic": dict(m, linear_acceleration=[0, 1.8, 0]),
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.4,2.6)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.5, 1.7), "facing_camera_mode": "lookat_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#00402060", "0.1": "#B0301848", "0.5": "#80201820", "1.0": "#00100C10"}}},
    })
    fx["beam_wisp"] = P("sg:beam_wisp", "smoke", "particles_blend", c)

    # ================================================================== mouth
    def orb(ident, size, color, life, tex="glow", extra=None):
        c = instant(1)
        c.update({
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": life},
            "minecraft:particle_appearance_billboard": {"size": [size, size], "facing_camera_mode": "lookat_xyz", "uv": uv_full(64, 64)},
            "minecraft:particle_appearance_tinting": {"color": color},
        })
        c.update(extra or {})
        return P(ident, tex, "particles_add", c)
    fx["mouth_glow"] = orb("sg:mouth_glow", "variable.size", ["variable.cr", "variable.cg", "variable.cb", "0.9*(1-%s)" % AGE], 0.2)
    fx["mouth_burst"] = orb("sg:mouth_burst", "variable.width*(2.3+0.6*%s)" % R1, ["0.75+0.25*variable.cr", "0.7+0.3*variable.cg", "0.85+0.15*variable.cb", "1-%s" % AGE], 0.13)
    fx["mouth_star"] = orb("sg:mouth_star", "variable.width*(3.2+1.4*%s)" % R1, ["0.8+0.2*variable.cr", "0.75+0.25*variable.cg", 1.0, "1-%s" % AGE], 0.18, "star",
                           {"minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-90,90)"},
                            "minecraft:particle_appearance_billboard": {"size": ["variable.width*(3.2+1.4*%s)" % R1, "variable.width*(3.2+1.4*%s)" % R1],
                                                                        "facing_camera_mode": "rotate_xyz", "uv": uv_full(64, 64)}})
    # motes of light streaming into a point (energy gathering in the throat, at the tail's tip)
    fx["gather"] = P("sg:gather", "spark", "particles_add", dict(instant(14), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.size", "surface_only": True, "direction": "inwards"},
        "minecraft:particle_initial_speed": "variable.size*math.random(1.8,2.4)",
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.38,0.46)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.2+0.5*%s" % AGE, "0.2+0.5*%s" % AGE], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#005010A0", "0.3": "#F0A040F0", "0.8": "#FFE8B8FF", "1.0": "#FFFFFFFF"}}},
    }))

    # ================================================================== impact
    fx["impact_blast"] = P("sg:impact_blast", "fire", "particles_add", dict(instant(5), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.size*0.4", "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(1,4)*variable.size*0.5",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 2.0},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.35,0.65)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-60,60)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.9, 2.6, "variable.size"), "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#FFFFFFFF", "0.25": "#FFF0C0FF", "0.6": "#E0B050F0", "1.0": "#00401080"}}},
    }))
    fx["impact_glare"] = orb("sg:impact_glare", "variable.size*(3.5+1.5*%s)" % R1, [0.92, 0.8, 1.0, "0.85*(1-%s)" % AGE], 0.2)
    fx["impact_ring"] = P("sg:impact_ring", "ring", "particles_add", dict(instant(1), **{
        "minecraft:emitter_shape_point": {"offset": [0, 0.4, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.5},
        "minecraft:particle_appearance_billboard": {"size": ["variable.size*(0.6+5*%s)" % AGE, "variable.size*(0.6+5*%s)" % AGE],
                                                    "facing_camera_mode": "emitter_transform_xz", "uv": uv_full(128, 128)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#E0FFF0FF", "0.4": "#A0C060FF", "1.0": "#008020E0"}}},
    }))
    fx["impact_fountain"] = P("sg:impact_fountain", "spark", "particles_add", dict(instant(16), **{
        "minecraft:emitter_shape_sphere": {"radius": 0.5, "direction": ["math.random(-0.5,0.5)", 1, "math.random(-0.5,0.5)"]},
        "minecraft:particle_initial_speed": "math.random(9,24)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -18, 0], "linear_drag_coefficient": 0.4},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.6,1.4)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.45*(1-%s)+0.05" % AGE, "0.45*(1-%s)+0.05" % AGE], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#FFFFFFFF", "0.3": "#FFFFC890", "0.7": "#FFFF7030", "1.0": "#00A02010"}}},
    }))
    fx["impact_smoke"] = P("sg:impact_smoke", "smoke", "particles_blend", dict(instant(3), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.size*0.5", "direction": ["math.random(-0.5,0.5)", 1, "math.random(-0.5,0.5)"]},
        "minecraft:particle_initial_speed": "math.random(2,5)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 1.4, 0], "linear_drag_coefficient": 0.9},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(2.2,3.8)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-20,20)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.8, 2.6, "variable.size"), "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#00603020", "0.08": "#E0482018", "0.4": "#C0201A1C", "1.0": "#00141214"}}},
    }))
    fx["impact_fire"] = P("sg:impact_fire", "flame", "particles_add", dict(instant(6), **{
        "minecraft:emitter_shape_disc": {"radius": "variable.size", "plane_normal": "y", "direction": ["math.random(-0.4,0.4)", 1, "math.random(-0.4,0.4)"]},
        "minecraft:particle_initial_speed": "math.random(2,6)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 3, 0], "linear_drag_coefficient": 1.0},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.7,1.3)"},
        "minecraft:particle_appearance_billboard": {"size": ["variable.size*(0.5+0.5*%s)" % R1, "variable.size*(0.9+0.9*%s)" % R1], "facing_camera_mode": "lookat_y",
                                                    "uv": flip(*FLAME_FLIP, 9, True)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": HOT}},
    }))

    # ================================================================== the pour: smoke, then fire
    # thick black smoke driven out of the mouth
    fx["soot_stream"] = P("sg:soot_stream", "smoke", "particles_blend", dict(instant(4), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.width*0.25", "direction": spread(0.22, 0.16)},
        "minecraft:particle_initial_speed": "variable.spd*math.random(0.55,1.0)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.8, 0], "linear_drag_coefficient": 1.5},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.9,1.5)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-40,40)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.45, 1.5), "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#00080608", "0.1": "#F00E0A0C", "0.6": "#D0181416", "1.0": "#00282426"}}},
    }))
    # and what it becomes on the ground: clouds the size of buildings rolling outward and up
    fx["soot_billow"] = P("sg:soot_billow", "smoke", "particles_blend", dict(instant(3), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.width*0.5", "direction": ["variable.dx*0.8+math.random(-0.4,0.4)", "math.random(0.15,0.6)", "variable.dz*0.8+math.random(-0.4,0.4)"]},
        "minecraft:particle_initial_speed": "math.random(2,6)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.9, 0], "linear_drag_coefficient": 0.8},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(3.0,5.0)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-14,14)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.8, 2.6), "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#00060506", "0.1": "#F20B090A", "0.55": "#D8161314", "1.0": "#002A2628"}}},
    }))
    fx["soot_ember"] = P("sg:soot_ember", "spark", "particles_add", dict(instant(6), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.width*0.6", "direction": ["math.random(-0.6,0.6)", 1, "math.random(-0.6,0.6)"]},
        "minecraft:particle_initial_speed": "math.random(1,4)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 1.5, 0], "linear_drag_coefficient": 0.6},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.0,2.2)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.28*(1-%s)+0.05" % AGE, "0.28*(1-%s)+0.05" % AGE], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#FFFFE0A0", "0.5": "#FFFF6020", "1.0": "#00801008"}}},
    }))
    # the smoke catches: fire roaring out of the mouth
    fx["fire_stream"] = P("sg:fire_stream", "fire", "particles_add", dict(instant(5), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.width*0.25", "direction": spread(0.2, 0.14)},
        "minecraft:particle_initial_speed": "variable.spd*math.random(0.6,1.0)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 1.5, 0], "linear_drag_coefficient": 1.4},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.6,1.0)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-60,60)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.45, 1.45), "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": HOT}},
    }))
    # the flood across the ground: rolling fire, tall flames, embers, and the black smoke above it
    fx["flood_fire"] = P("sg:flood_fire", "fire", "particles_add", dict(instant(4), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.width*0.45", "direction": ["variable.dx+math.random(-0.35,0.35)", "math.random(0.1,0.45)", "variable.dz+math.random(-0.35,0.35)"]},
        "minecraft:particle_initial_speed": "math.random(4,10)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 2.4, 0], "linear_drag_coefficient": 1.5},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.8,1.4)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-50,50)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.6, 1.7), "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": HOT}},
    }))
    fx["flood_flame"] = P("sg:flood_flame", "flame", "particles_add", dict(instant(5), **{
        "minecraft:emitter_shape_disc": {"radius": "variable.width*0.9", "plane_normal": "y", "direction": ["math.random(-0.3,0.3)", 1, "math.random(-0.3,0.3)"]},
        "minecraft:particle_initial_speed": "math.random(1.5,5)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 3, 0], "linear_drag_coefficient": 1.0},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.8,1.5)"},
        "minecraft:particle_appearance_billboard": {"size": ["variable.width*(0.35+0.35*%s)" % R1, "variable.width*(0.7+0.9*%s)" % R1], "facing_camera_mode": "lookat_y",
                                                    "uv": flip(*FLAME_FLIP, 8, True)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": HOT}},
    }))
    fx["flood_ember"] = P("sg:flood_ember", "spark", "particles_add", dict(instant(8), **{
        "minecraft:emitter_shape_disc": {"radius": "variable.width", "plane_normal": "y", "direction": ["math.random(-0.4,0.4)", 1, "math.random(-0.4,0.4)"]},
        "minecraft:particle_initial_speed": "math.random(3,11)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 2, 0], "linear_drag_coefficient": 0.5},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.2,2.6)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.34*(1-%s)+0.06" % AGE, "0.34*(1-%s)+0.06" % AGE], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#FFFFF0C0", "0.4": "#FFFF8030", "1.0": "#00801008"}}},
    }))
    fx["flood_smoke"] = P("sg:flood_smoke", "smoke", "particles_blend", dict(instant(2), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.width*0.6", "direction": ["variable.dx*0.5+math.random(-0.4,0.4)", 1, "variable.dz*0.5+math.random(-0.4,0.4)"]},
        "minecraft:particle_initial_speed": "math.random(1.5,4)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 1.6, 0], "linear_drag_coefficient": 0.6},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(3.0,5.0)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-14,14)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.8, 2.5), "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#00702010", "0.08": "#D8581C10", "0.4": "#C0241C1C", "1.0": "#00161415"}}},
    }))
    # the stream as it tightens toward the beam: colour, tightness and speed are driven by the script
    fx["breath_stream"] = P("sg:breath_stream", "glow", "particles_add", dict(instant(9), **{
        "minecraft:emitter_shape_sphere": {"radius": 0.5, "direction": [
            "variable.dx+math.random(-variable.spread,variable.spread)",
            "variable.dy+math.random(-variable.spread,variable.spread)",
            "variable.dz+math.random(-variable.spread,variable.spread)"]},
        "minecraft:particle_initial_speed": "variable.spd*math.random(0.7,1.0)",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 0.5},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.7,1.1)"},
        "minecraft:particle_appearance_billboard": {"size": ["variable.size*(0.7+v.particle_age*2.4)", "variable.size*(0.7+v.particle_age*2.4)"],
                                                    "facing_camera_mode": "lookat_xyz", "uv": uv_full(64, 64)},
        "minecraft:particle_appearance_tinting": {"color": ["variable.cr", "variable.cg", "variable.cb", "1-" + AGE]},
    }))

    # ================================================================== the plates charging
    fx["dorsal_glow"] = P("sg:dorsal_glow", "spark", "particles_add", dict(instant(3), **{
        "minecraft:emitter_shape_sphere": {"radius": 1.2, "direction": [0, 1, 0]},
        "minecraft:particle_initial_speed": "math.random(1.5,4)",
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.4,0.8)"},
        "minecraft:particle_appearance_billboard": {"size": [0.45, 0.45], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": [0.78, 0.5, 1.0, 1.0]},
    }))
    fx["haze"] = orb("sg:haze", "variable.size", [0.5, 0.2, 1.0, "0.16*math.sin(" + AGE + "*180)"], 0.9)
    fx["surge"] = orb("sg:surge", "variable.size*(1-" + AGE + "*0.6)", [0.9, 0.7, 1.0, "1-" + AGE], 0.45)
    fx["flash"] = orb("sg:flash", "variable.size*(0.4+" + AGE + ")", [0.92, 0.8, 1.0, "(1-" + AGE + ")*0.9"], 0.5)
    fx["embers"] = P("sg:embers", "spark", "particles_add", dict(instant(18), **{
        "minecraft:emitter_shape_disc": {"radius": "variable.size", "plane_normal": "y", "direction": ["math.random(-0.3,0.3)", 1, "math.random(-0.3,0.3)"]},
        "minecraft:particle_initial_speed": "math.random(3,9)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 2, 0], "linear_drag_coefficient": 0.4},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.2,2.4)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.3*(1-" + AGE + ")+0.06", "0.3*(1-" + AGE + ")+0.06"], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#FFFFFFFF", "0.4": "#FFD9A6FF", "1.0": "#008A2BE2"}}},
    }))
    # a single lightning bolt from the emitter to len blocks along (dx,dy,dz)
    fx["arc"] = segment("sg:arc", "bolt", "particles_add",
                        {"texture_width": 256, "texture_height": 64, "uv": ["math.floor(%s*3.99)*64" % R1, 0], "uv_size": [64, 64]},
                        "variable.len*0.2+0.4", [0.9, 0.8, 1.0, 1.0], 0.1)

    # ================================================================== Godzilla Minus One: blue fire and the bomb
    # a flash of any colour (variable.cr/cg/cb), swelling as it fades
    fx["burst"] = orb("sg:burst", "variable.size*(0.4+" + AGE + ")", ["variable.cr", "variable.cg", "variable.cb", "(1-" + AGE + ")*0.9"], 0.45)
    fx["blue_sparks"] = P("sg:blue_sparks", "spark", "particles_add", dict(instant(8), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.size", "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(3,10)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -5, 0], "linear_drag_coefficient": 1.2},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.4,0.9)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.4*(1-%s)+0.06" % AGE, "0.4*(1-%s)+0.06" % AGE], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#FFFFFFFF", "0.3": "#FFB8ECFF", "0.7": "#F040A0FF", "1.0": "#001040C0"}}},
    }))
    fx["gather_blue"] = P("sg:gather_blue", "spark", "particles_add", dict(instant(16), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.size", "surface_only": True, "direction": "inwards"},
        "minecraft:particle_initial_speed": "variable.size*math.random(1.8,2.4)",
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.38,0.46)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.25+0.6*%s" % AGE, "0.25+0.6*%s" % AGE], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#001040C0", "0.3": "#F040A0FF", "0.8": "#FFB8ECFF", "1.0": "#FFFFFFFF"}}},
    }))
    # the bomb: a light too bright to look at, the fireball climbing its own stem, the cap spreading
    # over it, and a ring racing out across the ground
    fx["nuke_flash"] = orb("sg:nuke_flash", "variable.size*(0.5+1.5*" + AGE + ")", [1.0, 0.98, 0.94, "math.min(1,(1-" + AGE + ")*1.6)"], 1.1)
    fx["nuke_fire"] = P("sg:nuke_fire", "fire", "particles_add", dict(instant(5), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.width*0.5", "direction": ["math.random(-0.4,0.4)", 1, "math.random(-0.4,0.4)"]},
        "minecraft:particle_initial_speed": "variable.spd*math.random(0.6,1.0)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 1.2, 0], "linear_drag_coefficient": 0.5},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(2.2,3.6)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-30,30)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.7, 1.9), "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#FFFFFFF0", "0.12": "#FFFFD890", "0.4": "#F0FF7A28", "0.75": "#C0B02A10", "1.0": "#00301008"}}},
    }))
    fx["nuke_cap"] = P("sg:nuke_cap", "smoke", "particles_blend", dict(instant(4), **{
        "minecraft:emitter_shape_sphere": {"radius": "variable.width*0.6", "direction": ["variable.dx+math.random(-0.5,0.5)", "math.random(-0.1,0.5)", "variable.dz+math.random(-0.5,0.5)"]},
        "minecraft:particle_initial_speed": "variable.spd*math.random(0.5,1.0)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.5, 0], "linear_drag_coefficient": 0.45},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(6.0,9.0)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-10,10)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.8, 2.4), "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#00FFB060", "0.06": "#F0E08040", "0.25": "#E8705040", "0.6": "#D0383030", "1.0": "#00201C1C"}}},
    }))
    fx["nuke_ring"] = P("sg:nuke_ring", "ring", "particles_add", dict(instant(1), **{
        "minecraft:emitter_shape_point": {"offset": [0, 0.6, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 1.6},
        "minecraft:particle_appearance_billboard": {"size": ["variable.size*(0.05+0.95*%s)" % AGE, "variable.size*(0.05+0.95*%s)" % AGE],
                                                    "facing_camera_mode": "emitter_transform_xz", "uv": uv_full(128, 128)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#FFFFFFFF", "0.5": "#C0E0E8FF", "1.0": "#00A0B0C0"}}},
    }))
    # black rain: what falls afterwards
    fx["black_rain"] = P("sg:black_rain", "drop", "particles_alpha", {
        "minecraft:emitter_rate_steady": {"spawn_rate": 70, "max_particles": 90},
        "minecraft:emitter_lifetime_once": {"active_time": 1.0},
        "minecraft:emitter_shape_box": {"offset": [0, 13, 0], "half_dimensions": [13, 1, 13], "direction": [0.06, -1, 0.03]},
        "minecraft:particle_initial_speed": "math.random(20,26)",
        "minecraft:particle_motion_dynamic": {},
        "minecraft:particle_motion_collision": {"collision_radius": 0.1, "expire_on_contact": True},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 1.1},
        "minecraft:particle_appearance_billboard": {"size": [0.045, 0.5], "facing_camera_mode": "lookat_y", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": [0.03, 0.03, 0.035, 0.85]},
    })

    # ================================================================== steam, frost, freeze, evolution
    fx["steam"] = P("sg:steam", "smoke", "particles_blend", dict(instant(3), **{
        "minecraft:emitter_shape_sphere": {"radius": 1.5, "direction": [0, 1, 0]},
        "minecraft:particle_initial_speed": "math.random(1,2.5)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.8, 0], "linear_drag_coefficient": 0.5},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(2.5,4)"},
        "minecraft:particle_appearance_billboard": {"size": ["1+v.particle_age*1.4", "1+v.particle_age*1.4"], "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#A0FFFFFF", "1.0": "#00FFFFFF"}}},
    }))
    fx["frost"] = P("sg:frost", "spark", "particles_add", dict(instant(4), **{
        "minecraft:emitter_shape_sphere": {"radius": 2.5},
        "minecraft:particle_initial_speed": 0.3,
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -0.6, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 3},
        "minecraft:particle_appearance_billboard": {"size": [0.2, 0.2], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": [0.8, 0.95, 1.0, 0.9]},
    }))
    fx["freeze_burst"] = P("sg:freeze_burst", "spark", "particles_add", dict(instant(40), **{
        "minecraft:emitter_shape_sphere": {"radius": 3, "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(2,8)",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 1.5, "linear_acceleration": [0, -1, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1,2.5)"},
        "minecraft:particle_appearance_billboard": {"size": [0.35, 0.35], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": [0.75, 0.92, 1.0, 1.0]},
    }))
    fx["coagulant"] = P("sg:coagulant", "smoke", "particles_blend", dict(instant(12), **{
        "minecraft:emitter_shape_sphere": {"radius": 1, "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(1,4)",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 1.0},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.5,2.5)"},
        "minecraft:particle_appearance_billboard": {"size": ["0.8+v.particle_age", "0.8+v.particle_age"], "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#E0D8F0FF", "1.0": "#00C0E0FF"}}},
    }))
    fx["evolve_burst"] = P("sg:evolve_burst", "spark", "particles_add", dict(instant(16), **{
        "minecraft:emitter_shape_sphere": {"radius": 1.5, "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(2,7)",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 1.2, "linear_acceleration": [0, 2, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.6,1.4)"},
        "minecraft:particle_appearance_billboard": {"size": [0.5, 0.5], "facing_camera_mode": "lookat_xyz", "uv": uv_full(16, 16)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#FFFFD080", "0.5": "#FFFF4020", "1.0": "#00800808"}}},
    }))

    # ================================================================== footsteps, landings, rubble, melee
    fx["dust"] = P("sg:dust", "smoke", "particles_blend", dict(instant(16), **{
        "minecraft:emitter_shape_disc": {"radius": 2.5, "plane_normal": "y", "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(3,7)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.6, 0], "linear_drag_coefficient": 2.2},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.2,2.2)"},
        "minecraft:particle_appearance_billboard": {"size": ["1+v.particle_age*1.6", "1+v.particle_age*1.6"], "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#C08A7A66", "1.0": "#00807060"}}},
        "minecraft:particle_appearance_lighting": {},
    }))
    # a wall of dust thrown out when something the size of a tower comes down
    fx["land_dust"] = P("sg:land_dust", "smoke", "particles_blend", dict(instant(26), **{
        "minecraft:emitter_shape_disc": {"radius": "variable.size*0.35", "plane_normal": "y", "direction": "outwards"},
        "minecraft:particle_initial_speed": "variable.size*math.random(0.9,1.8)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 1.1, 0], "linear_drag_coefficient": 1.6},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(2.0,3.4)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-20,20)"},
        "minecraft:particle_appearance_billboard": {"size": grow(0.16, 0.55, "variable.size"), "facing_camera_mode": "rotate_xyz", "uv": PUFF},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#00908070", "0.1": "#D0907E6A", "1.0": "#00807060"}}},
        "minecraft:particle_appearance_lighting": {},
    }))
    fx["debris"] = P("sg:debris", "debris", "particles_alpha", dict(instant(14), **{
        "minecraft:emitter_shape_box": {"half_dimensions": [3, 4, 1], "direction": "outwards"},
        "minecraft:particle_initial_speed": "math.random(3,9)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -20, 0]},
        "minecraft:particle_motion_collision": {"collision_radius": 0.2, "coefficient_of_restitution": 0.2, "collision_drag": 4},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.5,2.5)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-200,200)"},
        "minecraft:particle_appearance_billboard": {"size": ["math.random(0.2,0.6)", "math.random(0.2,0.6)"], "facing_camera_mode": "rotate_xyz",
                                                    "uv": {"texture_width": 64, "texture_height": 16, "uv": ["math.floor(math.random(0,4))*16", 0], "uv_size": [16, 16]}},
        "minecraft:particle_appearance_lighting": {},
    }))
    # rubble hurled up and out by a landing or a blast
    fx["rubble"] = P("sg:rubble", "debris", "particles_alpha", dict(instant(22), **{
        "minecraft:emitter_shape_disc": {"radius": "variable.size*0.5", "plane_normal": "y", "direction": ["math.random(-0.8,0.8)", 1, "math.random(-0.8,0.8)"]},
        "minecraft:particle_initial_speed": "math.random(8,20)",
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -22, 0], "linear_drag_coefficient": 0.2},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.6,2.8)"},
        "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": "math.random(-260,260)"},
        "minecraft:particle_appearance_billboard": {"size": ["math.random(0.3,0.9)", "math.random(0.3,0.9)"], "facing_camera_mode": "rotate_xyz",
                                                    "uv": {"texture_width": 64, "texture_height": 16, "uv": ["math.floor(math.random(0,4))*16", 0], "uv_size": [16, 16]}},
        "minecraft:particle_appearance_lighting": {},
    }))
    fx["shockwave"] = P("sg:shockwave", "ring", "particles_blend", dict(instant(1), **{
        "minecraft:emitter_shape_point": {"offset": [0, 0.3, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.7},
        "minecraft:particle_appearance_billboard": {"size": ["1+v.particle_age*22", "1+v.particle_age*22"], "facing_camera_mode": "emitter_transform_xz", "uv": uv_full(128, 128)},
        "minecraft:particle_appearance_tinting": {"color": {"interpolant": AGE, "gradient": {"0.0": "#C0D8C8B0", "1.0": "#00D8C8B0"}}},
    }))
    # the arc a claw or the tail cuts through the air
    fx["slash"] = P("sg:slash", "slash", "particles_add", dict(instant(1), **{
        "minecraft:emitter_shape_point": {"direction": DIR},
        "minecraft:particle_initial_speed": "variable.size*1.5",
        "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 3},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.3},
        "minecraft:particle_appearance_billboard": {"size": ["variable.size*(0.7+0.6*%s)" % AGE, "variable.size*(0.7+0.6*%s)" % AGE],
                                                    "facing_camera_mode": "lookat_direction", "direction": VEL, "uv": uv_full(64, 64)},
        "minecraft:particle_appearance_tinting": {"color": [1.0, 0.92, 0.98, "0.9*(1-%s)" % AGE]},
    }))
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


# ------------------------------------------------------------ boss bar (HUD) textures
def make_ui_textures(out):
    """Frame (182 x 20) and fills (170 x 6) for the boss bar: black glass edged in violet,
    with a row of dorsal plates lit from inside at either end."""
    os.makedirs(out, exist_ok=True)

    def frame(edge, glow, name):
        img = Image.new("RGBA", (182, 20), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, 181, 19], fill=(10, 6, 14, 235), outline=edge)
        d.rectangle([1, 1, 180, 18], outline=(28, 14, 36, 255))
        d.rectangle([5, 11, 176, 18], fill=(0, 0, 0, 255), outline=(40, 22, 52, 255))      # the trough the bar fills
        for side in (0, 1):                                                                # three plates, tallest inside
            for i, (x, h) in enumerate(((4, 5), (9, 7), (15, 8))):
                x0 = x if side == 0 else 181 - x - 4
                pts = [(x0, 9), (x0 + 2, 9 - h), (x0 + 4, 9)]
                d.polygon(pts, fill=(36, 30, 40, 255), outline=(70, 60, 78, 255))
                d.point((x0 + 2, 9 - h + 2), fill=glow)
                d.point((x0 + 2, 9 - h + 3), fill=glow)
                if h > 6:
                    d.point((x0 + 2, 9 - h + 4), fill=(glow[0], glow[1], glow[2], 160))
        img.save(os.path.join(out, name))

    def fill(c0, c1, core, name):
        a = np.zeros((6, 170, 4))
        t = np.linspace(0, 1, 170)[None, :]
        for k in range(3):
            a[:, :, k] = c0[k] + (c1[k] - c0[k]) * t
        a[:, :, 3] = 255
        shade = np.array([0.65, 1.0, 1.0, 0.9, 0.7, 0.5])[:, None]
        a[:, :, :3] *= shade[:, :, None]
        for k in range(3):                       # the hot line through the middle, like the beam's core
            a[1:3, :, k] = a[1:3, :, k] * 0.45 + core[k] * 0.55
        tick = (np.arange(170) % 17 == 16)
        a[:, tick, :3] *= 0.72
        _save(a, os.path.join(out, name))
    frame((120, 60, 190, 255), (214, 120, 255, 255), "sg_boss_frame.png")
    fill((70, 20, 130), (200, 70, 255), (250, 225, 255), "sg_boss_fill.png")
    frame((170, 40, 40, 255), (255, 110, 70, 255), "sg_boss_frame_rampage.png")
    fill((120, 14, 20), (255, 80, 40), (255, 235, 200), "sg_boss_fill_rampage.png")
    frame((50, 120, 210, 255), (130, 215, 255, 255), "sg_boss_frame_minus.png")
    fill((14, 60, 150), (70, 190, 255), (232, 250, 255), "sg_boss_fill_minus.png")


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
    # Config wheel: a dark iron dial, eight violet-lit spokes around a glowing hub
    img = Image.new("RGBA", (S * 4, S * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = S * 2
    d.ellipse([10, 10, c * 2 - 10, c * 2 - 10], fill=(44, 44, 54, 255), outline=(14, 14, 20, 255), width=6)
    d.ellipse([26, 26, c * 2 - 26, c * 2 - 26], fill=(20, 12, 30, 255), outline=(90, 60, 130, 255), width=4)
    for i in range(8):
        a = i * np.pi / 4
        d.line([c + np.cos(a) * 16, c + np.sin(a) * 16, c + np.cos(a) * 44, c + np.sin(a) * 44], fill=(170, 90, 255, 255), width=6)
        d.ellipse([c + np.cos(a) * 54 - 5, c + np.sin(a) * 54 - 5, c + np.cos(a) * 54 + 5, c + np.sin(a) * 54 + 5], fill=(120, 124, 140, 255))
    d.ellipse([c - 14, c - 14, c + 14, c + 14], fill=(232, 200, 255, 255), outline=(150, 70, 255, 255), width=4)
    img.resize((S, S), Image.LANCZOS).save(out + "/config_wheel.png")
