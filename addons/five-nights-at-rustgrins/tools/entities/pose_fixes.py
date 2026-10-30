"""Pose and hand corrections layered on top of the supplied animations (applied by build_entities.py).

The supplied animations (assets/source_models) stay untouched; this module edits the renamed copies
(animation.fnar.<id>.<name>) before they are written to packs/RP/animations. Animation names, lengths
and loop modes are never changed.

* pose_1 (the stage pose; also the Ringmaster in his booth) of all six models - and so of the Rusted one,
  who uses Rustgrin's animations - follows the FNAF 1 band on its stage: upright and relaxed, shoulders
  down, upper arms hanging close to the body, soft elbows, the prop held in front of the body at chest or
  waist height, a free hand hanging open and slightly curled.
    Rustgrin    Freddy: mic upright in a loose fist in front of the chest (elbow ~ 90 deg), left arm down.
    Mirehop     Bonnie: the guitar across the body, left hand on the neck, right hand over the strings.
    Noxbriar    Chica: weight on her right leg (hip up), right hand resting on the hip, a head tilt, the
                left arm relaxed a little forward.
    The Cat     a dancer's version: weight on the left leg, left paw on the hip, the right arm relaxed.
    Purple Rat  both maracas held low in front at waist height, elbows bent, arms close to the body.
    Ringmaster  hand on his planted cane at his right side, the left hand at his lapel.
  Each character keeps its own hand grips on props and the little servo twitches of its supplied pose_1
  (head, finger rolls, maraca shakes); free hands take the relaxed open shape of the supplied idles.
* The Ringmaster keeps his cane in the walk (the supplied walk hides it); it is carried with its tip
  clear of the floor and the legs.

Hand targets (wrist / hand points, elbow positions, cane tip on the floor...) were solved against the
geometry with a small IK on the same bone maths as tools/render/bedrock_model.js (tools/entities/fk.py),
then checked with tools/entities/check_hands.mjs (no clipping, nothing under the floor) and the renderer
(tools/render/anim_sheet.mjs).
"""
import copy

# ------------------------------------------------------------------ helpers

def _keys(ch):
    """Keyframe dict of a channel (a static vector becomes {'0.0': v})."""
    if isinstance(ch, dict) and not ('pre' in ch or 'post' in ch):
        return ch
    return {'0.0': ch}


def _first(ch):
    """Value of a channel at its first keyframe."""
    ks = _keys(ch)
    v = ks[sorted(ks, key=float)[0]]
    return v.get('post', v.get('pre')) if isinstance(v, dict) else v


def offset(ch, d):
    """Add a constant [dx, dy, dz] to every keyframe of a rotation channel."""
    out = {}
    for k, v in _keys(ch).items():
        if isinstance(v, dict):
            nv = dict(v)
            for side in ('pre', 'post'):
                if side in nv:
                    nv[side] = [round(a + b, 3) for a, b in zip(nv[side], d)]
            out[k] = nv
        else:
            out[k] = [round(a + b, 3) for a, b in zip(v, d)]
    return out


def rebase(ch, base):
    """Keep a channel's motion (its keyframes relative to the first one) around a new base value."""
    v0 = _first(ch)
    return offset(ch, [b - a for a, b in zip(v0, base)])


def hold(v):
    return [round(x, 3) for x in v]


# ------------------------------------------------------------------ hand shapes
# The relaxed, open, slightly curled hand of the supplied idles (Golden Freddy's free hand). Finger curl is
# about z: + on the left hand, - on the right hand.
RELAXED = {'finger': 10.0, 'mid': 16.0, 'tip': 10.0, 'thumb': [5.0, 0.0, 5.0], 'thumb_tip': [4.0, 0.0, 0.0]}
# a slow servo finger roll in the pose loop (fingers 3, 2, 1 curl a little in turn and let go)
ROLL = {'start': 1.10, 'stagger': 0.07, 'mid': 14.0, 'tip': 12.0}


