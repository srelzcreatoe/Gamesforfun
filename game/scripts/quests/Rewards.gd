class_name Rewards
extends RefCounted
## Quest reward application (docs/ARCHITECTURE.md §9): TPS, ITEM, SKILL, TECHNIQUE,
## FORM, ALIGNMENT, UNLOCK_PLANET. Converted DMZ rewards may carry a `difficulty`
## filter (["NORMAL","HARD"]) — those only pay out on those world difficulties.
##
## Static so the reward math can be tested against a fixture profile with no player.

const ALIGNMENT_MIN := 0
const ALIGNMENT_MAX := 100

static func difficulty() -> String:
	if Game == null or Game.world_info.is_empty():
		return "NORMAL"
	return String(Game.world_info.get("difficulty", "normal")).to_upper()

static func applies(reward: Dictionary) -> bool:
	var d: Variant = reward.get("difficulty", null)
	if not (d is Array) or (d as Array).is_empty():
		return true
	var cur := difficulty()
	for e in d:
		if String(e).to_upper() == cur:
			return true
	return false

## Apply every reward of a quest. Returns the lines to show in the toast.
static func apply_all(rewards: Array, profile: Dictionary, player: Node = null) -> PackedStringArray:
	var out := PackedStringArray()
	for r in rewards:
		if not (r is Dictionary):
			continue
		if not applies(r):
			continue
		var line := apply(r, profile, player)
		if line != "":
			out.append(line)
	return out

static func apply(reward: Dictionary, profile: Dictionary, player: Node = null) -> String:
	match String(reward.get("type", "")).to_upper():
		"TPS":
			return _tps(reward, profile, player)
		"ITEM":
			return _item(reward, profile, player)
		"SKILL":
			return _skill(reward, profile)
		"TECHNIQUE":
			return _technique(reward, profile)
		"FORM":
			return _form(reward, profile)
		"ALIGNMENT":
			return _alignment(reward, profile)
		"UNLOCK_PLANET":
			return _planet(reward, profile)
	return ""

static func _tps(reward: Dictionary, profile: Dictionary, player: Node) -> String:
	var amount := int(reward.get("amount", 0))
	if amount <= 0:
		return ""
	var gained := amount
	if player != null and is_instance_valid(player) and ResourceLoader.exists("res://scripts/combat/Training.gd"):
		var g: int = Training.award(player, float(amount))
		if g > 0:
			gained = g
			return "+%d TP" % gained
	profile["tp"] = int(profile.get("tp", 0)) + amount
	profile["tp_total"] = int(profile.get("tp_total", 0)) + amount
	if Events != null:
		Events.tp_changed.emit(int(profile["tp"]), int(profile["tp_total"]))
	return "+%d TP" % gained

static func _item(reward: Dictionary, profile: Dictionary, player: Node) -> String:
	var id := String(reward.get("item", ""))
	var count := maxi(1, int(reward.get("count", 1)))
	if id == "":
		return ""
	var label := "%s x%d" % [String(reward.get("display_name", Requirements.item_name(id))), count]
	if player != null and is_instance_valid(player) and player.has_method("give"):
		player.call("give", id, count)
		return label
	give_to_profile(profile, id, count)
	return label

## Add an item straight into the profile inventory (used with no live player).
static func give_to_profile(profile: Dictionary, item_id: String, count: int) -> bool:
	var inv: Variant = profile.get("inventory", null)
	if not (inv is Dictionary):
		inv = {"slots": [], "armor": [null, null, null, null], "hotbar": 0}
		profile["inventory"] = inv
	var slots: Variant = (inv as Dictionary).get("slots", null)
	if not (slots is Array):
		slots = []
		(inv as Dictionary)["slots"] = slots
	var arr: Array = slots
	var limit := 64
	if Registry != null:
		limit = int(Registry.item(item_id).get("stack", 64))
	var left := count
	for i in arr.size():
		if left <= 0:
			break
		var s: Variant = arr[i]
		if s is Dictionary and String((s as Dictionary).get("item", "")) == item_id:
			var have := int((s as Dictionary).get("count", 0))
			var add: int = mini(left, maxi(1, limit) - have)
			if add > 0:
				(s as Dictionary)["count"] = have + add
				left -= add
	for i in arr.size():
		if left <= 0:
			break
		if arr[i] == null:
			var add2: int = mini(left, maxi(1, limit))
			arr[i] = {"item": item_id, "count": add2}
			left -= add2
	while left > 0 and arr.size() < 36:
		var add3: int = mini(left, maxi(1, limit))
		arr.append({"item": item_id, "count": add3})
		left -= add3
	return left <= 0

