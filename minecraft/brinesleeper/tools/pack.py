"""Assemble the Bedrock resource pack, behavior pack, .mcaddon and Blockbench project."""
import json, os, shutil, sys, uuid, zipfile
from PIL import Image

import biome
import horror

SRC = 'out'
DST = sys.argv[1]
RP = os.path.join(DST, 'resource_pack')
BP = os.path.join(DST, 'behavior_pack')
ID = 'brine:brinesleeper'

# fixed UUIDs so re-running the script produces the same packs
RP_H, RP_M = '7b0d8f0e-3c1a-4c55-9a52-2b8f6f1c9e01', '7b0d8f0e-3c1a-4c55-9a52-2b8f6f1c9e02'
BP_H, BP_M = '7b0d8f0e-3c1a-4c55-9a52-2b8f6f1c9e03', '7b0d8f0e-3c1a-4c55-9a52-2b8f6f1c9e04'
BP_S = '7b0d8f0e-3c1a-4c55-9a52-2b8f6f1c9e05'
ENGINE = [1, 26, 40]          # Bedrock 1.26.40: the stable @minecraft/server 2.9.0 and @minecraft/server-ui 2.1.0
VER = [4, 0, 0]   # bump on every release so Minecraft imports the update over an older copy


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=2)
        f.write('\n')


for d in (RP, BP):
    if os.path.exists(d):
        shutil.rmtree(d)

# ------------------------------------------------------------------ resource pack
write(f'{RP}/manifest.json', {
    'format_version': 2,
    'header': {'name': 'Brinesleeper Resources',
               'description': 'The Brinesleeper: The Water Remembers. A horror creature and its home, the Stillwater Caves',
               'uuid': RP_H, 'version': VER, 'min_engine_version': ENGINE},
    'modules': [{'type': 'resources', 'uuid': RP_M, 'version': VER}],
})
os.makedirs(f'{RP}/texts', exist_ok=True)
with open(f'{RP}/texts/en_US.lang', 'w') as f:
    f.write(f'entity.{ID}.name=Brinesleeper\nitem.spawn_egg.entity.{ID}.name=Spawn Brinesleeper\n' + biome.lang_lines() + horror.lang_lines())
write(f'{RP}/texts/languages.json', ['en_US'])

# ------------------------------------------------------------------ behavior pack
write(f'{BP}/manifest.json', {
    'format_version': 2,
    'header': {'name': 'Brinesleeper Behaviors',
               'description': 'The Brinesleeper: The Water Remembers. A hidden director, the creature, and the Stillwater Caves',
               'uuid': BP_H, 'version': VER, 'min_engine_version': ENGINE},
    'modules': [{'type': 'data', 'uuid': BP_M, 'version': VER},
                {'type': 'script', 'language': 'javascript', 'uuid': BP_S, 'version': VER, 'entry': 'scripts/index.js'}],
    'dependencies': [{'uuid': RP_H, 'version': VER},
                     {'module_name': '@minecraft/server', 'version': '2.9.0'},
                     {'module_name': '@minecraft/server-ui', 'version': '2.1.0'}],
})

# the Stillwater Caves biome: definition, blocks, decorations, fog, sounds
biome.build(RP, BP, audio=os.path.join(DST, '..', '..', 'assets', 'audio'))

# the creature, its apparitions, poses, particles, sounds and the director script
horror.build(RP, BP, SRC, biome.SPAWN_CONDITIONS, audio=os.path.join(DST, '..', '..', 'assets', 'audio'))

# pack icons from the face close-up
face = Image.open(sys.argv[2]).convert('RGB')
s = min(face.size)
icon = face.crop(((face.width - s) // 2, 0, (face.width - s) // 2 + s, s)).resize((256, 256), Image.LANCZOS)
icon.save(f'{RP}/pack_icon.png'); icon.save(f'{BP}/pack_icon.png')

# .mcaddon (zip of both packs) for one-tap import on Bedrock
addon = os.path.join(DST, 'Brinesleeper.mcaddon')
with zipfile.ZipFile(addon, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, name in ((RP, 'Brinesleeper_RP'), (BP, 'Brinesleeper_BP')):
        for root, _, files in os.walk(base):
            for fn in files:
                full = os.path.join(root, fn)
                z.write(full, os.path.join(name, os.path.relpath(full, base)))
print('packs written to', DST)
