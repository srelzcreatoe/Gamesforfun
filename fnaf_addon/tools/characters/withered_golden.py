"""Withered Golden Freddy (the movie Golden Freddy), from two reference pictures: a straight front
view and a 3/4 view of the same render:

  mustard-gold fur with darker brown patches, a small black top hat, flat black brows, one
  glowing cyan eye (the right) and one empty, torn eye socket (the left), the left ear torn off
  with a mechanical stub and loose wires, a tan muzzle with black freckles and a wide black nose,
  grey teeth, a big black bow tie, a lighter belly, double shoulder caps, mitten hands with four
  fingers, knee caps and big three-toed feet on black soles

It is built on fred3.py's parts at the same scale as the other picture replicas (26 picture px
= 1 model px), so it stands as tall as they do.  Every width and height below is measured in the
front picture's pixels, like fred3's tables; the depths, which a front view can't show, were fitted
against the 3/4 picture.  Both were checked by rendering the model from each picture's camera and
overlaying the outlines.

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

# the front picture: body centre line and floor row
PIC = Pic(509.5, 1464)
# the hands hang with the back of the hand facing forward, turned this far toward the leg (degrees;
# fred3's own rest is 90, palm to the leg)
HAND_TURN = 15.0


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
    "teeth": vox((104, 100, 92), (90, 86, 80), (118, 114, 106), cell=0.5, bevel=0.2),
    "stub": _flat((112, 112, 118), (98, 98, 104), (126, 126, 132)),
    "wire_red": _flat((170, 28, 26), (150, 22, 20), (188, 40, 36)),
    "wire_black": _flat((24, 22, 22), (32, 30, 30), (18, 16, 16)),
    "wire_grey": _flat((120, 120, 124), (104, 104, 108), (136, 136, 140)),
    "endo": ENDO,
}
# colour correction measured against the front picture: the render from its camera, sampled in the same
# places as the picture, scaled per channel to match (its gold is more saturated than it looks)
CALIBRATION = {"fur": (1.12, 0.99, 0.47), "fur_dark": (1.12, 0.99, 0.47), "muzzle": (1.34, 1.16, 0.62),
               "belly": (1.06, 0.98, 0.82)}
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

BODY = {NAME: dict(chest=(745, 410), chest_half=185, depth=5.0, belly=(738, 497), belly_half=135, pelvis=(870, 762),
                   pelvis_half=181, bow=(500, 418), bow_half=90, bow_mat="black", buttons=(), button_round=False)}

LEGS = {NAME: dict(leg_x=(411.5, 608.5), shin_x=(393.5, 626), thigh=(1040, 862), thigh_half=91.5, knee=(1062, 1036),
                   knee_half=28, shin=(1290, 1020), shin_half=95.5, shin_cap=(1095, 70), heel_top=1305, toe_top=1362,
                   sole_top=1437, foot=(225, 491), toe_depth=2.4, heel_x=(285, 490))}

# the upper arms angle out from the shoulder, the forearms a little less (see fred3.ARMS for the keys)
ARMS = {NAME: dict(shoulder=(316, 452), upper=dict(angle=16.0, span=(0.0, 8.0), ox=1.12, half=(2.7, 2.9), next=(0.32, 8.02)),
                   fore=dict(angle=8.5, span=(0.4, 7.8), ox=0.5, half=(3.12, 3.0)), cap=(-0.36, 1.92, 1.19, 1.35))}
# the second, outer shoulder cap on top of each upper arm: picture x span and rows
OUTER_CAP = dict(x=(238, 296), rows=(452, 408))

HANDS = {NAME: dict(kind="mitt", palm=(4.4, 3.7, 3.0), fingers=4, segs=(2.0, 1.8, 1.4), seg_w=1.0, seg_d=1.6,
                    thumb=(1.5, 1.2), thumb_w=1.5, tilt=0.3)}

HEADS = {NAME: dict(
    pivot=422, front=-3.9, back=4.0,
    slabs=((140, 127, 103), (152, 140, 120), (265, 152, 133), (360, 265, 130)),
    sockets=dict(rows=(275, 218), inner=(490, 530), outer=(422, 600)), pupils=dict(x=(459, 562), row=246), deep=0.8,
    mask=None, brow=dict(rows=(202, 181), inner=(482, 527), outer=(419, 590), mat="brow"),
    cheeks=dict(rows=(345, 265), out=(360.5, 658.5)),
    muzzle=dict(rows=(352, 277), half=(395, 616), depth=3.0, freckles=((413.5, 304), (441.5, 304), (426.5, 326))),
    nose=dict(rows=(296, 265), half=(465, 545)), jaw=dict(rows=(422, 362), half=(387, 625), mat="fur"),
    teeth=dict(rows=(362, 353), span=(412, 598), n=7, w=13), tears=None,
    ears=dict(kind="round", centre=((335.5, 683.5), 160), size=(119, 116), inner=1.38, ring=0.3,
              colours=("fur", "fur_dark", "fur")),
    hat=dict(brim=(127, 97, 440, 580), crown=(97, 19, 459, 560)))}

# the torn-off left ear: a stub on the head's top corner with wires coming out of it, as in the
# front picture (name, material, base (x, y, z), length, rotation (x, y, z) in degrees; a wire runs
# up from its base before the rotation)
STUB = dict(x=(-5.9, -4.2), y=(49.4, 51.3), plate=(-6.4, -5.8, 49.8, 50.9))
WIRES = (("wire_up", "wire_black", (-5.9, 51.2, 0.2), 0.9, (0, 0, 40)),
         ("wire_red", "wire_red", (-6.3, 50.6, 0.0), 1.15, (0, 0, 112)),
         ("wire_red_end", "wire_red", (-7.35, 50.18, 0.0), 0.45, (0, 0, 172)),
         ("wire_black", "wire_black", (-5.8, 49.45, 0.3), 1.15, (0, 0, 151)),
         ("wire_grey", "wire_grey", (-5.0, 49.45, -0.2), 0.6, (0, 0, 176)))

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
    y1 = PIC.y(S_["rows"][1])
    edge = np.minimum.reduce([ctx.X - x0, x1 - ctx.X, ctx.Y - y0, y1 - ctx.Y])
    rim = (edge < 0.2) & ~iris
    rgb[rim] = np.array([60, 200, 230], np.float32)
    emi[rim] = np.array([20, 90, 115], np.float32)


def groove_painter(centre, inner, ring):
    """The ear's front and back: a square inner panel inside a dark groove."""
    cx, cy = centre

    def painter(ctx):
        ctx.paint("fur")
        if ctx.face in ("north", "south"):
            d = np.maximum(np.abs(ctx.X - cx), np.abs(ctx.Y - cy))
            ctx.paint("socket", (d >= inner) & (d < inner + ring))
            ctx.rgb[d < inner] *= 1.06

    return painter


