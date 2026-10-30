#!/usr/bin/env python3
"""Author The Observer's supplemental animations for the supplied rig.

The supplied pack has idle, pose, staring, running and attack. The Observer's
stalking behaviour also needs:

  animation.observer.stalk_walk      slow, deliberate stride (loop 1.6 s)
  animation.observer.peek            lean out from cover; side from q.property('observer:side')
  animation.observer.recoil          flinch when witnessed / struck (once, 1.0 s)
  animation.observer.stoop           additive crouch overlay so the 4-block figure fits 3-block spaces
  animation.observer.look_at_target  head tracking (vanilla-style target rotation queries)
  animation.observer.float_drift     1.0.6: hovering a block up, legs hanging limp, toes down, nearly still —
                                     1.0.7: and cracking: one-frame snaps of the neck, a shoulder, the whole body
  animation.observer.float_surge     1.0.6: rushing forward through the air, leaning in, arms and legs trailing
  animation.observer.climb           1.0.6: climbing a wall face, arms reaching overhead in turn, its head
                                     tipped right back, staring up at whoever it is climbing after

The floating clips lift the whole figure 1 block (root position); under a low ceiling
(q.property('observer:stoop')) the lift drops to nothing so its head stays inside 3-block spaces.

All supplied clips are left untouched. Keyframes use only bones that exist in
the supplied geometry. Root height for walk/stoop is solved with forward
kinematics (tools/render_model.py) so the lowest foot rests on y = 0.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_model import Model  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "packs", "TheObserver_RP")
GEO = os.path.join(RP, "models", "entity", "the_observer.geo.json")
TEX = os.path.join(RP, "textures", "entity", "observer", "the_observer.png")
OUT = os.path.join(RP, "animations", "the_observer_supplemental.animation.json")

FINGERS = {
    # gentle constant curl copied from the supplied idle clip's first frame
    "right_finger_0": [3.8, 0, 0], "right_finger_0_tip": [6.8, 0, 0],
    "right_finger_1": [3.8, 0, 0], "right_finger_1_tip": [6.8, 0, 0],
    "right_finger_2": [3.8, 0, 0], "right_finger_2_tip": [6.8, 0, 0],
    "right_finger_3": [3.8, 0, 0], "right_finger_3_tip": [6.8, 0, 0],
    "right_thumb": [6, 0, -5], "right_thumb_tip": [9, 0, 0],
    "left_finger_0": [4.2, 0, 0], "left_finger_0_tip": [7.2, 0, 0],
    "left_finger_1": [4.2, 0, 0], "left_finger_1_tip": [7.2, 0, 0],
    "left_finger_2": [4.2, 0, 0], "left_finger_2_tip": [7.2, 0, 0],
    "left_finger_3": [4.2, 0, 0], "left_finger_3_tip": [7.2, 0, 0],
    "left_thumb": [6, 0, 5], "left_thumb_tip": [9, 0, 0],
}


def r(v, n=3):
    return [round(float(x), n) for x in v]


def key(t):
    return f"{t:.2f}".rstrip("0").rstrip(".") if t else "0.0"


def foot_floor(model, pose_bones):
    """Return lowest y (model units) of all geometry for a static pose (rotations only)."""
    anim = {"animation_length": 1, "bones": {b: {"rotation": v} for b, v in pose_bones.items()}}
    lo, _ = model.extent([(anim, 0.0)])
    return lo[1]


def stalk_walk(model):
    length, step = 1.6, 0.05
    bones = {}

    def put(b, ch, t, v):
        bones.setdefault(b, {}).setdefault(ch, {})[key(t)] = r(v)

    n = int(round(length / step))
    for i in range(n + 1):
        t = i * step
        ph = 2 * math.pi * t / length
        s, c = math.sin(ph), math.cos(ph)
        pose = {}
        rt = -24 * s                      # right thigh: negative = forward
        lt = 24 * s
        rs = 6 + 36 * max(0.0, c) ** 2    # knee bends while the leg swings forward
        ls = 6 + 36 * max(0.0, -c) ** 2
        rf = -0.45 * rs - 0.25 * rt       # keep the sole roughly level
        lf = -0.45 * ls - 0.25 * lt
        pose.update({
            "right_thigh": [rt, 0, 0], "left_thigh": [lt, 0, 0],
            "right_shin": [rs, 0, 0], "left_shin": [ls, 0, 0],
            "right_foot": [rf, 0, 0], "left_foot": [lf, 0, 0],
            "pelvis": [0, -3 * s, 0],
            "torso": [6 + 1.0 * abs(s), 3.5 * s, 0.8 * c],
            "head": [3, -3.0 * s, -2.5],
            "right_upper_arm": [9 * s, 0, 0], "left_upper_arm": [-9 * s, 0, 0],
            "right_forearm": [-6 - 4 * max(0.0, -s), 0, 0], "left_forearm": [-6 - 4 * max(0.0, s), 0, 0],
            "right_hand": [3, 0, 0], "left_hand": [3, 0, 0],
        })
        floor = foot_floor(model, pose)
        for b, v in pose.items():
            put(b, "rotation", t, v)
        put("root", "position", t, [0, -floor, 0])
    for b, v in FINGERS.items():
        bones[b] = {"rotation": {"0.0": v}}
    return {"loop": True, "animation_length": length, "bones": bones}


def peek():
    side = "q.property('observer:side')"

    def ease(v):
        return {"0.0": [0, 0, 0], "0.25": [f"{v[0] * 0.6:.2f}", f"{v[1] * 0.6:.2f} * {side}", f"{v[2] * 0.6:.2f} * {side}"],
                "0.6": [f"{v[0]:.2f}", f"{v[1]:.2f} * {side}", f"{v[2]:.2f} * {side}"]}

    bones = {
        "pelvis": {"rotation": ease([0, 0, 5])},
        "torso": {"rotation": ease([7, 8, 17])},
        "head": {"rotation": ease([6, 14, 18])},
        "right_upper_arm": {"rotation": {"0.0": [0, 0, 0], "0.6": [-6, 0, 0]}},
        "left_upper_arm": {"rotation": {"0.0": [0, 0, 0], "0.6": [-6, 0, 0]}},
        "right_forearm": {"rotation": {"0.0": [0, 0, 0], "0.6": [-10, 0, 0]}},
        "left_forearm": {"rotation": {"0.0": [0, 0, 0], "0.6": [-10, 0, 0]}},
    }
    bones.update({b: {"rotation": {"0.0": v}} for b, v in FINGERS.items()})
    return {"loop": "hold_on_last_frame", "animation_length": 0.6, "bones": bones}


def recoil():
    bones = {
        "torso": {"rotation": {"0.0": [0, 0, 0], "0.12": [-13, 4, -3], "0.45": [-8, 2, -2], "1.0": [2, 0, 0]}},
        "head": {"rotation": {"0.0": [0, 0, 0], "0.1": [-20, -8, 9], "0.5": [-10, -4, 12], "1.0": [6, 0, 6]}},
        "right_upper_arm": {"rotation": {"0.0": [0, 0, 0], "0.12": [-38, 0, 14], "0.5": [-24, 0, 10], "1.0": [-4, 0, 0]}},
        "left_upper_arm": {"rotation": {"0.0": [0, 0, 0], "0.12": [-38, 0, -14], "0.5": [-24, 0, -10], "1.0": [-4, 0, 0]}},
        "right_forearm": {"rotation": {"0.0": [0, 0, 0], "0.12": [-62, 0, 0], "0.5": [-45, 0, 0], "1.0": [-8, 0, 0]}},
        "left_forearm": {"rotation": {"0.0": [0, 0, 0], "0.12": [-62, 0, 0], "0.5": [-45, 0, 0], "1.0": [-8, 0, 0]}},
        "right_hand": {"rotation": {"0.0": [0, 0, 0], "0.12": [-14, 0, 0], "1.0": [2, 0, 0]}},
        "left_hand": {"rotation": {"0.0": [0, 0, 0], "0.12": [-14, 0, 0], "1.0": [2, 0, 0]}},
        "right_thigh": {"rotation": {"0.0": [0, 0, 0], "0.12": [8, 0, 0], "1.0": [0, 0, 0]}},
        "right_shin": {"rotation": {"0.0": [0, 0, 0], "0.12": [10, 0, 0], "1.0": [0, 0, 0]}},
    }
    for b, v in FINGERS.items():
        spread = [v[0] * 0.3, v[1], v[2]]
        bones[b] = {"rotation": {"0.0": v, "0.12": r(spread), "1.0": v}}
    return {"animation_length": 1.0, "bones": bones}


def stoop(model):
    pose = {
        "right_thigh": [-62, 0, 0], "left_thigh": [-62, 0, 0],
        "right_shin": [104, 0, 0], "left_shin": [104, 0, 0],
        "right_foot": [-42, 0, 0], "left_foot": [-42, 0, 0],
        "torso": [55, 0, 0],
        "head": [-46, 0, 0],
        "right_upper_arm": [-44, 0, 4], "left_upper_arm": [-44, 0, -4],
        "right_forearm": [-14, 0, 0], "left_forearm": [-14, 0, 0],
    }
    floor = foot_floor(model, pose)
    bones = {b: {"rotation": r(v)} for b, v in pose.items()}
    bones["root"] = {"position": r([0, -floor, 0])}
    return {"loop": True, "animation_length": 1.0, "bones": bones}


LIFT = "16 * (1 - q.property('observer:stoop'))"


def _loop(length, step, pose_fn):
    """Sample pose_fn(phase) -> (bone rotations, root position) into keyframes over one loop."""
    bones = {}
    n = int(round(length / step))
    for i in range(n + 1):
        t = i * step
        ph = 2 * math.pi * t / length
        pose, root = pose_fn(ph)
        for b, v in pose.items():
            bones.setdefault(b, {}).setdefault("rotation", {})[key(t)] = r(v)
        bones.setdefault("root", {}).setdefault("position", {})[key(t)] = root
    return bones


# Twitches of the drift: (start s, hold s, {bone: added rotation}, root drop px). Each snaps in within one
# 0.05 s frame, holds, and snaps back — cracking joints, the way the girl from The Ring moves.
DRIFT_TWITCHES = [
    (0.55, 0.45, {"head": [4, -12, 28]}, 0.0),                                      # neck cracks to the side
    (1.05, 0.05, {"head": [0, 0, 7]}, 0.0),                                         # ...and an aftershock
    (1.60, 0.25, {"right_upper_arm": [-14, 0, -10], "right_forearm": [-18, 0, 0], "torso": [0, 4, -3]}, 0.0),  # shoulder hitch
    (2.30, 0.15, {"torso": [9, 0, 0], "head": [14, 0, 0], "pelvis": [4, 0, 0]}, 1.5),  # the whole body jerks and drops
    (3.10, 0.60, {"head": [-8, 35, -6]}, 0.0),                                      # the head whips round and holds
    (3.95, 0.10, {"left_forearm": [-20, 0, 0], "left_hand": [25, 0, 0], "left_thigh": [6, 0, 0]}, 0.0),  # a spasm
]
DRIFT_LENGTH = 4.8


def _twitch(t):
    """Summed twitch rotations and root drop at time t (0 outside, 1 during the hold, one-frame snaps)."""
    rot, drop = {}, 0.0
    for start, hold, bones, d in DRIFT_TWITCHES:
        if t < start - 1e-6 or t > start + hold + 0.05 + 1e-6:
            continue
        k = 1.0 if t <= start + hold + 1e-6 else 0.0
        if t < start + 0.05 - 1e-6:
            k = (t - start) / 0.05
        for b, v in bones.items():
            cur = rot.setdefault(b, [0.0, 0.0, 0.0])
            for n in range(3):
                cur[n] += v[n] * k
        drop += d * k
    return rot, drop


def float_drift():
    """Hovering a block up, nearly still: no sway to speak of, only the slightest bob — and every so often a
    joint cracks: the neck snaps sideways, a shoulder hitches, the body jerks, the head whips round. Each
    snap is one frame and holds; a bone-crack sound is keyed to the big ones."""
    def pose(ph):
        s, c = math.sin(ph), math.cos(ph)
        t = ph / (2 * math.pi) * DRIFT_LENGTH
        base = {
            "pelvis": [0, 0.6 * math.sin(ph / 2), 0.4 * c],
            "torso": [3 + 0.6 * math.sin(ph + 0.6), 0.8 * math.sin(ph / 2), 0.5 * c],
            "head": [6, 0, 2],
            "right_upper_arm": [3 + 1.2 * math.sin(ph + 0.4), 0, -5], "left_upper_arm": [3 + 1.2 * math.sin(ph + 1.1), 0, 5],
            "right_forearm": [-5, 0, 0], "left_forearm": [-5, 0, 0],
            "right_hand": [6, 0, 0], "left_hand": [6, 0, 0],
            # legs hang limp, toes pointing at the ground
            "right_thigh": [-3 + 1.5 * math.sin(ph + 0.9), 0, 2], "left_thigh": [-1 + 1.5 * math.sin(ph + 2.1), 0, -2],
            "right_shin": [10 + 2 * math.sin(ph + 1.5), 0, 0], "left_shin": [8 + 2 * math.sin(ph + 2.6), 0, 0],
            "right_foot": [26, 0, 0], "left_foot": [26, 0, 0],
        }
        tw, drop = _twitch(t)
        for b, v in tw.items():
            base[b] = [base.get(b, [0, 0, 0])[n] + v[n] for n in range(3)]
        return base, [0, f"{LIFT} + {0.5 * s - drop:.3f}", 0]

    bones = _loop(DRIFT_LENGTH, 0.05, pose)
    for b, v in FINGERS.items():
        # the fingers curl tight for a moment when the body jerks
        bones[b] = {"rotation": {"0.0": [v[0] * 0.5, v[1], v[2]], "2.3": [v[0] * 0.5, v[1], v[2]],
                                 "2.35": [v[0] * 2.2, v[1], v[2]], "2.5": [v[0] * 2.2, v[1], v[2]], "2.55": [v[0] * 0.5, v[1], v[2]]}}
    sounds = {key(st): {"effect": "crack"} for st, _, _, _ in DRIFT_TWITCHES if st not in (1.05, 3.95)}
    return {"loop": True, "animation_length": DRIFT_LENGTH, "bones": bones, "sound_effects": sounds}


def float_surge():
    """Rushing at you through the air: pitched forward from the hips, head up and fixed on you,
    arms and legs streaming out behind."""
    def pose(ph):
        s = math.sin(ph)
        return {
            "pelvis": [12, 0, 0],
            "torso": [36 + 3 * s, 0, 2 * math.sin(ph + 0.7)],
            "head": [-34 - 2 * s, 0, 0],
            "right_upper_arm": [58 + 8 * math.sin(ph + 0.3), 0, -12], "left_upper_arm": [58 + 8 * math.sin(ph + 1.2), 0, 12],
            "right_forearm": [-10 + 6 * math.sin(ph + 0.9), 0, 0], "left_forearm": [-10 + 6 * math.sin(ph + 1.8), 0, 0],
            "right_hand": [12, 0, 0], "left_hand": [12, 0, 0],
            "right_thigh": [30 + 6 * math.sin(ph + 0.5), 0, 4], "left_thigh": [26 + 6 * math.sin(ph + 1.9), 0, -4],
            "right_shin": [34 + 8 * math.sin(ph + 1.1), 0, 0], "left_shin": [30 + 8 * math.sin(ph + 2.5), 0, 0],
            "right_foot": [38, 0, 0], "left_foot": [38, 0, 0],
        }, [0, f"{LIFT} + {2 + 1.0 * s:.3f}", 0]

    bones = _loop(1.2, 0.05, pose)
    for b, v in FINGERS.items():
        bones[b] = {"rotation": {"0.0": [v[0] * 0.3, v[1], v[2]]}}
    return {"loop": True, "animation_length": 1.2, "bones": bones}


def climb():
    """Clinging to a wall in front of it and hauling itself up hand over hand, knees drawn up in turn.
    The head is tipped right back: it stares straight up at whoever it is climbing after."""
    def pose(ph):
        s, c = math.sin(ph), math.cos(ph)
        return {
            "pelvis": [0, 0, 2 * s],
            "torso": [12, 4 * s, 3 * s],
            "head": [-58 + 4 * math.sin(2 * ph), 6 * s, 0],
            "right_upper_arm": [-150 - 24 * s, 0, -6], "left_upper_arm": [-150 + 24 * s, 0, 6],
            "right_forearm": [-22 + 22 * c, 0, 0], "left_forearm": [-22 - 22 * c, 0, 0],
            "right_hand": [-10, 0, 0], "left_hand": [-10, 0, 0],
            "right_thigh": [-42 - 22 * s, 0, 6], "left_thigh": [-42 + 22 * s, 0, -6],
            "right_shin": [68 + 22 * s, 0, 0], "left_shin": [68 - 22 * s, 0, 0],
            "right_foot": [-24, 0, 0], "left_foot": [-24, 0, 0],
        }, [0, f"{1.5 * math.sin(2 * ph):.3f}", 0]

    bones = _loop(1.0, 0.05, pose)
    for b, v in FINGERS.items():
        bones[b] = {"rotation": {"0.0": [v[0] * 1.4, v[1], v[2]]}}
    return {"loop": True, "animation_length": 1.0, "bones": bones}


def look_at_target():
    return {"loop": True, "bones": {"head": {"rotation": ["query.target_x_rotation", "query.target_y_rotation", 0]}}}


def main():
    model = Model(GEO, TEX)
    data = {"format_version": "1.8.0", "animations": {
        "animation.observer.stalk_walk": stalk_walk(model),
        "animation.observer.peek": peek(),
        "animation.observer.recoil": recoil(),
        "animation.observer.stoop": stoop(model),
        "animation.observer.look_at_target": look_at_target(),
        "animation.observer.float_drift": float_drift(),
        "animation.observer.float_surge": float_surge(),
        "animation.observer.climb": climb(),
    }}
    bones = set(model.bones)
    for name, a in data["animations"].items():
        missing = set(a["bones"]) - bones
        assert not missing, (name, missing)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, "w"), indent=1)
    print("wrote", OUT, {k: len(v["bones"]) for k, v in data["animations"].items()})


if __name__ == "__main__":
    main()
