"""Seven animatronics from the "night stage" reference pictures:

  monkey      red-brown monkey (the old "spiral_bear"): light face mask, heavy brow ridge,
              deep-set eyes, spiral ears on the sides of the head, wide toothy grin, long
              arms, a scruffy tuft and a curling tail
  bat         purple bat: wide pug-faced head, huge pointed ears, wings with finger bones,
              broad shoulders over a narrow waist, black bow tie
  crocodile   green crocodile: long toothy snout, small top hat with a red band, red vest,
              clawed feet and a spiked tail
  fox         red pirate fox: long narrow snout, eye patch, hook hand, head and cheek tufts,
              pointed ears, narrow chest over wide hips, bushy white-tipped tail
  bunny       purple bunny: slim and lanky, chubby cheeks, buck teeth, long feet, tall ears
              (one folded at its joint)
  goat        beige goat: tall and thin, long narrow face, curled ram horns, floppy
              pink-lined ears, beard, red vest, dark hooves and fingertips
  bear        dark brown bear: heavy, with a wide square head, thick limbs, a pot belly,
              big top hat and small black-lined ears

They share the voxel frame in body.py; everything that makes each one recognisable
(proportions, heads, props, colours) is set here per character, and reshape() pushes each
build away from the shared one.  Every head sits on an exposed endoskeleton neck (refit()).
Their animations are in cast_anims.py.
"""
import math
import os

import numpy as np

from characters.body import (COMMON, ENDO, SPIRAL, SPIRAL_MIRROR, bands_painter, build_arms, build_bowtie, build_endo_neck,
                             build_head, build_legs, build_tail, build_torso, frame_painter, lengthen, p_chrome, p_pupil,
                             raise_head, socket_painter, vox)
from fnafkit import export
from fnafkit.rig import bone, cube

HERE = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------
# Colours (sampled from each picture's evenly lit side, brought up to albedo)
# --------------------------------------------------------------------------

MATERIALS = {
    "monkey": {
        **COMMON,
        "fur": vox((70, 28, 18), (88, 36, 23), (104, 44, 28), (120, 53, 34), (138, 63, 40), (156, 74, 48), (56, 22, 14),
                   w=[2, 3, 3, 3, 2, 1, 2], patches=[(2.2, 0.64, [(50, 19, 12), (60, 24, 15)])]),
        "fur_dark": vox((46, 18, 12), (54, 22, 14), (62, 25, 16)),
        "face": vox((178, 128, 94), (190, 138, 102), (200, 148, 110), (166, 118, 86), spots=[((146, 102, 74), 0.06)]),
        "muzzle": vox((186, 136, 100), (198, 146, 108), (208, 156, 116), (174, 126, 92)),
        "tan": vox((170, 120, 92), (182, 132, 102), (194, 142, 110), (206, 152, 118), (158, 110, 84),
                   patches=[(1.8, 0.76, [(136, 92, 70), (124, 84, 64)])]),
        "red": vox((104, 22, 22), (118, 28, 27), (132, 34, 32), (92, 18, 19)),
        "sole": vox((176, 160, 146), (188, 172, 158), (200, 184, 170)),
        "spiral_light": vox((176, 128, 90), (188, 138, 98), (198, 148, 106)),
        "spiral_dark": vox((82, 34, 22), (92, 39, 25), (102, 44, 28)),
        "lip": vox((40, 16, 12), (48, 20, 14)),
    },
    "bat": {
        **COMMON,
        "fur": vox((64, 36, 70), (76, 44, 82), (88, 52, 96), (100, 60, 108), (112, 68, 120), (56, 30, 60),
                   w=[2, 3, 3, 2, 1, 2], patches=[(2.4, 0.66, [(46, 26, 52), (52, 30, 58)])]),
        "fur_dark": vox((44, 24, 48), (52, 28, 56), (60, 34, 64)),
        "tan": vox((160, 124, 132), (172, 134, 142), (184, 146, 154), (150, 114, 122), patches=[(1.8, 0.8, [(134, 102, 110)])]),
        "muzzle": vox((168, 132, 138), (180, 142, 148), (192, 154, 160), (156, 122, 128)),
        "ear_inner": vox((150, 96, 132), (162, 106, 142), (140, 88, 122), (172, 116, 152)),
        "membrane": vox((92, 56, 102), (104, 64, 114), (84, 50, 94), (116, 74, 126)),
        "sole": vox((150, 128, 138), (162, 140, 150), (140, 118, 128)),
    },
    "crocodile": {
        **COMMON,
        "fur": vox((78, 96, 48), (90, 110, 56), (102, 122, 62), (66, 82, 40), (112, 130, 70), (58, 74, 36),
                   w=[3, 3, 2, 2, 1, 2], patches=[(2.0, 0.62, [(46, 60, 30), (54, 68, 34)])]),
        "fur_dark": vox((44, 58, 28), (52, 66, 32), (60, 74, 36)),
        "snout": vox((126, 130, 60), (140, 142, 68), (112, 118, 52), (150, 150, 76)),
        "tan": vox((176, 132, 96), (188, 142, 104), (164, 122, 88), (198, 152, 112), patches=[(1.8, 0.8, [(150, 110, 78)])]),
        "tan_light": vox((200, 160, 112), (212, 172, 122), (190, 150, 104)),
        "vest": vox((130, 26, 30), (146, 32, 36), (118, 22, 26), (156, 40, 42)),
        "vest_dark": vox((90, 16, 20), (100, 20, 24)),
        "teeth": vox((222, 204, 166), (232, 214, 176), (212, 194, 156)),
        "mouth_red": vox((110, 20, 24), (130, 28, 32), (96, 16, 20)),
        "hat": vox((34, 32, 36), (44, 42, 46), (54, 52, 56), (64, 62, 66), bevel=0.2),
        "hat_band": vox((140, 24, 30), (156, 30, 36)),
        "claw": vox((190, 150, 110), (202, 162, 120), (178, 140, 100)),
        "sole": vox((150, 140, 110), (162, 152, 120)),
    },
    "fox": {
        **COMMON,
        "fur": vox((150, 40, 34), (164, 48, 40), (178, 56, 46), (136, 34, 30), (120, 28, 24), (190, 64, 52),
                   w=[3, 3, 2, 2, 2, 1], patches=[(2.2, 0.66, [(108, 24, 20), (116, 28, 22)])]),
        "fur_dark": vox((100, 24, 20), (110, 28, 22)),
        "tan": vox((176, 124, 108), (188, 134, 118), (164, 114, 98), (198, 144, 128), patches=[(1.8, 0.8, [(150, 102, 88)])]),
        "muzzle": vox((190, 124, 92), (202, 136, 102), (178, 114, 84), (212, 146, 112)),
        "tail_tip": vox((220, 190, 170), (232, 204, 184), (210, 178, 158)),
        "hook": vox((110, 110, 116), (126, 126, 132), (94, 94, 100), (140, 140, 146), cell=0.6, bevel=0.25),
        "sole": vox((176, 150, 140), (188, 162, 150)),
    },
    "bunny": {
        **COMMON,
        "fur": vox((86, 56, 118), (98, 64, 132), (110, 72, 146), (76, 48, 104), (120, 82, 158), (68, 42, 94),
                   w=[3, 3, 2, 2, 1, 2], patches=[(2.4, 0.66, [(62, 38, 86), (70, 44, 96)])]),
        "fur_dark": vox((58, 36, 80), (66, 42, 90)),
        "tan": vox((164, 140, 158), (176, 152, 170), (152, 128, 146), (186, 162, 180), patches=[(1.8, 0.8, [(140, 118, 134)])]),
        "muzzle": vox((172, 148, 166), (184, 160, 178), (160, 136, 154)),
        "ear_inner": vox((164, 140, 158), (176, 152, 170), (152, 128, 146)),
        "teeth": vox((222, 214, 214), (232, 224, 224), (212, 204, 204)),
        "sole": vox((176, 160, 170), (188, 172, 182)),
    },
    "goat": {
        **COMMON,
        "fur": vox((170, 140, 124), (182, 152, 136), (194, 164, 148), (158, 128, 112), (146, 116, 100),
                   w=[3, 3, 2, 2, 2], patches=[(2.2, 0.66, [(130, 100, 86), (138, 108, 92)])]),
        "fur_dark": vox((120, 92, 78), (130, 100, 86)),
        "tan": vox((196, 164, 146), (208, 176, 158), (186, 154, 136)),
        "muzzle": vox((200, 170, 152), (212, 182, 164), (190, 160, 142)),
        "horn": vox((70, 44, 34), (82, 52, 40), (60, 36, 28), (96, 62, 48), bevel=0.2),
        "ear_inner": vox((160, 80, 92), (172, 90, 102), (148, 72, 84)),
        "vest": vox((140, 30, 30), (156, 38, 36), (126, 24, 26)),
        "hoof": vox((36, 28, 26), (46, 36, 32), (28, 22, 20), bevel=0.2),
        "beard": vox((214, 190, 176), (226, 204, 190), (204, 180, 166), cell=0.5),
        "sole": vox((170, 150, 140), (182, 162, 152)),
    },
    "bear": {
        **COMMON,
        "fur": vox((110, 46, 28), (124, 54, 34), (138, 62, 40), (96, 40, 24), (150, 72, 48), (84, 34, 20),
                   w=[3, 3, 2, 2, 1, 2], patches=[(2.2, 0.62, [(80, 32, 20), (90, 36, 22)])]),
        "fur_dark": vox((70, 28, 16), (80, 32, 20)),
        "tan": vox((160, 110, 82), (172, 120, 90), (148, 100, 74), (182, 130, 98), patches=[(1.8, 0.78, [(136, 92, 68)])]),
        "muzzle": vox((176, 112, 76), (188, 122, 84), (164, 104, 70), (198, 132, 92)),
        "hat": vox((30, 30, 32), (40, 40, 42), (52, 52, 54), (66, 66, 68), bevel=0.22),
        "sole": vox((140, 110, 100), (152, 122, 112)),
    },
}

