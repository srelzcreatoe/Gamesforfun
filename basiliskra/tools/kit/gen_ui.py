#!/usr/bin/env python3
"""
His own health bar at the top of the screen (2.2), and Vathrok's (2.3).

The bar itself is the game's boss bar: his entity carries `minecraft:boss` from the start, as the Wither and the Ender
Dragon do, so the game shows it to everyone near him and keeps it filled with his health; Vathrok's (the one that
comes up out of the ground, not the battle one) carries it too.  This file draws each in its own colours: a
resource-pack copy of the game's `hud.boss_health_panel` (the 1.26.60 definition, unchanged) with two more controls in
it.  One is shown only for a boss bar whose title has his name in it, and covers the game's bar with his: a charcoal
frame with crimson plates and his pale eyes, his name, and a crimson fill.  The other is shown only for Vathrok's, and
covers it with Vathrok's: a slate frame with a row of green crystal spines, its acid-green eyes, and an acid-green fill.
Any other boss bar (the Wither's, another add-on's) is left as the game draws it.  If this file were ever not read,
both bars would still be there, in the game's own colours.

(2.3) The title is tested for *containing* a name, not for being equal to one: in 2.2 it was tested for equality with
the names the script gives him, and the look never showed, so the title the game puts on the bar is not exactly that
(it may carry formatting codes, or be the entity's name key, `entity.basiliskra:basiliskra.name`, which the label
turns into "Basiliskra" only when it draws it).  Containment is the test other add-ons' custom boss bars use
(`(not ((#bossName - 'name') = #bossName))`), and every one of those forms of the title contains one of the strings
below.

Every construct used is one the game's own UI files use (a collection binding, then a view binding over it).

    python3 tools/kit/gen_ui.py
"""
from __future__ import annotations

import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RP = os.path.join(ROOT, "packs", "RP")
W, H = 182, 20                              # the game's boss bar entry is 182 x 20
FILL_AT, FILL_SIZE = (6, 12), (170, 6)

C = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def contains(word: str) -> str:
    """The JSON UI test for 'the title contains word': taking the word out of it changes it."""
    return f"(not ((#bossName - '{word}') = #bossName))"


def lacks(word: str) -> str:
    return f"((#bossName - '{word}') = #bossName)"


# Whose bar is whose, by what its title contains.  His: his name (the name tag the script gives him in each form,
# "Basiliskra I" .. "IV", or the name of his type, "Basiliskra"), or his type's name key.  Vathrok's: its name, or its
# type's name key, entity.basiliskra:vathrok.name (which has "basiliskra" in it, lower case: so his test is for
# "basiliskra:basiliskra", and also leaves out any title with "athrok" in it).  Vathrok's bar is drawn over his, so
# even a title that passed both would get Vathrok's.
BARS = {
    "basiliskra": {
        "show": f"(({contains('Basiliskra')} or {contains('basiliskra:basiliskra')}) and {lacks('athrok')})",
        "words": ["Basiliskra", "basiliskra:basiliskra"],
        "layer": 50,
        "label": [1.0, 0.8, 0.64],
    },
    "vathrok": {
        "show": f"({contains('Vathrok')} or {contains('vathrok')})",
        "words": ["Vathrok", "vathrok"],
        "layer": 60,
        "label": [0.8, 1.0, 0.62],
    },
}


def slot(a: np.ndarray, rim: str, recess: str, lip: str) -> None:
    """The slot the fill runs in: a dark recess with a lit lower lip."""
    x0, y0 = FILL_AT[0] - 1, FILL_AT[1] - 1
    a[y0:y0 + FILL_SIZE[1] + 2, x0:x0 + FILL_SIZE[0] + 2] = C(rim)
    a[y0 + 1:y0 + FILL_SIZE[1] + 1, x0 + 1:x0 + FILL_SIZE[0] + 1] = C(recess)
    a[y0 + FILL_SIZE[1] + 1, x0:x0 + FILL_SIZE[0] + 2] = C(lip)


