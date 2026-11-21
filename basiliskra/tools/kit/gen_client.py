#!/usr/bin/env python3
"""
Generates the client side of the entity from the rig tables the model kit wrote:

  RP/entity/basiliskra.entity.json                 client entity (three geometries, one identity)
  RP/render_controllers/*.json                     base pass + one glow pass per body zone
  RP/animations/basiliskra.animation.json          one always-on pose animation per form
  RP/animation_controllers/*.json                  locator-bound particles per attack phase
  tools/kit/out/pose.json                          the look / bend weights the server rig shares
  tools/kit/out/bb_anims_<form>.json               the same clips for the .bbmodel files

Everything a player sees is a pure function of synchronised entity properties, so every client
-- including one that joins halfway through a beam charge -- draws the same form and phase.
The poses are written as sums of Molang terms weighted by smoothed phase weights; there is no
client-side state machine to fall out of step with the server.
"""
from __future__ import annotations

import json
import math
import re
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "forms"))

import kit

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RP = os.path.join(ROOT, "packs", "RP")
OUT = os.path.join(ROOT, "tools", "kit", "out")

NS = "basiliskra"
P = lambda n: f"q.property('{NS}:{n}')"

# ---- phases (must match src/phases.ts) --------------------------------------------------
PHASE = dict(idle=0, move=1, arrive=2, ram=3, knock=4, rise=5, bite=6, sweep=7, jam=8, spasm=9, sleep=10, wake=11,
             evolve=12, beach=13, drink=14, arc=15, pin=16, look=17, charge=18, fire=19, vent=20, grounded=21,
             scatter=22, roar=23, crossing=24, depart=25, flinch=26, window=27, stalk=28)
KNOCK_GAP = 0.9          # seconds between the three knocks, everywhere they occur
GAIT_DUR = (0.6, 0.9, 1.1)      # Form II: reach, pull, rest
STRIDE_III = 7.0         # blocks per full four-beat cycle
BETA_III = 0.75          # part of the cycle each foot is on the ground: three feet down at any moment, four at each footfall
DROP_III = 9.0           # units the body rides below the bind pose, so that a planted leg can reach both ends of its stance
LIFT_III = 16.0          # units an ankle rises in mid-swing
TAIL_LIFT_III = 4.0      # degrees at the tail root that keep the club's lowest spike off the ground
# upper length, lower length, rest rotations (upper, lower, foot) of the fore and hind legs: from forms/form3.py
LEGS_III = {"f": (50.0, 47.0, (20.0, -35.0, 15.0)), "r": (52.0, 46.0, (-22.0, 40.0, -18.0))}
# share of a look angle taken by each link, eye first (see pre_animation smoothing rates)
LOOK = {
    "i": {"yaw": {"head": 0.6, "chest": 0.4}, "pitch": {"head": 0.6, "chest": 0.4}},
    "ii": {"yaw": {"head": 0.45, "neck": 0.40, "chest": 0.15}, "pitch": {"head": 0.5, "neck": 0.4, "chest": 0.1}},
    "iii": {"yaw": {"head": 0.35, "neck1": 0.11, "neck2": 0.11, "neck3": 0.11, "neck4": 0.11, "neck5": 0.11, "chest": 0.10},
            "pitch": {"head": 0.40, "neck1": 0.12, "neck2": 0.12, "neck3": 0.12, "neck4": 0.12, "neck5": 0.12}},
}


def ph(*names):
    return "(" + " || ".join(f"v.phase == {PHASE[n]}" for n in names) + ")"


def pl(var: str, pts):
    """Piecewise-linear Molang function of `var` through (x, y) points."""
    out = str(pts[-1][1])
    for (x0, y0), (x1, y1) in reversed(list(zip(pts[:-1], pts[1:]))):
        seg = f"math.lerp({y0}, {y1}, ({var} - {x0}) / {x1 - x0})" if y0 != y1 else f"{y0}"
        out = f"({var} < {x1} ? {seg} : {out})"
    return out


class Pose:
    """Accumulates Molang terms per bone channel."""

    def __init__(self):
        self.ch: dict = {}

    def add(self, bone, channel, axis, term):
        self.ch.setdefault(bone, {}).setdefault(channel, [[], [], []])[axis].append(f"({term})")

    def rot(self, bone, x=None, y=None, z=None):
        for a, t in enumerate((x, y, z)):
            if t is not None:
                self.add(bone, "rotation", a, t)

    def pos(self, bone, x=None, y=None, z=None):
        for a, t in enumerate((x, y, z)):
            if t is not None:
                self.add(bone, "position", a, t)

    def scl(self, bone, x=None, y=None, z=None):
        for a, t in enumerate((x, y, z)):
            if t is not None:
                self.add(bone, "scale", a, t)

    def bones(self, known):
        out = {}
        for bone, chans in self.ch.items():
            if bone not in known:
                raise KeyError(f"pose references unknown bone {bone}")
            jb = {}
            for c, axes in chans.items():
                if c == "scale":
                    jb[c] = [" * ".join(a) if a else 1 for a in axes]
                else:
                    jb[c] = [" + ".join(a) if a else 0 for a in axes]
            out[bone] = jb
        return out


