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


def anim(name, length, loop=True, **meta):
    def deco(fn):
        ANIMS[name] = (fn, length, loop)
        META[name] = dict(length=length, loop=loop, **meta)
        return fn
    return deco


# ------------------------------------------------------------------ watching (shoreline)
@anim('watch', 6.0, scene='shore')
def a_watch(t):
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
    p.rot('jaw', 1.5 + 1.5 * math.sin(TAU * t / 3.0))
    for side, s in SIDES:
        t0 = 1.1 if side == 'right' else 4.1
        for i, f in enumerate(FINGERS):
            k = bump(t - t0 - 0.09 * i, 0.75)
            p.rot(f'{side}_{f}', 22 * k)
            p.rot(f'{side}_{f}_tip', 30 * k)
        p.rot(f'{side}_hand', 3 * math.sin(TAU * t / 3.0 + (0 if s < 0 else 1.5)))
    drips(p, t, 0.8)
    return p


# ------------------------------------------------------------------ idle in water
WATER_IDLE = 33.0


@anim('idle_water', 4.0, scene='water', water_level=WATER_IDLE)
def a_idle_water(t):
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
    p.rot('jaw', 2)
    # legs tread slowly below the surface
    for side, s in SIDES:
        ph = 0 if s < 0 else math.pi
        p.rot(f'{side}_leg', -10 + 14 * math.sin(TAU * t / 4.0 + ph))
        p.rot(f'{side}_shin', 10 + 12 * math.sin(TAU * t / 4.0 + ph - 0.9))
        p.rot(f'{side}_foot', 10 * math.sin(TAU * t / 4.0 + ph - 1.6))
    # arms splayed out on the surface like a spider, elbows up
    W = fk(p)
    for side, s in SIDES:
        sweep = math.sin(TAU * t / 4.0 + (0 if s < 0 else 2.2))
        if s < 0:
            tgt = np.array([-20.0 + 1.2 * sweep, WATER_IDLE + 1.0, -12.0 + 1.6 * sweep])
        else:
            tgt = np.array([19.0 - 1.0 * sweep, WATER_IDLE + 1.0, -5.0 + 1.4 * sweep])
        two_bone(p, f'{side}_arm', f'{side}_forearm', f'{side}_hand', tgt, (0.9 * s, 2.6, 0.2), 'arm')
        plant_hand(p, side, (0.35 * s, -0.12, -1.0), (0, -1, 0))
        for i, f in enumerate(FINGERS):
            tap = bump((t * 1.0 + 0.11 * i + (0 if s < 0 else 0.5)) % 1.0, 0.35)
            p.rot(f'{side}_{f}', 10 + 18 * tap * (1 if s < 0 else 0.5))
            p.rot(f'{side}_{f}_tip', 14 + 10 * tap)
    drips(p, t, 0.6, 1.0)
    return p


# ------------------------------------------------------------------ hunched walk
WALK_T, WALK_STRIDE = 2.4, 26.0


@anim('walk', WALK_T, scene='shore', speed=WALK_STRIDE / WALK_T)
def a_walk(t):
    p = Pose()
    ph = t / WALK_T
    w = TAU * ph
    p.pos('body', 0.7 * math.sin(w), -1.1 + 0.9 * math.cos(2 * w - 0.6), 0)
    p.rot('pelvis', 4 + 1.5 * math.cos(2 * w), -5 * math.sin(w), 3 * math.sin(w))
    p.rot('waist', 0, 3 * math.sin(w), -1.5 * math.sin(w))
    p.rot('chest', 2 + 1.5 * math.cos(2 * w - 0.4), 4 * math.sin(w), -1.5 * math.sin(w))
    # long neck lags and stabilises the head
    p.rot('neck_lower', 2.5 * math.cos(2 * w - 1.0), 0, 2.5 * math.sin(w - 0.6))
    p.rot('neck_mid', 1.5 * math.cos(2 * w - 1.5), 0, 1.5 * math.sin(w - 1.0))
    p.rot('head', -4.5 * math.cos(2 * w - 1.6) - 2, -3 * math.sin(w - 1.2), -5.5 * math.sin(w - 1.0))
    p.rot('jaw', 2)
    duty = 0.62
    for side, s in SIDES:
        fph = (ph + (0.0 if s > 0 else 0.5)) % 1.0
        base = REST_ANKLE[side]
        if fph < duty:
            k = fph / duty
            z = base[2] - WALK_STRIDE / 2 + WALK_STRIDE * k
            y = base[1]
            pitch = 0
        else:
            k = (fph - duty) / (1 - duty)
            e = smooth(k)
            z = base[2] + WALK_STRIDE / 2 - WALK_STRIDE * e
            y = base[1] + 5.0 * math.sin(math.pi * k) ** 1.2
            pitch = 22 * math.sin(math.pi * k) - 8 * bump(k - 0.6, 0.4)
        two_bone(p, f'{side}_leg', f'{side}_shin', f'{side}_foot', (base[0] + 0.4 * s, y, z), (0.1 * s, 0.3, -1), 'leg')
        flat_foot(p, side, pitch)
        # arms swing opposite their leg, forearm and hand trail behind
        aw = w + (0 if s < 0 else math.pi)
        p.rot(f'{side}_arm', -15 * math.sin(aw), 0, 2 * s * math.cos(aw))
        p.rot(f'{side}_forearm', -10 * math.sin(aw - 0.7) - 4)
        p.rot(f'{side}_hand', 9 * math.sin(aw - 1.4))
        curl(p, side, 14 + 6 * math.sin(aw - 2.0))
    drips(p, t, 1.0, 1.0, (6 * math.sin(2 * w - 1.8), 0))
    return p


