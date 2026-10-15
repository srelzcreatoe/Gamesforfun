"""Two animatronics from the "night stage" reference pictures:

  party_cat     golden cat with dark patches, striped party hat with a pom-pom, red collar
                with a gold bell, thick striped tail
  rat           dark grey rat with a red fez, whiskers, pink tongue, red bow tie, two
                buttons, a long pink tail and a microphone

They are built from the shared voxel frame in body.py.  (The monkey that used to live
here as "spiral_bear" is in cast.py.)
"""
import math
import os

import numpy as np

from characters.body import (COMMON, build_arms, build_bowtie, build_head, build_legs, build_neck, build_tail,
                             build_torso, frame_painter, lengthen, p_bell, p_chrome, p_mic_head, stripes_painter, vox)
from characters.night import NightClips, ease, flip, window
from fnafkit import export
from fnafkit.anim import S, TAU, cs, flat_foot, pos, setr, sn, torso_goal
from fnafkit.rig import bone, cube
from fnafkit.servo import add_rot, meta, stepper

HERE = os.path.dirname(os.path.abspath(__file__))


MATERIALS = {
    "party_cat": {
        **COMMON,
        "fur": vox((158, 98, 36), (172, 110, 42), (184, 120, 48), (198, 132, 56), (144, 86, 30),
                   w=[2, 3, 3, 2, 2], patches=[(3.4, 0.67, [(98, 56, 22), (110, 64, 26), (90, 50, 18)])]),
        "fur_dark": vox((112, 66, 26), (124, 74, 30), (100, 58, 22)),
        "tan": vox((176, 140, 104), (188, 152, 114), (198, 162, 124), (166, 130, 96),
                   spots=[((140, 104, 74), 0.05)]),
        "muzzle": vox((186, 150, 112), (198, 162, 122), (208, 172, 132), spots=[((160, 124, 90), 0.05)]),
        "ear_dark": vox((66, 42, 27), (76, 49, 31), (58, 36, 23)),
        "hat_red": vox((150, 26, 30), (166, 32, 36), (178, 40, 42)),
        "hat_cream": vox((214, 198, 182), (224, 210, 194), (204, 188, 172)),
        "pompom": vox((140, 16, 22), (158, 22, 28), (124, 12, 18), (170, 30, 36), cell=0.5, bevel=0.3),
        "red": vox((130, 22, 24), (146, 28, 30), (118, 18, 20)),
        "gold": vox((176, 136, 52), (196, 156, 64), (212, 174, 82), (160, 120, 44), cell=0.5, bevel=0.22),
        "tail_light": vox((196, 108, 44), (210, 122, 52), (184, 98, 38)),
        "tail_dark": vox((96, 52, 22), (108, 60, 26), (86, 46, 18)),
        "sole": vox((186, 160, 132), (198, 172, 144), (176, 150, 122)),
    },
    "rat": {
        **COMMON,
        "fur": vox((52, 49, 52), (60, 57, 60), (70, 66, 69), (80, 76, 79), (44, 41, 44),
                   w=[2, 3, 3, 2, 2], patches=[(2.0, 0.7, [(38, 36, 39), (42, 40, 43)])]),
        "fur_dark": vox((50, 47, 50), (58, 54, 57), (66, 62, 64)),
        "tan": vox((128, 122, 121), (140, 134, 133), (152, 146, 145), (118, 112, 111),
                   patches=[(1.8, 0.8, [(106, 100, 99)])]),
        "muzzle": vox((158, 152, 150), (170, 164, 162), (182, 176, 174), spots=[((136, 130, 128), 0.05)]),
        "ear_dark": vox((54, 50, 53), (62, 58, 61), (70, 66, 68)),
        "ear_red": vox((108, 58, 62), (120, 66, 70), (132, 74, 78), (98, 52, 56)),
        "hat_red": vox((132, 26, 28), (148, 32, 34), (162, 40, 42), (120, 22, 24)),
        "red": vox((146, 30, 32), (162, 36, 38), (176, 44, 46)),
        "pink": vox((190, 104, 112), (204, 116, 124), (176, 94, 102), cell=0.5),
        "pink_dark": vox((150, 74, 82), (162, 82, 90), cell=0.5),
        "tongue": vox((176, 92, 96), (190, 104, 108), (164, 82, 86), cell=0.5),
        "whisker": vox((12, 12, 14), (18, 18, 20), cell=0.3, bevel=0.0),
        "sole": vox((170, 166, 166), (184, 180, 180), (160, 156, 156)),
    },
}

