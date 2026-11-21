"""
Texture painter.  Every texel is coloured from where it sits on the animal:

  L  position in the cube's own (unrotated) frame   -> scale lattice, gradients along a part
  P  position in the model's rest pose              -> tonal patches, countershading, veins
  N  rest-pose normal                               -> baked top/side/under shading

Outputs four images that share one UV layout:
  colour  RGBA   the classic texture (alpha only for ragged fin edges)
  glow    RGBA   emissive overlay: veins between scales, plate cores, throat, gills, club
  mers    RGBA   Vibrant Visuals: metalness, emissive, roughness, subsurface (colour layer)
  gmers   RGBA   the same for the glow layer
"""
from __future__ import annotations

import numpy as np

from kit import FACES, Model, Cube, apply, hash01, value_noise

C = lambda r, g, b: np.array([r, g, b], dtype=np.float64) / 255.0

PAL = {
    # charcoal hide: four steps so three value groups always read under flat game light
    "crevice": C(17, 15, 17), "dark": C(37, 34, 36), "mid": C(57, 53, 54), "light": C(84, 78, 76),
    "chip": C(120, 112, 106),
    "belly_dark": C(50, 43, 43), "belly_mid": C(76, 65, 61), "belly_light": C(104, 91, 84),
    "crim_deep": C(50, 7, 13), "crim_dark": C(96, 13, 21), "crim": C(150, 22, 31), "crim_bright": C(206, 42, 46),
    "crim_hot": C(238, 84, 70),
    "ivory_dark": C(128, 117, 98), "ivory": C(200, 190, 166), "ivory_light": C(236, 230, 212),
    "mouth_dark": C(40, 7, 11), "mouth": C(106, 20, 27), "tongue": C(146, 46, 50),
    "eye_pale": C(238, 233, 208), "eye_shadow": C(170, 160, 130), "pupil": C(12, 9, 9), "glint": C(255, 255, 250),
    "scar": C(182, 156, 150), "scar_dark": C(122, 98, 98),
    "web": C(112, 40, 46), "web_dark": C(66, 22, 28),
    "rock_dark": C(26, 23, 25), "rock": C(44, 40, 42), "rock_light": C(66, 60, 60),
    # emissive
    "g_white": C(255, 238, 216), "g_orange": C(255, 132, 64), "g_red": C(255, 40, 30), "g_deep": C(200, 16, 22),
}

FACE_SHADE = {"up": 1.06, "down": 0.84, "north": 1.0, "south": 1.0, "east": 0.97, "west": 0.97}


def lerp(a, b, t):
    t = np.asarray(t)[..., None]
    return a * (1 - t) + b * t


def ramp(stops, t):
    """Piecewise-linear colour ramp; stops = [(pos, colour), ...]."""
    t = np.clip(np.asarray(t, dtype=np.float64), 0, 1)
    out = np.zeros(t.shape + (3,))
    for (p0, c0), (p1, c1) in zip(stops[:-1], stops[1:]):
        m = (t >= p0) & (t <= p1)
        k = np.where(p1 > p0, (t - p0) / max(p1 - p0, 1e-9), 0)
        out[m] = (c0 * (1 - k[..., None]) + c1 * k[..., None])[m]
    return out


class Ctx:
    """Everything a material needs for one face."""
    __slots__ = ("cube", "face", "p", "L", "P", "N", "w", "h", "iu", "iv", "seed", "model", "sa", "sb", "ao", "mat")


def surface_coords(face: str, L: np.ndarray):
    """Lattice coordinates on a face: `a` runs along the part, `b` across it, so scale rows
    wrap the body like rings and overlap downwards / towards the tail."""
    x, y, z = L[..., 0], L[..., 1], L[..., 2]
    if face in ("east", "west"):
        return z, -y
    if face in ("up", "down"):
        return z, x
    return x, -y


