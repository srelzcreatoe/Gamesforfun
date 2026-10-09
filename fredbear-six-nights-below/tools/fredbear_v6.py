#!/usr/bin/env python3
"""Fredbear V6 import (the map owner's model, art/models_incoming/Fredbear_V6_NoEyeDots_Complete.zip).

Used by tools/gen_rp.py. The zip is read as-is (never modified); from it:
  * geometry   model/fredbear.geo.json      -> identifier renamed to geometry.fb.fredbear
  * texture    texture/fredbear.png         -> textures/entity/fb/fredbear.png (256x256, unchanged)
  * animations animations/fredbear.animation.json (12 clips) -> animation.fb.fredbear.*
    The clips are baked at 40 keys per second (6 MB of JSON). Keys that lie on the
    straight line between their neighbours (within 0.2 degrees / 0.02 units) are
    dropped and values rounded; compress() re-samples every clip and fails if
    any channel moves by more than the tolerance, so the motion is unchanged.

Added for the game (the zip has no clip for these states):
  * crawl     on hands and knees (basement crawlspace and the hatch climb)
  * stalk     the walk at 60 % speed (anim_time_update)
  * dormant   the deepest frame of the bow, held (powered down in his chamber)
  * perform_* the four stage performances as one-shot clips, chained by the
    animation controller so the show rotates sing -> greet -> mic sway -> crowd point
  * eyes / echo / shadow textures: glowing lens masks for the eye layer, the
    purple ECHO feed version and the black stage silhouette.
"""
import io
import json
import math
import zipfile

from PIL import Image

ZIP_DIR = "Fredbear_V6_NoEyeDots/"
ROT_TOL = 0.2
POS_TOL = 0.02

# Game animation state (fb:anim value) -> V6 clip. 'perform' and 'attack' are controller groups.
STATE_CLIPS = {
    "idle": "idle", "look": "idle", "pause": "idle",
    "walk": "walk", "stalk": "stalk", "retreat": "run", "crawl": "crawl",
    "threat": "perform_crowd_point", "music": "perform_mic_sway",
    "dormant": "dormant", "bow": "pose_bow", "showman": "pose_showman",
}
PERFORMANCES = ["perform_sing", "perform_greet", "perform_mic_sway", "perform_crowd_point"]
JUMPSCARES = ["jumpscare_snap_bite", "jumpscare_dual_lunge", "jumpscare_left_grab"]  # fb:variant 0, 1, 2
FREDBEAR_ANIMS = ["idle", "perform", "walk", "stalk", "crawl", "look", "pause", "threat", "attack", "retreat", "dormant", "music", "bow", "showman"]


