"""Hand-placed pixel-art sprites of the animatronics for posters and signs.

Proportions, colour layout and features are traced by eye from the portrait
renders in assets/portraits/ (rustgrin_perform, mirehop_perform, noxbriar_idle_front,
cat_pose, top_hat_rat_idle_front, purple_rat_perform, *_head); palettes are the
render colours re-paletted to 3-4 shades per material (light from the top-left).
Each sprite is an ASCII grid; '.' is transparent. `sprite(name)` -> (rgb, mask).
"""
import numpy as np

from pixlib import hexc

COMMON = {
    'o': '#161316',  # outline
    'E': '#0e0b0d',  # eye socket
    'R': '#ff3a22',  # glowing eye
    'r': '#a51d16',  # eye glow rim
    'N': '#151214',  # nose
    'T': '#e2dacb',  # teeth
    't': '#3a2a2a',  # mouth gap
    'M': '#c4c8cc',  # microphone head
    'm': '#6d7176',  # mic shade
    'K': '#26272b',  # mic handle / cane
    'Y': '#c9a13c',  # gold
    'y': '#8a6b25',  # gold shade
}

PAL = {
    'rustgrin': {'D': '#3c3936', 'F': '#58544f', 'L': '#77726a', 'I': '#a89c88', 'W': '#cbc2b0', 'w': '#9c9382',
                 'H': '#a3232a', 'h': '#6b151a', 'B': '#2a1a1c', 'V': '#8c1c21', 'v': '#5a1216', 'S': '#cfc6b3',
                 's': '#a1988a'},
    'mirehop': {'D': '#2e3d1c', 'F': '#465e27', 'L': '#617d35', 'c': '#26331a', 'I': '#a99b70', 'W': '#b4a679',
                'w': '#877b58', 'V': '#9a2125', 'v': '#62151a', 'S': '#b4a679', 's': '#877b58', 'G': '#3b2a1c'},
    'noxbriar': {'D': '#141316', 'F': '#232126', 'L': '#36323a', 'I': '#4a4448', 'W': '#4c464b', 'w': '#363136',
                 'H': '#18171a', 'h': '#0f0e10', 'B': '#55535b', 'P': '#6e4892', 'p': '#4a2c66', 'S': '#8c7a60',
                 's': '#66583f'},
    'cat': {'D': '#30202a', 'F': '#45303a', 'L': '#5c414b', 'I': '#c47c7e', 'W': '#cfb2a4', 'w': '#a2867a',
            'x': '#d9cfc5', 'V': '#6c2e2c', 'v': '#4a1e1d', 'S': '#d0a090', 's': '#a77a6c', 'b': '#2a1a1e',
            'P': '#f0e6da'},
    'top_hat_rat': {'D': '#29232b', 'F': '#3b333d', 'L': '#51474f', 'I': '#cf868c', 'i': '#9c5a61', 'W': '#c0b6b5',
                    'w': '#8f8586', 'x': '#d8d2cc', 'H': '#9b1f24', 'h': '#651418', 'V': '#8c1b20', 'v': '#5b1115',
                    'S': '#e4dfd8', 's': '#b0aaa3', 'b': '#1a1618'},
    'purple_rat': {'D': '#4a3046', 'F': '#63435d', 'L': '#7f5d78', 'I': '#ab90aa', 'i': '#8a6f88', 'W': '#cbb8ca',
                   'w': '#9e8a9d', 'x': '#e4dae2', 'V': '#b0282a', 'v': '#741a1c', 'S': '#cbb8ca', 's': '#9e8a9d',
                   'Q': '#c8352a', 'q': '#82201a'},
    'guard': {'G': '#6b6a66', 'g': '#55544f', 'C': '#4a4945', 'c': '#3c3b38', 'B': '#7d7c77'},
}

SPRITES = {}

