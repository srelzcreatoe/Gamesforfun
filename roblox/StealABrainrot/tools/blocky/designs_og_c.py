"""Block-built brainrots from the original Steal a Brainrot, batch C (Mythic and
Brainrot God): Orangutini Ananassini, Rhino Toasterino, Bombombini Gusini,
Gorillo Watermelondrillo, Girafa Celestre, Trenostruzzo Turbo 3000, Statutino
Libertino and Orcalero Orcala."""

import math

import numpy as np

from blocky import design, shade

BLACK = "#1b1b1f"
WHITE = "#ffffff"


# -- helpers -----------------------------------------------------------------


def _noise(m, seed=0):
    """A fixed pseudo-random number 0..65535 per voxel, for textures."""
    xs, ys, zs = (np.floor(c).astype(np.int64) for c in m._centres)
    h = (xs * 73856093) ^ (ys * 19349663) ^ (zs * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    return (h ^ (h >> 16)) & 0xFFFF


def speckle(m, mask, colours, seed=0, part=None):
    """Recolours the filled voxels in a mask with a random mix of colours
    (repeat a colour to make it more common; None keeps the voxel as it is)."""
    if part is not None:
        mask = mask & (m.part == part)
    n = _noise(m, seed) % len(colours)
    for i, colour in enumerate(colours):
        if colour is not None:
            m.paint(mask & (n == i), colour)


def blob_mask(m, cx, cy, cz, rx, ry, rz, p=2.0):
    """A superellipsoid: p = 2 is an ellipsoid, bigger p is boxier."""
    xs, ys, zs = m._centres
    return (np.abs((xs - cx) / rx) ** p + np.abs((ys - cy) / ry) ** p + np.abs((zs - cz) / rz) ** p) <= 1.0


def rbox_mask(m, x0, y0, z0, x1, y1, z1, r, axes="xyz"):
    """A box (inclusive voxel bounds) with its edges rounded off by radius r
    across the given axes."""
    xs, ys, zs = m._centres
    lo = np.array([x0, y0, z0], float)
    hi = np.array([x1, y1, z1], float) + 1
    c, h = (lo + hi) / 2, (hi - lo) / 2
    inside = np.ones(m.grid.shape, bool)
    acc = np.zeros(m.grid.shape)
    for i, (coord, axis) in enumerate(zip((xs, ys, zs), "xyz")):
        d = np.abs(coord - c[i])
        inside &= d <= h[i]
        if axis in axes:
            q = np.maximum(d - (h[i] - r), 0)
            acc += q * q
    return inside & (acc <= r * r)


def taper_mask(m, start, end, r0, r1):
    """A cone-capsule from start (radius r0) to end (radius r1)."""
    xs, ys, zs = m._centres
    a = np.array(start, float)
    ab = np.array(end, float) - a
    px, py, pz = xs - a[0], ys - a[1], zs - a[2]
    t = np.clip((px * ab[0] + py * ab[1] + pz * ab[2]) / max(1e-9, float(ab @ ab)), 0, 1)
    dx, dy, dz = px - t * ab[0], py - t * ab[1], pz - t * ab[2]
    return np.sqrt(dx * dx + dy * dy + dz * dz) <= r0 + (r1 - r0) * t


def path_mask(m, points, r0, r1=None):
    """Tapered capsules through a list of points (a bendy neck or tail)."""
    r1 = r0 if r1 is None else r1
    mask = np.zeros(m.grid.shape, bool)
    n = len(points) - 1
    for i in range(n):
        ra = r0 + (r1 - r0) * i / n
        rb = r0 + (r1 - r0) * (i + 1) / n
        mask |= taper_mask(m, points[i], points[i + 1], ra, rb)
    return mask


def oval_mask(m, centre, direction, radii, up=(0, 0, 1)):
    """An ellipsoid whose first axis points along `direction`; radii are
    (along, across, thickness), thickness measured along roughly `up`."""
    xs, ys, zs = m._centres
    u = np.array(direction, float)
    u /= np.linalg.norm(u)
    w = np.array(up, float)
    w -= u * (w @ u)
    w /= np.linalg.norm(w)
    v = np.cross(w, u)
    p = (xs - centre[0], ys - centre[1], zs - centre[2])
    total = 0
    for axis, radius in zip((u, v, w), radii):
        d = p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2]
        total = total + (d / radius) ** 2
    return total <= 1.0


def ring_angle(m, cx, cz):
    """Angle of every voxel around a vertical axis, 0 at the front, radians."""
    xs, _, zs = m._centres
    return np.arctan2(xs - cx, -(zs - cz))


def frac(a):
    return a - np.floor(a)


def pineapple_skin(m, region, cx, cz, line, eye, light, period=6.0):
    """A diamond lattice on a round surface, like pineapple skin."""
    xs, ys, zs = m._centres
    radius = np.sqrt((xs - cx) ** 2 + (zs - cz) ** 2)
    u = np.arctan2(xs - cx, -(zs - cz)) * np.maximum(radius, 1)
    a, b = frac((u + ys) / period), frac((u - ys) / period)
    m.paint(region & ((a < 1.0 / period) | (b < 1.0 / period)), line)
    m.paint(region & (np.abs(a - 0.58) < 0.09) & (np.abs(b - 0.58) < 0.09), eye)
    m.paint(region & (a > 0.8) & (b > 0.8), light)


def giraffe_patches(m, region, spot, spot_light, size=4):
    """Giraffe coat: blocky brown patches separated by thin light lines."""
    xs, ys, zs = m._centres
    lines = (frac(ys / size) < 1.0 / size) | (frac((xs + zs) / size) < 1.0 / size)
    cell = (np.floor(ys / size) * 3 + np.floor((xs + zs) / size)).astype(int)
    m.paint(region & ~lines & (cell % 2 == 0), spot)
    m.paint(region & ~lines & (cell % 2 == 1), spot_light)


# 3x5 digits for number plates.
DIGITS = {
    "0": ["ddd", "d.d", "d.d", "d.d", "ddd"],
    "3": ["ddd", "..d", ".dd", "..d", "ddd"],
}


def number_rows(text):
    rows = [""] * 5
    for i, ch in enumerate(text):
        for r in range(5):
            rows[r] += ("." if i else "") + DIGITS[ch][r]
    return rows


# -- Orangutini Ananassini -----------------------------------------------------


