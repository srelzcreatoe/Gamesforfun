"""Behavior-pack block definitions, the shared picture-panel geometry and the
RP registry fragments for section A (surfaces, signage, lights).

Writes:
  packs/BP/blocks/<name>.json
  packs/RP/models/blocks/wall_panel.geo.json
  tools/fragments/terrain_surfaces.json
  tools/fragments/local_lighting_surfaces.json
Run after the texture generators (build_all.py does everything).
"""
import json
import os

import numpy as np
from PIL import Image

from geo import MODELS_DIR
from pixlib import ROOT, TEX_DIR

BP_BLOCKS = os.path.join(ROOT, 'packs', 'BP', 'blocks')
FRAG = os.path.join(ROOT, 'tools', 'fragments')
FORMAT = '1.26.50'

DIRS = {'north': 0, 'west': 90, 'south': 180, 'east': -90}

# full cubes: name -> (texture or {face: texture}, seconds_to_destroy)
CUBES = {
    'tile_checker': ('tile_checker', 1.5),
    'tile_checker_worn': ('tile_checker_worn', 1.5),
    'tile_office': ('tile_office', 1.5),
    'tile_kitchen': ('tile_kitchen', 1.5),
    'wall_checker': ('wall_checker', 1.5),
    'wall_plaster': ('wall_plaster', 1.5),
    'wall_plaster_stained': ('wall_plaster_stained', 1.5),
    'wallpaper_maroon': ('wallpaper_maroon', 1.5),
    'wall_trim': ('wall_trim', 1.5),
    'cinderblock_painted': ('cinderblock_painted', 2.0),
    'ceiling_tile': ('ceiling_tile', 1.0),
    'ceiling_tile_stained': ('ceiling_tile_stained', 1.0),
    'carpet_party': ('carpet_party', 1.0),
    'curtain_purple': ('curtain_purple', 1.0),
    'curtain_red': ('curtain_red', 1.0),
    'tent_stripe': ('tent_stripe', 1.0),
    'duct_metal': ('duct_metal', 2.5),
    'stage_floor': ('stage_floor', 1.5),
}

# picture panels: name -> number of tiles (or variants)
PANELS = {
    'poster_revue': 6, 'poster_party': 4, 'poster_cabaret': 6, 'poster_midway': 6, 'poster_rules': 4,
    'poster_missing': 2, 'drawing': 6, 'sign_cabaret': 3, 'sign_out_of_order': 2, 'sign_midway': 4,
    'sign_revue': 12, 'sign_staff': 4,
}
PANEL_LIGHT = {'sign_revue': 7, 'sign_cabaret': 4, 'sign_midway': 4}

# lights: name -> (geometry, light level, local light colour, light type, selection box (origin, size))
LIGHTS = {
    'ceiling_lamp': (None, 13, '#dfe8ff', 'static_light', None),
    'exit_sign': ('exit_sign', 5, '#3cff6e', 'static_light', ([-7, 9, 6], [14, 7, 2])),
    'wall_sconce': ('wall_sconce', 10, '#ffc98a', 'point_light', ([-4, 4, 3], [8, 9, 5])),
    'stage_spotlight': ('stage_spotlight', 12, '#ffe2b0', 'point_light', ([-5, 2, -8], [10, 14, 13])),
    'hanging_lamp': ('hanging_lamp', 11, '#ffc98a', 'point_light', ([-5, 4, -5], [10, 12, 10])),
}
FACING_LIGHTS = {'exit_sign', 'wall_sconce', 'stage_spotlight'}
SIGN_LIGHT_COLORS = {'sign_revue': ('#ff6fb5', 'static_light'), 'sign_cabaret': ('#ffd27a', 'static_light'),
                     'sign_midway': ('#ffd27a', 'static_light')}


def tex_ref(t):
    return f'fnar_{t}'


def map_color(tex):
    im = np.array(Image.open(os.path.join(TEX_DIR, f'{tex}.png')).convert('RGBA')).astype(float)
    m = im[..., 3] > 0
    c = im[..., :3][m].mean(0)
    return '#%02x%02x%02x' % tuple(int(round(v)) for v in c)


