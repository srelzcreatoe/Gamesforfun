"""Block-built remakes of four original brainrots that used to be
auto-voxelised: Tung Tung Tung Sahur, Lirili Larila, Tim Cheese and
Brr Brr Patapim. Same characters, rebuilt as clean, crisp voxel art."""

import math

import numpy as np

from blocky import design, shade

WHITE = "#ffffff"
BLACK = "#141417"


# -- helpers ------------------------------------------------------------------


def rounded_box_mask(m, x0, y0, z0, x1, y1, z1, radius):
    """A box (bounds included) with its edges rounded off by `radius`."""
    xs, ys, zs = m._centres
    cx = xs.clip(x0 + radius, x1 + 1 - radius)
    cy = ys.clip(y0 + radius, y1 + 1 - radius)
    cz = zs.clip(z0 + radius, z1 + 1 - radius)
    inside = (xs >= x0) & (xs <= x1 + 1) & (ys >= y0) & (ys <= y1 + 1) & (zs >= z0) & (zs <= z1 + 1)
    return inside & ((xs - cx) ** 2 + (ys - cy) ** 2 + (zs - cz) ** 2 <= radius**2)


def tube(m, points, radii):
    """A chain of tapered capsules through `points`. Returns (mask, s) where s
    is the distance along the chain of each voxel's closest point."""
    xs, ys, zs = m._centres
    p = np.stack([xs, ys, zs], axis=-1)
    best = np.full(xs.shape, np.inf)
    along = np.zeros(xs.shape)
    total = 0.0
    for i in range(len(points) - 1):
        a, b = np.array(points[i], float), np.array(points[i + 1], float)
        ra, rb = radii[i], radii[i + 1]
        ab = b - a
        length = float(np.linalg.norm(ab))
        t = np.clip(((p - a) @ ab) / max(1e-9, length * length), 0, 1)
        d = np.linalg.norm(p - (a + t[..., None] * ab), axis=-1)
        score = d - (ra + (rb - ra) * t)
        better = score < best
        best = np.where(better, score, best)
        along = np.where(better, total + t * length, along)
        total += length
    return best <= 0, along


def column_mask(m, cx, cz, rx, rz, y0, y1, power=2.6):
    """An upright column (bounds included in y) with a rounded-square
    (superellipse) cross-section: power 2 is round, higher is squarer."""
    xs, ys, zs = m._centres
    ring = np.abs((xs - cx) / rx) ** power + np.abs((zs - cz) / rz) ** power <= 1
    return ring & (ys >= y0) & (ys <= y1 + 1)


def hash01(m, seed, x=None, y=None, z=None):
    """A fixed pseudo-random value 0..1 per voxel (or per column/segment when
    x, y or z are given as coarser index grids)."""
    ix, iy, iz = np.indices(m.grid.shape).astype(np.int64)
    ix = ix if x is None else x.astype(np.int64)
    iy = iy if y is None else y.astype(np.int64)
    iz = iz if z is None else z.astype(np.int64)
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def exposed(m, mask=None, sides=False):
    """Filled voxels with an empty neighbour (with sides=True, only an empty
    neighbour to the left, right, front or back)."""
    filled = m.grid > 0
    p = np.pad(filled, 1, constant_values=False)
    around = [p[2:, 1:-1, 1:-1], p[:-2, 1:-1, 1:-1], p[1:-1, 1:-1, 2:], p[1:-1, 1:-1, :-2]]
    if not sides:
        around += [p[1:-1, 2:, 1:-1], p[1:-1, :-2, 1:-1]]
    result = filled & ~np.logical_and.reduce(around)
    return result if mask is None else result & mask


def bark(m, mask, dark, light, seed, dark_share=0.3, light_share=0.12, run=5):
    """Vertical bark streaks: whole columns of the surface turn darker or
    lighter in runs of `run` blocks, like a Minecraft log."""
    ix, iy, iz = np.indices(m.grid.shape)
    column = hash01(m, seed, y=np.zeros_like(iy))
    stretch = hash01(m, seed + 5, y=iy // run)
    side = exposed(m, mask, sides=True)
    m.paint(side & (column < dark_share) & (stretch < 0.7), dark)
    m.paint(side & (column > 1 - light_share) & (stretch < 0.6), light)


def sprout(m, mask, colour, density, seed, gap=2, avoid=None, length=1):
    """Single blocks sticking straight out of the surface of `mask` (cactus
    spines, leaves), each in the same piece as the block it grows from."""
    surf = exposed(m, mask)
    if avoid is not None:
        surf &= ~avoid
    chosen = np.argwhere(surf & (hash01(m, seed) < density))
    centre = np.argwhere(mask & (m.grid > 0)).mean(axis=0)
    index = m.colour(colour)
    placed = []
    for x, y, z in chosen:
        if any(abs(x - a) <= gap and abs(y - b) <= gap and abs(z - c) <= gap for a, b, c in placed):
            continue
        best, score = None, -1e9
        for d in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0)):
            tx, ty, tz = x + d[0], y + d[1], z + d[2]
            if not (0 <= tx < m.width and 0 <= ty < m.height and 0 <= tz < m.depth) or m.grid[tx, ty, tz]:
                continue
            s = d[0] * (x - centre[0]) + d[1] * (y - centre[1]) * 0.5 + d[2] * (z - centre[2])
            if s > score:
                best, score = d, s
        if best is None:
            continue
        for step in range(1, length + 1):
            tx, ty, tz = x + best[0] * step, y + best[1] * step, z + best[2] * step
            if not (0 <= tx < m.width and 0 <= ty < m.height and 0 <= tz < m.depth) or m.grid[tx, ty, tz]:
                break
            m.grid[tx, ty, tz] = index
            m.part[tx, ty, tz] = m.part[x, y, z]
        placed.append((x, y, z))