# ----------------------------------------------------------------------------- materials
def _cells(a, b, ca, cb, seed):
    """Irregular (Voronoi) scale cells on the texel lattice: nearest cell id, and how close the
    texel sits to the boundary with the next cell."""
    u = a / ca
    v = b / cb
    iu = np.floor(u).astype(np.int64)
    iv = np.floor(v).astype(np.int64)
    best = np.full(a.shape, 1e9)
    second = np.full(a.shape, 1e9)
    bi = np.zeros(a.shape, dtype=np.int64)
    bj = np.zeros(a.shape, dtype=np.int64)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ci, cj = iu + di, iv + dj
            ox = 0.16 + 0.68 * hash01(ci, cj, seed=seed)
            oy = 0.16 + 0.68 * hash01(ci, cj, seed=seed + 1)
            dx = (ci + ox - u) * ca
            dy = (cj + oy - v) * cb
            d = np.sqrt(dx * dx + dy * dy)
            closer = d < best
            second = np.where(closer, best, np.minimum(second, d))
            bi = np.where(closer, ci, bi)
            bj = np.where(closer, cj, bj)
            best = np.where(closer, d, best)
    return bi, bj, second - best


def _scales(ctx: Ctx, pal=("dark", "mid", "light"), crev="crevice", chip="chip", bias=0.0, scale=None):
    """Reptile hide: irregular polygonal scales (no two alike, no courses to read as masonry),
    each with a lit lower lip and the shadow of the scale above.  Returns (rgb, crevice, height)."""
    ca, cb = scale or ctx.p.get("scale", (5, 4))
    a = np.floor(ctx.sa) + 0.5
    b = np.floor(ctx.sb) + 0.5
    sd = ctx.seed + 200
    ci, cj, edge = _cells(a, b, ca, cb, sd)
    gap = edge < 0.95
    _, _, e_dn = _cells(a, b + 1.0, ca, cb, sd)
    _, _, e_up = _cells(a, b - 1.0, ca, cb, sd)
    lip = ~gap & (e_dn < 0.95)             # the free lower edge of a scale
    under = ~gap & (e_up < 0.95) & ~lip    # tucked beneath the scale above
    r = hash01(ci, cj, seed=ctx.seed)
    r2 = hash01(ci, cj, seed=ctx.seed + 17)
    # broad tonal patches carried by model position so they read across a bay
    n1 = value_noise(ctx.P, 56.0, ctx.seed + 3)
    n2 = value_noise(ctx.P, 18.0, ctx.seed + 5)
    tone = 0.48 * n1 + 0.20 * n2 + 0.32 * r + bias
    grp = np.where(tone < 0.42, 0, np.where(tone < 0.62, 1, 2))
    cols = np.stack([PAL[pal[0]], PAL[pal[1]], PAL[pal[2]]])
    rgb = cols[grp]
    rgb = np.where(lip[..., None], lerp(rgb, cols[np.clip(grp + 1, 0, 2)], 0.7), rgb)
    rgb = np.where(under[..., None], rgb * 0.78, rgb)
    rgb = np.where(gap[..., None], PAL[crev], rgb)
    # the finest detail: single chipped texels on a lip, only visible from a pier's distance
    ia = np.floor(ctx.sa).astype(np.int64)
    ib = np.floor(ctx.sb).astype(np.int64)
    grain = hash01(ia, ib, seed=ctx.seed + 9)
    chipm = lip & (grain > 0.88) & (r2 > 0.3)
    rgb = np.where(chipm[..., None], PAL[chip], rgb)
    rgb = np.where(gap[..., None], rgb, rgb * (0.93 + 0.14 * grain[..., None]))
    height = np.where(gap, 0.0, np.where(lip, 1.0, 0.7))
    return rgb, gap, height


