class_name Damage
extends RefCounted
## Pure damage math (docs/ARCHITECTURE.md §8). Every formula here is static and side
## effect free so it can be unit tested; `Damage.deal()` is the one helper that touches
## the scene tree (it calls Entity.take_damage and spawns the hit fx).

## Damage kinds. Only MELEE/KI/EXPLOSION are mitigated by defense and ki protection.
const MELEE := "melee"
const KI := "ki"
const EXPLOSION := "explosion"
const FALL := "fall"
const DROWN := "drown"
const VOID := "void"
const PLANET := "planet"

const KINDS: Array[String] = [MELEE, KI, EXPLOSION, FALL, DROWN, VOID, PLANET]
## Environmental kinds ignore defense; VOID ignores everything including ki protection.
const UNMITIGATED: Array[String] = [FALL, DROWN, VOID, PLANET]

const CRIT_BASE := 0.02
const CRIT_PER_SKP := 0.003
const CRIT_CHANCE_MAX := 0.5
const CRIT_MULT := 1.75

const KI_PROTECT_PER_LEVEL := 0.05      # fraction absorbed per skill level
const KI_PROTECT_COST_RATIO := 0.5      # ki spent per point of damage absorbed
const KI_PROTECT_MAX := 0.75

const KNOCKBACK_PER_DAMAGE := 0.09
const KNOCKBACK_MAX := 18.0
const KNOCKBACK_UP := 0.35

## Kind multipliers applied on top of the attacker's power.
const KIND_MULT := {
	MELEE: 1.0, KI: 1.0, EXPLOSION: 1.0, FALL: 1.0, DROWN: 1.0, VOID: 1.0, PLANET: 1.0,
}

static var rng := RandomNumberGenerator.new()

# --- core formulas ---------------------------------------------------------

## Defense mitigation: damage * 100 / (100 + defense).
static func mitigate(amount: float, defense: float) -> float:
	return amount * 100.0 / (100.0 + maxf(0.0, defense))

## Crit chance from an (effective) SKP value, capped at 50 %.
static func crit_chance(skp: float) -> float:
	return clampf(CRIT_BASE + skp * CRIT_PER_SKP, 0.0, CRIT_CHANCE_MAX)

static func roll_crit(skp: float) -> bool:
	return rng.randf() < crit_chance(skp)

## Ki protection skill: absorb part of the damage by spending ki.
## Returns {damage, absorbed, ki_spent}.
static func ki_protection(amount: float, level: int, ki_available: float) -> Dictionary:
	if level <= 0 or amount <= 0.0 or ki_available <= 0.0:
		return {"damage": amount, "absorbed": 0.0, "ki_spent": 0.0}
	var frac := minf(KI_PROTECT_MAX, float(level) * _protect_per_level())
	var want := amount * frac
	var affordable := ki_available / maxf(0.0001, KI_PROTECT_COST_RATIO)
	var absorbed := minf(want, affordable)
	return {"damage": maxf(0.0, amount - absorbed), "absorbed": absorbed, "ki_spent": absorbed * KI_PROTECT_COST_RATIO}

static func _protect_per_level() -> float:
	var s: Dictionary = Registry.skill("ki_protection")
	var e: Dictionary = s.get("effect", {})
	return float(e.get("absorb_per_level", KI_PROTECT_PER_LEVEL))

## Knockback impulse for `amount` damage pushed along `dir` (normalised horizontally).
static func knockback(amount: float, dir: Vector3, resistance := 0.0) -> Vector3:
	var flat := Vector3(dir.x, 0.0, dir.z)
	if flat.length_squared() < 0.0001:
		flat = Vector3(0, 0, -1)
	flat = flat.normalized()
	var power := minf(KNOCKBACK_MAX, amount * KNOCKBACK_PER_DAMAGE) / (1.0 + maxf(0.0, resistance) * 0.02)
	return flat * power + Vector3.UP * power * KNOCKBACK_UP

static func difficulty_mult() -> float:
	if Game != null and Game.has_method("difficulty_mult"):
		return Game.difficulty_mult()
	return 1.0

static func kind_mult(kind: String) -> float:
	return float(KIND_MULT.get(kind, 1.0))

static func is_mitigated(kind: String) -> bool:
	return not UNMITIGATED.has(kind)

# --- full resolution -------------------------------------------------------