# the exposed endoskeleton neck: dark steel
for _m in MATERIALS.values():
    _m["endo"] = ENDO

# --------------------------------------------------------------------------
# Measurements (model pixels), each taken from its own picture
# --------------------------------------------------------------------------

CH = {
    # the spiral-eared monkey from picture 2: lanky, long arms reaching past the knees
    "monkey": dict(
        leg_c=3.5, foot_off=0.9, foot_hw=4.0, sole=0.9, toe_top=3.4, heel_top=4.8,
        ankle=(4.6, 6.1), shin=(5.9, 14.5), knee=(14.3, 16.1), thigh=(15.9, 24.5), shin_w=6.2, thigh_w=6.4,
        pelvis=(23.9, 26.3), pelvis_hw=5.2, torso=(26.3, 37.7), half_w=5.4, torso_d=4.2,
        head_pivot=38.4, head_half=6.4, face_z=-5.2, back=5.0, top=49.8,
        jaw=(36.6, 38.4), snout=(38.6, 41.4), snout_z=-8.6, muzzle_hw=4.4, seam=0.0, eyes=(41.8, 45.0),
        socket=(0.8, 4.8), brow=(0.9, 4.0, 0.95, 0), nose=(1.5, 1.4), teeth=(9, 0.6, 0.8), jaw_hw=4.6,
        freckles=(),
        shoulder=(6.4, 36.6, 7), pad=(5.8, 11.6, 30.4, 37.8, 3.0), elbow_y=29.6, fore=(6.0, 11.2, 20.4, 29.0, 2.7),
        wrist_y=19.9, palm=(6.8, 10.6, 15.8, 19.6, 2.6), finger=(3.2, 2.4),
        belly=(4.2, 1.0, 2.4), buttons=(33.2, 30.4, 0.9)),
    # bat: small head under huge ears, wide pelvis band, short forearms with spread claws
    "bat": dict(
        leg_c=3.3, foot_off=0.9, foot_hw=3.9, sole=0.9, toe_top=3.3, heel_top=4.6,
        ankle=(4.6, 6.0), shin=(5.8, 14.6), knee=(14.4, 16.0), thigh=(15.8, 22.8), shin_w=5.8, thigh_w=6.0,
        pelvis=(22.4, 24.8), pelvis_hw=5.9, torso=(24.8, 35.6), half_w=5.2, torso_d=4.0,
        head_pivot=36.6, head_half=6.2, face_z=-4.8, back=4.6, top=46.6,
        jaw=(34.4, 36.0), snout=(36.2, 39.0), snout_z=-6.4, muzzle_hw=5.0, seam=0.12, eyes=(39.0, 42.2),
        socket=(0.8, 4.8), brow=(1.0, 4.4, 0.6, 0), nose=(1.5, 1.2), teeth=(7, 0.7, 0.75), jaw_hw=5.2,
        freckles=((2.0, 2.0), (3.4, 1.8), (2.6, 1.0), (4.0, 1.1)),
        shoulder=(6.1, 34.4, 8), pad=(5.4, 10.8, 28.8, 35.6, 2.8), elbow_y=28.0, fore=(5.6, 10.6, 22.8, 27.6, 2.6),
        wrist_y=22.3, palm=(6.4, 10.2, 18.8, 22.0, 2.6), finger=(2.2, 1.8),
        belly=(4.0, 0.8, 2.2), buttons=(31.4, 28.8, 0.8)),
    # crocodile: tall and hunched, long shins, long vested torso, big clawed hands
    "crocodile": dict(
        leg_c=3.6, foot_off=1.0, foot_hw=4.2, sole=0.6, toe_top=3.3, heel_top=4.8,
        ankle=(4.6, 6.0), shin=(5.8, 15.6), knee=(15.4, 17.0), thigh=(16.8, 24.0), shin_w=6.2, thigh_w=6.6,
        pelvis=(23.6, 26.0), pelvis_hw=5.8, torso=(26.0, 38.6), half_w=5.8, torso_d=4.6,
        head_pivot=39.4, head_half=6.0, face_z=-4.4, back=5.0, top=47.6,
        shoulder=(6.7, 37.4, 7), pad=(6.0, 11.8, 30.6, 38.2, 3.0), elbow_y=29.8, fore=(6.2, 11.6, 22.8, 29.2, 2.9),
        wrist_y=22.2, palm=(7.0, 11.0, 17.6, 21.8, 3.0), finger=(2.8, 2.2),
        belly=(4.6, 0.8, 2.6), buttons=(33.0, 30.0, 0.95)),
    # fox: wide hips, long snout, big pointed ears
    "fox": dict(
        leg_c=3.6, foot_off=0.9, foot_hw=4.0, sole=0.9, toe_top=3.4, heel_top=4.8,
        ankle=(4.6, 6.0), shin=(5.8, 14.0), knee=(13.8, 15.4), thigh=(15.2, 22.4), shin_w=6.2, thigh_w=6.4,
        pelvis=(22.0, 24.8), pelvis_hw=6.1, torso=(24.8, 36.4), half_w=5.6, torso_d=4.2,
        head_pivot=37.2, head_half=5.3, face_z=-5.0, back=4.8, top=47.4,
        jaw=(34.8, 36.6), snout=(36.8, 39.8), snout_z=-11.2, muzzle_hw=3.3, seam=0.12, eyes=(40.0, 43.4),
        socket=(0.7, 4.2), brow=(0.8, 3.9, 0.7, 0), nose=(1.2, 1.1), teeth=(8, 0.6, 0.9), jaw_hw=3.7,
        freckles=((1.4, 2.2), (2.4, 2.0), (1.9, 1.1), (2.7, 1.0)),
        shoulder=(6.5, 35.2, 7), pad=(5.8, 11.6, 28.8, 36.0, 3.0), elbow_y=28.0, fore=(6.0, 11.2, 22.0, 27.6, 2.8),
        wrist_y=21.5, palm=(6.8, 10.6, 17.6, 21.2, 2.6), finger=(2.3, 1.8),
        belly=(4.4, 0.6, 1.8), buttons=None),
    # bunny: slim, tall head, tall stepped toes, long fingers
    "bunny": dict(
        leg_c=3.4, foot_off=0.9, foot_hw=4.0, sole=0.9, toe_top=3.8, heel_top=5.0,
        ankle=(4.8, 6.2), shin=(6.0, 14.6), knee=(14.4, 16.0), thigh=(15.8, 22.6), shin_w=6.0, thigh_w=6.2,
        pelvis=(22.2, 24.6), pelvis_hw=5.4, torso=(24.6, 35.4), half_w=5.2, torso_d=4.0,
        head_pivot=36.4, head_half=5.3, face_z=-4.8, back=4.6, top=49.0,
        jaw=(34.4, 36.2), snout=(36.4, 39.4), snout_z=-7.2, muzzle_hw=4.4, seam=0.12, eyes=(40.2, 43.8),
        socket=(0.8, 4.4), brow=(0.8, 4.2, 0.75, 0), nose=(1.3, 1.1), teeth=(5, 0.85, 0.8), jaw_hw=4.6,
        freckles=(),
        shoulder=(6.0, 34.2, 7), pad=(5.4, 10.8, 28.0, 35.2, 2.8), elbow_y=27.2, fore=(5.6, 10.8, 21.4, 26.8, 2.7),
        wrist_y=20.8, palm=(6.4, 10.2, 17.0, 20.4, 2.6), finger=(3.2, 2.6),
        belly=(4.0, 0.8, 2.2), buttons=(31.0, 28.4, 0.85)),
    # goat: long narrow face, long legs, vest, hooves
    "goat": dict(
        leg_c=3.4, foot_off=0.8, foot_hw=3.8, sole=0.8, toe_top=3.6, heel_top=5.0,
        ankle=(4.8, 6.2), shin=(6.0, 15.0), knee=(14.8, 16.2), thigh=(16.0, 23.2), shin_w=5.8, thigh_w=6.0,
        pelvis=(22.8, 25.0), pelvis_hw=5.4, torso=(25.0, 37.4), half_w=5.4, torso_d=4.2,
        head_pivot=38.2, head_half=4.9, face_z=-4.8, back=4.6, top=49.6,
        jaw=(34.6, 37.0), snout=(37.2, 40.8), snout_z=-9.6, muzzle_hw=3.4, seam=0.0, eyes=(41.0, 44.6),
        socket=(0.7, 4.0), brow=(0.7, 3.7, 0.8, 0), nose=(1.1, 1.1), teeth=(5, 0.7, 0.9), jaw_hw=3.6,
        freckles=((1.3, 2.3), (2.3, 2.6), (2.8, 1.6), (1.6, 1.2)),
        shoulder=(6.2, 36.2, 6), pad=(5.6, 11.2, 29.4, 36.8, 2.9), elbow_y=28.6, fore=(5.8, 11.0, 22.0, 28.0, 2.7),
        wrist_y=21.5, palm=(6.6, 10.4, 17.6, 21.2, 2.6), finger=(2.6, 2.0),
        belly=(3.6, 0.8, 2.4), buttons=None),
    # bear: heavy, wide chest and head, long hanging arms
    "bear": dict(
        leg_c=3.7, foot_off=0.9, foot_hw=4.3, sole=1.0, toe_top=3.6, heel_top=5.0,
        ankle=(4.8, 6.2), shin=(6.0, 14.4), knee=(14.2, 15.8), thigh=(15.6, 23.2), shin_w=6.6, thigh_w=6.8,
        pelvis=(22.6, 25.2), pelvis_hw=6.0, torso=(25.2, 36.4), half_w=6.0, torso_d=4.6,
        head_pivot=37.2, head_half=7.4, face_z=-5.4, back=5.8, top=49.4,
        jaw=(35.6, 37.4), snout=(37.6, 40.6), snout_z=-7.8, muzzle_hw=5.6, seam=0.12, eyes=(40.8, 44.2),
        socket=(1.0, 5.5), brow=(1.3, 5.0, 0.85, 0), nose=(1.9, 1.5), teeth=(7, 0.85, 0.8), jaw_hw=5.8,
        freckles=((2.5, 2.3), (4.0, 2.0), (3.2, 1.1), (4.6, 1.2)),
        shoulder=(6.9, 35.4, 6), pad=(6.2, 12.2, 28.6, 36.6, 3.2), elbow_y=27.8, fore=(6.4, 12.0, 21.2, 27.2, 3.0),
        wrist_y=20.6, palm=(7.2, 11.2, 16.6, 20.2, 2.9), finger=(2.6, 2.1),
        belly=(4.6, 1.0, 2.6), buttons=(32.0, 29.2, 0.95)),
}


