#!/usr/bin/env python3
"""Copies Tailwail's model and texture from the untouched supplied archive into the RP.

  python3 -I tools/build_assets.py [--check]

Inputs : source_assets/original/TallWail_Blockbench_v3.zip (never modified)
Outputs: packs/TailwailRP/models/entity/tall_wail.geo.json        (copy; culling bounds widened)
         packs/TailwailRP/textures/entity/tall_wail/tall_wail.png  (copy; pupils painted out)

The supplied animation file is NOT shipped: tools/anim_v3.py reads it straight from the
archive and re-bakes what it reuses into the single v3 animation file.  --check fails
if the committed outputs differ from what this script would write (tools/validate.py).
"""
import argparse
import hashlib
import io
import json
import os
import zipfile

from PIL import Image

ROOT = os.environ.get("TAILWAIL_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP = os.path.join(ROOT, "source_assets", "original", "TallWail_Blockbench_v3.zip")
RP = os.path.join(ROOT, "packs", "TailwailRP")
OUT_GEO = os.path.join(RP, "models", "entity", "tall_wail.geo.json")
OUT_TEX = os.path.join(RP, "textures", "entity", "tall_wail", "tall_wail.png")
EXPECTED_SHA = {
    "tall_wail.geo.json": "b180cc397834a173d539df0857ec9761046829a7d5cd461ee4a87d36f622511b",
    "tall_wail.animation.json": "e903f5e905ea3c834abe7900a0953ce48ca1c6dc10f26eda97ea34fceebb5604",
    "tall_wail.png": "a23e2443f5124bc177d25c98bdcb4e49422f165b12f97b3dd4688d1ce033a0e7",
}

# The two pale pupil pixels on the black face (head front, uv 5,22 and 19,22).  Painted with
# the face colour around them: the eyes are empty black sockets.
PUPILS = [(5, 22), (19, 22)]


def paint_out_pupils(png):
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    px = im.load()
    for x, y in PUPILS:
        n = [px[x - 1, y], px[x + 1, y], px[x, y - 1], px[x, y + 1]]
        px[x, y] = tuple(sum(c[i] for c in n) // len(n) for i in range(3)) + (255,)
    out = io.BytesIO()
    im.save(out, format="PNG", optimize=False)
    return out.getvalue()


def build(check=False):
    with zipfile.ZipFile(ZIP) as zf:
        raw = {os.path.basename(n): zf.read(n) for n in zf.namelist() if not n.endswith("/")}
    for name, sha in EXPECTED_SHA.items():
        got = hashlib.sha256(raw[name]).hexdigest()
        if got != sha:
            raise SystemExit("supplied asset %s changed: %s" % (name, got))
    outputs = {}
    # geometry: identical except culling bounds sized for the 1.5x render scale and full reach
    geo = json.loads(raw["tall_wail.geo.json"])
    d = geo["minecraft:geometry"][0]["description"]
    d["visible_bounds_width"] = 8
    d["visible_bounds_height"] = 7.5
    d["visible_bounds_offset"] = [0, 3.5, 0]
    outputs[OUT_GEO] = (json.dumps(geo, indent=1) + "\n").encode()
    outputs[OUT_TEX] = paint_out_pupils(raw["tall_wail.png"])
    bad = []
    for path, data in outputs.items():
        if check:
            if not os.path.exists(path) or open(path, "rb").read() != data:
                bad.append(os.path.relpath(path, ROOT))
        else:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fh:
                fh.write(data)
    if check and bad:
        raise SystemExit("outdated copies: %s (run tools/build_assets.py)" % ", ".join(bad))
    print("model and texture %s" % ("match the archive (+ pupils painted out)" if check else "copied"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    build(ap.parse_args().check)
