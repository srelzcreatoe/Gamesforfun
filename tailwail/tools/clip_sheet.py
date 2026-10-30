#!/usr/bin/env python3
"""Multi-clip contact sheet: one row per clip, N sampled frames, one view."""
import argparse, os, sys
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bedrock_model as bm
from render_preview import render, DEFAULT_DRIVERS

ap = argparse.ArgumentParser()
ap.add_argument("--geo"); ap.add_argument("--anim"); ap.add_argument("--tex"); ap.add_argument("--out")
ap.add_argument("--clips"); ap.add_argument("--frames", type=int, default=5); ap.add_argument("--view", default="three")
ap.add_argument("--ppu", type=float, default=3.2); ap.add_argument("--size", default="170x200")
ap.add_argument("--prefix", default="animation.tall_wail.")
a = ap.parse_args()
geo = bm.Geometry(a.geo); anims = bm.load_animations(a.anim); tex = Image.open(a.tex).convert("RGBA")
W, H = (int(x) for x in a.size.split("x"))
clips = a.clips.split(",")
sheet = Image.new("RGB", (W * a.frames, H * len(clips)))
for r, n in enumerate(clips):
    an = anims[a.prefix + n]; L = an.length or 1.0
    for c in range(a.frames):
        t = L * c / max(1, a.frames - 1)
        env = {"q.life_time": t}
        d = DEFAULT_DRIVERS.get(n)
        if d: env.update(d(t))
        im = render(geo, tex, bm.pose_from(anims, [(an, 1, 0)], t, env), a.view, size=(W, H), ppu=a.ppu, origin_y=H - 12)
        ImageDraw.Draw(im).text((3, 3), "%s %.2f" % (n, t), fill=(255, 255, 0))
        sheet.paste(im, (c * W, r * H))
sheet.save(a.out); print("wrote", a.out)
