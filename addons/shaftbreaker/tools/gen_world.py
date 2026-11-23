"""The Hollows: the Shaftbreaker's own biome.

Writes the biome (huge regions painted over windswept hills, stony peaks, savannas and badlands),
its client side (dust fog, dead colours, ambience, music), the extra fogs the scripts push (near /
rage), three new blocks with textures, original .mcstructure templates (mine headframes over real
shafts, dead timber, bone piles, cairns, cart wrecks, sinkholes, clawed boulders) and the world-gen
features that scatter them on the surface and dress the caves underneath (hanging spines, bones,
dust, clawed stone, webs, the odd soul lantern somebody left behind).

All content here is original. Structure files are written as little-endian NBT in the layout
Bedrock uses (z changes fastest, then y, then x; index -1 keeps whatever was there).
"""
import os, json, struct, random
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, 'Shaftbreaker_BP')
RP = os.path.join(ROOT, 'Shaftbreaker_RP')
NS = 'shaftbreaker'
TAG = 'shaftbreaker_hollows'
BIOME = f'{NS}:the_hollows'
R = random.Random(1987)


def w(base, rel, obj):
    p = os.path.join(base, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as f:
        json.dump(obj, f, indent=2)


# =============================================================== NBT / .mcstructure
def _s(x):
    b = x.encode('utf8')
    return struct.pack('<H', len(b)) + b


def _payload(t, v):
    if t == 1: return struct.pack('<b', v)
    if t == 3: return struct.pack('<i', v)
    if t == 8: return _s(v)
    if t == 9:
        et, items = v
        return bytes([et]) + struct.pack('<i', len(items)) + b''.join(_payload(et, i) for i in items)
    if t == 10:
        return b''.join(bytes([tt]) + _s(k) + _payload(tt, vv) for k, tt, vv in v) + b'\x00'
    raise ValueError(t)


def _state_tag(v):
    if isinstance(v, bool): return 1, int(v)
    if isinstance(v, int): return 3, v
    return 8, str(v)


PALETTE_VERSION = 18184192   # block-state version used by structures that load in 1.26.x


class Structure:
    def __init__(self, sx, sy, sz):
        self.size = (sx, sy, sz)
        self.cells = {}

    def set(self, x, y, z, name, **states):
        sx, sy, sz = self.size
        if 0 <= x < sx and 0 <= y < sy and 0 <= z < sz:
            self.cells[(x, y, z)] = (name if ':' in name else 'minecraft:' + name, states)

    def get(self, x, y, z):
        return self.cells.get((x, y, z))

    def save(self, name):
        sx, sy, sz = self.size
        palette, index = [], {}
        layer = [-1] * (sx * sy * sz)
        for (x, y, z), (n, st) in self.cells.items():
            k = (n, tuple(sorted(st.items())))
            if k not in index:
                index[k] = len(palette)
                palette.append([('name', 8, n), ('states', 10, [(sk, *_state_tag(sv)) for sk, sv in sorted(st.items())]), ('version', 3, PALETTE_VERSION)])
            layer[(x * sy + y) * sz + z] = index[k]
        root = [
            ('format_version', 3, 1),
            ('size', 9, (3, list(self.size))),
            ('structure', 10, [
                ('block_indices', 9, (9, [(3, layer), (3, [-1] * len(layer))])),
                ('entities', 9, (10, [])),
                ('palette', 10, [('default', 10, [('block_palette', 9, (10, palette)), ('block_position_data', 10, [])])]),
            ]),
            ('structure_world_origin', 9, (3, [0, 0, 0])),
        ]
        p = os.path.join(BP, 'structures', NS, name + '.mcstructure')
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f:
            f.write(b'\x0a' + _s('') + _payload(10, root))
        return f'{NS}:{name}'


AIR = 'air'
LOG_DARK = 'stripped_dark_oak_log'
LOG_SPRUCE = 'stripped_spruce_log'
LOG_OLD = 'dark_oak_log'


def log(s, x, y, z, axis='y', kind=LOG_DARK):
    s.set(x, y, z, kind, pillar_axis=axis)


# =============================================================== structures (original designs)
def headframe(variant):
    """An abandoned mine headframe straddling a real shaft that drops ~20 blocks into the rock."""
    depth = 18 + variant * 3
    tall = 8 + variant
    sx = sz = 9
    s = Structure(sx, depth + tall + 2, sz)
    g = depth                                                     # ground layer index
    c = 4
    # the shaft: 3x3 of air all the way down, timber cribbing rings, a ladder that gives out halfway
    for y in range(0, g + 1):
        for x in range(c - 1, c + 2):
            for z in range(c - 1, c + 2):
                s.set(x, y, z, AIR)
        if y % 4 == 1 and y < g:
            for x in range(c - 2, c + 3):
                for z in range(c - 2, c + 3):
                    if max(abs(x - c), abs(z - c)) == 2:
                        s.set(x, y, z, LOG_SPRUCE, pillar_axis='x' if abs(z - c) == 2 else 'z')
        if y > depth * 0.45 and y < g and R.random() > 0.12:
            s.set(c, y, c - 1, 'ladder', facing_direction=3)
    for y in range(0, 3):                                         # bottom of the shaft: rubble and bones
        for x in range(c - 1, c + 2):
            for z in range(c - 1, c + 2):
                if y == 0:
                    s.set(x, y, z, R.choice(['gravel', 'gravel', 'cobblestone', 'coarse_dirt']))
                elif y == 1 and R.random() < 0.3:
                    s.set(x, y, z, 'bone_block', deprecated=0, pillar_axis=R.choice('xyz'))
                elif R.random() < 0.25:
                    s.set(x, y, z, 'web')
    # collar: rotten planks around the mouth, some missing
    for x in range(c - 3, c + 4):
        for z in range(c - 3, c + 4):
            if max(abs(x - c), abs(z - c)) >= 2 and R.random() > 0.18:
                s.set(x, g, z, R.choice(['dark_oak_planks', 'dark_oak_planks', 'spruce_planks', 'coarse_dirt']))
    # four leaning posts rising to a crown beam
    posts = [(c - 3, c - 3), (c + 3, c - 3), (c - 3, c + 3), (c + 3, c + 3)]
    for (px, pz) in posts:
        for y in range(g + 1, g + tall):
            k = (y - g) / tall
            x = round(px + (c - px) * 0.45 * k)
            z = round(pz + (c - pz) * 0.45 * k)
            log(s, x, y, z, 'y', LOG_OLD if R.random() < 0.3 else LOG_DARK)
    top = g + tall
    for x in range(c - 2, c + 3):
        log(s, x, top, c - 1, 'x'); log(s, x, top, c + 1, 'x')
    for z in range(c - 1, c + 2):
        log(s, c, top + 1, z, 'z', LOG_OLD)                        # the sheave beam
    if variant == 0:
        s.set(c, top, c, 'soul_lantern', hanging=True)          # someone's lamp, still hanging under the sheave
    else:
        s.set(c, top, c, 'web')
    for _ in range(5):                                            # webs in the frame
        x, y, z = R.randint(c - 2, c + 2), R.randint(g + 2, top - 1), R.randint(c - 2, c + 2)
        if not s.get(x, y, z):
            s.set(x, y, z, 'web')
    return s.save(f'headframe_{variant + 1}'), g


def dead_timber(variant):
    h = 5 + variant * 2
    s = Structure(7, h + 2, 7)
    c = 3
    kind = [LOG_DARK, LOG_SPRUCE, LOG_OLD][variant % 3]
    for y in range(0, h):
        log(s, c, y, c, 'y', kind)
    for i in range(2 + variant):                                  # dead branches
        y = R.randint(2, h - 1)
        dx, dz = R.choice([(1, 0), (-1, 0), (0, 1), (0, -1)])
        for k in range(1, R.randint(2, 3)):
            log(s, c + dx * k, y + (k > 1), c + dz * k, 'x' if dx else 'z', kind)
    if variant == 2:
        s.set(c, h, c, 'bone_block', deprecated=0, pillar_axis='y')
    return s.save(f'dead_timber_{variant + 1}'), 0


def bone_pile(variant):
    s = Structure(6, 3, 6)
    for x in range(6):
        for z in range(6):
            d = abs(x - 2.5) + abs(z - 2.5)
            if d < 3.2 and R.random() < 0.75:
                pick = R.choice(['bone', 'bone', 'gravel', 'dust'])
                if pick == 'bone':
                    s.set(x, 0, z, 'bone_block', deprecated=0, pillar_axis=R.choice('xyz'))
                else:
                    s.set(x, 0, z, 'gravel' if pick == 'gravel' else f'{NS}:hollow_dust')
            if d < 1.8 and R.random() < 0.5:
                s.set(x, 1, z, 'bone_block', deprecated=0, pillar_axis=R.choice('xz'))
            elif d < 2.6 and R.random() < 0.25:
                s.set(x, 1, z, 'web')
    if variant == 1:
        s.set(2, 2, 3, f'{NS}:den_spine', **{f'{NS}:hanging': False})
    return s.save(f'bone_pile_{variant + 1}'), 1


def cairn(variant):
    s = Structure(3, 4, 3)
    h = 2 + variant
    for y in range(h):
        s.set(1, y, 1, R.choice(['cobblestone', 'mossy_cobblestone', 'cobbled_deepslate']))
        if y == 0:
            for dx, dz in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                if R.random() < 0.5:
                    s.set(1 + dx, 0, 1 + dz, R.choice(['cobblestone', 'gravel']))
    s.set(1, h, 1, f'{NS}:cairn_marker', **{'minecraft:cardinal_direction': R.choice(['north', 'south', 'east', 'west'])})
    return s.save(f'cairn_{variant + 1}'), 0


def cart_wreck():
    s = Structure(9, 3, 3)
    for x in range(9):
        if R.random() > 0.25:
            s.set(x, 0, 1, 'rail', rail_direction=1)
        if R.random() < 0.3:
            s.set(x, 0, R.choice([0, 2]), R.choice(['spruce_planks', 'gravel', 'dark_oak_planks']))
    s.set(4, 0, 1, 'spruce_planks'); s.set(5, 0, 1, 'spruce_planks')
    log(s, 4, 1, 1, 'x', LOG_SPRUCE)
    s.set(6, 1, 0, 'web')
    return s.save('cart_wreck'), 1


def sinkhole():
    """a collapsed working: a funnel that drops into the dark, webs and bones at the bottom"""
    d = 9
    s = Structure(7, d + 1, 7)
    c = 3
    for y in range(0, d + 1):
        r = 1.2 + (y / d) * 2.0
        for x in range(7):
            for z in range(7):
                if (x - c) ** 2 + (z - c) ** 2 <= r * r:
                    s.set(x, y, z, AIR)
    for x in range(c - 1, c + 2):
        for z in range(c - 1, c + 2):
            s.set(x, 0, z, R.choice(['gravel', 'coarse_dirt']))
    s.set(c, 1, c, 'bone_block', deprecated=0, pillar_axis='x')
    for _ in range(4):
        s.set(R.randint(1, 5), R.randint(2, d - 1), R.randint(1, 5), 'web')
    return s.save('sinkhole'), d


def claw_rock(variant):
    s = Structure(4, 4, 4)
    for x in range(4):
        for y in range(3):
            for z in range(4):
                if (x - 1.5) ** 2 + (y * 1.3) ** 2 + (z - 1.5) ** 2 <= 4.2 + variant:
                    s.set(x, y, z, R.choice([f'{NS}:clawed_stone', f'{NS}:clawed_stone', 'tuff', 'stone', 'cobbled_deepslate']))
    return s.save(f'claw_rock_{variant + 1}'), 0


# =============================================================== the infected caves (its home)
INF = lambda n: f'{NS}:{n}'


def rib_arch(variant):
    """a tunnel of rib arches: three ribs of ribstone, the crown of one broken, roots hanging from them"""
    w_, h_ = 9 + variant * 2, 7 + variant
    s = Structure(w_, h_ + 1, 6)
    cx = (w_ - 1) / 2
    for zi, z in enumerate([0, 2, 4]):
        broken = (variant + zi) % 3 == 1
        for x in range(w_):
            t = (x - cx) / (cx + 0.5)
            y = int(round((1 - t * t) ** 0.5 * (h_ - 1)))
            if broken and abs(x - cx) < 1.2:
                continue
            for yy in range(max(0, y - (1 if abs(t) > 0.8 else 0)), y + 1):
                if R.random() > 0.18:
                    s.set(x, yy, z, INF('ribstone'))
                else:
                    s.set(x, yy, z, 'bone_block', deprecated=0, pillar_axis='y' if abs(t) > 0.6 else 'x')
            if abs(t) < 0.55 and R.random() < 0.45 and y - 1 >= 1:          # roots hang from the crown
                s.set(x, y - 1, z, INF('bloodroot_vines'), **{f'{NS}:tip': False})
                if y - 2 >= 1:
                    s.set(x, y - 2, z, INF('bloodroot_vines'), **{f'{NS}:tip': True})
    for x in range(w_):
        for z in range(6):
            if R.random() < 0.3 and not s.get(x, 0, z):
                s.set(x, 0, z, INF('bloodmoss'))
    return s.save(f'rib_arch_{variant + 1}'), 1


def skeleton(variant):
    """the remains of something that came looking for it"""
    s = Structure(6, 3, 4)
    for x in range(1, 5):                                            # ribs
        s.set(x, 1, 1, 'bone_block', deprecated=0, pillar_axis='y')
        if x % 2:
            s.set(x, 1, 2, 'bone_block', deprecated=0, pillar_axis='y')
        else:
            s.set(x, 0, 2, INF('ribstone'))
    s.set(0, 0, 1, 'bone_block', deprecated=0, pillar_axis='x')        # spine
    s.set(5, 0, 1, 'bone_block', deprecated=0, pillar_axis='x')
    for x in range(0, 6):
        if R.random() < 0.55 and not s.get(x, 0, 0):
            s.set(x, 0, 0, INF('bloodmoss'))
        if R.random() < 0.4 and not s.get(x, 0, 3):
            s.set(x, 0, 3, INF('bloodmoss'))
    if variant:
        s.set(5, 1, 2, INF('organ_core'))
    return s.save(f'skeleton_{variant + 1}'), 1


def mine_support(variant):
    """an old mine frame the infection has taken over"""
    s = Structure(5, 5, 3)
    for x in (0, 4):
        for y in range(1, 4):
            log(s, x, y, 1, 'y', LOG_DARK)
    for x in range(0, 5):
        log(s, x, 4, 1, 'x', LOG_DARK)
    for x in (1, 2, 3):
        if R.random() < 0.7:
            s.set(x, 3, 1, INF('bloodroot_vines'), **{f'{NS}:tip': False})
            if R.random() < 0.7:
                s.set(x, 2, 1, INF('bloodroot_vines'), **{f'{NS}:tip': True})
    for x in range(5):
        for z in range(3):
            if R.random() < 0.45:
                s.set(x, 0, z, INF('bloodmoss'))
    if variant:
        s.set(2, 0, 1, 'bone_block', deprecated=0, pillar_axis='z')
    return s.save(f'mine_support_{variant + 1}'), 1


def organ_mound():
    """a heap of living flesh with organ cores pushing out of it"""
    s = Structure(6, 4, 6)
    for x in range(6):
        for z in range(6):
            d = ((x - 2.5) ** 2 + (z - 2.5) ** 2) ** 0.5
            h = 2 if d < 1.6 else 1 if d < 2.8 else 0
            for y in range(h):
                s.set(x, y, z, INF('pulsing_flesh') if R.random() < 0.3 else INF('fleshstone'))
            if h == 0 and d < 3.4 and R.random() < 0.6:
                s.set(x, 0, z, INF('bloodmoss'))
    s.set(2, 2, 2, INF('cracked_organ_core'))
    s.set(3, 2, 3, INF('organ_core'))
    s.set(1, 1, 4, INF('organ_core'))
    s.set(4, 1, 1, INF('crimson_thorns'))
    return s.save('organ_mound'), 1


def watcher_nest():
    """three pods on a bed of flesh: they open when you come close, and it knows"""
    s = Structure(5, 2, 5)
    for x in range(5):
        for z in range(5):
            if (x - 2) ** 2 + (z - 2) ** 2 <= 5:
                s.set(x, 0, z, INF('fleshstone') if R.random() < 0.6 else INF('veinstone'))
    for (x, z) in [(1, 1), (3, 2), (1, 3)]:
        s.set(x, 1, z, INF('watcher_pod'), **{f'{NS}:open': False})
    s.set(3, 1, 4, INF('glowspore_cluster'))
    return s.save('watcher_nest'), 1


# =============================================================== blocks + textures
def _tile(base, var, seed, size=16):
    r = np.random.default_rng(seed)
    img = np.zeros((size, size, 4), np.uint8)
    n = r.normal(0, var, (size, size))
    blk = r.normal(0, var * 0.7, (size // 4 + 1, size // 4 + 1)).repeat(4, 0).repeat(4, 1)[:size, :size]
    for ch in range(3):
        img[..., ch] = np.clip(base[ch] + n + blk, 0, 255)
    img[..., 3] = 255
    return img


def textures():
    d = os.path.join(RP, 'textures/blocks')
    os.makedirs(d, exist_ok=True)
    t = _tile((92, 84, 76), 9, 71)                                 # hollow dust: pale grave-dirt with bone grit
    r = random.Random(4)
    for _ in range(22):
        t[r.randrange(16), r.randrange(16), :3] = (148, 140, 128)
    for _ in range(10):
        t[r.randrange(16), r.randrange(16), :3] = (52, 46, 42)
    Image.fromarray(t).save(os.path.join(d, 'sb_hollow_dust.png'))
    t = _tile((70, 60, 54), 11, 72)                                 # hollow soil
    Image.fromarray(t).save(os.path.join(d, 'sb_hollow_soil.png'))
    t = _tile((96, 94, 92), 12, 73)                                 # clawed stone: four gouges
    for k in range(4):
        x0 = 2 + k * 3 + r.randint(-1, 1)
        for y in range(2, 14):
            x = x0 + (y // 5)
            if 0 <= x < 16:
                t[y, x, :3] = (34, 30, 30)
                if x + 1 < 16:
                    t[y, x + 1, :3] = (62, 58, 56)
    Image.fromarray(t).save(os.path.join(d, 'sb_clawed_stone.png'))


def blocks():
    def full(ident, tex, secs, color, sound_loot, extra=None):
        comps = {
            'minecraft:geometry': 'minecraft:geometry.full_block',
            'minecraft:destructible_by_mining': {'seconds_to_destroy': secs},
            'minecraft:destructible_by_explosion': {'explosion_resistance': 3 if secs < 1.5 else 6},
            'minecraft:map_color': color,
            'minecraft:material_instances': {'*': {'texture': tex, 'render_method': 'opaque'}},
        }
        if sound_loot:
            comps['minecraft:loot'] = sound_loot
        if extra:
            comps.update(extra)
        w(BP, f'blocks/{ident}.json', {'format_version': '1.21.60', 'minecraft:block': {
            'description': {'identifier': f'{NS}:{ident}', 'menu_category': {'category': 'nature'}}, 'components': comps}})
    full('hollow_dust', 'sb_hollow_dust', 0.75, '#5c544c', None)
    full('hollow_soil', 'sb_hollow_soil', 0.75, '#463c36', None)
    full('clawed_stone', 'sb_clawed_stone', 2.2, '#605e5c', 'loot_tables/blocks/clawed_stone.json')
    w(BP, 'loot_tables/blocks/clawed_stone.json', {'pools': [{'rolls': 1, 'entries': [{'type': 'item', 'name': 'minecraft:cobblestone', 'weight': 1}]}]})


# =============================================================== biome
TARGETS = [
    'minecraft:extreme_hills', 'minecraft:extreme_hills_edge', 'minecraft:extreme_hills_mutated',
    'minecraft:extreme_hills_plus_trees', 'minecraft:extreme_hills_plus_trees_mutated', 'minecraft:stony_peaks',
    'minecraft:savanna', 'minecraft:savanna_plateau', 'minecraft:savanna_mutated', 'minecraft:savanna_plateau_mutated',
    'minecraft:mesa', 'minecraft:mesa_plateau', 'minecraft:mesa_plateau_stone', 'minecraft:mesa_bryce',
    'minecraft:mesa_plateau_mutated', 'minecraft:mesa_plateau_stone_mutated',
]


def biome():
    w(BP, 'biomes/the_hollows.biome.json', {
        'format_version': '1.21.110',
        'minecraft:biome': {
            'description': {'identifier': BIOME},
            'components': {
                'minecraft:climate': {'downfall': 0.0, 'snow_accumulation': [0.0, 0.0], 'temperature': 0.7},
                'minecraft:replace_biomes': {'replacements': [{
                    'dimension': 'minecraft:overworld', 'targets': TARGETS,
                    'amount': 0.7, 'noise_frequency_scale': 0.25}]},
                'minecraft:surface_builder': {'builder': {
                    'type': 'minecraft:overworld', 'sea_floor_depth': 5,
                    'sea_floor_material': 'minecraft:gravel', 'foundation_material': f'{NS}:veinstone',
                    'mid_material': f'{NS}:hollow_soil', 'top_material': f'{NS}:hollow_dust', 'sea_material': 'minecraft:water'}},
                'minecraft:surface_material_adjustments': {'adjustments': [
                    {'materials': {'top_material': 'minecraft:gravel'}, 'noise_frequency_scale': 0.08, 'noise_range': [-0.1, 0.12]},
                    {'materials': {'top_material': f'{NS}:clawed_stone', 'mid_material': 'minecraft:stone'}, 'noise_frequency_scale': 0.13, 'noise_range': [0.6, 1.0]},
                    {'materials': {'top_material': 'minecraft:coarse_dirt'}, 'noise_frequency_scale': 0.05, 'noise_range': [-0.6, -0.42]},
                ]},
                'minecraft:tags': {'tags': ['overworld', 'monster', TAG]},
            },
        },
    })
    w(RP, 'biomes/the_hollows.client_biome.json', {
        'format_version': '1.21.120',
        'minecraft:client_biome': {
            'description': {'identifier': BIOME},
            'components': {
                'minecraft:fog_appearance': {'fog_identifier': f'{NS}:fog_hollows'},
                'minecraft:water_appearance': {'surface_color': '#4a0707', 'surface_opacity': 0.97},   # its pools are blood
                'minecraft:water_identifier': {'water_identifier': 'minecraft:default_water'},
                'minecraft:ambient_sounds': {
                    'loop': 'shaftbreaker.ambient.hollows.loop',
                    'mood': 'shaftbreaker.ambient.hollows.mood',
                    'addition': {'asset': 'shaftbreaker.ambient.hollows.additions', 'chance': 0.006},
                    'underwater_loop': 'ambient.underwater.loop',
                    'underwater_addition': {'asset': 'ambient.underwater.additions', 'chance': 0.01},
                },
                'minecraft:biome_music': {'music_definition': 'shaftbreaker_hollows', 'volume_multiplier': 1.0},
                'minecraft:sky_color': {'sky_color': '#2a1a1a'},
                'minecraft:grass_appearance': {'color': '#4a3530'},
                'minecraft:foliage_appearance': {'color': '#2e2020'},
                'minecraft:precipitation': {'ash': 0.05},
            },
        },
    })


def fog(ident, start, end, color, weather_end=None, density=0.1):
    return {
        'format_version': '1.21.90',
        'minecraft:fog_settings': {
            'description': {'identifier': f'{NS}:{ident}'},
            'distance': {
                'air': {'fog_start': start, 'fog_end': end, 'fog_color': color, 'render_distance_type': 'fixed'},
                'weather': {'fog_start': 0, 'fog_end': weather_end or end * 0.8, 'fog_color': color, 'render_distance_type': 'fixed'},
                'water': {'fog_start': 0.0, 'fog_end': 14.0, 'fog_color': '#3a0505', 'render_distance_type': 'fixed'},
            },
            'volumetric': {
                'density': {'air': {'max_density': density, 'zero_density_height': 320.0, 'max_density_height': 320.0}},
                'media_coefficients': {'air': {'scattering': [0.5, 0.48, 0.45], 'absorption': [0.3, 0.32, 0.34]}},
                'henyey_greenstein_g': {'air': {'henyey_greenstein_g': 0.3}},
            },
        },
    }


def fogs():
    w(RP, 'fogs/hollows.json', fog('fog_hollows', 6, 52, '#3a2a28', density=0.1))
    w(RP, 'fogs/infected.json', fog('fog_infected', 0, 30, '#2a0909', density=0.18))   # its home, underground: red mist
    w(RP, 'fogs/near.json', fog('fog_near', 0, 24, '#100e0e', density=0.16))
    w(RP, 'fogs/rage.json', fog('fog_rage', 0, 28, '#3d0505', density=0.2))
    w(RP, 'fogs/territory.json', fog('fog_territory', 2, 38, '#1c1916', density=0.12))


# =============================================================== features
NATURAL = ['minecraft:air', 'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:fern', 'minecraft:deadbush', 'minecraft:snow_layer',
           f'{NS}:hollow_dust', f'{NS}:hollow_soil', f'{NS}:clawed_stone', 'minecraft:dirt', 'minecraft:coarse_dirt', 'minecraft:grass_block',
           'minecraft:podzol', 'minecraft:stone', 'minecraft:gravel', 'minecraft:andesite', 'minecraft:granite', 'minecraft:diorite',
           'minecraft:tuff', 'minecraft:sand', 'minecraft:red_sand', 'minecraft:clay', 'minecraft:hardened_clay', 'minecraft:sandstone',
           'minecraft:red_sandstone', 'minecraft:deepslate', 'minecraft:calcite', 'minecraft:snow',
           # what a shaft cuts through on its way down
           'minecraft:coal_ore', 'minecraft:iron_ore', 'minecraft:copper_ore', 'minecraft:gold_ore', 'minecraft:redstone_ore', 'minecraft:lapis_ore',
           'minecraft:deepslate_coal_ore', 'minecraft:deepslate_iron_ore', 'minecraft:deepslate_copper_ore', 'minecraft:deepslate_redstone_ore',
           'minecraft:water', 'minecraft:flowing_water', 'minecraft:cobblestone', 'minecraft:mossy_cobblestone', 'minecraft:dripstone_block',
           'minecraft:pointed_dripstone', 'minecraft:glow_lichen', 'minecraft:moss_block', 'minecraft:dirt_with_roots', 'minecraft:smooth_basalt',
           'minecraft:white_terracotta', 'minecraft:orange_terracotta', 'minecraft:yellow_terracotta', 'minecraft:brown_terracotta',
           'minecraft:red_terracotta', 'minecraft:light_gray_terracotta', 'minecraft:web', 'minecraft:bedrock']
ROCK = ['minecraft:stone', 'minecraft:deepslate', 'minecraft:tuff', 'minecraft:andesite', 'minecraft:diorite', 'minecraft:granite',
        'minecraft:calcite', f'{NS}:clawed_stone']


def structure_feature(fid, sname, ground, deep=False):
    cons = {'grounded': {}, 'block_intersection': {'block_allowlist': NATURAL}}
    if not deep:
        cons['unburied'] = {}
    w(BP, f'features/hollows/{fid}.json', {
        'format_version': '1.26.30',
        'minecraft:structure_template_feature': {
            'description': {'identifier': f'{NS}:{fid}'},
            'structure_name': sname, 'adjustment_radius': 4, 'facing_direction': 'random', 'rotate_around_center': True,
            'ground_level': ground, 'constraints': cons}})


def surface_rule(fid, denom, spread=8):
    w(BP, f'feature_rules/hollows/{fid}_rule.json', {
        'format_version': '1.21.60',
        'minecraft:feature_rules': {
            'description': {'identifier': f'{NS}:{fid}_rule', 'places_feature': f'{NS}:{fid}'},
            'conditions': {'placement_pass': 'first_pass', 'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': TAG}]},
            'distribution': {'iterations': 1, 'x': {'distribution': 'uniform', 'extent': [0, spread]},
                             'y': 'query.above_top_solid(variable.worldx, variable.worldz)',
                             'z': {'distribution': 'uniform', 'extent': [0, spread]},
                             'scatter_chance': {'numerator': 1, 'denominator': denom}}}})


def cave_feature(fid, block_name, states, attach, iterations, y_range, chance=None):
    w(BP, f'features/hollows/{fid}_block.json', {
        'format_version': '1.21.40',
        'minecraft:single_block_feature': {
            'description': {'identifier': f'{NS}:{fid}_block'},
            'places_block': [{'block': {'name': block_name, 'states': states} if states else block_name, 'weight': 1}],
            'enforce_placement_rules': False, 'enforce_survivability_rules': False,
            'may_attach_to': {attach: ROCK}, 'may_replace': ['minecraft:air']}})
    dist = {'iterations': iterations,
            'x': {'distribution': 'uniform', 'extent': [0, 16]},
            'y': {'distribution': 'uniform', 'extent': list(y_range)},
            'z': {'distribution': 'uniform', 'extent': [0, 16]}}
    w(BP, f'features/hollows/{fid}.json', {
        'format_version': '1.21.10',
        'minecraft:scatter_feature': {'description': {'identifier': f'{NS}:{fid}'}, 'places_feature': f'{NS}:{fid}_block', 'distribution': dist}})
    rdist = {'iterations': 1, 'x': {'distribution': 'uniform', 'extent': [0, 1]}, 'y': 0, 'z': {'distribution': 'uniform', 'extent': [0, 1]}}
    if chance:
        rdist['scatter_chance'] = {'numerator': 1, 'denominator': chance}
    w(BP, f'feature_rules/hollows/{fid}_rule.json', {
        'format_version': '1.21.60',
        'minecraft:feature_rules': {
            'description': {'identifier': f'{NS}:{fid}_rule', 'places_feature': f'{NS}:{fid}'},
            'conditions': {'placement_pass': 'after_underground_pass', 'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': TAG}]},
            'distribution': rdist}})


