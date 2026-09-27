"""Block-built brainrots, XRE batch: seven Minecraft-style Italian-brainrot mobs.

Nonna Mattarella, Baconini Croccantini, Ospitino Senzanome, Nubbino
Lasagnino, Pizzolino Fantasmino, Espressino Motorino and Spaghettone
Squalone.

The four humanoids use the 64x64 skin layout at one voxel per skin pixel: an
8x8x8 head, an 8x12x4 body and 4x12x4 arms and legs, 32 voxels tall, plus
their extras (a hair bun, curls, a cap, a lasagna sheet, a rolling pin).
"""

import numpy as np

from blocky import design, shade

BLACK = "#16161b"
WHITE = "#f7f7f7"


# -- helpers ------------------------------------------------------------------


def noise(m, seed=0):
    """A fixed pseudo-random value 0..1 for every voxel."""
    ix, iy, iz = np.indices(m.grid.shape).astype(np.int64)
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def grain(m, mask, seed, amount=0.07, share=0.4):
    """The speckled look of a Minecraft skin: some voxels of every colour in
    the mask turn a touch darker or lighter. Parts are left alone."""
    mask = mask & (m.grid > 0)
    n = noise(m, seed)
    jobs = []
    for index in np.unique(m.grid[mask]):
        same = mask & (m.grid == index)
        base = m.palette[index - 1]
        jobs.append((same & (n < share / 2), shade(base, -amount)))
        jobs.append((same & (n > 1 - share / 2), shade(base, amount)))
    for where, colour in jobs:
        m.paint(where, colour)


def art(m, rows, colours, x, y, z, across=(1, 0, 0), part=None):
    """Pixel art on one exact layer. rows[0] is drawn at height y and each row
    runs along `across` from (x, z). It repaints filled voxels, or fills them
    (belonging to `part`) when a part is given, for things that stick out."""
    ax, _, az = across
    for r, row in enumerate(rows):
        for c, char in enumerate(row):
            if char in ". " or char not in colours:
                continue
            vx, vy, vz = x + c * ax, y - r, z + c * az
            if part is not None:
                m.voxel(vx, vy, vz, colours[char], part=part)
            elif m.grid[vx, vy, vz] > 0:
                m.grid[vx, vy, vz] = m.colour(colours[char])


class Rig:
    """The Minecraft player layout at one voxel per skin pixel. (ox, oz) is
    the left arm's left edge and the front of the head; the feet stand on
    y = 0 and the top of the head is y = 31."""

    def __init__(self, m, ox, oz):
        self.m, self.ox, self.oz = m, ox, oz
        self.head = (ox + 4, 24, oz, ox + 11, 31, oz + 7)
        self.body = (ox + 4, 12, oz + 2, ox + 11, 23, oz + 5)
        self.arms = ((ox, 12, oz + 2, ox + 3, 23, oz + 5), (ox + 12, 12, oz + 2, ox + 15, 23, oz + 5))
        self.legs = ((ox + 4, 0, oz + 2, ox + 7, 11, oz + 5), (ox + 8, 0, oz + 2, ox + 11, 11, oz + 5))

    def limbs(self):
        """Legs swing at the hips, arms at the shoulders, the head at the neck."""
        m, ox, oz = self.m, self.ox, self.oz
        legs = (m.limb("Leg", pivot=(ox + 6, 12, oz + 4), phase=0), m.limb("Leg", pivot=(ox + 10, 12, oz + 4), phase=1))
        arms = (m.limb("Arm", pivot=(ox + 2, 24, oz + 4), phase=0), m.limb("Arm", pivot=(ox + 14, 24, oz + 4), phase=1))
        head = m.limb("Head", pivot=(ox + 8, 24, oz + 4))
        return legs, arms, head

    def mask(self, box, y0=None, y1=None):
        x0, b0, z0, x1, b1, z1 = box
        return self.m.box_mask(x0, b0 if y0 is None else y0, z0, x1, b1 if y1 is None else y1, z1)

    def fill(self, box, colour, part=0, y0=None, y1=None):
        x0, b0, z0, x1, b1, z1 = box
        self.m.box(x0, b0 if y0 is None else y0, z0, x1, b1 if y1 is None else y1, z1, colour, part=part)

    def face(self, rows, colours, top=31):
        """8-wide pixel art on the front of the head, rows[0] at y = top."""
        art(self.m, rows, colours, self.ox + 4, top, self.oz)

    def chest(self, rows, colours, x=0, top=23, z=None):
        """Pixel art on the front of the body, column x counted from its left."""
        art(self.m, rows, colours, self.ox + 4 + x, top, self.oz + 2 if z is None else z)


