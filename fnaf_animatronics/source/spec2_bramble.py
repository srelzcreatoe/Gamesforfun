"""Bramble - purple rabbit animatronic. Hand-built cubes (Blockbench units), proportions measured
from the reference picture (40 px = 1 unit); textures are designed palettes and pixel decals."""
import numpy as np
from bbgen2 import Model2, Mat, flat, rect, pixels
import rig2

FUR = Mat((94, 62, 102), accent=(108, 56, 92), accent_p=0.14)
M = dict(
    fur=FUR,
    leg=Mat((100, 48, 70), accent=(104, 56, 92), accent_p=0.12),
    hip=Mat((68, 26, 38)),
    belly=Mat((186, 150, 160), tones=(1.04, 1.0, 0.96, 0.92)),
    muzzle=Mat((198, 162, 170), tones=(1.04, 1.0, 0.96, 0.92)),
    mask=Mat((142, 104, 128), tones=(1.04, 1.0, 0.95, 0.9)),
    earin=Mat((164, 130, 148), tones=(1.04, 1.0, 0.95, 0.9)),
    black=Mat((26, 20, 30), tones=(1.25, 1.0, 0.85, 0.8)),
    metal=Mat((60, 60, 68), tones=(1.45, 1.0, 0.85, 0.7), weights=(0.2, 0.4, 0.25, 0.15)),
    tie=Mat((138, 26, 42), tones=(1.08, 1.0, 0.92, 0.85)),
    teeth=Mat((230, 220, 198), tones=(1.0, 0.97, 0.93, 0.9)),
    sole=Mat((178, 156, 170), tones=(1.05, 1.0, 0.94, 0.88)),
    mouth=Mat((72, 22, 34)),
)
D = dict(
    hip_y=13.5, waist_y=15.5, neck_y=23.5, jaw_pivot=(0, 24.25, -1.0),
    pelvis=(4.0, 12.5, 15.5, -2.5, 3.0), waistband=(14.75, 15.5),
    chest=(4.25, 15.5, 23.5, -3.0, 3.5), belly=(2.5, 16.5, 22.0, -3.5, -1.0),
    neck=(1.25, 23.0, 24.5), shoulder=(3.5, 5.0, 23.0, 25.0, 1.5),
    shoulder_p=(4.75, 22.5), upper=(4.25, 7.75, 19.0, 24.0, 1.75),
    elbow_p=(5.75, 18.75), forearm=(4.5, 8.0, 14.25, 18.75, 1.75),
    wrist_p=(6.5, 14.0), palm=(5.0, 8.5, 11.0, 14.0, 1.5),
    fingers=[(5.25, 6.25, 9.5, 11.0), (6.25, 7.25, 9.0, 11.0), (7.25, 8.25, 9.0, 11.0)], finger_z=1.25,
    thumb=(5.75, 6.75, 10.5, 12.5, -2.0, -0.5),
    hip_p=(2.75, 13.5), thigh=(0.5, 5.0, 9.0, 14.0, 2.25),
    knee_p=(2.75, 8.75), shin=(0.75, 5.25, 4.25, 8.75, 2.25), ankle_p=(3.0, 4.0),
    foot=dict(cover=(1.5, 5.5, 3.0, 4.0, -2.5, 1.5), body=(0.75, 8.25, 0.5, 3.0, -2.0, 2.0),
              toes=[(0.75, 3.25), (3.25, 5.75), (5.75, 8.25)], toe_y=(0.5, 2.5), toe_z=(-5.5, -1.5),
              sole=(0.5, 8.5, 0.0, 0.5, -5.75, 2.25)),
)


def unrot(m, bone, p):
    q = np.linalg.inv(m.bone_world(bone)) @ np.r_[p, 1.0]
    return q[:3]


