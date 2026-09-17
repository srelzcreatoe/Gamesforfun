class_name Forms
extends Node
## Transformation state machine for one entity (docs/ARCHITECTURE.md §8).
##
## One `Forms` node per entity (`Forms.get_for(entity)`), created on demand. It owns
## the active form stack, the multipliers pushed into `Stats`, ki/health drain, mastery
## and the revert. The cinematic itself is `scripts/fx/TransformationDirector.gd`.
##
## Form data is `data/forms.json` with the DMZ field names, e.g.
##   "ssgrades.supersaiyan": {unlockOnSkillLevel, skill, strMultiplier, ..., energyDrain,
##     maxMastery, masteryPerHitDealt, masteryPerHitReceived,
##     passiveMasteryEveryFiveSeconds, maxCostMultiplier, stackOnMastery,
##     instantTransformOnMastery, formStackable, stackDrainMultiplier, incompatibleWith,
##     auraColor, hasLightnings, lightningColor, hairColor, eye1Color, modelScaling,
##     model_override, transformationAnimation, unlock_tp_cost}
##
## Public API:
##   Forms.transform(entity, "ssgrades.supersaiyan")   -> bool (runs the cinematic)
##   Forms.revert(entity)                              -> pops the last form
##   Forms.revert_all(entity)
##   Forms.can_transform(entity, id)                   -> {ok: bool, reason: String}
##   Forms.is_unlocked(entity, id) / Forms.unlock(entity, id)
##   Forms.active(entity) -> Array[String]   Forms.current(entity) -> String
##   Forms.mastery(entity, id) -> float      Forms.add_mastery(entity, id, amount)

const NODE_NAME := "FormsState"

## Multiplier field names in forms.json -> Stats multiplier key.
const MULT_FIELDS := {
	"strMultiplier": "STR", "skpMultiplier": "SKP", "stmMultiplier": "STM",
	"defMultiplier": "RES", "vitMultiplier": "VIT", "pwrMultiplier": "PWR",
	"eneMultiplier": "ENE", "speedMultiplier": "SPEED",
}

## Global tuning knob for `energyDrain * max_ki / 100` per second.
const DRAIN_MULT := 1.0
const MASTERY_TICK := 5.0            # passiveMasteryEveryFiveSeconds
const MIN_KI_TO_TRANSFORM := 0.1     # fraction of max ki

