"""New animations authored for every model, fitted to each skeleton (applied by build_entities.py after
pose_fixes, so they start from the corrected idle / stage pose):

  stoop  a deeply hunched walk to squeeze the ~5-block animatronics through 3-block doorways: pelvis
         tipped forward, back near horizontal, knees deep, head up to look ahead, ears folded back,
         arms hanging forward in a slow swing; under STOOP_MAX blocks tall at the render scale
  lean   held at the office doors and the window: crouched outside, bent forward with the face low in
         the opening, the head tilted, eyes forward, hands on the knees; the face is the front-most
         point and the whole pose stays under a 3-block door
  wave   a friendly wave with the free hand (~2 s, plays once, starts and ends in the idle stance)
  bow    a theatrical curtain-call bow (~2.5 s, holds the last frame = the stage pose); the prop stays
         in hand

Poses are solved with tools/entities/rig.py (same bone maths as the renderer) and checked afterwards with
tools/entities/check_hands.mjs.
"""
import copy
import math

import numpy as np

from rig import Rig, minimize, penetration, excess, extent, forward_profile, static_pose, first_key, r3, PROPS, anim_pose, lerp_pose

# ------------------------------------------------------------------ helpers

def cyc_keys(times, values):
    return {f'{t:.2f}': r3(v) for t, v in zip(times, values)}


def merge_pose(*poses):
    out = {}
    for p in poses:
        for b, chs in p.items():
            out.setdefault(b, {}).update(copy.deepcopy(chs))
    return out


def keyframed(frames, times):
    """[pose dict per time] -> bones channels with keyframes (constant channels collapse to one value)."""
    bones = {}
    names = set()
    for f in frames:
        for b, chs in f.items():
            for c in chs:
                names.add((b, c))
    for b, c in sorted(names):
        vals = []
        for f in frames:
            v = f.get(b, {}).get(c)
            if v is None:
                v = [1.0, 1.0, 1.0] if c == 'scale' else [0.0, 0.0, 0.0]
            vals.append(v)
        if all(np.allclose(v, vals[0], atol=1e-3) for v in vals):
            bones.setdefault(b, {})[c] = r3(vals[0])
        else:
            bones.setdefault(b, {})[c] = cyc_keys(times, vals)
    return bones


def side_sign(side):
    """Bedrock x of the model's right side is negative."""
    return -1.0 if side == 'right' else 1.0


def hide_props(rg, keep=()):
    return {p: {'scale': 0} for p in rg.props() if p not in keep}


# ------------------------------------------------------------------ stoop
STOOP_MAX = 2.78          # blocks, at the render scale (doorways are 3 tall; the cue says <= 2.85)
STOOP_HALF_WIDTH = 1.3    # blocks: arms (and the cane) within 2.6 blocks across, for 3-wide doorways


def _stoop_pose(rg, P, phase):
    sk = rg.sk
    W, b0, T, h, ear, A = P['W'], P['b0'], P['T'], P['h'], P['ear'], P['A']
    a0 = b0 * 0.5
    pose = {'waist': {'rotation': [W, 2.0 * math.sin(phase), 0.0]}, 'torso': {'rotation': [T, -3.0 * math.sin(phase), 0.0]},
            'head': {'rotation': [-(W + T) + h + 2.0 * math.sin(2 * phase), 4.0 * math.sin(phase), 0.0]}}
    for side, ph in (('right', 0.0), ('left', math.pi)):
        s, c = math.sin(phase + ph), math.cos(phase + ph)
        a = a0 + A * s
        b = b0 + 18.0 * max(0.0, c)              # the swing leg lifts its foot
        pose[f'{side}_leg'] = {'rotation': [-W - a, 0.0, 0.0]}
        pose[f'{side}_shin'] = {'rotation': [b, 0.0, 0.0]}
        pose[f'{side}_foot'] = {'rotation': [a - b, 0.0, 0.0]}
        # arms hang forward from the hunched shoulders and swing against the legs
        u = P['u'] - 9.0 * s
        sg = side_sign(side)
        pose[f'{side}_arm'] = {'rotation': [-(W + T) - u, 0.0, -sg * P['abd']]}
        pose[f'{side}_forearm'] = {'rotation': [-P['f'] - 6.0 * max(0.0, -s), 0.0, 0.0]}
    for e in ('right_ear', 'left_ear'):
        if rg.has(e):
            pose[e] = {'rotation': [ear, 0.0, 0.0]}
    if rg.tail():
        # the tail trails behind: cancel most of its sideways curl at the root
        rz = rg.bones['tail_1'].get('rotation', [0, 0, 0])[2]
        pose['tail_1'] = {'rotation': [P['tail'], 6.0 * math.sin(phase), -0.7 * rz]}
    return pose


def _grounded(rg, pose):
    """Lower / raise the hips so the lowest sole rests on the floor."""
    sk = rg.sk
    p = copy.deepcopy(pose)
    p.setdefault('waist', {})['position'] = [0.0, 0.0, 0.0]
    lo = sk.lowest(sk.world(p), rg.legs())
    p['waist']['position'] = [0.0, -lo, 0.0]
    return p