def ore_vein(fid, block_name, count, iterations, y_range):
    w(BP, f'features/hollows/{fid}.json', {
        'format_version': '1.13.0',
        'minecraft:ore_feature': {'description': {'identifier': f'{NS}:{fid}'}, 'count': count,
                                  'replace_rules': [{'places_block': block_name, 'may_replace': ['minecraft:stone', 'minecraft:deepslate', 'minecraft:tuff', 'minecraft:andesite']}]}})
    w(BP, f'feature_rules/hollows/{fid}_rule.json', {
        'format_version': '1.21.60',
        'minecraft:feature_rules': {
            'description': {'identifier': f'{NS}:{fid}_rule', 'places_feature': f'{NS}:{fid}'},
            'conditions': {'placement_pass': 'underground_pass', 'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': TAG}]},
            'distribution': {'iterations': iterations, 'coordinate_eval_order': 'zyx',
                             'x': {'distribution': 'uniform', 'extent': [0, 16]},
                             'y': {'distribution': 'uniform', 'extent': list(y_range)},
                             'z': {'distribution': 'uniform', 'extent': [0, 16]}}}})


def surface_scatter(fid, block_name, iterations, attach_list):
    w(BP, f'features/hollows/{fid}_block.json', {
        'format_version': '1.21.40',
        'minecraft:single_block_feature': {
            'description': {'identifier': f'{NS}:{fid}_block'},
            'places_block': [{'block': block_name, 'weight': 1}],
            'enforce_placement_rules': False, 'enforce_survivability_rules': False,
            'may_attach_to': {'bottom': attach_list}, 'may_replace': ['minecraft:air']}})
    w(BP, f'feature_rules/hollows/{fid}_rule.json', {
        'format_version': '1.21.60',
        'minecraft:feature_rules': {
            'description': {'identifier': f'{NS}:{fid}_rule', 'places_feature': f'{NS}:{fid}_block'},
            'conditions': {'placement_pass': 'first_pass', 'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': TAG}]},
            'distribution': {'iterations': iterations, 'x': {'distribution': 'uniform', 'extent': [0, 16]},
                             'y': 'query.above_top_solid(variable.worldx, variable.worldz)',
                             'z': {'distribution': 'uniform', 'extent': [0, 16]}}}})


