"""Cross-reference validator for the Shaftbreaker packs.
Checks that every identifier used anywhere resolves to something that exists.
usage: python3 tools/validate.py [path-to-@minecraft/vanilla-data] [path-to-vanilla-resource-pack]
"""
import json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, 'Shaftbreaker_BP')
RP = os.path.join(ROOT, 'Shaftbreaker_RP')
VD = sys.argv[1] if len(sys.argv) > 1 else None
VRP = sys.argv[2] if len(sys.argv) > 2 else None
errors, warns = [], []


def err(m): errors.append(m)
def warn(m): warns.append(m)


def load(p):
    try:
        return json.load(open(p, encoding='utf-8'))
    except Exception as e:
        err(f'JSON parse {os.path.relpath(p, ROOT)}: {e}'); return None


# ---------------------------------------------------------------- parse everything
for base in (BP, RP):
    for p in glob.glob(base + '/**/*.json', recursive=True):
        load(p)

vanilla_blocks, vanilla_items, vanilla_effects, vanilla_entities = set(), set(), set(), set()
if VD:
    def ids(f): return set(re.findall(r'"(minecraft:[a-z0-9_]+)"', open(os.path.join(VD, 'lib', f)).read()))
    vanilla_blocks = ids('mojang-block.d.ts'); vanilla_items = ids('mojang-item.d.ts'); vanilla_entities = ids('mojang-entity.d.ts')
    vanilla_effects = {x.split(':')[1] for x in ids('mojang-effect.d.ts')}
vanilla_sounds = set()
if VRP and os.path.exists(os.path.join(VRP, 'sounds/sound_definitions.json')):
    txt = open(os.path.join(VRP, 'sounds/sound_definitions.json')).read()
    vanilla_sounds = set(re.findall(r'^\s{2,8}"([a-z0-9_.]+)"\s*:\s*\{', txt, re.M))

# ---------------------------------------------------------------- RP indexes
geos = {}
for p in glob.glob(RP + '/models/**/*.json', recursive=True):
    d = load(p) or {}
    for g in d.get('minecraft:geometry', []):
        geos[g['description']['identifier']] = g
anims = {}
for p in glob.glob(RP + '/animations/*.json'):
    anims.update((load(p) or {}).get('animations', {}))
ctrls = {}
for p in glob.glob(RP + '/animation_controllers/*.json'):
    ctrls.update((load(p) or {}).get('animation_controllers', {}))
rcs = {}
for p in glob.glob(RP + '/render_controllers/*.json'):
    rcs.update((load(p) or {}).get('render_controllers', {}))
# render controllers cannot read context.* variables (the 1.0 skull error: "unknown variable 'context.item_slot'")
for p in glob.glob(RP + '/render_controllers/*.json'):
    if re.search(r'\b(?:context|c)\.[a-z_]+', open(p).read()): err(f'{os.path.basename(p)}: render controller uses a context.* variable')
vanilla_rcs = set()
if VRP:
    for p in glob.glob(os.path.join(VRP, 'render_controllers/*.json')):
        vanilla_rcs.update(re.findall(r'"(controller\.render\.[a-z0-9_.]+)"\s*:\s*\{', open(p).read()))
sdefs = (load(RP + '/sounds/sound_definitions.json') or {}).get('sound_definitions', {})
particles = {}
for p in glob.glob(RP + '/particles/*.json'):
    d = load(p) or {}
    particles[d['particle_effect']['description']['identifier']] = d
    tex = d['particle_effect']['description']['basic_render_parameters']['texture']
    if not os.path.exists(os.path.join(RP, tex + '.png')): err(f'particle texture missing {tex}')
lang = {}
for line in open(RP + '/texts/en_US.lang', encoding='utf-8'):
    if '=' in line: k, v = line.rstrip('\n').split('=', 1); lang[k] = v
terrain = (load(RP + '/textures/terrain_texture.json') or {}).get('texture_data', {})
itemtex = (load(RP + '/textures/item_texture.json') or {}).get('texture_data', {})
for k, v in {**terrain, **itemtex}.items():
    if not os.path.exists(os.path.join(RP, v['textures'] + '.png')): err(f'atlas texture {k} -> {v["textures"]}.png missing')

