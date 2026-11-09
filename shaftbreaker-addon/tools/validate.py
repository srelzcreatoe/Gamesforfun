#!/usr/bin/env python3
"""Cross-reference validator for the Shaftbreaker packs. Exits non-zero on any error."""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, 'BP')
RP = os.path.join(ROOT, 'RP')
errors, warns = [], []


def load(p):
    try:
        return json.load(open(p))
    except Exception as e:
        errors.append(f'JSON parse {os.path.relpath(p, ROOT)}: {e}')
        return None


# 1) every JSON parses
alljson = {p: load(p) for p in glob.glob(os.path.join(ROOT, 'BP', '**', '*.json'), recursive=True) + glob.glob(os.path.join(ROOT, 'RP', '**', '*.json'), recursive=True)}

terrain = load(os.path.join(RP, 'textures/terrain_texture.json'))['texture_data']
items_tex = load(os.path.join(RP, 'textures/item_texture.json'))['texture_data']
for name, d in list(terrain.items()) + list(items_tex.items()):
    if not os.path.exists(os.path.join(RP, d['textures'] + '.png')):
        errors.append(f'texture file missing for {name}: {d["textures"]}')
for fb in load(os.path.join(RP, 'textures/flipbook_textures.json')):
    if fb['atlas_tile'] not in terrain:
        errors.append(f'flipbook atlas tile not in terrain: {fb["atlas_tile"]}')

# geometries
geos = set()
for p in glob.glob(os.path.join(RP, 'models', '**', '*.json'), recursive=True):
    g = alljson.get(p)
    for geo in (g or {}).get('minecraft:geometry', []):
        geos.add(geo['description']['identifier'])

# 2) blocks
block_ids = set()
lang = {}
for line in open(os.path.join(RP, 'texts/en_US.lang')):
    if '=' in line:
        k, v = line.rstrip('\n').split('=', 1)
        lang[k] = v
blocks_json = load(os.path.join(RP, 'blocks.json'))
for p in glob.glob(os.path.join(BP, 'blocks', '*.json')):
    b = alljson[p]['minecraft:block']
    bid = b['description']['identifier']
    block_ids.add(bid)
    comps = [b['components']] + [pp['components'] for pp in b.get('permutations', [])]
    for c in comps:
        for k, mi in c.get('minecraft:material_instances', {}).items():
            if mi['texture'] not in terrain:
                errors.append(f'{bid}: material texture {mi["texture"]} not in terrain_texture')
        g = c.get('minecraft:geometry')
        if g and (g if isinstance(g, str) else g['identifier']) not in geos and not str(g).startswith('minecraft:geometry'):
            errors.append(f'{bid}: geometry {g} missing')
        loot = c.get('minecraft:loot')
        if loot and not os.path.exists(os.path.join(BP, loot)):
            errors.append(f'{bid}: loot table missing {loot}')
    if f'tile.{bid}.name' not in lang:
        errors.append(f'{bid}: missing lang')
    if bid not in blocks_json:
        warns.append(f'{bid}: no RP blocks.json sound entry')
    states = b['description'].get('states', {})
    for pp in b.get('permutations', []):
        for sname in re.findall(r"q\.block_state\('([^']+)'\)", pp['condition']):
            if sname not in states:
                errors.append(f'{bid}: permutation references unknown state {sname}')

# 3) items + loot + recipes
item_ids = set()
for p in glob.glob(os.path.join(BP, 'items', '*.json')):
    it = alljson[p]['minecraft:item']
    iid = it['description']['identifier']
    item_ids.add(iid)
    icon = it['components'].get('minecraft:icon')
    if isinstance(icon, str) and icon not in items_tex:
        errors.append(f'{iid}: icon {icon} missing from item_texture')
    dn = it['components'].get('minecraft:display_name', {}).get('value')
    if dn and dn not in lang:
        errors.append(f'{iid}: display name key {dn} missing')
    proj = it['components'].get('minecraft:projectile', {}).get('projectile_entity')
    if proj and not os.path.exists(os.path.join(BP, 'entities', proj.split(':')[1] + '.json')):
        errors.append(f'{iid}: projectile entity missing {proj}')
