"""Night clips for the three fred3.py animatronics, each with its own personality:

  golden_freddy   quiet and wrong: slow head tilts, glitchy twitches, endoskeleton fingers that
                  curl one joint at a time, a slumped sit on the floor, a music-box song with a
                  beckoning hand, a piano of bare metal fingers, and the "IT'S ME" lunge
  crimson_freddy  a heavy brute: breathing chest, clenching fists, stomping walk, a charging run,
                  boxer stance, a fist-pumping rock song, a belly laugh, a roaring grab and a
                  double-fist slam
  violet_bunny    jittery and bouncy: ear flicks (the folded ear flops), a springy walk, a
                  hopping run, a shy wave, slap-bass, a side-step dance, a screech and a slow
                  sideways lean-in that ends in a scream

Their hands have the back of the hand facing forward (as in the pictures), so the fingers curl
with +x rotation and straighten with -x.
"""
import math

from characters import fred3
from characters.night import NightClips, clamp01, ease, flip, lerp, swing, window
from fnafkit.anim import S, TAU, cs, flat_foot, pos, setp, setr, sn
from fnafkit.servo import add_rot, meta, stepper

SONG = [(0.0, 0.2, 10), (0.25, 0.45, 7), (0.5, 0.85, 12), (1.0, 1.2, 8), (1.25, 1.45, 10), (1.5, 1.95, 13),
        (2.5, 2.7, 9), (2.75, 2.95, 7), (3.0, 3.35, 12), (3.5, 3.9, 10)]


def song(t, scale=1.0):
    return scale * sum(a * window(t, t0, t1, 0.04) for t0, t1, a in SONG)


def pulse(t, period, width, ramp=0.03, phase=0.0):
    return window((t - phase) % period, 0.0, width, ramp)


class Fred3Night(NightClips):
    IK_CLIPS = ()

    def __init__(self, name):
        self.name = name
        self.D = D = fred3.dims(name)
        super().__init__(dict(mouth=D["mouth"], mouth_axis=(0, 0.45, 0.9), half_w=D["half_w"], torso=D["torso"],
                              mic=None, jaw_max=22.0, tail=[]))

    # ---- hands: every finger bends at each of its knuckles ------------------------------
    # how far each joint bends back in a full fist (knuckle, middle, tip), bare metal vs mitten fingers
    FIST = {"endo": (55.0, 70.0, 60.0), "mitt": (72.0, 88.0, 72.0)}
    THUMB_FIST = (30.0, 45.0)

    @staticmethod
    def _bend(k, rest, fist):
        """Animation rotation for one joint: k = 0 keeps the picture's rest bend, 1 bends it to the
        fist angle, -1 straightens it (the rest bend is stored as a negative, backward, angle)."""
        return k * (fist - abs(rest)) if k >= 0 else k * abs(rest)

    def hand(self, p, side, curl=0.0, spread=0.0, thumb=None, fingers=None, add=False):
        """Pose a whole hand.  curl: 0 = relaxed as in the picture, 1 = fist, -1 = flat; spread fans
        the fingers out; thumb (default: curl) folds the thumb in over the palm or swings it out;
        fingers gives each finger its own curl (outermost first).  add=True adds on top."""
        H = fred3.HANDS[self.name]
        fist = self.FIST[H["kind"]]
        s = S[side]
        op = add_rot if add else setr
        n = len(H["fingers"])
        for i, (_, segs) in enumerate(H["fingers"]):
            k = curl if fingers is None else fingers[i]
            fan = ((n - 1) / 2 - i) * spread * 9.0          # outer fingers swing outward
            for j, (_, _, rest) in enumerate(segs):
                op(p, f"{side}Finger{i + 1}{'abc'[j]}", self._bend(k, rest, fist[j]), 0, s * fan if j == 0 else 0.0)
        tk = curl if thumb is None else thumb
        for j, (_, _, rest) in enumerate(H["thumb"][1]):
            swing = -s * 14.0 * tk if j == 0 else 0.0          # in over the palm (k > 0) or out (k < 0)
            op(p, f"{side}Thumb{'ab'[j]}", self._bend(tk, rest, self.THUMB_FIST[j]), 0, swing)

    def fingers_open(self, p, k, sides=("right", "left")):
        for side in sides:
            self.hand(p, side, curl=-k, spread=k)

    def curl(self, p, side, k=1.0):
        self.hand(p, side, curl=k)

    def finger_wave(self, p, side, t, period, amp, step=0.07, phase=0.0, thumb_amp=0.0):
        """One finger after another taps in (a ripple across the hand), added on top."""
        n = len(fred3.HANDS[self.name]["fingers"])
        ks = [amp * pulse(t, period, period * 0.45, 0.03, phase=phase + i * step) for i in range(n)][::-1]
        th = thumb_amp * pulse(t, period, period * 0.45, 0.03, phase=phase + n * step)
        self.hand(p, side, fingers=ks, thumb=th, add=True)

    def legs_gait(self, p, f, stride, bend, toe=6.0, spread=1.0, lift_phase=0.35, k=0.7):
        for side in ("right", "left"):
            s = S[side]
            ph = f if s > 0 else f + math.pi
            setr(p, f"{side}Leg", -stride * swing(ph, k), 0, s * spread)
            setr(p, f"{side}Shin", 4.0 + bend * pos(cs(ph + lift_phase)) ** 1.5, 0, 0)
            flat_foot(p, side, toe=-toe * sn(ph))

    def arms_swing(self, p, f, amp, fwd=0.0, out=0.0, elbow=-8.0):
        for side in ("right", "left"):
            s = S[side]
            ph = f + math.pi if s > 0 else f
            setr(p, f"{side}Arm", -fwd + amp * sn(ph), 0, s * out)
            setr(p, f"{side}Forearm", elbow, 0, 0)

    def scream_shake(self, p, t, t0, t1, head=7.0, rate=12):
        on = 1.0 if t0 <= t <= t1 else 0.0
        f = flip(t, rate) * on
        add_rot(p, "head", 0, head * f, head * 0.7 * f)
        add_rot(p, "body", 0, 0, 1.5 * f)
        return on