# sound files
for ev, d in sdefs.items():
    for s in d.get('sounds', []):
        n = s['name'] if isinstance(s, dict) else s
        if not os.path.exists(os.path.join(RP, n + '.ogg')): err(f'sound file missing {n}.ogg for {ev}')


def check_bones(anim_name, a, geo_id):
    g = geos.get(geo_id)
    if not g: return
    bones = {b['name'] for b in g['bones']}
    for b in a.get('bones', {}):
        if b not in bones: err(f'{anim_name}: bone {b} not in {geo_id}')


# ---------------------------------------------------------------- client entities
for p in glob.glob(RP + '/entity/*.json'):
    d = load(p) or {}
    desc = d['minecraft:client_entity']['description']
    ident = desc['identifier']
    for gk, gid in desc.get('geometry', {}).items():
        if gid not in geos: err(f'{ident}: geometry {gid} missing')
    for tk, tp in desc.get('textures', {}).items():
        if not os.path.exists(os.path.join(RP, tp + '.png')): err(f'{ident}: texture {tp}.png missing')
    for short, full in desc.get('animations', {}).items():
        if full.startswith('controller.'):
            if full not in ctrls: err(f'{ident}: controller {full} missing')
        elif full not in anims: err(f'{ident}: animation {full} missing')
        else:
            for gid in desc.get('geometry', {}).values(): check_bones(full, anims[full], gid)
            a = anims[full]
            for t, e in a.get('sound_effects', {}).items():
                eff = e['effect']
                if eff not in desc.get('sound_effects', {}): err(f'{ident}: {full} uses sound effect "{eff}" not mapped in client entity')
            for t, e in a.get('particle_effects', {}).items():
                eff = e['effect']
                if eff not in desc.get('particle_effects', {}): err(f'{ident}: {full} uses particle "{eff}" not mapped')
                loc = e.get('locator')
                if loc:
                    g = geos.get(list(desc['geometry'].values())[0])
                    locs = set()
                    for b in g['bones']: locs |= set((b.get('locators') or {}).keys())
                    if loc not in locs: err(f'{ident}: locator {loc} missing in geometry')
    shorts = set(desc.get('animations', {}).keys())
    for entry in desc.get('scripts', {}).get('animate', []):
        k = entry if isinstance(entry, str) else list(entry.keys())[0]
        if k not in shorts: err(f'{ident}: animate references unknown "{k}"')
    for full in desc.get('animations', {}).values():
        if full in ctrls:
            for st, sd in ctrls[full]['states'].items():
                for a in sd.get('animations', []):
                    k = a if isinstance(a, str) else list(a.keys())[0]
                    if k not in shorts: err(f'{ident}: {full}.{st} references unknown animation "{k}"')
                for tr in sd.get('transitions', []):
                    for tgt in tr:
                        if tgt not in ctrls[full]['states']: err(f'{full}: transition to unknown state {tgt}')
    for rc in desc.get('render_controllers', []):
        name = rc if isinstance(rc, str) else list(rc.keys())[0]
        if name not in rcs and not name.startswith('controller.render.default'): err(f'{ident}: render controller {name} missing')
    for k, ev in desc.get('sound_effects', {}).items():
        if ev not in sdefs: err(f'{ident}: sound effect {k} -> {ev} undefined')
    for k, pid in desc.get('particle_effects', {}).items():
        if pid not in particles: err(f'{ident}: particle {pid} undefined')
    if f'entity.{ident}.name' not in lang: err(f'lang: entity.{ident}.name missing')

for p in glob.glob(RP + '/attachables/*.json'):
    d = load(p) or {}
    desc = d['minecraft:attachable']['description']
    for gid in desc.get('geometry', {}).values():
        if gid not in geos: err(f'attachable geometry {gid} missing')
    for rc in desc.get('render_controllers', []):
        if rc not in rcs and rc not in vanilla_rcs: err(f'attachable rc {rc} missing')

