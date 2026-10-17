"""Hollis - red-brown bear animatronic with top hat. Hand-built cubes (Blockbench units),
proportions measured from the reference picture (40 px = 1 unit); designed pixel textures."""
from bbgen2 import Model2, Mat, flat, rect, pixels
import rig2

FUR = Mat((110, 50, 56), accent=(96, 42, 60), accent_p=0.14)
M = dict(
    fur=FUR,
    leg=Mat((102, 44, 48), accent=(90, 40, 56), accent_p=0.12),
    hip=Mat((80, 34, 38)),
    belly=Mat((188, 144, 132), tones=(1.04, 1.0, 0.96, 0.92)),
    muzzle=Mat((184, 130, 118), tones=(1.04, 1.0, 0.96, 0.92)),
    mask=Mat((182, 130, 118), tones=(1.04, 1.0, 0.95, 0.9)),
    earin=Mat((176, 124, 112), tones=(1.04, 1.0, 0.95, 0.9)),
    black=Mat((26, 22, 24), tones=(1.25, 1.0, 0.85, 0.8)),
    hat=Mat((38, 28, 36), tones=(1.15, 1.0, 0.9, 0.82)),
    metal=Mat((60, 60, 66), tones=(1.45, 1.0, 0.85, 0.7), weights=(0.2, 0.4, 0.25, 0.15)),
    tie=Mat((28, 26, 28), tones=(1.3, 1.0, 0.88, 0.8)),
    teeth=Mat((228, 216, 196), tones=(1.0, 0.97, 0.93, 0.9)),
    sole=Mat((156, 112, 106), tones=(1.05, 1.0, 0.94, 0.88)),
    mouth=Mat((66, 20, 24)),
)
D = dict(
    hip_y=13.75, waist_y=15.5, neck_y=25.0, jaw_pivot=(0, 25.5, -1.0),
    pelvis=(5.0, 13.0, 15.5, -2.75, 3.25), waistband=(14.75, 15.5),
    chest=(5.0, 15.5, 24.5, -3.25, 3.75), belly=(3.25, 15.75, 22.75, -3.75, -1.25),
    neck=(1.25, 24.5, 26.0), shoulder=(3.5, 5.5, 24.5, 26.5, 1.75),
    shoulder_p=(5.25, 23.75), upper=(4.25, 8.25, 19.75, 25.25, 2.0),
    elbow_p=(6.75, 19.75), forearm=(5.5, 9.5, 15.0, 19.5, 2.0),
    wrist_p=(8.0, 14.75), palm=(6.0, 10.0, 12.0, 15.0, 1.75),
    fingers=[(6.5, 7.5, 9.5, 12.0), (7.5, 8.5, 9.0, 12.0), (8.5, 9.5, 9.5, 12.0)], finger_z=1.5,
    thumb=(5.5, 6.5, 10.5, 13.0, -2.25, -0.75),
    hip_p=(3.0, 13.75), thigh=(0.75, 5.25, 9.25, 14.25, 2.5),
    knee_p=(3.25, 9.0), shin=(1.25, 5.75, 4.5, 9.0, 2.25), ankle_p=(3.5, 4.25),
    foot=dict(cover=(2.0, 7.0, 3.0, 4.0, -2.5, 1.5), body=(1.5, 9.0, 0.5, 3.0, -2.0, 2.0),
              toes=[(1.5, 4.0), (4.0, 6.5), (6.5, 9.0)], toe_y=(0.5, 2.5), toe_z=(-5.5, -1.5),
              sole=(1.25, 9.25, 0.0, 0.5, -5.75, 2.25)),
)


def round_ear(m, bone, cx, cy, M, inner, ring=None, z=(-0.75, 0.25)):
    """stepped disc ear built from stacked rows (no overlapping coplanar faces)"""
    fur = M['fur']
    deco = [ring] if ring else []
    rows = [(1.75, -1.0, 1.0), (1.25, 1.0, 1.5), (1.25, -1.5, -1.0), (0.75, 1.5, 2.0), (0.75, -2.0, -1.5)]
    for i, (hw, y0, y1) in enumerate(rows):
        m.box(bone, f'{bone}_{i}', cx - hw, cx + hw, cy + y0, cy + y1, z[0], z[1], fur, deco=deco)
    if inner:
        m.box(bone, f'{bone}_inner', cx - 1.0, cx + 1.0, cy - 1.0, cy + 1.0, z[0] - 0.25, z[0], inner)


