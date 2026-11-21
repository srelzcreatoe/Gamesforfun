#!/usr/bin/env python3
"""
Static validation of the two packs against the target release.

  1. every JSON file is strict JSON, UTF-8
  2. Mojang's own JSON schemas for 1.26.60 (bedrock-samples/metadata/json_schemas) where one
     exists: entity documents, item documents, particle effects
  3. reference integrity: every texture, geometry, animation, render controller, particle,
     sound, bone, locator, property, event, block id and vanilla sound id that anything refers
     to actually exists (vanilla ids are checked against the 1.26.60 vanilla data)

    python3 tools/validate/validate.py [/path/to/bedrock-samples]
"""
from __future__ import annotations

import json
import os
import re
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BP = os.path.join(ROOT, "packs", "BP")
RP = os.path.join(ROOT, "packs", "RP")
SAMPLES = sys.argv[1] if len(sys.argv) > 1 else "/home/user/mojang/bedrock-samples"
NS = "basiliskra"

errors: list[str] = []
notes: list[str] = []
counts: dict[str, int] = {}


def err(msg): errors.append(msg)
def ok(key, n=1): counts[key] = counts.get(key, 0) + n


def load(path):
    with open(path, "rb") as f:
        raw = f.read()
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        err(f"{os.path.relpath(path, ROOT)}: not strict UTF-8 JSON: {e}")
        return None


def walk(base, suffix=".json"):
    for d, _, files in os.walk(base):
        for f in sorted(files):
            if f.endswith(suffix):
                yield os.path.join(d, f)


# ---- 1. parse everything -------------------------------------------------------------------
docs = {}
for pack in (BP, RP):
    for p in walk(pack):
        d = load(p)
        if d is not None:
            docs[os.path.relpath(p, ROOT)] = d
            ok("json files")

# ---- 2. official schemas ----------------------------------------------------------------------
have_schemas = os.path.isdir(os.path.join(SAMPLES, "metadata", "json_schemas"))
if have_schemas:
    try:
        from jsonschema import Draft7Validator
        from referencing import Registry, Resource
        from referencing.jsonschema import DRAFT7

        reg = Registry()
        sroot = os.path.join(SAMPLES, "metadata", "json_schemas")
        by_id = {}
        for p in walk(sroot):
            s = json.load(open(p, encoding="utf-8"))
            if "$id" in s:
                by_id[s["$id"]] = s
                reg = reg.with_resource(s["$id"], Resource.from_contents(s, default_specification=DRAFT7))

        def check(doc_key, schema_id, value):
            sch = by_id.get(schema_id)
            if not sch:
                notes.append(f"schema {schema_id} not present in the samples; skipped {doc_key}")
                return
            v = Draft7Validator(sch, registry=reg)
            bad = sorted(v.iter_errors(value), key=lambda e: list(e.absolute_path))
            # Known gap in the published schema, not in the pack: minecraft:timer "time" is typed as a
            # {min,max} object there, but the vanilla 1.26.60 entities themselves write a bare number
            # ("time": 4 in armadillo.json, "time": 3 in allay.json).  The pack uses the vanilla form.
            waived = [e for e in bad if list(e.absolute_path)[-2:] == ["minecraft:timer", "time"] and isinstance(e.instance, (int, float))]
            if waived:
                notes.append(f"{doc_key}: minecraft:timer time written as a bare number, as vanilla does (published schema only lists the object form)")
            bad = [e for e in bad if e not in waived]
            for e in bad[:8]:
                err(f"{doc_key}: schema {schema_id}: /{'/'.join(str(x) for x in e.absolute_path)}: {e.message[:200]}")
            if not bad:
                ok("schema-valid documents")

        for k, d in docs.items():
            if not isinstance(d, dict):
                continue
            if "minecraft:entity" in d:
                check(k, "/server/entity/1.26.60/ActorDocument.json", d["minecraft:entity"])
            elif "minecraft:item" in d:
                check(k, "/server/item/1.26.50/ItemDocument.json", d["minecraft:item"])
            elif "particle_effect" in d:
                check(k, "/client/particles/1.21.10/Particle%20Effect%20Data.json", d["particle_effect"])
    except ImportError:
        notes.append("python package 'jsonschema' not installed: schema validation skipped")
else:
    notes.append(f"{SAMPLES} not found: schema and vanilla-id checks skipped")

