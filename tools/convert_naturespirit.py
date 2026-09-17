#!/usr/bin/env python3
"""Append the Nature's Spirit biomes to game/data/biomes.json and to Earth's biome list.

Pipeline order (matters!):
    tools/convert_dmz_data.py  ->  tools/convert_dmz_data_b.py  ->  tools/convert_naturespirit.py

The DMZ converters rewrite data/biomes.json and data/planets.json from scratch, so this
script must run last. It is idempotent and keyed by biome id: existing entries with the same
id are updated in place, new ones are appended, and Earth's `biomes` list keeps its original
24 entries (with their quest_tags) followed by the Nature's Spirit ones.

Source data: the Nature's Spirit mod jar (temperature, downfall and the biome colours are
summarised in game/docs/briefs/naturespirit_biomes.txt, which this script parses). Everything
else - which of our blocks a biome is made of, which trees and plants it grows, which mobs
live there, how common it is and at which elevation band it may appear - is the mapping table
below, written for this game (all blocks must exist in blocks.json, which is full at 256).

Usage:  python3 tools/convert_naturespirit.py [--check]
"""

import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(REPO, "game")
BIOMES = os.path.join(GAME, "data", "biomes.json")
PLANETS = os.path.join(GAME, "data", "planets.json")
BLOCKS = os.path.join(GAME, "data", "blocks.json")
SUMMARY = os.path.join(GAME, "docs", "briefs", "naturespirit_biomes.txt")

# Mob presets reused from the existing Earth biomes (entities.json ids).
MOBS = {
    "temperate": [
        {"entity": "sabertooth", "weight": 18, "min": 1, "max": 3},
        {"entity": "bandit", "weight": 12, "min": 1, "max": 3},
    ],
    "cold": [
        {"entity": "dino1", "weight": 22, "min": 1, "max": 2},
        {"entity": "dino2", "weight": 18, "min": 1, "max": 2},
        {"entity": "dinokid", "weight": 10, "min": 1, "max": 3},
    ],
    "hot": [
        {"entity": "bandit", "weight": 14, "min": 1, "max": 3},
        {"entity": "dino3", "weight": 14, "min": 1, "max": 2},
    ],
    "patrol": [
        {"entity": "red_ribbon_soldier", "weight": 45, "min": 2, "max": 4},
        {"entity": "robot1", "weight": 10, "min": 1, "max": 2},
    ],
    "none": [],
}

# Plant presets (block id, density per position).
P_GRASS = [("short_grass", 0.16), ("tall_grass", 0.03)]
P_FIELD = [("short_grass", 0.20), ("tall_grass", 0.05), ("oxeye_daisy", 0.012), ("cornflower", 0.01)]
P_DRY = [("dead_bush", 0.03), ("short_grass", 0.02)]
P_DUNE = [("dead_bush", 0.035), ("cactus", 0.01)]
P_FERN = [("fern", 0.08), ("short_grass", 0.12), ("large_fern", 0.02)]
P_SNOW = [("snow_layer", 0.4), ("short_grass", 0.02)]

