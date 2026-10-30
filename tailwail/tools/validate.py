#!/usr/bin/env python3
"""Static validation for the TAILWAIL packs.  Exit code 0 = all checks passed.

  python3 -I tools/validate.py [--tsc-types DIR] [--vanilla-sounds sound_definitions.json] [--fast]

--tsc-types        folder containing node_modules/@minecraft/{server,server-ui,common}
                   (npm install @minecraft/server@2.11.0 @minecraft/server-ui@2.3.0): also
                   type-check every script against the stable typings with tsc
--vanilla-sounds   the vanilla resource pack's sounds/sound_definitions.json: also check
                   every vanilla sound id the scripts play exists
--fast             skip the slow reproducibility re-bake of the animation clips
"""
import argparse
import filecmp
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

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


def scripts():
    return sorted(glob.glob(os.path.join(BP, "scripts", "**", "*.js"), recursive=True))


def all_script_text():
    return "\n".join(open(p, encoding="utf-8").read() for p in scripts())


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
    notes.append("manifests: v%s, engine %s, modules %s" % (".".join(map(str, bp["header"]["version"])), ENGINE, STABLE))


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
                                "moduleResolution": "bundler", "skipLibCheck": True, "types": [], "typeRoots": [],
                                "strict": False, "noImplicitAny": False,
                                "paths": {"@minecraft/server": [os.path.join(mods, "server", "index.d.ts")],
                                          "@minecraft/server-ui": [os.path.join(mods, "server-ui", "index.d.ts")],
                                          "@minecraft/common": [os.path.join(mods, "common", "index.d.ts")]}},
            "include": [os.path.join(BP, "scripts", "**", "*.js")]}
        cfg_path = os.path.join(ROOT, "build", "tsconfig.validate.json")
        os.makedirs(os.path.dirname(cfg_path), exist_ok=True)
        json.dump(cfg, open(cfg_path, "w"))
        tsc = shutil.which("tsc") or "tsc"
        r = subprocess.run([tsc, "-p", cfg_path], capture_output=True, text=True)
        if r.returncode:
            err("tsc against stable typings failed:\n" + r.stdout[-2000:])
        else:
            notes.append("tsc: all scripts type-check against the stable typings in %s" % mods)
    notes.append("checked %d script files (imports resolve, node --check)" % len(scripts()))


KNOWN_IDS = {
    # dynamic properties, commands, components, fog / particle / block ids, setups
    "tailwail:settings2", "tailwail:prefs2", "tailwail:mem", "tailwail:sched2", "tailwail:enc", "tailwail:owner",
    "tailwail:debug", "tailwail:debug_op", "tailwail:journal", "tailwail:settings", "tailwail:relight",
    "tailwail:dread", "tailwail:snuff_smoke", "tailwail:snuffed_torch", "tailwail:facing", "tailwail:kind",
    "tailwail:tall_wail", "tailwail:lure", "tailwail:echo", "tailwail:field_guide",
}


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
    for need in ("tailwail:tall_wail", "tailwail:lure", "tailwail:echo"):
        if need not in ids:
            err("behavior entity missing: " + need)
    tw = ids["tailwail:tall_wail"]
    events = set(tw["events"]) | set(ids["tailwail:lure"]["events"])
    props = dict(tw["description"]["properties"])
    props.update(ids["tailwail:echo"]["description"].get("properties", {}))
    src = all_script_text()
    for m in re.findall(r'triggerEvent\("([^"]+)"(?:\s*\+\s*[^)]+)?\)', src):
        if m.endswith("_"):
            if not any(m + s in events for s in ("a", "b", "c", "tall", "hunch", "crawl")):
                err("triggerEvent prefix %s matches no event" % m)
        elif m not in events:
            err("script triggers unknown event %s" % m)
    for name in set(re.findall(r'(?:setProp|setProperty|getProperty)\("(tailwail:[a-z_]+)"', src)):
        if name not in props:
            err("script reads/sets unknown property %s" % name)
    for name in set(re.findall(r'"(tailwail:[a-z_0-9]+)"', src)):
        if name in props or name in events or name in KNOWN_IDS:
            continue
        if name in ("tailwail:seek_", "tailwail:slot_", "tailwail:posture_"):
            continue
        err("script references unknown identifier %s" % name)
    notes.append("entities: %d properties, %d events; every script property/event/identifier exists" % (len(props), len(events)))
    return tw


