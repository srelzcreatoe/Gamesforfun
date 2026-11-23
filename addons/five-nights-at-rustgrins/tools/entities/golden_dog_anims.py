"""The Golden Dog's eight source animations (idle, perform_1, perform_2, walk, run, jumpscare, pose_1,
pose_2), written for his own body: long hanging ears, a big belly, a tail, hands a size larger with four
fingers. Used by tools/entities/golden_dog.py.

How he moves: slow, heavy, deliberate. Idle he barely moves, then tilts his head like a dog listening.
pose_2 (the game's `slump`) is him powered down on his stage, chin on his chest, ears fallen forward.
His jumpscare is a lunge over the guard: the jaw drops off its hinge, the head thrashes, then stops dead
and tilts.

Rotations follow the cast's conventions (assets/source_models/README.txt, tools/entities/fk.py): arms
swing forward with -x, elbows and knees bend with -x / +x, a head looks down with +x; fingers curl about z
(- on the right hand, + on the left). Poses that need it are solved on the skeleton: feet planted under a
moving hip, a hand on the lapel, a hand at the hat brim.
"""
import copy
import math

import numpy as np

from fk import Skeleton
from rig import Rig, minimize, penetration

FINGERS = 4
SIDES = ('right', 'left')


def sgn(side):
    """Curl / roll sign: + on the left, - on the right."""
    return 1.0 if side == 'left' else -1.0


def R(x=0.0, y=0.0, z=0.0):
    return {'rotation': [float(x), float(y), float(z)]}


def merge(*poses):
    out = {}
    for p in poses:
        for b, ch in p.items():
            out.setdefault(b, {}).update(copy.deepcopy(ch))
    return out


def add(pose, bone, dx=0.0, dy=0.0, dz=0.0):
    """Adds to a bone's rotation (a new pose)."""
    out = copy.deepcopy(pose)
    r = out.setdefault(bone, {}).get('rotation', [0.0, 0.0, 0.0])
    out[bone]['rotation'] = [r[0] + dx, r[1] + dy, r[2] + dz]
    return out


# ------------------------------------------------------------------ hands
def hand(side, base=10.0, mid=16.0, tip=10.0, thumb=(5.0, 5.0), thumb_tip=4.0, spread=0.0, per=None):
    """Finger rotations of one hand. base / mid / tip: curl of the three joints (degrees towards the palm);
    per: one (base, mid, tip) per finger; spread: fan the fingers out; thumb: (pitch, curl)."""
    s = sgn(side)
    out = {}
    for n in range(1, FINGERS + 1):
        b, m, t = per[n - 1] if per else (base, mid, tip)
        out[f'{side}_finger{n}'] = R(spread * (n - 2.5), 0, s * b)
        out[f'{side}_finger{n}_mid'] = R(0, 0, s * m)
        out[f'{side}_finger{n}_tip'] = R(0, 0, s * t)
    out[f'{side}_thumb'] = R(thumb[0], 0, s * thumb[1])
    out[f'{side}_thumb_tip'] = R(thumb_tip, 0, 0)
    return out


def relaxed(side):
    return hand(side)


def limp(side):
    return hand(side, 16, 24, 18, thumb=(8, 10), thumb_tip=10)


def claw(side, k=1.0):
    """Fingers spread and hooked; k = 0 open .. 1 hooked hard."""
    return hand(side, -10 + 14 * k, 26 + 22 * k, 30 + 26 * k, thumb=(-24, -8 + 16 * k), thumb_tip=12 + 16 * k, spread=9.0)


def grip(side):
    return hand(side, 42, 58, 44, thumb=(4, 22), thumb_tip=14)


def pointing(side):
    return hand(side, per=[(2, 6, 4), (58, 78, 56), (62, 80, 58), (64, 80, 58)], thumb=(6, 26), thumb_tip=16)


def open_hand(side):
    return hand(side, 2, 6, 4, thumb=(-12, -6), thumb_tip=2, spread=5.0)


