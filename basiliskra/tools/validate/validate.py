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
            # No waivers.  The game parses a file by the schema of the format_version it declares: a timer
            # written as a bare number passed here once as 'what vanilla does' and failed to load in game
            # (vanilla files that do it are on older format versions).
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
            elif "minecraft:block" in d:
                if d.get("format_version") != "1.26.60":
                    err(f"{k}: block format_version {d.get('format_version')}: write 1.26.60, the schema it is checked against")
                check(k, "/server/block/1.26.60/Blocks.json", d["minecraft:block"])
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

# The game merges the locators of every geometry one client entity uses into a single set and keeps only the
# first definition of each name ("model already has a locator ... skipping new definition").  A name used by two
# of an entity's geometries must therefore be identical in both: same bone, same offset.
seen_loc = {}
for short, gid in ent.get("geometry", {}).items():
    g = geos.get(gid)
    if not g:
        continue
    for b in g["bones"].values():
        for ln, off in (b.get("locators") or {}).items():
            here = (b["name"], json.dumps(off if isinstance(off, list) else off.get("offset")))
            if ln in seen_loc and seen_loc[ln][1] != here:
                err(f"client entity: locator {ln} is defined differently in {seen_loc[ln][0]} and {gid}; the game keeps only the first")
            seen_loc.setdefault(ln, (gid, here))
            ok("locators (unique across the entity's geometries)")
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
    if imports != {"@minecraft/server", "@minecraft/server-ui"}:
        err(f"bundle imports {sorted(imports)}: only @minecraft/server and @minecraft/server-ui are allowed")
    if re.search(r"@minecraft/server-(gametest|net|admin|editor)", js):
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
vanilla_particles = set()
if have_schemas:
    for fn in os.listdir(os.path.join(SAMPLES, "resource_pack/particles")):
        try:
            d = json.load(open(os.path.join(SAMPLES, "resource_pack/particles", fn), encoding="utf-8-sig"))
            vanilla_particles.add(d["particle_effect"]["description"]["identifier"])
        except (ValueError, KeyError, TypeError):
            pass

for sid in sorted(set(re.findall(r'"(basiliskra\.[a-z0-9_.]+)"', src))):
    if sid not in sdefs:
        err(f"script plays {sid}: not in sound_definitions.json")
    ok("script sound references")
# sound ids the script builds at run time, and every id each can produce (read from the source by hand; checked here)
DYNAMIC_SOUNDS = {
    "`basiliskra.${": [f"basiliskra.{f}.{k}" for f in ("ii", "iii") for k in ("grunt", "breath", "growl")] + ["basiliskra.i.grunt", "basiliskra.i.breath"],
    "`basiliskra.geiger.${": [f"basiliskra.geiger.{n}" for n in (1, 2, 3, 4)],
    "`basiliskra.i.${": ["basiliskra.i.breath", "basiliskra.i.swim"],
}
for sid in sorted(set(re.findall(r'`basiliskra\.[a-z0-9_.]*\$\{', src))):
    if sid not in DYNAMIC_SOUNDS:
        err(f"script builds a sound id dynamically ({sid}...) that the validator does not know: list what it can produce")
        continue
    missing = [x for x in DYNAMIC_SOUNDS[sid] if x not in sdefs]
    if missing:
        err(f"script builds {sid}...: {', '.join(missing)} not in sound_definitions.json")
    ok("dynamic sound ids (every value checked)", len(DYNAMIC_SOUNDS[sid]))
for pid in sorted(set(re.findall(r'"(basiliskra:[a-z_]+)"', src))):
    if pid in (f"{NS}:{NS}", f"{NS}:hitbox", f"{NS}:keep", f"{NS}:shed_fin") or pid.startswith(f"{NS}:size_") or pid.startswith(f"{NS}:bind_"):
        continue
    if pid in props or pid in events:
        continue
    if any(isinstance(d, dict) and ("minecraft:block" in d or "minecraft:item" in d) and d[("minecraft:block" if "minecraft:block" in d else "minecraft:item")]["description"]["identifier"] == pid for d in docs.values()):
        continue                                        # one of the pack's own blocks or items
    if any(isinstance(d, dict) and "minecraft:block" in d and (pid in d["minecraft:block"]["description"].get("states", {}) or pid in d["minecraft:block"]["components"])
           for d in docs.values()):
        continue                                        # a state or a custom component of one of the pack's blocks
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
        if bid in vanilla_particles:
            ok("vanilla particle ids")
            continue
        if bid in ("minecraft:overworld", "minecraft:nether", "minecraft:the_end", "minecraft:player", "minecraft:item", "minecraft:free") or bid.split(":")[1] in (
                "health", "riding", "rideable", "equippable", "inventory", "item"):
            continue
        err(f"script names {bid}: not a block or entity id in 1.26.60")