# ==========================================================================
# Golden Freddy
# ==========================================================================


class GoldenNight(Fred3Night):
    LENGTHS = dict(NightClips.LENGTHS, run=0.9)

    def walk_len(self):
        return 1.9

    def schedule(self, name, L):
        sch = super().schedule(name, L)
        if name in ("idle", "pose1"):
            sch["head"] = stepper(1.0, 0.3, 0.1)            # slower, heavier head steps
        return sch

    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        setr(p, "torso", 3.0 + 1.0 * sn(w), 0, 0)
        setr(p, "head", 6.0 + 2.0 * sn(2 * w), 12.0 * sn(w), 14.0 * swing(w + 0.6, 0.5))
        setr(p, "jaw", 6.0, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -2.0, 0, s * 1.0)
            setr(p, f"{side}Forearm", -4.0, 0, 0)
            self.curl(p, side, 0.15)
        self.stance(p, 1.0, 1.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        g = window(t, 2.2, 2.32, 0.02) + window(t, 4.9, 5.0, 0.02)       # glitch twitches
        add_rot(p, "head", -10.0 * g, 18.0 * g, -12.0 * g)
        # one finger after another curls and straightens, as if testing the metal
        for side, t0 in (("right", 1.0), ("left", 3.4)):
            ks = [0.7 * window(t, t0 + 0.18 * i, t0 + 0.18 * i + 0.4, 0.05) for i in range(3)]
            self.hand(p, side, fingers=ks, thumb=0.0, add=True)
        add_rot(p, "jaw", 8.0 * window(t, 5.3, 5.6, 0.03), 0, 0)

    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        # slow, dragging steps; the head lolls and the arms hang almost still
        setr(p, "body", 4.0, -4.0 * sn(f), 4.0 * cs(f))
        setr(p, "torso", 4.0, 4.0 * sn(f), -2.0 * cs(f))
        setr(p, "head", 8.0, -5.0 * sn(f), 10.0 + 4.0 * cs(f))
        self.legs_gait(p, f, 15.0, 16.0, toe=3.0, spread=1.0)
        self.arms_swing(p, f, 5.0, fwd=2.0, elbow=-6.0)
        for side in ("right", "left"):
            self.curl(p, side, 0.2)
        setr(p, "jaw", 6.0, 0, 0)
        meta(p)
        return p

    def walk_post(self, p, t):
        add_rot(p, "head", 0, 0, -14.0 * window(t, 1.2, 1.32, 0.02))

    def run(self, t):
        f = TAU * t / 0.9
        p = {}
        # stiff lurching run, both arms reaching out ahead with the fingers spread
        setr(p, "body", 18.0, -3.0 * sn(f), 2.0 * cs(f))
        setr(p, "torso", 6.0, 4.0 * sn(f), 0)
        setr(p, "head", -14.0, 0, 6.0)
        self.legs_gait(p, f, 34.0, 60.0, toe=10.0, spread=1.0, lift_phase=0.45)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -80.0 + 6.0 * sn(f + (0 if s > 0 else math.pi)), 0, -s * 14.0)
            setr(p, f"{side}Forearm", -6.0, 0, 0)
        self.fingers_open(p, 0.9)
        setr(p, "jaw", 14.0, 0, 0)
        meta(p, extra=0.8 * pos(sn(2 * f + 0.9)))
        return p

    def run_post(self, p, t):
        add_rot(p, "head", 0, 4.0 * flip(t, 5), 0)

    def pose1(self, t):
        """The picture: standing upright, arms hanging out at the sides, fingers loose."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "torso", 0.6 * sn(w), 0, 0)
        setr(p, "head", 0.8 * sn(w + 1.0), 0, 0)
        for side in ("right", "left"):
            self.curl(p, side, 0.03 * sn(w + S[side]))
        self.stance(p, 0.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        self.hand(p, "right", curl=0.35 * window(t, 1.2, 1.5, 0.05), add=True)

    def pose2(self, t):
        """The slump: sitting on the floor, legs out in front, head hanging to one side."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", -8.0, 0, 0)
        setr(p, "torso", 22.0 + 1.0 * sn(w), 0, -4.0)
        setr(p, "head", 34.0, 10.0, 24.0 + 1.5 * sn(w))
        setr(p, "jaw", 10.0, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Leg", -84.0, 0, s * 6.0)
            setr(p, f"{side}Shin", 4.0, 0, 0)
            setr(p, f"{side}Foot", 0.0, 0, 0)
            setr(p, f"{side}Arm", 14.0, 0, s * 6.0)
            setr(p, f"{side}Forearm", -10.0, 0, 0)
            self.curl(p, side, 0.25)
        meta(p, extra=-0.6)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "head", -6.0 * window(t, 1.4, 1.52, 0.02), 0, 0)

    def performance1(self, t):
        """A music-box song: slow sway, the head turning across the crowd, one arm beckoning."""
        p = {}
        sway = sn(TAU * t / 4.0)
        setr(p, "body", 0, 0, 2.5 * sway)
        setr(p, "torso", 2.0, 8.0 * sway, 1.5 * sway)
        setr(p, "head", 2.0, 18.0 * sway, -8.0 * sway)
        beck = ease(t / 0.8) * (1 - ease((t - 3.2) / 0.6))
        # the hand comes up in front of the chest, out to the side, fingers pointing at you
        setr(p, "rightArm", -38.0 * beck, 0, 10.0 * beck)
        setr(p, "rightForearm", -42.0 * beck, 0, 0)
        setr(p, "rightHand", -18.0 * beck, 0, 0)
        setr(p, "leftArm", -2.0, 0, -2.0)
        setr(p, "leftForearm", -6.0, 0, 0)
        self.curl(p, "left", 0.2)
        self.stance(p, 1.0, 1.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.8), 0, 0)
        # the beckoning fingers curl in, one after another, on each beat
        on = window(t, 0.9, 3.1, 0.05)
        ks = [0.95 * on * pulse(t, 0.6, 0.3, 0.05, phase=0.05 * i) for i in range(3)][::-1]
        self.hand(p, "right", fingers=ks, thumb=0.0, add=True)

    def performance2(self, t):
        """Plays an invisible piano: both hands out in front, the bare metal fingers rippling."""
        p = {}
        bob = pos(cs(TAU * t))
        setr(p, "torso", 8.0 + 3.0 * bob, 6.0 * sn(TAU * t / 4.0), 0)
        setr(p, "head", 10.0 + 5.0 * bob, -8.0 * sn(TAU * t / 4.0), 6.0 * sn(TAU * t / 2.0))
        for side in ("right", "left"):
            s = S[side]
            reach = sn(TAU * t / 2.0 + (0 if s > 0 else math.pi))
            setr(p, f"{side}Arm", -48.0, 0, -s * (16.0 + 6.0 * reach))
            setr(p, f"{side}Forearm", -42.0, 0, 0)
            setr(p, f"{side}Hand", 40.0, 0, 0)
        self.stance(p, 1.5, 2.0)
        meta(p)
        return p

    def performance2_post(self, p, t):
        # each finger strikes its own key, a ripple across both hands
        for side, ph in (("right", 0.0), ("left", 0.125)):
            self.finger_wave(p, side, t, 0.5, 0.75, step=0.06, phase=ph, thumb_amp=0.6)
        add_rot(p, "jaw", song(t, 0.5), 0, 0)

    def jumpscare1(self, t):
        """IT'S ME: the head snaps up right into the camera, jaw wide, then shakes."""
        p = {}
        k = ease((t - 0.05) / 0.08)
        setr(p, "body", 16.0 * k, 0, 0)
        setr(p, "torso", 10.0 * k, 0, 0)
        setr(p, "head", -34.0 * k, 0, 0)
        setr(p, "jaw", 26.0 * k, 0, 0)
        setr(p, "hat", -12.0 * k, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -85.0 * k, 0, -s * 18.0 * k)
            setr(p, f"{side}Forearm", -20.0 * k, 0, 0)
        self.fingers_open(p, k)
        setr(p, "rightLeg", -24.0 * k, 0, 1.0)
        setr(p, "rightShin", 20.0 * k, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 14.0 * k, 0, -1.0)
        flat_foot(p, "left", toe=10.0 * k)
        meta(p, z=-11.0 * k)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.15, 1.15, head=9.0, rate=14)

    def jumpscare2(self, t):
        """The head drops, limp... then jerks up with the jaw open and the arms flung up, glitching."""
        p = {}
        down = ease(t / 0.4)
        up = ease((t - 0.62) / 0.06)
        setr(p, "torso", 14.0 * down * (1 - up) + 4.0 * up, 0, 0)
        setr(p, "head", 40.0 * down * (1 - up) - 30.0 * up, 0, 22.0 * down * (1 - up))
        setr(p, "jaw", 6.0 + 22.0 * up, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(8.0 * down, -150.0, up), 0, s * lerp(0.0, 10.0, up))
            setr(p, f"{side}Forearm", -12.0 * up, 0, 0)
        self.fingers_open(p, up)
        self.stance(p, 1.0, 5.0 * down * (1 - up))
        meta(p, z=-8.0 * up)
        return p

    def jumpscare2_post(self, p, t):
        g = window(t, 0.75, 0.8, 0.01) + window(t, 0.95, 1.0, 0.01)
        add_rot(p, "head", 0, 22.0 * g, -16.0 * g)
        self.scream_shake(p, t, 0.7, 1.45, head=7.0)