# ------------------------------------------------------------------ clips
class Clip:
    def __init__(self, length, loop=True):
        self.length, self.loop = float(length), loop
        self.keys = []                # (t, pose)

    def key(self, t, pose):
        self.keys.append((round(float(t), 3), copy.deepcopy(pose)))
        return self

    def build(self):
        self.keys.sort(key=lambda k: k[0])
        chans = {}
        for t, pose in self.keys:
            for b, ch in pose.items():
                for c, v in ch.items():
                    chans.setdefault((b, c), []).append((t, [round(float(x), 2) for x in v]))
        bones = {}
        for (b, c), ks in sorted(chans.items()):
            if all(v == ks[0][1] for _, v in ks):
                bones.setdefault(b, {})[c] = ks[0][1]
            else:
                ch = {}
                for t, v in ks:
                    ch[f'{t:.2f}'.rstrip('0').rstrip('.') if t != int(t) else f'{t:.1f}'] = v
                bones.setdefault(b, {})[c] = ch
        return {'loop': self.loop, 'animation_length': self.length, 'bones': bones}


# ------------------------------------------------------------------ solving on the skeleton
class Body:
    def __init__(self, geo):
        self.sk = Skeleton(geo)
        self.rg = Rig(self.sk)
        self.bones = self.sk.bones
        W = self.sk.world({})
        self.ankle0 = {s: self.sk.point(W, f'{s}_foot', self.bones[f'{s}_foot']['pivot']) for s in SIDES}

    def ground(self, pose):
        """Raise / lower the hips so the lowest sole rests on the floor."""
        p = copy.deepcopy(pose)
        pos = p.setdefault('waist', {}).get('position', [0.0, 0.0, 0.0])
        p['waist']['position'] = [pos[0], 0.0, pos[2]]
        lo = self.sk.lowest(self.sk.world(p), self.rg.legs())
        p['waist']['position'] = [pos[0], -lo, pos[2]]
        return p

    def plant(self, pose, step=None):
        """Leg rotations that keep both feet where they stand (soles flat) under the hips of this pose.
        step: {side: (dx, dy, dz)} moves a foot from its standing place."""
        p = copy.deepcopy(pose)
        sk = self.sk
        for s in SIDES:
            tgt = self.ankle0[s] + np.array((step or {}).get(s, (0.0, 0.0, 0.0)), float)

            def build(x, s=s):
                q = copy.deepcopy(p)
                q[f'{s}_leg'] = R(x[0], 0, x[2])
                q[f'{s}_shin'] = R(x[1], 0, 0)
                return q

            def cost(x, s=s, tgt=tgt):
                W = sk.world(build(x))
                a = sk.point(W, f'{s}_foot', self.bones[f'{s}_foot']['pivot'])
                return float(np.sum((a - tgt) ** 2)) + 1e-4 * (x[1] - 20) ** 2
            x, _ = minimize(cost, [-20.0, 40.0, 0.0], [10.0, 10.0, 4.0], [-110.0, 0.0, -30.0], [60.0, 140.0, 30.0], iters=40, restarts=2)
            p = build(x)
            # the sole flat on the floor: undo the leg chain's pitch and roll
            Rw, _ = sk.world(p)[f'{s}_shin']
            pitch = math.degrees(math.atan2(-Rw[1, 2], Rw[1, 1]))      # how far the shin's up axis tips
            roll = math.degrees(math.atan2(Rw[1, 0], Rw[1, 1]))
            p[f'{s}_foot'] = R(-pitch, 0, -roll)
        return p

    def reach(self, pose, side, wrist, elbow, seed, avoid=None, w_elbow=0.3, iters=30):
        """Arm rotations that put the wrist at a point (model pixels) with the elbow near another."""
        sk, rg = self.sk, self.rg
        mine = rg.forearm(side, props=True)
        avoid = avoid if avoid is not None else [b for b in ('torso', 'waist', 'head', 'jaw', 'hat', f'{side}_ear') if b in self.bones]
        wrist, elbow = np.array(wrist, float), np.array(elbow, float)

        def build(x):
            q = copy.deepcopy(pose)
            q[f'{side}_arm'] = R(x[0], x[1], x[2])
            q[f'{side}_forearm'] = R(x[3], 0, 0)
            q[f'{side}_hand'] = R(x[4], 0, x[5])
            return q

        def cost(x):
            W = sk.world(build(x))
            c = 2.0 * float(np.sum((sk.point(W, f'{side}_hand', self.bones[f'{side}_hand']['pivot']) - wrist) ** 2))
            c += w_elbow * float(np.sum((sk.point(W, f'{side}_forearm', self.bones[f'{side}_forearm']['pivot']) - elbow) ** 2))
            c += 30.0 * penetration(sk, W, mine, avoid) ** 2
            return c + 0.002 * (x[4] ** 2 + x[5] ** 2)
        x, c = minimize(cost, seed, [8.0, 8.0, 8.0, 10.0, 6.0, 6.0], [-200.0, -120.0, -150.0, -140.0, -45.0, -45.0],
                        [80.0, 120.0, 150.0, 0.0, 45.0, 45.0], iters=iters, restarts=2)
        q = build(x)
        return {k: q[k] for k in (f'{side}_arm', f'{side}_forearm', f'{side}_hand')}


