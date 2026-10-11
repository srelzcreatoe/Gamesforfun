"""Jumpscare framing (1.4): how close each animatronic's attack animation brings its face
and hands to the player's eyes, so the jumpscare never pushes the model through the camera.

For every model and attack clip the posed geometry is sampled every 0.02 s (the same bone
maths as tools/render_preview.py). Measured in blocks, at the model's in-game scale, from
the model's feet along its facing direction:

  head   the furthest forward any part of the head (and its children) gets
  near   the furthest forward any part gets inside a 0.8-block tube around the line of
         sight (the camera looks at the face, so arms out to the side do not count)

The game places the puppet at max(head + HEAD_CLEAR, near + NEAR_CLEAR) blocks in front of
the eyes (mc/puppets.js lunge). Output: packs/FredbearBP/scripts/data/jumpscare_reach.generated.js

Run after tools/gen_rp.py. Usage: python3 tools/gen_jumpscare_reach.py
"""
import json
import pathlib
import re

import render_preview as RPV

ROOT = pathlib.Path(__file__).resolve().parent.parent
RP = ROOT / "packs" / "FredbearRP"
OUT = ROOT / "packs" / "FredbearBP" / "scripts" / "data" / "jumpscare_reach.generated.js"
HEAD_CLEAR = 0.55  # blocks between the camera and the face at the closest moment
NEAR_CLEAR = 0.3  # blocks between the camera and anything else in the line of sight
TUBE = 0.8  # blocks around the line of sight that count for "near"
STEP = 0.02

# who -> [(variant, animation file, animation id)]
CLIPS = {
    "freddy": [(0, "fb_freddy", "animation.fb.freddy.attack")],
    "bonnie": [(0, "fb_bonnie", "animation.fb.bonnie.attack")],
    "chica": [(0, "fb_animatronic", "animation.fb.attack")],
    "fredbear": [(0, "fb_fredbear", "animation.fb.fredbear.jumpscare_snap_bite"),
                 (1, "fb_fredbear", "animation.fb.fredbear.jumpscare_dual_lunge"),
                 (2, "fb_fredbear", "animation.fb.fredbear.jumpscare_left_grab")],
    "morgrave": [(0, "fb_morgrave", "animation.fb.morgrave.jumpscare")],
    "valek": [(0, "fb_valek", "animation.fb.valek.jumpscare")],
}


def game_table(name):
    """SCALE / EYE_HEIGHT from mc/game.js (the single source the game uses)."""
    src = (ROOT / "packs" / "FredbearBP" / "scripts" / "mc" / "game.js").read_text()
    body = re.search(rf"const {name} = Object\.freeze\(\{{([^}}]+)\}}\)", src).group(1)
    return {k: float(v) for k, v in re.findall(r"(\w+):\s*([\d.]+)", body)}


def descendants(bones, root):
    names = {root}
    changed = True
    while changed:
        changed = False
        for b in bones:
            if b.get("parent") in names and b["name"] not in names:
                names.add(b["name"])
                changed = True
    return names


def corners(c):
    (ox, oy, oz), (w, h, d) = c["origin"], c["size"]
    inf = c.get("inflate", 0)
    return [(x, y, z) for x in (ox - inf, ox + w + inf) for y in (oy - inf, oy + h + inf) for z in (oz - inf, oz + d + inf)]


def measure(who, anim, geo, scale, eye):
    bones = geo["minecraft:geometry"][0]["bones"]
    head_root = next(b["name"] for b in bones if b["name"].lower() == "head")
    head = descendants(bones, head_root)
    length = anim.get("animation_length") or max(
        (float(k) for ch in anim.get("bones", {}).values() for v in ch.values() if isinstance(v, dict) for k in v), default=1.0)
    best_head = best_near = -9.0
    t = 0.0
    while t <= length + 1e-9:
        pose = RPV.pose_from(anim, t)
        xf = RPV.bone_transforms(bones, pose)
        hide = RPV.hidden_bones(bones, pose)
        for b in bones:
            if b["name"] in hide:
                continue
            f = xf[b["name"]]
            for c in b.get("cubes", []):
                for p in corners(c):
                    q = f(list(p))
                    fwd = -q[2] / 16 * scale  # faces look toward -Z in this space (render_preview front view)
                    side = abs(q[0]) / 16 * scale
                    up = abs(q[1] / 16 * scale - eye)
                    if b["name"] in head:
                        best_head = max(best_head, fwd)
                    if side < TUBE and up < TUBE:
                        best_near = max(best_near, fwd)
        t += STEP
    return round(best_head, 3), round(best_near, 3)


def main():
    scale_t, eye_t = game_table("SCALE"), game_table("EYE_HEIGHT")
    out = {}
    for who, clips in CLIPS.items():
        geo = json.loads((RP / "models" / "entity" / f"fb_{who}.geo.json").read_text())
        scale = scale_t[who]
        eye = eye_t[who] * scale
        rows = []
        for variant, file, anim_id in clips:
            anim = json.loads((RP / "animations" / f"{file}.animation.json").read_text())["animations"][anim_id]
            head, near = measure(who, anim, geo, scale, eye)
            dist = round(max(head + HEAD_CLEAR, near + NEAR_CLEAR, 0.9), 2)
            rows.append({"variant": variant, "clip": anim_id.split(".")[-1], "head": head, "near": near, "distance": dist})
        out[who] = rows
    lines = [
        "// GENERATED by tools/gen_jumpscare_reach.py from the RP models and attack animations. Do not edit.",
        "// distance: blocks between the player's eyes and the puppet's feet so that, at the closest moment of",
        f"// the attack animation, the face stays >= {HEAD_CLEAR} and anything in the line of sight >= {NEAR_CLEAR} from the camera.",
        "export const JUMPSCARE_REACH = Object.freeze({",
    ]
    for who, rows in out.items():
        lines.append(f"  {who}: Object.freeze([{', '.join(json.dumps(r) for r in rows)}]),")
    lines.append("});")
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    summary = ", ".join(f"{w} {'/'.join(str(r['distance']) for r in rs)}" for w, rs in out.items())
    print(f"jumpscare distances (blocks): {summary}")


if __name__ == "__main__":
    main()
