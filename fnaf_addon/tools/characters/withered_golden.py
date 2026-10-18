"""Withered Golden Freddy, from a 3/4-view reference picture:

  mustard-gold fur with darker brown patches, a small black top hat, flat black brows, one
  glowing cyan eye (the right) and one empty, torn eye socket (the left), the left ear torn off
  with a mechanical stub and loose wires, a tan muzzle with black freckles and a wide black nose,
  grey teeth, a big black bow tie, a lighter belly, mitten hands with four fingers, knee caps
  and big three-toed feet on black soles

It is built on fred3.py's parts at the same scale as the other picture replicas (26 picture px
= 1 model px), so it stands as tall as they do.  The picture is a 3/4 view, so the sizes below
are true sizes in model px (written through X/Y/H into fred3's picture-pixel format, as if for
a front view), checked by rendering the model from the picture's camera and overlaying the two.

Animations are in withered_golden_anims.py.
"""
import os

import numpy as np

from characters import fred3, vested
from characters.body import COMMON, ENDO, vox
from characters.fred3 import Pic, rbox
from fnafkit import export, rig
from fnafkit.rig import bone, cube

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "withered_golden_freddy"

# a virtual front view: model px -> picture px
PIC = Pic(512, 1480)


def X(x):
    return 512 - 26 * x


def Y(y):
    return 1480 - 26 * y


def H(h):
    return 26 * h


# --------------------------------------------------------------------------
# Colours (the picture's lit fur, brought up to albedo)
# --------------------------------------------------------------------------

def _flat(*tones, w=None):
    return vox(*tones, w=w, cell=0.5, bevel=0.0)


_DARK = [(96, 60, 12), (80, 50, 10)]
MATERIALS = {
    **COMMON,
    "fur": dict(vox((176, 124, 30), (160, 110, 24), (190, 138, 40), (142, 96, 20), (204, 150, 52), (122, 82, 16),
                    w=[3, 3, 3, 2, 1, 1], patches=[(1.4, 0.88, _DARK)], cell=0.5, bevel=0.0),
                spots=[((76, 48, 10), 0.012), ((52, 33, 7), 0.004), ((110, 64, 20), 0.01)]),
    "fur_dark": _flat((104, 68, 14), (90, 58, 12), (118, 78, 18)),
    "belly": _flat((190, 138, 42), (176, 126, 36), (202, 150, 52), (164, 116, 32), w=[3, 3, 2, 1]),
    "muzzle": _flat((192, 142, 50), (178, 130, 42), (204, 154, 60), (166, 120, 38), w=[3, 3, 2, 1]),
    "brow": _flat((22, 20, 18), (30, 27, 24), (16, 14, 13)),
    "hat": _flat((26, 24, 22), (34, 31, 28), (20, 18, 17), (44, 40, 36), w=[3, 3, 2, 1]),
    "sole": _flat((22, 20, 18), (30, 27, 24), (16, 14, 13)),
    "teeth": vox((140, 136, 128), (124, 120, 112), (156, 152, 144), cell=0.5, bevel=0.2),
    "wire_red": _flat((170, 28, 26), (150, 22, 20), (188, 40, 36)),
    "wire_black": _flat((24, 22, 22), (32, 30, 30), (18, 16, 16)),
    "wire_grey": _flat((120, 120, 124), (104, 104, 108), (136, 136, 140)),
    "endo": ENDO,
}
# colour correction measured against the picture: the render from the picture's camera, sampled in the
# same places as the picture, scaled per channel to match (its gold is more saturated than it looks)
CALIBRATION = {"fur": (1.0, 0.95, 0.55), "fur_dark": (1.0, 0.95, 0.55), "muzzle": (1.2, 1.12, 0.75),
               "belly": (0.94, 0.9, 0.82)}
for _mat, _k in CALIBRATION.items():
    _m = MATERIALS[_mat]
    _m["tones"] = [tuple(int(round(min(255, c * k))) for c, k in zip(t, _k)) for t in _m["tones"]]
    if _m.get("patches"):
        _m["patches"] = [(a, b, [tuple(int(round(c * k)) for c, k in zip(t, _k)) for t in ts]) for a, b, ts in _m["patches"]]
    _m["spots"] = [(tuple(int(round(c * k)) for c, k in zip(t, _k)), pr) for t, pr in _m.get("spots", [])]

for _k, _m in list(MATERIALS.items()):
    if "cell" in _m:
        MATERIALS[_k] = dict(_m, grain=0.04)
    elif _k in ("black", "socket"):
        MATERIALS[_k] = dict(_m, bevel=0.0, grain=0.03)
