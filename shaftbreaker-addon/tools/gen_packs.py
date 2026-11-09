#!/usr/bin/env python3
"""Writes every JSON file of the behavior pack and resource pack (except animations/models generated elsewhere).

Everything uses stable (non-experimental) formats. Run after gen_animations.py / gen_moth.py.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, 'BP')
RP = os.path.join(ROOT, 'RP')
NS = 'shaftbreaker'
VERSION = [1, 0, 0]
MIN_ENGINE = [1, 21, 130]
BLOCK_FV = '1.21.60'
ITEM_FV = '1.21.60'
ENTITY_FV = '1.21.60'

UUID = {
    'bp': 'c8375b78-611e-40f8-abe4-05865e1b5a12',
    'bp_data': 'b9ab5ba0-c21d-4da4-b128-9e754b302294',
    'bp_script': 'b3ac5cec-ca19-49e1-ab89-395443db618a',
    'rp': 'd368cde3-cba8-47b6-aa40-4d1297ffdb5e',
    'rp_res': '4fd10fdc-a569-4d41-9483-15cdf04fa3e6',
}


def write(path, obj, compact=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        if compact:
            json.dump(obj, f, separators=(',', ':'))
        else:
            json.dump(obj, f, indent=2)


LANG = []  # (key, value)


def lang(k, v):
    LANG.append((k, v))


# =============================================================================== manifests
write(os.path.join(BP, 'manifest.json'), {
    'format_version': 2,
    'header': {'name': 'The Shaftbreaker - Behavior', 'description': 'pack.description', 'uuid': UUID['bp'],
               'version': VERSION, 'min_engine_version': MIN_ENGINE},
    'modules': [
        {'type': 'data', 'uuid': UUID['bp_data'], 'version': VERSION},
        {'type': 'script', 'language': 'javascript', 'uuid': UUID['bp_script'], 'version': VERSION,
         'entry': 'scripts/main.js'}],
    'dependencies': [
        {'uuid': UUID['rp'], 'version': VERSION},
        {'module_name': '@minecraft/server', 'version': '2.4.0'},
        {'module_name': '@minecraft/server-ui', 'version': '2.0.0'}],
    'metadata': {'authors': ['Shaftbreaker add-on'], 'product_type': 'addon'}})
write(os.path.join(RP, 'manifest.json'), {
    'format_version': 2,
    'header': {'name': 'The Shaftbreaker - Resources', 'description': 'pack.description', 'uuid': UUID['rp'],
               'version': VERSION, 'min_engine_version': MIN_ENGINE},
    'modules': [{'type': 'resources', 'uuid': UUID['rp_res'], 'version': VERSION}],
    'dependencies': [{'uuid': UUID['bp'], 'version': VERSION}],
    'metadata': {'authors': ['Shaftbreaker add-on'], 'product_type': 'addon'}})
for p in (BP, RP):
    write(os.path.join(p, 'texts', 'languages.json'), ['en_US'])

# =============================================================================== block geometry
FULL_UV = {'uv': [0, 0], 'uv_size': [16, 16]}


def geo(identifier, bones, tw=16, th=16):
    return {'format_version': '1.12.0', 'minecraft:geometry': [{
        'description': {'identifier': identifier, 'texture_width': tw, 'texture_height': th,
                        'visible_bounds_width': 2, 'visible_bounds_height': 2.5, 'visible_bounds_offset': [0, 0.75, 0]},
        'bones': bones}]}


plane = lambda rot: {'origin': [-8, 0, 0], 'size': [16, 16, 0], 'pivot': [0, 8, 0], 'rotation': [0, rot, 0],
                     'uv': {'north': dict(FULL_UV)}}
write(os.path.join(RP, 'models/blocks/cross.geo.json'),
      geo('geometry.shaftbreaker.cross', [{'name': 'cross', 'pivot': [0, 0, 0], 'cubes': [plane(45), plane(-45)]}]))
write(os.path.join(RP, 'models/blocks/layer.geo.json'),
      geo('geometry.shaftbreaker.layer', [{'name': 'layer', 'pivot': [0, 0, 0], 'cubes': [
          {'origin': [-8, 0, -8], 'size': [16, 0.25, 16], 'uv': {
              'up': dict(FULL_UV, material_instance='up'), 'down': dict(FULL_UV, material_instance='up'),
              'north': {'uv': [0, 0], 'uv_size': [16, 1], 'material_instance': 'up'},
              'south': {'uv': [0, 0], 'uv_size': [16, 1], 'material_instance': 'up'},
              'east': {'uv': [0, 0], 'uv_size': [16, 1], 'material_instance': 'up'},
              'west': {'uv': [0, 0], 'uv_size': [16, 1], 'material_instance': 'up'}}}]}]))
write(os.path.join(RP, 'models/blocks/carpet.geo.json'),
      geo('geometry.shaftbreaker.carpet', [{'name': 'carpet', 'pivot': [0, 0, 0], 'cubes': [
          {'origin': [-8, 0, -8], 'size': [16, 1, 16], 'uv': {
              'up': dict(FULL_UV, material_instance='up'), 'down': dict(FULL_UV, material_instance='up'),
              'north': {'uv': [0, 15], 'uv_size': [16, 1], 'material_instance': 'up'},
              'south': {'uv': [0, 15], 'uv_size': [16, 1], 'material_instance': 'up'},
              'east': {'uv': [0, 15], 'uv_size': [16, 1], 'material_instance': 'up'},
              'west': {'uv': [0, 15], 'uv_size': [16, 1], 'material_instance': 'up'}}}]}]))
write(os.path.join(RP, 'models/blocks/pane.geo.json'),
      geo('geometry.shaftbreaker.pane', [{'name': 'pane', 'pivot': [0, 0, 0], 'cubes': [
          {'origin': [-8, 0, 0], 'size': [16, 16, 0], 'uv': {'north': dict(FULL_UV)}}]}]))
write(os.path.join(RP, 'models/blocks/pod.geo.json'),
      geo('geometry.shaftbreaker.pod', [{'name': 'pod', 'pivot': [0, 0, 0], 'cubes': [
          {'origin': [-6, 0, -6], 'size': [12, 12, 12], 'uv': {
              'north': dict(FULL_UV, material_instance='side'), 'south': dict(FULL_UV, material_instance='side'),
              'east': dict(FULL_UV, material_instance='side'), 'west': dict(FULL_UV, material_instance='side'),
              'up': dict(FULL_UV, material_instance='up'), 'down': dict(FULL_UV, material_instance='up')}},
          {'origin': [-4, 12, -4], 'size': [8, 1, 8], 'uv': {
              'north': {'uv': [4, 0], 'uv_size': [8, 1], 'material_instance': 'side'},
              'south': {'uv': [4, 0], 'uv_size': [8, 1], 'material_instance': 'side'},
              'east': {'uv': [4, 0], 'uv_size': [8, 1], 'material_instance': 'side'},
              'west': {'uv': [4, 0], 'uv_size': [8, 1], 'material_instance': 'side'},
              'up': {'uv': [4, 4], 'uv_size': [8, 8], 'material_instance': 'up'}}}]}]))

# =============================================================================== blocks
TERRAIN = {}  # short name -> texture path
FLIPBOOKS = []
SOUNDS_RP = {}  # block id -> sound group


def tex(short, path=None):
    TERRAIN[NS + '_' + short] = 'textures/blocks/' + (path or short)
    return NS + '_' + short


SUPPORT_TAGS = "q.any_tag('stone', 'dirt', 'minecraft:is_pickaxe_item_destructible', 'minecraft:is_shovel_item_destructible', 'shaftbreaker_solid')"
SOLID_FILTER = [{'tags': SUPPORT_TAGS}]


def block(ident, name, components, sound='stone', states=None, permutations=None, category='nature', group=None):
    desc = {'identifier': NS + ':' + ident, 'menu_category': {'category': category}}
    if group:
        desc['menu_category']['group'] = group
    if states:
        desc['states'] = states
    body = {'description': desc, 'components': components}
    if permutations:
        body['permutations'] = permutations
    write(os.path.join(BP, 'blocks', ident + '.json'), {'format_version': BLOCK_FV, 'minecraft:block': body})
    lang('tile.%s:%s.name' % (NS, ident), name)
    SOUNDS_RP[NS + ':' + ident] = sound


def mat(texture, method='opaque', **extra):
    d = {'texture': texture, 'render_method': method}
    d.update(extra)
    return d


def solid_block(ident, name, texture, seconds, color, sound='stone', loot=None, light=0, extra=None, tags=('stone',),
                top=None, bottom=None, flammable=False, resistance=6, category='nature'):
    mi = {'*': mat(texture)}
    if top:
        mi['up'] = mat(top)
        mi['down'] = mat(bottom or top)
    comps = {
        'minecraft:material_instances': mi,
        'minecraft:destructible_by_mining': {'seconds_to_destroy': seconds},
        'minecraft:destructible_by_explosion': {'explosion_resistance': resistance},
        'minecraft:map_color': color,
        'tag:shaftbreaker_solid': {},
        'tag:minecraft:is_pickaxe_item_destructible': {},
    }
    for t in tags:
        comps['tag:' + t] = {}
    if light:
        comps['minecraft:light_emission'] = light
    if loot:
        comps['minecraft:loot'] = loot
    if flammable:
        comps['minecraft:flammable'] = {'catch_chance_modifier': 5, 'destroy_chance_modifier': 15}
    if extra:
        comps.update(extra)
    block(ident, name, comps, sound=sound, category=category)


# --- stone family
solid_block('veinstone', 'Veinstone', tex('veinstone'), 1.5, '#6f6466', loot='loot_tables/blocks/veinstone.json')
solid_block('deep_veinstone', 'Deep Veinstone', tex('deep_veinstone'), 3.0, '#45404a', sound='deepslate',
            loot='loot_tables/blocks/deep_veinstone.json', top=tex('deep_veinstone_top'))
solid_block('cracked_veinstone', 'Cracked Veinstone', tex('cracked_veinstone'), 1.5, '#7a3a32', light=5,
            loot='loot_tables/blocks/cracked_veinstone.json')
solid_block('fleshstone', 'Fleshstone', tex('fleshstone'), 1.0, '#6a1c1e', sound='shaftbreaker_flesh', flammable=True)
TERRAIN[NS + '_pulsing_flesh'] = 'textures/blocks/pulsing_flesh'
FLIPBOOKS.append({'flipbook_texture': 'textures/blocks/pulsing_flesh', 'atlas_tile': NS + '_pulsing_flesh',
                  'ticks_per_frame': 5, 'blend_frames': True})
solid_block('pulsing_flesh', 'Pulsing Flesh', NS + '_pulsing_flesh', 0.8, '#8a2a28', sound='shaftbreaker_flesh', light=3,
            flammable=True)
TERRAIN[NS + '_organ_core'] = 'textures/blocks/organ_core'
FLIPBOOKS.append({'flipbook_texture': 'textures/blocks/organ_core', 'atlas_tile': NS + '_organ_core',
                  'ticks_per_frame': 4, 'blend_frames': True})
solid_block('organ_core', 'Organ Core', NS + '_organ_core', 2.0, '#9c2a22', sound='shaftbreaker_flesh', light=7,
            loot='loot_tables/blocks/organ_core.json', flammable=True)
solid_block('cracked_organ_core', 'Spent Organ Husk', tex('cracked_organ_core'), 1.0, '#4a3430',
            sound='shaftbreaker_flesh', loot='loot_tables/blocks/cracked_organ_core.json')
TERRAIN[NS + '_dwelling_heart'] = 'textures/blocks/dwelling_heart'
FLIPBOOKS.append({'flipbook_texture': 'textures/blocks/dwelling_heart', 'atlas_tile': NS + '_dwelling_heart',
                  'ticks_per_frame': 3, 'blend_frames': True})
solid_block('dwelling_heart', 'Dwelling Heart', NS + '_dwelling_heart', 6.0, '#c03a2a', sound='shaftbreaker_flesh',
            light=10, loot='loot_tables/blocks/dwelling_heart.json', resistance=30, flammable=True)
solid_block('bloodmoss', 'Bloodmoss Block', tex('bloodmoss_side'), 0.6, '#5a1418', sound='moss_block',
            top=tex('bloodmoss'), bottom=tex('veinstone'), tags=('dirt',), loot='loot_tables/blocks/bloodmoss.json')
solid_block('ribstone', 'Ribstone', tex('ribstone_side'), 2.0, '#cfc3a5', sound='bone_block', top=tex('ribstone_top'))
for i in range(4):
    tex('scored_stone_%d' % i)
    tex('scored_deepslate_%d' % i)
for kind, snd, color, secs, loot in (('stone', 'stone', '#7a7474', 1.5, 'scored_stone'),
                                     ('deepslate', 'deepslate', '#4a4850', 3.0, 'scored_deepslate')):
    block('scored_' + kind, 'Scored ' + ('Stone' if kind == 'stone' else 'Deepslate'), {
        'minecraft:material_instances': {'*': mat('%s_scored_%s_0' % (NS, kind))},
        'minecraft:destructible_by_mining': {'seconds_to_destroy': secs},
        'minecraft:destructible_by_explosion': {'explosion_resistance': 6},
        'minecraft:map_color': color, 'minecraft:loot': 'loot_tables/blocks/%s.json' % loot,
        'tag:stone': {}, 'tag:shaftbreaker_solid': {}, 'tag:minecraft:is_pickaxe_item_destructible': {}},
        sound=snd, states={NS + ':pattern': [0, 1, 2, 3]},
        permutations=[{'condition': "q.block_state('%s:pattern') == %d" % (NS, i),
                       'components': {'minecraft:material_instances': {'*': mat('%s_scored_%s_%d' % (NS, kind, i))}}}
                      for i in range(1, 4)])


# --- decorative / attached blocks (never floating: placement filters pop them off without support)
def deco(ident, name, geometry, mi, seconds, light=0, faces=('up',), extra_filter=(), collision=False,
         selection=None, sound='stone', color='#5a1418', loot=None, extra=None, states=None, permutations=None,
         flammable=False):
    comps = {
        'minecraft:geometry': geometry,
        'minecraft:material_instances': mi,
        'minecraft:destructible_by_mining': {'seconds_to_destroy': seconds},
        'minecraft:destructible_by_explosion': {'explosion_resistance': 0.5},
        'minecraft:light_dampening': 0,
        'minecraft:map_color': color,
        'minecraft:collision_box': collision,
        'minecraft:selection_box': selection or {'origin': [-6, 0, -6], 'size': [12, 12, 12]},
        'minecraft:placement_filter': {'conditions': [{'allowed_faces': list(faces),
                                                       'block_filter': SOLID_FILTER + list(extra_filter)}]},
    }
    if light:
        comps['minecraft:light_emission'] = light
    if loot:
        comps['minecraft:loot'] = loot
    if flammable:
        comps['minecraft:flammable'] = {'catch_chance_modifier': 30, 'destroy_chance_modifier': 60}
    if extra:
        comps.update(extra)
    block(ident, name, comps, sound=sound, states=states, permutations=permutations)


CROSS = 'geometry.shaftbreaker.cross'
HANG_SEL = {'origin': [-5, 0, -5], 'size': [10, 16, 10]}
deco('dripfang', 'Dripfang Stalactite', CROSS, {'*': mat(tex('dripfang_tip'), 'alpha_test')}, 1.2, faces=('down',),
     extra_filter=['shaftbreaker:dripfang'], sound='pointed_dripstone', color='#6a5e58', selection=HANG_SEL,
     states={NS + ':segment': [0, 1, 2]}, collision={'origin': [-3, 0, -3], 'size': [6, 16, 6]},
     permutations=[
         {'condition': "q.block_state('%s:segment') == 0" % NS,
          'components': {'minecraft:material_instances': {'*': mat(tex('dripfang_base'), 'alpha_test')},
                         'minecraft:collision_box': {'origin': [-5, 0, -5], 'size': [10, 16, 10]}}},
         {'condition': "q.block_state('%s:segment') == 1" % NS,
          'components': {'minecraft:material_instances': {'*': mat(tex('dripfang_middle'), 'alpha_test')},
                         'minecraft:collision_box': {'origin': [-4, 0, -4], 'size': [8, 16, 8]}}}],
     extra={'tag:shaftbreaker_hanging': {}})
deco('bloodroot_vines', 'Bloodroot Vines', CROSS, {'*': mat(tex('bloodroot_vines'), 'alpha_test')}, 0.2,
     faces=('down',), extra_filter=['shaftbreaker:bloodroot_vines'], sound='hanging_roots', color='#5a0f12',
     selection=HANG_SEL, states={NS + ':end': [False, True]}, flammable=True,
     permutations=[{'condition': "q.block_state('%s:end')" % NS,
                    'components': {'minecraft:material_instances': {'*': mat(tex('bloodroot_vines_end'), 'alpha_test')}}}],
     loot='loot_tables/blocks/empty.json', extra={'tag:shaftbreaker_hanging': {}})
deco('hanging_tissue', 'Hanging Tissue', CROSS, {'*': mat(tex('hanging_tissue'), 'alpha_test')}, 0.3, faces=('down',),
     extra_filter=['shaftbreaker:hanging_tissue'], sound='shaftbreaker_flesh', color='#7a2228', selection=HANG_SEL,
     states={NS + ':end': [False, True]}, flammable=True,
     permutations=[{'condition': "q.block_state('%s:end')" % NS,
                    'components': {'minecraft:material_instances': {'*': mat(tex('hanging_tissue_end'), 'alpha_test')}}}],
     loot='loot_tables/blocks/organ_scrap.json', extra={'tag:shaftbreaker_hanging': {}})
deco('crimson_thorns', 'Crimson Cave Thorns', CROSS, {'*': mat(tex('crimson_thorns'), 'alpha_test')}, 0.6, light=2,
     sound='amethyst_cluster', color='#8c1a1e', selection={'origin': [-6, 0, -6], 'size': [12, 13, 12]})
deco('glowspore_cluster', 'Glowspore Cluster', CROSS, {'*': mat(tex('glowspore_cluster'), 'alpha_test')}, 0.1,
     light=8, sound='fungus', color='#ff8a5a', selection={'origin': [-5, 0, -5], 'size': [10, 8, 10]})
deco('skull_pile', 'Skull Pile', CROSS, {'*': mat(tex('skull_pile'), 'alpha_test')}, 0.8, sound='bone_block',
     color='#c8bb9c', selection={'origin': [-6, 0, -6], 'size': [12, 9, 12]},
     loot='loot_tables/blocks/skull_pile.json')
deco('dweller_droppings', 'Dweller Droppings', 'geometry.shaftbreaker.layer',
     {'*': mat(tex('dweller_droppings'), 'alpha_test'), 'up': mat(tex('dweller_droppings'), 'alpha_test')}, 0.1,
     sound='shaftbreaker_flesh', color='#2a0a0c', selection={'origin': [-8, 0, -8], 'size': [16, 1, 16]},
     loot='loot_tables/blocks/empty.json')
deco('bloodmoss_carpet', 'Bloodmoss Carpet', 'geometry.shaftbreaker.carpet',
     {'*': mat(tex('bloodmoss')), 'up': mat(tex('bloodmoss'))}, 0.1, sound='moss_carpet', color='#5a1418',
     selection={'origin': [-8, 0, -8], 'size': [16, 1, 16]},
     collision={'origin': [-8, 0, -8], 'size': [16, 1, 16]}, flammable=True)
deco('bone_chime', 'Bone Chime', CROSS, {'*': mat(tex('bone_chime'), 'alpha_test')}, 0.3, faces=('down',),
     sound='bone_block', color='#e6dcc4', selection=HANG_SEL)
# sinew membrane: free-standing curtain (a full block position, no support needed), two orientations
block('sinew_membrane', 'Sinew Membrane', {
    'minecraft:geometry': 'geometry.shaftbreaker.pane',
    'minecraft:material_instances': {'*': mat(tex('sinew_membrane'), 'alpha_test')},
    'minecraft:destructible_by_mining': {'seconds_to_destroy': 0.4},
    'minecraft:destructible_by_explosion': {'explosion_resistance': 0.5},
    'minecraft:light_dampening': 0,
    'minecraft:collision_box': False,
    'minecraft:selection_box': {'origin': [-8, 0, -1], 'size': [16, 16, 2]},
    'minecraft:map_color': '#9c3430',
    'minecraft:loot': 'loot_tables/blocks/organ_scrap.json',
    'minecraft:flammable': {'catch_chance_modifier': 30, 'destroy_chance_modifier': 60}},
    sound='shaftbreaker_flesh', states={NS + ':axis': [0, 1]},
    permutations=[{'condition': "q.block_state('%s:axis') == 1" % NS,
                   'components': {'minecraft:transformation': {'rotation': [0, 90, 0]},
                                  'minecraft:selection_box': {'origin': [-8, 0, -1], 'size': [16, 16, 2]}}}])
# watcher pods (listening organs)
for ident, name, side, top, light in (('watcher_pod', 'Watcher Pod', 'watcher_pod', 'watcher_pod_top', 1),
                                      ('watcher_pod_open', 'Opened Watcher Pod', 'watcher_pod_open', 'watcher_pod_open_top', 6)):
    deco(ident, name, 'geometry.shaftbreaker.pod',
         {'*': mat(tex(side)), 'side': mat(tex(side)), 'up': mat(tex(top))}, 1.5, light=light,
         sound='shaftbreaker_flesh', color='#5e1a1a', selection={'origin': [-6, 0, -6], 'size': [12, 13, 12]},
         collision={'origin': [-6, 0, -6], 'size': [12, 12, 12]}, loot='loot_tables/blocks/watcher_pod.json',
         extra={'tag:shaftbreaker_organ': {}})
tex('veinstone')  # bottom of bloodmoss

# =============================================================================== block loot tables
def item_entry(name, mn=1, mx=1, weight=1, cond=None, chance=None):
    e = {'type': 'item', 'name': name, 'weight': weight}
    f = []
    if mn != 1 or mx != 1:
        f.append({'function': 'set_count', 'count': {'min': mn, 'max': mx}})
    if f:
        e['functions'] = f
    return e


def pool(entries, rolls=1, chance=None):
    p = {'rolls': rolls, 'entries': entries}
    if chance is not None:
        p['conditions'] = [{'condition': 'random_chance', 'chance': chance}]
    return p


LOOT = {
    'blocks/veinstone': [pool([item_entry('minecraft:cobblestone')])],
    'blocks/deep_veinstone': [pool([item_entry('minecraft:cobbled_deepslate')])],
    'blocks/cracked_veinstone': [pool([item_entry('minecraft:cobblestone')]),
                                 pool([item_entry('shaftbreaker:veinstone_shard')], chance=0.35)],
    'blocks/scored_stone': [pool([item_entry('minecraft:cobblestone')])],
    'blocks/scored_deepslate': [pool([item_entry('minecraft:cobbled_deepslate')])],
    'blocks/organ_core': [pool([item_entry('shaftbreaker:organ_tissue', 2, 3)])],
    'blocks/cracked_organ_core': [pool([item_entry('minecraft:bone_meal', 1, 2)])],
    'blocks/dwelling_heart': [pool([item_entry('shaftbreaker:organ_tissue', 4, 6)]),
                              pool([item_entry('minecraft:bone', 2, 4)])],
    'blocks/watcher_pod': [pool([item_entry('shaftbreaker:organ_tissue', 1, 2)])],
    'blocks/organ_scrap': [pool([item_entry('shaftbreaker:organ_tissue')], chance=0.25)],
    'blocks/skull_pile': [pool([item_entry('minecraft:bone', 2, 4)]),
                          pool([item_entry('minecraft:bone_meal', 1, 2)], chance=0.5)],
    'blocks/bloodmoss': [pool([item_entry('shaftbreaker:bloodmoss')])],
    'blocks/empty': [],
    'entities/shaftbreaker': [pool([item_entry('shaftbreaker:shaftbreaker_claw')]),
                              pool([item_entry('shaftbreaker:organ_tissue', 2, 4)]),
                              pool([item_entry('minecraft:bone', 3, 6)])],
    'entities/grinning_moth': [pool([item_entry('shaftbreaker:moth_dust', 1, 2)], chance=0.85)],
}
for k, pools in LOOT.items():
    write(os.path.join(BP, 'loot_tables', k + '.json'), {'pools': pools})

# =============================================================================== items
ITEM_TEX = {}


def item(ident, name, icon, components, category='items', stack=64):
    ITEM_TEX[NS + '_' + ident] = 'textures/items/' + icon
    comps = {'minecraft:icon': NS + '_' + ident, 'minecraft:max_stack_size': stack,
             'minecraft:display_name': {'value': 'item.%s.%s.name' % (NS, ident)}}
    comps.update(components)
    write(os.path.join(BP, 'items', ident + '.json'), {'format_version': ITEM_FV, 'minecraft:item': {
        'description': {'identifier': NS + ':' + ident, 'menu_category': {'category': category}},
        'components': comps}})
    lang('item.%s.%s.name' % (NS, ident), name)
    lang('item.%s:%s.name' % (NS, ident), name)


item('config_wheel', 'Config Wheel', 'config_wheel', {'minecraft:cooldown': {'category': 'shaftbreaker_menu', 'duration': 0.5}},
     category='equipment', stack=1)
item('field_journal', "Spelunker's Field Journal", 'field_journal',
     {'minecraft:cooldown': {'category': 'shaftbreaker_menu', 'duration': 0.5}}, category='equipment', stack=1)
item('rattlebone', 'Rattlebone (Noise Lure)', 'rattlebone', {
    'minecraft:throwable': {'do_swing_animation': True, 'launch_power_scale': 1.0, 'max_launch_power': 1.0},
    'minecraft:projectile': {'projectile_entity': 'shaftbreaker:rattlebone_projectile', 'minimum_critical_power': 1.25},
    'minecraft:cooldown': {'category': 'shaftbreaker_rattle', 'duration': 1.0}}, category='equipment', stack=16)
item('organ_muffler', 'Organ Muffler', 'organ_muffler', {}, category='equipment', stack=16)
item('glowspore_flare', 'Glowspore Flare', 'glowspore_flare',
     {'minecraft:cooldown': {'category': 'shaftbreaker_flare', 'duration': 6.0}}, category='equipment', stack=16)
item('organ_tissue', 'Organ Tissue', 'organ_tissue', {})
item('shaftbreaker_claw', "Shaftbreaker's Claw", 'shaftbreaker_claw',
     {'minecraft:allow_off_hand': True, 'minecraft:hand_equipped': True}, category='equipment', stack=1)
item('moth_dust', 'Moth Dust', 'moth_dust', {})
item('veinstone_shard', 'Veinstone Shard', 'veinstone_shard', {})
# bloodmoss drops itself as a block item: (block id shaftbreaker:bloodmoss) - handled by loot of block id
LOOT_FIX = os.path.join(BP, 'loot_tables', 'blocks', 'bloodmoss.json')
write(LOOT_FIX, {'pools': [pool([item_entry('shaftbreaker:bloodmoss')])]})

# =============================================================================== recipes


def shapeless(ident, ingredients, result, count=1, unlock='minecraft:bone'):
    write(os.path.join(BP, 'recipes', ident + '.json'), {'format_version': '1.20.10', 'minecraft:recipe_shapeless': {
        'description': {'identifier': NS + ':' + ident}, 'tags': ['crafting_table'],
        'ingredients': [{'item': i, 'count': c} if c > 1 else {'item': i} for i, c in ingredients],
        'unlock': [{'item': unlock}], 'result': {'item': result, 'count': count}}})


shapeless('config_wheel', [('minecraft:iron_ingot', 1), ('minecraft:redstone', 1)], 'shaftbreaker:config_wheel',
          unlock='minecraft:iron_ingot')
shapeless('field_journal', [('minecraft:book', 1), ('minecraft:ink_sac', 1)], 'shaftbreaker:field_journal',
          unlock='minecraft:book')
shapeless('rattlebone', [('minecraft:bone', 2), ('minecraft:string', 1)], 'shaftbreaker:rattlebone', 2)
shapeless('organ_muffler', [('minecraft:white_wool', 1), ('minecraft:string', 1), ('shaftbreaker:organ_tissue', 1)],
          'shaftbreaker:organ_muffler', 2, unlock='shaftbreaker:organ_tissue')
shapeless('glowspore_flare', [('minecraft:stick', 1), ('shaftbreaker:glowspore_cluster', 1), ('minecraft:gunpowder', 1)],
          'shaftbreaker:glowspore_flare', 2, unlock='shaftbreaker:glowspore_cluster')
shapeless('glowspore_flare_moth', [('minecraft:stick', 1), ('shaftbreaker:moth_dust', 2), ('minecraft:gunpowder', 1)],
          'shaftbreaker:glowspore_flare', 2, unlock='shaftbreaker:moth_dust')
shapeless('bone_chime', [('minecraft:bone', 3), ('minecraft:string', 1), ('minecraft:iron_nugget', 1)],
          'shaftbreaker:bone_chime')
shapeless('veinstone', [('minecraft:cobblestone', 4), ('shaftbreaker:veinstone_shard', 1)], 'shaftbreaker:veinstone', 4,
          unlock='shaftbreaker:veinstone_shard')
shapeless('veinstone_from_tissue', [('minecraft:cobblestone', 4), ('shaftbreaker:organ_tissue', 1)],
          'shaftbreaker:veinstone', 4, unlock='shaftbreaker:organ_tissue')
shapeless('fleshstone', [('minecraft:cobblestone', 2), ('shaftbreaker:organ_tissue', 2)], 'shaftbreaker:fleshstone', 2,
          unlock='shaftbreaker:organ_tissue')

# =============================================================================== entities (behavior)


def damage_sensor():
    return {'triggers': [
        {'cause': 'fall', 'deals_damage': 'no'},
        {'cause': 'suffocation', 'deals_damage': 'no'},
        {'cause': 'drowning', 'deals_damage': 'no'},
        {'cause': 'fire', 'deals_damage': 'no'},
        {'cause': 'fire_tick', 'deals_damage': 'no'},
        {'cause': 'magma', 'deals_damage': 'no'},
        {'cause': 'freezing', 'deals_damage': 'no'},
        {'cause': 'lava', 'deals_damage': 'yes', 'damage_multiplier': 0.2},
        {'cause': 'entity_explosion', 'deals_damage': 'yes', 'damage_multiplier': 0.6},
        {'cause': 'block_explosion', 'deals_damage': 'yes', 'damage_multiplier': 0.6},
    ]}


def nav(kind, doors):
    n = {'can_path_over_water': True, 'can_swim': True, 'can_walk': True, 'can_sink': True, 'avoid_water': False,
         'avoid_damage_blocks': True, 'can_pass_doors': True, 'can_open_doors': doors, 'can_break_doors': False,
         'can_path_from_air': True, 'can_jump': True, 'can_walk_in_lava': True, 'avoid_portals': True}
    g = {'minecraft:navigation.' + kind: n}
    if doors:
        g['minecraft:annotation.open_door'] = {}
    return g


TIERS = {'easy': (110, 5), 'normal': (160, 7), 'brutal': (240, 10)}
STATE_VALUES = ['dormant', 'stalk', 'watch', 'threat', 'hunt', 'search', 'break', 'retreat', 'scream', 'vanish',
                'climb', 'swim', 'peek_l', 'peek_r', 'stagger', 'death']
props = {
    NS + ':state': {'type': 'enum', 'values': STATE_VALUES, 'default': 'dormant', 'client_sync': True},
    NS + ':pose': {'type': 'int', 'range': [0, 2], 'default': 0, 'client_sync': True},
    NS + ':attack': {'type': 'int', 'range': [0, 3], 'default': 0, 'client_sync': True},
    NS + ':eyes': {'type': 'int', 'range': [0, 2], 'default': 1, 'client_sync': True},
    NS + ':tilt': {'type': 'bool', 'default': False, 'client_sync': True},
    NS + ':materialize': {'type': 'bool', 'default': False, 'client_sync': True},
}
groups = {
    NS + ':size_stand': {'minecraft:collision_box': {'width': 0.8, 'height': 1.9}},
    NS + ':size_crawl': {'minecraft:collision_box': {'width': 0.8, 'height': 0.9}},
    NS + ':mode_passive': {
        'minecraft:behavior.look_at_player': {'priority': 1, 'look_distance': 64, 'probability': 1.0,
                                              'look_time': [4, 8], 'angle_of_view_horizontal': 360,
                                              'angle_of_view_vertical': 360}},
    NS + ':mode_hunt': {
        'minecraft:behavior.hurt_by_target': {'priority': 1},
        'minecraft:behavior.nearest_attackable_target': {
            'priority': 2, 'must_see': False, 'reselect_targets': True, 'within_radius': 96.0, 'scan_interval': 4,
            'persist_time': 30.0, 'must_reach': False,
            'entity_types': [{'filters': {'all_of': [
                {'test': 'is_family', 'subject': 'other', 'value': 'player'},
                {'test': 'has_tag', 'subject': 'other', 'value': 'shaftbreaker_prey'}]},
                'max_dist': 96, 'must_see': False}]},
        'minecraft:behavior.delayed_attack': {'priority': 3, 'attack_once': False, 'track_target': True,
                                              'require_complete_path': False, 'random_stop_interval': 0,
                                              'reach_multiplier': 2.0, 'speed_multiplier': 1.0,
                                              'attack_duration': 0.75, 'hit_delay_pct': 0.45}},
    NS + ':mode_seek': {
        'minecraft:behavior.nearest_attackable_target': {
            'priority': 2, 'must_see': False, 'reselect_targets': True, 'within_radius': 96.0, 'scan_interval': 2,
            'persist_time': 30.0, 'must_reach': False,
            'entity_types': [{'filters': {'test': 'is_family', 'subject': 'other', 'value': 'shaftbreaker_waypoint'},
                              'max_dist': 96, 'must_see': False}]},
        'minecraft:behavior.melee_attack': {'priority': 3, 'track_target': True, 'require_complete_path': False,
                                            'speed_multiplier': 1.0, 'reach_multiplier': 0.6}},
    NS + ':despawn': {'minecraft:instant_despawn': {}},
}
for kind in ('walk', 'climb'):
    for doors in (False, True):
        groups['%s:nav_%s%s' % (NS, 'ground' if kind == 'walk' else 'climb', '_doors' if doors else '')] = nav(kind, doors)
for t, (hp, dmg) in TIERS.items():
    groups['%s:tier_%s' % (NS, t)] = {'minecraft:health': {'value': hp, 'max': hp}, 'minecraft:attack': {'damage': dmg}}

NAV_GROUPS = [g for g in groups if ':nav_' in g]
MODE_GROUPS = [NS + ':mode_passive', NS + ':mode_hunt', NS + ':mode_seek']
TIER_GROUPS = [g for g in groups if ':tier_' in g]


def swap(add, family):
    return {'remove': {'component_groups': [g for g in family if g != add]}, 'add': {'component_groups': [add]}}


events = {
    'minecraft:entity_spawned': {'add': {'component_groups': [NS + ':size_stand', NS + ':mode_passive', NS + ':nav_ground',
                                                              NS + ':tier_normal']}},
    NS + ':despawn': {'add': {'component_groups': [NS + ':despawn']}},
    NS + ':size_stand': swap(NS + ':size_stand', [NS + ':size_stand', NS + ':size_crawl']),
    NS + ':size_crawl': swap(NS + ':size_crawl', [NS + ':size_stand', NS + ':size_crawl']),
}
for g in MODE_GROUPS + NAV_GROUPS + TIER_GROUPS:
    fam = MODE_GROUPS if g in MODE_GROUPS else NAV_GROUPS if g in NAV_GROUPS else TIER_GROUPS
    events[g] = swap(g, fam)

write(os.path.join(BP, 'entities', 'shaftbreaker.json'), {'format_version': ENTITY_FV, 'minecraft:entity': {
    'description': {'identifier': NS + ':shaftbreaker', 'is_spawnable': True, 'is_summonable': True,
                    'is_experimental': False, 'properties': props},
    'component_groups': groups,
    'components': {
        'minecraft:type_family': {'family': ['shaftbreaker', 'monster', 'mob']},
        'minecraft:health': {'value': 160, 'max': 160},
        'minecraft:attack': {'damage': 7},
        'minecraft:movement': {'value': 0.3},
        'minecraft:underwater_movement': {'value': 0.2},
        'minecraft:movement.basic': {},
        'minecraft:jump.static': {},
        'minecraft:can_climb': {},
        'minecraft:follow_range': {'value': 80, 'max': 96},
        'minecraft:physics': {},
        'minecraft:pushable': {'is_pushable': False, 'is_pushable_by_piston': True},
        'minecraft:knockback_resistance': {'value': 0.75},
        'minecraft:fire_immune': True,
        'minecraft:breathable': {'breathes_air': True, 'breathes_water': True, 'suffocate_time': 0, 'total_supply': 15},
        'minecraft:damage_sensor': damage_sensor(),
        'minecraft:persistent': {},
        'minecraft:nameable': {},
        'minecraft:custom_hit_test': {'hitboxes': [{'pivot': [0, 1.45, 0], 'width': 1.0, 'height': 2.9}]},
        'minecraft:loot': {'table': 'loot_tables/entities/shaftbreaker.json'},
        'minecraft:experience_reward': {'on_death': 'query.last_hit_by_player ? 60 : 0'},
        'minecraft:conditional_bandwidth_optimization': {},
        'minecraft:collision_box': {'width': 0.8, 'height': 1.9},
    },
    'events': events}})
lang('entity.shaftbreaker:shaftbreaker.name', 'The Shaftbreaker')
lang('item.spawn_egg.entity.shaftbreaker:shaftbreaker.name', 'Spawn The Shaftbreaker')

# phantom: an illusion with the creature's exact appearance; harmless, intangible, short-lived
write(os.path.join(BP, 'entities', 'phantom.json'), {'format_version': ENTITY_FV, 'minecraft:entity': {
    'description': {'identifier': NS + ':phantom', 'is_spawnable': False, 'is_summonable': True,
                    'is_experimental': False, 'properties': {
                        NS + ':state': {'type': 'enum', 'values': STATE_VALUES, 'default': 'watch', 'client_sync': True},
                        NS + ':eyes': {'type': 'int', 'range': [0, 2], 'default': 1, 'client_sync': True},
                        NS + ':tilt': {'type': 'bool', 'default': False, 'client_sync': True},
                        NS + ':materialize': {'type': 'bool', 'default': False, 'client_sync': True},
                        NS + ':pose': {'type': 'int', 'range': [0, 2], 'default': 0, 'client_sync': True}}},
    'component_groups': {NS + ':despawn': {'minecraft:instant_despawn': {}}},
    'components': {
        'minecraft:type_family': {'family': ['shaftbreaker_phantom', 'inanimate']},
        'minecraft:health': {'value': 1000, 'max': 1000},
        'minecraft:damage_sensor': {'triggers': [{'cause': 'all', 'deals_damage': 'no'}]},
        'minecraft:collision_box': {'width': 0.8, 'height': 1.9},
        'minecraft:physics': {'has_gravity': True, 'has_collision': True},
        'minecraft:pushable': {'is_pushable': False, 'is_pushable_by_piston': False},
        'minecraft:knockback_resistance': {'value': 1.0},
        'minecraft:fire_immune': True,
        'minecraft:breathable': {'breathes_air': True, 'breathes_water': True, 'suffocate_time': 0, 'total_supply': 15},
        'minecraft:movement': {'value': 0.0},
        'minecraft:behavior.look_at_player': {'priority': 1, 'look_distance': 64, 'probability': 1.0,
                                              'look_time': [10, 20], 'angle_of_view_horizontal': 360},
        'minecraft:custom_hit_test': {'hitboxes': [{'pivot': [0, 1.45, 0], 'width': 1.0, 'height': 2.9}]},
        'minecraft:timer': {'looping': False, 'time': 25, 'time_down_event': {'event': NS + ':despawn'}},
        'minecraft:conditional_bandwidth_optimization': {}},
    'events': {NS + ':despawn': {'add': {'component_groups': [NS + ':despawn']}}}}})
lang('entity.shaftbreaker:phantom.name', '???')

# waypoint: invisible marker the creature physically walks to (vanilla pathfinding does the walking)
write(os.path.join(BP, 'entities', 'waypoint.json'), {'format_version': ENTITY_FV, 'minecraft:entity': {
    'description': {'identifier': NS + ':waypoint', 'is_spawnable': False, 'is_summonable': True, 'is_experimental': False},
    'component_groups': {NS + ':despawn': {'minecraft:instant_despawn': {}}},
    'components': {
        'minecraft:type_family': {'family': ['shaftbreaker_waypoint']},
        'minecraft:health': {'value': 1000, 'max': 1000},
        'minecraft:damage_sensor': {'triggers': [{'cause': 'all', 'deals_damage': 'no'}]},
        'minecraft:collision_box': {'width': 0.2, 'height': 0.2},
        'minecraft:physics': {'has_gravity': False, 'has_collision': False},
        'minecraft:pushable': {'is_pushable': False, 'is_pushable_by_piston': False},
        'minecraft:knockback_resistance': {'value': 1.0},
        'minecraft:fire_immune': True,
        'minecraft:breathable': {'breathes_air': True, 'breathes_water': True, 'suffocate_time': 0, 'total_supply': 15},
        'minecraft:timer': {'looping': False, 'time': 45, 'time_down_event': {'event': NS + ':despawn'}}},
    'events': {NS + ':despawn': {'add': {'component_groups': [NS + ':despawn']}}}}})
lang('entity.shaftbreaker:waypoint.name', ' ')

# grinning moth
write(os.path.join(BP, 'entities', 'grinning_moth.json'), {'format_version': ENTITY_FV, 'minecraft:entity': {
    'description': {'identifier': NS + ':grinning_moth', 'is_spawnable': True, 'is_summonable': True,
                    'is_experimental': False,
                    'properties': {NS + ':perched': {'type': 'bool', 'default': False, 'client_sync': True}}},
    'component_groups': {
        NS + ':flying': {
            'minecraft:behavior.random_hover': {'priority': 6, 'xz_dist': 8, 'y_dist': 5, 'y_offset': -1,
                                                'interval': 1, 'hover_height': [1, 4]},
            'minecraft:behavior.look_at_player': {'priority': 8, 'look_distance': 16, 'probability': 0.4}},
        NS + ':perched': {
            'minecraft:behavior.look_at_player': {'priority': 1, 'look_distance': 24, 'probability': 1.0,
                                                  'look_time': [6, 12], 'angle_of_view_horizontal': 360}},
        NS + ':despawn': {'minecraft:instant_despawn': {}}},
    'components': {
        'minecraft:type_family': {'family': ['grinning_moth', 'arthropod', 'mob']},
        'minecraft:health': {'value': 6, 'max': 6},
        'minecraft:collision_box': {'width': 0.6, 'height': 0.4},
        'minecraft:movement': {'value': 0.32},
        'minecraft:flying_speed': {'value': 0.12},
        'minecraft:navigation.hover': {'can_path_over_water': True, 'can_sink': False, 'can_pass_doors': True,
                                       'can_path_from_air': True, 'avoid_water': True, 'avoid_damage_blocks': True,
                                       'avoid_sun': False},
        'minecraft:movement.hover': {},
        'minecraft:jump.static': {},
        'minecraft:can_fly': {},
        'minecraft:physics': {'has_gravity': False},
        'minecraft:pushable': {'is_pushable': True, 'is_pushable_by_piston': True},
        'minecraft:damage_sensor': {'triggers': [{'cause': 'fall', 'deals_damage': 'no'}]},
        'minecraft:breathable': {'total_supply': 15, 'suffocate_time': 0},
        'minecraft:loot': {'table': 'loot_tables/entities/grinning_moth.json'},
        'minecraft:despawn': {'despawn_from_distance': {'min_distance': 48, 'max_distance': 96}},
        'minecraft:nameable': {},
        'minecraft:experience_reward': {'on_death': 'query.last_hit_by_player ? 2 : 0'},
        'minecraft:conditional_bandwidth_optimization': {}},
    'events': {
        'minecraft:entity_spawned': {'add': {'component_groups': [NS + ':flying']}},
        NS + ':moth_perch': swap(NS + ':perched', [NS + ':flying', NS + ':perched']),
        NS + ':moth_fly': swap(NS + ':flying', [NS + ':flying', NS + ':perched']),
        NS + ':despawn': {'add': {'component_groups': [NS + ':despawn']}}}}})
lang('entity.shaftbreaker:grinning_moth.name', 'Grinning Moth')
lang('item.spawn_egg.entity.shaftbreaker:grinning_moth.name', 'Spawn Grinning Moth')

# rattlebone projectile (noise lure)
write(os.path.join(BP, 'entities', 'rattlebone_projectile.json'), {'format_version': ENTITY_FV, 'minecraft:entity': {
    'description': {'identifier': NS + ':rattlebone_projectile', 'is_spawnable': False, 'is_summonable': True,
                    'is_experimental': False},
    'components': {
        'minecraft:collision_box': {'width': 0.25, 'height': 0.25},
        'minecraft:projectile': {'on_hit': {'impact_damage': {'damage': 0, 'knockback': False, 'destroy_on_hit': False},
                                            'remove_on_hit': {}},
                                 'anchor': 1, 'power': 1.3, 'gravity': 0.05, 'angle_offset': 0.0, 'offset': [0, -0.1, 0]},
        'minecraft:physics': {},
        'minecraft:pushable': {'is_pushable': True, 'is_pushable_by_piston': True},
        'minecraft:conditional_bandwidth_optimization': {'default_values': {
            'max_optimized_distance': 80.0, 'max_dropped_ticks': 7, 'use_motion_prediction_hints': True}}}}})
lang('entity.shaftbreaker:rattlebone_projectile.name', 'Rattlebone')

# =============================================================================== resource pack: client entities
ANIM = {
    'dormant': 'animation.shaftbreaker.dormant', 'look_at': 'animation.shaftbreaker.look_at',
    'stalk_idle': 'animation.shaftbreaker.stalk_idle', 'stalk_walk': 'animation.shaftbreaker.stalk_walk',
    'watch': 'animation.shaftbreaker.watch', 'breaker_smash': 'animation.shaftbreaker.breaker_smash',
    'breaker_walk': 'animation.shaftbreaker.breaker_walk', 'frenzy_idle': 'animation.shaftbreaker.frenzy_idle',
    'frenzy_run': 'animation.shaftbreaker.frenzy_run', 'frenzy_lunge': 'animation.shaftbreaker.frenzy_lunge',
}
for extra in ('crouch_full', 'crouch_stalk', 'crouch_run', 'crawl', 'climb', 'swim', 'scream', 'threat_rear', 'peek_left',
              'peek_right', 'stalk_walk_back', 'vanish', 'appear', 'head_tilt', 'jaw_chatter', 'twitch', 'stagger', 'death',
              'false_lunge', 'heavy_strike'):
    ANIM[extra] = 'animation.shaftbreaker.' + extra
CREATURE_TEX = {'concealed': 'textures/entity/shaftbreaker_concealed', 'default': 'textures/entity/shaftbreaker',
                'enraged': 'textures/entity/shaftbreaker_enraged'}
SCRIPTS_INIT = ['variable.move_blend = 0.0;', 'variable.attacking = 0.0;', 'variable.attack_w = 0.0;',
                'variable.base_weight = 1.0;']
SCRIPTS_PRE = ['variable.move_blend = math.lerp(variable.move_blend, math.clamp(query.modified_move_speed * 4.0, 0.0, 1.0), 0.18);',
               'variable.attack_w = math.lerp(variable.attack_w, variable.attacking, 0.3);']

anims_main = dict(ANIM)
anims_main.update({'main': 'controller.animation.shaftbreaker.main', 'crouch': 'controller.animation.shaftbreaker.crouch',
                   'attack': 'controller.animation.shaftbreaker.attack', 'look': 'controller.animation.shaftbreaker.look',
                   'tilt': 'controller.animation.shaftbreaker.tilt', 'appear_ctrl': 'controller.animation.shaftbreaker.appear'})
write(os.path.join(RP, 'entity', 'shaftbreaker.entity.json'), {'format_version': '1.10.0', 'minecraft:client_entity': {
    'description': {
        'identifier': NS + ':shaftbreaker',
        'materials': {'default': 'entity_emissive_alpha'},
        'textures': CREATURE_TEX,
        'geometry': {'default': 'geometry.shaftbreaker'},
        'scripts': {'scale': '0.56', 'initialize': SCRIPTS_INIT, 'pre_animation': SCRIPTS_PRE,
                    'animate': ['main', 'crouch', 'attack', 'look', 'tilt', 'appear_ctrl']},
        'animations': anims_main,
        'particle_effects': {'debris': NS + ':debris', 'step_dust': NS + ':step_dust'},
        'sound_effects': {'step': {'effect': NS + '.step'}, 'scrape': {'effect': NS + '.scrape'},
                          'smash': {'effect': NS + '.smash'}, 'screech': {'effect': NS + '.attack_snarl'}},
        'render_controllers': ['controller.render.shaftbreaker'],
        'spawn_egg': {'base_color': '#3a2c28', 'overlay_color': '#b3261e'},
        'enable_attachables': False}}})
anims_ph = {k: v for k, v in ANIM.items() if k in ('watch', 'twitch', 'stalk_idle', 'jaw_chatter', 'peek_left', 'peek_right',
                                                    'vanish', 'look_at', 'head_tilt', 'appear')}
anims_ph.update({'main': 'controller.animation.shaftbreaker.phantom', 'tilt': 'controller.animation.shaftbreaker.tilt',
                 'look': 'controller.animation.shaftbreaker.look', 'appear_ctrl': 'controller.animation.shaftbreaker.appear'})
write(os.path.join(RP, 'entity', 'phantom.entity.json'), {'format_version': '1.10.0', 'minecraft:client_entity': {
    'description': {
        'identifier': NS + ':phantom', 'materials': {'default': 'entity_emissive_alpha'}, 'textures': CREATURE_TEX,
        'geometry': {'default': 'geometry.shaftbreaker'},
        'scripts': {'scale': '0.56', 'initialize': SCRIPTS_INIT, 'pre_animation': SCRIPTS_PRE,
                    'animate': ['main', 'look', 'tilt', 'appear_ctrl']},
        'animations': anims_ph, 'render_controllers': ['controller.render.shaftbreaker'], 'enable_attachables': False}}})
write(os.path.join(RP, 'entity', 'grinning_moth.entity.json'), {'format_version': '1.10.0', 'minecraft:client_entity': {
    'description': {
        'identifier': NS + ':grinning_moth',
        'materials': {'default': 'entity_emissive_alpha', 'wings': 'entity_alphatest'},
        'textures': {'default': 'textures/entity/grinning_moth'},
        'geometry': {'default': 'geometry.shaftbreaker.grinning_moth'},
        'scripts': {'scale': '0.9', 'animate': ['wings', 'look']},
        'animations': {'flap': 'animation.grinning_moth.flap', 'perch': 'animation.grinning_moth.perch',
                       'look': 'animation.grinning_moth.look', 'wings': 'controller.animation.grinning_moth.wings'},
        'render_controllers': ['controller.render.grinning_moth'],
        'spawn_egg': {'base_color': '#4a3c34', 'overlay_color': '#e6d8c0'}}}})
write(os.path.join(RP, 'entity', 'waypoint.entity.json'), {'format_version': '1.10.0', 'minecraft:client_entity': {
    'description': {
        'identifier': NS + ':waypoint', 'materials': {'default': 'entity_alphatest'},
        'textures': {'default': 'textures/entity/grinning_moth'}, 'geometry': {'default': 'geometry.shaftbreaker.empty'},
        'render_controllers': ['controller.render.shaftbreaker_empty']}}})
write(os.path.join(RP, 'entity', 'rattlebone_projectile.entity.json'), {'format_version': '1.10.0', 'minecraft:client_entity': {
    'description': {
        'identifier': NS + ':rattlebone_projectile', 'materials': {'default': 'snowball'},
        'textures': {'default': 'textures/items/rattlebone'}, 'geometry': {'default': 'geometry.item_sprite'},
        'render_controllers': ['controller.render.item_sprite'], 'animations': {'flying': 'animation.actor.billboard'},
        'scripts': {'animate': ['flying']}}}})
write(os.path.join(RP, 'models/entity/empty.geo.json'), {'format_version': '1.12.0', 'minecraft:geometry': [{
    'description': {'identifier': 'geometry.shaftbreaker.empty', 'texture_width': 16, 'texture_height': 16,
                    'visible_bounds_width': 1, 'visible_bounds_height': 1, 'visible_bounds_offset': [0, 0, 0]},
    'bones': [{'name': 'root', 'pivot': [0, 0, 0]}]}]})
write(os.path.join(RP, 'render_controllers', 'shaftbreaker.render_controllers.json'), {
    'format_version': '1.10.0', 'render_controllers': {
        'controller.render.shaftbreaker': {
            'arrays': {'textures': {'Array.skins': ['Texture.concealed', 'Texture.default', 'Texture.enraged']}},
            'geometry': 'Geometry.default', 'materials': [{'*': 'Material.default'}],
            'textures': ["Array.skins[query.property('shaftbreaker:eyes')]"]},
        'controller.render.grinning_moth': {
            'geometry': 'Geometry.default',
            'materials': [{'*': 'Material.default'}, {'wing*': 'Material.wings'}, {'antenna*': 'Material.wings'}],
            'textures': ['Texture.default']},
        'controller.render.shaftbreaker_empty': {
            'geometry': 'Geometry.default', 'materials': [{'*': 'Material.default'}], 'textures': ['Texture.default']}}})

# =============================================================================== textures json
write(os.path.join(RP, 'textures', 'terrain_texture.json'), {
    'resource_pack_name': 'shaftbreaker', 'texture_name': 'atlas.terrain', 'padding': 8, 'num_mip_levels': 4,
    'texture_data': {k: {'textures': v} for k, v in sorted(TERRAIN.items())}})
write(os.path.join(RP, 'textures', 'item_texture.json'), {
    'resource_pack_name': 'shaftbreaker', 'texture_name': 'atlas.items',
    'texture_data': {k: {'textures': v} for k, v in sorted(ITEM_TEX.items())}})
write(os.path.join(RP, 'textures', 'flipbook_textures.json'), FLIPBOOKS)
blocks_json = {'format_version': [1, 1, 0]}
for bid, snd in sorted(SOUNDS_RP.items()):
    blocks_json[bid] = {'sound': snd}
write(os.path.join(RP, 'blocks.json'), blocks_json)

# =============================================================================== particles
PT = 'textures/particle/shaftbreaker_particles'  # 64x64 atlas, 8x8 cells


def uv_cell(col, row, size=8):
    return {'texture_width': 64, 'texture_height': 64, 'uv': [col * 8, row * 8], 'uv_size': [size, size]}


def particle(ident, material, components, curves=None):
    d = {'format_version': '1.10.0', 'particle_effect': {
        'description': {'identifier': NS + ':' + ident, 'basic_render_parameters': {'material': material, 'texture': PT}},
        'components': components}}
    if curves:
        d['particle_effect']['curves'] = curves
    write(os.path.join(RP, 'particles', ident + '.json'), d)


def billboard(size, cell, facing='lookat_xyz', flip=None):
    uv = uv_cell(*cell)
    if flip:
        uv = {'texture_width': 64, 'texture_height': 64, 'flipbook': flip}
    return {'minecraft:particle_appearance_billboard': {'size': size, 'facing_camera_mode': facing, 'uv': uv}}


comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 14},
    'minecraft:emitter_lifetime_once': {'active_time': 0.1},
    'minecraft:emitter_shape_sphere': {'radius': 0.4, 'direction': 'outwards'},
    'minecraft:particle_lifetime_expression': {'max_lifetime': '0.6 + variable.particle_random_1 * 0.6'},
    'minecraft:particle_initial_speed': '3 + variable.particle_random_2 * 3',
    'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -18, 0], 'linear_drag_coefficient': 1.2},
    'minecraft:particle_motion_collision': {'coefficient_of_restitution': 0.2, 'collision_radius': 0.05,
                                            'collision_drag': 4},
    'minecraft:particle_appearance_lighting': {},
    'minecraft:particle_appearance_tinting': {'color': [0.55, 0.52, 0.52, 1]},
}
comps.update(billboard(['0.06 + variable.particle_random_3 * 0.06', '0.06 + variable.particle_random_3 * 0.06'], (0, 0)))
particle('debris', 'particles_alpha', comps)
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 5},
    'minecraft:emitter_lifetime_once': {'active_time': 0.1},
    'minecraft:emitter_shape_disc': {'radius': 0.35, 'direction': 'outwards', 'plane_normal': 'y'},
    'minecraft:particle_lifetime_expression': {'max_lifetime': '0.8 + variable.particle_random_1 * 0.5'},
    'minecraft:particle_initial_speed': 0.6,
    'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, 0.3, 0], 'linear_drag_coefficient': 2.5},
    'minecraft:particle_appearance_lighting': {},
    'minecraft:particle_appearance_tinting': {'color': {'gradient': {'0.0': '#c0857a70', '1.0': '#00857a70'},
                                                         'interpolant': 'variable.particle_age / variable.particle_lifetime'}},
}
comps.update(billboard(['0.18 + variable.particle_age * 0.2', '0.18 + variable.particle_age * 0.2'], (2, 0)))
particle('step_dust', 'particles_blend', comps)
# phase out: dark flecks spiralling up and away
for ident, n, sp, acc in (('phase_out', 70, 1.5, 1.4), ('phase_in', 50, -1.8, 0.0)):
    comps = {
        'minecraft:emitter_rate_instant': {'num_particles': n},
        'minecraft:emitter_lifetime_once': {'active_time': 0.1},
        'minecraft:emitter_shape_box': {'offset': [0, 1.4, 0], 'half_dimensions': [0.45, 1.4, 0.45],
                                        'direction': 'outwards'},
        'minecraft:particle_lifetime_expression': {'max_lifetime': '0.9 + variable.particle_random_1 * 0.9'},
        'minecraft:particle_initial_speed': sp,
        'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, acc, 0], 'linear_drag_coefficient': 1.5},
        'minecraft:particle_appearance_tinting': {'color': {'gradient': {'0.0': '#ff2a0a0c', '0.5': '#ff6a1612', '1.0': '#00100406'},
                                                             'interpolant': 'variable.particle_age / variable.particle_lifetime'}},
    }
    comps.update(billboard(['0.07 + variable.particle_random_2 * 0.08', '0.07 + variable.particle_random_2 * 0.08'],
                           (3 if ident == 'phase_out' else 4, 0)))
    particle(ident, 'particles_blend', comps)
# blood drip from stalactites
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 1},
    'minecraft:emitter_lifetime_once': {'active_time': 0.05},
    'minecraft:emitter_shape_point': {},
    'minecraft:particle_lifetime_expression': {'max_lifetime': 3},
    'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -14, 0]},
    'minecraft:particle_motion_collision': {'collision_radius': 0.05, 'expire_on_contact': True},
    'minecraft:particle_appearance_lighting': {},
    'minecraft:particle_appearance_tinting': {'color': [0.55, 0.06, 0.05, 1]},
}
comps['minecraft:particle_lifetime_expression'] = {'max_lifetime': 3}
comps.update(billboard([0.05, 0.08], (5, 0)))
particle('drip', 'particles_alpha', comps)
# glowing spores / ash motes for the territory
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 6},
    'minecraft:emitter_lifetime_once': {'active_time': 0.1},
    'minecraft:emitter_shape_sphere': {'radius': 6, 'direction': 'outwards'},
    'minecraft:particle_lifetime_expression': {'max_lifetime': '4 + variable.particle_random_1 * 4'},
    'minecraft:particle_initial_speed': 0.05,
    'minecraft:particle_motion_dynamic': {'linear_acceleration': ['math.sin(variable.particle_age * 60 + variable.particle_random_2 * 360) * 0.06', 0.01,
                                                                  'math.cos(variable.particle_age * 50 + variable.particle_random_3 * 360) * 0.06']},
    'minecraft:particle_appearance_tinting': {'color': {'gradient': {'0.0': '#00ff8a50', '0.2': '#ffff8a50', '0.8': '#ffe05a3c', '1.0': '#00e05a3c'},
                                                         'interpolant': 'variable.particle_age / variable.particle_lifetime'}},
}
comps.update(billboard([0.05, 0.05], (6, 0)))
particle('spore', 'particles_add', comps)
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 8},
    'minecraft:emitter_lifetime_once': {'active_time': 0.1},
    'minecraft:emitter_shape_box': {'offset': [0, 6, 0], 'half_dimensions': [8, 1, 8], 'direction': [0, -1, 0]},
    'minecraft:particle_lifetime_expression': {'max_lifetime': '6 + variable.particle_random_1 * 3'},
    'minecraft:particle_initial_speed': 0.15,
    'minecraft:particle_motion_dynamic': {'linear_acceleration': ['math.sin(variable.particle_age * 40 + variable.particle_random_2 * 360) * 0.04', -0.05, 0]},
    'minecraft:particle_motion_collision': {'collision_radius': 0.02, 'expire_on_contact': True},
    'minecraft:particle_appearance_lighting': {},
    'minecraft:particle_appearance_tinting': {'color': [0.35, 0.3, 0.3, 0.9]},
}
comps.update(billboard([0.035, 0.035], (7, 0)))
particle('ash', 'particles_alpha', comps)
# eyes in the dark: a single glowing eye glint (script spawns two side by side)
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 1},
    'minecraft:emitter_lifetime_once': {'active_time': 0.05},
    'minecraft:emitter_shape_point': {},
    'minecraft:particle_lifetime_expression': {'max_lifetime': 'variable.eye_life ?? 2.5'},
    'minecraft:particle_appearance_tinting': {'color': {'gradient': {'0.0': '#00ffb070', '0.06': '#ffffb070', '0.9': '#ffffa050', '1.0': '#00ffa050'},
                                                         'interpolant': 'variable.particle_age / variable.particle_lifetime'}},
}
comps.update(billboard([0.06, 0.05], (0, 1)))
particle('eye_glint', 'particles_add', comps)
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 1},
    'minecraft:emitter_lifetime_once': {'active_time': 0.05},
    'minecraft:emitter_shape_point': {},
    'minecraft:particle_lifetime_expression': {'max_lifetime': 'variable.eye_life ?? 2.5'},
    'minecraft:particle_appearance_tinting': {'color': {'gradient': {'0.0': '#00ff3018', '0.06': '#ffff3018', '0.9': '#ffff2010', '1.0': '#00ff2010'},
                                                         'interpolant': 'variable.particle_age / variable.particle_lifetime'}},
}
comps.update(billboard([0.06, 0.05], (0, 1)))
particle('eye_glint_red', 'particles_add', comps)
# flare burst
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 60},
    'minecraft:emitter_lifetime_once': {'active_time': 0.1},
    'minecraft:emitter_shape_sphere': {'radius': 0.3, 'direction': 'outwards'},
    'minecraft:particle_lifetime_expression': {'max_lifetime': '1.0 + variable.particle_random_1 * 1.4'},
    'minecraft:particle_initial_speed': '4 + variable.particle_random_2 * 6',
    'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -3, 0], 'linear_drag_coefficient': 2.2},
    'minecraft:particle_appearance_tinting': {'color': {'gradient': {'0.0': '#ffffe0b0', '0.4': '#ffff8a40', '1.0': '#00c03010'},
                                                         'interpolant': 'variable.particle_age / variable.particle_lifetime'}},
}
comps.update(billboard([0.12, 0.12], (1, 1)))
particle('flare', 'particles_add', comps)
# organ burst (red splatter)
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 30},
    'minecraft:emitter_lifetime_once': {'active_time': 0.1},
    'minecraft:emitter_shape_sphere': {'radius': 0.5, 'direction': 'outwards'},
    'minecraft:particle_lifetime_expression': {'max_lifetime': '0.8 + variable.particle_random_1 * 0.8'},
    'minecraft:particle_initial_speed': '2 + variable.particle_random_2 * 4',
    'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -14, 0], 'linear_drag_coefficient': 0.8},
    'minecraft:particle_motion_collision': {'collision_radius': 0.05, 'coefficient_of_restitution': 0, 'collision_drag': 10},
    'minecraft:particle_appearance_lighting': {},
    'minecraft:particle_appearance_tinting': {'color': [0.6, 0.07, 0.06, 1]},
}
comps.update(billboard(['0.06 + variable.particle_random_3 * 0.08', '0.06 + variable.particle_random_3 * 0.08'], (5, 0)))
particle('organ_burst', 'particles_alpha', comps)
# dust trickle from ceiling (rubble warning / scratch marks)
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 12},
    'minecraft:emitter_lifetime_once': {'active_time': 0.1},
    'minecraft:emitter_shape_disc': {'radius': 0.8, 'plane_normal': 'y', 'direction': [0, -1, 0]},
    'minecraft:particle_lifetime_expression': {'max_lifetime': '1.2 + variable.particle_random_1'},
    'minecraft:particle_initial_speed': 0.5,
    'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -6, 0], 'linear_drag_coefficient': 1.0},
    'minecraft:particle_motion_collision': {'collision_radius': 0.03, 'expire_on_contact': True},
    'minecraft:particle_appearance_lighting': {},
    'minecraft:particle_appearance_tinting': {'color': [0.5, 0.47, 0.45, 1]},
}
comps.update(billboard([0.04, 0.04], (0, 0)))
particle('dust_fall', 'particles_alpha', comps)
# lure noise ring
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 3},
    'minecraft:emitter_lifetime_once': {'active_time': 0.1},
    'minecraft:emitter_shape_point': {},
    'minecraft:particle_lifetime_expression': {'max_lifetime': 0.9},
    'minecraft:particle_appearance_tinting': {'color': {'gradient': {'0.0': '#ccd8cfc0', '1.0': '#00d8cfc0'},
                                                         'interpolant': 'variable.particle_age / variable.particle_lifetime'}},
}
comps.update(billboard(['0.2 + variable.particle_age * 2.5', '0.2 + variable.particle_age * 2.5'], (2, 1)))
particle('noise_ring', 'particles_blend', comps)
# moth dust trail
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 3},
    'minecraft:emitter_lifetime_once': {'active_time': 0.1},
    'minecraft:emitter_shape_sphere': {'radius': 0.2, 'direction': 'outwards'},
    'minecraft:particle_lifetime_expression': {'max_lifetime': 1.5},
    'minecraft:particle_initial_speed': 0.1,
    'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -0.4, 0]},
    'minecraft:particle_appearance_lighting': {},
    'minecraft:particle_appearance_tinting': {'color': [0.6, 0.55, 0.5, 0.8]},
}
comps.update(billboard([0.03, 0.03], (7, 0)))
particle('moth_dust', 'particles_alpha', comps)
# blood mist when the creature is hurt badly / escapes
comps = {
    'minecraft:emitter_rate_instant': {'num_particles': 25},
    'minecraft:emitter_lifetime_once': {'active_time': 0.1},
    'minecraft:emitter_shape_box': {'offset': [0, 1.2, 0], 'half_dimensions': [0.4, 1.0, 0.4], 'direction': 'outwards'},
    'minecraft:particle_lifetime_expression': {'max_lifetime': '0.6 + variable.particle_random_1 * 0.6'},
    'minecraft:particle_initial_speed': 1.5,
    'minecraft:particle_motion_dynamic': {'linear_acceleration': [0, -4, 0], 'linear_drag_coefficient': 2},
    'minecraft:particle_appearance_lighting': {},
    'minecraft:particle_appearance_tinting': {'color': [0.45, 0.04, 0.04, 0.9]},
}
comps.update(billboard([0.08, 0.08], (3, 0)))
particle('blood_mist', 'particles_blend', comps)

# =============================================================================== sounds
S = 'sounds/shaftbreaker/'


def snd(files, vol=1.0, pitch=1.0, stream=False):
    return [{'name': S + f, 'volume': vol, 'pitch': pitch, 'load_on_low_memory': True, 'stream': stream} for f in files]


def rng(prefix, n):
    return ['%s%d' % (prefix, i) for i in range(1, n + 1)]


SD = {}


def sdef(name, files, cat='hostile', mn=1.0, mx=32.0, vol=1.0, stream=False):
    SD[NS + '.' + name] = {'category': cat, 'min_distance': mn, 'max_distance': mx, 'sounds': snd(files, vol, stream=stream)}


sdef('step', rng('mob/step', 4), mx=28, vol=0.9)
sdef('step_wet', rng('mob/step_wet', 2), mx=24, vol=0.9)
sdef('scrape', rng('mob/scrape', 3), mx=40)
sdef('smash', rng('mob/smash', 3), mx=48)
sdef('screech', rng('mob/screech', 3), mn=4, mx=96)
sdef('scream_far', rng('mob/scream_far', 2), mn=24, mx=128, vol=0.8)
sdef('growl', rng('mob/growl', 3), mx=24)
sdef('attack_snarl', rng('mob/growl', 3) + rng('mob/click', 4), mx=24, vol=0.7)
sdef('breath', rng('mob/breath', 4), mx=12, vol=0.9)
sdef('click', rng('mob/click', 4), mx=20)
sdef('hurt', rng('mob/hurt', 3), mx=32)
sdef('death', ['mob/death1'], mn=8, mx=96)
sdef('whisper', rng('mob/whisper', 4), mx=10, vol=0.7)
sdef('knock', rng('mob/knock', 3), mn=4, mx=56)
sdef('vanish', rng('mob/vanish', 2), mx=24)
sdef('appear', ['mob/appear1'], mx=20)
sdef('crawl', rng('mob/crawl', 3), mx=28)
sdef('climb', rng('mob/climb', 2), mx=28)
sdef('move_far', rng('mob/move_far', 4), mn=6, mx=64)
sdef('jaw', ['mob/jaw_open1'], mx=16)
# player-centred (played at the listener's position)
sdef('heartbeat.slow', ['player/heartbeat_slow'], cat='player', mn=64, mx=128)
sdef('heartbeat.med', ['player/heartbeat_med'], cat='player', mn=64, mx=128)
sdef('heartbeat.fast', ['player/heartbeat_fast'], cat='player', mn=64, mx=128)
sdef('spotted', rng('player/spotted', 3), cat='hostile', mn=64, mx=128)
sdef('tinnitus', ['player/tinnitus1'], cat='player', mn=64, mx=128, vol=0.6)
sdef('pressure', ['player/pressure1'], cat='hostile', mn=64, mx=128)
sdef('rumble', rng('player/rumble', 3), cat='ambient', mn=16, mx=96)
sdef('drip', rng('player/drip', 4), cat='ambient', mn=2, mx=24, vol=0.8)
sdef('ambience', rng('player/ambience', 5), cat='ambient', mn=64, mx=128, stream=True)
sdef('territory', rng('player/territory', 4), cat='ambient', mn=64, mx=128, stream=True)
# blocks
sdef('block.organ_pulse', rng('block/organ_pulse', 2), cat='block', mx=20)
sdef('block.organ_burst', ['block/organ_burst1'], cat='block', mx=32)
sdef('block.pod_open', ['block/pod_open1'], cat='block', mx=20)
sdef('block.flesh_break', rng('block/flesh_break', 3), cat='block', mx=16)
sdef('block.flesh_step', rng('block/flesh_step', 3), cat='block', mx=12)
sdef('block.chime', rng('block/chime', 2), cat='block', mn=2, mx=48)
# moth
sdef('moth.flutter', rng('moth/flutter', 3), cat='neutral', mx=12, vol=0.6)
sdef('moth.giggle', rng('moth/giggle', 3), cat='hostile', mx=16, vol=0.8)
sdef('moth.death', ['moth/death1'], cat='neutral', mx=12)
# music: as real music tracks (playMusic) and as a sound-effect fallback
for m in ('stalk', 'encounter', 'chase', 'final'):
    SD[NS + '.music.' + m] = {'category': 'music', 'sounds': snd(['music/' + m], 1.0, stream=True)}
    SD[NS + '.sfx_music.' + m] = {'category': 'hostile', 'min_distance': 100, 'max_distance': 200,
                                  'sounds': snd(['music/' + m], 0.8, stream=True)}
write(os.path.join(RP, 'sounds', 'sound_definitions.json'), {'format_version': '1.20.20', 'sound_definitions': SD})
write(os.path.join(RP, 'sounds.json'), {
    'entity_sounds': {'entities': {
        NS + ':shaftbreaker': {'volume': 1.0, 'pitch': [0.9, 1.1], 'events': {'hurt': NS + '.hurt', 'death': NS + '.death'}},
        NS + ':grinning_moth': {'volume': 0.8, 'pitch': [0.9, 1.2], 'events': {'hurt': NS + '.moth.giggle',
                                                                              'death': NS + '.moth.death',
                                                                              'ambient': NS + '.moth.flutter'}},
        NS + ':phantom': {'volume': 0, 'events': {}},
        NS + ':waypoint': {'volume': 0, 'events': {}}}},
    'block_sounds': {'shaftbreaker_flesh': {'volume': 1.0, 'pitch': [0.8, 1.0], 'events': {
        'default': '', 'item.use.on': {'sound': NS + '.block.flesh_step'},
        'break': {'sound': NS + '.block.flesh_break'}, 'hit': {'sound': NS + '.block.flesh_step', 'volume': 0.35},
        'place': {'sound': NS + '.block.flesh_break', 'volume': 0.8}, 'power.on': '', 'power.off': ''}}},
    'interactive_sounds': {'block_sounds': {'shaftbreaker_flesh': {'volume': 1.0, 'pitch': 1.0, 'events': {
        'default': '', 'fall': {'sound': NS + '.block.flesh_step', 'volume': 0.4},
        'jump': {'sound': NS + '.block.flesh_step', 'volume': 0.12},
        'step': {'sound': NS + '.block.flesh_step', 'volume': 0.3},
        'land': {'sound': NS + '.block.flesh_step', 'volume': 0.22}}}}}})

# =============================================================================== language
lang('pack.description', 'The Shaftbreaker - a learning, stalking cave horror with its own infected territory.')
lang('action.hint.exit.shaftbreaker:shaftbreaker', ' ')
with open(os.path.join(RP, 'texts', 'en_US.lang'), 'w') as f:
    for k, v in LANG:
        f.write('%s=%s\n' % (k, v))
with open(os.path.join(BP, 'texts', 'en_US.lang'), 'w') as f:
    f.write('pack.description=The Shaftbreaker - a learning, stalking cave horror with its own infected territory.\n')
print('packs written: blocks=%d items=%d sounds=%d terrain=%d' % (
    len(SOUNDS_RP), len(ITEM_TEX), len(SD), len(TERRAIN)))