# ---------------------------------------------------------------- behavior entities
bp_entities = {}
for p in glob.glob(BP + '/entities/*.json'):
    d = load(p) or {}
    e = d['minecraft:entity']
    ident = e['description']['identifier']
    bp_entities[ident] = e
    groups = set(e.get('component_groups', {}).keys())
    def walk_ev(ev, name):
        for key in ('add', 'remove'):
            for g in ev.get(key, {}).get('component_groups', []):
                if g not in groups: err(f'{ident}: event {name} references missing group {g}')
        for sub in ev.get('sequence', []) + ev.get('randomize', []):
            walk_ev(sub, name)
        for k in ev.get('set_property', {}):
            if k not in e['description'].get('properties', {}): err(f'{ident}: event {name} sets unknown property {k}')
    for name, ev in e.get('events', {}).items(): walk_ev(ev, name)
    for comp in [e.get('components', {})] + list(e.get('component_groups', {}).values()):
        lt = comp.get('minecraft:loot', {}).get('table')
        if lt and not os.path.exists(os.path.join(BP, lt)): err(f'{ident}: loot table {lt} missing')
    if not os.path.exists(os.path.join(RP, 'entity')) or not any((load(q) or {}).get('minecraft:client_entity', {}).get('description', {}).get('identifier') == ident for q in glob.glob(RP + '/entity/*.json')):
        err(f'{ident}: no client entity')

custom_items = set()
for p in glob.glob(BP + '/items/*.json'):
    d = load(p) or {}
    ident = d['minecraft:item']['description']['identifier']; custom_items.add(ident)
    icon = d['minecraft:item']['components'].get('minecraft:icon')
    icon = icon if isinstance(icon, str) else (icon or {}).get('textures', {}).get('default')
    if icon not in itemtex: err(f'{ident}: icon {icon} not in item_texture.json')
    if f'item.{ident}.name' not in lang: err(f'lang: item.{ident}.name missing')
custom_blocks = set()
block_states = {}
for p in glob.glob(BP + '/blocks/**/*.json', recursive=True):
    d = load(p) or {}
    b = d['minecraft:block']
    ident = b['description']['identifier']; custom_blocks.add(ident)
    block_states[ident] = b['description'].get('states', {})
    comps = b['components']
    g = comps.get('minecraft:geometry')
    gid = g if isinstance(g, str) else (g or {}).get('identifier')
    if gid and gid not in geos and not gid.startswith('minecraft:'): err(f'{ident}: block geometry {gid} missing')
    # material_instances without a geometry render as the missing-texture cube in game (bug report from 1.0)
    if comps.get('minecraft:material_instances') and not gid: err(f'{ident}: material_instances without minecraft:geometry (renders untextured)')
    for inst, m in comps.get('minecraft:material_instances', {}).items():
        if not isinstance(m.get('ambient_occlusion', 1.0), (int, float)) or isinstance(m.get('ambient_occlusion'), bool): err(f'{ident}: ambient_occlusion must be a number')
    for inst, m in comps.get('minecraft:material_instances', {}).items():
        if m['texture'] not in terrain: err(f'{ident}: texture {m["texture"]} not in terrain_texture')
    lt = comps.get('minecraft:loot')
    if lt and not os.path.exists(os.path.join(BP, lt)): err(f'{ident}: loot {lt} missing')
    if f'tile.{ident}.name' not in lang: err(f'lang: tile.{ident}.name missing')
for p in glob.glob(BP + '/recipes/*.json'):
    d = load(p) or {}
    r = list(d.values())[1]
    for k, v in r.get('key', {}).items():
        it = v['item']
        if it.startswith('minecraft:') and VD and it not in vanilla_items: err(f'recipe {p}: unknown vanilla item {it}')
        if it.startswith('shaftbreaker:') and it not in custom_items and it not in custom_blocks: err(f'recipe {p}: unknown item {it}')
for p in glob.glob(BP + '/loot_tables/**/*.json', recursive=True):
    d = load(p) or {}
    for pool in d.get('pools', []):
        for en in pool.get('entries', []):
            n = en.get('name')
            if not n: continue
            if n.startswith('minecraft:') and VD and n not in vanilla_items: err(f'loot {os.path.basename(p)}: unknown vanilla item {n}')
            if n.startswith('shaftbreaker:') and n not in custom_items and n not in custom_blocks: err(f'loot {os.path.basename(p)}: unknown {n}')

