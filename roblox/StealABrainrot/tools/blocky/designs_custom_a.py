"""Block-built brainrots, custom batch A: classic Roblox things turned brainrot.

Baconino Capellino, Oofino Cadutino, Lavamattone Obbino, Spaghetti Noobetti,
Coilino Velocino, Bloxy Colino, Robuxino Monetino, Uovino Cacciatore,
Gravitino Lunare and Tixini Biglietti.
"""

import math

import numpy as np

from blocky import design, shade

NOOB_YELLOW = "#f5cd30"
NOOB_GREEN = "#a4bd47"
BLACK = "#1b1b1f"
WHITE = "#ffffff"
INK = {"b": BLACK, "w": WHITE}


# -- helpers ------------------------------------------------------------------


def sym(half):
    """Pixel rows mirrored left to right: each half row plus its reverse."""
    return [row + row[::-1] for row in half]


def smile(width, eye_rows=3):
    """The classic Roblox smile, scaled up: 2-wide eyes with a shine pixel and
    the curved grin. `width` should be even so it centres on an even body."""
    half = width // 2
    eye = "." + "wb" + "." * (half - 3)
    rows = [eye] + ["." + "bb" + "." * (half - 3)] * (eye_rows - 1)
    rows += ["." * half, "b" + "." * (half - 1), ".b" + "." * (half - 2), ".." + "b" * (half - 2)]
    out = []
    for row in rows:
        left = row
        right = row[::-1]
        if "wb" in left:
            right = right.replace("bw", "wb")  # keep the shine on the top-left of both eyes
        out.append(left + right)
    return out


def flat_capsule(m, a, b, r, plane="xy"):
    """A 2D thick line (in voxel index coordinates) extruded through the grid."""
    xs, ys, zs = m._centres
    axes = {"x": xs, "y": ys, "z": zs}
    u, v = axes[plane[0]], axes[plane[1]]
    ax, ay = a[0] + 0.5, a[1] + 0.5
    bx, by = b[0] + 0.5, b[1] + 0.5
    dx, dy = bx - ax, by - ay
    t = np.clip(((u - ax) * dx + (v - ay) * dy) / max(1e-9, dx * dx + dy * dy), 0, 1)
    return (u - ax - t * dx) ** 2 + (v - ay - t * dy) ** 2 <= r * r


def polyline(m, points, r, plane="xy"):
    mask = np.zeros(m.grid.shape, dtype=bool)
    for a, b in zip(points, points[1:]):
        mask |= flat_capsule(m, a, b, r, plane)
    return mask


def exposed(m, direction):
    """Filled voxels with nothing next to them in one direction (up/down)."""
    filled = m.grid > 0
    neighbour = np.zeros_like(filled)
    if direction == "up":
        neighbour[:, :-1, :] = filled[:, 1:, :]
    else:
        neighbour[:, 1:, :] = filled[:, :-1, :]
    return filled & ~neighbour


def noise(m, seed=0):
    """A fixed pseudo-random value 0..1 for every voxel."""
    ix, iy, iz = np.indices(m.grid.shape).astype(np.int64)
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def rounded_box(m, x0, y0, z0, x1, y1, z1):
    """A box with its 12 edges shaved off."""
    ix, iy, iz = np.indices(m.grid.shape)
    inside = (ix >= x0) & (ix <= x1) & (iy >= y0) & (iy <= y1) & (iz >= z0) & (iz <= z1)
    edges = ((ix == x0) | (ix == x1)).astype(int) + ((iy == y0) | (iy == y1)) + ((iz == z0) | (iz == z1))
    return inside & (edges < 2)


def helix_mask(m, cx, cz, radius, y0, pitch, turns, tube):
    """A coil spring round the Y axis, starting at height y0."""
    xs, ys, zs = m._centres
    theta = np.arctan2(zs - cz, xs - cx)
    frac = (theta / (2 * np.pi)) % 1.0
    rho = np.hypot(xs - cx, zs - cz)
    k = np.round((ys - y0) / pitch - frac)
    t = np.clip(frac + k, 0, turns)
    yk = y0 + pitch * t
    return (rho - radius) ** 2 + (ys - yk) ** 2 <= tube * tube


def torus_mask(m, cx, cy, cz, radius, tube):
    xs, ys, zs = m._centres
    rho = np.hypot(xs - cx, zs - cz)
    return (rho - radius) ** 2 + (ys - cy) ** 2 <= tube * tube


def angle_around(m, cx, cz):
    """Angle of every voxel around a vertical axis, 0 = straight at the viewer."""
    xs, _, zs = m._centres
    return np.arctan2(xs - cx, cz - zs)


def zigzag(values, teeth):
    """A triangle wave -1..1 with `teeth` points per turn of `values` (radians)."""
    phase = (values / (2 * np.pi) * teeth) % 1.0
    return 4 * np.abs(phase - 0.5) - 1


# -- 1. Baconino Capellino ------------------------------------------------------


