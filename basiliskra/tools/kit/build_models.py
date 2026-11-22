#!/usr/bin/env python3
"""Build geometry, textures, PBR maps, rig tables and .bbmodel files for the three forms.

    python3 build_models.py            # all forms
    python3 build_models.py iii        # one form
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "forms"))

import numpy as np
from PIL import Image

import kit
import paint

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RP = os.path.join(ROOT, "packs", "RP")
FORMS = {"i": "form1", "ii": "form2", "iii": "form3", "iv": "form4"}


def build(tag: str):
    t0 = time.time()
    mod = importlib.import_module(FORMS[tag])
    m = mod.build()
    m.solve_rest()
    hidden = m.cull_hidden()
    fill = m.pack()
    color, glow, mers, gmers = paint.paint(m)
    name = f"basiliskra_{tag}"
    tex_dir = os.path.join(RP, "textures", "entity", "basiliskra")
    os.makedirs(tex_dir, exist_ok=True)
    os.makedirs(os.path.join(RP, "models", "entity"), exist_ok=True)
    Image.fromarray(color, "RGBA").save(os.path.join(tex_dir, f"{name}.png"), optimize=True)
    Image.fromarray(glow, "RGBA").save(os.path.join(tex_dir, f"{name}_glow.png"), optimize=True)
    # MERS as TGA like the vanilla packs (alpha carries subsurface, so it must survive untouched)
    Image.fromarray(mers, "RGBA").save(os.path.join(tex_dir, f"{name}_mers.tga"), compression="tga_rle")
    Image.fromarray(gmers, "RGBA").save(os.path.join(tex_dir, f"{name}_glow_mers.tga"), compression="tga_rle")
    for base in (name, f"{name}_glow"):
        kit.write_json(os.path.join(tex_dir, f"{base}.texture_set.json"), {
            "format_version": "1.21.30",
            "minecraft:texture_set": {"color": base, "metalness_emissive_roughness_subsurface": f"{base}_mers"}})
    kit.write_json(os.path.join(RP, "models", "entity", f"{name}.geo.json"), m.geometry_json(), compact=True)
    out = os.path.join(ROOT, "tools", "kit", "out")
    os.makedirs(out, exist_ok=True)
    rig = m.rig_json()
    rig["glow_zones"] = {str(k): v for k, v in sorted(m.glow_bones_by_zone(glow).items())}
    rig["texture"] = [m.tex_w, m.tex_h]
    kit.write_json(os.path.join(out, f"rig_{tag}.json"), rig)
    os.makedirs(os.path.join(ROOT, "models"), exist_ok=True)
    anims = []
    anim_file = os.path.join(out, f"bb_anims_{tag}.json")
    if os.path.exists(anim_file):
        anims = bb_animations(m, json.load(open(anim_file)))
    kit.write_json(os.path.join(ROOT, "models", f"{name}.bbmodel"),
                   m.bbmodel_json(kit.png_bytes(color), kit.png_bytes(glow), anims), compact=True)
    faces = sum(len(c.rects) for c in m.cubes)
    lo, hi = m.bounds()
    print(f"{name}: {len(m.bones)} bones, {len(m.cubes)} cubes, {faces} faces ({hidden} culled), "
          f"atlas {m.tex_w}x{m.tex_h} {fill * 100:.0f}% full, "
          f"size {(hi[0] - lo[0]) / 16:.1f} x {(hi[1] - lo[1]) / 16:.1f} x {(hi[2] - lo[2]) / 16:.1f} blocks, {time.time() - t0:.1f}s")
    return m


def bb_animations(m, table):
    """Bedrock animation JSON -> Blockbench animation list, so the .bbmodel plays the shipped clips."""
    out = []
    for anim_id, a in table.items():
        animators = {}
        for bone, ch in (a.get("bones") or {}).items():
            if bone not in m.bones:
                continue
            kfs = []
            for channel in ("rotation", "position", "scale"):
                if channel not in ch:
                    continue
                v = ch[channel]
                frames = v.items() if isinstance(v, dict) else [("0", v)]
                for t, val in frames:
                    if isinstance(val, dict):
                        val = val.get("post", val.get("pre"))
                    if not isinstance(val, list):
                        val = [val, val, val]
                    kfs.append({"channel": channel, "data_points": [{"x": str(val[0]), "y": str(val[1]), "z": str(val[2])}],
                                "uuid": kit.stable_uuid(m.name, anim_id, bone, channel, t), "time": float(t), "color": -1,
                                "interpolation": "linear"})
            animators[kit.stable_uuid(m.name, "bone", bone)] = {"name": bone, "type": "bone", "keyframes": kfs}
        loop = a.get("loop")
        out.append({"uuid": kit.stable_uuid(m.name, "anim", anim_id), "name": anim_id,
                    "loop": "loop" if loop is True else "hold" if loop == "hold_on_last_frame" else "once",
                    "override": False, "length": a.get("animation_length", 0), "snapping": 24, "selected": False,
                    "anim_time_update": a.get("anim_time_update", ""), "blend_weight": "", "start_delay": "", "loop_delay": "",
                    "animators": animators})
    return out


if __name__ == "__main__":
    tags = sys.argv[1:] or list(FORMS)
    for t in tags:
        build(t)
