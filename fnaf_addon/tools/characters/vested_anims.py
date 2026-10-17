"""Night clips for the three vested.py animatronics.  Each moves in its own mechanical style, and each
of its nine clips has its own silhouette.

  rustgrin   a creaky old showman.  Proud and upright, chest out, chin up; moves in stiff jerks
             with rusty stalls and the odd grinding judder.
             idle: chest out, fingers drumming, head panning the room in steps
             walk: a stiff, proud march; run: a lumbering charge, arms out grabbing
             pose 1: the picture; pose 2: "ladies and gentlemen", one arm swept out wide
             performance 1: sings with deep bows, arms opening on the chorus
             performance 2: a soft-shoe shuffle, heel taps and swinging arms
             jumpscare 1: rears back, then lunges with both clawed hands up
             jumpscare 2: the head grinds round sideways, then snaps back screaming
  mirehop    a creeping, damaged rabbit.  Hunched and slow, sudden bursts of speed.
             idle: hunched, head lolling, the standing ear twitching, fingers curling
             walk: a crouched sneak; run: a lurching sprint, pitched forward, arms reaching
             pose 1: the picture, head cocking; pose 2: leaning out to peek, beckoning
             performance 1: a stiff air guitar; performance 2: hopping in place, ears flopping
             jumpscare 1: crouches, then springs at you with claws out
             jumpscare 2: slumped and dead, then the head jerks up and it lunges
  noxbriar   a shadow bear.  Slow, smooth and deliberate, long dead holds, then instant moves.
             idle: almost still, the head slowly following you, a glitch now and then
             walk: a slow, heavy glide; run: stiff and fast, arms swept back
             pose 1: the picture, head tilting slowly; pose 2: looming forward over you
             performance 1: conducts an orchestra; performance 2: a music-box waltz sway
             jumpscare 1: tilts its head... then is in your face; jumpscare 2: arms up, crashing down

Hands: the palm faces the leg with the thumb in front (fred3.py); roll() turns it back, down or
forward where a clip needs it.
"""
import math

from characters import fred3
from characters.fred3_anims import Fred3Night, pulse, song, steps
from characters.night import ease, flip, lerp, swing, window
from fnafkit.anim import S, TAU, cs, flat_foot, pos, setp, setr, sn
from fnafkit.servo import add_rot, meta, stepper


# ==========================================================================
# Rustgrin: a creaky old showman
# ==========================================================================


