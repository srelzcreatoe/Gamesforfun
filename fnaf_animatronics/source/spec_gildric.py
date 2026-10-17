"""Gildric - withered golden bear animatronic with top hat and open endoskeleton hands.
Coordinates are reference-image pixels (gildric_ref.png, 1152x1536); 40 px = 1 Blockbench
unit; z negative = towards the viewer. Finer voxels in this picture -> 3 texels per unit."""
from bbgen import Model
import rig

# open skeletal hand, viewer-left (character right) instance: (x0, x1, y0, y1) boxes
PALM = (166, 296, 882, 988)
FINGERS = {
    'finger1': dict(pivot=(160, 990), segs=[(137, 184, 994, 1044), (131, 176, 1057, 1104), (137, 184, 1117, 1171)],
                    joints=[(146, 176, 984, 996), (145, 170, 1044, 1057), (141, 168, 1104, 1117)]),
    'finger2': dict(pivot=(203, 995), segs=[(181, 223, 1004, 1051), (177, 224, 1067, 1111), (191, 247, 1127, 1191)],
                    joints=[(188, 218, 988, 1004), (186, 214, 1051, 1067), (192, 218, 1111, 1127)]),
    'finger3': dict(pivot=(252, 995), segs=[(231, 271, 1004, 1051), (231, 277, 1067, 1114), (251, 307, 1121, 1171)],
                    joints=[(238, 266, 988, 1004), (238, 264, 1051, 1067), (247, 272, 1114, 1121)]),
    'thumb': dict(pivot=(296, 930), segs=[(297, 357, 924, 981), (317, 361, 997, 1071)],
                  joints=[(318, 345, 981, 997)]),
}


def open_hand(m, s, X, xs, mrows):
    m.box(f'hand_{s}', f'palm_{s}', *xs(PALM[0], PALM[1]), PALM[2], PALM[3], -55, 55, 'fur', r=1)
    for fname, f in FINGERS.items():
        b = f'{fname}_{s}'
        m.bone(b, f'hand_{s}', (X(f['pivot'][0]), f['pivot'][1], 0))
        for i, (a, c, y0, y1) in enumerate(f['segs']):
            m.box(b, f'{b}_seg{i}', *xs(a, c), y0, y1, -32, 32, 'fur')
        for i, (a, c, y0, y1) in enumerate(f['joints']):
            m.box(b, f'{b}_joint{i}', *xs(a, c), y0, y1, -22, 22, 'metal')


