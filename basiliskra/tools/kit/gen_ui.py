#!/usr/bin/env python3
"""
His own health bar at the top of the screen (2.2).

The bar itself is the game's boss bar: his entity carries `minecraft:boss` from the start, as the Wither and the Ender
Dragon do, so the game shows it to everyone near him and keeps it filled with his health.  This file draws it in his
own colours: a resource-pack copy of the game's `hud.boss_health_panel` (the 1.26.60 definition, unchanged) with one
more control in it, which is shown only for a boss bar titled with his name ("Basiliskra", "Basiliskra I" .. "IV") and
covers the game's bar with his: a charcoal frame with crimson plates and his pale eyes, his name, and a crimson fill.
Any other boss bar (the Wither's, Vathrok's, another add-on's) is left as the game draws it.  If this file were ever
not read, his bar would still be there, in the game's own colours.

Every construct used is one the game's own UI files use (the visibility test is the one in server_form.json: a
collection binding, then a view binding comparing it with strings).

    python3 tools/kit/gen_ui.py
"""
from __future__ import annotations

import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RP = os.path.join(ROOT, "packs", "RP")
ROMAN = ["I", "II", "III", "IV"]
# what the boss bar is titled: the name the script gives him in each form (controller.ts nameHim), or, if the game
# titles a boss by its type's name instead, that
NAMES = ["Basiliskra"] + [f"Basiliskra {r}" for r in ROMAN]
W, H = 182, 20                              # the game's boss bar entry is 182 x 20
FILL_AT, FILL_SIZE = (6, 12), (170, 6)

C = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def frame() -> np.ndarray:
    a = np.zeros((H, W, 4), np.uint8)
    a[:, :] = C("#130a0c")                                          # opaque: it covers the game's bar under it
    a[0, :] = a[-1, :] = a[:, 0] = a[:, -1] = C("#3b060b")           # outer edge
    a[1, 1:-1] = a[-2, 1:-1] = C("#7d111a")                          # crimson rim
    a[1:-1, 1] = a[1:-1, -2] = C("#7d111a")
    a[2:10, 24:W - 24] = C("#1c0e0f")                               # the name plate, a shade lighter
    # the slot the fill runs in: a dark recess with a lit lower lip
    x0, y0 = FILL_AT[0] - 1, FILL_AT[1] - 1
    a[y0:y0 + FILL_SIZE[1] + 2, x0:x0 + FILL_SIZE[0] + 2] = C("#2a0508")
    a[y0 + 1:y0 + FILL_SIZE[1] + 1, x0 + 1:x0 + FILL_SIZE[0] + 1] = C("#070304")
    a[y0 + FILL_SIZE[1] + 1, x0:x0 + FILL_SIZE[0] + 2] = C("#5a0a11")
    # a crimson plate in each top corner, raked back like his
    for side in (0, 1):
        for k in range(7):
            for y in range(2 + k // 2, 9):
                x = 3 + k if side == 0 else W - 4 - k
                a[y, x] = C("#c01a22") if y < 4 + k // 2 else C("#7a0d14")
    # his pale eyes beside the name plate
    for cx in (17, W - 18):
        for dy in range(-2, 3):
            for dx in range(-3, 4):
                r = (dx * dx) / 9 + (dy * dy) / 4
                if r <= 1.0:
                    a[6 + dy, cx + dx] = C("#e9dfc4") if r < 0.55 else C("#a3141c")
        a[6, cx] = a[5, cx] = C("#0b0607")                          # the pupil
    return a


def fill() -> np.ndarray:
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


# The game's boss bar entry (hud_screen.json, 1.26.60), copied unchanged, with his bar added as a third control.
def hud() -> dict:
    test = " or ".join(f"(#bossName = '{n}')" for n in NAMES)
    vanilla_panel = {
        "type": "panel",
        "size": [182, 20],
        "anchor_from": "top_middle",
        "anchor_to": "top_middle",
        "$progress_bar_collection": "boss_bars",
        "controls": [
            {"boss_name@boss_name_panel": {}},
            {"progress_bar_for_collections@common.progress_bar_for_collections": {"offset": [0, 10]}},
            {"basiliskra_boss_bar@hud.basiliskra_boss_bar": {}},
        ],
        "bindings": [
            {"binding_name": "#bar_visible", "binding_type": "collection", "binding_collection_name": "boss_bars", "binding_name_override": "#visible"},
        ],
    }
    bar = {
        "type": "panel",
        "size": [W, H],
        "anchor_from": "top_middle",
        "anchor_to": "top_middle",
        "layer": 50,
        "controls": [
            {"basiliskra_frame": {"type": "image", "texture": "textures/ui/basiliskra_boss_frame", "size": [W, H], "layer": 1}},
            {"basiliskra_fill": {
                "type": "image", "texture": "textures/ui/basiliskra_boss_fill", "size": list(FILL_SIZE),
                "anchor_from": "top_left", "anchor_to": "top_left", "offset": list(FILL_AT), "layer": 2,
                "clip_direction": "left", "clip_pixelperfect": False,
                "bindings": [{"binding_name": "#progress_percentage", "binding_name_override": "#clip_ratio",
                              "binding_type": "collection", "binding_collection_name": "boss_bars"}]}},
            {"basiliskra_name": {
                "type": "label", "text": "#bossName", "color": [1.0, 0.8, 0.64], "shadow": True, "enable_profanity_filter": True,
                "anchor_from": "top_middle", "anchor_to": "top_middle", "offset": [0, 2], "layer": 3,
                "bindings": [{"binding_name": "#bossName", "binding_type": "collection", "binding_collection_name": "boss_bars"}]}},
        ],
        "bindings": [
            {"binding_name": "#bossName", "binding_type": "collection", "binding_collection_name": "boss_bars"},
            {"binding_type": "view", "source_property_name": f"({test})", "target_property_name": "#visible"},
        ],
    }
    return {"namespace": "hud", "boss_health_panel": vanilla_panel, "basiliskra_boss_bar": bar}


def main():
    tex = os.path.join(RP, "textures", "ui")
    os.makedirs(tex, exist_ok=True)
    Image.fromarray(frame(), "RGBA").save(os.path.join(tex, "basiliskra_boss_frame.png"))
    Image.fromarray(fill(), "RGBA").save(os.path.join(tex, "basiliskra_boss_fill.png"))
    os.makedirs(os.path.join(RP, "ui"), exist_ok=True)
    with open(os.path.join(RP, "ui", "hud_screen.json"), "w", encoding="utf-8") as f:
        json.dump(hud(), f, indent=2)
        f.write("\n")
    print(f"his boss bar: frame {W}x{H}, fill {FILL_SIZE[0]}x{FILL_SIZE[1]}, shown for {NAMES}")


if __name__ == "__main__":
    main()
