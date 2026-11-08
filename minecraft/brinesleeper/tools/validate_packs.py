"""Offline consistency check of the generated Bedrock packs (no game needed).

Checks that every JSON parses; that feature / feature-rule / biome identifiers match their file names;
that every referenced feature, structure, block, texture, fog and sound exists; that the .mcstructure
files decode; and that the Brinesleeper spawn rule targets the biome's tag.
Usage: python3 validate_packs.py <pack root dir containing resource_pack/ and behavior_pack/> [mojang-blocks.json]

With Mojang's block metadata (bedrock-samples metadata/vanilladata_modules/mojang-blocks.json) every vanilla block
named by a feature or stored in a structure palette is also checked: the name must exist and every state must be
one of that block's real states with an allowed value, and no state may be missing.
"""
import glob
import json
import os
import struct
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '..'
VANILLA = None
if len(sys.argv) > 2:
    _meta = json.load(open(sys.argv[2]))
    _props = {p['name']: [v['value'] for v in p['values']] for p in _meta['block_properties']}
    VANILLA = {b['name']: {p['name']: _props.get(p['name'], []) for p in b.get('properties', [])} for b in _meta['data_items']}
RP = os.path.join(ROOT, 'resource_pack')
BP = os.path.join(ROOT, 'behavior_pack')
errors, notes = [], []


def err(msg):
    errors.append(msg)


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception as e:                     # noqa: BLE001 - report any parse failure
        err(f'{path}: {e}')
        return None


# ------------------------------------------------------------------ every JSON parses
for path in glob.glob(f'{ROOT}/*_pack/**/*.json', recursive=True):
    load(path)

# ------------------------------------------------------------------ features and feature rules
features = {}
for path in glob.glob(f'{BP}/features/*.json'):
    d = load(path) or {}
    kinds = [k for k in d if k.startswith('minecraft:')]
    if len(kinds) != 1:
        err(f'{path}: expected exactly one feature type, got {kinds}')
        continue
    ident = d[kinds[0]]['description']['identifier']
    if ident.split(':')[-1] != os.path.basename(path)[:-5]:
        err(f'{path}: identifier {ident} does not match the file name')
    features[ident] = (kinds[0], d[kinds[0]], d.get('format_version'))

custom_blocks = {}
for path in glob.glob(f'{BP}/blocks/*.json'):
    d = load(path) or {}
    ident = d['minecraft:block']['description']['identifier']
    custom_blocks[ident] = d['minecraft:block']


def check_block(name, where, states=None):
    if isinstance(name, list):                           # weighted list [{"block": ..., "weight": n}]
        for e in name:
            check_block(e['block'], where)
        return
    if isinstance(name, dict):
        name, states = name.get('name', ''), name.get('states')
    if name.startswith('minecraft:'):
        if VANILLA is None:
            return
        if name not in VANILLA:
            err(f'{where}: no vanilla block called {name}')
            return
        if states is not None:
            real = VANILLA[name]
            for k, v in states.items():
                if k not in real:
                    err(f'{where}: {name} has no state {k}')
                elif real[k] and v not in real[k] and not (isinstance(v, int) and bool(v) in real[k] and set(real[k]) == {False, True}):
                    err(f'{where}: {name} state {k}={v!r} is not one of {real[k]}')
            for k in real:
                if k not in states:
                    err(f'{where}: {name} is missing its {k} state')
        return
    if name not in custom_blocks:
        err(f'{where}: unknown block {name}')


def refs(kind, body):
    out = []
    for key in ('places_feature', 'feature_to_snap', 'feature_to_place', 'vegetation_feature'):
        if key in body:
            out.append(body[key])
    if 'features' in body:
        out += [f[0] if isinstance(f, list) else f for f in body['features']]
    return out


