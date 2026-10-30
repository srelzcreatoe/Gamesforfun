#!/usr/bin/env python3
"""Renders docs/images/pose_board.png: what the client actually shows for key states and
one-shots (body controller + every overlay at the in-game 1.5x scale, plus the one-shot clip
the script plays over the neutral state; guides in blocks), via tools/client_sim.py.
Offline renders of the shipped model and clips, not in-game screenshots."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from PIL import Image, ImageDraw  # noqa: E402

import bedrock_model as bm  # noqa: E402
import client_sim as cs  # noqa: E402
import gen_client_v3 as gc  # noqa: E402
from render_preview import render  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "docs", "images", "pose_board.png")
A = "animation.tall_wail.v3."
CASES = [  # label, act, one-shot (or None), shot time, speed, tail, breath, tremor, jaw, look_yaw, view, settle
    ("watching you", "watch", None, 0, 0.0, 0, 2, 1, 6, 0, "three", 3.4),
    ("full height", "tall", None, 0, 0.0, 2, 2, 1, 10, 0, "three", 2.2),
    ("crouched to pounce", "watch_low", None, 0, 0.0, 1, 3, 1, 10, 0, "three", 1.0),
    ("peeking", "peek_r", None, 0, 0.0, 0, 1, 0, 4, 0, "front", 1.5),
    ("the wail", "shot", "scream", 1.0, 0.0, 3, 0, 2, 0, 0, "three", 0.5),
    ("the charge (gallop)", "loco", None, 0, 8.4, 1, 3, 1, 22, 0, "side", 2.0),
    ("rake", "shot", "swipe_r", 0.24, 0.0, 3, 3, 1, 0, 0, "three", 0.5),
    ("slam", "shot", "slam", 0.36, 0.0, 3, 3, 1, 0, 0, "side", 0.5),
    ("pounce", "shot", "pounce", 0.45, 0.0, 3, 3, 1, 0, 0, "side", 0.5),
    ("it has you", "hold", None, 0, 0.0, 3, 3, 1, 30, 0, "side", 1.2),
    ("the bite", "shot", "bite", 0.3, 0.0, 3, 3, 1, 0, 0, "three", 0.5),
    ("on the ceiling", "cling", None, 0, 0.0, 0, 1, 0, 10, 0, "three", 1.5),
    ("climbing", "climb", None, 0, 0.0, 0, 3, 1, 10, 0, "side", 0.6),
    ("tunnel crawl", "loco_tunnel", None, 0, 2.6, 4, 3, 1, 20, 0, "side", 2.0),
    ("hammering a door", "bash", None, 0, 0.0, 1, 3, 1, 30, 0, "three", 0.4),
    ("savouring it", "savor", None, 0, 0.0, 2, 2, 0, 10, 0, "three", 2.2),
]


def main():
    pack = cs.Pack()
    d = pack.clients["tailwail:tall_wail"]
    geo = bm.Geometry(pack.geo[d["geometry"]["default"]][0])
    tex = Image.open(os.path.join(ROOT, "packs", "TailwailRP", "textures", "entity", "tall_wail", "tall_wail.png")).convert("RGBA")
    W, H, cols = 220, 260, 4
    sheet = Image.new("RGB", (W * cols, H * ((len(CASES) + cols - 1) // cols)), (14, 14, 18))
    for i, (label, act, shot, st, spd, tail, br, trem, jaw, yaw, view, settle) in enumerate(CASES):
        sim = cs.ClientSim(pack, "tailwail:tall_wail", fps=30)
        p = sim.props
        p["tailwail:tail"], p["tailwail:breath"], p["tailwail:tremor"], p["tailwail:jaw"] = tail, br, trem, jaw
        p["tailwail:look_yaw"] = yaw
        sim.speed = spd
        sim.run(2.5)
        p["tailwail:act"] = gc.ACT_ID[act]
        sim.run(settle)
        pose = cs.composite(pack, sim)
        if shot:
            anim = cs._anim_cache(A + shot, pack.anims[A + shot])
            shim = cs._MolangShim()
            old = bm.MOLANG
            bm.MOLANG = shim
            try:
                extra = anim.sample(st, {"q.life_time": st})
            finally:
                bm.MOLANG = old
            for bone, chans in extra.items():
                dst = pose.setdefault(bone, {})
                for ch, v in chans.items():
                    dst[ch] = dst.get(ch, 0.0) + v
        im = render(geo, tex, pose, view, size=(W, H), ppu=2.05, origin_y=H - 14, scale=1.5)
        dr = ImageDraw.Draw(im)
        dr.text((6, 6), label, fill=(235, 220, 160))
        sheet.paste(im, ((i % cols) * W, (i // cols) * H))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
