"""Compose the Stillwater Caves preview sheet from the biome renders and the new block textures.
Usage: python3 make_biome_sheet.py <renders dir> <block textures dir> <out.png>"""
import sys
from PIL import Image, ImageDraw, ImageFont

SRC, TEX, OUT = sys.argv[1:4]
SERIF_B = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
MONO = '/usr/share/fonts/truetype/freefont/FreeMono.ttf'
MONO_B = '/usr/share/fonts/truetype/freefont/FreeMonoBold.ttf'
BG, TXT, DIM, RED, LINE = (12, 11, 12), (214, 205, 198), (160, 152, 148), (168, 38, 38), (58, 54, 56)
f = lambda p, s: ImageFont.truetype(p, s)

W, H = 2400, 1700
sheet = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(sheet)
lake = Image.open(f'{SRC}/biome_lake.png').convert('RGB').resize((1600, 900), Image.LANCZOS)
sheet.paste(lake, (20, 20))
shore = Image.open(f'{SRC}/biome_shore.png').convert('RGB').resize((790, 506), Image.LANCZOS)
ceil = Image.open(f'{SRC}/biome_ceiling.png').convert('RGB').resize((790, 506), Image.LANCZOS)
sheet.paste(shore, (20, 940)); sheet.paste(ceil, (830, 940))
for (x, y, w, h), lab in (((20, 20, 1600, 900), 'Flooded caverns in the fog'), ((20, 940, 790, 506), 'Shorelines'),
                          ((830, 940, 790, 506), 'Blood-stained ceilings')):
    d.rectangle((x, y, x + w - 1, y + h - 1), outline=LINE, width=2)
    d.rectangle((x + 2, y + h - 44, x + 12 + d.textlength(lab, font=f(MONO, 26)) + 14, y + h - 3), fill=(12, 11, 12))
    d.text((x + 14, y + h - 40), lab, font=f(MONO, 26), fill=TXT)

x0 = 1660
d.text((x0, 30), 'STILLWATER', font=f(SERIF_B, 64), fill=TXT)
d.text((x0, 104), 'CAVES', font=f(SERIF_B, 64), fill=TXT)
d.line((x0, 186, x0 + 520, 186), fill=RED, width=6)
info = [('Biome', 'brine:stillwater_caves'), ('Type', 'Cave biome'), ('Found', 'Inside Dripstone Caves'),
        ('Hostiles', 'Only the Brinesleeper'), ('Fog', 'Dense, blue-black'), ('Music', 'None. Silence.')]
y = 214
for k, v in info:
    d.text((x0, y), k, font=f(MONO, 26), fill=DIM)
    d.text((x0 + 150, y), v, font=f(MONO_B, 26), fill=TXT)
    y += 40
y += 18
d.text((x0, y), 'Find it:', font=f(MONO, 26), fill=DIM); y += 38
d.rectangle((x0, y, x0 + 700, y + 50), fill=(28, 26, 28), outline=LINE)
d.text((x0 + 14, y + 10), '/locate biome brine:stillwater_caves', font=f(MONO_B, 24), fill=(232, 222, 200))
y += 80
for ln in ['Still black water, pale bone', 'coral, bloodroot, claw-raked', 'walls and three-toed tracks', 'leading into the lake.',
           'Nothing else hunts here.']:
    d.text((x0, y), ln, font=f(MONO, 25), fill=DIM); y += 33

# the new blocks
y = 960
d.text((x0, y - 50), 'New blocks', font=f(MONO, 30), fill=TXT)
blocks = [('bloodstained_deepslate', 'Bloodstained Deepslate'), ('clawed_deepslate', 'Clawed Deepslate'),
          ('tracked_mud_top', 'Tracked Mud'), ('bone_coral', 'Bone Coral'), ('bloodroot', 'Bloodroot')]
for i, (t, name) in enumerate(blocks):
    im = Image.open(f'{TEX}/{t}.png').convert('RGBA')
    bg = Image.new('RGBA', im.size, (34, 32, 36, 255)); bg.alpha_composite(im)
    tile = bg.resize((96, 96), Image.NEAREST).convert('RGB')
    yy = y + i * 104
    sheet.paste(tile, (x0, yy))
    d.rectangle((x0, yy, x0 + 95, yy + 95), outline=LINE)
    d.text((x0 + 118, yy + 32), name, font=f(MONO_B, 26), fill=TXT)
d.text((20, H - 230), 'Preview made by running the biome\'s own generation rules on a sample cavern (tools/biome_preview.py),', font=f(MONO, 22), fill=DIM)
d.text((20, H - 200), 'rendered with the pack\'s block textures and fog. Vanilla blocks use look-alike textures, not Mojang\'s.', font=f(MONO, 22), fill=DIM)
sheet = sheet.crop((0, 0, W, H - 160))
sheet.save(OUT, optimize=True)
print('biome sheet ->', OUT, sheet.size)