# ---------------------------------------------------------------- Rustgrin (grey bear, red mini top hat)
SPRITES['rustgrin_head'] = ('rustgrin', [
    "......oooo......",
    ".....oHHHHo.....",
    ".....oHHHHo.....",
    ".....oBBBBo.....",
    ".oo.ohhhhhho.oo.",
    "oDFooooooooooFDo",
    "oFIoFLLLLLLFoIFo",
    "oDFoLLLLLLLLoFDo",
    ".ooFLLFFFFLLFoo.",
    "..oFEEEFFEEEFo..",
    "..oFErEFFErEFo..",
    "..oFERELLEREFo..",
    "..oDEEWWWWEEDo..",
    "..oDWWWNNWWWDo..",
    "..oDwWWWWWWwDo..",
    "...oDTtTtTtDo...",
    "....oooooooo....",
])

# bust with the hand mic held up at the left of his mouth (perform pose)
_RG_BODY = [
    "...oooooooooooo...",
    "..oFFoVVvvVVoFFo..",
    ".oFLFoVVSSVVoFLFo.",
    "oFLFoVVVSSVVVoFLFo",
    "oFFFoVVVSsVVVoFFFo",
    "oDFFoVvVSSVvVoFFDo",
    "oDFDoVVVsSVVVoDFDo",
]
SPRITES['rustgrin_bust'] = ('rustgrin', ['.' + r + '.' for r in SPRITES['rustgrin_head'][1][:-1]] + _RG_BODY)
# overlay: forearm raised, paw gripping the mic in front of the mouth
OVERLAYS = {}
OVERLAYS['rustgrin_mic'] = ('rustgrin', 1, 12, [
    "...ooo.",
    "..oMMmo",
    "..oMmmo",
    "...oKo.",
    ".ooLKLo",
    "oLFFFFo",
    "oFFFFo.",
    "oFLFo..",
    "oFFo...",
    "oFFo...",
])
# waving: the hanging right arm is replaced by an arm raised beside the head
SPRITES['rustgrin_wave'] = ('rustgrin', ['.' + r + '.....' for r in SPRITES['rustgrin_head'][1][:-1]] + [
    "...oooooooooooo.......",
    "..oFFoVVvvVVoFFo......",
    ".oFLFoVVSSVVoFFFo.....",
    "oFLFoVVVSSVVVoFFo.....",
    "oFFFoVVVSsVVVoFo......",
    "oDFFoVvVSSVvVVo.......",
    "oDFDoVVVsSVVVVo.......",
])
OVERLAYS['rustgrin_wave'] = ('rustgrin', 14, 3, [
    "...o.o.o",
    "..oLoLoL",
    ".oLLLLLo",
    ".oFLLLFo",
    "..oFLFo.",
    "...oFFo.",
    "...oFFo.",
    "...oFLo.",
    "...oFFo.",
    "...oFFo.",
    "..oFFFo.",
    ".oFFFo..",
    "oFFFo...",
    "oFFo....",
    "oFo.....",
])

# ---------------------------------------------------------------- Mirehop (green camo rabbit)
SPRITES['mirehop_head'] = ('mirehop', [
    "..ooo....ooo..",
    ".oLFFo..oFFDo.",
    ".oFIFo..oFIDo.",
    ".oFIFo..oFIDo.",
    ".oLIFo..oFIDo.",
    ".oFIFo..oFIDo.",
    "..oFFooooFDo..",
    ".oLFcFLLFcFFo.",
    "oLFFFLLLLFFcDo",
    "oFEEEFLLFEEEDo",
    "oFErEFFFFErEDo",
    "oFEREFFFFEREDo",
    "oFcEEWWWWEEcDo",
    "oDFWWWNNWWWFDo",
    ".oDwWWWWWWwDo.",
    ".oDDTtTtTtDDo.",
    "..oooooooooo..",
])

