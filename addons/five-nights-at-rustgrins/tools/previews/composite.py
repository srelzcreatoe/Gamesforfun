"""Finishes the preview renders (run by make_previews.mjs).

Camera shots get the in-game camera HUD exactly as packs/RP/ui/hud_screen.json lays
it out (the camera-feed tint, grain, scanlines and rolling band, cam_frame stretched over
the screen, the REC badge top-left, the camera map bottom-right with the live camera
highlighted) plus the action bar the scripts
show (mc/hud.js nightBar), drawn in a pixel font at GUI scale 3. Writes
previews/<name>.jpg and previews/contact_sheet.jpg.
"""
import json
import os
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, 'tools', '.cache', 'previews')
RAW = os.path.join(CACHE, 'raw')
OUT = os.path.join(ROOT, 'previews')
UI = os.path.join(ROOT, 'packs', 'RP', 'textures', 'ui', 'fnar')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
FONT_LABEL = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

CAM_ORDER = ['1A', '1B', '1C', '2A', '2B', '3', '4A', '4B', '5', '6', '7', '8', '9', '10']

# Minecraft formatting colours
MC = {'0': (0, 0, 0), '1': (0, 0, 170), '2': (0, 170, 0), '3': (0, 170, 170), '4': (170, 0, 0), '5': (170, 0, 170),
      '6': (255, 170, 0), '7': (170, 170, 170), '8': (85, 85, 85), '9': (85, 85, 255), 'a': (85, 255, 85),
      'b': (85, 255, 255), 'c': (255, 85, 85), 'd': (255, 85, 255), 'e': (255, 255, 85), 'f': (255, 255, 255)}


def runs(line):
    """'§fCAM §7x' -> [(text, colour, bold)]"""
    out, col, bold = [], MC['f'], False
    for part in re.split(r'(§.)', line):
        if not part:
            continue
        if part.startswith('§'):
            c = part[1]
            if c in MC:
                col, bold = MC[c], False
            elif c == 'l':
                bold = True
            elif c == 'r':
                col, bold = MC['f'], False
            continue
        out.append((part, col, bold))
    return out


def pixel_text(lines, scale):
    """Action-bar style text: small font rendered 1:1 then scaled up (nearest) for the blocky look."""
    f = ImageFont.truetype(FONT, 9)
    lh = 11
    widths = []
    for line in lines:
        widths.append(sum(f.getlength(t) for t, _, _ in runs(line)))
    w, h = int(max(widths) + 4), lh * len(lines) + 3
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        x = (w - widths[i]) / 2
        for t, col, bold in runs(line):
            shadow = tuple(int(c * 0.25) for c in col) + (255,)
            d.text((x + 1, i * lh + 2), t, font=f, fill=shadow)
            d.text((x, i * lh + 1), t, font=f, fill=col + (255,))
            if bold:
                d.text((x + 0.5, i * lh + 1), t, font=f, fill=col + (255,))
            x += f.getlength(t)
    # the action bar's translucent backing
    back = Image.new('RGBA', (w + 6, h + 2), (0, 0, 0, 90))
    back.alpha_composite(img, (3, 1))
    return back.resize((back.width * scale, back.height * scale), Image.NEAREST)


def hud_controls():
    """The camera HUD controls as packs/RP/ui/hud_screen.json defines them (name -> definition)."""
    with open(os.path.join(ROOT, 'packs', 'RP', 'ui', 'hud_screen.json'), encoding='utf-8') as f:
        d = json.load(f)
    return d, {k: v for c in d['fnar_cam_hud']['controls'] for k, v in c.items()}


