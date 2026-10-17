"""Hand-keyed animation set shared by all three animatronics (bone names from rig2.py).

Bedrock / Blockbench keyframe convention:
  rotation x  negative swings a hanging limb forward; positive tips head/torso forward;
              positive opens the jaw; on the foot negative lifts the toes.
  rotation y  positive turns towards the character's right.
  rotation z  positive swings the right arm outwards (left arm outwards = negative).
  position    Blockbench units; y up, negative z = forwards.
"""
import math

CAT, LIN, STEP = 'catmullrom', 'linear', 'step'


class Anim:
    def __init__(self, char, name, length, loop='loop'):
        self.d = {'name': f'animation.{char}.{name}', 'length': length, 'loop': loop, 'bones': {}}
        self.length = length

    def key(self, bone, ch, keys, interp=CAT):
        tr = self.d['bones'].setdefault(bone, {}).setdefault(ch, [])
        for k in keys:
            t, x, y, z = k[:4]
            it = k[4] if len(k) > 4 else interp
            tr.append((round(t, 4), [round(x, 3), round(y, 3), round(z, 3)], it))
        tr.sort(key=lambda e: e[0])
        return self

    def rot(self, bone, keys, interp=CAT):
        return self.key(bone, 'rotation', keys, interp)

    def pos(self, bone, keys, interp=CAT):
        return self.key(bone, 'position', keys, interp)

    def both(self, bone, keys, interp=CAT, ch='rotation'):
        """keys written for the right-side bone; mirrored onto the left one (y,z negated)"""
        self.key(f'{bone}_right', ch, keys, interp)
        mk = [(k[0], k[1], -k[2] if ch == 'rotation' else k[2], -k[3] if ch == 'rotation' else -k[3]) + tuple(k[4:]) for k in keys]
        if ch == 'position':
            mk = [(k[0], -k[1], k[2], k[3]) + tuple(k[4:]) for k in keys]
        self.key(f'{bone}_left', ch, mk, interp)
        return self

    def cycle(self, bone, ch, fn, steps=12, interp=CAT):
        """sample fn(phase 0..1) -> (x,y,z) over one loop; last key equals the first"""
        keys = []
        for i in range(steps + 1):
            p = i / steps
            x, y, z = fn(p % 1.0)
            keys.append((p * self.length, x, y, z))
        return self.key(bone, ch, keys, interp)



R, L_ = 'right', 'left'


def has(m, b):
    return b in m.bones


def loop(a, bone, ch, keys, interp=CAT, shift=0.0):
    """keys over one cycle [(t, x, y, z), ...] starting at t=0; adds the closing key at the loop
    length.  shift (seconds) moves the cycle in time; shifts must land on existing key times."""
    L = a.length
    ks = sorted(((round((t + shift) % L, 4), x, y, z) for (t, x, y, z) in keys), key=lambda k: k[0])
    if ks[0][0] != 0:
        raise ValueError(f'{bone}: shifted cycle has no key at 0')
    ks.append((L,) + ks[0][1:])
    a.key(bone, ch, ks, interp)


def mirror(keys):
    return [(t, x, -y, -z) for (t, x, y, z) in keys]


def ears(a, m, keys_r, keys_tip=None, keys_l=None):
    if has(m, 'ear_left_tip'):
        loop(a, 'ear_right', 'rotation', keys_r)
        if keys_tip:
            loop(a, 'ear_left_tip', 'rotation', keys_tip)
        if keys_l:
            loop(a, 'ear_left', 'rotation', keys_l)
    elif has(m, 'ear_right'):
        small = [(t, 0, 0, z * 0.35) for (t, x, y, z) in keys_r]
        loop(a, 'ear_right', 'rotation', small)
        loop(a, 'ear_left', 'rotation', mirror(small))


def fingers(a, m, curl, spread=0.0, shift_step=0.0):
    """Gildric's open hand: curl = [(t, degrees)]; positive curls the fingers in"""
    if not has(m, 'finger1_right'):
        return
    for s, k in ((R, 1), (L_, -1)):
        for i, f in enumerate(('finger1', 'finger2', 'finger3')):
            ks = [(t, -c * (1 - 0.1 * i), 0, k * spread * (1 - i)) for (t, c) in curl]
            loop(a, f'{f}_{s}', 'rotation', ks, shift=shift_step * i)
        loop(a, f'thumb_{s}', 'rotation', [(t, -0.5 * c, 0, -k * spread * 0.6) for (t, c) in curl])