def build(ref):
    m = Model('gildric', ref, cx=575, ground=1506, ppu=40, density=3, seed=37)
    m.palette({
        'fur': dict(region=[(480, 150, 670, 228), (280, 560, 380, 640), (210, 740, 330, 830)], pct=(8, 95)),
        'leg': dict(region=[(390, 980, 520, 1080), (380, 1160, 520, 1290)], pct=(8, 95)),
        'belly': dict(region=(470, 650, 690, 820), pct=(8, 95)),
        'muzzle': dict(region=[(500, 355, 540, 395), (615, 355, 655, 395)]),
        'earin': dict(region=(355, 140, 420, 200)),
        'hat': dict(region=(515, 10, 640, 90)),
        'black': dict(c=[(20, 16, 12), (30, 24, 18), (26, 20, 16)]),
        'metal': dict(c=[(40, 42, 46), (62, 64, 70), (52, 54, 58)]),
        'teeth': dict(region=(505, 432, 660, 443)),
        'tie': dict(region=(500, 505, 560, 550)),
        'sole': dict(region=(240, 1470, 510, 1495)),
        'hip': dict(region=(420, 880, 730, 940), pct=(8, 95)),
        'mouth': dict(c=[(30, 16, 10), (44, 24, 14), (36, 20, 12)]),
        'eye': dict(c=[(10, 8, 6)]),
    })
    cx = m.cx
    P = dict(
        hip_y=950, waist_y=870, neck_y=470, jaw_y=432,
        shoulder=(372, 492), elbow=(300, 702), wrist=(252, 872),
        hip=(460, 955), knee=(460, 1110), ankle=(445, 1328),
        ua=(446, 692, 225, 410, 320), elbow_box=(272, 330, 685, 718),
        fa=(712, 872, 180, 385, 280), wrist_box=(235, 268, 856, 886),
        th=(950, 1100, 355, 560, 460), knee_box=(426, 500, 1095, 1130),
        sh=(1115, 1322, 340, 545, 450), ankle_box=(410, 480, 1316, 1338),
        foot=dict(top=(335, 530, 1330, 1368), mid=(290, 535, 1362, 1400),
                  toes=((240, 326), (326, 410), (410, 530)), toe_y=(1367, 1467), sole=(230, 535, 1462, 1506)),
    )
    rig.skeleton(m, P)
    m.bone('hat', 'head', (cx, 142, -10))
    m.bone('ear_right', 'head', (445, 170, -10))
    m.bone('ear_left', 'head', (m.mx(445), 170, -10))

    # ---------------- head ----------------
    def head_z(yt, yb, xl, xr, maxw):
        if yb <= 160: return (-140, 140)
        if yt >= 272 and yb <= 372: return (-165, 40)   # cheek bulge only at the front
        return (-165, 165)
    rows = m.rows(142, 240, 453, 700, None) + m.rows(240, 376, 395, 756, None, sym='left')
    m.stack('head', 'skull', rows, -165, 165, 'fur', centred=True, zfun=head_z)
    m.box('head', 'skull_back', 426, 726, 260, 440, 0, 165, 'fur', r=1)
    m.box('head', 'jowl', 436, 715, 372, 444, -140, 40, 'fur')
    m.box('head', 'brow', 470, 684, 232, 322, -200, -120, 'fur')
    rig.eyes(m, (524, 627), 277, 14, -200)
    m.box('head', 'muzzle', 470, 682, 322, 405, -245, -150, 'muzzle', r=1, face_pal={'down': 'mouth'}, dens=9, snap=False)
    m.box('head', 'nose', 545, 608, 316, 352, -262, -240, 'black', dens=9, snap=False)
    m.box('head', 'mouth', 485, 665, 398, 448, -215, -60, 'mouth')
    m.box('jaw', 'teeth', 504, 665, 428, 446, -232, -205, 'teeth', dens=9, snap=False)
    m.box('jaw', 'jaw', 477, 673, 444, 497, -228, -40, 'fur', r=1, face_pal={'up': 'mouth'})
    # top hat
    m.box('hat', 'brim', 476, 676, 104, 142, -105, 85, 'hat')
    m.box('hat', 'crown', 507, 644, 7, 102, -78, 58, 'hat', r=1)
    # round ears
    for s, mir in (('right', False), ('left', True)):
        rows = m.rows(96, 238, 318, 450, None)
        rows = [(a, b, l, max(r, 388 * 2 - l)) if r - l > 60 else (a, b, l, r) for (a, b, l, r) in rows]  # round ear
        if mir:
            rows = [(a, b, m.mx(r), m.mx(l)) for (a, b, l, r) in rows]
        m.stack(f'ear_{s}', f'ear_{s}_', rows, -45, 15, 'fur', zfac=0.25)
        X = m.mx if mir else (lambda v: v)
        m.box(f'ear_{s}', f'earjoint_{s}', *sorted((X(436), X(462))), 160, 186, -30, 0, 'metal')

    # ---------------- torso ----------------
    m.box('torso', 'chest', 394, 757, 446, 870, -130, 140, 'fur', r=1)
    m.box('torso', 'belly', 440, 710, 548, 862, -155, -60, 'belly', r=1)
    m.box('torso', 'bowtie', 486, 664, 498, 560, -170, -125, 'tie', dens=6, snap=False)
    m.box('torso', 'knot', 550, 600, 505, 548, -182, -160, 'tie', dens=6, snap=False)
    for i, (y0, y1) in enumerate(((576, 616), (631, 676))):
        m.box('torso', f'button{i}', 557, 594, y0, y1, -172, -150, 'black', dens=6, snap=False)
    m.box('torso', 'neck', 525, 625, 440, 490, -40, 40, 'metal')
    m.mbox('torso', 'torso', 'shoulder', 377, 451, 391, 448, -75, 75, 'fur', r=1)
    m.mbox('torso', 'torso', 'shjoint', 385, 432, 444, 492, -40, 40, 'metal')
    m.box('body', 'pelvis', 376, 775, 862, 962, -120, 125, 'hip', r=1)
    rig.limbs(m, P, hand=open_hand)
    return m