for _k, _v in (("muzzle", 0.6), ("teeth", 0.5), ("belly", 0.85)):
    MATERIALS[_k]["shade"] = _v
MATERIALS["eyeball"] = dict(MATERIALS["socket"], shade=0.0)
MATERIALS["glow_eye"] = dict(MATERIALS["socket"], shade=0.0)

# fred3's socket wall reads the glow colour from here (the eyeballs themselves are painted below)
EYES = {NAME: dict(iris=(40, 200, 240), ring=(16, 90, 150), pupil=(214, 252, 255), r_iris=0.45, r_ring=0.06,
                   r_pupil=0.2, halo=(20, 90, 120), r_halo=1.0, halo_a=0.7, glint=(255, 255, 255),
                   glow=(40, 210, 255), reflect=(-160, 40, 0.5), reflect_w=(0.06, 0.18), pixel=0.2)}

# --------------------------------------------------------------------------
# Measurements (model px, true sizes)
# --------------------------------------------------------------------------

BODY = {NAME: dict(chest=(Y(28.6), Y(40.2)), chest_half=H(6.5), depth=5.0, belly=(Y(29.0), Y(37.4)), belly_half=H(4.7),
                   pelvis=(Y(22.6), Y(28.8)), pelvis_half=H(6.4), bow=(Y(36.6), Y(40.0)), bow_half=H(3.4),
                   bow_mat="black", buttons=(), button_round=False)}

LEGS = {NAME: dict(leg_x=(X(4.2), X(-4.2)), shin_x=(X(4.8), X(-4.8)), thigh=(Y(16.9), Y(23.6)), thigh_half=H(3.35),
                   knee=(Y(16.0), Y(17.0)), knee_half=H(1.1), shin=(Y(5.6), Y(16.6)), shin_half=H(3.3),
                   shin_cap=(Y(13.4), H(2.8)), heel_top=Y(5.8), toe_top=Y(3.4), sole_top=Y(0.7),
                   foot=(X(10.6), X(0.7)), toe_depth=2.4)}

ARMS = {NAME: dict(shoulder=(X(7.4), Y(39.4)),
                   upper=dict(angle=9.0, span=(-0.4, 7.4), ox=1.6, half=(3.0, 2.9), next=(2.0, 8.0)),
                   fore=dict(angle=6.0, span=(0.3, 7.6), ox=0.3, half=(3.3, 3.0)), cap=(-1.4, 2.6, 2.0, 3.0))}

HANDS = {NAME: dict(kind="mitt", palm=(5.8, 4.8, 3.3), fingers=4, segs=(2.2, 2.0, 1.7), seg_w=1.4, seg_d=1.9,
                    thumb=(2.5, 2.1), thumb_w=1.9, tilt=0.3)}

HEADS = {NAME: dict(
    pivot=Y(40.0), front=-4.2, back=4.0,
    slabs=((Y(50.8), Y(51.9), H(3.5)), (Y(48.4), Y(50.8), H(4.1)), (Y(44.6), Y(48.4), H(4.3)), (Y(42.4), Y(44.6), H(4.4))),
    sockets=dict(rows=(Y(46.0), Y(48.4)), inner=(X(0.7), X(-0.7)), outer=(X(3.2), X(-3.2))),
    pupils=dict(x=(X(1.95), X(-1.95)), row=Y(47.1)), deep=0.8, mask=None,
    brow=dict(rows=(Y(48.7), Y(49.6)), inner=(X(0.8), X(-0.8)), outer=(X(3.3), X(-3.3)), mat="brow"),
    cheeks=dict(rows=(Y(42.6), Y(46.0)), out=(X(4.4), X(-4.4))),
    muzzle=dict(rows=(Y(42.2), Y(45.7)), half=(X(3.6), X(-3.6)), depth=3.2,
                freckles=((X(3.0), Y(44.7)), (X(2.5), Y(44.3)), (X(3.2), Y(43.9)))),
    nose=dict(rows=(Y(44.6), Y(45.8)), half=(X(1.3), X(-1.3))),
    jaw=dict(rows=(Y(39.9), Y(42.1)), half=(X(4.1), X(-4.1)), mat="fur"),
    teeth=dict(rows=(Y(42.1), Y(42.6)), span=(X(3.3), X(-3.3)), n=6, w=H(0.75)),
    tears=None,
    ears=dict(kind="round", centre=((X(6.2), X(-6.2)), Y(50.4)), size=(H(4.4), H(4.4)), inner=1.0, ring=0.3,
              colours=("fur", "fur_dark", "fur")),
    hat=dict(brim=(Y(51.6), Y(52.6), X(3.2), X(-3.2)), crown=(Y(52.6), Y(56.2), X(2.2), X(-2.2))))}