structure_files = {os.path.relpath(p, f'{BP}/structures') for p in glob.glob(f'{BP}/structures/**/*.mcstructure', recursive=True)}
for ident, (kind, body, fmt) in features.items():
    for r in refs(kind, body):
        if r not in features:
            err(f'feature {ident}: references missing feature {r}')
    if kind == 'minecraft:structure_template_feature':
        ns, path = body['structure_name'].split(':', 1)
        if f'{ns}/{path}.mcstructure' not in structure_files:
            err(f'feature {ident}: missing structure file {ns}/{path}.mcstructure')
    if kind == 'minecraft:single_block_feature':
        check_block(body['places_block'], ident)
        for b in body.get('may_replace', []):
            check_block(b, ident)
    if kind == 'minecraft:ore_feature':
        for rr in body['replace_rules']:
            check_block(rr['places_block'], ident)
            for b in rr.get('may_replace', []):
                check_block(b, ident)
    if kind == 'minecraft:fossil_feature':
        check_block(body['ore_block'], ident)
        if not isinstance(body['max_empty_corners'], int):
            err(f'feature {ident}: max_empty_corners must be an integer')
    if kind == 'minecraft:sequence_feature' and not body['features']:
        err(f'feature {ident}: empty sequence')
    if kind == 'minecraft:structure_template_feature' and not 0 <= body.get('adjustment_radius', 0) <= 16:
        err(f'feature {ident}: adjustment_radius must be within [0, 16]')
    if kind == 'minecraft:vegetation_patch_feature':
        check_block(body['ground_block'], ident)
    if kind == 'minecraft:growing_plant_feature':
        for b, _ in body['body_blocks'] + body['head_blocks']:
            check_block(b, ident)
    ver = tuple(int(p) for p in fmt.split('.'))
    if kind == 'minecraft:snap_to_surface_feature':
        if body.get('embed_in_surface') and ver < (1, 26, 20):
            err(f'feature {ident}: embed_in_surface needs format_version 1.26.20+')
        # 1.26.50 renamed vertical_search_range to search_range; each version accepts only its own name
        want = 'search_range' if ver >= (1, 26, 50) else 'vertical_search_range'
        other = 'vertical_search_range' if want == 'search_range' else 'search_range'
        if want not in body or other in body:
            err(f'feature {ident}: format {fmt} needs "{want}" (and not "{other}")')
        if body.get('surface') == 'wall' and ver < (1, 26, 50):
            err(f'feature {ident}: surface "wall" needs format_version 1.26.50+')
        if body.get('surface') == 'random_horizontal':
            err(f'feature {ident}: "random_horizontal" picks floor or ceiling, never a wall')
    if kind == 'minecraft:growing_plant_feature' and body.get('growth_direction') not in ('up', 'down'):
        err(f'feature {ident}: growth_direction should be "up" or "down"')
    if kind == 'minecraft:weighted_random_feature':
        for f in body['features']:
            if not isinstance(f[1], int) or f[1] < 1:
                err(f'feature {ident}: weight {f[1]} must be a whole number of at least 1 (fractions are truncated)')

rule_targets = set()
for path in glob.glob(f'{BP}/feature_rules/*.json'):
    d = load(path) or {}
    fr = d['minecraft:feature_rules']
    ident = fr['description']['identifier']
    if ident.split(':')[-1] != os.path.basename(path)[:-5]:
        err(f'{path}: identifier {ident} does not match the file name')
    passes = {'pregeneration_pass', 'first_pass', 'before_underground_pass', 'underground_pass', 'after_underground_pass',
              'before_surface_pass', 'surface_pass', 'after_surface_pass', 'before_sky_pass', 'sky_pass', 'after_sky_pass', 'final_pass'}
    if fr['conditions']['placement_pass'] not in passes:
        err(f'{path}: unknown placement pass {fr["conditions"]["placement_pass"]}')
    sc = fr.get('distribution', {}).get('scatter_chance')
    if isinstance(sc, dict) and not 0 < sc['numerator'] <= sc['denominator']:
        err(f'{path}: scatter_chance must be a fraction between 0 and 1')
    if fr['description']['places_feature'] not in features:
        err(f'{path}: places missing feature {fr["description"]["places_feature"]}')
    rule_targets.add(fr['description']['places_feature'])
    for t in fr['conditions'].get('minecraft:biome_filter', []):
        rule_targets.add(('tag', t.get('value')))