## Built-in definitions so the state machine (and the fx preview) run before the data
## engineer's data/forms.json exists. Registry data always wins.
const FALLBACK := {
	"ssgrades.supersaiyan": {
		"id": "ssgrades.supersaiyan", "name": "Super Saiyan", "race": "saiyan",
		"group": "ssgrades", "form_type": "superforms", "skill": "superforms",
		"unlockOnSkillLevel": 1, "transformationAnimation": "transf.generic",
		"hairType": "ssj", "hairColor": "#FFEDB3", "bodyColor2": "#FFEDB3",
		"eye1Color": "#00FFFF", "eye2Color": "#00FFFF",
		"auraType": "kakarot", "auraColor": "#FFD700", "extraAuraColor": "#FFFFFF",
		"hasLightnings": false, "lightningColor": "", "modelScaling": [0.9375, 0.9375, 0.9375],
		"strMultiplier": 1.5, "skpMultiplier": 1.5, "stmMultiplier": 1.0,
		"defMultiplier": 1.3125, "vitMultiplier": 1.0, "pwrMultiplier": 1.5,
		"eneMultiplier": 1.0, "speedMultiplier": 1.0, "energyDrain": 0.08,
		"healthDrain": 0.0, "maxMastery": 100.0, "masteryPerHitDealt": 0.04,
		"masteryPerHitReceived": 0.04, "passiveMasteryEveryFiveSeconds": 0.006,
		"maxCostMultiplier": 0.75, "stackOnMastery": 25.0, "instantTransformOnMastery": 40.0,
		"formStackable": true, "stackDrainMultiplier": 2.0, "incompatibleWith": [""],
		"shareMasteryWith": [], "formRequisite": "", "unlock_tp_cost": 0, "model_override": "",
	},
	"ssgrades.supersaiyan2": {
		"id": "ssgrades.supersaiyan2", "name": "Super Saiyan 2", "race": "saiyan",
		"group": "ssgrades", "form_type": "superforms", "skill": "superforms",
		"unlockOnSkillLevel": 4, "transformationAnimation": "transf.generic",
		"hairType": "ssj2", "hairColor": "#FFEDB3", "bodyColor2": "#FFEDB3",
		"eye1Color": "#00FFFF", "auraColor": "#FFD700", "extraAuraColor": "#FFFFFF",
		"hasLightnings": true, "lightningColor": "#8AD8FF",
		"modelScaling": [0.9375, 0.9375, 0.9375],
		"strMultiplier": 2.25, "skpMultiplier": 2.25, "stmMultiplier": 1.0,
		"defMultiplier": 1.75, "vitMultiplier": 1.0, "pwrMultiplier": 2.25,
		"eneMultiplier": 1.0, "speedMultiplier": 1.1, "energyDrain": 0.16,
		"healthDrain": 0.0, "maxMastery": 100.0, "masteryPerHitDealt": 0.04,
		"masteryPerHitReceived": 0.04, "passiveMasteryEveryFiveSeconds": 0.006,
		"maxCostMultiplier": 0.75, "stackOnMastery": 25.0, "instantTransformOnMastery": 40.0,
		"formStackable": true, "stackDrainMultiplier": 2.0,
		"incompatibleWith": [""], "shareMasteryWith": [],
		"formRequisite": "ssgrades.supersaiyan", "formRequisiteType": "all",
		"unlockOnMastery": 25.0, "unlock_tp_cost": 0, "model_override": "",
	},
	"kaioken.x2": {
		"id": "kaioken.x2", "name": "Kaioken x2", "race": "any", "group": "kaioken",
		"form_type": "kaioken", "skill": "kaioken", "unlockOnSkillLevel": 1,
		"transformationAnimation": "transf.kaioken", "auraColor": "#FF2222",
		"extraAuraColor": "#FF8888", "hasLightnings": false, "tintColor": "#FF0000",
		"tintIntensity": 0.35, "modelScaling": [1.0, 1.0, 1.0],
		"strMultiplier": 1.3, "skpMultiplier": 1.3, "stmMultiplier": 1.0,
		"defMultiplier": 1.0, "vitMultiplier": 1.0, "pwrMultiplier": 1.3,
		"eneMultiplier": 1.0, "speedMultiplier": 1.15, "energyDrain": 0.2,
		"healthDrain": 0.35, "maxMastery": 100.0, "masteryPerHitDealt": 0.05,
		"masteryPerHitReceived": 0.05, "passiveMasteryEveryFiveSeconds": 0.004,
		"maxCostMultiplier": 0.7, "stackOnMastery": 0.0,
		"instantTransformOnMastery": 20.0, "formStackable": true,
		"stackDrainMultiplier": 2.0, "incompatibleWith": [""], "shareMasteryWith": [],
		"formRequisite": "", "unlock_tp_cost": 0, "model_override": "",
	},
	"oozaru.oozaru": {
		"id": "oozaru.oozaru", "name": "Oozaru", "race": "saiyan", "group": "oozaru",
		"form_type": "oozaru", "skill": "oozaru", "unlockOnSkillLevel": 1,
		"transformationAnimation": "transf.oozaru", "auraColor": "#B07A3A",
		"hasLightnings": false, "modelScaling": [3.0, 3.0, 3.0],
		"strMultiplier": 2.0, "skpMultiplier": 0.8, "stmMultiplier": 1.5,
		"defMultiplier": 1.6, "vitMultiplier": 2.0, "pwrMultiplier": 1.4,
		"eneMultiplier": 1.0, "speedMultiplier": 0.85, "energyDrain": 0.1,
		"healthDrain": 0.0, "maxMastery": 100.0, "masteryPerHitDealt": 0.02,
		"masteryPerHitReceived": 0.02, "passiveMasteryEveryFiveSeconds": 0.004,
		"maxCostMultiplier": 0.8, "formStackable": false, "stackDrainMultiplier": 1.0,
		"incompatibleWith": ["ssgrades.supersaiyan"], "shareMasteryWith": [],
		"formRequisite": "", "unlock_tp_cost": 0,
		"model_override": "entity/races/oozaru",
	},
}