def stoop_anim(cid, rg, scale, length, base_fingers, keep_props=(), neighbors=()):
    sk = rg.sk
    hmax = STOOP_MAX * 16 / scale
    solid = rg.solid()
    shown = [b for b in solid if b not in PROPS or b in keep_props]
    arms = rg.arm('right', True) + rg.arm('left', True)
    arms = [b for b in arms if b not in PROPS or b in keep_props]
    tail = rg.tail()
    cane = 'right_cane' in keep_props
    phases = [2 * math.pi * k / 4 for k in range(4)]
    head_parts = [b for b in ('head', 'jaw') if rg.has(b)]
    head_all = [b for b in ('head', 'jaw', 'hat', 'right_ear', 'left_ear') if rg.has(b)]
    hands_r = [b for b in rg.forearm('right', True) if b not in PROPS or b in keep_props]
    hands_l = [b for b in rg.forearm('left', True) if b not in PROPS or b in keep_props]
    hand_gap = 2 * abs(rg.bones['right_hand']['pivot'][0]) + 3.0     # keep the hands at least shoulder-wide apart
    KEYS = ['W', 'b0', 'T', 'h', 'ear', 'u', 'f', 'abd', 'tail', 'A', 'cx', 'cz']

    def full(P, ph):
        p = merge_pose(base_fingers, _stoop_pose(rg, P, ph))        # solve with the final finger shapes
        if cane:
            p['right_cane'] = {'rotation': [P['cx'], 4.479, P['cz']]}
        return _grounded(rg, p)

    def cost(x):
        P = dict(zip(KEYS, x))
        c = 0.0
        for ph in phases:
            Wd = sk.world(full(P, ph))
            c += 400.0 * max(0.0, sk.highest(Wd, shown) - hmax) ** 2
            lo = sk.lowest(Wd, arms)
            if tail:
                lo = min(lo, sk.lowest(Wd, tail))
            c += 60.0 * max(0.0, 1.5 - lo) ** 2
            if cane:
                c += 30.0 * penetration(sk, Wd, ['right_cane'], rg.legs() + ['waist', 'torso'] + tail) ** 2
            sep = float(np.linalg.norm(sk.point(Wd, 'right_hand', rg.bones['right_hand']['pivot']) - sk.point(Wd, 'left_hand', rg.bones['left_hand']['pivot'])))
            c += 20.0 * max(0.0, hand_gap - sep) ** 2
            c += 80.0 * penetration(sk, Wd, hands_r, hands_l) ** 2
            c += 80.0 * (penetration(sk, Wd, hands_r, head_all) + penetration(sk, Wd, hands_l, head_all)) ** 2
        for ph in phases[::2]:
            Wd = sk.world(full(P, ph))
            for sd in ('right', 'left'):
                c += 30.0 * max(0.0, excess(sk, Wd, [f'{sd}_arm', f'{sd}_forearm'], head_parts) - 0.4) ** 2
        tilt = P['W'] + P['T']
        c += 0.004 * (tilt - 75) ** 2 + 0.03 * max(0.0, tilt - 100) ** 2 + 0.002 * (P['b0'] - 60) ** 2
        c += 0.01 * (P['h'] - 12) ** 2 + 0.0015 * P['ear'] ** 2 + 0.004 * (P['u'] - 12) ** 2 + 0.001 * (P['f'] - 60) ** 2
        return c

    x0 = [20.0, 70.0, 50.0, 12.0, -30.0, 12.0, 60.0, -6.0, -40.0, 14.0, 60.0, 0.0]
    lo = [5.0, 40.0, 20.0, -5.0, -95.0, 0.0, 30.0, -15.0, -95.0, 14.0, -40.0, -60.0]
    hi = [45.0, 120.0, 85.0, 40.0, 0.0, 35.0, 110.0, 20.0, 20.0, 14.0, 110.0, 60.0]
    steps = [6.0, 10.0, 8.0, 6.0, 15.0, 6.0, 12.0, 4.0, 15.0, 0.0, 15.0 if cane else 0.0, 15.0 if cane else 0.0]
    x, c = minimize(cost, x0, steps, lo, hi, iters=30, restarts=2)
    P = dict(zip(KEYS, x))
    n = 16
    times = [length * k / n for k in range(n + 1)]
    # The arms: roll, elbow bend and how far they hang forward, chosen over a grid so that neither the
    # stoop itself (whole cycle) nor the 0.25 s cross-fades to idle / the stage pose / walk put a hand into
    # the other hand, the head or the body, and the hands stay off the floor. With the torso pitched this
    # far, arms swinging back to vertical cut through the chest mid-fade, so they dangle forward closer to
    # their idle angle: a hunched, ape-like shamble with the hands just above the floor.
    body_parts = [b for b in ('torso', 'waist') if rg.has(b)] + rg.legs() + tail
    check_t = [length * k / 4 for k in range(4)]
    half_w = STOOP_HALF_WIDTH * 16 / scale                      # through a 3-wide door
    hr = [b for b in hands_r if b not in PROPS]                 # the cane is placed afterwards (stage 2)
    hl = [b for b in hands_l if b not in PROPS]
    arm_bones = [b for b in arms if b not in PROPS]
    cands = []
    for abd in (-15.0, -10.0, -5.0, 0.0, 5.0, 10.0, 15.0, 20.0):
        for f in (15.0, 25.0, 35.0, 50.0, 65.0):
            for u in (-90.0, -75.0, -60.0, -45.0, -30.0, -15.0, 0.0, 12.0, 25.0):
                Q = dict(P, abd=abd, f=f, u=u)
                worst, low, wide = 0.0, 1e9, 0.0
                for t in check_t:
                    fr = full(Q, 2 * math.pi * t / length)
                    Wq = sk.world(fr)
                    worst = max(worst, penetration(sk, Wq, hr, hl), penetration(sk, Wq, hr + hl, head_all),
                                penetration(sk, Wq, hr + hl, body_parts))
                    low = min(low, sk.lowest(Wq, arm_bones))
                    wide = max(wide, max(abs(v) for v in extent(sk, Wq, arm_bones, 0)))
                    if worst > 1.5:
                        break
                    for nb in neighbors:
                        for w in (0.25, 0.5, 0.75):
                            Wb = sk.world(lerp_pose(fr, nb, w))
                            for sd, mine in (('right', hr), ('left', hl)):
                                worst = max(worst, excess(sk, Wb, [f'{sd}_arm'], ['torso']), penetration(sk, Wb, mine, ['torso', 'waist']))
                score = max(0.0, worst - 0.4) * 10.0 + 5.0 * max(0.0, 1.5 - low) + 2.0 * max(0.0, wide - half_w)
                score += 0.004 * abs(u - 12.0) + 0.002 * abs(f - 35.0)
                cands.append((score, abd, f, u, worst, low, wide))
    cands.sort()
    best = cands[0]
    if cane:
        # stage 2: the cane, carried so that its tip stays off the floor in the stoop and in every cross-fade,
        # clear of the legs and the tail, within the door width; the first arm candidate that allows it wins
        for cand in cands[:6]:
            Q = dict(P, abd=cand[1], f=cand[2], u=cand[3])
            opts = []
            for cx in (-90.0, -60.0, -30.0, 0.0, 30.0, 60.0, 90.0, 120.0):
                for cz in (-60.0, -30.0, 0.0, 30.0, 60.0):
                    Qc = dict(Q, cx=cx, cz=cz)
                    bad, wide = 0.0, 0.0
                    for t in check_t:
                        fr = full(Qc, 2 * math.pi * t / length)
                        Wq = sk.world(fr)
                        bad = max(bad, max(0.0, 0.5 - sk.lowest(Wq, ['right_cane'])), penetration(sk, Wq, ['right_cane'], body_parts + head_all + hl))
                        wide = max(wide, max(abs(v) for v in extent(sk, Wq, ['right_cane'], 0)))
                        if bad > 1.0:
                            break
                        for nb in neighbors:
                            for w in (0.25, 0.5, 0.75):
                                Wb = sk.world(lerp_pose(fr, nb, w))
                                bad = max(bad, max(0.0, 0.3 - sk.lowest(Wb, ['right_cane'])))
                    opts.append((bad + 2.0 * max(0.0, wide - half_w) + 0.001 * abs(cx - 30.0), cx, cz, bad, wide))
            opts.sort()
            if opts[0][0] < 0.5 or cand is cands[5]:
                best = cand
                P.update(cx=opts[0][1], cz=opts[0][2])
                break
    P.update(abd=best[1], f=best[2], u=best[3])
    clear = {'worst_px': round(best[4], 2), 'hands_above_floor_px': round(best[5], 2), 'arms_half_width_px': round(best[6], 2)}
    frames = [full(P, 2 * math.pi * t / length) for t in times]
    bones = keyframed([merge_pose(base_fingers, f) for f in frames], times)
    bones.update(hide_props(rg, keep=keep_props))
    tops = [sk.highest(sk.world(f), shown) for f in frames]
    info = {'params': {k: round(v, 2) for k, v in P.items()}, 'height_blocks': round(max(tops) * scale / 16, 3), 'cost': round(c, 3), **clear}
    return {'loop': True, 'animation_length': length, 'bones': bones}, info, P