def build():
    m = Model2('bramble', density=2, seed=11)
    rig2.skeleton(m, D)
    tie = M['tie']
    straps = rect(2.75, 3.25, -99, 99, tie, faces=('north', 'south', 'up'), absx=True)
    rig2.body(m, D, M, chest_deco=[straps])

    # ---------------- head ----------------
    fur = M['fur']
    m.box('head', 'cranium', -4, 4, 25.5, 31.5, -4, 4, fur, r=0.5)
    m.box('head', 'crown', -3, 3, 31.5, 32.5, -3, 3.5, fur)
    m.box('head', 'top_cap', -1.75, 1.75, 32.5, 33.0, -2, 2.5, fur)
    m.box('head', 'cheeks', -4.5, 4.5, 26.5, 29.5, -3.5, 1, fur)
    m.box('head', 'jowl', -4, 4, 24.0, 25.5, -3.5, 1.5, fur)
    soft = M['mask'].scaled(0.72)
    m.box('head', 'mask', -2.75, 2.75, 27.0, 30.5, -4.5, -4.0, M['mask'], deco=[
        rect(0.25, 2.25, 27.5, 29.5, M['black'], absx=True),                      # eye sockets
        pixels([(0.5, 27.75), (2.0, 27.75), (0.5, 29.25), (2.0, 29.25)], soft, absx=True),  # rounded corners
        rect(-0.25, 0.25, 27.0, 29.75, fur),                                       # nose bridge
    ])
    for x0, x1, glint in ((0.75, 1.75, (1.5, 28.75)), (-1.75, -0.75, (-1.0, 28.75))):
        m.box('head', f'eye{"_r" if x0 > 0 else "_l"}', x0, x1, 28.0, 29.0, -4.75, -4.5, flat((178, 20, 30)), deco=[
            pixels([glint], (238, 168, 168)),
            pixels([(x1 - 0.25 if x0 < 0 else x0 + 0.25, 28.25)], (110, 8, 16)),
        ])
    m.box('head', 'muzzle', -2.75, 2.75, 24.5, 27.0, -6, -3.5, M['muzzle'], r=0.5, faces={'down': M['mouth']}, deco=[
        pixels([(1.5, 25.75), (2.0, 25.25), (1.0, 25.25)], (62, 44, 58), absx=True),   # whisker dots
        pixels([(0, 25.25), (0, 25.75)], (92, 58, 78)),                              # philtrum
    ])
    m.box('head', 'nose', -0.75, 0.75, 26.0, 27.0, -6.5, -5.5, M['black'], deco=[pixels([(0.5, 26.75)], (82, 70, 90))])
    m.box('head', 'mouth', -2.0, 2.0, 22.75, 24.25, -5.25, -1.5, M['mouth'])
    m.box('jaw', 'jaw', -2.25, 2.25, 22.5, 24.0, -5.5, -1.0, fur.scaled(0.86), faces={'up': M['mouth']})
    m.box('jaw', 'teeth', -2.25, 2.25, 24.0, 24.5, -5.75, -5.0, M['teeth'], deco=[
        pixels([(-1.5, 24.25), (-0.5, 24.25), (0.5, 24.25), (1.5, 24.25)], (128, 104, 96))])

    # ---------------- ears ----------------
    m.bone('ear_right', 'head', (2.75, 31.75, -0.75), rot=(0, 0, -12))
    m.box('ear_right', 'ear_r', 0.75, 4.75, 31.75, 37.25, -1.5, 0, fur, r=0.5)
    m.box('ear_right', 'ear_inner_r', 1.75, 3.75, 32.75, 36.75, -1.75, -1.5, M['earin'])
    m.box('ear_right', 'ear_stalk_r', 2.5, 3.0, 31.0, 32.0, -1.0, -0.5, M['metal'])
    m.bone('ear_left', 'head', (-2.5, 31.5, -0.75), rot=(0, 0, 28))
    m.box('ear_left', 'ear_base_l', -3.75, -1.25, 31.5, 34.0, -1.5, 0, fur, r=0.5)
    m.box('ear_left', 'ear_inner_l', -3.25, -1.75, 32.0, 33.5, -1.75, -1.5, M['earin'])
    px, py, pz = unrot(m, 'ear_left', (-5.075, 33.95, -0.75))
    px, py = round(px * 4) / 4, round(py * 4) / 4
    m.bone('ear_left_tip', 'ear_left', (px, py, -0.75), rot=(0, 0, 131.5))
    m.box('ear_left_tip', 'ear_tip_l', px - 1.5, px + 1.5, py - 0.25, py + 4.25, -1.5, 0, fur, r=0.5)

    # ---------------- bowtie ----------------
    m.box('torso', 'bowtie', -2.0, 2.0, 21.5, 23.0, -4.0, -3.0, tie, deco=[
        rect(-99, 99, 22.5, 23.0, tie.scaled(1.15)), rect(-99, 99, 21.5, 22.0, tie.scaled(0.8)),
        rect(0.5, 1.0, 21.5, 23.0, tie.scaled(0.62), absx=True)])
    m.box('torso', 'knot', -0.5, 0.5, 21.75, 22.75, -4.25, -3.5, tie.scaled(0.85))
    return m
