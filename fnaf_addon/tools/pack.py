"""Bundle every character into one Minecraft Bedrock add-on.

    python3 tools/pack.py            # -> fnaf_addon/addon/FNAF_Animatronics.mcaddon
    python3 tools/pack.py --pack FNAF_Six bonnie freddy ...   # just these, as a separate pack

The resource pack merges each character's bedrock/ folder (geometry, animations, animation and
render controllers, client entity, textures) and adds names and spawn eggs.  The behavior pack
gives every character a server entity that wanders, looks at players and switches between its
poses, performances and jumpscares through events (minecraft:mark_variant, which the animation
controllers read).  Jumpscares reset to idle on their own when they finish.

Pack UUIDs are derived from fixed names, so rebuilding updates the same pack in Minecraft
instead of installing a second copy.
"""
import argparse
import json
import os
import shutil
import uuid
import zipfile

from PIL import Image

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
VERSION = [1, 0, 0]
MIN_ENGINE = [1, 20, 0]

NAMES = {"bonnie": "Bonnie", "freddy": "Freddy", "withered_freddy": "Withered Freddy", "party_cat": "Party Cat",
         "rat": "Rat", "monkey": "Monkey", "bat": "Bat", "crocodile": "Crocodile", "fox": "Fox", "bunny": "Bunny",
         "goat": "Goat", "bear": "Bear", "golden_freddy": "Golden Freddy", "crimson_freddy": "Crimson Freddy",
         "violet_bunny": "Violet Bunny", "rustgrin": "Rustgrin", "mirehop": "Mirehop", "noxbriar": "Noxbriar",
         "withered_golden_freddy": "Withered Golden Freddy"}
# mark_variant value -> clip, as read by every animation controller
VARIANTS = {1: "pose1", 2: "pose2", 3: "performance1", 4: "performance2", 5: "jumpscare1", 6: "jumpscare2"}
ICON_FACES = ("fox", "crocodile", "bunny", "bear")      # 2x2 grid on the pack icon


DEFAULT_PACK = "FNAF_Animatronics"
PACK = DEFAULT_PACK          # a separate pack gets its own UUIDs, so both can be installed side by side


def pack_uuid(part):
    if PACK != DEFAULT_PACK:
        part = f"{PACK}/{part}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://github.com/srelzcreatoe/Gamesforfun/fnaf_addon/{part}"))


def dump(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def characters(only=None):
    return [n for n in NAMES if (not only or n in only) and os.path.isdir(os.path.join(ROOT, n, "bedrock"))]


def clip_lengths(name):
    with open(os.path.join(ROOT, name, "bedrock", "animations", f"{name}.animation.json")) as f:
        anims = json.load(f)["animations"]
    return {k.split(".")[-1]: v.get("animation_length", 0.0) for k, v in anims.items()}


def model_height(name):
    """Highest point of the rest pose in blocks (ignores cube rotation)."""
    with open(os.path.join(ROOT, name, "bedrock", "models", "entity", f"{name}.geo.json")) as f:
        bones = json.load(f)["minecraft:geometry"][0]["bones"]
    top = max(c["origin"][1] + c["size"][1] for b in bones for c in b.get("cubes", []))
    return top / 16


def manifest(kind, name, description, deps):
    return {"format_version": 2,
            "header": {"name": name, "description": description, "uuid": pack_uuid(f"{kind}/header"),
                       "version": VERSION, "min_engine_version": MIN_ENGINE},
            "modules": [{"type": "resources" if kind == "rp" else "data", "uuid": pack_uuid(f"{kind}/module"),
                         "version": VERSION}],
            "dependencies": [{"uuid": pack_uuid(f"{d}/header"), "version": VERSION} for d in deps]}


def server_entity(name):
    lengths = clip_lengths(name)
    height = model_height(name)
    variants = {v: clip for v, clip in VARIANTS.items() if clip in lengths}
    groups, events = {}, {}
    all_groups = [f"fnaf:{clip}" for clip in variants.values()]
    for v, clip in variants.items():
        g = {"minecraft:mark_variant": {"value": v},
             "minecraft:movement": {"value": 0.0}}          # stands still while it performs
        if clip.startswith("jumpscare"):
            g["minecraft:timer"] = {"looping": False, "time": round(lengths[clip], 2),
                                    "time_down_event": {"event": "fnaf:idle"}}
        groups[f"fnaf:{clip}"] = g
        events[f"fnaf:{clip}"] = {"remove": {"component_groups": [x for x in all_groups if x != f"fnaf:{clip}"]},
                                  "add": {"component_groups": [f"fnaf:{clip}"]}}
    events["fnaf:idle"] = {"remove": {"component_groups": all_groups}}
    return {
        "format_version": "1.20.0",
        "minecraft:entity": {
            "description": {"identifier": f"fnaf:{name}", "is_spawnable": True, "is_summonable": True,
                            "is_experimental": False},
            "component_groups": groups,
            "components": {
                "minecraft:type_family": {"family": ["fnaf_animatronic", name, "mob"]},
                "minecraft:health": {"value": 60, "max": 60},
                "minecraft:collision_box": {"width": 1.0, "height": round(min(height, 3.6), 1)},
                "minecraft:physics": {},
                "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": True},
                "minecraft:knockback_resistance": {"value": 1.0},
                "minecraft:persistent": {},
                "minecraft:nameable": {},
                "minecraft:mark_variant": {"value": 0},
                "minecraft:movement": {"value": 0.2},
                "minecraft:movement.basic": {},
                "minecraft:jump.static": {},
                "minecraft:navigation.walk": {"can_path_over_water": False, "avoid_water": True, "avoid_damage_blocks": True},
                "minecraft:behavior.float": {"priority": 0},
                "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 1.0},
                "minecraft:behavior.look_at_player": {"priority": 7, "look_distance": 8.0, "probability": 0.05},
                "minecraft:behavior.random_look_around": {"priority": 8},
            },
            "events": events,
        },
    }