# ------------------------------------------------------------------ the animations
def stance(B, torso=3.0, head=4.0, knee=5.0):
    """How he stands: heavy, a little stooped, arms hanging, knees soft."""
    p = {
        'waist': R(0, 0, 0), 'torso': R(torso, 0, 0), 'head': R(head, 0, 0), 'jaw': R(0, 0, 0), 'hat': R(0, 0, 0),
        'right_ear': R(0, 0, 0), 'left_ear': R(0, 0, 0),
        'right_arm': R(-3, 0, -2), 'right_forearm': R(-12, 0, 0), 'right_hand': R(0, 0, 0),
        'left_arm': R(-3, 0, 2), 'left_forearm': R(-12, 0, 0), 'left_hand': R(0, 0, 0),
        'tail_1': R(0, 0, 0), 'tail_2': R(0, 0, 0), 'tail_3': R(0, 0, 0),
    }
    for s in SIDES:
        p[f'{s}_leg'] = R(-knee, 0, 0)
        p[f'{s}_shin'] = R(2 * knee, 0, 0)
        p[f'{s}_foot'] = R(-knee, 0, 0)
        p.update(relaxed(s))
    return B.ground(p)


def ears(pose, x=0.0, zr=0.0, zl=None):
    """Ear rotations on top of a pose: x swings both (- forward, + back), z rolls them (+ lifts the right ear
    out, - lifts the left)."""
    out = copy.deepcopy(pose)
    out['right_ear'] = R(x, 0, zr)
    out['left_ear'] = R(x, 0, -zr if zl is None else zl)
    return out


def idle(B):
    """Eight seconds. He stands and breathes, slowly. Once, his head tips to one side and stays there:
    a dog listening to something under the floor."""
    c = Clip(8.0)
    base = stance(B)

    def frame(breath=0.0, tilt=0.0, yaw=0.0, nod=0.0, ear=0.0, jaw=0.0, tail=0.0, twitch=0.0):
        p = copy.deepcopy(base)
        p['torso'] = R(3.0 + 0.9 * breath, 0, 0)
        p['head'] = R(4.0 - 0.6 * breath + nod, yaw, tilt)
        p['jaw'] = R(jaw, 0, 0)
        # the ears hang: they stay near upright while the head rolls, and the upper one pricks
        p['right_ear'] = R(0, 0, -0.55 * tilt + min(0.0, ear))
        p['left_ear'] = R(0, 0, -0.55 * tilt + max(0.0, ear))
        p['tail_1'] = R(0, tail, 0)
        p['tail_3'] = R(0, 0.6 * tail, 0)
        for s in SIDES:
            p[f'{s}_forearm'] = R(-12 - 1.2 * breath, 0, 0)
        if twitch:
            p['right_finger2_mid'] = R(0, 0, -16 - twitch)
            p['right_finger2_tip'] = R(0, 0, -10 - twitch)
        return p
    for t, kw in [
        (0.0, {}), (1.1, dict(breath=0.55)), (1.2, dict(breath=0.6, twitch=22)), (1.32, dict(breath=0.65, twitch=22)), (1.5, dict(breath=0.75)),
        (2.0, dict(breath=1.0)), (2.6, dict(breath=0.85)),
        (2.84, dict(breath=0.8, tilt=20, yaw=9, nod=1.5, ear=12, jaw=1.5)),            # the tilt: quick, a little too far
        (3.0, dict(breath=0.7, tilt=16, yaw=8, nod=1.0, ear=16, jaw=2)),
        (3.5, dict(breath=0.4, tilt=16, yaw=8, nod=1.0, ear=6, jaw=2)),
        (4.0, dict(breath=0.0, tilt=16, yaw=8, nod=1.0, ear=3, jaw=2)),
        (4.1, dict(breath=0.05, tilt=19, yaw=9.5, nod=2.0, ear=12, jaw=2)),              # a small servo twitch while he listens
        (4.22, dict(breath=0.1, tilt=16, yaw=8, nod=1.0, ear=5, jaw=2)),
        (5.2, dict(breath=0.6, tilt=16, yaw=8, nod=1.0, ear=2, jaw=2)),
        (6.0, dict(breath=1.0, tilt=3, yaw=1.5, nod=0.0, jaw=0.5)), (6.3, dict(breath=0.9)),
        (6.7, dict(breath=0.7, tail=9)), (7.2, dict(breath=0.4, tail=-7)), (7.7, dict(breath=0.15, tail=3)), (8.0, {}),
    ]:
        c.key(t, frame(**kw))
    return c.build()


