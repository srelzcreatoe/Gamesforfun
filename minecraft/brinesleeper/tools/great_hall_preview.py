"""Preview one of the script-placed great halls: stamp it into a block of rock and export it for viewer/biome.html.
Usage: python3 great_hall_preview.py <out dir> <variant 0-2>"""
import os
import sys

import numpy as np

import biome_preview as bp
import biome_shapes as shapes

OUT, VAR = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 0
os.makedirs(OUT, exist_ok=True)
if 'chest' not in bp.NAMES:
    bp.NAMES.append('chest')
    bp.ID['chest'] = len(bp.NAMES) - 1
v = np.full((bp.SX, bp.SY, bp.SZ), bp.DEEP, np.int16)
w = bp.World(v)
hall = shapes.great_hall(5000 + 31 * VAR)
ox, oz = (bp.SX - shapes.GH_W) // 2, (bp.SZ - shapes.GH_W) // 2
oy = bp.WY - shapes.GH_D


def extra(x, y, z, name, states):
    short = name.split(':')[1]
    if short.startswith('pale_dripstone_'):
        w.pale[(x, y, z)] = (short[len('pale_dripstone_'):], True)
    elif short == 'weeping_vines':
        w.vines[(x, y, z)] = 0
    elif short == 'pointed_dripstone':
        w.drip[(x, y, z)] = (states['dripstone_thickness'], bool(states['hanging']))
    elif short in ('bone_coral', 'bloodroot', 'pallid_cap'):
        w.plants[(x, y, z)] = short
    elif short.endswith('candle'):
        w.candles[(x, y, z)] = (states['candles'] + 1, short.startswith('red'))
    v[x, y, z] = bp.AIR


for (i, j, k, name, states) in hall.cells():
    x, y, z = ox + i, oy + j, oz + k
    short = name.split(':')[1]
    if short in bp.ID:
        v[x, y, z] = bp.ID[short]
    else:
        extra(x, y, z, name, states)
for (x, y, z) in list(w.vines):                       # vine tips: the lowest block of each strand
    if (x, y - 1, z) not in w.vines:
        w.vines[(x, y, z)] = 1
sc, _ = bp.export(w, OUT)
bp.preview_textures(f'{OUT}/biome_tex')
bp.biome.textures(f'{OUT}/biome_tex')
print('great hall', VAR, 'faces', sc['faces'], 'views', list(sc['views']))