# every feature is reachable from some rule
reach, todo = set(), [t for t in rule_targets if isinstance(t, str)]
while todo:
    f = todo.pop()
    if f in reach or f not in features:
        continue
    reach.add(f)
    todo += refs(*features[f][:2])
for f in features:
    if f not in reach:
        err(f'feature {f} is never placed by any feature rule')

# ------------------------------------------------------------------ structures decode
def read_nbt(buf):
    pos = 0

    def s():
        nonlocal pos
        n = struct.unpack_from('<H', buf, pos)[0]; pos += 2
        v = buf[pos:pos + n].decode(); pos += n
        return v

    def payload(t):
        nonlocal pos
        if t == 1:
            v = struct.unpack_from('<b', buf, pos)[0]; pos += 1; return v
        if t == 3:
            v = struct.unpack_from('<i', buf, pos)[0]; pos += 4; return v
        if t == 8:
            return s()
        if t == 9:
            et = buf[pos]; pos += 1
            n = struct.unpack_from('<i', buf, pos)[0]; pos += 4
            return [payload(et) for _ in range(n)]
        if t == 10:
            out = {}
            while True:
                tt = buf[pos]; pos += 1
                if tt == 0:
                    return out
                k = s()
                out[k] = payload(tt)
        raise ValueError(f'tag {t}')
    assert buf[0] == 10
    pos = 1
    s()
    return payload(10)


for rel in sorted(structure_files):
    st = read_nbt(open(f'{BP}/structures/{rel}', 'rb').read())
    size = st['size']
    idx = st['structure']['block_indices']
    pal = st['structure']['palette']['default']['block_palette']
    if len(idx[0]) != size[0] * size[1] * size[2] or len(idx[1]) != len(idx[0]):
        err(f'{rel}: block index count does not match size {size}')
    if any(i >= len(pal) for i in idx[0]):
        err(f'{rel}: block index out of palette range')
    for p_ in pal:
        check_block({'name': p_['name'], 'states': p_['states']}, f'structure {rel}')
    if 'dripstone_thickness' in pal[0]['states']:
        notes.append(f'{rel}: ' + ' > '.join(pal[i]['states']['dripstone_thickness'] for i in reversed(idx[0])) + (
            ' (hanging)' if pal[0]['states']['hanging'] else ''))
    else:
        used = sum(1 for i in idx[0] if i >= 0)
        notes.append(f'{rel}: {size[0]}x{size[1]}x{size[2]}, {used} blocks of {len(pal)} kinds')

# ------------------------------------------------------------------ biome, client biome, fog, textures, sounds
biomes = {}
for path in glob.glob(f'{BP}/biomes/*.json'):
    d = load(path) or {}
    b = d['minecraft:biome']
    biomes[b['description']['identifier']] = b
    tags = b['components']['minecraft:tags']['tags']
    if 'monster' in tags:
        err(f'{path}: has the monster tag, so vanilla hostile mobs would spawn')
    reps = b['components'].get('minecraft:replace_biomes', {}).get('replacements', [])
    if not reps:
        err(f'{path}: no minecraft:replace_biomes, so the biome never generates')
    for r in reps:
        # the game looks targets up by full identifier: a bare name fails with "No biome found with name"
        if not all(t.startswith('minecraft:') for t in r['targets']):
            err(f'{path}: replace_biomes targets need the full identifier, e.g. "minecraft:dripstone_caves"')
        if not (0 < r['amount'] <= 1 and 0 < r['noise_frequency_scale'] <= 100):
            err(f'{path}: replacement amount / noise_frequency_scale out of range')

CLIENT_KEYS = {'minecraft:fog_appearance', 'minecraft:water_appearance', 'minecraft:sky_color', 'minecraft:ambient_sounds',
               'minecraft:biome_music', 'minecraft:precipitation', 'minecraft:atmosphere_identifier', 'minecraft:color_grading_identifier',
               'minecraft:lighting_identifier', 'minecraft:water_identifier', 'minecraft:foliage_appearance', 'minecraft:grass_appearance',
               'minecraft:dry_foliage_color', 'minecraft:cubemap_identifier'}
