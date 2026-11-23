"""Material ramps (dark -> light) for the cellar: the Golden Dog Supper Club after fifty years in the damp.
Same rules as tools/blocks/props/pal.py: short ramps, desaturated, PBR intent on the material."""
from propkit import Mat, Geo, solid

# the club's finishes
GOLDPAPER = Mat('goldpaper', ['#231b0e', '#302612', '#3e3217', '#4d3f1d', '#5c4d25', '#6b5b2e', '#7a6a3a'], rough=215, h=136, hk=2)
ROTWOOD = Mat('rotwood', ['#0f0b07', '#18110b', '#221810', '#2d2015', '#39291b', '#463322', '#533d29'], rough=225, h=134, hk=5)
MOULD = Mat('mould', ['#161d13', '#202a1b', '#2b3824', '#38472f', '#46573b'], rough=250, h=137, hk=2)
OLDPLASTER = Mat('oldplaster', ['#2f2c24', '#3a362d', '#464137', '#524d42', '#5f594d', '#6c6659', '#797366'], rough=238, h=140, hk=3)
LATH = Mat('lath', ['#140e08', '#1f160c', '#2c2012', '#3a2a18', '#48351f'], rough=235, h=112, hk=6)
WATERSTAIN = Mat('waterstain', ['#2a2013', '#382b19', '#473720', '#574428', '#685232'], rough=225, h=138, hk=2)
VELVETGOLD = Mat('velvetgold', ['#231806', '#33240a', '#47320e', '#5e4414', '#77581c', '#8f6c26', '#a58032'], rough=246, h=138, hk=5)
CARPETRED = Mat('carpetred', ['#150809', '#1f0b0d', '#2b1013', '#38161a', '#461d22', '#54252a'], rough=250, h=132, hk=3)
DULLGOLD = Mat('dullgold', ['#33260c', '#4a3711', '#644c18', '#7f6221', '#987a2d', '#b0923e'], metal=90, rough=140, h=138, hk=3)
SLATE = Mat('slate', ['#121416', '#1a1d20', '#23272b', '#2d3237', '#383e44', '#444b52'], rough=120, h=140, hk=3)
CONCRETE = Mat('concrete', ['#1e1e1c', '#262624', '#2e2e2b', '#363633', '#3e3e3a', '#474743', '#50504b'], rough=232, h=132, hk=3)
BRICKRED = Mat('brickred', ['#2a1410', '#3b1c16', '#4d251c', '#5f2f23', '#71392a'], rough=235, h=134, hk=4)

