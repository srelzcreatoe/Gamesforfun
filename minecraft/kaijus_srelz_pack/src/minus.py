"""Godzilla Minus One (and, with variant="zero", the larger Minus Zero).

~37 blocks to the crown.  Built like the film's creature: an upright,
forward-leaning mass of muscle on colossal thighs, a deep chest and a thick
ringed neck carrying a small heavy-browed head, real arms with four clawed
fingers, a thick tail lying low with its end turned up, and three rows of
tall jagged dorsal fins.  Every centre fin (with the two that flank it) sits
on its own bone so the fins can thrust out of the back one after another,
from the tip of the tail to the nape, as the heat ray charges.
"""
import math
import numpy as np
from geo import Model, Path, V, unit, rot_about, world_point
from atlas import REGIONS, SIZE
from parts import claw, tooth, limb, dir_yp
from form4 import ob, swept

TAIL_N = 14
# per-joint bend of the tail at rest: down off the hips, along the ground, the end turned up
TAIL_REST = [-22, -6, 6, 10, 8, 3, 1, 0, 1, 2, 3, 4, 6, 8]
TAIL_BASE = (0, 12.6, 6.2)
X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)

# centre line of the trunk, pelvis -> skull joint: (pos, half-width, half-depth)
SPINE = [
    ((0, 9.6, 3.4), 4.6, 4.4),
    ((0, 11.4, 3.0), 5.9, 5.9),
    ((0, 13.4, 2.5), 6.4, 6.6),
    ((0, 15.4, 2.0), 6.2, 6.5),     # 3: hips | torso
    ((0, 17.4, 1.4), 5.8, 6.1),
    ((0, 19.4, 0.8), 5.9, 5.9),
    ((0, 21.4, 0.1), 6.6, 6.1),     # 6: torso | chest
    ((0, 23.4, -0.7), 7.5, 6.5),
    ((0, 25.4, -1.6), 7.6, 6.4),
    ((0, 27.2, -2.6), 6.6, 5.8),
    ((0, 28.8, -3.6), 5.2, 5.1),    # 10: chest | neck1
    ((0, 30.3, -4.6), 4.5, 4.6),
    ((0, 31.8, -5.5), 4.1, 4.2),
    ((0, 33.2, -6.3), 3.8, 3.8),    # 13: neck1 | neck2
    ((0, 34.4, -6.9), 3.5, 3.45),
    ((0, 35.5, -7.3), 3.3, 3.15),   # 15: skull joint
]
HEAD_AT, HEAD_K = (0, 35.5, -7.3), 0.92
MOUTH = tuple(HEAD_AT[i] + ((0, 35.0, -15.2)[i] - HEAD_AT[i]) * HEAD_K for i in range(3))
FIN_OUT = 0.32          # how far a fin thrusts out when it rises, as a share of its height


def tail_joints():
    pts = [V(TAIL_BASE)]
    ang = 0.0
    for i in range(TAIL_N):
        ang += TAIL_REST[i]
        L = 4.7 - 0.13 * i
        a = math.radians(ang)
        pts.append(pts[-1] + V(0, math.sin(a) * L, math.cos(a) * L))
    return pts


def tail_radius(t):
    return 4.7 * (1 - t) ** 0.9 + 0.5, 4.5 * (1 - t) ** 0.9 + 0.48


def bone_for_u(u):
    return "hips" if u < 3 else "torso" if u < 6 else "chest" if u < 10 else "neck1" if u < 13 else "neck2"


