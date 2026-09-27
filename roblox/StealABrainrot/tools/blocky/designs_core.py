"""Block-built brainrots: Noobini Pizzanini and Guesti Guacanini."""

from blocky import design

# Classic Roblox noob colours.
NOOB_YELLOW = "#f5cd30"
NOOB_GREEN = "#a4bd47"
BLACK = "#1b1b1f"
WHITE = "#ffffff"

# The default Roblox smile, 7 wide and 5 tall.
SMILE = [
    ".b...b.",
    ".b...b.",
    ".......",
    "b.....b",
    ".bbbbb.",
]

PEPPERONI = [
    ".rrr.",
    "rrrrr",
    "rrdrr",
    "rrrrr",
    ".rrr.",
]


@design("NoobiniPizzanini", width=26, height=38, depth=14)
def noobini_pizzanini(m):
    cheese, cheese_dark = "#ffc93c", "#f0a51c"
    crust, crust_dark = "#d9913f", "#a9652a"
    sauce, bread = "#d8412f", "#e9b56a"
    pepperoni, pepperoni_dark = "#c62828", "#861818"
    basil = "#2f8f3a"

    # Legs: noob green with little brown shoes, stepping in turn.
    left = m.limb("Leg", pivot=(9.5, 11, 7), phase=0)
    right = m.limb("Leg", pivot=(16.5, 11, 7), phase=1)
    m.box(8, 2, 5, 11, 11, 8, NOOB_GREEN, part=left)
    m.box(15, 2, 5, 18, 11, 8, NOOB_GREEN, part=right)
    m.box(8, 0, 4, 11, 1, 8, "#6b4226", part=left)
    m.box(15, 0, 4, 18, 1, 8, "#6b4226", part=right)

    # The body is a big slice of pizza standing on its tip: tomato sauce down
    # the cut sides, bread on the back.
    bottom, top = 10, 27
    for y in range(bottom, top + 1):
        half = 5 + (y - bottom) / (top - bottom) * 7.5
        x0, x1 = 13 - half, 13 + half - 1
        m.box(x0, y, 4, x1, y, 9, cheese)
        m.box(x0, y, 4, x0, y, 9, sauce)
        m.box(x1, y, 4, x1, y, 9, sauce)
    m.paint_face(m.box_mask(0, bottom, 0, 25, top, 13), bread, face="back")

    # A puffy crust along the top with toasted bits.
    m.box(0, 28, 4, 25, 30, 9, crust)
    m.box(1, 31, 4, 24, 31, 9, crust)
    m.paint_face(m.box_mask(0, 28, 0, 25, 28, 13), crust_dark, face="front")
    for x in (3, 8, 17, 22):
        m.paint_face(m.box_mask(x, 30, 0, x + 1, 30, 13), crust_dark, face="front")
        m.paint_face(m.box_mask(x, 31, 0, x + 1, 31, 13), crust_dark, face="top")

    # Pepperoni, melted cheese drips and basil.
    stamp = {"r": pepperoni, "d": pepperoni_dark}
    m.pixels(4, 21, PEPPERONI, stamp)
    m.pixels(17, 21, PEPPERONI, stamp)
    m.pixels(10, 13, PEPPERONI, stamp)
    m.box(6, 19, 3, 6, 21, 3, cheese_dark)
    m.box(19, 17, 3, 19, 19, 3, cheese_dark)
    m.box(13, 10, 3, 13, 12, 3, cheese_dark)
    m.pixels(12, 23, ["g.", ".g", "g."], {"g": basil})
    m.pixels(20, 14, [".g", "g."], {"g": basil})

    # Yellow noob arms out of the crust's corners.
    left_arm = m.limb("Arm", pivot=(2.5, 28, 6.5), phase=0)
    right_arm = m.limb("Arm", pivot=(23.5, 28, 6.5), phase=1)
    m.box(0, 18, 5, 3, 27, 8, NOOB_YELLOW, part=left_arm)
    m.box(22, 18, 5, 25, 27, 8, NOOB_YELLOW, part=right_arm)

    # The noob head on top of the crust, with the classic smile.
    head = m.limb("Head", pivot=(13, 32, 7))
    m.box(9, 32, 4, 17, 37, 10, NOOB_YELLOW, part=head)
    m.pixels(10, 32, SMILE, {"b": BLACK})


