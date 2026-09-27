"""Block-built brainrots of real friends, all on the same skateboard: Benjini
Skatini (Benji), Canelito Cannolito (his dog, with a cannoli) and Gregorino
Kickflippino (Greg)."""

import math

from blocky import design, shade

WHITE = "#ffffff"
BLACK = "#141417"


def rounded_box_mask(m, x0, y0, z0, x1, y1, z1, radius):
    """A box (bounds included) with its edges rounded off by `radius`."""
    xs, ys, zs = m._centres
    cx = xs.clip(x0 + radius, x1 + 1 - radius)
    cy = ys.clip(y0 + radius, y1 + 1 - radius)
    cz = zs.clip(z0 + radius, z1 + 1 - radius)
    inside = (xs >= x0) & (xs <= x1 + 1) & (ys >= y0) & (ys <= y1 + 1) & (zs >= z0) & (zs <= z1 + 1)
    return inside & ((xs - cx) ** 2 + (ys - cy) ** 2 + (zs - cz) ** 2 <= radius**2)


def speckle(m, mask, colours, seed, density=0.1):
    """Paints a few scattered voxels of each colour over `mask` (fluffy fur,
    strands of hair), the same every build. `density` is the share of voxels
    each colour gets."""
    xs, ys, zs = m._centres
    noise = ((xs * 73.13 + ys * 19.7 + zs * 41.9 + seed * 11.3) ** 2 * 0.0137) % 1.0
    for index, colour in enumerate(colours):
        band = (noise >= index * density) & (noise < (index + 1) * density)
        m.paint(mask & band, colour)


def skateboard(m, xa, xb, za, zb, trucks):
    """Benji's skateboard, on the ground: a black deck with a wood edge from
    xa to xb and za to zb (bounds included), kicked up at both ends, with
    trucks at each z in `trucks` and four white wheels that spin (Props)."""
    grip, wood = "#151517", "#e4c58e"
    truck, truck_dark = "#9a9da3", "#5d6066"
    wheel, wheel_core = "#f5f3ea", "#3c3c42"
    cx = (xa + xb + 1) / 2
    board = m.limb("Board", pivot=(cx, 4.5, (za + zb + 1) / 2))
    for z in range(za, zb + 1):
        lift = 0
        if z < za + 4:
            lift = (za + 4 - z + 1) // 2
        elif z > zb - 4:
            lift = (z - (zb - 4) + 1) // 2
        # Rounded nose and tail.
        inset = 2 if z in (za, zb) else 1 if z in (za + 1, zb - 1) else 0
        m.box(xa + inset, 4 + lift, z, xb - inset, 4 + lift, z, wood, part=board)
        m.box(xa + inset, 5 + lift, z, xb - inset, 5 + lift, z, grip, part=board)
        m.box(xa + inset, 5 + lift, z, xa + inset, 5 + lift, z, wood, part=board)
        m.box(xb - inset, 5 + lift, z, xb - inset, 5 + lift, z, wood, part=board)
    middle = (za + zb) / 2
    for zt in trucks:
        # Bolts on the grip tape, the truck and its axle.
        for z in ((zt + 1, zt + 3) if zt < middle else (zt - 2, zt)):
            for x in (int(cx) - 2, int(cx) + 1):
                m.box(x, 5, z, x, 5, z, "#4a4a50", part=board)
        m.box(xa + 1, 3, zt, xb - 1, 3, zt + 1, truck, part=board)
        m.box(int(cx) - 1, 2, zt, int(cx), 2, zt + 1, truck_dark, part=board)
        m.box(xa - 1, 2, zt, xb + 1, 2, zt + 1, truck_dark, part=board)
        for x0 in (xa - 1.4, xb + 0.4):
            wheel_part = m.limb("Prop", pivot=(x0 + 1, 1.7, zt + 0.9), axis="X")
            m.cylinder(x0, 1.7, zt + 0.9, 1.75, 2, wheel, axis="X", part=wheel_part)
            m.cylinder(x0 - 0.1, 1.7, zt + 0.9, 0.6, 2.2, wheel_core, axis="X", part=wheel_part)