# id: (elevation, surface, filler, underwater, trees, plants, mobs, weight, cliff block)
#   elevation: low | mid | high | peak | any  (which height band the biome may occupy)
#   trees: list of (tree type understood by scripts/worldgen/Trees.gd, density)
NS = {
    # --- cold / mountain -----------------------------------------------------
    "alpine_clearings": ("high", "grass_block", "dirt", "gravel",
                         [("fir", 0.004)], P_FIELD + [("allium", 0.01)], "cold", 6, "stone"),
    "alpine_highlands": ("high", "grass_block", "stone", "gravel",
                         [("fir", 0.012)], P_GRASS + [("azure_bluet", 0.01)], "cold", 7, "stone"),
    "sleeted_slopes": ("peak", "snow_block", "stone", "gravel",
                       [], [("snow_layer", 0.5)], "none", 5, "stone"),
    "snowcapped_red_peaks": ("peak", "snow_block", "red_terracotta", "gravel",
                             [], [("snow_layer", 0.45)], "none", 5, "red_terracotta"),
    "red_peaks": ("high", "red_sand", "red_terracotta", "red_sand",
                  [], [("dead_bush", 0.02)], "hot", 6, "red_terracotta"),
    "white_cliffs": ("high", "grass_block", "white_terracotta", "sand",
                     [("cypress", 0.01)], P_GRASS, "temperate", 5, "quartz_block"),
    "tundra": ("mid", "snowy_grass_block", "dirt", "gravel",
               [("fir", 0.006)], P_SNOW, "cold", 6, "stone"),
    "boreal_taiga": ("mid", "snowy_grass_block", "dirt", "gravel",
                     [("fir", 0.05)], P_SNOW + [("fern", 0.04)], "cold", 7, "stone"),
    "snowy_fir_forest": ("mid", "snowy_grass_block", "dirt", "gravel",
                         [("snowy_fir", 0.07)], [("snow_layer", 0.4), ("fern", 0.03)], "cold", 7, "stone"),
    "snowy_redwood_forest": ("mid", "snowy_grass_block", "podzol", "gravel",
                             [("frosty_redwood", 0.02)], [("snow_layer", 0.35), ("fern", 0.05)], "cold", 6, "stone"),
    "fir_forest": ("mid", "grass_block", "dirt", "gravel",
                   [("fir", 0.08)], P_FERN, "cold", 8, "stone"),
    "coniferous_covert": ("high", "grass_block", "dirt", "gravel",
                          [("fir", 0.05), ("cypress", 0.01)], P_FERN, "cold", 6, "stone"),
    "prairie": ("mid", "grass_block", "dirt", "sand",
                [("fir", 0.002)], P_FIELD, "temperate", 8, "stone"),
    # --- temperate forests ---------------------------------------------------
    "redwood_forest": ("mid", "grass_block", "podzol", "gravel",
                       [("redwood", 0.025), ("fir", 0.01)], P_FERN + [("brown_mushroom", 0.004)], "temperate", 8, "stone"),
    "maple_woodlands": ("mid", "grass_block", "dirt", "sand",
                        [("maple", 0.05), ("orange_maple", 0.03)], P_FIELD, "temperate", 8, "granite_cliff"),
    "marigold_meadows": ("mid", "grass_block", "dirt", "sand",
                         [("maple", 0.012)], P_FIELD + [("dandelion", 0.05), ("orange_tulip", 0.02)], "temperate", 6, "stone"),
    "golden_wilds": ("mid", "grass_block", "dirt", "sand",
                     [("aspen", 0.03), ("orange_maple", 0.01)], P_FIELD + [("dandelion", 0.03)], "temperate", 6, "stone"),
    "aspen_forest": ("mid", "grass_block", "dirt", "sand",
                     [("aspen", 0.08)], P_FIELD + [("fern", 0.04)], "temperate", 8, "stone"),
    "wisteria_forest": ("mid", "grass_block", "dirt", "sand",
                        [("wisteria", 0.05), ("pink_wisteria", 0.03)], P_FIELD + [("allium", 0.02)], "temperate", 7, "white_terracotta"),
    "floral_ridges": ("high", "grass_block", "dirt", "sand",
                      [("wisteria", 0.015)], P_FIELD + [("rose_bush", 0.02), ("lilac", 0.02)], "temperate", 5, "white_terracotta"),
    "sugi_forest": ("mid", "grass_block", "dirt", "sand",
                    [("sugi", 0.06)], P_FERN + [("red_tulip", 0.01)], "temperate", 7, "stone"),
    "windswept_sugi_forest": ("high", "grass_block", "stone", "gravel",
                              [("sugi", 0.025)], P_GRASS, "temperate", 5, "stone"),
    "cypress_fields": ("mid", "grass_block", "dirt", "sand",
                       [("cypress", 0.03)], P_FIELD, "temperate", 6, "stone"),
    "lavender_fields": ("mid", "grass_block", "dirt", "sand",
                        [("cypress", 0.006)], [("lavender", 0.30), ("short_grass", 0.10)], "temperate", 6, "stone"),
    "carnation_fields": ("mid", "grass_block", "dirt", "sand",
                         [("cypress", 0.006)], [("poppy", 0.12), ("red_tulip", 0.06), ("short_grass", 0.12)], "temperate", 5, "stone"),
    "heather_fields": ("high", "grass_block", "dirt", "gravel",
                       [("fir", 0.004)], [("allium", 0.10), ("short_grass", 0.14), ("azure_bluet", 0.03)], "temperate", 6, "stone"),
    "cedar_thicket": ("mid", "grass_block", "coarse_dirt", "sand",
                      [("cypress", 0.05), ("fir", 0.02)], P_GRASS + [("dead_bush", 0.01)], "temperate", 5, "stone"),
    "woody_highlands": ("high", "grass_block", "coarse_dirt", "gravel",
                        [("aspen", 0.02), ("cypress", 0.01)], P_GRASS, "temperate", 5, "stone"),
    # --- wetlands ------------------------------------------------------------
    "marsh": ("low", "grass_block", "clay", "clay",
              [("willow", 0.03)], [("short_grass", 0.16), ("lily_pad", 0.06), ("sugar_cane", 0.03),
                                   ("blue_orchid", 0.01), ("brown_mushroom", 0.008)], "temperate", 6, "stone"),
    "bamboo_wetlands": ("low", "grass_block", "dirt", "clay",
                        [("sugi", 0.01)], [("sugar_cane", 0.10), ("tall_grass", 0.10), ("short_grass", 0.14),
                                           ("lily_pad", 0.04)], "temperate", 5, "terracotta"),
    "tropical_basin": ("low", "grass_block", "dirt", "clay",
                       [("palm", 0.02), ("jungle", 0.03)], [("short_grass", 0.22), ("fern", 0.08),
                                                            ("lily_pad", 0.04), ("melon", 0.004)], "hot", 5, "stone"),
    # --- tropical ------------------------------------------------------------
    "tropical_woods": ("mid", "grass_block", "dirt", "sand",
                       [("jungle", 0.06), ("palm", 0.02)], [("short_grass", 0.22), ("fern", 0.1),
                                                            ("large_fern", 0.03), ("vine", 0.05)], "hot", 6, "stone"),
    "sparse_tropical_woods": ("mid", "grass_block", "dirt", "sand",
                              [("palm", 0.012), ("acacia", 0.01)], [("short_grass", 0.2), ("fern", 0.06)], "hot", 5, "stone"),
    "tropical_shores": ("low", "sand", "sand", "sand",
                        [("palm", 0.03)], [("short_grass", 0.04), ("dead_bush", 0.004)], "none", 6, "sandstone"),
    # --- savanna / shrub -----------------------------------------------------
    "oak_savanna": ("mid", "grass_block", "dirt", "sand",
                    [("acacia", 0.015), ("oak", 0.008)], [("short_grass", 0.22), ("tall_grass", 0.05)], "hot", 7, "stone"),
    "arid_savanna": ("mid", "grass_block", "coarse_dirt", "sand",
                     [("acacia", 0.012), ("joshua", 0.004)], [("short_grass", 0.16), ("dead_bush", 0.02),
                                                              ("cactus", 0.004)], "hot", 6, "sandstone"),
    "chaparral": ("mid", "grass_block", "coarse_dirt", "sand",
                  [("oak", 0.01), ("fir", 0.004)], [("short_grass", 0.14), ("dead_bush", 0.02)], "hot", 6, "stone"),
    "shrubland": ("mid", "grass_block", "coarse_dirt", "sand",
                  [("acacia", 0.008)], [("short_grass", 0.16), ("dead_bush", 0.015),
                                        ("orange_tulip", 0.01)], "hot", 6, "white_terracotta"),
    "xeric_plains": ("mid", "coarse_dirt", "sandstone", "sand",
                     [("cypress", 0.008), ("joshua", 0.004)], [("dead_bush", 0.03), ("short_grass", 0.06)], "hot", 5, "white_terracotta"),
    # --- deserts / drylands --------------------------------------------------
    "drylands": ("mid", "sand", "sandstone", "sand",
                 [("joshua", 0.004)], P_DUNE, "hot", 7, "sandstone"),
    "wooded_drylands": ("mid", "sand", "sandstone", "sand",
                        [("joshua", 0.012), ("acacia", 0.006)], [("dead_bush", 0.03), ("short_grass", 0.05)], "hot", 6, "sandstone"),
    "lively_dunes": ("mid", "sand", "sandstone", "sand",
                     [("joshua", 0.02)], P_DUNE + [("short_grass", 0.03)], "hot", 6, "sandstone"),
    "blooming_dunes": ("mid", "sand", "sandstone", "sand",
                       [("joshua", 0.014)], [("dead_bush", 0.02), ("orange_tulip", 0.02),
                                             ("cactus", 0.008)], "hot", 5, "sandstone"),
    "scorched_dunes": ("mid", "red_sand", "red_terracotta", "red_sand",
                       [], [("dead_bush", 0.04), ("cactus", 0.006)], "hot", 6, "red_terracotta"),
    "stratified_desert": ("mid", "sand", "orange_terracotta", "sand",
                          [("joshua", 0.006)], [("dead_bush", 0.025), ("cactus", 0.008)], "hot", 7, "terracotta"),
    "dusty_slopes": ("high", "coarse_dirt", "yellow_terracotta", "sand",
                     [], [("dead_bush", 0.02)], "hot", 5, "yellow_terracotta"),
}

