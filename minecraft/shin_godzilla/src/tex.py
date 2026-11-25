"""Procedural, high-resolution textures for every Shin Godzilla form.

All patterns are generated from scratch (FFT fractal noise, Worley cells,
domain warping and normal-mapped relief shading) to imitate the film's
keloid, scar-like hide with glowing fissures.  Alpha is used as the emissive
mask for the `entity_emissive_alpha` material: the lower the alpha, the more
a pixel glows (the hide itself stays opaque).
"""
import numpy as np
from PIL import Image
from atlas import REGIONS, REGIONS2

TAU = 2 * np.pi


# ----------------------------------------------------------------- noise
def fbm(h, w, beta=2.2, seed=0, aniso=(1.0, 1.0), lo=0.0):
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(h)[:, None] * aniso[0]
    fx = np.fft.fftfreq(w)[None, :] * aniso[1]
    f = np.sqrt(fx ** 2 + fy ** 2)
    f[0, 0] = 1.0
    amp = 1.0 / f ** (beta / 2.0)
    amp[0, 0] = 0.0
    if lo:
        amp[f < lo] = 0.0
    spec = amp * np.exp(1j * rng.uniform(0, TAU, (h, w)))
    n = np.real(np.fft.ifft2(spec))
    n -= n.min()
    return n / max(1e-9, n.max())