def reshape(d, chest=0.0, depth=0.0, hips=0.0, arm=1.0, leg=1.0):
    """Push a build further from the shared frame: chest / depth / hips widen (model px),
    arm / leg scale the limb thickness.  The arms keep their inner edge against the chest."""
    d = dict(d)
    d["half_w"] += chest
    d["torso_d"] += depth
    bx, bb, bn = d["belly"]
    d["belly"] = (bx + 0.8 * chest, bb, bn)
    x, y, a = d["shoulder"]
    d["shoulder"] = (x + chest, y, a)
    x0, x1 = d["pad"][:2]
    shift = chest + (x1 - x0) * (arm - 1) / 2
    for k in ("pad", "fore", "palm"):
        x0, x1, y0, y1, z = d[k]
        c, hw = (x0 + x1) / 2 + shift, (x1 - x0) / 2 * arm
        d[k] = (c - hw, c + hw, y0, y1, z * arm)
    d["pelvis_hw"] += hips
    d["leg_c"] += 0.6 * hips
    for k in ("thigh_w", "shin_w", "foot_hw"):
        d[k] *= leg
    return d


def refit(d, neck=1.8, forehead=2.6):
    """Lift the head clear of the chest so the endoskeleton neck shows (a `neck`-high gap under
    the jaw) and keep the forehead to `forehead` px above the eyes."""
    d = raise_head(d, neck)
    d["top"] = d["eyes"][1] + forehead
    return d


