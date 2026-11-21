"""Reusable anatomy for the three Basiliskra designs."""
from __future__ import annotations

import math

from kit import Bone, Model, hash01


def rnd(seed: int, *k) -> float:
    return float(hash01(*k, seed=seed))


def plate(b: Bone, x, y, z, length, height, thick, sweep=18.0, tilt=0.0, mat="plate", jag=0.5, tooth=True, yaw=0.0):
    """A jagged dorsal plate: stacked slabs that step in towards a hooked tip, swept back
    (`sweep`, degrees towards the tail) and leaned outwards (`tilt`, + = animal's left).
    (x, y, z) is the middle of its root."""
    piv = (x, y, z)
    rot = (-sweep, yaw, tilt)
    g = (y - 1, y + height * 1.12)
    L, H = length, height
    z0 = z - L / 2
    t1, t2 = max(thick - 1, 1), max(thick - 2, 1)
    steps = [
        # (z start, z length, y start, y height, thickness): the leading edge rakes back, so the
        # blade ends in a point over its trailing third
        (0.00, 1.00, -2.0, 0.26 * H + 2, thick),
        (0.07 + 0.05 * jag, 0.88, 0.26 * H, 0.20 * H, t1),
        (0.18 + 0.07 * jag, 0.70, 0.46 * H, 0.18 * H, t1),
        (0.32 + 0.08 * jag, 0.52, 0.64 * H, 0.16 * H, t2),
        (0.47 + 0.08 * jag, 0.33, 0.80 * H, 0.13 * H, t2),
        (0.60 + 0.08 * jag, 0.17, 0.93 * H, 0.13 * H, t2),
    ]
    cubes = []
    for zs, zl, ys, yh, t in steps:
        cubes.append(b.cube((x - t / 2, y + ys, z0 + zs * L), (t, yh, zl * L), mat, rot=rot, pivot=piv, g=g, axis=1))
    if tooth:
        # a back-swept hook on the trailing edge and a nick out of the leading edge
        t = max(thick - 2, 1)
        cubes.append(b.cube((x - t / 2, y + 0.36 * H, z0 + 0.93 * L), (t, 0.13 * H, 0.13 * L), mat, rot=rot, pivot=piv, g=g, axis=1))
        cubes.append(b.cube((x - t / 2, y + 0.58 * H, z0 + (0.86 + 0.04 * jag) * L), (t, 0.10 * H, 0.10 * L), mat, rot=rot, pivot=piv, g=g, axis=1))
    return cubes


def blunt_plate(b: Bone, x, y, z, length, height, thick, sweep=8.0, tilt=0.0, mat="plate"):
    """Form II: the ribbon has fused into low, rounded plates."""
    piv = (x, y, z)
    rot = (-sweep, 0.0, tilt)
    g = (y - 1, y + height)
    z0 = z - length / 2
    b.cube((x - thick / 2, y - 2, z0), (thick, 0.62 * height + 2, length), mat, rot=rot, pivot=piv, g=g, axis=1)
    b.cube((x - (thick - 1) / 2, y + 0.62 * height, z0 + 0.14 * length), (thick - 1, 0.38 * height, 0.70 * length), mat,
           rot=rot, pivot=piv, g=g, axis=1)


def tooth_row(b: Bone, x, y, z0, z1, n, up=False, size=(2, 5, 3), jitter_seed=0, splay=0.0):
    """Teeth along one jaw edge.  `up`: lower-jaw teeth pointing up."""
    w, h, d = size
    for i in range(n):
        t = (i + 0.5) / n
        z = z0 + (z1 - z0) * t
        hh = h * (0.7 + 0.6 * rnd(jitter_seed, i, 3)) * (1.25 if i in (1, n - 2) else 1.0)
        yy = y if up else y - hh
        g = (yy + hh, yy) if not up else (yy, yy + hh)
        b.cube((x - w / 2, yy, z - d / 2), (w, hh, d), "ivory", g=g, axis=1, glow=0.3,
               rot=(0, 0, splay) if splay else None, pivot=(x, y, z) if splay else None)


