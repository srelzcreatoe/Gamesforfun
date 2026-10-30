#!/usr/bin/env python3
"""Render layered clip combinations from the built RP (supplied + rehearsal animation files).

  python3 -I tools/layer_sheet.py OUT.png "reveal+tw_unfold_full@0,1,2" "planted+gfix_planted+tw_tail_drag@0" ...
Each spec: clip+clip+...@t1,t2,... ; optional ;view=side ; vars k=v,k=v
"""
import os, sys
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import bedrock_model as bm
from render_preview import render
RP = os.path.join(ROOT, "packs", "TailwailRP")
geo = bm.Geometry(os.path.join(RP, "models/entity/tall_wail.geo.json"))
anims = bm.load_animations(os.path.join(RP, "animations/tall_wail.animation.json"))
anims.update(bm.load_animations(os.path.join(RP, "animations/tall_wail.rehearsal.animation.json")))
tex = Image.open(os.path.join(RP, "textures/entity/tall_wail/tall_wail.png")).convert("RGBA")
out = sys.argv[1]; specs = sys.argv[2:]
W, H = 190, 210
rows = []
for spec in specs:
    parts = spec.split(";")
    clips, times = parts[0].split("@")
    view = "side"; env0 = {}
    for p in parts[1:]:
        k, v = p.split("=", 1)
        if k == "view": view = v
        elif k == "vars":
            for kv in v.split(","):
                a, b = kv.split(":"); env0[a] = float(b)
    row = []
    for t in [float(x) for x in times.split(",")]:
        env = dict(env0); env["q.life_time"] = t
        layers = [(anims["animation.tall_wail." + c], 1.0, 0.0) for c in clips.split("+")]
        # clips driven by anim_time_update read their variable; default it to t
        for c in clips.split("+"):
            a = anims["animation.tall_wail." + c]
            if a.anim_time_update and a.anim_time_update.startswith("v.") and a.anim_time_update not in env0:
                env[a.anim_time_update] = t
        pose = bm.pose_from(anims, layers, t, env)
        im = render(geo, tex, pose, view, size=(W, H), ppu=3.0, origin_y=H - 10)
        ImageDraw.Draw(im).text((3, 3), "%s t=%.2f" % (clips[:28], t), fill=(255, 255, 0))
        row.append(im)
    rows.append(row)
cols = max(len(r) for r in rows)
sheet = Image.new("RGB", (W * cols, H * len(rows)))
for r, row in enumerate(rows):
    for c, im in enumerate(row):
        sheet.paste(im, (c * W, r * H))
sheet.save(out); print("wrote", out)
