#!/usr/bin/env python3
"""Renders docs/images/pose_board.png: what the client controllers actually produce for key
states (composite of body + every overlay at the in-game 1.5x scale; guides in blocks), from
tools/client_sim.py.  Offline renders of the shipped model and clips, not in-game screenshots."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from PIL import Image, ImageDraw  # noqa: E402

import bedrock_model as bm  # noqa: E402
import client_sim as cs  # noqa: E402
from render_preview import render  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "docs", "images", "pose_board.png")
CASES = [  # label, pose id, posture, speed, tail, breath, tremor, jaw, look_yaw, view, settle
    ("stalking (hunched)", 0, 1, 0.0, 0, 1, 0, 3, 0, "three", 2.0),
    ("frozen: reach", 6, 0, 0.0, 0, 1, 0, 3, 0, "three", 1.0),
    ("frozen: arms up", 7, 0, 0.0, 0, 2, 1, 10, 0, "three", 1.0),
    ("frozen: sideways", 10, 0, 0.0, 1, 2, 1, 10, 0, "three", 1.0),
    ("head tilt", 2, 0, 0.0, 1, 2, 1, 10, 0, "front", 1.6),
    ("neck stretch", 4, 0, 0.0, 4, 3, 2, 22, 0, "side", 1.8),
    ("jaw unhinged", 5, 0, 0.0, 4, 3, 3, 50, 0, "front", 1.2),
    ("owl turn", 0, 0, 0.0, 0, 1, 0, 3, 170, "three", 2.0),
    ("full height", 13, 0, 0.0, 2, 0, 0, 0, 0, "three", 2.2),
    ("the wail", 17, 0, 0.0, 2, 0, 2, 60, 0, "three", 1.0),
    ("chase (gallop)", 0, 1, 6.9, 3, 3, 1, 32, 0, "side", 2.0),
    ("tunnel crawl", 0, 2, 3.0, 2, 3, 1, 32, 0, "side", 2.0),
    ("the grab", 20, 0, 0.0, 2, 3, 1, 45, 0, "side", 0.9),
    ("thrown", 21, 0, 0.0, 2, 3, 1, 45, 0, "three", 0.6),
    ("sniffing", 22, 1, 0.0, 1, 2, 1, 8, 0, "side", 1.4),
    ("enraged", 23, 0, 0.0, 2, 3, 2, 55, 0, "three", 1.7),
]


def main():
    pack = cs.Pack()
    d = pack.clients["tailwail:tall_wail"]
    geo = bm.Geometry(pack.geo[d["geometry"]["default"]][0])
    tex = Image.open(os.path.join(ROOT, "packs", "TailwailRP", "textures", "entity", "tall_wail", "tall_wail.png")).convert("RGBA")
    W, H, cols = 220, 260, 4
    sheet = Image.new("RGB", (W * cols, H * ((len(CASES) + cols - 1) // cols)), (14, 14, 18))
    for i, (label, pose, pt, spd, tail, br, trem, jaw, yaw, view, settle) in enumerate(CASES):
        sim = cs.ClientSim(pack, "tailwail:tall_wail", fps=30)
        p = sim.props
        p["tailwail:posture"], p["tailwail:tail"], p["tailwail:breath"], p["tailwail:tremor"], p["tailwail:jaw"] = pt, tail, br, trem, jaw
        p["tailwail:look_yaw"] = yaw
        sim.speed = spd
        sim.run(2.5)
        p["tailwail:pose"] = pose
        sim.run(settle)
        im = render(geo, tex, cs.composite(pack, sim), view, size=(W, H), ppu=2.05, origin_y=H - 14, scale=1.5)
        dr = ImageDraw.Draw(im)
        dr.text((6, 6), label, fill=(235, 220, 160))
        sheet.paste(im, ((i % cols) * W, (i // cols) * H))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
