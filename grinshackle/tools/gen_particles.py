#!/usr/bin/env python3
"""Generate the Bedrock particle effect JSON files for Grinshackle (RP/particles).

Every component used is documented on the Microsoft Bedrock particle reference
(format_version 1.10.0).  Textures are the ones gen_textures.py writes:
  textures/particle/gs_ink_mote   8x8  RGBA, near-black soft dot
  textures/particle/gs_ink_drip   4x8  RGBA, elongated droplet
  textures/particle/gs_chain_link 8x8  RGBA, dark-grey link
  textures/particle/gs_spark      4x4  RGBA, pale gold
"""
import json
import os

ROOT = "/tmp/claude-0/-home-user-Gamesforfun/f0d9b1e4-8cf6-5788-bfed-3c567a50b1ea/scratchpad"
RP = os.path.join(ROOT, "build", "Grinshackle_RP")
OUT = os.path.join(RP, "particles")
os.makedirs(OUT, exist_ok=True)

# Fraction of the particle's life that has elapsed (0 -> 1); constant-per-particle
# random in variable.particle_random_N so sizes do not flicker frame to frame.
AGE = "variable.particle_age / variable.particle_lifetime"


def uv(w, h):
    """Whole-texture UV block for a w x h pixel texture."""
    return {"texture_width": w, "texture_height": h, "uv": [0, 0], "uv_size": [w, h]}


def effect(identifier, material, texture, components):
    return {
        "format_version": "1.10.0",
        "particle_effect": {
            "description": {
                "identifier": identifier,
                "basic_render_parameters": {"material": material, "texture": texture},
            },
            "components": components,
        },
    }


FILES = {}

# ---------------------------------------------------------------- gs:ink_motes
# Ambient: ~6 motes/s for 1 s from a 0.6-block sphere around the chest, each a
# tiny black billboard drifting upward and fading in/out via alpha.
FILES["gs_ink_motes.json"] = effect(
    "gs:ink_motes", "particles_blend", "textures/particle/gs_ink_mote",
    {
        "minecraft:emitter_rate_steady": {"spawn_rate": 6, "max_particles": 16},
        "minecraft:emitter_lifetime_once": {"active_time": 1.0},
        "minecraft:emitter_shape_sphere": {
            "offset": [0, 0, 0],
            "radius": 0.6,
            "surface_only": False,
            "direction": [0, 1, 0],
        },
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.2, 2.0)"},
        "minecraft:particle_initial_speed": "math.random(0.05, 0.15)",
        "minecraft:particle_motion_dynamic": {
            "linear_acceleration": [0, 0.01, 0],
            "linear_drag_coefficient": 0.05,
        },
        "minecraft:particle_appearance_billboard": {
            "size": [
                "0.06 + 0.04 * variable.particle_random_1",
                "0.06 + 0.04 * variable.particle_random_1",
            ],
            "facing_camera_mode": "lookat_xyz",
            "uv": uv(8, 8),
        },
        "minecraft:particle_appearance_tinting": {
            "color": {
                "interpolant": AGE,
                "gradient": {
                    "0.0": [0.25, 0.25, 0.32, 0.0],
                    "0.2": [0.25, 0.25, 0.32, 0.85],
                    "0.6": [0.2, 0.2, 0.26, 0.6],
                    "1.0": [0.15, 0.15, 0.2, 0.0],
                },
            }
        },
    },
)

# ----------------------------------------------------------------- gs:ink_drip
# 2-3 droplets released from a point above the head; gravity -6, expire when
# they touch the ground.  Elongated 0.04 x 0.10 upright billboard.
FILES["gs_ink_drip.json"] = effect(
    "gs:ink_drip", "particles_blend", "textures/particle/gs_ink_drip",
    {
        "minecraft:emitter_rate_instant": {"num_particles": "math.random_integer(2, 3)"},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {
            "offset": ["math.random(-0.25, 0.25)", 0, "math.random(-0.25, 0.25)"],
            "direction": [0, -1, 0],
        },
        "minecraft:particle_lifetime_expression": {"max_lifetime": 2.0},
        "minecraft:particle_initial_speed": "math.random(0.1, 0.4)",
        "minecraft:particle_motion_dynamic": {
            "linear_acceleration": [0, -6, 0],
            "linear_drag_coefficient": 0.0,
        },
        "minecraft:particle_motion_collision": {
            "enabled": True,
            "collision_drag": 10.0,
            "coefficient_of_restitution": 0.0,
            "collision_radius": 0.05,
            "expire_on_contact": True,
        },
        "minecraft:particle_appearance_billboard": {
            "size": [0.04, 0.1],
            "facing_camera_mode": "lookat_y",
            "uv": uv(4, 8),
        },
        "minecraft:particle_appearance_tinting": {
            "color": {
                "interpolant": AGE,
                "gradient": {
                    "0.0": [0.2, 0.2, 0.26, 0.0],
                    "0.1": [0.2, 0.2, 0.26, 1.0],
                    "0.8": [0.2, 0.2, 0.26, 1.0],
                    "1.0": [0.2, 0.2, 0.26, 0.0],
                },
            }
        },
    },
)

