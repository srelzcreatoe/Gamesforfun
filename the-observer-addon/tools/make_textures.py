#!/usr/bin/env python3
"""Generate The Observer's original textures, block models, and pack icons.

All pixel art is drawn procedurally here. The pack icons are cropped from the
supplied model render (source_assets/supplied/dweller_preview.png).
Outputs go into packs/TheObserver_RP (and the BP pack icon).
"""
import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "packs", "TheObserver_RP")
BP = os.path.join(ROOT, "packs", "TheObserver_BP")
SRC = os.path.join(ROOT, "source_assets", "supplied")
random.seed(1007)


def save(img, *parts):
    p = os.path.join(RP, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p)
    return p


def jitter(c, amt):
    return tuple(max(0, min(255, int(v + random.uniform(-amt, amt)))) for v in c[:3]) + ((c[3],) if len(c) == 4 else (255,))


# ----------------------------------------------------------------------------- blocks

def veil():
    img = Image.new("RGBA", (16, 16))
    px = img.load()
    for y in range(16):
        for x in range(16):
            thread = 9 if (x + (y // 3)) % 5 == 0 else 0
            base = 11 + thread + random.randint(-3, 3)
            px[x, y] = (base, base, base + 3, 255)
    # two faint pale specks, like eyes in a curtain
    for x, y in ((5, 6), (10, 6)):
        px[x, y] = (54, 52, 50, 255)
    return save(img, "textures", "blocks", "observer", "veil.png")


def box_uv_paint(img, uv, size, faces):
    """Paint a cube's box-UV layout. faces: dict face->(color fn(x,y)->rgba) for north/south/east/west/up/down."""
    u, v = uv
    w, h, d = size
    rects = {
        "up": (u + d, v, w, d), "down": (u + d + w, v, w, d),
        "west": (u, v + d, d, h), "north": (u + d, v + d, w, h),
        "east": (u + d + w, v + d, d, h), "south": (u + 2 * d + w, v + d, w, h),
    }
    px = img.load()
    for face, (x0, y0, fw, fh) in rects.items():
        fn = faces.get(face) or faces.get("*")
        for yy in range(int(fh)):
            for xx in range(int(fw)):
                px[int(x0 + xx), int(y0 + yy)] = fn(xx, yy, int(fw), int(fh))


def effigy():
    tw, th = 32, 32
    img = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    char = lambda *_: jitter((28, 27, 30, 255), 6)
    bark = lambda *_: jitter((44, 38, 34, 255), 7)

    def head_face(x, y, w, h):
        if y == 1 and x in (0, 2):
            return (235, 235, 230, 255)  # pinprick eyes
        return jitter((24, 23, 26, 255), 4)

    cubes = [
        {"name": "plinth", "origin": [-3, 0, -3], "size": [6, 1, 6], "uv": [0, 0], "paint": {"*": bark}},
        {"name": "body", "origin": [-1, 1, -1], "size": [2, 7, 2], "uv": [0, 8], "paint": {"*": char}},
        {"name": "arm_r", "origin": [1, 2.5, -0.5], "size": [1, 5, 1], "uv": [8, 8], "paint": {"*": char}},
        {"name": "arm_l", "origin": [-2, 2.5, -0.5], "size": [1, 5, 1], "uv": [12, 8], "paint": {"*": char}},
        {"name": "head", "origin": [-1.5, 8, -1.5], "size": [3, 3, 3], "uv": [16, 8], "paint": {"*": char, "north": head_face}},
    ]
    for c in cubes:
        box_uv_paint(img, c["uv"], [int(math.ceil(s)) for s in c["size"]], c["paint"])
    geo = {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.observer.effigy", "texture_width": tw, "texture_height": th,
                        "visible_bounds_width": 2, "visible_bounds_height": 2, "visible_bounds_offset": [0, 0.5, 0]},
        "bones": [{"name": "effigy", "pivot": [0, 0, 0], "cubes": [{"origin": c["origin"], "size": c["size"], "uv": c["uv"]} for c in cubes]}],
    }]}
    os.makedirs(os.path.join(RP, "models", "blocks"), exist_ok=True)
    json.dump(geo, open(os.path.join(RP, "models", "blocks", "effigy.geo.json"), "w"), indent=1)
    return save(img, "textures", "blocks", "observer", "effigy.png")