def m_skin(ctx: Ctx):
    p = ctx.p
    bias = p.get("bias", 0.0)
    # countershading: the back is the darkest mass
    if "back_y" in p:
        t = np.clip((ctx.L[..., 1] - p["back_y"][0]) / max(p["back_y"][1] - p["back_y"][0], 1e-6), 0, 1)
        bias = bias - 0.16 * t
    rgb, gap, hgt = _scales(ctx, bias=bias)
    belly = None
    if "belly_y" in p:
        by = p["belly_y"]
        belly = (ctx.L[..., 1] < by) | (ctx.face == "down")
        if belly.any():
            brgb, bgap, bh = _belly(ctx)
            # two-texel dither so the transition is a ragged scale edge, not a ruled line
            edge = (ctx.L[..., 1] < by + 2) & (hash01(np.floor(ctx.sa).astype(np.int64), seed=ctx.seed + 31) > 0.5)
            m = belly | (edge & (ctx.face != "up"))
            rgb = np.where(m[..., None], brgb, rgb)
            gap = np.where(m, bgap, gap)
    glow = _veins(ctx, gap, strength=p.get("veins", 1.0))
    rough = np.where(gap, 0.86, 0.66 + 0.10 * hgt * 0)
    rough = np.where(gap, 0.9, p.get("rough", 0.68))
    return rgb, 1.0, glow, (0.0, rough, 0.0)


def _belly(ctx: Ctx):
    bw, bh = ctx.p.get("belly_scale", (11, 6))
    a, b = ctx.sa, ctx.sb
    if ctx.p.get("belly_style") == "striae":
        # long shallow plates running the length of the body, as on an eel's flank
        ia = np.floor(a).astype(np.int64)
        ib = np.floor(b).astype(np.int64)
        row = np.floor_divide(ib, bh)
        stag = np.floor(hash01(row, seed=ctx.seed + 45) * bw).astype(np.int64)
        seg = np.floor_divide(ia + stag, bw)
        gap = ((ib - row * bh) == bh - 1) | (((ia + stag) - seg * bw) == bw - 1)
        top = (ib - row * bh) == 0
        r = hash01(row, seg, seed=ctx.seed + 41)
        n = value_noise(ctx.P, 34.0, ctx.seed + 43)
        tone = 0.5 * n + 0.5 * r
        grp = np.where(tone < 0.4, 0, np.where(tone < 0.72, 1, 2))
        cols = np.stack([PAL["belly_dark"], PAL["belly_mid"], PAL["belly_light"]])
        rgb = cols[grp]
        rgb = np.where(top[..., None] & ~gap[..., None], lerp(rgb, cols[np.clip(grp + 1, 0, 2)], 0.5), rgb)
        rgb = np.where(gap[..., None], PAL["dark"], rgb)
        return rgb, gap, np.where(gap, 0.0, 1.0)
    if ctx.face in ("up", "down"):
        band = np.floor(a / bh).astype(np.int64)
        la = a - band * bh
        stag = (band & 1) * (bw / 2.0)
        seg = np.floor((b + stag) / bw).astype(np.int64)
        lb = (b + stag) - seg * bw
        gap = (la >= bh - 1.0) | (lb >= bw - 1.0)
        top = la < 1.0
    else:
        band = np.floor(a / bh).astype(np.int64)
        la = a - band * bh
        seg = np.floor(b / bw).astype(np.int64)
        gap = la >= bh - 1.0
        top = la < 1.0
    r = hash01(band, seg, seed=ctx.seed + 41)
    n = value_noise(ctx.P, 30.0, ctx.seed + 43)
    tone = 0.55 * n + 0.45 * r
    grp = np.where(tone < 0.38, 0, np.where(tone < 0.7, 1, 2))
    cols = np.stack([PAL["belly_dark"], PAL["belly_mid"], PAL["belly_light"]])
    rgb = cols[grp]
    rgb = np.where(top[..., None] & ~gap[..., None], lerp(rgb, cols[np.clip(grp + 1, 0, 2)], 0.6), rgb)
    rgb = np.where(gap[..., None], PAL["crevice"] * 1.6, rgb)
    return rgb, gap, np.where(gap, 0.0, 1.0)