# ---------------------------------------------------------------- Noxbriar (black bear, black top hat)
SPRITES['noxbriar_head'] = ('noxbriar', [
    "....oooooo....",
    "....oHHHHo....",
    "....oHHHHo....",
    "....oHHHHo....",
    "....oBBBBo....",
    ".oo.ohhhho.oo.",
    "oFDoooooooooDFo"[:14],
    "oIFoFLLLLFoFIo",
    "oFDoLLLLLLoDFo",
    ".ooFLFFFFLFoo.",
    "..oEEEFFEEEo..",
    "..oErEFFErEo..",
    "..oEREFFEREo..",
    "..oEEWWWWEEo..",
    "..oWWWNNWWWo..",
    "..oTtTtTtTto..",
    "...oooooooo...",
])

SPRITES['mirehop_bust'] = ('mirehop', SPRITES['mirehop_head'][1][:-1] + [
    ".ooFFoooooFFo.",
    "oLFFoWWWWoFFDo",
    "oFFoWWWWWWoKKo",
    "oFFoWWWWWKKoDo",
    "ooVVoWWWKKWoDo",
    "oVVVVoWKKWWoFo",
    "VVvVVVKKWWWoFo",
    "VVVvVVVoWWWoFo",
])

SPRITES['noxbriar_bust'] = ('noxbriar', SPRITES['noxbriar_head'][1][:-1] + [
    "..ooooPPoooo..",
    ".oFFoPPpPPoFo.",
    "oFLFoSpooSoFFo",
    "oFLoSSSSSSoFFo",
    "oFFoSSsSSSoFDo",
    "oDFoSSSSSsoFDo",
    "oDFoSSSSSSoDDo",
])

# smaller busts for the band members flanking Rustgrin on the revue poster
SPRITES['mirehop_small'] = ('mirehop', [
    ".oo.....oo.",
    "oLFo...oFDo",
    "oFIo...oIDo",
    "oFIo...oIDo",
    "oLIoooooIDo",
    ".oFLLcLLFo.",
    "oLFcLLLFFDo",
    "oFEEFLFEEDo",
    "oFERFFFREDo",
    "ocEEWWWEEDo",
    "oDWWWNWWWDo",
    ".oDTtTtTDo.",
    "..ooooooo..",
    ".oFFoWoFDo.",
    "oLFoWWWoKDo",
    "oFFoWWKKFDo",
    "oVVVoKKWWDo",
    "VVvVKKWWWoo",
])
SPRITES['noxbriar_small'] = ('noxbriar', [
    "...ooooo...",
    "...oHHHo...",
    "...oHHHo...",
    "...oBBBo...",
    ".o.ohhho.o.",
    "oIoooooooIo",
    "oFoLLLLLoFo",
    ".oLLFFFLLo.",
    "oFEEFFFEEFo",
    "oFERFFFREFo",
    "oFEEWWWEEFo",
    "oDWWWNWWWDo",
    ".oTtTtTtTo.",
    "..ooPPPoo..",
    ".oFoPpPoFo.",
    "oFFoSSSoFFo",
    "oFFoSsSoFFo",
    "oDFoSSSoFDo",
])

# ---------------------------------------------------------------- the Cat (maroon dancer)
SPRITES['cat_head'] = ('cat', [
    "..oo........oo..",
    "..oIo......oIo..",
    "..oIFo....oFIo..",
    "..oFFFooooFFFo..",
    ".oFFLLLLLLLLFFo.",
    ".oFLWWWLLWWWLFo.",
    ".oFWEEEWWEEEWFo.",
    ".oFWErEWWErEWFo.",
    ".oFWEREWWEREWFo.",
    ".oFWWEWWWWEWWFo.",
    "xxoWWWWNNWWWWoxx",
    ".oDwWWtWWtWWwDo.",
    "xxoDwWWttWWwDoxx",
    "..ooDwwwwwwDoo..",
    "....oooooooo....",
])
# posing: both paws up beside the face ("jazz hands"), vest with buttons
# posing: one paw raised high beside the ear, hip cocked (dancer pose), vest with buttons
SPRITES['cat_pose'] = ('cat', ['.' + r + '.....' for r in SPRITES['cat_head'][1][:-1]] + [
    ".....oooooooo.........",
    "....oVVVPPVVVoo.......",
    "...oVVVVPPVVVVFo......",
    "..oFVVVPbPPVVVFFo.....",
    "..oFVVVPPPPVVVoFo.....",
    "..oFVvVPbPPVvVoo......",
    "..oDVVVPPPPVVVo.......",
    "..oDVVVPbPPVVVo.......",
    "...oVvVPPPPVvVo.......",
    "...oooooooooooo.......",
])
OVERLAYS['cat_paws'] = ('cat', 14, 0, [
    "....o.o.",
    "...oLoLo",
    "..oLLLLo",
    "..oWWWLo",
    "..oLWLo.",
    "...oFFo.",
    "...oFFo.",
    "...oFLo.",
    "...oFFo.",
    "...oFFo.",
    "...oFFo.",
    "...oFFo.",
    "...oFFo.",
    "..oFFo..",
    ".oFLFo..",
    "oFLFo...",
    "oFFo,...",
])

