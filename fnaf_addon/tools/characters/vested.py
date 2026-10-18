"""Three animatronics in vests, from front-view reference pictures:

  rustgrin   grey bear: rust-flecked grey fur, red top hat with a black band, round ears with a
             dark ring, red eyes, red vest with four square black buttons, red bow tie, pale grey
             belly and freckled muzzle, bare endoskeleton fingers
  mirehop    green bunny: mossy green fur with dark patches, one ear standing up and the other
             folded over at its joint, red eyes, brown vest with four square buttons, black bow
             tie, tan belly and freckled muzzle, mitten hands, pale soles
  noxbriar   black bear: sooty black-brown fur with rusty patches, black top hat, round ears with
             a grey centre, red eyes with black tear streaks down the muzzle, purple vest with
             pocket flaps, purple bow tie, two round black buttons on a pale belly, endo fingers

The pictures come from the same series as fred3.py's three and are built on its parts and its
scale (26 picture pixels = 1 model pixel): each part is written in picture pixels, the
character's right is the left half of a picture, and depths follow the widths.  This module
registers its measurements with fred3 and adds what those three don't have: the vests, a hat
band and this bunny's ears.

Animations are in vested_anims.py.
"""
import os

from characters import fred3
from characters.body import COMMON, ENDO, vox
from characters.fred3 import Pic, panel_painter, rbox
from fnafkit import export, rig
from fnafkit.rig import bone, cube

HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = ("rustgrin", "mirehop", "noxbriar")

# --------------------------------------------------------------------------
# Colours (read off each picture's lit side)
# --------------------------------------------------------------------------


def _fur(tones, dark, rust=None):
    m = vox(*tones, w=[3, 3, 3, 2, 1, 1], patches=[(0.9, 0.86, dark)], cell=0.5, bevel=0.0)
    m["spots"] = [(tuple(int(c * 0.8) for c in dark[0]), 0.03), (tuple(int(c * 0.55) for c in dark[0]), 0.012)]
    if rust:
        m["spots"].append((rust, 0.02))
    return m


def _flat(*tones, w=None):
    return vox(*tones, w=w, cell=0.77)