CH["monkey"] = refit(CH["monkey"], neck=2.2, forehead=3.2)
CH["bat"] = refit(reshape(CH["bat"], chest=0.5, hips=-0.6, arm=0.95), neck=2.0, forehead=2.0)
CH["fox"] = refit(reshape(CH["fox"], chest=-0.4, hips=0.7, arm=0.95, leg=1.06), neck=2.0, forehead=2.4)
CH["bunny"] = refit(lengthen(reshape(CH["bunny"], chest=-0.5, depth=-0.3, hips=-0.4, arm=0.85, leg=0.88), 0.6, 0.4),
                    neck=2.1, forehead=2.6)
CH["bunny"]["foot_len"] = 1.8
CH["goat"] = refit(lengthen(reshape(CH["goat"], chest=-0.6, depth=-0.4, hips=-0.4, arm=0.85, leg=0.85), 0.9, 0.6),
                   neck=2.3, forehead=2.4)
CH["bear"] = refit(reshape(CH["bear"], chest=0.8, depth=0.6, hips=0.6, arm=1.15, leg=1.12), neck=2.0, forehead=2.6)
# the crocodile's head is built from head_pivot alone (jaw bottom = head_pivot - 0.4, top = head_pivot + 8.2)
CH["crocodile"]["head_pivot"] = CH["crocodile"]["torso"][1] + 2.0 + 0.4
CH["crocodile"]["top"] = CH["crocodile"]["head_pivot"] + 8.2

# --------------------------------------------------------------------------
# Painters
# --------------------------------------------------------------------------


def tri_painter(inner, outer, rim=0.7, top_cut=0.0):
    """Front of one layer of a stepped triangular ear: inner colour inside a rim."""

    def painter(ctx):
        ctx.paint(outer)
        if ctx.face != "north":
            return
        c = ctx.cube
        mid, half = (c.frm[0] + c.to[0]) / 2, (c.to[0] - c.frm[0]) / 2
        m = (np.abs(ctx.X - mid) < half - rim) & (ctx.Y < c.to[1] - top_cut)
        ctx.paint(inner, m)

    return painter


def side_grid_painter(pattern, on_mat, off_mat, rim_mat, rim=0.6):
    """Like body.grid_painter but on a cube's outward side face (east for +x, west for -x)."""
    P = np.array([[c == "1" for c in row] for row in pattern])
    n_r, n_c = P.shape

    def painter(ctx):
        ctx.paint(rim_mat)
        c = ctx.cube
        outward = "east" if c.to[0] > 0 else "west"
        if ctx.face != outward:
            return
        z0, z1 = c.frm[2] + rim, c.to[2] - rim
        y0, y1 = c.frm[1] + rim, c.to[1] - rim
        inside = (ctx.Z > z0) & (ctx.Z < z1) & (ctx.Y > y0) & (ctx.Y < y1)
        fz = (z1 - ctx.Z) / (z1 - z0) if outward == "east" else (ctx.Z - z0) / (z1 - z0)
        fy = (y1 - ctx.Y) / (y1 - y0)
        ci = np.clip((fz * n_c).astype(int), 0, n_c - 1)
        ri = np.clip((fy * n_r).astype(int), 0, n_r - 1)
        on = inside & P[ri, ci]
        ctx.paint(off_mat, inside & ~on)
        ctx.paint(on_mat, on)

    return painter


def monkey_muzzle_painter(sn0, sn1):
    """Monkey muzzle: two nostril slits near the top and a dark lip line along the bottom."""

    def painter(ctx):
        ctx.paint("muzzle")
        if ctx.face == "north":
            for s in (1, -1):
                nostril = (np.abs(ctx.X - s * 0.9) < 0.35) & (np.abs(ctx.Y - (sn1 - 0.8)) < 0.3)
                ctx.rgb[nostril] = np.array([28, 14, 10], np.float32)
            lip = ctx.Y < sn0 + 0.35
            ctx.paint("lip", lip)
            crease = (np.abs(ctx.X) < 0.2) & (ctx.Y < sn1 - 1.3)
            ctx.rgb[crease] *= 0.6

    return painter


def membrane_painter(lines):
    """Wing membrane with darker finger bones along `lines` ((x0, y0), (x1, y1)) mirrored in x."""

    def painter(ctx):
        ctx.paint("membrane")
        X, Y = np.abs(ctx.X), ctx.Y
        for (x0, y0), (x1, y1) in lines:
            dx, dy = x1 - x0, y1 - y0
            t = np.clip(((X - x0) * dx + (Y - y0) * dy) / (dx * dx + dy * dy), 0, 1)
            d = np.hypot(X - (x0 + t * dx), Y - (y0 + t * dy))
            ctx.paint("fur_dark", d < 0.38)

    return painter


def underside_painter(top, bottom, split):
    """Green on top, tan underneath (below model y = split)."""

    def painter(ctx):
        ctx.paint(top)
        if ctx.face == "down":
            ctx.paint(bottom)
        elif ctx.face != "up":
            ctx.paint(bottom, ctx.Y < split)

    return painter


# --------------------------------------------------------------------------
# Shared pieces
# --------------------------------------------------------------------------


def tri_ear(bone_name, parent, pivot, rot, s, cx, base_y, base_w, height, depth, inner, outer="fur", tip=0.9):
    """Stepped (voxel) triangular ear built from 1-pixel layers, pointing up from base_y."""
    bone(bone_name, parent, pivot, rot)
    n = int(round(height))
    for k in range(n):
        w = max(tip, base_w * (1 - (k / n) ** 1.5))
        cube(bone_name, f"ear_layer{k + 1}", [cx - w / 2, base_y + k, -depth / 2], [cx + w / 2, base_y + k + 1, depth / 2],
             outer, s, painter=tri_painter(inner, outer, rim=0.65, top_cut=0.7 if k == n - 1 else 0.0))


def voxel_chain(bone_name, prefix, points, sizes, mat, s=1):
    """A chain of cubes centred on `points` (for horns, hooks, spars)."""
    for k, ((x, y, z), r) in enumerate(zip(points, sizes)):
        cube(bone_name, f"{prefix}{k + 1}", [x - r / 2, y - r / 2, z - r / 2], [x + r / 2, y + r / 2, z + r / 2], mat, s)


def top_hat(D, pivot, rot, crown_w, crown_h, brim_w, band_mat=None, mat="hat"):
    top = D["top"]
    bone("hat", "head", pivot, rot)
    cx, cz = pivot[0], pivot[2]
    cube("hat", "brim", [cx - brim_w / 2, top, cz - brim_w / 2], [cx + brim_w / 2, top + 0.7, cz + brim_w / 2], mat)
    cube("hat", "crown", [cx - crown_w / 2, top + 0.7, cz - crown_w / 2], [cx + crown_w / 2, top + 0.7 + crown_h, cz + crown_w / 2], mat)
    if band_mat:
        cube("hat", "band", [cx - crown_w / 2 - 0.12, top + 0.7, cz - crown_w / 2 - 0.12],
             [cx + crown_w / 2 + 0.12, top + 1.5, cz + crown_w / 2 + 0.12], band_mat)


def start(D):
    bone("root", None, [0, 0, 0])


# --------------------------------------------------------------------------
# Characters
# --------------------------------------------------------------------------