def relaxed_fingers(side, roll=True):
    sg = 1.0 if side == 'left' else -1.0
    out = {}
    for n in (1, 2, 3):
        base = {'': [0.0, 0.0, sg * RELAXED['finger']], '_mid': [0.0, 0.0, sg * RELAXED['mid']], '_tip': [0.0, 0.0, sg * RELAXED['tip']]}
        t0 = ROLL['start'] + (3 - n) * ROLL['stagger']
        for seg, v in base.items():
            bone = f'{side}_finger{n}{seg}'
            if not roll or seg == '':
                out[bone] = {'rotation': hold(v)}
                continue
            curl = ROLL['mid'] if seg == '_mid' else ROLL['tip']
            peak = [v[0], v[1], v[2] + sg * curl]
            out[bone] = {'rotation': {'0.0': hold(v), f'{t0:.2f}': hold(v), f'{t0 + 0.08:.2f}': hold(peak),
                                      f'{t0 + 0.18:.2f}': hold(peak), f'{t0 + 0.30:.2f}': hold(v), '2.0': hold(v)}}
    out[f'{side}_thumb'] = {'rotation': hold([RELAXED['thumb'][0], 0.0, sg * RELAXED['thumb'][2]])}
    out[f'{side}_thumb_tip'] = {'rotation': hold(RELAXED['thumb_tip'])}
    return out


def static_from(anims, cid, anim, bones):
    """Bone channels of another animation, frozen at its first keyframe."""
    B = anims[f'animation.fnar.{cid}.{anim}']['bones']
    out = {}
    for b in bones:
        if b in B:
            out[b] = {c: hold(_first(v)) for c, v in B[b].items() if c in ('rotation', 'position')}
    return out


LEG_BONES = ('waist', 'right_leg', 'right_shin', 'right_foot', 'left_leg', 'left_shin', 'left_foot')


def finger_bones(side):
    return [f'{side}_finger{n}{seg}' for n in (1, 2, 3) for seg in ('', '_mid', '_tip')] + [f'{side}_thumb', f'{side}_thumb_tip']


# ------------------------------------------------------------------ stances
# Relaxed contrapposto (Chica): the pelvis rolls 8 deg up over the standing leg, the thighs stay vertical
# (leg roll = -pelvis roll), the standing knee is almost straight, the free knee bends and steps forward;
# solved so both soles rest flat on the floor (hip drop and free-knee bend).
def contrapposto(stand, drop, k_free, roll=8.0, k_stand=6.0, step=6.0):
    free = 'left' if stand == 'right' else 'right'
    r = roll if stand == 'right' else -roll
    out = {'waist': {'rotation': [0.0, 0.0, r], 'position': [0.0, drop, 0.0]}}
    for side, k, st in ((stand, k_stand, 0.0), (free, k_free, step)):
        out[f'{side}_leg'] = {'rotation': hold([-k - st, 0.0, -r])}
        out[f'{side}_shin'] = {'rotation': hold([2 * k, 0.0, 0.0])}
        out[f'{side}_foot'] = {'rotation': hold([-k + st, 0.0, 0.0])}
    return out


