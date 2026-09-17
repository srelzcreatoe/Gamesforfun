#!/usr/bin/env python3
"""Data conversion, part B: world content (items, recipes, biomes, planets, structures).

Pipeline order: convert_dmz_data.py -> convert_dmz_data_b.py -> convert_naturespirit.py
(the Nature's Spirit converter appends its biomes to data/biomes.json and to Earth's
biome list afterwards, so it must run last).

Reads the extracted DragonMineZ 2.1.3 mod (GPL-3.0), DMZ Plus 1.1.6 and the Fused
resource packs and writes these registries into game/data/ (schema:
game/docs/DATA_SCHEMA.md):

  items.json  recipes.json  biomes.json  planets.json  structures.json
  ../assets/structures/<name>.json   (converted / procedural structure volumes)

blocks.json is the FIXED block registry and is never written by this tool; every
block reference produced here is validated against it.  Deterministic and
re-runnable: every substitution (icon fallback, remapped Minecraft block or item,
skipped recipe) is printed at the end.

Usage: python3 tools/convert_dmz_data_b.py [--src DIR] [--game DIR] [--quiet]
"""
import argparse
import collections
import glob
import gzip
import json
import math
import os
import re
import struct
import sys
from collections import OrderedDict, deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = "/tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/ex"

ap = argparse.ArgumentParser()
ap.add_argument("--src", default=DEFAULT_SRC)
ap.add_argument("--game", default=os.path.join(ROOT, "game"))
ap.add_argument("--quiet", action="store_true")
ARGS = ap.parse_args()

SRC = ARGS.src
GAME = ARGS.game
DMZ = os.path.join(SRC, "dmz")
DMZP = os.path.join(SRC, "dmzplus")
DMZ_DATA = os.path.join(DMZ, "data", "dragonminez")
DMZ_ASSETS = os.path.join(DMZ, "assets", "dragonminez")
DMZP_DATA = os.path.join(DMZP, "data", "dmzplus")
DMZP_ASSETS = os.path.join(DMZP, "assets", "dmzplus")
ASSETS = os.path.join(GAME, "assets")
DATA = os.path.join(GAME, "data")
ITEM_TEX = os.path.join(ASSETS, "textures", "items")
ARMOR_TEX = os.path.join(ASSETS, "textures", "armor")
ENV_TEX = os.path.join(ASSETS, "textures", "environment")
STRUCT_OUT = os.path.join(ASSETS, "structures")

SUBST = []
SKIPPED = []
COUNTS = OrderedDict()


def log(msg):
    if not ARGS.quiet:
        print(msg)


def subst(msg):
    SUBST.append(msg)