# ---- shared pre-animation -------------------------------------------------------------
def pre_animation():
    s = [
        "v.dt = math.min(q.delta_time, 0.1);",
        f"v.form = {P('form')};",
        f"v.phase = {P('phase')};",
        "v.k1 = math.min(1, v.dt * 14);", "v.k2 = math.min(1, v.dt * 6);", "v.k3 = math.min(1, v.dt * 3);",
        "v.k4 = math.min(1, v.dt * 1.5);",
        # seconds since the phase last changed: timed pulses hang off this
        "v.pt = (v.phase != v.phase_prev) ? 0 : v.pt + v.dt;",
        "v.left_move = (v.phase_prev == 1 && v.phase != 1) ? 1 : 0;",
        "v.phase_prev = v.phase;",
        # a look travels eye -> skull -> neck -> shoulders: four followers with rising lag
        f"v.ly_t = {P('look_yaw')};", f"v.lp_t = {P('look_pitch')};",
        "v.ly_eye = v.ly_eye + (v.ly_t - v.ly_eye) * v.k1;",
        "v.ly_head = v.ly_head + (v.ly_t - v.ly_head) * v.k2;",
        "v.ly_neck = v.ly_neck + (v.ly_t - v.ly_neck) * v.k3;",
        "v.ly_chest = v.ly_chest + (v.ly_t - v.ly_chest) * v.k4;",
        "v.lp_head = v.lp_head + (v.lp_t - v.lp_head) * v.k2;",
        "v.lp_neck = v.lp_neck + (v.lp_t - v.lp_neck) * v.k3;",
        "v.eye_lead = math.clamp((v.ly_eye - v.ly_head) * 0.05, -0.9, 0.9);",
        f"v.bend_t = {P('bend')};",
        "v.bend = v.bend + (v.bend_t - v.bend) * v.k3;",
        f"v.pitch = v.pitch + ({P('pitch')} - v.pitch) * v.k3;",
        # the tail is a sprung mass: it follows a turn late and carries one short arc past a stop
        "v.tsv = v.tsv + ((v.bend_t - v.ts) * 55 - v.tsv * 4.6) * v.dt + v.left_move * 26;",
        "v.ts = math.clamp(v.ts + v.tsv * v.dt, -40, 40);",
        # glow: zones 0 (tail) .. 8 (head) light in order as the charge property climbs to 18
        f"v.charge = v.charge + ({P('charge')} - v.charge) * math.min(1, v.dt * 12);",
        "v.flick = 0.86 + 0.14 * math.sin(q.life_time * 1900) * math.cos(q.life_time * 523);",
        "v.over = math.clamp(v.charge - 18, 0, 2) * 0.5;",
        f"v.spasm = {ph('spasm', 'evolve', 'beach')} ? 1 : 0;",
        # three knocks, 0.9 s apart, wherever they are heard
        f"v.kn = (v.pt < {KNOCK_GAP * 3 - 0.1}) ? math.clamp(1 - math.abs(math.mod(v.pt, {KNOCK_GAP}) - 0.08) * 9, 0, 1) : 0;",
        f"v.knock = {ph('knock', 'wake', 'vent')} ? v.kn : 0;",
        f"v.gill_open = {P('gill')} ? 1 : 0;",
        "v.breath = math.sin(q.life_time * 72);",
        f"v.walk = v.walk + (({ph('move', 'crossing', 'depart', 'stalk')} ? 1 : 0) - v.walk) * v.k3;",
        f"v.gait = {P('gait')};",
        "v.gt = (v.gait != v.gait_prev) ? 0 : v.gt + v.dt;",
        # the landing is reported a tick or two after the ground was covered: keep what was covered since (Form III)
        f"v.gd0 = (v.gait != v.gait_prev) ? q.modified_distance_moved - math.clamp(q.modified_distance_moved - v.gd0 - {STRIDE_III / 4}, 0, {STRIDE_III / 8}) : v.gd0;",
        "v.gait_prev = v.gait;",
        # a one-shot pulse from the server (1 gills, 2 tail knob, 3 the whole hide): a brief flash where it says
        f"v.fx_kind = {P('fx_kind')};",
        f"v.fxp = ({P('fx_seq')} != v.fx_prev) ? 1 : math.max(0, v.fxp - v.dt * 3.2);",
        f"v.fx_prev = {P('fx_seq')};",
    ]
    for k in range(9):
        wave = f"0.55 * v.spasm * math.clamp(1 - math.abs(v.pt * 2.2 - {8 - k} * 0.42 - 0.3) * 1.5, 0, 1)"
        gill = " + v.knock" if k == 7 else ""
        flash = f" + v.fxp * (v.fx_kind == 1 ? {1 if k == 7 else 0} : (v.fx_kind == 2 ? {0.9 if k <= 1 else 0} : 0.4))"
        s.append(f"v.g{k} = math.clamp((math.clamp(v.charge * 0.5 - {k}, 0, 1) + v.over * 0.25) * v.flick + {wave}{gill}{flash}, 0, 1);")
    weights = {
        "ram": ("ram",), "knockp": ("knock", "wake"), "rise": ("rise",), "bite": ("bite",),
        "sweep": ("sweep",), "jam": ("jam",), "spasmw": ("spasm",), "sleep": ("sleep",), "evolve": ("evolve", "beach"),
        "drink": ("drink",), "arc": ("arc",), "pin": ("pin",), "chargew": ("charge", "fire"), "fire": ("fire",),
        "vent": ("vent",), "ground": ("grounded",), "scatter": ("scatter",), "roar": ("roar",), "window": ("window", "stalk"),
        "flinch": ("flinch",),
    }
    for name, phases in weights.items():
        rate = "v.k4" if name == "window" else "v.k2"        # the head comes down to the window slowly
        s.append(f"v.w_{name} = v.w_{name} + (({ph(*phases)} ? 1 : 0) - v.w_{name}) * {rate};")
    return s