def _veins(ctx: Ctx, gap, strength=1.0):
    """Emissive between the scales.  Brightest along the spine, fading down the flanks, so the
    hide looks lit from the ridge when a zone ignites."""
    m = ctx.model.meta
    y = ctx.P[..., 1]
    spine = np.clip((y - m.get("glow_y0", 0.0)) / max(m.get("glow_y1", 1.0) - m.get("glow_y0", 0.0), 1e-6), 0, 1)
    net = value_noise(ctx.P, 22.0, ctx.seed + 51)
    net2 = value_noise(ctx.P, 7.0, ctx.seed + 53)
    live = (net * 0.7 + net2 * 0.3) > (0.60 - 0.22 * spine)
    vein = gap & live
    inten = np.clip(0.35 + 0.65 * spine, 0, 1) * strength
    rgb = ramp([(0.0, PAL["g_deep"]), (0.55, PAL["g_red"]), (1.0, PAL["g_orange"])], inten)
    alpha = np.where(vein, np.clip(0.45 + 0.5 * inten, 0, 0.95), 0.0)
    # heat showing through the hide itself, strongest on the back
    wash = (0.04 + 0.13 * spine) * strength
    alpha = np.where(vein, alpha, np.where(gap, wash * 1.6, wash))
    rgb = np.where(vein[..., None], rgb, PAL["g_red"])
    return np.concatenate([rgb, alpha[..., None]], -1)


def m_belly(ctx: Ctx):
    rgb, gap, _ = _belly(ctx)
    glow = _veins(ctx, gap, strength=0.45)
    return rgb, 1.0, glow, (0.0, np.where(gap, 0.85, 0.6), 0.0)


def _grad_t(ctx: Ctx):
    """0 at the root of a plate / spike / claw, 1 at its tip."""
    ax = ctx.p.get("axis", 1)
    g0, g1 = ctx.p.get("g", (None, None))
    v = ctx.L[..., ax]
    if g0 is None:
        lo, hi = ctx.cube.bounds()
        g0, g1 = lo[ax], hi[ax]
    return np.clip((v - g0) / (g1 - g0 if abs(g1 - g0) > 1e-6 else 1.0), 0, 1)


def _rim(ctx: Ctx):
    """Texels on the outline of the face."""
    iu, iv = ctx.iu, ctx.iv
    return (iu == 0) | (iu == ctx.w - 1) | (iv == 0) | (iv == ctx.h - 1)


def m_plate(ctx: Ctx):
    """Crimson dorsal plate: deep root, bright chipped edge, painted on every side."""
    t = _grad_t(ctx)
    ax = ctx.p.get("axis", 1)
    along = ctx.L[..., 2 if ax != 2 else 0]
    streak = hash01(np.floor(along / 2.0).astype(np.int64), seed=ctx.seed + 61 + ctx.cube.idx % 7)
    t2 = np.clip(t + (streak - 0.5) * 0.22, 0, 1)
    rgb = ramp([(0.0, PAL["crim_deep"]), (0.35, PAL["crim_dark"]), (0.72, PAL["crim"]), (1.0, PAL["crim_bright"])], t2)
    rim = _rim(ctx)
    thin = min(ctx.w, ctx.h) <= 3
    chipped = hash01(ctx.iu + 13 * ctx.iv, seed=ctx.seed + 67 + ctx.cube.idx) > 0.30
    edge = (rim | thin) & chipped & (t > 0.18)
    rgb = np.where(edge[..., None], lerp(rgb, PAL["crim_hot"], 0.55), rgb)
    notch = rim & ~chipped & (t > 0.3)
    rgb = np.where(notch[..., None], rgb * 0.55, rgb)
    # emissive: white-hot at the root where it meets the spine, red at the blade edge
    g = ramp([(0.0, PAL["g_white"]), (0.25, PAL["g_orange"]), (0.6, PAL["g_red"]), (1.0, PAL["g_deep"])], t2)
    g = np.where(edge[..., None], PAL["g_orange"], g)
    ga = np.clip(0.95 - 0.25 * t, 0, 1) * np.ones_like(t)
    glow = np.concatenate([g, ga[..., None]], -1)
    return rgb, 1.0, glow, (0.0, np.where(edge, 0.3, 0.44), 0.0)


