#!/usr/bin/env python3
"""Merge the user's Weeping Mire biome add-on (v1.2.6) into The Observer's packs.

The Weeping Mire is the Observer's home biome. Source: source_assets/supplied_weeping_mire/
Weeping_Mire_v1.2.6.mcaddon (made by the user; checksum in SHA256SUMS.txt). Everything is copied as is
under its own `wmire:` namespace, except:

  * the Mire's own "watcher" mob (entity, spawn rule, client entity, model, animation, render controller,
    texture, names): in the merged add-on the Observer is the thing that watches you in the Mire
  * scripts/main.js: ported by hand into packs/TheObserver_BP/scripts/mire/mire.js (wind, falling leaves,
    torn pages), where the watcher's appearances call the Observer instead
  * manifests, pack icons and the BP pack name/description

Files with the same name in both packs are merged: RP blocks.json, textures/terrain_texture.json,
texts/en_US.lang. The RP manifest gets the "pbr" capability the Mire's textures and lighting need.
Re-running is safe: it rewrites the merged files from the archive.

Usage: python3 tools/merge_weeping_mire.py           merge
       python3 tools/merge_weeping_mire.py --check   verify every copied file is byte-identical to the archive
"""
import json
import os
import shutil
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source_assets", "supplied_weeping_mire", "Weeping_Mire_v1.2.6.mcaddon")
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
RP = os.path.join(ROOT, "packs", "TheObserver_RP")

SKIP = {
    "Weeping Mire BP/entities/watcher.json", "Weeping Mire BP/spawn_rules/watcher.json",
    "Weeping Mire BP/scripts/main.js", "Weeping Mire BP/manifest.json", "Weeping Mire BP/pack_icon.png",
    "Weeping Mire BP/texts/en_US.lang", "Weeping Mire BP/texts/languages.json",
    "Weeping Mire RP/entity/watcher.entity.json", "Weeping Mire RP/models/entity/watcher.geo.json",
    "Weeping Mire RP/animations/watcher.animation.json", "Weeping Mire RP/render_controllers/watcher.render_controllers.json",
    "Weeping Mire RP/textures/entity/wmire/watcher.png", "Weeping Mire RP/textures/entity/wmire/watcher.texture_set.json",
    "Weeping Mire RP/textures/entity/wmire/watcher_mer.png",
    "Weeping Mire RP/manifest.json", "Weeping Mire RP/pack_icon.png", "Weeping Mire RP/texts/languages.json",
}
MERGE = {"Weeping Mire RP/blocks.json", "Weeping Mire RP/textures/terrain_texture.json", "Weeping Mire RP/texts/en_US.lang"}
LANG_DROP = ("entity.wmire:watcher", "item.spawn_egg.entity.wmire:watcher", "pack.name", "pack.description")


def check():
    """Every file the merge copies must be in the packs, byte for byte."""
    bad, n = [], 0
    with zipfile.ZipFile(SRC) as z:
        for rel in sorted(z.namelist()):
            if rel.endswith("/") or rel in SKIP or rel in MERGE:
                continue
            side, sub = rel.split("/", 1)
            dest = os.path.join(BP if side.endswith("BP") else RP, sub)
            n += 1
            if not os.path.exists(dest) or open(dest, "rb").read() != z.read(rel):
                bad.append(sub)
    print(f"{n} Weeping Mire files checked, {len(bad)} differ" + "".join(f"\n  {b}" for b in bad))
    return 1 if bad else 0


def main():
    if "--check" in sys.argv[1:]:
        sys.exit(check())
    tmp = tempfile.mkdtemp(prefix="wmire_")
    try:
        with zipfile.ZipFile(SRC) as z:
            for n in z.namelist():
                if n.startswith("/") or ".." in n.split("/"):
                    sys.exit(f"unsafe path in archive: {n}")
            z.extractall(tmp)
        copied = 0
        for d, _, fs in os.walk(tmp):
            for f in sorted(fs):
                full = os.path.join(d, f)
                rel = os.path.relpath(full, tmp).replace(os.sep, "/")
                if rel in SKIP or rel in MERGE:
                    continue
                side, sub = rel.split("/", 1)
                dest_root = BP if side.endswith("BP") else RP
                dest = os.path.join(dest_root, sub)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copyfile(full, dest)
                copied += 1
        # RP blocks.json and the terrain atlas: add the Mire's entries to ours
        for rel, key in (("blocks.json", None), ("textures/terrain_texture.json", "texture_data")):
            ours_p = os.path.join(RP, rel)
            ours = json.load(open(ours_p))
            theirs = json.load(open(os.path.join(tmp, "Weeping Mire RP", rel)))
            if key:
                ours[key].update(theirs[key])
            else:
                ours.update({k: v for k, v in theirs.items() if k != "format_version"})
            json.dump(ours, open(ours_p, "w"), indent=2)
            open(ours_p, "a").write("\n")
        # names: the Mire's block names (not the watcher's, not its pack name)
        lang_p = os.path.join(RP, "texts", "en_US.lang")
        lang = open(lang_p).read()
        marker = "## ---------------------------------------------------------------- Weeping Mire (merged)"
        if marker in lang:
            lang = lang[:lang.index(marker)].rstrip("\n") + "\n"
        theirs = [l for l in open(os.path.join(tmp, "Weeping Mire RP", "texts", "en_US.lang")).read().splitlines()
                  if l.strip() and not l.startswith(LANG_DROP)]
        lang += "\n" + marker + "\n" + "\n".join(theirs) + "\n"
        open(lang_p, "w").write(lang)
        # the Mire's textures and lighting use physically based rendering
        # (a text edit, so the manifest keeps its hand formatting)
        man_p = os.path.join(RP, "manifest.json")
        man_s = open(man_p).read()
        if "pbr" not in json.loads(man_s).get("capabilities", []):
            assert '"capabilities"' not in man_s, "merge capabilities by hand"
            i = man_s.rstrip().rindex("}")
            man_s = man_s[:i].rstrip() + ',\n  "capabilities": ["pbr"]\n}\n'
            json.loads(man_s)
            open(man_p, "w").write(man_s)
        print(f"merged Weeping Mire: {copied} files copied; blocks.json, terrain_texture.json, en_US.lang merged")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