known_items = item_ids | block_ids


def check_item(name, where):
    if name.startswith('shaftbreaker:') and name not in known_items:
        errors.append(f'{where}: unknown item {name}')


for p in glob.glob(os.path.join(BP, 'loot_tables', '**', '*.json'), recursive=True):
    for pool in alljson[p].get('pools', []):
        for e in pool.get('entries', []):
            check_item(e.get('name', ''), os.path.relpath(p, ROOT))
for p in glob.glob(os.path.join(BP, 'recipes', '*.json')):
    r = alljson[p].get('minecraft:recipe_shapeless') or alljson[p].get('minecraft:recipe_shaped')
    for ing in r['ingredients']:
        check_item(ing['item'], os.path.relpath(p, ROOT))
    check_item(r['result']['item'], os.path.relpath(p, ROOT))

# 4) entities (BP <-> RP)
anim_ids, ctrl_ids = set(), set()
for p in glob.glob(os.path.join(RP, 'animations', '*.json')):
    anim_ids |= set(alljson[p]['animations'].keys())
for p in glob.glob(os.path.join(RP, 'animation_controllers', '*.json')):
    ctrl_ids |= set(alljson[p]['animation_controllers'].keys())
rcs = set()
for p in glob.glob(os.path.join(RP, 'render_controllers', '*.json')):
    rcs |= set(alljson[p]['render_controllers'].keys())
particles = set()
for p in glob.glob(os.path.join(RP, 'particles', '*.json')):
    particles.add(alljson[p]['particle_effect']['description']['identifier'])
sounds = set(load(os.path.join(RP, 'sounds/sound_definitions.json'))['sound_definitions'].keys())
VANILLA_RC = {'controller.render.item_sprite', 'controller.render.default'}
VANILLA_GEO = {'geometry.item_sprite'}
VANILLA_ANIM = {'animation.actor.billboard'}
bp_entities = {}
for p in glob.glob(os.path.join(BP, 'entities', '*.json')):
    e = alljson[p]['minecraft:entity']
    eid = e['description']['identifier']
    bp_entities[eid] = e
    groups = set(e.get('component_groups', {}).keys())
    for ev, body in e.get('events', {}).items():
        for act in ('add', 'remove'):
            for g in body.get(act, {}).get('component_groups', []):
                if g not in groups:
                    errors.append(f'{eid}: event {ev} references unknown group {g}')
    lt = e['components'].get('minecraft:loot', {}).get('table')
    if lt and not os.path.exists(os.path.join(BP, lt)):
        errors.append(f'{eid}: loot table missing')
    if f'entity.{eid}.name' not in lang:
        errors.append(f'{eid}: missing entity lang')
    props = e['description'].get('properties', {})
    for pn, pd in props.items():
        if pd['type'] == 'enum':
            if len(pd['values']) > 16:
                errors.append(f'{eid}: enum {pn} has >16 values')
            for v in pd['values']:
                if len(v) > 32 or not re.match(r'^[A-Za-z0-9_]+$', v):
                    errors.append(f'{eid}: bad enum value {v}')