# metal, glass, wax
PIPE = Mat('pipe_iron', ['#120f0d', '#1b1714', '#26201b', '#322a24', '#3f362e', '#4d4339'], metal=150, rough=170, h=138, hk=4)
VERDIGRIS = Mat('verdigris', ['#1c2e2a', '#28443d', '#365c52', '#487568', '#5c8e7e'], metal=60, rough=210, h=139, hk=2)
COPPERPIPE = Mat('pipe_copper', ['#2e170d', '#472313', '#61321b', '#7c4324', '#96582f', '#ae6f3e'], metal=200, rough=110, h=139, hk=3)
OLDBRASS = Mat('oldbrass', ['#22190a', '#352710', '#4b3817', '#644c1f', '#7d6229', '#967936', '#ae9148'], metal=200, rough=120, h=140, hk=3)
CRYSTAL = Mat('crystal', ['#3c4a50', '#58686e', '#7a8c92', '#a4b4b8', '#cddadc', '#eef6f6'], metal=40, rough=22, h=148, hk=2)
IVORY = Mat('ivory', ['#5a5544', '#716b57', '#89826b', '#a09980', '#b5ae95', '#c6c0a8'], rough=150, h=142, hk=3)
BOTTLE_G = Mat('bottle_green', ['#0c1a10', '#122818', '#1a3922', '#244c2e', '#31613c', '#44794e'], rough=35, h=146, hk=2)
BOTTLE_A = Mat('bottle_amber', ['#1e1004', '#321a07', '#48270b', '#603610', '#7a4817', '#935d22'], rough=35, h=146, hk=2)
BOTTLE_C = Mat('bottle_clear', ['#3a4442', '#4e5a57', '#65726e', '#7f8c87', '#9aa6a1', '#b6c1bb'], rough=28, h=146, hk=2)
DUST = Mat('dust', ['#4f4a40', '#625c50', '#757062', '#888274', '#9a9486'], rough=250, h=142, hk=1)
OLDCLOTH = Mat('oldcloth', ['#35322b', '#464239', '#585348', '#6a6558', '#7c7768', '#8d8878'], rough=245, h=137, hk=3)
VALVE = Mat('valve_red', ['#2a0b09', '#40110d', '#581912', '#712219', '#8a2f22'], metal=120, rough=150, h=140, hk=3)
CASE = Mat('case_old', ['#2e2a20', '#3d382b', '#4d4737', '#5d5643', '#6d6550', '#7c745d'], rough=165, h=140, hk=3)
DEADGLASS = Mat('deadglass', ['#040506', '#07090a', '#0b0e10', '#111517', '#191f22', '#252d31'], rough=40, h=130, hk=1)
BULBWARM = Mat('bulb_warm', ['#a86a22', '#dc9c3e', '#ffcf72', '#ffecb8', '#fffbe6'], rough=40, emit=[150, 210, 245, 255, 255], h=148, hk=1)
BULBDEAD = Mat('bulb_dead', ['#1e1a12', '#2c261a', '#3c3424', '#4e4430', '#62563e'], rough=45, h=148, hk=1)
BLACKWATER = Mat('blackwater', ['#030405', '#05070a', '#080b0f', '#0c1116', '#131a20', '#1e2830', '#2e3b45'], rough=10, h=120, hk=1)
WET = Mat('wet_floor', ['#06080a', '#0b0f12', '#11171b', '#1a2228', '#2a3640', '#45525c'], rough=12, h=124, hk=1)
SCUM = Mat('scum', ['#1a1d12', '#252a19', '#323822', '#41482c'], rough=160, h=124, hk=1)
CRAYON_Y = Mat('crayon_yellow', ['#8f7416', '#b3921c', '#d1ad26', '#e6c53a'], rough=200, h=138, hk=1)
CRAYON_R = Mat('crayon_red', ['#6e1a16', '#8f241d', '#ad3327'], rough=200, h=138, hk=1)
CRAYON_K = Mat('crayon_black', ['#141416', '#222226', '#343438'], rough=200, h=138, hk=1)
CRAYON_B = Mat('crayon_brown', ['#3c2814', '#56391c', '#704c26'], rough=200, h=138, hk=1)
OLDPAPER = Mat('oldpaper', ['#5e5848', '#756e5b', '#8d856f', '#a39b83', '#b6ae96', '#c5bea7'], rough=232, h=136, hk=2)
FUR = Mat('fur_gold', ['#3b220c', '#553211', '#714517', '#8d5b1f', '#a8732b', '#bf8b3c'], rough=236, h=138, hk=4)
EAR = Mat('ear_rust', ['#2a1208', '#3e1a0b', '#54240f', '#6b3015', '#823e1d'], rough=236, h=138, hk=4)
MUZZLE = Mat('muzzle_tan', ['#5c4426', '#775932', '#93703f', '#ad884f', '#c39f63'], rough=228, h=140, hk=3)
COATRED = Mat('coat_red', ['#240709', '#360b0e', '#4a1014', '#60171b', '#761f23'], rough=215, h=138, hk=3)
INK = Mat('ink', ['#060607', '#0c0c0e', '#141417', '#1e1e22'], rough=180, h=136, hk=1)
PUPIL = solid('pupil_pale', '#d8d2b8', rough=80, h=140)
TOOTH = Mat('tooth', ['#6b6552', '#878069', '#a39b82', '#bcb49a', '#d2cab0'], rough=120, h=142, hk=2)


def face_sheet(name, painter, w=16, h=16, variant=None):
    """Paint one w x h face (a cube texture, or a picture) with a propkit painter."""
    g = Geo(name, max(w, h), max(w, h))
    g.tw, g.th = w, h
    g.box('cube', (-w / 2, 0, -8), (w / 2, h, -8), {'north': painter})
    g.placements = {'cube_0.north': (0, 0, w, h)}
    g.items = g._face_items()
    return g.paint(variant)


# glyphs missing from propkit's 3x5 font
FONT_EXTRA = {
    '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '##.', '..#', '##.'],
    '7': ['###', '..#', '.#.', '.#.', '.#.'], '8': ['###', '#.#', '###', '#.#', '###'],
    'V': ['#.#', '#.#', '#.#', '#.#', '.#.'], 'J': ['..#', '..#', '..#', '#.#', '.#.'],
    'X': ['#.#', '#.#', '.#.', '#.#', '#.#'], '-': ['...', '...', '###', '...', '...'],
    '.': ['.', '.', '.', '.', '#'], '&': ['.#.', '#.#', '.#.', '#.#', '.##'],
}
