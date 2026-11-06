"""Brinesleeper animations.

Every animation is a function of time that returns a pose (Bedrock animation
offsets that get ADDED to the rest rotations stored in the geometry). Limbs
that must touch something (feet on the ground, hands on the ground or on the
water surface) are solved with analytic two-bone IK and converted back into
Bedrock euler angles, so the exported keyframes play identically in
Blockbench and in-game.

The functions are sampled at 60 Hz and every channel is simplified with a
Douglas-Peucker pass into linear keyframes (error < 0.35 deg / 0.03 px).
"""
import json
import math
import sys
import numpy as np

from rig import build, rot3, H, ZO

RIG = build()
BONES = RIG.bones
BY = RIG.by_name
REST = {b.name: np.array(b.rotation, dtype=float) for b in BONES}
PIV = {b.name: np.array(b.pivot, dtype=float) for b in BONES}
TAU = 2 * math.pi

# ------------------------------------------------------------------ math helpers

def clamp(x, a, b):
    return a if x < a else b if x > b else x


def smooth(x):
    x = clamp(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def smoother(x):
    x = clamp(x, 0.0, 1.0)
    return x * x * x * (x * (6 * x - 15) + 10)


def ease_out(x):
    x = clamp(x, 0.0, 1.0)
    return 1 - (1 - x) ** 3


def ease_in(x):
    x = clamp(x, 0.0, 1.0)
    return x ** 3


def back_out(x, s=1.7):
    x = clamp(x, 0.0, 1.0) - 1
    return x * x * ((s + 1) * x + s) + 1


def bump(x, w):
    """smooth 0->1->0 bump over [0, w]"""
    if x <= 0 or x >= w:
        return 0.0
    return math.sin(math.pi * x / w) ** 2


def track(t, keys, ease=smooth):
    """piecewise interpolation of scalars or vectors. keys: [(time, value, [ease])]"""
    if t <= keys[0][0]:
        return np.array(keys[0][1], dtype=float)
    for i in range(len(keys) - 1):
        t0, v0 = keys[i][0], np.array(keys[i][1], dtype=float)
        t1, v1 = keys[i + 1][0], np.array(keys[i + 1][1], dtype=float)
        if t <= t1:
            e = keys[i + 1][2] if len(keys[i + 1]) > 2 else ease
            return v0 + (v1 - v0) * e((t - t0) / (t1 - t0))
    return np.array(keys[-1][1], dtype=float)


def nrm(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


# ------------------------------------------------------------------ kinematics

def fk(pose):
    """name -> (R, t): world map x -> R x + t for absolute bind-space points."""
    W = {}
    for b in BONES:
        p = PIV[b.name]
        a = pose.get(b.name, {})
        rot = REST[b.name] + np.asarray(a.get('rotation', (0, 0, 0)), dtype=float)
        pos = np.asarray(a.get('position', (0, 0, 0)), dtype=float)
        Rl = rot3(*rot)
        PR, Pt = W[b.parent] if b.parent else (np.eye(3), np.zeros(3))
        W[b.name] = (PR @ Rl, PR @ (p + pos - Rl @ p) + Pt)
    return W


def wp(W, bone, x=None):
    R, t = W[bone]
    return R @ (PIV[bone] if x is None else np.asarray(x, dtype=float)) + t


def euler_from(R):
    b = math.asin(clamp(-R[2, 0], -1.0, 1.0))
    a = math.atan2(R[2, 1], R[2, 2])
    c = math.atan2(R[1, 0], R[0, 0])
    return np.array([-math.degrees(a), math.degrees(b), -math.degrees(c)])


def wrap(a):
    return (a + 180.0) % 360.0 - 180.0


class Pose(dict):
    def rot(self, bone, x=0.0, y=0.0, z=0.0):
        e = self.setdefault(bone, {})
        e['rotation'] = np.asarray(e.get('rotation', (0, 0, 0)), dtype=float) + np.array([x, y, z], dtype=float)
        return self

    def pos(self, bone, x=0.0, y=0.0, z=0.0):
        e = self.setdefault(bone, {})
        e['position'] = np.asarray(e.get('position', (0, 0, 0)), dtype=float) + np.array([x, y, z], dtype=float)
        return self

    def set_rot(self, bone, v):
        self.setdefault(bone, {})['rotation'] = np.asarray(v, dtype=float)

    def set_world_rot(self, bone, Rw, W=None):
        W = W or fk(self)
        PR = W[BY[bone].parent][0]
        e = euler_from(PR.T @ Rw)
        self.set_rot(bone, [wrap(v) for v in (e - REST[bone])])


def two_bone(pose, upper, lower, end, target, pole, kind):
    """Analytic 2-bone IK. kind 'arm' bends toward local -z (elbow), 'leg' toward +z (knee)."""
    W = fk(pose)
    S = wp(W, upper)
    L1 = np.linalg.norm(PIV[lower] - PIV[upper])
    L2 = np.linalg.norm(PIV[end] - PIV[lower])
    d = np.asarray(target, dtype=float) - S
    D = clamp(np.linalg.norm(d), abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3)
    dn = nrm(d)
    a = (L1 * L1 - L2 * L2 + D * D) / (2 * D)
    h = math.sqrt(max(0.0, L1 * L1 - a * a))
    pole = np.asarray(pole, dtype=float)
    pp = nrm(pole - np.dot(pole, dn) * dn)
    E = S + a * dn + h * pp
    T = S + D * dn
    u = nrm(E - S)
    v = nrm(T - E)
    bend = -(pp - np.dot(pp, u) * u)
    bend = nrm(bend)
    ey = -u
    ez = -bend if kind == 'arm' else bend
    ex = np.cross(ey, ez)
    pose.set_world_rot(upper, np.column_stack([ex, ey, ez]), W)
    beta = math.degrees(math.acos(clamp(float(np.dot(u, v)), -1.0, 1.0)))
    pose.set_rot(lower, np.array([-beta if kind == 'arm' else beta, 0, 0]) - REST[lower])
    return E, T


def frame_from(fwd, up):
    """rotation whose local -y points along fwd (the limb direction) and local +z along 'up' x ... helper"""
    ey = -nrm(fwd)
    ez = nrm(np.cross(np.cross(ey, up), ey))
    ex = np.cross(ey, ez)
    return np.column_stack([ex, ey, ez])


def plant_hand(pose, side, finger_dir, palm_normal=(0, -1, 0)):
    """Orient the hand so its fingers point along finger_dir with the palm facing palm_normal."""
    ey = -nrm(np.asarray(finger_dir, dtype=float))
    ez = np.asarray(palm_normal, dtype=float)
    ez = nrm(ez - np.dot(ez, ey) * ey)
    ex = np.cross(ey, ez)
    pose.set_world_rot(f'{side}_hand', np.column_stack([ex, ey, ez]))


def flat_foot(pose, side, pitch=0.0, yaw=0.0):
    R = rot3(pitch, yaw, 0)
    pose.set_world_rot(f'{side}_foot', R)


def aim_head(p, pitch=0.0, yaw=0.0, roll=0.0, w=1.0):
    """Point the head in world space (pitch>0 looks down) and blend with whatever offset it already has."""
    W = fk(p)
    PR = W['neck_upper'][0]
    e = euler_from(PR.T @ rot3(pitch, yaw, roll))
    off = np.array([wrap(v) for v in (e - REST['head'])])
    cur = np.asarray(p.get('head', {}).get('rotation', (0, 0, 0)), dtype=float)
    p.set_rot('head', cur + (off - cur) * w)


SIDES = (('right', -1), ('left', 1))
FINGERS = [f'finger{i}' for i in range(1, 5)] + ['thumb']


def drips(p, t, amp=1.0, speed=1.0, kick=(0.0, 0.0)):
    for i, name in enumerate(('drip_right', 'drip_left', 'drip_mouth', 'drip_cheek_right', 'drip_cheek_left')):
        ph = i * 1.37
        p.rot(name, amp * 7 * math.sin(TAU * t * speed / 1.5 + ph) + kick[0], 0,
              amp * 5 * math.sin(TAU * t * speed / 2.0 + ph * 0.7) + kick[1])


def curl(p, side, amount, tip=None, spread=0.0, stagger=None, t=0.0):
    tip = amount * 1.15 if tip is None else tip
    for i, f in enumerate(FINGERS):
        k = 1.0 if stagger is None else stagger[i]
        sp = 0.0
        if f != 'thumb':
            sp = spread * (1.5 - i) * (-1 if side == 'left' else 1) * -1
        p.rot(f'{side}_{f}', amount * k, 0, sp)
        p.rot(f'{side}_{f}_tip', tip * k, 0, 0)


def breathe(p, t, period, amp=1.0):
    b = math.sin(TAU * t / period)
    p.rot('chest', -1.4 * amp * b)
    p.rot('waist', -0.6 * amp * b)
    p.rot('neck_lower', 0.9 * amp * b)
    p.rot('right_arm', 0, 0, 0.8 * amp * b)
    p.rot('left_arm', 0, 0, -0.8 * amp * b)
    return b


# rest-pose reference points
W0 = fk(Pose())
REST_ANKLE = {s: wp(W0, f'{s}_foot') for s, _ in SIDES}
REST_WRIST = {s: wp(W0, f'{s}_hand') for s, _ in SIDES}


# ================================================================== animations
ANIMS = {}
META = {}


LIMITS = {
    'forearm': (None, 2.0),       # elbows only flex (local X <= 0)
    'shin': (2.0, None),          # knees only flex (local X >= 0)
    'finger': (-14.0, 105.0), 'finger_tip': (-8.0, 112.0),
    'thumb': (-12.0, 80.0), 'thumb_tip': (-8.0, 95.0),
}


GROUND = ((0.0, 1.0, 0.0), 0.0)
CUBE_PTS = {}
for _c in RIG.all_cubes():
    _pts = np.array([[x, y, z] for x in (_c.lo[0], _c.hi[0]) for y in (_c.lo[1], _c.hi[1]) for z in (_c.lo[2], _c.hi[2])], dtype=float)
    CUBE_PTS[_c.bone.name] = np.vstack([CUBE_PTS[_c.bone.name], _pts]) if _c.bone.name in CUBE_PTS else _pts


def _child(PR, Pt, bone, rot):
    piv = PIV[bone]
    Rl = rot3(*rot)
    return PR @ Rl, PR @ (piv - Rl @ piv) + Pt


def _lowest(n, R, t, pts):
    return float(np.min((pts @ R.T + t) @ n))


def _settle_fingers(p, side, Rh, th, n, d, apply=True):
    """curl each finger only as far as the surface allows; returns the lowest point reached"""
    lowest = 1e9
    for f in FINGERS:
        b1, b2 = f'{side}_{f}', f'{side}_{f}_tip'
        r1 = REST[b1] + np.asarray(p.get(b1, {}).get('rotation', (0, 0, 0)), dtype=float)
        r2 = REST[b2] + np.asarray(p.get(b2, {}).get('rotation', (0, 0, 0)), dtype=float)
        k1, k2 = ('thumb', 'thumb_tip') if f == 'thumb' else ('finger', 'finger_tip')
        lo1, lo2 = LIMITS[k1][0], LIMITS[k2][0]
        best_ok, best_any = None, None
        for a1 in np.linspace(r1[0], min(r1[0], lo1), 8):
            R1, t1 = _child(Rh, th, b1, (a1, r1[1], r1[2]))
            m1 = _lowest(n, R1, t1, CUBE_PTS[b1])
            for a2 in np.linspace(r2[0], min(r2[0], lo2), 6):
                R2, t2 = _child(R1, t1, b2, (a2, r2[1], r2[2]))
                m = min(m1, _lowest(n, R2, t2, CUBE_PTS[b2]))
                cost = (r1[0] - a1) + 0.7 * (r2[0] - a2)
                if m >= d - 0.1 and (best_ok is None or cost < best_ok[0]):
                    best_ok = (cost, a1, a2, m)
                if best_any is None or m > best_any[3]:
                    best_any = (None, a1, a2, m)
        _, a1, a2, m = best_ok if best_ok is not None else best_any
        lowest = min(lowest, m)
        if apply:
            if a1 != r1[0]:
                p.set_rot(b1, [a1 - REST[b1][0], r1[1] - REST[b1][1], r1[2] - REST[b1][2]])
            if a2 != r2[0]:
                p.set_rot(b2, [a2 - REST[b2][0], r2[1] - REST[b2][1], r2[2] - REST[b2][2]])
    return lowest


def settle_hand(p, side, n, d):
    """Keep a hand out of a surface (points x with n.x >= d are free space): with the smallest wrist
    tilt that works, lift the palm clear and curl each finger only until its tip meets the surface."""
    n = np.asarray(n, dtype=float)
    W = fk(p)
    hb = f'{side}_hand'
    PRf, Ptf = W[f'{side}_forearm']
    base = REST[hb] + np.asarray(p.get(hb, {}).get('rotation', (0, 0, 0)), dtype=float)
    best = None
    for xo in [0.0] + [v for k in range(1, 11) for v in (4.0 * k, -4.0 * k)]:
        r = base.copy()
        r[0] = clamp(r[0] + xo, -70.0, 70.0)
        Rh, th = _child(PRf, Ptf, hb, r)
        mp = _lowest(n, Rh, th, CUBE_PTS[hb])
        if mp < d - 0.05 and best is not None:
            continue
        mf = _settle_fingers(p, side, Rh, th, n, d, apply=False)
        m = min(mp, mf)
        if best is None or m > best[0] + 1e-6:
            best = (m, r, Rh, th)
        if m >= d - 0.1:
            break
    _, r, Rh, th = best
    if not np.allclose(r, base):
        p.set_rot(hb, r - REST[hb])
    _settle_fingers(p, side, Rh, th, n, d)


def sanitize(p, floor=None):
    """Clamp every hinge to a range a real joint can reach (applied after all layers), then settle
    planted hands on whatever they are touching."""
    for side, s in SIDES:
        for bone, key in ([(f'{side}_forearm', 'forearm'), (f'{side}_shin', 'shin')] +
                          [(f'{side}_finger{i}', 'finger') for i in range(1, 5)] +
                          [(f'{side}_finger{i}_tip', 'finger_tip') for i in range(1, 5)] +
                          [(f'{side}_thumb', 'thumb'), (f'{side}_thumb_tip', 'thumb_tip')]):
            lo, hi = LIMITS[key]
            off = np.asarray(p.get(bone, {}).get('rotation', (0, 0, 0)), dtype=float)
            tot = REST[bone] + off
            x = tot[0]
            if lo is not None:
                x = max(lo, x)
            if hi is not None:
                x = min(hi, x)
            if x != tot[0]:
                off = off.copy()
                off[0] = x - REST[bone][0]
                p.set_rot(bone, off)
        hb = f'{side}_hand'
        off = np.asarray(p.get(hb, {}).get('rotation', (0, 0, 0)), dtype=float)
        tot = REST[hb] + off
        cx, cz = clamp(tot[0], -70.0, 70.0), clamp(tot[2], -30.0, 30.0)
        if cx != tot[0] or cz != tot[2]:
            p.set_rot(hb, [cx - REST[hb][0], off[1], cz - REST[hb][2]])
    contacts = getattr(p, 'contacts', {})
    for side, _ in SIDES:
        if side in contacts:
            settle_hand(p, side, *contacts[side])
        elif floor is not None:                     # free hands still never go through the floor
            settle_hand(p, side, (0.0, 1.0, 0.0), floor)
    return p


SCENE_FLOOR = {'shore': 0.0, 'ledge': 0.0, 'shallows': 0.0}


def anim(name, length, loop=True, **meta):
    def deco(fn):
        floor = SCENE_FLOOR.get(meta.get('scene'))
        wrapped = lambda t, _fn=fn: sanitize(_fn(t), floor)
        ANIMS[name] = (wrapped, length, loop)
        META[name] = dict(length=length, loop=loop, **meta)
        return fn
    return deco


# ------------------------------------------------------------------ shared building blocks
def drips(p, t, amp=1.0, speed=1.0, kick=(0.0, 0.0)):
    """liquid strands: two-segment strands lag behind their roots like heavy goo"""
    for i, name in enumerate(('drip_right', 'drip_left', 'drip_mouth', 'drip_cheek_right', 'drip_cheek_left')):
        ph = i * 1.37
        ax = amp * 7 * math.sin(TAU * t * speed / 1.5 + ph) + kick[0]
        az = amp * 5 * math.sin(TAU * t * speed / 2.0 + ph * 0.7) + kick[1]
        p.rot(name, ax, 0, az)
        if name in ('drip_right', 'drip_left'):
            p.rot(name + '_end', 0.8 * amp * 7 * math.sin(TAU * t * speed / 1.5 + ph - 1.1) + 0.6 * kick[0], 0,
                  0.8 * amp * 5 * math.sin(TAU * t * speed / 2.0 + ph * 0.7 - 1.1) + 0.6 * kick[1])


def gait(ph, start, swing, stride):
    """(dz, lift, swing-progress) for one limb. Bedrock +z is BACKWARD:
    swing carries the limb forward (+S/2 -> -S/2), stance slides it back under the body (-S/2 -> +S/2)."""
    k = (ph - start) % 1.0
    if k < swing:
        e = smoother(k / swing)
        return stride / 2 - stride * e, math.sin(math.pi * k / swing), k / swing
    k2 = (k - swing) / (1 - swing)
    return -stride / 2 + stride * k2, 0.0, None


def gait_speed(stride, swing, period):
    """root speed (px/s) that keeps planted limbs fixed on the ground"""
    return stride / ((1 - swing) * period)


WRIST_X = (-65.0, 65.0)     # total flexion / extension
WRIST_Z = (-26.0, 26.0)     # total side-to-side deviation
TWIST_Y = 45.0              # forearm rotation allowed around the rest twist


def orient_hand(p, side, target_dir, palm=(0.0, -1.0, 0.0), palm_w=0.45, twist=TWIST_Y):
    """Point the fingers along target_dir with the palm facing `palm`, using only anatomically
    possible wrist moves: flexion/extension, a little side deviation, and forearm twist."""
    W = fk(p)
    Rf = W[f'{side}_forearm'][0]
    rest = REST[f'{side}_hand']
    tgt = nrm(np.asarray(target_dir, dtype=float))
    pal = nrm(np.asarray(palm, dtype=float))

    def search(xs, ys, zs):
        X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
        a = -np.radians(X)
        b = np.radians(rest[1] + Y)
        c = -np.radians(Z)
        ca, sa, cb, sb, cc, sc = np.cos(a), np.sin(a), np.cos(b), np.sin(b), np.cos(c), np.sin(c)
        # finger axis (0,-1,0) and palm normal (0,0,1) through Rz(c) Ry(b) Rx(a)
        fx1, fy1, fz1 = -sa * sb, -ca, -sa * cb
        px1, py1, pz1 = ca * sb, -sa, ca * cb
        f = np.stack([fx1 * cc - fy1 * sc, fx1 * sc + fy1 * cc, fz1], -1) @ Rf.T
        pm = np.stack([px1 * cc - py1 * sc, px1 * sc + py1 * cc, pz1], -1) @ Rf.T
        score = f @ tgt + palm_w * (pm @ pal) - 0.0015 * np.abs(Y) - 0.004 * np.abs(Z)
        i = np.unravel_index(np.argmax(score), score.shape)
        return X[i], Y[i], Z[i]

    clip = lambda v, lo, hi: np.clip(v, lo, hi)
    x, y, z = search(np.arange(WRIST_X[0], WRIST_X[1] + 0.1, 5.0), np.arange(-twist, twist + 0.1, 7.5),
                     np.arange(WRIST_Z[0], WRIST_Z[1] + 0.1, 4.0))
    x, y, z = search(clip(np.arange(x - 4, x + 4.1, 1.0), *WRIST_X), clip(np.arange(y - 6, y + 6.1, 1.5), -twist, twist),
                     clip(np.arange(z - 3, z + 3.1, 1.0), *WRIST_Z))
    p.set_rot(f'{side}_hand', [x - rest[0], y, z - rest[2]])


def plant_arm(p, side, target, pole, down=0.35, curl_amt=22.0, lift=0.0, palm=(0.0, -1.0, 0.0), finger_dir=None, twist=TWIST_Y,
              surface='auto'):
    """IK the arm so the wrist reaches target, then lay the hand along the forearm's heading, palm on the surface.
    surface: (normal, offset) the hand rests on; 'auto' = the floor when the wrist target is near it; None = free."""
    if surface == 'auto':
        surface = GROUND if target[1] < 12.0 else None
    if surface is not None:
        if not hasattr(p, 'contacts'):
            p.contacts = {}
        p.contacts[side] = surface
        if twist == TWIST_Y:
            twist = 80.0        # a palm pressed flat on a surface uses the forearm's full pronation range
    target = np.asarray(target, dtype=float)
    for _ in range(3):
        E, T = two_bone(p, f'{side}_arm', f'{side}_forearm', f'{side}_hand', target, pole, 'arm')
        if finger_dir is None:
            fwd = T - E
            head = np.array([fwd[0], 0.0, fwd[2]])
            if np.linalg.norm(head) < 1e-3:
                head = np.array([0.0, 0.0, -1.0])
            finger_dir = nrm(head) + np.array([0.0, -down + 0.6 * lift, 0.0])
        orient_hand(p, side, finger_dir, palm=palm, palm_w=0.45 * (1 - 0.6 * lift), twist=twist)
        if surface is None:
            break
        n = np.asarray(surface[0], dtype=float)
        R, tr = fk(p)[f'{side}_hand']
        sink = surface[1] - _lowest(n, R, tr, CUBE_PTS[f'{side}_hand'])
        if sink <= 0.05:
            break
        target = target + n * (sink + 0.1)          # the palm would sink in: lift the wrist onto the surface
    curl(p, side, curl_amt + 18 * lift, curl_amt * 1.25 + 22 * lift)


def grip_edge(p, side, t, curl_base=72, tip=38, thumb=(0, 82), thumb_spread=-20, drum=8.0):
    """long fingers wrapped round a pillar's front edge, drumming one after another;
    the thumb lies alongside them and hooks its tip round the corner too"""
    s = -1 if side == 'right' else 1
    for i, f in enumerate(FINGERS):
        tap = drum * bump((t + 0.37 * i) % 3.0, 0.35)
        if f == 'thumb':
            p.set_rot(f'{side}_thumb', [thumb[0] - REST[f'{side}_thumb'][0], 0, thumb_spread * s])
            p.set_rot(f'{side}_thumb_tip', [thumb[1] - REST[f'{side}_thumb_tip'][0], 0, 0])
        else:
            p.set_rot(f'{side}_{f}', [curl_base - tap - REST[f'{side}_{f}'][0], 0, 0])
            p.set_rot(f'{side}_{f}_tip', [tip - REST[f'{side}_{f}_tip'][0], 0, 0])


def plant_leg(p, side, target, pole=None, pitch=0.0, s=None):
    s = -1 if side == 'right' else 1
    two_bone(p, f'{side}_leg', f'{side}_shin', f'{side}_foot', target, pole if pole is not None else (0.12 * s, 0.3, -1), 'leg')
    flat_foot(p, side, pitch)


def root_point(p, v):
    """model-frame point -> world, through whatever the root bone is doing (flips, turns, slides)"""
    W = fk(p)
    R, tr = W['root']
    return R @ np.asarray(v, dtype=float) + tr


def plant_feet(p, spread=0.0, back=0.0):
    for side, s in SIDES:
        a = REST_ANKLE[side]
        plant_leg(p, side, (a[0] + spread * s, a[1], a[2] + back))


def stand(p, k, lean=0.0):
    """Unfold the hunch toward the creature's full upright height (k: 0 rest -> 1 full stand)."""
    p.pos('body', 0, 4.2 * k, 1.0 * k)
    p.rot('pelvis', -9 * k + lean * 0.4)
    p.rot('waist', -6 * k + lean * 0.3)
    p.rot('chest', -8 * k + lean * 0.3)
    p.rot('neck_lower', -16 * k)
    p.rot('neck_mid', -12 * k)
    p.rot('neck_upper', -8 * k)
    for side, s in SIDES:
        p.rot(f'{side}_arm', 22 * k - lean * 0.9, 0, -3 * s * k)
        p.rot(f'{side}_forearm', 14 * k)


def crouch_base(p, depth=1.0, head_up=0.0):
    p.pos('body', 0, -11.0 * depth, 2.0 * depth)
    p.rot('pelvis', 30 * depth)
    p.rot('waist', 10 * depth)
    p.rot('chest', 8 * depth)
    p.rot('neck_lower', -8 * depth - 10 * head_up)
    p.rot('neck_mid', -14 * depth - 6 * head_up)
    p.rot('neck_upper', -6 * depth)


# ------------------------------------------------------------------ the twitch / crackle layer
GROUPS = {
    'head': [('head', 1.0), ('neck_upper', 0.4)],
    'neck': [('neck_mid', 1.0), ('neck_lower', 0.5)],
    'jaw': [('jaw', 1.0)],
    'spine': [('chest', 1.0), ('waist', 0.4)],
    'r_arm': [('right_arm', 1.0), ('right_forearm', 0.6)],
    'l_arm': [('left_arm', 1.0), ('left_forearm', 0.6)],
    'r_hand': [('right_hand', 1.0)],
    'l_hand': [('left_hand', 1.0)],
}
SCALE = {
    'head': (15, 20, 18), 'neck': (7, 8, 9), 'jaw': (12, 0, 0), 'spine': (4, 5, 3),
    'r_arm': (12, 6, 10), 'l_arm': (12, 6, 10), 'r_hand': (18, 0, 14), 'l_hand': (18, 0, 14),
}


class Spasms:
    """Deterministic, loop-safe jerks: snap-and-hold head cracks, flicks, finger spasms and tremor bursts."""

    def __init__(self, length, loop, seed, rate=1.0, groups=('head', 'neck', 'jaw', 'fingers', 'spine'),
                 amp=1.0, tremor=None, tremor_amp=1.6):
        rng = np.random.default_rng(seed)
        self.L, self.loop = length, loop
        n = max(1, int(round(length * rate)))
        self.events = []
        for i in range(n):
            t0 = (i + rng.uniform(0.15, 0.85)) * length / n
            g = groups[int(rng.integers(len(groups)))]
            if g == 'fingers':
                side = 'right' if rng.random() < 0.5 else 'left'
                self.events.append(dict(kind='curl', t0=t0, side=side, a=amp * rng.uniform(20, 42),
                                        hold=rng.uniform(0.05, 0.25)))
                continue
            kind = 'snap' if rng.random() < 0.55 else 'flick'
            sx, sy, sz = SCALE[g]
            v = rng.normal(0, 1, 3) * np.array([sx, sy, sz]) * amp * 0.75
            if g == 'jaw':
                v = np.array([abs(v[0]) + 4 * amp, 0, 0])
            self.events.append(dict(kind=kind, t0=t0, g=g, v=v, hold=rng.uniform(0.1, 0.45)))
        self.tremor = tremor or []
        self.tremor_amp = tremor_amp
        # keep the tremor periodic over a loop
        self.f1 = max(1, round(19.0 * length)) / length
        self.f2 = max(1, round(31.0 * length)) / length

    def _dt(self, t, t0):
        dt = t - t0
        if self.loop:
            dt = (dt + self.L / 2) % self.L - self.L / 2
        return dt

    @staticmethod
    def env(kind, dt, hold):
        if dt < 0:
            return 0.0
        if kind == 'flick':
            if dt < 0.04:
                return dt / 0.04
            return math.exp(-(dt - 0.04) / 0.07) if dt < 0.45 else 0.0
        # snap: crack into a new angle, hold it (shivering), crack back
        if dt < 0.035:
            return dt / 0.035
        if dt < 0.035 + hold:
            return 1.0 + 0.06 * math.sin(dt * 95)
        r = dt - 0.035 - hold
        return max(0.0, 1.0 - r / 0.07)

    def apply(self, p, t, skip=()):
        for e in self.events:
            dt = self._dt(t, e['t0'])
            if e['kind'] == 'curl':
                if 'fingers' in skip or (e['side'][0] + '_fingers') in skip:
                    continue
                for i, f in enumerate(FINGERS):
                    d = dt - 0.022 * i
                    k = self.env('snap', d, e['hold'])
                    if k:
                        p.rot(f"{e['side']}_{f}", e['a'] * k)
                        p.rot(f"{e['side']}_{f}_tip", e['a'] * 1.2 * k)
                continue
            if e['g'] in skip:
                continue
            k = self.env(e['kind'], dt, e['hold'])
            if k:
                for bone, w in GROUPS[e['g']]:
                    p.rot(bone, *(e['v'] * w * k))
        for (a, b) in self.tremor:
            if self.loop:
                inside = (t - a) % self.L < (b - a) % self.L
                d0 = (t - a) % self.L
                d1 = (b - t) % self.L
            else:
                inside = a <= t <= b
                d0, d1 = t - a, b - t
            if not inside:
                continue
            w = min(1.0, d0 / 0.12, d1 / 0.12) * self.tremor_amp
            s1 = math.sin(TAU * self.f1 * t)
            s2 = math.sin(TAU * self.f2 * t + 1.3)
            p.rot('head', w * (1.2 * s1 + 0.6 * s2), w * 0.8 * s2, w * (0.9 * s2 - 0.5 * s1))
            p.rot('neck_upper', w * 0.5 * s2, 0, w * 0.4 * s1)
            p.rot('jaw', abs(w * 1.4 * s1))
            for side, _ in SIDES:
                if 'fingers' in skip or (side[0] + '_fingers') in skip:
                    continue
                for i, f in enumerate(FINGERS):
                    p.rot(f'{side}_{f}', w * 2.2 * math.sin(TAU * self.f2 * t + i * 1.1))


def stutter(t, length, n, amp):
    """jerky time: the motion lurches and stalls n times per loop (monotonic for amp < 1)."""
    return t - (length / (TAU * n)) * amp * math.sin(TAU * n * t / length)


def hang_arms(p, t, k=1.0, period=3.0, sway=1.0, splay=0.0, sides=('right', 'left')):
    for side, s in SIDES:
        if side not in sides:
            continue
        ph = 0 if s < 0 else 1.7
        p.rot(f'{side}_arm', sway * 2.0 * math.sin(TAU * t / period + ph), 0, -s * (splay + sway * 1.2 * math.sin(TAU * t / period * 0.5 + ph)))
        p.rot(f'{side}_forearm', sway * -2.0 * math.sin(TAU * t / period + ph - 0.7))


W0 = fk(Pose())
REST_ANKLE = {s: wp(W0, f'{s}_foot') for s, _ in SIDES}
REST_WRIST = {s: wp(W0, f'{s}_hand') for s, _ in SIDES}
WATER_IDLE = 33.0


# =================================================================== original set (fixed)
@anim('watch', 6.0, scene='shore')
def a_watch(t, sp=Spasms(6.0, True, 11, rate=1.0, groups=('head', 'head', 'neck', 'fingers', 'jaw', 'r_arm'), tremor=[(2.35, 2.95)])):
    p = Pose()
    breathe(p, t, 3.0)
    p.pos('body', 0.35 * math.sin(TAU * t / 6.0), 0, 0)
    p.rot('pelvis', 0, 0, 0.8 * math.sin(TAU * t / 6.0))
    tilt = track(t, [(0, 0), (2.3, 17), (2.95, 18), (3.05, -6, ease_out), (3.5, -3), (6.0, 0)])
    nod = track(t, [(0, 0), (2.95, 1), (3.05, -9, ease_out), (3.55, 3), (4.3, 0), (6.0, 0)])
    peek = track(t, [(0, 0), (2.3, -5), (3.05, 3, ease_out), (4.5, -1), (6.0, 0)])
    p.rot('neck_upper', float(peek))
    p.rot('neck_mid', 0.5 * float(peek), 0, 0.25 * float(tilt))
    p.rot('head', float(nod) - 1.5 * float(peek), 0, float(tilt))
    for side, s in SIDES:
        p.rot(f'{side}_hand', 3 * math.sin(TAU * t / 3.0 + (0 if s < 0 else 1.5)))
    sp.apply(p, t)
    drips(p, t, 0.8)
    return p


@anim('idle_water', 4.0, scene='water', water_level=WATER_IDLE)
def a_idle_water(t, sp=Spasms(4.0, True, 12, rate=1.25, groups=('head', 'head', 'neck', 'jaw'), tremor=[(1.1, 1.6)])):
    p = Pose()
    bob = math.sin(TAU * t / 4.0)
    p.pos('body', 0, -7 + 0.7 * bob, 0)
    p.rot('pelvis', -12)
    p.rot('waist', -4)
    p.rot('chest', -2 + 1.2 * math.sin(TAU * t / 2.0))
    p.rot('neck_lower', 6 + 1.5 * bob)
    p.rot('neck_mid', 2)
    p.rot('neck_upper', -4 - 2 * bob)
    aim_head(p, 4 + 3 * math.sin(TAU * t / 4.0 + 1.0), 6 * math.sin(TAU * t / 4.0), 8 * math.sin(TAU * t / 4.0 + 0.6))
    for side, s in SIDES:
        ph = 0 if s < 0 else math.pi
        p.rot(f'{side}_leg', -10 + 14 * math.sin(TAU * t / 4.0 + ph))
        p.rot(f'{side}_shin', 10 + 12 * math.sin(TAU * t / 4.0 + ph - 0.9))
        p.rot(f'{side}_foot', 10 * math.sin(TAU * t / 4.0 + ph - 1.6))
    for side, s in SIDES:
        sweep = math.sin(TAU * t / 4.0 + (0 if s < 0 else 2.2))
        tgt = np.array([21.0 * s + 1.0 * sweep * s, WATER_IDLE + 1.0, (-12.0 if s < 0 else -5.0) + 1.5 * sweep])
        plant_arm(p, side, tgt, (0.9 * s, 2.6, 0.2), down=0.15, curl_amt=12)
        for i, f in enumerate(FINGERS):
            tap = bump((t + 0.11 * i + (0 if s < 0 else 0.5)) % 1.0, 0.35)
            p.rot(f'{side}_{f}', 16 * tap * (1 if s < 0 else 0.5))
            p.rot(f'{side}_{f}_tip', 10 * tap)
    sp.apply(p, t)
    drips(p, t, 0.6, 1.0)
    return p


WALK_T, WALK_STRIDE, WALK_DUTY = 2.4, 26.0, 0.62


@anim('walk', WALK_T, scene='shore', speed=WALK_STRIDE / (WALK_DUTY * WALK_T))
def a_walk(t, sp=Spasms(WALK_T, True, 13, rate=1.25, groups=('head', 'head', 'neck', 'fingers', 'jaw'))):
    p = Pose()
    ph = t / WALK_T
    w = TAU * ph
    tu = stutter(t, WALK_T, 2, 0.45)          # the upper body lurches
    wu = TAU * tu / WALK_T
    p.pos('body', 0.7 * math.sin(w), -1.1 + 0.9 * math.cos(2 * w - 0.6), 0)
    p.rot('pelvis', 4 + 1.5 * math.cos(2 * w), -5 * math.sin(w), 3 * math.sin(w))
    p.rot('waist', 0, 3 * math.sin(w), -1.5 * math.sin(w))
    p.rot('chest', 2 + 1.5 * math.cos(2 * wu - 0.4), 4 * math.sin(wu), -1.5 * math.sin(wu))
    p.rot('neck_lower', 2.5 * math.cos(2 * wu - 1.0), 0, 2.5 * math.sin(wu - 0.6))
    p.rot('neck_mid', 1.5 * math.cos(2 * wu - 1.5), 0, 1.5 * math.sin(wu - 1.0))
    p.rot('head', -4.5 * math.cos(2 * wu - 1.6) - 2, -3 * math.sin(wu - 1.2), -5.5 * math.sin(wu - 1.0))
    for side, s in SIDES:
        fph = (ph + (0.0 if s > 0 else 0.5)) % 1.0
        base = REST_ANKLE[side]
        if fph < WALK_DUTY:
            k = fph / WALK_DUTY
            z = base[2] - WALK_STRIDE / 2 + WALK_STRIDE * k
            y = base[1]
            pitch = 0
        else:
            k = (fph - WALK_DUTY) / (1 - WALK_DUTY)
            e = smooth(k)
            z = base[2] + WALK_STRIDE / 2 - WALK_STRIDE * e
            y = base[1] + 5.0 * math.sin(math.pi * k) ** 1.2
            pitch = 22 * math.sin(math.pi * k) - 8 * bump(k - 0.6, 0.4)
        plant_leg(p, side, (base[0] + 0.4 * s, y, z), (0.1 * s, 0.3, -1), pitch)
        aw = wu + (0 if s < 0 else math.pi)
        p.rot(f'{side}_arm', -15 * math.sin(aw), 0, 2 * s * math.cos(aw) - 4 * s)     # hands swing just outside the feet
        p.rot(f'{side}_forearm', -10 * math.sin(aw - 0.7) - 4)
        p.rot(f'{side}_hand', 9 * math.sin(aw - 1.4))
        curl(p, side, 14 + 6 * math.sin(aw - 2.0))
    sp.apply(p, t)
    drips(p, t, 1.0, 1.0, (6 * math.sin(2 * w - 1.8), 0))
    return p


STALK_T, STALK_STRIDE, STALK_SWING = 3.2, 13.0, 0.22
STALK_ORDER = {'right_hand': 0.00, 'left_foot': 0.25, 'left_hand': 0.50, 'right_foot': 0.75}


@anim('crouch_stalk', STALK_T, scene='shore', speed=gait_speed(STALK_STRIDE, STALK_SWING, STALK_T))
def a_stalk(t, sp=Spasms(STALK_T, True, 14, rate=1.6, groups=('head', 'head', 'neck', 'jaw', 'spine'), tremor=[(1.7, 2.1)])):
    p = Pose()
    ph = t / STALK_T
    w = TAU * ph
    crouch_base(p)
    p.pos('body', 0.8 * math.sin(w), 0.6 * math.sin(2 * w), 0)
    p.rot('pelvis', 0, 4 * math.sin(w), 2 * math.sin(w))
    p.rot('chest', 0, -5 * math.sin(w + 0.5), -2 * math.sin(w))
    sp.apply(p, t, skip=('head', 'jaw'))       # spine jerks before IK so the limbs stay planted
    for side, s in SIDES:
        dz, lift, _ = gait(ph, STALK_ORDER[f'{side}_foot'], STALK_SWING, STALK_STRIDE)
        base = REST_ANKLE[side] + np.array([0.8 * s, 0, 1.5])
        plant_leg(p, side, (base[0], 2.0 + 3.5 * lift, base[2] + dz), (0.5 * s, 0.35, -1), 15 * lift)
        dz, lift, _ = gait(ph, STALK_ORDER[f'{side}_hand'], STALK_SWING, STALK_STRIDE)
        plant_arm(p, side, (15.0 * s, 1.6 + 6.0 * lift, -13.0 + dz), (0.8 * s, 2.6, 0.35), lift=lift)
    aim_head(p, 14 + 2 * math.sin(2 * w), 5 * math.sin(w + 0.4), 7 * math.sin(w + 1.0))
    sp.apply(p, t, skip=('neck', 'spine', 'fingers', 'r_arm', 'l_arm'))
    drips(p, t, 0.9, 1.0)
    return p


RUN_T, RUN_STRIDE, RUN_SWING = 0.72, 26.0, 0.6


@anim('run', RUN_T, scene='shallows', speed=gait_speed(RUN_STRIDE, RUN_SWING, RUN_T))
def a_run(t, sp=Spasms(RUN_T, True, 15, rate=2.8, groups=('head', 'jaw'))):
    p = Pose()
    ph = t / RUN_T
    w = TAU * ph
    p.pos('body', 0, -12.5 + 2.2 * math.cos(2 * w + 0.7), 3.0)
    p.rot('pelvis', 44 + 7 * math.sin(w))
    p.rot('waist', 12 - 6 * math.sin(w - 0.4))
    p.rot('chest', 12 - 8 * math.sin(w - 0.8), 0, 0)
    p.rot('neck_lower', -14 - 6 * math.sin(w - 1.2))
    p.rot('neck_mid', -22 + 4 * math.sin(w - 1.6))
    p.rot('neck_upper', -12)
    phases = {'left_foot': 0.0, 'right_foot': 0.09, 'left_hand': 0.46, 'right_hand': 0.56}
    for side, s in SIDES:
        dz, lift, _ = gait(ph, phases[f'{side}_foot'], RUN_SWING, RUN_STRIDE)
        base = REST_ANKLE[side] + np.array([2.2 * s, 0, 3.5])
        plant_leg(p, side, (base[0], 2.0 + 6.0 * lift, base[2] + dz), (0.55 * s, 0.4, -1), 30 * lift - 8)
        dz, lift, _ = gait(ph, phases[f'{side}_hand'], RUN_SWING, RUN_STRIDE)
        plant_arm(p, side, (13.0 * s, 2.0 + 8.0 * lift, -21.0 + dz), (0.7 * s, 0.3, 1.0), lift=lift)
    aim_head(p, 2 + 6 * math.sin(w - 1.4), 0, 3 * math.sin(w))
    p.rot('jaw', 6 + 4 * math.sin(2 * w))
    sp.apply(p, t)
    drips(p, t, 0.6, 2.0, (30 + 8 * math.sin(2 * w), 0))
    return p


@anim('grasp', 2.2, loop=False, scene='water', water_level=WATER_IDLE)
def a_grasp(t, sp=Spasms(2.2, False, 16, rate=1.4, groups=('head', 'jaw', 'neck'), tremor=[(0.7, 1.6)], tremor_amp=2.2)):
    p = Pose()
    reach = float(track(t, [(0, 0), (0.45, 1, ease_out), (0.62, 1), (1.0, 0.35), (1.6, 0.0), (2.2, 0)]))
    grab = float(track(t, [(0, 0), (0.45, -0.4), (0.55, 1, ease_out), (1.7, 1), (2.2, 0)]))
    pull = float(track(t, [(0, 0), (0.6, 0), (1.15, 1, smooth), (1.65, 1), (2.2, 0)]))
    p.pos('body', 0, -7 - 9 * pull, -9 * reach + 6 * pull)
    p.rot('pelvis', -14 + 22 * reach - 4 * pull)
    p.rot('waist', -5 + 8 * reach)
    p.rot('chest', -4 + 6 * reach + 6 * pull)
    p.rot('neck_lower', -8 + 10 * reach)
    p.rot('neck_mid', -6 - 10 * reach + 6 * pull)
    p.rot('neck_upper', -2 - 8 * reach)
    p.rot('head', 37 - 26 * reach + 4 * pull, 0, 6 * pull)
    p.rot('jaw', 2 + 22 * reach * (1 - pull) + 8 * pull)
    for side, s in SIDES:
        p.rot(f'{side}_arm', -95 * reach + 22 * pull, 0, s * (-10 + 10 * reach - 12 * pull))
        p.rot(f'{side}_forearm', 30 * reach - 45 * pull, 0, 0)
        p.rot(f'{side}_hand', -25 * reach + 25 * pull, 0, 0)
        for i, f in enumerate(FINGERS):
            spread = (i - 1.5) * 8 * (1 if s < 0 else -1) * max(0.0, -grab) * 2.5 if f != 'thumb' else 0
            p.rot(f'{side}_{f}', -10 + 70 * max(0.0, grab), 0, spread)
            p.rot(f'{side}_{f}_tip', 80 * max(0.0, grab))
        ph = 0 if s < 0 else math.pi
        p.rot(f'{side}_leg', -10 + 10 * math.sin(TAU * t / 2.2 + ph) + 20 * pull)
        p.rot(f'{side}_shin', 10 + 25 * pull)
    sp.apply(p, t)
    drips(p, t, 0.8, 1.0, (20 * reach - 30 * pull, 0))
    return p


def lerp_pose(a, b, w):
    out = Pose()
    for name in set(a) | set(b):
        for ch in ('rotation', 'position'):
            if ch in a.get(name, {}) or ch in b.get(name, {}):
                va = np.asarray(a.get(name, {}).get(ch, (0, 0, 0)), dtype=float)
                vb = np.asarray(b.get(name, {}).get(ch, (0, 0, 0)), dtype=float)
                out.setdefault(name, {})[ch] = va + (vb - va) * w
    return out


# emerge: rises with arms flung wide, slams both hands down on the bank far out to the sides, hauls itself up
EMERGE_SP = Spasms(2.8, False, 17, rate=1.8, groups=('head', 'head', 'jaw', 'neck'), tremor=[(0.35, 1.0)], tremor_amp=2.0)


def emerge_rise(t):
    p = Pose()
    p.rot('pelvis', -16)
    p.rot('waist', -6)
    p.rot('chest', -6)
    p.rot('neck_lower', -14)
    p.rot('neck_mid', -10)
    p.rot('neck_upper', -6)
    aim_head(p, -14, 0, 9 * math.sin(TAU * t / 1.4))
    p.rot('jaw', 9)
    for side, s in SIDES:
        wob = math.sin(TAU * t / 1.1 + (0 if s < 0 else 1.3))
        # arms flung out to the sides, pushing down on the water, hands far apart
        p.rot(f'{side}_arm', -22 + 5 * wob, 0, -s * (70 + 5 * wob))
        p.rot(f'{side}_forearm', -24 + 6 * wob)
        p.rot(f'{side}_hand', 6)
        curl(p, side, 18 + 10 * wob, 26)
        p.rot(f'{side}_leg', -18)
        p.rot(f'{side}_shin', 24)
    return p


def emerge_grab(t, rise):
    p = Pose()
    p.pos('body', 0, rise, 0)
    p.rot('pelvis', 8)
    p.rot('waist', 4)
    p.rot('chest', 6)
    p.rot('neck_lower', -6)
    p.rot('neck_mid', -6)
    p.rot('neck_upper', -4)
    for side, s in SIDES:
        tgt = np.array([25.0 * s, 4.6, -12.0 + (1.5 if s > 0 else 0)])
        plant_arm(p, side, tgt, (1.0 * s, 1.2, 0.1), down=0.25, curl_amt=32, surface=((0.0, 1.0, 0.0), tgt[1] - 1.6))
        p.rot(f'{side}_leg', -12)
        p.rot(f'{side}_shin', 14)
    aim_head(p, 6, 0, -4)
    p.rot('jaw', 6)
    return p


@anim('emerge', 2.8, loop=False, scene='water', water_level=4.0)
def a_emerge(t):
    rise = float(track(t, [(0, -64), (1.0, -30, smooth), (1.5, -17, smooth), (2.2, -3, smooth), (2.8, 0, smooth)]))
    w_grab = float(track(t, [(0, 0), (1.05, 0), (1.45, 1, ease_out), (2.15, 1), (2.8, 0, smooth)]))
    w_rest = float(track(t, [(0, 0), (2.15, 0), (2.8, 1, smooth)]))
    up = emerge_rise(t)
    up.pos('body', 0, rise, 0)
    g = emerge_grab(t, rise)
    p = lerp_pose(up, g, w_grab) if w_grab < 1 else g
    if w_rest > 0:
        p = lerp_pose(p, Pose(), w_rest)
    p = Pose(p)
    if w_grab >= 0.98 and w_rest <= 0.02:
        p.contacts = dict(getattr(g, 'contacts', {}))
    EMERGE_SP.apply(p, t)
    drips(p, t, 1.2, 1.0, (-40 * (1 - w_grab) * (1 - w_rest), 0))
    return p


@anim('submerge', 2.6, loop=False, scene='water', water_level=4.0)
def a_submerge(t, sp=Spasms(2.6, False, 18, rate=1.6, groups=('head', 'head', 'jaw'))):
    p = Pose()
    sink = float(track(t, [(0, 0), (0.45, 2.5, smooth), (2.6, -66, smoother)]))
    k = clamp(t / 2.6, 0, 1)
    p.pos('body', 0, sink, 2 * k)
    upright = smooth(t / 0.9)
    p.rot('pelvis', -16 * upright)
    p.rot('waist', -6 * upright)
    p.rot('chest', -6 * upright)
    p.rot('neck_lower', -16 * upright)
    p.rot('neck_mid', -12 * upright)
    p.rot('neck_upper', -6 * upright)
    p.rot('head', 54 * upright, 0, -8 * upright + 4 * math.sin(TAU * t / 2.6))
    for side, s in SIDES:
        drift = smooth((t - 0.6) / 2.0)
        p.rot(f'{side}_arm', 6 * upright - 4 * drift, 0, s * (-16 * upright - 58 * drift))
        p.rot(f'{side}_forearm', -6 * upright - 12 * drift)
        p.rot(f'{side}_hand', -10 * drift)
        curl(p, side, 14 * drift, 20 * drift)
        p.rot(f'{side}_leg', -15 * drift)
        p.rot(f'{side}_shin', 20 * drift)
    sp.apply(p, t)
    drips(p, t, 0.7, 1.0, (-70 * smooth((t - 0.8) / 1.4), 0))
    return p


SWIM_T = 1.8


@anim('swim', SWIM_T, scene='underwater', speed=34.0)
def a_swim(t, sp=Spasms(SWIM_T, True, 19, rate=1.6, groups=('head', 'jaw', 'neck'))):
    p = Pose()
    ph = t / SWIM_T
    w = TAU * ph
    p.pos('body', 0, 14 + 1.5 * math.sin(w - 0.8), -10)
    p.rot('body', 60, 0, 2 * math.sin(w))
    p.rot('pelvis', 2 + 7 * math.sin(w - 1.6))
    p.rot('waist', -6 + 7 * math.sin(w - 0.8))
    p.rot('chest', -10 + 6 * math.sin(w))
    p.rot('neck_lower', -2 + 5 * math.sin(w + 0.6))
    p.rot('neck_mid', -10 + 3 * math.sin(w + 1.0))
    p.rot('neck_upper', -8)
    aim_head(p, 22 + 4 * math.sin(w + 1.2), 0, 4 * math.sin(w))
    p.rot('jaw', 6 + 4 * math.sin(w))
    # wrist path relative to the shoulder in the chest frame: (outward, along the spine, -front), in arm lengths
    glide, sweep, pull, tuck, shoot = (0.30, 0.90, -0.22), (0.74, 0.52, -0.30), (0.62, 0.02, -0.50), (0.30, 0.20, -0.58), (0.30, 0.62, -0.50)
    keys = [(0.0, glide), (0.28, (0.32, 0.90, -0.20)), (0.50, sweep), (0.66, pull), (0.80, tuck), (0.90, shoot), (1.0, glide)]
    path = track(ph, keys, smooth)
    palms = [(0.0, (0.0, 0.2, -1.0)), (0.30, (0.4, 0.0, -1.0)), (0.50, (0.6, -0.6, -0.4)), (0.66, (0.2, -1.0, -0.2)),
             (0.80, (-0.3, -0.2, -1.0)), (0.92, (0.0, 0.2, -1.0)), (1.0, (0.0, 0.2, -1.0))]
    palm_l = track(ph, palms, smooth)
    W = fk(p)
    Rc = W['chest'][0]
    for side, s in SIDES:
        S = wp(W, f'{side}_arm')
        o = np.array([path[0] * s, path[1], path[2]]) * 31.0
        pole = Rc @ np.array([0.9 * s, 0.25, 0.55])
        E, T = two_bone(p, f'{side}_arm', f'{side}_forearm', f'{side}_hand', S + Rc @ o, pole, 'arm')
        orient_hand(p, side, nrm(T - E) + Rc @ np.array([0.0, 0.0, -0.25]), palm=Rc @ np.array([palm_l[0] * s, palm_l[1], palm_l[2]]), palm_w=0.6)
        spread = bump(ph - 0.25, 0.5)
        curl(p, side, 6 + 6 * math.sin(w - 1.5), 8, spread=7 * spread)
    for side, s in SIDES:
        kick = math.sin(w - 2.2 + (0 if s < 0 else 0.6))
        p.rot(f'{side}_leg', 58 + 12 * kick, 0, -3 * s)
        p.rot(f'{side}_shin', -50 + 14 * math.sin(w - 2.8 + (0 if s < 0 else 0.6)))
        p.rot(f'{side}_foot', 40 + 12 * kick)
    sp.apply(p, t, skip=('r_arm', 'l_arm', 'r_hand', 'l_hand'))
    drips(p, t, 0.6, 1.0, (-55, 0))
    return p


# =================================================================== stalking & bipedal poses (from the poses sheet)
@anim('submerged_watch', 6.0, scene='water', water_level=WATER_IDLE, label='1. Submerged Watch')
def a_submerged_watch(t, sp=Spasms(6.0, True, 21, rate=0.9, groups=('head', 'head', 'jaw'), tremor=[(3.6, 4.3)])):
    """only the head above the surface, silently observing"""
    p = Pose()
    bob = math.sin(TAU * t / 3.0)
    p.pos('body', 0, -12.5 + 0.5 * bob, 2)
    p.rot('pelvis', -14)
    p.rot('waist', -6)
    p.rot('chest', -6)
    p.rot('neck_lower', -16)
    p.rot('neck_mid', -10)
    p.rot('neck_upper', -4)
    yaw = float(track(t, [(0, 0), (1.6, 10), (2.0, 10), (2.08, -6, ease_out), (4.6, -6), (6.0, 0)]))
    aim_head(p, 3 + 1.5 * bob, yaw, 4 * math.sin(TAU * t / 6.0))
    for side, s in SIDES:
        p.rot(f'{side}_arm', 6 * math.sin(TAU * t / 3.0 + (0 if s < 0 else 1.2)), 0, -s * (26 + 6 * math.sin(TAU * t / 6.0)))
        p.rot(f'{side}_forearm', -18)
        p.rot(f'{side}_leg', -12 + 8 * math.sin(TAU * t / 3.0 + (0 if s < 0 else math.pi)))
        p.rot(f'{side}_shin', 18)
    sp.apply(p, t)
    drips(p, t, 0.5, 0.7)
    return p


SHORE_T, SHORE_STRIDE, SHORE_SWING = 4.0, 16.0, 0.25
SHORE_ORDER = {'right_hand': 0.0, 'left_foot': 0.3, 'left_hand': 0.5, 'right_foot': 0.8}


@anim('shoreline_stalk', SHORE_T, scene='shore', speed=gait_speed(SHORE_STRIDE, SHORE_SWING, SHORE_T), label='2. Shoreline Stalk')
def a_shoreline_stalk(t, sp=Spasms(SHORE_T, True, 22, rate=1.5, groups=('head', 'head', 'jaw', 'neck'), tremor=[(2.4, 2.8)])):
    """slowly crawling out of the water, head carried high on the arched neck"""
    p = Pose()
    ph = t / SHORE_T
    w = TAU * ph
    crouch_base(p, 1.05, head_up=1.0)
    p.rot('neck_lower', -12)
    p.rot('neck_mid', 6)
    p.pos('body', 0.9 * math.sin(w), 0.5 * math.sin(2 * w), 0)
    p.rot('pelvis', 0, 3 * math.sin(w), 2 * math.sin(w))
    for side, s in SIDES:
        dz, lift, _ = gait(ph, SHORE_ORDER[f'{side}_foot'], SHORE_SWING, SHORE_STRIDE)
        base = REST_ANKLE[side] + np.array([1.0 * s, 0, 2.0])
        plant_leg(p, side, (base[0], 2.0 + 4.0 * lift, base[2] + dz), (0.6 * s, 0.4, -1), 14 * lift)
        dz, lift, _ = gait(ph, SHORE_ORDER[f'{side}_hand'], SHORE_SWING, SHORE_STRIDE)
        plant_arm(p, side, (17.0 * s, 1.6 + 7.0 * lift, -19.0 + dz), (0.9 * s, 2.0, 0.3), lift=lift, curl_amt=18)
    aim_head(p, 22 + 3 * math.sin(2 * w), 4 * math.sin(w + 0.4), 5 * math.sin(w + 1.0))
    sp.apply(p, t, skip=('fingers', 'spine'))
    drips(p, t, 1.0)
    return p


@anim('corner_watch', 6.0, scene='shore', label='3. Corner Watch', prop='pillar_left')
def a_corner_watch(t, sp=Spasms(6.0, True, 23, rate=1.1, groups=('head', 'head', 'jaw', 'neck'), tremor=[(2.0, 2.7)])):
    """peeking around a corner with one hand hooked on the edge"""
    p = Pose()
    lean = float(track(t, [(0, 0.85), (1.8, 1.0), (3.4, 1.0), (3.5, 0.8, ease_out), (6.0, 0.85)]))
    breathe(p, t, 3.0, 0.7)
    p.pos('body', 0, -2.5, 0)
    p.rot('pelvis', 4, -8 * lean, 6 * lean)
    p.rot('waist', 2, -6 * lean, 8 * lean)
    p.rot('chest', 0, -10 * lean, 12 * lean)
    p.rot('neck_lower', -4, -12 * lean, 16 * lean)
    p.rot('neck_mid', 6, -10 * lean, 14 * lean)
    p.rot('neck_upper', 4, 0, 8 * lean)
    tilt = float(track(t, [(0, 26), (2.0, 30), (2.7, 32), (2.78, 8, ease_out), (3.4, 10), (6.0, 26)]))
    aim_head(p, 6, -14 * lean, tilt * lean)
    plant_feet(p, spread=1.0)
    # the left hand lies flat on the pillar's side face, long fingers wrapped round its front edge,
    # elbow hanging relaxed below: the pillar's side face is x = 14, its front face z = -26 (CORNER_PILLAR)
    edge = np.array([15.8, 33.0 + 0.5 * math.sin(TAU * t / 3.0), -23.6])
    plant_arm(p, 'left', edge, (0.55, -1.0, 0.35), palm=(-1.0, 0.0, 0.0), finger_dir=(0.0, 0.0, -1.0), twist=85)
    grip_edge(p, 'left', t)
    hang_arms(p, t, splay=4, sides=('right',))
    sp.apply(p, t, skip=('l_fingers', 'l_arm', 'l_hand'))
    drips(p, t, 0.8, 1.0, (0, 10 * lean))
    return p


@anim('ceiling_lurk', 6.0, scene='shore', label='4. Ceiling Lurk', prop='ceiling', ceiling=64.0)
def a_ceiling_lurk(t, sp=Spasms(6.0, True, 24, rate=1.2, groups=('head', 'head', 'jaw', 'neck'), tremor=[(1.0, 1.6), (4.2, 4.6)])):
    """clinging upside-down beneath a low ceiling, its head hanging down unnaturally"""
    p = Pose()
    C = 64.0
    p.rot('root', 0, 0, 180)
    p.pos('root', 0, C, 0)
    crouch_base(p, 0.95)
    sway = math.sin(TAU * t / 6.0)
    p.pos('body', 0.8 * sway, 0.6 * math.sin(TAU * t / 3.0), 0)
    Rr = fk(p)['root'][0]
    for side, s in SIDES:
        a = REST_ANKLE[side]
        plant_leg(p, side, root_point(p, (a[0] + 2.5 * s, 2.0, a[2] + 2.5)), Rr @ np.array([0.7 * s, 0.4, -1]))
        plant_arm(p, side, root_point(p, (15.0 * s, 1.6, -11.0 + 1.0 * math.sin(TAU * t / 3.0 + s))), Rr @ np.array([0.9 * s, 2.4, 0.3]), curl_amt=26,
                  palm=Rr @ np.array([0.0, -1.0, 0.0]), surface=((0.0, -1.0, 0.0), -C))
        R2 = fk(p)[f'{side}_shin'][0]
        p.set_world_rot(f'{side}_foot', Rr @ np.eye(3))
    # the neck folds down toward the floor and the face stays upright, staring at you
    p.rot('neck_lower', -14)
    p.rot('neck_mid', -18)
    p.rot('neck_upper', -12)
    aim_head(p, 14 + 4 * math.sin(TAU * t / 3.0), 6 * sway, 22 + 8 * math.sin(TAU * t / 6.0 + 1.0))
    sp.apply(p, t, skip=('fingers', 'spine', 'r_arm', 'l_arm'))
    drips(p, t, 0.6, 0.8, (180, 0))
    return p


@anim('distant_observer', 6.0, scene='shore', label='5. Distant Observer')
def a_distant_observer(t, sp=Spasms(6.0, True, 25, rate=0.8, groups=('head', 'head', 'jaw'))):
    """crouched on all fours across the lake, watching from afar"""
    p = Pose()
    crouch_base(p, 0.85, head_up=0.6)
    b = math.sin(TAU * t / 3.0)
    p.pos('body', 0, 0.5 * b, 0)
    p.rot('chest', -1.2 * b)
    for side, s in SIDES:
        a = REST_ANKLE[side]
        plant_leg(p, side, (a[0] + 1.5 * s, 2.0, a[2] + 1.0), (0.5 * s, 0.35, -1))
        plant_arm(p, side, (13.0 * s, 1.6, -15.0), (0.8 * s, 2.4, 0.3), curl_amt=26)
    yaw = float(track(t, [(0, -8), (2.5, 8), (3.0, 8), (5.5, -8), (6.0, -8)]))
    aim_head(p, 6, yaw, 3 * b)
    sp.apply(p, t, skip=('fingers', 'spine', 'r_arm', 'l_arm', 'neck'))
    drips(p, t, 0.5)
    return p


@anim('veil_stalk', 5.0, scene='shore', label='6. Veil Stalk', prop='vines')
def a_veil_stalk(t, sp=Spasms(5.0, True, 26, rate=1.0, groups=('head', 'head', 'jaw'), tremor=[(3.3, 3.8)])):
    """hidden within hanging vines, swaying with them, peering through"""
    p = Pose()
    sw = math.sin(TAU * t / 5.0)
    crouch_base(p, 0.7, head_up=0.4)
    p.pos('body', 2.0 * sw, 0.4 * math.sin(TAU * t / 2.5), 0)
    p.rot('pelvis', -4, 4 * sw, 3 * sw)
    p.rot('chest', -4, 4 * sw, 2 * sw)
    for side, s in SIDES:
        a = REST_ANKLE[side]
        plant_leg(p, side, (a[0] + 1.0 * s, 2.0, a[2] + 0.5), (0.4 * s, 0.35, -1))
        plant_arm(p, side, (11.0 * s, 1.6, -11.0), (0.7 * s, 2.0, 0.3), curl_amt=28)
    aim_head(p, 10, -8 * sw, -6 * sw)
    sp.apply(p, t, skip=('fingers', 'spine', 'r_arm', 'l_arm', 'neck'))
    drips(p, t, 0.7)
    return p


@anim('reflection_lurk', 6.0, scene='shore_water', label='7. Reflection Lurk')
def a_reflection_lurk(t, sp=Spasms(6.0, True, 27, rate=1.0, groups=('head', 'jaw'), tremor=[(2.2, 3.0)])):
    """bent over the water, face inches from the surface, mirroring its reflection"""
    p = Pose()
    b = math.sin(TAU * t / 3.0)
    p.pos('body', 0, -9 + 0.4 * b, 2)
    p.rot('pelvis', 26)
    p.rot('waist', 10)
    p.rot('chest', 12 - 1.2 * b)
    p.rot('neck_lower', 12)
    p.rot('neck_mid', 18)
    p.rot('neck_upper', 10)
    plant_feet(p, spread=1.5, back=1.0)
    for side, s in SIDES:
        plant_arm(p, side, (14.0 * s, 1.0, -15.0), (0.9 * s, 2.2, 0.2), curl_amt=20)
    roll = float(track(t, [(0, 0), (1.5, 18), (2.2, 18), (2.3, -10, ease_out), (4.5, -14), (6.0, 0)]))
    aim_head(p, 78, 0, roll)
    sp.apply(p, t, skip=('fingers', 'r_arm', 'l_arm'))
    drips(p, t, 0.4, 0.6)
    return p


TUNNEL_T, TUNNEL_STRIDE, TUNNEL_SWING = 2.8, 14.0, 0.3
TUNNEL_ORDER = {'right_hand': 0.0, 'left_foot': 0.15, 'left_hand': 0.5, 'right_foot': 0.65}


@anim('tunnel_crawl', TUNNEL_T, scene='shore', speed=gait_speed(TUNNEL_STRIDE, TUNNEL_SWING, TUNNEL_T), label='8. Tunnel Crawl')
def a_tunnel_crawl(t, sp=Spasms(TUNNEL_T, True, 28, rate=1.8, groups=('head', 'head', 'jaw'))):
    """flattened, limbs splayed like a lizard, slithering through a tight passage"""
    p = Pose()
    ph = t / TUNNEL_T
    w = TAU * ph
    p.pos('body', 0, -16.0 + 0.6 * math.sin(2 * w), 3)
    p.rot('pelvis', 48, 6 * math.sin(w), 0)
    p.rot('waist', 14, -5 * math.sin(w - 0.6), 0)
    p.rot('chest', 14, -6 * math.sin(w - 1.2), 0)
    p.rot('neck_lower', -24)
    p.rot('neck_mid', -18)
    p.rot('neck_upper', -14)
    for side, s in SIDES:
        dz, lift, _ = gait(ph, TUNNEL_ORDER[f'{side}_foot'], TUNNEL_SWING, TUNNEL_STRIDE)
        base = REST_ANKLE[side] + np.array([15.0 * s, 0, 10.0])
        plant_leg(p, side, (base[0], 1.8 + 2.5 * lift, base[2] + dz), (1.6 * s, -0.2, -0.5), 10 * lift)
        dz, lift, _ = gait(ph, TUNNEL_ORDER[f'{side}_hand'], TUNNEL_SWING, TUNNEL_STRIDE)
        plant_arm(p, side, (25.0 * s, 1.6 + 3.0 * lift, -14.0 + dz), (1.6 * s, 0.0, 0.45), lift=lift, curl_amt=20)
    aim_head(p, 4, -6 * math.sin(w - 1.6), 4 * math.sin(w))
    sp.apply(p, t)
    drips(p, t, 0.8, 1.0, (35, 0))
    return p


@anim('patient_strike', 6.0, scene='shore_water', label='9. Patient Strike')
def a_patient_strike(t, sp=Spasms(6.0, True, 29, rate=1.4, groups=('head', 'jaw', 'fingers'), tremor=[(4.0, 4.6)])):
    """motionless, one hand outstretched on the water, waiting for movement"""
    p = Pose()
    b = math.sin(TAU * t / 4.0 * 2)
    crouch_base(p, 0.95, head_up=0.3)
    p.pos('body', 0, 0.3 * b, 0)
    p.rot('pelvis', 0, -6, 0)
    p.rot('chest', 0, -8, 0)
    for side, s in SIDES:
        a = REST_ANKLE[side]
        plant_leg(p, side, (a[0] + 1.5 * s, 2.0, a[2] + 1.5), (0.5 * s, 0.35, -1))
    plant_arm(p, 'right', (-7.0, 0.6, -31.0), (-0.8, 1.6, -0.2), down=0.05, curl_amt=8, surface=((0.0, 1.0, 0.0), -2.0))   # resting on the water
    plant_arm(p, 'left', (13.0, 1.6, -9.0), (0.8, 2.4, 0.3), curl_amt=26)
    for i, f in enumerate(FINGERS):
        tw = bump((t * 1.0 + 0.09 * i) % 3.0, 0.3)
        p.rot(f'right_{f}', 10 * tw)
    aim_head(p, 16, 6, 4 * math.sin(TAU * t / 6.0))
    sp.apply(p, t, skip=('r_fingers',))
    drips(p, t, 0.3, 0.5)
    return p


@anim('shadow_hide', 6.0, scene='shore', label='10. Shadow Hide')
def a_shadow_hide(t, sp=Spasms(6.0, True, 30, rate=0.5, groups=('head', 'fingers'))):
    """a thin, motionless silhouette melting into the dark"""
    p = Pose()
    stand(p, 0.85)
    sway = math.sin(TAU * t / 6.0)
    p.pos('body', 0.3 * sway, 0, 0)
    p.rot('pelvis', 0, 0, 0.6 * sway)
    plant_feet(p, spread=-0.5)
    for side, s in SIDES:
        p.rot(f'{side}_arm', 0, 0, s * 3.0)
    breathe(p, t, 3.0, 0.4)
    aim_head(p, 10, 0, 2 * sway)
    sp.apply(p, t)
    drips(p, t, 0.3, 0.5)
    return p


@anim('full_stand', 6.0, scene='shore', label='11. Full Stand')
def a_full_stand(t, sp=Spasms(6.0, True, 31, rate=1.4, groups=('head', 'head', 'neck', 'r_arm', 'l_arm', 'jaw', 'fingers', 'spine'),
                              tremor=[(4.4, 5.0)])):
    """its true height revealed: unfolded, upright and still"""
    p = Pose()
    stand(p, 1.0)
    plant_feet(p, spread=0.5)
    breathe(p, t, 3.0, 0.9)
    hang_arms(p, t, sway=0.8, splay=5)
    aim_head(p, 2, 0, 0)
    sp.apply(p, t)
    drips(p, t, 0.5, 0.6)
    return p


@anim('head_tilt', 5.0, scene='shore', label='12. Head Tilt')
def a_head_tilt(t, sp=Spasms(5.0, True, 32, rate=1.0, groups=('jaw', 'fingers', 'r_arm'), tremor=[(1.35, 2.05), (3.9, 4.4)], tremor_amp=1.9)):
    """slowly tilting its head as if studying you, then cracking it the other way"""
    p = Pose()
    stand(p, 0.75)
    plant_feet(p)
    breathe(p, t, 2.5, 0.6)
    hang_arms(p, t, sway=0.5, splay=7)
    tilt = float(track(t, [(0, -6), (1.3, 38, smoother), (2.05, 40), (2.12, -14, ease_out), (2.5, -12), (3.8, -30, smoother), (4.4, -31), (4.47, 4, ease_out), (5.0, -6)]))
    p.rot('neck_upper', 0, 0, 0.35 * tilt)
    p.rot('neck_mid', 0, 0, 0.2 * tilt)
    aim_head(p, 6, 4 * math.sin(TAU * t / 5.0), tilt)
    sp.apply(p, t)
    drips(p, t, 0.6, 0.8, (0, -0.4 * tilt))
    return p


APPROACH_T, APPROACH_STRIDE, APPROACH_DUTY = 3.2, 30.0, 0.66


@anim('slow_approach', APPROACH_T, scene='shore', speed=APPROACH_STRIDE / (APPROACH_DUTY * APPROACH_T), label='13. Slow Approach')
def a_slow_approach(t, sp=Spasms(APPROACH_T, True, 33, rate=1.6, groups=('head', 'head', 'jaw', 'fingers', 'r_arm'), tremor=[(0.6, 0.9)])):
    """upright, deliberate, wrong: high slow steps, head locked on you"""
    p = Pose()
    ph = t / APPROACH_T
    w = TAU * ph
    tu = stutter(t, APPROACH_T, 2, 0.55)
    wu = TAU * tu / APPROACH_T
    stand(p, 0.75)
    p.pos('body', 0.9 * math.sin(w), 1.0 * math.cos(2 * w - 0.4) - 1.0, 0)
    p.rot('pelvis', 0, -6 * math.sin(w), 4 * math.sin(w))
    p.rot('chest', 0, 5 * math.sin(wu), -3 * math.sin(wu))
    for side, s in SIDES:
        fph = (ph + (0.0 if s > 0 else 0.5)) % 1.0
        base = REST_ANKLE[side]
        if fph < APPROACH_DUTY:
            k = fph / APPROACH_DUTY
            z = base[2] - APPROACH_STRIDE / 2 + APPROACH_STRIDE * k
            y, pitch = base[1], 0
        else:
            k = (fph - APPROACH_DUTY) / (1 - APPROACH_DUTY)
            e = smoother(k)
            z = base[2] + APPROACH_STRIDE / 2 - APPROACH_STRIDE * e
            y = base[1] + 9.0 * math.sin(math.pi * k) ** 0.8
            pitch = 30 * math.sin(math.pi * k)
        plant_leg(p, side, (base[0] + 0.5 * s, y, z), (0.1 * s, 0.4, -1), pitch)
        aw = wu + (0 if s < 0 else math.pi)
        p.rot(f'{side}_arm', -7 * math.sin(aw), 0, -s * (4 + 1.5 * math.cos(aw)))
        p.rot(f'{side}_forearm', -6 * math.sin(aw - 0.8))
        curl(p, side, 12 + 8 * math.sin(aw - 1.6))
    aim_head(p, 6, 0, 3 * math.sin(wu))
    sp.apply(p, t)
    drips(p, t, 0.9, 1.0, (4 * math.sin(2 * w - 1.8), 0))
    return p


@anim('emerge_roar', 3.4, loop=False, scene='water_shallow', water_level=6.0, label='14. Emerge Roar')
def a_emerge_roar(t, sp=Spasms(3.4, False, 34, rate=1.2, groups=('head', 'fingers'), tremor=[(1.15, 2.45)], tremor_amp=2.6)):
    """rises to full height, head thrown back, maw stretched open in a silent threat"""
    p = Pose()
    coil = float(track(t, [(0, 0), (0.55, 1, smooth), (0.85, 0, ease_out), (3.4, 0)]))
    up = float(track(t, [(0, 0), (0.55, 0), (1.15, 1.15, back_out), (2.45, 1.1), (3.4, 0, smooth)]))
    maw = float(track(t, [(0, 0), (0.75, 0), (1.15, 1, ease_out), (2.45, 1), (2.8, 0, smooth), (3.4, 0)]))
    p.pos('body', 0, -6 * coil, 0)
    p.rot('pelvis', 10 * coil)
    p.rot('chest', 6 * coil)
    p.rot('neck_lower', 12 * coil)
    stand(p, min(1.0, up))
    p.rot('chest', -6 * up)
    p.rot('neck_lower', -10 * up)
    p.rot('neck_mid', -16 * up)
    p.rot('neck_upper', -10 * up)
    plant_feet(p, spread=1.5 * up)
    for side, s in SIDES:
        p.rot(f'{side}_arm', -12 * up, 0, -s * 34 * up)
        p.rot(f'{side}_forearm', -18 * up)
        p.rot(f'{side}_hand', -12 * up)
        curl(p, side, 10 * coil - 18 * up, -10 * up, spread=8 * up)
    aim_head(p, 12 * coil - 34 * up, 0, 0, w=max(coil, min(1.0, up)))
    p.rot('jaw', 46 * maw)
    sp.apply(p, t)
    drips(p, t, 1.0, 1.4, (-30 * up, 0))
    return p


@anim('water_rise', 3.2, loop=False, scene='water_shallow', water_level=8.0, label='15. Water Rise')
def a_water_rise(t, sp=Spasms(3.2, False, 35, rate=1.6, groups=('head', 'head', 'jaw', 'fingers', 'neck'))):
    """standing up out of the water, fully emerged, water pouring off it"""
    p = Pose()
    k = float(track(t, [(0, 0), (0.3, 0), (2.4, 1, smoother), (3.2, 1)]))
    low = 1 - k
    stand(p, k)
    p.pos('body', 0, -20 * low, 3 * low)
    p.rot('pelvis', 32 * low)
    p.rot('waist', 12 * low)
    p.rot('chest', 10 * low)
    p.rot('neck_lower', 6 * low)
    p.rot('neck_mid', -10 * low)
    for side, s in SIDES:
        a = REST_ANKLE[side]
        plant_leg(p, side, (a[0] + 4.5 * s * low + 1.0 * s, a[1], a[2] + 1.0 * low), (0.8 * s * low + 0.12 * s, 0.35, -1))
        p.rot(f'{side}_arm', -28 * low, 0, -s * (48 * low + 5))     # arms spread wide, balancing as it unfolds
        p.rot(f'{side}_forearm', -30 * low)
        curl(p, side, 14 + 10 * low)
    aim_head(p, 14 * low + 4, 0, 6 * math.sin(TAU * t / 3.2))
    sp.apply(p, t)
    drips(p, t, 1.1, 1.2, (-25 * (1 - k), 0))
    return p


@anim('hunting_stance', 3.0, scene='shore', label='16. Hunting Stance')
def a_hunting_stance(t, sp=Spasms(3.0, True, 36, rate=2.2, groups=('head', 'head', 'jaw', 'fingers', 'neck'), tremor=[(0.4, 0.8), (2.0, 2.3)])):
    """coiled forward lean, one claw raised, weight rocking before it breaks into a chase"""
    p = Pose()
    w = TAU * t / 3.0
    rock = math.sin(w)
    p.pos('body', 1.6 * rock, -6 + 0.8 * math.sin(2 * w), -2)
    p.rot('pelvis', 20, 6 * rock, 3 * rock)
    p.rot('waist', 8)
    p.rot('chest', 6, -6 * rock, -2 * rock)
    p.rot('neck_lower', -6)
    p.rot('neck_mid', -8)
    for side, s in SIDES:
        a = REST_ANKLE[side]
        plant_leg(p, side, (a[0] + 2.0 * s, a[1], a[2] + (4 if s < 0 else -3)))
    p.rot('right_arm', -62 + 6 * math.sin(2 * w), 0, 16)
    p.rot('right_forearm', -38 + 6 * math.sin(2 * w + 1.0))
    p.rot('right_hand', -20)
    curl(p, 'right', 26 + 10 * math.sin(2 * w + 0.5), 30, spread=6)
    p.rot('left_arm', 18, 0, -10)
    p.rot('left_forearm', -10)
    curl(p, 'left', 20)
    aim_head(p, 6, 6 * rock, 4 * rock)
    sp.apply(p, t, skip=('r_fingers',))
    drips(p, t, 0.9, 1.3)
    return p


@anim('behind_cover', 6.0, scene='shore', label='17. Behind Cover', prop='pillar_right')
def a_behind_cover(t, sp=Spasms(6.0, True, 37, rate=1.0, groups=('head', 'head', 'jaw'), tremor=[(3.0, 3.6)])):
    """standing tall behind a pillar, only one side of it showing"""
    p = Pose()
    lean = float(track(t, [(0, 0.8), (2.0, 1.0), (4.0, 1.0), (4.1, 0.75, ease_out), (6.0, 0.8)]))
    stand(p, 0.9)
    breathe(p, t, 3.0, 0.6)
    p.rot('pelvis', 0, 5 * lean, -5 * lean)
    p.rot('chest', 0, 8 * lean, -10 * lean)
    p.rot('neck_lower', 0, 8 * lean, -10 * lean)
    p.rot('neck_mid', 0, 6 * lean, -8 * lean)
    plant_feet(p)
    # right hand flat on the pillar's side face (x = -10), fingers hooked round its front edge (z = -23)
    edge = np.array([-11.8, 51.0 + 0.5 * math.sin(TAU * t / 3.0 + 1.0), -20.6])
    plant_arm(p, 'right', edge, (-0.55, -1.0, 0.35), palm=(1.0, 0.0, 0.0), finger_dir=(0.0, 0.0, -1.0), twist=85)
    grip_edge(p, 'right', t + 1.3)
    hang_arms(p, t, sway=0.6, splay=3, sides=('left',))
    aim_head(p, 6, 10 * lean, -18 * lean - 4 * math.sin(TAU * t / 6.0))
    sp.apply(p, t, skip=('r_fingers', 'r_arm', 'r_hand'))
    drips(p, t, 0.6, 0.8, (0, -8 * lean))
    return p


@anim('ledge_watch', 6.0, scene='ledge', label='18. Ledge Watch', prop='ledge')
def a_ledge_watch(t, sp=Spasms(6.0, True, 38, rate=1.0, groups=('head', 'head', 'jaw', 'neck'), tremor=[(1.6, 2.2)])):
    """hands spread on the edge of a ledge, leaning over to look down at you"""
    p = Pose()
    b = math.sin(TAU * t / 3.0)
    stand(p, 0.55)
    p.rot('pelvis', 10)
    p.rot('chest', 8 - b)
    p.rot('neck_lower', 6)
    p.rot('neck_mid', 12)
    p.rot('neck_upper', 8)
    plant_feet(p, spread=1.0, back=2.0)
    for side, s in SIDES:
        plant_arm(p, side, (13.0 * s, 33.5, -21.0 + (1.0 if s > 0 else 0)), (1.0 * s, 1.0, 0.4), down=0.15, curl_amt=40,
                  surface=((0.0, 1.0, 0.0), 32.0))
    yaw = float(track(t, [(0, 0), (2.4, 10), (2.5, -6, ease_out), (5.0, -6), (6.0, 0)]))
    aim_head(p, 38 + 2 * b, yaw, 6 * math.sin(TAU * t / 6.0))
    sp.apply(p, t, skip=('fingers', 'spine'))
    drips(p, t, 0.5, 0.7)
    return p


@anim('lunge', 1.6, loop=False, scene='shore', label='19. Lunge')
def a_lunge(t, sp=Spasms(1.6, False, 39, rate=2.0, groups=('head', 'jaw'), tremor=[(0.1, 0.42)], tremor_amp=2.0)):
    """a sudden long-reaching strike on two legs: one arm flung at your face, claws splayed"""
    p = Pose()
    ph = float(track(t, [(0, 0), (0.42, 1, smooth), (0.58, 2, ease_out), (0.8, 2.08, smooth), (1.6, 3, smooth)]))

    def blend(coil, strike):
        coil, strike = np.array(coil, dtype=float), np.array(strike, dtype=float)
        if ph <= 1:
            return coil * ph
        if ph <= 2:
            return coil + (strike - coil) * (ph - 1)
        if ph <= 2.08:
            return strike * (1 + 0.05 * (ph - 2) / 0.08)
        return strike * 1.05 * (3 - ph) / 0.92

    k_up = float(blend([0], [1])[0])
    stand(p, clamp(0.35 * k_up, 0, 1))
    p.pos('body', *blend([0, -5, 5], [0, 1, -17]))
    p.rot('pelvis', *blend([14, 8, 0], [20, -10, 0]))
    p.rot('waist', *blend([6, 0, 0], [6, -6, 0]))
    p.rot('chest', *blend([6, 10, 0], [2, -14, 0]))
    p.rot('neck_lower', *blend([16, 0, 0], [0, 0, 0]))
    p.rot('neck_mid', *blend([14, 0, 0], [-14, 0, 0]))
    p.rot('neck_upper', *blend([8, 0, 0], [-18, 0, 0]))
    p.rot('jaw', *blend([0, 0, 0], [32, 0, 0]))
    # right arm: pulled back and cocked, then flung straight at the camera with the hand splayed open
    p.rot('right_arm', *blend([38, -10, 14], [-112, 18, 6]))
    p.rot('right_forearm', *blend([-55, 0, 0], [6, 0, 0]))
    p.rot('right_hand', *blend([20, 0, 0], [-32, 0, 0]))
    p.rot('left_arm', *blend([24, 0, -20], [24, 0, -26]))       # off arm tucks back as it coils, claws clear of the ground
    p.rot('left_forearm', *blend([-46, 0, 0], [-30, 0, 0]))
    for i, f in enumerate(FINGERS):
        sp_z = (i - 1.5) * 11 if f != 'thumb' else 0
        c = blend([34, 0, 0], [-26, 0, sp_z])
        p.rot(f'right_{f}', c[0], 0, c[2])
        p.rot(f'right_{f}_tip', c[0] * 0.9)
        p.rot(f'left_{f}', *blend([20, 0, 0], [30, 0, 0]))
        p.rot(f'left_{f}_tip', *blend([22, 0, 0], [34, 0, 0]))
    for side, s in SIDES:
        a = REST_ANKLE[side]
        plant_leg(p, side, (a[0], a[1], a[2] + (3.0 if s > 0 else -7.0)), (0.15 * s, 0.3, -1))
    aim_head(p, float(blend([30], [-4])[0]), float(blend([0], [-8])[0]), float(blend([10], [-6])[0]), w=min(1.0, ph))
    sp.apply(p, t)
    drips(p, t, 0.5, 1.0, tuple(blend([-10, 0], [40, 0])))
    return p


@anim('retreat', 4.4, loop=False, scene='water_shallow', water_level=6.0, label='20. Retreat')
def a_retreat(t, sp=Spasms(4.4, False, 40, rate=1.2, groups=('head', 'jaw', 'fingers'))):
    """turns its back and slowly wades away, sinking out of sight"""
    p = Pose()
    turn = float(track(t, [(0, 0), (0.9, 180, smoother), (4.4, 180)]))
    walk = clamp((t - 0.8) / 3.6, 0, 1)
    p.rot('root', 0, turn, 0)
    p.pos('root', 0, -58 * smooth((t - 1.3) / 3.1), 58 * walk)
    stand(p, 0.6)
    ph = ((t - 0.8) / 1.6) % 1.0 if t > 0.8 else 0.0
    Rr = fk(p)['root'][0]
    for side, s in SIDES:
        base = REST_ANKLE[side]
        if t <= 0.8:
            plant_leg(p, side, root_point(p, base), Rr @ np.array([0.1 * s, 0.3, -1]))
            p.set_world_rot(f'{side}_foot', Rr)
            continue
        fph = (ph + (0.0 if s > 0 else 0.5)) % 1.0
        if fph < 0.62:
            k = fph / 0.62
            z = base[2] - 8 + 16 * k
            y = base[1]
        else:
            k = (fph - 0.62) / 0.38
            z = base[2] + 8 - 16 * smoother(k)
            y = base[1] + 4 * math.sin(math.pi * k)
        plant_leg(p, side, root_point(p, (base[0] + 0.5 * s, y, z)), Rr @ np.array([0.1 * s, 0.3, -1]))
        p.set_world_rot(f'{side}_foot', Rr)
        aw = TAU * ph + (0 if s < 0 else math.pi)
        p.rot(f'{side}_arm', -8 * math.sin(aw), 0, -s * 5)
        curl(p, side, 14)
    aim_head(p, 10, 0, 0)
    sp.apply(p, t)
    drips(p, t, 0.7)
    return p


# ================================================================== sampling / export
FPS = 60
TOL_ROT, TOL_POS = 0.35, 0.03


def rdp(times, vals, tol):
    """indices to keep so linear interpolation stays within tol (max-abs over components)."""
    keep = {0, len(times) - 1}
    stack = [(0, len(times) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ta, tb = times[a], times[b]
        va, vb = vals[a], vals[b]
        worst, wi = -1.0, -1
        for i in range(a + 1, b):
            f = (times[i] - ta) / (tb - ta)
            err = float(np.max(np.abs(vals[i] - (va + (vb - va) * f))))
            if err > worst:
                worst, wi = err, i
        if worst > tol:
            keep.add(wi)
            stack.append((a, wi))
            stack.append((wi, b))
    return sorted(keep)


def unwrap_series(vals):
    out = [vals[0].copy()]
    for v in vals[1:]:
        prev = out[-1]
        out.append(prev + np.array([wrap(c) for c in (v - prev)]))
    return out


def fmt(v):
    v = round(float(v), 3)
    if v == 0:
        v = 0.0
    return int(v) if v == int(v) else v


def sample(name):
    fn, length, loop = ANIMS[name]
    n = int(round(length * FPS))
    times = [i / FPS for i in range(n + 1)]
    frames = [fn(min(tt, length)) for tt in times]
    if loop:
        frames[-1] = frames[0]
    bones = {}
    for b in BONES:
        chans = {}
        for ch, tol in (('rotation', TOL_ROT), ('position', TOL_POS)):
            series = [np.asarray(f.get(b.name, {}).get(ch, (0, 0, 0)), dtype=float) for f in frames]
            if ch == 'rotation':
                series = unwrap_series(series)
            arr = np.array(series)
            if np.max(np.abs(arr)) < tol and (ch == 'position' or np.max(np.abs(arr)) < 0.05):
                continue
            if np.max(np.abs(arr - arr[0])) < tol:
                chans[ch] = [fmt(c) for c in arr[0]]
                continue
            keep = rdp(times, series, tol)
            chans[ch] = {f'{times[i]:.4f}'.rstrip('0').rstrip('.') if times[i] else '0.0': [fmt(c) for c in series[i]] for i in keep}
        if chans:
            bones[b.name] = chans
    entry = {'loop': True} if loop else {}
    entry['animation_length'] = length
    entry['bones'] = bones
    return entry


def export(path, meta_path=None, names=None):
    out = {'format_version': '1.8.0', 'animations': {}}
    for name in (names or ANIMS):
        out['animations'][f'animation.brinesleeper.{name}'] = sample(name)
    # head tracking for in-game use (pure Molang, layered on top of the others)
    out['animations']['animation.brinesleeper.look_at_target'] = {
        'loop': True,
        'bones': {
            'neck_upper': {'rotation': ['query.target_x_rotation * 0.35', 'query.target_y_rotation * 0.35', 0]},
            'head': {'rotation': ['query.target_x_rotation * 0.4', 'query.target_y_rotation * 0.65', 0]},
        },
    }
    with open(path, 'w') as f:
        json.dump(out, f, indent='\t')
    if meta_path:
        with open(meta_path, 'w') as f:
            json.dump(META, f, indent=2)
    kf = sum(len(c) if isinstance(c, dict) else 1 for a in out['animations'].values() for b in a['bones'].values() for c in b.values())
    return kf


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else 'out/brinesleeper.animation.json'
    names = sys.argv[3:] or None
    kf = export(path, sys.argv[2] if len(sys.argv) > 2 else 'out/preview_meta.json', names)
    print('keyframes', kf)
