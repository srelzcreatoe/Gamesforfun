#!/usr/bin/env python3
"""Turn the two particle sheets supplied by the user into particle atlases.

source_assets/supplied_particles/vanish_sheet.png  crimson shreds  -> textures/particle/observer/vanish.png
source_assets/supplied_particles/wisp_sheet.png    grey wisps      -> textures/particle/observer/wisp.png

Each sheet holds loose shapes scattered on a transparent background. Every shape (a connected group of
non-transparent pixels, fragments within 2 px merged) is copied pixel-for-pixel — no scaling or recolouring —
into its own cell of a regular grid, so a particle can pick one shape with a simple UV offset. Empty cells are
filled by repeating shapes. Prints the cell size and grid used by the particle JSON.
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source_assets", "supplied_particles")
OUT = os.path.join(ROOT, "packs", "TheObserver_RP", "textures", "particle", "observer")


def shapes(img, merge=2):
    w, h = img.size
    px = img.load()
    solid = [[px[x, y][3] > 0 for x in range(w)] for y in range(h)]
    seen = [[False] * w for _ in range(h)]
    found = []
    for y in range(h):
        for x in range(w):
            if not solid[y][x] or seen[y][x]:
                continue
            stack, pts = [(x, y)], []
            seen[y][x] = True
            while stack:
                cx, cy = stack.pop()
                pts.append((cx, cy))
                for dy in range(-merge, merge + 1):
                    for dx in range(-merge, merge + 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and solid[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx] = True
                            stack.append((nx, ny))
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            if len(pts) >= 12:  # ignore stray specks
                found.append((min(xs), min(ys), max(xs) + 1, max(ys) + 1, pts))
    return found


def atlas(name, cols, rows, merge=2):
    img = Image.open(os.path.join(SRC, f"{name}_sheet.png")).convert("RGBA")
    found = shapes(img, merge)
    cw = max(b[2] - b[0] for b in found)
    ch = max(b[3] - b[1] for b in found)
    cell = max(cw, ch)
    cell = 1 << (cell - 1).bit_length()  # power of two keeps UV maths exact
    out = Image.new("RGBA", (cols * cell, rows * cell), (0, 0, 0, 0))
    for i in range(cols * rows):
        x0, y0, x1, y1, pts = found[i % len(found)]
        piece = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        src = img.load()
        for (px_, py_) in pts:
            piece.putpixel((px_ - x0, py_ - y0), src[px_, py_])
        cx, cy = (i % cols) * cell, (i // cols) * cell
        out.alpha_composite(piece, (cx + (cell - piece.width) // 2, cy + (cell - piece.height) // 2))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.png")
    out.save(path)
    print(f"{name}: {len(found)} shapes, cell {cell}px, grid {cols}x{rows}, atlas {out.size[0]}x{out.size[1]} -> {os.path.relpath(path, ROOT)}")
    return len(found), cell


if __name__ == "__main__":
    atlas("vanish", 4, 4, merge=1)
    atlas("wisp", 4, 2)
    sys.exit(0)
