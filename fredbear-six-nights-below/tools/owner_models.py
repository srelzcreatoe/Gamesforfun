#!/usr/bin/env python3
"""The map owner's animatronic models (art/models_incoming), version 1.3:

  freddy    Freddy_V6_Blink_Coverage.zip          6 clips  (replaces the skin-built Freddy)
  bonnie    Bonnie_V2_Proportions_Fixed_Eyes.zip  8 clips  (replaces the skin-built Bonnie)
  morgrave  Morgrave_Longer_Torso_Complete.zip    4 clips  (new, nights 8-9)
  valek     Valek_Reworked_Complete.zip           4 clips  (new, nights 8-9)

Fredbear's V6 model is imported by tools/fredbear_v6.py (whose compression and
pose helpers are reused here). Used by tools/gen_rp.py. The zips are read
as-is; from each:
  * geometry   -> identifier geometry.fb.<who>, wider visible bounds
  * texture    -> textures/entity/fb/<who>.png (unchanged)
  * clips      -> animation.fb.<who>.<clip>, keyframes thinned within
    0.2 degrees / 0.02 units (compress() fails if anything moves more)

Added for the game (the zips have no clip for these states), each built on the
first frame of the model's idle clip so eye modes and props (Bonnie's banjo)
stay as idle has them:
  * crawl    hands and knees (vents, the crawlspace)
  * stalk    the walk at 60 % speed
  * threat   at a door: leaning in, jaw working
  * dormant  slumped (Bonnie: her own powered-down pose)
  * attack   a lunge with the jaw wide open (Freddy, Bonnie; Morgrave and Valek
             have their own jumpscare clip)
  * look_at  additive head turn driven by entity properties fb:look_yaw /
             fb:look_pitch / fb:look_tilt (the unsettling stare at the camera and
             the heads that follow you in Free Roam), eased in Molang
  * eye layer: only the model's own eye texels (bright pupils / irises),
    drawn with the glowing eyes material when fb:eyes is on
  * withered texture (Freddy, Bonnie; Chica's in gen_rp.py): darker, grimy,
    with torn patches showing the endoskeleton, used on nights 7-9 and in the
    challenges (fb:variant 1)
Bonnie's arm rest rotations are unusual (about [100, 26, -100]), so her added
clips keep her own arm poses and move the torso, head, jaw and legs only.
"""
import io
import json
import math
import random
import zipfile

from PIL import Image

import fredbear_v6 as V6

