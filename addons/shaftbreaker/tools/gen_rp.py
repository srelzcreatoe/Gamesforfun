"""Generates the remaining resource-pack definitions: moth/waypoint clients, skull attachable,
block models, particles, texture atlases, block sounds and language files."""
import json, os, copy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, 'Shaftbreaker_RP')
BP = os.path.join(ROOT, 'Shaftbreaker_BP')
MODEL = os.path.join(ROOT, 'src_assets/model')
NS = 'shaftbreaker'


def w(rel, obj, base=RP):
    p = os.path.join(base, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(obj, open(p, 'w'), indent=2)


# =============================================================== moth
def moth():
    def plane(o, s, uv, us):
        return {'origin': o, 'size': s, 'uv': {'up': {'uv': uv, 'uv_size': us}, 'down': {'uv': uv, 'uv_size': us}}}
    geo = {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': 'geometry.shaft_moth', 'texture_width': 32, 'texture_height': 32,
                        'visible_bounds_width': 1.5, 'visible_bounds_height': 1, 'visible_bounds_offset': [0, 0.25, 0]},
        'bones': [
            {'name': 'root', 'pivot': [0, 0, 0]},
            {'name': 'body', 'parent': 'root', 'pivot': [0, 3, 0], 'cubes': [
                {'origin': [-1, 2, -3], 'size': [2, 2, 6], 'uv': {f: {'uv': [0, 16], 'uv_size': [6, 2]} for f in ['north', 'south', 'east', 'west', 'up', 'down']}},
                {'origin': [-1, 2.5, -4.5], 'size': [2, 1.5, 1.5], 'uv': {f: {'uv': [0, 16], 'uv_size': [4, 2]} for f in ['north', 'south', 'east', 'west', 'up', 'down']}},
                {'origin': [-0.75, 3.5, -6], 'size': [0.25, 0.25, 1.75], 'uv': {f: {'uv': [8, 20], 'uv_size': [1, 1]} for f in ['north', 'south', 'east', 'west', 'up', 'down']}},
                {'origin': [0.5, 3.5, -6], 'size': [0.25, 0.25, 1.75], 'uv': {f: {'uv': [8, 20], 'uv_size': [1, 1]} for f in ['north', 'south', 'east', 'west', 'up', 'down']}},
            ]},
            {'name': 'wing_fl', 'parent': 'body', 'pivot': [1, 4, -1], 'cubes': [plane([1, 4, -3], [7, 0, 5], [0, 0], [14, 10])]},
            {'name': 'wing_fr', 'parent': 'body', 'pivot': [-1, 4, -1], 'cubes': [plane([-8, 4, -3], [7, 0, 5], [14, 0], [-14, 10])]},
            {'name': 'wing_bl', 'parent': 'body', 'pivot': [1, 3.8, 1], 'cubes': [plane([1, 3.8, 0.5], [5, 0, 4], [16, 0], [12, 8])]},
            {'name': 'wing_br', 'parent': 'body', 'pivot': [-1, 3.8, 1], 'cubes': [plane([-6, 3.8, 0.5], [5, 0, 4], [28, 0], [-12, 8])]},
        ]}]}
    w('models/entity/shaft_moth.geo.json', geo)
    flap = 'math.sin(q.life_time * 1500.0 + v.phase) * 48.0'
    w('animations/shaft_moth.animation.json', {'format_version': '1.8.0', 'animations': {
        'animation.shaft_moth.fly': {'loop': True, 'bones': {
            'wing_fl': {'rotation': [0, 0, f'-10.0 - {flap}']},
            'wing_fr': {'rotation': [0, 0, f'10.0 + {flap}']},
            'wing_bl': {'rotation': [0, 0, f'-6.0 - {flap} * 0.8']},
            'wing_br': {'rotation': [0, 0, f'6.0 + {flap} * 0.8']},
            'body': {'position': [0, 'math.sin(q.life_time * 300.0 + v.phase) * 0.6', 0],
                     'rotation': ['math.sin(q.life_time * 140.0) * 8.0', 0, 'math.sin(q.life_time * 90.0 + v.phase) * 12.0']}}},
        'animation.shaft_moth.dust': {'loop': True, 'animation_length': 1.4,
                                      'particle_effects': {'0.0': {'effect': 'dust'}}},
    }})
    w('entity/shaft_moth.entity.json', {'format_version': '1.10.0', 'minecraft:client_entity': {'description': {
        'identifier': f'{NS}:shaft_moth',
        'materials': {'default': 'entity_alphatest'},
        'textures': {'default': 'textures/entity/shaft_moth/shaft_moth'},
        'geometry': {'default': 'geometry.shaft_moth'},
        'scripts': {'initialize': ['v.phase = math.random(0, 360);'], 'animate': ['fly', {'dust': "q.property('shaftbreaker:clue') ? 1.0 : 0.25"}]},
        'animations': {'fly': 'animation.shaft_moth.fly', 'dust': 'animation.shaft_moth.dust'},
        'particle_effects': {'dust': 'shaftbreaker:mote'},
        'render_controllers': ['controller.render.default'],
        'spawn_egg': {'base_color': '#6e665c', 'overlay_color': '#efe6d2'},
    }}})


