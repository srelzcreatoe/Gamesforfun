class_name Objectives
extends RefCounted
## Objective matching and progress rules for one quest objective Dictionary
## (docs/ARCHITECTURE.md §9). Objective kinds: KILL, TALK, OBTAIN, GO_TO, INTERACT,
## SUMMON, SKILL, TRAIN, WAIT.
##
## Converted DMZ objectives keep `dmz_type` next to the normalised `type`, KILL carries
## `spawn` ("QUEST"/"NATURAL"), `count_mode` ("QUEST_SPAWNED_ONLY"/"ANY_MATCHING"),
## the stat overrides `health`/`meleeDamage`/`kiDamage` and `AITier`, and may list
## `entity_any` alternatives. All static.

const KILL := "KILL"
const TALK := "TALK"
const OBTAIN := "OBTAIN"
const GO_TO := "GO_TO"
const INTERACT := "INTERACT"
const SUMMON := "SUMMON"
const SKILL := "SKILL"
const TRAIN := "TRAIN"
const WAIT := "WAIT"

const GO_TO_RADIUS := 6.0              ## distance to explicit coordinates that counts as arrived

static func kind(o: Dictionary) -> String:
	return String(o.get("type", "")).to_upper()

static func required(o: Dictionary) -> int:
	match kind(o):
		TRAIN:
			return maxi(1, int(o.get("amount", o.get("count", 1))))
		WAIT:
			return maxi(1, int(o.get("seconds", o.get("count", 1))))
		SKILL:
			return 1
	return maxi(1, int(o.get("count", 1)))

static func is_complete(o: Dictionary, progress: int) -> bool:
	return progress >= required(o)

# --- KILL ------------------------------------------------------------------

static func spawn_mode(o: Dictionary) -> String:
	return String(o.get("spawn", "NATURAL")).to_upper()

static func count_mode(o: Dictionary) -> String:
	return String(o.get("count_mode", "ANY_MATCHING")).to_upper()

static func quest_spawned_only(o: Dictionary) -> bool:
	return count_mode(o) == "QUEST_SPAWNED_ONLY"

static func entity_ids(o: Dictionary) -> PackedStringArray:
	var out := PackedStringArray()
	var any: Variant = o.get("entity_any", null)
	if any is Array:
		for e in any:
			out.append(String(e))
	var main := String(o.get("entity", ""))
	if main != "" and not out.has(main):
		out.append(main)
	return out

static func kill_matches(o: Dictionary, entity_type: String) -> bool:
	if entity_type == "":
		return false
	return entity_ids(o).has(entity_type)

## `health` / `meleeDamage` / `kiDamage` overrides in the shape `Entity.spawn_data`
## understands (`stats_override`).
static func stats_override(o: Dictionary) -> Dictionary:
	var out: Dictionary = {}
	if o.has("health") and float(o["health"]) > 0.0:
		out["health"] = float(o["health"])
	if o.has("meleeDamage") and float(o["meleeDamage"]) > 0.0:
		out["melee"] = float(o["meleeDamage"])
	if o.has("kiDamage") and float(o["kiDamage"]) > 0.0:
		out["ki"] = float(o["kiDamage"])
	return out

static func ai_tier(o: Dictionary) -> int:
	return int(o.get("AITier", o.get("ai_tier", -1)))

static func required_biome(o: Dictionary) -> String:
	return String(o.get("biome", ""))

# --- TALK / SUMMON / SKILL -------------------------------------------------

static func npc_id(o: Dictionary) -> String:
	return String(o.get("npc", o.get("npcId", "")))

static func matches_talk(o: Dictionary, npc: String) -> bool:
	if npc == "":
		return false
	var want := npc_id(o)
	return want != "" and want == npc

static func matches_summon(o: Dictionary, dragon_id: String) -> bool:
	var want := String(o.get("dragon", ""))
	if want != "" and want == dragon_id:
		return true
	var set_id := String(o.get("ball_set", ""))
	if set_id == "" or Registry == null:
		return false
	var def: Dictionary = Registry.wishes.get(dragon_id, {})
	return String(def.get("ball_set", "")) == set_id

