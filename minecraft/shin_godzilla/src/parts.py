"""Reusable organic parts: dorsal plates, claws, teeth, fingers."""
import math
import numpy as np
from geo import _rot_matrix_bb, _mv, unit, rot_about, V


def rot_point(p, pivot, rot):
    """Rotate point p around pivot with a Bedrock-space Euler rotation."""
    pb = [-p[0], p[1], p[2]]
    vb = [-pivot[0], pivot[1], pivot[2]]
    mtx = _rot_matrix_bb(-rot[0], -rot[1], rot[2])
    rr = _mv(mtx, [pb[i] - vb[i] for i in range(3)])
    q = [rr[i] + vb[i] for i in range(3)]
    return (-q[0], q[1], q[2])


def plate(m, bone, base, up, fwd, h, w, style="shin"):
    """One dorsal plate, built as a fan of jagged blades in a single plane.

    Shin Godzilla's plates are not smooth fins: each is an irregular, maple-
    leaf / coral-like cluster of bony points.  `up` is the main blade
    direction, `fwd` the in-plane direction along the back, h the height and
    w the fore-aft spread.  Blades use base->tip gradient strips so every
    plate is dark and glowing at the root and pale bone at the points.
    style "flame" gives the thinner, curling spines of the 2nd form.
    """
    rng = m.rng
    base = V(base)
    U, F = unit(up), unit(fwd)
    F = unit(F - np.dot(F, U) * U)
    W = unit(np.cross(U, F))
    th = max(0.16, 0.085 * w)
    if not hasattr(m, "plate_tips"):
        m.plate_tips = []
    m.plate_tips.append((bone, tuple(base + U * h * 0.92), h))

    m.obox(bone, base + U * 0.05 * h, (th * 2.3, 0.22 * h, w * 0.92), (W, U, F), "plate_base")
    if h < 1.5:
        dr = rot_about(U, W, rng.uniform(-12, 12))
        m.obox(bone, base + dr * h * 0.5, (th, h, w * 0.5), (W, dr, np.cross(W, dr)), "plate")
        return
    if style == "flame":
        angs, lens = [-34, -6, 26], [0.62, 1.0, 0.7]
    elif h < 3.4:
        angs, lens = [-38, 0, 36], [0.7, 1.0, 0.76]
    else:
        angs, lens = [-54, -27, 0, 25, 50], [0.58, 0.84, 1.0, 0.88, 0.66]
    nb = len(angs)
    bw = w * (0.46 if nb == 3 else 0.33)
    # broad bony web that carries the points (gives the plate its mass)
    m.obox(bone, base + U * 0.27 * h, (th * 1.5, 0.56 * h, w * 0.9), (W, U, F), "plate_web")
    for j, (a0, l0) in enumerate(zip(angs, lens)):
        ang = a0 + rng.uniform(-7, 7)
        ln = h * l0 * rng.uniform(0.9, 1.1)
        dr = rot_about(U, W, ang)
        m.obox(bone, base + dr * ln * 0.5, (th, ln, bw * rng.uniform(0.88, 1.12)), (W, dr, np.cross(W, dr)), "plate")
        central = abs(a0) < 30
        if (h >= 2.4 and central) or (style == "flame" and h >= 1.8):
            kink = rng.uniform(-24, 24) + (16 if style == "flame" else 0)
            d2 = rot_about(dr, W, kink)
            tl = 0.3 * h * l0
            m.obox(bone, base + dr * ln * 0.94 + d2 * tl * 0.45, (th * 0.72, tl, bw * 0.5), (W, d2, np.cross(W, d2)), "plate_tip")
        if h >= 5.0 and j in (1, 3):
            sgn = 1 if j == 3 else -1
            d3 = rot_about(dr, W, sgn * rng.uniform(40, 58))
            bl = 0.26 * h
            m.obox(bone, base + dr * ln * rng.uniform(0.5, 0.7) + d3 * bl * 0.5, (th * 0.7, bl, bw * 0.42), (W, d3, np.cross(W, d3)), "plate_tip")


def claw(m, bone, root, fwd, down, length, thick, mat="claw", curve=22.0, segs=3):
    """Curved talon made of tapering boxes that hook toward `down`."""
    p = V(root)
    f, dn = unit(fwd), unit(down)
    side = unit(np.cross(dn, f))
    seg = length / segs
    for i in range(segs):
        f = rot_about(f, side, -curve) if i else f
        t = thick * (1 - 0.3 * i)
        up = unit(np.cross(f, side))
        m.obox(bone, p + f * seg * 0.5, (t, t * 0.95, seg * 1.15), (side, up, f), mat)
        p = p + f * seg


def tooth(m, bone, root, direction, length, thick, mat="tooth", lateral=None):
    """A tapered fang: stout base, slimmer middle, fine point."""
    d = unit(direction)
    ref = V(lateral) if lateral is not None else (V(0, 0, 1) if abs(d[2]) < 0.9 else V(1, 0, 0))
    x = unit(np.cross(d, ref))
    z = np.cross(x, d)
    root = V(root)
    m.obox(bone, root + d * length * 0.30, (thick, length * 0.6, thick * 0.9), (x, d, z), mat)
    tipmat = "claw" if mat == "tooth" else mat
    m.obox(bone, root + d * length * 0.72, (thick * 0.62, length * 0.42, thick * 0.7), (x, d, z), tipmat)
    m.obox(bone, root + d * length * 0.99, (thick * 0.3, length * 0.22, thick * 0.34), (x, d, z), tipmat)


def limb(m, bone, p0, p1, r0, r1, mat, shape="plus", hint=(0, 0, -1)):
    """Short tapered limb span (fingers, toes)."""
    from geo import Path
    path = Path([(p0, r0, r0), (p1, r1, r1)], hint=hint)
    m.loft(bone, path, mat=mat, shape=shape, overlap=0.1, wobble=0.0)


def dir_yp(yaw, pitch):
    """Unit vector: yaw 0 = forward (-z), +yaw toward +x; +pitch = upward."""
    cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
    return V(sy * cp, sp, -cy * cp)
