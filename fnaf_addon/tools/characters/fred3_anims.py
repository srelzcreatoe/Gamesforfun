"""Night clips for the three fred3.py animatronics.  No clip is shared: each character moves in its
own mechanical style, and each of its nine clips has its own silhouette.

  golden_freddy   a broken, haunted suit.  Long dead holds broken by glitch snaps; the head hangs
                  and lolls; the arms hang limp and swing like dead weight.
                  idle: slumped, the head snapping between tilts, glitch twitches, fingers flexing
                  walk: a dragging limp, the left foot scraping the floor
                  run: pitched forward, arms trailing limp behind, fingers splayed
                  pose 1: the picture; pose 2: slumped sitting on the floor
                  performance 1: music-box figurine, turning in ratchet steps, beckoning
                  performance 2: an invisible piano, every finger on its own key
                  jumpscare 1: "IT'S ME" - only the head snaps up into your face, arms still limp
                  jumpscare 2: powers down, then jolts upright with both arms flung out wide
  crimson_freddy  a heavy hydraulic brute.  Slow, weighted moves that stop hard with a bounce.
                  idle: fists on hips, chest pumping, weight rocking, knuckle crack, neck crack
                  walk: heavy stomp, shoulders rolling, fists swinging
                  run: a bull charge, head down, fists pumping
                  pose 1: the picture, fists slowly closing; pose 2: boxer stance throwing jabs
                  performance 1: rock song, fist pumping and head banging; performance 2: belly laugh
                  jumpscare 1: arms swing open and crash shut in a bear hug
                  jumpscare 2: both fists overhead, slammed down at you
  violet_bunny    jittery and springy.  Quick little servo steps, head tilts, restless ears.
                  idle: hands fidgeting in front, curious head tilts, ear flicks, bobbing on his toes
                  walk: a bouncy skip; run: hopping with both feet together
                  pose 1: the picture, head cocking; pose 2: a shy wave
                  performance 1: slap bass; performance 2: side-step dance
                  jumpscare 1: crouches, then pounces with clawed hands
                  jumpscare 2: peeks in slowly from the side, then screams

Hands: the back of the hand faces forward and every finger and thumb segment is its own bone with
no rest rotation, so a positive X rotation bends a joint straight back into a fist.
"""
import math

from characters import fred3
from characters.night import NightClips, ease, flip, lerp, swing, window
from fnafkit.anim import S, TAU, cs, flat_foot, pos, setp, setr, sn
from fnafkit.servo import add_rot, meta, stepper

SONG = [(0.0, 0.2, 10), (0.25, 0.45, 7), (0.5, 0.85, 12), (1.0, 1.2, 8), (1.25, 1.45, 10), (1.5, 1.95, 13),
        (2.5, 2.7, 9), (2.75, 2.95, 7), (3.0, 3.35, 12), (3.5, 3.9, 10)]


def song(t, scale=1.0):
    return scale * sum(a * window(t, t0, t1, 0.04) for t0, t1, a in SONG)


def pulse(t, period, width, ramp=0.03, phase=0.0):
    return window((t - phase) % period, 0.0, width, ramp)


def steps(t, period, n):
    """Ratchet: the value 0..n-1 advances by one every `period` seconds (a music box drum)."""
    return math.floor(t / period + 1e-6) % n


