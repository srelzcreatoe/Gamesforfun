class_name Npc
extends Entity
## Masters, traders and quest NPCs: idle animation, looks at the player within
## `LOOK_DIST`, `interact(player)` raises `Events.dialog_requested(self)`.

const LOOK_DIST := 6.0

var master_id := ""
var npc_id := ""
var invulnerable := true
var interact_kind := "talk"
var _greet_cd := 0.0

func _configure() -> void:
	faction = String(def.get("faction", "neutral"))
	master_id = String(def.get("master", ""))
	npc_id = String(def.get("npc", entity_type))
	invulnerable = bool(def.get("invulnerable", true))
	interact_kind = String(def.get("interact", "talk"))
	if anim != null:
		for c in ["idle", "base.idle"]:
			if anim.has_clip(c):
				play_anim(c)
				break

func tick(delta: float) -> void:
	_greet_cd = maxf(0.0, _greet_cd - delta)
	var p: Node = Game.player
	if p is Node3D:
		var pp: Vector3 = (p as Node3D).global_position
		var d := global_position.distance_to(pp)
		if d <= LOOK_DIST:
			look_at_head(pp + Vector3(0, 1.5, 0))
		else:
			head_yaw_deg = lerpf(head_yaw_deg, 0.0, clampf(delta * 3.0, 0.0, 1.0))
			head_pitch_deg = lerpf(head_pitch_deg, 0.0, clampf(delta * 3.0, 0.0, 1.0))
	apply_physics(delta)

func take_damage(amount: float, source: Node = null, kind_of := "melee", knockback := Vector3.ZERO) -> float:
	if invulnerable:
		hit_flash()
		return 0.0
	return super.take_damage(amount, source, kind_of, knockback)

## Called by the player's interaction code (tap on NPC).
func interact(player: Node = null) -> void:
	if player is Node3D:
		face((player as Node3D).global_position)
	if anim != null and anim.has_clip("base.flex") and interact_kind == "train":
		play_upper_anim("base.flex", 0.1)
	Events.dialog_requested.emit(self)
	if Audio != null and _greet_cd <= 0.0:
		_greet_cd = 1.0
		Audio.play_sfx_at("click", global_position, -6.0)

func dialog_lines() -> Array:
	if master_id != "" and Registry.masters.has(master_id):
		var m: Dictionary = Registry.masters[master_id]
		var lines: Array = m.get("dialog", [])
		if not lines.is_empty():
			return lines
	var t := String(def.get("taunt", ""))
	return [t] if t != "" else ["..."]
