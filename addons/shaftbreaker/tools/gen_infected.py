"""Generates the infected cave biome blocks (the Shaftbreaker's home): behavior-pack block JSON and
loot, procedural 16x16 textures, block geometries, the flipbook for the pulsing flesh and a manifest
(tools/infected_manifest.json) that gen_rp.py merges into terrain_texture.json, blocks.json and the
lang files.

Every texture is procedural (numpy/PIL). The organic models (organ cores, watcher pods, dripfangs) are
voxel shapes meshed into cubes; each exposed cube face is textured by planar projection, so a 16x16
texture wraps the shape the same way a full block's faces do.

usage: python3 tools/gen_infected.py
"""
import json, os, math, itertools
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, 'Shaftbreaker_BP')
RP = os.path.join(ROOT, 'Shaftbreaker_RP')
NS = 'shaftbreaker'
TEX = 'textures/blocks/infected'
GEO_FILE = 'models/blocks/infected.geo.json'
MANIFEST = os.path.join(ROOT, 'tools/infected_manifest.json')
N = 16

terrain = {}      # texture key -> path without .png
written = []      # every file this script writes (for verify())


def w(base, rel, obj):
    p = os.path.join(base, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as f:
        json.dump(obj, f, indent=2)
    written.append(p)


def save_tex(key, fname, arr):
    """arr: (H, W, 4) float/uint8 RGBA. Registers sb_inf_<key> -> textures/blocks/infected/<fname>."""
    a = np.clip(np.round(arr), 0, 255).astype(np.uint8)
    a[..., 3] = np.where(a[..., 3] >= 128, 255, 0)          # alpha_test: fully on or off
    a[a[..., 3] == 0, :3] = 0
    p = os.path.join(RP, TEX, fname + '.png')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    Image.fromarray(a, 'RGBA').save(p)
    written.append(p)
    terrain['sb_inf_' + key] = f'{TEX}/{fname}'
    return 'sb_inf_' + key


# =============================================================== pixel helpers
def per_noise(n, cells, seed, octaves=2, persistence=0.5):
    """tileable value noise in [0,1]"""
    r = np.random.default_rng(seed)
    out = np.zeros((n, n)); amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = cells * 2 ** o
        g = r.random((c, c))
        t = (np.arange(n) + 0.5) * c / n - 0.5
        i0 = np.floor(t).astype(int); f = t - i0; f = f * f * (3 - 2 * f)
        a, b = i0 % c, (i0 + 1) % c
        fx, fy = f[None, :], f[:, None]
        v = (g[np.ix_(a, a)] * (1 - fx) + g[np.ix_(a, b)] * fx) * (1 - fy) + (g[np.ix_(b, a)] * (1 - fx) + g[np.ix_(b, b)] * fx) * fy
        out += amp * v; tot += amp; amp *= persistence
    return out / tot


def eq(f):
    """rank-normalise to a uniform [0,1] distribution"""
    flat = f.ravel(); r = np.empty(flat.size); r[flat.argsort(kind='stable')] = np.arange(flat.size)
    return (r / max(1, flat.size - 1)).reshape(f.shape)


def pal(f, cols, weights=None):
    """map a field in [0,1] to a palette (dark->light); weights shape how many pixels get each tone"""
    cols = np.asarray(cols, float); k = len(cols)
    wts = np.ones(k) if weights is None else np.asarray(weights, float)
    edges = np.cumsum(wts) / wts.sum()
    idx = np.searchsorted(edges, np.clip(f, 0, 0.99999), side='right')
    return cols[np.clip(idx, 0, k - 1)]


def lerp(a, b, t):
    return np.asarray(a, float) * (1 - t) + np.asarray(b, float) * t


def blank(h=N, w_=N):
    return np.zeros((h, w_, 4), float)


def opaque(rgb):
    img = blank(*rgb.shape[:2]); img[..., :3] = rgb; img[..., 3] = 255
    return img


def voronoi(n, pts, periodic=True, aspect=1.0):
    ys, xs = np.mgrid[0:n, 0:n] + 0.5
    ds, vec = [], []
    for px, py in pts:
        dx = xs - px; dy = (ys - py) * aspect
        if periodic:
            dx = (dx + n / 2) % n - n / 2; dy = (dy + n / 2) % n - n / 2
        ds.append(np.hypot(dx, dy)); vec.append((dx, dy))
    ds = np.array(ds); idx = ds.argmin(0); srt = np.sort(ds, 0)
    vx = np.choose(idx, [v[0] for v in vec]); vy = np.choose(idx, [v[1] for v in vec])
    return idx, srt[0], srt[1], vx, vy


def edges(idx, periodic=True):
    """1-pixel borders between cells (right/down neighbour differs)"""
    if periodic:
        return (idx != np.roll(idx, -1, 1)) | (idx != np.roll(idx, -1, 0))
    e = np.zeros(idx.shape, bool)
    e[:, :-1] |= idx[:, :-1] != idx[:, 1:]; e[:-1, :] |= idx[:-1, :] != idx[1:, :]
    return e


def dome(vx, vy, f1, f2, light=(-0.55, -0.6, 0.6)):
    """lumpy shading of voronoi cells: each cell a dome lit from the top-left"""
    rad = np.maximum((f1 + f2) / 2, 1.0)
    nx, ny = vx / rad, vy / rad
    nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0.02, 1))
    L = np.array(light) / np.linalg.norm(light)
    return np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)


def walk(r, start, steps, ang, wobble=0.4, n=N, wrap=True):
    x, y = start; out = []
    for _ in range(steps):
        p = (int(math.floor(x)) % n, int(math.floor(y)) % n) if wrap else (int(math.floor(x)), int(math.floor(y)))
        if not out or out[-1] != p:
            out.append(p)
        ang += r.normal(0, wobble)
        x += math.cos(ang); y += math.sin(ang)
    return out, ang


def neigh4(mask, periodic=True):
    if periodic:
        return np.roll(mask, 1, 0) | np.roll(mask, -1, 0) | np.roll(mask, 1, 1) | np.roll(mask, -1, 1)
    m = np.zeros_like(mask)
    m[1:] |= mask[:-1]; m[:-1] |= mask[1:]; m[:, 1:] |= mask[:, :-1]; m[:, :-1] |= mask[:, 1:]
    return m


# =============================================================== palettes
STONE = [(44, 33, 38), (60, 46, 52), (77, 60, 66), (95, 75, 81), (114, 91, 96), (136, 110, 113)]
STONE_W = [0.08, 0.17, 0.28, 0.25, 0.15, 0.07]
DEEP_STONE = [(30, 22, 26), (42, 32, 37), (55, 42, 48), (68, 53, 59), (84, 66, 72)]
VEIN_DK, VEIN, VEIN_HI = (70, 12, 20), (104, 18, 28), (142, 32, 38)
HOT = [(110, 14, 14), (176, 30, 20), (226, 62, 28), (252, 112, 46), (255, 170, 96)]
FLESH = [(64, 9, 15), (88, 14, 21), (112, 21, 28), (136, 30, 36), (160, 42, 46), (186, 60, 60), (212, 88, 84)]
PLATE = [(100, 32, 38), (126, 46, 50), (150, 60, 62), (170, 74, 74), (190, 90, 88), (210, 110, 104), (230, 138, 130)]
POD = [(84, 28, 36), (106, 38, 46), (128, 50, 56), (148, 62, 66), (168, 76, 78), (188, 94, 94), (208, 116, 114)]
ROOT = [(62, 4, 10), (104, 8, 16), (146, 14, 24), (184, 28, 36), (222, 64, 64), (255, 168, 156)]
BONE = [(124, 94, 86), (162, 128, 116), (194, 162, 146), (218, 190, 172), (238, 218, 202)]
DRIP = [(104, 80, 78), (130, 104, 98), (154, 126, 118), (176, 148, 138), (196, 170, 158), (216, 194, 180)]
WET = [(92, 82, 84), (120, 110, 112), (150, 142, 144), (180, 176, 180), (212, 214, 220), (240, 244, 250)]
MOSS = [(58, 4, 10), (88, 8, 16), (120, 14, 22), (152, 22, 30), (184, 40, 44), (220, 84, 80)]
CAP = [(204, 100, 58), (238, 136, 82), (255, 164, 104), (255, 190, 136), (255, 216, 172)]
CRYSTAL = [(70, 4, 14), (116, 12, 26), (162, 24, 38), (204, 46, 56), (236, 96, 96), (255, 170, 160)]