## Resolve an attack completely.
##   attacker_power: melee() for MELEE, ki_damage() for KI/EXPLOSION
##   mult:           technique / combo damage multiplier
##   defense:        target defense()
##   skp:            attacker effective SKP (crit)
##   protect_level:  target ki_protection skill level, protect_ki: its ki pool
##   incoming:       true when the target is the player (difficulty scales damage taken)
## Returns {amount, crit, absorbed, ki_spent, raw}.
static func resolve(attacker_power: float, mult: float, defense: float, kind := MELEE,
		skp := 0.0, protect_level := 0, protect_ki := 0.0, force_crit := false) -> Dictionary:
	var raw := maxf(0.0, attacker_power) * maxf(0.0, mult) * kind_mult(kind)
	var crit := force_crit or (kind in [MELEE, KI] and roll_crit(skp))
	if crit:
		raw *= CRIT_MULT
	var amount := raw
	if is_mitigated(kind):
		amount = mitigate(amount, defense)
	var absorbed := 0.0
	var ki_spent := 0.0
	if kind != VOID and protect_level > 0:
		var p := ki_protection(amount, protect_level, protect_ki)
		amount = float(p["damage"])
		absorbed = float(p["absorbed"])
		ki_spent = float(p["ki_spent"])
	return {"amount": amount, "crit": crit, "absorbed": absorbed, "ki_spent": ki_spent, "raw": raw}

## Scale damage by the world difficulty. Damage the *player* receives grows with
## difficulty, damage the player deals shrinks slightly on easy.
static func apply_difficulty(amount: float, target_is_player: bool) -> float:
	var d := difficulty_mult()
	return amount * d if target_is_player else amount / maxf(0.25, sqrt(d))

static func is_player(node: Node) -> bool:
	if node == null:
		return false
	if Game != null and Game.player == node:
		return true
	return String(node.get("faction") if node.has_method("get") else "") == "player"

# --- convenience (touches the tree) ---------------------------------------

## Deal damage from `source` to `target` and run the hit feedback.
## `power` defaults to the source stats (melee or ki damage for the kind).
## Returns the damage actually applied.
static func deal(target: Node, source: Node, mult := 1.0, kind := MELEE, power := -1.0,
		knock_dir := Vector3.ZERO) -> float:
	if target == null or not is_instance_valid(target):
		return 0.0
	var st: Stats = _stats_of(source)
	var tst: Stats = _stats_of(target)
	var attacker_power := power
	if attacker_power < 0.0:
		if st != null:
			attacker_power = st.melee() if kind == MELEE else st.ki_damage()
		else:
			attacker_power = 10.0
	var defense := tst.defense() if tst != null else 0.0
	var skp := st.effective("SKP") if st != null else 0.0
	var lvl := _skill_level(target, "ki_protection")
	var pool := float(target.get("ki")) if _has_prop(target, "ki") else 0.0
	var r := resolve(attacker_power, mult, defense, kind, skp, lvl, pool)
	var amount: float = apply_difficulty(float(r["amount"]), is_player(target))
	if float(r["ki_spent"]) > 0.0 and _has_prop(target, "ki"):
		target.set("ki", maxf(0.0, pool - float(r["ki_spent"])))
	var kb := knock_dir
	if kb == Vector3.ZERO and source != null and source is Node3D and target is Node3D:
		kb = (target as Node3D).global_position - (source as Node3D).global_position
	var impulse := knockback(amount, kb, tst.effective("RES") if tst != null else 0.0)
	var applied := amount
	if target.has_method("take_damage"):
		applied = float(target.call("take_damage", amount, source, kind, impulse))
	elif _has_prop(target, "health"):
		target.set("health", float(target.get("health")) - amount)
		Events.entity_damaged.emit(target, amount, source, kind, bool(r["crit"]))
	if target is Node3D:
		var pos: Vector3 = (target as Node3D).global_position + Vector3.UP * 1.2
		HitFx.on_hit(target, pos, applied, bool(r["crit"]), kind, source)
	return applied

static func _stats_of(node: Node) -> Stats:
	if node == null or not is_instance_valid(node):
		return null
	var v: Variant = node.get("stats") if _has_prop(node, "stats") else null
	return v if v is Stats else null

static func _has_prop(node: Node, name: String) -> bool:
	return node != null and name in node

static func _skill_level(node: Node, skill: String) -> int:
	if node == null:
		return 0
	if node.has_method("skill_level"):
		return int(node.call("skill_level", skill))
	if Game != null and Game.player == node:
		return int(Game.profile.get("skills", {}).get(skill, 0))
	return 0
