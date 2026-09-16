class_name Requirements
extends RefCounted
## Quest requirement / prerequisite evaluation (docs/ARCHITECTURE.md §9).
##
## Ported DMZ quests carry two condition groups:
##   requirements   {operator: "AND"|"OR", conditions: [...]}   where the player must BE
##   prerequisites  {operator, conditions}                      what must already be done
## Condition types: LEVEL, PLANET, BIOME, STRUCTURE, SAGA_QUEST, QUEST, SKILL, ITEM,
## ALIGNMENT, TIME (see docs/DATA_SCHEMA.md "Additions produced by the converters":
## `SAGA_QUEST`/`QUEST` carry a resolved `quest` registry id, `BIOME` values match
## `biomes.json.quest_tag`, `PLANET` values are planet ids).
##
## Everything is static and takes a plain context Dictionary so tests can use fixtures.

const STRUCTURE_RADIUS := 96.0        ## how far a structure mark may be to count as "here"

## Build the evaluation context from a profile (+ optional live player/world).
static func build_context(profile: Dictionary, player: Node = null, world: Node = null) -> Dictionary:
	var quests: Dictionary = profile.get("quests", {})
	var ctx := {
		"level": profile_level(profile, player),
		"planet": "",
		"biome": "",
		"biome_id": "",
		"structures": PackedStringArray(),
		"skills": profile.get("skills", {}),
		"items": {},
		"alignment": int(profile.get("alignment", 50)),
		"completed": quests.get("completed", []),
		"claimed": quests.get("claimed", []),
		"active": quests.get("active", {}),
		"position": Vector3.ZERO,
		"planets_unlocked": profile.get("planets_unlocked", ["earth"]),
	}
	if world != null and is_instance_valid(world) and world.get("planet_id") != null:
		ctx["planet"] = String(world.get("planet_id"))
	elif Game != null and not Game.world_info.is_empty():
		ctx["planet"] = String(Game.world_info.get("planet", ""))
	if ctx["planet"] == "":
		ctx["planet"] = String(profile.get("position", {}).get("planet", ""))
	var pos := Vector3.ZERO
	if player != null and is_instance_valid(player) and player is Node3D:
		pos = (player as Node3D).global_position
	else:
		var p: Dictionary = profile.get("position", {})
		pos = Vector3(float(p.get("x", 0.0)), float(p.get("y", 0.0)), float(p.get("z", 0.0)))
	ctx["position"] = pos
	ctx["biome_id"] = biome_at(world, pos)
	ctx["biome"] = biome_tag(String(ctx["biome_id"]))
	ctx["structures"] = structures_near(world, pos)
	ctx["items"] = item_counts(profile, player)
	return ctx

static func profile_level(profile: Dictionary, player: Node = null) -> int:
	if player != null and is_instance_valid(player) and "stats" in player:
		var s: Variant = player.get("stats")
		if s != null and (s as Object).has_method("level"):
			return int((s as Object).call("level"))
	var total := 0
	for k in profile.get("stats", {}).keys():
		total += int(profile["stats"][k])
	return 1 + total / 5

static func biome_at(world: Node, pos: Vector3) -> String:
	if world != null and is_instance_valid(world) and world.has_method("get_biome"):
		return String(world.call("get_biome", int(floor(pos.x)), int(floor(pos.z))))
	return ""

## biomes.json `quest_tag` for a biome id ("plains" -> "minecraft:plains").
static func biome_tag(biome_id: String) -> String:
	if biome_id == "" or Registry == null:
		return ""
	return String(Registry.biome(biome_id).get("quest_tag", biome_id))

## Every structure quest_tag whose mark is within STRUCTURE_RADIUS of `pos`.
static func structures_near(world: Node, pos: Vector3, radius := STRUCTURE_RADIUS) -> PackedStringArray:
	var out := PackedStringArray()
	if world == null or not is_instance_valid(world) or not world.has_method("get_column"):
		return out
	var r := int(ceil(radius / 16.0))
	var cx := int(floor(pos.x / 16.0))
	var cz := int(floor(pos.z / 16.0))
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			var col: Variant = world.call("get_column", cx + dx, cz + dz)
			if col == null:
				continue
			var marks: Variant = col.get("structure_marks")
			if not (marks is Array):
				continue
			for m in marks:
				var tag := mark_tag(m)
				if tag == "":
					continue
				if mark_distance(m, pos) > radius:
					continue
				if not out.has(tag):
					out.append(tag)
				var sid := mark_id(m)
				if sid != "" and not out.has(sid):
					out.append(sid)
	return out

## `structure_marks` entries come from the worldgen engineer; accept the shapes we know.
static func mark_id(mark: Variant) -> String:
	if mark is Dictionary:
		var d: Dictionary = mark
		for k in ["id", "structure", "name"]:
			if d.has(k):
				return String(d[k])
	elif mark is String:
		return String(mark)
	return ""