@design("BaconinoCapellino", width=28, height=41, depth=12)
def baconino_capellino(m):
    meat, meat_dark, crisp = "#d8402c", "#a3281b", "#6a2212"
    fat, fat_shade = "#fde6c0", "#f0c996"
    hair, hair_dark, hair_light = "#6e3b1c", "#4a2610", "#9a6032"
    skin, skin_dark = "#f5c99a", "#dea877"
    jeans, jeans_dark, shoe, sole = "#3b5ca6", "#2c4580", "#26262b", "#f0f0f0"

    bottom, top = 9, 32

    def wiggle(y):
        # One full S-bend below the face, straight above it.
        return int(round(2 * math.sin((y - bottom) * 2 * math.pi / 10))) if y < 19 else 0

    # The body: a bacon strip standing up, lean and fat running along it,
    # wiggling like the bacon emoji below the face, with crispy edges.
    stripes = [crisp, meat, meat, fat, fat, meat, meat, meat_dark, meat_dark, meat, meat, fat, fat, meat, meat, crisp]
    for y in range(bottom, top + 1):
        d = wiggle(y)
        for i, colour in enumerate(stripes):
            if i in (0, len(stripes) - 1) and y % 3 == 0:
                colour = meat_dark
            m.box(6 + i + d, y, 4, 6 + i + d, y, 6, colour)
    m.clear(m.box_mask(0, bottom, 0, 6, bottom, 11) | m.box_mask(21, bottom, 0, 27, bottom, 11))
    lean = m.grid == m.colour(meat)
    m.paint(lean & (noise(m, 3) < 0.05), meat_dark)
    m.paint(m.box_mask(0, 0, 6, 27, 40, 6) & (m.grid == m.colour(fat)), fat_shade)

    # The classic smile on the flat top of the strip.
    m.pixels(8, 19, smile(12), INK)

    # The bacon hair: a puffy brown mop with a spiky side-swept fringe and a flick.
    m.mask(rounded_box(m, 4, 30, 3, 23, 37, 8), hair)
    m.box(6, 38, 4, 21, 38, 7, hair)
    fringe = [
        "hhhhhhhhhhhhhhhhhhhh",
        "hhh.hhhhhhhhhhhhhhhh",
        "......hh..hhhhhhhhh.",
        "............hh.hhh..",
    ]
    m.pixels(4, 27, fringe, {"h": hair}, z=3)
    m.box(4, 27, 3, 5, 29, 7, hair)
    m.box(22, 27, 3, 23, 29, 7, hair)
    m.box(14, 39, 4, 17, 39, 6, hair)
    m.box(16, 40, 4, 19, 40, 6, hair)
    m.pixels(4, 27, [
        "....................",
        ".......dd...........",
        "............dd......",
        "................dd..",
    ], {"d": hair_dark})
    m.pixels(6, 31, ["..ll.....ll....ll", "...ll.....ll....l", "....ll.....ll....", "......l......l..."], {"l": hair_light})
    m.paint(m.box_mask(6, 38, 0, 21, 38, 11) & (noise(m, 4) < 0.25), hair_light)

    # Tiny arms.
    left_arm = m.limb("Arm", pivot=(5, 27, 5.5), phase=0)
    right_arm = m.limb("Arm", pivot=(23, 27, 5.5), phase=1)
    m.box(4, 19, 4, 5, 26, 6, skin, part=left_arm)
    m.box(4, 19, 4, 5, 20, 6, skin_dark, part=left_arm)
    m.box(22, 19, 4, 23, 26, 6, skin, part=right_arm)
    m.box(22, 19, 4, 23, 20, 6, skin_dark, part=right_arm)

    # Tiny legs in jeans and sneakers.
    left = m.limb("Leg", pivot=(11.5, 9, 5.5), phase=0)
    right = m.limb("Leg", pivot=(16.5, 9, 5.5), phase=1)
    for part, x0 in ((left, 10), (right, 15)):
        m.box(x0, 2, 4, x0 + 2, 8, 6, jeans, part=part)
        m.box(x0, 7, 4, x0 + 2, 8, 6, jeans_dark, part=part)
        m.box(x0, 0, 3, x0 + 2, 1, 7, shoe, part=part)
        m.box(x0, 0, 3, x0 + 2, 0, 7, sole, part=part)


# -- 2. Oofino Cadutino ----------------------------------------------------------


@design("OofinoCadutino", width=30, height=38, depth=20)
def oofino_cadutino(m):
    yellow = NOOB_YELLOW
    yellow_light, yellow_dark = shade(yellow, 0.35), shade(yellow, -0.2)
    green, green_dark = NOOB_GREEN, shade(NOOB_GREEN, -0.25)
    shoe, shoe_dark = "#6b4226", "#4a2c18"
    mouth_in, tongue = "#4a0d12", "#ef6f86"
    tape, tape_shade = "#fbfbfb", "#d4d4d8"
    plaster, plaster_dot = "#f2c38b", "#c98a50"

    # The big noob head is the whole body.
    m.mask(rounded_box(m, 5, 14, 1, 24, 33, 18), yellow)
    everything = m.box_mask(0, 0, 0, 29, 37, 19)
    m.paint_face(everything, yellow_light, face="top")
    m.paint_face(everything, yellow_dark, face="bottom")

    # Shocked eyes and worried eyebrows.
    face = sym([
        ".....kk...",
        "...kkk....",
        ".kkk......",
        "...kkkk...",
        "..kwwwwk..",
        "..kwwwwk..",
        "..kwbbwk..",
        "..kwbbwk..",
        "..kwwwwk..",
        "...kkkk...",
    ])
    m.pixels(5, 23, face, {"k": BLACK, "w": WHITE, "b": BLACK})

    # The huge "O" mouth, sunk into the head: OOF!
    ring = m.ellipsoid_mask(15, 19, 1, 4.2, 4.6, 99)
    hole = m.ellipsoid_mask(15, 19, 1, 3.0, 3.4, 99)
    m.paint_face(ring, BLACK, face="front")
    m.clear(hole & m.box_mask(0, 0, 0, 29, 37, 2))
    m.paint_face(hole, mouth_in, face="front")
    m.paint_face(hole & m.box_mask(0, 0, 0, 29, 17, 19), tongue, face="front")

    # A sweat drop and a sticking plaster on the cheek.
    m.pixels(21, 19, [".c", "cc", "cw"], {"c": "#7fcfff", "w": WHITE})
    m.pixels(6, 17, ["...pp", "..pdp", ".pdp.", "pdp..", "pp..."], {"p": plaster, "d": plaster_dot})

    # The white bandage cross on top of the bump, and a plaster on the back.
    m.box(9, 34, 8, 20, 34, 11, tape)
    m.box(13, 34, 3, 16, 34, 16, tape)
    m.box(13, 35, 8, 16, 35, 11, tape)
    m.paint(m.box_mask(9, 34, 8, 9, 34, 11) | m.box_mask(20, 34, 8, 20, 34, 11), tape_shade)
    m.paint(m.box_mask(13, 34, 3, 16, 34, 3) | m.box_mask(13, 34, 16, 16, 34, 16), tape_shade)
    m.pixels(11, 24, ["pp....pp", ".pp..pp.", "..pdpp..", "..ppdp..", ".pp..pp.", "pp....pp"],
             {"p": plaster, "d": plaster_dot}, face="back")

    # Tiny arms thrown up in panic.
    left_arm = m.limb("Arm", pivot=(4.5, 23, 7.5), phase=0)
    right_arm = m.limb("Arm", pivot=(25.5, 23, 7.5), phase=1)
    for part, flip in ((left_arm, False), (right_arm, True)):
        def box(x0, y0, z0, x1, y1, z1):
            xa, xb = (x0, x1) if not flip else (29 - x1, 29 - x0)
            m.box(xa, y0, z0, xb, y1, z1, yellow, part=part)
        box(3, 21, 7, 4, 23, 8)
        box(2, 23, 7, 3, 28, 8)
        box(1, 28, 6, 4, 30, 9)
        box(1, 31, 7, 1, 31, 8)
        box(3, 31, 7, 3, 32, 8)

    # Wobbly thin green legs and brown shoes.
    wobble = {13: 0, 12: 0, 11: -1, 10: -1, 9: -1, 8: 0, 7: 1, 6: 1, 5: 1, 4: 0, 3: 0, 2: 0}
    left = m.limb("Leg", pivot=(11, 14, 10), phase=0)
    right = m.limb("Leg", pivot=(19, 14, 10), phase=1)
    for part, base, sign in ((left, 10, 1), (right, 18, -1)):
        for y, dx in wobble.items():
            x = base + dx * sign
            m.box(x, y, 9, x + 1, y, 10, green if y not in (8, 4) else green_dark, part=part)
        m.box(base - 1, 0, 7, base + 2, 1, 11, shoe, part=part)
        m.box(base - 1, 0, 7, base + 2, 0, 11, shoe_dark, part=part)


