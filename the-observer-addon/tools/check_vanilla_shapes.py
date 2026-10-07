#!/usr/bin/env python3
"""Compare the *shape* of our resource-pack JSON with Mojang's own vanilla files.

The official schema package accepts some forms the game client rejects (for example object values in a client
entity's `sound_effects`, or an empty `animations` list in a controller state). A dedicated server never loads a
resource pack, so those errors only show up in a game client. This check catches them offline by comparing every
value's JSON type with the types vanilla uses at the same place.

Usage:
    git clone --depth 1 --filter=blob:none --sparse https://github.com/Mojang/bedrock-samples.git samples
    (cd samples && git sparse-checkout set resource_pack/entity resource_pack/animation_controllers \\
        resource_pack/render_controllers resource_pack/animations resource_pack/particles resource_pack/fogs)
    python3 tools/check_vanilla_shapes.py --samples samples/resource_pack
"""
import argparse
import json
import pathlib
import re
import sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
RP = ROOT / "packs" / "TheObserver_RP"


def load(p):
    text = pathlib.Path(p).read_text(encoding="utf-8-sig")
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)  # a few vanilla files carry line comments
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def jtype(v):
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "array" if v else "empty_array"
    if isinstance(v, dict):
        return "object"
    return "null"


# Keys whose children are names chosen by the author (state names, short names, bones, timestamps …).
WILD_PARENTS = {
    "client": [r"^description\.(materials|textures|geometry|animations|sound_effects|particle_effects|particle_emitters|locators)$",
               r"^description\.scripts\.(variables|parent_setup)$"],
    "controller": [r"^animation_controllers$", r"^animation_controllers\.\*\.states$", r"^animation_controllers\.\*\.variables$",
                   r"\.transitions\[\]$", r"\.animations\[\]$", r"\.variables$"],
    "render": [r"^render_controllers$", r"^render_controllers\.\*\.arrays\.(textures|geometries|materials)$",
               r"\.part_visibility\[\]$", r"\.materials\[\]$", r"\.uv_anim\.(offset|scale)$"],
    "animation": [r"^animations$", r"^animations\.\*\.bones$", r"\.(rotation|position|scale)$", r"^animations\.\*\.(sound_effects|particle_effects|timeline)$",
                  r"\.(pre|post)$"],
    "particle": [r"^particle_effect\.curves$", r"^particle_effect\.events$", r"^particle_effect\.description\.basic_render_parameters$",
                 r"\.nodes$"],
    "fog": [],
}
# for user-named children we compare one level deeper too, but their own keys are not vocabulary
TIMESTAMP = re.compile(r"^-?\d+(\.\d+)?$")


def walk(node, path, kind, out):
    """Record the JSON type found at every normalised path."""
    t = jtype(node)
    out[path].add(t)
    wild = any(re.search(rx, path) for rx in WILD_PARENTS[kind])
    if isinstance(node, dict):
        for k, v in node.items():
            key = "*" if (wild or TIMESTAMP.match(k)) else k
            walk(v, f"{path}.{key}" if path else key, kind, out)
    elif isinstance(node, list):
        for v in node:
            walk(v, f"{path}[]", kind, out)


def strip_root(doc, kind):
    if kind == "client":
        for k, v in doc.items():
            if k.startswith("minecraft:client_entity"):
                return v
        return None
    return {k: v for k, v in doc.items() if k != "format_version"}


def kind_of(folder):
    return {"entity": "client", "animation_controllers": "controller", "render_controllers": "render",
            "animations": "animation", "particles": "particle", "fogs": "fog"}[folder]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", required=True, help="bedrock-samples/resource_pack directory")
    a = ap.parse_args()
    samples = pathlib.Path(a.samples)
    problems = []
    checked = 0
    for folder in ["entity", "animation_controllers", "render_controllers", "animations", "particles", "fogs"]:
        kind = kind_of(folder)
        vanilla = defaultdict(set)
        nvan = 0
        for f in sorted((samples / folder).rglob("*.json")):
            doc = load(f)
            body = strip_root(doc, kind) if isinstance(doc, dict) else None
            if body:
                walk(body, "", kind, vanilla)
                nvan += 1
        if nvan == 0:
            print(f"note: no vanilla {folder} found under {samples}; skipped")
            continue
        for f in sorted((RP / folder).rglob("*.json")):
            doc = load(f)
            body = strip_root(doc, kind) if isinstance(doc, dict) else None
            if not body:
                problems.append(f"{f.relative_to(ROOT)}: could not read")
                continue
            ours = defaultdict(set)
            walk(body, "", kind, ours)
            checked += 1
            for path, types in sorted(ours.items()):
                if path not in vanilla:
                    # unknown key: report only if its parent is known vocabulary (typos, wrong nesting)
                    parent = path.rsplit(".", 1)[0] if "." in path else ""
                    if parent in vanilla and not path.endswith("*") and "[]" not in path.rsplit(".", 1)[-1]:
                        problems.append(f"{f.relative_to(ROOT)}: `{path}` never appears in vanilla {folder}")
                    continue
                bad = types - vanilla[path]
                if bad:
                    problems.append(f"{f.relative_to(ROOT)}: `{path}` is {'/'.join(sorted(bad))}; vanilla uses {'/'.join(sorted(vanilla[path]))}")
        print(f"note: {folder}: compared with {nvan} vanilla files")
    for p in problems:
        print(" -", p)
    print(f"{checked} files checked, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
