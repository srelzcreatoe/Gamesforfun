#!/usr/bin/env python3
"""Data conversion, part A: story & characters.

Reads the extracted DragonMineZ 2.1.3 mod (GPL-3.0) and DMZ Plus 1.1.6 and writes these
registries into game/data/ (schema: game/docs/DATA_SCHEMA.md):

  quests/<category>/*.json  sagas.json  entities.json  races.json  forms.json
  skills.json  techniques.json  masters.json  wishes.json  audio.json

Deterministic and re-runnable; every substitution (missing texture/model, remapped mob/item id)
is printed at the end. It never touches blocks/items/recipes/biomes/planets/structures (part B).

Usage: python3 tools/convert_dmz_data.py [--src DIR] [--game DIR] [--quiet]
"""
import argparse
import glob
import json
import os
import re
import sys
from collections import OrderedDict, defaultdict

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
QUESTS_SRC = os.path.join(DMZ_DATA, "previousQuests")
CONF = os.path.join(DMZ_DATA, "previousConfigs")
ASSETS = os.path.join(GAME, "assets")
DATA = os.path.join(GAME, "data")

SUBST = []          # human readable substitutions
UNPORTED = []       # things we could not port
COUNTS = OrderedDict()


def log(msg):
    if not ARGS.quiet:
        print(msg)


def subst(msg):
    SUBST.append(msg)


