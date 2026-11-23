#!/usr/bin/env python3
"""Builds the animatronic entities (BP + RP) from the source models.

Inputs:  assets/source_models/FNAF_Animatronics_RP and FNAF_Animatronics_2_RP
         (geometry, textures, animations for rustgrin, mirehop, noxbriar,
         purple_rat, cat, top_hat_rat - supplied by the map owner) and
         assets/source_models/Golden_Dog_RP (the Golden Dog: written by
         tools/entities/golden_dog.py, which this script runs when it has changed).
Outputs: packs/RP: models/entity, textures/entity/fnar (+ _eyes, _mer, texture
         sets; the hollow-eyed look: _hollow (+ _mer, _height, texture set) and
         _pinprick), animations, animation_controllers, entity, render_controllers;
         packs/BP: entities.

Run:  python3 tools/entities/build_entities.py
"""
import json, os, sys, copy, math, random
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'source_models')
RP = os.path.join(ROOT, 'packs', 'RP')
BP = os.path.join(ROOT, 'packs', 'BP')
sys.path.insert(0, HERE)
from extra_anims import crawl_anim, peek_anim, look_anim  # noqa: E402
import pose_fixes  # noqa: E402
import new_anims  # noqa: E402
from rig import eye_point  # noqa: E402
from fk import Skeleton  # noqa: E402

import golden_dog  # noqa: E402

PACK_OF = {'rustgrin': 'FNAF_Animatronics_RP', 'mirehop': 'FNAF_Animatronics_RP', 'noxbriar': 'FNAF_Animatronics_RP',
           'purple_rat': 'FNAF_Animatronics_2_RP', 'cat': 'FNAF_Animatronics_2_RP', 'top_hat_rat': 'FNAF_Animatronics_2_RP',
           'golden_dog': 'Golden_Dog_RP'}
NAMES = {'rustgrin': 'Rustgrin', 'mirehop': 'Mirehop', 'noxbriar': 'Noxbriar', 'purple_rat': 'Purple Rat', 'cat': 'The Cat', 'top_hat_rat': 'The Ringmaster', 'rusted': 'Rustgrin?',
         'golden_dog': 'the Golden Dog'}

# fnar:anim enum value -> source animation name (None = generated extra)
ANIMS = {
    'idle': 'idle', 'perform': 'perform_1', 'perform2': 'perform_2', 'stand': 'idle', 'walk': 'walk', 'run': 'run',
    'scurry': 'run', 'crawl': 'crawl', 'peek': 'peek', 'jumpscare': 'jumpscare', 'slump': 'pose_2', 'pose': 'pose_1',
    # generated for every model (tools/entities/new_anims.py)
    'stoop': 'stoop', 'lean': 'lean', 'wave': 'wave', 'bow': 'bow',
}
ANIM_VALUES = list(ANIMS.keys())

# Render size: one uniform client entity scripts.scale (the models keep their exact proportions). The stage
# poses top out at 39.8-40.9 model px, so 1.18 makes every animatronic stand 2.9-3.0 blocks tall.
SCALE = 1.18
# Collision box to match.
COLLISION = {'width': 0.9, 'height': 3.0}
# Culling box of the geometry (model units are scaled with the entity: room for the ~3-block body).
VISIBLE_BOUNDS = {'width': 8, 'height': 8, 'offset': [0, 3.5, 0]}
# The crawl shrinks the model (root bone scale) to fit the 2 x 2 ducts: at most this tall and wide in game.
CRAWL_MAX = {'height': 1.85, 'width': 1.75}