MATERIALS = {
    "rustgrin": {
        **COMMON,
        "fur": _fur([(112, 112, 110), (98, 98, 97), (126, 125, 122), (86, 86, 86), (140, 138, 134), (72, 72, 72)],
                    [(62, 60, 58), (54, 52, 50)], rust=(104, 66, 42)),
        "fur_dark": _flat((70, 70, 70), (60, 60, 60), (80, 80, 80)),
        "mask": _flat((140, 138, 134), (128, 126, 122), (152, 150, 146)),
        "belly": _flat((176, 172, 166), (160, 156, 150), (190, 186, 180), (146, 142, 136), w=[3, 3, 2, 1]),
        "muzzle": _flat((192, 186, 176), (178, 172, 162), (204, 198, 188), (164, 158, 150), w=[3, 3, 2, 1]),
        "ear_ring": _flat((66, 66, 66), (56, 56, 56), (76, 76, 76)),
        "ear_inner": _flat((172, 166, 158), (160, 154, 146), (184, 178, 170)),
        "vest": _flat((152, 26, 28), (134, 20, 23), (168, 34, 36), (116, 16, 19), w=[3, 3, 2, 1]),
        "vest_edge": _flat((104, 14, 17), (92, 12, 15), (116, 18, 20)),
        "red": _flat((158, 28, 30), (140, 22, 25), (172, 36, 38)),
        "hat": _flat((150, 24, 26), (132, 19, 22), (166, 32, 34), (116, 15, 18), w=[3, 3, 2, 1]),
        "hat_band": _flat((24, 20, 20), (32, 28, 28), (18, 15, 15)),
        "sole": _flat((70, 66, 64), (60, 56, 54), (80, 76, 74)),
        "teeth": vox((210, 204, 186), (194, 188, 170), (222, 216, 200), cell=0.5, bevel=0.2),
        "endo": ENDO,
    },
    "mirehop": {
        **COMMON,
        "fur": _fur([(80, 100, 44), (68, 88, 38), (92, 114, 52), (58, 76, 32), (104, 126, 60), (50, 66, 28)],
                    [(42, 54, 24), (36, 46, 20)], rust=(90, 62, 34)),
        "fur_dark": _flat((54, 70, 30), (46, 60, 26), (62, 80, 34)),
        "mask": _flat((108, 124, 66), (96, 112, 58), (120, 136, 76)),
        "belly": vox((164, 154, 108), (150, 140, 96), (178, 168, 120), (136, 126, 86), w=[3, 3, 2, 1],
                     patches=[(1.1, 0.8, [(96, 112, 56), (86, 102, 50)])], cell=0.5, bevel=0.0),
        "muzzle": _flat((178, 166, 122), (164, 152, 110), (190, 178, 134), w=[3, 2, 2]),
        "ear_inner": _flat((162, 150, 104), (148, 138, 94), (174, 162, 116)),
        "vest": _flat((70, 46, 32), (60, 38, 27), (82, 56, 40), (50, 32, 23), w=[3, 3, 2, 1]),
        "vest_edge": _flat((46, 30, 21), (40, 26, 18), (54, 36, 25)),
        "sole": _flat((124, 116, 98), (110, 102, 86), (136, 128, 110)),
        "teeth": vox((206, 198, 172), (190, 182, 156), (218, 210, 186), cell=0.5, bevel=0.2),
        "endo": ENDO,
    },
    "noxbriar": {
        **COMMON,
        "fur": _fur([(42, 36, 33), (34, 30, 28), (50, 42, 38), (28, 24, 23), (60, 48, 41), (24, 21, 20)],
                    [(76, 50, 34), (90, 60, 40)]),
        "fur_dark": _flat((26, 22, 21), (20, 17, 16), (32, 27, 25)),
        "mask": _flat((84, 74, 68), (74, 64, 60), (94, 84, 78)),
        "belly": _flat((164, 156, 150), (150, 142, 136), (178, 170, 164), (134, 126, 120), w=[3, 3, 2, 1]),
        "muzzle": _flat((172, 164, 158), (158, 150, 144), (184, 176, 170), (144, 136, 130), w=[3, 3, 2, 1]),
        "ear_ring": _flat((34, 30, 28), (28, 24, 23), (40, 35, 32)),
        "ear_inner": _flat((150, 142, 138), (138, 130, 126), (162, 154, 150)),
        "vest": _flat((80, 50, 98), (68, 42, 84), (92, 60, 112), (58, 36, 72), w=[3, 3, 2, 1]),
        "vest_edge": _flat((54, 32, 68), (46, 28, 58), (62, 38, 78)),
        "red": _flat((96, 62, 118), (84, 54, 104), (108, 70, 130)),          # the purple bow tie
        "pocket": _flat((104, 70, 126), (94, 62, 114), (114, 78, 136)),
        "hat": _flat((30, 27, 26), (38, 34, 32), (24, 21, 20), (46, 41, 38), w=[3, 3, 2, 1]),
        "sole": _flat((112, 108, 106), (98, 94, 92), (124, 120, 118)),
        "teeth": vox((204, 198, 186), (188, 182, 170), (216, 210, 198), cell=0.5, bevel=0.2),
        "endo": ENDO,
    },
}

# same surface treatment as fred3's pictures: half-pixel cells with fine grain, shading baked in
# afterwards, the pale parts taking less of it
for _mats in MATERIALS.values():
    for _k, _m in list(_mats.items()):
        if "cell" in _m:
            _mats[_k] = dict(_m, cell=0.5, bevel=0.0, grain=0.04)
        elif _k in ("black", "socket"):
            _mats[_k] = dict(_m, bevel=0.0, grain=0.03)
    for _k, _v in (("muzzle", 0.6), ("mask", 0.6), ("teeth", 0.5), ("belly", 0.85), ("ear_inner", 0.7)):
        if _k in _mats:
            _mats[_k]["shade"] = _v
    _mats["eyeball"] = dict(_mats["socket"], shade=0.0)