def build_monkey():
    D = CH["monkey"]
    start(D)
    build_legs(D)
    build_torso(D)
    build_bowtie(D, D["torso"][1] - 0.9, 3.6)
    build_endo_neck(D)

    # ---- head: big rounded skull, heavy brow ridge, deep sockets in a light face mask ---------
    bone("head", "torso", [0, D["head_pivot"], 0])
    H, fz, back, top = D["head_half"], D["face_z"], D["back"], D["top"]
    e0, e1 = D["eyes"]
    sn0, sn1 = D["snout"]
    j0, j1 = D["jaw"]
    sx0, sx1 = D["socket"]
    px, py = (sx0 + sx1) / 2, (e0 + e1) / 2
    deep = 1.5
    cube("head", "cranium", [-H, e1, fz + 0.4], [H, top - 1.0, back], "fur")
    cube("head", "skull_cap", [-H + 1.0, top - 1.0, fz + 1.2], [H - 1.0, top, back - 0.8], "fur")
    cube("head", "brow_ridge", [-H + 0.3, e1 - 0.4, fz - 1.0], [H - 0.3, e1 + 1.2, fz + 0.4], "fur_dark")
    cube("head", "eye_band", [-H, e0, fz + deep], [H, e1, back], "face", painter=socket_painter(px, py))
    cube("head", "nose_bridge", [-sx0, e0, fz], [sx0, e1 - 0.4, fz + deep], "face")
    for s in (1, -1):
        cube("head", "socket_side", [sx1, e0, fz], [H, e1 - 0.4, fz + deep], "face", s, faces={"east": "fur", "west": "fur"})
    cube("head", "cheeks", [-H, j1, fz + 0.3], [H, e0, back - 0.2], "face",
         faces={"east": "fur", "west": "fur", "south": "fur", "down": "fur"})
    sz, mh = D["snout_z"], D["muzzle_hw"]
    cube("head", "muzzle", [-mh, sn0, sz], [mh, sn1, fz + 0.3], "muzzle", painter=monkey_muzzle_painter(sn0, sn1))
    cube("head", "muzzle_top", [-mh + 1.0, sn1, sz + 0.8], [mh - 1.0, sn1 + 0.7, fz + 0.3], "muzzle")
    jh = D["jaw_hw"]
    cube("head", "mouth", [-jh + 0.4, j1 - 0.1, sz + 0.5], [jh - 0.4, sn0, back - 0.8], "socket")
    n_t, t_w, t_h = D["teeth"]
    step = 2 * (mh - 0.7) / (n_t - 1)
    for i in range(n_t):
        x = -(mh - 0.7) + i * step
        cube("head", f"tooth_upper{i + 1}", [x - t_w / 2, sn0 - t_h, sz + 0.3], [x + t_w / 2, sn0, sz + 0.9], "muzzle")
    bone("jaw", "head", [0, j1, 3.4], [-6, 0, 0])
    cube("jaw", "jaw", [-jh, j0, sz + 0.1], [jh, j1, 4.4], "muzzle", faces={"east": "fur", "west": "fur", "down": "face", "south": "fur"})
    cube("jaw", "mouth_floor", [-jh + 0.6, j1, sz + 0.6], [jh - 0.6, j1 + 0.1, 3.8], "socket")
    for i in range(n_t - 1):
        x = -(mh - 0.7) + (i + 0.5) * step
        cube("jaw", f"tooth_lower{i + 1}", [x - t_w / 2, j1, sz + 0.3], [x + t_w / 2, j1 + t_h, sz + 0.9], "muzzle")
    bone("eyes", "head", [0, py, fz + deep])
    for s in (1, -1):
        cube("eyes", "pupil", [px - 0.42, py - 0.42, fz + deep - 0.12], [px + 0.42, py + 0.42, fz + deep], "glow", s, painter=p_pupil)

    # spiral ears on the sides of the head, at eye level
    for s, side in ((1, "right"), (-1, "left")):
        e = f"{side}Ear"
        bone(e, "head", [s * H, py, 0.4], [0, s * 50, 0])
        cube(e, "ear", [H + 0.2, py - 3.6, -3.2], [H + 1.5, py + 3.6, 4.0], "fur", s,
             painter=side_grid_painter(SPIRAL if s > 0 else SPIRAL_MIRROR, "spiral_light", "spiral_dark", "fur"))

    # scruffy tuft of loose blocks on top
    for k, (x0, z0, h, w) in enumerate(((1.0, -4.4, 1.8, 1.3), (2.5, -3.6, 3.0, 1.3), (4.0, -2.6, 2.2, 1.3),
                                       (-0.4, -3.0, 2.4, 1.3), (1.4, -1.8, 3.8, 1.3), (3.0, -0.6, 2.8, 1.3),
                                       (-2.0, -4.0, 1.4, 1.2), (4.6, -4.4, 1.4, 1.2), (2.0, 0.8, 1.8, 1.3),
                                       (0.2, -0.4, 1.6, 1.2), (-1.4, -1.6, 1.0, 1.1))):
        cube("head", f"tuft{k + 1}", [x0, top - 0.4, z0], [x0 + w, top - 0.4 + h, z0 + w], "fur",
             rot=[0, 0, -18 + 6 * (k % 3)], origin=[x0 + w / 2, top, z0 + w / 2])

    build_arms(D)
    # long curling tail: rises behind him and rolls into a spiral at the tip
    seg = [(10, 0), (-10, 0), (-15, 0), (-20, 0), (-20, 0), (-25, 0), (-35, 0), (-45, 0), (-55, 0), (-60, 0), (-60, 0)]
    build_tail("tail", (0.0, D["pelvis"][0] + 1.2, D["torso_d"]), 2.4, 1.3, seg, bands=("fur", "fur_dark", 2.4, 0.15), taper=0.03)


def build_bat():
    D = CH["bat"]
    start(D)
    build_legs(D)
    build_torso(D)
    build_bowtie(D, D["torso"][1] - 0.5, 3.8, mat="black", painter=None)
    build_endo_neck(D)
    build_head(D)
    H, top = D["head_half"], D["top"]
    # huge pointed ears; his right one is cocked outward like the picture
    tri_ear("rightEar", "head", [H - 2.8, top - 0.4, 0.2], [0, 0, -42], 1, H - 2.8, top - 0.8, 6.4, 9.0, 1.1, "ear_inner")
    tri_ear("leftEar", "head", [-(H - 2.8), top - 0.4, 0.2], [0, 0, 6], -1, H - 2.8, top - 0.8, 6.4, 9.0, 1.1, "ear_inner")
    build_arms(D)
    build_wings(D)


