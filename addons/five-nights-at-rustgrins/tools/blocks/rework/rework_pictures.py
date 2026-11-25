"""The rework's picture panels (the shared 1 px wall panel, geometry.fnar.wall_panel, one texture per tile, state
fnar:tile; never more than 16 tiles in a block): the lobby's mural of the whole cast, the staff notice board,
the HAPPY BIRTHDAY banner and a set of small door and counter signs. The cast's sprites are the ones the posters
use (tools/blocks/surfaces/sprites.py)."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import propkit as K
from propkit import prop, block_json, mi_set, bs
from rework_pal import *  # noqa: F403

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'surfaces'))
import sprites as S  # noqa: E402

FONT = {**FONT_3x5, **FONT_EXTRA}  # noqa: F405
SKY = Mat('rw_mural_sky', ['#2c4a52', '#38606a', '#467782', '#578e99', '#6ba4ad', '#82b8bf'], rough=225, h=136, hk=2)
RAY = Mat('rw_mural_ray', ['#8a7436', '#a88f44', '#c2a954', '#d6c06a', '#e4d388'], rough=225, h=136, hk=2)
CORK = Mat('rw_cork', ['#4a321c', '#5e4124', '#72512e', '#866239', '#987346'], rough=245, h=134, hk=5)


def painted(w, h, painter):
    """A w x h sheet painted with a propkit painter -> (col, mer, hgt) arrays."""
    col, mer, hgt = face_sheet('pic', painter, w, h).images()
    return np.array(col), np.array(mer), np.array(hgt)


def paste(arr, name, x0, y0, overlays=(), fade=0.0):
    """Paste one of the cast's sprites (tools/blocks/surfaces/sprites.py) into the colour / MER / height arrays."""
    col, mer, hgt = arr
    s = S.sprite(name, overlays) if overlays else S.sprite(name)
    H, W = s['mask'].shape
    for y in range(H):
        for x in range(W):
            if not s['mask'][y, x] or not (0 <= y0 + y < col.shape[0] and 0 <= x0 + x < col.shape[1]):
                continue
            c = s['rgb'][y, x] * (1 - fade) + np.array([150, 140, 120]) * fade
            col[y0 + y, x0 + x] = [*np.clip(c, 0, 255).astype(np.uint8), 255]
            mer[y0 + y, x0 + x] = [0, 0, 222]
            hgt[y0 + y, x0 + x] = 142


def save_tiles(out, name, arr, cols, rows):
    """Cut the arrays into 16 px tiles <name>_<tile> (row-major from the top left), each a texture set."""
    col, mer, hgt = arr
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