def m_spike(ctx: Ctx):
    rgb, a, glow, pbr = m_plate(ctx)
    return rgb, a, glow, pbr


def m_horn(ctx: Ctx):
    t = _grad_t(ctx)
    rgb = ramp([(0.0, PAL["rock"]), (0.3, PAL["crim_deep"]), (0.7, PAL["crim_dark"]), (1.0, PAL["crim_bright"])], t)
    rim = _rim(ctx) & (hash01(ctx.iu, ctx.iv, seed=ctx.seed + 71) > 0.5)
    rgb = np.where(rim[..., None], rgb * 1.18, rgb)
    g = ramp([(0.0, PAL["g_deep"]), (0.6, PAL["g_red"]), (1.0, PAL["g_white"])], t)
    glow = np.concatenate([g, (0.35 + 0.6 * t)[..., None]], -1)
    return rgb, 1.0, glow, (0.0, 0.5, 0.0)


def m_fin(ctx: Ctx):
    """Membrane with rays and a torn free edge (alpha cut-out)."""
    p = ctx.p
    t = _grad_t(ctx)                       # 0 root .. 1 free edge
    ray_ax = p.get("ray_axis", 2)
    rays = ctx.L[..., ray_ax]
    ridx = np.floor(rays / p.get("ray_w", 3.0)).astype(np.int64)
    ray = (np.floor(rays).astype(np.int64) % int(p.get("ray_w", 3))) == 0
    rr = hash01(ridx, seed=ctx.seed + 81 + ctx.cube.idx)
    rgb = ramp([(0.0, PAL["crim_deep"]), (0.4, PAL["crim_dark"]), (0.8, PAL["crim"]), (1.0, PAL["crim_bright"])],
               np.clip(t * (0.75 + 0.5 * rr), 0, 1))
    rgb = np.where(ray[..., None], rgb * 0.66, rgb)
    alpha = np.ones_like(t)
    rag = p.get("ragged", 0.0)
    if rag > 0:
        # each ray ends at its own length; a few are torn right back
        cut = 1.0 - rag * (0.25 + 0.75 * rr) - np.where(rr > 0.86, rag * 0.9, 0.0)
        alpha = np.where(t > cut, 0.0, 1.0)
        tip = (t > cut - 0.08) & (alpha > 0)
        rgb = np.where(tip[..., None], lerp(rgb, PAL["crim_hot"], 0.5), rgb)
    g = ramp([(0.0, PAL["g_orange"]), (0.5, PAL["g_red"]), (1.0, PAL["g_deep"])], t)
    glow = np.concatenate([g, (alpha * (0.55 - 0.25 * t))[..., None]], -1)
    return rgb, alpha, glow, (0.0, 0.42, 0.55)


def m_web(ctx: Ctx):
    t = _grad_t(ctx)
    rays = ctx.L[..., ctx.p.get("ray_axis", 0)]
    ray = (np.floor(rays).astype(np.int64) % 4) == 0
    rgb = lerp(PAL["web_dark"], PAL["web"], t)
    rgb = np.where(ray[..., None], PAL["rock"], rgb)
    alpha = np.ones_like(t)
    rag = ctx.p.get("ragged", 0.0)
    if rag > 0:
        rr = hash01(np.floor(rays / 4).astype(np.int64), seed=ctx.seed + 91)
        alpha = np.where((t > 1.0 - rag * rr) & ~ray, 0.0, 1.0)
    glow = np.concatenate([np.broadcast_to(PAL["g_deep"], rgb.shape), (alpha * 0.2)[..., None]], -1)
    return rgb, alpha, glow, (0.0, 0.5, 0.45)