# -- Benjini Skatini ---------------------------------------------------------------


@design("BenjiniSkatini", width=32, height=50, depth=36)
def benjini_skatini(m):
    skin, skin_shade, skin_light = "#b9825c", "#9c6845", "#cc9570"
    hair, hair_light, hair_dark = "#16151b", "#2c2b36", "#0c0b0f"
    tee, tee_shade, tee_light = "#1d1d22", "#121216", "#2b2b32"
    jeans, jeans_dark, jeans_light = "#36496f", "#27354f", "#4a5f8a"
    shoe, shoe_dark, sole = "#f3f3f3", "#232326", "#d6d6d6"
    iris, brow, mouth = "#3a2416", "#121212", "#7a3a2a"

    # His skateboard.
    skateboard(m, 11, 20, 2, 33, trucks=(7, 27))

    # Legs in jeans and white sneakers; the right one kicks to push.
    for x0, phase in ((12, 0), (17, 1)):
        leg = m.limb("Leg", pivot=(x0 + 1.5, 16, 18), phase=phase)
        m.box(x0, 8, 16, x0 + 2, 16, 20, jeans, part=leg)
        m.box(x0, 8, 16, x0 + 2, 8, 20, jeans_dark, part=leg)
        m.box(x0, 6, 15, x0 + 2, 7, 21, shoe, part=leg)
        m.box(x0, 6, 15, x0 + 2, 6, 21, sole, part=leg)
        m.box(x0, 7, 15, x0 + 2, 7, 15, shoe_dark, part=leg)
        m.pixels(x0, 7, ["k.k"], {"k": shoe_dark}, face="left" if phase == 0 else "right", part=leg)
    m.paint_face(m.box_mask(12, 12, 0, 14, 12, 35), jeans_light, face="front")
    m.paint_face(m.box_mask(17, 13, 0, 19, 13, 35), jeans_light, face="front")

    # The black tee.
    m.mask(rounded_box_mask(m, 11, 16, 15, 20, 27, 21, 1.2), tee)
    m.paint_face(m.box_mask(11, 16, 0, 20, 16, 35), tee_shade, face="front")
    m.paint_face(m.box_mask(11, 17, 0, 20, 27, 35), tee_shade, face="back")
    m.paint_face(m.box_mask(13, 26, 0, 18, 26, 35), tee_light, face="front")
    m.paint_face(m.box_mask(14, 21, 0, 17, 22, 35), tee_light, face="front")
    m.box(14, 27, 16, 17, 28, 20, skin)  # neck

    # Arms out for balance: short black sleeves, brown arms.
    for x0, phase in ((8, 0), (21, 1)):
        arm = m.limb("Arm", pivot=(x0 + 1.5, 26.5, 18), phase=phase)
        m.box(x0, 23, 16, x0 + 2, 27, 20, tee, part=arm)
        m.box(x0, 23, 16, x0 + 2, 23, 20, tee_shade, part=arm)
        m.box(x0, 17, 17, x0 + 2, 22, 19, skin, part=arm)
        m.box(x0, 15, 16, x0 + 2, 16, 20, skin_light, part=arm)
        m.box(x0, 15, 16, x0 + 2, 15, 20, skin_shade, part=arm)

    # The head: big, with his face, ears and huge messy black hair.
    head = m.limb("Head", pivot=(16, 28, 18))
    m.mask(rounded_box_mask(m, 9, 28, 12, 22, 43, 24, 2.2), skin, part=head)
    m.paint_face(m.box_mask(9, 28, 0, 22, 28, 35), skin_shade, face="front")
    for x in (8, 23):
        m.box(x, 31, 17, x, 35, 20, skin, part=head)
        m.box(x, 32, 18, x, 34, 19, skin_shade, part=head)
    face = [
        ".bbbbb..bbbbb.",
        "..............",
        "..wkkw..wkkw..",
        "..wkhw..whkw..",
        "...kk....kk...",
        "..............",
        "......nn......",
        ".pp........pp.",
        "....m....m....",
        ".....mmmm.....",
        "..............",
    ]
    m.pixels(9, 29, face, {"b": brow, "w": WHITE, "k": iris, "h": "#8a6248", "n": skin_shade, "p": "#c47e64", "m": mouth})
    m.box(15, 34, 11, 16, 35, 11, skin, part=head)  # nose
    m.box(15, 34, 11, 16, 34, 11, skin_shade, part=head)

    # Hair: a thick black cap with bangs down to his eyebrows, and messy
    # tufts swept up and to one side.
    m.mask(rounded_box_mask(m, 8, 41, 12, 23, 46, 25, 2.5), hair, part=head)
    m.ellipsoid(16, 46, 18, 9.2, 3.2, 8.2, hair, part=head)
    m.box(8, 37, 15, 8, 42, 25, hair, part=head)
    m.box(23, 37, 15, 23, 42, 25, hair, part=head)
    m.box(8, 30, 21, 23, 42, 25, hair, part=head)
    m.mask(rounded_box_mask(m, 9, 29, 22, 22, 42, 26, 1.5), hair, part=head)
    m.pixels(9, 40, ["hhhhhhhhhhhhhh", "h.hhh.hh..hh.h"], {"h": hair}, part=head)
    tufts = [
        ((19, 47, 15), (25, 48.6, 13), 1.6),
        ((21, 46, 20), (26.5, 47.2, 22), 1.5),
        ((16, 48, 17), (19, 49.3, 15), 1.3),
        ((11, 47, 16), (8, 48, 14), 1.3),
        ((22, 43, 14), (26, 43.5, 12.5), 1.2),
        ((14, 47, 21), (13, 49, 24), 1.2),
    ]
    for start, end, radius in tufts:
        m.line(start, end, radius, hair, part=head)
    hair_mask = m.box_mask(0, 39, 0, 31, 49, 35) | m.box_mask(0, 29, 21, 31, 49, 35) | m.box_mask(0, 29, 0, 8, 49, 35) | m.box_mask(23, 29, 0, 31, 49, 35)
    speckle(m, hair_mask & ~m.box_mask(9, 28, 12, 22, 39, 20), [hair_light, hair_dark], seed=3, density=0.09)