# --------------------------------------------------------------------------
# Per-character measurements (model pixels; one texture cell = one pixel), taken from
# each reference picture separately
# --------------------------------------------------------------------------

CH = {
    # chunky: wide head and chest, belt-like pelvis band, short curled fingers, stepped toes
    "party_cat": dict(
        leg_c=3.8, foot_off=0.9, foot_hw=4.2, sole=0.9, toe_top=3.5, heel_top=4.9,
        ankle=(4.7, 6.0), shin=(5.8, 13.2), knee=(13.0, 14.7), thigh=(14.5, 23.0), shin_w=6.2, thigh_w=6.6,
        pelvis=(22.4, 24.8), pelvis_hw=6.3, torso=(24.6, 35.2), half_w=5.9, torso_d=4.5,
        head_pivot=36.0, head_half=6.5, face_z=-5.2, back=5.1, top=47.4,
        jaw=(34.6, 36.4), snout=(36.6, 39.8), snout_z=-7.8, muzzle_hw=4.9, seam=0.3, eyes=(40.0, 44.0),
        socket=(1.0, 5.0), brow=(1.4, 4.6, 0.85, 0), nose=(1.6, 1.3), teeth=(6, 0.8, 0.7), jaw_hw=5.2,
        freckles=((1.7, 2.3), (3.0, 2.1), (1.9, 1.3), (3.2, 1.0)),
        shoulder=(6.9, 34.0, 6), pad=(6.0, 11.9, 28.4, 35.5, 3.1), elbow_y=27.4, fore=(6.2, 11.6, 21.2, 27.0, 2.9),
        wrist_y=20.6, palm=(7.0, 10.9, 17.1, 20.3, 2.8), finger=(1.9, 1.5),
        belly=(4.9, 0.6, 1.6), buttons=None),
    # narrow, tall chest, long legs with long knee pistons, big head and huge ears
    "rat": dict(
        leg_c=3.2, foot_off=1.0, foot_hw=3.9, sole=0.9, toe_top=3.4, heel_top=4.8,
        ankle=(4.6, 6.1), shin=(5.9, 14.7), knee=(14.5, 16.5), thigh=(16.3, 23.9), shin_w=5.6, thigh_w=5.9,
        pelvis=(23.3, 25.5), pelvis_hw=5.0, torso=(25.5, 37.7), half_w=4.7, torso_d=4.0,
        head_pivot=38.5, head_half=6.0, face_z=-5.0, back=5.0, top=49.4,
        jaw=(37.0, 38.8), snout=(39.0, 41.9), snout_z=-7.6, muzzle_hw=4.1, seam=0.0, eyes=(42.1, 45.6),
        socket=(0.8, 4.7), brow=(0.9, 4.4, 0.45, 0), nose=(1.3, 2.0), teeth=(5, 0.75, 0.65), jaw_hw=4.3,
        freckles=((1.3, 2.0), (2.3, 2.3), (3.3, 1.9), (1.8, 1.1), (2.9, 1.0), (1.2, 0.5)),
        shoulder=(5.9, 36.6, 6), pad=(5.0, 10.4, 30.6, 37.7, 2.7), elbow_y=29.8, fore=(5.2, 10.2, 23.4, 29.4, 2.5),
        wrist_y=22.9, palm=(6.0, 9.6, 19.3, 22.5, 2.5), finger=(2.1, 1.7),
        belly=(3.8, 0.7, 2.2), buttons=(32.4, 29.8, 0.75)),
}



CH["party_cat"] = lengthen(CH["party_cat"], 0.5, 0.5, head_half=7.0)
CH["rat"] = lengthen(CH["rat"], 0.8, 0.8, head_half=6.2)

# --------------------------------------------------------------------------
# Body
# --------------------------------------------------------------------------