# ------------------------------------------------------------------ arm IK
def solve_arm(rg, pose, side, cost_fn, x0, lo, hi, steps, extra=None, iters=40, restarts=2):
    """Arm rotations [ax, ay, az, fx, hx, hz] minimising cost_fn(W, x) with the rest of the pose fixed."""
    sk = rg.sk

    def build(x):
        p = copy.deepcopy(pose)
        p[f'{side}_arm'] = {'rotation': [x[0], x[1], x[2]]}
        p[f'{side}_forearm'] = {'rotation': [x[3], 0.0, 0.0]}
        p[f'{side}_hand'] = {'rotation': [x[4], 0.0, x[5]]}
        if extra:
            extra(p, x)
        return p

    x, c = minimize(lambda x: cost_fn(sk.world(build(x)), x), x0, steps, lo, hi, iters=iters, restarts=restarts)
    return build(x), x, c


def hand_mid(rg, side, f=0.4):
    b = rg.bones[f'{side}_hand']
    c = b['cubes'][0]
    return [c['origin'][0] + c['size'][0] / 2, c['origin'][1] + c['size'][1] * f, c['origin'][2] + c['size'][2] / 2]


def _d2(a, b):
    return float(np.sum((np.asarray(a) - np.asarray(b)) ** 2))


def big_bones(rg):
    """The large body parts hands and props must stay out of (not every finger cube: keeps solving fast)."""
    names = ['waist', 'torso', 'head', 'jaw', 'hat', 'right_leg', 'left_leg', 'right_shin', 'left_shin', 'right_foot', 'left_foot', 'tail_1', 'tail_2']
    return [b for b in names if rg.has(b)]


# ------------------------------------------------------------------ lean
LEAN_EYE = 1.85           # blocks above the floor: door cue 1.6-2.3, window cue 1.3-2.5
LEAN_MAX = 2.85           # blocks: the whole pose (hat and ears too) fits under a 3-block door / the window top
SILL = 1.0                # blocks: the window sill height (reported: how far the lower body sits behind the face)


