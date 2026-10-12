"""Shared exporter: .bbmodel, Bedrock geometry / animations and resource-pack wiring.

The geometry and animation files follow the same conventions as Blockbench's own
"Export Bedrock Geometry / Animations" (checked against Blockbench 5.2.2), so
they match what you would get by exporting the .bbmodel by hand.
"""
import base64
import hashlib
import io
import json
import os
import uuid
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from . import anim, rig

NS = uuid.UUID("6b1f4c1e-7a1b-4f39-9a52-b0001e000000")
TOOLS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@dataclass
class Character:
    """Everything the exporter needs to know about one model."""

    model_id: str                 # file names, geometry.<id>, animation.<id>.*
    entity_id: str                # client entity identifier
    out_dir: str                  # where the deliverables are written
    materials: dict
    build_geometry: object        # () -> None, fills rig.BONES
    build_anims: object           # () -> None, fills anim.ANIMS
    sources: list                 # files whose contents key the animation cache
    spawn_egg: tuple = ("#3a3d6b", "#8e2a2c")
    variant_states: dict = field(default_factory=lambda: {"pose1": 1, "pose2": 2, "performance1": 3, "performance2": 4})
    arm: dict = None              # anim.ARM overrides (palm centre, chest box)
    visible_box: tuple = (4, 4.5, 2.25)
    atlas_width: int = 512
    tpu: int = 2                  # texels per model pixel


def uid(*parts):
    return str(uuid.uuid5(NS, "/".join(str(p) for p in parts)))


def r(v, nd=4):
    v = round(float(v), nd)
    return int(v) if v == int(v) else v


def rl(vals, nd=4):
    return [r(v, nd) for v in vals]


# --------------------------------------------------------------------------
# .bbmodel
# --------------------------------------------------------------------------


def bbmodel(ch, tex_w, tex_h, png_bytes):
    elements = []
    cube_ids = {}
    for b, c in rig.all_cubes():
        cid = uid("cube", b.name, len(elements), c.name)
        cube_ids[id(c)] = cid
        el = {
            "name": c.name,
            "box_uv": False,
            "rescale": False,
            "locked": False,
            "light_emission": 0,
            "render_order": "default",
            "allow_mirror_modeling": True,
            "from": rl(c.frm),
            "to": rl(c.to),
            "autouv": 0,
            "color": sum(map(ord, b.name)) % 8,
            "origin": rl(c.origin or b.pivot),
            "faces": {f: {"uv": rl(c.uv[f]), "texture": 0} for f in rig.FACES},
            "type": "cube",
            "uuid": cid,
        }
        if c.rot:
            el["rotation"] = rl(c.rot)
        elements.append(el)

    group_ids = {name: uid("group", name) for name in rig.BONES}

    def group(name):
        b = rig.BONES[name]
        g = {
            "name": name,
            "origin": rl(b.pivot),
            "color": 0,
            "uuid": group_ids[name],
            "export": True,
            "mirror_uv": False,
            "isOpen": name in ("root", "body", "torso"),
            "locked": False,
            "visibility": True,
            "autouv": 0,
            "children": [cube_ids[id(c)] for c in b.cubes] + [group(ch) for ch in b.children],
        }
        if any(b.rot):
            g["rotation"] = rl(b.rot)
        return g

    outliner = [group(n) for n, b in rig.BONES.items() if b.parent is None]

    animations = []
    for name, a in anim.ANIMS.items():
        animators = {}
        for bname, chans in a["bones"].items():
            kfs = []
            for chan, keys in chans.items():
                for i, (t, v, interp) in enumerate(keys):
                    kfs.append({
                        "channel": chan,
                        "data_points": [{"x": r(v[0], 3), "y": r(v[1], 3), "z": r(v[2], 3)}],
                        "uuid": uid("kf", name, bname, chan, i),
                        "time": r(t, 4),
                        "color": -1,
                        "interpolation": interp,
                    })
            animators[group_ids[bname]] = {"name": bname, "type": "bone", "keyframes": kfs}
        animations.append({
            "uuid": uid("anim", name),
            "name": name,
            "loop": a["loop"],
            "override": False,
            "length": a["length"],
            "snapping": 24,
            "selected": False,
            "anim_time_update": "",
            "blend_weight": "",
            "start_delay": "",
            "loop_delay": "",
            "animators": animators,
        })

    return {
        "meta": {"format_version": "4.10", "model_format": "bedrock", "box_uv": False},
        "name": ch.model_id,
        "model_identifier": ch.model_id,
        "visible_box": list(ch.visible_box),
        "variable_placeholders": "",
        "variable_placeholder_buttons": [],
        "timeline_setups": [],
        "unhandled_root_fields": {},
        "resolution": {"width": tex_w, "height": tex_h},
        "elements": elements,
        "outliner": outliner,
        "textures": [{
            "path": "",
            "name": f"{ch.model_id}.png",
            "folder": "",
            "namespace": "",
            "id": "0",
            "width": tex_w,
            "height": tex_h,
            "uv_width": tex_w,
            "uv_height": tex_h,
            "particle": False,
            "layers_enabled": False,
            "sync_to_project": "",
            "render_mode": "default",
            "render_sides": "auto",
            "frame_time": 1,
            "frame_order_type": "loop",
            "frame_order": "",
            "frame_interpolate": False,
            "visible": True,
            "internal": True,
            "saved": True,
            "uuid": uid("texture", ch.model_id),
            "source": "data:image/png;base64," + base64.b64encode(png_bytes).decode(),
        }],
        "animations": animations,
    }