# ------------------------------------------------------------------------------------------------
def idle(c, m):
    a = Anim(c, 'idle', 4.0)
    loop(a, 'body', 'position', [(0, 0, 0, 0), (1, 0, 0.12, 0), (2, 0, 0, 0), (3, 0, 0.12, 0)])
    loop(a, 'torso', 'rotation', [(0, 0, 0, 0), (1, 1.5, 0, 0), (2, 0, 0, 0), (3, 1.5, 0, 0)])
    loop(a, 'head', 'rotation', [(0, 0, 0, 0), (1, -2, 8, 2), (2, 0, 8, 2), (2.5, -1, 0, 0), (3, 1, -7, -2), (3.5, 0, -7, -2)])
    loop(a, 'arm_right', 'rotation', [(0, 0, 0, 2), (1, 2, 0, 3), (2, 0, 0, 2), (3, 2, 0, 3)])
    loop(a, 'arm_left', 'rotation', [(0, 0, 0, -2), (1, 2, 0, -3), (2, 0, 0, -2), (3, 2, 0, -3)])
    loop(a, 'forearm_right', 'rotation', [(0, -4, 0, 0), (2, -7, 0, 0)])
    loop(a, 'forearm_left', 'rotation', [(0, -4, 0, 0), (2, -7, 0, 0)])
    loop(a, 'jaw', 'rotation', [(0, 0, 0, 0), (2.7, 0, 0, 0), (2.85, 7, 0, 0), (3.0, 0, 0, 0)], LIN)
    ears(a, m, [(0, 0, 0, 0), (1, -3, 0, -2), (2, 0, 0, 0), (3.2, -2, 0, 3)],
         [(0, 0, 0, 0), (1, 0, 0, 6), (2, 0, 0, 0), (3, 0, 0, -4)])
    fingers(a, m, [(0, 4), (2, 12)])
    return a


# ------------------------------------------------------------------------------------------------
def walk(c, m):
    L = 1.6
    a = Anim(c, 'walk', L)
    h = L / 2
    leg = [(0, -22, 0, 0), (0.4, 0, 0, 0), (0.8, 18, 0, 0), (1.2, -4, 0, 0)]
    shin = [(0, 4, 0, 0), (0.2, 10, 0, 0), (0.4, 4, 0, 0), (0.8, 12, 0, 0), (1.0, 42, 0, 0), (1.2, 30, 0, 0), (1.4, 8, 0, 0)]
    foot = [(0, 8, 0, 0), (0.2, 2, 0, 0), (0.4, -4, 0, 0), (0.8, -10, 0, 0), (1.0, -30, 0, 0), (1.2, -24, 0, 0), (1.4, -2, 0, 0)]
    loop(a, 'leg_right', 'rotation', leg)
    loop(a, 'leg_left', 'rotation', leg, shift=h)
    loop(a, 'shin_right', 'rotation', shin)
    loop(a, 'shin_left', 'rotation', shin, shift=h)
    loop(a, 'foot_right', 'rotation', foot)
    loop(a, 'foot_left', 'rotation', foot, shift=h)
    loop(a, 'body', 'position', [(0, 0, 0, 0), (0.2, 0, -0.45, 0), (0.4, 0, 0.35, 0), (0.6, 0, 0.05, 0),
                                 (0.8, 0, 0, 0), (1.0, 0, -0.45, 0), (1.2, 0, 0.35, 0), (1.4, 0, 0.05, 0)])
    loop(a, 'body', 'rotation', [(0, 0, -5, 0), (0.4, 0, 0, 2), (0.8, 0, 5, 0), (1.2, 0, 0, -2)])
    loop(a, 'torso', 'rotation', [(0, 3, 4, 0), (0.4, 4, 0, -1), (0.8, 3, -4, 0), (1.2, 4, 0, 1)])
    loop(a, 'head', 'rotation', [(0, -2, 2, 0), (0.2, 1, 1, 0), (0.4, -3, 0, 1), (0.8, -2, -2, 0), (1.0, 1, -1, 0), (1.2, -3, 0, -1)])
    arm = [(0, 18, 0, 3), (0.4, 0, 0, 4), (0.8, -18, 0, 3), (1.2, 0, 0, 4)]
    fore = [(0, -6, 0, 0), (0.4, -10, 0, 0), (0.8, -22, 0, 0), (1.2, -12, 0, 0)]
    loop(a, 'arm_right', 'rotation', arm)
    loop(a, 'arm_left', 'rotation', mirror(arm), shift=h)
    loop(a, 'forearm_right', 'rotation', fore)
    loop(a, 'forearm_left', 'rotation', fore, shift=h)
    loop(a, 'jaw', 'rotation', [(0, 0, 0, 0), (0.2, 3, 0, 0), (0.4, 0, 0, 0), (1.0, 3, 0, 0), (1.2, 0, 0, 0)])
    ears(a, m, [(0, 0, 0, 0), (0.2, -4, 0, 3), (0.4, 0, 0, 0), (1.0, -4, 0, -3), (1.2, 0, 0, 0)],
         [(0, 0, 0, 0), (0.2, 0, 0, 10), (0.6, 0, 0, -4), (1.0, 0, 0, 10), (1.4, 0, 0, -4)])
    fingers(a, m, [(0, 6), (0.4, 14), (0.8, 6), (1.2, 14)])
    return a