def block(name, components, states=None, traits=None, permutations=None, category='construction'):
    desc = {'identifier': f'fnar:{name}', 'menu_category': {'category': category}}
    if states:
        desc['states'] = states
    if traits:
        desc['traits'] = traits
    b = {'description': desc, 'components': components}
    if permutations:
        b['permutations'] = permutations
    return {'format_version': FORMAT, 'minecraft:block': b}


def facing_traits():
    return {'minecraft:placement_direction': {'enabled_states': ['minecraft:cardinal_direction'],
                                              'y_rotation_offset': 180}}


def facing_perms():
    return [{'condition': f"q.block_state('minecraft:cardinal_direction') == '{d}'",
             'components': {'minecraft:transformation': {'rotation': [0, r, 0]}}} for d, r in DIRS.items()]


def mats(tex, method='opaque', glow_lit=None):
    m = {'*': {'texture': tex_ref(tex), 'render_method': method}}
    if glow_lit is not None:
        g = {'texture': tex_ref(tex), 'render_method': method}
        if glow_lit:
            g['face_dimming'] = False
            g['ambient_occlusion'] = 0
        m['glow'] = g
    return m


def cube_blocks():
    out = {}
    for name, (tex, secs) in CUBES.items():
        out[name] = block(name, {
            'minecraft:geometry': 'minecraft:geometry.full_block',
            'minecraft:material_instances': mats(tex),
            'minecraft:collision_box': True,
            'minecraft:selection_box': True,
            'minecraft:destructible_by_mining': {'seconds_to_destroy': secs},
            'minecraft:map_color': map_color(tex),
        })
    # steel security shutter: part 0 = plain panel, 1 = bottom panel with the hazard band
    side = lambda t: {'*': {'texture': tex_ref(t), 'render_method': 'opaque'},
                      'up': {'texture': tex_ref('door_shutter'), 'render_method': 'opaque'},
                      'down': {'texture': tex_ref('door_shutter'), 'render_method': 'opaque'}}
    out['door_shutter'] = block('door_shutter', {
        'minecraft:geometry': 'minecraft:geometry.full_block',
        'minecraft:material_instances': side('door_shutter'),
        'minecraft:collision_box': True,
        'minecraft:selection_box': True,
        'minecraft:destructible_by_mining': {'seconds_to_destroy': 3},
        'minecraft:map_color': map_color('door_shutter'),
    }, states={'fnar:part': [0, 1]}, permutations=[
        {'condition': "q.block_state('fnar:part') == 1",
         'components': {'minecraft:material_instances': side('door_shutter_bottom')}},
    ], category='none')
    return out


def light_blocks():
    out = {}
    for name, (geo, level, _, _, sel) in LIGHTS.items():
        lit_perm = []
        for lit in (True, False):
            tex = f'{name}_{"on" if lit else "off"}'
            if geo is None:  # ceiling lamp: full block, troffer on the bottom face, ceiling tile elsewhere
                mi = {'*': {'texture': tex_ref('ceiling_tile'), 'render_method': 'opaque'},
                      'down': {'texture': tex_ref(tex), 'render_method': 'opaque'}}
                if lit:
                    mi['down']['face_dimming'] = False
            else:
                mi = mats(tex, 'alpha_test', glow_lit=lit)
            lit_perm.append({'condition': f"q.block_state('fnar:lit') == {'true' if lit else 'false'}",
                             'components': {'minecraft:material_instances': mi,
                                            'minecraft:light_emission': level if lit else 0}})
        comps = {
            'minecraft:destructible_by_mining': {'seconds_to_destroy': 1},
            'minecraft:map_color': map_color(f'{name}_on'),
            'minecraft:material_instances': lit_perm[0]['components']['minecraft:material_instances'],
            'minecraft:light_emission': level,
        }
        if geo is None:
            comps.update({'minecraft:geometry': 'minecraft:geometry.full_block', 'minecraft:collision_box': True,
                          'minecraft:selection_box': True})
        else:
            comps.update({'minecraft:geometry': f'geometry.fnar.{geo}', 'minecraft:collision_box': False,
                          'minecraft:selection_box': {'origin': sel[0], 'size': sel[1]},
                          'minecraft:light_dampening': 0})
        perms = lit_perm
        traits = None
        states = {'fnar:lit': [True, False]}
        if name in FACING_LIGHTS:
            traits = facing_traits()
            perms = facing_perms() + lit_perm
        out[name] = block(name, comps, states=states, traits=traits, permutations=perms)
    return out