# The window pose (degrees added per neck bone, then head x/y/z).  The server poses its skeleton with
# the same numbers (generated/rig.ts), and stands him so that the eye ends a stride from the glass.
WINDOW_NECK = [32, 28, 20, 0, -24]
WINDOW_HEAD = [-52.7, 21.8, -51.8]      # solved so that, at the end of that neck, the skull is turned 55 degrees about the vertical and tipped 18 down

SHUDDER = lambda f, i=0: f"math.sin(q.life_time * {f} + {i * 71})"


# ---- Form I ----------------------------------------------------------------------------
def pose_i(rig):
    p = Pose()
    n = 10
    pre = [
        # the swimming wave advances with distance travelled, and never quite stops
        "v.swp = q.modified_distance_moved * 34 + q.life_time * 38;",
        "v.swa = 1.1 + math.min(q.ground_speed, 8) * 0.5;",
        # every seventh stroke the left gill catches: two clean strokes, then a hitch
        "v.catch = math.clamp(1 - math.abs(math.mod(v.swp / 360, 7) - 6.5) * 2.4, 0, 1);",
        "v.swg = (1 - 0.55 * v.catch) * (1 - 0.8 * v.w_sleep) * (1 - 0.7 * v.w_knockp);",
        "v.gl = math.max(v.gill_open, math.max(v.catch, v.knock));",
        "v.gr = 0.14 + 0.12 * math.sin(q.life_time * 95);",
    ]
    p.rot("body", x="v.pitch", z="5 * v.catch + 48 * v.w_knockp")
    p.pos("body", x="2.2 * v.knock", y="-1.5 * v.knock")
    p.rot("chest", y=f"v.ly_chest * {LOOK['i']['yaw']['chest']}", x=f"v.lp_neck * {LOOK['i']['pitch']['chest']} - 4 * v.w_rise")
    p.rot("head", y=f"v.ly_head * {LOOK['i']['yaw']['head']} + v.bend * 0.6 + v.swa * 0.5 * v.swg * math.sin(v.swp + 50) - 4 * v.catch"
                    f" + 5 * v.w_jam * {SHUDDER(1500)}",
          x=f"v.lp_head * {LOOK['i']['pitch']['head']} - 6 * v.w_ram - 8 * v.w_bite * math.clamp(1 - math.abs(v.pt - 0.22) * 6, 0, 1)")
    p.rot("jaw", x="2 + 1.5 * v.breath + 34 * v.w_bite * math.clamp(1 - math.abs(v.pt - 0.22) * 6, 0, 1) + 10 * v.w_ram + 7 * v.w_spasmw")
    for i in range(1, n + 1):
        f = i / n
        p.rot(f"seg{i}",
              y=f"-v.bend + v.swa * {0.35 + 0.13 * i:.2f} * v.swg * math.sin(v.swp - {i * 36})"
                f" + {16 * f:.1f} * v.w_sweep * math.sin(v.pt * 400 - {i * 30})"
                f" + {2.2 * f:.2f} * v.w_jam * {SHUDDER(1300, i)}",
              x=f"{2.0 if i <= 4 else -1.0} * v.w_rise + 5 * v.w_spasmw * math.clamp(1 - math.abs(v.pt * 3 - {i * 0.35:.2f} - 1) * 1.6, 0, 1)"
                f" + 2.4 * v.w_evolve * {SHUDDER(900, i)}",
              z=f"1.6 * v.w_evolve * {SHUDDER(1100, i + 3)}")
    p.rot("tailfin", y="-v.bend + v.swa * 2.2 * v.swg * math.sin(v.swp - 400) + 20 * v.w_sweep * math.sin(v.pt * 400 - 320)")
    for i in range(0, n + 1):
        rise = f"math.clamp(1 - math.abs(v.pt * 3 - {i * 0.35:.2f} - 1) * 1.6, 0, 1)"
        p.rot(f"ribbon{i}", z=f"6 * v.swg * math.sin(v.swp - {i * 36 + 60})")
        p.scl(f"ribbon{i}", y=f"(1 + 0.9 * v.w_spasmw * {rise} - 0.45 * v.w_evolve)")
    for i in range(6, n + 1):
        p.rot(f"vribbon{i}", z=f"-6 * v.swg * math.sin(v.swp - {i * 36 + 90})")
    for s, sgn in (("l", 1), ("r", -1)):
        p.rot(f"fin_{s}", z=f"{sgn} * (7 * math.sin(v.swp - 70) + 6 * v.breath * (1 - v.swg) - 14 * v.w_rise)", y=f"{sgn} * 5 * math.sin(v.swp - 100)")
        p.rot(f"fin_{s}_tip", z=f"{sgn} * 10 * math.sin(v.swp - 150)")
        g = "v.gl" if s == "l" else "v.gr"
        for i in (1, 2, 3):
            p.pos(f"gill_{s}{i}", x=f"{sgn} * 1.5 * {g}")
            p.scl(f"gill_{s}{i}", x=f"(1 + 0.5 * {g})", z=f"(1 + 0.45 * {g})")
        p.pos(f"eye_{s}", z="-v.eye_lead")
    return pre, p.bones(rig["bones"])