def pack_icon(path, chars):
    tiles = []
    for n in (ICON_FACES if set(ICON_FACES) <= set(chars) else chars[-4:]):
        sheet = os.path.join(ROOT, n, "preview", f"{n}_sheet.png")
        if os.path.exists(sheet):
            tiles.append(Image.open(sheet).convert("RGB").crop((730, 720, 1010, 1000)).resize((128, 128)))
    icon = Image.new("RGB", (256, 256), (12, 8, 10))
    for i, t in enumerate(tiles[:4]):
        icon.paste(t, ((i % 2) * 128, (i // 2) * 128))
    icon.save(path)


def zip_dir(zf, folder, arc_root):
    """Add a folder with fixed timestamps and order, so identical packs give identical archives."""
    for base, dirs, files in os.walk(folder):
        dirs.sort()
        for fn in sorted(files):
            full = os.path.join(base, fn)
            info = zipfile.ZipInfo(os.path.join(arc_root, os.path.relpath(full, folder)), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(full, "rb") as f:
                zf.writestr(info, f.read())


def build(out_dir, only=None):
    chars = characters(only)
    rp = os.path.join(out_dir, f"{PACK}_RP")
    bp = os.path.join(out_dir, f"{PACK}_BP")
    for d in (rp, bp):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)

    desc = "Minecraft-style FNAF animatronics: " + ", ".join(NAMES[n] for n in chars)
    title = "FNAF Animatronics" if PACK == DEFAULT_PACK else PACK.replace("_", " ")
    dump(os.path.join(rp, "manifest.json"), manifest("rp", f"{title} Resources", desc, ["bp"]))
    dump(os.path.join(bp, "manifest.json"), manifest("bp", f"{title} Behaviors", desc, ["rp"]))
    lang = []
    for n in chars:
        shutil.copytree(os.path.join(ROOT, n, "bedrock"), rp, dirs_exist_ok=True)
        dump(os.path.join(bp, "entities", f"{n}.json"), server_entity(n))
        lang += [f"entity.fnaf:{n}.name={NAMES[n]}", f"item.spawn_egg.entity.fnaf:{n}.name=Spawn {NAMES[n]}"]
    for d in (rp, bp):
        os.makedirs(os.path.join(d, "texts"), exist_ok=True)
        dump(os.path.join(d, "texts", "languages.json"), ["en_US"])
        with open(os.path.join(d, "texts", "en_US.lang"), "w") as f:
            f.write("\n".join(lang if d == rp else [f"pack.name={title} Behaviors"]) + "\n")
        pack_icon(os.path.join(d, "pack_icon.png"), chars)

    mcaddon = os.path.join(out_dir, f"{PACK}.mcaddon")
    with zipfile.ZipFile(mcaddon, "w", zipfile.ZIP_DEFLATED) as zf:
        zip_dir(zf, rp, f"{PACK}_RP")
        zip_dir(zf, bp, f"{PACK}_BP")
    return chars, rp, bp, mcaddon


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=os.path.join(ROOT, "addon"), help="output folder")
    ap.add_argument("--keep-folders", action="store_true", help="keep the unzipped RP/BP folders next to the .mcaddon")
    ap.add_argument("--pack", default=DEFAULT_PACK, help="pack name (file names and UUIDs); needed with a character list")
    ap.add_argument("names", nargs="*", choices=[[]] + list(NAMES), help="characters to include (default: all)")
    args = ap.parse_args()
    if args.names and args.pack == DEFAULT_PACK:
        ap.error("a pack with only some characters needs its own --pack name")
    global PACK
    PACK = args.pack
    chars, rp, bp, mcaddon = build(args.out, args.names)
    if not args.keep_folders:
        shutil.rmtree(rp)
        shutil.rmtree(bp)
    print(f"{len(chars)} characters -> {mcaddon} ({os.path.getsize(mcaddon) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