LOOK_ANIM = "look_at"
MODELS = {
    "freddy": {
        "zip": "Freddy_V6_Blink_Coverage.zip",
        "geo": "Freddy_V6_Blink_Coverage/freddy_v6.geo.json",
        "anim": "Freddy_V6_Blink_Coverage/freddy_v6.animation.json",
        "tex": "Freddy_V6_Blink_Coverage/freddy_v6.texture.png",
        "height": 3.16,  # in-game height of the old Freddy (37.5 units x 1.35)
        "rig": {"root": "root", "torso": "chest", "head": "head", "jaw": "jaw",
                "ua": ("upper_arm_right", "upper_arm_left"), "fa": ("forearm_right", "forearm_left"),
                "th": ("thigh_right", "thigh_left"), "sh": ("shin_right", "shin_left"), "ft": ("foot_right", "foot_left")},
        "arms": True,
        "clips": {"idle": "idle", "look": "idle", "pause": "pose", "walk": "walk", "stalk": "stalk", "retreat": "run",
                  "crawl": "crawl", "threat": "threat", "dormant": "dormant", "music": "perform_showman"},
        "performances": ["perform_showman", "perform_groove"],
        "jumpscares": ["attack"],
        "eye_bones": ["eyes_dark_right", "eyes_dark_left", "stage_iris_right", "stage_iris_left"],
        "eye_min": 0.5,
        "withered": True,
    },
    "bonnie": {
        "zip": "Bonnie_V2_Proportions_Fixed_Eyes.zip",
        "geo": "Bonnie_V2_Proportions_Fixed_Eyes/bonnie_v2_proportions_fixed_eyes.geo.json",
        "anim": "Bonnie_V2_Proportions_Fixed_Eyes/bonnie_v2_proportions_fixed_eyes.animation.json",
        "tex": "Bonnie_V2_Proportions_Fixed_Eyes/bonnie_v2_proportions_fixed_eyes.png",
        "height": 3.25,  # in-game height of the old Bonnie with her ears (40 units x 1.3)
        "rig": {"root": "root", "torso": "torso", "head": "head", "jaw": "jaw",
                "ua": ("right_upper_arm", "left_upper_arm"), "fa": ("right_forearm", "left_forearm"),
                "th": ("right_thigh", "left_thigh"), "sh": ("right_shin", "left_shin"), "ft": ("right_foot", "left_foot")},
        "arms": False,
        "clips": {"idle": "idle", "look": "pose_watch", "pause": "pose_watch", "walk": "walk", "stalk": "stalk", "retreat": "run",
                  "crawl": "crawl", "threat": "threat", "dormant": "pose_powered_down", "music": "idle"},
        "performances": ["perform_rhythm", "perform_solo"],
        "jumpscares": ["attack"],
        "eye_bones": ["right_eye_normal", "left_eye_normal", "right_eye_performance", "left_eye_performance"],
        "eye_min": 0.35,
        "withered": True,
    },
    "morgrave": {
        "zip": "Morgrave_Longer_Torso_Complete.zip",
        "geo": "Models/morgrave.geo.json",
        "anim": "Models/morgrave.animation.json",
        "tex": "Models/morgrave.texture.png",
        "height": 3.25,  # as tall as Bonnie (a rabbit, ears included)
        "rig": {"root": "root", "torso": "torso", "head": "head", "jaw": "jaw",
                "ua": ("upper_arm_r", "upper_arm_l"), "fa": ("forearm_r", "forearm_l"),
                "th": ("thigh_r", "thigh_l"), "sh": ("shin_r", "shin_l"), "ft": ("foot_r", "foot_l")},
        "arms": True,
        "clips": {"idle": "idle", "look": "idle", "pause": "idle", "walk": "walk", "stalk": "stalk", "retreat": "hurry",
                  "crawl": "crawl", "threat": "threat", "dormant": "dormant", "music": "idle"},
        "performances": ["perform"],
        "jumpscares": ["jumpscare"],
        "eye_bones": ["eyes"],
        "eye_min": 0.45,
        "withered": False,  # he is withered already
    },
    "valek": {
        "zip": "Valek_Reworked_Complete.zip",
        "geo": "Models/valek.geo.json",
        "anim": "Models/valek.animation.json",
        "tex": "Models/valek.texture.png",
        "height": 3.40,  # as tall as Fredbear
        "rig": {"root": "root", "torso": "torso", "head": "head", "jaw": "jaw",
                "ua": ("upper_arm_r", "upper_arm_l"), "fa": ("forearm_r", "forearm_l"),
                "th": ("thigh_r", "thigh_l"), "sh": ("shin_r", "shin_l"), "ft": ("foot_r", "foot_l")},
        "arms": True,
        "clips": {"idle": "idle", "look": "idle", "pause": "idle", "walk": "walk", "stalk": "stalk", "retreat": "hurry",
                  "crawl": "crawl", "threat": "threat", "dormant": "dormant", "music": "idle"},
        "performances": ["perform"],
        "jumpscares": ["jumpscare"],
        "eye_bones": ["eyes"],
        "eye_min": 0.45,
        "withered": False,
    },
}
ANIM_STATES = ["idle", "perform", "walk", "stalk", "crawl", "look", "pause", "threat", "attack", "retreat", "dormant", "music"]


# --------------------------------------------------------------------------- loading
def load(zip_path, spec):
    with zipfile.ZipFile(zip_path) as z:
        geo = json.loads(z.read(spec["geo"]))
        anims = json.loads(z.read(spec["anim"]))["animations"]
        tex = Image.open(io.BytesIO(z.read(spec["tex"]))).convert("RGBA")
    return geo, anims, tex