# ------------------------------------------------------------------ the stage poses
# legs: 'idle' (the character's own relaxed idle stance) or a contrapposto() dict
# fingers per side: 'keep' (the supplied pose_1 grip on the prop, with its squeezes), 'relaxed', 'idle'
POSE1 = {
    # Freddy: mic upright in a loose fist in front of the chest, the left arm hanging, hand open
    'rustgrin': {
        'legs': 'idle', 'torso': [-2.0, 4.0, 0.0], 'head': [-4.0, 6.0, -3.0], 'jaw': [12.0, 0.0, 0.0], 'hat': [-3.0, 0.0, -4.0],
        # solved: wrist in front of the right chest (~ y 22.6, 8 px forward), elbow bent ~ 90 deg over the
        # forearm + upper-arm pitch, mic axis upright
        'right_arm': [-30.05, -14.5, -1.0], 'right_forearm': [-63.31, 0.0, 0.0], 'right_hand': [0.0, 0.0, 0.0],
        'left_arm': [-4.0, 0.0, -4.0], 'left_forearm': [-20.0, 0.0, 0.0], 'left_hand': [0.0, 0.0, 0.0],
        'fingers': {'right': 'keep', 'left': 'relaxed'},
    },
    # Bonnie: the guitar across the body - the supplied idle's playing hold (left hand on the neck, right
    # hand over the strings; arms and guitar both hang off the torso, so the hold is exact)
    'mirehop': {
        'legs': 'idle', 'torso': [2.0, 0.0, 2.0], 'head': [-6.0, -10.0, 6.0], 'jaw': [10.0, 0.0, 0.0],
        'arms_from': 'idle', 'fingers': {'right': 'idle', 'left': 'idle'},
    },
    # Chica: weight on the right leg, right hand resting on the hip (elbow out, the arm turned in so the
    # elbow bends towards the body), shoulders counter-tilted, head tilted, the left arm a little forward
    'noxbriar': {
        'legs': contrapposto('right', drop=-0.525, k_free=23.47), 'torso': [0.0, -6.0, -12.0], 'head': [4.0, 8.0, 10.0],
        'jaw': [6.0, 0.0, 0.0], 'hat': [-4.0, 0.0, 6.0],
        # solved: hand resting on the front of the hip, elbow out to the side (small arm twist, straight
        # wrist, so the 0.25 s controller cross-fades to the other states stay clear of the hip)
        'right_arm': [6.57, -39.94, 9.77], 'right_forearm': [-63.2, 0.0, 0.0], 'right_hand': [-0.03, 0.05, -10.18],
        'left_arm': [-10.0, 0.0, -6.0], 'left_forearm': [-28.0, 0.0, 0.0], 'left_hand': [0.0, 0.0, 0.0],
        'fingers': {'right': 'relaxed', 'left': 'relaxed'},
    },
    # the Cat: a dancer's stance - weight on the left leg, left paw on the hip, right arm relaxed
    'cat': {
        'legs': contrapposto('left', drop=-0.547, k_free=25.22), 'torso': [0.0, 6.0, 12.0], 'head': [4.0, -8.0, -10.0],
        'jaw': [10.0, 0.0, 0.0],
        # solved: paw on the side of the hip, elbow out and back (moderate arm twist, so the cross-fades to
        # the other states stay clear of the hip)
        'left_arm': [26.43, 37.19, -3.53], 'left_forearm': [-73.33, 0.0, 0.0], 'left_hand': [-0.03, -21.5, -10.47],
        'right_arm': [-6.0, 0.0, -3.0], 'right_forearm': [-22.0, 0.0, 0.0], 'right_hand': [0.0, 0.0, 0.0],
        'fingers': {'right': 'relaxed', 'left': 'relaxed'},
    },
    # the Purple Rat: both maracas low in front at waist height (heads tipped up and forward), elbows bent
    # ~ 60 deg and tucked in at the sides; the supplied little maraca shake stays on the hands
    'purple_rat': {
        'legs': 'idle', 'torso': [3.0, 0.0, 0.0], 'head': [-6.0, 8.0, -6.0],
        'right_arm': [-9.16, -17.39, 9.51], 'right_forearm': [-60.62, 0.0, 0.0], 'right_hand_base': [-2.54, 0.0, 0.0],
        'left_arm': [-14.24, 15.78, -9.36], 'left_forearm': [-56.19, 0.0, 0.0], 'left_hand_base': [-0.97, 0.0, 0.0],
        'fingers': {'right': 'keep', 'left': 'keep'},
    },
    # the Ringmaster: hand on the cane planted at his right side (tip on the floor 2 px outside the right
    # foot, ~ 4 deg off vertical), the left hand at his lapel
    'top_hat_rat': {
        'legs': 'idle', 'torso': [-2.0, -4.0, 0.0], 'head': [-4.0, 8.0, -4.0], 'hat': [-3.0, 0.0, -5.0],
        'right_arm': [0.47, 0.0, 17.3], 'right_forearm': [-29.96, 0.0, 0.0], 'right_hand': [0.0, 0.0, 0.0],
        'right_cane': [13.82, 4.479, -56.92],
        'left_arm': [-21.77, 8.66, -10.9], 'left_forearm': [-91.84, 0.0, 0.0], 'left_hand': [-40.42, 0.0, 34.17],
        'fingers': {'right': 'keep', 'left': 'keep'},
    },
}