def features():
    made = []
    for v in range(2):
        sname, g = headframe(v)
        structure_feature(f'hl_headframe_{v + 1}', sname, g, deep=True)
        surface_rule(f'hl_headframe_{v + 1}', 22, 6)
        made.append(sname)
    for v in range(3):
        sname, g = dead_timber(v)
        structure_feature(f'hl_dead_timber_{v + 1}', sname, g)
        surface_rule(f'hl_dead_timber_{v + 1}', 3, 12)
    for v in range(2):
        sname, g = bone_pile(v)
        structure_feature(f'hl_bone_pile_{v + 1}', sname, g)
        surface_rule(f'hl_bone_pile_{v + 1}', 12, 10)
        sname, g = cairn(v)
        structure_feature(f'hl_cairn_{v + 1}', sname, g)
        surface_rule(f'hl_cairn_{v + 1}', 9, 12)
        sname, g = claw_rock(v)
        structure_feature(f'hl_claw_rock_{v + 1}', sname, g)
        surface_rule(f'hl_claw_rock_{v + 1}', 6, 12)
    sname, g = cart_wreck()
    structure_feature('hl_cart_wreck', sname, g)
    surface_rule('hl_cart_wreck', 26, 6)
    sname, g = sinkhole()
    structure_feature('hl_sinkhole', sname, g, deep=True)
    surface_rule('hl_sinkhole', 18, 8)
    surface_scatter('hl_deadbush', 'minecraft:deadbush', 3, [f'{NS}:hollow_dust', 'minecraft:coarse_dirt', 'minecraft:gravel', f'{NS}:hollow_soil'])
    # under the Hollows: its caves are dressed like a lair
    cave_feature('hl_cave_spines', f'{NS}:den_spine', {f'{NS}:hanging': True}, 'top', 40, (-56, 56))
    cave_feature('hl_cave_bones', 'minecraft:bone_block', {'deprecated': 0, 'pillar_axis': 'x'}, 'bottom', 10, (-56, 56))
    cave_feature('hl_cave_dust', f'{NS}:den_dust', None, 'bottom', 26, (-56, 56))
    cave_feature('hl_cave_webs', 'minecraft:web', None, 'top', 12, (-56, 56))
    cave_feature('hl_cave_lantern', 'minecraft:soul_lantern', {'hanging': True}, 'top', 2, (-40, 40), chance=3)
    ore_vein('hl_clawed_stone', f'{NS}:clawed_stone', 14, 10, (-56, 72))
    infected_features(made)
    return made