def load(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        geo = json.loads(z.read(ZIP_DIR + "model/fredbear.geo.json"))
        anims = json.loads(z.read(ZIP_DIR + "animations/fredbear.animation.json"))["animations"]
        tex = Image.open(io.BytesIO(z.read(ZIP_DIR + "texture/fredbear.png"))).convert("RGBA")
    return geo, anims, tex


def geometry(geo):
    g = json.loads(json.dumps(geo))
    d = g["minecraft:geometry"][0]["description"]
    d["identifier"] = "geometry.fb.fredbear"
    # Wider bounds: the jumpscares lunge forward and the arms swing wide.
    d["visible_bounds_width"] = 6
    d["visible_bounds_height"] = 6
    d["visible_bounds_offset"] = [0, 2.6, 0]
    return g


def bone_names(geo):
    return [b["name"] for b in geo["minecraft:geometry"][0]["bones"]]


# --------------------------------------------------------------------------- animation compression
def _keys(channel):
    return sorted((float(t), v) for t, v in channel.items())


def _lerp(a, b, f):
    return [a[i] + (b[i] - a[i]) * f for i in range(3)]


def sample(channel, t):
    if isinstance(channel, list):
        return channel
    ks = _keys(channel)
    if t <= ks[0][0]:
        return ks[0][1]
    for (t0, v0), (t1, v1) in zip(ks, ks[1:]):
        if t0 <= t <= t1:
            return _lerp(v0, v1, 0 if t1 == t0 else (t - t0) / (t1 - t0))
    return ks[-1][1]


def _reduce(ks, tol):
    """Greedy: extend each segment while every skipped key stays within tol of the straight line."""
    out = [ks[0]]
    i = 0
    n = len(ks)
    while i < n - 1:
        j = i + 1
        while j + 1 < n:
            t0, v0 = ks[i]
            t1, v1 = ks[j + 1]
            ok = True
            for k in range(i + 1, j + 1):
                tk, vk = ks[k]
                f = (tk - t0) / (t1 - t0) if t1 != t0 else 0
                if max(abs(vk[c] - (v0[c] + (v1[c] - v0[c]) * f)) for c in range(3)) > tol:
                    ok = False
                    break
            if not ok:
                break
            j += 1
        out.append(ks[j])
        i = j
    return out


def _round(v):
    return [0.0 if abs(x) < 5e-4 else round(x, 3) for x in v]


def compress_channel(channel, tol):
    if isinstance(channel, list):
        return _round(channel)
    ks = _keys(channel)
    if all(max(abs(v[c] - ks[0][1][c]) for c in range(3)) <= tol for _, v in ks):
        return _round(ks[0][1])  # constant channel
    red = _reduce(ks, tol * 0.8)  # leave headroom for rounding
    return {f"{t:.4f}".rstrip("0").rstrip(".") or "0": _round(v) for t, v in red}


def compress(anims):
    """Returns (compressed clips, worst error per kind). Fails if the motion changed beyond tolerance."""
    out = {}
    worst = {"rotation": 0.0, "position": 0.0}
    for name, a in anims.items():
        bones = {}
        for bone, chans in a["bones"].items():
            nb = {}
            for kind, ch in chans.items():
                tol = ROT_TOL if kind == "rotation" else POS_TOL
                c = compress_channel(ch, tol)
                if isinstance(ch, dict):
                    for t, _ in _keys(ch):
                        err = max(abs(sample(ch, t)[i] - sample(c, t)[i]) for i in range(3))
                        worst[kind] = max(worst[kind], err)
                        if err > tol + 1e-3:
                            raise SystemExit(f"{name} {bone}.{kind} moved by {err:.4f} at t={t}")
                nb[kind] = c
            bones[bone] = nb
        out[name] = {k: v for k, v in a.items() if k != "bones"}
        out[name]["bones"] = bones
    return out, worst


# --------------------------------------------------------------------------- added clips
def kf(pairs):
    return {f"{t:.2f}".rstrip("0").rstrip(".") or "0": v for t, v in pairs}


def crawl_clip():
    """Hands and knees, facing forward (-Z). Same conventions as the V6 clips (checked with
    tools/render_preview.py): +X tips the top of a bone forward, so the torso leans with +X, a
    hanging limb swings forward with -X (the bow pairs torso +29 with arm -29) and the shins fold
    back with +X. The root drops 8.2 units so the knees and hands rest on the floor."""
    period = 1.2
    t = [0, 0.3, 0.6, 0.9, 1.2]

    def swing(base, amp, phase=0.0):
        return kf([(tt, [round(base + amp * math.sin(2 * math.pi * tt / period + phase), 3), 0, 0]) for tt in t])

    bob = kf([(tt, [0, round(-8.2 + 0.35 * abs(math.sin(2 * math.pi * tt / period)), 3), 0]) for tt in t])
    return {
        "loop": True, "animation_length": period, "bones": {
            "root": {"position": bob},
            "torso": {"rotation": [74, 0, 0]},
            "head": {"rotation": kf([(0, [-62, 0, 0]), (0.6, [-58, 5, 0]), (1.2, [-62, 0, 0])])},
            "jaw": {"rotation": kf([(0, [6, 0, 0]), (0.6, [14, 0, 0]), (1.2, [6, 0, 0])])},
            "upper_arm_r": {"rotation": swing(-99, 10)},
            "upper_arm_l": {"rotation": swing(-99, 10, math.pi)},
            "forearm_r": {"rotation": [-8, 0, 0]},
            "forearm_l": {"rotation": [-8, 0, 0]},
            "thigh_r": {"rotation": swing(-8, 8, math.pi)},
            "thigh_l": {"rotation": swing(-8, 8)},
            "shin_r": {"rotation": [88, 0, 0]},
            "shin_l": {"rotation": [88, 0, 0]},
            "foot_r": {"rotation": [-40, 0, 0]},
            "foot_l": {"rotation": [-40, 0, 0]},
        },
    }


def held_pose(clip, t):
    """A clip frozen at time t (every channel sampled to a constant)."""
    bones = {}
    for bone, chans in clip["bones"].items():
        bones[bone] = {k: _round(sample(v, t)) for k, v in chans.items()}
    return {"loop": True, "bones": bones}


def clips(raw):
    """All Fredbear animations, keyed by full identifier."""
    comp, worst = compress(raw)
    A = {}
    for name, a in comp.items():
        A["animation.fb.fredbear." + name.split(".", 2)[2]] = a
    A["animation.fb.fredbear.crawl"] = crawl_clip()
    walk = A["animation.fb.fredbear.walk"]
    A["animation.fb.fredbear.stalk"] = {**walk, "anim_time_update": "query.anim_time + query.delta_time * 0.6"}
    bow = A["animation.fb.fredbear.pose_bow"]
    deepest = max((float(k) for k in bow["bones"]["torso"]["rotation"]), key=lambda tt: sample(bow["bones"]["torso"]["rotation"], tt)[0])
    A["animation.fb.fredbear.dormant"] = held_pose(bow, deepest)
    for p in PERFORMANCES:
        A[f"animation.fb.fredbear.{p}_once"] = {**A[f"animation.fb.fredbear.{p}"], "loop": False}
    return A, worst


def controller():
    """controller.animation.fb.fredbear: fb:anim -> state; 'perform' rotates the four shows; 'attack' picks a jumpscare by fb:variant."""
    clip = dict(STATE_CLIPS)
    group = {s: s for s in STATE_CLIPS}
    for i, p in enumerate(PERFORMANCES):
        clip[f"perform_{i}"] = f"{p}_once"
        group[f"perform_{i}"] = "perform"
    for v, j in enumerate(JUMPSCARES):
        clip[f"attack_{v}"] = j
        group[f"attack_{v}"] = "attack"

    def enter(state):
        if group[state] == "perform":
            return "variable.fb_anim == 'perform'"
        if group[state] == "attack":
            return f"variable.fb_anim == 'attack' && variable.fb_variant == {state[-1]}"
        return f"variable.fb_anim == '{state}'"

    states = {}
    for st in clip:
        trans = []
        for other in clip:
            if other == st or (group[other] == group[st] and group[st] in ("perform", "attack")):
                continue
            if group[other] == "perform" and other != "perform_0":
                continue  # entering the show always starts with the first performance
            trans.append({other: enter(other)})
        if group[st] == "perform":
            nxt = f"perform_{(int(st[-1]) + 1) % len(PERFORMANCES)}"
            trans.append({nxt: "variable.fb_anim == 'perform' && query.all_animations_finished"})
        states[st] = {"animations": [clip[st]], "blend_transition": 0.05 if group[st] == "attack" else 0.25, "transitions": trans}
    return {"controller.animation.fb.fredbear": {"initial_state": "idle", "states": states}}


def client_animation_map():
    """Short names used by controller states -> animation identifiers (client entity 'animations')."""
    m = {"pose_controller": "controller.animation.fb.fredbear"}
    for c in set(STATE_CLIPS.values()) | {f"{p}_once" for p in PERFORMANCES} | set(JUMPSCARES):
        m[c] = f"animation.fb.fredbear.{c}"
    return m


# --------------------------------------------------------------------------- textures
def lens_rects(geo):
    """Texture rects (x0, y0, w, h) of every face of the eye-lens cubes (bones eye_r / eye_l)."""
    out = []
    for b in geo["minecraft:geometry"][0]["bones"]:
        if b["name"] not in ("eye_r", "eye_l"):
            continue
        for c in b.get("cubes", []):
            for face, e in c["uv"].items():
                (u, v), (w, h) = e["uv"], e["uv_size"]
                x0, x1 = sorted((u, u + w))
                y0, y1 = sorted((v, v + h))
                out.append((face, math.floor(x0), math.floor(y0), max(1, math.ceil(x1) - math.floor(x0)), max(1, math.ceil(y1) - math.floor(y0))))
    return out


def eye_mask(geo, size, centre, edge):
    """Eye layer texture: only the lens faces, bright in the middle (front face), darker at the rim."""
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    for face, x0, y0, w, h in lens_rects(geo):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                if 0 <= x < size[0] and 0 <= y < size[1]:
                    rim = face != "north" or x in (x0, x0 + w - 1) or y in (y0, y0 + h - 1)
                    im.putpixel((x, y), edge if rim else centre)
    return im


def shadow_texture(src):
    """Black stage silhouette: every visible texel near-black, alpha unchanged."""
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    px = src.load()
    po = out.load()
    for y in range(src.size[1]):
        for x in range(src.size[0]):
            r, g, b, a = px[x, y]
            if a:
                lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255.0
                v = 6 + int(10 * lum)
                po[x, y] = (v, v, v + 3, a)
    return out