var entity: Node = null
## Active form ids, innermost first (stacking pushes on the end).
var stack: Array[String] = []
var transforming := false

var _mastery_timer := 0.0
var _drain_error := 0.0

# --- access ---------------------------------------------------------------

static func get_for(entity_node: Node) -> Forms:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var n: Node = entity_node.get_node_or_null(NODE_NAME)
	if n is Forms:
		return n
	var f := Forms.new()
	f.name = NODE_NAME
	f.entity = entity_node
	entity_node.add_child(f)
	return f

static func find_on(entity_node: Node) -> Forms:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var n: Node = entity_node.get_node_or_null(NODE_NAME)
	return n if n is Forms else null

func _ready() -> void:
	if entity == null:
		entity = get_parent()
	var cur := String(entity.get("current_form")) if entity != null and "current_form" in entity else ""
	if cur != "" and stack.is_empty():
		stack.append(cur)
		_apply_multipliers()

# --- data ----------------------------------------------------------------

static func def(form_id: String) -> Dictionary:
	var d: Dictionary = Registry.form(form_id)
	if not d.is_empty():
		return d
	return FALLBACK.get(form_id, {})

static func mult_of(form_def: Dictionary, key: String) -> float:
	for field in MULT_FIELDS.keys():
		if MULT_FIELDS[field] == key:
			return float(form_def.get(field, 1.0))
	return 1.0

# --- unlocking -----------------------------------------------------------

static func is_unlocked(entity_node: Node, form_id: String) -> bool:
	if entity_node != null and entity_node.has_method("form_unlocked"):
		return bool(entity_node.call("form_unlocked", form_id))
	if Game != null and Game.player == entity_node:
		var f: Dictionary = Game.profile.get("forms", {})
		var arr: Array = f.get("unlocked", [])
		return arr.has(form_id)
	# NPCs and bosses get every form their entity definition lists
	if entity_node != null and "entity_type" in entity_node:
		var e: Dictionary = Registry.entity(String(entity_node.get("entity_type")))
		var forms: Array = e.get("forms", [])
		if forms.has(form_id):
			return true
	return true

## TP price of unlocking a form (`unlock_tp_cost`, negative = quest reward only).
static func unlock_cost(form_id: String) -> int:
	return int(def(form_id).get("unlock_tp_cost", 0))

## Requirements for *unlocking* a form: skill level, prerequisite form, mastery.
static func can_unlock(entity_node: Node, form_id: String) -> Dictionary:
	var d := def(form_id)
	if d.is_empty():
		return {"ok": false, "reason": "unknown form"}
	if is_unlocked(entity_node, form_id):
		return {"ok": false, "reason": "already unlocked"}
	var skill_id := String(d.get("skill", d.get("form_type", "")))
	var need_level := int(d.get("unlockOnSkillLevel", 1))
	if skill_id != "" and Skills.level(entity_node, skill_id) < need_level:
		return {"ok": false, "reason": "%s level %d required" % [skill_id, need_level]}
	var req := String(d.get("formRequisite", ""))
	if req != "" and not is_unlocked(entity_node, req):
		return {"ok": false, "reason": "requires " + req}
	var need_mastery := float(d.get("unlockOnMastery", 0.0))
	if req != "" and need_mastery > 0.0 and mastery(entity_node, req) < need_mastery:
		return {"ok": false, "reason": "%s mastery %.0f%% required" % [req, need_mastery]}
	if int(d.get("unlock_tp_cost", 0)) < 0:
		return {"ok": false, "reason": "unlocked by a quest"}
	return {"ok": true, "reason": ""}