def hollow_painter(ctx):
    """The empty left socket: a black hole going back into the head."""
    ctx.paint("socket")
    ctx.rgb *= 0.35


# --------------------------------------------------------------------------
# Builders
# --------------------------------------------------------------------------


def sharpen_brows():
    """fred3 rounds the brows and the nose; the picture's are sharp-edged black blocks."""
    H_ = HEADS[NAME]
    Bw, fz = H_["brow"], H_["front"]
    head = rig.BONES["head"]
    head.cubes = [c for c in head.cubes if not c.name.startswith(("brow", "nose"))]
    N, sz = H_["nose"], fz - H_["muzzle"]["depth"]
    nw = fred3.half_pair(PIC, *N["half"])
    cube("head", "nose", [-nw, PIC.y(N["rows"][0]), sz - 0.45], [nw, PIC.y(N["rows"][1]), sz + 1.3], "black")
    b0, b1 = PIC.y(Bw["rows"][0]), PIC.y(Bw["rows"][1])
    bi, bo = fred3.half_pair(PIC, *Bw["inner"]), fred3.half_pair(PIC, *Bw["outer"])
    for s in (1, -1):
        cube("head", "brow", [bi, b0, fz - 0.55], [bo, b1, fz + 0.3], Bw["mat"], s)


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
    hw, hh = pic.d(E["size"][0]) / 2, pic.d(E["size"][1]) / 2
    bone("rightEar", "head", [ex - hw * 0.7, ey - hh * 0.6, 0.2])
    painter = groove_painter((ex, ey), E["inner"], E["ring"])
    for k, c in enumerate((0.0, 0.3, 0.6)):          # a square with its corners cut back in steps
        cube("rightEar", f"ear{k + 1}", [ex - hw + c, ey - hh + 0.6 - c, -0.7], [ex + hw - c, ey + hh - 0.6 + c, 0.7], "fur",
             painter=painter)
    # the rim stands proud of the recessed inner panel, on the front
    rw = E["inner"] + E["ring"]
    for k, (x0, x1, y0, y1) in enumerate(((-hw + 0.3, hw - 0.3, rw, hh - 0.3), (-hw + 0.3, hw - 0.3, -hh + 0.3, -rw),
                                          (-hw + 0.3, -rw, -rw, rw), (rw, hw - 0.3, -rw, rw))):
        cube("rightEar", f"ear_rim{k + 1}", [ex + x0, ey + y0, -0.95], [ex + x1, ey + y1, -0.7], "fur")
    (x0, x1), (y0, y1), (px0, px1, py0, py1) = STUB["x"], STUB["y"], STUB["plate"]
    bone("leftEar", "head", [x1, (y0 + y1) / 2, 0.2])
    cube("leftEar", "ear_stub", [x0, y0, -0.8], [x1, y1, 1.0], "stub")
    cube("leftEar", "ear_stub_plate", [px0, py0, -0.5], [px1, py1, 0.7], "endo", painter=fred3.p_endo)
    cube("leftEar", "ear_stub_socket", [x0 + 0.4, y0 + 0.5, -0.86], [x0 + 1.1, y0 + 1.3, -0.78], "socket")
    for name, mat, (x, y, z), length, rot in WIRES:
        cube("leftEar", name, [x - 0.09, y, z - 0.09], [x + 0.09, y + length, z + 0.09], mat, rot=list(rot),
             origin=[x, y, z])