def jload(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def jsave(rel, data, compact=False):
    path = os.path.join(DATA, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        if compact:
            json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
        else:
            json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    return path


def title_case(s):
    return " ".join(w.capitalize() for w in re.split(r"[_\s]+", s) if w)


# ---------------------------------------------------------------- blocks (read only)
BLOCKS = jload(os.path.join(DATA, "blocks.json"))["blocks"]
BLOCK_IDS = [b["id"] for b in BLOCKS]
BLOCK_SET = set(BLOCK_IDS)
BLOCK_BY_ID = {b["id"]: b for b in BLOCKS}


def blk(bid):
    """Assert a block id exists (blocks.json is fixed)."""
    if bid not in BLOCK_SET:
        raise SystemExit("BUG: unknown block id %r" % bid)
    return bid


# ---------------------------------------------------------------- lang
LANG = jload(os.path.join(DMZ_ASSETS, "lang", "en_us.json"))
try:
    LANG_PLUS = jload(os.path.join(DMZP_ASSETS, "lang", "en_us.json"))
except Exception:
    LANG_PLUS = {}
STRIP_FMT = re.compile(r"§.")


def clean(s):
    return STRIP_FMT.sub("", s).strip()


def lang(key, default=None):
    v = LANG.get(key, LANG_PLUS.get(key))
    return clean(v) if isinstance(v, str) else default


# ---------------------------------------------------------------- icons
ICON_BY_BASE = {}   # "goku_armor_chestplate" -> "armors/goku_armor_chestplate"
ICON_PATHS = set()
for _root, _dirs, _files in os.walk(ITEM_TEX):
    for _f in sorted(_files):
        if _f.endswith(".png"):
            rel = os.path.relpath(os.path.join(_root, _f), ITEM_TEX)[:-4].replace(os.sep, "/")
            ICON_PATHS.add(rel)
            ICON_BY_BASE.setdefault(os.path.basename(rel), rel)

ARMOR_LAYERS = sorted(set(
    re.sub(r"_layer_?[12]$", "", f[:-4])
    for f in os.listdir(ARMOR_TEX) if f.endswith(".png") and "_layer" in f))
ARMOR_LAYER_SET = set(ARMOR_LAYERS)

ENV_TEXTURES = set(f[:-4] for f in os.listdir(ENV_TEX) if f.endswith(".png"))

BGM = sorted(f[:-4] for f in os.listdir(os.path.join(ASSETS, "audio", "bgm")) if f.endswith(".ogg"))
BGM_SET = set(BGM)


def icon_for(item_id, fallback=None):
    if item_id in ICON_BY_BASE:
        return ICON_BY_BASE[item_id]
    if fallback and fallback in ICON_BY_BASE:
        subst("icon: %s -> %s (no own icon)" % (item_id, fallback))
        return ICON_BY_BASE[fallback]
    return None


# ================================================================ 1. items.json
RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"]

# defense per slot, indexed by [helmet, chest, legs, boots]
ARMOR_TIERS = {
    "gi":          {"helmet": 2, "chest": 5, "legs": 4, "boots": 2, "rarity": "uncommon"},
    "saiyan":      {"helmet": 3, "chest": 7, "legs": 5, "boots": 3, "rarity": "rare"},
    "kikono":      {"helmet": 4, "chest": 8, "legs": 6, "boots": 4, "rarity": "rare"},
    "gete":        {"helmet": 5, "chest": 9, "legs": 7, "boots": 5, "rarity": "epic"},
    "strongest":   {"helmet": 6, "chest": 10, "legs": 8, "boots": 6, "rarity": "legendary"},
    "space_suit":  {"helmet": 1, "chest": 3, "legs": 2, "boots": 1, "rarity": "uncommon"},
}
SAIYAN_ARMOR = {
    "vegeta_saiyan_armor", "vegeta_namek_armor", "vegeta_z_armor", "vegeta_buu_armor",
    "vegeta_gt_armor", "king_vegeta_armor", "raditz_armor", "turles_armor",
    "bardock_dbz_armor", "bardock_super_armor", "gine_armor", "cooler_soldier_armor",
    "broly_z_armor", "broly_super_armor", "kale_armor", "caulifla_armor",
    "granola_armor", "pride_troops_armor", "hit_armor",
}
KIKONO_ARMOR = {
    "shin_armor", "kibito_armor", "whis_armor", "beerus_armor", "zamasu_armor",
    "fusion_zamasu_armor", "goku_whis_armor", "vegeta_whis_armor", "yardrat_armor",
    "dragon_clan_armor", "warrior_clan_armor", "age1000_armor",
}
GETE_ARMOR = {
    "a13_armor", "a14_armor", "a16_armor", "a17_armor", "a17_super_armor", "a18_armor",
    "a18_cell_armor", "a18_kame_armor", "a18_tournament_armor", "a20_armor",
    "gero_armor", "gamma1_armor", "gamma2_armor", "majin21_armor", "gas_armor",
}
STRONGEST_ARMOR = {
    "strongest_armor", "invencible_armor", "invencible_blue_armor", "mighty_majin_armor",
    "wonder_majin_armor", "xeno_goku_armor", "xeno_goku_patreon_armor", "vergil_armor",
    "naruke_armor", "subaru_natsuki_armor", "subaru_natsuki_arc6_armor", "thragg_armor",
}
# armor set base name -> armor texture layer base in assets/textures/armor
ARMOR_LAYER_FIX = {
    "bardock_dbz_armor": "bardock_armor",
    "bardock_super_armor": "bardockdbs_armor",
    "broly_super_armor": "broly_dbs",
    "broly_z_armor": "broly_dbz",
    "demon_gi_blue_armor": "demon_gi_gohan",
    "fusion_zamasu_armor": "fzamasu_gi",
    "gohan_super_armor": "gohan_dbs",
    "goku_kaito_armor": "goku_gi",
    "goten_super_armor": "goten_dbs",
    "great_saiyaman_armor": "saiyaman_gi",
    "pride_troops_armor": "pride_troper",
    "shin_armor": "kaioshin",
    "tien_armor": "tenshinhan_armor",
    "trunks_kid_armor": "trunks_gi",
    "trunks_super_armor": "trunks_dbs",
    "trunks_z_armor": "trunks_armor",
}
SLOT_OF = {"helmet": "head", "chestplate": "chest", "leggings": "legs", "boots": "feet"}
DEF_KEY = {"helmet": "helmet", "chestplate": "chest", "leggings": "legs", "boots": "boots"}

FOOD = {
    "senzu_bean":            {"hunger": 20, "heal": 999, "ki": 999, "stamina": 999, "instant": True},
    "might_tree_fruit":      {"hunger": 10, "heal": 40, "ki": 250, "stamina": 250, "instant": True},
    "heart_medicine":        {"hunger": 2, "heal": 60, "ki": 0, "stamina": 0, "instant": True, "cures": True},
    "raw_dino_meat":         {"hunger": 3, "heal": 0},
    "cooked_dino_meat":      {"hunger": 8, "heal": 4},
    "raw_baby_dino_meat":    {"hunger": 2, "heal": 0},
    "cooked_baby_dino_meat": {"hunger": 5, "heal": 2},
    "dino_tail_raw":         {"hunger": 3, "heal": 0},
    "dino_tail_cooked":      {"hunger": 8, "heal": 4},
    "frog_legs_raw":         {"hunger": 2, "heal": 0},
    "frog_legs_cooked":      {"hunger": 5, "heal": 2},
    "healing_liquid_bucket": {"hunger": 0, "heal": 100, "ki": 50, "stamina": 50, "instant": True},
    "namek_water_bucket":    {"hunger": 4, "heal": 10, "stamina": 40, "instant": True},
    # vanilla
    "bread":         {"hunger": 5, "heal": 1},
    "apple":         {"hunger": 4, "heal": 1},
    "carrot":        {"hunger": 3, "heal": 1},
    "potato":        {"hunger": 1, "heal": 0},
    "baked_potato":  {"hunger": 5, "heal": 1},
    "melon_slice":   {"hunger": 2, "heal": 1},
    "egg":           {"hunger": 1, "heal": 0},
    "raw_meat":      {"hunger": 3, "heal": 0},
    "cooked_meat":   {"hunger": 8, "heal": 4},
    "beetroot":      {"hunger": 1, "heal": 1},
    "wheat":         {"hunger": 0, "heal": 0},
}
NON_FOOD_WHEAT = {"wheat"}   # crafting material, not eaten

SCOUTER_COLOR = {"red": "#E0402A", "blue": "#2A8BE0", "green": "#3FD44F", "purple": "#A055D8"}

CAPSULE_COLORS = ["blue", "green", "orange", "purple", "red", "yellow"]

# DMZ item ids that are emitted under a different id of ours, so the generic
# "everything else" pass must not emit them a second time.
RADAR_SOURCE_IDS = {"dball_radar", "namekdball_radar", "fused_dball_radar",
                    "super_dball_radar", "cereal_dball_radar"}

WEIGHTS = {
    "workout_weights":    {"mult": 1.5},
    "weight_turtle_shell": {"mult": 2.0},
    "weight_piccolo_cape": {"mult": 2.5},
}

MATERIAL_ITEMS = {
    "kikono_shard", "kikono_stick", "kikono_cloth", "kikono_string",
    "gete_scrap", "gete_ingot", "gete_smithing_template",
    "radar_piece", "t1_radar_chip", "t1_radar_cpu", "t2_radar_chip", "t2_radar_cpu",
    "ki_battery", "anti_ki_cloak", "armor_crafting_kit",
    "blank_pattern_z", "blank_pattern_super",
    "pothala_left", "pothala_right", "pothala_pair",
    "green_pothala_left", "green_pothala_right", "green_pothala_pair",
}

WEAPON_FILES = {
    "z_sword": "z_sword", "brave_sword": "brave_sword", "power_pole": "power_pole",
    "yajirobe_katana": "yajirobe_katana",
}
# weapons with no weapon_attributes file: (category, two_handed, crit_chance, crit_damage)
WEAPON_EXTRA = {
    "dimensional_sword": ("claymore", True, 0.20, 0.30),
    "trunks_sword":      ("claymore", True, 0.10, 0.15),
    "blaster_cannon":    ("blaster", True, 0.05, 0.10),
    "laser_merus":       ("laser", False, 0.10, 0.20),
}
WEAPON_RARITY = {
    "z_sword": "legendary", "dimensional_sword": "legendary", "power_pole": "epic",
    "brave_sword": "epic", "trunks_sword": "rare", "yajirobe_katana": "uncommon",
    "blaster_cannon": "rare", "laser_merus": "epic",
}

TOOL_MATS = [
    # name, tier, speed, durability, damage bonus
    ("wooden", 1, 2.0, 60, 0),
    ("stone", 2, 4.0, 130, 1),
    ("iron", 3, 6.0, 250, 2),
    ("golden", 1, 12.0, 32, 0),
    ("diamond", 4, 8.0, 1560, 3),
    ("kikono", 5, 9.0, 2000, 4),
    ("gete", 5, 12.0, 3000, 5),
]
TOOL_KINDS = ["pickaxe", "axe", "shovel", "hoe", "sword"]
TOOL_BASE_DAMAGE = {"pickaxe": 2, "axe": 5, "shovel": 1, "hoe": 1, "sword": 4}
TOOL_RARITY = {1: "common", 2: "common", 3: "uncommon", 4: "rare", 5: "epic"}

VANILLA_MATERIALS = [
    # id, name, stack, kind
    ("iron_ingot", "Iron Ingot"), ("gold_ingot", "Gold Ingot"), ("copper_ingot", "Copper Ingot"),
    ("raw_iron", "Raw Iron"), ("raw_copper", "Raw Copper"), ("raw_gold", "Raw Gold"),
    ("coal", "Coal"), ("diamond", "Diamond"), ("emerald", "Emerald"), ("redstone", "Redstone"),
    ("lapis_lazuli", "Lapis Lazuli"), ("glowstone_dust", "Glowstone Dust"),
    ("kikono_dust", "Kikono Dust"), ("stick", "Stick"), ("bone", "Bone"), ("string", "String"),
    ("leather", "Leather"), ("feather", "Feather"), ("book", "Book"), ("paper", "Paper"),
    ("bowl", "Bowl"), ("sugar", "Sugar"), ("flint", "Flint"), ("bucket", "Bucket"),
    ("water_bucket", "Water Bucket"), ("lava_bucket", "Lava Bucket"), ("snowball", "Snowball"),
    ("clay_ball", "Clay Ball"), ("wheat", "Wheat"),
]
VANILLA_SEEDS = [
    ("wheat_seeds", "Wheat Seeds"), ("beetroot_seeds", "Beetroot Seeds"),
    ("melon_seeds", "Melon Seeds"), ("pumpkin_seeds", "Pumpkin Seeds"),
]
VANILLA_FOODS = [
    ("bread", "Bread"), ("carrot", "Carrot"), ("potato", "Potato"),
    ("baked_potato", "Baked Potato"), ("melon_slice", "Melon Slice"), ("egg", "Egg"),
    ("cooked_meat", "Cooked Meat"), ("raw_meat", "Raw Meat"), ("apple", "Apple"),
    ("beetroot", "Beetroot"),
]
RARE_ITEMS = {
    "senzu_bean": "epic", "might_tree_fruit": "epic", "heart_medicine": "rare",
    "capsule": "uncommon", "hbtc_key": "legendary", "saiyan_ship": "legendary",
    "flying_nimbus": "epic", "black_nimbus": "epic", "capsule_house": "rare",
    "gete_ingot": "rare", "kikono_shard": "uncommon", "senzu_bag": "rare",
    "diamond": "rare", "emerald": "rare", "kikono_dust": "uncommon",
}

ITEMS = []
ITEM_IDS = set()


def add_item(it):
    if it["id"] in ITEM_IDS:
        return
    if it["id"] in BLOCK_SET:
        subst("item %s skipped: id collides with a block id" % it["id"])
        return
    if it.get("icon") is None:
        SKIPPED.append("item %s: no icon" % it["id"])
        return
    ITEM_IDS.add(it["id"])
    ITEMS.append(it)


def item_name(dmz_id, default=None):
    return lang("item.dragonminez." + dmz_id) or lang("item.dmzplus." + dmz_id) \
        or default or title_case(dmz_id)


def build_items():
    dmz_ids = [k[len("item.dragonminez."):] for k in LANG if k.startswith("item.dragonminez.")]
    dmz_ids = sorted(set(i for i in dmz_ids if "." not in i))

    # ---- armor (DMZ + DMZ Plus space suit)
    armor_sets = collections.OrderedDict()
    for i in dmz_ids:
        m = re.match(r"^(.*)_(helmet|chestplate|leggings|boots)$", i)
        if m:
            armor_sets.setdefault(m.group(1), []).append(m.group(2))
    armor_sets.setdefault("space_suit", ["helmet", "chestplate", "leggings", "boots"])

    def norm(s):
        return re.sub(r"[^a-z0-9]", "", s.replace("_armor", "").replace("_gi", ""))
    layer_by_norm = {norm(l): l for l in ARMOR_LAYERS}

    for base in sorted(armor_sets):
        if base in ARMOR_LAYER_FIX:
            layer = ARMOR_LAYER_FIX[base]
        elif norm(base) in layer_by_norm:
            layer = layer_by_norm[norm(base)]
        elif base == "space_suit":
            layer = "space_suit"
        else:
            layer = None
        if layer is None:
            subst("armor %s: no armor layer texture, using blank" % base)
            layer = "blank"
        if base == "space_suit":
            tier = "space_suit"
        elif base in STRONGEST_ARMOR:
            tier = "strongest"
        elif base in GETE_ARMOR:
            tier = "gete"
        elif base in KIKONO_ARMOR:
            tier = "kikono"
        elif base in SAIYAN_ARMOR:
            tier = "saiyan"
        else:
            tier = "gi"
        t = ARMOR_TIERS[tier]
        set_name = title_case(re.sub(r"_armor$", "", base))
        for piece in sorted(armor_sets[base]):
            iid = "%s_%s" % (base, piece)
            ic = icon_for(iid)
            if ic is None:
                SKIPPED.append("armor piece %s: no icon" % iid)
                continue
            armor = {
                "slot": SLOT_OF[piece], "defense": t[DEF_KEY[piece]],
                "layer": layer, "set": base,
            }
            if tier == "space_suit":
                armor["bonus"] = {"oxygen": True}
            elif tier == "strongest":
                armor["bonus"] = {"ki_regen": 0.15, "defense_mult": 1.1}
            elif tier == "kikono":
                armor["bonus"] = {"ki_regen": 0.1}
            add_item({
                "id": iid, "name": item_name(iid, "%s %s" % (set_name, title_case(piece))),
                "icon": ic, "stack": 1, "kind": "armor", "armor": armor,
                "rarity": t["rarity"],
            })

    # ---- weapons
    wattr = load_weapon_attributes()
    for wid in sorted(set(list(WEAPON_FILES) + list(WEAPON_EXTRA))):
        ic = icon_for(wid, wid + "_item")
        if ic is None:
            SKIPPED.append("weapon %s: no icon" % wid)
            continue
        if wid in wattr:
            cat, two, cc, cd, mults = wattr[wid]
        else:
            cat, two, cc, cd = WEAPON_EXTRA[wid]
            mults = [1.0]
        avg = sum(mults) / float(len(mults))
        damage = round((6.0 if two else 4.0) * avg * (1.0 + cd), 1)
        speed = round((1.0 if two else 1.6) * (1.0 + cc), 2)
        add_item({
            "id": wid, "name": item_name(wid), "icon": ic, "stack": 1, "kind": "weapon",
            "weapon": {"damage": damage, "speed": speed, "anim_set": cat,
                       "two_handed": two, "crit_chance": cc, "crit_damage": cd},
            "rarity": WEAPON_RARITY.get(wid, "rare"),
        })

    # ---- tools (vanilla + kikono/gete tiers)
    for mat, tier, speed, dur, dmg in TOOL_MATS:
        for kind in TOOL_KINDS:
            iid = "%s_%s" % (mat, kind)
            ic = icon_for(iid)
            if ic is None:
                SKIPPED.append("tool %s: no icon" % iid)
                continue
            add_item({
                "id": iid, "name": "%s %s" % (title_case(mat), title_case(kind)),
                "icon": ic, "stack": 1, "kind": "tool",
                "tool": {"type": kind, "tier": tier, "speed": float(speed),
                         "durability": dur, "damage": TOOL_BASE_DAMAGE[kind] + dmg},
                "rarity": TOOL_RARITY[tier],
            })

    # ---- scouters
    for col in sorted(SCOUTER_COLOR):
        iid = "%s_scouter" % col
        ic = icon_for(iid)
        if ic is None:
            continue
        add_item({"id": iid, "name": item_name(iid), "icon": ic, "stack": 1,
                  "kind": "scouter", "scouter": {"color": SCOUTER_COLOR[col]},
                  "rarity": "uncommon"})

    # ---- radars
    radars = [
        ("dragon_radar", "dball_radar", "earth", "Dragon Radar (Earth)", "rare"),
        ("namek_dragon_radar", "namekdball_radar", "namek", "Dragon Radar (Namek)", "rare"),
        ("fused_dragon_radar", "fused_dball_radar", "fused", "Bi-Dimensional Radar", "epic"),
        ("super_dragon_radar", "super_dball_radar", "super", "Super Dragon Radar", "legendary"),
        ("cereal_dragon_radar", "cereal_dball_radar", "cereal", "Cerealian Dragon Radar", "epic"),
    ]
    for iid, src_icon, dset, default_name, rar in radars:
        ic = icon_for(src_icon, "dball_radar")
        if ic is None:
            SKIPPED.append("radar %s: no icon" % iid)
            continue
        add_item({"id": iid, "name": item_name(src_icon, default_name), "icon": ic,
                  "stack": 1, "kind": "radar", "radar": {"set": dset}, "rarity": rar})

    # ---- dragon balls
    for star in range(1, 8):
        for dset, suffix in (("earth", ""), ("namek", "_namek")):
            iid = "dball%d%s" % (star, suffix)
            ic = icon_for(iid)
            if ic is None:
                SKIPPED.append("dragon ball %s: no icon" % iid)
                continue
            label = "Dragon Ball" if dset == "earth" else "Namekian Dragon Ball"
            add_item({"id": iid, "name": "%s (%d Star)" % (label, star), "icon": ic,
                      "stack": 1, "kind": "dragon_ball",
                      "dragon_ball": {"set": dset, "star": star}, "rarity": "legendary"})

    # ---- capsules
    add_item({"id": "capsule", "name": item_name("capsule"), "icon": icon_for("capsule"),
              "stack": 16, "kind": "capsule", "capsule": {"type": "empty"},
              "rarity": "uncommon"})
    for col in CAPSULE_COLORS:
        for prefix, kind in (("", "capsule"), ("gete_", "gete_capsule")):
            iid = "%s%s_capsule" % (prefix, col)
            ic = icon_for(iid)
            if ic is None:
                continue
            add_item({"id": iid, "name": title_case(iid), "icon": ic, "stack": 16,
                      "kind": "capsule", "capsule": {"type": kind, "color": col},
                      "rarity": "uncommon" if not prefix else "rare"})
    add_item({"id": "capsule_house", "name": "Capsule House", "icon": icon_for("capsule"),
              "stack": 1, "kind": "capsule", "capsule": {"type": "house"}, "rarity": "rare"})

    # ---- vehicles
    for iid, veh, nm in (("saiyan_ship", "space_pod", "Saiyan Space Pod"),
                         ("flying_nimbus", "nimbus", "Flying Nimbus"),
                         ("black_nimbus", "nimbus", "Black Nimbus")):
        ic = icon_for(iid)
        if ic is None:
            continue
        add_item({"id": iid, "name": item_name(iid, nm), "icon": ic, "stack": 1,
                  "kind": "vehicle", "vehicle": veh,
                  "rarity": RARE_ITEMS.get(iid, "epic")})

    # ---- weights
    for iid, w in sorted(WEIGHTS.items()):
        ic = icon_for(iid)
        if ic is None:
            continue
        add_item({"id": iid, "name": item_name(iid), "icon": ic, "stack": 1,
                  "kind": "weights", "weights": w, "rarity": "uncommon"})

    # ---- key
    add_item({"id": "hbtc_key", "name": item_name("hbtc_key", "HBTC Key"),
              "icon": icon_for("hbtc_key"), "stack": 1, "kind": "key",
              "key": {"unlocks": "time_chamber"}, "rarity": "legendary"})
    add_item({"id": "key", "name": "Key", "icon": icon_for("key"), "stack": 1,
              "kind": "key", "key": {"unlocks": "door"}, "rarity": "uncommon"})

    # ---- music discs -> bgm files
    ndisc = 0
    for n in range(1, 40):
        bgm = "menu_music-%d" % n
        if bgm not in BGM_SET:
            SKIPPED.append("music disc %d: no bgm file %s.ogg" % (n, bgm))
            continue
        nm = lang("item.dragonminez.music_disc_menu_music_%d" % n, "Music Disc %d" % n)
        desc = lang("item.dragonminez.music_disc_menu_music_%d.desc" % n, nm)
        add_item({"id": "music_disc_%d" % n, "name": nm, "desc": desc,
                  "icon": icon_for("music_disc_dmz"), "stack": 1, "kind": "music_disc",
                  "music_disc": {"bgm": bgm}, "rarity": "rare"})
        ndisc += 1
    COUNTS["music_discs"] = ndisc

    # ---- foods (DMZ)
    for iid in sorted(FOOD):
        if iid in ITEM_IDS or iid in NON_FOOD_WHEAT:
            continue
        if iid not in dmz_ids:
            continue
        ic = icon_for(iid)
        if ic is None:
            SKIPPED.append("food %s: no icon" % iid)
            continue
        add_item({"id": iid, "name": item_name(iid), "icon": ic,
                  "stack": 1 if "bucket" in iid else 16, "kind": "food",
                  "food": FOOD[iid], "rarity": RARE_ITEMS.get(iid, "common")})

    # ---- patterns (kikono station templates)
    for iid in dmz_ids:
        if not iid.startswith("pattern_"):
            continue
        ic = icon_for(iid)
        if ic is None:
            continue
        add_item({"id": iid, "name": item_name(iid), "icon": ic, "stack": 1,
                  "kind": "material", "rarity": "uncommon"})

    # ---- remaining DMZ items -> material / misc
    for iid in dmz_ids:
        if iid in ITEM_IDS or iid in RADAR_SOURCE_IDS:
            continue
        if re.search(r"_(helmet|chestplate|leggings|boots)$", iid):
            continue
        if iid.endswith("_spawn_egg") or iid.startswith("music_disc_"):
            if iid.endswith("_spawn_egg"):
                SKIPPED.append("spawn egg %s: creative-only, not ported" % iid)
            continue
        ic = icon_for(iid, "pattern_gete" if iid == "gete_smithing_template" else None)
        if ic is None:
            SKIPPED.append("dmz item %s: no icon" % iid)
            continue
        kind = "material" if iid in MATERIAL_ITEMS else "misc"
        add_item({"id": iid, "name": item_name(iid), "icon": ic,
                  "stack": 1 if iid in ("punch_machine_item",) else 64,
                  "kind": kind, "rarity": RARE_ITEMS.get(iid, "common")})

    # ---- vanilla materials / seeds / foods
    for iid, nm in VANILLA_MATERIALS:
        ic = icon_for(iid, "seeds" if iid.endswith("_seeds") else None)
        if ic is None:
            SKIPPED.append("vanilla item %s: no icon" % iid)
            continue
        add_item({"id": iid, "name": nm, "icon": ic,
                  "stack": 1 if iid.endswith("_bucket") or iid == "bucket" else 64,
                  "kind": "material", "rarity": RARE_ITEMS.get(iid, "common")})
    for iid, nm in VANILLA_SEEDS:
        ic = icon_for(iid, "seeds")
        if ic is None:
            SKIPPED.append("vanilla item %s: no icon" % iid)
            continue
        add_item({"id": iid, "name": nm, "icon": ic, "stack": 64, "kind": "material",
                  "plant": {"crop": iid.replace("_seeds", "")}, "rarity": "common"})
    for iid, nm in VANILLA_FOODS:
        ic = icon_for(iid)
        if ic is None:
            SKIPPED.append("vanilla food %s: no icon" % iid)
            continue
        add_item({"id": iid, "name": nm, "icon": ic, "stack": 64, "kind": "food",
                  "food": FOOD.get(iid, {"hunger": 2, "heal": 0}), "rarity": "common"})

    # ---- misc extras
    add_item({"id": "senzu_bag", "name": "Senzu Bag", "icon": icon_for("senzu_bag"),
              "stack": 1, "kind": "misc", "rarity": "rare"})
    build_extra_items()


# Ids referenced by part A (quest objectives/rewards, entity drops) that have no
# DragonMineZ icon of their own: kept as materials/foods with a fitting icon.
EXTRA_ITEMS = [
    ("amethyst_shard", "Amethyst Shard", "material", "lapis_lazuli", 64, "uncommon", {}),
    ("blaze_rod", "Blaze Rod", "material", "stick", 64, "uncommon", {}),
    ("broken_scouter", "Broken Scouter", "material", "red_scouter", 64, "uncommon", {}),
    ("clock", "Clock", "material", "gold_ingot", 64, "common", {}),
    ("copper_block", "Block of Copper", "material", "copper_ingot", 64, "common", {}),
    ("lapis_block", "Block of Lapis Lazuli", "material", "lapis_lazuli", 64, "common", {}),
    ("redstone_block", "Block of Redstone", "material", "redstone", 64, "common", {}),
    ("ender_chest", "Ender Chest", "material", "block_chest", 64, "rare", {}),
    ("ender_eye", "Eye of Ender", "material", "emerald", 64, "rare", {}),
    ("ender_pearl", "Ender Pearl", "material", "emerald", 16, "uncommon", {}),
    ("energy_cable", "Energy Cable", "material", "iron_ingot", 64, "common", {}),
    ("fuel_generator", "Fuel Generator", "material", "gete_ingot", 16, "rare", {}),
    ("heavy_weighted_pressure_plate", "Heavy Weighted Pressure Plate", "material",
     "iron_ingot", 64, "common", {}),
    ("netherite_ingot", "Netherite Ingot", "material", "gete_ingot", 64, "epic", {}),
    ("observer", "Observer", "material", "redstone", 64, "uncommon", {}),
    ("piston", "Piston", "material", "iron_ingot", 64, "uncommon", {}),
    ("cooked_beef", "Steak", "food", "cooked_meat", 64, "common",
     {"food": {"hunger": 8, "heal": 4}}),
    ("glow_berries", "Glow Berries", "food", "apple", 64, "common",
     {"food": {"hunger": 2, "heal": 1}}),
    ("golden_apple", "Golden Apple", "food", "apple", 16, "rare",
     {"food": {"hunger": 4, "heal": 40, "ki": 40, "stamina": 40, "instant": True}}),
    ("golden_carrot", "Golden Carrot", "food", "carrot", 64, "uncommon",
     {"food": {"hunger": 6, "heal": 8}}),
    ("oxygen_supply_unit", "Oxygen Supply Unit", "material", "ki_battery", 16, "rare",
     {}),
    ("thermal_regulator", "Thermal Regulator", "material", "anti_ki_cloak", 16, "rare",
     {}),
]


def build_extra_items():
    for iid, nm, kind, icon_base, stack, rarity, extra in EXTRA_ITEMS:
        ic = icon_for(iid, icon_base)
        if ic is None:
            SKIPPED.append("extra item %s: icon %s missing" % (iid, icon_base))
            continue
        it = {"id": iid, "name": nm, "icon": ic, "stack": stack, "kind": kind,
              "rarity": rarity}
        it.update(extra)
        add_item(it)


def load_weapon_attributes():
    """Resolve the DMZ/Minecraft weapon_attributes parent chains.

    Returns id -> (category, two_handed, crit_chance, crit_damage, [damage mults]).
    """
    raw = {}
    for base, ns in ((os.path.join(DMZ, "data", "dragonminez", "weapon_attributes"), "dragonminez"),
                     (os.path.join(DMZ, "data", "minecraft", "weapon_attributes"), "minecraft")):
        for path in sorted(glob.glob(os.path.join(base, "*.json"))):
            raw["%s:%s" % (ns, os.path.basename(path)[:-5])] = jload(path)

    def resolve(key, seen=()):
        if key in seen or key not in raw:
            return {}
        d = raw[key]
        out = {}
        if "parent" in d:
            out.update(resolve(d["parent"], seen + (key,)))
        attrs = d.get("attributes", {})
        for k, v in attrs.items():
            out[k] = v
        return out

    out = {}
    for key in raw:
        ns, name = key.split(":", 1)
        a = resolve(key)
        if "category" not in a:
            continue
        mults = [atk.get("damage_multiplier", 1.0) for atk in a.get("attacks", [])] or [1.0]
        out[name] = (a["category"], bool(a.get("two_handed", False)),
                     float(a.get("crit_chance", 0.0)), float(a.get("crit_damage", 0.0)),
                     mults)
    return out


# ================================================================ 2. recipes.json
# Minecraft/DMZ item id (namespace stripped) -> our item or block id.
MC_ITEM_MAP = {
    # ores / metals
    "iron_ingot": "iron_ingot", "gold_ingot": "gold_ingot", "copper_ingot": "copper_ingot",
    "raw_iron": "raw_iron", "raw_copper": "raw_copper", "raw_gold": "raw_gold",
    "gold_nugget": "gold_ingot", "netherite_scrap": "gete_scrap",
    "netherite_upgrade_smithing_template": "gete_scrap",
    "coal": "coal", "charcoal": "coal", "diamond": "diamond", "emerald": "emerald",
    "redstone": "redstone", "lapis_lazuli": "lapis_lazuli", "quartz": "quartz_block",
    "iron_block": "iron_block", "gold_block": "gold_block", "diamond_block": "diamond_block",
    "redstone_block": "redstone_block", "quartz_block": "quartz_block",
    # basics
    "stick": "stick", "string": "string", "paper": "paper", "book": "book",
    "leather": "leather", "feather": "feather", "bone": "bone", "flint": "flint",
    "clay_ball": "clay_ball", "snowball": "snowball", "sugar": "sugar", "bowl": "bowl",
    "bucket": "bucket", "water_bucket": "water_bucket", "lava_bucket": "lava_bucket",
    "blaze_powder": "glowstone_dust", "glowstone_dust": "glowstone_dust",
    "egg": "egg", "wheat": "wheat", "bread": "bread", "apple": "apple",
    "carrot": "carrot", "potato": "potato", "baked_potato": "baked_potato",
    "beetroot": "beetroot", "melon_slice": "melon_slice",
    "wheat_seeds": "wheat_seeds", "beetroot_seeds": "beetroot_seeds",
    "melon_seeds": "melon_seeds", "pumpkin_seeds": "pumpkin_seeds",
    # redstone machinery -> closest available part
    "observer": "observer", "comparator": "redstone", "repeater": "redstone",
    "redstone_torch": "torch", "clock": "clock", "compass": "iron_ingot",
    "minecart": "iron_ingot", "anvil": "iron_block", "shears": "iron_ingot",
    "heavy_weighted_pressure_plate": "heavy_weighted_pressure_plate",
    "smithing_table": "crafting_table", "piston": "piston", "sticky_piston": "piston",
    "ender_chest": "ender_chest", "ender_pearl": "ender_pearl",
    "ender_eye": "ender_eye", "amethyst_shard": "amethyst_shard",
    "blaze_rod": "blaze_rod", "netherite_ingot": "netherite_ingot",
    "golden_apple": "golden_apple", "golden_carrot": "golden_carrot",
    "cooked_beef": "cooked_beef", "beef": "raw_meat", "porkchop": "raw_meat",
    "cooked_porkchop": "cooked_meat", "chicken": "raw_meat",
    "cooked_chicken": "cooked_meat", "mutton": "raw_meat",
    "cooked_mutton": "cooked_meat", "glow_berries": "glow_berries",
    "sweet_berries": "glow_berries", "energy_cable": "energy_cable",
    "fuel_generator": "fuel_generator", "broken_scouter": "broken_scouter",
    "copper_block": "copper_block", "lapis_block": "lapis_block",
    "crying_obsidian": "obsidian", "obsidian": "obsidian",
    # tools / vanilla armour used as crafting ingredients or templates
    "iron_pickaxe": "iron_pickaxe", "iron_axe": "iron_axe", "iron_shovel": "iron_shovel",
    "iron_hoe": "iron_hoe", "iron_sword": "iron_sword",
    "stone_button": "stone", "stone_pressure_plate": "stone",
    "iron_helmet": "iron_ingot", "iron_chestplate": "iron_ingot",
    "iron_leggings": "iron_ingot", "iron_boots": "iron_ingot",
    "diamond_helmet": "diamond", "diamond_chestplate": "diamond",
    "diamond_leggings": "diamond", "diamond_boots": "diamond",
    "golden_helmet": "gold_ingot", "golden_chestplate": "gold_ingot",
    "golden_leggings": "gold_ingot", "golden_boots": "gold_ingot",
    "leather_helmet": "leather", "leather_chestplate": "leather",
    "leather_leggings": "leather", "leather_boots": "leather",
    "oxygen_supply_unit": "oxygen_supply_unit", "thermal_regulator": "thermal_regulator",
    # dyes -> closest plant / mineral we have
    "white_dye": "bone", "black_dye": "coal", "gray_dye": "flint",
    "light_gray_dye": "bone", "red_dye": "poppy", "orange_dye": "orange_tulip",
    "yellow_dye": "dandelion", "lime_dye": "cactus", "green_dye": "cactus",
    "cyan_dye": "lapis_lazuli", "light_blue_dye": "blue_orchid", "blue_dye": "lapis_lazuli",
    "purple_dye": "allium", "magenta_dye": "allium", "pink_dye": "rose_bush",
    "brown_dye": "brown_terracotta",
    # wool / glass / concrete
    "white_wool": "white_wool", "red_wool": "red_wool", "orange_wool": "orange_wool",
    "yellow_wool": "yellow_wool", "blue_wool": "blue_wool", "black_wool": "black_wool",
    "cyan_wool": "blue_wool", "light_blue_wool": "blue_wool", "gray_wool": "black_wool",
    "light_gray_wool": "white_wool", "purple_wool": "blue_wool", "magenta_wool": "red_wool",
    "lime_wool": "yellow_wool", "green_wool": "black_wool", "pink_wool": "red_wool",
    "brown_wool": "orange_wool",
    "glass": "glass", "glass_pane": "glass",
    "white_stained_glass": "white_stained_glass", "blue_stained_glass": "blue_stained_glass",
    "light_blue_stained_glass": "light_blue_stained_glass",
    "yellow_stained_glass": "yellow_stained_glass", "red_stained_glass": "red_stained_glass",
    "red_stained_glass_pane": "red_stained_glass", "blue_stained_glass_pane": "blue_stained_glass",
    "green_stained_glass_pane": "glass", "purple_stained_glass_pane": "blue_stained_glass",
    "white_concrete": "white_concrete", "yellow_concrete": "yellow_concrete",
    "light_blue_concrete": "light_blue_concrete", "orange_concrete": "orange_concrete",
    "red_concrete": "red_concrete", "black_concrete": "black_concrete",
    "blue_concrete": "light_blue_concrete", "green_concrete": "black_concrete",
    "cyan_concrete": "light_blue_concrete", "gray_concrete": "black_concrete",
    # blocks
    "stone": "stone", "cobblestone": "cobblestone", "stone_bricks": "stone_bricks",
    "bricks": "bricks", "dirt": "dirt", "sand": "sand", "gravel": "gravel",
    "clay": "clay", "sandstone": "sandstone", "smooth_stone": "smooth_stone",
    "torch": "torch", "lantern": "lantern", "ladder": "ladder", "chest": "chest",
    "furnace": "furnace", "crafting_table": "crafting_table", "bookshelf": "bookshelf",
    "iron_bars": "iron_bars", "hay_block": "hay_block", "glowstone": "glowstone",
    "snow_block": "snow_block", "ice": "ice",
    # dmz blocks / items
    "namek_ajissa_planks": "ajissa_planks", "namek_ajissa_log": "ajissa_log",
    "namek_ajissa_wood": "ajissa_log", "namek_ajissa_fence": "ajissa_fence",
    "namek_ajissa_door": "ajissa_door", "namek_ajissa_sapling": "ajissa_sapling",
    "namek_ajissa_leaves": "ajissa_leaves",
    "namek_sacred_planks": "sacred_planks", "namek_sacred_log": "sacred_log",
    "namek_sacred_wood": "sacred_log", "namek_sacred_fence": "sacred_fence",
    "namek_sacred_sapling": "sacred_sapling", "namek_sacred_leaves": "sacred_leaves",
    "namek_stone": "namek_stone", "namek_cobblestone": "namek_cobblestone",
    "namek_deepslate": "namek_deepslate", "namek_dirt": "namek_dirt",
    "namek_block": "namek_block", "kikono_block": "kikono_block", "gete_block": "gete_block",
    "namek_coal_ore": "namek_coal_ore", "namek_iron_ore": "namek_iron_ore",
    "namek_gold_ore": "namek_gold_ore", "namek_diamond_ore": "namek_diamond_ore",
    "namek_kikono_ore": "namek_kikono_ore", "namek_copper_ore": "copper_ore",
    "namek_emerald_ore": "emerald_ore", "namek_lapis_ore": "lapis_ore",
    "namek_redstone_ore": "redstone_ore",
    "namek_deepslate_coal_ore": "namek_coal_ore", "namek_deepslate_iron_ore": "namek_iron_ore",
    "namek_deepslate_gold_ore": "namek_gold_ore", "namek_deepslate_diamond_ore": "namek_diamond_ore",
    "namek_deepslate_copper_ore": "copper_ore", "namek_deepslate_emerald_ore": "emerald_ore",
    "namek_deepslate_lapis_ore": "lapis_ore", "namek_deepslate_redstone_ore": "redstone_ore",
    "gete_debris_ore": "gete_debris_ore", "rocky_stone": "rocky_stone",
    "rocky_cobblestone": "rocky_cobblestone", "rocky_dirt": "rocky_dirt",
    "kikono_station": "kikono_station", "gravity_device": "gravity_device",
    "time_chamber_block": "time_chamber_block", "dragon_ball_altar": "dragon_ball_altar",
    "training_post": "training_post", "punch_machine_item": "punch_machine_item",
    "gete_smithing_template": "gete_smithing_template",
    # the radars are re-issued under our own ids (see RADAR_SOURCE_IDS)
    "dball_radar": "dragon_radar", "namekdball_radar": "namek_dragon_radar",
    "fused_dball_radar": "fused_dragon_radar",
    "super_dball_radar": "super_dragon_radar",
    "cereal_dball_radar": "cereal_dragon_radar",
}
# item tags -> list of our ids
TAG_MAP = {
    "minecraft:planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks",
                         "acacia_planks", "dark_oak_planks", "cherry_planks",
                         "ajissa_planks", "sacred_planks"],
    "minecraft:logs": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log",
                       "dark_oak_log", "cherry_log", "ajissa_log", "sacred_log"],
    "minecraft:wool": ["white_wool", "red_wool", "orange_wool", "yellow_wool",
                       "blue_wool", "black_wool"],
    "minecraft:coals": ["coal"],
    "minecraft:stone_crafting_materials": ["cobblestone", "namek_cobblestone",
                                           "rocky_cobblestone"],
    "forge:ingots/iron": ["iron_ingot"],
    "forge:ingots/gold": ["gold_ingot"],
    "forge:ingots/copper": ["copper_ingot"],
    "forge:gems/diamond": ["diamond"],
    "forge:gems/emerald": ["emerald"],
    "forge:dusts/redstone": ["redstone"],
    "forge:rods/wooden": ["stick"],
    "dragonminez:namek_alog": ["ajissa_log"],
    "dragonminez:namek_slog": ["sacred_log"],
    "dragonminez:weighted_items": sorted(WEIGHTS),
    "dragonminez:kikono_items": ["kikono_shard", "kikono_stick", "kikono_cloth",
                                 "kikono_string"],
}
UNMAPPED_ITEMS = set()
RECIPES = []
RECIPE_IDS = set()