## Mark a form unlocked (Training.unlock_form pays the TP).
static func unlock(entity_node: Node, form_id: String) -> bool:
	if def(form_id).is_empty():
		return false
	if entity_node != null and entity_node.has_method("unlock_form"):
		return bool(entity_node.call("unlock_form", form_id))
	if Game != null and Game.player == entity_node:
		var f: Dictionary = Game.profile.get("forms", {"unlocked": [], "mastery": {}})
		var arr: Array = f.get("unlocked", [])
		if not arr.has(form_id):
			arr.append(form_id)
		f["unlocked"] = arr
		Game.profile["forms"] = f
		return true
	return true

# --- mastery -------------------------------------------------------------

static func mastery(entity_node: Node, form_id: String) -> float:
	if entity_node != null and entity_node.has_method("form_mastery"):
		return float(entity_node.call("form_mastery", form_id))
	if Game != null and Game.player == entity_node:
		return float(Game.profile.get("forms", {}).get("mastery", {}).get(form_id, 0.0))
	return 100.0     # NPCs are masters of their own forms

static func set_mastery(entity_node: Node, form_id: String, value: float) -> void:
	var cap := float(def(form_id).get("maxMastery", 100.0))
	var v := clampf(value, 0.0, cap)
	if entity_node != null and entity_node.has_method("set_form_mastery"):
		entity_node.call("set_form_mastery", form_id, v)
		return
	if Game != null and Game.player == entity_node:
		var f: Dictionary = Game.profile.get("forms", {"unlocked": [], "mastery": {}})
		var m: Dictionary = f.get("mastery", {})
		m[form_id] = v
		f["mastery"] = m
		Game.profile["forms"] = f

## Add mastery to a form and to every form in `shareMasteryWith`.
static func add_mastery(entity_node: Node, form_id: String, amount: float) -> void:
	if amount <= 0.0:
		return
	set_mastery(entity_node, form_id, mastery(entity_node, form_id) + amount)
	var d := def(form_id)
	var share: Array = d.get("shareMasteryWith", [])
	var factor := float(d.get("shareMasteryMultiplier", 1.0))
	for other in share:
		var oid := String(other)
		if oid != "" and oid != form_id:
			set_mastery(entity_node, oid, mastery(entity_node, oid) + amount * factor)

static func mastery_fraction(entity_node: Node, form_id: String) -> float:
	var cap := float(def(form_id).get("maxMastery", 100.0))
	if cap <= 0.0:
		return 1.0
	return clampf(mastery(entity_node, form_id) / cap, 0.0, 1.0)

# --- checks --------------------------------------------------------------

## Everything that has to be true before transforming. Returns {ok, reason}.
static func can_transform(entity_node: Node, form_id: String) -> Dictionary:
	var d := def(form_id)
	if d.is_empty():
		return {"ok": false, "reason": "unknown form"}
	if not is_unlocked(entity_node, form_id):
		return {"ok": false, "reason": "form not unlocked"}
	var f := find_on(entity_node)
	if f != null:
		if f.transforming:
			return {"ok": false, "reason": "already transforming"}
		if f.stack.has(form_id):
			return {"ok": false, "reason": "already active"}
		if not f.stack.is_empty():
			# stacking rules
			if not bool(d.get("formStackable", false)):
				# a non-stackable form replaces the stack, which is allowed
				pass
			var need := float(d.get("stackOnMastery", 0.0))
			if bool(d.get("formStackable", false)) and need > 0.0 and mastery(entity_node, form_id) < need:
				return {"ok": false, "reason": "needs %.0f%% mastery to stack" % need}
			for active_id in f.stack:
				if _incompatible(active_id, form_id) or _incompatible(form_id, active_id):
					return {"ok": false, "reason": "incompatible with " + active_id}
	var k := Ki.find_on(entity_node)
	if k != null and k.ki_fraction() < MIN_KI_TO_TRANSFORM:
		return {"ok": false, "reason": "not enough ki"}
	var req := String(d.get("formRequisite", ""))
	if req != "" and f != null and String(d.get("formRequisiteType", "all")) == "active" and not f.stack.has(req):
		return {"ok": false, "reason": "requires " + req + " active"}
	return {"ok": true, "reason": ""}