def m_gill(ctx: Ctx):
    """Inside of a gill slit."""
    t = _grad_t(ctx)
    lam = (np.floor(ctx.L[..., 1]).astype(np.int64) % 2) == 0
    rgb = ramp([(0.0, PAL["crim_deep"]), (0.5, PAL["crim"]), (1.0, PAL["crim_bright"])], 1 - np.abs(t - 0.5) * 2)
    rgb = np.where(lam[..., None], rgb * 0.72, rgb)
    g = lerp(PAL["g_red"], PAL["g_orange"], 1 - np.abs(t - 0.5) * 2)
    glow = np.concatenate([g, np.full(t.shape + (1,), 0.9)], -1)
    return rgb, 1.0, glow, (0.0, 0.3, 0.35)


def m_gillscar(ctx: Ctx):
    """A gill that has grown shut: dull, puckered, only a thread of colour left."""
    t = _grad_t(ctx)
    mid = np.abs(t - 0.5) < 0.12
    rgb = np.where(mid[..., None], PAL["crim_dark"], lerp(PAL["dark"], PAL["scar_dark"] * 0.6, value_noise(ctx.P, 5, ctx.seed)))
    glow = np.concatenate([np.broadcast_to(PAL["g_red"], rgb.shape), np.where(mid, 0.7, 0.05)[..., None]], -1)
    return rgb, 1.0, glow, (0.0, 0.7, 0.1)


def m_mouth(ctx: Ctx):
    n = value_noise(ctx.P, 6.0, ctx.seed + 101)
    rgb = lerp(PAL["mouth_dark"], PAL["mouth"], n)
    glow = np.concatenate([lerp(PAL["g_orange"], PAL["g_white"], n), np.full(n.shape + (1,), 0.9)], -1)
    return rgb, 1.0, glow, (0.0, 0.25, 0.3)


def m_tongue(ctx: Ctx):
    n = value_noise(ctx.P, 5.0, ctx.seed + 103)
    rgb = lerp(PAL["mouth"], PAL["tongue"], n)
    glow = np.concatenate([np.broadcast_to(PAL["g_white"], rgb.shape), np.full(n.shape + (1,), 0.85)], -1)
    return rgb, 1.0, glow, (0.0, 0.22, 0.4)


def m_ivory(ctx: Ctx):
    """Teeth and claws."""
    t = _grad_t(ctx)
    rgb = ramp([(0.0, PAL["ivory_dark"]), (0.45, PAL["ivory"]), (1.0, PAL["ivory_light"])], t)
    stain = hash01(ctx.iu, ctx.iv, seed=ctx.seed + 111 + ctx.cube.idx) > 0.86
    rgb = np.where(stain[..., None], rgb * 0.82, rgb)
    glow = np.concatenate([np.broadcast_to(PAL["g_orange"], rgb.shape), np.full(t.shape + (1,), ctx.p.get("glow", 0.0))], -1)
    return rgb, 1.0, glow, (0.0, 0.32, 0.0)


def m_eye(ctx: Ctx):
    """A physically tiny pale eye: round, one round pupil, one highlight.  Only the face named
    by `look` shows it; the rest of the cube is brow-coloured hide."""
    if ctx.face != ctx.p.get("look"):
        rgb = np.broadcast_to(PAL["dark"] * 0.8, ctx.L.shape).copy()
        return rgb, 1.0, np.zeros(ctx.L.shape[:-1] + (4,)), (0.0, 0.7, 0.0)
    w, h = ctx.w, ctx.h
    u = (ctx.iu + 0.5) / w * 2 - 1
    v = (ctx.iv + 0.5) / h * 2 - 1
    r = np.sqrt(u * u + v * v)
    rgb = np.broadcast_to(PAL["dark"] * 0.7, ctx.L.shape).copy()
    ball = r < 1.02
    rgb = np.where(ball[..., None], lerp(PAL["eye_pale"], PAL["eye_shadow"], np.clip((v + 0.2) * 0.5, 0, 1)), rgb)
    pup = r < ctx.p.get("pupil", 0.52)
    rgb = np.where(pup[..., None], PAL["pupil"], rgb)
    # one glint, up and towards the front of the head
    gu, gv = ctx.p.get("glint", (0, 0))
    gl = (ctx.iu == gu) & (ctx.iv == gv)
    rgb = np.where(gl[..., None], PAL["glint"], rgb)
    rough = np.where(ball, 0.08, 0.7)
    return rgb, 1.0, np.zeros(ctx.L.shape[:-1] + (4,)), (0.0, rough, 0.0)


