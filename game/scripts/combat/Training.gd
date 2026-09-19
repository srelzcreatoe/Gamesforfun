class_name Training
extends Node
## TP (training points) economy: combat gains, training posts, the gravity device and
## meditation (docs/ARCHITECTURE.md §8). All TP goes through here so the class/race
## `tpGainMultiplier` and the world difficulty are applied in exactly one place.
##
## Statics used by the rest of the game:
##   Training.award(entity, tp)                         # raw grant (quests, masters)
##   Training.from_damage_dealt(entity, damage)         # combat gain
##   Training.from_damage_taken(entity, damage)
##   Training.raise_stat(entity, "STR", 1) -> bool      # pays the Stats.raise cost
##   Training.unlock_form(entity, form_id) -> bool
##   Training.learn_technique(entity, id) -> bool
##   Training.upgrade_skill(entity, id) -> bool
##   Training.tp(entity) / Training.spend(entity, amount)
##
## Per-entity instance (`Training.get_for(player)`) drives the hold-to-train station,
## the gravity device and meditation:
##   var t := Training.get_for(player)
##   t.start_post("roshi_post")      t.stop_post()
##   t.set_gravity_device(3.0)       t.set_meditating(true)

const NODE_NAME := "TrainingState"

## TP from combat: damage * rate * difficulty.
const TP_PER_DAMAGE_DEALT := 0.35
const TP_PER_DAMAGE_TAKEN := 0.5

## Training post: stamina per second and TP per second, with diminishing returns the
## longer the same session runs (DMZ rewardCostExponent 0.6).
const POST_STAMINA_PER_SECOND := 9.0
const POST_TP_PER_SECOND := 6.0
const POST_DIMINISH_EXPONENT := 0.6
const POST_SESSION_SOFT_CAP := 30.0

## Gravity device: gravity multiplier -> TP multiplier.
const GRAVITY_TP_PER_G := 0.35
const GRAVITY_MAX := 100.0

## Meditation: passive ki regen while standing still in `base.meditation`.
const MEDITATION_KI_PER_SECOND := 0.02      # fraction of max ki
const MEDITATION_TP_PER_SECOND := 1.2

var entity: Node = null
var training := false
var post_id := ""
var session_time := 0.0
var gravity_mult := 1.0
var meditating := false

var _tp_accum := 0.0

# --- access ---------------------------------------------------------------

static func get_for(entity_node: Node) -> Training:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var n: Node = entity_node.get_node_or_null(NODE_NAME)
	if n is Training:
		return n
	var t := Training.new()
	t.name = NODE_NAME
	t.entity = entity_node
	entity_node.add_child(t)
	return t

static func find_on(entity_node: Node) -> Training:
	if entity_node == null or not is_instance_valid(entity_node):
		return null
	var n: Node = entity_node.get_node_or_null(NODE_NAME)
	return n if n is Training else null

func _ready() -> void:
	if entity == null:
		entity = get_parent()

# --- tp pool --------------------------------------------------------------

static func tp(entity_node: Node) -> int:
	if entity_node != null and entity_node.has_method("get_tp"):
		return int(entity_node.call("get_tp"))
	if Game != null and Game.player == entity_node:
		return int(Game.profile.get("tp", 0))
	return 0

static func tp_total(entity_node: Node) -> int:
	if Game != null and Game.player == entity_node:
		return int(Game.profile.get("tp_total", 0))
	return 0

static func _set_tp(entity_node: Node, value: int, total_delta := 0) -> void:
	if entity_node != null and entity_node.has_method("set_tp"):
		entity_node.call("set_tp", value)
	elif Game != null and Game.player == entity_node:
		Game.profile["tp"] = maxi(0, value)
		Game.profile["tp_total"] = int(Game.profile.get("tp_total", 0)) + maxi(0, total_delta)
	Events.tp_changed.emit(tp(entity_node), tp_total(entity_node))

## Grant TP after the race/class gain multiplier and the world difficulty.
static func award(entity_node: Node, amount: float) -> int:
	if amount <= 0.0:
		return 0
	var mult := 1.0
	var s: Variant = entity_node.get("stats") if entity_node != null and "stats" in entity_node else null
	if s is Stats:
		mult = (s as Stats).tp_gain_mult()
	var gained := int(round(amount * mult))
	if gained <= 0:
		return 0
	_set_tp(entity_node, tp(entity_node) + gained, gained)
	return gained

static func spend(entity_node: Node, amount: int) -> bool:
	if amount <= 0:
		return true
	if tp(entity_node) < amount:
		return false
	_set_tp(entity_node, tp(entity_node) - amount)
	return true

# --- combat gains --------------------------------------------------------

static func from_damage_dealt(entity_node: Node, damage: float) -> int:
	return award(entity_node, damage * TP_PER_DAMAGE_DEALT * Damage.difficulty_mult())