def strip_ns(name):
    return name.split(":", 1)[-1] if ":" in name else name


def map_item(name):
    """Minecraft/DMZ item id -> our item id, or None."""
    bare = strip_ns(name)
    if bare in MC_ITEM_MAP:
        m = MC_ITEM_MAP[bare]
        if m != bare:
            subst("item id: %s -> %s" % (name, m))
        return m
    if bare in ITEM_IDS or bare in BLOCK_SET:
        return bare
    UNMAPPED_ITEMS.add(name)
    return None


def map_tag(tag):
    if not tag.startswith("#"):
        tag = tag
    key = tag.lstrip("#")
    if key in TAG_MAP:
        return [i for i in TAG_MAP[key] if i in ITEM_IDS or i in BLOCK_SET]
    UNMAPPED_ITEMS.add("#" + key)
    return []


def ingredient(ing):
    """A Minecraft recipe ingredient -> our item id or list of ids."""
    if isinstance(ing, list):
        out = []
        for e in ing:
            r = ingredient(e)
            if r is None:
                continue
            out.extend(r if isinstance(r, list) else [r])
        return sorted(set(out)) or None
    if not isinstance(ing, dict):
        return None
    if "tag" in ing:
        lst = map_tag(ing["tag"])
        return lst or None
    if "item" in ing:
        return map_item(ing["item"])
    return None


def add_recipe(r):
    rid = r["id"]
    n = 2
    while rid in RECIPE_IDS:
        rid = "%s_%d" % (r["id"], n)
        n += 1
    r["id"] = rid
    RECIPE_IDS.add(rid)
    RECIPES.append(r)


def fits_2x2(shape):
    return len(shape) <= 2 and all(len(row) <= 2 for row in shape)


def normalise_shape(rows):
    """Trim empty rows/columns so the pattern is minimal (lets 2x2 fit 'hand')."""
    rows = [r.replace("\t", " ") for r in rows]
    while rows and rows[0].strip() == "":
        rows.pop(0)
    while rows and rows[-1].strip() == "":
        rows.pop()
    if not rows:
        return []
    w = max(len(r) for r in rows)
    rows = [r.ljust(w) for r in rows]
    left, right = 0, w - 1
    while left <= right and all(r[left] == " " for r in rows):
        left += 1
    while right >= left and all(r[right] == " " for r in rows):
        right -= 1
    return [r[left:right + 1] for r in rows]


def convert_mc_recipe(src_id, d):
    t = d.get("type", "")
    result = d.get("result")
    if isinstance(result, str):
        res_item, res_count = map_item(result), 1
    elif isinstance(result, dict):
        res_item = map_item(result.get("item", ""))
        res_count = int(result.get("count", 1))
    else:
        res_item = None
        res_count = 1
    if t == "dragonminez:kikono_crafting":
        res_item = map_item(d.get("output", {}).get("item", ""))
        res_count = int(d.get("output", {}).get("count", 1))
    if res_item is None:
        SKIPPED.append("recipe %s: result %r does not exist" % (src_id, result or d.get("output")))
        return

    if t in ("minecraft:crafting_shaped",):
        keys = {}
        for k, v in sorted(d.get("key", {}).items()):
            got = ingredient(v)
            if got is None:
                SKIPPED.append("recipe %s: ingredient %r unavailable" % (src_id, v))
                return
            keys[k] = got
        shape = normalise_shape(list(d.get("pattern", [])))
        if not shape:
            SKIPPED.append("recipe %s: empty pattern" % src_id)
            return
        station = "hand" if fits_2x2(shape) else "crafting_table"
        add_recipe({"id": src_id, "station": station, "shape": shape, "keys": keys,
                    "result": {"item": res_item, "count": res_count}})
    elif t in ("minecraft:crafting_shapeless",):
        ings = []
        for v in d.get("ingredients", []):
            got = ingredient(v)
            if got is None:
                SKIPPED.append("recipe %s: ingredient %r unavailable" % (src_id, v))
                return
            ings.append(got)
        if not ings:
            SKIPPED.append("recipe %s: no ingredients" % src_id)
            return
        letters = "ABCDEFGHI"
        keys = {}
        cells = []
        for i, got in enumerate(ings[:9]):
            keys[letters[i]] = got
            cells.append(letters[i])
        rows = ["".join(cells[0:2]), "".join(cells[2:4])] if len(cells) <= 4 else \
               ["".join(cells[0:3]), "".join(cells[3:6]), "".join(cells[6:9])]
        shape = normalise_shape([r for r in rows if r])
        station = "hand" if fits_2x2(shape) else "crafting_table"
        add_recipe({"id": src_id, "station": station, "shapeless": True, "shape": shape,
                    "keys": keys, "result": {"item": res_item, "count": res_count}})
    elif t in ("minecraft:smelting", "minecraft:blasting", "minecraft:smoking",
               "minecraft:campfire_cooking"):
        if t != "minecraft:smelting":
            SKIPPED.append("recipe %s: %s duplicates the smelting recipe" % (src_id, t))
            return
        inp = ingredient(d.get("ingredient", {}))
        if inp is None:
            SKIPPED.append("recipe %s: smelting input unavailable" % src_id)
            return
        if isinstance(inp, list):
            inp = inp[0]
        add_recipe({"id": src_id, "station": "furnace", "input": inp,
                    "result": {"item": res_item, "count": res_count},
                    "time": max(1, int(round(d.get("cookingtime", 200) / 20.0)))})
    elif t == "dragonminez:kikono_crafting":
        keys = {}
        cells = []
        letters = "ABCDEFGHI"
        for i in range(1, 10):
            slot = d.get("slot_%d" % i)
            if not slot:
                cells.append(" ")
                continue
            got = ingredient(slot)
            if got is None:
                SKIPPED.append("recipe %s: kikono slot %d unavailable" % (src_id, i))
                return
            ch = None
            for k, v in keys.items():
                if v == got:
                    ch = k
                    break
            if ch is None:
                ch = letters[len(keys)]
                keys[ch] = got
            cells.append(ch)
        shape = normalise_shape(["".join(cells[0:3]), "".join(cells[3:6]), "".join(cells[6:9])])
        rec = {"id": src_id, "station": "kikono_station", "shape": shape, "keys": keys,
               "result": {"item": res_item, "count": res_count},
               "time": max(1, int(round(d.get("crafting_time", 200) / 20.0))),
               "energy": int(d.get("energy_cost", 0))}
        pat = d.get("pattern", {}).get("item")
        if pat:
            mp = map_item(pat)
            if mp:
                rec["pattern"] = mp
        tpl = d.get("template", {}).get("item")
        if tpl and strip_ns(tpl) not in MC_ITEM_MAP and strip_ns(tpl) not in ITEM_IDS:
            subst("recipe %s: template %s dropped (no equivalent item)" % (src_id, tpl))
        add_recipe(rec)
    else:
        SKIPPED.append("recipe %s: unsupported type %s" % (src_id, t))


def build_recipes():
    files = sorted(glob.glob(os.path.join(DMZ_DATA, "recipes", "*.json"))) + \
            sorted(glob.glob(os.path.join(DMZP_DATA, "recipes", "*.json")))
    for path in files:
        src_id = os.path.basename(path)[:-5]
        convert_mc_recipe(src_id, jload(path))
    COUNTS["recipes_ported"] = len(RECIPES)
    add_vanilla_recipes()
    COUNTS["recipes_total"] = len(RECIPES)


WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "cherry",
         "ajissa", "sacred"]


def add_vanilla_recipes():
    def R(rid, station, shape, keys, item, count=1, **kw):
        if item not in ITEM_IDS and item not in BLOCK_SET:
            SKIPPED.append("vanilla recipe %s: result %s missing" % (rid, item))
            return
        for v in keys.values():
            for vv in (v if isinstance(v, list) else [v]):
                if vv not in ITEM_IDS and vv not in BLOCK_SET:
                    SKIPPED.append("vanilla recipe %s: ingredient %s missing" % (rid, vv))
                    return
        d = {"id": rid, "station": station, "shape": shape, "keys": keys,
             "result": {"item": item, "count": count}}
        d.update(kw)
        add_recipe(d)

    def S(rid, inp, item, count=1, time=8):
        if item not in ITEM_IDS and item not in BLOCK_SET:
            SKIPPED.append("vanilla smelt %s: result %s missing" % (rid, item))
            return
        if inp not in ITEM_IDS and inp not in BLOCK_SET:
            SKIPPED.append("vanilla smelt %s: input %s missing" % (rid, inp))
            return
        add_recipe({"id": rid, "station": "furnace", "input": inp,
                    "result": {"item": item, "count": count}, "time": time})

    # planks from each log
    for w in WOODS:
        if "%s_log" % w in BLOCK_SET and "%s_planks" % w in BLOCK_SET:
            R("planks_%s" % w, "hand", ["L"], {"L": "%s_log" % w}, "%s_planks" % w, 4)
        if "stripped_%s_log" % w in BLOCK_SET:
            R("planks_%s_stripped" % w, "hand", ["L"], {"L": "stripped_%s_log" % w},
              "%s_planks" % w, 4)
    all_planks = [p for p in ("%s_planks" % w for w in WOODS) if p in BLOCK_SET]
    # sticks
    R("sticks", "hand", ["P", "P"], {"P": all_planks}, "stick", 4)
    # core stations
    R("crafting_table", "hand", ["PP", "PP"], {"P": all_planks}, "crafting_table")
    R("furnace", "crafting_table", ["CCC", "C C", "CCC"], {"C": ["cobblestone",
        "namek_cobblestone", "rocky_cobblestone"]}, "furnace")
    R("chest", "crafting_table", ["PPP", "P P", "PPP"], {"P": all_planks}, "chest")
    R("torch", "hand", ["C", "S"], {"C": ["coal"], "S": "stick"}, "torch", 4)
    R("lantern", "crafting_table", ["III", "ITI", "III"],
      {"I": "iron_ingot", "T": "torch"}, "lantern")
    R("ladder", "crafting_table", ["S S", "SSS", "S S"], {"S": "stick"}, "ladder", 3)
    R("bookshelf", "crafting_table", ["PPP", "BBB", "PPP"],
      {"P": all_planks, "B": "book"}, "bookshelf")
    R("book", "hand", ["PP", "L "], {"P": "paper", "L": "leather"}, "book")
    R("paper", "hand", ["SS"], {"S": "sugar_cane"}, "paper", 3)
    R("bowl", "crafting_table", ["P P", " P "], {"P": all_planks}, "bowl")
    R("bucket", "crafting_table", ["I I", " I "], {"I": "iron_ingot"}, "bucket")
    # tools
    for mat, tier, speed, dur, dmg in TOOL_MATS:
        base = {"wooden": all_planks, "stone": ["cobblestone", "namek_cobblestone",
                                                "rocky_cobblestone"],
                "iron": ["iron_ingot"], "golden": ["gold_ingot"], "diamond": ["diamond"],
                "kikono": ["kikono_shard"], "gete": ["gete_ingot"]}[mat]
        R("%s_pickaxe" % mat, "crafting_table", ["MMM", " S ", " S "],
          {"M": base, "S": "stick"}, "%s_pickaxe" % mat)
        R("%s_axe" % mat, "crafting_table", ["MM", "MS", " S"],
          {"M": base, "S": "stick"}, "%s_axe" % mat)
        R("%s_shovel" % mat, "crafting_table", ["M", "S", "S"],
          {"M": base, "S": "stick"}, "%s_shovel" % mat)
        R("%s_hoe" % mat, "crafting_table", ["MM", " S", " S"],
          {"M": base, "S": "stick"}, "%s_hoe" % mat)
        R("%s_sword" % mat, "crafting_table", ["M", "M", "S"],
          {"M": base, "S": "stick"}, "%s_sword" % mat)
    # metal blocks <-> ingots
    for block, ingot in (("iron_block", "iron_ingot"), ("gold_block", "gold_ingot"),
                         ("diamond_block", "diamond")):
        R(block, "crafting_table", ["III", "III", "III"], {"I": ingot}, block)
        R("%s_from_block" % ingot, "hand", ["B"], {"B": block}, ingot, 9)
    R("kikono_block", "crafting_table", ["III", "III", "III"], {"I": "kikono_shard"},
      "kikono_block")
    R("kikono_shard_from_block", "hand", ["B"], {"B": "kikono_block"}, "kikono_shard", 9)
    R("gete_block", "crafting_table", ["III", "III", "III"], {"I": "gete_ingot"}, "gete_block")
    R("gete_ingot_from_block", "hand", ["B"], {"B": "gete_block"}, "gete_ingot", 9)
    # smelting
    S("iron_ingot_from_raw", "raw_iron", "iron_ingot", time=10)
    S("gold_ingot_from_raw", "raw_gold", "gold_ingot", time=10)
    S("copper_ingot_from_raw", "raw_copper", "copper_ingot", time=10)
    S("iron_ingot_from_ore", "iron_ore", "iron_ingot", time=10)
    S("gold_ingot_from_ore", "gold_ore", "gold_ingot", time=10)
    S("copper_ingot_from_ore", "copper_ore", "copper_ingot", time=10)
    S("diamond_from_ore", "diamond_ore", "diamond", time=10)
    S("emerald_from_ore", "emerald_ore", "emerald", time=10)
    S("coal_from_ore", "coal_ore", "coal", time=10)
    S("redstone_from_ore", "redstone_ore", "redstone", time=10)
    S("lapis_from_ore", "lapis_ore", "lapis_lazuli", time=10)
    S("kikono_shard_from_ore", "namek_kikono_ore", "kikono_shard", time=12)
    S("gete_ingot_from_debris", "gete_debris_ore", "gete_ingot", time=15)
    S("stone_from_cobblestone", "cobblestone", "stone", time=10)
    S("namek_stone_from_cobblestone", "namek_cobblestone", "namek_stone", time=10)
    S("rocky_stone_from_cobblestone", "rocky_cobblestone", "rocky_stone", time=10)
    S("glass_from_sand", "sand", "glass", time=10)
    S("glass_from_red_sand", "red_sand", "glass", time=10)
    S("baked_potato", "potato", "baked_potato", time=10)
    S("cooked_meat", "raw_meat", "cooked_meat", time=10)
    S("bricks_from_clay", "clay_ball", "bricks", time=10)
    S("charcoal_from_log", "oak_log", "coal", time=10)
    S("smooth_stone", "stone", "smooth_stone", time=10)
    S("kikono_dust", "kikono_shard", "kikono_dust", 2, time=8)
    # food
    R("bread", "crafting_table", ["WWW"], {"W": "wheat"}, "bread")
    # building
    R("stone_bricks", "hand", ["SS", "SS"], {"S": "stone"}, "stone_bricks", 4)
    R("bricks_block", "hand", ["BB", "BB"], {"B": "bricks"}, "bricks", 4)
    R("snow_block", "hand", ["SS", "SS"], {"S": "snowball"}, "snow_block")
    R("clay_block", "hand", ["CC", "CC"], {"C": "clay_ball"}, "clay")
    R("hay_block", "hand", ["WW", "WW"], {"W": "wheat"}, "hay_block")
    R("stone_slab", "crafting_table", ["SSS"], {"S": "stone"}, "stone_slab", 6)
    R("oak_slab", "crafting_table", ["PPP"], {"P": all_planks}, "oak_slab", 6)
    R("glass_pane_like", "crafting_table", ["GGG", "GGG"], {"G": "glass"}, "iron_bars", 16)
    R("iron_bars", "crafting_table", ["III", "III"], {"I": "iron_ingot"}, "iron_bars", 16)
    for w in WOODS:
        if "%s_fence" % w in BLOCK_SET:
            R("%s_fence" % w, "crafting_table", ["PSP", "PSP"],
              {"P": "%s_planks" % w, "S": "stick"}, "%s_fence" % w, 3)
        if "%s_door" % w in BLOCK_SET:
            R("%s_door" % w, "crafting_table", ["PP", "PP", "PP"],
              {"P": "%s_planks" % w}, "%s_door" % w, 3)
    R("oak_trapdoor", "crafting_table", ["PPP", "PPP"], {"P": all_planks}, "oak_trapdoor", 2)
    # dmz specials
    R("dragon_ball_altar", "crafting_table", ["SSS", "SGS", "SSS"],
      {"S": "stone", "G": "gold_ingot"}, "dragon_ball_altar")
    R("training_post", "crafting_table", ["L", "L", "L"],
      {"L": [l for l in ("%s_log" % w for w in WOODS) if l in BLOCK_SET]}, "training_post")
    R("capsule_house_craft", "crafting_table", ["PPP", "PCP", "PPP"],
      {"P": all_planks, "C": "capsule"}, "capsule_house")
    R("gravity_device", "crafting_table", ["GGG", "GRG", "III"],
      {"G": "gete_ingot", "R": "redstone", "I": "iron_block"}, "gravity_device")
    R("gete_forge", "crafting_table", ["GGG", "G G", "GGG"], {"G": "gete_ingot"}, "gete_forge")
    R("kikono_station_craft", "crafting_table", ["KKK", "K K", "KKK"],
      {"K": "kikono_shard"}, "kikono_station")
    R("senzu_bag", "crafting_table", ["LLL", "LSL", "LLL"],
      {"L": "leather", "S": "senzu_bean"}, "senzu_bag")