def m_rock(ctx: Ctx):
    """The tail club: slabbed, cracked, the cracks carry colour."""
    rgb, gap, _ = _scales(ctx, pal=("rock_dark", "rock", "rock_light"), scale=ctx.p.get("scale", (8, 7)))
    n = value_noise(ctx.P, 9.0, ctx.seed + 121)
    n2 = value_noise(ctx.P, 23.0, ctx.seed + 123)
    crack = (np.abs(n - 0.5) < 0.045) | (gap & (n2 > 0.5))
    rgb = np.where(crack[..., None], lerp(PAL["crevice"], PAL["crim_deep"], 0.35 + 0.5 * n2), rgb)
    g = lerp(PAL["g_red"], PAL["g_orange"], n2)
    alpha = np.where(crack, 0.92, 0.07)
    glow = np.concatenate([g, alpha[..., None]], -1)
    return rgb, 1.0, glow, (0.0, np.where(crack, 0.5, 0.82), 0.0)


def m_scar(ctx: Ctx):
    """The pale notch where the seam closed on his tail."""
    n = value_noise(ctx.P, 3.5, ctx.seed + 131)
    rgb = lerp(PAL["scar_dark"], PAL["scar"], n)
    rim = _rim(ctx)
    rgb = np.where(rim[..., None], rgb * 0.7, rgb)
    return rgb, 1.0, np.zeros(ctx.L.shape[:-1] + (4,)), (0.0, 0.55, 0.3)


def m_pit(ctx: Ctx):
    rgb = np.broadcast_to(PAL["crevice"] * 0.8, ctx.L.shape).copy()
    return rgb, 1.0, np.zeros(ctx.L.shape[:-1] + (4,)), (0.0, 0.9, 0.0)


MATERIALS = {
    "skin": m_skin, "belly": m_belly, "plate": m_plate, "spike": m_spike, "horn": m_horn, "fin": m_fin,
    "web": m_web, "gill": m_gill, "gillscar": m_gillscar, "mouth": m_mouth, "tongue": m_tongue,
    "ivory": m_ivory, "eye": m_eye, "rock": m_rock, "scar": m_scar, "pit": m_pit,
}


