class_name Ki
extends Node
## Per-entity ki / stamina pool driver (docs/ARCHITECTURE.md §8).
##
## One `Ki` node is attached as a child of every entity that uses ki; get it with
## `Ki.get_for(entity)`. It owns passive regeneration, hold-to-charge, the power
## release slider and every ki/stamina cost helper. The pools themselves live on
## the entity (`ki`, `max_ki`, `stamina`, `max_stamina`) so the entity engineer's
## code and the HUD keep reading the same fields.

const NODE_NAME := "KiSystem"

## Hold-to-charge: +12 % of max ki per second, multiplied by the ki_control level.
const CHARGE_PER_SECOND := 0.12
const CHARGE_LOOP_KEY := "ki_charge"
const CHARGE_SOUND := "ki_charge_loop"

## Stamina costs.
const MELEE_STAMINA := 6.0
const DASH_STAMINA := 14.0
const FLY_FAST_STAMINA_PER_SEC := 9.0
const BLOCK_STAMINA_PER_SEC := 12.0

## Power release: 10 % .. 100 % (potential_unlock raises the cap above 100 %).
const RELEASE_MIN := 0.1
const RELEASE_MAX := 1.0
## Passive regeneration is best at a low release: regen *= (RELEASE_REGEN_BIAS - release).
const RELEASE_REGEN_BIAS := 1.35

var entity: Node = null
var charging := false
var charge_time := 0.0
## Ki gained during the current charge (drives the aura growth).
var charged_amount := 0.0
var power_release := 1.0
var stamina_locked := 0.0           # seconds of stamina regen delay after a spend
var _was_charging := false
var _regen_accum := 0.0

# --- access ---------------------------------------------------------------

## Fetch (or lazily create) the Ki node of an entity. Returns null for a null entity.
static func get_for(entity_node: Node) -> Ki:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var existing: Node = entity_node.get_node_or_null(NODE_NAME)
	if existing is Ki:
		return existing
	var k := Ki.new()
	k.name = NODE_NAME
	k.entity = entity_node
	entity_node.add_child(k)
	return k

static func of(entity_node: Node) -> Ki:
	return get_for(entity_node)

## Non-creating lookup: null when the entity has no ki system yet.
static func find_on(entity_node: Node) -> Ki:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var n: Node = entity_node.get_node_or_null(NODE_NAME)
	return n if n is Ki else null

func _ready() -> void:
	if entity == null:
		entity = get_parent()
	if entity != null and "power_release" in entity:
		power_release = clampf(float(entity.get("power_release")), RELEASE_MIN, 2.0)
	_sync_release()

# --- pools ----------------------------------------------------------------

func stats() -> Stats:
	if entity != null and "stats" in entity:
		var v: Variant = entity.get("stats")
		if v is Stats:
			return v
	return null

func max_ki() -> float:
	var s := stats()
	if s != null:
		return s.max_ki()
	if entity != null and "max_ki" in entity:
		return maxf(1.0, float(entity.get("max_ki")))
	return 100.0

func ki() -> float:
	if entity != null and "ki" in entity:
		return float(entity.get("ki"))
	return 0.0

func set_ki(v: float) -> void:
	var m := max_ki()
	var nv := clampf(v, 0.0, m)
	if entity != null and "ki" in entity:
		entity.set("ki", nv)
	if _is_player():
		Events.ki_changed.emit(nv, m)

func ki_fraction() -> float:
	return ki() / maxf(1.0, max_ki())

func max_stamina() -> float:
	var s := stats()
	if s != null:
		return s.max_stamina()
	if entity != null and "max_stamina" in entity:
		return maxf(1.0, float(entity.get("max_stamina")))
	return 100.0

func stamina() -> float:
	if entity != null and "stamina" in entity:
		return float(entity.get("stamina"))
	return 0.0

func set_stamina(v: float) -> void:
	var m := max_stamina()
	var nv := clampf(v, 0.0, m)
	if entity != null and "stamina" in entity:
		entity.set("stamina", nv)
	if _is_player():
		Events.stamina_changed.emit(nv, m)

# --- costs ----------------------------------------------------------------