def lapel_hold(B, base):
    """The left hand at the left lapel (elbow out and down), fingers closed on it."""
    arm = B.reach(base, 'left', (3.9, 26.9, -7.4), (9.6, 23.4, -1.6), [-40.0, 20.0, -6.0, -100.0, 0.0, 0.0])
    return merge(arm, grip('left'))


def pose_1(B):
    """The stage pose: tall, chest out, the left hand on his lapel, looking out from under the brim."""
    c = Clip(2.0)
    base = stance(B, torso=-1.0, head=7.0, knee=3.0)
    base = merge(base, {'right_arm': R(-5, 0, -3), 'right_forearm': R(-16, 0, 0)})
    base = merge(base, lapel_hold(B, base))
    base['head'] = R(7, -7, 0)
    base['hat'] = R(-2, 0, 0)

    def frame(head=(7, -7, 0), roll=0.0):
        p = copy.deepcopy(base)
        p['head'] = R(*head)
        for n, k in zip((4, 3, 2, 1), (0, 1, 2, 3)):          # a slow finger roll on the hanging hand
            w = max(0.0, 1.0 - abs(roll - k)) if roll >= 0 else 0.0
            p[f'right_finger{n}_mid'] = R(0, 0, -16 - 16 * w)
            p[f'right_finger{n}_tip'] = R(0, 0, -10 - 12 * w)
        return p
    c.key(0.0, frame())
    c.key(0.9, frame())
    c.key(0.98, frame(head=(8.5, -9.5, 1.5)))                 # a servo tick
    c.key(1.1, frame(head=(7, -7, 0), roll=0))
    c.key(1.2, frame(roll=1))
    c.key(1.3, frame(roll=2))
    c.key(1.4, frame(roll=3))
    c.key(1.55, frame(roll=-1))
    c.key(2.0, frame())
    return c.build()


