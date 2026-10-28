#!/usr/bin/env python3
"""Generates the camera UI: map art (from the layout data), the live-camera
highlight overlays, the CCTV frame + REC overlay, and the JSON UI files
ui/hud_screen.json (non-interactive map + frame while the monitor is up) and
ui/server_form.json (the clickable camera map form).

The camera order and labels come from packs/BP/scripts/data/cameras.js and the
rooms from layout.js (read through node so the data has one source).

Run: python3 tools/ui/gen_ui.py
"""
import json, os, subprocess
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RP = os.path.join(ROOT, 'packs', 'RP')
OUT = os.path.join(RP, 'textures', 'ui', 'fnar')
os.makedirs(OUT, exist_ok=True)

data = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', '''
const root = process.argv[1];
const L = await import(root + '/packs/BP/scripts/data/layout.js');
const C = await import(root + '/packs/BP/scripts/data/cameras.js');
console.log(JSON.stringify({ rooms: L.ROOMS, ducts: L.DUCTS, office: L.OFFICE, cams: C.CAMERAS }));
''', ROOT]).decode())

# ---------------------------------------------------------------- map geometry
S = 5                     # pixels per block
X0, Z0, X1, Z1 = -2, -2, 82, 73
MARGIN = 10
W = (X1 - X0) * S + 2 * MARGIN
H = (Z1 - Z0) * S + 2 * MARGIN
def px(x, z):
    return (MARGIN + (x - X0) * S, MARGIN + (z - Z0) * S)

BOX = (8.5, 5.0)          # camera box size in blocks
CAM_POS = {               # camera box centres (blocks) on the map
    '1A': (38, 5.5), '1B': (50, 25), '1C': (9, 33), '2A': (30, 44), '2B': (28, 64), '3': (20, 49),
    '4A': (44, 44), '4B': (45, 64), '5': (7, 7), '6': (71, 7.5), '7': (71, 20), '8': (7, 21),
    '9': (31, 54), '10': (41, 54),
}
cams = data['cams']
assert set(CAM_POS) == {c['id'] for c in cams}, 'CAM_POS must cover every camera'

BG = (18, 20, 22, 205)
LINE = (215, 222, 214, 255)
DIM = (120, 128, 120, 255)
BOXC = (64, 70, 66, 255)
TEXT = (235, 240, 232, 255)
LIVE = (96, 196, 92, 255)
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
font = ImageFont.truetype(font_path, 15)
font_small = ImageFont.truetype(font_path, 11)

def rounded_bg(d):
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=10, fill=BG, outline=(70, 76, 72, 255), width=2)

def draw_rooms(d):
    for r in data['rooms']:
        x1, z1, x2, z2 = r['box']
        a = px(x1, z1)
        b = px(x2 + 1, z2 + 1)
        fill = (40, 44, 42, 255) if r['id'] not in ('OFFICE',) else (60, 58, 40, 255)
        d.rectangle([a[0], a[1], b[0] - 1, b[1] - 1], fill=fill, outline=LINE, width=2)
    # ducts as dashed lines
    for duct in data['ducts'].values():
        for (x1, y1, z1, x2, y2, z2) in duct['boxes']:
            cx1, cz1 = (x1 + x2 + 1) / 2, (z1 + z2 + 1) / 2
            if x2 - x1 > z2 - z1:
                a, b = px(x1, cz1), px(x2 + 1, cz1)
            else:
                a, b = px(cx1, z1), px(cx1, z2 + 1)
            n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) // 8)
            for i in range(n):
                if i % 2:
                    continue
                t0, t1 = i / n, min(1, (i + 1) / n)
                d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0), (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)], fill=DIM, width=2)
    # office marker
    ox, oz = px(36.5, 66)
    d.text((ox, oz), 'YOU', font=font, fill=(255, 230, 120, 255), anchor='mm')

def cam_rect(cid):
    cx, cz = CAM_POS[cid]
    a = px(cx - BOX[0] / 2, cz - BOX[1] / 2)
    b = px(cx + BOX[0] / 2, cz + BOX[1] / 2)
    return [round(a[0]), round(a[1]), round(b[0]), round(b[1])]

def draw_cam(d, cid, fill, text):
    r = cam_rect(cid)
    d.rectangle(r, fill=fill, outline=LINE, width=2)
    d.text(((r[0] + r[2]) / 2, (r[1] + r[3]) / 2), f'CAM {cid}', font=font_small if len(cid) > 1 else font_small, fill=text, anchor='mm')

base = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(base)
rounded_bg(d)
draw_rooms(d)
for c in cams:
    draw_cam(d, c['id'], BOXC, TEXT)
base.save(os.path.join(OUT, 'cam_map.png'))
for i, c in enumerate(cams):
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw_cam(ImageDraw.Draw(ov), c['id'], LIVE, (12, 24, 10, 255))
    ov.save(os.path.join(OUT, f'cam_live_{i:02d}.png'))

# ---------------------------------------------------------------- CCTV frame + REC
FW, FH = 320, 180
frame = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
fd = ImageDraw.Draw(frame)
for y in range(0, FH, 2):  # faint scanlines
    fd.line([(0, y), (FW, y)], fill=(0, 0, 0, 34))
# vignette
import math
vg = Image.new('L', (FW, FH), 0)
vp = vg.load()
for y in range(FH):
    for x in range(FW):
        dx, dy = (x - FW / 2) / (FW / 2), (y - FH / 2) / (FH / 2)
        r = math.sqrt(dx * dx * 0.9 + dy * dy * 1.1)
        vp[x, y] = int(max(0, min(255, (r - 0.62) * 300)))
black = Image.new('RGBA', (FW, FH), (0, 0, 0, 255))
frame = Image.composite(black, frame, vg)
fd = ImageDraw.Draw(frame)
L_ = 22
for (x, y, sx, sy) in [(10, 10, 1, 1), (FW - 11, 10, -1, 1), (10, FH - 11, 1, -1), (FW - 11, FH - 11, -1, -1)]:
    fd.line([(x, y), (x + sx * L_, y)], fill=(230, 230, 230, 200), width=2)
    fd.line([(x, y), (x, y + sy * L_)], fill=(230, 230, 230, 200), width=2)
frame.save(os.path.join(OUT, 'cam_frame.png'))
rec = Image.new('RGBA', (64, 20), (0, 0, 0, 0))
rd = ImageDraw.Draw(rec)
rd.ellipse([2, 4, 14, 16], fill=(230, 30, 30, 255))
rd.text((19, 10), 'REC', font=ImageFont.truetype(font_path, 13), fill=(240, 240, 240, 255), anchor='lm')
rec.save(os.path.join(OUT, 'rec.png'))

# ---------------------------------------------------------------- JSON UI
MAP_ON = '§k§r§k§r§l'
FORM_MARK = '§k§r§k§r§m'
HUD_W, HUD_H = 140, round(140 * H / W, 2)
FORM_W, FORM_H = 190, round(190 * H / W, 2)

def blink(prefix):
    return {
        f'{prefix}_blink_out': {'anim_type': 'alpha', 'easing': 'linear', 'duration': 0.45, 'from': 1.0, 'to': 0.35, 'next': f'@hud.{prefix}_blink_in'},
        f'{prefix}_blink_in': {'anim_type': 'alpha', 'easing': 'linear', 'duration': 0.45, 'from': 0.35, 'to': 1.0, 'next': f'@hud.{prefix}_blink_out'},
    }

def title_visible(expr):
    return [{'binding_name': '#hud_title_text_string', 'binding_type': 'global'}, {'binding_type': 'view', 'source_property_name': expr, 'target_property_name': '#visible'}]

on_expr = f"(not ((#hud_title_text_string - '{MAP_ON}') = #hud_title_text_string))"
hud_map_controls = [{'fnar_cam_map_base': {'type': 'image', 'texture': 'textures/ui/fnar/cam_map', 'size': ['100%', '100%'], 'layer': 1}}]
for i, c in enumerate(cams):
    code = f'{i:02d}'
    hud_map_controls.append({f'fnar_cam_live_{code}': {
        'type': 'image', 'texture': f'textures/ui/fnar/cam_live_{code}', 'size': ['100%', '100%'], 'layer': 2,
        'anims': ['@hud.fnar_cam_blink_out'],
        'bindings': title_visible(f"(#hud_title_text_string = '{MAP_ON}§{code[0]}§{code[1]}')"),
    }})
hud = {
    'namespace': 'hud',
    'root_panel': {'modifications': [{'array_name': 'controls', 'operation': 'insert_back', 'value': [{'fnar_cam_hud@hud.fnar_cam_hud': {}}]}]},
    'fnar_cam_hud': {
        'type': 'panel', 'size': ['100%', '100%'], 'layer': 1,
        'bindings': title_visible(on_expr),
        'controls': [
            {'fnar_cam_frame': {'type': 'image', 'texture': 'textures/ui/fnar/cam_frame', 'size': ['100%', '100%'], 'layer': 1, 'alpha': 0.95}},
            {'fnar_cam_rec': {'type': 'image', 'texture': 'textures/ui/fnar/rec', 'size': [48, 15], 'anchor_from': 'top_left', 'anchor_to': 'top_left', 'offset': [14, 12], 'layer': 3, 'anims': ['@hud.fnar_rec_blink_out']}},
            {'fnar_cam_map': {'type': 'panel', 'size': [HUD_W, HUD_H], 'anchor_from': 'bottom_right', 'anchor_to': 'bottom_right', 'offset': [-4, -4], 'layer': 5, 'controls': hud_map_controls}},
        ],
    },
    **blink('fnar_cam'),
    'fnar_rec_blink_out': {'anim_type': 'alpha', 'easing': 'linear', 'duration': 0.6, 'from': 1.0, 'to': 0.0, 'next': '@hud.fnar_rec_blink_in'},
    'fnar_rec_blink_in': {'anim_type': 'alpha', 'easing': 'linear', 'duration': 0.6, 'from': 0.0, 'to': 1.0, 'next': '@hud.fnar_rec_blink_out'},
}

def scale_rect(r):
    sx, sy = FORM_W / W, FORM_H / H
    return [round(r[0] * sx, 2), round(r[1] * sy, 2), round((r[2] - r[0]) * sx, 2), round((r[3] - r[1]) * sy, 2)]

form_buttons = []
for i, c in enumerate(cams):
    x, y, w, h = scale_rect(cam_rect(c['id']))
    form_buttons.append({f"fnar_cam_button_{i:02d}@server_form.fnar_cam_button": {'collection_index': i, 'size': [w, h], 'offset': [x, y]}})
form_buttons.append({'fnar_cam_button_lower@server_form.fnar_cam_button': {'collection_index': len(cams), 'size': [40, 12], 'offset': [FORM_W - 40, -14]}})
form_buttons.append({'fnar_cam_button_show@server_form.fnar_cam_button': {'collection_index': len(cams) + 1, 'size': [72, 12], 'offset': [FORM_W - 116, -14]}})
not_mark = f"((#title_text - '{FORM_MARK}') = #title_text)"
form = {
    'namespace': 'server_form',
    'main_screen_content': {'size': ['100%', '100%']},
    'long_form': {
        'type': 'panel', 'size': ['100%', '100%'],
        'controls': [
            {'fnar_default_long_form@common_dialogs.main_panel_no_buttons': {
                '$title_panel': 'common_dialogs.standard_title_label', '$title_size': ['100% - 15px', 10], '$title_max_size': ['100% - 15px', 10],
                'size': [225, 200], '$text_name': '#title_text', '$title_text_binding_type': 'none', '$child_control': 'server_form.long_form_panel', 'layer': 2,
                'bindings': [{'binding_name': '#title_text'}, {'binding_type': 'view', 'source_property_name': not_mark, 'target_property_name': '#visible'}],
            }},
            {'fnar_cam_form@server_form.fnar_cam_form': {
                'bindings': [{'binding_name': '#title_text'}, {'binding_type': 'view', 'source_property_name': f'(not {not_mark})', 'target_property_name': '#visible'}],
            }},
        ],
    },
    'fnar_cam_form': {
        'type': 'panel', 'size': ['100%', '100%'],
        'controls': [{'fnar_cam_form_map': {
            'type': 'panel', 'size': [FORM_W, FORM_H], 'anchor_from': 'bottom_right', 'anchor_to': 'bottom_right', 'offset': [-3, -3], 'layer': 10,
            'collection_name': 'form_buttons',
            'controls': [
                {'fnar_cam_form_map_image': {'type': 'image', 'texture': 'textures/ui/fnar/cam_map', 'size': ['100%', '100%'], 'layer': 1}},
                {'fnar_cam_form_live': {'type': 'label', 'text': '#form_text', 'color': [1, 1, 1], 'shadow': True, 'layer': 3, 'anchor_from': 'top_left', 'anchor_to': 'bottom_left', 'offset': [2, -3], 'size': ['default', 10]}},
                *form_buttons,
            ],
        }}],
    },
    'fnar_cam_button@common_buttons.light_text_button': {
        '$pressed_button_name': 'button.form_button_click', 'anchor_from': 'top_left', 'anchor_to': 'top_left', 'layer': 4,
        '$button_text': '#form_button_text', '$button_text_binding_type': 'collection', '$button_text_grid_collection_name': 'form_buttons',
        '$button_text_max_size': ['100%', '100%'],
        'bindings': [{'binding_type': 'collection_details', 'binding_collection_name': 'form_buttons'}],
    },
}

os.makedirs(os.path.join(RP, 'ui'), exist_ok=True)
json.dump(hud, open(os.path.join(RP, 'ui', 'hud_screen.json'), 'w'), indent=1, ensure_ascii=False)
json.dump(form, open(os.path.join(RP, 'ui', 'server_form.json'), 'w'), indent=1, ensure_ascii=False)
print(f'map {W}x{H}, {len(cams)} cameras, hud map {HUD_W}x{HUD_H}, form map {FORM_W}x{FORM_H}')