STONES = ['minecraft:stone', 'minecraft:deepslate', 'minecraft:tuff', 'minecraft:andesite', 'minecraft:diorite', 'minecraft:granite',
          'minecraft:calcite', 'minecraft:dripstone_block']
INFECTED_ROCK = STONES + [INF('veinstone'), INF('fleshstone'), INF('cracked_veinstone'), INF('ribstone'), INF('pulsing_flesh')]


def blob(fid, block, count, iterations, y_range, replace):
    w(BP, f'features/infected/{fid}.json', {
        'format_version': '1.13.0',
        'minecraft:ore_feature': {'description': {'identifier': f'{NS}:{fid}'}, 'count': count,
                                  'replace_rules': [{'places_block': block, 'may_replace': replace}]}})
    w(BP, f'feature_rules/infected/{fid}_rule.json', {
        'format_version': '1.21.60',
        'minecraft:feature_rules': {
            'description': {'identifier': f'{NS}:{fid}_rule', 'places_feature': f'{NS}:{fid}'},
            'conditions': {'placement_pass': 'underground_pass', 'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': TAG}]},
            'distribution': {'iterations': iterations, 'coordinate_eval_order': 'zyx',
                             'x': {'distribution': 'uniform', 'extent': [0, 16]},
                             'y': {'distribution': 'uniform', 'extent': list(y_range)},
                             'z': {'distribution': 'uniform', 'extent': [0, 16]}}}})