ARM_BONES = ('right_arm', 'right_forearm', 'right_hand', 'left_arm', 'left_forearm', 'left_hand', 'right_cane')


def fix_pose1(cid, anims):
    P = POSE1.get(cid)
    if not P:
        return
    B = anims[f'animation.fnar.{cid}.pose_1']['bones']
    # stance
    legs = static_from(anims, cid, 'idle', LEG_BONES) if P['legs'] == 'idle' else copy.deepcopy(P['legs'])
    for b in LEG_BONES:
        B[b] = legs.get(b, {'rotation': [0.0, 0.0, 0.0]})
    # body: torso static, head / jaw keep their supplied motion around the new base
    B['torso'] = {'rotation': hold(P['torso'])}
    for b in ('head', 'jaw', 'hat'):
        if b in P:
            ch = B.get(b, {}).get('rotation')
            B[b] = {'rotation': rebase(ch, P[b]) if ch is not None else hold(P[b])}
    # arms
    if P.get('arms_from'):
        for b, ch in static_from(anims, cid, P['arms_from'], [x for x in ARM_BONES]).items():
            B[b] = ch
    for b in ARM_BONES:
        if b in P:
            B[b] = {'rotation': hold(P[b])}
    for side in ('right', 'left'):
        base = P.get(f'{side}_hand_base')
        if base is not None:
            ch = B.get(f'{side}_hand', {}).get('rotation', [0, 0, 0])
            B[f'{side}_hand'] = {'rotation': rebase(ch, base)}
    # fingers
    for side, shape in P['fingers'].items():
        if shape == 'relaxed':
            B.update(relaxed_fingers(side))
        elif shape == 'idle':
            B.update(static_from(anims, cid, 'idle', finger_bones(side)))


# ------------------------------------------------------------------ idle (also `stand`, the hallway pose)
# Same natural standing look as the stage poses: arms relaxed at the sides, never stuck out. Only the arm
# channels change; each idle keeps its timing and its own motions (head tilts, finger rolls, shakes).
IDLE = {
    # A-pose arms (rolled out ~ 17 deg, elbows straight) brought in a little, elbows softened
    'rustgrin': {'right_arm': [-3.0, 0.0, -5.0], 'right_forearm': [-18.0, 0.0, 0.0], 'left_arm': [-3.0, 0.0, 5.0], 'left_forearm': [-16.0, 0.0, 0.0]},
    # (her left arm keeps no forward pitch: her supplied malfunction head tilt rests on that shoulder)
    'noxbriar': {'right_arm': [-3.0, 0.0, -6.0], 'right_forearm': [-16.0, 0.0, 0.0], 'left_arm': [0.0, 0.0, 4.0], 'left_forearm': [-16.0, 0.0, 0.0]},
    # the maracas held low in front like the stage pose (they were held out at the sides), shake kept
    'purple_rat': {'right_arm': POSE1['purple_rat']['right_arm'], 'right_forearm': POSE1['purple_rat']['right_forearm'],
                   'right_hand_base': POSE1['purple_rat']['right_hand_base'],
                   'left_arm': POSE1['purple_rat']['left_arm'], 'left_forearm': POSE1['purple_rat']['left_forearm'],
                   'left_hand_base': POSE1['purple_rat']['left_hand_base']},
    # the Cat's paw-licking moment (1.6 - 2.8 s): the paw still comes up to the mouth, but with the elbow
    # tucked in front of the chest instead of flared out sideways (solved: paw at the mouth, no clipping)
    'cat': {'groom': {'window': (1.6, 2.78),
                      'right_arm': ([-67.1, -2.1, 55.75], [-82.16, -8.0, 50.0]),
                      'right_forearm': ([-93.36, 0.0, 0.0], [-75.0, 0.0, 0.0]),
                      'right_hand': ([0.0, 0.0, 0.0], [-18.62, 0.0, 0.0])}},
}


def _sample(ch, t):
    ks = _keys(ch)
    times = sorted(ks, key=float)

    def val(k):
        v = ks[k]
        return v.get('post', v.get('pre')) if isinstance(v, dict) else v
    if t <= float(times[0]):
        return val(times[0])
    if t >= float(times[-1]):
        return val(times[-1])
    for a, b in zip(times, times[1:]):
        if float(a) <= t <= float(b):
            f = (t - float(a)) / (float(b) - float(a))
            return [x + (y - x) * f for x, y in zip(val(a), val(b))]


