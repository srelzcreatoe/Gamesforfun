class_name Stats
extends RefCounted
## Character statistics (docs/ARCHITECTURE.md §8).
##
## Seven raw stats (STR, SKP, STM, RES, VIT, PWR, ENE) are bought with TP. Every
## derived value is `raw * race multiplier * form multiplier * class scaling`,
## offensive/defensive values additionally scale with `power_release`.
##
## Data sources (all optional, code falls back to neutral values so it runs alone):
##   data/races.json  -> races[id].stat_multipliers  {STR..ENE, health_regen, ki_regen, tp_gain}
##                       races[id].classes[cid].statScaling {STR_scaling, ... DEF_scaling}
##                       races[id].classes[cid].tpCostMultiplier / tpGainMultiplier
##   data/forms.json  -> forms[id].strMultiplier ... speedMultiplier (applied by Forms.gd)

const KEYS: Array[String] = ["STR", "SKP", "STM", "RES", "VIT", "PWR", "ENE"]

## raise(stat, n) cost of one point: floor(40 * 1.08 ^ (points_in_stat / 5))
const RAISE_BASE := 40.0
const RAISE_RATIO := 1.08
const RAISE_STEP := 5.0

## Warrior scaling is the reference: a warrior gets class multiplier 1.0 everywhere.
const CLASS_REF := {"STR": 1.4, "SKP": 1.0, "STM": 1.6, "DEF": 0.24, "VIT": 1.8, "PWR": 0.5, "ENE": 1.5}

## Derived-value coefficients (§8).
const HEALTH_BASE := 100.0
const HEALTH_PER_VIT := 10.0
const KI_BASE := 100.0
const KI_PER_ENE := 8.0
const STAMINA_BASE := 100.0
const STAMINA_PER_STM := 6.0
const MELEE_BASE := 5.0
const MELEE_PER_STR := 1.2
const KI_DAMAGE_BASE := 5.0
const KI_DAMAGE_PER_PWR := 1.4
const DEFENSE_PER_RES := 0.9
const SPEED_PER_SKP := 0.004
const SPEED_MAX := 2.5

var points: Dictionary = {"STR": 5, "SKP": 5, "STM": 5, "RES": 5, "VIT": 5, "PWR": 5, "ENE": 5}
## Points bought with TP per stat; drives the raise cost curve (base points are free).
var bought: Dictionary = {"STR": 0, "SKP": 0, "STM": 0, "RES": 0, "VIT": 0, "PWR": 0, "ENE": 0}

var race_id := "human"
var class_id := "warrior"
## Combined multipliers of every active form (keys STR..ENE plus "SPEED"); 1.0 = base form.
var form_mults: Dictionary = {}
## 0.1 .. release_cap; how much of the power is let out (Ki.power_release drives it).
var power_release := 1.0
## Extra flat bonuses other systems add (armor "defense", skills "melee", ...).
var bonuses: Dictionary = {}

var _race_cache: Dictionary = {}
var _class_cache: Dictionary = {}
var _race_cached_for := ""
var _class_cached_for := ""

# --- construction ----------------------------------------------------------

static func create(race := "human", cls := "warrior") -> Stats:
	var s := Stats.new()
	s.race_id = race
	s.class_id = cls
	return s

func from_profile(profile: Dictionary) -> Stats:
	var ch: Dictionary = profile.get("character", {})
	race_id = String(ch.get("race", race_id))
	class_id = String(ch.get("class", class_id))
	var st: Dictionary = profile.get("stats", {})
	for k in KEYS:
		if st.has(k):
			points[k] = int(st[k])
	var bt: Dictionary = profile.get("stats_bought", {})
	for k in KEYS:
		bought[k] = int(bt.get(k, 0))
	power_release = float(profile.get("power_release", 1.0))
	_race_cached_for = ""
	_class_cached_for = ""
	return self