def mottle(seed, cells=4):
    """Minecraft-stone style field: smooth blotches + 2x2 clusters + pixel grain"""
    r = np.random.default_rng(seed)
    blocky = r.random((N // 2, N // 2)).repeat(2, 0).repeat(2, 1)
    blocky = np.roll(np.roll(blocky, r.integers(0, 2), 0), r.integers(0, 2), 1)
    return per_noise(N, cells, seed, 2) * 0.45 + blocky * 0.3 + r.random((N, N)) * 0.25


def stone_base(seed, cols=STONE, weights=STONE_W, cells=4):
    return pal(eq(mottle(seed, cells)), cols, weights)


def draw_veins(rgb, seed, count=1, steps=20, branch=True, cols=(VEIN_DK, VEIN, VEIN_HI)):
    r = np.random.default_rng(seed)
    mask = np.zeros((N, N), bool); hi = np.zeros((N, N), bool)
    for k in range(count):
        pts, ang = walk(r, (r.uniform(0, N), r.uniform(0, N)), steps, r.uniform(0, math.tau), 0.45)
        for i, (x, y) in enumerate(pts):
            mask[y, x] = True
            if i % 7 == 3:
                hi[y, x] = True
        if branch:
            for frac, turn in ((0.35, 1.2), (0.7, -1.3)):
                bx, by = pts[int(len(pts) * frac)]
                bp, _ = walk(r, (bx + 0.5, by + 0.5), 5, ang + turn, 0.5)
                for x, y in bp:
                    mask[y, x] = True
    out = rgb.copy()
    shadow = np.roll(np.roll(mask, 1, 0), 1, 1) & ~mask          # below-right of a vein: in shadow
    seep = np.roll(np.roll(mask, -1, 0), -1, 1) & ~mask           # above-left: stone stained with blood
    out[shadow] *= 0.74
    out[seep] = lerp(out[seep], (100, 48, 52), 0.22)
    out[mask] = cols[1]
    lone = mask & ~neigh4(mask)
    out[lone] = cols[0]
    out[mask & hi] = cols[2]
    return out, mask


# =============================================================== full-block textures
def tex_veinstone():
    rgb = stone_base(101)
    rgb, _ = draw_veins(rgb, 104, count=1, steps=20)
    return save_tex('veinstone', 'veinstone', opaque(rgb))


def tex_cracked_veinstone():
    r = np.random.default_rng(201)
    rgb = stone_base(202, weights=[0.12, 0.22, 0.3, 0.2, 0.11, 0.05])
    pts = [(2.5, 3.0), (10.0, 1.5), (6.5, 8.5), (13.5, 9.0), (3.0, 13.0), (10.5, 14.5)]
    idx, f1, f2, vx, vy = voronoi(N, pts, True)
    # chunks of rock pushed apart: each chunk a slightly different tone, darker toward its edges
    tone = r.normal(0, 0.06, len(pts))
    rgb *= (1 + tone[idx])[..., None]
    rgb *= np.clip(0.78 + 0.08 * (f2 - f1), 0.78, 1.0)[..., None]
    e = edges(idx)
    keep = {(0, 2), (2, 3), (2, 4), (1, 2), (3, 5), (0, 1), (4, 5), (1, 3)}       # which cell borders crack open
    rt = np.roll(idx, -1, 1); dn = np.roll(idx, -1, 0)
    ok = np.zeros_like(e)
    for y in range(N):
        for x in range(N):
            for o in (rt[y, x], dn[y, x]):
                pr = tuple(sorted((idx[y, x], o)))
                if pr[0] != pr[1] and pr in keep:
                    ok[y, x] = True
    crack = e & ok
    deg = sum(np.roll(np.roll(crack, dy, 0), dx, 1).astype(int) for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)])
    heat = per_noise(N, 4, 203, 1) * 0.65 + r.random((N, N)) * 0.25 + (deg >= 3) * 0.35
    rim = neigh4(crack) & ~crack
    rim2 = neigh4(rim | crack) & ~crack & ~rim
    rgb[rim2] = lerp(rgb[rim2], (96, 34, 32), 0.3)
    dark = r.random((N, N)) < 0.5
    rgb[rim & dark] = (34, 12, 14)
    rgb[rim & ~dark] = lerp(rgb[rim & ~dark], (168, 40, 26), 0.6)
    rgb[crack] = pal(np.clip(heat[crack], 0, 1), HOT[1:], [0.34, 0.4, 0.19, 0.07])
    return save_tex('cracked_veinstone', 'cracked_veinstone', opaque(rgb))


def tex_fleshstone():
    r = np.random.default_rng(301)
    pts = [(r.uniform(0, N), r.uniform(0, N)) for _ in range(10)]
    idx, f1, f2, vx, vy = voronoi(N, pts, True)
    f = eq(mottle(302)) * 0.6 + dome(vx, vy, f1, f2) * 0.4
    rgb = pal(eq(f), FLESH[1:], [0.1, 0.18, 0.26, 0.24, 0.14, 0.08])
    e = edges(idx) & (r.random((N, N)) < 0.55)
    rgb[e] = FLESH[0]
    peak = (f > np.quantile(f, 0.97)) & ~e
    rgb[peak] = (232, 128, 118)                                      # wet glint on the tallest lumps
    return save_tex('fleshstone', 'fleshstone', opaque(rgb))


PULSE_FRAMES = 6


def seg_dist(px, py, ax, ay, bx, by, n=N):
    """distance from pixel centres to a segment, on a torus"""
    best = np.full(px.shape, 1e9)
    for ox in (-n, 0, n):
        for oy in (-n, 0, n):
            dx, dy = bx - ax, by - ay
            t = np.clip(((px - ax - ox) * dx + (py - ay - oy) * dy) / (dx * dx + dy * dy), 0, 1)
            d = np.hypot(px - (ax + ox + t * dx), py - (ay + oy + t * dy))
            best = np.minimum(best, d)
    return best


def tex_pulsing_flesh():
    r = np.random.default_rng(401)
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    # glossy tendrils: three tileable tubes, each pixel shaded by where it sits across the tube
    best = np.full((N, N), 9.0); signed = np.zeros((N, N))
    for x0, ph, amp in [(1.5, 0.3, 1.0), (8.0, 2.4, 1.3), (13.5, 4.6, 0.9)]:
        cx = x0 + amp * np.sin(ys / N * math.tau + ph)
        d = (xs - cx + N / 2) % N - N / 2
        m = np.abs(d) < np.abs(best)
        best[m] = np.abs(d[m]); signed[m] = d[m]
    for a_, b_ in [((2.0, 8.5), (8.0, 14.0)), ((8.5, 1.0), (13.5, 6.0))]:   # branches joining the tubes
        d = seg_dist(xs, ys, *a_, *b_)
        m = d < best
        best[m] = d[m]; signed[m] = (d * np.sign(ys - xs + (a_[0] - a_[1])))[m]
    tube = best < 1.3
    lit = tube & (signed < -0.35); shd = tube & (signed > 0.45); mid = tube & ~lit & ~shd
    base = pal(eq(mottle(402)), [(34, 3, 8), (48, 5, 11), (62, 8, 14), (78, 12, 18)], [0.2, 0.35, 0.3, 0.15])
    beside = ~tube & (best < 2.1)
    eyes = [(5.5, 4.5, 2.5), (11.5, 11.5, 2.5), (3.5, 12.5, 1.6)]
    frames = []
    for k in range(PULSE_FRAMES):
        p = k / (PULSE_FRAMES - 1)
        rgb = base * (0.9 + 0.3 * p)
        rgb[beside] *= 0.65                                            # deep shadow along each tendril
        rgb[lit] = lerp((176, 40, 44), (246, 104, 92), p)
        rgb[mid] = lerp((132, 22, 30), (212, 52, 50), p)
        rgb[shd] = lerp((86, 10, 18), (150, 26, 30), p)
        spec = lit & ((((ys * 5 + xs * 3).astype(int)) % 7) == 0)
        rgb[spec] = lerp((220, 140, 130), (255, 232, 220), p)
        for (ex, ey, er) in eyes:
            d = np.hypot(xs - ex, ys - ey)
            halo = (d >= er + 0.6) & (d < er + 1.5)
            rgb[halo] = lerp(rgb[halo], (236, 70, 40), 0.15 + 0.45 * p)
            rgb[(d >= er) & (d < er + 0.6)] = (40, 4, 8)                      # the lid
            iris = d < er
            t = np.clip(1 - d[iris] / er, 0, 1)[:, None]
            rgb[iris] = lerp(lerp((196, 44, 26), (255, 96, 40), p), lerp((255, 150, 80), (255, 214, 140), p), t)
            rgb[iris & (np.abs(xs - ex) < 0.5) & (np.abs(ys - ey) < er * 0.65)] = (26, 0, 2)   # slit pupil
            rgb[(np.abs(xs - (ex - 1)) < 0.5) & (np.abs(ys - (ey - 1)) < 0.5)] = lerp((255, 200, 170), (255, 248, 230), p)
        frames.append(opaque(rgb))
    return save_tex('pulsing_flesh', 'pulsing_flesh', np.concatenate(frames, 0))


def bone_band(rgb, dist, th, r, seg_coord, seg_len=4.5):
    """a rib: a bone band of thickness th along a distance field, segmented into joints"""
    band = np.abs(dist) < th / 2
    t = (dist + th / 2) / th                                   # 0 = top edge (lit), 1 = underside
    f = np.clip(1 - t * 0.9 + r.random(dist.shape) * 0.16 - 0.08, 0, 1)
    col = pal(f, BONE, [0.14, 0.2, 0.3, 0.24, 0.12])
    rgb[band] = col[band]
    joint = band & (np.abs((seg_coord % seg_len) - seg_len / 2) < 0.5)
    rgb[joint] = lerp(rgb[joint], BONE[0], 0.7)
    under = (dist >= th / 2) & (dist < th / 2 + 1.0)
    rgb[under] *= 0.5
    return band


