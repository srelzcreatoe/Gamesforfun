"""Build the Blockbench + Bedrock files for the three animatronics.

usage: python3 build.py [bramble] [hollis] [gildric]     (default: all three)
"""
import importlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bbgen import anims_to_bedrock
import anims

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def build(name):
    spec = importlib.import_module(f'spec_{name}')
    m = spec.build(os.path.join(HERE, 'references', f'{name}_ref.png'))
    m.paint()
    an = anims.make(name, m)
    json.dump(m.to_bbmodel(an), open(os.path.join(ROOT, 'blockbench', f'{name}.bbmodel'), 'w'), indent=1)
    json.dump(m.to_geo(), open(os.path.join(ROOT, 'bedrock/models/entity', f'{name}.geo.json'), 'w'), indent=1)
    json.dump(anims_to_bedrock(an), open(os.path.join(ROOT, 'bedrock/animations', f'{name}.animation.json'), 'w'), indent=1)
    m.atlas.save(os.path.join(ROOT, 'bedrock/textures/entity', f'{name}.png'))
    print(f'{name}: {len(m.cubes)} cubes, {len(m.bones)} bones, texture {m.tw}x{m.th}, {len(an)} animations')


if __name__ == '__main__':
    for n in sys.argv[1:] or ['bramble', 'hollis', 'gildric']:
        build(n)