# -- 1. Nonna Mattarella -------------------------------------------------------


@design("NonnaMattarella", width=18, height=35, depth=8)
def nonna_mattarella(m):
    skin, skin_shade = "#ebcfb9", "#d3ae96"
    hair, hair_light, hair_dark = "#a9a9ad", "#d2d2d5", "#88888e"
    brow, red_eye, mouth, tongue = "#66666e", "#c8141c", "#4a1a1a", "#8e2a2a"
    shawl, shawl_dark, lace = "#4d4053", "#3a3040", "#d6ccd4"
    dress, dress_dark = "#211e25", "#131116"
    apron, apron_dark, dot = "#a71d25", "#76131a", "#f5f0e8"
    stocking, shoe = "#3b3941", "#141316"
    wood, wood_dark, knob = "#d2a36c", "#b0824e", "#6b4323"
    ox, oz = 2, 0
    rig = Rig(m, ox, oz)
    (leg_l, leg_r), (arm_l, arm_r), head = rig.limbs()

    # The long black skirt is the body; the legs swing inside it and show
    # their stockings and shoes below the hem.
    m.box(ox + 3, 4, oz + 1, ox + 12, 12, oz + 6, dress)
    m.box(ox + 3, 4, oz + 1, ox + 12, 4, oz + 6, dress_dark)
    rig.fill(rig.body, dress, y0=13)
    # A purple-grey shawl round the shoulders, its ends hanging down the front.
    rig.fill(rig.body, shawl, y0=19)
    m.box(ox + 4, 16, oz + 2, ox + 5, 18, oz + 2, shawl)
    m.box(ox + 10, 16, oz + 2, ox + 11, 18, oz + 2, shawl)

    for leg in (leg_l, leg_r):
        box = rig.legs[leg - leg_l]
        rig.fill(box, stocking, part=leg)
        rig.fill(box, shoe, part=leg, y1=1)

    # Shawl sleeves with a dark cuff and pale old hands.
    for arm, box in zip((arm_l, arm_r), rig.arms):
        rig.fill(box, shawl, part=arm)
        rig.fill(box, shawl_dark, part=arm, y0=14, y1=14)
        rig.fill(box, skin, part=arm, y1=13)

    # The mattarello: a wooden rolling pin held across the front in the left hand.
    m.box(ox - 2, 13, oz, ox - 1, 14, oz + 1, knob, part=arm_l)
    m.box(ox, 13, oz, ox + 9, 14, oz + 1, wood, part=arm_l)
    m.box(ox + 10, 13, oz, ox + 11, 14, oz + 1, knob, part=arm_l)

    # So nothing swings through her: only the stockings below the hem step
    # (turning about the hem), and the hand with the rolling pin stays put
    # while the other arm swings.
    for leg in (leg_l, leg_r):
        inside = (m.part == leg) & m.box_mask(0, 5, 0, m.width - 1, m.height - 1, m.depth - 1)
        m.assign(inside, 0)
        m.paint(inside, dress)
        limb = m.limbs[leg - 1]
        limb.pivot = (limb.pivot[0], 5, limb.pivot[2])
    m.assign(m.part == arm_l, 0)

    # Head: grey hair over the top, sides and back, a bun on top.
    rig.fill(rig.head, skin, part=head)
    hx0, _, hz0, hx1, _, _ = rig.head
    hair_mask = rig.mask(rig.head) & ~m.box_mask(hx0, 24, hz0, hx1, 29, hz0) & ~m.box_mask(hx0, 24, hz0, hx1, 27, hz0 + 3)
    m.paint(hair_mask, hair)
    m.box(ox + 6, 32, oz + 3, ox + 9, 34, oz + 6, hair_light, part=head)
    m.box(ox + 6, 32, oz + 3, ox + 9, 32, oz + 6, hair)
    for x in (ox + 6, ox + 9):
        for z in (oz + 3, oz + 6):
            m.clear(m.box_mask(x, 34, z, x, 34, z))

    grain(m, m.grid > 0, seed=11, amount=0.08)
    n = noise(m, 12)
    m.paint(hair_mask & (n > 0.82), hair_light)
    m.paint(hair_mask & (n < 0.14), hair_dark)

    # The apron: a red bib under the shawl, a dark waistband and a long red
    # front with white dots along the hem.
    rig.chest(["aaaa"] * 5, {"a": apron}, x=2, top=18)
    rig.chest(["l.ll.l"], {"l": lace}, x=1, top=23)
    m.paint(m.box_mask(ox + 3, 12, oz + 1, ox + 12, 12, oz + 6), apron_dark)
    bow = ["aakkaa", "aakkaa", ".a..a.", ".a..a.", "a....a"]
    art(m, bow, {"a": apron, "k": apron_dark}, ox + 5, 12, oz + 7, part=0)
    art(m, ["aaaaaaaa"] * 6 + ["wawaawaw"], {"a": apron, "w": dot}, ox + 4, 11, oz + 1)
    # Wood grain on the pin.
    art(m, ["ww.ww.ww.w"], {"w": wood_dark}, ox, 13, oz)

    face = [
        "hhhhhhhh",
        "hhhhhhhh",
        "hbbssbbh",
        "swrbbrws",
        "skssssks",
        "ssmmmmss",
        "ssmttmss",
        "ssssssss",
    ]
    rig.face(face, {"h": hair, "b": brow, "s": skin, "w": WHITE, "r": red_eye, "k": skin_shade, "m": mouth, "t": tongue})


