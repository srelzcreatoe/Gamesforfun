"""Shin Godzilla 2nd form ("Kamata-kun").

The amphibious crawling stage that slithers up the river into Kamata: a long
slug-like body dragged on its belly and shoved along by splayed hind legs, a
thick wrinkled neck that lifts a small wedge-shaped head, enormous lifeless
glassy fish eyes, a gaping mouth of small needle teeth, curtains of blood-red
gill frills along the neck, rows of dark flame-like dorsal fins and a long
heavy tail.  ~55 blocks long, head carried ~11 blocks up.
"""
import math
import numpy as np
from geo import Model, Path, V, unit, rot_about, world_point
from atlas import REGIONS2, SIZE
from parts import plate, claw, tooth, limb, dir_yp

TAIL_N = 11
TAIL_REST = [-2, -1, 0, 0, 1, 1, 2, 3, 4, 5, 6]
X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)

BODY = [
    ((0, 3.0, 11.0), 3.4, 2.7),
    ((0, 3.5, 8.5), 4.5, 3.3),
    ((0, 3.9, 5.5), 5.2, 3.7),
    ((0, 4.0, 2.5), 5.3, 3.8),
    ((0, 4.0, -0.5), 5.0, 3.7),
    ((0, 4.1, -3.5), 4.5, 3.5),
    ((0, 4.4, -6.0), 3.9, 3.2),     # 6: body | neck1
    ((0, 5.6, -8.2), 3.4, 2.9),
    ((0, 7.3, -10.0), 3.0, 2.6),    # 8: neck1 | neck2
    ((0, 9.1, -11.5), 2.7, 2.35),
    ((0, 10.8, -13.0), 2.45, 2.15), # 10: skull joint
]
TAIL_BASE = (0, 3.5, 10.6)
HEAD_LIFT = (0, 1.5, 1.2)
MOUTH = (0, 8.0 + 1.5, -19.6 + 1.2)


def tail_joints():
    pts = [V(TAIL_BASE)]
    ang = 0.0
    for i in range(TAIL_N):
        ang += TAIL_REST[i]
        L = 3.7 - 0.09 * i
        a = math.radians(ang)
        pts.append(pts[-1] + V(0, math.sin(a) * L, math.cos(a) * L))
    return pts


def tail_radius(t):
    return 3.5 * (1 - t) ** 0.9 + 0.4, 2.8 * (1 - t) ** 0.9 + 0.35


def swept(nrm, d, deg):
    return nrm * math.cos(math.radians(deg)) + d * math.sin(math.radians(deg))