# --------------------------------------------------------------------------
# Bedrock exports (same conventions as Blockbench's bedrock codec)
# --------------------------------------------------------------------------


def outliner_order():
    out = []

    def walk(n):
        out.append(n)
        for ch in rig.BONES[n].children:
            walk(ch)

    for n, b in rig.BONES.items():
        if b.parent is None:
            walk(n)
    return out


def geo_json(ch, tex_w, tex_h):
    bones = []
    for name in outliner_order():
        b = rig.BONES[name]
        bj = {"name": name}
        if b.parent:
            bj["parent"] = b.parent
        bj["pivot"] = rl([-b.pivot[0], b.pivot[1], b.pivot[2]])
        if any(b.rot):
            bj["rotation"] = rl([-b.rot[0], -b.rot[1], b.rot[2]])
        cubes = []
        for c in b.cubes:
            size = [c.to[i] - c.frm[i] for i in range(3)]
            cj = {"origin": rl([-(c.frm[0] + size[0]), c.frm[1], c.frm[2]]), "size": rl(size)}
            if c.rot:
                o = c.origin or b.pivot
                cj["pivot"] = rl([-o[0], o[1], o[2]])
                cj["rotation"] = rl([-c.rot[0], -c.rot[1], c.rot[2]])
            uv = {}
            for f in rig.FACES:
                u1, v1, u2, v2 = c.uv[f]
                fu = {"uv": [u1, v1], "uv_size": [u2 - u1, v2 - v1]}
                if f in ("up", "down"):
                    fu = {"uv": [u2, v2], "uv_size": [u1 - u2, v1 - v2]}
                uv[f] = fu
            cj["uv"] = uv
            cubes.append(cj)
        if cubes:
            bj["cubes"] = cubes
        bones.append(bj)
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": f"geometry.{ch.model_id}",
                "texture_width": tex_w,
                "texture_height": tex_h,
                "visible_bounds_width": ch.visible_box[0],
                "visible_bounds_height": ch.visible_box[1],
                "visible_bounds_offset": [0, ch.visible_box[2], 0],
            },
            "bones": bones,
        }],
    }


def animation_json():
    out = {}
    for name, a in anim.ANIMS.items():
        aj = {}
        if a["loop"] == "loop":
            aj["loop"] = True
        elif a["loop"] == "hold":
            aj["loop"] = "hold_on_last_frame"
        aj["animation_length"] = a["length"]
        bones = {}
        for bname, chans in a["bones"].items():
            bj = {}
            for chan, keys in chans.items():
                if len(keys) == 1 and keys[0][0] == 0:
                    v = rl(keys[0][1], 3)
                    bj[chan] = v[0] if chan == "scale" and v[0] == v[1] == v[2] else v
                    continue
                cj = {}
                for t, v, interp in keys:
                    k = f"{r(t, 4)}" if "." in f"{r(t, 4)}" else f"{r(t, 4)}.0"
                    if interp == "linear":
                        cj[k] = rl(v, 3)
                    else:
                        cj[k] = {"post": rl(v, 3), "lerp_mode": interp}
                bj[chan] = cj
            bones[bname] = bj
        aj["bones"] = bones
        out[name] = aj
    return {"format_version": "1.8.0", "animations": out}


