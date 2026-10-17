"""Bramble - purple rabbit animatronic. All coordinates are reference-image pixels
(bramble_ref.png, 1152x1536). x0<x1 left->right as seen in the picture, y0<y1 top->bottom,
z negative = towards the viewer. 40 px = 1 Blockbench unit."""
from bbgen import Model
import rig


def build(ref):
    m = Model('bramble', ref, cx=555, ground=1506, ppu=40, density=2, seed=11)
    m.palette({
        'fur': dict(region=[(500, 240, 610, 290), (300, 620, 380, 700), (290, 800, 350, 880), (760, 800, 820, 880)]),
        'leg': dict(region=[(380, 1000, 520, 1100), (360, 1200, 500, 1300)]),
        'belly': dict(region=(470, 660, 640, 840)),
        'muzzle': dict(region=(455, 440, 520, 505)),
        'earin': dict(region=(375, 90, 455, 190)),
        'black': dict(c=[(22, 18, 26), (32, 26, 36), (28, 22, 30)]),
        'metal': dict(c=[(48, 50, 56), (70, 72, 80), (58, 60, 66)]),
        'teeth': dict(region=(490, 541, 615, 552)),
        'tie': dict(region=[(480, 605, 530, 645), (585, 605, 630, 645)]),
        'sole': dict(region=(230, 1482, 510, 1500)),
        'hip': dict(region=(420, 905, 690, 975)),
        'mouth': dict(c=[(38, 14, 22), (55, 20, 30), (45, 16, 26)]),
        'eye': dict(c=[(12, 8, 12)]),
    })
    cx = m.cx
    P = dict(
        hip_y=960, waist_y=890, neck_y=575, jaw_y=540,
        shoulder=(368, 600), elbow=(325, 758), wrist=(285, 948),
        hip=(450, 965), knee=(438, 1158), ankle=(432, 1338),
        ua=(548, 748, 228, 400, 320), elbow_box=(300, 352, 735, 778),
        fa=(762, 938, 196, 384, 290), wrist_box=(262, 306, 925, 965),
        hand=(956, 1156, 190, 362, 270), thumb_box=(298, 352, 996, 1102),
        th=(938, 1145, 340, 545, 450), knee_box=(403, 472, 1136, 1180),
        sh=(1160, 1336, 325, 535, 430), ankle_box=(400, 472, 1326, 1350),
        foot=dict(top=(330, 486, 1338, 1362), mid=(298, 504, 1358, 1402),
                  toes=((222, 332), (332, 420), (420, 522)), toe_y=(1398, 1480), sole=(210, 524, 1476, 1506)),
    )
    rig.skeleton(m, P)
    m.bone('ear_right', 'head', (445, 238, -20), rot=(0, 0, -12))
    m.bone('ear_left', 'head', (655, 245, -20), rot=(0, 0, 28))

    # ---------------- head ----------------
    def head_z(yt, yb, xl, xr, maxw):
        if yb <= 207: return (-100, 100)
        if yb <= 227: return (-130, 120)
        if yb <= 247: return (-150, 140)
        if yt >= 325: return (-160, 40)   # cheeks bulge forward only
        return (-160, 160)
    rows = [(186, 206, 520, 590), (206, 226, 490, 620), (226, 246, 445, 665)] + m.rows(246, 472, 368, 745, None, sym='left')
    m.stack('head', 'skull', rows, -160, 160, 'fur', centred=True, zfun=head_z)
    m.box('head', 'jowl', 392, 718, 470, 548, -140, 40, 'fur')
    m.box('head', 'skull_back', 396, 714, 320, 520, 0, 160, 'fur', r=1)
    m.box('head', 'mask', 445, 665, 296, 428, -200, -120, 'fur')
    rig.eyes(m, (500, 603), 375, 22, -200)  # glowing red eyes, sampled at high density
    m.box('head', 'muzzle', 445, 662, 430, 522, -240, -150, 'muzzle', r=1, face_pal={'down': 'mouth'}, dens=8, snap=False)
    m.box('head', 'nose', 527, 585, 428, 470, -262, -235, 'black', dens=8, snap=False)
    m.box('head', 'mouth', 468, 642, 515, 560, -215, -60, 'mouth')
    m.box('jaw', 'teeth', 485, 622, 538, 556, -228, -205, 'teeth', dens=8, snap=False)
    m.box('jaw', 'jaw', 465, 648, 554, 598, -222, -40, 'fur', r=1, face_pal={'up': 'mouth'})
    # ears (upright right ear, floppy left ear folded over at the tip)
    m.box('ear_right', 'ear', 445 - 76, 445 + 76, 22, 238, -60, 0, 'fur', r=1)
    m.box('ear_right', 'stalk', 430, 465, 220, 262, -45, -20, 'metal')
    m.box('ear_left', 'ear_base', 655 - 50, 655 + 50, 145, 250, -60, 0, 'fur', r=1)
    px, py, pz = m.unrot('ear_left', 758, 148, -30)
    m.bone('ear_left_tip', 'ear_left', (px, py, pz), rot=(0, 0, 131.5))
    m.box('ear_left_tip', 'ear_tip', px - 56, px + 56, py - 182, py + 8, -60, 0, 'fur', r=1)

    # ---------------- torso ----------------
    m.box('torso', 'chest', 386, 725, 560, 878, -125, 135, 'fur', r=1)
    m.box('torso', 'belly', 455, 655, 628, 885, -150, -60, 'belly', r=1)
    m.box('torso', 'bowtie', 475, 635, 597, 650, -165, -125, 'tie', dens=4, snap=False)
    m.box('torso', 'knot', 533, 580, 600, 632, -178, -150, 'tie', dens=4, snap=False)
    m.box('torso', 'neck', 505, 605, 540, 580, -40, 40, 'metal')
    m.mbox('torso', 'torso', 'shoulder', 348, 412, 476, 552, -70, 70, 'fur', r=1)
    m.mbox('torso', 'torso', 'shjoint', 370, 420, 548, 600, -40, 40, 'metal')
    # ---------------- hips ----------------
    m.box('body', 'pelvis', 394, 719, 870, 995, -115, 120, 'hip', r=1)

    rig.limbs(m, P)
    return m