@design("OrangutiniAnanassini", width=32, height=44, depth=18)
def orangutini_ananassini(m):
    fur, fur_dark, fur_light, fur_deep = "#d9661e", "#a8460f", "#f28d3d", "#7a3208"
    face, face_dark, face_light = "#e3ab74", "#b57a45", "#f5cc9a"
    pine, pine_dark, pine_light, pine_eye = "#f8c630", "#c98612", "#ffe46e", "#8a5418"
    leaf, leaf_dark, leaf_light = "#2fa040", "#1b6b2a", "#72d65a"
    cx, cz = 16, 9.5

    # The head and torso are one big pineapple, a little barrel shaped.
    body = blob_mask(m, cx, 21, cz, 9, 14, 7.5, p=2.3) & m.box_mask(0, 7, 0, 31, 35, 17)
    m.mask(body, pine)
    # Pineapple skin: a diamond grid of darker lines, each diamond with a
    # brown eye and a light top.
    pineapple_skin(m, body, cx, cz, pine_dark, pine_eye, pine_light, period=6)
    _, ys, _ = m._centres
    m.paint(body & (ys > 34), pine_dark)

    # Orangutan face on the upper front: a tan face disc, big cheek pads,
    # a light muzzle, close-set eyes in dark sockets under a heavy brow.
    m.ellipsoid(cx, 27, 3.4, 6.2, 5.4, 2.0, face)
    m.ellipsoid(8.8, 27, 5.0, 2.0, 5.0, 2.4, face_dark, mirror=True)
    m.paint(m.ellipsoid_mask(8.2, 27.5, 3.8, 1.0, 3.2, 2), shade(face_dark, 0.2), mirror=True)
    m.ellipsoid(cx, 24.3, 1.9, 4.2, 2.6, 1.9, face_light)
    m.paint_face(m.box_mask(11, 28, 0, 14, 32, 17), face_dark, mirror=True)
    m.box(11, 32, 1, 20, 32, 3, face_dark)  # brow ridge
    m.box(12, 33, 2, 19, 33, 3, face_dark)
    eye = {"k": BLACK, "w": WHITE, "b": "#6b3a14"}
    m.pixels(12, 29, ["wk", "kb", "kk"], eye)
    m.pixels(18, 29, ["kw", "bk", "kk"], eye)
    m.pixels(14, 25, ["k..k"], {"k": "#7a4a22"}, z=0)  # nostrils
    m.pixels(12, 22, ["k......k", ".kkkkkk.", "..wwww.."], {"k": "#5e2e12", "w": WHITE})  # grin

    # Shaggy orange shoulders the long arms hang from.
    shoulders = m.ellipsoid(7.2, 21.5, 10.5, 4.6, 4.8, 5.4, fur, mirror=True)
    speckle(m, shoulders, [fur, fur, fur_dark, fur_light, fur_deep], seed=1)

    # Short legs with tan feet.
    left = m.limb("Leg", pivot=(12.5, 9, 10), phase=0)
    right = m.limb("Leg", pivot=(19.5, 9, 10), phase=1)
    for part, x0 in ((left, 10), (right, 17)):
        m.box(x0, 2, 7, x0 + 4, 9, 12, fur, part=part)
        speckle(m, m.box_mask(x0, 2, 7, x0 + 4, 9, 12), [fur, fur_dark, fur_light, fur], seed=2, part=part)
        m.box(x0, 0, 5, x0 + 4, 1, 12, face_dark, part=part)
        m.box(x0, 2, 6, x0 + 4, 2, 7, face_dark, part=part)
        m.pixels(x0, 0, ["k.k.k"], {"k": "#8a5a30"}, z=5, part=part)

    # Long shaggy arms reaching almost to the ground, tan hands.
    for side, phase in ((1, 0), (-1, 1)):
        sx = (lambda x: x) if side == 1 else (lambda x: 32 - x)
        arm = m.limb("Arm", pivot=(sx(5.2), 22, 10.5), phase=phase)
        upper = taper_mask(m, (sx(5.2), 22, 10.5), (sx(4), 12, 10.5), 2.6, 2.4)
        lower = taper_mask(m, (sx(4), 12, 10.5), (sx(4), 5.5, 10), 2.5, 2.9)
        tuft = taper_mask(m, (sx(4), 13, 12), (sx(4.5), 7, 14.5), 1.6, 0.6)
        m.mask(upper | lower | tuft, fur, part=arm)
        speckle(m, upper | lower | tuft, [fur, fur_dark, fur_light, fur, fur_deep], seed=4, part=arm)
        hand = m.ellipsoid_mask(sx(4), 3.5, 9.5, 2.6, 2.2, 3.0)
        m.mask(hand, face_dark, part=arm)
        m.paint(hand & m.box_mask(0, 1, 0, 31, 2, 7), "#8a5a30")

    # The spiky leaf crown on top.
    m.cylinder(cx, 33, cz, 3.2, 3, leaf_dark)
    for ring, (count, reach, rise, r0, offset) in enumerate(
        ((8, 7.0, 3.5, 1.3, 22.5), (6, 4.5, 6.5, 1.2, 0), (4, 1.8, 9.0, 1.0, 45))
    ):
        for i in range(count):
            ang = math.radians(offset + i * 360 / count)
            tip = (cx + reach * math.sin(ang), 34 + rise, cz - reach * math.cos(ang) * 0.85)
            start = (cx + 1.5 * math.sin(ang), 34, cz - 1.5 * math.cos(ang))
            colour = (leaf, leaf_dark, leaf_light)[(i + ring) % 3] if ring else (leaf, leaf_dark)[i % 2]
            m.mask(taper_mask(m, start, tip, r0 + 0.2, 0.75), colour)
    m.paint(m.box_mask(0, 41, 0, 31, 43, 17), leaf_light)


# -- Rhino Toasterino ----------------------------------------------------------


@design("RhinoToasterino", width=28, height=29, depth=42)
def rhino_toasterino(m):
    chrome, chrome_light, chrome_dark, chrome_deep = "#cfd5dd", "#f4f7fa", "#98a1ad", "#69717d"
    skin, skin_dark, skin_light = "#8e8a9e", "#676377", "#b3afc3"
    horn, horn_dark, horn_light = "#efe2bf", "#c9b489", "#fff8e2"
    toast, toast_dark, crust = "#f2bd5c", "#d99536", "#a8612a"
    plastic, plastic_light = "#26262c", "#45454f"
    xs, ys, zs = m._centres

    # The body is a shiny chrome toaster with rounded edges.
    body = rbox_mask(m, 4, 6, 10, 23, 21, 33, 2.5)
    m.mask(body, chrome)
    m.paint_face(body, chrome_light, face="top")
    m.paint(body & (ys < 9), chrome_dark)
    m.paint(body & (ys < 7), plastic)
    # Reflections: bright diagonal streaks and a darker band on the sides.
    streak = frac((ys + zs * 0.6) / 9.0)
    m.paint(body & (streak > 0.1) & (streak < 0.24) & (ys > 8), chrome_light)
    m.paint(body & (streak > 0.55) & (streak < 0.62) & (ys > 8), chrome_dark)
    m.paint(body & (np.abs(ys - 17.5) < 0.6), chrome_deep)

    # Two slots on top with toast popping out.
    for x0, top in ((8, 28), (18, 26)):
        m.paint_face(m.box_mask(x0 - 1, 20, 12, x0 + 2, 21, 31), chrome_deep, face="top", mirror=False)
        m.clear(m.box_mask(x0, 20, 13, x0 + 1, 21, 30))
        m.box(x0, 19, 13, x0 + 1, 19, 30, plastic)
        # A slice of bread: a square with a puffy rounded top.
        rows = []
        for y in range(16, top + 1):
            if y <= top - 4:
                rows.append((y, 15, 28))
            elif y <= top - 2:
                rows.append((y, 14, 29))
            elif y == top - 1:
                rows.append((y, 15, 28))
            else:
                rows.append((y, 17, 26))
        for y, z0, z1 in rows:
            m.box(x0, y, z0, x0 + 1, y, z1, crust)
        for y, z0, z1 in rows[:-1]:
            if y < top - 1:
                m.box(x0, y, z0 + 1, x0 + 1, y, z1 - 1, toast)
        m.paint(m.box_mask(x0, top - 5, 18, x0 + 1, top - 3, 25), toast_dark)
        m.paint(m.box_mask(x0, top - 4, 20, x0 + 1, top - 4, 23), shade(toast, 0.25))

    # The lever on the right side and a browning dial on the left.
    m.paint(m.box_mask(23, 9, 20, 27, 19, 22), plastic)
    m.box(24, 15, 19, 26, 17, 23, plastic)
    m.box(24, 17, 19, 26, 17, 23, plastic_light)
    m.box(26, 15, 19, 27, 17, 23, "#d8342c")
    m.cylinder(1, 12, 22, 2.2, 3, plastic, axis="X")
    m.box(0, 12, 22, 1, 14, 22, WHITE)
    # A little red badge on both sides.
    for x in (4, 23):
        m.paint(m.box_mask(x, 11, 14, x, 13, 17), "#d8342c")
        m.paint(m.box_mask(x, 12, 15, x, 12, 16), WHITE)

    # Four stubby rhino legs with ivory toenails.
    legs = (((5, 12), 0), ((18, 12), 1), ((5, 27), 1), ((18, 27), 0))
    for (x0, z0), phase in legs:
        leg = m.limb("Leg", pivot=(x0 + 2.5, 7.5, z0 + 2.5), phase=phase)
        m.mask(rbox_mask(m, x0, 0, z0, x0 + 4, 7, z0 + 4, 1.2, axes="xz"), skin, part=leg)
        m.box(x0, 5, z0, x0 + 4, 5, z0 + 4, skin_dark, part=leg)
        m.pixels(x0, 0, ["h.h.h", "h.h.h"], {"h": horn}, z=z0, part=leg)

    # The power cord is the tail, with a plug on the end.
    tail = m.limb("Tail", pivot=(14, 10, 33.5))
    m.mask(path_mask(m, [(14, 10, 33), (14, 10, 36), (14, 8, 37.5)], 0.9), plastic, part=tail)
    m.box(12, 5, 37, 15, 8, 39, plastic_light, part=tail)
    m.box(12, 6, 40, 12, 7, 41, chrome, part=tail)
    m.box(15, 6, 40, 15, 7, 41, chrome, part=tail)

    # The rhino head sticks out of the front, with a huge horn.
    head = m.limb("Head", pivot=(14, 14, 11))
    skull = rbox_mask(m, 7, 8, 3, 20, 20, 12, 3.0)
    snout = rbox_mask(m, 8, 6, 0, 19, 15, 5, 2.2)
    m.mask(skull | snout, skin, part=head)
    speckle(m, skull | snout, [skin, skin, skin, skin_dark, skin_light], seed=5, part=head)
    m.paint(snout & (ys < 8.5), skin_dark)
    # Wrinkles on the snout.
    m.paint_face(m.box_mask(9, 12, 0, 18, 12, 5) & (frac(xs / 3) < 0.67), skin_dark)
    # Ears with pink insides.
    for x0 in (7, 19):
        m.box(x0, 20, 8, x0 + 1, 23, 10, skin, part=head)
        m.box(x0, 21, 7, x0 + 1, 22, 7, "#e59aa2", part=head)
    # The big horn, curving forwards, and a small one behind it.
    for y in range(14, 28):
        t = (y - 14) / 13
        r = 3.3 * (1 - t) + 0.6 * t
        zc = 2.6 - 1.6 * t * t
        ring = (xs - 14) ** 2 + (zs - zc) ** 2 <= r * r
        colour = horn_dark if y < 16 else horn if y < 23 else horn_light
        m.mask(ring & (ys > y) & (ys < y + 1), colour, part=head)
    for y in range(19, 23):
        t = (y - 19) / 3
        r = 1.8 * (1 - t) + 0.6 * t
        ring = (xs - 14) ** 2 + (zs - 7.5) ** 2 <= r * r
        m.mask(ring & (ys > y) & (ys < y + 1), horn_dark if y < 21 else horn, part=head)
    # Eyes, nostrils and a smile.
    eye = {"k": BLACK, "w": WHITE}
    m.pixels(8, 16, ["wk", "kk", "kk"], eye)
    m.pixels(18, 16, ["kw", "kk", "kk"], eye)
    m.pixels(8, 19, ["kkk"], {"k": skin_dark})
    m.pixels(17, 19, ["kkk"], {"k": skin_dark})
    m.pixels(10, 10, ["kk....kk"], {"k": "#3c3947"})
    m.pixels(10, 7, ["k......k", ".kkkkkk."], {"k": "#3c3947"})