# The pictures' eyes: a big glowing red iris with a dark red ring and a black pupil, a white glint up
# and to the picture's right, a dim red glow spreading into the black socket, and thin white
# reflections curving along the socket's edge (along the bottom, and up the outer side on Noxbriar)
_RED_EYE = dict(iris=(236, 30, 34), ring=(96, 6, 10), pupil=(14, 2, 4), r_iris=0.44, r_ring=0.08, r_pupil=0.17,
                halo=(118, 14, 16), r_halo=0.9, halo_a=0.5, glint=(255, 246, 244), glow=(220, 22, 28),
                reflect=(-104, -28, 0.85), reflect_w=(0.07, 0.24), pixel=None)
EYES = {"rustgrin": dict(_RED_EYE), "mirehop": dict(_RED_EYE, reflect=(-90, -10, 0.85)),
        "noxbriar": dict(_RED_EYE, reflect=(-60, 40, 0.9))}

# --------------------------------------------------------------------------
# Measurements (picture pixels; character's right = left half of the picture).  The keys mean
# the same as in fred3.py; the vest keys are new:
#   vest      (inner edge half width of each lapel, lapel trim width) in picture px
#   vest_buttons   square buttons on the lapels: (x, y, half size)
#   pockets   pocket flaps: (outer x, inner x, row, height)
# --------------------------------------------------------------------------

P = {"rustgrin": Pic(515, 1442), "mirehop": Pic(512, 1445), "noxbriar": Pic(512, 1440)}

BODY = {
    "rustgrin": dict(chest=(838, 468), chest_half=186, depth=4.5, belly=(812, 480), belly_half=118, pelvis=(886, 830),
                     pelvis_half=174, bow=(536, 490), bow_half=86, bow_mat="red", buttons=(), button_round=False,
                     vest=(118, 9), vest_buttons=((382, 628, 13), (382, 690, 13))),
    "mirehop": dict(chest=(868, 520), chest_half=176, depth=4.3, belly=(846, 556), belly_half=102, pelvis=(936, 860),
                    pelvis_half=176, bow=(582, 540), bow_half=70, bow_mat="black", buttons=(), button_round=False,
                    vest=(102, 9), vest_buttons=((394, 705, 12), (394, 770, 12))),
    "noxbriar": dict(chest=(842, 500), chest_half=180, depth=4.5, belly=(826, 508), belly_half=110, pelvis=(906, 840),
                     pelvis_half=176, bow=(566, 520), bow_half=80, bow_mat="red", buttons=((598, 18), (648, 18)),
                     button_round=True, vest=(110, 9), pockets=((350, 398, 742, 18),)),
}

LEGS = {
    "rustgrin": dict(leg_x=(397, 633), shin_x=(386, 644), thigh=(1086, 886), thigh_half=80, knee=(1116, 1086),
                     knee_half=28, shin=(1296, 1116), shin_half=85, heel_top=1300, toe_top=1336, sole_top=1420,
                     foot=(176, 470)),
    "mirehop": dict(leg_x=(405, 619), shin_x=(395, 629), thigh=(1110, 936), thigh_half=78, knee=(1140, 1110),
                    knee_half=28, shin=(1306, 1140), shin_half=82, heel_top=1312, toe_top=1342, sole_top=1405,
                    foot=(180, 466)),
    "noxbriar": dict(leg_x=(400, 624), shin_x=(390, 634), thigh=(1090, 906), thigh_half=80, knee=(1120, 1090),
                     knee_half=28, shin=(1290, 1120), shin_half=83, heel_top=1300, toe_top=1335, sole_top=1415,
                     foot=(176, 466)),
}