def model_height_units(geo):
    cubes = [c for b in geo["minecraft:geometry"][0]["bones"] for c in b.get("cubes", [])]
    return max(c["origin"][1] + c["size"][1] for c in cubes) - min(c["origin"][1] for c in cubes)


def scale_for(geo, spec):
    """minecraft:scale that keeps the animatronic as tall in the game as the one it replaces."""
    return round(spec["height"] * 16 / model_height_units(geo), 3)


def bone(geo, name):
    return next(b for b in geo["minecraft:geometry"][0]["bones"] if b["name"] == name)


def eye_height(geo, spec):
    """Eye height in blocks before entity scaling (jumpscare framing)."""
    ys = [bone(geo, b)["pivot"][1] for b in spec["eye_bones"] if any(x["name"] == b for x in geo["minecraft:geometry"][0]["bones"])]
    return round(sum(ys) / len(ys) / 16, 3)


def geometry(geo, who):
    g = json.loads(json.dumps(geo))
    d = g["minecraft:geometry"][0]["description"]
    d["identifier"] = f"geometry.fb.{who}"
    d["visible_bounds_width"] = 6
    d["visible_bounds_height"] = 7
    d["visible_bounds_offset"] = [0, 3, 0]
    return g


# --------------------------------------------------------------------------- added clips
def base_pose(idle):
    """Every channel of the idle clip at t = 0, as constants (eye modes, props, rest posture)."""
    return V6.held_pose(idle, 0.0)["bones"]


def make_clip(base, overrides, length=None, loop=True, extra=None):
    bones = {b: dict(ch) for b, ch in base.items()}
    for b, ch in overrides.items():
        bones.setdefault(b, {}).update(ch)
    clip = {"loop": loop, "bones": bones}
    if length:
        clip["animation_length"] = length
    if extra:
        clip.update(extra)
    return clip


def osc(base, amp, period, length, steps=8, phase=0.0, axis=0, other=(0, 0)):
    """Sinusoidal keyframes on one rotation axis."""
    out = []
    for k in range(steps + 1):
        t = length * k / steps
        v = base + amp * math.sin(2 * math.pi * t / period + phase)
        vec = list(other)
        vec.insert(axis, round(v, 3))
        out.append((t, vec))
    return V6.kf(out)


def crawl_clip(geo, spec, base):
    """Hands and knees, facing forward. Conventions as for Fredbear's crawl (tools/fredbear_v6.py)."""
    r = spec["rig"]
    knee = bone(geo, r["sh"][0])["pivot"][1]
    drop = -(knee - 2.0)
    period = 1.2
    ts = [0, 0.3, 0.6, 0.9, 1.2]
    swing = lambda b, amp, ph=0.0: V6.kf([(t, [round(b + amp * math.sin(2 * math.pi * t / period + ph), 3), 0, 0]) for t in ts])
    o = {
        r["root"]: {"position": V6.kf([(t, [0, round(drop + 0.35 * abs(math.sin(2 * math.pi * t / period)), 3), 0]) for t in ts])},
        r["torso"]: {"rotation": [74, 0, 0]},
        r["head"]: {"rotation": V6.kf([(0, [-62, 0, 0]), (0.6, [-58, 5, 0]), (1.2, [-62, 0, 0])])},
        r["jaw"]: {"rotation": V6.kf([(0, [6, 0, 0]), (0.6, [14, 0, 0]), (1.2, [6, 0, 0])])},
        r["th"][0]: {"rotation": swing(-8, 8, math.pi)},
        r["th"][1]: {"rotation": swing(-8, 8)},
        r["sh"][0]: {"rotation": [88, 0, 0]},
        r["sh"][1]: {"rotation": [88, 0, 0]},
        r["ft"][0]: {"rotation": [-40, 0, 0]},
        r["ft"][1]: {"rotation": [-40, 0, 0]},
    }
    if spec["arms"]:
        o[r["ua"][0]] = {"rotation": swing(-99, 10)}
        o[r["ua"][1]] = {"rotation": swing(-99, 10, math.pi)}
        o[r["fa"][0]] = {"rotation": [-30, 0, 0]}
        o[r["fa"][1]] = {"rotation": [-30, 0, 0]}
    return make_clip(base, o, period)