# =============================================================== waypoint (never visible)
def waypoint():
    w('models/entity/sb_empty.geo.json', {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': 'geometry.sb_empty', 'texture_width': 16, 'texture_height': 16,
                        'visible_bounds_width': 0.1, 'visible_bounds_height': 0.1, 'visible_bounds_offset': [0, 0, 0]},
        'bones': [{'name': 'root', 'pivot': [0, 0, 0]}]}]})
    w('entity/waypoint.entity.json', {'format_version': '1.10.0', 'minecraft:client_entity': {'description': {
        'identifier': f'{NS}:waypoint',
        'materials': {'default': 'entity_alphatest'},
        'textures': {'default': 'textures/entity/shaft_moth/shaft_moth'},
        'geometry': {'default': 'geometry.sb_empty'},
        'render_controllers': ['controller.render.default'],
    }}})


# =============================================================== skull attachable (worn trophy)
def skull():
    g = json.load(open(os.path.join(MODEL, 'shaftbreaker.geo.json')))['minecraft:geometry'][0]
    head = next(b for b in g['bones'] if b['name'] == 'head')
    jaw = next(b for b in g['bones'] if b['name'] == 'jaw')

    def tx(cubes, dy, s, cy):
        out = []
        for c in cubes:
            c = copy.deepcopy(c)
            o = c['origin']; sz = c['size']
            c['origin'] = [round(o[0] * s, 4), round((o[1] - cy) * s + cy + dy, 4), round(o[2] * s, 4)]
            c['size'] = [round(v * s, 4) for v in sz]
            if 'pivot' in c:
                p = c['pivot']; c['pivot'] = [round(p[0] * s, 4), round((p[1] - cy) * s + cy + dy, 4), round(p[2] * s, 4)]
            out.append(c)
        return out
    cy = 78.0
    worn_dy = 28.2 - cy
    held_s = 0.5
    bones = [
        {'name': 'worn', 'parent': 'head', 'pivot': [0, 24, 0], 'cubes': tx(head['cubes'] + jaw['cubes'], worn_dy, 1.1, cy)},
        {'name': 'held', 'parent': 'rightItem', 'pivot': [0, 0, 0], 'cubes': tx(head['cubes'] + jaw['cubes'], 4 - cy, held_s, cy)},
    ]
    w('models/entity/sb_skull.geo.json', {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': 'geometry.sb_skull', 'texture_width': 256, 'texture_height': 128,
                        'visible_bounds_width': 2, 'visible_bounds_height': 3, 'visible_bounds_offset': [0, 1.5, 0]},
        'bones': bones}]})
    # icon geometry (single bone, centered) used by the previewer for the inventory icon
    w(os.path.join(ROOT, 'build/sb_skull_icon.geo.json'), {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': 'geometry.sb_skull_icon', 'texture_width': 256, 'texture_height': 128},
        'bones': [{'name': 'skull', 'pivot': [0, 0, 0], 'cubes': tx(head['cubes'] + jaw['cubes'], 0, 1.0, cy)}]}]}, base='/')
    w('attachables/shaftbreaker_skull.json', {'format_version': '1.10.0', 'minecraft:attachable': {'description': {
        'identifier': f'{NS}:shaftbreaker_skull',
        'materials': {'default': 'entity_alphatest', 'enchanted': 'entity_alphatest_glint'},
        'textures': {'default': 'textures/entity/shaftbreaker/shaftbreaker', 'enchanted': 'textures/misc/enchanted_actor_glint'},
        'geometry': {'default': 'geometry.sb_skull'},
        'render_controllers': ['controller.render.sb_skull'],
    }}})
    w('render_controllers/sb_skull.render_controllers.json', {'format_version': '1.10.0', 'render_controllers': {
        'controller.render.sb_skull': {
            'geometry': 'Geometry.default',
            'materials': [{'*': 'Material.default'}],
            'textures': ['Texture.default', 'Texture.enchanted'],
            'part_visibility': [{'*': True}, {'worn': "c.item_slot == 'head'"}, {'held': "c.item_slot != 'head'"}],
        }}})