ARMS = {
    "rustgrin": dict(shoulder=(326, 478), upper=dict(angle=6.0, span=(-0.4, 7.4), ox=2.6, half=(3.2, 2.8), next=(3.0, 8.2)),
                     fore=dict(angle=4.0, span=(0.3, 6.6), ox=0.3, half=(3.1, 2.8)), cap=(-1.6, 3.0, 2.3, 3.8)),
    "mirehop": dict(shoulder=(338, 534), upper=dict(angle=5.0, span=(-0.3, 6.9), ox=2.4, half=(3.0, 2.7), next=(3.0, 7.8)),
                    fore=dict(angle=3.0, span=(0.2, 5.8), ox=0.3, half=(3.0, 2.7)), cap=(-1.4, 3.0, 2.2, 3.6)),
    "noxbriar": dict(shoulder=(340, 506), upper=dict(angle=6.0, span=(-0.4, 7.2), ox=2.6, half=(3.1, 2.8), next=(3.0, 8.0)),
                     fore=dict(angle=4.0, span=(0.3, 6.4), ox=0.3, half=(3.0, 2.8)), cap=(-1.5, 3.0, 2.3, 3.8)),
}

_ENDO_HAND = dict(kind="endo", palm=(5.0, 3.4, 2.6), fingers=4, segs=(2.0, 1.8, 1.6), seg_w=1.2, seg_d=1.3, ball=0.9,
                  thumb=(1.9, 1.6), thumb_w=1.2, tilt=0.4)
HANDS = {
    "rustgrin": dict(_ENDO_HAND),
    "mirehop": dict(kind="mitt", palm=(4.6, 3.8, 2.8), fingers=4, segs=(1.6, 1.4, 1.2), seg_w=1.12, seg_d=1.5,
                    thumb=(2.0, 1.6), thumb_w=1.5, tilt=0.3),
    "noxbriar": dict(_ENDO_HAND),
}

HEADS = {
    "rustgrin": dict(pivot=466, front=-5.3, back=5.0, slabs=((150, 118, 92), (205, 150, 110), (320, 205, 120), (400, 320, 115)),
                     sockets=dict(rows=(300, 232), inner=(497, 533), outer=(440, 590)), pupils=dict(x=(467, 565), row=268),
                     deep=0.8, mask=dict(rows=(316, 214), half=(424, 606)), brow=None,
                     cheeks=dict(rows=(396, 290), out=(386, 644)),
                     muzzle=dict(rows=(400, 304), half=(405, 625), depth=2.8, freckles=((432, 344), (446, 360), (436, 378))),
                     nose=dict(rows=(336, 300), half=(490, 540)), jaw=dict(rows=(466, 425), half=(425, 605), mat="fur"),
                     teeth=dict(rows=(425, 402), span=(440, 590), n=6, w=22), tears=None,
                     ears=dict(kind="round", centre=((350, 680), 165), size=(136, 136), inner=1.2, ring=0.5,
                               colours=("fur", "ear_ring", "ear_inner")),
                     hat=dict(brim=(116, 92, 418, 592), crown=(92, 15, 432, 578), band=(96, 78))),
    "mirehop": dict(pivot=520, front=-5.2, back=4.8, slabs=((190, 165, 90), (240, 190, 118), (330, 240, 128), (440, 330, 122)),
                    sockets=dict(rows=(382, 300), inner=(494, 530), outer=(432, 592)), pupils=dict(x=(465, 560), row=355),
                    deep=0.8, mask=dict(rows=(396, 286), half=(420, 604)), brow=None,
                    cheeks=dict(rows=(452, 366), out=(386, 640)),
                    muzzle=dict(rows=(450, 384), half=(420, 605), depth=2.7, freckles=((432, 424), (446, 440), (456, 428))),
                    nose=dict(rows=(420, 386), half=(490, 535)), jaw=dict(rows=(520, 470), half=(430, 600), mat="fur"),
                    teeth=dict(rows=(470, 450), span=(450, 580), n=6, w=20), tears=None, ears=dict(kind="bunny"), hat=None),
    "noxbriar": dict(pivot=496, front=-5.3, back=5.0, slabs=((150, 112, 92), (210, 150, 112), (320, 210, 122), (420, 320, 118)),
                     sockets=dict(rows=(310, 236), inner=(495, 530), outer=(437, 592)), pupils=dict(x=(465, 560), row=272),
                     deep=0.8, mask=dict(rows=(326, 216), half=(422, 604)), brow=None,
                     cheeks=dict(rows=(410, 300), out=(386, 640)),
                     muzzle=dict(rows=(425, 330), half=(415, 610), depth=2.8, freckles=()),
                     nose=dict(rows=(356, 326), half=(488, 538)), jaw=dict(rows=(490, 446), half=(425, 600), mat="fur"),
                     teeth=dict(rows=(446, 425), span=(445, 580), n=6, w=22),
                     tears=dict(x=((440, 586), (453, 573)), rows=(430, 304)),
                     ears=dict(kind="round", centre=((352, 672), 162), size=(132, 132), inner=1.2, ring=0.4,
                               colours=("fur", "ear_ring", "ear_inner")),
                     hat=dict(brim=(112, 86, 430, 592), crown=(86, 15, 452, 562))),
}