func to_profile(profile: Dictionary) -> void:
	var st: Dictionary = profile.get("stats", {})
	for k in KEYS:
		st[k] = int(points.get(k, 0))
	profile["stats"] = st
	var bt: Dictionary = {}
	for k in KEYS:
		bt[k] = int(bought.get(k, 0))
	profile["stats_bought"] = bt
	profile["power_release"] = power_release

## Build stats straight from an entities.json "stats" block (health/melee/ki/defense/speed).
func from_entity_def(def: Dictionary) -> Stats:
	var s: Dictionary = def.get("stats", {})
	points["VIT"] = int(maxf(0.0, (float(s.get("health", HEALTH_BASE)) - HEALTH_BASE) / HEALTH_PER_VIT))
	points["STR"] = int(maxf(0.0, (float(s.get("melee", MELEE_BASE)) - MELEE_BASE) / MELEE_PER_STR))
	points["PWR"] = int(maxf(0.0, (float(s.get("ki", KI_DAMAGE_BASE)) - KI_DAMAGE_BASE) / KI_DAMAGE_PER_PWR))
	points["RES"] = int(maxf(0.0, float(s.get("defense", 0.0)) / DEFENSE_PER_RES))
	points["ENE"] = int(maxf(5.0, float(s.get("ki", 5.0))))
	points["STM"] = maxi(5, int(points["STR"]) / 2)
	points["SKP"] = maxi(5, int(points["STR"]) / 2)
	return self

func duplicate_stats() -> Stats:
	var s := Stats.new()
	s.points = points.duplicate()
	s.bought = bought.duplicate()
	s.race_id = race_id
	s.class_id = class_id
	s.form_mults = form_mults.duplicate()
	s.power_release = power_release
	s.bonuses = bonuses.duplicate()
	return s

# --- data lookups ----------------------------------------------------------

func _race_def() -> Dictionary:
	if _race_cached_for != race_id:
		_race_cached_for = race_id
		var r: Dictionary = Registry.race(race_id)
		_race_cache = r.get("stat_multipliers", {})
	return _race_cache

func _class_def() -> Dictionary:
	var key := race_id + "/" + class_id
	if _class_cached_for != key:
		_class_cached_for = key
		_class_cache = {}
		var r: Dictionary = Registry.race(race_id)
		var classes: Dictionary = r.get("classes", {})
		if classes.has(class_id):
			_class_cache = classes[class_id]
	return _class_cache

## Race multiplier for a stat key, or for "health_regen" / "ki_regen" / "tp_gain".
func race_mult(key: String) -> float:
	return float(_race_def().get(key, 1.0))

## Class scaling normalised so that the DMZ "warrior" class is 1.0.
func class_mult(key: String) -> float:
	var c := _class_def()
	if c.is_empty():
		return 1.0
	var scaling: Dictionary = c.get("statScaling", {})
	if scaling.is_empty():
		return 1.0
	var ref: float = float(CLASS_REF.get(key, 1.0))
	if ref <= 0.0:
		return 1.0
	if not scaling.has(key + "_scaling"):
		return 1.0
	return float(scaling[key + "_scaling"]) / ref

func form_mult(key: String) -> float:
	return float(form_mults.get(key, 1.0))

## Replace the combined form multipliers (Forms.gd owns this dictionary).
func set_form_multipliers(m: Dictionary) -> void:
	form_mults = m.duplicate()

func clear_form_multipliers() -> void:
	form_mults = {}

func tp_cost_mult() -> float:
	return float(_class_def().get("tpCostMultiplier", 1.0))

func tp_gain_mult() -> float:
	return float(_class_def().get("tpGainMultiplier", 1.0)) * race_mult("tp_gain")

# --- raw / effective -------------------------------------------------------

func raw(stat: String) -> int:
	return int(points.get(stat, 0))

## Stat after race, form and class scaling (not power release).
func effective(stat: String) -> float:
	var key := "DEF" if stat == "RES" else stat
	return float(raw(stat)) * race_mult(stat) * form_mult(stat) * class_mult(key)

func total_points() -> int:
	var t := 0
	for k in KEYS:
		t += raw(k)
	return t