# ------------------------------------------------------------------ crouch / stalk (low quadruped creep)
STALK_T, STALK_STRIDE = 3.2, 13.0
STALK_LIMBS = {  # phase offsets of each limb's swing (lateral sequence)
    'right_hand': 0.00, 'left_foot': 0.25, 'left_hand': 0.50, 'right_foot': 0.75,
}


def crouch_base(p, t, depth=1.0):
    p.pos('body', 0, -11.0 * depth, 2.0 * depth)
    p.rot('pelvis', 30 * depth)
    p.rot('waist', 10 * depth)
    p.rot('chest', 8 * depth)
    p.rot('neck_lower', -8 * depth)
    p.rot('neck_mid', -14 * depth)
    p.rot('neck_upper', -6 * depth)


def gait_offset(ph, start, swing, stride):
    """foot/hand z offset (relative) & lift for a limb whose swing starts at 'start' and lasts 'swing' (cycle fraction)."""
    k = (ph - start) % 1.0
    if k < swing:
        e = smoother(k / swing)
        return stride / 2 - stride * e, math.sin(math.pi * k / swing), k / swing
    k2 = (k - swing) / (1 - swing)
    return -stride / 2 + stride * k2, 0.0, None


@anim('crouch_stalk', STALK_T, scene='shore', speed=STALK_STRIDE / STALK_T)
def a_stalk(t):
    p = Pose()
    ph = t / STALK_T
    w = TAU * ph
    crouch_base(p, t)
    p.pos('body', 0.8 * math.sin(w), 0.6 * math.sin(2 * w), 0)
    p.rot('pelvis', 0, 4 * math.sin(w), 2 * math.sin(w))
    p.rot('chest', 0, -5 * math.sin(w + 0.5), -2 * math.sin(w))
    aim_head(p, 14 + 2 * math.sin(2 * w), 5 * math.sin(w + 0.4), 7 * math.sin(w + 1.0))
    for side, s in SIDES:
        # feet
        dz, lift, _ = gait_offset(ph, STALK_LIMBS[f'{side}_foot'], 0.2, STALK_STRIDE)
        base = REST_ANKLE[side] + np.array([0.8 * s, 0, 1.5])
        two_bone(p, f'{side}_leg', f'{side}_shin', f'{side}_foot', (base[0], 2.0 + 3.5 * lift, base[2] - dz),
                 (0.5 * s, 0.35, -1), 'leg')
        flat_foot(p, side, 15 * lift)
        # hands planted far forward and wide, elbows hiked up like a spider
        dz, lift, _ = gait_offset(ph, STALK_LIMBS[f'{side}_hand'], 0.2, STALK_STRIDE)
        tgt = np.array([15.0 * s, 1.6 + 6.0 * lift, -13.0 - dz])
        two_bone(p, f'{side}_arm', f'{side}_forearm', f'{side}_hand', tgt, (0.8 * s, 2.6, 0.35), 'arm')
        plant_hand(p, side, (0.25 * s, -0.25 * lift, -1.0), (0, -1, 0.4 * lift))
        curl(p, side, 18 + 25 * lift, 26 + 30 * lift)
    drips(p, t, 0.9, 1.0)
    return p


# ------------------------------------------------------------------ run (hunt state): fast scramble on all fours
RUN_T, RUN_STRIDE = 0.72, 62.0