# ---------------------------------------------------------------- Top-Hat Rat (the Ringmaster)
SPRITES['top_hat_rat_head'] = ('top_hat_rat', [
    "......oooooo......",
    ".ooo..oHHHHo..ooo.",
    "oiIIo.oHHHHo.oIIio",
    "oIIIIooYYYYooIIIIo",
    "oIIIoohhhhhhooIIIo",
    "oiIoFFFFFFFFFFoIio",
    ".ooFFLLLLLLLLFFoo.",
    "..oFLWWWLLWWWLFo..",
    "..oFWEEEWWEEEWFo..",
    "..oFWErEWWErEWFo..",
    "..oFWEREWWEREWFo..",
    "..oFWWWWNNWWWWFo..",
    "bboDwWWWWWWWWwDobb",
    "..oDDwWWTTWWwDDo..",
    "bboDDwwSTTSwwDDobb",
    "....oooooooooo....",
])
SPRITES['top_hat_rat_bust'] = ('top_hat_rat', SPRITES['top_hat_rat_head'][1][:-1] + [
    "...ooooVVVVoooo...",
    "..oVVVoVvvVoVVVo..",
    ".oVVVYoSSSSoYVVVo.",
    ".oVVYoSSbSSSoYVVo.",
    "oFVVYoSSSSSSoYVVFo",
    "oFVVYoSSbSSSoYVVFo",
    "oDVvYoSSSSSSoYvVDo",
    "oDVVYoSSbSSSoYVVDo",
])
OVERLAYS['cane'] = ('top_hat_rat', 0, 14, [
    "..ooo.",
    ".oYYYo",
    ".oYyYo",
    "..oKo.",
    ".oFKFo",
    "oFLKLo",
    "oFFKFo",
    ".ooKo.",
    "..oKo.",
])

# ---------------------------------------------------------------- Purple Rat (maracas)
SPRITES['purple_rat_head'] = ('purple_rat', [
    ".oooo......oooo.",
    "oFIIFo....oFIIFo",
    "oIiiIo....oIiiIo",
    "oIiiIFooooFIiiIo",
    "oFIIFLLLLLLFIIFo",
    ".ooFLLLLLLLLFoo.",
    "..oFWEEWWEEWFo..",
    "..oFEErWWrEEFo..",
    "..oFEREWWEREFo..",
    "..oFWWWNNWWWFo..",
    ".xoDWWWWWWWWDox.",
    "..oDwWWTTWWwDo..",
    ".xoDDwwTTwwDDox.",
    "...oooooooooo...",
])
SPRITES['purple_rat_bust'] = ('purple_rat', SPRITES['purple_rat_head'][1][:-1] + [
    "...oooVVVVooo...",
    "..oFFoVvvVoFFo..",
    ".oFLFoWWWWoFLFo.",
    "oFLFoWWWWWWoFLFo",
    "oFFFoWWWWWWoFFFo",
    "oDFFoWWwWWWoFFDo",
    "oDFDoWWWWWWoDFDo",
])
OVERLAYS['maracas'] = ('purple_rat', 0, 9, [
    ".oo..........oo.",
    "oQQo........oQQo",
    "oQqo........oqQo",
    ".oKo........oKo.",
    "oLKLo......oLKLo",
    "oFFFo......oFFFo",
    ".oFFo......oFFo.",
])