# -- 2. Baconini Croccantini -----------------------------------------------------


@design("BaconiniCroccantini", width=16, height=35, depth=9)
def baconini_croccantini(m):
    skin = "#e9ba90"
    shirt, shirt_dark = "#d8452b", "#ad321f"
    jeans, shoe = "#2b5c7f", "#3a281b"
    bacon = ("#761b16", "#b3342a", "#cf5642", "#eba393")
    blush, lip, tongue = "#e98c83", "#6a1616", "#d65a55"
    crust, cheese, pepperoni = "#b8753a", "#f2dc8c", "#c9241e"
    ox, oz = 0, 0
    rig = Rig(m, ox, oz)
    (leg_l, leg_r), (arm_l, arm_r), head = rig.limbs()

    rig.fill(rig.body, shirt)
    rig.fill(rig.body, shirt_dark, y1=12)
    for leg, box in zip((leg_l, leg_r), rig.legs):
        rig.fill(box, jeans, part=leg)
        rig.fill(box, shoe, part=leg, y1=2)
    for arm, box in zip((arm_l, arm_r), rig.arms):
        rig.fill(box, skin, part=arm)
        rig.fill(box, shirt, part=arm, y0=20)

    # The head wears a mop of curly bacon hair one voxel bigger than the head.
    rig.fill(rig.head, skin, part=head)
    shell = m.box_mask(ox + 3, 26, oz, ox + 12, 32, oz + 8) & ~rig.mask(rig.head)
    n = noise(m, 21)
    curls = m.box_mask(ox + 3, 33, oz, ox + 12, 33, oz + 8) & (n > 0.5)
    curls |= m.box_mask(ox + 5, 33, oz, ox + 9, 34, oz + 2) & (n > 0.25)
    hair = shell | curls | m.box_mask(ox + 4, 30, oz, ox + 11, 31, oz)
    m.mask(hair, bacon[1], part=head)
    grain(m, m.grid > 0, seed=22, amount=0.07)
    n = noise(m, 23)
    m.paint(hair & (n < 0.28), bacon[0])
    m.paint(hair & (n > 0.62) & (n < 0.84), bacon[2])
    m.paint(hair & (n >= 0.84), bacon[3])

    face = [
        "hhhhhhhh",
        "hhhhhhhh",
        "hwksswkh",
        "skksskks",
        "pkksskkp",
        "ssssssss",
        "ssdttdss",
        "sssddsss",
    ]
    rig.face(face, {"h": bacon[1], "w": WHITE, "k": BLACK, "s": skin, "p": blush, "d": lip, "t": tongue})
    art(m, ["h", "d"], {"h": bacon[0], "d": bacon[2]}, ox + 4, 29, oz)

    # A little pizza slice printed on the tee.
    logo = ["ccc", "hph", "hhp", ".h.", ".h."]
    rig.chest(logo, {"c": crust, "h": cheese, "p": pepperoni}, x=3, top=20)


