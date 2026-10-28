"""Picture panels (section A): posters, kids' drawings and signs.

Each panel is drawn on a full-size canvas (16 px per block), aged, then sliced
into 16x16 tiles saved as <name>_<tile> (row-major from the top-left).
Run: python3 tools/blocks/surfaces/gen_panels.py [preview.png]
"""
import numpy as np

from canvas import Canvas
from pixlib import hexc, mix, rng, shade, white

GOLD, GOLD_D = '#e3b448', '#7a5418'
CREAM = '#d9cfb6'


def _disc(c, cx, cy, radii_colors):
    yy, xx = np.mgrid[0:c.h, 0:c.w]
    d = np.sqrt((xx + 0.5 - cx) ** 2 + ((yy + 0.5 - cy) * 0.85) ** 2)
    for rad, col in radii_colors:
        m = d < rad
        c.rgb[m] = hexc(col)


def _star(c, x, y, col='#d9b24a', small=False):
    c.px(x, y, col, height=170)
    if not small:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            c.px(x + dx, y + dy, mix(hexc(col), c.rgb[y + dy, x + dx] if 0 <= y + dy < c.h and 0 <= x + dx < c.w else hexc(col), 0.45))


def _border(c, outer='#c4b89c', inner=None):
    c.frame(0, 0, c.w, c.h, outer)
    if inner:
        c.frame(1, 1, c.w - 1, c.h - 1, inner)


# ------------------------------------------------------------------ posters
def poster_revue():
    c = Canvas(32, 48, rough=200)
    c.noise_fill(['#141a30', '#171d36', '#1a213b'], 3101)
    _disc(c, 16, 26, [(17, '#1f2747'), (13.5, '#252e54'), (10, '#2c3762')])
    for (x, y) in [(3, 32), (28, 32), (2, 17), (29, 18)]:
        _star(c, x, y, small=True)
    c.text('RUSTGRIN', 0, 2, GOLD, font='tall', cond_chars={'I'}, shadow='#5a1414', outline='#0e0f1c', center='c')
    c.text('& THE', 0, 10, CREAM, shadow='#0e0f1c', center='c')
    c.sprite('mirehop_small', -1, 15, outline='#0b0c16')
    c.sprite('noxbriar_small', 22, 16, outline='#4a5288')
    c.sprite('rustgrin_bust', 7, 16, overlays=('rustgrin_mic',), outline='#0b0c16')
    # banner with the band name
    c.rect(1, 35, 31, 47, '#7c1a1e')
    c.rect(1, 35, 31, 36, '#a3282c')
    c.rect(1, 46, 31, 47, '#4d1013')
    c.text('RUSTY', 0, 36, GOLD, shadow='#3a0c0e', center='c')
    c.text('REVUE', 0, 42, GOLD, shadow='#3a0c0e', center='c')
    _border(c, '#bfb397')
    c.age(3102, fade=0.16, stains=2, crease_rows=(23,), torn=(('br', 3),), tape=((13, 0, 6, 1),))
    return c


def poster_party():
    c = Canvas(32, 32, rough=200)
    c.noise_fill(['#5e1f24', '#66232a', '#6d272d'], 3201)
    # starburst rays behind Rustgrin
    yy, xx = np.mgrid[0:32, 0:32]
    ang = np.arctan2(yy - 20, xx - 18)
    rays = (np.floor((ang + np.pi) / (np.pi / 8)) % 2) == 0
    c.rgb[rays] = mix(c.rgb[rays], hexc('#9a3a32'), 0.55)
    # confetti
    r = rng(3202)
    cols = ['#d8b444', '#4fa6a0', '#c9568e', '#d9cfb6', '#6a8fd0']
    for i in range(26):
        x, y = int(r.integers(1, 31)), int(r.integers(1, 31))
        c.px(x, y, cols[i % len(cols)])
        if i % 3 == 0:
            c.px(x + 1, y, cols[i % len(cols)])
    c.sprite('rustgrin_wave', 6, 8, overlays=('rustgrin_wave',), outline='#22080b')
    c.text("LET'S", 0, 1, GOLD, font='tall', shadow='#2a0a0c', outline='#2a0a0c', center='c')
    c.rect(1, 24, 31, 31, '#d1a63e')
    c.rect(1, 24, 31, 25, '#e8c461')
    c.text('PARTY!', 0, 24, '#7a1418', font='tall', center='c')
    _border(c, '#bfb397')
    c.age(3203, fade=0.15, stains=2, crease_cols=(15,), torn=(('tr', 2),), tape=((1, 0, 4, 1), (27, 0, 4, 1)))
    return c


