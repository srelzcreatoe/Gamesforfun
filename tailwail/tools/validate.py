#!/usr/bin/env python3
"""Static validation for the Tailwail packs.  Exit code 0 = all checks passed.

  python3 -I tools/validate.py [--tsc-types DIR]

--tsc-types: folder containing node_modules/@minecraft/{server,server-ui,common}
(npm install @minecraft/server@2.11.0 @minecraft/server-ui@2.3.0) to also type-check
every script against the stable typings with the TypeScript compiler (npx tsc).
"""
import argparse
import glob
import hashlib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BP = os.path.join(ROOT, "packs", "TailwailBP")
RP = os.path.join(ROOT, "packs", "TailwailRP")
STABLE = {"@minecraft/server": "2.11.0", "@minecraft/server-ui": "2.3.0"}
ENGINE = [1, 26, 60]
ORIGINAL_SHA = "04ce682fded20f7981ed52d98c5b38517203a65f0481ad562380e914fa560d4e"

errors = []
notes = []


def err(msg):
    errors.append(msg)


def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:  # noqa: BLE001
        err("JSON %s: %s" % (os.path.relpath(path, ROOT), e))
        return None


def check_json():
    n = 0
    for base in (BP, RP):
        for p in glob.glob(os.path.join(base, "**", "*.json"), recursive=True):
            load(p)
            n += 1
    notes.append("parsed %d JSON files" % n)


def check_manifests():
    bp = load(os.path.join(BP, "manifest.json"))
    rp = load(os.path.join(RP, "manifest.json"))
    uuids = []
    for name, m in (("BP", bp), ("RP", rp)):
        if m["format_version"] != 2:
            err("%s manifest format_version must be 2 (v3 is preview)" % name)
        if m["header"]["min_engine_version"] != ENGINE:
            err("%s min_engine_version %s != %s" % (name, m["header"]["min_engine_version"], ENGINE))
        uuids.append(m["header"]["uuid"])
        uuids += [mod["uuid"] for mod in m["modules"]]
        if "capabilities" in m:
            err("%s manifest declares capabilities (experimental features are not allowed)" % name)
    if len(set(uuids)) != len(uuids):
        err("duplicate UUIDs in manifests")
    for u in uuids:
        if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", u):
            err("invalid uuid %s" % u)
    deps = {d.get("module_name") or d.get("uuid"): d["version"] for d in bp["dependencies"]}
    if deps.get(rp["header"]["uuid"]) != rp["header"]["version"]:
        err("BP must depend on RP uuid/version")
    if {d["uuid"]: d["version"] for d in rp["dependencies"]}.get(bp["header"]["uuid"]) != bp["header"]["version"]:
        err("RP must depend on BP uuid/version")
    for mod, ver in STABLE.items():
        if deps.get(mod) != ver:
            err("BP must pin %s %s (got %s)" % (mod, ver, deps.get(mod)))
    for mod, ver in deps.items():
        if isinstance(ver, str) and re.search(r"beta|rc|preview|internal", ver):
            err("non-stable module version %s %s" % (mod, ver))
    notes.append("manifests: engine %s, modules %s" % (ENGINE, STABLE))


def scripts():
    return sorted(glob.glob(os.path.join(BP, "scripts", "**", "*.js"), recursive=True))