# ==========================================================================
# Crimson Freddy
# ==========================================================================


class CrimsonNight(Fred3Night):
    LENGTHS = dict(NightClips.LENGTHS, run=0.8)

    def walk_len(self):
        return 1.7

    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        breath = sn(TAU * t / 1.5)                # heavy breathing
        setr(p, "body", 1.0, 0, 0)
        setr(p, "torso", 2.0 - 2.0 * breath, 6.0 * sn(w), 0)
        setr(p, "head", 4.0 + 1.5 * breath, 20.0 * sn(w), 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -3.0, 0, s * (1.0 + 1.5 * breath))
            setr(p, f"{side}Forearm", -8.0, 0, 0)
            self.curl(p, side, 0.4 + 0.3 * sn(2 * w + s))
        self.stance(p, 2.0, 1.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        crack = window(t, 3.0, 3.25, 0.03)                     # cracks his neck
        add_rot(p, "head", 0, 0, 20.0 * crack - 18.0 * window(t, 3.35, 3.6, 0.03))
        add_rot(p, "jaw", 8.0 * window(t, 4.6, 4.9, 0.03), 0, 0)

    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        # heavy stomping: the body drops onto each foot, shoulders roll, fists swing
        setr(p, "body", 5.0, -5.0 * sn(f), 4.0 * cs(f))
        setr(p, "torso", 6.0, 9.0 * sn(f), -3.0 * cs(f))
        setr(p, "head", 2.0, -8.0 * sn(f), 0)
        self.legs_gait(p, f, 22.0, 24.0, toe=6.0, spread=1.5)
        self.arms_swing(p, f, 18.0, fwd=4.0, elbow=-18.0)
        for side in ("right", "left"):
            self.curl(p, side, 0.9)
        meta(p, extra=-0.5 * pos(-cs(2 * f)))
        return p

    def run(self, t):
        f = TAU * t / 0.8
        p = {}
        # charging, head down, fists pumping
        setr(p, "body", 22.0, -4.0 * sn(f), 0)
        setr(p, "torso", 10.0, 8.0 * sn(f), 0)
        setr(p, "head", 2.0, 0, 0)
        self.legs_gait(p, f, 40.0, 70.0, toe=12.0, spread=1.5, lift_phase=0.45)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -20.0 + 40.0 * sn(f + (math.pi if s > 0 else 0)), 0, s * 4.0)
            setr(p, f"{side}Forearm", -70.0, 0, 0)
            self.curl(p, side, 1.0)
        setr(p, "jaw", 14.0, 0, 0)
        meta(p, extra=1.0 * pos(sn(2 * f + 0.9)))
        return p

    def pose1(self, t):
        """The picture: broad and square, arms hanging, hands half closed, staring ahead."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "torso", 0.8 * sn(w), 0, 0)
        setr(p, "head", 0.8 * sn(w + 1.0), 0, 0)
        for side in ("right", "left"):
            self.curl(p, side, 0.0)
        self.stance(p, 0.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "jaw", 6.0 * window(t, 1.1, 1.4, 0.03), 0, 0)

    def pose2(self, t):
        """Boxer stance: fists up in front of the face, bouncing on his feet."""
        w = TAU * t / 1.0
        p = {}
        bounce = pos(sn(w))
        setr(p, "body", 4.0, 14.0, 0)
        setr(p, "torso", 8.0, 8.0, 0)
        setr(p, "head", 10.0, -18.0, 0)
        for side, (ua, uz) in (("right", (-62.0, -26.0)), ("left", (-78.0, 22.0))):
            s = S[side]
            setr(p, f"{side}Arm", ua, 0, uz)
            setr(p, f"{side}Forearm", -95.0, 0, 0)
            setr(p, f"{side}Hand", 10.0, 0, 0)
            self.curl(p, side, 1.0)
        self.stance(p, 3.0, 6.0 + 4.0 * bounce)
        meta(p)
        return p

    def pose2_post(self, p, t):
        jab = window(t, 0.8, 1.05, 0.04)
        add_rot(p, "leftArm", -18.0 * jab, 0, -10.0 * jab)
        add_rot(p, "leftForearm", 55.0 * jab, 0, 0)

    def performance1(self, t):
        """A rock song: one fist punching the air on every beat, head banging."""
        p = {}
        beat = pos(cs(TAU * t * 1.0))
        setr(p, "body", 2.0, 0, 3.0 * sn(TAU * t / 2.0))
        setr(p, "torso", 4.0 + 6.0 * beat, -10.0, 0)
        setr(p, "head", 4.0 + 14.0 * beat, 8.0, 0)
        pump = ease(window(t % 1.0, 0.0, 0.5, 0.15))
        setr(p, "rightArm", -150.0 - 20.0 * pump, 0, 12.0)
        setr(p, "rightForearm", -40.0 + 30.0 * pump, 0, 0)
        self.curl(p, "right", 1.0)
        setr(p, "leftArm", -30.0, 0, -12.0)
        setr(p, "leftForearm", -70.0, 0, 0)
        self.curl(p, "left", 0.8)
        self.stance(p, 3.0, 4.0 * beat)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 1.4), 0, 0)

    def performance2(self, t):
        """A belly laugh: head thrown back, shoulders shaking, both hands on his belly."""
        p = {}
        laugh = window(t % 2.0, 0.25, 1.75, 0.2)
        setr(p, "torso", -6.0 * laugh, 0, 0)
        setr(p, "head", -22.0 * laugh, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -26.0, 0, -s * 8.0)
            setr(p, f"{side}Forearm", -78.0, 0, 0)
            setr(p, f"{side}Hand", 0, 0, -s * 30.0)
            self.curl(p, side, 0.3)
        self.stance(p, 2.5, 2.0 * laugh)
        meta(p)
        return p

    def performance2_post(self, p, t):
        laugh = window(t % 2.0, 0.25, 1.75, 0.2)
        add_rot(p, "jaw", (14.0 + 8.0 * (flip(t, 6) > 0)) * laugh, 0, 0)
        add_rot(p, "torso", 2.5 * flip(t, 6) * laugh, 0, 0)
        add_rot(p, "head", 0, 0, 4.0 * flip(t, 3) * laugh)

    def jumpscare1(self, t):
        """A roaring lunge: both arms swing up and in to grab, jaw wide."""
        p = {}
        k = ease((t - 0.05) / 0.12)
        g = ease((t - 0.35) / 0.1)
        setr(p, "body", 18.0 * k, 0, 0)
        setr(p, "torso", 10.0 * k, 0, 0)
        setr(p, "head", -30.0 * k, 0, 0)
        setr(p, "jaw", 26.0 * k, 0, 0)
        setr(p, "hat", -10.0 * k, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -95.0 * k, s * 10.0 * k, s * lerp(30.0, -12.0, g) * k)
            setr(p, f"{side}Forearm", -20.0 * k - 30.0 * g, 0, 0)
        self.fingers_open(p, k * (1 - g))
        for side in ("right", "left"):
            self.hand(p, side, curl=0.9 * g, add=True)
        setr(p, "rightLeg", -28.0 * k, 0, 2.0)
        setr(p, "rightShin", 22.0 * k, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 16.0 * k, 0, -2.0)
        flat_foot(p, "left", toe=12.0 * k)
        meta(p, z=-10.0 * k)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.45, 1.15, head=6.0, rate=10)

    def jumpscare2(self, t):
        """Raises both fists overhead, then slams them down toward the camera with a roar."""
        p = {}
        rise = ease(t / 0.35)
        slam = ease((t - 0.45) / 0.08)
        setr(p, "body", -6.0 * rise * (1 - slam) + 24.0 * slam, 0, 0)
        setr(p, "torso", -8.0 * rise * (1 - slam) + 14.0 * slam, 0, 0)
        setr(p, "head", -14.0 * rise * (1 - slam) - 20.0 * slam, 0, 0)
        setr(p, "jaw", 10.0 * rise + 18.0 * slam, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(-170.0 * rise, -70.0, slam), 0, -s * 10.0)
            setr(p, f"{side}Forearm", lerp(-40.0 * rise, -10.0, slam), 0, 0)
            self.curl(p, side, 1.0)
        self.stance(p, 3.0, 4.0 + 10.0 * slam)
        meta(p, z=-9.0 * slam)
        return p

    def jumpscare2_post(self, p, t):
        self.scream_shake(p, t, 0.55, 1.4, head=6.0)


# ==========================================================================
# Violet Bunny
# ==========================================================================


class BunnyNight(Fred3Night):
    LENGTHS = dict(NightClips.LENGTHS, run=0.64)

    def walk_len(self):
        return 1.5

    def ear_flop(self, p, phase, amp=8.0):
        setr(p, "rightEar", 0, 0, amp * 0.6 * sn(phase))
        setr(p, "leftEar", 0, 0, -amp * 0.4 * sn(phase + 0.6))
        setr(p, "leftEarTop", 0, 0, amp * sn(phase - 0.5))

    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        setr(p, "torso", 1.0 * sn(w), 4.0 * sn(w), 0)
        setr(p, "head", 2.0 * sn(2 * w), 16.0 * sn(w), 14.0 * swing(w + 0.5, 0.5))
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -2.0, 0, s * 1.5)
            setr(p, f"{side}Forearm", -8.0, 0, 0)
            self.curl(p, side, 0.2 + 0.2 * sn(3 * w + s))
        self.stance(p, 1.0)
        self.ear_flop(p, 2 * w, 6.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        for t0 in (0.9, 2.6, 4.3):
            add_rot(p, "rightEar", 12.0 * window(t, t0, t0 + 0.14, 0.02), 0, 0)
        add_rot(p, "leftEarTop", 0, 0, 18.0 * window(t, 3.4, 3.7, 0.04))
        add_rot(p, "head", 0, 0, -20.0 * window(t, 5.0, 5.3, 0.03))

    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        # springy, bouncy steps
        setr(p, "body", 4.0, -4.0 * sn(f), 3.0 * cs(f))
        setr(p, "torso", 3.0, 6.0 * sn(f), 0)
        setr(p, "head", -3.0 + 4.0 * cs(2 * f), -6.0 * sn(f), 0)
        self.legs_gait(p, f, 20.0, 40.0, toe=10.0, spread=1.0, lift_phase=0.2)
        self.arms_swing(p, f, 16.0, fwd=4.0, elbow=-20.0)
        self.ear_flop(p, 2 * f, 14.0)
        meta(p, extra=1.1 * pos(cs(2 * f)))
        return p

    def run(self, t):
        f = TAU * t / 0.64
        p = {}
        hop = pos(sn(f))
        setr(p, "body", 14.0 + 8.0 * hop, 0, 0)
        setr(p, "torso", 6.0, 0, 0)
        setr(p, "head", -16.0 - 6.0 * hop, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Leg", lerp(-10.0, 30.0, hop) + 6.0 * s * cs(f), 0, s * 2.0)
            setr(p, f"{side}Shin", lerp(46.0, 10.0, hop), 0, 0)
            flat_foot(p, side, toe=28.0 * hop)
            setr(p, f"{side}Arm", lerp(24.0, -50.0, hop), 0, s * 8.0)
            setr(p, f"{side}Forearm", -36.0, 0, 0)
        self.ear_flop(p, f, 18.0)
        setr(p, "jaw", 10.0, 0, 0)
        meta(p, extra=2.4 * hop)
        return p

    def pose1(self, t):
        """The picture: standing straight, arms hanging, the folded ear bobbing."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "torso", 0.6 * sn(w), 0, 0)
        setr(p, "head", 0.6 * sn(w + 1.0), 0, 0)
        for side in ("right", "left"):
            self.curl(p, side, 0.0)
        self.stance(p, 0.0)
        self.ear_flop(p, w, 2.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "rightEar", 8.0 * window(t, 1.1, 1.25, 0.02), 0, 0)

    def pose2(self, t):
        """A shy wave beside the head, head tilted, the other hand behind his back."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 0, 0, -3.0)
        setr(p, "torso", 2.0, -6.0, -3.0)
        setr(p, "head", 4.0, 8.0, -16.0)
        setr(p, "rightArm", -20.0, 0, 120.0)
        setr(p, "rightForearm", -50.0, 0, 18.0 * sn(2 * w))
        setr(p, "rightHand", 0, 0, 10.0 * sn(2 * w + 0.4))
        self.fingers_open(p, 0.9, sides=("right",))
        setr(p, "leftArm", 30.0, 0, 6.0)
        setr(p, "leftForearm", -70.0, 0, 0)
        self.curl(p, "left", 0.6)
        self.stance(p, 1.5)
        self.ear_flop(p, 2 * w, 6.0)
        meta(p)
        return p

    def performance1(self, t):
        """Slap bass: bass held across the hips, right thumb slapping on the beat, body bobbing."""
        p = {}
        bob = pos(cs(TAU * t * 2.0))
        setr(p, "body", 0, 0, 3.0 * sn(TAU * t / 2.0))
        setr(p, "torso", 4.0 + 4.0 * bob, -12.0, 0)
        setr(p, "head", 6.0 * bob, -10.0, 8.0 * sn(TAU * t / 2.0))
        setr(p, "leftArm", -40.0, -20.0, -40.0)
        setr(p, "leftForearm", -60.0, 0, 0)
        setr(p, "leftHand", 0, 30.0, 0)
        self.curl(p, "left", 0.6)
        slap = pulse(t, 0.5, 0.12, 0.02)
        setr(p, "rightArm", -24.0, 30.0, 14.0)
        setr(p, "rightForearm", -88.0 + 16.0 * slap, 0, 0)
        setr(p, "rightHand", -20.0 * slap, 0, 0)
        self.curl(p, "right", 0.7)
        self.stance(p, 2.5, 3.0 * bob)
        self.ear_flop(p, TAU * t * 2.0, 10.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.9), 0, 0)
        tap = pulse(t, 0.5, 0.15, 0.03)
        add_rot(p, "rightFoot", -12.0 * tap, 0, 0)

    def performance2(self, t):
        """Side-step dance: stepping side to side, one arm up then the other, ears flopping."""
        p = {}
        side = math.copysign(1.0, sn(TAU * t / 1.0))
        step = abs(sn(TAU * t / 1.0))
        setp(p, "body", -1.4 * side * ease(step), 0, 0)
        setr(p, "body", 0, 0, 4.0 * side)
        setr(p, "torso", 2.0, 0, -3.0 * side)
        setr(p, "head", 0, 10.0 * side, -10.0 * side)
        for sd in ("right", "left"):
            s = S[sd]
            up = 1.0 if (s > 0) == (side > 0) else 0.0
            setr(p, f"{sd}Arm", -150.0 * up - 6.0 * (1 - up), 0, s * 10.0 * up)
            setr(p, f"{sd}Forearm", -24.0, 0, 0)
            setr(p, f"{sd}Leg", -8.0 * step * up, 0, s * (2.0 + 4.0 * up * step))
            setr(p, f"{sd}Shin", 14.0 * step * up, 0, 0)
            flat_foot(p, sd)
        self.fingers_open(p, 0.7)
        self.ear_flop(p, TAU * t * 2.0, 16.0)
        meta(p, extra=0.8 * step)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", 12.0 * pulse(t, 0.5, 0.2, 0.03, phase=0.25), 0, 0)

    def jumpscare1(self, t):
        """Ears snap upright, then the lunge and the screech, arms up."""
        p = {}
        k = ease((t - 0.12) / 0.12)
        setr(p, "rightEar", -10.0 * k, 0, 14.0 * k)
        setr(p, "leftEar", 0, 0, -30.0 * k)
        setr(p, "leftEarTop", 0, 0, -80.0 * k)
        setr(p, "body", 16.0 * k, 0, 0)
        setr(p, "torso", 8.0 * k, 0, 0)
        setr(p, "head", -30.0 * k, 0, 0)
        setr(p, "jaw", 26.0 * k, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -140.0 * k, 0, s * 26.0 * k)
            setr(p, f"{side}Forearm", -16.0 * k, 0, 0)
        self.fingers_open(p, k)
        setr(p, "rightLeg", -26.0 * k, 0, 2.0)
        setr(p, "rightShin", 20.0 * k, 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", 14.0 * k, 0, -2.0)
        flat_foot(p, "left", toe=10.0 * k)
        meta(p, z=-9.0 * k)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.3, 1.15, head=8.0)

    def jumpscare2(self, t):
        """Leans in slowly from the side with the head tipped right over... then screams."""
        p = {}
        lean = ease(t / 0.85)
        b = ease((t - 0.88) / 0.06)
        setr(p, "body", 6.0 * lean, 0, 10.0 * lean * (1 - b))
        setr(p, "torso", 12.0 * lean, 0, 8.0 * lean * (1 - b))
        setr(p, "head", 8.0 * lean - 30.0 * b, 0, 70.0 * lean * (1 - b))
        setr(p, "jaw", 4.0 * lean + 24.0 * b, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(-4.0, -110.0, b), 0, s * lerp(2.0, 40.0, b))
            setr(p, f"{side}Forearm", -20.0 * b, 0, 0)
        self.fingers_open(p, b)
        self.ear_flop(p, 0.0, 0.0)
        setr(p, "leftEarTop", 0, 0, -60.0 * b)
        self.stance(p, 1.5, 3.0)
        meta(p, z=-4.0 * lean - 5.0 * b)
        return p

    def jumpscare2_post(self, p, t):
        self.scream_shake(p, t, 0.95, 1.45)


CLIPS = {"golden_freddy": GoldenNight, "crimson_freddy": CrimsonNight, "violet_bunny": BunnyNight}
