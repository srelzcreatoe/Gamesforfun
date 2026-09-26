extends TestCase
## Integrity tests for the part-B registries (items, recipes, biomes, planets,
## structures) produced by tools/convert_dmz_data_b.py.

const KINDS := ["block", "material", "food", "tool", "weapon", "armor", "radar",
	"dragon_ball", "capsule", "vehicle", "scouter", "weights", "key", "music_disc",
	"misc"]
const STATIONS := ["hand", "crafting_table", "furnace", "kikono_station", "gete_forge"]
const SLOTS := ["head", "chest", "legs", "feet"]

func test_items_have_valid_kinds_and_icons() -> void:
	var bad: PackedStringArray = PackedStringArray()
	for id in Registry.items:
		var it: Dictionary = Registry.items[id]
		if not KINDS.has(it.get("kind", "")):
			bad.append("%s: kind %s" % [id, it.get("kind", "")])
		var icon: String = String(it.get("icon", ""))
		if icon.is_empty():
			bad.append("%s: no icon" % id)
		elif not it.get("kind", "") == "block":
			if not ResourceLoader.exists("res://assets/textures/items/%s.png" % icon):
				bad.append("%s: missing icon %s" % [id, icon])
	assert_true(bad.is_empty(), "\n".join(bad))

func test_armor_and_tools_are_well_formed() -> void:
	var bad: PackedStringArray = PackedStringArray()
	var armor := 0
	var tools := 0
	for id in Registry.items:
		var it: Dictionary = Registry.items[id]
		match String(it.get("kind", "")):
			"armor":
				armor += 1
				var a: Dictionary = it.get("armor", {})
				if not SLOTS.has(a.get("slot", "")):
					bad.append("%s: slot %s" % [id, a.get("slot", "")])
				if int(a.get("defense", 0)) <= 0:
					bad.append("%s: defense %s" % [id, a.get("defense", 0)])
				var layer: String = String(a.get("layer", ""))
				if not ResourceLoader.exists("res://assets/textures/armor/%s_layer1.png" % layer) \
						and not ResourceLoader.exists("res://assets/textures/armor/%s_layer_1.png" % layer) \
						and layer != "blank":
					bad.append("%s: armor layer %s" % [id, layer])
			"tool":
				tools += 1
				var t: Dictionary = it.get("tool", {})
				if int(t.get("tier", -1)) < 1 or int(t.get("tier", -1)) > 5:
					bad.append("%s: tier %s" % [id, t.get("tier", -1)])
				if int(t.get("durability", 0)) <= 0:
					bad.append("%s: durability" % id)
	assert_true(bad.is_empty(), "\n".join(bad))
	assert_true(armor >= 200, "expected the full DMZ armor set, got %d" % armor)
	assert_true(tools >= 35, "expected 7 tool tiers x 5 kinds, got %d" % tools)

func test_recipes_use_known_stations_and_shapes() -> void:
	var bad: PackedStringArray = PackedStringArray()
	for r in Registry.recipes:
		var st: String = String(r.get("station", ""))
		if not STATIONS.has(st):
			bad.append("%s: station %s" % [r.get("id", "?"), st])
		if st == "furnace":
			if not r.has("input"):
				bad.append("%s: furnace recipe without input" % r.get("id", "?"))
			continue
		var shape: Array = r.get("shape", [])
		if shape.is_empty():
			bad.append("%s: empty shape" % r.get("id", "?"))
			continue
		var w := 0
		for row in shape:
			w = max(w, String(row).length())
		var limit := 2 if st == "hand" else 3
		if shape.size() > limit or w > limit:
			bad.append("%s: %dx%d does not fit %s" % [r.get("id", "?"), w, shape.size(), st])
		for row in shape:
			for i in String(row).length():
				var c := String(row)[i]
				if c != " " and not r.get("keys", {}).has(c):
					bad.append("%s: shape key %s missing" % [r.get("id", "?"), c])
	assert_true(bad.is_empty(), "\n".join(bad))