# ----------------------------------------------------------------------------- driver
def paint(model: Model, ao_strength: float = 1.0):
    W, H = model.tex_w, model.tex_h
    color = np.zeros((H, W, 4), dtype=np.float64)
    glow = np.zeros((H, W, 4), dtype=np.float64)
    mers = np.zeros((H, W, 4), dtype=np.float64)

    # world AABBs for the contact-shading search
    mats = [c.world_matrix() for c in model.cubes]
    invs = [np.linalg.inv(m) for m in mats]
    bnds = [c.bounds() for c in model.cubes]
    lo = np.zeros((len(model.cubes), 3))
    hi = np.zeros((len(model.cubes), 3))
    for i, c in enumerate(model.cubes):
        a, b = bnds[i]
        corners = np.array([[x, y, z] for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])])
        wc = apply(mats[i], corners)
        lo[i], hi[i] = wc.min(0), wc.max(0)

    for ci, c in enumerate(model.cubes):
        fn = MATERIALS[c.mat]
        Mw = mats[ci]
        for f, (u0, v0, w, h) in c.rects.items():
            iu, iv = np.meshgrid(np.arange(w), np.arange(h))
            S = (iu + 0.5) / w
            T = (iv + 0.5) / h
            L = c.face_points(f, S, T)
            P = apply(Mw, L.reshape(-1, 3)).reshape(h, w, 3)
            N = Mw[:3, :3] @ Cube.face_normal(f)
            ctx = Ctx()
            ctx.cube, ctx.face, ctx.p, ctx.L, ctx.P, ctx.N = c, f, c.p, L, P, N
            ctx.w, ctx.h, ctx.iu, ctx.iv, ctx.seed, ctx.model, ctx.mat = w, h, iu, iv, model.seed, model, c.mat
            ctx.sa, ctx.sb = surface_coords(f, L)
            if c.p.get("world_lattice"):
                # run the lattice in model space instead (parts that are split across rotated cubes)
                ctx.sa, ctx.sb = surface_coords(f, P)
            rgb, alpha, g, pbr = fn(ctx)

            # contact shading: how much of the space just off the surface is filled by another cube
            fl, fh = P.reshape(-1, 3).min(0) - 4.0, P.reshape(-1, 3).max(0) + 4.0
            cand = np.nonzero(np.all((lo <= fh) & (hi >= fl), axis=1))[0]
            occ = np.zeros((h, w))
            if len(cand) > 1:
                flat = P.reshape(-1, 3)
                for dist, wgt in ((1.1, 0.26), (3.2, 0.14)):
                    pts = flat + N * dist
                    inside = np.zeros(len(pts), dtype=bool)
                    for oi in cand:
                        if oi == ci:
                            continue
                        q = apply(invs[oi], pts)
                        a, b = bnds[oi]
                        inside |= np.all((q > a) & (q < b), axis=1)
                    occ += inside.reshape(h, w) * wgt
            shade = (1.0 - occ * ao_strength) * FACE_SHADE[_dominant(N)]
            rgb = np.clip(np.asarray(rgb) * shade[..., None], 0, 1)
            a_arr = np.broadcast_to(np.asarray(alpha, dtype=np.float64), (h, w))
            color[v0:v0 + h, u0:u0 + w, :3] = rgb
            color[v0:v0 + h, u0:u0 + w, 3] = a_arr
            g = np.asarray(g, dtype=np.float64).copy()
            g[..., 3] *= (1.0 - 0.5 * occ) * (a_arr > 0)
            glow[v0:v0 + h, u0:u0 + w] = g
            met, rough, sss = pbr
            mers[v0:v0 + h, u0:u0 + w, 0] = np.broadcast_to(np.asarray(met, dtype=np.float64), (h, w))
            mers[v0:v0 + h, u0:u0 + w, 1] = 0.0
            mers[v0:v0 + h, u0:u0 + w, 2] = np.broadcast_to(np.asarray(rough, dtype=np.float64), (h, w))
            mers[v0:v0 + h, u0:u0 + w, 3] = np.broadcast_to(np.asarray(sss, dtype=np.float64), (h, w))

    # fill the gutters round cut-out faces with the face's own edge texels
    for (u0, v0, w, h) in model.gutters:
        for img in (color, glow, mers):
            img[v0 - 1, u0:u0 + w] = img[v0, u0:u0 + w]
            img[v0 + h, u0:u0 + w] = img[v0 + h - 1, u0:u0 + w]
            img[v0 - 1:v0 + h + 1, u0 - 1] = img[v0 - 1:v0 + h + 1, u0]
            img[v0 - 1:v0 + h + 1, u0 + w] = img[v0 - 1:v0 + h + 1, u0 + w - 1]

    wet = model.meta.get("wetness", 0.0)
    if wet:
        mers[..., 2] = np.clip(mers[..., 2] * (1 - 0.45 * wet), 0.04, 1)

    # glow MERS: emissive follows the painted glow; calibrated against vanilla (creaking eyes peak at 64/255)
    gmers = np.zeros_like(mers)
    gmers[..., 1] = np.clip(glow[..., 3], 0, 1) * (72 / 255.0)
    gmers[..., 2] = 1.0
    return to8(color), to8(glow), to8(mers), to8(gmers)


def _dominant(N):
    i = int(np.argmax(np.abs(N)))
    if i == 1:
        return "up" if N[1] > 0 else "down"
    if i == 0:
        return "east"
    return "north"


def to8(a: np.ndarray) -> np.ndarray:
    return np.clip(np.round(a * 255.0), 0, 255).astype(np.uint8)