# Mirehop's ears in picture px: the right one stands up from its joint, the left one leans out
# from its joint and folds over at a hinge so its top hangs down and out.
BUNNY_EARS = dict(right_joint=(402, 228), right_len=192, right_angle=-2.0, right_half=1.75,
                  left_joint=(600, 215), left_base=95, left_angle=30.0, base_half=1.6, fold_angle=121.0,
                  left_len=225, top_half=1.9)

TITLES = {"rustgrin": "RUSTGRIN", "mirehop": "MIREHOP", "noxbriar": "NOXBRIAR"}
EGGS = {"rustgrin": ("#6e6e6c", "#9a1a1c"), "mirehop": ("#4e6428", "#46301f"), "noxbriar": ("#221e1c", "#503062")}

# fred3's builders and fred3_anims' hand helpers look parts up by character name
for _table, _ours in ((fred3.P, P), (fred3.BODY, BODY), (fred3.LEGS, LEGS), (fred3.ARMS, ARMS), (fred3.HANDS, HANDS),
                      (fred3.HEADS, HEADS), (fred3.EYES, EYES)):
    _table.update(_ours)

# --------------------------------------------------------------------------
# Builders
# --------------------------------------------------------------------------


def build_legs(name):
    """fred3's legs, with the feet as wide as in the pictures: flush with the inner side of the shin
    and reaching well out past its outer side (fred3 centres each foot under its shin)."""
    pic, L = P[name], LEGS[name]
    lx = fred3.half_pair(pic, *L["leg_x"])
    sx = fred3.half_pair(pic, *L["shin_x"])
    for s, side in ((1, "right"), (-1, "left")):
        leg, shin, foot = f"{side}Leg", f"{side}Shin", f"{side}Foot"
        t0, t1 = pic.y(L["thigh"][0]), pic.y(L["thigh"][1])
        tw = pic.d(L["thigh_half"])
        bone(leg, "root", [s * lx, t1 - 0.6, 0])
        cube(leg, "hip_joint", [lx - 1.3, t1 - 1.2, -1.3], [lx + 1.3, t1 + 0.8, 1.3], "endo", s, painter=fred3.p_endo)
        rbox(leg, "thigh", lx - tw, lx + tw, t0, t1, -tw, tw, "fur", s, r=0.9, steps=3)
        k0, k1 = pic.y(L["knee"][0]), pic.y(L["knee"][1])
        kw = pic.d(L["knee_half"])
        kx = (lx + sx) / 2
        bone(shin, leg, [s * kx, (k0 + k1) / 2, 0])
        cube(shin, "knee_joint", [kx - kw, k0 - 0.2, -kw], [kx + kw, k1 + 0.2, kw], "endo", s, painter=fred3.p_endo)
        s0, s1 = pic.y(L["shin"][0]), pic.y(L["shin"][1])
        sw = pic.d(L["shin_half"])
        rbox(shin, "shin", sx - sw, sx + sw, s0, s1, -sw, sw, "fur", s, r=0.95, steps=3)
        heel = pic.y(L["heel_top"])
        bone(foot, shin, [s * sx, heel + 0.4, 0])
        cube(foot, "ankle_joint", [sx - 1.1, heel - 0.4, -1.1], [sx + 1.1, heel + 0.9, 1.1], "endo", s, painter=fred3.p_endo)
        fo, fi = pic.x(L["foot"][0]), pic.x(L["foot"][1])
        sole, toe = pic.y(L["sole_top"]), pic.y(L["toe_top"])
        td = 3.3
        fz0 = -sw - td + 0.3                     # the toes reach forward from the front of the shin
        fz1 = sw + 0.4
        cube(foot, "sole", [fi, 0.0, fz0], [fo, sole, fz1 + 0.2], "sole", s)
        rbox(foot, "heel", fi + 0.5, fo - 0.5, sole, heel, fz0 + td - 0.6, fz1, "fur", s, r=0.8)
        gap = 0.18
        tw_ = (fo - fi - 2 * gap) / 3
        x = fi
        for i in range(3):
            rbox(foot, f"toe{i + 1}", x, x + tw_, sole, toe, fz0 + 0.1, fz0 + td + 0.2, "fur", s, r=0.75)
            rbox(foot, f"toe{i + 1}_top", x + 0.25, x + tw_ - 0.25, toe - 0.3, toe + 0.8, fz0 + td * 0.55, fz0 + td + 0.4,
                 "fur", s, r=0.45)
            x += tw_ + gap


