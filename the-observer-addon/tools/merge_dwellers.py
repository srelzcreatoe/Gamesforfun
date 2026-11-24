#!/usr/bin/env python3
"""Merge the user's three dwellers — The Goatwalker 3.1, the Brinesleeper 7.0 and the Shaftbreaker 3.1 — into The
Observer's packs (1.6.0). Their archives are kept unmodified in source_assets/supplied_dwellers/ (SHA256SUMS.txt).

What happens to each file of their packs:
  * scripts/**            copied to packs/TheObserver_BP/scripts/dwellers/<name>/**, with a short, fixed list of patches
                          (PATCHES below; each must match exactly as written, or the merge stops):
                            - every `world.getAllPlayers()` becomes `__dw.players("<name>")`: a dweller switched off on
                              the Config Wheel sees nobody, and none of them see anyone in the Rift;
                            - their music goes through one shared channel (scripts/link/shared.js) instead of each
                              calling playMusic/stopMusic on its own;
                            - they no longer hand out their own settings wheels unasked (the Config Wheel opens them);
                            - a few exports the Observer needs (their settings, switching off, being sent after someone);
                            - `// @ts-nocheck` (their code keeps its own conventions; the Observer's is type-checked).
  * manifest.json, pack_icon.png, README.txt, texts/languages.json — not copied (one pack now).
  * blocks.json, sounds.json, sounds/sound_definitions.json, sounds/music_definitions.json, textures/terrain_texture.json,
    textures/item_texture.json, textures/flipbook_textures.json, texts/en_US.lang — merged entry by entry; an entry two
    packs define differently stops the merge.
  * three files share a path with another pack's and are renamed (RENAME); their identifiers are already distinct.
  * everything else — biomes, blocks, entities, items, features, structures, loot, recipes, models, textures, sounds,
    particles, fogs, the Goatwalker's lighting and colour grading — copied as it is.
  * the biomes' replace_biomes rules are tuned so the Stellar Taiga, the Weeping Mire and the Hollows each keep land of
    their own and do not run into one another (BIOME_TUNING).

Usage: python3 tools/merge_dwellers.py           merge (safe to re-run: it rewrites everything it owns)
       python3 tools/merge_dwellers.py --check   verify the packs hold exactly what the merge would write
"""
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
RP = os.path.join(ROOT, "packs", "TheObserver_RP")
SRC = os.path.join(ROOT, "source_assets", "supplied_dwellers")

DWELLERS = [
    ("goatwalker", "The_Goatwalker_v3.1.mcaddon", "Goatwalker_BP", "Goatwalker_RP"),
    ("brinesleeper", "Brinesleeper.mcaddon", "Brinesleeper_BP", "Brinesleeper_RP"),
    ("shaftbreaker", "Shaftbreaker.mcaddon", "Shaftbreaker_BP", "Shaftbreaker_RP"),
]
SKIP = {"manifest.json", "pack_icon.png", "README.txt", "texts/languages.json"}
RENAME = {
    ("goatwalker", "BP", "entities/flare.json"): "entities/gw_flare.json",
    ("goatwalker", "RP", "entity/flare.entity.json"): "entity/gw_flare.entity.json",
    ("brinesleeper", "BP", "items/config_wheel.json"): "items/brine_config_wheel.json",
}
MERGED = {
    "RP": {"blocks.json", "sounds.json", "sounds/sound_definitions.json", "sounds/music_definitions.json",
           "textures/terrain_texture.json", "textures/item_texture.json", "textures/flipbook_textures.json", "texts/en_US.lang"},
    "BP": {"texts/en_US.lang"},
}
LINK = "scripts/link/shared.js"

# The three surface biomes, each on land of its own (1.6.0): the Goatwalker's woods take the taigas, the oak and flower
# forests, the groves and meadows (the birch and dark forests and the plains go to the Mire), the Shaftbreaker's
# Hollows the hills, savannas and badlands, and the Weeping Mire (tools/merge_weeping_mire.py) the swamps, rivers,
# plains, jungles, deserts and gardens. The Brinesleeper's Stillwater Caves are underground and unchanged.
BIOME_TUNING = {
    ("goatwalker", "biomes/stellar_taiga.biome.json"): {"drop": ["minecraft:plains", "minecraft:sunflower_plains", "minecraft:birch_forest",
        "minecraft:birch_forest_hills", "minecraft:birch_forest_mutated", "minecraft:birch_forest_hills_mutated",
        "minecraft:roofed_forest", "minecraft:roofed_forest_mutated"]},
}

