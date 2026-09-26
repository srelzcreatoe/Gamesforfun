class_name PlayerStats
extends RefCounted
## Survival layer of the player: hunger, oxygen, health regeneration, starvation and fall
## damage (docs/CUBIC_WORLD_UI_SPEC.md §4). The RPG stats themselves live in
## `scripts/combat/Stats.gd` on `Player.stats`; TP goes through `scripts/combat/Training.gd`.

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

func load_profile(profile: Dictionary) -> void:
	hunger = clampf(float(profile.get("hunger", HUNGER_MAX)), 0.0, HUNGER_MAX)
	oxygen = clampf(float(profile.get("oxygen", OXYGEN_MAX)), 0.0, OXYGEN_MAX)
	Events.hunger_changed.emit(hunger, HUNGER_MAX)
	Events.oxygen_changed.emit(oxygen, OXYGEN_MAX)

func write_profile(profile: Dictionary) -> void:
	profile["hunger"] = hunger
	profile["oxygen"] = oxygen

# --- survival tick ---------------------------------------------------------

## `speed` = horizontal speed in m/s, `sprinting` = sprint mode active,
## `head_in_liquid` = the eye is inside a liquid block, `has_oxygen` = the planet has air.
func tick(delta: float, speed: float, sprinting: bool, head_in_liquid: bool, has_oxygen: bool) -> void:
	if iframe > 0.0:
		iframe = maxf(0.0, iframe - delta)
	var rate := EXHAUST_IDLE
	if sprinting and speed > 0.1:
		rate = EXHAUST_SPRINT
	elif speed > 0.1:
		rate = EXHAUST_MOVE
	exhaustion += rate * delta
	while exhaustion >= EXHAUST_PER_HUNGER:
		exhaustion -= EXHAUST_PER_HUNGER
		set_hunger(hunger - 1.0)
	var drowning := head_in_liquid or not has_oxygen
	if drowning:
		oxygen = maxf(0.0, oxygen - delta)
		if oxygen <= 0.0:
			_drown_t += delta
			if _drown_t >= DROWN_INTERVAL:
				_drown_t = 0.0
				hurt(DROWN_DAMAGE, "drown")
	else:
		if oxygen < OXYGEN_MAX:
			oxygen = minf(OXYGEN_MAX, oxygen + OXYGEN_REFILL * delta)
		_drown_t = 0.0
	Events.oxygen_changed.emit(oxygen, OXYGEN_MAX)
	if owner_node == null:
		return
	var hp := float(owner_node.get("health"))
	var hp_max := float(owner_node.get("max_health"))
	if hunger >= REGEN_HUNGER and hp < hp_max:
		_regen_t += delta
		if _regen_t >= regen_interval():
			_regen_t = 0.0
			exhaustion += 0.6
			owner_node.call("heal", regen_amount())
	else:
		_regen_t = 0.0
	if hunger <= 0.0 and hp > STARVE_FLOOR:
		_starve_t += delta
		if _starve_t >= STARVE_INTERVAL:
			_starve_t = 0.0
			hurt(1.0, "starve")
	else:
		_starve_t = 0.0

## Health regeneration speeds up with the class/race health_regen from Stats when available.
func regen_interval() -> float:
	return REGEN_INTERVAL

func regen_amount() -> float:
	if owner_node != null:
		var st: Variant = owner_node.get("stats")
		if st != null and st.has_method("health_regen"):
			return maxf(1.0, float(st.call("health_regen")) * REGEN_INTERVAL)
	return 1.0

func set_hunger(v: float) -> void:
	var n := clampf(v, 0.0, HUNGER_MAX)
	if absf(n - hunger) > 0.001:
		hunger = n
		Events.hunger_changed.emit(hunger, HUNGER_MAX)

func hunger_fraction() -> float:
	return hunger / HUNGER_MAX

func eat(food: Dictionary) -> void:
	set_hunger(hunger + float(food.get("hunger", 4)))
	if owner_node == null:
		return
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
			var dmg := fall_damage(fall_start_y - y)
			if dmg > 0.0:
				hurt(dmg, "fall")
				UiUtil.vibrate(50)
		fall_start_y = y
		return
	if not falling:
		falling = true
		fall_start_y = y
	else:
		fall_start_y = maxf(fall_start_y, y)

## Cubic World spec §4: `fall > 3.4` -> int((fall - 3.4) * 0.9).
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

func hurt(amount: float, kind: String) -> void:
	if owner_node == null or iframe > 0.0:
		return
	iframe = IFRAME
	owner_node.call("take_damage", amount, null, kind)
