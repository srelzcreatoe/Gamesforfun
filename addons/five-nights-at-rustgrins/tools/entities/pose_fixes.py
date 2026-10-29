"""Pose and hand corrections layered on top of the supplied animations (applied by build_entities.py).

The supplied animations (assets/source_models) stay untouched; this module edits the renamed copies
(animation.fnar.<id>.<name>) before they are written to packs/RP/animations. Animation names, lengths
and loop modes are never changed.

* pose_1 of the Cat, the Purple Rat and the Ringmaster is rebuilt from Rustgrin's pose_1 (the band's
  stage pose): upright, weight centred, torso turned a little, the prop hand raised to the chest and the
  free arm out in a relaxed "presenting" gesture. Bone rotations are carried over through each skeleton's
  own rest pose (the arms have a different rest roll per model), so the limbs end up oriented the same
  relative to the torso. Each character keeps its own fingers (hand shapes, finger rolls), legs, tail and
  ears from its supplied pose_1.
* The Ringmaster keeps his cane in the walk (the supplied walk hides it); it is carried with its tip
  clear of the floor and the legs.

Values that place props (cane tip on the floor, maraca clear of the snout...) were solved against the
geometry with tools/entities/check_hands.mjs and the renderer (tools/render/anim_sheet.mjs).
"""
import copy

# ------------------------------------------------------------------ helpers

def _keys(ch):
    """Keyframe dict of a channel (a static vector becomes {'0.0': v})."""
    if isinstance(ch, dict) and not ('pre' in ch or 'post' in ch):
        return ch
    return {'0.0': ch}


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


def hold(v):
    return [round(x, 3) for x in v]


def remap_arm(rot, src_rest_z, dst_rest_z):
    """An upper-arm rotation authored for a skeleton whose arm rests at roll src_rest_z, re-targeted to
    one resting at dst_rest_z (rest + animation is what Bedrock rotates by, so keep the sum)."""
    x, y, z = rot
    return [round(x, 3), round(y, 3), round(z + src_rest_z - dst_rest_z, 3)]


# ------------------------------------------------------------------ Rustgrin's stage pose (reference)
# (from animation.rustgrin.pose_1; his arms rest at roll +-17 deg). The per-character values in POSE1 start
# from these: the presenting arm is his left arm as is (re-targeted), the prop arm is lowered a little and
# turned in less (a maraca / a paw at the chest instead of a mic at the mouth), and the forearm bends are
# eased a few degrees for the shorter upper arms of the Cat and the rats.
RUST_REST_Z = 17.0
RUST = {
    'right_arm': [-26.48, -22.29, 22.82], 'right_forearm': [-113.32, 0.0, 0.0],
    'left_arm': [21.47, 3.77, -62.52], 'left_forearm': [-109.79, 0.0, 0.0],
    'torso': [-4.0, 8.0, 0.0],
}


def rust_head(anims_rust):
    """Rustgrin's pose_1 head channel (a small servo twitch at 1.2 s, in time with the finger rolls)."""
    return copy.deepcopy(anims_rust['animation.fnar.rustgrin.pose_1']['bones']['head']['rotation'])


# per-character tuning on top of the re-targeted reference
# arm rest roll of each skeleton (geometry bone rotation z of right_arm; left is the negative)
REST_Z = {'cat': 9.5, 'purple_rat': 8.5, 'top_hat_rat': 10.0}

POSE1 = {
    # The Cat: paw raised to the chest like Rustgrin's mic hand, the other paw out, presenting.
    'cat': {
        'right_arm': [-22.0, -18.0, 25.0], 'right_forearm': [-108.0, 0.0, 0.0], 'right_hand': [0.0, 0.0, 0.0],
        'left_arm': [21.47, 3.77, -62.52], 'left_forearm': [-105.0, 0.0, 0.0], 'left_hand': [0.0, 0.0, 0.0],
        'remap': ('right_arm', 'left_arm'),
        # the presenting paw opens up (its supplied claw curl, finger roll kept on top)
        'finger_offset': {'left': {'mid': [0.0, 0.0, -28.0], 'tip': [0.0, 0.0, -30.0]}},
    },
    # The Purple Rat: one maraca held up at the chest, the other out to the side at shoulder height.
    'purple_rat': {
        'right_arm': [-22.0, -14.0, 25.0], 'right_forearm': [-100.0, 0.0, 0.0], 'right_hand_base': [25.0, 0.0, 0.0],
        'left_arm': [21.47, 3.77, -62.52], 'left_forearm': [-105.0, 0.0, 0.0], 'left_hand_base': [0.0, 0.0, 0.0],
        'remap': ('right_arm', 'left_arm'),
    },
    # The Ringmaster: hand on his planted cane (as in his idle), the other arm presenting.
    'top_hat_rat': {
        # solved so the cane stands ~2 deg off vertical, tip on the floor just outside the right foot
        'right_arm': [-8.3, 0.0, 6.66], 'right_forearm': [-30.0, 0.0, 0.0], 'right_hand': [0.0, 0.0, 0.0],
        'right_cane': [43.28, 4.479, -31.09],
        'left_arm': [21.47, 3.77, -62.52], 'left_forearm': [-105.0, 0.0, 0.0], 'left_hand': [0.0, 0.0, 0.0],
        'hat': [-4.0, 0.0, -6.0],
        'remap': ('left_arm',),
    },
}


def fix_pose1(cid, anims, anims_rust):
    P = POSE1.get(cid)
    if not P:
        return
    a = anims[f'animation.fnar.{cid}.pose_1']
    B = a['bones']
    rest = REST_Z[cid]
    for bone in ('right_arm', 'right_forearm', 'left_arm', 'left_forearm', 'right_hand', 'left_hand', 'right_cane', 'hat'):
        if bone not in P:
            continue
        v = P[bone]
        if bone in P.get('remap', ()):
            src = RUST_REST_Z if bone.startswith('right') else -RUST_REST_Z
            dst = rest if bone.startswith('right') else -rest
            v = remap_arm(v, src, dst)
        B.setdefault(bone, {})['rotation'] = hold(v)
        if bone == 'hat':
            B[bone].pop('position', None)
    # hands that shake (maracas) keep their keyframes, offset by a wrist base angle
    for side in ('right', 'left'):
        base = P.get(f'{side}_hand_base')
        if base is not None:
            ch = B.get(f'{side}_hand', {}).get('rotation', [0, 0, 0])
            B.setdefault(f'{side}_hand', {})['rotation'] = offset(ch, base)
    for side, offs in P.get('finger_offset', {}).items():
        for n in (1, 2, 3):
            for seg, d in offs.items():
                bone = f'{side}_finger{n}_{seg}'
                if bone in B and 'rotation' in B[bone]:
                    B[bone]['rotation'] = offset(B[bone]['rotation'], d)
    B['torso'] = {'rotation': hold(RUST['torso'])}
    B['head'] = {'rotation': rust_head(anims_rust)}


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


def apply(cid, anims, anims_rust):
    """Mutates anims (renamed animation dict of one character)."""
    fix_pose1(cid, anims, anims_rust)
    fix_walk_cane(cid, anims)