def lean_anim(cid, rg, scale, eye, base_fingers, keep_props=(), neighbors=()):
    """neighbors: poses the controller cross-fades from / to (idle, stage pose, walk frames): the arms are
    solved so the 0.25 s fades stay clear too (hands, cane tip above the floor)."""
    sk = rg.sk
    eye_bone, eye_pt = eye
    target = LEAN_EYE * 16 / scale
    hmax = LEAN_MAX * 16 / scale
    sill = SILL * 16 / scale
    shown = [b for b in rg.solid() if b not in PROPS or b in keep_props]
    head = rg.head()
    lower = [b for b in rg.body() if b not in head]           # waist, torso, legs, tail
    arms_all = rg.arm('right', True) + rg.arm('left', True)
    no_arms = [b for b in shown if b not in arms_all]
    ears = [e for e in ('right_ear', 'left_ear') if rg.has(e)]
    KEYS = ['W', 'a', 'b', 'T', 'ear']

    def body_pose(P):
        W, a, b, T = P['W'], P['a'], P['b'], P['T']
        p = {'waist': {'rotation': [W, 0.0, 0.0]}, 'torso': {'rotation': [T, 0.0, 0.0]},
             'head': {'rotation': [-(W + T) + 4.0, -6.0, 16.0]}, 'jaw': {'rotation': [10.0, 0.0, 0.0]}}
        for side, st in (('right', 4.0), ('left', -4.0)):        # a slight stagger
            aa = a + st
            p[f'{side}_leg'] = {'rotation': [-W - aa, 0.0, 0.0]}
            p[f'{side}_shin'] = {'rotation': [b, 0.0, 0.0]}
            p[f'{side}_foot'] = {'rotation': [aa - b, 0.0, 0.0]}
            p[f'{side}_arm'] = {'rotation': [-(W + T), 0.0, 0.0]}
        for e in ears:
            p[e] = {'rotation': [P['ear'], 0.0, 0.0]}
        if rg.tail():
            rz = rg.bones['tail_1'].get('rotation', [0, 0, 0])[2]
            p['tail_1'] = {'rotation': [-30.0, 0.0, -0.7 * rz]}
        return _grounded(rg, p)

    def measures(Wd):
        e = sk.point(Wd, eye_bone, eye_pt)
        face = -extent(sk, Wd, head, 2)[0]                       # front-most point of the head
        low = forward_profile(sk, Wd, lower, sill)               # front-most body part under the sill
        rest = -extent(sk, Wd, lower, 2)[0]
        top = sk.highest(Wd, no_arms)
        return e, face, low, rest, top

    def cost(x):
        P = dict(zip(KEYS, x))
        e, face, low, rest, top = measures(sk.world(body_pose(P)))
        c = 40.0 * (e[1] - target) ** 2 + 40.0 * max(0.0, top - hmax) ** 2 + 20.0 * max(0.0, rest - face + 1.5) ** 2
        c -= 0.1 * (face - low)                                  # face ahead of the knees
        c += 0.003 * (P['W'] + P['T'] - 75) ** 2 + 0.002 * (P['b'] - 90) ** 2 + 0.002 * (P['a'] - 0.6 * P['b']) ** 2 + 0.0006 * P['ear'] ** 2
        return c

    x, _ = minimize(cost, [20.0, 50.0, 90.0, 55.0, -60.0 if ears else 0.0], [6.0, 8.0, 10.0, 8.0, 15.0 if ears else 0.0],
                    [0.0, 0.0, 30.0, 20.0, -90.0], [45.0, 95.0, 135.0, 90.0, 0.0], iters=30, restarts=2)
    P = dict(zip(KEYS, x))
    pose = merge_pose(base_fingers, body_pose(P))                   # solve the hands with their final finger shapes
    if rg.tail():
        for _ in range(40):
            if sk.lowest(sk.world(pose), rg.tail()) >= 0.5:
                break
            r = pose['tail_1']['rotation']
            pose['tail_1'] = {'rotation': [r[0] + 4.0, r[1], r[2]]}
    # bent over to peer through the opening, arms hanging limp under the shoulders with soft elbows (the
    # Ringmaster's right hand also holds his cane, planted behind and beside his right foot); the hands stay
    # behind the face and off the floor
    placed = []
    for side in ('right', 'left'):
        sg = side_sign(side)
        Wd = sk.world(pose)
        shoulder = sk.point(Wd, f'{side}_arm', rg.bones[f'{side}_arm']['pivot'])
        others = big_bones(rg) + [f"{'left' if side == 'right' else 'right'}_forearm", f"{'left' if side == 'right' else 'right'}_hand"]
        mine = [b for b in rg.forearm(side, props=True) if b not in PROPS or b in keep_props]   # hidden props do not count
        leg = rg.bones[f'{side}_leg']
        lc = [c for c in leg.get('cubes', [])]
        ly0 = min(c['origin'][1] for c in lc)
        ly1 = max(c['origin'][1] + c['size'][1] for c in lc)
        lz0 = min(c['origin'][2] for c in lc)
        face_px = -extent(sk, Wd, head, 2)[0]
        wrist_t = np.array([sg * max(abs(shoulder[0]) + 1.8, 7.5), 6.0, shoulder[2] + 1.0])
        elbow_t = np.array([shoulder[0] + sg * 2.5, (shoulder[1] + 6.0) / 2, shoulder[2] + 2.0])
        cane = side == 'right' and 'right_cane' in keep_props
        xmax = abs(rg.bones['right_arm']['pivot'][0]) + 4.0

        def build(x, side=side, cane=cane):
            p = copy.deepcopy(pose)
            p[f'{side}_arm'] = {'rotation': [x[0], x[1], x[2]]}
            p[f'{side}_forearm'] = {'rotation': [x[3], 0.0, 0.0]}
            p[f'{side}_hand'] = {'rotation': [x[4], 0.0, x[5]]}
            if cane:
                p['right_cane'] = {'rotation': [x[6], 4.479, x[7]]}
            return p

        def acost(x, side=side, cane=cane, wrist_t=wrist_t, elbow_t=elbow_t, mine=mine, others=others):
            px = build(x)
            Wc = sk.world(px)
            c = 0.0
            for nb in neighbors:                        # what the cross-fades show on the way in / out
                for w in (0.25, 0.5, 0.75):
                    Wb = sk.world(lerp_pose(px, nb, w))
                    c += 100.0 * max(0.0, penetration(sk, Wb, mine, others) - 0.6) ** 2
                    for q in placed:
                        c += 100.0 * max(0.0, penetration(sk, Wb, mine, q) - 0.3) ** 2
                    if cane:
                        c += 200.0 * max(0.0, 0.3 - sk.lowest(Wb, ['right_cane'])) ** 2
            c += 2.0 * _d2(sk.point(Wc, f'{side}_hand', rg.bones[f'{side}_hand']['pivot']), wrist_t)
            c += 0.3 * _d2(sk.point(Wc, f'{side}_forearm', rg.bones[f'{side}_forearm']['pivot']), elbow_t)
            c += 200.0 * max(0.0, penetration(sk, Wc, mine, others) - 0.3) ** 2
            c += 200.0 * max(0.0, excess(sk, Wc, [f'{side}_arm'], ['torso'] + [b for b in ('head', 'jaw') if rg.has(b)]) - 0.3) ** 2
            c += 200.0 * max(0.0, 0.5 - sk.lowest(Wc, [b for b in mine if b != 'right_cane'])) ** 2
            for q in placed:
                c += 200.0 * penetration(sk, Wc, mine, q) ** 2
            el = sk.point(Wc, f'{side}_forearm', rg.bones[f'{side}_forearm']['pivot'])
            c += 20.0 * max(0.0, el[1] - (shoulder[1] - 1.0)) ** 2                    # elbows stay below the shoulders
            wr = sk.point(Wc, f'{side}_hand', rg.bones[f'{side}_hand']['pivot'])
            c += 30.0 * max(0.0, 4.5 - sg * wr[0]) ** 2                               # each hand stays on its own side
            fwd = -min(float(sk.cube_corners(Wc, b)[:, 2].min()) for b in mine if len(sk._local_corners(b)))
            c += 50.0 * max(0.0, fwd - (face_px - 3.0)) ** 2                          # hands behind the face
            if cane:
                # the cane hangs from the limp hand, its tip resting on the floor within the body's width
                tip = sk.point(Wc, 'right_cane', [-5.0, -1.375, 0.0])
                top = sk.point(Wc, 'right_cane', [-5.0, 13.875, 0.0])
                c += 6.0 * (tip[1] - 0.4) ** 2 + 200.0 * max(0.0, 0.3 - tip[1]) ** 2
                c += 20.0 * max(0.0, max(abs(tip[0]), abs(top[0])) - xmax) ** 2
                c += 200.0 * penetration(sk, Wc, ['right_cane'], big_bones(rg)) ** 2
            return c + 0.002 * (x[4] ** 2 + x[5] ** 2)
        x0 = [-(P['W'] + P['T']) + 10.0, 0.0, -sg * 4.0, -40.0, 0.0, 0.0] + ([60.0, 0.0] if cane else [])
        st = [8.0, 8.0, 6.0, 8.0, 6.0, 6.0] + ([15.0, 15.0] if cane else [])
        lo_ = [-220.0, -60.0, -60.0, -130.0, -40.0, -40.0] + ([-150.0, -150.0] if cane else [])
        hi_ = [60.0, 60.0, 60.0, 0.0, 40.0, 40.0] + ([180.0, 150.0] if cane else [])
        x, _ = minimize(acost, x0, st, lo_, hi_, iters=30, restarts=2)
        pose = build(x)
        placed.append(mine)
    # the creepy head tilt leans towards whichever shoulder it clears
    hr = pose['head']['rotation']
    def tilt_touch(z):
        Wq = sk.world({**pose, 'head': {'rotation': [hr[0], -hr[1] if z < 0 else hr[1], z]}})
        return sum(excess(sk, Wq, [f'{sd}_arm'], rg.head()) for sd in ('right', 'left'))
    if tilt_touch(-hr[2]) < tilt_touch(hr[2]) - 0.05:
        pose['head'] = {'rotation': [hr[0], -hr[1], -hr[2]]}
    # a slow, creepy loop: the head tilt sways, a sudden twitch, a breath
    times = [0.0, 1.0, 2.0, 2.2, 2.28, 2.4, 3.0]
    hb = pose['head']['rotation']
    # the twitch turns the head away from whichever shoulder it would touch
    def touch(yaw):
        q = {**pose, 'head': {'rotation': [hb[0] + 6.0, hb[1] + yaw, hb[2] - 4.0]}}
        Wq = sk.world(q)
        return sum(excess(sk, Wq, [f'{sd}_arm'], rg.head()) for sd in ('right', 'left'))
    tw = -3.0 if touch(-3.0) <= touch(3.0) else 3.0
    # a sudden jerky nod with a small turn
    heads = [hb, [hb[0] - 1.5, hb[1] + 2.0, hb[2] - 3.0], hb, hb, [hb[0] + 6.0, hb[1] + tw, hb[2] - 4.0], hb, hb]
    tb = pose['torso']['rotation']
    torsos = [tb, [tb[0] + 1.2, tb[1], tb[2]], tb, tb, tb, tb, tb]
    frames = []
    for h_, t_ in zip(heads, torsos):
        f = merge_pose(base_fingers, pose)
        f['head'] = {'rotation': h_}
        f['torso'] = {'rotation': t_}
        frames.append(f)
    bones = keyframed(frames, times)
    bones.update(hide_props(rg, keep=keep_props))
    Wd = sk.world(pose)
    e, face, low, rest, top = measures(Wd)
    arms_fwd = -extent(sk, Wd, [b for b in arms_all if b in shown], 2)[0]
    info = {'params': {k: round(v, 2) for k, v in P.items()}, 'eye_y': round(float(e[1]) * scale / 16, 3), 'eye_fwd': round(float(-e[2]) * scale / 16, 3),
            'face_fwd': round(face * scale / 16, 3), 'below_sill_fwd': round(low * scale / 16, 3), 'body_fwd': round(rest * scale / 16, 3),
            'arms_fwd': round(arms_fwd * scale / 16, 3), 'height': round(sk.highest(Wd, shown) * scale / 16, 3)}
    return {'loop': True, 'animation_length': 3.0, 'bones': bones}, info