# ================================================================ 3. biomes.json
def hexcol(v):
    if v is None:
        return None
    return "#%06X" % (int(v) & 0xFFFFFF)


def load_src_biomes():
    out = {}
    for base in (os.path.join(DMZ_DATA, "worldgen", "biome"),
                 os.path.join(DMZP_DATA, "worldgen", "biome")):
        for path in sorted(glob.glob(os.path.join(base, "*.json"))):
            out[os.path.basename(path)[:-5]] = jload(path)
    return out


SRC_BIOMES = load_src_biomes()

MOBS_DINO = [("dino1", 22, 1, 2), ("dino2", 18, 1, 2), ("dino3", 14, 1, 2),
             ("dinokid", 10, 1, 3)]
MOBS_SABER = [("sabertooth", 18, 1, 3), ("bandit", 12, 1, 3)]
MOBS_ROBOT = [("red_ribbon_soldier", 45, 2, 4), ("robot1", 10, 1, 2)]
MOBS_NAMEK = [("namek_frog", 12, 1, 3), ("namek_warrior", 6, 1, 2),
              ("namek_trader", 3, 1, 1)]
MOBS_BANDIT = [("bandit", 14, 1, 3)]

# id, name, planet, temp, humidity, grass, foliage, water, sky, fog,
# surface, filler, underwater, trees, plants, mobs, quest_tag, weight
BIOME_TABLE = [
    # ---- Earth
    ("plains", "Plains", "earth", 0.8, 0.4, "#91BD59", "#77AB2F", "#3F76E4", "#78A7FF",
     "#C0D8FF", "grass_block", "dirt", "sand",
     [("oak", 0.004)],
     [("short_grass", 0.14), ("tall_grass", 0.03), ("dandelion", 0.012),
      ("poppy", 0.010), ("azure_bluet", 0.006), ("cornflower", 0.005)],
     MOBS_SABER + MOBS_ROBOT, "minecraft:plains", 14),
    ("sunflower_plains", "Sunflower Plains", "earth", 0.8, 0.4, "#91BD59", "#77AB2F",
     "#3F76E4", "#78A7FF", "#C0D8FF", "grass_block", "dirt", "sand",
     [("oak", 0.002)],
     [("sunflower", 0.06), ("short_grass", 0.14), ("dandelion", 0.01)],
     MOBS_SABER + MOBS_ROBOT, "minecraft:sunflower_plains", 4),
    ("forest", "Forest", "earth", 0.7, 0.8, "#79C05A", "#59AE30", "#3F76E4", "#78A7FF",
     "#C0D8FF", "grass_block", "dirt", "sand",
     [("oak", 0.06), ("birch", 0.02)],
     [("short_grass", 0.16), ("fern", 0.03), ("poppy", 0.01), ("lilac", 0.006),
      ("rose_bush", 0.005), ("brown_mushroom", 0.004), ("red_mushroom", 0.003)],
     MOBS_SABER, "minecraft:forest", 12),
    ("birch_forest", "Birch Forest", "earth", 0.6, 0.6, "#88BB67", "#6BA941", "#3F76E4",
     "#78A7FF", "#C0D8FF", "grass_block", "dirt", "sand",
     [("birch", 0.08)],
     [("short_grass", 0.15), ("lilac", 0.008), ("poppy", 0.008)],
     MOBS_SABER, "minecraft:birch_forest", 7),
    ("dark_forest", "Dark Forest", "earth", 0.7, 0.8, "#507A32", "#4A7A2E", "#3F76E4",
     "#6E93D6", "#A8BFE0", "grass_block", "dirt", "sand",
     [("dark_oak", 0.10), ("oak", 0.02)],
     [("short_grass", 0.14), ("brown_mushroom", 0.02), ("red_mushroom", 0.015),
      ("rose_bush", 0.006)],
     MOBS_SABER + MOBS_BANDIT, "minecraft:dark_forest", 6),
    ("jungle", "Jungle", "earth", 0.95, 0.9, "#59C93C", "#30BB0B", "#3F76E4", "#77A8FF",
     "#C0D8FF", "grass_block", "dirt", "sand",
     [("jungle", 0.12), ("oak", 0.01)],
     [("short_grass", 0.24), ("fern", 0.10), ("large_fern", 0.03), ("vine", 0.06),
      ("melon", 0.004)],
     MOBS_SABER, "minecraft:jungle", 7),
    ("taiga", "Taiga", "earth", 0.25, 0.8, "#86B783", "#68A464", "#287082", "#7BA4FF",
     "#C0D8FF", "grass_block", "dirt", "gravel",
     [("spruce", 0.09)],
     [("short_grass", 0.12), ("fern", 0.06), ("large_fern", 0.02),
      ("brown_mushroom", 0.004)],
     MOBS_DINO, "minecraft:taiga", 8),
    ("snowy_taiga", "Snowy Taiga", "earth", -0.5, 0.4, "#80B497", "#60A17B", "#205E74",
     "#84AEFF", "#D2E2FF", "snowy_grass_block", "dirt", "gravel",
     [("spruce", 0.07)],
     [("snow_layer", 0.30), ("short_grass", 0.04), ("dead_bush", 0.004)],
     MOBS_DINO, "minecraft:snowy_taiga", 6),
    ("snowy_plains", "Snowy Plains", "earth", -0.5, 0.5, "#80B497", "#60A17B", "#3F76E4",
     "#84AEFF", "#D2E2FF", "snowy_grass_block", "dirt", "sand",
     [("spruce", 0.002)],
     [("snow_layer", 0.45), ("short_grass", 0.03)],
     MOBS_ROBOT, "minecraft:snowy_plains", 8),
    ("ice_spikes", "Ice Spikes", "earth", -0.5, 0.5, "#80B497", "#60A17B", "#3938C9",
     "#8AB4FF", "#DCE8FF", "snow_block", "ice", "ice",
     [],
     [("snow_layer", 0.50)],
     [], "minecraft:ice_spikes", 2),
    ("desert", "Desert", "earth", 2.0, 0.0, "#BFB755", "#AEA42A", "#3F76E4", "#8CB8FF",
     "#D8D2A8", "sand", "sandstone", "sand",
     [("cactus", 0.02)],
     [("dead_bush", 0.02), ("cactus", 0.012)],
     MOBS_BANDIT, "minecraft:desert", 9),
    ("badlands", "Badlands", "earth", 2.0, 0.0, "#90814D", "#9E814D", "#4E7F81",
     "#94B0FF", "#D8C0A0", "red_sand", "orange_terracotta", "red_sand",
     [("cactus", 0.006)],
     [("dead_bush", 0.03), ("cactus", 0.006)],
     MOBS_DINO, "minecraft:badlands", 5),
    ("savanna", "Savanna", "earth", 2.0, 0.0, "#BFB755", "#AEA42A", "#3F76E4", "#86AEFF",
     "#CFD8B0", "grass_block", "dirt", "sand",
     [("acacia", 0.02)],
     [("short_grass", 0.22), ("tall_grass", 0.05)],
     MOBS_SABER + MOBS_DINO + MOBS_ROBOT, "minecraft:savanna", 8),
    ("swamp", "Swamp", "earth", 0.8, 0.9, "#6A7039", "#6A7039", "#617B64", "#6E93D6",
     "#A8B79A", "grass_block", "dirt", "clay",
     [("oak", 0.03)],
     [("short_grass", 0.16), ("lily_pad", 0.06), ("brown_mushroom", 0.01),
      ("red_mushroom", 0.008), ("blue_orchid", 0.01), ("vine", 0.02)],
     MOBS_BANDIT, "minecraft:swamp", 6),
    ("mountains", "Mountains", "earth", 0.2, 0.3, "#8AB689", "#6DA36B", "#3F76E4",
     "#7DA9FF", "#C6DAFF", "grass_block", "stone", "gravel",
     [("spruce", 0.02)],
     [("short_grass", 0.06), ("fern", 0.02)],
     MOBS_DINO, "#minecraft:is_mountain", 8),
    ("meadow", "Meadow", "earth", 0.5, 0.8, "#83BB6D", "#63A948", "#0E4ECF", "#7DA9FF",
     "#C6DAFF", "grass_block", "dirt", "gravel",
     [("oak", 0.002)],
     [("short_grass", 0.20), ("dandelion", 0.02), ("poppy", 0.02), ("allium", 0.01),
      ("cornflower", 0.012), ("oxeye_daisy", 0.012)],
     MOBS_DINO, "minecraft:meadow", 4),
    ("cherry_grove", "Cherry Grove", "earth", 0.5, 0.8, "#B6DB61", "#B6DB61", "#5DB7EF",
     "#8FC2FF", "#E3D0E8", "grass_block", "dirt", "gravel",
     [("cherry", 0.05)],
     [("short_grass", 0.16), ("azure_bluet", 0.02), ("red_tulip", 0.01),
      ("orange_tulip", 0.01)],
     MOBS_SABER, "minecraft:cherry_grove", 4),
    ("beach", "Beach", "earth", 0.8, 0.4, "#91BD59", "#77AB2F", "#3F76E4", "#78A7FF",
     "#C0D8FF", "sand", "sand", "sand",
     [],
     [("dead_bush", 0.004)],
     [], "#minecraft:is_beach", 5),
    ("ocean", "Ocean", "earth", 0.5, 0.5, "#8EB971", "#71A74D", "#3F76E4", "#78A7FF",
     "#C0D8FF", "sand", "gravel", "sand",
     [],
     [],
     [], "minecraft:ocean", 10),
    ("deep_ocean", "Deep Ocean", "earth", 0.5, 0.5, "#8EB971", "#71A74D", "#3F76E4",
     "#78A7FF", "#C0D8FF", "gravel", "stone", "gravel",
     [],
     [],
     [], "minecraft:deep_ocean", 6),
    ("frozen_ocean", "Frozen Ocean", "earth", -0.5, 0.5, "#80B497", "#60A17B", "#3938C9",
     "#84AEFF", "#DCE8FF", "gravel", "stone", "gravel",
     [],
     [("snow_layer", 0.20)],
     [], "minecraft:frozen_ocean", 3),
    ("river", "River", "earth", 0.5, 0.5, "#8EB971", "#71A74D", "#3F76E4", "#78A7FF",
     "#C0D8FF", "sand", "dirt", "sand",
     [],
     [("short_grass", 0.04), ("sugar_cane", 0.02)],
     [], "minecraft:river", 7),
    ("mushroom_fields", "Mushroom Fields", "earth", 0.9, 1.0, "#55C93F", "#2BBB0F",
     "#3F76E4", "#78A7FF", "#C0D8FF", "mycelium", "dirt", "sand",
     [],
     [("brown_mushroom", 0.10), ("red_mushroom", 0.08)],
     [], "minecraft:mushroom_fields", 2),
    ("wasteland", "Rocky Wasteland", "earth", 2.0, 0.0, None, None, None, None, None,
     "rocky_dirt", "rocky_stone", "gravel",
     [("oak", 0.001)],
     [("dead_bush", 0.03), ("short_grass", 0.02)],
     MOBS_DINO + MOBS_BANDIT, "dragonminez:rocky", 9),
    # ---- Namek
    ("ajissa_plains", "Ajissa Plains", "namek", 2.0, 0.0, None, None, None, None, None,
     "namek_grass_block", "namek_dirt", "sand",
     [("ajissa", 0.03)],
     [("namek_grass", 0.20), ("namek_fern", 0.06), ("amaryllis_flower", 0.012),
      ("marigold_flower", 0.010), ("chrysanthemum_flower", 0.010),
      ("catharanthus_roseus_flower", 0.008)],
     MOBS_NAMEK, "dragonminez:ajissa_plains", 16),
    ("namekian_rivers", "Namekian Rivers", "namek", 2.0, 0.0, None, None, None, None,
     None, "namek_grass_block", "namek_dirt", "sand",
     [("ajissa", 0.006)],
     [("namek_grass", 0.10), ("lotus_flower", 0.02), ("namek_fern", 0.03)],
     MOBS_NAMEK, "dragonminez:namekian_rivers", 8),
    ("namek_rocky", "Namek Highlands", "namek", 2.0, 0.0, None, None, None, None, None,
     "namek_stone", "namek_stone", "gravel",
     [],
     [("namek_grass", 0.03), ("trillium_flower", 0.006)],
     [("namek_frog", 6, 1, 2), ("namek_warrior", 4, 1, 1)],
     "dragonminez:namek_rocky", 6),
    # ---- Otherworld
    ("other_world", "Other World", "otherworld", 1.0, 0.0, None, None, None, None, None,
     "otherworld_cloud", "otherworld_cloud", "otherworld_cloud",
     [],
     [],
     [], "dragonminez:other_world", 10),
    ("king_kai_planet", "King Kai's Planet", "otherworld", 1.0, 0.4, "#8FE05A", "#6FCB3F",
     "#3F76E4", "#BE55AA", "#CE7EBD", "kai_grass_block", "dirt", "sand",
     [("oak", 0.02)],
     [("short_grass", 0.20), ("dandelion", 0.02), ("poppy", 0.02)],
     [], "dragonminez:king_kai_planet", 2),
    # ---- Sacred Kai planet
    ("sacredkai_plains", "Sacred Kai Plains", "sacred_kai_planet", 2.0, 0.0, None, None,
     None, None, None, "sacred_planet_grass_block", "rocky_dirt", "sand",
     [("sacred", 0.02)],
     [("namek_sacred_grass", 0.18), ("sacred_fern", 0.05),
      ("sacred_chrysanthemum_flower", 0.012), ("sacred_trillium_flower", 0.010)],
     [], "dragonminez:sacredkai_plains", 12),
    ("sacredkai_hills", "Sacred Kai Hills", "sacred_kai_planet", 2.0, 0.0, None, None,
     None, None, None, "sacred_planet_grass_block", "rocky_stone", "gravel",
     [("sacred", 0.03)],
     [("namek_sacred_grass", 0.12), ("sacred_fern", 0.04)],
     [], "dragonminez:sacredkai_hills", 8),
    ("sacredkai_rivers", "Sacred Kai Rivers", "sacred_kai_planet", 2.0, 0.0, None, None,
     None, None, None, "sacred_planet_grass_block", "rocky_dirt", "sand",
     [("sacred", 0.006)],
     [("namek_sacred_grass", 0.08), ("lotus_flower", 0.02)],
     [], "dragonminez:sacredkai_rivers", 5),
    ("sacred_land", "Sacred Land", "sacred_kai_planet", 2.0, 0.0, None, None, None, None,
     None, "namek_sacred_grass_block", "namek_dirt", "sand",
     [("sacred", 0.04)],
     [("namek_sacred_grass", 0.20), ("sacred_fern", 0.06),
      ("sacred_chrysanthemum_flower", 0.012), ("sacred_trillium_flower", 0.010)],
     MOBS_NAMEK, "dragonminez:sacred_land", 6),
    # ---- Time chamber
    ("hyperbolic_time_chamber", "Hyperbolic Time Chamber", "time_chamber", 0.7, 0.0,
     None, None, None, None, None, "time_chamber_block", "time_chamber_block",
     "time_chamber_block", [], [], [], "dragonminez:hyperbolic_time_chamber", 10),
    # ---- DMZ Plus planets
    ("vegeta_wasteland", "Vegeta Wasteland", "vegeta", 2.0, 0.0, None, None, None, None,
     None, "vegeta_red_sand", "rocky_stone", "gravel",
     [],
     [("dead_bush", 0.02)],
     [("bandit", 8, 1, 2)], "dmzplus:vegeta_wasteland", 10),
    ("yardrat_hills", "Yardrat Hills", "yardrat", 0.8, 0.4, "#C9E04A", "#B4CB3A",
     None, None, None, "yardrat_grass_block", "yardrat_dirt", "sand",
     [("oak", 0.01)],
     [("yardrat_grass", 0.16), ("marigold_flower", 0.01)],
     [], "dmzplus:yardrat_hills", 10),
    ("vampa_barrens", "Vampa Barrens", "vampa", 2.0, 0.0, None, None, None, None, None,
     "vampa_sand", "vampa_rock", "vampa_sand",
     [],
     [("dead_bush", 0.03)],
     [], "dmzplus:vampa_barrens", 10),
    ("cereal_mesa", "Cereal Mesa", "cereal", 2.0, 0.0, None, None, None, None, None,
     "cereal_sand", "cereal_rock", "cereal_sand",
     [],
     [("dead_bush", 0.02), ("cactus", 0.004)],
     [], "dmzplus:cereal_mesa", 10),
    ("hell_planet_wastes", "Hell Wastes", "hell_planet", 2.0, 0.0, None, None, None,
     None, None, "hell_rock", "hell_rock", "hell_rock_molten",
     [],
     [("dead_bush", 0.01)],
     [], "dmzplus:hell_planet_wastes", 10),
    ("heaven_meadows", "Heaven Meadows", "heaven", 0.8, 0.6, None, None, None, None,
     None, "heaven_grass_block", "heaven_dirt", "sand",
     [("cherry", 0.02), ("oak", 0.01)],
     [("short_grass", 0.20), ("allium", 0.02), ("oxeye_daisy", 0.02),
      ("azure_bluet", 0.015)],
     [], "dmzplus:heaven_meadows", 10),
    ("deep_space", "Deep Space", "universe_7_deep_space", 0.5, 0.0, None, None, None,
     None, None, "asteroid_rock", "asteroid_rock", "asteroid_rock",
     [], [], [], "dmzplus:deep_space", 10),
    ("asteroid_field", "Asteroid Field", "universe_7_deep_space", 0.5, 0.0, None, None,
     None, None, None, "asteroid_rock", "space_metal", "asteroid_rock",
     [], [], [], "dmzplus:asteroid_field", 6),
    ("orbit", "Orbit", "orbit", 0.5, 0.0, None, None, None, None, None,
     "asteroid_rock", "asteroid_rock", "asteroid_rock",
     [], [], [], "dmzplus:orbit", 10),
]
# converted biome id -> source biome json (for the colour fields)
BIOME_SRC = {
    "ajissa_plains": "ajissa_plains", "namekian_rivers": "namekian_rivers",
    "namek_rocky": "rocky", "other_world": "other_world",
    "king_kai_planet": "other_world", "sacredkai_plains": "sacredkai_plains",
    "sacredkai_hills": "sacredkai_hills", "sacredkai_rivers": "sacredkai_rivers",
    "sacred_land": "sacred_land", "hyperbolic_time_chamber": "hyperbolic_time_chamber",
    "wasteland": "rocky", "vegeta_wasteland": "vegeta_wasteland",
    "yardrat_hills": "yardrat_hills", "vampa_barrens": "vampa_barrens",
    "cereal_mesa": "cereal_mesa", "hell_planet_wastes": "hell_planet_wastes",
    "heaven_meadows": "heaven_meadows", "deep_space": "deep_space",
    "asteroid_field": "asteroid_field", "orbit": "orbit",
}
QUEST_BIOME_VALUES = ["#minecraft:is_beach", "#minecraft:is_mountain",
                      "dragonminez:ajissa_plains", "dragonminez:rocky",
                      "dragonminez:sacredkai_plains", "minecraft:desert",
                      "minecraft:forest", "minecraft:plains", "minecraft:snowy_plains",
                      "minecraft:swamp"]