# -- 3. Ospitino Senzanome --------------------------------------------------------


@design("OspitinoSenzanome", width=16, height=35, depth=13)
def ospitino_senzanome(m):
    face_colour = "#dcd9d1"
    shirt, shirt_shade, button = "#cdd0d5", "#b6b9bf", "#3c3f47"
    pants, shoe = "#212126", "#131316"
    cap, brim, badge = "#1c1c21", "#2c2c33", "#ededed"
    green, white, red = "#1c9a45", "#f2f2ef", "#d1262d"
    ox, oz = 0, 4
    rig = Rig(m, ox, oz)
    (leg_l, leg_r), (arm_l, arm_r), head = rig.limbs()

    rig.fill(rig.body, shirt)
    for leg, box in zip((leg_l, leg_r), rig.legs):
        rig.fill(box, pants, part=leg)
        rig.fill(box, shoe, part=leg, y1=1)
    for arm, box in zip((arm_l, arm_r), rig.arms):
        rig.fill(box, face_colour, part=arm)
        rig.fill(box, shirt, part=arm, y0=19)

    # The guest cap: a black crown a size bigger than the head, a brim out
    # front and a white badge.
    rig.fill(rig.head, face_colour, part=head)
    m.box(ox + 3, 31, oz - 1, ox + 12, 33, oz + 8, cap, part=head)
    m.box(ox + 4, 34, oz, ox + 11, 34, oz + 7, cap, part=head)
    m.box(ox + 3, 31, 0, ox + 12, 31, oz - 2, brim, part=head)
    m.clear(m.box_mask(ox + 3, 31, 0, ox + 3, 31, 0) | m.box_mask(ox + 12, 31, 0, ox + 12, 31, 0))

    # The Italian-flag scarf round the collar and a tie, both standing out
    # from the shirt.
    m.box(ox + 4, 22, oz + 1, ox + 11, 23, oz + 1, white)
    m.box(ox + 9, 16, oz + 1, ox + 10, 21, oz + 1, white)
    m.voxel(ox + 9, 15, oz + 1, red)

    grain(m, m.grid > 0, seed=31, amount=0.06)

    art(m, ["gggwwrrr", "gggwwrrr"], {"g": green, "w": white, "r": red}, ox + 4, 23, oz + 1)
    art(m, ["gg", "gg", "ww", "ww", "rr", "rr", "r."], {"g": green, "w": white, "r": red}, ox + 9, 21, oz + 1)
    art(m, ["bbbb", "bbbb"], {"b": badge}, ox + 6, 33, oz - 1)
    art(m, ["....", ".bb."], {"b": "#9a9aa2"}, ox + 6, 33, oz - 1)
    rig.chest(["..b..", "..b..", ".....", ".....", "....b", "....b", ".....", "....b"], {"b": button}, top=20)
    rig.chest(["s......s"], {"s": shirt_shade}, top=12)

    face = [
        "ssssssss",
        "ssksskss",
        "ssksskss",
        "ssssssss",
        "ssssssss",
        "ssssssss",
        "ssssssss",
    ]
    rig.face(face, {"s": face_colour, "k": BLACK}, top=30)