def fin(m, bone, base, up, fwd, h, w, sink=0.0, rake=-1):
    """One dorsal fin, shaped like a flame or a maple leaf: a short blade at the root that splits
    into a tall spire and long thin points fanning out fore and aft of it, all of them leaning
    toward the tail.  It is rooted `sink` below `base` so it can thrust out without leaving the
    body.  rake: -1 where `fwd` points at the head (the back), +1 where it points at the tail tip."""
    rng = m.rng
    U, F = unit(up), unit(fwd)
    F = unit(F - np.dot(F, U) * U)
    W = unit(np.cross(U, F))
    th = max(0.3, 0.075 * w)
    root = V(base) - U * sink
    if not hasattr(m, "plate_tips"):
        m.plate_tips = []
    m.plate_tips.append((bone, tuple(V(base) + U * h * 0.9), h))
    m.obox(bone, root + U * (sink + 0.2 * h) * 0.5, (th * 2.2, sink + 0.2 * h, w * 0.92), (W, U, F), "plate_base")
    FR = {2: (0.58, 0.46), 3: (0.44, 0.33, 0.27), 4: (0.36, 0.27, 0.22, 0.19)}
    WK = {2: (1.0, 0.4), 3: (1.0, 0.56, 0.22), 4: (1.0, 0.62, 0.34, 0.13)}

    def spike(p, d, ln, wd, mats, kink):
        n = len(mats)
        for j in range(n):
            if j:
                d = rot_about(d, W, kink)
            sl = ln * FR[n][j]
            m.obox(bone, p + d * sl * 0.5, (th * (1 - 0.2 * j), sl * 1.08, wd * WK[n][j]), (W, d, np.cross(W, d)), mats[j])
            p = p + d * sl
    lean = rot_about(U, W, rake * rng.uniform(5, 14))
    big = h >= 5.5
    spike(root, lean, h + sink, w * 0.42, ("plate_web", "plate_web", "plate", "plate_tip") if big else ("plate_web", "plate", "plate_tip"),
          rake * rng.uniform(2, 7))
    # (where along the root, angle off the spire, length): + is toward the tail
    if big:
        pts = [(0.2, 20, 0.74), (-0.2, -22, 0.6), (0.5, 44, 0.56), (-0.5, -46, 0.44), (0.8, 70, 0.36), (-0.8, -72, 0.28)]
    elif h >= 2.6:
        pts = [(0.3, 26, 0.68), (-0.3, -26, 0.56), (0.7, 54, 0.42), (-0.7, -56, 0.34)]
    else:
        pts = [(0.35, 30, 0.62), (-0.35, -30, 0.5)]
    for off, ang, lf in pts:
        d = rot_about(lean, W, rake * (ang + rng.uniform(-7, 7)))
        q = root + F * rake * off * w * 0.5 + U * (sink + h * 0.1)
        ln = h * lf * rng.uniform(0.88, 1.12)
        spike(q, d, ln, w * 0.21, ("plate_web", "plate", "plate_tip") if ln > 3.4 else ("plate", "plate_tip"), rake * rng.uniform(-4, 9))


def shingles(m, bone, path, us, mat="skin2", size=(2.6, 0.55, 1.7), side=0, tilt=20.0, phis=None):
    """Rows of raised, overlapping scale ridges lapping round a limb (the outer half only when
    `side` is +1/-1): the armoured look of his thighs and shins."""
    for r, u in enumerate(us):
        c = path.at(u)[0]
        for j in range(len(phis) if phis else 8):
            phi = (phis[j] + (9 if r % 2 else -9)) if phis else j * 45 + (22.5 if r % 2 else 0)
            p, nrm, d = path.surface(u, phi, out=-0.1)
            if side and (p[0] - c[0]) * side < -0.8:
                continue
            around = unit(np.cross(d, nrm))
            n2, d2 = rot_about(nrm, around, tilt), rot_about(d, around, tilt)
            k = m.rng.uniform(0.85, 1.15)
            m.obox(bone, p + n2 * size[1] * 0.2, (size[0] * k, size[1], size[2] * k), (around, n2, d2), mat)