static func _skill(reward: Dictionary, profile: Dictionary) -> String:
	var id := String(reward.get("skill", ""))
	if id == "":
		return ""
	var level := maxi(1, int(reward.get("level", 1)))
	var skills: Variant = profile.get("skills", null)
	if not (skills is Dictionary):
		skills = {}
		profile["skills"] = skills
	var d: Dictionary = skills
	var have := int(d.get(id, 0))
	if have >= level:
		return ""
	d[id] = level
	if Events != null:
		Events.skill_changed.emit(id, level)
	return "%s level %d" % [Requirements.skill_name(id), level]

static func _technique(reward: Dictionary, profile: Dictionary) -> String:
	var id := String(reward.get("technique", ""))
	if id == "":
		return ""
	var arr: Variant = profile.get("techniques", null)
	if not (arr is Array):
		arr = []
		profile["techniques"] = arr
	var list: Array = arr
	if list.has(id):
		return ""
	list.append(id)
	if Events != null:
		Events.technique_learned.emit(id)
	var name := id.capitalize()
	if Registry != null:
		name = String(Registry.technique(id).get("name", name))
	return "Technique: %s" % name

static func _form(reward: Dictionary, profile: Dictionary) -> String:
	var id := String(reward.get("form", ""))
	if id == "":
		return ""
	var forms: Variant = profile.get("forms", null)
	if not (forms is Dictionary):
		forms = {"unlocked": [], "mastery": {}, "current": ""}
		profile["forms"] = forms
	var f: Dictionary = forms
	var unlocked: Variant = f.get("unlocked", null)
	if not (unlocked is Array):
		unlocked = []
		f["unlocked"] = unlocked
	var list: Array = unlocked
	if list.has(id):
		return ""
	list.append(id)
	var name := id
	if Registry != null:
		name = String(Registry.form(id).get("name", id))
	return "Form: %s" % name

static func _alignment(reward: Dictionary, profile: Dictionary) -> String:
	var amount := int(reward.get("amount", 0))
	if amount == 0:
		return ""
	var value := clampi(int(profile.get("alignment", 50)) + amount, ALIGNMENT_MIN, ALIGNMENT_MAX)
	profile["alignment"] = value
	return "Alignment %+d" % amount

static func _planet(reward: Dictionary, profile: Dictionary) -> String:
	var id := String(reward.get("planet", ""))
	if id == "":
		return ""
	var arr: Variant = profile.get("planets_unlocked", null)
	if not (arr is Array):
		arr = ["earth"]
		profile["planets_unlocked"] = arr
	var list: Array = arr
	if list.has(id):
		return ""
	list.append(id)
	if Events != null:
		Events.planet_unlocked.emit(id)
	return "Travel unlocked: %s" % Requirements.planet_name(id)

# --- text ------------------------------------------------------------------

static func describe(reward: Dictionary) -> String:
	match String(reward.get("type", "")).to_upper():
		"TPS": return "%d TP" % int(reward.get("amount", 0))
		"ITEM": return "%s x%d" % [Requirements.item_name(String(reward.get("item", ""))), int(reward.get("count", 1))]
		"SKILL": return "Skill %s" % Requirements.skill_name(String(reward.get("skill", "")))
		"TECHNIQUE": return "Technique %s" % String(reward.get("technique", ""))
		"FORM": return "Form %s" % String(reward.get("form", ""))
		"ALIGNMENT": return "Alignment %+d" % int(reward.get("amount", 0))
		"UNLOCK_PLANET": return "Travel to %s" % Requirements.planet_name(String(reward.get("planet", "")))
	return String(reward.get("type", "Reward"))

static func describe_all(rewards: Array) -> String:
	var parts := PackedStringArray()
	for r in rewards:
		if r is Dictionary and applies(r):
			var t := describe(r)
			if t != "":
				parts.append(t)
	return ", ".join(parts)