def build_body(name):
    """fred3's chest, belly and bow tie, with the chest in vest cloth: the vest wraps the whole torso
    and stays open down the front over the belly, with a darker trim along each lapel."""
    pic, B = P[name], BODY[name]
    hd = B["depth"]
    p0, p1 = pic.y(B["pelvis"][0]), pic.y(B["pelvis"][1])
    ph = pic.d(B["pelvis_half"])
    bone("body", "root", [0, p0 + 0.8, 0])
    rbox("body", "pelvis", -ph, ph, p0, p1, -hd + 0.15, hd - 0.15, "fur", r=0.9, steps=3)
    c0, c1 = pic.y(B["chest"][0]), pic.y(B["chest"][1])
    hw = pic.d(B["chest_half"])
    bone("torso", "body", [0, p1, 0])
    cube("torso", "waist", [-hw + 1.0, p1 - 0.6, -hd + 1.0], [hw - 1.0, c0 + 0.4, hd - 1.0], "socket")
    rbox("torso", "chest", -hw, hw, c0, c1, -hd, hd, "vest", r=1.2, steps=3)
    b0, b1 = pic.y(B["belly"][0]), pic.y(B["belly"][1])
    bx = pic.d(B["belly_half"])
    fz = -hd
    cube("torso", "belly", [-bx, b0, fz - 0.25], [bx, b1 - 0.75, fz + 0.1], "belly")
    cube("torso", "belly_top", [-bx + 0.75, b1 - 0.8, fz - 0.25], [bx - 0.75, b1, fz + 0.1], "belly")
    # lapel trim: a raised strip on the vest along each side of the belly, from the hem to the bow tie
    vx, vw = pic.d(B["vest"][0]), pic.d(B["vest"][1])
    w0 = pic.y(B["bow"][0])
    for s in (1, -1):
        cube("torso", "lapel", [vx, c0 + 0.1, fz - 0.35], [vx + vw, w0, fz + 0.1], "vest_edge", s)
    # bow tie
    w1 = pic.y(B["bow"][1])
    wh = pic.d(B["bow_half"])
    mat = B["bow_mat"]
    k = w1 - w0
    cube("torso", "bowtie_knot", [-0.75, w0 + k * 0.15, fz - 0.9], [0.75, w1 - k * 0.15, fz - 0.05], mat)
    for s in (1, -1):
        cube("torso", "bowtie_inner", [0.75, w0 + k * 0.08, fz - 0.7], [wh * 0.55, w1 - k * 0.08, fz - 0.05], mat, s)
        cube("torso", "bowtie_wing", [wh * 0.55, w0, fz - 0.7], [wh, w1, fz - 0.05], mat, s)
    for i, (by, br) in enumerate(B["buttons"]):
        y, r = pic.y(by), pic.d(br)
        cube("torso", f"button{i + 1}", [-r, y - r * 0.6, fz - 0.65], [r, y + r * 0.6, fz - 0.2], "black")
        cube("torso", f"button{i + 1}_v", [-r * 0.6, y - r, fz - 0.65], [r * 0.6, y + r, fz - 0.2], "black")
    for i, (bx_, by, br) in enumerate(B.get("vest_buttons", ())):
        x, y, r = pic.x(bx_), pic.y(by), pic.d(br)
        for s in (1, -1):
            cube("torso", f"vest_button{i + 1}", [x - r, y - r, fz - 0.6], [x + r, y + r, fz - 0.1], "black", s)
    for i, (xo, xi, row, h) in enumerate(B.get("pockets", ())):
        x0, x1, y = pic.x(xi), pic.x(xo), pic.y(row)
        for s in (1, -1):
            cube("torso", f"pocket_flap{i + 1}", [x0, y - pic.d(h) / 2, fz - 0.4], [x1, y + pic.d(h) / 2, fz + 0.1], "pocket", s)
            cube("torso", f"pocket_line{i + 1}", [x0, y - pic.d(h) / 2 - 0.2, fz - 0.3], [x1, y - pic.d(h) / 2, fz + 0.1], "vest_edge", s)
    return hd, hw, c1


