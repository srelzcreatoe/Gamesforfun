#!/usr/bin/env python3
"""Put a crop of a reference picture beside a render, same height, for honest comparison.

    python3 compare.py REF.png X0,Y0,X1,Y1 RENDER.png OUT.png      (crop in reference pixels; "full" for all)
"""
import sys
from PIL import Image

ref, crop, render, out = sys.argv[1:5]
a = Image.open(ref).convert("RGB")
if crop != "full":
    a = a.crop(tuple(int(v) for v in crop.split(",")))
b = Image.open(render).convert("RGB")
H = 760
a = a.resize((max(1, int(a.width * H / a.height)), H), Image.LANCZOS)
b = b.resize((max(1, int(b.width * H / b.height)), H), Image.LANCZOS)
c = Image.new("RGB", (a.width + b.width + 12, H), (20, 20, 24))
c.paste(a, (0, 0))
c.paste(b, (a.width + 12, 0))
c.save(out)
print(out, c.size)
