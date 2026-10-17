"""Animation set shared by all three animatronics (bone names come from rig.py).

Values use the Bedrock / Blockbench keyframe convention:
  rotation x: negative swings a hanging limb forward; positive tips the head/torso forward;
              positive on the jaw opens the mouth.
  rotation y: positive turns towards the character's right.
  rotation z: positive moves the right arm outward (left arm outward = negative).
  position:   units (1/16 block); y up, negative z = forward.
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


def S(p, ph=0.0, n=1):
    return math.sin(2 * math.pi * (p * n + ph))


def C(p, ph=0.0, n=1):
    return math.cos(2 * math.pi * (p * n + ph))


def has(model, bone):
    return bone in model.bones


# ------------------------------------------------------------------------------------------
def idle(c, m):
    a = Anim(c, 'idle', 4.0)
    a.cycle('torso', 'rotation', lambda p: (1.5 * S(p), 0, 0))
    a.cycle('body', 'position', lambda p: (0, 0.15 * S(p, 0.25), 0))
    a.cycle('head', 'rotation', lambda p: (-1.5 * S(p, 0.1), 4 * S(p, 0.0), 1.5 * S(p, 0.3)))
    a.cycle('arm_right', 'rotation', lambda p: (2 * S(p, 0.2), 0, 2 + 1.5 * S(p)))
    a.cycle('arm_left', 'rotation', lambda p: (2 * S(p, 0.7), 0, -2 - 1.5 * S(p)))
    a.cycle('jaw', 'rotation', lambda p: (max(0, 6 * S(p, 0.0, 2)) if p > 0.5 else 0, 0, 0), steps=16)
    ears(a, m, amp=4)
    fingers(a, m, lambda p: 6 + 4 * S(p))
    return a


def ears(a, m, amp=4, n=1):
    if has(m, 'ear_left_tip'):
        a.cycle('ear_right', 'rotation', lambda p: (amp * 0.5 * S(p, 0.0, n), 0, amp * S(p, 0.15, n)))
        a.cycle('ear_left', 'rotation', lambda p: (0, 0, -amp * 0.6 * S(p, 0.4, n)))
        a.cycle('ear_left_tip', 'rotation', lambda p: (0, 0, amp * 1.6 * S(p, 0.55, n)))
    elif has(m, 'ear_right'):
        a.cycle('ear_right', 'rotation', lambda p: (0, 0, amp * 0.4 * S(p, 0.0, n)))
        a.cycle('ear_left', 'rotation', lambda p: (0, 0, -amp * 0.4 * S(p, 0.2, n)))


def fingers(a, m, fn, spread=0.0):
    if not has(m, 'finger1_right'):
        return
    for s, sg in (('right', 1), ('left', -1)):
        for i, f in enumerate(('finger1', 'finger2', 'finger3')):
            a.cycle(f'{f}_{s}', 'rotation', lambda p, i=i: (-fn((p + 0.08 * i) % 1), 0, sg * spread * (1 - i)))
        a.cycle(f'thumb_{s}', 'rotation', lambda p: (-0.6 * fn(p), 0, -sg * 8))


# ------------------------------------------------------------------------------------------
def walk(c, m):
    a = Anim(c, 'walk', 1.2)
    a.cycle('leg_right', 'rotation', lambda p: (-24 * C(p), 0, 0))
    a.cycle('leg_left', 'rotation', lambda p: (24 * C(p), 0, 0))
    knee = lambda p: 6 + 30 * max(0.0, S(p, 0.5)) ** 1.5
    a.cycle('shin_right', 'rotation', lambda p: (knee(p), 0, 0))
    a.cycle('shin_left', 'rotation', lambda p: (knee((p + 0.5) % 1), 0, 0))
    foot = lambda p: -10 * C(p) + 8 * max(0.0, S(p, 0.5))
    a.cycle('foot_right', 'rotation', lambda p: (-foot(p) * 0.6, 0, 0))
    a.cycle('foot_left', 'rotation', lambda p: (-foot((p + 0.5) % 1) * 0.6, 0, 0))
    a.cycle('body', 'position', lambda p: (0, 0.55 * abs(S(p, 0.25)) - 0.2, 0), steps=16)
    a.cycle('body', 'rotation', lambda p: (0, 5 * C(p), 2 * S(p)))
    a.cycle('torso', 'rotation', lambda p: (4, -4 * C(p), -1.5 * S(p)))
    a.cycle('head', 'rotation', lambda p: (-3 + 2 * S(p, 0.25, 2), -2 * C(p), 1 * S(p)))
    a.cycle('arm_right', 'rotation', lambda p: (20 * C(p), 0, 4))
    a.cycle('arm_left', 'rotation', lambda p: (-20 * C(p), 0, -4))
    a.cycle('forearm_right', 'rotation', lambda p: (-10 - 8 * max(0, -C(p, 0.08)), 0, 0))
    a.cycle('forearm_left', 'rotation', lambda p: (-10 - 8 * max(0, C(p, 0.08)), 0, 0))
    a.cycle('jaw', 'rotation', lambda p: (2 + 2 * S(p, 0, 2), 0, 0))
    ears(a, m, amp=5, n=2)
    fingers(a, m, lambda p: 10 + 6 * S(p, 0, 2))
    return a


def run(c, m):
    a = Anim(c, 'run', 0.64)
    a.cycle('leg_right', 'rotation', lambda p: (-48 * C(p), 0, 0))
    a.cycle('leg_left', 'rotation', lambda p: (48 * C(p), 0, 0))
    knee = lambda p: 12 + 72 * max(0.0, S(p, 0.45)) ** 1.2
    a.cycle('shin_right', 'rotation', lambda p: (knee(p), 0, 0))
    a.cycle('shin_left', 'rotation', lambda p: (knee((p + 0.5) % 1), 0, 0))
    a.cycle('foot_right', 'rotation', lambda p: (12 * C(p) - 8, 0, 0))
    a.cycle('foot_left', 'rotation', lambda p: (-12 * C(p) - 8, 0, 0))
    a.cycle('body', 'position', lambda p: (0, 1.4 * abs(S(p, 0.15)) - 0.6, -0.5), steps=16)
    a.cycle('body', 'rotation', lambda p: (6, 9 * C(p), 2.5 * S(p)))
    a.cycle('torso', 'rotation', lambda p: (14 + 2 * S(p, 0.1, 2), -9 * C(p), -2 * S(p)))
    a.cycle('head', 'rotation', lambda p: (-16 + 3 * S(p, 0.3, 2), -4 * C(p), 0))
    a.cycle('arm_right', 'rotation', lambda p: (48 * C(p) - 10, 0, 8))
    a.cycle('arm_left', 'rotation', lambda p: (-48 * C(p) - 10, 0, -8))
    a.cycle('forearm_right', 'rotation', lambda p: (-62 - 15 * C(p), 0, 0))
    a.cycle('forearm_left', 'rotation', lambda p: (-62 + 15 * C(p), 0, 0))
    a.cycle('hand_right', 'rotation', lambda p: (-10, 0, 0))
    a.cycle('hand_left', 'rotation', lambda p: (-10, 0, 0))
    a.cycle('jaw', 'rotation', lambda p: (8 + 5 * S(p, 0, 2), 0, 0))
    ears(a, m, amp=9, n=2)
    fingers(a, m, lambda p: 25 + 10 * S(p, 0, 2))
    return a


# ------------------------------------------------------------------------------------------
def jumpscare(c, m):
    """Lunge at the camera, mouth wide open, violent head shake. Holds the scream pose."""
    L = 1.6
    a = Anim(c, 'jumpscare', L, loop='hold')
    a.pos('body', [(0, 0, 0, 0), (0.12, 0, -0.6, 2.2), (0.3, 0, 1.4, -10), (0.38, 0, 1.0, -9), (L, 0, 1.0, -9)])
    a.rot('body', [(0, 0, 0, 0), (0.12, -6, 0, 0), (0.3, 10, 0, 0), (L, 10, 0, 0)])
    a.rot('torso', [(0, 0, 0, 0), (0.12, -10, 0, 0), (0.3, 18, 0, 0), (0.42, 14, 0, 0), (L, 14, 0, 0)])
    a.rot('leg_right', [(0, 0, 0, 0), (0.12, 8, 0, 0), (0.3, -30, 0, 3), (L, -30, 0, 3)])
    a.rot('leg_left', [(0, 0, 0, 0), (0.12, 8, 0, 0), (0.3, 22, 0, -3), (L, 22, 0, -3)])
    a.both('shin', [(0, 0, 0, 0), (0.12, 14, 0, 0), (0.3, 26, 0, 0), (L, 26, 0, 0)])
    a.both('arm', [(0, 0, 0, 0), (0.12, 15, 0, 14), (0.3, -42, 0, 46), (0.42, -38, 0, 42), (L, -38, 0, 42)])
    a.both('forearm', [(0, 0, 0, 0), (0.12, -15, 0, 0), (0.3, -62, 0, 0), (L, -62, 0, 0)])
    a.both('hand', [(0, 0, 0, 0), (0.3, -25, 0, 0), (L, -25, 0, 0)])
    # head + jaw: snap open, then shake until the end
    head = [(0, 0, 0, 0, CAT), (0.12, -14, 0, 0, CAT), (0.3, -24, 0, 0, LIN)]
    jaw = [(0, 0, 0, 0, CAT), (0.12, 4, 0, 0, CAT), (0.26, 34, 0, 0, LIN)]
    t, i = 0.3, 0
    while t < L - 1e-6:
        t = min(L, t + 0.05)
        sgn = 1 if i % 2 == 0 else -1
        head.append((t, -24 + 2 * sgn, 6 * sgn, -7 * sgn, LIN))
        jaw.append((t, 31 + 4 * sgn, 0, 0, LIN))
        i += 1
    a.rot('head', head)
    a.rot('jaw', jaw)
    a.pos('head', [(0, 0, 0, 0), (0.3, 0, 0.4, -1.5), (L, 0, 0.4, -1.5)])
    if has(m, 'ear_left_tip'):
        a.rot('ear_right', [(0, 0, 0, 0), (0.3, -25, 0, 10), (0.5, -18, 0, 4), (L, -18, 0, 4)])
        a.rot('ear_left_tip', [(0, 0, 0, 0), (0.3, 0, 0, 25), (0.5, 0, 0, -10), (0.7, 0, 0, 12), (L, 0, 0, 0)])
    if has(m, 'hat'):
        a.rot('hat', [(0, 0, 0, 0), (0.3, -12, 0, 6), (0.5, -8, 0, -4), (L, -8, 0, -4)])
    if has(m, 'finger1_right'):
        for s, sg in (('right', 1), ('left', -1)):
            for i, f in enumerate(('finger1', 'finger2', 'finger3')):
                a.rot(f'{f}_{s}', [(0, 0, 0, 0), (0.3, -20, 0, sg * (14 - 14 * i)), (L, -35, 0, sg * (14 - 14 * i))])
            a.rot(f'thumb_{s}', [(0, 0, 0, 0), (0.3, -10, 0, -sg * 20), (L, -10, 0, -sg * 20)])
    return a


# ------------------------------------------------------------------------------------------
def pose_1(c, m):
    """Show-stopper: right arm raised to the crowd, left hand on the hip."""
    a = Anim(c, 'pose_1', 2.0)
    a.cycle('body', 'rotation', lambda p: (0, -8, 3 + 0.8 * S(p)))
    a.cycle('body', 'position', lambda p: (-0.6, 0.15 * S(p, 0.25), 0))
    a.cycle('torso', 'rotation', lambda p: (-3 + S(p), 6, -3))
    a.cycle('head', 'rotation', lambda p: (-6 + 1.5 * S(p, 0.2), 14, 8 + 1.5 * S(p)))
    a.cycle('arm_right', 'rotation', lambda p: (-25 + 3 * S(p), 0, 138 + 4 * S(p, 0.1)))
    a.cycle('forearm_right', 'rotation', lambda p: (-18 + 4 * S(p, 0.3), 0, 0))
    a.cycle('hand_right', 'rotation', lambda p: (-10, 0, 14 * S(p, 0, 2)))
    a.cycle('arm_left', 'rotation', lambda p: (8, 90, -48))
    a.cycle('forearm_left', 'rotation', lambda p: (-98, 0, 0))
    a.cycle('hand_left', 'rotation', lambda p: (-10, 0, 0))
    a.cycle('leg_right', 'rotation', lambda p: (-6, 0, 6))
    a.cycle('leg_left', 'rotation', lambda p: (4, 0, -3))
    a.cycle('shin_right', 'rotation', lambda p: (8, 0, 0))
    a.cycle('foot_right', 'rotation', lambda p: (-6, 0, -6))
    a.cycle('jaw', 'rotation', lambda p: (10 + 4 * S(p, 0, 2), 0, 0))
    ears(a, m, amp=3)
    fingers(a, m, lambda p: 4 + 2 * S(p), spread=10)
    return a


def pose_2(c, m):
    """Menacing stare: hunched forward, head slowly tilting while it locks eyes with you."""
    a = Anim(c, 'pose_2', 4.0)
    a.cycle('body', 'position', lambda p: (0, -0.6, -0.6))
    a.cycle('body', 'rotation', lambda p: (4, 0, 0))
    a.cycle('torso', 'rotation', lambda p: (16 + 1.5 * S(p), 0, 0))
    a.rot('head', [(0, -14, 0, 0), (0.9, -14, 0, 0), (1.3, -16, 10, 16), (2.6, -16, 10, 16), (3.0, -18, -6, -10),
                   (3.6, -15, 0, -2), (4.0, -14, 0, 0)])
    a.both('arm', [(0, -18, 0, 6), (2.0, -21, 0, 7), (4.0, -18, 0, 6)])
    a.both('forearm', [(0, -32, 0, 0), (2.0, -36, 0, 0), (4.0, -32, 0, 0)])
    a.both('hand', [(0, -12, 0, -8), (4.0, -12, 0, -8)])
    a.both('leg', [(0, -8, 0, 2), (4.0, -8, 0, 2)])
    a.both('shin', [(0, 16, 0, 0), (4.0, 16, 0, 0)])
    a.both('foot', [(0, -8, 0, 0), (4.0, -8, 0, 0)])
    a.rot('jaw', [(0, 0, 0, 0), (1.3, 0, 0, 0), (1.5, 14, 0, 0), (2.4, 14, 0, 0), (2.7, 0, 0, 0), (4.0, 0, 0, 0)])
    ears(a, m, amp=2)
    fingers(a, m, lambda p: 30 + 8 * S(p, 0, 2), spread=12)
    return a


# ------------------------------------------------------------------------------------------
def perform_1(c, m):
    """Singing on stage: sways to the beat, right hand holds the 'mic', mouth sings in rhythm."""
    a = Anim(c, 'perform_1', 2.0)
    a.cycle('body', 'rotation', lambda p: (0, 8 * S(p), 3 * S(p)), steps=16)
    a.cycle('body', 'position', lambda p: (0.4 * S(p), 0.3 * abs(S(p, 0, 2)), 0), steps=16)
    a.cycle('torso', 'rotation', lambda p: (2 + 2 * S(p, 0, 2), -3 * S(p), -2 * S(p)), steps=16)
    a.cycle('head', 'rotation', lambda p: (-4 + 6 * S(p, 0.1, 4), 6 * S(p, 0.2), 5 * S(p, 0.25)), steps=32)
    jaw = [(i / 16 * 2.0, (24 if i % 4 in (1, 2) else 4) if i % 8 != 7 else 0, 0, 0) for i in range(17)]
    a.rot('jaw', jaw)
    a.cycle('arm_right', 'rotation', lambda p: (-62 + 3 * S(p, 0, 2), -18, 12), steps=16)
    a.cycle('forearm_right', 'rotation', lambda p: (-86 + 4 * S(p, 0, 2), 0, 0), steps=16)
    a.cycle('hand_right', 'rotation', lambda p: (-20, 0, 0))
    a.cycle('arm_left', 'rotation', lambda p: (-35 - 15 * S(p, 0, 2), 18 * S(p), -28 - 14 * S(p, 0.25)), steps=16)
    a.cycle('forearm_left', 'rotation', lambda p: (-35 - 20 * S(p, 0.1, 2), 0, 0), steps=16)
    a.cycle('hand_left', 'rotation', lambda p: (0, 0, -10 + 10 * S(p, 0, 2)), steps=16)
    a.cycle('leg_left', 'rotation', lambda p: (-6 * max(0, S(p, 0, 2)), 0, -2), steps=16)
    a.cycle('foot_left', 'rotation', lambda p: (-12 * max(0, S(p, 0, 4)), 0, 0), steps=32)
    a.cycle('leg_right', 'rotation', lambda p: (0, 0, 2))
    ears(a, m, amp=6, n=2)
    fingers(a, m, lambda p: 12 + 8 * S(p, 0, 2), spread=8)
    return a


def perform_2(c, m):
    if c == 'bramble':
        return perform_guitar(c, m)
    if c == 'hollis':
        return perform_hat_tip(c, m)
    return perform_marionette(c, m)


def perform_guitar(c, m):
    """Air-guitar solo: left hand on the neck, right hand strumming, head-banging."""
    a = Anim(c, 'perform_2', 1.6)
    a.cycle('body', 'position', lambda p: (0, 0.5 * abs(S(p, 0, 2)) - 0.4, 0), steps=16)
    a.cycle('body', 'rotation', lambda p: (0, -18 + 4 * S(p), 2 * S(p, 0, 2)), steps=16)
    a.cycle('torso', 'rotation', lambda p: (8 + 3 * S(p, 0, 4), 0, -4), steps=32)
    a.cycle('head', 'rotation', lambda p: (6 + 14 * S(p, 0, 4), 10, 4 * S(p, 0, 2)), steps=32)
    a.cycle('jaw', 'rotation', lambda p: (10 + 8 * S(p, 0.1, 4), 0, 0), steps=32)
    a.cycle('arm_left', 'rotation', lambda p: (-46 + 4 * S(p, 0, 2), 0, -48), steps=16)
    a.cycle('forearm_left', 'rotation', lambda p: (-28 + 6 * S(p, 0.3, 2), 0, 0), steps=16)
    a.cycle('hand_left', 'rotation', lambda p: (-10, 0, -14 + 10 * S(p, 0, 4)), steps=32)
    a.cycle('arm_right', 'rotation', lambda p: (-22 + 7 * S(p, 0, 8), -88, 10), steps=48)
    a.cycle('forearm_right', 'rotation', lambda p: (-88 + 8 * S(p, 0.1, 8), 0, 0), steps=48)
    a.cycle('hand_right', 'rotation', lambda p: (-15 + 28 * S(p, 0.2, 8), 0, 0), steps=48)
    a.cycle('leg_right', 'rotation', lambda p: (-14, 0, 8))
    a.cycle('leg_left', 'rotation', lambda p: (10 - 6 * max(0, S(p, 0, 4)), 0, -6), steps=32)
    a.cycle('shin_right', 'rotation', lambda p: (16 + 6 * abs(S(p, 0, 2)), 0, 0), steps=16)
    a.cycle('shin_left', 'rotation', lambda p: (8, 0, 0))
    ears(a, m, amp=12, n=4)
    return a


def perform_hat_tip(c, m):
    """Tips his top hat to the audience with a bow, then waves."""
    L = 3.2
    a = Anim(c, 'perform_2', L)
    a.rot('arm_right', [(0, 0, 0, 4), (0.6, -150, -20, 26), (1.0, -158, -22, 24), (1.6, -158, -22, 24),
                        (2.0, -150, 0, 30), (2.3, -150, 0, 44), (2.6, -150, 0, 26), (2.9, -150, 0, 44), (L, 0, 0, 4)])
    a.rot('forearm_right', [(0, 0, 0, 0), (0.6, -70, 0, 0), (1.6, -70, 0, 0), (2.0, -20, 0, 0), (2.9, -20, 0, 0), (L, 0, 0, 0)])
    a.rot('hand_right', [(0, 0, 0, 0), (0.6, -30, 0, 0), (1.6, -30, 0, 0), (2.0, 0, 0, 0), (L, 0, 0, 0)])
    a.pos('hat', [(0, 0, 0, 0), (0.6, 0, 0, 0), (0.85, 0, 2.6, -1.0), (1.35, 0, 2.6, -1.0), (1.6, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('hat', [(0, 0, 0, 0), (0.6, 0, 0, 0), (0.85, -22, 0, 0), (1.35, -22, 0, 0), (1.6, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('torso', [(0, 0, 0, 0), (0.6, 2, 0, 0), (0.95, 26, 0, 0), (1.35, 26, 0, 0), (1.7, 0, 0, 0), (2.4, -3, 4, 0), (L, 0, 0, 0)])
    a.rot('head', [(0, 0, 0, 0), (0.6, -4, 8, 4), (0.95, 14, 0, 0), (1.35, 14, 0, 0), (1.7, -6, 10, 6), (2.6, -6, 14, 8), (L, 0, 0, 0)])
    a.rot('arm_left', [(0, 0, 0, 0), (0.6, -40, 0, -14), (0.95, -55, 30, -10), (1.35, -55, 30, -10), (1.7, -10, 0, -12), (L, 0, 0, 0)])
    a.rot('forearm_left', [(0, 0, 0, 0), (0.6, -70, 0, 0), (1.35, -80, 0, 0), (1.7, -20, 0, 0), (L, 0, 0, 0)])
    a.rot('jaw', [(0, 0, 0, 0), (0.6, 12, 0, 0), (0.9, 0, 0, 0), (1.7, 0, 0, 0), (1.9, 18, 0, 0), (2.1, 4, 0, 0),
                  (2.3, 18, 0, 0), (2.5, 4, 0, 0), (L, 0, 0, 0)])
    a.both('leg', [(0, 0, 0, 0), (0.95, 0, 0, 0), (1.35, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('leg_right', [(0, 0, 0, 0), (0.7, -16, 0, 0), (1.35, -16, 0, 0), (1.7, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('shin_right', [(0, 0, 0, 0), (0.7, 6, 0, 0), (1.35, 6, 0, 0), (1.7, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('leg_left', [(0, 0, 0, 0), (0.7, 14, 0, 0), (1.35, 14, 0, 0), (1.7, 0, 0, 0), (L, 0, 0, 0)])
    a.rot('shin_left', [(0, 0, 0, 0), (0.7, 22, 0, 0), (1.35, 22, 0, 0), (1.7, 0, 0, 0), (L, 0, 0, 0)])
    a.pos('body', [(0, 0, 0, 0), (0.7, 0, -0.8, 0), (1.35, 0, -0.8, 0), (1.7, 0, 0, 0), (L, 0, 0, 0)])
    ears(a, m, amp=4)
    return a


def perform_marionette(c, m):
    """Broken-down marionette dance: jerky stepped poses, twitching head and clacking fingers."""
    L = 2.4
    a = Anim(c, 'perform_2', L)
    poses = [
        # t, torso(x,y,z), head(x,y,z), armR(x,y,z), foreR, armL(x,y,z), foreL, body pos y, jaw
        (0.0, (4, 0, 6), (8, 0, 22), (-30, 0, 40), -40, (-10, 0, -10), -10, 0.0, 6),
        (0.3, (6, 10, -4), (-6, 20, -16), (-90, 0, 20), -10, (-40, 0, -50), -70, -0.4, 26),
        (0.6, (2, -8, 8), (12, -18, 26), (-20, 0, 60), -80, (-100, 0, -20), -20, 0.2, 4),
        (0.9, (8, 0, -6), (2, 6, -30), (-120, 0, 10), -30, (-20, 0, -40), -60, -0.6, 32),
        (1.2, (4, 12, 4), (-10, 24, 14), (-50, 0, 50), -60, (-80, 0, -60), -20, 0.0, 10),
        (1.5, (10, -10, -8), (14, -22, -20), (-100, 0, 30), -20, (-30, 0, -30), -80, -0.5, 30),
        (1.8, (2, 4, 10), (0, 8, 34), (-10, 0, 20), -10, (-110, 0, -30), -40, 0.1, 0),
        (2.1, (6, -6, -4), (6, -10, -12), (-70, 0, 45), -50, (-60, 0, -45), -50, -0.3, 22),
    ]
    torso, head, armR, foreR, armL, foreL, bpos, jaw = [], [], [], [], [], [], [], []
    for (t, to, he, ar, fr, al, fl, by, jw) in poses + [(L,) + poses[0][1:]]:
        torso.append((t, *to)); head.append((t, *he)); armR.append((t, *ar)); armL.append((t, *al))
        foreR.append((t, fr, 0, 0)); foreL.append((t, fl, 0, 0)); bpos.append((t, 0, by, 0)); jaw.append((t, jw, 0, 0))
    # fast snap into each pose, then hold (jerky): linear keys with a short transition
    def jerk(keys):
        out = []
        for i, k in enumerate(keys):
            if i > 0:
                out.append((k[0] - 0.07, *keys[i - 1][1:]))
            out.append(k)
        return [(t, x, y, z, LIN) for (t, x, y, z) in out if t >= 0]
    a.rot('torso', jerk(torso)); a.rot('head', jerk(head)); a.rot('jaw', jerk(jaw))
    a.rot('arm_right', jerk(armR)); a.rot('arm_left', jerk(armL))
    a.rot('forearm_right', jerk(foreR)); a.rot('forearm_left', jerk(foreL))
    a.pos('body', jerk(bpos))
    a.cycle('leg_right', 'rotation', lambda p: (-14 * max(0, S(p, 0, 2)), 0, 4), steps=16)
    a.cycle('leg_left', 'rotation', lambda p: (-14 * max(0, S(p, 0.5, 2)), 0, -4), steps=16)
    a.cycle('shin_right', 'rotation', lambda p: (22 * max(0, S(p, 0, 2)), 0, 0), steps=16)
    a.cycle('shin_left', 'rotation', lambda p: (22 * max(0, S(p, 0.5, 2)), 0, 0), steps=16)
    fingers(a, m, lambda p: 20 + 25 * max(0, S(p, 0, 6)), spread=14)
    if has(m, 'hat'):
        a.rot('hat', jerk([(k[0], 0, 0, -0.5 * k[2][2]) for k in poses + [(L,) + poses[0][1:]]]))
    return a


def make(char, model):
    return [f(char, model).d for f in (idle, walk, run, jumpscare, pose_1, pose_2, perform_1, perform_2)]