client = {}
for p in glob.glob(os.path.join(RP, 'entity', '*.json')):
    d = alljson[p]['minecraft:client_entity']['description']
    eid = d['identifier']
    client[eid] = d
    if eid not in bp_entities:
        errors.append(f'client entity {eid} has no BP entity')
    for g in d.get('geometry', {}).values():
        if g not in geos and g not in VANILLA_GEO:
            errors.append(f'{eid}: geometry {g} missing')
    for t in d.get('textures', {}).values():
        if not os.path.exists(os.path.join(RP, t + '.png')):
            errors.append(f'{eid}: texture {t} missing')
    for short, aid in d.get('animations', {}).items():
        if aid not in anim_ids and aid not in ctrl_ids and aid not in VANILLA_ANIM:
            errors.append(f'{eid}: animation {short} -> {aid} missing')
    for rc in d.get('render_controllers', []):
        if rc not in rcs and rc not in VANILLA_RC:
            errors.append(f'{eid}: render controller {rc} missing')
    for pe in d.get('particle_effects', {}).values():
        if pe not in particles:
            errors.append(f'{eid}: particle {pe} missing')
    for se in d.get('sound_effects', {}).values():
        if se['effect'] not in sounds:
            errors.append(f'{eid}: sound effect {se["effect"]} missing')
    for a in d.get('scripts', {}).get('animate', []):
        name = a if isinstance(a, str) else list(a.keys())[0]
        if name not in d.get('animations', {}):
            errors.append(f'{eid}: animate {name} not in animations map')
    # controllers used by this entity must only reference animations in its map
    for short, aid in d.get('animations', {}).items():
        if aid in ctrl_ids:
            for p2 in glob.glob(os.path.join(RP, 'animation_controllers', '*.json')):
                ctrl = alljson[p2]['animation_controllers'].get(aid)
                if not ctrl:
                    continue
                for sname, st in ctrl['states'].items():
                    for a in st.get('animations', []):
                        an = a if isinstance(a, str) else list(a.keys())[0]
                        if an not in d['animations']:
                            errors.append(f'{eid}: controller {aid}.{sname} uses {an} not in animations map')
                    for tr in st.get('transitions', []):
                        target = list(tr.keys())[0]
                        if target not in ctrl['states']:
                            errors.append(f'{aid}: transition to unknown state {target}')
                    for prop in re.findall(r"query\.property\('([^']+)'\)", json.dumps(st)):
                        if prop not in bp_entities[eid]['description'].get('properties', {}):
                            errors.append(f'{eid}: controller {aid} reads unknown property {prop}')
    # render controller property reads
    for rc in d.get('render_controllers', []):
        for p2 in glob.glob(os.path.join(RP, 'render_controllers', '*.json')):
            rcd = alljson[p2]['render_controllers'].get(rc)
            if rcd:
                for prop in re.findall(r"query\.property\('([^']+)'\)", json.dumps(rcd)):
                    if prop not in bp_entities[eid]['description'].get('properties', {}):
                        errors.append(f'{eid}: render controller reads unknown property {prop}')

# animation sound/particle effects need to exist in the entity mapping
for p in glob.glob(os.path.join(RP, 'animations', 'shaftbreaker*.json')):
    for aid, a in alljson[p]['animations'].items():
        for t, se in a.get('sound_effects', {}).items():
            if se['effect'] not in client['shaftbreaker:shaftbreaker']['sound_effects']:
                errors.append(f'{aid}: sound effect key {se["effect"]} not mapped')
        for t, pe in a.get('particle_effects', {}).items():
            if pe['effect'] not in client['shaftbreaker:shaftbreaker']['particle_effects']:
                errors.append(f'{aid}: particle key {pe["effect"]} not mapped')

# 5) sound files exist
for sid, sd in load(os.path.join(RP, 'sounds/sound_definitions.json'))['sound_definitions'].items():
    for s in sd['sounds']:
        if not os.path.exists(os.path.join(RP, s['name'] + '.ogg')):
            errors.append(f'sound {sid}: file {s["name"]}.ogg missing')

# 6) script string references
src = ''
for p in glob.glob(os.path.join(BP, 'scripts', '**', '*.js'), recursive=True):
    src += open(p).read()
VANILLA_SOUNDS = {'dig.stone', 'step.stone', 'random.fizz', 'random.door_open', 'random.door_close', 'random.break', 'fire.ignite',
                  'item.book.page_turn', 'block.cloth.place'}