# the torn-off left ear: a stub on the head's top corner with wires poking out of it
# (name, material, base (x, y, z), length, rotation (x, y, z) in degrees)
WIRES = (("wire1", "wire_red", (-5.0, 51.4, 0.0), 1.7, (8, 0, 38)),
         ("wire2", "wire_black", (-5.2, 51.3, 0.4), 1.4, (-12, 0, 62)),
         ("wire3", "wire_red", (-5.4, 51.0, -0.2), 1.2, (20, 0, 84)),
         ("wire4", "wire_grey", (-4.8, 51.5, 0.2), 1.0, (-6, 0, 18)),
         ("wire5", "wire_black", (-5.5, 50.8, 0.3), 1.3, (4, 0, 110)))

TITLE = "WITHERED GOLDEN FREDDY"
EGG = ("#a8771c", "#1a1816")

for _table, _ours in ((fred3.P, {NAME: PIC}), (fred3.BODY, BODY), (fred3.LEGS, LEGS), (fred3.ARMS, ARMS),
                      (fred3.HANDS, HANDS), (fred3.HEADS, HEADS), (fred3.EYES, EYES),
                      (vested.P, {NAME: PIC}), (vested.LEGS, LEGS), (vested.HEADS, HEADS)):
    _table.update(_ours)

# --------------------------------------------------------------------------
# Painters
# --------------------------------------------------------------------------


def glow_eye_painter(ctx):
    """The right eye, as in the picture: a black socket with a glowing cyan iris drawn in square
    pixels around a near-white core, and a cyan rim along the socket's outer and lower edge."""
    ctx.paint("glow_eye")
    if ctx.face != "north":
        return
    H_ = HEADS[NAME]
    px, py = fred3.half_pair(PIC, *H_["pupils"]["x"]), PIC.y(H_["pupils"]["row"])
    q = 0.2
    Xq = (np.floor((ctx.X - px) / q) + 0.5) * q
    Yq = (np.floor((ctx.Y - py) / q) + 0.5) * q
    r = np.maximum(np.abs(Xq), np.abs(Yq))
    rgb, emi = ctx.rgb, ctx.emi
    rgb[...] = np.array([6, 9, 10], np.float32)
    halo = np.clip(1 - (r - 0.45) / 0.4, 0, 1)[..., None] * 0.45
    cyan = np.array([30, 150, 190], np.float32)
    rgb[...] = rgb * (1 - halo) + cyan * halo
    emi[...] = cyan * halo * 0.15
    iris = r < 0.45
    rgb[iris] = np.array([40, 200, 240], np.float32)
    emi[iris] = np.array([16, 100, 130], np.float32)
    core = r < 0.2
    rgb[core] = np.array([214, 252, 255], np.float32)
    emi[core] = np.array([130, 180, 190], np.float32)
    # cyan rim just inside the socket's outer and lower edges
    S_ = H_["sockets"]
    x0, x1 = fred3.half_pair(PIC, *S_["inner"]), fred3.half_pair(PIC, *S_["outer"])
    y0 = PIC.y(S_["rows"][0])
    rim = ((ctx.X > x1 - 0.22) | (ctx.Y < y0 + 0.22)) & ~iris
    rgb[rim] = np.array([60, 200, 230], np.float32)
    emi[rim] = np.array([20, 90, 115], np.float32)


def hollow_painter(ctx):
    """The empty left socket: a black hole going back into the head."""
    ctx.paint("socket")
    ctx.rgb *= 0.35


# --------------------------------------------------------------------------
# Builders
# --------------------------------------------------------------------------


def build_eyes():
    """Swap fred3's two matching eyeballs for the picture's: a glowing right eye on its own bone
    (so the clips can flicker it) and an empty left socket with a torn rim."""
    H_ = HEADS[NAME]
    eyes = rig.BONES["eyes"]
    eyes.cubes = [c for c in eyes.cubes if c.name != "eyeball"]
    fz, deep = H_["front"], H_["deep"]
    S_ = H_["sockets"]
    sx0, sx1 = fred3.half_pair(PIC, *S_["inner"]), fred3.half_pair(PIC, *S_["outer"])
    e0, e1 = PIC.y(S_["rows"][0]), PIC.y(S_["rows"][1])
    bone("eyeGlow", "eyes", [fred3.half_pair(PIC, *H_["pupils"]["x"]), PIC.y(H_["pupils"]["row"]), fz + deep])
    cube("eyeGlow", "eyeball", [sx0 + 0.02, e0 + 0.02, fz + deep - 0.3], [sx1 - 0.02, e1 - 0.02, fz + deep - 0.05],
         "glow_eye", painter=glow_eye_painter, res=32)
    cube("eyes", "hollow", [sx0 + 0.02, e0 + 0.02, fz + deep - 0.3], [sx1 - 0.02, e1 - 0.02, fz + deep - 0.05],
         "socket", -1, painter=hollow_painter)
    # torn fur round the empty socket: dark ragged notches on the face around its edge
    for k, (x, y, w, h) in enumerate(((sx1 + 0.05, e0 + 1.6, 0.35, 0.45), (sx1 - 0.6, e1 + 0.02, 0.5, 0.3),
                                      (sx0 + 0.5, e0 - 0.32, 0.45, 0.32), (sx1 + 0.02, e0 + 0.3, 0.3, 0.35),
                                      (sx0 - 0.25, e1 - 0.9, 0.3, 0.5), (sx0 + 1.2, e1 + 0.02, 0.35, 0.25))):
        cube("head", f"torn_rim{k + 1}", [x, y, fz - 0.06], [x + w, y + h, fz + 0.3], "fur_dark", -1)