# (dweller, file under scripts/, old, new) — each old must occur exactly once in the original
PATCHES = [
    # --- The Goatwalker
    ("goatwalker", "config.js",
     "  wheel: true,      // give The Wheel when you arrive and every time you die",
     "  wheel: false,     // give The Wheel when you arrive and every time you die (merged into The Observer: off; its Config Wheel opens his)"),
    ("goatwalker", "core.js",
     "  if (!track) safe(() => p.stopMusic());\n  else safe(() => p.playMusic(track, { loop: true, fade: 2.0, volume: 1.0 }));",
     "  if (!track) safe(() => __dw.musicStop(\"goatwalker\", p));\n  else safe(() => __dw.musicPlay(\"goatwalker\", p, track, { loop: true, fade: 2.0, volume: 1.0 }));"),
    ("goatwalker", "main.js",
     "      safe(() => p.stopMusic());",
     "      safe(() => __dw.musicStop(\"goatwalker\", p));"),
    ("goatwalker", "main.js",
     "      if (track) safe(() => p.playMusic(track, { fade: 0.5, volume: 1.0, loop: false }));",
     "      if (track) safe(() => __dw.musicPlay(\"goatwalker\", p, track, { fade: 0.5, volume: 1.0, loop: false }));"),
    ("goatwalker", "main.js", "const WHEEL_API = {", "export const WHEEL_API = {"),
    # --- The Brinesleeper
    ("brinesleeper", "music.js",
     "    const w = config.music ? want(p, t) : 'none';",
     "    const w = config.music && config.enabled ? want(p, t) : 'none';"),
    ("brinesleeper", "music.js",
     "          else if (t >= st.gap) { p.playMusic('music.brine.stillwater', { fade: 3, volume: 0.85 }); st.until = t + CALM_TICKS; st.gap = 0; }",
     "          else if (t >= st.gap) { __dw.musicPlay('brinesleeper', p, 'music.brine.stillwater', { fade: 3, volume: 0.85 }); st.until = t + CALM_TICKS; st.gap = 0; }"),
    ("brinesleeper", "music.js",
     "      if (w === 'chase') p.playMusic('music.brine.chase', { loop: true, fade: 0.4, volume: 0.95 });\n      else if (w === 'near') p.playMusic('music.brine.near', { loop: true, fade: 2.5, volume: 0.9 });",
     "      if (w === 'chase') __dw.musicPlay('brinesleeper', p, 'music.brine.chase', { loop: true, fade: 0.4, volume: 0.95 });\n      else if (w === 'near') __dw.musicPlay('brinesleeper', p, 'music.brine.near', { loop: true, fade: 2.5, volume: 0.9 });"),
    ("brinesleeper", "music.js",
     "        if (st.track === 'none') { p.playMusic('music.brine.stillwater', { fade: 4, volume: 0.85 }); st.until = t + CALM_TICKS; }\n        else { p.stopMusic(); st.until = t;",
     "        if (st.track === 'none') { __dw.musicPlay('brinesleeper', p, 'music.brine.stillwater', { fade: 4, volume: 0.85 }); st.until = t + CALM_TICKS; }\n        else { __dw.musicStop('brinesleeper', p); st.until = t;"),
    ("brinesleeper", "music.js",
     "      } else p.stopMusic();",
     "      } else __dw.musicStop('brinesleeper', p);"),
    ("brinesleeper", "menu.js",
     "  if (!initialSpawn || !isOp(player) || player.getDynamicProperty('brine:wheel')) return;",
     "  if (!initialSpawn || !isOp(player) || player.getDynamicProperty('brine:wheel') || !__dw.GIVE_OWN_WHEELS) return;"),
    # --- The Shaftbreaker
    ("shaftbreaker", "core/config.js",
     "  giveWheel: true,                    // players get the Breaker's Wheel when they first join and after dying",
     "  giveWheel: false,                   // players get the Breaker's Wheel when they first join and after dying (merged into The Observer: off)"),
    ("shaftbreaker", "audio.js",
     "  try { player.playMusic(track, { fade: 2.0, loop: true, volume: pr.reducedAudio ? vol * 0.55 : vol }); s.music = track; } catch { /* ignore */ }",
     "  try { __dw.musicPlay('shaftbreaker', player, track, { fade: 2.0, loop: true, volume: pr.reducedAudio ? vol * 0.55 : vol }); s.music = track; } catch { /* ignore */ }"),
    ("shaftbreaker", "audio.js",
     "  try { player.stopMusic(); } catch { /* ignore */ }",
     "  try { __dw.musicStop('shaftbreaker', player); } catch { /* ignore */ }"),
]

