"""Texture atlas layouts (UV units; every atlas is 1024 x 1024).

Region kinds (5th tuple element):
  "sleeve"  cylindrical unwrap of a lofted body part: 8 equal facet columns
            around the part (col 0 = ventral, 2 = one flank, 4 = dorsal,
            6 = other flank), rows run along the part (top = far end).
  "fit"     every face shows the whole region (eyes, teeth).
  "vfit"    full height, random column: base->tip gradient strips (plates).
  (none)    generic tiling patch sampled at random offsets.
"""
SIZE = (1024, 1024)

# 4th form (and the 3rd, which shares the rig)
REGIONS = {
    "trunk": (0, 0, 320, 288, "sleeve"),
    "thigh": (320, 0, 288, 104, "sleeve"),
    "shin": (320, 104, 176, 64, "sleeve"),
    "foot": (496, 104, 112, 48, "sleeve"),
    "skull": (608, 0, 104, 56, "sleeve"),
    "tail": (768, 0, 256, 672, "sleeve"),
    "skin": (0, 288, 192, 192),
    "skin2": (192, 288, 128, 128),
    "belly": (192, 416, 128, 64),
    "head": (320, 168, 128, 64),
    "fissure": (448, 168, 128, 96),
    "ridge": (576, 168, 128, 64),
    "bone": (320, 232, 64, 64),
    "gum": (384, 232, 64, 32),
    "mouth": (384, 264, 64, 32),
    "claw": (608, 56, 32, 32),
    "tooth": (640, 56, 16, 48, "fit"),
    "eye": (656, 56, 16, 16, "fit"),
    "eye_big": (672, 56, 32, 32, "fit"),
    "plate": (0, 480, 96, 160, "vfit"),
    "plate_web": (96, 480, 96, 96, "vfit"),
    "plate_tip": (96, 576, 96, 64, "vfit"),
    "plate_base": (192, 480, 128, 64),
    "gill": (192, 544, 128, 64),
}

# 2nd form ("Kamata-kun")
REGIONS2 = {
    "body": (0, 0, 352, 400, "sleeve"),
    "tail": (352, 0, 264, 464, "sleeve"),
    "thigh": (616, 0, 200, 96, "sleeve"),
    "skull": (616, 96, 152, 80, "sleeve"),
    "skin": (816, 0, 192, 192),
    "skin2": (616, 176, 128, 128),
    "belly": (744, 192, 128, 128),
    "head": (872, 192, 128, 64),
    "ridge": (872, 256, 128, 64),
    "fissure": (616, 304, 128, 64),
    "gum": (744, 320, 64, 32),
    "mouth": (808, 320, 64, 32),
    "claw": (872, 320, 32, 32),
    "tooth": (904, 320, 16, 48, "fit"),
    "eye": (920, 320, 16, 16, "fit"),
    "eye_big": (936, 320, 64, 64, "fit"),
    "plate": (0, 400, 96, 160, "vfit"),
    "plate_web": (96, 400, 96, 96, "vfit"),
    "plate_tip": (96, 496, 96, 64, "vfit"),
    "plate_base": (192, 400, 128, 64),
    "gill": (192, 464, 128, 96, "vfit"),
    "bone": (616, 368, 64, 64),
}


def _check(regs):
    items = list(regs.items())
    for i, (n1, r1) in enumerate(items):
        assert r1[0] + r1[2] <= SIZE[0] and r1[1] + r1[3] <= SIZE[1], n1
        for n2, r2 in items[i + 1:]:
            if r1[0] < r2[0] + r2[2] and r2[0] < r1[0] + r1[2] and r1[1] < r2[1] + r2[3] and r2[1] < r1[1] + r1[3]:
                raise AssertionError("atlas overlap: %s / %s" % (n1, n2))


_check(REGIONS)
_check(REGIONS2)