# -- Tung Tung Tung Sahur -------------------------------------------------------


@design("TungTungTungSahur", width=40, height=47, depth=24)
def tung_tung_tung_sahur(m):
    cx, cz = 20, 13
    wood, wood_dark, wood_light = "#a8662f", "#7b4520", "#c47f40"
    ring, ring_line, ring_core = "#e8c38a", "#c99a5c", "#9c6a36"
    brow, mouth = "#3a2112", "#3f2414"
    bat, bat_dark, bat_light = "#c98e50", "#8e5a2b", "#e0aa6c"
    xs, ys, zs = m._centres

    # Short, sturdy legs with blocky feet.
    for x0, phase in ((14, 0), (22, 1)):
        leg = m.limb("Leg", pivot=(x0 + 2, 11, cz), phase=phase)
        m.box(x0, 3, 11, x0 + 3, 10, 14, wood, part=leg)
        m.box(x0, 0, 8, x0 + 3, 2, 14, wood_dark, part=leg)
        m.box(x0, 2, 8, x0 + 3, 2, 10, wood, part=leg)

    # The log: a chunky upright column of bark.
    log = column_mask(m, cx, cz, 8.2, 8.2, 11, 46)
    m.mask(log, wood)
    bark(m, log & (ys < 46), wood_dark, wood_light, seed=3)
    # Cut end on top: pale wood with growth rings and a bark rim.
    r = (np.abs(xs - cx) ** 2.6 + np.abs(zs - cz) ** 2.6) ** (1 / 2.6)
    top = log & (ys > 46)
    m.paint(top, ring)
    m.paint(top & (r > 6.9), wood_dark)
    m.paint(top & (r > 4.4) & (r <= 5.4), ring_line)
    m.paint(top & (r > 2.0) & (r <= 3.0), ring_line)
    m.paint(top & (r <= 1.0), ring_core)

    # The big cartoon face: bushy brows, huge round eyes with small pupils,
    # a little nose and a smile.
    face_area = m.box_mask(12, 29, 0, 27, 45, cz)
    m.paint_face(face_area, wood, face="front")
    face = [
        "..bbbb....bbbb..",
        ".bbbbb....bbbbb.",
        "................",
        "..wwww....wwww..",
        ".wwwwww..wwwwww.",
        ".wwwwww..wwwwww.",
        ".wwwkkw..wkkwww.",
        ".wwwkkw..wkkwww.",
        ".wwwwww..wwwwww.",
        "..wwww....wwww..",
        "................",
        "................",
        "...m........m...",
        "....mmmmmmmm....",
    ]
    m.pixels(12, 31, face, {"b": brow, "w": WHITE, "k": BLACK, "m": mouth})
    m.box(19, 33, 3, 20, 34, 4, wood_light)
    m.box(19, 33, 3, 20, 33, 4, wood)

    # Thin arms; the right hand holds a wooden baseball bat up at the ready.
    for x0, phase in ((9, 0), (28, 1)):
        arm = m.limb("Arm", pivot=(x0 + 1.5, 33, cz + 0.5), phase=phase)
        m.box(x0, 20, 12, x0 + 2, 33, 14, wood, part=arm)
        m.box(x0, 33, 12, x0 + 2, 33, 14, wood_dark, part=arm)
        fist_x = x0 - 1 if x0 < cx else x0
        m.box(fist_x, 16, 11, fist_x + 3, 19, 14, wood_light, part=arm)
        if x0 < cx:
            club, s = tube(m, [(10, 14.5, 13.5), (9.8, 18, 12.6), (4.2, 37, 2.6)], [1.2, 1.0, 2.3])
            club &= ~m.box_mask(fist_x, 16, 11, fist_x + 3, 19, 14)
            m.mask(club, bat, part=arm)
            m.paint(club & (s < 1.6), bat_dark)
            m.paint(club & (s > 5) & (s < 6.2), bat_dark)
            m.paint(club & m.surface("left"), bat_light)