class Fred3Night(NightClips):
    IK_CLIPS = ()
    RELAX = 0.2                    # a resting hand: every finger bent a little
    # how far each joint bends in a full fist (knuckle, middle, tip)
    FIST = {"endo": (70.0, 80.0, 65.0), "mitt": (80.0, 95.0, 75.0)}
    OPEN = (16.0, 8.0, 4.0)        # bend back when the hand opens wide

    def __init__(self, name):
        self.name = name
        self.D = D = fred3.dims(name)
        super().__init__(dict(mouth=D["mouth"], mouth_axis=(0, 0.45, 0.9), half_w=D["half_w"], torso=D["torso"],
                              mic=None, jaw_max=24.0, tail=[]))

    # ---- hands ----------------------------------------------------------------------------
    def hand(self, p, side, curl=None, spread=0.0, thumb=None, fingers=None, add=False):
        """Pose one hand.  curl: 0 straight, 1 fist, < 0 bent back open (default: relaxed);
        spread fans the fingers; thumb (default: follows curl) folds in over the palm (> 0) or
        swings out (< 0); fingers gives each finger its own curl, outermost first and the index
        finger last.  add=True adds the rotations on top of what is there."""
        H = fred3.HANDS[self.name]
        n, fist = H["fingers"], self.FIST[H["kind"]]
        curl = (0.0 if add else self.RELAX) if curl is None else curl
        s = S[side]
        op = add_rot if add else setr
        for i in range(n):
            k = curl if fingers is None else fingers[i]
            fan = ((n - 1) / 2 - i) * spread * 10.0
            for j in range(3):
                bend = k * fist[j] if k >= 0 else k * self.OPEN[j]
                op(p, f"{side}Finger{i + 1}{'abc'[j]}", bend, 0, s * fan if j == 0 else 0.0)
        tk = curl if thumb is None else thumb
        op(p, f"{side}Thumba", 30.0 * tk if tk >= 0 else 8.0 * tk, 0, s * (26.0 * tk if tk >= 0 else 22.0 * tk))
        op(p, f"{side}Thumbb", 40.0 * max(tk, 0.0), 0, 0)

    def fist(self, p, side, k=1.0):
        self.hand(p, side, curl=k, thumb=k)

    def open_hand(self, p, side, k=1.0):
        self.hand(p, side, curl=-k, spread=k, thumb=-k)

    def claw(self, p, side, k=1.0):
        self.hand(p, side, curl=0.5 * k, spread=0.9 * k, thumb=-0.3 * k)

    def point(self, p, side):
        n = fred3.HANDS[self.name]["fingers"]
        self.hand(p, side, fingers=[1.0] * (n - 1) + [-0.1], thumb=0.9)

    def finger_ripple(self, p, side, t, period, amp, step=0.07, phase=0.0, thumb_amp=0.0):
        """One finger after another taps in, index finger first (added on top)."""
        n = fred3.HANDS[self.name]["fingers"]
        ks = [amp * pulse(t, period, period * 0.45, 0.03, phase=phase + (n - 1 - i) * step) for i in range(n)]
        th = thumb_amp * pulse(t, period, period * 0.45, 0.03, phase=phase + n * step)
        self.hand(p, side, fingers=ks, thumb=th, add=True)

    def finger_flex(self, p, side, t, t0, amp=0.85, step=0.16, hold=0.35):
        """Each finger curls and straightens again in turn, from t0 (added on top)."""
        n = fred3.HANDS[self.name]["fingers"]
        ks = [amp * window(t, t0 + step * i, t0 + step * i + hold, 0.05) for i in range(n)]
        self.hand(p, side, fingers=ks, thumb=0.0, add=True)

    # ---- legs and arms ----------------------------------------------------------------------
    def gait(self, p, f, stride, lift, toe=6.0, spread=1.0, lift_phase=0.35, k=0.7, sides=None):
        """Leg swing for walks and runs; sides overrides (stride, lift, toe) per side."""
        for side in ("right", "left"):
            s = S[side]
            st, li, to = (sides or {}).get(side, (stride, lift, toe))
            ph = f if s > 0 else f + math.pi
            setr(p, f"{side}Leg", -st * swing(ph, k), 0, s * spread)
            setr(p, f"{side}Shin", 4.0 + li * pos(cs(ph + lift_phase)) ** 1.5, 0, 0)
            flat_foot(p, side, toe=-to * sn(ph))

    def hang(self, p, side, fwd=0.0, out=0.0, elbow=-6.0, wrist=0.0):
        s = S[side]
        setr(p, f"{side}Arm", -fwd, 0, s * out)
        setr(p, f"{side}Forearm", elbow, 0, 0)
        setr(p, f"{side}Hand", wrist, 0, 0)

    def scream_shake(self, p, t, t0, t1, head=7.0, rate=12, body=1.5):
        on = 1.0 if t0 <= t <= t1 else 0.0
        f = flip(t, rate) * on
        add_rot(p, "head", 0, head * f, head * 0.7 * f)
        add_rot(p, "body", 0, 0, body * f)
        return on

    def jaw_clack(self, p, t, t0, t1, amp=10.0, rate=6):
        on = 1.0 if t0 <= t <= t1 else 0.0
        add_rot(p, "jaw", -amp * (flip(t, rate) > 0) * on, 0, 0)


# ==========================================================================
# Golden Freddy: a broken, haunted suit
# ==========================================================================


