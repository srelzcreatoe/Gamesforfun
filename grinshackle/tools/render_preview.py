"""Software-rendered animation previews (NOT in-game footage). Produces PNG contact sheets and an animated GIF."""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
import anim_tools as T, numpy as np
from PIL import Image, ImageDraw

def main(rp, out, clips=None, gif=True):
    geo = T.load_geo(f'{rp}/models/entity/grinshackle_chainreaver.geo.json')
    anims = T.load_anims(f'{rp}/animations/grinshackle_chainreaver.animation.json')
    tex = T.load_texture(f'{rp}/textures/entity/grinshackle_chainreaver.png')
    os.makedirs(out, exist_ok=True)
    names = clips or [k.split('.')[-1] for k in anims]
    sheets = []
    for short in names:
        key = 'animation.grinshackle_chainreaver.' + short
        a = anims[key]; L = float(a['animation_length'])
        n = 8
        frames, labels = [], []
        for i in range(n):
            t = L * i / (n - 1) if n > 1 else 0
            m = T.pose(geo, anims, [key], t)
            img = T.render(geo, m, tex, 'iso', size=(220, 300), scale=300/60.0)
            frames.append(img); labels.append(f'{short} t={t:.2f}s')
        sheet = T.contact_sheet(frames, labels, cols=n)
        d = ImageDraw.Draw(sheet); d.text((8, sheet.size[1]-14), 'software render of the delivered geometry and animation JSON - not an in-game screenshot', fill=(160,160,160,255))
        sheet.save(f'{out}/{short}_sheet.png'); sheets.append(sheet)
        print('sheet', short)
    if gif:
        # one GIF: attack (normal + half speed), slam, attack_crawl, chain_snap, emerge, vanish, from two views
        seq = [('attack', 1.0), ('attack', 0.5), ('slam', 1.0), ('attack_crawl', 1.0), ('chain_snap', 1.0), ('emerge', 1.0), ('vanish', 1.0), ('lunge', 1.0), ('roar', 1.0)]
        gframes = []
        for short, speed in seq:
            key = 'animation.grinshackle_chainreaver.' + short; L = float(anims[key]['animation_length'])
            fps = 12; count = int(L * fps / speed)
            for i in range(count):
                t = (i / fps) * speed
                m = T.pose(geo, anims, [key], t)
                left = T.render(geo, m, tex, 'iso', size=(260, 320), scale=320/60.0)
                right = T.render(geo, m, tex, 'side', size=(260, 320), scale=320/60.0)
                fr = Image.new('RGB', (540, 340), (24, 26, 30)); fr.paste(left, (5, 20)); fr.paste(right, (275, 20))
                d = ImageDraw.Draw(fr); d.text((8, 4), f'{short} {"(half speed)" if speed < 1 else ""} t={t:.2f}s  iso | side   [software render, not in-game]', fill=(220, 220, 220))
                gframes.append(fr.convert('P', palette=Image.ADAPTIVE, colors=128))
            print('gif', short, count)
        gframes[0].save(f'{out}/grinshackle_animation_preview.gif', save_all=True, append_images=gframes[1:], duration=int(1000/12), loop=0, optimize=False)
        print('wrote gif', len(gframes), 'frames')

if __name__ == '__main__':
    rp, out = sys.argv[1], sys.argv[2]
    clips = sys.argv[3].split(',') if len(sys.argv) > 3 and sys.argv[3] else None
    main(rp, out, clips, gif=(len(sys.argv) <= 4 or sys.argv[4] != 'nogif'))