def growth(fid, block, states, attach, iterations, y_range, chance=None, sides=False):
    """a single block grown onto a cave surface: floor (bottom), ceiling (top) or walls"""
    if sides:
        att = {'min_sides_must_attach': 1, 'north': INFECTED_ROCK, 'south': INFECTED_ROCK, 'east': INFECTED_ROCK, 'west': INFECTED_ROCK}
    else:
        att = {attach: INFECTED_ROCK + (['minecraft:grass_block', 'minecraft:dirt', 'minecraft:gravel', f'{NS}:hollow_dust'] if attach == 'bottom' else [])}
    w(BP, f'features/infected/{fid}_block.json', {
        'format_version': '1.21.40',
        'minecraft:single_block_feature': {
            'description': {'identifier': f'{NS}:{fid}_block'},
            'places_block': [{'block': {'name': block, 'states': states} if states else block, 'weight': 1}],
            'enforce_placement_rules': False, 'enforce_survivability_rules': False,
            'may_attach_to': att, 'may_replace': ['minecraft:air']}})
    w(BP, f'features/infected/{fid}.json', {
        'format_version': '1.21.10',
        'minecraft:scatter_feature': {'description': {'identifier': f'{NS}:{fid}'}, 'places_feature': f'{NS}:{fid}_block',
                                      'distribution': {'iterations': iterations,
                                                       'x': {'distribution': 'uniform', 'extent': [0, 16]},
                                                       'y': {'distribution': 'uniform', 'extent': list(y_range)},
                                                       'z': {'distribution': 'uniform', 'extent': [0, 16]}}}})
    rd = {'iterations': 1, 'x': {'distribution': 'uniform', 'extent': [0, 1]}, 'y': 0, 'z': {'distribution': 'uniform', 'extent': [0, 1]}}
    if chance:
        rd['scatter_chance'] = {'numerator': 1, 'denominator': chance}
    w(BP, f'feature_rules/infected/{fid}_rule.json', {
        'format_version': '1.21.60',
        'minecraft:feature_rules': {
            'description': {'identifier': f'{NS}:{fid}_rule', 'places_feature': f'{NS}:{fid}'},
            'conditions': {'placement_pass': 'after_underground_pass', 'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': TAG}]},
            'distribution': rd}})


