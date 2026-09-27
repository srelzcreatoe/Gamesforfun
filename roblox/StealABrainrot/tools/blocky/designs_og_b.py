"""Block-built brainrots, batch og_b: fruit-and-food animals from the original
Steal a Brainrot. Salamino Penguino, Tukanno Bananno, Tigrilini Watermelini,
Burbaloni Loliloli, Lionel Cactuseli, Glorbo Fruttodrillo, Blueberrini
Octopusini, Strawberelli Flamingelli and Pandaccini Bananini."""

import math

import numpy as np

from blocky import design

BLACK = "#16161c"
WHITE = "#ffffff"


# -- helpers -----------------------------------------------------------------


def _shift(filled, axis, step):
    """filled shifted so each voxel sees its neighbour at +step along axis
    (outside the grid counts as empty)."""
    pad = np.pad(filled, 1, constant_values=False)
    return np.roll(pad, -step, axis=axis)[1:-1, 1:-1, 1:-1]


def exposed(m, mask=None):
    """Filled voxels with at least one empty face neighbour."""
    filled = m.grid > 0
    open_side = np.zeros_like(filled)
    for axis in range(3):
        for step in (1, -1):
            open_side |= ~_shift(filled, axis, step)
    result = filled & open_side
    return result if mask is None else result & mask


def facing(m, direction, mask=None):
    """Filled voxels whose neighbour towards direction ("+x", "-y", ...) is empty."""
    axis = "xyz".index(direction[1])
    step = 1 if direction[0] == "+" else -1
    filled = m.grid > 0
    result = filled & ~_shift(filled, axis, step)
    return result if mask is None else result & mask


def coloured(m, colour):
    return m.grid == m.colour(colour)


def scatter(m, mask, colour, spacing, seed, chance=1.0):
    """Paints well spaced dots (seeds, speckles) on the voxels of a mask."""
    rng = np.random.default_rng(seed)
    points = np.argwhere(mask)
    rng.shuffle(points)
    kept = []
    for p in points:
        if rng.random() > chance:
            continue
        if kept and np.abs(np.asarray(kept) - p).max(axis=1).min() < spacing:
            continue
        kept.append(p)
    dots = np.zeros(m.grid.shape, dtype=bool)
    for x, y, z in kept:
        dots[x, y, z] = True
    m.paint(dots, colour)
    return dots


def speckle(m, mask, colour, chance, seed):
    rng = np.random.default_rng(seed)
    dots = mask & (rng.random(m.grid.shape) < chance)
    m.paint(dots, colour)
    return dots


def tube_mask(m, points, radius, radius2=None):
    """Union of spheres swept along a polyline; the radius goes from radius
    to radius2, or radius can be a function of the fraction along (0..1)."""
    pts = np.asarray(points, dtype=float)
    lengths = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    total = float(lengths.sum())
    cum = np.concatenate([[0.0], np.cumsum(lengths)])
    if callable(radius):
        rad = radius
    else:
        r2 = radius if radius2 is None else radius2
        rad = lambda t: radius + (r2 - radius) * t  # noqa: E731
    xs, ys, zs = m._centres
    mask = np.zeros(m.grid.shape, dtype=bool)
    steps = max(2, int(math.ceil(total / 0.3)) + 1)
    for s in np.linspace(0.0, total, steps):
        k = min(int(np.searchsorted(cum, s, side="right")) - 1, len(lengths) - 1)
        t = 0.0 if lengths[k] == 0 else (s - cum[k]) / lengths[k]
        p = pts[k] + (pts[k + 1] - pts[k]) * t
        r = rad(s / total if total else 0.0)
        mask |= (xs - p[0]) ** 2 + (ys - p[1]) ** 2 + (zs - p[2]) ** 2 <= r * r
    return mask


def tube(m, points, radius, radius2=None, colour=WHITE, part=0):
    return m.mask(tube_mask(m, points, radius, radius2), colour, part)


def bezier(p0, p1, p2, p3, n=24):
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t**2, t**3
        out.append(tuple(a * p0[j] + b * p1[j] + c * p2[j] + d * p3[j] for j in range(3)))
    return out


def flip_x(m, mask):
    """The mask mirrored left to right (for the matching limb on the other side)."""
    return mask[::-1, :, :]


def rounded_box(m, x0, y0, z0, x1, y1, z1, colour, part=0):
    """A box with its twelve edges bevelled off, for a chunky rounded block."""
    mask = m.box_mask(x0, y0, z0, x1, y1, z1)
    xs, ys, zs = m._centres
    ex = (xs < x0 + 1) | (xs > x1)
    ey = (ys < y0 + 1) | (ys > y1)
    ez = (zs < z0 + 1) | (zs > z1)
    edge = (ex & ey) | (ey & ez) | (ex & ez)
    return m.mask(mask & ~edge, colour, part)


def adopt_orphans(m):
    """Body voxels cut off from the main body (say, walled in by a head) would
    hang in the air when that piece moves, so they join the piece they touch."""
    body = (m.grid > 0) & (m.part == 0)
    points = np.argwhere(body)
    if len(points) == 0:
        return
    centre = points.mean(axis=0)
    seed = points[np.argmin(np.linalg.norm(points - centre, axis=1))]
    reached = np.zeros_like(body)
    reached[tuple(seed)] = True
    while True:
        grown = reached.copy()
        for axis in range(3):
            for step in (1, -1):
                grown |= _shift(reached, axis, step)
        grown &= body
        if (grown == reached).all():
            break
        reached = grown
    orphans = body & ~reached
    for _ in range(4):
        if not orphans.any():
            break
        for x, y, z in np.argwhere(orphans):
            for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
                q = (x + dx, y + dy, z + dz)
                if 0 <= q[0] < m.width and 0 <= q[1] < m.height and 0 <= q[2] < m.depth:
                    if m.grid[q] > 0 and m.part[q] > 0:
                        m.part[x, y, z] = m.part[q]
                        orphans[x, y, z] = False
                        break


def erode_xy(mask):
    """Shrinks a mask by one voxel in x and y (within each z layer)."""
    out = mask.copy()
    for axis in (0, 1):
        for step in (1, -1):
            out &= _shift(mask, axis, step)
    return out


# -- Salamino Penguino --------------------------------------------------------