# -- Bombombini Gusini ---------------------------------------------------------


@design("BombombiniGusini", width=54, height=34, depth=43)
def bombombini_gusini(m):
    feather, feather_shade, feather_dark = "#f6f6f1", "#dedcd3", "#bdbab0"
    beak, beak_dark, beak_light = "#ff9420", "#d9650c", "#ffbe6a"
    metal, metal_dark, metal_light, metal_deep = "#8e99a6", "#68727e", "#b8c2cc", "#4b545e"
    blue, red = "#1f4fae", "#d8342c"
    bomb, bomb_dark, bomb_light, band = "#5b6a30", "#3c4720", "#7f9146", "#f2c230"
    leather, leather_dark, glass = "#8a5a2b", "#5e3b1a", "#8fd3ff"
    cx = 27  # the model is 54 wide, so x mirrors to 54 - x
    xs, ys, zs = m._centres

    # The goose's body is the fuselage: white feathers with soft scallops.
    body = m.ellipsoid(cx, 13, 24, 7.5, 7.5, 14.5, feather)
    scallop = (frac(zs / 4 + 0.5 * (np.floor(ys / 2) % 2)) < 0.25) & (frac(ys / 2) < 0.5)
    m.paint(body & scallop & (ys < 17), feather_shade)
    m.paint(body & (ys < 8.5), feather_dark)
    # A metal bomb bay on the belly.
    bay = body & (ys < 8.5) & (zs > 14) & (zs < 31)
    m.paint(bay, metal_dark)
    m.paint(bay & (np.abs(xs - cx) < 0.6), metal_deep)
    # A glass cockpit on the goose's back.
    m.ellipsoid(cx, 20, 20.5, 2.6, 2.4, 3.6, glass)
    m.paint(m.ellipsoid_mask(cx, 20, 20.5, 3, 3, 4) & ((np.abs(zs - 20.5) < 0.6) | (np.abs(xs - cx) < 0.6)), metal_dark)
    m.paint(m.ellipsoid_mask(cx - 1, 21.5, 19, 1, 1, 1), WHITE)

    # Straight metal wings with panel lines, flaps and roundels.
    for x in range(0, 21):
        s = 20 - x
        z0 = 14 + round(s * 0.1)
        z1 = 27 - round(s * 0.14)
        if s > 17:
            z0 += s - 17
            z1 -= s - 17
        y1 = 14 if s < 10 else 13
        m.box(x, 12, z0, x, y1, z1, metal, mirror=True)
    wings = (m.grid == m.colour(metal))
    m.paint(wings & (zs > 23) & (ys > 12.5), metal_dark)  # flaps
    m.paint(wings & (ys < 12.5), metal_deep)
    m.paint_face(wings & (frac(xs / 5) < 0.2), metal_dark, face="top")
    m.paint_face(wings & (zs < 16.5), metal_light, face="top")
    disc = lambda r: m.ellipsoid_mask(6, 13.5, 20.5, r, 9, r)
    m.paint_face(disc(4.2), blue, face="top", mirror=True)
    m.paint_face(disc(3.0), WHITE, face="top", mirror=True)
    m.paint_face(disc(1.7), red, face="top", mirror=True)

    # Engines on the wings with spinning four-blade propellers.
    m.cylinder(15, 13, 10, 2.8, 16, metal, axis="Z", mirror=True)
    m.paint(m.cylinder_mask(15, 13, 10, 2.8, 2, axis="Z"), metal_deep, mirror=True)
    m.paint(m.cylinder_mask(15, 13, 24, 2.8, 2, axis="Z"), metal_dark, mirror=True)
    m.paint_face(m.box_mask(12, 14, 12, 17, 16, 23), metal_light, face="top", mirror=True)
    for hx, phase in ((15, 0), (39, 1)):
        prop = m.limb("Prop", pivot=(hx, 13, 9.5), phase=phase, axis="Z")
        m.mask(m.cylinder_mask(hx, 13, 7, 0.8, 3, axis="Z", radius2=2.0), red, part=prop)
        m.box(hx - 6, 12, 9, hx + 5, 13, 9, "#2b2b30", part=prop)
        m.box(hx - 1, 7, 9, hx, 18, 9, "#2b2b30", part=prop)
        for bx0, by0, bx1, by1 in ((hx - 6, 12, hx - 5, 13), (hx + 4, 12, hx + 5, 13), (hx - 1, 7, hx, 8), (hx - 1, 17, hx, 18)):
            m.box(bx0, by0, 9, bx1, by1, 9, band, part=prop)

    # Bombs: two big ones under the belly, a small one under each wing.
    def drop_bomb(bx, by, z0, z1, r):
        m.cylinder(bx, by, z0, r, z1 - z0, bomb, axis="Z")
        m.ellipsoid(bx, by, z0, r, r, r * 1.2, bomb)
        m.mask(m.cylinder_mask(bx, by, z1, r, 2, axis="Z", radius2=r * 0.4), bomb_dark)
        m.paint(m.cylinder_mask(bx, by, z0 + 1, r + 1, 1.5, axis="Z"), band)
        m.paint_face(m.box_mask(bx - r, by, z0, bx + r, by + r, z1), bomb_light, face="top")
        m.box(bx - r - 1.5, by - 0.5, z1 + 1, bx + r + 0.5, by - 0.5, z1 + 3, bomb_dark)
        m.box(bx - 1, by - r - 0.5, z1 + 1, bx - 0.5, by + r - 0.5, z1 + 3, bomb_dark)

    for bx in (24, 30):
        drop_bomb(bx, 2.5, 16, 26, 2.3)
        m.box(bx - 1, 5, 19, bx, 7, 23, metal_deep)
    for bx in (5, 49):
        drop_bomb(bx, 8, 16, 23, 1.8)
        m.box(bx - 1, 10, 18, bx, 11, 21, metal_deep)

    # A metal tail fin with red, white and blue stripes, and tailplanes.
    for y in range(18, 28):
        z0 = 30 + round((y - 18) * 0.7)
        m.box(26, y, z0, 27, y, 38, metal)
    fin = m.box_mask(26, 18, 30, 27, 27, 38)
    m.paint(fin & (zs > 33) & (zs < 35), red)
    m.paint(fin & (zs > 35) & (zs < 36.5), WHITE)
    m.paint(fin & (zs > 36.5), blue)
    m.paint(fin & (ys > 26), metal_dark)
    for x in range(15, 27):
        s = 26 - x
        m.box(x, 14, 32 + s // 4, x, 14, 37 - s // 5, metal, mirror=True)

    # Fluffy goose tail feathers wag behind.
    tail = m.limb("Tail", pivot=(cx, 15, 36.5))
    feathers = (taper_mask(m, (cx, 14, 35), (cx, 19.5, 42.5), 2.6, 1.1)
                | taper_mask(m, (cx, 14, 35), (cx - 2.8, 17, 41.5), 2.0, 1.0)
                | taper_mask(m, (cx, 14, 35), (cx + 2.8, 17, 41.5), 2.0, 1.0))
    m.mask(feathers & (zs > 36), feather, part=tail)
    m.paint(feathers & (zs > 40), feather_dark)

    # The long white neck and a big goose head in an aviator cap and goggles.
    head = m.limb("Head", pivot=(cx, 16, 13))
    neck = path_mask(m, [(cx, 15, 14), (cx, 20, 13.5), (cx, 24, 11), (cx, 26.5, 8.5)], 3.0, 2.6)
    skull = m.ellipsoid_mask(cx, 28, 7, 5, 4.6, 5)
    m.mask(neck | skull, feather, part=head)
    m.paint(neck & (xs < cx - 1.5) & (ys < 24), feather_shade)
    m.paint(skull & (ys > 31), leather)
    m.paint(skull & (ys > 31) & (np.abs(xs - cx) < 0.6), leather_dark)
    m.box(cx - 1, 33, 6, cx, 33, 8, leather_dark, part=head)
    m.paint(skull & (ys > 29.5) & (ys < 31), leather_dark)  # goggle strap
    m.box(21, 26, 7, 21, 29, 9, leather_dark, part=head)  # ear flaps
    m.box(32, 26, 7, 32, 29, 9, leather_dark, part=head)
    for gx in (23, 29):
        m.box(gx, 29, 2, gx + 1, 31, 4, metal_light, part=head)
        m.box(gx, 30, 1, gx + 1, 31, 1, glass, part=head)
        m.voxel(gx, 31, 1, WHITE, part=head)
    m.box(25, 30, 2, 28, 30, 3, leather_dark, part=head)
    # The orange beak with a light tip and a dark mouth line.
    beak_mask = rbox_mask(m, 24, 23, 0, 29, 26, 4, 1.3)
    m.mask(beak_mask, beak, part=head)
    m.paint(beak_mask & (ys < 24.5), beak_dark)
    m.paint(beak_mask & (ys > 24) & (ys < 25), "#8a3a0a")
    m.paint(beak_mask & (zs < 1) & (ys > 25), beak_light)
    m.pixels(25, 26, ["k..k"], {"k": beak_dark}, z=1, part=head)
    eye = {"k": BLACK, "w": WHITE}
    m.pixels(22, 26, ["wk", "kk", "kk"], eye)
    m.pixels(30, 26, ["kw", "kk", "kk"], eye)


# -- Gorillo Watermelondrillo --------------------------------------------------


@design("GorilloWatermelondrillo", width=40, height=41, depth=22)
def gorillo_watermelondrillo(m):
    fur, fur_dark, fur_light = "#57565f", "#3e3d45", "#75747e"
    silver = "#a9a9b3"
    skin, skin_dark, skin_light = "#2f2d34", "#1c1b20", "#4a4650"
    rind, rind_dark, rind_mid, rind_pale = "#7cc646", "#1d6a2a", "#3f9636", "#dff3b0"
    flesh, flesh_dark, flesh_light, seed = "#ee3b45", "#c42232", "#ff7b82", "#1a1a1a"
    cx, cz = 20, 11.5
    xs, ys, zs = m._centres

    # The body is a whole watermelon, cut open on the chest.
    melon = m.ellipsoid(cx, 17, cz, 11.5, 11, 9, rind)
    angle = ring_angle(m, cx, cz)
    stripe = frac(angle * 12 / (2 * math.pi) + 0.12 * np.sin(ys * 0.8))
    m.paint(melon & (stripe < 0.36), rind_dark)
    m.paint(melon & (stripe > 0.36) & (stripe < 0.44), rind_mid)
    m.clear(m.box_mask(0, 0, 0, 39, 41, 4))
    cut = lambda r: m.ellipsoid_mask(cx, 17, 0, 8.6 - r, 8.2 - r, 99)
    front = m.box_mask(0, 0, 5, 39, 41, 5)
    m.paint(front & cut(0), rind_mid)
    m.paint(front & cut(0.9), rind_pale)
    m.paint(front & cut(2.0), flesh)
    m.paint(front & cut(4.5), shade(flesh, 0.12))
    m.paint(front & cut(2.0) & ~cut(2.9), flesh_dark)
    for i in range(9):
        a = math.radians(i * 40 + 10)
        sx, sy = cx - 0.5 + 4.6 * math.sin(a), 17 + 4.4 * math.cos(a)
        m.box(round(sx), round(sy) - 1, 5, round(sx), round(sy), 5, seed)
    for i in range(4):
        a = math.radians(i * 90 + 45)
        m.box(round(cx - 0.5 + 2 * math.sin(a)), round(17 + 2 * math.cos(a)), 5,
              round(cx - 0.5 + 2 * math.sin(a)), round(17 + 2 * math.cos(a)), 5, seed)
    m.paint(front & cut(6.8), flesh_light)

    # Shoulders and neck of dark fur hug the top of the melon.
    shoulders = m.ellipsoid(10.5, 24, cz, 5.2, 5.5, 6.5, fur, mirror=True)
    traps = m.ellipsoid(cx, 26.5, 12.5, 9, 3.5, 6.5, fur)
    m.clear(m.box_mask(0, 0, 0, 39, 41, 4) & ~m.box_mask(0, 26, 0, 39, 41, 4))

    # Short legs with black feet.
    left = m.limb("Leg", pivot=(16, 8, 12), phase=0)
    right = m.limb("Leg", pivot=(24, 8, 12), phase=1)
    for part, x0 in ((left, 13), (right, 21)):
        m.mask(rbox_mask(m, x0, 2, 8, x0 + 5, 8, 15, 1.5, axes="xz"), fur, part=part)
        m.mask(rbox_mask(m, x0, 0, 6, x0 + 5, 2, 15, 1.2, axes="xz"), skin, part=part)
        m.pixels(x0, 0, ["k.kk.k", "k.kk.k"], {"k": skin_dark}, z=6, part=part)

    # Huge long arms with massive forearms and knuckles.
    for sign, phase in ((1, 0), (-1, 1)):
        sx = (lambda x: x) if sign == 1 else (lambda x: 40 - x)
        arm = m.limb("Arm", pivot=(sx(7), 24.5, cz), phase=phase)
        upper = taper_mask(m, (sx(7), 24.5, cz), (sx(5.5), 14, cz), 3.4, 3.1)
        fore = taper_mask(m, (sx(5.5), 14, cz), (sx(5), 6.5, cz - 0.5), 3.4, 4.1)
        m.mask(upper | fore, fur, part=arm)
        fist = rbox_mask(m, round(sx(5)) - 4, 1, 7, round(sx(5)) + 3, 5, 15, 1.5)
        m.mask(fist, skin, part=arm)
        m.paint(fist & (ys < 2.5), skin_dark)
        m.paint(fist & (zs < 8) & (frac(xs / 2) < 0.5), skin_light)
        speckle(m, upper | fore, [fur, fur, fur_dark, fur_light, fur], seed=11, part=arm)

    speckle(m, shoulders | traps, [fur, fur, fur_dark, fur_light, fur], seed=12)

    # The gorilla head: big angry brow, dark face, crest on top.
    head = m.limb("Head", pivot=(cx, 27, 11))
    skull = m.ellipsoid_mask(cx, 32.5, 10.5, 7, 6.5, 6.5) | m.ellipsoid_mask(cx, 38.5, 11.5, 3, 2.8, 5)
    m.mask(skull, fur, part=head)
    speckle(m, skull, [fur, fur, fur_dark, fur_light], seed=13, part=head)
    m.paint_face(skull & m.box_mask(0, 27, 0, 39, 41, 11), silver, face="back", depth=2)
    face_disc = m.ellipsoid_mask(cx, 31, 0, 5.8, 5.2, 99)
    m.paint_face(face_disc, skin)
    m.ellipsoid(cx, 28.8, 4.4, 4.6, 3.0, 2.3, skin_light, part=head)  # muzzle
    eye = {"w": WHITE, "k": BLACK, "r": "#b3261e"}
    m.pixels(15, 31, ["wwrk", "wwkk"], eye)
    m.pixels(21, 31, ["krww", "kkww"], eye)
    # A heavy angry brow, low in the middle.
    for x0, x1, y in ((14, 16, 34), (23, 25, 34), (15, 18, 33), (21, 24, 33), (18, 21, 32)):
        m.box(x0, y, 3, x1, y, 4, skin_light, part=head)
    m.box(14, 33, 4, 25, 34, 4, skin, part=head)
    m.pixels(17, 29, ["kk..kk"], {"k": skin_dark}, z=2, part=head)
    m.pixels(16, 27, ["kwwwwwwk", ".kkkkkk."], {"k": "#5e1010", "w": WHITE})


# -- Girafa Celestre -----------------------------------------------------------


@design("GirafaCelestre", width=24, height=43, depth=34)
def girafa_celestre(m):
    hide, spot, spot_light, spot_dark = "#f3c34f", "#b8662a", "#c97a36", "#7a3e16"
    muzzle = "#f7dca0"
    suit, suit_shade, suit_grey, suit_dark = "#f4f6f9", "#d5dbe3", "#9aa3b0", "#5f6874"
    orange, glass, glass_light, glass_deep = "#f28a22", "#a9dcff", "#e6f6ff", "#79bdec"
    flame, flame_hot = "#ff8a1c", "#ffe25a"
    cx = 12  # the model is 24 wide, so x mirrors to 24 - x
    xs, ys, zs = m._centres

    # A puffy white space suit on the giraffe's body.
    body = m.mask(blob_mask(m, cx, 16, 18.5, 6.1, 5.0, 10.5, p=2.6), suit)
    m.paint(body & (ys < 13), suit_shade)
    m.paint(body & (np.abs(zs - 18.5) < 1), suit_grey)  # belt
    m.paint(body & (np.abs(zs - 18.5) < 1) & (np.abs(ys - 16) < 1.2), orange)
    m.paint(body & (np.abs(xs - cx) < 0.6) & (ys > 19), suit_grey)  # seam on the back
    # Italian flag patches on both sides, framed in grey.
    for face in ("left", "right"):
        m.pixels(21, 13, ["kkkkkkkk", "kggwwrrk", "kggwwrrk", "kggwwrrk", "kkkkkkkk"],
                 {"k": suit_dark, "g": "#1f9a4a", "w": WHITE, "r": "#d8342c"}, face=face)
    # A control panel on the chest with coloured buttons.
    m.box(9, 12, 7, 14, 17, 7, suit_grey)
    m.pixels(9, 12, [".rr.gg", "......", ".bb.yy", "......", "kkkkkk"],
             {"r": "#e53935", "g": "#43c95a", "b": "#2f7cf6", "y": "#ffd23f", "k": suit_dark}, z=6)

    # Four long legs in suit trousers with chunky grey boots.
    legs = (((7, 10), 0), ((14, 10), 1), ((7, 24), 1), ((14, 24), 0))
    for (x0, z0), phase in legs:
        leg = m.limb("Leg", pivot=(x0 + 1.5, 12, z0 + 1.5), phase=phase)
        m.box(x0, 3, z0, x0 + 2, 12, z0 + 2, suit, part=leg)
        m.box(x0, 7, z0, x0 + 2, 7, z0 + 2, suit_grey, part=leg)
        m.mask(rbox_mask(m, x0 - 1, 0, z0 - 1, x0 + 3, 3, z0 + 3, 1.0, axes="xz"), suit_grey, part=leg)
        m.box(x0 - 1, 0, z0 - 1, x0 + 3, 0, z0 + 3, suit_dark, part=leg)
        m.box(x0 - 1, 3, z0 - 1, x0 + 3, 3, z0 + 3, orange, part=leg)

    # A jetpack on its back: two tanks, nozzles and flames.
    for tx in (9, 15):
        m.cylinder(tx, 23.5, 14, 2.2, 11, suit_grey, axis="Z")
        m.paint_face(m.box_mask(tx - 3, 23, 14, tx + 2, 26, 25), shade(suit_grey, 0.35), face="top")
        m.ellipsoid(tx, 23.5, 14, 2.2, 2.2, 1.5, "#d8342c")
        m.mask(m.cylinder_mask(tx, 23.5, 25, 1.2, 2, axis="Z", radius2=1.8), suit_dark)
        m.mask(m.cylinder_mask(tx, 23.5, 27, 1.6, 4, axis="Z", radius2=0.4), flame)
        m.paint(m.cylinder_mask(tx, 23.5, 27, 0.9, 2.5, axis="Z", radius2=0.3), flame_hot)
    m.box(11, 21, 15, 12, 25, 23, suit_dark)
    m.box(11, 25, 17, 12, 25, 18, "#43c95a")
    m.box(7, 21, 20, 16, 25, 20, suit_dark)

    # Wagging tail with a dark tuft.
    tail = m.limb("Tail", pivot=(cx, 18.5, 28.5))
    m.mask(taper_mask(m, (cx, 18.5, 28), (cx, 12.5, 31.5), 0.9, 0.8), hide, part=tail)
    m.mask(m.ellipsoid_mask(cx, 11.5, 32, 1.4, 2.2, 1.4), spot_dark, part=tail)

    # The long neck with big giraffe patches, rising out of a suit collar.
    neck = path_mask(m, [(cx, 18.5, 11.5), (cx, 25, 10.5), (cx, 32, 9.5)], 2.7, 2.2)
    m.mask(neck, hide)
    giraffe_patches(m, neck, spot, spot_light)
    m.mask(m.cylinder_mask(cx, 20, 11.2, 4.0, 2) & ~m.cylinder_mask(cx, 20, 11.2, 2.2, 2), suit_grey)
    m.paint(m.cylinder_mask(cx, 21.5, 11.2, 4.0, 0.9), orange)

    # The head, inside a glass bubble helmet that turns with it.
    head = m.limb("Head", pivot=(cx, 31, 9.5))
    skull = m.ellipsoid_mask(cx, 35.4, 10.6, 3.7, 3.3, 4.1)
    snout = m.ellipsoid_mask(cx, 34.0, 6.5, 2.8, 2.4, 3.2)
    m.mask(skull, hide, part=head)
    giraffe_patches(m, skull & (zs > 11) & (ys > 36), spot, spot_light)
    m.mask(snout, muzzle, part=head)
    m.paint(snout & (ys < 32.5), shade(muzzle, -0.12))
    m.pixels(10, 34, ["k..k"], {"k": spot_dark})  # nostrils
    m.pixels(10, 32, [".kk."], {"k": spot_dark})
    eye = {"k": BLACK, "w": WHITE}
    m.pixels(8, 35, ["k.", "wk", "kk"], eye)
    m.pixels(14, 35, [".k", "kw", "kk"], eye)
    for ox in (9, 13):
        m.box(ox, 38, 11, ox + 1, 39, 12, hide, part=head)
        m.box(ox, 40, 11, ox + 1, 40, 12, spot_dark, part=head)
    for ex, inner in ((6, 6), (16, 17)):
        m.box(ex, 37, 11, ex + 1, 37, 13, hide, part=head)
        m.box(inner, 37, 11, inner, 37, 11, "#f2a0a8", part=head)
    # The bubble: light blue glass with shine streaks all round, an open
    # visor at the front with a grey rim, and a collar round the neck.
    hx, hy, hz, r = cx, 36, 9.8, 6.9
    ball = m.ellipsoid_mask(hx, hy, hz, r) & ~m.ellipsoid_mask(hx, hy, hz, r - 1.2)
    ball &= ys > 29.5
    dist = np.sqrt((xs - hx) ** 2 + (ys - hy) ** 2 + (zs - hz) ** 2) + 1e-6
    facing = -(zs - hz) / dist  # 1 straight ahead
    glass_shell = ball & (facing < 0.42)
    rim = ball & (facing >= 0.42) & (facing < 0.6)
    m.mask(glass_shell, glass, part=head)
    m.paint(glass_shell & (ys > hy + 3.5), glass_light)
    m.paint(glass_shell & (ys < hy - 3), glass_deep)
    d = np.sqrt((xs - (hx - 3)) ** 2 + (ys - (hy + 2)) ** 2)
    m.paint(glass_shell & (np.abs(d - 3.0) < 0.55) & (xs < hx) & (ys > hy), WHITE)
    m.paint(glass_shell & (np.abs(zs - (hz + 3)) < 0.6) & (ys > hy + 1) & (xs > hx + 2), WHITE)
    m.mask(rim, suit_grey, part=head)
    m.paint(rim & (ys > hy + 4), suit)
    m.mask(m.cylinder_mask(hx, 29, hz - 0.3, 4.8, 2) & ~m.cylinder_mask(hx, 29, hz - 0.3, 2.3, 2), suit_grey, part=head)
    m.paint(m.cylinder_mask(hx, 30, hz - 0.3, 4.8, 1) & ~m.cylinder_mask(hx, 30, hz - 0.3, 4.0, 1), suit_dark)


# -- Trenostruzzo Turbo 3000 ---------------------------------------------------


@design("TrenostruzzoTurbo3000", width=24, height=39, depth=46)
def trenostruzzo_turbo_3000(m):
    iron, iron_light, iron_dark = "#25252c", "#474753", "#15151a"
    red, red_dark, red_light = "#d42a2a", "#9a1818", "#ff5b4a"
    gold, gold_dark, gold_light = "#f2c230", "#c28f14", "#ffe58a"
    glass_lit = "#ffe9a0"
    neck_skin, neck_shade = "#eeb2a2", "#d38d7c"
    plume, plume_dark = "#fbfaf6", "#2b2b30"
    beak, beak_dark = "#f59f68", "#c9703c"
    cx = 12
    xs, ys, zs = m._centres

    # Frame, running board and the big black boiler.
    m.box(7, 5, 3, 16, 10, 40, red_dark)
    m.box(3, 10, 3, 20, 10, 41, red)
    m.paint_face(m.box_mask(3, 10, 3, 20, 10, 41), gold, face="left")
    m.paint_face(m.box_mask(3, 10, 3, 20, 10, 41), gold, face="right")
    boiler = m.cylinder(cx, 17, 5, 6, 25, iron, axis="Z")
    m.paint_face(boiler & (ys > 20), iron_light, face="top")
    m.paint(boiler & (zs < 10), iron_dark)
    for band in (11, 19, 27):
        m.paint(boiler & (np.abs(zs - band - 0.5) < 0.6), gold)
    # The smokebox door on the front: dark disc, gold ring, a hub and handle.
    front = m.box_mask(0, 0, 5, 23, 39, 5)
    ring = m.cylinder_mask(cx, 17, 5, 5.2, 1, axis="Z")
    m.paint(front & ring, gold)
    m.paint(front & m.cylinder_mask(cx, 17, 5, 4.2, 1, axis="Z"), "#3a3a44")
    m.box(11, 16, 4, 12, 17, 4, gold)
    m.box(11, 13, 4, 12, 14, 4, gold_dark)

    # Chimney, gold steam dome and a whistle.
    m.cylinder(cx, 22, 13, 2.2, 6, iron)
    m.cylinder(cx, 28, 13, 3.0, 2, iron)
    m.paint(m.cylinder_mask(cx, 29, 13, 3.0, 1), gold)
    m.paint(m.cylinder_mask(cx, 29, 13, 1.8, 1), iron_dark)
    m.ellipsoid(cx, 22.5, 21.5, 2.6, 2.8, 2.6, gold)
    m.paint(m.ellipsoid_mask(cx - 1, 24, 20.5, 1, 1, 1), gold_light)
    m.box(11, 23, 26, 12, 25, 27, gold)

    # Buffer beam with the "3000" plate, headlamps and a cowcatcher.
    m.box(3, 3, 2, 20, 12, 4, red)
    m.box(3, 4, 2, 20, 11, 2, gold)
    m.pixels(5, 6, number_rows("3000"), {"d": iron_dark}, z=1)
    m.box(3, 4, 1, 20, 4, 1, gold_dark)
    m.box(3, 11, 1, 20, 11, 1, gold_dark)
    for lx in (4, 18):
        m.box(lx, 13, 2, lx + 1, 14, 3, gold)
        m.box(lx, 13, 1, lx + 1, 14, 1, "#fff6c8")
    for y in range(1, 4):
        m.box(5, y, y - 1, 18, y, 3, red_dark)
    m.paint(m.box_mask(5, 1, 0, 18, 3, 3) & (frac(xs / 2) < 0.5), iron)

    # The cab: red walls, lit windows with gold frames, black roof.
    m.box(4, 11, 30, 19, 27, 41, red)
    m.paint(m.box_mask(4, 11, 30, 19, 13, 41), red_dark)
    for face, lo in (("left", 4), ("right", 19)):
        m.paint(m.box_mask(lo, 19, 32, lo, 25, 39), gold)
        m.paint(m.box_mask(lo, 20, 33, lo, 24, 35), glass_lit)
        m.paint(m.box_mask(lo, 20, 37, lo, 24, 38), glass_lit)
        m.paint(m.box_mask(lo, 14, 31, lo, 17, 40), gold_dark)
        m.paint(m.box_mask(lo, 15, 32, lo, 16, 39), red_light)
    for wx in (5, 15):
        m.paint(m.box_mask(wx, 23, 30, wx + 3, 26, 30), gold)
        m.paint(m.box_mask(wx + 1, 24, 30, wx + 2, 25, 30), glass_lit)
    m.box(3, 28, 29, 20, 28, 42, iron)
    m.box(4, 29, 30, 19, 29, 41, iron_light)
    m.paint_face(m.box_mask(3, 28, 29, 20, 28, 42), gold, face="front")

    # Six big spoked wheels (three a side) roll along.
    for zc in (12, 23, 34):
        for wx, px in ((5, 6.0), (17, 18.0)):
            wheel = m.limb("Prop", pivot=(px, 5.0, zc), phase=0, axis="X")
            dist = np.sqrt((ys - 5.0) ** 2 + (zs - zc) ** 2)
            disc = m.box_mask(wx, 0, 0, wx + 1, 9, 45) & (dist <= 5.0)
            m.mask(disc, "#3a1212", part=wheel)
            dy, dz = ys - 5.0, zs - zc
            spokes = (np.abs(dy) < 0.6) | (np.abs(dz) < 0.6) | (np.abs(dy - dz) < 0.75) | (np.abs(dy + dz) < 0.75)
            m.paint(disc & spokes, red)
            m.paint(disc & (dist > 3.9), iron_light)
            m.paint(disc & (dist > 4.4), iron)
            m.paint(disc & (dist < 1.5), gold)

    # Fluffy ostrich wings on the boiler sides.
    for side, phase in ((1, 0), (-1, 1)):
        sx = (lambda x: x) if side == 1 else (lambda x: 24 - x)
        wing = m.limb("Wing", pivot=(sx(6), 18.5, 20), phase=phase)
        feathers = oval_mask(m, (sx(4.5), 16.5, 21.5), (0, -0.35, 1), (6.5, 3.2, 1.6), up=(side, 0, 0))
        m.mask(feathers, plume_dark, part=wing)
        m.paint(feathers & (ys < 15), plume)
        speckle(m, feathers & (ys >= 15), [plume_dark, plume_dark, iron_light], seed=31, part=wing)

    # Big fluffy ostrich tail plumes behind the cab.
    tail = m.limb("Tail", pivot=(cx, 24, 41.5))
    plumes = (taper_mask(m, (cx, 23, 41), (cx, 33, 44.5), 2.2, 1.6)
              | taper_mask(m, (cx - 1, 22, 41), (cx - 4.5, 30, 44.5), 1.9, 1.4)
              | taper_mask(m, (cx + 1, 22, 41), (cx + 4.5, 30, 44.5), 1.9, 1.4))
    plumes &= zs > 41.5
    m.mask(plumes, plume, part=tail)
    m.paint(plumes & (ys < 26), plume_dark)
    speckle(m, plumes & (ys > 26), [plume, plume, "#e8e4da"], seed=32, part=tail)

    # A fluffy ruff where the ostrich neck leaves the smokebox.
    ruff = m.ellipsoid(cx, 22, 7.5, 4.2, 2.2, 3.4, plume_dark)
    speckle(m, ruff, [plume_dark, plume_dark, plume], seed=33)

    # The ostrich: long pink neck, big head with huge eyes and a flat beak.
    head = m.limb("Head", pivot=(cx, 22, 7.5))
    neck = path_mask(m, [(cx, 21, 7.5), (cx, 26, 8), (cx, 29.5, 6.5)], 2.0, 1.8)
    skull = m.ellipsoid_mask(cx, 33.4, 6.0, 4.7, 3.7, 4.0)
    m.mask(neck | skull, neck_skin, part=head)
    m.paint(neck & (xs > cx + 0.5), neck_shade)
    m.paint(skull & (zs > 7.5), neck_shade)
    m.mask(rbox_mask(m, 9, 29, 0, 14, 31, 4, 1.0), beak, part=head)
    m.paint(rbox_mask(m, 9, 29, 0, 14, 29, 4, 1.0), beak_dark)
    m.pixels(10, 31, ["k..k"], {"k": beak_dark}, z=1, part=head)
    eye = {"b": "#8a4b1c", "k": BLACK, "w": WHITE, "l": iron_dark}
    m.pixels(8, 32, ["l.l", "www", "wbk", "wkk", "www"], eye)
    m.pixels(13, 32, ["l.l", "www", "bkw", "kkw", "www"], eye)
    # A scruffy tuft of dark feathers on top.
    tuft = (m.ellipsoid_mask(cx, 37.5, 6.5, 2.2, 1.4, 2.0) & (_noise(m, 34) % 3 > 0)) | m.box_mask(11, 37, 6, 12, 38, 6)
    m.mask(tuft & (ys > 36.5), plume_dark, part=head)


# -- Statutino Libertino -------------------------------------------------------


@design("StatutinoLibertino", width=32, height=44, depth=18)
def statutino_libertino(m):
    verd, verd_dark, verd_deep, verd_light = "#5fc2a8", "#3d9580", "#2a6d5e", "#9be6d1"
    flame, flame_dark, flame_light = "#ffb300", "#ff7a00", "#ffe36b"
    ink, blush = "#12332c", "#f4a3b4"
    cx, cz = 16, 9  # the model is 32 wide, so x mirrors to 32 - x
    xs, ys, zs = m._centres

    # The flowing robe: a bell of folds, belted under a diagonal sash.
    robe = np.zeros(m.grid.shape, bool)
    for y in range(4, 24):
        t = (y - 4) / 19
        rx = 9.2 - 3.4 * t
        rz = 7.4 - 1.9 * t
        robe |= (((xs - cx) / rx) ** 2 + ((zs - cz) / rz) ** 2 <= 1) & (ys > y) & (ys < y + 1)
    robe &= ~(m.box_mask(0, 4, 0, 31, 4, 17) & (_noise(m, 41) % 3 == 0))
    m.mask(robe, verd)
    folds = frac(ring_angle(m, cx, cz) * 14 / (2 * math.pi) + 0.03 * ys)
    m.paint(robe & (folds < 0.22), verd_dark)
    m.paint(robe & (folds > 0.55) & (folds < 0.68), verd_light)
    m.paint(robe & (ys < 5.5), verd_deep)
    sash = np.abs((xs - cx) - 0.95 * (ys - 17.5)) < 1.6
    m.paint(robe & sash & (ys > 10), verd_dark)
    m.paint(robe & (np.abs((xs - cx) - 0.95 * (ys - 17.5) - 1.6) < 0.5) & (ys > 10), verd_light)
    # Shoulders.
    m.ellipsoid(cx, 22.5, cz, 8.2, 2.4, 5.2, verd)
    m.paint(m.ellipsoid_mask(cx, 22.5, cz, 8.2, 2.4, 5.2) & (ys > 23.5), verd_light)

    # Two little legs in sandals peek out under the robe.
    left = m.limb("Leg", pivot=(13.5, 9, 8), phase=0)
    right = m.limb("Leg", pivot=(18.5, 9, 8), phase=1)
    for part, x0 in ((left, 12), (right, 17)):
        m.box(x0, 1, 6, x0 + 2, 9, 9, verd, part=part)
        m.box(x0 - 1, 0, 2, x0 + 3, 1, 10, verd_dark, part=part)
        m.box(x0, 2, 4, x0 + 2, 2, 4, verd_deep, part=part)
        m.pixels(x0 - 1, 1, ["l.l.l"], {"l": verd_light}, z=2, part=part)
        m.pixels(x0 - 1, 0, ["ddddd"], {"d": verd_deep}, z=2, part=part)

    # The raised arm holds the torch with a golden-orange flame.
    torch_arm = m.limb("Arm", pivot=(8.5, 22.5, cz), phase=0)
    tx, tz = 3.5, cz - 0.5
    sleeve = taper_mask(m, (8.5, 22.5, cz), (tx, 30.5, tz), 2.3, 1.9)
    m.mask(sleeve, verd, part=torch_arm)
    m.paint(sleeve & (frac((ys - xs) / 3) < 0.3), verd_dark)
    m.mask(m.ellipsoid_mask(tx, 31.5, tz, 1.9, 1.9, 1.9), verd_light, part=torch_arm)
    m.mask(m.cylinder_mask(tx, 32, tz, 1.2, 3.5), verd_dark, part=torch_arm)
    m.mask(m.cylinder_mask(tx, 35, tz, 2.0, 2, radius2=2.6), verd, part=torch_arm)
    m.paint(m.cylinder_mask(tx, 35, tz, 2.6, 0.9), verd_dark)
    fire = np.zeros(m.grid.shape, bool)
    for y, r in ((37, 2.4), (38, 2.6), (39, 2.3), (40, 1.9), (41, 1.4), (42, 1.0), (43, 0.6)):
        fire |= m.cylinder_mask(tx, y, tz, r, 1)
    fire |= taper_mask(m, (tx - 1.5, 39, tz), (tx - 2.2, 41.5, tz + 0.5), 1.0, 0.6)
    fire |= taper_mask(m, (tx + 1.5, 39, tz), (tx + 2.0, 41, tz - 0.5), 1.0, 0.6)
    m.mask(fire, flame, part=torch_arm)
    m.paint(fire & (ys < 38.5), flame_dark)
    m.paint(fire & m.cylinder_mask(tx, 38, tz, 1.2, 4, radius2=0.5), flame_light)
    m.paint(fire & (ys > 42), flame_light)

    # The other arm hugs the tablet.
    tablet_arm = m.limb("Arm", pivot=(23.5, 22.5, cz), phase=1)
    arm = taper_mask(m, (23.5, 22.5, cz), (25.5, 16, cz - 1.5), 2.2, 1.9) | taper_mask(m, (25.5, 16, cz - 1.5), (23.5, 14.5, 4), 1.9, 1.7)
    m.mask(arm, verd, part=tablet_arm)
    m.mask(m.ellipsoid_mask(23.5, 14.5, 3.5, 1.8), verd_light, part=tablet_arm)
    slab = m.box_mask(21, 12, 1, 28, 22, 2)
    m.mask(slab, verd_light, part=tablet_arm)
    m.paint(slab & ((xs < 22) | (xs > 28) | (ys < 13) | (ys > 22)), verd_dark)
    m.pixels(22, 14, ["kk.kk.", "......", "kkk.kk", "......", "k.kkkk", "......", "kkkk.k"], {"k": verd_deep}, z=0, part=tablet_arm)

    # The big chibi head with wavy hair and a bun.
    head = m.limb("Head", pivot=(cx, 24.5, cz))
    skull = blob_mask(m, cx, 30.2, cz, 6.6, 6.0, 6.0, p=2.3)
    bun = m.ellipsoid_mask(cx, 29.5, 15.5, 2.8, 2.6, 2.0)
    m.mask(skull | bun, verd, part=head)
    hair = (skull & ((zs > cz + 0.5) | (ys > 33.5) | ((np.abs(xs - cx) > 4.5) & (ys > 26.5)))) | bun
    m.paint(hair, verd_dark)
    m.paint(hair & (frac((ys + 1.2 * np.sin(zs * 0.9 + xs * 0.5)) / 3) < 0.25), verd_deep)
    # Cute face.
    eye = {"k": ink, "w": WHITE}
    m.pixels(12, 28, ["wk", "kk", "kk"], eye)
    m.pixels(19, 28, ["wk", "kk", "kk"], eye)
    m.pixels(11, 26, ["pp"], {"p": blush})
    m.pixels(20, 26, ["pp"], {"p": blush})
    m.pixels(14, 25, ["k..k", ".kk."], {"k": ink})
    m.pixels(15, 25, ["pp"], {"p": "#d9667e"})
    # The spiked crown: a band with seven rays fanning out.
    band = blob_mask(m, cx, 34, cz, 7.0, 1.2, 6.4, p=2.3) & ~blob_mask(m, cx, 34, cz, 5.4, 3, 4.8, p=2.3)
    m.mask(band & (zs < cz + 3), verd_light, part=head)
    m.paint(band & (np.abs(ys - 33.5) < 0.6), verd_dark)
    for i in range(7):
        th = math.radians(-72 + i * 24)
        start = (cx + 5.4 * math.sin(th), 34.5 + 0.8 * math.cos(th), cz - 3.2 * math.cos(th) - 1)
        length = 3.8 if i in (0, 6) else 5.0 if i % 2 == 0 else 4.4
        tip = (start[0] + length * math.sin(th), start[1] + length * math.cos(th) + 0.8, start[2] + 1.0)
        m.mask(taper_mask(m, start, tip, 1.3, 0.8), verd_light if i % 2 else verd, part=head)
    m.paint(m.box_mask(0, 34, 0, 31, 34, 17) & band, verd_dark)


# -- Orcalero Orcala -----------------------------------------------------------


@design("OrcaleroOrcala", width=32, height=41, depth=30)
def orcalero_orcala(m):
    black, black_light, white, white_shade, grey = "#1d2029", "#363b48", "#f5f7fa", "#d3d9e1", "#8e97a6"
    skin, skin_dark = "#f2c29c", "#d69e76"
    shoe, shoe_dark, shoe_light = "#1f6fe0", "#1450a8", "#5aa2ff"
    cx, cz = 16, 12  # the model is 32 wide, so x mirrors to 32 - x
    xs, ys, zs = m._centres

    # The body: an upright orca, black on top and back, white chin and belly.
    body = m.mask(blob_mask(m, cx, 25.5, cz, 9.5, 13.5, 8.5, p=2.15) & (ys > 11), black)
    snout = m.mask(m.ellipsoid_mask(cx, 29.5, 4.4, 5.2, 2.2, 2.0), black)
    speckle(m, body | snout, [black, black, black, black_light], seed=51)
    # White belly and a white chin under a big curved smile.
    dx = np.abs(xs - cx)
    smile = 26 + 0.08 * dx ** 2
    chin = (ys < smile) & (dx < 6.2) & (ys > 22.5 + 0.1 * dx ** 2)
    throat = (dx < 2.6) & (ys > 17) & (ys < 23)
    belly = ((xs - cx) / 4.6) ** 2 + ((ys - 16) / 4.8) ** 2 <= 1
    m.paint_face((body | snout) & (chin | throat | belly) & (zs < cz), white, depth=3)
    m.paint(body & belly & (zs < cz - 2) & (ys < 14), white_shade)
    m.paint((body | snout) & (np.abs(ys - smile - 0.5) < 0.5) & (dx < 6.8) & (zs < cz - 2), "#2a2f3c")
    m.pixels(14, 24, ["pppp", ".pp."], {"p": "#f28b9c"})
    # Big white eye patches, tilted up towards the sides, with dark pupils.
    patch = {"w": white, "k": "#0c0e13", "s": "#9fd8ff"}
    m.pixels(7, 31, ["ww.....", "wwwwww.", ".wwwskw", "..wwkkw", "....ww."], patch)
    m.pixels(18, 31, [".....ww", ".wwwwww", "wkswww.", "wkkww..", ".ww...."], patch)
    # White flank patches sweeping up the back, a grey saddle and a blowhole.
    flank = m.ellipsoid_mask(cx, 16.5, 15.5, 99, 4.5, 4.5) & (np.abs(xs - cx) > 5)
    m.paint(body & flank, white)
    m.paint_face(body & m.box_mask(9, 19, 0, 22, 23, 29), grey, face="back")
    m.paint_face(m.box_mask(15, 0, 10, 16, 41, 11), "#0e1016", face="top")  # blowhole

    # The big dorsal fin.
    for y in range(20, 42):
        t = (y - 20) / 21
        zb = 12 + 8.5 * math.sqrt(max(0.0, 1 - ((y + 0.5 - 25.5) / 13.5) ** 2)) - 1
        z_back = 19 + t * 9.5
        z_front = zb if y < 34 else 17 + (y - 34) * 1.35
        if z_front <= z_back and y < 41:
            m.box(15, y, round(z_front), 16, y, round(z_back), black)
    m.paint(m.box_mask(15, 20, 0, 16, 41, 29) & (zs > 24.5), black_light)

    # Human legs in chunky blue sneakers, like Tralalero Tralala.
    left = m.limb("Leg", pivot=(13, 12.5, cz), phase=0)
    right = m.limb("Leg", pivot=(19, 12.5, cz), phase=1)
    for part, x0 in ((left, 11), (right, 17)):
        m.box(x0, 3, 10, x0 + 3, 13, 13, skin, part=part)
        m.box(x0, 8, 10, x0 + 3, 8, 13, skin_dark, part=part)
        sneaker = rbox_mask(m, x0 - 1, 0, 6, x0 + 4, 3, 15, 1.2, axes="yz")
        m.mask(sneaker, shoe, part=part)
        m.paint(sneaker & (ys < 1), white)
        m.paint(sneaker & (zs < 7.5) & (ys < 2.5), white)
        m.paint(sneaker & (ys > 2.5) & (zs > 10.5), shoe_light)
        m.paint(m.box_mask(x0, 3, 8, x0 + 3, 3, 12) & (frac(zs / 2) < 0.5), white)  # laces
        m.box(x0, 3, 14, x0 + 3, 4, 15, shoe_dark, part=part)
    # A white stripe on the outside of each shoe.
    for face in ("left", "right"):
        m.pixels(7, 1, ["......ww", "...www..", "www....."], {"w": white}, face=face)

    # Paddle fins for arms.
    for sign, phase in ((1, 0), (-1, 1)):
        sx = (lambda x: x) if sign == 1 else (lambda x: 32 - x)
        arm = m.limb("Arm", pivot=(sx(7.0), 25.5, cz), phase=phase)
        fin = oval_mask(m, (sx(4.6), 20.6, cz), (-0.5 * sign, -0.87, 0), (5.8, 2.6, 1.6))
        m.mask(fin, black, part=arm)
        m.paint(fin & (zs > cz + 0.5), black_light)

    # The tail stock and flukes behind, wagging.
    tail = m.limb("Tail", pivot=(cx, 14.5, 19))
    stock = taper_mask(m, (cx, 15, 18), (cx, 11.5, 25), 2.6, 1.6)
    flukes = (taper_mask(m, (cx, 10.8, 25), (cx - 7, 10.8, 28.3), 2.0, 1.0)
              | taper_mask(m, (cx, 10.8, 25), (cx + 7, 10.8, 28.3), 2.0, 1.0)) & m.box_mask(0, 10, 0, 31, 11, 29)
    m.mask(stock | flukes, black, part=tail)
    m.paint(flukes & (ys < 10.5), white_shade)
    m.paint(stock & (ys < 11.5), white)
