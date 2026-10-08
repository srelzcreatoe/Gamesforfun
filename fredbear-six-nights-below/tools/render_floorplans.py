"""Render docs/floorplan_L0.png, L1, L2 from tools/out/floorplan.json.

Run after `node tools/export_floorplan.mjs`. Usage: python3 -I tools/render_floorplans.py
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
S = 5  # pixels per block
MARGIN = 60

COLORS = {
    '#': (52, 52, 58), '.': (214, 210, 200), 'p': (150, 132, 112), 'g': (120, 190, 210),
    ',': (78, 112, 64), '=': (92, 92, 96), 'r': (64, 64, 70), ' ': (20, 20, 24),
}
ACCESS = {'B': (140, 70, 200), 'C': (230, 190, 30), 'F': (150, 90, 40), 'G': (230, 160, 0)}
ZONE_TINT = {'safe': (80, 200, 120), 'restricted': (220, 80, 60), 'secret': (200, 150, 0), 'dev': (90, 120, 230)}


def font(size):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def main():
    data = json.load(open(os.path.join(HERE, 'out', 'floorplan.json')))
    b = data['bounds']
    W = (b['x1'] - b['x0'] + 1) * S + 2 * MARGIN
    H = (b['z1'] - b['z0'] + 1) * S + 2 * MARGIN + 90
    f_small, f_med, f_big = font(9), font(12), font(20)
    names = {'L0': 'BASEMENT (L0) - floor y -10 local / -60 world', 'L1': 'GROUND FLOOR (L1) - floor y -1 local / -51 world', 'L2': 'UPPER FLOOR (L2) - floor y 7 local / -43 world'}

    def px(x, z):
        return (MARGIN + (x - b['x0']) * S, MARGIN + (z - b['z0']) * S)

    for lid, lv in data['levels'].items():
        img = Image.new('RGB', (W, H), (12, 12, 16))
        d = ImageDraw.Draw(img, 'RGBA')
        for zi, row in enumerate(lv['rows']):
            for xi, ch in enumerate(row):
                if ch == ' ':
                    continue
                x, z = b['x0'] + xi, b['z0'] + zi
                X, Z = px(x, z)
                d.rectangle([X, Z, X + S - 1, Z + S - 1], fill=COLORS.get(ch, (255, 0, 255)))
        for r in lv['rooms']:
            tint = ZONE_TINT.get(r['zone'])
            if tint:
                x1, z1, x2, z2 = r['box']
                d.rectangle([*px(x1 + 1, z1 + 1), *px(x2, z2)], fill=tint + (40,))
        # grid
        for g in range(-10, 220, 10):
            X, _ = px(g, b['z0'])
            _, Z = px(b['x0'], g)
            d.line([X, MARGIN, X, H - MARGIN - 90], fill=(255, 255, 255, 18))
            d.line([MARGIN, Z, W - MARGIN, Z], fill=(255, 255, 255, 18))
            if g % 20 == 0:
                d.text((X - 8, MARGIN - 14), str(g), font=f_small, fill=(200, 200, 200))
                d.text((MARGIN - 28, Z - 5), str(g), font=f_small, fill=(200, 200, 200))
        # edges
        for e in lv['edges']:
            col = ACCESS[e['access'][0]] if len(e['access']) == 1 else (230, 230, 230)
            pts = [px(p[0], p[2]) for p in e['pts']]
            pts = [(x + S / 2 - 2.5, z + S / 2 - 2.5) for x, z in pts]
            dash = e['mode'] in ('vent', 'crawl', 'climb')
            for a, c in zip(pts, pts[1:]):
                if dash:
                    n = max(1, int(math.dist(a, c) / 6))
                    for k in range(0, n, 2):
                        p1 = (a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n)
                        p2 = (a[0] + (c[0] - a[0]) * (k + 1) / n, a[1] + (c[1] - a[1]) * (k + 1) / n)
                        d.line([p1, p2], fill=col + (230,), width=2)
                else:
                    d.line([a, c], fill=col + (200,), width=2)
        # nodes
        for n in lv['nodes']:
            X, Z = px(n['x'] - 0.5, n['z'] - 0.5)
            col = (255, 60, 60) if n['zone'] == 'entry' else (255, 220, 0) if n.get('golden') else (255, 255, 255)
            d.ellipse([X - 4, Z - 4, X + 4, Z + 4], fill=col, outline=(0, 0, 0))
            d.text((X + 5, Z - 5), n['id'], font=f_small, fill=(255, 255, 255))
        # cameras
        for c in lv['cameras']:
            X, Z = px(c['loc'][0] - 0.5, c['loc'][2] - 0.5)
            ang = math.atan2(c['look'][2] - c['loc'][2], c['look'][0] - c['loc'][0])
            for half in (-0.6, 0.6):
                d.line([X, Z, X + 40 * math.cos(ang + half), Z + 40 * math.sin(ang + half)], fill=(80, 200, 255, 160), width=1)
            d.polygon([(X + 9 * math.cos(ang), Z + 9 * math.sin(ang)), (X + 6 * math.cos(ang + 2.4), Z + 6 * math.sin(ang + 2.4)),
                       (X + 6 * math.cos(ang - 2.4), Z + 6 * math.sin(ang - 2.4))], fill=(80, 200, 255))
            d.text((X + 6, Z + 4), c['id'], font=f_med, fill=(80, 200, 255))
        # inputs
        for i in lv['inputs']:
            X, Z = px(i['p'][0], i['p'][2])
            col = (60, 220, 60) if i['kind'] != 'plate' else (220, 120, 220)
            d.rectangle([X, Z, X + S - 1, Z + S - 1], fill=col)
        # room labels
        for r in lv['rooms']:
            x1, z1, x2, z2 = r['box']
            cx, cz = px((x1 + x2) / 2, (z1 + z2) / 2)
            label = r['id']
            w = d.textlength(label, font=f_med)
            d.rectangle([cx - w / 2 - 2, cz - 8, cx + w / 2 + 2, cz + 8], fill=(0, 0, 0, 150))
            d.text((cx - w / 2, cz - 7), label, font=f_med, fill=(255, 240, 200))
        # title + legend
        d.text((MARGIN, 14), f'FREDBEAR: SIX NIGHTS BELOW  -  {names[lid]}', font=f_big, fill=(255, 210, 90))
        ly = H - 80
        items = [('Bonnie route', ACCESS['B']), ('Chica route', ACCESS['C']), ('Freddy route', ACCESS['F']), ('Fredbear route', ACCESS['G']),
                 ('Shared route', (230, 230, 230)), ('Attack entry', (255, 60, 60)), ('Golden relocation node', (255, 220, 0)),
                 ('Camera (view)', (80, 200, 255)), ('Button/lever input', (60, 220, 60)), ('Pressure plate', (220, 120, 220))]
        x = MARGIN
        for text, col in items:
            d.rectangle([x, ly, x + 12, ly + 12], fill=col)
            d.text((x + 16, ly), text, font=f_med, fill=(230, 230, 230))
            x += 30 + d.textlength(text, font=f_med)
            if x > W - 220:
                x = MARGIN
                ly += 20
        d.text((MARGIN, H - 30), 'Local coordinates (world = local + (0, -50, 0)). +X east, +Z south. Dashed = vent/crawl/climb. Tints: green safe, red restricted, gold secret, blue developer.',
               font=f_med, fill=(170, 170, 170))
        out = os.path.join(ROOT, 'docs', f'floorplan_{lid}.png')
        img.save(out, optimize=True)
        print('wrote', out)


if __name__ == '__main__':
    sys.exit(main())