func test_biomes_cover_quest_biome_tags() -> void:
	var tags := {}
	for id in Registry.biomes:
		var t: String = String(Registry.biomes[id].get("quest_tag", ""))
		assert_true(not (t.is_empty()), "biome %s has no quest_tag" % id)
		assert_true(not (tags.has(t)), "quest_tag %s used twice" % t)
		tags[t] = id
	var missing: PackedStringArray = PackedStringArray()
	for qid in Registry.quests:
		var q: Dictionary = Registry.quests[qid]
		for c in q.get("requirements", {}).get("conditions", []):
			if c is Dictionary and c.has("biome") and not tags.has(String(c["biome"])):
				missing.append("%s needs biome %s" % [qid, c["biome"]])
	assert_true(missing.is_empty(), "\n".join(missing))

func test_planets_have_sky_and_biomes() -> void:
	var bad: PackedStringArray = PackedStringArray()
	for pid in Registry.planets:
		var p: Dictionary = Registry.planets[pid]
		if p.get("biomes", []).is_empty():
			bad.append("%s: no biomes" % pid)
		var sky: Dictionary = p.get("sky", {})
		for key in ["day", "night", "fog"]:
			if not String(sky.get(key, "")).begins_with("#"):
				bad.append("%s: sky.%s %s" % [pid, key, sky.get(key, "")])
		for b in sky.get("bodies", []):
			var tex: String = String(b.get("texture", ""))
			if not ResourceLoader.exists("res://assets/textures/environment/%s.png" % tex):
				bad.append("%s: sky body texture %s" % [pid, tex])
		if float(p.get("gravity", 0.0)) < 0.0:
			bad.append("%s: gravity" % pid)
	assert_true(bad.is_empty(), "\n".join(bad))
	assert_true(Registry.planets.has("earth"))
	assert_true(Registry.planets.has("namek"))

func test_structure_files_load_and_only_use_known_blocks() -> void:
	var bad: PackedStringArray = PackedStringArray()
	var total_blocks := 0
	for name in Registry.structures:
		var e: Dictionary = Registry.structures[name]
		var path: String = "res://" + String(e.get("file", ""))
		var doc: Variant = JsonUtil.load_file(path)
		if not doc is Dictionary:
			bad.append("%s: cannot load %s" % [name, path])
			continue
		var pal: Array = doc.get("palette", [])
		if pal.is_empty() or String(pal[0]) != "air":
			bad.append("%s: palette must start with air" % name)
		for b in pal:
			if Registry.block_id(String(b)) < 0:
				bad.append("%s: unknown palette block %s" % [name, b])
		var size: Array = doc.get("size", [])
		if size.size() != 3:
			bad.append("%s: bad size" % name)
			continue
		for blk in doc.get("blocks", []):
			total_blocks += 1
			if blk.size() != 4:
				bad.append("%s: malformed block entry" % name)
				break
			if int(blk[3]) < 0 or int(blk[3]) >= pal.size():
				bad.append("%s: palette index out of range" % name)
				break
			for a in 3:
				if int(blk[a]) < 0 or int(blk[a]) >= int(size[a]):
					bad.append("%s: block outside size" % name)
					break
		for ent in doc.get("entities", []):
			if not Registry.entities.has(String(ent.get("id", ""))):
				bad.append("%s: unknown entity %s" % [name, ent.get("id", "")])
	assert_true(bad.is_empty(), "\n".join(bad))
	assert_true(total_blocks > 100000, "structures look empty (%d blocks)" % total_blocks)

func test_structures_referenced_by_masters_exist() -> void:
	for mid in Registry.masters:
		var s: String = String(Registry.masters[mid].get("structure", ""))
		if s.is_empty():
			continue
		assert_true(Registry.structures.has(s),
			"master %s wants structure %s" % [mid, s])