# ---------------------------------------------------------------- scripts
js = ''
for p in glob.glob(BP + '/scripts/**/*.js', recursive=True):
    js += open(p).read() + '\n'
sb = bp_entities.get('shaftbreaker:shaftbreaker', {})
props = set(sb.get('description', {}).get('properties', {}).keys()) | {'shaftbreaker:clue'}
events = set()
for _e in bp_entities.values(): events |= set(_e.get('events', {}).keys())
for m in re.findall(r"'(shaftbreaker:[a-z_]+)'", js):
    if m.startswith('shaftbreaker:') and m.count(':') == 1:
        name = m.split(':')[1]
        if m in props or m in custom_items or m in custom_blocks or m in bp_entities or m in particles: continue
        if m in ('shaftbreaker:action', 'shaftbreaker:sb', 'shaftbreaker:hanging'): continue
        if m.startswith('shaftbreaker:fog_') or m == 'shaftbreaker:the_hollows': continue   # checked in the world-generation section
        err(f'script references unknown id {m}')
for m in set(re.findall(r"`?shaftbreaker:\$\{[a-z]+\}`?", js)):
    pass
for m in set(re.findall(r"spawnParticle\('([a-z_:]+)'", js)):
    if m not in particles: err(f'script particle {m} missing')
for pid in re.findall(r"'(scratch_[a-z]+)'", js):
    if f'shaftbreaker:{pid}' not in particles: err(f'scratch particle {pid} missing')
for ev in set(re.findall(r"triggerEvent\('([a-z_:]+)'\)", js)) | {f'sb:mode_{m}' for m in re.findall(r"setMode\('([a-z_]+)'\)", js)} | {f'sb:nav_{m}' for m in re.findall(r"setNav\('([a-z_]+)'\)", js)}:
    if ev not in events: err(f'script triggers unknown entity event {ev}')
for m in set(re.findall(r"'((?:music\.)?shaftbreaker\.[a-z_]+)'", js)):
    if m not in sdefs: err(f'script sound {m} undefined')
for m in set(re.findall(r"'(random\.[a-z_]+|dig\.[a-z_]+|open\.[a-z_]+|step\.[a-z_]+|game\.player\.[a-z_]+)'", js)):
    if vanilla_sounds and m not in vanilla_sounds: err(f'vanilla sound {m} not found')
for m in set(re.findall(r"getProperty\('([a-z_:]+)'\)", js)) | set(re.findall(r"setProperty\('([a-z_:]+)'", js)):
    if m not in props: err(f'script uses unknown entity property {m}')
if VD:
    for m in set(re.findall(r"'(minecraft:[a-z0-9_]+)'", js)):
        if js.count(f"startsWith('{m}") and m + '_0' in vanilla_blocks: continue
        if m in ('minecraft:overworld', 'minecraft:player', 'minecraft:item', 'minecraft:health', 'minecraft:equippable', 'minecraft:riding', 'minecraft:rideable', 'minecraft:cardinal_direction',
                 'minecraft:movement', 'minecraft:inventory'):   # entity component ids, not blocks/items
            continue
        if m not in vanilla_blocks and m not in vanilla_items and m not in vanilla_entities: err(f'script: unknown vanilla id {m}')
    for m in set(re.findall(r"addEffect\('([a-z_]+)'", js)):
        if m not in vanilla_effects: err(f'script: unknown effect {m}')
    blocks_js = open(os.path.join(BP, 'scripts/core/blocks.js')).read()
    head = blocks_js.split('export function')[0].split('PROTECTED_HINTS')[0] + blocks_js.split('export function')[0].split('LIGHT_SOURCES')[-1]
    for m in set(re.findall(r"'([a-z0-9_]+)'", head)):
        full = 'minecraft:' + m
        if full not in vanilla_blocks and full not in vanilla_items: warn(f'blocks.js: "{m}" is not a known vanilla block id')

acts = open(os.path.join(BP, 'scripts/generated/acts.js')).read()
for m in set(re.findall(r'ACT\.([A-Z_]+)', js)):
    if f'  {m}:' not in acts: err(f'script uses unknown ACT.{m}')

