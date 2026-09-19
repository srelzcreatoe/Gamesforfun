class_name Dragon
extends Entity
## Shenron / Porunga / Super Shenron / Toronbo. Rises out of the ground over
## `RISE_TIME` seconds (emitting `Events.dragon_summoned`), then idles until the
## player interacts, which opens the wish dialog through `Events.dialog_requested`.

const RISE_TIME := 3.0

var dragon_id := ""
var rising := true
var rise_t := 0.0
var base_y := 0.0

func _configure() -> void:
	faction = String(def.get("faction", "neutral"))
	dragon_id = String(spawn_data.get("dragon_id", def.get("dragon", entity_type)))
	base_y = global_position.y
	rise_t = 0.0
	rising = true
	var h := model.visual_aabb().size.y if model != null else 8.0
	if model != null:
		model.position.y = -h
	play_anim("idle")
	Events.dragon_summoned.emit(dragon_id)
	if Audio != null:
		Audio.play_sfx_at("dragon_summon", global_position, 2.0)
		Audio.play_bgm("transformation")
	Events.screen_shake.emit(0.5, RISE_TIME)

func tick(delta: float) -> void:
	if rising:
		rise_t += delta
		var f := clampf(rise_t / RISE_TIME, 0.0, 1.0)
		if model != null:
			var h := model.visual_aabb().size.y
			model.position.y = -h * (1.0 - ease(f, 0.4))
		if f >= 1.0:
			rising = false
			if model != null:
				model.position.y = 0.0
		return
	var p: Node = Game.player
	if p is Node3D:
		look_at_head((p as Node3D).global_position + Vector3(0, 1.5, 0))

func take_damage(_amount: float, _source: Node = null, _kind_of := "melee", _knockback := Vector3.ZERO) -> float:
	return 0.0

func interact(player: Node = null) -> void:
	if rising:
		return
	if player is Node3D:
		face((player as Node3D).global_position)
	Events.dialog_requested.emit(self)

func dismiss() -> void:
	var t := create_tween()
	if model != null:
		t.tween_property(model, "position:y", -model.visual_aabb().size.y, 1.5)
	t.tween_callback(queue_free)