static func _incompatible(a: String, b: String) -> bool:
	var list: Array = def(a).get("incompatibleWith", [])
	for x in list:
		if String(x) != "" and String(x) == b:
			return true
	return false

## True when mastery is high enough to skip the cinematic.
static func is_instant(entity_node: Node, form_id: String) -> bool:
	var need := float(def(form_id).get("instantTransformOnMastery", 0.0))
	return need > 0.0 and mastery(entity_node, form_id) >= need

# --- transform / revert ---------------------------------------------------

## Transform `entity_node` into `form_id`. Plays the cinematic (or the instant flash
## when the form is mastered) and then applies the multipliers. Returns false with a
## reason logged when `can_transform` says no.
static func transform(entity_node: Node, form_id: String, force_instant := false) -> bool:
	var check := can_transform(entity_node, form_id)
	if not bool(check["ok"]):
		if Game != null and Game.player == entity_node:
			Audio.play_sfx("no_ki_form")
			if Game.ui != null and Game.ui.has_method("show_hint"):
				Game.ui.call("show_hint", String(check["reason"]), 2.0)
		return false
	var f := get_for(entity_node)
	return f.begin_transform(form_id, force_instant or is_instant(entity_node, form_id))

static func revert(entity_node: Node) -> void:
	var f := find_on(entity_node)
	if f != null:
		f.pop_form()

static func revert_all(entity_node: Node) -> void:
	var f := find_on(entity_node)
	if f != null:
		f.clear_forms()

static func active(entity_node: Node) -> Array[String]:
	var f := find_on(entity_node)
	return f.stack.duplicate() if f != null else [] as Array[String]

static func current(entity_node: Node) -> String:
	var f := find_on(entity_node)
	if f == null or f.stack.is_empty():
		return ""
	return f.stack[-1]

# --- instance -------------------------------------------------------------

func begin_transform(form_id: String, instant := false) -> bool:
	var d := def(form_id)
	if d.is_empty():
		return false
	transforming = true
	var stacking := not stack.is_empty() and bool(d.get("formStackable", false))
	if not stack.is_empty() and not stacking:
		# a non-stackable form replaces whatever is active
		clear_forms(false)
	if instant:
		Audio.play_sfx_at("insta_form_on", _pos())
		_finish_transform(form_id, stacking)
		return true
	if stacking:
		Audio.play_sfx_at("stack_form", _pos())
	TransformationDirector.play_for(entity, form_id, func() -> void:
		_finish_transform(form_id, stacking))
	return true

func _finish_transform(form_id: String, stacking: bool) -> void:
	transforming = false
	if not stack.has(form_id):
		stack.append(form_id)
	_apply_multipliers()
	_apply_visuals(form_id)
	if entity != null and "current_form" in entity:
		entity.set("current_form", form_id)
	if Game != null and Game.player == entity:
		var fp: Dictionary = Game.profile.get("forms", {})
		fp["current"] = form_id
		Game.profile["forms"] = fp
	Events.form_changed.emit(entity, form_id)
	Events.transformation_finished.emit(entity, form_id)

## Remove the outermost form.
func pop_form() -> void:
	if stack.is_empty():
		return
	var gone: String = stack.pop_back()
	# fx hook: the power-down flare (plays the transform_off sound itself)
	TransformationDirector.revert_flash(entity, gone)
	_apply_multipliers()
	_apply_visuals(stack[-1] if not stack.is_empty() else "")
	if entity != null and "current_form" in entity:
		entity.set("current_form", stack[-1] if not stack.is_empty() else "")
	Events.form_changed.emit(entity, stack[-1] if not stack.is_empty() else "")