# ---------------------------------------------------------------- world generation (the Hollows)
import struct as _st
vanilla_biomes = set()
if VD:
    vanilla_biomes = set(re.findall(r'"(minecraft:[a-z0-9_]+)"', open(os.path.join(VD, 'lib', 'mojang-biome.d.ts')).read()))
def block_known(n):
    n = n if ':' in n else 'minecraft:' + n
    return n in custom_blocks or not vanilla_blocks or n in vanilla_blocks or n == 'minecraft:air'
def _nbt_names(path):
    """palette block names of a .mcstructure (minimal little-endian NBT walk)"""
    names = []
    def rd(f, t):
        if t == 1: f.read(1)
        elif t == 2: f.read(2)
        elif t == 3: return _st.unpack('<i', f.read(4))[0]
        elif t == 4: f.read(8)
        elif t == 5: f.read(4)
        elif t == 6: f.read(8)
        elif t == 7: f.read(_st.unpack('<i', f.read(4))[0])
        elif t == 8: n = _st.unpack('<H', f.read(2))[0]; return f.read(n).decode()
        elif t == 9:
            et = f.read(1)[0]; n = _st.unpack('<i', f.read(4))[0]
            return [rd(f, et) for _ in range(n)]
        elif t == 10:
            d = {}
            while True:
                tt = f.read(1)[0]
                if tt == 0: return d
                k = f.read(_st.unpack('<H', f.read(2))[0]).decode(); d[k] = rd(f, tt)
        elif t == 11: f.read(4 * _st.unpack('<i', f.read(4))[0])
        else: raise ValueError(t)
    with open(path, 'rb') as f:
        f.read(1); f.read(_st.unpack('<H', f.read(2))[0])
        root = rd(f, 10)
    size = root['size']; blocks = root['structure']['block_indices'][0]
    pal = root['structure']['palette']['default']['block_palette']
    if len(blocks) != size[0] * size[1] * size[2]: err(f'{os.path.basename(path)}: index count does not match size')
    if any(b >= len(pal) for b in blocks): err(f'{os.path.basename(path)}: index beyond palette')
    return [p['name'] for p in pal]
structures = {}
for p in glob.glob(BP + '/structures/**/*.mcstructure', recursive=True):
    rel = os.path.relpath(p, BP + '/structures').replace(os.sep, '/')[:-len('.mcstructure')]
    ns, name = rel.split('/', 1)
    structures[f'{ns}:{name}'] = p
    for n in _nbt_names(p):
        if not block_known(n): err(f'structure {rel}: unknown block {n}')
biome_tags = set()
for p in glob.glob(BP + '/biomes/*.json'):
    b = (load(p) or {})['minecraft:biome']; c = b['components']
    biome_tags |= set(c.get('minecraft:tags', {}).get('tags', []))
    for r in c.get('minecraft:replace_biomes', {}).get('replacements', []):
        for t in r['targets']:
            if vanilla_biomes and t not in vanilla_biomes: err(f'biome {b["description"]["identifier"]}: unknown target biome {t}')
    sb = c.get('minecraft:surface_builder', {}).get('builder', {})
    for k in ('top_material', 'mid_material', 'foundation_material', 'sea_floor_material', 'sea_material'):
        if k in sb and not block_known(sb[k]): err(f'biome surface {k}: unknown block {sb[k]}')
    for a in c.get('minecraft:surface_material_adjustments', {}).get('adjustments', []):
        for k, v in a['materials'].items():
            if not block_known(v): err(f'biome adjustment {k}: unknown block {v}')
fog_ids = set()
for p in glob.glob(RP + '/fogs/*.json'):
    fog_ids.add((load(p) or {})['minecraft:fog_settings']['description']['identifier'])
