"""Gildric - withered golden bear with top hat and open endoskeleton hands. Hand-built cubes
(Blockbench units), proportions measured from the reference picture (40 px = 1 unit)."""
from bbgen2 import Model2, Mat, flat, rect, pixels
from spec2_hollis import round_ear
import rig2

SPOT = (54, 34, 14)
FUR = Mat((178, 110, 26), accent=(138, 80, 18), accent_p=0.12, spot=SPOT, spot_p=0.015)
M = dict(
    fur=FUR,
    leg=Mat((166, 100, 24), accent=(128, 74, 16), accent_p=0.12, spot=SPOT, spot_p=0.015),
    hip=Mat((112, 66, 18), accent=(84, 48, 12), accent_p=0.16),
    belly=Mat((204, 148, 64), accent=(166, 110, 40), accent_p=0.14, spot=(96, 62, 26), spot_p=0.03),
    muzzle=Mat((210, 152, 66), accent=(172, 116, 44), accent_p=0.12),
    earin=Mat((208, 148, 58)),
    black=Mat((24, 20, 16), tones=(1.25, 1.0, 0.85, 0.8)),
    hat=Mat((38, 36, 34), tones=(1.15, 1.0, 0.9, 0.82)),
    metal=Mat((56, 58, 62), tones=(1.5, 1.0, 0.85, 0.7), weights=(0.2, 0.4, 0.25, 0.15)),
    tie=Mat((26, 26, 26), tones=(1.3, 1.0, 0.88, 0.8)),
    teeth=Mat((188, 194, 204), tones=(1.0, 0.97, 0.93, 0.9)),
    sole=Mat((112, 80, 52), tones=(1.05, 1.0, 0.94, 0.88)),
    mouth=Mat((62, 28, 14)),
)
D = dict(
    hip_y=13.75, waist_y=16.0, neck_y=26.5, jaw_pivot=(0, 27.0, -1.0),
    pelvis=(5.0, 13.5, 16.0, -2.75, 3.25), waistband=(15.25, 16.0),
    chest=(4.5, 16.0, 26.0, -3.25, 3.75), belly=(3.5, 17.0, 24.0, -3.75, -1.25),
    neck=(1.25, 26.0, 27.5), shoulder=(3.0, 5.0, 25.5, 27.5, 1.75),
    shoulder_p=(5.25, 25.25), upper=(4.5, 8.5, 20.5, 26.5, 2.0),
    elbow_p=(6.75, 20.25), forearm=(5.25, 9.25, 16.0, 20.0, 2.0),
    wrist_p=(8.0, 15.75),
    hip_p=(2.75, 13.75), thigh=(0.75, 5.25, 10.0, 14.0, 2.25),
    knee_p=(3.0, 9.75), shin=(0.75, 5.25, 4.5, 9.5, 2.25), ankle_p=(3.25, 4.25),
    foot=dict(cover=(1.0, 6.0, 3.5, 4.5, -2.5, 1.5), body=(1.0, 8.5, 1.0, 3.5, -2.0, 2.0),
              toes=[(1.0, 3.5), (3.5, 6.0), (6.0, 8.5)], toe_y=(1.0, 3.0), toe_z=(-5.5, -1.5),
              sole=(0.75, 8.75, 0.0, 1.0, -5.75, 2.25)),
)

# open hand (character-right instance): finger centre x, rest splay (deg, + = outward)
FINGERS = [('finger1', 10.25, 8), ('finger2', 9.0, 3), ('finger3', 7.75, -3)]


def open_hand(m, s, k, X, sfx):
    fur, metal = M['fur'], M['metal']
    m.box(f'hand_{s}', 'palm' + sfx, *X(7.25, 10.25), 13.0, 15.5, -1.5, 1.5, fur, r=0.5)
    for name, cx, splay in FINGERS:
        b = f'{name}_{s}'
        m.bone(b, f'hand_{s}', (k * cx, 13.0, 0), rot=(0, 0, k * splay))
        segs = [(11.0, 12.5), (9.5, 10.5), (7.5, 9.0)]
        joints = [(12.5, 13.0), (10.5, 11.0), (9.0, 9.5)]
        for i, (y0, y1) in enumerate(segs):
            m.box(b, f'{b}_seg{i}', *X(cx - 0.5, cx + 0.5), y0, y1, -0.75, 0.75, fur)
        for i, (y0, y1) in enumerate(joints):
            m.box(b, f'{b}_joint{i}', *X(cx - 0.25, cx + 0.25), y0, y1, -0.25, 0.25, metal)
    b = f'thumb_{s}'
    m.bone(b, f'hand_{s}', (k * 6.75, 14.25, 0), rot=(0, 0, -k * 10))
    m.box(b, f'{b}_seg0', *X(6.0, 7.0), 12.75, 14.25, -1.25, 0.25, fur)
    m.box(b, f'{b}_joint0', *X(6.25, 6.75), 12.25, 12.75, -0.75, -0.25, metal)
    m.box(b, f'{b}_seg1', *X(5.75, 6.75), 10.75, 12.25, -1.25, 0.25, fur)