# block id lists written without their namespace (src/havoc.ts: what the shockwave breaks): every one must exist
if vanilla_blocks:
    hv = open(os.path.join(ROOT, "src", "havoc.ts"), encoding="utf-8").read()
    for name, body in re.findall(r'const ([A-Z_]+_IDS) = \[(.*?)\]\.map', hv, re.S):
        for n in re.findall(r'"([a-z0-9_]+)"', body):
            if "minecraft:" + n not in vanilla_blocks:
                err(f"src/havoc.ts {name} names minecraft:{n}: not a block in 1.26.60")
            ok("vanilla block ids in shockwave lists")
# properties and events the script uses
item_ids = {d["minecraft:item"]["description"]["identifier"] for d in docs.values() if isinstance(d, dict) and "minecraft:item" in d}
block_ids = {d["minecraft:block"]["description"]["identifier"] for d in docs.values() if isinstance(d, dict) and "minecraft:block" in d}
item_ids |= block_ids                                   # every block has its own item
commands = set(re.findall(r'name: `\$\{NS\}:([a-z_]+)`', src)) | set(re.findall(r'registerEnum\(`\$\{NS\}:([a-z_]+)`', src))
for name in re.findall(r'`\$\{NS\}:([a-z_]+)`', src):
    pid = f"{NS}:{name}"
    if name in ("basiliskra", "hitbox", "hitbox_", "debug") or pid in item_ids or pid in block_ids or name in commands:
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
# the stable pair for 1.26.60 (bedrock-samples metadata: server_2.11.0, server-ui_2.3.0; the next of each is beta)
if sorted((d["module_name"], d["version"]) for d in deps) != [("@minecraft/server", "2.11.0"), ("@minecraft/server-ui", "2.3.0")]:
    err(f"BP manifest script dependencies are {deps}: expected @minecraft/server 2.11.0 and @minecraft/server-ui 2.3.0 (stable)")
for m, v in (("server", "2.11.0"), ("server-ui", "2.3.0")):
    if SAMPLES and not os.path.exists(os.path.join(SAMPLES, "metadata", "script_modules", "@minecraft", f"{m}_{v}.json")):
        err(f"@minecraft/{m} {v} is not a stable module of this game version")
if any("beta" in str(d.get("version", "")) for d in bm.get("dependencies", [])):
    err("BP manifest depends on a beta module")
if "pbr" not in docs.get("packs/RP/manifest.json", {}).get("capabilities", []):
    err("RP manifest: capability 'pbr' missing (Vibrant Visuals)")
if any(d.get("is_experimental") for d in [bp_ent.get("description", {})]):
    err("entity is marked experimental")
if os.path.isdir(os.path.join(BP, "spawn_rules")):
    err("the pack must not ship spawn rules")
# A spawn egg is wanted (it brings the one Basiliskra; the script keeps it to one), natural spawning is not:
# no spawn rules (checked above), and the hit volumes never get an egg.
if bp_ent.get("description", {}).get("is_spawnable") is True and "spawn_egg" not in ent:
    err("entity has a spawn egg but the client entity gives it no spawn_egg colours or texture")