def build(seed=2):
    m = Model("geometry.sg.shin_godzilla_2", SIZE, REGIONS2, k=0.75, seed=seed)
    rng = m.rng
    m.bone("root", None, (0, 0, 0))
    m.bone("body", "root", (0, 3.5, 4.0))
    m.bone("neck1", "body", (0, 4.4, -6.0))
    m.bone("neck2", "neck1", (0, 7.3, -10.0))
    m.bone("head", "neck2", (0, 9.3, -14.2))   # authored here, lifted onto the raised neck below

    spine = Path(BODY, hint=(0, 1, 0))
    m.loft("body", spine, 0, 6, sleeve="body", wobble=0.025, caps="skin2")
    m.loft("neck1", spine, 6, 8, sleeve="body", wobble=0.04, sub=2)
    m.loft("neck2", spine, 8, 10, sleeve="body", wobble=0.04, sub=2)

    # vestigial front limbs
    for s in (1, -1):
        p0 = V(s * 4.3, 2.0, -4.2)
        p1 = p0 + V(s * 0.9, -1.2, -1.6)
        limb(m, "body", p0, p1, 0.75, 0.5, "skin2", shape="oct", hint=(0, 1, 0))
        for k in (-0.3, 0.0, 0.3):
            claw(m, "body", p1 + V(k, 0.0, -0.1), V(s * 0.2, -0.3, -1), V(0, -1, 0), 0.7, 0.24, segs=2)

    # ---------------------------------------------------------- hind legs
    for side, s in (("L", 1), ("R", -1)):
        th = m.bone("thigh_" + side, "body", (s * 4.2, 4.4, 7.8))
        tp = Path([((s * 4.2, 4.7, 8.0), 2.3, 2.7), ((s * 5.6, 4.1, 6.2), 2.2, 2.6), ((s * 6.8, 3.3, 4.4), 1.65, 1.95)], hint=(0, 1, 0))
        m.loft(th, tp, sleeve="thigh", wobble=0.02, caps="skin2")
        sh = m.bone("shin_" + side, th, (s * 6.8, 3.3, 4.4))
        limb(m, sh, V(s * 6.8, 3.3, 4.4), V(s * 7.3, 1.3, 6.6), 1.55, 1.2, "skin2", shape="oct", hint=(0, 0, -1))
        ft = m.bone("foot_" + side, sh, (s * 7.3, 1.2, 6.5))
        fp = Path([((s * 7.3, 0.95, 6.9), 1.3, 0.9), ((s * 7.45, 0.75, 5.0), 1.6, 0.7), ((s * 7.6, 0.6, 3.3), 1.7, 0.55)], hint=(0, 1, 0))
        m.loft(ft, fp, mat="skin2", wobble=0.02)
        for off, yaw in ((-1.1, s * 4 - 16), (0.0, s * 4), (1.1, s * 4 + 16)):
            f = dir_yp(yaw, 0)
            p0 = V(s * 7.6 + off, 0.5, 3.4)
            limb(m, ft, p0, p0 + f * 1.3, 0.45, 0.38, "skin2", shape="plus", hint=(0, 1, 0))
            claw(m, ft, p0 + f * 1.2, f, V(0, -1, 0), 1.2, 0.46, curve=18)

    # ---------------------------------------------------------- gills: red frills along the neck
    for side, s in (("L", 1), ("R", -1)):
        g = m.bone("gills_" + side, "neck1", (s * 3.3, 4.6, -8.2))
        for i in range(6):
            u = 5.7 + i * 0.5
            p, nrm, d = spine.surface(u, -22 if s > 0 else 202)
            hang = unit(nrm * 0.55 + V(0, -1, 0) * 0.8 + d * 0.15)
            ln = 2.7 - abs(i - 2.5) * 0.35 + rng.uniform(-0.2, 0.2)
            x = unit(d - np.dot(d, hang) * hang)
            m.obox(g, p + hang * (ln * 0.5 - 0.3) + nrm * 0.12 * (i % 2), (1.35, ln, 0.26), (x, hang, np.cross(x, hang)), "gill")

    # ---------------------------------------------------------- head
    head = "head"
    skull = Path([((0, 9.6, -13.8), 2.3, 1.75), ((0, 9.75, -15.6), 2.4, 1.8), ((0, 9.5, -17.4), 2.0, 1.45),
                  ((0, 9.25, -18.9), 1.5, 1.1), ((0, 9.1, -19.9), 1.1, 0.8)], hint=(0, 1, 0))
    m.loft(head, skull, sleeve="skull", wobble=0.012, overlap=0.1, caps="head")
    m.section(head, V(0, 9.05, -20.3), 0.6, 0.9, 0.62, (X, Y, Z), "head")
    m.obox(head, (0, 8.05, -16.0), (3.9, 0.2, 3.6), (X, Y, Z), "mouth")            # palate
    m.obox(head, (0, 8.25, -18.8), (2.4, 0.2, 2.4), (X, Y, Z), "mouth")
    m.obox(head, (0, 7.4, -14.2), (3.6, 1.8, 0.6), (X, Y, Z), "mouth")             # throat
    for s in (1, -1):
        # huge unblinking eyes bulging from the sides of the skull
        m.section(head, V(s * 2.25, 10.25, -15.9), 1.3, 1.05, 1.05, (Z, Y, X), "head")
        m.obox(head, (s * 2.98, 10.25, -15.9), (0.22, 1.62, 1.62), (X, Y, Z),
               lambda n, c: "eye_big" if abs(n[0]) > 0.9 else "head")
        m.obox(head, (s * 0.42, 9.95, -20.2), (0.26, 0.16, 0.3), (X, Y, Z), "mouth")
        lb, lf = V(s * 2.15, 8.0, -14.6), V(s * 0.8, 8.3, -20.2)
        ld = unit(lf - lb)
        ll = float(np.linalg.norm(lf - lb))
        lx = unit(np.cross(Y, ld))
        m.obox(head, (lb + lf) / 2, (0.3, 0.34, ll), (lx, np.cross(ld, lx), ld), "head")
        for i in range(15):
            f = 0.08 + 0.9 * (i + 0.5) / 15
            p = lb + (lf - lb) * f + V(-s * 0.06, -0.16, 0)
            ln = (0.34 + 0.28 * math.sin(math.pi * f)) * rng.uniform(0.8, 1.2)
            out = math.radians(8 + rng.uniform(-5, 8))
            tooth(m, head, p, V(s * math.sin(out), -math.cos(out), math.radians(rng.uniform(-8, 8))), ln, 0.17, lateral=ld)
    for x in (-0.5, 0.0, 0.5):
        tooth(m, head, V(x, 8.3, -20.5), V(x * 0.2, -1, -0.2), 0.36, 0.15, lateral=X)

    jaw = m.bone("jaw", head, (0, 8.1, -14.3), (16, 0, 0))
    jp = Path([((0, 7.7, -14.4), 2.1, 0.5), ((0, 7.66, -16.6), 1.9, 0.48), ((0, 7.72, -18.4), 1.4, 0.42), ((0, 7.82, -19.75), 0.95, 0.36)],
              hint=(0, 1, 0))
    m.loft(jaw, jp, mat=lambda n, c: "mouth" if float(np.dot(n, c["t"])) > 0.5 else "head", wobble=0.012, overlap=0.14)
    m.obox(jaw, (0, 7.05, -15.6), (3.2, 0.9, 2.8), (X, Y, Z), "fissure")            # wet red throat pouch
    for s in (1, -1):
        for i in range(12):
            u = 0.15 + 2.8 * (i + 0.5) / 12
            c, a, b, (l, t, d) = jp.at(u)
            p = c + V(s * a * 0.86, b * 0.7, 0)
            ln = (0.3 + 0.25 * math.sin(math.pi * (i + 0.5) / 12)) * rng.uniform(0.8, 1.2)
            out = math.radians(6 + rng.uniform(-4, 8))
            tooth(m, jaw, p, V(s * math.sin(out), math.cos(out), math.radians(rng.uniform(-8, 8))), ln, 0.16, lateral=d)

    m.translate_bones(["head", "jaw"], HEAD_LIFT)

    # ---------------------------------------------------------- tail
    J = tail_joints()
    lens = [float(np.linalg.norm(J[i + 1] - J[i])) for i in range(TAIL_N)]
    total = sum(lens)
    acc = 0.0
    parent = "body"
    for i in range(TAIL_N):
        t0, t1 = i / TAIL_N, (i + 1) / TAIL_N
        a0, b0 = tail_radius(t0)
        a1, b1 = tail_radius(t1)
        name = m.bone("tail%d" % i, parent, tuple(J[i]))
        tp = Path([(J[i], a0, b0), ((J[i] + J[i + 1]) / 2, (a0 + a1) / 2, (b0 + b1) / 2), (J[i + 1], a1, b1)], hint=(0, 1, 0))
        m.loft(name, tp, sleeve="tail", frange=(acc / total, (acc + lens[i]) / total), wobble=0.03, overlap=0.2,
               caps="skin2" if i == TAIL_N - 1 else None)
        acc += lens[i]
        ph = (3.0 * (1 - t0) ** 1.1 + 0.5) * rng.uniform(0.85, 1.12)
        for u in (0.5, 1.5):
            p, nrm, d = tp.surface(u, 90, out=-0.2)
            plate(m, name, p, swept(nrm, d, 30), d, ph * rng.uniform(0.9, 1.1), ph * 0.8, style="flame")
        if i < 6:
            for phi in (55, 125):
                p, nrm, d = tp.surface(1.0, phi, out=-0.2)
                plate(m, name, p, swept(nrm, d, 28), d, ph * 0.6, ph * 0.5, style="flame")
        parent = name

    # ---------------------------------------------------------- dorsal fins
    def bone_for(u):
        return "body" if u < 6 else "neck1" if u < 8 else "neck2"

    u = 0.6
    while u < 9.4:
        hh = (3.9 - abs(u - 3.2) * 0.34) if u < 6 else max(0.9, 2.6 - (u - 6) * 0.55)
        p, nrm, d = spine.surface(u, 90, out=-0.25)
        plate(m, bone_for(u), p, swept(nrm, -d, 34), -d, hh * rng.uniform(0.9, 1.1), hh * 0.8, style="flame")
        if u < 6.4:
            for phi in (58, 122):
                p, nrm, d = spine.surface(u + 0.2, phi, out=-0.25)
                plate(m, bone_for(u), p, swept(nrm, -d, 32), -d, hh * 0.62, hh * 0.52, style="flame")
        u += 0.56
    m.cap_mat = "skin2"
    return m


def anchors(m):
    r = lambda v: [round(float(c), 2) for c in v]
    return {
        "mouth": r(world_point(m, "head", MOUTH)),
        "gill_L": r(world_point(m, "gills_L", (3.9, 3.6, -8.4))),
        "gill_R": r(world_point(m, "gills_R", (-3.9, 3.6, -8.4))),
    }