def cam_hud(img, hud):
    W, H = img.size
    s = H / 360  # GUI scale (1080p -> 3)
    out = img.convert('RGBA')
    d, ctl = hud_controls()
    # the camera-feed look, in the JSON UI's layer order: tint, grain (one flip-book frame), scanlines, rolling band
    t = ctl['fnar_cam_tint']
    tint = Image.new('RGBA', (W, H), tuple(round(255 * c) for c in t['color']) + (round(255 * t['alpha']),))
    out.alpha_composite(tint)
    n = ctl['fnar_cam_noise']
    nw, nh = n['uv_size']
    grain = Image.open(os.path.join(UI, 'cam_fx_noise.png')).convert('RGBA').crop((0, 3 * nh, nw, 4 * nh)).resize((W, H), Image.NEAREST)
    grain.putalpha(grain.getchannel('A').point(lambda a: int(a * n['alpha'])))
    out.alpha_composite(grain)
    tile = Image.open(os.path.join(UI, 'cam_fx_scan.png')).convert('RGBA')
    tile = tile.resize((max(1, round(tile.width * s)), max(1, round(tile.height * s))), Image.NEAREST)
    scan = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for y in range(0, H, tile.height):
        for x in range(0, W, tile.width):
            scan.paste(tile, (x, y))
    out.alpha_composite(scan)
    band_h = round(ctl['fnar_cam_roll']['size'][1] * s)
    band = Image.open(os.path.join(UI, 'cam_fx_roll.png')).convert('RGBA').resize((W, band_h), Image.BILINEAR)
    out.alpha_composite(band, (0, round(H * 0.58)))
    frame = Image.open(os.path.join(UI, 'cam_frame.png')).convert('RGBA').resize((W, H), Image.NEAREST)
    frame.putalpha(frame.getchannel('A').point(lambda a: int(a * 0.95)))
    out.alpha_composite(frame)
    rec = Image.open(os.path.join(UI, 'rec.png')).convert('RGBA').resize((round(48 * s), round(15 * s)), Image.NEAREST)
    out.alpha_composite(rec, (round(14 * s), round(12 * s)))
    mw, mh = (round(v * s) for v in ctl['fnar_cam_map']['size'])
    mp = Image.open(os.path.join(UI, 'cam_map.png')).convert('RGBA').resize((mw, mh), Image.LANCZOS)
    live = Image.open(os.path.join(UI, f"cam_live_{CAM_ORDER.index(hud['cam']):02d}.png")).convert('RGBA').resize((mw, mh), Image.LANCZOS)
    mp.alpha_composite(live)
    out.alpha_composite(mp, (W - mw - round(4 * s), H - mh - round(4 * s)))
    txt = pixel_text(hud['lines'], round(s))
    out.alpha_composite(txt, ((W - txt.width) // 2, H - txt.height - round(30 * s)))
    return out.convert('RGB')


def contact_sheet(items, cols=3, tw=640):
    th = tw * 9 // 16
    lab = 34
    pad = 10
    rows = (len(items) + cols - 1) // cols
    head = 90
    sheet = Image.new('RGB', (cols * (tw + pad) + pad, head + rows * (th + lab + pad) + pad), (12, 11, 14))
    d = ImageDraw.Draw(sheet)
    ft = ImageFont.truetype(FONT_LABEL, 34)
    fs = ImageFont.truetype(FONT_LABEL, 15)
    d.text((pad + 4, 18), "FIVE NIGHTS AT RUSTGRIN'S", font=ft, fill=(255, 111, 181))
    d.text((pad + 6, 60), 'Minecraft Bedrock add-on - preview renders of the built map (Vibrant Visuals style)', font=fs, fill=(127, 246, 232))
    for i, (img, caption) in enumerate(items):
        r, c = divmod(i, cols)
        x = pad + c * (tw + pad)
        y = head + r * (th + lab + pad)
        sheet.paste(img.resize((tw, th), Image.LANCZOS), (x, y))
        d.text((x + 2, y + th + 8), caption if d.textlength(caption, font=fs) < tw else caption[:70] + '...', font=fs, fill=(220, 220, 220))
    return sheet


def main():
    os.makedirs(OUT, exist_ok=True)
    scenes = json.load(open(os.path.join(CACHE, 'scenes.json')))
    items = []
    for sc in scenes:
        src = os.path.join(RAW, sc['name'] + '.png')
        if not os.path.exists(src):
            continue
        img = Image.open(src).convert('RGB')
        if sc.get('hud'):
            img = cam_hud(img, sc['hud'])
        img.save(os.path.join(OUT, sc['name'] + '.jpg'), quality=90, optimize=True)
        items.append((img, sc['caption']))
        print('preview', sc['name'])
    if items:
        contact_sheet(items).save(os.path.join(OUT, 'contact_sheet.jpg'), quality=88, optimize=True)
        print('preview contact_sheet')


if __name__ == '__main__':
    main()