BIOMES = []


def build_biomes():
    for row in BIOME_TABLE:
        (bid, name, planet, temp, hum, grass, foliage, water, sky, fog,
         surface, filler, underwater, trees, plants, mobs, qtag, weight) = row
        src = SRC_BIOMES.get(BIOME_SRC.get(bid, ""), {})
        eff = src.get("effects", {})
        b = {
            "id": bid, "name": name, "planet": planet,
            "temperature": float(src.get("temperature", temp)),
            "humidity": float(src.get("downfall", hum)) if "downfall" in src else float(hum),
            "grass_color": hexcol(eff.get("grass_color")) or grass or "#91BD59",
            "foliage_color": hexcol(eff.get("foliage_color")) or foliage or grass or "#77AB2F",
            "water_color": hexcol(eff.get("water_color")) or water or "#3F76E4",
            "sky_tint": hexcol(eff.get("sky_color")) or sky or "#78A7FF",
            "fog_color": hexcol(eff.get("fog_color")) or fog or "#C0D8FF",
            "water_fog_color": hexcol(eff.get("water_fog_color")) or "#050533",
            "surface": blk(surface), "filler": blk(filler), "underwater": blk(underwater),
            "trees": [{"type": t, "density": d} for t, d in trees],
            "plants": [{"block": blk(p), "density": d} for p, d in plants],
            "mobs": [{"entity": e, "weight": w, "min": lo, "max": hi}
                     for e, w, lo, hi in mobs],
            "quest_tag": qtag,
            "weight": weight,
        }
        BIOMES.append(b)
    # every BIOME value used by the ported quests must resolve to exactly one biome
    by_tag = collections.Counter(b["quest_tag"] for b in BIOMES)
    for v in QUEST_BIOME_VALUES:
        if by_tag[v] != 1:
            raise SystemExit("quest BIOME value %s maps to %d biomes" % (v, by_tag[v]))
    for t, n in by_tag.items():
        if n != 1:
            raise SystemExit("duplicate quest_tag %s" % t)
    COUNTS["biomes"] = len(BIOMES)


# ================================================================ 5. structures
# --------------------------------------------------------- pure-python NBT reader
TAG_END, TAG_BYTE, TAG_SHORT, TAG_INT, TAG_LONG = 0, 1, 2, 3, 4
TAG_FLOAT, TAG_DOUBLE, TAG_BYTE_ARRAY, TAG_STRING = 5, 6, 7, 8
TAG_LIST, TAG_COMPOUND, TAG_INT_ARRAY, TAG_LONG_ARRAY = 9, 10, 11, 12


class NbtReader:
    """Minimal big-endian NBT parser (gzip or raw); nbtlib is not installed."""

    def __init__(self, buf):
        self.b = buf
        self.i = 0

    def _u(self, fmt, n):
        v = struct.unpack_from(fmt, self.b, self.i)[0]
        self.i += n
        return v

    def string(self):
        n = self._u(">H", 2)
        s = self.b[self.i:self.i + n]
        self.i += n
        return s.decode("utf-8", "replace")

    def payload(self, t):
        if t == TAG_BYTE:
            return self._u(">b", 1)
        if t == TAG_SHORT:
            return self._u(">h", 2)
        if t == TAG_INT:
            return self._u(">i", 4)
        if t == TAG_LONG:
            return self._u(">q", 8)
        if t == TAG_FLOAT:
            return self._u(">f", 4)
        if t == TAG_DOUBLE:
            return self._u(">d", 8)
        if t == TAG_BYTE_ARRAY:
            n = self._u(">i", 4)
            v = self.b[self.i:self.i + n]
            self.i += n
            return bytearray(v)
        if t == TAG_STRING:
            return self.string()
        if t == TAG_LIST:
            it = self._u(">b", 1)
            n = self._u(">i", 4)
            if n <= 0:
                return []
            return [self.payload(it) for _ in range(n)]
        if t == TAG_COMPOUND:
            out = {}
            while True:
                tt = self._u(">b", 1)
                if tt == TAG_END:
                    return out
                name = self.string()
                out[name] = self.payload(tt)
        if t == TAG_INT_ARRAY:
            n = self._u(">i", 4)
            v = struct.unpack_from(">%di" % n, self.b, self.i)
            self.i += 4 * n
            return list(v)
        if t == TAG_LONG_ARRAY:
            n = self._u(">i", 4)
            v = struct.unpack_from(">%dq" % n, self.b, self.i)
            self.i += 8 * n
            return list(v)
        raise ValueError("unknown NBT tag %d" % t)


def read_nbt(path):
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    r = NbtReader(raw)
    if r._u(">b", 1) != TAG_COMPOUND:
        raise ValueError("%s: not an NBT compound" % path)
    r.string()
    return r.payload(TAG_COMPOUND)


# --------------------------------------------------------- block name mapping
AIR_NAMES = {"minecraft:air", "minecraft:cave_air", "minecraft:void_air",
             "minecraft:light", "minecraft:jigsaw", "minecraft:structure_block",
             "minecraft:barrier", "minecraft:player_head", "minecraft:player_wall_head",
             "minecraft:cobweb", "minecraft:redstone_wire", "minecraft:comparator",
             "minecraft:repeater", "minecraft:lever", "minecraft:tripwire",
             "minecraft:tripwire_hook", "minecraft:piston_head", "minecraft:sticky_piston",
             "minecraft:stone_button", "minecraft:stone_pressure_plate",
             "minecraft:daylight_detector", "minecraft:sea_pickle", "minecraft:tube_coral",
             "minecraft:fire_coral_fan", "minecraft:dead_brain_coral_fan",
             "minecraft:dead_fire_coral_wall_fan", "minecraft:dead_horn_coral_fan",
             "minecraft:dead_horn_coral_wall_fan", "minecraft:bamboo",
             "minecraft:scaffolding"}
# explicit Minecraft/DMZ block -> our block id
BLOCK_MAP = {
    # stone family
    "minecraft:stone": "stone", "minecraft:cobblestone": "cobblestone",
    "minecraft:mossy_cobblestone": "mossy_cobblestone",
    "minecraft:stone_bricks": "stone_bricks", "minecraft:cracked_stone_bricks": "stone_bricks",
    "minecraft:mossy_stone_bricks": "mossy_cobblestone", "minecraft:chiseled_stone_bricks": "stone_bricks",
    "minecraft:smooth_stone": "smooth_stone", "minecraft:bricks": "bricks",
    "minecraft:polished_andesite": "smooth_stone", "minecraft:andesite": "stone",
    "minecraft:diorite": "smooth_stone", "minecraft:polished_diorite": "smooth_stone",
    "minecraft:granite": "stone", "minecraft:polished_granite": "smooth_stone",
    "minecraft:deepslate": "namek_deepslate", "minecraft:cobbled_deepslate": "cobblestone",
    "minecraft:polished_deepslate": "stone_bricks", "minecraft:deepslate_tiles": "stone_bricks",
    "minecraft:cracked_deepslate_tiles": "stone_bricks", "minecraft:deepslate_bricks": "stone_bricks",
    "minecraft:blackstone": "babidi_stone", "minecraft:polished_blackstone": "babidi_stone",
    "minecraft:polished_blackstone_bricks": "babidi_stone",
    "minecraft:chiseled_polished_blackstone": "babidi_stone_glyph",
    "minecraft:nether_bricks": "bricks", "minecraft:red_nether_bricks": "bricks",
    "minecraft:obsidian": "obsidian", "minecraft:crying_obsidian": "obsidian",
    "minecraft:bedrock": "bedrock", "minecraft:mud_bricks": "bricks",
    "minecraft:purpur_block": "white_concrete", "minecraft:purpur_pillar": "white_concrete",
    # earth
    "minecraft:dirt": "dirt", "minecraft:coarse_dirt": "coarse_dirt",
    "minecraft:rooted_dirt": "dirt", "minecraft:grass_block": "grass_block",
    "minecraft:podzol": "podzol", "minecraft:mycelium": "mycelium",
    "minecraft:dirt_path": "grass_path", "minecraft:grass_path": "grass_path",
    "minecraft:farmland": "farmland", "minecraft:mud": "clay",
    "minecraft:sand": "sand", "minecraft:red_sand": "red_sand", "minecraft:gravel": "gravel",
    "minecraft:clay": "clay", "minecraft:sandstone": "sandstone",
    "minecraft:smooth_sandstone": "sandstone", "minecraft:cut_sandstone": "sandstone",
    "minecraft:chiseled_sandstone": "sandstone", "minecraft:red_sandstone": "sandstone",
    "minecraft:snow_block": "snow_block", "minecraft:snow": "snow_layer",
    "minecraft:ice": "ice", "minecraft:packed_ice": "ice", "minecraft:blue_ice": "ice",
    "minecraft:water": "water", "minecraft:lava": "lava",
    # ores / metal
    "minecraft:coal_ore": "coal_ore", "minecraft:iron_ore": "iron_ore",
    "minecraft:copper_ore": "copper_ore", "minecraft:gold_ore": "gold_ore",
    "minecraft:redstone_ore": "redstone_ore", "minecraft:lapis_ore": "lapis_ore",
    "minecraft:diamond_ore": "diamond_ore", "minecraft:emerald_ore": "emerald_ore",
    "minecraft:iron_block": "iron_block", "minecraft:gold_block": "gold_block",
    "minecraft:diamond_block": "diamond_block", "minecraft:redstone_block": "red_concrete",
    "minecraft:copper_block": "light_blue_concrete",
    "minecraft:oxidized_copper": "light_blue_concrete",
    "minecraft:weathered_copper": "light_blue_concrete",
    "minecraft:exposed_copper": "orange_terracotta",
    "minecraft:oxidized_cut_copper": "light_blue_concrete",
    "minecraft:weathered_cut_copper": "light_blue_concrete",
    "minecraft:waxed_weathered_cut_copper": "light_blue_concrete",
    "minecraft:iron_door": "oak_door", "minecraft:iron_trapdoor": "oak_trapdoor",
    "minecraft:lightning_rod": "iron_bars", "minecraft:chain": "iron_bars",
    "minecraft:iron_bars": "iron_bars", "minecraft:anvil": "iron_block",
    "minecraft:cauldron": "iron_block", "minecraft:hopper": "iron_block",
    "minecraft:heavy_weighted_pressure_plate": "iron_block",
    "minecraft:tnt": "red_wool", "minecraft:bone_block": "bone_block",
    # quartz
    "minecraft:quartz_block": "quartz_block", "minecraft:chiseled_quartz_block": "quartz_block",
    "minecraft:quartz_bricks": "quartz_block", "minecraft:quartz_pillar": "quartz_block",
    "minecraft:smooth_quartz": "quartz_block",
    # glass
    "minecraft:glass": "glass", "minecraft:tinted_glass": "blue_stained_glass",
    "minecraft:white_stained_glass": "white_stained_glass",
    "minecraft:blue_stained_glass": "blue_stained_glass",
    "minecraft:light_blue_stained_glass": "light_blue_stained_glass",
    "minecraft:yellow_stained_glass": "yellow_stained_glass",
    "minecraft:red_stained_glass": "red_stained_glass",
    "minecraft:lime_stained_glass": "yellow_stained_glass",
    "minecraft:green_stained_glass": "blue_stained_glass",
    "minecraft:cyan_stained_glass": "light_blue_stained_glass",
    "minecraft:magenta_stained_glass": "blue_stained_glass",
    "minecraft:purple_stained_glass": "blue_stained_glass",
    "minecraft:pink_stained_glass": "red_stained_glass",
    "minecraft:light_gray_stained_glass": "white_stained_glass",
    "minecraft:gray_stained_glass": "blue_stained_glass",
    "minecraft:orange_stained_glass": "yellow_stained_glass",
    "minecraft:brown_stained_glass": "red_stained_glass",
    "minecraft:black_stained_glass": "blue_stained_glass",
    # wool / carpet / bed / banner
    "minecraft:white_wool": "white_wool", "minecraft:red_wool": "red_wool",
    "minecraft:orange_wool": "orange_wool", "minecraft:yellow_wool": "yellow_wool",
    "minecraft:blue_wool": "blue_wool", "minecraft:black_wool": "black_wool",
    "minecraft:light_blue_wool": "blue_wool", "minecraft:cyan_wool": "blue_wool",
    "minecraft:gray_wool": "black_wool", "minecraft:light_gray_wool": "white_wool",
    "minecraft:purple_wool": "blue_wool", "minecraft:magenta_wool": "red_wool",
    "minecraft:lime_wool": "yellow_wool", "minecraft:green_wool": "black_wool",
    "minecraft:pink_wool": "red_wool", "minecraft:brown_wool": "orange_wool",
    # concrete / terracotta
    "minecraft:white_concrete": "white_concrete", "minecraft:yellow_concrete": "yellow_concrete",
    "minecraft:light_blue_concrete": "light_blue_concrete",
    "minecraft:orange_concrete": "orange_concrete", "minecraft:red_concrete": "red_concrete",
    "minecraft:black_concrete": "black_concrete", "minecraft:blue_concrete": "light_blue_concrete",
    "minecraft:cyan_concrete": "light_blue_concrete", "minecraft:gray_concrete": "black_concrete",
    "minecraft:light_gray_concrete": "white_concrete", "minecraft:green_concrete": "black_concrete",
    "minecraft:lime_concrete": "yellow_concrete", "minecraft:purple_concrete": "blue_wool",
    "minecraft:magenta_concrete": "red_concrete", "minecraft:pink_concrete": "red_concrete",
    "minecraft:brown_concrete": "brown_terracotta",
    "minecraft:lime_concrete_powder": "yellow_concrete",
    "minecraft:white_concrete_powder": "white_concrete",
    "minecraft:terracotta": "terracotta", "minecraft:white_terracotta": "white_terracotta",
    "minecraft:orange_terracotta": "orange_terracotta",
    "minecraft:brown_terracotta": "brown_terracotta", "minecraft:red_terracotta": "red_terracotta",
    "minecraft:yellow_terracotta": "yellow_terracotta",
    "minecraft:light_blue_terracotta": "light_blue_concrete",
    "minecraft:cyan_terracotta": "light_blue_concrete",
    "minecraft:blue_terracotta": "light_blue_concrete",
    "minecraft:magenta_terracotta": "red_terracotta",
    "minecraft:purple_terracotta": "babidi_stone",
    "minecraft:gray_terracotta": "black_concrete",
    "minecraft:light_gray_terracotta": "white_terracotta",
    "minecraft:green_terracotta": "brown_terracotta",
    "minecraft:pink_terracotta": "red_terracotta",
    "minecraft:black_terracotta": "black_concrete",
    # light
    "minecraft:glowstone": "glowstone", "minecraft:sea_lantern": "glowstone",
    "minecraft:shroomlight": "glowstone", "minecraft:ochre_froglight": "glowstone",
    "minecraft:verdant_froglight": "glowstone", "minecraft:pearlescent_froglight": "glowstone",
    "minecraft:lantern": "lantern", "minecraft:soul_lantern": "lantern",
    "minecraft:torch": "torch", "minecraft:wall_torch": "torch",
    "minecraft:soul_torch": "torch", "minecraft:redstone_torch": "torch",
    "minecraft:redstone_wall_torch": "torch", "minecraft:campfire": "torch",
    "minecraft:soul_campfire": "torch", "minecraft:candle": "torch",
    "minecraft:white_candle": "torch", "minecraft:magenta_candle": "torch",
    "minecraft:beacon": "halo_light",
    # furniture / utility
    "minecraft:crafting_table": "crafting_table", "minecraft:furnace": "furnace",
    "minecraft:blast_furnace": "furnace", "minecraft:smoker": "furnace",
    "minecraft:chest": "chest", "minecraft:trapped_chest": "chest",
    "minecraft:ender_chest": "chest", "minecraft:barrel": "chest",
    "minecraft:bookshelf": "bookshelf", "minecraft:chiseled_bookshelf": "bookshelf",
    "minecraft:enchanting_table": "bookshelf", "minecraft:lectern": "bookshelf",
    "minecraft:smithing_table": "crafting_table", "minecraft:fletching_table": "crafting_table",
    "minecraft:cartography_table": "crafting_table", "minecraft:loom": "crafting_table",
    "minecraft:grindstone": "smooth_stone", "minecraft:stonecutter": "smooth_stone",
    "minecraft:composter": "oak_planks", "minecraft:bee_nest": "oak_log",
    "minecraft:beehive": "oak_log", "minecraft:ladder": "ladder",
    "minecraft:hay_block": "hay_block", "minecraft:melon": "melon",
    "minecraft:pumpkin": "pumpkin", "minecraft:carved_pumpkin": "pumpkin",
    "minecraft:jack_o_lantern": "pumpkin", "minecraft:cactus": "cactus",
    "minecraft:sugar_cane": "sugar_cane", "minecraft:mushroom_stem": "bone_block",
    "minecraft:brown_mushroom_block": "brown_mushroom", "minecraft:red_mushroom_block": "red_mushroom",
    # plants
    "minecraft:grass": "short_grass", "minecraft:short_grass": "short_grass",
    "minecraft:tall_grass": "tall_grass", "minecraft:fern": "fern",
    "minecraft:large_fern": "large_fern", "minecraft:dead_bush": "dead_bush",
    "minecraft:dandelion": "dandelion", "minecraft:poppy": "poppy",
    "minecraft:blue_orchid": "blue_orchid", "minecraft:allium": "allium",
    "minecraft:azure_bluet": "azure_bluet", "minecraft:red_tulip": "red_tulip",
    "minecraft:orange_tulip": "orange_tulip", "minecraft:white_tulip": "oxeye_daisy",
    "minecraft:pink_tulip": "red_tulip", "minecraft:oxeye_daisy": "oxeye_daisy",
    "minecraft:cornflower": "cornflower", "minecraft:lily_of_the_valley": "azure_bluet",
    "minecraft:torchflower": "poppy", "minecraft:sunflower": "sunflower",
    "minecraft:lilac": "lilac", "minecraft:rose_bush": "rose_bush",
    "minecraft:peony": "lilac", "minecraft:brown_mushroom": "brown_mushroom",
    "minecraft:red_mushroom": "red_mushroom", "minecraft:vine": "vine",
    "minecraft:lily_pad": "lily_pad", "minecraft:moss_carpet": "short_grass",
    "minecraft:moss_block": "grass_block", "minecraft:wheat": "wheat",
    "minecraft:carrots": "carrots", "minecraft:potatoes": "potatoes",
    "minecraft:beetroots": "beetroots", "minecraft:sweet_berry_bush": "red_mushroom",
    "minecraft:flower_pot": "air",
    # dmz
    "dragonminez:healing_liquid_block": "water",
    "dragonminez:invisible_ladder_block": "ladder",
    "dragonminez:fuel_generator": "gete_block",
    "dragonminez:energy_cable": "gete_block",
    "dragonminez:namek_ajissa_leaves": "ajissa_leaves",
    "dragonminez:namek_ajissa_log": "ajissa_log",
    "dragonminez:namek_ajissa_wood": "ajissa_log",
    "dragonminez:namek_ajissa_planks": "ajissa_planks",
    "dragonminez:namek_ajissa_fence": "ajissa_fence",
    "dragonminez:namek_ajissa_door": "ajissa_door",
    "dragonminez:namek_ajissa_trapdoor": "oak_trapdoor",
    "dragonminez:namek_ajissa_slab": "oak_slab",
    "dragonminez:namek_sacred_leaves": "sacred_leaves",
    "dragonminez:namek_sacred_log": "sacred_log",
    "dragonminez:namek_sacred_wood": "sacred_log",
    "dragonminez:namek_sacred_planks": "sacred_planks",
    "dragonminez:namek_sacred_fence": "sacred_fence",
    "dragonminez:namek_sacred_door": "ajissa_door",
    "dragonminez:namek_sacred_trapdoor": "oak_trapdoor",
    "dragonminez:namek_sacred_slab": "oak_slab",
    "dragonminez:namek_sacred_grass": "namek_sacred_grass",
    "dragonminez:namek_sacred_grass_block": "namek_sacred_grass_block",
    "dragonminez:sacred_amaryllis_flower": "amaryllis_flower",
    "dragonminez:sacred_catharanthus_roseus_flower": "catharanthus_roseus_flower",
    "dragonminez:sacred_marigold_flower": "marigold_flower",
    "dragonminez:rocky_stone_wall": "rocky_stone",
    "dragonminez:rocky_stone_slab": "stone_slab",
    "dragonminez:rocky_cobblestone_wall": "rocky_cobblestone",
}
# generic suffix rules applied when no explicit mapping exists
WOOD_PREFIXES = {
    "oak": "oak", "spruce": "spruce", "birch": "birch", "jungle": "jungle",
    "acacia": "acacia", "dark_oak": "dark_oak", "cherry": "cherry",
    "mangrove": "acacia", "crimson": "dark_oak", "warped": "spruce",
    "bamboo": "jungle", "stripped_oak": "oak", "stripped_spruce": "spruce",
    "stripped_birch": "birch", "stripped_jungle": "jungle", "stripped_acacia": "acacia",
    "stripped_dark_oak": "dark_oak", "stripped_cherry": "cherry",
    "stripped_mangrove": "acacia",
}
UNMAPPED_BLOCKS = collections.Counter()
BLOCK_MAP_USED = {}