def tex_ribstone():
    r = np.random.default_rng(501)
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    rgb = stone_base(502, DEEP_STONE, [0.12, 0.28, 0.32, 0.2, 0.08])
    rgb, _ = draw_veins(rgb, 503, count=1, steps=10, branch=False)
    # two ribs arching across the face, like a ribcage seen from the side
    for cx, cy, rad, th in [(8.0, 21.0, 15.5, 4.2), (8.0, 21.0, 9.0, 3.6)]:
        d = np.hypot(xs - cx, ys - cy) - rad
        ang = np.arctan2(ys - cy, xs - cx)
        bone_band(rgb, -d, th, r, ang * rad)
    side = save_tex('ribstone', 'ribstone', opaque(rgb))
    rgb = stone_base(504, DEEP_STONE, [0.12, 0.28, 0.32, 0.2, 0.08])
    rgb, _ = draw_veins(rgb, 505, count=1, steps=12, branch=False)
    for cx, cy, rad in [(4.5, 4.5, 3.4), (11.5, 11.0, 3.8), (12.5, 3.0, 1.9), (3.5, 12.5, 2.0)]:   # rib ends, cut across
        d = np.hypot(xs - cx, ys - cy)
        f = np.clip(1 - (d / rad) * 0.7 - (xs - cx + ys - cy) / rad * 0.25 + r.random((N, N)) * 0.12, 0, 1)
        bone = d < rad
        rgb[bone] = pal(f, BONE, [0.14, 0.2, 0.3, 0.24, 0.12])[bone]
        rgb[d < rad * 0.38] = BONE[0]                                    # marrow
        ring = (d >= rad) & (d < rad + 0.9)
        rgb[ring] *= 0.55
    top = save_tex('ribstone_top', 'ribstone_top', opaque(rgb))
    return side, top