class GoldenNight(Fred3Night):
    LENGTHS = dict(idle=6.0, run=1.0, pose1=3.0, pose2=3.0, performance1=4.8, performance2=4.0, jumpscare1=1.3,
                   jumpscare2=1.7)

    def walk_len(self):
        return 2.2

    def schedule(self, name, L):
        if name == "idle":
            return {"head": stepper(1.2, 0.07, 0.2, overshoot=0.12), "torso": stepper(2.0, 0.4),
                    "armR": stepper(1.5, 0.35, 0.3), "armL": stepper(1.5, 0.35, 1.0), "jaw": stepper(1.5, 0.06, 0.7)}
        if name == "walk":
            return {"head": stepper(L / 2, 0.1, 0.3)}        # the arms swing freely, like dead weight
        if name == "run":
            return {"head": stepper(0.25, 0.04)}
        if name == "pose1":
            return {"head": stepper(1.0, 0.08, 0.4, overshoot=0.1), "armR": stepper(1.5, 0.3), "armL": stepper(1.5, 0.3)}
        if name == "pose2":
            return {"head": stepper(1.5, 0.1, 0.5), "armR": stepper(1.5, 0.3), "armL": stepper(1.5, 0.3, 0.7)}
        if name == "performance1":
            return {"torso": stepper(0.6, 0.1, overshoot=0.1), "head": stepper(0.6, 0.08, 0.3, overshoot=0.1),
                    "armR": stepper(0.6, 0.15, 0.15), "armL": stepper(1.2, 0.3)}
        if name == "performance2":
            return {"head": stepper(0.5, 0.1), "torso": stepper(1.0, 0.25)}
        return {}

    def idle(self, t):
        """Slumped forward, head hanging, arms limp; the head snaps between tilts."""
        w = TAU * t / 6.0
        p = {}
        setr(p, "body", 3.0, 0, 1.5 * sn(w))
        setr(p, "torso", 9.0, 4.0 * sn(w), 2.0 * sn(w + 1.0))
        setr(p, "head", 12.0 + 8.0 * sn(2 * w), 22.0 * sn(w), 20.0 * sn(w + 0.9))
        setr(p, "jaw", 7.0 + 5.0 * pos(sn(3 * w)), 0, 0)
        for side in ("right", "left"):
            self.hang(p, side, fwd=6.0, out=-2.0, elbow=-8.0, wrist=6.0)
            self.hand(p, side, curl=0.3)
        self.stance(p, 1.0, 3.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        g = window(t, 2.2, 2.3, 0.01) + window(t, 4.9, 4.98, 0.01)       # glitch: a two-frame jerk
        add_rot(p, "head", -14.0 * g, 26.0 * g, -20.0 * g)
        add_rot(p, "torso", 0, 0, 5.0 * g)
        self.finger_flex(p, "right", t, 0.8)
        self.finger_flex(p, "left", t, 3.3)

    def walk(self, t):
        """A dragging limp: the right leg steps, the left drags its toes along the floor."""
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        drop = pos(-sn(f))                                  # sinks onto the bad leg
        setr(p, "body", 5.0, -4.0 * sn(f), 6.0 * cs(f) + 4.0 * drop)
        setr(p, "torso", 9.0, 7.0 * sn(f), -5.0 * cs(f))
        setr(p, "head", 14.0 + 4.0 * drop, -6.0 * sn(f), 16.0 + 8.0 * cs(f))
        setr(p, "jaw", 8.0, 0, 0)
        self.gait(p, f, 0, 0, sides={"right": (20.0, 30.0, 6.0), "left": (11.0, 6.0, -10.0)}, spread=1.5)
        for side in ("right", "left"):
            s = S[side]
            lag = f - 1.3 + (math.pi if s > 0 else 0.0)     # the arms swing late, like dead weight
            setr(p, f"{side}Arm", -4.0 + 12.0 * sn(lag), 0, -s * 1.5)
            setr(p, f"{side}Forearm", -6.0 - 8.0 * pos(sn(lag - 0.6)), 0, 0)
            setr(p, f"{side}Hand", 8.0 * sn(lag - 1.0), 0, 0)
            self.hand(p, side, curl=0.35)
        meta(p, extra=-0.7 * drop)
        return p

    def walk_post(self, p, t):
        g = window(t, 1.30, 1.38, 0.01)
        add_rot(p, "head", 0, -24.0 * g, -18.0 * g)

    def run(self, t):
        """Pitched far forward, staring up at you; the arms trail limp behind, fingers splayed."""
        f = TAU * t / 1.0
        p = {}
        setr(p, "body", 26.0, -3.0 * sn(f), 3.0 * cs(f))
        setr(p, "torso", 8.0, 5.0 * sn(f), 0)
        setr(p, "head", -30.0, 0, 8.0)
        setr(p, "jaw", 18.0, 0, 0)
        self.gait(p, f, 34.0, 52.0, toe=10.0, spread=1.5, lift_phase=0.45)
        for side in ("right", "left"):
            s = S[side]
            flap = sn(2 * f + (0 if s > 0 else 1.7))
            setr(p, f"{side}Arm", 14.0 + 10.0 * flap, 0, s * (8.0 + 4.0 * flap))
            setr(p, f"{side}Forearm", -4.0 - 6.0 * pos(flap), 0, 0)
            setr(p, f"{side}Hand", 10.0, 0, 0)
            self.open_hand(p, side, 0.7)
        meta(p, extra=0.7 * pos(sn(2 * f + 0.9)))
        return p

    def run_post(self, p, t):
        add_rot(p, "head", 0, 5.0 * flip(t, 6), 0)

    def pose1(self, t):
        """The picture: upright, arms hanging out at the sides; the head tips over and back."""
        p = {}
        tilt = window(t, 0.6, 2.2, 0.3)
        setr(p, "head", 4.0 * tilt, -6.0 * tilt, 16.0 * tilt)
        for side in ("right", "left"):
            self.hand(p, side, curl=0.15)
        self.stance(p, 0.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        self.finger_flex(p, "right", t, 1.4, amp=0.6, step=0.12, hold=0.3)

    def pose2(self, t):
        """The slump: sitting on the floor, legs out in front, head hanging to one side."""
        w = TAU * t / 3.0
        p = {}
        setr(p, "body", -8.0, 0, 0)
        setr(p, "torso", 22.0 + 1.5 * sn(w), 0, -5.0)
        setr(p, "head", 34.0, 12.0, 26.0 + 3.0 * sn(w))
        setr(p, "jaw", 10.0, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Leg", -84.0, 0, s * 8.0)
            setr(p, f"{side}Shin", 4.0, 0, 0)
            setr(p, f"{side}Foot", 0.0, 0, s * 10.0)
            setr(p, f"{side}Arm", 14.0, 0, s * 8.0)
            setr(p, f"{side}Forearm", -10.0, 0, 0)
            setr(p, f"{side}Hand", 20.0, 0, 0)
            self.hand(p, side, curl=0.4)
        meta(p, extra=-0.6)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "head", -8.0 * window(t, 1.6, 1.7, 0.02), 0, 0)
        self.finger_flex(p, "left", t, 2.0, amp=0.5)

    def performance1(self, t):
        """A music-box figurine: the whole body turns in ratchet clicks, one hand beckoning."""
        p = {}
        turn = (0, 10, 20, 30, 20, 10, 0, -10)[steps(t, 0.6, 8)]
        setr(p, "body", 0, turn, 0)
        setr(p, "torso", 3.0, 0, -0.1 * turn)
        setr(p, "head", 4.0, -0.6 * turn, 0.5 * turn)
        beck = ease(t / 0.5) * (1 - ease((t - 4.2) / 0.5))
        setr(p, "rightArm", -40.0 * beck, 0, 12.0 * beck)
        setr(p, "rightForearm", -50.0 * beck, 0, 0)
        setr(p, "rightHand", -24.0 * beck, 0, 0)
        self.hand(p, "right", curl=0.1)
        setr(p, "leftArm", -18.0, 0, -6.0)
        setr(p, "leftForearm", -78.0, 0, 0)               # the left hand rests on the belly
        self.hand(p, "left", curl=0.25)
        self.stance(p, 0.5, 0.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.8), 0, 0)
        on = window(t, 0.6, 4.0, 0.05)                      # come here... one finger after another
        n = fred3.HANDS[self.name]["fingers"]
        ks = [0.95 * on * pulse(t, 0.6, 0.32, 0.05, phase=0.06 * (n - 1 - i)) for i in range(n)]
        self.hand(p, "right", fingers=ks, thumb=0.0, add=True)

    def performance2(self, t):
        """An invisible piano: both hands out in front, every finger on its own key."""
        p = {}
        bob = pos(cs(TAU * t))
        setr(p, "torso", 9.0 + 3.0 * bob, 8.0 * sn(TAU * t / 4.0), 0)
        setr(p, "head", 12.0 + 5.0 * bob, -10.0 * sn(TAU * t / 4.0), 7.0 * sn(TAU * t / 2.0))
        for side in ("right", "left"):
            s = S[side]
            reach = sn(TAU * t / 2.0 + (0 if s > 0 else math.pi))
            setr(p, f"{side}Arm", -46.0, 0, -s * (14.0 + 7.0 * reach))
            setr(p, f"{side}Forearm", -40.0, 0, 0)
            setr(p, f"{side}Hand", 30.0, 0, 0)
            self.hand(p, side, curl=0.15, spread=0.4)
        self.stance(p, 1.5, 3.0)
        meta(p)
        return p

    def performance2_post(self, p, t):
        for side, ph in (("right", 0.0), ("left", 0.125)):
            self.finger_ripple(p, side, t, 0.5, 0.8, step=0.06, phase=ph, thumb_amp=0.5)
        add_rot(p, "jaw", song(t, 0.5), 0, 0)

    def jumpscare1(self, t):
        """IT'S ME: dead still... then only the head snaps up into your face, the arms stay limp."""
        p = {}
        k = ease((t - 0.3) / 0.06)
        setr(p, "body", 4.0 + 10.0 * k, 0, 0)
        setr(p, "torso", 10.0 - 4.0 * k, 0, 0)
        setr(p, "head", lerp(30.0, -38.0, k), 0, lerp(16.0, 0.0, k))
        setr(p, "jaw", lerp(6.0, 26.0, k), 0, 0)
        setr(p, "hat", -14.0 * k, 0, 0)
        for side in ("right", "left"):
            self.hang(p, side, fwd=4.0 + 10.0 * k, out=-2.0, elbow=-6.0, wrist=6.0)
            self.hand(p, side, curl=0.3)
        self.stance(p, 1.0, 3.0)
        meta(p, z=-12.0 * k)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.38, 1.2, head=10.0, rate=14, body=0.8)
        g = window(t, 0.15, 0.22, 0.01)
        add_rot(p, "head", 0, 20.0 * g, -12.0 * g)

    def jumpscare2(self, t):
        """Powers down - head drops, knees buckle - then jolts upright, arms flung out wide."""
        p = {}
        down = ease(t / 0.45)
        up = ease((t - 0.6) / 0.07)
        sag = down * (1 - up)
        setr(p, "body", 6.0 * sag + 8.0 * up, 0, 0)
        setr(p, "torso", 18.0 * sag - 6.0 * up, 0, 0)
        setr(p, "head", 44.0 * sag - 32.0 * up, 0, 26.0 * sag)
        setr(p, "jaw", 4.0 + 24.0 * up, 0, 0)
        setr(p, "hat", -10.0 * up, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", 8.0 * sag - 8.0 * up, 0, s * (-3.0 * sag + 86.0 * up))
            setr(p, f"{side}Forearm", -4.0 - 6.0 * up, 0, 0)
            setr(p, f"{side}Hand", 10.0 * sag, 0, 0)
            self.hand(p, side, curl=lerp(0.4, -0.8, up), spread=up, thumb=lerp(0.3, -0.8, up))
        self.stance(p, 1.5, 10.0 * sag)
        meta(p, z=-7.0 * up)
        return p

    def jumpscare2_post(self, p, t):
        g = window(t, 0.82, 0.86, 0.01) + window(t, 1.02, 1.06, 0.01)
        add_rot(p, "head", 0, 24.0 * g, -18.0 * g)
        self.scream_shake(p, t, 0.68, 1.6, head=8.0)
        self.jaw_clack(p, t, 0.7, 1.6, amp=8.0, rate=7)


# ==========================================================================
# Crimson Freddy: a heavy hydraulic brute
# ==========================================================================


class CrimsonNight(Fred3Night):
    LENGTHS = dict(idle=6.0, run=0.8, pose1=2.5, pose2=2.0, performance1=4.0, performance2=4.0, jumpscare1=1.3,
                   jumpscare2=1.5)

    def walk_len(self):
        return 1.6

    def schedule(self, name, L):
        heavy = dict(overshoot=0.1, settle=0.12)
        if name == "idle":
            return {"head": stepper(1.5, 0.45, 0.3, **heavy), "armR": stepper(1.0, 0.3, **heavy),
                    "armL": stepper(1.0, 0.3, 0.5, **heavy)}
        if name == "walk":
            return {"head": stepper(L / 2, 0.2, **heavy), "armR": stepper(L / 2, 0.25, L / 4, **heavy),
                    "armL": stepper(L / 2, 0.25, L / 4, **heavy)}
        if name == "run":
            return {"head": stepper(0.4, 0.1)}
        if name == "pose1":
            return {"head": stepper(1.25, 0.4, 0.2, **heavy), "armR": stepper(1.25, 0.35, **heavy),
                    "armL": stepper(1.25, 0.35, 0.3, **heavy)}
        if name in ("performance1", "performance2"):
            return {"torso": stepper(0.5, 0.15, **heavy)}
        return {}

    def idle(self, t):
        """Fists on his hips, chest pumping like a bellows, weight rocking, scanning the room."""
        w = TAU * t / 6.0
        p = {}
        breath = sn(TAU * t / 1.5)
        rock = sn(TAU * t / 3.0)
        setr(p, "body", 1.0, 0, 3.5 * rock)
        setr(p, "torso", 3.0 - 3.0 * breath, 4.0 * sn(w), -2.0 * rock)
        setr(p, "head", 4.0 + 2.0 * breath, 28.0 * sn(w), -1.5 * rock)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", 4.0, 0, s * (38.0 + 2.0 * breath))
            setr(p, f"{side}Forearm", -20.0, 0, -s * 62.0)
            setr(p, f"{side}Hand", 0, 0, -s * 20.0)
            self.fist(p, side, 0.9)
        self.stance(p, 3.0, 2.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        rub = window(t, 0.8, 2.4, 0.15)                       # takes one fist off his hip and cracks his knuckles
        add_rot(p, "rightArm", -36.0 * rub, 0, -30.0 * rub)
        add_rot(p, "rightForearm", -60.0 * rub, 0, 52.0 * rub)
        self.hand(p, "right", curl=-0.9 * rub * pulse(t, 0.4, 0.2, 0.04), add=True)
        crack = window(t, 3.8, 4.05, 0.03)                                   # cracks his neck
        add_rot(p, "head", 0, 0, 24.0 * crack - 22.0 * window(t, 4.15, 4.4, 0.03))
        add_rot(p, "jaw", 10.0 * window(t, 5.0, 5.35, 0.04), 0, 0)

    def walk(self, t):
        """Heavy stomp: wide steps, the body drops onto each foot, shoulders roll, fists swing."""
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        setr(p, "body", 5.0, -5.0 * sn(f), 5.0 * cs(f))
        setr(p, "torso", 7.0, 11.0 * sn(f), -3.0 * cs(f))
        setr(p, "head", 6.0, -9.0 * sn(f), 0)
        self.gait(p, f, 22.0, 26.0, toe=5.0, spread=3.0)
        for side in ("right", "left"):
            s = S[side]
            ph = f + (math.pi if s > 0 else 0.0)
            setr(p, f"{side}Arm", -4.0 + 18.0 * sn(ph), 0, s * 6.0)
            setr(p, f"{side}Forearm", -22.0, 0, 0)
            self.fist(p, side, 1.0)
        meta(p, extra=-0.9 * pos(-cs(2 * f)))
        return p

    def run(self, t):
        """A bull charge: head down, shoulders forward, fists pumping hard."""
        f = TAU * t / 0.8
        p = {}
        setr(p, "body", 24.0, -5.0 * sn(f), 0)
        setr(p, "torso", 12.0, 10.0 * sn(f), 0)
        setr(p, "head", 18.0, 0, 0)
        setr(p, "jaw", 12.0, 0, 0)
        self.gait(p, f, 40.0, 70.0, toe=12.0, spread=2.5, lift_phase=0.45)
        for side in ("right", "left"):
            s = S[side]
            ph = f + (math.pi if s > 0 else 0.0)
            setr(p, f"{side}Arm", -24.0 + 46.0 * sn(ph), 0, s * 6.0)
            setr(p, f"{side}Forearm", -80.0, 0, 0)
            setr(p, f"{side}Hand", -10.0, 0, 0)
            self.fist(p, side, 1.0)
        meta(p, extra=1.0 * pos(sn(2 * f + 0.9)))
        return p

    def pose1(self, t):
        """The picture: broad and square, arms hanging; the fists slowly close, the head turns."""
        p = {}
        grip = window(t, 0.4, 2.0, 0.4)
        setr(p, "torso", 1.5 * grip, 0, 0)
        setr(p, "head", 3.0 * grip, 18.0 * grip, 0)
        for side in ("right", "left"):
            self.hand(p, side, curl=0.1 + 0.8 * grip, thumb=0.1 + 0.7 * grip)
        self.stance(p, 0.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "jaw", 7.0 * window(t, 1.2, 1.5, 0.03), 0, 0)

    def pose2(self, t):
        """Boxer stance: fists up in front of his face, bouncing, throwing a jab and a cross."""
        w = TAU * t / 0.5
        p = {}
        bounce = pos(sn(w))
        setr(p, "body", 4.0, 16.0, 0)
        setr(p, "torso", 8.0, 8.0, 0)
        setr(p, "head", 12.0, -20.0, 0)
        for side, (ua, uz) in (("right", (-60.0, -24.0)), ("left", (-76.0, 20.0))):
            setr(p, f"{side}Arm", ua, 0, uz)
            setr(p, f"{side}Forearm", -96.0, 0, 0)
            setr(p, f"{side}Hand", 10.0, 0, 0)
            self.fist(p, side, 1.0)
        self.stance(p, 3.0, 6.0 + 5.0 * bounce)
        meta(p)
        return p

    def pose2_post(self, p, t):
        jab = window(t, 0.5, 0.75, 0.05)
        add_rot(p, "leftArm", -20.0 * jab, 0, -12.0 * jab)
        add_rot(p, "leftForearm", 60.0 * jab, 0, 0)
        cross = window(t, 1.25, 1.55, 0.06)
        add_rot(p, "rightArm", -26.0 * cross, 0, 22.0 * cross)
        add_rot(p, "rightForearm", 64.0 * cross, 0, 0)
        add_rot(p, "torso", 0, -18.0 * cross, 0)

    def performance1(self, t):
        """A rock song: a fist punching the air on every beat, head banging, a foot stomping."""
        p = {}
        beat = pos(cs(TAU * t))
        setr(p, "body", 2.0, 0, 3.0 * sn(TAU * t / 2.0))
        setr(p, "torso", 4.0 + 7.0 * beat, -10.0, 0)
        setr(p, "head", 4.0 + 18.0 * beat, 8.0, 0)
        pump = ease(window(t % 1.0, 0.0, 0.5, 0.15))
        setr(p, "rightArm", -150.0 - 22.0 * pump, 0, 12.0)
        setr(p, "rightForearm", -40.0 + 32.0 * pump, 0, 0)
        self.fist(p, "right", 1.0)
        setr(p, "leftArm", -30.0, 0, -12.0)
        setr(p, "leftForearm", -72.0, 0, 0)
        self.point(p, "left")
        self.stance(p, 3.0, 4.0 * beat)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 1.4), 0, 0)
        stomp = pulse(t, 1.0, 0.22, 0.04, phase=0.5)
        add_rot(p, "leftLeg", -14.0 * stomp, 0, 0)
        add_rot(p, "leftShin", 18.0 * stomp, 0, 0)
        add_rot(p, "leftFoot", -4.0 * stomp, 0, 0)

    def performance2(self, t):
        """A belly laugh: head thrown back, shoulders shaking, both hands on his belly."""
        p = {}
        laugh = window(t % 2.0, 0.25, 1.75, 0.2)
        setr(p, "torso", -8.0 * laugh, 0, 0)
        setr(p, "head", -24.0 * laugh, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -26.0, 0, -s * 8.0)
            setr(p, f"{side}Forearm", -78.0, 0, 0)
            setr(p, f"{side}Hand", 0, 0, -s * 28.0)
            self.hand(p, side, curl=0.15, spread=0.5)
        self.stance(p, 2.5, 2.5 * laugh)
        meta(p)
        return p

    def performance2_post(self, p, t):
        laugh = window(t % 2.0, 0.25, 1.75, 0.2)
        add_rot(p, "jaw", (14.0 + 9.0 * (flip(t, 6) > 0)) * laugh, 0, 0)
        add_rot(p, "torso", 2.5 * flip(t, 6) * laugh, 0, 0)
        add_rot(p, "head", 0, 0, 4.0 * flip(t, 3) * laugh)
        for side in ("right", "left"):                         # patting his belly
            add_rot(p, f"{side}Hand", 14.0 * pulse(t, 0.33, 0.12, 0.03) * laugh, 0, 0)

    def jumpscare1(self, t):
        """A bear hug: the arms swing wide open, then crash shut in front of you."""
        p = {}
        wide = ease((t - 0.05) / 0.18)
        shut = ease((t - 0.42) / 0.1)
        lunge = ease((t - 0.35) / 0.15)
        setr(p, "body", -4.0 * wide * (1 - lunge) + 18.0 * lunge, 0, 0)
        setr(p, "torso", -6.0 * wide * (1 - lunge) + 10.0 * lunge, 0, 0)
        setr(p, "head", -10.0 * wide - 22.0 * lunge, 0, 0)
        setr(p, "jaw", 12.0 * wide + 14.0 * lunge, 0, 0)
        setr(p, "hat", -10.0 * lunge, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(-30.0 * wide, -86.0, shut), 0, s * lerp(72.0 * wide, -12.0, shut))
            setr(p, f"{side}Forearm", lerp(-14.0 * wide, -54.0, shut), 0, 0)
            k = lerp(-0.6 * wide, 0.9, shut)
            self.hand(p, side, curl=k, spread=wide * (1 - shut), thumb=k)
        self.stance(p, 3.0, 6.0 * lunge)
        setr(p, "rightLeg", -22.0 * lunge, 0, 3.0)
        setr(p, "rightShin", 20.0 * lunge, 0, 0)
        flat_foot(p, "right")
        meta(p, z=-10.0 * lunge)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.55, 1.25, head=6.0, rate=10, body=2.0)

    def jumpscare2(self, t):
        """Both fists raised overhead, then slammed down at you with a roar."""
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
            self.fist(p, side, 1.0)
        self.stance(p, 3.0, 4.0 + 10.0 * slam)
        meta(p, z=-9.0 * slam)
        return p

    def jumpscare2_post(self, p, t):
        self.scream_shake(p, t, 0.55, 1.4, head=6.0, body=2.5)