@anim('run', RUN_T, scene='shallows', speed=RUN_STRIDE / RUN_T)
def a_run(t):
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
    aim_head(p, 2 + 6 * math.sin(w - 1.4), 0, 3 * math.sin(w))
    p.rot('jaw', 6 + 4 * math.sin(2 * w))
    # transverse gallop: hind pair then fore pair
    phases = {'left_foot': 0.0, 'right_foot': 0.09, 'left_hand': 0.46, 'right_hand': 0.56}
    for side, s in SIDES:
        dz, lift, _ = gait_offset(ph, phases[f'{side}_foot'], 0.62, RUN_STRIDE * 0.42)
        base = REST_ANKLE[side] + np.array([0.6 * s, 0, 5.5])
        two_bone(p, f'{side}_leg', f'{side}_shin', f'{side}_foot', (base[0], 2.0 + 9.0 * lift, base[2] - dz - 4),
                 (0.3 * s, 0.5, -1), 'leg')
        flat_foot(p, side, 35 * lift - 10)
        dz, lift, _ = gait_offset(ph, phases[f'{side}_hand'], 0.6, RUN_STRIDE * 0.42)
        tgt = np.array([12.5 * s, 2.0 + 10.0 * lift, -19.0 - dz])
        two_bone(p, f'{side}_arm', f'{side}_forearm', f'{side}_hand', tgt, (0.9 * s, 1.6, 0.7), 'arm')
        plant_hand(p, side, (0.2 * s, -0.4 * lift, -1.0), (0, -1, 0.8 * lift))
        curl(p, side, 14 + 30 * lift, 20 + 30 * lift)
    drips(p, t, 0.6, 2.0, (30 + 8 * math.sin(2 * w), 0))
    return p


# ------------------------------------------------------------------ lunge attack (one shot)
@anim('lunge', 1.3, loop=False, scene='shore')
def a_lunge(t):
    p = Pose()
    K = [(0, 0), (0.38, 1, smooth), (0.52, 2, ease_out), (0.7, 2.15, smooth), (1.3, 3, smooth)]
    # phase value: 0 rest, 1 coil, 2 strike, 3 recovered
    ph = float(track(t, K))

    def blend(coil, strike):
        coil, strike = np.array(coil, dtype=float), np.array(strike, dtype=float)
        if ph <= 1:
            return coil * ph
        if ph <= 2:
            return coil + (strike - coil) * (ph - 1)
        if ph <= 2.15:
            return strike * (1 + 0.06 * (ph - 2) / 0.15)
        return strike * 1.06 * (3 - ph) / 0.85

    p.pos('body', *blend([0, -6, 4], [0, 2, -15]))
    p.rot('pelvis', *blend([12, 0, 0], [26, 0, 0]))
    p.rot('waist', *blend([6, 0, 0], [8, 0, 0]))
    p.rot('chest', *blend([6, 0, 0], [4, 0, 0]))
    p.rot('neck_lower', *blend([14, 0, 0], [6, 0, 0]))
    p.rot('neck_mid', *blend([14, 0, 0], [-16, 0, 0]))
    p.rot('neck_upper', *blend([8, 0, 0], [-24, 0, 0]))
    p.rot('head', *blend([-30, 0, 8], [-2, 0, -4]))
    p.rot('jaw', *blend([0, 0, 0], [30, 0, 0]))
    p.rot('right_arm', *blend([30, 0, 6], [-128, 8, 14]))
    p.rot('right_forearm', *blend([-35, 0, 0], [12, 0, 0]))
    p.rot('right_hand', *blend([12, 0, 0], [-40, 20, 0]))
    p.rot('left_arm', *blend([22, 0, -4], [-100, -6, -18]))
    p.rot('left_forearm', *blend([-30, 0, 0], [-8, 0, 0]))
    p.rot('left_hand', *blend([10, 0, 0], [-28, -15, 0]))
    for side, s in SIDES:
        c = blend([30, 0, 0], [-22, 0, 0])[0]
        for i, f in enumerate(FINGERS):
            sp = blend([0, 0, 0], [0, 0, (i - 1.5) * 9 * (1 if s < 0 else -1)])[2] if f != 'thumb' else 0
            p.rot(f'{side}_{f}', c, 0, sp)
            p.rot(f'{side}_{f}_tip', c * 0.9)
    # feet stay planted while the body coils and thrusts
    for side, s in SIDES:
        base = REST_ANKLE[side]
        two_bone(p, f'{side}_leg', f'{side}_shin', f'{side}_foot', (base[0], base[1], base[2] + (2 if s > 0 else -3)),
                 (0.15 * s, 0.3, -1), 'leg')
        flat_foot(p, side, 0)
    kick = blend([-10, 0], [38, 0])
    drips(p, t, 0.5, 1.0, (kick[0], kick[1]))
    return p