# ------------------------------------------------------------------ wave
WAVE_SIDE = {'rustgrin': 'left', 'mirehop': 'right', 'noxbriar': 'right', 'purple_rat': 'left', 'cat': 'right', 'top_hat_rat': 'left'}


def _arm_to(rg, pose, side, wrist_t, elbow_t, seed, avoid, w_elbow=0.4, iters=30):
    """Arm rotations putting the wrist (hand pivot) on wrist_t with the elbow near elbow_t, out of `avoid`."""
    sk = rg.sk

    def acost(Wd, x):
        c = 2.0 * _d2(sk.point(Wd, f'{side}_hand', rg.bones[f'{side}_hand']['pivot']), wrist_t)
        c += w_elbow * _d2(sk.point(Wd, f'{side}_forearm', rg.bones[f'{side}_forearm']['pivot']), elbow_t)
        c += 30.0 * penetration(sk, Wd, mine, avoid) ** 2
        c += 30.0 * excess(sk, Wd, [f'{side}_arm'], ['torso'] + [b for b in ('head', 'jaw') if rg.has(b)]) ** 2
        c += 0.002 * (x[4] ** 2 + x[5] ** 2)
        return c

    mine = rg.forearm(side, props=True)
    return solve_arm(rg, pose, side, acost, seed, [-200.0, -120.0, -150.0, -140.0, -45.0, -45.0], [80.0, 120.0, 150.0, 0.0, 45.0, 45.0],
                     [8.0, 8.0, 8.0, 10.0, 6.0, 6.0], iters=iters, restarts=2)