# Per-model settings; anything a model does not list is the cast's default above.
#   scale       client entity scripts.scale (everything measured in blocks follows it: the solved poses, the crawl
#               fit, tools/entities/head_aim.mjs and the preview renderer read it from the client entity)
#   collision   minecraft:collision_box
#   bounds      the geometry's culling box
#   pupils      how the glowing pupils are found on the head's front faces: 'red' (the cast's red pupils), or
#               'mask' (the source pack carries <id>_pupils.png, white where the pupils are)
#   halo        colour of the soft halo around the pupils on the eyes layer (RGBA)
#   glow        (gain, lift RGB) applied to the pupil texels on the eyes layer
#   fingers     fingers per hand besides the thumb
# The Golden Dog: 44 model px with his hat, drawn at 1.27 = 3.5 blocks tall where the others stand 3; broader too.
MODELS = {
    'golden_dog': {
        'scale': 1.27, 'collision': {'width': 1.2, 'height': 3.5}, 'bounds': {'width': 9, 'height': 9, 'offset': [0, 4, 0]},
        'pupils': 'mask', 'halo': [255, 226, 170, 110], 'glow': (1.12, [12, 8, 4]), 'fingers': 4,
    },
}
DEFAULTS = {'scale': SCALE, 'collision': COLLISION, 'bounds': VISIBLE_BOUNDS, 'pupils': 'red', 'halo': [255, 40, 30, 110],
            'glow': (1.35, [40, 10, 10]), 'fingers': 3}


def setting(cid, key):
    return MODELS.get(cid, {}).get(key, DEFAULTS[key])


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1)
        f.write('\n')


def head_bones(geo):
    """The head bone and its non-ear, non-jaw, non-hat descendants (eye cubes live there)."""
    kids = {}
    for b in geo['bones']:
        kids.setdefault(b.get('parent'), []).append(b['name'])
    out, stack = [], ['head']
    while stack:
        n = stack.pop()
        out.append(n)
        for k in kids.get(n, []):
            if not any(w in k for w in ('ear', 'jaw', 'hat')):
                stack.append(k)
    return out


def north_rect(cube):
    """Texel rectangle (x0, y0, x1, y1) of a cube's north (front) face, or None."""
    uv = cube.get('uv')
    if not isinstance(uv, dict) or 'north' not in uv:
        return None
    u, v = uv['north']['uv']
    us, vs = uv['north']['uv_size']
    x0, x1 = sorted([int(math.floor(u)), int(math.ceil(u + us))])
    y0, y1 = sorted([int(math.floor(v)), int(math.ceil(v + vs))])
    return x0, y0, x1, y1


def eye_mask(geo, img, pupils=None):
    """The glowing pupil texels: on the north faces of the head's cubes, the red ones, or (pupils: a bool
    array from the source pack's <id>_pupils.png) the ones the model's author marked."""
    a = np.asarray(img.convert('RGBA')).astype(int)
    if pupils is not None:
        red = pupils & (a[..., 3] > 0)
    else:
        red = (a[..., 0] > 140) & (a[..., 1] < 90) & (a[..., 2] < 90) & (a[..., 3] > 0)
    mask = np.zeros(red.shape, bool)
    bones = {b['name']: b for b in geo['bones']}
    for bn in head_bones(geo):
        for c in bones[bn].get('cubes', []):
            r = north_rect(c)
            if r is None:
                continue
            x0, y0, x1, y1 = r
            mask[y0:y1, x0:x1] |= red[y0:y1, x0:x1]
    return mask


def make_eyes(img, mask, halo_rgba=(255, 40, 30, 110), glow=(1.35, (40, 10, 10))):
    a = np.asarray(img.convert('RGBA')).astype(float)
    h, w = mask.shape
    out = np.zeros((h, w, 4), np.uint8)
    # a soft 1-2 px halo around the pupils
    m = Image.fromarray((mask * 255).astype(np.uint8))
    halo = np.asarray(m.filter(ImageFilter.MaxFilter(3))).astype(bool) & ~mask
    out[halo] = list(halo_rgba)
    px = a[mask]
    if len(px):
        bright = np.clip(px[:, :3] * glow[0] + list(glow[1]), 0, 255)
        out[mask, :3] = bright.astype(np.uint8)
        out[mask, 3] = 255
    return Image.fromarray(out, 'RGBA')


