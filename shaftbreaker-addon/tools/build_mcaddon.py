#!/usr/bin/env python3
"""Builds dist/The_Shaftbreaker.mcaddon (behavior + resource pack) and individual .mcpack files."""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
SKIP_NAMES = {'.DS_Store', 'Thumbs.db', 'sounds_manifest.json'}


def add_dir(z, src, arc_root):
    n = 0
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames.sort()
        for f in sorted(filenames):
            if f in SKIP_NAMES or f.startswith('.'):
                continue
            full = os.path.join(dirpath, f)
            rel = os.path.relpath(full, src).replace(os.sep, '/')
            z.write(full, arc_root + '/' + rel if arc_root else rel)
            n += 1
    return n


def main():
    os.makedirs(DIST, exist_ok=True)
    addon = os.path.join(DIST, 'The_Shaftbreaker.mcaddon')
    with zipfile.ZipFile(addon, 'w', zipfile.ZIP_DEFLATED) as z:
        nb = add_dir(z, os.path.join(ROOT, 'BP'), 'Shaftbreaker_BP')
        nr = add_dir(z, os.path.join(ROOT, 'RP'), 'Shaftbreaker_RP')
    for name, sub in ((('Shaftbreaker_BP.mcpack', 'BP'), ('Shaftbreaker_RP.mcpack', 'RP')) if '--mcpack' in sys.argv else ()):
        with zipfile.ZipFile(os.path.join(DIST, name), 'w', zipfile.ZIP_DEFLATED) as z:
            add_dir(z, os.path.join(ROOT, sub), '')
    print(f'{addon}: {nb} BP files + {nr} RP files, {os.path.getsize(addon) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
