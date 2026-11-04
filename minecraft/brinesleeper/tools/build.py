"""Build the Brinesleeper Bedrock geometry + texture."""
import json, os, sys
from rig import build
from texture import pack, Painter, TEX_W, TEX_H

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)


def r(v):
    v = round(float(v), 4)
    return int(v) if v == int(v) else v


def geo_json(rig):
    bones = []
    for b in rig.bones:
        e = {'name': b.name}
        if b.parent:
            e['parent'] = b.parent
        e['pivot'] = [r(v) for v in b.pivot]
        if any(abs(x) > 1e-9 for x in b.rotation):
            e['rotation'] = [r(v) for v in b.rotation]
        if b.cubes:
            e['cubes'] = [{'origin': [r(v) for v in c.origin], 'size': c.size, 'uv': c.uv} for c in b.cubes]
        bones.append(e)
    return {
        'format_version': '1.12.0',
        'minecraft:geometry': [{
            'description': {
                'identifier': 'geometry.brinesleeper',
                'texture_width': TEX_W,
                'texture_height': TEX_H,
                'visible_bounds_width': 5,
                'visible_bounds_height': 5,
                'visible_bounds_offset': [0, 1.75, 0],
            },
            'bones': bones,
        }],
    }


if __name__ == '__main__':
    rig = build()
    used = pack(list(rig.all_cubes()))
    img = Painter(rig).paint()
    img.save(os.path.join(OUT, 'brinesleeper.png'))
    with open(os.path.join(OUT, 'brinesleeper.geo.json'), 'w') as f:
        json.dump(geo_json(rig), f, indent=2)
    print('texture rows used', used, 'of', TEX_H)