def _base_block(bare):
    """The full block a stairs/slab/wall variant is cut from (handles 'brick(s)')."""
    for cand in (bare, bare + "s", bare + "_block", bare + "_blocks"):
        for ns in ("minecraft:", "dragonminez:"):
            if ns + cand in BLOCK_MAP:
                return blk(BLOCK_MAP[ns + cand])
        if cand in BLOCK_SET:
            return cand
    return map_block("minecraft:" + bare)


def map_block(name):
    """Minecraft/DMZ block name -> our block id ('air' for things we drop)."""
    if name in BLOCK_MAP_USED:
        return BLOCK_MAP_USED[name]
    out = _map_block(name)
    BLOCK_MAP_USED[name] = out
    return out


def _map_block(name):
    if name in AIR_NAMES:
        return "air"
    if name in BLOCK_MAP:
        return blk(BLOCK_MAP[name])
    bare = strip_ns(name)
    if bare in BLOCK_SET:
        return bare
    # signs / banners / heads: decoration we cannot render
    if re.search(r"(_sign|_banner|_head|_skull|_pot|_bed)$", bare) or "hanging_sign" in bare:
        if bare.endswith("_bed") or bare.endswith("_banner"):
            col = bare.rsplit("_", 1)[0].replace("_wall", "")
            wool = "%s_wool" % col
            return blk(BLOCK_MAP.get("minecraft:" + wool, "white_wool"))
        return "air"
    if bare.startswith("potted_"):
        inner = bare[len("potted_"):]
        for ns in ("minecraft:", "dragonminez:"):
            if ns + inner in BLOCK_MAP:
                return blk(BLOCK_MAP[ns + inner])
        if inner in BLOCK_SET:
            return inner
        return "air"
    if bare.endswith("_carpet"):
        col = bare[:-len("_carpet")]
        return blk(BLOCK_MAP.get("minecraft:%s_wool" % col, "white_wool"))
    # wood family
    m = re.match(r"^(.*)_(log|wood|planks|leaves|sapling|fence|fence_gate|door|"
                 r"trapdoor|slab|stairs|button|pressure_plate|sign)$", bare)
    if m:
        pre, kind = m.group(1), m.group(2)
        if pre in WOOD_PREFIXES:
            w = WOOD_PREFIXES[pre]
            cand = {
                "log": "%s_log" % w, "wood": "%s_log" % w, "planks": "%s_planks" % w,
                "leaves": "%s_leaves" % w, "sapling": "%s_sapling" % w,
                "fence": "%s_fence" % w, "fence_gate": "%s_fence" % w,
                "door": "%s_door" % w, "trapdoor": "oak_trapdoor", "slab": "oak_slab",
                "stairs": "%s_planks" % w, "button": "air", "pressure_plate": "air",
                "sign": "air",
            }[kind]
            if cand == "air" or cand in BLOCK_SET:
                return cand
            # fall back through the wood chain
            for alt in ("oak_%s" % kind, "oak_planks"):
                if alt in BLOCK_SET:
                    return alt
    # stone-ish shapes
    if bare.endswith("_pane"):
        return "glass"
    if bare.endswith("_slab"):
        base = _base_block(bare[:-len("_slab")])
        mat = BLOCK_BY_ID.get(base, {}).get("material", "stone")
        return "oak_slab" if mat == "wood" else "stone_slab"
    if bare.endswith("_stairs"):
        return _base_block(bare[:-len("_stairs")])
    if bare.endswith("_wall"):
        return _base_block(bare[:-len("_wall")])
    if bare.endswith("_button") or bare.endswith("_pressure_plate"):
        return "air"
    UNMAPPED_BLOCKS[name] += 1
    return "stone"


# --------------------------------------------------------- structure conversion
NBT_ENTITY_MAP = {
    "minecraft:villager": "cc_namekian", "minecraft:armor_stand": None,
    "minecraft:bat": None, "minecraft:bee": None, "dragonminez:quest_npc": None,
}
STRUCT_FILES = {}     # out name -> {"size":..., blocks...}
STRUCT_SIZES = {}


def structure_rel(name):
    return "assets/structures/%s.json" % name


def write_structure(name, size, palette, blocks, entities, origin_offset,
                    clear_box=False):
    path = os.path.join(STRUCT_OUT, name + ".json")
    os.makedirs(STRUCT_OUT, exist_ok=True)
    doc = {
        "size": [int(size[0]), int(size[1]), int(size[2])],
        "palette": palette,
        "blocks": blocks,
        "entities": entities,
        "origin_offset": [int(origin_offset[0]), int(origin_offset[1]),
                          int(origin_offset[2])],
        "clear_box": bool(clear_box),
    }
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    STRUCT_SIZES[name] = (tuple(doc["size"]), len(blocks), len(entities),
                          os.path.getsize(path))
    return path