# ---- Form II ---------------------------------------------------------------------------
def pose_ii(rig):
    p = Pose()
    r, pu, re = GAIT_DUR
    pre = [
        # gait: 0 reach(left) 1 pull 2 rest 3 reach(right) 4 pull 5 rest; v.c runs 0..6 through it
        f"v.gd = (v.gait == 0 || v.gait == 3) ? {r} : ((v.gait == 1 || v.gait == 4) ? {pu} : {re});",
        "v.c = v.gait + math.clamp(v.gt / v.gd, 0, 1);",
        "v.cr = math.mod(v.c + 3, 6);",
        "v.pulling = (v.gait == 1 || v.gait == 4) ? math.sin(math.clamp(v.gt / v.gd, 0, 1) * 180) : 0;",
        "v.resting = (v.gait == 2 || v.gait == 5) ? math.sin(math.clamp(v.gt / v.gd, 0, 1) * 180) : 0;",
        "v.gl = math.max(v.gill_open, v.knock);",
    ]
    # the planted claw holds its place in the world: the arm sweeps back exactly as the chest is pulled forward
    arm = [(0, 18), (1, -28), (2, -6), (4, -6), (5, 18), (6, 18)]
    fore = [(0, -6), (1, 14), (2, 4), (4, 4), (5, -6), (6, -6)]
    for s, c in (("l", "v.c"), ("r", "v.cr")):
        sgn = 1 if s == "l" else -1
        lift = f"(({c} < 1) ? math.sin({c} * 180) : 0)"
        p.rot(f"arm_{s}", x=f"{pl(c, arm)}" + (" - 58 * v.w_pin" if s == "l" else ""), z=f"{sgn} * 5 * {lift}")
        p.rot(f"forearm_{s}", x=f"{pl(c, fore)} - 12 * {lift}" + (" + 40 * v.w_pin" if s == "l" else ""))
        p.rot(f"claw_{s}", x=f"-({pl(c, arm)}) - ({pl(c, fore)}) + 14 * {lift}" + (" + 22 * v.w_pin" if s == "l" else ""))
        p.pos(f"arm_{s}", y=f"5 * {lift}")
        p.rot(f"leg_{s}", y=f"{sgn} * 9 * math.sin(v.c * 60)")
        p.rot(f"foot_{s}", y=f"{sgn} * 7 * math.sin(v.c * 60 - 50)")
        p.pos(f"eye_{s}", z="-v.eye_lead")
        for i in (1, 2, 3):
            g = "v.gl" if s == "l" else "0.1 * (1 + v.breath)"
            p.scl(f"gill_{s}{i}", x=f"(1 + 0.7 * {g})", z=f"(1 + 0.9 * {g})")
    L = LOOK["ii"]
    p.rot("body", x="v.pitch")
    p.pos("body", y="-2.6 * v.resting + 1.2 * v.pulling")
    p.rot("chest", x=f"-1.3 * v.breath + 3 * v.pulling + v.lp_neck * {L['pitch']['chest']} + 6 * v.w_drink - 8 * v.w_evolve - 4 * v.w_roar"
                     f" + 1.8 * v.w_evolve * {SHUDDER(1000)}",
          y=f"v.ly_chest * {L['yaw']['chest']}", z=f"1.5 * v.w_evolve * {SHUDDER(1250, 2)}")
    p.rot("neck", x=f"0.9 * v.breath + v.lp_neck * {L['pitch']['neck']} + 22 * v.w_drink - 9 * v.w_roar - 13 * v.w_flinch", y=f"v.ly_neck * {L['yaw']['neck']}")
    p.rot("head", x=f"v.lp_head * {L['pitch']['head']} + 16 * v.w_drink - 12 * v.w_roar - 9 * v.w_flinch - 8 * v.w_bite * math.clamp(1 - math.abs(v.pt - 0.22) * 6, 0, 1)",
          y=f"v.ly_head * {L['yaw']['head']}")
    p.rot("jaw", x="2.5 * v.breath + (5 + 4 * math.sin(q.life_time * 520)) * v.w_drink + 26 * v.w_roar"
                   " + 30 * v.w_bite * math.clamp(1 - math.abs(v.pt - 0.22) * 6, 0, 1) + 9 * v.w_evolve")
    p.rot("mid", y="-v.bend * 0.5", x="-1.5 * v.pulling")
    # the pelvis lags the chest and catches up while he rests
    p.pos("hips", z="5 * v.pulling")
    p.rot("hips", y="-v.bend * 0.8")
    for i in range(1, 7):
        p.rot(f"tail{i}", y=f"-v.ts * {0.5 + 0.1 * i:.1f} + 2 * math.sin(q.life_time * 40 - {i * 40}) + {2.5 * i} * v.w_arc * math.sin(v.pt * 300 - {i * 25})",
              x=f"1.2 * v.w_arc * {i}")
    p.rot("knob", z="6 * v.w_arc * math.sin(v.pt * 600)")
    for b in ("plates_chest", "plates_mid", "plates_hips", "plates_neck"):
        p.scl(b, y="(1 + 0.02 * v.breath)")
    return pre, p.bones(rig["bones"])