def worley(h, w, n, seed=0, warp=0.0, wseed=7):
    """Seamless F1/F2 cellular noise on a jittered grid of ~n feature points."""
    rng = np.random.default_rng(seed)
    n = max(4, int(n))
    gy = max(2, int(round(np.sqrt(n * h / w))))
    gx = max(2, int(round(n / gy)))
    ch, cw = h / gy, w / gx
    jit = rng.uniform(0.1, 0.9, (gy, gx, 2))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    if warp:
        yy = yy + (fbm(h, w, 2.6, wseed) - 0.5) * warp
        xx = xx + (fbm(h, w, 2.6, wseed + 1) - 0.5) * warp
    yy %= h
    xx %= w
    cy = np.floor(yy / ch).astype(np.int32) % gy
    cx = np.floor(xx / cw).astype(np.int32) % gx
    f1 = np.full((h, w), 1e9, np.float32)
    f2 = np.full((h, w), 1e9, np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ny, nx = cy + dy, cx + dx
            py = (ny + jit[ny % gy, nx % gx, 0]) * ch
            px = (nx + jit[ny % gy, nx % gx, 1]) * cw
            d = np.sqrt((yy - py) ** 2 + (xx - px) ** 2)
            swap = d < f1
            f2 = np.where(swap, f1, np.minimum(f2, d))
            f1 = np.where(swap, d, f1)
    return f1, f2


def shade(height, strength=4.0, light=(-0.55, -0.65, 0.52)):
    gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * strength
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    nz = np.ones_like(height)
    ln = np.sqrt(gx * gx + gy * gy + nz * nz)
    l = np.array(light) / np.linalg.norm(light)
    d = (-gx * l[0] - gy * l[1] + nz * l[2]) / ln
    return np.clip(d, 0, 1)


def mix(a, b, t):
    t = t[..., None]
    return np.asarray(a, np.float32) * (1 - t) + np.asarray(b, np.float32) * t


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------ pattern maps
def band(h, w, cycles, seed, aniso=(1.0, 1.0), width=0.5):
    """Band-limited seamless noise (unit std) centred on `cycles` per tile."""
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(h)[:, None] * h * aniso[0]
    fx = np.fft.fftfreq(w)[None, :] * w * aniso[1]
    f = np.sqrt(fx ** 2 + fy ** 2)
    amp = np.exp(-((f - cycles) / (width * cycles)) ** 2)
    amp[0, 0] = 0
    n = np.real(np.fft.ifft2(amp * np.exp(1j * rng.uniform(0, TAU, (h, w)))))
    return n / (n.std() + 1e-9)


def cracked_hide(h, w, cells, seed, crack_w=0.08, warp=40, ridge_aniso=2.5):
    """Keloid hide: swollen scar tissue split by a branching, vein-like
    network of fissures (the zero crossings of layered band noise), with
    stringy sinew running along the limb between them."""
    cyc = max(3.0, np.sqrt(cells) * 0.62) * (h / max(h, w)) ** 0.0
    an = (1.0, 1.0 / max(1.0, ridge_aniso * 0.5))  # fissures run mostly along v
    n1 = band(h, w, cyc, seed + 1, an)
    n2 = band(h, w, cyc * 2.3, seed + 2, an)
    n3 = band(h, w, cyc * 5.5, seed + 3)
    width = crack_w * 3.2
    wmod = 0.6 + 0.8 * fbm(h, w, 2.4, seed + 22)
    c1 = np.clip(1 - np.abs(n1) / (width * wmod), 0, 1)
    c2 = np.clip(1 - np.abs(n2 + 0.35 * n1) / (width * 1.3), 0, 1) * smooth(fbm(h, w, 2.2, seed + 21), 0.35, 0.65)
    c3 = np.clip(1 - np.abs(n3) / (width * 1.1), 0, 1) * 0.45
    crack = np.clip(np.maximum(c1 ** 1.5, np.maximum(c2 ** 1.6 * 0.8, c3 ** 2)), 0, 1)
    patch = smooth(fbm(h, w, 2.6, seed + 23), 0.36, 0.62)       # where the heat shows through
    deep = np.clip(c1 ** 3 + 0.6 * c2 ** 3, 0, 1) * patch
    sinew = fbm(h, w, 1.7, seed + 4, aniso=(0.35, 2.2))          # fibres along the limb
    lumps = np.clip(0.5 + 0.28 * n1 * np.sign(n1) + 0.2 * np.abs(n2), 0, 1)
    fine = fbm(h, w, 1.3, seed + 5)
    height = lumps * 0.55 + sinew * 0.4 + fine * 0.22 - crack * 0.75
    return dict(height=height, crack=crack * (0.45 + 0.55 * patch), deep=deep, var=fbm(h, w, 2.8, seed + 6), fine=fine)


def ridged_folds(h, w, folds, seed, crack_w=0.18):
    """Horizontal ring folds (neck / tail / belly wrinkles)."""
    yy = np.mgrid[0:h, 0:w][0].astype(np.float32)
    warp = (fbm(h, w, 2.8, seed, aniso=(3.0, 1.0)) - 0.5) * 2.6
    ph = TAU * yy / h * folds + warp * np.pi
    s = np.sin(ph)
    breakup = fbm(h, w, 1.8, seed + 2)
    crack = smooth(-s, 1 - crack_w, 1.0) * smooth(breakup, 0.25, 0.55)
    base = cracked_hide(h, w, max(12, folds * 4), seed + 9, 0.05, 30)
    height = (s * 0.5 + 0.5) * 0.7 + base["height"] * 0.35 - crack * 0.6
    crack = np.maximum(crack, base["crack"] * 0.6)
    return dict(height=height, crack=crack, deep=crack ** 2, var=base["var"], fine=base["fine"])


def stripes(h, w, n, seed):
    yy = np.mgrid[0:h, 0:w][0].astype(np.float32)
    warp = (fbm(h, w, 2.6, seed, aniso=(4.0, 1.0)) - 0.5) * 1.5
    s = np.sin(TAU * yy / h * n + warp * np.pi)
    groove = smooth(-s, 0.55, 1.0)
    fine = fbm(h, w, 1.5, seed + 1)
    height = s * 0.5 + 0.5 + fine * 0.2
    return dict(height=height, crack=groove, deep=groove ** 3, var=fbm(h, w, 2.6, seed + 2), fine=fine)


def fibres(h, w, seed, cells=60):
    streak = fbm(h, w, 2.0, seed, aniso=(0.25, 3.0))
    f1, f2 = worley(h, w, cells, seed + 1, warp=25)
    scale = np.sqrt(h * w / cells)
    crack = 1 - smooth((f2 - f1) / scale, 0.0, 0.05)
    fine = fbm(h, w, 1.3, seed + 2)
    height = streak * 0.8 + fine * 0.25 - crack * 0.5
    return dict(height=height, crack=crack, deep=crack ** 2, var=streak, fine=fine)


# ------------------------------------------------------------- colouring
def colour_hide(mp, pal, glow_amt, relief=5.0, frost=False, seed=0):
    sh = shade(mp["height"], relief)
    base = mix(pal["dark"], pal["light"], np.clip(mp["var"] * 1.2 - 0.1, 0, 1))
    hi = smooth(mp["height"], 0.55, 0.95) * 0.5
    base = mix(base, pal["high"], hi)
    col = base * ((0.72 + 0.42 * sh) if pal.get("soft") else (0.35 + 0.95 * sh))[..., None]
    c = np.clip(mp["crack"], 0, 1)
    d = np.clip(mp["deep"], 0, 1)
    cracks = mix(pal["crack"], pal["glow"], d)
    col = mix(col, cracks, c * pal.get("crack_mix", 0.95))
    glow = c * 0.35 + d * 0.65
    if frost:
        sp = fbm(*mp["height"].shape, 1.0, seed + 99)
        col = mix(col, (235, 238, 245), smooth(sp, 0.72, 0.9) * 0.6)
    alpha = 1.0 - np.clip(glow * glow_amt, 0, 0.92)
    return np.clip(col, 0, 255), alpha


def radial_eye(h, w, pal):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cy, cx = (h - 1) / 2, (w - 1) / 2
    r = np.sqrt(((yy - cy) / (h / 2)) ** 2 + ((xx - cx) / (w / 2)) ** 2)
    col = mix(pal["sclera"], pal["rim"], smooth(r, 0.62, 0.95))
    col = mix(col, pal["iris"], 1 - smooth(r, pal["iris_r"] - 0.08, pal["iris_r"]))
    col = mix(col, pal["pupil"], 1 - smooth(r, pal["pupil_r"] - 0.05, pal["pupil_r"]))
    spec = np.sqrt(((yy - cy * 0.62) / (h / 2)) ** 2 + ((xx - cx * 0.62) / (w / 2)) ** 2)
    col = mix(col, (255, 255, 255), (1 - smooth(spec, 0.06, 0.16)) * pal.get("spec", 0.8))
    return col, np.ones((h, w), np.float32) * pal.get("alpha", 1.0)


def flat(h, w, c1, c2, seed, beta=1.6, aniso=(1, 1)):
    n = fbm(h, w, beta, seed, aniso=aniso)
    return mix(c1, c2, n), np.ones((h, w), np.float32)


# --------------------------------------------------------------- palettes
def H(dark, light, high, crack, glow, crack_mix=0.92):
    return dict(dark=dark, light=light, high=high, crack=crack, glow=glow, crack_mix=crack_mix)


def palettes(form, variant):
    """Colour schemes per material. form: 2, 3, 4. variant: normal/charged/frozen."""
    if form == 4:
        p = dict(
            skin=H((20, 15, 15), (62, 38, 35), (104, 86, 84), (50, 6, 5), (240, 54, 22)),
            skin2=H((17, 13, 13), (54, 34, 32), (92, 78, 76), (44, 6, 5), (215, 42, 18), 0.88),
            under=H((34, 14, 13), (86, 34, 30), (130, 84, 78), (78, 8, 6), (255, 82, 32), 1.0),     # belly / chest
            ridge=H((22, 16, 16), (70, 42, 38), (112, 94, 90), (56, 7, 6), (240, 58, 26)),
            head=H((22, 17, 17), (66, 44, 41), (110, 96, 93), (40, 8, 7), (150, 34, 20), 0.8),
            fissure=H((28, 15, 14), (78, 34, 30), (120, 78, 72), (74, 8, 6), (250, 76, 30), 1.0),
            belly=H((54, 12, 10), (130, 28, 20), (186, 62, 46), (26, 6, 6), (255, 98, 50)),          # tail underside
            plate_base=H((40, 12, 10), (90, 24, 18), (140, 60, 50), (150, 20, 10), (255, 90, 40), 1.0),
            bone=H((150, 136, 120), (214, 204, 186), (240, 234, 220), (70, 50, 44), (90, 30, 20)),
            glow=dict(skin=0.5, skin2=0.3, under=0.75, ridge=0.5, head=0.1, fissure=0.7, belly=0.5, plate_base=0.9, bone=0.0),
            plate=dict(tip=(104, 94, 96), mid=(42, 35, 37), base=(22, 14, 14), vein=(214, 44, 26), glow=0.55),
            tooth=((226, 216, 188), (190, 168, 124), (104, 64, 44)),
            eye=dict(sclera=(186, 174, 146), rim=(40, 22, 18), iris=(124, 108, 80), pupil=(4, 3, 3), iris_r=0.62, pupil_r=0.34, spec=0.5),
            gum=((62, 14, 18), (112, 38, 42)), mouth=((14, 4, 6), (56, 12, 16)), claw=((170, 156, 124), (232, 222, 196)),
            gill=((90, 14, 16), (180, 40, 40)),
        )
        if variant == "charged":
            for k in ("skin", "skin2", "under", "ridge", "head", "fissure", "belly", "plate_base"):
                p[k]["crack"], p[k]["glow"] = (86, 26, 170), (226, 152, 255)
            p["belly"].update(dark=(58, 20, 120), light=(140, 60, 215), high=(214, 170, 255))
            p["plate_base"].update(dark=(120, 50, 220), light=(200, 140, 255), high=(250, 235, 255))
            p["glow"] = dict(skin=0.85, skin2=0.6, under=1.0, ridge=0.85, head=0.35, fissure=1.0, belly=0.9, plate_base=1.0, bone=0.0)
            p["plate"] = dict(tip=(246, 236, 255), mid=(176, 116, 255), base=(104, 40, 214), vein=(255, 244, 255), glow=1.0, lit=0.75)
            p["gum"], p["mouth"] = ((150, 60, 170), (230, 160, 255)), ((120, 60, 200), (240, 210, 255))
        elif variant == "frozen":
            ice = H((92, 94, 100), (176, 178, 184), (226, 228, 234), (60, 62, 70), (110, 112, 120))
            for k in ("skin", "skin2", "under", "ridge", "head", "fissure", "belly", "plate_base", "bone"):
                p[k] = dict(ice)
            p["glow"] = {k: 0.0 for k in p["glow"]}
            p["plate"] = dict(tip=(232, 234, 240), mid=(150, 152, 160), base=(96, 98, 106), vein=(70, 72, 80), glow=0.0)
            p["gum"], p["mouth"] = ((120, 116, 120), (170, 168, 172)), ((50, 50, 56), (90, 90, 96))
            p["tooth"] = ((230, 232, 236), (170, 172, 178), (110, 112, 118))
            p["eye"].update(sclera=(170, 170, 176), iris=(110, 110, 116))
        return p
    if form == 3:
        # "Shinagawa-kun": raw red-brown hide, crimson fissures, pale grey plates
        return dict(
            skin=H((74, 26, 20), (160, 70, 50), (212, 132, 106), (136, 20, 12), (255, 70, 30)),
            skin2=H((62, 24, 18), (142, 62, 44), (198, 122, 98), (118, 18, 10), (232, 60, 26)),
            under=H((112, 34, 24), (206, 96, 66), (240, 160, 130), (150, 22, 12), (255, 96, 44), 1.0),
            ridge=H((78, 28, 22), (170, 76, 54), (220, 140, 110), (150, 22, 12), (255, 80, 36)),
            head=H((82, 32, 24), (170, 82, 60), (220, 150, 120), (130, 24, 14), (220, 60, 30)),
            fissure=H((110, 26, 18), (200, 70, 44), (240, 140, 110), (170, 20, 10), (255, 100, 44), 1.0),
            belly=H((150, 50, 36), (220, 110, 80), (245, 170, 140), (110, 20, 14), (255, 90, 50)),
            plate_base=H((90, 30, 24), (150, 70, 56), (200, 130, 110), (160, 30, 16), (255, 90, 40), 1.0),
            bone=H((150, 136, 120), (214, 204, 186), (240, 234, 220), (70, 50, 44), (90, 30, 20)),
            glow=dict(skin=0.3, skin2=0.2, under=0.5, ridge=0.35, head=0.1, fissure=0.55, belly=0.3, plate_base=0.5, bone=0.0),
            plate=dict(tip=(230, 226, 228), mid=(170, 158, 160), base=(110, 70, 66), vein=(200, 70, 50), glow=0.2),
            tooth=((240, 234, 212), (190, 168, 124), (120, 70, 50)),
            eye=dict(sclera=(214, 206, 186), rim=(80, 30, 24), iris=(160, 140, 116), pupil=(10, 8, 8), iris_r=0.58, pupil_r=0.24, spec=0.7),
            gum=((120, 30, 36), (190, 80, 86)), mouth=((30, 6, 8), (100, 20, 24)), claw=((180, 160, 130), (234, 222, 196)),
            gill=((130, 10, 16), (240, 60, 66)),
        )
    # form 2: "Kamata-kun": wet tan hide, dark red back, blood-red gills, glassy eyes
    p = dict(
        skin=H((138, 88, 54), (200, 144, 96), (238, 204, 162), (112, 62, 40), (150, 70, 46), 0.42),
        skin2=H((120, 74, 46), (182, 124, 82), (226, 190, 150), (100, 54, 34), (140, 60, 40), 0.42),
        back=H((84, 30, 22), (146, 60, 44), (198, 114, 90), (62, 18, 14), (120, 30, 20), 0.5),
        under=H((186, 142, 108), (234, 202, 166), (250, 234, 210), (160, 108, 80), (180, 110, 80), 0.35),
        ridge=H((132, 82, 52), (192, 132, 90), (232, 192, 152), (118, 66, 44), (150, 76, 54), 0.4),
        head=H((140, 92, 58), (204, 150, 104), (238, 208, 170), (116, 66, 44), (140, 66, 44), 0.35),
        fissure=H((140, 50, 36), (210, 110, 80), (240, 180, 150), (150, 30, 26), (220, 60, 40), 0.9),
        belly=H((176, 132, 100), (232, 198, 162), (250, 232, 208), (140, 84, 60), (180, 100, 70), 0.6),
        plate_base=H((80, 30, 22), (140, 60, 40), (190, 110, 80), (110, 20, 14), (180, 40, 26)),
        bone=H((150, 136, 120), (214, 204, 186), (240, 234, 220), (70, 50, 44), (90, 30, 20)),
        glow=dict(skin=0.0, skin2=0.0, back=0.0, under=0.0, ridge=0.0, head=0.0, fissure=0.05, belly=0.0, plate_base=0.0, bone=0.0),
        plate=dict(tip=(170, 84, 60), mid=(104, 40, 30), base=(60, 22, 18), vein=(40, 10, 8), glow=0.0),
        tooth=((246, 242, 226), (206, 190, 150), (140, 96, 70)),
        eye=dict(sclera=(226, 226, 216), rim=(130, 96, 74), iris=(206, 206, 196), pupil=(12, 10, 10), iris_r=0.5, pupil_r=0.17, spec=0.95),
        gum=((150, 40, 48), (220, 100, 108)), mouth=((40, 8, 10), (110, 24, 28)), claw=((170, 150, 120), (228, 214, 186)),
        gill=((110, 6, 12), (236, 48, 58)),
    )
    for k in ("skin", "skin2", "back", "under", "ridge", "head", "fissure", "belly"):
        p[k]["soft"] = True   # smooth, wet-looking skin: gentle relief shading
    return p


# ------------------------------------------------------------- sleeve maps
def sleeve_grid(h, w):
    """theta: degrees from the dorsal line (0) round to the belly (+-180);
    f: 0 at the start of the body part (bottom row), 1 at its far end."""
    cols = (np.arange(w) + 0.5) / w * 8.0
    th = ((cols - 4.5) * 45.0 + 180) % 360 - 180
    f = 1 - (np.arange(h) + 0.5) / h
    return np.meshgrid(th, f)


def gauss_line(TH, th0, sigma):
    d = (TH - th0 + 180) % 360 - 180
    return np.exp(-(d / sigma) ** 2)


def bands(F, n, seed, h, w, warp=0.3):
    wn = (fbm(h, w, 2.6, seed, aniso=(3.0, 1.0)) - 0.5) * 2 * warp
    s = np.sin(TAU * (F * n + wn))
    return s, smooth(-s, 0.7, 0.99)


def sleeve_maps(kind, h, w, scale, seed, form):
    TH, F = sleeve_grid(h, w)
    A = np.abs(TH)
    cell = lambda uv: max(30, int(h * w / (uv * scale) ** 2))
    if kind == "trunk":
        base = cracked_hide(h, w, cell(13), seed, 0.075, 30, 3.0)
        vent, dors = smooth(A, 100, 150), 1 - smooth(A, 30, 75)
        flank = np.clip(1 - vent - dors, 0, 1)
        neck = smooth(F, 0.64, 0.72)
        s, groove = bands(F, 30, seed + 40, h, w)
        heat = np.clip(0.16 + 1.0 * vent + 0.6 * flank * (1 - F) * 1.4, 0, 1) * (1 - 0.8 * neck)
        root = np.zeros_like(F)
        for th0, f1 in ((0, 0.8), (28, 0.76), (-28, 0.76), (54, 0.62), (-54, 0.62)):
            root = np.maximum(root, gauss_line(TH, th0, 5.0) * smooth(F, 0.02, 0.06) * (1 - smooth(F, f1 - 0.04, f1)))
        root *= smooth(fbm(h, w, 2.0, seed + 41), 0.3, 0.55)
        height = base["height"] + 0.5 * s * vent * (1 - neck) + 0.55 * s * neck - 0.3 * root
        patchy = smooth(fbm(h, w, 2.4, seed + 48), 0.38, 0.62)
        crack = np.clip(np.maximum(base["crack"] * (0.4 + 0.6 * heat), np.maximum(groove * (vent * (1 - neck) + 0.6 * neck) * 0.8, root * 0.85)), 0, 1)
        deep = np.clip(base["deep"] * heat * 1.3 + groove ** 4 * vent * (1 - neck) * patchy * 0.85 + root * 0.95, 0, 1)
        return dict(height=height, crack=crack, deep=deep, var=base["var"] * (1 - 0.35 * dors), zone=vent * (1 - neck), zone2=neck)
    if kind == "tail":
        base = cracked_hide(h, w, cell(11), seed + 1, 0.07, 24, 2.0)
        vent, dors = smooth(A, 112, 150), 1 - smooth(A, 30, 70)
        s, groove = bands(F, 54, seed + 42, h, w, 0.2)
        s2, groove2 = bands(F, 120, seed + 43, h, w, 0.25)
        side_heat = smooth(A, 60, 115) * 0.8 + 0.12
        root = np.zeros_like(F)
        for th0, f1 in ((0, 0.98), (32, 0.6), (-32, 0.6), (60, 0.28), (-60, 0.28)):
            root = np.maximum(root, gauss_line(TH, th0, 5.5) * (1 - smooth(F, f1 - 0.04, f1)))
        root *= smooth(fbm(h, w, 2.0, seed + 44), 0.3, 0.55)
        height = base["height"] * (1 - 0.5 * vent) + 0.4 * s * (1 - vent) + 0.6 * s2 * vent - 0.3 * root
        crack = np.clip(np.maximum(np.maximum(base["crack"] * (1 - vent) * 0.7, groove * (1 - vent) * 0.6), np.maximum(groove2 * vent, root * 0.85)), 0, 1)
        deep = np.clip(base["deep"] * (1 - vent) * side_heat + groove2 ** 2 * vent * 0.9 + root * 0.9, 0, 1)
        return dict(height=height, crack=crack, deep=deep, var=base["var"] * (1 - 0.3 * dors), zone=vent, zone2=smooth(F, 0.962, 0.975))
    if kind in ("thigh", "shin", "foot"):
        n = {"thigh": 7, "shin": 9, "foot": 6}[kind]
        base = cracked_hide(h, w, cell(12 if kind == "thigh" else 9), seed + 2 + len(kind), 0.07, 24, 3.2 if kind == "thigh" else 1.5)
        s, groove = bands(F, n, seed + 45, h, w, 0.35)
        wr = smooth(F, 0.72, 0.92) if kind == "thigh" else np.ones_like(F)
        heat = {"thigh": 0.55, "shin": 0.4, "foot": 0.2}[kind]
        height = base["height"] + 0.4 * s * wr
        crack = np.clip(np.maximum(base["crack"] * 0.85, groove * wr * 0.6), 0, 1)
        return dict(height=height, crack=crack, deep=np.clip(base["deep"] * heat * 1.6, 0, 1), var=base["var"], zone=np.zeros_like(F), zone2=np.zeros_like(F))
    if kind == "skull":
        base = cracked_hide(h, w, cell(5), seed + 9, 0.06, 10, 1.2)
        top = 1 - smooth(A, 30, 80)
        return dict(height=base["height"], crack=base["crack"] * 0.7, deep=base["deep"] * 0.5, var=base["var"] * (1 - 0.3 * top),
                    zone=smooth(A, 120, 160), zone2=np.zeros_like(F))
    if kind == "body":  # 2nd form trunk + neck: wet, loosely folded skin
        base = cracked_hide(h, w, cell(16), seed + 3, 0.05, 30, 4.0)
        folds = fbm(h, w, 2.0, seed + 46, aniso=(0.22, 3.0))           # long wrinkles along the body
        vent, dors = smooth(A, 118, 155), 1 - smooth(A, 22, 60)
        crease = gauss_line(TH, 96, 4) + gauss_line(TH, -96, 4)         # lateral skin flap
        neck = smooth(F, 0.6, 0.7)
        s, groove = bands(F, 26, seed + 47, h, w, 0.4)
        height = base["height"] * 0.6 + folds * 0.8 + 0.3 * s * neck - 0.5 * crease
        crack = np.clip(np.maximum(base["crack"] * 0.5, np.maximum(crease * 0.8, groove * neck * 0.5)), 0, 1)
        return dict(height=height, crack=crack, deep=np.zeros_like(F), var=np.clip(base["var"] * 0.6 + folds * 0.5, 0, 1), zone=vent, zone2=dors)
    raise KeyError(kind)


def gradient_strip(h, w, pal, g0, g1, seed, veins=True):
    """Dorsal plate skin: rows run tip (top) -> base (bottom)."""
    g = (g0 + (g1 - g0) * (np.arange(h) + 0.5) / h)[:, None] * np.ones((1, w))
    streak = fbm(h, w, 2.0, seed, aniso=(0.2, 3.0))
    fine = fbm(h, w, 1.3, seed + 1)
    col = mix(mix(pal["tip"], pal["mid"], smooth(g, 0.0, 0.3)), pal["base"], smooth(g, 0.4, 1.0))
    relief = shade(streak * 0.5 + fine * 0.35, 4.0)
    lit = pal.get("lit", 0.0)
    col = col * ((0.62 + 0.6 * relief) * (1 - lit) + lit)[..., None]
    n = band(h, w, max(3.0, w / 40.0), seed + 2, (0.45, 1.0))
    vein = np.clip(1 - np.abs(n) / 0.2, 0, 1) ** 1.5 * smooth(fbm(h, w, 2.2, seed + 3), 0.3, 0.6)
    heat = smooth(g, 0.4, 0.95) if pal["glow"] < 1.0 else np.ones_like(g)
    if veins:
        col = mix(col, pal["vein"], vein * heat * 0.95)
    edge = smooth(g, 0.86, 1.0)
    col = mix(col, pal["vein"], edge * 0.5 * (pal["glow"] > 0))
    glow = np.clip(vein * heat + edge * 0.6 + (0.55 if pal["glow"] >= 1.0 else 0.0), 0, 1) * pal["glow"]
    return np.clip(col, 0, 255), 1.0 - np.clip(glow, 0, 0.92)


def tooth_strip(h, w, cols, seed):
    g = ((np.arange(h) + 0.5) / h)[:, None] * np.ones((1, w))
    col = mix(mix(cols[0], cols[1], smooth(g, 0.25, 0.8)), cols[2], smooth(g, 0.82, 1.0))
    col = col * (0.9 + 0.2 * fbm(h, w, 1.5, seed, aniso=(0.3, 2.0)))[..., None]
    return np.clip(col, 0, 255), np.ones((h, w), np.float32)


def gill_strip(h, w, cols, seed):
    """Feathery red gill filaments (rows: free edge at top -> root at bottom)."""
    xx = (np.arange(w) + 0.5)[None, :] / w * np.ones((h, 1))
    g = ((np.arange(h) + 0.5) / h)[:, None] * np.ones((1, w))
    fil = np.sin(TAU * (xx * max(6, w // 10) + (fbm(h, w, 2.5, seed) - 0.5) * 0.8)) * 0.5 + 0.5
    col = mix(cols[0], cols[1], np.clip(fil * (1.1 - 0.5 * g), 0, 1))
    col = mix(col, (250, 150, 150), (1 - smooth(g, 0.0, 0.12)) * 0.5)
    return np.clip(col, 0, 255), np.ones((h, w), np.float32)


# ------------------------------------------------------------- atlas build
class MapCache:
    def __init__(self, scale, seed):
        self.scale, self.seed, self.maps = scale, seed, {}

    def get(self, key, fn):
        if key not in self.maps:
            self.maps[key] = fn()
        return self.maps[key]


GENERIC = {
    # name: (generator, cell size in UV units, crack width, warp, anisotropy)
    "skin": ("hide", 12, 0.075, 30, 3.0), "skin2": ("hide", 9, 0.06, 22, 1.5), "head": ("hide", 5, 0.05, 12, 1.2),
    "fissure": ("hide", 12, 0.12, 30, 2.5), "plate_base": ("hide", 7, 0.2, 20, 1.5), "ridge": ("folds", 6, 0, 0, 0),
    "belly": ("stripes", 4, 0, 0, 0), "bone": ("fibres", 12, 0, 0, 0),
}


def build_atlas(form, variant, size_px, cache):
    regs = REGIONS2 if form == 2 else REGIONS
    scale = size_px / 1024.0
    pal = palettes(form, variant)
    img = np.zeros((size_px, size_px, 3), np.float32)
    alpha = np.ones((size_px, size_px), np.float32)
    frozen = variant == "frozen"
    seed = cache.seed
    for name, reg in regs.items():
        u, v, rw, rh = reg[:4]
        kind = reg[4] if len(reg) > 4 else None
        x0, y0 = int(round(u * scale)), int(round(v * scale))
        w, h = int(round(rw * scale)), int(round(rh * scale))
        if kind == "sleeve":
            mk = "body" if (form == 2 and name == "tail") else name
            mp = cache.get((name, h, w), lambda: sleeve_maps(mk, h, w, scale, seed + (5 if name == "tail" else 0), form))
            if name == "trunk":
                a_pal, b_pal, b_key, c_pal, c_key = "skin", "under", "under", "ridge", "ridge"
            elif name == "tail" and form != 2:
                a_pal, b_pal, b_key, c_pal, c_key = "skin2", "belly", "belly", "bone", "bone"
            elif name in ("body", "tail"):
                a_pal, b_pal, b_key, c_pal, c_key = "skin", "under", "under", "back", "back"
            elif name == "skull":
                a_pal, b_pal, b_key, c_pal, c_key = "head", "head", "head", "head", "head"
            else:
                a_pal = "skin" if name == "thigh" else "skin2"
                b_pal, b_key, c_pal, c_key = a_pal, a_pal, a_pal, a_pal
            relief = 3.5 if form == 2 else 6.0
            col, a = colour_hide(mp, pal[a_pal], pal["glow"][a_pal], relief, frost=frozen, seed=seed)
            if b_pal != a_pal:
                cb, ab = colour_hide(mp, pal[b_pal], pal["glow"][b_key], 6.0, frost=frozen, seed=seed)
                col, a = mix(col, cb, mp["zone"]), a * (1 - mp["zone"]) + ab * mp["zone"]
            if c_pal != a_pal:
                cc, ac = colour_hide(mp, pal[c_pal], pal["glow"][c_key], 6.0, frost=frozen, seed=seed)
                col, a = mix(col, cc, mp["zone2"]), a * (1 - mp["zone2"]) + ac * mp["zone2"]
        elif name in GENERIC:
            gen, cell, cw, warp, an = GENERIC[name]

            def make(gen=gen, cell=cell, cw=cw, warp=warp, an=an, h=h, w=w, name=name):
                sd = seed + sum(map(ord, name))
                if gen == "hide":
                    return cracked_hide(h, w, max(30, h * w / (cell * scale) ** 2), sd, cw, warp, an)
                if gen == "folds":
                    return ridged_folds(h, w, max(6, int(h / (cell * scale))), sd)
                if gen == "stripes":
                    return stripes(h, w, max(8, int(h / (cell * scale))), sd)
                return fibres(h, w, sd, max(12, int(h * w / (cell * scale) ** 2)))
            mp = cache.get((name, h, w), make)
            col, a = colour_hide(mp, pal[name], pal["glow"][name], 6.0 if gen == "hide" else 4.0, frost=frozen, seed=seed)
        elif name in ("plate", "plate_web", "plate_tip"):
            g0, g1 = {"plate": (0.0, 1.0), "plate_web": (0.42, 1.0), "plate_tip": (0.0, 0.36)}[name]
            col, a = gradient_strip(h, w, pal["plate"], g0, g1, seed + 70)
        elif name == "tooth":
            col, a = tooth_strip(h, w, pal["tooth"], seed + 71)
        elif name in ("eye", "eye_big"):
            col, a = radial_eye(h, w, pal["eye"])
        elif name == "gill":
            if kind == "vfit":
                col, a = gill_strip(h, w, pal["gill"], seed + 72)
            else:
                mp = stripes(h, w, 14, seed + 20)
                col = mix(pal["gill"][0], pal["gill"][1], np.clip(mp["height"], 0, 1)) * (0.6 + 0.5 * shade(mp["height"], 5))[..., None]
                a = np.ones((h, w), np.float32) * 0.8
        else:  # gum, mouth, claw
            c1, c2 = pal[name]
            col, a = flat(h, w, c1, c2, seed + sum(map(ord, name)) % 97, 1.6, (0.3, 3.0) if name == "claw" else (1, 1))
            if name == "mouth" and variant == "charged":
                a = a * 0.15
        img[y0:y0 + h, x0:x0 + w] = col[:h, :w]
        alpha[y0:y0 + h, x0:x0 + w] = a[:h, :w]
    rgba = np.dstack([np.clip(img, 0, 255), np.clip(alpha * 255, 18, 255)]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")