# ----------------------------------------------------------------- gs:ink_puff
# Burst of 18 motes from a 0.5 sphere, outward at 1.2 blocks/s with drag so
# the cloud stalls and fades over 0.7 s.  Used on emerge / vanish / strike.
FILES["gs_ink_puff.json"] = effect(
    "gs:ink_puff", "particles_blend", "textures/particle/gs_ink_mote",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 18},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {
            "offset": [0, 0, 0],
            "radius": 0.5,
            "surface_only": False,
            "direction": "outwards",
        },
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.7},
        "minecraft:particle_initial_speed": "math.random(0.9, 1.2)",
        "minecraft:particle_motion_dynamic": {
            "linear_acceleration": [0, 0.35, 0],
            "linear_drag_coefficient": 3.0,
        },
        "minecraft:particle_appearance_billboard": {
            "size": [
                "0.12 + 0.08 * variable.particle_random_1",
                "0.12 + 0.08 * variable.particle_random_1",
            ],
            "facing_camera_mode": "lookat_xyz",
            "uv": uv(8, 8),
        },
        "minecraft:particle_appearance_tinting": {
            "color": {
                "interpolant": AGE,
                "gradient": {
                    "0.0": [0.2, 0.2, 0.26, 0.95],
                    "0.5": [0.18, 0.18, 0.24, 0.7],
                    "1.0": [0.12, 0.12, 0.16, 0.0],
                },
            }
        },
    },
)

# ------------------------------------------------------------ gs:chain_fragment
# Marker on the floor: 2 chain-link billboards, size 0.12, barely lifted
# (0.1 up, gravity -0.3) so they settle back down; collision keeps them from
# sinking into the floor.  Cutout material so the link edges stay crisp.
FILES["gs_chain_fragment.json"] = effect(
    "gs:chain_fragment", "particles_alpha", "textures/particle/gs_chain_link",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 2},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {
            "offset": ["math.random(-0.15, 0.15)", 0.02, "math.random(-0.15, 0.15)"],
            "direction": ["math.random(-0.2, 0.2)", 1, "math.random(-0.2, 0.2)"],
        },
        "minecraft:particle_lifetime_expression": {"max_lifetime": 1.0},
        "minecraft:particle_initial_speed": 0.1,
        "minecraft:particle_motion_dynamic": {
            "linear_acceleration": [0, -0.3, 0],
            "linear_drag_coefficient": 0.0,
        },
        "minecraft:particle_motion_collision": {
            "enabled": True,
            "collision_drag": 4.0,
            "coefficient_of_restitution": 0.0,
            "collision_radius": 0.04,
            "expire_on_contact": False,
        },
        "minecraft:particle_appearance_billboard": {
            "size": [0.12, 0.12],
            "facing_camera_mode": "lookat_xyz",
            "uv": uv(8, 8),
        },
        "minecraft:particle_appearance_tinting": {
            "color": {
                "interpolant": AGE,
                "gradient": {
                    "0.0": [1.0, 1.0, 1.0, 1.0],
                    "0.85": [0.8, 0.8, 0.8, 1.0],
                    "1.0": [0.5, 0.5, 0.5, 1.0],
                },
            }
        },
    },
)

