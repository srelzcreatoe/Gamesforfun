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
S = 8                     # pixels per block (the map is drawn large, then shown at ~150 UI units)
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
font = ImageFont.truetype(font_path, 24)
font_cam = ImageFont.truetype(font_path, 27)   # camera numbers: readable even on the small corner map

def rounded_bg(d):
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=16, fill=BG, outline=(70, 76, 72, 255), width=3)

def draw_rooms(d):
    for r in data['rooms']:
        x1, z1, x2, z2 = r['box']
        a = px(x1, z1)
        b = px(x2 + 1, z2 + 1)
        fill = (40, 44, 42, 255) if r['id'] not in ('OFFICE',) else (60, 58, 40, 255)
        d.rectangle([a[0], a[1], b[0] - 1, b[1] - 1], fill=fill, outline=LINE, width=3)
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
                d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0), (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)], fill=DIM, width=3)
    # office marker
    ox, oz = px(36.5, 66)
    d.text((ox, oz), 'YOU', font=font, fill=(255, 230, 120, 255), anchor='mm')

def cam_rect(cid):
    cx, cz = CAM_POS[cid]
    a = px(cx - BOX[0] / 2, cz - BOX[1] / 2)
    b = px(cx + BOX[0] / 2, cz + BOX[1] / 2)
    return [round(a[0]), round(a[1]), round(b[0]), round(b[1])]

def draw_cam(d, cid, fill, text, outline=(10, 12, 11, 255)):
    r = cam_rect(cid)
    d.rectangle(r, fill=fill, outline=LINE, width=3)
    d.text(((r[0] + r[2]) / 2, (r[1] + r[3]) / 2 + 1), cid, font=font_cam, fill=text, anchor='mm', stroke_width=3, stroke_fill=outline)

base = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(base)
rounded_bg(d)
draw_rooms(d)
for c in cams:
    draw_cam(d, c['id'], BOXC, TEXT)
base.save(os.path.join(OUT, 'cam_map.png'))
for i, c in enumerate(cams):
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw_cam(ImageDraw.Draw(ov), c['id'], LIVE, (255, 255, 255, 255), outline=(16, 60, 14, 255))
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

# ---------------------------------------------------------------- the camera-feed look (overlays while the monitor is up)
# The game has no post-processing, so the CCTV look is layered on the HUD: a green
# night-vision tint, animated grain, scanlines, a slow rolling interference band, and the
# vignette + corner frame above. Deterministic (fixed seed).
import random
rng = random.Random(1991)
Image.new('RGBA', (4, 4), (255, 255, 255, 255)).save(os.path.join(OUT, 'px_white.png'))
scan = Image.new('RGBA', (8, 3), (0, 0, 0, 0))
for x in range(8):
    scan.putpixel((x, 2), (0, 0, 0, 70))
    scan.putpixel((x, 1), (0, 0, 0, 18))