func level() -> int:
	return 1 + total_points() / 5

# --- derived ---------------------------------------------------------------

func release() -> float:
	return clampf(power_release, 0.1, 2.0)

func bonus(key: String) -> float:
	return float(bonuses.get(key, 0.0))

func max_health() -> float:
	return (HEALTH_BASE + effective("VIT") * HEALTH_PER_VIT) + bonus("health")

func max_ki() -> float:
	return (KI_BASE + effective("ENE") * KI_PER_ENE) + bonus("ki")

func max_stamina() -> float:
	return (STAMINA_BASE + effective("STM") * STAMINA_PER_STM) + bonus("stamina")

func melee() -> float:
	return (MELEE_BASE + effective("STR") * MELEE_PER_STR + bonus("melee")) * release()

func ki_damage() -> float:
	return (KI_DAMAGE_BASE + effective("PWR") * KI_DAMAGE_PER_PWR + bonus("ki_damage")) * release()

func defense() -> float:
	return (effective("RES") * DEFENSE_PER_RES + bonus("defense")) * release()

func speed_mult() -> float:
	var s := 1.0 + effective("SKP") * SPEED_PER_SKP
	return clampf(s * form_mult("SPEED"), 0.2, SPEED_MAX)

## Health per second regenerated out of combat.
func health_regen() -> float:
	var c := _class_def()
	var base := float(c.get("baseHp5", 1.75)) / 5.0
	var per := float(c.get("hp5VitScaling", 0.06)) / 5.0
	return (base + per * effective("VIT")) * race_mult("health_regen")

## Ki per second regenerated passively.
func ki_regen() -> float:
	var c := _class_def()
	var base := float(c.get("baseEp5", 4.0)) / 5.0
	var per := float(c.get("ep5EneScaling", 0.08)) / 5.0
	return (base + per * effective("ENE")) * race_mult("ki_regen")

## Stamina per second regenerated.
func stamina_regen() -> float:
	var c := _class_def()
	var base := float(c.get("baseSp5", 12.0)) / 5.0
	var per := float(c.get("sp5StmScaling", 0.12)) / 5.0
	return base + per * effective("STM")

## Crit chance from SKP (see Damage.crit_chance).
func crit_chance() -> float:
	return Damage.crit_chance(effective("SKP"))

## Rough "battle power" used for HUD display and AI threat comparison.
func battle_power() -> float:
	return melee() * 2.0 + ki_damage() * 2.0 + defense() * 3.0 + max_health() * 0.5 + max_ki() * 0.25

# --- raising ---------------------------------------------------------------

## TP price of the next single point in `stat`.
func next_cost(stat: String) -> int:
	var n := float(bought.get(stat, 0))
	return int(floor(RAISE_BASE * pow(RAISE_RATIO, n / RAISE_STEP)))

## TP price of raising `stat` by `points_count` (sum of the incremental prices).
func raise_cost(stat: String, points_count := 1) -> int:
	var n := float(bought.get(stat, 0))
	var total := 0
	for i in maxi(0, points_count):
		total += int(floor(RAISE_BASE * pow(RAISE_RATIO, (n + float(i)) / RAISE_STEP)))
	return total

## Raise a stat; returns the TP cost (0 for an unknown stat). The caller pays the TP
## (Training.raise_stat does the affordability check and the tp bookkeeping).
func raise(stat: String, points_count := 1) -> int:
	if not KEYS.has(stat) or points_count <= 0:
		return 0
	var cost := raise_cost(stat, points_count)
	points[stat] = raw(stat) + points_count
	bought[stat] = int(bought.get(stat, 0)) + points_count
	return cost

func describe() -> String:
	var parts: PackedStringArray = PackedStringArray()
	for k in KEYS:
		parts.append("%s %d" % [k, raw(k)])
	return "lvl %d [%s] hp %.0f ki %.0f melee %.1f kidmg %.1f def %.1f" % [
		level(), " ".join(parts), max_health(), max_ki(), melee(), ki_damage(), defense()]