def check_scripts(tsc_types):
    for p in scripts():
        src = open(p, encoding="utf-8").read()
        for spec in re.findall(r'^\s*import[^;]*?from\s+"([^"]+)"', src, re.M | re.S) + re.findall(r'^\s*import\s+"([^"]+)"', src, re.M):
            if spec.startswith("."):
                target = os.path.normpath(os.path.join(os.path.dirname(p), spec))
                if not os.path.isfile(target):
                    err("%s imports missing %s" % (os.path.relpath(p, ROOT), spec))
            elif spec not in STABLE:
                err("%s imports non-stable/unknown module %s" % (os.path.relpath(p, ROOT), spec))
        r = subprocess.run(["node", "--check", p], capture_output=True, text=True)
        if r.returncode:
            err("node --check %s: %s" % (os.path.relpath(p, ROOT), r.stderr.strip()[:300]))
    if tsc_types:
        mods = os.path.join(tsc_types, "node_modules", "@minecraft")
        cfg = {
            "compilerOptions": {"allowJs": True, "checkJs": True, "noEmit": True, "target": "es2022", "module": "esnext",
                                "moduleResolution": "bundler", "skipLibCheck": True, "types": [],
                                "strict": False, "noImplicitAny": False,
                                "paths": {"@minecraft/server": [os.path.join(mods, "server", "index.d.ts")],
                                          "@minecraft/server-ui": [os.path.join(mods, "server-ui", "index.d.ts")],
                                          "@minecraft/common": [os.path.join(mods, "common", "index.d.ts")]}},
            "include": [os.path.join(BP, "scripts", "**", "*.js")]}
        cfg_path = os.path.join(ROOT, "build", "tsconfig.validate.json")
        os.makedirs(os.path.dirname(cfg_path), exist_ok=True)
        json.dump(cfg, open(cfg_path, "w"))
        r = subprocess.run(["npx", "--no-install", "tsc", "-p", cfg_path], capture_output=True, text=True)
        if r.returncode:
            err("tsc against stable typings failed:\n" + r.stdout[-2000:])
        else:
            notes.append("tsc: scripts type-check against %s" % mods)
    notes.append("checked %d script files" % len(scripts()))


def entity_bp():
    return load(os.path.join(BP, "entities", "tall_wail.json"))["minecraft:entity"]


def check_entities():
    ids = {}
    for p in glob.glob(os.path.join(BP, "entities", "*.json")):
        e = load(p)["minecraft:entity"]
        ident = e["description"]["identifier"]
        ids[ident] = e
        if not ident.startswith("tailwail:"):
            err("entity outside tailwail namespace: " + ident)
        groups = set(e.get("component_groups", {}))
        for ev, body in e.get("events", {}).items():
            for op in ("add", "remove"):
                for g in body.get(op, {}).get("component_groups", []):
                    if g not in groups:
                        err("%s event %s references missing group %s" % (ident, ev, g))
        props = e["description"].get("properties", {})
        if len(props) > 32:
            err("%s has %d properties (> 32)" % (ident, len(props)))
        for k, v in props.items():
            if v["type"] == "enum" and len(v["values"]) > 16:
                err("%s enum %s has > 16 values" % (ident, k))
    # script -> entity events and properties
    tw = ids["tailwail:tall_wail"]
    lure = ids["tailwail:lure"]
    events = set(tw["events"]) | set(lure["events"])
    props = tw["description"]["properties"]
    allsrc = "\n".join(open(p, encoding="utf-8").read() for p in scripts())
    for m in re.findall(r'triggerEvent\("([^"]+)"(?:\s*\+\s*[^)]+)?\)', allsrc):
        if m.endswith("_"):
            for suffix in ("a", "b", "c", "tall", "hunch", "crawl"):
                if m + suffix in events:
                    break
            else:
                err("triggerEvent prefix %s matches no event" % m)
        elif m not in events:
            err("script triggers unknown event %s" % m)
    for name, value in re.findall(r'set(?:Prop|Property)\("(tailwail:[a-z_]+)",\s*"([a-z_]+)"\)', allsrc):
        pdef = props.get(name)
        if not pdef:
            err("script sets unknown property %s" % name)
        elif pdef["type"] == "enum" and value not in pdef["values"]:
            err("script sets %s to invalid enum value %s" % (name, value))
    for name in set(re.findall(r'"(tailwail:[a-z_]+)"', allsrc)):
        if name.split(":")[1] in ("tall_wail", "lure", "field_guide", "debug", "guide", "settings", "debug_op",
                                  "settings", "prefs", "mem", "sched", "enc", "owner"):
            continue
        if name in props or name in events or name in ("tailwail:seek_", "tailwail:slot_", "tailwail:posture_"):
            continue
        err("script references unknown identifier %s" % name)
    notes.append("entities: %d properties, %d events checked" % (len(props), len(events)))
    return tw


def anim_files():
    out = {}
    for p in glob.glob(os.path.join(RP, "animations", "*.json")):
        out.update(load(p)["animations"])
    return out