# -- 4. Nubbino Lasagnino --------------------------------------------------------


@design("NubbinoLasagnino", width=16, height=34, depth=10)
def nubbino_lasagnino(m):
    yellow = "#ecc24e"
    sauce, cheese = "#b8291f", "#efe8d8"
    green, green_dark = "#4c8f3a", "#2e5f27"
    noodle, noodle_edge, sauce_bit = "#f4e396", "#e4ca6e", "#e39d45"
    basil, basil_dark = "#2f9a3a", "#1f6e28"
    lip, tongue = "#6a1616", "#d65a55"
    ox, oz = 0, 1
    rig = Rig(m, ox, oz)
    (leg_l, leg_r), (arm_l, arm_r), head = rig.limbs()

    # A noob body layered like a lasagna: sauce and cheese stripes all round.
    rig.fill(rig.body, yellow)
    for y0, y1, colour in ((19, 20, sauce), (18, 18, cheese), (14, 15, sauce), (13, 13, cheese)):
        rig.fill(rig.body, colour, y0=y0, y1=y1)
    for leg, box in zip((leg_l, leg_r), rig.legs):
        rig.fill(box, green, part=leg)
        rig.fill(box, green_dark, part=leg, y1=1)
    for arm, box in zip((arm_l, arm_r), rig.arms):
        rig.fill(box, yellow, part=arm)

    # The noob head with a sheet of lasagna for hair: it overhangs the head
    # and its ruffled edge hangs down all round.
    rig.fill(rig.head, yellow, part=head)
    m.box(ox + 3, 32, oz - 1, ox + 12, 32, oz + 8, noodle, part=head)
    ix, _, iz = np.indices(m.grid.shape)
    rim = m.box_mask(ox + 3, 31, oz - 1, ox + 12, 31, oz + 8) & ~rig.mask(rig.head)
    ruffle = rim & ((ix + iz) % 2 == 0)
    m.mask(ruffle, noodle_edge, part=head)
    m.box(ox + 8, 29, oz - 1, ox + 8, 30, oz - 1, noodle_edge, part=head)
    m.box(ox + 3, 29, oz + 2, ox + 3, 30, oz + 2, noodle_edge, part=head)
    m.box(ox + 12, 29, oz + 5, ox + 12, 30, oz + 5, noodle_edge, part=head)
    m.box(ox + 7, 33, oz + 1, ox + 8, 33, oz + 2, basil, part=head)
    m.voxel(ox + 9, 33, oz + 2, basil_dark, part=head)

    grain(m, m.grid > 0, seed=41, amount=0.07)

    face = [
        "oyoyyoyo",
        "ywkyywky",
        "ykkyykky",
        "ykkyykky",
        "ykkyykky",
        "yyyyyyyy",
        "yydttdyy",
        "yyyyyyyy",
    ]
    rig.face(face, {"o": sauce_bit, "y": yellow, "w": WHITE, "k": BLACK, "d": lip, "t": tongue})


# -- 5. Pizzolino Fantasmino ------------------------------------------------------


