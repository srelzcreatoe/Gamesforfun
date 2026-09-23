"""Static validation of the Grinshackle add-on build tree. Exit code 1 on any failure."""
import json, os, re, sys, struct, zlib
BUILD = sys.argv[1] if len(sys.argv) > 1 else 'build'
BP, RP = os.path.join(BUILD, 'Grinshackle_BP'), os.path.join(BUILD, 'Grinshackle_RP')
fails, warns, oks = [], [], []
def ok(m): oks.append(m)
def fail(m): fails.append(m)
def warn(m): warns.append(m)
def load(p):
    try: return json.load(open(p))
    except Exception as e: fail(f'JSON parse {p}: {e}'); return None
def png_size(p):
    with open(p,'rb') as f:
        h=f.read(24)
        if h[:8]!=b'\x89PNG\r\n\x1a\n': return None
        return struct.unpack('>II', h[16:24])
# --- every JSON parses
for root in (BP, RP):
    for dp, dn, fn in os.walk(root):
        for f in fn:
            if f.endswith('.json'): load(os.path.join(dp, f))
ok('all JSON files parsed')
# --- manifests
bm, rm = load(f'{BP}/manifest.json'), load(f'{RP}/manifest.json')
if bm and rm:
    assert_uuid = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    ids = [bm['header']['uuid'], rm['header']['uuid']] + [m['uuid'] for m in bm['modules']] + [m['uuid'] for m in rm['modules']]
    if len(set(ids)) != len(ids): fail('duplicate manifest UUIDs')
    for u in ids:
        if not assert_uuid.match(u): fail('bad uuid ' + u)
    dep = [d for d in bm['dependencies'] if 'uuid' in d]
    if not dep or dep[0]['uuid'] != rm['header']['uuid'] or dep[0]['version'] != rm['header']['version']: fail('BP does not depend on RP uuid/version')
    mods = {d['module_name']: d['version'] for d in bm['dependencies'] if 'module_name' in d}
    if mods.get('@minecraft/server') != '2.0.0' or mods.get('@minecraft/server-ui') != '2.0.0': fail(f'script module deps not pinned to stable 2.0.0: {mods}')
    else: ok('manifests: stable @minecraft/server 2.0.0 + server-ui 2.0.0, RP dependency resolves')
    sm = [m for m in bm['modules'] if m['type'] == 'script'][0]
    if not os.path.exists(f'{BP}/{sm["entry"]}'): fail('script entry missing')
    if bm['header']['version'] != [2,0,0] or rm['header']['version'] != [2,0,0]: warn('pack versions are not 2.0.0')
# --- entity (BP)
ent = load(f'{BP}/entities/grinshackle.json')
client = load(f'{RP}/entity/grinshackle.entity.json')
ctrl = load(f'{RP}/animation_controllers/grinshackle.controllers.json')
anim = load(f'{RP}/animations/grinshackle_chainreaver.animation.json')
ovl = load(f'{RP}/animations/grinshackle_overlays.animation.json')
geo = load(f'{RP}/models/entity/grinshackle_chainreaver.geo.json')
render = load(f'{RP}/render_controllers/grinshackle.render.json')
sounds = load(f'{RP}/sounds/sound_definitions.json')
if ent:
    E = ent['minecraft:entity']
    if E['description'].get('is_experimental'): fail('entity marked experimental')
    groups = set(E['component_groups'].keys())
    for name, ev in E['events'].items():
        for key in ('add', 'remove'):
            for g in ev.get(key, {}).get('component_groups', []):
                if g not in groups: fail(f'event {name} references unknown group {g}')
    comps = E['components']
    for bad in ('minecraft:attack', 'minecraft:behavior.melee_attack', 'minecraft:behavior.melee_box_attack', 'minecraft:behavior.ranged_attack'):
        if bad in comps or any(bad in g for g in E['component_groups'].values()): fail(f'native damage component present: {bad}')
    ok('entity: events resolve, no native melee damage component')
    props = E['description']['properties']
    for p in ('gs:pose', 'gs:action', 'gs:overlay', 'gs:track'):
        if p not in props or not props[p].get('client_sync'): fail(f'property {p} missing or not client_sync')
    poses = set(props['gs:pose']['values'])
    loot = comps.get('minecraft:loot', {}).get('table')
    if loot and not os.path.exists(f'{BP}/{loot}'): fail('loot table missing ' + loot)