func clear_forms(sound := true) -> void:
	if stack.is_empty():
		return
	var last: String = stack[-1]
	stack.clear()
	if sound:
		TransformationDirector.revert_flash(entity, last)
	_apply_multipliers()
	_apply_visuals("")
	if entity != null and "current_form" in entity:
		entity.set("current_form", "")
	Events.form_changed.emit(entity, "")

# --- multipliers / visuals ------------------------------------------------

## Product of every active form's multipliers, pushed into the entity's Stats.
func combined_multipliers() -> Dictionary:
	var out := {"STR": 1.0, "SKP": 1.0, "STM": 1.0, "RES": 1.0, "VIT": 1.0, "PWR": 1.0, "ENE": 1.0, "SPEED": 1.0}
	for form_id in stack:
		var d := def(form_id)
		for field in MULT_FIELDS.keys():
			var key: String = MULT_FIELDS[field]
			out[key] = float(out[key]) * float(d.get(field, 1.0))
	return out

func _apply_multipliers() -> void:
	var s: Variant = entity.get("stats") if entity != null and "stats" in entity else null
	if s is Stats:
		(s as Stats).set_form_multipliers(combined_multipliers())
	if entity != null and entity.has_method("refresh_derived"):
		entity.call("refresh_derived")
	if Game != null and Game.player == entity:
		Events.stats_changed.emit()

func _apply_visuals(form_id: String) -> void:
	var d := def(form_id) if form_id != "" else {}
	var aura := Aura.get_for(entity)
	if aura != null:
		aura.set_form(d)
	# RaceSkin recomposes hair/eyes/body and the model scale itself; only do it by
	# hand when the entity engineer's skin composer is not available.
	if not _race_skin_visuals(d):
		_apply_model_scale(d)
		_modulate_fallback(d)
	_apply_model_override(d)

func _apply_model_scale(d: Dictionary) -> void:
	var target: Variant = entity.get("model") if entity != null and "model" in entity else null
	var node: Node3D = target if target is Node3D else (entity as Node3D if entity is Node3D else null)
	if node == null:
		return
	var sc: Variant = d.get("modelScaling", null)
	var v := Vector3.ONE
	if sc is Array and (sc as Array).size() >= 3:
		v = Vector3(float(sc[0]), float(sc[1]), float(sc[2]))
	var base := 1.0
	if entity != null and "base_scale" in entity:
		base = float(entity.get("base_scale"))
	node.scale = v * base

func _apply_model_override(d: Dictionary) -> void:
	var mo := String(d.get("model_override", ""))
	if entity != null and entity.has_method("set_model_override"):
		entity.call("set_model_override", mo)

## Ask the entity engineer's RaceSkin to recompose the skin (hair/eyes/body colours
## and the model scale): `RaceSkin.apply_form_visuals(model: BedrockModel, form_def)`.
## Loaded dynamically and duck-typed so this file also works with a stub model
## (FxDummy in the tests / the fx preview) or before scripts/entity/ exists.
func _race_skin_visuals(d: Dictionary) -> bool:
	const PATH := "res://scripts/entity/RaceSkin.gd"
	if d.is_empty() or entity == null or not ResourceLoader.exists(PATH):
		return false
	var m: Variant = entity.get("model") if "model" in entity else null
	if not (m is Node) or not (m as Node).has_method("get_bone") or not (m as Node).has_method("set_model_scale"):
		return false
	var script: Variant = load(PATH)
	if script == null:
		return false
	var has := false
	for meth in (script as Script).get_script_method_list():
		if String(meth["name"]) == "apply_form_visuals":
			has = true
			break
	if not has:
		return false
	script.call("apply_form_visuals", m, _race_skin_args(d))
	return true

## RaceSkin reads `modelScaling` as a single float while forms.json stores a vector;
## hand it a normalised copy so both sides keep their own schema.
func _race_skin_args(d: Dictionary) -> Dictionary:
	var out := d.duplicate()
	var sc: Variant = d.get("modelScaling", null)
	if sc is Array and (sc as Array).size() >= 2:
		out["modelScaling"] = maxf(float(sc[0]), float(sc[1]))
	elif not (sc is float or sc is int):
		out["modelScaling"] = 1.0
	return out

