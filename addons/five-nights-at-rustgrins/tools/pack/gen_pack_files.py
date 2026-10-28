#!/usr/bin/env python3
"""Writes the pack-level files: manifests, items + item icons, fogs, the
language file (entity / item / block names), pack icons and the item-texture
fragment. Run after the block agents' work so every block gets a name.

Run: python3 tools/pack/gen_pack_files.py
"""
import json, os, glob
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BP = os.path.join(ROOT, 'packs', 'BP')
RP = os.path.join(ROOT, 'packs', 'RP')
VERSION = [1, 0, 2]
ENGINE = [1, 26, 50]
UUID = {
    'bp_header': '02b67251-1ef0-43ba-8b73-411d54a1b730',
    'bp_data': '205a6fbd-72d6-4382-9bb9-abc2ec4f9948',
    'bp_script': '41b33f8b-b5be-40fb-b9f9-e0e81275309b',
    'rp_header': 'f29ca45a-51c9-4089-a965-2e8edb89568f',
    'rp_res': '20e930e1-ff15-423d-914e-b5f4f22013fe',
}
TITLE = "Five Nights at Rustgrin's"
META = {'authors': ["Five Nights at Rustgrin's project"], 'license': 'Original work; animatronic models supplied by the map owner. Not affiliated with Scott Cawthon or Mojang.'}


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write('\n')


def manifests():
    write_json(os.path.join(BP, 'manifest.json'), {
        'format_version': 2,
        'header': {'name': f'{TITLE} (Behavior)', 'description': 'An original FNAF-style night-guard horror map: six animatronics, security cameras, doors, vents and a show that must go on. Requires the matching resource pack.', 'uuid': UUID['bp_header'], 'version': VERSION, 'min_engine_version': ENGINE},
        'modules': [
            {'description': 'Entities, blocks, items', 'type': 'data', 'uuid': UUID['bp_data'], 'version': VERSION},
            {'description': 'Night simulation, cameras, map builder, UI', 'type': 'script', 'language': 'javascript', 'entry': 'scripts/main.js', 'uuid': UUID['bp_script'], 'version': VERSION},
        ],
        'dependencies': [
            {'uuid': UUID['rp_header'], 'version': VERSION},
            {'module_name': '@minecraft/server', 'version': '2.10.0'},
            {'module_name': '@minecraft/server-ui', 'version': '2.2.0'},
        ],
        'metadata': META,
    })
    write_json(os.path.join(RP, 'manifest.json'), {
        'format_version': 2,
        'header': {'name': f'{TITLE} (Resources)', 'description': 'Animatronics, the pizzeria blocks (vanilla-style, Vibrant Visuals ready), sounds, camera UI.', 'uuid': UUID['rp_header'], 'version': VERSION, 'min_engine_version': ENGINE},
        'modules': [{'description': 'Resources', 'type': 'resources', 'uuid': UUID['rp_res'], 'version': VERSION}],
        'capabilities': ['pbr'],
        'metadata': META,
    })


ITEMS = {
    'tablet': ('Camera Tablet', 'Cameras'),
    'remote': ('Office Remote', 'Remote'),
    'guide': ('Shift Guide', 'Read'),
}


