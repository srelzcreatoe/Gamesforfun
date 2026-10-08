#!/usr/bin/env python3
"""Integrate the supplied Hollow Dweller assets into The Observer resource pack.

The supplied files (source_assets/supplied/) are kept untouched. This script
writes namespaced copies into the resource pack:

  hollow_dweller.geo.json        -> RP/models/entity/the_observer.geo.json
                                    identifier geometry.hollow_dweller -> geometry.observer.the_observer
  hollow_dweller.animation.json  -> RP/animations/the_observer.animation.json
                                    animation.dweller.<clip> -> animation.observer.<clip>
  dweller_texture.png            -> RP/textures/entity/observer/the_observer.png (byte copy)
                                 -> RP/textures/entity/observer/the_observer_eyes.png (derived: only the two
                                    white eye cubes' pixels, for the full-brightness eye layer)

Only identifiers change, plus two locators ("eye_1", "eye_2") added to the head bone at the centre of the two eye
cubes so effects can follow the eyes. The script re-loads the outputs and asserts that every cube, UV and keyframe
is identical to the supplied data, so the integrated model looks and moves exactly like the supplied one.
"""
import hashlib
import json
import os
import shutil
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source_assets", "supplied")
RP = os.path.join(ROOT, "packs", "TheObserver_RP")

GEO_ID_IN = "geometry.hollow_dweller"
GEO_ID_OUT = "geometry.observer.the_observer"
ANIM_PREFIX_IN = "animation.dweller."
ANIM_PREFIX_OUT = "animation.observer."


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def eye_cubes(geo, tex):
    """Head cubes whose every face is near-white: the two eyes."""
    px = tex.load()
    found = []
    for b in geo["bones"]:
        if b["name"] != "head":
            continue
        for c in b.get("cubes", []):
            uv = c.get("uv")
            if not isinstance(uv, dict):
                continue
            ok = True
            for f in uv.values():
                x0, x1 = sorted((int(f["uv"][0]), int(f["uv"][0] + f["uv_size"][0])))
                y0, y1 = sorted((int(f["uv"][1]), int(f["uv"][1] + f["uv_size"][1])))
                pts = [px[x, y] for x in range(x0, max(x1, x0 + 1)) for y in range(y0, max(y1, y0 + 1))]
                ok = ok and all(p[3] > 0 and min(p[:3]) > 200 for p in pts)
            if ok:
                found.append(c)
    return found


def main():
    geo_in = json.load(open(os.path.join(SRC, "hollow_dweller.geo.json")))
    anim_in = json.load(open(os.path.join(SRC, "hollow_dweller.animation.json")))

    geo_out = json.loads(json.dumps(geo_in))
    assert geo_out["minecraft:geometry"][0]["description"]["identifier"] == GEO_ID_IN
    geo_out["minecraft:geometry"][0]["description"]["identifier"] = GEO_ID_OUT
    tex = Image.open(os.path.join(SRC, "dweller_texture.png")).convert("RGBA")
    eyes = eye_cubes(geo_out["minecraft:geometry"][0], tex)
    assert len(eyes) == 2, f"expected two eye cubes on the head, found {len(eyes)}"
    head = next(b for b in geo_out["minecraft:geometry"][0]["bones"] if b["name"] == "head")
    head["locators"] = {f"eye_{i + 1}": [round(c["origin"][0] + c["size"][0] / 2, 4), round(c["origin"][1] + c["size"][1] / 2, 4),
                                          round(c["origin"][2] - 0.05, 4)] for i, c in enumerate(eyes)}

    anim_out = {"format_version": anim_in["format_version"], "animations": {}}
    for name, body in anim_in["animations"].items():
        assert name.startswith(ANIM_PREFIX_IN), name
        anim_out["animations"][ANIM_PREFIX_OUT + name[len(ANIM_PREFIX_IN):]] = body

    paths = {
        "geo": os.path.join(RP, "models", "entity", "the_observer.geo.json"),
        "anim": os.path.join(RP, "animations", "the_observer.animation.json"),
        "tex": os.path.join(RP, "textures", "entity", "observer", "the_observer.png"),
    }
    for p in paths.values():
        os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(geo_out, open(paths["geo"], "w"), indent=1)
    json.dump(anim_out, open(paths["anim"], "w"), indent=1)
    shutil.copyfile(os.path.join(SRC, "dweller_texture.png"), paths["tex"])
    eye_tex = Image.new("RGBA", tex.size, (0, 0, 0, 0))
    for c in eyes:
        for f in c["uv"].values():
            x0, x1 = sorted((int(f["uv"][0]), int(f["uv"][0] + f["uv_size"][0])))
            y0, y1 = sorted((int(f["uv"][1]), int(f["uv"][1] + f["uv_size"][1])))
            eye_tex.paste(tex.crop((x0, y0, x1, y1)), (x0, y0))
    eye_tex.save(os.path.join(RP, "textures", "entity", "observer", "the_observer_eyes.png"))

    # ---- verification: integrated data == supplied data (identifiers aside)
    g2 = json.load(open(paths["geo"]))["minecraft:geometry"][0]
    g1 = geo_in["minecraft:geometry"][0]
    strip = lambda bones: [{k: v for k, v in b.items() if not (b["name"] == "head" and k == "locators")} for b in bones]
    assert strip(g2["bones"]) == g1["bones"], "bone/cube data changed"
    d1 = dict(g1["description"]); d2 = dict(g2["description"])
    d1.pop("identifier"); d2.pop("identifier")
    assert d1 == d2, "geometry description changed"
    a2 = json.load(open(paths["anim"]))["animations"]
    for name, body in anim_in["animations"].items():
        assert a2[ANIM_PREFIX_OUT + name[len(ANIM_PREFIX_IN):]] == body, name
    assert sha(paths["tex"]) == sha(os.path.join(SRC, "dweller_texture.png"))

    bones = {b["name"] for b in g1["bones"]}
    for name, body in a2.items():
        missing = set(body.get("bones", {})) - bones
        assert not missing, f"{name} references missing bones {missing}"

    report = {
        "geometry": {"identifier": GEO_ID_OUT, "bones": len(g1["bones"]),
                     "cubes": sum(len(b.get("cubes", [])) for b in g1["bones"]),
                     "texture_size": [g1["description"]["texture_width"], g1["description"]["texture_height"]]},
        "animations": {k: {"length": v.get("animation_length"), "loop": v.get("loop", False),
                           "bones": len(v.get("bones", {}))} for k, v in a2.items()},
        "texture_sha256": sha(paths["tex"]),
    }
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