@design("SalaminoPenguino", width=28, height=40, depth=22)
def salamino_penguino(m):
    casing, casing_dark, casing_light = "#a31e2e", "#6c101c", "#c63a48"
    fat = "#f7e6de"
    meat, meat_rim, meat_red = "#f6a9ad", "#e57f88", "#cf4757"
    beak, beak_dark, beak_light = "#ff9d1c", "#dc6c14", "#ffc15a"
    twine, twine_dark = "#e6d3a3", "#bfa672"

    # A salami standing on end: a fat log of red casing, a little wider at
    # the bottom like a penguin, rounded at both ends.
    xs, ys, zs = m._centres
    y = ys
    radius = 9.3 - (np.clip(y, 10, 27) - 10) / 17 * 1.3
    radius = np.where(y < 10, radius * np.sqrt(np.clip(1 - ((10 - y) / 6.2) ** 2, 0, 1)), radius)
    radius = np.where(y > 27, radius * np.sqrt(np.clip(1 - ((y - 27) / 8.6) ** 2, 0, 1)), radius)
    body = ((xs - 14) ** 2 + ((zs - 11.5) / 0.92) ** 2 <= radius**2) & (y > 3.8)
    m.mask(body, casing)
    skin = exposed(m, body)
    m.paint(skin & m.box_mask(0, 0, 0, 27, 8, 21), casing_dark)
    m.paint(skin & m.ellipsoid_mask(8.5, 25, 7, 3.5, 7, 4), casing_light)
    speckle(m, skin, casing_dark, 0.08, 1)
    scatter(m, skin, fat, 3, 2, chance=0.35)

    # The belly is the sliced end: a flat pale-pink cut of salami with fat
    # and a darker rim just inside the casing.
    m.clear(m.box_mask(0, 0, 0, 27, 23, 4) & body)
    cut = facing(m, "-z", m.box_mask(0, 0, 5, 27, 23, 5))
    inner = erode_xy(cut)
    m.paint(inner, meat_rim)
    core = erode_xy(inner)
    m.paint(core, meat)
    scatter(m, core, meat_red, 2, 3, chance=0.45)
    scatter(m, core & coloured(m, meat), fat, 3, 4)

    # Face: big white eyes and an orange beak.
    eye_l = [".www.", "wwhkw", "wwkkw", "wwkkw", ".www."]
    eye_r = [".www.", "whkww", "wkkww", "wkkww", ".www."]
    eyes = {"w": WHITE, "k": BLACK, "h": "#bfe4ff"}
    m.pixels(8, 27, eye_l, eyes)
    m.pixels(15, 27, eye_r, eyes)
    m.box(12, 24, 0, 15, 26, 4, beak)
    m.box(12, 24, 0, 12, 26, 0, beak_dark)
    m.clear(m.box_mask(12, 24, 0, 12, 26, 0) | m.box_mask(15, 24, 0, 15, 26, 0))
    m.box(12, 24, 1, 15, 24, 4, beak_dark)
    m.box(13, 24, 0, 14, 24, 0, beak_dark)
    m.box(12, 26, 1, 15, 26, 3, beak_light)

    # The tied end of the salami on top, with a twine loop.
    m.box(13, 34, 11, 14, 35, 12, casing_dark)
    m.box(12, 35, 10, 15, 35, 13, twine)
    m.box(12, 36, 11, 12, 38, 11, twine_dark)
    m.box(15, 36, 11, 15, 38, 11, twine_dark)
    m.box(12, 39, 11, 15, 39, 11, twine_dark)

    # Flipper arms: flat slabs of salami angled out from the shoulders.
    flipper = np.zeros(m.grid.shape, dtype=bool)
    for yy in range(11, 25):
        t = (yy - 11) / 13
        x0 = int(round(0.6 + 4.4 * t))
        z0, z1 = int(round(10 - 2 * t)), int(round(13 + 2 * t))
        if yy == 11:
            z0, z1 = z0 + 1, z1 - 1
        flipper |= m.box_mask(x0, yy, z0, x0 + 1, yy, z1)
    for side, (mask, pivot_x) in enumerate(((flipper, 6), (flip_x(m, flipper), 22))):
        arm = m.limb("Arm", pivot=(pivot_x, 24, 11.5), phase=side)
        m.mask(mask, casing, part=arm)
        m.paint(mask & m.box_mask(0, 11, 0, 27, 13, 21), casing_dark)
        scatter(m, mask & m.box_mask(0, 14, 0, 27, 22, 21), fat, 3, 10 + side)

    # Short orange legs and big flat feet.
    for side, x in enumerate((8, 15)):
        leg = m.limb("Leg", pivot=(x + 2.5, 6.5, 10.5), phase=side)
        m.box(x + 1, 2, 9, x + 3, 6, 12, beak_dark, part=leg)
        m.box(x, 0, 3, x + 4, 1, 12, beak, part=leg)
        m.box(x, 0, 3, x + 4, 0, 12, beak_dark, part=leg)
        m.box(x + 1, 1, 3, x + 1, 1, 6, beak_dark, part=leg)
        m.box(x + 3, 1, 3, x + 3, 1, 6, beak_dark, part=leg)
    adopt_orphans(m)


# -- Tukanno Bananno ----------------------------------------------------------