@design("GuestiGuacanini", width=26, height=41, depth=18)
def guesti_guacanini(m):
    skin = "#eac29a"
    shell, flesh, flesh_light = "#2d5a1e", "#a9cf5c", "#d5ec8f"
    pit, pit_light = "#7d4f25", "#a0703d"
    shirt, logo = "#1d1d21", "#f2f2f2"
    pants, shoes = "#5a6470", "#222226"
    cap, cap_brim = "#17171a", "#2a2a30"
    chip, guac = "#f0c75e", "#6fa832"
    blush = "#f08aa0"

    # Guest grey jeans and black sneakers with white soles.
    left = m.limb("Leg", pivot=(10, 11, 10), phase=0)
    right = m.limb("Leg", pivot=(16, 11, 10), phase=1)
    m.box(8, 2, 8, 11, 11, 11, pants, part=left)
    m.box(14, 2, 8, 17, 11, 11, pants, part=right)
    m.box(8, 0, 7, 11, 1, 12, shoes, part=left)
    m.box(14, 0, 7, 17, 1, 12, shoes, part=right)
    m.box(8, 0, 7, 11, 0, 12, logo, part=left)
    m.box(14, 0, 7, 17, 0, 12, logo, part=right)

    # The body is half an avocado, cut side facing forwards: a pear of dark
    # green shell, the flat front showing light flesh around the pit.
    pear = m.ellipsoid_mask(13, 18.5, 10, 9, 8.5, 7) | m.ellipsoid_mask(13, 28, 10, 6.5, 6.5, 6)
    pear &= m.box_mask(0, 11, 4, 25, 34, 17)
    m.mask(pear, shell)
    inner = m.ellipsoid_mask(13, 18.5, 10, 7.8, 7.3, 99) | m.ellipsoid_mask(13, 28, 10, 5.3, 5.3, 99)
    m.paint_face(inner, flesh, face="front")
    m.paint_face(m.ellipsoid_mask(13, 19, 10, 6, 5.5, 99) | m.ellipsoid_mask(13, 27.5, 10, 4, 4, 99), flesh_light, face="front")
    # The pit is the belly, bulging out of the flesh.
    m.ellipsoid(13, 17, 4, 3.8, 3.8, 2.4, pit)
    m.paint(m.ellipsoid_mask(12, 18, 2, 1.5, 1.5, 1), pit_light)

    # Face above the pit: the default Roblox smile and rosy cheeks.
    m.pixels(10, 23, SMILE, {"b": BLACK})
    m.pixels(8, 23, ["p"], {"p": blush})
    m.pixels(18, 23, ["p"], {"p": blush})

    # Guest arms: black tee sleeves and skin hands; one hand holds a chip of guacamole.
    left_arm = m.limb("Arm", pivot=(3.5, 27, 10.5), phase=0)
    right_arm = m.limb("Arm", pivot=(22.5, 27, 10.5), phase=1)
    m.box(1, 22, 9, 4, 27, 12, shirt, part=left_arm)
    m.box(1, 17, 9, 4, 21, 12, skin, part=left_arm)
    m.box(22, 22, 9, 25, 27, 12, shirt, part=right_arm)
    m.box(22, 17, 9, 25, 21, 12, skin, part=right_arm)
    m.box(22, 14, 6, 24, 18, 8, chip, part=right_arm)
    m.box(22, 17, 5, 24, 18, 6, guac, part=right_arm)
    # The black guest tee shows as a collar around the waist of the avocado.
    m.box(6, 11, 6, 20, 12, 15, shirt)

    # The classic guest cap: black crown, brim over the face, white "R" badge.
    head = m.limb("Head", pivot=(13, 34, 10))
    m.box(7, 34, 5, 19, 38, 15, cap, part=head)
    m.box(8, 39, 6, 18, 39, 14, cap, part=head)
    m.box(7, 34, 0, 19, 34, 4, cap_brim, part=head)
    m.voxel(13, 40, 10, cap_brim, part=head)
    m.pixels(11, 35, ["www", "w.w", "ww.", "w.w"], {"w": logo}, z=4, part=head)