def item_icon(kind):
    """16x16 vanilla-style item icons drawn pixel by pixel."""
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if kind == 'tablet':
        d.rectangle([1, 3, 14, 13], fill=(58, 56, 52, 255))
        d.rectangle([1, 3, 14, 3], fill=(92, 90, 84, 255))
        d.rectangle([1, 13, 14, 13], fill=(34, 33, 30, 255))
        d.rectangle([3, 5, 11, 11], fill=(34, 60, 44, 255))
        for (x, y) in [(4, 6), (6, 8), (8, 6), (9, 9), (5, 10), (10, 7)]:
            d.point((x, y), fill=(92, 150, 104, 255))
        d.point((13, 5), fill=(220, 40, 40, 255))
        d.point((13, 8), fill=(120, 120, 112, 255))
        d.point((13, 10), fill=(120, 120, 112, 255))
    elif kind == 'remote':
        d.rectangle([5, 1, 10, 14], fill=(46, 46, 50, 255))
        d.rectangle([5, 1, 10, 1], fill=(84, 84, 90, 255))
        d.rectangle([5, 14, 10, 14], fill=(28, 28, 30, 255))
        for (x, y, c) in [(6, 3, (200, 40, 40)), (9, 3, (200, 40, 40)), (6, 5, (225, 225, 210)), (9, 5, (225, 225, 210)), (6, 8, (90, 140, 210)), (9, 8, (90, 140, 210)), (7, 11, (220, 170, 40)), (8, 11, (220, 170, 40))]:
            d.point((x, y), fill=c + (255,))
            d.point((x + 0, y + 1), fill=tuple(int(v * 0.6) for v in c) + (255,))
    else:  # guide
        d.rectangle([2, 2, 13, 14], fill=(110, 30, 34, 255))
        d.rectangle([2, 2, 3, 14], fill=(74, 18, 22, 255))
        d.rectangle([4, 3, 12, 13], fill=(220, 210, 180, 255))
        for y in (5, 7, 9, 11):
            d.line([(5, y), (11, y)], fill=(120, 110, 96, 255))
        d.point((8, 4), fill=(200, 40, 40, 255))
    return im


def items():
    tex_dir = os.path.join(RP, 'textures', 'items', 'fnar')
    os.makedirs(tex_dir, exist_ok=True)
    frag = {}
    for k, (name, button) in ITEMS.items():
        item_icon(k).save(os.path.join(tex_dir, f'{k}.png'))
        frag[f'fnar_{k}'] = {'textures': f'textures/items/fnar/{k}'}
        write_json(os.path.join(BP, 'items', f'{k}.json'), {
            'format_version': '1.26.30',
            'minecraft:item': {
                'description': {'identifier': f'fnar:{k}', 'menu_category': {'category': 'items'}},
                'components': {
                    'minecraft:icon': {'textures': {'default': f'fnar_{k}'}},
                    'minecraft:display_name': {'value': f'item.fnar:{k}.name'},
                    'minecraft:max_stack_size': 1,
                    'minecraft:interact_button': button,
                    'minecraft:cooldown': {'category': 'fnar_tools', 'duration': 0.25},
                    'minecraft:hand_equipped': False,
                },
            },
        })
    write_json(os.path.join(ROOT, 'tools', 'fragments', 'item_texture_items.json'), frag)


def fog(ident, start, end, color, density, scatter=0.0):
    vol = {'density': {'air': {'max_density': density, 'uniform': True}, 'weather': {'max_density': density, 'uniform': True}}}
    if scatter:
        vol['media_coefficients'] = {'air': {'scattering': [scatter] * 3, 'absorption': [scatter * 0.25] * 3}}
    return {
        'format_version': '1.21.90',
        'minecraft:fog_settings': {
            'description': {'identifier': ident},
            'distance': {
                'air': {'fog_start': start, 'fog_end': end, 'fog_color': color, 'render_distance_type': 'fixed'},
                'weather': {'fog_start': start, 'fog_end': end, 'fog_color': color, 'render_distance_type': 'fixed'},
            },
            'volumetric': vol,
        },
    }


def fogs():
    write_json(os.path.join(RP, 'fogs', 'fnar_night.json'), fog('fnar:night', 4, 40, '#060509', 0.05, 0.03))
    write_json(os.path.join(RP, 'fogs', 'fnar_camera_feed.json'), fog('fnar:camera_feed', 18, 90, '#0e1612', 0.02, 0.02))
    write_json(os.path.join(RP, 'fogs', 'fnar_power_out.json'), fog('fnar:power_out', 0, 7, '#000000', 0.12))


def title(s):
    return ' '.join(w.capitalize() for w in s.replace('_', ' ').split())