def threat_clip(spec, base):
    """At a door corner: leaning in, head cocked, jaw slowly working."""
    r = spec["rig"]
    L = 1.6
    o = {
        r["torso"]: {"rotation": [10, 0, 0]},
        r["head"]: {"rotation": V6.kf([(0, [-8, 0, 10]), (0.8, [-6, 4, 14]), (1.6, [-8, 0, 10])])},
        r["jaw"]: {"rotation": V6.kf([(0, [2, 0, 0]), (0.5, [24, 0, 0]), (0.9, [10, 0, 0]), (1.3, [26, 0, 0]), (1.6, [2, 0, 0])])},
    }
    if spec["arms"]:
        o[r["ua"][0]] = {"rotation": [-38, 0, 8]}
        o[r["fa"][0]] = {"rotation": [-34, 0, 0]}
        o[r["ua"][1]] = {"rotation": [-10, 0, -4]}
    return make_clip(base, o, L)


def dormant_clip(spec, base):
    """Switched off: slumped forward, head hanging, jaw loose."""
    r = spec["rig"]
    o = {
        r["root"]: {"position": [0, -1.2, 0]},
        r["torso"]: {"rotation": [16, 0, 3]},
        r["head"]: {"rotation": [30, 4, 8]},
        r["jaw"]: {"rotation": [12, 0, 0]},
        r["th"][0]: {"rotation": [-10, 0, 0]},
        r["th"][1]: {"rotation": [-10, 0, 0]},
        r["sh"][0]: {"rotation": [14, 0, 0]},
        r["sh"][1]: {"rotation": [14, 0, 0]},
    }
    if spec["arms"]:
        o[r["ua"][0]] = {"rotation": [6, 0, 4]}
        o[r["ua"][1]] = {"rotation": [6, 0, -4]}
        o[r["fa"][0]] = {"rotation": [-8, 0, 0]}
        o[r["fa"][1]] = {"rotation": [-8, 0, 0]}
    return make_clip(base, o)


def attack_clip(spec, base):
    """Jumpscare lunge: forward (+Z position = forward, see tools/render_preview.py), jaw wide, then shaking."""
    r = spec["rig"]
    L = 1.6
    shake = [round(0.18 + 0.08 * k, 2) for k in range(18)]
    head = [(0, [0, 0, 0]), (0.18, [-16, 0, 0])] + [(t, [-16 + (3 if k % 2 else -3), (2 if k % 3 == 0 else -2), 0]) for k, t in enumerate(shake)]
    jaw = [(0, [2, 0, 0]), (0.15, [44, 0, 0])] + [(t, [36 + (8 if k % 2 else 0), 0, 0]) for k, t in enumerate(shake)]
    o = {
        r["root"]: {"position": V6.kf([(0, [0, 0, 0]), (0.18, [0, 0, 7]), (0.3, [0, 0, 6]), (L, [0, 0, 6])])},
        r["torso"]: {"rotation": V6.kf([(0, [0, 0, 0]), (0.18, [22, 0, 0]), (L, [20, 0, 0])])},
        r["head"]: {"rotation": V6.kf([(t, v) for t, v in head if t <= L])},
        r["jaw"]: {"rotation": V6.kf([(t, v) for t, v in jaw if t <= L])},
    }
    if spec["arms"]:
        o[r["ua"][0]] = {"rotation": V6.kf([(0, [0, 0, 0]), (0.18, [-96, 0, -14]), (L, [-92, 0, -12])])}
        o[r["ua"][1]] = {"rotation": V6.kf([(0, [0, 0, 0]), (0.18, [-96, 0, 14]), (L, [-92, 0, 12])])}
        o[r["fa"][0]] = {"rotation": [-26, 0, 0]}
        o[r["fa"][1]] = {"rotation": [-26, 0, 0]}
    return make_clip(base, o, L, loop="hold_on_last_frame")