music_defs = (load(RP + '/sounds/music_definitions.json') or {}) if os.path.exists(RP + '/sounds/music_definitions.json') else {}
for p in glob.glob(RP + '/biomes/*.json'):
    c = (load(p) or {})['minecraft:client_biome']['components']
    fid = c.get('minecraft:fog_appearance', {}).get('fog_identifier')
    if fid and fid not in fog_ids: err(f'client biome: fog {fid} missing')
    amb = c.get('minecraft:ambient_sounds', {})
    for ev in [amb.get('loop'), amb.get('mood'), (amb.get('addition') or {}).get('asset')]:
        if ev and ev.startswith('shaftbreaker.') and ev not in sdefs: err(f'client biome: ambient sound {ev} undefined')
    md = c.get('minecraft:biome_music', {}).get('music_definition')
    if md and md not in music_defs: err(f'client biome: music definition {md} missing from sounds/music_definitions.json')
    elif md and music_defs[md]['event_name'] not in sdefs: err(f'music definition {md}: event {music_defs[md]["event_name"]} undefined')
features = {}
for p in glob.glob(BP + '/features/**/*.json', recursive=True):
    d = load(p) or {}
    kind = [k for k in d if k.startswith('minecraft:')][0]
    features[d[kind]['description']['identifier']] = (kind, d[kind])
def _fblock(fid, ref):
    """a block reference in a feature: a name, or {name, states}; custom states must be declared on the block"""
    if isinstance(ref, dict):
        n, states = ref.get('name'), ref.get('states', {})
    else:
        n, states = ref, {}
    if not n: return
    if not block_known(n): err(f'feature {fid}: unknown block {n}'); return
    for k, v in states.items():
        if n in custom_blocks:
            if k not in block_states.get(n, {}): err(f'feature {fid}: block {n} has no state {k}')
            elif isinstance(block_states[n][k], list) and v not in block_states[n][k]: err(f'feature {fid}: {n} state {k} has no value {v!r}')
for fid, (kind, f) in features.items():
    if kind == 'minecraft:structure_template_feature' and f['structure_name'] not in structures: err(f'feature {fid}: structure {f["structure_name"]} missing')
    for key in ('places_feature', 'feature_to_snap'):
        if key in f and f[key] not in features: err(f'feature {fid}: {key} names unknown feature {f[key]}')
    pbs = f.get('places_block', [])
    for pb in (pbs if isinstance(pbs, list) else [pbs]):
        _fblock(fid, pb['block'] if isinstance(pb, dict) and 'block' in pb else pb)
    for rr in f.get('replace_rules', []):
        _fblock(fid, rr['places_block'])
        for m in rr.get('may_replace', []): _fblock(fid, m)
    for k in ('filler', 'inner_layer', 'alternate_inner_layer', 'middle_layer', 'outer_layer'):
        if k in f: _fblock(fid, f[k])
    for k in f.get('inner_placements', []): _fblock(fid, k)
    for side in f.get('may_attach_to', {}).values():
        for m in (side if isinstance(side, list) else []): _fblock(fid, m)
    for m in f.get('may_replace', []): _fblock(fid, m)
for p in glob.glob(BP + '/feature_rules/**/*.json', recursive=True):
    r = (load(p) or {})['minecraft:feature_rules']
    pf = r['description']['places_feature']
    if pf not in features: err(f'feature rule {r["description"]["identifier"]}: unknown feature {pf}')
    for flt in r['conditions'].get('minecraft:biome_filter', []):
        if flt.get('test') == 'has_biome_tag' and flt['value'] not in biome_tags: err(f'feature rule {r["description"]["identifier"]}: no biome has tag {flt["value"]}')
for m in set(re.findall(r"'(shaftbreaker:fog_[a-z_]+)'", js)):
    if m not in fog_ids: err(f'script uses unknown fog {m}')
biome_ids = {(load(p) or {})['minecraft:biome']['description']['identifier'] for p in glob.glob(BP + '/biomes/*.json')}
for m in set(re.findall(r"'(shaftbreaker:the_[a-z_]+)'", js)):
    if m not in biome_ids: err(f'script uses unknown biome {m}')
client_biomes = {(load(p) or {})['minecraft:client_biome']['description']['identifier'] for p in glob.glob(RP + '/biomes/*.json')}
for b in biome_ids:
    if b not in client_biomes: err(f'biome {b} has no client biome')

print(f'errors: {len(errors)}  warnings: {len(warns)}')
for e in errors: print('  ERROR', e)
for w in warns: print('  warn ', w)
sys.exit(1 if errors else 0)
