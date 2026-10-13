"""Shared "animatronic at night" clips for the Freddy-style rigs.

Every clip has two parts:

  base(t)       the motion itself, written smoothly; each bone group then plays it
                on its own servo schedule (fnafkit.servo), so heads snap and hold,
                arms move in separate jerks, and nothing drifts like a living thing
  post(p, t)    real-time overlays with hard mechanical timing: twitches, jaw clacks,
                head shakes

A character subclasses NightClips, fills `info` and overrides the clips that are
specific to it (usually the poses and performances).
"""
import math

from fnafkit.anim import S, TAU, bone_goal, cs, flat_foot, pos, setr, sn, solve_arm, torso_goal
from fnafkit.servo import Mechanical, add_rot, make_linear_clip, meta, stepper


def clamp01(x):
    return min(1.0, max(0.0, x))


def ease(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def window(t, t0, t1, ramp=0.06):
    """0 outside [t0, t1], 1 inside, with linear ramps: a mechanical on/off pulse."""
    if t <= t0 or t >= t1:
        return 0.0
    return min(1.0, (t - t0) / ramp, (t1 - t) / ramp)


def lerp(a, b, k):
    return a + (b - a) * k


def swing(x, k=0.7):
    """Sine with longer dwell at the extremes: a mechanical pendulum."""
    v = math.sin(x)
    return math.copysign(abs(v) ** k, v)


def flip(t, rate):
    """+1/-1 square wave that flips `rate` times a second (aligned to 24 fps frames)."""
    return 1.0 if math.floor(t * rate * 2 + 1e-6) % 2 == 0 else -1.0


class NightClips:
    """info keys:
      mouth, mouth_axis   mic target in head coordinates
      half_w, torso       chest half width, chest (bottom, top)
      mic                 dict from the character (or None)
      jaw_max             how far the jaw opens in a jumpscare
      tail                tail bone names (root first)
      withered            broken / limp personality
    """

    LENGTHS = dict(idle=6.0, walk=1.6, run=0.8, pose1=2.0, pose2=2.0, performance1=4.0, performance2=4.0,
                   jumpscare1=1.25, jumpscare2=1.5)
    IK_CLIPS = ()               # clips whose base runs IK (sampled sparsely, in order)

    def __init__(self, info):
        self.i = info
        self.w = info.get("withered", False)
        self.ik = {}

    # ---- helpers ------------------------------------------------------------------
    def arm_ik(self, key, p, side, goal, x0, effector=None, lock_hand=None):
        prev = self.ik.get(key)
        self.ik[key], _ = solve_arm(p, side, goal, prev or x0, restarts=1 if prev else 8,
                                    effector=effector, lock_hand=lock_hand)

    def mic_effector(self):
        m = self.i["mic"]
        return ("mic", m["head"], m["axis"])

    def mouth_goal(self, elbow=(11.5, 27.0, -5.0), axis=None):
        return bone_goal("head", self.i["mouth"], axis=axis or self.i["mouth_axis"], elbow=elbow)

    def hip_goal(self, side):
        s = S[side]
        hw, t0 = self.i["half_w"], self.i["torso"][0]
        return torso_goal((s * (hw + 1.1), t0 + 1.0, -0.5), normal=(-s, 0, 0), fingers=(0, -0.35, -1),
                          elbow=(s * (hw + 8.0), t0 + 6.0, 1.5))

    def stance(self, p, spread=1.5, bend=0.0, toe=0.0):
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Leg", -bend, 0, s * spread)
            setr(p, f"{side}Shin", bend * 1.8, 0, 0)
            flat_foot(p, side, toe)

    def arms_hang(self, p, fwd=0.0, out=1.0, elbow=-6.0):
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", -fwd, 0, s * out)
            setr(p, f"{side}Forearm", elbow, 0, 0)

    def ears(self, p, phase, amp=2.0):
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Ear", amp * sn(phase + (0 if s > 0 else 0.8)), 0, s * amp * 0.6 * cs(phase))

    def tail(self, p, phase, amp=8.0, lift=0.0):
        for k, b in enumerate(self.i.get("tail", ())):
            setr(p, b, lift * (k == 0), amp * sn(phase - 0.7 * k) * (0.6 + 0.15 * k), 0)

    def fingers_open(self, p, k, sides=("right", "left")):
        for side in sides:
            if side == "right" and self.i.get("mic") and not self.w:
                continue            # keep the grip on the mic
            setr(p, f"{side}Fingers", 0, 0, S[side] * 38 * k)
            setr(p, f"{side}Thumb", 0, 0, -S[side] * 20 * k)

    def mic_hand_rest(self, p):
        """The mic hand is held a little forward while standing."""
        if self.i.get("mic") and not self.w:
            setr(p, "rightArm", -6.0, 0, 1.0)
            setr(p, "rightForearm", -24.0, 0, 0)

    # ---- idle: stands still, head scanning the room in servo jerks -------------------------
    def idle(self, t):
        w = TAU * t / 6.0
        p = {}
        W = self.w
        setr(p, "body", 2.0 if W else 0.0, 0, -1.5 if W else 0.0)
        setr(p, "torso", (3.0 if W else 0.0) + 1.2 * sn(w), 0, 0)
        setr(p, "head", (6.0 if W else 2.0) + 3.0 * sn(2 * w + 1.0), 26.0 * sn(w), (7.0 if W else 0.0) + 2.0 * sn(w))
        self.arms_hang(p, fwd=2.0, out=1.0 if not W else -1.0, elbow=-5.0 if not W else -9.0)
        self.mic_hand_rest(p)
        self.stance(p, 1.5, 2.0 if W else 0.0)
        self.tail(p, 2 * w, 6.0)
        meta(p)
        return p

    def idle_post(self, p, t):
        W = self.w
        tw = window(t, 3.55, 3.95, 0.04)
        add_rot(p, "head", 0, (12.0 if W else 7.0) * tw, (-14.0 if W else -6.0) * tw)
        clack = window(t, 2.0, 2.35, 0.04) + 0.6 * window(t, 4.6, 4.85, 0.04)
        add_rot(p, "jaw", (12.0 if W else 9.0) * clack + (4.0 if W else 0.0), 0, 0)
        arm = window(t, 1.0, 1.3, 0.05)
        add_rot(p, "leftForearm", -14.0 * arm, 0, 0)
        add_rot(p, "leftArm", 0, 0, (-8.0 if W else -3.0) * arm)
        for side, t0 in (("right", 0.5), ("left", 4.2)):
            add_rot(p, f"{side}Ear", 0, 0, -S[side] * 10.0 * window(t, t0, t0 + 0.2, 0.03))
        if W:
            g = window(t, 5.2, 5.35, 0.02)
            add_rot(p, "head", -8.0 * g, -10.0 * g, 0)

    # ---- walk: stiff, heavy pendulum legs; arms jerk in steps; head locked forward ---------
    def walk_len(self):
        return 1.8 if self.w else 1.6

    def walk(self, t):
        L = self.walk_len()
        f = TAU * t / L
        p = {}
        for side in ("right", "left"):
            s = S[side]
            ph = f if s > 0 else f + math.pi
            limp = self.w and side == "left"
            th = (-12.0 if limp else -22.0) * swing(ph)
            bend = 4.0 + (8.0 if limp else 26.0) * pos(cs(ph + 0.35)) ** 1.6
            setr(p, f"{side}Leg", th, 0, s * (3.0 if limp else 1.0))
            setr(p, f"{side}Shin", bend, 0, 0)
            flat_foot(p, side, toe=(-3.0 if limp else -8.0) * sn(ph))
            mic_arm = side == "right" and self.i.get("mic") and not self.w
            amp = 6.0 if mic_arm else (14.0 if self.w else 10.0)
            setr(p, f"{side}Arm", amp * sn(ph), 0, s * 2.0)
            setr(p, f"{side}Forearm", -24.0 if mic_arm else (-6.0 if self.w else -10.0), 0, 0)
        lurch = pos(-sn(f)) if self.w else 0.0
        setr(p, "body", 2.0 + (2.0 if self.w else 0.0), -3.0 * sn(f), 3.0 * cs(f) + 5.0 * lurch)
        setr(p, "torso", 2.0 + (3.0 if self.w else 0.0), 5.0 * sn(f), -1.5 * cs(f))
        setr(p, "head", 4.0 + (5.0 if self.w else 0.0), -4.0 * sn(f), (7.0 if self.w else 0.0) - 3.0 * lurch)
        self.tail(p, f, 10.0)
        meta(p)
        return p

    def walk_post(self, p, t):
        L = self.walk_len()
        look = window(t, 0.35 * L, 0.6 * L, 0.04)
        add_rot(p, "head", 0, 20.0 * look, 0)            # snaps to look at something, then back
        if self.w:
            add_rot(p, "jaw", 7.0 * window(t, 0.1 * L, 0.3 * L, 0.04) + 4.0 * window(t, 0.65 * L, 0.8 * L, 0.03), 0, 0)
            add_rot(p, "head", 0, 0, -10.0 * window(t, 0.82 * L, 0.9 * L, 0.02))

    # ---- run: rigid chase, arms locked forward, head staring with a servo judder -----------
    def run(self, t):
        f = TAU * t / 0.8
        p = {}
        for side in ("right", "left"):
            s = S[side]
            ph = f if s > 0 else f + math.pi
            setr(p, f"{side}Leg", -10.0 - 38.0 * swing(ph, 0.75), 0, s * 2.0)
            setr(p, f"{side}Shin", 18.0 + 70.0 * pos(cs(ph + 0.45)) ** 1.3, 0, 0)
            flat_foot(p, side, toe=-12.0 * sn(ph) + 6.0)
            setr(p, f"{side}Arm", -72.0 + 8.0 * sn(ph), s * 6.0, s * 10.0)
            setr(p, f"{side}Forearm", -16.0, 0, 0)
            setr(p, f"{side}Hand", 10.0, 0, 0)
        self.fingers_open(p, 0.7)
        setr(p, "body", 16.0, -4.0 * sn(f), 2.0 * cs(f))
        setr(p, "torso", 4.0, 5.0 * sn(f), 0)
        setr(p, "head", -16.0, -3.0 * sn(f), 6.0 if self.w else 0.0)
        setr(p, "jaw", 16.0 if self.w else 10.0, 0, 0)
        self.tail(p, f, 14.0, lift=20.0)
        meta(p, extra=1.0 * pos(sn(2 * f + 0.9)))
        return p

    def run_post(self, p, t):
        add_rot(p, "head", 0, 2.5 * flip(t, 4), 0)
        if self.w:
            add_rot(p, "jaw", 5.0 * (flip(t, 6) > 0), 0, 0)

    # ---- jumpscare 1: lunge at the camera, then the shaking scream -------------------------
    def jumpscare1(self, t):
        p = {}
        a = ease(t / 0.08)                      # lean back
        k = ease((t - 0.08) / 0.12)             # lunge
        setr(p, "body", lerp(-6.0 * a, 16.0, k), 0, 0)
        setr(p, "torso", lerp(-3.0 * a, 8.0, k), 0, 0)
        setr(p, "head", lerp(6.0 * a, -30.0, k), 0, 0)
        setr(p, "jaw", self.i["jaw_max"] * k, 0, 0)
        setr(p, "hat", lerp(0, -10.0, k), 0, 0)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Arm", lerp(15.0 * a, -100.0, k), s * 10.0 * k, s * lerp(0, 18.0, k))
            setr(p, f"{side}Forearm", lerp(0, -18.0, k), 0, 0)
            setr(p, f"{side}Hand", lerp(0, -20.0, k), 0, 0)
        self.fingers_open(p, k)
        setr(p, "rightLeg", lerp(0, -28.0, k), 0, 2.0)
        setr(p, "rightShin", lerp(0, 22.0, k), 0, 0)
        flat_foot(p, "right")
        setr(p, "leftLeg", lerp(0, 16.0, k), 0, -2.0)
        setr(p, "leftShin", lerp(0, 10.0, k), 0, 0)
        flat_foot(p, "left", toe=12.0 * k)
        self.tail(p, 0.0, 0.0, lift=30.0 * k)
        meta(p, z=lerp(1.0 * a, -9.0, k))
        return p

    def jumpscare1_post(self, p, t):
        shake = (1.0 if 0.2 <= t <= 1.1 else 0.0) * (1 - 0.5 * clamp01((t - 0.8) / 0.3))
        f = flip(t, 12)
        add_rot(p, "head", 0, 7.0 * f * shake, 5.0 * f * shake * (1.6 if self.w else 1.0))
        add_rot(p, "body", 0, 0, 1.5 * f * shake)
        add_rot(p, "jaw", -8.0 * (flip(t, 6) > 0) * shake, 0, 0)
        for side in ("right", "left"):
            add_rot(p, f"{side}Arm", 3.0 * f * shake, 0, 0)

    # ---- jumpscare 2: powered-down slump, snaps awake with arms flung wide -----------------
    def jumpscare2(self, t):
        p = {}
        up = ease((t - 0.3) / 0.08)
        for side in ("right", "left"):
            s = S[side]
            setr(p, f"{side}Leg", lerp(-14.0, -6.0, up), s * 4.0, s * 4.0)
            setr(p, f"{side}Shin", lerp(24.0, 12.0, up), 0, 0)
            flat_foot(p, side)
            setr(p, f"{side}Arm", lerp(12.0, -45.0, up), 0, s * lerp(-4.0, 90.0, up))
            setr(p, f"{side}Forearm", lerp(-4.0, -30.0, up), 0, 0)
            setr(p, f"{side}Hand", 0, 0, s * lerp(0, -20.0, up))
        self.fingers_open(p, up)
        setr(p, "body", lerp(10.0, 6.0, up), 0, 0)
        setr(p, "torso", lerp(14.0, 0.0, up), 0, 0)
        setr(p, "head", lerp(38.0, -20.0, up), lerp(14.0, 0.0, up), lerp(18.0, 0.0, up))
        setr(p, "jaw", lerp(6.0, self.i["jaw_max"] * 1.1, up), 0, 0)
        self.tail(p, 0.0, 0.0, lift=lerp(-10.0, 25.0, up))
        meta(p, z=lerp(0.0, -6.0, up))
        return p

    def jumpscare2_post(self, p, t):
        on = 1.0 if 0.4 <= t <= 1.35 else 0.0
        f = flip(t, 4)
        add_rot(p, "head", 0, 12.0 * f * on, (10.0 if self.w else 4.0) * f * on)
        add_rot(p, "jaw", -12.0 * (flip(t, 8) > 0) * on, 0, 0)
        for side in ("right", "left"):
            add_rot(p, f"{side}Arm", 0, 0, S[side] * 4.0 * f * on)

    # ---- schedules --------------------------------------------------------------------------
    def schedule(self, name, L):
        """Servo timing per bone group (anything unlisted moves continuously)."""
        if name == "idle":
            return {"head": stepper(0.75, 0.16, 0.05), "torso": stepper(1.5, 0.35), "armR": stepper(1.0, 0.2, 0.4),
                    "armL": stepper(1.0, 0.2, 0.9), "tail": stepper(0.5, 0.15), "ears": stepper(0.75, 0.1, 0.3)}
        if name == "walk":
            return {"armR": stepper(L / 2, 0.2, L / 8), "armL": stepper(L / 2, 0.2, L / 8),
                    "head": stepper(L / 4, 0.08, 0.05), "tail": stepper(L / 4, 0.1)}
        if name == "run":
            return {"armR": stepper(0.2, 0.06), "armL": stepper(0.2, 0.06, 0.1), "head": stepper(0.2, 0.05, 0.05)}
        if name.startswith("jumpscare"):
            return {}
        return {"head": stepper(0.5, 0.16), "torso": stepper(0.5, 0.2), "armR": stepper(0.5, 0.2, 0.25),
                "armL": stepper(0.5, 0.2, 0.25), "tail": stepper(0.5, 0.15)}

    def build(self, model_id):
        prefix = f"animation.{model_id}."
        for name in ("idle", "walk", "run", "pose1", "pose2", "performance1", "performance2", "jumpscare1", "jumpscare2"):
            L = self.walk_len() if name == "walk" else self.LENGTHS[name]
            loop = "once" if name.startswith("jumpscare") else "loop"
            n_base = int(round(L * (12 if name in self.IK_CLIPS else 24)))
            mech = Mechanical(getattr(self, name), L, n_base, loop == "loop", self.schedule(name, L),
                              post=getattr(self, name + "_post", None))
            make_linear_clip(prefix + name, L, mech, loop=loop)