def build_bunny_ears(name):
    """Right ear stands up; the left one leans out from its chrome joint and folds over."""
    pic, E = P[name], BUNNY_EARS
    jx, jy = pic.x(E["right_joint"][0]), pic.y(E["right_joint"][1])
    bone("rightEar", "head", [jx, jy, 0.3], [0, 0, E["right_angle"]])
    cube("rightEar", "ear_joint", [jx - 0.6, jy - 0.4, -0.3], [jx + 0.6, jy + 1.0, 0.9], "chrome", painter=fred3.p_chrome)
    L, w = E["right_len"] / fred3.SCALE, E["right_half"]
    rbox("rightEar", "ear", jx - w, jx + w, jy + 0.8, jy + 0.8 + L, -0.55, 0.95, "fur", r=0.65,
         painter=panel_painter("ear_inner", "fur", 0.6))
    jx, jy = pic.x(E["left_joint"][0]), pic.y(E["left_joint"][1])
    bone("leftEar", "head", [jx, jy, 0.3], [0, 0, E["left_angle"]])
    cube("leftEar", "ear_joint", [jx - 0.6, jy - 0.4, -0.3], [jx + 0.6, jy + 1.0, 0.9], "chrome", painter=fred3.p_chrome)
    Lb, w = E["left_base"] / fred3.SCALE, E["base_half"]
    rbox("leftEar", "ear_base", jx - w, jx + w, jy + 0.4, jy + 0.4 + Lb, -0.55, 0.95, "fur", r=0.6)
    fy = jy + 0.4 + Lb
    bone("leftEarTop", "leftEar", [jx, fy - 0.3, 0.3], [0, 0, E["fold_angle"]])
    Lt, w = E["left_len"] / fred3.SCALE, E["top_half"]
    cube("leftEarTop", "ear_hinge", [jx - 0.55, fy - 0.7, -0.25], [jx + 0.55, fy + 0.1, 0.85], "chrome", painter=fred3.p_chrome)
    rbox("leftEarTop", "ear_top", jx - w, jx + w, fy - 0.2, fy - 0.2 + Lt, -0.55, 0.95, "fur", r=0.65,
         painter=panel_painter("ear_inner", "fur", 0.7, faces=("south",)))