def slump_pose(B):
    """Powered down, standing: the back bent, the head hanging until the chin rests on the chest, the arms
    dead weight, the ears fallen forward past his face."""
    p = stance(B, torso=15.0, head=0.0, knee=9.0)
    p['waist'] = merge(p, {'waist': R(5, 0, 0)})['waist']
    p['torso'] = R(15, 0, -2.5)
    lean = 20.0
    for s in SIDES:
        p[f'{s}_arm'] = R(-lean + 3, 0, sgn(s) * 1.0)       # the arms hang straight down under the bent shoulders
        p[f'{s}_forearm'] = R(-5, 0, 0)
        p[f'{s}_hand'] = R(6, 0, 0)
        p.update(limp(s))
    p['tail_1'] = R(18, 0, -22)
    p['tail_2'] = R(6, 0, -10)
    p['tail_3'] = R(0, 0, -12)
    p['hat'] = R(3, 0, -2)
    p['jaw'] = R(3, 0, 0)
    # the head: as far down as it goes before the jaw sinks into the chest (the bow tie takes the chin)
    sk, rg = B.sk, B.rg
    rest = penetration(sk, sk.world({}), ['head', 'jaw'], ['torso'])       # (the neck runs up into the head)
    best = (0.0, {'rotation': [20.0, 0.0, 5.0], 'position': [0.0, 0.0, 0.0]})
    for pitch in range(22, 62, 2):
        for fwd in (0.0, 0.6, 1.2, 1.8):
            q = copy.deepcopy(p)
            q['head'] = {'rotation': [float(pitch), 0.0, 5.0], 'position': [0.0, 0.25 * fwd, -fwd]}
            d = penetration(sk, sk.world(q), ['head', 'jaw'], ['torso']) - rest
            if d <= 0.45 and pitch - 4 * fwd > best[0]:
                best = (pitch - 4 * fwd, q['head'])
    p['head'] = best[1]
    hp = best[1]['rotation'][0] + lean
    p = ears(p, x=-0.82 * hp)                                # gravity: they hang plumb, so forward of the lowered head
    p['left_ear'] = R(-0.82 * hp, 0, -4)
    return B.plant(B.ground(p))


def pose_2(B):
    c = Clip(2.0)
    base = slump_pose(B)

    def frame(tw=0.0, sag=0.0):
        p = copy.deepcopy(base)
        if tw:
            p['left_finger3'] = R(0, 0, 16 + tw)
            p['left_finger3_mid'] = R(0, 0, 24 + 1.4 * tw)
        if sag:
            h = p['head']
            p['head'] = {'rotation': [h['rotation'][0] - sag, h['rotation'][1], h['rotation'][2]], 'position': h['position']}
        return p
    c.key(0.0, frame())
    c.key(1.2, frame())
    c.key(1.26, frame(tw=26))                                # a single malfunction twitch
    c.key(1.34, frame(tw=4))
    c.key(1.4, frame(tw=18, sag=0.8))
    c.key(1.5, frame())
    c.key(2.0, frame())
    return c.build()


def walk(B):
    """A slow, heavy walk (two steps in 2.4 s): the weight rolls from foot to foot, the arms swing late,
    the ears and the tail drag behind the body's sway."""
    L, n = 2.4, 12
    c = Clip(L)
    base = stance(B)
    for k in range(n + 1):
        t = L * k / n
        ph = 2 * math.pi * k / n
        s, co = math.sin(ph), math.cos(ph)
        p = copy.deepcopy(base)
        p['waist'] = {'rotation': [4.0, 5.0 * s, -3.2 * co], 'position': [0.9 * co, 0.0, 0.0]}
        p['torso'] = R(7.0 + 1.5 * math.cos(2 * ph), -7.0 * s, 2.2 * co)
        p['head'] = R(-3.0 - 2.0 * math.cos(2 * ph - 0.5), 2.0 * s, 1.0 * co)
        for side, sg_, cg in (('right', s, co), ('left', -s, -co)):
            a = 20.0 * sg_                                 # thigh: forward with +
            b = 10.0 + 34.0 * max(0.0, cg) ** 1.5          # knee: lifts while the leg comes forward
            p[f'{side}_leg'] = R(-4.0 - a - 0.5 * b, 0, 3.2 * co)
            p[f'{side}_shin'] = R(b, 0, 0)
            p[f'{side}_foot'] = R(a - 0.5 * b + 2.0 * max(0.0, -sg_) * 6.0 * max(0.0, -cg), 0, 0)
            sw = -math.sin(ph - 0.35) * (1.0 if side == 'right' else -1.0)     # the arm swings against its leg, a little late
            p[f'{side}_arm'] = R(-6.0 - 12.0 * sw, 0, sgn(side) * 2.0)
            p[f'{side}_forearm'] = R(-16.0 - 9.0 * max(0.0, sw), 0, 0)
        lag = math.sin(ph - 0.9)
        p['right_ear'] = R(-5.0 * math.sin(2 * ph - 0.8), 0, 3.0 * lag)
        p['left_ear'] = R(-5.0 * math.sin(2 * ph - 0.8), 0, 3.0 * lag)
        p['tail_1'] = R(4.0 * math.cos(2 * ph), 9.0 * lag, 0)
        p['tail_3'] = R(0, 6.0 * math.sin(ph - 1.5), 0)
        c.key(t, B.ground(p))
    return c.build()