def make_mer(img, mask, metal_boost=0, base=None):
    """Metalness / emissive / roughness. base: the MER a source pack carries for its model (<id>_mer.png: its
    metalness and roughness are kept); otherwise both are guessed from the colours."""
    if base is not None:
        mer = np.asarray(base.convert('RGB')).copy()
        mer[..., 0] = np.clip(mer[..., 0].astype(int) + metal_boost, 0, 255)
        mer[..., 1] = np.where(mask, 255, 0)
        return Image.fromarray(mer, 'RGB')
    a = np.asarray(img.convert('RGBA')).astype(float)
    rgb = a[..., :3] / 255.0
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    lum = rgb @ [0.299, 0.587, 0.114]
    mer = np.zeros(a.shape[:2] + (3,), np.uint8)
    # metalness: low-saturation light-grey bits (endoskeleton, buckles, mic) get a little
    metal = np.where((sat < 0.10) & (lum > 0.55), 90 + metal_boost, metal_boost * 0.3)
    mer[..., 0] = np.clip(metal, 0, 255)
    mer[..., 1] = np.where(mask, 255, 0)
    # roughness: fur/felt is rough, shinier plastic bits (very dark or saturated hard parts) a bit less
    rough = 215 - 40 * (lum > 0.75) - 25 * (lum < 0.08)
    mer[..., 2] = np.clip(rough, 0, 255)
    return Image.fromarray(mer, 'RGB')