def check_client(tw_bp):
    ce = load(os.path.join(RP, "entity", "tall_wail.entity.json"))["minecraft:client_entity"]["description"]
    geos = {}
    for p in glob.glob(os.path.join(RP, "models", "entity", "*.json")):
        for g in load(p)["minecraft:geometry"]:
            geos[g["description"]["identifier"]] = g
    for k, gid in ce["geometry"].items():
        if gid not in geos:
            err("client geometry %s missing" % gid)
    for k, tex in ce["textures"].items():
        if not os.path.isfile(os.path.join(RP, tex + ".png")):
            err("texture missing: " + tex)
    rcs = load(os.path.join(RP, "render_controllers", "tall_wail.render_controllers.json"))["render_controllers"]
    for rc in ce["render_controllers"]:
        if rc not in rcs:
            err("render controller missing " + rc)
    anims = anim_files()
    acs = load(os.path.join(RP, "animation_controllers", "tall_wail.animation_controllers.json"))["animation_controllers"]
    amap = ce["animations"]
    for short, full in amap.items():
        if full not in anims and full not in acs:
            err("client animation %s -> %s missing" % (short, full))
    for cname, c in acs.items():
        for sname, st in c["states"].items():
            for a in st.get("animations", []):
                key = a if isinstance(a, str) else list(a)[0]
                if key not in amap:
                    err("controller %s state %s uses unmapped animation %s" % (cname, sname, key))
            for tr in st.get("transitions", []):
                for target in tr:
                    if target not in c["states"]:
                        err("controller %s transition to missing state %s" % (cname, target))
    for a in ce["scripts"]["animate"]:
        key = a if isinstance(a, str) else list(a)[0]
        if key not in amap:
            err("animate entry %s unmapped" % key)
    # bones
    bones = {b["name"] for b in geos["geometry.tall_wail"]["bones"]}
    for name, a in anims.items():
        for b in a.get("bones", {}):
            if b not in bones:
                err("%s animates unknown bone %s" % (name, b))
    # Molang variables: every v.* read must be written by the client entity scripts
    script_text = " ".join(ce["scripts"]["initialize"] + ce["scripts"]["pre_animation"])
    written = set(re.findall(r"\bv\.([a-z_0-9]+)\s*=(?!=)", script_text))
    blob = json.dumps(anims) + json.dumps(acs) + script_text
    read = set(re.findall(r"\b(?:v|variable)\.([a-z_0-9]+)", blob))
    for v in sorted(read - written):
        err("Molang variable v.%s is read but never initialised by the client entity" % v)
    initialized = set(re.findall(r"\bv\.([a-z_0-9]+)\s*=(?!=)", " ".join(ce["scripts"]["initialize"])))
    for v in ("walk", "move", "look_x", "look_y", "jaw", "crawl", "climb_t"):
        if v not in initialized:
            err("supplied clip variable v.%s is not initialised" % v)
    # entity properties used by Molang exist, are synced, and compare against real enum values
    props = tw_bp["description"]["properties"]
    for name, val in re.findall(r"q(?:uery)?\.property\('(tailwail:[a-z_]+)'\)\s*[=!]=\s*'([a-z_]+)'", blob):
        p = props.get(name)
        if not p:
            err("Molang reads unknown property %s" % name)
        elif not p.get("client_sync"):
            err("property %s read on client but not client_sync" % name)
        elif p["type"] == "enum" and val not in p["values"]:
            err("Molang compares %s with unknown value %s" % (name, val))
    for name in set(re.findall(r"q(?:uery)?\.property\('(tailwail:[a-z_]+)'\)", blob)):
        if name not in props:
            err("Molang reads unknown property %s" % name)
    notes.append("client: %d animations, %d controllers, %d bones, v.* written %d / read %d" %
                 (len(anims), len(acs), len(bones), len(written), len(read)))
    return anims


