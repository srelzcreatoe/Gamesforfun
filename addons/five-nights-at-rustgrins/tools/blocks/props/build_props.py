#!/usr/bin/env python3
"""Builds the section-B prop blocks of docs/BLOCKS.md (geometry, textures, BP blocks, fragments).

    python3 tools/blocks/props/build_props.py            # all props
    python3 tools/blocks/props/build_props.py crt_monitor desk_fan

Deterministic: every random choice is seeded from names. Writes
  packs/RP/models/blocks/<name>.geo.json
  packs/RP/textures/blocks/fnar/<tex>{,_mer,_height}.png + <tex>.texture_set.json
  packs/BP/blocks/<name>.json
  tools/fragments/{terrain,flipbook,local_lighting}_props.json
  tools/blocks/props/preview_manifest.json   (views for preview.mjs)
Then run `node tools/merge_fragments.mjs`.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import propkit as K  # noqa: E402

REGISTRY = K.REGISTRY


class Out:
    def __init__(self):
        self.terrain = self._load(K.FRAG_DIR / 'terrain_props.json', {})
        self.flip = {e['atlas_tile']: e for e in self._load(K.FRAG_DIR / 'flipbook_props.json', [])}
        self.lights = self._load(K.FRAG_DIR / 'local_lighting_props.json', {})
        self.manifest = self._load(HERE / 'preview_manifest.json', {})
        self.stats = {}

    @staticmethod
    def _load(p, default):
        try:
            return json.loads(p.read_text())
        except Exception:
            return default

    def tex(self, tex, sheet):
        K.save_texture(tex, sheet)
        self.terrain[f'fnar_{tex}'] = {'textures': f'textures/blocks/fnar/{tex}'}

    def flipbook(self, tex, ticks):
        self.flip[f'fnar_{tex}'] = {'flipbook_texture': f'textures/blocks/fnar/{tex}', 'atlas_tile': f'fnar_{tex}',
                                    'ticks_per_frame': ticks}

    def geo(self, geo, variants=None):
        K.write_json(K.GEO_DIR / f'{geo.name}.geo.json', geo.export(variants))
        self.stats[geo.name] = geo.cube_count()

    def block(self, name, blk):
        K.write_json(K.BLOCK_DIR / f'{name}.json', blk)

    def light(self, name, color, kind='static_light'):
        self.lights[f'fnar:{name}'] = {'light_color': color, 'light_type': kind}

    def views(self, name, views):
        self.manifest[name] = views

    def save(self):
        K.write_json(K.FRAG_DIR / 'terrain_props.json', dict(sorted(self.terrain.items())))
        K.write_json(K.FRAG_DIR / 'flipbook_props.json', [self.flip[k] for k in sorted(self.flip)])
        K.write_json(K.FRAG_DIR / 'local_lighting_props.json', dict(sorted(self.lights.items())))
        K.write_json(HERE / 'preview_manifest.json', dict(sorted(self.manifest.items())))


def main(argv):
    import props_office  # noqa: F401
    import props_party  # noqa: F401
    import props_service  # noqa: F401
    names = argv or list(REGISTRY)
    out = Out()
    for n in names:
        if n not in REGISTRY:
            raise SystemExit(f'unknown prop {n}; known: {", ".join(REGISTRY)}')
        REGISTRY[n](out)
        print(f'built {n:16s} cubes={out.stats.get(n, "?")}')
    out.save()


if __name__ == '__main__':
    main(sys.argv[1:])
