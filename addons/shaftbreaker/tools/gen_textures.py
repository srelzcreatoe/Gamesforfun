"""Procedurally generates every original texture used by the add-on (except the creature skin,
which comes from the supplied model)."""
import json, os, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, 'Shaftbreaker_RP')
MODEL = os.path.join(ROOT, 'src_assets/model')
rng = random.Random(7)
nrng = np.random.default_rng(7)


def save(img, rel):
    p = os.path.join(RP, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p)


# ------------------------------------------------------------------ creature skin + eye layer + spectral
def creature():
    g = json.load(open(os.path.join(MODEL, 'shaftbreaker.geo.json')))['minecraft:geometry'][0]
    base = Image.open(os.path.join(MODEL, 'shaftbreaker.png')).convert('RGBA')
    W, H = base.size
    sc = W / g['description']['texture_width']
    save(base, 'textures/entity/shaftbreaker/shaftbreaker.png')
    eyes = Image.new('RGBA', base.size, (0, 0, 0, 0))
    bpx = base.load(); epx = eyes.load()
    head = next(b for b in g['bones'] if b['name'] == 'head')
    frame_ids = [1, 2, 3, 4, 5]
    pupil_ids = [6, 7]
    for i, c in enumerate(head['cubes']):
        f = c['uv'].get('north')
        if not f:
            continue
        u, v = f['uv']; w, h = f['uv_size']
        x0, y0, x1, y1 = int(u * sc), int(v * sc), int(math.ceil((u + w) * sc)), int(math.ceil((v + h) * sc))
        for y in range(y0, y1):
            for x in range(x0, x1):
                r, gg, b, a = bpx[x, y]
                if i in frame_ids and r > 150 and gg > 95 and r - b > 50:
                    epx[x, y] = (255, 214, 150, 235)
                elif i in pupil_ids:
                    cx = (x - x0 + 0.5) / max(1, x1 - x0) - 0.5; cy = (y - y0 + 0.5) / max(1, y1 - y0) - 0.5
                    d = math.sqrt(cx * cx + cy * cy)
                    k = max(0.0, 1.0 - d * 1.5)
                    epx[x, y] = (int(235 + 20 * k), int(228 + 22 * k), int(205 + 30 * k), int(150 + 105 * k))
    save(eyes, 'textures/entity/shaftbreaker/shaftbreaker_eyes.png')
    a = np.array(base).astype(np.float32)
    grey = a[..., :3].mean(axis=2, keepdims=True)
    tint = np.array([150, 160, 175], np.float32)
    a[..., :3] = grey * 0.55 + tint * 0.45
    a[..., 3] = np.where(a[..., 3] > 0, 92, 0)
    save(Image.fromarray(a.clip(0, 255).astype(np.uint8)), 'textures/entity/shaftbreaker/shaftbreaker_spectral.png')


# ------------------------------------------------------------------ helpers
def noise(w, h, scale=1.0, seed=0):
    r = np.random.default_rng(seed)
    return r.random((h, w)) * scale


