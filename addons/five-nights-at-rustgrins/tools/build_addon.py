#!/usr/bin/env python3
"""One command to regenerate, validate and package the add-on.

  python3 tools/build_addon.py            # full build + every check + dist/*.mcaddon
  python3 tools/build_addon.py --no-zip   # checks only

Steps: entities, camera UI, pack files (manifests, items, fogs, lang, icons),
fragment merge, JSON schema validation, block-state validation (strict),
map validation (camera sight lines, routes), script typecheck against the
@minecraft/server typings, night-balance smoke run, and the scripted play
session against the strict API mock. Any failure stops the build.
"""
import os, subprocess, sys, zipfile, json, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
DIST = os.path.join(ROOT, 'dist')
NAME = 'FiveNightsAtRustgrins'


def run(label, cmd, cwd=ROOT):
    t = time.time()
    print(f'== {label}')
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip()
    tail = '\n'.join(out.splitlines()[-25:])
    if tail:
        print('   ' + tail.replace('\n', '\n   '))
    if r.returncode != 0:
        print(f'!! {label} failed ({r.returncode})')
        sys.exit(1)
    print(f'   ok ({time.time() - t:.1f}s)')


def zip_packs():
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f'{NAME}.mcaddon')
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for pack, folder in (('BP', f'{NAME}_BP'), ('RP', f'{NAME}_RP')):
            base = os.path.join(ROOT, 'packs', pack)
            for dirpath, _, files in os.walk(base):
                for f in sorted(files):
                    full = os.path.join(dirpath, f)
                    rel = os.path.relpath(full, base)
                    z.write(full, f'{folder}/{rel}')
    size = os.path.getsize(out) / 1e6
    with zipfile.ZipFile(out) as z:
        n = len(z.namelist())
    print(f'== packaged {os.path.relpath(out, ROOT)}: {n} files, {size:.1f} MB')
    return out


def main():
    py = sys.executable
    run('entities', [py, '-I', 'tools/entities/build_entities.py'])
    run('camera UI', [py, '-I', 'tools/ui/gen_ui.py'])
    run('pack files', [py, '-I', 'tools/pack/gen_pack_files.py'])
    run('merge fragments', ['node', 'tools/merge_fragments.mjs'])
    run('JSON schemas', ['node', 'tools/validate_json.mjs', 'packs'])
    run('game load rules', ['node', 'tools/lint_game_rules.mjs'])
    run('block states (strict)', ['node', 'tools/validate_blocks.mjs', '--strict'])
    run('voxel export', ['node', 'tools/map/export_voxels.mjs'])
    run('map: cameras + routes', ['node', 'tools/map/validate_map.mjs'])
    run('script typecheck', ['node', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.scripts.json'], cwd=os.path.join(ROOT, 'tools'))
    run('night balance smoke', ['node', 'tools/sim/sim.mjs', '1-7', '40', '--bot=good'])
    run('play session (API mock)', ['node', '--import', './tools/mock/register.mjs', 'tools/mock/run_game.mjs'])
    if '--no-zip' not in sys.argv:
        zip_packs()


if __name__ == '__main__':
    main()