def poster_cabaret():
    c = Canvas(32, 48, rough=200)
    # velvet curtain sides and a dark stage with a pink spotlight
    c.noise_fill(['#160c1d', '#1a0f22', '#1d1126'], 3301)
    _disc(c, 16, 27, [(14, '#3a1d46'), (11, '#4e2a5c'), (8, '#643a72')])
    prof = [0.2, 0.45, 0.75, 0.95, 0.7, 0.4]
    pal = [hexc(h) for h in ('#24102e', '#2f1539', '#3b1b47', '#4a2457', '#582c66')]
    for x in range(6):
        for y in range(48):
            v = prof[x]
            col = pal[int(v * 4.99)]
            c.px(x + 1, y, col)
            c.px(30 - x, y, col)
    for (x, y) in [(3, 20), (28, 25), (4, 35), (27, 40), (2, 44), (29, 14)]:
        _star(c, x, y, '#c99a38', small=(x + y) % 2 == 0)
    c.text("KITTY'S", 0, 2, GOLD, font='tall', cond_chars={'I'}, shadow='#3a1240', outline='#0d0612', center='c')
    c.text('CABARET', 0, 10, GOLD, font='tall', shadow='#3a1240', outline='#0d0612', center='c')
    c.sprite('cat_pose', 6, 17, overlays=('cat_paws',), outline='#0d0612')
    c.rect(1, 35, 31, 47, '#2a1233')
    c.rect(1, 35, 31, 36, GOLD_D)
    c.text('NIGHTLY', 0, 36, GOLD, shadow='#0d0612', center='c')
    c.text('AT 8!', 0, 42, CREAM, shadow='#0d0612', center='c')
    _border(c, '#bfb397')
    c.age(3302, fade=0.14, stains=2, crease_rows=(23,), torn=(('tl', 2),), tape=((13, 0, 6, 1),))
    return c


