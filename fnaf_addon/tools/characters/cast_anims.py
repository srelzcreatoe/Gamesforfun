"""Night clips for the seven cast.py animatronics, each with its own personality.

All of them move like show animatronics (servo snaps and holds, see fnafkit.servo), but
every character has its own idle, gait, poses, performances and jumpscares:

  monkey     hunched and twitchy: knuckle-drag walk, galloping run, cymbal-monkey clapping,
             chest drumming, a leaping screech and an unnatural head twist
  bat        wings fold and unfold, vampire-creep walk, wing-flapping run, looming wing cape,
             a screech solo, and a jumpscare with the wings flinging open
  crocodile  heavy waddle with a swinging tail, jaw that slowly opens and snaps shut,
             gentleman hat tip, soft-shoe dance, snap song, death roll
  fox        pirate swagger, the sprint, hook raised, peeking out, sea-shanty rocking,
             hook slashes, sprint-and-leap jumpscare
  bunny      ear twitches, bouncy hop-walk, hopping run, creepy head tilt, air guitar,
             hop dance, a face-from-below jumpscare
  goat       chewing jaw, high-stepping trot, ram charge, pawing hoof, bleating laugh,
             stomp dance, headbutt
  bear       dead-still stare, slow heavy lumber, pointing "I see you", conducting the band,
             slow clap, power-down-and-snap jumpscare

Animation value conventions are the Bedrock ones described in fnafkit.anim.
"""
import math

from characters import cast
from characters.night import NightClips, clamp01, ease, flip, lerp, swing, window
from fnafkit.anim import S, TAU, bone_goal, cs, flat_foot, pos, setp, setr, sn, torso_goal
from fnafkit.servo import add_rot, meta, stepper

SONG = [(0.0, 0.2, 10), (0.25, 0.45, 7), (0.5, 0.85, 12), (1.0, 1.2, 8), (1.25, 1.45, 10), (1.5, 1.95, 13),
        (2.5, 2.7, 9), (2.75, 2.95, 7), (3.0, 3.35, 12), (3.5, 3.9, 10)]


def song(t, scale=1.0, notes=SONG):
    return scale * sum(a * window(t, t0, t1, 0.04) for t0, t1, a in notes)


def pulse(t, period, width, ramp=0.03, phase=0.0):
    """A repeating on/off servo pulse: on for `width` seconds every `period`."""
    return window((t - phase) % period, 0.0, width, ramp)


class CastNight(NightClips):
    IK_CLIPS = ()

    def __init__(self, name):
        self.name = name
        self.D = D = cast.CH[name]
        super().__init__(dict(mouth=(0.0, D.get("snout", (40, 0))[0] - 0.2, D.get("snout_z", -8) - 2.6),
                              mouth_axis=(0, 0.45, 0.9), half_w=D["half_w"], torso=D["torso"], mic=None,
                              jaw_max=22.0, tail=cast.tail_names(name)))

    # ---- helpers --------------------------------------------------------------------------
    def legs_gait(self, p, f, stride, bend, toe=6.0, spread=1.0, lift_phase=0.35, phase_off=math.pi, k=0.7):
        for side in ("right", "left"):
            s = S[side]
            ph = f if s > 0 else f + phase_off
            setr(p, f"{side}Leg", -stride * swing(ph, k), 0, s * spread)
            setr(p, f"{side}Shin", 4.0 + bend * pos(cs(ph + lift_phase)) ** 1.5, 0, 0)
            flat_foot(p, side, toe=-toe * sn(ph))

    def arms_gait(self, p, f, amp, base=0.0, out=2.0, elbow=-10.0, phase_off=math.pi):
        for side in ("right", "left"):
            s = S[side]
            ph = f + phase_off if s > 0 else f
            setr(p, f"{side}Arm", base + amp * sn(ph), 0, s * out)
            setr(p, f"{side}Forearm", elbow, 0, 0)

    def tail_sway(self, p, phase, yaw=8.0, pitch=0.0, lag=0.6, lift=0.0):
        for k, b in enumerate(self.i["tail"]):
            setr(p, b, (lift if k == 0 else 0.0) + pitch * sn(phase - lag * k), yaw * sn(phase - lag * k), 0)

    def palm_up(self, p, side, k=1.0, spread=1.0):
        s = S[side]
        setr(p, f"{side}Hand", 0, -s * 70.0 * k, 0)
        setr(p, f"{side}Fingers", 0, 0, s * 30.0 * spread * k)

    def curl(self, p, side, k=1.0):
        s = S[side]
        setr(p, f"{side}Fingers", 0, 0, -s * 55.0 * k)
        setr(p, f"{side}Thumb", 0, 0, s * 25.0 * k)

    def scream_shake(self, p, t, t0, t1, head=7.0, rate=12):
        on = 1.0 if t0 <= t <= t1 else 0.0
        f = flip(t, rate) * on
        add_rot(p, "head", 0, head * f, head * 0.7 * f)
        add_rot(p, "body", 0, 0, 1.5 * f)
        return on


# ==========================================================================
# Monkey
# ==========================================================================


