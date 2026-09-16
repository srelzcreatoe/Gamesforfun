class_name PlayerStats
extends RefCounted
## Survival layer of the player: hunger, oxygen, regeneration, starvation, fall damage and the
## bridge to the RPG stats in scripts/combat/Stats.gd (loaded dynamically because the combat
## engineer writes it in parallel). Constants: docs/CUBIC_WORLD_UI_SPEC.md §4.

const COMBAT_STATS := "res://scripts/combat/Stats.gd"

const HUNGER_MAX := 20.0
const OXYGEN_MAX := 10.0
const OXYGEN_REFILL := 3.0
const DROWN_DAMAGE := 2.0
const DROWN_INTERVAL := 1.5
const EXHAUST_SPRINT := 0.045
const EXHAUST_MOVE := 0.012
const EXHAUST_IDLE := 0.003
const EXHAUST_PER_HUNGER := 4.0
const REGEN_HUNGER := 16.0
const REGEN_INTERVAL := 3.5
const STARVE_INTERVAL := 4.0
const STARVE_FLOOR := 4.0
const FALL_SAFE := 3.4
const FALL_MULT := 0.9
const IFRAME := 0.6

var owner_node: Node = null
var combat: RefCounted = null            # scripts/combat/Stats.gd instance when available
var raw: Dictionary = {"STR": 5, "SKP": 5, "STM": 5, "RES": 5, "VIT": 5, "PWR": 5, "ENE": 5}
var tp: int = 0
var tp_total: int = 0

var hunger: float = HUNGER_MAX
var oxygen: float = OXYGEN_MAX
var exhaustion: float = 0.0
var iframe: float = 0.0
var fall_start_y: float = 0.0
var falling := false

var _regen_t := 0.0
var _starve_t := 0.0
var _drown_t := 0.0

func _init(node: Node = null) -> void:
	owner_node = node

# --- RPG stats -------------------------------------------------------------

func load_profile(profile: Dictionary) -> void:
	var s: Dictionary = profile.get("stats", {})
	for k in raw.keys():
		raw[k] = int(s.get(k, raw[k]))
	tp = int(profile.get("tp", 0))
	tp_total = int(profile.get("tp_total", 0))
	hunger = clampf(float(profile.get("hunger", HUNGER_MAX)), 0.0, HUNGER_MAX)
	oxygen = clampf(float(profile.get("oxygen", OXYGEN_MAX)), 0.0, OXYGEN_MAX)
	_make_combat(profile)

func write_profile(profile: Dictionary) -> void:
	profile["stats"] = raw.duplicate()
	profile["tp"] = tp
	profile["tp_total"] = tp_total
	profile["hunger"] = hunger
	profile["oxygen"] = oxygen

func _make_combat(profile: Dictionary) -> void:
	combat = null
	if not ResourceLoader.exists(COMBAT_STATS):
		return
	var script: GDScript = load(COMBAT_STATS)
	if script == null:
		return
	var inst: Variant = script.new()
	if inst is RefCounted:
		combat = inst
		for m in ["load_profile", "from_profile", "apply_profile"]:
			if combat.has_method(m):
				combat.call(m, profile)
				break
		for k in raw.keys():
			if combat.get(k) != null:
				combat.set(k, raw[k])

func stat(key: String) -> int:
	if combat != null and combat.get(key) != null:
		return int(combat.get(key))
	return int(raw.get(key, 5))

func level() -> int:
	if combat != null and combat.has_method("level"):
		return int(combat.call("level"))
	var total := 0
	for k in raw.keys():
		total += int(raw[k])
	return 1 + total / 5

func derived(key: String, fallback: float) -> float:
	if combat != null:
		if combat.has_method(key):
			return float(combat.call(key))
		if combat.get(key) != null:
			return float(combat.get(key))
	match key:
		"max_health": return 100.0 + float(stat("VIT")) * 10.0
		"max_ki": return 100.0 + float(stat("ENE")) * 8.0
		"max_stamina": return 100.0 + float(stat("STM")) * 6.0
		"melee": return 5.0 + float(stat("STR")) * 1.2
		"ki_damage": return 5.0 + float(stat("PWR")) * 1.4
		"defense": return float(stat("RES")) * 0.9
		"speed_mult": return 1.0
	return fallback

## Spend TP on one attribute. Returns true when the raise happened.
func raise(key: String) -> bool:
	if not raw.has(key):
		return false
	var cost := tp_cost(key)
	if tp < cost:
		return false
	tp -= cost
	raw[key] = int(raw[key]) + 1
	if combat != null and combat.get(key) != null:
		combat.set(key, raw[key])
	if combat != null and combat.has_method("raise"):
		pass
	Events.stats_changed.emit()
	Events.tp_changed.emit(tp, tp_total)
	return true