def run(c, m):
    L = 0.8
    a = Anim(c, 'run', L)
    h = L / 2
    leg = [(0, -44, 0, 0), (0.2, -4, 0, 0), (0.4, 34, 0, 0), (0.6, -12, 0, 0)]
    shin = [(0, 12, 0, 0), (0.1, 22, 0, 0), (0.2, 18, 0, 0), (0.4, 30, 0, 0), (0.5, 80, 0, 0), (0.6, 88, 0, 0), (0.7, 45, 0, 0)]
    foot = [(0, 16, 0, 0), (0.2, -12, 0, 0), (0.4, -30, 0, 0), (0.6, -36, 0, 0)]
    loop(a, 'leg_right', 'rotation', leg)
    loop(a, 'leg_left', 'rotation', leg, shift=h)
    loop(a, 'shin_right', 'rotation', shin)
    loop(a, 'shin_left', 'rotation', shin, shift=h)
    loop(a, 'foot_right', 'rotation', foot)
    loop(a, 'foot_left', 'rotation', foot, shift=h)
    loop(a, 'body', 'position', [(0, 0, -0.5, 0), (0.1, 0, -0.9, 0), (0.2, 0, 0.6, 0), (0.3, 0, 0.9, 0),
                                 (0.4, 0, -0.5, 0), (0.5, 0, -0.9, 0), (0.6, 0, 0.6, 0), (0.7, 0, 0.9, 0)])
    loop(a, 'body', 'rotation', [(0, 8, -8, 0), (0.2, 9, 0, 2), (0.4, 8, 8, 0), (0.6, 9, 0, -2)])
    loop(a, 'torso', 'rotation', [(0, 10, 8, 0), (0.2, 12, 0, -1), (0.4, 10, -8, 0), (0.6, 12, 0, 1)])
    loop(a, 'head', 'rotation', [(0, -16, 0, 0), (0.1, -13, 0, 0), (0.3, -18, 0, 0), (0.4, -16, 0, 0), (0.5, -13, 0, 0), (0.7, -18, 0, 0)])
    arm = [(0, 42, 0, 6), (0.2, 0, 0, 8), (0.4, -48, 0, 6), (0.6, 0, 0, 8)]
    fore = [(0, -62, 0, 0), (0.2, -72, 0, 0), (0.4, -86, 0, 0), (0.6, -72, 0, 0)]
    loop(a, 'arm_right', 'rotation', arm)
    loop(a, 'arm_left', 'rotation', mirror(arm), shift=h)
    loop(a, 'forearm_right', 'rotation', fore)
    loop(a, 'forearm_left', 'rotation', fore, shift=h)
    loop(a, 'hand_right', 'rotation', [(0, -12, 0, 0), (0.4, -18, 0, 0)])
    loop(a, 'hand_left', 'rotation', [(0, -18, 0, 0), (0.4, -12, 0, 0)])
    loop(a, 'jaw', 'rotation', [(0, 6, 0, 0), (0.2, 12, 0, 0), (0.4, 6, 0, 0), (0.6, 12, 0, 0)])
    ears(a, m, [(0, -8, 0, 0), (0.2, -16, 0, 6), (0.4, -8, 0, 0), (0.6, -16, 0, -6)],
         [(0, 0, 0, 14), (0.2, 0, 0, -8), (0.4, 0, 0, 14), (0.6, 0, 0, -8)])
    fingers(a, m, [(0, 30), (0.2, 42), (0.4, 30), (0.6, 42)])
    return a