@design("PizzolinoFantasmino", width=24, height=33, depth=6)
def pizzolino_fantasmino(m):
    cheese, cheese_dark, cheese_light = "#f2c94c", "#dba73a", "#f8dc78"
    crust, crust_dark = "#bf7d3e", "#8f5626"
    bread = "#e0ad6c"
    pepperoni, pepperoni_dark, orange = "#c62f28", "#8d1d19", "#e8772b"
    ghost, ghost_shade, ghost_deep = "#eff1f9", "#d5d8ec", "#bcc0dc"
    mouth = "#4a1212"
    cx = 12

    # The slice stands on its point: each step of three rows a voxel narrower.
    for y in range(7, 29):
        half = 1 if y == 7 else 8 - (28 - y) // 3
        m.box(cx - half, y, 1, cx + half - 1, y, 4, cheese)
        m.box(cx - half, y, 1, cx - half, y, 4, cheese_dark)
        m.box(cx + half - 1, y, 1, cx + half - 1, y, 4, cheese_dark)
    m.paint_face(m.box_mask(0, 7, 0, 23, 28, 5), bread, face="back")

    # The crust along the top.
    m.box(2, 29, 0, 21, 32, 5, crust)
    m.box(2, 29, 0, 21, 29, 5, crust_dark)

    # A pepperoni on the top right corner and a drip of cheese.
    m.box(17, 24, 0, 18, 27, 0, pepperoni)
    m.box(16, 25, 0, 16, 26, 0, pepperoni)
    m.box(7, 25, 0, 7, 27, 0, cheese_light)

    # Little ghost arms sticking out of the sides.
    arm_l = m.limb("Arm", pivot=(6, 22, 3), phase=0)
    arm_r = m.limb("Arm", pivot=(18, 22, 3), phase=1)
    for part, steps in ((arm_l, (4, 2, 0)), (arm_r, (18, 20, 22))):
        for i, x in enumerate(steps):
            m.box(x, 20 - i, 2, x + 1, 22 - i, 3, ghost if i < 2 else ghost_shade, part=part)

    # The wispy ghost tail it floats on, curling to one side.
    tail = m.limb("Tail", pivot=(cx, 7, 3))
    m.box(9, 5, 1, 14, 6, 4, ghost, part=tail)
    m.box(10, 3, 1, 14, 4, 4, ghost_shade, part=tail)
    m.box(12, 1, 2, 14, 2, 3, ghost_shade, part=tail)
    m.box(14, 0, 2, 15, 0, 3, ghost_deep, part=tail)

    grain(m, m.grid > 0, seed=51, amount=0.08)
    grain(m, m.box_mask(0, 29, 0, 23, 32, 5), seed=52, amount=0.14, share=0.5)

    face = [
        "wkk..wkk",
        "kkk..kkk",
        "kkk..kkk",
        "...mm...",
        "...mm...",
    ]
    art(m, face, {"w": WHITE, "k": BLACK, "m": mouth}, 8, 25, 1)
    art(m, ["pp", "pd", "pp", "pp"], {"p": pepperoni, "d": pepperoni_dark}, 17, 27, 0)
    for x, y, colour in ((9, 17, pepperoni), (10, 17, pepperoni), (9, 16, pepperoni_dark), (14, 19, orange),
                         (12, 13, orange), (11, 10, pepperoni), (15, 15, pepperoni), (7, 20, orange)):
        art(m, ["c"], {"c": colour}, x, y, 1)


# -- 6. Espressino Motorino ---------------------------------------------------------