def build_shoulders():
    """The outer shoulder cap on each upper arm, and the hands turned to their rest in the picture."""
    A = ARMS[NAME]
    sx, sy = PIC.x(A["shoulder"][0]), PIC.y(A["shoulder"][1])
    cx0, cx1 = PIC.x(OUTER_CAP["x"][1]), PIC.x(OUTER_CAP["x"][0])
    y0, y1 = PIC.y(OUTER_CAP["rows"][0]), PIC.y(OUTER_CAP["rows"][1])
    d = A["upper"]["half"][1] - 0.4
    for s, side in ((1, "right"), (-1, "left")):
        # the arm bone is tilted out by the upper arm's angle: undo it for a cap measured upright
        a = np.radians(A["upper"]["angle"])
        px, py = (cx0 + cx1) / 2 - sx, (y0 + y1) / 2 - sy
        lx, ly = px * np.cos(a) + py * np.sin(a), -px * np.sin(a) + py * np.cos(a)
        hw_, hh = (cx1 - cx0) / 2, (y1 - y0) / 2
        rbox(f"{side}Arm", "shoulder_cap_outer", sx + lx - hw_, sx + lx + hw_, sy + ly - hh, sy + ly + hh, -d, d, "fur", s, r=0.6)
        rig.BONES[f"{side}Hand"].rot[1] = -s * HAND_TURN


def build():
    bone("root", None, [0, 0, 0])
    vested.build_legs(NAME)
    hd, hw, c1 = fred3.build_body(NAME)
    hp = PIC.y(HEADS[NAME]["pivot"])
    cube("torso", "neck", [-1.3, c1 - 1.0, -1.2], [1.3, hp + 1.0, 1.4], "endo", painter=fred3.p_endo)
    PALM[NAME] = fred3.build_arms(NAME, hw)
    build_shoulders()
    fred3.build_head(NAME)
    sharpen_brows()
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
