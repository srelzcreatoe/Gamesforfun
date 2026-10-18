"""Night clips for Withered Golden Freddy (withered_golden.py): a half-broken, lopsided suit.  The
head lists toward the torn-off ear, the shorting wires jerk it now and then, and the one glowing
eye flickers out and back on (its eyeGlow bone drops to scale 0 for a frame or two).

  idle: lopsided and slack-jawed, the head drifting in servo steps, sparks jerking it, the eye
        flickering, fingers twitching
  walk: a stiff, heavy shuffle with a hitch on the left side
  run: a lurching charge, both mitts reaching out in front
  pose 1: the picture: standing with the mitts curled, the head turned a little to its right
  pose 2: powered down: head sagging onto its chest, the eye dark; it flickers on, the head snaps
          up and stares, then it sags again
  performance 1: an old crooner's song: swaying, one mitt on the chest, the other sweeping out,
                 then tipping the hat
  performance 2: a broken jig: side steps with knee lifts that seize up mid-step, then carry on
  jumpscare 1: only the head lunges at you, jaw wide and the eye flaring, the body left behind
  jumpscare 2: slumped and dark, then it jolts upright and lunges with its arms flung out

Hands: as in the front picture, the back of the hand faces forward, turned a little toward the leg
(withered_golden.HAND_TURN), with the thumb on the inner side; roll() turns it from there (+ turns
the back of the hand up when the arm is raised in front, - turns the palm up).
"""
import math

from characters.fred3_anims import Fred3Night, pulse, song, steps
from characters.withered_golden import HAND_TURN
from characters.night import ease, flip, lerp, window
from fnafkit.anim import S, TAU, cs, flat_foot, pos, setp, setr, sets, sn
from fnafkit.servo import add_rot, meta, stepper