scan.save(os.path.join(OUT, 'cam_fx_scan.png'))
NOISE_W, NOISE_H, NOISE_FRAMES = 320, 180, 6
noise = Image.new('RGBA', (NOISE_W, NOISE_H * NOISE_FRAMES), (0, 0, 0, 0))
np_ = noise.load()
for f in range(NOISE_FRAMES):
    for y in range(NOISE_H):
        for x in range(NOISE_W):
            r = rng.random()
            if r < 0.22:      # bright grain
                v = rng.randint(170, 255)
                np_[x, f * NOISE_H + y] = (v, v, v, rng.randint(20, 60))
            elif r < 0.40:    # dark grain
                np_[x, f * NOISE_H + y] = (0, 0, 0, rng.randint(20, 55))
    # a couple of thin horizontal glitch lines per frame
    for _ in range(rng.randint(1, 3)):
        y = rng.randrange(NOISE_H)
        x0 = rng.randrange(NOISE_W // 2)
        for x in range(x0, min(NOISE_W, x0 + rng.randint(40, 180))):
            np_[x, f * NOISE_H + y] = (220, 255, 225, 60)
noise.save(os.path.join(OUT, 'cam_fx_noise.png'))
roll = Image.new('RGBA', (4, 64), (0, 0, 0, 0))
for y in range(64):
    a = int(34 * math.sin(math.pi * y / 63) ** 2)
    for x in range(4):
        roll.putpixel((x, y), (210, 255, 220, a))
roll.save(os.path.join(OUT, 'cam_fx_roll.png'))

# ---------------------------------------------------------------- JSON UI
# Title codes (formatting codes only, so nothing shows): the scripts set the HUD title to
# MAP_ON + camera code while the monitor is up, FX_ON with the map switched off, JS_ON during
# a jumpscare. The clickable map form's title is FORM_MARK + camera code + action code.
MAP_ON = '§k§r§k§r§l'
FX_ON = '§k§r§k§r§n'      # the camera-feed look without the map (Settings: camera map off)
JS_ON = '§k§r§k§r§o'      # a jumpscare is playing: nothing on screen but the animatronic
FORM_MARK = '§k§r§k§r§m'
ACTIONS = {'w': 'PLAY SHOW', 's': 'SPOTLIGHT', 'x': 'PLAY SHOW', 'p': 'WARN GUARD'}  # form action codes (x = nothing to do here, p = co-op operator)
HUD_W, HUD_H = 112, round(112 * H / W, 2)
# The clickable map is a little larger so every camera stays a comfortable button (about 15 x 9 units).
FORM_W, FORM_H = 150, round(150 * H / W, 2)

def cam_code(i):
    s2 = f'{i:02d}'
    return f'§{s2[0]}§{s2[1]}'

def contains(binding, text):
    return f"(not (({binding} - '{text}') = {binding}))"

def img(texture, **kw):
    # keep_ratio false: overlays stretch to the whole screen (a square texture would otherwise stay square)
    return {'type': 'image', 'texture': texture, 'size': ['100%', '100%'], 'keep_ratio': False, **kw}

def fx_controls(ns):
    """The camera-feed look: green tint, animated grain, scanlines, a rolling band, the vignette frame and REC."""
    return [
        {'fnar_cam_tint': img('textures/ui/fnar/px_white', layer=1, color=[0.32, 0.95, 0.48], alpha=0.15)},
        {'fnar_cam_noise': img('textures/ui/fnar/cam_fx_noise', layer=2, alpha=0.4, uv_size=[NOISE_W, NOISE_H], uv=f'@{ns}.fnar_cam_noise_anim', disable_anim_fast_forward=True)},
        {'fnar_cam_scan': img('textures/ui/fnar/cam_fx_scan', layer=3, tiled=True)},
        {'fnar_cam_roll': img('textures/ui/fnar/cam_fx_roll', layer=3, size=['100%', 70], anchor_from='top_left', anchor_to='top_left', anims=[f'@{ns}.fnar_cam_roll_anim'])},
        {'fnar_cam_frame': img('textures/ui/fnar/cam_frame', layer=4, alpha=0.95)},
        {'fnar_cam_rec': {'type': 'image', 'texture': 'textures/ui/fnar/rec', 'size': [48, 15], 'keep_ratio': False, 'anchor_from': 'top_left', 'anchor_to': 'top_left', 'offset': [14, 12], 'layer': 5, 'anims': [f'@{ns}.fnar_rec_blink_out']}},
    ]

def fx_anims(ns):
    return {
        'fnar_cam_noise_anim': {'anim_type': 'flip_book', 'initial_uv': [0, 0], 'frame_count': NOISE_FRAMES, 'frame_step': NOISE_H, 'fps': 14},
        'fnar_cam_roll_anim': {'anim_type': 'offset', 'easing': 'linear', 'duration': 7.5, 'from': [0, -80], 'to': [0, 520], 'next': f'@{ns}.fnar_cam_roll_anim'},
        'fnar_rec_blink_out': {'anim_type': 'alpha', 'easing': 'linear', 'duration': 0.6, 'from': 1.0, 'to': 0.0, 'next': f'@{ns}.fnar_rec_blink_in'},
        'fnar_rec_blink_in': {'anim_type': 'alpha', 'easing': 'linear', 'duration': 0.6, 'from': 0.0, 'to': 1.0, 'next': f'@{ns}.fnar_rec_blink_out'},
        'fnar_cam_blink_out': {'anim_type': 'alpha', 'easing': 'linear', 'duration': 0.45, 'from': 1.0, 'to': 0.35, 'next': f'@{ns}.fnar_cam_blink_in'},
        'fnar_cam_blink_in': {'anim_type': 'alpha', 'easing': 'linear', 'duration': 0.45, 'from': 0.35, 'to': 1.0, 'next': f'@{ns}.fnar_cam_blink_out'},
    }

# ---------------------------------------------------------------- the HUD (monitor up, no form open)
def title_visible(expr):
    return [{'binding_name': '#hud_title_text_string', 'binding_type': 'global'}, {'binding_type': 'view', 'source_property_name': expr, 'target_property_name': '#visible'}]

on_expr = contains('#hud_title_text_string', MAP_ON)
fx_expr = f"({on_expr} or {contains('#hud_title_text_string', FX_ON)})"
hud_map_controls = [{'fnar_cam_map_base': img('textures/ui/fnar/cam_map', layer=1)}]
for i, c in enumerate(cams):
    code = f'{i:02d}'
    hud_map_controls.append({f'fnar_cam_live_{code}': img(
        f'textures/ui/fnar/cam_live_{code}', layer=2, anims=['@hud.fnar_cam_blink_out'],
        bindings=title_visible(f"(#hud_title_text_string = '{MAP_ON}{cam_code(i)}')"))})
hud = {
    'namespace': 'hud',
    'root_panel': {'modifications': [{'array_name': 'controls', 'operation': 'insert_back', 'value': [{'fnar_cam_hud@hud.fnar_cam_hud': {}}]}]},
    'fnar_cam_hud': {
        'type': 'panel', 'size': ['100%', '100%'], 'layer': 1,
        'bindings': title_visible(fx_expr),
        'controls': [
            *fx_controls('hud'),
            {'fnar_cam_map': {'type': 'panel', 'size': [HUD_W, HUD_H], 'anchor_from': 'bottom_right', 'anchor_to': 'bottom_right', 'offset': [-4, -4], 'layer': 6, 'controls': hud_map_controls,
                              'bindings': title_visible(on_expr)}},
        ],
    },
    **fx_anims('hud'),
    # vanilla's action bar (merged: only this binding is added) hides while a jumpscare plays
    'hud_actionbar_text': {
        'bindings': title_visible(f"((#hud_title_text_string - '{JS_ON}') = #hud_title_text_string)"),
    },
}

# ---------------------------------------------------------------- the clickable camera map (a server form)
# The HUD is not drawn while a form screen is open, so the form carries everything itself: the
# camera-feed look, the status lines (the form body, refreshed by the scripts) and the map.
# Only the form's title and body are read (global bindings); the buttons are invisible hit areas
# over the printed map, so nothing depends on per-button text.
def scale_rect(r):
    sx, sy = FORM_W / W, FORM_H / H
    return [round(r[0] * sx, 2), round(r[1] * sy, 2), round((r[2] - r[0]) * sx, 2), round((r[3] - r[1]) * sy, 2)]

def title_has(text):
    return [{'binding_name': '#title_text'}, {'binding_type': 'view', 'source_property_name': contains('#title_text', text), 'target_property_name': '#visible'}]

form_controls = [{'fnar_cam_form_map_image': img('textures/ui/fnar/cam_map', layer=1)}]
for i, c in enumerate(cams):
    form_controls.append({f'fnar_cam_form_live_{i:02d}': img(f'textures/ui/fnar/cam_live_{i:02d}', layer=2, anims=['@server_form.fnar_cam_blink_out'],
                                                              bindings=title_has(f'{FORM_MARK}{cam_code(i)}'))})
    x, y, w, h = scale_rect(cam_rect(c['id']))
    form_controls.append({f'fnar_cam_button_{i:02d}@server_form.fnar_hit_button': {'collection_index': i, 'size': [w, h], 'offset': [x, y]}})

# the action label depends on the action code (the last code of the title)
action_labels = [
    {f'label_w': {'type': 'label', 'text': 'PLAY SHOW', 'color': [1.0, 0.8, 0.3], 'shadow': True, 'layer': 3, 'font_scale_factor': 0.9, 'bindings': [{'binding_name': '#title_text'}, {'binding_type': 'view', 'source_property_name': f"(not ((#title_text - '§w') = #title_text))", 'target_property_name': '#visible'}]}},
    {f'label_s': {'type': 'label', 'text': 'SPOTLIGHT', 'color': [1.0, 1.0, 0.55], 'shadow': True, 'layer': 3, 'font_scale_factor': 0.9, 'bindings': [{'binding_name': '#title_text'}, {'binding_type': 'view', 'source_property_name': f"(not ((#title_text - '§s') = #title_text))", 'target_property_name': '#visible'}]}},
    {f'label_x': {'type': 'label', 'text': 'PLAY SHOW', 'color': [0.45, 0.47, 0.45], 'shadow': True, 'layer': 3, 'font_scale_factor': 0.9, 'bindings': [{'binding_name': '#title_text'}, {'binding_type': 'view', 'source_property_name': f"(not ((#title_text - '§x') = #title_text))", 'target_property_name': '#visible'}]}},
    # co-op: the camera operator's map warns the guard instead
    {f'label_p': {'type': 'label', 'text': 'WARN GUARD', 'color': [0.5, 0.85, 1.0], 'shadow': True, 'layer': 3, 'font_scale_factor': 0.9, 'bindings': [{'binding_name': '#title_text'}, {'binding_type': 'view', 'source_property_name': f"(not ((#title_text - '§p') = #title_text))", 'target_property_name': '#visible'}]}},
]

def top_button(name, index, size, offset, labels):
    """LOWER / the action button above the map: a dark plate with fixed labels (no per-button text binding)."""
    def state(color, alpha):
        return {'type': 'panel', 'controls': [{'plate': img('textures/ui/fnar/px_white', layer=1, color=color, alpha=alpha)}] + labels}
    return {f'{name}@common.button': {
        '$pressed_button_name': 'button.form_button_click', 'layer': 4,
        'collection_index': index, 'size': size, 'offset': offset, 'anchor_from': 'top_left', 'anchor_to': 'top_left',
        'controls': [
            {'default': state([0.05, 0.06, 0.05], 0.85)},
            {'hover': state([0.16, 0.24, 0.16], 0.92)},
            {'pressed': state([0.25, 0.4, 0.25], 0.95)},
        ],
        'bindings': [{'binding_type': 'collection_details', 'binding_collection_name': 'form_buttons'}],
    }}

form_controls.append(top_button('fnar_cam_button_lower', len(cams), [44, 13], [FORM_W - 44, -15],
                                [{'label_lower': {'type': 'label', 'text': 'LOWER', 'color': [1.0, 0.45, 0.45], 'shadow': True, 'layer': 3, 'font_scale_factor': 0.9}}]))
form_controls.append(top_button('fnar_cam_button_action', len(cams) + 1, [80, 13], [FORM_W - 128, -15], action_labels))

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
        'controls': [
            *fx_controls('server_form'),
            # the status lines (camera, show tape, the Ringmaster, power): the form body
            {'fnar_cam_status': {'type': 'panel', 'size': ['70%', '100%c'], 'anchor_from': 'bottom_middle', 'anchor_to': 'bottom_middle', 'offset': [0, -10], 'layer': 8,
                                 'controls': [{'fnar_cam_status_text': {'type': 'label', 'text': '#form_text', 'size': ['100%', 'default'], 'color': [1, 1, 1], 'shadow': True,
                                                                         'text_alignment': 'center', 'anchor_from': 'bottom_middle', 'anchor_to': 'bottom_middle', 'layer': 8}}]}},
            {'fnar_cam_form_map': {
                # collection_panel: the only container whose children may pick a collection item by
                # collection_index at a free position (like the vanilla store's screenshots_grid)
                'type': 'collection_panel', 'size': [FORM_W, FORM_H], 'anchor_from': 'bottom_right', 'anchor_to': 'bottom_right', 'offset': [-3, -3], 'layer': 10,
                'collection_name': 'form_buttons',
                'controls': form_controls,
            }},
        ],
    },
    **fx_anims('server_form'),
    # an invisible hit area over a camera on the printed map: a soft highlight on hover / press
    'fnar_hit_button@common.button': {
        '$pressed_button_name': 'button.form_button_click', 'anchor_from': 'top_left', 'anchor_to': 'top_left', 'layer': 4,
        'controls': [
            {'default': {'type': 'panel'}},
            {'hover': img('textures/ui/fnar/px_white', color=[0.75, 1.0, 0.75], alpha=0.35)},
            {'pressed': img('textures/ui/fnar/px_white', color=[0.75, 1.0, 0.75], alpha=0.6)},
        ],
        'bindings': [{'binding_type': 'collection_details', 'binding_collection_name': 'form_buttons'}],
    },
}

os.makedirs(os.path.join(RP, 'ui'), exist_ok=True)
json.dump(hud, open(os.path.join(RP, 'ui', 'hud_screen.json'), 'w'), indent=1, ensure_ascii=False)
json.dump(form, open(os.path.join(RP, 'ui', 'server_form.json'), 'w'), indent=1, ensure_ascii=False)
print(f'map {W}x{H}, {len(cams)} cameras, hud map {HUD_W}x{HUD_H}, form map {FORM_W}x{FORM_H}')