def claws(b: Bone, cx, y, z_front, spread, n=4, size=(5, 6, 10), forward=-1, splay=10.0, mat="ivory"):
    """Toe claws along the front of a foot, fanned out."""
    w, h, d = size
    for i in range(n):
        t = (i - (n - 1) / 2) / max((n - 1) / 2, 1)
        x = cx + t * spread
        z0 = z_front + (forward * d if forward < 0 else 0)
        g = (z_front, z_front + forward * d)
        b.cube((x - w / 2, y, z0), (w, h, d), mat, rot=(0, -t * splay * forward * -1, 0), pivot=(x, y, z_front), g=g, axis=2)
        # hooked tip
        b.cube((x - (w - 2) / 2, y, z0 + (forward * 3 if forward < 0 else d)), (w - 2, h - 2, 3), mat,
               rot=(0, -t * splay * forward * -1, 0), pivot=(x, y, z_front), g=g, axis=2)


def eye(m: Model, parent: Bone, name: str, side: int, x, y, z, size=4, depth=2, density=2):
    """A tiny pale eye in its own bone so it can lead a head turn.  side +1 = animal's left.
    The eye face alone is painted at double density: a quarter-block eye then has room for a
    round pupil and one highlight without the eye itself growing."""
    eb = m.bone(name, parent, pivot=(x, y + size / 2, z + size / 2))
    look = "west" if side > 0 else "east"
    n = int(size * density)
    # glint: upper, towards the snout.  On the left ("west") face u runs towards the tail.
    glint = (n // 4, n // 4) if side > 0 else (n - 1 - n // 4, n // 4)
    x0 = x - depth if side > 0 else x
    eb.cube((x0, y, z), (depth, size, size), "eye", look=look, glint=glint, pupil=0.46, tex_scale=density)
    eb.locator(name, (x + side * 0.5, y + size / 2, z + size / 2))
    return eb


def gill_set(m: Model, parent: Bone, side: int, x_surface, y0, z0, n=3, height=20, pitch=9.0, lean=14.0, closed=False,
             prefix="gill", depth=3.0, zone=None):
    """Gill slits behind the skull.  Each slit is a crimson recess plus a hide flap hinged on
    its leading edge (its own bone, so the left set can stick open on its own).
    x_surface is the flank surface; the recess sits just under it."""
    s = "l" if side > 0 else "r"
    bones = []
    for i in range(n):
        z = z0 + i * pitch
        inner = "gillscar" if closed else "gill"
        # recess, leaned like a real slit
        xr = x_surface - depth if side > 0 else x_surface
        parent.cube((xr, y0, z), (depth, height, 3.0), inner, rot=(-lean, 0, 0), pivot=(x_surface, y0 + height / 2, z + 1.5),
                    axis=1, g=(y0, y0 + height))
        fb = m.bone(f"{prefix}_{s}{i + 1}", parent, pivot=(x_surface + side * 0.6, y0 + height / 2, z - 0.5), zone=zone)
        xf = x_surface + (0.1 if side > 0 else -1.1)
        fb.cube((xf, y0 - 1, z - 0.5), (1.0, height + 2, 4.2), "skin", rot=(-lean, 0, 0),
                pivot=(x_surface, y0 + height / 2, z + 1.5), scale=(4, 3), veins=0.2)
        bones.append(fb)
    return bones


def spike(b: Bone, base, direction, length, width, mat="spike"):
    """A conical spike as three stepped boxes along `direction` (unit-ish vector)."""
    dx, dy, dz = direction
    n = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
    dx, dy, dz = dx / n, dy / n, dz / n
    # Euler angles that carry local +Y onto the direction:  v' = Rz(-rz) Ry(ry) Rx(-rx) (0,1,0)
    # choose rx to tip +Y towards +Z, then ry to swing it round.
    horiz = math.sqrt(dx * dx + dz * dz)
    tip = math.degrees(math.atan2(horiz, dy))          # angle away from +Y
    yaw = math.degrees(math.atan2(dx, dz)) if horiz > 1e-6 else 0.0
    rot = (-tip, yaw, 0.0)
    bx, by, bz = base
    g = (by - 1, by + length)
    cubes = []
    for k, (f0, f1, wf) in enumerate(((0.0, 0.30, 1.0), (0.30, 0.56, 0.74), (0.56, 0.80, 0.48), (0.80, 1.0, 0.24))):
        w = max(width * wf, 1.0)
        cubes.append(b.cube((bx - w / 2, by + f0 * length - (2 if k == 0 else 0), bz - w / 2), (w, (f1 - f0) * length + (2 if k == 0 else 0), w), mat,
                            rot=rot, pivot=base, g=g, axis=1))
    tipv = (bx + dx * length, by + dy * length, bz + dz * length)
    return cubes, tipv