# A pack may register custom commands under one namespace only, so the dwellers' slash commands move under the
# Observer's (their /scriptevent commands are not custom commands and keep their names):
#   /brine:settings ... /brine:status  ->  /observer:brine_settings ... /observer:brine_status
#   /shaftbreaker:sb                   ->  /observer:sb
# (dweller, file under scripts/, regex, replacement, exact count)
REGEX_PATCHES = [
    ("brinesleeper", "menu.js", r"'brine:encounter_name'", "'observer:brine_encounter_name'", 2),
    ("brinesleeper", "menu.js", r"name: 'brine:(\w+)'", r"name: 'observer:brine_\1'", 7),
    ("brinesleeper", "menu.js", r"/brine:(\w+)", r"/observer:brine_\1", 7),
    ("shaftbreaker", "main.js", r"'shaftbreaker:action'", "'observer:sb_action'", 2),
    ("shaftbreaker", "main.js", r"'shaftbreaker:sb'", "'observer:sb'", 1),
    ("shaftbreaker", "main.js", r"/shaftbreaker:sb", "/observer:sb", 1),
    ("shaftbreaker", "core/config.js", r"/shaftbreaker:sb", "/observer:sb", 1),
]

# appended to a dweller's script: what the Observer calls (switching it off, opening its own settings, sending it)
APPEND = {
    ("goatwalker", "main.js"): '''
// ---------------------------------------------------------------- merged into The Observer (1.6.0)
/** Switched off on the Config Wheel: whatever he is doing ends, and he is gone. */
export function __shutdown() {
  for (const s of STATE.values()) { if (s.enc) safe(() => s.enc.finish(0)); s.enc = null; }
  for (const w of [...WALKERS]) safe(() => w.remove());
  for (const p of world.getAllPlayers()) { safe(() => clearFogs(p)); }
}
/** The Observer sends him after someone: his anger is up and something happens soon. */
export function __command(p) {
  const s = st(p);
  s.anger = Math.max(s.anger, MOOD_ANGER[3]);
  s.dirty = true;
  s.quietUntil = 0;
  s.nextAt = Math.min(s.nextAt, now() + 20 * 6);
}
/** His own Wheel, from the Config Wheel. */
export function __open(p) { return openWheel(p, WHEEL_API); }
''',
}


def rel_import(path_in_scripts):
    """Relative import of scripts/link/shared.js from a file at scripts/<path_in_scripts>."""
    here = os.path.dirname(os.path.join("scripts", path_in_scripts))
    r = os.path.relpath(LINK, here).replace(os.sep, "/")
    return r if r.startswith(".") else "./" + r


def patch_script(name, rel, text):
    """rel: path under the dweller's scripts/ folder."""
    for d, f, old, new in PATCHES:
        if d == name and f == rel:
            n = text.count(old)
            if n != 1:
                sys.exit(f"patch for {name}/{rel} matched {n} times: {old[:80]!r}")
            text = text.replace(old, new)
    for d, f, rx, rep, n in REGEX_PATCHES:
        if d == name and f == rel:
            text, k = re.subn(rx, rep, text)
            if k != n:
                sys.exit(f"regex patch for {name}/{rel} matched {k} times, not {n}: {rx}")
    text = text.replace("world.getAllPlayers()", f'__dw.players("{name}")')
    text = re.sub(r"(?m)^// @ts-check\s*\n", "", text)
    needs = "__dw." in text
    head = "// @ts-nocheck\n"
    if needs:
        head += f'import * as __dw from "{rel_import(os.path.join("dwellers", name, rel))}";\n'
    text = head + text
    extra = APPEND.get((name, rel))
    if extra:
        text = text.rstrip("\n") + "\n" + extra
    return text