def _retarget_window(ch, window, old_hold, new_hold):
    """Inside the time window (exclusive) every key moves by (new_hold - old_hold), keeping the gesture's
    overshoots and flicks; keys are added at the window edges so nothing outside it changes."""
    t0, t1 = window
    d = [n - o for o, n in zip(old_hold, new_hold)]
    ks = dict(_keys(ch))
    for t in (t0, t1):
        if not any(abs(float(k) - t) < 1e-6 for k in ks):
            ks[f'{t:.2f}'] = hold(_sample(ch, t))
    out = {}
    for k in sorted(ks, key=float):
        v = ks[k]
        if t0 + 1e-6 < float(k) < t1 - 1e-6:
            val = v.get('post', v.get('pre')) if isinstance(v, dict) else v
            nv = [round(a + b, 3) for a, b in zip(val, d)]
            v = nv if not isinstance(v, dict) else {**v, **{s: nv for s in ('pre', 'post') if s in v}}
        out[k] = v
    return out


def fix_idle(cid, anims):
    P = IDLE.get(cid)
    if not P:
        return
    B = anims[f'animation.fnar.{cid}.idle']['bones']
    for b in ('right_arm', 'right_forearm', 'left_arm', 'left_forearm'):
        if b in P:
            B[b] = {'rotation': hold(P[b])}
    for side in ('right', 'left'):
        base = P.get(f'{side}_hand_base')
        if base is not None:
            ch = B.get(f'{side}_hand', {}).get('rotation', [0, 0, 0])
            B[f'{side}_hand'] = {'rotation': rebase(ch, base)}
    groom = P.get('groom')
    if groom:
        for b, spec in groom.items():
            if b == 'window':
                continue
            B[b]['rotation'] = _retarget_window(B[b]['rotation'], groom['window'], *spec)


# ------------------------------------------------------------------ the Ringmaster's walk: keep the cane
# The supplied walk hides the cane (scale 0); on the final night he walks the halls with it. It is carried
# in a firm grip at a fixed angle (so it swings with the arm), tip forward and down in the plane of the
# body, the elbow bent to carry it: solved so the tip stays >= 1.2 px above the floor over the whole cycle,
# points forward at every frame and never touches the legs, tail or body (tools/entities/check_hands.mjs).
WALK_CANE = {'right_cane': [20.0, 4.479, -22.0], 'right_forearm': [-55.0, 0.0, 0.0]}
# the cane hand's fingers: the closed grip of his idle (instead of the walk's curl-and-relax swing)
CANE_GRIP = {'finger': [0.0, 0.0, -10.0], 'finger_mid': [0.0, 0.0, -30.0], 'finger_tip': [0.0, 0.0, -60.0],
             'thumb': [-50.0, 0.0, 10.0], 'thumb_tip': [28.0, 0.0, 0.0]}


def fix_walk_cane(cid, anims):
    if cid != 'top_hat_rat':
        return
    B = anims[f'animation.fnar.{cid}.walk']['bones']
    B['right_cane'] = {'rotation': hold(WALK_CANE['right_cane'])}
    B['right_forearm'] = {'rotation': hold(WALK_CANE['right_forearm'])}
    for n in (1, 2, 3):
        B[f'right_finger{n}'] = {'rotation': hold(CANE_GRIP['finger'])}
        B[f'right_finger{n}_mid'] = {'rotation': hold(CANE_GRIP['finger_mid'])}
        B[f'right_finger{n}_tip'] = {'rotation': hold(CANE_GRIP['finger_tip'])}
    B['right_thumb'] = {'rotation': hold(CANE_GRIP['thumb'])}
    B['right_thumb_tip'] = {'rotation': hold(CANE_GRIP['thumb_tip'])}


def apply(cid, anims, anims_rust=None):
    """Mutates anims (renamed animation dict of one character)."""
    fix_pose1(cid, anims)
    fix_idle(cid, anims)
    fix_walk_cane(cid, anims)