class MonkeyNight(CastNight):
    IK_CLIPS = ("pose1", "pose2", "performance1", "performance2")
    LENGTHS = dict(CastNight.LENGTHS, walk=1.4, run=0.7)

    def walk_len(self):
        return 1.4

    def hunch(self, p, k=1.0):
        setr(p, "body", 10.0 * k, 0, 0)
        setr(p, "torso", 8.0 * k, 0, 0)

    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        self.hunch(p)
        setr(p, "head", -14.0 + 3.0 * sn(2 * w), 14.0 * sn(w), -16.0 * swing(w + 1.0, 0.4))
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -6.0 + 3.0 * sn(w + s), 0, s * 3.0)
            setr(p, f"{side}Forearm", -8.0, 0, 0)
            self.curl(p, side, 0.3 + 0.2 * sn(2 * w + s))
        self.stance(p, 3.0, 6.0)
        self.tail_sway(p, 2 * w, 10.0, 6.0)
        for side in ("right", "left"):
            setr(p, f"{side}Ear", 0, S[side] * 6.0 * sn(2 * w + S[side]), 0)
        meta(p)
        return p

    def idle_post(self, p, t):
        chatter = window(t, 1.2, 1.7, 0.02) + window(t, 4.0, 4.35, 0.02)
        add_rot(p, "jaw", 10.0 * chatter * (flip(t, 10) > 0), 0, 0)
        add_rot(p, "head", 0, 0, 22.0 * window(t, 2.6, 3.1, 0.04))           # sudden cock of the head
        add_rot(p, "rightFingers", 0, 0, -20.0 * window(t, 5.0, 5.3, 0.03))

    def walk(self, t):
        f = TAU * t / 1.4
        p = {}
        setr(p, "body", 18.0, -4.0 * sn(f), 3.0 * cs(f))
        setr(p, "torso", 8.0, 6.0 * sn(f), 0)
        setr(p, "head", -22.0 + 3.0 * cs(2 * f), -5.0 * sn(f), 0)
        self.legs_gait(p, f, 20.0, 32.0, toe=8.0, spread=3.0)
        # long arms swing low, knuckles near the floor
        for side in ("right", "left"):
            s = S[side]
            ph = f + math.pi if s > 0 else f
            setr(p, f"{side}Arm", -12.0 + 26.0 * sn(ph), 0, s * 4.0)
            setr(p, f"{side}Forearm", -6.0, 0, 0)
            self.curl(p, side, 0.8)
        self.tail_sway(p, f, 12.0, 0.0, lift=-12.0)
        meta(p, extra=0.7 * pos(cs(2 * f)))
        return p

    def run(self, t):
        f = TAU * t / 0.7
        p = {}
        # galloping lope: hands reach forward to the floor, legs bound together
        setr(p, "body", 34.0 + 4.0 * sn(f), 0, 0)
        setr(p, "torso", 14.0, 0, 0)
        setr(p, "head", -44.0, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            ph = f + 0.35 * s
            setr(p, f"{side}Leg", -14.0 - 36.0 * sn(ph), 0, s * 3.0)
            setr(p, f"{side}Shin", 20.0 + 60.0 * pos(cs(ph + 0.4)), 0, 0)
            flat_foot(p, side, toe=-12.0 * sn(ph) + 8.0)
            setr(p, f"{side}Arm", -70.0 - 40.0 * sn(f + math.pi + 0.3 * s), 0, s * 6.0)
            setr(p, f"{side}Forearm", -10.0, 0, 0)
            self.curl(p, side, 0.9)
        self.tail_sway(p, f, 6.0, 8.0, lift=-30.0)
        setr(p, "jaw", 10.0, 0, 0)
        meta(p, extra=1.6 * pos(sn(f + 0.6)))
        return p

    def pose1(self, t):
        """The picture: head tilted hard to his right, right claw held out at his side."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 3.0, -8.0, 4.0)
        setr(p, "torso", 4.0 + 1.0 * sn(w), -6.0, 5.0)
        setr(p, "head", 6.0 + 1.5 * sn(w), 10.0, -22.0 + 2.0 * sn(w + 1.0))
        goal = torso_goal((self.D["half_w"] + 10.0, 23.0 + 0.6 * sn(w), -5.0), fingers=(0.45, -0.55, -0.7),
                          elbow=(self.D["half_w"] + 5.5, 28.0, 1.0))
        self.arm_ik("pose1_right", p, "right", goal, [-20, 40, 30, -60, 0, 0, 0, 0, 0])
        setr(p, "leftArm", 6.0, 0, -4.0)
        setr(p, "leftForearm", -14.0, 0, 0)
        self.curl(p, "left", 0.5)
        self.fingers_open(p, 1.0, sides=("right",))
        setr(p, "rightLeg", -18.0, -6.0, 6.0)
        setr(p, "rightShin", 22.0, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 6.0, 4.0, -4.0)
        setr(p, "leftShin", 4.0, 0, 0)
        flat_foot(p, "left")
        setr(p, "jaw", 4.0, 0, 0)
        self.tail_sway(p, w, 6.0, 4.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "head", 0, 0, -8.0 * window(t, 1.2, 1.45, 0.03))
        add_rot(p, "rightFingers", 0, 0, 10.0 * window(t, 0.5, 0.7, 0.03))

    def pose2(self, t):
        """See-no-evil: hands over his eyes, then the fingers part and he peeks."""
        p = {}
        self.hunch(p, 0.8)
        setr(p, "head", 8.0, 0, -10.0)
        H = self.D["head_half"]
        e = (self.D["eyes"][0] + self.D["eyes"][1]) / 2
        for side in ("right", "left"):
            s = S[side]
            goal = bone_goal("head", (s * 2.8, e - 0.6, self.D["face_z"] - 2.2), normal=(0, 0, 1), fingers=(0, 1, 0),
                             elbow=(s * (H + 4.0), 30.0, -6.0))
            self.arm_ik(f"pose2_{side}", p, side, goal, [-120, s * 20, -s * 30, -80, 0, 0, 0, 0, 0])
        self.stance(p, 3.0, 8.0)
        self.tail_sway(p, TAU * t / 2.0, 8.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        peek = window(t, 0.9, 1.6, 0.05)
        add_rot(p, "rightFingers", 0, 0, 40.0 * peek)
        add_rot(p, "rightHand", 0, 0, 18.0 * peek)
        add_rot(p, "jaw", 8.0 * window(t, 1.1, 1.5, 0.03) * (flip(t, 10) > 0), 0, 0)

    def performance1(self, t):
        """The wind-up cymbal monkey: arms swing out and clap together, jaw snapping on each clap."""
        p = {}
        self.hunch(p, 0.6)
        clap = 0.5 + 0.5 * cs(TAU * t * 2.0)          # 1 = arms apart, 0 = hands together (2 claps a second)
        setr(p, "head", -10.0 + 6.0 * (1 - clap), 10.0 * sn(TAU * t / 4.0), 8.0 * sn(TAU * t / 2.0))
        for side in ("right", "left"):
            s = S[side]
            goal = torso_goal((s * (0.9 + 7.0 * clap), 30.0, -9.5 - 2.0 * clap), normal=(s, 0, 0), fingers=(0, 0.8, -0.5),
                              elbow=(s * (12.0 + 2.0 * clap), 30.0, -3.0))
            self.arm_ik(f"perf1_{side}", p, side, goal, [-75, s * 20, 0, -60, 0, 0, 0, 0, 0])
        self.stance(p, 3.0, 4.0 + 6.0 * (1 - clap))
        self.tail_sway(p, TAU * t, 10.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", 18.0 * pulse(t, 0.5, 0.18, 0.02, phase=0.17), 0, 0)
        add_rot(p, "head", 0, 0, 6.0 * flip(t, 2))

    def performance2(self, t):
        """Chest drumming and hooting, head thrown back."""
        p = {}
        hit = (t * 4.0) % 2.0                         # alternating fists, four hits a second
        setr(p, "body", -4.0, 0, 3.0 * sn(TAU * t / 2.0))
        setr(p, "torso", -6.0, 6.0 * sn(TAU * t / 2.0), 0)
        setr(p, "head", -18.0, 12.0 * sn(TAU * t / 4.0), 0)
        hw, c1 = self.D["half_w"], self.D["torso"][1]
        for side in ("right", "left"):
            s = S[side]
            mine = (hit < 1.0) == (s > 0)
            d = 2.6 * (1.0 - ease(abs((hit % 1.0) - 0.5) * 2)) if mine else 2.6
            goal = torso_goal((s * 2.4, c1 - 4.0, -self.D["torso_d"] - 1.0 - d), normal=(0, 0, 1), fingers=(-s * 0.4, 0.2, -0.9),
                              elbow=(s * (hw + 5.0), c1 - 6.0, -1.0))
            self.arm_ik(f"perf2_{side}", p, side, goal, [-60, s * 30, s * 20, -100, 0, 0, 0, 0, 0])
            self.curl(p, side, 1.0)
        self.stance(p, 4.0, 6.0)
        self.tail_sway(p, TAU * t, 14.0)
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", 16.0 * pulse(t, 1.0, 0.45, 0.04) + 8.0 * pulse(t, 1.0, 0.2, 0.03, phase=0.6), 0, 0)

    def jumpscare1(self, t):
        """Crouches, leaps at the camera with both arms over his head, screeching."""
        p = {}
        c = ease(t / 0.2) * (1 - ease((t - 0.2) / 0.1))     # crouch
        a = ease((t - 0.22) / 0.15)                           # airborne
        land = ease((t - 0.6) / 0.12)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Leg", -40.0 * c - 20.0 * a + 10.0 * land, 0, s * 4.0)
            setr(p, f"{side}Shin", 70.0 * c + 30.0 * a - 10.0 * land, 0, 0)
            flat_foot(p, side, toe=20.0 * a * (1 - land))
            setr(p, f"{side}Arm", lerp(10.0, -165.0, a), 0, s * lerp(4.0, 22.0, a))
            setr(p, f"{side}Forearm", -20.0 * a, 0, 0)
        self.fingers_open(p, a)
        setr(p, "body", 30.0 * c - 10.0 * a + 16.0 * land, 0, 0)
        setr(p, "torso", -6.0 * a, 0, 0)
        setr(p, "head", -10.0 * c - 26.0 * a, 0, 0)
        setr(p, "jaw", 26.0 * a, 0, 0)
        self.tail_sway(p, 0.0, 0.0, lift=-40.0 * a)
        meta(p, extra=3.0 * a * (1 - land), z=-10.0 * a)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.62, 1.15, head=8.0)

    def jumpscare2(self, t):
        """Head creaks round sideways, too far, then snaps forward with a screech."""
        p = {}
        twist = ease(t / 0.6) * (1 - ease((t - 0.62) / 0.06))
        snap = ease((t - 0.62) / 0.06)
        self.hunch(p, 1.0 - 0.5 * snap)
        setr(p, "head", -10.0 - 20.0 * snap, 0, -95.0 * twist)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(-4.0, -95.0, snap), s * 10.0 * snap, s * lerp(3.0, 14.0, snap))
            setr(p, f"{side}Forearm", -10.0 * snap, 0, 0)
        self.fingers_open(p, snap)
        setr(p, "jaw", 6.0 + 22.0 * snap, 0, 0)
        self.stance(p, 3.0, 6.0)
        meta(p, z=-7.0 * snap)
        return p

    def jumpscare2_post(self, p, t):
        add_rot(p, "head", 0, 0, 4.0 * flip(t, 14) * window(t, 0.1, 0.6, 0.02))   # creaking
        self.scream_shake(p, t, 0.7, 1.4, head=6.0)


# ==========================================================================
# Bat
# ==========================================================================


class BatNight(CastNight):
    LENGTHS = dict(CastNight.LENGTHS, run=0.75)

    def wings(self, p, fold=0.0, flap=0.0, tip=0.0):
        """fold > 0 swings the wings back, < 0 forward; flap > 0 raises them; tip > 0 folds the outer half down."""
        setr(p, "rightWing", 0, fold, flap)
        setr(p, "leftWing", 0, -fold, -flap)
        setr(p, "rightWingTip", 0, 0, -tip)
        setr(p, "leftWingTip", 0, 0, tip)

    def schedule(self, name, L):
        sch = super().schedule(name, L)
        if name == "idle":
            sch["wings"] = stepper(1.5, 0.4, 0.2)
        elif name in ("pose1", "pose2", "performance1"):
            sch["wings"] = stepper(0.5, 0.18, 0.1)
        elif name == "walk":
            sch["wings"] = stepper(L / 2, 0.2)
        return sch

    def present(self, p, k_r=1.0, k_l=1.0):
        """Arms out with the palms up, like the picture."""
        for side, k in (("right", k_r), ("left", k_l)):
            s = S[side]
            setr(p, f"{side}Arm", -14.0 * k, 0, s * (6.0 + 30.0 * k))
            setr(p, f"{side}Forearm", -10.0 - 40.0 * k, s * 10.0 * k, 0)
            self.palm_up(p, side, k)

    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        setr(p, "torso", 1.0 * sn(w), 0, 0)
        setr(p, "head", 4.0 * sn(2 * w), 18.0 * sn(w), -10.0 + 6.0 * swing(w, 0.5))
        self.present(p, 0.5 + 0.2 * sn(w), 0.5 + 0.2 * sn(w + 1.0))
        self.wings(p, fold=20.0 + 20.0 * sn(w), flap=6.0 * sn(2 * w), tip=10.0 + 10.0 * sn(w))
        self.stance(p, 2.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        add_rot(p, "rightEar", 0, 0, 12.0 * window(t, 1.0, 1.2, 0.02) - 10.0 * window(t, 4.4, 4.6, 0.02))
        add_rot(p, "leftEar", 0, 0, -12.0 * window(t, 2.3, 2.5, 0.02))
        add_rot(p, "jaw", 10.0 * window(t, 3.0, 3.3, 0.03), 0, 0)

    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        # vampire creep: small shuffling steps, shoulders rocking, claws held up in front
        setr(p, "body", 8.0, -3.0 * sn(f), 4.0 * cs(f))
        setr(p, "torso", 6.0, 5.0 * sn(f), -3.0 * cs(f))
        setr(p, "head", -6.0, -6.0 * sn(f), 0)
        self.legs_gait(p, f, 12.0, 16.0, toe=4.0, spread=2.0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -30.0 + 4.0 * sn(f + (0 if s > 0 else math.pi)), 0, s * 8.0)
            setr(p, f"{side}Forearm", -70.0, 0, 0)
            setr(p, f"{side}Hand", 20.0, 0, 0)
            self.curl(p, side, 0.6)
        self.wings(p, fold=55.0, flap=-8.0 + 4.0 * cs(2 * f), tip=40.0)
        meta(p)
        return p

    def run(self, t):
        f = TAU * t / 0.75
        p = {}
        setr(p, "body", 22.0, -3.0 * sn(f), 0)
        setr(p, "torso", 6.0, 4.0 * sn(f), 0)
        setr(p, "head", -26.0, 0, 0)
        self.legs_gait(p, f, 40.0, 70.0, toe=12.0, spread=2.0, lift_phase=0.45)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", 35.0, 0, s * 25.0)
            setr(p, f"{side}Forearm", -20.0, 0, 0)
        self.wings(p, fold=-5.0, flap=8.0 + 26.0 * sn(2 * f), tip=-10.0 * sn(2 * f))
        setr(p, "jaw", 12.0, 0, 0)
        meta(p, extra=1.4 * pos(sn(2 * f + 0.9)))
        return p

    def pose1(self, t):
        """The picture: arms out with the palms up, wings spread, head tilted."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "torso", 1.0 * sn(w), 4.0, 0)
        setr(p, "head", 4.0, 8.0, -12.0 + 3.0 * sn(w))
        self.present(p)
        self.wings(p, fold=0.0, flap=4.0 + 3.0 * sn(w), tip=0.0)
        self.stance(p, 3.0)
        setr(p, "jaw", 6.0, 0, 0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "rightEar", 0, 0, 10.0 * window(t, 0.6, 0.8, 0.02))
        add_rot(p, "jaw", 6.0 * window(t, 1.2, 1.5, 0.03), 0, 0)

    def pose2(self, t):
        """Looming: wings raised high behind his head like a cape, claws up, head bowed, staring."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "torso", 6.0, 0, 0)
        setr(p, "head", 16.0 + 2.0 * sn(w), 6.0 * sn(w), 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -60.0, 0, s * 34.0)
            setr(p, f"{side}Forearm", -50.0, 0, 0)
            setr(p, f"{side}Hand", 20.0, 0, 0)
            self.curl(p, side, 0.7)
        self.wings(p, fold=12.0, flap=34.0 + 3.0 * sn(w), tip=-24.0)
        self.stance(p, 3.0, 3.0)
        setr(p, "jaw", 4.0, 0, 0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "head", 0, 14.0 * window(t, 0.8, 1.3, 0.04), 0)
        add_rot(p, "jaw", 10.0 * window(t, 1.5, 1.7, 0.02), 0, 0)

    def performance1(self, t):
        """Sings, presenting to one side then the other, wings beating on every beat."""
        p = {}
        side_k = 0.5 + 0.5 * sn(TAU * t / 4.0)
        setr(p, "body", 0, 0, 2.0 * sn(TAU * t / 2.0))
        setr(p, "torso", 2.0, 10.0 * (side_k - 0.5) * 2, 0)
        setr(p, "head", 2.0 + 3.0 * cs(TAU * t), 14.0 * (side_k - 0.5) * 2, -6.0 * sn(TAU * t / 2.0))
        self.present(p, 0.3 + 0.7 * side_k, 1.0 - 0.7 * side_k)
        beat = pos(cs(TAU * t))
        self.wings(p, fold=5.0, flap=18.0 * beat, tip=-8.0 * beat)
        self.stance(p, 2.5, 2.0 * beat)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t), 0, 0)

    def performance2(self, t):
        """Screech solo: head thrown back, jaw wide, wings fanning, ears laid back."""
        p = {}
        rise = ease(t / 0.4) * (1 - ease((t - 3.5) / 0.4))
        setr(p, "torso", -6.0 * rise, 0, 0)
        setr(p, "head", -30.0 * rise, 6.0 * sn(TAU * t / 2.0), 0)
        setr(p, "jaw", 18.0 * rise, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -30.0 * rise, 0, s * (10.0 + 60.0 * rise))
            setr(p, f"{side}Forearm", -20.0, 0, 0)
            setr(p, f"{side}Ear", 30.0 * rise, 0, 0)
        self.fingers_open(p, rise)
        self.wings(p, fold=-10.0 * rise, flap=22.0 * rise, tip=-12.0 * rise)
        self.stance(p, 3.5, 4.0 * rise)
        meta(p)
        return p

    def performance2_post(self, p, t):
        on = window(t, 0.4, 3.5, 0.05)
        f = flip(t, 8) * on
        add_rot(p, "rightWing", 0, 0, 6.0 * f)
        add_rot(p, "leftWing", 0, 0, -6.0 * f)
        add_rot(p, "jaw", 4.0 * flip(t, 12) * on, 0, 0)

    def jumpscare1(self, t):
        """Wings snap open, he lunges with claws reaching, screeching."""
        p = {}
        k = ease((t - 0.06) / 0.1)
        setr(p, "body", 16.0 * k, 0, 0)
        setr(p, "torso", 8.0 * k, 0, 0)
        setr(p, "head", -28.0 * k, 0, 0)
        setr(p, "jaw", 24.0 * k, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -95.0 * k, s * 10.0 * k, s * 18.0 * k)
            setr(p, f"{side}Forearm", -15.0 * k, 0, 0)
            setr(p, f"{side}Ear", 25.0 * k, 0, 0)
        self.fingers_open(p, k)
        self.wings(p, fold=lerp(55.0, -12.0, k), flap=lerp(-8.0, 26.0, k), tip=lerp(40.0, -14.0, k))
        setr(p, "rightLeg", -26.0 * k, 0, 2.0)
        setr(p, "rightShin", 20.0 * k, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 14.0 * k, 0, -2.0)
        flat_foot(p, "left", toe=10.0 * k)
        meta(p, z=-9.0 * k)
        return p

    def jumpscare1_post(self, p, t):
        on = self.scream_shake(p, t, 0.2, 1.1)
        f = flip(t, 10) * on
        add_rot(p, "rightWing", 0, 0, 5.0 * f)
        add_rot(p, "leftWing", 0, 0, -5.0 * f)

    def jumpscare2(self, t):
        """Wings folded tight and head bowed... then the head snaps up, wings and arms fling wide, screaming."""
        p = {}
        b = ease((t - 0.45) / 0.08)
        setr(p, "head", lerp(30.0, -24.0, b), 0, 0)
        setr(p, "torso", lerp(10.0, -2.0, b), 0, 0)
        setr(p, "jaw", 26.0 * b, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(-50.0, -40.0, b), 0, s * lerp(-24.0, 80.0, b))
            setr(p, f"{side}Forearm", lerp(-90.0, -25.0, b), 0, 0)
            setr(p, f"{side}Ear", lerp(30.0, -10.0, b), 0, 0)
        self.fingers_open(p, b)
        self.wings(p, fold=lerp(55.0, -8.0, b), flap=lerp(-10.0, 30.0, b), tip=lerp(40.0, -16.0, b))
        self.stance(p, 2.0, lerp(6.0, 2.0, b))
        meta(p, z=-5.0 * b)
        return p

    def jumpscare2_post(self, p, t):
        add_rot(p, "head", 0, 6.0 * window(t, 0.15, 0.3, 0.02), 0)      # a tiny twitch before
        self.scream_shake(p, t, 0.55, 1.4)


# ==========================================================================
# Crocodile
# ==========================================================================


class CrocNight(CastNight):
    IK_CLIPS = ("pose2",)

    def walk_len(self):
        return 1.8

    def hunch(self, p, k=1.0):
        setr(p, "body", 6.0 * k, 0, 0)
        setr(p, "torso", 12.0 * k, 0, 0)

    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        self.hunch(p)
        setr(p, "head", -12.0, 16.0 * sn(w), 4.0 * sn(w))
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -14.0 + 3.0 * sn(w + s), 0, s * 4.0)
            setr(p, f"{side}Forearm", -20.0, 0, 0)
            self.curl(p, side, 0.4 + 0.3 * sn(2 * w + s))
        self.stance(p, 4.0, 6.0)
        self.tail_sway(p, w, 6.0, 0.0, lag=0.4)
        meta(p)
        return p

    def idle_post(self, p, t):
        # the jaw creeps open for two seconds... then snaps shut
        creep = clamp01((t % 3.0) / 2.6) if (t % 3.0) < 2.6 else 0.0
        add_rot(p, "jaw", 20.0 * creep, 0, 0)

    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        # heavy waddle: body rolls onto each leg, tail swings the other way
        setr(p, "body", 8.0, -6.0 * sn(f), 6.0 * cs(f))
        setr(p, "torso", 12.0, 4.0 * sn(f), -2.0 * cs(f))
        setr(p, "head", -16.0, -6.0 * sn(f), -4.0 * cs(f))
        self.legs_gait(p, f, 16.0, 22.0, toe=6.0, spread=4.0)
        self.arms_gait(p, f, 8.0, base=-18.0, out=4.0, elbow=-24.0)
        for side in ("right", "left"):
            self.curl(p, side, 0.5)
        self.tail_sway(p, f + math.pi, 9.0, 0.0, lag=0.45)
        setr(p, "jaw", 4.0, 0, 0)
        meta(p)
        return p

    def run(self, t):
        f = TAU * t / 0.8
        p = {}
        setr(p, "body", 28.0, -4.0 * sn(f), 0)
        setr(p, "torso", 10.0, 6.0 * sn(f), 0)
        setr(p, "head", -32.0, 0, 0)
        setr(p, "jaw", 18.0, 0, 0)
        self.legs_gait(p, f, 36.0, 64.0, toe=12.0, spread=3.0, lift_phase=0.45)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -55.0 + 12.0 * sn(f + (0 if s > 0 else math.pi)), 0, s * 10.0)
            setr(p, f"{side}Forearm", -30.0, 0, 0)
        self.fingers_open(p, 0.8)
        self.tail_sway(p, f, 4.0, 0.0, lift=-20.0)
        meta(p, extra=0.8 * pos(sn(2 * f + 0.9)))
        return p

    def pose1(self, t):
        """The picture: hunched, right arm hanging forward, left claw curled up, head tilted, mouth open."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 8.0, 10.0, -4.0)
        setr(p, "torso", 14.0 + 1.0 * sn(w), 6.0, 4.0)
        setr(p, "head", -8.0, -12.0, 14.0 + 2.0 * sn(w))
        setr(p, "jaw", 14.0, 0, 0)
        setr(p, "rightArm", -34.0, 0, 6.0)
        setr(p, "rightForearm", -24.0, 0, 0)
        self.curl(p, "right", 0.6)
        setr(p, "leftArm", -40.0, 0, -12.0)
        setr(p, "leftForearm", -80.0, 0, 0)
        setr(p, "leftHand", -20.0, 0, 0)
        self.curl(p, "left", 1.0)
        setr(p, "rightLeg", -14.0, 0, 3.0)
        setr(p, "rightShin", 18.0, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 8.0, 0, -4.0)
        setr(p, "leftShin", 10.0, 0, 0)
        flat_foot(p, "left")
        self.tail_sway(p, w, 6.0, 0.0, lag=0.4)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "jaw", -14.0 * window(t, 1.3, 1.45, 0.01), 0, 0)      # a quick snap

    def pose2(self, t):
        """Tips his top hat with a little bow, other hand on his belly."""
        w = TAU * t / 2.0
        lift = 0.5 - 0.5 * cs(w)
        p = {}
        setr(p, "body", 4.0, 0, 0)
        setr(p, "torso", 8.0 + 14.0 * lift, -6.0, 0)
        setr(p, "head", -6.0 + 8.0 * lift, -8.0, 6.0 * lift)
        setr(p, "hat", 12.0 * lift, 0, 10.0 * lift)
        setp(p, "hat", -0.6 * lift, 1.6 * lift, 0)
        top = self.D["top"]
        goal = bone_goal("hat", (-0.6, top + 0.4, -2.4), normal=(1, 0, 0), fingers=(0, 1, 0.2), elbow=(-14.0, 38.0, -2.0))
        self.arm_ik("pose2_left", p, "left", goal, [-130, 20, -30, -60, 0, 0, 0, 0, 0])
        c0 = self.D["torso"][0]
        goal = torso_goal((1.0, c0 + 5.0, -self.D["torso_d"] - 1.2), normal=(0, 0, 1), fingers=(-0.9, -0.2, -0.3),
                          elbow=(12.0, c0 + 6.0, 0.0))
        self.arm_ik("pose2_right", p, "right", goal, [-40, 30, 20, -90, 0, 0, 0, 0, 0])
        self.stance(p, 3.0, 2.0)
        self.tail_sway(p, w, 6.0)
        meta(p)
        return p

    def performance1(self, t):
        """Soft-shoe shuffle: sliding side to side, little kicks, hat bobbing, tail swishing."""
        p = {}
        side = sn(TAU * t / 2.0)
        setp(p, "body", 1.6 * side, 0, 0)
        setr(p, "body", 4.0, 8.0 * side, -4.0 * side)
        setr(p, "torso", 8.0, -6.0 * side, 4.0 * side)
        setr(p, "head", -10.0 + 4.0 * pos(cs(TAU * t)), 10.0 * side, -6.0 * side)
        setr(p, "hat", 0, 0, 8.0 * side)
        kick = pos(sn(TAU * t))
        for sd in ("right", "left"):
            s = S[sd]
            mine = pos(s * side)
            setr(p, f"{sd}Leg", -16.0 * kick * mine, 0, s * 3.0)
            setr(p, f"{sd}Shin", 20.0 * kick * mine, 0, 0)
            flat_foot(p, sd, toe=-18.0 * kick * mine)
            setr(p, f"{sd}Arm", -30.0 - 20.0 * s * side, 0, s * (14.0 + 8.0 * mine))
            setr(p, f"{sd}Forearm", -50.0, 0, 0)
            setr(p, f"{sd}Hand", 0, -s * 30.0, 0)
            setr(p, f"{sd}Fingers", 0, 0, s * 30.0)
        self.tail_sway(p, TAU * t / 2.0 + 1.0, 14.0, lag=0.5)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 1.3), 0, 0)

    def performance2(self, t):
        """The snap song: jazz hands out wide, swaying, the jaw snapping shut on every beat."""
        p = {}
        sway = sn(TAU * t / 2.0)
        setr(p, "body", 2.0, 0, 4.0 * sway)
        setr(p, "torso", 6.0, 6.0 * sway, 3.0 * sway)
        setr(p, "head", -12.0, -8.0 * sway, 6.0 * sway)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", -20.0, 0, s * 72.0)
            setr(p, f"{sd}Forearm", -45.0, 0, 0)
            setr(p, f"{sd}Hand", 0, -s * 50.0, 0)
        self.fingers_open(p, 1.0)
        self.stance(p, 4.0, 4.0 + 3.0 * pos(cs(TAU * t)))
        self.tail_sway(p, TAU * t / 2.0, 10.0)
        meta(p)
        return p

    def performance2_post(self, p, t):
        b = (t % 0.5) / 0.5
        add_rot(p, "jaw", 22.0 * clamp01(b / 0.8) if b < 0.8 else 0.0, 0, 0)    # opens... SNAP on the beat
        for sd in ("right", "left"):
            add_rot(p, f"{sd}Fingers", 0, 0, -S[sd] * 30.0 * pulse(t, 0.5, 0.08, 0.02))

    def jumpscare1(self, t):
        """Lunges with the snout gaping, snapping shut three times."""
        p = {}
        k = ease((t - 0.05) / 0.14)
        setr(p, "body", 22.0 * k, 0, 0)
        setr(p, "torso", 14.0 * k, 0, 0)
        setr(p, "head", -34.0 * k, 0, 0)
        setr(p, "jaw", 30.0 * k, 0, 0)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", -85.0 * k, s * 12.0 * k, s * 16.0 * k)
            setr(p, f"{sd}Forearm", -20.0 * k, 0, 0)
        self.fingers_open(p, k)
        setr(p, "rightLeg", -28.0 * k, 0, 3.0)
        setr(p, "rightShin", 22.0 * k, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 16.0 * k, 0, -3.0)
        flat_foot(p, "left", toe=12.0 * k)
        self.tail_sway(p, 0.0, 0.0, lift=-20.0 * k)
        meta(p, z=-10.0 * k)
        return p

    def jumpscare1_post(self, p, t):
        snaps = sum(window(t, t0, t0 + 0.08, 0.01) for t0 in (0.35, 0.6, 0.85))
        add_rot(p, "jaw", -28.0 * snaps, 0, 0)
        self.scream_shake(p, t, 0.25, 1.1, head=5.0)

    def jumpscare2(self, t):
        """The death roll: head and body twist hard one way and back while the jaw snaps."""
        p = {}
        k = ease((t - 0.1) / 0.15)
        roll = math.sin(TAU * clamp01((t - 0.25) / 1.0)) * k
        setr(p, "body", 18.0 * k, 0, 18.0 * roll)
        setr(p, "torso", 10.0 * k, 10.0 * roll, 14.0 * roll)
        setr(p, "head", -28.0 * k, 0, 50.0 * roll)
        setr(p, "jaw", 26.0 * k, 0, 0)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", -80.0 * k, 0, s * 20.0 * k)
            setr(p, f"{sd}Forearm", -30.0 * k, 0, 0)
        self.fingers_open(p, k)
        self.stance(p, 4.0, 10.0 * k)
        self.tail_sway(p, 0.0, 0.0, lift=-15.0 * k)
        meta(p, z=-7.0 * k)
        return p

    def jumpscare2_post(self, p, t):
        add_rot(p, "jaw", -24.0 * (flip(t, 5) > 0) * window(t, 0.3, 1.3, 0.02), 0, 0)