def build_head(m, rng):
    """The Minus One head, after the film's close-ups.  A broad domed cranium crusted with knobs of
    scale that stand up into a ragged crown; a face that looks forward: small amber eyes set on
    the front of the skull either side of the muzzle, each sunk in a dark hollow under a heavy
    brow that slants down toward the nose; a deep, blunt, narrower muzzle; a mouth cut back past
    the eyes, crowded with long uneven teeth; plated cheeks and one deep lower jaw."""
    head = "head"
    cran = Path([((0, 37.0, -6.6), 3.2, 2.2), ((0, 37.05, -8.3), 3.42, 2.25), ((0, 36.95, -10.0), 3.36, 2.15),
                 ((0, 36.8, -11.4), 3.15, 2.0)], hint=(0, 1, 0))
    muz = Path([((0, 36.3, -11.2), 2.36, 1.5), ((0, 36.26, -12.4), 2.3, 1.46), ((0, 36.22, -13.6), 2.2, 1.42),
                ((0, 36.2, -14.7), 2.05, 1.4)], hint=(0, 1, 0))
    m.loft(head, cran, sleeve="skull", frange=(0.0, 0.58), wobble=0.012, overlap=0.1, caps="head")
    m.loft(head, muz, sleeve="skull", frange=(0.58, 1.0), wobble=0.012, overlap=0.1, caps="head")
    m.section(head, V(0, 36.12, -15.1), 0.9, 1.8, 1.24, (X, Y, Z), "head")                           # blunt, rounded nose
    ob(m, head, (0, 37.55, -14.2), (2.6, 0.55, 1.7), "head", pitch=-8)                                # the swell over the nostrils
    ob(m, head, (0, 37.75, -12.6), (1.5, 0.6, 2.2), "head", pitch=-14)                                # bridge of the nose, up to the brows
    # the crown: knobs of scale over the whole top and back of the head, the biggest at the back
    m.nodules(head, cran, 13, (0.05, 2.5), [(26, 88)], size=(0.8, 1.35), mat="skin2", elong=(1.0, 1.35), along=False, sink=0.3, twist=20)
    m.nodules(head, cran, 5, (2.3, 3.0), [(52, 88)], size=(0.55, 0.9), mat="skin2", elong=(1.0, 1.3), along=False, sink=0.35, twist=20)
    m.nodules(head, muz, 5, (0.6, 2.9), [(56, 88)], size=(0.4, 0.62), mat="skin2", elong=(1.0, 1.3), along=False, sink=0.4, twist=20)
    for u, phi, hh in ((0.25, 90, 1.15), (0.3, 60, 1.0), (0.3, 120, 1.0), (0.35, 32, 0.9), (0.35, 148, 0.9), (0.4, 6, 0.8), (0.4, 174, 0.8),
                       (1.1, 90, 1.0), (1.15, 56, 0.9), (1.15, 124, 0.9), (1.2, 24, 0.8), (1.2, 156, 0.8),
                       (1.95, 90, 0.85), (2.0, 60, 0.8), (2.0, 120, 0.8), (2.1, 30, 0.7), (2.1, 150, 0.7), (2.75, 74, 0.7), (2.75, 106, 0.7)):
        q, nrm, d = cran.surface(u, phi, out=-0.15)                                                   # the pointed ones, leaning back
        up = unit(nrm - d * 0.45)
        ax = unit(np.cross(up, d))
        az = unit(np.cross(ax, up))
        m.obox(head, q + up * hh * 0.32, (0.85, hh * 0.75, 0.85), (ax, up, az), "skin2")
        m.obox(head, q + up * hh * 0.82, (0.48, hh * 0.5, 0.48), (ax, up, az), "skin2")
    m.obox(head, (0, 34.85, -9.6), (5.3, 0.26, 4.4), (X, Y, Z), "mouth")                              # palate (rear)
    m.obox(head, (0, 34.85, -13.0), (4.0, 0.26, 3.6), (X, Y, Z), "mouth")                             # palate (front)
    m.obox(head, (0, 34.0, -7.9), (4.8, 2.1, 0.6), (X, Y, Z), "mouth")                                # back of the throat
    for s in (1, -1):
        # the eye looks forward and a little out, from the front corner of the cranium beside the muzzle
        f = dir_yp(-s * 52, 0)
        lx_ = unit(np.cross(Y, f))
        out = -lx_ * s
        c0 = V(s * 2.0, 37.54, -11.55)
        m.obox(head, c0 - out * 0.3, (0.9, 1.0, 1.55), (lx_, Y, f), "socket")                         # the dark hollow it sits in
        m.obox(head, c0 + out * 0.17 + V(0, -0.04, 0), (0.08, 0.54, 0.8), (lx_, Y, f), "eye")
        # the brow: a heavy ridge over the eye, high at the temple and slanting down toward the nose
        ob(m, head, tuple(c0 + V(0, 0.86, 0) + out * 0.32 + f * 0.5), (1.4, 0.9, 2.3), "head", yaw=-s * 52, pitch=-18)
        ob(m, head, (s * 2.95, 38.45, -11.25), (1.0, 0.7, 1.1), "skin2", yaw=-s * 30, pitch=-8)                         # knot of scale at the temple
        ob(m, head, (s * 2.95, 36.6, -11.35), (0.9, 1.0, 0.8), "head", yaw=-s * 30)                                     # the corner of the face below and beside the eye
        ob(m, head, (s * 1.15, 37.85, -12.7), (1.0, 0.6, 1.5), "head", yaw=-s * 26, pitch=-20)                          # the brow running into the nose
        ob(m, head, tuple(c0 + V(0, -0.78, 0) + out * 0.15 + f * 0.45), (0.9, 0.5, 1.9), "head", yaw=-s * 52)           # cheekbone under the eye
        # plated cheek: scales fanning back from the corner of the mouth
        for (dy, dz, sc) in ((0.3, -7.4, 1.0), (0.45, -8.7, 0.95), (-0.5, -8.0, 0.95), (-0.35, -9.3, 0.85), (-1.1, -8.7, 0.8), (1.2, -8.1, 0.8), (1.25, -9.6, 0.7)):
            ob(m, head, (s * 3.35, 36.2 + dy, dz), (0.5, 0.9 * sc, 1.3 * sc), "skin2", yaw=s * 6, pitch=20, roll=-s * 6)
        ob(m, head, (s * 3.0, 35.45, -8.3), (1.4, 2.3, 2.6), "head", yaw=s * 4)                                         # jaw muscle
        ob(m, head, (s * 0.85, 37.2, -15.35), (0.55, 0.36, 0.45), "socket", yaw=s * 24)                                 # nostril
        lb, lf = V(s * 3.02, 34.95, -9.3), V(s * 1.72, 34.9, -15.2)
        ld = unit(lf - lb)
        ll = float(np.linalg.norm(lf - lb))
        lx = unit(np.cross(Y, ld))
        m.obox(head, (lb + lf) / 2 + V(0, 0.14, 0), (0.62, 0.74, ll), (lx, Y, ld), "head")                              # thick upper lip
        m.obox(head, (lb + lf) / 2 + V(-s * 0.16, -0.3, 0), (0.36, 0.3, ll * 0.98), (lx, Y, ld), "gum")
        n = 11
        for i in range(n):                                                                                              # long uneven teeth, longest at the front
            f_ = 0.05 + 0.92 * (i + 0.5) / n
            q = lb + (lf - lb) * f_ + V(-s * 0.12, -0.36, 0)
            ln = (0.5 + 0.55 * f_ ** 1.5) * rng.uniform(0.72, 1.2)
            tooth(m, head, q, V(s * 0.1, -1, 0.05 + 0.12 * f_), ln, 0.3, lateral=ld, segs=3 if ln > 0.72 else 2)
    m.obox(head, (0, 34.98, -15.35), (3.5, 0.7, 0.44), (X, Y, Z), "head")                              # front lip
    for i, x in enumerate((-1.42, -1.02, -0.6, -0.2, 0.2, 0.6, 1.02, 1.42)):                          # fangs across the front, no two alike
        tooth(m, head, V(x, 34.62, -15.35), V(x * 0.1 + rng.uniform(-0.08, 0.08), -1, -0.14), rng.uniform(0.62, 1.15), 0.26, lateral=X, segs=3)

    jaw = m.bone("jaw", head, (0, 34.6, -8.3), (5, 0, 0))
    for s in (1, -1):
        jp = Path([((s * 2.65, 33.9, -8.4), 1.05, 1.15), ((s * 2.5, 33.7, -10.6), 1.0, 1.05),
                   ((s * 2.05, 33.6, -12.8), 0.95, 0.94), ((s * 1.25, 33.64, -14.8), 0.9, 0.84)], hint=(0, 1, 0))
        m.loft(jaw, jp, mat="head", wobble=0.01, overlap=0.16)
        n = 9
        for i in range(n):
            u = 0.75 + 2.2 * (i + 0.5) / n
            c, a, b, (l, t, d) = jp.at(u)
            q = c + V(s * a * 0.3, b * 0.8, 0)
            ln = (0.45 + 0.4 * ((i + 0.5) / n) ** 1.5) * rng.uniform(0.75, 1.2)
            tooth(m, jaw, q, V(s * 0.08, 1, 0.03), ln, 0.28, lateral=d, segs=3 if ln > 0.68 else 2)
    m.obox(jaw, (0, 33.5, -15.05), (2.7, 1.5, 1.1), (X, Y, Z), "head")                                # square chin
    m.obox(jaw, (0, 33.86, -10.2), (4.9, 0.28, 3.8), (X, Y, Z), "mouth")                              # mouth floor (rear)
    m.obox(jaw, (0, 33.84, -13.1), (3.7, 0.28, 3.3), (X, Y, Z), "mouth")                              # mouth floor (front)
    m.obox(jaw, (0, 34.12, -11.7), (2.1, 0.4, 4.6), (X, Y, Z), "gum")                                 # tongue
    m.obox(jaw, (0, 33.0, -10.6), (4.6, 1.2, 5.2), (X, Y, Z), "skin2")                                # under the jaw
    for x in (-1.0, -0.6, -0.2, 0.2, 0.6, 1.0):
        tooth(m, jaw, V(x, 34.25, -15.15), V(x * 0.06 + rng.uniform(-0.06, 0.06), 1, -0.1), rng.uniform(0.5, 0.9), 0.24, lateral=X, segs=3)
    return cran