def check_client():
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "client_sim.py")], capture_output=True, text=True)
    if r.returncode:
        err("client simulation failed:\n" + (r.stdout + r.stderr)[-2500:])
    else:
        dyn = [ln for ln in r.stdout.splitlines() if "dynamic:" in ln]
        notes.append("client_sim: wiring, Molang, 756 pose hops, random schedules, grounding, tail sweep: 0 errors " + (dyn[0].strip()[:90] if dyn else ""))


def anims():
    out = {}
    for p in glob.glob(os.path.join(RP, "animations", "*.json")):
        out.update(load(p)["animations"])
    return out


def check_clip_lengths():
    a = anims()
    cfg = open(os.path.join(BP, "scripts", "config.js"), encoding="utf-8").read()
    block = cfg[cfg.index("export const CLIP"):]
    block = block[: block.index("};")]
    want = {"unfold": "reveal", "unfoldLow": "tw_unfold_low", "scream": "tw2_scream", "grab": "tw2_grab", "throw": "tw2_throw",
            "strike": "tw_strike", "frustrated": "tw2_frustrated", "owl": "tw2_owl", "tilt": "tw2_tilt", "neck": "tw2_neck",
            "peek": "tw2_peek_l", "statue": "tw2_statue_reach", "behind": "tw2_behind", "death": "death"}
    for key, clip in want.items():
        m = re.search(r"\b%s:\s*([0-9.]+)" % key, block)
        length = a["animation.tall_wail." + clip]["animation_length"]
        if not m or abs(float(m.group(1)) - length) > 1e-6:
            err("CLIP.%s (%s) does not match %s length %s" % (key, m and m.group(1), clip, length))
    m = re.search(r"\bwindupCut:\s*([0-9.]+)", block)
    if not m or float(m.group(1)) > a["animation.tall_wail.windup"]["animation_length"]:
        err("CLIP.windupCut must be inside the supplied windup clip")
    notes.append("%d clip durations in config.js agree with the animation files" % (len(want) + 1))


VANILLA_SOUND_RE = re.compile(r'"((?:random|fire|dig|use|step|game|mob|ambient)\.[a-z_.]+)"')


def check_sounds(vanilla_path):
    sd = load(os.path.join(RP, "sounds", "sound_definitions.json"))["sound_definitions"]
    for name, d in sd.items():
        if not name.startswith("tailwail."):
            err("sound outside namespace " + name)
        for s in d["sounds"]:
            path = s["name"] if isinstance(s, dict) else s
            if not os.path.isfile(os.path.join(RP, path + ".ogg")):
                err("sound file missing " + path)
        if name.startswith("tailwail.music."):
            if d.get("category") != "music" or not all(isinstance(s, dict) and s.get("stream") for s in d["sounds"]):
                err("music track %s must be category music and streamed" % name)
    src = all_script_text()
    used = set(re.findall(r'"(tailwail\.[a-z_.]+)"', src))
    for sid in sorted(used):
        if sid not in sd:
            err("script plays undefined sound " + sid)
    lang = open(os.path.join(RP, "texts", "en_US.lang"), encoding="utf-8").read()
    for d in sd.values():
        if d.get("subtitle") and d["subtitle"] + "=" not in lang:
            err("missing subtitle text " + d["subtitle"])
    vanilla = set(VANILLA_SOUND_RE.findall(src))
    presence = open(os.path.join(BP, "scripts", "core", "presence_rules.js"), encoding="utf-8").read()
    for kind in ("dig", "use", "step"):
        for mat in ("stone", "wood", "gravel", "sand", "grass", "deepslate", "cloth"):
            if "`%s.${material}`" % kind in presence:
                vanilla.add("%s.%s" % (kind, mat))
    if vanilla_path:
        vd = load(vanilla_path)
        vd = vd.get("sound_definitions", vd)
        for sid in sorted(vanilla):
            if sid not in vd:
                err("vanilla sound id %s does not exist" % sid)
        notes.append("%d vanilla sound ids used by scripts exist in the vanilla pack" % len(vanilla))
    notes.append("sounds: %d events, all files present, %d custom ids used by scripts are defined" % (len(sd), len(used)))