def build_wings(D):
    """Bat wings behind the shoulders: a voxel spar up to a knob, a long spar out to the tip,
    and a scalloped membrane between them with three finger bones."""
    hd = D["torso_d"]
    shy = D["shoulder"][1]
    z = hd + 0.6
    P0 = (3.0, shy - 1.0)
    K = (P0[0] + 4.6, P0[1] + 8.4)
    T = (K[0] + 12.5, K[1] - 7.6)
    bottom0 = (P0[0] + 0.5, P0[1] - 11.0)

    def spar_y(x):
        if x <= K[0]:
            return P0[1] + (x - P0[0]) / (K[0] - P0[0]) * (K[1] - P0[1])
        return K[1] + (x - K[0]) / (T[0] - K[0]) * (T[1] - K[1])

    def bottom_y(x):
        u = (x - bottom0[0]) / (T[0] - bottom0[0])
        base = bottom0[1] + u * (T[1] - 0.6 - bottom0[1])
        return base + 2.0 * abs(math.sin(math.pi * (x - bottom0[0]) / 4.2))

    fingers = [(K, (K[0] - 3.0, bottom_y(K[0] - 3.0))), (K, (K[0] + 1.2, bottom_y(K[0] + 1.2))),
               (K, (K[0] + 5.4, bottom_y(K[0] + 5.4))), (K, (K[0] + 9.6, bottom_y(K[0] + 9.6)))]
    for s, side in ((1, "right"), (-1, "left")):
        w, tipb = f"{side}Wing", f"{side}WingTip"
        bone(w, "torso", [s * P0[0], P0[1], z], [0, s * 12, 0])
        bone(tipb, w, [s * K[0], K[1], z])
        # spars as voxel staircases
        n1 = 10
        pts = [(P0[0] + (K[0] - P0[0]) * k / n1, P0[1] + (K[1] - P0[1]) * k / n1, z) for k in range(n1 + 1)]
        voxel_chain(w, "spar_a", pts, [1.0] * len(pts), "fur", s)
        cube(w, "knob", [K[0] - 0.75, K[1] - 0.2, z - 0.75], [K[0] + 0.75, K[1] + 1.3, z + 0.75], "fur", s)
        n2 = 15
        pts = [(K[0] + (T[0] - K[0]) * k / n2, K[1] + (T[1] - K[1]) * k / n2, z) for k in range(1, n2 + 1)]
        voxel_chain(tipb, "spar_b", pts, [0.9] * len(pts), "fur", s)
        cube(tipb, "tip_knob", [T[0] - 0.6, T[1] - 0.6, z - 0.6], [T[0] + 0.6, T[1] + 0.6, z + 0.6], "fur", s)
        # membrane columns, one pixel wide
        x = bottom0[0]
        k = 0
        while x < T[0] - 0.5:
            yt, yb = spar_y(x + 0.5) - 0.3, bottom_y(x + 0.5)
            if yt - yb > 0.4:
                owner = w if x + 0.5 <= K[0] else tipb
                cube(owner, f"membrane{k + 1}", [x, yb, z - 0.18], [x + 1.0, yt, z + 0.18], "membrane", s,
                     painter=membrane_painter(fingers))
            x += 1.0
            k += 1


def build_crocodile():
    D = CH["crocodile"]
    start(D)
    build_legs(D, toes="claws", tip_mat="claw", sole_mat="sole")
    build_torso(D, chest_mat="vest")
    hd, hw = D["torso_d"], D["half_w"]
    c0, c1 = D["torso"]
    bx = D["belly"][0]
    for s in (1, -1):
        cube("torso", "lapel", [bx - 0.1, c0 + 1.0, -hd - 0.4], [bx + 0.7, c1 - 0.6, -hd - 0.05], "vest_dark", s)
    build_bowtie(D, c1 - 0.6, 3.9, mat="black", painter=None, z_extra=0.15)
    build_endo_neck(D)

    # ---- head: low skull, eyes on top, long snout with two rows of teeth ----------------------
    hp = D["head_pivot"]
    bone("head", "torso", [0, hp, 0])
    H, fz, back = D["head_half"], D["face_z"], D["back"]
    my = hp + 1.6                      # mouth line (top of the lower jaw)
    e0, e1 = my + 2.8, my + 5.2
    top = D["top"]                     # = my + 6.6
    px, py = 2.5, (e0 + e1) / 2
    cube("head", "skull", [-H, my, fz + 0.3], [H, e0, back], "fur")
    cube("head", "eye_band", [-H, e0, fz + 0.7], [H, e1, back], "fur", painter=socket_painter(px, py))
    cube("head", "nose_bridge", [-0.9, e0, fz], [0.9, e1, fz + 0.7], "fur")
    for s in (1, -1):
        cube("head", "socket_side", [4.2, e0, fz], [H, e1, fz + 0.7], "fur", s)
        cube("head", "eye_ridge", [0.6, e1, fz - 0.2], [4.6, e1 + 0.9, fz + 2.0], "fur_dark", s)
        cube("head", "brow", [0.9, e1 + 0.9, fz - 0.1], [4.2, e1 + 1.5, fz + 0.8], "black", s)
    cube("head", "cranium", [-H, e1, fz + 0.5], [H, top, back], "fur")
    L = 10.0
    cube("head", "snout_rear", [-4.3, my, fz - 5.0], [4.3, my + 2.7, fz + 0.4], "fur", painter=underside_painter("snout", "tan", my + 0.4))
    cube("head", "snout_front", [-3.7, my, fz - L], [3.7, my + 2.3, fz - 5.0], "fur", painter=underside_painter("snout", "tan", my + 0.4))
    for s in (1, -1):
        cube("head", "nostril", [0.5, my + 2.3, fz - L + 0.5], [1.7, my + 2.9, fz - L + 1.7], "fur_dark", s)
    cube("head", "mouth", [-3.4, my - 1.8, fz - L + 0.5], [3.4, my, back - 1.0], "mouth_red")
    k = 0
    for z in np.arange(fz - L + 1.6, fz - 0.4, 1.8):
        w = 3.7 if z < fz - 5.0 else 4.3
        for s in (1, -1):
            k += 1
            cube("head", f"tooth_upper{k}", [w - 0.8, my - 0.9, z], [w - 0.15, my, z + 0.65], "teeth", s)
    for i, x in enumerate((-2.4, -0.8, 0.8, 2.4)):
        cube("head", f"tooth_front{i + 1}", [x - 0.32, my - 1.0, fz - L + 0.15], [x + 0.32, my, fz - L + 0.8], "teeth")
    bone("jaw", "head", [0, my, back - 1.0], [-12, 0, 0])
    cube("jaw", "jaw_rear", [-4.3, my - 2.0, fz - 5.0], [4.3, my, back], "fur", painter=underside_painter("fur", "tan_light", my - 0.9))
    cube("jaw", "jaw_front", [-3.7, my - 1.8, fz - L - 0.4], [3.7, my, fz - 5.0], "fur", painter=underside_painter("fur", "tan_light", my - 0.9))
    cube("jaw", "tongue", [-2.4, my - 0.4, fz - 6.0], [2.4, my - 0.1, back - 1.4], "mouth_red")
    k = 0
    for z in np.arange(fz - L + 0.8, fz - 0.4, 1.8):
        w = 3.7 if z < fz - 5.0 else 4.3
        for s in (1, -1):
            k += 1
            cube("jaw", f"tooth_lower{k}", [w - 0.8, my, z], [w - 0.15, my + 0.9, z + 0.65], "teeth", s)
    for i, x in enumerate((-1.6, 0.0, 1.6)):
        cube("jaw", f"tooth_lower_front{i + 1}", [x - 0.32, my, fz - L - 0.3], [x + 0.32, my + 1.0, fz - L + 0.35], "teeth")
    bone("eyes", "head", [0, py, fz + 0.7])
    for s in (1, -1):
        cube("eyes", "pupil", [px - 0.42, py - 0.42, fz + 0.58], [px + 0.42, py + 0.42, fz + 0.7], "glow", s, painter=p_pupil)
    top_hat(D, [1.6, top, 0.6], [-6, 0, -16], crown_w=4.2, crown_h=3.6, brim_w=6.2, band_mat="hat_band")

    build_arms(D)
    build_spiked_tail(D)