def build(seed=5, variant="one"):
    zero = variant == "zero"
    ident = "geometry.sg.godzilla_minus_zero" if zero else "geometry.sg.godzilla_minus_one"
    m = Model(ident, SIZE, REGIONS, k=0.5, seed=seed + (3 if zero else 0))
    rng = m.rng
    m.plate_tips = []
    m.fins = []                 # (bone, parent, out direction, travel in blocks), tail tip -> nape
    fk = 1.25 if zero else 1.0  # fin size

    m.bone("root", None, (0, 0, 0))
    m.bone("body", "root", (0, 13.4, 2.5))
    m.bone("hips", "body", (0, 13.4, 2.5))
    m.bone("torso", "body", (0, 15.4, 2.0))
    m.bone("chest", "torso", (0, 21.4, 0.1))
    m.bone("neck1", "chest", (0, 28.8, -3.6))
    m.bone("neck2", "neck1", (0, 33.2, -6.3))
    m.bone("head", "neck2", (0, 35.5, -7.3))

    # ------------------------------------------------------------- trunk
    spine = Path(SPINE, hint=(0, 0, 1))
    m.loft("hips", spine, 0, 3, sleeve="trunk", wobble=0.02, caps="skin2")
    m.loft("torso", spine, 3, 6, sleeve="trunk", wobble=0.022)
    m.loft("chest", spine, 6, 10, sleeve="trunk", wobble=0.022)
    m.loft("neck1", spine, 10, 13, sleeve="trunk", wobble=0.03, sub=2)
    m.loft("neck2", spine, 13, 15, sleeve="trunk", wobble=0.03, sub=2)
    # the neck is a stack of heavy folds
    for u in (10.5, 11.2, 11.9, 12.6, 13.3, 13.9, 14.5):
        c, a, b, fr = spine.at(u)
        m.section(bone_for_u(u), c, 0.5, a * 1.08, b * 1.06, fr, "skin2")
    side_phis = (-48, -14, 22, 158, 194, 228)
    shingles(m, "neck1", spine, (10.5, 11.3, 12.1, 12.8), size=(2.5, 0.6, 2.1), tilt=-22, phis=side_phis)
    shingles(m, "neck2", spine, (13.5, 14.2), size=(2.1, 0.55, 1.8), tilt=-22, phis=side_phis)
    for s in (1, -1):
        p, nrm, d = spine.surface(8.1, -90, out=-0.5)               # slabs of pectoral muscle
        m.section("chest", p + V(s * 3.3, 0.1, -0.3), 3.5, 2.9, 1.7, (X, Y, Z), "skin")
        p, nrm, d = spine.surface(9.2, -90 + s * 64, out=-0.6)      # shoulder mass, plated
        m.section("chest", p, 4.0, 3.1, 2.9, (X, Y, Z), "skin")
        for du, hh in ((8.7, 1.5), (9.4, 1.9), (10.0, 1.3)):        # spurs standing off the shoulder
            q = spine.surface(du, 0 if s > 0 else 180, out=1.2)[0]
            ob(m, "chest", q + V(0, 1.6, 0.4), (0.7, hh, 1.1), "skin2", yaw=s * 20, pitch=20, roll=-s * 30)
    # the chest: broad scales lapping down over one another in a V, like roof tiles
    for r, u in enumerate((6.5, 7.2, 7.9, 8.6, 9.3, 9.9)):
        for phi in ((-126, -102, -78, -54) if r % 2 else (-138, -114, -90, -66, -42)):
            p, nrm, d = spine.surface(u, phi, out=-0.15)
            around = unit(np.cross(d, nrm))
            n2, d2 = rot_about(nrm, around, -20), rot_about(d, around, -20)
            k = rng.uniform(0.9, 1.15)
            m.obox("chest", p + n2 * 0.2, (2.7 * k, 0.6, 2.1 * k), (around, n2, d2), "skin")
    for u in (3.5, 4.4, 5.3, 6.2):                                  # the ridged plates of the belly
        p, nrm, d = spine.surface(u, -90, out=0.05)
        a = spine.at(u)[1]
        m.obox("torso" if u < 6 else "chest", p, (a * 1.25, 1.05, 0.7), (X, d, nrm), "skin2")
    # raised scales over the back and flanks: a rough, rocky outline
    for bone, (u0, u1), n in (("hips", (0.4, 3.0), 9), ("torso", (3.0, 6.0), 9), ("chest", (6.0, 9.8), 11), ("neck1", (10.2, 12.9), 5)):
        m.nodules(bone, spine, n, (u0, u1), [(-25, 62)], size=(1.0, 1.8), mat="skin2", elong=(1.0, 1.7), along=False, sink=0.5, twist=18)

    # ------------------------------------------------------------- legs
    for side, s in (("L", 1), ("R", -1)):
        thigh = m.bone("thigh_" + side, "root", (s * 5.0, 14.4, 2.0))
        tp = Path([((s * 4.8, 16.4, 2.4), 3.5, 4.7), ((s * 5.7, 13.8, 1.6), 4.6, 6.2), ((s * 6.2, 11.0, 0.4), 4.7, 6.2),
                   ((s * 6.0, 8.6, -1.0), 3.9, 4.9), ((s * 5.7, 7.0, -1.8), 3.0, 3.7)], hint=(0, 0, -1))
        m.loft(thigh, tp, sleeve="thigh", wobble=0.02, caps="skin2")
        shingles(m, thigh, tp, (0.7, 1.35, 2.0, 2.65, 3.3), size=(3.0, 0.6, 2.0), side=s)       # layered ridges round the thigh
        m.section(thigh, V(s * 5.6, 7.4, -3.3), 2.2, 2.0, 1.5, (X, Y, Z), "skin2")  # knee cap
        if zero:                                                                    # bony growths down the thigh
            for u, hh in ((1.2, 1.6), (2.0, 1.9), (2.8, 1.4)):
                p, nrm, d = tp.surface(u, 90 - s * 60, out=-0.2)
                fin(m, thigh, p, nrm, d, hh, hh * 0.9)

        shin = m.bone("shin_" + side, thigh, (s * 5.6, 7.3, -1.5))
        sp = Path([((s * 5.6, 7.6, -1.7), 2.9, 3.5), ((s * 5.5, 5.8, -0.7), 2.7, 3.1), ((s * 5.4, 4.1, 0.4), 2.5, 2.7),
                   ((s * 5.3, 2.6, 1.3), 2.3, 2.4)], hint=(0, 0, -1))
        m.loft(shin, sp, sleeve="shin", wobble=0.03, caps="skin2")
        shingles(m, shin, sp, (0.6, 1.4, 2.2), size=(1.9, 0.45, 1.3), side=0)

        foot = m.bone("foot_" + side, shin, (s * 5.3, 2.5, 1.2))
        fp = Path([((s * 5.3, 2.4, 1.5), 2.5, 1.9), ((s * 5.3, 1.7, -0.7), 2.9, 1.6), ((s * 5.3, 1.2, -2.8), 3.1, 1.2)], hint=(0, 1, 0))
        m.loft(foot, fp, sleeve="foot", wobble=0.02, caps="skin2")
        m.section(foot, V(s * 5.3, 1.1, 2.4), 2.5, 1.8, 1.1, (X, Y, Z), "skin2")     # heel pad
        claw(m, foot, V(s * 5.3 - s * 1.6, 1.0, 1.4), V(-s * 0.9, 0.1, 0.5), V(0, -1, 0), 1.6, 0.8, curve=22)   # dew claw

        toes = m.bone("toes_" + side, foot, (s * 5.3, 0.9, -3.0))
        for off, yaw in ((-2.0, -20), (0.0, 0), (2.0, 20)):
            f = dir_yp(yaw, 0)
            p0 = V(s * 5.3 + off, 0.85, -2.5)
            p1 = p0 + f * 2.6
            limb(m, toes, p0, p1, 0.95, 0.8, "skin2", shape="oct", hint=(0, 1, 0))
            m.obox(toes, p0 + f * 1.2 + V(0, 0.62, 0), (1.25, 0.56, 1.1), (unit(np.cross(Y, f)), Y, f), "skin2")
            claw(m, toes, p1 - f * 0.15 + V(0, 0.08, 0), f, V(0, -1, 0), 2.6, 1.0, curve=20)

    # ------------------------------------------------------------- arms
    # Real arms, and big ones: a heavy plated shoulder, the upper arm hanging down and out, a
    # thick forearm reaching forward, and a broad hand held open, four long fingers ending in
    # pale hooked claws.
    for side, s in (("L", 1), ("R", -1)):
        sh = V(s * 6.9, 25.7, -2.4)
        el = V(s * 9.3, 20.3, -1.4)
        wr = V(s * 8.3, 18.5, -7.6)
        arm = m.bone("arm_" + side, "chest", tuple(sh))
        m.section(arm, sh + V(s * 0.2, 0.3, 0.3), 4.0, 3.0, 2.9, (X, Y, Z), "skin")           # shoulder
        limb(m, arm, sh, el, 2.55, 2.05, "skin", shape="oct")
        ob(m, arm, (sh + el) / 2 + V(s * 1.8, 0.5, -0.2), (0.9, 3.6, 2.8), "skin2", roll=-s * 22)       # the bulge of the upper arm
        for j_, (dy, hh) in enumerate(((1.9, 1.5), (0.9, 1.9), (-0.2, 1.4))):                 # jagged scales standing off the shoulder
            ob(m, arm, sh + V(s * 2.6, dy, 0.9 - 0.9 * j_), (0.6, hh, 1.2), "skin2", yaw=s * 20, pitch=24, roll=-s * 52)
        fore = m.bone("forearm_" + side, arm, tuple(el))
        m.section(fore, el, 2.6, 2.1, 2.1, (X, Y, Z), "skin2")                                # elbow
        limb(m, fore, el, wr, 2.0, 1.5, "skin", shape="oct")
        for j_ in range(4):                                                                   # ragged scales down the back of the forearm
            q = el + (wr - el) * (0.15 + 0.22 * j_)
            ob(m, fore, q + V(s * 1.5, -0.1, 0.3), (0.5, 1.7 - 0.3 * j_, 1.2), "skin2", yaw=s * 20, pitch=-40)
        hand = m.bone("hand_" + side, fore, tuple(wr))
        pn = unit(V(-s * 0.5, -0.8, -0.15))         # palm faces down and inward
        fw = unit(V(-s * 0.12, -0.25, -1))
        fw = unit(fw - np.dot(fw, pn) * pn)
        lat = np.cross(pn, fw)
        m.obox(hand, wr + fw * 0.3, (2.8, 1.7, 1.6), (lat, pn, fw), "skin2")                        # wrist
        m.obox(hand, wr + fw * 1.7, (3.5, 1.3, 2.7), (lat, pn, fw), "skin")                         # palm
        # (splay angle, length, where it leaves the palm); the first is the thumb
        for a, ln, off in ((-60, 2.5, -1.5), (-17, 3.5, -1.05), (5, 3.8, 0.05), (27, 3.3, 1.15)):
            f1 = rot_about(fw, pn, a)
            p = wr + fw * (1.9 if a < -40 else 2.9) + lat * off
            ax = unit(np.cross(f1, pn))
            d1, d2 = rot_about(f1, ax, -12), rot_about(f1, ax, -40)
            limb(m, hand, p, p + d1 * ln * 0.55, 0.62, 0.52, "skin2", shape="box", hint=tuple(pn))
            q = p + d1 * ln * 0.52
            limb(m, hand, q, q + d2 * ln * 0.45, 0.5, 0.42, "skin2", shape="box", hint=tuple(pn))
            claw(m, hand, q + d2 * ln * 0.42, d2, pn, 2.3, 0.6, curve=20, segs=3)
        m.hand = getattr(m, "hand", {})
        m.hand[side] = tuple(wr + fw * 3.4)

    build_head(m, rng)
    m.scale_bones(["head", "jaw"], HEAD_AT, HEAD_K)       # a small head on a thick neck

    # ------------------------------------------------------------- tail, and the fins along it
    J = tail_joints()
    lens = [float(np.linalg.norm(J[i + 1] - J[i])) for i in range(TAIL_N)]
    total = sum(lens)
    acc = 0.0
    parent = "hips"
    tail_fins = []
    for i in range(TAIL_N):
        t0, t1 = i / TAIL_N, (i + 1) / TAIL_N
        a0, b0 = tail_radius(t0)
        a1, b1 = tail_radius(t1)
        name = m.bone("tail%d" % i, parent, tuple(J[i]))
        tp = Path([(J[i], a0, b0), ((J[i] + J[i + 1]) / 2, (a0 + a1) / 2, (b0 + b1) / 2), (J[i + 1], a1, b1)], hint=(0, 1, 0))
        m.loft(name, tp, sleeve="tail", frange=(acc / total, (acc + lens[i]) / total), wobble=0.035, overlap=0.2,
               caps="skin2" if i == TAIL_N - 1 else None)
        acc += lens[i]
        tail_fins.append((i, name, tp))
        if i < 11:                                                 # scales standing out along the flanks of the tail
            m.nodules(name, tp, 3, (0.2, 1.8), [(-20, 55)], size=(0.5 * a0 / 2.2, 0.8 * a0 / 2.2), mat="skin2", elong=(1.0, 1.6), along=False, sink=0.5, twist=15)
        parent = name
    e = J[-1]
    d = unit(J[-1] - J[-2])
    m.section("tail%d" % (TAIL_N - 1), e + d * 0.5, 1.2, 0.5, 0.48, (X, np.cross(d, X), d), "skin2")   # blunt tip

    def fin_group(parent, centre, flank, h, sweep=22, rake=-1):
        """A centre fin with the fins that flank it, on a bone of their own so they can rise together."""
        p, nrm, dd = centre
        up = swept(nrm, dd, sweep)
        travel = h * FIN_OUT
        b = m.bone("fin%d" % len(m.fins), parent, tuple(p))
        m.fins.append((b, parent, tuple(float(c) for c in unit(up)), travel, tuple(float(c) for c in (p + unit(up) * h * 0.9)), h))
        fin(m, b, p, up, dd, h, h * 0.8, sink=travel + 0.4, rake=rake)
        for (fp_, fn, fd), hk in flank:
            fin(m, b, fp_, swept(fn, fd, sweep), fd, h * hk, h * hk * 0.78, sink=travel + 0.4, rake=rake)

    # tail fins, from the tip forward (the order they rise in)
    for i, name, tp in reversed(tail_fins):
        t = i / TAIL_N
        h = (4.6 * (1 - t) ** 0.85 + 1.3 + (1.3 if i in (10, 11) else 0)) * fk * rng.uniform(0.92, 1.08)
        flank = []
        if i < 11:
            for phi in (58, 122):
                flank.append((tp.surface(0.6, phi, out=-0.25), 0.55 * rng.uniform(0.85, 1.1)))
        if i < 6:
            for phi in (34, 146):
                flank.append((tp.surface(1.5, phi, out=-0.25), 0.34 * rng.uniform(0.85, 1.1)))
        fin_group(name, tp.surface(1.1, 90, out=-0.3), flank, h, sweep=26, rake=1)
        if i < 12:                                                # a smaller fin between each pair of big ones
            p, nrm, dd = tp.surface(0.25, 90, out=-0.25)
            fin(m, "fin%d" % (len(m.fins) - 1), p, swept(nrm, dd, 26), dd, h * 0.5, h * 0.42, sink=h * FIN_OUT + 0.4, rake=1)

    # the great fins of the back: tallest behind the shoulders, where one spike stands above the head
    def h_of(u):
        return 4.6 + 11.2 * math.exp(-((u - 8.7) / 2.3) ** 2) if u <= 10.5 else max(2.0, 9.6 - (u - 10.5) * 3.0)
    u = 0.9
    while u < 13.4:
        h = h_of(u) * fk * rng.uniform(0.92, 1.08)
        flank = []
        for phi in (60, 120):
            flank.append((spine.surface(u + rng.uniform(-0.15, 0.15), phi, out=-0.3), 0.6 * rng.uniform(0.88, 1.08)))
        if u < 10.5:
            for phi in (34, 146):
                flank.append((spine.surface(u + 0.45, phi, out=-0.3), 0.36 * rng.uniform(0.85, 1.1)))
        sw = 24 + 26 * math.exp(-((u - 9.0) / 3.2) ** 2)           # the big ones stand up; the rest lie back
        fin_group(bone_for_u(u), spine.surface(u, 90, out=-0.35), flank, h, sweep=sw)
        p, nrm, dd = spine.surface(u + 0.5, 90, out=-0.3)
        fin(m, "fin%d" % (len(m.fins) - 1), p, swept(nrm, dd, sw), dd, h * 0.5, h * 0.42, sink=h * FIN_OUT + 0.4)
        u += 1.05
    for u in (13.9, 14.6):                                        # little spines up the nape (fixed)
        p, nrm, dd = spine.surface(u, 90, out=-0.2)
        fin(m, "neck2", p, swept(nrm, dd, 20), dd, (1.7 - (u - 13.9) * 0.8) * fk, 0.9)
    if zero:                                                      # Minus Zero: spurs on the shoulders and elbows
        for s in (1, -1):
            for u, phi, hh in ((8.8, 90 - s * 78, 2.6), (9.6, 90 - s * 70, 2.0), (7.6, 90 - s * 84, 1.8)):
                p, nrm, dd = spine.surface(u, phi, out=0.9)
                fin(m, "chest", p, nrm, dd, hh, hh * 0.8)

    m.tail_tip = tuple(e + d * 1.0)
    m.tail_pre = tuple(e - d * 2.0)
    if zero:
        k = 1.1
        m.scale_all(k)
        m.plate_tips = [(b, tuple(c * k for c in p), h * k) for (b, p, h) in m.plate_tips]
        m.fins = [(b, par, up, tr * k, tuple(c * k for c in tip), h * k) for (b, par, up, tr, tip, h) in m.fins]
        m.hand = {sd: tuple(c * k for c in v) for sd, v in m.hand.items()}
        m.tail_tip = tuple(c * k for c in m.tail_tip)
        m.tail_pre = tuple(c * k for c in m.tail_pre)
    m.k = 1.1 if zero else 1.0
    return m


def anchors(m):
    w = lambda b, p: [round(float(v), 2) for v in world_point(m, b, tuple(c * m.k for c in p))]
    return {"mouth": w("head", MOUTH)}