# ==========================================================================
# Violet Bunny: jittery and springy
# ==========================================================================


class BunnyNight(Fred3Night):
    LENGTHS = dict(idle=5.0, run=0.6, pose1=2.0, pose2=2.0, performance1=4.0, performance2=4.0, jumpscare1=1.2,
                   jumpscare2=1.6)

    def walk_len(self):
        return 1.2

    def schedule(self, name, L):
        quick = dict(overshoot=0.12, settle=0.06)
        if name == "idle":
            return {"head": stepper(0.42, 0.06, **quick), "torso": stepper(0.84, 0.1, **quick),
                    "armR": stepper(0.6, 0.1, **quick), "armL": stepper(0.6, 0.1, 0.3, **quick),
                    "ears": stepper(0.3, 0.05, **quick)}
        if name == "walk":
            return {"head": stepper(L / 4, 0.05, **quick)}
        if name == "pose1":
            return {"head": stepper(0.5, 0.07, **quick), "ears": stepper(0.25, 0.04, **quick)}
        if name in ("pose2", "performance1", "performance2"):
            return {"head": stepper(0.5, 0.08, **quick)}
        return {}

    def ear_flop(self, p, phase, amp=8.0):
        setr(p, "rightEar", 0, 0, amp * 0.6 * sn(phase))
        setr(p, "leftEar", 0, 0, -amp * 0.4 * sn(phase + 0.6))
        setr(p, "leftEarTop", 0, 0, amp * sn(phase - 0.5))

    def idle(self, t):
        """Curious: the head cocks one way then the other, ears restless, weight on his toes."""
        w = TAU * t / 5.0
        p = {}
        setr(p, "torso", 2.0, 6.0 * sn(w), 2.0 * sn(2 * w))
        setr(p, "head", 4.0 * sn(3 * w), 18.0 * sn(2 * w + 0.5), 22.0 * sn(3 * w))
        for side in ("right", "left"):
            s = S[side]
            # hands together in front of his belly, fidgeting
            setr(p, f"{side}Arm", -22.0, 0, -s * 10.0)
            setr(p, f"{side}Forearm", -62.0, 0, 0)
            setr(p, f"{side}Hand", 10.0, 0, -s * 22.0)
            self.hand(p, side, curl=0.35)
        self.stance(p, 1.0)
        self.ear_flop(p, 4 * w, 10.0)
        meta(p, extra=0.25 * pos(sn(4 * w)))           # bobbing on his toes
        return p

    def idle_post(self, p, t):
        for t0 in (0.7, 2.1, 3.6):
            add_rot(p, "rightEar", 14.0 * window(t, t0, t0 + 0.12, 0.02), 0, 0)
        add_rot(p, "leftEarTop", 0, 0, 22.0 * window(t, 2.9, 3.2, 0.04))
        self.finger_ripple(p, "right", t, 0.5, 0.7, step=0.08)          # fingers drumming on each other
        self.finger_ripple(p, "left", t, 0.5, 0.6, step=0.08, phase=0.25)

    def walk(self, t):
        """A bouncy skip: springing off each foot, arms swinging high, ears flapping."""
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        setr(p, "body", 5.0, -5.0 * sn(f), 4.0 * cs(f))
        setr(p, "torso", 3.0, 8.0 * sn(f), 0)
        setr(p, "head", -4.0 + 6.0 * cs(2 * f), -7.0 * sn(f), 6.0 * sn(f))
        self.gait(p, f, 24.0, 48.0, toe=14.0, spread=1.0, lift_phase=0.2)
        for side in ("right", "left"):
            s = S[side]
            ph = f + (math.pi if s > 0 else 0.0)
            setr(p, f"{side}Arm", -8.0 + 30.0 * sn(ph), 0, s * 8.0)
            setr(p, f"{side}Forearm", -34.0, 0, 0)
            setr(p, f"{side}Hand", -10.0 * sn(ph), 0, 0)
            self.hand(p, side, curl=0.1, spread=0.3)
        self.ear_flop(p, 2 * f, 18.0)
        meta(p, extra=1.4 * pos(cs(2 * f)))
        return p

    def run(self, t):
        """Hopping: both feet push off together, arms swinging forward on every hop."""
        f = TAU * t / 0.6
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
            setr(p, f"{side}Arm", lerp(24.0, -55.0, hop), 0, s * 10.0)
            setr(p, f"{side}Forearm", -36.0, 0, 0)
            self.hand(p, side, curl=lerp(0.6, -0.4, hop), spread=hop)
        self.ear_flop(p, f, 22.0)
        setr(p, "jaw", 10.0, 0, 0)
        meta(p, extra=2.6 * hop)
        return p

    def pose1(self, t):
        """The picture: standing straight, arms hanging; the head cocks, the folded ear bobs."""
        p = {}
        cock = window(t, 0.3, 1.5, 0.15)
        setr(p, "head", 2.0 * cock, 8.0 * cock, -18.0 * cock)
        for side in ("right", "left"):
            self.hand(p, side, curl=0.1)
        self.stance(p, 0.0)
        self.ear_flop(p, TAU * t, 4.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "rightEar", 10.0 * window(t, 1.6, 1.72, 0.02), 0, 0)

    def pose2(self, t):
        """A shy wave beside his head, head tilted, the other hand behind his back."""
        w = TAU * t / 2.0
        p = {}
        setr(p, "body", 0, 0, -3.0)
        setr(p, "torso", 2.0, -6.0, -3.0)
        setr(p, "head", 4.0, 8.0, -16.0)
        setr(p, "rightArm", -20.0, 0, 120.0)
        setr(p, "rightForearm", -50.0, 0, 18.0 * sn(2 * w))
        setr(p, "rightHand", 0, 0, 10.0 * sn(2 * w + 0.4))
        self.open_hand(p, "right", 0.6)
        setr(p, "leftArm", 30.0, 0, 6.0)
        setr(p, "leftForearm", -70.0, 0, 0)
        self.hand(p, "left", curl=0.6)
        self.stance(p, 1.5)
        self.ear_flop(p, 2 * w, 6.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        self.finger_ripple(p, "right", t, 1.0, 0.9, step=0.05, phase=0.5)   # the fingers wiggle a wave

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
        self.hand(p, "left", curl=0.55)
        slap = pulse(t, 0.5, 0.12, 0.02)
        setr(p, "rightArm", -24.0, 30.0, 14.0)
        setr(p, "rightForearm", -88.0 + 16.0 * slap, 0, 0)
        setr(p, "rightHand", -20.0 * slap, 0, 0)
        self.hand(p, "right", curl=0.7, thumb=-0.4)
        self.stance(p, 2.5, 3.0 * bob)
        self.ear_flop(p, TAU * t * 2.0, 10.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.9), 0, 0)
        add_rot(p, "rightFoot", -12.0 * pulse(t, 0.5, 0.15, 0.03), 0, 0)
        self.finger_ripple(p, "left", t, 1.0, 0.4, step=0.12)               # fretting

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
            if up:
                self.point(p, sd)
            else:
                self.hand(p, sd, curl=0.3)
        self.ear_flop(p, TAU * t * 2.0, 16.0)
        meta(p, extra=0.8 * step)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", 12.0 * pulse(t, 0.5, 0.2, 0.03, phase=0.25), 0, 0)

    def jumpscare1(self, t):
        """Crouches low like a spring, ears pinned back... then pounces with clawed hands."""
        p = {}
        crouch = ease(t / 0.28)
        go = ease((t - 0.34) / 0.1)
        c = crouch * (1 - go)
        setr(p, "rightEar", 30.0 * c - 12.0 * go, 0, 16.0 * go)
        setr(p, "leftEar", 20.0 * c, 0, -30.0 * go)
        setr(p, "leftEarTop", 0, 0, -40.0 * c - 70.0 * go)
        setr(p, "body", 22.0 * c + 10.0 * go, 0, 0)
        setr(p, "torso", 14.0 * c + 6.0 * go, 0, 0)
        setr(p, "head", -10.0 * c - 32.0 * go, 0, 0)
        setr(p, "jaw", 4.0 * c + 26.0 * go, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", 30.0 * c - 110.0 * go, 0, s * (6.0 * c + 22.0 * go))
            setr(p, f"{side}Forearm", -30.0 * c - 34.0 * go, 0, 0)
            setr(p, f"{side}Hand", -20.0 * go, 0, 0)
            self.claw(p, side, 0.4 * c + go)
        self.stance(p, 2.0, 26.0 * c + 6.0 * go)
        meta(p, extra=1.2 * go * (1 - ease((t - 0.6) / 0.15)), z=-11.0 * go)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.42, 1.15, head=8.0, rate=14)

    def jumpscare2(self, t):
        """Peeks in slowly from the side with his head tipped right over... then screams."""
        p = {}
        lean = ease(t / 0.85)
        b = ease((t - 0.88) / 0.06)
        setr(p, "body", 6.0 * lean, 0, 10.0 * lean * (1 - b))
        setr(p, "torso", 12.0 * lean, 0, 8.0 * lean * (1 - b))
        setr(p, "head", 8.0 * lean - 30.0 * b, 0, 70.0 * lean * (1 - b))
        setr(p, "jaw", 4.0 * lean + 24.0 * b, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            # the hands creep up beside the face, then spring wide
            setr(p, f"{side}Arm", lerp(-30.0 * lean, -120.0, b), 0, s * lerp(-8.0 * lean, 44.0, b))
            setr(p, f"{side}Forearm", lerp(-90.0 * lean, -24.0, b), 0, 0)
            self.hand(p, side, curl=lerp(0.5 * lean, -0.8, b), spread=b, thumb=lerp(0.3, -0.8, b))
        self.ear_flop(p, 0.0, 0.0)
        setr(p, "leftEarTop", 0, 0, -60.0 * b)
        self.stance(p, 1.5, 3.0)
        meta(p, z=-4.0 * lean - 5.0 * b)
        return p

    def jumpscare2_post(self, p, t):
        self.scream_shake(p, t, 0.95, 1.5)


CLIPS = {"golden_freddy": GoldenNight, "crimson_freddy": CrimsonNight, "violet_bunny": BunnyNight}