def build_spiked_tail(D):
    """Thick tail out behind him and to his right, lying low, with spikes along the top."""
    parent = "body"
    x, y, z = 1.6, D["pelvis"][0] + 0.8, D["torso_d"]
    rots = [(30, 32), (-6, 6), (-6, 4), (-5, 4), (-4, 2), (-2, 2), (0, 2), (2, 0), (4, 0)]
    for k, (rx, ry) in enumerate(rots):
        name = f"tail{k}"
        bone(name, parent, [x, y, z], [rx, ry, 0])
        r = max(0.8, 2.2 - 0.17 * k)
        length = 2.8
        cube(name, f"tail_seg{k + 1}", [x - r, y - r * 0.85, z - 0.1], [x + r, y + r * 0.85, z + length], "fur",
             painter=underside_painter("fur", "tan", y - r * 0.85 + 0.6))
        sp = max(0.5, 1.0 - 0.06 * k)
        cube(name, f"spike{k + 1}", [x - sp / 2, y + r * 0.85, z + 0.6], [x + sp / 2, y + r * 0.85 + sp * 1.3, z + 0.6 + sp],
             "fur_dark")
        parent = name
        z += length


def build_fox():
    D = CH["fox"]
    start(D)
    build_legs(D)
    build_torso(D)
    build_endo_neck(D)
    # only his left eye glows: the right one is under the patch
    build_head(D, pupils=(-1,), crown="round")
    H, fz, top = D["head_half"], D["face_z"], D["top"]
    e0, e1 = D["eyes"]
    sx0, sx1 = D["socket"]
    cube("head", "eye_patch", [sx0 - 0.3, e0 - 0.3, fz - 0.4], [sx1 + 0.3, e1 + 0.3, fz + 0.1], "black")
    # the strap runs up across the forehead to the top edge, then back over the head
    sy = e1 + 0.8
    run = (top - sy) / math.tan(math.radians(16))
    cube("head", "patch_strap", [2.6 - run, sy - 0.3, fz - 0.3], [H + 0.1, sy + 0.3, fz + 0.05], "black",
         rot=[0, 0, -16], origin=[2.6, sy, fz])
    cube("head", "patch_strap_top", [2.3 - run, top - 0.05, fz - 0.3], [2.9 - run, top + 0.15, D["back"] + 0.1], "black")
    tri_ear("rightEar", "head", [H - 2.2, top - 0.4, 0.4], [0, 0, -16], 1, H - 2.2, top - 0.8, 5.2, 7.0, 1.2, "tan")
    tri_ear("leftEar", "head", [-(H - 2.2), top - 0.4, 0.4], [0, 0, 20], -1, H - 2.2, top - 0.8, 5.2, 7.0, 1.2, "tan")
    # tuft of thin spikes on top, and cheek tufts
    for k, (x0, h, rz, rx) in enumerate(((-1.6, 3.2, 26, -10), (-0.4, 3.8, 8, -14), (0.8, 3.4, -10, -8), (2.0, 2.6, -28, -6))):
        cube("head", f"tuft{k + 1}", [x0 - 0.35, top - 0.2, -2.6], [x0 + 0.35, top - 0.2 + h, -1.9], "fur",
             rot=[rx, 0, rz], origin=[x0, top - 0.2, -2.25])
    for s in (1, -1):
        for k, (y, rz) in enumerate(((D["snout"][0] + 1.2, 64), (D["snout"][0] + 0.2, 84), (D["snout"][0] - 0.8, 104))):
            cube("head", f"cheek_tuft{k + 1}", [H - 0.4, y - 0.35, -1.6], [H + 2.4, y + 0.35, -0.9], "fur", s,
                 rot=[0, 0, -(rz - 90) * 0.6], origin=[H - 0.4, y, -1.25])
    build_arms(D, hook_side="right", hook=fox_hook)
    build_fox_tail(D)


def fox_hook(hand, D, s):
    """Pirate hook in place of the right hand: cuff, shaft and a J-shaped curve opening forward."""
    wy = D["wrist_y"]
    px0, px1, py0, py1, pz = D["palm"]
    cx = (px0 + px1) / 2
    cube(hand, "hook_cuff", [cx - 1.6, wy - 2.2, -1.6], [cx + 1.6, wy + 0.4, 1.6], "black", s)
    cube(hand, "hook_ring", [cx - 1.2, wy - 2.9, -1.2], [cx + 1.2, wy - 2.2, 1.2], "chrome", s, painter=p_chrome)
    cube(hand, "hook_shaft", [cx - 0.55, wy - 7.6, -0.55], [cx + 0.55, wy - 2.9, 0.55], "hook", s)
    cy, cz, r = wy - 7.6, -1.9, 1.9
    pts = []
    for a in np.linspace(0.0, -1.3 * math.pi, 11):
        pts.append((cx, cy + r * math.sin(a), cz + r * math.cos(a)))
    voxel_chain(hand, "hook_curve", pts, [1.05] * len(pts), "hook", s)


def build_fox_tail(D):
    """Bushy tail: hangs down behind him, sweeps out past his right leg and curls up to a pale tip."""
    parent = "body"
    x, y, z = 1.6, D["pelvis"][0] + 1.2, D["torso_d"] - 0.6
    rots = [(56, 20), (-4, 6), (-8, 4), (-12, 2), (-14, 0)]
    thick = [3.6, 5.0, 6.0, 5.2, 3.4]
    seg = 3.6
    for k, ((rx, ry), r2) in enumerate(zip(rots, thick)):
        name = f"tail{k}"
        bone(name, parent, [x, y, z], [rx, ry, 0])
        r = r2 / 2
        cube(name, f"tail_seg{k + 1}", [x - r, y - r, z - 0.2], [x + r, y + r, z + seg], "tail_tip" if k >= 3 else "fur")
        parent = name
        z += seg


def build_bunny():
    D = CH["bunny"]
    start(D)
    build_legs(D)
    build_torso(D)
    build_bowtie(D, D["torso"][1] - 0.5, 3.7, mat="black", painter=None)
    build_endo_neck(D)
    build_head(D, upper_teeth=False, crown="round", cheek_puff=0.8)
    H, fz, top = D["head_half"], D["face_z"], D["top"]
    sn0, sz = D["snout"][0], D["snout_z"]
    # buck teeth
    for s in (1, -1):
        cube("head", "buck_tooth", [0.1, sn0 - 1.3, sz + 0.25], [1.15, sn0, sz + 1.0], "teeth", s)
        for k, x in enumerate((2.0, 3.2)):
            cube("head", f"tooth_upper{k + 1}", [x - 0.4, sn0 - 0.7, sz + 0.3], [x + 0.4, sn0, sz + 1.0], "teeth", s)
    # tall ears on piston joints; his right one is folded over at the joint
    for s, side, fold in ((1, "right", (-20, 0, -150)), (-1, "left", (0, 0, 0))):
        e, et = f"{side}Ear", f"{side}EarTop"
        bone(e, "head", [s * 2.6, top, 0.2], [0, 0, -s * 4])
        cube(e, "ear_base", [1.0, top, -0.7], [4.2, top + 5.6, 1.2], "fur", s, painter=frame_painter("ear_inner", "fur", rim=0.8,
                                                                                                    faces=("north",)))
        cube(e, "ear_joint", [2.0, top + 5.4, -0.3], [3.2, top + 6.4, 0.8], "chrome", s, painter=p_chrome)
        bone(et, e, [s * 2.6, top + 5.9, 0.2], list(fold))
        cube(et, "ear_top", [1.0, top + 6.2, -0.7], [4.2, top + 10.6, 1.2], "fur", s, painter=frame_painter("ear_inner", "fur", rim=0.8,
                                                                                                          faces=("north",)))
        cube(et, "ear_tip", [1.2, top + 10.6, -0.5], [4.0, top + 11.4, 1.0], "ear_inner", s)
    build_arms(D)


