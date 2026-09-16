#!/usr/bin/env python3
"""Data conversion, part B: world content (items, recipes, biomes, planets, structures).

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
        if iid in ITEM_IDS:
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
    for iid, nm in (("punchmachine", "Punch Machine"),):
        ic = icon_for(iid)
        if ic:
            add_item({"id": iid, "name": nm, "icon": ic, "stack": 1, "kind": "misc",
                      "rarity": "uncommon"})


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
    "redstone_block": "redstone", "quartz_block": "quartz_block",
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
    "observer": "redstone", "comparator": "redstone", "repeater": "redstone",
    "redstone_torch": "torch", "clock": "gold_ingot", "compass": "iron_ingot",
    "minecart": "iron_ingot", "anvil": "iron_block", "shears": "iron_ingot",
    "heavy_weighted_pressure_plate": "iron_block", "smithing_table": "crafting_table",
    "crying_obsidian": "obsidian", "obsidian": "obsidian",
    # tools
    "iron_pickaxe": "iron_pickaxe", "iron_axe": "iron_axe", "iron_shovel": "iron_shovel",
    "iron_hoe": "iron_hoe", "iron_sword": "iron_sword",
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
        base = map_block("minecraft:" + bare[:-len("_slab")])
        mat = BLOCK_BY_ID.get(base, {}).get("material", "stone")
        return "oak_slab" if mat == "wood" else "stone_slab"
    if bare.endswith("_stairs"):
        return map_block("minecraft:" + bare[:-len("_stairs")])
    if bare.endswith("_wall"):
        return map_block("minecraft:" + bare[:-len("_wall")])
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