class RustgrinNight(Fred3Night):
    LENGTHS = dict(idle=6.0, run=0.9, pose1=3.0, pose2=3.0, performance1=4.0, performance2=4.0, jumpscare1=1.3,
                   jumpscare2=1.8)

    def walk_len(self):
        return 1.8

    def schedule(self, name, L):
        creak = dict(overshoot=0.08, settle=0.1)
        if name == "idle":
            return {"head": stepper(1.0, 0.25, 0.2, **creak), "torso": stepper(2.0, 0.4),
                    "armR": stepper(1.5, 0.3, 0.4), "armL": stepper(1.5, 0.3, 1.1)}
        if name == "walk":
            return {"head": stepper(L / 2, 0.12, **creak), "armR": stepper(L / 2, 0.2, L / 4, **creak),
                    "armL": stepper(L / 2, 0.2, L / 4, **creak)}
        if name == "run":
            return {"head": stepper(0.3, 0.06)}
        if name in ("pose1", "pose2"):
            return {"head": stepper(1.0, 0.25, 0.3, **creak), "armR": stepper(1.5, 0.35, **creak),
                    "armL": stepper(1.5, 0.35, 0.5, **creak)}
        if name == "performance1":
            return {"torso": stepper(0.5, 0.18, **creak), "head": stepper(0.5, 0.15, 0.1, **creak),
                    "armR": stepper(0.5, 0.2, 0.25), "armL": stepper(0.5, 0.2, 0.25)}
        if name == "performance2":
            return {"head": stepper(0.5, 0.12), "armR": stepper(0.5, 0.15, 0.25), "armL": stepper(0.5, 0.15, 0.25)}
        return {}

    def idle(self, t):
        """Chest out, chin up, arms at his sides; the head pans the room in creaky steps."""
        w = TAU * t / 6.0
        p = {}
        setr(p, "body", -1.5, 0, 1.5 * sn(w))
        setr(p, "torso", -3.0 + 1.0 * sn(2 * w), 5.0 * sn(w), 0)
        setr(p, "head", -4.0 + 2.0 * sn(2 * w + 1.0), 30.0 * sn(w), 3.0 * sn(w + 0.7))
        for side in ("right", "left"):
            self.hang(p, side, fwd=2.0, out=1.0, elbow=-8.0)
            self.hand(p, side, curl=0.25)
        self.stance(p, 1.5)
        meta(p)
        return p

    def idle_post(self, p, t):
        self.finger_ripple(p, "right", t, 0.5, 0.6, step=0.07)
        g = window(t, 3.2, 3.5, 0.02)                                     # a rusty judder
        add_rot(p, "head", 0, 3.0 * flip(t, 10) * g, 0)
        add_rot(p, "jaw", 9.0 * window(t, 4.4, 4.7, 0.04), 0, 0)
        add_rot(p, "hat", 0, 0, -4.0 * window(t, 4.4, 4.9, 0.05))

    def walk(self, t):
        """A stiff, proud march: chest out, knees high, arms swinging straight from the shoulder."""
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        setr(p, "body", -2.0, -4.0 * sn(f), 2.5 * cs(f))
        setr(p, "torso", -3.0, 6.0 * sn(f), -1.5 * cs(f))
        setr(p, "head", -5.0, -5.0 * sn(f), 0)
        self.gait(p, f, 24.0, 34.0, toe=6.0, spread=1.5)
        for side in ("right", "left"):
            s = S[side]
            ph = f + (math.pi if s > 0 else 0.0)
            setr(p, f"{side}Arm", 20.0 * sn(ph), 0, s * 2.0)
            setr(p, f"{side}Forearm", -10.0, 0, 0)
            self.hand(p, side, curl=0.4)
        meta(p, extra=-0.5 * pos(-cs(2 * f)))
        return p

    def walk_post(self, p, t):
        L = self.walk_len()
        add_rot(p, "head", 0, 22.0 * window(t, 0.4 * L, 0.65 * L, 0.05), 0)

    def run(self, t):
        """A lumbering charge, leaning in, both arms out in front grabbing."""
        f = TAU * t / 0.9
        p = {}
        setr(p, "body", 18.0, -5.0 * sn(f), 3.0 * cs(f))
        setr(p, "torso", 5.0, 7.0 * sn(f), 0)
        setr(p, "head", -20.0, -4.0 * sn(f), 0)
        setr(p, "jaw", 14.0, 0, 0)
        self.gait(p, f, 36.0, 64.0, toe=10.0, spread=2.0, lift_phase=0.45)
        for side in ("right", "left"):
            s = S[side]
            ph = f + (math.pi if s > 0 else 0.0)
            setr(p, f"{side}Arm", -64.0 + 10.0 * sn(ph), s * 4.0, s * 12.0)
            setr(p, f"{side}Forearm", -20.0, 0, 0)
            self.roll(p, side, 90.0)                         # palms down, grabbing
            self.claw(p, side, 0.8 + 0.2 * sn(2 * f))
        meta(p, extra=0.9 * pos(sn(2 * f + 0.9)))
        return p

    def run_post(self, p, t):
        add_rot(p, "head", 0, 3.0 * flip(t, 5), 0)

    def pose1(self, t):
        """The picture: upright, arms hanging out a little, fingers loose; a slow nod and chin lift."""
        p = {}
        nod = window(t, 0.5, 2.3, 0.35)
        setr(p, "head", -6.0 * nod, 8.0 * nod, -4.0 * nod)
        for side in ("right", "left"):
            self.hand(p, side, curl=0.12)
        self.stance(p, 0.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        self.finger_flex(p, "left", t, 1.2, amp=0.6)
        add_rot(p, "jaw", 7.0 * window(t, 2.4, 2.7, 0.04), 0, 0)

    def pose2(self, t):
        """'Ladies and gentlemen!': right arm swept out wide, palm open, left hand on his belly."""
        w = TAU * t / 3.0
        p = {}
        sweep = ease(t / 0.6) * (1 - ease((t - 2.6) / 0.4))
        setr(p, "body", -2.0, -8.0 * sweep, 0)
        setr(p, "torso", -4.0, -10.0 * sweep, 2.0 * sweep)
        setr(p, "head", -6.0 + 1.5 * sn(w), 22.0 * sweep, 6.0 * sweep)
        setr(p, "rightArm", -28.0 * sweep, 0, 4.0 + 66.0 * sweep)
        setr(p, "rightForearm", -12.0 * sweep, 0, 0)
        self.roll(p, "right", -90.0 * sweep)                  # palm toward the crowd
        self.open_hand(p, "right", 0.2 + 0.7 * sweep)
        setr(p, "leftArm", -24.0, 0, -8.0)
        setr(p, "leftForearm", -76.0, 0, 0)
        setr(p, "leftHand", 0, 0, 10.0)
        self.hand(p, "left", curl=0.2)
        setr(p, "rightLeg", -6.0, -8.0, 6.0)
        flat_foot(p, "right", toe=-6.0)
        setr(p, "leftLeg", 2.0, 4.0, -2.0)
        flat_foot(p, "left")
        meta(p)
        return p

    def pose2_post(self, p, t):
        add_rot(p, "jaw", 12.0 * window(t, 0.7, 1.0, 0.04) + 9.0 * window(t, 1.2, 1.5, 0.04), 0, 0)

    def performance1(self, t):
        """Sings with deep showman bows on every phrase, arms opening wide on the chorus."""
        p = {}
        bow = pulse(t, 1.0, 0.5, 0.15)
        chorus = ease((t - 2.0) / 0.3) * (1 - ease((t - 3.7) / 0.3))
        setr(p, "body", 4.0 * bow, 0, 0)
        setr(p, "torso", -2.0 + 16.0 * bow * (1 - chorus), 6.0 * sn(TAU * t / 4.0), 0)
        setr(p, "head", -8.0 + 6.0 * bow - 6.0 * chorus, 12.0 * sn(TAU * t / 4.0 + 0.5), 4.0 * sn(TAU * t / 2.0))
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(-20.0, -50.0, chorus), 0, s * lerp(6.0, 58.0, chorus))
            setr(p, f"{side}Forearm", lerp(-50.0, -10.0, chorus), 0, 0)
            self.roll(p, side, -70.0 * chorus)                # palms open to the audience
            self.hand(p, side, curl=lerp(0.3, -0.6, chorus), spread=chorus)
        self.stance(p, 1.5, 3.0 * bow)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t), 0, 0)

    def performance2(self, t):
        """A soft-shoe shuffle: steps side to side, heel taps, arms swinging across."""
        p = {}
        beat = TAU * t / 1.0
        side_k = sn(TAU * t / 2.0)
        setr(p, "body", 0, 8.0 * side_k, -4.0 * side_k)
        setr(p, "torso", -2.0, -6.0 * side_k, 3.0 * side_k)
        setr(p, "head", -4.0 + 4.0 * pos(cs(beat)), 10.0 * side_k, -6.0 * side_k)
        setp(p, "body", 0.8 * side_k, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            tap = pos(s * sn(TAU * t / 2.0)) * pos(sn(2 * beat))
            setr(p, f"{side}Leg", -18.0 * tap, 0, s * 3.0)
            setr(p, f"{side}Shin", 10.0 * tap, 0, 0)
            flat_foot(p, side, toe=-26.0 * tap)
            setr(p, f"{side}Arm", -30.0 - 12.0 * s * side_k, 0, s * 12.0)
            setr(p, f"{side}Forearm", -50.0, 0, -s * 20.0 * side_k)
            self.hand(p, side, curl=-0.3, spread=0.5)
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.6), 0, 0)
        add_rot(p, "hat", 0, 0, 6.0 * pulse(t, 1.0, 0.25, 0.05))

    def jumpscare1(self, t):
        """Rears back, then lunges in with both clawed hands up beside his gaping face."""
        p = {}
        a = ease(t / 0.12)
        k = ease((t - 0.12) / 0.12)
        setr(p, "body", lerp(-8.0 * a, 16.0, k), 0, 0)
        setr(p, "torso", lerp(-6.0 * a, 8.0, k), 0, 0)
        setr(p, "head", lerp(8.0 * a, -28.0, k), 0, 0)
        setr(p, "jaw", 26.0 * k, 0, 0)
        setr(p, "hat", -12.0 * k, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(10.0 * a, -120.0, k), 0, s * lerp(0, 28.0, k))
            setr(p, f"{side}Forearm", lerp(0, -40.0, k), 0, 0)
            self.roll(p, side, -90.0 * k)                     # claws up at you
            self.claw(p, side, k)
        self.stance(p, 1.5, 8.0 * k)
        meta(p, z=lerp(1.0 * a, -10.0, k))
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.26, 1.15, head=8.0, rate=12)
        self.jaw_clack(p, t, 0.3, 1.15, amp=8.0)

    def jumpscare2(self, t):
        """Stands still, the head grinding round to one side, then snaps back screaming."""
        p = {}
        turn = ease(t / 0.7)
        snap = ease((t - 0.85) / 0.06)
        setr(p, "head", lerp(-10.0 * turn, -24.0, snap), lerp(80.0 * turn, 0.0, snap), lerp(30.0 * turn, 0.0, snap))
        setr(p, "jaw", lerp(4.0, 26.0, snap), 0, 0)
        setr(p, "body", 10.0 * snap, 0, 0)
        setr(p, "torso", 6.0 * snap, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -50.0 * snap, 0, s * 40.0 * snap)
            setr(p, f"{side}Forearm", -20.0 * snap, 0, 0)
            self.roll(p, side, -90.0 * snap)
            self.hand(p, side, curl=lerp(0.2, -0.8, snap), spread=snap)
        self.stance(p, 1.5, 6.0 * snap)
        meta(p, z=-8.0 * snap)
        return p

    def jumpscare2_post(self, p, t):
        add_rot(p, "head", 0, 2.5 * flip(t, 14) * window(t, 0.05, 0.75, 0.02), 0)         # grinding
        self.scream_shake(p, t, 0.92, 1.7, head=8.0)
        self.jaw_clack(p, t, 0.95, 1.7, amp=9.0, rate=7)


