#!/usr/bin/env python3
"""Reports the world-space bounds of every exported prop geometry (after cube and bone rotations,
Blockbench conventions) and flags anything that leaves the block cell (x/z -8..8, y 0..16).
   python3 tools/blocks/props/check_bounds.py"""
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
GEO = ROOT / 'packs/RP/models/blocks'
PROPS = json.loads((Path(__file__).parent / 'preview_manifest.json').read_text()).keys()


def rot(r):
    """Bedrock rotation [rx, ry, rz] -> matrix acting on three/world coordinates (Euler ZYX of -rx, -ry, rz)."""
    ax, ay, az = (-r[0]) * math.pi / 180, (-r[1]) * math.pi / 180, r[2] * math.pi / 180
    Rx = np.array([[1, 0, 0], [0, math.cos(ax), -math.sin(ax)], [0, math.sin(ax), math.cos(ax)]])
    Ry = np.array([[math.cos(ay), 0, math.sin(ay)], [0, 1, 0], [-math.sin(ay), 0, math.cos(ay)]])
    Rz = np.array([[math.cos(az), -math.sin(az), 0], [math.sin(az), math.cos(az), 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def w(p):  # bedrock point -> world (x mirrored)
    return np.array([-p[0], p[1], p[2]], dtype=float)


def bounds(geo):
    bones = {b['name']: b for b in geo['bones']}
    lo, hi = np.full(3, 1e9), np.full(3, -1e9)
    for b in geo['bones']:
        for c in b.get('cubes', []):
            o, s = c['origin'], c['size']
            mn = w([o[0] + s[0], o[1], o[2]])
            corners = np.array([mn + np.array([dx * s[0], dy * s[1], dz * s[2]]) for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)])
            if c.get('rotation'):
                pv = w(c.get('pivot', [0, 0, 0]))
                corners = (corners - pv) @ rot(c['rotation']).T + pv
            bb = b
            while bb is not None:
                if bb.get('rotation'):
                    pv = w(bb.get('pivot', [0, 0, 0]))
                    corners = (corners - pv) @ rot(bb['rotation']).T + pv
                bb = bones.get(bb.get('parent')) if bb.get('parent') else None
            lo, hi = np.minimum(lo, corners.min(0)), np.maximum(hi, corners.max(0))
    return lo, hi


bad = 0
for name in sorted(PROPS):
    f = GEO / f'{name}.geo.json'
    for geo in json.loads(f.read_text())['minecraft:geometry']:
        lo, hi = bounds(geo)
        out = (lo < [-8.001, -0.001, -8.001]).any() or (hi > [8.001, 16.001, 8.001]).any()
        bad += out
        print(f"{'OUT ' if out else 'ok  '}{geo['description']['identifier']:42s} x {lo[0]:6.2f}..{hi[0]:6.2f}  y {lo[1]:6.2f}..{hi[1]:6.2f}  z {lo[2]:6.2f}..{hi[2]:6.2f}")
print(f'{bad} geometries leave the cell')