class WitheredGoldenNight(Fred3Night):
    LENGTHS = dict(idle=6.0, run=0.9, pose1=3.0, pose2=4.0, performance1=4.0, performance2=4.0, jumpscare1=1.4,
                   jumpscare2=1.6)
    LIST = 9.0                          # the head's resting lean toward the torn ear (degrees)

    def walk_len(self):
        return 2.0

    def schedule(self, name, L):
        if name == "idle":
            return {"head": stepper(1.5, 0.3, 0.2, overshoot=0.1), "torso": stepper(3.0, 0.6),
                    "armR": stepper(2.0, 0.4, 0.5), "armL": stepper(2.0, 0.4, 1.3)}
        if name == "walk":
            return {"head": stepper(L / 2, 0.15, 0.3)}
        if name in ("pose1", "performance1"):
            return {"head": stepper(1.0, 0.25, 0.3, overshoot=0.08)}
        if name == "performance2":
            return {"head": stepper(0.5, 0.1), "torso": stepper(0.5, 0.12)}
        return {}

    # ---- the glowing eye and the sparking wires ---------------------------------------------
    def eye(self, p, k):
        p.setdefault("eyeGlow", {})["scale"] = [k, k, k]

    def flicker(self, p, t, times, dur=0.09):
        """The eye cuts out for a moment at each time (overrides the clip's eye scale)."""
        if any(t0 <= t < t0 + dur for t0 in times):
            self.eye(p, 0.0)

    def spark(self, p, t, t0, mag=1.0):
        """A short in the torn ear: the head jerks toward it and the wires twitch."""
        g = window(t, t0, t0 + 0.12, 0.02)
        add_rot(p, "head", -6.0 * g * mag, -10.0 * g * mag, -16.0 * g * mag)
        add_rot(p, "leftEar", 0, 0, 25.0 * g * mag * flip(t, 16))

    def lean(self, p, x=0.0, y=0.0, z=0.0):
        """Head rotation on top of its resting list toward the left (torn) ear."""
        setr(p, "head", x, y, z - self.LIST)

    # ---- idle ------------------------------------------------------------------------------
    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        setr(p, "body", 1.0, 0, 1.5 + 1.0 * sn(w))
        setr(p, "torso", 4.0, 5.0 * sn(w), -2.0)
        self.lean(p, 6.0 + 3.0 * sn(2 * w), 22.0 * sn(w + 0.5), 4.0 * sn(w))
        setr(p, "jaw", 6.0 + 3.0 * pos(sn(2 * w)), 0, 0)
        for side in ("right", "left"):
            s = S[side]
            self.hang(p, side, fwd=3.0, out=1.0 if s > 0 else -1.0, elbow=-8.0, wrist=0.0)
            self.hand(p, side, curl=0.45)
        self.stance(p, 1.5, 2.0)
        self.eye(p, 1.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        for t0, m in ((1.4, 1.0), (3.9, 0.7), (4.15, 0.5)):
            self.spark(p, t, t0, m)
        self.flicker(p, t, (1.42, 1.6, 3.92, 5.3))
        self.finger_flex(p, "right", t, 2.4, amp=0.4)
        add_rot(p, "jaw", 12.0 * window(t, 5.0, 5.3, 0.04), 0, 0)

    # ---- walk ------------------------------------------------------------------------------
    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        hitch = pos(-sn(f))                                 # the left side gives a little under him
        setr(p, "body", 4.0, -4.0 * sn(f), 3.0 * cs(f) + 3.0 * hitch)
        setr(p, "torso", 5.0, 6.0 * sn(f), -2.0 * cs(f))
        self.lean(p, 6.0, -6.0 * sn(f), -3.0 * hitch)
        setr(p, "jaw", 6.0, 0, 0)
        self.gait(p, f, 0, 0, sides={"right": (22.0, 30.0, 6.0), "left": (16.0, 18.0, 3.0)}, spread=1.5)
        for side in ("right", "left"):
            s = S[side]
            ph = f + (math.pi if s > 0 else 0.0)
            setr(p, f"{side}Arm", 12.0 * sn(ph), 0, s * 2.0)
            setr(p, f"{side}Forearm", -12.0, 0, 0)
            self.hand(p, side, curl=0.5)
        self.eye(p, 1.0)
        meta(p, extra=-0.5 * hitch)
        return p

    def walk_post(self, p, t):
        L = self.walk_len()
        self.spark(p, t, 0.55 * L, 0.8)
        self.flicker(p, t, (0.56 * L,))

    # ---- run -------------------------------------------------------------------------------
    def run(self, t):
        f = TAU * t / 0.9
        p = {}
        setr(p, "body", 20.0, -5.0 * sn(f), 3.0 * cs(f))
        setr(p, "torso", 6.0, 6.0 * sn(f), 0)
        self.lean(p, -22.0, -4.0 * sn(f), 0)
        setr(p, "jaw", 16.0, 0, 0)
        self.gait(p, f, 36.0, 62.0, toe=10.0, spread=2.0, lift_phase=0.45)
        for side in ("right", "left"):
            s = S[side]
            ph = f + (math.pi if s > 0 else 0.0)
            setr(p, f"{side}Arm", -66.0 + 10.0 * sn(ph), 0, s * 10.0)
            setr(p, f"{side}Forearm", -18.0, 0, 0)
            self.roll(p, side, HAND_TURN)                   # back of the hand up: palms down, reaching
            self.claw(p, side, 0.7)
        self.eye(p, 1.0)
        meta(p, extra=0.9 * pos(sn(2 * f + 0.9)))
        return p

    def run_post(self, p, t):
        add_rot(p, "head", 0, 3.0 * flip(t, 6), 0)

    # ---- poses -----------------------------------------------------------------------------
    def pose1(self, t):
        """The picture: standing square, the mitts curled, the head turned a little to its right."""
        p = {}
        look = window(t, 0.4, 2.4, 0.3)
        setr(p, "head", 2.0 * look, 8.0 * look, 0)                # facing front, as in the picture, then a slow look aside
        for side in ("right", "left"):
            self.hand(p, side, curl=0.36, thumb=0.35)         # fingers half bent, as in the picture
        self.stance(p, 0.0)
        self.eye(p, 1.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        self.spark(p, t, 2.6, 0.6)
        self.flicker(p, t, (2.62,))
        self.finger_flex(p, "left", t, 1.2, amp=0.35)

    def pose2(self, t):
        """Powered down, head on its chest and the eye dark; it flickers on, the head snaps up and
        stares, then it sags again."""
        p = {}
        on = ease((t - 1.6) / 0.06) * (1 - ease((t - 3.0) / 0.5))
        sag = 1 - on
        setr(p, "body", 4.0 * sag, 0, 2.0 * sag)
        setr(p, "torso", 14.0 * sag + 2.0, 0, -4.0 * sag)
        self.lean(p, 40.0 * sag - 4.0 * on, 8.0 * sag, -14.0 * sag)
        setr(p, "jaw", 10.0 * sag + 3.0 * on, 0, 0)
        setr(p, "hat", 10.0 * sag, 0, -6.0 * sag)
        for side in ("right", "left"):
            s = S[side]
            self.hang(p, side, fwd=8.0 * sag, out=-2.0 * s * sag, elbow=-4.0 - 6.0 * on, wrist=6.0 * sag)
            self.hand(p, side, curl=0.35 + 0.3 * on)
        self.stance(p, 1.5, 6.0 * sag)
        self.eye(p, 1.0 if 1.55 <= t <= 3.2 else 0.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        self.flicker(p, t, (1.75, 1.92))
        self.spark(p, t, 2.5, 0.6)

    # ---- performances ------------------------------------------------------------------------
    def performance1(self, t):
        """An old crooner: sways, the left mitt on the chest, the right sweeping out, then the hat tip."""
        p = {}
        sway = sn(TAU * t / 2.0)
        sweep = ease((t - 0.3) / 0.5) * (1 - ease((t - 2.2) / 0.4))
        tip = ease((t - 2.5) / 0.3) * (1 - ease((t - 3.6) / 0.3))
        setr(p, "body", 1.0, 0, 3.0 * sway)
        setr(p, "torso", 3.0 + 6.0 * tip, 6.0 * sn(TAU * t / 4.0), 1.5 * sway)
        self.lean(p, 2.0 + 6.0 * tip, 14.0 * sn(TAU * t / 4.0 + 0.4), -3.0 * sway)
        setr(p, "leftArm", -26.0, 0, -6.0)
        setr(p, "leftForearm", -78.0, 0, 0)               # the left mitt over the chest
        self.hand(p, "left", curl=0.3)
        setr(p, "rightArm", lerp(-30.0 * sweep, -150.0, tip), 0, lerp(8.0 + 50.0 * sweep, 18.0, tip))
        setr(p, "rightForearm", lerp(-10.0 * sweep, -60.0, tip), 0, 0)
        self.roll(p, "right", -(180.0 - HAND_TURN) * sweep)  # palm up to the crowd
        self.hand(p, "right", curl=lerp(0.4 - 0.6 * sweep, 0.6, tip), spread=0.6 * sweep)
        setr(p, "hat", -10.0 * tip, 0, 10.0 * tip)
        setp(p, "hat", 0, 1.2 * tip, 0)
        self.stance(p, 1.5, 2.0 + 2.0 * pos(cs(TAU * t)))
        self.eye(p, 1.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.8), 0, 0)
        self.flicker(p, t, (1.95,))

    def performance2(self, t):
        """A broken jig: side steps and knee lifts that seize up halfway, then carry on."""
        p = {}
        stuck = 1.0 if 1.7 <= t < 2.3 else 0.0
        tt = 1.7 if stuck else (t if t < 1.7 else t - 0.6)  # the motion stops dead while it is stuck
        beat = TAU * tt / 1.0
        side_k = sn(TAU * tt / 2.0)
        setr(p, "body", 0, 8.0 * side_k, -4.0 * side_k)
        setp(p, "body", 0.8 * side_k, 0, 0)
        setr(p, "torso", 2.0, -6.0 * side_k, 3.0 * side_k)
        self.lean(p, 2.0 + 4.0 * pos(cs(beat)), 10.0 * side_k, -5.0 * side_k)
        for side in ("right", "left"):
            s = S[side]
            lift = pos(s * sn(TAU * tt / 2.0)) * pos(sn(2 * beat))
            setr(p, f"{side}Leg", -30.0 * lift, 0, s * 3.0)
            setr(p, f"{side}Shin", 40.0 * lift, 0, 0)
            flat_foot(p, side, toe=-6.0 * lift)
            setr(p, f"{side}Arm", -20.0 - 14.0 * s * side_k, 0, s * 14.0)
            setr(p, f"{side}Forearm", -60.0, 0, 0)
            self.hand(p, side, curl=0.5)
        self.eye(p, 1.0)
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.5) * (0.0 if 1.7 <= t < 2.3 else 1.0), 0, 0)
        self.spark(p, t, 1.72, 1.0)
        self.spark(p, t, 2.05, 0.6)
        self.flicker(p, t, (1.74, 1.9, 2.1))

    # ---- jumpscares --------------------------------------------------------------------------
    def jumpscare1(self, t):
        """Only the head comes at you: it lunges off the shoulders, jaw wide, the eye flaring."""
        p = {}
        k = ease((t - 0.25) / 0.08)
        self.lean(p, lerp(10.0, -18.0, k), 0, lerp(0.0, self.LIST, k))
        setp(p, "head", 0, 1.5 * k, -7.0 * k)
        sets(p, "head", 1.0 + 0.25 * k)
        setr(p, "jaw", lerp(6.0, 30.0, k), 0, 0)
        setr(p, "hat", -16.0 * k, 0, 0)
        for side in ("right", "left"):
            self.hang(p, side, fwd=3.0, elbow=-8.0)
            self.hand(p, side, curl=0.45)
        self.stance(p, 1.5, 2.0)
        self.eye(p, 1.0 + 0.6 * k)
        meta(p, z=-4.0 * k)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.33, 1.3, head=9.0, rate=14, body=0.8)
        self.jaw_clack(p, t, 0.35, 1.3, amp=10.0)
        self.flicker(p, t, (0.1, 0.18))

    def jumpscare2(self, t):
        """Slumped and dark, then it jolts upright and lunges with its arms flung out."""
        p = {}
        up = ease((t - 0.45) / 0.07)
        go = ease((t - 0.55) / 0.1)
        sag = 1 - up
        setr(p, "body", 4.0 * sag + 14.0 * go, 0, 2.0 * sag)
        setr(p, "torso", 16.0 * sag + 6.0 * go, 0, -4.0 * sag)
        self.lean(p, 40.0 * sag - 26.0 * go, 8.0 * sag, -14.0 * sag)
        setr(p, "jaw", 8.0 + 22.0 * up, 0, 0)
        setr(p, "hat", -12.0 * go, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(8.0 * sag, -70.0, go), 0, s * lerp(-2.0, 60.0, up))
            setr(p, f"{side}Forearm", lerp(-4.0, -20.0, go), 0, 0)
            self.roll(p, side, HAND_TURN * go)
            self.claw(p, side, up)
        self.stance(p, 1.5, 8.0 * sag + 6.0 * go)
        self.eye(p, up * (1.0 + 0.4 * go))
        meta(p, z=-10.0 * go)
        return p

    def jumpscare2_post(self, p, t):
        self.scream_shake(p, t, 0.6, 1.5, head=9.0)
        self.jaw_clack(p, t, 0.6, 1.5, amp=9.0, rate=7)
        self.spark(p, t, 0.5, 1.0)
