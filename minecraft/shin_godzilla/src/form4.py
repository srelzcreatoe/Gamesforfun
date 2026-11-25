"""Shin Godzilla 4th form (and, with form=3, the hunched 3rd form).

~48 blocks tall with an ~85 block tail.  The body is sculpted as lofted
octagonal sections along a curved spine and skinned with continuous
"sleeve" textures, so the hide flows around the body instead of being a
patchwork: pear-shaped trunk with belly scutes, a thick ringed neck carrying
a small blunt head, colossal thighs on bird-like legs with four huge pale
talons, tiny arms held forward palm-up with splayed fingers, five ragged rows
of maple-leaf dorsal plates, and an enormously long ringed tail with a red
underside and a skeletal tip.  The lower jaw is two halves so it can unhinge
and split for the atomic breath.
"""
import math
import numpy as np
from geo import Model, Path, V, unit, rot_about, world_point
from atlas import REGIONS, SIZE
from parts import plate, claw, tooth, limb, dir_yp

TAIL_N = 18
TAIL_REST = [-5, -4, -3, -3, -2, -1, 0, 1, 2, 3, 4, 6, 8, 11, 13, 14, 14, 13]
X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)

# centre line of the trunk, pelvis -> skull joint: (pos, half-width, half-depth)
SPINE = [
    ((0, 12.6, 3.0), 5.2, 5.0),
    ((0, 14.6, 2.8), 6.6, 6.2),
    ((0, 17.0, 2.4), 7.2, 6.8),
    ((0, 19.6, 1.9), 7.0, 6.7),
    ((0, 22.0, 1.3), 6.6, 6.3),    # 4: hips | torso
    ((0, 24.2, 0.8), 6.2, 5.9),
    ((0, 26.4, 0.3), 5.9, 5.6),
    ((0, 28.6, -0.2), 5.6, 5.3),   # 7: torso | chest
    ((0, 30.6, -0.8), 5.4, 5.1),
    ((0, 32.6, -1.5), 5.1, 4.9),
    ((0, 34.4, -2.2), 4.7, 4.6),
    ((0, 36.0, -3.0), 4.2, 4.3),   # 11: chest | neck1
    ((0, 37.7, -3.9), 3.8, 3.95),
    ((0, 39.4, -4.8), 3.45, 3.6),
    ((0, 41.1, -5.7), 3.1, 3.3),   # 14: neck1 | neck2
    ((0, 42.8, -6.5), 2.85, 3.0),
    ((0, 44.4, -7.1), 2.65, 2.8),
    ((0, 45.9, -7.5), 2.5, 2.6),   # 17: skull joint
]
TAIL_BASE = (0, 16.9, 6.0)
MOUTH = (0, 45.3, -12.9)

UPPER_FANGS = [0.55, 0.8, 0.7, 1.05, 0.85, 1.3, 0.9, 1.15, 1.35, 0.95, 1.2, 0.8, 1.05, 0.7, 0.6]
LOWER_FANGS = [0.45, 0.7, 0.6, 0.95, 0.75, 1.1, 0.8, 1.0, 0.7, 0.95, 0.6, 0.7, 0.5]


def tail_joints():
    pts = [V(TAIL_BASE)]
    ang = 0.0
    for i in range(TAIL_N):
        ang += TAIL_REST[i]
        L = 6.0 - 0.16 * i
        a = math.radians(ang)
        pts.append(pts[-1] + V(0, math.sin(a) * L, math.cos(a) * L))
    return pts


def tail_radius(t):
    return 5.6 * (1 - t) ** 0.95 + 0.45, 5.3 * (1 - t) ** 0.95 + 0.42


def bone_for_u(u):
    return "hips" if u < 4 else "torso" if u < 7 else "chest" if u < 11 else "neck1" if u < 14 else "neck2"