# ---- Form III --------------------------------------------------------------------------
def pose_iii(rig):
    p = Pose()
    quarter = STRIDE_III / 4
    stance = STRIDE_III * BETA_III * 16
    pre = [
        # The server names the foot that landed last (gait 0..3: left hind, left fore, right hind, right fore) at the
        # moment it lands; between landings the cycle advances with the ground he covers.  Every client is therefore
        # in step with the footfall it hears, and with every other client.
        # The cycle itself runs on the ground this client has seen him cover, and is drawn gently towards the server's
        # count while he walks: a report that arrives a tick or two late never makes a planted foot jump.
        f"v.wt = (v.gait + math.clamp((q.modified_distance_moved - v.gd0) / {quarter}, 0, 1.15)) * 90;",
        "v.dd = math.clamp(q.modified_distance_moved - v.dprev, 0, 0.6);",
        "v.dprev = q.modified_distance_moved;",
        "v.werr = math.mod(math.mod(v.wt - v.wp, 360) + 540, 360) - 180;",
        f"v.wp = math.mod(v.wp + v.dd * {90 / quarter:.4f} + math.clamp(v.werr, -40 * v.dt, 40 * v.dt) * math.clamp(v.dd / (v.dt + 0.0001) / 0.8, 0, 1) + 360, 360);",
        "v.p_bl = math.mod(v.wp, 360) / 360;", "v.p_fl = math.mod(v.wp + 270, 360) / 360;",
        "v.p_br = math.mod(v.wp + 180, 360) / 360;", "v.p_fr = math.mod(v.wp + 90, 360) / 360;",
        "v.kopen = v.w_vent;",
        # how far the body rides below the bind pose (units): the legs are solved against this every frame
        f"v.by = -{DROP_III} + 1.4 * v.breath * (1 - v.walk) - 1.3 * v.walk * math.abs(math.sin(v.wp * 2)) - 3 * v.w_chargew;",
    ]
    # Planted feet stay where they are planted.  For each leg the ankle's place under the hip follows from the
    # cycle (stance: carried straight back at the speed the body goes forward; swing: lifted and brought forward),
    # and the two joints are solved for it.  This runs in every phase, so a breath, a crouch or a stop never
    # drags a sole.
    for tag in ("fl", "fr", "bl", "br"):
        la, lb, rest = LEGS_III["f" if tag[0] == "f" else "r"]
        fu, fl = -rest[0], -(rest[0] + rest[1])                       # rest angles from straight down, forward positive
        xm = la * math.sin(math.radians(fu)) + lb * math.sin(math.radians(fl))
        h0 = la * math.cos(math.radians(fu)) + lb * math.cos(math.radians(fl))
        P_ = f"v.p_{tag}"
        pre += [
            f"v.su_{tag} = ({P_} > {BETA_III}) ? ({P_} - {BETA_III}) / {1 - BETA_III} : 0;",
            f"v.lx_{tag} = ({P_} < {BETA_III}) ? {xm:.3f} + {stance} * (0.5 - {P_} / {BETA_III}) : {xm - stance / 2:.3f} + {stance} * v.su_{tag} * v.su_{tag} * (3 - 2 * v.su_{tag});",
            f"v.lh_{tag} = {h0 - 1.2:.3f} + v.by - {LIFT_III} * math.sin(180 * v.su_{tag}) * v.walk;",      # (1.2: the sole clears the ground through the body's small roll)
            f"v.ld_{tag} = math.min(math.sqrt(v.lx_{tag} * v.lx_{tag} + v.lh_{tag} * v.lh_{tag}), {la + lb - 0.5});",
            f"v.lg_{tag} = math.atan2(v.lx_{tag}, v.lh_{tag});",
            f"v.la_{tag} = math.acos(math.clamp(({la * la - lb * lb} + v.ld_{tag} * v.ld_{tag}) / ({2 * la} * v.ld_{tag}), -1, 1));",
            f"v.lk_{tag} = math.acos(math.clamp(({la * la + lb * lb} - v.ld_{tag} * v.ld_{tag}) / {2 * la * lb}, -1, 1));",
        ]
        if tag[0] == "f":       # the elbow points back
            pre += [f"v.lu_{tag} = v.lg_{tag} - v.la_{tag};", f"v.ll_{tag} = v.lu_{tag} + 180 - v.lk_{tag};"]
        else:                   # the stifle points forward
            pre += [f"v.lu_{tag} = v.lg_{tag} + v.la_{tag};", f"v.ll_{tag} = v.lu_{tag} - 180 + v.lk_{tag};"]
    L = LOOK["iii"]
    # weight moves over the legs that stay down just before the opposite foot lifts
    p.pos("body", x="1.5 * v.walk * math.cos(v.wp - 110)", y="v.by")
    p.rot("body", z="0.8 * v.walk * math.cos(v.wp - 110)", x=f"v.pitch - 2 * v.w_roar + 1.2 * v.w_ground * {SHUDDER(1400)}")
    p.rot("chest", y=f"v.ly_chest * {L['yaw']['chest']}", x=f"-1.0 * v.breath - 1.5 * v.w_fire")
    p.rot("hips", y="-v.bend * 0.3")
    for i in range(1, 6):
        p.rot(f"neck{i}", y=f"v.ly_neck * {L['yaw'][f'neck{i}']}",
              x=f"v.lp_neck * {L['pitch'][f'neck{i}']} + 0.5 * v.breath - 1.5 * v.w_chargew - 4 * v.w_roar + 3 * v.w_ground"
                f" + 0.8 * v.walk * math.sin(v.wp * 2 - {i * 30}) + {WINDOW_NECK[i - 1]} * v.w_window")
    # at the window the neck goes down steeply from the shoulders and levels out again, and the skull
    # turns and rolls until one small eye is square to the glass
    p.rot("head", y=f"v.ly_head * {L['yaw']['head']} + {WINDOW_HEAD[1]} * v.w_window",
          x=f"v.lp_head * {L['pitch']['head']} - 4 * v.w_chargew - 24 * v.w_roar + 14 * v.w_ground + 1.2 * v.w_fire * {SHUDDER(2400)} + {WINDOW_HEAD[0]} * v.w_window",
          z=f"{WINDOW_HEAD[2]} * v.w_window")
    p.pos("head", z=f"1.6 * v.w_fire * {SHUDDER(2700, 1)}", y="2.2 * v.knock")
    p.rot("jaw", x="2.2 * v.breath + v.w_chargew * v.charge * 0.9 + 16 * v.w_fire + 30 * v.w_roar + 6 * v.w_vent + 8 * v.w_ground")
    for tag in ("fl", "fr", "bl", "br"):
        front = tag[0] == "f"
        rest = LEGS_III["f" if front else "r"][2]
        # the chest breathes and turns with a look; the fore legs hang from it, so they give that back
        undo_x = " + 1.0 * v.breath + 1.5 * v.w_fire" if front else ""
        undo_y = f"-v.ly_chest * {L['yaw']['chest']}" if front else "v.bend * 0.3"
        p.rot(f"leg_{tag}", x=f"-v.lu_{tag} - {rest[0]}{undo_x}", y=undo_y)
        p.rot(f"leg_{tag}_lower", x=f"v.lu_{tag} - v.ll_{tag} - {rest[1]}")
        # the sole stays level on the ground and tips toe-down as it leaves it
        p.rot(f"foot_{tag}", x=f"v.ll_{tag} - {rest[2]} + 14 * math.sin(180 * v.su_{tag}) * v.walk")
    for i in range(1, 9):
        p.rot(f"tail{i}", y=f"-v.ts * {0.35 + 0.09 * i:.2f} + 2.4 * v.walk * math.sin(v.wp - {i * 50}) + 1.2 * math.sin(q.life_time * 30 - {i * 35})"
                             f" + {1.5 * i} * v.w_ground * math.sin(v.pt * 900) * math.max(0, 1 - v.pt * 1.5)",
              x=f"-1.7 * v.w_chargew + 0.25 * v.breath" + (f" + {TAIL_LIFT_III}" if i == 1 else ""))
    p.rot("club", z="4 * v.w_chargew * math.sin(q.life_time * 2100)")
    for s, sgn in (("l", 1), ("r", -1)):
        for i in (1, 2, 3):
            p.rot(f"gill_{s}{i}", y=f"{sgn} * 40 * v.kopen * (0.7 + 0.3 * v.knock)")
        p.pos(f"eye_{s}", z="-v.eye_lead")
    plates = [b for b in rig["bones"] if b.startswith("plates_")]
    for j, b in enumerate(plates):
        p.scl(b, y=f"(1 + 0.015 * v.breath + 0.05 * v.w_chargew + 0.10 * v.w_scatter)")
        p.rot(b, z=f"5 * v.w_scatter * {SHUDDER(1150, j)}", x=f"-3 * v.w_scatter")
    return pre, p.bones(rig["bones"])