def run(B):
    """A lumbering charge: bent forward, hands out to grab, the jaw hanging, the ears streaming back."""
    L, n = 1.0, 10
    c = Clip(L)
    base = stance(B)
    for k in range(n + 1):
        t = L * k / n
        ph = 2 * math.pi * k / n
        s, co = math.sin(ph), math.cos(ph)
        p = copy.deepcopy(base)
        p['waist'] = {'rotation': [12.0, 6.0 * s, -4.0 * co], 'position': [1.0 * co, 0.0, 0.0]}
        p['torso'] = R(14.0 + 3.0 * math.cos(2 * ph), -9.0 * s, 2.5 * co)
        p['head'] = R(-20.0 + 3.0 * math.cos(2 * ph - 0.6), 3.0 * s, 0)
        p['jaw'] = R(20.0 + 6.0 * math.cos(2 * ph), 0, 0)
        for side, sg_, cg in (('right', s, co), ('left', -s, -co)):
            a = 34.0 * sg_
            b = 22.0 + 52.0 * max(0.0, cg) ** 1.3
            p[f'{side}_leg'] = R(-12.0 - a - 0.5 * b, 0, 4.0 * co)
            p[f'{side}_shin'] = R(b, 0, 0)
            p[f'{side}_foot'] = R(a - 0.5 * b + 14.0 * max(0.0, -sg_) * max(0.0, -cg), 0, 0)
            sw = -sg_
            p[f'{side}_arm'] = R(-62.0 - 14.0 * sw, 0, sgn(side) * -10.0)
            p[f'{side}_forearm'] = R(-34.0 - 12.0 * max(0.0, sw), 0, 0)
            p[f'{side}_hand'] = R(-10, 0, 0)
            p.update(claw(side, 0.45 + 0.25 * max(0.0, sw)))
        p['right_ear'] = R(38.0 + 6.0 * math.sin(2 * ph), 0, 10.0)
        p['left_ear'] = R(38.0 + 6.0 * math.sin(2 * ph), 0, -10.0)
        p['hat'] = R(-4.0, 0, 0)
        p['tail_1'] = R(-30.0 + 6.0 * math.cos(2 * ph), 10.0 * s, 0)
        c.key(t, B.ground(p))
    return c.build()


def perform_1(B):
    """The old crooner (4 s, eight beats): a slow sway from foot to foot, the left hand on the lapel, the
    right hand beating time with one finger, the jaw working through the long notes."""
    c = Clip(4.0)
    base = stance(B, torso=0.0, head=2.0, knee=4.0)
    base = merge(base, lapel_hold(B, base), pointing('right'))
    jaws = [16, 5, 12, 3, 20, 20, 10, 0]
    for k in range(17):
        t = 0.25 * k
        beat = t / 0.5
        ph = 2 * math.pi * t / 4.0                             # one full sway per four beats... and back
        sw = math.sin(2 * ph)                                  # weight: right, left, right, left over the bar
        hit = 1.0 if k % 2 == 0 else 0.0                       # on the beat the hand is down
        p = copy.deepcopy(base)
        p['waist'] = {'rotation': [0.0, 0.0, -3.5 * sw], 'position': [1.0 * sw, 0.0, 0.0]}
        p['torso'] = R(1.0 + 1.5 * hit, 8.0 * sw, 2.0 * sw)
        j = jaws[int(beat) % 8] if k % 2 == 0 else 0.6 * jaws[int(beat) % 8] + 0.4 * jaws[(int(beat) + 1) % 8]
        p['jaw'] = R(j, 0, 0)
        p['head'] = R(2.0 + 4.0 * hit - 0.15 * j, -8.0 - 6.0 * sw, 3.0 * sw)
        p['right_arm'] = R(-34.0 + 4.0 * hit, 0, -16.0)
        p['right_forearm'] = R(-78.0 + 22.0 * hit, 0, 0)
        p['right_hand'] = R(-8.0 + 14.0 * hit, 0, 0)
        for s in SIDES:
            p[f'{s}_leg'] = R(-4, 0, 3.5 * sw)
            p[f'{s}_shin'] = R(8, 0, 0)
            p[f'{s}_foot'] = R(-4, 0, 0)
        p['right_ear'] = R(0, 0, 2.5 * sw)
        p['left_ear'] = R(0, 0, 2.5 * sw)
        p['tail_1'] = R(0, 8.0 * math.sin(2 * ph - 0.8), 0)
        c.key(t, B.ground(p))
    return c.build()