def panel_blocks():
    out = {}
    for name, n in PANELS.items():
        perms = facing_perms()
        for i in range(n):
            perms.append({'condition': f"q.block_state('fnar:tile') == {i}",
                          'components': {'minecraft:material_instances': mats(f'{name}_{i}', 'alpha_test')}})
        comps = {
            'minecraft:geometry': 'geometry.fnar.wall_panel',
            'minecraft:material_instances': mats(f'{name}_0', 'alpha_test'),
            'minecraft:collision_box': False,
            'minecraft:selection_box': {'origin': [-8, 0, 7], 'size': [16, 16, 1]},
            'minecraft:light_dampening': 0,
            'minecraft:destructible_by_mining': {'seconds_to_destroy': 1},
            'minecraft:map_color': map_color(f'{name}_0'),
        }
        if name in PANEL_LIGHT:
            comps['minecraft:light_emission'] = PANEL_LIGHT[name]
        out[name] = block(name, comps, states={'fnar:tile': list(range(n))}, traits=facing_traits(),
                          permutations=perms)
    return out


def wall_panel_geo():
    """16x16x1 panel with its back on the south side of the cell (z 7..8), front facing north."""
    return {
        'format_version': '1.12.0',
        'minecraft:geometry': [{
            'description': {'identifier': 'geometry.fnar.wall_panel', 'texture_width': 16, 'texture_height': 16,
                            'visible_bounds_width': 2, 'visible_bounds_height': 2,
                            'visible_bounds_offset': [0, 0.5, 0]},
            'bones': [{'name': 'panel', 'pivot': [0, 0, 0], 'cubes': [{
                'origin': [-8, 0, 7], 'size': [16, 16, 1],
                'uv': {'north': {'uv': [0, 0], 'uv_size': [16, 16]},
                       'south': {'uv': [0, 0], 'uv_size': [16, 16]},
                       'east': {'uv': [0, 0], 'uv_size': [1, 16]},
                       'west': {'uv': [15, 0], 'uv_size': [1, 16]},
                       'up': {'uv': [0, 0], 'uv_size': [16, 1]},
                       'down': {'uv': [0, 15], 'uv_size': [16, 1]}}}]}],
        }],
    }


def all_textures():
    names = []
    for f in sorted(os.listdir(TEX_DIR)):
        if f.endswith('.texture_set.json'):
            names.append(f[:-len('.texture_set.json')])
    return names


def section_textures():
    t = []
    t += [tex for tex, _ in CUBES.values()]
    t += ['door_shutter', 'door_shutter_bottom']
    for name in LIGHTS:
        t += [f'{name}_on', f'{name}_off']
    for name, n in PANELS.items():
        t += [f'{name}_{i}' for i in range(n)]
    return t


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=2)
        f.write('\n')


def build():
    blocks = {}
    blocks.update(cube_blocks())
    blocks.update(light_blocks())
    blocks.update(panel_blocks())
    for name, b in blocks.items():
        write_json(os.path.join(BP_BLOCKS, f'{name}.json'), b)
    write_json(os.path.join(MODELS_DIR, 'wall_panel.geo.json'), wall_panel_geo())
    texs = section_textures()
    missing = [t for t in texs if not os.path.exists(os.path.join(TEX_DIR, f'{t}.png'))]
    if missing:
        raise SystemExit(f'missing textures: {missing}')
    write_json(os.path.join(FRAG, 'terrain_surfaces.json'),
               {tex_ref(t): {'textures': f'textures/blocks/fnar/{t}'} for t in texs})
    lights = {f'fnar:{n}': {'light_color': c, 'light_type': ty} for n, (_, _, c, ty, _) in LIGHTS.items()}
    for n, (c, ty) in SIGN_LIGHT_COLORS.items():
        lights[f'fnar:{n}'] = {'light_color': c, 'light_type': ty}
    write_json(os.path.join(FRAG, 'local_lighting_surfaces.json'), lights)
    return blocks, texs


if __name__ == '__main__':
    b, t = build()
    print(f'{len(b)} blocks, {len(t)} textures')