def build_goat():
    D = CH["goat"]
    start(D)
    build_legs(D, toes="hooves", n_toes=2, tip_mat="hoof", sole_mat="hoof")
    build_torso(D)
    hd, hw = D["torso_d"], D["half_w"]
    c0, c1 = D["torso"]
    bx = D["belly"][0]
    # open red vest: front panels, sides and back
    for s in (1, -1):
        cube("torso", "vest_front", [bx - 0.2, c0 + 0.4, -hd - 0.35], [hw + 0.2, c1 - 0.3, -hd + 0.2], "vest", s)
        cube("torso", "vest_side", [hw, c0 + 0.4, -hd + 0.2], [hw + 0.25, c1 - 0.3, hd + 0.1], "vest", s)
    cube("torso", "vest_back", [-hw - 0.25, c0 + 0.4, hd], [hw + 0.25, c1 - 0.3, hd + 0.3], "vest")
    cube("torso", "button", [-0.75, c0 + 5.0, -hd - 0.6], [0.75, c0 + 6.5, -hd - 0.25], "black")
    build_bowtie(D, c1 - 0.5, 3.6, mat="black", painter=None, z_extra=0.3)
    build_endo_neck(D)

    def beard():
        j0, sz = D["jaw"][0], D["snout_z"]
        for k, (x, ln) in enumerate(((-1.2, 2.6), (-0.4, 3.4), (0.4, 3.2), (1.2, 2.4), (-0.8, 2.0), (0.8, 2.2))):
            zz = sz + 0.8 + (0.6 if k >= 4 else 0.0)
            cube("jaw", f"beard{k + 1}", [x - 0.3, j0 - ln, zz], [x + 0.3, j0 + 0.1, zz + 0.6], "beard")

    build_head(D, after_jaw=beard, jaw_rest=-8, crown="taper")
    H, top = D["head_half"], D["top"]
    e1 = D["eyes"][1]
    # curled ram horns (front-facing spirals) from the top corners of the head
    for s, side in ((1, "right"), (-1, "left")):
        b = f"{side}Horn"
        bone(b, "head", [s * (H - 1.6), top, 0.0])
        cx, cy = H + 0.8, top - 1.4
        pts, sizes = [], []
        n = 26
        for k in range(n):
            u = k / (n - 1)
            th = math.radians(125 - 390 * u)
            r = 4.2 - 2.8 * u
            pts.append((cx + r * math.cos(th), cy + r * math.sin(th), -0.6 + 2.0 * u))
            sizes.append(1.9 - 0.9 * u)
        voxel_chain(b, "horn", pts, sizes, "horn", s)
    # floppy ears hanging from the sides, pink inside
    for s, side, rz in ((1, "right", 40), (-1, "left", 62)):
        e = f"{side}Ear"
        bone(e, "head", [s * H, e1 - 0.4, 0.6], [0, 0, s * rz])
        cube(e, "ear", [H - 0.2, e1 - 6.6, -0.5], [H + 2.6, e1 - 0.2, 0.5], "fur", s,
             painter=frame_painter("ear_inner", "fur", rim=0.6, faces=("north",)))
    build_arms(D, tip_mat="hoof")


def build_bear():
    D = CH["bear"]
    start(D)
    build_legs(D)
    build_torso(dict(D, buttons=None))
    hd = D["torso_d"]
    c0, c1 = D["torso"]
    bx = D["belly"][0]
    # round pot belly bulging out of the belly panel, one button above it and one on it
    cube("torso", "belly_bulge", [-bx + 0.9, c0 + 1.8, -hd - 1.0], [bx - 0.9, c1 - 4.8, -hd - 0.2], "tan")
    cube("torso", "belly_bulge_front", [-bx + 1.9, c0 + 2.8, -hd - 1.6], [bx - 1.9, c1 - 5.8, -hd - 0.9], "tan")
    cube("torso", "button1", [-0.95, c1 - 4.3, -hd - 0.6], [0.95, c1 - 2.4, -hd - 0.25], "black")
    cube("torso", "button2", [-0.95, c0 + 3.6, -hd - 1.95], [0.95, c0 + 5.5, -hd - 1.6], "black")
    build_bowtie(D, c1 - 0.6, 4.4, mat="black", painter=None)
    build_endo_neck(D)
    build_head(D)
    H, top = D["head_half"], D["top"]
    for s, side in ((1, "right"), (-1, "left")):
        e = f"{side}Ear"
        bone(e, "head", [s * (H - 1.0), top - 0.4, 0.4], [0, 0, -s * 10])
        cube(e, "ear", [H - 2.6, top - 0.6, -0.5], [H + 0.8, top + 3.0, 1.0], "fur", s,
             painter=frame_painter("black", "fur", rim=0.8, faces=("north",)))
    top_hat(D, [1.8, top, 0.2], [-4, 0, -14], crown_w=4.8, crown_h=4.0, brim_w=6.6)
    build_arms(D)


BUILDERS = {"monkey": build_monkey, "bat": build_bat, "crocodile": build_crocodile, "fox": build_fox,
            "bunny": build_bunny, "goat": build_goat, "bear": build_bear}

TITLES = {"monkey": "MONKEY", "bat": "BAT", "crocodile": "CROCODILE", "fox": "FOX", "bunny": "BUNNY", "goat": "GOAT",
          "bear": "BEAR"}

EGGS = {"monkey": ("#7a3020", "#c08860"), "bat": ("#5a3460", "#b08aa0"), "crocodile": ("#5a6e30", "#9a1c22"),
        "fox": ("#a8302a", "#d8b8a4"), "bunny": ("#5c3c84", "#b4a0b4"), "goat": ("#b0907e", "#8c1e1e"),
        "bear": ("#6e2e1c", "#202022")}


def tail_names(name):
    return {"monkey": [f"tail{k}" for k in range(11)], "crocodile": [f"tail{k}" for k in range(9)],
            "fox": [f"tail{k}" for k in range(5)]}.get(name, [])


def spec(name):
    from characters import cast_anims

    D = CH[name]
    px0, px1, py0, py1, pz = D["palm"]
    return export.Character(
        model_id=name,
        entity_id=f"fnaf:{name}",
        out_dir=os.path.join(export.TOOLS_DIR, "..", name),
        materials=MATERIALS[name],
        build_geometry=BUILDERS[name],
        build_anims=lambda: cast_anims.CLIPS[name](name).build(name),
        sources=[os.path.abspath(__file__), os.path.join(HERE, "cast_anims.py"), os.path.join(HERE, "night.py"),
                 os.path.join(HERE, "body.py"), name],
        spawn_egg=EGGS[name],
        variant_states={"pose1": 1, "pose2": 2, "performance1": 3, "performance2": 4, "jumpscare1": 5, "jumpscare2": 6},
        arm=dict(palm=((px0 + px1) / 2, (py0 + py1) / 2, 0.0),
                 chest=dict(half_x=D["half_w"] + 1.2, z=(-D["torso_d"] - 1.2, D["torso_d"] + 0.8),
                            y=(D["torso"][0] - 3.0, D["torso"][1]))),
        visible_box=(6, 5, 2.5),
        atlas_width=1024,
        tpu=4,
    )