# -- Canelito Cannolito -------------------------------------------------------------


@design("CanelitoCannolito", width=30, height=42, depth=42)
def canelito_cannolito(m):
    fur, fur_shade, fur_light = "#ead0a2", "#d4b17c", "#f7e8c9"
    apricot, apricot_dark = "#d9ac72", "#b98a52"
    paw, nose, eye = "#fbf5ea", "#17120f", "#140f0d"
    collar, collar_dark, tag = "#d8322b", "#9e1f1a", "#f2c23a"
    shell, shell_dark, cream, pistachio, choc = "#d99a52", "#a96b31", "#fff7e8", "#8cc063", "#4a2a17"

    # He rides the skateboard too; everything else stands on it (Y up).
    skateboard(m, 9, 20, 5, 36, trucks=(10, 30))
    Y = 6

    # Four fluffy legs; one back paw kicks to push.
    for x0, z0, phase in ((9, 12, 0), (17, 12, 0), (9, 27, 1), (17, 27, 0)):
        leg = m.limb("Leg", pivot=(x0 + 2, Y + 8, z0 + 2), phase=phase)
        m.mask(rounded_box_mask(m, x0, Y + 1, z0, x0 + 3, Y + 8, z0 + 4, 1.2), fur, part=leg)
        m.mask(rounded_box_mask(m, x0, Y, z0 - 1, x0 + 3, Y + 1, z0 + 4, 0.8), paw if z0 == 12 else fur_light, part=leg)
        m.pixels(x0, Y, [".k.k"], {"k": fur_shade}, part=leg)

    # A round, fluffy body.
    m.ellipsoid(15, Y + 12, 22, 8.2, 6.2, 11.5, fur)
    speckle(m, m.ellipsoid_mask(15, Y + 12, 22, 8.4, 6.4, 11.7), [fur_light, fur_shade], seed=1, density=0.08)
    m.paint_face(m.box_mask(0, Y + 5, 0, 29, Y + 8, 41), fur_shade, face="bottom")

    # A red collar with a gold tag.
    collar_ring = m.ellipsoid_mask(15, Y + 13.5, 13, 7.6, 6.6, 99) & ~m.ellipsoid_mask(15, Y + 13.5, 13, 5.2, 4.2, 99)
    m.mask(collar_ring & m.box_mask(0, Y, 12, 29, 41, 13), collar)
    m.paint(collar_ring & m.box_mask(0, Y, 13, 29, 41, 13), collar_dark)
    m.box(14, Y + 7, 11, 16, Y + 9, 11, tag)
    m.box(15, Y + 7, 10, 15, Y + 8, 10, shade(tag, -0.25))

    # A curly, fluffy tail that wags.
    tail = m.limb("Tail", pivot=(15, Y + 15, 32))
    m.line((15, Y + 15, 32), (15, Y + 21, 36), 2.3, fur, part=tail)
    m.line((15, Y + 21, 36), (15, Y + 24, 33), 2.1, fur, part=tail)
    m.sphere(15, Y + 24, 32.5, 2.2, fur_light, part=tail)
    speckle(m, m.box_mask(10, Y + 14, 30, 20, Y + 27, 41), [fur_light, fur_shade], seed=4, density=0.08)

    # The big head: round eyes, a black button nose, a tan muzzle and a
    # cannoli held in his mouth.
    head = m.limb("Head", pivot=(15, Y + 15, 12))
    m.ellipsoid(15, Y + 22.5, 8, 8.6, 7.8, 7.2, fur, part=head)
    speckle(m, m.ellipsoid_mask(15, Y + 22.5, 8, 8.8, 8, 7.4), [fur_light, fur_shade], seed=6, density=0.07)
    m.ellipsoid(15, Y + 19.5, 2.4, 4.4, 3.4, 2.6, fur_light, part=head)
    m.paint_face(m.ellipsoid_mask(15, Y + 18, 0, 3.6, 1.8, 99), apricot, face="front")
    # Button nose, sticking out.
    m.box(14, Y + 20, 0, 15, Y + 21, 0, nose, part=head)
    m.box(13, Y + 19, 1, 16, Y + 21, 1, nose, part=head)
    m.voxel(14, Y + 21, 0, "#5a4a44", part=head)
    # Big dark puppy eyes with a shine, and fluffy brows.
    eyes = [
        ".kk.",
        "khkk",
        "kkkk",
        ".kk.",
    ]
    m.pixels(9, Y + 22, eyes, {"k": eye, "h": WHITE})
    m.pixels(17, Y + 22, [".kk.", "kkhk", "kkkk", ".kk."], {"k": eye, "h": WHITE})
    m.pixels(9, Y + 26, ["llll"], {"l": fur_light})
    m.pixels(17, Y + 26, ["llll"], {"l": fur_light})

    # The cannoli, crosswise in his mouth: a golden shell with cream,
    # pistachios and chocolate chips at the ends.
    m.cylinder(8, Y + 16.8, 1.6, 1.6, 14, shell, axis="X", part=head)
    speckle(m, m.cylinder_mask(8, Y + 16.8, 1.6, 1.8, 14, axis="X"), [shell_dark], seed=7, density=0.25)
    for x0 in (6, 22):
        m.cylinder(x0, Y + 16.8, 1.6, 1.4, 2, cream, axis="X", part=head)
    for x, y, z, colour in ((6, 17, 1, pistachio), (6, 16, 2, choc), (23, 17, 1, pistachio), (23, 16, 2, choc), (7, 17, 2, choc), (22, 16, 1, pistachio)):
        m.voxel(x, Y + y, z, colour, part=head)

    # Long floppy ears that bounce as he rides and fly up when he jumps.
    for cx, pivot_x, phase in ((5.5, 6.5, 0), (24.5, 23.5, 1)):
        ear = m.limb("Ear", pivot=(pivot_x, Y + 26, 8), phase=phase)
        m.ellipsoid(cx, Y + 20.5, 8, 1.9, 6.2, 3.4, apricot, part=ear)
        speckle(m, m.ellipsoid_mask(cx, Y + 20.5, 8, 2.1, 6.4, 3.6), [fur, apricot_dark], seed=8 + int(cx), density=0.12)
        m.paint(m.ellipsoid_mask(cx, Y + 15.5, 8, 2.2, 1.6, 3.6), apricot_dark)