def ob(m, bone, c, size, mat, yaw=0.0, pitch=0.0, roll=0.0):
    """Box with intuitive orientation: size = (lateral, up, along-forward)."""
    f = dir_yp(yaw, pitch)
    x = unit(np.cross(Y, f)) if abs(f[1]) < 0.99 else X
    y = np.cross(f, x)
    if roll:
        x, y = rot_about(x, f, roll), rot_about(y, f, roll)
    m.obox(bone, c, size, (x, y, f), mat)


def swept(nrm, d, deg):
    return nrm * math.cos(math.radians(deg)) + d * math.sin(math.radians(deg))


def build_head(m, f3, rng):
    """Skull, eyes, lip line and two interlocking rows of fangs."""
    head = "head"
    skull = Path([((0, 47.05, -6.3), 2.45, 1.55), ((0, 47.25, -8.0), 2.5, 1.6), ((0, 47.2, -9.6), 2.3, 1.5),
                  ((0, 47.0, -11.0), 1.95, 1.3), ((0, 46.8, -12.2), 1.6, 1.1), ((0, 46.65, -13.1), 1.3, 0.92)], hint=(0, 1, 0))
    m.loft(head, skull, sleeve="skull", wobble=0.012, overlap=0.1, caps="head")
    m.section(head, V(0, 46.6, -13.4), 0.6, 1.12, 0.78, (X, Y, Z), "head")                 # blunt nose
    # crown: two rows of low bony nubs running back over the skull
    for z0, sc in ((-7.0, 1.0), (-8.3, 0.9), (-9.6, 0.75)):
        for s in (1, -1):
            ob(m, head, (s * 0.85, 48.72 - (9.6 + z0) * 0.02, z0), (0.7 * sc, 0.42 * sc, 0.9 * sc), "head", yaw=s * 10, roll=-s * 14)
    m.obox(head, (0, 45.84, -8.6), (4.2, 0.2, 3.4), (X, Y, Z), "mouth")                    # palate (rear)
    m.obox(head, (0, 45.82, -11.6), (2.9, 0.2, 2.9), (X, Y, Z), "mouth")                   # palate (front)
    m.obox(head, (0, 45.2, -7.0), (3.9, 1.9, 0.7), (X, Y, Z), "mouth")                     # back of the throat
    eye = (0.34, 0.86, 0.92) if f3 else (0.3, 0.5, 0.56)
    for s in (1, -1):
        ob(m, head, (s * 1.86, 48.12, -9.5), (1.05, 0.5, 2.7), "head", yaw=s * 7, pitch=-4, roll=-s * 24)   # brow ridge
        ob(m, head, (s * 2.22, 46.72, -9.7), (0.5, 0.42, 2.3), "head", yaw=s * 7)                           # cheek ridge
        ob(m, head, (s * 2.25, 46.3, -7.5), (0.95, 1.7, 2.1), "head", yaw=s * 4)                            # jaw muscle
        m.obox(head, (s * 2.2, 47.32, -9.9), eye, (X, Y, Z), lambda n, c: "eye" if abs(n[0]) > 0.9 else "skin2")
        m.obox(head, (s * 0.46, 47.5, -13.3), (0.3, 0.16, 0.36), (X, Y, Z), "mouth")                        # nostril
        # lip: a clean edge of hide that the upper fangs hang from
        lb, lf = V(s * 2.2, 45.8, -7.7), V(s * 1.02, 45.76, -13.35)
        ld = unit(lf - lb)
        ll = float(np.linalg.norm(lf - lb))
        lx = unit(np.cross(Y, ld))
        m.obox(head, (lb + lf) / 2, (0.34, 0.4, ll), (lx, Y, ld), "head")
        m.obox(head, (lb + lf) / 2 + V(-s * 0.14, -0.2, 0), (0.24, 0.2, ll * 0.98), (lx, Y, ld), "gum")
        n = len(UPPER_FANGS)
        for i, base_len in enumerate(UPPER_FANGS):
            f = 0.13 + 0.85 * (i + 0.5) / n
            p = lb + (lf - lb) * f + V(-s * 0.1, -0.22, 0)
            out = math.radians(10 + 7 * math.sin(i * 2.4) + rng.uniform(-4, 6))
            fa = math.radians(8 * math.sin(i * 1.7 + 1.0) + rng.uniform(-5, 5))
            tooth(m, head, p, V(s * math.sin(out), -math.cos(out), math.sin(fa)), base_len * rng.uniform(0.9, 1.1), 0.23, lateral=ld)
    m.obox(head, (0, 45.76, -13.42), (2.05, 0.4, 0.3), (X, Y, Z), "head")                  # front lip
    for i, x in enumerate((-0.84, -0.42, 0.0, 0.42, 0.84)):
        tooth(m, head, V(x, 45.56, -13.42), V(x * 0.14, -1, -0.18), 0.58 + 0.2 * (i % 2), 0.21, lateral=X)

    for side, s in (("L", 1), ("R", -1)):
        jaw = m.bone("jaw_" + side, head, (s * 1.95, 45.5, -7.2), (7, 0, 0))
        jp = Path([((s * 1.95, 45.02, -7.2), 0.7, 0.76), ((s * 1.75, 44.88, -9.2), 0.66, 0.66),
                   ((s * 1.3, 44.8, -11.2), 0.6, 0.58), ((s * 0.62, 44.84, -12.8), 0.56, 0.52)], hint=(0, 1, 0))
        m.loft(jaw, jp, mat="head", wobble=0.012, overlap=0.16)
        m.obox(jaw, (s * 0.32, 44.84, -13.0), (0.66, 0.9, 0.7), (X, Y, Z), "head")          # chin
        m.obox(jaw, (s * 0.9, 44.95, -8.7), (1.8, 0.22, 3.2), (X, Y, Z), "mouth")           # mouth floor (rear)
        m.obox(jaw, (s * 0.52, 44.93, -11.4), (1.04, 0.22, 2.6), (X, Y, Z), "mouth")        # mouth floor (front)
        m.obox(jaw, (s * 0.92, 44.42, -8.9), (1.84, 0.34, 3.6), (X, Y, Z), "fissure")       # loose throat skin
        n = len(LOWER_FANGS)
        for i, base_len in enumerate(LOWER_FANGS):
            u = 0.3 + 2.62 * (i + 0.5) / n
            c, a, b, (l, t, d) = jp.at(u)
            p = c + V(s * a * 0.35, b * 0.8, 0)
            out = math.radians(8 + 6 * math.sin(i * 2.1) + rng.uniform(-4, 5))
            fa = math.radians(7 * math.sin(i * 1.3) + rng.uniform(-5, 5))
            tooth(m, jaw, p, V(s * math.sin(out), math.cos(out), math.sin(fa)), base_len * rng.uniform(0.9, 1.1), 0.22, lateral=d)
        tooth(m, jaw, V(s * 0.22, 45.25, -13.25), V(s * 0.06, 1, -0.14), 0.6, 0.2, lateral=X)
        tooth(m, jaw, V(s * 0.66, 45.25, -13.1), V(s * 0.12, 1, -0.1), 0.72, 0.2, lateral=X)
    return skull