def check_clip_lengths(anims):
    cfg = open(os.path.join(BP, "scripts", "config.js"), encoding="utf-8").read()
    want = {"unfold": "reveal", "windup": "windup", "strike": "tw_strike", "unfoldLow": "tw_unfold_low",
            "ambush": "ambush", "peek": "peek_left", "death": "death"}
    for key, clip in want.items():
        m = re.search(r"\b%s:\s*([0-9.]+)" % key, cfg[cfg.index("export const CLIP"):])
        length = anims["animation.tall_wail." + clip]["animation_length"]
        if not m or abs(float(m.group(1)) - length) > 1e-6:
            err("CLIP.%s (%s) does not match %s length %s" % (key, m and m.group(1), clip, length))
    notes.append("clip lengths agree with config.js")


def check_sounds():
    sd = load(os.path.join(RP, "sounds", "sound_definitions.json"))["sound_definitions"]
    for name, d in sd.items():
        if not name.startswith("tailwail."):
            err("sound outside namespace " + name)
        for s in d["sounds"]:
            path = s["name"] if isinstance(s, dict) else s
            if not os.path.isfile(os.path.join(RP, path + ".ogg")):
                err("sound file missing " + path)
    rules = open(os.path.join(BP, "scripts", "core", "audio_rules.js"), encoding="utf-8").read()
    for sid in re.findall(r'sound:\s*"([^"]+)"', rules):
        if sid not in sd:
            err("cue uses undefined sound " + sid)
    lang = open(os.path.join(RP, "texts", "en_US.lang"), encoding="utf-8").read()
    for d in sd.values():
        if d.get("subtitle") and d["subtitle"] + "=" not in lang:
            err("missing subtitle text " + d["subtitle"])
    notes.append("sounds: %d events, all files present" % len(sd))


def check_items_and_text():
    it = load(os.path.join(RP, "textures", "item_texture.json"))["texture_data"]
    for k, v in it.items():
        if not os.path.isfile(os.path.join(RP, v["textures"] + ".png")):
            err("item texture missing " + v["textures"])
    item = load(os.path.join(BP, "items", "field_guide.json"))["minecraft:item"]["components"]
    if item["minecraft:icon"] not in it:
        err("field guide icon not in item_texture.json")
    ce = load(os.path.join(RP, "entity", "tall_wail.entity.json"))["minecraft:client_entity"]["description"]
    if ce["spawn_egg"]["texture"] not in it:
        err("spawn egg texture not in item_texture.json")
    lang = open(os.path.join(RP, "texts", "en_US.lang"), encoding="utf-8").read()
    for key in ("entity.tailwail:tall_wail.name", "item.spawn_egg.entity.tailwail:tall_wail.name", item["minecraft:display_name"]["value"]):
        if key + "=" not in lang:
            err("missing lang key " + key)
    for base in (BP, RP):
        if not os.path.isfile(os.path.join(base, "pack_icon.png")):
            err("missing pack_icon.png in " + os.path.basename(base))


def check_no_experiments():
    for p in glob.glob(os.path.join(ROOT, "packs", "**", "*"), recursive=True):
        if os.path.isfile(p) and p.endswith((".json", ".js", ".lang")):
            t = open(p, encoding="utf-8").read()
            if re.search(r"experimental|@minecraft/server-gametest|@minecraft/server-net|@minecraft/server-admin|beta_apis", t, re.I):
                if p.endswith("ui.js") and "less tested" in t and "experimental" not in t.lower():
                    continue
                err("experiment/beta reference in %s" % os.path.relpath(p, ROOT))


def check_generated():
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "build_assets.py"), "--check"], capture_output=True, text=True)
    if r.returncode:
        err("generated assets out of date: " + (r.stderr or r.stdout).strip()[-400:])
    sha = hashlib.sha256(open(os.path.join(ROOT, "source_assets", "original", "TallWail_Blockbench_v3.zip"), "rb").read()).hexdigest()
    if sha != ORIGINAL_SHA:
        err("original archive changed")
    notes.append("original archive intact (sha256 %s...)" % sha[:12])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tsc-types")
    a = ap.parse_args()
    check_json()
    check_manifests()
    check_scripts(a.tsc_types)
    tw = check_entities()
    anims = check_client(tw)
    check_clip_lengths(anims)
    check_sounds()
    check_items_and_text()
    check_no_experiments()
    check_generated()
    for n in notes:
        print("  ok  " + n)
    for e in errors:
        print("FAIL  " + e)
    print("%d check groups, %d errors" % (len(notes), len(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