# -- 3. Lavamattone Obbino -------------------------------------------------------


@design("LavamattoneObbino", width=28, height=30, depth=18)
def lavamattone_obbino(m):
    lava, lava_dark, lava_light = "#ff5a1f", "#d63a12", "#ff8a3a"
    crack, glow, hot = "#6e1606", "#ffa000", "#ffe62e"
    leg, leg_light = "#222226", "#3a3a40"

    # The lava brick.
    m.mask(rounded_box(m, 2, 6, 1, 25, 27, 16), lava)
    everything = m.box_mask(0, 0, 0, 27, 29, 17)
    m.paint_face(everything, lava_light, face="top")
    m.paint_face(everything, lava_dark, face="bottom")

    # Dark cracks and glowing cracks on every side.
    def cracks(paths, plane, face, glowing):
        for path in paths:
            if glowing:
                m.paint_face(polyline(m, path, 1.25, plane), glow, face=face)
                m.paint_face(polyline(m, path, 0.72, plane), hot, face=face)
            else:
                m.paint_face(polyline(m, path, 0.72, plane), crack, face=face)

    cracks([[(2, 24), (4, 22), (4, 19)], [(25, 9), (22, 11), (23, 14), (25, 16)]], "xy", "front", True)
    cracks([[(3, 11), (5, 9), (4, 6)], [(20, 27), (21, 25), (24, 24)], [(11, 6), (12, 8), (15, 8), (16, 6)]], "xy", "front", False)
    cracks([[(3, 26), (8, 23), (12, 20), (16, 17)], [(12, 20), (10, 14), (13, 8)]], "zy", "left", True)
    cracks([[(4, 10), (7, 13), (6, 16)], [(15, 22), (13, 25), (14, 27)]], "zy", "left", False)
    cracks([[(2, 8), (6, 12), (11, 13), (15, 18)], [(8, 27), (10, 22), (7, 19)]], "zy", "right", True)
    cracks([[(12, 7), (13, 11), (16, 12)]], "zy", "right", False)
    cracks([[(3, 25), (8, 22), (11, 17), (17, 14), (20, 8)], [(11, 17), (9, 11)]], "xy", "back", True)
    cracks([[(22, 26), (19, 22), (24, 18)], [(4, 9), (7, 12)]], "xy", "back", False)
    cracks([[(3, 5), (8, 8), (12, 7), (16, 10), (21, 9), (25, 12)], [(12, 7), (13, 2)]], "xz", "top", True)
    cracks([[(6, 14), (9, 12), (10, 15)], [(20, 3), (22, 5)]], "xz", "top", False)

    # Molten bubbles on top.
    for bx, bz, r in ((8, 12, 1.7), (20, 5, 1.4)):
        m.sphere(bx, 28, bz, r, glow)
        m.paint(m.ellipsoid_mask(bx, 29, bz, 1.0), hot)

    # Angry face: heavy brows, glowing eyes, a jagged grimace.
    face = sym([
        "kk......",
        "kkkk....",
        ".kkkkk..",
        "..eekkk.",
        ".eeehbk.",
        ".eeebbe.",
        "..eeee..",
        "........",
        "........",
        "....kkkk",
        "..kkyyyy",
        ".kyykkkk",
        ".kk.....",
    ])
    m.pixels(6, 11, face, {"k": crack, "e": "#fff3c0", "b": BLACK, "h": WHITE, "y": hot})

    # A drip of lava off the bottom edge.
    m.box(13, 4, 2, 14, 5, 3, glow)
    m.box(13, 3, 2, 13, 3, 2, glow)
    m.box(13, 5, 2, 14, 5, 2, hot)

    # Stubby black legs.
    left = m.limb("Leg", pivot=(8.5, 6, 8.5), phase=0)
    right = m.limb("Leg", pivot=(19.5, 6, 8.5), phase=1)
    for part, x0 in ((left, 6), (right, 17)):
        m.box(x0, 0, 5, x0 + 4, 5, 11, leg, part=part)
        m.box(x0, 0, 4, x0 + 4, 1, 11, leg, part=part)
        m.box(x0, 1, 4, x0 + 4, 1, 4, leg_light, part=part)


# -- 4. Spaghetti Noobetti -------------------------------------------------------