static func mark_tag(mark: Variant) -> String:
	var sid := mark_id(mark)
	if mark is Dictionary and (mark as Dictionary).has("quest_tag"):
		return String((mark as Dictionary)["quest_tag"])
	if sid != "" and Registry != null:
		var def: Dictionary = Registry.structures.get(sid, {})
		var tag := String(def.get("quest_tag", ""))
		if tag != "":
			return tag
		var alias := String(def.get("alias_of", ""))
		if alias != "":
			return String(Registry.structures.get(alias, {}).get("quest_tag", sid))
	return sid

## Marks carry either an `aabb` (Structures.gd) or a single position.
static func mark_position(mark: Variant) -> Variant:
	if not (mark is Dictionary):
		return null
	var d: Dictionary = mark
	if d.has("aabb") and d["aabb"] is AABB:
		return (d["aabb"] as AABB).get_center()
	for k in ["pos", "position", "origin", "center"]:
		if not d.has(k):
			continue
		var v: Variant = d[k]
		if v is Vector3:
			return v
		if v is Vector3i:
			return Vector3(v)
		if v is Array and (v as Array).size() >= 3:
			var a: Array = v
			return Vector3(float(a[0]), float(a[1]), float(a[2]))
	return null

## Horizontal distance from `pos` to a structure mark (0 inside its box, INF unknown).
static func mark_distance(mark: Variant, pos: Vector3) -> float:
	if mark is Dictionary and (mark as Dictionary).get("aabb", null) is AABB:
		var box: AABB = (mark as Dictionary)["aabb"]
		var dx: float = maxf(0.0, maxf(box.position.x - pos.x, pos.x - (box.position.x + box.size.x)))
		var dz: float = maxf(0.0, maxf(box.position.z - pos.z, pos.z - (box.position.z + box.size.z)))
		return sqrt(dx * dx + dz * dz)
	var mp := mark_position(mark)
	if mp is Vector3:
		var p: Vector3 = mp
		return Vector2(p.x - pos.x, p.z - pos.z).length()
	return 0.0

static func item_counts(profile: Dictionary, player: Node = null) -> Dictionary:
	var out: Dictionary = {}
	if player != null and is_instance_valid(player) and "inventory" in player:
		var inv: Variant = player.get("inventory")
		if inv != null and (inv as Object).has_method("count"):
			return {"_inventory": inv}
	var inv_d: Dictionary = profile.get("inventory", {})
	for slot in inv_d.get("slots", []):
		if slot is Dictionary and (slot as Dictionary).has("item"):
			var id := String(slot["item"])
			out[id] = int(out.get(id, 0)) + int((slot as Dictionary).get("count", 1))
	for slot in inv_d.get("armor", []):
		if slot is Dictionary and (slot as Dictionary).has("item"):
			var id2 := String(slot["item"])
			out[id2] = int(out.get(id2, 0)) + int((slot as Dictionary).get("count", 1))
	return out

static func count_item(ctx: Dictionary, item_id: String) -> int:
	var items: Dictionary = ctx.get("items", {})
	if items.has("_inventory"):
		var inv: Variant = items["_inventory"]
		if inv != null and is_instance_valid(inv as Object) and (inv as Object).has_method("count"):
			return int((inv as Object).call("count", item_id))
		return 0
	return int(items.get(item_id, 0))

# --- evaluation ------------------------------------------------------------

## Evaluate a `{operator, conditions}` group. Returns `{ok: bool, reasons: PackedStringArray}`.
static func evaluate(group: Variant, ctx: Dictionary) -> Dictionary:
	var conditions: Array = []
	var op := "AND"
	if group is Dictionary:
		var g: Dictionary = group
		op = String(g.get("operator", "AND")).to_upper()
		var c: Variant = g.get("conditions", [])
		if c is Array:
			conditions = c
	elif group is Array:
		conditions = group
	if conditions.is_empty():
		return {"ok": true, "reasons": PackedStringArray()}
	var reasons := PackedStringArray()
	var any_ok := false
	var all_ok := true
	for c in conditions:
		var r := evaluate_condition(c, ctx)
		if bool(r["ok"]):
			any_ok = true
		else:
			all_ok = false
			var why := String(r.get("reason", ""))
			if why != "" and not reasons.has(why):
				reasons.append(why)
	var ok := any_ok if op == "OR" else all_ok
	if ok:
		reasons = PackedStringArray()
	return {"ok": ok, "reasons": reasons}