@design("EspressinoMotorino", width=16, height=34, depth=26)
def espressino_motorino(m):
    red, red_dark = "#d42a24", "#a51d18"
    trim = "#b8b8bd"
    tyre, hub, hub_dark = "#1d1d21", "#8a8a92", "#55555c"
    lamp, lamp_light = "#f0d860", "#fff4a8"
    grip, taillight = "#19191d", "#7e1010"
    cup, rim = "#f0efe9", "#ffffff"
    band, coffee, crema = "#b8844a", "#4e2a16", "#a8733e"
    steam, steam_light = "#dadbe0", "#f3f3f6"
    eye, mouth, tongue, cheek = "#1a1a26", "#5a1a14", "#c4524a", "#efc2b0"
    _, ys, zs = m._centres

    # The scooter: a chunky rear body under the seat, the floorboard, the leg
    # shield and front fender, the headset and handlebar.
    m.box(3, 5, 11, 12, 12, 24, red)
    m.box(4, 6, 25, 11, 11, 25, red)
    m.box(5, 5, 7, 10, 6, 10, red_dark)
    fender = (np.hypot(ys - 3.5, zs - 4.5) <= 4.8) & (np.hypot(ys - 3.5, zs - 4.5) > 3.8) & (ys > 3.5)
    m.mask(fender & m.box_mask(5, 0, 0, 10, 20, 12), red)
    m.box(5, 7, 5, 10, 13, 7, red)
    m.box(6, 14, 5, 9, 15, 7, red)
    m.box(3, 16, 6, 12, 16, 6, trim)
    m.box(0, 16, 6, 2, 17, 7, grip)
    m.box(13, 16, 6, 15, 17, 7, grip)
    m.box(6, 12, 4, 9, 13, 4, lamp)
    m.box(7, 12, 4, 8, 13, 4, lamp_light)
    m.box(6, 9, 25, 9, 10, 25, taillight)
    # The saucer is the seat.
    m.box(2, 13, 10, 13, 13, 21, trim)

    # Black wheels that roll.
    for zc in (4.5, 21.5):
        wheel = m.limb("Prop", pivot=(8, 3.5, zc), axis="X")
        m.mask(m.cylinder_mask(6, 3.5, zc, 3.6, 4, axis="X"), tyre, part=wheel)
        m.paint(m.box_mask(6, 2, zc - 1.5, 9, 4, zc + 0.5), hub)
        m.paint(m.box_mask(6, 3, zc - 0.5, 9, 3, zc - 0.5), hub_dark)

    # The rider: an espresso cup with a face, coffee inside and steam rising.
    # It nods about its base like a head.
    head = m.limb("Head", pivot=(8, 14, 16))
    m.box(3, 14, 11, 12, 25, 20, cup, part=head)
    m.clear(m.box_mask(4, 25, 12, 11, 25, 19))
    m.paint(m.box_mask(4, 24, 12, 11, 24, 19), crema)
    m.paint(m.box_mask(5, 24, 13, 10, 24, 18), coffee)
    m.box(13, 17, 15, 14, 17, 16, cup, part=head)
    m.box(14, 17, 15, 14, 21, 16, cup, part=head)
    m.box(13, 21, 15, 14, 21, 16, cup, part=head)
    m.box(7, 25, 15, 8, 27, 16, steam, part=head)
    m.box(8, 28, 15, 9, 30, 16, steam_light, part=head)
    m.box(9, 31, 15, 9, 32, 15, steam_light, part=head)

    grain(m, m.grid > 0, seed=61, amount=0.06)
    m.paint(m.box_mask(3, 15, 11, 12, 15, 20), band)
    m.paint(m.box_mask(3, 25, 11, 12, 25, 20), rim)
    m.paint(m.box_mask(3, 6, 11, 3, 6, 24) | m.box_mask(12, 6, 11, 12, 6, 24), trim)

    face = [
        "..kk..kk..",
        "..kk..kk..",
        "..kk..kk..",
        ".c......c.",
        "...dddd...",
        "...dttd...",
    ]
    art(m, face, {"k": eye, "c": cheek, "d": mouth, "t": tongue}, 3, 23, 11)


# -- 7. Spaghettone Squalone ---------------------------------------------------------


