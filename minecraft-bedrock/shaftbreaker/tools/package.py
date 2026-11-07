#!/usr/bin/env python3
"""Package the Shaftbreaker add-on for Minecraft Bedrock.

    python3 tools/package.py                 validate, then build dist/
    python3 tools/package.py --skip-validate build without running tools/validate.mjs
    python3 tools/package.py --force         build even if validation reports errors

Outputs (in minecraft-bedrock/shaftbreaker/dist/):
    Shaftbreaker_RP.mcpack   resource pack, manifest.json at the archive root
    Shaftbreaker_BP.mcpack   behavior pack, manifest.json at the archive root
    Shaftbreaker.mcaddon     both packs as Shaftbreaker_RP/ and Shaftbreaker_BP/ folders at the archive root

Archives are reproducible: entries are sorted and carry a fixed timestamp and permissions.
Development files (sources, notes, editor/OS clutter) are never packaged.
"""
import argparse
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PACKS = [("Shaftbreaker_RP", "Shaftbreaker_RP.mcpack"), ("Shaftbreaker_BP", "Shaftbreaker_BP.mcpack")]
ADDON = "Shaftbreaker.mcaddon"
FIXED_TIME = (2026, 1, 1, 0, 0, 0)

# Anything matching these (file or directory name) is a development file and is left out.
EXCLUDE = [
    ".*", "__pycache__", "node_modules", "Thumbs.db", "desktop.ini",
    "*.md", "*.txt", "*.py", "*.pyc", "*.mjs", "*.ts", "*.map",
    "*.bbmodel", "*.blend", "*.blend1", "*.psd", "*.xcf", "*.kra", "*.aseprite", "*.ase",
    "*.bak", "*.tmp", "*.orig", "*.swp", "*~",
]
# Bedrock reads these file types from packs; anything else is reported and skipped.
ALLOWED_EXT = {".json", ".png", ".tga", ".jpg", ".jpeg", ".lang", ".ogg", ".wav", ".fsb", ".material", ".js"}


def excluded(name):
    return any(fnmatch.fnmatch(name, pat) for pat in EXCLUDE)


def pack_files(pack_dir):
    """Sorted list of (absolute path, path relative to the pack) to ship."""
    out, skipped = [], []
    for dirpath, dirnames, filenames in os.walk(pack_dir):
        dirnames[:] = sorted(d for d in dirnames if not excluded(d))
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            relp = os.path.relpath(full, pack_dir).replace(os.sep, "/")
            if excluded(fn):
                continue
            if os.path.splitext(fn)[1].lower() not in ALLOWED_EXT:
                skipped.append(relp)
                continue
            out.append((full, relp))
    return out, skipped


def strip_json_comments(text):
    out, i, in_str = [], 0, False
    while i < len(text):
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\":
                out.append(text[i + 1:i + 2])
                i += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
            out.append(c)
        elif text.startswith("//", i):
            while i < len(text) and text[i] != "\n":
                i += 1
            continue
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = len(text) if end < 0 else end + 2
            continue
        else:
            out.append(c)
        i += 1
    return "".join(out)


def check_pack(name, pack_dir, files):
    problems = []
    rels = {r for _, r in files}
    for required in ("manifest.json", "pack_icon.png"):
        if required not in rels:
            problems.append(f"{name}: {required} is missing")
    for full, relp in files:
        if relp.endswith(".json"):
            try:
                with open(full, encoding="utf-8-sig") as fh:
                    json.loads(strip_json_comments(fh.read()))
            except Exception as exc:  # noqa: BLE001 - report any parse failure
                problems.append(f"{name}/{relp}: invalid JSON ({exc})")
    return problems


def write_zip(path, entries):
    """entries: list of (absolute source path, archive name)."""
    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        dirs = set()
        for _, arc in entries:
            parts = arc.split("/")[:-1]
            for k in range(1, len(parts) + 1):
                dirs.add("/".join(parts[:k]) + "/")
        for d in sorted(dirs):
            zi = zipfile.ZipInfo(d, FIXED_TIME)
            zi.external_attr = (0o40755 << 16) | 0x10
            zf.writestr(zi, b"")
        for src, arc in sorted(entries, key=lambda e: e[1]):
            zi = zipfile.ZipInfo(arc, FIXED_TIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o100644 << 16
            with open(src, "rb") as fh:
                zf.writestr(zi, fh.read())
    os.replace(tmp, path)


def run_validator():
    node = shutil.which("node")
    if not node:
        print("WARNING: node not found; skipping tools/validate.mjs")
        return True
    proc = subprocess.run([node, os.path.join(ROOT, "tools", "validate.mjs"), "--quiet"], cwd=ROOT)
    return proc.returncode == 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skip-validate", action="store_true", help="do not run tools/validate.mjs first")
    ap.add_argument("--force", action="store_true", help="package even if validation fails")
    args = ap.parse_args()

    if not args.skip_validate:
        print("Running tools/validate.mjs ...")
        if not run_validator():
            if not args.force:
                print("Validation failed; fix the errors above or pass --force.")
                return 1
            print("Validation failed; continuing because of --force.")

    os.makedirs(DIST, exist_ok=True)
    addon_entries, problems = [], []
    for name, archive in PACKS:
        pack_dir = os.path.join(ROOT, name)
        if not os.path.isdir(pack_dir):
            problems.append(f"{name}: folder missing")
            continue
        files, skipped = pack_files(pack_dir)
        for s in skipped:
            print(f"  skipped {name}/{s} (not a Bedrock pack file type)")
        problems += check_pack(name, pack_dir, files)
        write_zip(os.path.join(DIST, archive), files)
        addon_entries += [(full, f"{name}/{relp}") for full, relp in files]
        size = os.path.getsize(os.path.join(DIST, archive))
        print(f"  dist/{archive:<24} {len(files):3d} files  {size / 1024:8.1f} KiB")
    if problems:
        for p in problems:
            print("ERROR:", p)
        if not args.force:
            return 1
    write_zip(os.path.join(DIST, ADDON), addon_entries)
    size = os.path.getsize(os.path.join(DIST, ADDON))
    print(f"  dist/{ADDON:<24} {len(addon_entries):3d} files  {size / 1024:8.1f} KiB")

    # Sanity check: the .mcaddon must contain exactly the two pack folders, each with a manifest.
    with zipfile.ZipFile(os.path.join(DIST, ADDON)) as zf:
        names = zf.namelist()
        tops = sorted({n.split("/")[0] for n in names})
        assert tops == sorted(n for n, _ in PACKS), tops
        for n, _ in PACKS:
            assert f"{n}/manifest.json" in names, n
        bad = [n for n in names if re.search(r"(^|/)\.|\.(md|py|mjs|bbmodel)$", n)]
        assert not bad, bad
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