def jload(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def jsave(rel, data):
    path = os.path.join(DATA, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")


def exists_asset(rel):
    return os.path.exists(os.path.join(ASSETS, rel))


def title_case(s):
    s = s.replace("saga_", "").replace("master_", "")
    return " ".join(w.capitalize() for w in re.split(r"[_\s]+", s) if w)


# ---------------------------------------------------------------- lang
LANG = jload(os.path.join(DMZ_ASSETS, "lang", "en_us.json"))
try:
    LANG_PLUS = jload(os.path.join(DMZP, "assets", "dmzplus", "lang", "en_us.json"))
except Exception:
    LANG_PLUS = {}
STRIP_FMT = re.compile(r"§.")


def lang(key, default=None):
    v = LANG.get(key)
    if v is None:
        v = LANG_PLUS.get(key)
    if v is None:
        return default
    return STRIP_FMT.sub("", v).strip()


def entity_name(eid):
    n = lang("entity.dragonminez." + eid)
    if n is None:
        n = lang("entity.dmzplus." + eid)
    return n if n else title_case(eid)


# ---------------------------------------------------------------- id mapping
PLANET_MAP = {
    "minecraft:overworld": "earth",
    "dragonminez:namek": "namek",
    "dragonminez:otherworld": "otherworld",
    "dragonminez:sacredkaiplanet": "sacred_kai_planet",
    "dragonminez:time_chamber": "time_chamber",
    "minecraft:the_nether": "hell_planet",
    "minecraft:the_end": "universe_7_deep_space",
}

MOB_MAP = {
    "minecraft:zombie": "bandit",
    "minecraft:skeleton": "red_ribbon_soldier",
    "minecraft:spider": "sabertooth",
    "minecraft:creeper": "robot1",
    "minecraft:enderman": "robotxv",
    "minecraft:iron_golem": "robotxv",
    "minecraft:cow": "dino1",
    "minecraft:pig": "dinokid",
    "minecraft:sheep": "dinokid",
    "minecraft:chicken": "dinokid",
}
HOSTILE_DEFAULT = "bandit"

ITEM_ID_MAP = {
    "dball_radar": "dragon_radar",
    "namekdball_radar": "namek_dragon_radar",
    "fused_dball_radar": "fused_dragon_radar",
    "super_dball_radar": "super_dragon_radar",
    "enderpearl": "ender_pearl",
}

SKILL_ID_MAP = {
    "kicontrol": "ki_control",
    "kisense": "ki_sense",
    "kiprotection": "ki_protection",
    "kimanipulation": "ki_manipulation",
    "potentialunlock": "potential_unlock",
    "kiboost": "ki_boost",
    "ultrainstinct": "ultra_instinct",
    "ultraego": "ultra_ego",
    "friendlyfist": "friendly_fist",
    "aurastatus": "aura_status",
}

TECH_ID_MAP = {
    "spiritbomb": "spirit_bomb",
    "makkanko": "special_beam_cannon",
    "makkankosanpo": "special_beam_cannon",
    "taiyoken": "solar_flare",
    "double_kienzan": "kienzan_doble",
    "barrage": "ki_barrage",
}

NPC_ID_MAP = {"kingkai": "king_kai", "oldkai": "old_kai"}


def map_item(raw):
    ns, _, name = raw.partition(":")
    if not name:
        name = ns
    return ITEM_ID_MAP.get(name, name)


def map_planet(dim):
    if dim in PLANET_MAP:
        return PLANET_MAP[dim]
    ns, _, name = dim.partition(":")
    if ns == "dmzplus":
        return name
    subst("planet: unknown dimension %s -> earth" % dim)
    return "earth"


def map_skill(sid):
    return SKILL_ID_MAP.get(sid, sid)


def map_npc(nid):
    return NPC_ID_MAP.get(nid, nid)


ENTITY_TAGS = {}
for _p in glob.glob(os.path.join(DMZ_DATA, "tags", "entity_types", "*.json")):
    ENTITY_TAGS[os.path.basename(_p)[:-5]] = [v.split(":", 1)[1] for v in jload(_p).get("values", [])]


def map_entity(raw):
    """-> (entity_id, entity_name, extra dict)"""
    if raw.startswith("#"):
        tag = raw[1:].split(":", 1)[1]
        ids = ENTITY_TAGS.get(tag, [])
        if not ids:
            subst("entity tag %s unknown -> bandit" % raw)
            return "bandit", entity_name("bandit"), {}
        return ids[0], lang("entity.dragonminez.tag." + tag, title_case(tag)), {"entity_any": ids}
    ns, _, name = raw.partition(":")
    if ns == "minecraft":
        if raw in MOB_MAP:
            m = MOB_MAP[raw]
        else:
            m = HOSTILE_DEFAULT
        subst("mob %s -> %s" % (raw, m))
        return m, entity_name(m), {"vanilla_mob": name}
    return name, entity_name(name), {}


# ================================================================ QUESTS
SAGA_ORDER = ["saiyan_saga", "frieza_saga", "android_saga", "future_saga", "buu_saga", "movies_saga"]
SAGA_DEFS = {}
for _p in glob.glob(os.path.join(QUESTS_SRC, "sagas", "*.json")):
    d = jload(_p)
    SAGA_DEFS[d["id"]] = d

quest_index = {}       # "<category>:<id>" -> converted quest
sidequest_cat = {}     # sidequest id -> category
story_kill_stats = {}  # entity -> {health, melee, ki, ai_tier, level}
side_kill_stats = {}
level_anchors = []     # (level, health, melee, ki)
quest_giver_map = defaultdict(list)   # master id -> [quest ids] (quest_giver)
quest_turnin_map = defaultdict(list)  # master id -> [quest ids] (turn_in)
category_files = defaultdict(list)    # category -> [(filename, quest)]
quest_entities = set()

# pre-scan sidequests for category lookup
for _folder in sorted(os.listdir(os.path.join(QUESTS_SRC, "sidequests"))):
    for _p in sorted(glob.glob(os.path.join(QUESTS_SRC, "sidequests", _folder, "*.json"))):
        sidequest_cat[jload(_p)["id"]] = "sidequest_" + _folder


def conv_condition(c):
    t = c.get("type")
    out = OrderedDict()
    if t == "DIMENSION":
        out["type"] = "PLANET"
        out["planet"] = map_planet(c.get("dimension", ""))
    elif t == "LEVEL":
        out["type"] = "LEVEL"
        out["minLevel"] = c.get("minLevel", 1)
    elif t == "BIOME":
        out["type"] = "BIOME"
        out["biome"] = c.get("biome", "")
    elif t == "STRUCTURE":
        out["type"] = "STRUCTURE"
        out["structure"] = c.get("structure", "")
    elif t == "SAGA_QUEST":
        out["type"] = "SAGA_QUEST"
        out["sagaId"] = c.get("sagaId", "")
        out["questId"] = str(c.get("questId", 0))
        folder = SAGA_DEFS.get(c.get("sagaId", ""), {}).get("questFolder", "")
        out["quest"] = "%s:%s" % (folder, c.get("questId", 0))
    elif t == "QUEST":
        out["type"] = "QUEST"
        out["questId"] = c.get("questId", "")
        cat = sidequest_cat.get(c.get("questId", ""), "")
        if not cat:
            UNPORTED.append("prerequisite QUEST %s not found" % c.get("questId"))
        out["quest"] = "%s:%s" % (cat, c.get("questId", ""))
    elif t == "SKILL":
        out["type"] = "SKILL"
        out["skill"] = map_skill(c.get("skill", ""))
        out["minLevel"] = c.get("minLevel", c.get("level", 1))
    elif t == "TIME":
        out["type"] = "TIME"
        out["mode"] = c.get("mode", "REAL_TIME")
        out["seconds"] = int(c.get("milliseconds", 0)) // 1000
    else:
        out.update(c)
        UNPORTED.append("condition type %s kept verbatim" % t)
    return out


def conv_conditions(block):
    if not block:
        return {"operator": "AND", "conditions": []}
    if isinstance(block, list):
        return {"operator": "AND", "conditions": [conv_condition(c) for c in block]}
    return {"operator": block.get("operator", "AND"),
            "conditions": [conv_condition(c) for c in block.get("conditions", [])]}


OBJECTIVE_TYPE = {"KILL": "KILL", "ITEM": "OBTAIN", "TALK_TO": "TALK", "STRUCTURE": "GO_TO",
                  "BIOME": "GO_TO", "DIMENSION": "GO_TO", "DRAGON_SUMMON": "SUMMON", "SKILL": "SKILL"}


def conv_objective(o, qid, is_story, level):
    t = o.get("type")
    out = OrderedDict()
    out["type"] = OBJECTIVE_TYPE.get(t, t)
    out["dmz_type"] = t
    if t == "KILL":
        eid, ename, extra = map_entity(o["entity"])
        out["entity"] = eid
        out["entity_name"] = ename
        out.update(extra)
        out["count"] = o.get("count", 1)
        for k in ("health", "meleeDamage", "kiDamage"):
            if k in o:
                out[k] = o[k]
        out["spawn"] = o.get("spawn", "NATURAL")
        out["count_mode"] = o.get("count_mode", "ANY_MATCHING")
        if "AITier" in o:
            out["AITier"] = o["AITier"]
        quest_entities.add(eid)
        for e in extra.get("entity_any", []):
            quest_entities.add(e)
        if "health" in o:
            rec = {"health": o["health"], "melee": o.get("meleeDamage", 0), "ki": o.get("kiDamage", 0),
                   "ai_tier": o.get("AITier", 1), "level": level, "quest": qid}
            store = story_kill_stats if is_story else side_kill_stats
            if eid not in store:
                store[eid] = rec
            if is_story:
                level_anchors.append((level, o["health"], o.get("meleeDamage", 0), o.get("kiDamage", 0)))
    elif t == "ITEM":
        out["item"] = map_item(o["item"])
        out["count"] = o.get("count", 1)
    elif t == "TALK_TO":
        out["npc"] = map_npc(o.get("npcId", ""))
        out["npcId"] = out["npc"]
    elif t == "STRUCTURE":
        out["structure"] = o.get("structure", "")
    elif t == "BIOME":
        out["biome"] = o.get("biome", "")
    elif t == "DIMENSION":
        out["planet"] = map_planet(o.get("dimension", ""))
    elif t == "DRAGON_SUMMON":
        out["dragon"] = o.get("dragon", "shenron")
        out["ball_set"] = o.get("ball_set", "earth")
    elif t == "SKILL":
        out["skill"] = map_skill(o.get("skill", ""))
        out["level"] = o.get("level", 1)
    else:
        for k, v in o.items():
            if k != "type":
                out[k] = v
        UNPORTED.append("objective type %s in %s kept verbatim" % (t, qid))
    return out


def conv_reward(r, qid):
    t = r.get("type")
    out = OrderedDict()
    if t == "TPS":
        out["type"] = "TPS"
        out["amount"] = r.get("amount", 0)
    elif t == "ITEM":
        out["type"] = "ITEM"
        out["item"] = map_item(r["item"])
        out["count"] = r.get("count", 1)
    elif t == "SKILL":
        out["type"] = "SKILL"
        out["skill"] = map_skill(r.get("skill", ""))
        out["level"] = r.get("level", 1)
    elif t == "COMMAND":
        # DMZ gives an enchanted book through a command; we have no enchantments -> named book item
        out["type"] = "ITEM"
        out["item"] = "book"
        out["count"] = 1
        out["display_name"] = lang(r.get("translationKey", ""), "Reward")
        out["original"] = r.get("command", "")
        subst("quest %s: COMMAND reward -> ITEM book (%s)" % (qid, out["display_name"]))
    else:
        out.update(r)
        UNPORTED.append("reward type %s in %s kept verbatim" % (t, qid))
    if "difficulty" in r:
        out["difficulty"] = r["difficulty"]
    return out


def convert_quest(src_path, category, is_story, order):
    q = jload(src_path)
    # ids are written as strings: Godot's JSON parser turns every number into a float, so a numeric
    # id would make Registry build "saga_android:1.0" instead of "saga_android:1".
    qid = "%s:%s" % (category, q["id"])
    out = OrderedDict()
    out["id"] = str(q["id"])
    out["dmz_id"] = q["id"]
    out["quest_id"] = qid
    out["name"] = lang(q.get("title", ""), title_case(str(q["id"])))
    out["desc"] = lang(q.get("description", ""), "")
    out["title"] = out["name"]
    out["description"] = out["desc"]
    out["type"] = q.get("type", "SAGA" if is_story else "SIDEQUEST")
    out["category"] = category
    if is_story:
        saga_id = next((s for s, d in SAGA_DEFS.items() if d.get("questFolder") == category), "")
        out["saga"] = saga_id
    out["order"] = order
    out["parallel_objectives"] = q.get("parallel_objectives", False)
    out["party_scaling"] = q.get("party_scaling", True)
    out["secret"] = q.get("secret", False)
    out["claim_mode"] = q.get("claim_mode", "TREE_OR_NPC")
    if "quest_giver" in q:
        out["quest_giver"] = map_npc(q["quest_giver"])
        quest_giver_map[out["quest_giver"]].append(qid)
    if "turn_in" in q:
        out["turn_in"] = map_npc(q["turn_in"])
        quest_turnin_map[out["turn_in"]].append(qid)
    out["requirements"] = conv_conditions(q.get("requirements"))
    out["prerequisites"] = conv_conditions(q.get("prerequisites"))
    level = 1
    planet = ""
    for c in out["requirements"]["conditions"]:
        if c["type"] == "LEVEL":
            level = c["minLevel"]
        if c["type"] == "PLANET" and not planet:
            planet = c["planet"]
    out["min_level"] = level
    out["planet"] = planet
    out["objectives"] = [conv_objective(o, qid, is_story, level) for o in q.get("objectives", [])]
    out["rewards"] = [conv_reward(r, qid) for r in q.get("rewards", [])]
    return qid, out


def convert_quests():
    import shutil
    qdir = os.path.join(DATA, "quests")
    if os.path.isdir(qdir):
        shutil.rmtree(qdir)
    n_story = n_side = 0
    saga_quests = defaultdict(list)
    for folder in sorted(os.listdir(os.path.join(QUESTS_SRC, "quests"))):
        files = sorted(glob.glob(os.path.join(QUESTS_SRC, "quests", folder, "*.json")))
        # story quests ordered by numeric id
        files.sort(key=lambda p: jload(p)["id"])
        for i, p in enumerate(files):
            qid, q = convert_quest(p, folder, True, i)
            quest_index[qid] = q
            fname = "%02d_%s.json" % (int(q["dmz_id"]), re.sub(r"^\d+_", "", os.path.basename(p))[:-5])
            category_files[folder].append((fname, q))
            saga_quests[folder].append(qid)
            n_story += 1
    for folder in sorted(os.listdir(os.path.join(QUESTS_SRC, "sidequests"))):
        cat = "sidequest_" + folder
        files = sorted(glob.glob(os.path.join(QUESTS_SRC, "sidequests", folder, "*.json")))
        for i, p in enumerate(files):
            qid, q = convert_quest(p, cat, False, i)
            quest_index[qid] = q
            fname = "%02d_%s.json" % (i + 1, q["id"])
            category_files[cat].append((fname, q))
            n_side += 1
    for cat, lst in category_files.items():
        for fname, q in lst:
            jsave(os.path.join("quests", cat, fname), q)
    COUNTS["quests (story)"] = n_story
    COUNTS["quests (side)"] = n_side
    # sagas
    sagas = []
    for sid in SAGA_ORDER:
        d = SAGA_DEFS[sid]
        sagas.append(OrderedDict([
            ("id", sid),
            ("name", lang(d.get("name", ""), title_case(sid))),
            ("requirements", {"previousSaga": d.get("requirements", {}).get("previousSaga", "")}),
            ("questFolder", d.get("questFolder", "")),
            ("quests", saga_quests.get(d.get("questFolder", ""), [])),
        ]))
    jsave("sagas.json", {"sagas": sagas})
    COUNTS["sagas"] = len(sagas)


# ================================================================ ENTITIES
GEO_CACHE = {}
# Bedrock geos carry hair / aura / cape / effect cubes that reach far above the character, so the
# hitbox is measured from the body bones only (the same bones vanilla-style models use).
BODY_BONE = re.compile(
    r"^(root|waist|body|torso|chest|hip\d*|neck|head|mouth|jaw|eyes?|nose|"
    r"(left|right)_(arm|leg|hand|foot)\w*|arm\w*|leg\w*|armor\w*|\w*_layer|\w*_hand_item)$", re.I)
TORSO_BONE = re.compile(r"^(body|waist|torso|chest|hip\d*)$", re.I)


def geo_extent(model_rel):
    """(torso_width, height, torso_depth) in blocks (geo units / 16, before `scale`)."""
    if model_rel in GEO_CACHE:
        return GEO_CACHE[model_rel]
    path = os.path.join(ASSETS, "models", model_rel + ".geo.json")
    res = None
    try:
        geo = jload(path)["minecraft:geometry"][0]
        bones = geo.get("bones", [])

        def span(pred):
            xs, ys, zs = [], [], []
            for b in bones:
                if not pred(b.get("name", "")):
                    continue
                for c in b.get("cubes", []):
                    o = c.get("origin", [0, 0, 0])
                    sz = c.get("size", [0, 0, 0])
                    xs += [o[0], o[0] + sz[0]]
                    ys += [o[1], o[1] + sz[1]]
                    zs += [o[2], o[2] + sz[2]]
            if not xs:
                return None
            return (max(xs) - min(xs), max(ys), max(zs) - min(zs))

        body = span(lambda n: bool(BODY_BONE.match(n))) or span(lambda n: True)
        torso = span(lambda n: bool(TORSO_BONE.match(n))) or body
        if body:
            res = (torso[0] / 16.0, body[1] / 16.0, torso[2] / 16.0)
        else:
            desc = geo.get("description", {})
            res = (desc.get("visible_bounds_width", 1) * 0.3, desc.get("visible_bounds_height", 2) * 0.5,
                   desc.get("visible_bounds_width", 1) * 0.3)
    except Exception:
        res = None
    GEO_CACHE[model_rel] = res
    return res


def hitbox_for(model_rel, scale):
    ext = geo_extent(model_rel)
    if ext is None:
        return [0.6, 1.8]
    h = max(0.4, min(ext[1] * scale, 64.0))
    w = max(ext[0], ext[2]) * 1.2 * scale
    w = max(0.4, min(w, h * 0.9))
    return [round(w, 2), round(h, 2)]


# entities whose model is another entity's geo (from the DMZ entity classes)
# textures for the shared "stage" geo models that have no texture of their own name
STAGE_TEXTURE = {
    "saga_goku": "sagas/saga_goku_mid_base",
    "saga_goku_ssj": "sagas/saga_goku_mid_ssj",
    "saga_goku_ssj2": "sagas/saga_goku_end_ssj2",
    "saga_goku_ssj3": "sagas/saga_goku_end_ssj3",
    "saga_gohan_mid": "sagas/saga_gohan_mid_base",
    "saga_gohan_end": "sagas/saga_gohan_end_base",
    "saga_future_gohan": "sagas/saga_fgohan_base",
    "saga_future_gohanssj": "sagas/saga_fgohan_ssj",
    "saga_trunks": "sagas/saga_ftrunks_base",
    "saga_trunks_ssj": "sagas/saga_trunks_ssj",
    "saga_trunks_ssg3": "sagas/saga_ftrunks_ssg3",
    "saga_vegeta_ssj2": "sagas/saga_vegeta_end_ssj2",
    "saga_vegeta_ssg2": "sagas/saga_vegeta_mid_ssg2",
    "saga_saibaman": "races/saibaman",
    "saga_slug_giant": "sagas/saga_slug",
}

MODEL_ALIAS = {
    "saga_mecha_frieza": "saga_frieza_base",
    "saga_fgohan_base": "saga_future_gohan",
    "saga_fgohan_ssj": "saga_future_gohanssj",
    "saga_gohan_end_base": "saga_gohan_end",
    "saga_gohan_end_ultimate": "saga_gohan_end_ssj2",
    "saga_gohan_mid_base": "saga_gohan_mid",
    "saga_gohan_mid_ssj": "saga_gohan_mid",
    "saga_goku_early": "saga_goku",
    "saga_goku_early_noweights": "saga_goku",
    "saga_goku_mid_base": "saga_goku",
    "saga_goku_end_base": "saga_goku",
    "saga_goku_mid_ssj": "saga_goku_ssj",
    "saga_goku_end_ssj": "saga_goku_ssj",
    "saga_goku_end_ssj2": "saga_goku_ssj2",
    "saga_goku_end_ssj3": "saga_goku_ssj3",
    "saga_gotenks_ssj": "saga_gotenks",
    "saga_bio_broly_giant": "saga_bio_broly",
    "saga_broly_ssj_restricted": "saga_broly_base",
    "saga_hirudegarn_incomplete1": "saga_hirudegarn",
    "saga_hirudegarn_incomplete2": "saga_hirudegarn",
    "saga_super_hirudegarn": "saga_hirudegarn",
    "saga_metal_cooler": "saga_cooler",
    "saga_nail": "saga_piccolo",
    "saga_piccolo_kami": "saga_piccolo",
    "saga_ftrunks_base": "saga_trunks",
    "saga_ftrunks_kid_base": "saga_trunks",
    "saga_ftrunks_kid_ssj": "saga_trunks_ssj",
    "saga_ftrunks_ssj": "saga_trunks_ssj",
    "saga_ftrunks_ssg3": "saga_trunks_ssg3",
    "saga_vegeta_majin": "saga_vegeta_ssg2",
    "saga_vegeta_end_base": "saga_vegeta",
    "saga_vegeta_end_ssj": "saga_vegeta",
    "saga_vegeta_end_ssj2": "saga_vegeta_ssj2",
    "saga_vegeta_mid_base": "saga_vegeta",
    "saga_vegeta_mid_ssj": "saga_vegeta",
    "saga_vegeta_mid_ssg2": "saga_vegeta_ssg2",
    "saga_vegeta_namek": "saga_vegeta",
    "saga_krillin": "saga_vegeta",
    "saga_tien_early": "saga_yamcha",
    "saga_ozaruvegeta": "saga_ozaru",
    "saga_superbuu_gohan": "saga_superbuu",
    "saga_superbuu_gotenks": "saga_superbuu",
    "saga_superbuu_piccolo": "saga_superbuu",
    "saga_cell_superperfect": "saga_cell_perfect",
    "mini_buu": "saga_buufat",
    "saga_slug_giant": "saga_slug",
}
for _i in range(1, 7):
    MODEL_ALIAS["saga_saibaman%d" % _i] = "saga_saibaman"

# DMZ entity registry (extracted from com/dragonminez/common/init/MainEntities.class)
SAGA_IDS = """saga_a13 saga_a14 saga_a15 saga_a16 saga_a17 saga_a18 saga_a19 saga_babidi saga_bio_broly
saga_bio_broly_giant saga_bojack saga_bojack_fp saga_broly_base saga_broly_lssj saga_broly_ssj
saga_broly_ssj_restricted saga_bujin saga_bulma saga_burter saga_buufat saga_cell_imperfect saga_cell_jr
saga_cell_perfect saga_cell_semiperfect saga_cell_superperfect saga_chaoz saga_cooler saga_cooler_5ta saga_cui
saga_dabura saga_dodoria saga_dr_wheelo saga_drgero saga_evilbuu saga_fgohan_base saga_fgohan_ssj
saga_frieza_base saga_frieza_first saga_frieza_fp saga_frieza_second saga_frieza_third saga_friezasoldier01
saga_friezasoldier02 saga_friezasoldier03 saga_ftrunks_base saga_ftrunks_kid_base saga_ftrunks_kid_ssj
saga_ftrunks_ssg3 saga_ftrunks_ssj saga_garlick_jr saga_garlick_jr_transformed saga_gete_robot saga_ginyu
saga_ginyu_goku saga_gohan_end_base saga_gohan_end_ssj saga_gohan_end_ssj2 saga_gohan_end_ultimate
saga_gohan_mid_base saga_gohan_mid_ssj saga_gohan_mid_ssj2 saga_goku_early saga_goku_early_noweights
saga_goku_end_base saga_goku_end_ssj saga_goku_end_ssj2 saga_goku_end_ssj3 saga_goku_mid_base saga_goku_mid_ssj
saga_gokua saga_goten saga_goten_ssj saga_gotenks saga_gotenks_ssj saga_gotenks_ssj3 saga_guldo saga_hirudegarn
saga_hirudegarn_incomplete1 saga_hirudegarn_incomplete2 saga_janemba_fat saga_jeice saga_kibito saga_kid_gohan
saga_kid_trunks saga_kid_trunks_ssj saga_kidbuu saga_king_cold saga_krillin saga_mecha_frieza saga_metal_cooler
saga_metal_cooler_core saga_morosoldier saga_nappa saga_ozaru saga_ozaruvegeta saga_paikuhan saga_paragus
saga_piccolo saga_piccolo_kami saga_puipui saga_raditz saga_recoome saga_saibaman1 saga_saibaman2 saga_saibaman3
saga_saibaman4 saga_saibaman5 saga_saibaman6 saga_salza saga_slug saga_slug_giant saga_slug_soldier
saga_spopovitch saga_super_a13 saga_super_hirudegarn saga_super_janemba saga_superbuu saga_superbuu_gohan
saga_superbuu_gotenks saga_superbuu_piccolo saga_tien_early saga_turles saga_vegeta saga_vegeta_end_base
saga_vegeta_end_ssj saga_vegeta_end_ssj2 saga_vegeta_majin saga_vegeta_mid_base saga_vegeta_mid_ssg2
saga_vegeta_mid_ssj saga_vegeta_namek saga_vegetto_base saga_vegetto_ssj saga_videl saga_yakon saga_yamcha
saga_zangya saga_zarbon saga_zarbont1 saga_nail saga_bido saga_dore saga_neiz saga_shin saga_slug
shadow_dummy mini_buu""".split()

# Every geo model under assets/models/entity/sagas must be represented (brief rule):
# a handful of geo files are DMZ's shared "stage" models (saga_goku, saga_trunks_ssj, ...) used by the
# quest-NPC renderer; they become entities in their own right so no model is left unreferenced.
GEO_ONLY_IDS = sorted(
    f[:-9] for f in os.listdir(os.path.join(ASSETS, "models", "entity", "sagas"))
    if f.endswith(".geo.json") and f[:-9] not in SAGA_IDS)
SAGA_IDS = SAGA_IDS + GEO_ONLY_IDS

MASTER_IDS = """master_babidi master_cell master_dende master_enma master_frieza master_gero master_gohan
master_goku master_guru master_kaiosama master_karin master_krillin master_oldkai master_piccolo master_popo
master_roshi master_toribot master_trunks master_uranai master_vegeta master_yamcha""".split()

ALLIED_STEMS = ("saga_goku", "saga_gohan", "saga_fgohan", "saga_kid_gohan", "saga_krillin", "saga_piccolo",
                "saga_nail", "saga_vegeta_end", "saga_vegeta_mid", "saga_trunks", "saga_ftrunks", "saga_kid_trunks",
                "saga_goten", "saga_gotenks", "saga_vegetto", "saga_videl", "saga_bulma", "saga_shin", "saga_kibito",
                "saga_yamcha", "saga_chaoz", "saga_tien", "saga_paikuhan")

# models built at a bigger grid than the 2-block humanoid standard
SAGA_SCALE = {"saga_gete_robot": 0.8, "saga_yakon": 0.8, "saga_dr_wheelo": 0.65, "saga_hirudegarn": 0.9,
              "saga_hirudegarn_incomplete1": 0.7, "saga_hirudegarn_incomplete2": 0.8, "saga_super_hirudegarn": 1.1}

GRUNTS = {"saga_friezasoldier01", "saga_friezasoldier02", "saga_friezasoldier03", "saga_saibaman1", "saga_saibaman2",
          "saga_saibaman3", "saga_saibaman4", "saga_saibaman5", "saga_saibaman6", "saga_slug_soldier",
          "saga_morosoldier", "saga_cell_jr", "saga_gete_robot", "mini_buu", "saga_spopovitch", "saga_puipui",
          "saga_yakon", "saga_bido", "saga_bujin", "saga_zangya", "saga_gokua", "saga_neiz", "saga_dore", "saga_salza",
          "saga_cui", "saga_guldo", "shadow_dummy", "saga_paragus", "saga_babidi", "saga_a15", "saga_a14"}

# level hints for saga entities that no quest spawns (interpolated on the story quest curve)
LEVEL_HINT = {
    "saga_goku_early": 20, "saga_goku_early_noweights": 22, "saga_chaoz": 18, "saga_tien_early": 24,
    "saga_yamcha": 20, "saga_piccolo": 35, "saga_nail": 200, "saga_piccolo_kami": 700, "saga_frieza_third": 300,
    "saga_a16": 760, "saga_gohan_mid_base": 900, "saga_gohan_mid_ssj": 1100, "saga_gohan_mid_ssj2": 1350,
    "saga_goku_mid_ssj": 1000, "saga_vegeta_mid_base": 800, "saga_vegeta_mid_ssj": 1000, "saga_vegeta_mid_ssg2": 1150,
    "saga_ftrunks_ssj": 1100, "saga_ftrunks_ssg3": 1200, "saga_ftrunks_kid_base": 1300, "saga_ftrunks_kid_ssj": 1450,
    "saga_goku_end_base": 1500, "saga_goku_end_ssj": 1700, "saga_vegeta_end_ssj": 1700, "saga_gohan_end_ssj": 1700,
    "saga_gohan_end_ssj2": 1900, "saga_gohan_end_ultimate": 2150, "saga_goten_ssj": 1700, "saga_kid_trunks_ssj": 1700,
    "saga_gotenks_ssj": 2000, "saga_vegetto_base": 2200, "saga_vegetto_ssj": 2400, "saga_superbuu_piccolo": 2100,
    "saga_kibito": 1500, "saga_videl": 300, "saga_bulma": 1, "saga_morosoldier": 1500,
    "saga_broly_ssj_restricted": 1500, "saga_hirudegarn_incomplete1": 2400, "saga_a14": 700, "saga_a15": 700,
}

CONFIG_STATS = {}
try:
    for k, v in jload(os.path.join(CONF, "entities.json")).get("defaultEntityStats", {}).items():
        CONFIG_STATS[k.split(":", 1)[1]] = v
except Exception:
    pass

# per character technique picks (stem -> techniques)
TECH_BY_STEM = [
    ("saga_goku", ["kamehameha", "kaioken_attack", "spirit_bomb"]),
    ("saga_ginyu_goku", ["kamehameha", "ki_barrage"]),
    ("saga_gohan", ["masenko", "kamehameha"]),
    ("saga_fgohan", ["masenko", "kamehameha"]),
    ("saga_kid_gohan", ["masenko"]),
    ("saga_vegeta", ["galick_gun", "big_bang", "final_flash"]),
    ("saga_ozaruvegeta", ["oozaru_fist", "charged_ki_blast"]),
    ("saga_ozaru", ["oozaru_fist", "charged_ki_blast"]),
    ("saga_vegetto", ["kamehameha", "big_bang", "deadly_dance_vegetto"]),
    ("saga_frieza", ["death_beam", "supernova"]),
    ("saga_mecha_frieza", ["death_beam", "supernova"]),
    ("saga_king_cold", ["death_beam", "big_bang"]),
    ("saga_cell", ["kamehameha", "solar_flare", "special_beam_cannon"]),
    ("saga_piccolo", ["special_beam_cannon", "masenko"]),
    ("saga_nail", ["masenko", "ki_barrage"]),
    ("saga_krillin", ["kienzan", "kamehameha", "solar_flare"]),
    ("saga_yamcha", ["sokidan", "wolf_fang"]),
    ("saga_tien", ["solar_flare", "ki_barrage"]),
    ("saga_chaoz", ["ki_blast"]),
    ("saga_trunks", ["burning_attack", "final_flash"]),
    ("saga_ftrunks", ["burning_attack", "final_flash"]),
    ("saga_kid_trunks", ["ki_barrage", "charged_ki_blast"]),
    ("saga_goten", ["kamehameha", "ki_barrage"]),
    ("saga_gotenks", ["kamehameha", "ki_barrage", "meteor"]),
    ("saga_raditz", ["ki_barrage", "charged_ki_blast"]),
    ("saga_nappa", ["ki_barrage", "charged_ki_blast", "final_explosion"]),
    ("saga_saibaman", ["ki_blast"]),
    ("saga_cui", ["ki_barrage"]),
    ("saga_dodoria", ["ki_barrage", "charged_ki_blast"]),
    ("saga_zarbon", ["charged_ki_blast", "ki_barrage"]),
    ("saga_guldo", ["ki_blast"]),
    ("saga_recoome", ["charged_ki_blast", "ki_barrage"]),
    ("saga_burter", ["ki_barrage", "meteor"]),
    ("saga_jeice", ["charged_ki_blast", "ki_barrage"]),
    ("saga_ginyu", ["ki_barrage", "charged_ki_blast"]),
    ("saga_friezasoldier", ["ki_blast"]),
    ("saga_a1", ["ki_barrage", "charged_ki_blast"]),
    ("saga_super_a13", ["charged_ki_blast", "ki_barrage", "final_explosion"]),
    ("saga_drgero", ["ki_barrage"]),
    ("saga_buufat", ["ki_barrage", "charged_ki_blast"]),
    ("saga_evilbuu", ["ki_barrage", "charged_ki_blast"]),
    ("saga_superbuu", ["kamehameha", "ki_barrage", "charged_ki_blast"]),
    ("saga_kidbuu", ["kamehameha", "ki_barrage", "final_explosion"]),
    ("mini_buu", ["ki_blast"]),
    ("saga_dabura", ["charged_ki_blast", "ki_barrage"]),
    ("saga_babidi", ["ki_blast"]),
    ("saga_shin", ["ki_blast", "charged_ki_blast"]),
    ("saga_kibito", ["ki_blast"]),
    ("saga_broly", ["charged_ki_blast", "ki_barrage", "final_explosion"]),
    ("saga_bio_broly", ["charged_ki_blast", "ki_barrage"]),
    ("saga_paragus", ["ki_blast"]),
    ("saga_turles", ["charged_ki_blast", "kamehameha"]),
    ("saga_slug", ["charged_ki_blast", "ki_barrage"]),
    ("saga_cooler", ["supernova_cooler", "death_beam"]),
    ("saga_metal_cooler", ["supernova_cooler", "death_beam", "ki_barrage"]),
    ("saga_neiz", ["ki_barrage"]), ("saga_dore", ["charged_ki_blast"]), ("saga_salza", ["ki_barrage"]),
    ("saga_janemba", ["ki_barrage", "charged_ki_blast"]),
    ("saga_super_janemba", ["ki_barrage", "charged_ki_blast", "kienzan"]),
    ("saga_bojack", ["charged_ki_blast", "ki_barrage"]),
    ("saga_hirudegarn", ["ki_barrage", "final_explosion"]),
    ("saga_super_hirudegarn", ["ki_barrage", "final_explosion"]),
    ("saga_garlick_jr", ["charged_ki_blast", "ki_barrage"]),
    ("saga_dr_wheelo", ["ki_barrage", "charged_ki_blast"]),
    ("saga_paikuhan", ["ki_barrage", "meteor"]),
    ("saga_gete_robot", ["ki_blast"]),
    ("saga_videl", []), ("saga_bulma", []),
    ("saga_spopovitch", ["ki_blast"]), ("saga_puipui", ["ki_barrage"]), ("saga_yakon", []),
    ("saga_bido", ["ki_blast"]), ("saga_bujin", ["ki_barrage"]), ("saga_zangya", ["ki_barrage"]),
    ("saga_gokua", ["charged_ki_blast"]), ("shadow_dummy", []),
]

PHASE_CHAINS = [
    ["saga_frieza_first", "saga_frieza_second", "saga_frieza_third", "saga_frieza_base", "saga_frieza_fp"],
    ["saga_cell_imperfect", "saga_cell_semiperfect", "saga_cell_perfect", "saga_cell_superperfect"],
    ["saga_buufat", "saga_evilbuu", "saga_superbuu", "saga_superbuu_gotenks", "saga_superbuu_gohan", "saga_kidbuu"],
    ["saga_garlick_jr", "saga_garlick_jr_transformed"],
    ["saga_slug", "saga_slug_giant"],
    ["saga_cooler", "saga_cooler_5ta"],
    ["saga_metal_cooler", "saga_metal_cooler_core"],
    ["saga_broly_base", "saga_broly_ssj", "saga_broly_lssj"],
    ["saga_bojack", "saga_bojack_fp"],
    ["saga_janemba_fat", "saga_super_janemba"],
    ["saga_hirudegarn_incomplete1", "saga_hirudegarn_incomplete2", "saga_hirudegarn", "saga_super_hirudegarn"],
    ["saga_a13", "saga_super_a13"],
    ["saga_vegeta", "saga_ozaruvegeta"],
    ["saga_zarbon", "saga_zarbont1"],
    ["saga_bio_broly", "saga_bio_broly_giant"],
    ["saga_gohan_mid_ssj", "saga_gohan_mid_ssj2"],
    ["saga_goku_end_ssj2", "saga_goku_end_ssj3"],
    ["saga_gotenks", "saga_gotenks_ssj", "saga_gotenks_ssj3"],
]

TAUNTS = {
    "saga_raditz": "So you are the one Kakarot has been playing with. Pathetic.",
    "saga_nappa": "Hahaha! Time to show you what a real Saiyan elite can do!",
    "saga_vegeta": "You dare stand before the Prince of all Saiyans? I'll crush you!",
    "saga_ozaruvegeta": "GRAAAH! Now you will see the true power of a Saiyan under the full moon!",
    "saga_ozaru": "GROOOAAAR!",
    "saga_saibaman": "Kiiii!",
    "saga_cui": "Frieza sends his regards. This will be over quickly.",
    "saga_dodoria": "Lord Frieza will reward me well for squashing you.",
    "saga_zarbon": "How unsightly. Allow me to end this with some elegance.",
    "saga_zarbont1": "You forced me to show my ugly side. Now suffer for it!",
    "saga_guldo": "Time freeze! You won't even see what hit you.",
    "saga_recoome": "RECOOME... BOOM! Let's have some fun, little guy!",
    "saga_burter": "I'm the fastest in the universe! You can't touch me!",
    "saga_jeice": "Oi! Nobody messes with the Ginyu Force and walks away!",
    "saga_ginyu": "Behold the elegance of Captain Ginyu! Prepare to be crushed!",
    "saga_ginyu_goku": "This body is magnificent! Now let's see what it can really do!",
    "saga_friezasoldier": "For Lord Frieza! Get them!",
    "saga_frieza_first": "Oh my, another insect to squash. Let's not waste my time.",
    "saga_frieza_second": "My power level is over one million. You never stood a chance.",
    "saga_frieza_third": "Would you like to see my next transformation? I promise it won't hurt... much.",
    "saga_frieza_base": "This is my final form. There is no hope left for you.",
    "saga_frieza_fp": "I will destroy this entire planet, and you along with it!",
    "saga_mecha_frieza": "I have been rebuilt, and I will have my revenge on this miserable planet!",
    "saga_king_cold": "Such an unruly little world. Frieza, let me handle this one.",
    "saga_drgero": "The Red Ribbon Army is not finished! You'll fuel my androids!",
    "saga_a19": "Energy readings acquired. Commencing absorption.",
    "saga_a18": "You're not even worth the effort, but fine, let's dance.",
    "saga_a17": "You're in my way. I don't like things being in my way.",
    "saga_a16": "I do not wish to fight. But if you threaten this planet, I will stop you.",
    "saga_cell_imperfect": "Your energy will make a fine addition to my perfection.",
    "saga_cell_semiperfect": "Just a little more... then I will be perfect!",
    "saga_cell_perfect": "Welcome to the Cell Games. Show me what you've got.",
    "saga_cell_superperfect": "I have returned stronger than ever. This time nothing will stop me!",
    "saga_cell_jr": "Hehehe! Papa said we can play as rough as we want!",
    "saga_shadow_dummy": "...",
    "shadow_dummy": "...",
    "saga_ftrunks": "I came from the future to stop this. I won't hold back!",
    "saga_fgohan": "I've survived the androids for years. Show me your resolve!",
    "saga_goku": "Hey! Let's have a good fight! Don't hold anything back!",
    "saga_gohan": "I don't like fighting, but I'll protect the people I love!",
    "saga_kid_gohan": "I... I won't run away anymore! Here I come!",
    "saga_krillin": "Alright, Krillin's in! Don't underestimate me just because I'm short!",
    "saga_piccolo": "Hmph. Let's see if you're worth the effort of getting serious.",
    "saga_nail": "I am Nail, warrior of Namek. You shall not pass.",
    "saga_yamcha": "Wolf Fang Fist! Let's see you handle the desert bandit!",
    "saga_tien": "Focus and discipline win battles. Show me yours.",
    "saga_chaoz": "I'll do my best! Tien, watch me!",
    "saga_goten": "Yay, a fight! I'm gonna go Super Saiyan!",
    "saga_kid_trunks": "You're gonna lose! My dad is the strongest, and so am I!",
    "saga_gotenks": "Behold the mighty Gotenks! Ghosts, assemble!",
    "saga_shin": "As the Supreme Kai, I must test your strength. Please, do not hold back.",
    "saga_kibito": "The Supreme Kai has ordered me to test you. Prepare yourself.",
    "saga_spopovitch": "Hahaha! Babidi's magic makes me unstoppable!",
    "saga_puipui": "This planet's gravity is nothing! You're fighting on my terms!",
    "saga_yakon": "Mmm... your ki smells delicious. Let me eat it.",
    "saga_dabura": "I am the King of the Demon Realm. Kneel, or be turned to stone.",
    "saga_babidi": "Paparapapa! My magic will bend you to my will!",
    "saga_buufat": "Buu make you candy! Then Buu eat you!",
    "saga_evilbuu": "You... are nothing. Buu will erase you.",
    "saga_superbuu": "Play with me. Or die. Buu doesn't care which.",
    "saga_kidbuu": "Raaaah! Buu destroy! Buu destroy everything!",
    "mini_buu": "Mini Buu play!",
    "saga_vegeta_majin": "Majin or not, I am still the Prince of all Saiyans!",
    "saga_vegetto": "You're fighting Vegito now. It's over, and you know it.",
    "saga_garlick_jr": "The Dead Zone awaits you! Your world belongs to Garlic Jr.!",
    "saga_garlick_jr_transformed": "Now you'll face my true form! Tremble before me!",
    "saga_dr_wheelo": "My brilliant brain will rule this world in a body of steel!",
    "saga_turles": "Kakarot's blood runs in me, but I never learned mercy.",
    "saga_slug": "This planet will be my new throne. Kneel before Lord Slug!",
    "saga_slug_giant": "Puny insects! Feel the wrath of a Super Namekian!",
    "saga_slug_soldier": "Lord Slug wants this planet cleared. Nothing personal.",
    "saga_cooler": "My brother was careless. I never make his mistakes.",
    "saga_cooler_5ta": "This form is beyond anything Frieza ever achieved!",
    "saga_metal_cooler": "The Big Gete Star has made me perfect. Resistance is pointless.",
    "saga_metal_cooler_core": "I am legion. Destroy one body and a thousand more await.",
    "saga_gete_robot": "*mechanical whirring*",
    "saga_a13": "Y'all Z-fighters are gonna pay for what happened to the doctor!",
    "saga_super_a13": "With the parts of 14 and 15, I'm the ultimate android!",
    "saga_a14": "Target acquired. Terminate.",
    "saga_a15": "Hehehe, little fella, you're about to get scrapped.",
    "saga_broly_base": "Kakarot... KAKAROT!",
    "saga_broly_ssj": "Is that all you've got? I'm just getting warmed up!",
    "saga_broly_lssj": "KAKAROOOT! Everything will burn!",
    "saga_paragus": "My son will bring this planet to its knees! You cannot stop him!",
    "saga_bojack": "The galaxy will bow to Bojack once more. Starting with you.",
    "saga_bojack_fp": "You've made me angry. Now witness my full power!",
    "saga_zangya": "Such a pretty little thing. It'd be a shame to break you.",
    "saga_bido": "Bojack said to crush you. So that's what I'll do.",
    "saga_bujin": "My psychic threads will hold you while the others tear you apart.",
    "saga_gokua": "My blade has never met a foe it couldn't cut. Draw your weapon!",
    "saga_bio_broly": "Kakarot... *gurgle* ...KAKAROT!",
    "saga_bio_broly_giant": "*roaring as the culture fluid grows*",
    "saga_paikuhan": "Pikkon of the West Galaxy. The Otherworld Tournament begins!",
    "saga_janemba_fat": "Hee hee hee! Janemba play!",
    "saga_super_janemba": "*a sword of demonic energy forms* ...",
    "saga_hirudegarn": "*a thundering roar echoes across the sky*",
    "saga_super_hirudegarn": "*Hirudegarn's final form rises, blotting out the sun*",
    "saga_morosoldier": "Moro's army takes what it wants. This planet is next.",
    "saga_videl": "I'm the daughter of the champ. You're not getting past me!",
    "saga_trunks": "I came back to change this timeline. Draw your sword.",
    "saga_future_gohan": "One arm is all I need to take you down. Come on!",
    "saga_salza": "Salza blade! Lord Cooler's elite doesn't lose to trash like you.",
    "saga_dore": "Dore will crush you with his bare hands. No tricks needed.",
    "saga_neiz": "My skin is armour and my hands are lightning. Care to touch?",
    "saga_kibito": "The Supreme Kai has ordered me to test you. Prepare yourself.",
    "saga_bulma": "Oh, hi! Need something from Capsule Corp? I'm a little busy.",
}


def stem_lookup(eid, table):
    best = None
    for stem, val in table:
        if eid.startswith(stem) and (best is None or len(stem) > len(best[0])):
            best = (stem, val)
    return best[1] if best else None


def taunt_for(eid):
    if eid in TAUNTS:
        return TAUNTS[eid]
    best = ""
    for k in TAUNTS:
        if eid.startswith(k) and len(k) > len(best):
            best = k
    if best:
        return TAUNTS[best]
    return "%s stands ready to fight." % entity_name(eid)


def interp_stats(level):
    """Piecewise-linear interpolation of health/melee/ki over the story quest curve."""
    pts = sorted(set(level_anchors))
    if not pts:
        return 100, 10, 10
    if level <= pts[0][0]:
        p = pts[0]
        f = max(0.05, level / max(1, p[0]))
        return p[1] * f, p[2] * f, p[3] * f
    if level >= pts[-1][0]:
        p = pts[-1]
        f = level / p[0]
        return p[1] * f, p[2] * f, p[3] * f
    for a, b in zip(pts, pts[1:]):
        if a[0] <= level <= b[0]:
            t = (level - a[0]) / max(1, (b[0] - a[0]))
            return (a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t)
    return pts[-1][1:]


def texture_variants(tex_dir, base):
    out = []
    d = os.path.join(ASSETS, "textures", "entity", tex_dir)
    if not os.path.isdir(d):
        return out
    rx = re.compile("^" + re.escape(base) + r"_(\d+)\.png$")
    for f in sorted(os.listdir(d)):
        if rx.match(f):
            out.append("%s/%s" % (tex_dir, f[:-4]))
    return out


def resolve_texture(candidates, eid):
    for c in candidates:
        if exists_asset("textures/entity/%s.png" % c):
            if c != candidates[0]:
                subst("entity %s: texture %s missing -> %s" % (eid, candidates[0], c))
            return c
    subst("entity %s: NO texture found (%s)" % (eid, candidates))
    return ""


SCENES = {
    "player": "res://scenes/player/Player.tscn", "enemy": "res://scenes/entities/Enemy.tscn",
    "master": "res://scenes/entities/Npc.tscn", "npc": "res://scenes/entities/Npc.tscn",
    "animal": "res://scenes/entities/Animal.tscn", "dragon": "res://scenes/entities/Dragon.tscn",
    "projectile": "res://scenes/entities/KiBlast.tscn", "pickup": "res://scenes/entities/Pickup.tscn",
    "vehicle": "res://scenes/entities/Vehicle.tscn",
}


def make_entity(eid, kind, model, texture_candidates, animations, scale=0.9375, stats=None, ai_tier=1,
                faction="villain", can_fly=False, techniques=None, drops=None, sounds=None, bgm="", taunt="",
                master="", extra=None, name=None):
    e = OrderedDict()
    e["id"] = eid
    e["name"] = name if name else entity_name(eid)
    e["kind"] = kind
    e["scene"] = SCENES[kind]
    if model and not exists_asset("models/%s.geo.json" % model):
        subst("entity %s: model %s missing -> none" % (eid, model))
        model = ""
    e["model"] = model
    tex = resolve_texture(texture_candidates, eid) if texture_candidates else ""
    e["texture"] = tex
    e["hd_texture"] = bool(tex) and exists_asset("textures/entity/hd/%s.png" % tex)
    if tex:
        vars_ = texture_variants(os.path.dirname(tex), os.path.basename(tex))
        if vars_:
            e["texture_variants"] = vars_
    if model and exists_asset("models/hd/%s.geo.json" % model):
        e["hd_model"] = True
    anims = []
    for a in animations:
        if exists_asset("animations/%s.animation.json" % a):
            anims.append(a)
        else:
            subst("entity %s: animation %s missing -> dropped" % (eid, a))
    e["animations"] = anims
    e["hitbox"] = hitbox_for(model, scale) if model else [0.6, 1.8]
    e["scale"] = scale
    st = stats or {"health": 100, "melee": 10, "ki": 10}
    e["stats"] = OrderedDict([
        ("health", int(round(st["health"]))),
        ("melee", int(round(st.get("melee", 0)))),
        ("ki", int(round(st.get("ki", 0)))),
        ("defense", int(round(st.get("defense", max(0, st.get("melee", 0) * 0.18))))),
        ("speed", st.get("speed", 1.0)),
    ])
    e["ai_tier"] = ai_tier
    e["faction"] = faction
    e["can_fly"] = can_fly
    e["techniques"] = techniques if techniques is not None else []
    e["drops"] = drops if drops is not None else []
    e["sounds"] = sounds if sounds is not None else {"hurt": "hurt", "death": "knockback_character", "attack": "punch"}
    e["bgm"] = bgm
    e["taunt"] = taunt
    if master:
        e["master"] = master
    if extra:
        e.update(extra)
    return e


def convert_entities():
    ents = []
    saga_anim = ["entity/sagas/saga_base"]

    # ---- player
    ents.append(make_entity(
        "player", "player", "entity/races/human", ["races/base"],
        ["entity/races/movement", "entity/races/combat", "entity/races/ki", "entity/races/transf", "entity/races/skp"],
        stats={"health": 100, "melee": 11, "ki": 12, "defense": 4}, ai_tier=0, faction="player", can_fly=True,
        techniques=["ki_blast"], sounds={"hurt": "hurt", "death": "knockback_character", "attack": "punch"},
        taunt="", name="Player",
        extra={"physics": {"gravity": 23.0, "jump": 7.4, "walk": 4.2, "sprint": 5.6, "sneak": 1.6, "swim": 2.4,
                           "fly": 12.0, "fly_fast_mult": 2.2, "step_height": 0.6, "eye_height": 1.62},
               "hitbox": [0.6, 1.8]}))

    # ---- masters
    master_key = {v["entity"]: k for k, v in MASTER_TABLE.items()}
    for mid in MASTER_IDS:
        key = master_key.get(mid, mid.replace("master_", ""))
        ents.append(make_entity(
            mid, "master", "entity/master/" + mid, ["master/" + mid], ["entity/master/" + mid],
            stats={"health": 5000, "melee": 60, "ki": 60, "defense": 20}, ai_tier=0, faction="neutral",
            can_fly=mid in ("master_goku", "master_gohan", "master_piccolo", "master_vegeta", "master_trunks",
                            "master_krillin", "master_yamcha", "master_frieza", "master_cell", "master_kaiosama"),
            techniques=[t for t in MASTER_TABLE.get(key, {}).get("teaches", []) if t in TECH_IDS][:3],
            sounds={"hurt": "punch", "death": "knockback_character", "attack": "punch"},
            taunt=MASTER_TABLE.get(key, {}).get("taunt", ""), master=key,
            extra={"invulnerable": True, "interact": "talk"}))

    # ---- sagas
    for eid in sorted(set(SAGA_IDS)):
        own = "entity/sagas/" + eid
        if exists_asset("models/%s.geo.json" % own):
            model = own
        elif eid in MODEL_ALIAS:
            model = "entity/sagas/" + MODEL_ALIAS[eid]
            subst("entity %s: no own geo -> model %s" % (eid, model))
        else:
            subst("entity %s: no geo and no alias -> skipped" % eid)
            UNPORTED.append("entity %s (no model)" % eid)
            continue
        tex_cands = ["sagas/" + eid, "sagas/" + os.path.basename(model)]
        if eid in STAGE_TEXTURE:
            tex_cands.insert(1, STAGE_TEXTURE[eid])
        if os.path.basename(model) in STAGE_TEXTURE:
            tex_cands.append(STAGE_TEXTURE[os.path.basename(model)])
        if eid.startswith("saga_saibaman"):
            tex_cands.append("races/saibaman")
        anims = list(saga_anim)
        if eid.startswith("saga_saibaman"):
            anims = ["entity/sagas/saga_saibaman"]
        elif eid == "shadow_dummy":
            anims = ["entity/sagas/shadow_dummy", "entity/sagas/saga_base"]
        if exists_asset("animations/%s.animation.json" % own) and own not in anims:
            anims.append(own)
        allied = any(eid.startswith(s) for s in ALLIED_STEMS)
        faction = "z_fighter" if allied else "villain"
        kind = "npc" if eid in ("saga_bulma",) else "enemy"
        # stats
        rec = story_kill_stats.get(eid) or side_kill_stats.get(eid)
        if rec is None and eid.startswith("saga_saibaman"):
            rec = story_kill_stats.get("saga_saibaman1")
        if rec:
            stats = {"health": rec["health"], "melee": rec["melee"], "ki": rec["ki"]}
            ai_tier = rec.get("ai_tier", 1) or 1
        elif eid in CONFIG_STATS:
            c = CONFIG_STATS[eid]
            stats = {"health": c["health"], "melee": c["meleeDamage"], "ki": c["kiDamage"]}
            ai_tier = 1
        else:
            lvl = LEVEL_HINT.get(eid)
            if lvl is None:
                lvl = 100
                subst("entity %s: no quest stats and no level hint -> level 100" % eid)
            h, m, k = interp_stats(lvl)
            stats = {"health": h, "melee": m, "ki": k}
            ai_tier = 1 if lvl < 200 else (2 if lvl < 1000 else 3)
        scale = SAGA_SCALE.get(eid, 0.9375)
        if eid == "mini_buu":
            scale = 0.5
        elif eid == "saga_bio_broly_giant":
            scale = 2.2
        grunt = eid in GRUNTS or allied
        bgm = "battle" if grunt else "boss"
        if kind == "npc":
            bgm = ""
        techniques = stem_lookup(eid, TECH_BY_STEM)
        if techniques is None:
            techniques = ["ki_blast"]
        techniques = [t for t in techniques if t in TECH_IDS]
        drops = [{"item": "senzu_bean", "chance": 0.1 if grunt else 0.35}]
        if eid == "saga_raditz":
            drops = [{"item": "broken_scouter", "chance": 1.0}, {"item": "senzu_bean", "chance": 0.25}]
        elif eid.startswith("saga_friezasoldier") or eid in ("saga_cui", "saga_dodoria", "saga_zarbon"):
            drops = [{"item": "broken_scouter", "chance": 0.3}, {"item": "senzu_bean", "chance": 0.1}]
        elif eid in ("saga_nappa", "saga_vegeta", "saga_vegeta_namek"):
            drops = [{"item": "broken_scouter", "chance": 0.5}, {"item": "senzu_bean", "chance": 0.35}]
        elif eid.startswith("saga_a1") or eid in ("saga_drgero", "saga_gete_robot", "saga_super_a13", "saga_metal_cooler",
                                                   "saga_metal_cooler_core"):
            drops = [{"item": "gete_scrap", "chance": 0.6}, {"item": "ki_battery", "chance": 0.15}]
        elif eid.startswith("saga_cell") or eid.startswith("saga_bio_broly"):
            drops = [{"item": "kikono_shard", "chance": 0.6}, {"item": "senzu_bean", "chance": 0.3}]
        elif eid.startswith("saga_saibaman"):
            drops = [{"item": "senzu_bean", "chance": 0.05}]
        elif eid in ("shadow_dummy", "saga_bulma"):
            drops = []
        if eid.startswith("saga_friezasoldier"):
            sounds = {"hurt": "frieza_s_hurt", "death": "frieza_s_death", "attack": "frieza_s_attack",
                      "ambient": "frieza_s_ambient"}
        elif eid in ("saga_ozaru", "saga_ozaruvegeta"):
            sounds = {"hurt": "vegeta_oozaru_growl", "death": "vegeta_oozaru_death", "attack": "oozaru_fist"}
        elif eid in ("saga_piccolo", "saga_nail", "saga_piccolo_kami", "saga_slug", "saga_slug_giant", "saga_slug_soldier"):
            sounds = {"hurt": "namek_vill_hurt", "death": "namek_vill_death", "attack": "punch"}
        elif eid.startswith("saga_frieza") or eid in ("saga_mecha_frieza", "saga_king_cold", "saga_cooler", "saga_cooler_5ta"):
            sounds = {"hurt": "frieza_s_hurt", "death": "knockback_character", "attack": "punch"}
        else:
            sounds = {"hurt": "punch", "death": "knockback_character", "attack": "punch"}
        extra = OrderedDict()
        for chain in PHASE_CHAINS:
            if eid in chain:
                rest = chain[chain.index(eid) + 1:]
                if rest:
                    extra["phases"] = rest
                break
        if eid in ("saga_bio_broly_giant", "saga_slug_giant", "saga_ozaru", "saga_ozaruvegeta", "saga_hirudegarn",
                   "saga_super_hirudegarn", "saga_hirudegarn_incomplete1", "saga_hirudegarn_incomplete2"):
            extra["giant"] = True
        ents.append(make_entity(
            eid, kind, model, tex_cands, anims, scale=scale, stats=stats, ai_tier=ai_tier, faction=faction,
            can_fly=eid not in ("saga_bulma", "shadow_dummy", "saga_gete_robot", "saga_spopovitch", "saga_videl"),
            techniques=techniques, drops=drops, sounds=sounds, bgm=bgm, taunt=taunt_for(eid), extra=extra))

    # ---- animals
    def cfg(eid, dh, dm, dk):
        c = CONFIG_STATS.get(eid)
        if c:
            return {"health": c["health"], "melee": c["meleeDamage"], "ki": c["kiDamage"]}
        return {"health": dh, "melee": dm, "ki": dk}

    animal_sounds = {"hurt": "hurt", "death": "knockback_character", "attack": "punch"}
    for eid, meat, fly in (("dino1", "raw_dino_meat", False), ("dino2", "raw_dino_meat", False),
                           ("dino3", "raw_dino_meat", True), ("dinokid", "raw_baby_dino_meat", False)):
        ents.append(make_entity(
            eid, "animal", "entity/animal/" + eid, ["animal/" + eid], ["entity/animal/" + eid], scale=1.0,
            stats=cfg(eid, 80, 6, 0), ai_tier=1, faction="wild", can_fly=fly, techniques=[],
            drops=[{"item": meat, "chance": 1.0, "count": [1, 3]}], sounds=animal_sounds, bgm="",
            taunt="", extra={"aggressive": eid != "dinokid"}))
    ents.append(make_entity(
        "sabertooth", "animal", "entity/animal/sabertooth", ["animal/sabertooth"], ["entity/animal/sabertooth"],
        scale=1.0, stats=cfg("sabertooth", 30, 5, 0), faction="wild", techniques=[],
        drops=[{"item": "raw_meat", "chance": 1.0, "count": [1, 2]}], sounds=animal_sounds,
        extra={"aggressive": True}))
    frog_sounds = {"hurt": "frogsound1", "death": "frogsound3", "attack": "frogsound2", "ambient": "froglaugh"}
    for eid in ("namek_frog", "namek_frog_ginyu"):
        ents.append(make_entity(
            eid, "animal", "entity/animal/namekfrog", ["animal/namekfrog_0"], ["entity/animal/namekfrog"], scale=1.0,
            stats={"health": 10, "melee": 1, "ki": 0, "defense": 0}, faction="wild", techniques=[],
            drops=[{"item": "frog_legs_raw", "chance": 0.8}], sounds=frog_sounds, extra={"aggressive": False}))

    # ---- enemies
    enemy_sounds = {"hurt": "punch", "death": "knockback_character", "attack": "punch"}
    ents.append(make_entity("bandit", "enemy", "entity/enemies/bandit", ["enemies/bandit"], ["entity/enemies/bandit"],
                            scale=0.55, stats=cfg("bandit", 75, 10, 0), faction="villain", techniques=[],
                            drops=[{"item": "bread", "chance": 0.3}, {"item": "iron_ingot", "chance": 0.1}],
                            sounds=enemy_sounds, bgm="battle", taunt="Hand over your capsules and nobody gets hurt!"))
    ents.append(make_entity("red_ribbon_soldier", "enemy", "entity/enemies/red_ribbon_soldier",
                            ["enemies/red_ribbon_soldier"], ["entity/enemies/red_ribbon_soldier"],
                            stats=cfg("red_ribbon_soldier", 40, 5, 0), faction="villain", techniques=[],
                            drops=[{"item": "iron_ingot", "chance": 0.25}, {"item": "redstone", "chance": 0.2}],
                            sounds=enemy_sounds, bgm="battle", taunt="Red Ribbon Army! Open fire!",
                            extra={"ranged": True}))
    for eid in ("robot1", "robot2", "robot3"):
        ents.append(make_entity(eid, "enemy", "entity/enemies/robot1", ["enemies/" + eid, "enemies/robot1"],
                                ["entity/enemies/robot1"], scale=0.45, stats=cfg(eid, 120, 15, 0), faction="villain",
                                techniques=[], drops=[{"item": "gete_scrap", "chance": 0.4}, {"item": "redstone", "chance": 0.4}],
                                sounds={"hurt": "block1", "death": "ki_explosion_impact", "attack": "punch"},
                                bgm="battle", taunt="*servo whine* TARGET LOCKED."))
    ents.append(make_entity("robotxv", "enemy", "entity/enemies/robotxv", ["enemies/robotxv"], ["entity/enemies/robotxv"],
                            scale=1.0, stats={"health": 150, "melee": 18, "ki": 10, "defense": 6}, faction="villain",
                            techniques=["ki_blast"], drops=[{"item": "gete_scrap", "chance": 0.5}],
                            sounds={"hurt": "block2", "death": "ki_explosion_impact", "attack": "punch"},
                            bgm="battle", taunt="Combat protocol engaged."))

    # ---- namekian npcs
    namek_sounds = {"hurt": "namek_vill_hurt", "death": "namek_vill_death", "attack": "punch", "ambient": "namek_vill_ambient"}
    ents.append(make_entity("namek_warrior", "npc", "entity/enemies/namekian", ["enemies/namek_warrior_0"],
                            ["entity/enemies/namekian"], stats={"health": 400, "melee": 25, "ki": 20, "defense": 5},
                            faction="neutral", can_fly=True, techniques=["ki_blast"], drops=[], sounds=namek_sounds,
                            taunt="A warrior of Namek guards this village.", extra={"interact": "talk", "defends_village": True}))
    ents.append(make_entity("namek_trader", "npc", "entity/enemies/namekian", ["enemies/namek_trader_0"],
                            ["entity/enemies/namekian"], stats={"health": 200, "melee": 10, "ki": 0, "defense": 2},
                            faction="neutral", techniques=[], drops=[], sounds=namek_sounds,
                            taunt="Welcome, traveler. Care to trade?", extra={"interact": "trade"}))
    ents.append(make_entity("cc_namekian", "npc", "entity/enemies/namekian", ["enemies/cc_namekian"],
                            ["entity/enemies/namekian"], stats={"health": 200, "melee": 10, "ki": 0, "defense": 2},
                            faction="neutral", techniques=[], drops=[], sounds=namek_sounds,
                            taunt="Capsule Corp is always hiring, you know.", extra={"interact": "talk"}))

    # ---- dragons (size straight from the DMZ dragon definitions)
    dragon_sounds = {"hurt": "shenron", "death": "shenron", "attack": "shenron", "summon": "shenron"}
    for eid, model, tex, anim in (
            ("shenron", "entity/dragon/shenron", "dragon/shenron", "entity/dragon/shenron"),
            ("porunga", "entity/dragon/porunga", "dragon/porunga", "entity/dragon/porunga"),
            ("super_shenron", "entity/dragon/shenron", "dragon/shenron", "entity/dragon/shenron"),
            ("toronbo", "dmzplus/entity/dragon/toronbo", "dmzplus/dragon/toronbo", "dmzplus/entity/dragon/toronbo")):
        d = DRAGON_DEFS.get(eid, {})
        height = float(d.get("entity_height", 17.0))
        width = float(d.get("entity_width", 3.0))
        ext = geo_extent(model)
        scale = round(height / ext[1], 3) if ext and ext[1] > 0 else 1.0
        if eid == "super_shenron":
            subst("entity super_shenron: no DMZ Plus geo/texture -> shenron model scaled to %.0f blocks (golden tint)" % height)
        ents.append(make_entity(eid, "dragon", model, [tex], [anim], scale=scale,
                                stats={"health": 100000, "melee": 0, "ki": 0, "defense": 999}, ai_tier=0,
                                faction="neutral", can_fly=True, techniques=[], drops=[], sounds=dragon_sounds,
                                bgm="", taunt="", name=entity_name(eid) if eid != "super_shenron" else "Super Shenron",
                                extra={"invulnerable": True, "wish_count": int(d.get("wish_count", 1)),
                                       "ball_set": d.get("ball_set", "earth"),
                                       "hitbox": [round(min(width, 24.0), 2), round(min(height, 64.0), 2)],
                                       "tint": "#FFD24D" if eid == "super_shenron" else "#FFFFFF"}))
    ents.append(make_entity("zuno", "npc", "dmzplus/entity/zuno", ["dmzplus/zuno"], ["dmzplus/entity/zuno"], scale=1.0,
                            stats={"health": 1000, "melee": 0, "ki": 0, "defense": 50}, ai_tier=0, faction="neutral",
                            techniques=[], drops=[], sounds=namek_sounds, taunt="Ask me anything. One question per kiss.",
                            extra={"invulnerable": True, "interact": "talk"}))

    # ---- vehicles & stations
    ents.append(make_entity("flying_nimbus", "vehicle", "entity/kinton", ["kinton"], ["entity/kinton"], scale=1.0,
                            stats={"health": 50, "melee": 0, "ki": 0, "defense": 0}, ai_tier=0, faction="neutral",
                            can_fly=True, techniques=[], drops=[], sounds={"hurt": "nube", "death": "nube", "attack": "nube", "mount": "nube"},
                            extra={"speed_fly": 14.0, "pure_heart": True}))
    ents.append(make_entity("black_nimbus", "vehicle", "entity/kinton", ["black_kinton"], ["entity/kinton"], scale=1.0,
                            stats={"health": 50, "melee": 0, "ki": 0, "defense": 0}, ai_tier=0, faction="neutral",
                            can_fly=True, techniques=[], drops=[], sounds={"hurt": "nube", "death": "nube", "attack": "nube", "mount": "nube"},
                            extra={"speed_fly": 14.0, "pure_heart": False}))
    ents.append(make_entity("spacepod", "vehicle", "entity/spacepod", ["spacepod"], ["entity/spacepod"], scale=1.0,
                            stats={"health": 200, "melee": 0, "ki": 0, "defense": 20}, ai_tier=0, faction="neutral",
                            can_fly=True, techniques=[], drops=[],
                            sounds={"hurt": "block3", "death": "ki_explosion_impact", "attack": "ship_engine",
                                    "open": "ship_open", "land": "landing_ship", "takeoff": "ui_nave_takeoff"},
                            extra={"interact": "space_travel"}))
    ents.append(make_entity("punch_machine", "npc", "entity/punchstation", ["punchmachine"], ["entity/punchmachine"],
                            scale=1.0, stats={"health": 1000, "melee": 0, "ki": 0, "defense": 0}, ai_tier=0,
                            faction="neutral", techniques=[], drops=[], sounds={"hurt": "punch", "death": "block1", "attack": "punch"},
                            extra={"invulnerable": True, "interact": "train", "static": True}))

    # ---- projectiles & pickups
    for eid, tex, kind_hint in (("ki_blast", "ki/kiblast", "blast"), ("ki_beam", "ki/kiwave", "beam"),
                                ("ki_disc", "ki/kidisc", "disc")):
        ents.append(make_entity(eid, "projectile", "", [tex], [], scale=1.0,
                                stats={"health": 1, "melee": 0, "ki": 0, "defense": 0}, ai_tier=0, faction="neutral",
                                can_fly=True, techniques=[], drops=[],
                                sounds={"fire": "kiblast_shoot", "hit": "ki_explosion_impact"},
                                extra={"projectile_kind": kind_hint, "hitbox": [0.4, 0.4]}))
    for eid, model, tex, anim in (("sp_blue_hurricane", "entity/skills/sp_blue_hurricane", "skills/sp_blue_hurricane", "entity/skills/sp_blue_hurricane"),
                                  ("sp_dragon_fist", "entity/skills/sp_dragonfist", "skills/sp_dragonfist", "entity/skills/sp_dragonfist"),
                                  ("sp_ozaru_fist", "entity/skills/sp_ozarufist", "skills/sp_ozarufist", "entity/skills/sp_ozarufist"),
                                  ("sp_majin_candy", "entity/skills/majinskill", "races/candy", "entity/skills/majinskill")):
        ents.append(make_entity(eid, "projectile", model, [tex], [anim], scale=1.0,
                                stats={"health": 1, "melee": 0, "ki": 0, "defense": 0}, ai_tier=0, faction="neutral",
                                can_fly=True, techniques=[], drops=[], sounds={"fire": "kiblast_shoot", "hit": "ki_explosion_impact"},
                                extra={"projectile_kind": "special"}))
    dball_icons = OrderedDict()
    for set_name, pattern in (("earth", "dball%d"), ("namek", "dball%d_namek"),
                              ("super", "super_dball%d"), ("cereal", "cereal_dball%d")):
        icons = [pattern % i for i in range(1, 8)
                 if os.path.exists(os.path.join(ASSETS, "textures", "items", (pattern % i) + ".png"))]
        if icons:
            dball_icons[set_name] = icons
    subst("entity dragon_ball: no entity texture for block/dball -> renders the item icons %s"
          % ", ".join(dball_icons.keys()))
    ents.append(make_entity("dragon_ball", "pickup", "block/dball", [], ["block/dball"], scale=1.0,
                            stats={"health": 1, "melee": 0, "ki": 0, "defense": 0}, ai_tier=0, faction="neutral",
                            techniques=[], drops=[], sounds={"pickup": "dball_pickup", "ambient": "dragonballssound"},
                            extra={"hitbox": [0.5, 0.5], "glow": True, "icons": dball_icons}))
    ents.append(make_entity("item_drop", "pickup", "", [], [], scale=1.0,
                            stats={"health": 1, "melee": 0, "ki": 0, "defense": 0}, ai_tier=0, faction="neutral",
                            techniques=[], drops=[], sounds={"pickup": "item_pickup"},
                            extra={"hitbox": [0.25, 0.25]}, name="Dropped Item"))

    ids = [e["id"] for e in ents]
    assert len(ids) == len(set(ids)), "duplicate entity ids"
    jsave("entities.json", {"entities": ents})
    COUNTS["entities"] = len(ents)
    return {e["id"]: e for e in ents}


# ================================================================ RACES
RACE_ORDER = ["human", "saiyan", "namekian", "frostdemon", "majin", "bioandroid"]
RACE_MODEL = {"human": "entity/races/human", "saiyan": "entity/races/human", "namekian": "entity/races/human",
              "frostdemon": "entity/races/frostdemon", "majin": "entity/races/majin", "bioandroid": "entity/races/bioandroid"}
RACE_TEX_DIR = {"human": "humansaiyan", "saiyan": "humansaiyan", "namekian": "namekian", "frostdemon": "frostdemon",
                "majin": "majin", "bioandroid": "bioandroid"}
RACE_MULT = {
    "human": {"STR": 1.0, "SKP": 1.0, "STM": 1.0, "RES": 1.0, "VIT": 1.0, "PWR": 1.0, "ENE": 1.1, "health_regen": 1.0, "ki_regen": 1.15, "tp_gain": 1.0},
    "saiyan": {"STR": 1.1, "SKP": 1.0, "STM": 1.0, "RES": 1.0, "VIT": 1.0, "PWR": 1.1, "ENE": 1.0, "health_regen": 1.0, "ki_regen": 1.0, "tp_gain": 1.0},
    "namekian": {"STR": 1.0, "SKP": 1.0, "STM": 1.0, "RES": 1.05, "VIT": 1.0, "PWR": 1.0, "ENE": 1.0, "health_regen": 1.6, "ki_regen": 1.1, "tp_gain": 1.0},
    "frostdemon": {"STR": 1.0, "SKP": 1.0, "STM": 1.0, "RES": 1.0, "VIT": 1.0, "PWR": 1.1, "ENE": 1.1, "health_regen": 1.0, "ki_regen": 1.2, "tp_gain": 1.1},
    "majin": {"STR": 1.0, "SKP": 1.0, "STM": 1.0, "RES": 1.0, "VIT": 1.15, "PWR": 1.0, "ENE": 1.0, "health_regen": 1.3, "ki_regen": 1.0, "tp_gain": 1.0},
    "bioandroid": {"STR": 1.05, "SKP": 1.05, "STM": 1.05, "RES": 1.05, "VIT": 1.05, "PWR": 1.05, "ENE": 1.05, "health_regen": 1.2, "ki_regen": 1.0, "tp_gain": 1.0},
}
RACE_SKILL_NOTE = {
    "human": "Blood-Fueled Ki", "saiyan": "Zenkai", "namekian": "Assimilation", "frostdemon": "Prodigious Strength",
    "majin": "Absorption", "bioandroid": "Life Drain",
}


def list_dir_pngs(rel):
    d = os.path.join(ASSETS, "textures", "entity", rel)
    if not os.path.isdir(d):
        return []
    return sorted(f[:-4] for f in os.listdir(d) if f.endswith(".png"))


def race_textures(race):
    d = RACE_TEX_DIR[race]
    files = list_dir_pngs("races/" + d)
    faces = list_dir_pngs("races/%s/faces" % d)
    body = [f for f in files if "bodytype" in f or f.startswith("base_") or f.startswith("perfect_") or f.startswith("semiperfect_")]
    forms = [f for f in files if f not in body]
    eyes = [f for f in faces if "_eye" in f]
    nose = [f for f in faces if "nose" in f]
    mouth = [f for f in faces if "mouth" in f]
    out = OrderedDict()
    out["dir"] = "races/" + d
    out["body"] = body
    out["form_layers"] = forms
    out["eyes"] = eyes
    out["nose"] = nose
    out["mouth"] = mouth
    out["hair"] = "races/hair" if exists_asset("textures/entity/races/hair.png") else ""
    out["hair_base"] = "races/hair_base" if exists_asset("textures/entity/races/hair_base.png") else ""
    out["tattoos"] = ["races/tattoos/" + t for t in list_dir_pngs("races/tattoos")]
    out["base"] = "races/base"
    out["hd"] = os.path.isdir(os.path.join(ASSETS, "textures", "entity", "hd", "races", d))
    return out


def convert_races():
    races = OrderedDict()
    for race in RACE_ORDER:
        ch = jload(os.path.join(CONF, "races", race, "character.json"))
        st = jload(os.path.join(CONF, "races", race, "stats.json"))
        r = OrderedDict()
        r["id"] = race
        r["name"] = lang("race.dragonminez." + race, title_case(race))
        r["desc"] = lang("race.dragonminez.%s.desc" % race, "")
        for k, v in ch.items():
            if k in ("configVersion", "raceName"):
                continue
            r[k] = v
        model = RACE_MODEL[race] if not ch.get("customModel") else "entity/races/" + ch["customModel"]
        if not exists_asset("models/%s.geo.json" % model):
            subst("race %s: model %s missing -> entity/races/human" % (race, model))
            model = "entity/races/human"
        r["model"] = model
        r["model_slim"] = model + "_slim" if exists_asset("models/%s_slim.geo.json" % model) else model
        r["animations"] = ["entity/races/movement", "entity/races/combat", "entity/races/ki", "entity/races/transf", "entity/races/skp"]
        r["racial_skill_id"] = "racial_" + race
        r["racial_skill_name"] = RACE_SKILL_NOTE[race]
        r["classes"] = OrderedDict()
        for cname in sorted(st.get("classes", {})):
            c = st["classes"][cname]
            cc = OrderedDict()
            cc["name"] = lang("class.dragonminez." + cname, title_case(cname))
            cc["passive_desc"] = lang("class.dragonminez.%s.passive.desc" % cname, "")
            for k, v in c.items():
                cc[k] = v
            r["classes"][cname] = cc
        r["base_stats"] = OrderedDict((k, 5) for k in ("STR", "SKP", "STM", "RES", "VIT", "PWR", "ENE"))
        r["stat_multipliers"] = RACE_MULT[race]
        groups = []
        for p in sorted(glob.glob(os.path.join(CONF, "races", race, "forms", "*.json"))):
            groups.append(jload(p)["groupName"])
        groups += ["kaioken", "ultimate"]
        r["form_groups"] = groups
        r["textures"] = race_textures(race)
        races[race] = r
    jsave("races.json", {"races": races})
    COUNTS["races"] = len(races)
    return races


# ================================================================ FORMS
FORM_MODEL_MAP = {
    "buffed": "entity/races/hbuffed",
    "4arms": "entity/races/h4arms",
    "oozaru": "entity/races/oozaru",
    "ssj4gt": "entity/races/human",
    "ssj4d": "entity/races/human",
    "frostdemon_second": "entity/races/frostdemon_second",
    "frostdemon_third": "entity/races/frostdemon_third",
    "frostdemon_fifth": "entity/races/frostdemon_fifth",
    "frostdemon_fp": "entity/races/frostdemon_fp",
    "frostdemon_mecha": "entity/races/frostdemon_fp",
    "frostdemon_metalcore": "entity/races/frostdemon_metalcore",
    "bioandroid_semi": "entity/races/bioandroid_semi",
    "bioandroid_perfect": "entity/races/bioandroid_perfect",
    "bioandroid_ultra": "entity/races/bioandroid_ultra",
    "bioandroid_xeno": "entity/races/bioandroid_xeno",
    "majin_kid": "entity/races/majin",
    "majin_evil": "entity/races/majin",
    "majin_super": "entity/races/majin",
    "majin_ultra": "entity/races/majin",
    "janemba_fat": "entity/races/janemba_fat",
    "janemba_super": "entity/races/janemba_super",
    "namekian_buffed": "entity/races/hbuffed",
}
FORM_TYPE_TO_SKILL = {"superforms": "superforms", "legendaryforms": "legendaryforms", "godforms": "godforms",
                      "androidforms": "androidforms", "kaioken": "kaioken", "ultimate": "ultimate"}


def form_name(race, group, form):
    keys = ["race.dragonminez.%s.form.%s.%s" % (race, group, form),
            "race.dragonminez.stack.form.%s.%s" % (group, form)]
    if race == "any":
        keys += ["race.dragonminez.%s.form.%s.%s" % (r, group, form) for r in RACE_ORDER]
    for k in keys:
        v = lang(k)
        if v:
            if group == "kaioken":
                return "Kaioken " + v
            return v
    subst("form %s.%s (%s): no English name in lang -> title case" % (group, form, race))
    return title_case(form)


def group_name(race, group):
    for k in ("race.dragonminez.%s.group.%s" % (race, group), "race.dragonminez.stack.group.%s" % group):
        v = lang(k)
        if v:
            return v
    return title_case(group)


def convert_forms(races, skill_costs):
    forms = OrderedDict()
    key_rename = {}   # (race, "group.form") -> final key
    files = [(r, p) for r in RACE_ORDER for p in sorted(glob.glob(os.path.join(CONF, "races", r, "forms", "*.json")))]
    files += [("any", p) for p in sorted(glob.glob(os.path.join(CONF, "forms", "*.json")))]
    for race, path in files:
        d = jload(path)
        group = d["groupName"]
        ftype = d.get("formType", group)
        order = 0
        for fname, fm in d["forms"].items():
            key = "%s.%s" % (group, fname)
            if key in forms:
                key = "%s.%s_%s" % (group, fname, race)
                subst("form %s.%s collides between races -> key %s" % (group, fname, key))
            key_rename[(race, "%s.%s" % (group, fname))] = key
            f = OrderedDict()
            # DMZ fields first (they carry a lowercase internal "name" we must not keep as the label)
            for k, v in fm.items():
                if k == "name":
                    f["dmz_name"] = v
                else:
                    f[k] = v
            for k in ("id", "name", "race", "group", "group_name", "form_type", "skill", "order"):
                f.pop(k, None)
            head = OrderedDict()
            head["id"] = key
            head["name"] = form_name(race, group, fname)
            head["race"] = race
            head["group"] = group
            head["group_name"] = group_name(race, group)
            head["form_type"] = ftype
            head["skill"] = FORM_TYPE_TO_SKILL.get(ftype, ftype)
            head["order"] = order
            head.update(f)
            f = head
            # unlock cost
            lvl = int(fm.get("unlockOnSkillLevel", 1))
            cost = None
            if race != "any":
                costs = races[race].get("formSkillsCosts", {}).get(ftype, [])
                if 0 < lvl <= len(costs):
                    cost = costs[lvl - 1]
            else:
                costs = skill_costs.get(group, [])
                if 0 < lvl <= len(costs):
                    cost = costs[lvl - 1]
            if cost is None:
                cost = 10000 * lvl
            f["unlock_tp_cost"] = cost
            f["unlock_by"] = "quest" if cost < 0 else "tp"
            cm = fm.get("customModel", "")
            mo = ""
            if cm:
                mo = FORM_MODEL_MAP.get(cm, "entity/races/" + cm)
                if not exists_asset("models/%s.geo.json" % mo):
                    subst("form %s: customModel %s -> %s missing -> no override" % (key, cm, mo))
                    mo = ""
                elif mo != "entity/races/" + cm:
                    subst("form %s: customModel %s -> %s" % (key, cm, mo))
            f["model_override"] = mo
            forms[key] = f
            order += 1
    # fix internal references to renamed keys
    for key, f in forms.items():
        race = f["race"]
        for field in ("formRequisite",):
            v = f.get(field, "")
            if v:
                f[field] = key_rename.get((race, v), v)
        for field in ("incompatibleWith", "shareMasteryWith"):
            v = f.get(field, [])
            if isinstance(v, list):
                f[field] = [key_rename.get((race, x), x) for x in v if x]
    jsave("forms.json", {"forms": forms})
    COUNTS["forms"] = len(forms)
    return forms


# ================================================================ SKILLS
SKILL_EFFECT = {
    "fly": {"kind": "movement", "speed_per_level": 0.15, "base_speed": 12.0},
    "jump": {"kind": "movement", "jump_mult_per_level": 0.1},
    "sprint": {"kind": "movement", "speed_per_level": 0.1},
    "ki_protection": {"kind": "defense", "absorb_per_level": 0.05, "ki_per_damage": 1.0},
    "ki_infusion": {"kind": "offense", "melee_bonus_per_level": 0.05},
    "ki_sense": {"kind": "utility", "range_per_level": 16.0},
    "ki_control": {"kind": "core", "enables": ["ki_charge", "ki_blast", "fly", "techniques"]},
    "ki_manipulation": {"kind": "offense", "melee_from_ki_per_level": 0.1, "weapons": ["blade", "scythe", "clawlance"],
                        "weapon_names": {w: lang("skill.dragonminez.kiweapon." + w, title_case(w))
                                         for w in ("blade", "scythe", "clawlance")},
                        "weapon_models": ["weapons/kiweapon_blade", "weapons/kiweapon_scythe", "weapons/kiweapon_clawlance"]},
    "potential_unlock": {"kind": "stats", "release_per_level": 0.03},
    "defense_penetration": {"kind": "offense", "per_level": 0.02},
    "healing_reduction": {"kind": "offense", "per_level": 0.02, "duration": 5.0},
    "instant_transmission": {"kind": "movement", "range_per_level": 32.0, "ui_at_level": 5},
    "ki_boost": {"kind": "ki", "active_regen_per_level": 0.25},
    "kaioken": {"kind": "form_group", "group": "kaioken"},
    "ultimate": {"kind": "form_group", "group": "ultimate"},
    "ultra_instinct": {"kind": "buff", "auto_dodge_per_level": 0.1, "aura": "#C0D8FF"},
    "ultra_ego": {"kind": "buff", "damage_taken_to_power": 0.1, "aura": "#6A2BD9"},
    "meditation": {"kind": "ki", "passive_ki_regen_per_level": 0.1, "stamina_regen_per_level": 0.05},
    "superforms": {"kind": "form_group", "form_type": "superforms"},
    "godforms": {"kind": "form_group", "form_type": "godforms"},
    "legendaryforms": {"kind": "form_group", "form_type": "legendaryforms"},
    "androidforms": {"kind": "form_group", "form_type": "androidforms"},
    "fusion": {"kind": "fusion", "levels": ["dance", "potara", "ex", "namek", "majin"]},
    "aura_status": {"kind": "toggle", "aura": True},
    "friendly_fist": {"kind": "toggle", "no_ally_damage": True},
}
SKILL_UNLOCK = {
    "fly": "korin", "jump": "korin", "sprint": "korin", "ki_protection": "popo", "ki_infusion": "piccolo",
    "ki_sense": "dende", "ki_control": "roshi", "ki_manipulation": "trunks", "potential_unlock": "guru",
    "defense_penetration": "vegeta", "healing_reduction": "cell", "instant_transmission": "king_kai",
    "ki_boost": "goku", "kaioken": "king_kai", "ultimate": "old_kai", "ultra_instinct": "old_kai",
    "ultra_ego": "old_kai", "meditation": "dende", "superforms": "goku", "godforms": "old_kai",
    "legendaryforms": "old_kai", "fusion": "goku", "androidforms": "gero", "aura_status": "", "friendly_fist": "",
}
SKILL_UNLOCK_BY_RACE = {
    "superforms": {"saiyan": "goku", "human": "krillin", "namekian": "piccolo", "frostdemon": "frieza",
                   "majin": "babidi", "bioandroid": "cell"},
}


def geometric_costs(n, start=500, ratio=1.5):
    out = []
    v = start
    for _ in range(n):
        out.append(int(round(v / 50.0)) * 50)
        v *= ratio
    return out


def convert_skills():
    subst("skill unlock: DMZ master_whis / master_beerus have no model or texture in assets -> "
          "ultra_instinct / ultra_ego / godforms are taught by old_kai instead")
    cfg = jload(os.path.join(CONF, "skills.json"))
    costs_cfg = {k: v.get("costs", []) for k, v in cfg.get("skills", {}).items()}
    tech_dmz = set(cfg.get("kiSkills", [])) | set(cfg.get("strikeSkills", [])) | {
        "makkanko", "supernova_cooler", "deadly_dance_vegetto", "super_god_fist", "ki_barrage", "wolf_fang",
        "burning_attack", "dragon_fist", "big_bang", "spiritbomb", "final_flash", "kienzan_doble", "emperor_death_beam",
        "galick_gun", "meteor", "kienzan", "taiyoken", "final_explosion", "kaioken_attack", "kamehameha", "death_beam",
        "deadly_dance", "oozaru_fist", "fake_moon", "soul_punisher", "sokidan", "masenko", "supernova"}
    skills = OrderedDict()
    for key in LANG:
        if not key.startswith("skill.dragonminez.") or key.endswith(".desc"):
            continue
        dmz = key[len("skill.dragonminez."):]
        if dmz.startswith("kiweapon."):
            continue  # ki weapon names, part of ki_manipulation
        if dmz in tech_dmz:
            continue
        sid = map_skill(dmz)
        s = OrderedDict()
        s["id"] = sid
        s["dmz_id"] = dmz
        s["name"] = lang(key, title_case(sid))
        s["desc"] = lang(key + ".desc", "")
        racial = dmz.startswith("racial_")
        if racial:
            race = dmz[len("racial_"):]
            s["race"] = race
            s["passive"] = True
            s["max_level"] = 1
            s["tp_costs"] = [0]
            s["effect"] = {"kind": "racial_passive", "race": race}
            s["unlock"] = ""
        else:
            costs = costs_cfg.get(dmz)
            if costs is None:
                if dmz in ("aurastatus", "friendlyfist"):
                    costs = [0]
                elif dmz in ("ultrainstinct", "ultraego", "godforms"):
                    costs = [-1, -1, -1]
                elif dmz in ("superforms", "legendaryforms", "androidforms"):
                    costs = [-1] * 8
                else:
                    costs = geometric_costs(5)
                    subst("skill %s: no DMZ costs -> geometric %s" % (sid, costs))
            s["max_level"] = len(costs)
            s["tp_costs"] = costs
            s["effect"] = SKILL_EFFECT.get(sid, {"kind": "misc"})
            s["unlock"] = SKILL_UNLOCK.get(sid, "")
            if sid in SKILL_UNLOCK_BY_RACE:
                s["unlock_by_race"] = SKILL_UNLOCK_BY_RACE[sid]
            if sid in ("superforms", "legendaryforms", "godforms", "androidforms"):
                s["cost_from_race"] = True  # actual per-level costs live in races.json formSkillsCosts
        skills[sid] = s
    jsave("skills.json", {"skills": skills})
    COUNTS["skills"] = len(skills)
    return skills, costs_cfg


# ================================================================ TECHNIQUES
# id: (kind, charge, ki_cost, damage_mult, cast_anim, fire_anim, charge_sound, fire_sound, color, size, speed, duration, unlock, owner)
TECH_DEFS = OrderedDict([
    ("ki_blast", ("blast", 0.0, 0.05, 1.0, "", "ki.barrage_fire", "", "kiblast_shoot", "#7FD4FF", 0.4, 30.0, 3.0, "", "everyone")),
    ("charged_ki_blast", ("blast", 1.0, 0.15, 2.5, "ki.large_ball_cast", "ki.large_ball_fire", "ki_charge_loop", "kiblast_shoot", "#7FD4FF", 0.9, 24.0, 4.0, "roshi", "everyone")),
    ("kamehameha", ("beam", 2.0, 0.3, 5.0, "ki.kameha_cast", "ki.kameha_fire", "ki_kame_charge", "ki_kame_fire", "#4FC3FF", 1.2, 40.0, 3.0, "roshi", "goku")),
    ("galick_gun", ("beam", 2.0, 0.3, 5.0, "ki.galick_cast", "ki.galick_fire", "ki_beam_charge", "ki_beam_fire", "#C77DFF", 1.2, 40.0, 3.0, "vegeta", "vegeta")),
    ("masenko", ("beam", 1.5, 0.25, 4.0, "ki.masenko_cast", "ki.masenko_fire", "ki_beam_charge", "ki_beam_fire", "#FFE066", 1.0, 42.0, 2.5, "gohan", "gohan")),
    ("final_flash", ("beam", 3.0, 0.45, 8.0, "ki.finalflash_cast", "ki.finalflash_fire", "ki_finalflash_charge", "ki_finalflash_fire", "#FFF59D", 1.8, 45.0, 3.5, "vegeta", "vegeta")),
    ("special_beam_cannon", ("beam", 2.5, 0.3, 6.0, "ki.makkako_cast", "ki.makkako_fire", "ki_beam_charge", "laserbeam", "#FF9F1C", 0.5, 60.0, 2.0, "piccolo", "piccolo")),
    ("death_beam", ("beam", 0.6, 0.12, 3.0, "ki.makkako_cast", "ki.makkako_fire", "", "laserbeam", "#E040FB", 0.25, 80.0, 1.0, "frieza", "frieza")),
    ("emperor_death_beam", ("beam", 1.5, 0.3, 6.0, "ki.makkako_cast", "ki.makkako_fire", "ki_beam_charge", "laserbeam", "#D500F9", 0.6, 80.0, 2.0, "frieza", "frieza")),
    ("big_bang", ("blast", 1.5, 0.3, 5.0, "ki.bigbang_cast", "ki.bigbang_fire", "ki_beam_charge", "ki_explosion_impact", "#9BE7FF", 1.6, 22.0, 5.0, "vegeta", "vegeta")),
    ("burning_attack", ("blast", 1.2, 0.25, 4.0, "ki.bigbang_cast", "ki.bigbang_fire", "ki_burning_charge", "ki_burning_fire", "#FFB74D", 1.2, 26.0, 4.0, "trunks", "trunks")),
    ("sokidan", ("blast", 1.0, 0.2, 3.5, "ki.large_ball_cast", "ki.large_ball_fire", "ki_charge_loop", "kiblast_shoot", "#FFEB3B", 0.9, 20.0, 6.0, "yamcha", "yamcha")),
    ("spirit_bomb", ("blast", 5.0, 0.6, 12.0, "ki.large_ball_cast", "ki.large_ball_fire", "ki_spiritbomb_charge", "ki_spiritbomb_fire", "#BBDEFB", 4.0, 10.0, 8.0, "king_kai", "goku")),
    ("supernova", ("blast", 4.0, 0.55, 10.0, "ki.large_ball_cast", "ki.large_ball_fire", "ki_supernova_charge", "ki_supernova_fire", "#FF8A00", 4.0, 9.0, 8.0, "frieza", "frieza")),
    ("supernova_cooler", ("blast", 4.0, 0.55, 10.5, "ki.large_ball_cast", "ki.large_ball_fire", "ki_supernova_charge", "ki_supernova_fire", "#FFC400", 4.2, 9.0, 8.0, "frieza", "cooler")),
    ("kienzan", ("disc", 1.2, 0.2, 4.0, "ki.kienzan_cast", "ki.kienzan_fire", "ki_disk_charge", "ki_disk_fire", "#FFD24D", 1.4, 28.0, 4.0, "krillin", "krillin")),
    ("kienzan_doble", ("disc", 1.8, 0.3, 4.0, "ki.kienzandoble_cast", "ki.kienzandoble_fire", "ki_disk_charge", "ki_disk_fire", "#FFD24D", 1.4, 28.0, 4.0, "krillin", "krillin")),
    ("ki_barrage", ("barrage", 0.5, 0.2, 0.8, "ki.barrage_cast", "ki.barrage_fire", "ki_charge_loop", "kiblast_shoot", "#7FD4FF", 0.4, 32.0, 2.5, "roshi", "everyone")),
    ("final_explosion", ("explosion", 3.0, 0.6, 12.0, "ki.explosion_cast", "ki.explosion_fire", "ki_explosion_charge", "ki_explosion_impact", "#FFF176", 8.0, 0.0, 1.5, "vegeta", "vegeta")),
    ("soul_punisher", ("explosion", 2.5, 0.5, 9.0, "ki.explosion_cast", "ki.explosion_fire", "ki_explosion_charge", "ki_explosion_impact", "#B9F6CA", 6.0, 0.0, 1.5, "goku", "gogeta")),
    ("solar_flare", ("buff", 0.3, 0.1, 0.0, "", "ki.solarflare_fire", "", "ki_sparks", "#FFFFFF", 6.0, 0.0, 4.0, "krillin", "tien")),
    ("fake_moon", ("buff", 1.0, 0.2, 0.0, "ki.large_ball_cast", "ki.large_ball_fire", "ki_charge_loop", "kiblast_shoot", "#FFF8E1", 2.0, 15.0, 60.0, "vegeta", "vegeta")),
    ("meteor", ("melee", 0.0, 0.1, 2.5, "", "skp.meteor", "", "critico1", "#FFAB40", 1.0, 0.0, 1.2, "goku", "goku")),
    ("dragon_fist", ("melee", 0.4, 0.25, 6.0, "", "skp.dragon_fist", "ki_charge_loop", "dragon_fist", "#FFD740", 1.5, 0.0, 1.5, "goku", "goku")),
    ("kaioken_attack", ("melee", 0.3, 0.2, 4.0, "", "skp.kaioken_attack", "aura_start", "critico2", "#FF1744", 1.0, 0.0, 1.5, "king_kai", "goku")),
    ("super_god_fist", ("melee", 0.3, 0.2, 5.0, "", "skp.super_god_fist", "ki_charge_loop", "critico1", "#FF5252", 1.2, 0.0, 1.2, "goku", "goku")),
    ("wolf_fang", ("melee", 0.0, 0.1, 2.0, "", "skp.wolf_fang", "", "golpe3", "#90CAF9", 1.0, 0.0, 1.5, "yamcha", "yamcha")),
    ("deadly_dance", ("melee", 0.2, 0.15, 3.0, "", "skp.deadly_dance", "", "golpe5", "#FFEE58", 1.0, 0.0, 1.8, "old_kai", "vegito")),
    ("deadly_dance_vegetto", ("melee", 0.2, 0.2, 4.5, "", "skp.deadly_dance_vegetto", "", "golpe6", "#FFEE58", 1.0, 0.0, 1.8, "old_kai", "vegito")),
    ("oozaru_fist", ("melee", 0.5, 0.25, 6.0, "", "skp.oozaru_fist", "oozaru_growl_player", "oozaru_fist", "#8D6E63", 2.0, 0.0, 1.5, "vegeta", "saiyan")),
])
TECH_IDS = set(TECH_DEFS.keys())
TECH_TYPE_LANG = {"blast": "technique.type.medium_ball", "beam": "technique.type.beam", "disc": "technique.type.disk",
                  "barrage": "technique.type.barrage", "explosion": "technique.type.explosion", "buff": "technique.type.area",
                  "melee": "technique.type.strike"}


def convert_techniques(skill_costs):
    # every technique.dragonminez.* must be represented
    lang_ids = []
    for key in LANG:
        if key.startswith("technique.dragonminez."):
            lang_ids.append(key[len("technique.dragonminez."):])
    reverse = {}
    for dmz in lang_ids:
        tid = TECH_ID_MAP.get(dmz, dmz)
        if tid not in TECH_DEFS:
            UNPORTED.append("technique lang id %s (-> %s) has no definition" % (dmz, tid))
            continue
        reverse.setdefault(tid, dmz)
    techs = OrderedDict()
    for tid, d in TECH_DEFS.items():
        kind, charge, ki_cost, dmg, cast, fire, cs, fs, color, size, speed, duration, unlock, owner = d
        t = OrderedDict()
        t["id"] = tid
        t["dmz_id"] = reverse.get(tid, tid)
        t["name"] = lang("technique.dragonminez." + reverse.get(tid, tid), title_case(tid))
        t["kind"] = kind
        t["kind_name"] = lang(TECH_TYPE_LANG.get(kind, ""), kind.capitalize())
        t["charge"] = charge
        t["ki_cost"] = ki_cost
        t["damage_mult"] = dmg
        t["cast_anim"] = cast
        t["fire_anim"] = fire
        for a in (cast, fire):
            if a and not any(a in ANIM_NAMES.get(f, set()) for f in ANIM_NAMES):
                subst("technique %s: animation %s not found in races animations" % (tid, a))
        for snd_key, snd in (("charge_sound", cs), ("fire_sound", fs)):
            if snd and not sfx_exists(snd):
                subst("technique %s: sound %s missing -> ''" % (tid, snd))
                snd = ""
            t[snd_key] = snd
        t["color"] = color
        t["size"] = size
        t["speed"] = speed
        t["duration"] = duration
        t["unlock"] = unlock
        t["owner_hint"] = owner
        costs = skill_costs.get(reverse.get(tid, tid))
        t["tp_cost"] = costs[0] if costs else (0 if tid == "ki_blast" else 1000)
        t["cooldown"] = round(max(1.0, charge * 2.0 + dmg * 0.6), 1)
        techs[tid] = t
    jsave("techniques.json", {"techniques": techs})
    COUNTS["techniques"] = len(techs)
    return techs


ANIM_NAMES = {}
for _f in ("entity/races/movement", "entity/races/combat", "entity/races/ki", "entity/races/transf", "entity/races/skp"):
    try:
        ANIM_NAMES[_f] = set(jload(os.path.join(ASSETS, "animations", _f + ".animation.json"))["animations"].keys())
    except Exception:
        ANIM_NAMES[_f] = set()

SFX_FILES = set()
for _f in os.listdir(os.path.join(ASSETS, "audio", "sfx")):
    if _f.endswith(".ogg") or _f.endswith(".wav"):
        SFX_FILES.add(os.path.splitext(_f)[0])
BGM_FILES = set()
for _f in os.listdir(os.path.join(ASSETS, "audio", "bgm")):
    if _f.endswith(".ogg") or _f.endswith(".wav"):
        BGM_FILES.add(os.path.splitext(_f)[0])


def sfx_exists(name):
    return name in SFX_FILES


# ================================================================ MASTERS
# our master id -> the npc key used by dialogue.dragonminez.story.sidequest.<npc>.*
DIALOG_KEY = {"king_kai": "kingkai", "guru": "namek_elder", "korin": "", "dende": "", "yemma": "",
              "old_kai": "", "gero": "", "babidi": "", "cell": "", "frieza": "", "baba": "", "toribot": "",
              "shin": ""}


def dlg(npc, *extra):
    key = DIALOG_KEY.get(npc, npc)
    out = []
    if key:
        for k in ("offer", "idle", "in_progress", "complete"):
            v = lang("dialogue.dragonminez.story.sidequest.%s.%s" % (key, k))
            if v:
                out.append(v)
        if not out:
            subst("master %s: no DMZ dialogue lines (dialogue.*.%s.*) -> hand written only" % (npc, key))
    out.extend(extra)
    return out[:6]


MASTER_TABLE = OrderedDict([
    ("roshi", {"entity": "master_roshi", "structure": "roshi_house", "planet": "earth",
               "teaches": ["ki_control", "kamehameha", "ki_barrage", "charged_ki_blast"], "trains": True,
               "taunt": "Hohoho! The Turtle Hermit still has a few tricks, youngster.",
               "dialog": dlg("roshi", "Now where did I put that magazine... never mind, let's train!")}),
    ("korin", {"entity": "master_karin", "structure": "korin_tower", "planet": "earth",
               "teaches": ["jump", "sprint", "fly"], "trains": True,
               "taunt": "You climbed all the way up here? Impressive. Now try catching this bottle.",
               "dialog": ["So you made it to the top of my tower. Most give up halfway.",
                          "The sacred water is just ordinary water. The climb is what made you stronger.",
                          "Try to take this bottle from me. Go on, I'll wait.",
                          "Senzu beans take time to grow. Don't eat them like candy.",
                          "Yajirobe ate the last of the stew again. Some things never change."]}),
    ("dende", {"entity": "master_dende", "structure": "kami_lookout", "planet": "earth",
               "teaches": ["ki_sense", "meditation"], "trains": True,
               "taunt": "As Guardian of Earth I can sense your ki from here. Focus it.",
               "dialog": ["Welcome to the Lookout. I am Dende, Guardian of Earth.",
                          "Close your eyes. Feel the ki of every living thing on this planet.",
                          "Mr. Popo keeps the Lookout spotless. Please don't track in mud.",
                          "If you are wounded, come to me. Healing is what I do best.",
                          "The Dragon Balls answer to a pure heart. Use them wisely."]}),
    ("popo", {"entity": "master_popo", "structure": "kami_lookout", "planet": "earth",
              "teaches": ["meditation", "ki_protection"], "trains": True,
              "taunt": "You are too slow. Mr. Popo will show you what speed means.",
              "dialog": dlg("popo", "The Hyperbolic Time Chamber is behind that door. One year inside is one day outside.")}),
    ("goku", {"entity": "master_goku", "structure": "goku_house", "planet": "earth",
              "teaches": ["ki_boost", "kamehameha", "dragon_fist", "meteor", "super_god_fist", "fusion", "superforms", "soul_punisher"],
              "trains": True, "taunt": "Alright! Let's see what you've got! Come at me with everything!",
              "dialog": dlg("goku", "Chi-Chi says I have to study, but I'd rather spar. Don't tell her I said that.")}),
    ("gohan", {"entity": "master_gohan", "structure": "goku_house", "planet": "earth",
               "teaches": ["masenko", "ki_protection"], "trains": True,
               "taunt": "I'd rather talk than fight, but I won't go easy on you.",
               "dialog": dlg("gohan", "Piccolo taught me that pain is just a lesson you haven't learned yet.")}),
    ("krillin", {"entity": "master_krillin", "structure": "roshi_house", "planet": "earth",
                 "teaches": ["kienzan", "kienzan_doble", "solar_flare", "superforms"], "trains": True,
                 "taunt": "Don't let the height fool you. I've fought people who blew up planets.",
                 "dialog": dlg("krillin", "Destructo Disc is not a toy. Seriously, watch where you throw it.")}),
    ("yamcha", {"entity": "master_yamcha", "structure": "yamcha_house", "planet": "earth",
                "teaches": ["sokidan", "wolf_fang"], "trains": True,
                "taunt": "The Wolf Fang Fist is the pride of the desert. Watch closely!",
                "dialog": dlg("yamcha", "Puar, get the first aid kit. Just in case. For them, not me.")}),
    ("piccolo", {"entity": "master_piccolo", "structure": "piccolo_house", "planet": "earth",
                 "teaches": ["special_beam_cannon", "fly", "ki_infusion", "superforms"], "trains": True,
                 "taunt": "Don't waste my time. Show me you can survive six months in the wilderness.",
                 "dialog": dlg("piccolo", "Meditation under the waterfall. Every morning. No excuses.")}),
    ("vegeta", {"entity": "master_vegeta", "structure": "capsule_corp", "planet": "earth",
                "teaches": ["galick_gun", "big_bang", "final_flash", "final_explosion", "defense_penetration", "oozaru_fist", "fake_moon"],
                "trains": True, "taunt": "You want training from the Prince of all Saiyans? Then don't disappoint me.",
                "dialog": dlg("vegeta", "The gravity chamber is set to 300 G. If you survive, we talk.")}),
    ("trunks", {"entity": "master_trunks", "structure": "capsule_corp", "planet": "earth",
                "teaches": ["burning_attack", "ki_manipulation"], "trains": True,
                "taunt": "I've fought androids that leveled cities. Let's see how you measure up.",
                "dialog": dlg("trunks", "This sword has cut through more than steel. Learn to respect a blade.")}),
    ("bulma", {"entity": "saga_bulma", "structure": "capsule_corp", "planet": "earth",
               "teaches": [], "trains": False,
               "taunt": "Oh, hi! Need something from Capsule Corp? I'm a little busy.",
               "dialog": dlg("bulma", "Bring me the parts and I'll build you something amazing. Probably.")}),
    ("king_kai", {"entity": "master_kaiosama", "structure": "king_kai_planet", "planet": "otherworld",
                  "teaches": ["kaioken", "instant_transmission", "spirit_bomb", "kaioken_attack"], "trains": True,
                  "taunt": "Catch Bubbles first! Ten times the gravity, kid, and no complaining!",
                  "dialog": dlg("king_kai", "Why did the Saiyan cross Snake Way? To get to the OTHER world! Ha ha ha!")}),
    ("yemma", {"entity": "master_enma", "structure": "check_in_station", "planet": "otherworld",
               "teaches": [], "trains": False,
               "taunt": "NEXT! State your name and how you died. I don't have all eternity.",
               "dialog": ["Welcome to the Check-In Station. I am King Yemma. Do not touch the desk.",
                          "Your record says you have caused a great deal of property damage.",
                          "Snake Way is that direction. It is very long. Don't fall off.",
                          "If you want to see King Kai, you'll have to run. All 625 miles of it.",
                          "Hell is downstairs. Heaven is upstairs. Choose your behavior accordingly."]}),
    ("guru", {"entity": "master_guru", "structure": "elder_guru", "planet": "namek",
              "teaches": ["potential_unlock"], "trains": False,
              "taunt": "Come closer, child. Let me place my hand upon your head.",
              "dialog": ["I am the Grand Elder of Namek. The Dragon Balls came from me.",
                         "Your heart is pure. Let me draw out the power that sleeps within you.",
                         "Nail guards this house. He is the strongest warrior our world has raised.",
                         "Frieza's soldiers hunt my children. Protect them, and Namek will remember you.",
                         "I am very old, and very tired. Do not waste what I give you."]}),
    ("old_kai", {"entity": "master_oldkai", "structure": "old_kai_pillar", "planet": "sacred_kai_planet",
                 "teaches": ["ultimate", "ultra_instinct", "ultra_ego", "godforms", "legendaryforms", "deadly_dance", "deadly_dance_vegetto"],
                 "trains": False, "taunt": "Sit down and don't move. This ritual takes twenty-five hours. Yes, hours.",
                 "dialog": ["I was sealed in the Z Sword for a very long time. I am owed some respect.",
                            "The ritual will unleash your hidden power. Sit still and stop asking if it's done.",
                            "Bring me pictures of a pretty girl and we will discuss your potential.",
                            "Fifteen generations before Shin. Fifteen! And he never listens.",
                            "The Potara earrings are not toys. Put one on each ear and the fusion is permanent."]}),
    ("gero", {"entity": "master_gero", "structure": "gero_lab", "planet": "earth",
              "teaches": ["androidforms", "healing_reduction"], "trains": False,
              "taunt": "Come to be upgraded? Excellent. The procedure is only mildly painful.",
              "dialog": ["The Red Ribbon Army lives on in my research. Goku will pay for what he did.",
                         "My androids are perfect. Well, 16 is a little sentimental. A flaw I will correct.",
                         "Your body is a poor design. Let me replace the weakest parts.",
                         "The energy absorption model is quite elegant. Would you like a demonstration?",
                         "Cell is my masterpiece. Do not go into the basement."]}),
    ("babidi", {"entity": "master_babidi", "structure": "babidi_ship", "planet": "earth",
                "teaches": ["superforms"], "trains": False,
                "taunt": "Paparapapa! Give in to the darkness in your heart and I will make you strong!",
                "dialog": ["My father Bibidi created Majin Buu. I intend to finish what he started.",
                           "Your heart holds a sliver of evil. That is all my magic needs.",
                           "Dabura, get the door. We have a guest. A weak, pathetic guest.",
                           "Each floor of my ship is guarded. Beat them and I may reward you.",
                           "The seal on Buu weakens with every fight. Keep fighting, little pawn."]}),
    ("cell", {"entity": "master_cell", "structure": "cell_arena", "planet": "earth",
              "teaches": ["solar_flare", "kamehameha", "superforms", "healing_reduction"], "trains": True,
              "taunt": "Welcome to the Cell Games. Try not to die before the fun begins.",
              "dialog": ["I contain the cells of the greatest warriors alive. I can teach any of their techniques.",
                         "The ring is exactly as I designed it. Step out and you lose.",
                         "Perfection cannot be rushed. But it can be trained.",
                         "The Kamehameha, the Special Beam Cannon, the Solar Flare... I know them all.",
                         "Do try to entertain me. The last challenger was dreadfully boring."]}),
    ("frieza", {"entity": "master_frieza", "structure": "frieza_ship", "planet": "namek",
                "teaches": ["death_beam", "emperor_death_beam", "supernova", "supernova_cooler", "superforms"], "trains": True,
                "taunt": "Oh my. Another monkey wants to learn from the emperor of the universe? How quaint.",
                "dialog": ["I am Lord Frieza, emperor of Universe 7. Kneel, and you may learn something.",
                           "The Death Beam requires precision. Aim for the heart. It's the quickest way.",
                           "My family has ruled the galaxy for generations. Discipline is everything.",
                           "Zarbon, Dodoria, be dears and fetch our guest a scouter.",
                           "Every transformation hides another. Never show your final form first."]}),
    ("baba", {"entity": "master_uranai", "structure": "roshi_house", "planet": "earth",
              "teaches": ["ki_sense"], "trains": False,
              "taunt": "Fortuneteller Baba sees your future. It's expensive.",
              "dialog": ["I am Fortuneteller Baba, Roshi's sister. I can see anything for the right price.",
                         "Beat my five fighters and I'll tell you where your Dragon Ball is.",
                         "The dead can visit for one day. I have connections in the Otherworld.",
                         "My crystal ball shows a great battle in your future. It usually does.",
                         "Don't touch the ball. Everyone touches the ball."]}),
    ("toribot", {"entity": "master_toribot", "structure": "capsule_corp", "planet": "earth",
                 "teaches": ["aura_status", "friendly_fist"], "trains": False,
                 "taunt": "Beep. I am Toribot. I draw the world, and sometimes I break it.",
                 "dialog": ["Beep boop. I am the author's robot. Please do not look behind the curtain.",
                            "Did you know Goku's original name was going to be different? Beep.",
                            "I can toggle your aura display. Very useful for screenshots.",
                            "Friendly Fist lets you spar with allies without hurting them. Beep."]}),
    ("shin", {"entity": "saga_shin", "structure": "old_kai_pillar", "planet": "sacred_kai_planet",
              "teaches": [], "trains": False,
              "taunt": "As the Supreme Kai, I must test your strength. Please, do not hold back.",
              "dialog": ["I am Shin, the Supreme Kai. Babidi must be stopped before he revives Majin Buu.",
                         "The Z Sword rests on this world. Only the worthy can pull it free.",
                         "Kibito will heal you. Please try not to need it too often.",
                         "The Elder Kai is... eccentric. But his ritual works. Usually.",
                         "Use the Sacred World for training. Time here is precious."]}),
])


def convert_masters(entities, skills, techs):
    masters = OrderedDict()
    for key, m in MASTER_TABLE.items():
        out = OrderedDict()
        out["id"] = key
        out["entity"] = m["entity"]
        out["name"] = entities.get(m["entity"], {}).get("name", title_case(m["entity"]))
        out["structure"] = m["structure"]
        out["planet"] = m["planet"]
        teaches = []
        for t in m["teaches"]:
            if t in skills or t in techs:
                teaches.append(t)
            else:
                subst("master %s: teaches unknown %s -> dropped" % (key, t))
        out["teaches"] = teaches
        out["teaches_skills"] = [t for t in teaches if t in skills]
        out["teaches_techniques"] = [t for t in teaches if t in techs]
        out["trains"] = m["trains"]
        out["quests"] = sorted(set(quest_giver_map.get(key, [])) | set(quest_turnin_map.get(key, [])))
        out["gives_quests"] = sorted(quest_giver_map.get(key, []))
        out["turn_in_quests"] = sorted(quest_turnin_map.get(key, []))
        out["dialog"] = m["dialog"][:6]
        if m["entity"] not in entities:
            UNPORTED.append("master %s: entity %s missing" % (key, m["entity"]))
        masters[key] = out
    jsave("masters.json", {"masters": masters})
    COUNTS["masters"] = len(masters)
    return masters


# ================================================================ WISHES
DRAGON_SOURCES = [
    ("shenron", os.path.join(DMZ_DATA, "dragonballs", "earth", "definitions")),
    ("porunga", os.path.join(DMZ_DATA, "dragonballs", "namek", "definitions")),
    ("super_shenron", os.path.join(DMZP, "dragonballs", "super", "definitions")),
    ("toronbo", os.path.join(DMZP, "dragonballs", "cereal", "definitions")),
]
DRAGON_DEFS = {}
for _d, _p in DRAGON_SOURCES:
    try:
        DRAGON_DEFS[_d] = jload(os.path.join(_p, "dragon.json"))
    except Exception:
        DRAGON_DEFS[_d] = {}

WISH_TYPE = {"item": "item", "tps": "tps", "passivereset": "reset", "recustomize": "recustomize",
             "relocatestats": "reset", "item_list_wish": "item", "form": "form", "revive": "revive", "planet": "planet"}
DRAGON_META = {
    "shenron": ("shenron", "earth", ["earth"]),
    "porunga": ("porunga", "namek", ["namek"]),
    "super_shenron": ("super_shenron", "super", ["universe_7_deep_space"]),
    "toronbo": ("toronbo", "cereal", ["cereal"]),
}


def convert_wishes():
    sources = DRAGON_SOURCES
    wishes = OrderedDict()
    for dragon, d in sources:
        try:
            wdef = jload(os.path.join(d, "wishes.json"))
        except Exception:
            UNPORTED.append("wishes for %s missing" % dragon)
            continue
        try:
            ddef = jload(os.path.join(d, "dragon.json"))
        except Exception:
            ddef = {}
        entity, ball_set, planets = DRAGON_META[dragon]
        out = OrderedDict()
        out["id"] = dragon
        out["name"] = entity_name(dragon) if dragon != "super_shenron" else "Super Shenron"
        out["entity"] = ddef.get("entity_registry_name", entity)
        out["ball_set"] = ddef.get("ball_set", ball_set)
        out["wish_count"] = ddef.get("wish_count", 1)
        out["summon_planets"] = [map_planet(x) for x in ddef.get("dimensions", [])] or planets
        out["entity_height"] = ddef.get("entity_height", 17.0)
        out["entity_width"] = ddef.get("entity_width", 3.0)
        lst = []
        for w in wdef.get("wishes", []):
            e = OrderedDict()
            nk = w.get("name", "")
            e["id"] = nk.split(".")[-2] if nk.count(".") >= 2 else nk
            e["name"] = lang(nk, title_case(e["id"]))
            e["desc"] = lang(w.get("description", ""), "")
            e["type"] = WISH_TYPE.get(w.get("type"), w.get("type"))
            e["dmz_type"] = w.get("type")
            if w.get("type") == "item":
                e["items"] = [{"item": map_item(w["itemId"]), "count": w.get("count", 1)}]
            elif w.get("type") == "item_list_wish":
                e["items"] = [{"item": map_item(i["itemId"]), "count": i.get("count", 1)} for i in w.get("items", [])]
            elif w.get("type") == "tps":
                e["amount"] = w.get("amount", 0)
            elif w.get("type") == "passivereset":
                e["reset"] = "racial_passive"
            elif w.get("type") == "relocatestats":
                e["reset"] = "stats"
            lst.append(e)
        out["wishes"] = lst
        wishes[dragon] = out
    jsave("wishes.json", {"wishes": wishes})
    COUNTS["wishes (dragons)"] = len(wishes)
    COUNTS["wishes (entries)"] = sum(len(w["wishes"]) for w in wishes.values())
    return wishes


# ================================================================ AUDIO
SFX_LOGICAL = OrderedDict([
    ("punch", ["golpe1", "golpe2", "golpe3", "golpe4", "golpe5", "golpe6"]),
    ("punch_crit", ["critico1", "critico2"]),
    ("block", ["block1", "block2", "block3"]),
    ("unblock", ["unblock"]),
    ("parry", ["parry"]),
    ("evasion", ["evasion1", "evasion2"]),
    ("ki_blast", ["kiblast_shoot"]),
    ("ki_charge_loop", ["ki_charge_loop"]),
    ("ki_charge_start", ["ki_charge_start"]),
    ("turbo_loop", ["turbo_loop"]),
    ("ki_sparks", ["ki_sparks"]),
    ("laserbeam", ["laserbeam"]),
    ("transform_on", ["transform_on"]),
    ("transform_off", ["transform_off"]),
    ("aura_start", ["aura_start"]),
    ("aura_loop", ["aura_loop"]),
    ("insta_form_on", ["insta_form_on"]),
    ("insta_form_off", ["insta_form_off"]),
    ("stack_form", ["stack_form"]),
    ("no_ki_form", ["no_ki_form"]),
    ("senzu", ["senzu"]),
    ("shenron", ["shenron"]),
    ("dragonballssound", ["dragonballssound"]),
    ("dragonradar", ["dragonradar"]),
    ("tp", ["tp"]),
    ("tp_short", ["tp_short"]),
    ("zanzoken", ["zanzoken"]),
    ("fusion", ["fusion"]),
    ("absorb", ["absorb1", "absorb2"]),
    ("majin_absorb", ["majin_absorb"]),
    ("ship_open", ["ship_open"]),
    ("ship_landing_open", ["ship_landing_open"]),
    ("landing_ship", ["landing_ship"]),
    ("ship_takeoff", ["ui_nave_takeoff"]),
    ("ship_cooldown", ["ui_nave_cooldown"]),
    ("nube", ["nube"]),
    ("lockon", ["lockon"]),
    ("knockback_character", ["knockback_character"]),
    ("ui_menu_switch", ["ui_menu_switch"]),
    ("confirm_menu", ["confirm_menu"]),
    ("pip_menu", ["pip_menu"]),
    ("toast_tutorial", ["toast_tutorial"]),
    ("switch_on", ["switch_on"]),
    ("switch_off", ["switch_off"]),
    ("sword_in", ["sword_in"]),
    ("sword_out", ["sword_out"]),
    ("sword_slash", ["sword_slash", "katana_slash"]),
    ("oozaru_heartbeat", ["oozaru_heartbeat"]),
    ("oozaru_growl", ["oozaru_growl_player", "vegeta_oozaru_growl"]),
    ("frog", ["frogsound1", "frogsound2", "frogsound3"]),
    ("froglaugh", ["froglaugh"]),
    ("loot_drop", ["loot_drop_01", "loot_drop_02", "loot_drop_03"]),
    ("click", ["click"]), ("pop", ["pop"]), ("eat", ["eat"]), ("hurt", ["hurt"]), ("fall_damage", ["fall_damage"]),
    ("splash", ["splash"]), ("swim", ["swim"]), ("bubbles", ["bubbles"]), ("level_up", ["level_up"]),
    ("quest_start", ["quest_start"]), ("quest_complete", ["quest_complete"]), ("skill_learned", ["skill_learned"]),
    ("dball_pickup", ["dball_pickup"]), ("item_pickup", ["item_pickup"]), ("wish_granted", ["wish_granted"]),
    ("toast", ["toast"]), ("error", ["error"]), ("thunder", ["thunder"]), ("explosion_big", ["explosion_big"]),
    ("shockwave", ["shockwave"]), ("whoosh", ["whoosh"]), ("dash", ["dash"]), ("land", ["land"]),
    ("lightning_crack", ["lightning_crack"]), ("power_up_burst", ["power_up_burst"]), ("block_guard", ["block_guard"]),
    ("heal", ["heal"]), ("teleport", ["teleport"]), ("scouter_beep", ["scouter_beep"]), ("capsule_pop", ["capsule_pop"]),
    ("ship_engine", ["ship_engine"]), ("fly_loop", ["fly_loop"]),
])
MATERIALS = ["stone", "earth", "sand", "wood", "plant", "leaves", "glass", "metal", "cloth", "liquid", "snow", "ice", "cloud", "special"]
WEAPON_SFX = ["anchor_slam", "axe_slash", "claymore_slam", "claymore_stab", "claymore_swing", "dagger_slash",
              "double_axe_swing", "fist_punch", "glaive_slash_quick", "glaive_slash_slow", "hammer_slam", "katana_slash",
              "mace_slam", "mace_slash", "pickaxe_swing", "rapier_slash", "rapier_stab", "scythe_slash", "sickle_slash",
              "spear_stab", "staff_slam", "staff_slash", "staff_spin", "staff_stab", "wand_swing"]

# OST classification by track number (from item.dragonminez.music_disc_menu_music_N titles)
BGM_TAGS = {
    1: ["calm", "earth"], 2: ["calm", "earth"], 3: ["calm", "earth"], 4: ["calm", "earth"], 5: ["calm", "earth", "space"],
    6: ["calm", "earth", "training"], 7: ["calm", "earth"], 8: ["calm", "earth", "training"], 9: ["calm", "earth", "training"],
    10: ["battle"], 11: ["battle"], 12: ["battle", "menu"], 13: ["calm", "earth"], 14: ["calm", "earth", "menu"],
    15: ["calm", "training", "time_chamber"], 16: ["namek", "tense"], 17: ["battle", "menu"], 18: ["boss"],
    19: ["calm", "earth"], 20: ["transformation", "boss"], 21: ["calm", "sad", "namek"], 22: ["otherworld", "heaven", "space"],
    23: ["battle"], 24: ["boss"], 25: ["battle"], 26: ["calm", "earth", "menu"], 27: ["calm", "earth"], 28: ["calm", "heaven"],
    29: ["boss", "battle"], 30: ["calm", "earth", "space"], 31: ["transformation", "boss"], 32: ["boss"], 33: ["transformation", "sad"],
    34: ["menu", "space"], 35: ["calm", "time_chamber"], 36: ["sad", "hell", "namek"], 37: ["battle"], 38: ["calm", "otherworld", "time_chamber"],
    39: ["calm", "heaven", "menu"],
}
BATTLE_WORDS = ("strongest", "danger", "survivor", "super saiyajin", "new hero", "cha-la", "prologue", "victory",
                "finish this game", "miracle", "in action", "sacrifice", "dragon ball z ost - dragon ball z")


try:
    DMZ_SOUNDS = jload(os.path.join(DMZ_ASSETS, "sounds.json"))
except Exception:
    DMZ_SOUNDS = {}


def track_file(n):
    """The ogg basename DMZ plays for music disc N (sounds.json is authoritative)."""
    entry = DMZ_SOUNDS.get("menu_music_%d" % n, {})
    for snd in entry.get("sounds", []):
        name = snd.get("name", "") if isinstance(snd, dict) else str(snd)
        if ":" in name:
            return name.split(":", 1)[1]
    return "menu_music-%d" % n


def convert_audio():
    sfx = OrderedDict()
    for k, files in SFX_LOGICAL.items():
        ok = [f for f in files if sfx_exists(f)]
        for f in files:
            if f not in ok:
                subst("audio sfx %s: file %s missing" % (k, f))
        sfx[k] = ok
    # ki_* pairs
    for f in sorted(SFX_FILES):
        if f.startswith("ki_") and f not in ("ki_charge_loop", "ki_charge_start", "ki_sparks"):
            sfx[f] = [f]
    for f in WEAPON_SFX:
        if sfx_exists(f):
            sfx[f] = [f]
    for s in ("frieza_s_hurt", "frieza_s_death", "frieza_s_attack", "frieza_s_ambient", "namek_vill_hurt", "namek_vill_death",
              "namek_vill_ambient", "vegeta_oozaru_growl", "vegeta_oozaru_death", "oozaru_growl_player", "dragon_fist",
              "oozaru_fist", "frogsound1", "frogsound2", "frogsound3", "golpe1", "golpe2", "golpe3", "golpe4", "golpe5", "golpe6",
              "critico1", "critico2", "block1", "block2", "block3", "kiblast_shoot", "ui_nave_takeoff", "ui_nave_cooldown"):
        if sfx_exists(s):
            sfx[s] = [s]
    for m in MATERIALS:
        for kind in ("break", "place", "dig"):
            name = "%s_%s" % (kind, m)
            if sfx_exists(name):
                sfx[name] = [name]
            elif kind == "dig":
                fallback = "dig_stone" if sfx_exists("dig_stone") else ""
                if fallback:
                    sfx[name] = [fallback]
                    subst("audio sfx %s missing -> %s" % (name, fallback))
        steps = [f for f in ("step_%s_%d" % (m, i) for i in range(3)) if sfx_exists(f)]
        if steps:
            sfx["step_" + m] = steps
        else:
            subst("audio sfx step_%s missing" % m)
    amb = [f for f in sorted(SFX_FILES) if f.startswith("ambience_")]
    for a in amb:
        sfx[a] = [a]
    # music
    titles = {}
    for n in range(1, 40):
        t = lang("item.dragonminez.music_disc_menu_music_%d.desc" % n)
        if t:
            titles[n] = t
    tracks = OrderedDict()
    for n in range(1, 40):
        f = track_file(n)
        if f in BGM_FILES:
            tags = list(BGM_TAGS.get(n, []))
            title = titles.get(n, f)
            low = title.lower()
            if any(w in low for w in BATTLE_WORDS) and "battle" not in tags and "boss" not in tags and "transformation" not in tags:
                tags.append("battle")
            if not tags:
                tags = ["calm", "earth"]
            tracks[f] = {"title": title, "tags": tags}
        else:
            subst("bgm track %s (%s) missing" % (f, titles.get(n, "?")))

    def pick(*tags, gen=None):
        out = []
        if gen and gen in BGM_FILES:
            out.append(gen)
        for f, info in tracks.items():
            if any(t in info["tags"] for t in tags) and f not in out:
                out.append(f)
        return out

    bgm = OrderedDict()
    bgm["menu"] = pick("menu")
    bgm["explore_earth"] = pick("earth")
    bgm["explore"] = pick("earth")
    bgm["explore_namek"] = pick("namek", gen="bgm_namek")
    bgm["namek"] = bgm["explore_namek"]
    bgm["battle"] = pick("battle", gen="bgm_battle")
    bgm["boss"] = pick("boss", gen="bgm_boss")
    bgm["transformation"] = pick("transformation", gen="bgm_transformation")
    bgm["space"] = pick("space", gen="bgm_space")
    bgm["otherworld"] = pick("otherworld", gen="bgm_otherworld")
    bgm["heaven"] = pick("heaven")
    bgm["hell"] = pick("hell", "tense", gen="bgm_otherworld")
    bgm["time_chamber"] = pick("time_chamber", "training")
    bgm["training"] = pick("training")
    bgm["sad"] = pick("sad")
    for k, v in bgm.items():
        if not v:
            subst("bgm context %s empty -> menu list" % k)
            bgm[k] = list(bgm["menu"])
    out = OrderedDict()
    out["sfx"] = sfx
    out["bgm"] = bgm
    out["tracks"] = tracks
    jsave("audio.json", out)
    COUNTS["audio sfx logical"] = len(sfx)
    COUNTS["audio bgm contexts"] = len(bgm)
    COUNTS["audio tracks"] = len(tracks)


# ================================================================ MAIN
def cross_check(entities, skills, techs, forms, masters):
    problems = []
    for eid in sorted(quest_entities):
        if eid not in entities:
            problems.append("quest entity %s missing in entities.json" % eid)
    for qid, q in quest_index.items():
        for o in q["objectives"]:
            if o["type"] == "TALK" and o["npc"] not in masters:
                problems.append("quest %s talks to unknown npc %s" % (qid, o["npc"]))
            if o["type"] == "SKILL" and o["skill"] not in skills:
                problems.append("quest %s objective unknown skill %s" % (qid, o["skill"]))
        for r in q["rewards"]:
            if r["type"] == "SKILL" and r["skill"] not in skills:
                problems.append("quest %s rewards unknown skill %s" % (qid, r["skill"]))
        for c in q["requirements"]["conditions"] + q["prerequisites"]["conditions"]:
            if c["type"] == "SKILL" and c["skill"] not in skills:
                problems.append("quest %s requires unknown skill %s" % (qid, c["skill"]))
            if c["type"] in ("SAGA_QUEST", "QUEST") and c["quest"] not in quest_index:
                problems.append("quest %s references unknown quest %s" % (qid, c["quest"]))
        for k in ("quest_giver", "turn_in"):
            if k in q and q[k] not in masters:
                problems.append("quest %s %s unknown npc %s" % (qid, k, q[k]))
    for eid, e in entities.items():
        for t in e["techniques"]:
            if t not in techs:
                problems.append("entity %s unknown technique %s" % (eid, t))
        for p in e.get("phases", []):
            if p not in entities:
                problems.append("entity %s unknown phase %s" % (eid, p))
        if e["model"] and not exists_asset("models/%s.geo.json" % e["model"]):
            problems.append("entity %s model missing %s" % (eid, e["model"]))
        if e["texture"] and not exists_asset("textures/entity/%s.png" % e["texture"]):
            problems.append("entity %s texture missing %s" % (eid, e["texture"]))
    for fid, f in forms.items():
        if f["model_override"] and not exists_asset("models/%s.geo.json" % f["model_override"]):
            problems.append("form %s model missing" % fid)
        if f["skill"] not in skills:
            problems.append("form %s unknown skill %s" % (fid, f["skill"]))
        if f.get("formRequisite") and f["formRequisite"] not in forms:
            problems.append("form %s requisite %s unknown" % (fid, f["formRequisite"]))
    for tid, t in techs.items():
        if t["unlock"] and t["unlock"] not in masters:
            problems.append("technique %s unlock master %s unknown" % (tid, t["unlock"]))
    for sid, s in skills.items():
        if s["unlock"] and s["unlock"] not in masters:
            problems.append("skill %s unlock master %s unknown" % (sid, s["unlock"]))
    return problems


def main():
    os.makedirs(DATA, exist_ok=True)
    convert_quests()
    entities = convert_entities()
    races = convert_races()
    skills, skill_costs = convert_skills()
    techs = convert_techniques(skill_costs)
    forms = convert_forms(races, skill_costs)
    masters = convert_masters(entities, skills, techs)
    convert_wishes()
    convert_audio()
    problems = cross_check(entities, skills, techs, forms, masters)

    print("=== counts")
    for k, v in COUNTS.items():
        print("  %-24s %d" % (k, v))
    print("=== substitutions (%d)" % len(SUBST))
    for s in sorted(set(SUBST)):
        print("  " + s)
    print("=== unported (%d)" % len(UNPORTED))
    for s in sorted(set(UNPORTED)):
        print("  " + s)
    print("=== cross-check problems (%d)" % len(problems))
    for p in problems:
        print("  " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