@design("SpaghettiNoobetti", width=32, height=40, depth=26)
def spaghetti_noobetti(m):
    cx, cz = 16, 13
    bowl, bowl_shade, bowl_dark = "#fbfbf6", "#dde2e8", "#bcc4ce"
    blue = "#2f6ed6"
    pasta, pasta_dark, pasta_light = "#f3cf6b", "#d6a741", "#ffe9a0"
    sauce, sauce_dark, sauce_light = "#d8321f", "#a0200f", "#f0603f"
    basil, basil_light = "#2f9a3a", "#56c25e"
    fork, fork_dark = "#d5dbe3", "#9aa3ae"

    # The white bowl with a blue band.
    m.cylinder(cx, 7, cz, 5.5, 2, bowl_dark)
    m.cylinder(cx, 9, cz, 7, 11, bowl, radius2=12)
    m.cylinder(cx, 20, cz, 12.6, 2, bowl)
    m.paint(m.box_mask(0, 9, 0, 31, 11, 25), bowl_shade)
    m.paint(m.box_mask(0, 16, 0, 31, 17, 25), blue)
    m.paint(m.box_mask(0, 13, 0, 31, 13, 25), blue)

    # A tangled mound of spaghetti.
    xs, ys, zs = m._centres
    mound = m.ellipsoid_mask(cx, 21, cz, 11, 7, 11) & m.box_mask(0, 22, 0, 31, 39, 25)
    m.mask(mound, pasta)
    ang = angle_around(m, cx, cz)
    rho = np.hypot(xs - cx, zs - cz)
    m.paint(mound & (np.abs(np.sin(ang * 5 + rho * 0.9 + ys * 0.3)) < 0.3), pasta_dark)
    m.paint(mound & (np.abs(np.sin(-ang * 4 + rho * 1.1 + ys * 0.8)) < 0.25), pasta_light)
    # Strands hanging over the rim, hugging the bowl.
    for x, length in ((8, 5), (12, 8), (19, 6), (23, 4)):
        m.paint_face(m.box_mask(x, 20, 0, x, 21, 25), pasta, face="front")
        for y in range(21 - length, 20):
            column = np.nonzero(m.grid[x, y, :])[0]
            if len(column):
                m.voxel(x, y, max(0, column[0] - 1), pasta if y > 21 - length else pasta_dark)

    # Tomato sauce on top, dripping.
    m.ellipsoid(cx, 26, cz, 8, 2.8, 8, sauce)
    top_sauce = m.ellipsoid_mask(cx, 26, cz, 8, 2.8, 8)
    m.paint(top_sauce & (noise(m, 5) < 0.16), sauce_dark)
    m.paint(top_sauce & (noise(m, 6) < 0.1), sauce_light)
    for x, y0 in ((9, 23), (13, 22), (20, 22), (23, 24)):
        m.paint_face(m.box_mask(x, y0, 0, x, 26, 25), sauce, face="front")

    # Basil leaves on the pasta round the meatball.
    for bx, bz in ((6, 10), (23, 15), (12, 3)):
        m.paint_face(m.box_mask(bx, 0, bz, bx + 2, 39, bz + 1), basil, face="top")
        m.paint_face(m.box_mask(bx + 1, 0, bz, bx + 1, 39, bz), basil_light, face="top")

    # The meatball is a noob head with the classic smile.
    head = m.limb("Head", pivot=(cx, 27, cz))
    ball = rounded_box(m, 10, 27, 7, 21, 37, 18) & m.ellipsoid_mask(cx, 32, cz, 7.6, 7.2, 7.6)
    m.mask(ball, NOOB_YELLOW, part=head)
    m.paint(ball & (noise(m, 9) < 0.12) & ~m.box_mask(0, 0, 0, 31, 39, 7), shade(NOOB_YELLOW, -0.15))
    m.paint_face(ball, shade(NOOB_YELLOW, 0.3), face="top")
    m.pixels(12, 29, smile(8), INK)

    # Little noob arms; the right hand holds a fork with a twirl of spaghetti.
    left_arm = m.limb("Arm", pivot=(3, 20, cz), phase=0)
    right_arm = m.limb("Arm", pivot=(29, 20, cz), phase=1)
    m.box(2, 12, 12, 3, 19, 13, NOOB_YELLOW, part=left_arm)
    m.box(28, 12, 12, 29, 19, 13, NOOB_YELLOW, part=right_arm)
    m.box(30, 9, 13, 30, 27, 13, fork, part=right_arm)
    m.box(29, 27, 13, 31, 27, 13, fork, part=right_arm)
    for tx in (29, 30, 31):
        m.box(tx, 28, 13, tx, 31, 13, fork, part=right_arm)
    m.box(30, 9, 13, 30, 10, 13, fork_dark, part=right_arm)
    m.box(28, 12, 12, 30, 14, 14, NOOB_YELLOW, part=right_arm)
    m.box(29, 28, 12, 31, 29, 14, pasta, part=right_arm)
    m.box(29, 29, 12, 31, 29, 12, pasta_light, part=right_arm)
    m.box(29, 25, 12, 29, 27, 12, pasta, part=right_arm)

    # Little legs.
    left = m.limb("Leg", pivot=(13.5, 7, cz), phase=0)
    right = m.limb("Leg", pivot=(18.5, 7, cz), phase=1)
    for part, x0 in ((left, 12), (right, 17)):
        m.box(x0, 2, 11, x0 + 2, 6, 14, NOOB_GREEN, part=part)
        m.box(x0, 0, 10, x0 + 2, 1, 15, "#6b4226", part=part)


# -- 5. Coilino Velocino ---------------------------------------------------------