def perform_2(B):
    """He tips his hat to the house (4 s): the right hand goes up to the brim, the hat and the head dip,
    then both arms open wide, slowly, and come down."""
    c = Clip(4.0)
    base = stance(B, torso=0.0, head=2.0, knee=4.0)
    brim = B.reach(base, 'right', (-4.4, 40.6, -5.6), (-11.2, 33.5, -3.0), [-150.0, 0.0, 30.0, -110.0, 0.0, 0.0],
                   avoid=['torso', 'head', 'jaw', 'hat', 'right_ear'])
    pinch = hand('right', 30, 50, 40, thumb=(0, 26), thumb_tip=16)
    up = merge(base, brim, pinch)
    wide = copy.deepcopy(base)
    for s in SIDES:
        wide[f'{s}_arm'] = R(-34, 0, sgn(s) * -62)
        wide[f'{s}_forearm'] = R(-22, 0, 0)
        wide[f'{s}_hand'] = R(-12, 0, 0)
        wide.update(open_hand(s))
    half = copy.deepcopy(base)
    for s in SIDES:
        half[f'{s}_arm'] = R(-20, 0, sgn(s) * -30)
        half[f'{s}_forearm'] = R(-30, 0, 0)
        half.update(open_hand(s))
    mid_up = copy.deepcopy(base)
    mid_up['right_arm'] = R(-70, 0, -28)
    mid_up['right_forearm'] = R(-95, 0, 0)
    mid_up.update(pinch)

    def with_head(p, head, hat=0.0, jaw=0.0, torso=0.0):
        q = copy.deepcopy(p)
        q['head'] = R(*head)
        q['hat'] = R(hat, 0, 0)
        q['jaw'] = R(jaw, 0, 0)
        q['torso'] = R(torso, 0, 0)
        return q
    c.key(0.0, with_head(base, (2, 0, 0)))
    c.key(0.45, with_head(mid_up, (2, 4, 0)))
    c.key(0.95, with_head(up, (0, 6, 0)))
    c.key(1.15, with_head(up, (0, 6, 0)))
    c.key(1.45, with_head(add(add(up, 'right_arm', dx=5), 'right_forearm', dx=6), (9, 6, 0), hat=13, torso=4))   # the tip
    c.key(1.75, with_head(add(add(up, 'right_arm', dx=5), 'right_forearm', dx=6), (9, 6, 0), hat=13, torso=4))
    c.key(2.05, with_head(up, (1, 4, 0), hat=0, torso=1))
    c.key(2.45, with_head(half, (-3, 0, 0), jaw=6))
    c.key(2.95, with_head(wide, (-8, 0, 0), jaw=16, torso=-3))
    c.key(3.35, with_head(wide, (-7, 0, 0), jaw=14, torso=-3))
    c.key(3.7, with_head(half, (0, 0, 0), jaw=2))
    c.key(4.0, with_head(base, (2, 0, 0)))
    return c.build()