@design("TukannoBananno", width=26, height=38, depth=38)
def tukanno_bananno(m):
    black, black_dark, black_light = "#1e1e26", "#0e0e13", "#3a3a4c"
    sheen = "#2c3656"
    chest, chest_shade = "#fbf6e6", "#e4d9bb"
    red = "#e53935"
    banana, banana_light, banana_dark = "#ffd93a", "#fff08c", "#e7b21c"
    brown, brown_dark = "#7a521e", "#3f2a0e"
    stalk = "#6e6a26"
    ring, ring_dark = "#2f8fea", "#1c62b8"
    foot, foot_dark = "#7e9cc0", "#5a769a"

    # Body: an upright black egg with a white bib and red under the tail.
    body = m.ellipsoid(13, 15.5, 24, 7.5, 10, 7, black)
    m.paint(exposed(m, body) & m.box_mask(0, 0, 0, 25, 8, 37), black_dark)
    m.paint_face(m.ellipsoid_mask(13, 19, 17, 5.5, 6.5, 99) & body, chest, "front")
    m.paint_face(m.ellipsoid_mask(13, 14, 17, 4, 1.5, 99) & body, chest_shade, "front")
    m.paint_face(m.ellipsoid_mask(13, 7, 17, 4, 2.5, 99) & body, red, "front")

    # Short blue-grey legs with long toes.
    for side, x in enumerate((8, 14)):
        leg = m.limb("Leg", pivot=(x + 2, 6.5, 23.5), phase=side)
        m.box(x + 1, 2, 23, x + 2, 6, 24, foot, part=leg)
        m.box(x, 0, 20, x + 3, 1, 25, foot, part=leg)
        m.box(x, 0, 20, x + 3, 0, 25, foot_dark, part=leg)
        m.box(x + 1, 1, 20, x + 2, 1, 20, foot_dark, part=leg)

    # Wings folded at the sides, dark blue sheen on the feather tips.
    wing = np.zeros(m.grid.shape, dtype=bool)
    for y in range(7, 22):
        t = (21 - y) / 14
        z0, z1 = int(round(18 + 9 * t)), int(round(29 + 3 * t))
        wing |= m.box_mask(4, y, z0, 5, y, z1)
    for side, (mask, px) in enumerate(((wing, 5.5), (flip_x(m, wing), 20.5))):
        w = m.limb("Wing", pivot=(px, 21, 24), phase=side)
        m.mask(mask, black, part=w)
        m.paint(mask & m.box_mask(0, 7, 0, 25, 11, 37), sheen)
        for y in (13, 16):
            m.paint(mask & m.box_mask(0, y, 0, 25, y, 37), black_light)

    # A long square tail hanging down behind.
    tail = m.limb("Tail", pivot=(13, 10.5, 29.5))
    m.box(10, 7, 29, 15, 11, 32, black, part=tail)
    m.box(10, 4, 32, 15, 8, 34, black, part=tail)
    m.box(10, 2, 34, 15, 5, 36, black, part=tail)
    m.box(11, 2, 37, 14, 3, 37, black, part=tail)
    m.box(10, 2, 34, 15, 3, 37, sheen, part=tail)
    # The toucan's white rump patch at the base of the tail.
    m.paint(facing(m, "+y") & m.box_mask(10, 10, 28, 15, 12, 31), chest)
    m.paint(facing(m, "+z") & m.box_mask(10, 11, 28, 15, 13, 31), chest)

    # The head nods: black with a white throat and blue eye rings.
    head = m.limb("Head", pivot=(13, 24, 22))
    hm = m.ellipsoid(13, 28.5, 22, 7.5, 6.5, 6.5, black, part=head)
    m.paint(exposed(m, hm) & m.ellipsoid_mask(10, 32, 19, 4, 3, 4), black_light)
    m.paint_face(m.ellipsoid_mask(13, 23.5, 16, 7, 3.2, 99) & hm, chest, "front")
    eye_l = [".rr.", "rhkr", "rkkR", ".RR."]
    eye_r = [".rr.", "rhkr", "Rkkr", ".RR."]
    eyes = {"r": ring, "R": ring_dark, "k": BLACK, "h": WHITE}
    m.pixels(5, 28, eye_l, eyes)
    m.pixels(17, 28, eye_r, eyes)

    # The beak is a big curved banana: a brown stalk end plugged into the
    # face, yellow with a lighter top and darker ridges, a brown tip.
    path = bezier((13, 29, 18), (13, 32.5, 8), (13, 29, 2), (13, 22.5, 1.3), 32)

    def banana_radius(t):
        grow = min(1.0, t / 0.22)
        return 1.9 + 1.6 * math.sin(grow * math.pi / 2) - 1.9 * max(0.0, (t - 0.35) / 0.65) ** 1.3

    beak = tube_mask(m, path, banana_radius) & ~hm
    m.mask(beak, banana, part=head)
    m.paint(facing(m, "+y", beak), banana_light)
    m.paint(facing(m, "-y", beak), banana_dark)
    m.paint(beak & (facing(m, "+x") | facing(m, "-x")) & m.box_mask(9, 0, 0, 10, 37, 37), banana_dark)
    m.paint(beak & (facing(m, "+x") | facing(m, "-x")) & m.box_mask(16, 0, 0, 17, 37, 37), banana_dark)
    m.paint(beak & m.box_mask(0, 0, 14, 25, 37, 37), stalk)
    m.paint(beak & m.box_mask(0, 0, 13, 25, 37, 13), brown)
    tip = m.ellipsoid_mask(13, 22.5, 1.3, 2.2, 2.4, 2.2)
    m.paint(beak & tip, brown_dark)
    scatter(m, facing(m, "+y", beak) & m.box_mask(0, 0, 4, 25, 37, 11), brown, 4, 7)
    adopt_orphans(m)


# -- Tigrilini Watermelini ----------------------------------------------------


@design("TigriliniWatermelini", width=28, height=34, depth=42)
def tigrilini_watermelini(m):
    rind_dark, rind_mid, rind_light = "#1d6a28", "#3f9a35", "#7cc74e"
    pith = "#eaf8cf"
    flesh, flesh_dark, flesh_light = "#ef3a4e", "#c72438", "#ff6b7a"
    seed = "#1c1414"
    orange, orange_dark, orange_light = "#f58a2a", "#cf641a", "#ffb35c"
    stripe = "#1b1b1f"
    cream, cream_shade = "#fff6e8", "#ecdcc4"
    pink = "#f5889e"

    # The body is a whole watermelon lying lengthwise: red inside, a pale
    # layer of pith, then a rind of jagged dark and light green stripes.
    cx, cy, cz = 14, 15.5, 24
    rx, ry, rz = 10.5, 9.5, 15
    melon = m.ellipsoid_mask(cx, cy, cz, rx, ry, rz)
    m.mask(melon, flesh)
    rind = melon & ~m.ellipsoid_mask(cx, cy, cz, rx - 1.2, ry - 1.2, rz - 1.2)
    pith_layer = melon & ~rind & ~m.ellipsoid_mask(cx, cy, cz, rx - 2.2, ry - 2.2, rz - 2.2)
    m.paint(pith_layer, pith)
    xs, ys, zs = m._centres
    angle = np.arctan2(ys - cy, xs - cx)
    wave = np.sin(angle * 6 + np.sin(zs * 0.7) * 0.45 + np.sign(np.sin(zs * 1.9)) * 0.18)
    m.paint(rind, rind_light)
    m.paint(rind & (wave > 0.05), rind_dark)
    speckle(m, exposed(m, rind) & coloured(m, rind_light), rind_mid, 0.15, 20)

    # Cut open: the back end sliced flat and a long wedge taken out of the
    # top of the right side, showing the red flesh and seeds.
    m.clear(melon & m.box_mask(0, 0, 35, 27, 33, 41))
    m.clear(melon & (angle > -0.2) & (angle < 1.05) & (zs > 17) & (zs < 28))
    flesh_open = exposed(m, coloured(m, flesh))
    speckle(m, flesh_open, flesh_light, 0.18, 21)
    speckle(m, flesh_open & coloured(m, flesh), flesh_dark, 0.12, 22)
    scatter(m, flesh_open, seed, 3, 23)

    # Four striped tiger legs with white paws.
    legs = [((7, 14), 0), ((17, 14), 1), ((7, 29), 1), ((17, 29), 0)]
    for (x, z), phase in legs:
        leg = m.limb("Leg", pivot=(x + 2, 11.5, z + 2), phase=phase)
        lm = m.box(x, 2, z, x + 3, 11, z + 3, orange, part=leg)
        m.box(x, 0, z - 1, x + 3, 1, z + 3, cream, part=leg)
        m.box(x, 0, z - 1, x + 3, 0, z + 3, cream_shade, part=leg)
        for y in (4, 7):
            m.paint(exposed(m, lm) & m.box_mask(0, y, 0, 27, y, 41), stripe)
        m.paint(lm & m.box_mask(x + 1, 1, z - 1, x + 2, 1, z - 1), cream_shade)

    # A striped tail curling up out of the cut end.
    tail = m.limb("Tail", pivot=(14, 16, 34.5))
    tm = tube(m, bezier((14, 16, 33), (14, 17, 39.5), (14, 24, 41), (14, 29.5, 39), 24), 1.5, 1.2, orange, part=tail)
    m.paint(tm & (((ys + zs).astype(int) % 4) == 0), stripe)
    m.paint(tm & (ys > 28), stripe)

    # The tiger head, nodding at the front.
    head = m.limb("Head", pivot=(14, 18, 11))
    hm = m.ellipsoid(14, 21, 8, 7.5, 7, 6.5, orange, part=head)
    for x0, x1 in ((7, 9), (18, 20)):
        m.box(x0, 26, 6, x1, 29, 8, orange, part=head)
        m.box(x0, 28, 6, x1, 29, 8, stripe, part=head)
    m.pixels(7, 26, [".p.", "ppp"], {"p": pink})
    m.pixels(18, 26, [".p.", "ppp"], {"p": pink})
    m.paint(exposed(m, hm) & m.box_mask(0, 14, 0, 27, 16, 41), orange_dark)
    m.paint(exposed(m, hm) & m.ellipsoid_mask(11, 26, 4, 3, 2, 3), orange_light)
    # Black forehead and cheek stripes.
    m.pixels(9, 25, ["k...kk...k", "kk..kk..kk", "....kk...."], {"k": stripe})
    for y in (19, 22):
        m.paint(hm & exposed(m) & m.box_mask(0, y, 3, 7, y, 12), stripe)
        m.paint(hm & exposed(m) & m.box_mask(20, y, 3, 27, y, 12), stripe)
    # White brows and eyes with a highlight.
    m.pixels(10, 21, ["www..www", "hkk..hkk", "kkk..kkk", "kkk..kkk"],
             {"w": cream, "k": BLACK, "h": WHITE})
    # White muzzle with a pink nose and a little mouth.
    m.box(10, 14, 0, 17, 18, 2, cream, part=head)
    m.box(10, 14, 0, 17, 14, 2, cream_shade, part=head)
    m.pixels(10, 14, ["..pppp..", "...pp...", "...kk...", "..k..k..", "........"],
             {"p": pink, "k": stripe})
    m.pixels(10, 16, ["k......k"], {"k": orange_dark})
    adopt_orphans(m)