def cave_structure(fid, sname, ground, denom, y_range=(-50, 40)):
    """a structure dropped onto a real cave floor (snapped down from a random height)"""
    cons = {'grounded': {}, 'block_intersection': {'block_allowlist': ['minecraft:air'] + INFECTED_ROCK + NATURAL}}
    w(BP, f'features/infected/{fid}_tpl.json', {
        'format_version': '1.26.30',
        'minecraft:structure_template_feature': {
            'description': {'identifier': f'{NS}:{fid}_tpl'},
            'structure_name': sname, 'adjustment_radius': 3, 'facing_direction': 'random', 'rotate_around_center': True,
            'ground_level': ground, 'constraints': cons}})
    w(BP, f'features/infected/{fid}.json', {
        'format_version': '1.13.0',
        'minecraft:snap_to_surface_feature': {'description': {'identifier': f'{NS}:{fid}'}, 'feature_to_snap': f'{NS}:{fid}_tpl',
                                              'vertical_search_range': 14, 'surface': 'floor'}})
    w(BP, f'feature_rules/infected/{fid}_rule.json', {
        'format_version': '1.21.60',
        'minecraft:feature_rules': {
            'description': {'identifier': f'{NS}:{fid}_rule', 'places_feature': f'{NS}:{fid}'},
            'conditions': {'placement_pass': 'after_underground_pass', 'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': TAG}]},
            'distribution': {'iterations': 1, 'x': {'distribution': 'uniform', 'extent': [0, 16]},
                             'y': {'distribution': 'uniform', 'extent': list(y_range)},
                             'z': {'distribution': 'uniform', 'extent': [0, 16]},
                             'scatter_chance': {'numerator': 1, 'denominator': denom}}}})