# =============================================================== block models
def block_models():
    def face_uv(uvsz):
        return {f: {'uv': [0, 0], 'uv_size': uvsz} for f in ['north', 'south', 'east', 'west', 'up', 'down']}
    w('models/blocks/sb_dust_layer.geo.json', {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': 'geometry.sb_dust_layer', 'texture_width': 16, 'texture_height': 16},
        'bones': [{'name': 'b', 'pivot': [0, 0, 0], 'cubes': [{'origin': [-8, 0, -8], 'size': [16, 1, 16], 'uv': face_uv([16, 16])}]}]}]})
    w('models/blocks/sb_spine.geo.json', {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': 'geometry.sb_spine', 'texture_width': 16, 'texture_height': 16},
        'bones': [{'name': 'b', 'pivot': [0, 0, 0], 'cubes': [
            {'origin': [-8, 0, 0], 'size': [16, 16, 0], 'pivot': [0, 0, 0], 'rotation': [0, 45, 0],
             'uv': {'north': {'uv': [0, 0], 'uv_size': [16, 16]}, 'south': {'uv': [0, 0], 'uv_size': [16, 16]}}},
            {'origin': [-8, 0, 0], 'size': [16, 16, 0], 'pivot': [0, 0, 0], 'rotation': [0, -45, 0],
             'uv': {'north': {'uv': [0, 0], 'uv_size': [16, 16]}, 'south': {'uv': [0, 0], 'uv_size': [16, 16]}}},
        ]}]}]})
    w('models/blocks/sb_cairn.geo.json', {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': 'geometry.sb_cairn', 'texture_width': 16, 'texture_height': 16},
        'bones': [{'name': 'b', 'pivot': [0, 0, 0], 'cubes': [
            {'origin': [-4, 0, -4], 'size': [8, 3, 8], 'uv': face_uv([8, 3])},
            {'origin': [-3, 3, -3], 'size': [6, 3, 6], 'uv': face_uv([6, 3])},
            {'origin': [-2, 6, -2], 'size': [4, 3, 4], 'uv': {**face_uv([4, 3]), 'up': {'uv': [0, 0], 'uv_size': [16, 16], 'material_instance': 'top'}}},
            {'origin': [-0.5, 6.5, -3.5], 'size': [1, 1, 1.5], 'uv': face_uv([1, 1])},
        ]}]}]})


# =============================================================== particles
TEX = 'textures/particle/sb_particles'


def cell(cx, cy):
    return {'texture_width': 64, 'texture_height': 64, 'uv': [cx * 16, cy * 16], 'uv_size': [16, 16]}


def particle(ident, comps, material='particles_alpha'):
    return {'format_version': '1.10.0', 'particle_effect': {
        'description': {'identifier': ident, 'basic_render_parameters': {'material': material, 'texture': TEX}},
        'components': comps}}


