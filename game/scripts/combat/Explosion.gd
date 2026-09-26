class_name KiExplosion
extends RefCounted
## Self-centred ki explosions (technique kind `explosion`: Final Explosion,
## Soul Punisher). Terrain and entity damage only - the visuals come from
## `Events.explosion` -> `ExplosionFx`.
##
##   KiExplosion.detonate(world, caster, pos, 8.0, 240.0, {"drain_all_ki": true})

const TERRAIN_DAMAGE_MIN := 25.0
const SELF_DAMAGE_FRACTION := 0.5      # Final Explosion hurts the caster too

## Blow up around `center`. Returns the number of entities damaged.
static func detonate(world: Node, caster: Node, center: Vector3, radius: float,
		damage: float, opts := {}) -> int:
	var color: Color = opts.get("color", Color(1.0, 0.95, 0.5))
	ExplosionFx.hint_color(color)
	var drain_all := bool(opts.get("drain_all_ki", false))
	var hurt_self := bool(opts.get("hurt_self", drain_all))
	var destroy_terrain := bool(opts.get("destroy_terrain", true)) and damage >= TERRAIN_DAMAGE_MIN
	if drain_all:
		var k := Ki.find_on(caster)
		if k != null:
			k.set_ki(0.0)
	Audio.play_sfx_at("ki_explosion_impact", center)
	Audio.play_sfx_at("explosion_big", center, 0.0, clampf(6.0 / maxf(1.0, radius), 0.6, 1.3))
	ScreenFx.shake(clampf(radius / 6.0, 0.3, 1.6), 0.5)
	var hits := 0
	if destroy_terrain and world != null and world.has_method("explode"):
		# World.explode does blocks + entities + Events.explosion
		world.call("explode", center, radius, damage, caster)
		hits = -1
	else:
		hits = damage_entities(world, caster, center, radius, damage)
		Events.explosion.emit(center, radius, damage)
	if hurt_self and caster != null and caster.has_method("take_damage"):
		caster.call("take_damage", damage * SELF_DAMAGE_FRACTION, caster, Damage.EXPLOSION, Vector3.ZERO)
	return hits

## Damage every hostile entity inside `radius` with a linear falloff.
static func damage_entities(world: Node, caster: Node, center: Vector3, radius: float, damage: float) -> int:
	var list: Array = []
	if world != null and world.has_method("entities_in_aabb"):
		list = world.call("entities_in_aabb", AABB(center - Vector3.ONE * radius, Vector3.ONE * radius * 2.0))
	elif world != null and world.has_method("get_entities"):
		list = world.call("get_entities")
	var hits := 0
	for e in list:
		if e == caster or not is_instance_valid(e) or not (e is Node3D):
			continue
		if _same_team(caster, e):
			continue
		var d: float = (e as Node3D).global_position.distance_to(center)
		if d > radius:
			continue
		var falloff := clampf(1.0 - d / maxf(0.1, radius), 0.15, 1.0)
		Damage.deal(e, caster, falloff, Damage.EXPLOSION, damage, (e as Node3D).global_position - center)
		hits += 1
	return hits

static func _same_team(a: Node, b: Node) -> bool:
	if a == null or b == null:
		return false
	if "faction" in a and "faction" in b:
		var x := String(a.get("faction"))
		var y := String(b.get("faction"))
		if x == y and x != "":
			return true
		if (x == "player" and y == "z_fighter") or (x == "z_fighter" and y == "player"):
			return true
	return false