def check_blocks_fog_particles():
    src = all_script_text()
    blk = load(os.path.join(BP, "blocks", "snuffed_torch.json"))["minecraft:block"]
    geos = set()
    for p in glob.glob(os.path.join(RP, "models", "blocks", "*.json")):
        for g in load(p)["minecraft:geometry"]:
            geos.add(g["description"]["identifier"])
    comps = [blk["components"]] + [p["components"] for p in blk.get("permutations", [])]
    terrain = load(os.path.join(RP, "textures", "terrain_texture.json"))["texture_data"]
    for c in comps:
        g = c.get("minecraft:geometry")
        if g and g not in geos:
            err("block geometry %s missing" % g)
        for mi in c.get("minecraft:material_instances", {}).values():
            if mi["texture"] not in terrain:
                err("block texture key %s not in terrain_texture.json" % mi["texture"])
        loot = c.get("minecraft:loot")
        if loot and not os.path.isfile(os.path.join(BP, loot)):
            err("loot table missing " + loot)
    for v in terrain.values():
        for t in v["textures"] if isinstance(v["textures"], list) else [v["textures"]]:
            if not os.path.isfile(os.path.join(RP, t + ".png")):
                err("terrain texture missing " + t)
    for comp in [k for k in blk["components"] if not k.startswith("minecraft:")]:
        if 'registerCustomComponent("%s"' % comp not in src:
            err("custom component %s is not registered by the scripts" % comp)
    states = blk["description"]["states"]
    torches = open(os.path.join(BP, "scripts", "mc", "torches.js"), encoding="utf-8").read()
    facings = re.search(r"const FACINGS = \[([^\]]+)\]", torches).group(1)
    if [s.strip().strip('"') for s in facings.split(",")] != states["tailwail:facing"]:
        err("snuffed torch facing states differ from torches.js")
    fogs = {load(p)["minecraft:fog_settings"]["description"]["identifier"] for p in glob.glob(os.path.join(RP, "fogs", "*.json"))}
    for fid in set(re.findall(r'pushFog\([^,]+,\s*"([^"]+)"\)', src)):
        if fid not in fogs:
            err("script pushes unknown fog " + fid)
    parts = {load(p)["particle_effect"]["description"]["identifier"] for p in glob.glob(os.path.join(RP, "particles", "*.json"))}
    for pid in set(re.findall(r'spawnParticle\("([^"]+)"', src)):
        if pid.startswith("tailwail:") and pid not in parts:
            err("script spawns unknown particle " + pid)
    notes.append("block (%d permutations), %d fog(s), %d particle(s): every reference resolves" % (len(blk.get("permutations", [])), len(fogs), len(parts)))


def check_echo():
    ids = open(os.path.join(BP, "scripts", "core", "ids.js"), encoding="utf-8").read()
    poses = re.findall(r"(\w+): \d+", re.search(r"ECHO_POSE = Object.freeze\(\{([^}]+)\}", ids).group(1))
    ce = load(os.path.join(RP, "entity", "tailwail_echo.entity.json"))["minecraft:client_entity"]["description"]
    for p in poses:
        if "tw2_" + p not in ce["animations"]:
            err("echo pose %s has no clip in the echo client entity" % p)
    src = all_script_text()
    for p in set(re.findall(r'spawnEcho\([^)]*?"([a-z_]+)"', src)):
        if p not in poses:
            err("script spawns echo pose %s that has no id" % p)
    notes.append("echo: %d poses mapped to clips" % len(poses))


