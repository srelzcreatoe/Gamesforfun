"""Generates the Mobsmith launcher icons (adaptive foreground + legacy) with Pillow."""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'src', 'main', 'res')
BG = (15, 23, 32, 255)
# 10x10 pixel mob: G green, D dark green, E eye white, P pupil, M mouth, A amber spark
ART = [
    "....AA....",
    "...A..A...",
    ".GGGGGGGG.",
    ".GGGGGGGG.",
    ".GEPGGEPG.",
    ".GEPGGEPG.",
    ".GGGGGGGG.",
    ".GGMMMMGG.",
    ".DDDDDDDD.",
    "..........",
]
COL = {'G': (52, 211, 153, 255), 'D': (16, 140, 98, 255), 'E': (240, 253, 244, 255), 'P': (15, 23, 32, 255),
       'M': (6, 78, 59, 255), 'A': (251, 191, 36, 255)}


def draw_art(img, x0, y0, cell):
    d = ImageDraw.Draw(img)
    for r, row in enumerate(ART):
        for c, ch in enumerate(row):
            if ch in COL:
                d.rectangle([x0 + c * cell, y0 + r * cell, x0 + (c + 1) * cell - 1, y0 + (r + 1) * cell - 1], fill=COL[ch])


def foreground(px):
    img = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    cell = round(px * 0.56 / 10)
    off = (px - cell * 10) // 2
    draw_art(img, off, off, cell)
    return img


def legacy(px):
    img = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, px - 1, px - 1], radius=px // 5, fill=BG)
    cell = round(px * 0.74 / 10)
    off = (px - cell * 10) // 2
    draw_art(img, off, off, cell)
    return img


for name, dp in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]:
    d = os.path.join(RES, f'mipmap-{name}')
    os.makedirs(d, exist_ok=True)
    foreground(int(108 * dp)).save(os.path.join(d, 'ic_launcher_foreground.png'))
    legacy(int(48 * dp)).save(os.path.join(d, 'ic_launcher.png'))
legacy(512).save(os.path.join(HERE, '..', 'web', 'icon-512.png'))
print('icons written')