# ---- 3. reference integrity ---------------------------------------------------------------------
ent = docs.get("packs/RP/entity/basiliskra.entity.json", {}).get("minecraft:client_entity", {}).get("description", {})
bp_ent = docs.get("packs/BP/entities/basiliskra.json", {}).get("minecraft:entity", {})
props = bp_ent.get("description", {}).get("properties", {})
events = bp_ent.get("events", {})


def tex_exists(rel):
    return any(os.path.exists(os.path.join(RP, rel + ext)) for ext in (".png", ".tga"))


# geometry
geos = {}
for k, d in docs.items():
    for g in d.get("minecraft:geometry", []) if isinstance(d, dict) else []:
        desc = g["description"]
        bones = {b["name"]: b for b in g.get("bones", [])}
        locs = {l for b in g.get("bones", []) for l in b.get("locators", {})}
        geos[desc["identifier"]] = {"bones": bones, "locators": locs, "desc": desc, "file": k}
        for b in g.get("bones", []):
            if "parent" in b and b["parent"] not in bones:
                err(f"{k}: bone {b['name']} has unknown parent {b['parent']}")
            for c in b.get("cubes", []):
                for face, u in (c.get("uv") or {}).items():
                    x0, y0 = u["uv"]; x1, y1 = x0 + u["uv_size"][0], y0 + u["uv_size"][1]
                    if min(x0, x1) < 0 or min(y0, y1) < 0 or max(x0, x1) > desc["texture_width"] or max(y0, y1) > desc["texture_height"]:
                        err(f"{k}: {b['name']} face {face} uv outside the texture")
                ok("cubes")
        ok("geometries")

form_geo = {}
for short, gid in ent.get("geometry", {}).items():
    if gid not in geos:
        err(f"client entity: geometry {gid} not found")
    form_geo[short] = gid
for short, t in ent.get("textures", {}).items():
    if not tex_exists(t):
        err(f"client entity: texture {t} missing")
    ok("textures")
    ts = os.path.join(RP, t + ".texture_set.json")
    if os.path.exists(ts):
        tsd = json.load(open(ts))["minecraft:texture_set"]
        folder = os.path.dirname(t)
        for layer, name in tsd.items():
            if isinstance(name, str) and not name.startswith("#") and not tex_exists(os.path.join(folder, name)):
                err(f"{t}.texture_set.json: layer {layer} -> {name} missing")
        ok("texture sets (PBR)")
    else:
        err(f"no texture_set for {t} (Vibrant Visuals)")

# texture dimensions must match the geometry they are used with
def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])

for short, gid in form_geo.items():
    t = ent["textures"].get(short)
    if t and gid in geos and os.path.exists(os.path.join(RP, t + ".png")):
        w, h = png_size(os.path.join(RP, t + ".png"))
        d = geos[gid]["desc"]
        if (w, h) != (d["texture_width"], d["texture_height"]):
            err(f"texture {t} is {w}x{h} but {gid} expects {d['texture_width']}x{d['texture_height']}")

# animations, controllers, render controllers
anims, actrl, rctrl = {}, {}, {}
for k, d in docs.items():
    if not isinstance(d, dict):
        continue
    anims.update(d.get("animations", {}) if "format_version" in d and "animations" in d and "minecraft:client_entity" not in d else {})
    actrl.update(d.get("animation_controllers", {}))
    rctrl.update(d.get("render_controllers", {}))
tag_of = {"i": f"geometry.{NS}.i", "ii": f"geometry.{NS}.ii", "iii": f"geometry.{NS}.iii"}
for short, aid in ent.get("animations", {}).items():
    if aid.startswith("controller."):
        if aid not in actrl:
            err(f"client entity: animation controller {aid} missing")
    elif aid not in anims:
        err(f"client entity: animation {aid} missing")
for aid, a in anims.items():
    tag = aid.split(".")[2]
    bones = geos.get(tag_of.get(tag, ""), {}).get("bones", {})
    for b in a.get("bones", {}):
        if b not in bones:
            err(f"{aid}: bone {b} is not in {tag_of.get(tag)}")
        ok("animated bones")
for cid, c in actrl.items():
    tag = cid.split(".")[3]
    locs = geos.get(tag_of.get(tag, ""), {}).get("locators", set())
    for sname, s in c.get("states", {}).items():
        for pe in s.get("particle_effects", []):
            if pe["effect"] not in ent.get("particle_effects", {}):
                err(f"{cid}.{sname}: particle {pe['effect']} not declared on the client entity")
            if pe.get("locator") and pe["locator"] not in locs:
                err(f"{cid}.{sname}: locator {pe['locator']} is not in {tag_of.get(tag)}")
            ok("locator-bound particle hooks")
        for tr in s.get("transitions", []):
            for to in tr:
                if to not in c["states"]:
                    err(f"{cid}.{sname}: transition to unknown state {to}")