def look_at_clip(spec):
    """Additive head turn toward a point (fb:look_* properties, eased in pre_animation)."""
    return {"loop": True, "bones": {spec["rig"]["head"]: {"rotation": ["variable.fb_lp", "variable.fb_ly", "variable.fb_lt"]}}}


def clips(who, geo, raw, spec):
    comp, worst = V6.compress(raw)
    A = {}
    for name, a in comp.items():
        A[name.rsplit(".", 1)[1]] = a
    base = base_pose(A["idle"])
    A["stalk"] = {**A["walk"], "anim_time_update": "query.anim_time + query.delta_time * 0.6"}
    A["hurry"] = {**A["walk"], "anim_time_update": "query.anim_time + query.delta_time * 1.4"}
    A["crawl"] = crawl_clip(geo, spec, base)
    A["threat"] = threat_clip(spec, base)
    if "dormant" in spec["clips"].values() and "dormant" not in A:
        A["dormant"] = dormant_clip(spec, base)
    if "attack" in spec["jumpscares"]:
        A["attack"] = attack_clip(spec, base)
    for p in spec["performances"]:
        A[f"{p}_once"] = {**A[p], "loop": False}
    A[LOOK_ANIM] = look_at_clip(spec)
    return {f"animation.fb.{who}.{k}": v for k, v in A.items()}, worst


def controller(who, spec):
    """controller.animation.fb.<who>: fb:anim -> state; 'perform' rotates the shows; 'attack' picks a jumpscare by fb:variant."""
    clip = {s: spec["clips"][s] for s in spec["clips"]}
    group = {s: s for s in clip}
    perf = spec["performances"]
    for i, p in enumerate(perf):
        clip[f"perform_{i}"] = f"{p}_once" if len(perf) > 1 else p
        group[f"perform_{i}"] = "perform"
    for v, j in enumerate(spec["jumpscares"]):
        clip[f"attack_{v}"] = j
        group[f"attack_{v}"] = "attack"

    def enter(state):
        if group[state] == "perform":
            return "variable.fb_anim == 'perform'"
        if group[state] == "attack":
            return "variable.fb_anim == 'attack'" if len(spec["jumpscares"]) == 1 else f"variable.fb_anim == 'attack' && variable.fb_variant == {state[-1]}"
        return f"variable.fb_anim == '{state}'"

    states = {}
    for st in clip:
        trans = []
        for other in clip:
            if other == st or (group[other] == group[st] and group[st] in ("perform", "attack")):
                continue
            if group[other] == "perform" and other != "perform_0":
                continue
            trans.append({other: enter(other)})
        if group[st] == "perform" and len(perf) > 1:
            nxt = f"perform_{(int(st[-1]) + 1) % len(perf)}"
            trans.append({nxt: "variable.fb_anim == 'perform' && query.all_animations_finished"})
        states[st] = {"animations": [clip[st]], "blend_transition": 0.05 if group[st] == "attack" else 0.25, "transitions": trans}
    return {f"controller.animation.fb.{who}": {"initial_state": "idle", "states": states}}


def client_animation_map(who, spec):
    m = {"pose_controller": f"controller.animation.fb.{who}", LOOK_ANIM: f"animation.fb.{who}.{LOOK_ANIM}"}
    names = set(spec["clips"].values()) | set(spec["jumpscares"])
    names |= {f"{p}_once" for p in spec["performances"]} if len(spec["performances"]) > 1 else set(spec["performances"])
    for c in sorted(names):  # sorted: the generated file is identical on every run
        m[c] = f"animation.fb.{who}.{c}"
    return m