def wave_anim(cid, rg, base, relaxed):
    """base: the idle stance (static pose); relaxed(side): open-hand finger channels."""
    sk = rg.sk
    side = WAVE_SIDE[cid]
    sg = side_sign(side)
    base_idle = base
    base = {**base, **relaxed(side)}                               # the waving hand is open
    Wd = sk.world(base)
    shoulder = sk.point(Wd, f'{side}_arm', rg.bones[f'{side}_arm']['pivot'])
    head_piv = sk.point(Wd, 'head', rg.bones['head']['pivot'])
    head_top = sk.highest(Wd, ['head'])
    hx = max(abs(v) for v in extent(sk, Wd, ['head'], 0))
    # hand up beside the head, a little forward; the elbow out at about shoulder height
    up = head_piv[1] + 0.55 * (head_top - head_piv[1])
    wrist_c = np.array([sg * (hx + 4.2), up, shoulder[2] - 2.5])
    elbow_t = np.array([sg * (abs(shoulder[0]) + 6.5), shoulder[1] - 2.0, shoulder[2] - 1.0])
    avoid = big_bones(rg) + [e for e in ('right_ear', 'left_ear') if rg.has(e)]
    seed = [-20.0, 0.0, -sg * 95.0, -95.0, 0.0, 0.0]
    p_c, x_c, _ = _arm_to(rg, base, side, wrist_c, elbow_t, seed, avoid)
    p_o, x_o, _ = _arm_to(rg, base, side, wrist_c + [sg * 2.8, -0.6, 0.0], elbow_t, x_c, avoid, iters=20)
    p_i, x_i, _ = _arm_to(rg, base, side, wrist_c + [-sg * 1.6, -0.4, 0.0], elbow_t, x_c, avoid, iters=20)
    arm_keys = [f'{side}_arm', f'{side}_forearm', f'{side}_hand']
    up_f = {**base, **{k: p_c[k] for k in arm_keys}, **relaxed(side)}
    out_f = {**base, **{k: p_o[k] for k in arm_keys}, **relaxed(side)}
    in_f = {**base, **{k: p_i[k] for k in arm_keys}, **relaxed(side)}
    hb = base.get('head', {}).get('rotation', [0.0, 0.0, 0.0])
    tilt = lambda f, dx, dz: {**f, 'head': {**f.get('head', {}), 'rotation': [hb[0] + dx, hb[1] + sg * 6.0, hb[2] + sg * dz]}}
    frames = [base_idle, tilt(up_f, -4.0, 6.0), tilt(out_f, 2.0, 8.0), tilt(in_f, 0.0, 8.0), tilt(out_f, 2.0, 8.0), tilt(in_f, 0.0, 8.0),
              tilt(out_f, 2.0, 8.0), tilt(up_f, 0.0, 6.0), base_idle, base_idle]
    times = [0.0, 0.35, 0.55, 0.75, 0.95, 1.15, 1.35, 1.5, 1.88, 2.0]
    bones = keyframed([merge_pose(base_idle, f) for f in frames], times)
    Wc = sk.world(up_f)
    info = {'side': side, 'wrist_err': round(float(np.linalg.norm(sk.point(Wc, f'{side}_hand', rg.bones[f'{side}_hand']['pivot']) - wrist_c)), 2)}
    return {'loop': False, 'animation_length': 2.0, 'bones': bones}, info


# ------------------------------------------------------------------ bow
# per character: which hand goes to the chest, which arm sweeps out (props stay in hand)
BOW = {
    'rustgrin': {'chest': 'left', 'sweep': ['right']},
    'mirehop': {'chest': None, 'sweep': ['right']},          # the left hand stays on the guitar neck
    'noxbriar': {'chest': 'right', 'sweep': ['left']},
    'purple_rat': {'chest': None, 'sweep': ['right', 'left']},
    'cat': {'chest': 'right', 'sweep': ['left']},
    'top_hat_rat': {'chest': None, 'sweep': ['right']},      # the left hand already rests at his lapel
}