def eyes(a: np.ndarray, white: str, ring: str, pupil: str, slit: bool, at: int = 17) -> None:
    for cx in (at, W - 1 - at):
        for dy in range(-2, 3):
            for dx in range(-3, 4):
                r = (dx * dx) / 9 + (dy * dy) / 4
                if r <= 1.0:
                    a[6 + dy, cx + dx] = C(white) if r < 0.55 else C(ring)
        if slit:
            a[4:9, cx] = C(pupil)
        else:
            a[6, cx] = a[5, cx] = C(pupil)


def frame_basiliskra() -> np.ndarray:
    a = np.zeros((H, W, 4), np.uint8)
    a[:, :] = C("#130a0c")                                          # opaque: it covers the game's bar under it
    a[0, :] = a[-1, :] = a[:, 0] = a[:, -1] = C("#3b060b")           # outer edge
    a[1, 1:-1] = a[-2, 1:-1] = C("#7d111a")                          # crimson rim
    a[1:-1, 1] = a[1:-1, -2] = C("#7d111a")
    a[2:10, 24:W - 24] = C("#1c0e0f")                               # the name plate, a shade lighter
    slot(a, "#2a0508", "#070304", "#5a0a11")
    # a crimson plate in each top corner, raked back like his
    for side in (0, 1):
        for k in range(7):
            for y in range(2 + k // 2, 9):
                x = 3 + k if side == 0 else W - 4 - k
                a[y, x] = C("#c01a22") if y < 4 + k // 2 else C("#7a0d14")
    eyes(a, "#e9dfc4", "#a3141c", "#0b0607", slit=False)              # his pale eyes beside the name plate
    return a


def fill_basiliskra() -> np.ndarray:
    fw, fh = FILL_SIZE
    rows = ["#ff8a5c", "#ff4630", "#de161f", "#bd1018", "#8d0b12", "#5c070c"]
    a = np.zeros((fh, fw, 4), np.uint8)
    for y in range(fh):
        a[y, :] = C(rows[y])
    # glowing cracks across it, as his hide has
    for x in range(5, fw, 12):
        a[1:fh - 1, x] = C("#ffb27c")
        if x + 1 < fw:
            a[2:fh - 2, x + 1] = C("#ff7a52")
    return a


def frame_vathrok() -> np.ndarray:
    a = np.zeros((H, W, 4), np.uint8)
    a[:, :] = C("#0e1210")                                          # opaque: it covers the game's bar under it
    a[0, :] = a[-1, :] = a[:, 0] = a[:, -1] = C("#060807")           # outer edge
    a[1, 1:-1] = a[-2, 1:-1] = C("#34403a")                          # slate rim
    a[1:-1, 1] = a[1:-1, -2] = C("#34403a")
    a[2:10, 24:W - 24] = C("#161c18")                               # the name plate
    # scutes along the lower band, as its back has: slate plates, a lighter top edge on each
    for x0 in range(3, W - 3, 8):
        a[10, x0:x0 + 6] = C("#4e5a52")
    slot(a, "#1c2a1d", "#030604", "#2f6a26")
    # a row of green crystal spines in each top corner, tall at the corner, shorter towards its eyes
    for side in (0, 1):
        for i, hgt in enumerate((6, 5, 4, 3)):
            cx = 4 + i * 4 if side == 0 else W - 5 - i * 4
            for dy in range(hgt):
                y = 9 - dy
                half = max(0, (hgt - dy) // 3)
                for dx in range(-half, half + 1):
                    a[y, cx + dx] = C("#aaee66") if dy >= hgt - 2 else C("#3ca03c")
    eyes(a, "#c8f57a", "#2c7a2a", "#050805", slit=True, at=21)       # its acid-green eyes, slit
    return a


def fill_vathrok() -> np.ndarray:
    fw, fh = FILL_SIZE
    rows = ["#e4ff9a", "#b2f05e", "#6fd23e", "#3fa82c", "#25761f", "#164a14"]
    a = np.zeros((fh, fw, 4), np.uint8)
    for y in range(fh):
        a[y, :] = C(rows[y])
    # bubbles of venom rising through it
    for x in range(3, fw, 9):
        y = 1 + (x * 7) % 3
        a[y, x] = C("#f4ffd0")
        if x + 1 < fw:
            a[y + 1, x + 1] = C("#d6ff8c")
    return a


DRAW = {"basiliskra": (frame_basiliskra, fill_basiliskra), "vathrok": (frame_vathrok, fill_vathrok)}


def bar(key: str) -> dict:
    b = BARS[key]
    return {
        "type": "panel",
        "size": [W, H],
        "anchor_from": "top_middle",
        "anchor_to": "top_middle",
        "layer": b["layer"],
        "controls": [
            {f"{key}_frame": {"type": "image", "texture": f"textures/ui/{key}_boss_frame", "size": [W, H], "layer": 1}},
            {f"{key}_fill": {
                "type": "image", "texture": f"textures/ui/{key}_boss_fill", "size": list(FILL_SIZE),
                "anchor_from": "top_left", "anchor_to": "top_left", "offset": list(FILL_AT), "layer": 2,
                "clip_direction": "left", "clip_pixelperfect": False,
                "bindings": [{"binding_name": "#progress_percentage", "binding_name_override": "#clip_ratio",
                              "binding_type": "collection", "binding_collection_name": "boss_bars"}]}},
            {f"{key}_name": {
                "type": "label", "text": "#bossName", "color": b["label"], "shadow": True, "enable_profanity_filter": True,
                "anchor_from": "top_middle", "anchor_to": "top_middle", "offset": [0, 2], "layer": 3,
                "bindings": [{"binding_name": "#bossName", "binding_type": "collection", "binding_collection_name": "boss_bars"}]}},
        ],
        "bindings": [
            {"binding_name": "#bossName", "binding_type": "collection", "binding_collection_name": "boss_bars"},
            {"binding_type": "view", "source_property_name": b["show"], "target_property_name": "#visible"},
        ],
    }


# The game's boss bar entry (hud_screen.json, 1.26.60), copied unchanged, with the two bars added after its controls.
def hud() -> dict:
    vanilla_panel = {
        "type": "panel",
        "size": [182, 20],
        "anchor_from": "top_middle",
        "anchor_to": "top_middle",
        "$progress_bar_collection": "boss_bars",
        "controls": [
            {"boss_name@boss_name_panel": {}},
            {"progress_bar_for_collections@common.progress_bar_for_collections": {"offset": [0, 10]}},
        ] + [{f"{k}_boss_bar@hud.{k}_boss_bar": {}} for k in BARS],
        "bindings": [
            {"binding_name": "#bar_visible", "binding_type": "collection", "binding_collection_name": "boss_bars", "binding_name_override": "#visible"},
        ],
    }
    out = {"namespace": "hud", "boss_health_panel": vanilla_panel}
    for k in BARS:
        out[f"{k}_boss_bar"] = bar(k)
    return out


def main():
    tex = os.path.join(RP, "textures", "ui")
    os.makedirs(tex, exist_ok=True)
    for k, (fr, fi) in DRAW.items():
        Image.fromarray(fr(), "RGBA").save(os.path.join(tex, f"{k}_boss_frame.png"))
        Image.fromarray(fi(), "RGBA").save(os.path.join(tex, f"{k}_boss_fill.png"))
    os.makedirs(os.path.join(RP, "ui"), exist_ok=True)
    with open(os.path.join(RP, "ui", "hud_screen.json"), "w", encoding="utf-8") as f:
        json.dump(hud(), f, indent=2)
        f.write("\n")
    for k, b in BARS.items():
        print(f"{k}'s boss bar: frame {W}x{H}, fill {FILL_SIZE[0]}x{FILL_SIZE[1]}, shown for a title containing {b['words']}")


if __name__ == "__main__":
    main()