def build_round_ears(name):
    """Round ears built row by row (an octagon-ish disc rather than fred3's three-step plus), each with
    a dark ring and a pale centre on front and back."""
    pic, E = P[name], HEADS[name]["ears"]
    ex, ey = fred3.half_pair(pic, *E["centre"][0]), pic.y(E["centre"][1])
    r = pic.d(E["size"][0]) / 2
    outer, ring, inner = E["colours"]
    rows = 6
    for s, side in ((1, "right"), (-1, "left")):
        e = f"{side}Ear"
        bone(e, "head", [s * (ex - r * 0.7), ey - r * 0.6, 0.2])
        for j in range(rows):
            y0 = -r + 2 * r * j / rows
            yc = y0 + r / rows
            hw = round((r * r - yc * yc) ** 0.5 / 0.25 + 0.5) * 0.25
            c = cube(e, f"ear_row{j + 1}", [ex - hw, ey + y0, -0.7], [ex + hw, ey + y0 + 2 * r / rows, 0.7], outer, s,
                     painter=fred3.ring_painter(outer, ring, inner, E["ring"], E["inner"]))
            c.ear_c = (ex * s, ey)


def build_hat(name):
    fred3.build_hat(name)
    Hh = HEADS[name]["hat"]
    if Hh.get("band"):
        pic = P[name]
        c0, c1, cx0, cx1 = Hh["crown"]
        hx = pic.x((cx0 + cx1) / 2)
        cw = abs(cx1 - cx0) / 2 / fred3.SCALE + 0.12
        rbox("hat", "band", hx - cw, hx + cw, pic.y(Hh["band"][0]), pic.y(Hh["band"][1]), -cw * 0.95, cw * 0.95, "hat_band", r=0.3)


def build(name):
    bone("root", None, [0, 0, 0])
    build_legs(name)
    hd, hw, c1 = build_body(name)
    H = HEADS[name]
    hp = P[name].y(H["pivot"])
    cube("torso", "neck", [-1.3, c1 - 1.0, -1.2], [1.3, hp + 1.0, 1.4], "endo", painter=fred3.p_endo)
    PALM[name] = fred3.build_arms(name, hw)
    fred3.build_head(name)
    if H["ears"]["kind"] == "round":
        build_round_ears(name)
    else:
        build_bunny_ears(name)
    if H["hat"]:
        build_hat(name)


PALM = {}
BUILDERS = {n: (lambda n=n: build(n)) for n in NAMES}


def spec(name):
    from characters import vested_anims

    # the palm centre comes from the geometry, so build it once up front
    rig.reset(MATERIALS[name], tpu=4)
    build(name)
    palm = PALM[name]
    D = fred3.dims(name)
    return export.Character(
        model_id=name,
        entity_id=f"fnaf:{name}",
        out_dir=os.path.join(export.TOOLS_DIR, "..", name),
        materials=MATERIALS[name],
        build_geometry=BUILDERS[name],
        build_anims=lambda: vested_anims.CLIPS[name](name).build(name),
        sources=[os.path.abspath(__file__), os.path.join(HERE, "vested_anims.py"), os.path.join(HERE, "fred3.py"),
                 os.path.join(HERE, "fred3_anims.py"), os.path.join(HERE, "night.py"), os.path.join(HERE, "body.py"), name],
        spawn_egg=EGGS[name],
        variant_states={"pose1": 1, "pose2": 2, "performance1": 3, "performance2": 4, "jumpscare1": 5, "jumpscare2": 6},
        arm=dict(palm=palm, chest=dict(half_x=D["half_w"] + 1.2, z=(-D["torso_d"] - 1.2, D["torso_d"] + 0.8),
                                       y=(D["torso"][0] - 3.0, D["torso"][1]))),
        visible_box=(6, 5, 2.5),
        atlas_width=1024,
        tpu=4,
        shading=fred3.SHADING,
    )
