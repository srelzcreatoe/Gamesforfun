"""Client animations + animation controllers for every form.

Movement is written in Molang so it stays smooth at any frame rate: walking
is driven by distance moved (feet never skate), idling by life time, and the
atomic-breath head pitch by the synced `sg:aim` property.

The 4th form moves the way it does on film: an almost motionless trunk that
glides forward on heavy, sliding steps, arms frozen in front of the chest,
only the long tail drifting behind.  Its breath sequence bows the head to
pour smoke and fire downward, then the lower jaw splits and the head sweeps
the beam upward.  The 2nd form lurches and waddles with a lolling head; the
3rd staggers upright.

A tiny Molang evaluator lets the build compute exact effect positions
(mouth, plates, tail tip) for any pose, so the script's beams leave the model
exactly where the animation puts the mouth.
"""
import math
import re

AIM = "q.property('sg:aim')"
TAILSW = "q.property('sg:tail')"     # sideways swing of the raised tail while it fires (degrees, set by the script)
FINS = "q.property('sg:fins')"       # how many dorsal fins have risen (Minus One / Zero), tail tip first
LT = "q.life_time"


def f(v):
    if isinstance(v, (int, float)):
        return round(v, 3)
    return v


def ch(rx=0, ry=0, rz=0):
    return [f(rx), f(ry), f(rz)]


def kf(frames):
    """frames: {time: [x,y,z]} -> Bedrock keyframes."""
    return {"%g" % t: [f(c) for c in v] for t, v in sorted(frames.items())}


def S(speed, phase=0, amp=1.0, base=0.0, var=LT):
    """base + sin(var*speed - phase) * amp as a Molang string."""
    core = "math.sin(%s*%g%s)*%g" % (var, speed, ("-%g" % phase) if phase > 0 else ("+%g" % -phase) if phase < 0 else "", amp)
    return core if not base else "%g+%s" % (base, core)


# --------------------------------------------------------------- evaluator
def mol_eval(expr, env):
    if isinstance(expr, (int, float)):
        return float(expr)
    e = expr
    e = e.replace("q.property('sg:aim')", "AIM").replace("q.property('sg:tail')", "TAILSW").replace("q.property('sg:fins')", "FINS")
    e = re.sub(r"math\.(sin|cos)\(", lambda m: "D" + m.group(1) + "(", e)
    e = e.replace("math.abs(", "abs(").replace("math.max(", "max(").replace("math.min(", "min(")
    e = e.replace("math.clamp(", "clamp(")
    e = e.replace("q.life_time", "LT").replace("q.anim_time", "AT")
    e = e.replace("q.modified_distance_moved", "DM").replace("q.modified_move_speed", "MS")
    e = e.replace("q.target_x_rotation", "TX").replace("q.target_y_rotation", "TY")
    g = dict(Dsin=lambda d: math.sin(math.radians(d)), Dcos=lambda d: math.cos(math.radians(d)),
             abs=abs, max=max, min=min, clamp=lambda v, a, b: max(a, min(b, v)))
    g.update(env)
    return float(eval(e, {"__builtins__": {}}, g))


def _chan(chans, key, t, env):
    r = chans.get(key)
    if r is None:
        return None
    if isinstance(r, dict):  # keyframes: linear interpolation
        times = sorted(float(k) for k in r)
        lo = max([tt for tt in times if tt <= t + 1e-6] or [times[0]])
        hi = min([tt for tt in times if tt >= t - 1e-6] or [times[-1]])
        a = [mol_eval(c, env) for c in r["%g" % lo]]
        b = [mol_eval(c, env) for c in r["%g" % hi]]
        k = 0.0 if hi == lo else (t - lo) / (hi - lo)
        return tuple(x + (y - x) * k for x, y in zip(a, b))
    return tuple(mol_eval(c, env) for c in r)


def pose_of(anim, t=0.0, env=None, key="rotation"):
    """Evaluate an animation (our own dict format) into {bone: (x, y, z)}."""
    env = dict(dict(AIM=0, TAILSW=0, FINS=0, LT=t, AT=t, DM=0, MS=0, TX=0, TY=0), **(env or {}))
    out = {}
    for bone, chans in anim["bones"].items():
        v = _chan(chans, key, t, env)
        if v is not None:
            out[bone] = v
    return out


def add_pose(*poses):
    out = {}
    for p in poses:
        for b, v in p.items():
            o = out.get(b, (0, 0, 0))
            out[b] = tuple(a + c for a, c in zip(o, v))
    return out


# --------------------------------------------------------------- 4th / 3rd form
def aim_bones(extra_head=0.0, lean=2.0):
    """Head pitch for the breath.  Nearly all of the bow comes from the chest
    and the two neck joints, so the neck stretches forward and over like the
    film's hunched firing pose and the head barely tucks against it; that
    leaves the lower jaw room to drop without swinging into the throat."""
    return {
        "torso": {"rotation": ch("%g+%s*0.10" % (lean, AIM))},
        "chest": {"rotation": ch("%g+%s*0.15" % (lean, AIM))},
        "neck1": {"rotation": ch("%s*0.36" % AIM)},
        "neck2": {"rotation": ch("%s*0.31" % AIM)},
        "head": {"rotation": ch("%g+%s*0.08" % (extra_head, AIM))},
    }


IDLE_SWAY = (0.35, 0.115)     # sideways sway of the tail per segment (deg): base + per-segment growth
WALK_SWAY = (0.6, 0.13)


