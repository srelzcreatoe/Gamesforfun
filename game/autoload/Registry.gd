extends Node
## Loads every JSON registry in res://data and exposes them (see docs/ARCHITECTURE.md §3).

const DATA_DIR := "res://data"
const AIR := 0

var blocks: Array[Dictionary] = []
var block_ids: Dictionary = {}
var items: Dictionary = {}
var recipes: Array[Dictionary] = []
var biomes: Dictionary = {}
var biome_order: PackedStringArray = PackedStringArray()
var planets: Dictionary = {}
var entities: Dictionary = {}
var races: Dictionary = {}
var forms: Dictionary = {}
var skills: Dictionary = {}
var techniques: Dictionary = {}
var masters: Dictionary = {}
var wishes: Dictionary = {}
var structures: Dictionary = {}
var audio: Dictionary = {}
var sagas: Array[Dictionary] = []
var quests: Dictionary = {}
var loaded := false
var problems: PackedStringArray = PackedStringArray()

const BLOCK_DEFAULTS := {
	"shape": "cube", "textures": {}, "variants": [], "material": "stone", "hardness": 1.0,
	"tool": "none", "min_tier": 0, "drops": [{"item": "self", "count": 1}], "light": 0,
	"tint": "none", "sound": "", "opaque": true, "solid": true, "gravity": false,
	"flammable": false, "replaceable": false, "transparent": false,
}

func _ready() -> void:
	load_all()

func load_all() -> void:
	problems.clear()
	_load_blocks()
	_load_items()
	recipes.assign(_list(_load(DATA_DIR + "/recipes.json"), "recipes"))
	_load_keyed("biomes.json", "biomes", biomes)
	biome_order = PackedStringArray(biomes.keys())
	_load_keyed("planets.json", "planets", planets)
	_load_keyed("entities.json", "entities", entities)
	races = _dict(_load(DATA_DIR + "/races.json"), "races")
	forms = _dict(_load(DATA_DIR + "/forms.json"), "forms")
	skills = _dict(_load(DATA_DIR + "/skills.json"), "skills")
	techniques = _dict(_load(DATA_DIR + "/techniques.json"), "techniques")
	masters = _dict(_load(DATA_DIR + "/masters.json"), "masters")
	wishes = _dict(_load(DATA_DIR + "/wishes.json"), "wishes")
	structures = _dict(_load(DATA_DIR + "/structures.json"), "structures")
	audio = _load(DATA_DIR + "/audio.json") if _load(DATA_DIR + "/audio.json") is Dictionary else {}
	sagas.assign(_list(_load(DATA_DIR + "/sagas.json"), "sagas"))
	_load_quests()
	loaded = true
	var v := validate()
	if v.size() > 0:
		for p in v:
			Log.e("Registry: " + p)
	Log.i("Registry loaded: %d blocks, %d items, %d recipes, %d biomes, %d planets, %d entities, %d quests, %d forms, %d techniques" % [
		blocks.size(), items.size(), recipes.size(), biomes.size(), planets.size(), entities.size(), quests.size(), forms.size(), techniques.size()])

func _load(path: String) -> Variant:
	var d: Variant = JsonUtil.load_file(path)
	if d == null:
		problems.append("missing or invalid " + path)
		return {}
	return d

func _list(d: Variant, key: String) -> Array:
	if d is Dictionary and d.has(key) and d[key] is Array:
		return d[key]
	if d is Array:
		return d
	return []

func _dict(d: Variant, key: String) -> Dictionary:
	if d is Dictionary and d.has(key) and d[key] is Dictionary:
		return d[key]
	if d is Dictionary and d.has(key) and d[key] is Array:
		var out := {}
		for e in d[key]:
			if e is Dictionary and e.has("id"):
				out[e["id"]] = e
		return out
	if d is Dictionary and not d.has(key):
		return d
	return {}

func _load_keyed(file: String, key: String, into: Dictionary) -> void:
	into.clear()
	for e in _list(_load(DATA_DIR + "/" + file), key):
		if e is Dictionary and e.has("id"):
			if into.has(e["id"]):
				problems.append("duplicate %s id %s" % [key, e["id"]])
			into[e["id"]] = e

func _load_blocks() -> void:
	blocks.clear()
	block_ids.clear()
	var list := _list(_load(DATA_DIR + "/blocks.json"), "blocks")
	if list.is_empty() or list[0].get("id", "") != "air":
		problems.append("blocks.json must start with air")
	for raw in list:
		var b: Dictionary = BLOCK_DEFAULTS.duplicate(true)
		for k in raw.keys():
			b[k] = raw[k]
		if not b.has("name"):
			b["name"] = String(b["id"]).capitalize()
		var shape: String = b["shape"]
		if shape == "none":
			b["solid"] = false; b["opaque"] = false; b["replaceable"] = true; b["transparent"] = true
		elif shape in ["cross", "crop", "torch", "ladder", "waterlily", "snow_layer", "carpet", "liquid", "fence", "door", "trapdoor", "model", "slab_bottom"]:
			b["opaque"] = false
			b["transparent"] = true
			if shape in ["cross", "crop", "torch", "waterlily", "snow_layer", "carpet", "liquid"]:
				b["solid"] = false
			if shape in ["cross", "liquid", "snow_layer"]:
				b["replaceable"] = raw.get("replaceable", shape != "snow_layer")
		elif shape in ["cutout_cube", "translucent_cube"]:
			b["opaque"] = false
			b["transparent"] = true
		b["numeric_id"] = blocks.size()
		if block_ids.has(b["id"]):
			problems.append("duplicate block id " + String(b["id"]))
		block_ids[b["id"]] = blocks.size()
		blocks.append(b)
	if blocks.size() > 256:
		problems.append("too many blocks (%d > 256)" % blocks.size())