# ------------------------------------------------------------------------------------------------
def jumpscare(c, m):
    """Pull back, lunge at the camera, jaw drops open, head shakes violently; holds the scream."""
    L = 1.5
    a = Anim(c, 'jumpscare', L, loop='hold')
    a.pos('body', [(0, 0, 0, 0), (0.1, 0, -0.5, 1.6), (0.22, 0, 1.0, -9.0), (0.3, 0, 1.2, -9.8), (0.4, 0, 1.0, -9.4), (L, 0, 1.0, -9.4)])
    a.rot('body', [(0, 0, 0, 0), (0.1, -5, 0, 0), (0.22, 8, 0, 0), (L, 8, 0, 0)])
    a.rot('torso', [(0, 0, 0, 0), (0.1, -8, 0, 0), (0.22, 16, 0, 0), (0.3, 19, 0, 0), (0.4, 16, 0, 0), (L, 16, 0, 0)])
    a.rot('leg_right', [(0, 0, 0, 0), (0.1, 6, 0, 0), (0.22, -32, 0, 2), (L, -32, 0, 2)])
    a.rot('shin_right', [(0, 0, 0, 0), (0.1, 10, 0, 0), (0.22, 28, 0, 0), (L, 28, 0, 0)])
    a.rot('foot_right', [(0, 0, 0, 0), (0.22, 4, 0, 0), (L, 4, 0, 0)])
    a.rot('leg_left', [(0, 0, 0, 0), (0.1, 6, 0, 0), (0.22, 24, 0, -2), (L, 24, 0, -2)])
    a.rot('shin_left', [(0, 0, 0, 0), (0.1, 10, 0, 0), (0.22, 18, 0, 0), (L, 18, 0, 0)])
    a.rot('foot_left', [(0, 0, 0, 0), (0.22, -40, 0, 0), (L, -40, 0, 0)])
    arm = [(0, 0, 0, 0), (0.1, 12, 0, 14), (0.22, -72, 0, 40), (0.3, -78, 0, 42), (L, -74, 0, 40)]
    a.rot('arm_right', arm)
    a.rot('arm_left', mirror(arm))
    for s in (R, L_):
        a.rot(f'forearm_{s}', [(0, 0, 0, 0), (0.1, -12, 0, 0), (0.22, -40, 0, 0), (L, -40, 0, 0)])
        a.rot(f'hand_{s}', [(0, 0, 0, 0), (0.22, -28, 0, 0), (L, -28, 0, 0)])
    head = [(0, 0, 0, 0, CAT), (0.1, -12, 0, 0, CAT), (0.22, -24, 0, 0, CAT), (0.3, -27, 0, 0, LIN)]
    jaw = [(0, 0, 0, 0, CAT), (0.1, 6, 0, 0, CAT), (0.2, 36, 0, 0, LIN)]
    t, i = 0.3, 0
    while t < L - 1e-6:
        t = round(min(L, t + 0.04), 4)
        sg = 1 if i % 2 == 0 else -1
        head.append((t, -24 + 2.5 * sg, 5 * sg, -7 * sg, LIN))
        jaw.append((t, 33 + 4 * sg, 0, 0, LIN))
        i += 1
    a.rot('head', head)
    a.rot('jaw', jaw)
    if has(m, 'ear_left_tip'):
        a.rot('ear_right', [(0, 0, 0, 0), (0.22, -24, 0, 10), (0.4, -16, 0, 4), (L, -16, 0, 4)])
        a.rot('ear_left_tip', [(0, 0, 0, 0), (0.22, 0, 0, 24), (0.4, 0, 0, -10), (0.6, 0, 0, 12), (0.8, 0, 0, -4), (L, 0, 0, 0)])
    if has(m, 'hat'):
        a.rot('hat', [(0, 0, 0, 0), (0.22, -14, 0, 6), (0.4, -8, 0, -4), (L, -8, 0, -4)])
        a.pos('hat', [(0, 0, 0, 0), (0.22, 0, 0.6, 0), (0.4, 0, 0.2, 0), (L, 0, 0.2, 0)])
    if has(m, 'finger1_right'):
        for s, k in ((R, 1), (L_, -1)):
            for i, f in enumerate(('finger1', 'finger2', 'finger3')):
                a.rot(f'{f}_{s}', [(0, 0, 0, 0), (0.22, -24, 0, k * (12 - 12 * i)), (L, -40, 0, k * (12 - 12 * i))])
            a.rot(f'thumb_{s}', [(0, 0, 0, 0), (0.22, -10, 0, -k * 18), (L, -10, 0, -k * 18)])
    return a


