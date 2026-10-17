"""Shared humanoid animatronic rig. Every character uses the same bone names so the
animation set can drive all three models:

root > body > torso > head > jaw / ears / hat
                    > arm_* > forearm_* > hand_* (> finger bones for open hands)
            > leg_* > shin_* > foot_*
"""


def skeleton(m, P):
    cx = m.cx
    m.bone('root', None, (cx, m.ground, 0))
    m.bone('body', 'root', (cx, P['hip_y'], 0))
    m.bone('torso', 'body', (cx, P['waist_y'], 0))
    m.bone('head', 'torso', (cx, P['neck_y'], 0))
    m.bone('jaw', 'head', (cx, P['jaw_y'], P.get('jaw_z', -20)))
    for s in ('right', 'left'):
        X = (lambda px: px) if s == 'right' else m.mx
        m.bone(f'arm_{s}', 'torso', (X(P['shoulder'][0]), P['shoulder'][1], 0))
        m.bone(f'forearm_{s}', f'arm_{s}', (X(P['elbow'][0]), P['elbow'][1], 0))
        m.bone(f'hand_{s}', f'forearm_{s}', (X(P['wrist'][0]), P['wrist'][1], 0))
        m.bone(f'leg_{s}', 'body', (X(P['hip'][0]), P['hip'][1], 0))
        m.bone(f'shin_{s}', f'leg_{s}', (X(P['knee'][0]), P['knee'][1], 0))
        m.bone(f'foot_{s}', f'shin_{s}', (X(P['ankle'][0]), P['ankle'][1], 0))


def limbs(m, P, hand=None):
    """P: measurement windows for the viewer-left (character right) limbs; mirrored for the left."""
    for s in ('right', 'left'):
        mir = s == 'left'
        X = m.mx if mir else (lambda v: v)

        def mrows(rows):
            return [(a, b, m.mx(r), m.mx(l)) for (a, b, l, r) in rows] if mir else rows

        def xs(a, b):
            return sorted((X(a), X(b)))

        aD, lD = P.get('arm_depth', 80), P.get('leg_depth', 95)
        apal, lpal = P.get('arm_pal', 'fur'), P.get('leg_pal', 'leg')
        m.stack(f'arm_{s}', f'upperarm_{s}_', mrows(m.rows(*P['ua'])), -aD, aD, apal, zfac=0.5)
        e = P['elbow_box']
        m.box(f'arm_{s}', f'elbow_{s}', *xs(e[0], e[1]), e[2], e[3], -30, 30, 'metal')
        m.stack(f'forearm_{s}', f'forearm_{s}_', mrows(m.rows(*P['fa'])), -aD - 5, aD + 5, apal, zfac=0.5)
        w = P['wrist_box']
        m.box(f'forearm_{s}', f'wrist_{s}', *xs(w[0], w[1]), w[2], w[3], -25, 25, 'metal')
        if hand:
            hand(m, s, X, xs, mrows)
        else:
            m.stack(f'hand_{s}', f'hand_{s}_', mrows(m.rows(*P['hand'])), -aD + 5, aD - 5, apal, zfac=0.5)
            t = P['thumb_box']
            m.box(f'hand_{s}', f'thumb_{s}', *xs(t[0], t[1]), t[2], t[3], -aD - 15, -15, apal)

        m.stack(f'leg_{s}', f'thigh_{s}_', mrows(m.rows(*P['th'])), -lD, lD, lpal, zfac=0.5)
        k = P['knee_box']
        m.box(f'leg_{s}', f'knee_{s}', *xs(k[0], k[1]), k[2], k[3], -40, 40, 'metal')
        m.stack(f'shin_{s}', f'shin_{s}_', mrows(m.rows(*P['sh'])), -lD, lD, lpal, zfac=0.5)
        a = P['ankle_box']
        m.box(f'shin_{s}', f'ankle_{s}', *xs(a[0], a[1]), a[2], a[3], -35, 35, 'metal')
        F = P['foot']
        m.box(f'foot_{s}', f'foottop_{s}', *xs(*F['top'][:2]), F['top'][2], F['top'][3], -110, 80, lpal)
        m.box(f'foot_{s}', f'footmid_{s}', *xs(*F['mid'][:2]), F['mid'][2], F['mid'][3], -150, 85, lpal, r=1)
        for i, (a_, b_) in enumerate(F['toes']):
            m.box(f'foot_{s}', f'toe{i}_{s}', *xs(a_, b_), F['toe_y'][0], F['toe_y'][1], F.get('toe_z', -255), 60, lpal, r=1)
        so = F['sole']
        m.box(f'foot_{s}', f'sole_{s}', *xs(so[0], so[1]), so[2], so[3], F.get('toe_z', -255) - 13, 75, 'sole')


def eyes(m, centres, y, rad, z):
    for i, ex in enumerate(centres):
        m.box('head', f'eye_{"rl"[i]}', ex - rad, ex + rad, y - rad, y + rad, z - 5, z, 'eye', dens=8, snap=False)
