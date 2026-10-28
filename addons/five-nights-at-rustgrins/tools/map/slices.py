# Top-down slice renders of the voxel snapshot (debug view of the floor plan).
# Usage: python3 tools/map/slices.py tools/.cache/map.json out_prefix y [y ...]
import sys, json, base64, hashlib
import numpy as np
from PIL import Image, ImageDraw
snap = json.load(open(sys.argv[1]))
pre = sys.argv[2]
ys = [int(v) for v in sys.argv[3:]] or [0]
sx, sy, sz = snap['size']; x0, y0, z0 = snap['origin']
data = np.frombuffer(base64.b64decode(snap['data']), dtype='<u2').reshape(sy, sz, sx)
pal = snap['palette']
def color(i):
    if i == 0: return (12, 12, 16)
    n = pal[i]['name']
    fixed = {
      'fnar:tile_checker': (200, 200, 195), 'fnar:tile_checker_worn': (170, 170, 160), 'fnar:tile_office': (90, 95, 100),
      'minecraft:gray_concrete': (60, 60, 64), 'fnar:wall_checker': (120, 120, 120), 'fnar:duct_metal': (150, 170, 190),
      'minecraft:grass_block': (60, 110, 50), 'minecraft:polished_blackstone': (40, 36, 44), 'minecraft:brick_block': (150, 70, 55),
      'fnar:party_table': (230, 230, 230), 'fnar:party_chair': (200, 40, 40), 'fnar:stage_floor': (70, 50, 40),
      'fnar:curtain_purple': (110, 40, 140), 'fnar:curtain_red': (160, 30, 30), 'fnar:tent_stripe': (200, 80, 80), 'fnar:carpet_party': (60, 40, 90),
    }
    if n in fixed: return fixed[n]
    h = hashlib.md5(n.encode()).digest()
    return (60 + h[0] % 160, 60 + h[1] % 160, 60 + h[2] % 160)
cols = np.array([color(i) for i in range(len(pal))], dtype=np.uint8)
S = 6
for y in ys:
    sl = data[y - y0]
    img = Image.fromarray(cols[sl]).resize((sx * S, sz * S), Image.NEAREST)
    d = ImageDraw.Draw(img)
    for gx in range(0, sx, 10):
        X = (gx + ((-x0) % 10)) * S
        d.line([(X, 0), (X, sz * S)], fill=(255, 255, 0) if (gx + x0 + ((-x0) % 10)) % 50 == 0 else (80, 80, 0))
    for gz in range(0, sz, 10):
        Z = (gz + ((-z0) % 10)) * S
        d.line([(0, Z), (sx * S, Z)], fill=(80, 80, 0))
    d.text((4, 4), f'y={y}  x0={x0} z0={z0} (grid every 10, bright = x multiple of 50)', fill=(255, 255, 255))
    img.save(f'{pre}_y{y}.png')
print('ok')