func tp_cost(key: String) -> int:
	return 10 + int(raw.get(key, 5)) * 5

func add_tp(amount: int) -> void:
	if amount <= 0:
		return
	var before := level()
	tp += amount
	tp_total += amount
	Events.tp_changed.emit(tp, tp_total)
	if level() > before:
		Events.level_up.emit(level())

# --- survival tick ---------------------------------------------------------

## `speed` is the horizontal speed in m/s, `sprinting` whether the sprint mode is active,
## `head_in_liquid` whether the eye is inside a liquid block.
func tick(delta: float, speed: float, sprinting: bool, head_in_liquid: bool, has_oxygen: bool) -> void:
	if iframe > 0.0:
		iframe = maxf(0.0, iframe - delta)
	# exhaustion -> hunger
	var rate := EXHAUST_IDLE
	if sprinting and speed > 0.1:
		rate = EXHAUST_SPRINT
	elif speed > 0.1:
		rate = EXHAUST_MOVE
	exhaustion += rate * delta
	while exhaustion >= EXHAUST_PER_HUNGER:
		exhaustion -= EXHAUST_PER_HUNGER
		set_hunger(hunger - 1.0)
	# oxygen
	var drowning := head_in_liquid or not has_oxygen
	if drowning:
		oxygen = maxf(0.0, oxygen - delta)
		if oxygen <= 0.0:
			_drown_t += delta
			if _drown_t >= DROWN_INTERVAL:
				_drown_t = 0.0
				_hurt(DROWN_DAMAGE, "drown")
	else:
		if oxygen < OXYGEN_MAX:
			oxygen = minf(OXYGEN_MAX, oxygen + OXYGEN_REFILL * delta)
		_drown_t = 0.0
	Events.oxygen_changed.emit(oxygen, OXYGEN_MAX)
	# regeneration / starvation
	if owner_node == null:
		return
	var hp := float(owner_node.get("health"))
	var hp_max := float(owner_node.get("max_health"))
	if hunger >= REGEN_HUNGER and hp < hp_max:
		_regen_t += delta
		if _regen_t >= REGEN_INTERVAL:
			_regen_t = 0.0
			exhaustion += 0.6
			owner_node.call("heal", 1.0)
	else:
		_regen_t = 0.0
	if hunger <= 0.0 and hp > STARVE_FLOOR:
		_starve_t += delta
		if _starve_t >= STARVE_INTERVAL:
			_starve_t = 0.0
			_hurt(1.0, "starve")
	else:
		_starve_t = 0.0

func set_hunger(v: float) -> void:
	var n := clampf(v, 0.0, HUNGER_MAX)
	if absf(n - hunger) > 0.001:
		hunger = n
		Events.hunger_changed.emit(hunger, HUNGER_MAX)

func eat(food: Dictionary) -> void:
	set_hunger(hunger + float(food.get("hunger", 4)))
	if owner_node != null:
		if food.has("heal"):
			owner_node.call("heal", float(food["heal"]))
		if food.has("ki"):
			owner_node.set("ki", minf(float(owner_node.get("max_ki")), float(owner_node.get("ki")) + float(food["ki"])))
		if food.has("stamina"):
			owner_node.set("stamina", minf(float(owner_node.get("max_stamina")), float(owner_node.get("stamina")) + float(food["stamina"])))

# --- fall damage -----------------------------------------------------------

func note_airborne(y: float, on_ground: bool, flying: bool, in_liquid: bool) -> void:
	if on_ground or flying or in_liquid:
		if falling:
			falling = false
			var fall := fall_start_y - y
			var dmg := fall_damage(fall)
			if dmg > 0.0:
				_hurt(dmg, "fall")
				UiUtil.vibrate(50)
		fall_start_y = y
		return
	if not falling:
		falling = true
		fall_start_y = y
	else:
		fall_start_y = maxf(fall_start_y, y)

## Cubic World spec §4: `fall > 3.4` -> int((fall - 3.4) * 0.9), scaled by difficulty.
static func fall_damage_raw(fall: float) -> float:
	if fall <= FALL_SAFE:
		return 0.0
	return float(int((fall - FALL_SAFE) * FALL_MULT))

func fall_damage(fall: float) -> float:
	var d := fall_damage_raw(fall)
	if d <= 0.0:
		return 0.0
	var mult := 1.0
	if Game != null:
		match Game.world_info.get("difficulty", "normal"):
			"easy": mult = 0.6
			"hard": mult = 1.4
	return d * mult

func _hurt(amount: float, kind: String) -> void:
	if owner_node == null or iframe > 0.0:
		return
	iframe = IFRAME
	owner_node.call("take_damage", amount, null, kind)
