"""One-command build: regenerate every generated asset, validate, and package the .mcaddon.

usage: python3 tools/build.py [--audio] [--vanilla-data PATH] [--vanilla-rp PATH]
  --audio          re-synthesize all sounds (slow-ish; otherwise existing OGGs are kept)
  --vanilla-data   path to an installed @minecraft/vanilla-data package (enables ID validation)
  --vanilla-rp     path to Mojang's vanilla resource_pack (bedrock-samples) for sound-ID validation
"""
import os, sys, subprocess, zipfile, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, 'tools')
args = sys.argv[1:]


def run(script, *a):
    print(f'== {script} {" ".join(a)}')
    subprocess.run([sys.executable, os.path.join(T, script), *a], check=True, cwd=ROOT)


def opt(name):
    return args[args.index(name) + 1] if name in args else None


run('author_anims.py')
run('gen_client.py')
run('gen_bp.py')
run('gen_rp.py')
run('gen_textures.py')
if '--audio' in args or not os.path.exists(os.path.join(ROOT, 'Shaftbreaker_RP/sounds/sound_definitions.json')):
    run('gen_audio.py')
run('gen_features.py')
vargs = [x for x in (opt('--vanilla-data'), opt('--vanilla-rp')) if x]
run('validate.py', *vargs)

# ---------------------------------------------------------------- package
dist = os.path.join(ROOT, 'dist')
os.makedirs(dist, exist_ok=True)
version = '.'.join(map(str, json.load(open(os.path.join(ROOT, 'Shaftbreaker_BP/manifest.json')))['header']['version']))


def add_dir(z, folder, arc_root):
    for base, _, files in os.walk(folder):
        for f in sorted(files):
            if f.startswith('.') or f.endswith('.pyc'):
                continue
            full = os.path.join(base, f)
            rel = os.path.relpath(full, folder).replace(os.sep, '/')
            z.write(full, f'{arc_root}/{rel}' if arc_root else rel)


addon = os.path.join(dist, 'Shaftbreaker.mcaddon')
with zipfile.ZipFile(addon, 'w', zipfile.ZIP_DEFLATED) as z:
    add_dir(z, os.path.join(ROOT, 'Shaftbreaker_BP'), 'Shaftbreaker_BP')
    add_dir(z, os.path.join(ROOT, 'Shaftbreaker_RP'), 'Shaftbreaker_RP')
for pack in ('Shaftbreaker_BP', 'Shaftbreaker_RP'):
    with zipfile.ZipFile(os.path.join(dist, f'{pack}.mcpack'), 'w', zipfile.ZIP_DEFLATED) as z:
        add_dir(z, os.path.join(ROOT, pack), '')
print(f'packaged {addon} ({os.path.getsize(addon) / 1e6:.2f} MB), version {version}')