# the hit volumes: one entity per size the script asks for, none spawnable, each with its client entity, and
# collision boxes that are exactly the script's SIZES table
sizes = [float(x) for x in re.search(r"export const SIZES = \[([^\]]+)\]", open(os.path.join(ROOT, "src", "creature.ts"), encoding="utf-8").read()).group(1).split(",")]
for i, size in enumerate(sizes):
    hb = docs.get(f"packs/BP/entities/basiliskra_hitbox_{i}.json", {}).get("minecraft:entity", {})
    if hb.get("description", {}).get("identifier") != f"{NS}:hitbox_{i}":
        err(f"hit volume entity {NS}:hitbox_{i} is missing")
        continue
    if hb["description"].get("is_spawnable") is not False:
        err(f"the hit volume entity hitbox_{i} must not be spawnable")
    box = hb.get("components", {}).get("minecraft:collision_box", {})
    if box.get("width") != size or box.get("height") != size:
        err(f"hitbox_{i}: collision box {box} is not the {size} the script expects")
    ce = docs.get(f"packs/RP/entity/basiliskra_hitbox_{i}.entity.json", {}).get("minecraft:client_entity", {}).get("description", {})
    if ce.get("identifier") != f"{NS}:hitbox_{i}":
        err(f"hitbox_{i} has no client entity")
    if f"{NS}_part" not in hb.get("components", {}).get("minecraft:type_family", {}).get("family", []):
        err(f"hitbox_{i} is not of the {NS}_part family the script looks for")
    ok("hit volume entities (fixed size each)")

# items: icon in the atlas with a texture behind it, a name in the language file
itex = docs.get("packs/RP/textures/item_texture.json", {}).get("texture_data", {})
rp_lang = open(os.path.join(RP, "texts", "en_US.lang"), encoding="utf-8").read()
for k, d in docs.items():
    if not (isinstance(d, dict) and "minecraft:item" in d):
        continue
    comps = d["minecraft:item"].get("components", {})
    icon = comps.get("minecraft:icon", {}).get("textures", {}).get("default")
    if icon not in itex:
        err(f"{k}: icon {icon} is not in item_texture.json")
    elif not tex_exists(itex[icon]["textures"]):
        err(f"{k}: icon texture {itex[icon]['textures']} missing")
    name_key = comps.get("minecraft:display_name", {}).get("value", "")
    if name_key and f"{name_key}=" not in rp_lang:
        err(f"{k}: display name {name_key} missing from RP en_US.lang")
    ok("items")
if "spawn_egg" in ent and f"item.spawn_egg.entity.{NS}:{NS}.name=" not in rp_lang:
    err("spawn egg name missing from RP en_US.lang")

vanilla_items = set()
if SAMPLES and os.path.exists(os.path.join(SAMPLES, "metadata/vanilladata_modules/mojang-items.json")):
    _vi = json.load(open(os.path.join(SAMPLES, "metadata/vanilladata_modules/mojang-items.json")))
    vanilla_items = {i["name"] for i in _vi.get("data_items", _vi.get("items", []))}
block_ids = {d["minecraft:block"]["description"]["identifier"] for d in docs.values() if isinstance(d, dict) and "minecraft:block" in d}
block_geos = set()
for k, d in docs.items():
    if k.startswith("packs/RP/models/blocks/") and isinstance(d, dict):
        for g in d.get("minecraft:geometry", []):
            block_geos.add(g["description"]["identifier"])
            for bone in g.get("bones", []):
                for cube in bone.get("cubes", []):
                    o, sz = cube["origin"], cube["size"]
                    if min(o[0], o[2]) < -15 or max(o[0] + sz[0], o[2] + sz[2]) > 15 or o[1] < -7 or o[1] + sz[1] > 23:
                        err(f"{k}: a cube leaves the 30x30x30 box a block model must stay inside")