# ------------------------------------------------------------------------------------------------
def pose_1(c, m):
    """Show-stopper: right arm thrown up to the crowd, left hand on the hip, weight on one leg."""
    a = Anim(c, 'pose_1', 2.4)
    loop(a, 'body', 'rotation', [(0, 0, -10, 3), (1.2, 0, -10, 4)])
    loop(a, 'body', 'position', [(0, -0.5, 0, 0), (1.2, -0.5, 0.15, 0)])
    loop(a, 'torso', 'rotation', [(0, -4, 6, -3), (1.2, -3, 6, -2)])
    loop(a, 'head', 'rotation', [(0, -6, 16, 8), (1.2, -4, 14, 10)])
    loop(a, 'arm_right', 'rotation', [(0, -20, 0, 136), (0.6, -24, 0, 140), (1.2, -20, 0, 136), (1.8, -24, 0, 140)])
    loop(a, 'forearm_right', 'rotation', [(0, -16, 0, 0), (1.2, -22, 0, 0)])
    loop(a, 'hand_right', 'rotation', [(0, -8, 0, 0), (0.3, -8, 0, 16), (0.6, -8, 0, 0), (0.9, -8, 0, 16), (1.2, -8, 0, 0),
                                       (1.5, -8, 0, 16), (1.8, -8, 0, 0), (2.1, -8, 0, 16)])
    loop(a, 'arm_left', 'rotation', [(0, 6, 90, -46), (1.2, 6, 90, -48)])
    loop(a, 'forearm_left', 'rotation', [(0, -96, 0, 0), (1.2, -98, 0, 0)])
    loop(a, 'hand_left', 'rotation', [(0, -12, 0, 0), (1.2, -12, 0, 0)])
    loop(a, 'leg_right', 'rotation', [(0, -8, 0, 7), (1.2, -8, 0, 7)])
    loop(a, 'shin_right', 'rotation', [(0, 10, 0, 0), (1.2, 10, 0, 0)])
    loop(a, 'foot_right', 'rotation', [(0, 0, 0, -7), (1.2, 0, 0, -7)])
    loop(a, 'leg_left', 'rotation', [(0, 3, 0, -2), (1.2, 3, 0, -2)])
    loop(a, 'jaw', 'rotation', [(0, 8, 0, 0), (0.6, 14, 0, 0), (1.2, 8, 0, 0), (1.8, 14, 0, 0)])
    ears(a, m, [(0, -4, 0, 4), (1.2, -2, 0, 6)], [(0, 0, 0, 8), (1.2, 0, 0, 2)])
    fingers(a, m, [(0, 2), (1.2, 6)], spread=12)
    return a


def pose_2(c, m):
    """Menacing stare: hunched forward, head tilts slowly while it watches you, jaw creaks open."""
    a = Anim(c, 'pose_2', 4.0)
    loop(a, 'body', 'position', [(0, 0, -0.6, -0.5), (2, 0, -0.7, -0.5)])
    loop(a, 'body', 'rotation', [(0, 4, 0, 0), (2, 5, 0, 0)])
    loop(a, 'torso', 'rotation', [(0, 15, 0, 0), (2, 17, 0, 0)])
    loop(a, 'head', 'rotation', [(0, -16, 0, 0), (0.9, -16, 0, 0), (1.3, -18, 8, 18), (2.5, -18, 8, 18),
                                 (2.9, -20, -6, -10), (3.5, -17, -2, -3)], CAT)
    arm = [(0, -16, 0, 7), (2, -19, 0, 8)]
    loop(a, 'arm_right', 'rotation', arm)
    loop(a, 'arm_left', 'rotation', mirror(arm))
    for s in (R, L_):
        loop(a, f'forearm_{s}', 'rotation', [(0, -34, 0, 0), (2, -38, 0, 0)])
        loop(a, f'hand_{s}', 'rotation', [(0, -14, 0, 0), (2, -14, 0, 0)])
        loop(a, f'leg_{s}', 'rotation', [(0, -9, 0, 0), (2, -9, 0, 0)])
        loop(a, f'shin_{s}', 'rotation', [(0, 18, 0, 0), (2, 18, 0, 0)])
        loop(a, f'foot_{s}', 'rotation', [(0, -9, 0, 0), (2, -9, 0, 0)])
    loop(a, 'jaw', 'rotation', [(0, 0, 0, 0), (1.3, 0, 0, 0), (1.6, 12, 0, 0), (2.4, 12, 0, 0), (2.7, 0, 0, 0)])
    ears(a, m, [(0, -6, 0, 0), (2, -8, 0, 3)], [(0, 0, 0, -6), (2, 0, 0, 4)])
    fingers(a, m, [(0, 30), (1, 40), (2, 30), (3, 40)], spread=12)
    return a