def build(seed=4, form=4):
    f3 = form == 3
    ident = "geometry.sg.shin_godzilla_3" if f3 else "geometry.sg.shin_godzilla"
    m = Model(ident, SIZE, REGIONS, k=0.5, seed=seed)
    rng = m.rng
    pk = 0.74 if f3 else 1.0  # dorsal plate scale

    m.bone("root", None, (0, 0, 0))
    m.bone("body", "root", (0, 17.0, 2.2))
    m.bone("hips", "body", (0, 17.0, 2.2))
    m.bone("torso", "body", (0, 22.0, 1.3), (30, 0, 0) if f3 else None)
    m.bone("chest", "torso", (0, 28.6, -0.2))
    m.bone("neck1", "chest", (0, 36.0, -3.0), (-10, 0, 0) if f3 else None)
    m.bone("neck2", "neck1", (0, 41.1, -5.7), (-12, 0, 0) if f3 else None)
    m.bone("head", "neck2", (0, 45.9, -7.5), (-8, 0, 0) if f3 else None)

    # ------------------------------------------------------------- trunk
    spine = Path(SPINE, hint=(0, 0, 1))
    m.loft("hips", spine, 0, 4, sleeve="trunk", wobble=0.02, caps="skin2")
    m.loft("torso", spine, 4, 7, sleeve="trunk", wobble=0.022)
    m.loft("chest", spine, 7, 11, sleeve="trunk", wobble=0.022)
    m.loft("neck1", spine, 11, 14, sleeve="trunk", wobble=0.035, sub=2)
    m.loft("neck2", spine, 14, 17, sleeve="trunk", wobble=0.035, sub=2)

    # ------------------------------------------------------------- legs
    for side, s in (("L", 1), ("R", -1)):
        thigh = m.bone("thigh_" + side, "root", (s * 5.6, 18.0, 2.0))
        tp = Path([((s * 5.2, 20.2, 2.4), 3.6, 5.0), ((s * 6.0, 17.2, 1.8), 4.7, 6.5), ((s * 6.5, 14.0, 0.6), 4.8, 6.6),
                   ((s * 6.4, 11.2, -0.9), 4.1, 5.3), ((s * 6.2, 9.2, -1.9), 3.3, 4.1)], hint=(0, 0, -1))
        m.loft(thigh, tp, sleeve="thigh", wobble=0.02, caps="skin2")
        m.section(thigh, V(s * 6.2, 9.7, -3.5), 2.4, 2.2, 1.6, (X, Y, Z), "skin2")  # knee cap

        shin = m.bone("shin_" + side, thigh, (s * 6.2, 9.6, -1.6))
        sp = Path([((s * 6.2, 9.9, -1.8), 3.2, 3.9), ((s * 6.1, 7.6, -0.7), 3.0, 3.5), ((s * 6.0, 5.4, 0.6), 2.7, 3.0),
                   ((s * 5.9, 3.3, 1.6), 2.4, 2.6)], hint=(0, 0, -1))
        m.loft(shin, sp, sleeve="shin", wobble=0.035, caps="skin2")

        foot = m.bone("foot_" + side, shin, (s * 5.9, 3.2, 1.5))
        fp = Path([((s * 5.9, 2.9, 1.8), 2.5, 2.0), ((s * 5.9, 1.95, -0.5), 2.85, 1.7), ((s * 5.9, 1.3, -2.8), 3.05, 1.28)],
                  hint=(0, 1, 0))
        m.loft(foot, fp, sleeve="foot", wobble=0.02, caps="skin2")
        m.section(foot, V(s * 5.9, 1.2, 2.7), 2.6, 1.85, 1.18, (X, Y, Z), "skin2")  # heel pad
        claw(m, foot, V(s * 5.9, 1.05, 3.7), V(0, 0.15, 1), V(0, -1, 0), 1.7, 0.85, curve=24)

        toes = m.bone("toes_" + side, foot, (s * 5.9, 1.0, -3.0))
        for off, yaw in ((-2.05, -24), (-0.7, -8), (0.7, 8), (2.05, 24)):
            f = dir_yp(yaw, 0)
            p0 = V(s * 5.9 + off, 0.8, -2.5)
            p1 = p0 + f * 2.5
            limb(m, toes, p0, p1, 0.78, 0.66, "skin2", shape="oct", hint=(0, 1, 0))
            m.obox(toes, p0 + f * 1.1 + V(0, 0.55, 0), (1.0, 0.5, 1.0), (unit(np.cross(Y, f)), Y, f), "skin2")
            claw(m, toes, p1 - f * 0.15 + V(0, 0.06, 0), f, V(0, -1, 0), 2.3, 0.84, curve=20)

    # ------------------------------------------------------------- arms (tiny, palm-up)
    for side, s in (("L", 1), ("R", -1)):
        sh = V(s * 3.9, 31.9, -4.5)
        el = V(s * 4.7, 29.7, -6.4)
        wr = V(s * 4.6, 29.9, -8.9)
        arm = m.bone("arm_" + side, "chest", tuple(sh))
        m.section(arm, sh + V(s * 0.1, 0.1, 0.4), 2.0, 1.3, 1.3, (X, Y, Z), "skin")
        limb(m, arm, sh, el, 0.95, 0.72, "fissure", shape="oct")
        fore = m.bone("forearm_" + side, arm, tuple(el))
        limb(m, fore, el, wr, 0.7, 0.5, "fissure", shape="oct")
        m.section(fore, el, 1.2, 0.8, 0.8, (X, Y, Z), "skin")
        hand = m.bone("hand_" + side, fore, tuple(wr))
        pn = unit(V(-s * 0.45, 1, 0.1))            # palm faces up and inward
        fw = unit(V(s * 0.12, 0.12, -1))
        fw = unit(fw - np.dot(fw, pn) * pn)
        lat = np.cross(pn, fw)
        m.obox(hand, wr + fw * 0.6, (1.3, 0.42, 1.15), (lat, pn, fw), "skin")
        for a in (-52, -26, 0, 26, 52):
            f1 = rot_about(fw, pn, a)
            base = wr + fw * 1.05 - lat * (a / 52.0) * 0.5
            ax = unit(np.cross(f1, pn))
            ln = 0.95 if abs(a) < 40 else 0.75
            d1, d2 = rot_about(f1, ax, 14), rot_about(f1, ax, 46)
            limb(m, hand, base, base + d1 * ln, 0.17, 0.15, "skin2", shape="box", hint=tuple(pn))
            mid = base + d1 * ln * 0.94
            limb(m, hand, mid, mid + d2 * ln * 0.85, 0.14, 0.12, "skin2", shape="box", hint=tuple(pn))
            tip = mid + d2 * ln * 0.85
            m.obox(hand, tip + d2 * 0.14, (0.15, 0.15, 0.38), (lat, np.cross(d2, lat), d2), "claw")

    build_head(m, f3, rng)

    if f3:  # the 3rd form still breathes through blood-red gills on the neck
        for i in range(5):
            u = 11.3 + i * 0.6
            for ph in (-12, 192):
                p, nrm, d = spine.surface(u, ph)
                around = unit(np.cross(d, nrm))
                dn = rot_about(nrm, around, 24)
                m.obox("neck1", p + dn * 0.3, (2.4, 0.3, 1.0), (around, np.cross(dn, around), dn), "gill")

    # ------------------------------------------------------------- tail
    J = tail_joints()
    lens = [float(np.linalg.norm(J[i + 1] - J[i])) for i in range(TAIL_N)]
    total = sum(lens)
    acc = 0.0
    parent = "hips"
    for i in range(TAIL_N):
        t0, t1 = i / TAIL_N, (i + 1) / TAIL_N
        a0, b0 = tail_radius(t0)
        a1, b1 = tail_radius(t1)
        name = m.bone("tail%d" % i, parent, tuple(J[i]))
        tp = Path([(J[i], a0, b0), ((J[i] + J[i + 1]) / 2, (a0 + a1) / 2, (b0 + b1) / 2), (J[i + 1], a1, b1)], hint=(0, 1, 0))
        m.loft(name, tp, sleeve="tail", frange=(acc / total, (acc + lens[i]) / total), wobble=0.04, overlap=0.2,
               caps="bone" if i == TAIL_N - 1 else None)
        acc += lens[i]
        # rows of spines continue all the way down the tail
        ph = (4.8 * (1 - t0) ** 1.2 + 0.6) * pk
        for u in (0.45, 1.45):
            p, nrm, d = tp.surface(u, 90, out=-0.25)
            hh = ph * rng.uniform(0.85, 1.12)
            plate(m, name, p, swept(nrm, d, 36), d, hh, hh * 0.92)
        if i < 11:
            for phi in (58, 122):
                p, nrm, d = tp.surface(1.0, phi, out=-0.25)
                hh = ph * 0.66 * rng.uniform(0.85, 1.1)
                plate(m, name, p, swept(nrm, d, 30), d, hh, hh * 0.75)
        if i < 5:
            for phi in (30, 150):
                p, nrm, d = tp.surface(0.5, phi, out=-0.25)
                hh = ph * 0.4 * rng.uniform(0.85, 1.1)
                plate(m, name, p, swept(nrm, d, 28), d, hh, hh * 0.75)
        parent = name

    # skeletal tail tip: fused bone, ribs and a little gaping jaw
    tip = "tail%d" % (TAIL_N - 1)
    e = J[-1]
    d = unit(J[-1] - J[-2])
    upv = unit(np.cross(X, d))
    limb(m, tip, e - d * 0.4, e + d * 1.6, 0.62, 0.42, "bone", shape="plus", hint=tuple(upv))
    m.obox(tip, e + d * 2.0 + upv * 0.18, (0.6, 0.42, 1.2), (X, rot_about(upv, X, 16), rot_about(d, X, 16)), "bone")
    m.obox(tip, e + d * 1.9 - upv * 0.3, (0.5, 0.3, 1.1), (X, rot_about(upv, X, -24), rot_about(d, X, -24)), "bone")
    for s in (1, -1):
        for j, back in enumerate((0.2, 0.8, 1.4)):
            dv = unit(d * 0.5 + X * s * 0.8 + upv * (0.3 - 0.25 * j))
            tooth(m, tip, e + d * back + X * s * 0.3, dv, 1.0 - 0.2 * j, 0.2, "bone")

    # ------------------------------------------------------------- dorsal plates (trunk)
    def h_of(u):
        return (4.4 + 4.4 * math.exp(-((u - 8.2) / 3.4) ** 2)) if u <= 11 else max(1.8, 6.6 - (u - 11) * 1.8)

    u = 1.3
    while u < 13.6:
        p, nrm, d = spine.surface(u, 90, out=-0.35)
        hh = h_of(u) * pk * rng.uniform(0.9, 1.1)
        plate(m, bone_for_u(u), p, swept(nrm, d, 48), d, hh, hh * 0.95)
        u += 0.68
    u = 1.7
    while u < 12.8:
        for phi in (62, 118):
            p, nrm, d = spine.surface(u + rng.uniform(-0.15, 0.15), phi, out=-0.3)
            hh = h_of(u) * 0.74 * pk * rng.uniform(0.88, 1.1)
            plate(m, bone_for_u(u), p, swept(nrm, d, 46), d, hh, hh * 0.9)
        u += 0.86
    u = 2.3
    while u < 10.9:
        for phi in (36, 144):
            p, nrm, d = spine.surface(u + rng.uniform(-0.2, 0.2), phi, out=-0.3)
            hh = h_of(u) * 0.48 * pk * rng.uniform(0.85, 1.1)
            plate(m, bone_for_u(u), p, swept(nrm, d, 44), d, hh, hh * 0.85)
        u += 1.1
    for u in (14.3, 15.2, 16.1):  # small spines up the nape
        p, nrm, d = spine.surface(u, 90, out=-0.2)
        hh = (1.5 - (u - 14.3) * 0.3) * pk
        plate(m, "neck2", p, swept(nrm, d, 38), d, hh, hh * 0.7)

    m.tail_tip = tuple(e + d * 2.4)
    m.tail_pre = tuple(e - d * 2.0)
    if f3:
        for side, s in (("L", 1), ("R", -1)):
            m.scale_bones(["arm_" + side, "forearm_" + side, "hand_" + side], (s * 3.9, 31.9, -4.5), 0.62)
        m.scale_all(0.5)
        m.plate_tips = [(b, tuple(c * 0.5 for c in p), h * 0.5) for (b, p, h) in m.plate_tips]
        m.tail_tip = tuple(c * 0.5 for c in m.tail_tip)
        m.tail_pre = tuple(c * 0.5 for c in m.tail_pre)
    return m


def anchors(m, f=1.0):
    """Key effect points in rest pose (blocks), consumed by the script."""
    w = lambda b, p: [round(v, 2) for v in world_point(m, b, tuple(c * f for c in p))]
    return {"mouth": w("head", MOUTH)}