# ==========================================================================
# Mirehop: a creeping, damaged rabbit
# ==========================================================================


class MirehopNight(Fred3Night):
    LENGTHS = dict(idle=5.0, run=0.7, pose1=2.5, pose2=3.0, performance1=4.0, performance2=2.0, jumpscare1=1.3,
                   jumpscare2=1.6)

    def walk_len(self):
        return 2.0

    def schedule(self, name, L):
        twitch = dict(overshoot=0.14, settle=0.06)
        if name == "idle":
            return {"head": stepper(1.25, 0.35, 0.2, **twitch), "torso": stepper(2.5, 0.6),
                    "armR": stepper(1.25, 0.3, 0.6), "armL": stepper(1.25, 0.3, 1.0), "ears": stepper(0.625, 0.05, **twitch)}
        if name == "walk":
            return {"head": stepper(L / 2, 0.15, 0.2, **twitch)}
        if name == "pose1":
            return {"head": stepper(0.625, 0.08, **twitch), "ears": stepper(0.625, 0.05, 0.3, **twitch)}
        if name == "pose2":
            return {"head": stepper(0.75, 0.12, **twitch)}
        if name == "performance1":
            return {"head": stepper(0.5, 0.08, **twitch), "torso": stepper(1.0, 0.15)}
        return {}

    def ear_flop(self, p, phase, amp=8.0):
        setr(p, "rightEar", 0, 0, amp * 0.5 * sn(phase))
        setr(p, "leftEar", 0, 0, -amp * 0.3 * sn(phase + 0.6))
        setr(p, "leftEarTop", 0, 0, amp * sn(phase - 0.5))

    def idle(self, t):
        """Hunched, the head lolling from side to side, arms hanging forward."""
        w = TAU * t / 5.0
        p = {}
        setr(p, "body", 6.0, 0, 1.5 * sn(w))
        setr(p, "torso", 10.0 + 2.0 * sn(2 * w), 6.0 * sn(w), 0)
        setr(p, "head", 6.0 + 4.0 * sn(2 * w), 14.0 * sn(w + 0.4), 20.0 * sn(w))
        for side in ("right", "left"):
            self.hang(p, side, fwd=10.0, out=0.0, elbow=-14.0, wrist=6.0)
            self.hand(p, side, curl=0.35)
        self.stance(p, 1.5, 6.0)
        self.ear_flop(p, 2 * w, 6.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        for t0 in (0.9, 1.2, 3.4):
            add_rot(p, "rightEar", 12.0 * window(t, t0, t0 + 0.1, 0.02), 0, 0)
        self.finger_flex(p, "right", t, 1.8, amp=0.7)
        self.finger_flex(p, "left", t, 3.9, amp=0.7)
        add_rot(p, "jaw", 10.0 * window(t, 2.6, 2.9, 0.03), 0, 0)

    def walk(self, t):
        """A crouched sneak: knees bent, long slow steps, arms hanging forward, head low."""
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        setr(p, "body", 12.0, -4.0 * sn(f), 3.0 * cs(f))
        setr(p, "torso", 10.0, 6.0 * sn(f), -2.0 * cs(f))
        setr(p, "head", -6.0, -8.0 * sn(f), 8.0 * cs(f))
        for side in ("right", "left"):
            s = S[side]
            ph = f if s > 0 else f + math.pi
            setr(p, f"{side}Leg", -16.0 - 22.0 * swing(ph), 0, s * 2.0)
            setr(p, f"{side}Shin", 24.0 + 28.0 * pos(cs(ph + 0.35)) ** 1.5, 0, 0)
            flat_foot(p, side, toe=-6.0 * sn(ph))
            setr(p, f"{side}Arm", -26.0 + 8.0 * sn(ph + math.pi), 0, s * 4.0)
            setr(p, f"{side}Forearm", -20.0, 0, 0)
            setr(p, f"{side}Hand", 10.0, 0, 0)
            self.hand(p, side, curl=0.5)
        self.ear_flop(p, f, 6.0)
        meta(p, extra=-1.2)
        return p

    def run(self, t):
        """A lurching sprint: pitched forward, both arms reaching out, ears streaming back."""
        f = TAU * t / 0.7
        p = {}
        setr(p, "body", 24.0, -6.0 * sn(f), 4.0 * cs(f))
        setr(p, "torso", 8.0, 8.0 * sn(f), 0)
        setr(p, "head", -26.0, 0, 6.0 * cs(f))
        setr(p, "jaw", 16.0, 0, 0)
        self.gait(p, f, 40.0, 70.0, toe=12.0, spread=2.0, lift_phase=0.45)
        for side in ("right", "left"):
            s = S[side]
            ph = f + (math.pi if s > 0 else 0.0)
            setr(p, f"{side}Arm", -70.0 + 16.0 * sn(ph), 0, s * 10.0)
            setr(p, f"{side}Forearm", -12.0, 0, 0)
            self.roll(p, side, 90.0)
            self.claw(p, side, 0.7)
        setr(p, "rightEar", 30.0, 0, 0)
        setr(p, "leftEar", 20.0, 0, 0)
        setr(p, "leftEarTop", 0, 0, 10.0 * sn(2 * f))
        meta(p, extra=1.0 * pos(sn(2 * f + 0.9)))
        return p

    def pose1(self, t):
        """The picture: upright, arms at its sides, the head cocking one way then the other."""
        p = {}
        cock = steps(t, 0.625, 4)
        setr(p, "head", 0, (0, 8, 0, -8)[cock], (0, 14, 0, -14)[cock])
        for side in ("right", "left"):
            self.hand(p, side, curl=0.2)
        self.stance(p, 0.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        add_rot(p, "rightEar", 10.0 * window(t, 1.6, 1.72, 0.02), 0, 0)
        add_rot(p, "leftEarTop", 0, 0, 14.0 * window(t, 0.6, 0.8, 0.03))

    def pose2(self, t):
        """Leans way out to one side to peek round a corner, beckoning with one finger."""
        p = {}
        lean = ease(t / 0.5)
        setr(p, "body", 4.0 * lean, 0, -16.0 * lean)
        setr(p, "torso", 4.0, -10.0 * lean, -12.0 * lean)
        setr(p, "head", 0, 14.0 * lean, -24.0 * lean)
        setr(p, "rightArm", -60.0 * lean, 0, 10.0 * lean)
        setr(p, "rightForearm", -60.0 * lean, 0, 0)
        self.roll(p, "right", -90.0 * lean)                   # palm up, beckoning
        self.point(p, "right")
        setr(p, "leftArm", -6.0, 0, -12.0 * lean)
        setr(p, "leftForearm", -20.0, 0, 0)
        self.hand(p, "left", curl=0.4)
        setr(p, "rightLeg", 0, 0, 10.0 * lean)
        flat_foot(p, "right")
        setr(p, "leftLeg", -6.0, 0, -4.0)
        setr(p, "leftShin", 10.0, 0, 0)
        flat_foot(p, "left")
        self.ear_flop(p, TAU * t / 1.5, 6.0)
        meta(p)
        return p

    def pose2_post(self, p, t):
        n = fred3.HANDS[self.name]["fingers"]          # the index finger
        on = window(t, 0.6, 2.8, 0.05)
        add_rot(p, f"rightFinger{n}a", -60.0 * on * pulse(t, 0.5, 0.25, 0.06), 0, 0)      # come here...
        add_rot(p, f"rightFinger{n}b", -50.0 * on * pulse(t, 0.5, 0.25, 0.06), 0, 0)

    def performance1(self, t):
        """A stiff air guitar: left hand up the neck, right hand strumming, knees bobbing."""
        p = {}
        beat = TAU * t / 0.5
        bob = pos(cs(beat))
        setr(p, "body", 4.0, 12.0, 0)
        setr(p, "torso", 4.0 + 3.0 * bob, -6.0, 3.0 * sn(TAU * t / 2.0))
        setr(p, "head", 6.0 + 10.0 * bob, -10.0 + 12.0 * sn(TAU * t / 4.0), 8.0 * sn(TAU * t / 2.0))
        setr(p, "leftArm", -50.0, 0, -36.0)
        setr(p, "leftForearm", -40.0, 0, 0)
        self.roll(p, "left", -90.0)                           # palm up under the neck
        self.hand(p, "left", curl=0.6)
        strum = sn(2 * beat)
        setr(p, "rightArm", -32.0 + 6.0 * strum, 0, 14.0)
        setr(p, "rightForearm", -74.0 + 12.0 * strum, 0, 0)
        self.roll(p, "right", 60.0 + 20.0 * strum)            # strumming
        self.hand(p, "right", curl=0.7)
        self.stance(p, 3.0, 4.0 + 6.0 * bob)
        self.ear_flop(p, beat, 6.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.7), 0, 0)
        self.finger_ripple(p, "left", t, 1.0, 0.4, step=0.1)

    def performance2(self, t):
        """Hops in place on both feet, arms bent like paws, ears flopping on every landing."""
        p = {}
        hop = TAU * t / 0.5
        air = pos(sn(hop))
        crouch = pos(-sn(hop))
        setr(p, "body", 4.0 * crouch, 0, 4.0 * sn(TAU * t / 2.0))
        setr(p, "torso", 2.0, 10.0 * sn(TAU * t / 2.0), 0)
        setr(p, "head", -4.0 + 6.0 * crouch, 12.0 * sn(TAU * t / 2.0), -8.0 * sn(TAU * t / 2.0))
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -40.0 - 10.0 * air, 0, s * 10.0)
            setr(p, f"{side}Forearm", -70.0, 0, 0)
            self.roll(p, side, 90.0)                          # paws down
            self.hand(p, side, curl=0.5)
        self.stance(p, 1.5, 12.0 * crouch, toe=-12.0 * air)
        self.ear_flop(p, hop - 1.0, 14.0)
        meta(p, extra=2.0 * air - 0.6 * crouch)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", 8.0 * pulse(t, 0.5, 0.2, 0.04, phase=0.25), 0, 0)

    def jumpscare1(self, t):
        """Crouches low, then springs at you with its claws out and ears forward."""
        p = {}
        c = ease(t / 0.25) * (1 - ease((t - 0.3) / 0.08))
        go = ease((t - 0.3) / 0.1)
        setr(p, "body", 14.0 * c + 18.0 * go, 0, 0)
        setr(p, "torso", 10.0 * c + 6.0 * go, 0, 0)
        setr(p, "head", 14.0 * c - 34.0 * go, 0, 0)
        setr(p, "jaw", 4.0 + 24.0 * go, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(10.0 * c, -110.0, go), 0, s * lerp(-4.0, 26.0, go))
            setr(p, f"{side}Forearm", lerp(-20.0 * c, -30.0, go), 0, 0)
            self.roll(p, side, -90.0 * go)                    # claws up at you
            self.claw(p, side, 0.3 + 0.7 * go)
        setr(p, "rightEar", 30.0 * c - 20.0 * go, 0, 0)
        setr(p, "leftEarTop", 0, 0, -40.0 * c - 60.0 * go)
        self.stance(p, 2.0, 30.0 * c + 6.0 * go)
        meta(p, extra=-2.0 * c, z=-11.0 * go)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.42, 1.2, head=8.0, rate=12)
        self.jaw_clack(p, t, 0.45, 1.2, amp=10.0)

    def jumpscare2(self, t):
        """Slumped and dead, then the head jerks up and it lunges at you."""
        p = {}
        up = ease((t - 0.55) / 0.05)
        go = ease((t - 0.7) / 0.1)
        sag = 1 - up
        setr(p, "body", 8.0 * sag + 14.0 * go, 0, 4.0 * sag)
        setr(p, "torso", 22.0 * sag + 6.0 * go, 0, -6.0 * sag)
        setr(p, "head", 40.0 * sag - 26.0 * go, 12.0 * sag, 26.0 * sag)
        setr(p, "jaw", 6.0 + 22.0 * up, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(10.0, -100.0, go), 0, s * lerp(-2.0, 30.0, go))
            setr(p, f"{side}Forearm", lerp(-6.0, -24.0, go), 0, 0)
            self.roll(p, side, 90.0 * go)
            self.hand(p, side, curl=lerp(0.4, 0.3, go), spread=go, thumb=lerp(0.3, -0.5, go))
        setr(p, "leftEarTop", 0, 0, 30.0 * sag)
        setr(p, "rightEar", -20.0 * sag, 0, 20.0 * sag)
        self.stance(p, 1.5, 14.0 * sag + 6.0 * go)
        meta(p, z=-10.0 * go)
        return p

    def jumpscare2_post(self, p, t):
        self.scream_shake(p, t, 0.6, 1.55, head=9.0, rate=12)
        self.jaw_clack(p, t, 0.6, 1.55, amp=10.0, rate=7)