@design("CoilinoVelocino", width=24, height=38, depth=24)
def coilino_velocino(m):
    cx, cz = 12, 12
    red, red_dark, red_light = "#e5262a", "#9c1216", "#ff6a5e"
    white, sole, lace = "#f7f7f7", "#c9ccd2", "#e5262a"
    bolt = "#ffd21f"

    # The red speed coil.
    y0, pitch, turns = 6.8, 5.0, 4
    coil = helix_mask(m, cx, cz, 7, y0, pitch, turns, 1.7)
    coil |= torus_mask(m, cx, y0, cz, 7, 1.7) | torus_mask(m, cx, y0 + pitch * turns, cz, 7, 1.7)
    m.mask(coil, red)
    m.paint(coil & exposed(m, "up"), red_light)
    m.paint(coil & exposed(m, "down"), red_dark)

    # A big grin on the top ring and two googly eyes sitting on it.
    m.pixels(8, 25, ["bbbbbbbb", ".brrrrb.", "..bbbb.."], {"b": BLACK, "r": "#6a0a10"})
    for ex in (8, 16):
        m.sphere(ex, 32, 7, 4, white)
    pupil = [".bb.", "bwbb", "bbbb", ".bb."]
    m.pixels(7, 30, pupil, INK)
    m.pixels(13, 30, pupil, INK)

    # Sneakers are the legs.
    left = m.limb("Leg", pivot=(5.5, 5, cz), phase=0)
    right = m.limb("Leg", pivot=(18.5, 5, cz), phase=1)
    for part, x0 in ((left, 3), (right, 16)):
        m.box(x0, 0, 7, x0 + 4, 0, 17, sole, part=part)
        m.box(x0, 1, 8, x0 + 4, 3, 17, white, part=part)
        m.box(x0, 1, 7, x0 + 4, 1, 7, white, part=part)
        m.box(x0, 4, 9, x0 + 4, 4, 16, red, part=part)
        m.box(x0 + 1, 3, 9, x0 + 3, 3, 11, lace, part=part)
        m.box(x0, 1, 17, x0 + 4, 2, 17, red, part=part)
    m.pixels(9, 1, ["..bb...", ".bbbbb.", "...bb.."], {"b": bolt}, face="left")
    m.pixels(9, 1, ["...bb..", ".bbbbb.", "..bb..."], {"b": bolt}, face="right")


# -- 6. Bloxy Colino -------------------------------------------------------------


@design("BloxyColino", width=32, height=46, depth=20)
def bloxy_colino(m):
    cx, cz = 16, 10
    red, red_dark, red_light = "#d91e2a", "#a0121c", "#ff5a62"
    silver, silver_dark, silver_light = "#c3c8d0", "#8d949e", "#eef1f5"
    straw, straw_stripe = "#ffffff", "#3c8cff"
    limb, glove, shoe = "#1d1d22", "#ffffff", "#3c8cff"

    # The can: red body, silver bottom, silver top with a rim.
    m.cylinder(cx, 9, cz, 7.5, 2, silver, radius2=9)
    m.cylinder(cx, 11, cz, 9, 23, red)
    m.cylinder(cx, 34, cz, 9, 2, silver, radius2=7.5)
    m.cylinder(cx, 36, cz, 7.5, 1, silver_light)
    m.clear(m.cylinder_mask(cx, 36, cz, 6.2, 1))
    m.paint(m.box_mask(0, 9, 0, 31, 9, 19), silver_dark)
    ang = angle_around(m, cx, cz)
    body = m.cylinder_mask(cx, 11, cz, 9, 23)
    m.paint(body & (np.abs(ang + 0.6) < 0.2), red_light)
    m.paint(body & (np.abs(ang) > 2.2), red_dark)

    # The white swoosh sweeping up across the label, with a pink shadow under it.
    ys = m._centres[1]
    centre = 15 + 3.5 * np.sin(ang + 0.5)
    thick = 1.2 + 1.0 * np.cos(ang - 0.3)
    m.paint(body & (np.abs(ys - centre) < thick), WHITE)
    m.paint(body & (np.abs(ys - centre + thick + 1.0) < 0.5) & (np.cos(ang - 0.3) > -0.2), "#ffd1d5")

    # Pull tab and the bendy straw poking out of the opening.
    m.box(14, 36, 4, 17, 36, 6, silver_dark)
    m.box(15, 36, 5, 16, 36, 5, silver_light)
    straw_mask = m.box_mask(17, 36, 10, 18, 41, 11)
    straw_mask |= polyline(m, [(17.5, 42), (12, 44.5)], 1.0, "xy") & m.box_mask(0, 42, 10, 31, 45, 11)
    m.mask(straw_mask, straw)
    m.paint(straw_mask & ((np.indices(m.grid.shape)[1] % 3) == 0), straw_stripe)
    m.box(17, 41, 10, 18, 42, 11, silver_light)
    m.box(17, 36, 12, 18, 36, 12, BLACK)

    # Excited face: sparkly eyes, rosy cheeks, a big open grin.
    m.pixels(8, 21, [
        "...bb......bb...",
        "..bwbb....bwbb..",
        "..bbbb....bbbb..",
        "..bbbb....bbbb..",
        "...bb......bb...",
        "................",
        ".pp.kkkkkkkk.pp.",
        ".pp.krrrrrrk.pp.",
        ".....krpprk.....",
        "......kkkk......",
    ], {"b": BLACK, "w": WHITE, "k": BLACK, "r": "#5a0a10", "p": "#ff9aa8"})

    # Rubber-hose arms with white gloves: one waving high.
    left_arm = m.limb("Arm", pivot=(6, 28, cz), phase=0)
    right_arm = m.limb("Arm", pivot=(26, 28, cz), phase=1)
    m.box(5, 18, 9, 6, 27, 10, limb, part=left_arm)
    m.box(4, 15, 9, 6, 17, 11, glove, part=left_arm)
    m.box(7, 16, 10, 7, 16, 10, glove, part=left_arm)
    m.box(25, 27, 9, 26, 28, 10, limb, part=right_arm)
    m.box(26, 29, 9, 27, 33, 10, limb, part=right_arm)
    m.box(25, 34, 9, 28, 36, 11, glove, part=right_arm)
    m.box(24, 34, 10, 24, 35, 10, glove, part=right_arm)
    m.box(25, 37, 10, 25, 37, 10, glove, part=right_arm)
    m.box(27, 37, 10, 27, 37, 10, glove, part=right_arm)

    # Legs and blue sneakers.
    left = m.limb("Leg", pivot=(13, 9, cz), phase=0)
    right = m.limb("Leg", pivot=(19, 9, cz), phase=1)
    for part, x0 in ((left, 12), (right, 18)):
        m.box(x0, 3, 9, x0 + 1, 8, 10, limb, part=part)
        m.box(x0 - 1, 0, 7, x0 + 2, 2, 11, shoe, part=part)
        m.box(x0 - 1, 0, 7, x0 + 2, 0, 11, WHITE, part=part)
        m.box(x0, 2, 7, x0 + 1, 2, 8, WHITE, part=part)