@design("SpaghettoneSqualone", width=26, height=24, depth=44)
def spaghettone_squalone(m):
    pasta = ("#e6bf6c", "#d0a553", "#bb8e42", "#9f7634")
    edge = "#f4d284"
    gum, maw, tooth = "#8e1b1b", "#5a0f0f", "#f7f4ec"
    snout = "#8f452b"
    meat, meat_dark = "#6d3521", "#4a2214"
    basil = "#3f9a3a"
    cx = 13
    xs, ys, zs = m._centres
    ix, iy, iz = np.indices(m.grid.shape)

    # A blocky shark swimming forwards (z = 0 is the snout).
    head_box = m.box_mask(7, 6, 0, 18, 15, 10)
    body = head_box | m.box_mask(6, 5, 11, 19, 16, 24) | m.box_mask(8, 7, 25, 17, 15, 32)
    m.mask(body, pasta[1])
    # Dorsal fin leaning back and a small fin underneath.
    for y in range(17, 23):
        t = (y - 17) / 5
        x0, x1 = (11, 14) if y < 20 else (12, 13)
        m.box(x0, y, int(round(13 + 7 * t)), x1, y, int(round(21 + 1 * t)), pasta[1])
    m.box(12, 4, 27, 13, 6, 30, pasta[1])

    # The tail: a stalk and a forked fin that wag.
    tail = m.limb("Tail", pivot=(cx, 11.5, 33))
    m.box(10, 9, 33, 15, 13, 36, pasta[1], part=tail)
    fin = m.box_mask(12, 0, 36, 13, m.height - 1, m.depth - 1)
    lobes = np.zeros(m.grid.shape, dtype=bool)
    for a, b, r in (((cx, 12.5, 36.5), (cx, 21, 41.5), 1.7), ((cx, 10, 36.5), (cx, 3.5, 41), 1.6)):
        p = np.stack([xs, ys, zs], axis=-1)
        a, b = np.array(a), np.array(b)
        ab = b - a
        t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
        lobes |= np.linalg.norm(p - (a + t[..., None] * ab), axis=-1) <= r
    m.mask(fin & (lobes | m.box_mask(12, 8, 36, 13, 14, 38)), pasta[1], part=tail)

    # Spaghetti strands: thin wavy stripes running along the body.
    wave = np.round(1.2 * np.sin(zs * 0.55)).astype(int)
    band = (ix + iy + wave) % 4
    filled = m.grid > 0
    for k, colour in enumerate((pasta[0], pasta[1], pasta[0], pasta[2])):
        m.paint(filled & (band == k), colour)
    n = noise(m, 71)
    m.paint(filled & (n < 0.08), pasta[3])
    m.paint(filled & (n > 0.93), edge)
    m.paint(head_box & (band % 2 == 0), shade(pasta[0], 0.12))

    # Pectoral fins stick out low on the sides and flap.
    for phase, sign, px in ((0, -1, 6), (1, 1, 20)):
        wing = m.limb("Wing", pivot=(px, 6.5, 15), phase=phase)
        for i in range(6):
            x = 5 - i if sign < 0 else 20 + i
            top = 7 - int(round(i * 0.45))
            bottom = top - (1 if i < 4 else 0)
            z0, z1 = 12 + int(i * 1.2), 18 + int(i * 0.4)
            m.box(x, bottom, z0, x, top, z1, pasta[1], part=wing)
            m.paint(m.box_mask(x, bottom, z0, x, top, z0), edge)
        m.paint((m.part == wing) & (band == 3), pasta[2])
    # Light edges on the fins.
    m.paint(m.box_mask(11, 22, 0, 14, 22, m.depth - 1), edge)
    m.paint(m.box_mask(0, 0, 41, m.width - 1, m.height - 1, m.depth - 1) & (m.part == tail), edge)

    # The open mouth full of teeth, round the front and both sides: gums
    # top and bottom, a dark maw behind and alternating upper and lower teeth.
    zone = m.box_mask(7, 9, 0, 18, 12, 7)
    outer = zone & ((iz == 0) | (ix == 7) | (ix == 18))
    m.paint(outer, gum)
    m.paint(m.box_mask(8, 10, 1, 17, 11, 8), maw)
    along = np.where(iz == 0, ix, iz + 20)
    upper = outer & (iy == 11) & (along % 2 == 0)
    lower = outer & (iy == 10) & (along % 2 == 1)
    m.clear(outer & ((iy == 10) | (iy == 11)) & ~upper & ~lower)
    m.paint(upper | lower, tooth)
    # A saucy snout tip.
    m.paint(m.box_mask(7, 13, 0, 18, 15, 0), snout)

    # Meatball eyes on the sides of the head, with a dark pupil and a shine.
    for x0, x1, outer_x in ((5, 6, 5), (19, 20, 20)):
        m.box(x0, 12, 7, x1, 14, 9, meat)
        m.paint(m.box_mask(x0, 12, 7, x1, 12, 9) | m.box_mask(outer_x, 14, 9, outer_x, 14, 9), meat_dark)
        m.box(outer_x, 13, 8, outer_x, 13, 8, BLACK)
        m.box(outer_x, 13, 7, outer_x, 13, 7, WHITE)
        m.box(x0, 13, 7, x1, 13, 7, BLACK)
        m.box(outer_x, 13, 7, outer_x, 13, 7, WHITE)
    # A basil leaf on top.
    m.box(12, 16, 7, 13, 16, 9, basil)