# ---- files -----------------------------------------------------------------------------
def render_controllers(rigs):
    rc = {}
    arr = {"geometries": {"Array.geo": [f"Geometry.{t}" for t in ("i", "ii", "iii")]},
           "textures": {"Array.tex": [f"Texture.{t}" for t in ("i", "ii", "iii")], "Array.glow": [f"Texture.{t}_glow" for t in ("i", "ii", "iii")]}}
    idx = f"{P('form')} - 1"
    base_list = []
    for fi, tag in enumerate(("i", "ii", "iii"), start=1):
        vis = [{"*": f"{P('bound')}"}]
        for bone, bd in rigs[tag]["bones"].items():
            if bd["zone"] is not None:
                z = bd["zone"]
                vis.append({bone: f"{P('bound')} && {z} >= {P('vis_lo')} && {z} <= {P('vis_hi')}"})
        rc[f"controller.render.{NS}.{tag}.base"] = {
            "geometry": f"Geometry.{tag}",
            "materials": [{"*": "Material.default"}],
            "textures": [f"Texture.{tag}"],
            # not drawn at all until the server has bound this entity as the one Basiliskra, and
            # zone by zone only on this side of the seam while he crosses it
            "part_visibility": vis,
            # a 40-block body flashing red at every arrow reads as a glitch: no hurt tint
            "is_hurt_color": {"r": 0.0, "g": 0.0, "b": 0.0, "a": 0.0},
            "on_fire_color": {"r": 0.0, "g": 0.0, "b": 0.0, "a": 0.0},
        }
        base_list.append({f"controller.render.{NS}.{tag}.base": f"v.form == {fi}"})
    listing = []
    for fi, tag in enumerate(("i", "ii", "iii"), start=1):
        zones = rigs[tag]["glow_zones"]
        for z in range(9):
            bones = zones.get(str(z), [])
            if not bones:
                continue
            name = f"controller.render.{NS}.{tag}.glow{z}"
            vis = [{"*": False}] + [{b: True} for b in bones]
            rc[name] = {
                "geometry": f"Geometry.{tag}",
                "materials": [{"*": "Material.glow"}],
                "textures": [f"Texture.{tag}_glow"],
                "ignore_lighting": True,
                "part_visibility": vis,
                "color": {"r": 1.0, "g": 1.0, "b": 1.0, "a": f"v.g{z}"},
            }
            # each glow pass draws only the bones it lights, and only while it is lit
            listing.append({name: f"{P('bound')} && v.form == {fi} && v.g{z} > 0.01 && {z} >= {P('vis_lo')} && {z} <= {P('vis_hi')}"})
    return {"format_version": "1.10.0", "render_controllers": rc}, base_list + listing