for sid in set(re.findall(r'"(shaftbreaker\.[a-z_.]+)"', src)):
    if sid not in sounds and not sid.endswith('.'):
        errors.append(f'script sound {sid} not defined')
for prefix in set(re.findall(r'"(shaftbreaker\.(?:music|sfx_music)\.)"', src)):
    for m in ('stalk', 'encounter', 'chase', 'final'):
        if prefix + m not in sounds:
            errors.append(f'music {prefix + m} missing')
for pid in set(re.findall(r'"(shaftbreaker:[a-z_]+)"', src)):
    if pid in particles or pid in block_ids or pid in item_ids or pid in bp_entities:
        continue
    # entity events / groups / properties / dynamic properties / tags are checked below
    if any(pid in json.dumps(e) for e in bp_entities.values()):
        continue
    if pid.startswith('shaftbreaker:') and pid.split(':')[1] in ('world', 'config', 'profile', 'watcher', 'born', 'life', 'looked', 'spotted', 'h', 'mode_', 'nav_', 'tier_', 'size_'):
        continue
    all_states = set()
    for p2 in glob.glob(os.path.join(BP, 'blocks', '*.json')):
        all_states |= set(alljson[p2]['minecraft:block']['description'].get('states', {}).keys())
    if pid in all_states:
        continue
    warns.append(f'script string {pid} not matched to any resource (ok if dynamic property)')
EXPAND = {'shaftbreaker:mode_': ['passive', 'hunt', 'seek'], 'shaftbreaker:nav_': ['ground', 'ground_doors', 'climb', 'climb_doors'],
          'shaftbreaker:size_': ['stand', 'crawl'], 'shaftbreaker:tier_': ['easy', 'normal', 'brutal']}
evs = set()
for ev in set(re.findall(r'triggerEvent\("([^"]+)"', src)):
    evs |= set(ev + x for x in EXPAND[ev]) if ev in EXPAND else {ev}
for ev in evs:
    if not any(ev in e.get('events', {}) for e in bp_entities.values()):
        errors.append(f'script triggers unknown event {ev}')
for ev in re.findall(r'triggerEvent\("shaftbreaker:(mode|nav|size|tier)_" \+', src):
    pass
for prop in (set(re.findall(r'setProperty\("([^"]+)"', src)) - {"shaftbreaker:"}) | set("shaftbreaker:" + x for x in re.findall(r'setProp\(b, "([a-z]+)"', src)):
    if not any(prop in e['description'].get('properties', {}) for e in bp_entities.values()):
        errors.append(f'script sets unknown property {prop}')
for st in set(re.findall(r'visual\(b, "([a-z_]+)"\)', src)) | set(re.findall(r'holdVisual\(b, "([a-z_]+)"', src)):
    if st not in bp_entities['shaftbreaker:shaftbreaker']['description']['properties']['shaftbreaker:state']['values']:
        errors.append(f'script visual state {st} not an enum value')
for bid in set(re.findall(r'"(shaftbreaker:[a-z_]+)"', src)):
    pass

# 7) manifests
for m in ('BP/manifest.json', 'RP/manifest.json'):
    d = load(os.path.join(ROOT, m))
    if not d or 'min_engine_version' not in d['header']:
        errors.append(f'{m}: bad manifest')
bpm = load(os.path.join(BP, 'manifest.json'))
for dep in bpm['dependencies']:
    if dep.get('module_name') and ('beta' in dep['version'] or 'rc' in dep['version']):
        errors.append('beta/rc script module dependency: ' + dep['version'])

print(f'{len(alljson)} json files, {len(block_ids)} blocks, {len(item_ids)} items, {len(bp_entities)} entities, {len(sounds)} sound events, {len(particles)} particles')
for w in warns:
    print('WARN', w)
for e in errors:
    print('ERROR', e)
print('errors:', len(errors), 'warnings:', len(warns))
sys.exit(1 if errors else 0)