## Ki cost of a technique: techniques.json `ki_cost` is a fraction of max ki.
func cost_of(fraction: float) -> float:
	return maxf(0.0, fraction) * max_ki()

func can_spend(amount: float) -> bool:
	return ki() >= amount - 0.001

func spend(amount: float) -> bool:
	if amount <= 0.0:
		return true
	if not can_spend(amount):
		return false
	set_ki(ki() - amount)
	return true

## Spend a fraction of max ki (technique costs).
func spend_fraction(fraction: float) -> bool:
	return spend(cost_of(fraction))

func add_ki(amount: float) -> void:
	set_ki(ki() + amount)

func can_spend_stamina(amount: float) -> bool:
	return stamina() >= amount - 0.001

func spend_stamina(amount: float) -> bool:
	if amount <= 0.0:
		return true
	if not can_spend_stamina(amount):
		return false
	set_stamina(stamina() - amount)
	stamina_locked = 0.8
	return true

func drain_stamina(amount: float) -> void:
	set_stamina(stamina() - amount)
	stamina_locked = 0.5

# --- power release --------------------------------------------------------

## Maximum release fraction; the potential_unlock skill pushes it past 100 %.
func release_cap() -> float:
	return Skills.release_cap(entity)

func set_power_release(f: float) -> void:
	power_release = clampf(f, RELEASE_MIN, release_cap())
	_sync_release()

func _sync_release() -> void:
	var s := stats()
	if s != null:
		s.power_release = power_release
	if entity != null and "power_release" in entity:
		entity.set("power_release", power_release)
	if _is_player():
		Events.stats_changed.emit()
	var aura := Aura.find_on(entity)
	if aura != null:
		aura.refresh()

# --- charging -------------------------------------------------------------

## Charge rate in ki per second (12 % of max ki × ki_control level).
func charge_rate() -> float:
	var lvl := maxi(1, Skills.level(entity, "ki_control"))
	return CHARGE_PER_SECOND * max_ki() * float(lvl) * (1.0 + 0.25 * Skills.level(entity, "ki_boost"))

func set_charging(on: bool) -> void:
	if on == charging:
		return
	charging = on
	if on:
		charge_time = 0.0
		charged_amount = 0.0
		if _is_local_audio():
			Audio.play_loop(CHARGE_SOUND, CHARGE_LOOP_KEY)
		if entity != null and entity.has_method("play_anim"):
			entity.call("play_anim", "ki.charge", 0.15, true)
	else:
		if _is_local_audio():
			Audio.stop_loop(CHARGE_LOOP_KEY, 0.25)
	Events.ki_charge_changed.emit(entity, on)
	var aura := Aura.get_for(entity)
	if aura != null:
		aura.set_charging(on)

func is_charging() -> bool:
	return charging

func _process(delta: float) -> void:
	if entity == null or not is_instance_valid(entity):
		queue_free()
		return
	if Game != null and Game.paused_by_ui:
		return
	if charging:
		charge_time += delta
		var gain := charge_rate() * delta
		var before := ki()
		set_ki(before + gain)
		charged_amount += ki() - before
		var aura := Aura.get_for(entity)
		if aura != null:
			aura.set_charge_progress(clampf(charge_time / 3.0, 0.0, 1.0))
	else:
		_regen(delta)
	if stamina_locked > 0.0:
		stamina_locked = maxf(0.0, stamina_locked - delta)
	else:
		var s := stats()
		var sr := s.stamina_regen() if s != null else 2.4
		if stamina() < max_stamina():
			set_stamina(stamina() + sr * delta)
	_was_charging = charging

func _regen(delta: float) -> void:
	var s := stats()
	var rate := s.ki_regen() if s != null else 0.8
	rate *= maxf(0.15, RELEASE_REGEN_BIAS - power_release)
	rate += Skills.meditation_regen(entity) * max_ki() * 0.01
	if ki() < max_ki():
		set_ki(ki() + rate * delta)

# --- helpers --------------------------------------------------------------

func _is_player() -> bool:
	return Game != null and Game.player == entity

## Only the local player's charge loop is a non-positional sound.
func _is_local_audio() -> bool:
	return _is_player()