def particle_controller(tag):
    def st(effects, transitions):
        d = {"transitions": transitions}
        if effects:
            d["particle_effects"] = [{"effect": e, "locator": l} for e, l in effects]
        return d

    if tag == "iii":
        charge = [("charge_spark", "club_core")] + [("plate_ember", f"plate_tip_{k}") for k in (1, 3, 5, 7, 9)] + [("throat_glow", "mouth")]
        fire = [("mouth_flare", "muzzle")] + [("plate_ember", f"plate_tip_{k}") for k in (0, 2, 4, 6, 8)] + [("charge_spark", "club_core")]
        vent = [("gill_steam", "gill_l"), ("gill_steam", "gill_r")]
        ground = [("club_arc", "spike_tip_0"), ("club_arc", "spike_tip_3"), ("club_arc", "spike_tip_8")]
        scatter = [("plate_ember", f"plate_tip_{k}") for k in range(10)]
        idle = [("club_crackle", "spike_tip_1"), ("club_crackle", "spike_tip_4"), ("club_crackle", "spike_tip_11")]
        states = {"idle": idle, "charge": charge, "fire": fire, "vent": vent, "grounded": ground, "scatter": scatter}
        cond = {"charge": ph("charge"), "fire": ph("fire"), "vent": ph("vent"), "grounded": ph("grounded"), "scatter": ph("scatter")}
    elif tag == "ii":
        idle = [("horn_arc", "horn_l")]
        arc = [("horn_arc_big", "horn_l"), ("horn_arc_big", "horn_r"), ("club_crackle", "knob_core")]
        drink = [("drip", "muzzle")]
        states = {"idle": idle, "arc": arc, "drink": drink, "evolve": [("shed_flakes", "heart")]}
        cond = {"arc": ph("arc"), "drink": ph("drink"), "evolve": ph("evolve", "beach")}
    else:
        idle = [("gill_bubbles", "gill_l"), ("gill_bubbles", "gill_r")]
        knock = [("gill_silt", "gill_l")]
        states = {"idle": idle, "knock": knock, "spasm": [("fin_splash", f"spine_{k}") for k in (1, 3, 5, 7, 9)],
                  "evolve": [("shed_flakes", "back")]}
        cond = {"knock": ph("knock", "wake"), "spasm": ph("spasm"), "evolve": ph("evolve", "beach")}
    out = {}
    for name, eff in states.items():
        tr = []
        for other, c in cond.items():
            if other != name:
                tr.append({other: c})
        if name != "idle":
            tr.append({"idle": f"!{cond[name]}"})
        out[name] = st(eff, tr)
    return {"initial_state": "idle", "states": out}


PARTICLES = ["charge_spark", "plate_ember", "throat_glow", "mouth_flare", "gill_steam", "club_arc", "club_crackle",
             "horn_arc", "horn_arc_big", "drip", "shed_flakes", "gill_bubbles", "gill_silt", "fin_splash"]


def write_rig_ts(rigs):
    """The skeleton for the behaviour-pack script: same bones, pivots and locators as the geometry."""
    out = ["// GENERATED by tools/kit/gen_client.py from the model kit's rig tables.  Do not edit.", "",
           "export interface RigBone { parent: string | null; pivot: number[]; rot: number[]; zone: number | null }",
           "export interface RigData { bones: Record<string, RigBone>; locators: Record<string, { bone: string; pos: number[] }>; meta: Record<string, number>; zones: Record<string, string[]> }",
           ""]
    data = {}
    for n, tag in enumerate(("i", "ii", "iii"), start=1):
        r = rigs[tag]
        zones = {}
        for name, bd in r["bones"].items():
            if bd["zone"] is not None:
                zones.setdefault(str(bd["zone"]), []).append(name)
        data[n] = {"bones": r["bones"], "locators": r["locators"], "meta": {k: v for k, v in r["meta"].items() if isinstance(v, (int, float))}, "zones": zones}
    out.append("export const RIGS: Record<1 | 2 | 3, RigData> = " + json.dumps(data, separators=(",", ":")) + ";")
    look = {n: LOOK[t] for n, t in enumerate(("i", "ii", "iii"), start=1)}
    out.append("export const LOOK: Record<1 | 2 | 3, { yaw: Record<string, number>; pitch: Record<string, number> }> = " + json.dumps(look, separators=(",", ":")) + ";")
    out.append(f"export const STRIDE_III = {STRIDE_III};")
    out.append(f"/** Blocks a planted sole travels under the body; a foot lands half of this ahead of where it stands at rest. */")
    out.append(f"export const STANCE_III = {STRIDE_III * BETA_III};")
    out.append(f"export const BODY_DROP_III = {DROP_III};")
    out.append(f"export const TAIL_LIFT_III = {TAIL_LIFT_III};")
    out.append(f"export const WINDOW_NECK = {json.dumps(WINDOW_NECK)};")
    out.append(f"export const WINDOW_HEAD = {json.dumps(WINDOW_HEAD)};")
    out.append(f"export const GAIT_TICKS = {json.dumps([int(round(d * 20)) for d in GAIT_DUR])};")
    os.makedirs(os.path.join(ROOT, "src", "generated"), exist_ok=True)
    with open(os.path.join(ROOT, "src", "generated", "rig.ts"), "w") as f:
        f.write("\n".join(out) + "\n")