# --------------------------------------------------------------------------- textures
def cube_rects(geo, bones):
    """Texture rects (x0, y0, w, h) of every face of the cubes of `bones`."""
    out = []
    for b in geo["minecraft:geometry"][0]["bones"]:
        if b["name"] not in bones:
            continue
        for c in b.get("cubes", []):
            for face, e in _face_uvs(c).items():
                u, v, w, h = e
                x0, x1 = sorted((u, u + w))
                y0, y1 = sorted((v, v + h))
                out.append((math.floor(x0), math.floor(y0), max(1, math.ceil(x1) - math.floor(x0)), max(1, math.ceil(y1) - math.floor(y0))))
    return out


def _face_uvs(c):
    if isinstance(c["uv"], dict):
        return {f: (*e["uv"], *e["uv_size"]) for f, e in c["uv"].items()}
    u, v = c["uv"]
    w, h, d = c["size"]
    return {"north": (u + d, v + d, w, h), "east": (u, v + d, d, h), "south": (u + 2 * d + w, v + d, w, h),
            "west": (u + d + w, v + d, d, h), "up": (u + d + w, v + d, -w, -d), "down": (u + d + 2 * w, v, -w, d)}


def eye_texture(geo, tex, spec):
    """The model's own eye texels (bright pupils / irises), brightened; everything else transparent."""
    out = Image.new("RGBA", tex.size, (0, 0, 0, 0))
    src = tex.load()
    dst = out.load()
    n = 0
    for x0, y0, w, h in cube_rects(geo, set(spec["eye_bones"])):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                if not (0 <= x < tex.size[0] and 0 <= y < tex.size[1]):
                    continue
                r, g, b, a = src[x, y]
                if a < 128:
                    continue
                if max(r, g, b) / 255.0 >= spec["eye_min"]:
                    k = 255.0 / max(1, max(r, g, b))
                    dst[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), 255)
                    n += 1
    if n == 0:
        raise SystemExit(f"eye layer: no eye texels found for {spec['eye_bones']}")
    return out


def withered_texture(tex, geo, head_bones=("head", "jaw"), seed=1987):
    """Darker, grimy suit with torn patches showing the endoskeleton (bigger tears on the head)."""
    rnd = random.Random(seed)
    out = tex.copy()
    px = out.load()
    W, H = out.size
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            lum = 0.3 * r + 0.59 * g + 0.11 * b
            k = 0.62 + 0.12 * rnd.random()
            r, g, b = (int((0.75 * c + 0.25 * lum) * k) for c in (r, g, b))
            px[x, y] = (r, g + 2, max(0, b - 4), a)
    bones = geo["minecraft:geometry"][0]["bones"]
    head = {b["name"] for b in bones if b["name"] in head_bones}

    def tear(x0, y0, w, h, big):
        if w < 3 or h < 3:
            return
        tw = max(2, int(w * (0.45 if big else 0.3) * (0.6 + 0.8 * rnd.random())))
        th = max(2, int(h * (0.45 if big else 0.3) * (0.6 + 0.8 * rnd.random())))
        tx = x0 + rnd.randrange(0, max(1, w - tw))
        ty = y0 + rnd.randrange(0, max(1, h - th))
        for y in range(ty, min(H, ty + th)):
            for x in range(tx, min(W, tx + tw)):
                if px[x, y][3] == 0:
                    continue
                edge = x in (tx, tx + tw - 1) or y in (ty, ty + th - 1)
                if edge and rnd.random() < 0.5:
                    continue  # ragged edge
                v = 38 + rnd.randrange(0, 22) + (18 if (x + y) % 5 == 0 else 0)  # dark metal with glints
                px[x, y] = (v, v, v + 6, 255)

    for b in bones:
        big = b["name"] in head
        for c in b.get("cubes", []):
            chance = 0.55 if big else 0.22
            for face, e in _face_uvs(c).items():
                if rnd.random() > chance:
                    continue
                u, v, w, h = e
                x0, x1 = sorted((u, u + w))
                y0, y1 = sorted((v, v + h))
                tear(math.floor(x0), math.floor(y0), math.ceil(x1) - math.floor(x0), math.ceil(y1) - math.floor(y0), big)
    return out
