#!/usr/bin/env python3
"""Dump texture sheets (colour | MER as R,G,B channels | height) upscaled for inspection.
   python3 tools/blocks/props/sheets.py out.png tex1 tex2 ..."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
TEX = Path(__file__).resolve().parents[3] / 'packs/RP/textures/blocks/fnar'


def tile(img, s):
    return img.resize((img.width * s, img.height * s), Image.NEAREST)


def main(out, names, scale=None):
    rows = []
    for n in names:
        c = Image.open(TEX / f'{n}.png').convert('RGBA')
        m = Image.open(TEX / f'{n}_mer.png').convert('RGB')
        h = Image.open(TEX / f'{n}_height.png').convert('L')
        s = scale or max(2, min(12, 384 // max(c.width, c.height)))
        bg = Image.new('RGBA', c.size, (255, 0, 255, 255)); bg.alpha_composite(c)
        parts = [bg] + [Image.merge('RGB', [ch] * 3).convert('RGBA') for ch in m.split()] + [h.convert('RGBA')]
        rows.append((n, [tile(p, s) for p in parts]))
    W = max(sum(p.width + 6 for p in ps) for _, ps in rows)
    H = sum(ps[0].height + 18 for _, ps in rows)
    out_im = Image.new('RGBA', (W, H), (24, 24, 28, 255))
    d = ImageDraw.Draw(out_im)
    y = 0
    for n, ps in rows:
        d.text((4, y + 2), f'{n}   colour | metal | emissive | rough | height', fill=(220, 210, 190, 255))
        x = 0
        for p in ps:
            out_im.paste(p, (x, y + 16)); x += p.width + 6
        y += ps[0].height + 18
    out_im.save(out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