# -- Greggini Ricciolini (Greg: "ricciolini" are little curls) -----------------


@design("GregginiRicciolini", width=32, height=48, depth=36)
def greggini_ricciolini(m):
    skin, skin_shade, skin_light = "#e2b594", "#c99a78", "#eec8aa"
    hair, hair_light, hair_dark = "#1f1814", "#3a2c24", "#120e0c"
    beard, stubble, lips = "#2a1e17", "#a88368", "#c9806e"
    tee, tee_shade, tee_light = "#f6f6f8", "#e6e6ec", "#ffffff"
    pants, pants_dark = "#26262c", "#18181c"
    shoe, shoe_dark, sole = "#1d1d21", "#35353b", "#f1f1f1"
    gold, gold_dark = "#f2c23a", "#c49419"
    iris, brow = "#2e1d13", "#161110"

    # Greg's on the skateboard too.
    skateboard(m, 11, 20, 2, 33, trucks=(7, 27))

    # Black joggers and black high-tops with white soles; the right foot
    # kicks to push.
    for x0, phase in ((12, 0), (17, 1)):
        leg = m.limb("Leg", pivot=(x0 + 1.5, 16, 18), phase=phase)
        m.box(x0, 9, 16, x0 + 2, 16, 20, pants, part=leg)
        m.box(x0, 9, 16, x0 + 2, 9, 20, pants_dark, part=leg)
        m.box(x0, 6, 15, x0 + 2, 8, 21, shoe, part=leg)
        m.box(x0, 6, 15, x0 + 2, 6, 21, sole, part=leg)
        m.box(x0, 8, 16, x0 + 2, 8, 20, shoe_dark, part=leg)
        m.pixels(x0, 7, ["www"], {"w": sole}, face="left" if phase == 0 else "right", part=leg)

    # The white tee, with a gold chain and a gold cross.
    m.mask(rounded_box_mask(m, 11, 16, 15, 20, 27, 21, 1.2), tee)
    m.paint_face(m.box_mask(11, 16, 0, 20, 16, 35), tee_shade, face="front")
    m.box(14, 27, 16, 17, 28, 20, skin)  # neck
    m.pixels(11, 22, [
        "g........g",
        ".g......g.",
        ".g......g.",
        "..g....g..",
        "...gggg...",
    ], {"g": gold})
    cross = [
        ".gg.",
        "gggg",
        "gddg",
        ".gg.",
        ".gd.",
        ".dd.",
    ]
    m.pixels(14, 16, cross, {"g": gold, "d": gold_dark}, z=14)

    # Arms out for balance: short white sleeves.
    for x0, phase in ((8, 0), (21, 1)):
        arm = m.limb("Arm", pivot=(x0 + 1.5, 26.5, 18), phase=phase)
        m.box(x0, 23, 16, x0 + 2, 27, 20, tee, part=arm)
        m.box(x0, 23, 16, x0 + 2, 23, 20, tee_shade, part=arm)
        m.box(x0, 17, 17, x0 + 2, 22, 19, skin, part=arm)
        m.box(x0, 15, 16, x0 + 2, 16, 20, skin_light, part=arm)
        m.box(x0, 15, 16, x0 + 2, 15, 20, skin_shade, part=arm)

    # The head: relaxed half-closed eyes, a moustache and a goatee.
    head = m.limb("Head", pivot=(16, 28, 18))
    m.mask(rounded_box_mask(m, 9, 28, 12, 22, 43, 24, 2.2), skin, part=head)
    m.paint_face(m.box_mask(9, 28, 0, 22, 28, 35), skin_shade, face="front")
    for x in (8, 23):
        m.box(x, 31, 17, x, 35, 20, skin, part=head)
        m.box(x, 32, 18, x, 34, 19, skin_shade, part=head)
    face = [
        ".bbbbb..bbbbb.",
        "..............",
        "..dddd..dddd..",
        "..wkkw..wkkw..",
        "..wkhw..whkw..",
        "..............",
        "......nn......",
        "....shhhhs....",
        "s....pppp....s",
        "s.....hh.....s",
        ".s..shhhhs..s.",
    ]
    m.pixels(9, 29, face, {"b": brow, "d": skin_shade, "w": WHITE, "k": iris, "h": beard, "n": skin_shade, "p": lips, "s": stubble})
    m.paint_face(m.box_mask(12, 28, 0, 19, 28, 35), stubble, face="front")
    m.box(15, 34, 11, 16, 35, 11, skin, part=head)  # nose
    m.box(15, 34, 11, 16, 34, 11, skin_shade, part=head)
    # A little chin beard.
    m.box(14, 28, 12, 17, 28, 12, beard, part=head)

    # Curly hair, not too long: a cap covered in curls, a few over his
    # forehead, short over the ears and at the back.
    m.mask(rounded_box_mask(m, 8, 40, 12, 23, 44, 25, 2.5), hair, part=head)
    m.ellipsoid(16, 44, 18.5, 8.8, 2.4, 7.8, hair, part=head)
    m.box(8, 37, 15, 8, 41, 25, hair, part=head)
    m.box(23, 37, 15, 23, 41, 25, hair, part=head)
    m.box(8, 32, 21, 23, 41, 25, hair, part=head)
    m.mask(rounded_box_mask(m, 9, 31, 22, 22, 41, 25, 1.5), hair, part=head)
    curls = []
    # Over the forehead.
    for index, x in enumerate(range(10, 23, 3)):
        curls.append((x + 0.5, 40.6 - (index % 2) * 0.5, 12.2, 1.4))
    # On top, in two rings.
    for index in range(10):
        angle = index / 10 * 6.283
        curls.append((16 + 7.6 * math.cos(angle), 44.2 + (index % 3) * 0.4, 18.5 + 6.6 * math.sin(angle), 1.6))
    for index in range(6):
        angle = index / 6 * 6.283 + 0.5
        curls.append((16 + 3.8 * math.cos(angle), 45.6 + (index % 2) * 0.4, 18.5 + 3.4 * math.sin(angle), 1.5))
    # Over the sides and at the back.
    for y in (38.5, 41):
        for z in (15.5, 19.5, 23.5):
            curls.append((8.3, y, z, 1.2))
            curls.append((23.7, y, z, 1.2))
    for x in range(10, 23, 3):
        for y in (34, 38):
            curls.append((x + 0.5, y, 25.6, 1.3))
    for x, y, z, radius in curls:
        m.sphere(x, y, z, radius, hair, part=head)
    hair_mask = m.box_mask(0, 37, 0, 31, 47, 35) | m.box_mask(0, 31, 21, 31, 47, 35)
    speckle(m, hair_mask & ~m.box_mask(9, 28, 12, 22, 38, 20), [hair_light, hair_dark], seed=11, density=0.12)