def big_set(prefix, tail_n, stride_deg=20.0, pos_k=1.0, stagger=0.0, rest_tail=None, roar_len=4.9):
    """Animation set for the upright forms. stagger > 0 adds the unsteady,
    top-heavy lurch of the 3rd form."""
    A = {}
    P = "(q.modified_distance_moved*%g)" % stride_deg
    tails = ["tail%d" % i for i in range(tail_n)]
    trem = "math.sin(%s*2100)*0.5" % LT
    th, cum = [], 0.0                      # direction of each tail segment in the rest pose (deg above horizontal)
    for r in (rest_tail or [0] * tail_n):
        cum += r
        th.append(cum)

    def lat(i, expr):
        """Sideways bend of tail segment i -> (yaw, roll).  The tail is modelled already curled up,
        so "sideways" is a yaw where it lies flat and a roll where it stands upright; a plain yaw
        on the raised part would only twist it on the spot."""
        c, sn = math.cos(math.radians(th[i])), math.sin(math.radians(th[i]))
        if isinstance(expr, (int, float)):
            return (expr * c, expr * sn)
        return tuple(("(%s)*%.3f" % (expr, k)) if abs(k) > 0.03 else 0 for k in (c, sn))

    # ---- idle: slow and heavy but always alive: the chest heaves, the head scans from side to
    #      side, the jaw works, the fingers flex, and the long tail never stops drifting
    b = {
        "body": {"rotation": ch(0, S(9, 0, 1.2), S(18, 0, 0.7))},
        "torso": {"rotation": ch(S(40, 20, 0.6))},
        "chest": {"rotation": ch(S(40, 0, 1.3)), "scale": ["1+math.sin(%s*40)*0.012" % LT, 1, "1+math.sin(%s*40)*0.016" % LT]},
        "neck1": {"rotation": ch(S(40, 40, 0.9), S(16, 0, 2.2), S(11, 0, 0.8))},
        "neck2": {"rotation": ch(S(40, 70, 0.9), S(16, 25, 2.8))},
        "head": {"rotation": ch(S(27, 0, 1.8), S(16, 50, 4.0), S(13, 0, 1.4))},
        "jaw_L": {"rotation": ch(S(40, 10, 2.2, 2.0))},
        "jaw_R": {"rotation": ch(S(40, 10, 2.2, 2.0))},
    }
    for sd, ph in (("L", 0), ("R", 70)):
        b["arm_" + sd] = {"rotation": ch(S(33, ph, 2.5), 0, S(21, ph, 1.5))}
        b["forearm_" + sd] = {"rotation": ch(S(41, ph + 40, 3.5))}
        b["hand_" + sd] = {"rotation": ch(S(58, ph, 6), S(37, ph, 3))}
    for i, t in enumerate(tails):
        flick = (", %s" % S(64, i * 30, 1.2)) if False else ""
        tipk = 1.3 if i >= tail_n - 6 else 0.0
        b[t] = {"rotation": ch("%s+%s" % (S(13, i * 14, 0.3 + 0.07 * i), S(47, i * 28, tipk)),
                               *lat(i, "%s+%s" % (S(20, i * 9, IDLE_SWAY[0] + IDLE_SWAY[1] * i), S(53, i * 31, tipk))))}
    if stagger:
        b["body"] = {"rotation": ch(0, S(12, 0, 2.0), S(50, 0, 1.2 * stagger))}
        b["head"] = {"rotation": ch(S(45, 80, 2.5), S(20, 30, 5.0), S(33, 0, 2.5))}
    A["idle"] = {"loop": True, "bones": b}

    # ---- walk: long, weighty strides; the hips roll, the shoulders counter, the tail swings
    sw, kn = (19, 20) if not stagger else (22, 22)
    lift_l = "math.max(0,-math.cos(%s))" % P
    lift_r = "math.max(0,math.cos(%s))" % P
    push_l = "math.max(0,math.sin(%s)-0.4)" % P
    push_r = "math.max(0,-math.sin(%s)-0.4)" % P
    b = {
        "thigh_L": {"rotation": ch("math.sin(%s)*%g-%s*6" % (P, sw, lift_l))},
        "thigh_R": {"rotation": ch("-math.sin(%s)*%g-%s*6" % (P, sw, lift_r))},
        "shin_L": {"rotation": ch("%s*%g" % (lift_l, kn))},
        "shin_R": {"rotation": ch("%s*%g" % (lift_r, kn))},
        "foot_L": {"rotation": ch("-math.sin(%s)*%g-%s*%g+%s*22" % (P, sw, lift_l, kn * 0.8, push_l))},
        "foot_R": {"rotation": ch("math.sin(%s)*%g-%s*%g+%s*22" % (P, sw, lift_r, kn * 0.8, push_r))},
        "toes_L": {"rotation": ch("-%s*22+%s*10" % (push_l, lift_l))},
        "toes_R": {"rotation": ch("-%s*22+%s*10" % (push_r, lift_r))},
        "body": {"rotation": ch("math.cos(%s*2)*%g" % (P, 0.8), "math.sin(%s)*%g" % (P, 3.2 + 4 * stagger), "math.sin(%s)*%g" % (P, 2.2 + 3.2 * stagger)),
                 "position": [0, "-(1-math.cos(%s*2))*%g" % (P, 3.2 * pos_k * (1 + stagger)), 0]},
        "torso": {"rotation": ch(0, "-math.sin(%s)*1.2" % P, "-math.sin(%s)*0.8" % P)},
        "chest": {"rotation": ch("math.cos(%s*2-40)*1.0" % P, "-math.sin(%s)*%g" % (P, 2.4 + 2 * stagger), "-math.sin(%s)*1.0" % P)},
        "neck1": {"rotation": ch("math.cos(%s*2-70)*1.2" % P, 0, "-math.sin(%s)*%g" % (P, 0.6 + 1.6 * stagger))},
        "neck2": {"rotation": ch("math.cos(%s*2-100)*1.2" % P, "math.sin(%s)*1.0" % P, 0)},
        "head": {"rotation": ch("math.cos(%s*2-130)*%g" % (P, 1.6 + 3 * stagger), "math.sin(%s-40)*%g" % (P, 1.4 + 3 * stagger))},
        "arm_L": {"rotation": ch("math.sin(%s)*%g" % (P, 5 + 6 * stagger))},
        "arm_R": {"rotation": ch("-math.sin(%s)*%g" % (P, 5 + 6 * stagger))},
        "forearm_L": {"rotation": ch("math.cos(%s*2)*3" % P)},
        "forearm_R": {"rotation": ch("math.cos(%s*2-60)*3" % P)},
    }
    for i, t in enumerate(tails):
        b[t] = {"rotation": ch("math.cos(%s*2-%d)*%.2f" % (P, i * 16, 0.2 + 0.04 * i),
                               *lat(i, "math.sin(%s-%d)*%.2f" % (P, 30 + i * 9, (WALK_SWAY[0] + WALK_SWAY[1] * i) * (1 + 0.5 * stagger))))}
    A["walk"] = {"loop": True, "bones": b}

    # ---- look at target (slow, mostly with the upper neck)
    A["look"] = {"loop": True, "bones": {
        "neck2": {"rotation": ch("math.clamp(q.target_x_rotation,-25,25)*0.2", "math.clamp(q.target_y_rotation,-35,35)*0.3")},
        "head": {"rotation": ch("math.clamp(q.target_x_rotation,-25,25)*0.3", "math.clamp(q.target_y_rotation,-35,35)*0.4")},
    }}

    def tail_up(k0, k1, wob=0.0):
        return {t: {"rotation": ch("%.2f%s" % (k0 + k1 * i, ("+" + S(800, i * 25, wob)) if wob else ""),
                                   *lat(i, S(30, i * 9, 0.15 + 0.04 * i)))} for i, t in enumerate(tails)}

    # The atomic breath, pose by pose (the script moves between them on the sound's timeline):
    #   charge  plates light, the head bows, the mouth begins to open
    #   spew    jaw unhinged wide, head pitched steeply down: smoke, then a flood of fire
    #   focus   the stream tightens and turns magenta as the lower jaw starts to part
    #   breath  the lower jaw fully split in two, the beam sweeping with the head
    def breath_pose(jaw, split, tail_k, shake=1.0):
        b = aim_bones(2)
        b["body"] = {"rotation": ch("math.sin(%s*2100)*%.2f" % (LT, 0.5 * shake), 0, "math.sin(%s*1700)*%.2f" % (LT, 0.3 * shake))}
        b["jaw_L"] = {"rotation": ch(S(1300, 0, 1.5, jaw), -split, -split * 0.8)}
        b["jaw_R"] = {"rotation": ch(S(1300, 0, 1.5, jaw), split, split * 0.8)}
        for sd in ("L", "R"):  # arms tense, fingers clawing upward
            b["arm_" + sd] = {"rotation": ch(S(1900, 0, 0.8, -6 * shake))}
            b["hand_" + sd] = {"rotation": ch(-10 * shake)}
        b.update(tail_up(tail_k[0], tail_k[1], 0.3 * shake))
        return b
    A["charge"] = {"loop": True, "bones": breath_pose(16, 0, (0.1, 0.01), 0.5)}
    A["spew"] = {"loop": True, "bones": breath_pose(44, 0, (0.2, 0.02))}
    A["focus"] = {"loop": True, "bones": breath_pose(46, 14, (0.2, 0.03), 1.3)}
    bb = breath_pose(48, 30, (0.2, 0.03), 1.2)
    def swing(i):
        """Sideways lean of the tail while it fires, steered by the script (so its ray leaves the
        tip exactly): spread over the first two thirds of the tail."""
        return lat(i, "%s*%.4f" % (TAILSW, 1.8 / 13)) if 1 <= i <= 13 else (0, 0)
    for i, t in enumerate(tails):   # the tail swings up and over the back to bring its tip to bear
        v = 0.4 if i < 5 else 2.6
        bb[t] = {"rotation": ch("%g+%s" % (v, S(700, i * 25, 0.3)), *swing(i))}
    A["breath"] = {"loop": True, "bones": bb}

    # ---- dorsal rays: head bowed while the back fires into the sky
    b = {
        "body": {"rotation": ch(trem)},
        "torso": {"rotation": ch(6)}, "chest": {"rotation": ch(5)},
        "neck1": {"rotation": ch(14)}, "neck2": {"rotation": ch(18)}, "head": {"rotation": ch(24)},
        "jaw_L": {"rotation": ch(12)}, "jaw_R": {"rotation": ch(12)},
    }
    b.update(tail_up(0.3, 0.04, 0.5))
    A["dorsal"] = {"loop": True, "bones": b}

    # ---- tail beam: the tail rears up and over, tip aimed at the sky
    b = {
        "neck2": {"rotation": ch(-4, S(40, 0, 6))},
        "head": {"rotation": ch(-6, S(40, 20, 8))},
        "jaw_L": {"rotation": ch(14)}, "jaw_R": {"rotation": ch(14)},
    }
    for i, t in enumerate(tails):
        v = 0 if i < 6 else 2.2     # the raised tail curls further over the back to take aim
        b[t] = {"rotation": ch("%g+%s" % (v, S(800, i * 30, 0.3)), *swing(i))}
    A["tail"] = {"loop": True, "bones": b}

    # ---- roar: head thrown up and back; timed to the roar (screech to ~70%, then the falling tail)
    R = roar_len
    t_up, t_hold, t_end = 0.45, R * 0.7, R + 0.1

    def up(v):
        return kf({0: [0, 0, 0], t_up: v, t_hold: v, t_end: [0, 0, 0]})
    b = {
        "chest": {"rotation": up([-4, 0, 0])},
        "neck1": {"rotation": up([-6, 0, 0])},
        "neck2": {"rotation": up([-10, 0, 0])},
        "head": {"rotation": kf({0: [0, 0, 0], t_up: [-20, 0, 0], t_hold * 0.5: ["-24+" + S(900, 0, 1.2), 0, 0], t_hold: [-22, 0, 0], t_end: [0, 0, 0]})},
        "jaw_L": {"rotation": kf({0: [0, 0, 0], t_up * 0.8: [34, 0, 0], t_hold: [32, 0, 0], R * 0.9: [14, 0, 0], t_end: [0, 0, 0]})},
        "jaw_R": {"rotation": kf({0: [0, 0, 0], t_up * 0.8: [34, 0, 0], t_hold: [32, 0, 0], R * 0.9: [14, 0, 0], t_end: [0, 0, 0]})},
    }
    b["body"] = {"rotation": kf({0: [0, 0, 0], t_up: [-3, 0, 0], t_hold: [-3, 0, 0], t_end: [0, 0, 0]})}
    b["torso"] = {"rotation": up([-3, 0, 0])}
    for sd, sg in (("L", 1), ("R", -1)):
        b["arm_" + sd] = {"rotation": kf({0: [0, 0, 0], t_up: [-14, 0, sg * 8], t_hold: ["-14+" + S(1100, 0, 1.5), 0, sg * 8], t_end: [0, 0, 0]})}
        b["hand_" + sd] = {"rotation": kf({0: [0, 0, 0], t_up: [-16, 0, 0], t_hold: [-16, 0, 0], t_end: [0, 0, 0]})}
    for i, t in enumerate(tails):
        lash = lat(i, S(90, i * 14, 0.3 + 0.12 * i))      # the tail lashes from side to side behind the roar
        b[t] = {"rotation": kf({0: [0, 0, 0], t_up: [0.8, *lash], t_hold: [0.8, *lash], t_end: [0, 0, 0]})}
    A["roar"] = {"loop": False, "length": round(t_end, 2), "bones": b}

    # ---- dormant: frozen where it stood, upright and silent (no motion at all)
    b = {"neck2": {"rotation": ch(6)}, "head": {"rotation": ch(8)}, "jaw_L": {"rotation": ch(-5)}, "jaw_R": {"rotation": ch(-5)}}
    for i, t in enumerate(tails):
        b[t] = {"rotation": ch(-0.5 if i >= 11 else 0)}
    A["dormant"] = {"loop": True, "bones": b}

    # ---- frozen by the coagulant: a statue caught mid-roar, tail raised
    b = {"neck1": {"rotation": ch(-3)}, "neck2": {"rotation": ch(-6)}, "head": {"rotation": ch(-12)},
         "jaw_L": {"rotation": ch(22)}, "jaw_R": {"rotation": ch(22)}}
    for i, t in enumerate(tails):
        b[t] = {"rotation": ch(1.2 if i >= 8 else 0.3)}
    A["frozen"] = {"loop": True, "bones": b}

    # ---- waking (dormant -> roar -> normal)
    b = {
        "neck2": {"rotation": kf({0: [6, 0, 0], 1.0: [-9, 0, 0], 2.4: [-10, 0, 0], 3.0: [0, 0, 0]})},
        "head": {"rotation": kf({0: [8, 0, 0], 1.0: [-20, 0, 0], 2.4: [-24, 0, 0], 3.0: [0, 0, 0]})},
        "jaw_L": {"rotation": kf({0: [-5, 0, 0], 0.9: [32, 0, 0], 2.5: [32, 0, 0], 3.0: [0, 0, 0]})},
        "jaw_R": {"rotation": kf({0: [-5, 0, 0], 0.9: [32, 0, 0], 2.5: [32, 0, 0], 3.0: [0, 0, 0]})},
    }
    A["waking"] = {"loop": False, "length": 3.0, "bones": b}

    # ---- dying: a last roar, the knees buckle, and it crashes down onto its chest
    D = 200 * pos_k  # how far the hips sink as the legs fold (model pixels)
    drop = kf({0: [0, 0, 0], 1.2: [0, 0, 0], 2.6: [0, -D * 0.45, 0], 3.3: [0, -D, 0], 3.5: [0, -D * 0.95, 0], 3.7: [0, -D, 0]})
    b = {
        "root": {"rotation": kf({0: [0, 0, 0], 2.6: [0, 0, 0], 3.3: [0, 0, 4]})},
        "body": {"rotation": kf({0: [0, 0, 0], 1.2: [-4, 0, 0], 2.6: [22, 0, 2], 3.3: [62, 0, 3], 3.5: [59, 0, 3], 3.7: [62, 0, 3]}), "position": drop},
        "torso": {"rotation": kf({0: [0, 0, 0], 3.3: [12, 0, 0]})},
        "chest": {"rotation": kf({0: [0, 0, 0], 3.3: [10, 0, 0]})},
        "neck1": {"rotation": kf({0: [0, 0, 0], 0.7: [-6, 0, 0], 3.3: [4, 0, 0]})},
        "neck2": {"rotation": kf({0: [0, 0, 0], 0.7: [-12, 0, 0], 3.3: [-4, 0, 6]})},
        "head": {"rotation": kf({0: [0, 0, 0], 0.7: [-24, 0, 0], 2.0: [-16, 0, 0], 3.3: [-10, 0, 10]})},
        "jaw_L": {"rotation": kf({0: [0, 0, 0], 0.5: [36, -8, -6], 2.5: [36, -8, -6], 3.5: [16, 0, 0]})},
        "jaw_R": {"rotation": kf({0: [0, 0, 0], 0.5: [36, 8, 6], 2.5: [36, 8, 6], 3.5: [16, 0, 0]})},
        "arm_L": {"rotation": kf({0: [0, 0, 0], 3.3: [-40, 0, 0]})},
        "arm_R": {"rotation": kf({0: [0, 0, 0], 3.3: [-40, 0, 0]})},
    }
    for sd in ("L", "R"):
        b["thigh_" + sd] = {"rotation": kf({0: [0, 0, 0], 1.2: [0, 0, 0], 2.6: [-32, 0, 0], 3.3: [-66, 0, 0]}), "position": drop}
        b["shin_" + sd] = {"rotation": kf({0: [0, 0, 0], 1.2: [0, 0, 0], 2.6: [56, 0, 0], 3.3: [112, 0, 0]})}
        b["foot_" + sd] = {"rotation": kf({0: [0, 0, 0], 1.2: [0, 0, 0], 2.6: [-24, 0, 0], 3.3: [-46, 0, 0]})}
    rt = rest_tail or [0] * tail_n
    for i, t in enumerate(tails):
        v = -rt[i] - (60 if i == 0 else 0)      # uncurl completely, then drop it to the ground
        b[t] = {"rotation": kf({0: [0, 0, 0], 1.2: [1 if i < 6 else 0, 0, 0], 2.6: [v * 0.4, 0, 0], 3.3: [v, 0, 0]})}
    A["dying"] = {"loop": "hold_on_last_frame", "length": 4.0, "bones": b}

    # ---- evolving (3rd -> 4th): convulsing as it straightens up and swells
    sh = "math.sin(%s*1500)*1.6" % LT
    b = {
        "root": {"scale": kf({0: [1, 1, 1], 6.0: [1.32, 1.32, 1.32]})},
        "body": {"rotation": ch(sh, 0, "math.sin(%s*1100)*2" % LT)},
        "torso": {"rotation": kf({0: [0, 0, 0], 6.0: [-20, 0, 0]})},
        "neck1": {"rotation": kf({0: [0, 0, 0], 6.0: [6, 0, 0]})},
        "neck2": {"rotation": ch(S(900, 0, 4, -8))},
        "head": {"rotation": ch(S(700, 0, 6, -14), S(400, 0, 8))},
        "jaw_L": {"rotation": ch(S(1800, 0, 4, 30))},
        "jaw_R": {"rotation": ch(S(1800, 0, 4, 30))},
        "arm_L": {"rotation": ch(S(1600, 0, 10, -10))},
        "arm_R": {"rotation": ch(S(1700, 0, 10, -10))},
    }
    for i, t in enumerate(tails):
        b[t] = {"rotation": ch(S(700, i * 30, 1.0), *lat(i, S(300, i * 25, 0.8 + 0.2 * i)))}
    A["evolving"] = {"loop": "hold_on_last_frame", "length": 6.0, "bones": b}
    # ---- leap: sink onto the haunches, drive off both legs, then hang in the air with the legs
    #      tucked and the tail streaming (held until the script lands him)
    def squat(depth, lean=0.0):
        """Leg and hip pose for a crouch `depth` (0..1) deep; feet stay planted."""
        # the drop is what the folded leg lifts the sole by (measured on the model), so the feet stay on the ground
        return {"drop": [0, -122 * pos_k * depth ** 1.25, 0], "thigh": -44 * depth, "shin": 78 * depth, "foot": -33 * depth, "lean": lean}

    def legs(b, frames):
        """frames: {time: squat(...)} -> keyframes on body, thighs, shins and feet."""
        b.setdefault("body", {})
        b["body"]["position"] = kf({t: q["drop"] for t, q in frames.items()})
        b["body"]["rotation"] = kf({t: [q["lean"], 0, 0] for t, q in frames.items()})
        for sd in ("L", "R"):
            b["thigh_" + sd] = {"rotation": kf({t: [q["thigh"], 0, 0] for t, q in frames.items()}),
                                "position": kf({t: q["drop"] for t, q in frames.items()})}
            b["shin_" + sd] = {"rotation": kf({t: [q["shin"], 0, 0] for t, q in frames.items()})}
            b["foot_" + sd] = {"rotation": kf({t: [q["foot"], 0, 0] for t, q in frames.items()})}
    tuck = {"drop": [0, 0, 0], "thigh": -34, "shin": 60, "foot": 16, "lean": 8}
    b = {
        "torso": {"rotation": kf({0: [0, 0, 0], 0.3: [8, 0, 0], 0.45: [-4, 0, 0], 0.8: [4, 0, 0]})},
        "neck2": {"rotation": kf({0: [0, 0, 0], 0.3: [-8, 0, 0], 0.8: [-4, 0, 0]})},
        "head": {"rotation": kf({0: [0, 0, 0], 0.3: [-10, 0, 0], 0.8: [-6, 0, 0]})},
        "jaw_L": {"rotation": kf({0: [0, 0, 0], 0.4: [16, 0, 0], 0.8: [20, 0, 0]})},
        "jaw_R": {"rotation": kf({0: [0, 0, 0], 0.4: [16, 0, 0], 0.8: [20, 0, 0]})},
    }
    legs(b, {0: squat(0), 0.3: squat(0.75, 12), 0.42: squat(0.0, -6), 0.8: tuck})
    for sd, sg in (("L", 1), ("R", -1)):
        b["arm_" + sd] = {"rotation": kf({0: [0, 0, 0], 0.3: [18, 0, 0], 0.45: [-30, 0, sg * 16], 0.8: [-22, 0, sg * 22]})}
        b["hand_" + sd] = {"rotation": kf({0: [0, 0, 0], 0.45: [-24, 0, 0], 0.8: [-18, 0, 0]})}
    for i, t in enumerate(tails):
        b[t] = {"rotation": kf({0: [0, 0, 0], 0.3: [0.9, 0, 0], 0.45: [-0.6, 0, 0], 0.8: ["-1.1+" + S(500, i * 30, 0.25), 0, 0]})}
    A["leap"] = {"loop": "hold_on_last_frame", "length": 0.8, "bones": b}

    # ---- land: both feet drive into the ground, the whole body folds over the impact, then rises
    b = {
        "torso": {"rotation": kf({0: [4, 0, 0], 0.12: [14, 0, 0], 0.9: [0, 0, 0]})},
        "chest": {"rotation": kf({0: [0, 0, 0], 0.12: [8, 0, 0], 0.9: [0, 0, 0]})},
        "neck2": {"rotation": kf({0: [-4, 0, 0], 0.12: [-12, 0, 0], 0.9: [0, 0, 0]})},
        "head": {"rotation": kf({0: [-6, 0, 0], 0.12: [-14, 0, 0], 0.9: [0, 0, 0]})},
        "jaw_L": {"rotation": kf({0: [20, 0, 0], 0.15: [6, 0, 0], 0.9: [0, 0, 0]})},
        "jaw_R": {"rotation": kf({0: [20, 0, 0], 0.15: [6, 0, 0], 0.9: [0, 0, 0]})},
    }
    legs(b, {0: tuck, 0.1: squat(0.95, 16), 0.3: squat(0.8, 12), 0.9: squat(0)})
    for sd, sg in (("L", 1), ("R", -1)):
        b["arm_" + sd] = {"rotation": kf({0: [-22, 0, sg * 22], 0.12: [30, 0, sg * 6], 0.9: [0, 0, 0]})}
        b["hand_" + sd] = {"rotation": kf({0: [-18, 0, 0], 0.12: [24, 0, 0], 0.9: [0, 0, 0]})}
    for i, t in enumerate(tails):
        b[t] = {"rotation": kf({0: [-1.1, 0, 0], 0.14: [-2.0, 0, 0], 0.4: [0.8, 0, 0], 0.9: [0, 0, 0]})}
    A["land"] = {"loop": False, "length": 0.9, "bones": b}

    # ---- bite: the head and chest draw back, then the whole upper body is thrown forward and
    #      down with the jaws wide, snapping shut as the claws rake through (hit at 0.55 s)
    hit = 0.55

    def strike(back, fwd, settle=None):
        settle = [v * 0.7 for v in fwd] if settle is None else settle
        return kf({0: [0, 0, 0], 0.34: back, hit: fwd, 0.78: settle, 1.2: [0, 0, 0]})
    b = {
        "body": {"rotation": strike([-4, 0, 0], [9, 0, 0]), "position": kf({0: [0, 0, 0], 0.34: [0, 0, 14 * pos_k], hit: [0, -10 * pos_k, -46 * pos_k], 1.2: [0, 0, 0]})},
        "torso": {"rotation": strike([-6, 0, 0], [13, 0, 0])},
        "chest": {"rotation": strike([-10, 0, 0], [20, 0, 0])},
        "neck1": {"rotation": strike([-10, 0, 0], [16, 0, 0])},
        "neck2": {"rotation": strike([-12, 0, 0], [12, 0, 0])},
        "head": {"rotation": kf({0: [0, 0, 0], 0.34: [-24, 0, 0], 0.48: [2, 0, 0], hit: [8, 0, 0], 0.78: [4, 0, 0], 1.2: [0, 0, 0]})},
        "jaw_L": {"rotation": kf({0: [0, 0, 0], 0.28: [42, -5, -4], 0.5: [42, -5, -4], hit + 0.02: [-3, 0, 0], 0.8: [8, 0, 0], 1.2: [0, 0, 0]})},
        "jaw_R": {"rotation": kf({0: [0, 0, 0], 0.28: [42, 5, 4], 0.5: [42, 5, 4], hit + 0.02: [-3, 0, 0], 0.8: [8, 0, 0], 1.2: [0, 0, 0]})},
    }
    for sd, sg in (("L", 1), ("R", -1)):
        b["arm_" + sd] = {"rotation": strike([-34, 0, sg * 14], [40, 0, -sg * 6])}
        b["forearm_" + sd] = {"rotation": strike([-22, 0, 0], [26, 0, 0])}
        b["hand_" + sd] = {"rotation": strike([-34, 0, 0], [32, 0, 0])}
    for i, t in enumerate(tails):
        b[t] = {"rotation": strike([-0.4, 0, 0], [0.7, 0, 0], [0.3, 0, 0])}
    A["bite"] = {"loop": False, "length": 1.2, "bones": b}

    # ---- tail sweep: the tail is let down from over the back, drawn out to one side, and the
    #      hips throw it round through everything behind and beside him (connects 0.6-0.9 s)
    rt = rest_tail or [0] * tail_n
    b = {
        "body": {"rotation": kf({0: [0, 0, 0], 0.5: [3, -28, 0], 0.82: [4, 46, 0], 1.15: [2, 28, 0], 1.7: [0, 0, 0]})},
        "torso": {"rotation": kf({0: [0, 0, 0], 0.5: [0, 10, 0], 0.82: [0, -16, 0], 1.7: [0, 0, 0]})},
        "chest": {"rotation": kf({0: [0, 0, 0], 0.5: [0, 8, 0], 0.82: [0, -14, 0], 1.7: [0, 0, 0]})},
        "head": {"rotation": kf({0: [0, 0, 0], 0.5: [-4, 10, 0], 0.82: [-6, -16, 0], 1.7: [0, 0, 0]})},
        "jaw_L": {"rotation": kf({0: [0, 0, 0], 0.6: [18, 0, 0], 1.0: [18, 0, 0], 1.7: [0, 0, 0]})},
        "jaw_R": {"rotation": kf({0: [0, 0, 0], 0.6: [18, 0, 0], 1.0: [18, 0, 0], 1.7: [0, 0, 0]})},
    }
    for sd, sg in (("L", 1), ("R", -1)):
        b["arm_" + sd] = {"rotation": kf({0: [0, 0, 0], 0.5: [-10, 0, sg * 10], 0.82: [-16, 0, sg * 18], 1.7: [0, 0, 0]})}
    for i, t in enumerate(tails):
        down = -rt[i] - (9 if i == 0 else 0)                 # uncurl: lay the tail out along the ground behind him
        w = 3.2 if i < 12 else 1.5
        a0, a1, a2 = lat(i, -w), lat(i, w * 1.6), lat(i, w * 0.6)
        b[t] = {"rotation": kf({0: [0, 0, 0], 0.45: [down, a0[0], a0[1]], 0.82: [down, a1[0], a1[1]], 1.15: [down * 0.8, a2[0], a2[1]], 1.7: [0, 0, 0]})}
    A["sweep"] = {"loop": False, "length": 1.7, "bones": b}
    return {"%s.%s" % (prefix, k): v for k, v in A.items()}