# ==========================================================================
# Fox
# ==========================================================================


class FoxNight(CastNight):
    IK_CLIPS = ("pose1",)
    LENGTHS = dict(CastNight.LENGTHS, run=0.6)

    def walk_len(self):
        return 1.3

    def hook_up(self, p, k=1.0):
        """Upper arm forward, forearm straight up: the hook raised beside his head (k = 0 hangs it)."""
        setr(p, "rightArm", -6.0 - 84.0 * k, 0, 2.0 - 22.0 * k)
        setr(p, "rightForearm", -14.0 - 76.0 * k, 0, 0)

    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        shift = sn(w)
        setr(p, "body", 0, 0, 3.0 * shift)
        setr(p, "torso", 2.0, -6.0 * shift, -2.0 * shift)
        setr(p, "head", 2.0, 26.0 * swing(2 * w, 0.4), -4.0 * shift)
        self.hook_up(p, 0.5 - 0.5 * cs(w))         # slowly raises the hook and lowers it again
        setr(p, "leftArm", -4.0, 0, -4.0)
        setr(p, "leftForearm", -14.0, 0, 0)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Leg", -2.0 * s * shift, 0, s * (3.0 + 2.0 * s * shift))
            flat_foot(p, sd)
        self.tail_sway(p, 2 * w, 10.0, 6.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        add_rot(p, "rightEar", 0, 0, -12.0 * window(t, 1.6, 1.8, 0.02))
        add_rot(p, "leftEar", 0, 0, 12.0 * window(t, 4.1, 4.3, 0.02))
        add_rot(p, "jaw", 10.0 * window(t, 3.0, 3.4, 0.03), 0, 0)

    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        # pirate swagger: shoulders rolling, hook swinging, tail swaying
        setr(p, "body", 4.0, -8.0 * sn(f), 5.0 * cs(f))
        setr(p, "torso", 4.0, 12.0 * sn(f), -4.0 * cs(f))
        setr(p, "head", -2.0, -10.0 * sn(f), 4.0 * cs(f))
        self.legs_gait(p, f, 24.0, 30.0, toe=8.0, spread=4.0)
        self.arms_gait(p, f, 22.0, base=-8.0, out=6.0, elbow=-30.0)
        self.tail_sway(p, f + math.pi, 14.0, 4.0, lag=0.5)
        meta(p, extra=0.4 * pos(cs(2 * f)))
        return p

    def run(self, t):
        f = TAU * t / 0.6
        p = {}
        # the sprint: leaning far forward, arms swinging low and back, long strides
        setr(p, "body", 38.0, -4.0 * sn(f), 0)
        setr(p, "torso", 10.0, 8.0 * sn(f), 0)
        setr(p, "head", -44.0, 0, 0)
        setr(p, "jaw", 16.0, 0, 0)
        self.legs_gait(p, f, 46.0, 90.0, toe=14.0, spread=2.0, lift_phase=0.5)
        for sd in ("right", "left"):
            s = S[sd]
            ph = f + (math.pi if s > 0 else 0)
            setr(p, f"{sd}Arm", 40.0 + 36.0 * sn(ph), 0, s * 12.0)
            setr(p, f"{sd}Forearm", -30.0, 0, 0)
        self.tail_sway(p, f, 6.0, 4.0, lift=-35.0)
        meta(p, extra=1.8 * pos(sn(2 * f + 0.9)))
        return p

    def pose1(self, t):
        """The picture: hook raised, other hand on his hip, wide stance, head tilted."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 2.0, -8.0, 4.0)
        setr(p, "torso", 4.0 + 1.0 * sn(w), -6.0, 4.0)
        setr(p, "head", 2.0, 10.0, -10.0 + 2.0 * sn(w))
        setr(p, "jaw", 10.0, 0, 0)
        self.hook_up(p)
        self.arm_ik("pose1_left", p, "left", self.hip_goal("left"), [10, 0, -40, -70, 0, 0, 0, 0, 0])
        setr(p, "rightLeg", -16.0, -10.0, 16.0)
        setr(p, "rightShin", 20.0, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 6.0, 8.0, -12.0)
        setr(p, "leftShin", 8.0, 0, 0)
        flat_foot(p, "left")
        self.tail_sway(p, w, 8.0, 4.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "rightHand", 0, 20.0 * window(t, 0.8, 1.2, 0.04), 0)    # turns the hook to glint it

    def pose2(self, t):
        """Peeking out from behind the curtain of his cove."""
        w = TAU * t / 2.0
        p = {}
        lean = 0.8 + 0.2 * sn(w)
        setr(p, "body", 4.0, 10.0, 18.0 * lean)
        setr(p, "torso", 6.0, 10.0, 10.0 * lean)
        setr(p, "head", 6.0, 26.0, 22.0 * lean)
        setr(p, "leftArm", -150.0, 0, -10.0)
        setr(p, "leftForearm", -30.0, 0, 0)
        self.curl(p, "left", 1.0)
        setr(p, "rightArm", -70.0, 0, -10.0)
        setr(p, "rightForearm", -100.0, 0, 0)
        setr(p, "rightLeg", -6.0, 0, 18.0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 4.0, 0, -2.0)
        flat_foot(p, "left")
        self.tail_sway(p, w, 10.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "head", 0, -16.0 * window(t, 1.0, 1.4, 0.04), 0)

    def performance1(self, t):
        """Sea shanty: rocking like the deck of a ship, hook raised on every "yo-ho", foot stomping."""
        p = {}
        roll = sn(TAU * t / 2.0)
        setr(p, "body", 0, 0, 8.0 * roll)
        setr(p, "torso", 2.0, 4.0 * roll, 4.0 * roll)
        setr(p, "head", -4.0, 6.0 * roll, -8.0 * roll)
        yo = window(t % 2.0, 0.9, 1.6, 0.12)
        self.hook_up(p, 0.45 + 0.55 * yo)
        setr(p, "leftArm", -20.0, 0, -30.0 - 30.0 * yo)
        setr(p, "leftForearm", -60.0, 0, 0)
        stomp = pos(sn(TAU * t))
        setr(p, "rightLeg", -20.0 * stomp, 0, 6.0)
        setr(p, "rightShin", 26.0 * stomp, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 0, 0, -6.0)
        flat_foot(p, "left")
        self.tail_sway(p, TAU * t / 2.0, 12.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 1.1), 0, 0)

    def performance2(self, t):
        """Sword fight with the hook: diagonal slashes, lunging forward on each one."""
        p = {}
        n = int((t % 4.0) // 1.0)
        u = (t % 1.0)
        slash = ease(u / 0.25) * (1 - ease((u - 0.6) / 0.35))
        dirs = [(-130, 40), (-60, -30), (-140, -20), (-70, 50)]
        a0 = dirs[n]
        setr(p, "rightArm", lerp(-60.0, a0[0], slash), lerp(0.0, a0[1], slash), lerp(20.0, 50.0, slash))
        setr(p, "rightForearm", lerp(-80.0, -10.0, slash), 0, 0)
        setr(p, "leftArm", -20.0, 0, -40.0)
        setr(p, "leftForearm", -40.0, 0, 0)
        setr(p, "body", 10.0 * slash, 0, 0)
        setr(p, "torso", 6.0 * slash, (-14.0 if n % 2 else 14.0) * slash, 0)
        setr(p, "head", -8.0 * slash, (-10.0 if n % 2 else 10.0) * slash, 0)
        setr(p, "rightLeg", -26.0 * slash, 0, 4.0)
        setr(p, "rightShin", 24.0 * slash, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 18.0 * slash, 0, -4.0)
        setr(p, "leftShin", 10.0 * slash, 0, 0)
        flat_foot(p, "left")
        self.tail_sway(p, TAU * t, 12.0)
        meta(p, z=-2.0 * slash)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", 14.0 * pulse(t, 1.0, 0.3, 0.03, phase=0.1), 0, 0)

    def jumpscare1(self, t):
        """Two sprint strides, then the leap at the camera, hook up, screaming."""
        p = {}
        run = 1.0 - ease((t - 0.35) / 0.08)
        f = TAU * t / 0.3
        leap = ease((t - 0.35) / 0.12)
        setr(p, "body", 38.0 * run + 10.0 * leap, 0, 0)
        setr(p, "torso", 10.0 * run, 0, 0)
        setr(p, "head", -44.0 * run - 26.0 * leap, 0, 0)
        setr(p, "jaw", 10.0 * run + 26.0 * leap, 0, 0)
        for sd in ("right", "left"):
            s = S[sd]
            ph = f + (0 if s > 0 else math.pi)
            setr(p, f"{sd}Leg", (-46.0 * sn(ph)) * run - 20.0 * leap, 0, s * 2.0)
            setr(p, f"{sd}Shin", (40.0 + 40.0 * pos(cs(ph))) * run + 20.0 * leap, 0, 0)
            flat_foot(p, sd, toe=10.0 * leap)
        setr(p, "rightArm", lerp(40.0, -150.0, leap), 0, lerp(12.0, 20.0, leap))
        setr(p, "rightForearm", lerp(-30.0, -10.0, leap), 0, 0)
        setr(p, "leftArm", lerp(40.0, -100.0, leap), 0, -lerp(12.0, 20.0, leap))
        self.fingers_open(p, leap, sides=("left",))
        self.tail_sway(p, 0.0, 0.0, lift=-35.0)
        meta(p, extra=2.4 * leap * (1 - ease((t - 0.7) / 0.1)), z=-12.0 * leap - 3.0 * (t / 0.35) * run)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.5, 1.15)

    def jumpscare2(self, t):
        """A hook swipe straight across the camera, head jerking."""
        p = {}
        wind = ease(t / 0.2) * (1 - ease((t - 0.3) / 0.05))
        sw = ease((t - 0.3) / 0.08)
        setr(p, "body", 10.0 * sw, 0, 0)
        setr(p, "torso", 4.0, lerp(20.0 * wind, -30.0, sw), 0)
        setr(p, "head", -20.0 * sw, -10.0 * sw, 0)
        setr(p, "jaw", 26.0 * sw, 0, 0)
        setr(p, "rightArm", lerp(-80.0, -90.0, sw), lerp(60.0 * wind, -70.0, sw), 20.0)
        setr(p, "rightForearm", -10.0, 0, 0)
        setr(p, "leftArm", -60.0 * sw, 0, -30.0)
        self.fingers_open(p, sw, sides=("left",))
        self.stance(p, 4.0, 8.0)
        meta(p, z=-8.0 * sw)
        return p

    def jumpscare2_post(self, p, t):
        self.scream_shake(p, t, 0.42, 1.4, head=8.0, rate=8)


# ==========================================================================
# Bunny
# ==========================================================================


class BunnyNight(CastNight):
    LENGTHS = dict(CastNight.LENGTHS, run=0.6)

    def walk_len(self):
        return 1.2

    def ears_flop(self, p, phase, amp=8.0, back=0.0):
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Ear", back, 0, -s * 3.0 * sn(phase))
            setr(p, f"{sd}EarTop", back * 0.6 + amp * sn(phase - 0.8), 0, 0)

    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        setr(p, "torso", 1.0 * sn(w), 4.0 * sn(w), 0)
        setr(p, "head", 2.0 * sn(2 * w), 14.0 * sn(w), 10.0 * swing(w + 0.5, 0.5))
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", -4.0, 0, s * 2.0)
            setr(p, f"{sd}Forearm", -12.0, 0, 0)
            self.curl(p, sd, 0.4)
        self.stance(p, 2.0)
        self.ears_flop(p, 2 * w, 6.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        for t0, sd in ((0.8, "left"), (2.1, "right"), (3.5, "left"), (5.0, "right")):
            add_rot(p, f"{sd}Ear", -10.0 * window(t, t0, t0 + 0.15, 0.02), 0, 0)
        add_rot(p, "head", 0, 0, -16.0 * window(t, 4.2, 4.5, 0.03))
        for sd in ("right", "left"):
            add_rot(p, f"{sd}Fingers", 0, 0, S[sd] * 20.0 * window(t, 2.8, 3.0, 0.02))

    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        # bouncy hop-step
        setr(p, "body", 6.0, -3.0 * sn(f), 2.0 * cs(f))
        setr(p, "torso", 4.0, 5.0 * sn(f), 0)
        setr(p, "head", -4.0 + 4.0 * cs(2 * f), -4.0 * sn(f), 0)
        self.legs_gait(p, f, 18.0, 38.0, toe=12.0, spread=1.5, lift_phase=0.2)
        self.arms_gait(p, f, 16.0, base=-10.0, out=3.0, elbow=-30.0)
        self.ears_flop(p, 2 * f, 12.0)
        meta(p, extra=1.4 * pos(cs(2 * f)))
        return p

    def run(self, t):
        f = TAU * t / 0.6
        p = {}
        # hopping run: both legs together, ears streaming back
        hop = pos(sn(f))
        setr(p, "body", 14.0 + 8.0 * hop, 0, 0)
        setr(p, "torso", 6.0, 0, 0)
        setr(p, "head", -18.0 - 6.0 * hop, 0, 0)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Leg", lerp(-10.0, 30.0, hop), 0, s * 3.0)
            setr(p, f"{sd}Shin", lerp(48.0, 10.0, hop), 0, 0)
            flat_foot(p, sd, toe=30.0 * hop)
            setr(p, f"{sd}Arm", lerp(20.0, -55.0, hop), 0, s * 14.0)
            setr(p, f"{sd}Forearm", -40.0, 0, 0)
        self.ears_flop(p, f, 10.0, back=35.0)
        setr(p, "jaw", 10.0, 0, 0)
        meta(p, extra=2.6 * hop)
        return p

    def pose1(self, t):
        """The picture: reaching out with his right claw, leaning, head tilted, ear folded."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 4.0, -10.0, 6.0)
        setr(p, "torso", 6.0 + 1.0 * sn(w), -8.0, 4.0)
        setr(p, "head", 4.0, 10.0, 12.0 + 2.0 * sn(w))
        setr(p, "rightArm", -72.0 + 3.0 * sn(w), -24.0, 22.0)
        setr(p, "rightForearm", -30.0, 0, 0)
        setr(p, "rightHand", -20.0, 0, 0)
        self.fingers_open(p, 1.0, sides=("right",))
        setr(p, "leftArm", 4.0, 0, -4.0)
        setr(p, "leftForearm", -18.0, 0, 0)
        self.curl(p, "left", 0.9)
        setr(p, "rightLeg", -22.0, -8.0, 6.0)
        setr(p, "rightShin", 24.0, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 8.0, 6.0, -4.0)
        setr(p, "leftShin", 6.0, 0, 0)
        flat_foot(p, "left")
        setr(p, "jaw", 5.0, 0, 0)
        self.ears_flop(p, w, 4.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "rightFingers", 0, 0, -20.0 * window(t, 0.7, 1.0, 0.03))

    def pose2(self, t):
        """The creepy tilt: head lolled right over, ears drooping, arms limp, swaying."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 6.0, 0, 4.0 * sn(w))
        setr(p, "torso", 10.0, 0, 3.0 * sn(w))
        setr(p, "head", 6.0, 8.0, 48.0 + 4.0 * sn(w))
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", -14.0, 0, s * 2.0)
            setr(p, f"{sd}Forearm", -4.0, 0, 0)
            setr(p, f"{sd}Hand", 20.0, 0, 0)
            setr(p, f"{sd}Ear", 30.0, 0, s * 20.0)
        self.stance(p, 2.0, 6.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "jaw", 12.0 * window(t, 1.0, 1.4, 0.04), 0, 0)

    def performance1(self, t):
        """Air guitar: left hand up the neck, right hand strumming, head banging on the beat."""
        p = {}
        bang = pos(cs(TAU * t))
        setr(p, "body", 2.0, 0, 2.0 * sn(TAU * t / 2.0))
        setr(p, "torso", 4.0 + 4.0 * bang, -14.0, 0)
        setr(p, "head", -4.0 + 16.0 * bang, -6.0, 0)
        setr(p, "leftArm", -64.0, -20.0, -42.0)
        setr(p, "leftForearm", -70.0, 0, 0)
        setr(p, "leftHand", 0, 40.0, 0)
        self.curl(p, "left", 0.7)
        strum = sn(TAU * t * 4.0)
        setr(p, "rightArm", -40.0, 20.0, 10.0)
        setr(p, "rightForearm", -95.0, 0, 0)
        setr(p, "rightHand", 25.0 * strum, 0, 0)
        self.curl(p, "right", 0.6)
        self.stance(p, 4.0, 6.0 * bang)
        self.ears_flop(p, TAU * t, 10.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.9), 0, 0)

    def performance2(self, t):
        """Hop dance: hopping side to side, arms waving overhead one at a time."""
        p = {}
        side = math.copysign(1.0, sn(TAU * t / 1.0))
        hop = abs(sn(TAU * t / 1.0))
        setp(p, "body", -1.6 * side * ease(hop), 0, 0)
        setr(p, "body", 0, 0, 5.0 * side)
        setr(p, "torso", 2.0, 0, -4.0 * side)
        setr(p, "head", 0, 8.0 * side, -8.0 * side)
        for sd in ("right", "left"):
            s = S[sd]
            up = 1.0 if (s > 0) == (side > 0) else 0.0
            setr(p, f"{sd}Arm", -160.0 * up - 10.0 * (1 - up), 0, s * (10.0 + 10.0 * up))
            setr(p, f"{sd}Forearm", -20.0, 0, 0)
            setr(p, f"{sd}Leg", -10.0 * hop, 0, s * 3.0)
            setr(p, f"{sd}Shin", 20.0 * hop, 0, 0)
            flat_foot(p, sd, toe=10.0 * hop)
        self.fingers_open(p, 0.8)
        self.ears_flop(p, TAU * t * 2.0, 14.0)
        meta(p, extra=1.6 * hop)
        return p

    def jumpscare1(self, t):
        """Ducks down low, then springs up into the camera with ears snapping upright."""
        p = {}
        d = ease(t / 0.25) * (1 - ease((t - 0.3) / 0.1))
        u = ease((t - 0.3) / 0.1)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Leg", -50.0 * d - 10.0 * u, 0, s * 4.0)
            setr(p, f"{sd}Shin", 90.0 * d + 10.0 * u, 0, 0)
            flat_foot(p, sd)
            setr(p, f"{sd}Arm", lerp(10.0, -150.0, u), 0, s * lerp(4.0, 30.0, u))
            setr(p, f"{sd}Forearm", -20.0 * u, 0, 0)
            setr(p, f"{sd}Ear", 20.0 * d - 10.0 * u, 0, 0)
            setr(p, f"{sd}EarTop", 30.0 * d, 0, 0)
        self.fingers_open(p, u)
        setr(p, "body", 30.0 * d + 10.0 * u, 0, 0)
        setr(p, "head", 20.0 * d - 26.0 * u, 0, 0)
        setr(p, "jaw", 24.0 * u, 0, 0)
        meta(p, z=-9.0 * u)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.45, 1.15)

    def jumpscare2(self, t):
        """Leans in slowly, head tilting... then the scream, arms flung up."""
        p = {}
        lean = ease(t / 0.8)
        b = ease((t - 0.82) / 0.07)
        setr(p, "body", 8.0 * lean, 0, 0)
        setr(p, "torso", 14.0 * lean, 0, 0)
        setr(p, "head", 10.0 * lean - 34.0 * b, 0, 30.0 * lean * (1 - b))
        setr(p, "jaw", 6.0 * lean + 22.0 * b, 0, 0)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", lerp(-6.0, -130.0, b), 0, s * lerp(2.0, 50.0, b))
            setr(p, f"{sd}Ear", 10.0 * lean - 20.0 * b, 0, 0)
            setr(p, f"{sd}EarTop", 20.0 * lean * (1 - b), 0, 0)
        self.fingers_open(p, b)
        self.stance(p, 2.5, 4.0)
        meta(p, z=-4.0 * lean - 4.0 * b)
        return p

    def jumpscare2_post(self, p, t):
        self.scream_shake(p, t, 0.9, 1.45)


# ==========================================================================
# Goat
# ==========================================================================


class GoatNight(CastNight):
    IK_CLIPS = ("pose1", "performance1")
    LENGTHS = dict(CastNight.LENGTHS, run=0.75)

    def walk_len(self):
        return 1.4

    def belly_hand(self, key, p):
        c0 = self.D["torso"][0]
        goal = torso_goal((-0.6, c0 + 4.5, -self.D["torso_d"] - 1.4), normal=(0, 0, 1), fingers=(0.9, -0.2, -0.3),
                          elbow=(-12.0, c0 + 6.0, 0.0))
        self.arm_ik(key, p, "left", goal, [-40, -30, -20, -90, 0, 0, 0, 0, 0])

    def ears_flop(self, p, phase, amp=8.0):
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Ear", amp * 0.5 * sn(phase + s), 0, s * amp * sn(phase + 0.6 * s))

    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        setr(p, "torso", 2.0 + 1.0 * sn(w), 0, 0)
        setr(p, "head", 4.0 + 3.0 * sn(2 * w), 14.0 * sn(w), -8.0 * swing(w + 1.0, 0.5))
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", -4.0, 0, s * 2.0)
            setr(p, f"{sd}Forearm", -14.0, 0, 0)
            self.curl(p, sd, 0.5)
        self.stance(p, 2.0)
        self.ears_flop(p, 2 * w, 6.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        # chewing: the jaw grinds side to side in little servo steps
        chew = window(t, 0.5, 2.5, 0.1) + window(t, 3.6, 5.4, 0.1)
        add_rot(p, "jaw", 5.0 * chew * (flip(t, 2) > 0), 6.0 * chew * flip(t, 2), 0)
        stamp = window(t, 2.8, 3.0, 0.03)
        add_rot(p, "rightLeg", -14.0 * stamp, 0, 0)
        add_rot(p, "rightShin", 24.0 * stamp, 0, 0)
        add_rot(p, "rightFoot", -10.0 * stamp, 0, 0)

    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        # stiff high-stepping trot, head bobbing forward and back
        setr(p, "body", 4.0, -3.0 * sn(f), 3.0 * cs(f))
        setr(p, "torso", 2.0, 4.0 * sn(f), 0)
        setr(p, "head", 6.0 * cs(2 * f), -5.0 * sn(f), 0)
        setp(p, "head", 0, 0, -0.8 * cs(2 * f))
        self.legs_gait(p, f, 18.0, 60.0, toe=10.0, spread=2.0, lift_phase=0.0, k=1.0)
        self.arms_gait(p, f, 14.0, base=-6.0, out=3.0, elbow=-18.0)
        self.ears_flop(p, 2 * f, 10.0)
        meta(p)
        return p

    def run(self, t):
        f = TAU * t / 0.75
        p = {}
        # ram charge: head down, horns first
        setr(p, "body", 14.0, -3.0 * sn(f), 0)
        setr(p, "torso", 10.0, 4.0 * sn(f), 0)
        setr(p, "head", 22.0, 0, 0)
        self.legs_gait(p, f, 40.0, 76.0, toe=12.0, spread=2.0, lift_phase=0.45)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", 30.0 + 20.0 * sn(f + (math.pi if s > 0 else 0)), 0, s * 10.0)
            setr(p, f"{sd}Forearm", -40.0, 0, 0)
            self.curl(p, sd, 1.0)
        self.ears_flop(p, f, 16.0)
        meta(p, extra=1.2 * pos(sn(2 * f + 0.9)))
        return p

    def pose1(self, t):
        """The picture: one hand on his belly, the other hanging with curled fingers, head tilted."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 2.0, 6.0, -4.0)
        setr(p, "torso", 4.0 + 1.0 * sn(w), 6.0, -2.0)
        setr(p, "head", 4.0, -10.0, -16.0 + 2.0 * sn(w))
        setr(p, "jaw", 8.0, 0, 0)
        self.belly_hand("pose1_left", p)
        setr(p, "rightArm", -6.0, 0, 4.0)
        setr(p, "rightForearm", -24.0, 0, 0)
        self.curl(p, "right", 1.0)
        self.stance(p, 3.0, 2.0)
        self.ears_flop(p, w, 4.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "jaw", 0, 6.0 * window(t, 1.1, 1.5, 0.04), 0)

    def pose2(self, t):
        """Head down, horns forward, pawing the ground with a hoof."""
        p = {}
        setr(p, "body", 12.0, 0, 0)
        setr(p, "torso", 12.0, 0, 0)
        setr(p, "head", 30.0, 0, 0)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", -30.0, 0, s * 26.0)
            setr(p, f"{sd}Forearm", -50.0, 0, 0)
            self.curl(p, sd, 1.0)
        paw = sn(TAU * t)
        setr(p, "rightLeg", -10.0 + 18.0 * paw, 0, 3.0)
        setr(p, "rightShin", 30.0 + 10.0 * pos(-paw), 0, 0)
        flat_foot(p, "right", toe=10.0)
        setr(p, "leftLeg", -6.0, 0, -3.0)
        setr(p, "leftShin", 10.0, 0, 0)
        flat_foot(p, "left")
        self.ears_flop(p, TAU * t, 6.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "head", 0, 10.0 * flip(t, 2) * window(t, 0.5, 1.5, 0.03), 0)

    def performance1(self, t):
        """A bleating belly laugh: hand on his belly, head shaking, jaw trembling."""
        p = {}
        laugh = window(t % 2.0, 0.3, 1.7, 0.2)
        setr(p, "body", 2.0, 0, 0)
        setr(p, "torso", 2.0 - 8.0 * laugh, 0, 0)
        setr(p, "head", -10.0 * laugh, 0, 0)
        self.belly_hand("perf1_left", p)
        setr(p, "rightArm", -30.0 * laugh, 0, 10.0 + 20.0 * laugh)
        setr(p, "rightForearm", -40.0, 0, 0)
        self.stance(p, 3.0, 3.0 * laugh)
        self.ears_flop(p, TAU * t * 2.0, 8.0 * laugh + 2.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        laugh = window(t % 2.0, 0.3, 1.7, 0.2)
        add_rot(p, "jaw", (10.0 + 6.0 * (flip(t, 8) > 0)) * laugh, 0, 0)
        add_rot(p, "head", 0, 8.0 * flip(t, 6) * laugh, 0)
        add_rot(p, "torso", 2.0 * flip(t, 4) * laugh, 0, 0)

    def performance2(self, t):
        """Stomp dance: alternating hoof stomps, arms marching, beard swinging."""
        p = {}
        n = int(t * 2.0) % 2
        u = (t * 2.0) % 1.0
        lift = ease(u / 0.3) * (1 - ease((u - 0.35) / 0.12))
        setr(p, "body", 2.0, 0, (4.0 if n else -4.0) * lift)
        setr(p, "torso", 4.0, (8.0 if n else -8.0), 0)
        setr(p, "head", 6.0 * lift, (10.0 if n else -10.0), 0)
        for sd in ("right", "left"):
            s = S[sd]
            mine = 1.0 if (n == 0) == (s > 0) else 0.0
            setr(p, f"{sd}Leg", -40.0 * lift * mine, 0, s * 3.0)
            setr(p, f"{sd}Shin", 60.0 * lift * mine, 0, 0)
            flat_foot(p, sd)
            setr(p, f"{sd}Arm", (-40.0 if mine else 20.0), 0, s * 6.0)
            setr(p, f"{sd}Forearm", -60.0, 0, 0)
            self.curl(p, sd, 1.0)
        self.ears_flop(p, TAU * t * 2.0, 12.0)
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", 10.0 * pulse(t, 0.5, 0.15, 0.02, phase=0.25), 0, 0)

    def jumpscare1(self, t):
        """Rears back, then rams his horns straight at the camera, bleating."""
        p = {}
        rear = ease(t / 0.2) * (1 - ease((t - 0.25) / 0.1))
        ram = ease((t - 0.25) / 0.1)
        setr(p, "body", -10.0 * rear + 24.0 * ram, 0, 0)
        setr(p, "torso", -8.0 * rear + 16.0 * ram, 0, 0)
        setr(p, "head", -20.0 * rear + 16.0 * ram, 0, 0)
        setr(p, "jaw", 10.0 * rear + 20.0 * ram, 0, 0)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", lerp(-60.0 * rear, 30.0, ram), 0, s * 20.0)
            setr(p, f"{sd}Forearm", -40.0, 0, 0)
            self.curl(p, sd, 1.0)
        setr(p, "rightLeg", -30.0 * ram, 0, 3.0)
        setr(p, "rightShin", 24.0 * ram, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 20.0 * ram, 0, -3.0)
        flat_foot(p, "left", toe=10.0 * ram)
        meta(p, z=2.0 * rear - 11.0 * ram)
        return p

    def jumpscare1_post(self, p, t):
        on = window(t, 0.35, 1.1, 0.03)
        add_rot(p, "jaw", 6.0 * (flip(t, 10) > 0) * on, 0, 0)
        add_rot(p, "head", 0, 0, 6.0 * flip(t, 12) * on)

    def jumpscare2(self, t):
        """The bleating scream: head thrashing side to side, jaw chattering."""
        p = {}
        k = ease((t - 0.1) / 0.12)
        setr(p, "body", 10.0 * k, 0, 0)
        setr(p, "torso", 8.0 * k, 0, 0)
        setr(p, "head", -20.0 * k, 0, 0)
        setr(p, "jaw", 22.0 * k, 0, 0)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", -70.0 * k, 0, s * 40.0 * k)
            setr(p, f"{sd}Forearm", -30.0 * k, 0, 0)
        self.fingers_open(p, k)
        self.stance(p, 3.0, 6.0 * k)
        meta(p, z=-7.0 * k)
        return p

    def jumpscare2_post(self, p, t):
        on = window(t, 0.25, 1.35, 0.02)
        add_rot(p, "head", 0, 24.0 * flip(t, 6) * on, 8.0 * flip(t, 6) * on)
        add_rot(p, "jaw", -10.0 * (flip(t, 12) > 0) * on, 0, 0)


# ==========================================================================
# Bear
# ==========================================================================


class BearNight(CastNight):
    IK_CLIPS = ("performance2",)
    LENGTHS = dict(CastNight.LENGTHS, run=0.9)

    def walk_len(self):
        return 1.9

    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        # dead still, the head slowly sinking over to one side
        tilt = ease((t % 3.0) / 2.6)
        setr(p, "torso", 1.0 * sn(w), 0, 0)
        setr(p, "head", 4.0, 0, -20.0 * tilt)
        self.arms_hang(p, fwd=2.0, out=2.0, elbow=-6.0)
        for sd in ("right", "left"):
            self.curl(p, sd, 0.5)
        self.stance(p, 2.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        for sd, t0 in (("right", 1.4), ("left", 4.4)):
            add_rot(p, f"{sd}Fingers", 0, 0, -S[sd] * 25.0 * window(t, t0, t0 + 0.15, 0.02))
        add_rot(p, "jaw", 8.0 * window(t, 5.0, 5.3, 0.03), 0, 0)

    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        # slow heavy lumber, rolling onto each leg, head lolling
        setr(p, "body", 4.0, -4.0 * sn(f), 7.0 * cs(f))
        setr(p, "torso", 4.0, 4.0 * sn(f), -3.0 * cs(f))
        setr(p, "head", 6.0, -4.0 * sn(f), 8.0 * cs(f))
        self.legs_gait(p, f, 16.0, 18.0, toe=4.0, spread=3.0)
        self.arms_gait(p, f, 6.0, base=-4.0, out=4.0, elbow=-8.0)
        meta(p, extra=-0.4 * pos(-cs(2 * f)))
        return p

    def run(self, t):
        f = TAU * t / 0.9
        p = {}
        setr(p, "body", 12.0, -5.0 * sn(f), 4.0 * cs(f))
        setr(p, "torso", 6.0, 8.0 * sn(f), 0)
        setr(p, "head", -10.0, 0, 0)
        setr(p, "jaw", 10.0, 0, 0)
        self.legs_gait(p, f, 32.0, 56.0, toe=10.0, spread=3.0, lift_phase=0.45)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", 30.0 * sn(f + (math.pi if s > 0 else 0)), 0, s * 18.0)
            setr(p, f"{sd}Forearm", -50.0, 0, 0)
            self.curl(p, sd, 1.0)
        meta(p, extra=0.6 * pos(sn(2 * f + 0.9)))
        return p

    def pose1(self, t):
        """The picture: arms hanging, head tilted over to his right, staring."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 2.0, 0, 0)
        setr(p, "torso", 4.0 + 1.0 * sn(w), 0, 2.0)
        setr(p, "head", 4.0, 4.0, -20.0 + 2.0 * sn(w))
        setr(p, "jaw", 6.0, 0, 0)
        self.arms_hang(p, fwd=4.0, out=3.0, elbow=-10.0)
        for sd in ("right", "left"):
            self.curl(p, sd, 0.8)
        self.stance(p, 2.5)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "head", 0, 0, -6.0 * window(t, 1.2, 1.4, 0.02))

    def pose2(self, t):
        """Slowly raises an arm and points straight at you."""
        p = {}
        k = ease(t / 0.7) * (1 - ease((t - 1.55) / 0.4))
        setr(p, "torso", 4.0, -8.0 * k, 0)
        setr(p, "head", 6.0 - 6.0 * k, -4.0 * k, -6.0)
        setr(p, "rightArm", -85.0 * k, -10.0 * k, 4.0)
        setr(p, "rightForearm", -6.0 * k, 0, 0)
        setr(p, "rightFingers", 0, 0, 10.0 * k)
        setr(p, "leftArm", 2.0, 0, -3.0)
        setr(p, "leftForearm", -10.0, 0, 0)
        self.curl(p, "left", 0.8)
        self.stance(p, 2.5)
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "jaw", 10.0 * window(t, 1.2, 1.5, 0.03), 0, 0)

    def performance1(self, t):
        """Conducts the band: the right hand beats out four-four, the left cues the players."""
        p = {}
        b = (t % 1.0)                          # one bar a second... four beats
        beat = int((t % 1.0) * 4)
        pattern = [(-60, 0), (-40, -25), (-40, 30), (-80, 10)]     # down, left, right, up
        a = pattern[beat]
        setr(p, "rightArm", a[0], a[1], 18.0)
        setr(p, "rightForearm", -50.0, 0, 0)
        setr(p, "rightHand", 20.0 * sn(TAU * b * 4), 0, 0)
        cue = window(t % 4.0, 1.5, 2.6, 0.2)
        setr(p, "leftArm", -40.0 - 40.0 * cue, 20.0 * cue, -20.0 - 20.0 * cue)
        setr(p, "leftForearm", -60.0 + 30.0 * cue, 0, 0)
        self.palm_up(p, "left", cue)
        setr(p, "torso", 4.0, 8.0 * sn(TAU * t / 4.0), 0)
        setr(p, "head", 2.0 + 4.0 * pos(cs(TAU * t * 2)), 10.0 * sn(TAU * t / 4.0), -4.0 * sn(TAU * t / 2.0))
        self.stance(p, 2.5, 2.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.9), 0, 0)

    def performance2(self, t):
        """A slow, deliberate clap, head tilting further with every one."""
        p = {}
        apart = 0.5 + 0.5 * cs(TAU * t / 1.0)
        n = int(t) % 4
        setr(p, "torso", 4.0, 0, 0)
        setr(p, "head", 4.0, 0, -6.0 * n)
        for sd in ("right", "left"):
            s = S[sd]
            goal = torso_goal((s * (1.2 + 4.0 * apart), 30.0, -10.5), normal=(s, 0, 0), fingers=(0, 0.75, -0.6),
                              elbow=(s * 12.5, 28.0, -4.0))
            self.arm_ik(f"perf2_{sd}", p, sd, goal, [-70, s * 20, 0, -60, 0, 0, 0, 0, 0])
        self.stance(p, 2.5)
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", 8.0 * pulse(t, 1.0, 0.2, 0.03, phase=0.45), 0, 0)

    def jumpscare1(self, t):
        """Lunges and screams, head shaking."""
        return NightClips.jumpscare1(self, t)

    def jumpscare1_post(self, p, t):
        NightClips.jumpscare1_post(self, p, t)

    def jumpscare2(self, t):
        """Powers down, head drooping... then snaps up right in your face."""
        p = {}
        down = ease(t / 0.5)
        up = ease((t - 0.7) / 0.06)
        setr(p, "body", 4.0 * down + 14.0 * up, 0, 0)
        setr(p, "torso", 10.0 * down * (1 - up) + 6.0 * up, 0, 0)
        setr(p, "head", 34.0 * down * (1 - up) - 30.0 * up, 0, 16.0 * down * (1 - up))
        setr(p, "jaw", 2.0 + 26.0 * up, 0, 0)
        for sd in ("right", "left"):
            s = S[sd]
            setr(p, f"{sd}Arm", lerp(8.0 * down, -100.0, up), s * 10.0 * up, s * lerp(-2.0, 20.0, up))
            setr(p, f"{sd}Forearm", -16.0 * up, 0, 0)
        self.fingers_open(p, up)
        self.stance(p, 2.5, 6.0 * down * (1 - up))
        meta(p, z=-9.0 * up)
        return p

    def jumpscare2_post(self, p, t):
        self.scream_shake(p, t, 0.8, 1.45)


CLIPS = {"monkey": MonkeyNight, "bat": BatNight, "crocodile": CrocNight, "fox": FoxNight, "bunny": BunnyNight,
         "goat": GoatNight, "bear": BearNight}