def particles():
    P = {}
    P['debris'] = particle('shaftbreaker:debris', {
        'minecraft:emitter_rate_instant': {'num_particles': 16},
        'minecraft:emitter_lifetime_once': {'active_time': 0.1},
        'minecraft:emitter_shape_sphere': {'radius': 0.35, 'direction': 'outwards'},
        'minecraft:particle_initial_speed': '3.0 + v.particle_random_1 * 3.0',
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.9 + v.particle_random_2 * 0.8'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -16, 0], 'linear_drag_coefficient': 0.5},
        'minecraft:particle_motion_collision': {'coefficient_of_restitution': 0.25, 'collision_drag': 3, 'collision_radius': 0.05},
        'minecraft:particle_appearance_billboard': {'size': ['0.05 + v.particle_random_3 * 0.07', '0.05 + v.particle_random_3 * 0.07'],
                                                    'facing_camera_mode': 'rotate_xyz', 'uv': cell(1, 0)},
        'minecraft:particle_appearance_lighting': {},
        'minecraft:particle_appearance_tinting': {'color': [0.62, 0.58, 0.56, 1.0]},
    })
    P['step_dust'] = particle('shaftbreaker:step_dust', {
        'minecraft:emitter_rate_instant': {'num_particles': 7},
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_shape_disc': {'radius': 0.35, 'direction': 'outwards', 'plane_normal': 'y'},
        'minecraft:particle_initial_speed': 0.8,
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.8 + v.particle_random_1 * 0.6'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 0.4, 0], 'linear_drag_coefficient': 2.5},
        'minecraft:particle_appearance_billboard': {'size': ['0.18 + v.particle_age * 0.25', '0.18 + v.particle_age * 0.25'], 'facing_camera_mode': 'lookat_xyz', 'uv': cell(0, 0)},
        'minecraft:particle_appearance_lighting': {},
        'minecraft:particle_appearance_tinting': {'color': [0.55, 0.51, 0.47, '0.7 - v.particle_age / v.particle_lifetime * 0.7']},
    })
    P['dust_fall'] = particle('shaftbreaker:dust_fall', {
        'minecraft:emitter_rate_steady': {'spawn_rate': 22, 'max_particles': 60},
        'minecraft:emitter_lifetime_once': {'active_time': 1.6},
        'minecraft:emitter_shape_box': {'half_dimensions': [0.9, 0.05, 0.9], 'direction': [0, -1, 0]},
        'minecraft:particle_initial_speed': 0.4,
        'minecraft:particle_lifetime_expression': {'max_lifetime': 2.2},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -2.2, 0], 'linear_drag_coefficient': 1.4},
        'minecraft:particle_motion_collision': {'coefficient_of_restitution': 0, 'collision_drag': 10, 'collision_radius': 0.02, 'expire_on_contact': True},
        'minecraft:particle_appearance_billboard': {'size': ['0.03 + v.particle_random_1 * 0.04', '0.03 + v.particle_random_1 * 0.04'], 'facing_camera_mode': 'lookat_xyz', 'uv': cell(1, 0)},
        'minecraft:particle_appearance_lighting': {},
        'minecraft:particle_appearance_tinting': {'color': [0.66, 0.62, 0.58, 1]},
    })
    for name, mode in [('scratch_ns', 'emitter_transform_xy'), ('scratch_ew', 'emitter_transform_yz'), ('scratch_floor', 'emitter_transform_xz')]:
        P[name] = particle(f'shaftbreaker:{name}', {
            'minecraft:emitter_rate_instant': {'num_particles': 1},
            'minecraft:emitter_lifetime_once': {'active_time': 0.05},
            'minecraft:emitter_shape_point': {},
            'minecraft:particle_lifetime_expression': {'max_lifetime': 240},
            'minecraft:particle_initial_spin': {'rotation': '-25 + v.particle_random_1 * 50'},
            'minecraft:particle_appearance_billboard': {'size': [0.42, 0.42], 'facing_camera_mode': mode, 'uv': cell(2, 0)},
            'minecraft:particle_appearance_lighting': {},
            'minecraft:particle_appearance_tinting': {'color': [1, 1, 1, '1.0 - math.clamp((v.particle_age - 200) / 40, 0, 1)']},
        })
    P['mote'] = particle('shaftbreaker:mote', {
        'minecraft:emitter_rate_instant': {'num_particles': 2},
        'minecraft:emitter_lifetime_once': {'active_time': 0.05},
        'minecraft:emitter_shape_sphere': {'radius': 0.15, 'direction': 'outwards'},
        'minecraft:particle_initial_speed': 0.15,
        'minecraft:particle_lifetime_expression': {'max_lifetime': 1.8},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -0.25, 0], 'linear_drag_coefficient': 1},
        'minecraft:particle_appearance_billboard': {'size': [0.035, 0.035], 'facing_camera_mode': 'lookat_xyz', 'uv': cell(3, 0)},
        'minecraft:particle_appearance_tinting': {'color': [1, 0.95, 0.85, '1.0 - v.particle_age / v.particle_lifetime']},
    }, material='particles_blend')
    P['wisp'] = particle('shaftbreaker:wisp', {
        'minecraft:emitter_rate_instant': {'num_particles': 14},
        'minecraft:emitter_lifetime_once': {'active_time': 0.1},
        'minecraft:emitter_shape_box': {'half_dimensions': [0.4, 1.2, 0.4], 'offset': [0, 1.2, 0], 'direction': [0, 1, 0]},
        'minecraft:particle_initial_speed': 0.3,
        'minecraft:particle_lifetime_expression': {'max_lifetime': '1.4 + v.particle_random_1'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 0.5, 0], 'linear_drag_coefficient': 1.2},
        'minecraft:particle_appearance_billboard': {'size': ['0.25 + v.particle_age * 0.3', '0.25 + v.particle_age * 0.3'], 'facing_camera_mode': 'lookat_xyz', 'uv': cell(0, 1)},
        'minecraft:particle_appearance_tinting': {'color': [0.75, 0.78, 0.85, '0.55 - v.particle_age / v.particle_lifetime * 0.55']},
    }, material='particles_blend')
    P['vanish'] = particle('shaftbreaker:vanish', {
        'minecraft:emitter_rate_instant': {'num_particles': 24},
        'minecraft:emitter_lifetime_once': {'active_time': 0.1},
        'minecraft:emitter_shape_box': {'half_dimensions': [0.45, 1.4, 0.45], 'offset': [0, 1.4, 0], 'direction': 'outwards'},
        'minecraft:particle_initial_speed': 0.6,
        'minecraft:particle_lifetime_expression': {'max_lifetime': '1.0 + v.particle_random_1 * 0.8'},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -0.6, 0], 'linear_drag_coefficient': 2},
        'minecraft:particle_appearance_billboard': {'size': ['0.2 + v.particle_random_2 * 0.2', '0.2 + v.particle_random_2 * 0.2'], 'facing_camera_mode': 'lookat_xyz', 'uv': cell(0, 0)},
        'minecraft:particle_appearance_lighting': {},
        'minecraft:particle_appearance_tinting': {'color': [0.2, 0.18, 0.17, '0.9 - v.particle_age / v.particle_lifetime * 0.9']},
    })
    P['rupture'] = particle('shaftbreaker:rupture', {
        'minecraft:emitter_rate_instant': {'num_particles': 46},
        'minecraft:emitter_lifetime_once': {'active_time': 0.1},
        'minecraft:emitter_shape_disc': {'radius': 0.5, 'direction': 'outwards', 'plane_normal': 'y'},
        'minecraft:particle_initial_speed': '6 + v.particle_random_1 * 2',
        'minecraft:particle_lifetime_expression': {'max_lifetime': 0.9},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -6, 0], 'linear_drag_coefficient': 3.2},
        'minecraft:particle_motion_collision': {'coefficient_of_restitution': 0.2, 'collision_drag': 4, 'collision_radius': 0.05},
        'minecraft:particle_appearance_billboard': {'size': ['0.07 + v.particle_random_3 * 0.1', '0.07 + v.particle_random_3 * 0.1'], 'facing_camera_mode': 'rotate_xyz', 'uv': cell(1, 0)},
        'minecraft:particle_appearance_lighting': {},
        'minecraft:particle_appearance_tinting': {'color': [0.58, 0.54, 0.52, 1]},
    })
    P['warning'] = particle('shaftbreaker:warning_ring', {
        'minecraft:emitter_rate_steady': {'spawn_rate': 40, 'max_particles': 50},
        'minecraft:emitter_lifetime_once': {'active_time': 0.9},
        'minecraft:emitter_shape_disc': {'radius': 3.5, 'surface_only': True, 'direction': [0, 1, 0], 'plane_normal': 'y'},
        'minecraft:particle_initial_speed': 0.2,
        'minecraft:particle_lifetime_expression': {'max_lifetime': 0.8},
        'minecraft:particle_appearance_billboard': {'size': [0.12, 0.12], 'facing_camera_mode': 'lookat_xyz', 'uv': cell(0, 0)},
        'minecraft:particle_appearance_lighting': {},
        'minecraft:particle_appearance_tinting': {'color': [0.62, 0.56, 0.5, 0.8]},
    })
    P['den_aura'] = particle('shaftbreaker:den_aura', {
        'minecraft:emitter_rate_steady': {'spawn_rate': 3, 'max_particles': 12},
        'minecraft:emitter_lifetime_once': {'active_time': 4},
        'minecraft:emitter_shape_sphere': {'radius': 1.2, 'direction': [0, 1, 0]},
        'minecraft:particle_initial_speed': 0.1,
        'minecraft:particle_lifetime_expression': {'max_lifetime': 3},
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 0.08, 0]},
        'minecraft:particle_appearance_billboard': {'size': [0.05, 0.05], 'facing_camera_mode': 'lookat_xyz', 'uv': cell(3, 0)},
        'minecraft:particle_appearance_tinting': {'color': [0.95, 0.9, 0.82, '0.8 - v.particle_age / v.particle_lifetime * 0.8']},
    }, material='particles_blend')
    for k, v in P.items():
        w(f'particles/sb_{k}.particle.json', v)