if client and anim and ovl and ctrl and geo:
    desc = client['minecraft:client_entity']['description']
    all_anims = {**anim['animations'], **ovl['animations']}
    all_ctrls = ctrl['animation_controllers']
    short = {}
    for k, v in desc['animations'].items():
        if v.startswith('animation.'):
            if v not in all_anims: fail(f'client animation {k} -> {v} not found')
            short[k] = 'anim'
        elif v.startswith('controller.'):
            if v not in all_ctrls: fail(f'client controller {k} -> {v} not found')
            short[k] = 'ctrl'
        else: fail('unknown animation ref ' + v)
    for a in desc['scripts']['animate']:
        key = a if isinstance(a, str) else list(a.keys())[0]
        if key not in desc['animations']: fail(f'animate entry {key} not declared')
    # every one of the 21 supplied clips must be referenced by a controller state
    used = set()
    for cname, c in all_ctrls.items():
        for sname, st in c['states'].items():
            for a in st.get('animations', []):
                key = a if isinstance(a, str) else list(a.keys())[0]
                if key not in desc['animations']: fail(f'controller {cname}/{sname} uses undeclared animation {key}')
                used.add(key)
            for tr in st.get('transitions', []):
                tgt = list(tr.keys())[0]
                if tgt not in c['states']: fail(f'controller {cname}/{sname} transition to unknown state {tgt}')
    supplied = [k.split('.')[-1] for k in anim['animations']]
    missing = [s for s in supplied if s not in used]
    if missing: fail('supplied clips not used by any controller state: ' + ', '.join(missing))
    else: ok(f'all {len(supplied)} supplied clips are reachable from controller states')
    # pose enum <-> pose controller states
    if ent:
        pstates = {k for k in all_ctrls['controller.animation.gs.pose']['states'].keys() if not k.endswith('_still')}
        if pstates != poses: fail(f'pose enum {sorted(poses)} != pose controller states {sorted(pstates)}')
        else: ok('gs:pose enum matches pose controller states')
        arange = props['gs:action']['range']
        astates = all_ctrls['controller.animation.gs.action']['states']
        if len(astates) - 1 != arange[1]: fail('action controller states do not match gs:action range')
    # geometry + bones
    g = geo['minecraft:geometry'][0]
    if g['description']['identifier'] != desc['geometry']['default']: fail('geometry id mismatch')
    bones = {b['name'] for b in g['bones']}
    for an, a in all_anims.items():
        for b in a.get('bones', {}):
            if b not in bones: fail(f'{an} animates unknown bone {b}')
    ok(f'geometry {g["description"]["identifier"]}: {len(bones)} bones, all animated bones exist')
    if g['description']['texture_width'] != 64 or g['description']['texture_height'] != 64: fail('geometry texture size not 64x64')
    tex = f'{RP}/{desc["textures"]["default"]}.png'
    if not os.path.exists(tex): fail('texture missing ' + tex)
    else:
        sz = png_size(tex)
        if sz != (64, 64): fail(f'texture is {sz}, expected 64x64')
        else: ok('entity texture is 64x64')
    for rc in desc['render_controllers']:
        if rc not in render['render_controllers']: fail('render controller missing ' + rc)
# --- other client entities
for f in ('waypoint', 'legacy_chainreaver'):
    c = load(f'{RP}/entity/{f}.entity.json')
    if c:
        d = c['minecraft:client_entity']['description']
        if not os.path.exists(f'{RP}/{d["textures"]["default"]}.png'): fail(f'{f}: texture missing')
        gid = d['geometry']['default']; gg = load(f'{RP}/models/entity/gs_blank.geo.json')
        if gg and gg['minecraft:geometry'][0]['description']['identifier'] != gid: fail(f'{f}: geometry {gid} missing')
# --- sounds
if sounds:
    for sid, sd in sounds['sound_definitions'].items():
        for s in sd['sounds']:
            p = f'{RP}/{s["name"]}.ogg'
            if not os.path.exists(p): fail(f'sound {sid} -> {p} missing')
            elif open(p, 'rb').read(4) != b'OggS': fail(f'{p} is not an Ogg file')
        if sd.get('category') not in ('ambient','block','hostile','music','neutral','player','record','ui','weather'): fail(f'sound {sid} bad category')
    ok(f'{len(sounds["sound_definitions"])} sound definitions resolve to Ogg files')
    # every SOUNDS constant used by scripts must exist
    consts = open(f'{BP}/scripts/constants.js').read()
    for m in re.findall(r"'(gs\.[a-z_.]+)'", consts):
        if m not in sounds['sound_definitions'] and not m.startswith('gs.step.'): fail(f'script sound id {m} not defined')
