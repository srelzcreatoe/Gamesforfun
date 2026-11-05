"""Brinesleeper rig: bones, cubes, forward kinematics (Bedrock geometry space).

Coordinate conventions (identical to Minecraft Bedrock .geo.json):
  * 1 unit = 1 pixel (16 px = 1 block), +Y up
  * the model faces -Z (north); +X is the model's LEFT side, -X its RIGHT side
  * bone rotations are degrees [x, y, z]; positive X tips the top of a part
    forward (and swings a hanging limb backward)
Cubes are authored in the unrotated "bind" space exactly like Bedrock expects;
bone rest rotations then fold the creature into the hunched pose of the
reference sheet.
"""
import math
import numpy as np

H = 26.0      # bind-space hip height
ZO = 6.0      # global +Z shift so the creature's footprint is centred on the origin


class Cube:
    def __init__(self, bone, name, x0, y0, z0, w, h, d, mat, **tags):
        self.bone = bone
        self.name = name
        self.origin = [float(x0), float(y0), float(z0) + ZO]
        self.size = [int(w), int(h), int(d)]
        assert all(s >= 1 for s in self.size), name
        self.mat = mat
        self.tags = tags
        self.uv = None

    @property
    def lo(self):
        return np.array(self.origin)

    @property
    def hi(self):
        return np.array(self.origin) + np.array(self.size)


class Bone:
    def __init__(self, name, parent, pivot, rotation=(0, 0, 0)):
        self.name = name
        self.parent = parent
        self.pivot = [float(pivot[0]), float(pivot[1]), float(pivot[2]) + ZO]
        self.rotation = [float(r) for r in rotation]
        self.cubes = []


class Rig:
    def __init__(self):
        self.bones = []
        self.by_name = {}

    def bone(self, name, parent, pivot, rotation=(0, 0, 0)):
        b = Bone(name, parent, pivot, rotation)
        self.bones.append(b)
        self.by_name[name] = b
        return b

    def cube(self, bone, name, x0, y0, z0, w, h, d, mat, **tags):
        c = Cube(bone, name, x0, y0, z0, w, h, d, mat, **tags)
        bone.cubes.append(c)
        return c

    def all_cubes(self):
        for b in self.bones:
            for c in b.cubes:
                yield c

    def children(self, name):
        return [b for b in self.bones if b.parent == name]


# ---------------------------------------------------------------- kinematics

