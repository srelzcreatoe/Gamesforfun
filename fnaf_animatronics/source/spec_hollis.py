"""Hollis - red-brown bear animatronic with top hat. Coordinates are reference-image pixels
(hollis_ref.png, 1152x1536); 40 px = 1 Blockbench unit; z negative = towards the viewer."""
from bbgen import Model
import rig


def build(ref):
    m = Model('hollis', ref, cx=576, ground=1503, ppu=40, density=2, seed=23)
    m.palette({
        'fur': dict(region=[(480, 168, 670, 225), (300, 560, 380, 650), (230, 760, 330, 860)]),
        'leg': dict(region=[(390, 980, 530, 1100), (360, 1180, 500, 1300)]),
        'belly': dict(region=(470, 640, 680, 850)),
        'muzzle': dict(region=[(470, 395, 530, 440), (620, 395, 680, 440)]),
        'earin': dict(region=(325, 140, 410, 205)),
        'hat': dict(region=(510, 30, 640, 100)),
        'black': dict(c=[(22, 18, 22), (32, 26, 30), (28, 22, 26)]),
        'metal': dict(c=[(48, 50, 56), (70, 72, 80), (58, 60, 66)]),
        'teeth': dict(region=(495, 481, 655, 494)),
        'tie': dict(region=(490, 555, 550, 605)),
        'sole': dict(region=(210, 1475, 510, 1495)),
        'hip': dict(region=(420, 900, 730, 950)),
        'mouth': dict(c=[(38, 14, 18), (55, 20, 24), (45, 16, 20)]),
        'eye': dict(c=[(12, 8, 10)]),
    })
    cx = m.cx
    P = dict(
        hip_y=940, waist_y=880, neck_y=520, jaw_y=482,
        shoulder=(375, 545), elbow=(298, 718), wrist=(250, 905),
        hip=(456, 950), knee=(432, 1145), ankle=(430, 1332),
        ua=(498, 708, 220, 412, 320), elbow_box=(270, 322, 700, 738),
        fa=(728, 905, 170, 372, 270), wrist_box=(228, 272, 893, 922),
        hand=(915, 1138, 165, 354, 250), thumb_box=(308, 352, 960, 1062),
        th=(930, 1135, 345, 560, 456), knee_box=(398, 462, 1128, 1162),
        sh=(1148, 1322, 320, 535, 430), ankle_box=(395, 465, 1318, 1345),
        foot=dict(top=(292, 500, 1338, 1365), mid=(250, 518, 1360, 1395),
                  toes=((205, 318), (318, 420), (420, 520)), toe_y=(1385, 1470), sole=(194, 526, 1466, 1503)),
    )
    rig.skeleton(m, P)
    m.bone('hat', 'head', (cx, 160, -10))
    m.bone('ear_right', 'head', (440, 190, -10))
    m.bone('ear_left', 'head', (m.mx(440), 190, -10))

    # ---------------- head ----------------
    def head_z(yt, yb, xl, xr, maxw):
        if yb <= 182: return (-140, 140)
        if yt >= 288 and yb <= 380: return (-165, 40)   # cheek bulge only at the front
        return (-165, 165)
    rows = m.rows(158, 243, 445, 708, None) + m.rows(243, 263, 405, 748, None) + m.rows(263, 432, 380, 772, None, sym='left')
    m.stack('head', 'skull', rows, -165, 165, 'fur', centred=True, zfun=head_z)
    m.box('head', 'skull_back', 398, 754, 280, 440, 0, 165, 'fur', r=1)
    m.box('head', 'jowl', 445, 708, 430, 500, -140, 40, 'fur')
    m.box('head', 'mask', 452, 700, 230, 352, -205, -120, 'fur')
    rig.eyes(m, (522, 633), 305, 13, -205)
    m.box('head', 'muzzle', 455, 697, 358, 458, -245, -150, 'muzzle', r=1, face_pal={'down': 'mouth'}, dens=8, snap=False)
    m.box('head', 'nose', 543, 610, 348, 390, -265, -240, 'black', dens=8, snap=False)
    m.box('head', 'mouth', 470, 684, 450, 500, -215, -60, 'mouth')
    m.box('jaw', 'teeth', 491, 661, 478, 497, -232, -205, 'teeth', dens=8, snap=False)
    m.box('jaw', 'jaw', 466, 688, 494, 538, -228, -40, 'fur', r=1, face_pal={'up': 'mouth'})
    # top hat
    m.box('hat', 'brim', 469, 683, 118, 160, -110, 90, 'hat')
    m.box('hat', 'crown', 497, 654, 20, 120, -80, 60, 'hat', r=1)
    # round ears
    for s, mir in (('right', False), ('left', True)):
        rows = m.rows(92, 252, 285, 444, None)
        rows = [(a, b, l, max(r, 366.5 * 2 - l)) if r - l > 60 else (a, b, l, r) for (a, b, l, r) in rows]  # round ear
        if mir:
            rows = [(a, b, m.mx(r), m.mx(l)) for (a, b, l, r) in rows]
        m.stack(f'ear_{s}', f'ear_{s}_', rows, -45, 15, 'fur', zfac=0.25)
        X = m.mx if mir else (lambda v: v)
        m.box(f'ear_{s}', f'earjoint_{s}', *sorted((X(420), X(452))), 172, 200, -30, 0, 'metal')

    # ---------------- torso ----------------
    m.box('torso', 'chest', 379, 774, 500, 880, -130, 140, 'fur', r=1)
    m.box('torso', 'belly', 449, 703, 598, 882, -155, -60, 'belly', r=1)
    m.box('torso', 'bowtie', 478, 675, 540, 615, -170, -125, 'tie', dens=4, snap=False)
    m.box('torso', 'knot', 552, 601, 548, 592, -182, -160, 'tie', dens=4, snap=False)
    for i, (y0, y1) in enumerate(((614, 655), (679, 717))):
        m.box('torso', f'button{i}', 555, 597, y0, y1, -172, -150, 'black', dens=4, snap=False)
    m.box('torso', 'neck', 525, 627, 490, 545, -40, 40, 'metal')
    m.mbox('torso', 'torso', 'shoulder', 356, 444, 432, 505, -75, 75, 'fur', r=1)
    m.mbox('torso', 'torso', 'shjoint', 380, 430, 500, 550, -40, 40, 'metal')
    m.box('body', 'pelvis', 389, 764, 875, 965, -120, 125, 'hip', r=1)
    rig.limbs(m, P)
    return m
