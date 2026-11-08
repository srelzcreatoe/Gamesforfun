"""Compose the Stillwater Caves preview sheet from the biome renders, the hall map and the new block textures.
Usage: python3 make_biome_sheet.py <renders dir> <map.png> <block textures dir> <out.png>
Renders expected in the renders dir: vista.png, lurk.png, shrine.png, shore.png (viewer/biome.html via shoot.js)."""
import sys
from PIL import Image, ImageDraw, ImageFont

SRC, MAP, TEX, OUT = sys.argv[1:5]
SERIF_B = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
MONO = '/usr/share/fonts/truetype/freefont/FreeMono.ttf'
MONO_B = '/usr/share/fonts/truetype/freefont/FreeMonoBold.ttf'
BG, TXT, DIM, RED, LINE = (12, 11, 12), (214, 205, 198), (160, 152, 148), (168, 38, 38), (58, 54, 56)
f = lambda p, s: ImageFont.truetype(p, s)

W, H = 2400, 2190
sheet = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(sheet)


def panel(name, box, label):
    x, y, w, h = box
    im = Image.open(name).convert('RGB').resize((w, h), Image.LANCZOS)
    sheet.paste(im, (x, y))
    d.rectangle((x, y, x + w - 1, y + h - 1), outline=LINE, width=2)
    if label:
        tw = d.textlength(label, font=f(MONO, 26))
        d.rectangle((x + 2, y + h - 44, x + tw + 30, y + h - 3), fill=BG)
        d.text((x + 14, y + h - 40), label, font=f(MONO, 26), fill=TXT)


panel(f'{SRC}/vista.png', (20, 20, 1600, 900), 'The flooded halls: black water, pale curtains, blood')
panel(f'{SRC}/lurk.png', (20, 940, 1180, 664), 'Something waits off the candle-lit shore')
panel(f'{SRC}/shrine.png', (1210, 940, 1170, 664), 'Sunken shrines: someone came down here, once')
panel(f'{SRC}/shore.png', (20, 1624, 780, 439), 'Bone coral, bloodroot and pallid caps')
panel(MAP, (820, 1624, 439, 439), None)

# ---------------------------------------------------------------- title and facts
x0 = 1660
d.text((x0, 30), 'STILLWATER', font=f(SERIF_B, 64), fill=TXT)
d.text((x0, 104), 'CAVES', font=f(SERIF_B, 64), fill=TXT)
d.line((x0, 186, x0 + 600, 186), fill=RED, width=6)
info = [('Biome', 'brine:stillwater_caves'), ('Replaces', '70% of Dripstone Caves'), ('Halls', 'domed caverns 40-60+ wide'),
        ('Lakes', 'up to 10 blocks deep'), ('Levels', 'waterlines at y -24 and y 12'), ('Hostiles', 'only the Brinesleeper'),
        ('Music', 'none. Silence.')]
y = 210
for k, v in info:
    d.text((x0, y), k, font=f(MONO, 25), fill=DIM)
    d.text((x0 + 150, y), v, font=f(MONO_B, 25), fill=TXT)
    y += 38
y += 14
d.text((x0, y), 'Find it:', font=f(MONO, 25), fill=DIM)
y += 36
d.rectangle((x0, y, x0 + 715, y + 50), fill=(28, 26, 28), outline=LINE)
d.text((x0 + 14, y + 10), '/locate biome brine:stillwater_caves', font=f(MONO_B, 24), fill=(232, 222, 200))
y += 76
for ln in ['Vast flooded halls under curtains', 'of pale stone and blood-red vines.', 'Great pillars stand in the water;',
           'candles still burn at sunken', 'shrines; ribcages lie in the', 'shallows; three-toed tracks lead',
           'into the lake. Nothing else', 'hunts here.']:
    d.text((x0, y), ln, font=f(MONO, 25), fill=DIM)
    y += 33

# ---------------------------------------------------------------- map legend
lx = 1280
d.text((lx, 1630), 'One hall system', font=f(MONO_B, 26), fill=TXT)
d.text((lx, 1664), 'from above (112 x 112', font=f(MONO, 22), fill=DIM)
d.text((lx, 1690), 'blocks of a single', font=f(MONO, 22), fill=DIM)
d.text((lx, 1716), 'generated sample)', font=f(MONO, 22), fill=DIM)
legend = [((44, 86, 100), 'shallow water'), ((12, 24, 34), '10 blocks deep'), ((90, 88, 92), 'shore'), ((22, 22, 26), 'rock, pillars'),
          ((150, 120, 96), 'shrine ruins'), ((255, 196, 96), 'lit candles'), ((40, 46, 52), 'grid: 16-block chunks')]
yy = 1760
for col, name in legend:
    d.rectangle((lx, yy + 4, lx + 22, yy + 26), fill=col, outline=LINE)
    d.text((lx + 34, yy + 2), name, font=f(MONO, 22), fill=DIM)
    yy += 36

# ---------------------------------------------------------------- the new blocks
bx = 1620
d.text((bx, 1630), 'New blocks (vanilla-style)', font=f(MONO_B, 26), fill=TXT)
blocks = [('bloodstained_deepslate', 'Bloodstained Deepslate'), ('clawed_deepslate', 'Clawed Deepslate'),
          ('veined_deepslate', 'Veined Deepslate *'), ('tracked_mud_top', 'Tracked Mud'), ('bone_coral', 'Bone Coral'),
          ('bloodroot', 'Bloodroot *'), ('pallid_cap', 'Pallid Caps *'), ('pale_dripstone_middle', 'Pale Dripstone (4 sizes)')]
for i, (t, name) in enumerate(blocks):
    im = Image.open(f'{TEX}/{t}.png').convert('RGBA')
    bg = Image.new('RGBA', im.size, (34, 32, 36, 255)); bg.alpha_composite(im)
    tile = bg.resize((64, 64), Image.NEAREST).convert('RGB')
    cx, cy = bx + (i % 2) * 385, 1676 + (i // 2) * 84
    sheet.paste(tile, (cx, cy))
    d.rectangle((cx, cy, cx + 63, cy + 63), outline=LINE)
    words = name.split(' ')
    if len(name) > 18 and len(words) > 1:
        d.text((cx + 76, cy + 6), ' '.join(words[:-1]) if len(words) > 2 else words[0], font=f(MONO_B, 21), fill=TXT)
        d.text((cx + 76, cy + 32), words[-1] if len(words) > 2 else ' '.join(words[1:]), font=f(MONO_B, 21), fill=TXT)
    else:
        d.text((cx + 76, cy + 20), name, font=f(MONO_B, 21), fill=TXT)
d.text((bx, 2014), '* gives off light', font=f(MONO, 21), fill=DIM)

d.text((20, H - 110), "Preview made by running the biome's own generation rules (the same hall pieces, rules and numbers as the pack) on "
       "a 112 x 112 block sample (tools/biome_preview.py),", font=f(MONO, 21), fill=DIM)
d.text((20, H - 82), "lit only by its own light sources the way block light spreads. Vanilla blocks use look-alike textures, not Mojang's.",
       font=f(MONO, 21), fill=DIM)
sheet = sheet.crop((0, 0, W, H - 40))
sheet.save(OUT, optimize=True)
print('biome sheet ->', OUT, sheet.size)