def bow_anim(cid, rg, base, relaxed):
    """base: the stage pose (pose_1, static). Bow down, hold, rise back into the stage pose (held)."""
    sk = rg.sk
    plan = BOW[cid]
    # arms solved with the torso upright (they are torso children, so they bow with it)
    upright = copy.deepcopy(base)
    upright['torso'] = {'rotation': [0.0, 0.0, 0.0]}
    upright['waist'] = {'rotation': [0.0, 0.0, 0.0], 'position': base.get('waist', {}).get('position', [0.0, 0.0, 0.0])}
    Wd = sk.world(upright)
    tz0, tz1 = extent(sk, Wd, ['torso'], 2)
    ty0, ty1 = extent(sk, Wd, ['torso'], 1)
    avoid = big_bones(rg) + [e for e in ('right_ear', 'left_ear') if rg.has(e)]
    arms = {}
    if plan['chest']:
        side = plan['chest']
        sg = side_sign(side)
        upright.update(relaxed(side))                              # the hand on the chest is open
        chest = np.array([-sg * 0.8, ty0 + 0.72 * (ty1 - ty0), tz0 - 0.4])
        hm = hand_mid(rg, side, 0.5)

        def ccost(Wc, x, side=side, chest=chest, hm=hm):
            c = 2.0 * _d2(sk.point(Wc, f'{side}_hand', hm), chest)
            c += 0.3 * _d2(sk.point(Wc, f'{side}_forearm', rg.bones[f'{side}_forearm']['pivot']), chest + [sg * 7.5, -4.5, 2.5])
            c += 30.0 * max(0.0, penetration(sk, Wc, rg.forearm(side, props=True), avoid) - 0.3) ** 2
            c += 30.0 * excess(sk, Wc, [f'{side}_arm'], ['torso'] + [b for b in ('head', 'jaw') if rg.has(b)]) ** 2
            return c + 0.002 * (x[4] ** 2 + x[5] ** 2)
        p, x, _ = solve_arm(rg, upright, side, ccost, [-40.0, 0.0, sg * 10.0, -100.0, 0.0, 0.0],
                            [-200.0, -120.0, -150.0, -140.0, -45.0, -45.0], [80.0, 120.0, 150.0, 0.0, 45.0, 45.0], [8.0, 8.0, 8.0, 10.0, 6.0, 6.0], iters=30)
        arms[side] = {k: p[k] for k in (f'{side}_arm', f'{side}_forearm', f'{side}_hand')}
        arms[side].update(relaxed(side))
    for side in plan['sweep']:
        sg = side_sign(side)
        sh = sk.point(Wd, f'{side}_arm', rg.bones[f'{side}_arm']['pivot'])
        wrist_t = sh + np.array([sg * 10.0, -9.0, 3.5])
        elbow_t = sh + np.array([sg * 5.5, -4.0, 1.5])
        extra = None
        p, x, _ = _arm_to(rg, upright, side, wrist_t, elbow_t, [10.0, 0.0, -sg * 50.0, -15.0, 0.0, 0.0], avoid, w_elbow=0.3)
        arms[side] = {k: p[k] for k in (f'{side}_arm', f'{side}_forearm', f'{side}_hand')}
    # body: waist and torso pitch forward, head down; the right foot steps back; feet stay flat
    def body(k):                                  # k = 0 upright .. 1 full bow
        p = copy.deepcopy(base)
        Wp, Tp = 8.0 * k, 40.0 * k
        wb = p.get('waist', {}).get('rotation', [0.0, 0.0, 0.0])
        p.setdefault('waist', {})['rotation'] = [wb[0] + Wp, wb[1], wb[2]]
        tb = p.get('torso', {}).get('rotation', [0.0, 0.0, 0.0])
        p['torso'] = {'rotation': [tb[0] + Tp, tb[1], tb[2]]}
        hb = p.get('head', {}).get('rotation', [0.0, 0.0, 0.0])
        p['head'] = {'rotation': [hb[0] + 14.0 * k, hb[1], hb[2]]}
        for side in ('right', 'left'):
            lb = p.get(f'{side}_leg', {}).get('rotation', [0.0, 0.0, 0.0])
            sb = p.get(f'{side}_shin', {}).get('rotation', [0.0, 0.0, 0.0])
            back = (14.0 if side == 'right' else 0.0) * min(1.0, 2 * k)
            bend = (10.0 if side == 'right' else 4.0) * min(1.0, 2 * k)
            leg = [lb[0] - Wp + back, lb[1], lb[2]]
            shin = [sb[0] + bend, sb[1], sb[2]]
            p[f'{side}_leg'] = {'rotation': leg}
            p[f'{side}_shin'] = {'rotation': shin}
            p[f'{side}_foot'] = {'rotation': [-(wb[0] + Wp) - leg[0] - shin[0], 0.0, 0.0]}
        return p

    def with_arms(p, on):
        q = copy.deepcopy(p)
        if on:
            for side, chs in arms.items():
                q.update(copy.deepcopy(chs))
        return q

    def grounded(p):
        q = copy.deepcopy(p)
        q.setdefault('waist', {})['position'] = [0.0, 0.0, 0.0]
        lo = sk.lowest(sk.world(q), rg.legs())
        q['waist']['position'] = [0.0, -lo, 0.0]
        return q
    if 'right_cane' in rg.bones and 'right' in plan['sweep']:
        def kcost(x):
            q = grounded(with_arms(body(1.0), True))
            q['right_cane'] = {'rotation': [x[0], 4.479, x[1]]}
            Wc = sk.world(q)
            tip = sk.point(Wc, 'right_cane', [-5.0, -1.375, 0.0])
            return 6.0 * max(0.0, 3.0 - tip[1]) ** 2 + 30.0 * penetration(sk, Wc, ['right_cane'], big_bones(rg)) ** 2 + 0.0005 * (x[0] - 40) ** 2
        xc, _ = minimize(kcost, [40.0, 0.0], [15.0, 15.0], [-120.0, -120.0], [150.0, 120.0], iters=25, restarts=2)
        arms['right']['right_cane'] = {'rotation': [xc[0], 4.479, xc[1]]}
    # via points: on the way to (and back from) the chest / the sweep, each hand passes in front of and
    # outside the body instead of cutting through it
    via = {}
    Wb = sk.world(upright)
    up_with = copy.deepcopy(upright)
    for chs in arms.values():
        up_with.update(copy.deepcopy(chs))
    We = sk.world(up_with)
    for side in arms:
        sg = side_sign(side)
        hp = rg.bones[f'{side}_hand']['pivot']
        s0, s1 = sk.point(Wb, f'{side}_hand', hp), sk.point(We, f'{side}_hand', hp)
        e0, e1 = sk.point(Wb, f'{side}_forearm', rg.bones[f'{side}_forearm']['pivot']), sk.point(We, f'{side}_forearm', rg.bones[f'{side}_forearm']['pivot'])
        mid = (s0 + s1) / 2 + np.array([sg * 2.5, 0.5, -4.0])
        emid = (e0 + e1) / 2 + np.array([sg * 2.5, 0.0, -1.0])
        seed = [(a + b) / 2 for a, b in zip(upright.get(f'{side}_arm', {}).get('rotation', [0, 0, 0]), arms[side][f'{side}_arm']['rotation'])]
        seed += [(upright.get(f'{side}_forearm', {}).get('rotation', [0, 0, 0])[0] + arms[side][f'{side}_forearm']['rotation'][0]) / 2, 0.0, 0.0]
        p, _, _ = _arm_to(rg, upright, side, mid, emid, seed, avoid, w_elbow=0.3, iters=20)
        via[side] = {k: p[k] for k in (f'{side}_arm', f'{side}_forearm', f'{side}_hand')}

    def with_mode(p, mode):
        if mode == 'on':
            return with_arms(p, True)
        q = copy.deepcopy(p)
        if mode == 'via':
            for chs in via.values():
                q.update(copy.deepcopy(chs))
        return q
    keys = [(0.0, 0.0, 'base'), (0.17, 0.05, 'via'), (0.35, 0.12, 'on'), (0.95, 1.0, 'on'), (1.6, 1.08, 'on'), (2.15, 0.35, 'on'), (2.33, 0.15, 'via'), (2.5, 0.0, 'base')]
    frames = [grounded(with_mode(body(k), mode)) for _, k, mode in keys]
    times = [t for t, _, _ in keys]
    bones = keyframed([merge_pose(base, f) for f in frames], times)
    lows = [sk.lowest(sk.world(f), [b for b in rg.solid() if b not in rg.legs()]) for f in frames]
    info = {'lowest_non_leg_px': round(min(lows), 2)}
    return {'loop': 'hold_on_last_frame', 'animation_length': 2.5, 'bones': bones}, info