def ward_lantern():
    tw, th = 64, 32
    img = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    iron = lambda *_: jitter((52, 50, 56, 255), 6)

    def glass(x, y, w, h):
        cx, cy = (w - 1) / 2, (h - 1) / 2
        dist = math.hypot(x - cx, y - cy)
        if w >= 5 and abs(y - cy) < 0.6 and abs(x - cx) < 1.6:
            return (250, 246, 230, 255)  # the eye
        if x in (0, w - 1) or y in (0, h - 1):
            return iron()
        glow = max(0, 1 - dist / max(w, h))
        return (int(200 + 50 * glow), int(150 + 60 * glow), int(70 + 40 * glow), 255)

    cubes = [
        {"origin": [-4, 0, -4], "size": [8, 1, 8], "uv": [0, 0], "paint": {"*": iron}},
        {"origin": [-3, 1, -3], "size": [6, 6, 6], "uv": [0, 9], "paint": {"*": glass, "up": iron, "down": iron}},
        {"origin": [-2, 7, -2], "size": [4, 2, 4], "uv": [32, 0], "paint": {"*": iron}},
        {"origin": [-0.5, 9, -0.5], "size": [1, 1, 1], "uv": [48, 0], "paint": {"*": iron}},
    ]
    for c in cubes:
        box_uv_paint(img, c["uv"], [int(math.ceil(s)) for s in c["size"]], c["paint"])
    geo = {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.observer.ward_lantern", "texture_width": tw, "texture_height": th,
                        "visible_bounds_width": 2, "visible_bounds_height": 2, "visible_bounds_offset": [0, 0.5, 0]},
        "bones": [{"name": "lantern", "pivot": [0, 0, 0], "cubes": [{"origin": c["origin"], "size": c["size"], "uv": c["uv"]} for c in cubes]}],
    }]}
    json.dump(geo, open(os.path.join(RP, "models", "blocks", "ward_lantern.geo.json"), "w"), indent=1)
    return save(img, "textures", "blocks", "observer", "ward_lantern.png")


# ----------------------------------------------------------------------------- items

def canvas():
    return Image.new("RGBA", (16, 16), (0, 0, 0, 0))


def outline(img, color=(8, 8, 10, 255)):
    px = img.load()
    out = img.copy()
    po = out.load()
    for y in range(16):
        for x in range(16):
            if px[x, y][3] == 0 and any(0 <= x + dx < 16 and 0 <= y + dy < 16 and px[x + dx, y + dy][3] > 0 and px[x + dx, y + dy] != color
                                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                po[x, y] = color
    return out


def field_notes():
    img = canvas()
    d = ImageDraw.Draw(img)
    d.rectangle([3, 2, 12, 14], fill=(46, 33, 28, 255))
    d.rectangle([3, 2, 4, 14], fill=(30, 21, 18, 255))
    d.line([12, 3, 12, 13], fill=(222, 214, 196, 255))
    d.line([11, 3, 11, 13], fill=(196, 188, 170, 255))
    for x, y in ((7, 7), (9, 7)):
        d.point((x, y), fill=(240, 240, 236, 255))
    d.line([6, 10, 10, 10], fill=(70, 52, 44, 255))
    return save(outline(img), "textures", "items", "observer", "field_notes.png")


def chalk():
    img = canvas()
    px = img.load()
    for i in range(9):
        x, y = 3 + i, 12 - i
        for dx, dy in ((0, 0), (1, 0), (0, 1)):
            shade = 236 - (dx + dy) * 30 - i * 2
            px[x + dx, y + dy] = (shade, shade, shade - 4, 255)
    for x, y in ((2, 13), (4, 14), (3, 14)):
        px[x, y] = (200, 200, 196, 140)
    return save(outline(img), "textures", "items", "observer", "chalk.png")


def witness_lens():
    img = canvas()
    px = img.load()
    for i in range(8):
        for w in range(2):
            x, y = 3 + i + w, 13 - i
            px[x, y] = (110 - i * 4, 84 - i * 3, 50, 255)
    d = ImageDraw.Draw(img)
    d.ellipse([9, 1, 14, 6], fill=(170, 196, 204, 255), outline=(70, 60, 44, 255))
    px[11, 3] = (250, 250, 250, 255)
    px[12, 3] = (20, 20, 24, 255)
    return save(outline(img), "textures", "items", "observer", "witness_lens.png")


def vestige():
    img = canvas()
    d = ImageDraw.Draw(img)
    d.polygon([(8, 1), (12, 5), (11, 11), (8, 15), (5, 10), (4, 5)], fill=(26, 25, 30, 255))
    d.polygon([(8, 2), (11, 5), (8, 6)], fill=(46, 44, 52, 255))
    for x, y in ((7, 8), (9, 8)):
        d.point((x, y), fill=(240, 240, 236, 255))
    return save(outline(img, (4, 4, 6, 255)), "textures", "items", "observer", "vestige.png")


def observers_eye():
    img = canvas()
    d = ImageDraw.Draw(img)
    d.ellipse([2, 2, 13, 13], fill=(16, 16, 20, 255), outline=(60, 58, 66, 255))
    d.ellipse([5, 5, 10, 10], fill=(214, 210, 200, 255))
    d.ellipse([7, 7, 8, 8], fill=(10, 10, 12, 255))
    img.putpixel((6, 6), (255, 255, 255, 255))
    return save(img, "textures", "items", "observer", "observers_eye.png")


def ward_item():
    img = canvas()
    d = ImageDraw.Draw(img)
    d.rectangle([4, 14, 11, 14], fill=(52, 50, 56, 255))
    d.rectangle([5, 6, 10, 13], fill=(232, 176, 92, 255), outline=(52, 50, 56, 255))
    d.rectangle([6, 4, 9, 5], fill=(52, 50, 56, 255))
    d.point((7, 3), fill=(52, 50, 56, 255))
    d.point((8, 3), fill=(52, 50, 56, 255))
    d.line([6, 9, 9, 9], fill=(250, 246, 230, 255))
    d.point((7, 9), fill=(20, 20, 24, 255))
    return save(outline(img), "textures", "items", "observer", "ward_lantern.png")


# ----------------------------------------------------------------------------- particles

def soft_dot(size, color, falloff=1.6):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    c = (size - 1) / 2
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - c, y - c) / (size / 2)
            a = max(0.0, 1 - d) ** falloff
            px[x, y] = color[:3] + (int(255 * a),)
    return img