# =============================================================== atlases, block sounds, language
def atlases():
    w('textures/terrain_texture.json', {'resource_pack_name': 'shaftbreaker', 'texture_name': 'atlas.terrain', 'padding': 8, 'num_mip_levels': 4,
                                        'texture_data': {k: {'textures': f'textures/blocks/{k}'} for k in
                                                         ['sb_den_heart', 'sb_den_crack', 'sb_den_dust', 'sb_den_spine', 'sb_cairn', 'sb_cairn_top']}})
    w('textures/item_texture.json', {'resource_pack_name': 'shaftbreaker', 'texture_name': 'atlas.items',
                                     'texture_data': {k: {'textures': f'textures/items/{k}'} for k in
                                                      ['sb_skull', 'sb_resonance_dial', 'sb_resonance_shard', 'sb_cairn_marker']}})
    w('blocks.json', {'format_version': [1, 1, 0],
                      f'{NS}:den_heart': {'sound': 'deepslate'}, f'{NS}:den_crack': {'sound': 'stone'},
                      f'{NS}:den_dust': {'sound': 'gravel'}, f'{NS}:den_spine': {'sound': 'bone_block'}, f'{NS}:cairn_marker': {'sound': 'stone'}})


LANG = {
    'pack.name': 'The Shaftbreaker',
    'pack.description': 'An adaptive cave dweller that learns how you escape. No experimental toggles required.',
    f'entity.{NS}:shaftbreaker.name': 'Shaftbreaker',
    f'entity.{NS}:shaft_moth.name': 'Shaft Moth',
    f'entity.{NS}:waypoint.name': 'Shaftbreaker Waypoint',
    f'item.spawn_egg.entity.{NS}:shaftbreaker.name': 'Spawn Shaftbreaker',
    f'item.spawn_egg.entity.{NS}:shaft_moth.name': 'Spawn Shaft Moth',
    f'item.{NS}:shaftbreaker_skull.name': 'Shaftbreaker Skull',
    f'item.{NS}:resonance_dial.name': 'Resonance Dial',
    f'item.{NS}:resonance_shard.name': 'Resonance Shard',
    f'tile.{NS}:den_heart.name': 'Den Heart',
    f'tile.{NS}:den_crack.name': 'Fractured Den Wall',
    f'tile.{NS}:den_dust.name': 'Den Dust',
    f'tile.{NS}:den_spine.name': 'Den Spine',
    f'tile.{NS}:cairn_marker.name': 'Cairn Marker',
}


def lang():
    txt = '\n'.join(f'{k}={v}' for k, v in LANG.items()) + '\n'
    for base in (RP, BP):
        os.makedirs(os.path.join(base, 'texts'), exist_ok=True)
        open(os.path.join(base, 'texts/en_US.lang'), 'w').write(txt)
        w('texts/languages.json', ['en_US'], base=base)


if __name__ == '__main__':
    moth(); waypoint(); skull(); block_models(); particles(); atlases(); lang()
    print('resource pack definitions generated')