static func matches_skill(o: Dictionary, skill_id: String, level: int) -> bool:
	if String(o.get("skill", "")) != skill_id:
		return false
	return level >= maxi(1, int(o.get("level", 1)))

# --- OBTAIN ----------------------------------------------------------------

static func item_id(o: Dictionary) -> String:
	return String(o.get("item", ""))

## Current OBTAIN progress read from a Requirements context (inventory aware).
static func obtain_progress(o: Dictionary, ctx: Dictionary) -> int:
	var iid := item_id(o)
	if iid == "":
		return 0
	return mini(Requirements.count_item(ctx, iid), required(o))

# --- GO_TO / INTERACT ------------------------------------------------------

## True when the context (planet / biome tag / nearby structures / position) satisfies
## the GO_TO objective. Every field present must match.
static func matches_location(o: Dictionary, ctx: Dictionary) -> bool:
	var checked := false
	if o.has("planet") and String(o["planet"]) != "":
		checked = true
		if String(ctx.get("planet", "")) != String(o["planet"]):
			return false
	if o.has("biome") and String(o["biome"]) != "":
		checked = true
		if String(ctx.get("biome", "")) != String(o["biome"]) and String(ctx.get("biome_id", "")) != String(o["biome"]):
			return false
	if o.has("structure") and String(o["structure"]) != "":
		checked = true
		var near: PackedStringArray = ctx.get("structures", PackedStringArray())
		if not near.has(String(o["structure"])):
			return false
	if o.has("x") and o.has("z"):
		checked = true
		var target := Vector3(float(o.get("x", 0.0)), float(o.get("y", 0.0)), float(o.get("z", 0.0)))
		var pos: Vector3 = ctx.get("position", Vector3.ZERO)
		var radius := float(o.get("radius", GO_TO_RADIUS))
		var flat_target := Vector3(target.x, pos.y if not o.has("y") else target.y, target.z)
		if pos.distance_to(flat_target) > radius:
			return false
	return checked

static func matches_interact(o: Dictionary, block_id: String, structure_tag := "") -> bool:
	var want := String(o.get("block", o.get("target", "")))
	if want != "" and want == block_id:
		return true
	var want_s := String(o.get("structure", ""))
	return want_s != "" and want_s == structure_tag

# --- text ------------------------------------------------------------------

## Human readable objective line (the HUD tracker and quest log use their own copies,
## this one is for toasts / hints / logs).
static func describe(o: Dictionary) -> String:
	match kind(o):
		KILL:
			var n := String(o.get("entity_name", ""))
			if n == "" and Registry != null:
				n = String(Registry.entity(String(o.get("entity", ""))).get("name", o.get("entity", "enemy")))
			return "Defeat %s" % n
		TALK:
			return "Talk to %s" % _npc_name(npc_id(o))
		OBTAIN:
			return "Collect %s" % Requirements.item_name(item_id(o))
		GO_TO:
			if o.has("planet"):
				return "Travel to %s" % Requirements.planet_name(String(o["planet"]))
			if o.has("structure"):
				return "Find %s" % Requirements.structure_name(String(o["structure"]))
			if o.has("biome"):
				return "Reach the %s" % Requirements.biome_name(String(o["biome"]))
			return "Go to the marker"
		INTERACT:
			return "Interact with %s" % String(o.get("block", o.get("structure", "the object")))
		SUMMON:
			return "Summon %s" % String(o.get("dragon", "the dragon")).capitalize()
		SKILL:
			return "Learn %s" % Requirements.skill_name(String(o.get("skill", "")))
		TRAIN:
			return "Spend %d training points" % required(o)
		WAIT:
			return "Endure %d seconds" % required(o)
	return String(o.get("desc", "Objective"))

static func _npc_name(id: String) -> String:
	if id == "" or Registry == null:
		return "someone"
	var m: Dictionary = Registry.masters.get(id, {})
	return String(m.get("name", id.replace("_", " ").capitalize()))
