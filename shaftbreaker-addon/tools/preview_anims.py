#!/usr/bin/env python3
"""Renders a contact sheet of the composited animation states (as the client controller layers them)."""
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_model import Model, load_anims, pose_from_anims, render  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
m = Model(os.path.join(ROOT, 'src_assets/shaftbreaker.geo.json'), os.path.join(ROOT, 'src_assets/shaftbreaker.png'))
A = load_anims(sorted(glob.glob(os.path.join(ROOT, 'RP/animations/*.animation.json'))))
N = 'animation.shaftbreaker.'
SCALE = 0.56
TILE = (300, 400)
PX = 4.2  # screen px per model px
GROUND = 360


def comp(names, ts):
    return pose_from_anims([A[N + n] for n in names], ts)


def tile(label, pose, yaw=-35, note=''):
    img, _ = render(m, pose, size=TILE, yaw=yaw, pitch=8, scale=PX, center_y=(TILE[1] / 2 - GROUND) / -PX)
    d = ImageDraw.Draw(img)
    # ground line + block ruler (16 model px * 1/SCALE per block)
    d.line([(0, GROUND), (TILE[0], GROUND)], fill=(70, 50, 50))
    bpx = 16 / SCALE * PX
    for k in range(1, 4):
        y = GROUND - k * bpx
        d.line([(4, y), (14, y)], fill=(160, 120, 110))
        d.text((16, y - 6), '%d' % k, fill=(160, 120, 110))
    d.text((8, 8), label, fill=(240, 210, 200))
    if note:
        d.text((8, 22), note, fill=(170, 140, 130))
    return img


tiles = [
    tile('WATCH (standoff stare)', comp(['watch', 'twitch'], [1.0, 1.5])),
    tile('STALK (creeping)', comp(['stalk_walk', 'jaw_chatter'], [0.7, 0.1])),
    tile('CROUCH - 2 block tunnel', comp(['stalk_idle', 'crouch_stalk'], [1.0, 0])),
    tile('CRAWL - 1 block gap', comp(['crawl'], [0.4]), yaw=-70),
    tile('THREAT DISPLAY', comp(['frenzy_idle', 'threat_rear'], [1.0, 1.5])),
    tile('SCREAM', comp(['watch', 'scream'], [1.0, 0.9])),
    tile('HUNT (sprint)', comp(['frenzy_run'], [3.0]), yaw=-60),
    tile('LUNGE ATTACK', comp(['frenzy_idle', 'frenzy_lunge'], [1.0, 0.45]), yaw=-60),
    tile('CLIMB', comp(['climb'], [0.3]), yaw=-60),
    tile('SWIM', comp(['swim'], [0.5]), yaw=-70),
    tile('CORNER PEEK', comp(['stalk_idle', 'peek_left'], [1.0, 1.4])),
    tile('HEAD TILT', comp(['watch', 'head_tilt'], [1.0, 2.2])),
    tile('VANISH (phasing out)', comp(['watch', 'vanish'], [1.0, 1.25])),
    tile('BREAKING BLOCKS', comp(['breaker_smash'], [0.4]), yaw=-55),
    tile('DEATH', comp(['death'], [2.4]), yaw=-70),
]
cols = 5
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGB', (TILE[0] * cols, TILE[1] * rows), (18, 12, 14))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % cols) * TILE[0], (i // cols) * TILE[1]))
out = os.path.join(ROOT, 'previews', 'shaftbreaker_animations.png')
sheet.save(out)
print(out)