# ---------------------------------------------------------------- small Rustgrin head (rules poster)
SPRITES['rustgrin_small'] = ('rustgrin', [
    "....oooo....",
    "....oHHo....",
    "..o.oBBo.o..",
    ".oIooooooIo.",
    ".oFoLLLLoFo.",
    "..oLLLLLLo..",
    "..oERLLREo..",
    "..oLWNNWLo..",
    "..oDTtTtDo..",
    "...oooooo...",
])

SPRITES['guard'] = ('guard', [
    "....oooooo....",
    "...oCCCCCCo...",
    "..oCCCBBCCCo..",
    "..occccccccoo.",
    "...oGGGGGGo...",
    "...oGGGGGGo...",
    "...oGGGGGGo...",
    "...ogGGGGgo...",
    "....oggggo....",
    "..ooogggoooo..",
    ".oCCCCggCCCCo.",
    "oCCCCCCCCCCCCo",
    "oCCCCCCCCCCCCo",
])


def sprite(name, overlays=()):
    if overlays:
        base = sprite(name)
        for ov in overlays:
            char, x0, y0, rows = OVERLAYS[ov]
            o = sprite_rows(char, [r.replace(',', '.') for r in rows], ov)
            H, W = base['mask'].shape
            for y, row in enumerate(rows):
                for x, ch in enumerate(row):
                    if not (0 <= y0 + y < H and 0 <= x0 + x < W) or ch == '.':
                        continue
                    if ch == ',':  # erase
                        base['mask'][y0 + y, x0 + x] = False
                        continue
                    base['rgb'][y0 + y, x0 + x] = o['rgb'][y, x]
                    base['mask'][y0 + y, x0 + x] = True
        return base
    char, rows = SPRITES[name]
    return sprite_rows(char, rows, name)


def sprite_rows(char, rows, name='?'):
    pal = dict(COMMON)
    pal.update(PAL[char])
    h = len(rows)
    w = max(len(r) for r in rows)
    rgb = np.zeros((h, w, 3))
    mask = np.zeros((h, w), bool)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == '.' or ch == ' ':
                continue
            if ch not in pal:
                raise KeyError(f'{name}: unknown key {ch!r} at {x},{y}')
            rgb[y, x] = hexc(pal[ch])
            mask[y, x] = True
    return {'rgb': rgb, 'mask': mask}


def emissive_keys(name):
    """Mask of the glowing-eye pixels (for MER emissive)."""
    char, rows = SPRITES[name]
    h = len(rows)
    w = max(len(r) for r in rows)
    m = np.zeros((h, w), bool)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            m[y, x] = ch in ('R',)
    return m


if __name__ == '__main__':
    import sys
    from PIL import Image
    names = sys.argv[2:] or list(SPRITES) + ['rustgrin_bust+rustgrin_mic', 'rustgrin_wave+rustgrin_wave', 'cat_pose+cat_paws', 'top_hat_rat_bust+cane', 'purple_rat_bust+maracas']
    tiles = []
    for n in names:
        parts = n.split('+')
        s = sprite(parts[0], parts[1:])
        h, w = s['mask'].shape
        can = np.zeros((h + 2, w + 2, 3))
        can[:] = (92, 96, 110)
        can[1:-1, 1:-1][s['mask']] = s['rgb'][s['mask']]
        tiles.append(Image.fromarray(can.astype(np.uint8)).resize(((w + 2) * 10, (h + 2) * 10), Image.NEAREST))
    W = sum(t.width + 10 for t in tiles)
    H = max(t.height for t in tiles)
    sheet = Image.new('RGB', (W, H), (30, 30, 30))
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0))
        x += t.width + 10
    sheet.save(sys.argv[1])
