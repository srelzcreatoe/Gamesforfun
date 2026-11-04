"""Write a Blockbench project (.bbmodel) from the generated Bedrock geometry, texture and animations.

Usage: python3 export_bbmodel.py <geo.json> <texture.png> <animation.json> <out.bbmodel>
Blockbench stores positions in its own space (x mirrored relative to Bedrock files) and rotations with
x/y negated; animation keyframes are stored exactly as they appear in the .animation.json.
"""
import base64
import json
import sys
import uuid


def u():
    return str(uuid.uuid4())


def num(v):
    v = round(float(v), 4)
    return int(v) if v == int(v) else v


def main(geo_path, tex_path, anim_path, out_path):
    geo = json.load(open(geo_path))['minecraft:geometry'][0]
    desc = geo['description']
    TW, TH = desc['texture_width'], desc['texture_height']
    anims = json.load(open(anim_path))['animations']
    tex_b64 = base64.b64encode(open(tex_path, 'rb').read()).decode()

    elements, groups, order = [], {}, []
    for b in geo['bones']:
        gid = u()
        rot = b.get('rotation', [0, 0, 0])
        g = {
            'name': b['name'],
            'origin': [num(-b['pivot'][0]), num(b['pivot'][1]), num(b['pivot'][2])],
            'color': 0, 'uuid': gid, 'export': True, 'mirror_uv': False, 'isOpen': False,
            'locked': False, 'visibility': True, 'autouv': 0, 'children': [],
        }
        if any(rot):
            g['rotation'] = [num(-rot[0]), num(-rot[1]), num(rot[2])]
        for c in b.get('cubes', []):
            ox, oy, oz = c['origin']
            w, h, d = c['size']
            U, V = c['uv']
            cid = u()
            el = {
                'name': b['name'], 'box_uv': True, 'rescale': False, 'locked': False, 'render_order': 'default',
                'allow_mirror_modeling': True,
                'from': [num(-(ox + w)), num(oy), num(oz)],
                'to': [num(-ox), num(oy + h), num(oz + d)],
                'autouv': 0, 'color': 0, 'origin': [num(-b['pivot'][0]), num(b['pivot'][1]), num(b['pivot'][2])],
                'uv_offset': [U, V],
                'faces': {
                    'north': {'uv': [U + d, V + d, U + d + w, V + d + h], 'texture': 0},
                    'east': {'uv': [U, V + d, U + d, V + d + h], 'texture': 0},
                    'south': {'uv': [U + 2 * d + w, V + d, U + 2 * d + 2 * w, V + d + h], 'texture': 0},
                    'west': {'uv': [U + d + w, V + d, U + 2 * d + w, V + d + h], 'texture': 0},
                    'up': {'uv': [U + d + w, V + d, U + d, V], 'texture': 0},
                    'down': {'uv': [U + d + 2 * w, V, U + d + w, V + d], 'texture': 0},
                },
                'type': 'cube', 'uuid': cid,
            }
            elements.append(el)
            g['children'].append(cid)
        groups[b['name']] = (g, b.get('parent'))
        order.append(b['name'])

    outliner = []
    for name in order:
        g, parent = groups[name]
        (groups[parent][0]['children'] if parent else outliner).append(g)
    groups['root'][0]['isOpen'] = True

    animations = []
    for aname, a in anims.items():
        loop = a.get('loop', False)
        entry = {
            'uuid': u(), 'name': aname,
            'loop': 'loop' if loop is True else ('hold' if loop == 'hold_on_last_frame' else 'once'),
            'override': False, 'length': a.get('animation_length', 0), 'snapping': 60, 'selected': False,
            'saved': True, 'path': '', 'anim_time_update': '', 'blend_weight': '', 'start_delay': '', 'loop_delay': '',
            'animators': {},
        }
        for bone, chans in a.get('bones', {}).items():
            g = groups[bone][0]
            kfs = []
            for ch, val in chans.items():
                items = val.items() if isinstance(val, dict) else [('0', val)]
                for t, v in items:
                    if isinstance(v, dict):
                        v = v.get('post', v.get('pre'))
                    kfs.append({
                        'channel': ch,
                        'data_points': [{'x': v[0], 'y': v[1], 'z': v[2]}],
                        'uuid': u(), 'time': float(t), 'color': -1, 'interpolation': 'linear',
                    })
            entry['animators'][g['uuid']] = {'name': bone, 'type': 'bone', 'keyframes': kfs}
        animations.append(entry)

    model = {
        'meta': {'format_version': '4.10', 'model_format': 'bedrock', 'box_uv': True},
        'name': 'brinesleeper',
        'model_identifier': 'brinesleeper',
        'visible_box': [desc.get('visible_bounds_width', 5), desc.get('visible_bounds_height', 5), desc.get('visible_bounds_offset', [0, 1.75, 0])[1]],
        'variable_placeholders': '',
        'variable_placeholder_buttons': [],
        'timeline_setups': [],
        'unhandled_root_fields': {},
        'resolution': {'width': TW, 'height': TH},
        'elements': elements,
        'outliner': outliner,
        'textures': [{
            'path': '', 'name': 'brinesleeper.png', 'folder': '', 'namespace': '', 'id': '0',
            'width': TW, 'height': TH, 'uv_width': TW, 'uv_height': TH, 'particle': False,
            'use_as_default': False, 'layers_enabled': False, 'sync_to_project': '', 'render_mode': 'default',
            'render_sides': 'auto', 'frame_time': 1, 'frame_order_type': 'loop', 'frame_order': '',
            'frame_interpolate': False, 'visible': True, 'internal': True, 'saved': True, 'uuid': u(),
            'relative_path': '', 'source': 'data:image/png;base64,' + tex_b64,
        }],
        'animations': animations,
    }
    with open(out_path, 'w') as f:
        json.dump(model, f, separators=(',', ':'))
    print('bbmodel:', len(elements), 'cubes,', len(order), 'groups,', len(animations), 'animations')


if __name__ == '__main__':
    main(*sys.argv[1:5])