static func from_damage_taken(entity_node: Node, damage: float) -> int:
	return award(entity_node, damage * TP_PER_DAMAGE_TAKEN * Damage.difficulty_mult())

# --- spending ------------------------------------------------------------

## Raise a stat if the player can afford it. Returns false when the TP is short.
static func raise_stat(entity_node: Node, stat: String, points := 1) -> bool:
	var s: Variant = entity_node.get("stats") if entity_node != null and "stats" in entity_node else null
	if not (s is Stats):
		return false
	var st := s as Stats
	var cost := int(round(float(st.raise_cost(stat, points)) * st.tp_cost_mult()))
	if not spend(entity_node, cost):
		return false
	st.raise(stat, points)
	if Game != null and Game.player == entity_node:
		st.to_profile(Game.profile)
		Events.stats_changed.emit()
		Events.level_up.emit(st.level())
	if entity_node.has_method("refresh_derived"):
		entity_node.call("refresh_derived")
	Audio.play_sfx("level_up", -6.0)
	return true

static func unlock_form(entity_node: Node, form_id: String) -> bool:
	var check := Forms.can_unlock(entity_node, form_id)
	if not bool(check["ok"]):
		return false
	var cost := Forms.unlock_cost(form_id)
	if cost > 0 and not spend(entity_node, cost):
		return false
	if not Forms.unlock(entity_node, form_id):
		return false
	Audio.play_sfx("skill_learned")
	return true

static func learn_technique(entity_node: Node, technique_id: String) -> bool:
	var d := Techniques.def(technique_id)
	if d.is_empty():
		return false
	var cost := int(d.get("tp_cost", 0))
	if cost > 0 and not spend(entity_node, cost):
		return false
	if Game != null and Game.player == entity_node:
		var arr: Array = Game.profile.get("techniques", [])
		if not arr.has(technique_id):
			arr.append(technique_id)
		Game.profile["techniques"] = arr
	Events.technique_learned.emit(technique_id)
	Audio.play_sfx("skill_learned")
	return true

static func upgrade_skill(entity_node: Node, skill_id: String) -> bool:
	var s: Dictionary = Registry.skill(skill_id)
	if s.is_empty():
		return false
	var level := Skills.level(entity_node, skill_id)
	var costs: Array = s.get("tp_costs", [])
	if level >= int(s.get("max_level", costs.size())):
		return false
	var cost := int(costs[level]) if level < costs.size() else 1000
	if cost < 0:
		return false      # quest-only skill
	if not spend(entity_node, cost):
		return false
	if Game != null and Game.player == entity_node:
		var sk: Dictionary = Game.profile.get("skills", {})
		sk[skill_id] = level + 1
		Game.profile["skills"] = sk
	elif entity_node.has_method("set_skill_level"):
		entity_node.call("set_skill_level", skill_id, level + 1)
	Events.skill_changed.emit(skill_id, level + 1)
	Audio.play_sfx("skill_learned")
	return true

# --- stations -------------------------------------------------------------

## Hold-to-train on a training post: costs stamina, pays TP with diminishing returns.
func start_post(id := "post") -> void:
	post_id = id
	training = true
	session_time = 0.0

func stop_post() -> void:
	training = false
	post_id = ""

func set_gravity_device(multiplier: float) -> void:
	gravity_mult = clampf(multiplier, 1.0, GRAVITY_MAX)

func set_meditating(on: bool) -> void:
	meditating = on

## TP per second at the current station, including the gravity bonus and the
## diminishing return of a long session.
func post_tp_rate() -> float:
	var diminish := pow(POST_SESSION_SOFT_CAP / maxf(POST_SESSION_SOFT_CAP, session_time), POST_DIMINISH_EXPONENT)
	return POST_TP_PER_SECOND * diminish * gravity_tp_mult()

func gravity_tp_mult() -> float:
	return 1.0 + (gravity_mult - 1.0) * GRAVITY_TP_PER_G

func _process(delta: float) -> void:
	if entity == null or not is_instance_valid(entity):
		queue_free()
		return
	if Game != null and Game.paused_by_ui:
		return
	var k := Ki.find_on(entity)
	if training:
		session_time += delta
		var cost := POST_STAMINA_PER_SECOND * delta * gravity_tp_mult()
		if k != null:
			if not k.can_spend_stamina(cost):
				stop_post()
				return
			k.drain_stamina(cost)
		_tp_accum += post_tp_rate() * delta
	elif meditating:
		if k != null:
			k.add_ki(k.max_ki() * MEDITATION_KI_PER_SECOND * delta * (1.0 + Skills.meditation_regen(entity)))
		_tp_accum += MEDITATION_TP_PER_SECOND * delta
	if _tp_accum >= 1.0:
		var whole := floor(_tp_accum)
		_tp_accum -= whole
		Training.award(entity, whole)