fogs = {}
for path in glob.glob(f'{RP}/fogs/*.json'):
    d = load(path) or {}
    fogs[d['minecraft:fog_settings']['description']['identifier']] = d
for path in glob.glob(f'{RP}/biomes/*.json'):
    d = load(path) or {}
    cb = d['minecraft:client_biome']
    for k in cb['components']:
        if k not in CLIENT_KEYS:
            err(f'{path}: unknown client biome component {k}')
    if cb['description']['identifier'] not in biomes:
        err(f'{path}: client biome for unknown biome {cb["description"]["identifier"]}')
    fid = cb['components'].get('minecraft:fog_appearance', {}).get('fog_identifier', '')
    if fid and not fid.startswith('minecraft:') and fid not in fogs:
        err(f'{path}: unknown fog {fid}')
    named = (load(f'{RP}/sounds.json') or {}).get('individual_named_sounds', {}).get('sounds', {})
    defs = (load(f'{RP}/sounds/sound_definitions.json') or {}).get('sound_definitions', {})
    amb = cb['components'].get('minecraft:ambient_sounds', {})
    for key in ('addition', 'loop', 'mood'):
        v = amb.get(key)
        asset = v.get('asset') if isinstance(v, dict) else v
        if asset and not asset.startswith('ambient.cave') and asset not in named and not asset.startswith('ambient.underwater'):
            err(f'{path}: ambient {key} sound {asset} is not an individual named sound')
        if asset in named and named[asset]['sound'] not in defs:
            err(f'{path}: named sound {asset} has no sound definition')
    for name, sd in defs.items():
        for snd in sd['sounds']:
            if not glob.glob(f'{RP}/{snd["name"]}.*'):
                err(f'sound {name}: missing file {snd["name"]}')

terrain = (load(f'{RP}/textures/terrain_texture.json') or {}).get('texture_data', {})
for tex, v in terrain.items():
    if not os.path.exists(f'{RP}/{v["textures"]}.png'):
        err(f'terrain texture {tex}: missing {v["textures"]}.png')
for ident, blk in custom_blocks.items():
    comps = blk['components']
    if ('minecraft:geometry' in comps) != ('minecraft:material_instances' in comps):
        err(f'block {ident}: geometry and material_instances must be used together')
    for face, mi in comps.get('minecraft:material_instances', {}).items():
        if mi['texture'] not in terrain:
            err(f'block {ident}: face {face} uses unknown texture {mi["texture"]}')
blocks_json = load(f'{RP}/blocks.json') or {}
for ident in custom_blocks:
    if ident not in blocks_json:
        err(f'block {ident}: no sound entry in blocks.json')
lang = open(f'{RP}/texts/en_US.lang').read() if os.path.exists(f'{RP}/texts/en_US.lang') else ''
for ident in custom_blocks:
    if f'tile.{ident}.name=' not in lang:
        err(f'block {ident}: no name in en_US.lang')

# ------------------------------------------------------------------ spawn rule targets the biome tag
for path in glob.glob(f'{BP}/spawn_rules/*.json'):
    d = load(path) or {}
    for c in d['minecraft:spawn_rules']['conditions']:
        v = c.get('minecraft:biome_filter', {}).get('value')
        if not any(v in b['components']['minecraft:tags']['tags'] for b in biomes.values()):
            err(f'{path}: spawn biome tag {v} is not carried by any pack biome')

print(f'{len(features)} features, {len(rule_targets)} rule targets, {len(structure_files)} structures, '
      f'{len(custom_blocks)} blocks, {len(biomes)} biome(s), {len(fogs)} fog(s)')
for n in notes:
    print('  ' + n)
print('ERRORS:' if errors else 'no problems found')
for e in errors:
    print('  ' + e)
sys.exit(1 if errors else 0)