# ------------------------------------------------------------------------------------------------
def perform_1(c, m):
    """Singing on stage at 120 bpm: sways, right hand holds the 'mic' at the mouth, left hand gestures,
    mouth opens on the beat, left foot taps."""
    L = 2.0
    a = Anim(c, 'perform_1', L)
    loop(a, 'body', 'rotation', [(0, 0, 0, 0), (0.5, 0, 8, 3), (1.0, 0, 0, 0), (1.5, 0, -8, -3)])
    loop(a, 'body', 'position', [(0, 0, 0, 0), (0.25, 0, 0.3, 0), (0.5, 0.4, 0, 0), (0.75, 0, 0.3, 0),
                                 (1.0, 0, 0, 0), (1.25, 0, 0.3, 0), (1.5, -0.4, 0, 0), (1.75, 0, 0.3, 0)])
    loop(a, 'torso', 'rotation', [(0, 2, 0, 0), (0.5, 4, -3, -2), (1.0, 2, 0, 0), (1.5, 4, 3, 2)])
    loop(a, 'head', 'rotation', [(0, -4, 0, 0), (0.25, 2, 4, 4), (0.5, -4, 6, 5), (0.75, 2, 2, 2),
                                 (1.0, -4, 0, 0), (1.25, 2, -4, -4), (1.5, -4, -6, -5), (1.75, 2, -2, -2)])
    loop(a, 'jaw', 'rotation', [(0, 2, 0, 0), (0.125, 22, 0, 0), (0.375, 20, 0, 0), (0.5, 2, 0, 0), (0.625, 18, 0, 0),
                                (0.75, 4, 0, 0), (1.0, 2, 0, 0), (1.125, 24, 0, 0), (1.375, 20, 0, 0), (1.5, 2, 0, 0),
                                (1.625, 14, 0, 0), (1.875, 0, 0, 0)])
    loop(a, 'arm_right', 'rotation', [(0, -44, 0, 18), (0.5, -46, 0, 18), (1.0, -44, 0, 18), (1.5, -46, 0, 18)])
    loop(a, 'forearm_right', 'rotation', [(0, -88, -34, 0), (0.5, -92, -34, 0), (1.0, -88, -34, 0), (1.5, -92, -34, 0)])
    loop(a, 'hand_right', 'rotation', [(0, -18, 0, 0), (1.0, -18, 0, 0)])
    loop(a, 'arm_left', 'rotation', [(0, -30, 0, -26), (0.5, -50, 12, -40), (1.0, -34, 0, -24), (1.5, -56, -8, -46)])
    loop(a, 'forearm_left', 'rotation', [(0, -40, 0, 0), (0.5, -26, 0, 0), (1.0, -44, 0, 0), (1.5, -20, 0, 0)])
    loop(a, 'hand_left', 'rotation', [(0, 0, 0, -8), (0.5, -10, 0, 8), (1.0, 0, 0, -8), (1.5, -10, 0, 8)])
    loop(a, 'leg_left', 'rotation', [(0, 0, 0, -2), (0.25, -6, 0, -2), (0.5, 0, 0, -2), (0.75, -6, 0, -2),
                                     (1.0, 0, 0, -2), (1.25, -6, 0, -2), (1.5, 0, 0, -2), (1.75, -6, 0, -2)])
    loop(a, 'foot_left', 'rotation', [(0, 0, 0, 0), (0.25, -16, 0, 0), (0.5, 0, 0, 0), (0.75, -16, 0, 0),
                                      (1.0, 0, 0, 0), (1.25, -16, 0, 0), (1.5, 0, 0, 0), (1.75, -16, 0, 0)], LIN)
    loop(a, 'leg_right', 'rotation', [(0, 0, 0, 2), (1.0, 0, 0, 2)])
    ears(a, m, [(0, 0, 0, 0), (0.5, -4, 0, 5), (1.0, 0, 0, 0), (1.5, -4, 0, -5)],
         [(0, 0, 0, 0), (0.5, 0, 0, 12), (1.0, 0, 0, 0), (1.5, 0, 0, -8)])
    fingers(a, m, [(0, 8), (0.5, 20), (1.0, 8), (1.5, 20)], spread=8)
    return a


def perform_2(c, m):
    return {'bramble': guitar, 'hollis': hat_tip}.get(c, marionette)(c, m)