def lang():
    lines = [f'## {TITLE}', '']
    names = {'rustgrin': 'Rustgrin', 'mirehop': 'Mirehop', 'noxbriar': 'Noxbriar', 'purple_rat': 'Purple Rat', 'cat': 'The Cat', 'top_hat_rat': 'The Ringmaster', 'rusted': 'Rustgrin?'}
    for k, v in names.items():
        lines.append(f'entity.fnar:{k}.name={v}')
    for k, (name, _) in ITEMS.items():
        lines.append(f'item.fnar:{k}.name={name}')
    for f in sorted(glob.glob(os.path.join(BP, 'blocks', '*.json'))):
        try:
            ident = json.load(open(f))['minecraft:block']['description']['identifier']
        except Exception:
            continue
        lines.append(f'tile.{ident}.name={title(ident.split(":")[1])}')
    lines.append(f'pack.name={TITLE}')
    os.makedirs(os.path.join(RP, 'texts'), exist_ok=True)
    with open(os.path.join(RP, 'texts', 'en_US.lang'), 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
    write_json(os.path.join(RP, 'texts', 'languages.json'), ['en_US'])


SOUND_RULES = [
    ('cloth', ('carpet_party', 'curtain_', 'tent_stripe', 'plush_rat', 'party_hat', 'bunting', 'balloons', 'poster_', 'drawing', 'desk_clutter', 'plate_set', 'sign_out_of_order')),
    ('wood', ('stage_floor', 'party_table', 'pizza_box', 'sign_staff', 'stage_star')),
    ('metal', ('duct_metal', 'door_shutter', 'vent_cover', 'locker', 'trash_can', 'security_camera', 'pa_speaker', 'time_clock', 'crt_monitor', 'desk_fan', 'desk_phone',
               'show_tape', 'arcade_cabinet', 'stage_speaker', 'guitar_amp', 'door_button', 'light_button', 'ceiling_lamp', 'exit_sign', 'stage_spotlight', 'hanging_lamp',
               'wall_sconce', 'mop_bucket', 'wet_floor_sign', 'parts_shelf', 'party_chair', 'sign_revue', 'sign_cabaret', 'sign_midway')),
]


def block_sounds():
    out = {'format_version': [1, 1, 0]}
    for f in sorted(glob.glob(os.path.join(BP, 'blocks', '*.json'))):
        ident = json.load(open(f))['minecraft:block']['description']['identifier']
        name = ident.split(':')[1]
        sound = 'stone'
        for snd, keys in SOUND_RULES:
            if any(name.startswith(k) for k in keys):
                sound = snd
                break
        out[ident] = {'sound': sound}
    write_json(os.path.join(RP, 'blocks.json'), out)


def pack_icons():
    head = os.path.join(ROOT, 'assets', 'portraits', 'rustgrin_head.png')
    size = 256
    icon = Image.new('RGBA', (size, size), (10, 9, 12, 255))
    d = ImageDraw.Draw(icon)
    for y in range(size):  # dark red glow from the bottom
        a = int(max(0, (y - size * 0.35) / (size * 0.65)) * 90)
        d.line([(0, y), (size, y)], fill=(90, 12, 14, a))
    if os.path.exists(head):
        h = Image.open(head).convert('RGBA')
        bbox = h.getbbox()
        if bbox:
            h = h.crop(bbox)
        scale = 200 / max(h.size)
        h = h.resize((int(h.width * scale), int(h.height * scale)), Image.LANCZOS)
        # crunch it into chunky pixels so it reads as Minecraft
        small = h.resize((max(1, h.width // 4), max(1, h.height // 4)), Image.NEAREST)
        h = small.resize((small.width * 4, small.height * 4), Image.NEAREST)
        icon.alpha_composite(h, ((size - h.width) // 2, 8))
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
    d = ImageDraw.Draw(icon)
    d.rectangle([0, size - 54, size, size], fill=(0, 0, 0, 200))
    d.text((size // 2, size - 27), "RUSTGRIN'S", font=font, fill=(235, 200, 120, 255), anchor='mm')
    icon.save(os.path.join(BP, 'pack_icon.png'))
    icon.save(os.path.join(RP, 'pack_icon.png'))


def version_module():
    """The scripts show the pack version in chat on join (so a player can tell which build runs)."""
    path = os.path.join(BP, 'scripts', 'data', 'version.js')
    with open(path, 'w') as f:
        f.write('// Generated by tools/pack/gen_pack_files.py from the manifest version.\n')
        f.write(f"export const VERSION = '{'.'.join(map(str, VERSION))}';\n")


def main():
    manifests()
    version_module()
    items()
    fogs()
    lang()
    block_sounds()
    pack_icons()
    print('pack files written')


if __name__ == '__main__':
    main()