@prop
def mural_revue(out):
    """The lobby's mural, 8 x 2 tiles, painted straight on the plaster in 1984: the whole cast in a row under a
    sunburst and a red ribbon, WELCOME TO THE SHOW. Faded; the paint has flaked off in places."""
    W, H = 128, 32

    def paint(r):
        r.fill(SKY, 3, amp=0.5, white_amp=0.3, cell=6)
        for y in range(H):
            for x in range(W):
                dx, dy = x + 0.5 - W / 2, H + 6 - y
                a = np.arctan2(dy, dx)
                if int((a + 10) * 9) % 2 == 0 and y > 7:
                    r.px(x, y, RAY, 1 + (2 if dy < 22 else 1) + (x * 7 + y * 3) % 2)
        r.rect(0, 0, W, 7, RED_P, 3)
        r.hline(0, 0, W, GOLD, 4); r.hline(0, 6, W, GOLD, 3); r.hline(0, 7, W, RED_P, 1)
        t = 'WELCOME TO THE SHOW'
        r.text(t, (W - r.text_width(t, FONT)) // 2, 1, CREAM, 6, font=FONT)
        for k in range(26):                                             # confetti
            x, y = (k * 37 + 5) % W, 9 + (k * 11) % 8
            r.px(x, y, (RED_P, YEL_P, CREAM, PURP_P)[k % 4], 5)
        r.hline(0, H - 1, W, SKY, 0); r.hline(0, H - 2, W, SKY, 1)

    arr = painted(W, H, paint)
    for name, x, y, ov in (('mirehop_bust', 4, 8, ()), ('noxbriar_bust', 22, 9, ()), ('rustgrin_wave', 40, 9, ()), ('top_hat_rat_bust', 66, 9, ()),
                           ('cat_pose', 86, 8, ()), ('purple_rat_bust', 110, 12, ())):
        paste(arr, name, x, y, ov, fade=0.12)
    col, mer, hgt = arr
    rng = np.random.default_rng(1984)
    for _ in range(46):                                                 # flaked paint: the plaster shows
        x, y = rng.integers(0, W), rng.integers(8, H)
        for dx, dy in ((0, 0), (1, 0), (0, 1))[:rng.integers(1, 4)]:
            if x + dx < W and y + dy < H:
                col[y + dy, x + dx] = [176, 166, 140, 255]
                hgt[y + dy, x + dx] = 128
    save_tiles(out, 'mural_revue', arr, 8, 2)
    panel_block(out, 'mural_revue', 16, '#578e99')


@prop
def notice_board(out):
    """The staff notice board, 2 x 1 tiles: cork in an oak frame; the rota, a yellow note, the auction flyer, a
    snapshot of the band, red pins."""
    W, H = 32, 16

    def paint(r):
        r.fill(CORK, 2, amp=0.9, white_amp=0.6, cell=2)
        r.frame_rect(0, 0, W, H, OAK, 2); r.frame_rect(1, 1, W - 2, H - 2, OAK, 4)
        r.rect(3, 3, 9, 10, PAPER, 5)
        for y in range(5, 12, 2):
            r.hline(4, y, 7, GRIME, 2)
            r.px(4 + (y * 3) % 6, y, RED_P, 3)
        r.rect(14, 3, 5, 5, YEL_P, 5); r.hline(15, 5, 3, GRIME, 1)
        r.rect(14, 9, 7, 5, PAPER, 3); r.rect(15, 10, 5, 3, GRIME, 1); r.px(16, 11, RED, 5); r.px(18, 11, GREEN_P, 5)
        r.rect(22, 3, 7, 10, PINK, 3); r.hline(23, 4, 5, RED_P, 2)
        for y in range(6, 12, 2):
            r.hline(23, y, 5, GRIME, 0)
        for (x, y) in ((7, 3), (16, 3), (17, 9), (25, 3)):
            r.px(x, y, RED_P, 5)
        r.px(27, 12, PAPER, 5); r.px(28, 12, PAPER, 4)                   # a corner curling up

    save_tiles(out, 'notice_board', painted(W, H, paint), 2, 1)
    panel_block(out, 'notice_board', 2, '#72512e')


@prop
def banner_birthday(out):
    """HAPPY BIRTHDAY, 6 x 1 tiles: a letter on every paper pennant along a string. One pennant hangs by a corner."""
    W, H = 96, 16
    text = 'HAPPY BIRTHDAY'
    cols = (RED_P, BLUE_P, YEL_P, GREEN_P, PURP_P)

    def paint(r):
        r.clear()
        for x in range(W):
            r.px(x, 2 + (1 if (x // 12) % 2 == 0 and 3 < x % 12 < 9 else 0), GRIME, 4)
        x = 3
        for k, ch in enumerate(text):
            if ch == ' ':
                x += 5
                continue
            m = cols[k % 5]
            drop = 2 if k == 9 else 0
            for yy in range(9):
                w = 6 if yy < 6 else 6 - 2 * (yy - 5)
                for xx in range((6 - w) // 2, (6 - w) // 2 + w):
                    r.px(x + xx, 3 + drop + yy, m, 4 - (xx == 5) + (xx == 0))
            g = FONT[ch]
            for yy, row in enumerate(g):
                for xx, c in enumerate(row):
                    if c == '#':
                        r.px(x + 1 + xx + (1 if len(row) < 3 else 0), 4 + drop + yy, CREAM, 6)
            x += 7

    save_tiles(out, 'banner_birthday', painted(W, H, paint), 6, 1)
    panel_block(out, 'banner_birthday', 6, '#8f1f1c')


SIGNS = [('WAIT', 'HERE', OAK, CREAM), ('COLD', 'ROOM', BLUE_P, CREAM), ('PICK', 'UP', RED_P, CREAM), ('CASH', 'ONLY', CREAM, RED_P),
         ('SOCK', 'ONLY', YEL_P, BLUE_P), ('WASH', 'HAND', CREAM, TEAL_P), ('COAT', 'RACK', OAK, GOLD), ('NO', 'EXIT', RED_P, CREAM)]


@prop
def sign_small(out):
    """Small painted signs, one tile each (fnar:tile 0-7): WAIT HERE, COLD ROOM, PICK UP, CASH ONLY, SOCKS ONLY,
    WASH HANDS, COAT RACK, NO EXIT."""
    def paint(r):
        for k, (a, b, bg, fg) in enumerate(SIGNS):
            s = r.sub(k * 16, 0, 16, 16)
            s.clear()
            s.rect(0, 2, 16, 13, bg, 2 if bg is not CREAM else 5)
            s.frame_rect(0, 2, 16, 13, bg, 0 if bg is not CREAM else 2)
            for line, y in ((a, 3), (b, 9)):
                s.text(line, (16 - s.text_width(line, FONT)) // 2, y, fg, 6 if fg in (CREAM, GOLD) else 3, font=FONT)
            s.px(1, 3, STEEL, 5); s.px(14, 3, STEEL, 5)                    # screws
            s.darken_noise(0.2, -1, bottom=0.6)

    save_tiles(out, 'sign_small', painted(16 * len(SIGNS), 16, paint), len(SIGNS), 1)
    panel_block(out, 'sign_small', len(SIGNS), '#857958')