func _load_items() -> void:
	items.clear()
	for b in blocks:
		if b["id"] == "air":
			continue
		items[b["id"]] = {
			"id": b["id"], "name": b["name"], "kind": "block", "block": b["id"], "stack": 64,
			"icon": "block_" + String(b["id"]), "rarity": "common",
		}
	for raw in _list(_load(DATA_DIR + "/items.json"), "items"):
		if not raw is Dictionary or not raw.has("id"):
			continue
		var it: Dictionary = raw.duplicate(true)
		if not it.has("stack"):
			it["stack"] = 64
		if not it.has("kind"):
			it["kind"] = "misc"
		if not it.has("icon"):
			it["icon"] = it["id"]
		if not it.has("name"):
			it["name"] = String(it["id"]).capitalize()
		if not it.has("rarity"):
			it["rarity"] = "common"
		items[it["id"]] = it

func _load_quests() -> void:
	quests.clear()
	for path in JsonUtil.list_files(DATA_DIR + "/quests", ".json", true):
		var q: Variant = JsonUtil.load_file(path)
		if q is Dictionary and q.has("id"):
			var category: String = q.get("category", path.get_base_dir().get_file())
			var qid := "%s:%s" % [category, str(q["id"])]
			q["quest_id"] = qid
			q["category"] = category
			if quests.has(qid):
				problems.append("duplicate quest id " + qid)
			quests[qid] = q

# --- accessors -------------------------------------------------------------

func block(id: int) -> Dictionary:
	if id < 0 or id >= blocks.size():
		return blocks[0]
	return blocks[id]

func block_id(name: String) -> int:
	return block_ids.get(name, -1)

func block_by_name(name: String) -> Dictionary:
	var id := block_id(name)
	return blocks[id] if id >= 0 else {}

func item(id: String) -> Dictionary:
	return items.get(id, {})

func has_item(id: String) -> bool:
	return items.has(id)

func quest(id: String) -> Dictionary:
	return quests.get(id, {})

func entity(id: String) -> Dictionary:
	return entities.get(id, {})

func planet(id: String) -> Dictionary:
	return planets.get(id, {})

func biome(id: String) -> Dictionary:
	return biomes.get(id, {})

func biome_index(id: String) -> int:
	return biome_order.find(id)

func biome_by_index(i: int) -> Dictionary:
	if i < 0 or i >= biome_order.size():
		return {}
	return biomes[biome_order[i]]

func technique(id: String) -> Dictionary:
	return techniques.get(id, {})

func form(id: String) -> Dictionary:
	return forms.get(id, {})

func skill(id: String) -> Dictionary:
	return skills.get(id, {})

func race(id: String) -> Dictionary:
	return races.get(id, {})

# --- validation ------------------------------------------------------------

func validate() -> PackedStringArray:
	var out := PackedStringArray(problems)
	for b in blocks:
		for d in b.get("drops", []):
			var it: String = d.get("item", "self")
			if it != "self" and not items.has(it):
				out.append("block %s drops unknown item %s" % [b["id"], it])
	for r in recipes:
		var res: Dictionary = r.get("result", {})
		if not items.has(res.get("item", "")):
			out.append("recipe %s -> unknown item %s" % [r.get("id", "?"), res.get("item", "")])
		for k in r.get("keys", {}).values():
			var ks: Array = k if k is Array else [k]
			for kk in ks:
				if not items.has(kk):
					out.append("recipe %s uses unknown item %s" % [r.get("id", "?"), kk])
		if r.has("input") and not items.has(r["input"]):
			out.append("recipe %s input unknown item %s" % [r.get("id", "?"), r["input"]])
	for bid in biomes:
		var bio: Dictionary = biomes[bid]
		for key in ["surface", "filler", "underwater"]:
			if bio.has(key) and block_id(bio[key]) < 0:
				out.append("biome %s.%s unknown block %s" % [bid, key, bio[key]])
		for pl in bio.get("plants", []):
			if block_id(pl.get("block", "")) < 0:
				out.append("biome %s plant unknown block %s" % [bid, pl.get("block", "")])
		for m in bio.get("mobs", []):
			if not entities.has(m.get("entity", "")):
				out.append("biome %s mob unknown entity %s" % [bid, m.get("entity", "")])
	for pid in planets:
		for bid in planets[pid].get("biomes", []):
			if not biomes.has(bid):
				out.append("planet %s unknown biome %s" % [pid, bid])
	for qid in quests:
		var q: Dictionary = quests[qid]
		for o in q.get("objectives", []):
			if o.get("type", "") == "KILL" and not entities.has(o.get("entity", "")):
				out.append("quest %s kills unknown entity %s" % [qid, o.get("entity", "")])
			if o.get("type", "") == "OBTAIN" and not items.has(o.get("item", "")):
				out.append("quest %s obtains unknown item %s" % [qid, o.get("item", "")])
		for r in q.get("rewards", []):
			if r.get("type", "") == "ITEM" and not items.has(r.get("item", "")):
				out.append("quest %s rewards unknown item %s" % [qid, r.get("item", "")])
	for eid in entities:
		var e: Dictionary = entities[eid]
		for d in e.get("drops", []):
			if not items.has(d.get("item", "")):
				out.append("entity %s drops unknown item %s" % [eid, d.get("item", "")])
	return out