# -- 7. Robuxino Monetino --------------------------------------------------------


@design("RobuxinoMonetino", width=32, height=42, depth=12)
def robuxino_monetino(m):
    cx, cy = 16, 26
    gold, gold_light, gold_dark = "#ffc629", "#ffe27a", "#d99a14"
    emboss, emboss_dark = "#c98a0e", "#a86f08"
    limb, sneaker = "#9a6a12", "#3fbf62"

    xs, ys, _ = m._centres

    def hexagon(r):
        return (np.abs(xs - cx) <= r * 0.866) & (np.abs(ys - cy) + np.abs(xs - cx) * 0.577 <= r)

    slab = m.box_mask(0, 0, 3, 31, 41, 8)
    faces = m.box_mask(0, 0, 2, 31, 41, 9) & ~slab
    m.mask((hexagon(14) & slab) | (hexagon(13) & faces), gold)
    # A reeded edge.
    ang = np.arctan2(ys - cy, xs - cx)
    edge = (hexagon(14) & slab) & ~hexagon(12.8)
    m.paint(edge & ((np.floor(ang / (2 * np.pi) * 64) % 2) == 0), gold_dark)
    # Shine.
    m.paint_face(hexagon(13) & (np.abs((xs - cx) + (ys - cy) - 7) < 1.2) & ~hexagon(10.5), gold_light, face="front")

    # The embossed Robux symbol: a hexagon ring with a square inside.
    ring = hexagon(12) & ~hexagon(9.8) & m.box_mask(0, 0, 1, 31, 41, 1)
    m.mask(ring, emboss)
    square = m.box_mask(11, 21, 1, 20, 30, 1)
    m.mask(square, emboss)
    m.paint(m.box_mask(11, 21, 1, 20, 21, 1) | m.box_mask(20, 21, 1, 20, 30, 1), emboss_dark)
    m.paint(ring & (ys < cy - 2), emboss_dark)
    m.pixels(11, 23, smile(10), INK)
    m.mask(hexagon(12) & ~hexagon(9.8) & m.box_mask(0, 0, 10, 31, 41, 10), emboss)
    m.box(11, 21, 10, 20, 30, 10, emboss)

    # Arms and legs.
    left_arm = m.limb("Arm", pivot=(3, 29, 6), phase=0)
    right_arm = m.limb("Arm", pivot=(29, 29, 6), phase=1)
    m.box(2, 20, 5, 3, 28, 6, limb, part=left_arm)
    m.box(1, 17, 4, 3, 19, 7, gold_light, part=left_arm)
    m.box(28, 20, 5, 29, 28, 6, limb, part=right_arm)
    m.box(28, 17, 4, 30, 19, 7, gold_light, part=right_arm)

    left = m.limb("Leg", pivot=(12.5, 14, 6), phase=0)
    right = m.limb("Leg", pivot=(19.5, 14, 6), phase=1)
    for part, x0 in ((left, 11), (right, 18)):
        m.box(x0, 3, 5, x0 + 2, 13, 6, limb, part=part)
        m.box(x0 - 1, 0, 3, x0 + 3, 2, 7, sneaker, part=part)
        m.box(x0 - 1, 0, 3, x0 + 3, 0, 7, WHITE, part=part)


# -- 8. Uovino Cacciatore --------------------------------------------------------