# Biomes whose body is banded terracotta (mesa look) and how deep the banding goes.
BANDED = {"stratified_desert": 22, "red_peaks": 20, "snowcapped_red_peaks": 20, "dusty_slopes": 18}


def parse_summary(path):
    """id -> {temperature, humidity, grass, foliage, sky, fog, water} from the NS summary."""
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8"):
        m = re.match(r"^(\w+) temp=([\d.\-]+) down=([\d.\-]+) grass=(\S+) foliage=(\S+) "
                     r"sky=(\S+) fog=(\S+) water=(\S+)", line.strip())
        if not m:
            continue
        bid, temp, down, grass, foliage, sky, fog, water = m.groups()
        out[bid] = {
            "temperature": float(temp),
            "humidity": float(down),
            "grass_color": None if grass == "None" else grass,
            "foliage_color": None if foliage == "None" else foliage,
            "sky_tint": sky,
            "fog_color": fog,
            "water_color": water,
        }
    return out


def default_colors(temp, humid):
    """Vanilla-ish grass/foliage colour for biomes whose JSON has no explicit one."""
    t = max(0.0, min(1.0, temp / 2.0))
    d = max(0.0, min(1.0, humid))
    r = int(191 - 100 * d + 30 * t)
    g = int(183 + 30 * d - 10 * t)
    b = int(85 + 20 * d - 20 * t)
    fr, fg, fb = int(r * 0.92), int(g * 0.95), int(b * 0.8)
    return "#%02X%02X%02X" % (r, g, b), "#%02X%02X%02X" % (fr, fg, fb)