# ------------------------------------------------------------ gs:collapse_chains
# Defeat: 24 chain links thrown out of a 0.8 sphere, gravity -9, collide with
# the ground with a small bounce and heavy drag so they lie there for 2.5 s.
FILES["gs_collapse_chains.json"] = effect(
    "gs:collapse_chains", "particles_alpha", "textures/particle/gs_chain_link",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 24},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {
            "offset": [0, 0, 0],
            "radius": 0.8,
            "surface_only": False,
            "direction": "outwards",
        },
        "minecraft:particle_lifetime_expression": {"max_lifetime": 2.5},
        "minecraft:particle_initial_speed": "math.random(0.6, 1.8)",
        "minecraft:particle_motion_dynamic": {
            "linear_acceleration": [0, -9, 0],
            "linear_drag_coefficient": 0.3,
        },
        "minecraft:particle_motion_collision": {
            "enabled": True,
            "collision_drag": 12.0,
            "coefficient_of_restitution": 0.2,
            "collision_radius": 0.06,
            "expire_on_contact": False,
        },
        "minecraft:particle_appearance_billboard": {
            "size": [
                "0.12 + 0.05 * variable.particle_random_1",
                "0.12 + 0.05 * variable.particle_random_1",
            ],
            "facing_camera_mode": "lookat_xyz",
            "uv": uv(8, 8),
        },
        "minecraft:particle_appearance_lighting": {},
        "minecraft:particle_appearance_tinting": {
            "color": {
                "interpolant": AGE,
                "gradient": {
                    "0.0": [1.0, 1.0, 1.0, 1.0],
                    "0.8": [0.9, 0.9, 0.9, 1.0],
                    "1.0": [0.45, 0.45, 0.45, 1.0],
                },
            }
        },
    },
)

# --------------------------------------------------------------- gs:snap_sparks
# Chain snap: 10 pale-gold sparks flung outward/upward at ~2.5 blocks/s,
# gravity -4, dying in <= 0.5 s.  Additive material so they read as emissive;
# the tint runs to black at the end, which is invisible under additive blend.
FILES["gs_snap_sparks.json"] = effect(
    "gs:snap_sparks", "particles_add", "textures/particle/gs_spark",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 10},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {
            "offset": [0, 0, 0],
            "direction": ["math.random(-1, 1)", "math.random(0.4, 1.4)", "math.random(-1, 1)"],
        },
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.3, 0.5)"},
        "minecraft:particle_initial_speed": "math.random(1.8, 2.5)",
        "minecraft:particle_motion_dynamic": {
            "linear_acceleration": [0, -4, 0],
            "linear_drag_coefficient": 1.0,
        },
        "minecraft:particle_appearance_billboard": {
            "size": [
                "0.05 + 0.03 * variable.particle_random_1",
                "0.05 + 0.03 * variable.particle_random_1",
            ],
            "facing_camera_mode": "lookat_xyz",
            "uv": uv(4, 4),
        },
        "minecraft:particle_appearance_tinting": {
            "color": {
                "interpolant": AGE,
                "gradient": {
                    "0.0": [1.0, 0.98, 0.85, 1.0],
                    "0.5": [1.0, 0.85, 0.55, 1.0],
                    "0.8": [0.7, 0.45, 0.2, 1.0],
                    "1.0": [0.0, 0.0, 0.0, 0.0],
                },
            }
        },
    },
)

# ------------------------------------------------------------------ gs:lit_edge
# Light-threshold hesitation: 6 faint motes rising slowly out of a 0.5 sphere
# and fading over 1.5 s.  Very low alpha so it reads as a shiver, not a cloud.
FILES["gs_lit_edge.json"] = effect(
    "gs:lit_edge", "particles_blend", "textures/particle/gs_ink_mote",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 6},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {
            "offset": [0, 0.4, 0],
            "radius": 0.5,
            "surface_only": True,
            "direction": [0, 1, 0],
        },
        "minecraft:particle_lifetime_expression": {"max_lifetime": 1.5},
        "minecraft:particle_initial_speed": "math.random(0.08, 0.2)",
        "minecraft:particle_motion_dynamic": {
            "linear_acceleration": [0, 0.02, 0],
            "linear_drag_coefficient": 0.1,
        },
        "minecraft:particle_appearance_billboard": {
            "size": [
                "0.05 + 0.03 * variable.particle_random_1",
                "0.05 + 0.03 * variable.particle_random_1",
            ],
            "facing_camera_mode": "lookat_xyz",
            "uv": uv(8, 8),
        },
        "minecraft:particle_appearance_tinting": {
            "color": {
                "interpolant": AGE,
                "gradient": {
                    "0.0": [0.3, 0.3, 0.38, 0.0],
                    "0.3": [0.3, 0.3, 0.38, 0.45],
                    "1.0": [0.2, 0.2, 0.28, 0.0],
                },
            }
        },
    },
)


if __name__ == "__main__":
    written = []
    for name, data in FILES.items():
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
            fh.write("\n")
        written.append(path)
    for p in written:
        print(p)