def make_rusted(img):
    """Rustgrin's 'rusted' hallucination skin: corroded, orange-brown, blotchy."""
    rnd = np.random.default_rng(1991)
    a = np.asarray(img.convert('RGBA')).astype(float)
    rgb = a[..., :3]
    lum = rgb @ [0.299, 0.587, 0.114]
    rust = np.stack([lum * 1.05 + 25, lum * 0.62 + 6, lum * 0.32], -1)
    # blotches
    h, w = lum.shape
    noise = rnd.random((h // 8 + 1, w // 8 + 1))
    noise = np.kron(noise, np.ones((8, 8)))[:h, :w]
    fine = rnd.random((h, w))
    k = np.clip((noise * 0.7 + fine * 0.3) * 1.4 - 0.25, 0, 1)[..., None]
    out = rgb * (1 - k) * 0.55 + rust * k
    dark = (rnd.random((h, w)) < 0.04)[..., None]
    out = np.where(dark, out * 0.45, out)
    res = np.concatenate([np.clip(out, 0, 255), a[..., 3:]], -1).astype(np.uint8)
    return Image.fromarray(res, 'RGBA')


# ------------------------------------------------------------------ hollow eyes (fnar:hollow)
# At the scariest moments the pupils vanish. The body swaps to <tex>_hollow.png, where each eye is an empty,
# near-black socket, and the eyes layer draws <id>_pinprick.png (one small cold point deep in each socket)
# instead of the glowing pupils. All of it is derived from the base texture here, so a rebuild reproduces it.
# Every model paints its eyes the same way, on the north face of the head cube that carries the pupils: a dark
# eyeball (every channel < 40) with a pupil blob on it (red ring, red pupil, a dark centre, a white glint; the
# Ringmaster: a pale iris ring around a red-brown pupil) and a few painted white glints, framed by a lighter rim.
EYE_DARK_MAX = 40       # eyeball paint: every channel below this
GLINT_MIN = 170         # a painted glint on the eyeball: every channel above this...
GLINT_MAX_PX = 12       # ...in a speck of at most this many texels that touches the eyeball
SOCKET_EDGE = np.array([19.0, 13.0, 11.0])  # just inside the rim (where the old eye outline was, warmer)
SOCKET_DEEP = np.array([6.0, 4.0, 3.0])     # the bottom of the hole: a warm near-black, never 0,0,0
# (a texel is 1/8 of a model pixel: ~7/d screen px at d blocks in 1080p, so the fringe keeps the point from
#  dropping out down the hall; its alpha >= 128 so it also survives an alpha-tested eyes material, and the
#  fainter corners round it off where the material blends)
PINPRICK_CORE = (232, 242, 255, 255)        # one cold blue-white texel at the old pupil's centre...
PINPRICK_FRINGE = (80, 110, 190, 150)       # ...a dim cold fringe on its four sides...
PINPRICK_CORNER = (40, 60, 120, 70)         # ...and fainter still on the diagonals
HEIGHT_FLAT, HEIGHT_RECESS = 224, 40        # hollow heightmap: the body flat, the sockets sunk in a little
STEPS4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
STEPS8 = STEPS4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


def components(m, steps=STEPS4):
    """Connected components of a bool texel array: (labels, count), labels 1..count, 0 = not in m."""
    h, w = m.shape
    lab = np.zeros((h, w), int)
    n = 0
    for y, x in zip(*np.nonzero(m)):
        if lab[y, x]:
            continue
        n += 1
        lab[y, x] = n
        stack = [(y, x)]
        while stack:
            cy, cx = stack.pop()
            for dy, dx in steps:
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n
                    stack.append((ny, nx))
    return lab, n


def shift_and(m, steps):
    """Texels of m whose neighbours along every step are in m too (outside the array counts as not in m)."""
    h, w = m.shape
    p = np.pad(m, 1)
    out = m.copy()
    for dy, dx in steps:
        out &= p[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
    return out


def socket_mask(geo, img, mask):
    """The texels to empty for the hollow look, and one texel per eye for its pinprick.

    Searched on the north face of the head cube that carries the emissive pupil mask (eye_mask):
    1. pupil blobs: the 8-connected non-dark texels that hold the mask (red ring, iris, glint) plus the
       texels they enclose (the dark pupil centre);
    2. the socket: the dark eyeball paint 4-connected to a pupil blob (it stops at the lighter rim);
    3. painted white glints (small specks, every channel > GLINT_MIN) touching that eyeball, then any small
       speck the socket encloses.
    The rim, lids and brows are lighter than the eyeball paint and are not touched.
    Returns (socket bool array over the whole texture, [(x, y) pinprick texel per pupil blob]).
    """
    heads = set(head_bones(geo))
    faces = [r for b in geo['bones'] if b['name'] in heads for r in map(north_rect, b.get('cubes', [])) if r]
    x0, y0, x1, y1 = max(faces, key=lambda r: int(mask[r[1]:r[3], r[0]:r[2]].sum()))
    a = np.asarray(img.convert('RGBA')).astype(int)[y0:y1, x0:x1]
    seeds = mask[y0:y1, x0:x1]
    rgb, opaque = a[..., :3], a[..., 3] > 0
    dark = opaque & (rgb.max(-1) < EYE_DARK_MAX)
    lab, _ = components(opaque & ~dark, STEPS8)
    pupils = np.isin(lab, np.unique(lab[seeds & (lab > 0)]))
    outside, _ = components(~pupils)
    edge = np.unique(np.concatenate([outside[0], outside[-1], outside[:, 0], outside[:, -1]]))
    pupils |= (outside > 0) & ~np.isin(outside, edge)
    lab, _ = components(dark | pupils)
    sock = np.isin(lab, np.unique(lab[pupils]))
    near = sock | ~shift_and(~sock, STEPS4)
    lab, n = components(opaque & ~sock & (rgb.min(-1) > GLINT_MIN))
    for k in range(1, n + 1):
        part = lab == k
        if part.sum() <= GLINT_MAX_PX and (part & near).any():
            sock |= part
    # (and any other small speck the socket now encloses: a greyer glint next to a white one)
    lab, n = components(~sock)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    for k in range(1, n + 1):
        part = lab == k
        if k not in edge and part.sum() <= GLINT_MAX_PX:
            sock |= part
    full = np.zeros(mask.shape, bool)
    full[y0:y1, x0:x1] = sock
    lab, n = components(pupils, STEPS8)
    centres = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        centres.append((x0 + int(math.floor(xs.mean() + 0.5)), y0 + int(math.floor(ys.mean() + 0.5))))
    return full, sorted(centres)


def socket_depth(sock):
    """0 right inside each socket's rim .. 1 at its deepest texel (octagonal erosion steps, per socket)."""
    d = np.zeros(sock.shape)
    cur, k = sock.copy(), 0
    while cur.any():
        k += 1
        d[cur] = k
        cur = shift_and(cur, STEPS8 if k % 2 else STEPS4)
    t = np.zeros(sock.shape)
    lab, n = components(sock)
    for i in range(1, n + 1):
        part = lab == i
        t[part] = (d[part] - 1) / max(1.0, d[part].max() - 1)
    return t


def make_hollow(img, sock, depth):
    """The body with its eyes emptied: each socket a warm near-black, lighter just inside the rim, black deep in."""
    a = np.asarray(img.convert('RGBA')).copy()
    w = (1 - (1 - depth) ** 2)[..., None]  # the light dies right inside the rim; most of the hole is deep
    col = SOCKET_EDGE + (SOCKET_DEEP - SOCKET_EDGE) * w
    a[sock, :3] = np.round(col[sock]).astype(np.uint8)
    a[sock, 3] = 255
    return Image.fromarray(a, 'RGBA')


def make_pinprick(sock, centres):
    """The hollow eyes layer: one small cold point of light in each socket, nothing else."""
    out = np.zeros(sock.shape + (4,), np.uint8)
    for x, y in centres:
        for dx, dy in STEPS8:
            if sock[y + dy, x + dx]:
                out[y + dy, x + dx] = PINPRICK_FRINGE if (dx, dy) in STEPS4 else PINPRICK_CORNER
        out[y, x] = PINPRICK_CORE
    return Image.fromarray(out, 'RGBA')


def write_hollow(tex_dir, name, img, sock, depth, metal_boost=0, base_mer=None):
    """<name>_hollow.png and its Vibrant Visuals texture set: the body's MER without the pupils' glow, the
    sockets non-metallic and rough, and a heightmap (flat elsewhere) that sinks the sockets in a little."""
    hollow = make_hollow(img, sock, depth)
    hollow.save(os.path.join(tex_dir, f'{name}_hollow.png'))
    mer = np.asarray(make_mer(hollow, np.zeros(sock.shape, bool), metal_boost, base_mer)).copy()
    mer[sock] = [0, 0, 245]
    Image.fromarray(mer, 'RGB').save(os.path.join(tex_dir, f'{name}_hollow_mer.png'))
    height = np.full(sock.shape, float(HEIGHT_FLAT))
    height[sock] -= HEIGHT_RECESS * (0.3 + 0.7 * depth[sock])
    Image.fromarray(np.round(height).astype(np.uint8), 'L').save(os.path.join(tex_dir, f'{name}_hollow_height.png'))
    write_json(os.path.join(tex_dir, f'{name}_hollow.texture_set.json'), texture_set(f'{name}_hollow', heightmap=True))


def base_anims(anims, cid, geo):
    """The model's animations under their fnar names, plus crawl / peek / look and the pose corrections:
    everything the solved ones (stoop, lean, wave, bow) start from. Returns (animations, skeleton)."""
    out = {}
    for k, v in anims['animations'].items():
        name = k.split('.')[-1]
        out[f'animation.fnar.{cid}.{name}'] = copy.deepcopy(v)
    skel = Skeleton(geo)
    out[f'animation.fnar.{cid}.crawl'] = crawl_anim(cid, skel, scale=setting(cid, 'scale'), fit=CRAWL_MAX)
    out[f'animation.fnar.{cid}.peek'] = peek_anim(cid, skel)
    out[f'animation.fnar.{cid}.look'] = look_anim()
    # pose / hand corrections (tools/entities/pose_fixes.py)
    pose_fixes.apply(cid, out)
    return out, skel


def relaxed_hand(cid):
    fingers = setting(cid, 'fingers')
    return lambda side: pose_fixes.relaxed_fingers(side, roll=False, fingers=fingers)


def rename_anims(anims, cid, geo, eye):
    out, skel = base_anims(anims, cid, geo)
    # stoop, lean, wave, bow (tools/entities/new_anims.py)
    new_anims.apply(cid, out, skel, geo, eye, setting(cid, 'scale'), relaxed_hand(cid))
    return out


def controller(cid):
    states = {}
    for v in ANIM_VALUES:
        trans = [{o: f"variable.fnar_anim == '{o}'"} for o in ANIM_VALUES if o != v]
        states[v] = {
            'animations': [v],
            'blend_transition': 0.05 if v == 'jumpscare' else 0.25,
            'transitions': trans,
        }
    # the wave plays once (loop false); when it is over, settle into the idle stance until the value changes
    states['wave']['transitions'].append({'wave_done': 'query.all_animations_finished'})
    states['wave_done'] = {
        'animations': ['idle'],
        'blend_transition': 0.2,
        'transitions': [{o: f"variable.fnar_anim == '{o}'"} for o in ANIM_VALUES if o != 'wave'],
    }
    return {'format_version': '1.10.0', 'animation_controllers': {f'controller.animation.fnar.{cid}': {'initial_state': 'idle', 'states': states}}}


def client_entity(eid, geo_id, tex, eyes_id):
    """tex: the body texture (its _hollow twin is the hollow-eyed body); eyes_id: the model whose _eyes /
    _pinprick layers fit this geometry. The render scale is the geometry's model's."""
    anims = {v: f'animation.fnar.{geo_id}.{ANIMS[v]}' for v in ANIM_VALUES}
    anims['look'] = f'animation.fnar.{geo_id}.look'
    anims['ctrl'] = f'controller.animation.fnar.{geo_id}'
    return {
        'format_version': '1.10.0',
        'minecraft:client_entity': {
            'description': {
                'identifier': f'fnar:{eid}',
                'materials': {'default': 'entity_alphatest', 'eyes': 'creaking_eyes'},
                'textures': {
                    'default': f'textures/entity/fnar/{tex}',
                    'eyes': f'textures/entity/fnar/{eyes_id}_eyes',
                    'hollow': f'textures/entity/fnar/{tex}_hollow',
                    'pinprick': f'textures/entity/fnar/{eyes_id}_pinprick',
                },
                'geometry': {'default': f'geometry.fnar.{geo_id}'},
                'scripts': {
                    'scale': f"{setting(geo_id, 'scale')}",
                    'pre_animation': [
                        "variable.fnar_anim = query.property('fnar:anim');",
                        "variable.fnar_eyes = query.property('fnar:eyes');",
                        "variable.fnar_hidden = query.property('fnar:hidden');",
                        "variable.fnar_ly = math.lerp(variable.fnar_ly ?? 0, query.property('fnar:look_yaw'), 0.08);",
                        "variable.fnar_lp = math.lerp(variable.fnar_lp ?? 0, query.property('fnar:look_pitch'), 0.08);",
                    ],
                    'animate': ['ctrl', 'look'],
                },
                'animations': anims,
                'render_controllers': ['controller.render.fnar.body', 'controller.render.fnar.eyes'],
                'enable_attachables': False,
            }
        },
    }


def behavior_entity(eid, model=None):
    """model: whose body it has (collision box), when the entity is not named after its model."""
    return {
        'format_version': '1.26.50',
        'minecraft:entity': {
            'description': {
                'identifier': f'fnar:{eid}',
                'is_spawnable': False,
                'is_summonable': True,
                'is_experimental': False,
                'spawn_category': 'misc',
                'properties': {
                    'fnar:anim': {'type': 'enum', 'values': ANIM_VALUES, 'default': 'idle', 'client_sync': True},
                    'fnar:eyes': {'type': 'bool', 'default': False, 'client_sync': True},
                    'fnar:hidden': {'type': 'bool', 'default': False, 'client_sync': True},
                    'fnar:hollow': {'type': 'bool', 'default': False, 'client_sync': True},
                    'fnar:look_yaw': {'type': 'int', 'range': [-90, 90], 'default': 0, 'client_sync': True},
                    'fnar:look_pitch': {'type': 'int', 'range': [-45, 45], 'default': 0, 'client_sync': True},
                    'fnar:variant': {'type': 'int', 'range': [0, 3], 'default': 0, 'client_sync': True},
                },
            },
            'components': {
                'minecraft:type_family': {'family': ['fnar_animatronic', 'inanimate']},
                'minecraft:collision_box': dict(setting(model or eid, 'collision')),
                'minecraft:physics': {'has_gravity': False, 'has_collision': False},
                # (no minecraft:pushable: since 1.26.10 it no longer parses and fails the whole entity;
                #  leaving out its successors pushable_by_entity / pushable_by_block = not pushable)
                'minecraft:damage_sensor': {'triggers': [{'cause': 'all', 'deals_damage': 'no'}]},
                'minecraft:health': {'value': 100, 'max': 100},
                'minecraft:knockback_resistance': {'value': 1.0},
                'minecraft:fire_immune': {},
                'minecraft:persistent': {},
                'minecraft:nameable': {'always_show': False, 'allow_name_tag_renaming': False},
            },
            'events': {},
        },
    }


# fnar:hollow (a bool: 0 / 1 in Molang) picks the texture: the body gets its emptied sockets, the eyes layer (still
# shown only while fnar:eyes is on) its pinpricks instead of the glowing pupils.
HOLLOW = "query.property('fnar:hollow')"
RENDER = {
    'format_version': '1.10.0',
    'render_controllers': {
        'controller.render.fnar.body': {
            'arrays': {'textures': {'Array.skin': ['Texture.default', 'Texture.hollow']}},
            'geometry': 'Geometry.default',
            'materials': [{'*': 'Material.default'}],
            'textures': [f'Array.skin[{HOLLOW}]'],
            'part_visibility': [{'*': '!variable.fnar_hidden'}],
        },
        'controller.render.fnar.eyes': {
            'arrays': {'textures': {'Array.eyes': ['Texture.eyes', 'Texture.pinprick']}},
            'geometry': 'Geometry.default',
            'materials': [{'*': 'Material.eyes'}],
            'textures': [f'Array.eyes[{HOLLOW}]'],
            'ignore_lighting': True,
            'part_visibility': [{'*': False}, {'head': 'variable.fnar_eyes && !variable.fnar_hidden'}],
        },
    },
}


def texture_set(name, heightmap=False):
    layers = {'color': name, 'metalness_emissive_roughness': f'{name}_mer'}
    if heightmap:
        layers['heightmap'] = f'{name}_height'
    return {'format_version': '1.21.30', 'minecraft:texture_set': layers}


def load_model(cid):
    """One model as the build uses it: geometry (renamed, with its culling box), texture, the pupil mask and
    the eye point, the source pack's own MER if it has one, and its animations."""
    src = os.path.join(SRC, PACK_OF[cid])
    geo = json.load(open(os.path.join(src, 'models', 'entity', f'{cid}.geo.json')))
    tex_src = os.path.join(src, 'textures', 'entity')
    img = Image.open(os.path.join(tex_src, f'{cid}.png')).convert('RGBA')
    g = geo['minecraft:geometry'][0]
    g['description']['identifier'] = f'geometry.fnar.{cid}'
    # culling box: room for the scaled-up body
    bounds = setting(cid, 'bounds')
    g['description']['visible_bounds_width'] = bounds['width']
    g['description']['visible_bounds_height'] = bounds['height']
    g['description']['visible_bounds_offset'] = list(bounds['offset'])
    pupils = None
    if setting(cid, 'pupils') == 'mask':
        pupils = np.asarray(Image.open(os.path.join(tex_src, f'{cid}_pupils.png')).convert('L')) > 127
    mer_file = os.path.join(tex_src, f'{cid}_mer.png')
    base_mer = Image.open(mer_file).convert('RGB') if os.path.exists(mer_file) else None
    mask = eye_mask(g, img, pupils)
    anims = json.load(open(os.path.join(src, 'animations', f'{cid}.animation.json')))
    return {'geo': geo, 'g': g, 'img': img, 'mask': mask, 'eye': eye_point(g, mask), 'base_mer': base_mer, 'anims': anims}


def _solve(cid):
    """Worker: solves one model's stoop / lean / wave / bow into a cache of its own; returns its cache entry."""
    import tempfile
    m = load_model(cid)
    with tempfile.TemporaryDirectory() as d:
        new_anims.CACHE_FILE = os.path.join(d, 'solve_cache.json')
        rename_anims(m['anims'], cid, m['geo'], m['eye'])
        with open(new_anims.CACHE_FILE) as f:
            return cid, json.load(f)[cid]


def presolve(models):
    """The solved animations take minutes per model: models that miss the cache are solved side by side."""
    missing = []
    for cid, m in models.items():
        out, _ = base_anims(m['anims'], cid, m['geo'])
        if not new_anims.cached(cid, out, m['geo'], m['eye'], setting(cid, 'scale')):
            missing.append(cid)
    if len(missing) < 2:
        return
    import multiprocessing
    print(f'solving stoop / lean / wave / bow for {", ".join(missing)} (in parallel: this takes a few minutes)', flush=True)
    with multiprocessing.Pool(min(len(missing), max(1, (os.cpu_count() or 2)))) as pool:
        # each result goes into the cache as it arrives, so an interrupted build keeps what it has solved
        for cid, entry in pool.imap_unordered(_solve, missing, chunksize=1):
            cache = new_anims._load_cache()
            cache[cid] = entry
            new_anims._save_cache(cache)
            print(f'   {cid}: solved', flush=True)


def main():
    tex_dir = os.path.join(RP, 'textures', 'entity', 'fnar')
    os.makedirs(tex_dir, exist_ok=True)
    golden_dog.ensure()                 # his source pack is written by code: rewrite it if the code has changed
    models = {cid: load_model(cid) for cid in PACK_OF}
    presolve(models)
    for cid, m in models.items():
        geo, g, img, mask, eye, base_mer, anims = (m[k] for k in ('geo', 'g', 'img', 'mask', 'eye', 'base_mer', 'anims'))
        write_json(os.path.join(RP, 'models', 'entity', f'fnar_{cid}.geo.json'), geo)
        img.save(os.path.join(tex_dir, f'{cid}.png'))
        make_eyes(img, mask, setting(cid, 'halo'), setting(cid, 'glow')).save(os.path.join(tex_dir, f'{cid}_eyes.png'))
        make_mer(img, mask, base=base_mer).save(os.path.join(tex_dir, f'{cid}_mer.png'))
        write_json(os.path.join(tex_dir, f'{cid}.texture_set.json'), texture_set(cid))
        sock, centres = socket_mask(g, img, mask)
        depth = socket_depth(sock)
        write_hollow(tex_dir, cid, img, sock, depth, base_mer=base_mer)
        make_pinprick(sock, centres).save(os.path.join(tex_dir, f'{cid}_pinprick.png'))
        write_json(os.path.join(RP, 'animations', f'fnar_{cid}.animation.json'), {'format_version': anims.get('format_version', '1.8.0'), 'animations': rename_anims(anims, cid, geo, eye)})
        write_json(os.path.join(RP, 'animation_controllers', f'fnar_{cid}.animation_controllers.json'), controller(cid))
        write_json(os.path.join(RP, 'entity', f'fnar_{cid}.entity.json'), client_entity(cid, cid, cid, cid))
        write_json(os.path.join(BP, 'entities', f'{cid}.json'), behavior_entity(cid))
        print(f'{cid}: eye pixels {int(mask.sum())}, hollow socket pixels {int(sock.sum())}, pinpricks at {centres}')
        if cid == 'rustgrin':
            rusted = make_rusted(img)
            rusted.save(os.path.join(tex_dir, 'rustgrin_rusted.png'))
            make_mer(rusted, mask, metal_boost=60).save(os.path.join(tex_dir, 'rustgrin_rusted_mer.png'))
            write_json(os.path.join(tex_dir, 'rustgrin_rusted.texture_set.json'), texture_set('rustgrin_rusted'))
            write_hollow(tex_dir, 'rustgrin_rusted', rusted, sock, depth, metal_boost=60)
            write_json(os.path.join(RP, 'entity', 'fnar_rusted.entity.json'), client_entity('rusted', 'rustgrin', 'rustgrin_rusted', 'rustgrin'))
            write_json(os.path.join(BP, 'entities', 'rusted.json'), behavior_entity('rusted', 'rustgrin'))
    write_json(os.path.join(RP, 'render_controllers', 'fnar.render_controllers.json'), RENDER)
    print('entities built')


if __name__ == '__main__':
    main()