def client_files(ch):
    """Example resource-pack wiring so the model drops straight into an addon."""
    mid = ch.model_id
    anim_names = {n.split(".")[-1]: n for n in anim.ANIMS}
    entity = {
        "format_version": "1.10.0",
        "minecraft:client_entity": {
            "description": {
                "identifier": ch.entity_id,
                "materials": {"default": "entity_emissive_alpha"},
                "textures": {"default": f"textures/entity/{mid}/{mid}_glow"},
                "geometry": {"default": f"geometry.{mid}"},
                "animations": {**anim_names, "controller": f"controller.animation.{mid}.main"},
                "scripts": {"animate": ["controller"]},
                "render_controllers": [f"controller.render.{mid}"],
                "spawn_egg": {"base_color": ch.spawn_egg[0], "overlay_color": ch.spawn_egg[1]},
            }
        },
    }
    render = {
        "format_version": "1.8.0",
        "render_controllers": {
            f"controller.render.{mid}": {
                "geometry": "Geometry.default",
                "materials": [{"*": "Material.default"}],
                "textures": ["Texture.default"],
            }
        },
    }
    moving = "query.ground_speed > 0.3"
    running = "query.ground_speed > 3.5"
    variant_states = ch.variant_states
    states = {
        "idle": {
            "animations": ["idle"],
            "blend_transition": 0.25,
            "transitions": [{"run": running}, {"walk": moving}]
            + [{k: f"query.mark_variant == {v}"} for k, v in variant_states.items()],
        },
        "walk": {
            "animations": ["walk"],
            "blend_transition": 0.25,
            "transitions": [{"run": running}, {"idle": f"!({moving})"}],
        },
        "run": {
            "animations": ["run"],
            "blend_transition": 0.2,
            "transitions": [{"walk": f"!({running}) && {moving}"}, {"idle": f"!({moving})"}],
        },
    }
    for k, v in variant_states.items():
        states[k] = {
            "animations": [k],
            "blend_transition": 0.3,
            "transitions": [{"walk": moving}, {"idle": f"query.mark_variant != {v}"}],
        }
    controller = {
        "format_version": "1.10.0",
        "animation_controllers": {
            f"controller.animation.{mid}.main": {"initial_state": "idle", "states": states}
        },
    }
    return {
        os.path.join("entity", f"{mid}.entity.json"): entity,
        os.path.join("render_controllers", f"{mid}.render_controllers.json"): render,
        os.path.join("animation_controllers", f"{mid}.animation_controllers.json"): controller,
    }


def build_anims(ch):
    """ch.build_anims() runs an IK solve per keyframe (minutes); cache it by source hash."""
    h = hashlib.sha256(ch.model_id.encode())
    kit = os.path.dirname(os.path.abspath(__file__))
    for fn in sorted(os.listdir(kit)) + list(ch.sources):
        path = fn if os.path.isabs(fn) else os.path.join(kit, fn)
        if path.endswith(".py"):
            with open(path, "rb") as f:
                h.update(f.read())
    cache = os.path.join(TOOLS_DIR, ".cache", f"{ch.model_id}-{h.hexdigest()[:16]}.json")
    anim.reset(ch.arm)
    if os.path.exists(cache):
        with open(cache) as f:
            for name, a in json.load(f):
                a["bones"] = {b: {c: [tuple(k) for k in keys] for c, keys in chans.items()} for b, chans in a["bones"]}
                anim.ANIMS[name] = a
        return
    ch.build_anims()
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w") as f:
        json.dump([[n, {**a, "bones": [[b, chans] for b, chans in a["bones"].items()]}] for n, a in anim.ANIMS.items()], f)


def write_json(path, data, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, **kw)


def build(ch):
    rig.reset(ch.materials, ch.tpu)
    anim.reset(ch.arm)
    ch.build_geometry()
    tex_w, tex_h = rig.pack_atlas(ch.atlas_width)
    rgb, emi = rig.paint_atlas(tex_w, tex_h)
    build_anims(ch)

    mid, root = ch.model_id, ch.out_dir
    os.makedirs(os.path.join(root, "textures"), exist_ok=True)
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").convert("RGBA").save(buf, "PNG", optimize=True)
    png = buf.getvalue()
    with open(os.path.join(root, "textures", f"{mid}.png"), "wb") as f:
        f.write(png)
    Image.fromarray(emi, "RGB").save(os.path.join(root, "textures", f"{mid}_emissive.png"), optimize=True)

    write_json(os.path.join(root, f"{mid}.bbmodel"), bbmodel(ch, tex_w, tex_h, png), separators=(",", ":"))
    write_json(os.path.join(root, "bedrock", "models", "entity", f"{mid}.geo.json"), geo_json(ch, tex_w, tex_h), indent="\t")
    write_json(os.path.join(root, "bedrock", "animations", f"{mid}.animation.json"), animation_json(), indent="\t")

    # in-game copy of the texture: glowing pixels get low alpha, which the
    # entity_emissive_alpha material renders full-bright
    tex_dir = os.path.join(root, "bedrock", "textures", "entity", mid)
    os.makedirs(tex_dir, exist_ok=True)
    with open(os.path.join(tex_dir, f"{mid}.png"), "wb") as f:
        f.write(png)
    alpha = 255 - np.clip(emi.max(axis=2).astype(np.float32) * 1.7, 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(os.path.join(tex_dir, f"{mid}_glow.png"), optimize=True)
    for rel, data in client_files(ch).items():
        write_json(os.path.join(root, "bedrock", rel), data, indent="\t")

    ncubes = sum(len(b.cubes) for b in rig.BONES.values())
    print(f"{mid}: bones={len(rig.BONES)} cubes={ncubes} texture={tex_w}x{tex_h} animations={len(anim.ANIMS)}")