def stone_tile(base=(58, 52, 50), var=18, seed=1, size=16):
    r = np.random.default_rng(seed)
    img = np.zeros((size, size, 4), np.uint8)
    n = r.normal(0, var, (size, size))
    blk = r.normal(0, var * 0.6, (size // 4 + 1, size // 4 + 1)).repeat(4, 0).repeat(4, 1)[:size, :size]
    for c in range(3):
        img[..., c] = np.clip(base[c] + n + blk, 0, 255)
    img[..., 3] = 255
    return img


def crack(img, color, n=5, seed=3, length=10):
    r = random.Random(seed)
    h, w = img.shape[:2]
    for _ in range(n):
        x, y = r.randrange(w), r.randrange(h)
        for _ in range(length):
            img[y % h, x % w, :3] = color
            x += r.choice([-1, 0, 1]); y += r.choice([0, 1, 1])
    return img


# ------------------------------------------------------------------ blocks
def blocks():
    # den heart: fractured deepslate with faint bone-white glowing seams
    t = stone_tile((44, 40, 42), 10, 11)
    t = crack(t, (226, 214, 190), 6, 12, 12)
    t = crack(t, (120, 108, 96), 4, 13, 8)
    save(Image.fromarray(t), 'textures/blocks/sb_den_heart.png')
    # den crack wall
    t = stone_tile((70, 66, 64), 14, 21)
    t = crack(t, (22, 20, 20), 5, 22, 14)
    save(Image.fromarray(t), 'textures/blocks/sb_den_crack.png')
    # dust layer
    t = stone_tile((112, 106, 100), 10, 31)
    for _ in range(18):
        x, y = rng.randrange(16), rng.randrange(16)
        t[y, x, :3] = (150, 144, 136)
    save(Image.fromarray(t), 'textures/blocks/sb_den_dust.png')
    # spine (cross plane, bone/mineral spike)
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    for y in range(16):
        half = max(0, int((16 - y) / 16 * 4.5))
        for x in range(8 - half, 8 + half + 1):
            shade = 200 - y * 4 + rng.randint(-14, 14)
            img.putpixel((x, 15 - y if False else y), (min(255, shade + 20), min(255, shade + 10), shade - 10, 255))
    img = img.transpose(Image.FLIP_TOP_BOTTOM)
    for y in range(2, 14, 3):
        img.putpixel((7, y), (92, 84, 78, 255))
    save(img, 'textures/blocks/sb_den_spine.png')
    # cairn marker
    t = np.zeros((16, 16, 4), np.uint8)
    t[..., :3] = (96, 92, 90); t[..., 3] = 255
    t[..., :3] = np.clip(t[..., :3] + np.random.default_rng(5).normal(0, 14, (16, 16, 1)), 0, 255)
    for x in range(16):
        t[0, x, :3] = (130, 126, 122); t[15, x, :3] = (60, 58, 56)
    save(Image.fromarray(t.astype(np.uint8)), 'textures/blocks/sb_cairn.png')
    t2 = t.copy()
    for i in range(6):
        t2[3 + i, 7:9, :3] = (210, 196, 160)
    t2[3, 5:11, :3] = (210, 196, 160); t2[4, 6:10, :3] = (210, 196, 160)
    save(Image.fromarray(t2.astype(np.uint8)), 'textures/blocks/sb_cairn_top.png')


# ------------------------------------------------------------------ items
def items():
    # resonance dial
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.ellipse((1, 1, 14, 14), fill=(176, 104, 66, 255), outline=(98, 54, 34, 255))
    d.ellipse((3, 3, 12, 12), fill=(52, 40, 46, 255))
    for k in range(8):
        a = k / 8 * math.tau
        img.putpixel((int(7.5 + math.cos(a) * 5.5), int(7.5 + math.sin(a) * 5.5)), (236, 200, 150, 255))
    d.line((8, 8, 11, 5), fill=(230, 220, 255, 255))
    d.rectangle((7, 7, 8, 8), fill=(170, 120, 230, 255))
    save(img, 'textures/items/sb_resonance_dial.png')
    # resonance shard
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.polygon([(8, 1), (12, 6), (10, 14), (6, 14), (4, 6)], fill=(214, 206, 196, 255), outline=(120, 110, 104, 255))
    d.line((8, 2, 8, 13), fill=(250, 244, 230, 255))
    d.line((6, 7, 10, 7), fill=(160, 150, 150, 255))
    save(img, 'textures/items/sb_resonance_shard.png')
    # cairn item
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rectangle((3, 11, 12, 14), fill=(90, 86, 84, 255), outline=(54, 52, 50, 255))
    d.rectangle((4, 7, 11, 10), fill=(110, 106, 102, 255), outline=(60, 58, 56, 255))
    d.rectangle((6, 3, 9, 6), fill=(126, 122, 118, 255), outline=(64, 62, 60, 255))
    d.line((7, 4, 8, 4), fill=(220, 204, 166, 255))
    save(img, 'textures/items/sb_cairn_marker.png')


# ------------------------------------------------------------------ moth
def moth():
    W = 32
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0)); px = img.load()
    # wing atlas: 0..15 x 0..11 fore wing, 16..31 x 0..11 hind wing ; body 0..7 x 16..23
    for y in range(12):
        for x in range(16):
            # angular wing silhouette
            inside = x < 15 - (y * 0.45) and y < 11
            if not inside:
                continue
            v = 92 + int(18 * math.sin(x * 0.9 + y * 0.5)) + rng.randint(-10, 10)
            col = (v + 18, v + 10, v)
            if (x + y) % 5 == 0:
                col = (v - 30, v - 34, v - 36)
            if 3 <= x <= 5 and 3 <= y <= 5:
                col = (232, 226, 210)
            px[x, y] = (*[max(0, min(255, c)) for c in col], 255)
    for y in range(12):
        for x in range(16):
            inside = x < 13 - (y * 0.7) and y < 9
            if not inside:
                continue
            v = 80 + rng.randint(-10, 10)
            px[16 + x, y] = (v + 14, v + 8, v, 255)
    for y in range(16, 24):
        for x in range(0, 12):
            v = 58 + rng.randint(-8, 8)
            px[x, y] = (v + 8, v + 4, v, 255)
    px[1, 17] = px[3, 17] = (250, 246, 236, 255)  # eyes
    save(img, 'textures/entity/shaft_moth/shaft_moth.png')


# ------------------------------------------------------------------ particles atlas (64x64, 16px cells)
def particles():
    W = 64
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # cell (0,0): soft dust puff
    for y in range(16):
        for x in range(16):
            r = math.hypot(x - 7.5, y - 7.5) / 8
            a = max(0, 1 - r) ** 1.6
            img.putpixel((x, y), (148, 138, 128, int(a * 200)))
    # cell (1,0): debris chunk
    d.rectangle((18, 2, 27, 11), fill=(72, 66, 64, 255)); d.rectangle((19, 3, 22, 6), fill=(108, 100, 96, 255))
    # cell (2,0): claw scratch marks (3 diagonal gouges)
    for k in range(3):
        for i in range(12):
            x = 34 + k * 3 + i // 3; y = 2 + i
            img.putpixel((x, y), (24, 20, 20, 235)); img.putpixel((x + 1, y), (150, 140, 132, 150))
    # cell (3,0): pale mote
    for y in range(16):
        for x in range(16):
            r = math.hypot(x - 7.5, y - 7.5) / 3
            a = max(0, 1 - r)
            img.putpixel((48 + x, y), (255, 244, 220, int(a * 255)))
    # cell (0,1): wisp
    for y in range(16):
        for x in range(16):
            r = math.hypot((x - 7.5) * 1.6, y - 7.5) / 8
            a = max(0, 1 - r) ** 2
            img.putpixel((x, 16 + y), (190, 200, 220, int(a * 170)))
    save(img, 'textures/particle/sb_particles.png')


def pack_icons():
    p = os.path.join(ROOT, 'build/icon_render.png')
    if os.path.exists(p):
        im = Image.open(p).convert('RGBA').resize((256, 256), Image.LANCZOS)
    else:
        im = Image.new('RGBA', (256, 256), (27, 23, 21, 255))
    im.save(os.path.join(ROOT, 'Shaftbreaker_RP/pack_icon.png'))
    im.save(os.path.join(ROOT, 'Shaftbreaker_BP/pack_icon.png'))


if __name__ == '__main__':
    creature(); blocks(); items(); moth(); particles(); pack_icons()
    print('textures generated')
