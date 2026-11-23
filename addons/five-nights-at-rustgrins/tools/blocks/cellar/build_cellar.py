#!/usr/bin/env python3
"""Builds the cellar's own blocks (docs/BLOCKS.md section G): the Golden Dog Supper Club's finishes, its
furniture and its wreckage, the Other Office's dead controls, and the pictures the Golden Dog leaves upstairs.

    python3 tools/blocks/cellar/build_cellar.py            # everything
    python3 tools/blocks/cellar/build_cellar.py ghost_light club_table

Built with the props' toolkit (tools/blocks/props/propkit.py: palette ramps, PBR intent per material, one
texel per model pixel). Deterministic. Writes
  packs/BP/blocks/<name>.json
  packs/RP/models/blocks/<name>.geo.json
  packs/RP/textures/blocks/fnar/<tex>{,_mer,_height}.png + <tex>.texture_set.json
  tools/fragments/{terrain,local_lighting}_cellar.json    (its own fragments: nothing shared is rewritten)
Then run `node tools/merge_fragments.mjs`.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'props'))
sys.path.insert(0, str(HERE))

import propkit as K  # noqa: E402


class Out:
    """Where a builder writes: like build_props.Out, into the cellar's own fragment files."""

    def __init__(self):
        self.terrain = {}
        self.lights = {}
        self.stats = {}

    def tex(self, tex, sheet):
        K.save_texture(tex, sheet)
        self.terrain[f'fnar_{tex}'] = {'textures': f'textures/blocks/fnar/{tex}'}

    def geo(self, geo, variants=None):
        K.write_json(K.GEO_DIR / f'{geo.name}.geo.json', geo.export(variants))
        self.stats[geo.name] = geo.cube_count()

    def block(self, name, blk):
        K.write_json(K.BLOCK_DIR / f'{name}.json', blk)

    def light(self, name, color, kind='static_light'):
        self.lights[f'fnar:{name}'] = {'light_color': color, 'light_type': kind}

    def views(self, name, views):  # the props' preview sheets are not used here
        pass

    def save(self, partial):
        for attr, f in (('terrain', 'terrain_cellar.json'), ('lights', 'local_lighting_cellar.json')):
            cur = getattr(self, attr)
            if partial:  # only some blocks were rebuilt: keep the others' entries
                try:
                    cur = {**json.loads((K.FRAG_DIR / f).read_text()), **cur}
                except Exception:
                    pass
            K.write_json(K.FRAG_DIR / f, dict(sorted(cur.items())))


def main(argv):
    import cellar_surfaces  # noqa: F401
    import cellar_props  # noqa: F401
    import cellar_pictures  # noqa: F401
    names = argv or list(K.REGISTRY)
    out = Out()
    for n in names:
        if n not in K.REGISTRY:
            raise SystemExit(f'unknown block {n}; known: {", ".join(K.REGISTRY)}')
        K.REGISTRY[n](out)
        print(f'built {n:24s} cubes={out.stats.get(n, "-")}')
    out.save(partial=bool(argv))


if __name__ == '__main__':
    main(sys.argv[1:])