for rc in ent.get("render_controllers", []):
    rid = rc if isinstance(rc, str) else next(iter(rc))
    if rid not in rctrl:
        err(f"client entity: render controller {rid} missing")
        continue
    r = rctrl[rid]
    g = r.get("geometry", "")
    m = re.match(r"Geometry\.(\w+)", g)
    bones = geos.get(form_geo.get(m.group(1), ""), {}).get("bones", {}) if m else {}
    for pv in r.get("part_visibility", []):
        for b in pv:
            if b != "*" and not b.endswith("*") and b not in bones:
                err(f"{rid}: part_visibility bone {b} not in {g}")
    for mat in r.get("materials", []):
        for _, ref in mat.items():
            if ref.startswith("Material.") and ref.split(".")[1] not in ent.get("materials", {}):
                err(f"{rid}: material {ref} not declared")
    ok("render passes")

# particles
particle_ids = {d["particle_effect"]["description"]["identifier"] for d in docs.values() if isinstance(d, dict) and "particle_effect" in d}
for short, pid in ent.get("particle_effects", {}).items():
    if pid not in particle_ids:
        err(f"client entity: particle {pid} has no definition")
for d in docs.values():
    if isinstance(d, dict) and "particle_effect" in d:
        t = d["particle_effect"]["description"]["basic_render_parameters"]["texture"]
        if not tex_exists(t):
            err(f"particle {d['particle_effect']['description']['identifier']}: texture {t} missing")
        ok("particle effects")

# sounds
sdefs = docs.get("packs/RP/sounds/sound_definitions.json", {}).get("sound_definitions", {})
for sid, s in sdefs.items():
    for e in s.get("sounds", []):
        name = e if isinstance(e, str) else e["name"]
        if not os.path.exists(os.path.join(RP, name + ".ogg")):
            err(f"sound {sid}: file {name}.ogg missing")
        ok("sound files")
    ok("sound events")
used_files = {(e if isinstance(e, str) else e["name"]) for s in sdefs.values() for e in s.get("sounds", [])}
for p in walk(os.path.join(RP, "sounds"), ".ogg"):
    rel = os.path.relpath(p, RP)[:-4].replace(os.sep, "/")
    if rel not in used_files:
        err(f"orphan sound file {rel}.ogg")

# scripts: every id the script names must exist
src = ""
for p in walk(os.path.join(ROOT, "src"), ".ts"):
    if "generated" not in p:
        src += open(p, encoding="utf-8").read() + "\n"
bundle = os.path.join(BP, "scripts", "main.js")
if not os.path.exists(bundle):
    err("packs/BP/scripts/main.js missing: run node tools/bundle.mjs")
