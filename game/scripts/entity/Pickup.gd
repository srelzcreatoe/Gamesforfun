class_name Pickup
extends Node3D
## Floating item: a billboarded item icon quad, or the Bedrock dragon ball model
## for `dragon_ball` items. Picked up when the player's AABB overlaps it.

const BOB_HEIGHT := 0.12
const SPIN_SPEED := 1.6
const PICK_RADIUS := 0.9
const DBALL_MODEL := "block/dball"
const DBALL_NAMEK_MODEL := "block/dballnamek"

var item_id := ""
var item_count := 1
var data: Dictionary = {}
var world: Node = null
var pickup_delay := 0.45
var ball_set := ""
var ball_star := 0
var life := 300.0
var magnet := true

var _t := 0.0
var _base_y := 0.0
var _visual: Node3D = null
var _initialized := false
var _spin := false
var _have_base := false

func _ready() -> void:
	if not _initialized:
		initialize()

## Accepts either the plain item form `{item, count}` or a dragon ball spawn
## `{set, star}` (worldgen `entities_pending` / DragonBalls.gd), deriving the item
## id from the set: earth -> "dball<star>", namek -> "dball<star>_namek",
## super/cereal -> "<set>_dball<star>" when that item exists, else the ball stays
## a marker with no item (it still emits Events.dragon_ball_found when collected).
func apply_spawn_data(d: Dictionary) -> void:
	for k in d.keys():
		data[k] = d[k]
	item_id = String(d.get("item", d.get("item_id", item_id)))
	item_count = int(d.get("count", d.get("item_count", item_count)))
	if d.has("set") or d.has("star"):
		ball_set = String(d.get("set", ball_set))
		ball_star = clampi(int(d.get("star", ball_star)), 1, 7)
		if item_id == "":
			item_id = ball_item_id(ball_set, ball_star)

## Item id for a dragon ball of `set`/`star` ("" when the set has no item yet).
static func ball_item_id(set_id: String, star: int) -> String:
	var candidates: Array[String] = []
	match set_id:
		"earth", "":
			candidates = ["dball%d" % star]
		"namek":
			candidates = ["dball%d_namek" % star, "dballnamek%d" % star]
		_:
			candidates = ["%s_dball%d" % [set_id, star], "dball%d_%s" % [star, set_id], "dball%d" % star]
	for c in candidates:
		if Registry != null and Registry.has_item(c):
			return c
	return ""

func initialize() -> void:
	_initialized = true
	if world == null:
		world = Game.world
	_t = randf() * TAU
	_build_visual()

func _build_visual() -> void:
	var def := Registry.item(item_id)
	var kind := String(def.get("kind", "misc"))
	if kind == "dragon_ball" or ball_star > 0:
		var ball: Dictionary = def.get("dragon_ball", {})
		var star := int(ball.get("star", ball_star if ball_star > 0 else 1))
		var namek := String(ball.get("set", ball_set)) == "namek"
		var m := BedrockModel.new()
		m.name = "Ball"
		add_child(m)
		if m.load_geo(DBALL_NAMEK_MODEL if namek else DBALL_MODEL):
			m.set_model_scale(1.0)
			var tex_path := "res://assets/textures/misc/dball/dball%d%s.png" % [star, "_namek" if namek else ""]
			if not ResourceLoader.exists(tex_path):
				tex_path = "res://assets/textures/misc/dball/dball%d.png" % star
			if ResourceLoader.exists(tex_path):
				m.set_texture(load(tex_path))
			_visual = m
			_spin = true
			return
		m.queue_free()
	var quad := MeshInstance3D.new()
	var mesh := QuadMesh.new()
	mesh.size = Vector2(0.5, 0.5)
	quad.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mat.alpha_scissor_threshold = 0.5
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mat.albedo_texture = Textures.item_icon(item_id)
	quad.material_override = mat
	quad.position = Vector3(0, 0.3, 0)
	add_child(quad)
	_visual = quad

func _process(delta: float) -> void:
	if Game.paused_by_ui:
		return
	_t += delta
	pickup_delay = maxf(0.0, pickup_delay - delta)
	life -= delta
	if life <= 0.0:
		queue_free()
		return
	if not _have_base:
		_have_base = true
		_base_y = position.y
	position.y = _base_y + sin(_t * 2.2) * BOB_HEIGHT
	if _spin and _visual != null:
		_visual.rotation.y += SPIN_SPEED * delta
	if pickup_delay > 0.0:
		return
	var p: Node = Game.player
	if not (p is Node3D):
		return
	var pp: Vector3 = (p as Node3D).global_position
	var box_h := 1.8
	if p is Entity:
		box_h = (p as Entity).aabb_size.y
	var to := pp + Vector3(0, box_h * 0.5, 0) - global_position
	var dist := to.length()
	if dist < PICK_RADIUS:
		_collect(p)
	elif magnet and dist < 2.5:
		global_position += to.normalized() * delta * 3.0

func _collect(player: Node) -> void:
	var taken := item_count
	var inv: Variant = player.get("inventory")
	if item_id != "" and inv != null and inv.has_method("add"):
		var left: int = int(inv.call("add", item_id, item_count, data.get("item_data", {})))
		taken = item_count - left
		if taken <= 0:
			return
		item_count = left
	Events.item_picked_up.emit(item_id, taken)
	if Audio != null:
		Audio.play_sfx_at("pickup", global_position, -4.0)
	var def := Registry.item(item_id)
	if String(def.get("kind", "")) == "dragon_ball" or ball_star > 0:
		var ball: Dictionary = def.get("dragon_ball", {})
		Events.dragon_ball_found.emit(String(ball.get("set", ball_set if ball_set != "" else "earth")),
				int(ball.get("star", ball_star if ball_star > 0 else 1)))
	if item_count <= 0:
		queue_free()

## Spawn helper used by Entity.drop_loot and the quest engineer.
static func spawn(host: Node, pos: Vector3, item: String, count := 1) -> Pickup:
	var p := Pickup.new()
	p.item_id = item
	p.item_count = count
	host.add_child(p)
	p.global_position = pos
	p._base_y = p.position.y
	p._have_base = true
	return p