def build_body(name):
    D = CH[name]
    cat, rat = name == "party_cat", name == "rat"
    hd = D["torso_d"]
    bone("root", None, [0, 0, 0])
    build_legs(D)
    build_torso(D, pelvis_pad=0.2 if cat else 0.0)
    p0 = D["pelvis"][0]
    c1 = D["torso"][1]
    fz = -hd
    if rat:
        build_bowtie(D, c1 - 0.6, 3.9)
    if cat:
        cube("torso", "collar", [-4.4, c1 - 0.3, -4.6], [4.4, c1 + 0.9, 4.0], "red")
        bone("bell", "torso", [0, c1 - 0.2, fz - 1.0])
        cube("bell", "bell_loop", [-0.45, c1 - 0.9, fz - 1.5], [0.45, c1 - 0.1, fz - 0.7], "gold")
        cube("bell", "bell", [-1.25, c1 - 3.3, fz - 2.3], [1.25, c1 - 0.9, fz - 0.4], "gold", painter=p_bell)
        cube("bell", "bell_rim", [-1.45, c1 - 3.5, fz - 2.5], [1.45, c1 - 3.0, fz - 0.2], "gold")
    build_neck(D)

    def tongue():
        # tongue hanging out of the left side of the mouth
        j1, sz = D["jaw"][1], D["snout_z"]
        cube("jaw", "tongue", [-2.6, j1 - 0.1, sz - 1.4], [-0.7, j1 + 0.5, sz + 1.6], "tongue",
             rot=[-30, 0, 0], origin=[-1.6, j1, sz + 1.2])

    build_head(D, after_jaw=tongue if rat else None)
    H, top = D["head_half"], D["top"]
    sn0, sz, mh = D["snout"][0], D["snout_z"], D["muzzle_hw"]

    # ears
    for s, side in ((1, "right"), (-1, "left")):
        e = f"{side}Ear"
        if cat:
            bone(e, "head", [s * (H - 1.4), top - 0.4, 0.2], [0, 0, -s * 8])
            cube(e, "ear", [H - 3.4, top - 0.8, -0.6], [H + 1.6, top + 4.2, 1.0], "fur", s,
                 painter=frame_painter("ear_dark", "fur", rim=1.0))
        else:
            bone(e, "head", [s * (H - 1.0), top - 0.2, 0.4], [0, 0, -s * 14])
            cube(e, "ear", [H - 2.6, top - 0.6, -0.4], [H + 4.6, top + 6.6, 1.2], "ear_dark", s,
                 painter=frame_painter("ear_red", "ear_dark", rim=0.9))

    if cat:
        bone("hat", "head", [2.8, top, -0.6], [-6, 0, -22])
        cube("hat", "hat_rim", [-0.4, top, -3.4], [6.0, top + 0.8, 2.2], "hat_red")
        for k in range(6):
            r = 2.7 - 0.4 * k
            y0 = top + 0.8 + 1.0 * k
            cube("hat", f"hat_tier{k + 1}", [2.8 - r, y0, -0.6 - r], [2.8 + r, y0 + 1.0, -0.6 + r], "hat_red",
                 painter=stripes_painter("hat_red", "hat_cream", 1.0, 0.9))
        py_ = top + 0.8 + 6.0
        cube("hat", "pompom", [1.8, py_ - 0.2, -1.6], [3.8, py_ + 1.8, 0.4], "pompom")
        for k, (dx, dy, dz) in enumerate(((-0.9, 0.6, 0), (0.9, 0.5, 0.2), (0, 0.6, -0.9), (0.1, 0.7, 0.9), (0, 1.5, 0))):
            cube("hat", f"pompom_puff{k + 1}", [2.8 + dx - 0.6, py_ + dy - 0.5, -0.6 + dz - 0.6],
                 [2.8 + dx + 0.6, py_ + dy + 0.7, -0.6 + dz + 0.6], "pompom")
    if rat:
        bone("hat", "head", [2.6, top, -0.4], [-4, 0, -20])
        cube("hat", "fez", [-1.1, top, -3.2], [5.1, top + 3.0, 2.4], "hat_red")
        cube("hat", "fez_lid", [-0.8, top + 3.0, -2.9], [4.8, top + 3.4, 2.1], "hat_red")
        cube("hat", "fez_band", [-1.2, top, -3.3], [5.2, top + 0.6, 2.5], "fur_dark")
        for s in (1, -1):
            for k, (y, ang) in enumerate(((sn0 + 2.2, 12), (sn0 + 1.4, 1), (sn0 + 0.6, -12))):
                cube("head", f"whisker{k + 1}", [mh - 0.2, y - 0.07, sz + 1.0], [mh + 7.0, y + 0.07, sz + 1.14], "whisker", s,
                     rot=[0, 8, ang], origin=[mh - 0.2, y, sz + 1.07])

    build_arms(D)

    if rat:
        m = mic_info(name)
        mx, my, mz = m["pivot"]
        bone("mic", "rightHand", m["pivot"], m["rot"])
        cube("mic", "mic_handle", [mx - 3.6, my - 0.5, mz - 0.5], [mx + 1.6, my + 0.5, mz + 0.5], "mic_handle")
        cube("mic", "mic_ring", [mx - 3.9, my - 0.7, mz - 0.7], [mx - 3.4, my + 0.7, mz + 0.7], "chrome", painter=p_chrome)
        cube("mic", "mic_head", [mx - 6.2, my - 1.2, mz - 1.2], [mx - 3.8, my + 1.2, mz + 1.2], "mic_grey", painter=p_mic_head)

    # ---- tails ------------------------------------------------------------------------
    if cat:
        seg = [(35, 55), (25, 25), (5, 15), (-30, 15), (-40, 10), (-35, 0)]
        build_tail("tail", (2.4, p0 + 1.0, hd), 3.0, 2.7, seg, bands=("tail_light", "tail_dark", 3.0, 0.42))
    if rat:
        # out past his left side, then arcing down toward the floor with a curl at the tip
        seg = [(-10, -75), (10, -10), (15, 0), (20, 0), (25, 0), (20, 5), (15, 5), (10, 10), (0, 15), (-25, 25)]
        build_tail("tail", (-2.0, p0 + 1.0, hd), 2.7, 1.1, seg, bands=("pink", "pink_dark", 0.9, 0.3), taper=0.05)