def build_entries(summary, known_blocks):
    entries = []
    problems = []
    for bid, (elev, surface, filler, under, trees, plants, mobs, weight, cliff) in NS.items():
        info = summary.get(bid, {})
        temp = info.get("temperature", 0.8)
        humid = info.get("humidity", 0.4)
        grass = info.get("grass_color")
        foliage = info.get("foliage_color")
        if not grass or not foliage:
            g, f = default_colors(temp, humid)
            grass = grass or g
            foliage = foliage or f
        entry = {
            "id": bid,
            "name": bid.replace("_", " ").title(),
            "planet": "earth",
            "temperature": temp,
            "humidity": humid,
            "grass_color": grass,
            "foliage_color": foliage,
            "water_color": info.get("water_color", "#3F76E4"),
            "sky_tint": info.get("sky_tint", "#78A7FF"),
            "fog_color": info.get("fog_color", "#C0D8FF"),
            "water_fog_color": "#050533",
            "surface": surface,
            "filler": filler,
            "underwater": under,
            "trees": [{"type": t, "density": d} for t, d in trees],
            "plants": [{"block": b, "density": d} for b, d in plants],
            "mobs": MOBS[mobs],
            "quest_tag": "natures_spirit:" + bid,
            "weight": weight,
            "elevation": elev,
            "cliff": cliff if cliff in known_blocks else "stone",
        }
        if bid in BANDED:
            entry["band_depth"] = BANDED[bid]
        for key in ("surface", "filler", "underwater"):
            if entry[key] not in known_blocks:
                problems.append("%s.%s unknown block %s" % (bid, key, entry[key]))
        for p in entry["plants"]:
            if p["block"] not in known_blocks:
                problems.append("%s plant unknown block %s" % (bid, p["block"]))
        entries.append(entry)
    return entries, problems


def main():
    check = "--check" in sys.argv
    known = {b["id"] for b in json.load(open(BLOCKS))["blocks"]}
    summary = parse_summary(SUMMARY)
    entries, problems = build_entries(summary, known)
    if problems:
        print("\n".join("ERROR " + p for p in problems))
        return 1
    data = json.load(open(BIOMES))
    biomes = data["biomes"]
    by_id = {b["id"]: i for i, b in enumerate(biomes)}
    added = updated = 0
    for e in entries:
        if e["id"] in by_id:
            biomes[by_id[e["id"]]] = e
            updated += 1
        else:
            biomes.append(e)
            added += 1
    planets = json.load(open(PLANETS))
    earth = next(p for p in planets["planets"] if p["id"] == "earth")
    for e in entries:
        if e["id"] not in earth["biomes"]:
            earth["biomes"].append(e["id"])
    if check:
        print("check: %d NS biomes, %d would be added, %d updated, %d earth biomes"
              % (len(entries), added, updated, len(earth["biomes"])))
        return 0
    json.dump(data, open(BIOMES, "w"), indent=1)
    json.dump(planets, open(PLANETS, "w"), indent=1)
    print("natures spirit: %d biomes (%d new, %d updated); earth now has %d biomes"
          % (len(entries), added, updated, len(earth["biomes"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
