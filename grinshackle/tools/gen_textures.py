#!/usr/bin/env python3
"""Pixel-art texture generator for Grinshackle RP (nearest-neighbour only, no AA)."""
import json
import math
import os

from PIL import Image, ImageDraw

ROOT = "/tmp/claude-0/-home-user-Gamesforfun/f0d9b1e4-8cf6-5788-bfed-3c567a50b1ea/scratchpad"
RP = os.path.join(ROOT, "build", "Grinshackle_RP")
BP = os.path.join(ROOT, "build", "Grinshackle_BP")
PREVIEW = os.path.join(ROOT, "assets_work", "tex_preview")

for d in ("textures/items", "textures/particle", "textures/ui", "textures/entity"):
    os.makedirs(os.path.join(RP, d), exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)

T = (0, 0, 0, 0)


def hexc(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def new(w, h=None):
    return Image.new("RGBA", (w, h or w), T)


def put(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((x, y), c)


def paint_map(im, rows, pal, ox=0, oy=0, skip="."):
    """Stamp a character map onto im using palette dict (char -> RGBA)."""
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == skip or ch == " ":
                continue
            put(im, ox + x, oy + y, pal[ch])


def outline(im, color, only_transparent=True):
    """Add 1px 4-neighbour outline of `color` around opaque pixels."""
    src = im.copy()
    for y in range(im.height):
        for x in range(im.width):
            if src.getpixel((x, y))[3] != 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < im.width and 0 <= ny < im.height and src.getpixel((nx, ny))[3] != 0:
                    put(im, x, y, color)
                    break


def save(im, rel_path, pack=RP):
    path = os.path.join(pack, rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "PNG", optimize=True)
    # preview: 8x nearest on mid-grey checker so alpha is visible
    scale = 8 if max(im.size) <= 32 else 2
    prev = Image.new("RGBA", (im.width * scale, im.height * scale), (0, 0, 0, 255))
    pd = ImageDraw.Draw(prev)
    cell = scale
    for y in range(0, prev.height, cell):
        for x in range(0, prev.width, cell):
            col = (92, 96, 104, 255) if ((x // cell + y // cell) % 2 == 0) else (112, 116, 124, 255)
            pd.rectangle([x, y, x + cell - 1, y + cell - 1], fill=col)
    prev.alpha_composite(im.resize(prev.size, Image.NEAREST))
    name = os.path.basename(rel_path).replace(".png", "") + ("_%s" % pack.split("_")[-1] if rel_path == "pack_icon.png" else "")
    prev.save(os.path.join(PREVIEW, name + "_prev.png"), "PNG")
    return path


written = []

# --------------------------------------------------------------------------- palettes
K = hexc("#1a1712")      # near-black outline
DB = hexc("#3a2a10")     # very dark brown
GD = hexc("#8a5a15")     # gold dark
GM = hexc("#c8922a")     # gold mid
GL = hexc("#f2c14e")     # gold light
GY = hexc("#6b6b6b")     # grey chain

IRON_H = hexc("#8e8e8e")
IRON_M = hexc("#5c5c5c")
IRON_D = hexc("#353535")
IRON_K = hexc("#151515")

BONE_L = hexc("#e9dcb8")
BONE_M = hexc("#cfc199")
BONE_D = hexc("#a08c60")
BONE_K = hexc("#3a3020")

INK = hexc("#0a0a0d")
INK_E = hexc("#23212b")

# --------------------------------------------------------------------------- 1. chainbound dial
def gen_dial():
    im = new(16)
    cx = cy = 7.5
    for y in range(16):
        for x in range(16):
            dx, dy = x - cx, y - cy
            r = math.hypot(dx, dy)
            if r > 7.8:
                continue
            if r > 6.8:
                c = K
            elif r > 4.9:
                ang = (math.atan2(dy, dx) + math.pi) / (2 * math.pi)
                seg = int(ang * 20 + 0.5) % 20
                # 20 radial cells: 3 grey (link) then 1 dark-brown (gap) -> 5 links
                m = seg % 4
                if m == 3:
                    c = DB
                elif m == 1:
                    c = GY          # link centre spans both ring rows
                else:
                    c = GY if r > 5.9 else DB   # link edge: grey outside, dark-brown inside
            else:
                t = dx + dy
                if t < -3.5:
                    c = GL
                elif t < 3.0:
                    c = GM
                else:
                    c = GD
            put(im, x, y, c)
    # tick marks at 12 / 3 / 6 / 9
    for (x, y) in ((7, 3), (8, 3), (12, 7), (12, 8), (7, 12), (8, 12), (3, 7), (3, 8)):
        put(im, x, y, DB)
    # needle to ~1 o'clock, 1 px wide, with a dark-brown counterweight tail
    for (x, y) in ((8, 6), (9, 5), (10, 4)):
        put(im, x, y, K)
    put(im, 6, 9, DB)
    # pin 2x2
    for (x, y) in ((7, 7), (8, 7), (7, 8), (8, 8)):
        put(im, x, y, K)
    put(im, 7, 7, GD)
    written.append(save(im, "textures/items/gs_chainbound_dial.png"))


# --------------------------------------------------------------------------- 2. rattle lure
def chain_path(points, layer):
    """Colour a pixel path as chain links: 2 px grey link, 1 px dark, repeating; then outline."""
    seq = [IRON_M, IRON_H, IRON_D]
    for i, (x, y) in enumerate(points):
        put(layer, x, y, seq[i % 3])
    outline(layer, IRON_K)


def gen_lure():
    im = new(16)
    pal = {"K": BONE_K, "B": BONE_L, "b": BONE_M, "d": BONE_D,
           "k": IRON_K, "H": IRON_H, "G": IRON_M, "I": IRON_D}
    rows = [
        ".....KKKKKK.....",
        "....KBBBbbdK....",
        "....KBBBbbdK....",
        ".....KBBbdK.....",
        "..kkkKBBbdKkkkk.",
        ".kHGkKBBbdKkGGIk",
        ".kHk.KBBbdK..kIk",
        ".kGk.KBBbdK..kIk",
        ".kkkkkkkkkkkkkkk",
        ".kHGkIkHGkIkHGIk",
        ".kGIkIkGIkIkGIIk",
        "..kkkkkkkkkkkkk.",
        ".....KBbddK.....",
        "......KbdK......",
        "......KdK.......",
        ".......K........",
    ]
    paint_map(im, rows, pal)
    written.append(save(im, "textures/items/gs_rattle_lure.png"))


# --------------------------------------------------------------------------- 3. broken chain
def oval_link(layer, cx, cy, rx, ry, deg, inner=0.42, erase=None):
    """Rotated oval ring with top-left lighting; erase = list of (x, y) to leave out."""
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for y in range(layer.height):
        for x in range(layer.width):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            u = dx * ca + dy * sa
            v = -dx * sa + dy * ca
            q = (u / rx) ** 2 + (v / ry) ** 2
            if inner <= q <= 1.0:
                if erase and (x, y) in erase:
                    continue
                shade = dx + dy
                c = IRON_H if shade < -2.0 else IRON_M if shade < 1.5 else IRON_D
                put(layer, x, y, c)
                pts.append((x, y))
    outline(layer, IRON_K)
    return pts


def gen_broken_chain():
    im = new(16)
    pal = {"k": IRON_K, "H": IRON_H, "G": IRON_M, "I": IRON_D}
    rows = [
        "..kk............",
        ".kHHkk..........",
        "kHHHHGk.........",
        "kHHkkkGk........",
        ".kHk..kIk...I...",
        ".kGk..kIk.......",
        "..kGk.kk..G.....",
        "...kIk......kk..",
        "....kk....kkHkk.",
        ".........kHHHGk.",
        "........kHkkkGGk",
        "...I...kHk..kGk.",
        ".......kHk..kIk.",
        ".......kHk.kIk..",
        "........kGGIk...",
        ".........kkk....",
    ]
    paint_map(im, rows, pal)
    written.append(save(im, "textures/items/gs_broken_chain.png"))


# --------------------------------------------------------------------------- 4. ink scrap
def gen_ink_scrap():
    im = new(16)
    C_L = hexc("#d9d0b6")
    C_M = hexc("#bdb293")
    C_D = hexc("#8f8467")
    C_K = hexc("#4a4234")
    pal = {"K": C_K, "c": C_L, "s": C_M, "d": C_D, "I": INK, "i": INK_E}
    rows = [
        "................",
        "...KKKK..KKKK...",
        "..KccccKKccccK..",
        ".KcccciicccccK..",
        ".KccciIIiccccK..",
        ".KcccciIicciicK.",
        "..KcccciicIIIKK.",
        "..KcccccciIIIiK.",
        ".KcccccciIIIicK.",
        "KKscccciIIIIccK.",
        ".KssccccIIiccsK.",
        ".KsssccciIicssK.",
        "..KssscciicsssK.",
        "..KdsssKKsssdK..",
        "...KKKK..KKKK...",
        "................",
    ]
    paint_map(im, rows, pal)
    # a couple of loose ink drips
    put(im, 9, 12, INK_E)
    put(im, 4, 7, INK_E)
    written.append(save(im, "textures/items/gs_ink_scrap.png"))


# --------------------------------------------------------------------------- 5. fang
def gen_fang():
    im = new(16)
    W = hexc("#f7f0d8")
    R1 = hexc("#b39c66")
    R2 = hexc("#8c7448")
    CR = hexc("#9c8c62")
    pal = {"K": BONE_K, "T": BONE_L, "t": BONE_M, "W": W, "r": R1, "R": R2, "c": CR}
    rows = [
        ".......KKKKKK...",
        "......KRrrrrRK..",
        "......KrRRRRrK..",
        "......KWTTTtrK..",
        "......KWTTTtK...",
        "......KWTTTtK...",
        "......KWTcTtK...",
        ".....KWTTTtK....",
        ".....KWTTTtK....",
        "....KWTTtcK.....",
        "...KWTTTtK......",
        "..KWTTtK........",
        ".KWTTtK.........",
        "KWTtK...........",
        "KTK.............",
        "KK..............",
    ]
    paint_map(im, rows, pal)
    written.append(save(im, "textures/items/gs_grinshackle_fang.png"))


# --------------------------------------------------------------------------- particles
def gen_particles():
    # ink mote 8x8 soft dot with alpha falloff
    im = new(8)
    for y in range(8):
        for x in range(8):
            r = math.hypot(x - 3.5, y - 3.5)
            if r <= 1.6:
                a = 255
            elif r <= 2.6:
                a = 200
            elif r <= 3.3:
                a = 120
            elif r <= 3.9:
                a = 55
            else:
                a = 0
            if a:
                put(im, x, y, (8, 8, 11, a))
    written.append(save(im, "textures/particle/gs_ink_mote.png"))

    # ink drip 4x8 elongated droplet
    im = new(4, 8)
    A = (8, 8, 11, 255)
    a2 = (8, 8, 11, 170)
    a3 = (8, 8, 11, 90)
    HL = (48, 48, 58, 255)
    rows = [
        ".33.",
        ".22.",
        ".AA.",
        ".AA.",
        "2AA2",
        "AAAA",
        "AAAA",
        ".AA.",
    ]
    paint_map(im, rows, {"A": A, "2": a2, "3": a3})
    put(im, 1, 5, HL)
    written.append(save(im, "textures/particle/gs_ink_drip.png"))

    # chain link 8x8
    im = new(8)
    pal = {"k": IRON_K, "H": IRON_H, "G": IRON_M, "I": IRON_D}
    rows = [
        "..kkkk..",
        ".kHHGIk.",
        "kHG..GIk",
        "kHG..GIk",
        "kGI..IIk",
        "kGI..IIk",
        ".kIIIIk.",
        "..kkkk..",
    ]
    paint_map(im, rows, pal)
    written.append(save(im, "textures/particle/gs_chain_link.png"))

    # spark 4x4 pale gold
    im = new(4)
    Y = hexc("#fff3c4")
    g = hexc("#f2c14e", 210)
    rows = [
        ".gg.",
        "gYYg",
        "gYYg",
        ".gg.",
    ]
    paint_map(im, rows, {"Y": Y, "g": g})
    written.append(save(im, "textures/particle/gs_spark.png"))


# --------------------------------------------------------------------------- UI icons 32x32
ICON = hexc("#1a1712")


def icon_canvas():
    im = new(32)
    return im, ImageDraw.Draw(im)


def clear(im, box):
    d = ImageDraw.Draw(im)
    d.rectangle(box, fill=T)


def gen_icons():
    # master: power symbol
    im, d = icon_canvas()
    d.ellipse([5, 7, 26, 28], outline=ICON, width=4)
    clear(im, [12, 3, 19, 15])       # gap at top
    d.rectangle([14, 2, 17, 16], fill=ICON)  # vertical bar
    written.append(save(im, "textures/ui/gs_icon_master.png"))

    # spawning: cave arch
    im, d = icon_canvas()
    d.pieslice([3, 3, 28, 28], 180, 360, fill=ICON)
    d.rectangle([3, 15, 28, 26], fill=ICON)
    d.pieslice([9, 9, 22, 22], 180, 360, fill=T)
    d.rectangle([9, 15, 22, 26], fill=T)
    d.rectangle([1, 27, 30, 29], fill=ICON)   # ground line
    written.append(save(im, "textures/ui/gs_icon_spawning.png"))

    # behavior: footprint (paw)
    im, d = icon_canvas()
    d.ellipse([9, 13, 22, 28], fill=ICON)     # pad
    d.ellipse([3, 9, 9, 16], fill=ICON)       # outer toes
    d.ellipse([22, 9, 28, 16], fill=ICON)
    d.ellipse([9, 3, 15, 10], fill=ICON)      # inner toes
    d.ellipse([16, 3, 22, 10], fill=ICON)
    written.append(save(im, "textures/ui/gs_icon_behavior.png"))

    # audio: speaker
    im, d = icon_canvas()
    d.rectangle([3, 12, 8, 19], fill=ICON)
    d.polygon([(8, 12), (16, 5), (16, 26), (8, 19)], fill=ICON)
    d.arc([12, 8, 24, 23], -50, 50, fill=ICON, width=3)
    d.arc([15, 3, 30, 28], -50, 50, fill=ICON, width=3)
    written.append(save(im, "textures/ui/gs_icon_audio.png"))

    # tools: wrench (45 degree handle, open jaw along the axis)
    im, d = icon_canvas()
    d.line([(5, 26), (20, 11)], fill=ICON, width=7)
    d.ellipse([2, 22, 9, 29], fill=ICON)       # rounded handle end
    d.ellipse([13, 3, 28, 18], fill=ICON)      # head
    hc = (20.5, 10.5)
    ax = (1 / math.sqrt(2), -1 / math.sqrt(2))
    pp = (1 / math.sqrt(2), 1 / math.sqrt(2))
    w = 2.6
    s0 = 1.0
    s1 = 12.0
    slot = [
        (hc[0] + ax[0] * s0 + pp[0] * w, hc[1] + ax[1] * s0 + pp[1] * w),
        (hc[0] + ax[0] * s1 + pp[0] * w, hc[1] + ax[1] * s1 + pp[1] * w),
        (hc[0] + ax[0] * s1 - pp[0] * w, hc[1] + ax[1] * s1 - pp[1] * w),
        (hc[0] + ax[0] * s0 - pp[0] * w, hc[1] + ax[1] * s0 - pp[1] * w),
    ]
    d.polygon(slot, fill=T)
    written.append(save(im, "textures/ui/gs_icon_tools.png"))

    # study: eye
    im, d = icon_canvas()
    pts = []
    for i in range(0, 33):
        x = i
        pts.append((x, 16 - int(round(9 * math.sin(math.pi * i / 32)))))
    for i in range(32, -1, -1):
        x = i
        pts.append((x, 16 + int(round(9 * math.sin(math.pi * i / 32)))))
    d.polygon(pts, fill=ICON)
    inner = []
    for i in range(3, 30):
        inner.append((i, 16 - int(round(5.5 * math.sin(math.pi * (i - 3) / 26)))))
    for i in range(29, 2, -1):
        inner.append((i, 16 + int(round(5.5 * math.sin(math.pi * (i - 3) / 26)))))
    d.polygon(inner, fill=T)
    d.ellipse([11, 11, 20, 20], fill=ICON)     # iris/pupil
    clear(im, [13, 13, 14, 14])                # tiny glint
    written.append(save(im, "textures/ui/gs_icon_study.png"))

    # presets: four small squares
    im, d = icon_canvas()
    for (x, y) in ((4, 4), (17, 4), (4, 17), (17, 17)):
        d.rectangle([x, y, x + 10, y + 10], fill=ICON)
    clear(im, [4, 4, 4, 4]); clear(im, [14, 4, 14, 4]); clear(im, [4, 14, 4, 14]); clear(im, [14, 14, 14, 14])
    clear(im, [17, 4, 17, 4]); clear(im, [27, 4, 27, 4]); clear(im, [17, 14, 17, 14]); clear(im, [27, 14, 27, 14])
    clear(im, [4, 17, 4, 17]); clear(im, [14, 17, 14, 17]); clear(im, [4, 27, 4, 27]); clear(im, [14, 27, 14, 27])
    clear(im, [17, 17, 17, 17]); clear(im, [27, 17, 27, 17]); clear(im, [17, 27, 17, 27]); clear(im, [27, 27, 27, 27])
    written.append(save(im, "textures/ui/gs_icon_presets.png"))

    # status: small bar chart
    im, d = icon_canvas()
    d.rectangle([4, 3, 6, 28], fill=ICON)      # y axis
    d.rectangle([4, 26, 29, 28], fill=ICON)    # x axis
    d.rectangle([9, 17, 13, 24], fill=ICON)
    d.rectangle([16, 11, 20, 24], fill=ICON)
    d.rectangle([23, 5, 27, 24], fill=ICON)
    written.append(save(im, "textures/ui/gs_icon_status.png"))


# --------------------------------------------------------------------------- pack icon 256x256
def gen_pack_icon():
    S = 64
    im = new(S)
    BG = hexc("#0c0c10")
    BG2 = hexc("#111116")
    VOID = hexc("#000000")
    RIM = hexc("#5a5850")
    RIM2 = hexc("#3a3934")
    TOOTH = hexc("#e9dcb8")
    TOOTH2 = hexc("#cfc199")
    GAP = hexc("#14120f")
    LIP = hexc("#8f886f")

    # background with a faint dithered noise so it is not flat
    import random
    rnd = random.Random(7)
    for y in range(S):
        for x in range(S):
            put(im, x, y, BG2 if rnd.random() < 0.18 else BG)

    # hollow eye sockets: sheared ellipses (inner corners raised), black void + pale rim
    def socket(cx, cy, rx, ry, shear):
        pts = set()
        for y in range(S):
            for x in range(S):
                u = (x + 0.5 - cx) - shear * (y + 0.5 - cy)
                v = y + 0.5 - cy
                if (u / rx) ** 2 + (v / ry) ** 2 <= 1.0:
                    pts.add((x, y))
        for (x, y) in pts:
            put(im, x, y, VOID)
        # rim: neighbours of the set that are not in it
        for (x, y) in list(pts):
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n not in pts:
                    # lower rim brighter (light catching the socket edge)
                    put(im, n[0], n[1], RIM if dy == 1 or dy == 0 else RIM2)

    socket(20.5, 22.0, 8.0, 5.2, 0.55)
    socket(43.5, 22.0, 8.0, 5.2, -0.55)

    # grin: region between two upward-curving parabolas
    def y_u(x):
        return 41.0 - 0.014 * (x - 32) ** 2

    def y_l(x):
        return 51.0 - 0.019 * (x - 32) ** 2

    mouth = set()
    for x in range(6, 58):
        yu, yl = y_u(x + 0.5), y_l(x + 0.5)
        for y in range(S):
            if yu <= y + 0.5 <= yl:
                mouth.add((x, y))
    # teeth: pointed upper fangs hanging from the upper lip and lower fangs rising
    for (x, y) in mouth:
        yu, yl = y_u(x + 0.5), y_l(x + 0.5)
        ymid = (yu + yl) / 2
        t = (y + 0.5 - yu) / max(yl - yu, 1)
        # tooth period along x; each tooth 6 px wide with 1px gap
        phase = (x - 6) % 6
        tooth_w = 5
        if phase >= tooth_w:
            put(im, x, y, GAP)
            continue
        # taper: upper teeth narrow toward the middle line, lower teeth narrow upward
        centre = tooth_w / 2 - 0.5
        half = abs(phase - centre)
        if y + 0.5 < ymid:
            limit = 2.5 - 2.2 * (t / 0.5)  # 2.5 at lip, ~0.3 at middle
            col = TOOTH
        else:
            limit = 2.5 - 2.2 * ((1 - t) / 0.5)
            col = TOOTH2
        put(im, x, y, col if half <= limit + 0.01 else GAP)
    # lips: 1px pale line hugging the mouth region
    for (x, y) in list(mouth):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n not in mouth and 0 <= n[0] < S and 0 <= n[1] < S:
                put(im, n[0], n[1], LIP)

    # gold chain across the bottom, slight sag
    flat = [
        "..DDDDDD..",
        ".DLLLMMMD.",
        "DLM....MSD",
        "DMS....SSD",
        ".DSSSSSSD.",
        "..DDDDDD..",
    ]
    edge = [
        "DDD",
        "DLD",
        "DMD",
        "DMD",
        "DSD",
        "DDD",
    ]
    cpal = {"D": DB, "L": GL, "M": GM, "S": GD}
    x = -4
    base_y = 55
    while x < S + 2:
        cx = x + 5
        sag = int(round(2.0 * (1 - ((cx - 32) / 36.0) ** 2)))
        paint_map(im, flat, cpal, x, base_y + sag)
        ex = x + 9
        cxe = ex + 1
        sag_e = int(round(2.0 * (1 - ((cxe - 32) / 36.0) ** 2)))
        paint_map(im, edge, cpal, ex, base_y + sag_e)
        x += 11

    big = im.resize((256, 256), Image.NEAREST)
    written.append(save(big, "pack_icon.png", RP))
    written.append(save(big, "pack_icon.png", BP))


# --------------------------------------------------------------------------- item_texture.json
def gen_item_texture_json():
    names = ["gs_chainbound_dial", "gs_rattle_lure", "gs_broken_chain", "gs_ink_scrap", "gs_grinshackle_fang"]
    data = {
        "resource_pack_name": "grinshackle",
        "texture_name": "atlas.items",
        "texture_data": {n: {"textures": "textures/items/" + n} for n in names},
    }
    path = os.path.join(RP, "textures", "item_texture.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    written.append(path)


if __name__ == "__main__":
    gen_dial()
    gen_lure()
    gen_broken_chain()
    gen_ink_scrap()
    gen_fang()
    gen_particles()
    gen_icons()
    gen_pack_icon()
    gen_item_texture_json()
    for p in written:
        print(p)