def poster_midway():
    c = Canvas(32, 48, rough=200)
    # circus tent stripes
    for x in range(32):
        col = '#8a2020' if (x // 4) % 2 == 0 else '#cfc5a8'
        c.rect(x, 0, x + 1, 48, col)
    wn = white(32, 48, 3401)
    c.rgb = shade(c.rgb, 0.92 + 0.12 * wn)
    # dark scalloped valance at the top with the title
    c.rect(0, 0, 32, 7, '#3a1012')
    for x in range(32):
        if x % 4 in (1, 2):
            c.px(x, 7, '#3a1012')
    c.text("MARVELLO'S", 0, 1, CREAM, cond_chars=set("ELM'OS"), center='c')
    c.text('MIDNIGHT', 0, 9, GOLD, font='tall', cond_chars=set('IMN'), shadow='#2a0808', outline='#2a0808', center='c')
    c.sprite('purple_rat_bust', 15, 19, overlays=('maracas',), outline='#2a0808')
    c.sprite('top_hat_rat_bust', 0, 17, overlays=('cane',), outline='#2a0808')
    c.rect(1, 39, 31, 47, '#2a0808')
    c.rect(1, 39, 31, 40, '#c9a13c')
    c.text('MIDWAY', 0, 40, GOLD, font='tall', cond_chars=set('IMW'), center='c')
    for x in range(32):
        c.px(x, 47, '#bfb397')
    c.age(3402, fade=0.2, stains=3, crease_rows=(24,), torn=(('bl', 3),), tape=((1, 0, 4, 1), (27, 0, 4, 1)))
    return c


def poster_rules():
    c = Canvas(32, 32, rough=225)
    c.noise_fill(['#c6bca3', '#cdc3aa', '#d2c8b0'], 3501, amt=0.6)
    c.rect(1, 1, 31, 19, '#7a1c1f')
    c.rect(1, 18, 31, 19, '#4e1113')
    c.sprite('rustgrin_small', 0, 4, outline='#4e1113')
    c.text('PIZZA', 13, 1, CREAM)
    c.text('REVUE', 13, 7, CREAM, cond_chars={'E'})
    c.text('RULES', 13, 13, GOLD, cond_chars={'E', 'L'}, shadow='#3a0c0e')
    # numbered rules: digit + illegible pixel "words"
    r = rng(3502)
    ink = '#3b3430'
    for i, y in enumerate((20, 26)):
        c.text(str(i + 1), 3, y, '#7a1c1f')
        for row in (1, 3):
            x = 8
            end = 29 if row == 1 else int(r.integers(16, 26))
            while x < end:
                ln = int(r.integers(2, 5))
                for k in range(ln):
                    if x + k < end:
                        c.px(x + k, y + row, ink)
                x += ln + 1
    _border(c, '#b3a88d')
    c.age(3503, fade=0.08, yellow=0.16, stains=2, torn=(('bl', 2),), tape=((13, 0, 6, 1),))
    return c


def poster_missing():
    c = Canvas(16, 32, rough=235)
    c.noise_fill(['#bdb08a', '#c4b892', '#cabf9a'], 3601, amt=0.6)
    ink = '#2a2422'
    c.text('HAVE', 0, 2, ink, center='c')
    c.text('YOU', 0, 8, ink, center='c')
    c.text('SEEN', 0, 14, ink, cond_chars={'E'}, center='c')
    # photocopied photo with a blank grey silhouette (security cap)
    c.rect(2, 20, 14, 30, '#8d8b84')
    c.frame(2, 20, 14, 30, '#5a5852')
    sil = [
        "....oooo....",
        "...oCCCCo...",
        "..ooBBCCoo..",
        "...oGGGGo...",
        "...oGGGGo...",
        "....oggo....",
        "..ooGGGGoo..",
        ".oGGGGGGGGo.",
        ".oGGGGGGGGo.",
    ]
    cmap = {'o': '#55544f', 'C': '#4a4945', 'B': '#7d7c77', 'G': '#6b6a66', 'g': '#5c5b57'}
    for y, row in enumerate(sil):
        for x, ch in enumerate(row):
            if ch in cmap and 2 + x < 14 and 21 + y < 30:
                c.px(2 + x, 21 + y, cmap[ch])
    # fine print
    for x in range(2, 14):
        if x % 4 != 1:
            c.px(x, 31 - 1, '#6d6352')
    c.age(3602, paper='#c2b58e', fade=0.06, yellow=0.2, stains=2, crease_rows=(15,), torn=(('br', 2),),
          tape=((6, 0, 4, 1),), dirt=0.18)
    return c


# ------------------------------------------------------------------ kids' drawings
DRAW_KEYS = {
    'p': '#e4dfd2', 'P': '#d6d0c0',  # paper, paper shade
    't': '#d3c896',  # tape
    'k': '#2b2a2e',  # black crayon
    'r': '#c8312c', 'o': '#d9822b', 'y': '#e1c23c', 'g': '#4f9a3a', 'G': '#2f6b2a', 'b': '#3b62b8',
    'u': '#6a3f8e', 'n': '#7a5232', 'e': '#8a8a8a', 'm': '#8c3a4a', 'c': '#d88aa0', 'w': '#f4f1e8',
    'l': '#6dc0e8',
}

DRAWINGS = [
    # 0 Rustgrin with his mic, sun, grass
    [
        ".tt..........tt.",
        ".pppppppppppppp.",
        ".pppppppppppyyp.",
        ".pppprrppppyyyp.",
        ".pppprrpppppyyp.",
        ".ppkeeeekpppppp.",
        ".ppeeeeeeppppp..",
        ".ppekeekepppep..",
        ".ppeewweepppep..",
        ".pppekkeppppkp..",
        ".pprrwwrrpppkpp.",
        ".pprrwwrrrrkkpp.",
        ".pppewppewppppp.",
        ".gggggggggggggg.",
        ".pppppppppppppp.",
        "................",
    ],
    # 1 Mirehop with a red guitar
    [
        ".tt..........tt.",
        ".ppppgppgpppppp.",
        ".ppppgppgpppppp.",
        ".ppppgppgpppppp.",
        ".pppggggggppppp.",
        ".pppgkggkgppppp.",
        ".pppgnnnngppppp.",
        ".ppppgnngpppppp.",
        ".ppgggggggggppp.",
        ".ppgnnrrrnnggpp.",
        ".pppgrrrrkkkkkp.",
        ".pppgrrrrngpppp.",
        ".ppppgppgpppppp.",
        ".ppppGppGpppppp.",
        ".pppppppppppppp.",
        "................",
    ],
    # 2 Noxbriar: black bear, top hat, purple bow, moon
    [
        ".tt..........tt.",
        ".ppppkkkkppppyp.",
        ".ppppkkkkpppyyp.",
        ".pppkkkkkkppyyp.",
        ".ppkkpkkpkkpppy.",
        ".pppkkkkkkppppp.",
        ".pppkrkkrkppppp.",
        ".pppkkwwkkppppp.",
        ".ppppkkkkpppppp.",
        ".pppppuuppppppp.",
        ".pppkkuukkppppp.",
        ".ppkkknnkkkpppp.",
        ".ppppkppkpppppp.",
        ".ppppkppkpppppp.",
        ".pppppppppppppp.",
        "................",
    ],
    # 3 the Cat with hearts
    [
        ".tt..........tt.",
        ".pppppppppppppp.",
        ".ppmppppmppcpcp.",
        ".ppmmppmmpppcpp.",
        ".ppmmmmmmppppp..",
        ".ppmkmmkmppcpcp.",
        ".ppmmccmmpppcpp.",
        ".ppkmmmmkpppppp.",
        ".pppmmmmpppppp..",
        ".ppmmwwmmpppppp.",
        ".pmpmwwmpmppppp.",
        ".pppmwwmppppppp.",
        ".pppmppmppppmmp.",
        ".pppmppmpppppmp.",
        ".pppppppppppppp.",
        "................",
    ],
    # 4 the two rats: Ringmaster (hat + cane) and Purple Rat (maracas)
    [
        ".tt..........tt.",
        ".pppppppppppppp.",
        ".pppprrpppppppp.",
        ".pppprrpppppppp.",
        ".ppeepeeppuppup.",
        ".pppeeeppppuuup.",
        ".ppperepppprurp.",
        ".ppppeppkpppupp.",
        ".pprrrrrkprupurp",
        ".pprwwrrkppuuup.",
        ".ppprrrpkppuuup.",
        ".pppeppepppupup.",
        ".pppeppepppupup.",
        ".gggggggggggggg.",
        ".pppppppppppppp.",
        "................",
    ],
    None,  # 5 is composed in _group_drawing()
]


def _group_drawing():
    """Everyone in two rows on a brown stage, and a tiny stick-figure guard watching."""
    g = [list('.pppppppppppppp.') for _ in range(16)]
    g[0] = list('.tt..........tt.')
    g[15] = list('................')
    figs = {  # (x, y): 3-wide pattern rows
        (1, 2): ['g.g', 'g.g', 'ggg', 'kgk', 'ggg'],      # Mirehop: long ears
        (5, 2): ['.r.', 'rrr', 'eee', 'rer', 'eee'],      # Rustgrin: red hat, red eyes
        (9, 2): ['kkk', 'kkk', 'kkk', 'rkr', 'kkk'],      # Noxbriar: black top hat
        (1, 7): ['m.m', 'mmm', 'rmr', 'mmm', 'mwm'],      # the Cat
        (5, 7): ['u.u', 'uuu', 'kuk', 'uwu', 'uuu'],      # Purple Rat
        (9, 7): ['rrr', 'eee', 'rer', 'rwr', 'r.r'],      # Ringmaster in his red coat
    }
    for (x0, y0), pat in figs.items():
        for dy, row in enumerate(pat):
            for dx, ch in enumerate(row):
                if ch != '.':
                    g[y0 + dy][x0 + dx] = ch
    for x in range(1, 12):
        g[12][x] = 'n'
        g[13][x] = 'n' if x % 3 else 'o'
    for (x, y) in [(13, 8), (12, 9), (13, 9), (14, 9), (13, 10), (12, 11), (14, 11)]:
        g[y][x] = 'k'  # tiny stick-figure guard
    g[2][13], g[2][14], g[3][14] = 'y', 'y', 'y'  # sun
    return [''.join(r) for r in g]


def drawing(i):
    c = Canvas(16, 16, rough=240)
    c.a[:] = 0
    rows = DRAWINGS[i] if DRAWINGS[i] is not None else _group_drawing()
    r = rng(3700 + i)
    wn = white(16, 16, 3710 + i)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            col = hexc(DRAW_KEYS[ch])
            if ch not in 'pPt':
                # crayon: waxy, uneven coverage lets the paper show through a little
                col = mix(col, hexc('#e4dfd2'), 0.12 + 0.25 * wn[y, x] * (wn[y, x] > 0.6))
                c.px(x, y, col, rough=200, height=160)
            elif ch == 't':
                c.px(x, y, col, rough=120, height=175)
            else:
                c.px(x, y, mix(col, hexc('#b8ad8c'), 0.15 * wn[y, x]), height=150)
    # paper yellowing + a dog-ear
    m = c.a > 0
    c.rgb[m] = mix(c.rgb[m], hexc('#b9ac86'), 0.12)
    return c


# ------------------------------------------------------------------ signs
def _bulb(c, x, y, lit=True):
    c.px(x, y, '#fff2c0' if lit else '#6b6250', emit=255 if lit else 0, rough=60, height=210)


def sign_cabaret():
    c = Canvas(48, 16, rough=150)
    c.noise_fill(['#2c1536', '#31183c', '#361b42'], 3801, amt=0.8)
    c.frame(0, 0, 48, 16, '#7a5a20', metal=160, rough=110)
    c.frame(1, 1, 47, 15, '#b08a2e', metal=180, rough=90)
    c.frame(2, 2, 46, 14, '#1a0c20')
    for x in range(1, 47, 3):
        _bulb(c, x, 1, lit=(x != 22))
        _bulb(c, x, 14, lit=(x != 31))
    for y in (4, 7, 10):
        _bulb(c, 1, y)
        _bulb(c, 46, y)
    c.text("KITTY'S", 0, 3, GOLD, shadow='#120814', center='c')
    c.text('CABARET', 0, 9, '#e7c7e4', shadow='#120814', center='c')
    # dust and grime on the board
    c.age(3802, paper='#3a2a33', fade=0.05, yellow=0.03, stains=1, dirt=0.1)
    return c


def sign_midway():
    c = Canvas(64, 16, rough=160)
    c.noise_fill(['#7a1a1a', '#821d1d', '#8a2020'], 3901, amt=0.8)
    c.rect(4, 3, 60, 13, '#cfc5a8')
    c.frame(4, 3, 60, 13, '#9d9378')
    c.frame(0, 0, 64, 16, '#3a0c0c')
    for x in range(2, 63, 4):
        _bulb(c, x, 1, lit=(x != 26))
        _bulb(c, x, 14, lit=(x != 50))
    for y in (5, 8, 11):
        _bulb(c, 1, y)
        _bulb(c, 62, y)
    c.text('MIDNIGHT MIDWAY', 0, 5, '#8a1c1c', font='tall', cond_chars=set('IMNW'), center='c')
    c.age(3902, paper='#a8987a', fade=0.06, yellow=0.06, stains=2, dirt=0.12)
    return c


def _neon(c, text, y, core, glow, dead=(), spacing=3, emit=255):
    from font import render
    m = render(text, font='neon', spacing=spacing)
    h, w = m.shape
    x0 = (c.w - w) // 2
    # character spans so a single letter can be "dead"
    spans = []
    x = 0
    for i, ch in enumerate(text):
        gw = render(ch, font='neon').shape[1]
        spans.append((x, x + gw, i))
        x += gw + spacing
    dead_cols = np.zeros(w, bool)
    for a, b, i in spans:
        if i in dead:
            dead_cols[a:b] = True
    halo = np.zeros((h + 2, w + 2), bool)
    big = np.zeros((h + 2, w + 2), bool)
    big[1:-1, 1:-1] = m & ~dead_cols[None, :]
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        halo |= np.roll(np.roll(big, dy, 0), dx, 1)
    halo &= ~big
    for yy, xx in zip(*np.nonzero(halo)):
        X, Y = x0 + xx - 1, y + yy - 1
        if 0 <= X < c.w and 0 <= Y < c.h:
            c.rgb[Y, X] = mix(c.rgb[Y, X], hexc(glow), 0.55)
            c.emit[Y, X] = max(c.emit[Y, X], 70)
    for yy, xx in zip(*np.nonzero(m)):
        if dead_cols[xx]:
            c.px(x0 + xx, y + yy, '#3a3a40', rough=60, height=200)  # dead glass tube
        else:
            c.px(x0 + xx, y + yy, core, emit=emit, rough=50, height=200)


def sign_revue():
    c = Canvas(96, 32, rough=170, height=140)
    c.noise_fill(['#121116', '#15141a', '#18171e'], 4001, amt=0.8)
    c.frame(0, 0, 96, 32, '#3a3a40', metal=180, rough=110)
    c.frame(1, 1, 95, 31, '#26262b', metal=150, rough=120)
    for (x, y) in [(3, 3), (92, 3), (3, 28), (92, 28), (48, 3), (48, 28)]:
        c.px(x, y, '#6d6d74', metal=200, rough=90, height=190)  # bolts
    # rust streaks from the bolts
    for (x, y) in [(3, 4), (3, 5), (92, 4), (48, 29)]:
        c.px(x, y, '#5a3a26', rough=220)
    _neon(c, "RUSTGRIN'S", 4, '#ff6fb5', '#ff2f8e')
    _neon(c, 'PIZZA REVUE', 20, '#7ff6e8', '#1fd0c0', dead=(3,), spacing=2)
    # mounting rails between the rows
    for x in range(4, 92):
        c.px(x, 16, '#2a2a30', metal=170, rough=120)
        c.px(x, 15, '#1c1b20')
    c.age(4002, paper='#2a2a2e', fade=0.02, yellow=0.0, stains=0, dirt=0.08)
    return c


def sign_out_of_order():
    c = Canvas(32, 16, rough=245)
    c.a[:] = 0
    # cardboard with corrugation shading and a few ragged edge bites
    pal = [hexc(h) for h in ('#9a7a4e', '#a68558', '#b08f61', '#b8986a')]
    wn = white(32, 16, 4102)
    bites = {(0, 0), (1, 0), (5, 0), (12, 0), (13, 0), (21, 0), (30, 0), (31, 0), (0, 15), (8, 15), (9, 15),
             (19, 15), (31, 15), (31, 14), (0, 7)}
    for y in range(16):
        for x in range(32):
            if (x, y) in bites:
                continue
            k = 2 + (1 if x % 3 == 0 else 0) - (1 if wn[y, x] > 0.85 else 0)
            c.px(x, y, pal[int(np.clip(k, 0, 3))], height=150)
    ink = '#141212'
    from font import render
    x = 5
    for i, ch in enumerate('SORRY!'):
        m = render(ch)
        dy = (0, 1, 0, 0, 1, 0)[i]
        for yy, xx in zip(*np.nonzero(m)):
            c.px(x + xx, 1 + dy + yy, ink, rough=170)
        x += m.shape[1] + 1
    HAND = {
        'O': ['.#.', '#.#', '#.#', '.#.'], 'U': ['#.#', '#.#', '#.#', '###'], 'T': ['###', '.#.', '.#.', '.#.'],
        'F': ['###', '#..', '##.', '#..'], 'R': ['##.', '#.#', '##.', '#.#'], 'D': ['##.', '#.#', '#.#', '##.'],
        'E': ['###', '##.', '#..', '###'], ' ': ['..', '..', '..', '..'],
    }
    for line, y0, x0, wob in (('OUT OF', 7, 5, (0, 0, 1, 0, 0, 1)), ('ORDER', 11, 7, (1, 0, 0, 1, 0))):
        x = x0
        for i, ch in enumerate(line):
            g = HAND[ch]
            for yy, row in enumerate(g):
                for xx, cc in enumerate(row):
                    if cc == '#':
                        c.px(x + xx, y0 + yy + wob[i], ink, rough=170)
            x += len(g[0]) + 1
    # tape strips at the top corners
    for x0 in (1, 27):
        c.rect(x0, 0, x0 + 4, 2, '#cfc9b2', rough=110, height=180)
    c.age(4103, paper='#a68558', fade=0.02, yellow=0.02, stains=1, dirt=0.06)
    return c


STAFF_PLATES = {
    0: ('#7a1c1f', '#4e1113', '#e3d8c2'),
    1: ('#24407a', '#152a55', '#e3ded0'),
    2: ('#24407a', '#152a55', '#e3ded0'),
    3: ('#a7a9a4', '#6c6e6a', '#26272b'),
}


def sign_staff(i):
    c = Canvas(16, 16, rough=120, height=170)
    plate, edge, ink = STAFF_PLATES[i]
    c.fill(plate)
    c.noise_fill([plate, mix(hexc(plate), hexc('#000000'), 0.06), mix(hexc(plate), hexc('#ffffff'), 0.05)],
                 4200 + i, amt=0.5)
    c.frame(0, 0, 16, 16, edge)
    for (x, y) in ((0, 0), (15, 0), (0, 15), (15, 15)):
        c.a[y, x] = 0  # rounded corners
    metal = 200 if i == 3 else 0
    c.metal[:] = metal
    if i == 0:
        c.text('STAFF', 0, 2, ink, cond_chars={'F'}, center='c')
        c.text('ONLY', 0, 9, ink, cond_chars={'L'}, center='c')
    elif i == 1:
        fig = ['..##..', '..##..', '.####.', '#.##.#', '#.##.#', '..##..', '.#..#.', '.#..#.']
        for y, row in enumerate(fig):
            for x, ch in enumerate(row):
                if ch == '#':
                    c.px(5 + x, 1 + y, ink)
        c.text('MEN', 0, 10, ink, center='c')
    elif i == 2:
        c.text('WO', 0, 2, ink, cond_chars={'W'}, center='c')
        c.text('MEN', 0, 9, ink, center='c')
    else:
        c.text('KIT', 0, 2, ink, center='c')
        c.text('CHEN', 0, 9, ink, cond_chars={'E'}, center='c')
        for (x, y) in ((1, 1), (14, 1), (1, 14), (14, 14)):
            c.px(x, y, '#5b5d59', metal=220, height=200)  # screws
    c.age(4210 + i, paper=plate, fade=0.03, yellow=0.04, stains=0, dirt=0.1)
    return c


# ------------------------------------------------------------------ registry
PANELS = {
    # name: (builder, cols, rows)
    'poster_revue': (poster_revue, 2, 3),
    'poster_party': (poster_party, 2, 2),
    'poster_cabaret': (poster_cabaret, 2, 3),
    'poster_midway': (poster_midway, 2, 3),
    'poster_rules': (poster_rules, 2, 2),
    'poster_missing': (poster_missing, 1, 2),
    'sign_cabaret': (sign_cabaret, 3, 1),
    'sign_out_of_order': (sign_out_of_order, 2, 1),
    'sign_midway': (sign_midway, 4, 1),
    'sign_revue': (sign_revue, 6, 2),
}
VARIANTS = {
    'drawing': (drawing, 6),
    'sign_staff': (sign_staff, 4),
}


def build(save=True):
    """Returns {block_name: [canvas per variant or one canvas], ...} and saves tiles."""
    out = {}
    for name, (fn, cols, rows) in PANELS.items():
        c = fn().finish()
        out[name] = (c, cols, rows)
        if save:
            for i, t in enumerate(c.tiles(cols, rows)):
                t.save(f'{name}_{i}')
    for name, (fn, n) in VARIANTS.items():
        cs = [fn(i).finish() for i in range(n)]
        out[name] = (cs, 1, 1)
        if save:
            for i, c in enumerate(cs):
                c.tiles(1, 1)[0].save(f'{name}_{i}')
    return out


def preview(out, path, scale=6):
    from PIL import Image
    ims = []
    for name, (c, cols, rows) in out.items():
        cs = c if isinstance(c, list) else [c]
        for cc in cs:
            im = Image.fromarray(cc.color(), 'RGBA')
            ims.append(im.resize((im.width * scale, im.height * scale), Image.NEAREST))
    W = 1800
    x = y = 0
    rowh = 0
    pos = []
    for im in ims:
        if x + im.width > W:
            x = 0
            y += rowh + 10
            rowh = 0
        pos.append((x, y))
        x += im.width + 10
        rowh = max(rowh, im.height)
    sheet = Image.new('RGBA', (W, y + rowh), (58, 62, 70, 255))
    for im, p in zip(ims, pos):
        sheet.alpha_composite(im, p)
    sheet.save(path)


if __name__ == '__main__':
    import sys
    o = build()
    if len(sys.argv) > 1:
        preview(o, sys.argv[1])
    print('panels:', ', '.join(o))
