"""Compose the Brinesleeper preview sheet (same layout as the concept sheet) from rendered stills."""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

SRC = sys.argv[1] if len(sys.argv) > 1 else 'shots/sheet'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'shots/brinesleeper_preview_sheet.png'
W, H = 2400, 1600
BG = (12, 11, 12)

SERIF_B = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
MONO = '/usr/share/fonts/truetype/freefont/FreeMono.ttf'
MONO_B = '/usr/share/fonts/truetype/freefont/FreeMonoBold.ttf'
RED = (168, 38, 38)
TXT = (214, 205, 198)
DIM = (160, 152, 148)
LINE = (58, 54, 56)


def font(p, s):
    return ImageFont.truetype(p, s)


def load(n):
    return Image.open(f'{SRC}/{n}.png').convert('RGB')


def fit(im, w, h):
    """cover-crop to w x h"""
    r = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * r + 0.5), int(im.height * r + 0.5)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def condensed_text(text, fnt, fill, sx=0.78):
    tmp = Image.new('RGBA', (int(fnt.getlength(text)) + 20, fnt.size * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    d.text((10, 0), text, font=fnt, fill=fill)
    bbox = tmp.getbbox()
    tmp = tmp.crop(bbox)
    return tmp.resize((int(tmp.width * sx), tmp.height), Image.LANCZOS)


def paper():
    rng = np.random.default_rng(3)
    n = rng.normal(0, 3.2, (H, W, 1))
    base = np.ones((H, W, 3)) * np.array(BG)
    yy, xx = np.mgrid[0:H, 0:W]
    vig = 1 - 0.35 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    img = np.clip(base * vig[..., None] + n, 0, 255).astype(np.uint8)
    return Image.fromarray(img, 'RGB')


def frame(d, box, col=LINE, w=2):
    d.rectangle(box, outline=col, width=w)


def main():
    sheet = paper()
    d = ImageDraw.Draw(sheet)

    # ------------------------------------------------ title block with face portrait
    face = load('face')
    por = fit(face, 420, 520)
    por = ImageEnhance.Brightness(por).enhance(0.72)
    mask = Image.new('L', por.size, 0)
    md = ImageDraw.Draw(mask)
    for i in range(120):
        md.rectangle((i, 0, por.width, por.height), fill=int(255 * min(1, i / 120)))
    mask = mask.filter(ImageFilter.GaussianBlur(30))
    edge = Image.new('L', por.size, 255)
    ed = ImageDraw.Draw(edge)
    for i in range(80):
        a = int(255 * (i / 80))
        ed.rectangle((0, por.height - 80 + i, por.width, por.height - 80 + i), fill=255 - a)
    mask = Image.fromarray((np.asarray(mask, float) * np.asarray(edge, float) / 255 * 0.8).astype(np.uint8))
    right = Image.new('L', por.size, 255)
    rd = ImageDraw.Draw(right)
    for i in range(90):
        rd.rectangle((por.width - 90 + i, 0, por.width - 90 + i, por.height), fill=int(255 * (1 - i / 90)))
    mask = Image.fromarray((np.asarray(mask, float) * np.asarray(right, float) / 255).astype(np.uint8))
    # portrait dropped for a cleaner title block
    d = ImageDraw.Draw(sheet)
    t1 = condensed_text('THE', font(SERIF_B, 64), TXT, 0.82)
    sheet.paste(t1, (22, 26), t1)
    t2 = condensed_text('BRINESLEEPER', font(SERIF_B, 88), TXT, 0.70)
    sheet.paste(t2, (20, 100), t2)
    d.rectangle((22, 100 + t2.height + 14, 22 + t2.width, 100 + t2.height + 19), fill=RED)
    d.rectangle((22, 100 + t2.height + 25, 22 + int(t2.width * 0.8), 100 + t2.height + 28), fill=(120, 30, 30))
    y = 100 + t2.height + 58
    f = font(MONO, 27)
    for ln in ['Type: Aquatic Cave Dweller', 'Height: 3.5 Blocks', 'Habitat: Underground Lakes,', 'Flooded Caves, Deep Caverns']:
        d.text((22, y), ln, font=f, fill=TXT)
        y += 38 if ln != 'Height: 3.5 Blocks' else 46
    y += 14
    for ln in ['An ancient, waterborne entity', 'that lurks beneath the surface.', 'It watches, mimics, and hunts', 'within the darkness of', 'underground waters.']:
        d.text((22, y), ln, font=font(MONO, 25), fill=DIM)
        y += 33

    # ------------------------------------------------ turnaround
    views = [('turn_front', 'Front View'), ('turn_side', 'Side View'), ('turn_back', 'Back View'), ('turn_34', '3/4 View')]
    x0, vw, vh = 640, 340, 520
    for i, (n, lab) in enumerate(views):
        im = fit(load(n), vw, vh)
        fm = Image.new('L', (vw, vh), 0)
        fd = ImageDraw.Draw(fm)
        for k in range(40):
            fd.rectangle((k, k, vw - 1 - k, vh - 1 - k), outline=int(255 * (k / 40) ** 1.5))
        fd.rectangle((40, 40, vw - 41, vh - 41), fill=255)
        sheet.paste(im, (x0 + i * vw, 10), fm)
        tw = d.textlength(lab, font=font(MONO, 27))
        d.text((x0 + i * vw + (vw - tw) / 2, 538), lab, font=font(MONO, 27), fill=TXT)
    d.line((2018, 30, 2018, 560), fill=LINE, width=2)

    # ------------------------------------------------ size comparison
    d.text((2068, 40), 'Size', font=font(MONO, 30), fill=TXT)
    d.text((2068, 76), 'Comparison', font=font(MONO, 30), fill=TXT)
    sil = load('sil_front').convert('L')
    a = np.asarray(sil).astype(float)
    m = (a > 40)
    ys, xs = np.where(m)
    sil_c = sil.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    floor_y = 520
    target_h = 300                   # 3.5 blocks -> 300 px  (56 model px)
    s = target_h / sil_c.height
    sil_c = sil_c.resize((int(sil_c.width * s), target_h), Image.LANCZOS)
    col = Image.new('RGB', sil_c.size, (150, 146, 146))
    sx = 2120
    sheet.paste(col, (sx, floor_y - target_h), sil_c.point(lambda v: 255 if v > 40 else 0))
    # generic player-size mannequin (2 blocks = 32 px -> 32/56 * 360)
    u = target_h / 56.0
    px = 2046
    def blk(x, y, w, h, c):
        d.rectangle((px + x * u, floor_y - (y + h) * u, px + (x + w) * u - 1, floor_y - y * u - 1), fill=c)
    blk(0, 0, 4, 12, (88, 86, 90)); blk(4, 0, 4, 12, (78, 76, 80))          # legs
    blk(0, 12, 8, 12, (104, 102, 106))                                        # body
    blk(-4, 12, 4, 12, (96, 94, 98)); blk(8, 12, 4, 12, (88, 86, 90))         # arms
    blk(0, 24, 8, 8, (112, 110, 114))                                         # head
    d.text((px - 20, floor_y + 12), 'Player', font=font(MONO, 20), fill=DIM)
    d.text((px - 20, floor_y + 34), '(2 blocks)', font=font(MONO, 20), fill=DIM)
    ax = sx + sil_c.width + 16
    d.line((ax, floor_y - target_h, ax, floor_y), fill=(190, 180, 170), width=2)
    for yy in (floor_y - target_h, floor_y):
        d.line((ax - 10, yy, ax + 10, yy), fill=(190, 180, 170), width=2)
    for yy in range(floor_y - target_h, floor_y, 14):
        d.line((sx - 4, yy, sx + 6, yy), fill=(90, 86, 86), width=1) if False else None
    d.text((ax + 10, floor_y - target_h / 2 - 26), '3.5', font=font(MONO, 22), fill=TXT)
    d.text((ax + 10, floor_y - target_h / 2), 'Blocks', font=font(MONO, 22), fill=TXT)
    d.line((2060, floor_y, 2390, floor_y), fill=(90, 86, 86), width=2)

    # ------------------------------------------------ animation pose row
    poses = [('pose_idle_water', 'Idle (In Water)'), ('pose_watch', 'Watching (Shoreline)'), ('pose_stalk', 'Crouch / Stalk'),
             ('pose_run', 'Run (Hunt State)'), ('pose_lunge', 'Lunge Attack'), ('pose_emerge', 'Emerging'), ('pose_submerge', 'Retreat (Submerge)')]
    px0, py0, pw, ph = 16, 584, 338, 272
    d.rectangle((px0 - 2, py0 - 2, px0 + 7 * pw + 2, py0 + ph + 62), outline=LINE, width=2)
    for i, (n, lab) in enumerate(poses):
        im = fit(load(n), pw - 4, ph)
        sheet.paste(im, (px0 + i * pw + 2, py0))
        d.rectangle((px0 + i * pw, py0 + ph, px0 + (i + 1) * pw, py0 + ph + 60), fill=(22, 20, 21))
        tw = d.textlength(lab, font=font(MONO, 24))
        d.text((px0 + i * pw + (pw - tw) / 2, py0 + ph + 16), lab, font=font(MONO, 24), fill=TXT)
        if i:
            d.line((px0 + i * pw, py0, px0 + i * pw, py0 + ph + 60), fill=LINE, width=2)

    # ------------------------------------------------ key mechanics
    ky = 944
    km = condensed_text('KEY MECHANICS:', font(SERIF_B, 52), (176, 44, 40), 0.78)
    sheet.paste(km, (20, ky), km)
    mech = [
        ('eye', 'False Reflection', ['Its reflection can appear in water', 'before it actually emerges.']),
        ('wave', 'Drowning Grasp', ['Attempts to pull the player', 'underwater when in close range.']),
        ('splash', 'Echoed Splashes', ['Mimics your water footsteps', 'with a delay.']),
        ('drop', 'Stillwater Curse', ['Nearby water becomes unnaturally', 'quiet and darker.']),
        ('drip', 'Dryland Hunt', ['Can leave the water to chase', 'for a limited time (15-20s).']),
    ]
    yy = ky + 82
    for icon, title, lines in mech:
        draw_icon(d, icon, 26, yy + 4)
        d.text((112, yy), title, font=font(MONO_B, 28), fill=TXT)
        for j, ln in enumerate(lines):
            d.text((112, yy + 37 + j * 25), ln, font=font(MONO, 20), fill=DIM)
        yy += 48 + 25 * len(lines) + 12

    # ------------------------------------------------ hero + small panels
    hx, hy, hw, hh = 548, 936, 860, 650
    sheet.paste(fit(load('hero'), hw, hh), (hx, hy))
    frame(d, (hx - 2, hy - 2, hx + hw + 1, hy + hh + 1))
    sw, shh = 488, 323
    smalls = [('reflection', 'False Reflection'), ('torch_still', 'Dryland Hunt'), ('swim_still', 'Underwater'), ('face', 'Close-up')]
    for i, (n, lab) in enumerate(smalls):
        x = 1414 + (i % 2) * (sw + 6)
        y = 936 + (i // 2) * (shh + 4)
        sheet.paste(fit(load(n), sw, shh), (x, y))
        frame(d, (x - 1, y - 1, x + sw, y + shh))
        d.text((x + 12, y + shh - 34), lab, font=font(MONO, 20), fill=(200, 192, 188))

    sheet.save(OUT, optimize=True)
    print('sheet ->', OUT, sheet.size)


def draw_icon(d, kind, x, y):
    c1, c2 = (150, 140, 146), (190, 60, 60)
    s = 6
    d.rectangle((x - 6, y - 6, x + 66, y + 66), fill=(24, 22, 23), outline=(50, 46, 48))
    def px(i, j, c):
        d.rectangle((x + i * s, y + j * s, x + i * s + s - 1, y + j * s + s - 1), fill=c)
    if kind == 'eye':
        for i in range(2, 9):
            px(i, 3, c1); px(i, 7, c1)
        for j in range(4, 7):
            px(1, j, c1); px(9, j, c1)
        for i, j in ((4, 4), (5, 4), (6, 4), (4, 5), (6, 5), (4, 6), (5, 6), (6, 6)):
            px(i, j, c2)
        px(5, 5, (20, 10, 12))
    elif kind == 'wave':
        for row in (2, 5, 8):
            for i in range(10):
                px(i, row + (1 if i % 4 in (1, 2) else 0), (120, 150, 170))
    elif kind == 'splash':
        for i, j in ((5, 2), (3, 3), (7, 3), (2, 5), (8, 5), (5, 4), (4, 6), (6, 6), (5, 7), (4, 8), (5, 8), (6, 8), (3, 9), (7, 9)):
            px(i, j, c1)
    elif kind == 'drop':
        for i, j in ((5, 1), (5, 2), (4, 3), (5, 3), (6, 3), (4, 4), (5, 4), (6, 4), (3, 5), (4, 5), (5, 5), (6, 5), (7, 5),
                     (3, 6), (4, 6), (5, 6), (6, 6), (7, 6), (3, 7), (4, 7), (5, 7), (6, 7), (7, 7), (4, 8), (5, 8), (6, 8)):
            px(i, j, c1)
        px(4, 6, (230, 225, 225))
    elif kind == 'drip':
        for i in range(1, 10):
            px(i, 1, c1); px(i, 2, c1)
        for i, ln in ((2, 3), (4, 6), (6, 4), (8, 7)):
            for j in range(3, 3 + ln):
                px(i, j, c1)


if __name__ == '__main__':
    main()