@design("UovinoCacciatore", width=30, height=44, depth=24)
def uovino_cacciatore(m):
    cx, cy, cz = 15, 21, 12
    cream, pink, mint, lavender = "#fff6e2", "#ff94c4", "#86e2b6", "#b392f0"
    hat, hat_dark, hat_light, band = "#3b7a36", "#28552a", "#58a04f", "#6b4a2b"
    feather, feather_light = "#e3262f", "#ff7a70"
    wicker, wicker_dark = "#c48a44", "#8d5a26"
    sleeve, hand, boot = "#3b7a36", "#fff4e0", "#5a3418"

    # The egg: fatter at the bottom.
    xs, ys, zs = m._centres
    v = (ys - cy) / 14
    r = 10.5 * np.sqrt(np.clip(1 - v * v, 0, None)) * (1 - 0.18 * v)
    egg = (np.abs(v) <= 1) & ((xs - cx) ** 2 + (zs - cz) ** 2 <= r * r)
    m.mask(egg, cream)

    # Painted like an egg-hunt egg: a mint bottom, pink and lavender zigzags, dots.
    ang = angle_around(m, cx, cz)
    zig = zigzag(ang, 8) * 1.8
    m.paint(egg & (ys + zig < 12.0), mint)
    m.paint(egg & (np.abs(ys + zig - 15.0) < 1.4), pink)
    m.paint(egg & (np.abs(ys - zig - 30.4) < 1.4), lavender)
    turn = ang / (2 * np.pi)

    def dots(row, count, colour, sides_only=False, shift=0.0):
        near = np.abs(((turn * count + shift) % 1.0) - 0.5) < 0.12
        mask = egg & near & (np.abs(ys - row) < 1.0)
        if sides_only:
            mask &= np.abs(ang) > 1.1
        m.paint(mask, colour)

    dots(9.0, 12, WHITE)
    dots(19.0, 10, lavender, True)
    dots(23.0, 10, pink, True, 0.5)
    dots(27.0, 10, mint, True)

    # Face.
    m.pixels(11, 20, smile(8), INK)
    m.pixels(10, 21, ["p", "p"], {"p": pink})
    m.pixels(19, 21, ["p", "p"], {"p": pink})

    # Hunter's hat with a red feather.
    m.cylinder(cx, 33, cz, 8.5, 1, hat_dark)
    m.cylinder(cx, 34, cz, 5.6, 5, hat, radius2=4.4)
    m.cylinder(cx, 34, cz, 5.6, 1, band, radius2=5.5)
    m.paint_face(m.cylinder_mask(cx, 35, cz, 6, 4), hat_light, face="top")
    m.clear(m.box_mask(14, 38, 0, 15, 38, 23))
    plume = polyline(m, [(20, 35), (23, 40), (25, 42)], 1.0, "xy") & m.box_mask(0, 0, 13, 29, 43, 14)
    m.mask(plume, feather)
    m.paint(polyline(m, [(20, 35), (23, 40), (25, 42)], 0.5, "xy") & plume, feather_light)

    # Arms: hunter-green sleeves, a wicker basket of eggs in the right hand.
    left_arm = m.limb("Arm", pivot=(4, 25, cz), phase=0)
    right_arm = m.limb("Arm", pivot=(26, 25, cz), phase=1)
    m.box(3, 17, 11, 4, 24, 12, sleeve, part=left_arm)
    m.box(2, 14, 10, 4, 16, 12, hand, part=left_arm)
    m.box(25, 17, 11, 26, 24, 12, sleeve, part=right_arm)
    basket = m.box_mask(23, 7, 9, 28, 11, 14)
    m.mask(basket, wicker, part=right_arm)
    ix, iy, iz = np.indices(m.grid.shape)
    m.paint(basket & ((ix + iy + iz) % 2 == 0), wicker_dark)
    m.box(23, 11, 9, 28, 11, 14, wicker_dark, part=right_arm)
    m.box(24, 11, 10, 27, 11, 13, "#5c3a1a", part=right_arm)
    m.box(24, 12, 10, 25, 12, 11, pink, part=right_arm)
    m.box(26, 12, 12, 27, 12, 13, mint, part=right_arm)
    m.box(24, 12, 12, 24, 12, 12, lavender, part=right_arm)
    m.box(23, 12, 11, 23, 15, 12, wicker_dark, part=right_arm)
    m.box(28, 12, 11, 28, 15, 12, wicker_dark, part=right_arm)
    m.box(23, 15, 11, 28, 15, 12, wicker_dark, part=right_arm)
    m.box(25, 14, 10, 27, 16, 12, hand, part=right_arm)

    # Little legs in green socks and brown boots.
    left = m.limb("Leg", pivot=(12.5, 9, 12.5), phase=0)
    right = m.limb("Leg", pivot=(17.5, 9, 12.5), phase=1)
    for part, x0 in ((left, 11), (right, 16)):
        m.box(x0, 3, 11, x0 + 2, 8, 13, hat, part=part)
        m.box(x0, 7, 11, x0 + 2, 7, 13, WHITE, part=part)
        m.box(x0, 0, 9, x0 + 2, 2, 13, boot, part=part)


# -- 9. Gravitino Lunare ---------------------------------------------------------


@design("GravitinoLunare", width=34, height=46, depth=34)
def gravitino_lunare(m):
    cx, cz = 17, 17
    purple, purple_dark, purple_light = "#8e44ff", "#5b22b5", "#b98cff"
    moon, moon_dark, moon_light, crater = "#fff1a8", "#f2d36b", "#fffbe0", "#e9cf73"
    fire_hot, fire, fire_tip = "#ffe83a", "#ff9a00", "#ff4a1a"
    nozzle, nozzle_dark = "#a3abb6", "#6f7782"
    star, star_core, trail = "#ffd84d", "#fffbe0", "#d9c8ff"

    # The purple gravity coil.
    y0, pitch, turns = 8.5, 4.3, 4
    coil = helix_mask(m, cx, cz, 6.5, y0, pitch, turns, 1.3)
    coil |= torus_mask(m, cx, y0, cz, 6.5, 1.3) | torus_mask(m, cx, y0 + pitch * turns, cz, 6.5, 1.3)
    m.mask(coil, purple)
    top_y = int(y0 + pitch * turns)
    m.cylinder(cx, top_y, cz, 6.9, 1, purple)
    m.cylinder(cx, 7, cz, 6.9, 1, purple)
    m.paint(exposed(m, "up"), purple_light)
    m.paint(exposed(m, "down"), purple_dark)

    # Two little rocket nozzles blasting flames.
    for nx in (13, 21):
        m.cylinder(nx, 4, cz, 1.7, 3, nozzle, radius2=2.5)
        m.paint(m.box_mask(0, 4, 0, 33, 4, 33) & m.cylinder_mask(nx, 4, cz, 2.5, 1), nozzle_dark)
        m.cylinder(nx, 0, cz, 0.8, 4, fire_tip, radius2=2.1)
        flame = m.cylinder_mask(nx, 0, cz, 0.8, 4, radius2=2.1)
        m.paint(flame & m.box_mask(0, 1, 0, 33, 3, 33), fire)
        m.paint(flame & m.box_mask(0, 3, 0, 33, 3, 33) & m.cylinder_mask(nx, 3, cz, 1.3, 1), fire_hot)

    # The crescent moon on top, smiling.
    head = m.limb("Head", pivot=(cx, top_y + 1, cz))
    xs, ys, zs = m._centres
    my = top_y + 10.5
    crescent = ((xs - cx) ** 2 + (ys - my) ** 2 <= 9.5 ** 2) & ((xs - cx - 5) ** 2 + (ys - my - 1.5) ** 2 > 7.4 ** 2)
    crescent &= m.box_mask(0, top_y + 1, 15, 33, 45, 18)
    m.mask(crescent, moon, part=head)
    m.paint_face(crescent, moon_dark, face="back")
    m.paint(crescent & m.box_mask(0, 0, 15, 33, 45, 15) & ((xs - cx) ** 2 + (ys - my) ** 2 > 8.4 ** 2), moon_light)
    for kx, ky, kr in ((14, my + 6.5, 1.1), (16, my - 7, 1.4), (10.5, my - 4, 0.9)):
        m.paint_face(crescent & ((xs - kx) ** 2 + (ys - ky) ** 2 <= kr * kr), crater, face="front")
    for kx, ky, kr in ((12, my + 1, 1.6), (17, my - 6, 1.2), (14, my + 6, 1.0)):
        m.paint_face(crescent & ((xs - kx) ** 2 + (ys - ky) ** 2 <= kr * kr), crater, face="back")
    ey = int(my)
    m.pixels(9, ey - 4, [
        "..wb..",
        "..bb..",
        "..bb..",
        "......",
        "pp....",
        ".b...b",
        "..bbb.",
    ], {"b": BLACK, "w": WHITE, "p": "#ff9ab8"})

    # A ring of stars orbiting round the coil.
    ring = m.limb("Prop", pivot=(cx, 17.5, cz), axis="Y")
    rho = np.hypot(xs - cx, zs - cz)
    m.mask((np.abs(rho - 13.5) <= 0.72) & m.box_mask(0, 17, 0, 33, 17, 33), trail, part=ring)
    for i in range(6):
        a = i * math.pi / 3 + math.pi / 6
        sx, sz = int(math.floor(cx + 13.5 * math.sin(a))), int(math.floor(cz - 13.5 * math.cos(a)))
        m.box(sx - 2, 17, sz, sx + 2, 17, sz, star, part=ring)
        m.box(sx, 15, sz, sx, 19, sz, star, part=ring)
        m.box(sx, 17, sz - 2, sx, 17, sz + 2, star, part=ring)
        m.box(sx - 1, 16, sz, sx + 1, 18, sz, star, part=ring)
        m.box(sx, 16, sz - 1, sx, 18, sz + 1, star, part=ring)
        m.voxel(sx, 17, sz, star_core, part=ring)


