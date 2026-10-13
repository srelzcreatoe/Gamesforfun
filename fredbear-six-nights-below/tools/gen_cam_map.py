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
  MAP_ON + the camera digits as codes  e.g. CAM 16 -> '§k§r§k§r§l§0§7'
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
FORM_MARK = "§k§r§k§r§m"  # keep in sync with mc/ui.js CAM_FORM_MARK (1.6.2 clickable map)
FORM_SCALE = 1.5  # the clickable map is drawn 1.5x the HUD map so the buttons are easy to hit
LOWER_SIZE = (34, 11)  # LOWER button above the map's top-right corner, UI units
PX = 6  # texture pixels per UI unit
SCALE = 0.45  # UI units per block
BOX = (11.0, 6.5)  # camera box size, UI units
SIZE = (129, 69)  # whole map, UI units
# Panels: (level, block window x0, z0, x1, z1, UI origin x, y)
GROUND = ("L1", 16, 12, 184, 152, 50.5, 3.0)
BELOW = ("L0", 16, 28, 110, 142, 3.0, 9.0)
BELOW_ROOMS = {"CHAMBER", "DINER", "DINER_KITCHEN", "CRAWL_D", "NIGHTMARE", "TUNNEL_W", "TUNNEL_N", "TUNNEL_S", "PUMP", "ARCHIVE", "CRAWL_A", "SUBFLOOR"}

# Box centres in local block coordinates, placed by hand like the FNAF map
# (next to the room each camera watches, never overlapping; checked below).
POS = {
    # ground floor (1.6 layout)
    "C03": (34, 24), "C02": (61, 24), "C01": (100, 24), "C10": (166, 28),
    "C04": (34, 52), "C05": (61, 55), "C08": (86, 76), "C09": (126, 76), "C11": (162, 84),
    "C06": (40, 81), "C07": (34, 110), "C16": (82, 107), "C12": (118, 107),
    "C15": (82, 123), "C13": (120, 123), "C17": (57, 130), "C18": (74, 146),
    "C14": (101, 146),  # the ceiling vent above the office (1.4)
    # basement
    "C25": (34, 36), "C24": (40, 56), "C23": (40, 84), "C22": (28, 104), "C20": (90, 100), "C19": (98, 126),
    "C21": (40, 130),  # the workshop (1.5)
}
BASEMENT = {"C19", "C20", "C21", "C22", "C23", "C24", "C25"}
YOU_AT = (101, 133)

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
    write_server_form([c["id"] for c in cameras], rects)
    print(f"camera map: {len(rects)} cameras, {W}x{H} px ({SIZE[0]}x{SIZE[1]} UI units), ui/hud_screen.json, ui/server_form.json")


