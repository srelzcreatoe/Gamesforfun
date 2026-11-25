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
    e = e.replace("q.property('sg:aim')", "AIM")
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
    env = dict(dict(AIM=0, LT=t, AT=t, DM=0, MS=0, TX=0, TY=0), **(env or {}))
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
    """Head pitch for the breath, spread down the neck like a real spine."""
    return {
        "torso": {"rotation": ch("%g+%s*0.05" % (lean, AIM))},
        "chest": {"rotation": ch("%g+%s*0.05" % (lean, AIM))},
        "neck1": {"rotation": ch("%s*0.22" % AIM)},
        "neck2": {"rotation": ch("%s*0.26" % AIM)},
        "head": {"rotation": ch("%g+%s*0.42" % (extra_head, AIM))},
    }


def big_set(prefix, tail_n, stride_deg=20.0, pos_k=1.0, stagger=0.0):
    """Animation set for the upright forms. stagger > 0 adds the unsteady,
    top-heavy lurch of the 3rd form."""
    A = {}
    P = "(q.modified_distance_moved*%g)" % stride_deg
    tails = ["tail%d" % i for i in range(tail_n)]
    trem = "math.sin(%s*2100)*0.5" % LT

    # ---- idle: eerie stillness; only breath, a slow head drift and the tail
    b = {
        "chest": {"rotation": ch(S(45, 0, 0.5))},
        "neck2": {"rotation": ch(S(45, 40, 0.5), S(14, 0, 1.0))},
        "head": {"rotation": ch(S(45, 80, 0.6), S(14, 30, 1.6))},
        "jaw_L": {"rotation": ch(S(45, 0, 1.0, 1.0))},
        "jaw_R": {"rotation": ch(S(45, 0, 1.0, 1.0))},
    }
    for i, t in enumerate(tails):
        b[t] = {"rotation": ch(S(16, i * 18, 0.25 + 0.07 * i), S(22, i * 20, 0.5 + 0.32 * i))}
    if stagger:
        b["body"] = {"rotation": ch(0, 0, S(50, 0, 1.2 * stagger))}
        b["arm_L"] = {"rotation": ch(S(60, 0, 4))}
        b["arm_R"] = {"rotation": ch(S(60, 70, 4))}
        b["head"] = {"rotation": ch(S(45, 80, 2.0), S(20, 30, 4.0), S(33, 0, 2.0))}
    A["idle"] = {"loop": True, "bones": b}

    # ---- walk: heavy sliding steps under a level, rigid trunk
    sw, kn = (15, 13) if not stagger else (20, 18)
    lift_l = "math.max(0,-math.cos(%s))" % P
    lift_r = "math.max(0,math.cos(%s))" % P
    push_l = "math.max(0,math.sin(%s)-0.4)" % P
    push_r = "math.max(0,-math.sin(%s)-0.4)" % P
    b = {
        "thigh_L": {"rotation": ch("math.sin(%s)*%g" % (P, sw))},
        "thigh_R": {"rotation": ch("-math.sin(%s)*%g" % (P, sw))},
        "shin_L": {"rotation": ch("%s*%g" % (lift_l, kn))},
        "shin_R": {"rotation": ch("%s*%g" % (lift_r, kn))},
        "foot_L": {"rotation": ch("-math.sin(%s)*%g-%s*%g+%s*20" % (P, sw, lift_l, kn * 0.9, push_l))},
        "foot_R": {"rotation": ch("math.sin(%s)*%g-%s*%g+%s*20" % (P, sw, lift_r, kn * 0.9, push_r))},
        "toes_L": {"rotation": ch("-%s*20" % push_l)},
        "toes_R": {"rotation": ch("-%s*20" % push_r)},
        "body": {"rotation": ch(0, "math.sin(%s)*%g" % (P, 1.4 + 4 * stagger), "math.sin(%s)*%g" % (P, 0.9 + 3.2 * stagger)),
                 "position": [0, "-(1-math.cos(%s*2))*%g" % (P, 2.0 * pos_k * (1 + stagger)), 0]},
        "chest": {"rotation": ch(0, "-math.sin(%s)*%g" % (P, 1.0 + 2 * stagger))},
        "neck1": {"rotation": ch(0, 0, "-math.sin(%s)*%g" % (P, 0.5 + 1.6 * stagger))},
        "neck2": {"rotation": ch(0, 0, "-math.sin(%s)*%g" % (P, 0.4 + 1.6 * stagger))},
    }
    if stagger:
        b["head"] = {"rotation": ch("math.cos(%s*2)*%g" % (P, 4 * stagger), "-math.sin(%s-40)*%g" % (P, 3 * stagger))}
        b["arm_L"] = {"rotation": ch("math.sin(%s)*10" % P)}
        b["arm_R"] = {"rotation": ch("-math.sin(%s)*10" % P)}
    for i, t in enumerate(tails):
        b[t] = {"rotation": ch(0, "math.sin(%s-%d)*%.2f" % (P, 30 + i * 12, (0.6 + 0.22 * i) * (1 + stagger)))}
    A["walk"] = {"loop": True, "bones": b}

    # ---- look at target (slow, mostly with the upper neck)
    A["look"] = {"loop": True, "bones": {
        "neck2": {"rotation": ch("math.clamp(q.target_x_rotation,-25,25)*0.2", "math.clamp(q.target_y_rotation,-35,35)*0.3")},
        "head": {"rotation": ch("math.clamp(q.target_x_rotation,-25,25)*0.3", "math.clamp(q.target_y_rotation,-35,35)*0.4")},
    }}

    def tail_up(k0, k1, wob=0.0):
        return {t: {"rotation": ch("%.2f%s" % (k0 + k1 * i, ("+" + S(800, i * 25, wob)) if wob else ""),
                                   S(30, i * 16, 0.2 + 0.05 * i))} for i, t in enumerate(tails)}

    # ---- charge: plates light up, the head begins to bow, the mouth opens
    b = aim_bones()
    b["body"] = {"rotation": ch(trem)}
    b["jaw_L"] = {"rotation": ch(S(600, 0, 1.5, 14))}
    b["jaw_R"] = {"rotation": ch(S(600, 0, 1.5, 14))}
    b.update(tail_up(0.5, 0.1))
    A["charge"] = {"loop": True, "bones": b}

    # ---- spew: mouth gapes and black smoke, then fire, pours downward
    b = aim_bones(2)
    b["body"] = {"rotation": ch(trem)}
    b["jaw_L"] = {"rotation": ch(S(1300, 0, 1.5, 36))}
    b["jaw_R"] = {"rotation": ch(S(1300, 0, 1.5, 36))}
    b.update(tail_up(0.9, 0.16, 0.3))
    A["spew"] = {"loop": True, "bones": b}

    # ---- breath: the lower jaw splits in two and the beam sweeps with the head
    b = aim_bones(2)
    b["body"] = {"rotation": ch(trem, 0, "math.sin(%s*1700)*0.3" % LT)}
    b["jaw_L"] = {"rotation": ch(S(1300, 0, 1.5, 40), -28, -22)}
    b["jaw_R"] = {"rotation": ch(S(1300, 0, 1.5, 40), 28, 22)}
    b.update(tail_up(1.2, 0.22, 0.4))
    A["breath"] = {"loop": True, "bones": b}

    # ---- dorsal rays: head bowed while the back fires into the sky
    b = {
        "body": {"rotation": ch(trem)},
        "torso": {"rotation": ch(6)}, "chest": {"rotation": ch(5)},
        "neck1": {"rotation": ch(14)}, "neck2": {"rotation": ch(18)}, "head": {"rotation": ch(24)},
        "jaw_L": {"rotation": ch(12)}, "jaw_R": {"rotation": ch(12)},
    }
    b.update(tail_up(2.0, 0.25, 0.5))
    A["dorsal"] = {"loop": True, "bones": b}

    # ---- tail beam: the tail rears up and over, tip aimed at the sky
    b = {
        "neck2": {"rotation": ch(-4, S(40, 0, 6))},
        "head": {"rotation": ch(-6, S(40, 20, 8))},
        "jaw_L": {"rotation": ch(14)}, "jaw_R": {"rotation": ch(14)},
    }
    for i, t in enumerate(tails):
        v = 12 if i == 0 else 4 if i < 7 else 1.5 if i < 11 else -4.5
        b[t] = {"rotation": ch("%g+%s" % (v, S(800, i * 30, 0.4)))}
    A["tail"] = {"loop": True, "bones": b}

    # ---- roar: head thrown up and back
    def up(v, t1=0.6, t2=2.8, t3=3.5):
        return kf({0: [0, 0, 0], t1: v, t2: v, t3: [0, 0, 0]})
    b = {
        "chest": {"rotation": up([-4, 0, 0])},
        "neck1": {"rotation": up([-6, 0, 0])},
        "neck2": {"rotation": up([-10, 0, 0])},
        "head": {"rotation": kf({0: [0, 0, 0], 0.6: [-20, 0, 0], 1.7: ["-24+" + S(900, 0, 1.2), 0, 0], 2.8: [-22, 0, 0], 3.5: [0, 0, 0]})},
        "jaw_L": {"rotation": up([34, 0, 0], 0.5, 2.9)},
        "jaw_R": {"rotation": up([34, 0, 0], 0.5, 2.9)},
    }
    for i, t in enumerate(tails):
        b[t] = {"rotation": ch(0, S(60, i * 20, 0.6 + 0.2 * i))}
    A["roar"] = {"loop": False, "length": 3.5, "bones": b}

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
    for i, t in enumerate(tails):
        v = -46 if i == 0 else -8 if i == 1 else 1.6 if i < 8 else 0
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
        b[t] = {"rotation": ch(S(700, i * 30, 1.0), S(300, i * 25, 1.2 + 0.35 * i))}
    A["evolving"] = {"loop": "hold_on_last_frame", "length": 6.0, "bones": b}
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
    """mapping: {anim_state: (property values..., animations)}."""
    states = {}
    order = list(mapping.keys())
    for st in order:
        vals, anims = mapping[st]
        trans = []
        for other in order:
            if other == st:
                continue
            cond = " || ".join("q.property('sg:state') == '%s'" % v for v in mapping[other][0])
            trans.append({other: cond})
        states[st] = {"animations": anims, "transitions": trans, "blend_transition": blend}
    return {"format_version": "1.10.0", "animation_controllers": {
        name: {"initial_state": order[0], "states": states}}}