# ------------------------------------------------------------------ build entry point (+ solve cache)
import hashlib
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(_HERE, 'solve_cache.json')
_SOURCES = ('new_anims.py', 'rig.py', 'fk.py', 'pose_fixes.py')


def _src_hash():
    h = hashlib.sha1()
    for f in _SOURCES:
        with open(os.path.join(_HERE, f), 'rb') as fh:
            h.update(fh.read())
    return h.hexdigest()


def _load_cache():
    try:
        with open(CACHE_FILE) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _save_cache(cache):
    with open(CACHE_FILE, 'w') as fh:
        json.dump(cache, fh, indent=0, sort_keys=True)
        fh.write('\n')


STOOP_KEEP = {'top_hat_rat': ('right_cane',)}


def apply(cid, anims, skel, geo, eye, scale, relaxed, log=print):
    """Adds animation.fnar.<cid>.stoop / lean / wave / bow to anims (the renamed, corrected set)."""
    rg = Rig(skel)
    A = lambda n: anims[f'animation.fnar.{cid}.{n}']
    idle = static_pose(A('idle'))
    stage = static_pose(A('pose_1'))
    walk = static_pose(A('walk'))
    fingers = lambda pose: {b: v for b, v in pose.items() if 'finger' in b or 'thumb' in b}
    walk_len = float(A('walk').get('animation_length', 2.0))
    keep = STOOP_KEEP.get(cid, ())
    lean_fingers = {**relaxed('right'), **relaxed('left')}
    if 'right_cane' in keep:
        lean_fingers.update({b: v for b, v in fingers(walk).items() if b.startswith('right')})
    key_src = json.dumps([cid, geo, idle, stage, walk, eye, scale, _src_hash()], sort_keys=True, default=str)
    key = hashlib.sha1(key_src.encode()).hexdigest()
    cache = _load_cache()
    hit = cache.get(cid)
    if hit and hit.get('key') == key:
        res = hit['anims']
        log(f'{cid}: new animations from the solve cache')
    else:
        stoop_nbs = [anim_pose(A('idle'), 0.0), anim_pose(A('pose_1'), 0.0), anim_pose(A('walk'), 0.0), anim_pose(A('walk'), walk_len / 2)]
        stoop, si, _ = stoop_anim(cid, rg, scale, walk_len, fingers(walk), keep_props=keep, neighbors=stoop_nbs)
        wl = A('walk')
        neighbors = [anim_pose(A('idle'), 0.0), anim_pose(A('pose_1'), 0.0)] + [anim_pose(wl, walk_len * f) for f in (0.0, 0.25, 0.5, 0.75)]
        lean, li = lean_anim(cid, rg, scale, eye, lean_fingers, keep_props=keep, neighbors=neighbors)
        wave, wi = wave_anim(cid, rg, idle, relaxed)
        bow, bi = bow_anim(cid, rg, stage, relaxed)
        res = {'stoop': stoop, 'lean': lean, 'wave': wave, 'bow': bow, 'info': {'stoop': si, 'lean': li, 'wave': wi, 'bow': bi}}
        res = json.loads(json.dumps(res, default=float, sort_keys=True))    # same form as a cache hit
        cache[cid] = {'key': key, 'anims': res}
        _save_cache(cache)
        log(f'{cid}: solved stoop {si["height_blocks"]} blocks, lean eye {li["eye_y"]} face fwd {li["face_fwd"]}')
    for n in ('stoop', 'lean', 'wave', 'bow'):
        anims[f'animation.fnar.{cid}.{n}'] = copy.deepcopy(res[n])
    return res['info']