def fix_bone_visibility(raw):
    """This game version reads bone_visibility as Molang (or numbers), not true/false: the same values as "1.0"/"0.0"
    (the Goatwalker's void fence otherwise fails to load on Bedrock Dedicated Server 1.26.52)."""
    d = load_json(raw)
    changed = [0]

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "bone_visibility" and isinstance(v, dict):
                    for bk, bv in v.items():
                        if isinstance(bv, bool):
                            v[bk] = "1.0" if bv else "0.0"
                            changed[0] += 1
                else:
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)
    walk(d)
    return (json.dumps(d, indent=2) + "\n").encode("utf-8") if changed[0] else raw


def load_json(raw):
    t = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
    t = re.sub(r"(?m)^\s*//.*$", "", t)
    return json.loads(t)


def merge_dict(base, add, where, depth=1):
    """Add entries of add into base (a dict), depth levels deep; equal entries are fine, different ones stop."""
    for k, v in add.items():
        if k == "format_version":
            base.setdefault(k, v)
            continue
        if k not in base:
            base[k] = v
        elif depth > 1 and isinstance(base[k], dict) and isinstance(v, dict):
            merge_dict(base[k], v, f"{where}/{k}", depth - 1)
        elif base[k] != v:
            sys.exit(f"conflict in {where}: {k}")


def merged_text(side, rel, ours_raw, parts):
    """ours_raw: current file bytes (or None); parts: [(dweller, bytes)]"""
    if rel.endswith(".lang"):
        text = ours_raw.decode("utf-8") if ours_raw else ""
        # drop any earlier merge of these blocks, then add them again
        text = re.sub(r"\n## ---- merged: [a-z]+ \(tools/merge_dwellers\.py\) ----\n.*?## ---- end merged: [a-z]+ ----\n", "\n", text, flags=re.S)
        have = {}
        for line in text.splitlines():
            m = re.match(r"([^#=\s][^=]*)=(.*)", line)
            if m:
                have[m.group(1)] = m.group(2)
        out = text.rstrip("\n") + "\n"
        for name, raw in parts:
            lines = []
            for line in raw.decode("utf-8", "replace").splitlines():
                m = re.match(r"([^#=\s][^=]*)=(.*)", line)
                if not m or m.group(1) in ("pack.name", "pack.description"):
                    continue
                k, v = m.group(1), m.group(2)
                if k in have:
                    if have[k] != v:
                        sys.exit(f"lang conflict {side}/{rel}: {k}")
                    continue
                have[k] = v
                lines.append(f"{k}={v}")
            if lines:
                out += f"\n## ---- merged: {name} (tools/merge_dwellers.py) ----\n" + "\n".join(lines) + f"\n## ---- end merged: {name} ----\n"
        return out.encode("utf-8")
    base = load_json(ours_raw) if ours_raw else None
    if rel.endswith("flipbook_textures.json"):
        base = base or []
        for name, raw in parts:
            for e in load_json(raw):
                if e not in base:
                    if any(x.get("atlas_tile") == e.get("atlas_tile") for x in base):
                        sys.exit(f"flipbook conflict: {e.get('atlas_tile')}")
                    base.append(e)
        return (json.dumps(base, indent=2) + "\n").encode("utf-8")
    base = base or {}
    if rel in ("textures/terrain_texture.json", "textures/item_texture.json"):
        # only the texture list merges; the header (this pack's name, padding, mip levels) stays the Observer's
        for name, raw in parts:
            base.setdefault("texture_data", {})
            merge_dict(base["texture_data"], load_json(raw).get("texture_data", {}), f"{side}/{rel} ({name})", 1)
        return (json.dumps(base, indent=2) + "\n").encode("utf-8")
    depth = {"blocks.json": 1, "sounds.json": 3, "sounds/sound_definitions.json": 2, "sounds/music_definitions.json": 1}[rel]
    for name, raw in parts:
        merge_dict(base, load_json(raw), f"{side}/{rel} ({name})", depth)
    return (json.dumps(base, indent=2) + "\n").encode("utf-8")


