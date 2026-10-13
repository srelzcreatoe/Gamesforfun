#!/usr/bin/env python3
"""Renders the shots for a character sheet (via render.mjs) and lays them out.

    python3 make_sheet.py <character>     -> fnaf_addon/<character>/preview/<character>_sheet.png

Text, camera shots and palette come from configs/<character>.json ("sheet").
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))


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


def spaced(text):
    return " ".join(text).replace("   ", "    ")


def main(character):
    with open(os.path.join(HERE, "configs", f"{character}.json")) as f:
        cfg = json.load(f)
    sc = cfg["sheet"]
    out = os.path.join(HERE, "..", "..", character, "preview", f"{character}_sheet.png")

    shots = []
    for key in ("front", "side", "back", "main"):
        shots.append(dict(file=f"{key}.png", **sc["shots"][key]))
    for i, s in enumerate(sc["faces"] + sc["details"]):
        shots.append(dict(file=f"tile{i}.png", anim=s.get("anim"), time=s.get("time", 0), cam=s["cam"]))
    for name, t in sc["strip"]:
        shots.append(dict(file=f"strip_{name}.png", anim=name, time=t, cam=sc["strip_cam"]))

    tmp = tempfile.mkdtemp(prefix=f"{character}-sheet-")
    spec = os.path.join(tmp, "shots.json")
    with open(spec, "w") as f:
        json.dump(shots, f)
    env = dict(os.environ, SHOTS=spec, W="1000", H="1000")
    subprocess.run(["node", os.path.join(HERE, "render.mjs"), character, "shots", tmp], check=True, env=env, cwd=HERE)
    img = {s["file"][:-4]: Image.open(os.path.join(tmp, s["file"])).convert("RGB") for s in shots}

    W, H = 1600, 2000
    if cfg.get("theme") == "night":
        bg, ink, soft, panel = (14, 10, 13), (234, 228, 231), (150, 140, 146), (26, 19, 23)
    else:
        bg, ink, soft, panel = (228, 229, 232), (37, 40, 56), (90, 92, 104), (214, 216, 220)
    sheet = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(sheet)

    size = 92
    while d.textlength(cfg["title"], font=font(size, True, False)) > 640:
        size -= 2
    d.text((44, 30 + (92 - size) // 2), cfg["title"], font=font(size, True, False), fill=ink)
    d.line((48, 140, 300, 140), fill=ink, width=2)
    for i, line in enumerate(sc["tagline"]):
        d.text((48, 170 + i * 34), spaced(line), font=font(22), fill=ink)
    d.line((48, 320, 120, 320), fill=ink, width=2)
    for i, line in enumerate(sc["blurb"]):
        d.text((48, 350 + i * 28), line, font=font(19), fill=ink)
    d.text((720, 40), "MINECRAFT-STYLE  FNAF  CHARACTER  MODEL", font=font(19), fill=ink)
    d.line((720, 74, 1330, 74), fill=soft, width=1)
    d.text((720, 88), "MODEL   /   ANIMATION   /   SHOWCASE", font=font(15), fill=soft)
    d.line((1360, 30, 1360, 112), fill=soft, width=1)
    for i, line in enumerate(sc["corner"]):
        d.text((1376, 30 + i * 22), line, font=font(14), fill=soft)

    # main 3/4 view
    sheet.paste(crop_center(img["main"], 700, 1330, 0.5, 0.5), (0, 300))
    d.text((300, 1600), "3/4 VIEW", font=font(16), fill=ink, anchor="ma")
    d.text((300, 1622), "(MAIN)", font=font(16), fill=ink, anchor="ma")

    # front / side / back panel
    px, py, pw, ph = 720, 130, 850, 560
    d.rectangle((px, py, px + pw, py + ph), fill=panel, outline=soft)
    for i, (k, label) in enumerate((("front", "FRONT VIEW"), ("side", "SIDE VIEW"), ("back", "BACK VIEW"))):
        sheet.paste(crop_center(img[k], 270, 500, 0.5, 0.5), (px + 12 + i * 278, py + 10))
        d.text((px + 12 + i * 278 + 135, py + 520), spaced(label), font=font(14), fill=ink, anchor="ma")

    # two close-ups
    for i, s in enumerate(sc["faces"]):
        x = 720 + i * 316
        sheet.paste(crop_center(img[f"tile{i}"], 300, 280, 0.5, 0.5), (x, 720))
        d.text((x + 150, 1010), s["label"], font=font(15), fill=ink, anchor="ma")
    d.line((1460, 720, 1500, 720), fill=soft, width=1)
    for i, line in enumerate(sc["side_a"]):
        d.text((1560, 760 + i * 28), spaced(line), font=font(17), fill=ink, anchor="ra")
    for i, line in enumerate(sc["side_b"]):
        d.text((1560, 880 + i * 28), spaced(line), font=font(17), fill=ink, anchor="ra")

    # three details + palette
    nf = len(sc["faces"])
    for i, s in enumerate(sc["details"]):
        x = 720 + i * 212
        sheet.paste(crop_center(img[f"tile{nf + i}"], 200, 250, 0.5, 0.5), (x, 1050))
        d.text((x + 100, 1312), s["label"], font=font(14), fill=ink, anchor="ma")
    for i, c in enumerate(sc["palette"]):
        x, y = 1380 + (i % 3) * 64, 1080 + (i // 3) * 74
        d.rectangle((x, y, x + 54, y + 62), fill=tuple(c))
    d.text((1474, 1240), "COLOR PALETTE", font=font(14), fill=ink, anchor="ma")

    # animation strip
    d.text((40, 1668), "ANIMATION PREVIEW", font=font(18), fill=ink)
    d.line((300, 1680, 1300, 1680), fill=soft, width=1)
    d.text((1560, 1668), sc.get("strap", "PLAY. PERFORM. REPEAT."), font=font(15), fill=soft, anchor="ra")
    n = len(sc["strip"])
    tw = (W - 56) // n
    for i, (name, _) in enumerate(sc["strip"]):
        tile = crop_center(img[f"strip_{name}"], tw - 12, 250, 0.5, 0.5)
        x = 28 + i * tw
        sheet.paste(tile, (x, 1700))
        label = name.upper()
        for word in ("POSE", "PERFORMANCE", "JUMPSCARE"):
            label = label.replace(word, word + " ")
        d.text((x + (tw - 12) // 2, 1962), label.strip(), font=font(14 if n <= 7 else 12), fill=ink, anchor="ma")

    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out, optimize=True)
    print("wrote", os.path.normpath(out))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
