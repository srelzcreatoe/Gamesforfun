#!/usr/bin/env python3
"""Builds the animatronic entities (BP + RP) from the supplied models.

Inputs:  assets/source_models/FNAF_Animatronics_RP and FNAF_Animatronics_2_RP
         (geometry, textures, animations for rustgrin, mirehop, noxbriar,
         purple_rat, cat, top_hat_rat - supplied by the map owner).
Outputs: packs/RP: models/entity, textures/entity/fnar (+ _eyes, _mer, texture
         sets), animations, animation_controllers, entity, render_controllers;
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

PACK_OF = {'rustgrin': 'FNAF_Animatronics_RP', 'mirehop': 'FNAF_Animatronics_RP', 'noxbriar': 'FNAF_Animatronics_RP',
           'purple_rat': 'FNAF_Animatronics_2_RP', 'cat': 'FNAF_Animatronics_2_RP', 'top_hat_rat': 'FNAF_Animatronics_2_RP'}
NAMES = {'rustgrin': 'Rustgrin', 'mirehop': 'Mirehop', 'noxbriar': 'Noxbriar', 'purple_rat': 'Purple Rat', 'cat': 'The Cat', 'top_hat_rat': 'The Ringmaster', 'rusted': 'Rustgrin?'}

# fnar:anim enum value -> source animation name (None = generated extra)
ANIMS = {
    'idle': 'idle', 'perform': 'perform_1', 'perform2': 'perform_2', 'stand': 'idle', 'walk': 'walk', 'run': 'run',
    'scurry': 'run', 'crawl': 'crawl', 'peek': 'peek', 'jumpscare': 'jumpscare', 'slump': 'pose_2', 'pose': 'pose_1',
}
ANIM_VALUES = list(ANIMS.keys())


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


def eye_mask(geo, img):
    a = np.asarray(img.convert('RGBA')).astype(int)
    red = (a[..., 0] > 140) & (a[..., 1] < 90) & (a[..., 2] < 90) & (a[..., 3] > 0)
    mask = np.zeros(red.shape, bool)
    bones = {b['name']: b for b in geo['bones']}
    for bn in head_bones(geo):
        for c in bones[bn].get('cubes', []):
            uv = c.get('uv')
            if not isinstance(uv, dict) or 'north' not in uv:
                continue
            u, v = uv['north']['uv']
            us, vs = uv['north']['uv_size']
            x0, x1 = sorted([int(math.floor(u)), int(math.ceil(u + us))])
            y0, y1 = sorted([int(math.floor(v)), int(math.ceil(v + vs))])
            mask[y0:y1, x0:x1] |= red[y0:y1, x0:x1]
    return mask


def make_eyes(img, mask):
    a = np.asarray(img.convert('RGBA')).astype(float)
    h, w = mask.shape
    out = np.zeros((h, w, 4), np.uint8)
    # a soft 1-2 px halo around the pupils
    m = Image.fromarray((mask * 255).astype(np.uint8))
    halo = np.asarray(m.filter(ImageFilter.MaxFilter(3))).astype(bool) & ~mask
    out[halo] = [255, 40, 30, 110]
    px = a[mask]
    if len(px):
        bright = np.clip(px[:, :3] * 1.35 + [40, 10, 10], 0, 255)
        out[mask, :3] = bright.astype(np.uint8)
        out[mask, 3] = 255
    return Image.fromarray(out, 'RGBA')


def make_mer(img, mask, metal_boost=0):
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


def rename_anims(anims, cid):
    out = {}
    for k, v in anims['animations'].items():
        name = k.split('.')[-1]
        out[f'animation.fnar.{cid}.{name}'] = v
    out[f'animation.fnar.{cid}.crawl'] = crawl_anim()
    out[f'animation.fnar.{cid}.peek'] = peek_anim()
    out[f'animation.fnar.{cid}.look'] = look_anim()
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
    return {'format_version': '1.10.0', 'animation_controllers': {f'controller.animation.fnar.{cid}': {'initial_state': 'idle', 'states': states}}}


def client_entity(eid, geo_id, tex, eyes_tex):
    anims = {v: f'animation.fnar.{geo_id}.{ANIMS[v]}' for v in ANIM_VALUES}
    anims['look'] = f'animation.fnar.{geo_id}.look'
    anims['ctrl'] = f'controller.animation.fnar.{geo_id}'
    return {
        'format_version': '1.10.0',
        'minecraft:client_entity': {
            'description': {
                'identifier': f'fnar:{eid}',
                'materials': {'default': 'entity_alphatest', 'eyes': 'creaking_eyes'},
                'textures': {'default': f'textures/entity/fnar/{tex}', 'eyes': f'textures/entity/fnar/{eyes_tex}'},
                'geometry': {'default': f'geometry.fnar.{geo_id}'},
                'scripts': {
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


def behavior_entity(eid):
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
                    'fnar:look_yaw': {'type': 'int', 'range': [-90, 90], 'default': 0, 'client_sync': True},
                    'fnar:look_pitch': {'type': 'int', 'range': [-45, 45], 'default': 0, 'client_sync': True},
                    'fnar:variant': {'type': 'int', 'range': [0, 3], 'default': 0, 'client_sync': True},
                },
            },
            'components': {
                'minecraft:type_family': {'family': ['fnar_animatronic', 'inanimate']},
                'minecraft:collision_box': {'width': 0.7, 'height': 2.6},
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


RENDER = {
    'format_version': '1.10.0',
    'render_controllers': {
        'controller.render.fnar.body': {
            'geometry': 'Geometry.default',
            'materials': [{'*': 'Material.default'}],
            'textures': ['Texture.default'],
            'part_visibility': [{'*': '!variable.fnar_hidden'}],
        },
        'controller.render.fnar.eyes': {
            'geometry': 'Geometry.default',
            'materials': [{'*': 'Material.eyes'}],
            'textures': ['Texture.eyes'],
            'ignore_lighting': True,
            'part_visibility': [{'*': False}, {'head': 'variable.fnar_eyes && !variable.fnar_hidden'}],
        },
    },
}


def texture_set(name):
    return {'format_version': '1.21.30', 'minecraft:texture_set': {'color': name, 'metalness_emissive_roughness': f'{name}_mer'}}


def main():
    tex_dir = os.path.join(RP, 'textures', 'entity', 'fnar')
    os.makedirs(tex_dir, exist_ok=True)
    for cid, pk in PACK_OF.items():
        src = os.path.join(SRC, pk)
        geo = json.load(open(os.path.join(src, 'models', 'entity', f'{cid}.geo.json')))
        g = geo['minecraft:geometry'][0]
        g['description']['identifier'] = f'geometry.fnar.{cid}'
        g['description']['visible_bounds_width'] = 4
        g['description']['visible_bounds_height'] = 4
        write_json(os.path.join(RP, 'models', 'entity', f'fnar_{cid}.geo.json'), geo)
        img = Image.open(os.path.join(src, 'textures', 'entity', f'{cid}.png')).convert('RGBA')
        img.save(os.path.join(tex_dir, f'{cid}.png'))
        mask = eye_mask(g, img)
        make_eyes(img, mask).save(os.path.join(tex_dir, f'{cid}_eyes.png'))
        make_mer(img, mask).save(os.path.join(tex_dir, f'{cid}_mer.png'))
        write_json(os.path.join(tex_dir, f'{cid}.texture_set.json'), texture_set(cid))
        anims = json.load(open(os.path.join(src, 'animations', f'{cid}.animation.json')))
        write_json(os.path.join(RP, 'animations', f'fnar_{cid}.animation.json'), {'format_version': anims.get('format_version', '1.8.0'), 'animations': rename_anims(anims, cid)})
        write_json(os.path.join(RP, 'animation_controllers', f'fnar_{cid}.animation_controllers.json'), controller(cid))
        write_json(os.path.join(RP, 'entity', f'fnar_{cid}.entity.json'), client_entity(cid, cid, cid, f'{cid}_eyes'))
        write_json(os.path.join(BP, 'entities', f'{cid}.json'), behavior_entity(cid))
        print(f'{cid}: eye pixels {int(mask.sum())}')
        if cid == 'rustgrin':
            rusted = make_rusted(img)
            rusted.save(os.path.join(tex_dir, 'rustgrin_rusted.png'))
            make_mer(rusted, mask, metal_boost=60).save(os.path.join(tex_dir, 'rustgrin_rusted_mer.png'))
            write_json(os.path.join(tex_dir, 'rustgrin_rusted.texture_set.json'), texture_set('rustgrin_rusted'))
            write_json(os.path.join(RP, 'entity', 'fnar_rusted.entity.json'), client_entity('rusted', 'rustgrin', 'rustgrin_rusted', 'rustgrin_eyes'))
            write_json(os.path.join(BP, 'entities', 'rusted.json'), behavior_entity('rusted'))
    write_json(os.path.join(RP, 'render_controllers', 'fnar.render_controllers.json'), RENDER)
    print('entities built')


if __name__ == '__main__':
    main()