def build_ears():
    """The right ear (a round ear with a dark groove ring); the left one is torn off, leaving a
    mechanical stub with wires sticking out of it."""
    pic, E = PIC, HEADS[NAME]["ears"]
    ex, ey = fred3.half_pair(pic, *E["centre"][0]), pic.y(E["centre"][1])
    r = pic.d(E["size"][0]) / 2
    outer, ring, inner = E["colours"]
    bone("rightEar", "head", [ex - r * 0.7, ey - r * 0.6, 0.2])
    rows = 6
    for j in range(rows):
        y0 = -r + 2 * r * j / rows
        yc = y0 + r / rows
        hw = round((r * r - yc * yc) ** 0.5 / 0.25 + 0.5) * 0.25
        c = cube("rightEar", f"ear_row{j + 1}", [ex - hw, ey + y0, -0.7], [ex + hw, ey + y0 + 2 * r / rows, 0.7], outer,
                 painter=fred3.ring_painter(outer, ring, inner, E["ring"], E["inner"]))
        c.ear_c = (ex, ey)
    bone("leftEar", "head", [-4.6, 50.6, 0.2])
    cube("leftEar", "ear_stub", [-5.6, 50.2, -0.6], [-4.2, 51.6, 0.9], "endo", painter=fred3.p_endo)
    cube("leftEar", "ear_stub_ring", [-5.9, 50.5, -0.4], [-5.5, 51.3, 0.7], "endo", painter=fred3.p_endo)
    for name, mat, (x, y, z), length, rot in WIRES:
        cube("leftEar", name, [x - 0.09, y, z - 0.09], [x + 0.09, y + length, z + 0.09], mat, rot=list(rot),
             origin=[x, y, z])


def build():
    bone("root", None, [0, 0, 0])
    vested.build_legs(NAME)
    hd, hw, c1 = fred3.build_body(NAME)
    hp = PIC.y(HEADS[NAME]["pivot"])
    cube("torso", "neck", [-1.3, c1 - 1.0, -1.2], [1.3, hp + 1.0, 1.4], "endo", painter=fred3.p_endo)
    PALM[NAME] = fred3.build_arms(NAME, hw)
    fred3.build_head(NAME)
    build_eyes()
    build_ears()
    fred3.build_hat(NAME)


PALM = {}


def spec():
    from characters import withered_golden_anims

    rig.reset(MATERIALS, tpu=4)
    build()
    D = fred3.dims(NAME)
    return export.Character(
        model_id=NAME,
        entity_id=f"fnaf:{NAME}",
        out_dir=os.path.join(export.TOOLS_DIR, "..", NAME),
        materials=MATERIALS,
        build_geometry=build,
        build_anims=lambda: withered_golden_anims.WitheredGoldenNight(NAME).build(NAME),
        sources=[os.path.abspath(__file__), os.path.join(HERE, "withered_golden_anims.py"), os.path.join(HERE, "vested.py"),
                 os.path.join(HERE, "fred3.py"), os.path.join(HERE, "fred3_anims.py"), os.path.join(HERE, "night.py"),
                 os.path.join(HERE, "body.py")],
        spawn_egg=EGG,
        variant_states={"pose1": 1, "pose2": 2, "performance1": 3, "performance2": 4, "jumpscare1": 5, "jumpscare2": 6},
        arm=dict(palm=PALM[NAME], chest=dict(half_x=D["half_w"] + 1.2, z=(-D["torso_d"] - 1.2, D["torso_d"] + 0.8),
                                             y=(D["torso"][0] - 3.0, D["torso"][1]))),
        visible_box=(6, 5, 2.5),
        atlas_width=1024,
        tpu=4,
        shading=fred3.SHADING,
    )