# ------------------------------------------------------------------ drowning grasp (one shot)
@anim('grasp', 2.2, loop=False, scene='water', water_level=WATER_IDLE)
def a_grasp(t):
    p = Pose()
    reach = track(t, [(0, 0), (0.45, 1, ease_out), (0.62, 1), (1.0, 0.35), (1.6, 0.0), (2.2, 0)])
    grab = track(t, [(0, 0), (0.45, -0.4), (0.55, 1, ease_out), (1.7, 1), (2.2, 0)])
    pull = track(t, [(0, 0), (0.6, 0), (1.15, 1, smooth), (1.65, 1), (2.2, 0)])
    reach, grab, pull = float(reach), float(grab), float(pull)
    p.pos('body', 0, -7 - 9 * pull, -9 * reach + 6 * pull)
    p.rot('pelvis', -14 + 22 * reach - 4 * pull)
    p.rot('waist', -5 + 8 * reach)
    p.rot('chest', -4 + 6 * reach + 6 * pull)
    p.rot('neck_lower', -8 + 10 * reach)
    p.rot('neck_mid', -6 - 10 * reach + 6 * pull)
    p.rot('neck_upper', -2 - 8 * reach)
    p.rot('head', 37 - 26 * reach + 4 * pull, 0, 6 * pull)
    p.rot('jaw', 2 + 18 * reach * (1 - pull) + 6 * pull)
    for side, s in SIDES:
        p.rot(f'{side}_arm', -95 * reach + 22 * pull, 0, s * (-6 + 14 * reach - 10 * pull))
        p.rot(f'{side}_forearm', 30 * reach - 45 * pull, 0, 0)
        p.rot(f'{side}_hand', -25 * reach + 25 * pull, 0, 0)
        for i, f in enumerate(FINGERS):
            spread = (i - 1.5) * 8 * (1 if s < 0 else -1) * max(0.0, -grab) * 2.5 if f != 'thumb' else 0
            p.rot(f'{side}_{f}', -10 + 70 * max(0.0, grab), 0, spread)
            p.rot(f'{side}_{f}_tip', 80 * max(0.0, grab))
        ph = 0 if s < 0 else math.pi
        p.rot(f'{side}_leg', -10 + 10 * math.sin(TAU * t / 2.2 + ph) + 20 * pull)
        p.rot(f'{side}_shin', 10 + 25 * pull)
    drips(p, t, 0.8, 1.0, (20 * reach - 30 * pull, 0))
    return p


# ------------------------------------------------------------------ emerging (one shot)
def lerp_pose(a, b, w):
    out = Pose()
    for name in set(a) | set(b):
        for ch in ('rotation', 'position'):
            va = np.asarray(a.get(name, {}).get(ch, (0, 0, 0)), dtype=float)
            vb = np.asarray(b.get(name, {}).get(ch, (0, 0, 0)), dtype=float)
            if ch in a.get(name, {}) or ch in b.get(name, {}):
                out.setdefault(name, {})[ch] = va + (vb - va) * w
    return out


def emerge_reach(t):
    """arms up, torso upright, head tipped back: rising out of the depths"""
    p = Pose()
    p.rot('pelvis', -16)
    p.rot('waist', -6)
    p.rot('chest', -6)
    p.rot('neck_lower', -14)
    p.rot('neck_mid', -10)
    p.rot('neck_upper', -6)
    aim_head(p, -18, 0, 9 * math.sin(TAU * t / 1.4))
    p.rot('jaw', 10)
    for side, s in SIDES:
        wob = math.sin(TAU * t / 1.1 + (0 if s < 0 else 1.3))
        p.rot(f'{side}_arm', -150 + 8 * wob, 6 * s, s * (-26 - 5 * wob))
        p.rot(f'{side}_forearm', -24 + 10 * wob)
        p.rot(f'{side}_hand', -20)
        curl(p, side, 12 + 10 * wob, 20)
        p.rot(f'{side}_leg', -18)
        p.rot(f'{side}_shin', 24)
    return p