# -- 10. Tixini Biglietti --------------------------------------------------------


@design("TixiniBiglietti", width=32, height=46, depth=14)
def tixini_biglietti(m):
    cx, cy = 16, 24
    gold, gold_light, gold_dark = "#f6c431", "#ffe57a", "#cf9516"
    emboss, emboss_dark = "#c7870c", "#a06a06"
    hat, hat_light, band = "#1c1c22", "#3a3a44", "#8b1e2d"
    silver = "#e3e7ee"
    suit, glove, shoe = "#1c1c22", "#ffffff", "#0f0f12"

    xs, ys, _ = m._centres
    disc = (xs - cx) ** 2 + (ys - cy) ** 2
    slab = m.box_mask(0, 0, 4, 31, 45, 9)
    faces = m.box_mask(0, 0, 3, 31, 45, 10) & ~slab
    m.mask(((disc <= 12.3 ** 2) & slab) | ((disc <= 11.3 ** 2) & faces), gold)
    ang = np.arctan2(ys - cy, xs - cx)
    m.paint((disc > 11.3 ** 2) & slab & ((np.floor(ang / (2 * np.pi) * 60) % 2) == 0), gold_dark)
    m.paint_face((disc <= 11.3 ** 2) & (np.abs((xs - cx) + (ys - cy) - 9) < 1.1), gold_light, face="front")

    # The big embossed T, which is also his brow and nose.
    m.box(9, 27, 2, 22, 30, 2, emboss)
    m.box(14, 18, 2, 17, 26, 2, emboss)
    m.paint(m.box_mask(9, 27, 2, 22, 27, 2) | m.box_mask(17, 18, 2, 17, 26, 2), emboss_dark)

    # Eyes either side of the stem, a monocle and a curly moustache.
    m.pixels(10, 22, ["wbb", "bbb", "bbb", ".b."], INK)
    m.pixels(19, 22, ["wbb", "bbb", "bbb", ".b."], INK)
    monocle = m.box_mask(18, 21, 2, 22, 26, 2) & ~m.box_mask(19, 22, 0, 21, 25, 2)
    m.mask(monocle, silver)
    m.pixels(22, 14, ["s", "s", ".s", ".s", ".s", "s", "s"], {"s": silver})
    m.pixels(8, 15, [
        "b..............b",
        "bb...bbbbbb...bb",
        ".bbbbbbbbbbbbbb.",
        "..bbbbb..bbbbb..",
    ], INK)
    m.box(9, 27, 11, 22, 30, 11, emboss)
    m.box(14, 18, 11, 17, 26, 11, emboss)

    # Top hat.
    m.box(8, 36, 2, 23, 36, 11, hat)
    m.box(10, 37, 3, 21, 44, 10, hat)
    m.box(10, 37, 3, 21, 38, 10, band)
    m.box(11, 39, 3, 11, 43, 3, hat_light)

    # Arms with white gloves; the right one holds a cane.
    left_arm = m.limb("Arm", pivot=(3, 28, 7), phase=0)
    right_arm = m.limb("Arm", pivot=(29, 28, 7), phase=1)
    m.box(2, 19, 6, 3, 27, 7, suit, part=left_arm)
    m.box(1, 16, 5, 4, 18, 8, glove, part=left_arm)
    m.box(28, 19, 6, 29, 27, 7, suit, part=right_arm)
    m.box(27, 16, 5, 30, 18, 8, glove, part=right_arm)
    m.box(29, 3, 6, 29, 15, 6, suit, part=right_arm)
    m.box(28, 18, 6, 30, 19, 6, gold, part=right_arm)

    # Legs in black trousers, shiny shoes with white spats.
    left = m.limb("Leg", pivot=(13, 12, 7), phase=0)
    right = m.limb("Leg", pivot=(19, 12, 7), phase=1)
    for part, x0 in ((left, 12), (right, 18)):
        m.box(x0, 3, 5, x0 + 1, 11, 8, suit, part=part)
        m.box(x0 - 1, 0, 3, x0 + 2, 1, 8, shoe, part=part)
        m.box(x0, 2, 4, x0 + 1, 2, 8, glove, part=part)