def build():
    m = Model2('gildric', density=2, seed=37)
    rig2.skeleton(m, D)
    stains = [rect(-2.0, -0.5, 18.5, 19.5, Mat((120, 76, 24)), faces=('north',)),
              rect(1.0, 2.5, 22.0, 22.5, Mat((120, 76, 24)), faces=('north',))]
    rig2.body(m, D, M, hand=open_hand, belly_deco=stains)
    fur, black = M['fur'], M['black']

    # ---------------- head ----------------
    m.box('head', 'head_top', -3.0, 3.0, 31.5, 34.0, -3.5, 3.5, fur, r=0.5,
          deco=[rect(-1.5, -0.5, 32.5, 33.0, Mat(SPOT)), rect(1.0, 1.5, 33.0, 33.5, Mat((120, 72, 20)))])
    m.box('head', 'cranium', -3.75, 3.75, 28.0, 31.5, -4, 4, fur, r=0.5)
    m.box('head', 'cheeks', -4.5, 4.5, 28.5, 30.5, -3.5, 1, fur)
    m.box('head', 'jowl', -3.5, 3.5, 26.5, 28.0, -3.5, 1.5, fur)
    streak = (30, 20, 10)
    m.box('head', 'brow', -3.0, 3.0, 29.5, 32.0, -4.5, -4.0, fur.scaled(1.05), deco=[
        rect(0.5, 2.5, 29.5, 31.5, black, absx=True),                                   # eye sockets
        pixels([(0.75, 31.25), (2.25, 31.25)], fur.scaled(0.7), absx=True)])
    for x0, x1, glint in ((0.75, 1.75, (1.5, 30.75)), (-1.75, -0.75, (-1.0, 30.75))):
        m.box('head', f'eye{"_r" if x0 > 0 else "_l"}', x0, x1, 30.0, 31.0, -4.75, -4.5, flat((112, 44, 32)), deco=[
            pixels([glint], (232, 228, 222)),
            pixels([(x1 - 0.25 if x0 < 0 else x0 + 0.25, 30.25)], (58, 18, 12))])
    m.box('head', 'muzzle', -2.75, 2.75, 27.5, 29.5, -6, -3.5, M['muzzle'], r=0.5, faces={'down': M['mouth']}, deco=[
        rect(2.0, 2.5, 27.5, 29.5, streak, absx=True), rect(0.5, 1.0, 28.5, 29.5, streak, absx=True)])
    m.box('head', 'nose', -0.75, 0.75, 28.75, 29.75, -6.5, -5.5, black, deco=[pixels([(0.5, 29.5)], (80, 70, 60))])
    m.box('head', 'mouth', -2.0, 2.0, 25.75, 27.5, -5.25, -1.5, M['mouth'])
    m.box('jaw', 'jaw', -2.5, 2.5, 25.5, 26.5, -5.5, -1.0, fur.scaled(0.88), faces={'up': M['mouth']})
    m.box('jaw', 'teeth', -2.25, 2.25, 26.5, 27.0, -5.75, -5.0, M['teeth'], deco=[
        pixels([(-1.0, 26.75), (0.0, 26.75), (1.0, 26.75)], (92, 96, 104))])

    # ---------------- hat ----------------
    m.bone('hat', 'head', (0, 34.0, -0.25))
    m.box('hat', 'brim', -2.5, 2.5, 34.0, 35.0, -2.75, 2.25, M['hat'])
    m.box('hat', 'crown', -1.75, 1.75, 35.0, 37.5, -2.0, 1.5, M['hat'], r=0.5)

    # ---------------- ears: golden rim, dark ring, golden centre ----------------
    for s, k in (('right', 1), ('left', -1)):
        ex, ey = k * 4.75, 33.5
        ring = (lambda ex, ey: lambda fd, P, i, j, W, H:
                (40, 26, 12) if fd == 'north' and 1.0 <= max(abs(P[0] - ex), abs(P[1] - ey)) < 1.5 else None)(ex, ey)
        m.bone(f'ear_{s}', 'head', (k * 3.25, 33.25, -0.25))
        round_ear(m, f'ear_{s}', ex, ey, M, M['earin'], ring=ring)
        m.box(f'ear_{s}', f'ear_joint_{s}', *sorted((k * 2.75, k * 3.25)), 32.75, 33.25, -0.5, 0, M['metal'])

    # ---------------- bowtie + buttons ----------------
    tie = M['tie']
    m.box('torso', 'bowtie', -2.25, 2.25, 23.75, 25.25, -4.25, -3.25, tie, deco=[
        rect(-99, 99, 24.75, 25.25, tie.scaled(1.4)), rect(0.5, 1.0, 23.75, 25.25, tie.scaled(0.7), absx=True)])
    m.box('torso', 'knot', -0.5, 0.5, 24.0, 25.0, -4.5, -3.75, tie.scaled(1.2))
    for i, y in enumerate((22.25, 20.75)):
        m.box('torso', f'button{i}', -0.5, 0.5, y, y + 1.0, -4.0, -3.5, black, deco=[pixels([(0.25, y + 0.75)], (88, 84, 80))])
    return m
