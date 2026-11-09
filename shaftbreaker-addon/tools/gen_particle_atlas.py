#!/usr/bin/env python3
"""64x64 particle atlas (8x8 cells). Sprites are white/grey so particle tinting colours them."""
import os, math
import numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
a = np.zeros((64, 64, 4), np.uint8)
def cell(c, r, fn):
    for y in range(8):
        for x in range(8):
            v = fn(x, y)
            if v:
                a[r*8+y, c*8+x] = v
W = lambda g, al=255: (g, g, g, al)
cell(0, 0, lambda x, y: W(255 if (x+y) % 3 else 200) if 2 <= x <= 5 and 2 <= y <= 5 and not (x == 5 and y == 2) else None)
cell(2, 0, lambda x, y: W(255, int(max(0, 1 - math.hypot(x-3.5, y-3.5)/4.0) * 255)) if math.hypot(x-3.5, y-3.5) < 4 else None)
cell(3, 0, lambda x, y: W(255) if 2 <= x <= 5 and 3 <= y <= 4 or (x in (3, 4) and y in (2, 5)) else None)
cell(4, 0, lambda x, y: W(230) if abs(x-3.5)+abs(y-3.5) <= 2.5 else None)
cell(5, 0, lambda x, y: W(255) if (x in (3, 4) and 1 <= y <= 6) or (x in (2, 5) and 3 <= y <= 5) else None)
cell(6, 0, lambda x, y: W(255, int(max(0, 1 - math.hypot(x-3.5, y-3.5)/3.6) ** 1.5 * 255)) if math.hypot(x-3.5, y-3.5) < 3.6 else None)
cell(7, 0, lambda x, y: W(255) if x in (3, 4) and y in (3, 4) else None)
cell(0, 1, lambda x, y: W(255, int(max(0, 1 - ((x-3.5)/3.8)**2 - ((y-3.5)/2.6)**2) ** 0.6 * 255)) if ((x-3.5)/3.8)**2 + ((y-3.5)/2.6)**2 < 1 else None)
cell(1, 1, lambda x, y: W(255, 255 if (x in (3, 4) or y in (3, 4)) else 120) if (x in (3, 4) or y in (3, 4) or abs(x-y) == 0 or x+y == 7) and math.hypot(x-3.5, y-3.5) < 4 else None)
cell(2, 1, lambda x, y: W(255) if 2.6 <= math.hypot(x-3.5, y-3.5) <= 3.7 else None)
os.makedirs(os.path.join(ROOT, 'RP/textures/particle'), exist_ok=True)
Image.fromarray(a, 'RGBA').save(os.path.join(ROOT, 'RP/textures/particle/shaftbreaker_particles.png'))
print('atlas ok')