def guitar(c, m):
    """Air-guitar solo: left hand fretting out to the side, right hand strumming across the belly,
    head-banging on every beat."""
    L = 1.6
    a = Anim(c, 'perform_2', L)
    beats = [i * 0.2 for i in range(8)]
    loop(a, 'body', 'position', [(t, 0, -0.5 if i % 2 == 0 else 0.1, 0) for i, t in enumerate(beats)])
    loop(a, 'body', 'rotation', [(0, 0, -16, 0), (0.4, 0, -18, 2), (0.8, 0, -14, 0), (1.2, 0, -18, -2)])
    loop(a, 'torso', 'rotation', [(t, 9 if i % 2 == 0 else 5, 0, -4) for i, t in enumerate(beats)])
    loop(a, 'head', 'rotation', [(t, 18 if i % 2 == 0 else -4, 10, 4 if i % 4 < 2 else -4) for i, t in enumerate(beats)])
    loop(a, 'jaw', 'rotation', [(t, 14 if i % 2 == 0 else 4, 0, 0) for i, t in enumerate(beats)])
    loop(a, 'arm_left', 'rotation', [(0, -46, 0, -48), (0.8, -50, 0, -46)])
    loop(a, 'forearm_left', 'rotation', [(0, -28, 0, 0), (0.4, -34, 0, 0), (0.8, -24, 0, 0), (1.2, -34, 0, 0)])
    loop(a, 'hand_left', 'rotation', [(0, -10, 0, -10), (0.2, -10, 0, -2), (0.4, -10, 0, -12), (0.6, -10, 0, 0),
                                      (0.8, -10, 0, -10), (1.0, -10, 0, -2), (1.2, -10, 0, -12), (1.4, -10, 0, 0)])
    strum = [(i * 0.1, -40 if i % 2 == 0 else -48, 0, 16) for i in range(16)]
    loop(a, 'arm_right', 'rotation', strum)
    loop(a, 'forearm_right', 'rotation', [(i * 0.1, -70 if i % 2 == 0 else -88, -48, 0) for i in range(16)])
    loop(a, 'hand_right', 'rotation', [(i * 0.1, 14 if i % 2 == 0 else -30, 0, 0) for i in range(16)])
    loop(a, 'leg_right', 'rotation', [(0, -14, 0, 8), (0.8, -14, 0, 8)])
    loop(a, 'shin_right', 'rotation', [(t, 22 if i % 2 == 0 else 14, 0, 0) for i, t in enumerate(beats)])
    loop(a, 'leg_left', 'rotation', [(0, 10, 0, -6), (0.8, 10, 0, -6)])
    loop(a, 'shin_left', 'rotation', [(0, 6, 0, 0), (0.8, 6, 0, 0)])
    loop(a, 'foot_left', 'rotation', [(t, -14 if i % 2 == 0 else 0, 0, 0) for i, t in enumerate(beats)], LIN)
    ears(a, m, [(t, -10 if i % 2 == 0 else 4, 0, 4) for i, t in enumerate(beats)],
         [(t, 0, 0, 22 if i % 2 == 0 else -10) for i, t in enumerate(beats)])
    return a