static func evaluate_condition(condition: Variant, ctx: Dictionary) -> Dictionary:
	if not (condition is Dictionary):
		return {"ok": true, "reason": ""}
	var c: Dictionary = condition
	match String(c.get("type", "")).to_upper():
		"LEVEL":
			var need := int(c.get("minLevel", c.get("level", 1)))
			if int(ctx.get("level", 1)) >= need:
				return {"ok": true, "reason": ""}
			return {"ok": false, "reason": "Requires level %d" % need}
		"PLANET":
			var want := String(c.get("planet", ""))
			if want == "" or String(ctx.get("planet", "")) == want:
				return {"ok": true, "reason": ""}
			return {"ok": false, "reason": "Must be on %s" % planet_name(want)}
		"BIOME":
			var want_b := String(c.get("biome", ""))
			if want_b == "" or String(ctx.get("biome", "")) == want_b or String(ctx.get("biome_id", "")) == want_b:
				return {"ok": true, "reason": ""}
			return {"ok": false, "reason": "Must be in %s" % biome_name(want_b)}
		"STRUCTURE":
			var want_s := String(c.get("structure", ""))
			var near: PackedStringArray = ctx.get("structures", PackedStringArray())
			if want_s == "" or near.has(want_s):
				return {"ok": true, "reason": ""}
			return {"ok": false, "reason": "Must be at %s" % structure_name(want_s)}
		"SAGA_QUEST", "QUEST":
			var qid := String(c.get("quest", ""))
			if qid == "":
				qid = "%s:%s" % [String(c.get("sagaId", "")), String(c.get("questId", ""))]
			var completed: Array = ctx.get("completed", [])
			if qid == "" or completed.has(qid):
				return {"ok": true, "reason": ""}
			return {"ok": false, "reason": "Finish \"%s\" first" % quest_title(qid)}
		"SKILL":
			var sid := String(c.get("skill", ""))
			var need_l := int(c.get("minLevel", c.get("level", 1)))
			var skills: Dictionary = ctx.get("skills", {})
			if sid == "" or int(skills.get(sid, 0)) >= need_l:
				return {"ok": true, "reason": ""}
			return {"ok": false, "reason": "Needs %s level %d" % [skill_name(sid), need_l]}
		"ITEM":
			var iid := String(c.get("item", ""))
			var need_c := maxi(1, int(c.get("count", 1)))
			if iid == "" or count_item(ctx, iid) >= need_c:
				return {"ok": true, "reason": ""}
			return {"ok": false, "reason": "Needs %s x%d" % [item_name(iid), need_c]}
		"ALIGNMENT":
			var a := int(ctx.get("alignment", 50))
			var lo := int(c.get("min", c.get("minAlignment", -999)))
			var hi := int(c.get("max", c.get("maxAlignment", 999)))
			if a >= lo and a <= hi:
				return {"ok": true, "reason": ""}
			return {"ok": false, "reason": "Alignment must be between %d and %d" % [lo, hi]}
		"TIME":
			# A TIME requirement is a duration the quest must run for; `QuestManager`
			# turns it into a completion gate, it never blocks starting the quest.
			return {"ok": true, "reason": ""}
	return {"ok": true, "reason": ""}

## Seconds of a TIME condition in a group (0 when there is none).
static func time_gate(group: Variant) -> float:
	var conditions: Array = []
	if group is Dictionary:
		var c: Variant = (group as Dictionary).get("conditions", [])
		if c is Array:
			conditions = c
	elif group is Array:
		conditions = group
	var out := 0.0
	for c in conditions:
		if c is Dictionary and String((c as Dictionary).get("type", "")).to_upper() == "TIME":
			out = maxf(out, float((c as Dictionary).get("seconds", 0.0)))
	return out

# --- pretty names ----------------------------------------------------------

## Master id that owns an entity type. Uses `entities.json.master` and falls back to a
## reverse lookup through `masters.json.entity` (a few NPCs only have the back link).
static func master_of_entity(entity_type: String) -> String:
	if entity_type == "" or Registry == null:
		return ""
	var direct := String(Registry.entity(entity_type).get("master", ""))
	if direct != "":
		return direct
	if _master_by_entity.is_empty():
		for mid in Registry.masters.keys():
			var ent := String(Registry.masters[mid].get("entity", ""))
			if ent != "":
				_master_by_entity[ent] = String(mid)
	return String(_master_by_entity.get(entity_type, ""))

static var _master_by_entity: Dictionary = {}

static func planet_name(id: String) -> String:
	if Registry == null:
		return id
	return String(Registry.planet(id).get("name", id.capitalize()))

static func biome_name(tag: String) -> String:
	if Registry == null:
		return tag
	for bid in Registry.biomes.keys():
		if String(Registry.biomes[bid].get("quest_tag", "")) == tag:
			return String(Registry.biomes[bid].get("name", bid))
	return tag.get_slice(":", 1).capitalize() if tag.contains(":") else tag.capitalize()

static func structure_name(tag: String) -> String:
	if Registry != null:
		for sid in Registry.structures.keys():
			if String(Registry.structures[sid].get("quest_tag", "")) == tag or sid == tag:
				return sid.replace("_", " ").capitalize()
	return tag.get_slice(":", 1).replace("_", " ").capitalize() if tag.contains(":") else tag.capitalize()

static func quest_title(qid: String) -> String:
	if Registry == null:
		return qid
	var q: Dictionary = Registry.quest(qid)
	return String(q.get("title", q.get("name", qid)))

static func skill_name(id: String) -> String:
	if Registry == null:
		return id
	return String(Registry.skill(id).get("name", id.capitalize()))

static func item_name(id: String) -> String:
	if Registry == null:
		return id
	return String(Registry.item(id).get("name", id.capitalize()))
