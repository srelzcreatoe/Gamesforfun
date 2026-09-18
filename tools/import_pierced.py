#!/usr/bin/env python3
"""Merge the "Pierced Animations - Serious Player Animations" resource pack (user-supplied) into
game/assets/animations/spa/player.animation.json under the `spa.` prefix, replacing same-named
clips. DragonMineZ clips are never touched: the state table (scripts/entity/AnimSelect.gd) still
picks a DMZ clip first and only falls back to `spa.*` for states DMZ does not animate.
Usage: tools/import_pierced.py [<extracted pack dir>]"""
import json, os, sys, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "game", "assets", "animations", "spa", "player.animation.json")
SRC = sys.argv[1] if len(sys.argv) > 1 else \
    "/tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/ex/pierced"
files = sorted(glob.glob(os.path.join(SRC, "assets", "seriousplayeranimations", "player_animation", "*.json")))
dst = json.load(open(DST))
anims = dst.setdefault("animations", {})
replaced, added = [], []
for f in files:
    d = json.load(open(f))
    for name, clip in d.get("animations", {}).items():
        key = "spa." + name
        (replaced if key in anims else added).append(key)
        anims[key] = clip
json.dump(dst, open(DST, "w"), indent=1)
print(f"pierced clips: {len(files)} files -> replaced {replaced} added {added}; total spa clips {len(anims)}")