def infected_features(made):
    # the walls: most rock turns to veinstone, with flesh, glowing cracks, living flesh and rib seams
    blob('inf_veinstone', INF('veinstone'), 64, 26, (-62, 72), STONES)
    blob('inf_fleshstone', INF('fleshstone'), 30, 8, (-62, 56), STONES + [INF('veinstone')])
    blob('inf_cracked', INF('cracked_veinstone'), 10, 12, (-62, 60), STONES + [INF('veinstone')])
    blob('inf_pulsing', INF('pulsing_flesh'), 8, 5, (-62, 40), [INF('fleshstone'), INF('veinstone')] + STONES)
    blob('inf_ribseam', INF('ribstone'), 9, 3, (-62, 50), STONES + [INF('veinstone')])
    # organ chambers: flesh-lined pockets with organ cores and watcher pods budding inside
    w(BP, 'features/infected/inf_organ_chamber.json', {
        'format_version': '1.21.40',
        'minecraft:geode_feature': {
            'description': {'identifier': f'{NS}:inf_organ_chamber'},
            'filler': 'minecraft:air', 'inner_layer': INF('fleshstone'), 'alternate_inner_layer': INF('pulsing_flesh'),
            'middle_layer': INF('cracked_veinstone'), 'outer_layer': INF('veinstone'),
            'inner_placements': [INF('organ_core'), INF('watcher_pod'), INF('cracked_organ_core')],
            'min_outer_wall_distance': 4, 'max_outer_wall_distance': 6, 'min_distribution_points': 3, 'max_distribution_points': 5,
            'min_point_offset': 1, 'max_point_offset': 3, 'max_radius': 16, 'crack_point_offset': 2.0, 'generate_crack_chance': 0.6,
            'base_crack_size': 2.0, 'noise_multiplier': 0.05, 'use_potential_placements_chance': 0.12,
            'use_alternate_layer0_chance': 0.25, 'placements_require_layer0_alternate': False, 'invalid_blocks_threshold': 1}})
    w(BP, 'feature_rules/infected/inf_organ_chamber_rule.json', {
        'format_version': '1.21.60',
        'minecraft:feature_rules': {
            'description': {'identifier': f'{NS}:inf_organ_chamber_rule', 'places_feature': f'{NS}:inf_organ_chamber'},
            'conditions': {'placement_pass': 'underground_pass', 'minecraft:biome_filter': [{'test': 'has_biome_tag', 'operator': '==', 'value': TAG}]},
            'distribution': {'iterations': 1, 'x': {'distribution': 'uniform', 'extent': [0, 16]},
                             'y': {'distribution': 'uniform', 'extent': [-50, 20]}, 'z': {'distribution': 'uniform', 'extent': [0, 16]},
                             'scatter_chance': {'numerator': 1, 'denominator': 5}}}})
    # floors, walls and ceilings
    growth('inf_bloodmoss', INF('bloodmoss'), None, 'bottom', 46, (-62, 70))
    growth('inf_glowspore', INF('glowspore_cluster'), None, 'bottom', 7, (-62, 60))
    growth('inf_thorns', INF('crimson_thorns'), None, 'bottom', 9, (-62, 60))
    growth('inf_organ_floor', INF('organ_core'), None, 'bottom', 2, (-62, 50))
    growth('inf_pod_floor', INF('watcher_pod'), {f'{NS}:open': False}, 'bottom', 3, (-62, 55))
    growth('inf_organ_wall', INF('organ_core'), None, None, 4, (-62, 50), sides=True)
    growth('inf_pod_wall', INF('watcher_pod'), {f'{NS}:open': False}, None, 3, (-62, 55), sides=True)
    growth('inf_vines', INF('bloodroot_vines'), {f'{NS}:tip': False}, 'top', 34, (-62, 70))
    growth('inf_vines_tip', INF('bloodroot_vines'), {f'{NS}:tip': True}, 'top', 20, (-62, 70))
    growth('inf_fang', INF('dripfang'), {f'{NS}:tip': True}, 'top', 26, (-62, 70))
    # its works: rib tunnels, remains, old mine frames taken over, organ mounds, watcher nests
    for v in range(2):
        sname, g = rib_arch(v)
        cave_structure(f'inf_rib_arch_{v + 1}', sname, g, 7)
        structure_feature(f'hl_rib_arch_{v + 1}', sname, g)
        surface_rule(f'hl_rib_arch_{v + 1}', 16, 8)
        sname, g = skeleton(v)
        cave_structure(f'inf_skeleton_{v + 1}', sname, g, 5)
        sname, g = mine_support(v)
        cave_structure(f'inf_mine_support_{v + 1}', sname, g, 6)
        made.append(sname)
    sname, g = organ_mound()
    cave_structure('inf_organ_mound', sname, g, 6)
    sname, g = watcher_nest()
    cave_structure('inf_watcher_nest', sname, g, 5)
    # on the surface the infection breaks through in patches
    surface_scatter('hl_bloodmoss', INF('bloodmoss'), 2, [f'{NS}:hollow_dust', 'minecraft:gravel', 'minecraft:coarse_dirt', f'{NS}:hollow_soil'])


if __name__ == '__main__':
    textures()
    blocks()
    biome()
    fogs()
    made = features()
    print(f'the Hollows: biome, {len(made)} headframes + structures, fogs and features written')