# =============================================================== organic textures (planar-projected onto models)
def plates(seed, n_pts, cols, crack_col, weights=None, hot=None, spacing=4.4, grain=0.07, top_light=0.12):
    """tileable voxel-shell texture: dome-shaded plates split by dark cracks (globe-mapped onto models,
    so it must tile; the geometry supplies the roundness, the texture only a soft light from above)"""
    r = np.random.default_rng(seed)
    pts = []
    tor = lambda a, b: math.hypot(min(abs(a[0] - b[0]), N - abs(a[0] - b[0])), min(abs(a[1] - b[1]), N - abs(a[1] - b[1])))
    while len(pts) < n_pts:
        p = (r.uniform(0, N), r.uniform(0, N))
        if all(tor(p, q) > spacing for q in pts):
            pts.append(p)
    idx, f1, f2, vx, vy = voronoi(N, pts, True)
    tone = r.normal(0, 0.09, len(pts))
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    sh = 0.5 + (dome(vx, vy, f1, f2) - 0.5) * 0.45 + tone[idx] + (r.random((N, N)) - 0.5) * grain + top_light * (0.5 - ys / N)
    sh += 0.03 * (((xs.astype(int) // 2 + ys.astype(int) // 2) % 2) - 0.5)                      # fine scales
    rgb = pal(np.clip(sh, 0, 1), cols, weights)
    e = edges(idx)
    rgb[e] = crack_col
    if hot is not None:
        hmask = e & (r.random((N, N)) < hot[0])
        rgb[hmask] = hot[1]
    lip = np.roll(e, -1, 0) & ~e                          # pixel above a crack: lit plate edge
    rgb[lip] = lerp(rgb[lip], (255, 196, 178), 0.2)
    shd = np.roll(e, 1, 0) & ~e                           # pixel below a crack: in its shadow
    rgb[shd] *= 0.9
    return rgb, e


def tex_organ():
    rgb, _ = plates(612, 5, PLATE, (74, 16, 22), [0.06, 0.11, 0.2, 0.25, 0.2, 0.12, 0.06], hot=(0.08, (224, 64, 40)), spacing=5.6)
    shell = save_tex('organ_core', 'organ_core', opaque(rgb))
    # the hot interior: bright at the middle of every face, fibrous towards the edges
    r = np.random.default_rng(602)
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    d = np.hypot(xs - 8, ys - 8) / 8
    fib = per_noise(N, 4, 603, 2)
    f = np.clip(1 - d * 1.1 + (fib - 0.5) * 0.5 + r.random((N, N)) * 0.1, 0, 1)
    rgb = pal(f, [(112, 12, 14), (156, 22, 20), (200, 42, 28), (236, 76, 40), (255, 128, 68), (255, 196, 132)],
              [0.16, 0.22, 0.24, 0.18, 0.12, 0.08])
    glow = save_tex('organ_core_glow', 'organ_core_glow', opaque(rgb))
    # roots: glossy red, streaked so they read on any face
    f = per_noise(N, 4, 604, 2) * 0.55 + r.random((N, N)) * 0.2 + ((xs + ys * 0.6) % 4 < 1.2) * 0.25
    rgb = pal(eq(f), ROOT, [0.1, 0.22, 0.3, 0.24, 0.11, 0.03])
    root = save_tex('organ_core_root', 'organ_core_root', opaque(rgb))
    # cracked core: darker split plates; light leaks through the cracks
    rgb, e = plates(611, 5, [(62, 16, 22), (84, 24, 30), (106, 34, 38), (128, 46, 48), (150, 60, 60), (172, 76, 74)],
                    HOT[1], [0.1, 0.16, 0.24, 0.24, 0.16, 0.1], hot=(0.15, HOT[3]), spacing=5.6)
    near = np.roll(e, -1, 0) & ~e
    rgb[near] = lerp(rgb[near], (196, 56, 36), 0.2)
    cracked = save_tex('cracked_organ_core', 'cracked_organ_core', opaque(rgb))
    return shell, glow, root, cracked


def tex_watcher_pod():
    r = np.random.default_rng(701)
    rgb, e = plates(705, 5, POD, (52, 12, 18), [0.07, 0.13, 0.21, 0.24, 0.18, 0.11, 0.06], spacing=5.6)
    closed = save_tex('watcher_pod', 'watcher_pod', opaque(rgb))
    rgb2 = rgb.copy()                                              # opened: light leaks out of every crack
    rgb2[e] = HOT[2]
    rgb2[e & (r.random((N, N)) < 0.3)] = HOT[3]
    near = neigh4(e, False) & ~e
    rgb2[near] = lerp(rgb2[near], (196, 52, 40), 0.4)
    opened = save_tex('watcher_pod_open', 'watcher_pod_open', opaque(rgb2))
    # inner flesh of the petals and cup: wet, lit red by the eye
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    f = per_noise(N, 4, 703, 2) * 0.55 + r.random((N, N)) * 0.2 + 0.25 * (np.sin(xs * 1.1 + ys * 0.5) > 0.6)
    rgb = pal(eq(f), [(76, 8, 14), (104, 12, 20), (132, 20, 26), (162, 32, 34), (194, 52, 46), (226, 88, 70)],
              [0.12, 0.22, 0.28, 0.2, 0.12, 0.06])
    inner = save_tex('watcher_pod_inner', 'watcher_pod_inner', opaque(rgb))
    # the eye: a burning iris filling the core's faces, a thin slit pupil, a glint
    d = np.hypot(xs - 7.5, ys - 7.5)
    ang = np.arctan2(ys - 7.5, xs - 7.5)
    rgb = pal(np.clip(1 - d / 4.6 + 0.08 * np.sin(ang * 9) + r.random((N, N)) * 0.06, 0, 1),
              [(150, 16, 16), (206, 40, 26), (240, 76, 38), (255, 120, 60), (255, 170, 96), (255, 214, 150)],
              [0.3, 0.16, 0.16, 0.14, 0.12, 0.12])
    rgb[(d > 4.4) & (r.random((N, N)) < 0.2)] = (96, 6, 10)            # veins in the white of it
    rgb[(d > 4.0) & (d < 4.7)] = (70, 4, 8)
    rgb[(np.abs(xs - 7.5) < 0.5) & (np.abs(ys - 7.5) < 2.6)] = (20, 0, 2)
    rgb[(np.abs(xs - 5.5) < 0.5) & (np.abs(ys - 5.5) < 0.5)] = (255, 246, 228)
    eye = save_tex('watcher_pod_eye', 'watcher_pod_eye', opaque(rgb))
    f = per_noise(N, 4, 704, 2) * 0.55 + r.random((N, N)) * 0.2 + ((xs - ys * 0.5) % 5 < 1.3) * 0.25
    rgb = pal(eq(f), ROOT, [0.1, 0.22, 0.3, 0.24, 0.11, 0.03])
    root = save_tex('watcher_pod_root', 'watcher_pod_root', opaque(rgb))
    return closed, opened, inner, eye, root


def tex_dripfang():
    r = np.random.default_rng(801)
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    band = np.array([r.normal(0, 0.14) for _ in range(N)])[:, None]
    band[3::4] -= 0.18                                          # ledges between the layers of rock
    f = eq(mottle(802)) * 0.6 + band + r.random((N, N)) * 0.1
    rgb = pal(eq(f), DRIP, [0.06, 0.14, 0.24, 0.27, 0.19, 0.1])
    for x in r.choice(N, 4, replace=False):                     # vertical crevices
        y0 = r.integers(0, N); ln = r.integers(3, 7)
        for y in range(y0, y0 + ln):
            rgb[y % N, x] = DRIP[0]
    for x in r.choice(N, 3, replace=False):                     # wet streaks
        y0 = r.integers(0, N)
        for y in range(y0, y0 + 6):
            rgb[y % N, x] = lerp(rgb[y % N, x], (226, 232, 238), 0.35)
    body = save_tex('dripfang', 'dripfang', opaque(rgb))
    f = eq(mottle(803)) * 0.7 + r.random((N, N)) * 0.15 + (ys / N) * 0.15
    rgb = pal(eq(f), WET, [0.08, 0.2, 0.3, 0.24, 0.13, 0.05])
    rgb = lerp(rgb, DRIP[3], 0.35)
    wet = save_tex('dripfang_wet', 'dripfang_wet', opaque(rgb))
    rgb = np.zeros((N, N, 3)) + (190, 178, 182)
    rgb[(xs + ys) % 5 < 1] = (236, 230, 232)
    rgb[(xs * 3 + ys) % 7 < 1] = (150, 136, 140)
    drop = save_tex('dripfang_drop', 'dripfang_drop', opaque(rgb))
    return body, wet, drop


# =============================================================== alpha (cutout) textures
STRANDS = [(1.5, 0.0, 0.6), (7.0, 2.1, 0.8), (12.0, 4.0, 0.6)]          # x, phase, sway: three thick glossy strands
VINE = [(96, 6, 14), (150, 16, 26), (196, 32, 40), (232, 80, 78), (255, 176, 166)]


def strand_x(x0, ph, amp, y):
    return x0 + amp * math.sin(y / N * math.tau + ph)


def paint_strand(img, x0, ph, amp, y_from, y_to, bead=False, knots=()):
    """a 3px glossy strand of root: lit left edge, red core, dark right edge, the odd wet glint"""
    for y in range(y_from, y_to):
        x = int(math.floor(strand_x(x0, ph, amp, y)))
        img[y, x % N] = (*VINE[3], 255)
        img[y, (x + 1) % N] = (*VINE[2], 255)
        img[y, (x + 2) % N] = (*VINE[0], 255)
        if y in knots:                                           # a swollen knot in the vine
            img[y, (x - 1) % N] = (*VINE[1], 255); img[y, (x + 3) % N] = (*VINE[0], 255)
        if (y * 7 + int(x0) * 3) % 9 == 0:
            img[y, x % N] = (*VINE[4], 255)
    if bead:                                                     # a fat drop of blood about to fall
        x = int(math.floor(strand_x(x0, ph, amp, y_to - 1)))
        for dy, (a, b) in enumerate([(-1, 5), (-1, 5), (0, 3), (1, 1)]):
            for xx in range(x + a, x + a + b):
                if y_to + dy < N:
                    img[y_to + dy, xx % N] = (*VINE[1], 255)
            if y_to + dy < N:
                img[y_to + dy, (x + a) % N] = (*VINE[2], 255)
        if y_to + 1 < N:
            img[y_to, x % N] = (*VINE[4], 255)


def tex_bloodroot():
    img = blank()
    for (x0, ph, amp), knots in zip(STRANDS, [(4, 11), (7,), (2, 13)]):
        paint_strand(img, x0, ph, amp, 0, N, knots=knots)
    body = save_tex('bloodroot_vines', 'bloodroot_vines', img)
    img = blank()
    for (x0, ph, amp), end in zip(STRANDS, [7, 10, 5]):
        paint_strand(img, x0, ph, amp, 0, end, bead=True, knots=(3,))
    x = int(strand_x(*STRANDS[2], 5)) + 1                         # a drop falling from the shortest strand
    img[12, x] = (*VINE[2], 255); img[13, x] = (*VINE[1], 255); img[12, x - 0] = (*VINE[4], 255)
    tip = save_tex('bloodroot_vines_tip', 'bloodroot_vines_tip', img)
    return body, tip


def spike(img, x0, w0, h, lean, cols=CRYSTAL):
    """a faceted crystal spike growing from the bottom row"""
    for k in range(h):
        y = N - 1 - k
        t = k / max(1, h - 1)
        half = w0 / 2 * (1 - t) ** 0.85
        cx = x0 + lean * k
        x_lo, x_hi = cx - half, cx + half
        for x in range(int(math.floor(x_lo)), int(math.ceil(x_hi))):
            if not (0 <= x < N):
                continue
            fx = (x + 0.5 - x_lo) / max(0.5, x_hi - x_lo)
            c = cols[4] if fx < 0.34 else cols[3] if fx < 0.6 else cols[2]
            if x == int(math.floor(x_lo)) or x == int(math.ceil(x_hi)) - 1:
                c = cols[1] if fx > 0.5 else cols[3]
            if k >= h - 2:
                c = cols[5]
            img[y, x] = (*c, 255)


def tex_thorns():
    img = blank()
    for x0, w0, h, lean in [(2.5, 3, 9, -0.22), (6.0, 4, 14, -0.05), (9.5, 3, 11, 0.2), (13.0, 3, 8, 0.3),
                            (4.5, 2, 6, -0.4), (11.5, 2, 5, -0.25)]:
        spike(img, x0, w0, h, lean)
    for x in range(N):                                           # crystal rubble at the root
        if img[15, x, 3] == 0 and x % 3 != 1:
            img[15, x] = (*CRYSTAL[1], 255)
    cross = save_tex('crimson_thorns', 'crimson_thorns', img)
    # crystal faces for the cube spikes: vertical facets, brighter towards the tips (top rows)
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    f = 0.55 * (1 - ys / N) + 0.3 * ((xs.astype(int) % 3) == 0) + 0.15 * np.random.default_rng(951).random((N, N))
    rgb = pal(np.clip(f, 0, 1), CRYSTAL[1:], [0.16, 0.3, 0.26, 0.18, 0.1])
    crystal = save_tex('crimson_thorns_crystal', 'crimson_thorns_crystal', opaque(rgb))
    return cross, crystal


def tex_glowspore():
    r = np.random.default_rng(1001)
    img = blank()
    STEM = [(110, 78, 62), (148, 110, 86), (184, 146, 116)]
    for sx, h, cw in [(2, 5, 3), (6, 8, 3), (11, 4, 3), (13, 7, 3), (9, 2, 1)]:
        for k in range(h):
            img[N - 1 - k, sx] = (*STEM[1 if k % 3 else 2], 255)
        top = N - 1 - h
        for i in range(-(cw // 2), cw // 2 + 1):
            img[top, sx + i] = (*CAP[2], 255)
            if cw > 1:
                img[top + 1, sx + i] = (*CAP[0], 255)
        img[top, sx] = (*CAP[4], 255)
        if cw > 1:
            img[top + 1, sx] = (*CAP[3], 255)                    # glowing gills under the cap
    for x, y in [(4, 4), (9, 2), (14, 5), (1, 8)]:               # drifting spores
        img[y, x] = (*CAP[3], 255)
    for x in range(0, N, 2):                                     # grit
        if img[15, x, 3] == 0:
            img[15, x] = (70, 54, 58, 255)
    cross = save_tex('glowspore_cluster', 'glowspore_cluster', img)
    ys, xs = np.mgrid[0:N, 0:N] + 0.5
    f = 0.7 - ys / N * 0.45 + r.random((N, N)) * 0.3
    rgb = pal(np.clip(f, 0, 1), [(84, 60, 50), *STEM, (204, 170, 138)], [0.1, 0.22, 0.32, 0.24, 0.12])
    stem = save_tex('glowspore_cluster_stem', 'glowspore_cluster_stem', opaque(rgb))
    # cap atlas (explicit UVs in the geometry): tops 5x5 at (0,0), 4x4 at (5,0), 3x3 at (9,0) and (12,0),
    # 3x3 at (5,4); rim band rows 8-9; gills rows 11-15
    rgb = np.zeros((N, N, 3)) + CAP[1]
    for (u, v, s) in [(0, 0, 5), (5, 0, 4), (9, 0, 3), (12, 0, 3), (5, 4, 3)]:
        for y in range(s):
            for x in range(s):
                dd = math.hypot(x + 0.5 - s / 2, y + 0.5 - s / 2) / (s / 2)
                c = CAP[3] if dd < 0.5 else CAP[2] if dd < 0.9 else CAP[1]
                if r.random() < 0.15:
                    c = CAP[4]
                rgb[v + y, u + x] = c
    rgb[8, :] = CAP[2]; rgb[9, :] = CAP[0]
    rgb[8, ::3] = CAP[3]; rgb[9, 1::4] = (176, 80, 46)
    rgb[10, :] = CAP[0]
    for y in range(11, 16):
        for x in range(N):
            rgb[y, x] = CAP[4] if (x + y) % 2 else CAP[2]      # the gills glow brightest
    cap = save_tex('glowspore_cluster_cap', 'glowspore_cluster_cap', opaque(rgb))
    return cross, stem, cap


def tex_bloodmoss():
    r = np.random.default_rng(1101)
    pts = [(r.uniform(0, N), r.uniform(0, N)) for _ in range(12)]
    idx, f1, f2, vx, vy = voronoi(N, pts, True)
    sh = dome(vx, vy, f1, f2) * 0.75 + r.random((N, N)) * 0.2
    rgb = pal(sh, MOSS[1:], [0.12, 0.22, 0.3, 0.22, 0.14])
    e = edges(idx)
    rgb[e & (r.random((N, N)) < 0.7)] = MOSS[0]
    gl = (sh > np.quantile(sh, 0.95)) & ~e
    rgb[gl] = (240, 132, 122)
    top = save_tex('bloodmoss', 'bloodmoss', opaque(rgb))
    # side atlas: rows 0-1 are the moss edge (layer sides), rows 2-11 the drips hanging over the edge
    img = blank()
    for x in range(N):
        img[0, x] = (*MOSS[4 if x % 3 else 5], 255)
        img[1, x] = (*MOSS[3 if x % 4 else 2], 255)
    for x, ln in [(0, 3), (2, 7), (5, 4), (8, 9), (11, 5), (13, 8)]:   # 2px drips, a bead on each end
        for k in range(ln):
            img[2 + k, x] = (*MOSS[4], 255)
            img[2 + k, x + 1] = (*MOSS[2], 255)
        y = 2 + ln
        if y + 1 < 12:
            img[y, x] = (*MOSS[4], 255); img[y, x + 1] = (*MOSS[3], 255)
            img[y + 1, x] = (196, 24, 32, 255); img[y + 1, x + 1] = (150, 14, 22, 255)
        img[2 + ln // 2, x] = (246, 150, 140, 255)
    for x in (4, 10, 15):
        img[2, x] = (*MOSS[3], 255)
    side = save_tex('bloodmoss_side', 'bloodmoss_side', img)
    return top, side


# =============================================================== geometry: voxel meshing
FACES = ('north', 'south', 'east', 'west', 'up', 'down')


def face_uv(face, x0, y0, z0, x1, y1, z1):
    """planar projection of a box face onto the 16x16 texture (block coords: x,z in -8..8, y in 0..16)"""
    if face == 'north':
        return [8 - x1, 16 - y1], [x1 - x0, y1 - y0]
    if face == 'south':
        return [x0 + 8, 16 - y1], [x1 - x0, y1 - y0]
    if face == 'east':
        return [8 - z1, 16 - y1], [z1 - z0, y1 - y0]
    if face == 'west':
        return [z0 + 8, 16 - y1], [z1 - z0, y1 - y0]
    return [x0 + 8, z0 + 8], [x1 - x0, z1 - z0]


WRAP = 32.0      # texels once around a wrapped (globe-mapped) shape: the 16-wide texture repeats twice


def wrap_u(face, x0, z0, x1, z1):
    """globe mapping for a side face: u follows the angle around the vertical axis, so faces meeting at
    a step corner share their texture coordinate and plates flow round the shape without breaking up"""
    ends = {'north': ((x1, z0), (x0, z0)), 'south': ((x0, z1), (x1, z1)),
            'east': ((x1, z1), (x1, z0)), 'west': ((x0, z0), (x0, z1))}[face]
    side = -1e-9 if max(z0, z1) <= 0 else 1e-9               # boxes never straddle z=0 (the seam)
    sl, sr = [-math.atan2(z + side, x) / math.tau * WRAP for x, z in ends]
    shift = math.floor(min(sl, sr) / 16 + 1e-9) * 16
    return round(sl - shift, 4), round(sr - sl, 4)


class Vox:
    """16^3 voxel grid in block space; label 0 = empty. labels map to material instance names;
    labels in `wrap` get globe-mapped side faces (see wrap_u) instead of planar projection."""

    def __init__(self, labels, wrap=()):
        self.g = np.zeros((N, N, N), np.int16)          # [x, y, z]
        self.labels = labels                            # {int: instance name ('*' = default)}
        self.wrap = set(wrap)

    def put(self, i, j, k, lab, over=True):
        if 0 <= i < N and 0 <= j < N and 0 <= k < N and (over or self.g[i, j, k] == 0):
            self.g[i, j, k] = lab

    def cubes(self):
        """greedy-merge voxels of one label into boxes; every axis order is tried, the fewest boxes win"""
        best = None
        for order in itertools.permutations((0, 1, 2)):
            boxes = self._greedy(order)
            if best is None or len(boxes) < len(best):
                best = boxes
        out = [self._box(lab, *lo, *hi) for lab, lo, hi in best]
        return [c for c in out if c['uv']]

    def _greedy(self, order):
        g = self.g.transpose(order)
        seam_ax = order.index(2)                         # wrapped labels never merge across z = 0
        seen = np.zeros(g.shape, bool)
        boxes = []

        def free(sl, lab):
            return np.all(g[sl] == lab) and not seen[sl].any()

        for c in range(N):
            for b_ in range(N):
                for a in range(N):
                    lab = g[a, b_, c]
                    if lab == 0 or seen[a, b_, c]:
                        continue
                    seam = lab in self.wrap
                    lo, hi = [a, b_, c], [a + 1, b_ + 1, c + 1]
                    for ax in range(3):
                        while hi[ax] < N and not (seam and ax == seam_ax and hi[ax] == 8):
                            nxt = [slice(lo[t], hi[t]) for t in range(3)]
                            nxt[ax] = slice(hi[ax], hi[ax] + 1)
                            if not free(tuple(nxt), lab):
                                break
                            hi[ax] += 1
                    seen[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] = True
                    olo, ohi = [0, 0, 0], [0, 0, 0]
                    for t in range(3):
                        olo[order[t]], ohi[order[t]] = lo[t], hi[t]
                    boxes.append((lab, olo, ohi))
        return boxes

    def _exposed(self, sl):
        """any empty voxel (or outside the grid) in the slab next to a face"""
        return sl is None or (sl == 0).any()

    def _box(self, lab, i0, j0, k0, i1, j1, k1):
        g = self.g
        nb = {
            'west': g[i0 - 1, j0:j1, k0:k1] if i0 > 0 else None,
            'east': g[i1, j0:j1, k0:k1] if i1 < N else None,
            'down': g[i0:i1, j0 - 1, k0:k1] if j0 > 0 else None,
            'up': g[i0:i1, j1, k0:k1] if j1 < N else None,
            'north': g[i0:i1, j0:j1, k0 - 1] if k0 > 0 else None,
            'south': g[i0:i1, j0:j1, k1] if k1 < N else None,
        }
        x0, y0, z0, x1, y1, z1 = i0 - 8, j0, k0 - 8, i1 - 8, j1, k1 - 8
        uv = {}
        inst = self.labels[lab]
        for f in FACES:
            if self._exposed(nb[f]):
                a, s = face_uv(f, x0, y0, z0, x1, y1, z1)
                if lab in self.wrap and f in ('north', 'south', 'east', 'west'):
                    u, su = wrap_u(f, x0, z0, x1, z1)
                    a, s = [u, a[1]], [su, s[1]]
                d = {'uv': a, 'uv_size': s}
                if inst != '*':
                    d['material_instance'] = inst
                uv[f] = d
        return {'origin': [x0, y0, z0], 'size': [x1 - x0, y1 - y0, z1 - z0], 'uv': uv}


def cyl(i, k):
    """voxel centre -> (radius, angle) about the block's vertical axis"""
    x, z = i - 7.5, k - 7.5
    return math.hypot(x, z), math.atan2(z, x)


def angdiff(a, b):
    return (a - b + math.pi) % math.tau - math.pi


def ground_roots(v, lab, seed, count=7, r0=3.0, reach=8.4, climb=0):
    """roots spreading over the ground from under the model, a few climbing it"""
    r = np.random.default_rng(seed)
    for i in range(N):
        for k in range(N):
            if cyl(i, k)[0] < r0 + 0.6:
                v.put(i, 0, k, lab)
    for n in range(count):
        ang = n / count * math.tau + r.uniform(-0.35, 0.35)
        rad = r0; wob = 0.0
        while rad < reach:
            wob += r.normal(0, 0.18)
            x = 7.5 + math.cos(ang + wob * 0.25) * rad; z = 7.5 + math.sin(ang + wob * 0.25) * rad
            i, k = int(round(x)), int(round(z))
            v.put(i, 0, k, lab)
            if rad < r0 + 2.2:
                v.put(i, 1, k, lab, over=False)
            rad += 0.7
    return r


def sphere_vox(v, lab, c, rad, seed=None, lumps=0.0, inner=None, over=True):
    r = np.random.default_rng(seed or 0)
    bumps = [(r.normal(size=3), r.uniform(0.3, 0.7)) for _ in range(5)] if lumps else []
    for i in range(N):
        for j in range(N):
            for k in range(N):
                p = np.array([i + 0.5 - 8 - c[0], j + 0.5 - c[1], k + 0.5 - 8 - c[2]])
                d = np.linalg.norm(p)
                rr = rad
                for b, s in bumps:
                    b = b / np.linalg.norm(b)
                    rr += lumps * s * max(0, np.dot(p, b) / max(d, 1e-6)) ** 6
                if d <= rr and (inner is None or d > inner):
                    v.put(i, j, k, lab, over)


def surface_lines(v, lab, c, rad, seed, count, from_top=True, y_min=1.0, thick=1, stop=0.62):
    """root strands draped over a round shape (one voxel proud of its surface)"""
    r = np.random.default_rng(seed)
    for n in range(count):
        ang = n / count * math.tau + r.uniform(-0.4, 0.4)
        phi = 0.05 if from_top else 1.75
        wob = r.uniform(-0.2, 0.2)
        while phi < math.pi * stop:
            rr = rad + 0.55
            x = c[0] + math.sin(phi) * math.cos(ang) * rr
            z = c[2] + math.sin(phi) * math.sin(ang) * rr
            y = c[1] + math.cos(phi) * rr * c[3]
            if y >= y_min:
                i, j, k = int(math.floor(x + 8)), int(math.floor(y)), int(math.floor(z + 8))
                v.put(i, j, k, lab, over=False)
                if thick > 1:                                          # widen sideways (along the parallel)
                    ti, tk = -math.sin(ang), math.cos(ang)
                    v.put(int(math.floor(x + 8 + ti)), j, int(math.floor(z + 8 + tk)), lab, over=False)
            ang += wob * 0.08 + r.normal(0, 0.03)
            phi += 0.07


def geo(ident, cubes):
    return {'description': {'identifier': ident, 'texture_width': 16, 'texture_height': 16},
            'bones': [{'name': 'b', 'pivot': [0, 0, 0], 'cubes': cubes}]}


def g_organ_core():
    v = Vox({1: '*', 2: 'root'}, wrap={1})
    ground_roots(v, 2, 1201, count=7, r0=3.6)
    sphere_vox(v, 1, (0, 8.3, 0), 6.75)
    surface_lines(v, 2, (0, 8.3, 0, 1.0), 6.75, 1203, 4, from_top=False, thick=1)
    return geo('geometry.sb_inf_organ_core', v.cubes())


def g_cracked_organ_core():
    r = np.random.default_rng(1301)
    v = Vox({1: '*', 2: 'root', 3: 'glow'}, wrap={1})
    ground_roots(v, 2, 1302, count=7, r0=3.6)
    c = (0, 8.0, 0)
    sphere_vox(v, 3, c, 5.2)                                      # the burning heart
    phase = r.uniform(0, math.tau)
    wedges = [r.uniform(0, math.tau) for _ in range(3)]
    for i in range(N):
        for j in range(N):
            for k in range(N):
                p = (i - 7.5, j + 0.5 - c[1], k - 7.5)
                d = math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2)
                if not (5.2 < d <= 6.75):
                    continue
                ang = math.atan2(p[2], p[0])
                rim = 12.2 + 1.4 * math.sin(3 * ang + phase) + 0.7 * math.sin(7 * ang)
                if j + 0.5 > rim:
                    continue                                          # the top has burst open
                gap = any(abs(angdiff(ang, wa)) < 0.04 + max(0, (j - 5.5)) * 0.03 for wa in wedges)
                if gap and j >= 4:
                    continue                                          # split seams down the sides
                v.put(i, j, k, 1)
    surface_lines(v, 2, (0, 8.0, 0, 1.0), 6.75, 1303, 4, from_top=False)
    return geo('geometry.sb_inf_cracked_organ_core', v.cubes())


def g_watcher_pod(opened):
    r = np.random.default_rng(1401)
    v = Vox({1: '*', 2: 'root', 3: 'inner', 4: 'glow'}, wrap={1, 3})
    ground_roots(v, 2, 1402, count=8, r0=3.4)
    c = (0, 7.6, 0); rx, ry = 6.4, 7.0
    if not opened:
        for i in range(N):
            for j in range(N):
                for k in range(N):
                    x, y, z = i - 7.5, j + 0.5 - c[1], k - 7.5
                    if (x * x + z * z) / rx ** 2 + y * y / ry ** 2 <= 1.0:
                        v.put(i, j, k, 1)
        # veins netted over the pod from its crown, as if it was let down on them
        surface_lines(v, 2, (0, c[1], 0, ry / rx), rx, 1403, 6, from_top=True, y_min=1, thick=2, stop=0.75)
        return geo('geometry.sb_inf_watcher_pod', v.cubes())
    # opened: a cup of shell, the eye awake in it, and four stepped petals of shell splayed to the corners
    for i in range(N):
        for j in range(N):
            for k in range(N):
                x, y, z = i - 7.5, j + 0.5 - c[1], k - 7.5
                e = (x * x + z * z) / rx ** 2 + y * y / ry ** 2
                if j + 0.5 < 6.2 and e <= 1.0:
                    v.put(i, j, k, 1 if e > 0.6 else 3)
    sphere_vox(v, 4, (0, 8.6, 0), 4.2, over=False)
    surface_lines(v, 2, (0, c[1], 0, ry / rx), rx, 1404, 5, from_top=False, y_min=1, thick=2)
    cubes = v.cubes()
    for rot in (45, 135, -45, -135):
        cubes += petal(rot, PETAL_TALL)
    for rot in (0, 90, 180, -90):
        cubes += petal(rot, PETAL_SHORT)
    return geo('geometry.sb_inf_watcher_pod_open', cubes)


def fit_uv(a, s):
    """shift a planar uv region back inside the 16x16 texture (regions never exceed 16)"""
    out = []
    for p, q in zip(a, s):
        lo = min(p, p + q)
        sh = -lo if lo < 0 else (16 - max(p, p + q) if max(p, p + q) > 16 else 0)
        out.append(round(p + sh, 4))
    return out


PETAL_TALL = [(3.0, 4.0, 6.5, 4.2), (2.8, 6.5, 9.0, 5.6), (2.2, 9.0, 11.0, 7.0), (1.4, 11.0, 12.5, 8.0)]   # to the corners
PETAL_SHORT = [(2.5, 4.0, 6.0, 4.4), (2.2, 6.0, 8.0, 5.4), (1.6, 8.0, 10.0, 6.2)]                       # to the sides


def petal(rot, slabs):
    """one petal of the opened pod: stepped slabs (half-width, y0, y1, z0) built facing +z, then turned
    about the centre. Only Y rotations by multiples of 45 degrees, so the set looks the same either way round."""
    cubes = []
    for hw, y0, y1, z0 in slabs:
        z1 = z0 + 1.8
        x0, x1 = -hw, hw
        uv = {}
        for f in ('south', 'north', 'east', 'west', 'up'):
            a, sz = face_uv(f, x0, y0, z0, x1, y1, z1)
            d = {'uv': fit_uv(a, sz), 'uv_size': sz}
            if f == 'north':
                d['material_instance'] = 'inner'                    # the inside of the shell, lit by the eye
            uv[f] = d
        cubes.append({'origin': [x0, y0, z0], 'size': [x1 - x0, y1 - y0, round(z1 - z0, 4)], 'pivot': [0, 0, 0],
                      'rotation': [0, rot, 0], 'uv': uv})
    return cubes


def g_dripfang(tip):
    """a stalactite of stacked rings of rock (2-3 px tall); the tip tapers to a wet point and a drop"""
    r = np.random.default_rng(1511 + tip)
    v = Vox({1: '*', 2: 'wet', 3: 'drop'}, wrap={1, 2})
    ph = r.uniform(0, math.tau)
    bands = [(13, 16), (10, 13), (8, 10), (5, 8), (3, 5), (0, 3)]
    for j0, j1 in bands:
        jm = (j0 + j1) / 2
        if tip:
            t = (jm - 2.0) / 13.5
            if t <= 0:
                continue
            rad = 0.7 + 4.3 * t ** 1.25 + r.uniform(-0.25, 0.25)
        else:
            rad = 4.8 + 0.9 * (jm / 16.0) + r.uniform(-0.3, 0.3)
        for j in range(j0, j1):
            for i in range(N):
                for k in range(N):
                    x, z = i - 7.5, k - 7.5
                    a = math.atan2(z, x)
                    rr = math.hypot(x, z) / (1 + 0.06 * math.sin(2 * a + ph + j0) + 0.05 * math.sin(3 * a - ph))
                    if rr <= rad:
                        wet = tip and j < 7 and rr > rad - 1.1
                        v.put(i, j, k, 2 if wet else 1)
    if tip:
        for j in (1, 2):
            v.put(7, j, 7, 2)                                              # the last wet point
        v.put(7, 0, 7, 3)                                                  # the bead about to fall
    return geo('geometry.sb_inf_dripfang_tip' if tip else 'geometry.sb_inf_dripfang', v.cubes())


# =============================================================== geometry: hand-built
DIAG = 16 * math.sqrt(2)


def plane(rot, inst=None, uv=(0, 0), size=(16, 16), h=16, y0=0):
    """a cross-plane quad corner to corner across the block (like vanilla plants); double sided via alpha_test"""
    face = {'uv': list(uv), 'uv_size': list(size)}
    if inst:
        face['material_instance'] = inst
    return {'origin': [round(-DIAG / 2, 4), y0, 0], 'size': [round(DIAG, 4), h, 0], 'pivot': [0, 0, 0], 'rotation': [0, rot, 0],
            'uv': {'north': face}}


def g_cross():
    return geo('geometry.sb_inf_cross', [plane(45), plane(-45)])


def tapered_spike(px, pz, h, rot, inst='crystal'):
    """a crystal spike of three stacked cubes leaning on one pivot (one-axis rotation)"""
    segs = [(3, 0.42), (2, 0.36), (1, 0.22)]
    cubes, y = [], 0.0
    for wid, frac in segs:
        ln = round(h * frac, 2)
        x0, z0 = px - wid / 2, pz - wid / 2
        uv = {}
        for f in FACES[:5]:
            a, s = face_uv(f, x0, y, z0, x0 + wid, y + ln, z0 + wid)
            uv[f] = {'uv': [round(a[0], 3), round(a[1], 3)], 'uv_size': [round(s[0], 3), round(s[1], 3)], 'material_instance': inst}
        cubes.append({'origin': [x0, y, z0], 'size': [wid, ln, wid], 'pivot': [px, 0, pz], 'rotation': rot, 'uv': uv})
        y = round(y + ln, 2)
    return cubes


def g_thorns():
    cubes = [plane(45), plane(-45)]
    for px, pz, h, rot in [(-1.5, -1.0, 12, [0, 0, 22.5]), (1.5, 1.5, 10, [-22.5, 0, 0]), (2.0, -2.0, 8, [0, 0, -22.5]),
                           (-2.0, 2.0, 7, [22.5, 0, 0]), (0.0, 0.0, 9, [0, 0, 0])]:
        cubes += tapered_spike(px, pz, h, rot)
    return geo('geometry.sb_inf_crimson_thorns', cubes)


def g_glowspore():
    cubes = [plane(45), plane(-45)]

    def stem(x, z, h, u, wd=1):
        uv = {f: {'uv': [u, 16 - h], 'uv_size': [wd, h], 'material_instance': 'stem'} for f in FACES[:4]}
        return {'origin': [x + 0.5 - wd / 2, 0, z + 0.5 - wd / 2], 'size': [wd, h, wd], 'uv': uv}

    def cap(cx, cz, y, s, top_uv, h=2):
        x0, z0 = cx + 0.5 - s / 2, cz + 0.5 - s / 2
        uv = {f: {'uv': [0, 8], 'uv_size': [s, h], 'material_instance': 'glow'} for f in FACES[:4]}
        uv['up'] = {'uv': list(top_uv), 'uv_size': [s, s], 'material_instance': 'glow'}
        uv['down'] = {'uv': [0, 11], 'uv_size': [s, s], 'material_instance': 'glow'}
        return {'origin': [x0, y, z0], 'size': [s, h, s], 'uv': uv}

    for (x, z, h, s, bump, u) in [(-3, -2, 7, 4, True, 2), (1, 2, 10, 5, True, 6), (3, -4, 5, 3, False, 9), (-5, 3, 3, 3, False, 12)]:
        cubes.append(stem(x, z, h, u, 2 if h >= 7 else 1))
        cubes.append(cap(x, z, h, s, (0, 0) if s == 5 else (5, 0) if s == 4 else (9, 0)))
        if bump:
            cubes.append(cap(x, z, h + 2, s - 2, (5, 4) if s == 5 else (12, 0), h=1))
    return geo('geometry.sb_inf_glowspore_cluster', cubes)


def g_bloodmoss():
    cubes = [{'origin': [-8, 0, -8], 'size': [16, 2, 16], 'uv': {
        **{f: {'uv': [0, 0], 'uv_size': [16, 2], 'material_instance': 'side'} for f in FACES[:4]},
        'up': {'uv': [0, 0], 'uv_size': [16, 16]}}}]
    for (x, z, sx, sz) in [(-5, -4, 3, 2), (2, -6, 2, 3), (3, 3, 4, 2), (-6, 4, 2, 2), (-1, 0, 2, 2)]:
        uv = {f: {'uv': face_uv(f, x, 2, z, x + sx, 3, z + sz)[0], 'uv_size': face_uv(f, x, 2, z, x + sx, 3, z + sz)[1]} for f in FACES[:5]}
        cubes.append({'origin': [x, 2, z], 'size': [sx, 1, sz], 'uv': uv})
    # drips over the ledge: curtains hanging just outside the side faces of the block below
    o = 8.06
    drip = {'uv': [0, 2], 'uv_size': [16, 10], 'material_instance': 'side'}
    cubes += [{'origin': [-8, -10, -o], 'size': [16, 10, 0], 'uv': {'north': dict(drip)}},
              {'origin': [-8, -10, o], 'size': [16, 10, 0], 'uv': {'south': dict(drip)}},
              {'origin': [o, -10, -8], 'size': [0, 10, 16], 'uv': {'east': dict(drip)}},
              {'origin': [-o, -10, -8], 'size': [0, 10, 16], 'uv': {'west': dict(drip)}}]
    return geo('geometry.sb_inf_bloodmoss', cubes)


# =============================================================== behavior pack
def blk(name, comps, states=None, perms=None, cat='nature'):
    desc = {'identifier': f'{NS}:{name}', 'menu_category': {'category': cat}}
    if states:
        desc['states'] = states
    b = {'format_version': '1.21.60', 'minecraft:block': {'description': desc, 'components': comps}}
    if perms:
        b['minecraft:block']['permutations'] = perms
    w(BP, f'blocks/infected/{name}.json', b)


def mat(tex, method='opaque', glow=False):
    m = {'texture': tex, 'render_method': method}
    if glow:
        m['face_dimming'] = False          # the "glow" material: lit evenly from inside, no side shading
    return m


def full(tex, secs, blast, color, light=0, loot=None, glow=False, mats=None, stone=False):
    c = {'minecraft:geometry': 'minecraft:geometry.full_block',
         'minecraft:destructible_by_mining': {'seconds_to_destroy': secs},
         'minecraft:destructible_by_explosion': {'explosion_resistance': blast},
         'minecraft:map_color': color,
         'minecraft:material_instances': mats or {'*': mat(tex, 'opaque', glow)}}
    if light:
        c['minecraft:light_emission'] = light
    if loot:
        c['minecraft:loot'] = loot
    if stone:
        c['tag:stone'] = {}
        c['tag:minecraft:is_pickaxe_item_destructible'] = {}
    return c


def deco(geom, mats, secs, color, sel, light=0, collision=False, faces=None, loot=None, blast=1):
    c = {'minecraft:geometry': geom,
         'minecraft:material_instances': mats,
         'minecraft:destructible_by_mining': {'seconds_to_destroy': secs},
         'minecraft:destructible_by_explosion': {'explosion_resistance': blast},
         'minecraft:collision_box': collision,
         'minecraft:selection_box': {'origin': sel[0], 'size': sel[1]},
         'minecraft:light_dampening': 0,
         'minecraft:map_color': color}
    if light:
        c['minecraft:light_emission'] = light
    if faces:
        c['minecraft:placement_filter'] = {'conditions': [{'allowed_faces': faces, 'block_filter': [{'tags': "!q.any_tag('air')"}]}]}
    if loot:
        c['minecraft:loot'] = loot
    return c


LOOT = 'loot_tables/blocks/infected'


def behavior(t):
    w(BP, f'{LOOT}/empty.json', {'pools': []})
    w(BP, f'{LOOT}/cracked_veinstone.json', {'pools': [{'rolls': 1, 'entries': [{'type': 'item', 'name': f'{NS}:veinstone', 'weight': 1}]}]})
    for name, lo, hi in [('organ_core', 1, 3), ('cracked_organ_core', 2, 4)]:
        w(BP, f'{LOOT}/{name}.json', {'pools': [{'rolls': 1, 'entries': [
            {'type': 'item', 'name': f'{NS}:resonance_shard', 'weight': 1, 'functions': [{'function': 'set_count', 'count': {'min': lo, 'max': hi}}]}]}]})

    blk('veinstone', full(t['veinstone'], 1.5, 6, '#4b3c45', stone=True))
    blk('cracked_veinstone', full(t['cracked_veinstone'], 1.5, 6, '#7a2c22', light=6, glow=True, stone=True,
                                  loot=f'{LOOT}/cracked_veinstone.json'))
    blk('fleshstone', full(t['fleshstone'], 1.0, 3, '#7a1620'))
    blk('pulsing_flesh', full(t['pulsing_flesh'], 1.2, 3, '#8e1c24', light=4, loot=f'{LOOT}/empty.json'))
    blk('ribstone', full(None, 2.0, 6, '#6e6058', stone=True, mats={
        '*': mat(t['ribstone']), 'up': mat(t['ribstone_top']), 'down': mat(t['ribstone_top'])}))

    a = 'alpha_test'
    organ_mats = {'*': mat(t['organ_core'], a), 'root': mat(t['organ_core_root'], a), 'glow': mat(t['organ_core_glow'], a, True)}
    blk('organ_core', deco('geometry.sb_inf_organ_core', organ_mats, 1.0, '#a8443e',
                           ([-7, 0, -7], [14, 15, 14]), light=9, collision={'origin': [-7, 0, -7], 'size': [14, 15, 14]},
                           faces=['up', 'side'], loot=f'{LOOT}/organ_core.json', blast=2))
    blk('cracked_organ_core', deco('geometry.sb_inf_cracked_organ_core',
                                   {'*': mat(t['cracked_organ_core'], a), 'root': mat(t['organ_core_root'], a), 'glow': mat(t['organ_core_glow'], a, True)},
                                   1.0, '#e0502c', ([-7, 0, -7], [14, 15, 14]), light=13,
                                   collision={'origin': [-7, 0, -7], 'size': [14, 13, 14]},
                                   faces=['up', 'side'], loot=f'{LOOT}/cracked_organ_core.json', blast=2))

    tip = "q.block_state('shaftbreaker:tip') == true"
    blk('bloodroot_vines', deco('geometry.sb_inf_cross', {'*': mat(t['bloodroot_vines'], a)}, 0.2, '#5c0c14',
                                ([-6, 0, -6], [12, 16, 12]), faces=['down']),
        states={'shaftbreaker:tip': [False, True]},
        perms=[{'condition': tip, 'components': {
            'minecraft:material_instances': {'*': mat(t['bloodroot_vines_tip'], a)},
            'minecraft:selection_box': {'origin': [-6, 3, -6], 'size': [12, 13, 12]}}}])
    blk('crimson_thorns', deco('geometry.sb_inf_crimson_thorns', {'*': mat(t['crimson_thorns'], a), 'crystal': mat(t['crimson_thorns_crystal'], a)},
                               0.5, '#b4202e', ([-7, 0, -7], [14, 12, 14]), light=2, faces=['up']))
    blk('glowspore_cluster', deco('geometry.sb_inf_glowspore_cluster',
                                  {'*': mat(t['glowspore_cluster'], a), 'stem': mat(t['glowspore_cluster_stem'], a),
                                   'glow': mat(t['glowspore_cluster_cap'], a, True)},
                                  0.05, '#f0a46e', ([-7, 0, -7], [14, 13, 14]), light=11, faces=['up']))
    blk('bloodmoss', deco('geometry.sb_inf_bloodmoss', {'*': mat(t['bloodmoss'], a), 'side': mat(t['bloodmoss_side'], a)},
                          0.2, '#7c1018', ([-8, 0, -8], [16, 2, 16]), faces=['up']))
    drip_mats = {'*': mat(t['dripfang'], a), 'wet': mat(t['dripfang_wet'], a), 'drop': mat(t['dripfang_drop'], a)}
    blk('dripfang', deco('geometry.sb_inf_dripfang', drip_mats, 0.6, '#a89a8c', ([-5, 0, -5], [10, 16, 10]), faces=['down'], blast=2),
        states={'shaftbreaker:tip': [False, True]},
        perms=[{'condition': tip, 'components': {
            'minecraft:geometry': 'geometry.sb_inf_dripfang_tip',
            'minecraft:selection_box': {'origin': [-4, 1, -4], 'size': [8, 15, 8]}}}])
    pod_mats = {'*': mat(t['watcher_pod'], a), 'root': mat(t['watcher_pod_root'], a)}
    open_mats = {'*': mat(t['watcher_pod_open'], a), 'root': mat(t['watcher_pod_root'], a),
                 'inner': mat(t['watcher_pod_inner'], a, True), 'glow': mat(t['watcher_pod_eye'], a, True)}
    blk('watcher_pod', deco('geometry.sb_inf_watcher_pod', pod_mats, 1.0, '#7c1a22', ([-7, 0, -7], [14, 15, 14]), light=3,
                            collision={'origin': [-7, 0, -7], 'size': [14, 14, 14]}, faces=['up', 'side'], loot=f'{LOOT}/empty.json', blast=2),
        states={'shaftbreaker:open': [False, True]},
        perms=[{'condition': "q.block_state('shaftbreaker:open') == true", 'components': {
            'minecraft:geometry': 'geometry.sb_inf_watcher_pod_open',
            'minecraft:material_instances': open_mats,
            'minecraft:light_emission': 12,
            'minecraft:selection_box': {'origin': [-8, 0, -8], 'size': [16, 16, 16]}}}])


# =============================================================== manifest, flipbook
BLOCKS = {
    # id: (display name, blocks.json sound, particle/inventory texture key)
    'veinstone': ('Veinstone', 'deepslate', 'veinstone'),
    'cracked_veinstone': ('Cracked Veinstone', 'deepslate', 'cracked_veinstone'),
    'fleshstone': ('Fleshstone', 'mud', 'fleshstone'),
    'pulsing_flesh': ('Pulsing Flesh', 'sculk', 'pulsing_flesh'),
    'organ_core': ('Organ Core', 'sculk_catalyst', 'organ_core'),
    'cracked_organ_core': ('Cracked Organ Core', 'sculk_catalyst', 'cracked_organ_core'),
    'bloodroot_vines': ('Bloodroot Vines', 'weeping_vines', 'bloodroot_vines'),
    'crimson_thorns': ('Crimson Cave Thorns', 'amethyst_cluster', 'crimson_thorns'),
    'glowspore_cluster': ('Glowspore Cluster', 'fungus', 'glowspore_cluster'),
    'bloodmoss': ('Bloodmoss', 'moss_carpet', 'bloodmoss'),
    'ribstone': ('Ribstone', 'bone_block', 'ribstone'),
    'dripfang': ('Dripfang Stalactite', 'pointed_dripstone', 'dripfang'),
    'watcher_pod': ('Watcher Pod', 'nether_wart', 'watcher_pod'),
}
PULSE_SEQUENCE = [0, 0, 0, 0, 0, 0, 2, 5, 3, 2, 4, 3, 2, 1, 1, 0]      # a heartbeat: lub, dub, rest


def manifest():
    w(RP, 'textures/flipbook_textures.json', [{
        'flipbook_texture': terrain['sb_inf_pulsing_flesh'], 'atlas_tile': 'sb_inf_pulsing_flesh',
        'ticks_per_frame': 3, 'frames': PULSE_SEQUENCE, 'blend_frames': True}])
    m = {'terrain_texture': dict(sorted(terrain.items())),
         'blocks_json': {f'{NS}:{b}': {'sound': s, 'textures': f'sb_inf_{tk}'} for b, (_, s, tk) in BLOCKS.items()},
         'lang': {f'tile.{NS}:{b}.name': n for b, (n, _, _) in BLOCKS.items()}}
    with open(MANIFEST, 'w') as f:
        json.dump(m, f, indent=2)
    written.append(MANIFEST)


# =============================================================== self-check
def verify():
    errs = []
    for p in written:
        if p.endswith('.json'):
            try:
                json.load(open(p))
            except Exception as e:
                errs.append(f'{p}: {e}')
    man = json.load(open(MANIFEST))
    tt = man['terrain_texture']
    for k, pth in tt.items():
        if not k.startswith('sb_inf_'):
            errs.append(f'texture key {k} lacks sb_inf_ prefix')
        if not os.path.exists(os.path.join(RP, pth + '.png')):
            errs.append(f'{k}: {pth}.png missing')
    geos = {g['description']['identifier']: g for g in json.load(open(os.path.join(RP, GEO_FILE)))['minecraft:geometry']}
    vanilla_sounds = None
    vb = '/home/user/mojang/bedrock-samples/resource_pack/blocks.json'
    if os.path.exists(vb):
        import re
        d = json.loads(re.sub(r'//.*', '', open(vb).read()))
        vanilla_sounds = {v.get('sound') for v in d.values() if isinstance(v, dict)}
    for bid, e in man['blocks_json'].items():
        if e['textures'] not in tt:
            errs.append(f'blocks.json {bid}: texture {e["textures"]} not in terrain')
        if vanilla_sounds is not None and e['sound'] not in vanilla_sounds:
            errs.append(f'blocks.json {bid}: sound {e["sound"]} is not a vanilla block sound')
    for g in geos.values():
        for c in g['bones'][0]['cubes']:
            o, s = c['origin'], c['size']
            for ax in range(3):
                lo, hi = (o[ax], o[ax] + s[ax]) if s[ax] >= 0 else (o[ax] + s[ax], o[ax])
                if lo < -15.5 or hi > 30 or hi - lo > 30:
                    errs.append(f'{g["description"]["identifier"]}: cube out of bounds {o} {s}')
            for f, fd in c['uv'].items():
                u, v = fd['uv']; su, sv = fd['uv_size']
                if min(u, u + su) < -1e-6 or max(u, u + su) > 16 + 1e-6 or min(v, v + sv) < -1e-6 or max(v, v + sv) > 16 + 1e-6:
                    errs.append(f'{g["description"]["identifier"]}: uv outside texture {fd}')
    import glob, re
    for p in glob.glob(os.path.join(BP, 'blocks/infected/*.json')):
        b = json.load(open(p))['minecraft:block']
        ident = b['description']['identifier']
        states = b['description'].get('states', {})
        if f'tile.{ident}.name' not in man['lang']:
            errs.append(f'{ident}: no lang entry')
        if ident not in man['blocks_json']:
            errs.append(f'{ident}: no blocks.json entry')
        variants = [b['components']] + [{**b['components'], **pm['components']} for pm in b.get('permutations', [])]
        for pm in b.get('permutations', []):
            for s in re.findall(r"q\.block_state\('([^']+)'\)", pm['condition']):
                if s not in states:
                    errs.append(f'{ident}: permutation uses undeclared state {s}')
        for comps in variants:
            gid = comps['minecraft:geometry']
            gid = gid if isinstance(gid, str) else gid['identifier']
            mats = comps['minecraft:material_instances']
            for inst, m in mats.items():
                if m['texture'] not in tt:
                    errs.append(f'{ident}: texture {m["texture"]} not in terrain')
            if not gid.startswith('minecraft:'):
                if gid not in geos:
                    errs.append(f'{ident}: geometry {gid} missing')
                    continue
                used = {fd.get('material_instance', '*') for c in geos[gid]['bones'][0]['cubes'] for fd in c['uv'].values()}
                for u in used:
                    if u not in mats:
                        errs.append(f'{ident}: geometry {gid} face instance {u} undefined')
            sel = comps.get('minecraft:selection_box')
            if isinstance(sel, dict):
                o, s = sel['origin'], sel['size']
                if o[0] < -8 or o[2] < -8 or o[1] < 0 or o[0] + s[0] > 8 or o[2] + s[2] > 8 or o[1] + s[1] > 16:
                    errs.append(f'{ident}: selection box outside the block')
            lt = comps.get('minecraft:loot')
            if lt and not os.path.exists(os.path.join(BP, lt)):
                errs.append(f'{ident}: loot {lt} missing')
    fb = json.load(open(os.path.join(RP, 'textures/flipbook_textures.json')))
    for e in fb:
        if e['atlas_tile'] not in tt:
            errs.append(f'flipbook tile {e["atlas_tile"]} not in terrain')
        im = Image.open(os.path.join(RP, e['flipbook_texture'] + '.png'))
        if im.size[1] % im.size[0] or max(e.get('frames', [0])) >= im.size[1] // im.size[0]:
            errs.append('flipbook frames do not match the strip')
    return errs


def main():
    t = {}
    t['veinstone'] = tex_veinstone()
    t['cracked_veinstone'] = tex_cracked_veinstone()
    t['fleshstone'] = tex_fleshstone()
    t['pulsing_flesh'] = tex_pulsing_flesh()
    t['ribstone'], t['ribstone_top'] = tex_ribstone()
    t['organ_core'], t['organ_core_glow'], t['organ_core_root'], t['cracked_organ_core'] = tex_organ()
    t['watcher_pod'], t['watcher_pod_open'], t['watcher_pod_inner'], t['watcher_pod_eye'], t['watcher_pod_root'] = tex_watcher_pod()
    t['dripfang'], t['dripfang_wet'], t['dripfang_drop'] = tex_dripfang()
    t['bloodroot_vines'], t['bloodroot_vines_tip'] = tex_bloodroot()
    t['crimson_thorns'], t['crimson_thorns_crystal'] = tex_thorns()
    t['glowspore_cluster'], t['glowspore_cluster_stem'], t['glowspore_cluster_cap'] = tex_glowspore()
    t['bloodmoss'], t['bloodmoss_side'] = tex_bloodmoss()
    geos = [g_cross(), g_thorns(), g_glowspore(), g_bloodmoss(), g_organ_core(), g_cracked_organ_core(),
            g_watcher_pod(False), g_watcher_pod(True), g_dripfang(False), g_dripfang(True)]
    w(RP, GEO_FILE, {'format_version': '1.12.0', 'minecraft:geometry': geos})
    behavior(t)
    manifest()
    errs = verify()
    ncubes = {g['description']['identifier']: len(g['bones'][0]['cubes']) for g in geos}
    print('infected blocks generated:', len(BLOCKS), 'blocks,', len(terrain), 'textures, cubes per geometry', ncubes)
    if errs:
        print('\n'.join('  ERROR ' + e for e in errs))
        raise SystemExit(1)
    print('self-check passed')


if __name__ == '__main__':
    main()
