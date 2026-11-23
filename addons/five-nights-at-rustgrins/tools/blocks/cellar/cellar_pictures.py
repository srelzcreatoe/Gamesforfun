"""The cellar's picture panels (the shared 1 px wall panel, geometry.fnar.wall_panel, one texture per tile, state
fnar:tile; never more than 16 tiles in a block): the supper club's sign over its stage, the Golden Dog's show
poster, and a child's drawing of a big yellow dog."""
import numpy as np
from PIL import Image

import propkit as K
from propkit import prop, block_json, mi_set, bs, FONT_3x5
from pal import GRIME  # noqa: F401
from cellar_pal import *  # noqa: F403

FONT = {**FONT_3x5, **FONT_EXTRA}  # noqa: F405


def save_tiles(out, name, sheet, cols, rows):
    """Cut a painted sheet into 16 px tiles <name>_<tile> (row-major from the top left), each a texture set."""
    col, mer, hgt = sheet.images()
    K.TEX_DIR.mkdir(parents=True, exist_ok=True)
    for t in range(cols * rows):
        ys, xs = slice((t // cols) * 16, (t // cols) * 16 + 16), slice((t % cols) * 16, (t % cols) * 16 + 16)
        tex = f'{name}_{t}'
        Image.fromarray(np.ascontiguousarray(col[ys, xs]), 'RGBA').save(K.TEX_DIR / f'{tex}.png')
        Image.fromarray(np.ascontiguousarray(mer[ys, xs]), 'RGB').save(K.TEX_DIR / f'{tex}_mer.png')
        Image.fromarray(np.ascontiguousarray(hgt[ys, xs]), 'L').save(K.TEX_DIR / f'{tex}_height.png')
        K.write_json(K.TEX_DIR / f'{tex}.texture_set.json', {
            'format_version': '1.21.30',
            'minecraft:texture_set': {'color': tex, 'metalness_emissive_roughness': f'{tex}_mer', 'heightmap': f'{tex}_height'}})
        out.terrain[f'fnar_{tex}'] = {'textures': f'textures/blocks/fnar/{tex}'}


def panel_block(out, name, tiles, map_color):
    assert tiles <= 16, 'a block state holds at most 16 values'
    perms = [(bs('fnar:tile', j), {'minecraft:material_instances': mi_set(f'{name}_{j}')}) for j in range(tiles)]
    out.block(name, block_json(name, geometry='geometry.fnar.wall_panel', materials=mi_set(f'{name}_0'), states={'fnar:tile': list(range(tiles))},
                               collision=False, selection={'origin': [-8, 0, 7], 'size': [16, 16, 1]}, map_color=map_color, destroy=1.0, perms=perms))


# ---------------------------------------------------------------- the Golden Dog, as a sprite
# K hat, M hat band, B buckle, E ear, F fur, f fur in shadow, S eye socket, P pupil, T muzzle, N nose, W teeth,
# k bow tie, R coat, G gold piping, t belly
DOG = [
    '........KKKKKK........',
    '........KKKKKK........',
    '........KKKKKK........',
    '........MMBBMM........',
    '......KKKKKKKKKK......',
    '.....EFFFFFFFFFFE.....',
    '...EEEFFFFFFFFFFEEE...',
    '..EEEEFSSSFFSSSFEEEE..',
    '..EEEEFSPSFFSPSFEEEE..',
    '..EEEEFSSSFFSSSFEEEE..',
    '..EEEEFFFTTTTFFFEEEE..',
    '..EEEEFFTTNNTTFFEEEE..',
    '...EEEFTTTTTTTTFEEE...',
    '...EEEfWWWWWWWWfEEE...',
    '....EEffTTTTTTffEE....',
    '.....E.ffffffff.E.....',
    '........kkkkkk........',
    '......RRGkkkkGRR......',
    '.....RRRGttttGRRR.....',
    '.....RRRGttttGRRR.....',
]


def dog(r, x0, y0, faded=0):
    legend = {'K': (INK, 2), 'M': (COATRED, 3), 'B': (DULLGOLD, 4), 'E': (EAR, 2), 'F': (FUR, 3), 'f': (FUR, 1), 'S': (INK, 0), 'P': (PUPIL, 0),
              'T': (MUZZLE, 3), 'N': (INK, 1), 'W': (TOOTH, 3), 'k': (INK, 1), 'R': (COATRED, 2), 'G': (DULLGOLD, 3), 't': (MUZZLE, 2)}
    for yy, row in enumerate(DOG):
        for xx, ch in enumerate(row):
            if ch == '.':
                continue
            m, i = legend[ch]
            if ch in 'FEfT' and (xx * 7 + yy * 5) % 6 == 0:
                i += 1  # mottled fur
            if ch == 'E' and xx in (2, 19):
                i -= 1
            if ch == 'W' and xx % 2:
                i -= 2  # the gaps between the square teeth
            r.px(x0 + xx, y0 + yy, m, max(0, i - faded))


# ---------------------------------------------------------------- the supper club's sign
BIG = {  # 6 x 9 letters for the sign
    'G': ['.####.', '##..##', '##....', '##....', '##.###', '##..##', '##..##', '##..##', '.####.'],
    'O': ['.####.', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
    'L': ['##....', '##....', '##....', '##....', '##....', '##....', '##....', '##....', '######'],
    'D': ['#####.', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '#####.'],
    'E': ['######', '##....', '##....', '##....', '#####.', '##....', '##....', '##....', '######'],
    'N': ['##..##', '###.##', '###.##', '######', '######', '##.###', '##.###', '##..##', '##..##'],
}


@prop
def sign_golden_dog(out):
    """THE GOLDEN DOG / SUPPER CLUB: the club's sign, 7 x 2 tiles, gold leaf on a black board in a frame of dead
    bulbs. It hangs over the stage, behind where he stands."""
    W, H = 112, 32

    def paint(r):
        r.fill(INK, 2, amp=0.6, white_amp=0.5, cell=5)
        r.frame_rect(0, 0, W, H, DULLGOLD, 1)
        r.frame_rect(1, 1, W - 2, H - 2, DULLGOLD, 3)
        r.frame_rect(2, 2, W - 4, H - 4, DULLGOLD, 1)
        for x in range(5, W - 4, 6):  # the bulbs round the frame: dead, a few sockets empty
            for y in (4, H - 5):
                dead = (x * 7 + y) % 5 == 0
                r.px(x, y, INK if dead else BULBDEAD, 0 if dead else 3)
                r.px(x, y + (1 if y < 16 else -1), OLDBRASS, 1)
        for y in range(9, H - 8, 6):
            for x in (4, W - 5):
                r.px(x, y, BULBDEAD, 3)
        # his head at the left end, a paw print at the right
        dog(r, 6, 6, faded=1)
        for (x, y) in ((99, 9), (101, 8), (103, 8), (105, 9), (100, 12), (101, 11), (102, 11), (103, 11), (104, 12), (101, 13), (102, 13), (103, 13),
                       (100, 13), (104, 13), (101, 14), (102, 14), (103, 14)):
            r.px(x, y, DULLGOLD, 3)
        # THE / GOLDEN DOG / SUPPER CLUB
        x = 30 + (66 - r.text_width('THE', FONT)) // 2
        r.text('THE', x, 5, DULLGOLD, 3, font=FONT)
        r.hline(34, 7, 22, DULLGOLD, 2); r.hline(74, 7, 20, DULLGOLD, 2)
        x = 31
        for word in ('GOLDEN', 'DOG'):
            for ch in word:
                for yy, row in enumerate(BIG[ch]):
                    for xx, c in enumerate(row):
                        if c == '#':
                            r.px(x + xx + 1, 11 + yy + 1, INK, 0)  # a drop shadow
                for yy, row in enumerate(BIG[ch]):
                    for xx, c in enumerate(row):
                        if c == '#':
                            r.px(x + xx, 11 + yy, DULLGOLD, 5 if yy < 2 else 4 if yy < 6 else 3, metal=150, rough=110)
                x += 7
            x += 4
        tw = r.text_width('SUPPER CLUB', FONT, spacing=2)
        r.text('SUPPER CLUB', 30 + (66 - tw) // 2, 23, DULLGOLD, 2, font=FONT, spacing=2)
        # fifty years: the leaf flaking off, a water stain down the right half, grime
        r.speck(INK, 2, 0.1, seed=3, only=DULLGOLD)
        r.stain(WATERSTAIN, 1, 80, 10, 9, 14, seed=4, p=0.3)
        r.drip(WATERSTAIN, 1, 84, 3, 20, seed=5)
        r.drip(WATERSTAIN, 0, 61, 2, 14, seed=6)
        r.darken_noise(0.3, -1, cell=6, bottom=0.4)

    save_tiles(out, 'sign_golden_dog', face_sheet('sign_golden_dog', paint, W, H), 7, 2)
    panel_block(out, 'sign_golden_dog', 14, '#33260c')


# ---------------------------------------------------------------- his show poster
@prop
def poster_golden_dog(out):
    """THE GOLDEN DOG, NIGHTLY: his old show poster, 2 x 3 tiles like the Revue's. It hangs in the Gold Room and
    in the Other Office; upstairs it takes the Revue poster's place for a moment (CELLAR.gild)."""
    W, H = 32, 48

    def paint(r):
        r.fill(OLDPAPER, 3, amp=0.6, white_amp=0.4, cell=5)
        r.rect(2, 2, W - 4, H - 4, COATRED, 2)
        for y in range(2, H - 2):
            for x in range(2, W - 2):
                if (x + y) % 7 == 0:
                    r.shift(x, y, 1)
        r.frame_rect(2, 2, W - 4, H - 4, DULLGOLD, 3)
        for (x, y) in ((4, 4), (W - 5, 4), (4, H - 5), (W - 5, H - 5)):
            r.px(x, y, DULLGOLD, 5)
        # a spotlight behind him
        for y in range(20, 45):
            for x in range(4, W - 4):
                if ((x - 15.5) / 12.0) ** 2 + ((y - 33) / 12.5) ** 2 < 1:
                    r.px(x, y, DULLGOLD, 1 + (1 if ((x - 15.5) / 8.0) ** 2 + ((y - 31) / 8.0) ** 2 < 1 else 0), metal=0, rough=220)
        dog(r, 5, 24)
        for word, y in (('THE', 4), ('GOLDEN', 10), ('DOG', 16)):
            r.text(word, (W - r.text_width(word, FONT)) // 2 + 1, y, DULLGOLD, 5, font=FONT)
        for x in (7, 8, 23, 24):  # a star either side of DOG
            r.px(x, 18, DULLGOLD, 4)
        r.px(7, 17, DULLGOLD, 3); r.px(24, 17, DULLGOLD, 3); r.px(8, 19, DULLGOLD, 3); r.px(23, 19, DULLGOLD, 3)
        r.frame_rect(2, 2, W - 4, H - 4, DULLGOLD, 3)
        # age: foxing, a fold across the middle, a corner torn away, a tack in each top corner
        r.hline(0, 24, W, OLDPAPER, 1)
        r.speck(WATERSTAIN, 2, 0.05, seed=2)
        r.stain(WATERSTAIN, 2, 26, 41, 5, 5, seed=3, p=0.45)
        for y in range(8):
            for x in range(W - 8 + y, W):
                r.px(x, H - 1 - y, None)
        r.px(1, 1, GRIME, 0); r.px(W - 2, 1, GRIME, 0)
        r.darken_noise(0.25, -1, cell=5, bottom=0.5)

    save_tiles(out, 'poster_golden_dog', face_sheet('poster_golden_dog', paint, W, H), 2, 3)
    panel_block(out, 'poster_golden_dog', 6, '#4a1014')


# ---------------------------------------------------------------- a child's drawing
@prop
def drawing_golden_dog(out):
    """A child's crayon drawing of a big yellow dog in a hat (fnar:tile 0: holding a small child's hand;
    1: only his face, the eyes scribbled black). Pinned among the other drawings; in the Other Office every
    drawing is one of these."""
    def paper(r):
        r.clear()
        r.rect(1, 1, 14, 14, OLDPAPER, 5)
        for (x, y) in ((1, 1), (14, 14), (1, 9)):
            r.px(x, y, OLDPAPER, 3)
        r.px(8, 1, GRIME, 1)  # the pin

    def with_child(r):
        paper(r)
        rows = ['....kk......', '....kk......', '...kkkk.....', '..eyyyye....', '..eyKyKe....', '..eyyyye....', '...ywwy.....',
                '...rrrr.....', '..yrrrry..p.', '..yrrrry.ppp', '...yyyy.Hp..', '...y..y..p..', '...y..y.p.p.']
        legend = {'k': (CRAYON_K, 1), 'e': (CRAYON_B, 1), 'y': (CRAYON_Y, 2), 'K': (CRAYON_K, 0), 'w': (OLDPAPER, 5), 'r': (CRAYON_R, 1),
                  'p': (CRAYON_B, 2), 'H': (CRAYON_Y, 1)}
        r.blit(rows, legend, 2, 2)
        r.px(8, 12, CRAYON_Y, 1)  # he is holding the child's hand
        for x in range(2, 14, 2):
            r.px(x, 14, CRAYON_B, 0)

    def face(r):
        paper(r)
        rows = ['....kkkk....', '....kkkk....', '...kkkkkk...', '.eyyyyyyyye.', '.eyKKyyKKye.', '.eyKKyyKKye.', '.eyyyyyyyye.', '.eyywwwwyye.',
                '..yyKwKwyy..', '...yyyyyy...', '....rrrr....']
        legend = {'k': (CRAYON_K, 1), 'e': (CRAYON_B, 1), 'y': (CRAYON_Y, 2), 'K': (CRAYON_K, 0), 'w': (OLDPAPER, 5), 'r': (CRAYON_R, 1)}
        r.blit(rows, legend, 2, 2)
        for (x, y) in ((5, 8), (7, 5), (10, 8), (12, 6), (6, 9), (11, 9)):  # pressed so hard the crayon scored the paper
            r.px(x, y, CRAYON_K, 0)

    def both(r):  # the two drawings side by side: tile 0, tile 1
        with_child(r.sub(0, 0, 16, 16))
        face(r.sub(16, 0, 16, 16))

    save_tiles(out, 'drawing_golden_dog', face_sheet('drawing_golden_dog', both, 32, 16), 2, 1)
    panel_block(out, 'drawing_golden_dog', 2, '#b6ae96')