# --------------------------------------------------------------- Godzilla Minus One / Minus Zero
def minus_set(prefix, tail_n, rest_tail, fins, roar_len=3.6, pos_k=0.87, stride_deg=30.0):
    """The upright set, re-fitted: one lower jaw, and the heat ray in three poses the script
    steps through.  fins: [(bone, unit direction, travel in blocks)] in the order they rise."""
    drop = ("spew", "dorsal", "tail", "dormant", "frozen", "waking", "evolving", "charge", "focus", "breath", "leap", "bite", "sweep")
    A = {}
    for name, a in big_set("x", tail_n, stride_deg, pos_k, rest_tail=rest_tail, roar_len=roar_len).items():
        key = name.split(".", 1)[1]
        if key in drop:
            continue
        bones = dict(a["bones"])
        jl = bones.pop("jaw_L", None)
        bones.pop("jaw_R", None)
        if jl is not None:          # the two halves of Shin's jaw become one, without the split
            r = jl["rotation"]
            bones["jaw"] = {"rotation": {t: [v[0], 0, 0] for t, v in r.items()} if isinstance(r, dict) else [r[0], 0, 0]}
        A[key] = dict(a, bones=bones)
    tails = ["tail%d" % i for i in range(tail_n)]
    trem = "math.sin(%s*2100)*0.5" % LT

    def stiff(lift, wob):
        """the tail lifted off the ground and held rigid, shivering"""
        return {t: {"rotation": ch("%g+%s" % (lift if i >= 1 else lift * 3, S(900, i * 40, wob)))} for i, t in enumerate(tails)}

    # ---- charge: braced, hunched forward and growling while the fins thrust out of his back
    b = {
        "body": {"rotation": ch(trem)},
        "torso": {"rotation": ch(6)}, "chest": {"rotation": ch(8)},
        "neck1": {"rotation": ch(10)}, "neck2": {"rotation": ch(8)}, "head": {"rotation": ch("6+" + S(1300, 0, 0.8))},
        "jaw": {"rotation": ch(S(1700, 0, 2.0, 10.0))},
    }
    for sd, sg in (("L", 1), ("R", -1)):
        b["arm_" + sd] = {"rotation": ch(S(1900, 0, 0.8, 10), 0, sg * 8)}
        b["forearm_" + sd] = {"rotation": ch(-22)}
        b["hand_" + sd] = {"rotation": ch(-20)}
    b.update(stiff(0.9, 0.3))
    A["charge"] = {"loop": True, "bones": b}

    # ---- inhale: the head and chest rear up and back, the jaws opening, the ribs spreading
    T = 1.3
    b = {
        "body": {"rotation": kf({0: [0, 0, 0], T: [-4, 0, 0]})},
        "torso": {"rotation": kf({0: [6, 0, 0], T: [-6, 0, 0]})},
        "chest": {"rotation": kf({0: [8, 0, 0], T: [-10, 0, 0]}), "scale": kf({0: [1, 1, 1], T: [1.07, 1.04, 1.09]})},
        "neck1": {"rotation": kf({0: [10, 0, 0], T: [-12, 0, 0]})},
        "neck2": {"rotation": kf({0: [8, 0, 0], T: [-14, 0, 0]})},
        "head": {"rotation": kf({0: [6, 0, 0], T: [-16, 0, 0]})},
        "jaw": {"rotation": kf({0: [10, 0, 0], T * 0.7: [30, 0, 0], T: [36, 0, 0]})},
    }
    for sd, sg in (("L", 1), ("R", -1)):
        b["arm_" + sd] = {"rotation": kf({0: [10, 0, sg * 8], T: [-22, 0, sg * 22]})}
        b["forearm_" + sd] = {"rotation": kf({0: [-22, 0, 0], T: [-8, 0, 0]})}
        b["hand_" + sd] = {"rotation": kf({0: [-20, 0, 0], T: [-30, 0, 0]})}
    for i, t in enumerate(tails):
        b[t] = {"rotation": kf({0: [0.9 if i >= 1 else 2.7, 0, 0], T: [1.3 if i >= 1 else 3.9, 0, 0]})}
    A["focus"] = {"loop": "hold_on_last_frame", "length": T, "bones": b}

    # ---- fire: everything thrown forward behind the beam, the head held level along it
    b = {
        "body": {"rotation": ch(trem, 0, "math.sin(%s*1700)*0.4" % LT), "position": [0, 0, "6+math.sin(%s*2500)*1.5" % LT]},
        "torso": {"rotation": ch("8+%s*0.10" % AIM)},
        "chest": {"rotation": ch("10+%s*0.15" % AIM)},
        "neck1": {"rotation": ch("6+%s*0.32" % AIM)},
        "neck2": {"rotation": ch("2+%s*0.30" % AIM)},
        "head": {"rotation": ch("-24+%s*0.13" % AIM)},
        "jaw": {"rotation": ch(S(1300, 0, 1.5, 40.0))},
    }
    for sd, sg in (("L", 1), ("R", -1)):
        b["arm_" + sd] = {"rotation": ch(S(1900, 0, 0.8, 20), 0, -sg * 6)}
        b["forearm_" + sd] = {"rotation": ch(-30)}
        b["hand_" + sd] = {"rotation": ch(-24)}
    b.update(stiff(1.1, 0.6))
    A["breath"] = {"loop": True, "bones": b}

    # ================= hand to hand.  He does not fight like Shin Godzilla: he has real arms and
    # uses them, he takes things in his jaws and throws them, he turns his whole body to bring
    # the tail round, and he does not jump: he puts his head down and charges.
    th_, cum = [], 0.0
    for r in rest_tail:
        cum += r
        th_.append(cum)

    def lat(i, v):
        """sideways bend of tail segment i as (yaw, roll): the tail is modelled already curved"""
        return (v * math.cos(math.radians(th_[i])), v * math.sin(math.radians(th_[i])))

    # ---- claws: two raking blows, the right then the left, the whole trunk thrown behind each
    #      (they land at 0.4 s and 0.85 s)
    h1, h2 = 0.4, 0.85
    b = {
        "body": {"rotation": kf({0: [0, 0, 0], 0.2: [-3, 16, 0], h1: [8, -22, 0], 0.62: [2, -26, 0], h2: [10, 24, 0], 1.1: [5, 12, 0], 1.5: [0, 0, 0]}),
                 "position": kf({0: [0, 0, 0], h1: [0, -4 * pos_k, -18 * pos_k], h2: [0, -6 * pos_k, -34 * pos_k], 1.5: [0, 0, 0]})},
        "torso": {"rotation": kf({0: [0, 0, 0], 0.2: [-4, 4, 0], h1: [8, -6, 0], 0.62: [2, -6, 0], h2: [10, 8, 0], 1.5: [0, 0, 0]})},
        "chest": {"rotation": kf({0: [0, 0, 0], 0.2: [-8, 6, 0], h1: [16, -8, 0], 0.62: [4, -8, 0], h2: [18, 10, 0], 1.5: [0, 0, 0]})},
        "neck1": {"rotation": kf({0: [0, 0, 0], h1: [-4, 8, 0], h2: [-4, -8, 0], 1.5: [0, 0, 0]})},
        "head": {"rotation": kf({0: [0, 0, 0], 0.2: [-8, -6, 0], h1: [-8, 16, 0], 0.62: [-6, 14, 0], h2: [-10, -16, 0], 1.5: [0, 0, 0]})},
        "jaw": {"rotation": kf({0: [0, 0, 0], 0.15: [20, 0, 0], h1: [14, 0, 0], 0.62: [24, 0, 0], h2: [14, 0, 0], 1.2: [8, 0, 0], 1.5: [0, 0, 0]})},
    }

    def claw_arm(sd, sg, wind, hit, rest):
        pre = {wind - 0.22: [-10, 0, 0]} if wind > 0.3 else {}
        # cocked high behind the shoulder; at the hit the claws are out in front of the chest, mid-swing
        fr = {0: [0, 0, 0], wind: [-80, -sg * 30, -sg * 20], hit: [-20, -sg * 10, -sg * 30], hit + 0.2: [15, -sg * 10, -sg * 15], rest: [0, 0, 0]}
        fr.update(pre)
        b["arm_" + sd] = {"rotation": kf(fr)}
        b["forearm_" + sd] = {"rotation": kf({0: [0, 0, 0], wind: [-30, 0, 0], hit: [-10, 0, 0], hit + 0.2: [20, 0, 0], rest: [0, 0, 0]})}
        b["hand_" + sd] = {"rotation": kf({0: [0, 0, 0], wind: [-40, 0, 0], hit: [10, 0, 0], hit + 0.2: [30, 0, 0], rest: [0, 0, 0]})}
    claw_arm("R", -1, 0.2, h1, 1.05)
    claw_arm("L", 1, 0.62, h2, 1.5)
    for i, t in enumerate(tails):
        a1, a2 = lat(i, 1.3), lat(i, -1.3)
        b[t] = {"rotation": kf({0: [0, 0, 0], h1: [0.3, a1[0], a1[1]], h2: [0.3, a2[0], a2[1]], 1.5: [0, 0, 0]})}
    A["claw"] = {"loop": False, "length": 1.5, "bones": b}

    # ---- jaws: the head is thrown down and forward and the jaws close on it (0.5 s); it is lifted
    #      clear of the ground, shaken from side to side, swung low and then flung away (1.9 s)
    gb, gr = 0.5, 1.9
    shake = [(0.97, 1), (1.1, -1), (1.23, 1), (1.36, -0.85)]

    def with_shake(pitch, yaw, roll=0.0, pre=None, post=None):
        fr = dict(pre or {})
        for t, k in shake:
            fr[t] = [pitch, yaw * k, roll * k]
        fr.update(post or {})
        return kf(fr)
    b = {
        "body": {"rotation": kf({0: [0, 0, 0], 0.32: [-4, 0, 0], gb: [10, 0, 0], 0.85: [-4, 0, 0], 1.45: [-4, 0, 0], 1.68: [6, 14, 0], gr: [-4, -20, 0], 2.4: [0, 0, 0]}),
                 "position": kf({0: [0, 0, 0], 0.32: [0, 0, 14 * pos_k], gb: [0, -10 * pos_k, -46 * pos_k], 0.85: [0, 0, -10 * pos_k], gr: [0, 0, -6 * pos_k], 2.4: [0, 0, 0]})},
        "torso": {"rotation": kf({0: [0, 0, 0], 0.32: [-6, 0, 0], gb: [14, 0, 0], 0.85: [-5, 0, 0], 1.45: [-5, 0, 0], 1.68: [8, 0, 0], gr: [-4, 0, 0], 2.4: [0, 0, 0]})},
        "chest": {"rotation": kf({0: [0, 0, 0], 0.32: [-10, 0, 0], gb: [22, 0, 0], 0.85: [-8, 0, 0], 1.45: [-8, 0, 0], 1.68: [12, 0, 0], gr: [-6, 0, 0], 2.4: [0, 0, 0]})},
        "neck1": {"rotation": with_shake(-10, 10, 0, {0: [0, 0, 0], 0.32: [-10, 0, 0], gb: [18, 0, 0], 0.85: [-10, 0, 0]},
                                        {1.45: [-10, 0, 0], 1.68: [14, 16, 0], gr: [-8, -22, 0], 2.4: [0, 0, 0]})},
        "neck2": {"rotation": with_shake(-10, 12, 0, {0: [0, 0, 0], 0.32: [-12, 0, 0], gb: [12, 0, 0], 0.85: [-10, 0, 0]},
                                        {1.45: [-10, 0, 0], 1.68: [10, 16, 0], gr: [-8, -22, 0], 2.4: [0, 0, 0]})},
        "head": {"rotation": with_shake(-16, 26, 8, {0: [0, 0, 0], 0.32: [-24, 0, 0], 0.46: [2, 0, 0], gb: [10, 0, 0], 0.85: [-16, 0, 0]},
                                       {1.45: [-16, 0, 0], 1.68: [8, 22, 0], gr: [-14, -30, 0], 2.4: [0, 0, 0]})},
        "jaw": {"rotation": kf({0: [0, 0, 0], 0.28: [44, 0, 0], 0.47: [44, 0, 0], gb + 0.03: [12, 0, 0], gr - 0.05: [12, 0, 0], gr + 0.03: [40, 0, 0], 2.2: [10, 0, 0], 2.4: [0, 0, 0]})},
    }
    for sd, sg in (("L", 1), ("R", -1)):
        b["arm_" + sd] = {"rotation": kf({0: [0, 0, 0], 0.32: [-30, 0, -sg * 12], gb: [-46, sg * 22, 0], 1.45: [-56, sg * 22, 0], gr: [16, -sg * 20, 0], 2.4: [0, 0, 0]})}
        b["forearm_" + sd] = {"rotation": kf({0: [0, 0, 0], gb: [-20, 0, 0], 1.45: [-24, 0, 0], gr: [14, 0, 0], 2.4: [0, 0, 0]})}
        b["hand_" + sd] = {"rotation": kf({0: [0, 0, 0], gb: [-24, 0, 0], 1.45: [-28, 0, 0], gr: [20, 0, 0], 2.4: [0, 0, 0]})}
    for i, t in enumerate(tails):
        a1, a2 = lat(i, -1.2), lat(i, 1.8)
        b[t] = {"rotation": kf({0: [0, 0, 0], gb: [0.7, 0, 0], 0.85: [-0.4, 0, 0], 1.68: [0, a1[0], a1[1]], gr: [0.3, a2[0], a2[1]], 2.4: [0, 0, 0]})}
    A["grab"] = {"loop": False, "length": 2.4, "bones": b}

    # ---- tail whip: he coils, then turns his whole body once round on the spot; the tail is
    #      laid out straight and low and trails behind the turn, through everything within reach
    #      (the spin is on the root bone and ends at 360, where he started)
    spin = {0: 0, 0.3: -36, 0.5: 40, 0.7: 150, 0.9: 265, 1.1: 372, 1.3: 362, 1.6: 360}
    b = {
        "root": {"rotation": kf({t: [0, v, 0] for t, v in spin.items()})},
        "body": {"rotation": kf({0: [0, 0, 0], 0.3: [8, 0, -5], 0.7: [10, 0, 6], 1.1: [6, 0, 3], 1.6: [0, 0, 0]}),
                 "position": kf({0: [0, 0, 0], 0.3: [0, -10 * pos_k, 0], 1.1: [0, -8 * pos_k, 0], 1.6: [0, 0, 0]})},
        "chest": {"rotation": kf({0: [0, 0, 0], 0.3: [6, -14, 0], 0.7: [8, 10, 0], 1.1: [4, 6, 0], 1.6: [0, 0, 0]})},
        "head": {"rotation": kf({0: [0, 0, 0], 0.3: [-4, -20, 0], 0.7: [-8, 18, 0], 1.1: [-6, 10, 0], 1.6: [0, 0, 0]})},
        "jaw": {"rotation": kf({0: [0, 0, 0], 0.4: [22, 0, 0], 1.1: [22, 0, 0], 1.6: [0, 0, 0]})},
        "thigh_L": {"rotation": kf({0: [0, 0, 0], 0.4: [-22, 0, 0], 0.56: [8, 0, 0], 0.74: [-22, 0, 0], 0.9: [8, 0, 0], 1.1: [-8, 0, 0], 1.6: [0, 0, 0]})},
        "shin_L": {"rotation": kf({0: [0, 0, 0], 0.4: [30, 0, 0], 0.56: [0, 0, 0], 0.74: [30, 0, 0], 0.9: [0, 0, 0], 1.6: [0, 0, 0]})},
        "thigh_R": {"rotation": kf({0: [0, 0, 0], 0.48: [8, 0, 0], 0.65: [-22, 0, 0], 0.82: [8, 0, 0], 1.0: [-22, 0, 0], 1.2: [4, 0, 0], 1.6: [0, 0, 0]})},
        "shin_R": {"rotation": kf({0: [0, 0, 0], 0.48: [0, 0, 0], 0.65: [30, 0, 0], 0.82: [0, 0, 0], 1.0: [30, 0, 0], 1.2: [0, 0, 0], 1.6: [0, 0, 0]})},
    }
    for sd, sg in (("L", 1), ("R", -1)):          # the arms are flung wide by the turn
        b["arm_" + sd] = {"rotation": kf({0: [0, 0, 0], 0.3: [-8, sg * 10, 0], 0.7: [-24, -sg * 34, -sg * 30], 1.1: [-16, -sg * 20, -sg * 16], 1.6: [0, 0, 0]})}
    for i, t in enumerate(tails):
        up = -rest_tail[i] * (0.5 if i == 0 else 0.9)       # straightened, sloping down to brush the ground at its end
        c0, c1, c2 = lat(i, 2.4), lat(i, -3.4), lat(i, 2.2)
        b[t] = {"rotation": kf({0: [0, 0, 0], 0.3: [up * 0.6, c0[0], c0[1]], 0.5: [up, c1[0] * 0.6, c1[1] * 0.6], 0.7: [up, c1[0], c1[1]],
                                1.05: [up, c1[0], c1[1]], 1.3: [up * 0.7, c2[0], c2[1]], 1.6: [0, 0, 0]})}
    A["whip"] = {"loop": False, "length": 1.6, "bones": b}

    # ---- charge: head down, jaws open, arms cocked back, the legs driving (looped by distance moved)
    P2 = "(q.modified_distance_moved*%g)" % (stride_deg * 1.1)
    ll, lr = "math.max(0,-math.cos(%s))" % P2, "math.max(0,math.cos(%s))" % P2
    pl, pr = "math.max(0,math.sin(%s)-0.4)" % P2, "math.max(0,-math.sin(%s)-0.4)" % P2
    b = {
        "thigh_L": {"rotation": ch("math.sin(%s)*30-%s*10" % (P2, ll))},
        "thigh_R": {"rotation": ch("-math.sin(%s)*30-%s*10" % (P2, lr))},
        "shin_L": {"rotation": ch("%s*34" % ll)},
        "shin_R": {"rotation": ch("%s*34" % lr)},
        "foot_L": {"rotation": ch("-math.sin(%s)*30-%s*27+%s*22" % (P2, ll, pl))},
        "foot_R": {"rotation": ch("math.sin(%s)*30-%s*27+%s*22" % (P2, lr, pr))},
        "toes_L": {"rotation": ch("-%s*22+%s*10" % (pl, ll))},
        "toes_R": {"rotation": ch("-%s*22+%s*10" % (pr, lr))},
        "body": {"rotation": ch("14+math.cos(%s*2)*1.5" % P2, "math.sin(%s)*4" % P2, "math.sin(%s)*3" % P2),
                 "position": [0, "-(1-math.cos(%s*2))*%g-%g" % (P2, round(4 * pos_k, 2), round(6 * pos_k, 2)), round(-10 * pos_k, 2)]},
        "torso": {"rotation": ch(6)},
        "chest": {"rotation": ch(8, "-math.sin(%s)*4" % P2)},
        "neck1": {"rotation": ch(10)}, "neck2": {"rotation": ch(4)},
        "head": {"rotation": ch("-30+" + S(1300, 0, 0.8))},
        "jaw": {"rotation": ch(S(900, 0, 3.0, 18.0))},
    }
    for sd, sg in (("L", 1), ("R", -1)):
        b["arm_" + sd] = {"rotation": ch("-34+math.sin(%s)*%g" % (P2, 10 * sg), 0, -sg * 12)}
        b["forearm_" + sd] = {"rotation": ch(-24)}
        b["hand_" + sd] = {"rotation": ch(-30)}
    for i, t in enumerate(tails):
        y_, r_ = lat(i, 1.0)
        b[t] = {"rotation": ch("%g+%s" % (0.9 if i >= 1 else 2.7, S(900, i * 40, 0.4)),
                               "math.sin(%s-%d)*%.3f" % (P2, 30 + i * 9, 0.5 * y_), "math.sin(%s-%d)*%.3f" % (P2, 30 + i * 9, 0.5 * r_))}
    A["rush"] = {"loop": True, "bones": b}

    # ---- the fins: each thrusts out along its own axis as the count passes it (always running)
    b = {}
    for i, (bone, up, travel) in enumerate(fins):
        k = "math.clamp(%s-%d,0,1)" % (FINS, i)
        b[bone] = {"position": ["%s*%g" % (k, round(-up[0] * travel * 16, 2)), "%s*%g" % (k, round(up[1] * travel * 16, 2)), "%s*%g" % (k, round(up[2] * travel * 16, 2))]}
    A["fins"] = {"loop": True, "bones": b}
    return {"%s.%s" % (prefix, k): v for k, v in A.items()}