def main():
    rigs = {t: json.load(open(os.path.join(OUT, f"rig_{t}.json"))) for t in ("i", "ii", "iii")}
    rc, glow_list = render_controllers(rigs)
    anims = {}
    pre_all = pre_animation()
    # per-form variables are appended to the shared list: each line is cheap, and harmless
    # while another form is showing
    pre_form = []
    for tag, fn in (("i", pose_i), ("ii", pose_ii), ("iii", pose_iii)):
        pre, bones = fn(rigs[tag])
        pre_form += pre
        anims[f"animation.{NS}.{tag}.pose"] = {"loop": True, "bones": bones}
    names = []
    for text in pre_all + pre_form + [json.dumps(anims)]:
        for n in re.findall(r"\bv\.([a-z_0-9]+)", text):
            if n not in names:
                names.append(n)
    special = {"phase_prev": -1, "gait_prev": -1}
    init_all = " ".join(f"v.{n} = {special.get(n, 0)};" for n in names)
    entity = {
        "format_version": "1.10.0",
        "minecraft:client_entity": {"description": {
            "identifier": f"{NS}:{NS}",
            "materials": {"default": "entity_alphatest", "glow": "warden_bioluminescent_layer"},
            "textures": {**{t: f"textures/entity/{NS}/{NS}_{t}" for t in ("i", "ii", "iii")},
                         **{f"{t}_glow": f"textures/entity/{NS}/{NS}_{t}_glow" for t in ("i", "ii", "iii")}},
            "geometry": {t: f"geometry.{NS}.{t}" for t in ("i", "ii", "iii")},
            "scripts": {
                "initialize": [init_all],
                "pre_animation": pre_all + pre_form,
                "animate": [{f"pose_{t}": f"v.form == {i}"} for i, t in enumerate(("i", "ii", "iii"), start=1)]
                           + [{f"fx_{t}": f"v.form == {i} && {P('bound')}"} for i, t in enumerate(("i", "ii", "iii"), start=1)],
                "should_update_bones_and_effects_offscreen": "1.0",
                "should_update_effects_offscreen": "1.0",
            },
            "animations": {**{f"pose_{t}": f"animation.{NS}.{t}.pose" for t in ("i", "ii", "iii")},
                           **{f"fx_{t}": f"controller.animation.{NS}.{t}.fx" for t in ("i", "ii", "iii")}},
            "particle_effects": {n: f"{NS}:{n}" for n in PARTICLES},
            "render_controllers": glow_list,
            "enable_attachables": False,
            "hide_armor": True,
        }}}
    os.makedirs(os.path.join(RP, "entity"), exist_ok=True)
    kit.write_json(os.path.join(RP, "entity", f"{NS}.entity.json"), entity)
    os.makedirs(os.path.join(RP, "render_controllers"), exist_ok=True)
    kit.write_json(os.path.join(RP, "render_controllers", f"{NS}.render_controllers.json"), rc)
    os.makedirs(os.path.join(RP, "animations"), exist_ok=True)
    kit.write_json(os.path.join(RP, "animations", f"{NS}.animation.json"), {"format_version": "1.8.0", "animations": anims})
    os.makedirs(os.path.join(RP, "animation_controllers"), exist_ok=True)
    kit.write_json(os.path.join(RP, "animation_controllers", f"{NS}.animation_controllers.json"), {
        "format_version": "1.10.0",
        "animation_controllers": {f"controller.animation.{NS}.{t}.fx": particle_controller(t) for t in ("i", "ii", "iii")}})

    # the invisible hit-volume helper
    kit.write_json(os.path.join(RP, "entity", f"{NS}_hitbox.entity.json"), {
        "format_version": "1.10.0",
        "minecraft:client_entity": {"description": {
            "identifier": f"{NS}:hitbox", "materials": {"default": "entity_alphatest"},
            "textures": {"default": f"textures/entity/{NS}/{NS}_i"}, "geometry": {"default": f"geometry.{NS}.none"},
            "render_controllers": [f"controller.render.{NS}.none"]}}})
    rc["render_controllers"][f"controller.render.{NS}.none"] = {
        "geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"],
        "part_visibility": [{"*": False}]}
    kit.write_json(os.path.join(RP, "render_controllers", f"{NS}.render_controllers.json"), rc)
    kit.write_json(os.path.join(RP, "models", "entity", f"{NS}_none.geo.json"), {
        "format_version": "1.21.0", "minecraft:geometry": [{"description": {
            "identifier": f"geometry.{NS}.none", "texture_width": 16, "texture_height": 16, "visible_bounds_width": 1,
            "visible_bounds_height": 1, "visible_bounds_offset": [0, 0.5, 0]}, "bones": [{"name": "root", "pivot": [0, 0, 0]}]}]})

    # shared with the server rig and the Blockbench projects
    kit.write_json(os.path.join(OUT, "pose.json"), {"look": LOOK, "phase": PHASE, "knock_gap": KNOCK_GAP, "gait_dur": GAIT_DUR,
                                                    "stride_iii": STRIDE_III})
    for tag in ("i", "ii", "iii"):
        a = anims[f"animation.{NS}.{tag}.pose"]
        kit.write_json(os.path.join(OUT, f"bb_anims_{tag}.json"), {f"animation.{NS}.{tag}.pose": a})
    write_rig_ts(rigs)
    n_terms = sum(len(json.dumps(a)) for a in anims.values())
    print(f"client entity: {len(pre_all + pre_form)} pre-animation statements, {len(glow_list)} glow passes, "
          f"{len(anims)} pose animations ({n_terms // 1024} KiB of Molang)")


if __name__ == "__main__":
    main()
