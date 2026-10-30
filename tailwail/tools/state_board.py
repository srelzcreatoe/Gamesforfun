#!/usr/bin/env python3
"""Renders a 3x3 board of key states, layered the way the client controllers compose them.
These are renders from tools/bedrock_model.py (not in-game screenshots).

  python3 -I tools/state_board.py docs/images/state_board.png
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bedrock_model as bm  # noqa: E402
from render_preview import render  # noqa: E402

RP = os.path.join(os.path.dirname(HERE), "packs", "TailwailRP")
P = "animation.tall_wail."
STATES = [
    ("stalk (folded, tail drags)", ["planted", "gfix_planted", "tw_tail_drag_low"], 0.05, {}, "three"),
    ("stand-off, calm", ["idle_nt", "watch_nt", "tw_tail_drag", "look"], 1.0, {"v.look_y": 25}, "three"),
    ("delayed copy of a crouch", ["idle_nt", "watch_nt", "tw_tail_drag", "tw_mimic_crouch"], 1.0, {"v.mimic_crouch": 1.0}, "side"),
    ("agitated: twitch + head tilt", ["idle_nt", "menace_nt", "tw_tail_twitch", "tw_mimic_tilt"], 1.36, {"v.mimic_roll": 26, "v.mimic_pitch": -12}, "three"),
    ("the unfolding (rigid tail)", ["reveal", "tw_unfold_full", "tw_tail_rigid"], 2.0, {}, "three"),
    ("wind-up, coiled (3.2 s)", ["windup", "gfix_windup", "tw_tail_rigid", "jaw"], 3.2, {"v.jaw": 16}, "three"),
    ("pursuit gallop + wail", ["crawl", "gfix_crawl", "scream_nt", "jaw"], 0.3, {"v.crawl": 0.3, "v.jaw": 34}, "side"),
    ("strike impact frame", ["tw_strike", "gfix_tw_strike"], 0.55, {}, "side"),
    ("2-block tunnel crawl", ["crawl", "tw_tunnel_move"], 0.6, {"v.crawl": 0.6}, "three"),
]


def main(out):
    geo = bm.Geometry(os.path.join(RP, "models/entity/tall_wail.geo.json"))
    anims = bm.load_animations(os.path.join(RP, "animations/tall_wail.animation.json"))
    anims.update(bm.load_animations(os.path.join(RP, "animations/tall_wail.rehearsal.animation.json")))
    tex = Image.open(os.path.join(RP, "textures/entity/tall_wail/tall_wail.png")).convert("RGBA")
    W, H = 300, 300
    board = Image.new("RGB", (W * 3, H * 3 + 24), (18, 16, 16))
    for i, (title, clips, t, env, view) in enumerate(STATES):
        e = {"q.life_time": t, **env}
        pose = bm.pose_from(anims, [(anims[P + c], 1, 0) for c in clips], t, e)
        im = render(geo, tex, pose, view, size=(W, H), ppu=4.2, origin_y=H - 14)
        ImageDraw.Draw(im).text((6, 6), title, fill=(235, 220, 170))
        board.paste(im, ((i % 3) * W, (i // 3) * H))
    ImageDraw.Draw(board).text((6, H * 3 + 6), "Renders from the repo's preview evaluator at scale 1 with 1-block ticks; not in-game screenshots.", fill=(160, 150, 130))
    board.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "state_board.png")
