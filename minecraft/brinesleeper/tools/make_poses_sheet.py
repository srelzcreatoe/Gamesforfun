"""Compose the 'Stalking & Bipedal Poses' sheet: 20 portrait panels rendered from the exported model.

Usage: python3 make_poses_sheet.py <stills dir> <out.png>
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SRC = sys.argv[1] if len(sys.argv) > 1 else 'shots/v2sheet'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'shots/brinesleeper_poses_sheet.png'
SERIF = '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf'
SERIF_B = '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf'

POSES = [
    ('submerged_watch', '1. SUBMERGED WATCH', 'Only its head visible above the water, silently observing.'),
    ('shoreline_stalk', '2. SHORELINE STALK', 'Slowly crawling out of the water, but not attacking.'),
    ('corner_watch', '3. CORNER WATCH', 'Peeking from around cave corners, waiting for you to pass.'),
    ('ceiling_lurk', '4. CEILING LURK', 'Clinging beneath a low ceiling, its head hanging down unnaturally.'),
    ('distant_observer', '5. DISTANT OBSERVER', 'Standing or crouched across a cave lake, watching from afar.'),
    ('veil_stalk', '6. VEIL STALK', 'Hidden within vines or vegetation, blending with the environment.'),
    ('reflection_lurk', '7. REFLECTION LURK', 'Staring at its own reflection, or imitating yours.'),
    ('tunnel_crawl', '8. TUNNEL CRAWL', 'Crawling through tight spaces and narrow waterways.'),
    ('patient_strike', '9. PATIENT STRIKE', 'Motionless with one hand outstretched in the water, waiting for movement.'),
    ('shadow_hide', '10. SHADOW HIDE', 'A faint silhouette blending into the darkness, nearly indistinguishable.'),
    ('full_stand', '11. FULL STAND', 'Its true height revealed, standing upright and still.'),
    ('head_tilt', '12. HEAD TILT', 'Slowly tilting its head as if studying you.'),
    ('slow_approach', '13. SLOW APPROACH', 'Walking on two legs with a deliberate, unnatural gait.'),
    ('emerge_roar', '14. EMERGE ROAR', 'Rising to its full height with a silent open maw, a threat display.'),
    ('water_rise', '15. WATER RISE', 'Standing from the water, fully emerged, water pouring from its body.'),
    ('hunting_stance', '16. HUNTING STANCE', 'A forward-leaning stance before breaking into a chase.'),
    ('behind_cover', '17. BEHIND COVER', 'Standing behind a pillar or tree, only part of its body visible.'),
    ('ledge_watch', '18. LEDGE WATCH', 'Standing on a higher ledge, looking down at you.'),
    ('lunge', '19. LUNGE', 'A sudden, long-reaching attack motion on two legs.'),
    ('retreat', '20. RETREAT', 'Turning away and slowly walking back into the water, disappearing.'),
]

W, H = 3072, 2048
PW, PH = 307, 690           # panel image
TXT = (214, 206, 198)
DIM = (150, 142, 138)
LINE = (54, 50, 52)


def wrap(d, text, font, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=font) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def main():
    rng = np.random.default_rng(9)
    bg = np.clip(np.ones((H, W, 3)) * np.array([11, 10, 11]) + rng.normal(0, 2.6, (H, W, 1)), 0, 255).astype(np.uint8)
    sheet = Image.fromarray(bg, 'RGB')
    d = ImageDraw.Draw(sheet)
    f_name = ImageFont.truetype(SERIF_B, 27)
    f_desc = ImageFont.truetype(SERIF, 22)
    f_title = ImageFont.truetype(SERIF, 54)
    for k, (pid, name, desc) in enumerate(POSES):
        row, col = divmod(k, 10)
        x = col * PW
        y0 = 6 if row == 0 else 1046
        im = Image.open(f'{SRC}/pp_{pid}.png').convert('RGB').resize((PW - 4, PH))
        sheet.paste(im, (x + 2, y0))
        if col:
            d.line((x, y0, x, y0 + PH + 238), fill=LINE, width=2)
        ty = y0 + PH + 26
        for ln in wrap(d, name, f_name, PW - 26):
            tw = d.textlength(ln, font=f_name)
            d.text((x + (PW - tw) / 2, ty), ln, font=f_name, fill=TXT)
            ty += 34
        ty += 12
        for ln in wrap(d, desc, f_desc, PW - 30):
            tw = d.textlength(ln, font=f_desc)
            d.text((x + (PW - tw) / 2, ty), ln, font=f_desc, fill=DIM)
            ty += 28
    title = 'THE  BRINESLEEPER  —  STALKING  &  BIPEDAL  POSES'
    spaced = ' '.join(title)
    tw = d.textlength(spaced, font=f_title)
    cy = 990
    d.text(((W - tw) / 2, cy - 34), spaced, font=f_title, fill=(176, 168, 162))
    d.line((40, cy, (W - tw) / 2 - 40, cy), fill=(96, 90, 88), width=2)
    d.line(((W + tw) / 2 + 40, cy, W - 40, cy), fill=(96, 90, 88), width=2)
    d.line((0, 946, W, 946), fill=LINE, width=2)
    d.line((0, 1036, W, 1036), fill=LINE, width=2)
    sheet.save(OUT, optimize=True)
    print('poses sheet ->', OUT, sheet.size)


if __name__ == '__main__':
    main()