def mic_info(name="rat"):
    px0, px1, py0, py1, pz = CH[name]["palm"]
    grip = [(px0 + px1) / 2, py0 - 1.4, -0.4]
    pivot = [px0 + 0.9, grip[1], grip[2]]
    return dict(parent="rightHand", pivot=pivot, rot=[0, -55, 0], head=(pivot[0] - 5.0, pivot[1], pivot[2]), axis=(-1, 0, 0))


def tail_names(name):
    return [f"tail{k}" for k in range(6 if name == "party_cat" else 10)] if name in ("party_cat", "rat") else []


# --------------------------------------------------------------------------
# Animations
# --------------------------------------------------------------------------


class TrioNight(NightClips):
    def __init__(self, name):
        self.name = name
        self.D = D = CH[name]
        super().__init__(dict(
            mouth=(0.0, D["snout"][0] - 0.2, D["snout_z"] - 2.6), mouth_axis=(0, 0.45, 0.9),
            half_w=D["half_w"], torso=D["torso"], mic=mic_info(name) if name == "rat" else None,
            jaw_max=22.0, tail=tail_names(name)))

    def shared(self, *groups, step=0.5, move=0.2, phase=0.0):
        st = stepper(step, move, phase)
        return {g: st for g in groups}


class CatNight(TrioNight):
    IK_CLIPS = ("pose1", "pose2", "performance1")

    def schedule(self, name, L):
        if name in ("pose1", "performance1"):
            return {**self.shared("torso", "armR", step=0.5, move=0.2), "head": stepper(0.5, 0.15, 0.25),
                    "armL": stepper(1.0, 0.25, 0.5), "tail": stepper(0.5, 0.15, 0.1)}
        if name == "pose2":
            return {**self.shared("torso", "armL", step=0.5, move=0.18), "head": stepper(1.0, 0.2, 0.25),
                    "armR": stepper(1.0, 0.2), "tail": stepper(0.5, 0.15)}
        return super().schedule(name, L)

    def bell_goal(self, ring=0.0):
        """Palm resting on the bell (just under the chin), fingers curled over it."""
        c1 = self.D["torso"][1]
        return torso_goal((0.8 + 0.4 * ring, c1 - 3.3, -self.D["torso_d"] - 2.4), normal=(0, 0, 1), fingers=(-0.7, -0.5, -0.5),
                          elbow=(11.0, 28.0, -3.0))

    def pose1(self, t):
        """The picture: head tilted to his right, right hand on the bell, tail curled out."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 1.0, -6.0, 2.0)
        setr(p, "torso", 2.0 + 1.0 * sn(w), -4.0, 3.0)
        setr(p, "head", -6.0, 8.0 + 3.0 * sn(w), -20.0 + 2.0 * sn(w))
        setr(p, "leftArm", -6.0, 0, -2.0)
        setr(p, "leftForearm", -18.0, 0, 0)
        setr(p, "leftFingers", 0, 0, 18.0)
        self.arm_ik("pose1_right", p, "right", self.bell_goal(), [-60, 30, 30, -90, 0, 0, 0, 0, 0])
        setr(p, "rightFingers", 0, 0, 12.0)
        self.stance(p, 4.0)
        self.tail(p, w, 6.0)
        setr(p, "hat", 0, 0, -3.0 * sn(w))
        setr(p, "jaw", 4.0, 0, 0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "bell", 0, 0, 12.0 * flip(t, 6) * window(t, 1.0, 1.4, 0.02))

    def pose2(self, t):
        """Waves hello with the left hand, head tilted the other way."""
        p = {}
        setr(p, "body", 0, 4.0, -2.0)
        setr(p, "torso", 1.0, 3.0, -3.0)
        setr(p, "head", 2.0, -8.0, 14.0)
        setr(p, "rightArm", -4.0, 0, 3.0)
        setr(p, "rightForearm", -12.0, 0, 0)
        sw = sn(TAU * t)
        goal = torso_goal((-(self.D["half_w"] + 6.5) - 1.6 * sw, self.D["head_pivot"] + 6.0, -4.0), normal=(0, 0, 1),
                          fingers=(math.sin(math.radians(16 * sw)), -math.cos(math.radians(16 * sw)), 0),
                          elbow=(-(self.D["half_w"] + 7.5), self.D["torso"][1] - 4.0, -1.0))
        self.arm_ik("pose2_left", p, "left", goal, [0, 0, -80, -10, 0, -70, 0, -80, 0])
        self.stance(p, 4.0)
        self.tail(p, TAU * t / 2.0, 12.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "jaw", 6.0 * window(t, 0.2, 1.6, 0.06), 0, 0)

    def performance1(self, t):
        """Dances on the spot: hips swaying, ringing the bell, tail swishing, hat wobbling."""
        p = {}
        sway = sn(TAU * t / 2.0)
        setr(p, "body", 0, 6.0 * sway, 5.0 * sway)
        setr(p, "torso", 2.0, -4.0 * sway, -6.0 * sway)
        setr(p, "head", -4.0 + 3.0 * cs(TAU * t), 10.0 * sn(TAU * t / 4.0), 10.0 * sway - 6.0)
        setr(p, "hat", 0, 0, -6.0 * sway)
        self.arm_ik("perf1_right", p, "right", self.bell_goal(ring=sn(TAU * t)), [-60, 30, 30, -90, 0, 0, 0, 0, 0])
        g = ease((t - 1.0) / 0.4) * (1 - ease((t - 3.0) / 0.4))
        setr(p, "leftArm", -30.0 * g - 4.0, 0, -(6.0 + 50.0 * g))
        setr(p, "leftForearm", -30.0 * g - 10.0, 0, 0)
        setr(p, "leftHand", 0, -20.0 * g, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Leg", -4.0 - 6.0 * pos(s * sway), 0, s * 4.0)
            setr(p, f"{side}Shin", 8.0 + 12.0 * pos(s * sway), 0, 0)
            flat_foot(p, side)
        self.tail(p, TAU * t / 2.0 + 1.0, 16.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "bell", 0, 0, 14.0 * flip(t, 4))
        add_rot(p, "jaw", sum(a * window(t, t0, t1, 0.04) for t0, t1, a in FREDDY_SONG) * 0.8, 0, 0)

    def performance2(self, t):
        """Party: both arms up waving side to side, head bobbing."""
        p = {}
        sw = sn(TAU * t / 1.0)
        setr(p, "body", 0, 0, 3.0 * sw)
        setr(p, "torso", -2.0, 4.0 * sw, 3.0 * sw)
        setr(p, "head", 2.0 + 4.0 * cs(TAU * t * 2), -8.0 * sw, 8.0 * sw)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -40.0, 0, s * (130.0 + 18.0 * sw * s))
            setr(p, f"{side}Forearm", -20.0, 0, 0)
            setr(p, f"{side}Hand", 0, 0, s * 10.0 * sw)
        self.fingers_open(p, 0.8)
        self.stance(p, 4.0, 2.0 + 3.0 * (0.5 - 0.5 * cs(TAU * t * 2)))
        self.tail(p, TAU * t, 18.0, lift=-10.0)
        setr(p, "hat", 0, 0, 8.0 * sw)
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", 10.0 * window(t % 0.5, 0.0, 0.2, 0.03), 0, 0)
        add_rot(p, "bell", 0, 0, 10.0 * flip(t, 4))


class RatNight(TrioNight):
    IK_CLIPS = ("pose1", "pose2", "performance1", "performance2")

    def schedule(self, name, L):
        if name in ("pose1", "performance1"):
            return {**self.shared("torso", "head", "armR", "armL", step=0.5, move=0.2), "tail": stepper(0.5, 0.15, 0.2)}
        if name in ("pose2", "performance2"):
            return {**self.shared("torso", "armR", "armL", step=0.5, move=0.2), "head": stepper(0.5, 0.15, 0.25),
                    "tail": stepper(0.5, 0.15, 0.2)}
        return super().schedule(name, L)

    def pose1(self, t):
        """The picture: mic at his mouth, other hand on the hip, head cocked."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 0, -6.0, 3.0)
        setr(p, "torso", 2.0 + 1.0 * sn(w), -4.0, 4.0)
        setr(p, "head", 4.0, 6.0 + 4.0 * sn(w), -16.0 + 2.0 * sn(w))
        self.arm_ik("pose1_right", p, "right", self.mouth_goal(), [-120, 20, 20, -70, 0, 0, 0, 0, 0],
                    effector=self.mic_effector())
        self.arm_ik("pose1_left", p, "left", self.hip_goal("left"), [10, 0, -40, -70, 0, 0, 0, 0, 0])
        setr(p, "rightLeg", -6.0, -6.0, 8.0)
        setr(p, "rightShin", 6.0, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 4.0, 6.0, -6.0)
        setr(p, "leftShin", 4.0, 0, 0)
        flat_foot(p, "left")
        self.tail(p, w, 6.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "jaw", 6.0 * window(t, 0.6, 0.9, 0.04) + 4.0 * window(t, 1.3, 1.5, 0.04), 0, 0)

    def pose2(self, t):
        """Arms open to the audience, mic out to the side."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 0, 0, 0)
        setr(p, "torso", -2.0, 4.0 * sn(w), 0)
        setr(p, "head", -6.0, -8.0 * sn(w), 10.0)
        for side in ("right", "left"):
            s = S[side]
            goal = torso_goal((s * (self.D["half_w"] + 12.0), 31.0 + 1.0 * sn(w), -6.0), normal=(0, 1, 0) if s < 0 else None,
                              fingers=(s * 0.6, -0.3, -0.7), elbow=(s * (self.D["half_w"] + 6.0), 30.0, -2.0))
            self.arm_ik(f"pose2_{side}", p, side, goal, [-40, 0, s * 60, -20, 0, 0, 0, 0, 0],
                        effector=self.mic_effector() if s > 0 else None)
        self.stance(p, 5.0)
        self.tail(p, w, 12.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "jaw", 10.0 * window(t, 0.3, 0.6, 0.04) + 8.0 * window(t, 0.75, 1.0, 0.04), 0, 0)

    def performance1(self, t):
        """Sings into the mic with his hand on his hip, swaying."""
        p = {}
        setr(p, "body", 0, -4.0, 3.0 * sn(TAU * t / 2.0))
        setr(p, "torso", 2.0, 5.0 * sn(TAU * t / 4.0), 2.0 * sn(TAU * t / 2.0))
        setr(p, "head", 3.0 + 3.0 * cs(TAU * t), 12.0 * sn(TAU * t / 4.0 + 0.5), -10.0 + 4.0 * sn(TAU * t / 2.0))
        self.arm_ik("perf1_right", p, "right", self.mouth_goal(), [-120, 20, 20, -70, 0, 0, 0, 0, 0],
                    effector=self.mic_effector())
        self.arm_ik("perf1_left", p, "left", self.hip_goal("left"), [10, 0, -40, -70, 0, 0, 0, 0, 0])
        setr(p, "rightLeg", -4.0, 0, 4.0)
        setr(p, "rightShin", 6.0, 0, 0)
        flat_foot(p, "right", toe=-14.0 * pos(sn(TAU * t)))
        setr(p, "leftLeg", -2.0, 0, -4.0)
        setr(p, "leftShin", 4.0, 0, 0)
        flat_foot(p, "left")
        self.tail(p, TAU * t / 2.0, 10.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", sum(a * window(t, t0, t1, 0.04) for t0, t1, a in FREDDY_SONG), 0, 0)

    def performance2(self, t):
        """Holds the mic out to the crowd, then brings it back for the chorus."""
        p = {}
        m = ease((t - 0.3) / 0.4) * (1 - ease((t - 2.2) / 0.4))
        setr(p, "body", 0, -6.0 * m, 2.0 * sn(TAU * t / 2.0))
        setr(p, "torso", 2.0 - 4.0 * m, -6.0 * m, 0)
        setr(p, "head", 2.0 - 8.0 * m + 3.0 * cs(TAU * t), 8.0 * sn(TAU * t / 4.0), -8.0 + 10.0 * m)
        mouth = self.mouth_goal()
        crowd = torso_goal((5.0, 33.0, -18.0), axis=(0, 0.2, -1), elbow=(12.0, 29.0, -6.0))

        def goal(mats):
            a, b = mouth(mats), crowd(mats)
            ax = a["axis"] * (1 - m) + b["axis"] * m
            return {"point": a["point"] * (1 - m) + b["point"] * m, "axis": ax / np.linalg.norm(ax),
                    "elbow": a["elbow"] * (1 - m) + b["elbow"] * m}

        goal.bones = ("head",)
        self.arm_ik("perf2_right", p, "right", goal, [-120, 20, 20, -70, 0, 0, 0, 0, 0], effector=self.mic_effector())
        self.arm_ik("perf2_left", p, "left", self.hip_goal("left"), [10, 0, -40, -70, 0, 0, 0, 0, 0])
        self.stance(p, 4.0, 2.0 + 2.0 * (0.5 - 0.5 * cs(TAU * t)))
        self.tail(p, TAU * t / 2.0, 12.0)
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", sum(a * window(t, t0, t1, 0.04) for t0, t1, a in FREDDY_SONG if not 0.6 < t0 < 2.4), 0, 0)


# same lyric rhythm as Freddy's song (start, end, degrees)
FREDDY_SONG = [(0.0, 0.2, 10), (0.25, 0.45, 7), (0.5, 0.85, 12), (1.0, 1.2, 8), (1.25, 1.45, 10), (1.5, 1.95, 13),
               (2.5, 2.7, 9), (2.75, 2.95, 7), (3.0, 3.35, 12), (3.5, 3.9, 10)]

CLIPS = {"party_cat": CatNight, "rat": RatNight}


def spec(name):
    D = CH[name]
    px0, px1, py0, py1, pz = D["palm"]
    return export.Character(
        model_id=name,
        entity_id=f"fnaf:{name}",
        out_dir=os.path.join(export.TOOLS_DIR, "..", name),
        materials=MATERIALS[name],
        build_geometry=lambda: build_body(name),
        build_anims=lambda: CLIPS[name](name).build(name),
        sources=[os.path.abspath(__file__), os.path.join(HERE, "night.py"), os.path.join(HERE, "body.py"), name],
        spawn_egg={"party_cat": ("#c07a2c", "#a01c22"), "rat": ("#4e4a4c", "#a02024")}[name],
        variant_states={"pose1": 1, "pose2": 2, "performance1": 3, "performance2": 4, "jumpscare1": 5, "jumpscare2": 6},
        arm=dict(palm=((px0 + px1) / 2, (py0 + py1) / 2, 0.0),
                 chest=dict(half_x=D["half_w"] + 1.2, z=(-D["torso_d"] - 1.2, D["torso_d"] + 0.8),
                            y=(D["torso"][0] - 3.0, D["torso"][1]))),
        visible_box=(5, 5, 2.5),
        atlas_width=1024,
        tpu=4,
    )