def write_server_form(ids, rects):
    """1.6.2: the clickable camera map (mc/ui.js cameraMapForm).

    An ActionForm whose title starts with FORM_MARK is drawn as the building map in the bottom-right corner
    instead of the usual dialog. Every other form keeps the vanilla dialog.

    1.6.3: the buttons come from the same factory the vanilla form uses (a stack panel over the "form_buttons"
    collection with its #collection_length binding), so each button gets its text and its click exactly like
    a normal form button. (1.6.2 placed the buttons by hand with collection_index: they showed no text and
    clicks did nothing in-game.) Each factory item is a zero-height row holding one button per camera at that
    camera's box; only the one whose text matches the item's text ("05", or "§a05" for the live camera) is
    visible, so item k shows its button at camera k's place. The menu cursor (mouse), controller focus and touch
    work as in any menu."""
    k = FORM_SCALE / PX  # texture px -> UI units
    mw, mh = round(SIZE[0] * FORM_SCALE, 1), round(SIZE[1] * FORM_SCALE, 1)
    has_mark = f"(not ((#title_text - '{FORM_MARK}') = #title_text))"
    no_mark = f"((#title_text - '{FORM_MARK}') = #title_text)"

    def button(text_codes, size, offset):
        cond = " or ".join(f"(#form_button_text = '{t}')" for t in text_codes)
        return {
            "size": size,
            "offset": offset,
            "bindings": [
                {"binding_type": "collection_details", "binding_collection_name": "form_buttons"},
                {"binding_type": "collection", "binding_collection_name": "form_buttons", "binding_name": "#form_button_text"},
                {"binding_type": "view", "source_property_name": f"({cond})", "target_property_name": "#visible"},
            ],
        }

    item_controls = []
    for cam in ids:
        x1, y1, x2, y2 = rects[cam]
        num = cam[1:]
        item_controls.append({f"fb_cam_button_{cam.lower()}@server_form.fb_cam_button": button(
            [num, f"§a{num}"],
            [round((x2 - x1) * k, 2), round((y2 - y1) * k, 2)],
            [round(x1 * k, 2), round(y1 * k, 2)],
        )})
    item_controls.append({"fb_cam_button_lower@server_form.fb_cam_button": button(
        ["§cLOWER"], list(LOWER_SIZE), [round(mw - LOWER_SIZE[0], 2), -LOWER_SIZE[1] - 1])})

    ui = {
        "namespace": "server_form",
        # Full screen, so the map can sit in the corner (the vanilla dialogs are centred either way).
        "main_screen_content": {"size": ["100%", "100%"]},
        "long_form": {
            "type": "panel",
            "size": ["100%", "100%"],
            "controls": [
                {"fb_default_long_form@common_dialogs.main_panel_no_buttons": {
                    # the vanilla long_form, unchanged; shown for every form without the mark
                    "$title_panel": "common_dialogs.standard_title_label",
                    "$title_size": ["100% - 15px", 10],
                    "$title_max_size": ["100% - 15px", 10],
                    "size": [225, 200],
                    "$text_name": "#title_text",
                    "$title_text_binding_type": "none",
                    "$child_control": "server_form.long_form_panel",
                    "layer": 2,
                    "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view", "source_property_name": no_mark, "target_property_name": "#visible"}],
                }},
                {"fb_cam_form@server_form.fb_cam_form": {
                    "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view", "source_property_name": has_mark, "target_property_name": "#visible"}],
                }},
            ],
        },
        "fb_cam_form": {
            "type": "panel",
            "size": ["100%", "100%"],
            "controls": [{"fb_cam_form_map": {
                "type": "panel",
                "size": [mw, mh],
                "anchor_from": "bottom_right",
                "anchor_to": "bottom_right",
                "offset": [-2, -2],
                "layer": 10,
                "controls": [
                    {"fb_cam_form_map_image": {"type": "image", "texture": "textures/ui/fb/cam_map", "size": ["100%", "100%"], "layer": 1}},
                    {"fb_cam_form_live": {
                        "type": "label", "text": "#form_text", "color": [1, 1, 1], "shadow": True, "layer": 3,
                        "anchor_from": "top_left", "anchor_to": "bottom_left", "offset": [1, -2], "size": ["default", 10],
                    }},
                    {"fb_cam_form_buttons@server_form.fb_cam_form_buttons": {}},
                ],
            }}],
        },
        # The vanilla long-form button factory (server_form.long_form_dynamic_buttons_panel), with our item.
        "fb_cam_form_buttons": {
            "type": "stack_panel",
            "orientation": "vertical",
            "size": ["100%", "100%"],
            "anchor_from": "top_left",
            "anchor_to": "top_left",
            "layer": 4,
            "factory": {
                "name": "buttons",
                "control_ids": {
                    "button": "server_form.fb_cam_item",
                    "label": "@server_form.fb_cam_nothing",
                    "header": "@server_form.fb_cam_nothing",
                    "divider": "@server_form.fb_cam_nothing",
                },
            },
            "collection_name": "form_buttons",
            "bindings": [{"binding_name": "#form_button_contents", "binding_name_override": "#collection_length"}],
        },
        "fb_cam_nothing": {"type": "panel", "size": [0, 0]},
        # One factory item: a zero-height row (every item starts at the map's top-left) with a button per camera.
        "fb_cam_item": {
            "type": "panel",
            "size": ["100%", 0],
            "anchor_from": "top_left",
            "anchor_to": "top_left",
            "controls": item_controls,
        },
        "fb_cam_button@common_buttons.light_text_button": {
            "$pressed_button_name": "button.form_button_click",
            "anchor_from": "top_left",
            "anchor_to": "top_left",
            "layer": 4,
            "$button_text": "#form_button_text",
            "$button_text_binding_type": "collection",
            "$button_text_grid_collection_name": "form_buttons",
            "$button_text_max_size": ["100%", "100%"],
            "$button_font_scale_factor": 0.85,  # two digits fit the small boxes
        },
    }
    with open(os.path.join(RP, "ui", "server_form.json"), "w", encoding="utf-8") as fh:
        json.dump(ui, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


if __name__ == "__main__":
    main()
