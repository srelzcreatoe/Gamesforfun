"""Camera map HUD (feedback 117): the FNAF-style building map in the corner of
the screen while the player watches the cameras.

Writes into the resource pack:
  textures/ui/fb/cam_map.png        the map: ground floor + basement outlines,
                                    one labelled box per camera, YOU in the office
  textures/ui/fb/cam_map_cNN.png    one full-size overlay per camera: only that
                                    camera's box, highlighted (green, blinking)
  ui/hud_screen.json                adds the map to the HUD root panel

How the HUD knows what to show: the script (mc/game.js mapTitle) sends a title
made only of formatting codes, so nothing is drawn by the vanilla title:
  MAP_ON + the camera digits as codes  e.g. CAM 07 -> '§k§r§k§r§l§0§7'
  MAP_OFF                              '§k§r§k§r§o'
The map panel is visible while the title text contains MAP_ON; each overlay
while the title text equals its camera's code. Any other title (night cards,
6 AM, ...) hides the map.

Run after `node tools/export_floorplan.mjs`. Usage: python3 -I tools/gen_cam_map.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RP = os.path.join(ROOT, "packs", "FredbearRP")

MAP_ON = "§k§r§k§r§l"  # keep in sync with mc/game.js MAP_ON
PX = 6  # texture pixels per UI unit
SCALE = 0.45  # UI units per block
BOX = (11.0, 6.5)  # camera box size, UI units
SIZE = (129, 69)  # whole map, UI units
# Panels: (level, block window x0, z0, x1, z1, UI origin x, y)
GROUND = ("L1", 16, 12, 184, 152, 50.5, 3.0)
BELOW = ("L0", 16, 28, 110, 142, 3.0, 9.0)
BELOW_ROOMS = {"CHAMBER", "DINER", "DINER_KITCHEN", "CRAWL_D", "TUNNEL_W", "TUNNEL_N", "TUNNEL_S", "PUMP", "ARCHIVE", "CRAWL_A", "SUBFLOOR"}

# Box centres in local block coordinates, placed by hand like the FNAF map
# (next to the room each camera watches, never overlapping; checked below).
POS = {
    # ground floor
    "C06": (34, 24), "C03": (64, 24), "C01": (100, 24), "C10": (166, 28),
    "C04": (34, 55), "C02": (76, 68), "C14": (124, 68), "C11": (162, 84),
    "C05": (34, 88), "C07": (82, 108), "C12": (118, 108),
    "C08": (86, 124), "C13": (114, 124), "C09": (60, 128), "C18": (72, 144),
    # basement
    "C19": (34, 36), "C16": (40, 56), "C20": (40, 84), "C21": (28, 104), "C15": (90, 100), "C17": (98, 126),
}
BASEMENT = {"C15", "C16", "C17", "C19", "C20", "C21"}
YOU_AT = (101, 138)

WALL = (215, 215, 215, 235)
ROOM_FILL = (24, 24, 28, 120)
BACKDROP = (6, 6, 8, 120)
BOX_FILL = (70, 70, 74, 235)
BOX_EDGE = (235, 235, 235, 255)
HI_FILL = (70, 205, 70, 255)
HI_TEXT = (16, 28, 16, 255)


def font(size):
    for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def panel_of(cam):
    return BELOW if cam in BASEMENT else GROUND


def to_px(panel, x, z):
    _, bx0, bz0, _, _, ox, oy = panel
    return ((ox + (x - bx0) * SCALE) * PX, (oy + (z - bz0) * SCALE) * PX)


def box_rect(cam):
    cx, cy = to_px(panel_of(cam), *POS[cam])
    w, h = BOX[0] * PX, BOX[1] * PX
    return (round(cx - w / 2), round(cy - h / 2), round(cx + w / 2), round(cy + h / 2))


def check(cameras):
    ids = [c["id"] for c in cameras]
    missing = [c for c in ids if c not in POS]
    extra = [c for c in POS if c not in ids]
    assert not missing and not extra, f"camera map positions out of date: missing {missing}, unknown {extra}"
    rects = {c: box_rect(c) for c in ids}
    for i, a in enumerate(ids):
        ra = rects[a]
        assert ra[0] >= 0 and ra[1] >= 0 and ra[2] <= SIZE[0] * PX and ra[3] <= SIZE[1] * PX, f"{a} box outside the map"
        for b in ids[i + 1:]:
            rb = rects[b]
            assert ra[2] <= rb[0] or rb[2] <= ra[0] or ra[3] <= rb[1] or rb[3] <= ra[1], f"camera boxes {a} and {b} overlap"
    return rects


def draw_rooms(d, rooms, panel):
    level, bx0, bz0, bx1, bz1 = panel[:5]
    for r in rooms:
        if r["level"] != level or (level == "L0" and r["id"] not in BELOW_ROOMS):
            continue
        x1, z1, x2, z2 = r["box"]
        x1, z1, x2, z2 = max(x1, bx0), max(z1, bz0), min(x2, bx1), min(z2, bz1)
        if x2 <= x1 or z2 <= z1:
            continue
        a, b = to_px(panel, x1, z1), to_px(panel, x2, z2)
        d.rectangle([a, b], fill=ROOM_FILL, outline=WALL, width=2)


def draw_box(d, rect, cam, fill, edge, text_color, f):
    d.rectangle(rect, fill=fill, outline=edge, width=2)
    label = cam[1:]
    tw = d.textlength(label, font=f)
    cx, cy = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
    d.text((cx - tw / 2, cy), label, font=f, fill=text_color, anchor="lm")


def main():
    data = json.load(open(os.path.join(HERE, "out", "floorplan.json")))
    cameras = data["cameras"]
    rects = check(cameras)
    W, H = SIZE[0] * PX, SIZE[1] * PX
    f_box, f_small = font(round(4.6 * PX)), font(round(3.4 * PX))
    out_dir = os.path.join(RP, "textures", "ui", "fb")
    os.makedirs(out_dir, exist_ok=True)

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=3 * PX, fill=BACKDROP)
    draw_rooms(d, data["rooms"], GROUND)
    draw_rooms(d, data["rooms"], BELOW)
    d.text((BELOW[5] * PX, (BELOW[6] - 1.2) * PX), "BASEMENT", font=f_small, fill=(190, 190, 190, 255), anchor="ls")
    for cam, rect in rects.items():
        draw_box(d, rect, cam, BOX_FILL, BOX_EDGE, (245, 245, 245, 255), f_box)
    yx, yy = to_px(GROUND, *YOU_AT)
    d.text((yx, yy), "YOU", font=f_small, fill=(255, 255, 255, 255), anchor="mm")
    img.save(os.path.join(out_dir, "cam_map.png"), optimize=True)

    for cam, rect in rects.items():
        hi = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw_box(ImageDraw.Draw(hi), rect, cam, HI_FILL, (255, 255, 255, 255), HI_TEXT, f_box)
        hi.save(os.path.join(out_dir, f"cam_map_{cam.lower()}.png"), optimize=True)

    contains = f"(not ((#hud_title_text_string - '{MAP_ON}') = #hud_title_text_string))"
    title = {"binding_name": "#hud_title_text_string", "binding_type": "global"}
    controls = [{"fb_cam_map_base": {"type": "image", "texture": "textures/ui/fb/cam_map", "size": ["100%", "100%"], "layer": 1}}]
    for cam in sorted(rects):
        code = MAP_ON + "".join(f"§{c}" for c in cam[1:])
        controls.append({f"fb_cam_map_{cam.lower()}": {
            "type": "image",
            "texture": f"textures/ui/fb/cam_map_{cam.lower()}",
            "size": ["100%", "100%"],
            "layer": 2,
            "anims": ["@hud.fb_cam_map_blink_out"],
            "bindings": [title, {"binding_type": "view", "source_property_name": f"(#hud_title_text_string = '{code}')", "target_property_name": "#visible"}],
        }})
    ui = {
        "namespace": "hud",
        "root_panel": {
            "modifications": [{"array_name": "controls", "operation": "insert_back", "value": [{"fb_cam_map@hud.fb_cam_map": {}}]}],
        },
        "fb_cam_map": {
            "type": "panel",
            "size": list(SIZE),
            "anchor_from": "bottom_right",
            "anchor_to": "bottom_right",
            "offset": [-2, -2],
            "layer": 5,
            "bindings": [title, {"binding_type": "view", "source_property_name": contains, "target_property_name": "#visible"}],
            "controls": controls,
        },
        "fb_cam_map_blink_out": {"anim_type": "alpha", "easing": "linear", "duration": 0.45, "from": 1.0, "to": 0.35, "next": "@hud.fb_cam_map_blink_in"},
        "fb_cam_map_blink_in": {"anim_type": "alpha", "easing": "linear", "duration": 0.45, "from": 0.35, "to": 1.0, "next": "@hud.fb_cam_map_blink_out"},
    }
    os.makedirs(os.path.join(RP, "ui"), exist_ok=True)
    with open(os.path.join(RP, "ui", "hud_screen.json"), "w", encoding="utf-8") as fh:
        json.dump(ui, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"camera map: {len(rects)} cameras, {W}x{H} px ({SIZE[0]}x{SIZE[1]} UI units), ui/hud_screen.json")


if __name__ == "__main__":
    main()