## No RaceSkin yet: tint the model with the form's hair/body colour so the change reads.
func _modulate_fallback(d: Dictionary) -> void:
	var target: Variant = entity.get("model") if entity != null and "model" in entity else null
	var node: Node3D = target if target is Node3D else null
	if node == null:
		return
	var c := Color(1, 1, 1)
	var hc := String(d.get("hairColor", ""))
	var bc := String(d.get("bodyColor2", ""))
	if hc != "":
		c = Color(hc).lightened(0.15)
	elif bc != "":
		c = Color(bc)
	_modulate_recursive(node, c)

func _modulate_recursive(node: Node, c: Color) -> void:
	if node is GeometryInstance3D:
		(node as GeometryInstance3D).set_instance_shader_parameter("form_tint", c)
		if node is MeshInstance3D:
			var mi := node as MeshInstance3D
			var m: Variant = mi.get_active_material(0)
			if m is StandardMaterial3D:
				var dup: StandardMaterial3D = (m as StandardMaterial3D).duplicate()
				dup.albedo_color = c
				mi.material_override = dup
	for ch in node.get_children():
		_modulate_recursive(ch, c)

# --- drain / mastery per frame --------------------------------------------

## Ki drained per second by the whole stack: energyDrain * max_ki / 100, reduced by
## mastery (down to `maxCostMultiplier`) and multiplied by `stackDrainMultiplier`
## for every form above the first.
func drain_per_second() -> float:
	if stack.is_empty():
		return 0.0
	var k := Ki.find_on(entity)
	var max_ki := k.max_ki() if k != null else 100.0
	var total := 0.0
	for i in stack.size():
		var form_id: String = stack[i]
		var d := def(form_id)
		var base := float(d.get("energyDrain", 0.0)) * max_ki / 100.0 * DRAIN_MULT
		var frac := mastery_fraction(entity, form_id)
		var cost_mult: float = lerpf(1.0, float(d.get("maxCostMultiplier", 1.0)), frac)
		var stack_mult := 1.0 if i == 0 else float(d.get("stackDrainMultiplier", 1.0))
		total += base * cost_mult * stack_mult
	return total

func health_drain_per_second() -> float:
	var total := 0.0
	for form_id in stack:
		total += float(def(form_id).get("healthDrain", 0.0))
	return total

func _process(delta: float) -> void:
	if entity == null or not is_instance_valid(entity):
		queue_free()
		return
	if stack.is_empty() or transforming:
		return
	if Game != null and Game.paused_by_ui:
		return
	var k := Ki.find_on(entity)
	if k != null:
		var cost := drain_per_second() * delta
		if cost > 0.0:
			if k.ki() <= cost:
				k.set_ki(0.0)
				Audio.play_sfx_at("no_ki_form", _pos())
				clear_forms()
				return
			k.set_ki(k.ki() - cost)
	var hd := health_drain_per_second() * delta
	if hd > 0.0 and entity.has_method("take_damage"):
		entity.call("take_damage", hd, entity, Damage.KI, Vector3.ZERO)
	_mastery_timer += delta
	if _mastery_timer >= MASTERY_TICK:
		_mastery_timer -= MASTERY_TICK
		for form_id in stack:
			add_mastery(entity, form_id, float(def(form_id).get("passiveMasteryEveryFiveSeconds", 0.0)))

## Mastery from combat; called by Training / Damage hooks.
func on_hit_dealt() -> void:
	for form_id in stack:
		add_mastery(entity, form_id, float(def(form_id).get("masteryPerHitDealt", 0.0)))

func on_hit_received() -> void:
	for form_id in stack:
		add_mastery(entity, form_id, float(def(form_id).get("masteryPerHitReceived", 0.0)))

func _pos() -> Vector3:
	return (entity as Node3D).global_position if entity is Node3D and entity.is_inside_tree() else Vector3.ZERO