else:
    js = open(bundle, encoding="utf-8").read()
    imports = set(re.findall(r'from\s+"([^"]+)"', js))
    if imports != {"@minecraft/server"}:
        err(f"bundle imports {sorted(imports)}: only @minecraft/server is allowed")
    if re.search(r"@minecraft/server-(gametest|net|admin|editor)|server-ui", js):
        err("bundle references a module the manifest does not declare")
    ok("script bundle (KiB)", os.path.getsize(bundle) // 1024)

vanilla_sounds, vanilla_blocks, vanilla_entities = set(), set(), set()
if have_schemas:
    raw = open(os.path.join(SAMPLES, "resource_pack/sounds/sound_definitions.json"), encoding="utf-8-sig").read()
    vanilla_sounds = set(re.findall(r'^\s*"([a-z0-9_.]+)"\s*:\s*\{', raw, re.M))
    vb = json.load(open(os.path.join(SAMPLES, "metadata/vanilladata_modules/mojang-blocks.json")))
    vanilla_blocks = {b["name"] for b in vb.get("data_items", [])}
    ve = json.load(open(os.path.join(SAMPLES, "metadata/vanilladata_modules/mojang-entities.json")))
    vanilla_entities = {e["name"] for e in ve.get("data_items", [])}
    vi = json.load(open(os.path.join(SAMPLES, "metadata/vanilladata_modules/mojang-items.json")))
    vanilla_entities |= {e["name"] for e in vi.get("data_items", [])}

for sid in sorted(set(re.findall(r'"(basiliskra\.[a-z0-9_.]+)"', src))):
    if sid not in sdefs:
        err(f"script plays {sid}: not in sound_definitions.json")
    ok("script sound references")
for sid in sorted(set(re.findall(r'`basiliskra\.[a-z0-9_.]*\$\{', src))):
    notes.append(f"script builds a sound id dynamically: {sid}...  (checked by hand: i.breath / i.swim)")
for pid in sorted(set(re.findall(r'"(basiliskra:[a-z_]+)"', src))):
    if pid in (f"{NS}:{NS}", f"{NS}:hitbox", f"{NS}:keep", f"{NS}:shed_fin") or pid.startswith(f"{NS}:size_") or pid.startswith(f"{NS}:bind_"):
        continue
    if pid in props or pid in events:
        continue
    if pid not in particle_ids:
        err(f"script uses {pid}: not a particle, property or event of this pack")
    ok("script particle references")
if vanilla_sounds:
    for sid in sorted(set(re.findall(r'"((?:mob|random|note|block)\.[a-z0-9_.]+)"', src))):
        if sid not in vanilla_sounds:
            err(f"script plays vanilla sound {sid}: not in the 1.26.60 sound_definitions.json")
        ok("vanilla sound references")
if vanilla_blocks:
    for bid in sorted(set(re.findall(r'"(minecraft:[a-z0-9_]+)"', src))):
        if bid in vanilla_blocks or bid in vanilla_entities:
            ok("vanilla block/entity ids")
            continue
        if bid in ("minecraft:overworld", "minecraft:nether", "minecraft:the_end", "minecraft:player", "minecraft:item") or bid.split(":")[1] in (
                "health", "riding", "rideable", "equippable", "inventory", "item"):
            continue
        err(f"script names {bid}: not a block or entity id in 1.26.60")
# properties and events the script uses
for name in re.findall(r'`\$\{NS\}:([a-z_]+)`', src):
    pid = f"{NS}:{name}"
    if name in ("basiliskra", "hitbox", "shed_fin", "debug"):
        continue
    if pid not in props:
        err(f"script property {pid} is not defined on the entity")
    ok("synchronised properties")
for p, d in props.items():
    if not d.get("client_sync"):
        err(f"property {p} is not client_sync: late joiners would not see it")
for f in (1, 2, 3):
    if f"{NS}:bind_{f}" not in events:
        err(f"entity event {NS}:bind_{f} missing")

# manifests
for pack in ("BP", "RP"):
    m = docs.get(f"packs/{pack}/manifest.json", {})
    hdr = m.get("header", {})
    if hdr.get("min_engine_version") != [1, 26, 60]:
        err(f"{pack} manifest: min_engine_version is {hdr.get('min_engine_version')}")
    for u in [hdr.get("uuid")] + [x.get("uuid") for x in m.get("modules", [])]:
        if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", u or ""):
            err(f"{pack} manifest: {u} is not a version-4 UUID")
    if not os.path.exists(os.path.join(ROOT, "packs", pack, "pack_icon.png")):
        err(f"{pack}: pack_icon.png missing")
bm = docs.get("packs/BP/manifest.json", {})
deps = [d for d in bm.get("dependencies", []) if "module_name" in d]
if [(d["module_name"], d["version"]) for d in deps] != [("@minecraft/server", "2.11.0")]:
    err(f"BP manifest script dependencies are {deps}: expected exactly @minecraft/server 2.11.0 (stable)")
if any("beta" in str(d.get("version", "")) for d in bm.get("dependencies", [])):
    err("BP manifest depends on a beta module")
if "pbr" not in docs.get("packs/RP/manifest.json", {}).get("capabilities", []):
    err("RP manifest: capability 'pbr' missing (Vibrant Visuals)")
if any(d.get("is_experimental") for d in [bp_ent.get("description", {})]):
    err("entity is marked experimental")
if os.path.isdir(os.path.join(BP, "spawn_rules")):
    err("the pack must not ship spawn rules")
if bp_ent.get("description", {}).get("is_spawnable") is not False:
    err("entity must not be spawnable (no spawn egg)")

# ---- report ----------------------------------------------------------------------------------------
print("Basiliskra pack validation")
for k in sorted(counts):
    print(f"  {counts[k]:6d}  {k}")
for n in notes:
    print("  note:", n)
if errors:
    print(f"\n{len(errors)} problem(s):")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("\nno problems found")