# ==========================================================================
# Noxbriar: a shadow bear
# ==========================================================================


class NoxbriarNight(Fred3Night):
    LENGTHS = dict(idle=8.0, run=0.9, pose1=4.0, pose2=4.0, performance1=4.0, performance2=4.8, jumpscare1=1.6,
                   jumpscare2=1.6)

    def walk_len(self):
        return 2.4

    def schedule(self, name, L):
        if name == "idle":
            return {"head": stepper(2.0, 1.2, 0.5, overshoot=0.0), "armR": stepper(4.0, 1.0), "armL": stepper(4.0, 1.0, 2.0)}
        if name == "walk":
            return {"head": stepper(L, 0.6, overshoot=0.0)}
        if name == "performance2":
            return {"torso": stepper(0.6, 0.12, overshoot=0.1), "head": stepper(0.6, 0.12, 0.3, overshoot=0.1)}
        return {}

    def idle(self, t):
        """Almost still: the head slowly turns to follow you, the shoulders rise and fall."""
        w = TAU * t / 8.0
        p = {}
        breath = sn(TAU * t / 4.0)
        setr(p, "torso", 2.0 - 1.0 * breath, 0, 0)
        setr(p, "head", 6.0 + 4.0 * sn(2 * w), 36.0 * sn(w), 12.0 * sn(w + 1.2))
        for side in ("right", "left"):
            self.hang(p, side, fwd=2.0, out=0.5 + 0.8 * breath, elbow=-6.0)
            self.hand(p, side, curl=0.2)
        self.stance(p, 1.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        g = window(t, 5.5, 5.58, 0.01)                         # a single glitch frame
        add_rot(p, "head", -10.0 * g, -30.0 * g, 24.0 * g)
        self.finger_flex(p, "left", t, 2.5, amp=0.9, step=0.3, hold=0.6)

    def walk(self, t):
        """A slow, heavy glide: short steps, no bounce, arms hanging dead still."""
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        setr(p, "body", 3.0, -2.0 * sn(f), 1.5 * cs(f))
        setr(p, "torso", 3.0, 3.0 * sn(f), 0)
        setr(p, "head", 8.0, 0, 0)
        self.gait(p, f, 16.0, 18.0, toe=4.0, spread=1.0, k=0.9)
        for side in ("right", "left"):
            self.hang(p, side, fwd=2.0, elbow=-6.0)
            self.hand(p, side, curl=0.2)
        meta(p)
        return p

    def walk_post(self, p, t):
        L = self.walk_len()
        add_rot(p, "head", 0, -28.0 * window(t, 0.5 * L, 0.9 * L, 0.04), 0)        # turns to stare, holds

    def run(self, t):
        """Stiff and fast, upright, arms swept back, head locked on you."""
        f = TAU * t / 0.9
        p = {}
        setr(p, "body", 12.0, -3.0 * sn(f), 2.0 * cs(f))
        setr(p, "torso", 2.0, 4.0 * sn(f), 0)
        setr(p, "head", -12.0, -4.0 * sn(f), 0)
        setr(p, "jaw", 10.0, 0, 0)
        self.gait(p, f, 38.0, 60.0, toe=10.0, spread=1.5, lift_phase=0.45)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", 36.0, 0, s * 14.0)
            setr(p, f"{side}Forearm", -6.0, 0, 0)
            self.roll(p, side, 90.0)                          # palms back
            self.open_hand(p, side, 0.5)
        meta(p, extra=0.8 * pos(sn(2 * f + 0.9)))
        return p

    def pose1(self, t):
        """The picture: standing tall, arms out a little, the head slowly tilting over and back."""
        p = {}
        tilt = sn(TAU * t / 4.0)
        setr(p, "head", 4.0 * abs(tilt), 6.0 * tilt, 18.0 * tilt)
        for side in ("right", "left"):
            self.hand(p, side, curl=0.15)
        self.stance(p, 0.0)
        meta(p)
        return p

    def pose1_post(self, p, t):
        self.finger_flex(p, "right", t, 2.4, amp=0.7, step=0.25, hold=0.5)

    def pose2(self, t):
        """Looming: leans forward over you, head tipped down, arms raised a little, fingers spread."""
        p = {}
        lean = ease(t / 1.2)
        breath = sn(TAU * t / 2.0)
        setr(p, "body", 10.0 * lean, 0, 0)
        setr(p, "torso", 16.0 * lean + 1.0 * breath, 0, 0)
        setr(p, "head", 4.0 * lean, 0, 14.0 * lean)
        setr(p, "jaw", 6.0 * lean, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -40.0 * lean, 0, s * 26.0 * lean)
            setr(p, f"{side}Forearm", -30.0 * lean, 0, 0)
            self.roll(p, side, 90.0 * lean)                   # palms down over you
            self.claw(p, side, 0.2 + 0.6 * lean)
        self.stance(p, 2.0, 4.0 * lean)
        meta(p)
        return p

    def pose2_post(self, p, t):
        g = window(t, 2.8, 2.86, 0.01)
        add_rot(p, "head", 0, 20.0 * g, -16.0 * g)

    def performance1(self, t):
        """Conducts an orchestra in 4/4: the right hand beats the pattern, the left raised for the
        strings, the head following the baton."""
        p = {}
        beat = t % 1.0 / 0.25                     # 0..4 through the bar
        # down, in, out, up: the baton's sideways and up/down path for each beat
        path = [(0.0, -1.0), (-1.0, -0.4), (1.0, -0.4), (0.0, 1.0), (0.0, -1.0)]
        i = int(beat)
        k = ease(beat - i)
        bx = lerp(path[i][0], path[i + 1][0], k)
        by = lerp(path[i][1], path[i + 1][1], k)
        setr(p, "torso", -2.0, -6.0 * bx, 0)
        setr(p, "head", -6.0 - 6.0 * by, -10.0 * bx, 0)
        setr(p, "rightArm", -60.0 - 22.0 * by, 0, 14.0 + 16.0 * bx)
        setr(p, "rightForearm", -40.0 + 10.0 * by, 0, 0)
        self.roll(p, "right", 90.0)                           # palm down on the baton
        self.point(p, "right")
        lift = sn(TAU * t / 4.0)
        setr(p, "leftArm", -70.0 - 20.0 * lift, 0, -30.0)
        setr(p, "leftForearm", -30.0, 0, 0)
        self.roll(p, "left", -70.0)                           # palm up to the strings
        self.open_hand(p, "left", 0.4 + 0.3 * lift)
        self.stance(p, 2.0)
        meta(p)
        return p

    def performance1_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.5), 0, 0)

    def performance2(self, t):
        """A music-box waltz: sways from side to side in three-step clicks, arms open."""
        p = {}
        bar = TAU * t / 2.4
        turn = (0, 12, 24, 12, 0, -12, -24, -12)[steps(t, 0.6, 8)]
        sway = sn(bar)
        setr(p, "body", 0, turn, 6.0 * sway)
        setr(p, "torso", -2.0, 0, -4.0 * sway)
        setr(p, "head", 2.0, -0.4 * turn, 14.0 * sway)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -30.0, 0, s * (40.0 + 10.0 * s * sway))
            setr(p, f"{side}Forearm", -30.0, 0, 0)
            self.roll(p, side, -50.0)
            self.hand(p, side, curl=0.1, spread=0.5)
        self.stance(p, 1.5, 2.0 + 2.0 * abs(sway))
        meta(p)
        return p

    def performance2_post(self, p, t):
        add_rot(p, "jaw", song(t, 0.4), 0, 0)

    def jumpscare1(self, t):
        """Tilts its head slowly... then it's in your face, jaw wide."""
        p = {}
        tilt = ease(t / 0.6)
        k = ease((t - 0.65) / 0.05)
        setr(p, "head", lerp(6.0 * tilt, -30.0, k), lerp(10.0 * tilt, 0.0, k), lerp(34.0 * tilt, 0.0, k))
        setr(p, "jaw", lerp(2.0, 28.0, k), 0, 0)
        setr(p, "body", 18.0 * k, 0, 0)
        setr(p, "torso", 8.0 * k, 0, 0)
        setr(p, "hat", -12.0 * k, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -90.0 * k, 0, s * 30.0 * k)
            setr(p, f"{side}Forearm", -30.0 * k, 0, 0)
            self.roll(p, side, -90.0 * k)
            self.claw(p, side, k)
        self.stance(p, 1.5, 8.0 * k)
        meta(p, z=-13.0 * k)
        return p

    def jumpscare1_post(self, p, t):
        self.scream_shake(p, t, 0.72, 1.5, head=9.0, rate=14)
        self.jaw_clack(p, t, 0.75, 1.5, amp=10.0)

    def jumpscare2(self, t):
        """Raises both arms high over its head, then crashes them down at you."""
        p = {}
        up = ease(t / 0.4)
        down = ease((t - 0.55) / 0.08)
        setr(p, "body", lerp(-6.0 * up, 18.0, down), 0, 0)
        setr(p, "torso", lerp(-8.0 * up, 14.0, down), 0, 0)
        setr(p, "head", lerp(-14.0 * up, -20.0, down), 0, 0)
        setr(p, "jaw", 10.0 * up + 16.0 * down, 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(-165.0 * up, -70.0, down), 0, s * lerp(18.0 * up, 12.0, down))
            setr(p, f"{side}Forearm", lerp(-20.0 * up, -10.0, down), 0, 0)
            self.roll(p, side, 90.0 * down)
            self.claw(p, side, 0.4 + 0.6 * up)
        self.stance(p, 2.0, 12.0 * down)
        meta(p, z=-9.0 * down)
        return p

    def jumpscare2_post(self, p, t):
        self.scream_shake(p, t, 0.65, 1.5, head=8.0, rate=12, body=2.0)
        self.jaw_clack(p, t, 0.65, 1.5, amp=9.0)


CLIPS = {"rustgrin": RustgrinNight, "mirehop": MirehopNight, "noxbriar": NoxbriarNight}