# --------------------------------------------------------------- 2nd form
def kamata_set(prefix, tail_n):
    A = {}
    P = "(q.modified_distance_moved*30)"
    tails = ["tail%d" % i for i in range(tail_n)]
    # ---- idle: panting, gills fluttering, head lolling on a loose neck
    b = {
        "body": {"rotation": ch(S(60, 0, 0.6))},
        "neck1": {"rotation": ch(S(40, 0, 1.5), S(25, 0, 4))},
        "neck2": {"rotation": ch(S(40, 40, 1.5), S(25, 40, 5))},
        "head": {"rotation": ch(S(40, 80, 3), S(25, 80, 6), S(18, 0, 4))},
        "jaw": {"rotation": ch(S(55, 0, 7, 4))},
        "gills_L": {"rotation": ch(0, 0, S(260, 0, 7, 6))},
        "gills_R": {"rotation": ch(0, 0, "-(%s)" % S(260, 0, 7, 6))},
    }
    for i, t in enumerate(tails):
        b[t] = {"rotation": ch(0, S(30, i * 26, 1.0 + 0.5 * i))}
    A["idle"] = {"loop": True, "bones": b}

    # ---- walk: a lurching waddle; the body snakes, the head flops after it
    lift_l = "math.max(0,-math.cos(%s))" % P
    lift_r = "math.max(0,math.cos(%s))" % P
    b = {
        "body": {"rotation": ch("math.cos(%s*2)*1.5" % P, "math.sin(%s)*8" % P, "math.sin(%s)*3.5" % P),
                 "position": [0, "(1-math.cos(%s*2))*2.5" % P, 0]},
        "thigh_L": {"rotation": ch("math.sin(%s)*30" % P, 0, "-%s*12" % lift_l)},
        "thigh_R": {"rotation": ch("-math.sin(%s)*30" % P, 0, "%s*12" % lift_r)},
        "shin_L": {"rotation": ch("%s*24" % lift_l)},
        "shin_R": {"rotation": ch("%s*24" % lift_r)},
        "foot_L": {"rotation": ch("-math.sin(%s)*24-%s*14" % (P, lift_l))},
        "foot_R": {"rotation": ch("math.sin(%s)*24-%s*14" % (P, lift_r))},
        "neck1": {"rotation": ch("math.cos(%s*2)*3" % P, "-math.sin(%s-20)*9" % P)},
        "neck2": {"rotation": ch(0, "-math.sin(%s-50)*8" % P)},
        "head": {"rotation": ch("-math.cos(%s*2)*4" % P, "-math.sin(%s-80)*7" % P, "math.sin(%s-60)*6" % P)},
        "jaw": {"rotation": ch("(1-math.cos(%s*2))*4" % P)},
        "gills_L": {"rotation": ch(0, 0, "(1-math.cos(%s*2))*8" % P)},
        "gills_R": {"rotation": ch(0, 0, "-(1-math.cos(%s*2))*8" % P)},
    }
    for i, t in enumerate(tails):
        b[t] = {"rotation": ch(0, "math.sin(%s-%d)*%.2f" % (P, 40 + i * 26, 4 + 1.5 * i))}
    A["walk"] = {"loop": True, "bones": b}
    A["look"] = {"loop": True, "bones": {
        "head": {"rotation": ch("math.clamp(q.target_x_rotation,-25,25)*0.4", "math.clamp(q.target_y_rotation,-40,40)*0.5")},
        "neck2": {"rotation": ch(0, "math.clamp(q.target_y_rotation,-40,40)*0.3")},
    }}
    # ---- roar: gurgling shriek, gills flared
    b = {
        "neck1": {"rotation": kf({0: [0, 0, 0], 0.6: [-10, 0, 0], 2.6: [-10, 0, 0], 3.2: [0, 0, 0]})},
        "neck2": {"rotation": kf({0: [0, 0, 0], 0.6: [-8, 0, 0], 2.6: [-8, 0, 0], 3.2: [0, 0, 0]})},
        "head": {"rotation": kf({0: [0, 0, 0], 0.6: [-18, 0, 0], 2.6: [-22, 0, 0], 3.2: [0, 0, 0]})},
        "jaw": {"rotation": kf({0: [0, 0, 0], 0.5: [26, 0, 0], 2.7: [26, 0, 0], 3.2: [0, 0, 0]})},
        "gills_L": {"rotation": ch(0, 0, S(900, 0, 6, 22))},
        "gills_R": {"rotation": ch(0, 0, "-(%s)" % S(900, 0, 6, 22))},
    }
    A["roar"] = {"loop": False, "length": 3.2, "bones": b}
    # ---- evolving (2nd -> 3rd): it stops, shudders and rears up onto its hind legs
    b = {
        "root": {"scale": kf({0: [1, 1, 1], 6.0: [1.22, 1.22, 1.22]})},
        "body": {"rotation": kf({0: ["math.sin(%s*1500)*2" % LT, 0, "math.sin(%s*1200)*3" % LT],
                                 6.0: ["-30+math.sin(%s*1500)*2" % LT, 0, "math.sin(%s*1200)*3" % LT]}),
                 "position": kf({0: [0, 0, 0], 6.0: [0, 26, 0]})},
        "thigh_L": {"rotation": kf({0: [0, 0, 0], 6.0: [34, 0, 0]})},
        "thigh_R": {"rotation": kf({0: [0, 0, 0], 6.0: [34, 0, 0]})},
        "neck1": {"rotation": kf({0: [0, 0, 0], 6.0: [14, 0, 0]})},
        "neck2": {"rotation": ch(S(700, 0, 5, 6))},
        "head": {"rotation": ch(S(600, 0, 8, 4), S(300, 0, 10))},
        "jaw": {"rotation": ch(S(1600, 0, 6, 20))},
        "gills_L": {"rotation": ch(0, 0, S(1400, 0, 8, 26))},
        "gills_R": {"rotation": ch(0, 0, "-(%s)" % S(1400, 0, 8, 26))},
    }
    for i, t in enumerate(tails):
        b[t] = {"rotation": kf({0: [0, S(250, i * 30, 3 + 0.8 * i), 0], 6.0: [3.2 if i < 6 else 0, S(250, i * 30, 3 + 0.8 * i), 0]})}
    A["evolving"] = {"loop": "hold_on_last_frame", "length": 6.0, "bones": b}
    b = {
        "root": {"rotation": kf({0: [0, 0, 0], 1.0: [0, 0, 0], 2.5: [0, 0, 72], 2.8: [0, 0, 66], 3.0: [0, 0, 70]}),
                 "position": kf({0: [0, 0, 0], 1.0: [0, 0, 0], 2.5: [0, 56, 0]})},
        "neck1": {"rotation": kf({0: [0, 0, 0], 0.6: [-16, 0, 0], 2.5: [12, 0, 0]})},
        "head": {"rotation": kf({0: [0, 0, 0], 0.6: [-14, 0, 0], 2.5: [10, 0, 14]})},
        "jaw": {"rotation": kf({0: [0, 0, 0], 0.5: [26, 0, 0], 2.6: [18, 0, 0]})},
    }
    A["dying"] = {"loop": "hold_on_last_frame", "length": 3.2, "bones": b}
    return {"%s.%s" % (prefix, k): v for k, v in A.items()}


# --------------------------------------------------------------- export
def to_bedrock(anims):
    out = {}
    for name, a in anims.items():
        o = {}
        if a.get("loop") is not None:
            o["loop"] = a["loop"]
        if "length" in a:
            o["animation_length"] = a["length"]
        bones = {}
        for bone, chans in a["bones"].items():
            bones[bone] = {k: chans[k] for k in ("rotation", "position", "scale") if k in chans}
        o["bones"] = bones
        out[name] = o
    return {"format_version": "1.8.0", "animations": out}


def controller(name, mapping, blend=0.45):
    """mapping: {anim_state: (property values, animations[, blend time into the next state])}."""
    states = {}
    order = list(mapping.keys())
    for st in order:
        vals, anims = mapping[st][:2]
        st_blend = mapping[st][2] if len(mapping[st]) > 2 else blend
        trans = []
        for other in order:
            if other == st:
                continue
            cond = " || ".join("q.property('sg:state') == '%s'" % v for v in mapping[other][0])
            trans.append({other: cond})
        states[st] = {"animations": anims, "transitions": trans, "blend_transition": st_blend}
    return {"format_version": "1.10.0", "animation_controllers": {
        name: {"initial_state": order[0], "states": states}}}