def rot3(rx, ry, rz):
    """Bedrock euler (deg) -> 3x3 matrix in Bedrock coords.

    Matches Blockbench's preview (three.js 'ZYX' order with x/y negated after
    the bedrock->blockbench x-mirror):  R = Rz(-z) * Ry(y) * Rx(-x).
    """
    a, b, c = math.radians(-rx), math.radians(ry), math.radians(-rz)
    ca, sa, cb, sb, cc, sc = math.cos(a), math.sin(a), math.cos(b), math.sin(b), math.cos(c), math.sin(c)
    Rx = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]])
    Ry = np.array([[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]])
    Rz = np.array([[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def T(v):
    m = np.eye(4)
    m[:3, 3] = v
    return m


def R4(r3):
    m = np.eye(4)
    m[:3, :3] = r3
    return m


def world_matrices(rig, pose=None, include_rest=True):
    """pose: {bone: {'rotation': [..], 'position': [..], 'scale': [..]}} (animation values).
    Returns {bone_name: 4x4 world matrix} acting on absolute bind-space points."""
    pose = pose or {}
    out = {}
    for b in rig.bones:  # bones are declared parent-first
        p = np.array(b.pivot)
        a = pose.get(b.name, {})
        rot = np.array(b.rotation if include_rest else [0, 0, 0], dtype=float) + np.array(a.get('rotation', [0, 0, 0]), dtype=float)
        pos = np.array(a.get('position', [0, 0, 0]), dtype=float)
        sc = np.array(a.get('scale', [1, 1, 1]), dtype=float)
        local = T(p + pos) @ R4(rot3(*rot)) @ np.diag([sc[0], sc[1], sc[2], 1.0]) @ T(-p)
        parent = out[b.parent] if b.parent else np.eye(4)
        out[b.name] = parent @ local
    return out


def xform(m, p):
    return (m @ np.array([p[0], p[1], p[2], 1.0]))[:3]


# ---------------------------------------------------------------- the model

def build():
    rig = Rig()
    B, C = rig.bone, rig.cube

    B('root', None, (0, 0, 0))
    B('body', 'root', (0, H, 0))

    # ---------------- spine: pelvis -> thin waist -> tapered ribcage ----------------
    pelvis = B('pelvis', 'body', (0, H, 0), (12, 0, 0))
    C(pelvis, 'pelvis', -5.5, H - 1.5, -2.5, 11, 4, 5, 'torso', part='pelvis')

    waist = B('waist', 'pelvis', (0, H + 2.5, 0.5), (8, 0, 0))
    C(waist, 'waist', -3, H + 2, -1.5, 6, 7, 4, 'torso', part='waist')
    for i, y in enumerate((H + 3, H + 5, H + 7)):
        C(waist, f'vertebra_w{i}', -1, y, 2.5, 2, 1, 1, 'bone', part='vertebra')

    chest = B('chest', 'waist', (0, H + 8.5, 0.5), (10, 0, 0))
    C(chest, 'ribs_low', -4, H + 8, -2.5, 8, 3, 6, 'torso', part='ribs_low')
    C(chest, 'ribs_mid', -5, H + 11, -3, 10, 4, 7, 'torso', part='ribs_mid')
    C(chest, 'ribs_top', -7, H + 15, -3.5, 14, 4, 8, 'torso', part='ribs_top')
    # bony shoulder caps sit on the ribcage so the shoulder line stays square
    for s in (-1, 1):
        C(chest, 'shoulder_right' if s < 0 else 'shoulder_left', 9 * s - 2, H + 15, -2, 4, 4, 5, 'bone', part='shoulder', side=s)
    for i, y in enumerate((H + 9, H + 11.5, H + 13.5)):
        C(chest, f'vertebra_c{i}', -1, y, 3.5 if y < H + 11 else 4, 2, 1, 1, 'bone', part='vertebra')
    C(chest, 'rib_bar_0', -3, H + 9, -3.5, 6, 1, 1, 'bone', part='rib')
    C(chest, 'rib_bar_1', -4, H + 11.5, -4, 8, 1, 1, 'bone', part='rib')
    C(chest, 'rib_bar_2', -4, H + 13.5, -4, 8, 1, 1, 'bone', part='rib')
    # dorsal spines along the upper back
    C(chest, 'spine_spike_c0', -0.5, H + 16, 4.5, 1, 1, 2, 'bone', part='spike')
    C(chest, 'spine_spike_c1', -0.5, H + 18, 4.5, 1, 1, 1, 'bone', part='spike')

    # long arched neck: thick base rising off the shoulders, three segments
    nl = B('neck_lower', 'chest', (0, H + 18.5, 1.0), (0, 0, 0))
    C(nl, 'neck_lower', -2.5, H + 17.5, -1.5, 5, 8, 5, 'neck', part='neck')
    for i, (y, d) in enumerate(((H + 19, 2), (H + 21.5, 2), (H + 24, 1))):
        C(nl, f'neck_spike_l{i}', -0.5, y, 3.5, 1, 1, d, 'bone', part='spike')
    nm = B('neck_mid', 'neck_lower', (0, H + 25, 1.0), (22, 0, 0))
    C(nm, 'neck_mid', -2, H + 24.5, -1, 4, 8, 4, 'neck', part='neck')
    for i, (y, d) in enumerate(((H + 26.5, 1), (H + 29, 1))):
        C(nm, f'neck_spike_m{i}', -0.5, y, 3, 1, 1, d, 'bone', part='spike')
    nu = B('neck_upper', 'neck_mid', (0, H + 31.5, 1.0), (22, 0, 0))
    C(nu, 'neck_upper', -2, H + 31, -1, 4, 7, 4, 'neck', part='neck')

    # long pale face: 8x9x8 cranium + narrower 6x3x6 jaw; neck plugs into its back-top
    head = B('head', 'neck_upper', (0, H + 37.5, 1.0), (-74, 0, 0))
    C(head, 'cranium', -4, H + 30.5, -6, 8, 9, 8, 'face', part='cranium')
    jaw = B('jaw', 'head', (0, H + 30.5, 0))
    C(jaw, 'jaw', -3, H + 26.5, -6, 6, 4, 6, 'face', part='jaw')

    # black "tears": streaks under each eye that drip off the chin as strands
    dr = B('drip_right', 'jaw', (-2.5, H + 26.5, -5.5))
    C(dr, 'drip_right', -3, H + 22.5, -6, 1, 4, 1, 'drip', part='drip', seg=0)
    dre = B('drip_right_end', 'drip_right', (-2.5, H + 22.5, -5.5))
    C(dre, 'drip_right_end', -3, H + 18.5, -6, 1, 4, 1, 'drip', part='drip', seg=1)
    dl = B('drip_left', 'jaw', (2.5, H + 26.5, -5.5))
    C(dl, 'drip_left', 2, H + 22.5, -6, 1, 4, 1, 'drip', part='drip', seg=0)
    dle = B('drip_left_end', 'drip_left', (2.5, H + 22.5, -5.5))
    C(dle, 'drip_left_end', 2, H + 17.5, -6, 1, 5, 1, 'drip', part='drip', seg=1)
    dm = B('drip_mouth', 'jaw', (-0.5, H + 26.5, -5))
    C(dm, 'drip_mouth', -1, H + 23.5, -5.5, 1, 3, 1, 'drip', part='drip', seg=1)
    dcr = B('drip_cheek_right', 'head', (-3.5, H + 30.5, -3.5))
    C(dcr, 'drip_cheek_right', -4, H + 26.5, -4, 1, 4, 1, 'drip', part='drip', seg=1)
    dcl = B('drip_cheek_left', 'head', (3.5, H + 30.5, -2.5))
    C(dcl, 'drip_cheek_left', 3, H + 27.5, -3, 1, 3, 1, 'drip', part='drip', seg=1)

    # ---------------- arms (s = -1 right, +1 left) ----------------
    for side, s in (('right', -1), ('left', 1)):
        ax = 9 * s
        arm = B(f'{side}_arm', 'chest', (ax, H + 17.5, 0.5), (-33, 0, -6 * s))
        C(arm, f'{side}_upperarm', ax - 1.5, H + 1.5, -1, 3, 15, 3, 'limb', part='upperarm', side=s)

        fa = B(f'{side}_forearm', f'{side}_arm', (ax, H + 2, 0.5), (-22, 0, 0))
        C(fa, f'{side}_elbow', ax - 2, H + 0.5, -1.5, 4, 3, 4, 'bone', part='elbow', side=s)
        C(fa, f'{side}_forearm', ax - 1.5, H - 14.5, -1, 3, 16, 3, 'limb', part='forearm', side=s)

        hand = B(f'{side}_hand', f'{side}_forearm', (ax, H - 14, 0.5), (15, -30 * s, 0))
        C(hand, f'{side}_palm', ax - 2, H - 18, -0.5, 4, 4, 2, 'hand', part='palm', side=s)
        for i, (off, fan) in enumerate(((-1.65, 8), (-0.55, 3), (0.55, -3), (1.65, -8))):
            fx = ax + off
            f1 = B(f'{side}_finger{i + 1}', f'{side}_hand', (fx, H - 18, 0.5), (10, 0, fan))
            C(f1, f'{side}_finger{i + 1}', fx - 0.5, H - 22, 0, 1, 5, 1, 'hand', part='finger', side=s)
            f2 = B(f'{side}_finger{i + 1}_tip', f'{side}_finger{i + 1}', (fx, H - 22, 0.5), (14, 0, 0))
            C(f2, f'{side}_finger{i + 1}_tip', fx - 0.5, H - 26, 0, 1, 4, 1, 'hand', part='fingertip', side=s)
        m = -s
        tx = ax + 1.9 * m
        t1 = B(f'{side}_thumb', f'{side}_hand', (tx, H - 15.5, 1.0), (-8, 0, 26 * s))
        C(t1, f'{side}_thumb', tx - 0.5, H - 19, 0.5, 1, 4, 1, 'hand', part='finger', side=s)
        t2 = B(f'{side}_thumb_tip', f'{side}_thumb', (tx, H - 19, 1.0), (14, 0, 0))
        C(t2, f'{side}_thumb_tip', tx - 0.5, H - 22, 0.5, 1, 3, 1, 'hand', part='fingertip', side=s)

    # ---------------- legs ----------------
    for side, s in (('right', -1), ('left', 1)):
        lx = 4 * s
        leg = B(f'{side}_leg', 'body', (lx, H, 0), (-38, 0, -2 * s))
        C(leg, f'{side}_thigh', lx - 1.5, H - 14.5, -2, 3, 15, 4, 'limb', part='thigh', side=s)
        shin = B(f'{side}_shin', f'{side}_leg', (lx, H - 14, 0), (68, 0, 0))
        C(shin, f'{side}_knee', lx - 2, H - 15.5, -2.5, 4, 3, 5, 'bone', part='knee', side=s)
        C(shin, f'{side}_shin', lx - 1.5, H - 29, -1.5, 3, 15, 3, 'limb', part='shin', side=s)
        foot = B(f'{side}_foot', f'{side}_shin', (lx, H - 29, 0), (-30, 0, 0))
        C(foot, f'{side}_foot', lx - 1.5, H - 31, -4.5, 3, 2, 6, 'foot', part='foot', side=s)
        for i, (off, spl) in enumerate(((-1.1, 12), (0.0, 0), (1.1, -12))):
            tx = lx + off
            toe = B(f'{side}_toe{i + 1}', f'{side}_foot', (tx, H - 30.5, -4.5), (6, spl, 0))
            C(toe, f'{side}_toe{i + 1}', tx - 0.5, H - 31, -7.5, 1, 1, 3, 'foot', part='toe', side=s)

    return rig


if __name__ == '__main__':
    rig = build()
    W = world_matrices(rig)
    def at(bone, p):
        b = rig.by_name[bone]
        return xform(W[bone], p)
    for name, bone, p in [
        ('hip', 'body', (0, H, ZO)),
        ('shoulder R', 'right_arm', rig.by_name['right_arm'].pivot),
        ('elbow R', 'right_forearm', rig.by_name['right_forearm'].pivot),
        ('wrist R', 'right_hand', rig.by_name['right_hand'].pivot),
        ('fingertip R2', 'right_finger2_tip', (rig.by_name['right_finger2_tip'].pivot[0], H - 26, 0.5 + ZO)),
        ('knee R', 'right_shin', rig.by_name['right_shin'].pivot),
        ('ankle R', 'right_foot', rig.by_name['right_foot'].pivot),
        ('sole R', 'right_foot', (-4, H - 31, 0 + ZO)),
        ('head pivot', 'head', rig.by_name['head'].pivot),
        ('head top front', 'head', (0, H + 39.5, -6 + ZO)),
        ('jaw bottom front', 'jaw', (0, H + 26.5, -6 + ZO)),
        ('neck base', 'neck_lower', rig.by_name['neck_lower'].pivot),
    ]:
        w = at(bone, p)
        print(f'{name:18s} x={w[0]:6.2f} y={w[1]:6.2f} z={w[2]:6.2f}  (fwd={-w[2]:6.2f})')
    lo = np.array([1e9] * 3); hi = -lo
    for c in rig.all_cubes():
        m = W[c.bone.name]
        for cx in (c.lo[0], c.hi[0]):
            for cy in (c.lo[1], c.hi[1]):
                for cz in (c.lo[2], c.hi[2]):
                    w = xform(m, (cx, cy, cz)); lo = np.minimum(lo, w); hi = np.maximum(hi, w)
    print('bounds', lo.round(2), hi.round(2), 'cubes', sum(1 for _ in rig.all_cubes()), 'bones', len(rig.bones))