def check_items_and_text():
    it = load(os.path.join(RP, "textures", "item_texture.json"))["texture_data"]
    for k, v in it.items():
        for t in v["textures"] if isinstance(v["textures"], list) else [v["textures"]]:
            if not os.path.isfile(os.path.join(RP, t + ".png")):
                err("item texture missing " + t)
    item = load(os.path.join(BP, "items", "field_guide.json"))["minecraft:item"]["components"]
    if item["minecraft:icon"] not in it:
        err("journal icon not in item_texture.json")
    ce = load(os.path.join(RP, "entity", "tall_wail.entity.json"))["minecraft:client_entity"]["description"]
    if ce["spawn_egg"]["texture"] not in it:
        err("spawn egg texture not in item_texture.json")
    lang = open(os.path.join(RP, "texts", "en_US.lang"), encoding="utf-8").read()
    for key in ("entity.tailwail:tall_wail.name", "item.spawn_egg.entity.tailwail:tall_wail.name", item["minecraft:display_name"]["value"],
                "tile.tailwail:snuffed_torch.name", "pack.name", "pack.description"):
        if key + "=" not in lang:
            err("missing lang key " + key)
    for base in (BP, RP):
        if not os.path.isfile(os.path.join(base, "pack_icon.png")):
            err("missing pack_icon.png in " + os.path.basename(base))
    notes.append("items, icons, lang keys present")


def check_no_experiments():
    for p in glob.glob(os.path.join(ROOT, "packs", "**", "*"), recursive=True):
        if os.path.isfile(p) and p.endswith((".json", ".js", ".lang")):
            t = open(p, encoding="utf-8").read()
            if re.search(r"experimental|@minecraft/server-gametest|@minecraft/server-net|@minecraft/server-admin|beta_apis|holiday_creator", t, re.I):
                err("experiment/beta reference in %s" % os.path.relpath(p, ROOT))
    notes.append("no experimental toggles, beta modules or preview features referenced")


def check_generated(fast):
    """Re-run the generators on a scratch copy and compare with the committed files."""
    tmp = tempfile.mkdtemp(prefix="twcheck_")
    try:
        shutil.copytree(os.path.join(ROOT, "packs"), os.path.join(tmp, "packs"))
        os.makedirs(os.path.join(tmp, "docs", "generated"), exist_ok=True)
        for f in ("subtitles.json",):
            src = os.path.join(ROOT, "docs", "generated", f)
            if os.path.exists(src):
                shutil.copy(src, os.path.join(tmp, "docs", "generated", f))
        env = dict(os.environ, TAILWAIL_ROOT=tmp)
        gens = ["gen_assets_v2.py", "gen_client_v2.py"] + ([] if fast else ["anim_studio.py"])
        for g in gens:
            r = subprocess.run([sys.executable, "-I", os.path.join(HERE, g)], capture_output=True, text=True, env=env)
            if r.returncode:
                err("%s failed: %s" % (g, (r.stderr or r.stdout)[-400:]))
        diff = []
        for base in ("TailwailBP", "TailwailRP"):
            cmp = filecmp.dircmp(os.path.join(ROOT, "packs", base), os.path.join(tmp, "packs", base))
            stack = [cmp]
            while stack:
                c = stack.pop()
                diff += [os.path.join(c.left, f) for f in c.diff_files]
                stack += list(c.subdirs.values())
        for d in diff:
            err("generated file is out of date: " + os.path.relpath(d, ROOT))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "build_assets.py"), "--check"], capture_output=True, text=True)
    if r.returncode:
        err("legacy derived clips out of date: " + (r.stderr or r.stdout).strip()[-400:])
    sha = hashlib.sha256(open(os.path.join(ROOT, "source_assets", "original", "TallWail_Blockbench_v3.zip"), "rb").read()).hexdigest()
    if sha != ORIGINAL_SHA:
        err("original archive changed")
    notes.append("generators reproduce the committed files%s; original archive intact (sha256 %s...)" % (" (clip re-bake skipped)" if fast else "", sha[:12]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tsc-types")
    ap.add_argument("--vanilla-sounds")
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args()
    check_json()
    check_manifests()
    check_scripts(a.tsc_types)
    check_entities()
    check_client()
    check_clip_lengths()
    check_sounds(a.vanilla_sounds)
    check_blocks_fog_particles()
    check_echo()
    check_items_and_text()
    check_no_experiments()
    check_generated(a.fast)
    for n in notes:
        print("  ok  " + n)
    for e in errors:
        print("FAIL  " + e)
    print("%d check groups, %d errors" % (len(notes), len(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