def plan():
    """Everything the merge writes: {absolute path: bytes}."""
    out = {}
    merged_parts = {}
    for name, archive, bp_dir, rp_dir in DWELLERS:
        with zipfile.ZipFile(os.path.join(SRC, archive)) as z:
            for n in z.namelist():
                if n.endswith("/") or n.startswith("/") or ".." in n.split("/"):
                    if not n.endswith("/"):
                        sys.exit(f"unsafe path in {archive}: {n}")
                    continue
                top, rel = n.split("/", 1)
                side = "BP" if top == bp_dir else "RP" if top == rp_dir else None
                if side is None:
                    sys.exit(f"unexpected folder in {archive}: {top}")
                if rel in SKIP:
                    continue
                data = z.read(n)
                if rel in MERGED[side]:
                    merged_parts.setdefault((side, rel), []).append((name, data))
                    continue
                root = BP if side == "BP" else RP
                if side == "BP" and rel.startswith("scripts/"):
                    srel = rel[len("scripts/"):]
                    dest = os.path.join(root, "scripts", "dwellers", name, srel)
                    if srel.endswith(".js"):
                        data = patch_script(name, srel, data.decode("utf-8")).encode("utf-8")
                    out[dest] = data
                    continue
                rel2 = RENAME.get((name, side, rel), rel)
                if side == "BP" and rel.startswith("blocks/") and rel.endswith(".json") and b"bone_visibility" in data:
                    data = fix_bone_visibility(data)
                if (name, rel) in BIOME_TUNING:
                    d = load_json(data)
                    rule = d["minecraft:biome"]["components"]["minecraft:replace_biomes"]["replacements"][0]
                    rule["targets"] = [t for t in rule["targets"] if t not in BIOME_TUNING[(name, rel)]["drop"]]
                    data = (json.dumps(d, indent=2) + "\n").encode("utf-8")
                dest = os.path.join(root, rel2)
                if dest in out and out[dest] != data:
                    sys.exit(f"two dwellers write {side}/{rel2} differently")
                out[dest] = data
    for (side, rel), parts in merged_parts.items():
        root = BP if side == "BP" else RP
        dest = os.path.join(root, rel)
        ours = open(dest, "rb").read() if os.path.exists(dest) else None
        out[dest] = merged_text(side, rel, ours, parts)
    # nothing of ours may be overwritten by something different (apart from the merged files)
    merged_dests = {os.path.join(BP if s == "BP" else RP, r) for (s, r) in merged_parts}
    # the list of the dwellers' own files (copied as they are): tools/validate.mjs takes their schema findings as notes,
    # since they come verbatim from packs that already load cleanly; the server's content log is their check
    own = sorted(os.path.relpath(d, ROOT).replace(os.sep, "/") for d in out if d not in merged_dests)
    out[os.path.join(ROOT, "tools", "merged_dweller_files.txt")] = ("\n".join(own) + "\n").encode("utf-8")
    return out, merged_dests


def main():
    check = "--check" in sys.argv[1:]
    out, merged = plan()
    ours_clash = []
    bad = []
    listed = os.path.join(ROOT, "tools", "merged_dweller_files.txt")
    before = set(open(listed).read().split()) if os.path.exists(listed) else set()
    for dest, data in sorted(out.items()):
        exists = os.path.exists(dest)
        cur = open(dest, "rb").read() if exists else None
        if check:
            if cur != data:
                bad.append(os.path.relpath(dest, ROOT))
            continue
        # (a file an earlier merge wrote is the dwellers', and may change)
        if exists and dest not in merged and cur != data and "/scripts/dwellers/" not in dest.replace(os.sep, "/") \
                and os.path.relpath(dest, ROOT).replace(os.sep, "/") not in before and not dest.endswith("merged_dweller_files.txt"):
            ours_clash.append(os.path.relpath(dest, ROOT))
    if check:
        print(f"{len(out)} dweller files checked, {len(bad)} differ" + "".join(f"\n  {b}" for b in bad[:20]))
        sys.exit(1 if bad else 0)
    if ours_clash:
        sys.exit("would overwrite files that are not the dwellers': " + ", ".join(ours_clash[:10]))
    for dest, data in out.items():
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
    print(f"merged {len(out)} files from {len(DWELLERS)} dwellers")


if __name__ == "__main__":
    main()
