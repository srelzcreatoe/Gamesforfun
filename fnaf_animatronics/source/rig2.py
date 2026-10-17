"""Shared animatronic body: same bone names on every character so one animation set drives all.

root > body (hips) > torso > head > jaw / ears / hat
                           > arm_* > forearm_* > hand_* (> finger bones on open hands)
             > leg_* > shin_* > foot_*
Units are Blockbench pixels; +X is the character's right, -Z is the front.
Every limb joint has a small endoskeleton cube centred on its pivot so bending never opens a hole.
"""
from bbgen2 import rect, pixels


def joint(m, bone, name, x, y, z=0.0, w=1.0, d=1.0, h=1.0, mat=None):
    m.box(bone, name, x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2, mat)


def skeleton(m, D):
    m.bone('root', None, (0, 0, 0))
    m.bone('body', 'root', (0, D['hip_y'], 0))
    m.bone('torso', 'body', (0, D['waist_y'], 0))
    m.bone('head', 'torso', (0, D['neck_y'], 0))
    m.bone('jaw', 'head', D['jaw_pivot'])
    for s, k in (('right', 1), ('left', -1)):
        def P(p):
            return (k * p[0], p[1], 0)
        m.bone(f'arm_{s}', 'torso', P(D['shoulder_p']))
        m.bone(f'forearm_{s}', f'arm_{s}', P(D['elbow_p']))
        m.bone(f'hand_{s}', f'forearm_{s}', P(D['wrist_p']))
        m.bone(f'leg_{s}', 'body', P(D['hip_p']))
        m.bone(f'shin_{s}', f'leg_{s}', P(D['knee_p']))
        m.bone(f'foot_{s}', f'shin_{s}', P(D['ankle_p']))


def body(m, D, M, hand=None, chest_deco=(), belly_deco=()):
    hw, y0, y1, z0, z1 = D['pelvis']
    wb = D['waistband']
    m.box('body', 'pelvis', -hw, hw, y0, y1, z0, z1, M['hip'], r=0.5,
          deco=[rect(-99, 99, wb[0], wb[1], M['hip'].scaled(0.78), faces=('north', 'south', 'east', 'west'))])
    hw, y0, y1, z0, z1 = D['chest']
    m.box('torso', 'chest', -hw, hw, y0, y1, z0, z1, M['fur'], r=0.5, deco=list(chest_deco))
    hw, y0, y1, z0, z1 = D['belly']
    m.box('torso', 'belly', -hw, hw, y0, y1, z0, z1, M['belly'], r=0.5, deco=list(belly_deco))
    hw, y0, y1 = D['neck']
    m.box('torso', 'neck', -hw, hw, y0, y1, -1, 1, M['metal'])
    x0, x1, y0, y1, zd = D['shoulder']
    m.mbox('torso', 'torso', 'shoulder', x0, x1, y0, y1, -zd, zd, M['fur'], r=0.5)

    for s, k in (('right', 1), ('left', -1)):
        def X(a, b):
            return (a, b) if k > 0 else (-b, -a)
        sfx = '_r' if k > 0 else '_l'
        x0, x1, y0, y1, zd = D['upper']
        m.box(f'arm_{s}', 'upper_arm' + sfx, *X(x0, x1), y0, y1, -zd, zd, M['fur'], r=0.5)
        joint(m, f'arm_{s}', 'elbow' + sfx, k * D['elbow_p'][0], D['elbow_p'][1], mat=M['metal'])
        x0, x1, y0, y1, zd = D['forearm']
        m.box(f'forearm_{s}', 'forearm' + sfx, *X(x0, x1), y0, y1, -zd, zd, M['fur'], r=0.5)
        joint(m, f'forearm_{s}', 'wrist' + sfx, k * D['wrist_p'][0], D['wrist_p'][1], mat=M['metal'])
        if hand:
            hand(m, s, k, X, sfx)
        else:
            mitten(m, D, M, s, k, X, sfx)

        x0, x1, y0, y1, zd = D['thigh']
        m.box(f'leg_{s}', 'thigh' + sfx, *X(x0, x1), y0, y1, -zd, zd, M['leg'], r=0.5)
        joint(m, f'leg_{s}', 'knee' + sfx, k * D['knee_p'][0], D['knee_p'][1], w=1.0, d=1.5, mat=M['metal'])
        x0, x1, y0, y1, zd = D['shin']
        m.box(f'shin_{s}', 'shin' + sfx, *X(x0, x1), y0, y1, -zd, zd, M['leg'], r=0.5)
        joint(m, f'shin_{s}', 'ankle' + sfx, k * D['ankle_p'][0], D['ankle_p'][1], mat=M['metal'])
        foot(m, D, M, s, k, X, sfx)


def mitten(m, D, M, s, k, X, sfx):
    x0, x1, y0, y1, zd = D['palm']
    m.box(f'hand_{s}', 'palm' + sfx, *X(x0, x1), y0, y1, -zd, zd, M['fur'], r=0.5)
    fz = D['finger_z']
    for i, (a, b, c, d) in enumerate(D['fingers']):
        m.box(f'hand_{s}', f'finger{i}' + sfx, *X(a, b), c, d, -fz, fz, M['fur'],
              deco=[rect(-99, 99, c, c + 0.5, M['fur'].scaled(0.8), faces=('north', 'east', 'west', 'south'))])
    a, b, c, d, e, f = D['thumb']
    m.box(f'hand_{s}', 'thumb' + sfx, *X(a, b), c, d, e, f, M['fur'])


def foot(m, D, M, s, k, X, sfx):
    F = D['foot']
    a, b, c, d, e, f = F['cover']
    m.box(f'foot_{s}', 'foot_top' + sfx, *X(a, b), c, d, e, f, M['leg'], r=0.5 if min(b - a, d - c, f - e) > 1 else 0)
    a, b, c, d, e, f = F['body']
    m.box(f'foot_{s}', 'foot_body' + sfx, *X(a, b), c, d, e, f, M['leg'])
    ty, tz = F['toe_y'], F['toe_z']
    for i, (a, b) in enumerate(F['toes']):
        m.box(f'foot_{s}', f'toe{i}' + sfx, *X(a, b), ty[0], ty[1], tz[0], tz[1], M['leg'], r=0.5)
    a, b, c, d, e, f = F['sole']
    seams = [t[0] for t in F['toes'][1:]]
    m.box(f'foot_{s}', 'sole' + sfx, *X(a, b), c, d, e, f, M['sole'],
          deco=[lambda fd, P, i, j, W, H, seams=seams: M['sole'].scaled(0.6)
                if fd == 'north' and any(abs(abs(P[0]) - sx) < 0.26 for sx in seams) else None])