def particles():
    out = []
    # footprint: a long sole with a broad toe, pointing "up" (+v); dark, slightly transparent
    fp = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(fp)
    d.ellipse([5, 1, 11, 9], fill=(18, 16, 16, 230))
    d.ellipse([6, 8, 10, 15], fill=(18, 16, 16, 230))
    out.append(save(fp.filter(ImageFilter.GaussianBlur(0.4)), "textures", "particle", "observer", "footprint.png"))
    out.append(save(soft_dot(8, (12, 12, 16)), "textures", "particle", "observer", "mote.png"))
    smoke = soft_dot(16, (14, 14, 18), 1.2)
    out.append(save(smoke, "textures", "particle", "observer", "smoke.png"))
    out.append(save(soft_dot(8, (255, 255, 255), 2.2), "textures", "particle", "observer", "glint.png"))
    cm = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(cm)
    d.line([3, 3, 12, 12], fill=(236, 236, 228, 255), width=2)
    d.line([12, 3, 3, 12], fill=(236, 236, 228, 255), width=2)
    out.append(save(cm, "textures", "particle", "observer", "chalk_mark.png"))
    sm = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(sm)
    d.line([3, 3, 12, 12], fill=(120, 120, 116, 200), width=2)
    d.line([12, 3, 3, 12], fill=(120, 120, 116, 200), width=2)
    d.ellipse([4, 7, 13, 11], fill=(70, 70, 68, 170))
    out.append(save(sm.filter(ImageFilter.GaussianBlur(0.6)), "textures", "particle", "observer", "chalk_smudged.png"))
    out.append(save(soft_dot(8, (190, 186, 178)), "textures", "particle", "observer", "dust.png"))
    return out


# ----------------------------------------------------------------------------- pack icon

def pack_icon():
    src = Image.open(os.path.join(SRC, "dweller_preview.png")).convert("RGBA")
    w, h = src.size
    # head and shoulders of the supplied render
    box = (int(w * 0.18), int(h * 0.0), int(w * 0.86), int(h * 0.0) + int(w * 0.68))
    crop = src.crop(box).resize((256, 256), Image.LANCZOS)
    # replace the light studio background with a dim, cold fog gradient
    bg = Image.new("RGBA", (256, 256))
    bp = bg.load()
    for y in range(256):
        for x in range(256):
            r = math.hypot(x - 128, y - 110) / 180
            v = int(58 - 46 * min(1, r))
            bp[x, y] = (v, v + 1, v + 6, 255)
    cp = crop.load()
    out = bg.copy()
    op = out.load()
    for y in range(256):
        for x in range(256):
            c = cp[x, y]
            light = (c[0] + c[1] + c[2]) / 3
            sat = max(c[:3]) - min(c[:3])
            if light > 225 and sat < 12:
                continue  # studio background
            op[x, y] = c
    return out


def main():
    made = [veil(), effigy(), ward_lantern(), field_notes(), chalk(), witness_lens(), vestige(), observers_eye(), ward_item()]
    made += particles()
    icon = pack_icon()
    icon.save(os.path.join(RP, "pack_icon.png"))
    icon.save(os.path.join(BP, "pack_icon.png"))
    made += [os.path.join(RP, "pack_icon.png"), os.path.join(BP, "pack_icon.png")]
    terrain = {"resource_pack_name": "the_observer", "texture_name": "atlas.terrain", "padding": 8, "num_mip_levels": 4,
               "texture_data": {"observer_veil": {"textures": ["textures/blocks/observer/veil"]},
                                "observer_effigy": {"textures": ["textures/blocks/observer/effigy"]},
                                "observer_ward_lantern": {"textures": ["textures/blocks/observer/ward_lantern"]}}}
    json.dump(terrain, open(os.path.join(RP, "textures", "terrain_texture.json"), "w"), indent=2)
    items = {"resource_pack_name": "the_observer", "texture_name": "atlas.items",
             "texture_data": {f"observer_{n}": {"textures": [f"textures/items/observer/{n}"]}
                              for n in ("field_notes", "chalk", "witness_lens", "vestige", "observers_eye", "ward_lantern")}}
    json.dump(items, open(os.path.join(RP, "textures", "item_texture.json"), "w"), indent=2)
    for m in made:
        print(os.path.relpath(m, ROOT))


if __name__ == "__main__":
    main()
