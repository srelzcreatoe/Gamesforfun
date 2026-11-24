#!/usr/bin/env python3
"""The Eyebloom follows you (1.7.0): its head — the eye and its petals — turned to any of 16 headings and 3 tilts (level,
up, down), so its eye can follow every move you make. A block can only be turned in quarter turns, so the turning is
done inside its model: 48 variants of its geometry, the head turned on a pivot in its middle, the stem left standing.

  RP models/blocks/eyebloom.geo.json   the base geometry (kept) and geometry.wmire.eyebloom_<heading>_<tilt>
  BP blocks/eyebloom.json              states wmire:aimed (false = as placed: its cardinal facing, as before), wmire:aim
                                       (a heading, 0-15) and wmire:tilt (0 level, 1 up, 2 down); a permutation picks the
                                       geometry (a block state holds at most 16 values, hence the flag)

scripts/mire/eyebloom.js turns them (every few ticks, toward the nearest player, in the Rift and the Mire).
Usage: python3 tools/eyebloom_aim.py
"""
import copy
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, "packs", "TheObserver_RP", "models", "blocks", "eyebloom.geo.json")
BLOCK = os.path.join(ROOT, "packs", "TheObserver_BP", "blocks", "eyebloom.json")
# Heading k looks k*22.5 degrees clockwise from north, seen from above (north, then east at 4, south at 8, west at 12):
# a positive y rotation in a geometry file turns it that way (the opposite of minecraft:transformation's).
HEADINGS = 16
TILTS = (0, -28, 28)        # level, up, down (a negative x rotation lifts a north-facing face)
PIVOT = [0, 8, 0]


def variants(base):
    """base: the original geometry (one bone: the stalk cube first, then the petals and the eye)."""
    bone = base["bones"][0]
    stalk, head = bone["cubes"][:1], bone["cubes"][1:]
    out = []
    for k in range(HEADINGS):
        for t, tilt in enumerate(TILTS):
            # turned first (about y), then tilted in its own frame (the child bone's x), so the two never mix up
            g = {"description": dict(base["description"], identifier=f"geometry.wmire.eyebloom_{k}_{t}"),
                 "bones": [{"name": "stem", "pivot": [0, 0, 0], "cubes": copy.deepcopy(stalk)},
                           {"name": "turn", "parent": "stem", "pivot": PIVOT, "rotation": [0, k * 360 / HEADINGS, 0]},
                           {"name": "head", "parent": "turn", "pivot": PIVOT, "rotation": [tilt, 0, 0],
                            "cubes": copy.deepcopy(head)}]}
            out.append(g)
    return out


def main():
    geo = json.load(open(GEO))
    base = [g for g in geo["minecraft:geometry"] if g["description"]["identifier"] == "geometry.wmire.eyebloom"][0]
    geo["minecraft:geometry"] = [base] + variants(base)
    with open(GEO, "w") as f:
        json.dump(geo, f, indent=1)
        f.write("\n")
    blk = json.load(open(BLOCK))
    b = blk["minecraft:block"]
    b["description"]["states"] = {"wmire:shut": [False, True], "wmire:aimed": [False, True], "wmire:aim": list(range(HEADINGS)),
                                  "wmire:tilt": [0, 1, 2]}
    perms = [p for p in b.get("permutations", []) if "cardinal_direction" not in p["condition"] and "wmire:aim" not in p["condition"]]
    cardinal = []
    for d, r in (("north", 0), ("west", 90), ("south", 180), ("east", -90)):
        cardinal.append({"condition": f"!q.block_state('wmire:aimed') && q.block_state('minecraft:cardinal_direction') == '{d}'",
                         "components": {"minecraft:transformation": {"rotation": [0, r, 0]}}})
    aimed = []
    for k in range(HEADINGS):
        for t in range(len(TILTS)):
            aimed.append({"condition": f"q.block_state('wmire:aimed') && q.block_state('wmire:aim') == {k} && q.block_state('wmire:tilt') == {t}",
                          "components": {"minecraft:geometry": f"geometry.wmire.eyebloom_{k}_{t}"}})
    b["permutations"] = cardinal + aimed + perms
    with open(BLOCK, "w") as f:
        json.dump(blk, f, indent=2)
        f.write("\n")
    print(f"eyebloom: {len(geo['minecraft:geometry'])} geometries, {len(b['permutations'])} permutations")


if __name__ == "__main__":
    main()