# --- particles
pdir = f'{RP}/particles'
pids = {}
if os.path.isdir(pdir):
    for f in os.listdir(pdir):
        p = load(f'{pdir}/{f}')
        if not p: continue
        d = p['particle_effect']['description']
        pids[d['identifier']] = f
        tex = d['basic_render_parameters'].get('texture')
        if tex and not os.path.exists(f'{RP}/{tex}.png'): fail(f'particle {d["identifier"]} texture missing {tex}')
consts = open(f'{BP}/scripts/constants.js').read()
pblock = consts.split('export const PARTICLES')[1].split('});')[0]
for m in re.findall(r"'(gs:[a-z_]+)'", pblock):
    if m not in pids: fail(f'script particle {m} not defined')
ok(f'{len(pids)} particle effects resolve textures')
# --- items / recipes / loot / item textures
it = load(f'{RP}/textures/item_texture.json')
icons = set(it['texture_data'].keys()) if it else set()
for f in os.listdir(f'{BP}/items'):
    j = load(f'{BP}/items/{f}')
    if not j: continue
    c = j['minecraft:item']['components']
    icon = c['minecraft:icon']; icon = icon['textures']['default'] if isinstance(icon, dict) else icon
    if icon not in icons: fail(f'item {f} icon {icon} not in item_texture.json')
    elif not os.path.exists(f'{RP}/{it["texture_data"][icon]["textures"]}.png'): fail(f'icon png missing for {icon}')
lang = open(f'{RP}/texts/en_US.lang').read()
for f in os.listdir(f'{BP}/items'):
    j = load(f'{BP}/items/{f}'); idn = j['minecraft:item']['description']['identifier']
    if f'item.{idn}.name=' not in lang: fail(f'lang missing item.{idn}.name')
ok('items: icons and lang entries resolve')
item_ids = {load(f'{BP}/items/{f}')['minecraft:item']['description']['identifier'] for f in os.listdir(f'{BP}/items')}
for f in os.listdir(f'{BP}/recipes'):
    j = load(f'{BP}/recipes/{f}'); r = j.get('minecraft:recipe_shaped') or j.get('minecraft:recipe_shapeless')
    res = r['result']['item']
    if res.startswith('gs:') and res not in item_ids: fail(f'recipe {f} result {res} unknown')
    ings = [v['item'] for v in r.get('key', {}).values()] + [v['item'] for v in r.get('ingredients', [])]
    for i in ings:
        if i.startswith('gs:') and i not in item_ids: fail(f'recipe {f} ingredient {i} unknown')
    if 'unlock' not in r: warn(f'recipe {f} has no unlock')
lt = load(f'{BP}/loot_tables/entities/grinshackle.json')
for pool in lt['pools']:
    for e in pool['entries']:
        if e['type'] == 'item' and e['name'].startswith('gs:') and e['name'] not in item_ids: fail('loot item unknown ' + e['name'])
ok('recipes and loot reference known items')
# --- functions
for f in os.listdir(f'{BP}/functions/grinshackle'):
    t = open(f'{BP}/functions/grinshackle/{f}').read().strip()
    if not t.startswith('scriptevent gs:control '): fail('function ' + f + ' malformed')
ok('functions map to scriptevent gs:control')
# --- scripts: imports resolve
sc = f'{BP}/scripts'
files = {f for f in os.listdir(sc) if f.endswith('.js')}
for f in files:
    src = open(f'{sc}/{f}').read()
    for m in re.findall(r"from '\./([a-z_]+\.js)'", src):
        if m not in files: fail(f'{f} imports missing module {m}')
    for m in re.findall(r"from '(@minecraft/[a-z-]+)'", src):
        if m not in ('@minecraft/server', '@minecraft/server-ui'): fail(f'{f} imports non-stable module {m}')
ok(f'{len(files)} script modules, all relative imports resolve')
# --- report
print('\n'.join('OK   ' + m for m in oks))
print('\n'.join('WARN ' + m for m in warns))
print('\n'.join('FAIL ' + m for m in fails))
print(f'\n{len(oks)} ok, {len(warns)} warnings, {len(fails)} failures')
sys.exit(1 if fails else 0)
