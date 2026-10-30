#!/usr/bin/env python3
"""Packages the add-on.

  python3 -I tools/package.py            # validate, then write dist/*.mcaddon and *.mcpack

Outputs (deterministic: sorted entries, fixed timestamps):
  dist/Tailwail_<ver>.mcaddon   both packs, double-click to import
  dist/Tailwail_BP_<ver>.mcpack
  dist/Tailwail_RP_<ver>.mcpack
  dist/SHA256SUMS.txt
"""
import hashlib
import json
import os
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PACKS = {"TailwailBP": os.path.join(ROOT, "packs", "TailwailBP"), "TailwailRP": os.path.join(ROOT, "packs", "TailwailRP")}
SKIP = ("__pycache__", ".DS_Store", "Thumbs.db")
FIXED = (2026, 10, 30, 0, 0, 0)


def files_of(folder):
    out = []
    for base, dirs, files in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if d not in SKIP)
        for f in sorted(files):
            if f in SKIP or f.endswith(".pyc"):
                continue
            out.append(os.path.join(base, f))
    return out


def write_zip(path, entries):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for arc, src in sorted(entries):
            info = zipfile.ZipInfo(arc, FIXED)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, open(src, "rb").read())


def main():
    if "--skip-validate" not in sys.argv:
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "validate.py")])
        if r.returncode:
            print("validation failed; not packaging")
            return 1
    ver = ".".join(map(str, json.load(open(os.path.join(PACKS["TailwailBP"], "manifest.json")))["header"]["version"]))
    dist = os.path.join(ROOT, "dist")
    os.makedirs(dist, exist_ok=True)
    name = "Tailwail"
    for old in os.listdir(dist):
        if old.endswith((".mcaddon", ".mcpack")):
            os.remove(os.path.join(dist, old))
    addon = []
    for pack, folder in PACKS.items():
        entries = [(os.path.relpath(f, folder).replace(os.sep, "/"), f) for f in files_of(folder)]
        kind = "BP" if pack.endswith("BP") else "RP"
        write_zip(os.path.join(dist, "%s_%s_%s.mcpack" % (name, kind, ver)), entries)
        addon += [("%s/%s" % (pack, a), f) for a, f in entries]
    write_zip(os.path.join(dist, "%s_%s.mcaddon" % (name, ver)), addon)
    sums = []
    for f in sorted(os.listdir(dist)):
        if f.endswith((".mcaddon", ".mcpack")):
            p = os.path.join(dist, f)
            sums.append("%s  %s  (%d bytes)" % (hashlib.sha256(open(p, "rb").read()).hexdigest(), f, os.path.getsize(p)))
    open(os.path.join(dist, "SHA256SUMS.txt"), "w").write("\n".join(sums) + "\n")
    print("\n".join(sums))
    return 0


if __name__ == "__main__":
    sys.exit(main())
