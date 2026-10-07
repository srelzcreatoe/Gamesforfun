#!/usr/bin/env python3
"""Package The Observer.

  1. runs the static validator (tools/validate.mjs) and the script type-check (tsc) — aborts on failure
  2. builds dist/TheObserver_BP.mcpack, dist/TheObserver_RP.mcpack and dist/TheObserver.mcaddon
  3. re-opens every archive and checks its structure (manifest at the pack root, entry script present)
  4. writes dist/SHA256SUMS.txt

Usage: python3 tools/build.py [--skip-checks]
"""
import hashlib
import json
import os
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(ROOT, "packs")
DIST = os.path.join(ROOT, "dist")
BP, RP = "TheObserver_BP", "TheObserver_RP"
EXCLUDE = {".DS_Store", "Thumbs.db"}


def run(cmd):
    print("$", " ".join(cmd))
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode != 0:
        sys.exit(f"build aborted: {' '.join(cmd)} failed")


def files_of(pack):
    base = os.path.join(PACKS, pack)
    out = []
    for d, _, fs in os.walk(base):
        for f in sorted(fs):
            if f in EXCLUDE:
                continue
            full = os.path.join(d, f)
            out.append((full, os.path.relpath(full, base).replace(os.sep, "/")))
    return sorted(out, key=lambda x: x[1])


def write_zip(path, entries):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for full, arc in entries:
            info = zipfile.ZipInfo(arc, date_time=(2026, 10, 7, 0, 0, 0))  # reproducible archives
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(full, "rb") as fh:
                z.writestr(info, fh.read())


def check_pack_zip(path, prefix=""):
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        m = json.loads(z.read(prefix + "manifest.json"))
        for mod in m["modules"]:
            if mod["type"] == "script" and prefix + mod["entry"] not in names:
                sys.exit(f"{path}: script entry {mod['entry']} missing")
        assert z.testzip() is None, f"{path}: corrupt"
        return m["header"]["name"], m["header"]["version"], len(names)


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def main():
    if "--skip-checks" not in sys.argv:
        run(["node", "tools/validate.mjs"])
        run(["npx", "tsc", "-p", "tsconfig.json"])
    os.makedirs(DIST, exist_ok=True)
    bp_files, rp_files = files_of(BP), files_of(RP)
    write_zip(os.path.join(DIST, "TheObserver_BP.mcpack"), bp_files)
    write_zip(os.path.join(DIST, "TheObserver_RP.mcpack"), rp_files)
    write_zip(os.path.join(DIST, "TheObserver.mcaddon"),
              [(f, f"{BP}/{a}") for f, a in bp_files] + [(f, f"{RP}/{a}") for f, a in rp_files])
    report = []
    for name in ("TheObserver_BP.mcpack", "TheObserver_RP.mcpack"):
        report.append((name,) + check_pack_zip(os.path.join(DIST, name)))
    add = os.path.join(DIST, "TheObserver.mcaddon")
    report.append(("TheObserver.mcaddon [BP]",) + check_pack_zip(add, f"{BP}/"))
    report.append(("TheObserver.mcaddon [RP]",) + check_pack_zip(add, f"{RP}/"))
    with open(os.path.join(DIST, "SHA256SUMS.txt"), "w") as fh:
        for name in ("TheObserver.mcaddon", "TheObserver_BP.mcpack", "TheObserver_RP.mcpack"):
            p = os.path.join(DIST, name)
            fh.write(f"{sha(p)}  {name}\n")
    for r in report:
        print(f"{r[0]:<28} {r[1]} v{'.'.join(map(str, r[2]))}  files={r[3]}")
    for name in ("TheObserver.mcaddon", "TheObserver_BP.mcpack", "TheObserver_RP.mcpack"):
        print(f"{name:<24} {os.path.getsize(os.path.join(DIST, name)):>9} bytes")


if __name__ == "__main__":
    main()
