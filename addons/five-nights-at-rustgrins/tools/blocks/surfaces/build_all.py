"""Rebuild every section-A asset (surfaces, signage, lights) and the preview sheets.

  python3 tools/blocks/surfaces/build_all.py          # textures, models, blocks, fragments, merge, sheets
  node tools/blocks/surfaces/preview3d.mjs            # 3-D renders (custom shapes + a test room)
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import gen_blocks  # noqa: E402
import gen_cubes  # noqa: E402
import gen_lights  # noqa: E402
import gen_panels  # noqa: E402
import portrait  # noqa: E402
from pixlib import ROOT, contact_sheet, load_tex  # noqa: E402


def mer_view(name):
    """Colour | MER (as RGB) | height side by side."""
    col, mer, hgt = load_tex(name)
    h3 = np.stack([hgt] * 3, -1)
    a = np.full(col.shape[:2] + (1,), 255, np.uint8)
    return np.concatenate([col, np.concatenate([mer, a], -1), np.concatenate([h3, a], -1)], 1)


def main():
    cubes = gen_cubes.build()
    panels = gen_panels.build()
    lights = gen_lights.build()
    blocks, texs = gen_blocks.build()
    subprocess.run(['node', os.path.join(ROOT, 'tools', 'merge_fragments.mjs')], check=True)

    contact_sheet([(n, t.color()) for n, t in cubes], os.path.join(HERE, 'preview_cubes.png'), scale=8, cols=4)
    contact_sheet([(n, mer_view(n)) for n, _ in cubes], os.path.join(HERE, 'preview_cubes_pbr.png'), scale=6,
                  tile3=False, cols=4)
    gen_panels.preview(panels, os.path.join(HERE, 'preview_panels.png'), scale=6)
    contact_sheet([(n, t.color()) for n, t in lights.items()], os.path.join(HERE, 'preview_lights.png'), scale=8,
                  tile3=False, cols=5)
    contact_sheet([(n, mer_view(n)) for n in lights], os.path.join(HERE, 'preview_lights_pbr.png'), scale=6,
                  tile3=False, cols=3)
    portrait.reference_sheet(os.path.join(HERE, 'preview_sprites.png'))
    print(f'section A: {len(blocks)} blocks, {len(texs)} texture sets')


if __name__ == '__main__':
    main()