# -- Burbaloni Loliloli -------------------------------------------------------


@design("BurbaloniLoliloli", width=34, height=36, depth=30)
def burbaloni_loliloli(m):
    husk, husk_dark, husk_light = "#724524", "#4c2c14", "#9a6637"
    meat, meat_shade = "#fbf8ee", "#e6ddc6"
    fur, fur_dark, fur_light = "#a8743f", "#7c5129", "#c9975c"
    nose, nose_dark = "#4a3020", "#24160c"
    straw_a, straw_b = "#ff4f7b", "#ffffff"
    canopy_a, canopy_b, canopy_rim = "#ff6fae", "#ffd23c", "#e24a8a"
    stick = "#e8d1a0"

    # Half a coconut as a boat: hairy brown husk, white flesh inside and on the rim.
    cx, cz = 17, 15
    bowl = m.ellipsoid_mask(cx, 12.5, cz, 13.5, 12.5, 13.5) & m.box_mask(0, 0, 0, 33, 12, 29)
    hollow = m.ellipsoid_mask(cx, 12.5, cz, 11.5, 10.5, 11.5)
    m.mask(bowl, husk)
    m.clear(bowl & hollow)
    m.paint(bowl & m.ellipsoid_mask(cx, 12.5, cz, 12.6, 11.6, 12.6), meat)
    m.paint(bowl & m.box_mask(0, 12, 0, 33, 12, 29) & m.ellipsoid_mask(cx, 12.5, cz, 12.9, 99, 12.9), meat)
    m.paint(bowl & m.box_mask(0, 12, 0, 33, 12, 29) & m.ellipsoid_mask(cx, 12.5, cz, 11.9, 99, 11.9), meat_shade)
    outside = exposed(m, bowl) & coloured(m, husk)
    speckle(m, outside, husk_dark, 0.3, 31)
    speckle(m, outside & coloured(m, husk), husk_light, 0.18, 32)
    # Hairy tufts sticking out of the husk.
    rng = np.random.default_rng(33)
    for x, y, z in np.argwhere(outside & m.box_mask(0, 1, 0, 33, 10, 29)):
        if rng.random() > 0.07:
            continue
        n = np.array([x + 0.5 - cx, y + 0.5 - 12.5, z + 0.5 - cz])
        a = int(np.argmax(np.abs(n)))
        q = [x, y, z]
        q[a] += 1 if n[a] > 0 else -1
        if 0 <= q[0] < m.width and 1 <= q[1] < m.height and 0 <= q[2] < m.depth and m.grid[tuple(q)] == 0:
            m.voxel(*q, husk_light if rng.random() < 0.5 else husk_dark)

    # A cocktail umbrella stuck in the rim at the front left.
    xs, ys, zs = m._centres
    ux, uz = 5, 9
    m.box(ux, 9, uz, ux, 30, uz, stick)
    cone = m.cylinder_mask(ux + 0.5, 29.5, uz + 0.5, 4.9, 3.2, "Y", radius2=0.7)
    m.mask(cone, canopy_a)
    sector = ((np.arctan2(zs - uz - 0.5, xs - ux - 0.5) + math.pi) / (2 * math.pi) * 8).astype(int) % 2 == 0
    m.paint(cone & sector, canopy_b)
    m.paint(cone & ~m.cylinder_mask(ux + 0.5, 29.5, uz + 0.5, 3.9, 3.2, "Y", radius2=0.0), canopy_rim)
    m.box(ux, 32, uz, ux, 33, uz, stick)

    # A striped straw poking out of the drink at the back right.
    straw = tube(m, [(27, 9.5, 21), (28.5, 27, 22), (26, 30.5, 22)], 1.05, 1.05, straw_a)
    m.paint(straw & ((ys.astype(int) // 2) % 2 == 0), straw_b)

    # The capybara lounging in it: a round brown body, paws over the rim.
    body = m.ellipsoid(cx, 14.5, 16, 9.5, 7.5, 9, fur)
    speckle(m, exposed(m, body), fur_dark, 0.12, 34)
    speckle(m, exposed(m, body) & coloured(m, fur), fur_light, 0.08, 35)
    for x in (10, 21):
        m.box(x, 13, 1, x + 2, 14, 8, fur)
        m.box(x, 11, 1, x + 2, 12, 2, fur)
        m.box(x, 11, 1, x + 2, 11, 1, fur_dark)
        m.box(x + 1, 11, 1, x + 1, 12, 1, fur_dark)

    # The big blocky capybara head, sleepy and relaxed.
    head = m.limb("Head", pivot=(cx, 20, 12))
    hm = rounded_box(m, 10, 19, 5, 23, 30, 16, fur, part=head)
    speckle(m, exposed(m, hm), fur_dark, 0.1, 36)
    m.paint(facing(m, "+y", hm), fur_dark)
    speckle(m, facing(m, "+y", hm), fur, 0.3, 37)
    for x in (10, 22):
        m.box(x, 30, 12, x + 1, 32, 14, fur_dark, part=head)
        m.box(x, 31, 12, x + 1, 31, 12, nose, part=head)
    # Half-closed eyes with a heavy lid.
    lids = {"d": fur_dark, "k": BLACK, "w": WHITE}
    m.pixels(11, 26, ["dddd", "kwkk", ".kk."], lids)
    m.pixels(19, 26, ["dddd", "kkwk", ".kk."], lids)
    # The wide square snout with a big dark nose on top.
    snout = rounded_box(m, 11, 18, 1, 22, 25, 7, fur_light, part=head)
    m.paint(facing(m, "-y", snout), fur)
    m.pixels(11, 19, ["...dddddd...", "..dddddddd..", "..ddkddkdd..", "...dddddd...", ".....dd.....",
                      "....d..d...."], {"d": nose, "k": nose_dark})
    m.paint(facing(m, "+y", snout) & m.box_mask(13, 25, 1, 20, 25, 3), nose)
    adopt_orphans(m)


# -- Lionel Cactuseli ---------------------------------------------------------


@design("LionelCactuseli", width=30, height=38, depth=40)
def lionel_cactuseli(m):
    green, green_dark, green_light = "#3f9d3c", "#276f2a", "#74cb5c"
    spine = "#fff6c8"
    pink, pink_light, pink_dark = "#ff5fa2", "#ffa6cd", "#d93a7e"
    yellow, yellow_light, yellow_dark = "#ffd23a", "#fff08a", "#eda51c"
    heart = "#ff8a1a"
    nose = "#3c2a1c"
    xs, ys, zs = m._centres

    def ribs(mask, angle, count, seed):
        """Cactus ribs: dark grooves, light ridges, cream spines on the ridges."""
        surface = exposed(m, mask)
        wave = np.cos(angle * count)
        m.paint(surface & (wave < -0.45), green_dark)
        m.paint(surface & (wave > 0.7), green_light)
        scatter(m, surface & (wave > 0.7), spine, 3, seed, chance=0.6)

    # The body is a fat cactus log, ribbed along its length.
    cy = 18
    trunk = m.cylinder_mask(15, cy, 13, 7.5, 18, "Z")
    trunk |= m.ellipsoid_mask(15, cy, 13, 7.5, 7.5, 4) | m.ellipsoid_mask(15, cy, 31, 7.5, 7.5, 4.5)
    m.mask(trunk, green)
    ribs(trunk, np.arctan2(ys - cy, xs - 15), 10, 41)

    # Four cactus legs.
    legs = [((10, 16), 0), ((20, 16), 1), ((10, 30), 1), ((20, 30), 0)]
    for i, ((x, z), phase) in enumerate(legs):
        leg = m.limb("Leg", pivot=(x, 13.5, z), phase=phase)
        lm = m.cylinder(x, 0, z, 2.3, 14, green, part=leg)
        ribs(lm, np.arctan2(zs - z, xs - x), 4, 42 + i)
        m.paint(lm & m.box_mask(0, 0, 0, 29, 1, 39), green_dark)
        m.paint(facing(m, "-z", lm) & m.box_mask(0, 0, 0, 29, 1, 39), spine)

    # A cactus tail with a pink flower on the tip.
    tail = m.limb("Tail", pivot=(15, 20.5, 34.5))
    tm = tube(m, bezier((15, 20, 33), (15, 22, 38.5), (15, 28, 39), (15, 31, 37), 20), 1.5, 1.2, green, part=tail)
    m.paint(exposed(m, tm) & ((zs + ys).astype(int) % 3 == 0), green_dark)
    m.ellipsoid(15, 32.5, 37, 2.2, 1.4, 2.2, pink, part=tail)
    m.box(14, 33, 36, 15, 33, 37, yellow, part=tail)

    # The head and its mane of cactus flowers turn together.
    head = m.limb("Head", pivot=(15, 21, 12))
    flowers = []
    for k in range(14):
        a = k / 14 * 2 * math.pi + math.pi / 14
        flowers.append((15 + 10 * math.cos(a), 24 + 10 * math.sin(a), 9, 3.3, k % 2))
    for k in range(8):
        a = k / 8 * 2 * math.pi
        flowers.append((15 + 6.5 * math.cos(a), 24 + 6.5 * math.sin(a), 12, 2.8, (k + 1) % 2))
    for fx, fy, fz, fr, kind in flowers:
        petal, light, dark = (pink, pink_light, pink_dark) if kind == 0 else (yellow, yellow_light, yellow_dark)
        flower = m.ellipsoid(fx, fy, fz, fr, fr, 2.3, petal, part=head)
        m.paint(exposed(m, flower) & ~m.ellipsoid_mask(fx, fy, fz, fr - 1.1, fr - 1.1, 99), light)
        m.paint(exposed(m, flower) & m.box_mask(0, 0, fz + 1.5, 29, 37, 39), dark)
    for fx, fy, fz, fr, kind in flowers:
        centre = m.ellipsoid_mask(fx, fy, fz, 1.2, 1.2, 99)
        m.paint_face(centre, heart if kind == 0 else pink_dark, "front")
        m.paint_face(centre, heart if kind == 0 else pink_dark, "back")
    face = m.ellipsoid(15, 24, 7, 6.5, 6.5, 5.5, green, part=head)
    ribs(face & m.box_mask(0, 0, 7, 29, 37, 39), np.arctan2(ys - 24, xs - 15), 8, 49)
    m.paint(exposed(m, face) & m.ellipsoid_mask(12, 28, 3, 3, 2, 3), green_light)

    # Lion face: big eyes, proud brows, a light muzzle and a dark nose.
    m.pixels(10, 24, ["ddd....ddd", ".hkk..hkk.", ".kkk..kkk.", ".kkk..kkk."],
             {"d": green_dark, "k": BLACK, "h": WHITE})
    m.box(14, 21, 1, 15, 25, 2, green_light, part=head)
    for px in (13.0, 17.0):
        m.ellipsoid(px, 19.5, 2.4, 2.3, 1.9, 1.6, green_light, part=head)
    m.ellipsoid(15, 17.3, 3, 1.8, 1.0, 1.5, green_light, part=head)
    m.pixels(13, 21, ["nnnn", ".nn."], {"n": nose}, z=0, part=head)
    m.pixels(13, 19, ["k..k"], {"k": green_dark})
    m.pixels(11, 18, ["k......k"], {"k": green_dark})
    for x, y in ((9, 21), (20, 21), (11, 29), (18, 29)):
        m.paint_face(m.box_mask(x, y, 0, x, y, 39), spine, "front")
    adopt_orphans(m)


# -- Glorbo Fruttodrillo ------------------------------------------------------


@design("GlorboFruttodrillo", width=30, height=30, depth=50)
def glorbo_fruttodrillo(m):
    rind_dark, rind_mid, rind_light = "#1b5a22", "#3f8c34", "#8ccc5c"
    stem = "#8b6a2a"
    croc, croc_dark, croc_light = "#4f8f38", "#336624", "#79b04d"
    belly, belly_dark = "#cfe29a", "#b2c97a"
    tooth, mouth = "#ffffff", "#6e1b20"
    iris = "#ffd21f"
    claw = "#f2ecd8"
    xs, ys, zs = m._centres

    # The round body is a whole watermelon, striped from top to bottom.
    cx, cy, cz = 15, 14.5, 25
    melon = m.ellipsoid(cx, cy, cz, 11, 10.5, 11, rind_light)
    wave = np.sin(np.arctan2(zs - cz, xs - cx) * 8 + np.sin(ys * 0.9) * 0.6)
    m.paint(melon & (wave > -0.1), rind_mid)
    m.paint(melon & (wave > 0.25), rind_dark)
    speckle(m, exposed(m, melon) & coloured(m, rind_dark), rind_mid, 0.12, 51)
    m.box(14, 25, 24, 15, 26, 25, stem)
    m.voxel(15, 27, 25, stem)

    # Four short, splayed croc legs with pale claws.
    legs = [((8, 18), 0), ((18, 18), 1), ((8, 29), 1), ((18, 29), 0)]
    for (x, z), phase in legs:
        leg = m.limb("Leg", pivot=(x + 2, 8.5, z + 2), phase=phase)
        out = -2 if x < cx else 2
        lm = m.box(x, 2, z, x + 3, 8, z + 3, croc, part=leg)
        m.box(x + out, 3, z, x + 3 + out, 6, z + 3, croc, part=leg)
        foot = m.box(min(x, x + out), 0, z - 2, max(x + 3, x + 3 + out), 1, z + 3, croc, part=leg)
        m.paint(foot & m.box_mask(0, 0, 0, 29, 0, 49), croc_dark)
        m.paint(exposed(m, lm) & m.box_mask(0, 5, 0, 29, 5, 49), croc_dark)
        for dx in (0, 2, 4):
            m.box(min(x, x + out) + dx, 0, z - 3, min(x, x + out) + dx, 0, z - 3, claw, part=leg)

    # A long croc tail with a ridge of scutes on top.
    tail = m.limb("Tail", pivot=(cx, 12.5, 35.5))
    path = bezier((cx, 13, 34), (cx, 12, 40), (cx, 9.5, 44), (cx, 6.5, 49), 30)
    tm = tube(m, path, 4.3, 1.1, croc, part=tail)
    m.paint(facing(m, "-y", tm), belly)
    m.paint(facing(m, "+y", tm) & ((zs.astype(int) % 3) == 0), croc_dark)
    ridge = facing(m, "+y", tm) & m.box_mask(14, 0, 37, 15, 29, 48) & ((zs.astype(int) % 3) == 1)
    for x, y, z in np.argwhere(ridge):
        m.voxel(x, y + 1, z, croc_dark, part=tail)

    # The croc head: a long snout, pointy white teeth, yellow eyes on top.
    head = m.limb("Head", pivot=(cx, 12.5, 15.5))
    skull = m.ellipsoid(cx, 12.5, 12, 6, 5, 5, croc, part=head)
    m.box(10, 12, 0, 19, 15, 10, croc, part=head)   # upper jaw
    m.box(10, 8, 1, 19, 10, 10, croc, part=head)    # lower jaw
    m.box(10, 11, 1, 19, 11, 10, mouth, part=head)  # the mouth line
    m.clear(m.box_mask(10, 15, 0, 10, 15, 0) | m.box_mask(19, 15, 0, 19, 15, 0))
    m.paint(facing(m, "-y", skull | m.box_mask(10, 8, 1, 19, 10, 10)), belly)
    m.paint(m.box_mask(10, 8, 1, 19, 8, 10) & facing(m, "-z"), belly_dark)
    for z in (1, 3, 5, 7, 9):
        m.voxel(10, 11, z, tooth, part=head)
        m.voxel(19, 11, z, tooth, part=head)
        m.paint(m.box_mask(10, 12, z, 10, 12, z) | m.box_mask(19, 12, z, 19, 12, z), tooth)
    for z in (2, 4, 6, 8):
        m.paint(m.box_mask(10, 10, z, 10, 10, z) | m.box_mask(19, 10, z, 19, 10, z), tooth)
    for x in (11, 13, 16, 18):
        m.voxel(x, 11, 1, tooth, part=head)
    m.voxel(12, 11, 0, tooth, part=head)
    m.voxel(17, 11, 0, tooth, part=head)
    m.paint(facing(m, "+y", m.box_mask(10, 15, 0, 19, 15, 10)), croc_light)
    scatter(m, facing(m, "+y", m.box_mask(10, 15, 0, 19, 15, 10)), croc_dark, 2, 52)
    m.box(12, 16, 1, 13, 16, 2, croc_dark, part=head)
    m.box(16, 16, 1, 17, 16, 2, croc_dark, part=head)
    m.voxel(12, 16, 1, BLACK, part=head)
    m.voxel(17, 16, 1, BLACK, part=head)
    # Eye bumps on top of the head.
    m.box(9, 15, 9, 13, 20, 13, croc, part=head)
    m.box(16, 15, 9, 20, 20, 13, croc, part=head)
    m.box(9, 20, 9, 13, 20, 13, croc_dark, part=head)
    m.box(16, 20, 9, 20, 20, 13, croc_dark, part=head)
    eye = {"y": iris, "k": BLACK, "h": WHITE}
    m.pixels(9, 16, ["yhkky", "yykky", "yykky", "yyyyy"], eye, z=8, part=head)
    m.pixels(16, 16, ["yhkky", "ykkyy", "ykkyy", "yyyyy"], eye, z=8, part=head)
    m.box(9, 15, 8, 20, 15, 8, croc_dark, part=head)
    m.clear(m.box_mask(14, 15, 8, 15, 15, 8))
    adopt_orphans(m)


# -- Blueberrini Octopusini ---------------------------------------------------


@design("BlueberriniOctopusini", width=34, height=38, depth=32)
def blueberrini_octopusini(m):
    berry, berry_dark, berry_deep = "#3f47a8", "#2b2878", "#1d1a52"
    bloom, bloom_light = "#7a86cf", "#aab4ea"
    crown, crown_dark, crown_light = "#34296a", "#120d28", "#6e66b8"
    arm, arm_dark, sucker = "#5b3fa6", "#3e2878", "#d9c0f7"
    blush, mouth_c, mouth_in = "#ff86c2", "#1a1030", "#e0507c"
    xs, ys, zs = m._centres

    # A big round blueberry: deep blue-purple, dusty lighter bloom in soft
    # patches, darker underneath.
    cx, cy, cz = 17, 22.5, 16
    ball = m.ellipsoid(cx, cy, cz, 13, 12, 13, berry)
    skin = exposed(m, ball)
    noise = np.sin(xs * 0.32 + 1.3) * np.sin(ys * 0.36 + 0.4) * np.sin(zs * 0.3 + 2.1) + 0.5 * np.sin((xs - ys) * 0.25 + zs * 0.2)
    m.paint(skin & (noise > 0.3), berry_dark)
    m.paint(skin & (noise < -0.35), bloom)
    speckle(m, skin, bloom_light, 0.05, 71)
    m.paint(skin & m.ellipsoid_mask(10.5, 29, 7, 4, 3.5, 5), bloom_light)
    m.paint(skin & m.ellipsoid_mask(10.5, 29, 7, 2.2, 2, 5), WHITE)
    m.paint(skin & m.box_mask(0, 0, 0, 33, 14, 31), berry_deep)
    speckle(m, skin & m.box_mask(0, 15, 0, 33, 17, 31), berry_deep, 0.4, 72)

    # The star-shaped crown on top: a dark pit ringed by a collar and five
    # pointed sepals flaring up and out.
    top_y = 34
    m.cylinder(cx, top_y, cz, 2.9, 1.6, crown)
    for k in range(5):
        a = -math.pi / 2 + k * 2 * math.pi / 5
        ca, sa = math.cos(a), math.sin(a)
        sepal = tube(m, [(cx + 2.0 * ca, top_y + 0.8, cz + 2.0 * sa), (cx + 4.2 * ca, top_y + 1.8, cz + 4.2 * sa),
                         (cx + 5.6 * ca, top_y + 3.2, cz + 5.6 * sa)], 1.5, 0.55, crown_light)
        m.paint(sepal & m.box_mask(0, top_y + 3, 0, 33, 37, 31), crown)
    m.cylinder(cx, top_y, cz, 1.6, 2.0, crown_dark)
    m.clear(m.cylinder_mask(cx, top_y + 1, cz, 1.1, 2, "Y"))

    # The octopus face: huge eyes, pink cheeks and a little round mouth.
    eye = {"w": WHITE, "k": BLACK, "h": WHITE}
    big_eye = [".wwww.", "wkkkkw", "wkhkkw", "wkkkkw", "wkkkkw", ".wwww."]
    m.pixels(10, 21, big_eye, eye)
    m.pixels(18, 21, big_eye, eye)
    m.pixels(8, 20, ["pp"], {"p": blush})
    m.pixels(24, 20, ["pp"], {"p": blush})
    m.pixels(15, 15, [".mm.", "mppm", ".mm."], {"m": mouth_c, "p": mouth_in})

    def paint_arm(mask, seed):
        m.paint(exposed(m, mask) & m.box_mask(0, 0, 0, 33, 37, 31), arm)
        m.paint(facing(m, "+y", mask), arm_dark)
        scatter(m, facing(m, "-y", mask) | (facing(m, "-z", mask) & m.box_mask(0, 0, 0, 33, 6, 31)), sucker, 2, seed)

    # Two front tentacles are the legs; their tips curl forwards on the ground.
    for side, x in enumerate((13.0, 21.0)):
        root_x = 14.0 if side == 0 else 20.0
        leg = m.limb("Leg", pivot=(root_x, 12.5, 11), phase=side)
        path = [(root_x, 13, 11), (x + (0.5 if side == 0 else -0.5), 6, 10), (x, 1.6, 9), (x, 1.3, 6), (x, 2.8, 4.2)]
        lm = tube(m, path, 2.1, 1.2, arm, part=leg)
        paint_arm(lm, 73 + side)

    # The other six tentacles curl out around the back and wiggle.
    for i, deg in enumerate((-80, 80, -125, 125, -165, 165)):
        a = math.radians(deg)
        dx, dz = math.sin(a), -math.cos(a)
        pts = [(cx + dx * r, y, cz + dz * r) for r, y in ((6, 13), (9.5, 7.5), (12, 4.2), (13.8, 5), (13.6, 7.4))]
        tail = m.limb("Tail", pivot=(cx + dx * 6, 12.5, cz + dz * 6), phase=i % 2)
        tm = tube(m, pts, 1.9, 1.0, arm, part=tail)
        paint_arm(tm, 80 + i)
    adopt_orphans(m)


# -- Strawberelli Flamingelli ---------------------------------------------------


@design("StrawberelliFlamingelli", width=26, height=44, depth=34)
def strawberelli_flamingelli(m):
    red, red_dark, red_light = "#e8263a", "#b3182b", "#ff5a68"
    seed = "#ffe45c"
    leaf, leaf_dark, leaf_light = "#2e9d3a", "#1d6b27", "#62cc4f"
    pink, pink_dark, pink_light = "#ff7eb3", "#e0538f", "#ffb0d0"
    beak_pale, beak_black = "#ffe3ec", "#1b1b20"
    xs, ys, zs = m._centres

    # The body is a giant strawberry lying on its side, tip forwards.
    cx, cy = 13, 23
    z_tip, z_back = 7, 29
    u = (zs - z_tip) / (z_back - z_tip)
    front = np.sin(np.clip(u / 0.7, 0, 1) * math.pi / 2) ** 0.85
    back = np.sqrt(np.clip(1 - np.clip((u - 0.7) / 0.3, 0, None) ** 2 * 0.6, 0, None))
    r = 1.0 + 7.8 * front * back
    berry = (u >= 0) & (u <= 1) & ((xs - cx) ** 2 + ((ys - cy) / 0.95) ** 2 <= r**2)
    m.mask(berry, red)
    skin = exposed(m, berry)
    m.paint(facing(m, "-y", berry), red_dark)
    m.paint(skin & m.box_mask(0, 0, 0, 25, 17, 33), red_dark)
    m.paint(skin & m.ellipsoid_mask(10, 29, 16, 3.5, 2.5, 5), red_light)
    scatter(m, skin, seed, 3, 91)

    # Two long thin pink legs with knees and webbed feet.
    for side, x in enumerate((9, 15)):
        leg = m.limb("Leg", pivot=(x + 1, 16.5, 21), phase=side)
        m.box(x, 1, 20, x + 1, 16, 21, pink, part=leg)
        m.box(x, 8, 20, x + 1, 9, 22, pink_dark, part=leg)
        m.box(x - 1, 0, 17, x + 2, 0, 22, pink, part=leg)
        m.box(x - 1, 0, 17, x - 1, 0, 17, pink_dark, part=leg)
        m.box(x + 2, 0, 17, x + 2, 0, 17, pink_dark, part=leg)

    # Green leaves spreading from the stem at the back.
    m.box(12, 22, 29, 13, 23, 32, leaf_dark)
    for k in range(6):
        a = k / 6 * 2 * math.pi + math.pi / 2
        d = (math.cos(a), math.sin(a) * 0.95)
        pts = [(cx + d[0] * 1.5, cy + d[1] * 1.5, 30), (cx + d[0] * 6, cy + d[1] * 6, 29.5), (cx + d[0] * 9, cy + d[1] * 9, 26)]
        lm = tube(m, pts, 1.7, 0.7, leaf)
        m.paint(exposed(m, lm) & m.box_mask(0, 0, 30, 25, 43, 33), leaf_light)
        m.paint(lm & m.ellipsoid_mask(cx + d[0] * 9, cy + d[1] * 9, 26, 1.5, 1.5, 1.5), leaf_dark)

    # A pink S-shaped neck rising from the front of the strawberry.
    neck = tube(m, bezier((13, 27, 12), (13, 34, 18), (13, 34, 5), (13, 39.5, 10), 30), 1.7, 1.5, pink)
    m.paint(facing(m, "+z", neck), pink_dark)

    # The head nods: pink with a pale beak bent down to a black tip.
    head = m.limb("Head", pivot=(13, 38.5, 10))
    hm = m.ellipsoid(13, 40.5, 9, 4, 3.4, 4.2, pink, part=head)
    m.paint(exposed(m, hm) & m.box_mask(0, 42, 0, 25, 43, 33), pink_light)
    m.pixels(10, 40, ["hk", "kk", "kk"], {"k": BLACK, "h": WHITE})
    m.pixels(14, 40, ["hk", "kk", "kk"], {"k": BLACK, "h": WHITE})
    path = [(13, 40.3, 6), (13, 40.3, 2.2), (13, 38.5, 1.2), (13, 36.2, 1.4), (13, 34.8, 2.6)]
    beak = tube_mask(m, path, 1.5, 0.8) & ~hm
    m.mask(beak, beak_pale, part=head)
    m.paint(beak & m.box_mask(0, 0, 0, 25, 37.5, 33), beak_black)
    adopt_orphans(m)


# -- Pandaccini Bananini ------------------------------------------------------


@design("PandacciniBananini", width=30, height=44, depth=24)
def pandaccini_bananini(m):
    peel, peel_dark, peel_light = "#ffd83b", "#e3ad1c", "#fff08c"
    peel_inner = "#fff6cf"
    tip, spot = "#5e3a12", "#8a5a1c"
    black, black_light = "#1c1c22", "#383844"
    white, white_shade = "#fbfbf7", "#dcdcd4"
    pink = "#ff9ec4"
    xs, ys, zs = m._centres
    cx, cz = 15, 12

    # The banana peel suit: a yellow tube with ridges and a brown bottom nub.
    radius = 6.8 + (ys - 8) / 19 * 1.4
    suit = (ys >= 7) & (ys <= 28) & ((xs - cx) ** 2 + (zs - cz) ** 2 <= radius**2)
    suit |= m.ellipsoid_mask(cx, 8.5, cz, 6.4, 2.5, 6.4)
    m.mask(suit, peel)
    angle = np.arctan2(zs - cz, xs - cx)
    skin = exposed(m, suit)
    m.paint(skin & (np.cos(angle * 4 - math.pi) > 0.93), peel_dark)
    m.paint(skin & m.box_mask(0, 6, 0, 29, 8, 23), peel_dark)
    m.paint(skin & m.ellipsoid_mask(10.5, 17, 4, 2.2, 7, 3), peel_light)
    scatter(m, skin & m.box_mask(0, 10, 0, 29, 23, 23), spot, 5, 101, chance=0.3)
    m.box(14, 5, 11, 15, 6, 12, tip)

    # Black panda legs.
    for side, x in enumerate((10, 16)):
        leg = m.limb("Leg", pivot=(x + 2, 10.5, cz), phase=side)
        m.box(x, 2, 10, x + 3, 10, 14, black, part=leg)
        m.box(x, 0, 9, x + 3, 1, 14, black, part=leg)
        m.box(x, 0, 9, x + 3, 0, 9, black_light, part=leg)

    # The panda's black shoulders fill the top of the peel.
    m.ellipsoid(cx, 28, cz, 6.8, 2.2, 6.8, black)

    # Four pointed peel flaps opening out like a star between the arms and
    # drooping at the tips: pale inside on top, yellow underneath, darker
    # edges and brown tips.
    p0, p1, p2, p3 = (7.6, 27.0), (9.8, 32.5), (14.2, 31.5), (14.6, 22.5)
    for k in range(4):
        a0 = math.pi / 4 + k * math.pi / 2
        cells = {peel: set(), peel_inner: set(), peel_dark: set(), tip: set()}
        for u in np.linspace(0, 1, 90):
            b = [(1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u**2, u**3]
            r = b[0] * p0[0] + b[1] * p1[0] + b[2] * p2[0] + b[3] * p3[0]
            y = b[0] * p0[1] + b[1] * p1[1] + b[2] * p2[1] + b[3] * p3[1]
            db = [-3 * (1 - u) ** 2, 3 * (1 - u) ** 2 - 6 * (1 - u) * u, 6 * (1 - u) * u - 3 * u**2, 3 * u**2]
            dr = db[0] * p0[0] + db[1] * p1[0] + db[2] * p2[0] + db[3] * p3[0]
            dy = db[0] * p0[1] + db[1] * p1[1] + db[2] * p2[1] + db[3] * p3[1]
            length = math.hypot(dr, dy) or 1.0
            nr, ny = -dy / length, dr / length  # towards the side that faced the panda
            half = 0.55 * (7.6 / r) * math.sqrt(max(0.0, 1 - u**2.2))
            for v in np.linspace(-1, 1, 31):
                ang = a0 + v * half
                for layer in (0.0, 0.9):
                    rr, yy = r + nr * layer, y + ny * layer
                    cell = (int(math.floor(cx + rr * math.cos(ang))), int(math.floor(yy)),
                            int(math.floor(cz + rr * math.sin(ang))))
                    if u > 0.87:
                        colour = tip
                    elif abs(v) > 0.87:
                        colour = peel_dark
                    else:
                        colour = peel_inner if layer and u < 0.62 else peel
                    cells[colour].add(cell)
        for colour in (peel, peel_dark, peel_inner, tip):
            for x, y, z in cells[colour]:
                if 0 <= x < m.width and 0 <= y < m.height and 0 <= z < m.depth:
                    m.voxel(x, y, z, colour)

    # Black arms poking out of the sides of the peel.
    for side, x in enumerate((4, 23)):
        arm = m.limb("Arm", pivot=(x + 1.5, 26.5, cz), phase=side)
        m.box(x, 16, cz - 2, x + 2, 26, cz + 1, black, part=arm)
        inner_x = x + 3 if side == 0 else x - 1
        m.box(inner_x, 23, cz - 2, inner_x, 27, cz + 1, black, part=arm)
        m.box(x, 16, cz - 2, x + 2, 17, cz + 1, black_light, part=arm)

    # The panda head: a chunky white block with black ears and eye patches.
    head = m.limb("Head", pivot=(cx, 29, cz))
    hm = rounded_box(m, 8, 29, 6, 21, 41, 18, white, part=head)
    m.paint(exposed(m, hm) & m.box_mask(0, 29, 0, 29, 29, 23), white_shade)
    rounded_box(m, 7, 39, 10, 10, 43, 13, black, part=head)
    rounded_box(m, 19, 39, 10, 22, 43, 13, black, part=head)
    patch = {"k": black, "w": WHITE, "p": BLACK, "h": "#bcd8ff"}
    m.pixels(8, 33, ["..kkk.", ".kwwwk", "kkwhpk", "kkwppk", ".kkkk."], patch)
    m.pixels(16, 33, [".kkk..", "kwwwk.", "kphwkk", "kppwkk", ".kkkk."], patch)
    m.box(11, 29, 4, 18, 32, 5, white, part=head)
    m.box(11, 29, 4, 18, 29, 5, white_shade, part=head)
    m.clear(m.box_mask(11, 32, 4, 11, 32, 5) | m.box_mask(18, 32, 4, 18, 32, 5))
    m.pixels(11, 29, ["..kkkk..", "...kk...", "..k..k..", "........"], {"k": BLACK})
    m.pixels(8, 31, ["pp"], {"p": pink})
    m.pixels(20, 31, ["pp"], {"p": pink})
    adopt_orphans(m)