# blocks: every material's texture is in the terrain atlas with a file and a Vibrant Visuals texture set behind it,
# a sound in blocks.json, a name in the language file, and the loot table it names exists
ttex = docs.get("packs/RP/textures/terrain_texture.json", {}).get("texture_data", {})
rp_blocks = docs.get("packs/RP/blocks.json", {})
for k, d in docs.items():
    if not (isinstance(d, dict) and "minecraft:block" in d):
        continue
    ident = d["minecraft:block"]["description"]["identifier"]
    comps = d["minecraft:block"].get("components", {})
    for face, mi in comps.get("minecraft:material_instances", {}).items():
        tex = mi if isinstance(mi, str) else mi.get("texture")
        if tex not in ttex:
            err(f"{k}: {face} texture {tex} is not in terrain_texture.json")
            continue
        path = ttex[tex]["textures"]
        if not tex_exists(path):
            err(f"{k}: texture {path} missing")
        if not os.path.exists(os.path.join(RP, path + ".texture_set.json")):
            err(f"{k}: no texture_set for {path} (Vibrant Visuals)")
    if ident not in rp_blocks or "sound" not in rp_blocks[ident]:
        err(f"{k}: {ident} has no sound in RP blocks.json")
    name_key = comps.get("minecraft:display_name", f"tile.{ident}.name")
    if f"{name_key}=" not in rp_lang:
        err(f"{k}: name {name_key} missing from RP en_US.lang")
    loot = comps.get("minecraft:loot")
    if loot and not os.path.exists(os.path.join(BP, loot)):
        err(f"{k}: loot table {loot} missing")
    elif loot:
        for pool in json.load(open(os.path.join(BP, loot))).get("pools", []):
            for e in pool.get("entries", []):
                if e.get("type") == "item" and e["name"] not in item_ids and e["name"] not in block_ids and vanilla_items and e["name"] not in vanilla_items:
                    err(f"{loot}: unknown item {e['name']}")
    # a model of its own must be in the resource pack; a component of the pack's own must be registered by the script
    geo = comps.get("minecraft:geometry")
    geo = geo.get("identifier") if isinstance(geo, dict) else geo
    if geo and not geo.startswith("minecraft:") and geo not in block_geos:
        err(f"{k}: geometry {geo} is not in the resource pack's models/blocks")
    for c in comps:
        if not c.startswith("minecraft:") and (f'"{c}"' not in js or "registerCustomComponent" not in js):
            err(f"{k}: custom component {c} is never registered by the script")
    for state, spec in d["minecraft:block"]["description"].get("states", {}).items():
        v = spec.get("values") if isinstance(spec, dict) else spec
        n = (v["max"] - v["min"] + 1) if isinstance(v, dict) else len(v)
        if n > 16:
            err(f"{k}: state {state} has {n} values (16 at most)")
    ok("blocks")

# fogs the script pushes exist
for fid in sorted(set(re.findall(r"fog @s push (basiliskra:[a-z_]+)", src))):
    if not any(isinstance(d, dict) and d.get("minecraft:fog_settings", {}).get("description", {}).get("identifier") == fid for d in docs.values()):
        err(f"script pushes fog {fid}: no such fog in the resource pack")
    ok("fogs")

# recipes: the vanilla 1.20.10 shapeless shape, and every item they name exists
vanilla_items = set()
if SAMPLES and os.path.exists(os.path.join(SAMPLES, "metadata/vanilladata_modules/mojang-items.json")):
    vi = json.load(open(os.path.join(SAMPLES, "metadata/vanilladata_modules/mojang-items.json")))
    vanilla_items = {i["name"] for i in vi.get("data_items", vi.get("items", []))}
for k, d in docs.items():
    if not (isinstance(d, dict) and ("minecraft:recipe_shapeless" in d or "minecraft:recipe_shaped" in d)):
        continue
    shaped = "minecraft:recipe_shaped" in d
    r = d["minecraft:recipe_shaped" if shaped else "minecraft:recipe_shapeless"]
    if d.get("format_version") != "1.20.10" or r.get("tags") != ["crafting_table"] or not r.get("unlock"):
        err(f"{k}: not in the vanilla 1.20.10 form (format_version, crafting_table tag, unlock)")
    if shaped:
        used = set("".join(r.get("pattern", []))) - {" "}
        if used != set(r.get("key", {})) or len({len(row) for row in r.get("pattern", [])}) != 1:
            err(f"{k}: the pattern and its key do not match")
        names = [v["item"] for v in r.get("key", {}).values()]
    else:
        names = [i["item"] for i in r.get("ingredients", [])]
    for it in names + [u["item"] for u in r.get("unlock", [])] + [r.get("result", {}).get("item", "")]:
        if it not in item_ids and it not in block_ids and vanilla_items and it not in vanilla_items:
            err(f"{k}: unknown item {it}")
    ok("recipes")

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