def jumpscare(B):
    """1.6 s, held. He comes down over you: hips forward and low, the jaw off its hinge, arms thrown wide
    and up; the head thrashes; then it stops dead, and tilts, the way he tilts it when he listens."""
    c = Clip(1.6, loop='hold_on_last_frame')
    base = stance(B)

    def frame(k=1.0, fwd=6.0, drop=3.2, yaw=0.0, roll=0.0, jaw=56.0, arm=0.0, clw=0.3, ear=1.0, nod=0.0, tw=0.0):
        """k: how far into the lunge (0 standing .. 1 over you)."""
        p = copy.deepcopy(base)
        lean_w, lean_t = 20.0 * k, 16.0 * k
        p['waist'] = {'rotation': [lean_w, 0.6 * yaw * 0.3, 0.0], 'position': [0.0, -drop * k, -fwd * k]}
        p['torso'] = R(lean_t, -0.35 * yaw, -0.3 * roll)
        # the face stays on you: the head lifts by what the back leans, less a little
        p['head'] = R(-(lean_w + lean_t) * 0.93 + nod, yaw, roll)
        p['jaw'] = R(jaw * (0.25 + 0.75 * k), 0, 0)
        p['hat'] = R(-6.0 * k, 0, -0.4 * roll)
        for s in SIDES:
            sg_ = sgn(s)
            # arms up and wide, elbows bent: the hands come up either side of the face, palms to you
            p[f'{s}_arm'] = R((-112.0 - arm) * k - 3 * (1 - k), sg_ * -14.0 * k, sg_ * (-44.0 - 0.5 * arm) * k + sg_ * 2 * (1 - k))
            p[f'{s}_forearm'] = R(-12 - 50.0 * k + 0.4 * arm, 0, 0)
            p[f'{s}_hand'] = R(-16.0 * k, 0, sg_ * 6.0 * k)
            p.update(claw(s, clw + (tw if s == 'right' else -tw)))
        # the ears fly out and back
        p['right_ear'] = R(26.0 * ear * k, 0, 46.0 * ear * k + 0.5 * roll)
        p['left_ear'] = R(26.0 * ear * k, 0, -46.0 * ear * k + 0.5 * roll)
        p['tail_1'] = R(-40.0 * k, 0, 0)
        return B.plant(p)
    c.key(0.0, frame(k=0.12, jaw=20, clw=0.0, ear=0.2))
    c.key(0.07, frame(k=0.8, fwd=6.5, jaw=50, clw=0.0, ear=1.0, arm=-10))
    c.key(0.12, frame(k=1.06, fwd=6.8, jaw=62, clw=0.05, ear=1.15, arm=8))                # overshoot
    # the thrash: head side to side, the jaw clattering, the whole body jolting; it dies away
    t, i = 0.17, 0
    while t < 1.0:
        amp = 1.0 - 0.45 * (t - 0.17) / 0.83
        sd = 1 if i % 2 == 0 else -1
        c.key(t, frame(k=1.0 + 0.03 * sd * amp, fwd=6.4 + 0.5 * sd * amp, yaw=13.0 * sd * amp, roll=-8.0 * sd * amp,
                       jaw=(60 if i % 2 == 0 else 44), arm=6.0 * sd * amp, clw=0.2 + 0.25 * (i % 2), ear=1.0 + 0.12 * sd,
                       nod=3.0 * sd * amp))
        t = round(t + 0.05, 3)
        i += 1
    c.key(1.02, frame(k=1.0, fwd=6.4, yaw=0, roll=0, jaw=58, clw=0.3, ear=0.9))            # stops dead
    c.key(1.14, frame(k=1.0, fwd=6.5, yaw=0, roll=0, jaw=58, clw=0.3, ear=0.75))
    c.key(1.34, frame(k=1.02, fwd=6.9, yaw=5, roll=19, jaw=60, clw=0.5, ear=0.6))          # ...and tilts
    c.key(1.44, frame(k=1.02, fwd=7.0, yaw=5, roll=17, jaw=60, clw=0.62, ear=0.55, tw=0.06))
    c.key(1.52, frame(k=1.02, fwd=7.0, yaw=5, roll=17, jaw=60, clw=0.7, ear=0.55, tw=-0.06))
    c.key(1.6, frame(k=1.02, fwd=7.0, yaw=5, roll=17, jaw=60, clw=0.78, ear=0.55, tw=0.04))
    return c.build()


def build_all(geo, cid='golden_dog'):
    B = Body(geo)
    out = {}
    for name, fn in (('idle', idle), ('perform_1', perform_1), ('perform_2', perform_2), ('walk', walk), ('run', run),
                     ('jumpscare', jumpscare), ('pose_1', pose_1), ('pose_2', pose_2)):
        out[f'animation.{cid}.{name}'] = fn(B)
    return {'format_version': '1.8.0', 'animations': out}