def hat_tip(c, m):
    """Raises his right hand to the brim, lifts the top hat while bowing, puts it back and waves."""
    L = 3.2
    a = Anim(c, 'perform_2', L)
    a.rot('arm_right', [(0, 0, 0, 2), (0.5, -140, -24, 18), (0.7, -150, -26, 16), (1.5, -150, -26, 16),
                        (1.8, -30, 0, 120), (2.1, -30, 0, 140), (2.4, -30, 0, 120), (2.7, -30, 0, 140), (L, 0, 0, 2)])
    a.rot('forearm_right', [(0, 0, 0, 0), (0.5, -78, 0, 0), (0.7, -84, 0, 0), (1.5, -84, 0, 0), (1.8, -20, 0, 0), (2.7, -20, 0, 0), (L, 0, 0, 0)])
    a.rot('hand_right', [(0, 0, 0, 0), (0.7, -30, 0, 0), (1.5, -30, 0, 0), (1.8, 0, 0, 0), (2.1, 0, 0, 18), (2.4, 0, 0, -10),
                         (2.7, 0, 0, 18), (L, 0, 0, 0)])
    a.pos('hat', [(0, 0, 0, 0), (0.7, 0, 0, 0), (0.95, 0, 2.4, -1.2), (1.3, 0, 2.4, -1.2), (1.55, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('hat', [(0, 0, 0, 0), (0.7, 0, 0, 0), (0.95, -24, 0, 0), (1.3, -24, 0, 0), (1.55, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('torso', [(0, 0, 0, 0), (0.7, 2, 0, 0), (1.0, 24, 0, 0), (1.3, 24, 0, 0), (1.6, 0, 0, 0), (2.4, -2, 6, 0), (L, 0, 0, 0)])
    a.rot('head', [(0, 0, 0, 0), (0.7, -6, 10, 4), (1.0, 14, 0, 0), (1.3, 14, 0, 0), (1.6, -6, 12, 6), (2.6, -6, 16, 8), (L, 0, 0, 0)])
    a.rot('arm_left', [(0, 0, 0, 0), (0.7, -10, 0, -8), (1.0, -42, 40, -10), (1.3, -42, 40, -10), (1.6, -6, 0, -8), (L, 0, 0, 0)])
    a.rot('forearm_left', [(0, 0, 0, 0), (0.7, -30, 0, 0), (1.0, -84, 0, 0), (1.3, -84, 0, 0), (1.6, -14, 0, 0), (L, 0, 0, 0)])
    a.rot('jaw', [(0, 0, 0, 0), (0.6, 10, 0, 0), (0.9, 0, 0, 0), (1.7, 0, 0, 0), (1.9, 16, 0, 0), (2.1, 4, 0, 0),
                  (2.3, 16, 0, 0), (2.5, 4, 0, 0), (L, 0, 0, 0)])
    a.rot('leg_right', [(0, 0, 0, 0), (0.8, -14, 0, 0), (1.3, -14, 0, 0), (1.7, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('shin_right', [(0, 0, 0, 0), (0.8, 6, 0, 0), (1.3, 6, 0, 0), (1.7, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('leg_left', [(0, 0, 0, 0), (0.8, 14, 0, 0), (1.3, 14, 0, 0), (1.7, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('shin_left', [(0, 0, 0, 0), (0.8, 24, 0, 0), (1.3, 24, 0, 0), (1.7, 0, 0, 0), (L, 0, 0, 0)])
    a.pos('body', [(0, 0, 0, 0), (0.8, 0, -0.7, 0), (1.3, 0, -0.7, 0), (1.7, 0, 0, 0), (L, 0, 0, 0)])
    return a


def marionette(c, m):
    """Broken-down marionette dance: snaps between jerky poses like a puppet on cut strings,
    fingers clacking, head twitching."""
    L = 2.4
    a = Anim(c, 'perform_2', L)
    P = [  # t, torso, head, armR, foreR, armL, foreL, body y, jaw
        (0.0, (4, 0, 6), (8, 0, 22), (-30, 0, 40), -40, (-10, 0, -10), -10, 0.0, 6),
        (0.3, (6, 10, -4), (-6, 20, -16), (-90, 0, 20), -10, (-40, 0, -50), -70, -0.4, 26),
        (0.6, (2, -8, 8), (12, -18, 26), (-20, 0, 60), -80, (-100, 0, -20), -20, 0.2, 4),
        (0.9, (8, 0, -6), (2, 6, -30), (-120, 0, 10), -30, (-20, 0, -40), -60, -0.6, 32),
        (1.2, (4, 12, 4), (-10, 24, 14), (-50, 0, 50), -60, (-80, 0, -60), -20, 0.0, 10),
        (1.5, (10, -10, -8), (14, -22, -20), (-100, 0, 30), -20, (-30, 0, -30), -80, -0.5, 30),
        (1.8, (2, 4, 10), (0, 8, 34), (-10, 0, 20), -10, (-110, 0, -30), -40, 0.1, 0),
        (2.1, (6, -6, -4), (6, -10, -12), (-70, 0, 45), -50, (-60, 0, -45), -50, -0.3, 22),
    ]
    P = P + [(L,) + P[0][1:]]

    def snap(sel):
        out = []
        for i, p in enumerate(P):
            v = sel(p)
            if i > 0:
                out.append((round(p[0] - 0.07, 4),) + tuple(sel(P[i - 1])) + (LIN,))
            out.append((p[0],) + tuple(v) + (LIN,))
        return out
    a.rot('torso', snap(lambda p: p[1]))
    a.rot('head', snap(lambda p: p[2]))
    a.rot('arm_right', snap(lambda p: p[3]))
    a.rot('forearm_right', snap(lambda p: (p[4], 0, 0)))
    a.rot('arm_left', snap(lambda p: p[5]))
    a.rot('forearm_left', snap(lambda p: (p[6], 0, 0)))
    a.pos('body', snap(lambda p: (0, p[7], 0)))
    a.rot('jaw', snap(lambda p: (p[8], 0, 0)))
    if has(m, 'hat'):
        a.rot('hat', snap(lambda p: (0, 0, -0.4 * p[2][2])))
    step = [(0, 0, 0, 4), (0.3, -16, 0, 4), (0.6, 0, 0, 4), (0.9, -16, 0, 4), (1.2, 0, 0, 4), (1.5, -16, 0, 4), (1.8, 0, 0, 4), (2.1, -16, 0, 4)]
    loop(a, 'leg_right', 'rotation', step, LIN)
    loop(a, 'leg_left', 'rotation', mirror(step), LIN, shift=0.3)
    knee = [(t, -x * 1.4, 0, 0) for (t, x, y, z) in step]
    loop(a, 'shin_right', 'rotation', knee, LIN)
    loop(a, 'shin_left', 'rotation', knee, LIN, shift=0.3)
    fingers(a, m, [(0, 10), (0.15, 50), (0.3, 10), (0.45, 50), (0.6, 10), (0.75, 50), (0.9, 10), (1.05, 50),
                   (1.2, 10), (1.35, 50), (1.5, 10), (1.65, 50), (1.8, 10), (1.95, 50), (2.1, 10), (2.25, 50)], spread=14)
    ears(a, m, [(0, 0, 0, 0), (0.6, 0, 0, 10), (1.2, 0, 0, 0), (1.8, 0, 0, -10)])
    return a


def make(char, model):
    return [f(char, model).d for f in (idle, walk, run, jumpscare, pose_1, pose_2, perform_1, perform_2)]
