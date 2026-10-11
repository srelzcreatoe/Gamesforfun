#!/usr/bin/env python3
"""Renders the shots for the character sheet (via render.mjs) and lays them out.

    python3 make_sheet.py            -> ../../preview/bonnie_sheet.png
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "preview", "bonnie_sheet.png")
A = "animation.bonnie."

T = [0, 27, 0]
SHOTS = [
    dict(file="front.png", anim=A + "idle", time=0, cam=dict(az=0, el=3, dist=170, target=T, fov=30)),
    dict(file="side.png", anim=A + "idle", time=0, cam=dict(az=90, el=3, dist=170, target=T, fov=30)),
    dict(file="back.png", anim=A + "idle", time=0, cam=dict(az=180, el=3, dist=170, target=T, fov=30)),
    dict(file="main.png", anim=A + "performance1", time=0.25, cam=dict(az=34, el=7, dist=118, target=[0, 30, -3], fov=34)),
    dict(file="face_normal.png", anim=A + "idle", time=0, cam=dict(az=0, el=2, dist=48, target=[0, 39, -4], fov=22)),
    # performance1 at a frame where the head faces forward
    dict(file="face_perf.png", anim=A + "performance1", time=1.875, cam=dict(az=4, el=2, dist=50, target=[0.6, 38.0, -4.5], fov=22)),
    dict(file="hand.png", anim=A + "pose1", time=0.5, cam=dict(az=12, el=5, dist=21, target=[11.8, 41.3, -5.2], fov=30)),
    dict(file="banjo.png", anim=None, time=0, cam=dict(az=-4, el=4, dist=42, target=[-1.0, 24.5, -8], fov=30)),
    dict(file="joint.png", anim=A + "idle", time=0, cam=dict(az=62, el=4, dist=19, target=[8.8, 24.4, 0], fov=30)),
]
STRIP = [("idle", 0.0), ("walk", 0.3125), ("run", 0.1875), ("pose1", 0.5), ("pose2", 0.5), ("performance1", 0.25), ("performance2", 0.25)]
for name, t in STRIP:
    SHOTS.append(dict(file=f"strip_{name}.png", anim=A + name, time=t, cam=dict(az=22, el=6, dist=150, target=[0, 27, 0], fov=30)))


def font(size, bold=False, serif=True):
    name = ("DejaVuSerif" if serif else "DejaVuSans") + ("-Bold" if bold else "") + ".ttf"
    return ImageFont.truetype(os.path.join("/usr/share/fonts/truetype/dejavu", name), size)


def crop_center(im, w, h, cx=0.5, cy=0.5):
    """Scale-to-cover then crop w x h around (cx, cy)."""
    s = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * s + 0.5), int(im.height * s + 0.5)), Image.LANCZOS)
    x = int(min(max(im.width * cx - w / 2, 0), im.width - w))
    y = int(min(max(im.height * cy - h / 2, 0), im.height - h))
    return im.crop((x, y, x + w, y + h))


def main():
    tmp = tempfile.mkdtemp(prefix="bonnie-sheet-")
    shots = SHOTS
    spec = os.path.join(tmp, "shots.json")
    with open(spec, "w") as f:
        json.dump(shots, f)
    env = dict(os.environ, SHOTS=spec, W="1000", H="1000")
    subprocess.run(["node", os.path.join(HERE, "render.mjs"), "shots", tmp], check=True, env=env, cwd=HERE)
    img = {s["file"][:-4]: Image.open(os.path.join(tmp, s["file"])).convert("RGB") for s in shots}

    W, H = 1600, 2000
    bg = (228, 229, 232)
    ink = (37, 40, 56)
    soft = (90, 92, 104)
    panel = (214, 216, 220)
    sheet = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(sheet)

    d.text((44, 30), "BONNIE", font=font(92, True, False), fill=ink)
    d.line((48, 140, 300, 140), fill=ink, width=2)
    for i, line in enumerate(("THE", "SHOW", "NEVER", "ENDS.")):
        d.text((48, 170 + i * 34), " ".join(line), font=font(22), fill=ink)
    d.line((48, 320, 120, 320), fill=ink, width=2)
    for i, line in enumerate(("A trusted face", "for a brighter", "tomorrow.")):
        d.text((48, 350 + i * 28), line, font=font(19), fill=ink)
    d.text((720, 40), "MINECRAFT-STYLE  FNAF  CHARACTER  MODEL", font=font(19), fill=ink)
    d.line((720, 74, 1330, 74), fill=soft, width=1)
    d.text((720, 88), "MODEL   /   ANIMATION   /   SHOWCASE", font=font(15), fill=soft)
    d.line((1360, 30, 1360, 112), fill=soft, width=1)
    for i, line in enumerate(("SAME SONGS.", "DIFFERENT ENDING.", "SOME FRIENDSHIPS", "LAST FOREVER.")):
        d.text((1376, 30 + i * 22), line, font=font(14), fill=soft)

    # main 3/4 view
    main = crop_center(img["main"], 700, 1330, 0.5, 0.5)
    sheet.paste(main, (0, 300))
    d.text((300, 1600), "3/4 VIEW", font=font(16), fill=ink, anchor="ma")
    d.text((300, 1622), "(MAIN)", font=font(16), fill=ink, anchor="ma")

    # front / side / back panel
    px, py, pw, ph = 720, 130, 850, 560
    d.rectangle((px, py, px + pw, py + ph), fill=panel, outline=(200, 202, 206))
    for i, (k, label) in enumerate((("front", "FRONT VIEW"), ("side", "SIDE VIEW"), ("back", "BACK VIEW"))):
        tile = crop_center(img[k], 270, 500, 0.5, 0.5)
        sheet.paste(tile, (px + 12 + i * 278, py + 10))
        d.text((px + 12 + i * 278 + 135, py + 520), " ".join(label).replace("   ", "    "), font=font(14), fill=ink, anchor="ma")

    # face details
    for i, (k, label) in enumerate((("face_normal", "FACE DETAIL (NORMAL)"), ("face_perf", "FACE DETAIL (PERFORMANCE)"))):
        tile = crop_center(img[k], 300, 280, 0.5, 0.5)
        x = 720 + i * 316
        sheet.paste(tile, (x, 720))
        d.text((x + 150, 1010), label, font=font(15), fill=ink, anchor="ma")
    d.line((1460, 720, 1500, 720), fill=soft, width=1)
    for i, line in enumerate(("MUSIC", "LIVES", "ON.")):
        d.text((1560, 760 + i * 28), " ".join(line), font=font(17), fill=ink, anchor="ra")
    for i, line in enumerate(("A", "BRIGHTER", "STAGE", "AWAITS.")):
        d.text((1560, 880 + i * 28), " ".join(line), font=font(17), fill=ink, anchor="ra")

    # small details + palette
    for i, (k, label) in enumerate((("hand", "HAND DETAIL"), ("banjo", "BANJO DETAIL"), ("joint", "JOINT DETAIL"))):
        tile = crop_center(img[k], 200, 250, 0.5, 0.5)
        x = 720 + i * 212
        sheet.paste(tile, (x, 1050))
        d.text((x + 100, 1312), label, font=font(14), fill=ink, anchor="ma")
    pal = [(51, 54, 86), (78, 81, 124), (179, 175, 175), (129, 128, 133), (127, 41, 42), (22, 22, 21)]
    for i, c in enumerate(pal):
        x, y = 1380 + (i % 3) * 64, 1080 + (i // 3) * 74
        d.rectangle((x, y, x + 54, y + 62), fill=c)
    d.text((1474, 1240), "COLOR PALETTE", font=font(14), fill=ink, anchor="ma")

    # animation strip
    d.text((40, 1668), "ANIMATION PREVIEW", font=font(18), fill=ink)
    d.line((300, 1680, 1300, 1680), fill=soft, width=1)
    d.text((1560, 1668), "PLAY. PERFORM. REPEAT.", font=font(15), fill=soft, anchor="ra")
    tw = 212
    for i, (name, _) in enumerate(STRIP):
        tile = crop_center(img[f"strip_{name}"], tw - 12, 250, 0.5, 0.5)
        x = 28 + i * (tw + 4)
        sheet.paste(tile, (x, 1700))
        label = name.upper().replace("POSE", "POSE ").replace("PERFORMANCE", "PERFORMANCE ")
        d.text((x + (tw - 12) // 2, 1962), label.strip(), font=font(14), fill=ink, anchor="ma")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT, optimize=True)
    print("wrote", os.path.normpath(OUT))


if __name__ == "__main__":
    sys.exit(main())
