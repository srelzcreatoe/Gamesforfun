#!/usr/bin/env python3
"""Review sheets for v2 clips: rows = clips, columns = sampled times; view per row.
  python3 -I tools/review_v2.py OUT.png clip[@view][:t1,t2,...] ...
"""
import os, sys
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bedrock_model as bm
from render_preview import render
RP = os.path.join(os.path.dirname(HERE), "packs", "TailwailRP")
geo = bm.Geometry(os.path.join(RP, "models/entity/tall_wail.geo.json"))
anims = bm.load_animations(os.path.join(RP, "animations/tall_wail.animation.json"))
anims.update(bm.load_animations(os.path.join(RP, "animations/tall_wail.v2.animation.json")))
tex = Image.open(os.path.join(RP, "textures/entity/tall_wail/tall_wail.png")).convert("RGBA")
W, H = 180, 200
rows = []
for spec in sys.argv[2:]:
    times = None
    if ":" in spec:
        spec, ts = spec.split(":"); times = [float(x) for x in ts.split(",")]
    view = "three"
    if "@" in spec:
        spec, view = spec.split("@")
    layers = spec.split("+")
    a = anims["animation.tall_wail." + layers[0]]
    L = a.length or 1.0
    times = times or [L * i / 4 for i in range(5)]
    row = []
    for t in times:
        env = {"q.life_time": t, "v.br_amp": 0, "v.br_ph": 0, "v.tremor": 0, "v.crawl": t % 1}
        pose = bm.pose_from(anims, [(anims["animation.tall_wail." + l], 1, 0) for l in layers], t, env)
        im = render(geo, tex, pose, view, size=(W, H), ppu=3.0, origin_y=H - 10)
        ImageDraw.Draw(im).text((3, 3), "%s %.2f" % (layers[0][4:], t), fill=(255, 255, 0))
        row.append(im)
    rows.append(row)
cols = max(len(r) for r in rows)
sheet = Image.new("RGB", (W * cols, H * len(rows)))
for r, row in enumerate(rows):
    for c, im in enumerate(row):
        sheet.paste(im, (c * W, r * H))
sheet.save(sys.argv[1]); print("wrote", sys.argv[1])