def build():
    m = Model2('hollis', density=2, seed=23)
    rig2.skeleton(m, D)
    rig2.body(m, D, M)
    fur, black = M['fur'], M['black']

    # ---------------- head ----------------
    m.box('head', 'head_top', -3.25, 3.25, 31.5, 33.5, -3.5, 3.5, fur, r=0.5)
    m.box('head', 'cranium', -4.25, 4.25, 26.5, 31.5, -4, 4, fur, r=0.5)
    m.box('head', 'cheeks', -4.75, 4.75, 28.25, 30.25, -3.5, 1, fur)
    m.box('head', 'jowl', -3.5, 3.5, 25.0, 26.5, -3.5, 1.5, fur)
    soft = M['mask'].scaled(0.7)
    m.box('head', 'mask', -3.0, 3.0, 28.5, 31.5, -4.5, -4.0, M['mask'], deco=[
        rect(0.5, 2.5, 28.5, 31.0, black, absx=True),                       # eye sockets
        pixels([(0.75, 30.75), (2.25, 30.75)], soft, absx=True),           # rounded upper corners
    ])
    for x0, x1, glint in ((1.0, 2.0, (1.75, 30.25)), (-2.0, -1.0, (-1.25, 30.25))):
        m.box('head', f'eye{"_r" if x0 > 0 else "_l"}', x0, x1, 29.5, 30.5, -4.75, -4.5, flat((176, 22, 30)), deco=[
            pixels([glint], (236, 170, 170)),
            pixels([(x1 - 0.25 if x0 < 0 else x0 + 0.25, 29.75)], (106, 8, 14))])
    m.box('head', 'muzzle', -3.0, 3.0, 26.0, 28.5, -6, -3.5, M['muzzle'], r=0.5, faces={'down': M['mouth']}, deco=[
        pixels([(1.75, 27.25), (2.25, 26.75), (1.25, 26.75)], (58, 36, 34), absx=True)])   # whisker dots
    m.box('head', 'nose', -1.0, 1.0, 28.0, 29.0, -6.5, -5.5, black, deco=[pixels([(0.75, 28.75)], (84, 72, 76))])
    m.box('head', 'mouth', -2.5, 2.5, 24.25, 26.0, -5.25, -1.5, M['mouth'])
    m.box('jaw', 'jaw', -2.75, 2.75, 24.0, 25.0, -5.5, -1.0, fur.scaled(0.9), faces={'up': M['mouth']})
    m.box('jaw', 'teeth', -2.25, 2.25, 25.0, 25.5, -5.75, -5.0, M['teeth'], deco=[
        pixels([(-1.0, 25.25), (0.0, 25.25), (1.0, 25.25)], (120, 96, 88))])

    # ---------------- hat ----------------
    m.bone('hat', 'head', (0, 33.5, -0.25))
    m.box('hat', 'brim', -2.75, 2.75, 33.5, 34.5, -3.0, 2.5, M['hat'])
    m.box('hat', 'crown', -2.0, 2.0, 34.5, 37.0, -2.25, 1.75, M['hat'], r=0.5,
          deco=[rect(-99, 99, 34.5, 35.0, Mat((86, 30, 38)), faces=('north', 'south', 'east', 'west'))])

    # ---------------- ears ----------------
    for s, k in (('right', 1), ('left', -1)):
        m.bone(f'ear_{s}', 'head', (k * 3.75, 33.0, -0.25))
        round_ear(m, f'ear_{s}', k * 5.25, 33.25, M, M['earin'])
        m.box(f'ear_{s}', f'ear_joint_{s}', *sorted((k * 3.0, k * 4.0)), 32.75, 33.75, -0.5, 0, M['metal'])

    # ---------------- bowtie + buttons ----------------
    tie = M['tie']
    m.box('torso', 'bowtie', -2.5, 2.5, 22.5, 24.0, -4.25, -3.25, tie, deco=[
        rect(-99, 99, 23.5, 24.0, tie.scaled(1.4)), rect(0.5, 1.0, 22.5, 24.0, tie.scaled(0.7), absx=True)])
    m.box('torso', 'knot', -0.5, 0.5, 22.75, 23.75, -4.5, -3.75, tie.scaled(1.2))
    for i, y in enumerate((21.0, 19.5)):
        m.box('torso', f'button{i}', -0.5, 0.5, y, y + 1.0, -4.0, -3.5, black, deco=[pixels([(0.25, y + 0.75)], (90, 86, 92))])
    return m