def emerge_grab(t, rise):
    """hands slam onto the bank in front and haul the body up"""
    p = Pose()
    p.pos('body', 0, rise, 0)
    p.rot('pelvis', 8)
    p.rot('waist', 4)
    p.rot('chest', 6)
    p.rot('neck_lower', -6)
    p.rot('neck_mid', -6)
    p.rot('neck_upper', -4)
    aim_head(p, 6, 0, -4)
    p.rot('jaw', 6)
    for side, s in SIDES:
        tgt = np.array([13.5 * s, 4.6, -19.0 + (1.5 if s > 0 else 0)])
        two_bone(p, f'{side}_arm', f'{side}_forearm', f'{side}_hand', tgt, (0.8 * s, 1.8, 0.4), 'arm')
        plant_hand(p, side, (0.25 * s, -0.05, -1.0), (0, -1, 0))
        curl(p, side, 34, 46)
        p.rot(f'{side}_leg', -12)
        p.rot(f'{side}_shin', 14)
    return p


@anim('emerge', 2.8, loop=False, scene='water', water_level=4.0)
def a_emerge(t):
    rise = float(track(t, [(0, -64), (1.0, -30, smooth), (1.5, -17, smooth), (2.2, -3, smooth), (2.8, 0, smooth)]))
    w_grab = float(track(t, [(0, 0), (1.15, 0), (1.5, 1, ease_out), (2.15, 1), (2.8, 0, smooth)]))
    w_rest = float(track(t, [(0, 0), (2.15, 0), (2.8, 1, smooth)]))
    up = emerge_reach(t)
    up.pos('body', 0, rise, 0)
    g = emerge_grab(t, rise)
    p = lerp_pose(up, g, w_grab) if w_grab < 1 else g
    if w_rest > 0:
        p = lerp_pose(p, Pose(), w_rest)
    p = Pose(p)
    upk = 1 - w_grab
    drips(p, t, 1.2, 1.0, (-40 * upk * (1 - w_rest), 0))
    return p


# ------------------------------------------------------------------ retreat / submerge (one shot)
@anim('submerge', 2.6, loop=False, scene='water', water_level=4.0)
def a_submerge(t):
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
        p.rot(f'{side}_arm', -20 * upright - 55 * drift, 0, s * (-12 * upright - 30 * drift))
        p.rot(f'{side}_forearm', -10 * upright - 25 * drift)
        p.rot(f'{side}_hand', -10 * drift)
        curl(p, side, 14 * drift, 20 * drift)
        p.rot(f'{side}_leg', -15 * drift)
        p.rot(f'{side}_shin', 20 * drift)
    drips(p, t, 0.7, 1.0, (-70 * smooth((t - 0.8) / 1.4), 0))
    return p


# ------------------------------------------------------------------ swim (underwater)
SWIM_T = 1.8


@anim('swim', SWIM_T, scene='underwater', speed=34.0)
def a_swim(t):
    p = Pose()
    ph = t / SWIM_T
    w = TAU * ph
    p.pos('body', 0, 14 + 1.5 * math.sin(w - 0.8), -10)
    p.rot('body', 60, 0, 2 * math.sin(w))
    # travelling wave down the spine
    p.rot('pelvis', 2 + 7 * math.sin(w - 1.6))
    p.rot('waist', -6 + 7 * math.sin(w - 0.8))
    p.rot('chest', -10 + 6 * math.sin(w))
    p.rot('neck_lower', -2 + 5 * math.sin(w + 0.6))
    p.rot('neck_mid', -10 + 3 * math.sin(w + 1.0))
    p.rot('neck_upper', -8)
    aim_head(p, 22 + 4 * math.sin(w + 1.2), 0, 4 * math.sin(w))
    p.rot('jaw', 6 + 4 * math.sin(w))
    # breaststroke: reach (0-.3), sweep out (.55), pull back along the body (.75), tuck (.88)
    keys = [(0.0, [-128, -12, -12]), (0.30, [-138, -16, -2]), (0.55, [-84, -72, -14]),
            (0.75, [42, -20, -12]), (0.88, [-48, -12, -100]), (1.0, [-128, -12, -12])]
    arm = track(ph, keys, smooth)
    for side, s in SIDES:
        p.rot(f'{side}_arm', arm[0], 0, arm[1] * s)
        p.rot(f'{side}_forearm', arm[2])
        p.rot(f'{side}_hand', 8 + 14 * math.sin(w - 1.0))
        spread = bump(ph - 0.25, 0.5)
        curl(p, side, 4 + 8 * math.sin(w - 1.5), 8, spread=7 * spread)
        kick = math.sin(w - 2.2 + (0 if s < 0 else 0.6))
        p.rot(f'{side}_leg', 58 + 12 * kick, 0, -3 * s)
        p.rot(f'{side}_shin', -58 + 20 * math.sin(w - 2.8 + (0 if s < 0 else 0.6)))
        p.rot(f'{side}_foot', 40 + 12 * kick)
    drips(p, t, 0.6, 1.0, (-55, 0))
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