def convert_nbt_structure(out_name, nbt_path, entity_dirs=()):
    d = read_nbt(nbt_path)
    sx, sy, sz = [int(v) for v in d["size"]]
    src_pal = [p.get("Name", "minecraft:air") for p in d.get("palette", [])]
    mapped = [map_block(n) for n in src_pal]
    # our palette, index 0 is always air
    palette = ["air"]
    pal_index = {"air": 0}
    src_to_out = []
    for m in mapped:
        if m not in pal_index:
            pal_index[m] = len(palette)
            palette.append(m)
        src_to_out.append(pal_index[m])

    grid = {}
    for b in d.get("blocks", []):
        p = b["pos"]
        grid[(int(p[0]), int(p[1]), int(p[2]))] = src_to_out[int(b["state"])]

    # flood fill the air that is connected to the outside so it is not stored;
    # enclosed air is kept so the structure carves out its own interior.
    outside = set()
    q = deque()

    def is_air(p):
        return grid.get(p, 0) == 0

    for x in range(sx):
        for z in range(sz):
            for y in (0, sy - 1):
                if is_air((x, y, z)):
                    q.append((x, y, z))
    for y in range(sy):
        for x in range(sx):
            for z in (0, sz - 1):
                if is_air((x, y, z)):
                    q.append((x, y, z))
        for z in range(sz):
            for x in (0, sx - 1):
                if is_air((x, y, z)):
                    q.append((x, y, z))
    while q:
        p = q.popleft()
        if p in outside:
            continue
        outside.add(p)
        x, y, z = p
        for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
            n = (x + dx, y + dy, z + dz)
            if 0 <= n[0] < sx and 0 <= n[1] < sy and 0 <= n[2] < sz \
                    and n not in outside and is_air(n):
                q.append(n)

    blocks = []
    for p in sorted(grid):
        idx = grid[p]
        if idx == 0 and p in outside:
            continue
        blocks.append([p[0], p[1], p[2], idx])

    entities = []
    spawn_ids = []
    for e in d.get("entities", []):
        eid = e.get("nbt", {}).get("id", "")
        our = NBT_ENTITY_MAP.get(eid, strip_ns(eid) if eid else None)
        if our is None:
            if eid:
                subst("structure %s: entity %s dropped" % (out_name, eid))
            continue
        pos = e.get("blockPos") or e.get("pos") or [0, 0, 0]
        entities.append({"id": our, "pos": [int(pos[0]), int(pos[1]), int(pos[2])]})
        spawn_ids.append(our)
    # village piece NPC templates live in sibling entities/ folders
    for ed in entity_dirs:
        for path in sorted(glob.glob(os.path.join(ed, "**", "*.nbt"), recursive=True)):
            ed_nbt = read_nbt(path)
            for e in ed_nbt.get("entities", []):
                eid = e.get("nbt", {}).get("id", "")
                our = NBT_ENTITY_MAP.get(eid, strip_ns(eid) if eid else None)
                if our:
                    spawn_ids.append(our)

    write_structure(out_name, (sx, sy, sz), palette, blocks, entities,
                    (-(sx // 2), 0, -(sz // 2)), clear_box=False)
    return sorted(set(spawn_ids))


# --------------------------------------------------------- procedural structures
class Volume:
    """Sparse voxel volume builder used by the procedural structures."""

    def __init__(self):
        self.cells = {}

    def set(self, x, y, z, bid):
        self.cells[(int(x), int(y), int(z))] = blk(bid)

    def fill(self, x0, y0, z0, x1, y1, z1, bid):
        for x in range(min(x0, x1), max(x0, x1) + 1):
            for y in range(min(y0, y1), max(y0, y1) + 1):
                for z in range(min(z0, z1), max(z0, z1) + 1):
                    self.set(x, y, z, bid)

    def hollow_box(self, x0, y0, z0, x1, y1, z1, wall, floor=None, roof=None):
        self.fill(x0, y0, z0, x1, y1, z1, wall)
        if x1 - x0 >= 2 and y1 - y0 >= 2 and z1 - z0 >= 2:
            self.fill(x0 + 1, y0 + 1, z0 + 1, x1 - 1, y1 - 1, z1 - 1, "air")
        if floor:
            self.fill(x0, y0, z0, x1, y0, z1, floor)
        if roof:
            self.fill(x0, y1, z0, x1, y1, z1, roof)

    def sphere(self, cx, cy, cz, r, bid, shell=False, half=False):
        for x in range(cx - r, cx + r + 1):
            for y in range(cy - r, cy + r + 1):
                for z in range(cz - r, cz + r + 1):
                    if half and y < cy:
                        continue
                    d = math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2)
                    if d <= r + 0.5 and (not shell or d >= r - 0.6):
                        self.set(x, y, z, bid)

    def cylinder(self, cx, y0, cz, r, h, bid, shell=False):
        for y in range(y0, y0 + h):
            for x in range(cx - r, cx + r + 1):
                for z in range(cz - r, cz + r + 1):
                    d = math.sqrt((x - cx) ** 2 + (z - cz) ** 2)
                    if d <= r + 0.5 and (not shell or d >= r - 0.6):
                        self.set(x, y, z, bid)

    def emit(self, name, entities=(), clear_box=False, y_anchor=0):
        if not self.cells:
            raise SystemExit("empty procedural structure %s" % name)
        xs = [p[0] for p in self.cells]
        ys = [p[1] for p in self.cells]
        zs = [p[2] for p in self.cells]
        ox, oy, oz = min(xs), min(ys), min(zs)
        size = (max(xs) - ox + 1, max(ys) - oy + 1, max(zs) - oz + 1)
        palette = ["air"]
        pal_index = {"air": 0}
        blocks = []
        for p in sorted(self.cells):
            bid = self.cells[p]
            if bid not in pal_index:
                pal_index[bid] = len(palette)
                palette.append(bid)
            blocks.append([p[0] - ox, p[1] - oy, p[2] - oz, pal_index[bid]])
        ents = [{"id": e[0], "pos": [e[1] - ox, e[2] - oy, e[3] - oz]} for e in entities]
        write_structure(name, size, palette, blocks, ents,
                        (ox, oy - y_anchor, oz), clear_box=clear_box)


def proc_capsule_corp():
    v = Volume()
    # domed white/yellow Capsule Corp building, ~20x17x20
    R = 9
    v.cylinder(0, 0, 0, R, 1, "white_concrete")                 # foundation
    v.cylinder(0, 1, 0, R, 6, "capsule_corp_wall", shell=True)  # walls y=1..6
    for y in (3, 4):                                            # window band
        for x in range(-R, R + 1):
            for z in range(-R, R + 1):
                d = math.sqrt(x * x + z * z)
                if R - 0.6 <= d <= R + 0.5 and (x + z) % 3 != 0:
                    v.set(x, y, z, "light_blue_stained_glass")
    v.cylinder(0, 7, 0, R, 1, "yellow_concrete", shell=True)    # trim ring
    for y in range(8, 8 + R):                                   # dome
        rr = int(round(math.sqrt(max(0.0, R * R - (y - 7) ** 2))))
        if rr <= 1:
            v.cylinder(0, y, 0, max(rr, 0), 1, "capsule_corp_wall")
            break
        v.cylinder(0, y, 0, rr, 1, "capsule_corp_wall", shell=True)
    # entrance + logo
    v.fill(-1, 1, -R, 1, 3, -R, "air")
    for x in (-1, 0, 1):
        v.set(x, 4, -R, "capsule_corp_logo")
    # interior: floor, lights and workstations
    v.cylinder(0, 1, 0, R - 1, 1, "smooth_stone")
    v.fill(-2, 1, 3, 2, 1, 5, "lookout_tile")
    for (x, z) in ((-4, -4), (4, -4), (-4, 4), (4, 4)):
        v.set(x, 7, z, "glowstone")
    v.set(-3, 2, 4, "gravity_device")
    v.set(3, 2, 4, "kikono_station")
    v.set(0, 2, 6, "crafting_table")
    v.set(-6, 2, 0, "chest")
    ents = [("master_vegeta", 3, 2, -3), ("master_trunks", -3, 2, -3),
            ("saga_bulma", 0, 2, 4), ("master_toribot", -5, 2, 0)]
    v.emit("capsule_corp", ents, clear_box=True)


def proc_korin_tower():
    v = Volume()
    H = 90
    for y in range(0, H):
        v.set(0, y, 0, "korin_tower_block")
    # base flare
    v.cylinder(0, 0, 0, 2, 3, "korin_tower_block")
    # platform on top
    v.cylinder(0, H, 0, 6, 1, "korin_tower_block")
    v.cylinder(0, H + 1, 0, 6, 1, "lookout_tile")
    # small house
    v.hollow_box(-3, H + 2, -3, 3, H + 6, 3, "kame_house_wall",
                 floor="lookout_tile", roof="kame_house_roof")
    v.fill(-1, H + 2, -3, 1, H + 4, -3, "air")
    v.set(0, H + 3, 3, "yellow_stained_glass")
    v.set(-2, H + 3, 0, "chest")
    v.set(2, H + 3, 0, "training_post")
    for y in range(3, H):                            # climbable all the way up
        v.set(1, y, 0, "ladder")
    v.emit("korin_tower", [], clear_box=False)


def proc_snake_way():
    v = Volume()
    # 64-long S-curve of snake_way with edges
    length = 64
    for i in range(length):
        t = i / float(length - 1)
        z = i
        x = int(round(6.0 * math.sin(t * math.pi * 2.0)))
        y = int(round(2.0 * math.sin(t * math.pi * 4.0)))
        for dx in (-2, -1, 0, 1, 2):
            v.set(x + dx, y, z, "snake_way")
        v.set(x - 3, y, z, "snake_way_edge")
        v.set(x + 3, y, z, "snake_way_edge")
        v.set(x - 3, y + 1, z, "snake_way_edge")
        v.set(x + 3, y + 1, z, "snake_way_edge")
    v.emit("snake_way", [], clear_box=False)


def proc_king_kai_planet():
    v = Volume()
    R = 12
    v.sphere(0, 0, 0, R, "kai_grass_block")
    v.sphere(0, 0, 0, R - 1, "dirt")
    v.sphere(0, 0, 0, R - 4, "namek_stone")
    # road ring
    for a in range(0, 360, 4):
        x = int(round((R - 2) * math.cos(math.radians(a))))
        z = int(round((R - 2) * math.sin(math.radians(a))))
        y = int(round(math.sqrt(max(0.0, R * R - x * x - z * z))))
        v.set(x, y, z, "grass_path")
    # house
    v.hollow_box(-3, R, -3, 3, R + 4, 3, "king_kai_house_wall",
                 floor="lookout_tile", roof="kame_house_roof")
    v.fill(-1, R, -3, 1, R + 2, -3, "air")
    v.set(0, R + 2, 3, "yellow_stained_glass")
    v.set(2, R + 1, 0, "chest")
    # tree + training post
    v.fill(6, R, 5, 6, R + 4, 5, "oak_log")
    v.sphere(6, R + 5, 5, 2, "oak_leaves")
    v.set(-6, R, 4, "training_post")
    v.set(-6, R, -4, "gravity_device")
    v.emit("king_kai_planet", [("master_kaiosama", 0, R + 1, 0)], clear_box=False)


def proc_check_in_station():
    v = Volume()
    # King Yemma's check-in station, 24x12x16
    v.hollow_box(-12, 0, -8, 11, 11, 7, "check_in_wood", floor="check_in_wood",
                 roof="check_in_wood")
    v.fill(-2, 0, -8, 2, 6, -8, "air")          # main gate
    v.fill(-12, 11, -8, 11, 11, 7, "check_in_wood")
    for x in range(-11, 11, 4):
        v.set(x, 8, -8, "halo_light")
    # Yemma's desk
    v.fill(-6, 1, 3, 6, 2, 6, "check_in_wood")
    v.fill(-6, 3, 3, 6, 3, 6, "smooth_stone")
    v.set(0, 4, 5, "chest")
    for z in (-6, 0, 6):
        v.set(-11, 1, z, "lantern")
        v.set(10, 1, z, "lantern")
    v.fill(-11, 1, -7, 10, 1, 2, "lookout_tile")
    v.emit("check_in_station", [("master_enma", 0, 4, 4)], clear_box=True)


def proc_hell_gate():
    v = Volume()
    v.fill(-6, 0, -1, 6, 1, 1, "hell_rock")
    for y in range(2, 12):
        v.fill(-6, y, -1, -4, y, 1, "hell_rock")
        v.fill(4, y, -1, 6, y, 1, "hell_rock")
    v.fill(-6, 12, -1, 6, 13, 1, "hell_rock")
    v.fill(-3, 9, 0, 3, 11, 0, "hell_rock_molten")   # glowing lintel, gate stays open
    for x in (-5, 5):
        v.set(x, 13, 0, "halo_light")
    v.emit("hell_gate", [], clear_box=True)


def proc_heaven_arch():
    v = Volume()
    for y in range(0, 10):
        v.fill(-7, y, -1, -5, y, 1, "heaven_cloud")
        v.fill(5, y, -1, 7, y, 1, "heaven_cloud")
    for x in range(-7, 8):
        h = 10 + int(round(3.0 * math.cos(x / 7.0 * math.pi / 2.0)))
        v.fill(x, 10, -1, x, h, 1, "heaven_cloud")
        if abs(x) <= 4:
            v.set(x, h, 0, "halo_light")
    v.fill(-4, 0, -2, 4, 0, 2, "heaven_grass_block")
    v.emit("heaven_arch", [], clear_box=True)


def proc_kai_shrine():
    v = Volume()
    v.cylinder(0, 0, 0, 7, 1, "sacred_planet_grass_block")
    v.cylinder(0, 1, 0, 6, 1, "lookout_tile")
    for a in range(0, 360, 45):
        x = int(round(5 * math.cos(math.radians(a))))
        z = int(round(5 * math.sin(math.radians(a))))
        v.fill(x, 2, z, x, 6, z, "sacred_log")
        v.set(x, 7, z, "halo_light")
    v.fill(-6, 7, -6, 6, 7, 6, "sacred_planks")
    v.fill(-1, 2, -1, 1, 2, 1, "dragon_ball_altar")
    v.set(0, 3, 0, "ki_barrier")
    v.emit("kai_shrine", [], clear_box=True)


PROCEDURAL = [
    ("capsule_corp", proc_capsule_corp),
    ("korin_tower", proc_korin_tower),
    ("snake_way", proc_snake_way),
    ("king_kai_planet", proc_king_kai_planet),
    ("check_in_station", proc_check_in_station),
    ("hell_gate", proc_hell_gate),
    ("heaven_arch", proc_heaven_arch),
    ("kai_shrine", proc_kai_shrine),
]

# ---- NBT structures: out name -> (nbt relative path, registry entry)
NBT_STRUCTURES = [
    ("roshi_house", "roshi_house.nbt", {
        "planet": "earth", "biomes": ["beach", "ocean"], "rarity": 40,
        "y_mode": "surface", "unique": True, "clear_above": False,
        "quest_tag": "dragonminez:roshi_house", "min_distance_from_spawn": 200}),
    ("goku_house", "goku_house.nbt", {
        "planet": "earth", "biomes": ["plains", "sunflower_plains", "meadow"],
        "rarity": 60, "y_mode": "surface", "unique": True, "clear_above": False,
        "quest_tag": "dragonminez:goku_house", "min_distance_from_spawn": 320}),
    # the DMZ lookout NBT contains Korin Tower as its lower 100 blocks (Korin
    # included), so it is anchored on the ground, not in the sky.
    ("kami_lookout", "kamilookout.nbt", {
        "planet": "earth", "biomes": [], "rarity": 1, "y_mode": "surface",
        "unique": True, "clear_above": True, "quest_tag": "dragonminez:kamilookout",
        "min_distance_from_spawn": 0, "fixed_position": [0, 0, 0]}),
    ("cell_arena", "cell_arena.nbt", {
        "planet": "earth", "biomes": ["plains", "sunflower_plains", "savanna"],
        "rarity": 90, "y_mode": "surface", "unique": True, "clear_above": True,
        "quest_tag": "dragonminez:cell_arena", "min_distance_from_spawn": 600}),
    ("gero_lab", "gero_lab_surface.nbt", {
        "planet": "earth", "biomes": ["wasteland"], "rarity": 70, "y_mode": "surface",
        "unique": True, "clear_above": False, "quest_tag": "dragonminez:gero_lab",
        "min_distance_from_spawn": 400, "group": "gero_lab"}),
    ("gero_lab_stairs", "gero_lab_stairs.nbt", {
        "planet": "earth", "biomes": ["wasteland"], "rarity": 0, "y_mode": "absolute",
        "y": 20, "unique": True, "clear_above": False, "group": "gero_lab",
        "min_distance_from_spawn": 400}),
    ("gero_lab_underground", "gero_lab_underground.nbt", {
        "planet": "earth", "biomes": ["wasteland"], "rarity": 0, "y_mode": "absolute",
        "y": 6, "unique": True, "clear_above": False, "group": "gero_lab",
        "min_distance_from_spawn": 400}),
    ("rr_tower", "rrtower.nbt", {
        "planet": "earth", "biomes": ["plains", "forest", "birch_forest", "desert",
                                      "savanna", "taiga", "snowy_plains", "badlands",
                                      "jungle", "mountains", "meadow", "cherry_grove",
                                      "swamp", "river", "mushroom_fields", "ice_spikes",
                                      "snowy_taiga", "dark_forest", "sunflower_plains"],
        "rarity": 48, "y_mode": "surface", "unique": False, "clear_above": True,
        "quest_tag": "dragonminez:rrtower", "min_distance_from_spawn": 240}),
    ("piccolo_house", "piccolo_house.nbt", {
        "planet": "earth", "biomes": ["wasteland", "mountains", "badlands", "forest",
                                      "taiga", "desert", "savanna"],
        "rarity": 80, "y_mode": "surface", "unique": True, "clear_above": False,
        "quest_tag": "dragonminez:piccolo_house", "min_distance_from_spawn": 300}),
    ("yamcha_house", "yamcha_house.nbt", {
        "planet": "earth", "biomes": ["desert", "badlands"], "rarity": 70,
        "y_mode": "surface", "unique": True, "clear_above": False,
        "quest_tag": "dragonminez:yamcha_house", "min_distance_from_spawn": 300}),
    ("vegeta_pod", "vegeta_pod.nbt", {
        "planet": "earth", "biomes": ["wasteland", "mountains", "badlands"],
        "rarity": 60, "y_mode": "surface", "unique": True, "clear_above": False,
        "quest_tag": "dragonminez:vegeta_pod", "min_distance_from_spawn": 260}),
    ("trunks_ship", "trunks_ship.nbt", {
        "planet": "earth", "biomes": ["plains", "forest", "wasteland", "taiga",
                                      "savanna", "mountains"],
        "rarity": 90, "y_mode": "surface", "unique": True, "clear_above": False,
        "quest_tag": "dragonminez:trunks_ship", "min_distance_from_spawn": 360}),
    ("babidi_ship", "babidi_surface.nbt", {
        "planet": "earth", "biomes": ["mountains", "wasteland", "badlands"],
        "rarity": 100, "y_mode": "surface", "unique": True, "clear_above": False,
        "quest_tag": "dragonminez:babidi", "min_distance_from_spawn": 500,
        "group": "babidi"}),
    ("babidi_top", "babidi_top.nbt", {
        "planet": "earth", "biomes": ["mountains", "wasteland", "badlands"],
        "rarity": 0, "y_mode": "absolute", "y": 90, "unique": True,
        "clear_above": False, "group": "babidi", "min_distance_from_spawn": 500}),
    ("babidi_bottom", "babidi_bottom.nbt", {
        "planet": "earth", "biomes": ["mountains", "wasteland", "badlands"],
        "rarity": 0, "y_mode": "absolute", "y": 4, "unique": True,
        "clear_above": False, "group": "babidi", "min_distance_from_spawn": 500}),
    ("cc_villager", "cc_villager.nbt", {
        "planet": "earth", "biomes": ["plains", "sunflower_plains", "forest", "meadow",
                                      "savanna", "taiga"],
        "rarity": 24, "y_mode": "surface", "unique": False, "clear_above": False,
        "min_distance_from_spawn": 80}),
    ("elder_guru", "elder_guru.nbt", {
        "planet": "namek", "biomes": ["ajissa_plains", "namekian_rivers"], "rarity": 1,
        "y_mode": "surface", "unique": True, "clear_above": False,
        "quest_tag": "dragonminez:elder_guru", "min_distance_from_spawn": 400}),
    ("frieza_ship", "frieza_ship.nbt", {
        "planet": "namek", "biomes": ["ajissa_plains"], "rarity": 80,
        "y_mode": "absolute", "y": 60, "unique": True, "clear_above": True,
        "quest_tag": "dragonminez:frieza_ship", "min_distance_from_spawn": 500}),
    ("old_kai_pillar", "oldkai_pillar.nbt", {
        "planet": "sacred_kai_planet", "biomes": ["sacredkai_plains"], "rarity": 1,
        "y_mode": "surface", "unique": True, "clear_above": True,
        "quest_tag": "dragonminez:oldkai_pillar", "min_distance_from_spawn": 120}),
    ("time_chamber", "timechamber.nbt", {
        "planet": "time_chamber", "biomes": ["hyperbolic_time_chamber"], "rarity": 1,
        "y_mode": "absolute", "y": 8, "unique": True, "clear_above": False,
        "quest_tag": "dragonminez:timechamber", "min_distance_from_spawn": 0,
        "fixed_position": [0, 8, 0]}),
]
VILLAGE_PIECES = [
    ("village_ajissa_center", "village_ajissa/ajissa_center/ajissa_center.nbt", "namek",
     ["ajissa_plains"], True),
    ("village_ajissa_house_big", "village_ajissa/houses/residence/ajissa_house_big.nbt",
     "namek", ["ajissa_plains"], False),
    ("village_ajissa_house_small",
     "village_ajissa/houses/residence/ajissa_house_small.nbt", "namek",
     ["ajissa_plains"], False),
    ("village_ajissa_cc_house", "village_ajissa/houses/cc_namekian_house.nbt", "namek",
     ["ajissa_plains"], False),
    ("village_ajissa_street_straight", "village_ajissa/streets/street_straight.nbt",
     "namek", ["ajissa_plains"], False),
    ("village_ajissa_street_curve", "village_ajissa/streets/street_curve.nbt", "namek",
     ["ajissa_plains"], False),
    ("village_ajissa_street_t", "village_ajissa/streets/street_t.nbt", "namek",
     ["ajissa_plains"], False),
    ("village_ajissa_street_cross", "village_ajissa/streets/street_cross.nbt", "namek",
     ["ajissa_plains"], False),
    ("village_sacred_center", "village_sacred/sacred_center/sacred_center.nbt",
     "sacred_kai_planet", ["sacred_land"], True),
    ("village_sacred_house_big", "village_sacred/houses/residence/sacred_house_big.nbt",
     "sacred_kai_planet", ["sacred_land"], False),
    ("village_sacred_house_small",
     "village_sacred/houses/residence/sacred_house_small.nbt", "sacred_kai_planet",
     ["sacred_land"], False),
    ("village_sacred_street_straight", "village_sacred/streets/street_straight.nbt",
     "sacred_kai_planet", ["sacred_land"], False),
    ("village_sacred_street_curve", "village_sacred/streets/street_curve.nbt",
     "sacred_kai_planet", ["sacred_land"], False),
    ("village_sacred_street_t", "village_sacred/streets/street_t.nbt",
     "sacred_kai_planet", ["sacred_land"], False),
    ("village_sacred_street_cross", "village_sacred/streets/street_cross.nbt",
     "sacred_kai_planet", ["sacred_land"], False),
]
PROC_ENTRIES = {
    "capsule_corp": {
        "planet": "earth", "biomes": ["plains", "sunflower_plains", "meadow", "forest"],
        "rarity": 1, "y_mode": "surface", "unique": True, "clear_above": True,
        "quest_tag": "dragonminez:capsule_corp", "min_distance_from_spawn": 0},
    # Korin Tower is part of the kami_lookout NBT; this stand-alone version exists
    # so masters.json ("korin" -> "korin_tower") resolves and as a fallback piece,
    # but it is never generated on its own (rarity 0 / alias_of).
    "korin_tower": {
        "planet": "earth", "biomes": [], "rarity": 0, "y_mode": "surface",
        "unique": True, "clear_above": True, "quest_tag": "dragonminez:korin_tower",
        "min_distance_from_spawn": 0, "alias_of": "kami_lookout",
        "generate": False},
    "snake_way": {
        "planet": "otherworld", "biomes": ["other_world"], "rarity": 1,
        "y_mode": "absolute", "y": 40, "unique": False, "clear_above": False,
        "quest_tag": "dragonminez:snake_way", "min_distance_from_spawn": 0},
    "king_kai_planet": {
        "planet": "otherworld", "biomes": ["king_kai_planet"], "rarity": 1,
        "y_mode": "sky", "y": 140, "unique": True, "clear_above": True,
        "quest_tag": "dragonminez:king_kai_planet", "min_distance_from_spawn": 1000},
    "check_in_station": {
        "planet": "otherworld", "biomes": ["other_world"], "rarity": 1,
        "y_mode": "absolute", "y": 40, "unique": True, "clear_above": True,
        "quest_tag": "dragonminez:check_in_station", "min_distance_from_spawn": 0},
    "hell_gate": {
        "planet": "hell_planet", "biomes": ["hell_planet_wastes"], "rarity": 1,
        "y_mode": "surface", "unique": True, "clear_above": True,
        "quest_tag": "dmzplus:hell_gate", "min_distance_from_spawn": 0},
    "heaven_arch": {
        "planet": "heaven", "biomes": ["heaven_meadows"], "rarity": 1,
        "y_mode": "surface", "unique": True, "clear_above": True,
        "quest_tag": "dmzplus:heaven_arch", "min_distance_from_spawn": 0},
    "kai_shrine": {
        "planet": "sacred_kai_planet", "biomes": ["sacredkai_plains", "sacredkai_hills"],
        "rarity": 30, "y_mode": "surface", "unique": False, "clear_above": True,
        "quest_tag": "dragonminez:kai_shrine", "min_distance_from_spawn": 150},
}
STRUCTURES = OrderedDict()


def build_structures():
    src = os.path.join(DMZ_DATA, "structures")
    for name, rel, entry in NBT_STRUCTURES:
        path = os.path.join(src, rel)
        if not os.path.exists(path):
            SKIPPED.append("structure %s: %s missing" % (name, rel))
            continue
        spawns = convert_nbt_structure(name, path)
        e = dict(entry)
        e["file"] = structure_rel(name)
        e["spawn_entities"] = spawns
        STRUCTURES[name] = e
        log("  structure %-26s %s  %d blocks" % (name, STRUCT_SIZES[name][0],
                                                 STRUCT_SIZES[name][1]))
    for name, rel, planet, biomes, is_center in VILLAGE_PIECES:
        path = os.path.join(src, rel)
        if not os.path.exists(path):
            SKIPPED.append("structure %s: %s missing" % (name, rel))
            continue
        ent_dirs = []
        if is_center:
            ent_dirs.append(os.path.join(src, rel.split("/")[0], "entities"))
        spawns = convert_nbt_structure(name, path, ent_dirs)
        village = rel.split("/")[0]
        STRUCTURES[name] = {
            "file": structure_rel(name), "planet": planet, "biomes": biomes,
            "rarity": 34 if is_center else 0, "y_mode": "surface",
            "unique": False, "clear_above": False, "spawn_entities": spawns,
            "quest_tag": "dragonminez:%s" % village,
            "min_distance_from_spawn": 64, "group": village,
            "village_role": "center" if is_center else "piece",
        }
        log("  structure %-26s %s  %d blocks" % (name, STRUCT_SIZES[name][0],
                                                 STRUCT_SIZES[name][1]))
    for name, fn in PROCEDURAL:
        fn()
        e = dict(PROC_ENTRIES[name])
        e["file"] = structure_rel(name)
        doc_ents = []
        e["spawn_entities"] = PROC_SPAWNS.get(name, [])
        STRUCTURES[name] = e
        log("  structure %-26s %s  %d blocks (procedural)" % (
            name, STRUCT_SIZES[name][0], STRUCT_SIZES[name][1]))
    COUNTS["structures"] = len(STRUCTURES)


PROC_SPAWNS = {
    "capsule_corp": ["master_vegeta", "master_trunks", "saga_bulma", "master_toribot"],
    "korin_tower": [],
    "king_kai_planet": ["master_kaiosama"],
    "check_in_station": ["master_enma"],
    "snake_way": [], "hell_gate": [], "heaven_arch": [], "kai_shrine": [],
}


# ================================================================ 4. planets.json
def load_json_dir(path):
    out = {}
    for p in sorted(glob.glob(os.path.join(path, "*.json"))):
        out[os.path.basename(p)[:-5]] = jload(p)
    return out


DMZ_PLANETS = load_json_dir(os.path.join(DMZP_DATA, "dmz_planets"))
RENDERERS = load_json_dir(os.path.join(DMZP_ASSETS, "dmzplus_planet_renderers"))
NOISE = {}
NOISE.update(load_json_dir(os.path.join(DMZ_DATA, "worldgen", "noise_settings")))
NOISE.update(load_json_dir(os.path.join(DMZP_DATA, "worldgen", "noise_settings")))
DIMTYPE = {}
DIMTYPE.update(load_json_dir(os.path.join(DMZ_DATA, "dimension_type")))
DIMTYPE.update(load_json_dir(os.path.join(DMZP_DATA, "dimension_type")))
try:
    SPACEPOD = jload(os.path.join(DMZ_DATA, "spacepod", "destinations.json"))["destinations"]
except Exception:
    SPACEPOD = []
SPACEPOD_BY_DIM = {d.get("dimension"): d for d in SPACEPOD}

# our planet id -> (dmz_planets key, renderer key, noise key, dimension_type key,
#                   minecraft dimension id, generator, day_length, music, sky defaults)
PLANET_TABLE = [
    ("earth", "Earth", "earth", "earth", None, None, "minecraft:overworld", "earth",
     20, "explore_earth"),
    ("namek", "Namek", "namek", "namek_orbit", "namek", "namek", "dragonminez:namek",
     "namek", 0, "namek"),
    ("otherworld", "Other World", "otherworld", "otherworld_space", "otherworld",
     "otherworld", "dragonminez:otherworld", "otherworld", 0, "otherworld"),
    ("sacred_kai_planet", "Sacred World of the Kai", None, None, "sacredkaiplanet",
     "sacredkaiplanet", "dragonminez:sacredkaiplanet", "sacred", 0, "otherworld"),
    ("time_chamber", "Hyperbolic Time Chamber", None, None, "time_chamber",
     "time_chamber", "dragonminez:time_chamber", "time_chamber", 0, "time_chamber"),
    ("vegeta", "Planet Vegeta", "vegeta", "vegeta", "vegeta", "vegeta", "dmzplus:vegeta",
     "vegeta", 20, "explore_earth"),
    ("yardrat", "Planet Yardrat", "yardrat", "yardrat", "yardrat", "yardrat",
     "dmzplus:yardrat", "yardrat", 20, "explore_earth"),
    ("vampa", "Planet Vampa", "vampa", "vampa", "vampa", "vampa", "dmzplus:vampa",
     "vampa", 20, "explore_earth"),
    ("cereal", "Planet Cereal", "cereal", "cereal", "cereal", "cereal", "dmzplus:cereal",
     "cereal", 20, "explore_earth"),
    ("hell_planet", "Hell", "hell_planet", "hell_planet", "hell_planet", "hell_planet",
     "dmzplus:hell_planet", "hell", 0, "hell"),
    ("heaven", "Heaven", "heaven", "heaven", "heaven", "heaven", "dmzplus:heaven",
     "heaven", 0, "heaven"),
    ("universe_7_deep_space", "Universe 7 Deep Space", "universe_7_deep_space",
     "universe_7_deep_space", "deep_space", "universe_7_deep_space",
     "dmzplus:universe_7_deep_space", "space", 0, "space"),
    ("orbit", "Orbit", None, "earth_orbit", "orbit", "earth_orbit", "dmzplus:orbit",
     "orbit", 20, "space"),
]
PLANET_SKY_DEFAULTS = {
    "earth": {"day": "#7DAEFF", "horizon": "#CFE4FF", "night": "#050818",
              "sunset": "#FF8C3A", "fog": "#BFD6F5", "clouds": True, "moon": True,
              "sun_scale": 1.0},
    "namek": {"day": "#63A57B", "horizon": "#A8E0BC", "night": "#12301F",
              "sunset": "#C8F0A0", "fog": "#C0D8FF", "clouds": True, "moon": False,
              "sun_scale": 1.3},
    "otherworld": {"day": "#BE55AA", "horizon": "#E0A8D8", "night": "#2A0E28",
                   "sunset": "#FFB0E0", "fog": "#CE7EBD", "clouds": True,
                   "moon": False, "sun_scale": 0.8},
    "sacred_kai_planet": {"day": "#9A6BE3", "horizon": "#D7A9E6", "night": "#1A0E33",
                          "sunset": "#E0A0FF", "fog": "#D7A9E6", "clouds": True,
                          "moon": True, "sun_scale": 1.0},
    "time_chamber": {"day": "#F7FCFF", "horizon": "#F7FCFF", "night": "#F7FCFF",
                     "sunset": "#F7FCFF", "fog": "#DCF2FF", "clouds": False,
                     "moon": False, "sun_scale": 0.0},
    "vegeta": {"day": "#9C3A22", "horizon": "#D06A40", "night": "#180605",
               "sunset": "#FF6A2A", "fog": "#6E2416", "clouds": False, "moon": True,
               "sun_scale": 1.1},
    "yardrat": {"day": "#E8D44A", "horizon": "#F4E890", "night": "#201C05",
                "sunset": "#FFD060", "fog": "#C9B23A", "clouds": True, "moon": False,
                "sun_scale": 0.9},
    "vampa": {"day": "#8C7A1E", "horizon": "#C0B060", "night": "#14120A",
              "sunset": "#E0C040", "fog": "#6B5C14", "clouds": False, "moon": True,
              "sun_scale": 0.7},
    "cereal": {"day": "#A85A1E", "horizon": "#E98A52", "night": "#1A0C05",
               "sunset": "#FF9040", "fog": "#E98A52", "clouds": False, "moon": True,
               "sun_scale": 1.0},
    "hell_planet": {"day": "#6E0D0D", "horizon": "#A82020", "night": "#1A0303",
                    "sunset": "#FF3010", "fog": "#3F0606", "clouds": False,
                    "moon": False, "sun_scale": 1.4},
    "heaven": {"day": "#D9A8E6", "horizon": "#F0D0F8", "night": "#2A1830",
               "sunset": "#FFC0E8", "fog": "#C9A0D4", "clouds": True, "moon": True,
               "sun_scale": 1.0},
    "universe_7_deep_space": {"day": "#000000", "horizon": "#000000",
                              "night": "#000000", "sunset": "#000000", "fog": "#000000",
                              "clouds": False, "moon": False, "sun_scale": 1.0},
    "orbit": {"day": "#000208", "horizon": "#001028", "night": "#000000",
              "sunset": "#102040", "fog": "#000408", "clouds": False, "moon": False,
              "sun_scale": 1.0},
}
PLANET_SPAWN = {
    "earth": [0, -1, 0], "namek": [0, -1, 0], "otherworld": [0, 41, 10],
    "sacred_kai_planet": [0, -1, 0], "time_chamber": [0, 130, 0],
    "vegeta": [0, -1, 0], "yardrat": [0, -1, 0], "vampa": [0, -1, 0],
    "cereal": [0, -1, 0], "hell_planet": [0, -1, 0], "heaven": [0, -1, 0],
    "universe_7_deep_space": [0, 800, 0], "orbit": [0, 800, 0],
}
DBALL_SET = {"earth": "earth", "namek": "namek", "cereal": "cereal",
             "universe_7_deep_space": "super"}
TRAVEL = {
    "earth": ("ALWAYS", 0), "namek": ("ALWAYS", 1),
    "otherworld": ("QUEST:sidequest:bulma_otherworld_drive", 2),
    "sacred_kai_planet": ("QUEST:saga_buu:23", 3), "cereal": ("NEVER", 4),
    "time_chamber": ("QUEST:sidequest:bulma_time_chamber_link", 2),
    "vegeta": ("PLANET:namek", 5), "yardrat": ("PLANET:namek", 6),
    "vampa": ("PLANET:vegeta", 7), "hell_planet": ("PLANET:otherworld", 8),
    "heaven": ("PLANET:otherworld", 9),
    "universe_7_deep_space": ("ITEM:saiyan_ship", 10), "orbit": ("ITEM:saiyan_ship", 10),
}
PLANETS = []
UNMAPPED_SKY = set()


def env_texture(mc_path):
    base = os.path.basename(str(mc_path)).replace(".png", "")
    if base in ENV_TEXTURES:
        return base
    if base == "sun":
        subst("sky body: sun.png -> sun_surface")
        return "sun_surface"
    if base.startswith("moon"):
        return None
    UNMAPPED_SKY.add(str(mc_path))
    return None


def sky_bodies(renderer):
    out = []
    for r in renderer.get("sky_renderables", []):
        tex = env_texture(r.get("texture", ""))
        if tex is None:
            continue
        anchor = (r.get("anchor") or {}).get("type", "static")
        if anchor == "star" or tex in ("sun_surface",):
            kind = "sun"
        elif anchor == "super_dball":
            kind = "dragon_ball"
        elif anchor in ("planet", "altitude") or r.get("body"):
            kind = "planet"
        else:
            kind = "marker"
        body = {"texture": tex, "scale": float(r.get("scale", 1.0)), "kind": kind}
        if r.get("min_scale") is not None:
            body["min_scale"] = float(r["min_scale"])
        if r.get("max_visible_range") is not None:
            body["max_range"] = float(r["max_visible_range"])
        if r.get("body"):
            body["target"] = strip_ns(str(r["body"]))
        elif (r.get("anchor") or {}).get("target"):
            body["target"] = strip_ns(str(r["anchor"]["target"]))
        out.append(body)
    return out


def build_planets():
    biomes_by_planet = collections.OrderedDict()
    for b in BIOMES:
        biomes_by_planet.setdefault(b["planet"], []).append(b["id"])
    # sacred_land is a Namek-flavoured biome; it is generated on both worlds
    if "namek" in biomes_by_planet and "sacred_land" not in biomes_by_planet["namek"]:
        biomes_by_planet["namek"].append("sacred_land")
    structs_by_planet = collections.OrderedDict()
    for name, e in STRUCTURES.items():
        structs_by_planet.setdefault(e["planet"], []).append(name)

    for (pid, name, pkey, rkey, nkey, dkey, dim, generator, day_len, music) in PLANET_TABLE:
        p = DMZ_PLANETS.get(pkey or "", {})
        rend = RENDERERS.get(rkey or "", {})
        noise = NOISE.get(nkey or "", {})
        dimt = DIMTYPE.get(dkey or "", {})
        sky_def = PLANET_SKY_DEFAULTS[pid]
        gravity = round(float(p.get("gravity", 9.807)) / 9.807, 3) if p else 1.0
        oxygen = bool(p.get("oxygen", True)) if p else True
        temperature = int(p.get("temperature", 15)) if p else 15
        if pid == "time_chamber":
            temperature, gravity, oxygen = 45, 10.0, True
        if pid == "sacred_kai_planet":
            temperature, gravity, oxygen = 20, 1.0, True
        if pid == "orbit":
            temperature, gravity, oxygen = -270, 0.0, False
        default_block = strip_ns(str(noise.get("default_block", {}).get("Name", "stone")))
        default_block = map_block(noise.get("default_block", {}).get("Name", "minecraft:stone")) \
            if noise else "stone"
        sea_level = int(noise.get("sea_level", 62)) if noise else 62
        if pid == "earth":
            sea_level, default_block = 62, "stone"
        fixed_time = dimt.get("fixed_time")
        unlock, icon = TRAVEL.get(pid, ("NEVER", 0))
        sp = SPACEPOD_BY_DIM.get(dim)
        if sp:
            icon = int(sp.get("icon_index", icon))
            rules = sp.get("unlock_rules")
            if isinstance(rules, str):
                unlock = rules
            elif isinstance(rules, dict) and rules.get("quest"):
                unlock = "QUEST:" + str(rules["quest"])
        sky = {
            "type": "space" if pid in ("universe_7_deep_space", "orbit") else "atmosphere",
            "day": sky_def["day"], "horizon": sky_def["horizon"],
            "night": sky_def["night"], "sunset": sky_def["sunset"],
            "fog": sky_def["fog"],
            # Minecraft draws its own star field when custom_sky is false, so the
            # source "stars: 0" there is not a real count - fall back to a default.
            "stars": (int(rend["stars"]) if rend.get("custom_sky") and rend.get("stars")
                      else (1500 if pid == "earth" else 2000)),
            "star_brightness": float(rend.get("star_brightness",
                                              0.6 if pid == "earth" else 0.8)),
            # planets whose renderer has no painted sky still get a faint milky way at night
            "milky_way": float((rend.get("sky_texture") or {}).get("brightness", 0.3)),
            "clouds": bool(sky_def["clouds"]),
            "aurora": pid in ("sacred_kai_planet", "heaven"),
            "sun_scale": float(sky_def["sun_scale"]),
            "moon": bool(sky_def["moon"]),
            # the orbit renderers have fog off; on a planet surface we always want it
            "has_fog": pid not in ("universe_7_deep_space", "orbit"),
            "bodies": sky_bodies(rend),
        }
        entry = {
            "id": pid, "name": name, "gravity": gravity, "oxygen": oxygen,
            "temperature": temperature,
            "biomes": biomes_by_planet.get(pid, []),
            "generator": generator, "sea_level": sea_level,
            "default_block": default_block,
            "min_y": int(dimt.get("min_y", 0)) if dimt else 0,
            "height": int(dimt.get("height", 256)) if dimt else 256,
            "ambient_light": float(dimt.get("ambient_light", 0.0)) if dimt else 0.0,
            "day_length": day_len,
            "spawn": PLANET_SPAWN[pid],
            "sky": sky,
            "structures": structs_by_planet.get(pid, []),
            "music": music,
            "travel": {"unlock": unlock, "icon": icon},
            "dimension": dim,
        }
        if fixed_time is not None:
            entry["fixed_time"] = round(float(fixed_time) / 24000.0, 4)
        if pid == "namek":
            entry["suns"] = 3
        if pid == "time_chamber":
            entry["endless_day"] = True
        if pid in DBALL_SET:
            entry["dragon_balls"] = DBALL_SET[pid]
        tb = p.get("terrain_box") if p else None
        if tb:
            entry["terrain_box"] = {"bound_xz": int(tb.get("bound_xz", 6000)),
                                    "min_y": int(tb.get("min_y", 32)),
                                    "max_y": int(tb.get("max_y", 224))}
        asc = p.get("ascent") if p else None
        if asc:
            entry["ascent"] = {"deep_space": strip_ns(str(asc.get("deep_space", ""))),
                               "arrival": [int(v) for v in asc.get("arrival", [0, 800, 0])]}
        PLANETS.append(entry)
    COUNTS["planets"] = len(PLANETS)


# ================================================================ main
def main():
    log("== items")
    build_items()
    COUNTS["items"] = len(ITEMS)
    log("   %d items" % len(ITEMS))
    log("== recipes")
    build_recipes()
    log("   %d recipes (%d ported, %d vanilla)" % (
        COUNTS["recipes_total"], COUNTS["recipes_ported"],
        COUNTS["recipes_total"] - COUNTS["recipes_ported"]))
    log("== biomes")
    build_biomes()
    log("   %d biomes" % len(BIOMES))
    log("== structures")
    build_structures()
    log("== planets")
    build_planets()

    jsave("items.json", {"items": ITEMS})
    jsave("recipes.json", {"recipes": RECIPES})
    jsave("biomes.json", {"biomes": BIOMES})
    jsave("planets.json", {"planets": PLANETS})
    jsave("structures.json", {"structures": STRUCTURES})

    # ---- validation
    problems = []
    item_ids = set(i["id"] for i in ITEMS) | (BLOCK_SET - {"air"})
    for b in BLOCKS:
        for d in b.get("drops", []):
            it = d.get("item", "self")
            if it != "self" and it not in item_ids:
                problems.append("block %s drops unknown item %s" % (b["id"], it))
    for r in RECIPES:
        if r["result"]["item"] not in item_ids:
            problems.append("recipe %s -> unknown item %s" % (r["id"], r["result"]["item"]))
        for k, v in r.get("keys", {}).items():
            for vv in (v if isinstance(v, list) else [v]):
                if vv not in item_ids:
                    problems.append("recipe %s uses unknown item %s" % (r["id"], vv))
        if "input" in r and r["input"] not in item_ids:
            problems.append("recipe %s input unknown %s" % (r["id"], r["input"]))
        if "pattern" in r and r["pattern"] not in item_ids:
            problems.append("recipe %s pattern unknown %s" % (r["id"], r["pattern"]))
    biome_ids = set(b["id"] for b in BIOMES)
    for b in BIOMES:
        for key in ("surface", "filler", "underwater"):
            if b[key] not in BLOCK_SET:
                problems.append("biome %s.%s unknown block %s" % (b["id"], key, b[key]))
        for pl in b["plants"]:
            if pl["block"] not in BLOCK_SET:
                problems.append("biome %s plant unknown %s" % (b["id"], pl["block"]))
    for p in PLANETS:
        for bid in p["biomes"]:
            if bid not in biome_ids:
                problems.append("planet %s unknown biome %s" % (p["id"], bid))
        for sn in p["structures"]:
            if sn not in STRUCTURES:
                problems.append("planet %s unknown structure %s" % (p["id"], sn))
    planet_ids = set(p["id"] for p in PLANETS)
    for name, e in STRUCTURES.items():
        if e["planet"] not in planet_ids:
            problems.append("structure %s unknown planet %s" % (name, e["planet"]))
        for bid in e.get("biomes", []):
            if bid not in biome_ids:
                problems.append("structure %s unknown biome %s" % (name, bid))
        fp = os.path.join(GAME, e["file"])
        if not os.path.exists(fp):
            problems.append("structure %s missing file %s" % (name, e["file"]))
    for it in ITEMS:
        if it["icon"] not in ICON_PATHS:
            problems.append("item %s icon %s missing" % (it["id"], it["icon"]))
        if it["kind"] == "armor" and it["armor"]["layer"] not in ARMOR_LAYER_SET:
            problems.append("item %s armor layer %s missing" % (it["id"],
                                                                it["armor"]["layer"]))

    # ---- report
    print("")
    print("=== counts")
    for k, v in COUNTS.items():
        print("  %-18s %s" % (k, v))
    kinds = collections.Counter(i["kind"] for i in ITEMS)
    print("  item kinds       " + ", ".join("%s=%d" % kv for kv in sorted(kinds.items())))
    stations = collections.Counter(r["station"] for r in RECIPES)
    print("  recipe stations  " + ", ".join("%s=%d" % kv for kv in sorted(stations.items())))
    print("")
    print("=== structure sizes (size, blocks, entities, bytes)")
    for n in sorted(STRUCT_SIZES):
        s = STRUCT_SIZES[n]
        print("  %-30s %-16s %8d %3d %10d" % (n, "x".join(str(v) for v in s[0]),
                                              s[1], s[2], s[3]))
    print("  total structure bytes: %d" % sum(v[3] for v in STRUCT_SIZES.values()))
    print("")
    print("=== block palette mapping (%d source names)" % len(BLOCK_MAP_USED))
    for k in sorted(BLOCK_MAP_USED):
        if strip_ns(k) != BLOCK_MAP_USED[k]:
            print("  %-52s -> %s" % (k, BLOCK_MAP_USED[k]))
    if UNMAPPED_BLOCKS:
        print("  UNMAPPED (fell back to stone):")
        for k, n in UNMAPPED_BLOCKS.most_common():
            print("    %s x%d" % (k, n))
    if UNMAPPED_ITEMS:
        print("")
        print("=== unmapped recipe items/tags (%d)" % len(UNMAPPED_ITEMS))
        for k in sorted(UNMAPPED_ITEMS):
            print("  " + k)
    if UNMAPPED_SKY:
        print("")
        print("=== sky textures not available")
        for k in sorted(UNMAPPED_SKY):
            print("  " + k)
    if SKIPPED:
        print("")
        print("=== not converted (%d)" % len(SKIPPED))
        for s in SKIPPED:
            print("  " + s)
    if SUBST:
        print("")
        print("=== substitutions (%d)" % len(SUBST))
        for s in sorted(set(SUBST)):
            print("  " + s)
    print("")
    if problems:
        print("=== PROBLEMS (%d)" % len(problems))
        for p in problems:
            print("  " + p)
        return 1
    print("validation: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
